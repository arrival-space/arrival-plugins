/**
 * Rail Camera — click a box to enter a constrained free-fly camera.
 *
 * Place the vibe where the camera rig should live. A clickable box is drawn
 * around the placement; clicking it switches the player into a *constrained*
 * free camera that can only slide along the axes you enable:
 *
 *   - Left/Right   (A/D — the vibe's local X)
 *   - Up/Down      (E/Q — the vibe's local Y)
 *   - Forward/Back (W/S — the vibe's local Z)
 *
 * Each axis is an independent toggle, so you can build a 1-D rail (left/right
 * only), a 2-D pan plane, or a full 3-D dolly. Travel is limited per axis and
 * clamped independently (a box, not a sphere) so one edge never slows the others.
 * Up and down have separate limits (`maxUp` / `maxDown`), so the start position
 * (the rail origin set by `cameraOffset`) can sit anywhere in the vertical
 * travel; left/right and forward/back are symmetric (`maxLeftRight` /
 * `maxForwardBack`). The view direction is free by default — look anywhere with
 * the mouse — but an optional yaw/pitch limit is wired up for a bounded cone.
 *
 * Controls: WASD / arrows to slide along the rails, E/Q for up/down, drag to
 * look, scroll wheel to change FOV. Exit with [Esc] or the on-screen button.
 *
 * How it works:
 * - It enters the built-in free cam ("free" mode) so look (mouse) and the WASD
 *   input pipeline are live, but it *ignores* the free cam's camera-relative
 *   motion: every frame in postUpdate() it reads the raw movement intent and
 *   integrates the rig's position along the FIXED rail axes itself, then writes
 *   the clamped position back. So WASD always moves along the rails — never in
 *   the direction you happen to be looking — while mouse-look stays free.
 * - The rail axes are the vibe's own local axes, so the rail follows however the
 *   vibe is rotated. With no view limit, their signs are matched to your approach
 *   so W is "forward" / D "right" and the view doesn't snap. With a yaw/pitch
 *   limit on, the canonical forward is kept instead, so the look-cone (and the
 *   entry view) is fixed to the vibe and identical from any side you approach.
 *   A/D → left-right · W/S → forward-back (→ up-down if forward-back is off) ·
 *   E/Q → up-down.
 * - The scroll wheel is intercepted in the capture phase and repurposed for FOV
 *   (the free cam normally uses it for speed).
 * - The trigger box is hit-tested in the rig's local space (oriented box), so it
 *   follows the vibe's rotation and scale, and works whether or not it's visible.
 *
 * Features demonstrated:
 * - setCameraMode / getCameraMode / setFreeCamPose, freeCamView FOV control
 * - setAppUIVisible(false) for a clean viewport + a camera-viewfinder overlay
 *   (corner brackets, crosshair, letterbox bars, D-pad, zoom rocker, exposure meter)
 * - setPostEffects({ brightness }) driven by an EV exposure meter (restored on exit)
 * - An HDR toggle (right of the EV +) that switches tone mapping to HDR Neutral
 *   (pc.TONEMAP_NEUTRAL on the HDR pipeline), reverting to the room's own tone on exit
 * - Reaching the freeCamView script to drive the camera each frame
 * - Reading raw movement intent (fcv.forwardValue / sidewardValue / upwardValue)
 * - Manual oriented-box ray pick + capture-phase wheel interception
 * - Edit-mode guard (onEditModeChanged) so clicking edits the vibe, not enters
 * - onKeyDown("escape", ...) and a createUI()-based HUD
 */
export class RailCamera extends ArrivalScript {
    static scriptName = "Rail Camera";

    // ── Trigger box (clickable region around the placement) ──
    boxSize = { x: 1.5, y: 1.5, z: 1.5 };
    showBox = true;
    boxColor = "#4fc3ff";
    boxOpacity = 0.15;
    maxClickDistance = 40;

    // ── Rail constraints ──
    // Rails are aligned to the vibe's own orientation (its local axes), so
    // rotating the vibe rotates the rail. The sign of each axis is matched to your
    // view on enter so W goes "forward" and D "right".
    allowLeftRight = true;     // A/D — the vibe's local left/right
    allowUpDown = false;       // E/Q — the vibe's local up/down
    allowForwardBack = true;   // W/S — the vibe's local forward/back
    // Per-axis travel limits, in metres from the start (the rail origin). Clamped
    // independently (a box, not a sphere) so one edge never slows the others. Up
    // and down are separate, so the start can sit anywhere in the vertical travel
    // — e.g. maxUp 2 / maxDown 0 starts you at the floor of the rail.
    maxLeftRight = 4;
    maxUp = 2;
    maxDown = 1;
    maxForwardBack = 4;
    cameraOffset = { x: 0, y: 1.5, z: 0 }; // start position (rail origin) offset from the placement
    moveSpeed = 3;
    smoothing = 0.15;          // velocity ease-in/out time constant (s); 0 = instant
    fov = 60;                  // field of view on enter; scroll wheel adjusts it live
    aspectRatio = 2.39;        // letterbox the view to this aspect (0 = off / fill screen)
    exposure = 0;              // starting exposure on the −3..+3 meter (0 = scene default)

    // ── Optional view limit (off by default — "may add later") ──
    // When on, the cone is centred on the vibe's forward (not your entry heading),
    // so it's the same from any approach — and entry faces that forward.
    limitYaw = false;
    yawRange = 180;            // horizontal cone around the vibe's forward, ° (±yawRange/2)
    limitPitch = false;
    pitchRange = 90;           // vertical cone around the horizon, ° (±pitchRange/2)

    static properties = {
        boxSize: { title: "Trigger Box Size" },
        showBox: { title: "Show Box" },
        boxColor: { title: "Box Color" },
        boxOpacity: { title: "Box Opacity", min: 0, max: 1, step: 0.01 },
        maxClickDistance: { title: "Max Click Distance", min: 1, max: 200, step: 1 },

        allowLeftRight: { title: "Allow Left / Right" },
        allowUpDown: { title: "Allow Up / Down" },
        allowForwardBack: { title: "Allow Forward / Back" },
        maxLeftRight: { title: "Max Left/Right (m)", min: 0, max: 100, step: 0.1 },
        maxUp: { title: "Max Up (m)", min: 0, max: 100, step: 0.1 },
        maxDown: { title: "Max Down (m)", min: 0, max: 100, step: 0.1 },
        maxForwardBack: { title: "Max Forward/Back (m)", min: 0, max: 100, step: 0.1 },
        cameraOffset: { title: "Camera Offset" },
        moveSpeed: { title: "Move Speed (m/s)", min: 0.1, max: 30, step: 0.1 },
        smoothing: { title: "Movement Smoothing", min: 0, max: 1, step: 0.01 },
        fov: { title: "Field of View", min: 20, max: 100, step: 1 },
        aspectRatio: { title: "Letterbox Aspect (0 = off)", min: 0, max: 4, step: 0.01 },
        exposure: { title: "Exposure (EV)", min: -3, max: 3, step: 0.1 },

        limitYaw: { title: "Limit Yaw" },
        yawRange: { title: "Yaw Range (°)", min: 0, max: 360, step: 1 },
        limitPitch: { title: "Limit Pitch" },
        pitchRange: { title: "Pitch Range (°)", min: 0, max: 150, step: 1 },
    };

    // ── internal state ──
    _active = false;
    _prevMode = "third";
    _editingThisVibe = false;
    _hovered = false;

    _boxEntity = null;
    _boxMat = null;
    _boxHoverMat = null;

    _freeCamView = null;
    _hud = null;
    _frameEl = null;       // letterboxed frame element (carries the black bars)
    _fovEl = null;         // focal-length readout element
    _markEl = null;        // exposure meter marker element
    _evEl = null;          // exposure meter EV value element
    _uiHidden = false;     // whether we hid the app's built-in UI
    _padStrafe = 0;        // on-screen D-pad: -1 (A) .. +1 (D)
    _padVert = 0;          // on-screen D-pad: -1 (Q) .. +1 (E)
    _zoomDir = 0;          // zoom rocker: +1 wide (FOV up) / -1 tele (FOV down)
    _expoDir = 0;          // exposure −/+ buttons: -1 darker / +1 brighter
    _expoEv = 0;           // current exposure on the −3..+3 meter
    _baseBrightness = 1;   // scene brightness captured on enter (restored on exit)
    _expoApplied = false;  // whether we have a brightness override in effect
    _hdrNeutral = false;   // HDR Neutral tone-map toggle (the button right of the EV +)

    _onDown = null;
    _onMove = null;
    _onWheel = null;
    _escUnsub = null;

    // rail frame, captured on enter
    _origin = new pc.Vec3();
    _axR = new pc.Vec3(1, 0, 0);
    _axU = new pc.Vec3(0, 1, 0);
    _axF = new pc.Vec3(0, 0, -1);
    _centerYaw = 0;
    _railOffset = new pc.Vec3(); // current camera offset from origin, in world space
    _vel = new pc.Vec3();        // current movement velocity (world space, eased)
    _currentFov = 60;

    // scratch (avoid per-frame allocation)
    _t1 = new pc.Vec3();
    _t2 = new pc.Vec3();
    _t3 = new pc.Vec3();
    _t4 = new pc.Vec3();
    _tA = new pc.Vec3();
    _mInv = new pc.Mat4();

    initialize() {
        this._buildBox();
        this._bindPointer();
        this._escUnsub = this.onKeyDown("escape", () => { if (this._active) this._exit(); });
    }

    update(dt) {
        if (this._active) {
            // Zoom rocker ramps FOV while held; keep the readout in sync (the scroll
            // wheel changes it too).
            if (this._zoomDir !== 0) {
                this._currentFov = pc.math.clamp(this._currentFov + this._zoomDir * 35 * (dt || 0), 20, 100);
                this._getFreeCamView()?.setFOV?.(this._currentFov);
            }
            if (this._fovEl) this._fovEl.textContent = this._focalFromFov(this._currentFov);
            if (this._expoDir !== 0) {
                this._expoEv = pc.math.clamp(this._expoEv + this._expoDir * 2 * (dt || 0), -3, 3);
                this._applyExposure();
            }
            return;
        }
        // Re-assert the hover cursor each frame: the client's own hover system
        // (click-to-highlight) rewrites document.body.style.cursor on pointer-move,
        // and our trigger box has no collision for it to detect, so without this it
        // would clear our pointer. Only writes while actually hovering.
        if (this._hovered && document.body.style.cursor !== "pointer") {
            document.body.style.cursor = "pointer";
        }
    }

    // Movement runs in postUpdate so it writes the final position *after* the free
    // cam's own update this frame — we ignore its camera-relative motion entirely
    // and drive the rig along the fixed rail axes instead.
    postUpdate(dt) {
        if (!this._active) return;

        // External code (or the user, e.g. pressing F) left free cam — tear down.
        if (ArrivalSpace.getCameraMode?.() !== "free") {
            this._deactivate();
            return;
        }
        this._drive(dt || 0);
    }

    onPropertyChanged(name) {
        if (name === "boxSize" || name === "showBox" || name === "boxColor" || name === "boxOpacity") {
            this._buildBox();
            return;
        }
        if (name === "cameraOffset" && this._active) {
            this._recomputeOrigin();
            return;
        }
        if (name === "fov" && this._active) {
            this._currentFov = pc.math.clamp(this.fov, 20, 100);
            this._getFreeCamView()?.setFOV?.(this._currentFov);
            return;
        }
        if (name === "aspectRatio" && this._active) {
            this._applyLetterbox();
            return;
        }
        if (name === "exposure" && this._active) {
            this._expoEv = pc.math.clamp(Number(this.exposure) || 0, -3, 3);
            this._applyExposure();
        }
    }

    onEditModeChanged(isEditing) {
        this._editingThisVibe = !!isEditing;
        // If the editor opens on this vibe while we're driving the camera, bail out.
        if (isEditing && this._active) this._exit();
    }

    // ── Enter / exit ─────────────────────────────────────────────────────────

    _enter() {
        if (this._active) return;
        if (typeof ArrivalSpace.setFreeCamPose !== "function") {
            console.warn("[RailCamera] Requires client VERSION >= 1.11.0 (setFreeCamPose).");
            return;
        }

        this._prevMode = ArrivalSpace.getCameraMode?.() || "third";
        this._captureRails(); // axes from the current view, before switching to free cam
        this._railOffset.set(0, 0, 0); // start at the origin
        this._vel.set(0, 0, 0);        // start at rest

        const lookAt = this._t4.copy(this._origin).add(this._t3.copy(this._axF).mulScalar(2));
        ArrivalSpace.setFreeCamPose(this._origin, lookAt);

        const fcv = this._getFreeCamView();
        this._currentFov = pc.math.clamp(this.fov, 20, 100);
        fcv?.setFOV?.(this._currentFov);

        this._active = true;
        this._setHover(false);
        if (this._boxEntity) this._boxEntity.enabled = false; // don't tint the view from inside
        this._showHud();
    }

    _exit() {
        if (!this._active) return;
        if (ArrivalSpace.getCameraMode?.() === "free") {
            ArrivalSpace.setCameraMode?.(this._prevMode || "third");
        }
        this._deactivate();
    }

    // Shared cleanup for explicit exit and "kicked out of free cam" cases.
    _deactivate() {
        this._active = false;
        if (this._boxEntity) this._boxEntity.enabled = !!this.showBox;
        this._hideHud();
    }

    // Capture the rail axes from the ENTITY's local orientation (call before
    // switching to free cam), so the rail follows however the vibe is rotated.
    // The axes are then frozen for the whole session.
    _captureRails() {
        this._axR.copy(this.entity.right).normalize();
        this._axU.copy(this.entity.up).normalize();
        this._axF.copy(this.entity.forward).normalize();
        if (this._axU.y < 0) this._axU.mulScalar(-1); // keep "up" pointing up

        // With a view limit active, keep the vibe's CANONICAL forward/right so the
        // allowed look-cone (and the entry view we aim at) is identical no matter
        // which side you approach from. Without a limit, sign the forward/right to
        // your approach instead, so there's no view snap and W/D track your heading.
        // Either way the axis *directions* stay locked to the entity.
        if (!this.limitYaw && !this.limitPitch) {
            const cam = ArrivalSpace.getCamera?.();
            const viewF = cam ? this._t1.copy(cam.forward) : this._t1.set(0, 0, -1);
            const viewR = cam ? this._t2.copy(cam.right) : this._t2.set(1, 0, 0);
            if (this._axF.dot(viewF) < 0) this._axF.mulScalar(-1);
            if (this._axR.dot(viewR) < 0) this._axR.mulScalar(-1);
        }

        // Yaw cone is centred on the forward axis (free cam yaw convention:
        // yaw = atan2(forward.x, forward.z)). Fixed to the vibe when limiting.
        this._centerYaw = Math.atan2(this._axF.x, this._axF.z) * pc.math.RAD_TO_DEG;

        this._recomputeOrigin();
    }

    _recomputeOrigin() {
        const off = this.cameraOffset || {};
        this._origin.copy(this.entity.getPosition())
            .add(this._t1.copy(this._axR).mulScalar(off.x || 0))
            .add(this._t1.copy(this._axU).mulScalar(off.y || 0))
            .add(this._t1.copy(this._axF).mulScalar(off.z || 0));
    }

    // ── Per-frame movement along the rails ───────────────────────────────────

    _drive(dt) {
        const fcv = this._getFreeCamView();
        if (!fcv || !fcv.entity) return;

        // Read the raw movement *intent* (independent of where the camera looks).
        // fcv.*Value are set by the WASD / arrow / E-Q key events the free cam uses;
        // the on-screen D-pad adds its A/D (strafe) and E/Q (vertical) intent on top.
        const fwd = fcv.forwardValue || 0;   // W = +1, S = -1
        const strafe = pc.math.clamp((fcv.sidewardValue || 0) + this._padStrafe, -1, 1); // D=+1, A=-1
        const vert = pc.math.clamp((fcv.upwardValue || 0) + this._padVert, -1, 1);       // E=+1, Q=-1

        // Map the intent onto the FIXED rail axes into a target velocity (m/s):
        //   A/D → left-right · W/S → forward-back (falls back to up-down when
        //   forward-back is disabled) · E/Q → up-down. Each only if its axis is on.
        const targetVel = this._t1.set(0, 0, 0);
        if (this.allowLeftRight && strafe) targetVel.add(this._tA.copy(this._axR).mulScalar(strafe));
        if (fwd) {
            if (this.allowForwardBack) targetVel.add(this._tA.copy(this._axF).mulScalar(fwd));
            else if (this.allowUpDown) targetVel.add(this._tA.copy(this._axU).mulScalar(fwd));
        }
        if (this.allowUpDown && vert) targetVel.add(this._tA.copy(this._axU).mulScalar(vert));
        targetVel.mulScalar(this.moveSpeed);

        // Ease the velocity toward the target (smooth in and out). `smoothing` is a
        // time constant in seconds; 0 snaps to the target instantly (original feel).
        // 1 - exp(-dt/tau) is the frame-rate-independent exponential blend factor.
        const tau = Math.max(0, this.smoothing);
        if (tau < 1e-4) this._vel.copy(targetVel);
        else this._vel.lerp(this._vel, targetVel, 1 - Math.exp(-dt / tau));

        this._railOffset.add(this._t3.copy(this._vel).mulScalar(dt));

        // Decompose onto the rail axes, then clamp each axis INDEPENDENTLY to its
        // own ±max (a box, not a sphere). Disallowed axes clamp to 0, which also
        // snaps back cleanly if an axis was just toggled off. Clamping each axis on
        // its own means hitting one edge never rescales (and slows) the others.
        let cR = this.allowLeftRight ? this._railOffset.dot(this._axR) : 0;
        let cU = this.allowUpDown ? this._railOffset.dot(this._axU) : 0;
        let cF = this.allowForwardBack ? this._railOffset.dot(this._axF) : 0;
        cR = pc.math.clamp(cR, -Math.max(0, this.maxLeftRight), Math.max(0, this.maxLeftRight));
        cU = pc.math.clamp(cU, -Math.max(0, this.maxDown), Math.max(0, this.maxUp)); // +up / -down
        cF = pc.math.clamp(cF, -Math.max(0, this.maxForwardBack), Math.max(0, this.maxForwardBack));
        this._railOffset.set(0, 0, 0)
            .add(this._tA.copy(this._axR).mulScalar(cR))
            .add(this._tA.copy(this._axU).mulScalar(cU))
            .add(this._tA.copy(this._axF).mulScalar(cF));

        const target = this._t4.copy(this._origin).add(this._railOffset);
        fcv.setInitPosition(target);

        if (this.limitYaw && typeof fcv.yaw === "number") {
            const half = Math.max(0, this.yawRange) / 2;
            fcv.yawTarget = this._clampYaw(fcv.yawTarget ?? fcv.yaw, this._centerYaw, half);
            fcv.yaw = this._clampYaw(fcv.yaw, this._centerYaw, half);
        }
        if (this.limitPitch && typeof fcv.pitch === "number") {
            const half = Math.max(0, this.pitchRange) / 2;
            fcv.pitchTarget = pc.math.clamp(fcv.pitchTarget ?? fcv.pitch, -half, half);
            fcv.pitch = pc.math.clamp(fcv.pitch, -half, half);
        }
    }

    _clampYaw(angle, center, half) {
        let d = angle - center;
        d = ((d % 360) + 540) % 360 - 180; // shortest signed diff in [-180, 180)
        if (d > half) d = half;
        else if (d < -half) d = -half;
        return center + d;
    }

    _getFreeCamView() {
        if (!this._freeCamView || !this._freeCamView.entity) {
            const entity = this.app.root.find((n) => n.script?.freeCamView)[0];
            this._freeCamView = entity?.script?.freeCamView || null;
        }
        return this._freeCamView;
    }

    // ── Trigger box ──────────────────────────────────────────────────────────

    _buildBox() {
        this._destroyBox();

        const rgb = this._hexToRgb01(this.boxColor, { r: 0.31, g: 0.76, b: 1 });
        this._boxMat = ArrivalSpace.createMaterial({
            diffuse: rgb,
            emissive: rgb,
            emissiveIntensity: 0.4,
            opacity: pc.math.clamp(this.boxOpacity, 0, 1),
            transparent: true,
            useLighting: false,
            doubleSided: true,
        });
        this._boxHoverMat = ArrivalSpace.createMaterial({
            diffuse: rgb,
            emissive: rgb,
            emissiveIntensity: 0.9,
            opacity: pc.math.clamp(this.boxOpacity + 0.18, 0.05, 1),
            transparent: true,
            useLighting: false,
            doubleSided: true,
        });

        this._boxEntity = new pc.Entity("RailCameraTrigger");
        this._boxEntity.addComponent("render", { type: "box", material: this._boxMat });
        this._boxEntity.render.castShadows = false;
        this._boxEntity.render.receiveShadows = false;
        this.entity.addChild(this._boxEntity);
        this._boxEntity.setLocalPosition(0, 0, 0);
        this._updateBoxScale();
        this._boxEntity.enabled = !!this.showBox && !this._active;
    }

    _updateBoxScale() {
        if (!this._boxEntity) return;
        const s = this.boxSize || {};
        this._boxEntity.setLocalScale(
            Math.max(0.01, s.x || 1),
            Math.max(0.01, s.y || 1),
            Math.max(0.01, s.z || 1)
        );
    }

    // ── Pointer picking ──────────────────────────────────────────────────────

    _bindPointer() {
        this._onDown = (e) => {
            if (this._active) return;
            if (e.button !== undefined && e.button !== 0) return;
            if (this._isEditing()) return;
            if (!this._hitTestBox(e)) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            this._enter();
        };
        this._onMove = (e) => {
            if (this._active) { this._setHover(false); return; }
            this._setHover(!this._isEditing() && this._hitTestBox(e));
        };
        // Capture-phase wheel: while in rail mode, repurpose the wheel for FOV and
        // stop it reaching the free cam's own (bubble-phase) wheel→speed handler.
        this._onWheel = (e) => {
            if (!this._active) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            this._currentFov = pc.math.clamp(this._currentFov + e.deltaY * 0.05, 20, 100);
            this._getFreeCamView()?.setFOV?.(this._currentFov);
        };
        window.addEventListener("pointerdown", this._onDown, true);
        window.addEventListener("pointermove", this._onMove, true);
        window.addEventListener("wheel", this._onWheel, { capture: true, passive: false });
    }

    _unbindPointer() {
        if (this._onDown) window.removeEventListener("pointerdown", this._onDown, true);
        if (this._onMove) window.removeEventListener("pointermove", this._onMove, true);
        if (this._onWheel) window.removeEventListener("wheel", this._onWheel, { capture: true });
        this._onDown = this._onMove = this._onWheel = null;
    }

    _hitTestBox(event) {
        const cam = ArrivalSpace.getCamera?.();
        const camC = cam?.camera;
        if (!cam || !camC?.screenToWorld) return false;

        const ray = this._pointerRay(event, cam, camC);
        if (!ray) return false;
        if (ray.origin.distance(this.entity.getPosition()) > Math.max(1, this.maxClickDistance)) return false;

        // Transform the ray into the rig's local space and slab-test the box.
        const inv = this._mInv.copy(this.entity.getWorldTransform()).invert();
        const o = inv.transformPoint(ray.origin, this._t1);
        const d = inv.transformVector(ray.direction, this._t2);
        const s = this.boxSize || {};
        return this._raySlab(o, d,
            Math.max(0.005, (s.x || 1) / 2),
            Math.max(0.005, (s.y || 1) / 2),
            Math.max(0.005, (s.z || 1) / 2));
    }

    _raySlab(o, d, hx, hy, hz) {
        let tmin = -Infinity, tmax = Infinity;
        const oc = [o.x, o.y, o.z], dc = [d.x, d.y, d.z], h = [hx, hy, hz];
        for (let i = 0; i < 3; i++) {
            if (Math.abs(dc[i]) < 1e-8) {
                if (oc[i] < -h[i] || oc[i] > h[i]) return false;
            } else {
                let t1 = (-h[i] - oc[i]) / dc[i];
                let t2 = (h[i] - oc[i]) / dc[i];
                if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                if (t1 > tmin) tmin = t1;
                if (t2 < tmax) tmax = t2;
                if (tmin > tmax) return false;
            }
        }
        return tmax >= Math.max(tmin, 0);
    }

    _pointerRay(event, cam, camC) {
        const canvas = this.app?.graphicsDevice?.canvas;
        const rect = canvas?.getBoundingClientRect?.();
        const rawX = event.clientX ?? event.pageX;
        const rawY = event.clientY ?? event.pageY;
        if (rawX === undefined || rawY === undefined) return null;

        const x = rect ? (rawX - rect.left) * ((canvas.width || rect.width) / rect.width) : rawX;
        const y = rect ? (rawY - rect.top) * ((canvas.height || rect.height) / rect.height) : rawY;
        const near = Math.max(0.01, camC.nearClip || 0.1);
        const far = Math.max(near + 1, Math.min(2000, this.maxClickDistance || 40));
        const origin = cam.getPosition().clone();
        const direction = camC.screenToWorld(x, y, far).sub(origin).normalize();
        return { origin, direction };
    }

    _setHover(hit) {
        if (hit === this._hovered) return;
        this._hovered = hit;
        // The client drives the cursor via document.body (the canvas sits under a
        // full-window UI overlay), so set it there — not on the canvas.
        document.body.style.cursor = hit ? "pointer" : "auto";
        if (this._boxEntity?.render) {
            this._boxEntity.render.material = hit ? this._boxHoverMat : this._boxMat;
        }
    }

    _isEditing() {
        if (this._editingThisVibe) return true;
        try {
            if (window.ReactUI?.currentSessionStore?.getState?.().isEditingSpace) return true;
        } catch (_) { /* internals not available — assume play mode */ }
        return false;
    }

    // ── Viewfinder HUD ─────────────────────────────────────────────────────────

    _showHud() {
        this._hideHud();

        // The overlay is pointer-events:none so look/drag pass through it; only the
        // small exit pill is interactive.
        this._hud = this.createUI("div", {
            interactive: false,
            innerHTML: this._viewfinderHtml(),
            style: {
                position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
                pointerEvents: "none", zIndex: "1000",
                color: "#fff", fontFamily: "'Courier New', ui-monospace, monospace",
                fontWeight: "bold", letterSpacing: "1px", userSelect: "none",
                filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.6))",
            },
        });

        this._frameEl = this._hud.querySelector(".rcvf-frame");
        this._fovEl = this._hud.querySelector(".rcvf-fov");
        this._markEl = this._hud.querySelector(".rcvf-mark");
        this._evEl = this._hud.querySelector(".rcvf-ev-val");
        this._applyLetterbox();

        // Capture the scene's current brightness so exposure is an offset from it,
        // and apply the starting exposure.
        const pe = ArrivalSpace.getPostEffects?.();
        this._baseBrightness = Number(pe?.brightness) > 0 ? Number(pe.brightness) : 1;
        this._expoEv = pc.math.clamp(Number(this.exposure) || 0, -3, 3);
        this._hdrNeutral = false; // start on the room's own tone mapping
        this._applyExposure();

        // Shared press-and-hold binding for the on-screen controls (mouse + touch).
        const bindHold = (b, on) => {
            b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); on(true); });
            b.addEventListener("pointerup", (e) => { e.stopPropagation(); on(false); });
            b.addEventListener("pointerleave", () => on(false));
            b.addEventListener("pointercancel", () => on(false));
        };

        // D-pad → A/D (strafe) and E/Q (vertical) intent, added on top of the keys.
        const setDir = (dir, on) => {
            if (dir === "left") this._padStrafe = on ? -1 : 0;
            else if (dir === "right") this._padStrafe = on ? 1 : 0;
            else if (dir === "up") this._padVert = on ? 1 : 0;
            else if (dir === "down") this._padVert = on ? -1 : 0;
        };
        this._hud.querySelectorAll("[data-dir]").forEach((b) => bindHold(b, (on) => setDir(b.dataset.dir, on)));

        // Zoom rocker → ramps FOV in update() (W = wider / FOV up, T = tele / FOV down).
        this._hud.querySelectorAll("[data-zoom]").forEach((b) => {
            const d = b.dataset.zoom === "wide" ? 1 : -1;
            bindHold(b, (on) => { this._zoomDir = on ? d : 0; });
        });

        // Exposure −/+ → ramps scene brightness in update() and slides the meter.
        this._hud.querySelectorAll("[data-expo]").forEach((b) => {
            const d = Number(b.dataset.expo) || 0;
            bindHold(b, (on) => { this._expoDir = on ? d : 0; });
        });

        // HDR switch (right of the EV +) → toggles HDR Neutral tone mapping on/off.
        const hdrBtn = this._hud.querySelector("[data-hdr]");
        if (hdrBtn) {
            hdrBtn.classList.toggle("is-on", this._hdrNeutral);
            hdrBtn.addEventListener("pointerdown", (e) => {
                e.preventDefault(); e.stopPropagation();
                this._hdrNeutral = !this._hdrNeutral;
                hdrBtn.classList.toggle("is-on", this._hdrNeutral);
                this._applyExposure();
            });
        }

        const btn = this._hud.querySelector(".rcvf-exit");
        if (btn) {
            btn.addEventListener("click", () => this._exit());
            // Free the pointer lock while hovering so the click registers.
            btn.addEventListener("mouseenter", () => this.lockInput());
            btn.addEventListener("mouseleave", () => this.unlockInput());
        }

        // Immersive viewport: hide the app's built-in UI while in the camera.
        ArrivalSpace.setAppUIVisible?.(false);
        this._uiHidden = true;
    }

    _hideHud() {
        this.unlockInput();
        if (this._uiHidden) { ArrivalSpace.setAppUIVisible?.(true); this._uiHidden = false; }
        if (this._expoApplied) {
            ArrivalSpace.setPostEffects?.({ brightness: this._baseBrightness });
            this._expoApplied = false;
        }
        if (this._hud) { this._hud.remove(); this._hud = null; }
        this._frameEl = this._fovEl = this._markEl = this._evEl = null;
        this._padStrafe = this._padVert = this._zoomDir = this._expoDir = 0;
        this._hdrNeutral = false;
    }

    // Drive scene brightness from the exposure offset and reflect it on the meter.
    // When the HDR Neutral switch is on, also force the NEUTRAL tone map on the HDR
    // pipeline; when off those keys are omitted so setPostEffects merges the room's
    // own hdr/tone back in (it merges over roomData.framePosteffectParams).
    _applyExposure() {
        const ev = pc.math.clamp(this._expoEv, -3, 3);
        const brightness = pc.math.clamp(this._baseBrightness * Math.pow(2, ev / 3), 0.1, 3);
        const params = { brightness };
        if (this._hdrNeutral) {
            params.hdrEnabled = true;
            params.toneMapping = (typeof pc.TONEMAP_NEUTRAL === "number") ? pc.TONEMAP_NEUTRAL : 5;
        }
        ArrivalSpace.setPostEffects?.(params);
        this._expoApplied = true;
        if (this._markEl) this._markEl.style.left = `${((ev + 3) / 6) * 100}%`;
        if (this._evEl) this._evEl.textContent = `${ev >= 0 ? "+" : ""}${ev.toFixed(1)}`;
    }

    // Letterbox by clamping a centred rect to the target aspect and filling the
    // rest with an enormous black box-shadow — no render-target change. Width/height
    // pick the largest box of that aspect that fits, so it becomes top/bottom bars
    // (letterbox) or left/right bars (pillarbox) automatically as the window resizes.
    _applyLetterbox() {
        const el = this._frameEl;
        if (!el) return;
        const a = Number(this.aspectRatio) || 0;
        if (a > 0) {
            el.style.width = `min(100vw, calc(100vh * ${a}))`;
            el.style.height = `min(100vh, calc(100vw / ${a}))`;
            el.style.boxShadow = "0 0 0 100vmax #000";
        } else {
            el.style.width = "100%";
            el.style.height = "100%";
            el.style.boxShadow = "none";
        }
    }

    _viewfinderHtml() {
        const C = "rgba(255,255,255,0.92)";       // structural line colour
        const G = "rgba(10,12,16,0.42)";          // control "glass" fill
        const B = "rgba(255,255,255,0.5)";        // control border
        // .rcvf-frame is the letterboxed rect (sized + box-shadow by _applyLetterbox);
        // brackets / inner frame / crosshair live inside it so they hug the visible
        // area. Everything the operator touches lives in the bottom-right cluster.
        return `
        <style>
            .rcvf-frame { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
                pointer-events:none; }
            .rcvf-corner { position:absolute; width:54px; height:54px; border:3px solid ${C}; }
            .rcvf-tl { top:24px; left:24px; border-right:none; border-bottom:none; }
            .rcvf-tr { top:24px; right:24px; border-left:none; border-bottom:none; }
            .rcvf-bl { bottom:24px; left:24px; border-right:none; border-top:none; }
            .rcvf-br { bottom:24px; right:24px; border-left:none; border-top:none; }
            .rcvf-inner { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
                width:62%; height:62%; }
            .rcvf-inner::before, .rcvf-inner::after { content:''; position:absolute; top:0;
                height:100%; width:42%; border:1.5px solid ${C}; }
            .rcvf-inner::before { left:0; border-right:none; }
            .rcvf-inner::after { right:0; border-left:none; }
            .rcvf-cross { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
                width:26px; height:26px; }
            .rcvf-cross::before { content:''; position:absolute; top:50%; left:0; width:100%;
                height:2px; margin-top:-1px; background:${C}; }
            .rcvf-cross::after { content:''; position:absolute; left:50%; top:0; height:100%;
                width:2px; margin-left:-1px; background:${C}; }
            /* exit button — pinned to the viewport's top-right, its right edge
               aligned with the control cluster below (right:40px); reuses .rcvf-btn
               so it matches the operator buttons (glass fill + border) */
            .rcvf-exit { position:absolute; top:30px; right:40px; padding:0 16px; height:36px;
                border-radius:9px; font-size:14px; letter-spacing:1px; }
            .rcvf-exit:hover { background:rgba(255,255,255,0.18); }
            .rcvf-raw { position:absolute; bottom:32px; left:40px; background:#000; color:#fff;
                padding:4px 13px; border-radius:5px; font-size:16px; letter-spacing:2px; }

            /* operator control cluster — bottom-right, where the right thumb sits */
            .rcvf-cluster { position:absolute; right:40px; bottom:30px; pointer-events:none; }
            .rcvf-ctl { display:flex; align-items:stretch; gap:11px; }
            .rcvf-btn { pointer-events:auto; cursor:pointer; touch-action:none; user-select:none;
                -webkit-user-select:none; -webkit-tap-highlight-color:transparent;
                display:flex; align-items:center; justify-content:center; color:#fff;
                font-family:inherit; font-weight:bold; background:${G}; border:1.5px solid ${B}; }
            .rcvf-btn:active, .rcvf-btn.is-on { background:rgba(255,255,255,0.26); }

            .rcvf-pad { width:124px; height:124px; display:grid;
                grid-template-columns:repeat(3,1fr); grid-template-rows:repeat(3,1fr); }
            .rcvf-pad .rcvf-btn { font-size:15px; }
            .rcvf-pad-up { grid-area:1/2; border-radius:9px 9px 0 0; }
            .rcvf-pad-left { grid-area:2/1; border-radius:9px 0 0 9px; }
            .rcvf-pad-right { grid-area:2/3; border-radius:0 9px 9px 0; }
            .rcvf-pad-down { grid-area:3/2; border-radius:0 0 9px 9px; }

            .rcvf-zoom { width:56px; display:flex; flex-direction:column; gap:6px; }
            .rcvf-zoom .rcvf-btn { flex:1; flex-direction:column; gap:1px; border-radius:9px;
                font-size:16px; line-height:1; }
            .rcvf-zoom .rcvf-btn small { font-size:8px; letter-spacing:1px; opacity:0.6;
                font-weight:normal; }
            .rcvf-read { display:flex; flex-direction:column; align-items:center; justify-content:center;
                background:${G}; border:1.5px solid rgba(255,255,255,0.22); border-radius:9px;
                padding:5px 0; }
            .rcvf-read .rcvf-fov { color:#ffc24d; font-size:17px; line-height:1.1; }
            .rcvf-read small { font-size:8px; letter-spacing:2px; opacity:0.6; font-weight:normal; }

            /* exposure meter — bottom centre, like a cine viewfinder's EV scale */
            .rcvf-expo { position:absolute; bottom:30px; left:50%; transform:translateX(-50%);
                display:flex; flex-direction:column; align-items:center; gap:5px; }
            .rcvf-expo-row { display:flex; align-items:center; gap:12px; }
            .rcvf-expo .rcvf-btn { width:30px; height:30px; border-radius:8px; font-size:18px; }
            /* HDR Neutral toggle — wider pill sitting just right of the EV + */
            .rcvf-expo .rcvf-hdr { width:auto; min-width:48px; padding:0 10px;
                font-size:12px; letter-spacing:1px; }
            .rcvf-hdr.is-on { color:#ffc24d; border-color:#ffc24d; background:rgba(255,194,77,0.18); }
            .rcvf-meter { position:relative; width:300px; height:22px; }
            .rcvf-meter::before { content:''; position:absolute; top:50%; left:0; right:0; height:10px;
                transform:translateY(-50%); background:repeating-linear-gradient(to right,
                rgba(255,255,255,0.5) 0 2px, transparent 2px 17px); }
            .rcvf-meter::after { content:''; position:absolute; top:50%; left:50%;
                transform:translate(-50%,-50%); width:2px; height:18px; background:rgba(255,255,255,0.75); }
            .rcvf-mark { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
                width:5px; height:22px; background:#ffc24d; border-radius:1px;
                box-shadow:0 0 0 1px rgba(0,0,0,0.55); transition:left 0.06s linear; }
            .rcvf-ev { color:#ffc24d; font-size:13px; letter-spacing:1px; }
            .rcvf-ev small { font-size:9px; opacity:0.6; letter-spacing:1px; font-weight:normal; }
        </style>
        <div class="rcvf-frame">
            <div class="rcvf-corner rcvf-tl"></div>
            <div class="rcvf-corner rcvf-tr"></div>
            <div class="rcvf-corner rcvf-bl"></div>
            <div class="rcvf-corner rcvf-br"></div>
            <div class="rcvf-inner"></div>
            <div class="rcvf-cross"></div>
        </div>
        <button class="rcvf-btn rcvf-exit" aria-label="Exit camera">Exit</button>
        <div class="rcvf-raw">RAW</div>
        <div class="rcvf-cluster">
            <div class="rcvf-ctl">
                <div class="rcvf-pad">
                    <button class="rcvf-btn rcvf-pad-up" data-dir="up">▲</button>
                    <button class="rcvf-btn rcvf-pad-left" data-dir="left">◀</button>
                    <button class="rcvf-btn rcvf-pad-right" data-dir="right">▶</button>
                    <button class="rcvf-btn rcvf-pad-down" data-dir="down">▼</button>
                </div>
                <div class="rcvf-zoom">
                    <button class="rcvf-btn" data-zoom="tele">T<small>TELE</small></button>
                    <div class="rcvf-read"><b class="rcvf-fov">${this._focalFromFov(this._currentFov)}</b><small>mm</small></div>
                    <button class="rcvf-btn" data-zoom="wide">W<small>WIDE</small></button>
                </div>
            </div>
        </div>
        <div class="rcvf-expo">
            <div class="rcvf-expo-row">
                <button class="rcvf-btn" data-expo="-1" aria-label="Darker">−</button>
                <div class="rcvf-meter"><div class="rcvf-mark"></div></div>
                <button class="rcvf-btn" data-expo="1" aria-label="Brighter">+</button>
                <button class="rcvf-btn rcvf-hdr" data-hdr aria-label="HDR Neutral" title="HDR Neutral">HDR</button>
            </div>
            <span class="rcvf-ev"><b class="rcvf-ev-val">+0.0</b> <small>EV</small></span>
        </div>`;
    }

    // 35 mm-equivalent focal length from the (vertical) field of view —
    // f = (h/2) / tan(fov/2) with a 24 mm full-frame sensor height. Gives a
    // photographer's reading (≈21 mm wide … ≈68 mm short tele over the FOV range).
    _focalFromFov(fov) {
        return Math.round(12 / Math.tan(pc.math.clamp(fov, 1, 179) * 0.5 * pc.math.DEG_TO_RAD));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    _hexToRgb01(hex, fallback) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!m) return fallback;
        return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
    }

    _destroyBox() {
        if (this._boxEntity) { this._boxEntity.destroy(); this._boxEntity = null; }
        this._boxMat?.destroy?.(); this._boxMat = null;
        this._boxHoverMat?.destroy?.(); this._boxHoverMat = null;
    }

    // ── cleanup ──────────────────────────────────────────────────────────────

    destroy() {
        if (this._active && ArrivalSpace.getCameraMode?.() === "free") {
            ArrivalSpace.setCameraMode?.(this._prevMode || "third");
        }
        this._active = false;
        this._unbindPointer();
        this._escUnsub?.();
        this._hideHud();
        this._destroyBox();
        if (this._hovered && document.body.style.cursor === "pointer") document.body.style.cursor = "auto";
        this._hovered = false;
        this.removeUI();
    }
}
