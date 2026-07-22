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
 * Studio extras (opt-in):
 * - `followEntity` — an entity pinned to the camera every frame while you fly, and
 *   nudged by the operator pad while you're out. Point a Splat Monitor's Camera-POV
 *   at the same entity and its window re-frames live as you move the camera.
 * - `operatorPanel` — a 2D camera-operator panel (REC monitor + move pad + ENTER)
 *   as the way in, instead of clicking the 3D trigger box.
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
const FOV_MIN = 6.87;      // tightest FOV → ~200 mm (35mm-equivalent focal length)
const FOV_MAX = 100;       // widest FOV
const ZOOM_SPEED = 16;     // zoom rate at full deflection (° FOV / s) — gentle
const ZOOM_TAU = 0.2;      // zoom velocity ease-in/out time constant (s), like movement

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
    minHeight = 0.2;           // world-height floor: the camera never dips below this (m)
    cameraOffset = { x: 0, y: 1.5, z: 0 }; // start position (rail origin) offset from the placement
    moveSpeed = 3;
    rotateSpeed = 45;          // operator pan/tilt slider speed (deg/s at full deflection)
    vertSpeed = 1;             // operator up/down (pedestal) speed (m/s), separate from moveSpeed
    smoothing = 0.15;          // velocity ease-in/out time constant (s); 0 = instant
    fov = 60;                  // field of view on enter; scroll wheel adjusts it live
    aspectRatio = 2.39;        // letterbox the view to this aspect (0 = off / fill screen)
    exposure = 0;              // starting exposure on the −3..+3 meter (0 = scene default)

    // ── Studio: carry an entity + a 2D operator panel ──
    // While inside the camera, this entity is pinned to it every frame; the operator
    // panel's move pad also nudges it while you're OUT. Point a Splat Monitor's
    // Camera-POV at the same entity and its window re-frames live. Empty = off.
    followEntity = "";
    followRotation = true;     // also match the entity's rotation to the camera
    // Optional scene entity (a placed dolly/tripod) that follows the camera on the FLOOR —
    // tracks the follow entity's X/Z only, keeping its own placed height, so the camera can
    // pedestal up/down while the base stays grounded. Empty = off.
    groundEntity = "";
    groundYaw = false;         // also yaw the ground entity to the camera's heading
    groundYOffset = 0;         // height offset (m) added to the ground entity's held height
    // A 2D camera-operator panel (REC monitor + move pad + ENTER) as the way in,
    // instead of clicking the 3D trigger box.
    operatorPanel = false;
    operatorLabel = "CAM 01";

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
        minHeight: { title: "Min Height (m)", min: 0, max: 50, step: 0.05 },
        cameraOffset: { title: "Camera Offset" },
        moveSpeed: { title: "Move Speed (m/s)", min: 0.1, max: 30, step: 0.1 },
        rotateSpeed: { title: "Rotate Speed (°/s)", min: 1, max: 180, step: 1 },
        vertSpeed: { title: "Vertical Speed (m/s)", min: 0.05, max: 20, step: 0.05 },
        smoothing: { title: "Movement Smoothing", min: 0, max: 1, step: 0.01 },
        fov: { title: "Field of View", min: 20, max: 100, step: 1 },
        aspectRatio: { title: "Letterbox Aspect (0 = off)", min: 0, max: 4, step: 0.01 },
        exposure: { title: "Exposure (EV)", min: -3, max: 3, step: 0.1 },

        followEntity: { title: "Follow Entity", editor: "entity" },
        followRotation: { title: "Follow Rotation" },
        groundEntity: { title: "Ground Entity (X/Z follow)", editor: "entity" },
        groundYaw: { title: "Ground Yaw To Camera" },
        groundYOffset: { title: "Ground Height Offset (m)", min: -20, max: 20, step: 0.05 },
        operatorPanel: { title: "2D Operator Panel" },
        operatorLabel: { title: "Operator Label" },

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
    _padVert = 0;          // on-screen buttons: -1 (Q) .. +1 (E)
    _hudYaw = 0;           // in-camera pan slider (-1..1) → fly-cam yaw rate
    _hudPitch = 0;         // in-camera tilt slider (-1..1) → fly-cam pitch rate
    _padForward = 0;       // on-screen joystick forward/back: -1 (S) .. +1 (W)
    _zoomDir = 0;          // zoom rocker: +1 wide (FOV up) / -1 tele (FOV down)
    _zoomVel = 0;          // eased zoom velocity (° FOV / s) for a smooth ramp
    _expoDir = 0;          // exposure −/+ buttons: -1 darker / +1 brighter
    _expoEv = 0;           // current exposure on the −3..+3 meter
    _baseBrightness = 1;   // scene brightness captured on enter (restored on exit)
    _expoApplied = false;  // whether we have a brightness override in effect
    _hdrNeutral = false;   // HDR Neutral tone-map toggle (the button right of the EV +)
    _hudLocked = false;    // input-lock state while touching the viewfinder HUD
    _hudUnlock = null;

    _onDown = null;
    _onMove = null;
    _onWheel = null;
    _escUnsub = null;

    // Studio follow + 2D operator panel
    _opUI = null;
    _opHeld = { fwd: 0, side: 0, vert: 0 };
    _opVel = new pc.Vec3();    // eased operator-nudge velocity (m/s) for a smooth dolly/pedestal
    _opPan = 0;                // pan slider rate (-1..1) → yaw the camera
    _opTilt = 0;               // tilt slider rate (-1..1) → pitch the camera
    _opFovEl = null;           // operator-panel focal-length (mm) readout element
    _zoomMonitors = null;      // cached splat-monitors linked to the follow entity (for zoom)
    _groundEnt = null;         // resolved ground-follow entity
    _groundEntId = "";
    _groundHomeY = null;       // its placed height, held constant while it tracks X/Z
    _recording = false;        // mirror of the Feed Recorder's state (via the event bus)
    _recSubs = [];             // [name, fn] recorder-event subscriptions, for cleanup
    _recFps = 30;              // capture fps from the recorder (for the timecode FF field)
    _recInfo = null;           // { width, height } of the feed being recorded (readout)
    _recBase = 0;              // performance.now() at (re)sync — timecode zero point
    _recSecs0 = 0;             // seconds already elapsed at that sync (mid-recording join)
    _claimId = "";             // our id on the recorder's HUD-claim ledger
    _claimed = false;
    // REC display elements (viewfinder strip + operator transport), cached on build
    _vfTcEl = null; _vfInfoEl = null; _opTcEl = null;
    _opLocked = false;
    _opUnlock = null;
    _followEnt = null;
    _followEntId = "";
    _followHome = null;    // followEntity's home pose (pos+rot), captured on first resolve
    _followMeshHidden = null;  // render/model comps we hid while flying (restored on exit)
    _followRot = new pc.Quat();                            // scratch for the synced rotation
    _flipY = new pc.Quat().setFromEulerAngles(0, 180, 0);  // model lens = local +Z → 180° yaw

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
        this._currentFov = pc.math.clamp(this.fov, FOV_MIN, FOV_MAX);   // seed the shared zoom
        this._buildBox();
        this._bindPointer();
        this._escUnsub = this.onKeyDown("escape", () => { if (this._active) this._exit(); });
        // Mirror the Feed Recorder's state so the transport UI reflects it. The
        // timecode is derived locally: (seconds at sync) + wall clock since sync,
        // frames from the recorder's captureFps.
        const onRec = (name, fn) => { try { ArrivalSpace.on(name, fn); this._recSubs.push([name, fn]); } catch (_) { /* ignore */ } };
        onRec("recorder:started", (d) => this._syncRecState(true, 0, d));
        onRec("recorder:stopped", () => this._syncRecState(false, 0, null));
        // Late join: the recorder answers recorder:query with its live state (it may
        // already be rolling when we load / when the user opens the panel).
        onRec("recorder:state", (d) => this._syncRecState(!!d?.recording, d?.seconds || 0, d));
        // A recorder that loads after us asks UI claimants to re-announce.
        onRec("recorder:ui:query", () => { if (this._claimed) this._fireClaim(true); });
        this._claimId = "railcam-" + (this.entity?.getGuid?.() || Math.random().toString(36).slice(2));
        this._setUiClaim(this.operatorPanel);
        try { ArrivalSpace.fire("recorder:query"); } catch (_) { /* ignore */ }
        if (this.operatorPanel) this._setOperatorVisible(true);
    }

    _syncRecState(recording, seconds, info) {
        this._recording = recording;
        this._recBase = performance.now();
        this._recSecs0 = recording ? (seconds || 0) : 0;
        if (info && info.fps) this._recFps = info.fps;
        if (info && info.height) this._recInfo = { width: info.width || 0, height: info.height };
        this._updateRecButtons();
    }

    // Claim/release the Feed Recorder's fallback HUD while we show our own record
    // UI (operator panel enabled, or inside the viewfinder).
    _setUiClaim(want) {
        want = !!want;
        if (want === this._claimed) return;
        this._claimed = want;
        this._fireClaim(want);
    }

    _fireClaim(claim) {
        try { ArrivalSpace.fire(claim ? "recorder:ui:claim" : "recorder:ui:release", { id: this._claimId }); } catch (_) { /* ignore */ }
    }

    // Seconds since recording started (recorder-reported base + local wall clock).
    _recSeconds() {
        if (!this._recording) return 0;
        return this._recSecs0 + (performance.now() - this._recBase) / 1000;
    }

    // SMPTE-style timecode HH:MM:SS:FF at the recorder's capture fps.
    _timecode() {
        const fps = Math.max(1, Math.min(60, Math.round(this._recFps || 30)));
        const t = this._recSeconds();
        const s = Math.floor(t);
        const p = (n) => String(n).padStart(2, "0");
        return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(Math.floor((t - s) * fps))}`;
    }

    // Tick the running timecode readouts (called from update in both modes).
    _updateRecClock() {
        if (!this._recording) return;
        const tc = this._timecode();
        if (this._vfTcEl) this._vfTcEl.textContent = tc;
        if (this._opTcEl) this._opTcEl.textContent = tc;
    }

    update(dt) {
        this._updateGroundMesh();   // dolly/tripod tracks the camera's X/Z on the floor
        this._updateRecClock();     // running SMPTE timecode on whichever REC UI shows
        if (this._active) {
            // Zoom rocker ramps FOV while held; keep the readout in sync (the scroll
            // wheel changes it too).
            if (this._stepZoom(dt)) this._getFreeCamView()?.setFOV?.(this._currentFov);
            if (this._fovEl) this._fovEl.textContent = this._focalFromFov(this._currentFov);
            if (this._expoDir !== 0) {
                this._expoEv = pc.math.clamp(this._expoEv + this._expoDir * 2 * (dt || 0), -3, 3);
                this._applyExposure();
            }
            return;
        }
        // Operator zoom rocker: ramp FOV while held (out of camera), drive any linked
        // monitor's feed live, and keep the mm readout in sync.
        if (this.operatorPanel) {
            this._stepZoom(dt);
            this._setMonitorZoom(this._currentFov);   // keep the linked monitor synced to the readout
            if (this._opFovEl) this._opFovEl.textContent = this._focalFromFov(this._currentFov);
        }
        // Operator-panel move pad: slide the follow entity while OUT of the camera,
        // so the linked screens re-frame without entering.
        this._applyNudge(dt || 0);
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
        if (name === "operatorPanel") {
            if (this.operatorPanel) this._setOperatorVisible(true);
            else this._destroyOperator();
            this._setUiClaim(this.operatorPanel || this._active);
            return;
        }
        if (name === "operatorLabel") {
            if (this._opUI) { this._buildOperator(); this._setOperatorVisible(!this._active); }
            return;
        }
        if (name === "followEntity") { this._followEnt = null; this._followEntId = ""; this._zoomMonitors = null; return; }
        if (name === "groundEntity") { this._groundEnt = null; this._groundEntId = ""; this._groundHomeY = null; return; }
        if (name === "cameraOffset" && this._active) {
            this._recomputeOrigin();
            return;
        }
        if (name === "fov" && this._active) {
            this._currentFov = pc.math.clamp(this.fov, FOV_MIN, FOV_MAX);
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
        this._setOperatorVisible(!isEditing);
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
        this._currentFov = pc.math.clamp(this._currentFov, FOV_MIN, FOV_MAX);   // carry the operator zoom in
        fcv?.setFOV?.(this._currentFov);

        this._active = true;
        this._setFollowMeshHidden(true);   // looking through the camera — hide its body
        this._setHover(false);
        if (this._boxEntity) this._boxEntity.enabled = false; // don't tint the view from inside
        this._setOperatorVisible(false);   // hand the screen over to the viewfinder HUD
        this._showHud();
        this._setUiClaim(true);            // our viewfinder owns the record UI now
        try { ArrivalSpace.fire("recorder:query"); } catch (_) { /* ignore */ }   // sync REC/timecode
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
        this._setFollowMeshHidden(false);  // exiting — show the camera model again
        if (this._boxEntity) this._boxEntity.enabled = !!this.showBox;
        this._hideHud();
        this._setOperatorVisible(true);    // bring the operator panel back
        // Keep the claim only if the operator panel still shows record controls.
        this._setUiClaim(!!this.operatorPanel);
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
        // With a follow entity, enter/continue from wherever the camera currently is,
        // so entering never snaps it back. Only the reset button returns it home.
        const fe = this._resolveFollow();
        if (fe) { this._origin.copy(fe.getPosition()); return; }
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
        const fwd = pc.math.clamp((fcv.forwardValue || 0) + this._padForward, -1, 1);   // W/S + joystick
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
        // world-height floor: don't let the vertical rail offset dip the eye below it
        // (rail up ≈ world +Y; the hard clamp on `target` below covers any rail tilt).
        const upY = this._axU.y;
        if (upY > 1e-3) cU = Math.max(cU, (this.minHeight - this._origin.y) / upY);
        cF = pc.math.clamp(cF, -Math.max(0, this.maxForwardBack), Math.max(0, this.maxForwardBack));
        this._railOffset.set(0, 0, 0)
            .add(this._tA.copy(this._axR).mulScalar(cR))
            .add(this._tA.copy(this._axU).mulScalar(cU))
            .add(this._tA.copy(this._axF).mulScalar(cF));

        const target = this._t4.copy(this._origin).add(this._railOffset);
        if (target.y < this.minHeight) target.y = this.minHeight;   // hard world-height floor
        fcv.setInitPosition(target);
        this._moveFollow(target);   // studio camera model rides along → linked screens re-frame

        // Pan/tilt sliders → rotate the fly cam (rate); the limits below still clamp it.
        if (this._hudYaw && typeof fcv.yaw === "number") {
            const dy = -this._hudYaw * Math.max(1, this.rotateSpeed) * dt;   // slider right → pan right
            fcv.yaw += dy; if (typeof fcv.yawTarget === "number") fcv.yawTarget += dy;
        }
        if (this._hudPitch && typeof fcv.pitch === "number") {
            const dp = this._hudPitch * Math.max(1, this.rotateSpeed) * dt;   // slider up → tilt up
            fcv.pitch += dp; if (typeof fcv.pitchTarget === "number") fcv.pitchTarget += dp;
        }
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

    // ── Studio follow + 2D operator panel ────────────────────────────────────

    // The entity dragged along with the camera (and nudged by the operator pad).
    // Point a Splat Monitor's Camera-POV at the same entity so its window re-frames.
    _resolveFollow() {
        const id = (this.followEntity || "").trim();
        if (!id) return null;
        if (this._followEnt && this._followEntId === id) return this._followEnt;
        let e = null;
        const gs = this.app.root.findByName("GateServer")?.script?.gateServer;
        e = gs?.getEntity?.(id) || null;
        if (!e) { try { e = this.app.root.findByGuid?.(id) || null; } catch (_) { /* ignore */ } }
        this._followEnt = e; this._followEntId = id;
        if (e && !this._followHome) this._followHome = { p: e.getPosition().clone(), r: e.getRotation().clone() };
        return e;
    }

    // Fly mode: pin the follow entity to the live camera each frame.
    _moveFollow(target) {
        const fe = this._resolveFollow();
        if (!fe) return;
        fe.setPosition(target);
        // windowMode screens re-frame from the eye POSITION, not rotation — but we still spin
        // the model to match the view so it KEEPS that facing after you exit. The model's lens
        // faces its local +Z (opposite entity.forward), so add a 180° yaw to aim the lens along
        // the view instead of backwards.
        if (this.followRotation) {
            const cam = ArrivalSpace.getCamera?.();
            if (cam) { this._followRot.copy(cam.getRotation()).mul(this._flipY); fe.setRotation(this._followRot); }
        }
    }

    // Return the follow entity to the pose it had when the plugin loaded (its placed
    // spot), so the linked screens re-frame to the original shot.
    _resetFollow() {
        const fe = this._resolveFollow();
        if (!fe || !this._followHome) return;
        fe.setPosition(this._followHome.p);
        fe.setRotation(this._followHome.r);
    }

    // Hide/show the camera model's visible mesh while flying (you're looking THROUGH it,
    // so its body shouldn't be in frame). Toggle only render/model components — never the
    // entity's enabled flag or transform — so the linked screens keep reading its eye.
    _setFollowMeshHidden(hide) {
        const fe = this._resolveFollow();
        if (!fe) return;
        if (hide) {
            const list = [];
            const walk = (e) => {
                if (e.render && e.render.enabled) { e.render.enabled = false; list.push(e.render); }
                if (e.model && e.model.enabled) { e.model.enabled = false; list.push(e.model); }
                for (const c of (e.children || [])) walk(c);
            };
            walk(fe);
            this._followMeshHidden = list;
        } else {
            for (const c of (this._followMeshHidden || [])) { try { c.enabled = true; } catch (_) { /* ignore */ } }
            this._followMeshHidden = null;
        }
    }

    // Operator-panel nudge (out of the camera). Relative to the CAMERA being operated,
    // not the player's view. The camera model's lens faces its local +Z (= -entity.forward),
    // so the operator's "forward" is toward the lens/screen: dolly along -forward, truck
    // along -right, pedestal on world Y. Consistent wherever the operator stands or looks.
    _applyNudge(dt) {
        if (this._active || !this.operatorPanel) return;
        const fe = this._resolveFollow();
        if (!fe) return;
        // Pan/tilt sliders → rotate the camera: yaw around world up, pitch around its own right.
        if (this._opPan || this._opTilt) {
            const rot = Math.max(1, this.rotateSpeed) * dt;
            if (this._opPan) fe.rotate(0, -this._opPan * rot, 0);
            if (this._opTilt) fe.rotateLocal(-this._opTilt * rot, 0, 0);
        }
        // Target velocity from the pad in the camera's own frame (forward = lens dir), with
        // vert on world Y — then EASED toward, so the dolly/pedestal ramps smoothly (same
        // `smoothing` feel as the fly cam) instead of snapping on/off.
        const h = this._opHeld;
        const f = this._t1.copy(fe.forward).mulScalar(-1), r = this._t2.copy(fe.right).mulScalar(-1);
        f.y = 0; r.y = 0;
        if (f.lengthSq() > 1e-6) f.normalize();
        if (r.lengthSq() > 1e-6) r.normalize();
        const target = this._t3.set(0, 0, 0)
            .add(this._tA.copy(f).mulScalar(h.fwd))
            .add(this._tA.copy(r).mulScalar(h.side));
        target.mulScalar(Math.max(0.1, this.moveSpeed));   // horizontal dolly/truck
        target.y += h.vert * Math.max(0, this.vertSpeed);  // vertical pedestal at its own speed
        const tau = Math.max(0, this.smoothing);
        if (tau < 1e-4) this._opVel.copy(target);
        else this._opVel.lerp(this._opVel, target, 1 - Math.exp(-(dt || 0) / tau));
        if (this._opVel.lengthSq() < 1e-8) { this._opVel.set(0, 0, 0); return; }
        const mv = this._t4.copy(this._opVel).mulScalar(dt || 0);
        const p = fe.getPosition();
        fe.setPosition(p.x + mv.x, Math.max(this.minHeight, p.y + mv.y), p.z + mv.z);
    }

    _buildOperator() {
        this._destroyOperator();
        this._opUI = this.createUI("div", {
            interactive: false,   // container passes through; only the panel is clickable
            innerHTML: this._operatorHtml(),
            style: {
                position: "fixed", left: "0", bottom: "0", width: "100%",
                display: "flex", justifyContent: "center", alignItems: "flex-end",
                pointerEvents: "none", zIndex: "999",
                fontFamily: "'Courier New', ui-monospace, monospace",
            },
        });

        const hold = (b, on) => {
            b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); on(true); });
            b.addEventListener("pointerup", (e) => { e.stopPropagation(); on(false); });
            b.addEventListener("pointerleave", () => on(false));
            b.addEventListener("pointercancel", () => on(false));
        };
        const set = (k, v, on) => { this._opHeld[k] = on ? v : 0; };
        this._opUI.querySelectorAll("[data-move]").forEach((b) => {
            const m = b.dataset.move;
            hold(b, (on) => {
                if (m === "fwd") set("fwd", 1, on);
                else if (m === "back") set("fwd", -1, on);
                else if (m === "left") set("side", -1, on);
                else if (m === "right") set("side", 1, on);
                else if (m === "up") set("vert", 1, on);
                else if (m === "down") set("vert", -1, on);
            });
        });
        this._opUI.querySelectorAll("[data-zoom]").forEach((b) => {
            const dir = b.dataset.zoom === "wide" ? 1 : -1;   // wide → FOV up, tele → FOV down
            hold(b, (on) => { this._zoomDir = on ? dir : 0; });
        });
        this._wireJoystick(
            this._opUI.querySelector(".rcop-stick"),
            this._opUI.querySelector(".rcop-knob"),
            (x, y) => { this._opHeld.side = x; this._opHeld.fwd = y; }
        );
        this._wireSlider(this._opUI.querySelector(".rcop-pan"), this._opUI.querySelector(".rcop-pan-knob"), "x", (v) => { this._opPan = v; });
        this._wireSlider(this._opUI.querySelector(".rcop-tilt"), this._opUI.querySelector(".rcop-tilt-knob"), "y", (v) => { this._opTilt = v; });
        this._opFovEl = this._opUI.querySelector(".rcop-mm b");
        this._zoomMonitors = null;
        const resetBtn = this._opUI.querySelector("[data-reset]");
        if (resetBtn) resetBtn.addEventListener("click", (e) => { e.stopPropagation(); this._resetFollow(); });
        this._opUI.querySelectorAll("[data-rec]").forEach((b) =>
            b.addEventListener("click", (e) => { e.stopPropagation(); this._toggleRecording(); }));
        const snapBtn = this._opUI.querySelector("[data-snap]");
        if (snapBtn) snapBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            try { ArrivalSpace.fire("recorder:snapshot"); } catch (_) { /* ignore */ }
        });
        this._opTcEl = this._opUI.querySelector(".rcop-tcv");
        this._updateRecButtons();
        const enterBtn = this._opUI.querySelector("[data-enter]");
        if (enterBtn) enterBtn.addEventListener("click", (e) => { e.stopPropagation(); this._enter(); });

        // Input lock: block the world's click-to-walk / look while the pointer is over
        // the panel. Lock on ENTER (fires before pointerdown, so the flag is set before
        // the world's click handler runs) and unlock when the pointer leaves.
        const rcop = this._opUI.querySelector(".rcop");
        if (rcop) {
            rcop.addEventListener("pointerenter", () => {
                if (!this._opLocked) { this._opLocked = true; try { this.lockInput(); } catch (_) { /* ignore */ } }
            });
            const unlock = () => { if (this._opLocked) { this._opLocked = false; try { this.unlockInput(); } catch (_) { /* ignore */ } } };
            rcop.addEventListener("pointerleave", unlock);
            rcop.addEventListener("pointercancel", unlock);
        }
    }

    // Analog drag joystick, reused by the operator panel and the viewfinder. Push the
    // knob → onMove(x, y) with x/y in -1..1 (x = right+, y = up/forward+), proportional
    // to how far. Pointer-captured (+ stopPropagation) so the drag never leaks to the
    // world look/move; snaps back to centre and onMove(0,0) on release.
    _wireJoystick(stick, knob, onMove) {
        if (!stick || !knob) return;
        const maxT = 30;   // knob travel radius (px)
        let active = false, cx = 0, cy = 0;
        const reset = () => {
            active = false;
            knob.style.transform = "translate(-50%, -50%)";
            onMove(0, 0);
        };
        const move = (px, py) => {
            let dx = px - cx, dy = py - cy;
            const len = Math.hypot(dx, dy);
            if (len > maxT) { dx = dx / len * maxT; dy = dy / len * maxT; }
            knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            onMove(dx / maxT, -dy / maxT);   // x = right+, y = up/forward+
        };
        stick.addEventListener("pointerdown", (e) => {
            e.preventDefault(); e.stopPropagation();
            const r = stick.getBoundingClientRect();
            cx = r.left + r.width / 2; cy = r.top + r.height / 2;
            active = true;
            try { stick.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            move(e.clientX, e.clientY);
        });
        stick.addEventListener("pointermove", (e) => { if (active) { e.preventDefault(); e.stopPropagation(); move(e.clientX, e.clientY); } });
        stick.addEventListener("pointerup", (e) => { e.stopPropagation(); reset(); });
        stick.addEventListener("pointercancel", () => reset());
    }

    // Single-axis analog slider (a knob dragged from centre). axis "x" horizontal, "y"
    // vertical. onMove(v) with v in -1..1 (x = right+, y = up+); snaps back to centre and
    // onMove(0) on release. Pointer-captured + stopPropagation like the joystick.
    _wireSlider(track, knob, axis, onMove) {
        if (!track || !knob) return;
        let active = false;
        const reset = () => { active = false; knob.style.transform = "translate(-50%, -50%)"; onMove(0); };
        const move = (px, py) => {
            const r = track.getBoundingClientRect();
            const half = Math.max(10, (axis === "x" ? r.width : r.height) / 2 - 12);
            const d = axis === "x" ? px - (r.left + r.width / 2) : py - (r.top + r.height / 2);
            const v = Math.max(-1, Math.min(1, d / half));
            knob.style.transform = axis === "x"
                ? `translate(calc(-50% + ${v * half}px), -50%)`
                : `translate(-50%, calc(-50% + ${v * half}px))`;
            onMove(axis === "x" ? v : -v);   // screen-down is +py → invert so up = +
        };
        track.addEventListener("pointerdown", (e) => {
            e.preventDefault(); e.stopPropagation();
            active = true;
            try { track.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            move(e.clientX, e.clientY);
        });
        track.addEventListener("pointermove", (e) => { if (active) { e.preventDefault(); e.stopPropagation(); move(e.clientX, e.clientY); } });
        track.addEventListener("pointerup", (e) => { e.stopPropagation(); reset(); });
        track.addEventListener("pointercancel", () => reset());
    }

    // Push a focal length (via FOV) to any Splat Monitor whose Camera-POV is our follow
    // entity, so the operator's zoom re-frames the linked monitor feed live. Windowed
    // ("portal") monitors ignore FOV, so we only touch monitor-mode ones.
    _setMonitorZoom(fov) {
        if (!this._zoomMonitors || !this._zoomMonitors.length) this._zoomMonitors = this._findZoomMonitors();
        for (const m of this._zoomMonitors) { try { if (m) m.fov = fov; } catch (_) { /* ignore */ } }
    }

    _findZoomMonitors() {
        const id = (this.followEntity || "").trim();
        const root = this.app?.root;
        if (!id || !root) return [];
        const out = [], stack = [root];
        while (stack.length) {
            const e = stack.pop();
            for (const s of (e?.script?.scripts || [])) {
                if (s && s !== this && s.cameraEntity === id && !s.windowMode && typeof s.fov === "number") out.push(s);
            }
            for (const c of (e?.children || [])) stack.push(c);
        }
        return out;
    }

    _resolveGroundEntity() {
        const id = (this.groundEntity || "").trim();
        if (!id) return null;
        if (this._groundEnt && this._groundEntId === id) return this._groundEnt;
        let e = null;
        const gs = this.app.root.findByName("GateServer")?.script?.gateServer;
        e = gs?.getEntity?.(id) || null;
        if (!e) { try { e = this.app.root.findByGuid?.(id) || null; } catch (_) { /* ignore */ } }
        this._groundEnt = e; this._groundEntId = id;
        if (e && this._groundHomeY == null) this._groundHomeY = e.getPosition().y;   // hold its placed height
        return e;
    }

    // Slide the ground entity to the follow entity's X/Z while keeping its placed height,
    // so a dolly/tripod stays on the floor as the camera pedestals. Optionally yaws to face.
    _updateGroundMesh() {
        const g = this._resolveGroundEntity();
        if (!g) return;
        const fe = this._resolveFollow();
        if (!fe) return;
        const p = fe.getPosition();
        const y = ((this._groundHomeY != null) ? this._groundHomeY : p.y) + this.groundYOffset;
        if (this.groundYaw) {
            const f = this._t1.copy(fe.forward).mulScalar(-1); f.y = 0;   // lens direction, flattened
            if (f.lengthSq() > 1e-6) g.setEulerAngles(0, Math.atan2(f.x, f.z) * pc.math.RAD_TO_DEG, 0);
        }
        g.setPosition(p.x, y, p.z);
    }

    // Toggle the Feed Recorder over the shared event bus; it fires back
    // recorder:started/stopped, which flip _recording + refresh the button.
    _toggleRecording() {
        try { ArrivalSpace.fire("recorder:toggle"); } catch (_) { /* ignore */ }
    }

    // Reflect the recorder state on both transport UIs: the record/stills buttons
    // swap out for blinking tally + timecode + stop while rolling (operator panel
    // and viewfinder strip alike), plus the viewfinder's red corner tally. The
    // running timecode itself ticks in _updateRecClock.
    _updateRecButtons() {
        const rec = this._recording;
        const tc = rec ? this._timecode() : "";
        if (this._opUI) {
            const t = this._opUI.querySelector(".rcop-trans");
            if (t) t.classList.toggle("is-rec", rec);
        }
        if (this._opTcEl) this._opTcEl.textContent = rec ? tc : "00:00:00:00";
        if (this._hud) this._hud.classList.toggle("rcvf-recording", rec);
        if (this._vfTcEl) this._vfTcEl.textContent = rec ? tc : "00:00:00:00";
        if (this._vfInfoEl) {
            const i = this._recInfo;
            this._vfInfoEl.textContent = i ? `${i.height}P · WEBM · ${Math.round(this._recFps)}` : "";
        }
    }

    _destroyOperator() {
        this._opHeld.fwd = this._opHeld.side = this._opHeld.vert = 0;
        this._opPan = this._opTilt = 0;
        this._zoomDir = this._zoomVel = 0;
        this._opVel.set(0, 0, 0);
        if (this._opLocked) { this._opLocked = false; try { this.unlockInput(); } catch (_) { /* ignore */ } }
        if (this._opUI) { this._opUI.remove(); this._opUI = null; }
        this._opTcEl = null;
    }

    // Show only when the panel is enabled, we're not inside the camera, and not editing.
    _setOperatorVisible(v) {
        if (!this.operatorPanel) { this._destroyOperator(); return; }
        if (!this._opUI) this._buildOperator();
        const show = v && !this._active && !this._isEditing();
        if (this._opUI) this._opUI.style.display = show ? "flex" : "none";
        if (!show) { this._opHeld.fwd = this._opHeld.side = this._opHeld.vert = 0; this._opPan = this._opTilt = 0; this._zoomDir = this._zoomVel = 0; this._opVel.set(0, 0, 0); }
    }

    _operatorHtml() {
        return `
        <style>
            .rcop { pointer-events:auto; position:relative; margin-bottom:22px;
                display:flex; flex-direction:column; align-items:center; gap:8px;
                width:fit-content; max-width:96vw;
                background:#0d0a16; border:1px solid rgba(255,255,255,0.10);
                border-radius:12px; padding:9px 14px 12px; color:#f3f1fa;
                box-shadow:0 16px 50px rgba(0,0,0,0.55);
                font-family:"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;
                user-select:none; -webkit-user-select:none; }
            .rcop-cap { font-size:10px; letter-spacing:2px; text-transform:uppercase;
                color:rgba(243,241,250,0.5); }
            .rcop-controls { display:flex; align-items:center; gap:12px; }
            .rcop-btn { pointer-events:auto; cursor:pointer; touch-action:none;
                -webkit-tap-highlight-color:transparent; color:#f3f1fa; font:inherit; font-weight:600;
                background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12);
                transition:background .15s ease, border-color .15s ease;
                display:flex; align-items:center; justify-content:center; }
            .rcop-btn:hover { background:rgba(255,255,255,0.09); border-color:rgba(167,139,255,0.5); }
            .rcop-btn:active { background:#7a5af8; border-color:#7a5af8; color:#fff; }
            .rcop-stick { width:100px; height:100px; border-radius:50%; position:relative; flex:none;
                background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12);
                touch-action:none; cursor:grab; }
            .rcop-stick:active { cursor:grabbing; }
            .rcop-knob { position:absolute; left:50%; top:50%; width:44px; height:44px; border-radius:50%;
                transform:translate(-50%,-50%); background:#7a5af8; border:1px solid #8b6dff;
                box-shadow:0 2px 12px rgba(122,90,248,0.55); pointer-events:none;
                display:flex; align-items:center; justify-content:center;
                color:rgba(255,255,255,0.55); font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; }
            .rcop-stickwrap { display:flex; flex-direction:column; align-items:flex-end; gap:6px; flex:none; }
            .rcop-stickrow { display:flex; align-items:center; gap:6px; }
            .rcop-pan { width:100px; height:18px; border-radius:9px; position:relative; flex:none;
                background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); touch-action:none; cursor:grab; }
            .rcop-tilt { width:18px; height:100px; border-radius:9px; position:relative; flex:none;
                background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); touch-action:none; cursor:grab; }
            .rcop-pan-knob, .rcop-tilt-knob { position:absolute; left:50%; top:50%; width:24px; height:24px;
                border-radius:50%; transform:translate(-50%,-50%); background:#7a5af8; border:1px solid #8b6dff;
                box-shadow:0 2px 10px rgba(122,90,248,0.5); pointer-events:none;
                display:flex; align-items:center; justify-content:center;
                color:rgba(255,255,255,0.55); font-size:6px; font-weight:700; text-transform:uppercase; letter-spacing:0.2px; }
            /* vert + zoom columns are both exactly 100px tall (45+10+45 vs
               34+5+22+5+34), so UP's top edge lines up with T's and DN's bottom
               edge with W's. */
            .rcop-vert { display:flex; flex-direction:column; gap:10px; flex:none; }
            .rcop-vert .rcop-btn { width:48px; height:45px; box-sizing:border-box; border-radius:7px; font-size:15px; }
            .rcop-vert small { font-size:7px; opacity:0.55; margin-left:2px; letter-spacing:1px; }
            .rcop-zoom { display:flex; flex-direction:column; align-items:center; gap:5px; flex:none; }
            .rcop-zoom .rcop-btn { width:44px; height:34px; box-sizing:border-box; border-radius:7px;
                font-size:14px; font-weight:700; flex-direction:column; gap:0; line-height:1; padding:0; }
            .rcop-zoom .rcop-btn small { font-size:6px; letter-spacing:1px; opacity:0.55; font-weight:normal; }
            .rcop-mm { color:#f3f1fa; line-height:1.05; text-align:center; height:22px;
                display:flex; align-items:center; justify-content:center; }
            .rcop-mm b { font-size:14px; font-weight:700; }
            .rcop-mm small { font-size:8px; opacity:0.6; letter-spacing:1px; margin-left:1px; }
            .rcop-reset { position:absolute; top:8px; right:10px; padding:3px 10px; border-radius:6px;
                font-size:10px; letter-spacing:1px; text-transform:uppercase; }
            /* right column: ENTER with the record transport underneath. Idle the
               transport shows a round record button + a stills button; while
               rolling those swap out for the blinking tally + timecode + a small
               stop control (modern camera-app pattern). */
            .rcop-right { display:flex; flex-direction:column; align-items:stretch; gap:8px; flex:none; }
            .rcop-trans { display:flex; align-items:center; justify-content:center; gap:12px;
                min-height:40px; }
            .rcop-tcwrap { display:none; align-items:center; gap:7px; font-size:12px;
                letter-spacing:1px; color:#ff453a; font-variant-numeric:tabular-nums; white-space:nowrap; }
            .rcop-trans.is-rec .rcop-tcwrap { display:flex; }
            .rcop-dot { width:9px; height:9px; border-radius:50%; background:#ff453a; flex:none;
                animation:rcopBlink 1s steps(1) infinite; }
            @keyframes rcopBlink { 50% { opacity:0; } }
            .rcop-shutter { width:40px; height:40px; border-radius:50%; position:relative; flex:none;
                cursor:pointer; padding:0; background:transparent;
                border:3px solid rgba(255,255,255,0.92); -webkit-tap-highlight-color:transparent; }
            .rcop-shutter::after { content:''; position:absolute; inset:3px; border-radius:50%;
                background:#e53935; transition:background .15s ease; }
            .rcop-shutter:hover::after { background:#ff453a; }
            .rcop-photo { width:28px; height:28px; border-radius:50%; position:relative; flex:none;
                cursor:pointer; padding:0; background:transparent;
                border:2px solid rgba(255,255,255,0.7); -webkit-tap-highlight-color:transparent; }
            .rcop-photo::after { content:''; position:absolute; inset:4px; border-radius:50%;
                background:rgba(255,255,255,0.85); transition:transform .12s ease; }
            .rcop-photo:active::after { transform:scale(0.55); }
            .rcop-stop { display:none; width:28px; height:28px; border-radius:50%; position:relative;
                flex:none; cursor:pointer; padding:0; background:transparent;
                border:2px solid rgba(255,255,255,0.85); -webkit-tap-highlight-color:transparent;
                transition:border-color .15s ease; }
            .rcop-stop::after { content:''; position:absolute; inset:8px; border-radius:2px;
                background:#ff453a; }
            .rcop-stop:hover { border-color:#ff453a; }
            .rcop-trans.is-rec .rcop-shutter, .rcop-trans.is-rec .rcop-photo { display:none; }
            .rcop-trans.is-rec .rcop-stop { display:inline-block; }
            .rcop-enter { padding:0 20px; height:52px; border-radius:9px; font-size:14px; letter-spacing:2px;
                color:#fff; background:#7a5af8; border:1px solid #7a5af8;
                box-shadow:0 3px 16px rgba(122,90,248,0.5); }
            .rcop-enter:hover { background:#8b6dff; border-color:#8b6dff; }
            /* Mobile: stack the content row and hug the right so the bottom-left stays
               free for the player's movement stick. */
            @media (max-width: 600px) {
                .rcop { margin-left: auto; margin-right: 72px; }
                .rcop-controls { flex-direction: column; gap: 9px; }
            }
        </style>
        <div class="rcop">
            <div class="rcop-cap">Camera Control</div>
            <button class="rcop-btn rcop-reset" data-reset aria-label="Reset camera">reset</button>
            <div class="rcop-controls">
                <div class="rcop-stickwrap">
                    <div class="rcop-pan" aria-label="Pan angle"><div class="rcop-pan-knob">yaw</div></div>
                    <div class="rcop-stickrow">
                        <div class="rcop-tilt" aria-label="Tilt angle"><div class="rcop-tilt-knob">pitch</div></div>
                        <div class="rcop-stick" aria-label="Move joystick"><div class="rcop-knob">move</div></div>
                    </div>
                </div>
                <div class="rcop-vert">
                    <button class="rcop-btn" data-move="up" aria-label="Up">＋<small>UP</small></button>
                    <button class="rcop-btn" data-move="down" aria-label="Down">－<small>DN</small></button>
                </div>
                <div class="rcop-zoom">
                    <button class="rcop-btn" data-zoom="tele" aria-label="Zoom tele">T<small>TELE</small></button>
                    <div class="rcop-mm"><b>${this._focalFromFov(this._currentFov)}</b><small>mm</small></div>
                    <button class="rcop-btn" data-zoom="wide" aria-label="Zoom wide">W<small>WIDE</small></button>
                </div>
                <div class="rcop-right">
                    <button class="rcop-btn rcop-enter" data-enter aria-label="Enter camera">ENTER</button>
                    <div class="rcop-trans">
                        <button class="rcop-shutter" data-rec aria-label="Record" title="Record"></button>
                        <button class="rcop-photo" data-snap aria-label="Snapshot" title="Snapshot"></button>
                        <div class="rcop-tcwrap"><span class="rcop-dot"></span><span class="rcop-tcv">00:00:00:00</span></div>
                        <button class="rcop-stop" data-rec aria-label="Stop recording" title="Stop"></button>
                    </div>
                </div>
            </div>
        </div>`;
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
            this._currentFov = pc.math.clamp(this._currentFov + e.deltaY * 0.05, FOV_MIN, FOV_MAX);
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

        // Up/Down buttons → E/Q (vertical) intent, added on top of the keys.
        const setDir = (dir, on) => {
            if (dir === "up") this._padVert = on ? 1 : 0;
            else if (dir === "down") this._padVert = on ? -1 : 0;
        };
        this._hud.querySelectorAll("[data-dir]").forEach((b) => bindHold(b, (on) => setDir(b.dataset.dir, on)));
        // Joystick → strafe (A/D) + forward/back (W/S) intent.
        this._wireJoystick(
            this._hud.querySelector(".rcvf-stick"),
            this._hud.querySelector(".rcvf-knob"),
            (x, y) => { this._padStrafe = x; this._padForward = y; }
        );
        // Pan / tilt sliders → fly-cam yaw / pitch (same layout as the operator panel).
        this._wireSlider(this._hud.querySelector(".rcvf-pan"), this._hud.querySelector(".rcvf-pan-knob"), "x", (v) => { this._hudYaw = v; });
        this._wireSlider(this._hud.querySelector(".rcvf-tilt"), this._hud.querySelector(".rcvf-tilt-knob"), "y", (v) => { this._hudPitch = v; });

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
        // Status strip: transport click = start/stop, stills circle = snapshot;
        // free the pointer while hovering the strip so the clicks register.
        const strip = this._hud.querySelector(".rcvf-strip");
        if (strip) {
            strip.addEventListener("mouseenter", () => this.lockInput());
            strip.addEventListener("mouseleave", () => this.unlockInput());
        }
        this._hud.querySelectorAll("[data-rec]").forEach((b) =>
            b.addEventListener("click", () => this._toggleRecording()));
        const snapBtn = this._hud.querySelector("[data-snap]");
        if (snapBtn) snapBtn.addEventListener("click", () => {
            try { ArrivalSpace.fire("recorder:snapshot"); } catch (_) { /* ignore */ }
        });
        this._vfTcEl = this._hud.querySelector(".rcvf-tc");
        this._vfInfoEl = this._hud.querySelector(".rcvf-fmt");
        this._updateRecButtons();

        // Immersive viewport: hide the app's built-in UI while in the camera.
        ArrivalSpace.setAppUIVisible?.(false);
        this._uiHidden = true;

        // Input lock: touching any HUD control blocks player look/move via the app's
        // input-lock mechanic. Capture phase beats the controls' stopPropagation;
        // unlock on release anywhere.
        this._hud.addEventListener("pointerdown", () => {
            if (!this._hudLocked) { this._hudLocked = true; try { this.lockInput(); } catch (_) { /* ignore */ } }
        }, true);
        this._hudUnlock = () => {
            if (this._hudLocked) { this._hudLocked = false; try { this.unlockInput(); } catch (_) { /* ignore */ } }
        };
        window.addEventListener("pointerup", this._hudUnlock, true);
        window.addEventListener("pointercancel", this._hudUnlock, true);
    }

    _hideHud() {
        this.unlockInput();
        if (this._hudUnlock) {
            window.removeEventListener("pointerup", this._hudUnlock, true);
            window.removeEventListener("pointercancel", this._hudUnlock, true);
            this._hudUnlock = null;
        }
        this._hudLocked = false;
        if (this._uiHidden) { ArrivalSpace.setAppUIVisible?.(true); this._uiHidden = false; }
        if (this._expoApplied) {
            ArrivalSpace.setPostEffects?.({ brightness: this._baseBrightness });
            this._expoApplied = false;
        }
        if (this._hud) { this._hud.remove(); this._hud = null; }
        this._frameEl = this._fovEl = this._markEl = this._evEl = null;
        this._vfTcEl = this._vfInfoEl = null;
        this._padStrafe = this._padVert = this._padForward = this._zoomDir = this._zoomVel = this._expoDir = 0;
        this._hudYaw = this._hudPitch = 0;
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
            /* exit button — pinned to the viewport's top-right, its right edge aligned
               with the control cluster below (right:40px); Lila purple to match the
               operator panel's ENTER button (the mode-toggle action) */
            .rcvf-btn.rcvf-exit { position:absolute; top:30px; right:40px; padding:0 16px; height:36px;
                border-radius:9px; font-size:14px; letter-spacing:1px;
                background:#7a5af8; border-color:#7a5af8; box-shadow:0 3px 16px rgba(122,90,248,0.5); }
            .rcvf-btn.rcvf-exit:hover, .rcvf-btn.rcvf-exit:active { background:#8b6dff; border-color:#8b6dff; }
            /* cine status strip — top-left. Idle: record button + stills button ·
               cam label. Rolling: the buttons swap out for the blinking tally +
               SMPTE timecode + a small stop control (same pattern as the operator
               panel's transport) · cam label · format readout. */
            .rcvf-strip { display:flex; align-items:center;
                gap:12px; height:36px; padding:0 14px; pointer-events:auto;
                background:#0d0a16; border:1px solid rgba(255,255,255,0.10); border-radius:9px;
                box-shadow:0 16px 50px rgba(0,0,0,0.55); }
            .rcvf-shutter { width:26px; height:26px; border-radius:50%; position:relative; flex:none;
                cursor:pointer; padding:0; background:transparent;
                border:2px solid rgba(255,255,255,0.9); -webkit-tap-highlight-color:transparent; }
            .rcvf-shutter::after { content:''; position:absolute; inset:3px; border-radius:50%;
                background:#e53935; transition:background .15s ease; }
            .rcvf-shutter:hover::after { background:#ff453a; }
            .rcvf-tcwrap { display:none; align-items:center; gap:8px; color:#ff453a; }
            .rcvf-dot { width:9px; height:9px; border-radius:50%; background:#ff453a; flex:none;
                animation:rcvfBlink 1s steps(1) infinite; }
            @keyframes rcvfBlink { 50% { opacity:0; } }
            .rcvf-tc { font-size:13px; letter-spacing:1px; font-variant-numeric:tabular-nums; }
            .rcvf-stop { display:none; width:24px; height:24px; border-radius:50%; position:relative;
                flex:none; cursor:pointer; padding:0; background:transparent;
                border:2px solid rgba(255,255,255,0.85); -webkit-tap-highlight-color:transparent;
                transition:border-color .15s ease; }
            .rcvf-stop::after { content:''; position:absolute; inset:7px; border-radius:2px;
                background:#ff453a; }
            .rcvf-stop:hover { border-color:#ff453a; }
            /* recording: the buttons swap out for the running timecode + stop */
            .rcvf-recording .rcvf-shutter, .rcvf-recording .rcvf-snap { display:none; }
            .rcvf-recording .rcvf-tcwrap { display:flex; }
            .rcvf-recording .rcvf-stop { display:inline-block; }
            .rcvf-cam { font-size:10px; letter-spacing:2px; opacity:0.7; }
            .rcvf-fmt { font-size:10px; letter-spacing:1px; opacity:0.55;
                font-variant-numeric:tabular-nums; }
            .rcvf-snap { width:24px; height:24px; border-radius:50%; position:relative; flex:none;
                cursor:pointer; padding:0; background:transparent;
                border:2px solid rgba(255,255,255,0.7); -webkit-tap-highlight-color:transparent; }
            .rcvf-snap::after { content:''; position:absolute; inset:3px; border-radius:50%;
                background:rgba(255,255,255,0.85); transition:transform .12s ease; }
            .rcvf-snap:active::after { transform:scale(0.55); }
            /* camcorder tally: the frame corners go red while rolling */
            .rcvf-corner { transition:border-color .2s ease; }
            .rcvf-recording .rcvf-corner { border-color:#ff453a; }
            .rcvf-raw { position:absolute; bottom:32px; left:40px; background:#000; color:#fff;
                padding:4px 13px; border-radius:5px; font-size:16px; letter-spacing:2px; }

            /* operator control cluster — bottom-right; identical look to the outer panel */
            /* bottom-right stack: record strip above the operator control panel */
            .rcvf-cluster { position:absolute; right:40px; bottom:30px; pointer-events:none;
                display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
            .rcvf-panel { display:flex; align-items:center; gap:12px; pointer-events:auto;
                background:#0d0a16; border:1px solid rgba(255,255,255,0.10); border-radius:12px;
                padding:10px 12px; box-shadow:0 16px 50px rgba(0,0,0,0.55);
                font-family:"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif; }
            .rcvf-btn { pointer-events:auto; cursor:pointer; touch-action:none; user-select:none;
                -webkit-user-select:none; -webkit-tap-highlight-color:transparent;
                display:flex; align-items:center; justify-content:center; color:#f3f1fa;
                font:inherit; font-weight:600; background:rgba(255,255,255,0.05);
                border:1px solid rgba(255,255,255,0.12);
                transition:background .15s ease, border-color .15s ease; }
            .rcvf-btn:hover { background:rgba(255,255,255,0.09); border-color:rgba(167,139,255,0.5); }
            .rcvf-btn:active, .rcvf-btn.is-on { background:#7a5af8; border-color:#7a5af8; color:#fff; }
            .rcvf-stickwrap { display:flex; flex-direction:column; align-items:flex-end; gap:6px; flex:none; }
            .rcvf-stickrow { display:flex; align-items:center; gap:6px; }
            .rcvf-stick { width:100px; height:100px; border-radius:50%; position:relative; flex:none;
                background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12);
                touch-action:none; cursor:grab; pointer-events:auto; }
            .rcvf-stick:active { cursor:grabbing; }
            .rcvf-knob { position:absolute; left:50%; top:50%; width:44px; height:44px; border-radius:50%;
                transform:translate(-50%,-50%); background:#7a5af8; border:1px solid #8b6dff;
                box-shadow:0 2px 12px rgba(122,90,248,0.55); pointer-events:none;
                display:flex; align-items:center; justify-content:center;
                color:rgba(255,255,255,0.55); font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; }
            .rcvf-pan { width:100px; height:18px; border-radius:9px; position:relative; flex:none;
                background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); touch-action:none; cursor:grab; pointer-events:auto; }
            .rcvf-tilt { width:18px; height:100px; border-radius:9px; position:relative; flex:none;
                background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); touch-action:none; cursor:grab; pointer-events:auto; }
            .rcvf-pan-knob, .rcvf-tilt-knob { position:absolute; left:50%; top:50%; width:24px; height:24px;
                border-radius:50%; transform:translate(-50%,-50%); background:#7a5af8; border:1px solid #8b6dff;
                box-shadow:0 2px 10px rgba(122,90,248,0.5); pointer-events:none;
                display:flex; align-items:center; justify-content:center;
                color:rgba(255,255,255,0.55); font-size:6px; font-weight:700; text-transform:uppercase; letter-spacing:0.2px; }
            /* vert + zoom columns are both exactly 100px tall (45+10+45 vs
               34+5+22+5+34), so UP/DN edges line up with T/W — same as the
               operator panel. */
            .rcvf-vert { display:flex; flex-direction:column; gap:10px; flex:none; }
            .rcvf-vert .rcvf-btn { width:48px; height:45px; box-sizing:border-box; border-radius:7px; font-size:15px; }
            .rcvf-vert small { font-size:7px; opacity:0.55; margin-left:2px; letter-spacing:1px; }
            .rcvf-zoom { display:flex; flex-direction:column; align-items:center; gap:5px; flex:none; }
            .rcvf-zoom .rcvf-btn { width:44px; height:34px; box-sizing:border-box; border-radius:7px;
                font-size:14px; font-weight:700; flex-direction:column; gap:0; line-height:1; padding:0; }
            .rcvf-zoom .rcvf-btn small { font-size:6px; letter-spacing:1px; opacity:0.55; font-weight:normal; }
            .rcvf-mm { color:#f3f1fa; line-height:1.05; text-align:center; height:22px;
                display:flex; align-items:center; justify-content:center; }
            .rcvf-mm .rcvf-fov { font-size:14px; font-weight:700; }
            .rcvf-mm small { font-size:8px; opacity:0.6; letter-spacing:1px; margin-left:1px; }

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
            <div class="rcvf-strip">
                <button class="rcvf-shutter" data-rec aria-label="Record" title="Record"></button>
                <button class="rcvf-snap" data-snap aria-label="Snapshot" title="Snapshot"></button>
                <div class="rcvf-tcwrap"><span class="rcvf-dot"></span><span class="rcvf-tc">00:00:00:00</span></div>
                <button class="rcvf-stop" data-rec aria-label="Stop recording" title="Stop"></button>
                <span class="rcvf-cam">${this.operatorLabel || "CAM 01"}</span>
                <span class="rcvf-fmt"></span>
            </div>
            <div class="rcvf-panel">
                <div class="rcvf-stickwrap">
                    <div class="rcvf-pan" aria-label="Yaw"><div class="rcvf-pan-knob">yaw</div></div>
                    <div class="rcvf-stickrow">
                        <div class="rcvf-tilt" aria-label="Pitch"><div class="rcvf-tilt-knob">pitch</div></div>
                        <div class="rcvf-stick" aria-label="Move joystick"><div class="rcvf-knob">move</div></div>
                    </div>
                </div>
                <div class="rcvf-vert">
                    <button class="rcvf-btn" data-dir="up" aria-label="Up">＋<small>UP</small></button>
                    <button class="rcvf-btn" data-dir="down" aria-label="Down">－<small>DN</small></button>
                </div>
                <div class="rcvf-zoom">
                    <button class="rcvf-btn" data-zoom="tele" aria-label="Zoom tele">T<small>TELE</small></button>
                    <div class="rcvf-mm"><b class="rcvf-fov">${this._focalFromFov(this._currentFov)}</b><small>mm</small></div>
                    <button class="rcvf-btn" data-zoom="wide" aria-label="Zoom wide">W<small>WIDE</small></button>
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

    // Step the shared FOV at a constant rate while a zoom direction is held — no velocity
    // easing, so it stops instantly on release (no coasting). Returns true if it moved.
    _stepZoom(dt) {
        if (this._zoomDir === 0) return false;
        const before = this._currentFov;
        this._currentFov = pc.math.clamp(this._currentFov + this._zoomDir * ZOOM_SPEED * (dt || 0), FOV_MIN, FOV_MAX);
        return this._currentFov !== before;
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
        this._setFollowMeshHidden(false);   // never leave the camera body hidden
        this._unbindPointer();
        this._escUnsub?.();
        this._setUiClaim(false);           // give the recorder its fallback HUD back
        for (const [n, fn] of (this._recSubs || [])) { try { ArrivalSpace.off(n, fn); } catch (_) { /* ignore */ } }
        this._recSubs = [];
        this._hideHud();
        this._destroyOperator();
        this._destroyBox();
        if (this._hovered && document.body.style.cursor === "pointer") document.body.style.cursor = "auto";
        this._hovered = false;
        this.removeUI();
    }
}
