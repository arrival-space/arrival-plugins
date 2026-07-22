# Arrival.Space Plugins

Build interactive experiences for [Arrival.Space](https://arrival.space) using JavaScript.

## Quick Start

```javascript
export class MyPlugin extends ArrivalScript {
  static scriptName = "myPlugin";

  // Properties shown in the editor UI
  speed = 5;
  color = "#ff0000";
  offset = { x: 0, y: 1, z: 0 };

  // Runs every frame
  update(dt) {
    this.entity.rotate(0, this.speed * dt, 0);
  }
}
```

## Documentation

- [Agent Quickstart](docs/00-agent-quickstart.md) - High-signal coding checklist for LLM/plugin generation
- [Getting Started](docs/getting-started.md) - Create your first plugin
- [API Reference](docs/api-reference.md) - ArrivalScript & ArrivalSpace API
- [Properties](docs/properties.md) - Expose settings in the editor
- [Multiplayer](docs/multiplayer.md) - Real-time sync & messaging
- [Sequences](docs/sequences.md) - Build cutscenes, object animation, and marker-driven events
- [Cutscenes via MCP/CLI](docs/cutscenes-via-mcp.md) - Create cutscenes/animations headlessly with `.path` files (no plugin)
- [Examples](examples/) - Ready-to-use plugin examples

## Property Types

| Type      | Example                      | UI Component   |
| --------- | ---------------------------- | -------------- |
| `number`  | `speed = 5`                  | Numeric slider |
| `boolean` | `isEnabled = true`           | Toggle switch  |
| `string`  | `label = "Hello"`            | Text field     |
| `color`   | `color = "#ff0000"`        | Color picker   |
| `vec3`    | `pos = { x: 0, y: 1, z: 0 }` | X/Y/Z inputs   |

## Multiplayer Support

Sync state and send messages between players:

```javascript
// Automatically synced to all players
score = attribute(0, { sync: true });

// Send custom events
ArrivalSpace.net.send("Game:hit", { damage: 10 });

// Listen for events from other players
ArrivalSpace.net.on("Game:hit", (data, sender) => {
  console.log(`${sender.userName} hit for ${data.damage}`);
});
```

See [Multiplayer Documentation](docs/multiplayer.md) for details.

## Example Plugins

| Plugin                                                                  | Description                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Annotation Marker](examples/annotation-marker.mjs)                     | 3D marker with icon and markdown popup panel                                                                                                                                                                                                                                                                                                                                              |
| [Avatar Animation](examples/avatar-animation.mjs)                       | Override player idle/walk/jump animations                                                                                                                                                                                                                                                                                                                                                 |
| [Avatar Bone Attachment](examples/avatar-bone-attachment.mjs)           | Attach a GLB model to any avatar bone with configurable offset and rotation                                                                                                                                                                                                                                                                                                               |
| [Bouncy Box](examples/bouncy-box.mjs)                                   | Simple bouncing motion behavior                                                                                                                                                                                                                                                                                                                                                           |
| [Box Stack](examples/box-stack.mjs)                                     | Physics pyramid of boxes and spheres                                                                                                                                                                                                                                                                                                                                                      |
| [Character Scale](examples/character-scale-plugin.mjs)                  | Adjust character scale and movement feel                                                                                                                                                                                                                                                                                                                                                  |
| [Dynamic Light](examples/dynamic-light.mjs)                             | Configurable cone/point light controller                                                                                                                                                                                                                                                                                                                                                  |
| [First-Install Setup](examples/first-install-setup.mjs)                 | One-time, owner-only setup panel via the onInstall() hook; persists config to pluginStore                                                                                                                                                                                                                                                                                                 |
| [Feed Recorder](examples/feed-recorder.mjs)                             | Records a Splat Monitor's render-target feed to a downloadable WebM video (plus PNG snapshots), with HUD button, hotkey, and event-bus control                                                                                                                                                                                                                                            |
| [Game HUD](examples/game-hud.mjs)                                       | Game-style HUD overlay example                                                                                                                                                                                                                                                                                                                                                            |
| [GLB Model](examples/glb-model.mjs)                                     | Load and attach an external GLB model                                                                                                                                                                                                                                                                                                                                                     |
| [Google 3D Tiles](examples/google-3d-tiles.mjs)                         | Stream the Google Earth globe (Photorealistic 3D Tiles) centered on any lat/lon, with LOD streaming and miniature-globe scaling                                                                                                                                                                                                                                                           |
| [Hello World](examples/hello-world.mjs)                                 | Simplest possible plugin                                                                                                                                                                                                                                                                                                                                                                  |
| [Hover Board](examples/hover-board.mjs)                                 | Rideable dynamic board with avatar animation, input, and physics tuning                                                                                                                                                                                                                                                                                                                   |
| [Info Panel](examples/info-panel.mjs)                                   | Dynamic world-space iframe/UI panel                                                                                                                                                                                                                                                                                                                                                       |
| [Lamp](examples/lamp.mjs)                                               | Lamp GLB with rigidbody collision and configurable light                                                                                                                                                                                                                                                                                                                                  |
| [Localized Light Probe](examples/localized-light-probe.mjs)             | Spatial light probe volume that overrides primary light, environment, and post-effects with radius falloff                                                                                                                                                                                                                                                                                |
| [Firework Marker FX](examples/firework-marker-fx.mjs)                   | React to a cutscene's timeline markers by spawning ascent flames and burst fireworks                                                                                                                                                                                                                                                                                                      |
| [AI NPC](examples/ai-npc.mjs)                                           | LLM-driven NPC that answers visitor questions in a chat panel (free GLM by default, or the owner's OpenAI/Anthropic/GLM key)                                                                                                                                                                                                                                                              |
| [NPC Character](examples/npc-character.mjs)                             | Spawn and control a follower NPC                                                                                                                                                                                                                                                                                                                                                          |
| [Outfit Override](examples/outfit-override.mjs)                         | Temporarily override avatar outfit parts                                                                                                                                                                                                                                                                                                                                                  |
| [Physics Box](examples/physics-box.mjs)                                 | Basic rigidbody/collision example                                                                                                                                                                                                                                                                                                                                                         |
| [Floating Cutscene Button](examples/floating-cutscene-button.mjs)       | Floating 3D button that plays a selected cutscene entity, with cooldown and range checks                                                                                                                                                                                                                                                                                                  |
| [Post Process Volume](examples/post-process-volume.mjs)                 | Local post-effects blend volume                                                                                                                                                                                                                                                                                                                                                           |
| [Scene Tour Camera](examples/scene-tour-camera.mjs)                     | Overlay list of scene entities; click one to fly the free camera to it                                                                                                                                                                                                                                                                                                                    |
| [Rail Camera](examples/rail-camera.mjs)                                 | Constrained free-fly studio camera on rails with cine viewfinder (letterbox, exposure/HDR, zoom), operator panel, and record transport driving the Feed Recorder                                                                                                                                                                                                                          |
| [Ragdoll Physics](examples/ragdoll-physics.mjs)                         | Procedural avatar ragdoll: bone-derived capsule bodies, cone/hinge constraints, impact-triggered activation, and head-tracked camera follow                                                                                                                                                                                                                                               |
| [Scavenger Hunt](examples/scavenger-hunt.mjs)                           | Controller that discovers Scavenger Item entities, tracks collection via proximity, and shows progress/finish HUD                                                                                                                                                                                                                                                                         |
| [Scavenger Item](examples/scavenger-item.mjs)                           | Collectible marker with gizmo-positionable placement, default visual or custom GLB, used with Scavenger Hunt                                                                                                                                                                                                                                                                              |
| [Simple Chat](examples/simple-chat.mjs)                                 | Multiplayer chat with `ArrivalSpace.net`                                                                                                                                                                                                                                                                                                                                                  |
| [Snowfall](examples/snowfall.mjs)                                       | Configurable snowfall particle effect                                                                                                                                                                                                                                                                                                                                                     |
| [Spin Image on Corner (`.path` cutscene)](examples/spin-image.path) | **Cutscene, not a plugin** — a `.path` sequence that spins an image on one of its corners (position + rotation keyframes); see [docs/cutscenes-via-mcp.md](docs/cutscenes-via-mcp.md) |
| [Splat Crop](examples/splat-crop.mjs)                                   | Movable oriented box that crops the space's loaded splat(s) — keep inside or carve a hole (Invert), with a soft edge. The `Crop Splats` toggle can disable cropping to use the box purely as a `Cull Google Tiles` selector                                                                                                                                                               |
| [Splat Monitor](examples/splat-monitor.mjs)                             | Live render-to-texture screen (monitor / CCTV / portal window) fed by a hidden second camera — camera-entity, follow-player, or fixed POV; window mode with off-axis projection; scanlines, LED raster, curve, on-demand rendering                                                                                                                                                          |
| [Splat Portal](examples/splat-portal.mjs)                               | Portal window that reveals another scene splat only through its opening via a stencil mask (true window onto the splat's real location). Optional near-clip (hide splats in front, objects still occlude), horizontal screen curve, and a glowing frame                                                                                                                                     |
| [Splat Reveal](examples/splat-reveal.mjs)                               | Configurable reveal on the space's loaded unified/LOD splat via the `gsplatCustomizeVS` hook — radial/sweep/rain/scatter/dissolve/bloom patterns with a final scale bump                                                                                                                                                                                                                  |
| [Splat Snow](examples/splat-snow.mjs)                                   | Flattened GSplat snow cover that raycasts onto collision surfaces                                                                                                                                                                                                                                                                                                                         |
| [Sound Press Button](examples/sound-press-button.mjs)                   | Clickable 3D button that plays / pauses / stops a referenced Custom Sound entity                                                                                                                                                                                                                                                                                                          |
| [Sound Trigger](examples/sound-trigger.mjs)                             | Play sound on proximity                                                                                                                                                                                                                                                                                                                                                                   |
| [Vehicle Physics Model](examples/vehicle-physics-model.mjs)             | Driveable vehicle with custom chassis/wheel GLB models, headlights, suspension, and input controls                                                                                                                                                                                                                                                                                        |
| [VRM Tuning & Debug](examples/vrm-tuning-debug.mjs)                     | Live control panel + visualizer for the engine's native VRM systems (which run automatically for every loaded VRM). Sliders tune the global `window.VRMSpringBones` (ropiness, air resistance, stiffness/gravity/drag, collision iterations) and `window.VRMToonMaterial` (diffuse/emissive/ambient/specular, skybox & tonemap); debug toggles draw the engine's real colliders and bones |

## MCP Search Index Maintenance

When adding, renaming, or removing example files, also update [docs/plugin-search-index.json](docs/plugin-search-index.json).

- Add or update the matching entry for each new example with:
  - `path`
  - `kind`
  - `title`
  - `summary`
  - `script_name` (for examples)
  - focused `keywords` that describe what someone would search for
- Keep the metadata concise and based on the actual file contents, not guesses.
- Remove entries for deleted examples and rename entries when filenames change.
- Update `total_entries` so it matches the actual number of items in `entries`.

## Command-Line Tool (`arrival`)

The [`arrival` CLI](tools/arrival-cli/) (in `tools/arrival-cli/`) lets you manage a space as **local files** — pull it into a git-friendly workspace, edit `room.json` / `entities/*.json` / `plugins/*.mjs` / `assets/*` with your own editor, then push it back.

```bash
cd tools/arrival-cli
npm install
npm link                        # optional: puts `arrival` on your PATH

arrival login                   # sign in via your browser (OAuth)
arrival spaces                  # list your spaces
arrival pull 45637586_1234      # download into ./45637586_1234/
arrival validate                # server-side dry-run
arrival push                    # apply your edits to the live space
```

See [`tools/arrival-cli/README.md`](tools/arrival-cli/README.md) for the workspace layout and current limits.

## Resources

- [Arrival.Space](https://arrival.space)
- [PlayCanvas Engine Docs](https://developer.playcanvas.com/api/)
