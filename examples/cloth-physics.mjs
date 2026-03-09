export class ClothPhysics extends ArrivalScript {
    static scriptName = "ClothPhysics";

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
    debugFreeze = false;
    clothColor = "#ffffff";
    textureUrl = "https://dzrmwng2ae8bq.cloudfront.net/42485456/85f65e96ba99d068545356a3470a78b02e6fd2f7fb6c86091ea88d4844f69970_fabric_curtain_diffuse_red.jpg";
    normalMapUrl = "https://dzrmwng2ae8bq.cloudfront.net/42485456/df95540322f699e36486696c83c15e2557e47ff643f93ef53e00f2b727d61062_fabric_curtain_normal.jpg";
    specularMapUrl = "https://dzrmwng2ae8bq.cloudfront.net/42485456/bae7e06285ee7142545a5a879b120ae211cdfc350ec0c885e1e0defcbc2be012_fabric_curtain_metallic.jpg";
    metalness = 1;
    playerProxyHeight = 2.4;
    playerProxyWidth = 0.2;

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
        debugFreeze: { title: "Debug Freeze" },
        clothColor: { title: "Cloth Color" },
        textureUrl: { title: "Texture", editor: "asset" },
        normalMapUrl: { title: "Normal Map", editor: "asset" },
        specularMapUrl: { title: "Specular Map", editor: "asset" },
        metalness: { title: "Metalness", min: 0, max: 1, step: 0.05 },
        playerProxyHeight: { title: "Player Proxy Height", min: 0.5, max: 3, step: 0.05 },
        playerProxyWidth: { title: "Player Proxy Width", min: 0.01, max: 2, step: 0.05 }
    };

    _worldLayer = null;
    _mesh = null;
    _meshNode = null;
    _meshInstance = null;
    _material = null;
    _loadedTexture = null;
    _loadedTextureAsset = null;
    _currentTextureUrl = "";
    _isLoadingTexture = false;
    _loadedNormalMap = null;
    _loadedNormalMapAsset = null;
    _currentNormalMapUrl = "";
    _isLoadingNormalMap = false;
    _loadedSpecularMap = null;
    _loadedSpecularMapAsset = null;
    _currentSpecularMapUrl = "";
    _isLoadingSpecularMap = false;
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

    initialize() {

        if (this.app.loadTracker?.loadingSpace) {
            this.app.once("hideLoadingScreen", this._buildCurtain.bind(this));
        } else {
            this._buildCurtain();
        }
    }

    update(dt) {
        if (!this._clothBody || !this._dynamicsWorld || !dt) {
            return;
        }

        this._syncAnchorBodies();
        this._syncColliderBodies();

        const stepDt = Math.min(dt, 1 / 20);
        const steps = Math.max(1, Math.min(4, Math.ceil(stepDt * 60)));

        if (!this.debugFreeze) 
            this._dynamicsWorld.stepSimulation(stepDt, steps, stepDt / steps);

        this._updateRenderMesh();
    }

    onPropertyChanged(name, value) {
        if (name === "clothColor") {
            this._applyMaterialColor(value);
            return;
        }

        if (name === "metalness") {
            this._applyMetalness(value);
            return;
        }

        if (name === "textureUrl") {
            if (value) {
                this._loadTexture(value);
            } else {
                this._disposeLoadedTexture();
                this._applyTexture(null);
            }
            return;
        }

        if (name === "normalMapUrl") {
            if (value) {
                this._loadNormalMap(value);
            } else {
                this._disposeLoadedNormalMap();
                this._applyNormalMap(null);
            }
            return;
        }

        if (name === "specularMapUrl") {
            if (value) {
                this._loadSpecularMap(value);
            } else {
                this._disposeLoadedSpecularMap();
                this._applySpecularMap(null);
            }
            return;
        }

        this._teardownCurtain();
        this._buildCurtain();
    }

    destroy() {
        this._teardownCurtain();
        this._disposeLoadedTexture();
        this._disposeLoadedNormalMap();
        this._disposeLoadedSpecularMap();
    }

    _buildCurtain() {
        if (typeof Ammo === "undefined") {
            console.warn("[ClothPhysics] Ammo is required for cloth simulation.");
            return;
        }

        this._worldLayer = this.app.scene.layers.getLayerByName("World");
        this._createPhysicsWorld();
        this._createRenderMesh();
        this._createClothBody();
        this._createAnchorBodies();
        this._createNearbyColliders();
        this._updateRenderMesh();

        if (this.textureUrl) {
            this._loadTexture(this.textureUrl);
        } else {
            this._applyTexture(this._loadedTexture);
        }

        if (this.normalMapUrl) {
            this._loadNormalMap(this.normalMapUrl);
        } else {
            this._applyNormalMap(this._loadedNormalMap);
        }

        if (this.specularMapUrl) {
            this._loadSpecularMap(this.specularMapUrl);
        } else {
            this._applySpecularMap(this._loadedSpecularMap);
        }
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
                this._uvs[uvIndex + 1] = 1 - (y / rows);

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
        this._material.shininess = 8;
        this._material.bumpiness = 1;
        this._material.gloss = 1;
        this._material.glossMapChannel = "r";
        this._material.opacityMapChannel = "a";
        this._material.alphaTest = 0.05;
        this._applyMaterialColor(this.clothColor);
        this._applyMetalness(this.metalness);
        this._applyTexture(this._loadedTexture);
        this._applyNormalMap(this._loadedNormalMap);
        this._applySpecularMap(this._loadedSpecularMap);

        this._meshNode = new pc.GraphNode("ClothPhysicsCurtain");
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

        this._setBodyTransform(proxy.body, proxy.entity.getPosition(), proxy.entity.getRotation());
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

    _applyMaterialColor(hex) {
        if (!this._material) {
            return;
        }

        const rgb = this._hexToRgb(hex);
        this._material.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
        this._material.emissive = new pc.Color(0, 0, 0);
        this._material.specular = new pc.Color(0.5, 0.5, 0.5);
        this._material.opacity = 1;
        this._material.update();
    }

    async _loadTexture(url) {
        if (!url || this._isLoadingTexture) {
            return;
        }

        if (url === this._currentTextureUrl && this._loadedTexture) {
            this._applyTexture(this._loadedTexture);
            return;
        }

        this._isLoadingTexture = true;

        try {
            this._disposeLoadedTexture();

            const { texture, asset } = await ArrivalSpace.loadTexture(url, {
                mipmaps: true,
                anisotropy: 4
            });

            this._loadedTexture = texture;
            this._loadedTextureAsset = asset;
            this._currentTextureUrl = url;
            this._loadedTexture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
            this._loadedTexture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
            this._applyTexture(texture);
        } catch (error) {
            console.error("[ClothPhysics] Failed to load texture:", error);
            this._currentTextureUrl = "";
            this._applyTexture(null);
        }

        this._isLoadingTexture = false;
    }

    async _loadNormalMap(url) {
        if (!url || this._isLoadingNormalMap) {
            return;
        }

        if (url === this._currentNormalMapUrl && this._loadedNormalMap) {
            this._applyNormalMap(this._loadedNormalMap);
            return;
        }

        this._isLoadingNormalMap = true;

        try {
            this._disposeLoadedNormalMap();

            const { texture, asset } = await ArrivalSpace.loadTexture(url, {
                mipmaps: true,
                anisotropy: 4
            });

            this._loadedNormalMap = texture;
            this._loadedNormalMapAsset = asset;
            this._currentNormalMapUrl = url;
            this._loadedNormalMap.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
            this._loadedNormalMap.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
            this._applyNormalMap(texture);
        } catch (error) {
            console.error("[ClothPhysics] Failed to load normal map:", error);
            this._currentNormalMapUrl = "";
            this._applyNormalMap(null);
        }

        this._isLoadingNormalMap = false;
    }

    async _loadSpecularMap(url) {
        if (!url || this._isLoadingSpecularMap) {
            return;
        }

        if (url === this._currentSpecularMapUrl && this._loadedSpecularMap) {
            this._applySpecularMap(this._loadedSpecularMap);
            return;
        }

        this._isLoadingSpecularMap = true;

        try {
            this._disposeLoadedSpecularMap();

            const { texture, asset } = await ArrivalSpace.loadTexture(url, {
                mipmaps: true,
                anisotropy: 4
            });

            this._loadedSpecularMap = texture;
            this._loadedSpecularMapAsset = asset;
            this._currentSpecularMapUrl = url;
            this._loadedSpecularMap.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
            this._loadedSpecularMap.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
            this._applySpecularMap(texture);
        } catch (error) {
            console.error("[ClothPhysics] Failed to load specular map:", error);
            this._currentSpecularMapUrl = "";
            this._applySpecularMap(null);
        }

        this._isLoadingSpecularMap = false;
    }

    _applyTexture(texture) {
        if (!this._material) {
            return;
        }

        this._material.diffuseMap = texture || null;
        this._material.opacityMap = texture || null;
        this._material.update();
    }

    _applyNormalMap(texture) {
        if (!this._material) {
            return;
        }

        this._material.normalMap = texture || null;
        this._material.update();
    }

    _applyMetalness(value) {
        if (!this._material) {
            return;
        }

        this._material.metalness = value;
        this._material.update();
    }

    _applySpecularMap(texture) {
        if (!this._material) {
            return;
        }

        this._material.glossMap = texture || null;
        this._material.update();
    }

    _disposeLoadedTexture() {
        if (this._loadedTextureAsset) {
            this.app.assets.remove(this._loadedTextureAsset);
            this._loadedTextureAsset.unload();
            this._loadedTextureAsset = null;
        }

        this._loadedTexture = null;
        this._currentTextureUrl = "";
    }

    _disposeLoadedNormalMap() {
        if (this._loadedNormalMapAsset) {
            this.app.assets.remove(this._loadedNormalMapAsset);
            this._loadedNormalMapAsset.unload();
            this._loadedNormalMapAsset = null;
        }

        this._loadedNormalMap = null;
        this._currentNormalMapUrl = "";
    }

    _disposeLoadedSpecularMap() {
        if (this._loadedSpecularMapAsset) {
            this.app.assets.remove(this._loadedSpecularMapAsset);
            this._loadedSpecularMapAsset.unload();
            this._loadedSpecularMapAsset = null;
        }

        this._loadedSpecularMap = null;
        this._currentSpecularMapUrl = "";
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

    _hexToRgb(hex) {
        const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!match) {
            return { r: 0.84, g: 0.78, b: 0.67 };
        }

        return {
            r: parseInt(match[1], 16) / 255,
            g: parseInt(match[2], 16) / 255,
            b: parseInt(match[3], 16) / 255
        };
    }

    _teardownCurtain() {
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
