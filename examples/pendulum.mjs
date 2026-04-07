/**
 * Pendulum
 *
 * A large kinematic pendulum that swings around the script entity's pivot
 * point. Built as a ragdoll test rig — the bob has a kinematic rigidbody
 * with collision so it can shove the player and trigger impact-based
 * ragdoll activation.
 *
 * Place the script on an empty entity at the desired pivot location. The
 * arm hangs in -Y from there and swings around the entity's local X axis
 * (so the bob moves in the YZ plane).
 */
export class Pendulum extends ArrivalScript {
    static scriptName = "Pendulum";

    armLength = 5.0;
    bobRadius = 0.6;
    amplitudeDeg = 70;
    periodSec = 3.0;
    bobColor = "#aa3333";

    static properties = {
        armLength:    { title: "Arm Length",     min: 1,  max: 20, step: 0.1 },
        bobRadius:    { title: "Bob Radius",     min: 0.1, max: 3, step: 0.05 },
        amplitudeDeg: { title: "Amplitude (deg)", min: 0, max: 90, step: 1 },
        periodSec:    { title: "Period (s)",     min: 0.5, max: 10, step: 0.1 },
        bobColor:     { title: "Bob Color" },
    };

    _time = 0;
    _arm = null;     // child entity that rotates
    _bob = null;     // child of _arm that holds collision + rigidbody
    _rodEntity = null;
    _rodMaterial = null;
    _bobMaterial = null;

    initialize() {
        // Arm is the swinging pivot child. We rotate this entity each frame.
        this._arm = new pc.Entity("PendulumArm");
        this.entity.addChild(this._arm);

        // Visual rod: a thin box centered halfway down the arm.
        this._rodEntity = new pc.Entity("PendulumRod");
        this._arm.addChild(this._rodEntity);
        this._rodEntity.addComponent("render", { type: "box" });
        this._rodMaterial = this._makeMaterial("#888888");
        this._rodEntity.render.material = this._rodMaterial;

        // Bob: sphere with collision + kinematic rigidbody, at the end of the arm.
        this._bob = new pc.Entity("PendulumBob");
        this._arm.addChild(this._bob);
        this._bob.addComponent("render", { type: "sphere" });
        this._bobMaterial = this._makeMaterial(this.bobColor);
        this._bob.render.material = this._bobMaterial;
        this._bob.addComponent("collision", {
            type: "sphere",
            radius: this.bobRadius,
        });
        this._bob.addComponent("rigidbody", {
            type: pc.BODYTYPE_KINEMATIC,
            friction: 0.5,
            restitution: 0.4,
        });

        this._rebuildGeometry();
    }

    onPropertyChanged(name, value) {
        if (name === "bobColor" && this._bobMaterial) {
            const rgb = this._hexToRgb(value);
            this._bobMaterial.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
            this._bobMaterial.update();
            return;
        }
        if (name === "armLength" || name === "bobRadius") {
            this._rebuildGeometry();
        }
    }

    update(dt) {
        this._time += dt;

        // Simple sinusoidal swing around the local X axis. The arm and bob
        // are positioned in -Y, so a positive X rotation tips them forward
        // in +Z, and the swing oscillates between ±amplitudeDeg.
        const phase = (2 * Math.PI * this._time) / Math.max(this.periodSec, 0.01);
        const angleDeg = this.amplitudeDeg * Math.sin(phase);
        this._arm.setLocalEulerAngles(angleDeg, 0, 0);
    }

    destroy() {
        if (this._bob) { this._bob.destroy(); this._bob = null; }
        if (this._rodEntity) { this._rodEntity.destroy(); this._rodEntity = null; }
        if (this._arm) { this._arm.destroy(); this._arm = null; }
        if (this._rodMaterial) { this._rodMaterial.destroy(); this._rodMaterial = null; }
        if (this._bobMaterial) { this._bobMaterial.destroy(); this._bobMaterial = null; }
    }

    // ------------------------------------------------------------------ helpers
    _rebuildGeometry() {
        // Rod: thin box from y=0 (pivot) down to y=-armLength.
        const rodThickness = 0.08;
        this._rodEntity.setLocalPosition(0, -this.armLength * 0.5, 0);
        this._rodEntity.setLocalScale(rodThickness, this.armLength, rodThickness);

        // Bob: sphere centered at the end of the arm.
        this._bob.setLocalPosition(0, -this.armLength, 0);
        this._bob.setLocalScale(this.bobRadius * 2, this.bobRadius * 2, this.bobRadius * 2);

        // Resize the collision sphere to match.
        if (this._bob.collision) {
            this._bob.collision.radius = this.bobRadius;
        }
    }

    _makeMaterial(hex) {
        const rgb = this._hexToRgb(hex);
        const m = new pc.StandardMaterial();
        m.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
        m.update();
        return m;
    }

    _hexToRgb(hex) {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!r) return { r: 0.7, g: 0.2, b: 0.2 };
        return {
            r: parseInt(r[1], 16) / 255,
            g: parseInt(r[2], 16) / 255,
            b: parseInt(r[3], 16) / 255,
        };
    }
}
