/**
 * Light Controller - reusable spotlight/point-light example.
 *
 * Features:
 * - Light type dropdown (cone/point)
 * - Tunable color/intensity/range/shadows
 * - Optional visual helper mesh
 * - Optional rotation for quick scene testing
 */
export class DynamicLight extends ArrivalScript {
    static scriptName = "Dynamic Light";

    lightType = "cone"; // cone | point
    color = "#ffd79c";
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
    rotateSpeed = 0;

    static properties = {
        lightType: {
            title: "Light Type",
            options: [
                { label: "Cone", value: "cone" },
                { label: "Point", value: "point" },
            ],
        },
        color: { title: "Light Color" },
        intensity: { title: "Intensity", min: 0, max: 10 },
        range: { title: "Range", min: 1, max: 50 },
        innerConeAngle: { title: "Inner Cone Angle", min: 0, max: 90 },
        outerConeAngle: { title: "Outer Cone Angle", min: 0, max: 90 },
        castShadows: { title: "Cast Shadows" },
        shadowResolution: { title: "Shadow Resolution", min: 256, max: 2048 },
        shadowBias: { title: "Shadow Bias", min: 0, max: 1 },
        shadowDistance: { title: "Shadow Distance", min: 1, max: 50 },
        shadowIntensity: { title: "Shadow Intensity", min: 0, max: 1 },
        showHelper: { title: "Show Helper" },
        rotateSpeed: { title: "Rotate Speed", min: -180, max: 180 },
    };

    _lightEntity = null;
    _helperEntity = null;
    _helperMaterial = null;

    initialize() {
        this._createLight();
        if (this.showHelper) this._createHelper();
    }

    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) return { r: 1, g: 1, b: 1 };
        return {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255,
        };
    }

    _getPcLightType() {
        return this.lightType === "point" ? "point" : "spot";
    }

    _createLight() {
        if (this._lightEntity) {
            this._lightEntity.destroy(); // also destroys helper if it's a child
            this._lightEntity = null;
            this._helperEntity = null;
        }

        this._lightEntity = new pc.Entity("SceneLight");
        this.entity.addChild(this._lightEntity);
        this._lightEntity.addComponent("light", { type: this._getPcLightType() });

        this._applyLightSettings();
    }

    _applyLightSettings() {
        const light = this._lightEntity?.light;
        if (!light) return;

        const rgb = this._hexToRgb(this.color);
        light.type = this._getPcLightType();
        light.color = new pc.Color(rgb.r, rgb.g, rgb.b);
        light.intensity = this.intensity;
        light.range = this.range;
        light.castShadows = this.castShadows;
        light.shadowResolution = Math.round(this.shadowResolution);
        light.shadowBias = this.shadowBias;
        light.shadowDistance = this.shadowDistance;
        light.shadowIntensity = this.shadowIntensity;
        light.normalOffsetBias = 0.05;
        light.shadowType = pc.SHADOW_PCF3;

        if (this.lightType === "cone") {
            light.innerConeAngle = this.innerConeAngle;
            light.outerConeAngle = this.outerConeAngle;
            this._lightEntity.setLocalEulerAngles(90, 0, 0);
        } else {
            this._lightEntity.setLocalEulerAngles(0, 0, 0);
        }
    }

    _createHelper() {
        if (this._helperEntity) this._helperEntity.destroy();

        const rgb = this._hexToRgb(this.color);
        this._helperMaterial = new pc.StandardMaterial();
        this._helperMaterial.diffuse = new pc.Color(rgb.r * 0.3, rgb.g * 0.3, rgb.b * 0.3);
        this._helperMaterial.emissive = new pc.Color(rgb.r * 0.5, rgb.g * 0.5, rgb.b * 0.5);
        this._helperMaterial.opacity = 0.3;
        this._helperMaterial.blendType = pc.BLEND_NORMAL;
        this._helperMaterial.cull = pc.CULLFACE_NONE;
        this._helperMaterial.update();

        this._helperEntity = new pc.Entity("LightHelper");
        this._lightEntity.addChild(this._helperEntity);
        this._helperEntity.addComponent("render", {
            type: this.lightType === "cone" ? "cone" : "sphere",
            material: this._helperMaterial,
            castShadows: false,
        });

        this._updateHelperTransform();
    }

    _updateHelperTransform() {
        if (!this._helperEntity) return;

        if (this.lightType === "cone") {
            const angleRad = (this.outerConeAngle * Math.PI) / 180;
            const baseRadius = this.range * Math.tan(angleRad);
            const scaleXZ = baseRadius / 0.5;
            // Light emits along local -Y. Cone tip (+Y) at origin, base (-Y) at range.
            this._helperEntity.setLocalScale(scaleXZ, this.range, scaleXZ);
            this._helperEntity.setLocalPosition(0, -this.range / 2, 0);
            this._helperEntity.setLocalEulerAngles(0, 0, 0);
            return;
        }

        const diameter = this.range * 2;
        this._helperEntity.setLocalScale(diameter, diameter, diameter);
        this._helperEntity.setLocalPosition(0, 0, 0);
        this._helperEntity.setLocalEulerAngles(0, 0, 0);
    }

    onPropertyChanged(name) {
        if (name === "lightType") {
            this._createLight();
            if (this.showHelper) this._createHelper();
            return;
        }

        if (name === "showHelper") {
            if (this.showHelper) {
                this._createHelper();
            } else if (this._helperEntity) {
                this._helperEntity.destroy();
                this._helperEntity = null;
            }
            return;
        }

        this._applyLightSettings();

        if (name === "range" || name === "outerConeAngle") {
            this._updateHelperTransform();
        }

        if (name === "color" && this._helperMaterial) {
            const rgb = this._hexToRgb(this.color);
            this._helperMaterial.diffuse.set(rgb.r * 0.3, rgb.g * 0.3, rgb.b * 0.3);
            this._helperMaterial.emissive.set(rgb.r * 0.5, rgb.g * 0.5, rgb.b * 0.5);
            this._helperMaterial.update();
        }
    }

    update(dt) {
        if (this.rotateSpeed !== 0) {
            this.entity.rotate(0, this.rotateSpeed * dt, 0);
        }
    }

    destroy() {
        // Destroy helper first (it's a child of the light entity)
        if (this._helperEntity) {
            this._helperEntity.destroy();
            this._helperEntity = null;
        }
        if (this._lightEntity) {
            this._lightEntity.destroy();
            this._lightEntity = null;
        }
        if (this._helperMaterial) {
            this._helperMaterial.destroy();
            this._helperMaterial = null;
        }
    }
}
