# Sequences & Cutscenes

> **Terminology:** "sequence", "cutscene", and "animation" all refer to the same
> system in Arrival.Space — keyframe data played by `sequencePlayer`. If a prompt
> asks for an animation, a cutscene, an animated object, or a camera fly-through,
> this is the system to use. Authored cutscenes are reached via
> `ArrivalSpace.getCutsceneScript(entityId)`; code-driven animation uses
> `sequencePlayer` directly.

`sequencePlayer` is the built-in runtime for keyframe animation in Arrival.Space. It powers camera cutscenes, animated objects, marker-driven events, and the visual Sequence Editor in the main client.

The current sequence model is **entity-aware**:

- one sequence can animate multiple entities
- each entity owns its own property tracks
- markers are timeline events you can react to during playback

## Quick Start

```javascript
const playerEntity = this.entity;
const cube = new pc.Entity("OrbitCube");
cube.addComponent("render", { type: "box" });
playerEntity.addChild(cube);

const sequencePlayer = playerEntity.script.sequencePlayer ?? playerEntity.script.create("sequencePlayer");

sequencePlayer.setAdapter("position", (value) => {
    cube.setLocalPosition(value.x, value.y, value.z);
}, { entityId: "orbit-cube", type: "vec3", label: "Position" });

sequencePlayer.setGetter("position", () => {
    const pos = cube.getLocalPosition();
    return { x: pos.x, y: pos.y, z: pos.z };
}, { entityId: "orbit-cube" });

sequencePlayer.on("sequence:marker", ({ marker }) => {
    console.log("Marker hit:", marker.label, marker.frameNumber);
});

sequencePlayer.playSequence(mySequence);
```

## Sequence Shape

```javascript
const sequence = {
    id: "my-sequence",
    name: "My Sequence",
    disabled: false,
    data: {
        fps: 30,
        entities: {
            "main-camera": {
                position: {
                    id: "position",
                    label: "Position",
                    type: "vec3",
                    keyframes: [
                        { id: "p0", frameNumber: 0, keyframeData: { x: 0, y: 3, z: 10 } },
                        { id: "p1", frameNumber: 120, keyframeData: { x: 3, y: 2, z: 0 } },
                    ],
                },
                fov: {
                    id: "fov",
                    label: "FOV",
                    type: "number",
                    minValue: 15,
                    maxValue: 120,
                    keyframes: [
                        { id: "f0", frameNumber: 0, keyframeData: 70 },
                        { id: "f1", frameNumber: 120, keyframeData: 55 },
                    ],
                },
            },
            "orbit-cube": {
                position: {
                    id: "position",
                    label: "Position",
                    type: "vec3",
                    keyframes: [
                        { id: "c0", frameNumber: 0, keyframeData: { x: 0, y: 1, z: 0 } },
                        { id: "c1", frameNumber: 60, keyframeData: { x: 2, y: 1.5, z: 2 } },
                    ],
                },
            },
        },
        markers: [
            { id: "m1", frameNumber: 24, label: "Beat", color: "#56c6ff" },
            { id: "m2", frameNumber: 96, label: "Spawn", color: "#ff8c5a" },
        ],
    },
};
```

### Data Types

```javascript
// property.type === "vec3"
{ x, y, z }

// property.type === "quat"
{ x, y, z, w }

// property.type === "number"
42
```

### Legacy Note

The runtime still understands the older single-entity shape:

```javascript
data.properties
```

but new code should use:

```javascript
data.entities
```

## Code-First Builders

When generating sequences in plugins, simple builder helpers keep code readable:

```javascript
const keyframe = (id, frameNumber, keyframeData) => ({ id, frameNumber, keyframeData });

const marker = (id, frameNumber, label, color) => ({
    id,
    frameNumber,
    label,
    color,
    event: null,
    payload: null,
});

const property = (id, label, type, keyframes, extra = {}) => ({
    id,
    label,
    type,
    keyframes,
    ...extra,
});
```

That makes it easy to generate paths, random markers, or camera beats in plain JavaScript.

## Adapters And Getters

Adapters write interpolated values into the live scene. Getters read the current live value back out.

### Entity-Aware Adapter

```javascript
sequencePlayer.setAdapter("position", (value) => {
    targetEntity.setLocalPosition(value.x, value.y, value.z);
}, {
    entityId: "orbit-cube",
    type: "vec3",
    label: "Position",
});
```

### Entity-Aware Getter

```javascript
sequencePlayer.setGetter("position", () => {
    const pos = targetEntity.getLocalPosition();
    return { x: pos.x, y: pos.y, z: pos.z };
}, { entityId: "orbit-cube" });
```

If you omit `entityId`, the binding is global. For new cutscene/object work, prefer explicit `entityId` bindings so multi-entity sequences stay predictable.

## Markers

Markers do not affect interpolation. They are just timed events:

```javascript
{
    id: "launch-01",
    frameNumber: 12,
    label: "Launch Sparkles",
    color: "#ffd166",
    event: "firework:sparkle",
}
```

`event` and `payload` are optional. If `event` is missing you can still fall back to label parsing, but for reusable effects it is better to set a stable event name directly.

Use them for:

- spawning physics objects
- subtitle beats
- sound cues
- triggering other plugins
- switching materials, lights, post effects, or gameplay state

```javascript
sequencePlayer.on("sequence:marker", ({ marker, sequence }) => {
    console.log(sequence.id, marker.label, marker.frameNumber);
});
```

## Playback Direction (Reverse)

`sequencePlayer` exposes three boolean script attributes that shape playback:

| Attribute  | Default | Effect                                                  |
| ---------- | ------- | ------------------------------------------------------- |
| `loop`     | `false` | Restart from the start frame instead of stopping.       |
| `autoplay` | `false` | Begin playback automatically once a sequence is loaded. |
| `reverse`  | `false` | Play from the **last** keyframe back to the **first**.  |

Set them directly on the player before starting playback:

```javascript
sequencePlayer.reverse = true;   // play the sequence backwards
sequencePlayer.loop = true;      // and keep looping
sequencePlayer.playSequence(mySequence);
```

When `reverse` is on:

- `playSequence()` starts the playhead at the sequence's **last** frame and the
  frame counter decreases each tick.
- Playback settles (or, with `loop`, wraps) at the **first** frame instead of
  the last.
- `endSequence()` jumps to the first frame, applies it, and fires
  `sequence:complete` — so skip/cancel still lands on the directional end.
- `resumeSequence()` restarts from the last frame if the playhead is already at
  the first frame.
- Markers fire in playback order — high frame numbers first, low frame numbers
  last.

`reverse` is read every frame, so set it (or flip it back) before calling
`playSequence()` / `resumeSequence()`. Toggling it mid-playback reverses
direction from the current frame, but the marker scan index is only reset at a
play/loop boundary, so set the direction up front for predictable marker events.

## SequencePlayer API

### Loading And Playback

- `setSequence(sequence)`
- `playSequence(sequence)` — starts at the first frame (or the last frame when `reverse` is set)
- `pauseSequence()`
- `resumeSequence()`
- `endSequence()` — settles on the directional end frame (last, or first when `reverse`)
- `setFrame(frame, apply = true)`
- `isPlaying()`

### Playback Attributes

- `loop` — restart at the directional end instead of stopping
- `autoplay` — play automatically once a sequence is loaded
- `reverse` — play from the last keyframe back to the first (see [Playback Direction](#playback-direction-reverse))

### Bindings

- `setAdapter(propertyKey, applyFn, options?)`
- `removeAdapter(propertyKey, entityId?)`
- `getAdapter(propertyKey, entityId?)`
- `getAdapterDescriptors(entityId?)`
- `setGetter(propertyKey, getFn, options?)`
- `removeGetter(propertyKey, entityId?)`
- `getCurrentKeyframeData(propertyKey?, entityId?)`
- `clearAdaptersAndGetters()`

### Targeting And Debug

- `setTargetEntity(entity)`
- `getTargetEntity()`
- `setSelectedEntity({ entityId, color })`
- `showPath(options?)`
- `hidePath()`
- `isPathActive()`

### Events

- `"sequence:marker"` -> `{ marker, sequence }`
- `"sequence:complete"`
- `"sequencePlayerScript:currentFrameChange"` -> `frame`

## Interpolation

Runtime playback uses Catmull-Rom interpolation:

- `number`: scalar Catmull-Rom
- `vec3`: per-component Catmull-Rom
- `quat`: Catmull-Rom with hemisphere alignment, then normalized

That is the same interpolation the current client uses for authored cutscenes.

## Cutscene Entities

Most cutscenes are authored visually in the in-app **Sequence Editor** and saved
on a cutscene entity, rather than built in code. A plugin interacts with one by
picking the entity (`editor: "entity"`, `filterTypes: ["cutscene"]`) and
resolving its controller:

```javascript
cutsceneEntityId = "";

static properties = {
    cutsceneEntityId: { title: "Cutscene", editor: "entity", filterTypes: ["cutscene"] },
};

_play() {
    const cutscene = ArrivalSpace.getCutsceneScript(this.cutsceneEntityId);
    cutscene?.playCutscene();
}
```

`getCutsceneScript(entityId)` returns the cutscene controller (or `null`):

- `playCutscene(options?)` — play from the start (no-op if the cutscene has no
  keyframes or is disabled). Pass `{ onComplete }` to run a callback once it
  finishes or is skipped: `cutscene.playCutscene({ onComplete: () => { ... } })`.
- `editCutscene(options?)` — open the Sequence Editor (desktop only)
- `skipIntroCutscene()` — skip the running cutscene with a fade
- `setData(partial)` — merge config into the cutscene (e.g. `{ loop }`,
  `{ reverse }`). Used to set playback direction before `playCutscene()`.
- `getLoop()` / `getReverse()` — read the current `loop` / `reverse` flags
- `on("sequence:marker", ({ marker, sequence }) => ...)` — react to timeline
  markers as the cutscene plays; unsubscribe with `off(...)` in `destroy()`

The controller re-fires the same `sequence:marker` events its `SequencePlayer`
emits, so marker-reactive plugins can listen on the cutscene entity without
owning the player.

### Reverse & Completion

`playCutscene()` creates the cutscene's `sequencePlayer` for the run and
**destroys it on completion**, so don't grab `entity.script.sequencePlayer` to
reverse an authored cutscene — drive direction through the controller. Play
forward, wait, then reverse:

```javascript
const cutscene = ArrivalSpace.getCutsceneScript(id);

cutscene.setData({ reverse: false });          // forward
cutscene.playCutscene({ onComplete: () => {    // fires on finish/skip, either direction
    cutscene.setData({ reverse: true });       // …wait, then play it backwards
    cutscene.playCutscene({ onComplete: () => cutscene.setData({ reverse: false }) });
}});
```

`setData({ reverse })` must precede `playCutscene()` (it reads `getReverse()` when
building the player); reset to `false` after. Add a boolean lock if a clip must
not overlap itself. The raw `sequencePlayer` API (`reverse` / `playSequence` /
[Playback Direction](#playback-direction-reverse)) is for **code-driven**
sequences you own, not controller-managed cutscenes.

## Patterns

### 1. Animate A Scene Object In Code

Create a `sequencePlayer` on an entity, bind adapters to its transform (or any
custom numeric property), and call `playSequence(sequence)` with a sequence you
build from the shape above. Good for doors, light rigs, or orbiting props.

### 2. React To Cutscene Markers

Pick a cutscene entity, subscribe to its `sequence:marker` events, and spawn
effects, sounds, or gameplay on each cue.

Reference:

- `examples/firework-marker-fx.mjs`

### 3. Play A Cutscene From The World

Trigger a picked cutscene from a button, proximity check, or any other input.

Reference:

- `examples/floating-cutscene-button.mjs`

Important in third person:

- use `ArrivalSpace.getPlayer()` for player position
- use `ArrivalSpace.getCamera()` only when you want the camera transform

### 4. Drive A Referenced Entity

Cutscenes can also animate other entities' properties (for example a Custom
Sound entity's volume). You can control such an entity directly from a plugin:

Reference:

- `examples/sound-press-button.mjs`

## Recommended Examples

- `examples/firework-marker-fx.mjs`: pick a cutscene, listen to its marker events, and spawn particle bursts on each cue.
- `examples/floating-cutscene-button.mjs`: a 3D button that plays a selected cutscene entity, with cooldown and out-of-range feedback.
- `examples/sound-press-button.mjs`: a clickable button that plays / pauses / stops a referenced Custom Sound entity.
