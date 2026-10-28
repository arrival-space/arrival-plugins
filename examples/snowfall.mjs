/**
 * Snowfall - falling snow made of Gaussian splats
 *
 * Every flake is one small round splat in a procedural gsplat that joins the
 * space's unified splat rendering, so flakes sort together with the
 * environment splat (behind a splat wall stays behind it).
 *
 * The flakes form a pattern that is fixed in the world and repeats every
 * areaSize. With followCamera the volume is re-centred on the camera each
 * frame, so it snows wherever the viewer is; flakes leaving the volume come
 * back in on the opposite side, and shrink to nothing near the volume's edges
 * and within 1.5 m of the camera. Without followCamera the volume stands on
 * the entity.
 *
 * Positions are rewritten on the CPU every frame and pushed with
 * GSplatResource.updateTransformData() (same runtime path as splat-fire).
 *
 * Properties:
 * - splatCount: number of flakes
 * - areaSize: width / height / depth of the snow volume in meters
 * - followCamera: keep the volume around the camera (otherwise on the entity)
 * - heightOffset: lifts the volume's center above the camera (followCamera)
 * - flakeSize / sizeVariation: flake radius in meters and its random spread
 * - snowColor (#hex → color picker) / opacity
 * - fallSpeed: meters per second, each flake varies +-30%
 * - windDirection (vec3) * windStrength: constant drift in meters per second
 * - turbulence: sideways sway amplitude in meters
 */
const SH_C0 = 0.28209479177387814;

export class Snowfall extends ArrivalScript {
    static scriptName = "snowfall";

    splatCount = 6000;
    areaSize = { x: 20, y: 10, z: 20 };
    followCamera = true;
    heightOffset = 2;
    flakeSize = 0.02;
    sizeVariation = 0.5;
    snowColor = "#f2f6ff";
    opacity = 0.9;
    fallSpeed = 1.0;
    windDirection = { x: 0.3, y: 0, z: 0.2 };
    windStrength = 0.6;
    turbulence = 0.3;

    static properties = {
        splatCount: { title: "Flake Count", min: 100, max: 50000 },
        areaSize: { title: "Area Size", min: 1, max: 100 },
        followCamera: { title: "Follow Camera" },
        heightOffset: { title: "Height Offset", min: -10, max: 20 },
        flakeSize: { title: "Flake Size", min: 0.002, max: 0.2 },
        sizeVariation: { title: "Size Variation", min: 0, max: 1 },
        snowColor: { title: "Snow Color" },
        opacity: { title: "Opacity", min: 0, max: 1 },
        fallSpeed: { title: "Fall Speed", min: 0, max: 10 },
        windDirection: { title: "Wind Direction", min: -5, max: 5 },
        windStrength: { title: "Wind Strength", min: 0, max: 5 },
        turbulence: { title: "Turbulence", min: 0, max: 3 },
    };

    _splatEntity = null;
    _gsplatData = null;
    _gsplatResource = null;
    _gsplatAsset = null;
    _data = null;
    _flakes = null;
    _count = 0;
    _time = 0;
    _camera = null;
    _invWorld = new pc.Mat4();
    _camLocal = new pc.Vec3();
    _transformNudge = false;

    initialize() {
        this._camera = ArrivalSpace.getCamera();
        this._rebuild();
    }

    _rebuild() {
        this._destroySplatEntity();

        this._count = Math.max(1, Math.floor(this.splatCount));
        this._data = this._createStorage(this._count);
        this._flakes = this._createFlakes(this._count);
        this._writeColors();

        this._gsplatData = this._createGSplatData(this._count, this._data);

        this._splatEntity = new pc.Entity("SnowfallSplats");
        this.entity.addChild(this._splatEntity);
        this._writePositions();

        this._gsplatResource = new pc.GSplatResource(this.app.graphicsDevice, this._gsplatData);
        this._gsplatAsset = new pc.Asset("snowfall", "gsplat", null);
        this.app.assets.add(this._gsplatAsset);
        this._gsplatAsset.resource = this._gsplatResource;

        this._splatEntity.addComponent("gsplat", {
            asset: this._gsplatAsset,
            unified: true,
        });

        const splatLayer = this.app.scene.layers.getLayerByName("Splats");
        if (splatLayer) {
            this._splatEntity.gsplat.layers = [splatLayer.id];
        }
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

    // Per-flake constants: position in the repeating pattern (0..1 per axis),
    // fall speed factor, sway phase/frequency, size factor and brightness.
    _createFlakes(count) {
        const flakes = {
            u: new Float32Array(count),
            v: new Float32Array(count),
            w: new Float32Array(count),
            speed: new Float32Array(count),
            phase: new Float32Array(count),
            freq: new Float32Array(count),
            size: new Float32Array(count),
            shade: new Float32Array(count),
        };

        for (let i = 0; i < count; i++) {
            flakes.u[i] = Math.random();
            flakes.v[i] = Math.random();
            flakes.w[i] = Math.random();
            flakes.speed[i] = 0.7 + Math.random() * 0.6;
            flakes.phase[i] = Math.random() * Math.PI * 2;
            flakes.freq[i] = 0.5 + Math.random() * 1.5;
            flakes.size[i] = Math.random() * 2 - 1;
            flakes.shade[i] = 0.9 + Math.random() * 0.1;
        }
        return flakes;
    }

    _writeColors() {
        const rgb = this._hexToRgb(this.snowColor);
        const opacity = this._alphaToOpacity(this.opacity);
        const data = this._data;
        const shade = this._flakes.shade;

        for (let i = 0; i < this._count; i++) {
            data.f_dc_0[i] = (rgb.r * shade[i] - 0.5) / SH_C0;
            data.f_dc_1[i] = (rgb.g * shade[i] - 0.5) / SH_C0;
            data.f_dc_2[i] = (rgb.b * shade[i] - 0.5) / SH_C0;
            data.opacity[i] = opacity;
        }
    }

    // Places the volume (camera or entity), then writes every flake's position
    // inside it, relative to the volume's center.
    _writePositions() {
        const W = Math.max(0.1, this.areaSize.x);
        const H = Math.max(0.1, this.areaSize.y);
        const D = Math.max(0.1, this.areaSize.z);

        // Pattern-space origin: world space around the camera, or the volume's own center.
        let ox = 0;
        let oy = 0;
        let oz = 0;
        this._transformNudge = !this._transformNudge;
        const nudge = this._transformNudge ? 0.00001 : 0;
        if (this.followCamera && this._camera) {
            const cam = this._camera.getPosition();
            ox = cam.x;
            oy = cam.y + this.heightOffset;
            oz = cam.z;
            this._splatEntity.setPosition(ox, oy + nudge, oz);
            this._splatEntity.setRotation(pc.Quat.IDENTITY);
        } else {
            this._splatEntity.setLocalPosition(0, H * 0.5 + nudge, 0);
            this._splatEntity.setLocalRotation(pc.Quat.IDENTITY);
        }

        const camLocal = this._camLocal;
        if (this._camera) {
            this._invWorld.copy(this._splatEntity.getWorldTransform()).invert();
            this._invWorld.transformPoint(this._camera.getPosition(), camLocal);
        } else {
            camLocal.set(0, 1e6, 0);
        }

        const t = this._time;
        const wind = this.windDirection;
        const windX = wind.x * this.windStrength * t;
        const windY = wind.y * this.windStrength * t;
        const windZ = wind.z * this.windStrength * t;
        const fall = this.fallSpeed * t;
        const turb = this.turbulence;
        const baseSize = Math.max(0.0005, this.flakeSize);
        const variation = this._clamp01(this.sizeVariation);
        const edgeX = W * 0.5;
        const edgeY = H * 0.5;
        const edgeZ = D * 0.5;

        const data = this._data;
        const f = this._flakes;
        for (let i = 0; i < this._count; i++) {
            const swayT = t * f.freq[i] + f.phase[i];
            const x = this._wrap(f.u[i] * W + windX + Math.sin(swayT) * turb - ox, W);
            const y = this._wrap(f.w[i] * H + windY - fall * f.speed[i] - oy, H);
            const z = this._wrap(f.v[i] * D + windZ + Math.cos(swayT * 0.8) * turb - oz, D);

            // Shrink toward the volume's faces, where flakes wrap around,
            // and near the camera, where a flake would fill the screen.
            const edge =
                this._clamp01((edgeX - Math.abs(x)) / (edgeX * 0.15)) *
                this._clamp01((edgeY - Math.abs(y)) / (edgeY * 0.15)) *
                this._clamp01((edgeZ - Math.abs(z)) / (edgeZ * 0.15));
            const dx = x - camLocal.x;
            const dy = y - camLocal.y;
            const dz = z - camLocal.z;
            const near = this._clamp01(Math.sqrt(dx * dx + dy * dy + dz * dz) - 0.5);

            const logSize = Math.log(Math.max(1e-6, baseSize * (1 + f.size[i] * variation) * edge * near));
            data.x[i] = x;
            data.y[i] = y;
            data.z[i] = z;
            data.scale_0[i] = logSize;
            data.scale_1[i] = logSize;
            data.scale_2[i] = logSize;
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

    // Maps a into [-size/2, size/2).
    _wrap(a, size) {
        return a - Math.floor(a / size + 0.5) * size;
    }

    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            return {
                r: parseInt(result[1], 16) / 255,
                g: parseInt(result[2], 16) / 255,
                b: parseInt(result[3], 16) / 255,
            };
        }
        return { r: 0.95, g: 0.96, b: 1.0 };
    }

    _clamp01(value) {
        return Math.min(1, Math.max(0, value));
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
        this._flakes = null;
    }

    onPropertyChanged(name) {
        if (name === "splatCount") {
            this._rebuild();
            return;
        }

        if (this._gsplatResource && (name === "snowColor" || name === "opacity")) {
            this._writeColors();
            this._gsplatResource.updateColorData(this._gsplatData);
        }
    }

    update(dt) {
        if (!this._gsplatResource) {
            return;
        }

        this._time += dt;
        this._writePositions();
        this._gsplatResource.updateTransformData(this._gsplatData);
    }

    destroy() {
        this._destroySplatEntity();
    }
}
