# Generating avatars (`save_avatar`)

An avatar here is just a **GLB**. `save_avatar` takes one — from `generate_model`, from an
edit of the one the user is wearing, or from any https URL — adds it to their avatar list
and, with `assign: true`, puts it on them right away.

Nothing about the file is enforced. There are three levels of "works", and all three are
legitimate results:

| what you hand it | what the user gets |
|---|---|
| any mesh | worn as a rigid shape — it moves with them, it does not animate |
| a mesh **skinned to the standard rig** | walks, runs, sits, waves, talks: every stock animation |
| a **partial** rig (torso only, one arm, no legs) | the bones it has animate, the rest stays put |

A floating cube, an armless torso and a full humanoid are all fine. Pick the level the
request actually needs — a chrome sphere that hovers is a perfectly good avatar, and skinning
it to a skeleton it doesn't have would be wasted work.

`save_avatar` reports what your file contains (joints found, how many standard bones it
matched, triangles, size). That is **information to react to, not a check you can fail**.

## The standard rig

One https URL, hand it to `generate_model` as a `files` input:

```
https://dzrmwng2ae8bq.cloudfront.net/avatar-parts/Wolf3D_Body/C87448.glb
```

321 KB. It contains the **67-bone skeleton** every stock animation is authored against, one
body mesh (`Wolf3D_Body`) you can keep, replace or delete, and a few empty placeholder nodes
for the parts a modular avatar would add (`Wolf3D_Head`, `EyeLeft`, …) which you can delete.

For the female proportions of the same 67 bones, use
`…/avatar-parts-female/Wolf3D_Body/57321F.glb`.

**Do not rebuild the skeleton from the table below.** Import the rig, keep its armature, name
for name — that is what makes animation work. The table is for placing *your* geometry.

## Facts about that rig

- **Blender is Z-up, 1 unit = 1 m.** The exporter converts to glTF's Y-up on the way out.
- The avatar **faces -Y** in Blender (toes point toward -Y). Build things facing -Y.
- **Left is +X, right is -X** — mirrored exactly, so build one side and mirror.
- Feet at **z = 0**, hips at **z = 1.0192**, eyes at **z ≈ 1.73**, top of head **z ≈ 1.86**.
  Overall height ~1.7 m: the whole world — doorways, chairs, jump height — is built for it.
- The rest pose is a relaxed A-pose, arms angled down and out. Your mesh has to be built
  **around the rig in that pose**, not in a T-pose.

Rest positions of the bone heads (left side; negate x for the right):

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
`*_end` tips. Read them straight off the armature instead of guessing:

```python
for b in arm.data.bones:
    print(b.name, b.parent.name if b.parent else None, list(b.head_local), b.length)
```

## Two ways to bind

Both are proven on the worker. Pick by the kind of body you are making.

### Rigid parts — robots, armour, anything with hard joints

One primitive per bone, weight 1.0. No solver, nothing to go wrong, and it reads as
mechanical *because* it is.

```python
import bpy, json, os
from mathutils import Vector

in_dir = os.environ['ARRIVAL_IN']
inputs = json.loads(os.environ['ARRIVAL_INPUTS'])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(in_dir, 'assets', inputs[0]))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in list(bpy.data.objects):          # keep the skeleton, drop the stock body
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

### Automatic weights — creatures, characters, anything that should bend

Build **one closed mesh** over the skeleton and let bone-heat weighting do the rest. Metaballs
are a cheap way to get a watertight body; a sculpted or box-modelled mesh works the same way.

```python
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
```

The solver needs geometry it can reach: one connected, watertight mesh that actually encloses
the bones. Separate floating pieces are where it gives up — those want the rigid recipe.
Check the result yourself before shipping it:

```python
print('unweighted', sum(1 for v in body.data.vertices if sum(g.weight for g in v.groups) < 1e-4))
```

`There are more than 4 joint vertex influences` on export is normal — glTF keeps the 4
strongest and renormalizes.

### Editing the avatar they already wear

The turn context gives you `USER AVATAR: <url>` when the user has one. Hand that URL to
`generate_model` as a `files` input and you get their actual avatar in Blender — add a hat,
recolour the shirt, swap a head — with the skinning and proportions that already worked.
This is the cheapest good result available, so prefer it whenever the request is a *change*
to how they look rather than a new body.

`inspect_model({ url })` on that same URL tells you what you are about to edit — meshes,
triangles, height, how much of the rig it has — for free, without a Blender run. Do that
first: a splat avatar or a VRM import is a different animal from a modular one, and it is
better to find that out before writing a script around the wrong assumption.

## Look at it before you save it

The sandbox has no GPU but `BLENDER_WORKBENCH` renders in a fraction of a second on the CPU —
fast enough to pose the rig and look at the result every time. Weight problems are obvious in
a posed render and invisible in a rest render, so **pose it**:

```python
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x, scene.render.resolution_y = 420, 620
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
bpy.context.scene.collection.objects.link(cam)
scene.camera = cam
cam.location, cam.rotation_euler = (0, -3.1, 0.95), (1.5708, 0, 0)

import math
pb = arm.pose.bones['LeftArm']; pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, math.radians(-55))
pb = arm.pose.bones['RightForeArm']; pb.rotation_mode = 'XYZ'; pb.rotation_euler = (math.radians(-85), 0, 0)
bpy.context.view_layer.update()
scene.render.filepath = os.path.join(os.environ['ARRIVAL_OUT'], 'renders/posed.png')
bpy.ops.render.render(write_still=True)
```

Render the pose **after** exporting the GLB — the export should carry the rest pose.
`view_image` the URL that comes back. `save_avatar` also returns a `Preview:` URL: a proper
three-point render of the saved avatar in its idle animation, which is the same image the
user sees in their avatar list.

## Details worth knowing

- **Keep the armature.** Deleting it, renaming its bones, or rotating/scaling the armature
  object breaks the retarget — the stock animations bind **by bone name**.
- **Don't apply modifiers at export** (`export_apply=True`) on a skinned mesh. Apply what you
  need *before* binding.
- **Mouth movement** comes from the first shape key on a mesh: morph target 0 is driven by
  voice loudness. Add one that opens a mouth and the avatar lip-syncs; skip it and it doesn't.
- **Materials**: Principled BSDF — base colour, metallic, roughness and emission all survive.
  A generated texture (`generate_image`) can be applied in Blender and baked into the GLB.
- **The preview is not the space.** `save_avatar`'s `Preview:` is rendered by the avatar
  service: headless three.js, a three-light rig plus a neutral studio environment map. A
  space lights the same model with its own skybox. Reflective surfaces are where the two
  differ most — the preview is a studio shot, not the room. Load the space in the browser
  when the exact look matters.
- **Budget**: every person in a room downloads every other person's avatar. Stay under
  ~30k triangles and ~2 MB. A fully dressed stock avatar is ~5k triangles / 1.2 MB, most of
  it texture — that is the bar to beat, not 30k.
- An avatar is **not** a space asset. Don't write it into `space/assets/` — that would ship it
  to every visitor of the space as well. Pass `generate_model` no `path`, take the URL it
  reports back, and give that to `save_avatar`.
