# Avatars: load one of the account's avatars into a scene, edit it, push it as a new avatar.
#
# An avatar is a GLB on the standard rig (the 67-bone "Armature" every stock animation binds to by
# bone name). A modular avatar from the customizer comes as that armature with one skinned mesh
# per part (head, eyes, teeth, body, top, bottom, footwear, hair). Push exports what the scene
# holds as ONE skinned mesh with its textures embedded, and `arrival avatar create` adds it to the
# account as a new avatar; the original stays as it is.
#
# What the app reads from the file (docs/generating-avatars.md): bones by name, and morph target 0,
# which voice loudness drives (the mouth), so the merged mesh keeps the mouth shape key first.

import os

import bpy

from . import space

MOUTH_KEY = "mouthOpen"  # the catalog head's name for it; baked avatars carry it as "target_0"


class AvatarError(Exception):
    pass


def armature(scene):
    arms = [o for o in scene.objects if o.type == "ARMATURE"]
    if len(arms) != 1:
        raise AvatarError("An avatar scene needs exactly one armature (the rig)" if arms else
                          "There's no armature: the avatar needs its rig to animate")
    return arms[0]


def import_glb(path):
    """Import an avatar GLB. The importer adds an Icosphere as the bones' display shape; it isn't
    part of the avatar."""
    before = set(bpy.data.objects)
    if "FINISHED" not in bpy.ops.import_scene.gltf(filepath=path):
        raise AvatarError("glTF import failed")
    new = [o for o in bpy.data.objects if o not in before]
    for ob in [o for o in new if o.type == "MESH" and o.name.startswith("Icosphere") and not o.parent
               and not o.data.materials]:
        new.remove(ob)
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in [c for c in bpy.data.collections if c.name.startswith("glTF_not_exported") and not c.all_objects]:
        bpy.data.collections.remove(coll)
    for ob in new:
        if ob.type == "MESH" and ob.data.shape_keys:
            keys = ob.data.shape_keys.key_blocks
            if len(keys) > 1 and keys[1].name == "target_0":
                keys[1].name = MOUTH_KEY
    return new


def guess_gender(parts):
    """The animation set for a customizer avatar (the API list has no gender): its head tells, as
    female-face-* vs male-face-* / face-default. Body ids exist in both catalogs, and hair ids say
    "male" on female avatars too."""
    parts = parts or {}
    head = str(parts.get("head") or "").lower()
    if head:
        return "female" if head.startswith("female") else "male"
    return "female" if any(str(v).lower().startswith("female") for v in parts.values()) else "male"


def _parts(scene, arm):
    """The meshes the avatar is made of: every visible, renderable mesh in the scene."""
    return [o for o in scene.objects if o.type == "MESH" and o.visible_get() and not o.hide_render]


def _bind_rigid(ob, arm):
    """A part that isn't skinned follows one bone: its parent bone, or the hips."""
    bone = ob.parent_bone if ob.parent is arm and ob.parent_type == "BONE" and ob.parent_bone in arm.data.bones else "Hips"
    if bone not in arm.data.bones:
        bone = arm.data.bones[0].name
    group = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
    group.add(range(len(ob.data.vertices)), 1.0, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


def build_merged(context, scene):
    """A temporary copy of the avatar as one skinned mesh parented to the rig, in rest pose.
    Returns (armature, merged object); remove it with discard()."""
    arm = armature(scene)
    parts = _parts(scene, arm)
    if not parts:
        raise AvatarError("There's nothing to push: the avatar has no visible mesh")
    for ob in parts:
        extra = [m.name for m in ob.modifiers if m.type != "ARMATURE" and m.show_render]
        if extra and ob.data.shape_keys:
            raise AvatarError(f"{ob.name} has shape keys and modifiers ({', '.join(extra)}): Blender can't apply "
                              "modifiers to a mesh with shape keys. Apply them, or remove the shape keys")

    coll = bpy.data.collections.new("Arrival avatar export")
    scene.collection.children.link(coll)
    view_layer = context.view_layer
    copies = []
    with space.suspended():
        for ob in parts:
            dup = ob.copy()
            dup.data = ob.data.copy()
            coll.objects.link(dup)
            copies.append(dup)
        view_layer.update()
        for dup in copies:
            deformed = any(m.type == "ARMATURE" and m.object is arm for m in dup.modifiers)
            with context.temp_override(object=dup, active_object=dup, selected_objects=[dup]):
                for mod in [m for m in dup.modifiers if m.type != "ARMATURE"]:
                    if mod.show_render:
                        bpy.ops.object.modifier_apply(modifier=mod.name)
                    else:
                        dup.modifiers.remove(mod)
            # Keep the world placement, then hang it under the rig like a skinned part.
            mw = dup.matrix_world.copy()
            if not deformed:
                _bind_rigid(dup, arm)
            dup.parent = arm
            dup.parent_type = "OBJECT"
            dup.matrix_world = mw
        # The mouth has to stay morph target 0: join into the part that has it.
        active = next((d for d in copies if d.data.shape_keys and MOUTH_KEY in d.data.shape_keys.key_blocks),
                      next((d for d in copies if d.data.shape_keys), copies[0]))
        with context.temp_override(active_object=active, object=active, selected_editable_objects=copies,
                                   selected_objects=copies):
            bpy.ops.object.join()
        merged = active
        merged.name = merged.data.name = "Avatar"
        keys = merged.data.shape_keys
        if keys and MOUTH_KEY in keys.key_blocks:
            order = list(keys.key_blocks).index(keys.key_blocks[MOUTH_KEY])
            merged.active_shape_key_index = order
            with context.temp_override(object=merged, active_object=merged):
                for _ in range(order - 1):
                    bpy.ops.object.shape_key_move(type="UP")
        mods = [m for m in merged.modifiers if m.type == "ARMATURE"]
        for extra in mods[1:]:
            merged.modifiers.remove(extra)
        if not mods:
            merged.modifiers.new("Armature", "ARMATURE").object = arm
        else:
            mods[0].object = arm
    return arm, merged, coll


def discard(coll):
    meshes = {o.data for o in coll.objects if o.type == "MESH"}
    for ob in list(coll.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.collections.remove(coll)
    for me in meshes:
        if me.users == 0:
            bpy.data.meshes.remove(me)


def export(context, path, settings=None):
    """Write the scene's avatar as one GLB: the rig, one merged skinned mesh, embedded textures."""
    scene = context.scene
    os.makedirs(os.path.dirname(path), exist_ok=True)
    arm, merged, coll = build_merged(context, scene)
    view_layer = context.view_layer
    prev_selected = [ob for ob in view_layer.objects if ob.select_get()]
    prev_active = view_layer.objects.active
    pose = arm.data.pose_position
    try:
        arm.data.pose_position = "REST"  # the file holds the rest pose; animations drive it
        view_layer.update()
        for ob in prev_selected:
            ob.select_set(False)
        arm.select_set(True)
        merged.select_set(True)
        max_size = int(settings.max_texture_size) if settings is not None else 0
        with space.suspended(), space._smaller_textures([merged], max_size):
            opts = {**space.export_options(settings), "export_skins": True, "export_morph": True,
                    "export_animations": False}
            result = bpy.ops.export_scene.gltf(
                filepath=path, export_format="GLB", use_selection=True, use_visible=False,
                use_renderable=False, use_active_collection=False, export_apply=True, export_yup=True, **opts,
            )
    finally:
        arm.data.pose_position = pose
        discard(coll)
        view_layer.update()  # the removed copies leave the view layer's list
        for ob in view_layer.objects:
            if ob is not None:
                ob.select_set(ob in prev_selected)
        view_layer.objects.active = prev_active
    if "FINISHED" not in result or not os.path.isfile(path):
        raise AvatarError("glTF export failed")
    return path
