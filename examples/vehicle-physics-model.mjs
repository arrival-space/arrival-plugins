/**
 * Vehicle Physics Model
 *
 * Spawns a rigid-body vehicle with 4 wheels using Ammo.js
 * btRaycastVehicle. Walk up to it to auto-mount, then drive
 * with WASD. Press Esc to dismount. On mobile, the left
 * virtual stick provides analog steering and throttle, with
 * a tap-to-exit button.
 */
export class VehiclePhysicsModel extends ArrivalScript {
    static scriptName = "Vehicle Physics Model";

    // ── Models ──────────────────────────────────────────────
    chassisModelUrl = "https://dzrmwng2ae8bq.cloudfront.net/42485456/bd0e1f5573012b6340b53b69e8bc121a21e75944d2cba4cc3b9c0e5499b4a69c_x-bow-no-wheels_emissive_gray_as_turk.glb";
    chassisScale = 0.7;
    wheelModelUrl = "https://dzrmwng2ae8bq.cloudfront.net/42485456/e8d19a16b3c10ab03f5ab01749f4487975f70e4e1a997d92e107aa48164fdbf5_x-bow-wheel_turk.glb";
    wheelScale = 0.7;

    // ── Chassis ──────────────────────────────────────────────
    chassisMass = 200;

    // ── Wheels ───────────────────────────────────────────────
    wheelRadius = 0.20;
    wheelFrontX = 0.566;
    wheelRearX = 0.588;
    wheelY = 0.42;
    wheelFrontZ = 0.883;
    wheelRearZ = -0.807;

    // ── Suspension ───────────────────────────────────────────
    suspensionStiffness = 18;
    suspensionDamping = 1;
    suspensionCompression = 2.0;
    suspensionRestLength = 0.45;

    // ── Grip ─────────────────────────────────────────────────
    frictionSlipFront = 1.5;
    frictionSlipRear = 1.4;
    rollInfluence = 0.7;
    linearDamping = 0.1;
    angularDamping = 0.1;
    physicsHz = 120;
    physicsSubSteps = 30;

    // ── Motor ────────────────────────────────────────────────
    maxEngineForce = 300;
    maxBrakingForce = 4;
    idleBrake = 0.4;
    maxSteering = 0.5;
    minSteering = 0.17;
    steeringFalloffSpeed = 12;
    steeringSpeed = 4;

    // ── Collision Box ──────────────────────────────────────────
    collisionWidth = 0.607;
    collisionHeight = 0.207;
    collisionLength = 1.231;
    collisionY = 0.277;
    chassisFriction = 0.013;
    chassisRestitution = 0.1;

    // ── Headlights ──────────────────────────────────────────
    headlightX = 0.498;
    headlightY = 0.163;
    headlightZ = 1.265;
    headlightColor = "#ffe8c8";
    headlightIntensity = 9.653;
    headlightAngle = 45;
    headlightRange = 20;
    headlightTilt = 38.571;

    // ── Mounting ─────────────────────────────────────────────
    enterDistance = 1;
    seatOffsetX = 0.224;
    seatOffsetY = -0.184;
    seatOffsetZ = -0.016;
    cameraTargetHeightOffset = -0.3;
    cameraTargetDistance = 2.7;
    rideIdleUrl = "driving.glb";

    static properties = {
        chassisModelUrl:       { title: "Chassis Model (GLB)", editor: "asset" },
        chassisScale:          { title: "Chassis Scale",          min: 0.01, max: 10,  step: 0.01 },
        wheelModelUrl:         { title: "Wheel Model (GLB)", editor: "asset" },
        wheelScale:            { title: "Wheel Scale",            min: 0.01, max: 10,  step: 0.01 },
        chassisMass:           { title: "Chassis Mass",           min: 100,  max: 5000 },
        wheelRadius:           { title: "Wheel Radius",           min: 0.1,  max: 1 },
        wheelFrontX:           { title: "Front Wheel X",           min: 0.1,  max: 3,   step: 0.01 },
        wheelRearX:            { title: "Rear Wheel X",            min: 0.1,  max: 3,   step: 0.01 },
        wheelY:                { title: "Wheel Height",           min: 0.1,  max: 3,   step: 0.01 },
        wheelFrontZ:           { title: "Wheel Front Z",          min: 0,    max: 3,   step: 0.01 },
        wheelRearZ:            { title: "Wheel Rear Z",           min: -3,   max: 0,   step: 0.01 },
        suspensionStiffness:   { title: "Suspension Stiffness",   min: 1,    max: 100 },
        suspensionDamping:     { title: "Suspension Damping",     min: 0.1,  max: 10 },
        suspensionCompression: { title: "Suspension Compression", min: 0.1,  max: 10 },
        suspensionRestLength:  { title: "Suspension Rest",        min: 0.05, max: 1 },
        frictionSlipFront:     { title: "Front Friction Slip",    min: 0,    max: 5,   step: 0.01 },
        frictionSlipRear:      { title: "Rear Friction Slip",     min: 0,    max: 5,   step: 0.01 },
        rollInfluence:         { title: "Roll Influence",         min: 0,    max: 1,   step: 0.05 },
        linearDamping:         { title: "Air Friction",           min: 0,    max: 1,   step: 0.01 },
        angularDamping:        { title: "Angular Damping",        min: 0,    max: 1,   step: 0.01 },
        physicsHz:             { title: "Physics Hz",              min: 30,   max: 240, step: 10 },
        physicsSubSteps:       { title: "Physics Sub-Steps",       min: 1,    max: 60,  step: 1 },
        maxEngineForce:        { title: "Max Engine Force",       min: 0,    max: 10000 },
        maxBrakingForce:       { title: "Max Braking Force",      min: 0,    max: 500 },
        idleBrake:             { title: "Idle Brake",              min: 0,    max: 50,  step: 1 },
        maxSteering:           { title: "Max Steering",           min: 0.05, max: 1,   step: 0.05 },
        minSteering:           { title: "Min Steering (at speed)", min: 0,    max: 0.5, step: 0.01 },
        steeringFalloffSpeed:  { title: "Steering Falloff Speed",  min: 1,    max: 50,  step: 1 },
        steeringSpeed:         { title: "Steering Speed",          min: 1,    max: 30,  step: 1 },
        collisionWidth:        { title: "Collision Width",          min: 0.05, max: 5,   step: 0.01 },
        collisionHeight:       { title: "Collision Height",         min: 0.01, max: 2,   step: 0.01 },
        collisionLength:       { title: "Collision Length",         min: 0.05, max: 5,   step: 0.01 },
        collisionY:            { title: "Collision Y Offset",       min: 0,    max: 3,   step: 0.01 },
        chassisFriction:       { title: "Chassis Friction",          min: 0,    max: 1,   step: 0.01 },
        chassisRestitution:    { title: "Chassis Restitution",       min: 0,    max: 1,   step: 0.01 },
        headlightX:            { title: "Headlight Side",            min: 0,    max: 2,   step: 0.01 },
        headlightY:            { title: "Headlight Height",          min: -1,   max: 2,   step: 0.01 },
        headlightZ:            { title: "Headlight Forward",         min: -1,   max: 3,   step: 0.01 },
        headlightColor:        { title: "Headlight Color",           editor: "color" },
        headlightIntensity:    { title: "Headlight Intensity",       min: 0,    max: 20,  step: 0.1 },
        headlightAngle:        { title: "Headlight Cone Angle",      min: 1,    max: 90,  step: 1 },
        headlightRange:        { title: "Headlight Range",           min: 1,    max: 100, step: 1 },
        headlightTilt:         { title: "Headlight Tilt",            min: -45,  max: 45,  step: 1 },
        enterDistance:         { title: "Enter Distance",         min: 1,    max: 10 },
        seatOffsetX:           { title: "Seat Side",              min: -1,   max: 1,   step: 0.05 },
        seatOffsetY:           { title: "Seat Height",            min: -1,   max: 3,   step: 0.05 },
        seatOffsetZ:           { title: "Seat Forward",           min: -1,   max: 1,   step: 0.05 },
        cameraTargetHeightOffset: { title: "Camera Height Offset", min: -1, max: 2, step: 0.05 },
        cameraTargetDistance:  { title: "Camera Distance",        min: 0.8,  max: 4,   step: 0.05 },
        rideIdleUrl:           { title: "Ride Idle Animation" },
    };

    // ── Private state ────────────────────────────────────────
    _vehicle = null;
    _raycaster = null;
    _tuning = null;
    _wheelEntities = [];
    _chassisModelEntity = null;
    _wheelModelEntities = [];
    _headlightEntities = [];
    _shapeEntities = [];
    _mounted = false;
    _currentSteering = 0;
    _dismountCooldown = 0;
    _hintEl = null;
    _savedCameraTargetHeightOffset = null;

    // Seat back (small upright behind driver)
    static SEAT_HE = [0.18, 0.14, 0.04];
    static SEAT_POS = [0, 0.49, -0.35];

    _getWheels() {
        return [
            { x:  this.wheelFrontX, y: this.wheelY, z:  this.wheelFrontZ, front: true  },  // FL
            { x: -this.wheelFrontX, y: this.wheelY, z:  this.wheelFrontZ, front: true  },  // FR
            { x:  this.wheelRearX,  y: this.wheelY, z:  this.wheelRearZ,  front: false },  // RL
            { x: -this.wheelRearX,  y: this.wheelY, z:  this.wheelRearZ,  front: false },  // RR
        ];
    }

    async initialize() {
        if (typeof Ammo === "undefined") {
            console.error("[VehiclePhysicsModel] Ammo.js not available");
            return;
        }
        await this._syncAnimationOptions();
        this._spawnPos = this.entity.getPosition().clone();
        this._spawnRot = this.entity.getRotation().clone();
        this._savedStepRate = {
            stepHz: 1 / this.app.systems.rigidbody.fixedTimeStep,
            maxSubSteps: this.app.systems.rigidbody.maxSubSteps,
        };
        this.setPhysicsStepRate(this.physicsHz, this.physicsSubSteps);
        this._buildPhysics();
        await this._buildVisuals();
        this._createHeadlights();
        this._createVehicle();
        this._createHint();
    }

    // ═════════════════════════════════════════════════════════
    //  PHYSICS SETUP
    // ═════════════════════════════════════════════════════════

    _buildPhysics() {
        if (this.entity.rigidbody) this.entity.removeComponent("rigidbody");
        if (this.entity.collision) this.entity.removeComponent("collision");

        this.entity.addComponent("collision", { type: "compound" });

        const chassis = new pc.Entity("ChassisShape");
        chassis.addComponent("collision", {
            type: "box",
            halfExtents: new pc.Vec3(this.collisionWidth, this.collisionHeight, this.collisionLength),
        });
        chassis.setLocalPosition(0, this.collisionY, 0);
        this.entity.addChild(chassis);
        this._shapeEntities.push(chassis);

        const seat = new pc.Entity("SeatShape");
        seat.addComponent("collision", {
            type: "box",
            halfExtents: new pc.Vec3(...VehiclePhysicsModel.SEAT_HE),
        });
        seat.setLocalPosition(...VehiclePhysicsModel.SEAT_POS);
        this.entity.addChild(seat);
        this._shapeEntities.push(seat);

        this.entity.addComponent("rigidbody", {
            type: pc.BODYTYPE_DYNAMIC,
            mass: this.chassisMass,
            friction: this.chassisFriction,
            restitution: this.chassisRestitution,
        });
    }

    // ═════════════════════════════════════════════════════════
    //  VISUALS
    // ═════════════════════════════════════════════════════════

    async _buildVisuals() {
        // Chassis model
        await this._loadChassisModel();

        // Wheel containers (positioned by physics each frame)
        for (let i = 0; i < 4; i++) {
            const container = new pc.Entity(`Wheel_${i}`);
            this.entity.addChild(container);
            this._wheelEntities.push(container);
        }

        await this._loadWheelModels();
    }

    async _loadChassisModel() {
        if (this._chassisModelEntity) {
            ArrivalSpace.disposeEntity(this._chassisModelEntity);
            this._chassisModelEntity = null;
        }
        if (!this.chassisModelUrl) return;
        try {
            const { entity } = await this.createModel(this.chassisModelUrl, {
                parent: this.entity,
                name: "ChassisModel",
                scale: this.chassisScale,
            });
            this._chassisModelEntity = entity;
        } catch (err) {
            console.error("[VehiclePhysicsModel] Failed to load chassis model:", err);
        }
    }

    async _loadWheelModels() {
        // Dispose old wheel models
        for (const m of this._wheelModelEntities) {
            if (m && !m._destroyed) ArrivalSpace.disposeEntity(m);
        }
        this._wheelModelEntities = [];

        if (!this.wheelModelUrl) return;

        for (let i = 0; i < this._wheelEntities.length; i++) {
            const container = this._wheelEntities[i];
            try {
                const { entity } = await this.createModel(this.wheelModelUrl, {
                    parent: container,
                    name: "WheelModel",
                    scale: this.wheelScale,
                });
                // Left-side wheels (FL=0, RL=2): flip 180° so outside faces out
                if (i === 0 || i === 2) {
                    entity.setLocalEulerAngles(0, 180, 0);
                }
                this._wheelModelEntities.push(entity);
            } catch (err) {
                console.error("[VehiclePhysicsModel] Failed to load wheel model:", err);
                this._wheelModelEntities.push(null);
            }
        }
    }

    // ═════════════════════════════════════════════════════════
    //  HEADLIGHTS
    // ═════════════════════════════════════════════════════════

    _hexToColor(hex) {
        const h = hex.replace("#", "");
        const r = parseInt(h.substring(0, 2), 16) / 255;
        const g = parseInt(h.substring(2, 4), 16) / 255;
        const b = parseInt(h.substring(4, 6), 16) / 255;
        return new pc.Color(r, g, b);
    }

    _createHeadlights() {
        for (const l of this._headlightEntities) {
            if (l && !l._destroyed) l.destroy();
        }
        this._headlightEntities = [];

        const color = this._hexToColor(this.headlightColor);

        for (let side = -1; side <= 1; side += 2) {
            const light = new pc.Entity(`Headlight_${side > 0 ? "R" : "L"}`);
            light.addComponent("light", {
                type: "spot",
                color: color,
                intensity: this.headlightIntensity,
                innerConeAngle: this.headlightAngle * 0.5,
                outerConeAngle: this.headlightAngle,
                range: this.headlightRange,
                castShadows: false,
            });
            light.setLocalPosition(this.headlightX * side, this.headlightY, this.headlightZ);
            light.setLocalEulerAngles(-90 + this.headlightTilt, 0, 0);
            this.entity.addChild(light);
            this._headlightEntities.push(light);
        }
    }

    _updateHeadlights() {
        const color = this._hexToColor(this.headlightColor);
        for (let i = 0; i < this._headlightEntities.length; i++) {
            const light = this._headlightEntities[i];
            if (!light || light._destroyed) continue;
            const side = i === 0 ? -1 : 1;
            light.setLocalPosition(this.headlightX * side, this.headlightY, this.headlightZ);
            light.setLocalEulerAngles(-90 + this.headlightTilt, 0, 0);
            light.light.color = color;
            light.light.intensity = this.headlightIntensity;
            light.light.innerConeAngle = this.headlightAngle * 0.5;
            light.light.outerConeAngle = this.headlightAngle;
            light.light.range = this.headlightRange;
        }
    }

    // ═════════════════════════════════════════════════════════
    //  RAYCAST VEHICLE
    // ═════════════════════════════════════════════════════════

    _createVehicle() {
        const body = this.entity.rigidbody.body;
        const world = this.app.systems.rigidbody.dynamicsWorld;

        this._tuning = new Ammo.btVehicleTuning();
        this._raycaster = new Ammo.btDefaultVehicleRaycaster(world);
        this._vehicle = new Ammo.btRaycastVehicle(this._tuning, body, this._raycaster);
        this._vehicle.setCoordinateSystem(0, 1, 2);

        world.addAction(this._vehicle);

        // Air friction (linear + angular damping)
        body.setDamping(this.linearDamping, this.angularDamping);

        const dir  = new Ammo.btVector3(0, -1, 0);
        const axle = new Ammo.btVector3(-1, 0, 0);

        for (const def of this._getWheels()) {
            const cp = new Ammo.btVector3(def.x, def.y, def.z);
            const info = this._vehicle.addWheel(
                cp, dir, axle,
                this.suspensionRestLength,
                this.wheelRadius,
                this._tuning,
                def.front,
            );
            info.set_m_suspensionStiffness(this.suspensionStiffness);
            info.set_m_wheelsDampingRelaxation(this.suspensionDamping);
            info.set_m_wheelsDampingCompression(this.suspensionCompression);
            info.set_m_frictionSlip(def.front ? this.frictionSlipFront : this.frictionSlipRear);
            info.set_m_rollInfluence(this.rollInfluence);
            Ammo.destroy(cp);
        }

        Ammo.destroy(dir);
        Ammo.destroy(axle);

        body.setActivationState(4); // DISABLE_DEACTIVATION
    }

    _updateWheelPositions() {
        if (!this._vehicle) return;
        const wheels = this._getWheels();
        const n = this._vehicle.getNumWheels();
        for (let i = 0; i < n; i++) {
            const info = this._vehicle.getWheelInfo(i);
            const def = wheels[i];
            info.get_m_chassisConnectionPointCS().setValue(def.x, def.y, def.z);
        }
    }

    // ═════════════════════════════════════════════════════════
    //  ANIMATION OPTIONS
    // ═════════════════════════════════════════════════════════

    async _syncAnimationOptions() {
        const avatarConfig = await ArrivalSpace.getAvatarConfig();
        const gender = avatarConfig?.gender === "female" ? "female" : "male";
        const animations = await ArrivalSpace.getAvatarAnimationCatalog(gender);
        if (!Array.isArray(animations) || animations.length === 0) return;
        this.setParamOptions("rideIdleUrl", ["", ...animations], false);
        this.refreshParamSchema();
    }

    // ═════════════════════════════════════════════════════════
    //  HINT UI
    // ═════════════════════════════════════════════════════════

    _createHint() {
        const ui = this.getUIContainer();
        ui.innerHTML = `
            <style>
                .vehicle-hint {
                    position: fixed;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0, 0, 0, 0.35);
                    color: #fff;
                    padding: 6px 16px;
                    border-radius: 6px;
                    font: 13px/1.4 sans-serif;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.25s;
                    white-space: nowrap;
                }
                .vehicle-hint.visible { opacity: 1; }
                .vehicle-hint kbd {
                    background: rgba(255,255,255,0.15);
                    border: 1px solid rgba(255,255,255,0.25);
                    border-radius: 3px;
                    padding: 1px 6px;
                    margin: 0 2px;
                    font-family: inherit;
                }
                .vehicle-speed {
                    position: fixed;
                    top: 52px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0, 0, 0, 0.35);
                    color: #fff;
                    padding: 4px 12px;
                    border-radius: 6px;
                    font: 15px/1.4 monospace;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.25s;
                }
                .vehicle-speed.visible { opacity: 1; }
                .vehicle-exit-btn {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: rgba(0, 0, 0, 0.5);
                    color: #fff;
                    border: 1px solid rgba(255,255,255,0.3);
                    border-radius: 8px;
                    padding: 10px 18px;
                    font: 15px/1.2 sans-serif;
                    cursor: pointer;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.25s;
                    z-index: 100;
                    -webkit-tap-highlight-color: transparent;
                }
                .vehicle-exit-btn.visible { opacity: 1; pointer-events: auto; }
                .vehicle-exit-btn:active { background: rgba(255,255,255,0.2); }
            </style>
            <div class="vehicle-speed"></div>
            <div class="vehicle-hint"></div>
            <button class="vehicle-exit-btn">Exit</button>
        `;
        this._hintEl = ui.querySelector(".vehicle-hint");
        this._speedEl = ui.querySelector(".vehicle-speed");
        this._exitBtn = ui.querySelector(".vehicle-exit-btn");
        this._exitBtn.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._dismount();
        });
    }

    _showHint(text) {
        if (!this._hintEl) return;
        if (text) {
            this._hintEl.innerHTML = text;
            this._hintEl.classList.add("visible");
        } else {
            this._hintEl.classList.remove("visible");
        }
    }

    // ═════════════════════════════════════════════════════════
    //  MOUNT / DISMOUNT
    // ═════════════════════════════════════════════════════════

    _mount() {
        if (this._mounted) return;
        this._mounted = true;
        this._currentSteering = 0;

        // Lock character movement so WASD goes to vehicle instead
        this.lockKeyboard();

        // Disable player collision capsule so it doesn't interfere with the vehicle
        ArrivalSpace.setPlayerCollision(false);

        // Apply shared camera target height offset while mounted
        this._savedCameraTargetHeightOffset = ArrivalSpace.getCameraTargetHeightOffset();
        ArrivalSpace.setCameraTargetHeightOffset(this.cameraTargetHeightOffset);
        ArrivalSpace.setCameraTargetDistance(this.cameraTargetDistance);

        // Track vehicle yaw for camera sync (atan2 on forward, avoids Euler flips)
        const fwd = this.entity.forward;
        this._lastVehicleYaw = Math.atan2(-fwd.x, -fwd.z) * (180 / Math.PI);

        // Apply ride idle animation
        if (this.rideIdleUrl) {
            ArrivalSpace.setPlayerAnimation("Idle", this.rideIdleUrl);
            ArrivalSpace.setPlayerAnimation("Forward", this.rideIdleUrl);
        }

        if (this.isMobile) {
            this._showHint("Stick to drive");
            if (this._exitBtn) this._exitBtn.classList.add("visible");
        } else {
            this._showHint("<kbd>WASD</kbd> drive · <kbd>Space</kbd> brake · <kbd>R</kbd> flip · <kbd>Esc</kbd> exit");
        }
        if (this._speedEl) this._speedEl.classList.add("visible");

        // Snap player onto seat immediately
        this._teleportPlayerToSeat();
    }

    _dismount() {
        if (!this._mounted) return;
        this._mounted = false;
        this._dismountCooldown = 1.0; // prevent immediate re-mount

        // Release vehicle controls
        this.applyEngineForce(0);
        this.setBrake(0);
        this.setSteering(0);

        // Unlock character movement
        this.unlockKeyboard();

        // Reset animations
        ArrivalSpace.setPlayerAnimation("Idle", null);
        ArrivalSpace.setPlayerAnimation("Forward", null);

        this._showHint(null);
        if (this._speedEl) this._speedEl.classList.remove("visible");
        if (this._exitBtn) this._exitBtn.classList.remove("visible");

        // Re-enable player collision capsule
        ArrivalSpace.setPlayerCollision(true);

        // Restore previous shared camera target height offset
        const restoreOffset = this._savedCameraTargetHeightOffset ?? 0;
        ArrivalSpace.setCameraTargetHeightOffset(restoreOffset);
        this._savedCameraTargetHeightOffset = null;

        // Teleport player to the right side of the vehicle
        const player = ArrivalSpace.getPlayer();
        if (!player) return;

        const pos = this.entity.getPosition();
        const right = this.entity.right.clone().mulScalar(2.5);
        const exitPos = pos.clone().add(right);
        exitPos.y += 1;

        if (player.rigidbody) {
            player.rigidbody.teleport(exitPos);
        } else {
            player.setPosition(exitPos);
        }
    }

    _teleportPlayerToSeat() {
        const player = ArrivalSpace.getPlayer();
        if (!player) return;

        // Seat position in vehicle local space → world
        const seatLocal = new pc.Vec3(this.seatOffsetX, this.seatOffsetY, this.seatOffsetZ);
        const seatWorld = this.entity.getWorldTransform().transformPoint(seatLocal);

        if (player.rigidbody) {
            player.rigidbody.teleport(seatWorld);
        } else {
            player.setPosition(seatWorld);
        }

        // Match player mesh rotation to vehicle chassis (including tilt)
        const mesh = ArrivalSpace.getPlayerMesh();
        if (mesh) {
            const rot = this.entity.getRotation();
            mesh.setRotation(rot);
        }
    }

    // ═════════════════════════════════════════════════════════
    //  PROXIMITY CHECK
    // ═════════════════════════════════════════════════════════

    _checkProximity() {
        if (this._dismountCooldown > 0) return;

        const player = ArrivalSpace.getPlayer();
        if (!player) return;

        const dist = player.getPosition().distance(this.entity.getPosition());
        if (dist < this.enterDistance) {
            this._mount();
        }
    }

    // ═════════════════════════════════════════════════════════
    //  DRIVING INPUT
    // ═════════════════════════════════════════════════════════

    _handleInput(dt) {
        const kb = this.app.keyboard;
        const stick = this.getLeftStick();

        // Dismount
        if (kb.wasPressed(pc.KEY_ESCAPE)) {
            this._dismount();
            return;
        }

        // Flip upright
        if (kb.wasPressed(pc.KEY_R)) {
            const pos = this.entity.getPosition();
            const fwd = this.entity.forward;
            const yaw = Math.atan2(-fwd.x, -fwd.z) * (180 / Math.PI);
            this.entity.rigidbody.teleport(pos.x, pos.y + 0.5, pos.z, 0, yaw, 0);
            this.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
            this.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
            return;
        }

        // Speed
        const speed = this.entity.rigidbody.linearVelocity.length();
        const kmh = (speed / 0.7) * 3.6;
        if (this._speedEl) this._speedEl.textContent = `${Math.round(kmh)} km/h`;

        // Steering (decays with speed)
        const steerLimit = pc.math.lerp(this.maxSteering, this.minSteering,
            pc.math.clamp(speed / this.steeringFalloffSpeed, 0, 1));
        let targetSteering = 0;
        if (kb.isPressed(pc.KEY_A) || kb.isPressed(pc.KEY_LEFT))  targetSteering =  steerLimit;
        if (kb.isPressed(pc.KEY_D) || kb.isPressed(pc.KEY_RIGHT)) targetSteering = -steerLimit;
        // Mobile stick steering (analog)
        if (Math.abs(stick.x) > 0.05) targetSteering = -stick.x * steerLimit;
        this._currentSteering = pc.math.lerp(this._currentSteering, targetSteering, dt * this.steeringSpeed);
        this.setSteering(this._currentSteering);

        // Engine / brake
        let engineForce = 0;
        let brakeForce = 0;
        const throttle = kb.isPressed(pc.KEY_W) || kb.isPressed(pc.KEY_UP) || stick.y > 0.1;
        const reverse  = kb.isPressed(pc.KEY_S) || kb.isPressed(pc.KEY_DOWN) || stick.y < -0.1;
        // Forward speed: positive = moving forward
        const fwdSpeed = -this.entity.forward.dot(this.entity.rigidbody.linearVelocity);
        if (throttle) {
            engineForce = this.maxEngineForce;
            // Analog throttle from stick
            if (stick.y > 0.1) engineForce *= Math.min(1, stick.y);
        } else if (reverse) {
            if (fwdSpeed > 0.3) {
                brakeForce = this.maxBrakingForce;
                if (stick.y < -0.1) brakeForce *= Math.min(1, Math.abs(stick.y));
            } else {
                engineForce = -this.maxEngineForce * 0.5;
                if (stick.y < -0.1) engineForce *= Math.min(1, Math.abs(stick.y));
            }
        } else {
            brakeForce = this.idleBrake;
        }
        if (kb.isPressed(pc.KEY_SPACE)) brakeForce = this.maxBrakingForce;

        this.applyEngineForce(engineForce);
        this.setBrake(brakeForce);
    }

    // ═════════════════════════════════════════════════════════
    //  FRAME UPDATES
    // ═════════════════════════════════════════════════════════

    update(dt) {
        if (!this._vehicle) return;

        if (this._dismountCooldown > 0) this._dismountCooldown -= dt;

        // Reset if fallen off the world
        if (this.entity.getPosition().y < -100) {
            this._resetToSpawn();
        }


        // Flip upright if tipped on its side
        const up = this.entity.up;
        if (up.y < 0.0) {
            const pos = this.entity.getPosition();
            const fwd = this.entity.forward;
            const yaw = Math.atan2(-fwd.x, -fwd.z) * (180 / Math.PI);
            this.entity.rigidbody.teleport(pos.x, pos.y + 0.5, pos.z, 0, yaw, 0);
            this.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
            this.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
        }

        if (this._mounted) {
            this._handleInput(dt);
        } else {
            this._checkProximity();
            this.applyEngineForce(0);
            this.setBrake(this.idleBrake);
        }

    }

    postUpdate() {
        if (!this._vehicle) return;

        // Sync wheel visuals (after physics step)
        const n = this._vehicle.getNumWheels();
        for (let i = 0; i < n; i++) {
            this._vehicle.updateWheelTransform(i, true);
            const tm = this._vehicle.getWheelTransformWS(i);
            const p = tm.getOrigin();
            const q = tm.getRotation();
            const we = this._wheelEntities[i];
            if (we) {
                we.setPosition(p.x(), p.y(), p.z());
                we.setRotation(q.x(), q.y(), q.z(), q.w());
            }
        }

        if (!this._mounted) return;

        this._teleportPlayerToSeat();

        // Rotate camera by the same yaw delta as the vehicle
        const fwd = this.entity.forward;
        const yaw = Math.atan2(-fwd.x, -fwd.z) * (180 / Math.PI);
        let delta = yaw - this._lastVehicleYaw;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        this._lastVehicleYaw = yaw;
        if (Math.abs(delta) > 0.001) {
            this.app.fire("firstperson:look", delta, 0);
        }
    }

    // ═════════════════════════════════════════════════════════
    //  RESET
    // ═════════════════════════════════════════════════════════

    _resetToSpawn() {
        if (!this.entity.rigidbody) return;
        this.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
        this.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
        this.entity.rigidbody.teleport(this._spawnPos, this._spawnRot);
    }

    // ═════════════════════════════════════════════════════════
    //  MOTOR API
    // ═════════════════════════════════════════════════════════

    onEntityMoved() {
        this._spawnPos = this.entity.getPosition().clone();
        this._spawnRot = this.entity.getRotation().clone();

        if (!this.entity.rigidbody) return;

        this.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
        this.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
        this.entity.rigidbody.teleport(this._spawnPos, this._spawnRot);
    }

    applyEngineForce(force) {
        if (!this._vehicle) return;
        this._vehicle.applyEngineForce(force, 2);
        this._vehicle.applyEngineForce(force, 3);
    }

    setBrake(force) {
        if (!this._vehicle) return;
        this._vehicle.setBrake(force, 2);
        this._vehicle.setBrake(force, 3);
    }

    setSteering(angle) {
        if (!this._vehicle) return;
        this._vehicle.setSteeringValue(angle, 0);
        this._vehicle.setSteeringValue(angle, 1);
    }

    // ═════════════════════════════════════════════════════════
    //  PROPERTY CHANGES
    // ═════════════════════════════════════════════════════════

    onPropertyChanged(name) {
        if (name === "cameraTargetHeightOffset") {
            if (this._mounted) {
                ArrivalSpace.setCameraTargetHeightOffset(this.cameraTargetHeightOffset);
            }
            return;
        }
        if (name === "cameraTargetDistance") {
            if (this._mounted) {
                ArrivalSpace.setCameraTargetDistance(this.cameraTargetDistance);
            }
            return;
        }
        if (name === "rideIdleUrl") {
            if (this._mounted) {
                ArrivalSpace.setPlayerAnimation("Idle", this.rideIdleUrl || null);
                ArrivalSpace.setPlayerAnimation("Forward", this.rideIdleUrl || null);
            }
            return;
        }
        // Headlight properties
        if (name.startsWith("headlight")) {
            this._updateHeadlights();
            return;
        }
        if (name === "chassisModelUrl") {
            this._loadChassisModel();
            return;
        }
        if (name === "chassisScale" && this._chassisModelEntity) {
            const s = this.chassisScale;
            this._chassisModelEntity.setLocalScale(s, s, s);
            return;
        }
        if (name === "wheelModelUrl") {
            this._loadWheelModels();
            return;
        }
        if (name === "wheelScale") {
            const s = this.wheelScale;
            for (const m of this._wheelModelEntities) {
                if (m && !m._destroyed) m.setLocalScale(s, s, s);
            }
            return;
        }
        // Collision box changed — update the chassis shape entity
        if (name === "collisionWidth" || name === "collisionHeight" || name === "collisionLength" || name === "collisionY") {
            const chassisShape = this._shapeEntities[0];
            if (chassisShape?.collision) {
                chassisShape.collision.halfExtents = new pc.Vec3(this.collisionWidth, this.collisionHeight, this.collisionLength);
                chassisShape.setLocalPosition(0, this.collisionY, 0);
            }
            return;
        }
        // Chassis friction / restitution
        if (name === "chassisFriction" || name === "chassisRestitution") {
            if (this.entity.rigidbody) {
                this.entity.rigidbody.friction = this.chassisFriction;
                this.entity.rigidbody.restitution = this.chassisRestitution;
            }
            return;
        }
        // Wheel position changed — update connection points in-place
        if (name === "wheelFrontX" || name === "wheelRearX" || name === "wheelY" || name === "wheelFrontZ" || name === "wheelRearZ") {
            this._updateWheelPositions();
            return;
        }
        if (this._vehicle) {
            const n = this._vehicle.getNumWheels();
            for (let i = 0; i < n; i++) {
                const info = this._vehicle.getWheelInfo(i);
                const front = i < 2;
                info.set_m_suspensionStiffness(this.suspensionStiffness);
                info.set_m_wheelsDampingRelaxation(this.suspensionDamping);
                info.set_m_wheelsDampingCompression(this.suspensionCompression);
                info.set_m_frictionSlip(front ? this.frictionSlipFront : this.frictionSlipRear);
                info.set_m_rollInfluence(this.rollInfluence);
            }
        }
    }

    // ═════════════════════════════════════════════════════════
    //  CLEANUP
    // ═════════════════════════════════════════════════════════

    destroy() {
        // Restore original physics step rate
        if (this._savedStepRate) {
            this.setPhysicsStepRate(this._savedStepRate.stepHz, this._savedStepRate.maxSubSteps);
        }

        // Dismount player first (while vehicle still exists)
        if (this._mounted) this._dismount();

        // Remove vehicle action before touching rigidbody
        if (this._vehicle) {
            const world = this.app.systems.rigidbody?.dynamicsWorld;
            if (world) world.removeAction(this._vehicle);
            Ammo.destroy(this._vehicle);
            this._vehicle = null;
        }
        if (this._raycaster) { Ammo.destroy(this._raycaster); this._raycaster = null; }
        if (this._tuning)    { Ammo.destroy(this._tuning);    this._tuning = null; }

        // Dispose GLB models
        if (this._chassisModelEntity) {
            ArrivalSpace.disposeEntity(this._chassisModelEntity);
            this._chassisModelEntity = null;
        }
        for (const m of this._wheelModelEntities) {
            if (m && !m._destroyed) ArrivalSpace.disposeEntity(m);
        }
        this._wheelModelEntities = [];

        this._wheelEntities = [];

        for (const s of this._shapeEntities) {
            if (s && !s._destroyed) s.destroy();
        }
        this._shapeEntities = [];

        for (const l of this._headlightEntities) {
            if (l && !l._destroyed) l.destroy();
        }
        this._headlightEntities = [];

        if (this.entity.rigidbody) this.entity.removeComponent("rigidbody");
        if (this.entity.collision) this.entity.removeComponent("collision");
    }
}
