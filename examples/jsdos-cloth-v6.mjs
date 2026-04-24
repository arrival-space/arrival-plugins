/**
 * JsdosClothV6 — a playable DOOM screen rendered onto a soft-body cloth.
 *
 * Uses the same Ammo soft-body cloth from HtmlCloth, but samples the js-dos
 * emulator canvas directly as a PlayCanvas texture (no texElementImage2D,
 * no layoutsubtree, no Chromium flag). js-dos lives in a nearly-transparent
 * host pinned to the page corner so Chrome keeps painting it; each frame we
 * drawImage() its canvas into an off-screen mirror and upload that mirror as
 * the cloth's diffuse texture.
 *
 * Click the cloth to engage: player input + keyboard are locked and key
 * events are forwarded to the emulator. Press Escape (or click away) to
 * disengage.
 */
export class JsdosClothV6 extends ArrivalScript {
    static scriptName = "JsdosClothV6";

    // Minimal KeyboardEvent.code → { key, keyCode } lookup for the common
    // keys the virtual gamepad can map to. Extend if you need more.
    static _KEY_MAP = {
        ArrowLeft:   { key: "ArrowLeft",  keyCode: 37 },
        ArrowUp:     { key: "ArrowUp",    keyCode: 38 },
        ArrowRight:  { key: "ArrowRight", keyCode: 39 },
        ArrowDown:   { key: "ArrowDown",  keyCode: 40 },
        Space:       { key: " ",          keyCode: 32 },
        Enter:       { key: "Enter",      keyCode: 13 },
        Escape:      { key: "Escape",     keyCode: 27 },
        ShiftLeft:   { key: "Shift",      keyCode: 16 },
        ShiftRight:  { key: "Shift",      keyCode: 16 },
        ControlLeft: { key: "Control",    keyCode: 17 },
        ControlRight:{ key: "Control",    keyCode: 17 },
        AltLeft:     { key: "Alt",        keyCode: 18 },
        AltRight:    { key: "Alt",        keyCode: 18 },
        Tab:         { key: "Tab",        keyCode: 9 },
    };

    width = 2.6;
    height = 2.0;
    segmentsX = 20;
    segmentsY = 16;
    clothMass = 1.2;
    clothDamping = 0.04;
    clothFriction = 0.8;
    clothStiffness = 0.9;
    gravity = 9.8;
    collisionMargin = 0.04;
    colliderDistance = 100;
    physicsHz = 120;
    physicsSubSteps = 8;
    metalness = 0.0;
    glossiness = 0.25;
    debugFreeze = false;
    playerProxyHeight = 2.4;
    playerProxyWidth = 0.2;
    textureWidth = 1024;
    textureHeight = 768;

    doomJQueryUrl = "https://code.jquery.com/jquery-3.7.1.min.js";
    doomApiUrl = "https://js-dos.com/cdn/js-dos-api.js";
    doomBundleUrl = "https://js-dos.com/cdn/upload/DOOM-@evilution.zip";
    doomCommand = "DOOM/DOOM.EXE";

    // ── Virtual gamepad (touch on cloth → game keys) ──
    // Comma-separated KeyboardEvent.code list; all listed keys fire (in
    // order) on a short tap. "Enter,KeyS" covers both DOOM's start-game
    // menu confirm (Enter) and fire/forward (S). Single-key works too:
    // "ControlLeft".
    tapKey = "Enter,KeyS,KeyW";
    // Comma-separated codes fired on long-press (no drag).
    longPressKey = "Enter";
    dragKeyLeft = "ArrowLeft";
    dragKeyRight = "ArrowRight";
    dragKeyUp = "ArrowUp";
    dragKeyDown = "ArrowDown";
    dragThresholdPx = 30;
    tapTimeMs = 250;
    longPressMs = 500;
    // When true, a tap also dispatches a real mouse click (mousedown/up/click)
    // on the emulator canvas at the mapped UV. DOSBox v6 + DOOM don't react
    // to synthetic mouse events, so default off. Enable for point-and-click
    // DOS games or Windows-style UIs where it might take.
    tapAsMouseClick = false;

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
        doomJQueryUrl: { title: "jQuery URL" },
        doomApiUrl: { title: "js-dos API URL" },
        doomBundleUrl: { title: "Game Bundle URL" },
        doomCommand: { title: "DOS Command" },
        tapKey: { title: "Tap Key (code)" },
        longPressKey: { title: "Long-Press Key (code)" },
        dragKeyLeft: { title: "Drag Left (code)" },
        dragKeyRight: { title: "Drag Right (code)" },
        dragKeyUp: { title: "Drag Up (code)" },
        dragKeyDown: { title: "Drag Down (code)" },
        dragThresholdPx: { title: "Drag Threshold (px)", min: 4, max: 200, step: 1 },
        tapTimeMs: { title: "Tap Max Duration (ms)", min: 50, max: 1000, step: 10 },
        longPressMs: { title: "Long-Press Min Duration (ms)", min: 100, max: 2000, step: 10 },
        tapAsMouseClick: { title: "Tap = Mouse Click" },
    };

    _worldLayer = null;
    _mesh = null;
    _meshNode = null;
    _meshInstance = null;
    _material = null;
    _texture = null;

    _hostEl = null;
    _doomCanvas = null;
    _mirrorCanvas = null;
    _mirrorCtx = null;
    _doomInstance = null;
    _doomStarted = false;
    _bootWatchdog = null;
    _status = "initializing…";
    _substatus = "";

    _positions = null;
    _normals = null;
    _uvs = null;
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
    _tmpRayOrigin = new pc.Vec3();
    _tmpRayFar = new pc.Vec3();
    _tmpRayDir = new pc.Vec3();

    _elapsed = 0;
    _boundPointerDown = null;
    _boundPointerMove = null;
    _boundPointerUp = null;
    _boundKeyDown = null;
    _boundKeyUp = null;
    _inputLocked = false;
    _keyboardLocked = false;
    _engaged = false;
    _hoveredTarget = null;
    _dispatching = false;
    _lastHitUV = null;

    // Virtual gamepad state (tap→fire, drag→arrow key).
    _pointerActive = false;
    _pointerStartX = 0;
    _pointerStartY = 0;
    _pointerStartTime = 0;
    _pointerDragged = false;
    _heldDragKey = null;

    _gridEntity = null;
    _gridPrevEnabled = null;

    initialize() {
        
        if (this.app.loadTracker?.loadingSpace) {
            this.app.once("hideLoadingScreen", this._buildCurtain.bind(this));
        } else {
            this._buildCurtain();
        }
    }

    update(dt) {
        if (!this._clothBody || !this._dynamicsWorld || !dt) return;

        // Reconcile player-proxy colliders once a second so remote players
        // who join/leave mid-session start/stop bumping the cloth.
        this._reconcileAccumulator = (this._reconcileAccumulator || 0) + dt;
        if (this._reconcileAccumulator >= 1.0) {
            this._reconcileAccumulator = 0;
            this._reconcileColliders();
        }

        this._syncAnchorBodies();
        this._syncColliderBodies();

        if (!this.debugFreeze) {
            const fixedStep = 1 / this.physicsHz;
            const clampedDt = Math.min(dt, this.physicsSubSteps * fixedStep);
            this._dynamicsWorld.stepSimulation(clampedDt, this.physicsSubSteps, fixedStep);
        }

        this._updateRenderMesh();
        this._elapsed += dt;
        this._paintFrame();
    }

    onPropertyChanged(name) {
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
        if (this._inputLocked) { this.unlockInput(); this._inputLocked = false; }
        if (this._keyboardLocked) { this.unlockKeyboard(); this._keyboardLocked = false; }
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

    _log(...args) { console.log("[JsdosClothV6]", ...args); }

    /* ── build ────────────────────────────────────────────── */

    _buildCurtain() {
        if (typeof Ammo === "undefined") {
            console.warn("[JsdosClothV6] Ammo is required for cloth simulation.");
            return;
        }

        this._worldLayer = this.app.scene.layers.getLayerByName("World");
        this._createPhysicsWorld();
        this._createRenderMesh();
        this._createClothBody();
        this._createAnchorBodies();
        this._createNearbyColliders();
        this._updateRenderMesh();

        this._createMirrorCanvas();
        this._createTexture();
        this._material.diffuseMap = this._texture;
        this._material.update();
        this._drawStatusScreen();
        this._uploadTexture();

        this._createHost();
        this._setupInteraction();
        this._loadJsDos();
    }

    _createMirrorCanvas() {
        const c = document.createElement("canvas");
        c.width = this.textureWidth;
        c.height = this.textureHeight;
        this._mirrorCanvas = c;
        this._mirrorCtx = c.getContext("2d");
    }

    _createTexture() {
        const device = this.app.graphicsDevice;
        this._texture = new pc.Texture(device, {
            format: pc.PIXELFORMAT_RGBA8,
            mipmaps: false,
            minFilter: pc.FILTER_LINEAR,
            magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE,
            addressV: pc.ADDRESS_CLAMP_TO_EDGE,
        });
        this._texture.setSource(this._mirrorCanvas);
    }

    _uploadTexture() {
        if (!this._texture || !this._mirrorCanvas) return;
        // Do NOT call setSource here — that re-allocates the GPU texture
        // every frame (classic WebGL perf trap). setSource was called once
        // in _createTexture; upload() re-reads the canvas pixels.
        this._texture.upload();
    }

    _createHost() {
        // js-dos needs its canvas painted, which Chrome only does for
        // on-screen elements. Park it in the corner, full bundle size so
        // getBoundingClientRect() gives Emscripten/SDL usable mouse coords,
        // nearly-transparent so the user doesn't see it.
        this._hostEl = document.createElement("div");
        this._hostEl.style.cssText = [
            "position:fixed",
            "right:0",
            "bottom:0",
            "width:640px",
            "height:400px",
            "opacity:0.01",
            "pointer-events:none",
            "z-index:2147483647",
            "transform:translateZ(0)",
        ].join(";");
        document.body.appendChild(this._hostEl);
    }

    /* ── status screen (2D canvas → texture) ──────────────── */

    _drawStatusScreen() {
        const ctx = this._mirrorCtx;
        const w = this._mirrorCanvas.width;
        const h = this._mirrorCanvas.height;

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);

        const grd = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, w * 0.55);
        grd.addColorStop(0, "rgba(212,101,78,0.4)");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = "#d4654e";
        ctx.font = "bold 160px sans-serif";
        ctx.fillText("DOOM", w / 2, h * 0.34);

        ctx.fillStyle = "#f4ead9";
        ctx.font = "36px ui-monospace, Menlo, monospace";
        ctx.fillText(this._status, w / 2, h * 0.56);

        if (this._substatus) {
            ctx.font = "22px ui-monospace, Menlo, monospace";
            ctx.fillStyle = "rgba(244,234,217,0.6)";
            ctx.fillText(this._substatus, w / 2, h * 0.63);
        }

        ctx.fillStyle = "rgba(244,234,217,0.55)";
        ctx.font = "24px sans-serif";
        ctx.fillText("click the cloth to play", w / 2, h * 0.78);
    }

    _setStatus(text) {
        this._status = text;
        this._log("status:", text);
        if (!this._doomStarted && this._mirrorCtx) {
            this._drawStatusScreen();
            this._uploadTexture();
        }
    }

    _setSubstatus(text) {
        this._substatus = text;
        if (!this._doomStarted && this._mirrorCtx) {
            this._drawStatusScreen();
            this._uploadTexture();
        }
    }

    /* ── physics ──────────────────────────────────────────── */

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
            this._softBodySolver,
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
                if (y === 0) this._topEdgeLocalPoints.push(this._localGridPoint(x, 0));

                const uvIndex = vertexIndex * 2;
                this._uvs[uvIndex] = x / cols;
                this._uvs[uvIndex + 1] = y / rows;

                if (x === cols || y === rows) continue;

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
        this._material.emissive = new pc.Color(0.05, 0.04, 0.03);
        this._material.emissiveIntensity = 0.4;
        this._material.metalness = this.metalness;
        this._material.gloss = this.glossiness;
        this._material.update();

        this._meshNode = new pc.GraphNode("JsdosClothV6Curtain");
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
            c00, c01, c10, c11,
            this._segmentCountX() + 1,
            this._segmentCountY() + 1,
            0,
            true,
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
            worldPoint.z += Math.random() * 0.01 - 0.005;
            worldPoint.x += Math.random() * 0.01 - 0.005;
            const anchor = this._createStaticBoxBody(worldPoint, 0.015);
            this._anchorBodies.push(anchor);
            this._clothBody.appendAnchor(i, anchor.body, true, 1);
        }
    }

    _isPlayerLike(entity) {
        if (!entity) return false;
        // Local player: CharacterController entity or script.
        if (entity.name === "CharacterController") return true;
        if (entity.script?.characterController) return true;
        // Remote players: NetworkManager stamps entity.userID at spawn.
        if (entity.userID !== undefined && entity.userID !== null) return true;
        return false;
    }

    _createNearbyColliders() {
        // Initial population — reconcile from empty to current scene state.
        this._reconcileColliders();
    }

    _reconcileColliders() {
        if (!this._dynamicsWorld) return;

        const center = this.entity.getPosition();
        const maxDistanceSq = this.colliderDistance * this.colliderDistance;
        const collisionComponents = this.app.root.findComponents("collision");

        // Walk the scene once, build the set of entities that *should* have
        // a proxy right now.
        const wanted = new Set();
        for (const collision of collisionComponents) {
            if (!collision?.entity || collision.entity === this.entity) continue;
            if (!collision.enabled) continue;
            if (!collision?.entity?.rigidbody || !collision?.entity.enabled) continue;
            if (!this._isPlayerLike(collision.entity)) continue;

            const pos = collision.entity.getPosition();
            const dx = pos.x - center.x;
            const dy = pos.y - center.y;
            const dz = pos.z - center.z;
            if ((dx * dx) + (dy * dy) + (dz * dz) > maxDistanceSq) continue;

            wanted.add(collision.entity);
        }

        // Remove proxies whose entity has been destroyed, moved out of range,
        // or had its collision/rigidbody disabled.
        const kept = [];
        for (const proxy of this._colliderBodies) {
            if (wanted.has(proxy.entity)) {
                wanted.delete(proxy.entity);
                kept.push(proxy);
            } else {
                this._destroyRigidBody(proxy);
            }
        }
        this._colliderBodies = kept;

        // Add proxies for new entities (local player on first pass, plus any
        // remote players who joined since the last reconcile).
        for (const entity of wanted) {
            const proxy = this._createColliderProxyForEntity(entity);
            if (proxy) this._colliderBodies.push(proxy);
        }
    }

    _createColliderProxyForEntity(entity) {
        const shape = new Ammo.btCapsuleShape(this.playerProxyWidth, this.playerProxyHeight);
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

        const proxy = { body, entity, shape, transform, motionState, info, inertia, usesScale: false };
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

        return { body, shape, transform, motionState, info, inertia };
    }

    _syncAnchorBodies() {
        for (let i = 0; i < this._anchorBodies.length; i++) {
            const worldPoint = this._toWorldPoint(this._topEdgeLocalPoints[i], this._tmpPoint);
            this._setBodyTransform(this._anchorBodies[i].body, worldPoint, pc.Quat.IDENTITY);
        }
    }

    _syncColliderBodies() {
        for (const proxy of this._colliderBodies) this._syncRigidBody(proxy);
    }

    _syncRigidBody(proxy) {
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
        if (motionState) motionState.setWorldTransform(this._tmpTransform);
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
            const ax = this._positions[ia], ay = this._positions[ia + 1], az = this._positions[ia + 2];
            const bx = this._positions[ib], by = this._positions[ib + 1], bz = this._positions[ib + 2];
            const cx = this._positions[ic], cy = this._positions[ic + 1], cz = this._positions[ic + 2];
            const abx = bx - ax, aby = by - ay, abz = bz - az;
            const acx = cx - ax, acy = cy - ay, acz = cz - az;
            const nx = (aby * acz) - (abz * acy);
            const ny = (abz * acx) - (abx * acz);
            const nz = (abx * acy) - (aby * acx);
            this._normals[ia] += nx; this._normals[ia + 1] += ny; this._normals[ia + 2] += nz;
            this._normals[ib] += nx; this._normals[ib + 1] += ny; this._normals[ib + 2] += nz;
            this._normals[ic] += nx; this._normals[ic + 1] += ny; this._normals[ic + 2] += nz;
        }
        for (let i = 0; i < this._normals.length; i += 3) {
            const nx = this._normals[i], ny = this._normals[i + 1], nz = this._normals[i + 2];
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

    _segmentCountX() { return Math.max(2, Math.floor(this.segmentsX)); }
    _segmentCountY() { return Math.max(2, Math.floor(this.segmentsY)); }

    /* ── js-dos loader ────────────────────────────────────── */

    _loadJsDos() {
        const ensureJQuery = (next) => {
            if (typeof window.$ !== "undefined" && typeof window.jQuery !== "undefined") {
                next();
                return;
            }
            this._loadScriptOnce(this.doomJQueryUrl, "dc-jquery", "loading jQuery…", () => {
                if (typeof window.$ === "undefined") {
                    console.warn("[JsdosClothV6] jQuery did not define $ after load:", this.doomJQueryUrl);
                    this._setStatus("jQuery missing");
                    return;
                }
                next();
            });
        };
        const ensureDosbox = () => {
            if (typeof Dosbox !== "undefined") {
                this._startDoom();
                return;
            }
            this._loadScriptOnce(this.doomApiUrl, "dc-api", "loading js-dos…", () => this._startDoom());
        };
        ensureJQuery(ensureDosbox);
    }

    _loadScriptOnce(src, flag, status, onReady) {
        const existing = document.querySelector(`script[data-dc-flag="${flag}"]`);
        if (existing) {
            if (existing.dataset.dcLoaded === "1") {
                this._log(`script already loaded: ${src}`);
                onReady();
            } else {
                this._log(`script loading (reusing tag): ${src}`);
                existing.addEventListener("load", onReady, { once: true });
                existing.addEventListener("error", () => this._setStatus(`failed: ${src}`), { once: true });
            }
            return;
        }
        this._setStatus(status);
        this._log(`loading ${src}`);
        const t0 = performance.now();
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.dataset.dcFlag = flag;
        script.onload = () => {
            script.dataset.dcLoaded = "1";
            this._log(`loaded ${src} in ${Math.round(performance.now() - t0)}ms`);
            onReady();
        };
        script.onerror = (ev) => {
            console.warn("[JsdosClothV6] failed to load", src, ev);
            this._setStatus(`failed: ${src}`);
        };
        document.head.appendChild(script);
    }

    _startDoom() {
        if (!this._hostEl || this._doomInstance) return;
        if (typeof Dosbox === "undefined") {
            this._setStatus("js-dos not available");
            return;
        }

        const hostId = `dc-host-${Math.random().toString(36).slice(2, 10)}`;
        this._hostEl.id = hostId;

        this._log("Dosbox present, constructing instance. host id:", hostId);
        this._setStatus("booting DOOM…");
        this._setSubstatus(`bundle: ${this.doomBundleUrl}`);
        this._installTitleGuard();

        try {
            this._doomInstance = new Dosbox({
                id: hostId,
                onload: (dosbox) => {
                    this._log("Dosbox onload fired — calling run()");
                    this._setStatus("fetching bundle…");
                    try {
                        dosbox.run(this.doomBundleUrl, this.doomCommand);
                    } catch (err) {
                        console.warn("[JsdosClothV6] dosbox.run threw:", err);
                        this._setStatus("run() failed — see console");
                    }
                },
                onrun: (dosbox, app) => {
                    this._log("Dosbox onrun fired. app:", app);
                    this._doomStarted = true;
                    this._adoptEmulatorCanvas();
                    this._removeBootKick();
                },
                onerror: (err) => {
                    console.warn("[JsdosClothV6] Dosbox onerror:", err);
                    this._setStatus("emulator error");
                    this._setSubstatus(String(err?.message || err || "unknown"));
                },
            });
            this._log("Dosbox instance created:", this._doomInstance);
            this._startBootWatchdog();
            this._installBootKick();
        } catch (err) {
            console.warn("[JsdosClothV6] failed to start Dosbox:", err);
            this._setStatus("boot failed");
            this._setSubstatus(String(err?.message || err));
        }
    }

    _installBootKick() {
        // iOS Safari only accepts splash-click dispatches that happen
        // synchronously inside a real user gesture. If the first tap after
        // boot lands OFF the cloth, _engage() doesn't run and the splash
        // never gets kicked — boot times out. This one-shot listener
        // catches *any* first gesture and kicks the splash from there.
        if (this._bootKick) return;
        const kick = (e) => {
            if (this._dispatching) return;
            if (this._doomStarted) { this._removeBootKick(); return; }
            this._log("boot kick fired:", e.type, "target:", e.target?.tagName);
            // Detach ALL kick listeners BEFORE dispatching so:
            //  - our own synthetic mouse events can't re-enter this handler
            //  - subsequent gestures (game input, UI clicks) don't pile up
            //    extra dispatches that choke the main thread
            // If this single kick doesn't boot DOSBox, the user's next tap
            // on the cloth will retry via the normal _engage path.
            this._removeBootKick();
            this._kickJsDosSplash();
        };
        this._bootKick = kick;
        window.addEventListener("touchstart", kick, { capture: true, passive: true });
        window.addEventListener("mousedown", kick, true);
        window.addEventListener("pointerdown", kick, true);
        window.addEventListener("keydown", kick, true);
    }

    _removeBootKick() {
        if (!this._bootKick) return;
        const kick = this._bootKick;
        window.removeEventListener("touchstart", kick, true);
        window.removeEventListener("mousedown", kick, true);
        window.removeEventListener("pointerdown", kick, true);
        window.removeEventListener("keydown", kick, true);
        this._bootKick = null;
    }

    _adoptEmulatorCanvas() {
        if (!this._hostEl) return;
        const candidates = this._hostEl.querySelectorAll("canvas");
        this._log("adoptEmulatorCanvas: found", candidates.length, "canvas(es)");
        let best = null;
        let bestArea = 0;
        for (const c of candidates) {
            this._log("  candidate:", c.width, "x", c.height, "class:", c.className);
            const area = (c.width || 0) * (c.height || 0);
            if (area > bestArea) { best = c; bestArea = area; }
        }
        this._doomCanvas = best || candidates[0] || null;
        if (this._doomCanvas) {
            this._log("adopted canvas:", this._doomCanvas.width, "x", this._doomCanvas.height);
        } else {
            this._log("no canvas in host yet");
        }
    }

    _startBootWatchdog() {
        if (this._bootWatchdog) clearInterval(this._bootWatchdog);
        let ticks = 0;
        this._bootWatchdog = setInterval(() => {
            ticks++;
            if (!this._hostEl) {
                clearInterval(this._bootWatchdog);
                this._bootWatchdog = null;
                return;
            }
            const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className ? "." + String(el.className).split(" ").join(".") : ""}`;
            const descendants = Array.from(this._hostEl.querySelectorAll("*")).map(describe);
            this._log(`watchdog t=${ticks}s descendants: [${descendants.join(", ")}]`);

            if (!this._doomCanvas || !this._doomCanvas.width) this._adoptEmulatorCanvas();

            if (this._doomStarted && this._doomCanvas?.width) {
                clearInterval(this._bootWatchdog);
                this._bootWatchdog = null;
                this._log("watchdog: emulator is running, stopping watchdog");
                return;
            }

            if (ticks >= 30) {
                clearInterval(this._bootWatchdog);
                this._bootWatchdog = null;
                this._log("watchdog: giving up after 30s");
                if (!this._doomStarted) {
                    this._setStatus("boot timeout");
                    this._setSubstatus("emulator never fired onrun — check network/CORS");
                }
            }
        }, 1000);
    }

    /* ── frame paint ──────────────────────────────────────── */

    _paintFrame() {
        if (!this._mirrorCtx || !this._texture) return;

        if (!this._doomStarted || !this._doomCanvas || !this._doomCanvas.width) {
            // Still on the status screen — nothing to draw per-frame.
            return;
        }

        // Keep the mirror canvas at its original size (textureWidth x
        // textureHeight). Resizing mid-session leaves the allocated GL
        // texture at the old size and only updates the top-left, which on
        // some drivers (notably Firefox) shows DOOM in a corner of the cloth.
        const mw = this._mirrorCanvas.width;
        const mh = this._mirrorCanvas.height;

        // Stretch DOOM to fill the whole mirror. DOOM's 640x400 (1.6:1) was
        // designed to be displayed at 4:3 on a CRT — pixels weren't square —
        // so stretching to the cloth's aspect matches the original look
        // rather than distorting it.
        try {
            // Pixelated upscale keeps DOOM crisp rather than blurry.
            this._mirrorCtx.imageSmoothingEnabled = false;
            this._mirrorCtx.drawImage(this._doomCanvas, 0, 0, mw, mh);
            if (!this._firstFrameLogged) {
                this._firstFrameLogged = true;
                this._log("first DOOM frame drawn, stretched to", mw, "x", mh);
            }
        } catch (err) {
            if (!this._drawErrorLogged) {
                this._drawErrorLogged = true;
                console.warn("[JsdosClothV6] drawImage failed:", err);
            }
            return;
        }
        this._uploadTexture();
    }

    /* ── teardown ─────────────────────────────────────────── */

    _teardownCurtain() {
        this._teardownInteraction();
        this._disengage();
        this._removeBootKick();

        if (this._bootWatchdog) {
            clearInterval(this._bootWatchdog);
            this._bootWatchdog = null;
        }

        if (this._worldLayer && this._meshInstance) {
            this._worldLayer.removeMeshInstances([this._meshInstance]);
        }

        if (this._clothBody && this._dynamicsWorld) {
            this._dynamicsWorld.removeSoftBody(this._clothBody);
            Ammo.destroy(this._clothBody);
            this._clothBody = null;
        }

        for (const anchor of this._anchorBodies) this._destroyRigidBody(anchor);
        this._anchorBodies = [];

        for (const proxy of this._colliderBodies) this._destroyRigidBody(proxy);
        this._colliderBodies = [];

        if (this._softBodyHelpers) { Ammo.destroy(this._softBodyHelpers); this._softBodyHelpers = null; }
        if (this._dynamicsWorld) { Ammo.destroy(this._dynamicsWorld); this._dynamicsWorld = null; }
        if (this._softBodySolver) { Ammo.destroy(this._softBodySolver); this._softBodySolver = null; }
        if (this._solver) { Ammo.destroy(this._solver); this._solver = null; }
        if (this._broadphase) { Ammo.destroy(this._broadphase); this._broadphase = null; }
        if (this._dispatcher) { Ammo.destroy(this._dispatcher); this._dispatcher = null; }
        if (this._collisionConfiguration) { Ammo.destroy(this._collisionConfiguration); this._collisionConfiguration = null; }
        if (this._worldGravity) { Ammo.destroy(this._worldGravity); this._worldGravity = null; }
        if (this._tmpScale) { Ammo.destroy(this._tmpScale); this._tmpScale = null; }
        if (this._tmpRotation) { Ammo.destroy(this._tmpRotation); this._tmpRotation = null; }
        if (this._tmpOrigin) { Ammo.destroy(this._tmpOrigin); this._tmpOrigin = null; }
        if (this._tmpTransform) { Ammo.destroy(this._tmpTransform); this._tmpTransform = null; }

        if (this._material) { this._material.destroy(); this._material = null; }
        if (this._texture) { this._texture.destroy(); this._texture = null; }
        if (this._mesh?.destroy) this._mesh.destroy();

        this._mesh = null;
        this._meshNode = null;
        this._meshInstance = null;
        this._positions = null;
        this._normals = null;
        this._indices = null;
        this._topEdgeLocalPoints = [];
        this._worldLayer = null;

        this._shutdownDosbox();
        this._removeTitleGuard();
        this._doomInstance = null;
        this._doomCanvas = null;
        this._doomStarted = false;
        this._firstFrameLogged = false;
        this._drawErrorLogged = false;

        if (this._hostEl?.parentNode) this._hostEl.parentNode.removeChild(this._hostEl);
        this._hostEl = null;
        this._mirrorCanvas = null;
        this._mirrorCtx = null;

        this._log("teardown complete");
    }

    _installTitleGuard() {
        if (this._titleObserver) return;
        this._originalTitle = document.title;
        const titleEl = document.querySelector("title");
        if (!titleEl) return;
        // DOSBox (via Emscripten SDL_WM_SetCaption) rewrites document.title
        // to "DOSBox SVN …" on boot. Snap it back to whatever the host
        // page had before we loaded.
        this._titleObserver = new MutationObserver(() => {
            if (document.title !== this._originalTitle) {
                document.title = this._originalTitle;
            }
        });
        this._titleObserver.observe(titleEl, {
            childList: true,
            characterData: true,
            subtree: true,
        });
    }

    _removeTitleGuard() {
        if (this._titleObserver) {
            this._titleObserver.disconnect();
            this._titleObserver = null;
        }
        if (this._originalTitle != null) {
            document.title = this._originalTitle;
            this._originalTitle = null;
        }
    }

    _shutdownDosbox() {
        const inst = this._doomInstance;
        if (!inst) return;

        // js-dos v6 has no public stop API, but builds vary — try the
        // shutdown-adjacent methods we've seen in the wild. None of these
        // exist on every build; we call whatever we find.
        const tried = [];
        const tryCall = (obj, key) => {
            try {
                if (obj && typeof obj[key] === "function") {
                    obj[key]();
                    tried.push(key);
                }
            } catch (err) {
                this._log(`shutdown: ${key}() threw`, err?.message || err);
            }
        };

        tryCall(inst, "exit");
        tryCall(inst, "stop");
        tryCall(inst, "quit");
        tryCall(inst.ui, "close");
        tryCall(inst.ui, "destroy");
        tryCall(inst.module, "exit");
        tryCall(inst.module, "_abort");
        tryCall(inst.module, "abort");

        // Try to terminate any Emscripten workers hanging off the module.
        try {
            const workers = inst.module?.PThread?.runningWorkers;
            if (Array.isArray(workers)) {
                for (const w of workers) {
                    try { w.terminate?.(); } catch {}
                }
                if (workers.length) tried.push(`terminate(${workers.length} workers)`);
            }
        } catch {}

        // Mop up any stray dosbox-class nodes outside our host that some v6
        // builds append to document.body (fullscreen overlay etc.).
        const strays = document.querySelectorAll(
            "body > .dosbox-container, body > .dosbox-overlay, body > .dosbox-fullscreen",
        );
        for (const el of strays) el.remove();
        if (strays.length) tried.push(`removed ${strays.length} stray nodes`);

        this._log("shutdownDosbox: tried", tried.join(", ") || "(nothing took)");
    }

    _destroyRigidBody(proxy) {
        if (this._dynamicsWorld && proxy.body) this._dynamicsWorld.removeRigidBody(proxy.body);
        if (proxy.body) Ammo.destroy(proxy.body);
        if (proxy.info) Ammo.destroy(proxy.info);
        if (proxy.motionState) Ammo.destroy(proxy.motionState);
        if (proxy.shape) Ammo.destroy(proxy.shape);
        if (proxy.inertia) Ammo.destroy(proxy.inertia);
    }

    /* ── interaction ──────────────────────────────────────── */

    _setupInteraction() {
        // Pointer events unify mouse + touch + pen and fire continuously
        // during drag (unlike mouse events, which mobile browsers only
        // synthesize after a completed tap). Listener shape is identical —
        // clientX/Y, button/buttons — so _handlePointer doesn't care.
        this._boundPointerDown = (e) => {
            if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen" && e.pointerType !== "touch") return;
            this._activePointerId = e.pointerId;
            this._handlePointer(e, "mousedown");
        };
        this._boundPointerMove = (e) => {
            // Only follow the gesture's original pointer — prevents a second
            // finger from hijacking the drag.
            if (this._pointerActive && this._activePointerId !== undefined && e.pointerId !== this._activePointerId) return;
            this._handlePointer(e, "mousemove");
        };
        this._boundPointerUp = (e) => {
            if (this._pointerActive && this._activePointerId !== undefined && e.pointerId !== this._activePointerId) return;
            this._activePointerId = undefined;
            this._handlePointer(e, "mouseup");
        };
        this._boundKeyDown = (e) => this._handleKey(e, "keydown");
        this._boundKeyUp = (e) => this._handleKey(e, "keyup");

        window.addEventListener("pointerdown", this._boundPointerDown, true);
        window.addEventListener("pointermove", this._boundPointerMove, true);
        window.addEventListener("pointerup", this._boundPointerUp, true);
        window.addEventListener("pointercancel", this._boundPointerUp, true);
        window.addEventListener("keydown", this._boundKeyDown, true);
        window.addEventListener("keyup", this._boundKeyUp, true);
    }

    _teardownInteraction() {
        if (this._boundPointerDown) window.removeEventListener("pointerdown", this._boundPointerDown, true);
        if (this._boundPointerMove) window.removeEventListener("pointermove", this._boundPointerMove, true);
        if (this._boundPointerUp) {
            window.removeEventListener("pointerup", this._boundPointerUp, true);
            window.removeEventListener("pointercancel", this._boundPointerUp, true);
        }
        if (this._boundKeyDown) window.removeEventListener("keydown", this._boundKeyDown, true);
        if (this._boundKeyUp) window.removeEventListener("keyup", this._boundKeyUp, true);
        this._boundPointerDown = null;
        this._boundPointerMove = null;
        this._boundPointerUp = null;
        this._boundKeyDown = null;
        this._boundKeyUp = null;
        this._activePointerId = undefined;
    }

    _handlePointer(e, type) {
        if (!this._hostEl || this._dispatching) return;

        // While a virtual-gamepad drag is active, skip the raycast and
        // process the gesture purely from clientX/Y delta.
        if (this._pointerActive && (type === "mousemove" || type === "mouseup")) {
            this._handleGamepadGesture(e, type);
            return;
        }

        // Skip raycasting mousemoves while disengaged — cosmetic hover only.
        if (type === "mousemove" && !this._engaged) return;

        const uv = this._raycastMeshUV(e.clientX, e.clientY);
        if (uv) this._lastHitUV = uv;

        if (!uv) {
            if (this._hoveredTarget) {
                this.app.graphicsDevice.canvas.style.cursor = "";
                this._hoveredTarget = null;
            }
            if (type === "mousedown" && this._engaged) this._disengage();
            return;
        }

        if (!this._hoveredTarget) {
            this.app.graphicsDevice.canvas.style.cursor = this._engaged ? "crosshair" : "pointer";
            this._hoveredTarget = this._hostEl;
        }

        if (type === "mousedown") {
            if (!this._engaged) {
                this._engage();
                return;
            }
            this._pointerActive = true;
            this._pointerStartX = e.clientX;
            this._pointerStartY = e.clientY;
            this._pointerStartTime = performance.now();
            this._pointerDragged = false;
            // Freeze the raycast UV at gesture start so a tap-as-mouse-click
            // resolves to the pixel the user actually touched, not wherever
            // the cloth drifted to by the time they lift their finger.
            this._pointerStartUV = this._lastHitUV ? { u: uv.u, v: uv.v } : null;
            this._releaseHeldDragKey();
        }
    }

    _handleGamepadGesture(e, type) {
        if (type === "mousemove") {
            const dx = e.clientX - this._pointerStartX;
            const dy = e.clientY - this._pointerStartY;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            const threshold = this.dragThresholdPx;
            if (absDx < threshold && absDy < threshold) return;

            this._pointerDragged = true;
            let codeProp;
            if (absDx > absDy) {
                codeProp = dx > 0 ? this.dragKeyRight : this.dragKeyLeft;
            } else {
                codeProp = dy > 0 ? this.dragKeyDown : this.dragKeyUp;
            }
            const next = this._resolveKey(codeProp);
            if (!next) return;
            if (this._heldDragKey?.code !== next.code) {
                this._releaseHeldDragKey();
                this._dispatchKey("keydown", next);
                this._heldDragKey = next;
            }
            return;
        }

        // mouseup → end the gesture.
        this._pointerActive = false;
        const duration = performance.now() - this._pointerStartTime;
        this._releaseHeldDragKey();
        if (this._pointerDragged) return;

        const isTap = duration <= this.tapTimeMs;
        const isLongPress = duration >= this.longPressMs;

        // Tap-as-mouse-click path: for point-and-click DOS games, dispatch
        // real mouse events at the stored UV. Independent of the key path
        // below, so you can have tap = fire AND tap = click simultaneously.
        if (isTap && this.tapAsMouseClick) {
            if (!this._pointerStartUV) {
                this._log("tapAsMouseClick: skipped — no startUV captured");
            } else if (!this._doomCanvas) {
                this._log("tapAsMouseClick: skipped — no _doomCanvas yet");
            } else if (!this._doomStarted) {
                this._log("tapAsMouseClick: skipped — _doomStarted is false");
            } else {
                const rect = this._doomCanvas.getBoundingClientRect();
                const clientX = rect.left + this._pointerStartUV.u * rect.width;
                const clientY = rect.top + this._pointerStartUV.v * rect.height;
                this._log(
                    "tapAsMouseClick: firing at uv",
                    this._pointerStartUV.u.toFixed(3), this._pointerStartUV.v.toFixed(3),
                    "→ client", Math.round(clientX), Math.round(clientY),
                    "| canvas", this._doomCanvas.width, "x", this._doomCanvas.height,
                    "| rect", Math.round(rect.left), Math.round(rect.top),
                    Math.round(rect.width), "x", Math.round(rect.height),
                );
                this._forwardPointerToDoom(this._pointerStartUV, e, "mousedown");
                setTimeout(() => {
                    if (!this._doomStarted) return;
                    this._forwardPointerToDoom(this._pointerStartUV, e, "mouseup");
                    // Some DOS UIs wait for the synthesized click after up.
                    this._dispatching = true;
                    const rect2 = this._doomCanvas.getBoundingClientRect();
                    const cx = rect2.left + this._pointerStartUV.u * rect2.width;
                    const cy = rect2.top + this._pointerStartUV.v * rect2.height;
                    this._log("tapAsMouseClick: dispatching click after mouseup");
                    this._doomCanvas.dispatchEvent(new MouseEvent("click", {
                        bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0,
                    }));
                    this._dispatching = false;
                }, 40);
            }
        }

        let codeList = null;
        if (isTap) codeList = this.tapKey;
        else if (isLongPress) codeList = this.longPressKey;
        if (!codeList) return;

        // Parse "Enter,KeyS" → [Enter, KeyS]. Fire each in sequence, each
        // with its own delayed keyup so DOSBox registers the press. They
        // fire staggered so a game that polls key state between ticks
        // doesn't see them as a single frame event.
        const codes = String(codeList).split(",").map((s) => s.trim()).filter(Boolean);
        codes.forEach((code, i) => {
            const info = this._resolveKey(code);
            if (!info) return;
            const keydownDelay = i * 30;
            setTimeout(() => {
                if (!this._doomStarted) return;
                this._dispatchKey("keydown", info);
                setTimeout(() => {
                    if (this._doomStarted) this._dispatchKey("keyup", info);
                }, 60);
            }, keydownDelay);
        });
    }

    _releaseHeldDragKey() {
        if (!this._heldDragKey) return;
        this._dispatchKey("keyup", this._heldDragKey);
        this._heldDragKey = null;
    }

    _dispatchKey(type, info) {
        if (!this._doomCanvas) return;
        this._dispatching = true;
        const init = {
            bubbles: true,
            cancelable: true,
            key: info.key,
            code: info.code,
            keyCode: info.keyCode,
            which: info.keyCode,
            repeat: false,
        };
        this._doomCanvas.dispatchEvent(new KeyboardEvent(type, init));
        window.dispatchEvent(new KeyboardEvent(type, init));
        this._dispatching = false;
    }

    _resolveKey(code) {
        if (!code) return null;
        const map = JsdosClothV6._KEY_MAP;
        if (map[code]) return { code, ...map[code] };
        const keyLetter = code.match(/^Key([A-Z])$/);
        if (keyLetter) return { code, key: keyLetter[1].toLowerCase(), keyCode: keyLetter[1].charCodeAt(0) };
        const digit = code.match(/^Digit(\d)$/);
        if (digit) return { code, key: digit[1], keyCode: digit[1].charCodeAt(0) };
        return { code, key: code, keyCode: code.charCodeAt(0) };
    }

    _forwardPointerToDoom(uv, sourceEvent, type) {
        const c = this._doomCanvas;
        if (!c) {
            this._log("forwardPointerToDoom: skipped — no _doomCanvas");
            return;
        }
        const rect = c.getBoundingClientRect();
        const clientX = rect.left + uv.u * rect.width;
        const clientY = rect.top + uv.v * rect.height;
        this._log(
            "forwardPointerToDoom:", type,
            "client", Math.round(clientX), Math.round(clientY),
            "button", sourceEvent?.button ?? 0,
            "target", c.tagName + (c.className ? "." + c.className : ""),
        );

        this._dispatching = true;
        c.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            button: sourceEvent?.button ?? 0,
            buttons: sourceEvent?.buttons ?? 1,
        }));
        this._dispatching = false;
    }

    _handleKey(e, type) {
        if (!this._engaged) return;

        if (type === "keydown" && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this._disengage();
            return;
        }

        if (this._dispatching) return;
        if (!this._doomCanvas) return;

        e.preventDefault();
        e.stopPropagation();

        this._dispatching = true;
        const init = {
            bubbles: true,
            cancelable: true,
            key: e.key,
            code: e.code,
            keyCode: e.keyCode,
            which: e.which,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
            repeat: e.repeat,
        };
        this._doomCanvas.dispatchEvent(new KeyboardEvent(type, init));
        window.dispatchEvent(new KeyboardEvent(type, init));
        this._dispatching = false;
    }

    _engage() {
        if (this._engaged) return;
        this._engaged = true;
        if (!this._inputLocked) { this.lockInput(); this._inputLocked = true; }
        if (!this._keyboardLocked) { this.lockKeyboard(); this._keyboardLocked = true; }
        this.app.graphicsDevice.canvas.style.cursor = "crosshair";

        // Kick the js-dos splash if it's still showing — this call happens
        // inside the real user click handler, so user activation carries over.
        if (!this._doomStarted) this._kickJsDosSplash();
    }

    _disengage() {
        if (!this._engaged) return;
        this._engaged = false;
        this._pointerActive = false;
        this._releaseHeldDragKey();
        if (this._inputLocked) { this.unlockInput(); this._inputLocked = false; }
        if (this._keyboardLocked) { this.unlockKeyboard(); this._keyboardLocked = false; }
        this.app.graphicsDevice.canvas.style.cursor = "";
        this._hoveredTarget = null;
    }

    _kickJsDosSplash() {
        if (!this._hostEl) return;
        const candidates = [
            this._hostEl.querySelector(".dosbox-start"),
            this._hostEl.querySelector(".dosbox-overlay"),
            this._hostEl.querySelector(".dosbox-container"),
        ].filter(Boolean);

        if (!candidates.length) {
            this._log("kickJsDosSplash: no splash targets found yet");
            return;
        }

        this._log("kickJsDosSplash: dispatching click to", candidates.map((el) => el.className).join(", "));
        this._dispatching = true;
        for (const el of candidates) {
            const r = el.getBoundingClientRect();
            const init = {
                bubbles: true, cancelable: true,
                clientX: r.left + r.width / 2,
                clientY: r.top + r.height / 2,
                button: 0, buttons: 1,
            };
            el.dispatchEvent(new MouseEvent("mousedown", init));
            el.dispatchEvent(new MouseEvent("mouseup", init));
            el.dispatchEvent(new MouseEvent("click", init));
        }
        this._dispatching = false;
    }

    /* ── mesh raycasting (Möller–Trumbore) ────────────────── */

    _raycastMeshUV(clientX, clientY) {
        if (!this._positions || !this._indices || !this._uvs) return null;

        const camEntity = ArrivalSpace.getCamera?.();
        if (!camEntity?.camera) return null;

        const cvs = this.app.graphicsDevice.canvas;
        const rect = cvs.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const cam = camEntity.camera;
        const rayOrigin = cam.screenToWorld(x, y, cam.nearClip, this._tmpRayOrigin);
        const rayFar = cam.screenToWorld(x, y, cam.farClip, this._tmpRayFar);
        const rayDir = this._tmpRayDir.sub2(rayFar, rayOrigin).normalize();

        const pos = this._positions;
        const idx = this._indices;
        const uvs = this._uvs;

        let closestT = Infinity;
        let hitU = 0, hitV = 0;

        for (let i = 0; i < idx.length; i += 3) {
            const i0 = idx[i], i1 = idx[i + 1], i2 = idx[i + 2];
            const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
            const bx = pos[i1 * 3], by = pos[i1 * 3 + 1], bz = pos[i1 * 3 + 2];
            const cx = pos[i2 * 3], cy = pos[i2 * 3 + 1], cz = pos[i2 * 3 + 2];
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
}
