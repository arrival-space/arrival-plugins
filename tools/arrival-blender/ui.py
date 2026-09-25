import os
import urllib.parse

import bpy

from . import cli, hub, space
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
    "SPAWN": "Spawn point",
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
        if any(c.get("arrival_hub") for c in context.scene.collection.children_recursive):
            layout.prop(sp, "hub_selectable", toggle=True,
                        icon="RESTRICT_SELECT_OFF" if sp.hub_selectable else "RESTRICT_SELECT_ON")
        loose = space.loose_objects(context.selected_objects)
        layout.operator("arrival.new_entity", text="New Entity from Selection" if loose else "New Entity", icon="ADD")
        layout.operator("arrival.open_folder", icon="FILE_FOLDER")


def _draw_source(layout, a):
    """Whether Reload keeps this object, and the way back to the live file."""
    if not a.source_url:
        return
    box = layout.box()
    col = box.column(align=True)
    col.label(text="Reload keeps this model while", icon="LINKED")
    col.label(text="its live file is the one you have.", icon="BLANK1")
    box.operator("arrival.revert_model", icon="LOOP_BACK")


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
        elif a.kind in space.MODEL_KINDS:
            if space.is_new(root, context.scene.arrival.workspace):
                col = layout.column(align=True)
                col.label(text="New: Push creates it in the space.", icon="INFO")
                col.label(text="Its parts are uploaded as one model.", icon="BLANK1")
            else:
                layout.prop(a, "model_edited")
            if a.export_size:
                row = layout.row()
                row.enabled = False
                row.label(text=f"Last export: {_size_text(a.export_size)}", icon="EXPORT")
            stretched = space.stretched(root)
            if a.kind == "IMAGE" and (a.model_edited or stretched):
                col = layout.column(align=True)
                col.label(text="Push turns this image into a model", icon="INFO")
                col.label(text="(the plane as GLB) and replaces it.", icon="BLANK1")
            elif a.kind == "IMAGE":
                col = layout.column(align=True)
                col.label(text="Edit it to make it a model.", icon="INFO")
                col.label(text="Moving it keeps it an image.", icon="BLANK1")
            if stretched:
                col = layout.column(align=True)
                col.label(text="Scaled unevenly: Push bakes", icon="FULLSCREEN_ENTER")
                col.label(text="the stretch into the model.", icon="BLANK1")
            row = layout.row(align=True)
            row.operator_menu_enum("arrival.add_part", "primitive", text="Add", icon="ADD")
            row.operator("arrival.add_to_entity", icon="LINKED")
            _draw_source(layout, a)
        elif a.kind == "SPAWN":
            col = layout.column(align=True)
            roles = [role for on, role in ((a.spawn_third_person, "avatar"), (a.spawn_free_cam, "free camera")) if on]
            if roles:
                col.label(text="Default spawn for " + " and ".join(roles), icon="CHECKMARK")
            else:
                col.label(text="Not a default spawn", icon="BLANK1")
            col = layout.column(align=True)
            col.label(text="Only position and facing sync.", icon="INFO")
            col.label(text="The arrow shows where visitors look.", icon="BLANK1")
        elif a.kind == "SPLAT" and a.raw_axes:
            layout.prop(a, "model_edited", text="Splat edited")
            col = layout.column(align=True)
            col.label(text="Delete points in Edit Mode.", icon="INFO")
            col.label(text="Push uploads the splat as .ply.", icon="BLANK1")
            _draw_source(layout, a)
        else:
            col = layout.column(align=True)
            col.label(text="Only position, rotation and scale sync.", icon="INFO")
            if a.kind == "SPLAT":
                col.label(text="Install Splatlight LITE to see splats.", icon="BLANK1")


def _size_text(n):
    for div, unit in ((1 << 20, "MB"), (1 << 10, "KB")):
        if n >= div:
            return f"{n / div:.1f} {unit}"
    return f"{n} B"


class ARRIVAL_PT_export(bpy.types.Panel):
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Arrival"
    bl_label = "Export Settings"
    bl_options = {"DEFAULT_CLOSED"}

    @classmethod
    def poll(cls, context):
        return bool(context.scene.arrival.space_id)

    def draw(self, context):
        layout = self.layout
        settings = context.scene.arrival.export
        layout.operator_menu_enum("arrival.export_preset", "preset", text="Presets", icon="PRESET")

        col = layout.column(heading="Textures")
        col.use_property_split = True
        col.use_property_decorate = False
        col.prop(settings, "max_texture_size")
        col.prop(settings, "image_format")
        sub = col.row()
        sub.enabled = settings.image_format in ("JPEG", "WEBP")
        sub.prop(settings, "image_quality")

        col = layout.column(heading="Meshes")
        col.use_property_split = True
        col.use_property_decorate = False
        col.prop(settings, "draco", text="Draco")
        sub = col.column(align=True)
        sub.enabled = settings.draco
        sub.prop(settings, "draco_level")
        sub.prop(settings, "draco_position")
        sub.prop(settings, "draco_normal")
        sub.prop(settings, "draco_texcoord")
        sub.prop(settings, "draco_color")
        sub.prop(settings, "draco_generic")

        col = layout.column(heading="Include")
        col.use_property_split = True
        col.use_property_decorate = False
        col.prop(settings, "materials")
        col.prop(settings, "vertex_colors")
        for key in ("normals", "tangents", "texcoords", "animations", "shape_keys", "skins", "attributes"):
            col.prop(settings, key)

        col = layout.column(align=True)
        col.label(text="Used when Push uploads a model.", icon="INFO")
        col.label(text="Unedited models aren't re-uploaded.", icon="BLANK1")


classes = (ARRIVAL_PT_main, ARRIVAL_PT_space, ARRIVAL_PT_entity, ARRIVAL_PT_export)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
