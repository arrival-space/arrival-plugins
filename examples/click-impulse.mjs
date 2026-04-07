/**
 * Click Impulse / Drag
 *
 * Two interaction modes for dynamic physics bodies (including ragdoll limbs):
 *  - "impulse": single click applies an impulse along the camera ray.
 *  - "drag":    click and hold to drag the clicked point around with a PD spring.
 *               Release to drop. Works on ragdoll limbs — constraints pull the
 *               rest of the body along.
 */
export class ClickImpulse extends ArrivalScript {
    static scriptName = "Click Impulse";

    mode = "drag"; // "drag" or "impulse"

    // Impulse mode
    impulseStrength = 8;
    applyAtHitPoint = true;

    // Drag mode (PD spring controller)
    dragStiffness = 120;
    dragDamping = 22;
    maxDragForce = 200;

    // Common
    maxDistance = 100;
    mouseButton = 0; // 0=left, 1=middle, 2=right

    static properties = {
        mode: { title: "Mode" },
        impulseStrength: { title: "Impulse Strength", min: 0, max: 200, step: 0.5 },
        applyAtHitPoint: { title: "Apply At Hit Point" },
        dragStiffness: { title: "Drag Stiffness", min: 1, max: 1000, step: 1 },
        dragDamping: { title: "Drag Damping", min: 0, max: 200, step: 0.5 },
        maxDragForce: { title: "Max Drag Force", min: 1, max: 2000, step: 1 },
        maxDistance: { title: "Max Ray Distance", min: 1, max: 1000, step: 1 },
        mouseButton: { title: "Mouse Button", min: 0, max: 2, step: 1 },
    };

    // Event handlers
    _onMouseDown = null;
    _onMouseMove = null;
    _onMouseUp = null;

    // Ray scratch
    _rayFrom = new pc.Vec3();
    _rayTo = new pc.Vec3();
    _rayDir = new pc.Vec3();

    // Drag state
    _dragBody = null;            // pc.RigidBodyComponent being held
    _dragLocalOffset = new pc.Vec3(); // grab point in body-local space (rotated frame)
    _dragDistance = 0;           // depth along camera forward at click time
    _mouseX = 0;
    _mouseY = 0;

    // Drag scratch
    _target = new pc.Vec3();
    _worldOffset = new pc.Vec3();
    _grabWorld = new pc.Vec3();
    _pointVel = new pc.Vec3();
    _camFwd = new pc.Vec3();
    _invRot = new pc.Quat();

    initialize() {
        // Make `mode` a dropdown in the editor
        this.setParamOptions("mode", ["drag", "impulse"], true);

        this._onMouseDown = (e) => this._handleMouseDown(e);
        this._onMouseMove = (e) => this._handleMouseMove(e);
        this._onMouseUp = (e) => this._handleMouseUp(e);

        // Capture phase: an input overlay sits on top of the canvas and swallows
        // mousedown unless pointer lock is engaged.
        window.addEventListener("mousedown", this._onMouseDown, true);
        window.addEventListener("mousemove", this._onMouseMove, true);
        window.addEventListener("mouseup", this._onMouseUp, true);
    }

    _handleMouseDown(e) {
        if (e.button !== this.mouseButton) return;

        const camEntity = ArrivalSpace.getCamera();
        if (!camEntity || !camEntity.camera) return;
        const cam = camEntity.camera;

        const canvas = this.app.graphicsDevice.canvas;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        cam.screenToWorld(x, y, cam.nearClip, this._rayFrom);
        cam.screenToWorld(x, y, Math.min(cam.farClip, this.maxDistance), this._rayTo);

        const hit = this.app.systems.rigidbody.raycastFirst(this._rayFrom, this._rayTo);
        if (!hit || !hit.entity || !hit.entity.rigidbody) return;

        const rb = hit.entity.rigidbody;
        if (rb.type !== pc.BODYTYPE_DYNAMIC) return;

        if (this.mode === "impulse") {
            this._applyImpulse(rb, hit);
            return;
        }

        // ---- Begin drag ----
        // Local offset = (hitPoint - bodyPos) rotated into the body's local frame
        const bodyPos = hit.entity.getPosition();
        const bodyRot = hit.entity.getRotation();
        this._worldOffset.sub2(hit.point, bodyPos);
        this._invRot.copy(bodyRot).invert();
        this._invRot.transformVector(this._worldOffset, this._dragLocalOffset);

        // Depth along camera forward — keeps the drag plane perpendicular to view
        this._camFwd.copy(camEntity.forward);
        this._dragDistance = this._worldOffset
            .copy(hit.point)
            .sub(camEntity.getPosition())
            .dot(this._camFwd);

        this._mouseX = e.clientX;
        this._mouseY = e.clientY;
        this._dragBody = rb;
        rb.activate();

        // Block the game's pointer input (camera look) while dragging
        this.lockInput();
    }

    _handleMouseMove(e) {
        if (!this._dragBody) return;
        this._mouseX = e.clientX;
        this._mouseY = e.clientY;
    }

    _handleMouseUp(e) {
        if (e.button !== this.mouseButton) return;
        if (!this._dragBody) return;
        this._dragBody = null;
        this.unlockInput();
    }

    _applyImpulse(rb, hit) {
        this._rayDir.sub2(this._rayTo, this._rayFrom).normalize().scale(this.impulseStrength);

        if (this.applyAtHitPoint) {
            const center = hit.entity.getPosition();
            const ox = hit.point.x - center.x;
            const oy = hit.point.y - center.y;
            const oz = hit.point.z - center.z;
            rb.applyImpulse(this._rayDir.x, this._rayDir.y, this._rayDir.z, ox, oy, oz);
        } else {
            rb.applyImpulse(this._rayDir.x, this._rayDir.y, this._rayDir.z);
        }
        rb.activate();
    }

    update(dt) {
        if (!this._dragBody) return;

        const body = this._dragBody.entity;
        if (!body || !body.rigidbody) {
            this._dragBody = null;
            return;
        }

        const camEntity = ArrivalSpace.getCamera();
        if (!camEntity || !camEntity.camera) return;
        const cam = camEntity.camera;

        // Target world point under the cursor at the original grab depth
        const canvas = this.app.graphicsDevice.canvas;
        const rect = canvas.getBoundingClientRect();
        cam.screenToWorld(
            this._mouseX - rect.left,
            this._mouseY - rect.top,
            this._dragDistance,
            this._target
        );

        // Current grab point in world space: bodyPos + bodyRot * localOffset
        body.getRotation().transformVector(this._dragLocalOffset, this._worldOffset);
        this._grabWorld.add2(body.getPosition(), this._worldOffset);

        // Velocity at grab point: linear + angular × worldOffset
        const lin = this._dragBody.linearVelocity;
        const ang = this._dragBody.angularVelocity;
        this._pointVel.cross(ang, this._worldOffset).add(lin);

        // PD controller: a = k*error - c*vel  (independent of mass)
        const k = this.dragStiffness;
        const c = this.dragDamping;
        const m = this._dragBody.mass;

        let ax = (this._target.x - this._grabWorld.x) * k - this._pointVel.x * c;
        let ay = (this._target.y - this._grabWorld.y) * k - this._pointVel.y * c;
        let az = (this._target.z - this._grabWorld.z) * k - this._pointVel.z * c;

        // Convert to impulse for this frame: J = m * a * dt
        let ix = ax * m * dt;
        let iy = ay * m * dt;
        let iz = az * m * dt;

        // Clamp so a wild cursor swing can't launch the body to the moon
        const maxJ = this.maxDragForce * m * dt;
        const mag = Math.sqrt(ix * ix + iy * iy + iz * iz);
        if (mag > maxJ && mag > 0) {
            const s = maxJ / mag;
            ix *= s; iy *= s; iz *= s;
        }

        this._dragBody.applyImpulse(ix, iy, iz, this._worldOffset.x, this._worldOffset.y, this._worldOffset.z);
        this._dragBody.activate();
    }

    destroy() {
        if (this._onMouseDown) window.removeEventListener("mousedown", this._onMouseDown, true);
        if (this._onMouseMove) window.removeEventListener("mousemove", this._onMouseMove, true);
        if (this._onMouseUp) window.removeEventListener("mouseup", this._onMouseUp, true);
        this._onMouseDown = null;
        this._onMouseMove = null;
        this._onMouseUp = null;
        if (this._dragBody) {
            this._dragBody = null;
            this.unlockInput();
        }
    }
}
