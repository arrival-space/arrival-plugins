/// <reference path="../types/arrival.d.ts" />
/**
 * VRM Spring Bones — Debug / Tuning Utility
 *
 * Spring-bone physics (hair / skirt / accessories) and eye blink now run
 * NATIVELY in the Arrival.Space engine for every VRM that loads — the local
 * player, remote players, and NPCs alike. This plugin does NOT simulate anything
 * itself; it is a live control panel + visualizer for that engine system,
 * exposed via the global `window.VRMSpringBones`:
 *
 *   - The editor sliders below write straight into `window.VRMSpringBones`, so a
 *     change instantly affects EVERY avatar in the space (it's a global tuning
 *     object, not per-avatar).
 *   - "Debug Draw Colliders / Bones" render the engine's ACTUAL solver state
 *     (read from `VRMSpringBones._solvers`) — the same world-space spheres,
 *     capsules and bone segments the collision actually uses — so you can see
 *     exactly what's colliding and how the chains move.
 *
 * The "Toon …" sliders do the same for `window.VRMToonMaterial` — the global
 * that drives the MToon → toon-look conversion applied to every VRM material on
 * load. Because material properties are baked at load (not read per-frame), the
 * plugin calls `VRMToonMaterial.retuneAll()` after each change to re-derive the
 * materials already in the scene from their stashed original emissive.
 *
 * Use it while tuning, then remove it: the engine keeps running with whatever
 * values you left, and removing the plugin restores the globals to what they
 * were before you dropped it in (a fresh page load resets them to defaults).
 *
 * Note: the visualizer reads the engine solver's internal fields
 * (`_solvers`, `_colliderCache`, `_joints`, …). That coupling is intentional for
 * a debug tool — it inspects the very implementation it's there to debug.
 */
export class VRMSpringBonesDebug extends ArrivalScript {
    static scriptName = "VRM Tuning & Debug";

    // These mirror window.VRMSpringBones and are pushed into it on load and on
    // every change. Defaults match the engine defaults, so just dropping the
    // plugin in changes nothing until you move a slider.
    isEnabled = true;          // engine master switch (window.VRMSpringBones.enabled)
    eyeBlink = true;           // periodic automatic eye blink
    ropiness = 0.0;            // locomotion momentum (0 = calm default, 1 = full rope; loose skirts over-bounce above 0)
    airResistance = 0.1;       // sustained backward trail while moving
    stiffnessMul = 1.0;        // × the file's authored stiffness
    gravityMul = 1.0;          // × the file's authored gravity
    dragMul = 1.0;             // × the file's authored drag (<1 loosens a stiff VRM)
    extraDrag = 0.0;           // added on top of the (scaled) drag
    collisionIterations = 6;   // collision relaxation passes
    debugColliders = false;    // draw the engine colliders (green)
    debugBones = false;        // draw the simulated bones + hit radius (yellow)

    // VRM toon material / lighting tunables — mirror window.VRMToonMaterial and
    // re-tune every converted VRM material live via VRMToonMaterial.retuneAll().
    // Defaults match the engine so dropping the plugin in changes nothing until
    // you move a slider. (toonEnabled only affects VRMs loaded AFTER you toggle
    // it — already-converted materials stay as they are.)
    toonEnabled = true;        // convert MToon → toon look on new VRM loads
    toonDiffuseR = 0.5;        // lit base colour = emissive × (R,G,B)
    toonDiffuseG = 0.45;
    toonDiffuseB = 0.4;
    toonEmissiveMul = 0.8;     // kept unlit glow (× original emissive)
    toonAmbient = 1.0;         // ambient light response
    toonSpecular = 0.0;        // specular colour (grayscale)
    toonShininess = 0.0;       // specular highlight tightness
    toonReflectivity = 0.0;    // environment reflection amount
    toonGlossiness = 0.0;      // surface shine
    toonUseSkybox = true;      // light from the skybox / IBL
    toonUseTonemap = false;    // apply the scene tonemap

    static properties = {
        isEnabled: { title: "Simulate Spring Bones" },
        eyeBlink: { title: "Eye Blink" },
        ropiness: { title: "Ropiness (locomotion momentum)", min: 0, max: 1, step: 0.05 },
        airResistance: { title: "Air Resistance (movement drag)", min: 0, max: 3, step: 0.05 },
        stiffnessMul: { title: "Stiffness ×", min: 0, max: 3, step: 0.05 },
        gravityMul: { title: "Gravity ×", min: 0, max: 3, step: 0.05 },
        dragMul: { title: "Drag ×", min: 0, max: 2, step: 0.05 },
        extraDrag: { title: "Extra Drag", min: 0, max: 0.95, step: 0.01 },
        collisionIterations: { title: "Collision Iterations", min: 1, max: 12, step: 1 },
        debugColliders: { title: "Debug Draw Colliders" },
        debugBones: { title: "Debug Draw Bones" },

        toonEnabled: { title: "Toon Convert (new VRM loads)" },
        toonDiffuseR: { title: "Toon Diffuse R ×", min: 0, max: 2, step: 0.01 },
        toonDiffuseG: { title: "Toon Diffuse G ×", min: 0, max: 2, step: 0.01 },
        toonDiffuseB: { title: "Toon Diffuse B ×", min: 0, max: 2, step: 0.01 },
        toonEmissiveMul: { title: "Toon Emissive ×", min: 0, max: 2, step: 0.01 },
        toonAmbient: { title: "Toon Ambient", min: 0, max: 2, step: 0.01 },
        toonSpecular: { title: "Toon Specular", min: 0, max: 1, step: 0.01 },
        toonShininess: { title: "Toon Shininess", min: 0, max: 100, step: 1 },
        toonReflectivity: { title: "Toon Reflectivity", min: 0, max: 1, step: 0.01 },
        toonGlossiness: { title: "Toon Glossiness", min: 0, max: 1, step: 0.01 },
        toonUseSkybox: { title: "Toon Use Skybox" },
        toonUseTonemap: { title: "Toon Use Tonemap" },
    };

    _cfg = null;          // window.VRMSpringBones
    _restore = null;      // snapshot of the spring global before this debug session
    _toon = null;         // window.VRMToonMaterial
    _toonRestore = null;  // snapshot of the toon global before this debug session
    _dbgColor = null;
    _dbgBoneColor = null;
    _v0 = new pc.Vec3();  // scratch for the bone tail

    initialize() {
        this._cfg = (typeof window !== "undefined" && window.VRMSpringBones) || null;
        if (!this._cfg) {
            console.warn("[SpringBonesDebug] window.VRMSpringBones not found — " +
                "engine VRM spring bones aren't available in this build.");
            return;
        }
        // Snapshot the tunables so destroy() can restore them (non-destructive).
        const c = this._cfg;
        this._restore = {
            enabled: c.enabled, eyeBlink: c.eyeBlink, ropiness: c.ropiness,
            airResistance: c.airResistance, stiffnessMul: c.stiffnessMul,
            gravityMul: c.gravityMul, dragMul: c.dragMul, extraDrag: c.extraDrag,
            collisionIterations: c.collisionIterations,
        };

        // VRM toon material global is optional (newer engine builds only).
        this._toon = (typeof window !== "undefined" && window.VRMToonMaterial) || null;
        if (this._toon) {
            const t = this._toon;
            this._toonRestore = {
                enabled: t.enabled, diffuseR: t.diffuseR, diffuseG: t.diffuseG, diffuseB: t.diffuseB,
                emissiveMul: t.emissiveMul, ambient: t.ambient, specular: t.specular,
                shininess: t.shininess, reflectivity: t.reflectivity, glossiness: t.glossiness,
                useSkybox: t.useSkybox, useTonemap: t.useTonemap,
            };
        }
        this._pushAll();
    }

    // Mirror every property into the global tuning object(s).
    _pushAll() {
        const c = this._cfg;
        if (!c) return;
        c.enabled = this.isEnabled;
        c.eyeBlink = this.eyeBlink;
        c.ropiness = this.ropiness;
        c.airResistance = this.airResistance;
        c.stiffnessMul = this.stiffnessMul;
        c.gravityMul = this.gravityMul;
        c.dragMul = this.dragMul;
        c.extraDrag = this.extraDrag;
        c.collisionIterations = Math.max(1, Math.round(this.collisionIterations));
        this._pushToon();
    }

    // Mirror the toon/lighting values and re-tune every converted VRM material.
    _pushToon() {
        const t = this._toon;
        if (!t) return;
        t.enabled = this.toonEnabled;
        t.diffuseR = this.toonDiffuseR;
        t.diffuseG = this.toonDiffuseG;
        t.diffuseB = this.toonDiffuseB;
        t.emissiveMul = this.toonEmissiveMul;
        t.ambient = this.toonAmbient;
        t.specular = this.toonSpecular;
        t.shininess = this.toonShininess;
        t.reflectivity = this.toonReflectivity;
        t.glossiness = this.toonGlossiness;
        t.useSkybox = this.toonUseSkybox;
        t.useTonemap = this.toonUseTonemap;
        if (t.retuneAll) t.retuneAll(); // re-apply to materials already in the scene
    }

    onPropertyChanged() {
        this._pushAll(); // debug-only: cheap to just re-push everything
    }

    // Visualize every live solver the engine has registered.
    postUpdate() {
        const c = this._cfg;
        if (!c || !c._solvers || (!this.debugColliders && !this.debugBones)) return;
        for (const solver of c._solvers) {
            if (this.debugColliders) this._drawColliders(solver);
            if (this.debugBones) this._drawBones(solver);
        }
    }

    // ---------------------------------------------------------------- drawing
    _drawColliders(solver) {
        if (!this._dbgColor) this._dbgColor = new pc.Color(0.3, 1, 0.5);
        const col = this._dbgColor;
        for (const c of solver._colliderCache || []) {
            if (c._invalid) continue;
            this._drawWireSphere(c._c0, c._worldRadius, col);
            if (c.type === "capsule") {
                this._drawWireSphere(c._c1, c._worldRadius, col);
                this._drawCapsuleSides(c._c0, c._c1, c._worldRadius, col);
            }
        }
    }

    _drawBones(solver) {
        if (!this._dbgBoneColor) this._dbgBoneColor = new pc.Color(1, 0.8, 0.2);
        const col = this._dbgBoneColor;
        const fs = solver._frameScale || 1;
        for (const j of solver._joints || []) {
            const bone = j.bone;
            if (!bone || bone._destroyed) continue;
            const bp = bone.getPosition();
            // simulated tail world = center-relative currentTail + center world pos
            const t = this._v0.copy(j.currentTail);
            if (j.center && !j.center._destroyed) t.add(j.center.getPosition());
            this.app.drawLine(new pc.Vec3().copy(bp), new pc.Vec3().copy(t), col, false);
            const hr = (j.settings.hitRadius || 0) * fs;
            if (hr > 1e-4) this._drawWireSphere(t, hr, col, 8);
        }
    }

    // Three axis-aligned circles approximating a sphere.
    _drawWireSphere(center, r, color, seg = 16) {
        const SEG = seg;
        for (let plane = 0; plane < 3; plane++) {
            for (let i = 0; i < SEG; i++) {
                const t0 = (i / SEG) * Math.PI * 2;
                const t1 = ((i + 1) / SEG) * Math.PI * 2;
                const c0 = Math.cos(t0) * r, s0 = Math.sin(t0) * r;
                const c1 = Math.cos(t1) * r, s1 = Math.sin(t1) * r;
                let a, b;
                if (plane === 0) {
                    a = new pc.Vec3(center.x + c0, center.y + s0, center.z);
                    b = new pc.Vec3(center.x + c1, center.y + s1, center.z);
                } else if (plane === 1) {
                    a = new pc.Vec3(center.x + c0, center.y, center.z + s0);
                    b = new pc.Vec3(center.x + c1, center.y, center.z + s1);
                } else {
                    a = new pc.Vec3(center.x, center.y + c0, center.z + s0);
                    b = new pc.Vec3(center.x, center.y + c1, center.z + s1);
                }
                this.app.drawLine(a, b, color, false);
            }
        }
    }

    // Four lines along the capsule body connecting the two end spheres.
    _drawCapsuleSides(p0, p1, r, color) {
        const axis = new pc.Vec3().sub2(p1, p0);
        if (axis.lengthSq() < 1e-12) return;
        axis.normalize();
        const ref = Math.abs(axis.y) > 0.9 ? new pc.Vec3(1, 0, 0) : new pc.Vec3(0, 1, 0);
        const u = new pc.Vec3().cross(axis, ref).normalize().mulScalar(r);
        const v = new pc.Vec3().cross(axis, u).normalize().mulScalar(r);
        for (const off of [u, new pc.Vec3().copy(u).mulScalar(-1), v, new pc.Vec3().copy(v).mulScalar(-1)]) {
            const a = new pc.Vec3().add2(p0, off);
            const b = new pc.Vec3().add2(p1, off);
            this.app.drawLine(a, b, color, false);
        }
    }

    destroy() {
        // Restore the global tuning object(s) to their pre-plugin state so
        // removing the debugger doesn't leave the space permanently re-tuned.
        if (this._cfg && this._restore) Object.assign(this._cfg, this._restore);
        if (this._toon && this._toonRestore) {
            Object.assign(this._toon, this._toonRestore);
            if (this._toon.retuneAll) this._toon.retuneAll();
        }
    }
}
