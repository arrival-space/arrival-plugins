/**
 * Procedural Splats - Fire
 *
 * Fire-only gsplat effect:
 * - flame core
 * - smoke plume
 *
 * Lighting stays SH-only (no shader override). Stage directional light drives
 * SH coefficient updates on CPU.
 */
const SH_C0 = 0.28209479177387814;
const SH_C1 = 0.4886025119029199;

const TYPE_FLAME = 0;
const TYPE_SMOKE = 1;
const TYPE_SPARK = 2;

export class ProceduralSplats extends ArrivalScript {
    static scriptName = "Procedural Splats";

    splatCount = 1400;
    flameHeight = 0.5215000000000006;
    flameRadius = 0.7506249999999998;
    smokeHeight = 2.2;
    sparkHeight = 4.1225;
    smokeRatio = 0.11000000000000015;
    sparkRatio = 0.0455;
    turbulence = 0.24;
    windDirection = { x: 0.25, y: 0, z: 0.1 };
    windStrength = 0;
    fireSpeed = 0.3599999999999996;
    brightness = 1;
    smokeOpacity = 0.7;
    flameColor = { r: 1, g: 0.72, b: 0.18 };
    smokeColor = { r: 0.22, g: 0.22, b: 0.24 };
    sparkColor = { r: 1, g: 0.35, b: 0.08 };
    flameAlpha = 1;
    smokeAlpha = 1;
    sparkAlpha = 1;
    flameIntensity = 1;
    smokeIntensity = 1;
    sparkIntensity = 1;
    normalLighting = true;
    normalLightingStrength = 0.9;
    useStageDirectionalLight = true;
    lightDirection = { x: 0.3, y: -1, z: 0.2 };

    static properties = {
        splatCount: { title: "Splat Count", min: 256, max: 20000 },
        flameHeight: { title: "Flame Height", min: 0.3, max: 8 },
        flameRadius: { title: "Flame Radius", min: 0.05, max: 3 },
        smokeHeight: { title: "Smoke Height", min: 0.5, max: 12 },
        sparkHeight: { title: "Spark Height", min: 0.5, max: 12 },
        smokeRatio: { title: "Smoke Ratio", min: 0, max: 0.8 },
        sparkRatio: { title: "Spark Ratio", min: 0, max: 0.7 },
        turbulence: { title: "Turbulence", min: 0, max: 1.5 },
        windDirection: { title: "Wind Dir", min: -1, max: 1 },
        windStrength: { title: "Wind Strength", min: 0, max: 3 },
        fireSpeed: { title: "Fire Speed", min: 0, max: 4 },
        brightness: { title: "Brightness", min: 0.2, max: 3 },
        smokeOpacity: { title: "Smoke Opacity", min: 0, max: 1 },
        flameColor: { title: "Flame Color", min: 0, max: 4 },
        smokeColor: { title: "Smoke Color", min: 0, max: 4 },
        sparkColor: { title: "Spark Color", min: 0, max: 4 },
        flameAlpha: { title: "Flame Alpha", min: 0, max: 4 },
        smokeAlpha: { title: "Smoke Alpha", min: 0, max: 4 },
        sparkAlpha: { title: "Spark Alpha", min: 0, max: 4 },
        flameIntensity: { title: "Flame Intensity", min: 0, max: 8 },
        smokeIntensity: { title: "Smoke Intensity", min: 0, max: 8 },
        sparkIntensity: { title: "Spark Intensity", min: 0, max: 8 },
        normalLighting: { title: "Normal Lighting" },
        normalLightingStrength: { title: "Normal Light Strength", min: 0, max: 2 },
        useStageDirectionalLight: { title: "Use Stage Directional" },
        lightDirection: { title: "Fallback Light Dir", min: -1, max: 1 },
    };

    _splatEntity = null;
    _gsplatData = null;
    _gsplatResource = null;
    _gsplatAsset = null;
    _activeSplats = 0;
    _simTime = 0;
    _simTimer = 0;
    _data = null;
    _type = null;
    _spawnOffset = null;
    _life = null;
    _baseAngle = null;
    _baseRadius = null;
    _riseSpeed = null;
    _swirlSpeed = null;
    _wobblePhase = null;
    _wobbleAmp = null;
    _driftX = null;
    _driftZ = null;
    _sizeBase = null;
    _energy = null;
    _lightDirWorld = new pc.Vec3(0, -1, 0);
    _lightDirModel = new pc.Vec3(0, -1, 0);
    _prevLightDirModel = new pc.Vec3(0, -1, 0);
    _invWorld = new pc.Mat4();
    _transformNudge = false;

    initialize() {
        if (!pc.GSplatData || !pc.GSplatResource || !pc.GSplatInstance) {
            console.error("Procedural Splats: GSplatData/GSplatResource runtime API is not available.");
            return;
        }

        this._rebuildSplats();
    }

    _rebuildSplats() {
        this._destroySplatEntity();
        this._simTime = 0;
        this._simTimer = 0;

        this._activeSplats = Math.max(256, Math.floor(this.splatCount));
        this._createStorage(this._activeSplats);
        this._createFireProfiles(this._activeSplats);
        this._updateStageLightDirection();
        this._writeFrameData(0);

        this._gsplatData = this._createGSplatData(this._activeSplats);
        this._gsplatResource = new pc.GSplatResource(this.app.graphicsDevice, this._gsplatData);
        this._gsplatAsset = new pc.Asset("procedural-fire", "gsplat", null);
        this.app.assets.add(this._gsplatAsset);
        this._gsplatAsset.resource = this._gsplatResource;

        this._splatEntity = new pc.Entity("ProceduralFireSplats");
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

    _createStorage(count) {
        this._data = {
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

        this._data.rot_0.fill(1);
        this._data.rot_1.fill(0);
        this._data.rot_2.fill(0);
        this._data.rot_3.fill(0);
    }

    _createFireProfiles(count) {
        this._type = new Uint8Array(count);
        this._spawnOffset = new Float32Array(count);
        this._life = new Float32Array(count);
        this._baseAngle = new Float32Array(count);
        this._baseRadius = new Float32Array(count);
        this._riseSpeed = new Float32Array(count);
        this._swirlSpeed = new Float32Array(count);
        this._wobblePhase = new Float32Array(count);
        this._wobbleAmp = new Float32Array(count);
        this._driftX = new Float32Array(count);
        this._driftZ = new Float32Array(count);
        this._sizeBase = new Float32Array(count);
        this._energy = new Float32Array(count);

        const smokeRatio = this._clamp01(this.smokeRatio);
        const sparkRatio = this._clamp01(Math.min(this.sparkRatio, 1 - smokeRatio));

        for (let i = 0; i < count; i++) {
            const selector = this._hash(i, 3);
            const phase = this._hash(i, 7) * Math.PI * 2;
            const driftX = this._hash(i, 11) * 2 - 1;
            const driftZ = this._hash(i, 13) * 2 - 1;
            const radial01 = this._hash(i, 17);
            const energy = 0.75 + this._hash(i, 19) * 0.45;

            let type = TYPE_FLAME;
            if (selector < sparkRatio) {
                type = TYPE_SPARK;
            } else if (selector < sparkRatio + smokeRatio) {
                type = TYPE_SMOKE;
            }

            this._type[i] = type;
            this._spawnOffset[i] = this._hash(i, 23);
            this._baseAngle[i] = this._hash(i, 29) * Math.PI * 2;
            this._wobblePhase[i] = phase;
            this._wobbleAmp[i] = (0.03 + this._hash(i, 31) * 0.14) * this.turbulence;
            this._driftX[i] = driftX;
            this._driftZ[i] = driftZ;
            this._energy[i] = energy;

            if (type === TYPE_FLAME) {
                this._life[i] = 0.45 + this._hash(i, 37) * 0.5;
                this._baseRadius[i] = Math.pow(radial01, 2.4) * this.flameRadius * 0.5;
                this._riseSpeed[i] = 1.2 + this._hash(i, 41) * 0.75;
                this._swirlSpeed[i] = 3.5 + this._hash(i, 43) * 3.5;
                this._sizeBase[i] = 0.007 + this._hash(i, 47) * 0.015;
            } else if (type === TYPE_SMOKE) {
                this._life[i] = 2.2 + this._hash(i, 53) * 1.8;
                this._baseRadius[i] = Math.pow(radial01, 1.6) * this.flameRadius * 0.35;
                this._riseSpeed[i] = 0.45 + this._hash(i, 59) * 0.45;
                this._swirlSpeed[i] = 0.45 + this._hash(i, 61) * 1.0;
                this._sizeBase[i] = 0.026 + this._hash(i, 67) * 0.055;
            } else {
                this._life[i] = 0.25 + this._hash(i, 71) * 0.3;
                this._baseRadius[i] = radial01 * this.flameRadius * 0.45;
                this._riseSpeed[i] = 1.4 + this._hash(i, 73) * 1.3;
                this._swirlSpeed[i] = 4.5 + this._hash(i, 79) * 5.5;
                this._sizeBase[i] = 0.004 + this._hash(i, 83) * 0.01;
            }
        }
    }

    _createGSplatData(count) {
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
        ].map((name) => {
            return {
                name,
                type: "float",
                byteSize: 4,
                storage: this._data[name],
            };
        });

        return new pc.GSplatData([
            {
                name: "vertex",
                count,
                properties,
            },
        ]);
    }

    _writeFrameData(time) {
        if (!this._data || !this._type) {
            return;
        }

        const windNorm = this._normalizeVector(this.windDirection.x, this.windDirection.y, this.windDirection.z);
        const windX = windNorm.x * this.windStrength;
        const windZ = windNorm.z * this.windStrength;
        const brightness = Math.max(0, this.brightness);
        const smokeOpacity = this._clamp01(this.smokeOpacity);
        const flameAlphaMult = Math.max(0, this.flameAlpha);
        const smokeAlphaMult = Math.max(0, this.smokeAlpha);
        const sparkAlphaMult = Math.max(0, this.sparkAlpha);
        const flameIntensity = Math.max(0, this.flameIntensity);
        const smokeIntensity = Math.max(0, this.smokeIntensity);
        const sparkIntensity = Math.max(0, this.sparkIntensity);

        for (let i = 0; i < this._activeSplats; i++) {
            const type = this._type[i];
            const life = this._life[i];
            const age = ((time + this._spawnOffset[i] * life) % life) / life;
            const phase = this._wobblePhase[i];
            const baseAngle = this._baseAngle[i];
            const swirl = time * this._swirlSpeed[i];
            const wobble = Math.sin(time * 11 + phase + age * 8) * this._wobbleAmp[i];

            let x = 0;
            let y = 0;
            let z = 0;
            let nx = 0;
            let ny = 1;
            let nz = 0;
            let size = this._sizeBase[i];
            let alpha = 0.5;
            let colorR = 1;
            let colorG = 0.6;
            let colorB = 0.2;

            if (type === TYPE_FLAME) {
                const p = age;
                const rise = Math.pow(p, 0.82);
                const anchor = 1 - Math.pow(p, 1.15);
                const laneX = this._driftX[i];
                const laneZ = this._driftZ[i];
                const emitRadius = this._baseRadius[i];
                const flicker1 = Math.sin(time * (14 + this._swirlSpeed[i]) + phase + p * 12);
                const flicker2 = Math.sin(time * (22 + this._swirlSpeed[i] * 0.4) + phase * 1.7 + p * 18);
                const lateral = (0.012 + this.turbulence * 0.08) * (0.25 + p * 1.35);

                x =
                    laneX * emitRadius * anchor +
                    flicker1 * lateral +
                    laneZ * flicker2 * lateral * 0.45 +
                    windX * rise * 0.28;
                z =
                    laneZ * emitRadius * anchor +
                    flicker2 * lateral +
                    laneX * flicker1 * lateral * 0.45 +
                    windZ * rise * 0.28;
                y =
                    rise * this.flameHeight * this._riseSpeed[i] +
                    Math.abs(flicker2) * this.turbulence * 0.08 +
                    Math.sin(time * 30 + phase) * 0.02;

                const heat = Math.max(0, 1 - p);
                const core = Math.exp(-emitRadius / Math.max(0.01, this.flameRadius * 0.2));
                const whiteCore = core * Math.pow(heat, 0.45);
                const alphaEnvelope = this._clamp01(p * 8) * Math.pow(1 - p, 0.45);
                const flameToneR = 0.88 + 0.3 * heat + whiteCore * 0.2;
                const flameToneG = 0.16 + 0.85 * heat + whiteCore * 0.28 - p * 0.12;
                const flameToneB = 0.01 + 0.12 * heat + whiteCore * 0.18 - p * 0.08;

                colorR = flameToneR * this.flameColor.r * brightness * flameIntensity;
                colorG = flameToneG * this.flameColor.g * brightness * flameIntensity;
                colorB = flameToneB * this.flameColor.b * brightness * flameIntensity;
                alpha = this._clamp01(alphaEnvelope * (0.55 + 0.45 * core) * (0.9 + 0.15 * flicker1) * flameAlphaMult);
                size = this._sizeBase[i] * (0.7 + rise * 1.7);

                const n = this._normalizeVector(x * 0.8 + laneX * 0.2, 0.75 - p * 0.25, z * 0.8 + laneZ * 0.2);
                nx = n.x;
                ny = n.y;
                nz = n.z;
            } else if (type === TYPE_SMOKE) {
                const p = age;
                const rise = Math.pow(p, 0.95);
                const emitHeight = this.flameHeight * (0.35 + this._hash(i, 89) * 0.4);
                const sourceX = this._driftX[i] * this._baseRadius[i] * 0.45;
                const sourceZ = this._driftZ[i] * this._baseRadius[i] * 0.45;
                const curlA = Math.sin(time * (1.8 + this._swirlSpeed[i] * 0.5) + phase + p * 6);
                const curlB = Math.sin(time * 3.1 + phase * 1.9 + p * 11);
                const spread = this.flameRadius * (0.08 + rise * 0.35);
                const windPush = 0.35 + rise * 2.4;

                x =
                    sourceX * (1 - rise * 0.5) +
                    windX * windPush +
                    this._driftZ[i] * curlA * spread +
                    this._driftX[i] * curlB * spread * 0.4;
                z =
                    sourceZ * (1 - rise * 0.5) +
                    windZ * windPush +
                    this._driftX[i] * curlA * spread -
                    this._driftZ[i] * curlB * spread * 0.4;
                y = emitHeight + rise * this.smokeHeight * this._riseSpeed[i];

                const density = this._clamp01(Math.sin(p * Math.PI));
                const gray = this._clamp01(0.08 + p * 0.34);
                const warm = Math.max(0, 0.12 - p * 0.18);
                const smokeToneR = (gray + warm * 0.4) * 0.82;
                const smokeToneG = (gray + warm * 0.25) * 0.82;
                const smokeToneB = gray * 0.88;

                colorR = smokeToneR * this.smokeColor.r * brightness * smokeIntensity;
                colorG = smokeToneG * this.smokeColor.g * brightness * smokeIntensity;
                colorB = smokeToneB * this.smokeColor.b * brightness * smokeIntensity;
                alpha = this._clamp01(density * smokeOpacity * (0.22 + (1 - p) * 0.28) * smokeAlphaMult);
                size = this._sizeBase[i] * (0.75 + rise * 2.1);

                const n = this._normalizeVector(windX * 0.6 + this._driftX[i] * 0.25, 0.92, windZ * 0.6 + this._driftZ[i] * 0.25);
                nx = n.x;
                ny = n.y;
                nz = n.z;
            } else {
                const p = age;
                const ballistic = p - p * p * 0.62;
                const angle = baseAngle + swirl;
                const side = this.flameRadius * (0.25 + p * 0.95);

                x = Math.cos(angle) * side + this._driftX[i] * p * 0.22 + windX * p * 0.14;
                z = Math.sin(angle) * side + this._driftZ[i] * p * 0.22 + windZ * p * 0.14;
                y = ballistic * this.sparkHeight * this._riseSpeed[i] + Math.sin(time * 26 + phase) * 0.03;

                const glow = Math.pow(Math.max(0, 1 - p), 2.3) * this._energy[i];
                const sparkToneR = 1;
                const sparkToneG = 0.18 + glow * 0.9;
                const sparkToneB = 0.04 + glow * 0.18;

                colorR = sparkToneR * this.sparkColor.r * brightness * sparkIntensity;
                colorG = sparkToneG * this.sparkColor.g * brightness * sparkIntensity;
                colorB = sparkToneB * this.sparkColor.b * brightness * sparkIntensity;
                alpha = this._clamp01(glow * 0.95 * sparkAlphaMult);
                size = this._sizeBase[i] * (0.5 + glow * 0.7);

                const n = this._normalizeVector(this._driftX[i], 1.1, this._driftZ[i]);
                nx = n.x;
                ny = n.y;
                nz = n.z;
            }

            this._data.x[i] = x;
            this._data.y[i] = y;
            this._data.z[i] = z;

            const logSize = Math.log(Math.max(0.002, size));
            this._data.scale_0[i] = logSize;
            this._data.scale_1[i] = logSize;
            this._data.scale_2[i] = logSize;

            this._data.f_dc_0[i] = this._colorToSh(colorR);
            this._data.f_dc_1[i] = this._colorToSh(colorG);
            this._data.f_dc_2[i] = this._colorToSh(colorB);
            this._data.opacity[i] = this._alphaToOpacity(alpha);

            this._writeSHForIndex(i, colorR, colorG, colorB, nx, ny, nz);
        }
    }

    _writeSHForIndex(i, r, g, b, nx, ny, nz) {
        if (!this.normalLighting || !this.normalLightingStrength) {
            this._data.f_rest_0[i] = 0;
            this._data.f_rest_1[i] = 0;
            this._data.f_rest_2[i] = 0;
            this._data.f_rest_3[i] = 0;
            this._data.f_rest_4[i] = 0;
            this._data.f_rest_5[i] = 0;
            this._data.f_rest_6[i] = 0;
            this._data.f_rest_7[i] = 0;
            this._data.f_rest_8[i] = 0;
            return;
        }

        const ndotl = Math.max(0, nx * this._lightDirModel.x + ny * this._lightDirModel.y + nz * this._lightDirModel.z);
        const k = this.normalLightingStrength * ndotl;

        // Matches engine evalSH band-1 basis:
        // SH_C1 * (-sh0*y + sh1*z - sh2*x) = k * dot(normal, dir)
        const sh0 = -k * ny / SH_C1;
        const sh1 = k * nz / SH_C1;
        const sh2 = -k * nx / SH_C1;

        this._data.f_rest_0[i] = sh0 * r;
        this._data.f_rest_1[i] = sh1 * r;
        this._data.f_rest_2[i] = sh2 * r;
        this._data.f_rest_3[i] = sh0 * g;
        this._data.f_rest_4[i] = sh1 * g;
        this._data.f_rest_5[i] = sh2 * g;
        this._data.f_rest_6[i] = sh0 * b;
        this._data.f_rest_7[i] = sh1 * b;
        this._data.f_rest_8[i] = sh2 * b;
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

    _updateStageLightDirection() {
        const lightEntity = this._getDirectionalLightEntity();
        if (lightEntity) {
            lightEntity.getWorldTransform().getY(this._lightDirWorld).mulScalar(-1).normalize();
        } else {
            const fallback = this._normalizeVector(this.lightDirection.x, this.lightDirection.y, this.lightDirection.z);
            this._lightDirWorld.set(fallback.x, fallback.y, fallback.z);
        }

        this._invWorld.copy(this.entity.getWorldTransform()).invert();
        this._invWorld.transformVector(this._lightDirWorld, this._lightDirModel).normalize();

        const dot = this._prevLightDirModel.dot(this._lightDirModel);
        const changed = dot < 0.9995;
        if (changed) {
            this._prevLightDirModel.copy(this._lightDirModel);
        }
        return changed;
    }

    _pushFrameToGpu() {
        if (!this._gsplatResource || !this._gsplatData) {
            return;
        }

        this._gsplatResource.updateTransformData(this._gsplatData);
        this._gsplatResource.updateColorData(this._gsplatData);
        this._gsplatResource.updateSHData(this._gsplatData);
        this._nudgeSplatEntity();
    }

    _nudgeSplatEntity() {
        if (!this._splatEntity) {
            return;
        }

        this._transformNudge = !this._transformNudge;
        this._splatEntity.setLocalPosition(this._transformNudge ? 0.00001 : 0, 0, 0);
    }

    _hash(index, salt) {
        const v = Math.sin((index + 1) * 12.9898 + (salt + 1) * 78.233) * 43758.5453123;
        return v - Math.floor(v);
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

    _colorToSh(value) {
        return (Math.max(0, value) - 0.5) / SH_C0;
    }

    _normalizeVector(x, y, z) {
        const len = Math.hypot(x, y, z) || 1;
        return {
            x: x / len,
            y: y / len,
            z: z / len,
        };
    }

    _clamp01(v) {
        return Math.min(1, Math.max(0, v));
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
        this._data = null;
        this._type = null;
        this._spawnOffset = null;
        this._life = null;
        this._baseAngle = null;
        this._baseRadius = null;
        this._riseSpeed = null;
        this._swirlSpeed = null;
        this._wobblePhase = null;
        this._wobbleAmp = null;
        this._driftX = null;
        this._driftZ = null;
        this._sizeBase = null;
        this._energy = null;
    }

    onPropertyChanged(name) {
        const rebuildProps = ["splatCount", "smokeRatio", "sparkRatio"];
        if (rebuildProps.includes(name)) {
            this._rebuildSplats();
            return;
        }

        if (!this._gsplatResource) {
            return;
        }

        const lightProps = ["useStageDirectionalLight", "lightDirection"];
        if (lightProps.includes(name)) {
            this._updateStageLightDirection();
        }

        this._writeFrameData(this._simTime);
        this._pushFrameToGpu();
    }

    update(dt) {
        if (!this._gsplatResource) {
            return;
        }

        this._simTime += dt * this.fireSpeed;
        const lightChanged = this._updateStageLightDirection();

        this._simTimer += dt;
        if (this._simTimer >= 0.033 || lightChanged) {
            this._simTimer = 0;
            this._writeFrameData(this._simTime);
            this._pushFrameToGpu();
        }
    }

    destroy() {
        this._destroySplatEntity();
    }
}
