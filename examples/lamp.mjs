/**
 * Lamp example that combines:
 * - a loaded GLB lamp model
 * - rigidbody + collision on the root entity
 * - a configurable point/cone light positioned near the bulb
 */
export class Lamp extends ArrivalScript {
    static scriptName = "Lamp";

    modelUrl =
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/LightsPunctualLamp/glTF-Binary/LightsPunctualLamp.glb";
    modelScale = 1;
    meshOffset = { x: 0, y: 0, z: 0 };

    collisionHalfExtents = { x: 0.35, y: 0.9, z: 0.35 };
    mass = 2;
    friction = 0.6;
    restitution = 0.1;

    lightType = "point";
    lightColor = "#ffd79c";
    intensity = 4;
    range = 8;
    innerConeAngle = 25;
    outerConeAngle = 45;
    castShadows = true;
    shadowResolution = 1024;
    shadowBias = 0.2;
    shadowDistance = 16;
    shadowIntensity = 1;
    bulbOffset = { x: 0, y: 1.15, z: 0 };
    showHelper = false;
    affectSplats = true;
    
    static properties = {
        modelUrl: { title: "Model URL", editor: "asset" },
        modelScale: { title: "Model Scale", min: 0.01, max: 10 },
        meshOffset: { title: "Mesh Offset", min: -5, max: 5, step: 0.01 },
        collisionHalfExtents: { title: "Collision Half Extents", min: 0.05, max: 5, step: 0.01 },
        mass: { title: "Mass", min: 0.1, max: 50 },
        friction: { title: "Friction", min: 0, max: 1 },
        restitution: { title: "Restitution", min: 0, max: 1 },
        lightType: {
            title: "Light Type",
            options: [
                { label: "Point", value: "point" },
                { label: "Cone", value: "cone" },
            ],
        },
        lightColor: { title: "Light Color" },
        intensity: { title: "Intensity", min: 0, max: 50 },
        range: { title: "Range", min: 1, max: 50 },
        innerConeAngle: { title: "Inner Cone Angle", min: 0, max: 90 },
        outerConeAngle: { title: "Outer Cone Angle", min: 0, max: 90 },
        castShadows: { title: "Cast Shadows" },
        shadowResolution: { title: "Shadow Resolution", min: 256, max: 2048 },
        shadowBias: { title: "Shadow Bias", min: 0, max: 1 },
        shadowDistance: { title: "Shadow Distance", min: 1, max: 50 },
        shadowIntensity: { title: "Shadow Intensity", min: 0, max: 1 },
        bulbOffset: { title: "Bulb Offset", min: -5, max: 5, step: 0.01 },
        showHelper: { title: "Show Helper" },
    };

    _modelEntity = null;
    _lightEntity = null;
    _helperEntity = null;
    _helperMaterial = null;

    initialize() {
        this._rebuildPhysics();
        this._createLight();
        this._loadModel(this.modelUrl);
    }

    async _loadModel(url) {
        if (this._modelEntity) {
            ArrivalSpace.disposeEntity(this._modelEntity);
            this._modelEntity = null;
        }

        if (!url) return;

        try {
            const { entity } = await ArrivalSpace.loadGLB(url, {
                parent: this.entity,
                name: "LampModel",
                scale: this.modelScale,
                position: this.meshOffset,
            });
            this._modelEntity = entity;
        } catch (err) {
            console.error("Lamp: Failed to load model:", err);
        }
    }

    _rebuildPhysics() {
        if (this.entity.rigidbody) {
            this.entity.removeComponent("rigidbody");
        }

        if (this.entity.collision) {
            this.entity.removeComponent("collision");
        }

        this.entity.addComponent("collision", {
            type: "box",
            halfExtents: new pc.Vec3(
                this.collisionHalfExtents.x,
                this.collisionHalfExtents.y,
                this.collisionHalfExtents.z,
            ),
        });

        this.entity.addComponent("rigidbody", {
            type: pc.BODYTYPE_DYNAMIC,
            mass: this.mass,
            friction: this.friction,
            restitution: this.restitution,
        });
    }

    _hexToRgb(hex) {
        const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!match) {
            return { r: 1, g: 0.84, b: 0.61 };
        }

        return {
            r: parseInt(match[1], 16) / 255,
            g: parseInt(match[2], 16) / 255,
            b: parseInt(match[3], 16) / 255,
        };
    }

    _getPcLightType() {
        return this.lightType === "cone" ? "spot" : "point";
    }

    _createLight() {
        if (this._lightEntity) {
            this._lightEntity.destroy();
            this._lightEntity = null;
            this._helperEntity = null;
        }

        if (this._helperMaterial) {
            this._helperMaterial.destroy();
            this._helperMaterial = null;
        }

        this._lightEntity = new pc.Entity("LampLight");
        this.entity.addChild(this._lightEntity);
        this._lightEntity.addComponent("light", { type: this._getPcLightType() });

        this._applyLightSettings();

        if (this.showHelper) {
            this._createHelper();
        }
    }

    _applyLightSettings() {
        const light = this._lightEntity?.light;
        if (!light) return;

        const rgb = this._hexToRgb(this.lightColor);
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

        this._lightEntity.setLocalPosition(this.bulbOffset.x, this.bulbOffset.y, this.bulbOffset.z);
        this._lightEntity.setLocalEulerAngles(this.lightType === "cone" ? 90 : 0, 0, 0);

        if (this.lightType === "cone") {
            light.innerConeAngle = this.innerConeAngle;
            light.outerConeAngle = this.outerConeAngle;
        }

        if(this.affectSplats)
		{
        	light.layers = [0, 1005];
        	ArrivalSpace.enableSplatLightMaterial();
		}

    }

    _createHelper() {
        if (this._helperEntity) {
            this._helperEntity.destroy();
        }

        if (this._helperMaterial) {
            this._helperMaterial.destroy();
        }

        const rgb = this._hexToRgb(this.lightColor);
        this._helperMaterial = new pc.StandardMaterial();
        this._helperMaterial.diffuse = new pc.Color(rgb.r * 0.3, rgb.g * 0.3, rgb.b * 0.3);
        this._helperMaterial.emissive = new pc.Color(rgb.r * 0.6, rgb.g * 0.6, rgb.b * 0.6);
        this._helperMaterial.opacity = 0.3;
        this._helperMaterial.blendType = pc.BLEND_NORMAL;
        this._helperMaterial.cull = pc.CULLFACE_NONE;
        this._helperMaterial.update();

        this._helperEntity = new pc.Entity("LampLightHelper");
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

    onPropertyChanged(name, value) {
        if (name === "modelUrl") {
            this._loadModel(value);
            return;
        }

        if (name === "modelScale" && this._modelEntity) {
            this._modelEntity.setLocalScale(value, value, value);
            return;
        }

        if (name === "meshOffset" && this._modelEntity) {
            this._modelEntity.setLocalPosition(value.x, value.y, value.z);
            return;
        }

        if (name === "collisionHalfExtents") {
            this._rebuildPhysics();
            return;
        }

        if (name === "mass") {
            this._rebuildPhysics();
            return;
        }

        if (name === "friction" && this.entity.rigidbody) {
            this.entity.rigidbody.friction = value;
            return;
        }

        if (name === "restitution" && this.entity.rigidbody) {
            this.entity.rigidbody.restitution = value;
            return;
        }

        if (name === "lightType") {
            this._createLight();
            return;
        }

        if (name === "showHelper") {
            if (this.showHelper) {
                this._createHelper();
            } else if (this._helperEntity) {
                this._helperEntity.destroy();
                this._helperEntity = null;
                if (this._helperMaterial) {
                    this._helperMaterial.destroy();
                    this._helperMaterial = null;
                }
            }
            return;
        }

        this._applyLightSettings();

        if (name === "range" || name === "outerConeAngle") {
            this._updateHelperTransform();
        }

        if (name === "lightColor" && this._helperMaterial) {
            const rgb = this._hexToRgb(this.lightColor);
            this._helperMaterial.diffuse.set(rgb.r * 0.3, rgb.g * 0.3, rgb.b * 0.3);
            this._helperMaterial.emissive.set(rgb.r * 0.6, rgb.g * 0.6, rgb.b * 0.6);
            this._helperMaterial.update();
        }
    }

    destroy() {
        if (this.entity.rigidbody) {
            this.entity.removeComponent("rigidbody");
        }

        if (this.entity.collision) {
            this.entity.removeComponent("collision");
        }

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

        if (this._modelEntity) {
            ArrivalSpace.disposeEntity(this._modelEntity);
            this._modelEntity = null;
        }
    }
}
