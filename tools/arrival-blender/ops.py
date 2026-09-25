import os
import re
import shutil

import bpy
from bpy.app.handlers import persistent
from bpy.props import BoolProperty, EnumProperty, StringProperty

from . import cli, hub, sky, space, thumbs
from .props import prefs, workspaces_dir


class _State:
    task = None       # the running cli.Task
    busy = ""         # label of the running operator
    status = ""       # progress line shown in the panel
    last = ""         # result of the last operation
    live_last = None  # changed-entity snapshot from the previous live tick
    pending = None    # {sid, title, new}: a space to finish loading once its file has opened
    live_changes = {}  # space id -> files the live space has changed since the workspace (check_live)


state = _State()


def redraw():
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def cache_dir():
    return os.path.join(workspaces_dir(bpy.context), ".cache")


def workspace_path(space_id):
    return os.path.join(workspaces_dir(bpy.context), re.sub(r"[^A-Za-z0-9_-]", "_", space_id))


def unpushed_count(scene):
    sp = scene.arrival
    if not sp.space_id:
        return 0
    pending = space.pending_roots(scene, sp.space_id, sp.workspace)
    edited = [r for r in space.entity_roots(scene, sp.space_id) if not r.arrival.outdated and (
        r.arrival.model_edited or space.stretched(r) or space.is_restored(r, sp.workspace))]
    return len(set(pending) | set(edited)) + len(space.pending_deletes(scene, sp.space_id, sp.workspace))


def _pull_workspace(sid, ws, keep_trash=False):
    """Pull the space into a fresh folder and swap it in: `arrival pull --force` would keep files of
    entities deleted since the last pull, and they'd come back on the next push. keep_trash carries
    over the deleted entities' files (space.carry_trash), for a re-pull that keeps the scene."""
    tmp = ws + ".pull"
    shutil.rmtree(tmp, ignore_errors=True)
    try:
        yield cli.run(prefs(bpy.context).cli_path, ["pull", sid, "--dir", tmp])
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    if keep_trash:
        space.carry_trash(ws, tmp)
    space.carry_sessions(ws, tmp)
    shutil.rmtree(ws, ignore_errors=True)
    os.replace(tmp, ws)


def _window_override():
    wm = bpy.context.window_manager
    return bpy.context.temp_override(window=wm.windows[0]) if wm.windows else bpy.context.temp_override()


def _later(fn, delay=0.05):
    """Run fn from a timer, with a window: after a file load, or where an operator can't open one."""
    def run():
        try:
            with _window_override():
                fn()
        except Exception as e:  # an uncaught error would only reach the console
            print(f"[arrival] {e}")
            state.last = str(e).splitlines()[0]
            redraw()
        return None
    bpy.app.timers.register(run, first_interval=delay)


def _save_session(path=None):
    """Save the scene as its space's session file: to `path` (a new session), or when the file
    open now is that session anyway (a Push or Reload keeps it in step with the workspace)."""
    sp = bpy.context.scene.arrival
    session = space.session_path(sp.workspace, sp.space_id)
    if path is None and os.path.normcase(os.path.abspath(bpy.data.filepath or "")) != os.path.normcase(session):
        return
    try:
        with _window_override():
            if path is None:
                bpy.ops.wm.save_mainfile()
            else:
                bpy.ops.wm.save_as_mainfile(filepath=path)
    except RuntimeError as e:
        print(f"[arrival] saving the session: {e}")


def _begin_session(sid, title):
    """Open the space's session file, or start one from an empty file (the startup file's layout,
    none of its objects). The load ends this operator; _on_load_post picks the space up from
    state.pending."""
    path = space.session_path(workspace_path(sid), sid)
    state.pending = {"sid": sid, "title": title, "new": not os.path.isfile(path)}

    def switch():
        if state.pending["new"]:
            bpy.ops.wm.read_homefile(use_empty=True)
        else:
            bpy.ops.wm.open_mainfile(filepath=path)
    _later(switch)


def _push_summary(result):
    """One line for the panel from cli.parse_push."""
    applied = result["applied"]
    if result["status"] in ("nothing", "noChanges"):
        return "Nothing to push"
    deleted = sum(1 for op, _target in applied if op == "delete entity")
    changed = len(applied) - deleted
    parts = ([f"pushed {changed} change{'s' if changed != 1 else ''}"] if changed else []) + ([f"deleted {deleted}"] if deleted else [])
    return (", ".join(parts) or "nothing pushed").capitalize()


class _AsyncOp:
    """Runs self.steps(), a generator that yields cli.Tasks and receives their results, without
    blocking Blender. After a yield, use bpy.context: the execute() context is gone by then.
    One operation runs at a time."""

    _timer = None
    _gen = None

    @classmethod
    def poll(cls, context):
        return not state.busy

    def execute(self, context):
        if state.busy:
            self.report({"WARNING"}, f"Busy: {state.busy}")
            return {"CANCELLED"}
        state.busy = self.bl_label
        self._gen = self.steps()
        result = self._advance(None, None)
        if result == {"RUNNING_MODAL"}:
            wm = context.window_manager
            self._timer = wm.event_timer_add(0.1, window=context.window)
            wm.modal_handler_add(self)
        return result

    def modal(self, context, event):
        task = state.task
        if event.type != "TIMER" or task is None:
            return {"PASS_THROUGH"}
        if not task.done:
            if task.progress and task.progress != state.status:
                state.status = task.progress
                redraw()
            return {"PASS_THROUGH"}
        state.task = None
        return self._advance(task.result, task.error)

    def _advance(self, value, error):
        try:
            state.task = self._gen.throw(error) if error else self._gen.send(value)
        except StopIteration:
            self._end()
            return {"FINISHED"}
        except Exception as e:
            self.report({"ERROR"}, str(e))
            state.last = str(e).splitlines()[0]
            self.failed()
            self._end()
            return {"CANCELLED"}
        redraw()
        return {"RUNNING_MODAL"}

    def cancel(self, context):
        # Blender dropped the operator (file load, quit): stop the child process too.
        if state.task:
            state.task.cancel()
        self._end()

    def _end(self):
        if self._timer:
            bpy.context.window_manager.event_timer_remove(self._timer)
            self._timer = None
        state.task = None
        state.busy = ""
        state.status = ""
        redraw()

    def failed(self):
        pass


def _refresh_spaces():
    state.status = "Loading spaces…"
    out = yield cli.run(prefs(bpy.context).cli_path, ["spaces", "--json"])
    wm = bpy.context.window_manager.arrival
    wm.spaces.clear()
    for s in cli.parse_json_output(out):
        item = wm.spaces.add()
        item.space_id = str(s.get("id") or "")
        item.title = str(s.get("title") or "Untitled")
        item.privacy = str(s.get("privacy") or "")
        item.visits = int(s.get("visitCount") or 0)
        item.change_date = str(s.get("changeDate") or "")
    if wm.space_index >= len(wm.spaces):
        wm.space_index = -1
    state.last = f"{len(wm.spaces)} spaces"

    spaces = [(s.space_id, s.change_date) for s in wm.spaces]
    state.status = "Loading space images…"
    try:
        paths = yield cli.Task(thumbs.fetch, spaces, thumbs.cache_dir())
    except Exception as e:  # the list is still usable without images
        print(f"[arrival] space images: {e}")
        return
    thumbs.load(paths)


class ARRIVAL_OT_login(_AsyncOp, bpy.types.Operator):
    bl_idname = "arrival.login"
    bl_label = "Sign In"
    bl_description = "Sign in to Arrival.Space in your browser"

    def steps(self):
        args = ["login"]
        server = prefs(bpy.context).server.strip()
        if server:
            args += ["--server", server]
        state.status = "Finish signing in in your browser…"
        yield cli.run(prefs(bpy.context).cli_path, args)
        yield from _refresh_spaces()


class ARRIVAL_OT_logout(_AsyncOp, bpy.types.Operator):
    bl_idname = "arrival.logout"
    bl_label = "Sign Out"
    bl_description = "Forget the stored sign-in on this computer"

    def steps(self):
        yield cli.run(prefs(bpy.context).cli_path, ["logout"])
        bpy.context.window_manager.arrival.spaces.clear()
        state.last = "Signed out"


class ARRIVAL_OT_refresh_spaces(_AsyncOp, bpy.types.Operator):
    bl_idname = "arrival.refresh_spaces"
    bl_label = "Refresh Spaces"
    bl_description = "Reload the list of your spaces"

    def steps(self):
        yield from _refresh_spaces()


class ARRIVAL_OT_open_space(_AsyncOp, bpy.types.Operator):
    bl_idname = "arrival.open_space"
    bl_label = "Open Space"
    bl_description = "Pull the space and load it into this scene, replacing the space open in it"

    space_id: StringProperty(options={"SKIP_SAVE", "HIDDEN"})
    title: StringProperty(options={"SKIP_SAVE", "HIDDEN"})
    in_place: BoolProperty(options={"SKIP_SAVE", "HIDDEN"})  # build into this file (a new session)
    save_session: BoolProperty(options={"SKIP_SAVE", "HIDDEN"})  # then save it as the session file

    def invoke(self, context, event):
        if not self.space_id:
            wm = context.window_manager.arrival
            if not 0 <= wm.space_index < len(wm.spaces):
                self.report({"WARNING"}, "Pick a space first")
                return {"CANCELLED"}
            item = wm.spaces[wm.space_index]
            self.space_id, self.title = item.space_id, item.title
        sp = context.scene.arrival
        if sp.space_id == self.space_id:
            if unpushed_count(context.scene):
                return context.window_manager.invoke_confirm(
                    self, event, title="Discard unpushed changes?",
                    message="Reloading takes the live version of the space: deleted entities come back. Models "
                            "that are still the file you loaded or pushed keep their Blender edits.",
                    confirm_text="Reload", icon="WARNING",
                )
        elif bpy.data.is_dirty:
            return context.window_manager.invoke_confirm(
                self, event, title="Leave this file?",
                message=f"{self.title} opens in its own file. Unsaved changes in this one are lost.",
                confirm_text="Load", icon="WARNING",
            )
        return self.execute(context)

    def execute(self, context):
        # Each space has its own session file: loading another one switches files.
        if not self.in_place and context.scene.arrival.space_id != self.space_id.strip():
            _begin_session(self.space_id.strip(), self.title)
            return {"FINISHED"}
        return super().execute(context)

    def steps(self):
        sid = self.space_id.strip()
        ws = workspace_path(sid)
        state.status = f"Pulling {sid}…"
        yield from _pull_workspace(sid, ws)

        entities = space.load_entities(ws)
        room = space.read_room(ws)
        # Models Reload keeps aren't downloaded. build() checks again, since the scene can change
        # while the downloads run.
        kept = space.kept_roots(bpy.context.scene, sid, entities, room)
        urls = space.download_urls(entities, room, skip=kept)
        files = {}
        if urls:
            state.status = f"Downloading models 0/{len(urls)}"
            files = yield cli.Task(space.download_all, urls, cache_dir())

        default_sky, sky_error = None, None
        if not space._str(room.get("skyboxImage")):
            state.status = "Loading the default sky…"
            try:
                default_sky = yield cli.Task(sky.fetch_default, cache_dir())
            except Exception as e:
                sky_error = f"Default sky: {e}"

        hub_data, hub_error = None, None
        if not room.get("hideArchitecture"):
            state.status = "Loading the hub…"
            try:
                hub_data = yield cli.Task(hub.fetch, cache_dir(), room, hub.read_static_gates(ws))
            except Exception as e:
                hub_error = f"Hub: {e}"

        context = bpy.context
        # A scene holds one space: loading this one takes out the one opened before.
        for old in space.space_ids(context.scene) - {sid}:
            space.remove_space(context.scene, old)
        title = self.title or room.get("title") or sid
        warnings = space.build(context, sid, title, ws, entities, files, default_sky)
        if sky_error:
            warnings.append(sky_error)
        coll = space.space_collection(context.scene, sid, title)
        if hub_data:
            hub.build(coll, hub_data)
        else:
            hub.remove(coll)
        if hub_error:
            warnings.append(hub_error)
        sp = context.scene.arrival
        sp.space_id, sp.title, sp.workspace = sid, title, ws
        bpy.ops.ed.undo_push(message="Open Arrival space")
        state.live_changes[sid] = 0
        _save_session(space.session_path(ws, sid) if self.save_session else None)
        state.last = f"Loaded {len(entities)} entities"
        if warnings:
            for w in warnings:
                print(f"[arrival] {w}")
            self.report({"WARNING"}, f"Opened with {len(warnings)} problems (see the system console):\n" + "\n".join(warnings[:5]))
        else:
            self.report({"INFO"}, f"Opened {title}")


class ARRIVAL_OT_push(_AsyncOp, bpy.types.Operator):
    bl_idname = "arrival.push"
    bl_label = "Push"
    bl_description = "Upload edited models and apply moves to the live space"

    transforms_only: BoolProperty(options={"SKIP_SAVE", "HIDDEN"})

    @classmethod
    def poll(cls, context):
        return super().poll(context) and bool(context.scene.arrival.space_id)

    def invoke(self, context, event):
        sp = context.scene.arrival
        deletions = [] if self.transforms_only else space.pending_deletes(context.scene, sp.space_id, sp.workspace)
        if deletions:
            return context.window_manager.invoke_confirm(
                self, event, title="Delete from the live space?", message=space.describe_deletes(deletions),
                confirm_text="Push", icon="WARNING",
            )
        return self.execute(context)

    def steps(self):
        context = bpy.context
        cli_path = prefs(context).cli_path
        sp = context.scene.arrival
        sid, ws = sp.space_id, sp.workspace
        if not os.path.isdir(os.path.join(ws, ".arrival")):
            raise space.EntityError("The space's workspace folder is missing. Reload the space.")
        export_dir = os.path.join(cache_dir(), "exports", re.sub(r"[^A-Za-z0-9_-]", "_", sid))
        items = space.prepare_push(context, sid, ws, export_dir, include_models=not self.transforms_only)
        # Deletes only go with a full Push, which the invoke confirmed (Live never deletes).
        deletions = [] if self.transforms_only else space.pending_deletes(context.scene, sid, ws)
        done = space.apply_deletes(ws, deletions)
        try:
            for item in items:
                if item.export_path:
                    state.status = f"Uploading {os.path.basename(item.export_path)}…"
                    out = yield cli.run(cli_path, ["upload", item.export_path, "--json"])
                    url = cli.parse_json_output(out).get("url")
                    if not url:
                        raise cli.CliError("The upload returned no URL")
                    space.set_model_url(item.entity, url)
                    item.url = url
            space.write(items)
            state.status = "Pushing…"
            args = ["push", "--dir", ws] + (["--force"] if done["files"] else [])
            result = cli.parse_push(*(yield cli.run(cli_path, args, check=False)))
        except BaseException:
            space.rollback_deletes(ws, done)
            space.mark_failed(items)
            raise
        failed_ids = {target for _op, target, _error in result["failed"]}
        failed_items = [i for i in items if i.entity.get("id") in failed_ids]
        space.mark_failed(failed_items)
        space.mark_pushed([i for i in items if i not in failed_items], ws)
        # The entities this scene knows: the ones it created or restored, not the ones it deleted.
        known = set(sp.known_ids.split("\n")) | {i.entity["id"] for i in items if i not in failed_items}
        known -= {d.entity["id"] for d in deletions if not d.hide and d.entity["id"] not in failed_ids}
        sp.known_ids = "\n".join(sorted(known - {""}))
        state.last = _push_summary(result)
        # The CLI's baseline can now disagree with the live space: after a partial push it counts the
        # failed writes as done, and after "nothing to do" (e.g. an entity already deleted live) it
        # keeps the deletes, so every later push would send them again. Re-pull the workspace:
        # whatever didn't reach the space is pending again, and the scene stays as it is.
        if result["status"] == "partial" or (result["status"] == "noChanges" and done["files"]):
            state.status = "Syncing the workspace…"
            try:
                yield from _pull_workspace(sid, ws, keep_trash=True)
            except Exception as e:
                self.report({"WARNING"}, f"Couldn't re-sync the workspace ({e}). Reload the space before pushing again.")
        if not self.transforms_only:
            if not result["failed"]:
                state.live_changes[sid] = 0  # the live space is what was just pushed
            _save_session()
        if result["failed"]:
            state.last += f", {len(result['failed'])} failed"
            lines = [f"{op} {target}: {error}" for op, target, error in result["failed"]]
            self.report({"WARNING"}, "Some changes weren't saved and are still pending:\n" + "\n".join(lines[:8]))
        elif not self.transforms_only:
            self.report({"INFO"}, state.last)

    def failed(self):
        if self.transforms_only:
            # Don't retry a failing push every second.
            bpy.context.window_manager.arrival.live = False
            state.last = "Live stopped: " + state.last


class ARRIVAL_OT_check_live(_AsyncOp, bpy.types.Operator):
    bl_idname = "arrival.check_live"
    bl_label = "Check Live Space"
    bl_description = "See whether the live space changed since your last pull or push"

    @classmethod
    def poll(cls, context):
        sp = context.scene.arrival
        return super().poll(context) and bool(sp.space_id) and os.path.isdir(os.path.join(sp.workspace, ".arrival"))

    def steps(self):
        sp = bpy.context.scene.arrival
        sid, ws = sp.space_id, sp.workspace
        tmp = ws + ".check"
        shutil.rmtree(tmp, ignore_errors=True)
        state.status = "Checking the live space…"
        try:
            yield cli.run(prefs(bpy.context).cli_path, ["pull", sid, "--dir", tmp])
            changes = space.live_changes(ws, tmp)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        state.live_changes[sid] = changes
        state.last = f"The live space has {changes} change{'s' if changes != 1 else ''}" if changes else "Up to date with the live space"


class ARRIVAL_OT_cancel(bpy.types.Operator):
    bl_idname = "arrival.cancel"
    bl_label = "Cancel"
    bl_description = "Stop the running command"

    @classmethod
    def poll(cls, context):
        return state.task is not None and state.task.cancellable

    def execute(self, context):
        state.task.cancel()
        return {"FINISHED"}


class ARRIVAL_OT_select_entity(bpy.types.Operator):
    bl_idname = "arrival.select_entity"
    bl_label = "Select Entity"
    bl_description = "Select the entity this part belongs to, to move the whole thing"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        ob = context.active_object
        root = space.find_root(ob) if ob else None
        return root is not None and root is not ob

    def execute(self, context):
        root = space.find_root(context.active_object)
        if context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        for ob in context.selected_objects:
            ob.select_set(False)
        root.select_set(True)
        context.view_layer.objects.active = root
        return {"FINISHED"}


class ARRIVAL_OT_revert_model(bpy.types.Operator):
    bl_idname = "arrival.revert_model"
    bl_label = "Revert to Live Model"
    bl_description = ("Throw away this entity's Blender model (modifiers too) and load its live file. "
                      "Reloads the space")
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context):
        ob = context.active_object
        root = space.find_root(ob) if ob else None
        return not state.busy and root is not None and bool(root.arrival.source_url)

    def invoke(self, context, event):
        root = space.find_root(context.active_object)
        return context.window_manager.invoke_confirm(
            self, event, title=f"Revert {root.name}?",
            message="Its Blender edits and modifiers are lost. Unpushed moves in the space are too.",
            confirm_text="Revert", icon="WARNING",
        )

    def execute(self, context):
        root = space.find_root(context.active_object)
        # Without a source file, Reload re-imports it instead of keeping it.
        root.arrival.source_url = ""
        root.arrival.model_edited = False
        sp = context.scene.arrival
        result = bpy.ops.arrival.open_space("EXEC_DEFAULT", space_id=sp.space_id, title=sp.title)
        return {"CANCELLED"} if "CANCELLED" in result else {"FINISHED"}  # the reload runs on its own


EXPORT_DEFAULTS = {
    "max_texture_size": "0", "image_format": "AUTO", "image_quality": 75, "draco": False,
    "draco_level": 6, "draco_position": 14, "draco_normal": 10, "draco_texcoord": 12, "draco_color": 10,
    "draco_generic": 12, "normals": True, "tangents": False, "texcoords": True, "vertex_colors": "MATERIAL",
    "materials": "EXPORT", "animations": True, "shape_keys": True, "skins": True, "attributes": False,
}
EXPORT_PRESETS = {
    "ORIGINAL": {},
    "BALANCED": {"max_texture_size": "2048", "image_format": "WEBP", "image_quality": 85, "draco": True},
    "SMALL": {"max_texture_size": "1024", "image_format": "WEBP", "image_quality": 70, "draco": True,
              "draco_level": 10, "draco_position": 12, "draco_normal": 8, "draco_texcoord": 10, "draco_color": 8},
}


class ARRIVAL_OT_export_preset(bpy.types.Operator):
    bl_idname = "arrival.export_preset"
    bl_label = "Export Preset"
    bl_description = "Set all export settings at once"
    bl_options = {"REGISTER", "UNDO"}

    preset: EnumProperty(name="Preset", items=[
        ("ORIGINAL", "Original", "Full-size textures as they are, uncompressed meshes"),
        ("BALANCED", "Balanced", "Textures up to 2048 px as WebP, Draco meshes"),
        ("SMALL", "Small", "Textures up to 1024 px as WebP, strongly compressed Draco meshes"),
    ])

    def execute(self, context):
        settings = context.scene.arrival.export
        for key, value in {**EXPORT_DEFAULTS, **EXPORT_PRESETS[self.preset]}.items():
            setattr(settings, key, value)
        return {"FINISHED"}


def _model_root(context):
    """The model (or image, which becomes one) entity the active object belongs to, if it can take
    new parts."""
    ob = context.active_object
    root = space.find_root(ob) if ob else None
    if root is None or root.arrival.kind not in space.MODEL_KINDS or root.arrival.read_only:
        return None
    return root


def _space_collection(context):
    """Where new entities go: the active collection when it's the space's or one of its folders."""
    sp = context.scene.arrival
    coll = space.space_collection(context.scene, sp.space_id, sp.title)
    active = context.view_layer.active_layer_collection.collection
    return active if active.get("arrival_folder_id") and active in coll.children_recursive else coll


def _select_only(context, ob):
    for o in context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    context.view_layer.objects.active = ob


class ARRIVAL_OT_new_entity(bpy.types.Operator):
    bl_idname = "arrival.new_entity"
    bl_label = "New Entity"
    bl_description = ("Make the selected objects one new model entity, or an empty one at the 3D cursor "
                      "to add parts to. Push creates it in the space")
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return bool(context.scene.arrival.space_id) and context.mode == "OBJECT"

    def execute(self, context):
        coll = _space_collection(context)
        root = space.new_entity_root(coll, space.loose_objects(context.selected_objects), context.scene.cursor.location)
        space.make_entity(root, context.scene.arrival.space_id)
        _select_only(context, root)
        return {"FINISHED"}


PRIMITIVES = [
    ("cube", "Cube", "", "MESH_CUBE", 0),
    ("uv_sphere", "UV Sphere", "", "MESH_UVSPHERE", 1),
    ("ico_sphere", "Ico Sphere", "", "MESH_ICOSPHERE", 2),
    ("cylinder", "Cylinder", "", "MESH_CYLINDER", 3),
    ("cone", "Cone", "", "MESH_CONE", 4),
    ("torus", "Torus", "", "MESH_TORUS", 5),
    ("plane", "Plane", "", "MESH_PLANE", 6),
    ("monkey", "Monkey", "", "MESH_MONKEY", 7),
]


class ARRIVAL_OT_add_part(bpy.types.Operator):
    bl_idname = "arrival.add_part"
    bl_label = "Add Part"
    bl_description = "Add a primitive to this entity's model, at the entity's origin"
    bl_options = {"REGISTER", "UNDO"}

    primitive: EnumProperty(name="Primitive", items=PRIMITIVES)

    @classmethod
    def poll(cls, context):
        return _model_root(context) is not None

    def execute(self, context):
        root = _model_root(context)
        if context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        getattr(bpy.ops.mesh, f"primitive_{self.primitive}_add")(location=root.matrix_world.translation)
        context.view_layer.update()
        space.add_parts(root, [context.view_layer.objects.active])
        return {"FINISHED"}


class ARRIVAL_OT_add_to_entity(bpy.types.Operator):
    bl_idname = "arrival.add_to_entity"
    bl_label = "Add Selected"
    bl_description = "Put the other selected objects into this entity's model, where they are"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return (context.mode == "OBJECT" and _model_root(context) is not None
                and bool(space.loose_objects(context.selected_objects)))

    def execute(self, context):
        space.add_parts(_model_root(context), space.loose_objects(context.selected_objects))
        return {"FINISHED"}


class ARRIVAL_OT_open_folder(bpy.types.Operator):
    bl_idname = "arrival.open_folder"
    bl_label = "Open Workspace Folder"
    bl_description = "Show the pulled files (the same workspace the arrival CLI uses)"

    @classmethod
    def poll(cls, context):
        return os.path.isdir(context.scene.arrival.workspace)

    def execute(self, context):
        bpy.ops.wm.path_open(filepath=context.scene.arrival.workspace)
        return {"FINISHED"}


def _live_tick():
    wm = bpy.context.window_manager
    if not wm.arrival.live:
        return None
    if state.busy:
        return 1.0
    for win in wm.windows:
        sp = win.scene.arrival
        if sp.space_id and os.path.isdir(sp.workspace):
            break
    else:
        return 1.0
    pending = space.pending_roots(win.scene, sp.space_id, sp.workspace)
    snapshot = [(r.name, tuple(map(tuple, r.matrix_world)), tuple(c.name for c in r.users_collection))
                for r in pending]
    # Push once the changed objects hold still for a tick, i.e. the drag is over.
    if pending and snapshot == state.live_last:
        state.live_last = None
        try:
            with bpy.context.temp_override(window=win):
                bpy.ops.arrival.push("EXEC_DEFAULT", transforms_only=True)
        except RuntimeError as e:  # an uncaught error would unregister this timer
            print(f"[arrival] live push: {e}")
    else:
        state.live_last = snapshot
    return 1.0


def live_toggled(on):
    state.live_last = None
    if on and not bpy.app.timers.is_registered(_live_tick):
        bpy.app.timers.register(_live_tick, first_interval=1.0)


@persistent
def _on_load_post(*_args):
    space._synced.clear()
    state.task = None
    state.busy = ""
    state.status = ""
    wm = bpy.context.window_manager
    if wm.arrival.live:
        wm.arrival.live = False
    pending, state.pending = state.pending, None
    if pending and pending["new"]:
        # A new session: the startup file is open; build the space in it and save it.
        _later(lambda: bpy.ops.arrival.open_space(
            "EXEC_DEFAULT", space_id=pending["sid"], title=pending["title"], in_place=True, save_session=True))
        return
    sp = bpy.context.scene.arrival
    if not sp.space_id:
        return
    # A session file (by Load or File > Open): catch it up with the workspace, then see whether
    # the live space moved on.
    updated, outdated, unseen = space.reconcile(bpy.context.scene)
    notes = [f"{len(updated)} caught up"] * bool(updated) + [f"{len(outdated)} outdated"] * bool(outdated) \
        + [f"{unseen} new in the workspace"] * bool(unseen)
    state.last = f"Opened {sp.title}" + (f" ({', '.join(notes)})" if notes else "")
    for i, item in enumerate(wm.arrival.spaces):
        if item.space_id == sp.space_id:
            wm.arrival.space_index = i
    if os.path.isdir(os.path.join(sp.workspace, ".arrival")):
        _later(lambda: bpy.ops.arrival.check_live("EXEC_DEFAULT"), delay=0.5)


@persistent
def _on_depsgraph_update(scene, depsgraph):
    space.on_depsgraph_update(scene, depsgraph)


classes = (
    ARRIVAL_OT_login, ARRIVAL_OT_logout, ARRIVAL_OT_refresh_spaces, ARRIVAL_OT_open_space,
    ARRIVAL_OT_push, ARRIVAL_OT_cancel, ARRIVAL_OT_select_entity, ARRIVAL_OT_new_entity,
    ARRIVAL_OT_add_part, ARRIVAL_OT_add_to_entity, ARRIVAL_OT_open_folder, ARRIVAL_OT_revert_model,
    ARRIVAL_OT_export_preset, ARRIVAL_OT_check_live,
)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.app.handlers.depsgraph_update_post.append(_on_depsgraph_update)
    bpy.app.handlers.load_post.append(_on_load_post)


def unregister():
    if bpy.app.timers.is_registered(_live_tick):
        bpy.app.timers.unregister(_live_tick)
    if state.task:
        state.task.cancel()
    bpy.app.handlers.load_post.remove(_on_load_post)
    bpy.app.handlers.depsgraph_update_post.remove(_on_depsgraph_update)
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
