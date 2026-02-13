/**
 * Cone Light Plugin - Creates a tunable spotlight with shadows
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

export class ConeLight extends ArrivalScript {
    static scriptName = 'Cone Light';

    // Public properties - configurable in UI
    color = '#ffd79c';
    intensity = 5;
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

    static properties = {
        color: { title: 'Light Color' },
        intensity: { title: 'Intensity', min: 0, max: 10 },
        range: { title: 'Range', min: 1, max: 50 },
        innerConeAngle: { title: 'Inner Cone Angle', min: 0, max: 90 },
        outerConeAngle: { title: 'Outer Cone Angle', min: 0, max: 90 },
        castShadows: { title: 'Cast Shadows' },
        shadowResolution: { title: 'Shadow Resolution', min: 256, max: 2048 },
        shadowBias: { title: 'Shadow Bias', min: 0, max: 1 },
        shadowDistance: { title: 'Shadow Distance', min: 1, max: 50 },
        shadowIntensity: { title: 'Shadow Intensity', min: 0, max: 1 },
        showHelper: { title: 'Show Helper' },
        rotateSpeed: { title: 'Rotate Speed', min: -180, max: 180 }
    };

    // Private properties
    _lightEntity = null;
    _helperEntity = null;
    _helperMaterial = null;

    initialize() {
        console.log('ConeLight initialized on entity:', this.entity.name);

        // Create the light
        this._createLight();

        // Create helper if needed
        if (this.showHelper) {
            this._createHelper();
        }
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

        this._updateHelperTransform();
    }

    _updateHelperTransform() {
        if (!this._helperEntity) return;

        // Scale cone to match light parameters
        // Cone base radius = range * tan(outerConeAngle)
        const angleRad = (this.outerConeAngle * Math.PI) / 180;
        const baseRadius = this.range * Math.tan(angleRad);

        // Cone primitive has height 2 and radius 0.5 by default
        const scaleY = this.range / 2;
        const scaleXZ = baseRadius / 0.5;

        this._helperEntity.setLocalScale(scaleXZ, scaleY, scaleXZ);
        // Position so tip is at origin, cone extends forward
        this._helperEntity.setLocalPosition(0, 0, -this.range / 2);
        this._helperEntity.setLocalEulerAngles(90, 0, 0);
    }

    onPropertyChanged(name, value, oldValue) {
        // Light property changes
        if (this._lightEntity?.light) {
            const light = this._lightEntity.light;

            if (name === 'color') {
                const rgb = this._hexToRgb(value);
                light.color = new pc.Color(rgb.r, rgb.g, rgb.b);
            } else if (name === 'intensity') {
                light.intensity = value;
            } else if (name === 'range') {
                light.range = value;
            } else if (name === 'innerConeAngle') {
                light.innerConeAngle = value;
            } else if (name === 'outerConeAngle') {
                light.outerConeAngle = value;
            } else if (name === 'castShadows') {
                light.castShadows = value;
            } else if (name === 'shadowResolution') {
                light.shadowResolution = value;
            } else if (name === 'shadowBias') {
                light.shadowBias = value;
            } else if (name === 'shadowDistance') {
                light.shadowDistance = value;
            } else if (name === 'shadowIntensity') {
                light.shadowIntensity = value;
            }
        }

        // Helper visibility toggle
        if (name === 'showHelper') {
            if (value && !this._helperEntity) {
                this._createHelper();
            }
            if (this._helperEntity) {
                this._helperEntity.enabled = value;
            }
        }

        // Update helper when light geometry changes
        if ((name === 'range' || name === 'outerConeAngle') && this._helperEntity) {
            this._updateHelperTransform();
        }

        // Update helper color
        if (name === 'color' && this._helperMaterial) {
            const rgb = this._hexToRgb(value);
            this._helperMaterial.diffuse.set(rgb.r * 0.3, rgb.g * 0.3, rgb.b * 0.3);
            this._helperMaterial.emissive.set(rgb.r * 0.5, rgb.g * 0.5, rgb.b * 0.5);
            this._helperMaterial.update();
        }
    }

    update(dt) {
        // Rotate the light
        if (this.rotateSpeed !== 0) {
            this.entity.rotate(0, this.rotateSpeed * dt, 0);
        }
    }

    destroy() {
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
    }
}
