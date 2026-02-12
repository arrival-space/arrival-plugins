/**
 * Sample ESM Plugin for Arrival.Space
 * 
 * This plugin demonstrates the ESM script pattern for PlayCanvas.
 * Load it using: await this.loadPlugin('path/to/sampleESMPlugin.mjs');
 * 
 * Features demonstrated:
 * - Number properties (rotationSpeed, bounceHeight, etc.) → shows slider/number in UI
 * - Boolean property (showDebugBox) → shows toggle in UI
 * - Hex color property (boxColor) → shows color picker in UI
 * 
 * Note: We use the global `pc` object since PlayCanvas is already loaded,
 * rather than `import { Script } from 'playcanvas'` which requires an import map.
 * 
 * Only ONE script class per file is supported. The class must:
 * - Extend pc.Script
 * - Have a static 'scriptName' property
 * - Be exported
 */

export class SampleESMPlugin extends pc.Script {
    static scriptName = 'sampleESMPlugin';
    
    // Public properties - these will be synced with this.data.params
    // and can be exposed in the UI
    rotationSpeed = 45; // degrees per second
    bounceHeight = 0.5;
    bounceSpeed = 2;
    showDebugBox = true;
    boxScale = 0.3;
    // Hex color string → shows color picker in UI
    boxColor = "#33cc55";
    
    // Private properties (starting with _) are ignored
    _time = 0;
    _startY = 0;
    _boxEntity = null;
    _textEntity = null;
    _material = null;
    
    initialize() {
        console.log('🚀 SampleESMPlugin initialized on entity:', this.entity.name);
        
        // Store the initial Y position for bouncing
        this._startY = this.entity.getLocalPosition().y;
        
        // Create a debug box to visualize the plugin
        this._createDebugBox();
        
        // Listen for enable/disable events
        this.on('enable', () => {
            console.log('SampleESMPlugin enabled');
            if (this._boxEntity) this._boxEntity.enabled = this.showDebugBox;
        });
        
        this.on('disable', () => {
            console.log('SampleESMPlugin disabled');
            if (this._boxEntity) this._boxEntity.enabled = false;
        });
        
        this.once('destroy', () => {
            console.log('SampleESMPlugin destroyed');
            if (this._boxEntity) {
                this._boxEntity.destroy();
                this._boxEntity = null;
            }
        });
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
    
    update(dt) {
        this._time += dt;
        
        // Rotate the entity
        this.entity.rotate(0, this.rotationSpeed * dt, 0);
        
        // Bounce up and down using sine wave
        const pos = this.entity.getLocalPosition();
        pos.y = this._startY + Math.sin(this._time * this.bounceSpeed) * this.bounceHeight;
        this.entity.setLocalPosition(pos);
        
        // Update debug box visibility and scale
        if (this._boxEntity) {
            this._boxEntity.enabled = this.showDebugBox;
            this._boxEntity.setLocalScale(this.boxScale, this.boxScale, this.boxScale);
            this._boxEntity.setLocalPosition(0, this.boxScale + 0.1, 0);
            
            // Pulse the box color based on bounce
            const pulse = (Math.sin(this._time * this.bounceSpeed) + 1) / 2;
            const material = this._boxEntity.render.material;
            material.emissive.set(0.1 + pulse * 0.3, 0.4 + pulse * 0.2, 0.15);
            material.update();
        }
    }
    
    // Custom method that can be called from outside
    setSpeed(rotation, bounce) {
        this.rotationSpeed = rotation;
        this.bounceSpeed = bounce;
        console.log(`SampleESMPlugin: Speed updated - rotation: ${rotation}, bounce: ${bounce}`);
    }
}
