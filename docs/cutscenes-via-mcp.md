# Creating Cutscenes Headlessly (CLI / MCP) — `.path` files

> **TL;DR:** A cutscene/animation can be created **without the in-app Sequence
> Editor and without a plugin**. Serialize a [`Sequence`](sequences.md#sequence-shape)
> object to a **`.path`** file, upload it, and create an entity from it. The
> `.path` file *is* the cutscene. This is the right tool when an agent (MCP) or
> the CLI needs to author animation programmatically.

Most of `docs/sequences.md` describes the runtime (`sequencePlayer`) and the
in-app editor. This page covers the one thing that isn't obvious: **how to
create a persisted cutscene entity from outside the client.**

## When to use this vs a plugin

| You want… | Use |
|-----------|-----|
| An object to move / rotate / spin / fly along a path, no interaction | **Cutscene (`.path`)** — this page |
| Camera fly-through / scripted beats with markers | **Cutscene (`.path`)** |
| Custom logic, input handling, UI, physics, per-frame decisions | **Plugin / vibe** (`.mjs`) |

If the request is just "animate/move this thing" and the method isn't
specified, prefer a cutscene. If it's ambiguous whether interactivity is
needed, ask the user: **vibe/plugin or sequence-editor/cutscene?**

## The flow

A `.path` file is a first-class asset type, exactly like `.mjs` → plugin and
`.png` → image. Creating an entity from a `.path` resource makes a **cutscene
entity** (the server stores it as a `UserModelEntity` whose `glbUrl` is the
`.path` URL; the client recognizes the extension and runs it as a cutscene).

1. **Build a `Sequence` object** (see [Sequence Shape](sequences.md#sequence-shape)).
   Key it to the entity you want to animate:
   `data.entities["<targetEntityId>"] = { position: {...}, rotation: {...} }`.
2. **Upload it as a `.path` text file** → `upload_text_file({ file_name: "my-anim.path", file_text })`
   (or `upload_file_from_url`). Returns a `resource_key`.
3. **Create the cutscene entity** → `create_entity({ spaceId, resource_key, entity_id })`.
   The server resolves the `resource_key` to a CDN `glbUrl` automatically.

The animation is "attached" to its target purely by the **entity id used as the
key inside `data.entities`** — so create the target entity first (with an
explicit `entity_id` you control) and reuse that id in the `.path`.

## Property keys and types

Each entry under `data.entities["id"]` is a [`SequenceProperty`](sequences.md#sequence-shape):

| Property key | `type`   | `keyframeData` shape        | Applied as |
|--------------|----------|-----------------------------|------------|
| `position`   | `vec3`   | `{ x, y, z }`               | local position |
| `rotation`   | `quat`   | `{ x, y, z, w }`            | local rotation |
| `scale`      | `number` | `number`                    | uniform scale |

Rotation is a **quaternion**, not Euler. For a rotation of angle θ about an
axis `(ax, ay, az)`: `{ x: ax·sin(θ/2), y: ay·sin(θ/2), z: az·sin(θ/2), w: cos(θ/2) }`.
The runtime interpolates with Catmull-Rom; keep keyframe steps ≤ 90° so quat
interpolation never takes a shortcut in the wrong direction.

## Minimal example

A 4-second loop that lifts an entity 1 m and back:

```json
{
  "id": "bob-seq",
  "name": "Bob Up And Down",
  "disabled": false,
  "data": {
    "fps": 30,
    "entities": {
      "my_entity_id": {
        "position": {
          "id": "position", "label": "Position", "type": "vec3",
          "keyframes": [
            { "id": "p0", "frameNumber": 0,  "keyframeData": { "x": 0, "y": 1, "z": 0 } },
            { "id": "p1", "frameNumber": 60, "keyframeData": { "x": 0, "y": 2, "z": 0 } },
            { "id": "p2", "frameNumber": 120, "keyframeData": { "x": 0, "y": 1, "z": 0 } }
          ]
        }
      }
    },
    "markers": []
  }
}
```

## Recipe: spin an image on one of its corners

Rotating an entity spins it about **its own origin** (an image's center), not a
corner. To pivot on a **corner**, drive `position` *and* `rotation` together so
the corner stays pinned at a fixed world point `P`:

```
center(θ) = P + Rz(θ) · d           rotation(θ) = quat( Z, θ )
```

where `d = (halfW, halfH, 0)` is the local vector from the corner to the center,
and `Rz(θ)` is a rotation about the image's normal (Z). Bake a keyframe every
30° for a full revolution (13 keyframes, closing the loop) and the corner holds
still while the picture pinwheels.

- `d` requires the image plane's **world half-size**. Arrival sizes an image
  plane from its `scale`; if the pivot ends up slightly off the corner, adjust
  `halfW/halfH` (or the image `scale`) and re-bake — verify in a live client.
- A complete, working `.path` for this is in
  [`examples/spin-image.path`](../examples/spin-image.path) (targets an image
  entity whose id is `spin_image`).

## Auto-play and loop

**`loop` and `autoplay` are NOT part of the `.path` file.** The `Sequence`
schema is only `{ id, name, disabled, description, data }`, and `data` is only
`{ fps, entities, markers, disabledEntities? }` — there are **no playback flags
in the sequence**. Playback config lives on the **cutscene entity's JSON data**
(the `entity_data` you pass to `create_entity` / `update_entity`), not in the
`.path`:

```jsonc
// create_entity entity_data — playback config goes HERE, not in the .path
{ "name": "My Anim", "loop": true, "autoplay": true, "targetEntityId": "my_entity_id" }
```

`CutsceneScript.setData({ loop })` / `getLoop()` control looping at runtime.
Whether a cutscene starts automatically on space load (vs. needing a trigger) is
client-driven — **verify in a live client**.

## Gotchas

- **Target id must match.** The key in `data.entities` must equal the target
  entity's real `entity_id`. Create the target first with an explicit id.
- **`get_space_screenshot` only returns an image after the space has been
  opened in a live client** — a freshly created space has no screenshot.
- `.path` files are JSON, so **no comments** are allowed inside them.
- The target entity's own stored `position`/`rotation` is what shows when the
  cutscene isn't playing — set it to match keyframe 0 so it looks right at rest.

## See also

- [Sequences & Cutscenes](sequences.md) — full runtime API, sequence shape, markers, reverse/loop.
- [`examples/spin-image.path`](../examples/spin-image.path) — worked corner-spin example.
- [`examples/animation-reverse-sequencer.mjs`](../examples/animation-reverse-sequencer.mjs) — plugin that plays/reverses cutscene entities.
