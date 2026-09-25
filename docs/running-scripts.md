# Running Python scripts (`run_script`)

`run_script` runs a Python script in a sandbox on the worker. Use it for processing that
plugin code can't do: resizing, cropping or compositing images, slicing a sprite sheet,
generating a texture procedurally, converting audio or video, reading and reshaping a
JSON or CSV file, measuring a mesh. To *build* a 3D model, use `generate_model`
([generating-models.md](generating-models.md)) — it is the same sandbox with model-specific
handling.

## What is available

The script runs in Blender's Python, so `bpy` is importable too. Installed packages:

| Package | Import | For |
|---|---|---|
| Pillow | `from PIL import Image` | image load/save, resize, crop, draw, compose |
| numpy | `import numpy as np` | arrays, pixel maths |
| SciPy | `import scipy` | filters, interpolation, spatial |
| OpenCV (headless) | `import cv2` | image processing, contours, colour spaces |
| trimesh | `import trimesh` | load/measure/convert meshes without Blender |
| pygltflib | `import pygltflib` | read/patch glTF JSON directly |
| ffmpeg | `subprocess.run(["ffmpeg", ...])` | audio/video conversion, frame extraction |

No network, so no `pip install` and no downloads — work only with the packages above and
the files you pass in.

## Inputs and outputs

- `files`: workspace paths (`"assets/tex.png"`) or https URLs. They arrive in
  `$ARRIVAL_IN/assets/`; `$ARRIVAL_INPUTS` is a JSON list of their names in order.
- **The working directory is the output directory.** Write files with plain relative paths.
- Every file you write comes back as a permanent CDN URL in the result.
- `save`: the output names to keep in the space. Each is stored as `space/assets/<name>` —
  reference it as `"assets/<name>"` like any other asset. Unlisted outputs stay CDN-only.
- `print()` output comes back too, so a script that only measures something is fine.

```python
import json, os
from PIL import Image

src = json.loads(os.environ["ARRIVAL_INPUTS"])[0]
img = Image.open(os.path.join(os.environ["ARRIVAL_IN"], "assets", src)).convert("RGB")
img.resize((512, 512), Image.LANCZOS).save("floor_512.png")
print(img.size)
```

Call it with `files: ["assets/floor.png"]` and `save: ["floor_512.png"]`.

## Limits

Same sandbox as `generate_model`: no network, no GPU, 2 CPUs, 4 GB memory, a few minutes
per script. A turn has a limited number of script runs (separate from model generations) —
batch work into one script rather than one call per file.
