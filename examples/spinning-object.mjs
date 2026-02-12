/**
 * Spinning Object Plugin
 * 
 * Rotates the entity continuously.
 * Demonstrates properties exposed in the editor UI.
 * 
 * Features demonstrated:
 * - Vec3 property: rotation uses {x, y, z} object → shows EditVec3 in UI
 * - Hex color: boxColor uses #hex format → shows color picker in UI
 */
export class SpinningObject extends ArrivalScript {
    static scriptName = 'spinningObject';
    
    // Vec3 property → will show EditVec3 in UI (3 number inputs)
    rotation = { x: 0, y: 45, z: 0 };  // degrees per second for each axis
    
    // Hex color → will show EditColor picker in UI
    boxColor = "#4a90d9";
    boxScale = 1.0;
    
    static properties = {
        rotation: { title: 'Rotation Speed', min: -180, max: 180, step: 5 },
        boxColor: { title: 'Box Color' },
        boxScale: { title: 'Box Scale', min: 0.1, max: 5 }
    };
    
    // Private
    _box = null;
    _material = null;
    
    initialize() {
        this._createBox();
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
        return { r: 0.5, g: 0.5, b: 0.5 };
    }
    
    _createBox() {
        // Create a visible box
        this._box = new pc.Entity('box');
        this._box.addComponent('render', {
            type: 'box',
        });
        
        // Create material with color
        const rgb = this._hexToRgb(this.boxColor);
        this._material = new pc.StandardMaterial();
        this._material.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
        this._material.update();
        this._box.render.material = this._material;
        
        this._box.setLocalScale(this.boxScale, this.boxScale, this.boxScale);
        this.entity.addChild(this._box);
    }
    
    onPropertyChanged(name, value, oldValue) {
        if (name === 'boxColor' && this._material) {
            const rgb = this._hexToRgb(value);
            this._material.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
            this._material.update();
        }
        if (name === 'boxScale' && this._box) {
            this._box.setLocalScale(value, value, value);
        }
    }
    
    update(dt) {
        this.entity.rotate(
            this.rotation.x * dt,
            this.rotation.y * dt,
            this.rotation.z * dt
        );
    }
    
    destroy() {
        if (this._box) {
            this._box.destroy();
        }
        if (this._material) {
            this._material.destroy();
        }
    }
}
