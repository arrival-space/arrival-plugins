/**
 * VRM Spring Bones
 *
 * Physically simulates the spring / jiggle bones (hair, skirt, tails, ears,
 * accessories…) of the local player's VRM avatar — the same secondary motion
 * you see in the @pixiv/three-vrm viewer, brought to the live PlayCanvas app.
 *
 * The PlayCanvas glb loader drops the `VRMC_springBone` (VRM 1.0) /
 * `VRM.secondaryAnimation` (VRM 0.0) glTF extension, so the spring bones load
 * as ordinary skeleton entities that nobody ever moves. This plugin recovers
 * the spring configuration by re-fetching the avatar file, parsing the GLB
 * JSON chunk itself, mapping the configured node indices back onto the live
 * skeleton entities, and then runs the standard VRM spring solver every frame
 * in `postUpdate` (after the animation system has posed the humanoid bones).
 *
 * The math is a 1:1 port of VRMSpringBoneJoint.update() from @pixiv/three-vrm:
 * a single Verlet step per joint (inertia + stiffness pull toward the rest
 * direction + gravity), clamped to the bone length, then converted into a
 * local rotation.
 *
 * CENTER (position-only): tails are integrated relative to a center node's
 * world POSITION (not its rotation). Pure body translation (walking, strafing)
 * cancels out — otherwise world-space locomotion reads as a harsh gust shoving
 * the bones opposite your movement — while body/head ROTATION still sweeps the
 * bones along an arc relative to the fixed-orientation center, so the hair
 * correctly tags along when you turn. We use the spring's authored center node
 * when present, else the avatar root. (This also makes teleports self-correcting:
 * bone and center translate together, so the center-relative state is unchanged.)
 * The `wind` property optionally feeds a fraction of the body's movement back
 * in, so locomotion sways the bones as much (or as little) as you like.
 *
 * Note: this is a deliberate deviation from @pixiv/three-vrm, which uses the
 * center's full transform (rotation included). The viewer is stationary so it
 * never matters there; in a moving app, dropping the rotation is what keeps
 * turning lively without reintroducing the translation gust.
 *
 * COLLIDERS: sphere and capsule colliders are simulated (VRM 1.0 + VRM 0.0
 * sphere groups). Each frame the tail is pushed out of any collider it
 * penetrates and re-clamped to the bone length, so hair/skirt no longer pass
 * through the body. Plane colliders (a rare VRM 1.0 extension) are ignored.
 */
export class VRMSpringBones extends ArrivalScript {
    static scriptName = "VRM Spring Bones";

    isEnabled = true;
    stiffnessMul = 1.0;   // global multiplier over the file's stiffness
    gravityMul = 1.0;     // global multiplier over the file's gravity
    extraDrag = 0.0;      // added to each joint's drag (more = stiffer/calmer)
    wind = 0.0;           // 0 = movement fully cancelled, 1 = full world-space gust
    debugColliders = false;
    debugLog = false;

    static properties = {
        isEnabled: { title: "Enabled" },
        stiffnessMul: { title: "Stiffness ×", min: 0, max: 3, step: 0.05 },
        gravityMul: { title: "Gravity ×", min: 0, max: 3, step: 0.05 },
        extraDrag: { title: "Extra Drag", min: 0, max: 0.95, step: 0.01 },
        wind: { title: "Wind (movement sway)", min: 0, max: 1, step: 0.05 },
        debugColliders: { title: "Debug Draw Colliders" },
        debugLog: { title: "Debug Log" },
    };

    // VRM spring defaults (mirror @pixiv/three-vrm).
    static DEFAULTS = { hitRadius: 0, stiffness: 1, gravityPower: 0, dragForce: 0.4 };

    // Per-frame dt clamp — a tab-switch / hitch must not blow the springs up.
    static MAX_DT = 1 / 30;

    // ------------------------------------------------------------------ state
    _root = null;             // current skeleton root entity we are bound to
    _avatarUrl = null;        // URL the parsed config came from
    _chainDefs = null;        // { joints:[...], colliders:[...] } parsed from file
    _joints = [];             // bound + initialised joints (see _bindJoints)
    _colliderCache = [];      // unique bound colliders, world geom refreshed per frame
    _setupToken = 0;          // guards against overlapping async setups

    // reusable scratch (avoid per-frame allocation)
    _v0 = new pc.Vec3();
    _v1 = new pc.Vec3();
    _v2 = new pc.Vec3();
    _vNext = new pc.Vec3();
    _vInertia = new pc.Vec3();
    _vc0 = new pc.Vec3();     // collision: push/normal direction
    _vc1 = new pc.Vec3();     // collision: scratch
    _vCenter = new pc.Vec3(); // center node world position (this frame)
    _vWind = new pc.Vec3();   // center movement delta (this frame), for wind
    _dbgColor = null;         // lazily-created debug line color
    _q0 = new pc.Quat();
    _q1 = new pc.Quat();
    _m0 = new pc.Mat4();

    // ================================================================ lifecycle
    initialize() {
        // setup is driven lazily from update() once the avatar skeleton exists.
    }

    update() {
        const root = this._getSkeletonRoot();
        if (root && root !== this._root) {
            this._setup(root);
        } else if (!root && this._root) {
            // Avatar was unloaded.
            this._teardown();
        }
    }

    postUpdate(dt) {
        if (this._joints.length === 0) return;
        const step = Math.min(dt, VRMSpringBones.MAX_DT);
        const simulate = this.isEnabled && step > 0;

        // Refresh each collider's world-space geometry once for the whole pass
        // (colliders are shared across many joints), if we'll simulate or draw.
        if (simulate || this.debugColliders) this._refreshColliders();

        if (simulate) {
            // Joints are stored parent-before-child; PlayCanvas recomputes world
            // transforms lazily, so a parent's updated rotation is visible to its
            // child within the same pass.
            for (let i = 0; i < this._joints.length; i++) {
                this._updateJoint(this._joints[i], step);
            }
        }

        if (this.debugColliders) this._drawColliders();
    }

    // Recompute the world center (sphere) / segment endpoints (capsule) of
    // every collider once per frame.
    _refreshColliders() {
        for (const c of this._colliderCache) {
            c._invalid = !c.entity || c.entity._destroyed;
            if (c._invalid) continue;
            const wt = c.entity.getWorldTransform();
            wt.transformPoint(c.offset, c._c0);
            if (c.type === "capsule") {
                wt.transformPoint(c.tail, c._c1);
                c._axis.sub2(c._c1, c._c0);
                c._axisLenSq = c._axis.lengthSq();
            }
        }
    }

    onPropertyChanged(name) {
        if (name === "isEnabled" && !this.isEnabled) {
            // Snap every spring bone back to its rest pose when disabled.
            this._resetJoints();
        }
    }

    destroy() {
        this._teardown();
    }

    // ================================================================ setup
    _getSkeletonRoot() {
        const mesh = ArrivalSpace.getPlayerMesh?.();
        if (!mesh || mesh._destroyed) return null;
        return mesh.script?.glbEntity?.renderRootEntity || mesh;
    }

    async _setup(root) {
        const token = ++this._setupToken;
        this._teardownJoints();
        this._root = root;

        // Resolve the avatar file URL and (re)parse it if it changed.
        const url = this._getAvatarUrl();
        if (!url) {
            if (this.debugLog) console.warn("[SpringBones] No avatar URL available.");
            return;
        }

        if (url !== this._avatarUrl || !this._chainDefs) {
            let json;
            try {
                json = await this._fetchGlbJson(url);
            } catch (e) {
                console.warn("[SpringBones] Failed to fetch/parse avatar file:", e);
                return;
            }
            if (token !== this._setupToken) return; // a newer setup superseded us

            this._avatarUrl = url;
            this._chainDefs = this._extractChains(json);
            if (this.debugLog) {
                console.log(`[SpringBones] Parsed ${this._chainDefs.joints.length} spring joints, ` +
                    `${this._chainDefs.colliders.length} colliders from`, url);
            }
        }

        if (token !== this._setupToken) return;
        this._bindJoints(root, this._chainDefs);

        if (this.debugLog) {
            console.log(`[SpringBones] Bound ${this._joints.length}/${this._chainDefs.joints.length} joints, ` +
                `${this._colliderCache.length} colliders to skeleton.`);
        }
    }

    _getAvatarUrl() {
        const upd = pc.app.userProfileData;
        return upd?.avatar || pc.app.customTravelCenter?.roomData?.defaultAvatar || null;
    }

    // ---------------------------------------------------------- GLB JSON chunk
    async _fetchGlbJson(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const buffer = await res.arrayBuffer();
        return VRMSpringBones._parseGlbJson(buffer);
    }

    // A .vrm is a GLB container. The first chunk is the JSON scene description,
    // which is what holds the (otherwise-discarded) spring-bone extension.
    static _parseGlbJson(buffer) {
        const dv = new DataView(buffer);
        if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB/VRM file"); // 'glTF'
        let offset = 12; // skip 12-byte header (magic, version, length)
        while (offset + 8 <= dv.byteLength) {
            const chunkLen = dv.getUint32(offset, true);
            const chunkType = dv.getUint32(offset + 4, true);
            const chunkStart = offset + 8;
            if (chunkType === 0x4e4f534a) { // 'JSON'
                const bytes = new Uint8Array(buffer, chunkStart, chunkLen);
                return JSON.parse(new TextDecoder().decode(bytes));
            }
            offset = chunkStart + chunkLen;
        }
        throw new Error("No JSON chunk found in GLB");
    }

    // ------------------------------------------ extension → chain + collider defs
    // Returns { joints, colliders }:
    //   joints:    flat, parent-before-child list of
    //              { boneName, childName|null, centerName|null, colliderIdx:int[],
    //                settings:{ stiffness, dragForce, gravityPower,
    //                           gravityDir:pc.Vec3, hitRadius } }
    //   colliders: index-aligned descriptors
    //              { nodeName, type:'sphere'|'capsule', offset:pc.Vec3,
    //                tail?:pc.Vec3, radius, inside }  (joints reference by index)
    _extractChains(json) {
        const nodes = json?.nodes || [];
        const nameOf = (i) => (i != null && nodes[i] ? nodes[i].name : null);
        const D = VRMSpringBones.DEFAULTS;
        const out = [];
        let colliders = [];

        const vrm1 = json?.extensions?.VRMC_springBone;
        const vrm0 = json?.extensions?.VRM?.secondaryAnimation;

        if (vrm1?.springs) {
            // --- colliders: index-aligned to the file's `colliders` array ---
            colliders = (vrm1.colliders || []).map((c) => this._parseVrm1Collider(c, nameOf));
            // colliderGroups[i] → list of collider indices.
            const groups = (vrm1.colliderGroups || []).map((g) => g.colliders || []);
            const resolveGroups = (groupIdx) =>
                (groupIdx || []).flatMap((gi) => groups[gi] || []).filter((i) => colliders[i]);

            // VRM 1.0 — joints are listed explicitly; consecutive joints form a
            // parent→child segment, and the *parent* joint carries the settings.
            for (const spring of vrm1.springs) {
                const joints = spring.joints || [];
                const centerName = spring.center != null ? nameOf(spring.center) : null;
                const colliderIdx = resolveGroups(spring.colliderGroups);
                for (let i = 0; i < joints.length - 1; i++) {
                    const j = joints[i];
                    const child = joints[i + 1];
                    const boneName = nameOf(j.node);
                    if (!boneName) continue;
                    out.push({
                        boneName,
                        childName: nameOf(child.node),
                        centerName,
                        colliderIdx,
                        settings: {
                            stiffness: j.stiffness ?? D.stiffness,
                            dragForce: j.dragForce ?? D.dragForce,
                            gravityPower: j.gravityPower ?? D.gravityPower,
                            gravityDir: this._dirFromArray(j.gravityDir),
                            hitRadius: j.hitRadius ?? D.hitRadius,
                        },
                    });
                }
            }
        } else if (vrm0?.boneGroups) {
            // --- colliders: VRM 0.0 stores them inline per colliderGroup, each
            // group bound to its own node. Flatten into one index-aligned list,
            // recording which global indices belong to each group. ---
            const groups = (vrm0.colliderGroups || []).map((g) => {
                const nodeName = nameOf(g.node);
                const idxs = [];
                for (const sc of g.colliders || []) {
                    // NOTE: @pixiv/three-vrm negates offset.z for VRM0 to undo its
                    // VRM0→three coordinate fix. PlayCanvas loads the glb raw (no
                    // such fix), so we apply the authored offset as-is.
                    colliders.push({
                        nodeName,
                        type: "sphere",
                        offset: new pc.Vec3(sc.offset?.x ?? 0, sc.offset?.y ?? 0, sc.offset?.z ?? 0),
                        radius: sc.radius ?? 0,
                        inside: false,
                    });
                    idxs.push(colliders.length - 1);
                }
                return idxs;
            });

            // VRM 0.0 — each group lists chain ROOT nodes; every descendant
            // becomes a joint with the group's (shared) settings, and its tail
            // target is its first child. Note the spec's "stiffiness" typo.
            for (const bg of vrm0.boneGroups) {
                const settings = {
                    stiffness: bg.stiffiness ?? D.stiffness,
                    dragForce: bg.dragForce ?? D.dragForce,
                    gravityPower: bg.gravityPower ?? D.gravityPower,
                    gravityDir: bg.gravityDir
                        ? new pc.Vec3(bg.gravityDir.x ?? 0, bg.gravityDir.y ?? 0, bg.gravityDir.z ?? 0)
                        : new pc.Vec3(0, -1, 0),
                    hitRadius: bg.hitRadius ?? D.hitRadius,
                };
                const centerName = bg.center != null ? nameOf(bg.center) : null;
                const colliderIdx = (bg.colliderGroups || []).flatMap((gi) => groups[gi] || []);
                for (const rootIndex of bg.bones || []) {
                    // depth-first over the whole subtree (matches three.js traverse)
                    const stack = [rootIndex];
                    while (stack.length) {
                        const idx = stack.pop();
                        const node = nodes[idx];
                        if (!node) continue;
                        const boneName = node.name;
                        const children = node.children || [];
                        if (boneName) {
                            out.push({
                                boneName,
                                childName: nameOf(children[0]),
                                centerName,
                                colliderIdx,
                                settings,
                            });
                        }
                        // push children (reverse keeps natural order; harmless either way)
                        for (let c = children.length - 1; c >= 0; c--) stack.push(children[c]);
                    }
                }
            }
        }

        return { joints: out, colliders };
    }

    // Parse one VRM 1.0 collider descriptor (sphere or capsule). Returns null
    // for shapes we don't simulate yet (e.g. plane).
    _parseVrm1Collider(c, nameOf) {
        const nodeName = nameOf(c?.node);
        const shape = c?.shape || {};
        const vec = (a) => new pc.Vec3(a?.[0] ?? 0, a?.[1] ?? 0, a?.[2] ?? 0);
        if (shape.sphere) {
            return { nodeName, type: "sphere", offset: vec(shape.sphere.offset),
                     radius: shape.sphere.radius ?? 0, inside: !!shape.sphere.inside };
        }
        if (shape.capsule) {
            return { nodeName, type: "capsule", offset: vec(shape.capsule.offset),
                     tail: vec(shape.capsule.tail), radius: shape.capsule.radius ?? 0,
                     inside: !!shape.capsule.inside };
        }
        return null;
    }

    _dirFromArray(arr) {
        return Array.isArray(arr) ? new pc.Vec3(arr[0] || 0, arr[1] || 0, arr[2] || 0)
                                  : new pc.Vec3(0, -1, 0);
    }

    // -------------------------------------------------------------- bind joints
    // Resolve entity references and capture the rest state (the direction each
    // spring pulls back toward). Spring bones are not touched by the humanoid
    // animation, so their local transform here IS their bind pose.
    _bindJoints(root, parsed) {
        const defs = parsed.joints || [];
        const colliderDescs = parsed.colliders || [];

        // name → entity map (first wins on duplicates).
        const byName = new Map();
        const visit = (e) => {
            if (e?.name && !byName.has(e.name)) byName.set(e.name, e);
            for (const c of e.children) visit(c);
        };
        visit(root);

        // Build runtime colliders, index-aligned to colliderDescs (null where
        // the shape is unsupported or its node is missing). Joints reference
        // these shared objects by index.
        const runtimeColliders = colliderDescs.map((d) => {
            const entity = d && d.nodeName ? byName.get(d.nodeName) : null;
            if (!entity) return null;
            return {
                entity,
                type: d.type,
                offset: d.offset,
                radius: d.radius,
                tail: d.tail || null,
                inside: !!d.inside,
                _c0: new pc.Vec3(),   // world center (sphere) / segment start (capsule)
                _c1: new pc.Vec3(),   // segment end (capsule)
                _axis: new pc.Vec3(), // _c1 - _c0 (capsule)
                _axisLenSq: 0,
                _invalid: false,
            };
        });
        this._colliderCache = runtimeColliders.filter(Boolean);

        this._joints = [];
        let missing = 0;
        for (const def of defs) {
            const bone = byName.get(def.boneName);
            if (!bone || !bone.parent) { missing++; continue; }
            const child = def.childName ? byName.get(def.childName) : null;

            const initialLocalMatrix = bone.getLocalTransform().clone();
            const initialLocalRotation = bone.getLocalRotation().clone();

            // Rest direction toward the tail, in the bone's local space.
            const initialLocalChildPos = new pc.Vec3();
            if (child) {
                initialLocalChildPos.copy(child.getLocalPosition());
            } else {
                initialLocalChildPos.copy(bone.getLocalPosition());
                if (initialLocalChildPos.lengthSq() < 1e-12) initialLocalChildPos.set(0, -1, 0);
                initialLocalChildPos.normalize().mulScalar(0.07);
            }
            const boneAxis = initialLocalChildPos.clone();
            if (boneAxis.lengthSq() < 1e-12) boneAxis.set(0, -1, 0);
            boneAxis.normalize();

            // Center node the tail is tracked relative to. Authored center if
            // present, else the avatar root so locomotion is cancelled. We use
            // its world POSITION only (see header note).
            const center = (def.centerName && byName.get(def.centerName)) || root;

            // currentTail / prevTail are stored relative to the center position.
            const worldTail = bone.getWorldTransform().transformPoint(initialLocalChildPos, new pc.Vec3());
            const currentTail = new pc.Vec3().sub2(worldTail, center.getPosition());

            const colliders = (def.colliderIdx || [])
                .map((i) => runtimeColliders[i])
                .filter(Boolean);

            this._joints.push({
                bone,
                child,
                center,
                colliders,
                settings: def.settings,
                initialLocalMatrix,
                initialLocalRotation,
                initialLocalChildPos,
                boneAxis,
                currentTail,
                prevTail: currentTail.clone(),
                _prevCenter: center.getPosition().clone(), // for the wind term
            });
        }

        if (missing > 0 && this.debugLog) {
            console.warn(`[SpringBones] ${missing} configured joints had no matching skeleton entity.`);
        }
    }

    // ================================================================ solver
    // Port of VRMSpringBoneJoint.update() with a position-only center and
    // sphere/capsule colliders. currentTail / prevTail are stored relative to
    // the center node's world POSITION; forces, the clamp and the collision
    // happen in world space; the result is converted back for storage.
    _updateJoint(j, dt) {
        const s = j.settings;
        const bone = j.bone;
        if (bone._destroyed || j.center._destroyed) return;
        const parentWorld = bone.parent.getWorldTransform();
        const centerPos = this._vCenter.copy(j.center.getPosition()); // world

        const bonePos = bone.getPosition(); // world translation

        // 1. world-space bone length (bone → child/tail).
        let childPos;
        if (j.child && !j.child._destroyed) {
            childPos = j.child.getPosition();
        } else {
            childPos = bone.getWorldTransform().transformPoint(j.initialLocalChildPos, this._v2);
        }
        const boneLength = bonePos.distance(childPos);
        if (boneLength < 1e-8) return;

        // 2. rest direction of the bone, in world space.
        //    boneAxis · initialLocalMatrix · parentWorld  (each step normalised,
        //    matching three.js Vector3.transformDirection).
        const wba = this._v0;
        j.initialLocalMatrix.transformVector(j.boneAxis, wba);
        if (wba.lengthSq() > 1e-12) wba.normalize();
        parentWorld.transformVector(wba, wba);
        if (wba.lengthSq() > 1e-12) wba.normalize();

        // 3. Verlet integration. Inertia is computed in center-relative space
        //    (tail position minus center position), so uniform body translation
        //    cancels out and the tail stays glued to the body. The `wind` term
        //    REMOVES a fraction of that compensation by subtracting the center's
        //    movement, so the tail resists following and trails behind your
        //    motion (0 = glued/calm, 1 = full world-space lag/gust). Adding
        //    centerPos back takes the point to world space before the forces.
        const drag = Math.min(s.dragForce + this.extraDrag, 1);
        const centerDelta = this._vWind.sub2(centerPos, j._prevCenter);
        j._prevCenter.copy(centerPos);
        const inertia = this._vInertia.sub2(j.currentTail, j.prevTail);
        if (this.wind > 0) inertia.sub(centerDelta.mulScalar(this.wind));
        inertia.mulScalar(1 - drag);
        const next = this._vNext.add2(j.currentTail, inertia).add(centerPos); // → world
        next.add(this._v1.copy(wba).mulScalar(s.stiffness * this.stiffnessMul * dt));
        next.add(this._v1.copy(s.gravityDir).mulScalar(s.gravityPower * this.gravityMul * dt));

        // 4. clamp the tail to the bone length (world space).
        next.sub(bonePos);
        if (next.lengthSq() > 1e-12) next.normalize();
        next.mulScalar(boneLength).add(bonePos);

        // 5. collide against the spring's colliders (world space). Each hit
        //    pushes the tail out along the contact normal and re-clamps it to
        //    the bone length, keeping the bone rigid.
        if (j.colliders.length) this._applyColliders(j, next, bonePos, boneLength, s.hitRadius);

        // 6. advance the Verlet state. prevTail = old currentTail; currentTail =
        //    new tail expressed relative to the center position again.
        j.prevTail.copy(j.currentTail);
        j.currentTail.sub2(next, centerPos);

        // 7. convert the new (world) tail direction into a local rotation:
        //    local = initialLocalRotation * fromUnitVectors(boneAxis, tailDirLocal)
        const invInit = this._m0.mul2(parentWorld, j.initialLocalMatrix).invert();
        const tailLocal = invInit.transformPoint(next, this._v1);
        if (tailLocal.lengthSq() > 1e-12) tailLocal.normalize();
        const delta = this._quatFromUnitVectors(j.boneAxis, tailLocal, this._q1);
        bone.setLocalRotation(this._q0.copy(j.initialLocalRotation).mul(delta));
    }

    // ---------------------------------------------------------------- colliders
    // Push `tail` (world) out of every collider, re-clamping to the bone length
    // after each hit. Mirrors VRMSpringBoneJoint._collision().
    _applyColliders(j, tail, bonePos, boneLength, objRadius) {
        const dir = this._vc0; // contact normal (filled by the collide fns)
        for (let k = 0; k < j.colliders.length; k++) {
            const c = j.colliders[k];
            if (c._invalid) continue;
            const dist = c.type === "capsule"
                ? this._collideCapsule(c, tail, objRadius, dir)
                : this._collideSphere(c, tail, objRadius, dir);
            if (dist < 0) {
                // push out along the normal by the penetration depth …
                tail.add(dir.mulScalar(-dist));
                // … then re-clamp the tail back onto the bone-length sphere.
                tail.sub(bonePos);
                const len = tail.length();
                if (len > 1e-8) tail.mulScalar(boneLength / len);
                tail.add(bonePos);
            }
        }
    }

    // Signed distance from `pos` to the sphere surface (negative = penetrating).
    // On penetration, writes the unit push-out normal into `out`.
    _collideSphere(c, pos, objRadius, out) {
        out.sub2(pos, c._c0);
        const length = out.length();
        const distance = c.inside ? c.radius - objRadius - length : length - objRadius - c.radius;
        if (distance < 0 && length > 1e-8) {
            out.mulScalar(1 / length);
            if (c.inside) out.mulScalar(-1);
        }
        return distance;
    }

    // Signed distance from `pos` to the capsule surface. The capsule is the
    // swept sphere between c._c0 and c._c1; we find the nearest point on that
    // segment, then it's a sphere test from there.
    _collideCapsule(c, pos, objRadius, out) {
        out.sub2(pos, c._c0);              // vector from segment start to pos
        const dot = c._axis.dot(out);
        if (dot <= 0) {
            // nearest point is the start cap — `out` is already (pos - start)
        } else if (c._axisLenSq <= dot) {
            out.sub(c._axis);              // nearest point is the end cap
        } else {
            out.sub(this._vc1.copy(c._axis).mulScalar(dot / c._axisLenSq)); // project onto segment
        }
        const length = out.length();
        const distance = c.inside ? c.radius - objRadius - length : length - objRadius - c.radius;
        if (distance < 0 && length > 1e-8) {
            out.mulScalar(1 / length);
            if (c.inside) out.mulScalar(-1);
        }
        return distance;
    }

    // ----------------------------------------------------------- debug drawing
    // Immediate-mode wireframes at the EXACT geometry the collision uses
    // (c._c0/_c1 world centers + raw radius), so "off" colliders are obvious.
    _drawColliders() {
        if (!this._dbgColor) this._dbgColor = new pc.Color(0.3, 1, 0.5);
        const col = this._dbgColor;
        for (const c of this._colliderCache) {
            if (c._invalid) continue;
            this._drawWireSphere(c._c0, c.radius, col);
            if (c.type === "capsule") {
                this._drawWireSphere(c._c1, c.radius, col);
                this._drawCapsuleSides(c._c0, c._c1, c.radius, col);
            }
        }
    }

    // Three axis-aligned circles approximating a sphere. Fresh Vec3s per segment
    // (debug-only path; drawLine batches by value but we don't rely on it).
    _drawWireSphere(center, r, color) {
        const SEG = 16;
        for (let plane = 0; plane < 3; plane++) {
            for (let i = 0; i < SEG; i++) {
                const t0 = (i / SEG) * Math.PI * 2;
                const t1 = ((i + 1) / SEG) * Math.PI * 2;
                const c0 = Math.cos(t0) * r, s0 = Math.sin(t0) * r;
                const c1 = Math.cos(t1) * r, s1 = Math.sin(t1) * r;
                let a, b;
                if (plane === 0) {
                    a = new pc.Vec3(center.x + c0, center.y + s0, center.z);
                    b = new pc.Vec3(center.x + c1, center.y + s1, center.z);
                } else if (plane === 1) {
                    a = new pc.Vec3(center.x + c0, center.y, center.z + s0);
                    b = new pc.Vec3(center.x + c1, center.y, center.z + s1);
                } else {
                    a = new pc.Vec3(center.x, center.y + c0, center.z + s0);
                    b = new pc.Vec3(center.x, center.y + c1, center.z + s1);
                }
                this.app.drawLine(a, b, color, false);
            }
        }
    }

    // Four lines along the capsule body connecting the two end spheres.
    _drawCapsuleSides(p0, p1, r, color) {
        const axis = new pc.Vec3().sub2(p1, p0);
        if (axis.lengthSq() < 1e-12) return;
        axis.normalize();
        // pick a vector not parallel to the axis, build two perpendiculars.
        const ref = Math.abs(axis.y) > 0.9 ? new pc.Vec3(1, 0, 0) : new pc.Vec3(0, 1, 0);
        const u = new pc.Vec3().cross(axis, ref).normalize().mulScalar(r);
        const v = new pc.Vec3().cross(axis, u).normalize().mulScalar(r);
        for (const off of [u, new pc.Vec3().copy(u).mulScalar(-1), v, new pc.Vec3().copy(v).mulScalar(-1)]) {
            const a = new pc.Vec3().add2(p0, off);
            const b = new pc.Vec3().add2(p1, off);
            this.app.drawLine(a, b, color, false);
        }
    }

    // Quaternion rotating unit `from` → unit `to` (writes into `out`).
    _quatFromUnitVectors(from, to, out) {
        const d = from.dot(to);
        if (d < -0.999999) {
            // antiparallel — rotate 180° about any perpendicular axis.
            const axis = Math.abs(from.x) > 0.9 ? this._v2.set(0, 1, 0) : this._v2.set(1, 0, 0);
            return out.setFromAxisAngle(axis, 180);
        }
        const c = this._v2.cross(from, to);
        return out.set(c.x, c.y, c.z, 1 + d).normalize();
    }

    // ================================================================ cleanup
    _resetJoints() {
        for (const j of this._joints) {
            if (j.bone && !j.bone._destroyed) {
                j.bone.setLocalRotation(j.initialLocalRotation);
                // restore the rest tail, center-position-relative (matches _bindJoints).
                const worldTail = j.bone.getWorldTransform().transformPoint(j.initialLocalChildPos, this._v0);
                if (j.center && !j.center._destroyed) {
                    j.currentTail.sub2(worldTail, j.center.getPosition());
                    j._prevCenter.copy(j.center.getPosition()); // avoid a wind spike on resume
                } else {
                    j.currentTail.copy(worldTail);
                }
                j.prevTail.copy(j.currentTail);
            }
        }
    }

    _teardownJoints() {
        this._resetJoints();
        this._joints = [];
    }

    _teardown() {
        this._setupToken++;
        this._teardownJoints();
        this._colliderCache = [];
        this._root = null;
        // keep _chainDefs/_avatarUrl cached in case the same avatar reloads
    }
}
