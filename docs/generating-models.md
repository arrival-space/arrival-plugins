# Generating 3D models (`generate_model`)

You know Blender. This page is only the things that are specific to running it *here*.

## How output works

**Your working directory is the output directory.** Write files with plain relative
paths and they all come back:

```python
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
# ... build geometry ...
bpy.ops.export_scene.gltf(filepath='urn.glb', export_format='GLB', export_apply=True)
```

- The **first `.glb`** becomes the space asset, at the `path` you passed to the tool.
- **Everything else you write comes back as a URL** — a preview render, a stats JSON,
  alternate variants. Nested directories are fine. Nothing is thrown away.
- `print()` output comes back too, and so does the full traceback if the script raises.
  Read it and fix the script rather than guessing.
- `$ARRIVAL_OUT` holds the same directory as an absolute path, if you want it.

### Images are the one exception: give them a directory

`export_scene.gltf`, `save_as_mainfile` and python's `open()` all take a bare
`'name.ext'`. **Blender's image writer does not.** With no directory component it tries
to create a directory called `''` and the render fails with
`Couldn't create directory for file preview.png` — whether or not a `.blend` has been
saved, and for `Image.save_render()` as well as `bpy.ops.render.render()`.

```python
out = os.environ['ARRIVAL_OUT']
scene.render.filepath = os.path.join(out, 'preview.png')   # ✅
scene.render.filepath = 'renders/preview.png'              # ✅ a subdirectory is enough
scene.render.filepath = 'preview.png'                      # ❌ fails
```

### A failure after the export does not lose the model

If the script exports a valid `.glb` and then raises, the model is still saved and you
still get the error and the traceback — fix what failed afterwards, and only re-run if
the model itself is wrong. A `.glb` that is incomplete (the script died *during* export)
is refused, and the tool says so.

A script that deliberately produces no model at all is fine too: omit `path` and use it
purely to render. You get the output URLs back, and those are permanent CDN URLs you can
`view_image` or use directly in plugin code.

For the basics — triangles, size in metres, materials, skeleton, shape keys — use
`inspect_model({ path })` instead: it reads the file header, costs nothing and takes no
generation, on a workspace asset or any https URL.

Blender is still the **measuring tool** for what the header does not hold (open edges, UVs,
per-object bounds). A script that imports a model, prints what it finds and writes nothing is
a normal call — `print()` output comes back either way, so measure first and then decide
what to cut:

```python
obj = bpy.context.scene.objects['Urn']
print('verts', len(obj.data.vertices), 'bounds z', min(v.co.z for v in obj.data.vertices),
      max(v.co.z for v in obj.data.vertices))
```

## Editing something you already have

Pass `files` to hand the script existing assets — workspace paths
(`space/assets/room.glb`), the token form (`assets/room.glb`), or https URLs. They arrive
in `$ARRIVAL_IN/assets/`, in the order you listed them, with their names in
`$ARRIVAL_INPUTS`:

```python
in_dir = os.environ['ARRIVAL_IN']
inputs = json.loads(os.environ['ARRIVAL_INPUTS'])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(in_dir, 'assets', inputs[0]))
# ... split, decimate, re-material, measure ...
bpy.ops.export_scene.gltf(filepath='chairs.glb', export_format='GLB')
```

Use this instead of rebuilding a model from the script that first made it — rebuilding
costs another generation and the result drifts from what is already in the space.

## Sandbox limits

- **No network.** No downloading textures, HDRIs or reference models. Generate textures
  with `generate_image` instead.
- **No GPU.** `EEVEE` fails — render previews with `CYCLES` at low samples.
- Nothing outside the output directory is writable.
- Besides `bpy`, Blender's Python has Pillow, numpy, SciPy, OpenCV (headless), trimesh,
  pygltflib and the `ffmpeg` binary — e.g. build or post-process a texture with PIL in the
  same script. For image/data work that produces no model, use `run_script`
  ([running-scripts.md](running-scripts.md)).

## Getting the size right

**1 Blender unit = 1 metre**, and the space is metric. This is the most common way a
generated prop lands unusable:

| | |
|---|---|
| avatar height | ~1.7 m |
| max jump height | **~1.25 m** — anything a visitor must hop onto stays under this |
| doorway | ~2.1 m |
| table | ~0.75 m |
| chair seat | ~0.45 m |

Put the model's base at **z = 0** and centre it on x/y, so it sits on the floor and
rotates about itself. The exporter handles Z-up → Y-up; build Z-up as normal.

## Budget

Every visitor downloads this on every space load. Stay under roughly **50k triangles**
and **2 MB**. Subdivision is exponential — level 2 is nearly always enough.

Hard limits, separate from that budget:

| | |
|---|---|
| file in `space/assets/` | **256 MB**. A larger file is not uploaded on save, and nothing that references it is saved either |
| workspace file passed in `files` | 256 MB |
| total output of one run | 512 MB |

## Using the result

Reference it as the literal token and load it with `createModel`, which also makes it
clickable-to-edit in the editor:

```javascript
const { entity } = await this.createModel('assets/urn.glb', { position: [0, 0, 0] });
```

Give meshes a Principled BSDF material — base colour, metallic, roughness and emission
all survive the export. For a **patterned** surface, prefer generating the texture with
`generate_image` and applying it via `ArrivalSpace.loadTexture`: that keeps it swappable
in the editor, where baking it into the GLB does not.

To iterate, call `generate_model` again with the **same path**; references update on save.
