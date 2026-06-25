/// <reference path="../types/arrival.d.ts" />
/**
 * Splat Portal
 *
 * A rectangular "portal window" you place in a splat scene. Pick ANOTHER splat
 * from the same scene and this vibe reveals it *only* through the portal opening
 * — a true window onto that splat at its real world location. Outside the window
 * the chosen splat is hidden; inside it shows where it actually is. Inspired by
 * PlayCanvas' splat-portal example, adapted to Arrival.Space.
 *
 * --- Reveal a hidden splat (enableTargetSplat) ---
 * The chosen splat is normally already visible in the scene and the portal just
 * confines it to the opening. With `enableTargetSplat` (default on) the portal
 * also REVEALS a target that is HIDDEN in the scene — so you can point it at a
 * hidden splat and have it appear ONLY through the window and nowhere else.
 *
 * Placed content is a `userModelEntity`, and its visibility is the native
 * `data.hidden` flag driven through `updateVisibility()` — a hidden splat isn't
 * even loaded (lazy-load), so `entity.enabled` can't reveal it. Like
 * visibility-groups.mjs, we flip the hidden flag EPHEMERALLY (never call
 * `setVisibility`, which would persist it to the backend) and let
 * `updateVisibility()` lazy-load + show it; the per-0.5s re-acquire then finds the
 * gsplat once it streams in. The original hidden state is restored when the portal
 * is removed or its target reassigned. (Raw splat entities with no userModelEntity
 * script fall back to `entity.enabled`. A splat hidden only by an ancestor FOLDER
 * isn't covered — un-hide the folder, e.g. via visibility-groups.)
 *
 * --- How the masking works (live-tested in a unified-splat room) ---
 * This is a screen-space STENCIL mask. The two facts that make it work in THIS
 * renderer were found debugging in-browser:
 *
 *   1. SPLATS RENDER IN THEIR OWN PASS. A mask drawn on a separate layer writes
 *      to a different stencil buffer than the one the splat samples, so the test
 *      silently fails. The mask mesh must live on the SAME "Splats" layer as the
 *      splat — then they share the pass/stencil. The mask is opaque, so it draws
 *      in the layer's opaque sub-pass, before the (transparent) splats.
 *
 *   2. A SINGLE SPLAT NEEDS ITS OWN MATERIAL. In a unified-splat room every
 *      splat shares one material with no per-instance handle, so it can't be
 *      masked alone. We force the chosen splat's gsplat component to
 *      `unified = false` (enabled=false; unified=false; enabled=true), which
 *      immediately gives it its own material; then we stencil that material. In
 *      a non-unified room it already has a material and this is a no-op.
 *
 * --- Near-clip (clipFront) ---
 * To hide splats IN FRONT of the opening (so you look *through* to what's beyond)
 * we do NOT touch the depth buffer — overwriting depth makes the splat draw over
 * real 3D objects in front of it. Instead the splat keeps normal depth testing
 * (so avatars / models still occlude it) and a world-space half-space clip is
 * injected into its `gsplatModifyVS` shader: any splat on the camera side of the
 * portal plane is scaled to zero. The plane is refreshed every frame.
 *
 * --- Curve ---
 * `curve` bends the opening + frame HORIZONTALLY toward the viewer (like a curved
 * monitor). The opening is a rectangle subdivided into many columns along X so the
 * bend is smooth — a flat quad can't curve. Corners are square for now.
 *
 * Move/rotate THIS entity to place and aim the portal; the opening faces local +Z.
 * The chosen splat does not move. WebGL2 + WebGPU.
 */

// ─── Near-clip shader (gsplatModifyVS) — discard splats on the camera side ───
// `uPortalClip` is the portal plane expressed in the splat's LOCAL space, so the
// test is a plain dot product against the per-splat centre. `uPortalClipOn`
// gates it (0 = off).
const CLIP_GLSL = /* glsl */ `
uniform vec4 uPortalClip;
uniform float uPortalClipOn;
void modifySplatCenter(inout vec3 center) {}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    if (uPortalClipOn > 0.5 && dot(uPortalClip.xyz, modifiedCenter) + uPortalClip.w > 0.0) {
        scale = vec3(0.0);
    }
}
void modifySplatColor(vec3 center, inout vec4 color) {}
`;

const CLIP_WGSL = /* wgsl */ `
uniform uPortalClip: vec4f;
uniform uPortalClipOn: f32;
fn modifySplatCenter(center: ptr<function, vec3f>) {}
fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
    if (uniform.uPortalClipOn > 0.5 && dot(uniform.uPortalClip.xyz, modifiedCenter) + uniform.uPortalClip.w > 0.0) {
        *scale = vec3f(0.0);
    }
}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {}
`;

const CLIP_CHUNK = "gsplatModifyVS";

// ─── Geometry (subdivided rectangle, optionally curved horizontally) ─────────

// Number of columns across X when curved, so the horizontal bend is smooth.
const CURVE_COLS = 64;

// Horizontal curved-screen depth: displace a vertex along Z the further it is
// horizontally from centre. `curve` is a signed fraction of the opening
// half-width — positive bends toward the viewer (+Z), negative away (−Z), 0 flat.
// A fixed reference half-width keeps mask + frame aligned.
function curveZ(x, refHalfWidth, curve) {
    if (!curve || refHalfWidth <= 0) return 0;
    return curve * (x * x) / refHalfWidth;
}

// Outward normal of that curve at x, so the glass reflection follows the bend
// instead of looking flat. dz/dx = 2·curve·x/refHW → normal = (-dz/dx, 0, 1).
function curveNormal(x, refHalfWidth, curve) {
    if (!curve || refHalfWidth <= 0) return [0, 0, 1];
    const dzdx = 2 * curve * x / refHalfWidth;
    const len = Math.hypot(dzdx, 1);
    return [-dzdx / len, 0, 1 / len];
}

// Build a triangle mesh from flat position / normal / index arrays.
function makeMesh(device, positions, normals, indices) {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setIndices(indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    return mesh;
}

// Solid rectangle subdivided into colsX columns (X) and one row (Y), bent in X.
function buildCurvedFill(device, w, h, curve, colsX) {
    const hw = w / 2, hh = h / 2;
    const positions = [], normals = [], indices = [];
    for (let iy = 0; iy <= 1; iy++) {
        const y = -hh + iy * h;
        for (let ix = 0; ix <= colsX; ix++) {
            const x = -hw + (ix / colsX) * w;
            positions.push(x, y, curveZ(x, hw, curve));
            const nrm = curveNormal(x, hw, curve);
            normals.push(nrm[0], nrm[1], nrm[2]);
        }
    }
    const rl = colsX + 1;
    for (let ix = 0; ix < colsX; ix++) {
        const a = ix, b = a + 1, c = a + rl, d = c + 1;
        indices.push(a, c, b, b, c, d);
    }
    return makeMesh(device, positions, normals, indices);
}

// Ordered CCW loop around a sharp rectangle: colsX subdivisions on the top &
// bottom edges (where the horizontal bend lives), colsY on the sides.
function rectLoop(w, h, colsX, colsY) {
    const hw = w / 2, hh = h / 2;
    const pts = [];
    for (let i = 0; i < colsX; i++) pts.push([-hw + (i / colsX) * w, -hh]); // bottom L→R
    for (let i = 0; i < colsY; i++) pts.push([hw, -hh + (i / colsY) * h]);  // right  B→T
    for (let i = 0; i < colsX; i++) pts.push([hw - (i / colsX) * w, hh]);   // top   R→L
    for (let i = 0; i < colsY; i++) pts.push([-hw, hh - (i / colsY) * h]);  // left  T→B
    return pts;
}

// Rectangular border ring of thickness t around the (w,h) opening, bent in X.
function buildCurvedFrame(device, w, h, t, curve, colsX) {
    const refHW = w / 2;
    const outer = rectLoop(w + 2 * t, h + 2 * t, colsX, 1);
    const inner = rectLoop(w, h, colsX, 1);
    const n = outer.length; // outer & inner share the same count → 1:1 correspondence
    const positions = [], normals = [], indices = [];
    for (let i = 0; i < n; i++) { positions.push(outer[i][0], outer[i][1], curveZ(outer[i][0], refHW, curve)); normals.push(0, 0, 1); }
    for (let i = 0; i < n; i++) { positions.push(inner[i][0], inner[i][1], curveZ(inner[i][0], refHW, curve)); normals.push(0, 0, 1); }
    for (let i = 0; i < n; i++) {
        const o0 = i, o1 = (i + 1) % n, i0 = n + i, i1 = n + ((i + 1) % n);
        indices.push(o0, i0, o1, o1, i0, i1);
    }
    return makeMesh(device, positions, normals, indices);
}

const SPLAT_LAYER_NAME = "Splats";

// The "Splats" layer is MANUAL-sorted (render order = meshInstance.drawOrder, not
// camera distance). Give the in-screen splat a low drawOrder so it renders FIRST
// among the splats; out-screen splats drawn after then compose over it where they
// are in front of the screen plane (and are depth-occluded where behind it).
const SUBJECT_DRAW_ORDER = -100000;

export class SplatPortal extends ArrivalScript {
    static scriptName = "Splat Portal";

    // The other splat in the scene to reveal through the portal.
    targetSplat = "";

    // Reveal the target splat when the portal acquires it, so you can point it at a
    // splat that is HIDDEN in the scene and have the mask confine it to the opening,
    // making it visible ONLY through the window. Flips the native hidden flag
    // ephemerally (not persisted); a no-op for splats already visible; restored to
    // its original hidden state when the portal is removed. See the header comment.
    enableTargetSplat = true;

    // Opening size (metres).
    width = 2;
    height = 3;

    // Horizontal screen curve (0 = flat; + bends toward the viewer at the edges,
    // - bends away).
    curve = 0;

    // Near-clip at the portal plane: hide splats in FRONT of the opening so you
    // only see through to what's beyond it. Real 3D objects still occlude it.
    clipFront = true;

    // Solid screen: fill the opening with an opaque backdrop (on the screen's own
    // curved mesh, drawn just before the splat) so nothing BEHIND the splat shows
    // through, while the splat ignores the scene depth buffer so geometry BEHIND
    // the portal can't punch holes in it. Things in FRONT of the portal still
    // occlude it: opaque objects via the stencil front-detector, and other SPLATS
    // because the screen writes depth at the plane (they read depth). See _maskMaterial.
    occludeBehind = true;
    backdropColor = { r: 0, g: 0, b: 0 };

    // Glossy glass over the opening — reflects the scene environment.
    screenReflection = 0;    // amount: 0 = clear (no glass), 1 = full mirror
    screenSharpness = 0.85;  // reflection gloss: 0 = blurry, 1 = sharp/mirror
    screenTint = { r: 1, g: 1, b: 1 };

    // Render the back of the screen as a solid black panel, so from behind the
    // portal reads as an opaque screen rather than a see-through window.
    backsideBlack = false;

    // Glowing frame around the opening.
    showFrame = true;
    frameColor = { r: 0.3, g: 0.85, b: 1 };
    frameThickness = 0.08;
    frameGlow = 6;

    static properties = {
        targetSplat: { title: "Splat To Reveal", editor: "entity", filterTypes: ["splat"] },
        enableTargetSplat: { title: "Enable Hidden Splat" },
        width: { title: "Opening Width (m)", min: 0.2, max: 50, step: 0.1 },
        height: { title: "Opening Height (m)", min: 0.2, max: 50, step: 0.1 },
        curve: { title: "Screen Curve", min: -1, max: 1, step: 0.01 },
        clipFront: { title: "Clip In Front Of Portal" },
        occludeBehind: { title: "Solid Screen (hide behind)" },
        backdropColor: { title: "Backdrop Color" },
        backsideBlack: { title: "Black Backside" },
        screenReflection: { title: "Screen Reflection", min: 0, max: 1, step: 0.01 },
        screenSharpness: { title: "Reflection Sharpness", min: 0, max: 1, step: 0.01 },
        screenTint: { title: "Screen Tint" },
        showFrame: { title: "Show Frame" },
        frameColor: { title: "Frame Color" },
        frameThickness: { title: "Frame Thickness (m)", min: 0.005, max: 1, step: 0.005 },
        frameGlow: { title: "Frame Glow", min: 0, max: 20, step: 0.1 },
    };

    // ── internal state ──
    _destroyed = false;
    _maskID = -1;
    _maskBit = 0;
    _splatLayer = null;
    _maskEntity = null;
    _frameEntity = null;
    _glassEntity = null;
    _backEntity = null;
    _subjects = new Map(); // gsplatComponent -> apply record
    _targetEntity = null;            // entity whose visibility we changed to reveal it
    _targetUme = null;               // its userModelEntity script (hidden-flag path)
    _targetHiddenOrig = false;       // original data.hidden, for restore
    _targetEntityEnabled = true;     // original entity.enabled (raw-entity fallback)
    _gateServer = null;              // cached GateServer (per-frame target resolve)
    _acquireTimer = 0;
    _camera = null;                  // cached camera entity (per-frame clip plane)
    _tmpVec = new pc.Vec3();
    _tmpN = new pc.Vec3();           // scratch plane normal (avoids per-frame alloc)
    _clipScratch = [0, 0, 0, 0];     // scratch local-space plane (avoids per-frame alloc)

    initialize() {
        this._destroyed = false;
        if (!this._allocMaskId()) return; // out of stencil bits
        this._enableStencilBuffer();
        this._splatLayer = this.app.scene.layers.getLayerByName(SPLAT_LAYER_NAME);
        if (!this._splatLayer) {
            console.warn("[Splat Portal] No 'Splats' layer in this space — portal can't render.");
            return;
        }
        this._buildGeometry();
        this._acquire();
    }

    update(dt) {
        if (this._destroyed || this._maskID < 0) return;
        // Every frame: refresh the clip plane (portal or camera may have moved).
        this._updateClipUniforms();
        // Re-acquire: late-streaming splats, target reassignment, the client
        // re-unifying / swapping the splat material out from under us. Run EVERY
        // frame while a configured target hasn't been picked up yet (e.g. a just-
        // revealed splat still streaming in) so the mask snaps on within a frame
        // instead of flashing unmasked; otherwise throttle to 0.5s.
        this._acquireTimer += dt;
        const waiting = this._subjects.size === 0 && !!String(this.targetSplat || "").trim();
        if (this._acquireTimer > (waiting ? 0 : 0.5)) {
            this._acquireTimer = 0;
            this._acquire();
        }
    }

    onPropertyChanged(name) {
        if (this._maskID < 0) return;
        if (name === "targetSplat") {
            this._restoreSubjects();
            this._acquire();
            return;
        }
        if (name === "enableTargetSplat") {
            this._restoreSubjects();  // re-hide the target if it was just toggled off
            this._acquire();          // re-enable + re-apply if it was just toggled on
            return;
        }
        if (name === "width" || name === "height" || name === "curve" ||
            name === "showFrame" || name === "frameThickness" || name === "backsideBlack") {
            this._buildGeometry();
            return;
        }
        if (name === "clipFront") {
            this._updateClipUniforms(); // toggles uPortalClipOn immediately
            return;
        }
        if (name === "occludeBehind" || name === "backdropColor") {
            const mi = this._maskEntity?.render?.meshInstances?.[0];
            if (mi?.material) { this._applyBackdrop(mi.material); mi.material.update(); }
            if (name === "occludeBehind") {
                for (const [c, rec] of this._subjects) {
                    if (rec.mat) { rec.mat.depthTest = !this.occludeBehind; rec.mat.update(); }
                    const mi = c.instance && c.instance.meshInstance;
                    if (mi && rec.origDrawOrder !== undefined) {
                        mi.drawOrder = this.occludeBehind ? SUBJECT_DRAW_ORDER : rec.origDrawOrder;
                    }
                }
            }
            return;
        }
        if (name === "screenReflection") {
            const mi = this._glassEntity?.render?.meshInstances?.[0];
            if (this.screenReflection > 0 && !this._glassEntity) {
                this._buildGeometry();           // create the glass
            } else if (this.screenReflection <= 0 && this._glassEntity) {
                this._glassEntity.destroy();      // remove it
                this._glassEntity = null;
            } else if (mi?.material) {
                mi.material.opacity = this.screenReflection;
                mi.material.update();
            }
            return;
        }
        if (name === "screenSharpness" || name === "screenTint") {
            const mi = this._glassEntity?.render?.meshInstances?.[0];
            if (mi?.material) {
                mi.material.gloss = this.screenSharpness;
                mi.material.diffuse = new pc.Color(this.screenTint.r, this.screenTint.g, this.screenTint.b);
                mi.material.update();
            }
            return;
        }
        if (name === "frameColor" || name === "frameGlow") {
            const mi = this._frameEntity?.render?.meshInstances?.[0];
            if (mi?.material) {
                mi.material.emissive = new pc.Color(this.frameColor.r, this.frameColor.g, this.frameColor.b);
                mi.material.emissiveIntensity = this.frameGlow;
                mi.material.update();
            }
        }
    }

    destroy() {
        this._destroyed = true;
        this._restoreSubjects();
        if (this._maskEntity) { this._maskEntity.destroy(); this._maskEntity = null; }
        if (this._frameEntity) { this._frameEntity.destroy(); this._frameEntity = null; }
        if (this._glassEntity) { this._glassEntity.destroy(); this._glassEntity = null; }
        if (this._backEntity) { this._backEntity.destroy(); this._backEntity = null; }
        this._freeMaskId();
    }

    // ── stencil bit arbitration (mirrors client stencil-mask.js) ──────────────

    _allocMaskId() {
        if (!this.app.stencilMaskIds) this.app.stencilMaskIds = new Set();
        const used = this.app.stencilMaskIds;
        for (let id = 0; id < 8; id++) {
            if (!used.has(id)) {
                used.add(id);
                this._maskID = id;
                this._maskBit = Math.pow(2, id);
                return true;
            }
        }
        console.warn("[Splat Portal] No free stencil mask id (max 8 stencil effects).");
        return false;
    }

    _freeMaskId() {
        if (this._maskID >= 0) {
            this.app.stencilMaskIds?.delete(this._maskID);
            this._maskID = -1;
            this._maskBit = 0;
        }
    }

    // Make sure the render target has a stencil buffer. Harmless when the splat
    // pass already has one (the common case); needed for post-processing rooms.
    _enableStencilBuffer() {
        const ctc = this.app.customTravelCenter;
        if (!ctc) return;
        ctc.needsStencilBuffer = true;
        if (ctc.cameraFrame) {
            try {
                ctc.cameraFrame.rendering.stencil = true;
                ctc.cameraFrame.update();
            } catch (e) { /* older cameraFrame without stencil support */ }
        }
    }

    // ── geometry (opening cookie + frame) ───────────────────────────────────────

    _buildGeometry() {
        const device = this.app.graphicsDevice;
        const colsX = this.curve !== 0 ? CURVE_COLS : 1;

        // Invisible stencil cookie — on the SAME "Splats" layer as the splats so
        // it writes the stencil buffer the splat actually samples.
        if (!this._maskEntity) {
            this._maskEntity = new pc.Entity("PortalMaskMesh");
            this.entity.addChild(this._maskEntity);
        }
        const fill = buildCurvedFill(device, this.width, this.height, this.curve, colsX);
        this._setRenderMesh(this._maskEntity, fill, this._maskMaterial(), [this._splatLayer.id]);

        // Optional glowing frame on the default world layer.
        if (this.showFrame) {
            if (!this._frameEntity) {
                this._frameEntity = new pc.Entity("PortalFrameMesh");
                this.entity.addChild(this._frameEntity);
            }
            const t = Math.max(0.005, this.frameThickness);
            const ring = buildCurvedFrame(device, this.width, this.height, t, this.curve, colsX);
            this._setRenderMesh(this._frameEntity, ring, this._frameMaterial(), null);
        } else if (this._frameEntity) {
            this._frameEntity.destroy();
            this._frameEntity = null;
        }

        // Glossy glass screen over the opening, on a layer AFTER the splats so the
        // reflection sits on top of the window content. Same geometry/curve as the
        // opening so it lines up.
        if (this.screenReflection > 0) {
            if (!this._glassEntity) {
                this._glassEntity = new pc.Entity("PortalGlassMesh");
                this.entity.addChild(this._glassEntity);
            }
            const glass = buildCurvedFill(device, this.width, this.height, this.curve, colsX);
            const glassLayer = this.app.scene.layers.getLayerByName("AfterSplat") || this._splatLayer;
            this._setRenderMesh(this._glassEntity, glass, this._glassMaterial(), [glassLayer.id]);
        } else if (this._glassEntity) {
            this._glassEntity.destroy();
            this._glassEntity = null;
        }

        // Optional opaque black back panel — only its BACK faces render (cull front),
        // so it's invisible from the front but a solid black screen from behind.
        if (this.backsideBlack) {
            if (!this._backEntity) {
                this._backEntity = new pc.Entity("PortalBackMesh");
                this.entity.addChild(this._backEntity);
            }
            const back = buildCurvedFill(device, this.width, this.height, this.curve, colsX);
            this._setRenderMesh(this._backEntity, back, this._backMaterial(), null);
        } else if (this._backEntity) {
            this._backEntity.destroy();
            this._backEntity = null;
        }
    }

    _setRenderMesh(entity, mesh, material, layerIds) {
        const mi = new pc.MeshInstance(mesh, material, entity);
        mi.castShadow = false;
        if (!entity.render) entity.addComponent("render");
        entity.render.meshInstances = [mi];
        entity.render.castShadows = false;
        entity.render.receiveShadows = false;
        if (layerIds) entity.render.layers = layerIds;
    }

    _maskMaterial() {
        const m = new pc.StandardMaterial();
        // Front-only when the backside is a solid black panel (so no stencil is
        // written from behind → the content doesn't show through from the back);
        // otherwise double-sided so the window works from either side.
        m.cull = this.backsideBlack ? pc.CULLFACE_BACK : pc.CULLFACE_NONE;
        m.blendType = pc.BLEND_NONE;        // opaque → drawn before transparent splats
        m.depthTest = true;                 // we depth-test the plane vs the scene
        m.useLighting = false;              // backdrop is a flat unlit colour
        // depthWrite is owned by _applyBackdrop (on in solid-screen mode).
        // Front-object detector. The screen plane is depth-tested against the scene:
        //  - depth PASSES (plane in front of / at existing geometry → nothing in
        //    front of the portal here) → zpass SET the window bit + draw backdrop.
        //  - depth FAILS (existing geometry CLOSER than the plane → an object in
        //    front of the portal) → zfail CLEAR the bit + no backdrop, so the object
        //    shows and the splat is masked out there.
        // The splat then ignores depth (so geometry BEHIND the portal can't occlude
        // it) but is still occluded by things in FRONT via this cleared stencil bit.
        m.stencilFront = m.stencilBack = new pc.StencilParameters({
            readMask: this._maskBit,
            writeMask: this._maskBit,
            ref: this._maskBit,
            func: pc.FUNC_ALWAYS,
            zpass: pc.STENCILOP_REPLACE,
            zfail: pc.STENCILOP_ZERO,
            fail: pc.STENCILOP_KEEP
        });
        this._applyBackdrop(m);
        m.update();
        return m;
    }

    // Solid-screen backdrop. When `occludeBehind` is on the mask writes an opaque
    // colour (drawn before the splat, so it overwrites everything behind in the
    // window); when off it writes no colour (pure stencil cookie → see-through).
    // Depth is never written, so the splat is never blocked; depth TEST stays on
    // (default) so objects in front of the portal occlude the backdrop too.
    _applyBackdrop(m) {
        const on = !!this.occludeBehind;
        m.redWrite = m.greenWrite = m.blueWrite = m.alphaWrite = on;
        // In solid-screen mode the screen WRITES depth at the plane: other splats
        // (which read depth) are then occluded where they're behind the screen and
        // draw over it where they're in front. The inner splat has depth-read off,
        // so this never blocks it. In see-through mode we must NOT write depth —
        // there the inner splat depth-tests normally and the screen would hide it.
        m.depthWrite = on;
        m.diffuse = new pc.Color(0, 0, 0);
        m.emissive = new pc.Color(this.backdropColor.r, this.backdropColor.g, this.backdropColor.b);
    }

    _frameMaterial() {
        const m = new pc.StandardMaterial();
        m.useLighting = false;
        m.diffuse = new pc.Color(0, 0, 0);
        m.emissive = new pc.Color(this.frameColor.r, this.frameColor.g, this.frameColor.b);
        m.emissiveIntensity = this.frameGlow;
        m.cull = pc.CULLFACE_NONE;
        m.update();
        return m;
    }

    // Solid black panel shown only from behind (renders back faces, culls front).
    _backMaterial() {
        const m = new pc.StandardMaterial();
        m.useLighting = false;
        m.diffuse = new pc.Color(0, 0, 0);
        m.emissive = new pc.Color(0, 0, 0);
        m.cull = pc.CULLFACE_FRONT;
        m.update();
        return m;
    }

    // Reflective glass screen. Metalness=1 makes it a pure environment reflector
    // (tinted by `diffuse`); `gloss` is the reflection sharpness. Blended ADDITIVE
    // so the reflection is ADDED on top of the window content (never darkens it);
    // `opacity` scales the added amount.
    _glassMaterial() {
        const m = new pc.StandardMaterial();
        m.useMetalness = true;
        m.metalness = 1;
        m.diffuse = new pc.Color(this.screenTint.r, this.screenTint.g, this.screenTint.b);
        m.gloss = this.screenSharpness;
        m.opacity = this.screenReflection;
        m.blendType = pc.BLEND_ADDITIVEALPHA; // dst + reflection*opacity
        m.depthWrite = false;            // don't occlude; near objects still occlude it
        m.cull = pc.CULLFACE_NONE;
        m.update();
        return m;
    }

    _subjectStencil() {
        return new pc.StencilParameters({
            readMask: this._maskBit,
            writeMask: this._maskBit,
            ref: this._maskBit,
            func: pc.FUNC_EQUAL
        });
    }

    // ── subject (the revealed splat) ────────────────────────────────────────────

    _resolveTarget() {
        const id = typeof this.targetSplat === "string" ? this.targetSplat.trim() : "";
        if (!id) return null;
        // Cache the GateServer singleton — _resolveTarget can run every frame while
        // waiting for a revealed splat to stream in, and findByName is a full scan.
        let gs = this._gateServer;
        if (!gs) {
            gs = this.app.root.findByName("GateServer")?.script?.gateServer || null;
            if (gs) this._gateServer = gs;
        }
        let e = gs?.getEntity?.(id) ?? null;
        if (!e) { try { e = this.app.root.findByGuid?.(id) ?? null; } catch (_) { /* ignore */ } }
        return e;
    }

    _acquire() {
        const target = this._resolveTarget();
        if (!target) return;
        // Optionally force-enable a hidden target so the portal can reveal a splat
        // that wasn't visible before. Must run before findComponents so the gsplat
        // instance/material get created.
        if (this.enableTargetSplat) this._enableTarget(target);
        const comps = target.findComponents("gsplat") || [];
        for (const c of comps) this._applyToSplat(c);
    }

    // Reveal a hidden target splat so the portal can show it. Placed content is a
    // userModelEntity whose visibility is the native data.hidden flag (driven by
    // updateVisibility(), which also lazy-loads a never-loaded hidden splat) — so
    // entity.enabled can't reveal it. We flip data.hidden ephemerally (NOT
    // setVisibility, which persists) and let updateVisibility load + show it; the
    // 0.5s re-acquire then catches the gsplat once it streams in. Original state is
    // remembered once per target for restore. Raw splat entities (no userModelEntity
    // script) fall back to entity.enabled.
    _enableTarget(target) {
        if (this._targetEntity !== target) {
            this._restoreTargetVisibility();           // undo a previous target first
            this._targetEntity = target;
            const ume = target.script?.userModelEntity;
            if (ume && ume.data) {
                this._targetUme = ume;
                this._targetHiddenOrig = !!ume.data.hidden;
            } else {
                this._targetUme = null;
                this._targetEntityEnabled = target.enabled;
            }
        }
        const ume = this._targetUme;
        if (ume) {
            if (ume.data.hidden) {                     // reveal once; re-acquire is a no-op after
                ume.data.hidden = false;
                Promise.resolve(ume.updateVisibility?.()).catch(() => {});
            }
        } else if (!target.enabled) {
            target.enabled = true;
        }
    }

    // Undo whatever _enableTarget did, returning the target to its original (hidden)
    // state. Ephemeral — never persisted.
    _restoreTargetVisibility() {
        const ume = this._targetUme, target = this._targetEntity;
        try {
            if (ume && ume.data) {
                ume.data.hidden = this._targetHiddenOrig;
                Promise.resolve(ume.updateVisibility?.()).catch(() => {});
            } else if (target) {
                target.enabled = this._targetEntityEnabled;
            }
        } catch (e) { /* entity / script may already be gone */ }
        this._targetEntity = null;
        this._targetUme = null;
        this._targetHiddenOrig = false;
        this._targetEntityEnabled = true;
    }

    _applyToSplat(c) {
        let rec = this._subjects.get(c) || {};

        // Reveal a hidden splat: if the toggle is on and this gsplat component is
        // disabled, enable it (the entity-level enable is done in _enableTarget).
        // Record the original state once so destroy()/reassignment can re-hide it.
        if (this.enableTargetSplat && rec.origEnabled === undefined && !c.enabled) {
            rec.origEnabled = false;
            c.enabled = true;
        }

        // In a unified-splat room the component shares one material and has none
        // of its own — force it non-unified so it gets a per-instance material.
        if (c.unified || !c.material) {
            rec.forcedUnified = true;
            try {
                c.enabled = false;
                c.unified = false;
                c.enabled = true;
            } catch (e) { /* component may be mid-stream */ }
        } else if (rec.forcedUnified === undefined) {
            rec.forcedUnified = false;
        }

        const mat = c.material;
        if (!mat) { this._subjects.set(c, rec); return; } // material not ready yet — retried by update()

        // (Re)apply stencil + clip chunk if this material isn't ours yet.
        if (rec.mat !== mat) {
            rec.mat = mat;
            rec.origFront = mat.stencilFront;
            rec.origBack = mat.stencilBack;
            rec.origDepthTest = mat.depthTest;
            mat.stencilFront = mat.stencilBack = this._subjectStencil();
            rec.chunk = this._setClipChunk(mat);
        }
        // Solid-screen mode: ignore the scene depth buffer so geometry behind the
        // portal can't occlude the splat (near-clip is handled in-shader).
        mat.depthTest = !this.occludeBehind;
        mat.update();

        // MANUAL-sorted Splats layer: pin the in-screen splat to render first so the
        // out-screen splats (drawn after) compose over it. Restore in see-through.
        const mi = c.instance && c.instance.meshInstance;
        if (mi) {
            if (rec.origDrawOrder === undefined) rec.origDrawOrder = mi.drawOrder;
            mi.drawOrder = this.occludeBehind ? SUBJECT_DRAW_ORDER : rec.origDrawOrder;
        }
        this._subjects.set(c, rec);
    }

    _setClipChunk(mat) {
        const saved = {};
        for (const [lang, code] of [["glsl", CLIP_GLSL], ["wgsl", CLIP_WGSL]]) {
            let chunks;
            try { chunks = mat.getShaderChunks(lang); } catch (e) { continue; }
            saved[lang] = { had: chunks.has(CLIP_CHUNK), orig: chunks.get(CLIP_CHUNK) };
            chunks.set(CLIP_CHUNK, code);
        }
        return saved;
    }

    // World-space portal plane, normal oriented toward the camera so the test
    // discards the camera-facing half ("in front of the portal").
    _worldClipPlane() {
        const P = this.entity.getPosition();
        const N = this._tmpN.copy(this.entity.forward).scale(-1); // local +Z in world
        const camEnt = this._camera || (this._camera = this.app.root.findByName("Camera"));
        const cam = camEnt && camEnt.getPosition();
        if (cam && this._tmpVec.sub2(cam, P).dot(N) < 0) N.scale(-1);
        return { N, w: -(N.x * P.x + N.y * P.y + N.z * P.z) };
    }

    // Express the world plane in a splat component's LOCAL space: pLocal = Wᵀ·pWorld
    // (so the shader can test the per-splat local centre with a plain dot product).
    _localClipPlane(c, pl) {
        const d = c.entity.getWorldTransform().data;
        const x = pl.N.x, y = pl.N.y, z = pl.N.z, w = pl.w;
        const r = this._clipScratch; // setParameter copies the values, so reuse is safe
        r[0] = d[0] * x + d[1] * y + d[2] * z + d[3] * w;
        r[1] = d[4] * x + d[5] * y + d[6] * z + d[7] * w;
        r[2] = d[8] * x + d[9] * y + d[10] * z + d[11] * w;
        r[3] = d[12] * x + d[13] * y + d[14] * z + d[15] * w;
        return r;
    }

    _updateClipUniforms() {
        if (this._subjects.size === 0) return;
        const on = this.clipFront ? 1 : 0;
        const plane = this.clipFront ? this._worldClipPlane() : null;
        for (const [c, rec] of this._subjects) {
            if (!rec.mat) continue;
            rec.mat.setParameter("uPortalClipOn", on);
            if (plane) rec.mat.setParameter("uPortalClip", this._localClipPlane(c, plane));
        }
    }

    _restoreSubjects() {
        for (const [c, rec] of this._subjects) {
            try {
                if (rec.mat) {
                    rec.mat.stencilFront = rec.origFront || null;
                    rec.mat.stencilBack = rec.origBack || null;
                    if (rec.origDepthTest !== undefined) rec.mat.depthTest = rec.origDepthTest;
                    const mi = c.instance && c.instance.meshInstance;
                    if (mi && rec.origDrawOrder !== undefined) mi.drawOrder = rec.origDrawOrder;
                    if (rec.chunk) {
                        for (const lang of ["glsl", "wgsl"]) {
                            const s = rec.chunk[lang];
                            if (!s) continue;
                            try {
                                const ch = rec.mat.getShaderChunks(lang);
                                if (s.had) ch.set(CLIP_CHUNK, s.orig); else ch.delete(CLIP_CHUNK);
                            } catch (e) { /* ignore */ }
                        }
                    }
                    rec.mat.update();
                }
                // Re-join the unified pipeline if we pulled it out (also discards
                // the per-instance material we modified).
                if (rec.forcedUnified && c) {
                    c.enabled = false;
                    c.unified = true;
                    c.enabled = true;
                }
                // Re-hide a gsplat component we force-enabled. Done last so it wins
                // over the unified dance above (which leaves the component enabled).
                if (rec.origEnabled !== undefined && c) c.enabled = rec.origEnabled;
            } catch (e) { /* component / material may already be gone */ }
        }
        // Re-hide the target if enableTargetSplat revealed it (after the subject
        // material restore above, so the gsplat is still ours while we clean it up).
        this._restoreTargetVisibility();
        this._subjects.clear();
        try { this.app.fire("reApplySplatMaterial"); } catch (e) { /* ignore */ }
    }
}
