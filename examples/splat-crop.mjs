/**
 * Splat Crop
 *
 * A movable crop box for the space's already-loaded Gaussian splat(s). This
 * vibe's OWN entity is the oriented box: move/rotate it with the gizmo and set
 * its dimensions with the Size property. Everything whose splat-center falls
 * inside the box is kept (or removed, with Invert); everything else is hidden.
 *
 * The crop is purely spatial. It applies to the scene's unified splat material
 * AND every non-unified gsplat material, so it crops all splats in the box at
 * once — the box is the only selector (a per-entity reference is meaningless for
 * the shared unified material). Implemented as a gsplatModifyVS shader chunk
 * (GLSL + WGSL) so it works on WebGL and WebGPU.
 */

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

const CROP_CHUNK = "gsplatModifyVS";

// Oriented-box crop. The splat center (in whatever space the work buffer
// presents it) is mapped into box-local space by uBoxInv, then tested against
// the box half-extents. Splats on the hidden side are scaled to zero; splats
// near the kept faces are softened by uEdgeScaleFactor (3-sigma bound).
const CROP_GLSL = /* glsl */ `
uniform mat4  uBoxInv;        // splat-center space -> box-local space
uniform vec3  uHalfExtents;   // box half-extents (m)
uniform float uInvert;        // 0 = keep inside, 1 = remove inside
uniform float uEdgeScaleFactor;

void modifySplatCenter(inout vec3 center) {}

void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    vec3 p = (uBoxInv * vec4(modifiedCenter, 1.0)).xyz;
    bool inside = all(lessThanEqual(abs(p), uHalfExtents));
    bool hide = (uInvert > 0.5) ? inside : !inside;
    if (hide) { scale = vec3(0.0); return; }

    float maxRadius = length(scale) * 3.0;
    vec3 d = uHalfExtents - abs(p);          // distance to nearest face (kept side)
    float minDist = min(min(d.x, d.y), d.z);
    if (maxRadius > minDist) {
        scale *= (minDist / maxRadius) * uEdgeScaleFactor;
    }
}

void modifySplatColor(vec3 center, inout vec4 color) {}
`;

const CROP_WGSL = /* wgsl */ `
uniform uBoxInv: mat4x4f;
uniform uHalfExtents: vec3f;
uniform uInvert: f32;
uniform uEdgeScaleFactor: f32;

fn modifySplatCenter(center: ptr<function, vec3f>) {}

fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
    let p = (uniform.uBoxInv * vec4f(modifiedCenter, 1.0)).xyz;
    let inside = all(abs(p) <= uniform.uHalfExtents);
    let hide = select(!inside, inside, uniform.uInvert > 0.5);
    if (hide) { *scale = vec3f(0.0); return; }

    let maxRadius = length(*scale) * 3.0;
    let d = uniform.uHalfExtents - abs(p);
    let minDist = min(min(d.x, d.y), d.z);
    if (maxRadius > minDist) {
        *scale = (*scale) * ((minDist / maxRadius) * uniform.uEdgeScaleFactor);
    }
}

fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {}
`;

export class SplatCrop extends ArrivalScript {
    static scriptName = "Splat Crop";

    size = { x: 10, y: 10, z: 10 };
    invert = false;
    edgeScaleFactor = 0.5;
    showBox = true;

    static properties = {
        size: { title: "Box Size (m)", min: 0.1, max: 1000, step: 0.1 },
        invert: { title: "Invert (carve hole)" },
        edgeScaleFactor: { title: "Edge Softness", min: 0.01, max: 1, step: 0.01 },
        showBox: { title: "Show Box" },
    };

    // ── internal state ──
    _boxColor = new pc.Color(0.2, 1, 0.4, 1);
    _materials = new Set();
    _touched = new Map();
    _entries = new Map(); // mat -> { comp: gsplatComponent|null }
    _destroyed = false;
    _acquireTimer = 0;

    initialize() {
        this._destroyed = false;
        if (!this._acquire()) this._retryAcquire(120);
    }

    update(dt) {
        // Cheap periodic re-acquire: catches splats that streamed in after init
        // and any new non-unified gsplat materials. Idempotent for known mats.
        this._acquireTimer += dt;
        if (this._acquireTimer > 1) {
            this._acquireTimer = 0;
            this._acquire();
        }
        if (this._materials.size > 0) this._updateAllUniforms();
        if (this.showBox) this._drawBox();
    }

    onPropertyChanged(name) {
        // Uniforms are refreshed every frame in update(); this gives immediate
        // feedback when the splat isn't moving and centralizes any future
        // re-acquire triggers.
        if (this._materials.size > 0) this._updateAllUniforms();
    }

    destroy() {
        this._destroyed = true;
        this._restoreMaterials();
    }

    // ────────────────────────────────────────────
    // Splat material acquisition + chunk apply/restore
    // (mirrors splat-reveal.mjs — the proven path in this client)
    // ────────────────────────────────────────────

    _shaderLang() {
        return this.app.graphicsDevice?.isWebGPU ? "wgsl" : "glsl";
    }

    _cropCode() {
        return this._shaderLang() === "wgsl" ? CROP_WGSL : CROP_GLSL;
    }

    // Reach the shared material used by the unified splat pipeline. Mirrors
    // splat-reveal.mjs _getUnifiedMaterial().
    _getUnifiedMaterial() {
        try {
            const app = this.app;
            const cam = app.root.findByName("Camera")?.camera;
            if (!cam) return null;
            const cameraData = app.renderer?.gsplatDirector?.getCameraData(cam.camera);
            const layer = app.scene.layers.getLayerByName("Splats");
            const layerInfo = cameraData?.layersMap?.get(layer);
            return layerInfo?.gsplatManager?.renderer?._material ||
                app.scene.gsplat?.material || null;
        } catch (e) {
            return null;
        }
    }

    // Returns true if at least one splat material was found and patched.
    _acquire() {
        let found = false;
        const unified = this._getUnifiedMaterial();
        if (unified) { this._applyToMaterial(unified, null); found = true; }
        const comps = this.app.root.findComponents("gsplat") || [];
        for (const c of comps) {
            if (!c.unified && c.material) { this._applyToMaterial(c.material, c); found = true; }
        }
        return found;
    }

    _retryAcquire(framesLeft) {
        if (this._destroyed || framesLeft <= 0) {
            if (!this._destroyed && this._materials.size === 0) {
                console.warn("SplatCrop: no splat material found in this space.");
            }
            return;
        }
        this.app.once("frameend", () => {
            if (this._destroyed) return;
            if (!this._acquire()) this._retryAcquire(framesLeft - 1);
        });
    }

    _applyToMaterial(mat, comp) {
        if (!mat) return;
        const lang = this._shaderLang();
        let chunks;
        try { chunks = mat.getShaderChunks(lang); } catch (e) { return; }
        if (!this._touched.has(mat)) {
            this._touched.set(mat, { had: chunks.has(CROP_CHUNK), orig: chunks.get(CROP_CHUNK) });
        }
        chunks.set(CROP_CHUNK, this._cropCode());
        this._entries.set(mat, { comp: comp || null });
        this._setUniforms(mat, comp || null);
        mat.update();
        this._materials.add(mat);
    }

    _restoreMaterials() {
        const lang = this._shaderLang();
        for (const [mat, info] of this._touched) {
            try {
                const chunks = mat.getShaderChunks(lang);
                if (info.had) chunks.set(CROP_CHUNK, info.orig);
                else chunks.delete(CROP_CHUNK);
                mat.update();
            } catch (e) { /* material may be gone */ }
        }
        this._touched.clear();
        this._materials.clear();
        this._entries.clear();
        try { this.app.fire("reApplySplatMaterial"); } catch (e) { /* ignore */ }
    }

    // ────────────────────────────────────────────
    // Crop uniforms
    // ────────────────────────────────────────────

    // boxWorld: vibe entity world pos+rot, unit scale (size carried by half-extents).
    _boxWorldInv() {
        const m = new pc.Mat4();
        m.setTRS(this.entity.getPosition(), this.entity.getRotation(), pc.Vec3.ONE);
        return m.invert();
    }

    _setUniforms(mat, comp) {
        const boxInv = this._boxWorldInv();
        // uBoxInv maps the splat CENTER (as seen in the shader) into box-local.
        // Non-unified: centers are in the component's local space -> prepend its
        // world transform. Unified: centers are already world-space.
        const m = boxInv;
        if (comp) {
            const sw = comp.entity.getWorldTransform();
            m.mul2(boxInv, sw); // box^-1 * componentWorld
        }
        mat.setParameter("uBoxInv", m.data);
        mat.setParameter("uHalfExtents", [this.size.x / 2, this.size.y / 2, this.size.z / 2]);
        mat.setParameter("uInvert", this.invert ? 1 : 0);
        mat.setParameter("uEdgeScaleFactor", this.edgeScaleFactor);
    }

    _updateAllUniforms() {
        for (const [mat, e] of this._entries) this._setUniforms(mat, e.comp);
    }

    // ────────────────────────────────────────────
    // Debug box (oriented wireframe of the crop volume)
    // ────────────────────────────────────────────

    /** World-space corners of the oriented box (entity pos+rot, size dims, scale ignored). */
    _boxCorners() {
        const m = new pc.Mat4();
        m.setTRS(this.entity.getPosition(), this.entity.getRotation(), pc.Vec3.ONE);
        const hx = this.size.x / 2, hy = this.size.y / 2, hz = this.size.z / 2;
        const signs = [
            [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
            [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
        ];
        return signs.map(([sx, sy, sz]) =>
            m.transformPoint(new pc.Vec3(sx * hx, sy * hy, sz * hz)));
    }

    _drawBox() {
        const c = this._boxCorners();
        const edges = [
            [0, 1], [1, 2], [2, 3], [3, 0], // bottom
            [4, 5], [5, 6], [6, 7], [7, 4], // top
            [0, 4], [1, 5], [2, 6], [3, 7], // verticals
        ];
        for (const [a, b] of edges) {
            this.app.drawLine(c[a], c[b], this._boxColor);
        }
    }
}
