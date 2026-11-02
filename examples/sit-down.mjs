/**
 * Sit Down — a chair visitors can sit on.
 *
 * Click the chair, or walk up to it and press E (or tap "Sit down"), and your avatar sits on it,
 * facing the way the chair faces. Walk (WASD, arrows, the touch joystick), jump or press E again to
 * stand up in front of it. Everyone in the space sees who sits where; a chair holds one person.
 *
 * Turn "Show chair" off to make an invisible seat on furniture that is already in the space (a
 * bench in a splat, a sofa model): place the vibe on the floor in front of the seat, facing away
 * from its back, and set the seat height. While the space editor is open the hidden chair shows as
 * a ghost so it can be placed.
 *
 * Features demonstrated:
 * - ArrivalSpace.attachPlayerToEntity: the player pinned to a seat with its own animation, synced
 *   to everyone; onEntityAttachChanged for a seat someone else is on
 * - the catalog clip "sitting.glb" (the avatar's own rig, male or female)
 * - ArrivalSpace.getMoveInput to stand up on any move input, keyboard or touch
 * - a kinematic collider that follows the vibe when it is moved in the editor
 *
 * Requires ArrivalSpace.VERSION >= 1.29.0.
 */
export class SitDown extends ArrivalScript {
    static scriptName = "Sit Down";

    seatHeight = 0.47;
    showChair = true;
    color = "#8a5a35";
    sitAnimation = "sitting.glb";
    reach = 1.6;

    static properties = {
        seatHeight: { title: "Seat height (m)", min: 0.2, max: 1.2, step: 0.01 },
        showChair: { title: "Show chair" },
        color: { title: "Chair colour" },
        sitAnimation: { title: "Sitting animation (catalog name or GLB URL)" },
        reach: { title: "Sit-down distance (m)", min: 0.5, max: 5, step: 0.1 },
    };

    // The avatar's hip joint in "sitting.glb" is this high over its feet: a seat this high fits it.
    static CLIP_SEAT = 0.47;

    _chair = null;
    _material = null;
    _offs = [];
    _chairOffs = [];
    _seat = null;       // attachment handle while the local player sits here
    _occupied = false;   // someone else sits here
    _seatedFor = 0;
    _ui = null;

    // Lengths are real metres; k maps them into this space's units (a space without a world
    // scale is 0.7).
    get _k() {
        const s = Number(this.app.worldScale);
        return s > 0 ? s : 0.7;
    }

    initialize() {
        this._material = new pc.StandardMaterial();
        this._material.gloss = 0.35;
        this._build();

        this._ui = this.createUI("button", {
            style: {
                position: "fixed", bottom: "96px", left: "50%", transform: "translateX(-50%)",
                padding: "10px 18px", border: "none", borderRadius: "20px", font: "600 15px sans-serif",
                background: "rgba(20, 24, 32, 0.8)", color: "#fff", cursor: "pointer", display: "none", zIndex: "1000",
            },
        });
        this._ui.addEventListener("click", () => (this._seat ? this._stand() : this._sit()));

        this._onKey = (e) => {
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (e.key !== "e" && e.key !== "E") return;
            if (this._seat) this._stand();
            else if (this._near()) this._sit();
            else return;
            e.preventDefault();
        };
        window.addEventListener("keydown", this._onKey);

        this._offs.push(
            ArrivalSpace.onEntityAttachChanged(this.entity, (info) => { this._occupied = !!info; }),
            ArrivalSpace.onSpaceEditModeChanged(() => this._applyLook()),
        );
    }

    _build() {
        this._chair?.destroy();
        const k = this._k, h = this.seatHeight * k;
        const w = 0.5 * k, d = 0.45 * k, t = 0.05 * k, leg = 0.045 * k, back = 0.45 * k;
        const chair = new pc.Entity("Chair");
        const part = (x, y, z, sx, sy, sz) => {
            const e = new pc.Entity();
            e.addComponent("render", { type: "box", material: this._material });
            e.setLocalPosition(x, y, z);
            e.setLocalScale(sx, sy, sz);
            chair.addChild(e);
        };
        part(0, h - t / 2, 0, w, t, d);                                    // seat
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            part(sx * (w - leg) / 2, (h - t) / 2, sz * (d - leg) / 2, leg, h - t, leg);
        }
        part(0, h + back / 2, -(d - t) / 2, w, back, t);                   // back, behind the sitter (-z)
        for (const sx of [-1, 1]) part(sx * (w - leg) / 2, h + back / 2, -(d - leg) / 2, leg, back, leg);

        // The avatar faces the vibe's +z; a kinematic body follows the vibe when it is moved.
        chair.addComponent("collision", { type: "box", halfExtents: new pc.Vec3(w / 2, (h + back) / 2, d / 2), linearOffset: new pc.Vec3(0, (h + back) / 2, 0) });
        chair.addComponent("rigidbody", { type: pc.BODYTYPE_KINEMATIC });
        this.entity.addChild(chair);
        this._chair = chair;

        this._chairOffs.forEach((off) => off());
        this._chairOffs = [
            ArrivalSpace.onEntityClick(chair, (e) => {
                e.stopPropagation();
                if (this.showChair) this._sit();
            }),
            ArrivalSpace.onEntityHover(chair, {
                enter: (e) => { e.stopPropagation(); if (this.showChair && !this._seat) this.setOutline(chair, true); },
                leave: () => this.setOutline(chair, false),
            }),
        ];
        this._applyLook();
    }

    // Shown: solid with a collider. Hidden: nothing, a ghost while the space editor is open.
    _applyLook() {
        const ghost = !this.showChair && ArrivalSpace.isEditingSpace();
        this._material.diffuse.fromString(this.color);
        this._material.opacity = ghost ? 0.35 : 1;
        this._material.blendType = ghost ? pc.BLEND_NORMAL : pc.BLEND_NONE;
        this._material.update();
        this._chair.enabled = this.showChair || ghost;
        this._chair.collision.enabled = this.showChair;
        this._chair.rigidbody.enabled = this.showChair;
    }

    onPropertyChanged(name) {
        if (name === "seatHeight") {
            this._build();
            if (this._seat) { this._stand(); this._sit(); }
        } else if (name === "showChair" || name === "color") {
            this._applyLook();
        } else if (name === "sitAnimation" && this._seat) {
            this._stand();
            this._sit();
        }
    }

    _near() {
        const player = ArrivalSpace.getPlayer();
        return !!player && player.getPosition().distance(this.entity.getPosition()) < this.reach * this._k;
    }

    _sit() {
        if (this._seat || this._occupied || ArrivalSpace.getLocalAttachedEntity()) return;
        const k = this._k, clip = this.sitAnimation || "sitting.glb";
        const height = ArrivalSpace.getCameraTargetHeightOffset() ?? 0;
        this._seat = ArrivalSpace.attachPlayerToEntity(this.entity, {
            // the clip's feet stay on the floor; a higher seat lifts the sitter, the feet hang
            offset: { x: 0, y: (this.seatHeight - SitDown.CLIP_SEAT) * k, z: -0.1 * k },
            animations: { Idle: clip, Forward: clip, Backward: clip, Left: clip, Right: clip, Jumping: clip },
            disableCollision: true,
            camera: { heightOffset: height - 0.4 * k },
        });
        this._seatedFor = 0;
        if (this._chair) this.setOutline(this._chair, false);
    }

    _stand() {
        if (!this._seat) return;
        this._seat.detach();
        this._seat = null;
        const front = this.entity.getPosition().clone().add(this.entity.forward.clone().mulScalar(-0.6 * this._k));
        ArrivalSpace.teleportPlayer(front, { forward: this.entity.forward.clone().mulScalar(-1) });
    }

    update(dt) {
        if (this._seat) {
            this._seatedFor += dt;
            const move = ArrivalSpace.getMoveInput();
            // a moment's grace: a key still held from walking up should not stand you straight back up
            if (this._seatedFor > 0.4 && (Math.abs(move.forward) > 0.1 || Math.abs(move.strafe) > 0.1 || move.jump)) this._stand();
        }
        const label = this._seat ? "Stand up (E)" : !this._occupied && this._near() ? "Sit down (E)" : null;
        this._ui.style.display = label ? "block" : "none";
        if (label && this._ui.textContent !== label) this._ui.textContent = label;
    }

    destroy() {
        this._stand();
        window.removeEventListener("keydown", this._onKey);
        [...this._offs, ...this._chairOffs].forEach((off) => off());
        this.removeUI();
    }
}
