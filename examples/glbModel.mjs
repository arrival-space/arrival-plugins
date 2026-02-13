export class GlbModel extends ArrivalScript {
    static scriptName = "GLB Model";

    rotationSpeed = 45;
    bounceHeight = 0.5;
    bounceSpeed = 2;
    modelScale = 1;
    modelUrl = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Duck/glTF-Binary/Duck.glb";

    static properties = {
        modelUrl: { title: "Model URL" },
        modelScale: { title: "Model Scale", min: 0.01, max: 10 },
        rotationSpeed: { title: "Rotation Speed", min: -180, max: 180 },
        bounceHeight: { title: "Bounce Height", min: 0, max: 5 },
        bounceSpeed: { title: "Bounce Speed", min: 0, max: 10 }
    };

    _time = 0;
    _startY = 0;
    _modelEntity = null;

    initialize() {
        this._startY = this.localPosition.y;
        this.loadModel(this.modelUrl);
    }

    async loadModel(url) {
        if (!url) return;

        if (this._modelEntity) {
            ArrivalSpace.disposeEntity(this._modelEntity);
            this._modelEntity = null;
        }

        try {
            const { entity } = await ArrivalSpace.loadGLB(url, {
                parent: this.entity,
                name: "PluginModel",
                scale: this.modelScale
            });
            this._modelEntity = entity;
        } catch (err) {
            console.error("GlbModel: Failed to load model:", err);
        }
    }

    onPropertyChanged(name, value) {
        if (name === "modelUrl") {
            this.loadModel(value);
        }

        if (name === "modelScale" && this._modelEntity) {
            this._modelEntity.setLocalScale(value, value, value);
        }
    }

    update(dt) {
        this._time += dt;
        this.entity.rotate(0, this.rotationSpeed * dt, 0);

        const pos = this.localPosition;
        pos.y = this._startY + Math.sin(this._time * this.bounceSpeed) * this.bounceHeight;
        this.localPosition = pos;
    }

    destroy() {
        if (this._modelEntity) {
            ArrivalSpace.disposeEntity(this._modelEntity);
            this._modelEntity = null;
        }
    }
}
