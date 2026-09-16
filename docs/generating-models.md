# Generating 3D models (`generate_model`)

Build geometry by running a Blender Python script on the worker. The script exports a
`.glb`, the tool saves it under `space/assets/`, and on save it becomes a CDN URL.

**Reach for this when plugin-code primitives can't express the shape**: curved or organic
forms, bevelled edges, subdivision surfaces, repeated/arrayed parts, boolean cuts, lathed
profiles (bottles, columns, vases), 3D text. For a plain box, sphere or cylinder, just build
it in the plugin with `pc.Entity` + a render component — that's cheaper and stays editable.

---

## The contract

- Your script gets the output directory in **`os.environ['ARRIVAL_OUT']`**.
- It **must export exactly one `.glb`** there. Anything else it writes (a preview render,
  a stats file) comes back as extra URLs you can `view_image`.
- It runs **sandboxed**: no network, no filesystem outside the output dir. `import bpy`,
  `math`, `json`, `os`, `random` are all fine. Downloading a texture or a reference model
  is not — generate textures with `generate_image` instead.
- Start from an **empty scene**. `--factory-startup` still gives you the default cube.

## Template

```python
import bpy, os, math

out = os.environ['ARRIVAL_OUT']
bpy.ops.wm.read_factory_settings(use_empty=True)   # ALWAYS: otherwise you ship the default cube

# ... build geometry ...

bpy.ops.export_scene.gltf(
    filepath=os.path.join(out, 'model.glb'),
    export_format='GLB',
    export_apply=True,          # bake modifiers into the exported mesh
)
```

Then reference it from plugin code by the literal token:

```javascript
const { entity } = await this.createModel('assets/model.glb', { position: [0, 0, 0] });
```

Use `this.createModel` rather than `ArrivalSpace.loadGLB` — it makes the model
clickable-to-edit in the editor. See [api-reference.md](./api-reference.md).

---

## Scale and orientation

**1 Blender unit = 1 metre, and the space is metric.** Get this right or the model lands
comically wrong:

| | |
|---|---|
| avatar height | ~1.7 m |
| max jump height | ~1.25 m — anything a visitor must hop onto stays under this |
| table / desk | ~0.75 m tall |
| doorway | ~2.1 m tall |
| chair seat | ~0.45 m |

The glTF exporter converts Blender's Z-up to glTF's Y-up for you. Build Z-up as normal and
the model arrives upright. Put the model's base at **z = 0** so it sits on the floor when
placed at y = 0, and centre it on x/y so it rotates about itself.

## Materials

Give every mesh a material — an unmaterialed mesh renders flat grey.

```python
mat = bpy.data.materials.new('Brass')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (0.72, 0.45, 0.20, 1.0)
bsdf.inputs['Metallic'].default_value = 1.0
bsdf.inputs['Roughness'].default_value = 0.35
obj.data.materials.append(mat)
```

Principled BSDF base colour, metallic, roughness and emission all survive the round trip.
For a patterned surface, generate the texture with `generate_image` and apply it in the
plugin via `ArrivalSpace.loadTexture` — that keeps the texture swappable in the editor,
where baking it into the GLB does not.

## Keep it light

Every visitor downloads this on every space load. Aim for **under ~50k triangles** and a
GLB **under ~2 MB**. Subdivision levels are exponential — level 2 is almost always enough;
level 4 is a hundred-megabyte mistake.

---

## Recipes

**Bevelled edges** (the single biggest "looks designed, not programmer-art" win):

```python
bpy.ops.mesh.primitive_cube_add(size=1)
obj = bpy.context.active_object
bev = obj.modifiers.new('Bevel', 'BEVEL')
bev.width, bev.segments = 0.02, 3
```

**Smooth organic form** — subdivision + shade smooth:

```python
sub = obj.modifiers.new('Subdiv', 'SUBSURF')
sub.levels = sub.render_levels = 2
bpy.ops.object.shade_smooth()
```

**Repeat a part** (fence posts, railings, columns):

```python
arr = obj.modifiers.new('Array', 'ARRAY')
arr.count = 12
arr.relative_offset_displace = (1.5, 0, 0)
```

**Cut a hole** — boolean against a second object:

```python
bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=2)
cutter = bpy.context.active_object
boo = target.modifiers.new('Cut', 'BOOLEAN')
boo.operation, boo.object = 'DIFFERENCE', cutter
bpy.context.view_layer.objects.active = target
bpy.ops.object.modifier_apply(modifier='Cut')
bpy.data.objects.remove(cutter, do_unlink=True)   # or it exports too
```

**Lathe a profile** (vase, goblet, column) — build a 2D profile, then spin:

```python
import bmesh
mesh = bpy.data.meshes.new('Profile')
obj = bpy.data.objects.new('Vase', mesh)
bpy.context.collection.objects.link(obj)
bm = bmesh.new()
prev = None
for z, r in [(0.0, 0.18), (0.1, 0.10), (0.4, 0.26), (0.8, 0.20), (1.0, 0.13)]:
    v = bm.verts.new((r, 0, z))
    if prev: bm.edges.new((prev, v))
    prev = v
bmesh.ops.spin(bm, geom=bm.verts[:] + bm.edges[:], axis=(0, 0, 1),
               cent=(0, 0, 0), angle=math.radians(360), steps=48, use_merge=True)
bm.to_mesh(mesh); bm.free()
```

**3D text:**

```python
bpy.ops.object.text_add()
txt = bpy.context.active_object
txt.data.body = 'ARRIVAL'
txt.data.extrude = 0.05
txt.data.align_x = 'CENTER'
bpy.ops.object.convert(target='MESH')   # export needs a mesh, not a font curve
```

## Check your work

The sandbox has **no GPU**, so `EEVEE` fails — render previews with `CYCLES` (CPU) at low
samples, then `view_image` the result:

```python
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.filepath = os.path.join(out, 'preview.png')
bpy.ops.object.camera_add(location=(3, -3, 2), rotation=(1.1, 0, 0.785))
scene.camera = bpy.context.active_object
bpy.ops.object.light_add(type='SUN', location=(4, -4, 6))
bpy.ops.render.render(write_still=True)
```

Also `print()` your vertex counts and bounding box — stdout comes back with the result:

```python
print('verts', len(obj.data.vertices), 'dims', tuple(round(d, 2) for d in obj.dimensions))
```

## When it fails

A script error returns the **traceback and your stdout**, so read it and fix the script —
don't guess. The usual causes: forgetting `read_factory_settings(use_empty=True)`, an
operator running on the wrong active object, or exporting a curve/text object without
converting it to a mesh.

To iterate, call `generate_model` again with the **same path** — references update
automatically on save.
