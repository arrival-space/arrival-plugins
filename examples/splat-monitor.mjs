/// <reference path="../types/arrival.d.ts" />
/**
 * Splat Monitor (render-to-texture portal)
 *
 * A flat "screen" you place in a splat scene that shows a LIVE camera FEED of the
 * space rendered to a texture — a monitor / CCTV panel rather than the see-through
 * window that `splat-portal.mjs` builds with a stencil mask. A second, hidden
 * camera renders the scene (or a single chosen splat) into a `pc.RenderTarget`
 * every frame and the resulting texture is painted onto the screen surface.
 *
 * --- Where the feed is rendered FROM (the point of this variant) ---
 * Three POV sources, highest priority first:
 *   1. `cameraEntity` — if set, the feed renders from that entity's transform (its
 *      position + orientation, looking down its local -Z). Move / parent / animate
 *      the entity to drive the shot. A real, movable camera in the scene.
 *   2. `followPlayer` on — the feed tracks the live player camera (mirrors your view).
 *   3. otherwise — a FIXED world `viewPosition` aimed at the splat (or `aimPoint`),
 *      like a security monitor onto the space from somewhere you are not.
 * The fixed/aim settings deliberately BREAK the window illusion, on purpose.
 *
 * --- Window mode (portal) ---
 * `windowMode` turns the screen into a real WINDOW instead of a free monitor feed:
 * the feed becomes an OFF-AXIS projection from the eye (POV source, POSITION only)
 * THROUGH the screen rectangle, near-clipped at the screen — so it shows what you'd
 * see if the splat sat behind the screen. Moving the screen re-frames the fixed-world
 * splat; moving the eye gives parallax (like `splat-portal.mjs`, but to a texture).
 * Fed via `cam.camera.calculateProjection` (it lives on the CAMERA COMPONENT — setting
 * it on the entity silently does nothing). Curve is ignored for the projection (a
 * curved window would distort); best paired with `curve = 0`.
 *
 * WHICH EYE — the off-axis image is only geometrically correct viewed FROM the eye it
 * was built for:
 *   • `cameraEntity` set → a FIXED eye: a trompe-l'oeil that looks perfect only when
 *     your real camera sits at that point (move onto it to check), and skews as you
 *     move off it. Use for a locked "painting that looks 3D from the doorway".
 *   • `cameraEntity` empty + `followPlayer` on → the eye is your LIVE camera → a true
 *     walk-around portal, parallax-correct from anywhere in front of the glass.
 *
 * --- How it renders (built on the client's own second-camera pattern) ---
 * Mirrors `client .../scripts/Utils/apply-outline.js`: a child camera with
 * `priority:-1` (renders BEFORE the main camera each frame) and its own
 * `renderTarget`, coexisting with the main camera's HDR post-processing
 * (CameraFrame) because it never touches the main camera's render target. The splat
 * pipeline is per-(camera,layer) — `app.renderer.gsplatDirector` builds a gsplat
 * manager + material for any camera whose layers include a splat layer — so the
 * second camera renders splats with no extra wiring.
 *
 * The monitor's OWN meshes (screen/frame/back) live on a shared, persistent
 * "SplatMonitorScreen" layer that the MAIN camera renders but the feed camera does
 * not — so the feed never captures the screen it is being drawn onto. That layer is
 * added to the main camera once via `layers.push` (the HDR-safe form used by the
 * client's stencil-mask.js; reassigning `camera.layers` freezes the CameraFrame).
 *
 * --- Two feed modes ---
 *   • Whole scene (default, `isolateTarget` off): the camera renders the existing
 *     Skybox / World / Splats / AfterSplat layers → a live feed of the entire space
 *     (avatars included) from `viewPosition`. No splat surgery.
 *   • Isolated splat (`isolateTarget` on): only the chosen `targetSplat` is shown.
 *     The splat is moved onto a private layer that ONLY this monitor's camera
 *     renders, kept UNIFIED so LOD streaming stays intact (forcing non-unified
 *     collapses a streaming splat to a low-res subset — blurry), and the feed camera
 *     renders that layer ALONE over the backdrop colour (NOT the skybox — this room's
 *     skybox is a hazy fog that washes the splat out). So it vanishes from the world
 *     and appears solely on the screen. With `enableTargetSplat` the
 *     splat can even be one that is HIDDEN in the scene (revealed ephemerally, never
 *     persisted; restored on unload) — a monitor onto a splat that exists nowhere
 *     else. Same reveal path as `splat-portal.mjs`.
 *
 * --- Splat sorting caveat (accepted trade-off) ---
 * Splat depth-sort + LOD follow the MAIN camera (radial sort by camera position).
 * In WHOLE-SCENE mode from a fixed viewpoint that differs from yours, splats may be
 * mis-sorted (popping / see-through order) because the order was computed for your
 * eye, not the monitor's. `followPlayer` (eye-matched) avoids it. This is inherent
 * to the engine's single-primary-camera sort.
 *
 * --- Cost / on-demand rendering ---
 * The feed is an extra scene render pass per frame — heavier than the stencil portal.
 * `renderEveryFrame` off makes the feed camera render ONLY while the feed viewpoint,
 * the target splat's pose, or a setting is changing, then freeze on the last frame
 * (the render target keeps it). Huge saving for a FIXED monitor of a STATIC splat.
 * While frozen it won't reflect things it can't detect — LOD streaming, or avatars
 * moving in a whole-scene feed — so leave it ON for a live CCTV feed.
 *
 * --- Clip in front ---
 * `clipInFront` hides feed splats sitting between the feed camera and the monitor, so
 * you see through to what's behind. The camera near plane can't do this — the splat
 * pass runs with depth-clipping disabled, so `nearClip` never culls splats. Instead a
 * world-space half-space clip is injected into the FEED splat's `gsplatModifyVS`
 * (scale = 0 for splats on the camera side of the monitor plane), the only hook that
 * works — same as `splat-portal.mjs`. `clipOffset` slides the plane along the normal.
 *
 * --- Feed FX (the RTT payoff) ---
 * Because the feed is just a texture you can grade it: `resolution` (low = retro),
 * `pixelated` (nearest filtering), `screenTint`, `screenGain` (brightness),
 * `scanlines` (CRT overlay). None of this is possible with the stencil portal.
 * `pixelRaster` overlays the panel's physical LED grid (`rasterColumns` across, square
 * cells, `rasterGap` dark border) that only resolves up close and fades out with
 * distance (`rasterFadeDist`) — a real video-wall look. WebGL only.
 *
 * --- Curve ---
 * `curve` bends the screen horizontally toward (or away from) the viewer like a
 * curved monitor — PURE GEOMETRY, no perspective correction: the feed simply maps
 * onto the bent surface. Screen, frame, backside and scanline overlay all bend
 * together; the opening is subdivided into columns so the bend is smooth. In a plain
 * monitor feed the bend is just cosmetic; in WINDOW mode a bent surface would distort
 * the portal, so `compensateCurve` (on by default) warps the feed from the eye to
 * cancel it — per-FRAGMENT via a custom shader on WebGL (crisp, decoupled from the
 * column count), per-vertex on WebGPU (a linear projection can't do a curved window).
 *
 * Move/rotate THIS entity to place the screen; the surface faces local +Z. WebGL2 +
 * WebGPU. Keep `resolution` modest and prefer isolated mode for one subject.
 */

// Shared, persistent layer for every monitor's own screen/frame meshes. Named +
// reused (like the client's "StencilMask" layer) and added to the main camera once;
// never torn down, so we never have to remove a layer from the main camera.
const SCREEN_LAYER_NAME = "SplatMonitorScreen";

// ─── Feed splat "clip in front" (gsplatModifyVS half-space clip) ─────────────
// The camera near plane does NOT cull splats (the splat pass runs with depth
// clipping disabled; culling happens in the sort/work-buffer stage). So to hide
// splats between the feed camera and the monitor we scale any splat whose WORLD
// centre is on the camera side of the monitor plane to zero — the only hook that
// works. Same technique as splat-portal.mjs. `uMonitorClip` = plane (world),
// `uMonitorClipOn` gates it. Injected into the FEED camera's splat material only.
const CLIP_GLSL = /* glsl */ `
uniform vec4 uMonitorClip;
uniform float uMonitorClipOn;
void modifySplatCenter(inout vec3 center) {}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    if (uMonitorClipOn > 0.5 && dot(uMonitorClip.xyz, modifiedCenter) + uMonitorClip.w > 0.0) {
        scale = vec3(0.0);
    }
}
void modifySplatColor(vec3 center, inout vec4 color) {}
`;
const CLIP_WGSL = /* wgsl */ `
uniform uMonitorClip: vec4f;
uniform uMonitorClipOn: f32;
fn modifySplatCenter(center: ptr<function, vec3f>) {}
fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
    if (uniform.uMonitorClipOn > 0.5 && dot(uniform.uMonitorClip.xyz, modifiedCenter) + uniform.uMonitorClip.w > 0.0) {
        *scale = vec3f(0.0);
    }
}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {}
`;
const CLIP_CHUNK = "gsplatModifyVS";

// ─── Curve-compensation fragment shader (window mode, WebGL) ──────────────────
// Per-FRAGMENT warp: the vertex passes the surface's local x,y; the fragment
// recomputes the exact curved z from x and the eye→flat-plane intersection Q, so the
// UV is exact per pixel — no piecewise-linear "wave", decoupled from CURVE_COLS.
// (WebGPU has no WGSL twin here, so it falls back to the per-vertex CPU warp.)
const WARP_VS_GLSL = /* glsl */ `
attribute vec3 aPosition;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec2 vLocalXY;
void main() {
    vLocalXY = aPosition.xy;
    gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
}
`;
const WARP_FS_GLSL = /* glsl */ `
varying vec2 vLocalXY;
uniform vec3 uEyeLocal;   // eye in the screen's local space
uniform float uCurve;
uniform float uRefHW;     // reference half-width for curveZ
uniform vec2 uMin;        // render-rect min (local x,y)
uniform vec2 uSize;       // render-rect size (local)
uniform float uFlipV;
uniform vec3 uTint;
uniform float uGain;
uniform sampler2D uTex;   // the feed render target
void main() {
    vec2 P = vLocalXY;
    float pz = uCurve * (P.x * P.x) / uRefHW;            // exact curved z at this pixel
    float t = -uEyeLocal.z / (pz - uEyeLocal.z);         // ray eye→P hits the flat plane
    vec2 Q = uEyeLocal.xy + t * (P.xy - uEyeLocal.xy);
    vec2 uv = (Q - uMin) / uSize;
    if (uFlipV > 0.5) uv.y = 1.0 - uv.y;
    vec3 col = texture2D(uTex, uv).rgb * uTint * uGain;
    gl_FragColor = vec4(col, 1.0);
}
`;

// ─── Pixel-raster overlay (LED-wall grid, window/monitor agnostic, WebGL) ─────
// A transparent overlay quad that darkens the inter-LED GAPS of a physical pixel
// grid on the panel — the panel's OWN fixed grid in its 0..1 UV space, independent
// of the feed content and any window parallax. `uGrid` = (cols, rows); the LED square
// fills (1 - uGap) of each cell, the rest is the dark gap. fwidth() anti-aliases the
// gap edges so a grid finer than a screen pixel dissolves on its own (you only see
// the pixels up close), and `uFade` blends the whole thing out with distance. Drawn
// by the MAIN camera on the shared screen layer (never by the feed camera).
const RASTER_VS_GLSL = /* glsl */ `
attribute vec3 aPosition;
attribute vec2 aUv0;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec2 vRUv;
varying vec3 vRWorld;
void main() {
    vRUv = aUv0;
    vec4 wp = matrix_model * vec4(aPosition, 1.0);
    vRWorld = wp.xyz;
    gl_Position = matrix_viewProjection * wp;
}
`;
const RASTER_FS_GLSL = /* glsl */ `
varying vec2 vRUv;
varying vec3 vRWorld;
uniform vec3 uCamPos;
uniform vec2 uGrid;    // LED count (cols, rows)
uniform float uGap;    // dark gap as a fraction of a cell
uniform float uFade;   // distance (m) at which the grid is fully gone
void main() {
    vec2 cell = vRUv * uGrid;
    vec2 f = abs(fract(cell) - 0.5) * 2.0;        // 0 at LED centre → 1 at cell border
    vec2 aa = fwidth(cell);                       // cell units per screen pixel (AA)
    float thr = 1.0 - clamp(uGap, 0.0, 0.95);     // f beyond thr is the gap
    vec2 g = smoothstep(vec2(thr) - aa, vec2(thr) + aa, f);
    float gap = max(g.x, g.y);                    // 1 in the inter-LED gap, 0 on the LED
    float dist = length(uCamPos - vRWorld);
    float fade = 1.0 - smoothstep(uFade * 0.5, uFade, dist);
    gl_FragColor = vec4(0.0, 0.0, 0.0, gap * fade);
}
`;

// Scene layers the whole-scene feed renders (in draw order). Missing ones skipped.
const SCENE_LAYER_NAMES = ["Skybox", "World", "Splats", "AfterSplat"];

// On-demand rendering (renderEveryFrame off): the feed camera is enabled only while
// something that affects the image is changing, then disabled so the render target
// keeps its last frame. The warmups keep it rendering a little longer so the async
// splat sort / LOD stream settles before the image freezes.
const BUILD_WARMUP_SEC = 2.0;    // after a (re)build — lets the splat stream/sort in
const CHANGE_WARMUP_SEC = 0.4;   // after a detected change — lets the sort catch up
const FEED_POS_EPS = 0.0005;     // metres of feed-camera move that counts as a change
const FEED_ROT_DOT = 0.9999995;  // quat dot below this counts as a rotation change

// ─── Geometry ────────────────────────────────────────────────────────────────

// Columns across X when the screen is curved, so the horizontal bend is smooth.
// Also sets the density of the per-vertex curve-compensation warp in window mode —
// the residual "wave" from piecewise-linear UV interpolation shrinks ~1/N², so this
// is high. (A per-fragment shader would decouple warp quality from this entirely.)
const CURVE_COLS = 128;

// Horizontal curved-screen depth (like a curved monitor): displace a vertex along Z
// the further it is horizontally from centre. `curve` is a signed fraction of the
// opening half-width — positive bends toward the viewer (+Z), negative away, 0 flat.
// PURE GEOMETRY: the feed texture just maps onto the bent surface (no perspective
// correction). A fixed reference half-width keeps screen + frame aligned.
function curveZ(x, refHalfWidth, curve) {
    if (!curve || refHalfWidth <= 0) return 0;
    return curve * (x * x) / refHalfWidth;
}

// Outward surface normal of that curve at x (only matters if lighting is ever added;
// the screen/frame are unlit, but keep it correct). dz/dx = 2·curve·x/refHW.
function curveNormal(x, refHalfWidth, curve) {
    if (!curve || refHalfWidth <= 0) return [0, 0, 1];
    const dzdx = 2 * curve * x / refHalfWidth;
    const len = Math.hypot(dzdx, 1);
    return [-dzdx / len, 0, 1 / len];
}

function makeMesh(device, positions, normals, uvs, indices) {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    if (uvs) mesh.setUvs(0, uvs);
    mesh.setIndices(indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    return mesh;
}

// Screen quad facing local +Z, subdivided into `colsX` columns and bent in X. UVs:
// U = 0..1 across the width; V goes from `vBottom` (bottom edge) to `vTop` (top edge)
// — pass vTop < vBottom to flip vertically, or a count > 1 to tile (scanline overlay).
// colsX = 1 + curve = 0 gives exactly the old flat quad.
function buildScreenQuad(device, w, h, vBottom, vTop, curve, colsX) {
    const hw = w / 2, hh = h / 2;
    const positions = [], normals = [], uvs = [], indices = [];
    for (let iy = 0; iy <= 1; iy++) {
        const y = -hh + iy * h;
        const v = iy === 0 ? vBottom : vTop;
        for (let ix = 0; ix <= colsX; ix++) {
            const fx = ix / colsX;
            const x = -hw + fx * w;
            positions.push(x, y, curveZ(x, hw, curve));
            const nrm = curveNormal(x, hw, curve);
            normals.push(nrm[0], nrm[1], nrm[2]);
            uvs.push(fx, v);
        }
    }
    const rl = colsX + 1;
    for (let ix = 0; ix < colsX; ix++) {
        const a = ix, b = a + 1, c = a + rl, d = c + 1;
        indices.push(a, b, c, c, b, d);   // front faces +Z (cull back shows the feed)
    }
    return makeMesh(device, positions, normals, uvs, indices);
}

// Ordered CCW loop around a rectangle: colsX subdivisions on top & bottom (where the
// horizontal bend lives), colsY on the sides.
function rectLoop(w, h, colsX, colsY) {
    const hw = w / 2, hh = h / 2;
    const pts = [];
    for (let i = 0; i < colsX; i++) pts.push([-hw + (i / colsX) * w, -hh]);
    for (let i = 0; i < colsY; i++) pts.push([hw, -hh + (i / colsY) * h]);
    for (let i = 0; i < colsX; i++) pts.push([hw - (i / colsX) * w, hh]);
    for (let i = 0; i < colsY; i++) pts.push([-hw, hh - (i / colsY) * h]);
    return pts;
}

// Rectangular border ring of thickness t around the (w,h) opening, bent in X.
// colsX = 1 + curve = 0 gives a plain 4-corner rectangle frame.
function buildFrame(device, w, h, t, curve, colsX, depth) {
    const refHW = w / 2;
    const outer = rectLoop(w + 2 * t, h + 2 * t, colsX, 1);
    const inner = rectLoop(w, h, colsX, 1);
    const n = outer.length; // outer & inner share the count → 1:1 correspondence
    const d = depth || 0;
    const zc = (x) => curveZ(x, refHW, curve);
    const positions = [], normals = [], indices = [];
    if (Math.abs(d) <= 1e-4) {
        // Flat ring (original).
        for (let i = 0; i < n; i++) { positions.push(outer[i][0], outer[i][1], zc(outer[i][0])); normals.push(0, 0, 1); }
        for (let i = 0; i < n; i++) { positions.push(inner[i][0], inner[i][1], zc(inner[i][0])); normals.push(0, 0, 1); }
        for (let i = 0; i < n; i++) {
            const o0 = i, o1 = (i + 1) % n, i0 = n + i, i1 = n + ((i + 1) % n);
            indices.push(o0, i0, o1, o1, i0, i1);
        }
        return makeMesh(device, positions, normals, null, indices);
    }
    // Raised bezel: front face at +depth with outer + inner side walls back to the screen
    // plane. Blocks of n: 0 front-outer, n front-inner, 2n back-outer, 3n back-inner.
    // (Frame material is unlit + double-sided, so face normals don't need to be exact.)
    const push = (loop, zAdd) => { for (let i = 0; i < n; i++) { positions.push(loop[i][0], loop[i][1], zc(loop[i][0]) + zAdd); normals.push(0, 0, 1); } };
    push(outer, d); push(inner, d); push(outer, 0); push(inner, 0);
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const fo = i, fi = n + i, bo = 2 * n + i, bi = 3 * n + i;
        const fo1 = j, fi1 = n + j, bo1 = 2 * n + j, bi1 = 3 * n + j;
        indices.push(fo, fi, fo1, fo1, fi, fi1);   // front face (raised ring)
        indices.push(fo, bo, fo1, fo1, bo, bo1);   // outer side wall
        indices.push(fi, bi, fi1, fi1, bi, bi1);   // inner side wall (lip round the screen)
    }
    return makeMesh(device, positions, normals, null, indices);
}

export class SplatMonitor extends ArrivalScript {
    static scriptName = "Splat Monitor";

    // The splat to aim at (whole-scene mode) or show alone (isolated mode).
    targetSplat = "";

    // Isolated mode: render ONLY the target splat, moved to a private layer, so it
    // shows solely on this screen and nowhere else in the world. Off = whole-scene
    // feed (skybox + world + all splats + avatars) from the chosen viewpoint.
    isolateTarget = false;

    // Reveal a target that is HIDDEN in the scene so the monitor can show it (only
    // meaningful with isolateTarget). Flips the native hidden flag ephemerally (not
    // persisted); restored when the monitor is removed. See splat-portal.mjs.
    enableTargetSplat = true;

    // Screen size (metres).
    width = 3;
    height = 2;

    // Horizontal screen curve (pure geometry, like a curved monitor). 0 = flat;
    // + bends the sides toward the viewer, - bends them away. No perspective
    // correction — the feed just maps onto the bent surface.
    curve = 0;

    // Camera POV entity: if set, the feed is rendered from THIS entity's transform —
    // its position + orientation, looking down its local -Z. Highest-priority POV
    // source (overrides followPlayer and the fixed viewpoint; aim settings ignored).
    // Move / parent / animate the entity to drive the shot. Empty = use the modes below.
    cameraEntity = "";
    // Monitor mode only: rotate the POV 180° about its local X (flips both front & up).
    // Use when the POV model's lens faces its local +Z (opposite PlayCanvas's -Z) and/or
    // the screen quad is mounted upside-down, so the feed matches what the model films.
    flipPov = false;
    // Monitor mode: render the feed from a point pushed this many metres FORWARD along the
    // POV's view direction (e.g. to sit at the lens rather than the model origin, and so the
    // POV model's own body falls behind the eye and out of frame). Metres; 0 = at the entity.
    povForward = 0;
    // Add a static box collider the size of the screen so avatars can't pass through it.
    // Flat box for now (v1); a curved screen still gets a flat approximation.
    collision = false;
    // Depth (thickness) of that collider, in metres — the third dimension (its face is the
    // screen's width x height). Thicker = harder for fast avatars to tunnel through.
    collisionDepth = 0.1;
    // Also render OTHER Splat Monitors' screens into this feed. Their screen meshes live on
    // a main-camera-only layer, so feeds don't see them by default. Note: if this monitor's
    // OWN screen falls in frame it feeds back into itself (a video tunnel).
    showScreens = false;

    // Where the feed is rendered from when no cameraEntity is set. Off (default): the
    // FIXED viewpoint below — a monitor onto the space from somewhere you are not.
    // On: track the live player camera, so the screen mirrors your own view.
    followPlayer = false;

    // Fixed camera eye, WORLD coordinates (used when followPlayer is off).
    viewPosition = { x: 0, y: 2, z: 4 };

    // Fixed camera aim: point it at the target splat's centre. Off = aim at aimPoint.
    aimAtTarget = true;

    // Manual aim point, WORLD coordinates (used when aimAtTarget is off).
    aimPoint = { x: 0, y: 1, z: 0 };

    // Fixed camera field of view (degrees). Ignored when followPlayer is on (the
    // live camera's FOV is copied) and in windowMode (the projection is off-axis).
    fov = 60;

    // Window mode: treat the screen as a real WINDOW onto the splat rather than a
    // free-floating monitor feed. The feed is an off-axis projection from the eye
    // (POV position) THROUGH the screen rectangle, near-clipped at the screen plane —
    // so it shows what you'd see if the splat sat behind the screen. Moving the screen
    // re-frames the splat. For a true walk-around portal (parallax as you move) leave
    // cameraEntity empty + followPlayer on; a set cameraEntity is a FIXED trompe-l'oeil
    // eye (see the "WHICH EYE" note in the header). Only POV position is used
    // (orientation + aim ignored); fov is ignored.
    windowMode = false;

    // Curve compensation (window mode only): warp the feed so the off-axis window
    // reads correctly on the bent surface — the projection matrix alone can only do a
    // FLAT window. Per-fragment shader on WebGL (crisp), per-vertex CPU on WebGPU.
    // No effect when curve = 0 or windowMode is off.
    compensateCurve = true;

    // Redraw the feed every frame (default). Turn OFF to render only when the feed
    // viewpoint, the target splat's pose, or a setting changes, then freeze on the
    // last frame — big saving for a fixed monitor of a static splat. (While frozen it
    // won't catch LOD streaming or avatars moving in a whole-scene feed.)
    renderEveryFrame = true;

    // Feed texture vertical resolution (px). Lower = softer / more retro + cheaper.
    resolution = 1024;

    // Nearest-neighbour filtering — crisp retro pixels instead of smooth scaling.
    pixelated = false;

    // Feed grade.
    screenTint = { r: 1, g: 1, b: 1 };
    screenGain = 1;          // brightness multiplier
    scanlines = 0;           // CRT scanline overlay intensity (0 = off)
    scanlineCount = 240;     // number of scan lines down the panel

    // Pixel raster (LED wall): overlay the panel's physical LED grid, visible only up
    // close (like a real video wall's individual LEDs) and blended away with distance.
    // It's the panel's OWN fixed grid — independent of the feed content and the window
    // parallax. WebGL only (skipped on WebGPU).
    pixelRaster = false;
    // Horizontal LED count across the panel (the "resolution"); rows follow from the
    // aspect so LEDs stay square. e.g. 8192 on a 10 m panel ≈ 1.2 mm pitch — that fine
    // a grid only resolves within ~½ m; drop it (512–2048) for a coarser grid you can
    // see from a normal close distance.
    rasterColumns = 8192;
    // Dark gap between LEDs as a fraction of the cell (0 = none, 0.3 = chunky).
    rasterGap = 0.15;
    // Distance (m) at which the grid has fully blended away (full by half this). Very
    // fine grids also dissolve on their own once a cell is smaller than a screen pixel.
    rasterFadeDist = 0.5;

    // Clip feed splats between the feed camera and the monitor, so you see through to
    // what's behind it (the near plane can't do this — see CLIP_GLSL). Half-space clip
    // at the monitor's screen plane; works in monitor and window mode. Rough for a
    // rotated monitor (the plane follows the screen's facing), which is fine.
    clipInFront = false;

    // Slide the clip plane along the monitor normal (metres). + keeps more in front of
    // the monitor (clips less), − pushes the cut into the scene (clips more).
    clipOffset = 0;

    // Backdrop the feed camera clears to (shows wherever nothing is drawn).
    backdropColor = { r: 0, g: 0, b: 0 };

    // Render the back of the screen as a solid black panel (opaque monitor from
    // behind instead of a see-through double-sided quad).
    backsideBlack = true;

    // Glowing frame around the screen.
    showFrame = true;
    frameColor = { r: 0.3, g: 0.85, b: 1 };
    frameThickness = 0.06;
    frameDepth = 0;      // extrude the frame this many metres off the screen face (0 = flat ring; a
                         // bezel that sticks toward the viewer). Negative extrudes the other way.
    frameGlow = 6;

    static properties = {
        targetSplat: { title: "Splat (aim / isolate)", editor: "entity", filterTypes: ["splat"] },
        isolateTarget: { title: "Isolate Target Only" },
        enableTargetSplat: { title: "Reveal Hidden Splat" },
        width: { title: "Screen Width (m)", min: 0.2, max: 50, step: 0.1 },
        height: { title: "Screen Height (m)", min: 0.2, max: 50, step: 0.1 },
        curve: { title: "Screen Curve", min: -1, max: 1, step: 0.01 },
        cameraEntity: { title: "Camera POV (entity)", editor: "entity" },
        flipPov: { title: "Flip POV 180° (monitor)" },
        povForward: { title: "POV Forward Offset (m)", min: -10, max: 10, step: 0.05 },
        collision: { title: "Screen Collision (box)" },
        collisionDepth: { title: "Collision Depth (m)", min: 0.02, max: 5, step: 0.05 },
        showScreens: { title: "Show Screens in Feed" },
        followPlayer: { title: "Follow Player Camera" },
        viewPosition: { title: "Camera Position (world)" },
        aimAtTarget: { title: "Aim At Target Splat" },
        aimPoint: { title: "Aim Point (world)" },
        fov: { title: "Camera FOV", min: 10, max: 120, step: 1 },
        windowMode: { title: "Window Mode (portal)" },
        compensateCurve: { title: "Compensate Curve (window)" },
        renderEveryFrame: { title: "Render Every Frame" },
        resolution: { title: "Feed Resolution (px)", min: 64, max: 2048, step: 16 },
        pixelated: { title: "Pixelated" },
        screenTint: { title: "Screen Tint" },
        screenGain: { title: "Brightness", min: 0, max: 4, step: 0.05 },
        scanlines: { title: "Scanlines", min: 0, max: 1, step: 0.01 },
        scanlineCount: { title: "Scanline Count", min: 20, max: 1080, step: 10 },
        pixelRaster: { title: "Pixel Raster (LED)" },
        rasterColumns: { title: "Raster Columns (px)", min: 16, max: 16384, step: 16 },
        rasterGap: { title: "Raster Gap", min: 0, max: 0.9, step: 0.01 },
        rasterFadeDist: { title: "Raster Fade Dist (m)", min: 0.2, max: 30, step: 0.1 },
        clipInFront: { title: "Clip Splats In Front" },
        clipOffset: { title: "Clip Offset (m)", min: -10, max: 10, step: 0.05 },
        backdropColor: { title: "Backdrop Color" },
        backsideBlack: { title: "Black Backside" },
        showFrame: { title: "Show Frame" },
        frameColor: { title: "Frame Color" },
        frameThickness: { title: "Frame Thickness (m)", min: 0.005, max: 1, step: 0.005 },
        frameDepth: { title: "Frame Depth (m)", min: -2, max: 2, step: 0.01 },
        frameGlow: { title: "Frame Glow", min: 0, max: 20, step: 0.1 },
    };

    // ── internal state ──
    _destroyed = false;
    _ready = false;
    _device = null;
    _texture = null;
    _rt = null;
    _rttCam = null;                  // hidden feed camera (child of this.entity)
    _collisionEntity = null;         // optional static box collider matching the screen
    _privateLayer = null;            // isolated-mode layer only _rttCam renders
    _screenLayer = null;             // shared layer for our own meshes (main cam only)
    _screenEntity = null;
    _frameEntity = null;
    _backEntity = null;
    _scanEntity = null;
    _scanTex = null;
    _rasterEntity = null;            // LED-grid overlay (main camera only)
    _rasterMat = null;
    _screenMat = null;
    _scanMat = null;

    _subjects = new Map();           // gsplatComponent -> { origLayers, origEnabled }
    _targetEntity = null;
    _targetUme = null;
    _targetHiddenOrig = false;
    _targetEntityEnabled = true;
    _gateServer = null;
    _acquireTimer = 0;

    _mainCam = null;
    _tmpAim = new pc.Vec3();
    _tmpPos = new pc.Vec3();
    _up = new pc.Vec3(0, 1, 0);

    // Window-mode off-axis scratch (avoid per-frame allocation).
    _wEye = new pc.Vec3();
    _wL = new pc.Vec3();
    _wBL = new pc.Vec3(); _wBR = new pc.Vec3(); _wTL = new pc.Vec3();
    _wVr = new pc.Vec3(); _wVu = new pc.Vec3(); _wVn = new pc.Vec3();
    _wVa = new pc.Vec3(); _wVb = new pc.Vec3(); _wVc = new pc.Vec3();
    _winProj = new pc.Mat4();
    _winProjFn = (mat) => mat.copy(this._winProj);   // camera.calculateProjection
    // Curve-compensation scratch (window mode).
    _wInv = new pc.Mat4();
    _eLocal = new pc.Vec3();
    _qScratch = new Float32Array((CURVE_COLS + 1) * 4);   // Q.x,Q.y per vertex (2 rows)
    _uvScratch = new Float32Array((CURVE_COLS + 1) * 4);  // u,v per vertex (CPU warp)
    _lastWarpKey = null;
    _warpVi = 0;                     // vertex count from the last bbox pass
    _bb = [0, 0, 0, 0];              // reused bbox return [minx,maxx,miny,maxy]
    _warpMat = null;                 // per-fragment warp ShaderMaterial (WebGL)
    _useWarpShader = false;          // false → CPU per-vertex fallback (WebGPU)
    _uEye = new Float32Array(3);     // reused shader-uniform scratch
    _uMin = new Float32Array(2);
    // Feed-splat clip (gsplatModifyVS half-space).
    _clipMats = new Map();           // material -> saved chunk state (for restore)
    _clipMatsScratch = [];           // reused per-frame material list
    _clipN = new pc.Vec3();
    _clipVec = new pc.Vec3();
    _clipPlane = [0, 0, 0, 0];       // reused [Nx,Ny,Nz,w]
    _uSize = new Float32Array(2);
    _uTint = new Float32Array(3);
    // Pixel-raster uniforms scratch.
    _uGrid = new Float32Array(2);
    _uCamPos = new Float32Array(3);

    // On-demand render gate (renderEveryFrame off).
    _renderTimeLeft = 0;
    _lastFeedPos = null;
    _lastFeedRot = null;
    _lastTargetKey = null;
    _lastHostKey = null;
    _renderDirty = false;

    initialize() {
        this._destroyed = false;
        this._device = this.app.graphicsDevice;
        this._setup();
    }

    update(dt) {
        if (this._destroyed || !this._ready) return;
        this._ensureScreenLayerOnCamera();
        this._positionCamera();

        // Re-acquire: late-streaming / re-unifying splats, target reassignment, a
        // just-revealed splat still loading. Run every frame while we still need a
        // subject we don't have yet; otherwise throttle.
        this._acquireTimer += dt;
        const needSubject = this.isolateTarget && !!String(this.targetSplat || "").trim();
        const waiting = needSubject && this._subjects.size === 0;
        if (this._acquireTimer > (waiting ? 0 : 0.5)) {
            this._acquireTimer = 0;
            this._acquire();
        }

        // Enable/disable the feed camera for this frame (on-demand rendering).
        this._updateRenderGate(dt);
        // Half-space clip of feed splats in front of the monitor.
        this._updateClip();
        // Feed the LED-raster overlay the live camera position (distance fade).
        this._updateRaster();
    }

    onPropertyChanged(name) {
        if (!this._ready) return;
        this._renderDirty = true; // any tweak → redraw at least once in on-demand mode
        // Affects the render target / camera / screen geometry — rebuild everything.
        if (name === "isolateTarget" || name === "resolution" || name === "pixelated" ||
            name === "width" || name === "height" || name === "showScreens") {
            this._teardown();
            this._setup();
            return;
        }
        // Affects only our own meshes — rebuild just those (keeps the feed running).
        // (compensateCurve toggling off must rebuild to restore the un-warped UVs.)
        if (name === "showFrame" || name === "frameThickness" || name === "frameDepth" || name === "backsideBlack" ||
            name === "scanlineCount" || name === "curve" || name === "compensateCurve" ||
            name === "pixelRaster") {
            this._rebuildScreenMeshes();
            return;
        }
        if (name === "scanlines") {
            if ((this.scanlines > 0) !== !!this._scanEntity) this._rebuildScreenMeshes();
            else if (this._scanMat) { this._scanMat.opacity = this.scanlines; this._scanMat.update(); }
            return;
        }
        if (name === "rasterColumns" || name === "rasterGap" || name === "rasterFadeDist") {
            if (this._rasterMat) this._applyRasterUniforms(this._rasterMat);
            return;
        }
        if (name === "targetSplat" || name === "enableTargetSplat") {
            this._restoreSubjects();
            this._acquire();
            return;
        }
        // windowMode also rebuilds the screen meshes so warped UVs are reset when
        // leaving window mode (and re-warped on the next frame when entering it).
        if (name === "windowMode") { this._rebuildScreenMeshes(); this._positionCamera(); return; }
        if (name === "collision" || name === "collisionDepth") { this._buildCollision(); return; }
        if (name === "followPlayer" || name === "cameraEntity" || name === "flipPov" || name === "povForward") { this._positionCamera(); return; }
        if (name === "fov" && this._rttCam) { this._rttCam.camera.fov = this.fov; return; }
        if (name === "backdropColor" && this._rttCam) {
            this._rttCam.camera.clearColor = new pc.Color(this.backdropColor.r, this.backdropColor.g, this.backdropColor.b, 1);
            return;
        }
        if (name === "screenTint" || name === "screenGain") { this._applyGrade(); return; }
        if ((name === "frameColor" || name === "frameGlow") && this._frameEntity) {
            const m = this._frameEntity.render?.meshInstances?.[0]?.material;
            if (m) {
                m.emissive = new pc.Color(this.frameColor.r, this.frameColor.g, this.frameColor.b);
                m.emissiveIntensity = this.frameGlow;
                m.update();
            }
        }
    }

    destroy() {
        this._destroyed = true;
        this._teardown();
    }

    // ── setup / teardown ─────────────────────────────────────────────────────

    _setup() {
        this._ensureScreenLayer();
        this._buildTexture();
        this._buildCamera();
        this._buildScreenMeshes();
        this._buildCollision();
        this._createWarpMaterial();
        this._ready = true;
        // Reset the render gate: render for a warm-up window so the splat streams /
        // sorts in before the image is allowed to freeze (on-demand mode).
        this._lastFeedPos = null;
        this._lastFeedRot = null;
        this._lastTargetKey = null;
        this._renderDirty = false;
        this._renderTimeLeft = BUILD_WARMUP_SEC;
        this._acquire();
        this._positionCamera();
    }

    _teardown() {
        this._ready = false;
        this._restoreClips();          // restore feed-splat chunks before the material goes
        this._restoreSubjects();
        this._destroyScreenMeshes();
        this._destroyCollision();
        if (this._rttCam) { this._rttCam.destroy(); this._rttCam = null; }
        // The PRIVATE feed layer is per-instance — remove it (it was never on the
        // main camera, only on the feed camera we just destroyed). The SHARED screen
        // layer is persistent and left in place.
        if (this._privateLayer) {
            try {
                this.app.scene.layers.remove(this._privateLayer);
                this.app.scene.layerComposition?.remove?.(this._privateLayer);
            } catch (e) { /* ignore */ }
            this._privateLayer = null;
        }
        if (this._rt) { try { this._rt.destroy(); } catch (e) { /* ignore */ } this._rt = null; }
        if (this._texture) { try { this._texture.destroy(); } catch (e) { /* ignore */ } this._texture = null; }
        if (this._warpMat) { try { this._warpMat.destroy(); } catch (e) { /* ignore */ } this._warpMat = null; }
        this._useWarpShader = false;
    }

    // Per-fragment curve-compensation shader material (WebGL only). WebGPU has no
    // WGSL twin here, so it stays on the per-vertex CPU warp fallback.
    _createWarpMaterial() {
        if (this._device.isWebGPU) { this._useWarpShader = false; return; }
        try {
            const m = new pc.ShaderMaterial({
                uniqueName: "SplatMonitorWarp",
                attributes: { aPosition: pc.SEMANTIC_POSITION },
                vertexGLSL: WARP_VS_GLSL,
                fragmentGLSL: WARP_FS_GLSL,
            });
            m.blendType = pc.BLEND_NONE;
            m.depthTest = true;
            m.depthWrite = true;
            m.cull = this.backsideBlack ? pc.CULLFACE_BACK : pc.CULLFACE_NONE;
            m.update();
            this._warpMat = m;
            this._useWarpShader = true;
        } catch (e) {
            this._warpMat = null;
            this._useWarpShader = false;   // fall back to the CPU warp
        }
    }

    // ── shared screen layer (our own meshes; main camera only) ────────────────

    _ensureScreenLayer() {
        const app = this.app;
        let layer = app.scene.layers.getLayerByName(SCREEN_LAYER_NAME);
        if (!layer) {
            layer = new pc.Layer({ name: SCREEN_LAYER_NAME });
            const list = app.scene.layers;
            const after = list.getLayerByName("AfterSplat") || list.getLayerByName("Splats") || list.getLayerByName("World");
            let idx = after ? list.layerList.indexOf(after) + 1 : list.layerList.length;
            if (idx < 0) idx = list.layerList.length;
            list.insert(layer, idx);
        }
        this._screenLayer = layer;
        this._ensureScreenLayerOnCamera();
    }

    // Make the MAIN camera render the shared screen layer. Two steps, both required:
    //   1. push the id into camera.layers (never REASSIGN the array — that rebuilds
    //      the camera and freezes HDR/CameraFrame; push mutates in place).
    //   2. register the camera ON the layer via layer.addCamera(). The push in (1)
    //      bypasses the camera.layers setter, which is the ONLY thing that normally
    //      calls addCamera — so without this the layer has ZERO cameras and the
    //      composition never builds a render action for it (layer silently invisible,
    //      even though its id is in camera.layers). Verified live: cameras 0 -> 1.
    // Idempotent + retried from update() until the main camera exists.
    _ensureScreenLayerOnCamera() {
        if (!this._screenLayer) return;
        const main = this._mainCamera();
        if (!main?.camera) return;
        const layer = this._screenLayer;
        if (!main.camera.layers.includes(layer.id)) main.camera.layers.push(layer.id);
        if (layer.cameras && layer.cameras.indexOf(main.camera) < 0 && typeof layer.addCamera === "function") {
            layer.addCamera(main.camera);
        }
    }

    // ── render target ────────────────────────────────────────────────────────

    _buildTexture() {
        const device = this._device;
        const H = Math.max(64, Math.min(2048, Math.round(this.resolution)));
        const W = Math.max(64, Math.round(H * (this.width / Math.max(0.01, this.height))));
        const filter = this.pixelated ? pc.FILTER_NEAREST : pc.FILTER_LINEAR;
        const fmt = pc.PIXELFORMAT_RGBA8 ?? pc.PIXELFORMAT_R8_G8_B8_A8;
        this._texture = new pc.Texture(device, {
            name: "SplatMonitorFeed",
            width: W, height: H,
            format: fmt,
            mipmaps: false,
            minFilter: filter, magFilter: filter,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
        });
        this._rt = new pc.RenderTarget({
            name: "SplatMonitorRT",
            colorBuffer: this._texture,
            depth: true,
            samples: 1,
        });
    }

    // ── feed camera ──────────────────────────────────────────────────────────

    _buildCamera() {
        const app = this.app;
        let layers;
        if (this.isolateTarget) {
            // Private layer only this camera renders; the target splat is moved onto
            // it in _acquire (so it leaves the world view). Render the splat ALONE
            // over the backdrop colour — do NOT add the Skybox layer: this room's
            // skybox is a hazy fog that washes the splat out (verified live).
            const uid = (app._splatMonitorUid = (app._splatMonitorUid || 0) + 1);
            this._privateLayer = new pc.Layer({ name: "SplatMonitorFeed_" + uid });
            app.scene.layers.insert(this._privateLayer, 0);
            layers = [this._privateLayer.id];
        } else {
            layers = this._sceneLayerIds();
            // Include the shared screen layer so the feed shows other monitors' screens.
            if (this.showScreens && this._screenLayer) layers.push(this._screenLayer.id);
        }

        this._rttCam = new pc.Entity("SplatMonitorCamera");
        this._rttCam.addComponent("camera", {
            layers,
            priority: -1,                       // render before the main camera
            renderTarget: this._rt,
            clearColor: new pc.Color(this.backdropColor.r, this.backdropColor.g, this.backdropColor.b, 1),
            fov: this.fov,
            aspectRatioMode: pc.ASPECT_MANUAL,
            aspectRatio: this.width / Math.max(0.01, this.height),
            nearClip: 0.05,
            farClip: 2000,
        });
        // Match the world's tonemapping so the feed's colours line up with the scene.
        const mainCam = this._mainCamera();
        if (mainCam && mainCam.camera && this._rttCam.camera) {
            try { this._rttCam.camera.toneMapping = mainCam.camera.toneMapping; } catch (e) { /* ignore */ }
        }
        this.entity.addChild(this._rttCam);      // auto-cleaned with the host entity
    }

    _sceneLayerIds() {
        const ids = [];
        for (const n of SCENE_LAYER_NAMES) {
            const L = this.app.scene.layers.getLayerByName(n);
            if (L) ids.push(L.id);
        }
        return ids;
    }

    _mainCamera() {
        if (!this._mainCam || !this._mainCam.camera) {
            this._mainCam = this.app.root.findByName("Camera");
        }
        return this._mainCam;
    }

    _positionCamera() {
        const cam = this._rttCam;
        if (!cam) return;
        if (this.windowMode) this._positionWindow(cam);
        else this._positionMonitor(cam);
    }

    // Monitor projection: a free perspective camera looking wherever the POV points.
    _positionMonitor(cam) {
        // Clear the off-axis override on the CAMERA COMPONENT (see _positionWindow).
        if (cam.camera && cam.camera.calculateProjection) cam.camera.calculateProjection = null;
        this._restoreScreenMaterial();   // undo any window-mode warp-shader swap
        // 1. Camera-POV entity (highest priority): render from ITS transform — its
        //    world position + orientation, looking down its local -Z (PlayCanvas
        //    camera forward). Aim / viewPosition / followPlayer are all ignored.
        const pov = this._resolveCameraEntity();
        if (pov) {
            cam.setPosition(pov.getPosition());
            cam.setRotation(pov.getRotation());
            if (this.flipPov) cam.rotateLocal(180, 0, 0);   // lens faces +Z / quad mounted flipped
            if (this.povForward) cam.translateLocal(0, 0, -this.povForward);  // push eye forward along the view
            cam.camera.fov = this.fov;
            return;
        }
        // 2. Follow the live player camera.
        if (this.followPlayer) {
            const main = this._mainCamera();
            if (!main) return;
            cam.setPosition(main.getPosition());
            cam.setRotation(main.getRotation());
            if (main.camera && cam.camera) cam.camera.fov = main.camera.fov;
            return;
        }
        // 3. Fixed viewpoint aimed at the target / aim point.
        this._tmpPos.set(this.viewPosition.x, this.viewPosition.y, this.viewPosition.z);
        cam.setPosition(this._tmpPos);
        cam.camera.fov = this.fov;
        cam.lookAt(this._aimTarget(), this._up);
    }

    // Window projection: an OFF-AXIS (asymmetric) frustum from the eye THROUGH the
    // screen rectangle, so the screen reads as a real window onto the splat (moving
    // the eye or the monitor changes the view). The camera sits at the eye, oriented
    // to the screen basis; the projection is fed via cam.camera.calculateProjection.
    // Near-clipped at the screen plane. With a CURVED screen + compensateCurve the
    // render rect is enlarged to the curve's projected bounds and the feed is warped
    // to the bent surface — per-fragment on WebGL (_warpMat), per-vertex on WebGPU.
    _positionWindow(cam) {
        const eye = this._eyePosition(this._wEye);
        const wt = this.entity.getWorldTransform();
        const hw = this.width / 2, hh = this.height / 2;
        const curve = this.curve || 0;
        const screenMI = (this._screenEntity && this._screenEntity.render) ? this._screenEntity.render.meshInstances[0] : null;
        const compensate = curve !== 0 && this.compensateCurve && !!screenMI;

        // Render-rect local x,y extents: the flat window, or (compensation) the
        // bounding box of the eye→curved-surface rays on the screen plane.
        let rminx = -hw, rmaxx = hw, rminy = -hh, rmaxy = hh;
        if (compensate) {
            const bb = this._curveBBox(eye, wt, hw, hh, curve);   // fills _qScratch + _eLocal
            rminx = bb[0]; rmaxx = bb[1]; rminy = bb[2]; rmaxy = bb[3];
            if (this._useWarpShader) this._applyWarpShader(screenMI, curve, hw, rminx, rmaxx, rminy, rmaxy);
            else { this._restoreScreenMaterial(); this._writeWarpedUVs(screenMI.mesh, rminx, rmaxx, rminy, rmaxy); }
        } else {
            this._restoreScreenMaterial();   // flat window / no curve — standard material
        }

        wt.transformPoint(this._wL.set(rminx, rminy, 0), this._wBL);
        wt.transformPoint(this._wL.set(rmaxx, rminy, 0), this._wBR);
        wt.transformPoint(this._wL.set(rminx, rmaxy, 0), this._wTL);
        const vr = this._wVr.sub2(this._wBR, this._wBL).normalize();
        const vu = this._wVu.sub2(this._wTL, this._wBL).normalize();
        const vn = this._wVn.cross(vr, vu).normalize();
        const va = this._wVa.sub2(this._wBL, eye);
        const vb = this._wVb.sub2(this._wBR, eye);
        const vc = this._wVc.sub2(this._wTL, eye);
        let d = -vn.dot(va);
        if (d < 0.05) d = 0.05;                // eye at / behind the screen — clamp
        const n = d, f = 2000;                 // near plane AT the screen
        const l = vr.dot(va) * n / d, r = vr.dot(vb) * n / d;
        const b = vu.dot(va) * n / d, t = vu.dot(vc) * n / d;
        const m = this._winProj.data;          // glFrustum, column-major
        m[0] = 2 * n / (r - l); m[1] = 0; m[2] = 0; m[3] = 0;
        m[4] = 0; m[5] = 2 * n / (t - b); m[6] = 0; m[7] = 0;
        m[8] = (r + l) / (r - l); m[9] = (t + b) / (t - b); m[10] = -(f + n) / (f - n); m[11] = -1;
        m[12] = 0; m[13] = 0; m[14] = -2 * f * n / (f - n); m[15] = 0;
        cam.setPosition(eye);
        cam.setRotation(this.entity.getRotation());   // align camera to the screen basis
        // calculateProjection lives on the CAMERA COMPONENT (cam.camera), not the
        // entity — setting it on the entity is an inert no-op and the off-axis matrix
        // never reaches the renderer (feed silently falls back to a symmetric camera,
        // so screen movement has no effect). Route it to the component.
        const cc = cam.camera;
        if (cc && cc.calculateProjection !== this._winProjFn) cc.calculateProjection = this._winProjFn;
    }

    // Curve compensation, shared CPU pass. For each point on the curved screen (local
    // grid) intersect the ray eye→P with the flat window plane (local z=0) at Q,
    // storing Q in _qScratch and tracking the bbox. The bbox enlarges the off-axis
    // frustum so edge rays stay in-texture; the per-vertex fallback reuses the Q's as
    // warped UVs (the shader path recomputes the warp per-fragment instead).
    _curveBBox(eye, wt, hw, hh, curve) {
        this._wInv.copy(wt).invert();
        this._wInv.transformPoint(eye, this._eLocal);      // eye in local space (plane z=0)
        const ex = this._eLocal.x, ey = this._eLocal.y, ez = this._eLocal.z;
        const w = this.width, h = this.height, colsX = CURVE_COLS, q = this._qScratch;
        let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, vi = 0;
        for (let iy = 0; iy <= 1; iy++) {
            const y = -hh + iy * h;
            for (let ix = 0; ix <= colsX; ix++) {
                const x = -hw + (ix / colsX) * w;
                const pz = curveZ(x, hw, curve);
                const denom = pz - ez;
                const t = Math.abs(denom) < 1e-6 ? 0 : -ez / denom;   // ray eye→P hits z=0
                const qx = ex + t * (x - ex), qy = ey + t * (y - ey);
                q[vi * 2] = qx; q[vi * 2 + 1] = qy;
                if (qx < minx) minx = qx; if (qx > maxx) maxx = qx;
                if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
                vi++;
            }
        }
        this._warpVi = vi;
        const bb = this._bb; bb[0] = minx; bb[1] = maxx; bb[2] = miny; bb[3] = maxy;
        return bb;
    }

    // Per-fragment warp (WebGL): swap the screen to the warp ShaderMaterial and feed
    // it the eye / curve / render-rect so each pixel samples the exact ray — no
    // piecewise-linear "wave" from vertex interpolation (decoupled from CURVE_COLS).
    _applyWarpShader(mi, curve, hw, minx, maxx, miny, maxy) {
        const M = this._warpMat;
        const wantCull = this.backsideBlack ? pc.CULLFACE_BACK : pc.CULLFACE_NONE;
        if (M.cull !== wantCull) { M.cull = wantCull; M.update(); }
        if (mi.material !== M) mi.material = M;
        const rw = (maxx - minx) || 1, rh = (maxy - miny) || 1, e = this._eLocal;
        this._uEye[0] = e.x; this._uEye[1] = e.y; this._uEye[2] = e.z;
        this._uMin[0] = minx; this._uMin[1] = miny;
        this._uSize[0] = rw; this._uSize[1] = rh;
        this._uTint[0] = this.screenTint.r; this._uTint[1] = this.screenTint.g; this._uTint[2] = this.screenTint.b;
        M.setParameter("uEyeLocal", this._uEye);
        M.setParameter("uCurve", curve);
        M.setParameter("uRefHW", hw);
        M.setParameter("uMin", this._uMin);
        M.setParameter("uSize", this._uSize);
        M.setParameter("uFlipV", this._device.isWebGPU ? 1 : 0);
        M.setParameter("uTint", this._uTint);
        M.setParameter("uGain", this.screenGain);
        M.setParameter("uTex", this._texture);
    }

    // Per-vertex warp (WebGPU fallback): write the Q's from _curveBBox as the screen
    // mesh UVs. Guarded so the mesh only re-uploads when the projected bounds move.
    _writeWarpedUVs(mesh, minx, maxx, miny, maxy) {
        const key = minx.toFixed(4) + "," + maxx.toFixed(4) + "," + miny.toFixed(4) + "," + maxy.toFixed(4);
        if (key === this._lastWarpKey) return;
        this._lastWarpKey = key;
        const rw = (maxx - minx) || 1, rh = (maxy - miny) || 1;
        const flipV = this._device.isWebGPU, q = this._qScratch, uv = this._uvScratch, vi = this._warpVi;
        for (let i = 0; i < vi; i++) {
            const u = (q[i * 2] - minx) / rw;
            let v = (q[i * 2 + 1] - miny) / rh;
            if (flipV) v = 1 - v;
            uv[i * 2] = u; uv[i * 2 + 1] = v;
        }
        try { mesh.setUvs(0, uv.subarray(0, vi * 2)); mesh.update(pc.PRIMITIVE_TRIANGLES); }
        catch (e) { /* mesh mid-rebuild */ }
    }

    _restoreScreenMaterial() {
        const mi = (this._screenEntity && this._screenEntity.render) ? this._screenEntity.render.meshInstances[0] : null;
        if (mi && this._screenMat && mi.material !== this._screenMat) mi.material = this._screenMat;
    }

    // ── feed-splat clip (hide splats in front of the monitor) ─────────────────

    _updateClip() {
        if (!this.clipInFront) {
            for (const mat of this._clipMats.keys()) { try { mat.setParameter("uMonitorClipOn", 0); } catch (e) { /* gone */ } }
            return;
        }
        const pl = this._worldClipPlane();
        const mats = this._feedSplatMaterials();
        for (const mat of mats) {
            this._ensureClipChunk(mat);
            mat.setParameter("uMonitorClip", pl);
            mat.setParameter("uMonitorClipOn", 1);
        }
    }

    // Monitor screen plane as a world-space clip plane: normal = the screen's facing,
    // flipped to point at the feed camera, so splats on the camera side get cut.
    // MONITOR mode: a CURVED screen bulges its edges toward the viewer, so a plane at
    // the flat centre would over-clip content seen through the curve — push the plane
    // out to the curve's front-most depth so it only clips beyond the outer edges.
    // WINDOW mode: the window (and the off-axis near plane) is the FLAT plane at local
    // z=0; the curve is only a display remap that compensateCurve already cancels, so
    // adding the edge push here would compensate the curve a SECOND time and misplace
    // the cut (over-clip). Keep the plane flat there — same as a flat screen.
    // `clipOffset` adds to the plane in both modes.
    _worldClipPlane() {
        const P = this.entity.getPosition();
        const fwd = this.entity.forward;                       // world -Z of the entity
        const N = this._clipN.set(-fwd.x, -fwd.y, -fwd.z);     // the screen's local +Z
        const camPos = this._rttCam ? this._rttCam.getPosition() : P;
        const dir = this._clipVec.sub2(camPos, P).dot(N) < 0 ? -1 : 1;  // is +Z toward the cam?
        if (dir < 0) N.set(-N.x, -N.y, -N.z);                  // flip N toward the camera
        let delta = 0;
        const curve = this.curve || 0;
        if (curve !== 0 && !this.windowMode) delta = Math.max(0, curveZ(this.width / 2, this.width / 2, curve) * dir);
        const pl = this._clipPlane;
        pl[0] = N.x; pl[1] = N.y; pl[2] = N.z;
        pl[3] = -(N.x * P.x + N.y * P.y + N.z * P.z) - (this.clipOffset || 0) - delta;
        return pl;
    }

    // The unified splat material(s) the FEED camera renders, via the gsplat director
    // (per camera+layer). Clipping these affects only the feed, not the main view.
    _feedSplatMaterials() {
        const out = this._clipMatsScratch; out.length = 0;
        const dir = this.app.renderer && this.app.renderer.gsplatDirector;
        const feedCam = this._rttCam && this._rttCam.camera && this._rttCam.camera.camera;
        if (!dir || !feedCam || !dir.getCameraData) return out;
        const data = dir.getCameraData(feedCam);
        if (!data || !data.layersMap) return out;
        for (const [, info] of data.layersMap) {
            const m = info && info.gsplatManager && info.gsplatManager.renderer && info.gsplatManager.renderer._material;
            if (m) out.push(m);
        }
        return out;
    }

    // Inject the clip chunk into a splat material once (both shader languages),
    // remembering the original so destroy() can put it back.
    _ensureClipChunk(mat) {
        if (this._clipMats.has(mat)) return;
        const saved = {};
        for (const [lang, code] of [["glsl", CLIP_GLSL], ["wgsl", CLIP_WGSL]]) {
            try {
                const ch = mat.getShaderChunks(lang);
                saved[lang] = { had: ch.has(CLIP_CHUNK), orig: ch.get(CLIP_CHUNK) };
                ch.set(CLIP_CHUNK, code);
            } catch (e) { /* older API / lang unavailable */ }
        }
        mat.update();
        this._clipMats.set(mat, saved);
    }

    _restoreClips() {
        for (const [mat, saved] of this._clipMats) {
            try {
                for (const lang of ["glsl", "wgsl"]) {
                    const s = saved[lang]; if (!s) continue;
                    const ch = mat.getShaderChunks(lang);
                    if (s.had) ch.set(CLIP_CHUNK, s.orig); else ch.delete(CLIP_CHUNK);
                }
                mat.setParameter("uMonitorClipOn", 0);
                mat.update();
            } catch (e) { /* material may be gone */ }
        }
        this._clipMats.clear();
        try { this.app.fire("reApplySplatMaterial"); } catch (e) { /* ignore */ }
    }

    // Eye world position from the active POV source (position only — window mode
    // ignores orientation; monitor mode uses the full transform in _positionMonitor).
    _eyePosition(out) {
        const pov = this._resolveCameraEntity();
        if (pov) return out.copy(pov.getPosition());
        if (this.followPlayer) {
            const main = this._mainCamera();
            if (main) return out.copy(main.getPosition());
        }
        return out.set(this.viewPosition.x, this.viewPosition.y, this.viewPosition.z);
    }

    _aimTarget() {
        if (this.aimAtTarget) {
            const c = this._targetCenter();
            if (c) return c;
        }
        return this._tmpAim.set(this.aimPoint.x, this.aimPoint.y, this.aimPoint.z);
    }

    // World-space centre of the target splat, best-effort across unified / non-unified.
    _targetCenter() {
        let comps = Array.from(this._subjects.keys());
        if (comps.length === 0) {
            const t = this._resolveTarget();
            if (t) comps = t.findComponents?.("gsplat") || [];
        }
        for (const c of comps) {
            const center = this._gsplatWorldCenter(c);
            if (center) return center;
        }
        return null;
    }

    _gsplatWorldCenter(c) {
        // Non-unified: the mesh-instance AABB is already world-space.
        const mi = c.instance && c.instance.meshInstance;
        if (mi && mi.aabb) return this._tmpAim.copy(mi.aabb.center);
        // Unified: no instance — transform the (local) resource AABB into world space.
        const res = c.asset?.resource || c.resource;
        if (res && res.aabb && c.entity) {
            try { c.entity.getWorldTransform().transformPoint(res.aabb.center, this._tmpAim); return this._tmpAim; }
            catch (e) { /* fall through */ }
        }
        if (c.entity) return this._tmpAim.copy(c.entity.getPosition());
        return null;
    }

    // ── on-demand render gate ─────────────────────────────────────────────────

    _updateRenderGate(dt) {
        const cam = this._rttCam;
        if (!cam) return;
        if (this.renderEveryFrame) { if (!cam.enabled) cam.enabled = true; return; }
        if (this._detectFeedChange()) this._renderTimeLeft = Math.max(this._renderTimeLeft, CHANGE_WARMUP_SEC);
        const render = this._renderTimeLeft > 0;
        cam.enabled = render;               // disabled → RT keeps its last frame
        if (render) this._renderTimeLeft -= dt;
    }

    // True if anything that changes the feed image has moved since last frame: the
    // feed camera pose, the target splat's world transform, or a setting (_renderDirty).
    _detectFeedChange() {
        let changed = this._renderDirty;
        this._renderDirty = false;
        const cam = this._rttCam;
        const p = cam.getPosition(), r = cam.getRotation();
        if (!this._lastFeedPos) {
            this._lastFeedPos = p.clone();
            this._lastFeedRot = r.clone();
            changed = true;
        } else {
            if (p.distance(this._lastFeedPos) > FEED_POS_EPS) changed = true;
            else if (Math.abs(r.x * this._lastFeedRot.x + r.y * this._lastFeedRot.y +
                              r.z * this._lastFeedRot.z + r.w * this._lastFeedRot.w) < FEED_ROT_DOT) changed = true;
            this._lastFeedPos.copy(p);
            this._lastFeedRot.copy(r);
        }
        const key = this._targetTransformKey();
        if (key !== this._lastTargetKey) { changed = true; this._lastTargetKey = key; }
        // Window mode: moving/rotating the monitor changes what the window shows,
        // even if the eye is still — so track the host transform too.
        if (this.windowMode) {
            const hk = this._entityKey(this.entity);
            if (hk !== this._lastHostKey) { changed = true; this._lastHostKey = hk; }
        }
        return changed;
    }

    // Cheap world-transform fingerprint of the target splat entity (rounded to avoid
    // float jitter), so a moving / animated splat re-renders the feed.
    _targetTransformKey() {
        let ent = null;
        const first = this._subjects.keys().next();
        if (!first.done && first.value && first.value.entity) ent = first.value.entity;
        if (!ent) ent = this._resolveTarget();
        return this._entityKey(ent);
    }

    _entityKey(ent) {
        if (!ent) return "";
        const p = ent.getPosition(), r = ent.getRotation(), s = ent.getLocalScale();
        return p.x.toFixed(3) + "," + p.y.toFixed(3) + "," + p.z.toFixed(3) + "," +
               r.x.toFixed(3) + "," + r.y.toFixed(3) + "," + r.z.toFixed(3) + "," + r.w.toFixed(3) + "," +
               s.x.toFixed(3) + "," + s.y.toFixed(3) + "," + s.z.toFixed(3);
    }

    // ── screen surface (our own meshes, on the shared screen layer) ───────────

    _buildScreenMeshes() {
        const device = this._device;
        this._lastWarpKey = null;   // fresh mesh has un-warped UVs — force a re-warp
        // Feed orientation: WebGL needs NO UV flip (verified live — the material
        // samples the render target upright). WebGPU uses the opposite convention.
        // If a WebGPU device shows the feed upside-down, this is the one knob.
        const flipV = device.isWebGPU;
        const layerIds = this._screenLayer ? [this._screenLayer.id] : null;
        const curve = this.curve || 0;
        const colsX = curve ? CURVE_COLS : 1;   // subdivide in X only when curved
        const w = this.width, h = this.height;

        this._screenEntity = new pc.Entity("SplatMonitorScreen");
        this.entity.addChild(this._screenEntity);
        this._screenMat = this._screenMaterial();
        // flipV: top edge V < bottom edge V so the feed reads upright.
        this._setRenderMesh(this._screenEntity, buildScreenQuad(device, w, h, flipV ? 1 : 0, flipV ? 0 : 1, curve, colsX), this._screenMat, layerIds);

        if (this.showFrame) {
            this._frameEntity = new pc.Entity("SplatMonitorFrame");
            this.entity.addChild(this._frameEntity);
            const t = Math.max(0.005, this.frameThickness);
            this._setRenderMesh(this._frameEntity, buildFrame(device, w, h, t, curve, colsX, this.frameDepth), this._frameMaterial(), layerIds);
        }

        // Solid black back panel — only its back faces render (cull front), so the
        // monitor is opaque from behind but the feed shows from the front.
        if (this.backsideBlack) {
            this._backEntity = new pc.Entity("SplatMonitorBack");
            this.entity.addChild(this._backEntity);
            this._setRenderMesh(this._backEntity, buildScreenQuad(device, w, h, 0, 1, curve, colsX), this._backMaterial(), layerIds);
        }

        // CRT scanline overlay — a transparent quad multiplying dark lines over the
        // feed. A 1x2 alpha texture (line / gap) tiled `scanlineCount` times down V.
        // Same curve as the screen + a small +Z offset so it sits just in front.
        if (this.scanlines > 0) {
            this._scanTex = this._buildScanTexture();
            this._scanEntity = new pc.Entity("SplatMonitorScan");
            this.entity.addChild(this._scanEntity);
            this._scanEntity.setLocalPosition(0, 0, 0.003);
            this._scanMat = this._scanMaterial(this._scanTex);
            const count = Math.max(1, Math.round(this.scanlineCount));
            this._setRenderMesh(this._scanEntity, buildScreenQuad(device, w, h, 0, count, curve, colsX), this._scanMat, layerIds);
        }

        // LED pixel-raster overlay — the panel's physical grid (UV 0..1), a hair in
        // front so it composites over the feed + scanlines. WebGL only.
        if (this.pixelRaster) {
            const rm = this._rasterMaterial();
            if (rm) {
                this._rasterMat = rm;
                this._rasterEntity = new pc.Entity("SplatMonitorRaster");
                this.entity.addChild(this._rasterEntity);
                this._rasterEntity.setLocalPosition(0, 0, 0.004);
                this._setRenderMesh(this._rasterEntity, buildScreenQuad(device, w, h, 0, 1, curve, colsX), this._rasterMat, layerIds);
            }
        }
    }

    _destroyScreenMeshes() {
        if (this._screenEntity) { this._screenEntity.destroy(); this._screenEntity = null; }
        if (this._frameEntity) { this._frameEntity.destroy(); this._frameEntity = null; }
        if (this._backEntity) { this._backEntity.destroy(); this._backEntity = null; }
        if (this._scanEntity) { this._scanEntity.destroy(); this._scanEntity = null; }
        if (this._scanTex) { try { this._scanTex.destroy(); } catch (e) { /* ignore */ } this._scanTex = null; }
        if (this._rasterEntity) { this._rasterEntity.destroy(); this._rasterEntity = null; }
        if (this._rasterMat) { try { this._rasterMat.destroy(); } catch (e) { /* ignore */ } this._rasterMat = null; }
        this._screenMat = null;
        this._scanMat = null;
    }

    _rebuildScreenMeshes() {
        this._destroyScreenMeshes();
        this._buildScreenMeshes();
    }

    // Optional static box collider matching the screen (flat; a curved screen gets a flat
    // approximation for now). Sized width x height with a thin depth, centred on the screen.
    _buildCollision() {
        this._destroyCollision();
        if (!this.collision) return;
        try {
            const thin = Math.max(0.02, this.collisionDepth);
            this._collisionEntity = new pc.Entity("SplatMonitorCollision");
            this.entity.addChild(this._collisionEntity);
            this._collisionEntity.addComponent("collision", {
                type: "box",
                halfExtents: new pc.Vec3(Math.max(0.05, this.width / 2), Math.max(0.05, this.height / 2), thin / 2),
            });
            this._collisionEntity.addComponent("rigidbody", { type: "static" });
        } catch (e) {
            this._destroyCollision();   // physics (Ammo) unavailable
        }
    }

    _destroyCollision() {
        if (this._collisionEntity) { this._collisionEntity.destroy(); this._collisionEntity = null; }
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

    _screenMaterial() {
        const m = new pc.StandardMaterial();
        m.useLighting = false;
        m.diffuse = new pc.Color(0, 0, 0);
        m.emissiveMap = this._texture;
        m.cull = this.backsideBlack ? pc.CULLFACE_BACK : pc.CULLFACE_NONE;
        this._grade(m);
        m.update();
        return m;
    }

    // Emissive colour = tint, intensity = brightness.
    _grade(m) {
        m.emissive = new pc.Color(this.screenTint.r, this.screenTint.g, this.screenTint.b);
        m.emissiveIntensity = this.screenGain;
    }

    _applyGrade() {
        if (!this._screenMat) return;
        this._grade(this._screenMat);
        this._screenMat.update();
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

    _backMaterial() {
        const m = new pc.StandardMaterial();
        m.useLighting = false;
        m.diffuse = new pc.Color(0, 0, 0);
        m.emissive = new pc.Color(0, 0, 0);
        m.cull = pc.CULLFACE_FRONT;   // show only the back faces
        m.update();
        return m;
    }

    // 1x2 texture: row0 = opaque black (a line), row1 = transparent (a gap). Tiled
    // vertically by the overlay quad's V range; REPEAT wrapping makes the pattern.
    _buildScanTexture() {
        const fmt = pc.PIXELFORMAT_RGBA8 ?? pc.PIXELFORMAT_R8_G8_B8_A8;
        const tex = new pc.Texture(this._device, {
            name: "SplatMonitorScan",
            width: 1, height: 2,
            format: fmt,
            mipmaps: false,
            minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_REPEAT,
        });
        const px = tex.lock();
        px[0] = 0; px[1] = 0; px[2] = 0; px[3] = 255;   // line
        px[4] = 0; px[5] = 0; px[6] = 0; px[7] = 0;     // gap
        tex.unlock();
        return tex;
    }

    _scanMaterial(tex) {
        const m = new pc.StandardMaterial();
        m.useLighting = false;
        m.diffuse = new pc.Color(0, 0, 0);
        m.emissive = new pc.Color(0, 0, 0);
        m.opacityMap = tex;           // alpha = line/gap
        m.blendType = pc.BLEND_NORMAL;
        m.opacity = this.scanlines;   // overall darkening on the lines
        m.depthWrite = false;
        m.cull = this.backsideBlack ? pc.CULLFACE_BACK : pc.CULLFACE_NONE;
        m.update();
        return m;
    }

    // Custom ShaderMaterial for the LED grid (WebGL only — no WGSL twin, so WebGPU
    // skips the raster). Returns null on failure so the overlay is simply absent.
    _rasterMaterial() {
        if (this._device.isWebGPU) return null;
        let m;
        try {
            m = new pc.ShaderMaterial({
                uniqueName: "SplatMonitorRaster",
                attributes: { aPosition: pc.SEMANTIC_POSITION, aUv0: pc.SEMANTIC_TEXCOORD0 },
                vertexGLSL: RASTER_VS_GLSL,
                fragmentGLSL: RASTER_FS_GLSL,
            });
        } catch (e) { return null; }
        m.blendType = pc.BLEND_NORMAL;      // black over the feed where the gaps are
        m.depthTest = true;
        m.depthWrite = false;
        m.cull = this.backsideBlack ? pc.CULLFACE_BACK : pc.CULLFACE_NONE;
        this._applyRasterUniforms(m);
        m.update();
        return m;
    }

    // Grid (cols, rows for square LEDs), gap and fade distance. uCamPos is fed live.
    _applyRasterUniforms(m) {
        const cols = Math.max(1, Math.round(this.rasterColumns));
        const rows = Math.max(1, Math.round(cols * this.height / Math.max(0.01, this.width)));
        this._uGrid[0] = cols; this._uGrid[1] = rows;
        m.setParameter("uGrid", this._uGrid);
        m.setParameter("uGap", Math.max(0, Math.min(0.95, this.rasterGap)));
        m.setParameter("uFade", Math.max(0.01, this.rasterFadeDist));
    }

    // Per-frame: the LED overlay renders on the MAIN camera every frame (independent of
    // the feed render gate), so keep its camera position current for the distance fade.
    _updateRaster() {
        if (!this._rasterMat) return;
        const main = this._mainCamera();
        if (!main) return;
        const cp = main.getPosition();
        this._uCamPos[0] = cp.x; this._uCamPos[1] = cp.y; this._uCamPos[2] = cp.z;
        this._rasterMat.setParameter("uCamPos", this._uCamPos);
    }

    // ── target acquisition (aim + isolate + reveal) ──────────────────────────

    // Resolve an entity-picker id (GateServer name or GUID) to a scene entity.
    _resolveEntityId(id) {
        id = typeof id === "string" ? id.trim() : "";
        if (!id) return null;
        let gs = this._gateServer;
        if (!gs) {
            gs = this.app.root.findByName("GateServer")?.script?.gateServer || null;
            if (gs) this._gateServer = gs;
        }
        let e = gs?.getEntity?.(id) ?? null;
        if (!e) { try { e = this.app.root.findByGuid?.(id) ?? null; } catch (_) { /* ignore */ } }
        return e;
    }

    _resolveTarget() { return this._resolveEntityId(this.targetSplat); }

    _resolveCameraEntity() { return this._resolveEntityId(this.cameraEntity); }

    _acquire() {
        if (!this._ready) return;
        const target = this._resolveTarget();
        if (!target) return;
        if (this.enableTargetSplat && this.isolateTarget) this._enableTarget(target);
        if (this.isolateTarget) {
            const comps = target.findComponents("gsplat") || [];
            for (const c of comps) this._isolateSplat(c);
        }
    }

    // Move a splat onto the private layer so ONLY the monitor camera renders it.
    // Keep it UNIFIED: the per-(camera,layer) gsplat director renders a unified splat
    // on a custom layer at full LOD, sorted for the feed camera. (Forcing non-unified
    // — which the stencil portal needs for a per-instance material — collapses an
    // LOD-streaming splat to a low-res subset and looks blurry; RTT isolates by
    // LAYER, not material, so unified is fine.) Idempotent: only re-assigns the layer
    // when it has drifted, so the 0.5s re-acquire doesn't thrash the director (a
    // rebuild resets LOD to low each time). Original layer set is recorded for restore.
    _isolateSplat(c) {
        if (!this._privateLayer) return;
        const rec = this._subjects.get(c) || {};

        // Reveal a disabled gsplat component (hidden-splat case).
        if (this.enableTargetSplat && rec.origEnabled === undefined && !c.enabled) {
            rec.origEnabled = false;
            c.enabled = true;
        }

        try {
            if (rec.origLayers === undefined) rec.origLayers = c.layers ? c.layers.slice() : null;
            const onPrivate = c.layers && c.layers.length === 1 && c.layers[0] === this._privateLayer.id;
            if (!onPrivate) c.layers = [this._privateLayer.id];
        } catch (e) { /* component may be mid-stream */ }

        this._subjects.set(c, rec);
    }

    _enableTarget(target) {
        if (this._targetEntity !== target) {
            this._restoreTargetVisibility();
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
            if (ume.data.hidden) {
                ume.data.hidden = false;
                Promise.resolve(ume.updateVisibility?.()).catch(() => {});
            }
        } else if (!target.enabled) {
            target.enabled = true;
        }
    }

    _restoreTargetVisibility() {
        const ume = this._targetUme, target = this._targetEntity;
        try {
            if (ume && ume.data) {
                ume.data.hidden = this._targetHiddenOrig;
                Promise.resolve(ume.updateVisibility?.()).catch(() => {});
            } else if (target) {
                target.enabled = this._targetEntityEnabled;
            }
        } catch (e) { /* already gone */ }
        this._targetEntity = null;
        this._targetUme = null;
        this._targetHiddenOrig = false;
        this._targetEntityEnabled = true;
    }

    _restoreSubjects() {
        for (const [c, rec] of this._subjects) {
            try {
                // Move the splat back to its original layer (returns it to the world).
                if (rec.origLayers !== undefined && rec.origLayers !== null) c.layers = rec.origLayers;
                if (rec.origEnabled !== undefined && c) c.enabled = rec.origEnabled;
            } catch (e) { /* component may be gone */ }
        }
        this._restoreTargetVisibility();
        this._subjects.clear();
        try { this.app.fire("reApplySplatMaterial"); } catch (e) { /* ignore */ }
    }
}
