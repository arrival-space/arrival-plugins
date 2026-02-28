/**
 * Vehicle Physics
 *
 * Spawns a rigid-body vehicle with 4 wheels using Ammo.js
 * btRaycastVehicle. Walk up to it to auto-mount, then drive
 * with WASD. Press Esc to dismount. On mobile, the left
 * virtual stick provides analog steering and throttle, with
 * a tap-to-exit button.
 */
export class VehiclePhysics extends ArrivalScript {
    static scriptName = "Vehicle Physics";

    // ── Chassis ──────────────────────────────────────────────
    chassisMass = 200;
    chassisColor = "#0061ff";

    // ── Wheels ───────────────────────────────────────────────
    wheelRadius = 0.20;
    wheelWidth = 0.14;
    wheelColor = "#222222";

    // ── Suspension ───────────────────────────────────────────
    suspensionStiffness = 18;
    suspensionDamping = 1;
    suspensionCompression = 2.0;
    suspensionRestLength = 0.45;

    // ── Grip ─────────────────────────────────────────────────
    frictionSlip = 3;
    rollInfluence = 0.7;
    linearDamping = 0.1;
    angularDamping = 0.1;
    physicsHz = 120;
    physicsSubSteps = 30;

    // ── Motor ────────────────────────────────────────────────
    maxEngineForce = 300;
    maxBrakingForce = 4;
    idleBrake = 0.4;
    maxSteering = 0.4;
    minSteering = 0.02;
    steeringFalloffSpeed = 12;
    steeringSpeed = 3;

    // ── Mounting ─────────────────────────────────────────────
    enterDistance = 1;
    seatOffsetY = 0;
    seatOffsetZ = -0.21;
    rideIdleUrl = "driving.glb";

    static properties = {
        chassisMass:           { title: "Chassis Mass",           min: 100,  max: 5000 },
        chassisColor:          { title: "Chassis Color" },
        wheelRadius:           { title: "Wheel Radius",           min: 0.1,  max: 1 },
        wheelWidth:            { title: "Wheel Width",            min: 0.05, max: 0.5 },
        wheelColor:            { title: "Wheel Color" },
        suspensionStiffness:   { title: "Suspension Stiffness",   min: 1,    max: 100 },
        suspensionDamping:     { title: "Suspension Damping",     min: 0.1,  max: 10 },
        suspensionCompression: { title: "Suspension Compression", min: 0.1,  max: 10 },
        suspensionRestLength:  { title: "Suspension Rest",        min: 0.05, max: 1 },
        frictionSlip:          { title: "Friction Slip",          min: 1,    max: 2000 },
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
        enterDistance:         { title: "Enter Distance",         min: 1,    max: 10 },
        seatOffsetY:           { title: "Seat Height",            min: 0,    max: 3,   step: 0.05 },
        seatOffsetZ:           { title: "Seat Forward",           min: -1,   max: 1,   step: 0.05 },
        rideIdleUrl:           { title: "Ride Idle Animation" },
    };

    // ── Private state ────────────────────────────────────────
    _vehicle = null;
    _raycaster = null;
    _tuning = null;
    _wheelEntities = [];
    _bodyVisuals = [];
    _chassisMat = null;
    _wheelMat = null;
    _shapeEntities = [];
    _mounted = false;
    _currentSteering = 0;
    _dismountCooldown = 0;
    _hintEl = null;

    // Go-kart chassis (flat floor plate, raised for ground clearance)
    static CHASSIS_HE = [0.38, 0.05, 0.65];
    static CHASSIS_POS = [0, 0.30, 0];

    // Seat back (small upright behind driver)
    static SEAT_HE = [0.18, 0.14, 0.04];
    static SEAT_POS = [0, 0.49, -0.35];

    // Wheel connection points (Y raised so raycast reaches further down)
    static WHEELS = [
        { x:  0.44, y: 0.42, z:  0.50, front: true  },  // FL
        { x: -0.44, y: 0.42, z:  0.50, front: true  },  // FR
        { x:  0.44, y: 0.42, z: -0.45, front: false },  // RL
        { x: -0.44, y: 0.42, z: -0.45, front: false },  // RR
    ];

    async initialize() {
        if (typeof Ammo === "undefined") {
            console.error("[VehiclePhysics] Ammo.js not available");
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
        this._buildVisuals();
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
            halfExtents: new pc.Vec3(...VehiclePhysics.CHASSIS_HE),
        });
        chassis.setLocalPosition(...VehiclePhysics.CHASSIS_POS);
        this.entity.addChild(chassis);
        this._shapeEntities.push(chassis);

        const seat = new pc.Entity("SeatShape");
        seat.addComponent("collision", {
            type: "box",
            halfExtents: new pc.Vec3(...VehiclePhysics.SEAT_HE),
        });
        seat.setLocalPosition(...VehiclePhysics.SEAT_POS);
        this.entity.addChild(seat);
        this._shapeEntities.push(seat);

        this.entity.addComponent("rigidbody", {
            type: pc.BODYTYPE_DYNAMIC,
            mass: this.chassisMass,
            friction: 0.3,
            restitution: 0.1,
        });
    }

    // ═════════════════════════════════════════════════════════
    //  VISUALS
    // ═════════════════════════════════════════════════════════

    _buildVisuals() {
        this._chassisMat = ArrivalSpace.createMaterial({
            diffuse: this._hex(this.chassisColor),
            metalness: 0.3,
            gloss: 0.7,
        });
        const frameMat = ArrivalSpace.createMaterial({
            diffuse: { r: 0.12, g: 0.12, b: 0.12 },
            metalness: 0.6,
            gloss: 0.5,
        });
        this._wheelMat = ArrivalSpace.createMaterial({
            diffuse: this._hex(this.wheelColor),
            metalness: 0.1,
            gloss: 0.4,
        });

        const add = (name, w, h, d, pos, mat, rot) => {
            const e = this._makeBox(name, w, h, d, pos, mat);
            if (rot) e.setLocalEulerAngles(rot[0], rot[1], rot[2]);
            this.entity.addChild(e);
            this._bodyVisuals.push(e);
        };

        // Floor plate
        const ch = VehiclePhysics.CHASSIS_HE;
        add("Floor", ch[0] * 2, ch[1] * 2, ch[2] * 2, VehiclePhysics.CHASSIS_POS, frameMat);

        // Nose / front bumper
        add("Nose", 0.60, 0.10, 0.18, [0, 0.32, 0.57], this._chassisMat);

        // Rear bumper
        add("Rear", 0.60, 0.10, 0.10, [0, 0.32, -0.61], this._chassisMat);

        // Side pods (left + right)
        add("SideL",  0.08, 0.08, 0.70, [ 0.35, 0.32, 0.0], this._chassisMat);
        add("SideR",  0.08, 0.08, 0.70, [-0.35, 0.32, 0.0], this._chassisMat);

        // Seat back (angled 15° rearward)
        const se = VehiclePhysics.SEAT_HE;
        add("Seat", se[0] * 2, se[1] * 2, se[2] * 2, VehiclePhysics.SEAT_POS, frameMat, [-15, 0, 0]);

        // Steering column (angled 20° rearward, moved 10cm back)
        add("SteerCol", 0.03, 0.46, 0.03, [0, 0.47, 0.13], frameMat, [-20, 0, 0]);

        // Wheels
        for (let i = 0; i < 4; i++) {
            const container = new pc.Entity(`Wheel_${i}`);
            const mesh = new pc.Entity(`WheelMesh_${i}`);
            mesh.addComponent("render", { type: "cylinder", castShadows: true });
            mesh.render.material = this._wheelMat;
            mesh.setLocalEulerAngles(0, 0, 90);
            mesh.setLocalScale(
                this.wheelRadius * 2,
                this.wheelWidth,
                this.wheelRadius * 2,
            );
            container.addChild(mesh);
            this.app.root.addChild(container);
            this._wheelEntities.push(container);
        }
    }

    _makeBox(name, w, h, d, pos, mat) {
        const e = new pc.Entity(name);
        e.addComponent("render", { type: "box", castShadows: true });
        e.render.material = mat;
        e.setLocalPosition(pos[0], pos[1], pos[2]);
        e.setLocalScale(w, h, d);
        return e;
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

        for (const def of VehiclePhysics.WHEELS) {
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
            info.set_m_frictionSlip(this.frictionSlip);
            info.set_m_rollInfluence(this.rollInfluence);
            Ammo.destroy(cp);
        }

        Ammo.destroy(dir);
        Ammo.destroy(axle);

        body.setActivationState(4); // DISABLE_DEACTIVATION
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
        const seatLocal = new pc.Vec3(0, this.seatOffsetY, this.seatOffsetZ);
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
        if (this._speedEl) this._speedEl.textContent = `${speed.toFixed(1)} m/s`;

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
        if (this.entity.getPosition().y < -10) {
            this._resetToSpawn();
        }


        // Flip upright if tipped on its side
        const up = this.entity.up;
        if (up.y < 0.17) {
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
        if (name === "rideIdleUrl") {
            if (this._mounted) {
                ArrivalSpace.setPlayerAnimation("Idle", this.rideIdleUrl || null);
                ArrivalSpace.setPlayerAnimation("Forward", this.rideIdleUrl || null);
            }
            return;
        }
        if (name === "chassisColor" && this._chassisMat) {
            const c = this._hex(this.chassisColor);
            this._chassisMat.diffuse.set(c.r, c.g, c.b);
            this._chassisMat.update();
            return;
        }
        if (name === "wheelColor" && this._wheelMat) {
            const c = this._hex(this.wheelColor);
            this._wheelMat.diffuse.set(c.r, c.g, c.b);
            this._wheelMat.update();
            return;
        }
        if ((name === "wheelRadius" || name === "wheelWidth") && this._wheelEntities.length) {
            for (const container of this._wheelEntities) {
                const mesh = container.children[0];
                if (mesh) {
                    mesh.setLocalScale(
                        this.wheelRadius * 2,
                        this.wheelWidth,
                        this.wheelRadius * 2,
                    );
                }
            }
            return;
        }
        if (this._vehicle) {
            const n = this._vehicle.getNumWheels();
            for (let i = 0; i < n; i++) {
                const info = this._vehicle.getWheelInfo(i);
                info.set_m_suspensionStiffness(this.suspensionStiffness);
                info.set_m_wheelsDampingRelaxation(this.suspensionDamping);
                info.set_m_wheelsDampingCompression(this.suspensionCompression);
                info.set_m_frictionSlip(this.frictionSlip);
                info.set_m_rollInfluence(this.rollInfluence);
            }
        }
    }

    // ═════════════════════════════════════════════════════════
    //  HELPERS
    // ═════════════════════════════════════════════════════════

    _hex(hex) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!m) return { r: 0.2, g: 0.4, b: 0.8 };
        return {
            r: parseInt(m[1], 16) / 255,
            g: parseInt(m[2], 16) / 255,
            b: parseInt(m[3], 16) / 255,
        };
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

        // Wheels are parented to app.root, not this.entity — must destroy manually
        for (const w of this._wheelEntities) {
            if (w && !w._destroyed) w.destroy();
        }
        this._wheelEntities = [];

        for (const s of this._shapeEntities) {
            if (s && !s._destroyed) s.destroy();
        }
        this._shapeEntities = [];

        for (const v of this._bodyVisuals) {
            if (v && !v._destroyed) v.destroy();
        }
        this._bodyVisuals = [];

        if (this._chassisMat) { this._chassisMat.destroy(); this._chassisMat = null; }
        if (this._wheelMat)   { this._wheelMat.destroy();   this._wheelMat = null; }

        if (this.entity.rigidbody) this.entity.removeComponent("rigidbody");
        if (this.entity.collision) this.entity.removeComponent("collision");
    }
}
