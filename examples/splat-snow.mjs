/**
 * Procedural Splats - Snow
 *
 * Covers the center collision with flattened GSplat snow clumps. Each splat is
 * wider than it is tall, so the result reads like soft packed snow instead of
 * round spheres or tall grass blades.
 */
const SH_C0 = 0.28209479177387814;
const SH_C1 = 0.4886025119029199;
const CENTER_COLLISION_TAG = "procedural-snow-center-collision";

export class ProceduralSplatsSnow extends ArrivalScript {
    static scriptName = "Splat Snow";

    splatCount = 12000;
    planeSize = { x: 8, y: 0, z: 8 };
    snowWidth = 0.16;
    snowHeight = 0.055;
    footprintVariation = 0.45;
    heightVariation = 0.35;
    positionJitter = 1;
    useSpawnRaycast = true;
    raycastHeight = 0.35;
    raycastDepth = 24;
    overlapScale = 1;
    alpha = 0.42;
    normalLightingStrength = 1.6;
    useStageDirectionalLight = true;
    lightDirection = { x: 0.2, y: -1, z: 0.15 };
    baseColor = { r: 0.92, g: 0.95, b: 1.0 };
    shadeColor = { r: 0.76, g: 0.82, b: 0.92 };

    static properties = {
        splatCount: { title: "Splat Count", min: 1, max: 200000 },
        planeSize: { title: "Coverage Size", min: 0.05, max: 100 },
        snowWidth: { title: "Snow Width", min: 0.02, max: 2 },
        snowHeight: { title: "Snow Height", min: 0.01, max: 0.5 },
        footprintVariation: { title: "Footprint Variation", min: 0, max: 1 },
        heightVariation: { title: "Height Variation", min: 0, max: 1 },
        positionJitter: { title: "Position Jitter", min: 0, max: 1 },
        useSpawnRaycast: { title: "Use Spawn Raycast" },
        raycastHeight: { title: "Raycast Height", min: 0.1, max: 100 },
        raycastDepth: { title: "Raycast Depth", min: 0.1, max: 200 },
        overlapScale: { title: "Overlap Scale", min: 0.25, max: 3 },
        alpha: { title: "Alpha", min: 0, max: 1 },
        normalLightingStrength: { title: "Normal Light Strength", min: 0, max: 4 },
        useStageDirectionalLight: { title: "Use Stage Directional" },
        lightDirection: { title: "Fallback Light Dir", min: -1, max: 1 },
        baseColor: { title: "Base Color", min: 0, max: 1 },
        shadeColor: { title: "Shade Color", min: 0, max: 1 },
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
    _raycastHitNormalLocal = new pc.Vec3(0, 1, 0);
    _raycastInvWorld = new pc.Mat4();
    _centerCollisionEntity = null;
    _spawnReady = false;
    _pendingRebuild = false;
    _waitingForLoadingScreen = false;
    _lightDirWorld = new pc.Vec3(0, -1, 0);
    _lightDirModel = new pc.Vec3(0, -1, 0);
    _invWorld = new pc.Mat4();

    initialize() {
        if (!pc.GSplatData || !pc.GSplatResource || !pc.GSplatInstance) {
            console.error("Procedural Splats Snow: GSplatData runtime API is not available.");
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
        this._writeSnow(layout, data);

        this._gsplatData = this._createGSplatData(layout.numSplats, data);
        this._gsplatResource = new pc.GSplatResource(this.app.graphicsDevice, this._gsplatData);
        this._gsplatAsset = new pc.Asset("procedural-snow", "gsplat", null);
        this.app.assets.add(this._gsplatAsset);
        this._gsplatAsset.resource = this._gsplatResource;

        this._splatEntity = new pc.Entity("ProceduralSplatsSnow");
        this._splatEntity.addComponent("gsplat", {
            asset: this._gsplatAsset,
            unified: true,
        });
        this.entity.addChild(this._splatEntity);

        const splatLayer = this.app.scene.layers.getLayerByName("Splats");
        if (splatLayer) {
            this._splatEntity.gsplat.layers = [splatLayer.id];
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
            f_rest_0: new Float32Array(count),
            f_rest_1: new Float32Array(count),
            f_rest_2: new Float32Array(count),
            f_rest_3: new Float32Array(count),
            f_rest_4: new Float32Array(count),
            f_rest_5: new Float32Array(count),
            f_rest_6: new Float32Array(count),
            f_rest_7: new Float32Array(count),
            f_rest_8: new Float32Array(count),
        };

        data.rot_0.fill(1);
        return data;
    }

    _writeSnow(layout, data) {
        const spacing = layout.spacing;
        const overlap = Math.max(0.01, this.overlapScale);
        const useSpawnRaycast = !!this.useSpawnRaycast && !!this.app.systems.rigidbody;
        const positionJitter = this._clamp01(this.positionJitter);
        const footprintVariation = this._clamp01(this.footprintVariation);
        const heightVariation = this._clamp01(this.heightVariation);
        const jitterRange = spacing * 0.5 * positionJitter;
        const baseRadius = layout.numSplats > 1 ? spacing * 0.5 : Math.min(layout.size.x, layout.size.z) * 0.5;
        const baseWidth = Math.max(0.003, Math.max(baseRadius, this.snowWidth) * overlap);
        const baseHeight = Math.max(0.002, this.snowHeight * overlap);
        const validNormalMinY = 0.70710678;

        this._updateLightDirection();

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
                    (this._hash2(x + 17, z + 43) * 2 - 1) * jitterRange;
                const pz =
                    this._axisPosition(z, layout.counts.z, spacing, layout.size.z) +
                    (this._hash2(x + 59, z + 7) * 2 - 1) * jitterRange;
                const groundY = useSpawnRaycast ? this._sampleGround(px, pz, validNormalMinY) : 0;
                const widthX = baseWidth * (0.7 + this._hash2(x + 11, z + 29) * footprintVariation);
                const widthZ = baseWidth * (0.7 + this._hash2(x + 83, z + 13) * footprintVariation);
                const puffHeight = baseHeight * (0.7 + this._hash2(x + 101, z + 61) * heightVariation);
                const isValidGround = groundY !== null;
                const lift = (isValidGround ? groundY : 0) + puffHeight * 0.5;
                const colorBlend = this._clamp01(0.2 + noise * 0.8);
                const colorR = this._mix(this.shadeColor.r, this.baseColor.r, colorBlend);
                const colorG = this._mix(this.shadeColor.g, this.baseColor.g, colorBlend);
                const colorB = this._mix(this.shadeColor.b, this.baseColor.b, colorBlend);

                data.x[i] = px;
                data.y[i] = lift;
                data.z[i] = pz;
                data.scale_0[i] = Math.log(widthX);
                data.scale_1[i] = Math.log(puffHeight);
                data.scale_2[i] = Math.log(widthZ);
                data.f_dc_0[i] = (this._clamp01(colorR) - 0.5) / SH_C0;
                data.f_dc_1[i] = (this._clamp01(colorG) - 0.5) / SH_C0;
                data.f_dc_2[i] = (this._clamp01(colorB) - 0.5) / SH_C0;
                data.opacity[i] = isValidGround
                    ? this._alphaToOpacity(this._clamp01(this.alpha * (0.88 + noise * 0.12)))
                    : -40;
                this._writeSurfaceLighting(data, i, colorR, colorG, colorB, isValidGround);
                i++;
            }
        }
    }

    _sampleGround(localX, localZ, validNormalMinY) {
        this._raycastLocalFrom.set(localX, this.raycastHeight, localZ);
        this._raycastLocalTo.set(localX, -this.raycastDepth, localZ);

        this.entity.getWorldTransform().transformPoint(this._raycastLocalFrom, this._raycastWorldFrom);
        this.entity.getWorldTransform().transformPoint(this._raycastLocalTo, this._raycastWorldTo);

        const hit = this.app.systems.rigidbody.raycastFirst(this._raycastWorldFrom, this._raycastWorldTo, {
            filterTags: [CENTER_COLLISION_TAG],
        });
        if (!hit) {
            this._raycastHitNormalLocal.set(0, 1, 0);
            return null;
        }

        this._raycastInvWorld.transformPoint(hit.point, this._raycastHitLocal);
        if (hit.normal) {
            this._raycastInvWorld.transformVector(hit.normal, this._raycastHitNormalLocal).normalize();
        } else {
            this._raycastHitNormalLocal.set(0, 1, 0);
        }

        if (this._raycastHitNormalLocal.y < validNormalMinY) {
            return null;
        }

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
            "f_rest_0",
            "f_rest_1",
            "f_rest_2",
            "f_rest_3",
            "f_rest_4",
            "f_rest_5",
            "f_rest_6",
            "f_rest_7",
            "f_rest_8",
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

    _writeSurfaceLighting(data, index, r, g, b, isValidGround) {
        if (!isValidGround || this.normalLightingStrength <= 0) {
            data.f_rest_0[index] = 0;
            data.f_rest_1[index] = 0;
            data.f_rest_2[index] = 0;
            data.f_rest_3[index] = 0;
            data.f_rest_4[index] = 0;
            data.f_rest_5[index] = 0;
            data.f_rest_6[index] = 0;
            data.f_rest_7[index] = 0;
            data.f_rest_8[index] = 0;
            return;
        }

        const nx = this._raycastHitNormalLocal.x;
        const ny = this._raycastHitNormalLocal.y;
        const nz = this._raycastHitNormalLocal.z;
        const ndotl = Math.max(0, nx * this._lightDirModel.x + ny * this._lightDirModel.y + nz * this._lightDirModel.z);
        const k = this.normalLightingStrength * ndotl;
        const sh0 = -k * ny / SH_C1;
        const sh1 = k * nz / SH_C1;
        const sh2 = -k * nx / SH_C1;

        data.f_rest_0[index] = sh0 * r;
        data.f_rest_1[index] = sh1 * r;
        data.f_rest_2[index] = sh2 * r;
        data.f_rest_3[index] = sh0 * g;
        data.f_rest_4[index] = sh1 * g;
        data.f_rest_5[index] = sh2 * g;
        data.f_rest_6[index] = sh0 * b;
        data.f_rest_7[index] = sh1 * b;
        data.f_rest_8[index] = sh2 * b;
    }

    _getDirectionalLightEntity() {
        if (!this.useStageDirectionalLight) {
            return null;
        }

        const named = this.app.root.findByName("MainStagePointDirectional");
        if (named?.enabled && named.light?.enabled && named.light.type === "directional") {
            return named;
        }

        const lights = this.app.root.findComponents("light");
        for (const light of lights) {
            if (!light?.enabled || !light.entity?.enabled) {
                continue;
            }
            if (light.type === "directional") {
                return light.entity;
            }
        }

        return null;
    }

    _updateLightDirection() {
        const lightEntity = this._getDirectionalLightEntity();
        if (lightEntity) {
            lightEntity.getWorldTransform().getY(this._lightDirWorld).mulScalar(-1).normalize();
        } else {
            const fallback = this._normalizeVector(this.lightDirection.x, this.lightDirection.y, this.lightDirection.z);
            this._lightDirWorld.set(fallback.x, fallback.y, fallback.z);
        }

        this._invWorld.copy(this.entity.getWorldTransform()).invert();
        this._invWorld.transformVector(this._lightDirWorld, this._lightDirModel).normalize();
    }

    _normalizeVector(x, y, z) {
        const length = Math.sqrt(x * x + y * y + z * z) || 1;
        return {
            x: x / length,
            y: y / length,
            z: z / length,
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
