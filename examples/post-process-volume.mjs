/**
 * PostProcessVolume
 *
 * Unreal-style local volume that smoothly overrides room post-effects
 * when the camera enters the trigger sphere.
 *
 * - Trigger Radius: inner zone (full effect)
 * - Blend Radius: soft outer edge (smoothstep falloff)
 * - Blend Weight: overall strength cap
 *
 * Base post-effect values are captured once on init so they can be
 * cleanly restored when the camera leaves the volume.
 */
export class PostProcessVolume extends ArrivalScript {
    static scriptName = 'PostProcessVolume';

    triggerRadius = 3;
    blendRadius = 2;
    blendWeight = 1;

    saturation = 2.4;
    contrast = 1;
    brightness = 1;
    sharpness = 1;
    bloomIntensity = 0.2;

    debugVolume = false;

    static properties = {
        triggerRadius: { title: 'Trigger Radius', min: 0.5, max: 50 },
        blendRadius: { title: 'Blend Radius', min: 0, max: 50 },
        blendWeight: { title: 'Blend Weight', min: 0, max: 1, step: 0.01 },

        saturation: { title: 'Saturation', min: 0, max: 3 },
        contrast: { title: 'Contrast', min: 0, max: 3 },
        brightness: { title: 'Brightness', min: 0, max: 3 },
        sharpness: { title: 'Sharpness', min: 0, max: 3 },
        bloomIntensity: { title: 'Bloom Intensity', min: 0, max: 1 },

        debugVolume: { title: 'Debug Volume' },
    };

    /** @type {Object|null} Snapshot of room post-effects at init time */
    _baseParams = null;

    /** Previous blend weight so we can skip redundant updates */
    _prevWeight = -1;

    initialize() {
        this._captureBase();
    }

    /** Snapshot the room's current post-effect state before we touch anything. */
    _captureBase() {
        const ctc = this.app.customTravelCenter;
        const camera = this.app.root.findByName('Camera');
        const bloom = camera?.script?.bloom;

        this._baseParams = {
            hdrEnabled: false,
            toneMapping: camera?.camera?.toneMapping ?? Number(ctc?.roomData?.toneMapping ?? 3),
            saturation: bloom?.saturation ?? 1,
            contrast: bloom?.contrast ?? 1,
            brightness: bloom?.brightness ?? 1,
            sharpness: bloom?.sharpness ?? 1,
            gamma: bloom?.gamma ?? 1,
            bloomEnabled: (bloom?.bloomIntensity ?? 1) > 0,
            bloomIntensity: (bloom?.bloomIntensity ?? 1) * 0.15,
            bloomThreshold: bloom?.bloomThreshold ?? 0.9,
            bloomBlurLevel: bloom?.blurAmount ?? 4,
            bloomDebug: !!bloom?.debug,
            ...(ctc?.roomData?.framePosteffectParams || {}),
        };
    }

    update() {
        if (this.debugVolume) this._drawDebug();
        this._applyPostEffects();
    }

    onPropertyChanged() {
        this._prevWeight = -1; // force re-apply next frame
    }

    // --- Volume weight ---

    _weightAt(cameraPos) {
        const d = cameraPos.distance(this.position);
        const core = Math.max(0.001, this.triggerRadius);
        const blend = Math.max(0, this.blendRadius);
        const maxWeight = pc.math.clamp(this.blendWeight, 0, 1);

        if (d <= core) return maxWeight;
        if (blend === 0 || d >= core + blend) return 0;

        const t = pc.math.clamp(1 - (d - core) / blend, 0, 1);
        return t * t * (3 - 2 * t) * maxWeight; // smoothstep
    }

    // --- Post-effect application ---

    _applyPostEffects() {
        const ctc = this.app.customTravelCenter;
        const cam = ArrivalSpace.getCamera();
        if (!ctc?.updatePostEffects || !cam || !this._baseParams) return;

        const w = this._weightAt(cam.getPosition());

        // Skip if weight hasn't changed meaningfully
        if (Math.abs(w - this._prevWeight) < 0.0005) return;
        this._prevWeight = w;

        // Fully outside — restore base
        if (w === 0) {
            ctc.updatePostEffects(this._baseParams);
            return;
        }

        // Lerp from base toward volume settings
        const base = this._baseParams;
        const lerp = pc.math.lerp;
        const blendedBloom = lerp(base.bloomIntensity, this.bloomIntensity, w);

        ctc.updatePostEffects({
            ...base,
            saturation: lerp(base.saturation, this.saturation, w),
            contrast: lerp(base.contrast, this.contrast, w),
            brightness: lerp(base.brightness, this.brightness, w),
            sharpness: lerp(base.sharpness ?? 1, this.sharpness, w),
            bloomIntensity: blendedBloom,
            bloomEnabled: blendedBloom > 0,
        });
    }

    // --- Debug visualization ---

    _drawDebug() {
        const center = this.position;
        this._drawCircle(center, this.triggerRadius, new pc.Color(0.5, 0.8, 1));
        if (this.blendRadius > 0) {
            this._drawCircle(center, this.triggerRadius + this.blendRadius, new pc.Color(0.2, 0.4, 1));
        }
    }

    _drawCircle(center, radius, color) {
        if (radius <= 0) return;

        const segments = Math.min(40, Math.round(radius * Math.PI * 6));
        const step = (2 * Math.PI) / Math.max(3, segments);
        const positions = [];

        for (let i = 0; i < segments; i++) {
            const a0 = i * step;
            const a1 = (i + 1) * step;
            positions.push(
                center.x + radius * Math.cos(a0), center.y, center.z + radius * Math.sin(a0),
                center.x + radius * Math.cos(a1), center.y, center.z + radius * Math.sin(a1),
            );
        }

        this.app.drawLineArrays(positions, color, false);
    }

    // --- Cleanup ---

    destroy() {
        const ctc = this.app.customTravelCenter;
        if (ctc?.updatePostEffects && this._baseParams) {
            ctc.updatePostEffects(this._baseParams);
        }
    }
}
