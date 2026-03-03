/**
 * Procedural Splats - Fog
 *
 * Creates a box-shaped fog volume using a uniform 3D lattice of splats.
 * Uses the same GSplatData/GSplatResource runtime path as the other procedural
 * splat effects so it runs on PlayCanvas 2.14.
 */
const SH_C0 = 0.28209479177387814;

export class ProceduralSplatsFog extends ArrivalScript {
    static scriptName = "Procedural Splats Fog";

    splatCount = 3000;
    volumeSize = { x: 10, y: 5, z: 10 };
    overlapScale = 1;
    alpha = 0.12;
    color = { r: 0.88, g: 0.92, b: 1 };

    static properties = {
        splatCount: { title: "Splat Count", min: 1, max: 20000 },
        volumeSize: { title: "Volume Size", min: 0.05, max: 50 },
        overlapScale: { title: "Overlap Scale", min: 0.25, max: 3 },
        alpha: { title: "Alpha", min: 0, max: 1 },
        color: { title: "Color", min: 0, max: 1 },
    };

    _splatEntity = null;
    _gsplatData = null;
    _gsplatResource = null;
    _gsplatAsset = null;

    initialize() {
        if (!pc.GSplatData || !pc.GSplatResource || !pc.GSplatInstance) {
            console.error("Procedural Splats Fog: GSplatData runtime API is not available.");
            return;
        }

        this._rebuild();
    }

    _rebuild() {
        this._destroySplatEntity();

        const targetSplats = Math.max(1, Math.floor(this.splatCount));
        const layout = this._buildLayout(targetSplats);
        const data = this._createStorage(layout.numSplats);
        this._writeFog(layout, data);

        this._gsplatData = this._createGSplatData(layout.numSplats, data);
        this._gsplatResource = new pc.GSplatResource(this.app.graphicsDevice, this._gsplatData);
        this._gsplatAsset = new pc.Asset("procedural-fog", "gsplat", null);
        this.app.assets.add(this._gsplatAsset);
        this._gsplatAsset.resource = this._gsplatResource;

        this._splatEntity = new pc.Entity("ProceduralSplatsFog");
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
        const size = this._getVolumeSize();
        const volume = Math.max(size.x * size.y * size.z, 0.000001);
        const idealSpacing = Math.cbrt(volume / targetSplats);
        let spacingMin = 0.0001;
        let spacingMax = Math.max(size.x, size.y, size.z) + idealSpacing;

        for (let i = 0; i < 24; i++) {
            const mid = (spacingMin + spacingMax) * 0.5;
            const counts = this._countsForSpacing(size, mid);
            const count = counts.x * counts.y * counts.z;

            if (count > targetSplats) {
                spacingMin = mid;
            } else {
                spacingMax = mid;
            }
        }

        const counts = this._countsForSpacing(size, spacingMax);
        const spacing = spacingMax;

        return {
            size,
            spacing,
            counts,
            numSplats: counts.x * counts.y * counts.z,
        };
    }

    _countsForSpacing(size, spacing) {
        return {
            x: Math.max(1, Math.floor(size.x / spacing) + 1),
            y: Math.max(1, Math.floor(size.y / spacing) + 1),
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

    _writeFog(layout, data) {
        const size = layout.size;

        const baseR = this._clamp01(this.color.r);
        const baseG = this._clamp01(this.color.g);
        const baseB = this._clamp01(this.color.b);
        const alpha = this._clamp01(this.alpha);
        const overlap = Math.max(0.01, this.overlapScale);
        const spacing = layout.spacing;
        const derivedSize = Math.max(
            0.001,
            (layout.numSplats > 1 ? spacing * 0.5 : Math.min(size.x, size.y, size.z) * 0.5) * overlap,
        );
        const logSize = Math.log(derivedSize);

        let i = 0;
        for (let y = 0; y < layout.counts.y; y++) {
            for (let z = 0; z < layout.counts.z; z++) {
                for (let x = 0; x < layout.counts.x; x++) {
                    const px = this._axisPosition(x, layout.counts.x, spacing, layout.size.x);
                    const py = this._axisPosition(y, layout.counts.y, spacing, layout.size.y);
                    const pz = this._axisPosition(z, layout.counts.z, spacing, layout.size.z);

                    const softness = this._softness(x, y, z, layout.counts);
                    const r = this._clamp01(baseR - softness * 0.04);
                    const g = this._clamp01(baseG - softness * 0.03);
                    const b = this._clamp01(baseB - softness * 0.02);

                    data.x[i] = px;
                    data.y[i] = py;
                    data.z[i] = pz;
                    data.scale_0[i] = logSize;
                    data.scale_1[i] = logSize;
                    data.scale_2[i] = logSize;
                    data.f_dc_0[i] = (r - 0.5) / SH_C0;
                    data.f_dc_1[i] = (g - 0.5) / SH_C0;
                    data.f_dc_2[i] = (b - 0.5) / SH_C0;
                    data.opacity[i] = this._alphaToOpacity(alpha);

                    i++;
                }
            }
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

    _axisPosition(index, count, spacing, axisSize) {
        if (count <= 1) {
            return 0;
        }

        const usedSpan = (count - 1) * spacing;
        const start = -usedSpan * 0.5;
        const slack = axisSize - usedSpan;
        return start + index * spacing + slack * 0.5;
    }

    _softness(x, y, z, counts) {
        const nx = this._normalizedIndex(x, counts.x);
        const ny = this._normalizedIndex(y, counts.y);
        const nz = this._normalizedIndex(z, counts.z);
        const dx = Math.abs(nx - 0.5) * 2;
        const dy = Math.abs(ny - 0.5) * 2;
        const dz = Math.abs(nz - 0.5) * 2;
        return (dx + dy + dz) / 3;
    }

    _normalizedIndex(index, count) {
        if (count <= 1) {
            return 0.5;
        }

        return index / (count - 1);
    }

    _getVolumeSize() {
        return {
            x: Math.max(0.05, this.volumeSize.x),
            y: Math.max(0.05, this.volumeSize.y),
            z: Math.max(0.05, this.volumeSize.z),
        };
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
    }

    onPropertyChanged() {
        if (!pc.GSplatData || !pc.GSplatResource || !pc.GSplatInstance) {
            return;
        }

        this._rebuild();
    }

    destroy() {
        this._destroySplatEntity();
    }
}
