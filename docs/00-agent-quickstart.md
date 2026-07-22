# Agent Quickstart

Use this as the first reference when generating Arrival.Space plugins from prompts.

> **Plugin or cutscene?** If the request is to **animate / move / spin / rotate**
> an object (no interaction), that is usually a **cutscene**, not a plugin — and
> you can create one headlessly as a `.path` file with no plugin at all (see
> [Creating Cutscenes Headlessly](cutscenes-via-mcp.md)). Use a plugin only when
> you need custom logic, input, UI, or physics. If it is unclear whether
> interactivity is needed, **ask the user: vibe/plugin or sequence-editor/cutscene?**

## Required Plugin Shape

```javascript
export class MyPlugin extends ArrivalScript {
    static scriptName = "myPlugin";

    // editor params
    speed = 5;
    isEnabled = true;

    static properties = {
        speed: { title: "Speed", min: 0, max: 20 },
        isEnabled: { title: "Enabled" },
    };

    initialize() {}
    update(dt) {}
    onPropertyChanged(name, value, oldValue) {}
    destroy() {}
}
```

## Hard Rules

- Always export one class that extends `ArrivalScript`.
- Always set `static scriptName`.
- Avoid reserved property names: `enabled`, `app`, `entity`.
- Use `isEnabled` (or similar) instead of `enabled`.
- Keep plugin properties serializable (number, boolean, string, color hex, vec3-like object).
- If your plugin allocates resources, clean them up in `destroy()`.

## Lifecycle Hooks

- `initialize()` / `update(dt)` / `onPropertyChanged(name, v, old)` / `destroy()` — the usual hooks.
- `onEntityMoved(position, rotation)` — optional, fires when the vibe's entity is moved/rotated in the editor (on gizmo finish, not per-frame). `position` = world `{x,y,z}`, `rotation` = Euler degrees `{x,y,z}`, either may be null. Only needed to re-anchor content you spawned *separately* from `this.entity` (NPCs, detached sub-entities, teleported rigidbodies) — children of `this.entity` follow it for free. See `examples/npc-character.mjs`.
- `onEditModeChanged(isEditing, context)` — optional, fires when this vibe's in-app editor opens/closes (`isEditing` bool; `context` = creator-badge state or null). Also fires once after `initialize()` if loaded while already selected. Use it to toggle editor-only helpers or pause gameplay while editing. Mirrored on the event bus as `plugin:editModeChanged` / `plugin:editModeEnter` / `plugin:editModeExit`.
- `onInstall(ctx)` — optional, fires **once** right after a user adds the vibe to the space in-app (library install, drag-drop, or upload). It does **not** fire on reload, for other visitors, or for CLI/MCP deploys. Use it for one-time setup, e.g. open your own config panel; persist choices into the vibe's real params with `await this.setParams({ ... })` so they show in the editor and apply on every load. **Deploying via CLI/MCP? Set the vibe's `params` at deploy time instead — `onInstall` will not fire on that path.** Requires `ArrivalSpace.VERSION` ≥ `1.12.0`. See `examples/first-install-setup.mjs`.

## MCP Deployment Notes

- Upload plugin as a `.mjs` text file.
- When creating the entity, pass plugin property initial values in `entity_data.params`.
- `entity_data.params` keys must exactly match plugin property names.
- For runtime-created plugin files and entities, use the plugin management helpers in `ArrivalSpace` (`createPlugin`, `reloadPlugin`, `removePlugin`) when appropriate.

## Property Authoring

- Put runtime-editable fields as class properties.
- Add `static properties` for titles, min/max/step, dropdown `options`.
- Use `onPropertyChanged` for targeted updates.
- To set + persist a param from code (e.g. pre-configure on install), use `await this.setParam(name, value)` or `this.setParams({ ... })` — writes the real editor param (shows in the panel, applied on load, seen by everyone). It does **not** call your own `onPropertyChanged`.
- For dynamic dropdowns, call:
  - `this.setParamOptions(paramName, options, false)`
  - `this.refreshParamSchema()`
- Entity picker: a string property with `editor: "entity"`. Optional `filterTypes` (string or array) restricts the list — `"all"` (default), model subtypes `"glb"`/`"splat"`/`"image"`/`"cutscene"`/`"plugin"`, top-level `"custom-sound-entity"`/`"annotation"`/`"voicey"`/`"dynamic-gate"`/`"center-asset"`, or `"camera"` to also offer the room's main camera. Combine types in an array; unknown values fall back to `"all"`. The stored value is the picked entity id (`""` when cleared) — resolve it at runtime and guard for `null`. Full list in `docs/properties.md`.
- Editor button: a schema key with `editor: "action"` whose name matches a method on the plugin; pressing it calls that method.

## API Selection Guide

- Load models: `ArrivalSpace.loadGLB`
- Load splats: `ArrivalSpace.loadSplat` (.ply, .sog, .spz)
- Load textures: `ArrivalSpace.loadTexture`
- World-space UI panel: `ArrivalSpace.createTexturePanel` or `createHTMLPanel`
- Audio: `ArrivalSpace.playSound`
- Materials: `ArrivalSpace.createMaterial`
- Avatar override: `ArrivalSpace.setAvatarParts` and `ArrivalSpace.resetAvatar` in `destroy()`
- Player animation override: `ArrivalSpace.setPlayerAnimation`, `setPlayerAnimSpeed`, `setPlayerSpeed`
- Global physics stepping: `ArrivalSpace.setPhysicsStepRate` (world-global, latest call wins)
- Avatar visual offset: `ArrivalSpace.setPlayerAvatarOffset`
- Player input hooks: `this.onKeyDown`, `this.onKeyUp`
- Standing-object detection: `ArrivalSpace.getStandingObject`, `ArrivalSpace.onStandingObjectChanged`
- NPC behavior: `ArrivalSpace.createNPC`
- Cutscenes / animations / sequences (same system — keyframe playback): authored ones via `ArrivalSpace.getCutsceneScript(entityId)` → `playCutscene({ onComplete })` / `on("sequence:marker", ...)`; react to the end via `onComplete`. Play one in **reverse** with `cutscene.setData({ reverse: true })` *before* `playCutscene()` (reset to `false` after). The controller creates its `sequencePlayer` per run and destroys it on completion, so don't grab `entity.script.sequencePlayer` for authored cutscenes — use the `sequencePlayer` script directly (`reverse`/`loop`/`autoplay`/`playSequence`) only for **code-driven** sequences you own. See `docs/sequences.md`. To **create** a cutscene headlessly (MCP/CLI) as a `.path` file — no plugin — see `docs/cutscenes-via-mcp.md`.
- Multiplayer state: `attribute(default, { sync: true, authority: ... })`
- Multiplayer events: `ArrivalSpace.net.send/on/...`
- Plugin event bus (local inter-plugin communication): `ArrivalSpace.fire/on/off/once`
- Space utilities: `getPlayer`, `getCamera`, `getRoom`, `findEntity`, etc.

## Multiplayer Pattern

- Use `attribute()` for persistent shared state.
- Use `ArrivalSpace.net` messages for one-shot events.
- Choose authority explicitly:
  - `"owner"` for authoritative game state
  - `"self"` for per-player state
  - `"any"` for casual shared toggles

## Cleanup Checklist

- Destroy entities/panels/materials you created.
- **Parent sub-entities to `this.entity`** so they are auto-destroyed on unload. Avoid `this.app.root.addChild()` for entities your plugin owns — if they are on the scene root they will persist after the plugin is removed. `setPosition`/`setRotation` set world-space transforms regardless of parent, so parenting to your entity does not affect positioning.
- Unsubscribe all callbacks returned by `ArrivalSpace.net.on*`.
- Unsubscribe `ArrivalSpace.off(...)` for any `ArrivalSpace.on(...)` listeners.
- Stop timers/intervals/timeouts you started.
- Reset temporary global/avatar/player overrides:
  - `ArrivalSpace.resetAvatar()`
  - `ArrivalSpace.setPlayerAnimation(..., null)` where applicable.
  - `ArrivalSpace.setPlayerAvatarOffset(0, 0, 0)` where applicable.

## High-Signal Examples

- `examples/npc-character.mjs`: `createNPC`, avatar config, follow logic, and a simple NPC click callback example.
- `examples/avatar-animation.mjs`: animation override + dynamic dropdown options.
- `examples/hover-board.mjs`: standing-object hooks, avatar offset, animation triggers, and dynamic physics.
- `examples/outfit-override.mjs`: avatar parts override + reset.
- `examples/firework-marker-fx.mjs`: pick a cutscene entity, listen for its `sequence:marker` events, and spawn particle bursts on each cue.
- `examples/floating-cutscene-button.mjs`: a floating 3D button that plays a selected cutscene entity via `getCutsceneScript().playCutscene()`, with cooldown and range checks.
- `examples/post-process-volume.mjs`: local post-effects blending.
- `examples/cloth-physics.mjs`: simple soft-body curtain with Ammo.js cloth simulation, anchored top edge, texture/shadow controls, and nearby collision proxying.
- `examples/splat-fire.mjs`, `examples/splat-fog.mjs`, `examples/splat-grass.mjs`: procedural GSplat examples for animated fire, volumetric fog, and dense grass using editable effect parameters.
- `examples/annotation-marker.mjs`: texture panel UI with interaction.
- `examples/vehicle-physics-model.mjs`: Ammo.js raycast vehicle, compound collision, custom GLB models, headlights, mount/dismount.
- `examples/scavenger-hunt.mjs` + `examples/scavenger-item.mjs`: inter-plugin communication via event bus, plugin discovery with `getPlugins`, proximity collection, progress HUD + finish overlay. Best reference for multi-entity plugin architectures.

## Common Failure Modes

- Missing `static scriptName`.
- Using `enabled` as a plugin property.
- Rebuilding everything every frame instead of in `onPropertyChanged`.
- Forgetting cleanup in `destroy()`.
- Adding sub-entities to `app.root` instead of `this.entity` — they won't be destroyed on unload.
- Assuming camera position equals player position in third-person (use `getPlayer()` for character position).
