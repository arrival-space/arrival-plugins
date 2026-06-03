# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

`arrival-plugins-public` is the **public plugin SDK and example library** for [Arrival.Space](https://arrival.space). It is a standalone git repo (separate from the main `arrival.space` monorepo above it) and contains:

- `examples/` — Reference plugin implementations as standalone `.mjs` files (loaded at runtime by the Arrival.Space client)
- `docs/` — Plugin developer documentation, including a curated `plugin-search-index.json` used by the MCP search tool
- `types/arrival.d.ts` — Hand-maintained TypeScript declarations for `ArrivalScript` and `ArrivalSpace` (used via `/// <reference>` comments in plugin files)
- `tools/arrival-cli/` — Node REPL that bridges to a localhost browser via WebSocket for live debugging
- `tools/plugin-upload/` — Node CLI for uploading/updating `.mjs` plugins to a space via the backend REST API
- `data/` — GLB models, textures, audio used by example plugins

There is **no build step for the plugins themselves** — `.mjs` files are the deliverable. They run directly inside the Arrival.Space client at runtime.

## Where The Runtime / Adapter Lives

The `ArrivalScript` base class and the entire `window.ArrivalSpace` global are **not** in this repo — they live in the client at:

- `C:\Dev\arrival.space\client_git\scripts\pluginUtils.js` — The full plugin adapter (~6900 lines). Defines `class ArrivalScript extends pc.Script`, every helper exposed via `ArrivalSpace.*` (asset loading, panels, NPCs, avatar parts, animation, post-effects, plugin event bus, multiplayer `attribute()` sync, `_createNetNamespace`, plugin file storage, etc.), and the global export block at the bottom (`window.ArrivalScript = ...; window.ArrivalSpace = { ... }`). The exported `VERSION` string at the bottom is what `ArrivalSpace.VERSION` returns.
- `C:\Dev\arrival.space\client_git\scripts\plugin-host.js` — Tiny PlayCanvas script (`pluginHost`) that owns `app.pluginHost` and runs the per-frame attachment/seating logic for `attachPlayerToEntity` (riding entities like the hover-board / vehicle).
- `C:\Dev\arrival.space\client_git\scripts\arrival-plugin-system.js` — **LEGACY**, do not extend. The old `PlugIn` base class predating `ArrivalScript`. Kept for backwards compatibility only.
- `C:\Dev\arrival.space\client_git\scripts\user-model-entity.js` — Hosts each plugin instance on a scene entity; calls into `_ArrivalMultiplayer.processAttributes` / `cleanupSyncSubscriptions` (exported from `pluginUtils.js`) to wire up `attribute()`-synced fields.

When extending the adapter:

1. Add the new helper as a top-level function in `pluginUtils.js` (follow the existing JSDoc style — the public docs in this repo are written by hand from those signatures).
2. Wire it into the `window.ArrivalSpace = { ... }` block near the bottom of `pluginUtils.js` (currently around line 6761) so plugins can call `ArrivalSpace.newThing()`.
3. If it should also be available as `this.newThing()` on plugin instances, add a thin forwarding method on the `ArrivalScript` class (around line 2146 in `pluginUtils.js`, e.g. the existing `setPhysicsStepRate` forwarder at line 2216 is the pattern).
4. Bump `VERSION` at the bottom of the `ArrivalSpace` object if plugins might want to feature-detect.
5. Mirror the change in **this** repo:
    - Add or update the relevant section in `docs/api-reference.md`.
    - Add type signatures to `types/arrival.d.ts`.
    - If it merits an example, add one under `examples/` and update `docs/plugin-search-index.json` + `README.md` (see "When Adding/Renaming/Removing Examples" below).

## Plugin Shape (Hard Rules)

Every plugin must follow this shape, and AI-generated plugins frequently get these wrong:

```javascript
export class MyPlugin extends ArrivalScript {
    static scriptName = "myPlugin";       // REQUIRED — no scriptName = no plugin

    speed = 5;                            // editor-visible property
    isEnabled = true;                     // NOT `enabled` (reserved)

    static properties = {                 // optional UI hints
        speed: { title: "Speed", min: 0, max: 20 },
    };

    initialize() {}
    update(dt) {}
    onPropertyChanged(name, value, oldValue) {}
    destroy() {}
}
```

- **Reserved property names** (will silently break things): `enabled`, `app`, `entity`. Use `isEnabled`, etc.
- **Properties starting with `_`** are hidden from the editor UI — use them for internal state.
- **Property types are inferred from default values**: `number`, `boolean`, `string`, `"#rrggbb"` color, `{x,y,z}` vec3.
- **Always parent sub-entities to `this.entity`**, never `this.app.root`. Children of `this.entity` are auto-destroyed on plugin unload; entities on the scene root persist as orphans. World-space `setPosition`/`setRotation` work regardless of parent.
- **Multiplayer-synced state** uses `attribute(default, { sync: true, authority: 'any'|'owner'|'self' })`. Use `ArrivalSpace.net.send/on/...` for one-shot events, and `ArrivalSpace.fire/on/...` for the **local** plugin event bus (not network).
- **Cleanup in `destroy()`** is mandatory for: any `ArrivalSpace.net.on*` unsub returns, any `ArrivalSpace.on(...)` listeners, timers, and any global overrides (`resetAvatar()`, `setPlayerAnimation(state, null)`, `setPlayerAvatarOffset(0,0,0)`, `setAppUIVisible(true)`).

The full quick-checklist is in `docs/00-agent-quickstart.md` and is the highest-signal reference when generating plugins.

## API Surface

- `this.*` — Plugin instance helpers (entity/scene/UI/input/NPC/param-schema). See `docs/api-reference.md` "ArrivalScript" section.
- `ArrivalSpace.*` — Global utilities, no import needed: asset loading (`loadGLB`, `loadSplat`, `loadTexture`), audio, materials, panels (`createHTMLPanel`, `createTexturePanel`), scene queries, player/camera, animation, avatar parts, post-effects, plugin management, file storage. See `docs/api-reference.md` "ArrivalSpace" section.
- `ArrivalSpace.net.*` — Multiplayer messaging and presence. See `docs/multiplayer.md`.
- `pc.*` — Full PlayCanvas engine API is available (https://developer.playcanvas.com/api/).

## Tooling Commands

### `tools/arrival-cli/` — Live REPL bridge to a localhost browser

```bash
cd tools/arrival-cli
npm install                              # one-time
npm start                                # interactive REPL on ws://localhost:9222
node index.js -e "ArrivalSpace.getRoom()"  # one-shot eval
node index.js -w                         # watch/relay only, no REPL
node index.js -p 9223                    # alternate port
```

The browser auto-connects when you load Arrival.Space on `localhost` (must be `localhost`, not `127.0.0.1`).

### `tools/plugin-upload/` — Upload/update plugins via REST API

```bash
cd tools/plugin-upload
node index.js init [--server <url>]                              # one-time login (opens browser)
node index.js upload <file.mjs> --space <spaceId>                # create new plugin entity
node index.js upload <file.mjs> --space <spaceId> --entity <id>  # update existing entity
node index.js list --space <spaceId>                             # list plugins in a space
node index.js config                                             # show stored config
```

Default server is `https://user.arrival.space`. Config and bearer token are stored in `tools/plugin-upload/.arrival-api.json`. Space IDs are 8-digit-userid + `_` + 4 digits (e.g. `45637586_1234`).

## When Adding/Renaming/Removing Examples

This is easy to forget and breaks the MCP search:

1. Add/rename/delete the `.mjs` file in `examples/`.
2. Update `docs/plugin-search-index.json` with the matching entry (`path`, `kind`, `title`, `summary`, `script_name`, focused `keywords`).
3. Update `total_entries` to match the actual entry count.
4. If user-facing, also update the example table in `README.md`.

Keep keywords concrete (what someone would actually search for), based on the file's real contents — not guesses.

## High-Signal Examples (Read These First)

When asked to build something similar to one of these patterns, read the example before writing new code:

- `examples/scavenger-hunt.mjs` + `examples/scavenger-item.mjs` — Multi-plugin architecture: controller discovers items via `ArrivalSpace.getPlugins()` and the local event bus. Best reference for inter-plugin communication.
- `examples/hover-board.mjs` — Standing-object hooks, avatar offset, animation triggers, dynamic physics tuning.
- `examples/vehicle-physics-model.mjs` — Ammo.js raycast vehicle, compound collision, mount/dismount.
- `examples/npc-character.mjs` — `createNPC`, avatar config, follow logic, click callbacks.
- `examples/avatar-animation.mjs` — Animation override + dynamic dropdown options via `setParamOptions` + `refreshParamSchema`.
- `examples/post-process-volume.mjs` — Local post-effects blend volume.
- `examples/cloth-physics.mjs` — Ammo.js soft-body cloth with anchored edge.
- `examples/splat-fire.mjs`, `splat-fog.mjs`, `splat-grass.mjs`, `splat-snow.mjs` — Procedural GSplat effects.
- `examples/annotation-marker.mjs` — Texture panel UI with interaction.

## Common Failure Modes

- Forgetting `static scriptName`.
- Using `enabled` as a property name.
- Adding sub-entities to `this.app.root` instead of `this.entity` (they leak on unload).
- Rebuilding everything every frame instead of inside `onPropertyChanged`.
- Forgetting to unsubscribe `ArrivalSpace.net.on*` / `ArrivalSpace.on(...)` callbacks in `destroy()`.
- Using `getCamera().getPosition()` for the player's position in third-person — the camera orbits the character, so use `getPlayer()` for position and `getCamera()` for heading.
- Setting Euler angles on a panel returned by `createTexturePanel`/`createHTMLPanel` without re-applying the internal `90 + rotation.x` X-axis offset (see `docs/api-reference.md` "Gotchas").
