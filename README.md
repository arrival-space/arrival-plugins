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

- [Getting Started](docs/getting-started.md) - Create your first plugin
- [API Reference](docs/api-reference.md) - ArrivalScript & ArrivalSpace API
- [Properties](docs/properties.md) - Expose settings in the editor
- [Multiplayer](docs/multiplayer.md) - Real-time sync & messaging
- [Examples](examples/) - Ready-to-use plugin examples

## Property Types

| Type | Example | UI Component |
|------|---------|--------------|
| `number` | `speed = 5` | Numeric slider |
| `boolean` | `enabled = true` | Toggle switch |
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
| [Hello World](examples/hello-world.mjs) | Simplest possible plugin |
| [Spinning Object](examples/spinning-object.mjs) | Rotation with vec3 control |
| [Floating Object](examples/floating-object.mjs) | Smooth floating animation |
| [Sound Trigger](examples/sound-trigger.mjs) | Play sound on proximity |
| [Model Loader](examples/model-loader.mjs) | Load GLB models dynamically |
| [Info Panel](examples/info-panel.mjs) | Billboard HTML panel |
| [Simple Camera Path](examples/camera-path-simple.mjs) | Single-path camera plugin (one plugin entity = one path) |

## Resources

- [Arrival.Space](https://arrival.space)
- [PlayCanvas Engine Docs](https://developer.playcanvas.com/api/)
