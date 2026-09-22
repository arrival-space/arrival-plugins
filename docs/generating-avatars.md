# Avatars (`save_avatar`)

An avatar is a GLB. `save_avatar` takes one — a workspace path or any https URL — puts it in
the user's avatar list, and with `assign: true` puts it on them.

Nothing about the file is enforced and nothing is rejected. What it contains decides what it
does:

| the GLB | what the user gets |
|---|---|
| any mesh | worn as a rigid shape: it moves with them, it does not deform |
| skinned to the standard rig | walks, runs, sits, waves, talks — every stock animation |
| partially rigged (torso only, one arm, no legs) | the bones it has animate, the rest is rigid |

A floating cube, an armless torso and a full humanoid are all avatars. `save_avatar` reports
what the file turned out to contain: joints, how many standard bones it matched, triangles,
size.

## The standard rig

```
https://dzrmwng2ae8bq.cloudfront.net/avatar-parts/Wolf3D_Body/C87448.glb
```

321 KB, an https url like any other — a `files` input for `generate_model`. It holds the
**67-bone skeleton** every stock animation is authored against, one body mesh
(`Wolf3D_Body`), and empty placeholder nodes for the parts a modular avatar adds
(`Wolf3D_Head`, `EyeLeft`, …). Female proportions, same 67 bones:
`…/avatar-parts-female/Wolf3D_Body/57321F.glb`.

The stock animations bind **by bone name**. A skeleton with different names, or a different
hierarchy, plays none of them however well it is built.

## What the rig is

- **Blender is Z-up, 1 unit = 1 m**; the glTF exporter converts to Y-up.
- The avatar **faces -Y** in Blender (the toes point toward -Y).
- **Left is +X, right is -X**, mirrored exactly.
- Feet at **z = 0**, hips **z = 1.0192**, eyes **z ≈ 1.73**, top of head **z ≈ 1.86**.
  Overall height ~1.7 m, which is what the rest of the world is sized for: doorways ~2.1 m,
  maximum jump ~1.25 m.
- The rest pose is a relaxed **A-pose** — arms angled down and out, not a T-pose.

Bone heads in the rest pose (left side; negate x for the right):

| bone | parent | head (x, y, z) | length |
|---|---|---|---|
| `Hips` | — | 0, -0.01, 1.0192 | 0.0955 |
| `Spine` | `Hips` | 0, -0.0132, 1.1176 | 0.1305 |
| `Spine1` | `Spine` | 0, 0.0005, 1.2474 | 0.1218 |
| `Spine2` | `Spine1` | 0, 0.021, 1.3675 | 0.1489 |
| `Neck` | `Spine2` | 0, 0.0326, 1.5226 | 0.1226 |
| `Head` | `Neck` | 0, -0.0076, 1.6385 | 0.1241 |
| `HeadTop_End` | `Head` | 0, -0.0465, 1.8645 | 0.1241 |
| `LeftEye` | `Head` | 0.0304, -0.0906, 1.7257 | 0.1241 |
| `LeftShoulder` | `Spine2` | 0.0471, 0.0378, 1.5077 | 0.1189 |
| `LeftArm` | `LeftShoulder` | 0.1659, 0.0385, 1.5029 | 0.2851 |
| `LeftForeArm` | `LeftArm` | 0.3096, 0.0598, 1.2576 | 0.252 |
| `LeftHand` | `LeftForeArm` | 0.4496, -0.0311, 1.0688 | 0.042 |
| `LeftUpLeg` | `Hips` | 0.0953, -0.0069, 1.0245 | 0.4582 |
| `LeftLeg` | `LeftUpLeg` | 0.1255, -0.0009, 0.5673 | 0.4439 |
| `LeftFoot` | `LeftLeg` | 0.1521, 0.0418, 0.1264 | 0.1488 |
| `LeftToeBase` | `LeftFoot` | 0.1547, -0.0808, 0.042 | 0.0991 |

The other 50 are fingers (`LeftHandIndex1..4`, thumb, middle, ring, pinky), toe ends and
`*_end` tips. The armature itself has all of them:

```python
for b in arm.data.bones:
    print(b.name, b.parent.name if b.parent else None, list(b.head_local), b.length)
```

## Binding a mesh to it

Two approaches, both verified on this worker.

**Vertex groups at weight 1.0** — one primitive per bone, no solver involved, joints stay
hard-edged:

```python
import bpy, json, os
from mathutils import Vector

in_dir = os.environ['ARRIVAL_IN']
inputs = json.loads(os.environ['ARRIVAL_INPUTS'])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(in_dir, 'assets', inputs[0]))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in list(bpy.data.objects):          # the stock body mesh, if it is in the way
    if o.type == 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)

parts = []
for name, radius in [('Spine1', .14), ('LeftArm', .055), ('LeftForeArm', .05), ('LeftUpLeg', .085)]:
    b = arm.data.bones[name]
    p0, p1 = arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local
    d = p1 - p0
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius, depth=d.length, location=(p0 + p1) / 2)
    ob = bpy.context.active_object
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    ob.vertex_groups.new(name=name).add([v.index for v in ob.data.vertices], 1.0, 'REPLACE')
    parts.append(ob)

bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()                      # vertex groups survive the join
body = bpy.context.active_object
body.parent = arm
body.matrix_parent_inverse = arm.matrix_world.inverted()
body.modifiers.new('Armature', 'ARMATURE').object = arm

bpy.ops.export_scene.gltf(filepath='avatar.glb', export_format='GLB')
```

**Bone-heat automatic weights** — smooth deformation, and the solver needs geometry it can
reach: one connected, watertight mesh that encloses the bones. Separate floating pieces are
where it gives up.

```python
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

print('unweighted', sum(1 for v in body.data.vertices if sum(g.weight for g in v.groups) < 1e-4))
```

`There are more than 4 joint vertex influences` on export is normal: glTF keeps the 4
strongest and renormalizes.

## The avatar the user is already wearing

When they have one, the turn context carries `USER AVATAR: <url>`. It is an https url like
any other, so it is a `files` input for `generate_model` — the actual file, with the skinning
and proportions it already has. `inspect_model({ url })` reads what is in it without a Blender
job; a splat avatar or a VRM import is built differently from a modular one.

## Seeing the result

- `save_avatar` returns a `Preview:` url. That image comes from the avatar service: headless
  three.js, a three-light rig plus a neutral studio environment map, the idle clip, 256px.
- A space lights the same model with its **skybox** instead, so reflective surfaces are where
  the two differ most. In a space loaded with the browser tools,
  `app.userProfileData.loadCustomAvatar('<url>')` wears any https GLB in that page —
  client-side, nothing uploaded, nothing saved, gone when the page goes. It takes the url
  directly, so an avatar never has to be a space asset to be looked at. That session is its
  own account and does not pick up an avatar assigned to the user.
- In Blender here: `BLENDER_WORKBENCH` renders in ~0.2s on the CPU; EEVEE needs a GPU and
  fails. Deformation shows in a posed render and not in a rest render. The export writes the
  pose the rig is in, so posing after `export_scene.gltf` does not change the file.

## Constraints

- **Every person in a room downloads every other person's avatar.** A fully dressed stock
  avatar is ~5k triangles / 1.2 MB, most of it texture.
- A GLB written to `space/assets/` ships with the **space**, to every visitor, which is
  separate from being worn. `generate_model` returns the url of a model it did not save, and
  `save_avatar` takes a url.
- **Morph target 0 is driven by voice loudness** — a shape key that opens a mouth gives lip
  sync; no shape key, no lip sync.
- Principled BSDF survives the export: base colour, metallic, roughness, emission. glTF's
  default `metallicFactor` is **1.0**, so a material that never sets metallic is fully
  metallic — pure reflection, which looks like whatever is around it.
- The sandbox has no network and no GPU (see `find_docs("generate model blender")`).
