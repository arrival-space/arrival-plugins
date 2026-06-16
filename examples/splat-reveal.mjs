/**
 * Splat Reveal
 *
 * Plays a configurable "reveal" animation on the space's ALREADY-LOADED Gaussian
 * splat (the unified / LOD-streaming splat system), inspired by:
 *   https://playcanvas.vercel.app/#/gaussian-splatting/reveal
 *
 * Several reveal patterns are included (radial wave, vertical sweeps, rain,
 * scatter, dissolve). As each splat is reached it pops in from a tiny dot, grows
 * to full size while moving into place (falling / scattering / rising), and
 * flashes a glow tint that fades to its original color.
 *
 * --- How it hooks the UNIFIED LOD-streaming splat (the important part) ---
 * Arrival.Space renders the environment splat through PlayCanvas' unified,
 * LOD-streaming gsplat pipeline (engine 2.19.x), which pre-transforms splats
 * into a GPU work buffer. REPLACING the vertex shader on the shared material
 * therefore breaks rendering and the splat vanishes.
 *
 * Instead this plugin overrides the engine's OFFICIAL per-splat customization
 * hook — the `gsplatModifyVS` chunk — whose three functions are called by the
 * splat pipeline itself (work-buffer copy pass `gsplatCopyToWorkbuffer`, and the
 * per-vertex `gsplat` / `gsplatCorner` chunks):
 *   modifySplatCenter(inout vec3 center)                                  // move splats
 *   modifySplatRotationScale(orig, mod, inout vec4 rot, inout vec3 scale) // scale / hide
 *   modifySplatColor(vec3 center, inout vec4 color)                       // recolor / fade
 * Because the work-buffer machinery is untouched, this works on unified LOD
 * splats and the per-component case, and leaves the space's own
 * brightness/contrast pixel shader intact.
 *
 * --- WebGL AND WebGPU (the "work for both" part) ---
 * The engine renders splats with GLSL on a WebGL2 device and with WGSL on a
 * WebGPU device, drawing the hook from the matching shader-chunk set. So we
 * override `gsplatModifyVS` in BOTH languages — `getShaderChunks("glsl")` and
 * `getShaderChunks("wgsl")` — with two source twins that implement identical
 * logic. The device only ever compiles the language it uses; setting the other
 * is harmless, so the plugin is device-agnostic with no runtime branching.
 *
 * The three hooks run in order within a single shader invocation, so we compute
 * the per-splat reveal value once in modifySplatCenter and stash it in a shader
 * global (gReveal) that modifySplatRotationScale and modifySplatColor reuse.
 *
 * Driven by one `uProgress` uniform; the original chunk is restored on unload.
 */

// ─── Custom per-splat hooks (gsplatModifyVS) ─────────────────────────────────

// GLSL twin — used on WebGL2 devices.
const REVEAL_GLSL = /* glsl */ `
uniform float uProgress;     // overall reveal 0..1
uniform float uTime;         // seconds since reveal start (for the bloom twinkle)
uniform float uBand;         // per-splat overlap / softness (0..1)
uniform int   uPattern;      // 0 radial, 1 sweep-up, 2 sweep-down, 3 rain, 4 scatter, 5 dissolve, 6 bloom
uniform float uJitter;       // per-splat random timing offset (0..1)
uniform float uDotScale;     // initial dot size (fraction of full size)
uniform float uMotion;       // entrance travel distance (fall / scatter / rise)
uniform float uLift;         // settle hop height as a splat finishes growing
uniform float uBump;         // end-of-reveal scale overshoot (0 = none), pulses once
uniform vec3  uCenter;       // wave origin for the radial pattern (world space)
uniform float uMaxDist;      // farthest splat distance from uCenter (for normalising)
uniform vec3  uBoundsMin;    // world AABB min
uniform vec3  uBoundsMax;    // world AABB max
uniform vec3  uTint;         // glow color while a splat appears
uniform float uTintStrength; // strength of the appear glow

// per-splat reveal value, shared between the three hooks (same VS invocation)
float gReveal = 0.0;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
}

// 0..1 "arrival" value for a splat — when (scaled) progress passes it, it shows.
float revealArrival(vec3 c) {
    vec3 span = max(uBoundsMax - uBoundsMin, vec3(0.001));
    vec3 n = clamp((c - uBoundsMin) / span, 0.0, 1.0);
    if (uPattern == 0) return clamp(length(c - uCenter) / max(uMaxDist, 0.001), 0.0, 1.0);
    if (uPattern == 1) return n.y;          // sweep up   (bottom first)
    if (uPattern == 2) return 1.0 - n.y;    // sweep down (top first)
    if (uPattern == 3) return 1.0 - n.y;    // rain       (top first, falls in)
    return hash13(c);                       // scatter / dissolve (random)
}

// entrance offset a splat travels from while it grows in.
vec3 revealEntrance(vec3 c) {
    if (uPattern == 3) return vec3(0.0, uMotion, 0.0);             // drop from above
    if (uPattern == 4) return (hash33(c) - 0.5) * 2.0 * uMotion;   // scatter in
    return vec3(0.0, -uMotion * 0.5, 0.0);                         // gently rise from below
}

// reveal value (0..1) for a splat from its original center
float revealValue(vec3 c) {
    float a = revealArrival(c) + (hash13(c + 7.0) - 0.5) * uJitter;
    return smoothstep(0.0, 1.0, (uProgress * (1.0 + uBand) - a) / max(uBand, 0.001));
}

void modifySplatCenter(inout vec3 center) {
    // Color-driven modes (>= 6) leave geometry untouched and reveal in
    // modifySplatColor, which is where the splat color is available.
    if (uPattern >= 6) {
        gReveal = 1.0;
        return;
    }

    vec3 c0 = center;
    gReveal = revealValue(c0);

    center += revealEntrance(c0) * (1.0 - gReveal);     // travel into place
    center.y += sin(gReveal * 3.14159265) * uLift;      // settle hop
}

void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    if (gReveal <= 0.0) {
        scale = vec3(0.0);                              // hidden until reached
        return;
    }
    // grow from dot to full, then a one-shot "bump" overshoot at the very end
    scale *= mix(uDotScale, 1.0, gReveal) * (1.0 + uBump);
}

void modifySplatColor(vec3 center, inout vec4 color) {
    if (uPattern >= 6) {
        // ── brightness-driven "bloom": bright splats ignite first ──
        float lum = dot(max(color.rgb, 0.0), vec3(0.2126, 0.7152, 0.0722));
        float b = lum / (lum + 0.5);                     // soft 0..1 normalise
        float a = (1.0 - b) + (hash13(color.rgb * 131.0) - 0.5) * uJitter; // bright = early
        float rv = smoothstep(0.0, 1.0, (uProgress * (1.0 + uBand) - a) / max(uBand, 0.001));
        if (rv <= 0.0) {
            color.a = 0.0;
            return;
        }
        float glow = 4.0 * rv * (1.0 - rv);
        color.rgb += (color.rgb + uTint) * glow * uTintStrength;   // ignite flare
        // gentle ongoing twinkle on the brightest splats
        float tw = 0.5 + 0.5 * sin(uTime * 4.0 + hash13(color.rgb * 53.0) * 6.2831);
        color.rgb += color.rgb * tw * 0.12 * b * rv;
        color.a *= rv;
        return;
    }

    if (gReveal <= 0.0) {
        color.a = 0.0;
        return;
    }
    float glow = 4.0 * gReveal * (1.0 - gReveal);       // flash, brightest mid-appearance
    color.rgb = mix(color.rgb, uTint, glow * uTintStrength);
    color.a *= gReveal;
}
`;

// WGSL twin — used on WebGPU devices. Identical logic to REVEAL_GLSL. PlayCanvas
// WGSL declares uniforms as `uniform name: type;` and reads them via `uniform.name`;
// inout params become `ptr<function, T>` (deref with `*p`); module globals use
// `var<private>`; multi-component swizzles can be read but not assigned, so colors
// are rebuilt with `vec4f(...)` instead of writing `color.rgb`.
const REVEAL_WGSL = /* wgsl */ `
uniform uProgress: f32;       // overall reveal 0..1
uniform uTime: f32;           // seconds since reveal start (for the bloom twinkle)
uniform uBand: f32;           // per-splat overlap / softness (0..1)
uniform uPattern: i32;        // 0 radial, 1 sweep-up, 2 sweep-down, 3 rain, 4 scatter, 5 dissolve, 6 bloom
uniform uJitter: f32;         // per-splat random timing offset (0..1)
uniform uDotScale: f32;       // initial dot size (fraction of full size)
uniform uMotion: f32;         // entrance travel distance (fall / scatter / rise)
uniform uLift: f32;           // settle hop height as a splat finishes growing
uniform uBump: f32;           // end-of-reveal scale overshoot (0 = none), pulses once
uniform uCenter: vec3f;       // wave origin for the radial pattern (world space)
uniform uMaxDist: f32;        // farthest splat distance from uCenter (for normalising)
uniform uBoundsMin: vec3f;    // world AABB min
uniform uBoundsMax: vec3f;    // world AABB max
uniform uTint: vec3f;         // glow color while a splat appears
uniform uTintStrength: f32;   // strength of the appear glow

// per-splat reveal value, shared between the three hooks (same shader invocation)
var<private> gReveal: f32 = 0.0;

fn hash13(p0: vec3f) -> f32 {
    var p = fract(p0 * 0.1031);
    p += vec3f(dot(p, p.yzx + vec3f(33.33)));
    return fract((p.x + p.y) * p.z);
}

fn hash33(p0: vec3f) -> vec3f {
    var p = fract(p0 * vec3f(0.1031, 0.1030, 0.0973));
    p += vec3f(dot(p, p.yxz + vec3f(33.33)));
    return fract((p.xxy + p.yxx) * p.zyx);
}

// 0..1 "arrival" value for a splat — when (scaled) progress passes it, it shows.
fn revealArrival(c: vec3f) -> f32 {
    let span = max(uniform.uBoundsMax - uniform.uBoundsMin, vec3f(0.001));
    let n = clamp((c - uniform.uBoundsMin) / span, vec3f(0.0), vec3f(1.0));
    if (uniform.uPattern == 0) { return clamp(length(c - uniform.uCenter) / max(uniform.uMaxDist, 0.001), 0.0, 1.0); }
    if (uniform.uPattern == 1) { return n.y; }          // sweep up   (bottom first)
    if (uniform.uPattern == 2) { return 1.0 - n.y; }    // sweep down (top first)
    if (uniform.uPattern == 3) { return 1.0 - n.y; }    // rain       (top first, falls in)
    return hash13(c);                                   // scatter / dissolve (random)
}

// entrance offset a splat travels from while it grows in.
fn revealEntrance(c: vec3f) -> vec3f {
    if (uniform.uPattern == 3) { return vec3f(0.0, uniform.uMotion, 0.0); }             // drop from above
    if (uniform.uPattern == 4) { return (hash33(c) - vec3f(0.5)) * 2.0 * uniform.uMotion; } // scatter in
    return vec3f(0.0, -uniform.uMotion * 0.5, 0.0);                                     // gently rise from below
}

// reveal value (0..1) for a splat from its original center
fn revealValue(c: vec3f) -> f32 {
    let a = revealArrival(c) + (hash13(c + vec3f(7.0)) - 0.5) * uniform.uJitter;
    return smoothstep(0.0, 1.0, (uniform.uProgress * (1.0 + uniform.uBand) - a) / max(uniform.uBand, 0.001));
}

fn modifySplatCenter(center: ptr<function, vec3f>) {
    // Color-driven modes (>= 6) leave geometry untouched and reveal in
    // modifySplatColor, which is where the splat color is available.
    if (uniform.uPattern >= 6) {
        gReveal = 1.0;
        return;
    }

    let c0 = *center;
    gReveal = revealValue(c0);

    *center += revealEntrance(c0) * (1.0 - gReveal);    // travel into place
    (*center).y += sin(gReveal * 3.14159265) * uniform.uLift; // settle hop
}

fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
    if (gReveal <= 0.0) {
        *scale = vec3f(0.0);                            // hidden until reached
        return;
    }
    // grow from dot to full, then a one-shot "bump" overshoot at the very end
    *scale *= mix(uniform.uDotScale, 1.0, gReveal) * (1.0 + uniform.uBump);
}

fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    if (uniform.uPattern >= 6) {
        // ── brightness-driven "bloom": bright splats ignite first ──
        let lum = dot(max((*color).rgb, vec3f(0.0)), vec3f(0.2126, 0.7152, 0.0722));
        let b = lum / (lum + 0.5);                       // soft 0..1 normalise
        let a = (1.0 - b) + (hash13((*color).rgb * 131.0) - 0.5) * uniform.uJitter; // bright = early
        let rv = smoothstep(0.0, 1.0, (uniform.uProgress * (1.0 + uniform.uBand) - a) / max(uniform.uBand, 0.001));
        if (rv <= 0.0) {
            (*color).a = 0.0;
            return;
        }
        let glow = 4.0 * rv * (1.0 - rv);
        var rgb = (*color).rgb + ((*color).rgb + uniform.uTint) * (glow * uniform.uTintStrength); // ignite flare
        // gentle ongoing twinkle on the brightest splats
        let tw = 0.5 + 0.5 * sin(uniform.uTime * 4.0 + hash13(rgb * 53.0) * 6.2831);
        rgb += rgb * (tw * 0.12 * b * rv);
        *color = vec4f(rgb, (*color).a * rv);
        return;
    }

    if (gReveal <= 0.0) {
        (*color).a = 0.0;
        return;
    }
    let glow = 4.0 * gReveal * (1.0 - gReveal);         // flash, brightest mid-appearance
    let rgb = mix((*color).rgb, uniform.uTint, glow * uniform.uTintStrength);
    *color = vec4f(rgb, (*color).a * gReveal);
}
`;

const MODIFY_CHUNK = "gsplatModifyVS";

const PATTERNS = {
    radial: 0,
    "sweep-up": 1,
    "sweep-down": 2,
    rain: 3,
    scatter: 4,
    dissolve: 5,
    bloom: 6,
};

// Duration of the one-shot scale "bump" at the end of the reveal.
const BUMP_TIME = 0.45;

// ─── Plugin ──────────────────────────────────────────────────────────────────

export class SplatReveal extends ArrivalScript {
    static scriptName = "Splat Reveal";

    pattern = "scatter";   // radial | sweep-up | sweep-down | rain | scatter | dissolve | bloom
    duration = 3;         // seconds for a full reveal
    band = 0.35;          // per-splat overlap / softness (0 = all at once)
    jitter = 0.15;        // per-splat random timing for organic edges
    dotScale = 0.12;      // initial dot size as a fraction of full size
    motion = 1.5;         // entrance travel distance (fall / scatter / rise)
    lift = 0.2;           // settle hop as a splat finishes growing
    bump = 0.25;          // scale overshoot pulse when the reveal finishes (0 = off)

    // Glow.
    tintColor = { r: 0.6, g: 0.85, b: 1 };
    tintStrength = 0.8;

    // Playback.
    loop = false;          // restart automatically once finished
    loopPause = 1.5;      // seconds to wait between loops

    static properties = {
        pattern: {
            title: "Pattern",
            options: [
                { label: "Radial", value: "radial" },
                { label: "Sweep Up", value: "sweep-up" },
                { label: "Sweep Down", value: "sweep-down" },
                { label: "Rain", value: "rain" },
                { label: "Scatter", value: "scatter" },
                { label: "Dissolve", value: "dissolve" },
                { label: "Bloom (by brightness)", value: "bloom" },
            ],
        },
        duration: { title: "Duration (s)", min: 0.2, max: 20 },
        band: { title: "Softness", min: 0, max: 1 },
        jitter: { title: "Jitter", min: 0, max: 1 },
        dotScale: { title: "Dot Size", min: 0.01, max: 1 },
        motion: { title: "Entrance Motion", min: 0, max: 10 },
        lift: { title: "Settle Hop", min: 0, max: 3 },
        bump: { title: "End Bump", min: 0, max: 2 },
        tintColor: { title: "Glow Color" },
        tintStrength: { title: "Glow Strength", min: 0, max: 1 },
        loop: { title: "Loop" },
        loopPause: { title: "Loop Pause (s)", min: 0, max: 10 },
    };

    _materials = new Set();   // materials we currently drive
    _touched = new Map();     // material -> { glsl, wgsl } restore records ({ had, orig } or null)
    _center = [0, 0, 0];
    _min = [-25, -25, -25];
    _max = [25, 25, 25];
    _maxDist = 25;
    _time = 0;
    _waiting = 0;
    _done = false;
    _bumping = false;         // playing the end-of-reveal bump
    _bumpT = 0;
    _finished = false;        // true once a non-looping reveal has torn itself down
    _destroyed = false;
    _onMatReady = null;

    initialize() {
        this._destroyed = false;
        this._finished = false;
        this._subscribe();
        this._start();
    }

    _subscribe() {
        if (this._onMatReady) return;
        this._onMatReady = (centerAsset, mat) => {
            this._computeBounds();
            this._applyToMaterial(mat);
            this._restart();
        };
        this.app.on("centerasset:splatMaterialReady", this._onMatReady, this);
    }

    _unsubscribe() {
        if (this._onMatReady) {
            this.app.off("centerasset:splatMaterialReady", this._onMatReady, this);
            this._onMatReady = null;
        }
    }

    _start() {
        this._computeBounds();
        if (!this._acquire()) {
            this._retryAcquire(60);
        } else {
            this._restart();
        }
    }

    // ── material acquisition ──────────────────────────────────────────────────

    _acquire() {
        let found = false;
        const unified = this._getUnifiedMaterial();
        if (unified) {
            this._applyToMaterial(unified);
            found = true;
        }
        const comps = this.app.root.findComponents("gsplat") || [];
        for (const c of comps) {
            if (!c.unified && c.material) {
                this._applyToMaterial(c.material);
                found = true;
            }
        }
        return found;
    }

    _retryAcquire(framesLeft) {
        if (this._destroyed || framesLeft <= 0) {
            if (!this._destroyed && this._materials.size === 0) {
                console.warn("SplatReveal: no splat material found in this space.");
            }
            return;
        }
        this.app.once("frameend", () => {
            if (this._destroyed) return;
            this._computeBounds();
            if (this._acquire()) {
                this._restart();
            } else {
                this._retryAcquire(framesLeft - 1);
            }
        });
    }

    // Reach the shared material used by the unified splat pipeline. Mirrors the
    // client's getUnifiedSplatMaterial(). Returns null if unavailable.
    _getUnifiedMaterial() {
        try {
            const app = this.app;
            const cam = app.root.findByName("Camera")?.camera;
            if (!cam) return null;
            const cameraData = app.renderer?.gsplatDirector?.getCameraData(cam.camera);
            const layer = app.scene.layers.getLayerByName("Splats");
            const layerInfo = cameraData?.layersMap?.get(layer);
            return layerInfo?.gsplatManager?.renderer?._material || null;
        } catch (e) {
            return null;
        }
    }

    // Fetch a material's shader-chunk map for one language, or null if the
    // material/device doesn't expose it.
    _getChunks(mat, lang) {
        try {
            return mat.getShaderChunks(lang);
        } catch (e) {
            return null;
        }
    }

    _applyToMaterial(mat) {
        if (!mat) return;

        // GLSL is the baseline (WebGL2); WGSL is added when the material exposes
        // it (WebGPU). We set both so the plugin is device-agnostic.
        const glsl = this._getChunks(mat, "glsl");
        if (!glsl) return;
        const wgsl = this._getChunks(mat, "wgsl");

        if (!this._touched.has(mat)) {
            this._touched.set(mat, {
                glsl: { had: glsl.has(MODIFY_CHUNK), orig: glsl.get(MODIFY_CHUNK) },
                wgsl: wgsl ? { had: wgsl.has(MODIFY_CHUNK), orig: wgsl.get(MODIFY_CHUNK) } : null,
            });
        }

        glsl.set(MODIFY_CHUNK, REVEAL_GLSL);
        if (wgsl) wgsl.set(MODIFY_CHUNK, REVEAL_WGSL);

        this._setUniforms(mat);
        mat.update();
        this._materials.add(mat);
    }

    _setUniforms(mat) {
        mat.setParameter("uProgress", this._progress());
        mat.setParameter("uTime", this._time);
        mat.setParameter("uBump", 0);
        mat.setParameter("uBand", this.band);
        mat.setParameter("uPattern", PATTERNS[this.pattern] ?? 0);
        mat.setParameter("uJitter", this.jitter);
        mat.setParameter("uDotScale", this.dotScale);
        mat.setParameter("uMotion", this.motion);
        mat.setParameter("uLift", this.lift);
        mat.setParameter("uCenter", this._center);
        mat.setParameter("uMaxDist", this._maxDist);
        mat.setParameter("uBoundsMin", this._min);
        mat.setParameter("uBoundsMax", this._max);
        mat.setParameter("uTint", [this.tintColor.r, this.tintColor.g, this.tintColor.b]);
        mat.setParameter("uTintStrength", this.tintStrength);
    }

    // ── bounds ────────────────────────────────────────────────────────────────

    _computeBounds() {
        const comps = this.app.root.findComponents("gsplat") || [];
        let bb = null;
        for (const c of comps) {
            const aabb =
                c.instance?.meshInstance?.aabb ||
                c.instance?.aabb ||
                c.customAabb ||
                null;
            if (!aabb || !aabb.halfExtents) continue;
            if (!bb) bb = aabb.clone();
            else bb.add(aabb);
        }

        if (bb) {
            const c = bb.center;
            const h = bb.halfExtents;
            this._center = [c.x, c.y, c.z];
            this._min = [c.x - h.x, c.y - h.y, c.z - h.z];
            this._max = [c.x + h.x, c.y + h.y, c.z + h.z];
            this._maxDist = Math.max(h.length(), 1);
        } else {
            this._center = [0, 0, 0];
            this._min = [-25, -25, -25];
            this._max = [25, 25, 25];
            this._maxDist = 25;
        }
    }

    // ── playback ──────────────────────────────────────────────────────────────

    _progress() {
        return Math.min(this._time / Math.max(this.duration, 0.0001), 1);
    }

    _restart() {
        this._time = 0;
        this._waiting = 0;
        this._done = false;
        this._bumping = false;
        this._bumpT = 0;
        for (const m of this._materials) {
            m.setParameter("uProgress", 0);
            m.setParameter("uBump", 0);
        }
    }

    // Called once the reveal reaches 100%. Either kicks off the end bump or
    // moves straight to looping / teardown.
    _onComplete() {
        this._done = true;
        if (this.bump > 0) {
            this._bumping = true;
            this._bumpT = 0;
        } else {
            this._afterBump();
        }
    }

    _afterBump() {
        if (this.loop) {
            this._waiting = this.loopPause;
        } else {
            // Fully revealed → remove the shader override entirely so the splat
            // renders with its normal pipeline and costs nothing.
            this._finish();
        }
    }

    update(dt) {
        if (this._materials.size === 0) return;

        // Keep the bloom twinkle alive while the chunk is active.
        this._time += dt;
        for (const m of this._materials) m.setParameter("uTime", this._time);

        if (this._waiting > 0) {
            this._waiting -= dt;
            if (this._waiting <= 0) this._restart();
            return;
        }

        // End-of-reveal bump: one quick scale overshoot (up and back).
        if (this._bumping) {
            this._bumpT += dt;
            const env = this._bumpT < BUMP_TIME ? Math.sin(Math.PI * this._bumpT / BUMP_TIME) : 0;
            const u = env * this.bump;
            for (const m of this._materials) m.setParameter("uBump", u);
            if (this._bumpT >= BUMP_TIME) {
                this._bumping = false;
                for (const m of this._materials) m.setParameter("uBump", 0);
                this._afterBump();
            }
            return;
        }

        if (this._done) return;

        const p = this._progress();
        for (const m of this._materials) m.setParameter("uProgress", p);

        if (p >= 1) {
            this._onComplete();
        }
    }

    onPropertyChanged(name, value) {
        const restartTrigger =
            name === "pattern" || name === "duration" || name === "band" || name === "jitter";

        // If a one-shot reveal already tore itself down, editor tweaks (or
        // turning Loop back on) should replay it from scratch.
        if (this._finished) {
            if (restartTrigger || name === "loop") this._replay();
            return;
        }

        if (this._materials.size === 0) return;

        for (const m of this._materials) {
            switch (name) {
                case "band": m.setParameter("uBand", value); break;
                case "pattern": m.setParameter("uPattern", PATTERNS[value] ?? 0); break;
                case "jitter": m.setParameter("uJitter", value); break;
                case "dotScale": m.setParameter("uDotScale", value); break;
                case "motion": m.setParameter("uMotion", value); break;
                case "lift": m.setParameter("uLift", value); break;
                case "tintStrength": m.setParameter("uTintStrength", value); break;
                case "tintColor":
                    m.setParameter("uTint", [value.r, value.g, value.b]);
                    break;
                default: break;
            }
        }

        // Replay from the start when a timing/pattern property changes.
        if (restartTrigger) {
            this._restart();
        }
    }

    // ── teardown ──────────────────────────────────────────────────────────────

    // Restore one language's chunk map for a material to its original state.
    _restoreLang(mat, lang, rec) {
        if (!rec) return;
        try {
            const chunks = mat.getShaderChunks(lang);
            if (rec.had) chunks.set(MODIFY_CHUNK, rec.orig);
            else chunks.delete(MODIFY_CHUNK);
            mat.update();
        } catch (e) {
            /* material may already be gone */
        }
    }

    // Restore every material we touched to its original shader chunks (both
    // languages) and let the client rebuild its splat pipeline. Used by both
    // _finish() and destroy().
    _restoreMaterials() {
        for (const [mat, info] of this._touched) {
            this._restoreLang(mat, "glsl", info.glsl);
            this._restoreLang(mat, "wgsl", info.wgsl);
        }
        this._touched.clear();
        this._materials.clear();

        try {
            this.app.fire("reApplySplatMaterial");
        } catch (e) {
            /* ignore */
        }
    }

    // Called when a non-looping reveal completes: drop the override so there is
    // zero ongoing cost, but keep the plugin alive (it can replay on edit).
    _finish() {
        if (this._finished) return;
        this._finished = true;
        this._done = true;
        this._unsubscribe();
        this._restoreMaterials();
    }

    // Re-arm after a one-shot reveal has finished (e.g. an editor change).
    _replay() {
        this._finished = false;
        this._done = false;
        this._subscribe();
        this._start();
    }

    destroy() {
        this._destroyed = true;
        this._unsubscribe();
        this._restoreMaterials();
    }
}
