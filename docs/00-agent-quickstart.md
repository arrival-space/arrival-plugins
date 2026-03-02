# Agent Quickstart

Use this as the first reference when generating Arrival.Space plugins from prompts.

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

## MCP Deployment Notes

- Upload plugin as a `.mjs` text file.
- When creating the entity, pass plugin property initial values in `entity_data.params`.
- `entity_data.params` keys must exactly match plugin property names.
- For runtime-created plugin files and entities, use the plugin management helpers in `ArrivalSpace` (`createPlugin`, `reloadPlugin`, `removePlugin`) when appropriate.

## Property Authoring

- Put runtime-editable fields as class properties.
- Add `static properties` for titles, min/max/step, dropdown `options`.
- Use `onPropertyChanged` for targeted updates.
- For dynamic dropdowns, call:
  - `this.setParamOptions(paramName, options, false)`
  - `this.refreshParamSchema()`

## API Selection Guide

- Load models: `ArrivalSpace.loadGLB`
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
- Multiplayer state: `attribute(default, { sync: true, authority: ... })`
- Multiplayer events: `ArrivalSpace.net.send/on/...`
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
- Stop timers/intervals/timeouts you started.
- Reset temporary global/avatar/player overrides:
  - `ArrivalSpace.resetAvatar()`
  - `ArrivalSpace.setPlayerAnimation(..., null)` where applicable.
  - `ArrivalSpace.setPlayerAvatarOffset(0, 0, 0)` where applicable.

## High-Signal Examples

- `examples/npc-character.mjs`: `createNPC`, avatar config, follow logic.
- `examples/avatar-animation.mjs`: animation override + dynamic dropdown options.
- `examples/hover-board.mjs`: standing-object hooks, avatar offset, animation triggers, and dynamic physics.
- `examples/outfit-override.mjs`: avatar parts override + reset.
- `examples/post-process-volume.mjs`: local post-effects blending.
- `examples/annotation-marker.mjs`: texture panel UI with interaction.
- `examples/vehicle-physics-model.mjs`: Ammo.js raycast vehicle, compound collision, custom GLB models, headlights, mount/dismount.

## Common Failure Modes

- Missing `static scriptName`.
- Using `enabled` as a plugin property.
- Rebuilding everything every frame instead of in `onPropertyChanged`.
- Forgetting cleanup in `destroy()`.
- Adding sub-entities to `app.root` instead of `this.entity` — they won't be destroyed on unload.
- Assuming camera position equals player position in third-person (use `getPlayer()` for character position).
