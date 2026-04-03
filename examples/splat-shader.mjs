/**
 * Splat Shader
 *
 * Loads a Gaussian Splat (.ply, .sog, .spz) and applies a custom GLSL shader.
 *
 * Demonstrates:
 * - Loading a splat via ArrivalSpace.loadSplat()
 * - Overriding gsplatVS / gsplatPS shader chunks on the material
 * - Passing custom uniforms (uTime, uTint, uPulseStrength)
 * - Updating uniforms per-frame
 *
 * The default shader adds a subtle color tint and a vertical pulse animation.
 * Edit the GLSL strings below to create your own effects.
 */

// ─── Custom Vertex Shader ────────────────────────────────────────────────────
// Override the full gsplatVS chunk.
// Uses #include "gsplatCommonVS" which provides:
//   SplatSource, SplatCenter, SplatCorner (structs)
//   initSource, readCenter, initCenter, initCorner, readColor, clipCorner,
//   evalSH, readSHData, prepareOutputFromGamma (functions)
//   matrix_model, matrix_view, matrix_viewProjection (uniforms)

const CUSTOM_VS = /* glsl */ `
#include "gsplatCommonVS"

varying mediump vec2 gaussianUV;
varying mediump vec4 gaussianColor;

#ifndef DITHER_NONE
    varying float id;
#endif

#ifdef PREPASS_PASS
    varying float vLinearDepth;
#endif

mediump vec4 discardVec = vec4(0.0, 0.0, 2.0, 1.0);

// ── custom uniforms ──
uniform float uTime;
uniform float uPulseStrength;

void main(void) {
    SplatSource source;
    if (!initSource(source)) {
        gl_Position = discardVec;
        return;
    }

    vec3 modelCenter = readCenter(source);

    // ── custom: vertical pulse wave ──
    float wave = sin(modelCenter.y * 3.0 + uTime * 2.0) * uPulseStrength;
    modelCenter.y += wave;

    SplatCenter center;
    if (!initCenter(modelCenter, center)) {
        gl_Position = discardVec;
        return;
    }

    SplatCorner corner;
    if (!initCorner(source, center, corner)) {
        gl_Position = discardVec;
        return;
    }

    vec4 clr = readColor(source);

    #if GSPLAT_AA
        clr.a *= corner.aaFactor;
    #endif

    #if SH_BANDS > 0
        vec3 dir = normalize(center.view * mat3(center.modelView));
        vec3 sh[SH_COEFFS];
        float scale;
        readSHData(source, sh, scale);
        clr.xyz += evalSH(sh, dir) * scale;
    #endif

    clipCorner(corner, clr.w);

    gl_Position = center.proj + vec4(corner.offset, 0, 0);
    gaussianUV = corner.uv;
    gaussianColor = vec4(prepareOutputFromGamma(max(clr.xyz, 0.0)), clr.w);

    #ifndef DITHER_NONE
        id = float(source.id);
    #endif

    #ifdef PREPASS_PASS
        vLinearDepth = -center.view.z;
    #endif
}
`;

// ─── Custom Fragment Shader ──────────────────────────────────────────────────
// Override the full gsplatPS chunk.

const CUSTOM_PS = /* glsl */ `
#ifndef DITHER_NONE
    #include "bayerPS"
    #include "opacityDitherPS"
    varying float id;
#endif

#ifdef PICK_PASS
    #include "pickPS"
#endif

#if defined(SHADOW_PASS) || defined(PICK_PASS) || defined(PREPASS_PASS)
    uniform float alphaClip;
#endif

#ifdef PREPASS_PASS
    varying float vLinearDepth;
    #include "floatAsUintPS"
#endif

varying mediump vec2 gaussianUV;
varying mediump vec4 gaussianColor;

// ── custom uniforms ──
uniform vec3 uTint;
uniform float uTintStrength;

void main(void) {
    mediump float A = dot(gaussianUV, gaussianUV);
    if (A > 1.0) {
        discard;
    }

    // gaussian falloff
    const float EXP4 = exp(-4.0);
    const float INV_EXP4 = 1.0 / (1.0 - EXP4);
    mediump float alpha = (exp(A * -4.0) - EXP4) * INV_EXP4 * gaussianColor.a;

    #if defined(SHADOW_PASS) || defined(PICK_PASS) || defined(PREPASS_PASS)
        if (alpha < alphaClip) {
            discard;
        }
    #endif

    #ifdef PICK_PASS
        gl_FragColor = getPickOutput();
    #elif SHADOW_PASS
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    #elif PREPASS_PASS
        gl_FragColor = float2vec4(vLinearDepth);
    #else
        if (alpha < 1.0 / 255.0) {
            discard;
        }

        #ifndef DITHER_NONE
            opacityDither(alpha, id * 0.013);
        #endif

        // ── custom: apply color tint ──
        vec3 color = mix(gaussianColor.xyz, uTint, uTintStrength);

        gl_FragColor = vec4(color * alpha, alpha);
    #endif
}
`;

// ─── Plugin ──────────────────────────────────────────────────────────────────

export class SplatShader extends ArrivalScript {
    static scriptName = "Splat Shader";

    splatUrl = "";
    splatScale = 1;
    tintColor = { r: 1, g: 0.85, b: 0.6 };
    tintStrength = 0.15;
    pulseStrength = 0.02;

    static properties = {
        splatUrl: { title: "Splat URL", editor: "asset", placeholder: ".ply / .sog / .spz" },
        splatScale: { title: "Scale", min: 0.01, max: 20 },
        tintColor: { title: "Tint Color" },
        tintStrength: { title: "Tint Strength", min: 0, max: 1 },
        pulseStrength: { title: "Pulse Strength", min: 0, max: 0.5 },
    };

    _splatEntity = null;
    _material = null;
    _time = 0;

    initialize() {
        if (this.splatUrl) {
            this._loadAndApplyShader(this.splatUrl);
        }
    }

    async _loadAndApplyShader(url) {
        this._destroySplat();

        try {
            const { entity } = await ArrivalSpace.loadSplat(url, {
                parent: this.entity,
                name: "ShaderSplat",
                scale: this.splatScale,
            });
            this._splatEntity = entity;

            // The gsplat component lives on the child entity created by loadSplat
            const gsplatEntity = entity.children[0];
            const gsplat = gsplatEntity?.gsplat;
            if (!gsplat) return;

            // Wait one frame for the material to initialize
            this.app.once("frameend", () => {
                if (!gsplat.material) return;

                const mat = gsplat.material.clone();

                // Override shader chunks (GLSL only)
                mat.getShaderChunks("glsl").set("gsplatVS", CUSTOM_VS);
                mat.getShaderChunks("glsl").set("gsplatPS", CUSTOM_PS);

                // Set initial uniform values
                mat.setParameter("uTime", 0);
                mat.setParameter("uPulseStrength", this.pulseStrength);
                mat.setParameter("uTint", [this.tintColor.r, this.tintColor.g, this.tintColor.b]);
                mat.setParameter("uTintStrength", this.tintStrength);

                mat.update();
                gsplat.material = mat;
                this._material = mat;
            });
        } catch (err) {
            console.error("SplatShader: failed to load splat", err);
        }
    }

    update(dt) {
        if (!this._material) return;
        this._time += dt;
        this._material.setParameter("uTime", this._time);
    }

    onPropertyChanged(name, value) {
        if (name === "splatUrl") {
            this._loadAndApplyShader(value);
            return;
        }

        if (name === "splatScale" && this._splatEntity) {
            this._splatEntity.setLocalScale(value, value, value);
        }

        if (!this._material) return;

        if (name === "tintColor") {
            this._material.setParameter("uTint", [value.r, value.g, value.b]);
        } else if (name === "tintStrength") {
            this._material.setParameter("uTintStrength", value);
        } else if (name === "pulseStrength") {
            this._material.setParameter("uPulseStrength", value);
        }
    }

    _destroySplat() {
        if (this._splatEntity) {
            ArrivalSpace.disposeEntity(this._splatEntity, { destroyAssets: true });
            this._splatEntity = null;
            this._material = null;
        }
    }

    destroy() {
        this._destroySplat();
    }
}
