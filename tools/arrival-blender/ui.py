import os
import urllib.parse

import bpy

from . import cli, space
from .ops import state, unpushed_count
from .props import space_matches

_config = {"mtime": None, "data": {}}


def _cli_config():
    # The panel redraws constantly; only re-read ~/.arrival/config.json when it changes.
    try:
        mtime = os.path.getmtime(cli.CONFIG_FILE)
    except OSError:
        mtime = None
    if mtime != _config["mtime"]:
        _config["mtime"] = mtime
        _config["data"] = cli.load_config() if mtime else {}
    return _config["data"]


KIND_LABELS = {
    "GLB": "Model",
    "IMAGE": "Image",
    "PLUGIN": "Plugin",
    "SPLAT": "Gaussian splat",
    "OTHER": "Placeholder",
}


PRIVACY_ICONS = {"Closed": "LOCKED", "Link Only": "LINKED"}


def _big_number(n):
    # formatBigNumber in the client: 950, 1.2K, 3.4M
    for div, suffix in ((1_000_000, "M"), (1_000, "K")):
        if n >= div:
            return f"{n / div:.1f}".rstrip("0").rstrip(".") + suffix
    return str(n)


def _draw_space_picker(layout, wm):
    """The selected space's screenshot. Clicking it opens every space as tiles, like the client's
    grid; the chosen one gets a Load button."""
    if not wm.spaces:
        layout.label(text="No spaces")
        return
    if not any(space_matches(wm, s) for s in wm.spaces):
        layout.label(text="No matches")
    col = layout.column()
    col.template_icon_view(wm, "space", show_labels=True, scale=8.0, scale_popup=5.0)
    if not 0 <= wm.space_index < len(wm.spaces):
        row = col.row()
        row.enabled = False
        row.label(text="Click the image to choose a space")
        return
    item = wm.spaces[wm.space_index]
    row = col.row()
    row.label(text=item.title, icon=PRIVACY_ICONS.get(item.privacy, "NONE"))
    visits = row.row()
    visits.enabled = False
    visits.alignment = "RIGHT"
    visits.label(text=_big_number(item.visits), icon="HIDE_OFF")
    row = col.row()
    row.scale_y = 1.4
    op = row.operator("arrival.open_space", text="Load", icon="IMPORT")
    op.space_id, op.title = item.space_id, item.title


class ARRIVAL_PT_main(bpy.types.Panel):
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Arrival"
    bl_label = "Arrival.Space"

    def draw(self, context):
        layout = self.layout
        wm = context.window_manager.arrival
        cfg = _cli_config()

        if state.busy:
            box = layout.box()
            row = box.row()
            row.label(text=state.status or f"{state.busy}…", icon="SORTTIME")
            if state.task is not None and state.task.cancellable:
                row.operator("arrival.cancel", text="", icon="X")
        elif state.last:
            layout.label(text=state.last, icon="INFO")

        if not cfg.get("token"):
            layout.operator("arrival.login", icon="URL")
            return

        row = layout.row()
        host = urllib.parse.urlparse(cfg.get("server") or "").hostname or "api-live.arrival.space"
        row.label(text=f"Signed in ({host})", icon="CHECKMARK")
        row.operator("arrival.logout", text="", icon="QUIT")

        row = layout.row(align=True)
        row.prop(wm, "search", text="", icon="VIEWZOOM")
        row.operator("arrival.refresh_spaces", text="", icon="FILE_REFRESH")
        _draw_space_picker(layout, wm)


class ARRIVAL_PT_space(bpy.types.Panel):
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Arrival"
    bl_label = "Open Space"

    @classmethod
    def poll(cls, context):
        return bool(context.scene.arrival.space_id)

    def draw(self, context):
        layout = self.layout
        sp = context.scene.arrival
        wm = context.window_manager.arrival

        col = layout.column(align=True)
        col.label(text=sp.title, icon="WORLD")
        sub = col.row()
        sub.enabled = False
        sub.label(text=sp.space_id)

        pending = unpushed_count(context.scene)
        row = layout.row(align=True)
        row.scale_y = 1.4
        row.operator("arrival.push", text=f"Push ({pending})" if pending else "Push", icon="EXPORT")
        op = row.operator("arrival.open_space", text="", icon="FILE_REFRESH")
        op.space_id, op.title = sp.space_id, sp.title

        layout.prop(wm, "live", toggle=True, icon="REC" if wm.live else "PLAY")
        loose = space.loose_objects(context.selected_objects)
        layout.operator("arrival.new_entity", text="New Entity from Selection" if loose else "New Entity", icon="ADD")
        layout.operator("arrival.open_folder", icon="FILE_FOLDER")


class ARRIVAL_PT_entity(bpy.types.Panel):
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Arrival"
    bl_label = "Entity"

    @classmethod
    def poll(cls, context):
        ob = context.active_object
        return ob is not None and space.find_root(ob) is not None

    def draw(self, context):
        layout = self.layout
        ob = context.active_object
        root = space.find_root(ob)
        a = root.arrival

        col = layout.column(align=True)
        col.label(text=root.name, icon="OBJECT_DATA")
        sub = col.column(align=True)
        sub.enabled = False
        sub.label(text=f"{a.entity_type} · {KIND_LABELS.get(a.kind, a.kind)}")
        sub.label(text=a.entity_id)

        if root is not ob:
            box = layout.box()
            box.label(text="This is a part of the model.", icon="INFO")
            box.label(text="Moving it counts as a model edit.")
            box.operator("arrival.select_entity", icon="RESTRICT_SELECT_OFF")

        if a.read_only:
            col = layout.column(align=True)
            col.label(text="Read-only: the room settings place this", icon="LOCKED")
            col.label(text="old centre asset, not the entity.", icon="BLANK1")
        elif a.kind == "GLB":
            if space.is_new(root, context.scene.arrival.workspace):
                col = layout.column(align=True)
                col.label(text="New: Push creates it in the space.", icon="INFO")
                col.label(text="Its parts are uploaded as one model.", icon="BLANK1")
            else:
                layout.prop(a, "model_edited")
            row = layout.row(align=True)
            row.operator_menu_enum("arrival.add_part", "primitive", text="Add", icon="ADD")
            row.operator("arrival.add_to_entity", icon="LINKED")
        elif a.kind == "SPLAT" and a.raw_axes:
            layout.prop(a, "model_edited", text="Splat edited")
            col = layout.column(align=True)
            col.label(text="Delete points in Edit Mode.", icon="INFO")
            col.label(text="Push uploads the splat as .ply.", icon="BLANK1")
        else:
            col = layout.column(align=True)
            col.label(text="Only position, rotation and scale sync.", icon="INFO")
            if a.kind == "SPLAT":
                col.label(text="Install Splatlight LITE to see splats.", icon="BLANK1")


classes = (ARRIVAL_PT_main, ARRIVAL_PT_space, ARRIVAL_PT_entity)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
