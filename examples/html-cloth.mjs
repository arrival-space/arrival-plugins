export class HtmlCloth extends ArrivalScript {
    static scriptName = "HtmlCloth";

    static SPEECH = {
        idle: ["\u2026", "\u2026seriously?", "hi.", "what.", "okay.", "\u2026and?", "still here.", "great.", "hmm."],
        pet: ["\u2026please.", "don't.", "weird.", "sure.", "fantastic.", "wow.", "okay then.", "\u2026"],
        poke: ["ow.", "yep.", "great.", "wonderful.", "cool.", "fascinating.", "stop.", "\u2026seriously?"],
        talk: ["wow.", "fascinating.", "\u2026and?", "uh huh.", "that's nice.", "okay.", "\u2026sure.", "mmhmm."],
        mass: ["my mass is {v}? cool.", "{v}? sure.", "am I {v} now?", "is {v} better?", "fine, {v} it is."],
        stiff: ["stiffness {v}. great.", "{v}? fine.", "i feel that.", "sure.", "{v}. wow."],
        shine: ["am i metal now?", "shiny.", "why.", "{v} shine. great.", "look at me i guess.", "wow."],
        color: ["interesting.", "i hate it.", "bold choice.", "\u2026sure.", "wow.", "really?", "that's a color."],
    };

    width = 2.6;
    height = 2.6;
    segmentsX = 20;
    segmentsY = 20;
    clothMass = 1.2;
    clothDamping = 0.04;
    clothFriction = 0.8;
    clothStiffness = 0.9;
    gravity = 9.8;
    collisionMargin = 0.04;
    colliderDistance = 100;
    physicsHz = 120;
    physicsSubSteps = 8;
    metalness = 0.5;
    glossiness = 0.5;
    debugFreeze = false;
    playerProxyHeight = 2.4;
    playerProxyWidth = 0.2;
    textureWidth = 1024;
    textureHeight = 1024;

    static properties = {
        width: { title: "Width", min: 0.5, max: 6, step: 0.1 },
        height: { title: "Height", min: 0.5, max: 8, step: 0.1 },
        segmentsX: { title: "Segments X", min: 2, max: 24, step: 1 },
        segmentsY: { title: "Segments Y", min: 2, max: 32, step: 1 },
        clothMass: { title: "Mass", min: 0.1, max: 10, step: 0.1 },
        clothDamping: { title: "Damping", min: 0, max: 1, step: 0.01 },
        clothFriction: { title: "Friction", min: 0, max: 2, step: 0.05 },
        clothStiffness: { title: "Stiffness", min: 0.1, max: 1, step: 0.05 },
        gravity: { title: "Gravity", min: 0, max: 20, step: 0.1 },
        collisionMargin: { title: "Collision Margin", min: 0.005, max: 0.2, step: 0.005 },
        colliderDistance: { title: "Collider Range", min: 0.5, max: 12, step: 0.1 },
        physicsHz: { title: "Physics Hz", min: 30, max: 480, step: 30 },
        physicsSubSteps: { title: "Physics Sub Steps", min: 1, max: 16, step: 1 },
        metalness: { title: "Metalness", min: 0, max: 1, step: 0.05 },
        glossiness: { title: "Glossiness", min: 0, max: 1, step: 0.05 },
        debugFreeze: { title: "Debug Freeze" },
        playerProxyHeight: { title: "Player Proxy Height", min: 0.5, max: 3, step: 0.05 },
        playerProxyWidth: { title: "Player Proxy Width", min: 0.01, max: 2, step: 0.05 },
        textureWidth: { title: "Texture Width (px)", min: 64, max: 2048, step: 64 },
        textureHeight: { title: "Texture Height (px)", min: 64, max: 2048, step: 64 },
    };

    _worldLayer = null;
    _mesh = null;
    _meshNode = null;
    _meshInstance = null;
    _material = null;
    _texture = null;
    _sourceEl = null;
    _hadLayoutSubtree = false;
    _paintHandler = null;
    _positions = null;
    _normals = null;
    _indices = null;
    _topEdgeLocalPoints = [];
    _colliderBodies = [];
    _anchorBodies = [];

    _dynamicsWorld = null;
    _softBodyHelpers = null;
    _clothBody = null;
    _worldGravity = null;

    _collisionConfiguration = null;
    _dispatcher = null;
    _broadphase = null;
    _solver = null;
    _softBodySolver = null;

    _tmpTransform = null;
    _tmpOrigin = null;
    _tmpRotation = null;
    _tmpScale = null;
    _tmpMat = new pc.Mat4();
    _tmpPoint = new pc.Vec3();

    _elapsed = 0;
    _boundPointerDown = null;
    _boundPointerMove = null;
    _boundPointerUp = null;
    _inputLocked = false;
    _hoveredTarget = null;
    _mouseDownTarget = null;
    _selAnchorNode = null;
    _selAnchorOffset = 0;
    _selReady = false;
    _dispatching = false;
    _highlightMarks = [];
    _gridEntity = null;
    _gridPrevEnabled = null;

    initialize() {
        this._enableGrid();
        if (this.app.loadTracker?.loadingSpace) {
            this.app.once("hideLoadingScreen", this._buildCurtain.bind(this));
        } else {
            this._buildCurtain();
        }
    }

    _enableGrid() {
        const grid = this.app.root.findByName("PerfectGridPlane");
        if (!grid) return;
        this._gridEntity = grid;
        this._gridPrevEnabled = grid.enabled;
        grid.enabled = true;
    }

    _restoreGrid() {
        if (this._gridEntity && this._gridPrevEnabled !== null) {
            this._gridEntity.enabled = this._gridPrevEnabled;
        }
        this._gridEntity = null;
        this._gridPrevEnabled = null;
    }

    update(dt) {
        if (!this._clothBody || !this._dynamicsWorld || !dt) {
            return;
        }

        this._syncAnchorBodies();
        this._syncColliderBodies();

        if (!this.debugFreeze) {
            const fixedStep = 1 / this.physicsHz;
            const clampedDt = Math.min(dt, this.physicsSubSteps * fixedStep);
            this._dynamicsWorld.stepSimulation(clampedDt, this.physicsSubSteps, fixedStep);
        }

        this._updateRenderMesh();

        if (this._sourceEl) {
            this._elapsed += dt;

            this._drawVideoFrame();

            // Curtis idle chatter: say a random idle line every ~9s of silence.
            if (this._elapsed - (this._lastSpeak || -999) > 9) {
                this._setSpeech(this._pickSpeech("idle"));
            }

            this._refreshTexture();
        }
    }

    onPropertyChanged(name, value) {
        if (name === "metalness" || name === "glossiness") {
            if (this._material) {
                this._material.metalness = this.metalness;
                this._material.gloss = this.glossiness;
                this._material.update();
            }
            return;
        }

        this._teardownCurtain();
        this._buildCurtain();
    }

    destroy() {
        this._teardownInteraction();
        this._teardownCurtain();
        this._restoreGrid();
        this.unlockInput();
        if (this._keyboardLocked) {
            this.unlockKeyboard();
            this._keyboardLocked = false;
        }

        if (this._sourceEl?.parentNode) {
            this._sourceEl.parentNode.removeChild(this._sourceEl);
        }
        this._sourceEl = null;
    }

    _buildCurtain() {
        if (typeof Ammo === "undefined") {
            console.warn("[HtmlCloth] Ammo is required for cloth simulation.");
            return;
        }

        this._worldLayer = this.app.scene.layers.getLayerByName("World");
        this._createPhysicsWorld();
        this._createRenderMesh();
        this._createClothBody();
        this._createAnchorBodies();
        this._createNearbyColliders();
        this._updateRenderMesh();

        if (this._htmlCanvasSupported()) {
            this._createSourceElement();
            this._createBlankTexture();
            this._material.diffuseMap = this._texture;
            this._material.update();
            this._scheduleTextureUpload();
            this._setupInteraction();
        } else {
            console.warn("[HtmlCloth] texElementImage2D is not supported in this browser; showing error texture.");
            this._createErrorTexture();
            this._material.diffuseMap = this._texture;
            this._material.update();
        }
    }

    _htmlCanvasSupported() {
        const gl = this.app.graphicsDevice?.gl;
        return !!(gl && typeof gl.texElementImage2D === "function");
    }

    _createErrorTexture() {
        const w = 768, h = 768;
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");

        ctx.fillStyle = "#f4ead9";
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = "#2a1f18";
        ctx.lineWidth = 8;
        ctx.strokeRect(24, 24, w - 48, h - 48);

        ctx.fillStyle = "#d4654e";
        ctx.font = "bold 120px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", w / 2, 220);

        ctx.fillStyle = "#2a1f18";
        ctx.font = "bold 48px sans-serif";
        ctx.fillText("HTML IN CANVAS", w / 2, 340);
        ctx.fillText("NOT SUPPORTED", w / 2, 398);

        ctx.font = "28px sans-serif";
        ctx.fillStyle = "rgba(42,31,24,0.75)";
        ctx.fillText("Use Chrome and enable", w / 2, 480);

        ctx.font = "bold 26px ui-monospace, Menlo, monospace";
        ctx.fillStyle = "#2a1f18";
        ctx.fillText("chrome://flags/", w / 2, 540);
        ctx.fillText("#canvas-draw-element", w / 2, 580);

        ctx.font = "italic 24px serif";
        ctx.fillStyle = "rgba(42,31,24,0.55)";
        ctx.fillText("— Curtis", w / 2, 680);

        const device = this.app.graphicsDevice;
        this._texture = new pc.Texture(device, {
            width: w,
            height: h,
            format: pc.PIXELFORMAT_RGBA8,
            mipmaps: false,
            minFilter: pc.FILTER_LINEAR,
            magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE,
            addressV: pc.ADDRESS_CLAMP_TO_EDGE,
        });
        this._texture.setSource(c);
    }

    _createPhysicsWorld() {
        this._collisionConfiguration = new Ammo.btSoftBodyRigidBodyCollisionConfiguration();
        this._dispatcher = new Ammo.btCollisionDispatcher(this._collisionConfiguration);
        this._broadphase = new Ammo.btDbvtBroadphase();
        this._solver = new Ammo.btSequentialImpulseConstraintSolver();
        this._softBodySolver = new Ammo.btDefaultSoftBodySolver();
        this._dynamicsWorld = new Ammo.btSoftRigidDynamicsWorld(
            this._dispatcher,
            this._broadphase,
            this._solver,
            this._collisionConfiguration,
            this._softBodySolver
        );

        this._worldGravity = new Ammo.btVector3(0, -this.gravity, 0);
        this._dynamicsWorld.setGravity(this._worldGravity);

        const worldInfo = this._dynamicsWorld.getWorldInfo();
        worldInfo.set_m_broadphase(this._broadphase);
        worldInfo.set_m_dispatcher(this._dispatcher);
        worldInfo.set_m_gravity(this._worldGravity);
        if (typeof worldInfo.get_m_sparsesdf === "function") {
            const sparseSdf = worldInfo.get_m_sparsesdf();
            if (sparseSdf && typeof sparseSdf.Initialize === "function") {
                sparseSdf.Initialize();
            }
        }

        this._softBodyHelpers = new Ammo.btSoftBodyHelpers();

        this._tmpTransform = new Ammo.btTransform();
        this._tmpOrigin = new Ammo.btVector3(0, 0, 0);
        this._tmpRotation = new Ammo.btQuaternion(0, 0, 0, 1);
        this._tmpScale = new Ammo.btVector3(1, 1, 1);
    }

    _createRenderMesh() {
        const cols = this._segmentCountX();
        const rows = this._segmentCountY();
        const pointCount = (cols + 1) * (rows + 1);

        this._positions = new Float32Array(pointCount * 3);
        this._normals = new Float32Array(pointCount * 3);
        this._uvs = new Float32Array(pointCount * 2);
        this._indices = [];
        this._topEdgeLocalPoints = [];

        for (let y = 0; y <= rows; y++) {
            for (let x = 0; x <= cols; x++) {
                const vertexIndex = y * (cols + 1) + x;

                if (y === 0) {
                    this._topEdgeLocalPoints.push(this._localGridPoint(x, 0));
                }

                const uvIndex = vertexIndex * 2;
                this._uvs[uvIndex] = x / cols;
                this._uvs[uvIndex + 1] = y / rows;

                if (x === cols || y === rows) {
                    continue;
                }

                const i0 = y * (cols + 1) + x;
                const i1 = i0 + 1;
                const i2 = i0 + cols + 1;
                const i3 = i2 + 1;

                this._indices.push(i0, i2, i1);
                this._indices.push(i1, i2, i3);
            }
        }

        this._mesh = new pc.Mesh(this.app.graphicsDevice);
        this._mesh.setPositions(this._positions);
        this._mesh.setNormals(this._normals);
        this._mesh.setUvs(0, this._uvs);
        this._mesh.setIndices(this._indices);
        this._mesh.update(pc.PRIMITIVE_TRIANGLES);

        this._material = new pc.StandardMaterial();
        this._material.useLighting = true;
        this._material.useMetalness = true;
        this._material.cull = pc.CULLFACE_NONE;
        this._material.diffuse = new pc.Color(1, 1, 1);
        this._material.emissive = new pc.Color(0, 0, 0);
        this._material.metalness = this.metalness;
        this._material.gloss = this.glossiness;
        this._material.update();

        this._meshNode = new pc.GraphNode("HtmlClothCurtain");
        this._meshInstance = new pc.MeshInstance(this._mesh, this._material, this._meshNode);
        this._meshInstance.cull = false;
        this._meshInstance.castShadow = true;

        if (this._worldLayer) {
            this._worldLayer.addMeshInstances([this._meshInstance]);
        }
    }

    _createClothBody() {
        const worldInfo = this._dynamicsWorld.getWorldInfo();

        const topLeft = this._toWorldPoint(this._localGridPoint(0, 0));
        const topRight = this._toWorldPoint(this._localGridPoint(this._segmentCountX(), 0));
        const bottomLeft = this._toWorldPoint(this._localGridPoint(0, this._segmentCountY()));
        const bottomRight = this._toWorldPoint(this._localGridPoint(this._segmentCountX(), this._segmentCountY()));

        const c00 = new Ammo.btVector3(topLeft.x, topLeft.y, topLeft.z);
        const c01 = new Ammo.btVector3(topRight.x, topRight.y, topRight.z);
        const c10 = new Ammo.btVector3(bottomLeft.x, bottomLeft.y, bottomLeft.z);
        const c11 = new Ammo.btVector3(bottomRight.x, bottomRight.y, bottomRight.z);

        this._clothBody = this._softBodyHelpers.CreatePatch(
            worldInfo,
            c00,
            c01,
            c10,
            c11,
            this._segmentCountX() + 1,
            this._segmentCountY() + 1,
            0,
            true
        );

        Ammo.destroy(c00);
        Ammo.destroy(c01);
        Ammo.destroy(c10);
        Ammo.destroy(c11);

        const config = this._clothBody.get_m_cfg();
        config.set_viterations(8);
        config.set_piterations(8);
        config.set_diterations(8);
        config.set_kDP(this.clothDamping);
        config.set_kDF(this.clothFriction);

        const material = this._clothBody.get_m_materials().at(0);
        material.set_m_kLST(this.clothStiffness);
        material.set_m_kAST(this.clothStiffness);

        this._clothBody.setTotalMass(this.clothMass, false);
        Ammo.castObject(this._clothBody, Ammo.btCollisionObject).getCollisionShape().setMargin(this.collisionMargin);
        this._clothBody.setActivationState(pc.BODYSTATE_DISABLE_DEACTIVATION);

        this._dynamicsWorld.addSoftBody(this._clothBody, 1, -1);
    }

    _createAnchorBodies() {
        for (let i = 0; i < this._topEdgeLocalPoints.length; i++) {
            const worldPoint = this._toWorldPoint(this._topEdgeLocalPoints[i]);

            /// add a small error so cloth falls more naturally instead of perfectly flat at the start
            worldPoint.z += Math.random() * 0.01 - 0.005;
            worldPoint.x += Math.random() * 0.01 - 0.005;

            const anchor = this._createStaticBoxBody(worldPoint, 0.015);
            this._anchorBodies.push(anchor);
            this._clothBody.appendAnchor(i, anchor.body, true, 1);
        }
    }

    _createNearbyColliders() {
        const center = this.entity.getPosition();
        const maxDistanceSq = this.colliderDistance * this.colliderDistance;
        const collisionComponents = this.app.root.findComponents("collision");

        for (const collision of collisionComponents) {
            if (!collision?.entity || collision.entity === this.entity) {
                continue;
            }

            if(!collision.enabled) {
                continue;
            }

            if(!collision?.entity?.rigidbody || !collision?.entity.enabled) {
                continue;
            }

            const pos = collision.entity.getPosition();
            const dx = pos.x - center.x;
            const dy = pos.y - center.y;
            const dz = pos.z - center.z;

            if ((dx * dx) + (dy * dy) + (dz * dz) > maxDistanceSq) {
                continue;
            }

            const proxy = this._createColliderProxy(collision);
            if (proxy) {
                this._colliderBodies.push(proxy);
            }
        }
    }

    _createColliderProxy(collision) {
        const type = collision.type;
        const entity = collision.entity;
        const entityScale = entity.getScale();
        const maxScale = Math.max(Math.abs(entityScale.x), Math.abs(entityScale.y), Math.abs(entityScale.z));
        const isPlayer = entity.name === "CharacterController" || !!entity.script?.characterController;
        let shape = null;
        let usesScale = false;

        if (isPlayer) {
            shape = new Ammo.btCapsuleShape(this.playerProxyWidth, this.playerProxyHeight);
        } else{

            return null; // only support player proxy for now, can add more shapes later if needed
        }

        shape.setMargin(this.collisionMargin);

        const transform = new Ammo.btTransform();
        transform.setIdentity();

        const motionState = new Ammo.btDefaultMotionState(transform);
        const inertia = new Ammo.btVector3(0, 0, 0);
        const info = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, inertia);
        const body = new Ammo.btRigidBody(info);

        body.setCollisionFlags(body.getCollisionFlags() | 2);
        body.setActivationState(pc.BODYSTATE_DISABLE_DEACTIVATION);

        this._dynamicsWorld.addRigidBody(body, 1, -1);

        const proxy = { body, entity, shape, transform, motionState, info, inertia, usesScale };
        this._syncRigidBody(proxy);
        return proxy;
    }

    _createStaticBoxBody(worldPoint, halfExtent) {
        const size = new Ammo.btVector3(halfExtent, halfExtent, halfExtent);
        const shape = new Ammo.btBoxShape(size);
        Ammo.destroy(size);
        shape.setMargin(this.collisionMargin);

        const transform = new Ammo.btTransform();
        transform.setIdentity();
        const origin = new Ammo.btVector3(worldPoint.x, worldPoint.y, worldPoint.z);
        const rotation = new Ammo.btQuaternion(0, 0, 0, 1);
        transform.setOrigin(origin);
        transform.setRotation(rotation);
        Ammo.destroy(origin);
        Ammo.destroy(rotation);

        const motionState = new Ammo.btDefaultMotionState(transform);
        const inertia = new Ammo.btVector3(0, 0, 0);
        const info = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, inertia);
        const body = new Ammo.btRigidBody(info);

        body.setCollisionFlags(body.getCollisionFlags() | 2);
        body.setActivationState(pc.BODYSTATE_DISABLE_DEACTIVATION);

        this._dynamicsWorld.addRigidBody(body, 1, -1);

        const proxy = { body, shape, transform, motionState, info, inertia };
        return proxy;
    }

    _syncAnchorBodies() {
        for (let i = 0; i < this._anchorBodies.length; i++) {
            const worldPoint = this._toWorldPoint(this._topEdgeLocalPoints[i], this._tmpPoint);
            this._setBodyTransform(this._anchorBodies[i].body, worldPoint, pc.Quat.IDENTITY);
        }
    }

    _syncColliderBodies() {
        for (const proxy of this._colliderBodies) {
            this._syncRigidBody(proxy);
        }
    }

    _syncRigidBody(proxy) {
        if (proxy.usesScale) {
            const scale = proxy.entity.getScale();
            this._tmpScale.setValue(
                Math.max(0.001, Math.abs(scale.x)),
                Math.max(0.001, Math.abs(scale.y)),
                Math.max(0.001, Math.abs(scale.z))
            );
            proxy.shape.setLocalScaling(this._tmpScale);
        }

        // Predict one frame ahead based on the entity's frame-delta so the
        // soft-body collision doesn't lag the player by a frame.
        const pos = proxy.entity.getPosition();
        let px = pos.x, py = pos.y, pz = pos.z;
        if (proxy.prevPos) {
            px += pos.x - proxy.prevPos.x;
            py += pos.y - proxy.prevPos.y;
            pz += pos.z - proxy.prevPos.z;
        } else {
            proxy.prevPos = new pc.Vec3();
        }
        proxy.prevPos.set(pos.x, pos.y, pos.z);
        this._tmpPoint.set(px, py, pz);

        this._setBodyTransform(proxy.body, this._tmpPoint, proxy.entity.getRotation());
    }

    _setBodyTransform(body, position, rotation) {
        this._tmpTransform.setIdentity();
        this._tmpOrigin.setValue(position.x, position.y, position.z);
        this._tmpRotation.setValue(rotation.x, rotation.y, rotation.z, rotation.w);
        this._tmpTransform.setOrigin(this._tmpOrigin);
        this._tmpTransform.setRotation(this._tmpRotation);

        body.setWorldTransform(this._tmpTransform);

        const motionState = body.getMotionState();
        if (motionState) {
            motionState.setWorldTransform(this._tmpTransform);
        }
    }

    _updateRenderMesh() {
        const nodes = this._clothBody.get_m_nodes();
        const count = nodes.size();

        for (let i = 0; i < count; i++) {
            const node = nodes.at(i);
            const point = node.get_m_x();
            const baseIndex = i * 3;

            this._positions[baseIndex] = point.x();
            this._positions[baseIndex + 1] = point.y();
            this._positions[baseIndex + 2] = point.z();
        }

        this._mesh.setPositions(this._positions);
        this._recalculateNormals();
        this._mesh.setNormals(this._normals);
        this._mesh.update(pc.PRIMITIVE_TRIANGLES);
    }

    _recalculateNormals() {
        this._normals.fill(0);

        for (let i = 0; i < this._indices.length; i += 3) {
            const ia = this._indices[i] * 3;
            const ib = this._indices[i + 1] * 3;
            const ic = this._indices[i + 2] * 3;

            const ax = this._positions[ia];
            const ay = this._positions[ia + 1];
            const az = this._positions[ia + 2];

            const bx = this._positions[ib];
            const by = this._positions[ib + 1];
            const bz = this._positions[ib + 2];

            const cx = this._positions[ic];
            const cy = this._positions[ic + 1];
            const cz = this._positions[ic + 2];

            const abx = bx - ax;
            const aby = by - ay;
            const abz = bz - az;
            const acx = cx - ax;
            const acy = cy - ay;
            const acz = cz - az;

            const nx = (aby * acz) - (abz * acy);
            const ny = (abz * acx) - (abx * acz);
            const nz = (abx * acy) - (aby * acx);

            this._normals[ia] += nx;
            this._normals[ia + 1] += ny;
            this._normals[ia + 2] += nz;

            this._normals[ib] += nx;
            this._normals[ib + 1] += ny;
            this._normals[ib + 2] += nz;

            this._normals[ic] += nx;
            this._normals[ic + 1] += ny;
            this._normals[ic + 2] += nz;
        }

        for (let i = 0; i < this._normals.length; i += 3) {
            const nx = this._normals[i];
            const ny = this._normals[i + 1];
            const nz = this._normals[i + 2];
            const length = Math.sqrt((nx * nx) + (ny * ny) + (nz * nz));

            if (!length) {
                this._normals[i] = 0;
                this._normals[i + 1] = 0;
                this._normals[i + 2] = 1;
                continue;
            }

            const invLength = 1 / length;
            this._normals[i] = nx * invLength;
            this._normals[i + 1] = ny * invLength;
            this._normals[i + 2] = nz * invLength;
        }
    }

    /* ── HTML source element ──────────────────────────────── */

    _createSourceElement() {
        const canvas = this.app.graphicsDevice.canvas;

        if (canvas && !canvas.hasAttribute("layoutsubtree")) {
            canvas.setAttribute("layoutsubtree", "true");
            this._hadLayoutSubtree = true;
        }

        this._sourceEl = document.createElement("div");
        this._sourceEl.style.cssText = [
            `width:${this.textureWidth}px`,
            `height:${this.textureHeight}px`,
            "pointer-events:none",
            "position:relative",
        ].join(";");

        this._sourceEl.innerHTML = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700;800&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&display=swap');

#htc-root {
    --bg: #f4ead9;
    --bg-panel: #ede1c6;
    --ink: #2a1f18;
    --ink-dim: rgba(42,31,24,0.55);
    --accent: #d4654e;
    --line: rgba(42,31,24,0.2);

    position: relative;
    width: 100%;
    height: 100%;
    padding: 56px 60px;
    box-sizing: border-box;
    background: var(--bg);
    color: var(--ink);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    overflow: hidden;
}
#htc-root *, #htc-root *::before, #htc-root *::after { box-sizing: border-box; }

/* paper grain */
#htc-root::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.5;
    background-image:
        radial-gradient(circle at 30% 20%, rgba(0,0,0,0.04) 2px, transparent 3px),
        radial-gradient(circle at 70% 60%, rgba(0,0,0,0.035) 2px, transparent 3px),
        radial-gradient(circle at 45% 85%, rgba(0,0,0,0.03) 2px, transparent 3px);
    background-size: 320px 320px, 420px 420px, 380px 380px;
    mix-blend-mode: multiply;
}

.topbar {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    border-bottom: 3px solid var(--ink);
    padding-bottom: 22px;
    margin-bottom: 36px;
}
.topbar .name {
    font-family: 'Bricolage Grotesque', sans-serif;
    font-weight: 800;
    font-size: 88px;
    line-height: 0.9;
    letter-spacing: -0.03em;
    color: var(--ink);
}
.topbar .name .diamond { color: var(--accent); margin-right: 12px; }
.topbar .est {
    font-family: 'JetBrains Mono', monospace;
    font-size: 18px;
    letter-spacing: 0.25em;
    font-weight: 500;
    color: var(--ink-dim);
    text-transform: uppercase;
}

.main {
    display: grid;
    grid-template-columns: 360px 1fr;
    gap: 48px;
    margin-bottom: 40px;
}

.face-col { display: flex; flex-direction: column; gap: 24px; }
.face-frame {
    position: relative;
    border: 3px solid var(--ink);
    border-radius: 6px;
    padding: 14px;
    background: var(--bg-panel);
}
.face-frame::before {
    content: 'SUBJECT';
    position: absolute;
    top: -13px;
    left: 22px;
    background: var(--bg);
    padding: 0 12px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.3em;
    color: var(--accent);
}
#htc-video-canvas {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 194 / 228;
    filter: contrast(0.95) saturate(0.85);
    border-radius: 4px;
}
.id-strip {
    display: flex;
    justify-content: space-between;
    padding-top: 12px;
    border-top: 1px dashed var(--line);
    font-size: 15px;
    letter-spacing: 0.12em;
    color: var(--ink-dim);
    font-weight: 500;
}
.mood {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 16px;
    letter-spacing: 0.2em;
    font-weight: 700;
    color: var(--ink-dim);
    text-transform: uppercase;
}
.mood-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 5px rgba(212,101,78,0.18);
    transition: background 0.3s, box-shadow 0.3s;
}

.ctrl-col { display: flex; flex-direction: column; gap: 32px; }

.speech {
    font-family: 'Instrument Serif', serif;
    font-style: italic;
    font-size: 68px;
    line-height: 1.1;
    color: var(--ink);
    padding-bottom: 22px;
    border-bottom: 1px solid var(--line);
    min-height: 96px;
}

.sliders { display: flex; flex-direction: column; gap: 26px; }
.slider-row {
    display: grid;
    grid-template-columns: 110px 1fr 90px;
    align-items: center;
    gap: 22px;
}
.slider-label {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 20px;
    letter-spacing: 0.22em;
    color: var(--ink);
}
.slider-value {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 20px;
    color: var(--accent);
    text-align: right;
}

input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    background: rgba(42,31,24,0.18);
    outline: none;
    padding: 0;
    margin: 0;
    border-radius: 3px;
}
input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent);
    border: 3px solid var(--ink);
    cursor: pointer;
    transition: transform 0.15s;
}
input[type="range"]::-moz-range-thumb {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent);
    border: 3px solid var(--ink);
    cursor: pointer;
}
input[type="range"].hover::-webkit-slider-thumb { transform: scale(1.25); }

.theme-row {
    display: flex;
    align-items: center;
    gap: 22px;
    padding-top: 4px;
}
.theme-row label {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 20px;
    letter-spacing: 0.22em;
    color: var(--ink);
}
#htc-bg {
    width: 64px;
    height: 64px;
    border: 3px solid var(--ink);
    border-radius: 10px;
    padding: 0;
    background: transparent;
    cursor: pointer;
    transition: transform 0.15s;
    overflow: hidden;
}
#htc-bg.hover { transform: scale(1.08); }

.actions {
    display: grid;
    grid-template-columns: 1fr 1fr 1.4fr;
    gap: 24px;
    border-top: 3px solid var(--ink);
    padding-top: 32px;
}
.btn {
    font-family: 'Bricolage Grotesque', sans-serif;
    font-weight: 800;
    font-size: 36px;
    letter-spacing: 0.04em;
    padding: 28px 16px;
    background: transparent;
    color: var(--ink);
    border: 3px solid var(--ink);
    border-radius: 12px;
    cursor: pointer;
    text-transform: uppercase;
    transition: background 0.18s, color 0.18s, transform 0.18s, box-shadow 0.18s;
}
.btn.hover {
    background: var(--ink);
    color: var(--bg);
    transform: translate(-3px, -3px);
    box-shadow: 6px 6px 0 var(--accent);
}
.btn.active {
    background: var(--accent);
    color: var(--bg);
}

.talk-input {
    grid-column: 1 / -1;
    font-family: 'Arial', serif;
    font-style: bold;
    font-size: 34px;
    padding: 18px 24px;
    border: 3px solid var(--ink);
    border-radius: 8px;
    background: #ffffff;
    color: var(--ink);
    outline: none;
    width: 100%;
    display: none;
    margin-top: 4px;
}
.talk-input.active { display: block; }
.talk-input::placeholder { color: var(--ink-dim); font-style: italic; }
</style>

<div id="htc-root">
    <header class="topbar">
        <span class="name"><span class="diamond">◆</span>HTML in Canvas</span>
        <span class="est">EST. 2026</span>
    </header>

    <div class="main">
        <div class="face-col">
            <div class="face-frame">
                <canvas id="htc-video-canvas" width="194" height="228"></canvas>
            </div>
            <div class="id-strip">
                <span>ID / 042</span>
                <span>STATUS / AWAKE</span>
            </div>
            <div class="mood">
                <span>MOOD</span>
                <span class="mood-dot" id="htc-mood"></span>
                <span id="htc-mood-text">FINE</span>
            </div>
        </div>

        <div class="ctrl-col">
            <div class="speech" id="htc-speech">"...seriously?"</div>

            <div class="sliders">
                <div class="slider-row">
                    <span class="slider-label">MASS</span>
                    <input type="range" id="htc-mass" min="1" max="5" step="0.1" value="1.2">
                    <span class="slider-value" id="htc-mass-val">1.2</span>
                </div>
                <div class="slider-row">
                    <span class="slider-label">STIFF</span>
                    <input type="range" id="htc-stiff" min="0.1" max="1" step="0.05" value="0.9">
                    <span class="slider-value" id="htc-stiff-val">0.90</span>
                </div>
                <div class="slider-row">
                    <span class="slider-label">SHINE</span>
                    <input type="range" id="htc-shine" min="0" max="1" step="0.05" value="0.5">
                    <span class="slider-value" id="htc-shine-val">0.50</span>
                </div>
            </div>

            <div class="theme-row">
                <label for="htc-bg">THEME</label>
                <input type="color" id="htc-bg" value="#d4654e">
            </div>
        </div>
    </div>

    <div class="actions">
        <button class="btn" id="htc-pet">PET</button>
        <button class="btn" id="htc-poke">POKE</button>
        <button class="btn" id="htc-talk">TALK TO ME</button>
        <input class="talk-input" id="htc-talk-input" type="text" placeholder="say something...">
    </div>
</div>
`;

        canvas.appendChild(this._sourceEl);
        this._wireInteractions();

        this._hiddenVideo = document.createElement("video");
        this._hiddenVideo.crossOrigin = "anonymous";
        this._hiddenVideo.src = "https://dzrmwng2ae8bq.cloudfront.net/42485456/1b8d44f227cc049d0e846b9852f254fd32ea54e83f805c5d54ff07c477dfb117_source-ezgif.com-gif-to-mp4-converter.mp4";
        this._hiddenVideo.muted = true;
        this._hiddenVideo.loop = true;
        this._hiddenVideo.playsInline = true;
        this._hiddenVideo.autoplay = true;
        // Must be on-screen (not display:none) or Chrome throttles decode.
        this._hiddenVideo.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:2147483647;";
        document.body.appendChild(this._hiddenVideo);
    }

    _wireInteractions() {
        const root = this._sourceEl.querySelector("#htc-root");

        const petBtn = this._sourceEl.querySelector("#htc-pet");
        const pokeBtn = this._sourceEl.querySelector("#htc-poke");
        const talkBtn = this._sourceEl.querySelector("#htc-talk");
        const talkInput = this._sourceEl.querySelector("#htc-talk-input");

        petBtn.addEventListener("click", () => this._applyPet());
        pokeBtn.addEventListener("click", () => {
            const uv = this._lastHitUV || { u: 0.5, v: 0.85 };
            this._applyPoke(uv.u, uv.v);
        });
        const focusTalk = () => {
            talkInput.focus();
            this._talkFocused = true;
            if (!this._keyboardLocked) {
                this.lockKeyboard();
                this._keyboardLocked = true;
            }
        };
        const blurTalk = () => {
            if (!this._talkFocused) return;
            talkInput.blur();
            this._talkFocused = false;
            if (this._keyboardLocked) {
                this.unlockKeyboard();
                this._keyboardLocked = false;
            }
        };
        const closeTalk = (submit) => {
            const text = talkInput.value.trim();
            talkInput.value = "";
            talkInput.classList.remove("active");
            talkBtn.classList.remove("active");
            this._talkActive = false;
            blurTalk();
            if (submit && text) this._curtisReacts("talk");
        };

        this._focusTalk = focusTalk;
        this._blurTalk = blurTalk;

        talkBtn.addEventListener("click", () => {
            if (this._talkActive) {
                closeTalk(false);
                return;
            }
            this._talkActive = true;
            talkInput.classList.add("active");
            talkBtn.classList.add("active");
            focusTalk();
        });
        talkInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") closeTalk(true);
            else if (e.key === "Escape") closeTalk(false);
        });

        // Any click on the source that DIDN'T hit an interactive control counts
        // as poking the cloth at the raycast location.
        this._sourceEl.addEventListener("click", (e) => {
            const tag = e.target.tagName;
            if (tag === "BUTTON" || tag === "INPUT" || tag === "A" || tag === "SELECT" || tag === "TEXTAREA") return;
            const uv = this._lastHitUV;
            if (uv) this._applyPoke(uv.u, uv.v);
        });

        const mass = this._sourceEl.querySelector("#htc-mass");
        const massVal = this._sourceEl.querySelector("#htc-mass-val");
        mass.addEventListener("input", () => {
            massVal.textContent = Number(mass.value).toFixed(1);
            this.clothMass = Number(mass.value);
            this._setClothNodeMass(this.clothMass);
            this._curtisReacts("mass", { v: massVal.textContent });
        });

        const stiff = this._sourceEl.querySelector("#htc-stiff");
        const stiffVal = this._sourceEl.querySelector("#htc-stiff-val");
        stiff.addEventListener("input", () => {
            stiffVal.textContent = Number(stiff.value).toFixed(2);
            this.clothStiffness = Number(stiff.value);
            this._setClothStiffness(this.clothStiffness);
            this._curtisReacts("stiff", { v: stiffVal.textContent });
        });

        const shine = this._sourceEl.querySelector("#htc-shine");
        const shineVal = this._sourceEl.querySelector("#htc-shine-val");
        shine.addEventListener("input", () => {
            shineVal.textContent = Number(shine.value).toFixed(2);
            this.metalness = Number(shine.value);
            this.glossiness = Number(shine.value);
            if (this._material) {
                this._material.metalness = this.metalness;
                this._material.gloss = this.glossiness;
                this._material.update();
            }
            this._curtisReacts("shine", { v: shineVal.textContent });
        });

        const bg = this._sourceEl.querySelector("#htc-bg");
        bg.addEventListener("input", () => {
            root.style.setProperty("--accent", bg.value);
            this._curtisReacts("color");
        });
    }

    _findInteractiveAt(clientX, clientY) {
        if (!this._sourceEl) return null;
        const elems = this._sourceEl.querySelectorAll("button, input, a, select, textarea");
        for (const el of elems) {
            const r = el.getBoundingClientRect();
            if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
                return el;
            }
        }
        return null;
    }

    _setClothNodeMass(totalMass) {
        if (!this._clothBody || !totalMass) return;
        const nodes = this._clothBody.get_m_nodes();
        const count = nodes.size();
        if (!count) return;
        // inverse mass per node = count / total (since per-node mass = total/count)
        const im = count / totalMass;
        for (let i = 0; i < count; i++) {
            nodes.at(i).set_m_im(im);
        }
    }

    _setClothStiffness(k) {
        if (!this._clothBody) return;
        const material = this._clothBody.get_m_materials().at(0);
        material.set_m_kLST(k);
        material.set_m_kAST(k);
        // Bullet caches per-link m_c0 from material.m_kLST at link construction.
        // updateLinkConstants() recomputes that without touching rest lengths.
        if (typeof this._clothBody.updateLinkConstants === "function") {
            this._clothBody.updateLinkConstants();
        }
    }

    _updateSliderFromClient(slider, clientX) {
        const rect = slider.getBoundingClientRect();
        if (!rect.width) return;
        const min = Number(slider.min) || 0;
        const max = Number(slider.max) || 100;
        const step = Number(slider.step) || 1;
        let t = (clientX - rect.left) / rect.width;
        t = Math.max(0, Math.min(1, t));
        let v = min + t * (max - min);
        v = Math.round(v / step) * step;
        v = Math.max(min, Math.min(max, v));
        if (String(slider.value) === String(v)) return;
        slider.value = v;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
    }

    /* ── Curtis personality ───────────────────────────────── */

    _pickSpeech(key, vars = {}) {
        const pools = HtmlCloth.SPEECH;
        const pool = pools[key] || pools.idle;
        let line = pool[Math.floor(Math.random() * pool.length)];
        for (const [k, v] of Object.entries(vars)) line = line.replace(`{${k}}`, v);
        return line;
    }

    _setSpeech(text) {
        const el = this._sourceEl?.querySelector("#htc-speech");
        if (el) el.textContent = `"${text}"`;
        this._lastSpeak = this._elapsed;
    }

    _curtisReacts(key, vars) {
        this._setSpeech(this._pickSpeech(key, vars));
        this._interactionCount = (this._interactionCount || 0) + 1;
        this._updateMood();
    }

    _updateMood() {
        const moodDot = this._sourceEl?.querySelector("#htc-mood");
        const moodText = this._sourceEl?.querySelector("#htc-mood-text");
        if (!moodDot || !moodText) return;
        const c = this._interactionCount || 0;
        let label, color;
        if (c < 3) { label = "FINE"; color = "#6a8f65"; }
        else if (c < 8) { label = "TIRED"; color = "#c59c3e"; }
        else if (c < 16) { label = "ANNOYED"; color = "#d4654e"; }
        else { label = "DONE"; color = "#8e3a2e"; }
        moodText.textContent = label;
        moodDot.style.background = color;
        moodDot.style.boxShadow = `0 0 0 5px ${color}30`;
    }

    /* ── cloth physical reactions ─────────────────────────── */

    _applyPet() {
        if (!this._clothBody) return;
        const nodes = this._clothBody.get_m_nodes();
        const count = nodes.size();
        const f = new Ammo.btVector3(0, -4, -1.5);
        for (let i = 0; i < count; i++) this._clothBody.addForce(f, i);
        Ammo.destroy(f);
        this._curtisReacts("pet");
    }

    _applyPoke(u, v) {
        if (!this._clothBody) return;
        const cols = this._segmentCountX();
        const rows = this._segmentCountY();
        const nx = Math.max(0, Math.min(cols, Math.round(u * cols)));
        const ny = Math.max(0, Math.min(rows, Math.round(v * rows)));
        const centerIdx = ny * (cols + 1) + nx;

        // Push in the direction the player is looking — i.e. into the cloth.
        const cam = ArrivalSpace.getCamera?.();
        const fwd = cam?.forward ?? this.entity.forward;
        const mag = 180;

        // Apply to the hit node plus a small splash of neighbors for a ripple.
        const nodeSize = this._clothBody.get_m_nodes().size();
        const radius = 1;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const px = nx + dx;
                const py = ny + dy;
                if (px < 0 || px > cols || py < 0 || py > rows) continue;
                const idx = py * (cols + 1) + px;
                if (idx < 0 || idx >= nodeSize) continue;
                const falloff = (dx === 0 && dy === 0) ? 1 : 0.4;
                const fn = new Ammo.btVector3(fwd.x * mag * falloff, fwd.y * mag * falloff, fwd.z * mag * falloff);
                this._clothBody.addForce(fn, idx);
                Ammo.destroy(fn);
            }
        }
        this._curtisReacts("poke");
    }

    _drawVideoFrame() {
        const video = this._hiddenVideo;
        if (!video || video.readyState < 2 || !this._sourceEl) return;
        const videoCanvas = this._sourceEl.querySelector("#htc-video-canvas");
        if (!videoCanvas) return;

        // Toggle canvas.width each frame to invalidate the element's paint
        // record so texElementImage2D re-reads the bitmap.
        const baseW = video.videoWidth || 194;
        videoCanvas.width = baseW + ((this._videoTick = (this._videoTick || 0) + 1) & 1);
        videoCanvas.height = video.videoHeight || 228;

        const ctx = videoCanvas.getContext("2d");
        if (ctx) ctx.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height);
    }

    /* ── texture ──────────────────────────────────────────── */

    _createBlankTexture() {
        const device = this.app.graphicsDevice;
        const w = this.textureWidth;
        const h = this.textureHeight;

        this._texture = new pc.Texture(device, {
            width: w,
            height: h,
            format: pc.PIXELFORMAT_RGBA8,
            mipmaps: false,
            minFilter: pc.FILTER_LINEAR,
            magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE,
            addressV: pc.ADDRESS_CLAMP_TO_EDGE,
        });

        const blank = new Uint8Array(w * h * 4);
        blank.fill(255);
        this._texture._levels[0] = blank;
        this._texture.upload();
    }

    _uploadTexture() {
        if (!this._texture || !this._sourceEl) return;

        const gl = this.app.graphicsDevice.gl;
        const glTexture = this._texture.impl?._glTexture ?? this._texture.impl?.glTexture;
        if (!glTexture) return;

        gl.bindTexture(gl.TEXTURE_2D, glTexture);
        gl.texElementImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._sourceEl
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    _scheduleTextureUpload() {
        const canvas = this.app.graphicsDevice.canvas;

        this._paintHandler = () => {
            this._paintHandler = null;
            this._uploadTexture();
        };
        canvas.addEventListener("paint", this._paintHandler, { once: true });
        canvas.requestPaint();
    }

    _refreshTexture() {
        const canvas = this.app.graphicsDevice.canvas;
        if (!canvas || !this._texture) return;

        if (this._paintHandler) {
            canvas.removeEventListener("paint", this._paintHandler);
        }
        this._paintHandler = () => {
            this._paintHandler = null;
            this._uploadTexture();
        };
        canvas.addEventListener("paint", this._paintHandler, { once: true });
        canvas.requestPaint();
    }

    /* ── grid helpers ─────────────────────────────────────── */

    _localGridPoint(x, y) {
        const cols = this._segmentCountX();
        const rows = this._segmentCountY();
        const px = ((x / cols) - 0.5) * this.width;
        const py = -(y / rows) * this.height;
        return new pc.Vec3(px, py, 0);
    }

    _toWorldPoint(localPoint, out = new pc.Vec3()) {
        this._tmpMat.copy(this.entity.getWorldTransform());
        this._tmpMat.transformPoint(localPoint, out);
        return out;
    }

    _segmentCountX() {
        return Math.max(2, Math.floor(this.segmentsX));
    }

    _segmentCountY() {
        return Math.max(2, Math.floor(this.segmentsY));
    }

    /* ── teardown ─────────────────────────────────────────── */

    _teardownCurtain() {
        this._teardownInteraction();

        if (this._paintHandler) {
            const canvas = this.app.graphicsDevice.canvas;
            if (canvas) {
                canvas.removeEventListener("paint", this._paintHandler);
            }
            this._paintHandler = null;
        }

        if (this._worldLayer && this._meshInstance) {
            this._worldLayer.removeMeshInstances([this._meshInstance]);
        }

        if (this._clothBody && this._dynamicsWorld) {
            this._dynamicsWorld.removeSoftBody(this._clothBody);
            Ammo.destroy(this._clothBody);
            this._clothBody = null;
        }

        for (const anchor of this._anchorBodies) {
            this._destroyRigidBody(anchor);
        }
        this._anchorBodies = [];

        for (const proxy of this._colliderBodies) {
            this._destroyRigidBody(proxy);
        }
        this._colliderBodies = [];

        if (this._softBodyHelpers) {
            Ammo.destroy(this._softBodyHelpers);
            this._softBodyHelpers = null;
        }

        if (this._dynamicsWorld) {
            Ammo.destroy(this._dynamicsWorld);
            this._dynamicsWorld = null;
        }

        if (this._softBodySolver) {
            Ammo.destroy(this._softBodySolver);
            this._softBodySolver = null;
        }

        if (this._solver) {
            Ammo.destroy(this._solver);
            this._solver = null;
        }

        if (this._broadphase) {
            Ammo.destroy(this._broadphase);
            this._broadphase = null;
        }

        if (this._dispatcher) {
            Ammo.destroy(this._dispatcher);
            this._dispatcher = null;
        }

        if (this._collisionConfiguration) {
            Ammo.destroy(this._collisionConfiguration);
            this._collisionConfiguration = null;
        }

        if (this._worldGravity) {
            Ammo.destroy(this._worldGravity);
            this._worldGravity = null;
        }

        if (this._tmpScale) {
            Ammo.destroy(this._tmpScale);
            this._tmpScale = null;
        }

        if (this._tmpRotation) {
            Ammo.destroy(this._tmpRotation);
            this._tmpRotation = null;
        }

        if (this._tmpOrigin) {
            Ammo.destroy(this._tmpOrigin);
            this._tmpOrigin = null;
        }

        if (this._tmpTransform) {
            Ammo.destroy(this._tmpTransform);
            this._tmpTransform = null;
        }

        if (this._material) {
            this._material.destroy();
            this._material = null;
        }

        if (this._texture) {
            this._texture.destroy();
            this._texture = null;
        }

        if (this._mesh?.destroy) {
            this._mesh.destroy();
        }

        this._mesh = null;
        this._meshNode = null;
        this._meshInstance = null;
        this._positions = null;
        this._normals = null;
        this._indices = null;
        this._topEdgeLocalPoints = [];
        this._worldLayer = null;

        if (this._hiddenVideo) {
            this._hiddenVideo.pause();
            this._hiddenVideo.src = "";
            if (this._hiddenVideo.parentNode) this._hiddenVideo.parentNode.removeChild(this._hiddenVideo);
            this._hiddenVideo = null;
        }

        if (this._sourceEl?.parentNode) {
            this._sourceEl.parentNode.removeChild(this._sourceEl);
        }
        this._sourceEl = null;

        if (this._hadLayoutSubtree) {
            const canvas = this.app.graphicsDevice.canvas;
            if (canvas) {
                canvas.removeAttribute("layoutsubtree");
            }
            this._hadLayoutSubtree = false;
        }
    }

    /* ── interaction ──────────────────────────────────────── */

    _setupInteraction() {
        this._boundPointerDown = (e) => this._handlePointer(e, "mousedown");
        this._boundPointerMove = (e) => this._handlePointer(e, "mousemove");
        this._boundPointerUp = (e) => this._handlePointer(e, "mouseup");

        window.addEventListener("mousedown", this._boundPointerDown, true);
        window.addEventListener("mousemove", this._boundPointerMove, true);
        window.addEventListener("mouseup", this._boundPointerUp, true);
    }

    _teardownInteraction() {
        if (this._boundPointerDown) window.removeEventListener("mousedown", this._boundPointerDown, true);
        if (this._boundPointerMove) window.removeEventListener("mousemove", this._boundPointerMove, true);
        if (this._boundPointerUp) window.removeEventListener("mouseup", this._boundPointerUp, true);
        this._boundPointerDown = null;
        this._boundPointerMove = null;
        this._boundPointerUp = null;
        if (this._inputLocked) {
            this.unlockInput();
            this._inputLocked = false;
        }
        this._selecting = false;
        this._hoveredTarget = null;
    }

    _handlePointer(e, type) {
        if (!this._sourceEl || this._dispatching) return;

        const uv = this._raycastMeshUV(e.clientX, e.clientY);
        if (uv) this._lastHitUV = uv;

        if (!uv) {
            if (this._hoveredTarget) {
                this._sourceEl.style.pointerEvents = "auto";
                this._hoveredTarget.classList?.remove("hover");
                this._hoveredTarget.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
                this._sourceEl.style.pointerEvents = "none";
                this._hoveredTarget = null;
                this.app.graphicsDevice.canvas.style.cursor = "";
                this._refreshTexture();
            }
            if (this._inputLocked && !this._selecting && !this._talkFocused) {
                this.unlockInput();
                this._inputLocked = false;
            }
            if (type === "mouseup") {
                this._selecting = false;
                this._draggedSlider = null;
                if (this._inputLocked && !this._talkFocused) {
                    this.unlockInput();
                    this._inputLocked = false;
                }
            }
            if (type === "mousedown" && this._talkFocused) {
                this._blurTalk?.();
            }
            return;
        }

        if (!this._inputLocked) {
            this.lockInput();
            this._inputLocked = true;
        }

        const rect = this._sourceEl.getBoundingClientRect();
        const clientX = rect.left + uv.u * rect.width;
        const clientY = rect.top + uv.v * rect.height;

        this._sourceEl.style.pointerEvents = "auto";
        this._sourceEl.style.zIndex = "999999";
        this._sourceEl.style.position = "relative";

        // elementFromPoint returns null for coords outside the viewport, which
        // breaks hit-testing on a 1024x1024 source div that overflows. Use
        // per-element getBoundingClientRect instead — works regardless.
        const target = this._findInteractiveAt(clientX, clientY)
            || document.elementFromPoint(clientX, clientY)
            || this._sourceEl;

        if (target !== this._hoveredTarget) {
            if (this._hoveredTarget) {
                this._hoveredTarget.classList?.remove("hover");
                this._hoveredTarget.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
            }
            target.classList?.add("hover");
            target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
            this._hoveredTarget = target;
        }

        const canvas = this.app.graphicsDevice.canvas;
        const tag = target.tagName;
        const inputType = tag === "INPUT" ? (target.type || "").toLowerCase() : "";
        const textInputTypes = new Set(["text", "password", "email", "number", "search", "tel", "url", ""]);
        if (tag === "BUTTON" || tag === "A" || (tag === "INPUT" && !textInputTypes.has(inputType))) {
            canvas.style.cursor = "pointer";
        } else {
            canvas.style.cursor = "text";
        }

        this._dispatching = true;
        target.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true,
            clientX, clientY,
            button: e.button, buttons: e.buttons,
        }));
        this._dispatching = false;

        const interactiveTags = new Set(["BUTTON", "INPUT", "A", "SELECT", "TEXTAREA"]);
        if (type === "mousedown") {
            this.lockInput();
            this._inputLocked = true;
            this._mouseDownTarget = target;
            this._clearHighlight();
            this._selReady = false;
            this._selecting = false;

            if (target?.id === "htc-talk-input") {
                if (!this._talkFocused) this._focusTalk?.();
            } else if (this._talkFocused) {
                this._blurTalk?.();
            }

            if (target?.tagName === "INPUT" && target.type === "range") {
                this._draggedSlider = target;
                this._updateSliderFromClient(target, clientX);
            }

            if (!interactiveTags.has(tag)) {
                const range = document.caretRangeFromPoint(clientX, clientY);
                if (range && this._sourceEl.contains(range.startContainer)) {
                    this._selAnchorNode = range.startContainer;
                    this._selAnchorOffset = range.startOffset;
                    this._selReady = true;
                }
            }
        } else if (type === "mousemove" && this._draggedSlider) {
            this._updateSliderFromClient(this._draggedSlider, clientX);
        } else if (type === "mousemove" && (this._selecting || this._selReady)) {
            if (this._selReady && !this._selecting) {
                this._selecting = true;
                this._selReady = false;
            }
            this._clearHighlight();

            const range = document.caretRangeFromPoint(clientX, clientY);
            if (range && this._selAnchorNode && this._sourceEl.contains(range.startContainer)) {
                const newRange = document.createRange();
                try {
                    const cmp = this._selAnchorNode.compareDocumentPosition
                        ? this._selAnchorNode.compareDocumentPosition(range.startContainer) : 0;
                    const anchorBefore = (cmp & Node.DOCUMENT_POSITION_FOLLOWING) ||
                        (this._selAnchorNode === range.startContainer && this._selAnchorOffset <= range.startOffset);

                    if (anchorBefore) {
                        newRange.setStart(this._selAnchorNode, this._selAnchorOffset);
                        newRange.setEnd(range.startContainer, range.startOffset);
                    } else {
                        newRange.setStart(range.startContainer, range.startOffset);
                        newRange.setEnd(this._selAnchorNode, this._selAnchorOffset);
                    }
                    if (!newRange.collapsed) this._applyHighlight(newRange);
                } catch (ex) {}
            }
        } else if (type === "mouseup" && this._mouseDownTarget && !this._selecting) {
            if (!this._draggedSlider) {
                this._dispatching = true;
                target.dispatchEvent(new MouseEvent("click", {
                    bubbles: true, cancelable: true, clientX, clientY, button: e.button,
                }));
                this._dispatching = false;
            }
            this._mouseDownTarget = null;
            this._draggedSlider = null;
        } else if (type === "mouseup") {
            this._selecting = false;
            this._selReady = false;
            this._mouseDownTarget = null;
            this._draggedSlider = null;
        }

        this._sourceEl.style.pointerEvents = "none";
        this._sourceEl.style.zIndex = "";

        // While the user is typing, real clicks land on the WebGL canvas and
        // the browser blurs our text input. Re-assert focus every frame.
        if (this._talkFocused) {
            const talkInput = this._sourceEl.querySelector("#htc-talk-input");
            if (talkInput && document.activeElement !== talkInput) talkInput.focus();
        }

        this._refreshTexture();
    }

    /* ── selection highlight ──────────────────────────────── */

    _applyHighlight(range) {
        this._clearHighlight();
        const textNodes = [];
        const walker = document.createTreeWalker(
            range.commonAncestorContainer.nodeType === Node.TEXT_NODE
                ? range.commonAncestorContainer.parentNode
                : range.commonAncestorContainer,
            NodeFilter.SHOW_TEXT
        );
        let node;
        while ((node = walker.nextNode())) {
            if (range.intersectsNode(node)) textNodes.push(node);
        }
        for (const textNode of textNodes) {
            const start = textNode === range.startContainer ? range.startOffset : 0;
            const end = textNode === range.endContainer ? range.endOffset : textNode.length;
            if (start >= end) continue;
            const selectedPart = textNode.splitText(start);
            selectedPart.splitText(end - start);
            const mark = document.createElement("mark");
            mark.style.cssText = "background:#338fff;color:#fff;";
            selectedPart.parentNode.insertBefore(mark, selectedPart);
            mark.appendChild(selectedPart);
            this._highlightMarks.push(mark);
        }
    }

    _clearHighlight() {
        for (const mark of this._highlightMarks) {
            const parent = mark.parentNode;
            if (!parent) continue;
            while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
            parent.removeChild(mark);
            parent.normalize();
        }
        this._highlightMarks = [];
    }

    /* ── mesh raycasting ──────────────────────────────────── */

    _raycastMeshUV(clientX, clientY) {
        if (!this._positions || !this._indices || !this._uvs) return null;

        const camEntity = ArrivalSpace.getCamera();
        if (!camEntity?.camera) return null;

        const cvs = this.app.graphicsDevice.canvas;
        const rect = cvs.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const cam = camEntity.camera;
        const rayOrigin = cam.screenToWorld(x, y, cam.nearClip);
        const rayFar = cam.screenToWorld(x, y, cam.farClip);
        const rayDir = new pc.Vec3().sub2(rayFar, rayOrigin).normalize();

        const pos = this._positions;
        const idx = this._indices;
        const uvs = this._uvs;

        let closestT = Infinity;
        let hitU = 0, hitV = 0;

        for (let i = 0; i < idx.length; i += 3) {
            const i0 = idx[i], i1 = idx[i + 1], i2 = idx[i + 2];

            // Triangle vertices (world space — cloth writes world positions).
            const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
            const bx = pos[i1 * 3], by = pos[i1 * 3 + 1], bz = pos[i1 * 3 + 2];
            const cx = pos[i2 * 3], cy = pos[i2 * 3 + 1], cz = pos[i2 * 3 + 2];

            // Möller–Trumbore ray-triangle intersection.
            const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
            const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

            const px = rayDir.y * e2z - rayDir.z * e2y;
            const py = rayDir.z * e2x - rayDir.x * e2z;
            const pz = rayDir.x * e2y - rayDir.y * e2x;

            const det = e1x * px + e1y * py + e1z * pz;
            if (Math.abs(det) < 1e-8) continue;

            const invDet = 1 / det;
            const tx = rayOrigin.x - ax, ty = rayOrigin.y - ay, tz = rayOrigin.z - az;

            const u = (tx * px + ty * py + tz * pz) * invDet;
            if (u < 0 || u > 1) continue;

            const qx = ty * e1z - tz * e1y;
            const qy = tz * e1x - tx * e1z;
            const qz = tx * e1y - ty * e1x;

            const v = (rayDir.x * qx + rayDir.y * qy + rayDir.z * qz) * invDet;
            if (v < 0 || u + v > 1) continue;

            const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
            if (t < 0 || t >= closestT) continue;

            closestT = t;

            // Interpolate UV from barycentric coordinates.
            const w = 1 - u - v;
            const uv0u = uvs[i0 * 2], uv0v = uvs[i0 * 2 + 1];
            const uv1u = uvs[i1 * 2], uv1v = uvs[i1 * 2 + 1];
            const uv2u = uvs[i2 * 2], uv2v = uvs[i2 * 2 + 1];

            hitU = w * uv0u + u * uv1u + v * uv2u;
            hitV = w * uv0v + u * uv1v + v * uv2v;
        }

        if (closestT === Infinity) return null;
        return { u: hitU, v: hitV };
    }

    _destroyRigidBody(proxy) {
        if (this._dynamicsWorld && proxy.body) {
            this._dynamicsWorld.removeRigidBody(proxy.body);
        }

        if (proxy.body) {
            Ammo.destroy(proxy.body);
        }

        if (proxy.info) {
            Ammo.destroy(proxy.info);
        }

        if (proxy.inertia) {
            Ammo.destroy(proxy.inertia);
        }

        if (proxy.motionState) {
            Ammo.destroy(proxy.motionState);
        }

        if (proxy.transform) {
            Ammo.destroy(proxy.transform);
        }

        if (proxy.shape) {
            Ammo.destroy(proxy.shape);
        }
    }
}
