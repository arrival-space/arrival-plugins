/**
 * Bouncy Box Plugin
 *
 * Creates a colored debug box that rotates and bounces.
 * Demonstrates basic ArrivalScript patterns with visual feedback.
 *
 * Features demonstrated:
 * - Number properties (rotationSpeed, bounceHeight, etc.) → shows slider/number in UI
 * - Boolean property (showDebugBox) → shows toggle in UI
 * - Hex color property (boxColor) → shows color picker in UI
 */

export class BouncyBox extends ArrivalScript {
    static scriptName = 'Bouncy Box';

    // Public properties - configurable in UI
    rotationSpeed = 45; // degrees per second
    bounceHeight = 0.5;
    bounceSpeed = 2;
    showDebugBox = true;
    boxScale = 0.3;
    // Hex color string → shows color picker in UI
    boxColor = "#33cc55";

    static properties = {
        rotationSpeed: { title: 'Rotation Speed', min: -180, max: 180 },
        bounceHeight: { title: 'Bounce Height', min: 0, max: 5 },
        bounceSpeed: { title: 'Bounce Speed', min: 0, max: 10 },
        showDebugBox: { title: 'Show Debug Box' },
        boxScale: { title: 'Box Scale', min: 0.1, max: 5 },
        boxColor: { title: 'Box Color' }
    };

    // Private properties (starting with _) are hidden from UI
    _time = 0;
    _startY = 0;
    _boxEntity = null;
    _material = null;

    initialize() {
        console.log('BouncyBox initialized on entity:', this.entity.name);

        // Store the initial Y position for bouncing
        this._startY = this.localPosition.y;

        // Create a debug box to visualize the plugin
        this._createDebugBox();
    }

    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            return {
                r: parseInt(result[1], 16) / 255,
                g: parseInt(result[2], 16) / 255,
                b: parseInt(result[3], 16) / 255
            };
        }
        return { r: 0.2, g: 0.8, b: 0.3 };
    }

    _createDebugBox() {
        // Create a box entity to visualize the plugin
        this._boxEntity = new pc.Entity('PluginDebugBox');
        this.entity.addChild(this._boxEntity);

        // Add render component with box primitive
        this._boxEntity.addComponent('render', {
            type: 'box'
        });

        // Create a simple colored material using boxColor
        const rgb = this._hexToRgb(this.boxColor);
        this._material = new pc.StandardMaterial();
        this._material.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
        this._material.emissive = new pc.Color(rgb.r * 0.5, rgb.g * 0.5, rgb.b * 0.5);
        this._material.update();
        this._boxEntity.render.material = this._material;

        // Set initial scale
        this._boxEntity.setLocalScale(this.boxScale, this.boxScale, this.boxScale);
        this._boxEntity.setLocalPosition(0, this.boxScale + 0.1, 0);

        // Set visibility based on showDebugBox
        this._boxEntity.enabled = this.showDebugBox;
    }

    onPropertyChanged(name, value, oldValue) {
        if (name === 'boxColor' && this._material) {
            const rgb = this._hexToRgb(value);
            this._material.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
            this._material.emissive = new pc.Color(rgb.r * 0.5, rgb.g * 0.5, rgb.b * 0.5);
            this._material.update();
        }
        if (name === 'boxScale' && this._boxEntity) {
            this._boxEntity.setLocalScale(value, value, value);
            this._boxEntity.setLocalPosition(0, value + 0.1, 0);
        }
        if (name === 'showDebugBox' && this._boxEntity) {
            this._boxEntity.enabled = value;
        }
    }

    update(dt) {
        this._time += dt;

        // Rotate the entity
        this.entity.rotate(0, this.rotationSpeed * dt, 0);

        // Bounce up and down using sine wave
        const pos = this.localPosition;
        pos.y = this._startY + Math.sin(this._time * this.bounceSpeed) * this.bounceHeight;
        this.localPosition = pos;

        // Pulse the box color based on bounce
        if (this._boxEntity && this._material) {
            const pulse = (Math.sin(this._time * this.bounceSpeed) + 1) / 2;
            const rgb = this._hexToRgb(this.boxColor);
            this._material.emissive.set(rgb.r * pulse * 0.5, rgb.g * pulse * 0.5, rgb.b * pulse * 0.5);
            this._material.update();
        }
    }

    destroy() {
        if (this._boxEntity) {
            this._boxEntity.destroy();
            this._boxEntity = null;
        }
        if (this._material) {
            this._material.destroy();
            this._material = null;
        }
    }
}
