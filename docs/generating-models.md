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

Input assets, when the tool was given any, are under `$ARRIVAL_IN/assets/`.

## Sandbox limits

- **No network.** No downloading textures, HDRIs or reference models. Generate textures
  with `generate_image` instead.
- **No GPU.** `EEVEE` fails — render previews with `CYCLES` at low samples.
- Nothing outside the output directory is writable.

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
