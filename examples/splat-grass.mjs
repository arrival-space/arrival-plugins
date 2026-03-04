/**
 * Procedural Splats - Grass
 *
 * Uses full GSplatData so each blade can be anisotropic: thin across, tall in
 * the local up direction, with a slight random lean. This produces elongated
 * blades instead of spherical blobs.
 */
const SH_C0 = 0.28209479177387814;
const CENTER_COLLISION_TAG = "procedural-grass-center-collision";

export class ProceduralSplatsGrass extends ArrivalScript {
    static scriptName = "Splat Grass";

    splatCount = 100000;
    planeSize = { x: 10, y:0, z: 10 };
    grassHeight = 0.07;
    widthScale = 0.22;
    angleVariation = 0.5;
    positionJitter = 1;
    useSpawnRaycast = true;
    raycastHeight = 1;
    raycastDepth = 12;
    overlapScale = 1;
    alpha = 0.38;
    baseColor = { r: 0.058, g: 0.16, b: 0.039 };
    tipColor = { r: 0.3960, g: 0.6117, b: 0.1058 };

    static properties = {
        splatCount: { title: "Splat Count", min: 1, max: 200000 },
        planeSize: { title: "Plane Size", min: 0.05, max: 100 },
        grassHeight: { title: "Grass Height", min: 0.02, max: 4 },
        widthScale: { title: "Blade Width", min: 0.05, max: 1 },
        angleVariation: { title: "Angle Variation", min: 0, max: 1 },
        positionJitter: { title: "Position Jitter", min: 0, max: 1 },
        useSpawnRaycast: { title: "Use Spawn Raycast" },
        raycastHeight: { title: "Raycast Height", min: 0.1, max: 100 },
        raycastDepth: { title: "Raycast Depth", min: 0.1, max: 200 },
        overlapScale: { title: "Overlap Scale", min: 0.25, max: 3 },
        alpha: { title: "Alpha", min: 0, max: 1 },
        baseColor: { title: "Base Color", min: 0, max: 1 },
        tipColor: { title: "Tip Color", min: 0, max: 1 },
    };

    _splatEntity = null;
    _gsplatData = null;
    _gsplatResource = null;
    _gsplatAsset = null;
    _raycastLocalFrom = new pc.Vec3();
    _raycastLocalTo = new pc.Vec3();
    _raycastWorldFrom = new pc.Vec3();
    _raycastWorldTo = new pc.Vec3();
    _raycastHitLocal = new pc.Vec3();
    _raycastInvWorld = new pc.Mat4();
    _centerCollisionEntity = null;
    _spawnReady = false;
    _pendingRebuild = false;
    _waitingForLoadingScreen = false;

    initialize() {
        if (!pc.GSplatData || !pc.GSplatResource || !pc.GSplatInstance) {
            console.error("Procedural Splats Grass: GSplatData runtime API is not available.");
            return;
        }

        if (this.app.loadTracker?.loadingSpace) {
            this._pendingRebuild = true;
            this._waitingForLoadingScreen = true;
            this.app.once("hideLoadingScreen", this._onSpaceReady, this);
            return;
        }

        this._spawnReady = true;
        this._rebuild();
    }

    _rebuild() {
        this._destroySplatEntity();

        const layout = this._buildLayout(Math.max(1, Math.floor(this.splatCount)));
        const data = this._createStorage(layout.numSplats);
        this._writeGrass(layout, data);

        this._gsplatData = this._createGSplatData(layout.numSplats, data);
        this._gsplatResource = new pc.GSplatResource(this.app.graphicsDevice, this._gsplatData);
        this._gsplatAsset = new pc.Asset("procedural-grass", "gsplat", null);
        this.app.assets.add(this._gsplatAsset);
        this._gsplatAsset.resource = this._gsplatResource;

        this._splatEntity = new pc.Entity("ProceduralSplatsGrass");
        this._splatEntity.addComponent("gsplat", {
            asset: this._gsplatAsset,
            unified: true,
        });
        this.entity.addChild(this._splatEntity);

        const gsplat = this._splatEntity.gsplat;

        const splatLayer = this.app.scene.layers.getLayerByName("Splats");
        if (splatLayer) {
            gsplat.layers = [splatLayer.id];
        }
    }

    _buildLayout(targetSplats) {
        const size = this._getPlaneSize();
        const area = Math.max(size.x * size.z, 0.000001);
        const idealSpacing = Math.sqrt(area / targetSplats);
        let spacingMin = 0.0001;
        let spacingMax = Math.max(size.x, size.z) + idealSpacing;

        for (let i = 0; i < 24; i++) {
            const mid = (spacingMin + spacingMax) * 0.5;
            const counts = this._countsForSpacing(size, mid);
            const count = counts.x * counts.z;

            if (count > targetSplats) {
                spacingMin = mid;
            } else {
                spacingMax = mid;
            }
        }

        const counts = this._countsForSpacing(size, spacingMax);

        return {
            size,
            spacing: spacingMax,
            counts,
            numSplats: counts.x * counts.z,
        };
    }

    _countsForSpacing(size, spacing) {
        return {
            x: Math.max(1, Math.floor(size.x / spacing) + 1),
            z: Math.max(1, Math.floor(size.z / spacing) + 1),
        };
    }

    _createStorage(count) {
        const data = {
            x: new Float32Array(count),
            y: new Float32Array(count),
            z: new Float32Array(count),
            f_dc_0: new Float32Array(count),
            f_dc_1: new Float32Array(count),
            f_dc_2: new Float32Array(count),
            opacity: new Float32Array(count),
            scale_0: new Float32Array(count),
            scale_1: new Float32Array(count),
            scale_2: new Float32Array(count),
            rot_0: new Float32Array(count),
            rot_1: new Float32Array(count),
            rot_2: new Float32Array(count),
            rot_3: new Float32Array(count),
        };

        data.rot_0.fill(1);
        return data;
    }

    _writeGrass(layout, data) {
        const spacing = layout.spacing;
        const grassHeight = Math.max(0.02, this.grassHeight);
        const overlap = Math.max(0.01, this.overlapScale);
        const widthScale = Math.max(0.02, this.widthScale);
        const angleVariation = this._clamp01(this.angleVariation);
        const positionJitter = this._clamp01(this.positionJitter);
        const useSpawnRaycast = !!this.useSpawnRaycast && !!this.app.systems.rigidbody;
        const baseRadius = layout.numSplats > 1 ? spacing * 0.5 : Math.min(layout.size.x, layout.size.z) * 0.5;
        const bladeWidth = Math.max(0.002, baseRadius * widthScale * overlap);
        const jitterRange = spacing * 0.5 * positionJitter;

        if (useSpawnRaycast) {
            this._raycastInvWorld.copy(this.entity.getWorldTransform()).invert();
            this._centerCollisionEntity = this._findCenterCollisionEntity();
            this._prepareCenterCollisionTags(this._centerCollisionEntity);
        }

        let i = 0;
        for (let z = 0; z < layout.counts.z; z++) {
            for (let x = 0; x < layout.counts.x; x++) {
                const noise = this._hash2(x, z);
                const px =
                    this._axisPosition(x, layout.counts.x, spacing, layout.size.x) +
                    (this._hash2(x + 53, z + 19) * 2 - 1) * jitterRange;
                const pz =
                    this._axisPosition(z, layout.counts.z, spacing, layout.size.z) +
                    (this._hash2(x + 71, z + 37) * 2 - 1) * jitterRange;
                const height = Math.max(bladeWidth * 2, grassHeight * (0.55 + noise * 0.75) * overlap);
                const groundY = useSpawnRaycast ? this._raycastGroundY(px, pz) : 0;
                const lift = groundY + height * 0.45;
                const tipBlend = this._clamp01(0.2 + noise * 0.8);
                const leanX = (this._hash2(x + 17, z + 3) - 0.5) * 2;
                const leanZ = (this._hash2(x + 29, z + 11) - 0.5) * 2;
                const leanAmount = angleVariation * (0.08 + this._hash2(x + 41, z + 23) * 0.28);

                data.x[i] = px;
                data.y[i] = lift;
                data.z[i] = pz;

                data.scale_0[i] = Math.log(bladeWidth);
                data.scale_1[i] = Math.log(height);
                data.scale_2[i] = Math.log(bladeWidth * 0.6);

                const colorR = this._mix(this.baseColor.r, this.tipColor.r, tipBlend);
                const colorG = this._mix(this.baseColor.g, this.tipColor.g, tipBlend);
                const colorB = this._mix(this.baseColor.b, this.tipColor.b, tipBlend);

                data.f_dc_0[i] = (this._clamp01(colorR) - 0.5) / SH_C0;
                data.f_dc_1[i] = (this._clamp01(colorG) - 0.5) / SH_C0;
                data.f_dc_2[i] = (this._clamp01(colorB) - 0.5) / SH_C0;
                data.opacity[i] = this._alphaToOpacity(this._clamp01(this.alpha * (0.85 + noise * 0.15)));

                this._writeLeanRotation(data, i, leanX, leanZ, leanAmount);
                i++;
            }
        }
    }

    _raycastGroundY(localX, localZ) {
        this._raycastLocalFrom.set(localX, this.raycastHeight, localZ);
        this._raycastLocalTo.set(localX, -this.raycastDepth, localZ);

        this.entity.getWorldTransform().transformPoint(this._raycastLocalFrom, this._raycastWorldFrom);
        this.entity.getWorldTransform().transformPoint(this._raycastLocalTo, this._raycastWorldTo);

        const hit = this.app.systems.rigidbody.raycastFirst(this._raycastWorldFrom, this._raycastWorldTo, {
            filterTags: [CENTER_COLLISION_TAG],
        });
        if (!hit) {
            return 0;
        }

        this._raycastInvWorld.transformPoint(hit.point, this._raycastHitLocal);
        return this._raycastHitLocal.y;
    }

    _findCenterCollisionEntity() {
        const local = this.entity.findByName("CenterCollisionMesh");
        if (local?.script?.centerCollisionMesh) {
            return local;
        }

        const global = this.app.root.findByName("CenterCollisionMesh");
        if (global?.script?.centerCollisionMesh) {
            return global;
        }

        return null;
    }

    _prepareCenterCollisionTags(centerCollisionEntity) {
        if (!centerCollisionEntity) {
            return;
        }

        const colliders = centerCollisionEntity.find("name", "GLBColliderEntity");
        for (const collider of colliders) {
            if (!collider.tags.has(CENTER_COLLISION_TAG)) {
                collider.tags.add(CENTER_COLLISION_TAG);
            }
        }
    }

    _onSpaceReady() {
        this._waitingForLoadingScreen = false;
        this._spawnReady = true;

        if (this._pendingRebuild || !this._gsplatResource) {
            this._pendingRebuild = false;
            this._rebuild();
        }
    }

    _writeLeanRotation(data, index, leanX, leanZ, leanAmount) {
        const axis = new pc.Vec3(-leanZ, 0, leanX);
        if (axis.lengthSq() < 0.000001) {
            data.rot_0[index] = 1;
            data.rot_1[index] = 0;
            data.rot_2[index] = 0;
            data.rot_3[index] = 0;
            return;
        }

        axis.normalize();
        const quat = new pc.Quat().setFromAxisAngle(axis, leanAmount * 180);
        data.rot_0[index] = quat.w;
        data.rot_1[index] = quat.x;
        data.rot_2[index] = quat.y;
        data.rot_3[index] = quat.z;
    }

    _createGSplatData(count, data) {
        const properties = [
            "x",
            "y",
            "z",
            "f_dc_0",
            "f_dc_1",
            "f_dc_2",
            "opacity",
            "scale_0",
            "scale_1",
            "scale_2",
            "rot_0",
            "rot_1",
            "rot_2",
            "rot_3",
        ].map((name) => ({
            name,
            type: "float",
            byteSize: 4,
            storage: data[name],
        }));

        return new pc.GSplatData([
            {
                name: "vertex",
                count,
                properties,
            },
        ]);
    }

    _axisPosition(index, count, spacing, axisSize) {
        if (count <= 1) {
            return 0;
        }

        const usedSpan = (count - 1) * spacing;
        const start = -usedSpan * 0.5;
        const slack = axisSize - usedSpan;
        return start + index * spacing + slack * 0.5;
    }

    _getPlaneSize() {
        return {
            x: Math.max(0.05, this.planeSize.x),
            z: Math.max(0.05, this.planeSize.z),
        };
    }

    _hash2(x, z) {
        const value = Math.sin((x + 1) * 12.9898 + (z + 1) * 78.233) * 43758.5453123;
        return value - Math.floor(value);
    }

    _mix(a, b, t) {
        return a + (b - a) * t;
    }

    _alphaToOpacity(alpha) {
        const a = this._clamp01(alpha);
        if (a <= 0) {
            return -40;
        }
        if (a >= 1) {
            return 40;
        }
        return -Math.log(1 / a - 1);
    }

    _clamp01(value) {
        return Math.min(1, Math.max(0, value));
    }

    _destroySplatEntity() {
        if (this._splatEntity) {
            this._splatEntity.destroy();
            this._splatEntity = null;
        }

        if (this._gsplatAsset) {
            this._gsplatAsset.resource = null;
            this._gsplatAsset.unload();
            this.app.assets.remove(this._gsplatAsset);
            this._gsplatAsset = null;
        }

        if (this._gsplatResource) {
            this._gsplatResource.destroy();
            this._gsplatResource = null;
        }

        this._gsplatData = null;
    }

    onPropertyChanged() {
        if (!pc.GSplatData || !pc.GSplatResource || !pc.GSplatInstance) {
            return;
        }

        if (!this._spawnReady) {
            this._pendingRebuild = true;
            return;
        }

        this._rebuild();
    }

    onEntityMoved() {
        if (!pc.GSplatData || !pc.GSplatResource || !pc.GSplatInstance) {
            return;
        }

        if (!this._spawnReady) {
            this._pendingRebuild = true;
            return;
        }

        this._rebuild();
    }

    destroy() {
        if (this._waitingForLoadingScreen) {
            this.app.off("hideLoadingScreen", this._onSpaceReady, this);
            this._waitingForLoadingScreen = false;
        }

        this._destroySplatEntity();
    }
}
