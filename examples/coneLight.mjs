/**
 * Cone Light Plugin - Creates a tunable spotlight with shadows
 * 
 * Load it using: await this.loadPlugin('path/to/coneLight.mjs');
 * 
 * Features demonstrated:
 * - Hex color string (color) → shows color picker in UI
 * - Number properties for light parameters
 * - Boolean for shadow toggle
 * 
 * Properties:
 * - color: Light color (#hex string → color picker)
 * - intensity: Light brightness (0-10)
 * - range: How far the light reaches
 * - innerConeAngle: Inner cone angle in degrees (full brightness)
 * - outerConeAngle: Outer cone angle in degrees (falloff edge)
 * - castShadows: Enable shadow casting
 * - shadowResolution: Shadow map size (256, 512, 1024, 2048)
 * - shadowBias: Shadow bias to reduce artifacts
 * - shadowDistance: Max distance for shadows
 * - shadowIntensity: Shadow darkness (0-1)
 * - showHelper: Show a visible cone mesh for debugging
 */

export class ConeLight extends pc.Script {
    static scriptName = 'coneLight';
    
    // Public properties - configurable in UI
    color = '#ffffff';
    intensity = 2;
    range = 10;
    innerConeAngle = 20;
    outerConeAngle = 40;
    castShadows = true;
    shadowResolution = 1024;
    shadowBias = 0.2;
    shadowDistance = 16;
    shadowIntensity = 1;
    showHelper = false;
    rotateSpeed = 0; // degrees per second (0 = no rotation)
    
    // Private properties
    _lightEntity = null;
    _helperEntity = null;
    _helperMaterial = null;
    _lastShowHelper = false;
    
    initialize() {
        console.log('💡 ConeLight initialized on entity:', this.entity.name);
        
        // Create the light
        this._createLight();
        
        // Create helper if needed
        if (this.showHelper) {
            this._createHelper();
        }
        this._lastShowHelper = this.showHelper;
        
        // Cleanup on destroy
        this.once('destroy', () => {
            console.log('ConeLight destroyed');
            if (this._lightEntity) {
                this._lightEntity.destroy();
                this._lightEntity = null;
            }
            if (this._helperEntity) {
                this._helperEntity.destroy();
                this._helperEntity = null;
            }
            if (this._helperMaterial) {
                this._helperMaterial.destroy();
                this._helperMaterial = null;
            }
        });
        
        this.on('enable', () => {
            if (this._lightEntity) this._lightEntity.enabled = true;
            if (this._helperEntity) this._helperEntity.enabled = this.showHelper;
        });
        
        this.on('disable', () => {
            if (this._lightEntity) this._lightEntity.enabled = false;
            if (this._helperEntity) this._helperEntity.enabled = false;
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
        return { r: 1, g: 1, b: 1 };
    }
    
    _createLight() {
        const rgb = this._hexToRgb(this.color);
        
        this._lightEntity = new pc.Entity('SpotLight');
        this.entity.addChild(this._lightEntity);
        
        this._lightEntity.addComponent('light', {
            type: 'spot',
            color: new pc.Color(rgb.r, rgb.g, rgb.b),
            intensity: this.intensity,
            range: this.range,
            innerConeAngle: this.innerConeAngle,
            outerConeAngle: this.outerConeAngle,
            castShadows: this.castShadows,
            shadowResolution: this.shadowResolution,
            shadowBias: this.shadowBias,
            shadowDistance: this.shadowDistance,
            shadowIntensity: this.shadowIntensity,
            normalOffsetBias: 0.05,
            shadowType: pc.SHADOW_PCF3 // Soft shadows
        });
        
        // Light points down local -Y by default, rotate to point along -Z (forward)
        this._lightEntity.setLocalEulerAngles(90, 0, 0);
    }
    
    _createHelper() {
        if (this._helperEntity) {
            this._helperEntity.destroy();
        }
        
        const rgb = this._hexToRgb(this.color);
        
        // Create material for helper
        this._helperMaterial = new pc.StandardMaterial();
        this._helperMaterial.diffuse = new pc.Color(rgb.r * 0.3, rgb.g * 0.3, rgb.b * 0.3);
        this._helperMaterial.emissive = new pc.Color(rgb.r * 0.5, rgb.g * 0.5, rgb.b * 0.5);
        this._helperMaterial.opacity = 0.3;
        this._helperMaterial.blendType = pc.BLEND_NORMAL;
        this._helperMaterial.cull = pc.CULLFACE_NONE;
        this._helperMaterial.update();
        
        // Create cone mesh for visualization
        this._helperEntity = new pc.Entity('LightHelper');
        this.entity.addChild(this._helperEntity);
        
        this._helperEntity.addComponent('render', {
            type: 'cone',
            material: this._helperMaterial
        });
        
        // Scale cone to match light parameters
        // Cone base radius = range * tan(outerConeAngle)
        const angleRad = (this.outerConeAngle * Math.PI) / 180;
        const baseRadius = this.range * Math.tan(angleRad);
        
        // Cone primitive has height 2 and radius 0.5 by default
        // Scale to match: height = range, radius = baseRadius
        const scaleY = this.range / 2;
        const scaleXZ = baseRadius / 0.5;
        
        this._helperEntity.setLocalScale(scaleXZ, scaleY, scaleXZ);
        // Position so tip is at origin, cone extends forward (-Z becomes down after rotation)
        this._helperEntity.setLocalPosition(0, 0, -this.range / 2);
        this._helperEntity.setLocalEulerAngles(90, 0, 0);
    }
    
    _updateLight() {
        if (!this._lightEntity?.light) return;
        
        const rgb = this._hexToRgb(this.color);
        const light = this._lightEntity.light;
        
        light.color = new pc.Color(rgb.r, rgb.g, rgb.b);
        light.intensity = this.intensity;
        light.range = this.range;
        light.innerConeAngle = this.innerConeAngle;
        light.outerConeAngle = this.outerConeAngle;
        light.castShadows = this.castShadows;
        light.shadowResolution = this.shadowResolution;
        light.shadowBias = this.shadowBias;
        light.shadowDistance = this.shadowDistance;
        light.shadowIntensity = this.shadowIntensity;
    }
    
    _updateHelper() {
        if (!this._helperEntity) return;
        
        const rgb = this._hexToRgb(this.color);
        
        // Update material color
        if (this._helperMaterial) {
            this._helperMaterial.diffuse.set(rgb.r * 0.3, rgb.g * 0.3, rgb.b * 0.3);
            this._helperMaterial.emissive.set(rgb.r * 0.5, rgb.g * 0.5, rgb.b * 0.5);
            this._helperMaterial.update();
        }
        
        // Update cone scale
        const angleRad = (this.outerConeAngle * Math.PI) / 180;
        const baseRadius = this.range * Math.tan(angleRad);
        const scaleY = this.range / 2;
        const scaleXZ = baseRadius / 0.5;
        
        this._helperEntity.setLocalScale(scaleXZ, scaleY, scaleXZ);
        this._helperEntity.setLocalPosition(0, 0, -this.range / 2);
    }
    
    update(dt) {
        // Rotate the light
        if (this.rotateSpeed !== 0) {
            this.entity.rotate(0, this.rotateSpeed * dt, 0);
        }
        
        // Update light properties
        this._updateLight();
        
        // Handle helper visibility toggle
        if (this.showHelper !== this._lastShowHelper) {
            if (this.showHelper && !this._helperEntity) {
                this._createHelper();
            }
            if (this._helperEntity) {
                this._helperEntity.enabled = this.showHelper;
            }
            this._lastShowHelper = this.showHelper;
        }
        
        // Update helper if visible
        if (this.showHelper && this._helperEntity) {
            this._updateHelper();
        }
    }
}
