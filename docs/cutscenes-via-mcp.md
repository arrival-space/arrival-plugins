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
| `scale`      | `vec3`   | `{ x, y, z }`               | absolute local scale of the entity's `Render` child |

A `number` scale track sets `undefined` axes (NaN transforms, the model vanishes).
Scale is not applied to vibe plugin entities, gates or annotations: their scale
tracks are ignored. After playback each target keeps its last keyframe; nothing
restores the stored transform.

Rotation is a **quaternion**, not Euler. For a rotation of angle θ about an
axis `(ax, ay, az)`: `{ x: ax·sin(θ/2), y: ay·sin(θ/2), z: az·sin(θ/2), w: cos(θ/2) }`.
The runtime interpolates with Catmull-Rom; keep keyframe steps ≤ 90° so quat
interpolation never takes a shortcut in the wrong direction.

## Camera cutscenes (fly-throughs and space intros)

To move the **viewer's camera** rather than an object, key the sequence to the
reserved id **`main-camera`** (what the Sequence Editor writes for camera
tracks). It is not a scene entity, so there is nothing to create first.

| Property key | `type`   | `keyframeData`     | Notes |
|--------------|----------|--------------------|-------|
| `position`   | `vec3`   | `{ x, y, z }`      | Camera position in world space |
| `rotation`   | `quat`   | `{ x, y, z, w }`   | Camera orientation. The camera looks down **−Z** |
| `fov`        | `number` | degrees            | Optional |
| `scale`      | `vec3`   | `{ x:1, y:1, z:1 }`| The Sequence Editor writes it; you can omit it |

Sequence Editor exports also carry post-effect tracks such as `brightness`,
`contrast` and `saturation` on `main-camera`.

**An intro is just a camera cutscene with `autoPlay: true`** on its entity, set
the same way as [Auto-play and loop](#auto-play-and-loop) below. Nothing in
`room.json` is needed. The old `introCamSequence` room key is legacy, so leave
it alone.

### Look-at → quaternion

Authoring tools think in "camera at A looking at B". To convert that to a
quaternion with a level horizon (no roll):

```
f = normalize(target - eye)        // forward
z = -f                             // camera looks down -Z
x = normalize(cross(UP, z))
y = cross(z, x)
rotation = quat from the matrix with columns [x, y, z]
```

Two rules keep Catmull-Rom quaternion playback from spinning the wrong way:

- **Same hemisphere:** if `dot(q, prevQ) < 0`, negate `q`.
- **Small steps:** split any turn of more than ~60–90° between consecutive
  keyframes into in-between keyframes (slerp the rotation and lerp the position).
  A pull-back that swings from facing a planet to facing the Sun easily turns
  more than 150°.

### Pausing a camera tour for input

Give the `.path` a marker per stop with a stable `event` and a `payload`, e.g.
`{ "id": "stop-3", "frameNumber": 420, "label": "Earth", "event": "tour:stop", "payload": { "index": 3 } }`;
`.path` markers keep both fields. A companion vibe holds the cutscene on each one
and resumes on input:

```javascript
_onMarker({ marker }) {
    if (marker.event !== "tour:stop") return;
    this._cutscene.pauseCutscene();                  // open-ended hold
    this._waitingFor = marker.payload.index;         // show info, outline the target, ...
}

_onTargetClicked(index) {                            // from ArrivalSpace.onEntityClick
    if (index === this._waitingFor && this._cutscene.isCutscenePaused()) {
        this._waitingFor = -1;
        this._cutscene.resumeCutscene();
    }
}
```

Resolve the controller lazily, because the cutscene entity may load after the vibe:
retry `ArrivalSpace.getCutsceneScript(id)` from `update()` until it returns one.
An `autoPlay` intro can already be running by then, so check
`isCutscenePlaying()` / `isCutscenePaused()` when you find it.

Unverified, so test these in a live client:

- Whether the input lock a camera cutscene holds while paused also blocks
  `ArrivalSpace.onEntityClick`. Offer a 2D button as a fallback until it is confirmed.
- Whether `main-camera` keyframes are absolute world coordinates or relative
  to the cutscene entity. Placing the cutscene entity at the origin makes the
  two the same.

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

**`loop` and `autoPlay` are NOT part of the `.path` file.** The `Sequence`
schema is only `{ id, name, disabled, description, data }`, and `data` is only
`{ fps, entities, markers, disabledEntities? }` — there are **no playback flags
in the sequence**. Playback config lives on the **cutscene entity's JSON data**
(the `entity_data` you pass to `create_entity` / `update_entity`), not in the
`.path`:

```jsonc
// create_entity entity_data — playback config goes HERE, not in the .path
{ "displayName": "My Anim", "loop": true, "autoPlay": true }
```

The flag is **`autoPlay`, with a capital P**: that is what the in-app editor
saves on real cutscene entities. The `sequencePlayer` script attribute is
lowercase `autoplay`, but that is a different thing. Other entity fields seen on
saved cutscenes: `loop`, `seamlessInAndOut`, `displayName`, `scale`.

In a CLI workspace a cutscene entity looks like this. The `.path` goes in
`space/assets/` and is referenced by the `assets/<name>` token, which push
uploads:

```json
{
  "id": "my-intro",
  "type": "UserModelEntity",
  "data": {
    "glbUrl": "assets/my-intro.path",
    "displayName": "Intro",
    "autoPlay": true,
    "loop": false,
    "position": { "x": 0, "y": 0, "z": 0 },
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "scale": 1
  }
}
```

A lowercase `autoplay` on the entity is ignored. With `autoPlay: true` the
cutscene starts as the space's intro, right after the loading screen hides; that
is how a space intro is made (see
[Camera cutscenes](#camera-cutscenes-fly-throughs-and-space-intros)).
`CutsceneScript.setData({ loop })` / `getLoop()` control looping at runtime.

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
