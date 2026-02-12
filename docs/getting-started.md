# Getting Started

Create your first Arrival.Space plugin in 5 minutes.

## What is a Plugin?

A plugin is a JavaScript file (`.mjs`) that adds behavior to objects in your space. Plugins can:

- Animate objects (rotate, bounce, float)
- Respond to user interaction (clicks, proximity)
- Load 3D models and play sounds
- Create UI panels
- And much more

## Your First Plugin

### 1. Create a File

Create a file called `my-plugin.mjs`:

```javascript
export class MyPlugin extends ArrivalScript {
    
    // This runs once when the plugin starts
    initialize() {
        console.log('Plugin started!');
    }
    
    // This runs every frame
    update(dt) {
        // dt = delta time (seconds since last frame)
    }
}
```

### 2. Add Properties

Properties are settings that appear in the editor UI:

```javascript
export class MyPlugin extends ArrivalScript {
    
    // These show up in the editor
    speed = 5;
    height = 1.0;
    enabled = true;
    label = "Hello";
    
    update(dt) {
        if (this.enabled) {
            this.entity.rotate(0, this.speed * dt, 0);
        }
    }
}
```

**Supported property types:**
- `number` → Slider/input
- `boolean` → Toggle
- `string` → Text field

### 3. Use the API

Access helpful shortcuts via `this`:

```javascript
export class MyPlugin extends ArrivalScript {
    
    initialize() {
        // Get/set position easily
        console.log('Starting at:', this.position);
        
        // Find other entities
        const door = this.find('MainDoor');
        
        // Access the current space
        console.log('Space:', this.space);
    }
}
```

Use global utilities via `ArrivalSpace`:

```javascript
export class MyPlugin extends ArrivalScript {
    
    async initialize() {
        // Load a 3D model
        const { entity } = await ArrivalSpace.loadGLB('https://example.com/model.glb', {
            parent: this.entity,
            scale: 0.5
        });
        
        // Play a sound
        await ArrivalSpace.playSound('https://example.com/sound.mp3', {
            position: this.position
        });
    }
}
```

## Lifecycle Methods

| Method | When it runs |
|--------|--------------|
| `initialize()` | Once when plugin starts |
| `update(dt)` | Every frame |
| `postUpdate(dt)` | After all updates |
| `onPropertyChanged(name, value, oldValue)` | When a property is changed in the editor |
| `destroy()` | When plugin is removed |

### Responding to Property Changes

When users edit properties in the UI, implement `onPropertyChanged()` to update immediately:

```javascript
export class MyPlugin extends ArrivalScript {
    
    color = "#ff0000";
    
    initialize() {
        this._createUI();
    }
    
    // Called when property changes in editor - update in real-time!
    onPropertyChanged(name, value, oldValue) {
        if (name === 'color') {
            this._rebuildUI();
        }
    }
    
    _createUI() {
        // Create your visuals here
    }
    
    _rebuildUI() {
        // Recreate with new property values
    }
}
```

## Next Steps

- [API Reference](api-reference.md) - Full list of available methods
- [Properties](properties.md) - Advanced property options
- [Examples](../examples/) - Learn from working plugins
