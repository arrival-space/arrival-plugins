/**
 * Avatar Bone Light
 *
 * Attaches a light to a selected avatar bone and applies local offsets.
 */
export class AvatarBoneLight extends ArrivalScript {
    static scriptName = "Avatar Bone Light";

    boneName = "RightHand";
    lightType = "cone";
    color = "#ffd79c";
    intensity = 5;
    range = 10;
    innerConeAngle = 20;
    outerConeAngle = 40;
    castShadows = true;
    shadowResolution = 1024;
    offsetX = 0;
    offsetY = 0;
    offsetZ = 0;
    rotationX = 0;
    rotationY = 0;
    rotationZ = 0;
    showHelper = false;
    shadowBias = 0.05;

    static properties = {
        boneName: { title: "Bone" },
        lightType: {
            title: "Light Type",
            options: [
                { label: "Cone", value: "cone" },
                { label: "Point", value: "point" },
            ],
        },
        color: { title: "Light Color", editor: "color" },
        intensity: { title: "Intensity", min: 0, max: 100, step: 0.1 },
        range: { title: "Range", min: 0.1, max: 50, step: 0.1 },
        innerConeAngle: { title: "Inner Cone Angle", min: 0, max: 90, step: 1 },
        outerConeAngle: { title: "Outer Cone Angle", min: 0, max: 90, step: 1 },
        castShadows: { title: "Cast Shadows" },
        shadowResolution: { title: "Shadow Resolution", min: 256, max: 2048, step: 256 },
        offsetX: { title: "Offset X", min: -2, max: 2, step: 0.01 },
        offsetY: { title: "Offset Y", min: -2, max: 2, step: 0.01 },
        offsetZ: { title: "Offset Z", min: -2, max: 2, step: 0.01 },
        rotationX: { title: "Rotation X", min: -180, max: 180, step: 1 },
        rotationY: { title: "Rotation Y", min: -180, max: 180, step: 1 },
        rotationZ: { title: "Rotation Z", min: -180, max: 180, step: 1 },
        showHelper: { title: "Show Helper" },
    };

    _boneOptionsRoot = null;
    _lightEntity = null;
    _helperEntity = null;
    _helperMaterial = null;
    _currentBone = null;

    initialize() {
        this._syncBoneOptions();
        this._createLight();
        this._attachToBone();
    }

    update() {
        this._syncBoneOptions();
        this._attachToBone();
        this._applyTransform();
    }

    onPropertyChanged(name) {
        if (name === "boneName") {
            this._attachToBone();
            return;
        }

        if (name === "lightType") {
            this._createLight();
            this._attachToBone();
            return;
        }

        if (name === "showHelper") {
            this._syncHelper();
            return;
        }

        this._applyLightSettings();
        this._applyTransform();

        if (name === "color" && this._helperMaterial) {
            this._updateHelperMaterial();
        }

        if (name === "range" || name === "outerConeAngle") {
            this._updateHelperTransform();
        }
    }

    _syncBoneOptions() {
        const root = ArrivalSpace.getPlayer();
        if (!root || root === this._boneOptionsRoot || root._destroyed) return;

        this._boneOptionsRoot = root;
        this.setParamOptions("boneName", ["", ...this._collectBoneNames(root)], false);
        this.refreshParamSchema();
    }

    _collectBoneNames(root) {
        const names = [];
        const visit = (entity) => {
            if (entity?.name) names.push(entity.name);
            for (const child of entity.children) visit(child);
        };
        visit(root);
        return names;
    }

    _getSelectedBone() {
        if (!this.boneName) return null;
        const player = ArrivalSpace.getPlayer();
        if (!player) return null;
        return player.findByName(this.boneName) || null;
    }

    _getPcLightType() {
        return this.lightType === "point" ? "point" : "spot";
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

    _createLight() {
        if (this._helperEntity) {
            this._helperEntity.destroy();
            this._helperEntity = null;
        }
        if (this._lightEntity) {
            this._lightEntity.destroy();
            this._lightEntity = null;
        }

        this._lightEntity = new pc.Entity("AvatarBoneLight");
        this._lightEntity.enabled = false;
        this._lightEntity.addComponent("light", { type: this._getPcLightType() });

        this._applyLightSettings();
        this._syncHelper();
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
        light.shadowType = pc.SHADOW_PCF3;
        light.layers = [0, 1005];
        light.shadowBias = this.shadowBias;

        if (this.lightType === "cone") {
            light.innerConeAngle = this.innerConeAngle;
            light.outerConeAngle = this.outerConeAngle;
        }
    }

    _syncHelper() {
        if (this._helperEntity) {
            this._helperEntity.destroy();
            this._helperEntity = null;
        }
        if (this._helperMaterial) {
            this._helperMaterial.destroy();
            this._helperMaterial = null;
        }
        if (!this.showHelper || !this._lightEntity) return;

        this._helperMaterial = new pc.StandardMaterial();
        this._helperMaterial.opacity = 0.3;
        this._helperMaterial.blendType = pc.BLEND_NORMAL;
        this._helperMaterial.cull = pc.CULLFACE_NONE;
        this._updateHelperMaterial();

        this._helperEntity = new pc.Entity("LightHelper");
        this._helperEntity.addComponent("render", {
            type: this.lightType === "cone" ? "cone" : "sphere",
            material: this._helperMaterial,
            castShadows: false,
        });
        this._lightEntity.addChild(this._helperEntity);
        this._updateHelperTransform();
    }

    _updateHelperMaterial() {
        if (!this._helperMaterial) return;
        const rgb = this._hexToRgb(this.color);
        this._helperMaterial.diffuse = new pc.Color(rgb.r * 0.3, rgb.g * 0.3, rgb.b * 0.3);
        this._helperMaterial.emissive = new pc.Color(rgb.r * 0.5, rgb.g * 0.5, rgb.b * 0.5);
        this._helperMaterial.update();
    }

    _updateHelperTransform() {
        if (!this._helperEntity) return;

        if (this.lightType === "cone") {
            const angleRad = (this.outerConeAngle * Math.PI) / 180;
            const baseRadius = this.range * Math.tan(angleRad);
            const scaleXZ = baseRadius / 0.5;
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

    _attachToBone() {
        const bone = this._getSelectedBone();
        if (bone === this._currentBone && !bone?._destroyed) return;

        this._currentBone = bone;
        if (!this._lightEntity) return;

        if (!bone) {
            this._lightEntity.enabled = false;
            return;
        }

        bone.addChild(this._lightEntity);
        this._lightEntity.enabled = true;
        this._applyTransform();
    }

    _applyTransform() {
        if (!this._lightEntity || this._lightEntity._destroyed || !this._currentBone || this._currentBone._destroyed) {
            return;
        }

        this._lightEntity.setLocalPosition(this.offsetX, this.offsetY, this.offsetZ);
        this._lightEntity.setLocalEulerAngles(this.rotationX, this.rotationY, this.rotationZ);
    }

    destroy() {
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
        this._currentBone = null;
    }
}
