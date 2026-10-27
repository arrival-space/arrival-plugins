/**
 * Presenter Mode — give a guided tour: everyone else in the space sees what you see.
 *
 * Drop it into a space. Whoever may present gets a "Present" button at the top of the screen.
 * While presenting, your camera (position, direction, zoom) is shared about ten times a second.
 * Everyone else follows it smoothly in their own free camera, under a banner naming the presenter,
 * and their avatars are kept near yours so voice chat stays in earshot. A viewer can "Stop
 * following" (or just fly or change the camera mode) and "Follow" again at any time.
 * The presenter can "Gather everyone" next to their avatar and "Stop" the presentation.
 *
 * One presentation at a time. Late joiners pick up the running presentation within a second;
 * if the presenter leaves the space or stops sending, viewers get their own camera back.
 *
 * Features demonstrated:
 * - ArrivalSpace.net.send / on / onPlayerJoin / onPlayerLeave: a pose stream plus a heartbeat,
 *   so no state needs to be stored or cleaned up
 * - ArrivalSpace.setFreeCamPose driven every frame, with exponential smoothing between updates
 * - ArrivalSpace.teleportPlayer: keeping avatars together and gathering them
 * - handing the camera back: restoring the camera mode and field of view the viewer had
 *
 * Requires ArrivalSpace.VERSION >= 1.19.0.
 */
const POSE = "PresenterMode:pose";
const STOP = "PresenterMode:stop";
const GATHER = "PresenterMode:gather";
const TIMEOUT_MS = 3000; // no pose for this long: the presentation is over

export class PresenterMode extends ArrivalScript {
    static scriptName = "presenterMode";

    whoCanPresent = "Editors only";
    keepAvatarsNear = true;
    followSmoothing = 6;

    static properties = {
        whoCanPresent: { title: "Who can present", options: ["Editors only", "Anyone"] },
        keepAvatarsNear: { title: "Keep viewers' avatars near the presenter (voice chat range)" },
        followSmoothing: { title: "Camera follow smoothing (higher: tighter)", min: 1, max: 20, step: 0.5 },
    };

    _presenting = false;
    _since = 0;        // when this client started presenting (tie-break between two presenters)
    _sendT = 0;
    _lastKey = "";
    _remote = null;    // { userID, name, since, lastAt, pos, fwd, fov, avatar } of the presenter we see
    _following = false;
    _optedOut = false; // the viewer left this presentation; don't pull them back in
    _saved = null;     // { mode, fov } the viewer had before this presentation
    _camPos = new pc.Vec3();
    _camFwd = new pc.Vec3();
    _camTaken = false; // the free cam is ours (set after the first pose we drove)
    _lastHop = 0;

    initialize() {
        this._bar = this.createUI("div", {
            style: {
                position: "fixed", top: "64px", left: "50%", transform: "translateX(-50%)",
                display: "flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 14px",
                background: "rgba(15, 18, 24, 0.85)", backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.14)", borderRadius: "999px",
                color: "#fff", font: "600 14px 'Segoe UI', sans-serif", zIndex: "1000",
                userSelect: "none", whiteSpace: "nowrap",
            },
        });
        this._bar.addEventListener("click", (e) => {
            const act = e.target.closest("button")?.dataset.act;
            if (act) this[act]();
        });

        this._offs = [
            ArrivalSpace.net.on(POSE, (d) => this._onPose(d)),
            ArrivalSpace.net.on(STOP, (d) => String(d.senderId) === this._remote?.userID && this._release()),
            ArrivalSpace.net.on(GATHER, (d) => this._hopNear(new pc.Vec3(d.a[0], d.a[1], d.a[2]))),
            ArrivalSpace.net.onPlayerJoin(() => this._render()),
            ArrivalSpace.net.onPlayerLeave((p) => {
                if (String(p.userID) === this._remote?.userID) this._release();
                else this._render();
            }),
        ];
        this._render();
    }

    update(dt) {
        if (this._presenting) this._broadcast(dt);
        if (this._remote && performance.now() - this._remote.lastAt > TIMEOUT_MS) this._release();
        if (this._following) this._follow(dt);
    }

    onPropertyChanged() {
        this._render();
    }

    destroy() {
        this._offs.forEach((off) => off());
        if (this._presenting) ArrivalSpace.net.send(STOP, {});
        if (this._following) this._stopFollowing();
        this.removeUI();
    }

    // ── Presenter ──────────────────────────────────────────────

    startPresenting() {
        this._presenting = true;
        this._since = Date.now();
        this._sendT = 1; // send the first pose right away
        this._lastKey = "";
        this._render();
    }

    stopPresenting() {
        this._presenting = false;
        ArrivalSpace.net.send(STOP, {});
        this._render();
    }

    gather() {
        ArrivalSpace.net.send(GATHER, { a: this._vec(ArrivalSpace.getPlayer().getPosition()) });
    }

    /** Poses at up to 10 Hz while the view changes, and a heartbeat every second while it doesn't. */
    _broadcast(dt) {
        this._sendT += dt;
        if (this._sendT < 0.1) return;
        const cam = ArrivalSpace.getCamera();
        const pose = {
            p: this._vec(cam.getPosition()),
            f: this._vec(cam.forward),
            fov: Math.round(cam.camera.fov * 10) / 10,
            a: this._vec(ArrivalSpace.getPlayer().getPosition()),
        };
        const key = JSON.stringify(pose);
        if (key === this._lastKey && this._sendT < 1) return;
        this._lastKey = key;
        this._sendT = 0;
        ArrivalSpace.net.send(POSE, { ...pose, since: this._since });
    }

    _vec(v) {
        return [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000, Math.round(v.z * 1000) / 1000];
    }

    // ── Viewer ─────────────────────────────────────────────────

    _onPose(d) {
        const id = String(d.senderId);
        if (this._presenting) {
            // Two presenters at once: the one who started first keeps presenting.
            const mine = String(ArrivalSpace.getUser().userID);
            if (d.since > this._since || (d.since === this._since && id > mine)) return;
            this._presenting = false;
        }
        const isNew = this._remote?.userID !== id;
        if (isNew) {
            this._remote = { userID: id, name: d.senderName || "Someone", pos: new pc.Vec3(), fwd: new pc.Vec3(), avatar: new pc.Vec3() };
            this._optedOut = false;
        }
        const r = this._remote;
        r.lastAt = performance.now();
        r.pos.set(d.p[0], d.p[1], d.p[2]);
        r.fwd.set(d.f[0], d.f[1], d.f[2]);
        r.avatar.set(d.a[0], d.a[1], d.a[2]);
        r.fov = d.fov;

        if (isNew && !this._following) {
            if (this._optedOut) this._render();
            else this.follow();
        }
        if (this._following && this.keepAvatarsNear && performance.now() - this._lastHop > 2000
            && ArrivalSpace.getPlayer().getPosition().distance(r.avatar) > 8) {
            this._hopNear(r.avatar);
        }
    }

    follow() {
        const cam = ArrivalSpace.getCamera();
        // Kept for the whole presentation: following again after flying off still ends in the viewer's own mode.
        this._saved ??= { mode: ArrivalSpace.getCameraMode(), fov: cam.camera.fov };
        this._camPos.copy(cam.getPosition());
        this._camFwd.copy(cam.forward);
        this._camTaken = false;
        this._following = true;
        this._optedOut = false;
        this._render();
    }

    stopFollowing() {
        this._stopFollowing();
        this._optedOut = true;
        this._render();
    }

    _stopFollowing() {
        this._following = false;
        const cam = ArrivalSpace.getCamera();
        // Leaving the free cam restores the viewer's own field of view; staying in it doesn't.
        if (this._saved.mode !== "free" && ArrivalSpace.getCameraMode() === "free") ArrivalSpace.setCameraMode(this._saved.mode);
        else cam.camera.fov = this._saved.fov;
    }

    _follow(dt) {
        // The viewer took the camera back: flew, or switched camera mode.
        if (this._camTaken && (ArrivalSpace.getCameraMode() !== "free" || this._hasFlyInput())) {
            this._following = false;
            if (ArrivalSpace.getCameraMode() === "free") ArrivalSpace.getCamera().camera.fov = this._saved.fov;
            this._optedOut = true;
            this._render();
            return;
        }
        const r = this._remote;
        const k = 1 - Math.exp(-this.followSmoothing * dt);
        this._camPos.lerp(this._camPos, r.pos, k);
        this._camFwd.lerp(this._camFwd, r.fwd, k).normalize();
        ArrivalSpace.setFreeCamPose(this._camPos, this._camPos.clone().add(this._camFwd));
        const cam = ArrivalSpace.getCamera().camera;
        cam.fov += (r.fov - cam.fov) * k;
        this._camTaken = true;
    }

    _hasFlyInput() {
        this._freeCam ??= this.app.root.find((n) => n.script?.freeCamView)[0]?.script.freeCamView;
        return !!(this._freeCam && (this._freeCam.forwardValue || this._freeCam.sidewardValue || this._freeCam.upwardValue));
    }

    /** A spot 1.5 m from `center`, its direction fixed per user so a group spreads around it. */
    _hopNear(center) {
        let h = 0;
        for (const c of String(ArrivalSpace.getUser().userID)) h = (h * 31 + c.charCodeAt(0)) | 0;
        const angle = ((h >>> 0) % 360) * pc.math.DEG_TO_RAD;
        const pos = new pc.Vec3(center.x + Math.sin(angle) * 1.5, center.y, center.z + Math.cos(angle) * 1.5);
        ArrivalSpace.teleportPlayer(pos, { forward: { x: center.x - pos.x, y: 0, z: center.z - pos.z } });
        this._lastHop = performance.now();
    }

    _release() {
        if (this._following) this._stopFollowing();
        this._saved = null;
        this._remote = null;
        this._optedOut = false;
        this._render();
    }

    // ── UI ─────────────────────────────────────────────────────

    _render() {
        const canPresent = this.whoCanPresent === "Anyone" || ArrivalSpace.canEditSpace();
        const btn = (act, label, primary) => `<button data-act="${act}" style="
            padding: 9px 16px; border-radius: 999px; border: none; cursor: pointer; font: inherit;
            color: #fff; background: ${primary ? "#e5484d" : "rgba(255,255,255,0.14)"};">${label}</button>`;
        const dot = `<span style="width:9px;height:9px;border-radius:50%;background:#e5484d;box-shadow:0 0 8px #e5484d"></span>`;
        const name = (this._remote?.name || "").replace(/[<>&"]/g, "");
        let html = "";
        if (this._presenting) {
            const n = ArrivalSpace.net.getPlayers().length;
            html = `${dot}<span>Presenting to ${n} ${n === 1 ? "viewer" : "viewers"}</span>`
                + btn("gather", "Gather everyone") + btn("stopPresenting", "Stop", true);
        } else if (this._remote) {
            html = this._following
                ? `${dot}<span>${name} is presenting — Following</span>` + btn("stopFollowing", "Stop following")
                : `<span>${name} is presenting</span>` + btn("follow", "Follow", true);
        } else if (canPresent) {
            html = `<span>Presenter mode</span>` + btn("startPresenting", "Present", true);
        }
        this._bar.innerHTML = html;
        this._bar.style.display = html ? "flex" : "none";
    }
}
