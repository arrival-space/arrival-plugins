import os

import bpy
from bpy.props import (BoolProperty, CollectionProperty, EnumProperty, IntProperty, PointerProperty, StringProperty)

from . import thumbs


class ArrivalPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    cli_path: StringProperty(
        name="Arrival CLI",
        description="The tools/arrival-cli folder, its index.js, or the `arrival` executable. "
                    "Leave empty to use `arrival` from PATH",
        subtype="FILE_PATH",
    )
    server: StringProperty(
        name="Server",
        description="Backend used by Sign In, e.g. https://api-dev.arrival.space. Empty = the CLI default (live)",
    )
    workspaces_dir: StringProperty(
        name="Workspaces",
        description="Where pulled spaces are stored (one folder per space, managed by this add-on)",
        subtype="DIR_PATH",
        default=os.path.join("~", "ArrivalSpaces"),
    )

    def draw(self, context):
        col = self.layout.column()
        col.prop(self, "cli_path")
        col.prop(self, "server")
        col.prop(self, "workspaces_dir")


def prefs(context):
    return context.preferences.addons[__package__].preferences


def workspaces_dir(context):
    return os.path.abspath(os.path.expanduser(bpy.path.abspath(prefs(context).workspaces_dir or "~/ArrivalSpaces")))


class SpaceItem(bpy.types.PropertyGroup):
    space_id: StringProperty()
    title: StringProperty()
    privacy: StringProperty()
    visits: IntProperty()
    change_date: StringProperty()


_NO_IMAGE_ICON = bpy.types.UILayout.bl_rna.functions["prop"].parameters["icon"].enum_items["WORLD"].value
_space_items = []  # Blender reads enum item strings after the callback returns; keep them alive


def space_matches(wm, item):
    search = wm.search.strip().lower()
    return not search or search in item.title.lower() or search in item.space_id


def _space_enum_items(self, context):
    # The picker's tiles. The value is the index in `spaces`; the selected space stays in the list
    # while a search hides it, so the picker keeps showing it.
    _space_items[:] = [
        (s.space_id, s.title, f"{s.space_id} · {s.privacy or 'Open'} · {s.visits} visits",
         thumbs.icon_id(s.space_id) or _NO_IMAGE_ICON, i)
        for i, s in enumerate(self.spaces) if i == self.space_index or space_matches(self, s)
    ]
    return _space_items


def _live_changed(self, context):
    from . import ops
    ops.live_toggled(self.live)


class WindowProps(bpy.types.PropertyGroup):
    """Session-only state (not saved in the .blend)."""
    spaces: CollectionProperty(type=SpaceItem)
    space_index: IntProperty(default=-1)
    space: EnumProperty(
        name="Space",
        description="Choose a space",
        items=_space_enum_items,
        get=lambda self: self.space_index,
        set=lambda self, value: setattr(self, "space_index", value),
    )
    search: StringProperty(name="Search", description="Filter the spaces by title or id", options={"TEXTEDIT_UPDATE"})
    live: BoolProperty(
        name="Live",
        description="Push moves, renames and folder changes automatically once you stop. Model edits still need Push",
        update=_live_changed,
    )


class SceneProps(bpy.types.PropertyGroup):
    """The space open in this scene."""
    space_id: StringProperty()
    title: StringProperty()
    workspace: StringProperty(subtype="DIR_PATH")


class ObjectProps(bpy.types.PropertyGroup):
    """Set on an entity's root object. Children (model parts) have an empty entity_id."""
    space_id: StringProperty()
    entity_id: StringProperty(name="Entity")
    entity_type: StringProperty()
    file: StringProperty()
    kind: StringProperty()
    raw_axes: BoolProperty()  # data kept in Arrival's axes (Splatlight splats), see space.py
    read_only: BoolProperty()  # placed by the room's settings (CenterAsset), so never pushed
    signature: StringProperty()
    model_edited: BoolProperty(
        name="Model edited",
        description="Re-export and upload this model on the next Push. Set automatically when you edit it",
    )


classes = (ArrivalPreferences, SpaceItem, WindowProps, SceneProps, ObjectProps)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.WindowManager.arrival = PointerProperty(type=WindowProps)
    bpy.types.Scene.arrival = PointerProperty(type=SceneProps)
    bpy.types.Object.arrival = PointerProperty(type=ObjectProps)


def unregister():
    del bpy.types.Object.arrival
    del bpy.types.Scene.arrival
    del bpy.types.WindowManager.arrival
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
