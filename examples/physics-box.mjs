export class PhysicsBox extends ArrivalScript {
    static scriptName = "Physics Box";

    boxSize = 0.6;
    mass = 1;
    friction = 0.5;
    restitution = 0.2;
    boxColor = "#4fa3ff";
    spawnHeight = 2;
    impulseY = 2;

    static properties = {
        boxSize: { title: "Box Size", min: 0.1, max: 3 },
        mass: { title: "Mass", min: 0.1, max: 20 },
        friction: { title: "Friction", min: 0, max: 1 },
        restitution: { title: "Restitution", min: 0, max: 1 },
        boxColor: { title: "Box Color" },
        spawnHeight: { title: "Spawn Height", min: -2, max: 10 },
        impulseY: { title: "Kick Up", min: 0, max: 10 }
    };

    _boxEntity = null;
    _material = null;

    initialize() {
        this.createVisualBox();
        this.rebuildPhysics();
        this.reset();
    }

    createVisualBox() {
        this._boxEntity = new pc.Entity("PhysicsBoxVisual");
        this._boxEntity.addComponent("render", { type: "box" });
        this.entity.addChild(this._boxEntity);

        this._material = new pc.StandardMaterial();
        this._boxEntity.render.material = this._material;

        this.updateVisuals();
    }

    rebuildPhysics() {
        if (this.entity.rigidbody) {
            this.entity.removeComponent("rigidbody");
        }

        if (this.entity.collision) {
            this.entity.removeComponent("collision");
        }

        const half = this.boxSize * 0.5;
        this.entity.addComponent("collision", {
            type: "box",
            halfExtents: new pc.Vec3(half, half, half)
        });

        this.entity.addComponent("rigidbody", {
            type: pc.BODYTYPE_DYNAMIC,
            mass: this.mass,
            friction: this.friction,
            restitution: this.restitution
        });
    }

    updateVisuals() {
        if (!this._boxEntity || !this._material) return;

        this._boxEntity.setLocalScale(this.boxSize, this.boxSize, this.boxSize);

        const rgb = this.hexToRgb(this.boxColor);
        this._material.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
        this._material.emissive = new pc.Color(rgb.r * 0.1, rgb.g * 0.1, rgb.b * 0.1);
        this._material.update();
    }

    hexToRgb(hex) {
        const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!match) {
            return { r: 0.31, g: 0.64, b: 1 };
        }

        return {
            r: parseInt(match[1], 16) / 255,
            g: parseInt(match[2], 16) / 255,
            b: parseInt(match[3], 16) / 255
        };
    }

    onPropertyChanged(name, value) {
        if (name === "boxColor") {
            this.updateVisuals();
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

        if (name === "boxSize") {
            this.updateVisuals();
            this.rebuildPhysics();
            this.reset();
            return;
        }

        if (name === "mass") {
            this.rebuildPhysics();
            return;
        }

        if (name === "spawnHeight") {
            this.reset();
        }
    }

    kick() {
        if (!this.entity.rigidbody) return;
        this.entity.rigidbody.applyImpulse(0, this.impulseY, 0);
    }

    reset() {
        if (!this.entity.rigidbody) return;

        const pos = this.entity.getLocalPosition().clone();
        pos.y = this.spawnHeight;

        this.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
        this.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
        this.entity.rigidbody.teleport(pos, this.entity.getLocalRotation());
    }

    destroy() {
        if (this.entity.rigidbody) {
            this.entity.removeComponent("rigidbody");
        }

        if (this.entity.collision) {
            this.entity.removeComponent("collision");
        }

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
