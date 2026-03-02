# Arrival.Space Plugins

Build interactive experiences for [Arrival.Space](https://arrival.space) using JavaScript.

## Quick Start

```javascript
export class MyPlugin extends ArrivalScript {
    static scriptName = 'myPlugin';
    
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
- [Examples](examples/) - Ready-to-use plugin examples

## Property Types

| Type | Example | UI Component |
|------|---------|--------------|
| `number` | `speed = 5` | Numeric slider |
| `boolean` | `isEnabled = true` | Toggle switch |
| `string` | `label = "Hello"` | Text field |
| `color` | `color = "#ff0000"` | Color picker |
| `vec3` | `pos = { x: 0, y: 1, z: 0 }` | X/Y/Z inputs |

## Multiplayer Support

Sync state and send messages between players:

```javascript
// Automatically synced to all players
score = attribute(0, { sync: true });

// Send custom events
ArrivalSpace.net.send('Game:hit', { damage: 10 });

// Listen for events from other players
ArrivalSpace.net.on('Game:hit', (data, sender) => {
    console.log(`${sender.userName} hit for ${data.damage}`);
});
```

See [Multiplayer Documentation](docs/multiplayer.md) for details.

## Example Plugins

| Plugin | Description |
|--------|-------------|
| [Annotation Marker](examples/annotation-marker.mjs) | 3D marker with icon and markdown popup panel |
| [Avatar Animation](examples/avatar-animation.mjs) | Override player idle/walk/jump animations |
| [Bouncy Box](examples/bouncy-box.mjs) | Simple bouncing motion behavior |
| [Box Stack](examples/box-stack.mjs) | Physics pyramid of boxes and spheres |
| [Character Scale](examples/character-scale-plugin.mjs) | Adjust character scale and movement feel |
| [Dynamic Light](examples/dynamic-light.mjs) | Configurable cone/point light controller |
| [GLB Model](examples/glb-model.mjs) | Load and attach an external GLB model |
| [Hello World](examples/hello-world.mjs) | Simplest possible plugin |
| [Hover Board](examples/hover-board.mjs) | Rideable dynamic board with avatar animation, input, and physics tuning |
| [Info Panel](examples/info-panel.mjs) | Dynamic world-space iframe/UI panel |
| [NPC Character](examples/npc-character.mjs) | Spawn and control a follower NPC |
| [Outfit Override](examples/outfit-override.mjs) | Temporarily override avatar outfit parts |
| [Physics Box](examples/physics-box.mjs) | Basic rigidbody/collision example |
| [Post Process Volume](examples/post-process-volume.mjs) | Local post-effects blend volume |
| [Shooter HUD](examples/shooter-hud.mjs) | Game-style HUD overlay example |
| [Simple Chat](examples/simple-chat.mjs) | Multiplayer chat with `ArrivalSpace.net` |
| [Snowfall](examples/snowfall.mjs) | Configurable snowfall particle effect |
| [Sound Trigger](examples/sound-trigger.mjs) | Play sound on proximity |
| [Vehicle Physics Model](examples/vehicle-physics-model.mjs) | Driveable vehicle with custom chassis/wheel GLB models, headlights, suspension, and input controls |

## Resources

- [Arrival.Space](https://arrival.space)
- [PlayCanvas Engine Docs](https://developer.playcanvas.com/api/)
