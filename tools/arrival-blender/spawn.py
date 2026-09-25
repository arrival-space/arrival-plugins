# How a SpawnPoint entity looks in Blender.
#
# The client only draws spawn points while the space is being edited: a yellow arrow along the
# entity's forward (-Z in PlayCanvas, +Y here) and a yellow sphere to click (spawn-point-entity.js).
# Here a spawn point is a mesh object in entity-local Blender axes (forward +Y, up +Z) that only
# carries the placement; its geometry is never pushed. Its shape follows `capturedIn`:
#   avatar   (default) the character root on the ground: a ring and an arrow on the floor, and
#            an avatar-sized wire figure (an unselectable child) for scale.
#   freeCam  the flying camera at eye height: a camera pyramid looking forward, tilting with pitch.
# Spawn points holding a default role (isDefaultThirdPerson / isDefaultFreeCam) are the client's
# yellow; the others are dimmed.

import math

import bmesh
import bpy
from mathutils import Matrix

YELLOW = (1.0, 0.85, 0.0, 1.0)  # the client's marker color
DIM = (0.45, 0.4, 0.25, 1.0)

AVATAR_HEIGHT = 1.8


def _ring(bm, r0, r1, z, segments=40):
    inner, outer = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        inner.append(bm.verts.new((r0 * math.cos(a), r0 * math.sin(a), z)))
        outer.append(bm.verts.new((r1 * math.cos(a), r1 * math.sin(a), z)))
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((inner[i], outer[i], outer[j], inner[j]))


def _prism(bm, outline, z0, z1):
    """A flat 2D outline (counter-clockwise, seen from above) extruded from z0 to z1."""
    bottom = [bm.verts.new((x, y, z0)) for x, y in outline]
    top = [bm.verts.new((x, y, z1)) for x, y in outline]
    bm.faces.new(top)
    bm.faces.new(reversed(bottom))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))


def _avatar_marker(bm):
    _ring(bm, 0.36, 0.42, 0.005)
    # An arrow on the floor from the centre out past the ring, pointing forward.
    _prism(bm, [(-0.05, 0.0), (0.05, 0.0), (0.05, 0.5), (0.16, 0.5), (0.0, 0.78), (-0.16, 0.5), (-0.05, 0.5)],
           0.0, 0.04)


def _figure(bm):
    body = AVATAR_HEIGHT - 0.3
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.2, radius2=0.2, depth=body,
                          matrix=Matrix.Translation((0, 0, body / 2)))
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.13,
                              matrix=Matrix.Translation((0, 0, AVATAR_HEIGHT - 0.14)))
    # A visor, so the figure shows its facing from any side.
    _prism(bm, [(-0.07, 0.1), (0.07, 0.1), (0.07, 0.18), (-0.07, 0.18)], AVATAR_HEIGHT - 0.18, AVATAR_HEIGHT - 0.1)


def _camera_marker(bm):
    # A pyramid from the eye (the origin) to a 16:9 frame ahead, and a triangle marking up.
    d, w, h = 0.5, 0.32, 0.18
    apex = bm.verts.new((0, 0, 0))
    frame = [bm.verts.new(co) for co in ((-w, d, -h), (w, d, -h), (w, d, h), (-w, d, h))]
    for i in range(4):
        bm.faces.new((apex, frame[i], frame[(i + 1) % 4]))
    bm.faces.new(reversed(frame))
    tri = [bm.verts.new(co) for co in ((-w * 0.6, d, h + 0.03), (w * 0.6, d, h + 0.03), (0, d, h + 0.2))]
    bm.faces.new(tri)
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.06, matrix=Matrix.Identity(4))


SHAPES = {"avatar": _avatar_marker, "figure": _figure, "freeCam": _camera_marker}


def _mesh(shape):
    """Shared by every spawn point of that shape. Recreated if it was removed."""
    for me in bpy.data.meshes:
        if me.get("arrival_spawn") == shape:
            return me
    bm = bmesh.new()
    SHAPES[shape](bm)
    me = bpy.data.meshes.new(f"Arrival Spawn Point ({shape})")
    bm.to_mesh(me)
    bm.free()
    me["arrival_spawn"] = shape
    return me


def _material(active):
    key = "default" if active else "other"
    for mat in bpy.data.materials:
        if mat.get("arrival_spawn") == key:
            return mat
    color = YELLOW if active else DIM
    mat = bpy.data.materials.new("Arrival Spawn Point" if active else "Arrival Spawn Point (not default)")
    mat["arrival_spawn"] = key
    mat.diffuse_color = color  # Solid view
    if mat.node_tree is None:  # Blender < 5
        mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Emission Color"].default_value = color
    bsdf.inputs["Emission Strength"].default_value = 1.0
    return mat


def _with_material(ob, mat):
    if not ob.material_slots:
        ob.data.materials.append(None)
    ob.material_slots[0].link = "OBJECT"  # the mesh is shared; the color is per spawn point
    ob.material_slots[0].material = mat


def build(coll, name, data):
    """The spawn point's root object. Children are display only (not selectable)."""
    captured = "freeCam" if data.get("capturedIn") == "freeCam" else "avatar"
    active = bool(data.get("isDefaultThirdPerson") or data.get("isDefaultFreeCam"))
    mat = _material(active)
    root = bpy.data.objects.new(name, _mesh(captured))
    coll.objects.link(root)
    _with_material(root, mat)
    root.show_in_front = True  # a floor marker would otherwise sink into the ground it stands on
    if captured == "avatar":
        figure = bpy.data.objects.new(name + " (figure)", _mesh("figure"))
        coll.objects.link(figure)
        _with_material(figure, mat)
        figure.parent = root
        figure.display_type = "WIRE"
        figure.hide_select = True
        figure.hide_render = True
    root.hide_render = True  # an editor helper, like in the app
    return root
