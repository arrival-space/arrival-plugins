/**
 * Vehicle Physics Model
 *
 * Spawns a rigid-body vehicle with 4 wheels using Ammo.js
 * btRaycastVehicle. Walk up to it to auto-mount, then drive
 * with WASD. Press Esc to dismount. On mobile, the left
 * virtual stick provides analog steering and throttle, with
 * a tap-to-exit button.
 *
 * Multiplayer: Uses ArrivalSpace.attachPlayerToEntity() to
 * broadcast mount state and vehicle quaternion. Remote clients
 * derive vehicle position from the already-synced player avatar.
 */
export class SkateboardModel extends ArrivalScript {
    static scriptName = "Skateboard";
    static EXTRA_SYNC_RATE = 20;

    // ── Models ──────────────────────────────────────────────
    chassisModelUrl = "https://dzrmwng2ae8bq.cloudfront.net/42485456/a6694ca53596284ccc4b8ecc8d9cc9838a8b71a8f61f831e4201c5d09f9d74c9_skateboard.glb";
    chassisScale = 0.5;
    chassisOffsetY = 0;
    chassisRotationX = 0;
    chassisRotationY = 90;
    chassisRotationZ = 0;
    boardLean = 0;
    riderLean = 0;
    riderLag = 0.12;
    wheelModelUrl = "https://dzrmwng2ae8bq.cloudfront.net/42485456/a9d3253bbded709a96819158b9f58d63d6a0a6c964ca2b09ab9c1df6f5400c0c_kart_wheels.glb";
    wheelScale = 0.01;
    wheelOffsetX = 0;
    wheelOffsetY = 0;
    debugWheels = false;

    // ── Chassis ──────────────────────────────────────────────
    chassisMass = 100;

    // ── Wheels ───────────────────────────────────────────────
    wheelRadius = 0.1;
    wheelFrontX = 0.356;
    wheelRearX = 0.407;
    wheelY = 0.432;
    wheelFrontZ = 0.298;
    wheelRearZ = -0.42;

    // ── Suspension ───────────────────────────────────────────
    suspensionStiffness = 18;
    suspensionDamping = 1;
    suspensionCompression = 2.0;
    suspensionRestLength = 0.45;

    // ── Grip ─────────────────────────────────────────────────
    frictionSlipFront = 1.5;
    frictionSlipRear = 1.46;
    rollInfluence = 0.7;
    linearDamping = 0.1;
    angularDamping = 0.1;
    physicsHz = 120;
    physicsSubSteps = 30;

    // ── Motor ────────────────────────────────────────────────
    maxEngineForce = 200;
    maxBrakingForce = 4;
    idleBrake = 0.0;
    maxSteering = 0.7;
    minSteering = 0.1;
    steeringFalloffSpeed = 12;
    steeringSpeed = 3.5;
    jumpImpulse = 180;

    // ── Collision Box ──────────────────────────────────────────
    collisionWidth = 0.421;
    collisionHeight = 0.167;
    collisionLength = 0.563;
    collisionY = 0.277;
    collisionFrontOffset = -0.031;
    chassisFriction = 0.013;
    chassisRestitution = 0.1;

    // ── Mounting ─────────────────────────────────────────────
    enterDistance = 1;
    seatOffsetX = 0.036;
    seatOffsetY = 0.074;
    seatOffsetZ = -0.063;
    rideIdleUrl = "skate_idle.glb";
    rideAccelUrl = "skate_accelerating.glb";
    rideJumpUrl = "";
    rideJumpDuration = 0.35;
    rideAccelInPlaceY = 0;
    rideAccelInPlaceZ = 0;
    rollingSoundUrl = "";
    rollingSoundVolume = 0.2;
    rollingSoundMinSpeed = 1.2;
    rollingSoundMaxSpeed = 8;
    rollingSoundMinPitch = 0.85;
    rollingSoundMinPitchSpeed = 1.2;
    rollingSoundPitch = 1;
    rollingSoundPitchSpeed = 8;

    static properties = {
        chassisModelUrl:       { title: "Chassis Model (GLB)", editor: "asset" },
        chassisScale:          { title: "Chassis Scale",          min: 0.01, max: 10,  step: 0.001 },
        chassisOffsetY:        { title: "Chassis Offset Y",       min: -1,   max: 1,   step: 0.001 },
        chassisRotationX:      { title: "Chassis Rotation X",     min: -180, max: 180, step: 1 },
        chassisRotationY:      { title: "Chassis Rotation Y",     min: -180, max: 180, step: 1 },
        chassisRotationZ:      { title: "Chassis Rotation Z",     min: -180, max: 180, step: 1 },
        boardLean:             { title: "Board Lean",             min: -45,  max: 45,  step: 0.1 },
        riderLean:             { title: "Rider Lean",             min: -10,  max: 10,  step: 0.01 },
        riderLag:              { title: "Rider Lag",              min: 0,    max: 1,   step: 0.01 },
        wheelModelUrl:         { title: "Wheel Model (GLB)", editor: "asset" },
        wheelScale:            { title: "Wheel Scale",            min: 0.01, max: 10,  step: 0.001 },
        wheelOffsetX:          { title: "Wheel Visual Offset X",  min: -0.4,   max: 0.4,   step: 0.001 },
        wheelOffsetY:          { title: "Wheel Visual Offset Y",  min: -0.4,   max: 0.4,   step: 0.001 },
        debugWheels:           { title: "Debug Wheels" },
        chassisMass:           { title: "Chassis Mass",           min: 0.1,  max: 200 },
        wheelRadius:           { title: "Wheel Radius",           min: 0.01,  max: 1 },
        wheelFrontX:           { title: "Front Wheel X",           min: 0.01,  max: 1,   step: 0.001 },
        wheelRearX:            { title: "Rear Wheel X",            min: 0.01,  max: 1,   step: 0.001 },
        wheelY:                { title: "Wheel Height",           min: 0.01,  max: 1,   step: 0.001 },
        wheelFrontZ:           { title: "Wheel Front Z",          min: 0,    max: 1,   step: 0.001 },
        wheelRearZ:            { title: "Wheel Rear Z",           min: -1,   max: 0,   step: 0.001 },
        suspensionStiffness:   { title: "Suspension Stiffness",   min: 1,    max: 1000 },
        suspensionDamping:     { title: "Suspension Damping",     min: 0.1,  max: 100 },
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
        jumpImpulse:           { title: "Jump Impulse",           min: 0,    max: 1000, step: 1 },
        collisionWidth:        { title: "Collision Width",          min: 0.05, max: 5,   step: 0.01 },
        collisionHeight:       { title: "Collision Height",         min: 0.01, max: 2,   step: 0.01 },
        collisionLength:       { title: "Collision Length",         min: 0.05, max: 5,   step: 0.01 },
        collisionY:            { title: "Collision Y Offset",       min: 0,    max: 3,   step: 0.01 },
        collisionFrontOffset:  { title: "Collision Front Offset",   min: -3,   max: 3,   step: 0.01 },
        chassisFriction:       { title: "Chassis Friction",          min: 0,    max: 1,   step: 0.01 },
        chassisRestitution:    { title: "Chassis Restitution",       min: 0,    max: 1,   step: 0.01 },
        enterDistance:         { title: "Enter Distance",         min: 0,    max: 10 },
        seatOffsetX:           { title: "Seat Side",              min: -1,   max: 1,   step: 0.05 },
        seatOffsetY:           { title: "Seat Height",            min: -1,   max: 3,   step: 0.05 },
        seatOffsetZ:           { title: "Seat Forward",           min: -1,   max: 1,   step: 0.05 },
        rideIdleUrl:           { title: "Ride Idle Animation" },
        rideAccelUrl:          { title: "Ride Accelerate Animation" },
        rideJumpUrl:           { title: "Ride Jump Animation" },
        rideJumpDuration:      { title: "Ride Jump Duration",     min: 0.05, max: 2,   step: 0.01 },
        rideAccelInPlaceY:     { title: "Ride Accel InPlace Y",   min: -2,   max: 2,   step: 0.001 },
        rideAccelInPlaceZ:     { title: "Ride Accel InPlace Z",   min: -2,   max: 2,   step: 0.001 },
        rollingSoundUrl:       { title: "Rolling Sound", editor: "asset" },
        rollingSoundVolume:         { title: "Rolling Sound Volume",          min: 0,    max: 10,  step: 0.01 },
        rollingSoundMinSpeed:       { title: "Rolling Sound Min Speed",       min: 0,    max: 20,  step: 0.1 },
        rollingSoundMaxSpeed:       { title: "Rolling Sound Max Speed",       min: 0.1,  max: 50,  step: 0.1 },
        rollingSoundMinPitch:       { title: "Pitch Value Min", min: 0.25, max: 3, step: 0.01 },
        rollingSoundMinPitchSpeed:  { title: "Pitch Speed Min", min: 0, max: 50, step: 0.1 },
        rollingSoundPitch:          { title: "Pitch Value Max", min: 0.25, max: 4, step: 0.01 },
        rollingSoundPitchSpeed:     { title: "Pitch Speed Max", min: 0.1, max: 50, step: 0.1 },
    };

    // ── Private state ────────────────────────────────────────
    _vehicle = null;
    _raycaster = null;
    _tuning = null;
    _wheelEntities = [];
    _wheelPivotEntities = [];
    _chassisModelEntity = null;
    _wheelModelEntities = [];
    _shapeEntities = [];
    _mounted = false;
    _currentSteering = 0;
    _currentSteerInput = 0;
    _dismountCooldown = 0;
    _jumpCooldown = 0;
    _rideAccelActive = false;
    _rideAccelPrimed = false;
    _rideJumpTimer = null;
    _currentSpeed = 0;
    _wasOnAir = null;
    _rollingSoundEntity = null;
    _rollingSoundSlot = null;
    _rollingSoundPending = false;
    _rollingSoundRequestId = 0;

    // Seat back (small upright behind driver)
    static SEAT_HE = [0.18, 0.14, 0.04];
    static SEAT_POS = [0, 0.49, -0.35];

    // Multiplayer
    _attachHandle = null;
    _remoteInfo = null;
    _remoteExtra = null;
    _unsubAttach = null;
    _wheelSpinAngle = 0;
    _remotePrevPos = null;
    _remotePrevRot = null;
    _remoteRiderRotation = null;
    _remoteOnAir = false;

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
            console.error("[SkateboardModel] Ammo.js not available");
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
        this._createVehicle();
        this._createHint();

        // Listen for remote players mounting this vehicle
        this._unsubAttach = ArrivalSpace.onEntityAttachChanged(this.entity, (info, dismountData) => {
            if (info) {
                console.log('[Vehicle] Remote driver mounted:', info.userId);
                this._remoteInfo = info;
                this._remoteExtra = null;
                this._remoteExtraLast = null;
                this._remoteExtraLastTime = null;
                this._remoteRiderRotation = null;
                this._remoteOnAir = false;

                this._wheelSpinAngle = 0;
                this.entity.rigidbody.type = pc.BODYTYPE_KINEMATIC;
                info.onExtra((ex) => { this._remoteExtraLastTime = Date.now(); this._remoteExtraLast = this._remoteExtra; this._remoteExtra = ex; });

                this._destroyVehicle();

            } else {
                console.log('[Vehicle] Remote driver dismounted');
                this._destroyVehicle();
                this.entity.rigidbody.type = pc.BODYTYPE_DYNAMIC;
                this._createVehicle();
                this._currentSteerInput = 0;
                this._applyChassisModelTransform();

                // Sync position and velocity from the driver's state at dismount
                if (dismountData) {
                    if (dismountData.pos) {
                        const p = new pc.Vec3(dismountData.pos[0], dismountData.pos[1], dismountData.pos[2]);
                        const r = dismountData.rot ? new pc.Quat(dismountData.rot[0], dismountData.rot[1], dismountData.rot[2], dismountData.rot[3]) : this.entity.getRotation();
                        this.entity.rigidbody.teleport(p, r);
                    }
                    if (dismountData.lv) {
                        this.entity.rigidbody.linearVelocity = new pc.Vec3(dismountData.lv[0], dismountData.lv[1], dismountData.lv[2]);
                    }
                    if (dismountData.av) {
                        this.entity.rigidbody.angularVelocity = new pc.Vec3(dismountData.av[0], dismountData.av[1], dismountData.av[2]);
                    }
                }

                this._remoteInfo = null;
                this._remoteRiderRotation = null;
                this._remoteOnAir = false;
            }
        });
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
            type: "capsule",
            radius: this.collisionWidth,
            height: this.collisionLength * 2,
            axis: 2,
        });
        chassis.setLocalPosition(0, this.collisionY, this.collisionFrontOffset);
        this.entity.addChild(chassis);
        this._shapeEntities.push(chassis);

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
            const pivot = new pc.Entity(`WheelPivot_${i}`);
            container.addChild(pivot);
            this.entity.addChild(container);
            this._wheelEntities.push(container);
            this._wheelPivotEntities.push(pivot);
        }

        await this._loadWheelModels();
    }

    _applyChassisModelTransform() {
        if (!this._chassisModelEntity || this._chassisModelEntity._destroyed) return;
        const s = this.chassisScale;
        const steerRatio = pc.math.clamp(this._currentSteerInput, -1, 1);
        const visualLeanZ = -steerRatio * this.boardLean;
        this._chassisModelEntity.setLocalScale(s, s, s);
        this._chassisModelEntity.setLocalPosition(0, this.chassisOffsetY, 0);
        this._chassisModelEntity.setLocalEulerAngles(this.chassisRotationX, this.chassisRotationY, this.chassisRotationZ + visualLeanZ);
    }

    _getRiderLeanAngle(speed = this._currentSpeed, steer = this._currentSteering) {
        return this.riderLean * steer * speed;
    }

    _applyRemoteRiderLean(driverEntity, baseRotation, leanAngle, dt) {
        const riderMesh = driverEntity.findByName("ReadyPlayerMe");
        if (!riderMesh) return;
        const targetRotation = baseRotation.clone().mul(new pc.Quat().setFromEulerAngles(0, 0, leanAngle));
        if (this.riderLag > 0) {
            if (!this._remoteRiderRotation) {
                this._remoteRiderRotation = targetRotation.clone();
            } else {
                const alpha = 1 - Math.exp(-dt / this.riderLag);
                this._remoteRiderRotation.slerp(this._remoteRiderRotation.clone(), targetRotation, alpha);
            }
            riderMesh.setRotation(this._remoteRiderRotation);
            return;
        }

        this._remoteRiderRotation = null;
        riderMesh.setRotation(targetRotation);
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
            this._applyChassisModelTransform();
        } catch (err) {
            console.error("[SkateboardModel] Failed to load chassis model:", err);
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
            const container = this._wheelPivotEntities[i];
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
                console.error("[SkateboardModel] Failed to load wheel model:", err);
                this._wheelModelEntities.push(null);
            }
        }

        this._applyWheelModelOffsets();
    }

    _applyWheelModelOffsets() {
        // Wheel visual offset is applied on the wheel container position so steering
        // and spin still happen around the visual wheel center.
    }

    _getWheelVisualOffset(i) {
        const isLeftWheel = i === 0 || i === 2;
        return this.entity.right.clone().mulScalar(isLeftWheel ? this.wheelOffsetX : -this.wheelOffsetX)
            .add(this.entity.up.clone().mulScalar(this.wheelOffsetY));
    }

    // ═════════════════════════════════════════════════════════
    //  RAYCAST VEHICLE
    // ═════════════════════════════════════════════════════════

    _destroyVehicle() {
        if (this._vehicle) {
            const world = this.app.systems.rigidbody?.dynamicsWorld;
            if (world) world.removeAction(this._vehicle);
            Ammo.destroy(this._vehicle);
            this._vehicle = null;
        }
        if (this._raycaster) { Ammo.destroy(this._raycaster); this._raycaster = null; }
    }

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

    _isOnAir() {
        if (!this._vehicle) return false;

        const wheelCount = this._vehicle.getNumWheels();
        for (let i = 0; i < wheelCount; i++) {
            const wheelInfo = this._vehicle.getWheelInfo(i);
            const raycastInfo = wheelInfo?.get_m_raycastInfo?.();
            const groundObject = raycastInfo?.get_m_groundObject?.() ?? raycastInfo?.m_groundObject;
            if (groundObject) {
                return false;
            }
        }

        return true;
    }

    _procOnAirState(onAir = this._isOnAir()) {
        if (this._wasOnAir === onAir) return;

        this._wasOnAir = onAir;
        console.log("[Skateboard] onAir:", onAir);

        if (onAir) {
            this.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
        }
    }

    // ═════════════════════════════════════════════════════════
    //  REMOTE MODE: derive vehicle from player position
    // ═════════════════════════════════════════════════════════

    _updateRemote(dt) {
        if (!this._remoteInfo) return;

        // Find the remote driver's avatar entity
        const players = ArrivalSpace.net.getPlayers();
        const driver = players.find(p => p.userID == this._remoteInfo.userId);
        const driverEntity = driver?.entity;
        if (!driverEntity) {
            if (!this._remoteLoggedNoDriver) {
                console.warn('[Vehicle] Remote mode: driver entity not found for userId:', this._remoteInfo.userId, 'players:', players.map(p => p.userID));
                this._remoteLoggedNoDriver = true;
            }
            this._currentSpeed = 0;
            this._remoteOnAir = false;
            this._updateRollingSound();
            return;
        }
        this._remoteLoggedNoDriver = false;

        const off = this._remoteInfo.offset;
        const quat = this._remoteInfo.quaternion;

        // Derive vehicle position: playerPos - quat * seatOffset
        const playerPos = driverEntity.getPosition();
        const seatLocal = new pc.Vec3(off.x, off.y, off.z);
        const seatWorld = new pc.Vec3();
        quat.transformVector(seatLocal, seatWorld);
        const vehiclePos = playerPos.clone().sub(seatWorld);

        // Compute delta for character controller platform-riding
        if (this._remotePrevPos && dt > 0) {
            this.entity._kinematicPosDelta = vehiclePos.clone().sub(this._remotePrevPos);
            this.entity._kinematicRotDelta = this._remotePrevRot.clone().invert().mul(quat);
        } else {
            this.entity._kinematicPosDelta = new pc.Vec3();
        }
        this._remotePrevPos = vehiclePos.clone();
        this._remotePrevRot = quat.clone();
        this._currentSpeed = dt > 0 ? this.entity._kinematicPosDelta.length() / dt : 0;

        // Apply vehicle transform
        this.entity.setPosition(vehiclePos);
        this.entity.setRotation(quat);

        const extraLerp = this._remoteExtraLastTime
            ? Math.min(1, (Date.now() - this._remoteExtraLastTime) / (1000 / SkateboardModel.EXTRA_SYNC_RATE))
            : 1;
        const steerInput = pc.math.lerp(this._remoteExtraLast?.steerInput || 0, this._remoteExtra?.steerInput || 0, extraLerp);
        const riderLean = pc.math.lerp(this._remoteExtraLast?.riderLean || 0, this._remoteExtra?.riderLean || 0, extraLerp);
        this._remoteOnAir = !!(this._remoteExtra?.onAir ?? this._remoteExtraLast?.onAir ?? false);
        this._currentSteerInput = steerInput;
        this._applyChassisModelTransform();
        this._applyRemoteRiderLean(driverEntity, quat, riderLean, dt);
        this._updateRollingSound();

        // Update wheels at static offsets with steering + spin
        this._updateWheelsRemote();
    }

    _updateWheelsRemote() {
        const wheels = this._getWheels();

        const extraLerp = this._remoteExtraLastTime
            ? Math.min(1, (Date.now() - this._remoteExtraLastTime) / (1000 / SkateboardModel.EXTRA_SYNC_RATE))
            : 1;

        const steer = pc.math.lerp(this._remoteExtraLast?.steer || 0, this._remoteExtra?.steer || 0, extraLerp);
        const wheelRot = pc.math.lerp(this._remoteExtraLast?.wheelRot || 0, this._remoteExtra?.wheelRot || 0, extraLerp);

        const wt = this.entity.getWorldTransform();

        for (let i = 0; i < wheels.length; i++) {
            const def = wheels[i];
            const we = this._wheelEntities[i];
            const pivot = this._wheelPivotEntities[i];
            if (!we) continue;

            const localPos = new pc.Vec3(def.x, def.y - this.suspensionRestLength*0.75, def.z);
            const worldPos = wt.transformPoint(localPos).add(this._getWheelVisualOffset(i));
            we.setPosition(worldPos);

            const chassisRot = this.entity.getRotation().clone();
            const steerAngle = def.front ? (steer * 180 / Math.PI) : 0;

            const spinQuat = new pc.Quat().setFromEulerAngles(-wheelRot * 180 / Math.PI, steerAngle+180, 0);
            if (pivot) pivot.setRotation(chassisRot.clone().mul(spinQuat));
        }
    }

    _drawWheelDebug() {
        if (!this.debugWheels) return;

        this._drawChassisDebugShape();
        this._drawWheelRayDebug();
        this._drawPlayerDebugCross();

        if (this._remoteInfo) {
            const wheels = this._getWheels();
            const wt = this.entity.getWorldTransform();

            for (let i = 0; i < wheels.length; i++) {
                const def = wheels[i];
                const pivot = this._wheelPivotEntities[i];
                const debugCenter = wt.transformPoint(new pc.Vec3(def.x, def.y - this.suspensionRestLength * 0.75, def.z));
                this._drawWheelDebugShape(debugCenter, pivot ? pivot.getRotation() : this.entity.getRotation(), i < 2);
            }
            return;
        }

        if (!this._vehicle) return;

        for (let i = 0; i < this._vehicle.getNumWheels(); i++) {
            const pivot = this._wheelPivotEntities[i];
            this._vehicle.updateWheelTransform(i, true);
            const tm = this._vehicle.getWheelTransformWS(i);
            const p = tm.getOrigin();
            const debugCenter = new pc.Vec3(p.x(), p.y(), p.z());
            this._drawWheelDebugShape(debugCenter, pivot ? pivot.getRotation() : this.entity.getRotation(), i < 2);
        }
    }

    _drawWheelRayDebug() {
        const wt = this.entity.getWorldTransform();
        const rayLength = this.suspensionRestLength + this.wheelRadius;
        const positions = [];

        for (const wheel of this._getWheels()) {
            const start = wt.transformPoint(new pc.Vec3(wheel.x, wheel.y, wheel.z));
            const end = wt.transformPoint(new pc.Vec3(wheel.x, wheel.y - rayLength, wheel.z));
            positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
        }

        this.app.drawLineArrays(positions, new pc.Color(0.45, 1, 0.45), false);
    }

    _drawWheelDebugShape(center, rotation, isFrontWheel) {
        const radius = this.wheelRadius;
        const rimSegments = 20;
        const spokeCount = 4;
        const color = isFrontWheel ? new pc.Color(0.15, 0.85, 1) : new pc.Color(1, 0.65, 0.2);
        const up = rotation.transformVector(pc.Vec3.UP.clone());
        const forward = rotation.transformVector(pc.Vec3.FORWARD.clone());
        const positions = [];

        const appendLine = (from, to) => {
            positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
        };

        const getRimPoint = (angle) => {
            const radial = up.clone().mulScalar(Math.cos(angle)).add(forward.clone().mulScalar(Math.sin(angle)));
            return center.clone().add(radial.mulScalar(radius));
        };

        for (let i = 0; i < rimSegments; i++) {
            const a0 = (i / rimSegments) * Math.PI * 2;
            const a1 = ((i + 1) / rimSegments) * Math.PI * 2;
            appendLine(getRimPoint(a0), getRimPoint(a1));
        }

        for (let i = 0; i < spokeCount; i++) {
            const angle = (i / spokeCount) * Math.PI * 2;
            appendLine(center, getRimPoint(angle));
        }

        this.app.drawLineArrays(positions, color, false);
    }

    _drawChassisDebugShape() {
        const chassisShape = this._shapeEntities[0];
        const collision = chassisShape?.collision;
        if (!collision) return;

        const wt = chassisShape.getWorldTransform();
        const color = new pc.Color(1, 1, 1);
        const positions = [];
        const appendLineLocal = (from, to) => {
            const worldFrom = wt.transformPoint(from);
            const worldTo = wt.transformPoint(to);
            positions.push(worldFrom.x, worldFrom.y, worldFrom.z, worldTo.x, worldTo.y, worldTo.z);
        };

        if (collision.type === "box" && collision.halfExtents) {
            const he = collision.halfExtents;
            const localCorners = [
                new pc.Vec3(-he.x, -he.y, -he.z),
                new pc.Vec3( he.x, -he.y, -he.z),
                new pc.Vec3( he.x, -he.y,  he.z),
                new pc.Vec3(-he.x, -he.y,  he.z),
                new pc.Vec3(-he.x,  he.y, -he.z),
                new pc.Vec3( he.x,  he.y, -he.z),
                new pc.Vec3( he.x,  he.y,  he.z),
                new pc.Vec3(-he.x,  he.y,  he.z),
            ];
            const edges = [
                [0, 1], [1, 2], [2, 3], [3, 0],
                [4, 5], [5, 6], [6, 7], [7, 4],
                [0, 4], [1, 5], [2, 6], [3, 7],
            ];

            for (const [start, end] of edges) {
                appendLineLocal(localCorners[start], localCorners[end]);
            }
        } else if (collision.type === "capsule") {
            const radius = collision.radius || 0.01;
            const height = collision.height || radius * 2;
            const axis = collision.axis ?? 1;
            const axisVec = axis === 0 ? pc.Vec3.RIGHT.clone() : axis === 2 ? pc.Vec3.FORWARD.clone() : pc.Vec3.UP.clone();
            const radialA = axis === 0 ? pc.Vec3.UP.clone() : pc.Vec3.RIGHT.clone();
            const radialB = axis === 2 ? pc.Vec3.UP.clone() : pc.Vec3.FORWARD.clone();
            const cylinderHalf = Math.max(0, height * 0.5 - radius);
            const capBack = axisVec.clone().mulScalar(-cylinderHalf);
            const capFront = axisVec.clone().mulScalar(cylinderHalf);
            const circleSegments = 16;

            const appendCircle = (center, basisA, basisB) => {
                let prev = null;
                for (let i = 0; i <= circleSegments; i++) {
                    const angle = (i / circleSegments) * Math.PI * 2;
                    const point = center.clone()
                        .add(basisA.clone().mulScalar(Math.cos(angle) * radius))
                        .add(basisB.clone().mulScalar(Math.sin(angle) * radius));
                    if (prev) appendLineLocal(prev, point);
                    prev = point;
                }
            };

            const appendSemiArc = (center, radial, axisSign) => {
                let prev = null;
                for (let i = 0; i <= circleSegments; i++) {
                    const angle = -Math.PI * 0.5 + (i / circleSegments) * Math.PI;
                    const point = center.clone()
                        .add(radial.clone().mulScalar(Math.sin(angle) * radius))
                        .add(axisVec.clone().mulScalar(axisSign * Math.cos(angle) * radius));
                    if (prev) appendLineLocal(prev, point);
                    prev = point;
                }
            };

            appendCircle(capBack, radialA, radialB);
            appendCircle(capFront, radialA, radialB);

            appendLineLocal(capBack.clone().add(radialA.clone().mulScalar(radius)), capFront.clone().add(radialA.clone().mulScalar(radius)));
            appendLineLocal(capBack.clone().add(radialA.clone().mulScalar(-radius)), capFront.clone().add(radialA.clone().mulScalar(-radius)));
            appendLineLocal(capBack.clone().add(radialB.clone().mulScalar(radius)), capFront.clone().add(radialB.clone().mulScalar(radius)));
            appendLineLocal(capBack.clone().add(radialB.clone().mulScalar(-radius)), capFront.clone().add(radialB.clone().mulScalar(-radius)));

            appendSemiArc(capFront, radialA, 1);
            appendSemiArc(capBack, radialA, -1);
            appendSemiArc(capFront, radialB, 1);
            appendSemiArc(capBack, radialB, -1);
        }

        this.app.drawLineArrays(positions, color, false);
    }

    // ═════════════════════════════════════════════════════════
    //  ANIMATION OPTIONS
    // ═════════════════════════════════════════════════════════

    _drawPlayerDebugCross() {
        const player = ArrivalSpace.getPlayer();
        if (!player) return;

        const center = player.getPosition();
        const size = 0.15;
        const positions = [
            center.x - size, center.y, center.z, center.x + size, center.y, center.z,
            center.x, center.y - size, center.z, center.x, center.y + size, center.z,
            center.x, center.y, center.z - size, center.x, center.y, center.z + size,
        ];

        this.app.drawLineArrays(positions, new pc.Color(1, 0.2, 0.85), false);
    }

    async _syncAnimationOptions() {
        const avatarConfig = await ArrivalSpace.getAvatarConfig();
        const gender = avatarConfig?.gender === "female" ? "female" : "male";
        const animations = await ArrivalSpace.getAvatarAnimationCatalog(gender);
        if (!Array.isArray(animations) || animations.length === 0) return;
        const opts = ["", ...animations];
        this.setParamOptions("rideIdleUrl", opts, false);
        this.setParamOptions("rideAccelUrl", opts, false);
        this.setParamOptions("rideJumpUrl", opts, false);
        this.refreshParamSchema();
    }

    _applyRideAccelAnimation() {
        if (!this._mounted) return;
        ArrivalSpace.setPlayerAnimation("Signature1", this.rideAccelUrl || null, {
            inPlaceBoneName: "LeftToeBase",
            inPlaceBoneTargetLocalPosition: { x: 0, y: this.rideAccelInPlaceY, z: this.rideAccelInPlaceZ }
        });
    }

    _applyRideIdleAnimation() {
        if (!this._mounted) return;
        const options = this.rideIdleUrl ? {
            inPlaceBoneName: "LeftToeBase",
            inPlaceBoneTargetLocalPosition: { x: 0, y: this.rideAccelInPlaceY, z: this.rideAccelInPlaceZ }
        } : undefined;
        ArrivalSpace.setPlayerAnimation("Idle", this.rideIdleUrl || null, options);
        ArrivalSpace.setPlayerAnimation("Forward", this.rideIdleUrl || null, options);
    }

    _applyRideJumpAnimation() {
        if (!this._mounted) return;
        ArrivalSpace.setPlayerAnimation("Signature2", this.rideJumpUrl || null, {
            inPlaceBoneName: "LeftToeBase",
            inPlaceBoneTargetLocalPosition: { x: 0, y: this.rideAccelInPlaceY, z: this.rideAccelInPlaceZ }
        });
    }

    _clearRideSignatures() {
        const player = ArrivalSpace.getPlayer();
        const playerMesh = player?.findByName("ReadyPlayerMe");
        if (playerMesh?.anim) {
            playerMesh.anim.setInteger("signatureNumber", -1);
        }

        const firstPersonView = player?.script?.firstPersonView;
        if (firstPersonView) {
            firstPersonView.signatureReset = true;
            firstPersonView.signature = 0;
        }

        this.app.fire("firstperson:signature", false, 1);
        this.app.fire("firstperson:signature", false, 2);
    }

    _setRideAccelActive(active) {
        if (this._rideAccelActive === active) return;
        if (active && !this._rideAccelPrimed && this.rideAccelUrl) {
            this._applyRideAccelAnimation();
            this._rideAccelPrimed = true;
        }
        this._rideAccelActive = active;
        if (!active) {
            this._clearRideSignatures();
        }
        this.app.fire("firstperson:signature", active, 1);
    }

    _playRideJumpAnimation() {
        if (!this._mounted || !this.rideJumpUrl) return;

        if (this._rideJumpTimer) {
            clearTimeout(this._rideJumpTimer);
            this._rideJumpTimer = null;
        }

        this._clearRideSignatures();
        this.app.fire("firstperson:signature", true, 2);

        this._rideJumpTimer = setTimeout(() => {
            this._rideJumpTimer = null;
            if (!this._mounted) return;

            this._clearRideSignatures();
        }, Math.max(50, this.rideJumpDuration * 1000));
    }

    // ═════════════════════════════════════════════════════════
    //  HINT UI
    // ═════════════════════════════════════════════════════════

    _shouldPlayRollingSound() {
        const onAir = this._remoteInfo ? this._remoteOnAir : this._isOnAir();
        return !!this.rollingSoundUrl && this._currentSpeed >= this.rollingSoundMinSpeed && !onAir;
    }

    _getRollingSoundVolume() {
        const maxSpeed = Math.max(this.rollingSoundMaxSpeed, this.rollingSoundMinSpeed + 0.01);
        const speedT = pc.math.clamp((this._currentSpeed - this.rollingSoundMinSpeed) / (maxSpeed - this.rollingSoundMinSpeed), 0, 1);
        return pc.math.lerp(0, this.rollingSoundVolume, speedT);
    }

    _getRollingSoundPitch() {
        const minPitchSpeed = this.rollingSoundMinPitchSpeed;
        const targetPitchSpeed = Math.max(this.rollingSoundPitchSpeed, minPitchSpeed + 0.01);

        if (this._currentSpeed <= minPitchSpeed) {
            return this.rollingSoundMinPitch;
        }

        const pitchSlope = (this.rollingSoundPitch - this.rollingSoundMinPitch) / (targetPitchSpeed - minPitchSpeed);
        return this.rollingSoundMinPitch + (this._currentSpeed - minPitchSpeed) * pitchSlope;
    }

    async _startRollingSound() {
        if (!this.rollingSoundUrl || this._rollingSoundSlot || this._rollingSoundPending) return;

        const requestId = ++this._rollingSoundRequestId;
        const soundUrl = this.rollingSoundUrl;
        this._rollingSoundPending = true;

        try {
            const { entity, slot } = await ArrivalSpace.playSound(soundUrl, {
                entity: this.entity,
                loop: true,
                volume: this._getRollingSoundVolume(),
                pitch: this._getRollingSoundPitch(),
            });

            if (requestId !== this._rollingSoundRequestId || soundUrl !== this.rollingSoundUrl || !this._shouldPlayRollingSound()) {
                slot.stop();
                if (entity && entity !== this.entity && !entity._destroyed) {
                    ArrivalSpace.disposeEntity(entity);
                }
                return;
            }

            this._rollingSoundEntity = entity;
            this._rollingSoundSlot = slot;
            this._updateRollingSoundAudio();
        } catch (err) {
            console.error('[SkateboardModel] Failed to start rolling sound:', err);
        } finally {
            if (requestId === this._rollingSoundRequestId) {
                this._rollingSoundPending = false;
            }
        }
    }

    _stopRollingSound() {
        this._rollingSoundRequestId++;
        this._rollingSoundPending = false;

        if (this._rollingSoundSlot) {
            this._rollingSoundSlot.stop();
            this._rollingSoundSlot = null;
        }
        if (this._rollingSoundEntity && this._rollingSoundEntity !== this.entity && !this._rollingSoundEntity._destroyed) {
            ArrivalSpace.disposeEntity(this._rollingSoundEntity);
        }
        this._rollingSoundEntity = null;
    }

    _updateRollingSoundAudio() {
        if (!this._rollingSoundSlot) return;
        if (typeof this._rollingSoundSlot.volume === 'number') {
            this._rollingSoundSlot.volume = this._getRollingSoundVolume();
        }
        if (typeof this._rollingSoundSlot.pitch === 'number') {
            this._rollingSoundSlot.pitch = this._getRollingSoundPitch();
        }
    }

    _updateRollingSound() {
        if (!this._shouldPlayRollingSound()) {
            this._stopRollingSound();
            return;
        }
        if (!this._rollingSoundSlot) {
            this._startRollingSound();
            return;
        }
        this._updateRollingSoundAudio();
    }

    _createHint() {
        const ui = this.getUIContainer();
        ui.innerHTML = `
            <style>
                .vehicle-speed {
                    position: fixed;
                    top: 20px;
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
            </style>
            <div class="vehicle-speed"></div>
        `;
        this._speedEl = ui.querySelector(".vehicle-speed");
    }

    // ═════════════════════════════════════════════════════════
    //  MOUNT / DISMOUNT
    // ═════════════════════════════════════════════════════════

    _mount() {
        if (this._mounted || this._remoteInfo) return;
        this._mounted = true;
        this._currentSteering = 0;
        this._currentSteerInput = 0;
        this._jumpCooldown = 0;
        this._rideAccelActive = false;
        this._rideAccelPrimed = false;
        this._wasOnAir = null;

        this.lockKeyboard();

        // Attach player — handles collision, camera, animations, network broadcast
        this._attachHandle = this._buildMountAttachment();

        const fwd = this.entity.forward;
        this._lastVehicleYaw = Math.atan2(-fwd.x, -fwd.z) * (180 / Math.PI);

        if (this._speedEl) this._speedEl.classList.add("visible");
    }

    _buildMountAttachment() {
        const animations = {};
        if (this.rideIdleUrl) {
            animations.Idle = this.rideIdleUrl;
            animations.Forward = this.rideIdleUrl;
        }

        const attachHandle = ArrivalSpace.attachPlayerToEntity(this.entity, {
            offset: { x: this.seatOffsetX, y: this.seatOffsetY, z: this.seatOffsetZ },
            animations,
            disableCollision: true,
            camera: {
                heightOffset: -0.4,
            },
            rate:  SkateboardModel.EXTRA_SYNC_RATE,
            meshEuler: () => ({ z: this._getRiderLeanAngle() }),
            meshRotationLag: () => this.riderLag,
            extra: () => ({
                steer: this._currentSteering,
                steerInput: this._currentSteerInput,
                wheelRot: this._vehicle?.getWheelInfo?.(0)?.get_m_rotation?.() || 0,
                riderLean: this._getRiderLeanAngle(),
                onAir: this._isOnAir(),
            }),
        });

        if (this.rideAccelUrl) {
            this._applyRideAccelAnimation();
        }
        if (this.rideIdleUrl) {
            this._applyRideIdleAnimation();
        }
        if (this.rideJumpUrl) {
            this._applyRideJumpAnimation();
        }

        return attachHandle;
    }

    _refreshMountAttachment() {
        if (!this._mounted || !this._attachHandle) return;

        this._attachHandle.detach();
        this._attachHandle = this._buildMountAttachment();
    }

    _dismount() {
        if (!this._mounted) return;
        this._mounted = false;
        this._dismountCooldown = 1.0;
        this._jumpCooldown = 0;
        this._rideAccelPrimed = false;
        this._wasOnAir = null;

        this.applyEngineForce(0);
        this.setBrake(0);
        this.setSteering(0);

        this.unlockKeyboard();

        this._setRideAccelActive(false);
        if (this._rideJumpTimer) {
            clearTimeout(this._rideJumpTimer);
            this._rideJumpTimer = null;
        }
        const playerMesh = ArrivalSpace.getPlayer()?.findByName("ReadyPlayerMe");
        if (playerMesh?.anim) {
            playerMesh.anim.setInteger("signatureNumber", -1);
        }
        ArrivalSpace.setPlayerAnimation("Signature1", null);
        ArrivalSpace.setPlayerAnimation("Signature2", null);

        if (this._speedEl) this._speedEl.classList.remove("visible");

        // Detach player — restores collision, camera, animations, broadcasts dismount
        if (this._attachHandle) {
            this._attachHandle.detach();
            this._attachHandle = null;
        }

        // Teleport player to exit position
        const player = ArrivalSpace.getPlayer();
        if (!player) return;

        const pos = this.entity.getPosition();
        const right = this.entity.right.clone().mulScalar(this.enterDistance + 0.2);
        const exitPos = pos.clone().add(right);
        exitPos.y += 0.2;

        if (player.rigidbody) {
            player.rigidbody.teleport(exitPos);
        } else {
            player.setPosition(exitPos);
        }

        this._destroyVehicle();
        this._createVehicle();
    }

    // ═════════════════════════════════════════════════════════
    //  PROXIMITY CHECK
    // ═════════════════════════════════════════════════════════

    _checkProximity() {
        if (this._dismountCooldown > 0) return;
        if (this._remoteInfo) return;

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

        if (kb.wasPressed(pc.KEY_SPACE)) {
            this.jump();
        }

        // Speed
        const speed = this.entity.rigidbody.linearVelocity.length();
        this._currentSpeed = speed;
        if (this._speedEl) this._speedEl.textContent = `Skateboard`;

        // Steering (decays with speed)
        const steerLimit = pc.math.lerp(this.maxSteering, this.minSteering,
            pc.math.clamp(speed / this.steeringFalloffSpeed, 0, 1));
        let targetSteerInput = 0;
        if (kb.isPressed(pc.KEY_A) || kb.isPressed(pc.KEY_LEFT))  targetSteerInput = 1;
        if (kb.isPressed(pc.KEY_D) || kb.isPressed(pc.KEY_RIGHT)) targetSteerInput = -1;
        // Mobile stick steering (analog)
        if (Math.abs(stick.x) > 0.05) targetSteerInput = -stick.x;
        this._currentSteerInput = pc.math.lerp(this._currentSteerInput, targetSteerInput, dt * this.steeringSpeed);
        const targetSteering = targetSteerInput * steerLimit;
        this._currentSteering = pc.math.lerp(this._currentSteering, targetSteering, dt * this.steeringSpeed);
        this.setSteering(this._currentSteering);
        this._applyChassisModelTransform();

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
        this.applyEngineForce(engineForce);
        this.setBrake(brakeForce);

        this._setRideAccelActive(!!throttle);
    }

    // ═════════════════════════════════════════════════════════
    //  FRAME UPDATES
    // ═════════════════════════════════════════════════════════

    update(dt) {
        if (this._dismountCooldown > 0) this._dismountCooldown -= dt;
        if (this._jumpCooldown > 0) this._jumpCooldown -= dt;

        // Remote mode: someone else is driving (doesn't need _vehicle)
        if (this._remoteInfo) {
            this._updateRemote(dt);
            return;
        }

        if (!this._vehicle) {
            this._currentSpeed = 0;
            this._remoteOnAir = false;
            this._updateRollingSound();
            return;
        }

        // Reset if fallen off the world
        if (this.entity.getPosition().y < -100) {
            this._resetToSpawn();
        }

        // Flip upright if tipped on its side
        const up = this.entity.up;
        if (up.y < 0.2) {
            if (this._mounted) {
                this._dismount();
                return;
            }
            const pos = this.entity.getPosition();
            const fwd = this.entity.forward;
            const yaw = Math.atan2(-fwd.x, -fwd.z) * (180 / Math.PI);
            this.entity.rigidbody.teleport(pos.x, pos.y + 0.1, pos.z, 0, yaw, 0);
            //this.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
            //this.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
        }

        this._currentSpeed = this.entity.rigidbody ? this.entity.rigidbody.linearVelocity.length() : 0;
        this._updateRollingSound();

        if (this._mounted) {
            this._handleInput(dt);
            this._procOnAirState();
        } else {
            this._checkProximity();
            this.applyEngineForce(0);
            this.setBrake(this.idleBrake);
            this._setRideAccelActive(false);
            this._currentSteerInput = pc.math.lerp(this._currentSteerInput, 0, dt * this.steeringSpeed);
            this._applyChassisModelTransform();
            this._wasOnAir = null;
        }
    }

    postUpdate() {
        // Remote mode: wheels already placed in update()
        if (this._remoteInfo) {
            this._drawWheelDebug();
            return;
        }

        if (!this._vehicle) return;

        // Sync wheel visuals (after physics step)
        const n = this._vehicle.getNumWheels();
        for (let i = 0; i < n; i++) {
            this._vehicle.updateWheelTransform(i, true);
            const tm = this._vehicle.getWheelTransformWS(i);
            const p = tm.getOrigin();
            const q = tm.getRotation();
            const we = this._wheelEntities[i];
            const pivot = this._wheelPivotEntities[i];
            const visualOffset = this._getWheelVisualOffset(i);
            if (we) {
                we.setPosition(
                    p.x() + visualOffset.x,
                    p.y() + visualOffset.y,
                    p.z() + visualOffset.z,
                );
            }
            if (pivot) {
                pivot.setRotation(q.x(), q.y(), q.z(), q.w());
            }
        }

        this._drawWheelDebug();

        if (!this._mounted) return;

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

    jump() {
        if (!this._mounted || !this.entity.rigidbody || this._jumpCooldown > 0) return;
        const jumpDir = this.entity.up.clone().normalize().mulScalar(this.jumpImpulse);
        this.entity.rigidbody.applyImpulse(jumpDir.x, jumpDir.y, jumpDir.z);
        this._jumpCooldown = 0.35;
        this._playRideJumpAnimation();
    }

    // ═════════════════════════════════════════════════════════
    //  PROPERTY CHANGES
    // ═════════════════════════════════════════════════════════

    onPropertyChanged(name) {
        if (name === "rollingSoundUrl" || name === "rollingSoundMinPitch" || name === "rollingSoundMinPitchSpeed" || name === "rollingSoundPitch" || name === "rollingSoundPitchSpeed") {
            this._stopRollingSound();
            this._updateRollingSound();
            return;
        }
        if (name === "rollingSoundVolume" || name === "rollingSoundMinSpeed" || name === "rollingSoundMaxSpeed") {
            this._updateRollingSound();
            return;
        }
        if (name === "rideIdleUrl") {
            if (this._mounted) {
                this._applyRideIdleAnimation();
            }
            return;
        }
        if (name === "rideAccelUrl" || name === "rideAccelInPlaceY" || name === "rideAccelInPlaceZ") {
            this._rideAccelPrimed = false;
            if (this._mounted) {
                this._applyRideAccelAnimation();
                this._applyRideIdleAnimation();
                this._applyRideJumpAnimation();
            }
            if (!this.rideAccelUrl) {
                ArrivalSpace.setPlayerAnimation("Signature1", null);
                this._setRideAccelActive(false);
            }
            return;
        }
        if (name === "rideJumpUrl") {
            if (this._mounted) {
                this._applyRideJumpAnimation();
            }
            if (!this.rideJumpUrl) {
                ArrivalSpace.setPlayerAnimation("Signature2", null);
            }
            return;
        }
        if (name === "rideJumpDuration") {
            return;
        }
        if (name === "riderLean" || name === "riderLag") {
            return;
        }
        if (name === "seatOffsetX" || name === "seatOffsetY" || name === "seatOffsetZ") {
            this._refreshMountAttachment();
            return;
        }
        if (name === "chassisModelUrl") {
            this._loadChassisModel();
            return;
        }
        if (name === "chassisScale" || name === "chassisOffsetY" || name === "chassisRotationX" || name === "chassisRotationY" || name === "chassisRotationZ" || name === "boardLean") {
            this._applyChassisModelTransform();
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
        if (name === "wheelOffsetX") {
            this._applyWheelModelOffsets();
            return;
        }
        // Collision shape changed — collisionHeight is intentionally unused for the capsule for now
        if (name === "collisionWidth" || name === "collisionHeight" || name === "collisionLength" || name === "collisionY" || name === "collisionFrontOffset") {
            const chassisShape = this._shapeEntities[0];
            if (chassisShape?.collision) {
                chassisShape.collision.radius = this.collisionWidth;
                chassisShape.collision.height = this.collisionLength * 2;
                chassisShape.collision.axis = 2;
                chassisShape.setLocalPosition(0, this.collisionY, this.collisionFrontOffset);
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

        if (this._unsubAttach) {
            this._unsubAttach();
            this._unsubAttach = null;
        }

        this._stopRollingSound();
        this._destroyVehicle();

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

        if (this.entity.rigidbody) this.entity.removeComponent("rigidbody");
        if (this.entity.collision) this.entity.removeComponent("collision");
    }
}




