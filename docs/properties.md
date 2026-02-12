# Properties

Properties are values on your plugin that appear in the Arrival.Space editor UI.

## Basic Usage

Simply declare class properties with default values:

```javascript
export class MyPlugin extends ArrivalScript {
    
    speed = 5;              // number → slider/input
    enabled = true;         // boolean → toggle
    label = "Hello";        // string → text field
}
```

The UI automatically detects the type from the default value.

## Supported Types

| Type | Default Value | UI Component |
|------|---------------|--------------|
| `number` | `5` | Numeric input with drag |
| `boolean` | `true` | Toggle switch |
| `string` | `"text"` | Text field |
| `color` | `"#ff0000"` | Color picker (hex format) |
| `vec3` | `{ x: 0, y: 1, z: 0 }` | X/Y/Z numeric inputs with drag |

### Color Values

String values in hex color format are automatically shown as color pickers:

```javascript
export class MyPlugin extends ArrivalScript {
    
    color = "#ff0000";           // → Color picker (red)
    tint = "#00ff00";            // → Color picker (green)
    background = "#ffffff80";    // → Color picker with alpha
}
```

Supported formats:
- `#rgb` - Short format (e.g., `"#f00"` for red)
- `#rrggbb` - Standard format (e.g., `"#ff0000"`)
- `#rrggbbaa` - With alpha (e.g., `"#ff000080"` for 50% transparent red)

### Vec3 Values

Objects with `x`, `y`, `z` number properties are shown as vec3 inputs:

```javascript
export class MyPlugin extends ArrivalScript {
    
    rotation = { x: 0, y: 45, z: 0 };    // → X/Y/Z inputs
    offset = { x: 0, y: 1, z: 0 };       // → X/Y/Z inputs
}
```

You can drag on the X/Y/Z labels to scrub values quickly.

## Property Schema (Optional)

For more control, add a `static properties` object with hints:

```javascript
export class MyPlugin extends ArrivalScript {
    
    speed = 45;
    height = 1.0;
    label = "Hello";
    
    // Optional: UI hints
    static properties = {
        speed: { 
            title: 'Rotation Speed',    // Display name
            min: 0,                      // Minimum value
            max: 360,                    // Maximum value
        },
        height: { 
            title: 'Bounce Height',
            min: 0, 
            max: 10 
        },
        label: {
            title: 'Display Text'
        }
    };
}
```

## Schema Options

### For Numbers

```javascript
static properties = {
    speed: {
        title: 'Speed',           // Display name in UI
        min: 0,                   // Minimum allowed value
        max: 100,                 // Maximum allowed value
    }
};
```

### For Strings

```javascript
static properties = {
    mode: {
        title: 'Mode',
    }
};
```

### For Booleans

```javascript
static properties = {
    enabled: {
        title: 'Enable Effect',
    }
};
```

### For Vec3

```javascript
static properties = {
    rotation: {
        title: 'Rotation Speed',
        min: -360,                // Min for all components
        max: 360,                 // Max for all components
        step: 1,                  // Step increment (default: 0.1)
    }
};
```

## Private Properties

Properties starting with `_` are **not** shown in the UI:

```javascript
export class MyPlugin extends ArrivalScript {
    
    speed = 5;           // ✅ Shown in UI
    _time = 0;           // ❌ Hidden (private)
    _cache = null;       // ❌ Hidden (private)
    
    update(dt) {
        this._time += dt;  // Use for internal state
    }
}
```

## Runtime Updates

When a user changes a property in the editor UI, your plugin is updated automatically. Use `onPropertyChanged()` to react immediately:

```javascript
export class MyPlugin extends ArrivalScript {
    
    color = "#ff0000";
    size = 1.0;
    
    /**
     * Called when a property is changed in the editor.
     * Use this to update your visuals in real-time.
     */
    onPropertyChanged(name, value, oldValue) {
        if (name === 'color') {
            this._updateColor();
        } else if (name === 'size') {
            this._updateSize();
        }
    }
    
    _updateColor() {
        // Update material, UI, etc.
    }
    
    _updateSize() {
        // Resize elements
    }
}
```

**Important:** Without `onPropertyChanged()`, changes only take effect after reload!

## Complete Example

```javascript
/**
 * Floating Object Plugin
 * Makes an object float up and down smoothly.
 */
export class FloatingObject extends ArrivalScript {
    
    // Properties (shown in editor)
    height = 0.5;
    speed = 2;
    enabled = true;
    
    // Schema for better UI
    static properties = {
        height: { title: 'Float Height', min: 0, max: 5 },
        speed: { title: 'Float Speed', min: 0, max: 10 },
        enabled: { title: 'Enable Floating' }
    };
    
    // Private state
    _time = 0;
    _startY = 0;
    
    initialize() {
        this._startY = this.localPosition.y;
    }
    
    // React to property changes in real-time
    onPropertyChanged(name, value, oldValue) {
        // No rebuild needed for these properties - they're read in update()
        // But you could add visual feedback here if desired
    }
    
    update(dt) {
        if (!this.enabled) return;
        
        this._time += dt;
        
        const pos = this.localPosition;
        pos.y = this._startY + Math.sin(this._time * this.speed) * this.height;
        this.localPosition = pos;
    }
}
```
