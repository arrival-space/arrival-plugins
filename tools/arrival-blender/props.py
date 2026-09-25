import os

import bpy
from bpy.props import (BoolProperty, CollectionProperty, EnumProperty, FloatVectorProperty, IntProperty, PointerProperty,
                       StringProperty)

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


TEXTURE_SIZES = [
    ("0", "Original", "Keep the textures' own size"),
    ("4096", "4096", "Scale textures down to at most 4096 px"),
    ("2048", "2048", "Scale textures down to at most 2048 px"),
    ("1024", "1024", "Scale textures down to at most 1024 px"),
    ("512", "512", "Scale textures down to at most 512 px"),
    ("256", "256", "Scale textures down to at most 256 px"),
]


class ExportSettings(bpy.types.PropertyGroup):
    """How Push exports models (space.export_options). What the app can load decides the options:
    it has a Draco decoder but no meshopt one, and loads WebP."""
    max_texture_size: EnumProperty(
        name="Max Size", items=TEXTURE_SIZES, default="0",
        description="Scale larger textures down for the upload. Your images in Blender stay as they are",
    )
    image_format: EnumProperty(
        name="Format", default="AUTO",
        items=[("AUTO", "Automatic", "PNG, or JPEG for JPEG images"),
               ("JPEG", "JPEG", "Smaller, no transparency: textures with alpha stay PNG"),
               ("WEBP", "WebP", "Smallest, with transparency"),
               ("NONE", "None", "Leave textures out")],
    )
    image_quality: IntProperty(name="Quality", min=0, max=100, default=75, subtype="PERCENTAGE",
                               description="JPEG and WebP quality")
    draco: BoolProperty(name="Draco Compression",
                        description="Compress meshes with Draco, which the app decodes. Much smaller, slightly lossy")
    draco_level: IntProperty(name="Level", min=0, max=10, default=6,
                             description="Higher compresses more and takes longer to decode")
    draco_position: IntProperty(name="Position", min=0, max=30, default=14,
                                description="Bits for positions. Fewer is smaller but less exact")
    draco_normal: IntProperty(name="Normal", min=0, max=30, default=10, description="Bits for normals")
    draco_texcoord: IntProperty(name="UV", min=0, max=30, default=12, description="Bits for UVs")
    draco_color: IntProperty(name="Color", min=0, max=30, default=10, description="Bits for vertex colors")
    draco_generic: IntProperty(name="Other", min=0, max=30, default=12, description="Bits for other attributes")
    normals: BoolProperty(name="Normals", default=True,
                          description="Without them the app computes flat normals")
    tangents: BoolProperty(name="Tangents", description="Only needed for exact normal maps")
    texcoords: BoolProperty(name="UVs", default=True, description="Without them textures can't be mapped")
    vertex_colors: EnumProperty(
        name="Vertex Colors", default="MATERIAL",
        items=[("MATERIAL", "Used by Materials", "Only the ones a material reads"),
               ("ACTIVE", "Active", "The active color attribute"),
               ("NONE", "None", "Leave them out")],
    )
    materials: EnumProperty(
        name="Materials", default="EXPORT",
        items=[("EXPORT", "Export", "Materials and their textures"),
               ("PLACEHOLDER", "Placeholder", "Material slots only, no textures"),
               ("NONE", "None", "Leave materials out")],
    )
    animations: BoolProperty(name="Animation", default=True)
    shape_keys: BoolProperty(name="Shape Keys", default=True)
    skins: BoolProperty(name="Skinning", default=True, description="Armature deformation")
    attributes: BoolProperty(name="Custom Attributes", description="Mesh attributes beyond the standard ones")


def _hub_selectable_changed(self, context):
    from . import hub
    hub.set_selectable(context.scene, self.hub_selectable)


class SceneProps(bpy.types.PropertyGroup):
    """The space open in this scene."""
    space_id: StringProperty()
    title: StringProperty()
    workspace: StringProperty(subtype="DIR_PATH")
    hub_selectable: BoolProperty(
        name="Hub Selectable",
        description="Let the hub be clicked and picked, e.g. with a modifier's eyedropper. It still can't be "
                    "moved, and it's never pushed",
        update=_hub_selectable_changed,
    )
    export: PointerProperty(type=ExportSettings)


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
    # The model/splat file this object's content matches: imported from, or uploaded by a Push.
    # Reload keeps the object (modifiers and all) while the entity's live file is still this one.
    source_url: StringProperty()
    export_size: IntProperty()  # bytes of this model's last export, shown in the Entity panel
    # The stretch (non-uniform scale) a Push baked into the model: object matrix = entity matrix
    # times this. See space.unstretch.
    model_offset: FloatVectorProperty(size=(4, 4), subtype="MATRIX",
                                      default=((1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
    spawn_third_person: BoolProperty()  # a SpawnPoint's isDefaultThirdPerson, shown in the Entity panel
    spawn_free_cam: BoolProperty()  # and its isDefaultFreeCam
    model_edited: BoolProperty(
        name="Model edited",
        description="Re-export and upload this model on the next Push. Set automatically when you edit it",
    )


classes = (ArrivalPreferences, SpaceItem, WindowProps, ExportSettings, SceneProps, ObjectProps)


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
