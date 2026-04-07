/**
 * Ragdoll Physics
 *
 * Procedurally creates physics bodies and constraints from the player
 * avatar skeleton. When activated the animation is paused and the
 * avatar collapses under gravity like a lifeless body.
 *
 * Supports RPM (short), Mixamo-prefixed, and VRM (J_Bip) bone names.
 */
export class RagdollPhysics extends ArrivalScript {
    static scriptName = "Ragdoll Physics";

    ragdollEnabled = true;
    activateKey = "r";
    wakeOnMove = false;
    bodyMass = 1;
    limbMass = 2;
    groundFriction = 0.75;
    linearDamping = 0.75;
    angularDamping = 0.75;
    debugKinematic = false;
    debugGround = false;

    static properties = {
        ragdollEnabled: { title: "Ragdoll Enabled" },
        activateKey: { title: "Activate Key" },
        wakeOnMove: { title: "Wake On Move" },
        bodyMass: { title: "Torso Mass", min: 1, max: 50, step: 0.5 },
        limbMass: { title: "Limb Mass", min: 0.5, max: 20, step: 0.5 },
        groundFriction: { title: "Friction", min: 0, max: 2, step: 0.05 },
        linearDamping: { title: "Linear Damping", min: 0, max: 1, step: 0.05 },
        angularDamping: { title: "Angular Damping", min: 0, max: 1, step: 0.05 },
        debugKinematic: { title: "Debug Kinematic" },
        debugGround: { title: "Debug Ground Plane" },
    };

    // ------------------------------------------------------------------ state
    _active = false;
    _bodies = [];       // { entity, bone, constraint? }
    _constraints = [];  // Ammo constraint refs
    _savedPoses = [];   // { bone, pos, rot }
    _animWasPlaying = false;
    _playerMesh = null;
    _groundEntity = null;

    // --------------------------------------------------- bone naming variants
    static BONE_PREFIXES = ["", "mixamorig:", "mixamorig", "J_Bip_C_", "J_Bip_L_", "J_Bip_R_"];

    static BONE_ALIASES = {
        Hips:          ["Hips", "mixamorig:Hips", "mixamorigHips", "J_Bip_C_Hips"],
        Spine:         ["Spine", "mixamorig:Spine", "mixamorigSpine", "J_Bip_C_Spine"],
        Head:          ["Head", "mixamorig:Head", "mixamorigHead", "J_Bip_C_Head"],
        LeftArm:       ["LeftArm", "mixamorig:LeftArm", "mixamorigLeftArm", "J_Bip_L_UpperArm"],
        LeftForeArm:   ["LeftForeArm", "mixamorig:LeftForeArm", "mixamorigLeftForeArm", "J_Bip_L_LowerArm"],
        LeftHand:      ["LeftHand", "mixamorig:LeftHand", "mixamorigLeftHand", "J_Bip_L_Hand"],
        RightArm:      ["RightArm", "mixamorig:RightArm", "mixamorigRightArm", "J_Bip_R_UpperArm"],
        RightForeArm:  ["RightForeArm", "mixamorig:RightForeArm", "mixamorigRightForeArm", "J_Bip_R_LowerArm"],
        RightHand:     ["RightHand", "mixamorig:RightHand", "mixamorigRightHand", "J_Bip_R_Hand"],
        LeftMiddle1:   ["LeftHandMiddle2", "mixamorig:LeftHandMiddle2", "mixamorigLeftHandMiddle2", "J_Bip_L_Mid2"],
        RightMiddle1:  ["RightHandMiddle2", "mixamorig:RightHandMiddle2", "mixamorigRightHandMiddle2", "J_Bip_R_Mid2"],
        LeftUpLeg:     ["LeftUpLeg", "mixamorig:LeftUpLeg", "mixamorigLeftUpLeg", "J_Bip_L_UpperLeg"],
        LeftLeg:       ["LeftLeg", "mixamorig:LeftLeg", "mixamorigLeftLeg", "J_Bip_L_LowerLeg"],
        LeftFoot:      ["LeftFoot", "mixamorig:LeftFoot", "mixamorigLeftFoot", "J_Bip_L_Foot"],
        RightUpLeg:    ["RightUpLeg", "mixamorig:RightUpLeg", "mixamorigRightUpLeg", "J_Bip_R_UpperLeg"],
        RightLeg:      ["RightLeg", "mixamorig:RightLeg", "mixamorigRightLeg", "J_Bip_R_LowerLeg"],
        Neck:          ["Neck", "mixamorig:Neck", "mixamorigNeck", "J_Bip_C_Neck"],
        HeadTop:       ["HeadTop_End", "mixamorig:HeadTop_End", "mixamorigHeadTop_End", "J_Bip_C_HeadTop"],
        RightFoot:     ["RightFoot", "mixamorig:RightFoot", "mixamorigRightFoot", "J_Bip_R_Foot"],
        LeftToeBase:   ["LeftToeBase", "mixamorig:LeftToeBase", "mixamorigLeftToeBase", "J_Bip_L_ToeBase"],
        RightToeBase:  ["RightToeBase", "mixamorig:RightToeBase", "mixamorigRightToeBase", "J_Bip_R_ToeBase"],
    };

    // ----------------------------------------- body segment definitions
    // Each segment: [canonical bone start, canonical bone end, mass multiplier, shape]
    // bone end is used to compute length; shape is "capsule" or "sphere"
    static SEGMENTS = [
        { name: "Body",           boneStart: "Hips",        boneEnd: "Head",        massMul: 1.0,  shape: "capsule", radius: 0.09 },
        { name: "Head",           boneStart: "Head",        boneEnd: "HeadTop",     massMul: 0.5,  shape: "capsule", radius: 0.08 },
        { name: "Left Arm",       boneStart: "LeftArm",     boneEnd: "LeftForeArm", massMul: 0.3,  shape: "capsule", radius: 0.04 },
        { name: "Left ForeArm",   boneStart: "LeftForeArm", boneEnd: "LeftHand",    massMul: 0.2,  shape: "capsule", radius: 0.03 },
        { name: "Left Hand",      boneStart: "LeftHand",    boneEnd: "LeftMiddle1", massMul: 0.1,  shape: "capsule", radius: 0.03 },
        { name: "Right Arm",      boneStart: "RightArm",    boneEnd: "RightForeArm",massMul: 0.3,  shape: "capsule", radius: 0.04 },
        { name: "Right ForeArm",  boneStart: "RightForeArm",boneEnd: "RightHand",   massMul: 0.2,  shape: "capsule", radius: 0.03 },
        { name: "Right Hand",     boneStart: "RightHand",   boneEnd: "RightMiddle1",massMul: 0.1,  shape: "capsule", radius: 0.03 },
        { name: "Left Upper Leg", boneStart: "LeftUpLeg",   boneEnd: "LeftLeg",     massMul: 0.4,  shape: "capsule", radius: 0.05 },
        { name: "Left Lower Leg", boneStart: "LeftLeg",     boneEnd: "LeftFoot",    massMul: 0.3,  shape: "capsule", radius: 0.04 },
        { name: "Left Foot",      boneStart: "LeftFoot",    boneEnd: "LeftToeBase", massMul: 0.1,  shape: "capsule", radius: 0.03 },
        { name: "Right Upper Leg",boneStart: "RightUpLeg",  boneEnd: "RightLeg",    massMul: 0.4,  shape: "capsule", radius: 0.05 },
        { name: "Right Lower Leg",boneStart: "RightLeg",    boneEnd: "RightFoot",   massMul: 0.3,  shape: "capsule", radius: 0.04 },
        { name: "Right Foot",     boneStart: "RightFoot",   boneEnd: "RightToeBase",massMul: 0.1,  shape: "capsule", radius: 0.03 },
    ];

    // ----------------------------------------- constraint definitions
    // type: "cone" (ConeTwist) or "hinge"
    static CONSTRAINTS = [
        // torso
        { a: "Body",            b: "Head",            type: "cone",  limits: [30, 30, 20] },
        // arms
        { a: "Body",            b: "Left Arm",        type: "cone",  limits: [95, 95, 30] },
        { a: "Left Arm",        b: "Left ForeArm",    type: "hinge", limits: [0, 130] },
        { a: "Left ForeArm",    b: "Left Hand",       type: "hinge", limits: [-30, 30] },
        { a: "Body",            b: "Right Arm",       type: "cone",  limits: [95, 95, 30] },
        { a: "Right Arm",       b: "Right ForeArm",   type: "hinge", limits: [0, 130] },
        { a: "Right ForeArm",   b: "Right Hand",      type: "hinge", limits: [-30, 30] },
        // legs
        { a: "Body",            b: "Left Upper Leg",  type: "cone",  limits: [60, 60, 10] },
        { a: "Left Upper Leg",  b: "Left Lower Leg",  type: "hinge", limits: [0, 130] },        // knee
        { a: "Left Lower Leg",  b: "Left Foot",       type: "hinge", limits: [-80, 20] },       // ankle
        { a: "Body",            b: "Right Upper Leg", type: "cone",  limits: [60, 60, 10] },     // 
        { a: "Right Upper Leg", b: "Right Lower Leg", type: "hinge", limits: [0, 130] },        // knee
        { a: "Right Lower Leg", b: "Right Foot",      type: "hinge", limits: [-80, 20] },       // ankle
    ];

    // ================================================================ lifecycle
    initialize() {
        this._onKeyDown = (e) => {
            const key = this.activateKey && pc[`KEY_${this.activateKey.toUpperCase()}`];
            if (key && e.key === key) {
                if (this._active) this.deactivate();
                else this.activate();
            }
        };
        this.app.keyboard.on(pc.EVENT_KEYDOWN, this._onKeyDown, this);
    }

    onPropertyChanged(name) {
        if (name === "ragdollEnabled") {
            if (this.ragdollEnabled && !this._active) this.activate();
            else if (!this.ragdollEnabled && this._active) this.deactivate();
        }
    }

    update(dt) {
        if (!this._active || !this.wakeOnMove) return;
        // Wake the ragdoll when the user tries to move forward.
        const fwd = this.getMoveInput
            ? this.getMoveInput().forward > 0.1
            : this.app.keyboard.isPressed(pc.KEY_W); // TODO: remove fallback once getMoveInput ships
        if (fwd) this.deactivate();
    }

    postUpdate(dt) {
        if (!this._active) return;
        if (this._animComponent) this._animComponent.enabled = false;
        this._writeBonePoses();
    }

    destroy() {
        if (this._active) this.deactivate();
        if (this._onKeyDown) {
            this.app.keyboard.off(pc.EVENT_KEYDOWN, this._onKeyDown, this);
        }
    }

    // ================================================================ public API
    activate() {
        const player = ArrivalSpace.getPlayer();
        if (!player) { console.warn("[Ragdoll] No player found"); return; }

        const meshRoot = player.findByName("ReadyPlayerMe");
        if (!meshRoot) { console.warn("[Ragdoll] No avatar mesh found"); return; }

        // Find the skeleton root — the render root inside glbEntity
        const glb = meshRoot.script?.glbEntity;
        const skeleton = glb?.renderRootEntity || meshRoot;
        this._playerMesh = meshRoot;

        // Resolve bones
        const bones = this._resolveBones(skeleton);
        if (!bones) { console.warn("[Ragdoll] Could not resolve bones"); return; }

        // Capture player velocity before disabling rigidbody
        const playerVelocity = player.rigidbody?.linearVelocity?.clone() || pc.Vec3.ZERO;

        // Disable player collision so ragdoll bodies don't collide with it
        this._player = player;
        this._playerCollisions = [];
        const disableCollision = (e) => {
            if (e.collision) { e.collision.enabled = false; this._playerCollisions.push(e.collision); }
            if (e.rigidbody) { e.rigidbody.enabled = false; this._playerCollisions.push(e.rigidbody); }
        };
        disableCollision(player);
        if (meshRoot !== player) disableCollision(meshRoot);

        // Disable character controller (ground raycast, movement, repositioning)
        this._disabledScripts = [];
        const ccScript = player.script?.characterController;
        if (ccScript && ccScript.enabled) {
            ccScript.enabled = false;
            this._disabledScripts.push(ccScript);
        }

        // Pause animation
        this._animComponent = this._findAnimComponent(meshRoot);
        if (this._animComponent) {
            this._animWasPlaying = this._animComponent.playing;
            this._animComponent.enabled = false;
        }

        // Snapshot local poses (animation works in local space)
        this._savedPoses = [];
        for (const [canonical, boneEntity] of Object.entries(bones)) {
            this._savedPoses.push({
                bone: boneEntity,
                pos: boneEntity.getLocalPosition().clone(),
                rot: boneEntity.getLocalRotation().clone(),
            });
        }

        // Log bone hierarchy for debugging
        this._logBoneStructure(bones);

        // Create physics bodies
        this._createBodies(bones);

        // Apply player velocity to all ragdoll bodies
        for (const entry of this._bodies) {
            if (entry.entity.rigidbody) {
                entry.entity.rigidbody.linearVelocity = playerVelocity;
            }
        }

        // Log body placement
        this._logBodyPlacement();

        // Create constraints
        this._createConstraints();

        if (this.debugGround) this._createGround(player);

        this._active = true;
        this.ragdollEnabled = true;
        console.log("[Ragdoll] Activated");
    }

    deactivate() {
        // Get foot position before removing bodies (to reposition player)
        const footBody = this._bodyMap?.["Right Foot"];
        const footPos = footBody && !footBody._destroyed
            ? footBody.getPosition().clone() : null;

        this._removeConstraints();
        this._removeBodies();
        this._removeGround();
        // Restore local bone poses
        for (const saved of this._savedPoses) {
            if (saved.bone && !saved.bone._destroyed) {
                saved.bone.setLocalPosition(saved.pos);
                saved.bone.setLocalRotation(saved.rot);
            }
        }
        this._savedPoses = [];

        // Reposition player at ragdoll foot position
        if (this._player && !this._player._destroyed && footPos) {
            this._player.setPosition(footPos.x, footPos.y, footPos.z);
        }

        // Re-enable player collision
        for (const comp of this._playerCollisions || []) {
            if (comp && !comp.entity?._destroyed) comp.enabled = true;
        }
        this._playerCollisions = [];

        // Re-enable player controller scripts
        for (const inst of this._disabledScripts || []) {
            if (inst && !inst.entity?._destroyed) inst.enabled = true;
        }
        this._disabledScripts = [];

        // Resume animation
        if (this._animComponent) {
            this._animComponent.enabled = true;
            this._animComponent = null;
        }
        this._playerMesh = null;
        this._player = null;

        this._active = false;
        this.ragdollEnabled = false;
        console.log("[Ragdoll] Deactivated");
    }

    // ================================================================ debug
    _logBoneStructure(bones) {
        console.log("[Ragdoll] === BONE STRUCTURE ===");
        for (const [canonical, bone] of Object.entries(bones)) {
            const pos = bone.getPosition();
            const rot = bone.getRotation();
            const euler = rot.getEulerAngles();
            const parent = bone.parent?.name || "(root)";
            console.log(
                `[Ragdoll] ${canonical.padEnd(14)} | name="${bone.name}" parent="${parent}" ` +
                `pos=(${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}) ` +
                `euler=(${euler.x.toFixed(1)}, ${euler.y.toFixed(1)}, ${euler.z.toFixed(1)})`
            );
        }
    }

    _logBodyPlacement() {
        console.log("[Ragdoll] === PHYSICS BODIES ===");
        for (const entry of this._bodies) {
            const ePos = entry.entity.getPosition();
            const eEuler = entry.entity.getRotation().getEulerAngles();
            const boneChild = entry.entity.findByName("Bone");
            const bPos = boneChild.getPosition();
            const bEuler = boneChild.getRotation().getEulerAngles();
            const bonePos = entry.bone.getPosition();
            const diff = new pc.Vec3().sub2(bPos, bonePos).length();
            console.log(
                `[Ragdoll] ${entry.name.padEnd(16)} | ` +
                `body=(${ePos.x.toFixed(3)}, ${ePos.y.toFixed(3)}, ${ePos.z.toFixed(3)}) ` +
                `euler=(${eEuler.x.toFixed(1)}, ${eEuler.y.toFixed(1)}, ${eEuler.z.toFixed(1)}) | ` +
                `BoneChild=(${bPos.x.toFixed(3)}, ${bPos.y.toFixed(3)}, ${bPos.z.toFixed(3)}) ` +
                `euler=(${bEuler.x.toFixed(1)}, ${bEuler.y.toFixed(1)}, ${bEuler.z.toFixed(1)}) | ` +
                `skelBone=(${bonePos.x.toFixed(3)}, ${bonePos.y.toFixed(3)}, ${bonePos.z.toFixed(3)}) ` +
                `posDiff=${diff.toFixed(4)}`
            );
        }
    }

    // ================================================================ bones
    _resolveBones(skeleton) {
        const resolved = {};
        for (const [canonical, aliases] of Object.entries(RagdollPhysics.BONE_ALIASES)) {
            let found = null;
            for (const alias of aliases) {
                found = skeleton.findByName(alias);
                if (found) break;
            }
            if (!found) {
                console.warn(`[Ragdoll] Missing bone: ${canonical}`);
                return null;
            }
            resolved[canonical] = found;
        }
        return resolved;
    }

    _findAnimComponent(root) {
        if (root.anim) return root.anim;
        // Search children (RPM usually has anim on the render root)
        const results = [];
        const visit = (e) => {
            if (e.anim) results.push(e.anim);
            for (const c of e.children) visit(c);
        };
        visit(root);
        return results[0] || null;
    }

    // ================================================================ body creation
    _createBodies(bones) {
        const bodyMap = {};

        for (const seg of RagdollPhysics.SEGMENTS) {
            const boneStart = bones[seg.boneStart];
            const boneEnd = seg.boneEnd ? bones[seg.boneEnd] : null;

            const startPos = boneStart.getPosition();
            const endPos = boneEnd ? boneEnd.getPosition() : null;

            // Compute midpoint and length
            let midpoint, halfHeight;
            if (endPos) {
                midpoint = new pc.Vec3().lerp(startPos, endPos, 0.5);
                halfHeight = startPos.distance(endPos) * 0.5;
            } else {
                // Terminal bones (head, hands, feet) — use a small offset
                midpoint = startPos.clone();
                halfHeight = seg.radius;
            }

            // Compute orientation: Y axis along bone direction
            let rotation = new pc.Quat();
            if (endPos) {
                let dir = new pc.Vec3().sub2(endPos, startPos);
                // For feet, flatten to horizontal so shoes sit flat
                if (seg.name === "Left Foot" || seg.name === "Right Foot") {
                    dir.y = 0;
                    midpoint.y = endPos.y; // use toe height, not ankle
                }
                dir.normalize();
                const up = new pc.Vec3(0, 1, 0);
                // If bone is nearly vertical, use a different up reference
                const upRef = Math.abs(dir.dot(up)) > 0.99
                    ? new pc.Vec3(1, 0, 0) : up;
                const mat = new pc.Mat4().setLookAt(pc.Vec3.ZERO, dir, upRef);
                rotation.setFromMat4(mat);
                // setLookAt gives -Z forward; we want Y-up capsule, so rotate 90° around X
                const fixup = new pc.Quat().setFromEulerAngles(90, 0, 0);
                rotation.mul(fixup);
            }

            const mass = seg.name === "Body" ? this.bodyMass * seg.massMul
                                              : this.limbMass * seg.massMul;

            // Create entity with collision + rigidbody
            const entity = new pc.Entity(seg.name);
            entity.tags.add("noCameraBlock");
            this.app.root.addChild(entity);
            entity.setPosition(midpoint);
            entity.setRotation(rotation);

            // Collision shape
            if (seg.shape === "capsule") {
                const isFoot = seg.name === "Left Foot" || seg.name === "Right Foot";
                const r = isFoot ? seg.radius * 1.5 : seg.radius;
                const h = isFoot ? Math.max(halfHeight * 4, r * 2.5) : Math.max(halfHeight * 2, r * 2.5);
                entity.addComponent("collision", {
                    type: "capsule",
                    radius: r,
                    height: h,
                });
            } else if (seg.shape === "sphere") {
                entity.addComponent("collision", {
                    type: "sphere",
                    radius: seg.radius,
                });
            } else if (seg.shape === "box") {
                // Shoe-shaped: long (Y along bone), narrow (X), flat (Z)
                const length = Math.max(halfHeight, 0.06);
                entity.addComponent("collision", {
                    type: "box",
                    halfExtents: new pc.Vec3(0.04, length * 2, 0.03),
                });
            }

            // Rigidbody
            const angDamp = this.angularDamping;
            entity.addComponent("rigidbody", {
                type: this.debugKinematic ? pc.BODYTYPE_KINEMATIC : pc.BODYTYPE_DYNAMIC,
                mass: mass,
                friction: this.groundFriction,
                restitution: 0.1,
                angularDamping: angDamp,
                linearDamping: this.linearDamping,
            });

            // "Bone" child placed at the skeleton bone's world transform.
            // As the physics body moves, this child moves with it, and we
            // copy its world transform back onto the skeleton bone each frame.
            const boneChild = new pc.Entity("Bone");
            entity.addChild(boneChild);
            boneChild.setPosition(startPos);
            boneChild.setRotation(boneStart.getRotation());

            bodyMap[seg.name] = entity;
            this._bodies.push({
                entity: entity,
                bone: boneStart,
                boneEnd: boneEnd,
                name: seg.name,
            });
        }

        this._bodyMap = bodyMap;
    }

    // ================================================================ constraints
    //
    // Each constraint frame is built so its axes mean what Bullet expects:
    //   - btHingeConstraint(2-frame ctor) rotates around the frame's Z axis,
    //     so we orient the frame so Z = anatomical hinge axis.
    //   - btConeTwistConstraint twists around the frame's X axis, so we
    //     orient the frame so X = bone direction (the limb's long axis).
    //
    // Both axes are derived purely from the rig — the bone hierarchy at
    // activation time. We never look at character facing, world up, or any
    // other external reference: the rigger already encoded the joint's
    // orientation in the bone transforms.
    _createConstraints() {
        const world = this.app.systems.rigidbody.dynamicsWorld;
        if (!world) { console.warn("[Ragdoll] No dynamics world"); return; }

        // Rig-only anatomical axes, derived purely from bone positions.
        // None of this depends on getPlayerForward() or any external state.
        //
        //   bodyLateral = LEFT hip → RIGHT hip
        //   bodyUp      = Hips → Head
        //   bodyForward = bodyLateral × bodyUp   (right-handed)
        //
        // These give us a consistent body frame regardless of which way
        // the avatar is facing in the world or how the rig was exported.
        // - Knees / ankles fold around bodyLateral (sagittal-plane fold)
        // - Elbows / wrists fold around an axis derived via bodyForward
        //   (their fold direction is "toward the chest" = +bodyForward)
        // - Shoulders / hips / neck use bodyUp as a natural rest direction
        //   for the cone, decoupling them from activation pose.
        const bodyLateral = new pc.Vec3(1, 0, 0);
        const leftHipBody = this._bodies.find(b => b.name === "Left Upper Leg");
        const rightHipBody = this._bodies.find(b => b.name === "Right Upper Leg");
        if (leftHipBody && rightHipBody) {
            const v = new pc.Vec3().sub2(
                rightHipBody.bone.getPosition(),
                leftHipBody.bone.getPosition()
            );
            if (v.lengthSq() > 1e-8) bodyLateral.copy(v).normalize();
        }

        const bodyUp = new pc.Vec3(0, 1, 0);
        const torsoBody = this._bodies.find(b => b.name === "Body");
        const headBody = this._bodies.find(b => b.name === "Head");
        if (torsoBody?.bone && headBody?.bone) {
            const v = new pc.Vec3().sub2(
                headBody.bone.getPosition(),
                torsoBody.bone.getPosition()
            );
            if (v.lengthSq() > 1e-8) bodyUp.copy(v).normalize();
        }

        const bodyForward = new pc.Vec3().cross(bodyLateral, bodyUp);
        if (bodyForward.lengthSq() < 1e-8) bodyForward.set(0, 0, 1);
        bodyForward.normalize();

        // -bodyUp = "limbs hanging down" rest direction for shoulders/hips.
        const bodyDown = new pc.Vec3().copy(bodyUp).mulScalar(-1);

        for (const def of RagdollPhysics.CONSTRAINTS) {
            const entityA = this._bodyMap[def.a];
            const entityB = this._bodyMap[def.b];
            if (!entityA || !entityB) continue;

            const rbA = entityA.rigidbody.body;
            const rbB = entityB.rigidbody.body;
            if (!rbA || !rbB) continue;

            const childEntry = this._bodies.find(b => b.name === def.b);
            const parentEntry = this._bodies.find(b => b.name === def.a);
            const pivotWorld = childEntry.bone.getPosition();

            // Build the *world-space* rotation for each constraint frame.
            //
            // For hinges, the two frames are NOT the same rotation: each
            // frame's X axis points along its own bone, and both frames
            // share the same Z axis (the fold axis). Then Bullet's hinge
            // angle = rotation of B's X relative to A's X around the
            // shared Z, which equals the *current bone-to-bone bend* —
            // and is exactly 0 when the joint is straight, regardless of
            // the pose at activation.
            //
            // For cones we still use one shared rotation (twist axis =
            // child bone direction); the cone center IS the activation
            // pose for now.
            let worldRotA, worldRotB;
            if (def.type === "hinge") {
                // Upper bone direction (parent body) at the joint.
                const upStart = parentEntry.bone.getPosition();
                const upEnd = (parentEntry.boneEnd || childEntry.bone).getPosition();
                const upperDir = new pc.Vec3().sub2(upEnd, upStart);
                if (upperDir.lengthSq() < 1e-8) upperDir.set(0, -1, 0);
                upperDir.normalize();

                // Lower bone direction (child body) at the joint.
                const lowStart = childEntry.bone.getPosition();
                const lowEnd = (childEntry.boneEnd || childEntry.bone).getPosition();
                const lowerDir = new pc.Vec3().sub2(lowEnd, lowStart);
                if (lowerDir.lengthSq() < 1e-8) lowerDir.copy(upperDir);
                lowerDir.normalize();

                // Hinge axis selection — purely rig-derived:
                //   - Knees / ankles fold around bodyLateral. The fold
                //     happens in the body's sagittal plane regardless of
                //     leg orientation, and right-hand-rule rotation around
                //     bodyLateral always moves the lower bone "backward"
                //     (the anatomical knee fold direction).
                //   - Elbows / wrists fold around cross(upperDir, bodyForward).
                //     This gives the correct sign for both arms and any
                //     pose: positive rotation around it always moves the
                //     forearm/hand "toward the chest" (the anatomical
                //     elbow fold direction). Verified for arms-down,
                //     T-pose, and intermediate poses, both left and right.
                let hingeAxis;
                const isKnee = def.b === "Left Lower Leg" || def.b === "Right Lower Leg";
                const isAnkle = def.b === "Left Foot" || def.b === "Right Foot";
                const isElbow = def.b === "Left ForeArm" || def.b === "Right ForeArm";
                const isWrist = def.b === "Left Hand" || def.b === "Right Hand";

                if (isKnee || isAnkle) {
                    hingeAxis = bodyLateral.clone();
                } else if (isElbow || isWrist) {
                    hingeAxis = new pc.Vec3().cross(upperDir, bodyForward);
                    if (hingeAxis.lengthSq() < 1e-4) {
                        // Upper bone parallel to bodyForward — degenerate.
                        // Fall back to bodyUp (perpendicular to a forward-
                        // pointing limb) so the constraint stays valid.
                        hingeAxis.copy(bodyUp);
                    }
                } else {
                    // Unknown hinge type — use the bind pose cross product
                    // with bone.right as a final fallback.
                    hingeAxis = new pc.Vec3().cross(upperDir, lowerDir);
                    if (hingeAxis.lengthSq() < 1e-4) {
                        hingeAxis.copy(parentEntry.bone.right);
                    }
                }
                hingeAxis.normalize();

                // Frame A: X along upper bone, Z along hinge axis.
                // Frame B: X along lower bone, Z along hinge axis.
                // The angle between A.X and B.X around Z = current bend,
                // = 0 in the bind pose, > 0 as the joint folds.
                worldRotA = this._basisFromXZ(upperDir, hingeAxis);
                worldRotB = this._basisFromXZ(lowerDir, hingeAxis);
            } else {
                // Cone twist axis selection — also rig-derived:
                //   - Shoulders / hips: anatomical rest = limb hanging
                //     down = bodyDown. Centering the cone here decouples
                //     the available swing range from whatever pose the
                //     avatar happened to be in at activation, which was
                //     the cause of the "shoulder feels limited" issue
                //     (the cone was sitting wherever the arm currently
                //     was, leaving only a small swing range from there).
                //   - Neck (Body → Head): rest = head pointing up = bodyUp.
                //   - Anything else: fall back to the child bone direction
                //     at activation (legacy behaviour).
                let twistAxis;
                if (def.b === "Left Arm" || def.b === "Right Arm" ||
                    def.b === "Left Upper Leg" || def.b === "Right Upper Leg") {
                    twistAxis = bodyDown.clone();
                } else if (def.b === "Head") {
                    twistAxis = bodyUp.clone();
                } else {
                    const bStart = childEntry.bone.getPosition();
                    const bEnd = (childEntry.boneEnd || childEntry.bone).getPosition();
                    twistAxis = new pc.Vec3().sub2(bEnd, bStart);
                    if (twistAxis.lengthSq() < 1e-8) twistAxis.set(0, -1, 0);
                }
                twistAxis.normalize();

                // Map +X (Bullet cone-twist axis) to the chosen rest axis.
                worldRotA = this._quatFromUnitVectors(new pc.Vec3(1, 0, 0), twistAxis);
                worldRotB = worldRotA;
            }

            // Express the world frames in each body's local space:
            //   localRot = inverse(bodyWorldRot) * worldRot
            const localRotA = new pc.Quat().mul2(entityA.getRotation().clone().invert(), worldRotA);
            const localRotB = new pc.Quat().mul2(entityB.getRotation().clone().invert(), worldRotB);

            // Local pivot positions.
            const localPosA = new pc.Vec3();
            const localPosB = new pc.Vec3();
            entityA.getWorldTransform().clone().invert().transformPoint(pivotWorld, localPosA);
            entityB.getWorldTransform().clone().invert().transformPoint(pivotWorld, localPosB);

            const frameA = this._buildBtFrame(localPosA, localRotA);
            const frameB = this._buildBtFrame(localPosB, localRotB);

            let constraint;
            if (def.type === "cone") {
                constraint = new Ammo.btConeTwistConstraint(rbA, rbB, frameA, frameB);
                // Bullet btConeTwistConstraint::setLimit indices:
                //   3 = swingSpan1, 4 = swingSpan2, 5 = twistSpan.
                const [swing1, swing2, twist] = def.limits;
                constraint.setLimit(3, swing1 * pc.math.DEG_TO_RAD);
                constraint.setLimit(4, swing2 * pc.math.DEG_TO_RAD);
                constraint.setLimit(5, twist * pc.math.DEG_TO_RAD);
            } else {
                constraint = new Ammo.btHingeConstraint(rbA, rbB, frameA, frameB);
                constraint.setLimit(
                    def.limits[0] * pc.math.DEG_TO_RAD,
                    def.limits[1] * pc.math.DEG_TO_RAD,
                    0.9, 0.3, 1
                );
            }

            world.addConstraint(constraint, true); // disable collision between linked bodies
            this._constraints.push(constraint);

            Ammo.destroy(frameA);
            Ammo.destroy(frameB);
        }
    }

    // Build a quaternion representing an orthonormal basis whose X axis
    // is `xAxis` and whose Z axis is `zAxis`. Y is `Z × X` (right-handed).
    // If `xAxis` and `zAxis` aren't already perpendicular, `xAxis` is
    // re-projected to be orthogonal to `zAxis`.
    _basisFromXZ(xAxis, zAxis) {
        const z = zAxis.clone().normalize();
        const x = xAxis.clone();
        const d = x.dot(z);
        if (Math.abs(d) > 1e-6) {
            // Project x perpendicular to z.
            x.sub(new pc.Vec3().copy(z).mulScalar(d));
        }
        x.normalize();
        const y = new pc.Vec3().cross(z, x);

        const m = new pc.Mat4();
        m.setIdentity();
        const data = m.data;
        // Column-major: column 0 = X, column 1 = Y, column 2 = Z.
        data[0] = x.x; data[1] = x.y; data[2] = x.z;
        data[4] = y.x; data[5] = y.y; data[6] = y.z;
        data[8] = z.x; data[9] = z.y; data[10] = z.z;
        return new pc.Quat().setFromMat4(m);
    }

    // Quaternion that rotates `from` (unit) to `to` (unit).
    _quatFromUnitVectors(from, to) {
        const d = from.dot(to);
        if (d < -0.999999) {
            // 180° rotation — pick any axis perpendicular to `from`.
            const axis = Math.abs(from.x) > 0.9
                ? new pc.Vec3(0, 1, 0)
                : new pc.Vec3(1, 0, 0);
            return new pc.Quat().setFromAxisAngle(axis, 180);
        }
        const c = new pc.Vec3().cross(from, to);
        return new pc.Quat(c.x, c.y, c.z, 1 + d).normalize();
    }

    // Allocate an Ammo.btTransform from a PlayCanvas position + quaternion.
    // Caller is responsible for Ammo.destroy()ing the result after use.
    _buildBtFrame(localPos, localRot) {
        const t = new Ammo.btTransform();
        t.setIdentity();
        const q = new Ammo.btQuaternion(localRot.x, localRot.y, localRot.z, localRot.w);
        t.setRotation(q);
        Ammo.destroy(q);
        const v = new Ammo.btVector3(localPos.x, localPos.y, localPos.z);
        t.setOrigin(v);
        Ammo.destroy(v);
        return t;
    }

    // ================================================================ ground
    _createGround(player) {
        const playerPos = player.getPosition();
        const ground = new pc.Entity("RagdollGround");
        this.app.root.addChild(ground);
        ground.setPosition(playerPos.x, playerPos.y - 0.05, playerPos.z);
        ground.addComponent("collision", {
            type: "box",
            halfExtents: new pc.Vec3(5, 0.05, 5),
        });
        ground.addComponent("rigidbody", {
            type: pc.BODYTYPE_STATIC,
            friction: this.groundFriction,
            restitution: 0.2,
        });
        this._groundEntity = ground;
    }

    // ================================================================ pose writeback
    _writeBonePoses() {
        for (const entry of this._bodies) {
            if (!entry.bone || entry.bone._destroyed) continue;
            if (!entry.entity || entry.entity._destroyed) continue;

            // Write the physics body transform onto the skeleton bone
            const boneChild = entry.entity.findByName("Bone");
            const source = boneChild || entry.entity;
            entry.bone.setPosition(source.getPosition());
            entry.bone.setRotation(source.getRotation());
        }
    }

    // ================================================================ cleanup
    _removeConstraints() {
        const world = this.app.systems.rigidbody?.dynamicsWorld;
        for (const c of this._constraints) {
            if (world) world.removeConstraint(c);
            Ammo.destroy(c);
        }
        this._constraints = [];
    }

    _removeBodies() {
        for (const entry of this._bodies) {
            if (entry.entity && !entry.entity._destroyed) {
                entry.entity.removeComponent("rigidbody");
                entry.entity.removeComponent("collision");
                entry.entity.destroy();
            }
        }
        this._bodies = [];
        this._bodyMap = {};
    }

    _removeGround() {
        if (this._groundEntity && !this._groundEntity._destroyed) {
            this._groundEntity.removeComponent("rigidbody");
            this._groundEntity.removeComponent("collision");
            this._groundEntity.destroy();
            this._groundEntity = null;
        }
    }
}
