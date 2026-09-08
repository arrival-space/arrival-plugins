/// <reference path="../types/arrival.d.ts" />

// Requires ArrivalSpace API 1.14.0. Place upright with host scale 1.
export class VelocityPad extends ArrivalScript {
    static scriptName = "Velocity Pad";

    isEnabled = true;
    velocityX = 0;
    velocityY = 10;
    velocityZ = 0;
    static properties = {
        isEnabled: { title: "Enabled" },
        velocityX: { title: "World X speed (m/s)", min: -20, max: 20, step: 0.5 },
        velocityY: { title: "World Y speed (m/s)", min: 1, max: 20, step: 0.5 },
        velocityZ: { title: "World Z speed (m/s)", min: -20, max: 20, step: 0.5 },
    };

    _cooldown = 0;
    _pad = null;
    _material = null;

    initialize() {
        this._pad = new pc.Entity("Velocity pad collider");
        this.entity.addChild(this._pad);
        this._pad.setLocalPosition(0, 0.15, 0);
        this._pad.addComponent("collision", { type: "box", halfExtents: new pc.Vec3(1.5, 0.15, 1.5) });
        this._pad.addComponent("rigidbody", { type: "static", friction: 0.8, restitution: 0 });

        const visual = new pc.Entity("Velocity pad visual");
        this._pad.addChild(visual);
        visual.setLocalScale(3, 0.3, 3);
        this._material = new pc.StandardMaterial();
        this._material.diffuse = new pc.Color(0.1, 0.55, 0.45);
        this._material.emissive = new pc.Color(0.02, 0.12, 0.08);
        this._material.update();
        visual.addComponent("render", { type: "box", material: this._material });
    }

    update(dt) {
        this._cooldown = Math.max(0, this._cooldown - dt);
        if (!this.isEnabled || this._cooldown > 0 || ArrivalSpace.getStandingObject() !== this._pad) return;
        const player = ArrivalSpace.getPlayer();
        if (!player?.rigidbody || player.rigidbody.linearVelocity.y > 0.5) return;
        // World-space direction: rotating the pad does not rotate this velocity.
        if (ArrivalSpace.setPlayerVelocity({ x: this.velocityX, y: this.velocityY, z: this.velocityZ })) {
            this._cooldown = 0.4;
        }
    }

    destroy() {
        this._pad?.destroy();
        this._material?.destroy();
    }
}
