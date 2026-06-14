/**
 * Google Photorealistic 3D Tiles
 *
 * Includes a ground-to-space atmosphere: an analytic
 * single-scattering sky shell + aerial-perspective haze on the tiles + a real
 * solar position (lat/lon + day-of-year + UTC hour). The maths run in the tile
 * frame (planet-centred, real metres) so it is scale-invariant: a ground-to-
 * space sky at full scale, a glowing halo around a tabletop globe when scaled
 * down. First cut is LUT-free (ray-marched in-shader), not the precomputed
 * Bruneton model — same look, far less machinery.
 *
 * Streams Google's Photorealistic 3D Tiles (the Google Earth dataset) and
 * renders the entire globe as PlayCanvas meshes. Enter a longitude/latitude
 * and the world re-centers so that location sits at this entity's origin,
 * ground-aligned (East -> +X, Up -> +Y, North -> -Z) — the city streams in
 * and builds up around the player.
 *
 * How it works:
 *   1. Fetches https://tile.googleapis.com/v1/3dtiles/root.json?key=...
 *   2. Caches Google's session token and lazily traverses the nested
 *      tileset JSONs that make up the planet-wide tile tree
 *   3. Distance-based LOD: tiles expand into their children while the
 *      camera is within a multiple of their bounding-box size and collapse
 *      again when it leaves (traversal adapted from playcanvas/earthatile, MIT)
 *   4. Tile GLBs load via ArrivalSpace.loadGLB under a rotated/offset anchor,
 *      so re-centering on a new coordinate never re-downloads tiles
 *
 * Requires a Google Maps Platform API key with the "Map Tiles API" enabled
 * (billing required): https://developers.google.com/maps/documentation/tile/3d-tiles
 *
 * EEA accounts: Google blocks photorealistic tiles for API keys on an
 * EEA-billing project. Leave the API key blank and supply a Cesium Ion token
 * instead — Ion's Google Photorealistic 3D Tiles asset hands back Cesium's
 * (non-EEA) Google key, so the tiles stream the same way, no regional block.
 *
 * Tips:
 *   - "Ground Altitude" is the WGS84 ellipsoid height placed at the entity
 *     origin: terrain elevation + geoid undulation, NOT the map altitude
 *     (Stephansplatz Vienna ~ 216 m = 171 m terrain + 45 m geoid; London
 *     ~ 70 m, NYC ~ 30 m). Tweak until the street lines up with your floor.
 *   - Lower "Scale" (e.g. 0.000002) turns the dataset into a tabletop globe.
 *   - Raise "Detail" for sharper buildings at the cost of more tile loads.
 *   - "Altitude Adaptive Cam" (on by default) makes clip planes and fly
 *     speed follow the camera's height above ground:
 *       near = max(Near Clip, altitude/200) up to 50 km
 *       far  = max(Far Clip, 1.5x physical horizon distance) up to 20,000 km
 *       free cam speed = altitude/2 (Google Earth style — descend to land,
 *       climb to cross continents), scroll-wheel acts as a multiplier on
 *       top, "Free Cam Max Speed" is the hard ceiling (client >= 1.11.2).
 *     Street level gives the baselines; from orbit near exceeds 1,000 m and
 *     far reaches the millions, keeping the depth ratio healthy everywhere.
 *     Toggle OFF and the camera simply uses Near/Far Clip as fixed values
 *     with scroll-only speed control.
 */

const TILE_API = "https://tile.googleapis.com/";

const CESIUM_ION_API = "https://api.cesium.com/v1/";
// Cesium Ion's "Google Photorealistic 3D Tiles" asset. Its endpoint returns a
// tile.googleapis.com root URL bearing Cesium's own (non-EEA) Google key — the
// way to stream the tiles from an EEA-billing account, which Google blocks.
const CESIUM_GOOGLE_ASSET_ID = 2275207;

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

// ── Atmosphere (analytic single-scattering) ──
// A first-cut, LUT-free port of the look the takram/Bruneton demos achieve:
// Rayleigh + Mie single scattering, ray-marched in the shader. All maths run in
// the TILE FRAME (planet centre at the origin, real metres) so the model is
// scale-invariant — the same code gives a ground-to-space sky at tileScale = 1
// and a glowing halo around a tabletop globe at tileScale ~ 1e-6. The shared
// gtAtmosphere() function is injected into both the per-tile chunk (aerial
// perspective) and the sky-shell material (the sky itself). GLSL + WGSL.
const ATMO_THICKNESS = 60000; // atmosphere top above ground radius (m)

const ATMO_DECL_GLSL = /* glsl */ `
uniform mat4  uWorldToTile;   // world -> tile frame (real m, planet centre origin)
uniform vec3  uCamTile;       // camera in the tile frame
uniform vec3  uSunDirTile;    // sun direction in the tile frame (normalized)
uniform float uPlanetRadius;  // ground geocentric radius (m)
uniform float uAtmoRadius;    // atmosphere top radius (m)
uniform float uSunIntensity;
uniform float uAtmoEnable;    // 0 = off, 1 = carve in aerial perspective
uniform float uSkyExposure;   // tonemap exposure for the haze (matches the sky)
`;

const ATMO_FUNC_GLSL = /* glsl */ `
#ifndef GT_ATMO_FUNC
#define GT_ATMO_FUNC
// inscattered radiance for ray (P, dir) integrated over [0, maxLen];
// view transmittance returned in 'trans'. P/dir in tile frame, real metres.
vec3 gtAtmosphere(vec3 P, vec3 dir, float maxLen, vec3 sunDir,
                  float planetR, float atmoR, float sunI, out vec3 trans) {
    const int MAX_SAMPLES = 32;
    const int LIGHT_SAMPLES = 8;
    const float STEP0 = 200.0;      // first view step (m), small near the camera
    const float GROWTH = 1.4;       // geometric growth of the step outward
    const float Hr = 8000.0;        // Rayleigh scale height
    const float Hm = 1200.0;        // Mie scale height
    const vec3  betaR = vec3(5.8e-6, 13.5e-6, 33.1e-6);
    const float betaM = 21e-6;
    const float g = 0.76;           // Mie anisotropy
    const float PI = 3.14159265359;

    trans = vec3(1.0);
    float b = dot(P, dir);
    float c = dot(P, P) - atmoR * atmoR;
    float disc = b * b - c;
    if (disc < 0.0) return vec3(0.0);                 // ray misses the atmosphere
    float sq = sqrt(disc);
    float tNear = max(-b - sq, 0.0);
    float tFar = min(-b + sq, maxLen);
    if (tFar <= tNear) return vec3(0.0);

    float odR = 0.0, odM = 0.0;
    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    // March by distance, not a fixed count: small steps near the camera growing
    // geometrically. Short (ground) and long (sky) rays then resolve the dense
    // low atmosphere at the SAME near-camera step size, so the long ray isn't
    // under-integrated (the cause of the sky reading darker than the ground).
    float t = tNear;
    float seg = STEP0;

    for (int i = 0; i < MAX_SAMPLES; i++) {
        if (t >= tFar) break;
        float ds = min(seg, tFar - t);
        vec3 X = P + dir * (t + ds * 0.5);
        // Clamp ≥ 0 (ellipsoid/terrain dips below the sphere → exp blow-up).
        float h = max(length(X) - planetR, 0.0);
        float hr = exp(-h / Hr) * ds;
        float hm = exp(-h / Hm) * ds;
        odR += hr; odM += hm;

        // optical depth from this sample toward the sun
        float lb = dot(X, sunDir);
        float ld = lb * lb - (dot(X, X) - atmoR * atmoR);
        float lFar = -lb + sqrt(max(ld, 0.0));
        float lseg = lFar / float(LIGHT_SAMPLES);
        float odLR = 0.0, odLM = 0.0, tl = lseg * 0.5;
        bool lit = true;
        for (int j = 0; j < LIGHT_SAMPLES; j++) {
            vec3 Y = X + sunDir * tl;
            float hl = length(Y) - planetR;
            if (hl < 0.0) { lit = false; break; } // sample is in the planet's shadow
            odLR += exp(-hl / Hr) * lseg;
            odLM += exp(-hl / Hm) * lseg;
            tl += lseg;
        }
        if (lit) {
            vec3 tau = betaR * (odR + odLR) + betaM * 1.1 * (odM + odLM);
            vec3 att = exp(-tau);
            sumR += att * hr;
            sumM += att * hm;
        }
        t += ds;
        seg *= GROWTH;
    }

    float mu = dot(dir, sunDir);
    float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float gg = g * g;
    float denom = pow(max(1.0 + gg - 2.0 * g * mu, 1e-4), 1.5);
    float phM = 3.0 / (8.0 * PI) * ((1.0 - gg) * (1.0 + mu * mu)) / ((2.0 + gg) * denom);

    trans = exp(-(betaR * odR + betaM * 1.1 * odM));
    return (sumR * betaR * phR + sumM * betaM * phM) * sunI;
}
#endif
`;

const ATMO_DECL_WGSL = /* wgsl */ `
uniform uWorldToTile: mat4x4f;
uniform uCamTile: vec3f;
uniform uSunDirTile: vec3f;
uniform uPlanetRadius: f32;
uniform uAtmoRadius: f32;
uniform uSunIntensity: f32;
uniform uAtmoEnable: f32;
uniform uSkyExposure: f32;
`;

const ATMO_FUNC_WGSL = /* wgsl */ `
struct GtAtmo { inscatter: vec3f, trans: vec3f };
fn gtAtmosphere(P: vec3f, dir: vec3f, maxLen: f32, sunDir: vec3f,
                planetR: f32, atmoR: f32, sunI: f32) -> GtAtmo {
    var res: GtAtmo;
    res.inscatter = vec3f(0.0);
    res.trans = vec3f(1.0);

    let Hr = 8000.0;
    let Hm = 1200.0;
    let betaR = vec3f(5.8e-6, 13.5e-6, 33.1e-6);
    let betaM = 21e-6;
    let g = 0.76;
    let PI = 3.14159265359;

    let b = dot(P, dir);
    let c = dot(P, P) - atmoR * atmoR;
    let disc = b * b - c;
    if (disc < 0.0) { return res; }
    let sq = sqrt(disc);
    let tNear = max(-b - sq, 0.0);
    let tFar = min(-b + sq, maxLen);
    if (tFar <= tNear) { return res; }

    // March by distance, not a fixed count (see GLSL note): geometric steps from
    // the camera so short and long rays sample the dense low air identically.
    var t = tNear;
    var seg = 200.0;
    var odR = 0.0;
    var odM = 0.0;
    var sumR = vec3f(0.0);
    var sumM = vec3f(0.0);

    for (var i = 0; i < 32; i = i + 1) {
        if (t >= tFar) { break; }
        let ds = min(seg, tFar - t);
        let X = P + dir * (t + ds * 0.5);
        let h = max(length(X) - planetR, 0.0);
        let hr = exp(-h / Hr) * ds;
        let hm = exp(-h / Hm) * ds;
        odR = odR + hr;
        odM = odM + hm;

        let lb = dot(X, sunDir);
        let ld = lb * lb - (dot(X, X) - atmoR * atmoR);
        let lFar = -lb + sqrt(max(ld, 0.0));
        let lseg = lFar / 8.0;
        var odLR = 0.0;
        var odLM = 0.0;
        var tl = lseg * 0.5;
        var lit = true;
        for (var j = 0; j < 8; j = j + 1) {
            let Y = X + sunDir * tl;
            let hl = length(Y) - planetR;
            if (hl < 0.0) { lit = false; break; }
            odLR = odLR + exp(-hl / Hr) * lseg;
            odLM = odLM + exp(-hl / Hm) * lseg;
            tl = tl + lseg;
        }
        if (lit) {
            let tau = betaR * (odR + odLR) + vec3f(betaM * 1.1 * (odM + odLM));
            let att = exp(-tau);
            sumR = sumR + att * hr;
            sumM = sumM + att * hm;
        }
        t = t + ds;
        seg = seg * 1.4;
    }

    let mu = dot(dir, sunDir);
    let phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    let gg = g * g;
    let denom = pow(max(1.0 + gg - 2.0 * g * mu, 1e-4), 1.5);
    let phM = 3.0 / (8.0 * PI) * ((1.0 - gg) * (1.0 + mu * mu)) / ((2.0 + gg) * denom);

    res.trans = exp(-(betaR * odR + vec3f(betaM * 1.1 * odM)));
    res.inscatter = (sumR * betaR * phR + sumM * betaM * phM) * sunI;
    return res;
}
`;

// ── Tile shader chunks (Splat Crop carve + saturation) ──
// Two features share the global litUserDeclarationPS / litUserMainEndPS hooks:
//   1. Patch-region carve: a "Splat Crop" vibe with Cull Google Tiles on
//      publishes its box via the googletiles:patch-region app event; we discard
//      tile fragments inside that box so a cropped splat can replace the tiles
//      in the same region. The discard runs in litUserMainEndPS (inside fragment
//      main) where vPositionW (world pos) is in scope. Single region for v1.
//   2. Saturation: a per-pixel saturation tweak of the composed output, part of
//      the Direct Light material tuning. uSaturation = 1 is a no-op, so it does
//      nothing until the user dials it.
// Because chunks.set() replaces, both live in one combined string per hook. The
// saturation op runs on the final colour (gl_FragColor / output.color, already
// tonemapped + gamma corrected). GLSL + WGSL so it works on WebGL2 and WebGPU.
const CHUNK_DECL_NAME = "litUserDeclarationPS";
const CHUNK_MAIN_NAME = "litUserMainEndPS";

const CHUNK_DECL_GLSL = /* glsl */ `
uniform mat4  uPatchInv;     // world -> box-local
uniform vec3  uPatchHalf;    // box half-extents (m)
uniform float uPatchEnable;  // 0 = off, 1 = carve
uniform float uSaturation;   // 1 = unchanged
${ATMO_DECL_GLSL}
${ATMO_FUNC_GLSL}
`;
const CHUNK_MAIN_GLSL = /* glsl */ `
if (uPatchEnable > 0.5) {
    vec3 lp = (uPatchInv * vec4(vPositionW, 1.0)).xyz;
    if (all(lessThanEqual(abs(lp), uPatchHalf))) discard;
}
// Saturation writes the composed colour, so it must run in the forward pass
// only — gl_FragColor holds depth/pick IDs in the shadow/pick/prepass.
#ifdef FORWARD_PASS
if (abs(uSaturation - 1.0) > 0.001) {
    float luma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor.rgb = mix(vec3(luma), gl_FragColor.rgb, uSaturation);
}
// Aerial perspective: extinguish the tile by transmittance and add the
// inscattered light along the camera->fragment segment (real metres).
if (uAtmoEnable > 0.5) {
    vec3 ap = (uWorldToTile * vec4(vPositionW, 1.0)).xyz;
    vec3 av = ap - uCamTile;
    float aL = length(av);
    if (aL > 1.0) {
        // Far tiles drop to coarse LOD and stop matching the sphere. Snap the
        // haze sample onto a smooth ground sphere (static height) past ~20 km,
        // fully by ~200 km, so scattering doesn't inherit the low-poly mesh.
        ap = mix(ap, normalize(ap) * uPlanetRadius, smoothstep(20000.0, 200000.0, aL));
        av = ap - uCamTile;
        aL = length(av);
        vec3 aTr;
        vec3 aIn = gtAtmosphere(uCamTile, av / aL, aL, uSunDirTile,
                                uPlanetRadius, uAtmoRadius, uSunIntensity, aTr);
        // tonemap the inscatter to display space (same curve as the sky) so far
        // tiles fade toward the bright horizon colour instead of going dark
        gl_FragColor.rgb = gl_FragColor.rgb * aTr + (vec3(1.0) - exp(-aIn * uSkyExposure));
    }
}
#endif
`;

const CHUNK_DECL_WGSL = /* wgsl */ `
uniform uPatchInv: mat4x4f;
uniform uPatchHalf: vec3f;
uniform uPatchEnable: f32;
uniform uSaturation: f32;
${ATMO_DECL_WGSL}
${ATMO_FUNC_WGSL}
`;
const CHUNK_MAIN_WGSL = /* wgsl */ `
if (uniform.uPatchEnable > 0.5) {
    let lp = (uniform.uPatchInv * vec4f(vPositionW, 1.0)).xyz;
    if (all(abs(lp) <= uniform.uPatchHalf)) { discard; }
}
// Forward pass only — output.color is the composed colour here; the shadow/
// pick/prepass don't define it and write depth/pick IDs instead.
#ifdef FORWARD_PASS
if (abs(uniform.uSaturation - 1.0) > 0.001) {
    let luma = dot(output.color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    output.color = vec4f(mix(vec3f(luma), output.color.rgb, uniform.uSaturation), output.color.a);
}
// Aerial perspective (forward pass): extinction + inscatter on the tile.
if (uniform.uAtmoEnable > 0.5) {
    let ap0 = (uniform.uWorldToTile * vec4f(vPositionW, 1.0)).xyz;
    let aL0 = length(ap0 - uniform.uCamTile);
    if (aL0 > 1.0) {
        // Snap far/coarse tiles onto a smooth ground sphere (see GLSL note).
        let ap = mix(ap0, normalize(ap0) * uniform.uPlanetRadius, smoothstep(20000.0, 200000.0, aL0));
        let av = ap - uniform.uCamTile;
        let aL = length(av);
        let r = gtAtmosphere(uniform.uCamTile, av / aL, aL, uniform.uSunDirTile,
                             uniform.uPlanetRadius, uniform.uAtmoRadius, uniform.uSunIntensity);
        let haze = vec3f(1.0) - exp(-r.inscatter * uniform.uSkyExposure);
        output.color = vec4f(output.color.rgb * r.trans + haze, output.color.a);
    }
}
#endif
`;

// ── Sky shell material (the atmosphere itself) ──
// A double-sided sphere at the atmosphere-top radius, child of the tile root, so
// it sits planet-centred and scales with the globe. Each fragment ray-marches
// gtAtmosphere to the atmosphere edge: from inside (tileScale = 1) it reads as
// the sky; from outside (tabletop) it reads as a glowing rim around the ball.
// Alpha = tonemapped luminance, so empty space / the room shows through.
const SKY_VERT_GLSL = /* glsl */ `
attribute vec3 aPosition;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec3 vWorld;
void main() {
    vec4 wp = matrix_model * vec4(aPosition, 1.0);
    vWorld = wp.xyz;
    // Pin to the far plane (z = w): the shell is hundreds of km out at the
    // horizon and would otherwise be cut by the camera's far clip, leaving a
    // black band. The LESSEQUAL depth test still keeps it behind real geometry.
    vec4 cp = matrix_viewProjection * wp;
    gl_Position = vec4(cp.xy, cp.w, cp.w);
}
`;
const SKY_FRAG_GLSL = /* glsl */ `
precision highp float;
${ATMO_FUNC_GLSL}
uniform mat4 uWorldToTile;
uniform vec3 uCamTile;
uniform vec3 uSunDirTile;
uniform float uPlanetRadius;
uniform float uAtmoRadius;
uniform float uSunIntensity;
uniform float uSkyExposure;
varying vec3 vWorld;
void main() {
    vec3 p = (uWorldToTile * vec4(vWorld, 1.0)).xyz;
    vec3 dir = normalize(p - uCamTile);
    vec3 tr;
    vec3 ins = gtAtmosphere(uCamTile, dir, 1.0e20, uSunDirTile,
                            uPlanetRadius, uAtmoRadius, uSunIntensity, tr);
    vec3 col = vec3(1.0) - exp(-ins * uSkyExposure);
    // Premultiplied: emit the inscatter and let the background through by the
    // transmittance — identical compositing to the tile haze, so sky and ground
    // match at the horizon instead of the sky self-darkening to col².
    float a = 1.0 - dot(tr, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(col, a);
}
`;

// NOTE: the WGSL sky entry-point convention (VertexInput/FragmentOutput struct
// names) is unverified against this engine build — the WebGL/GLSL path is the
// one exercised by the plugin live-test workflow; WGSL sky may need a live fix.
const SKY_VERT_WGSL = /* wgsl */ `
attribute aPosition: vec3f;
uniform matrix_model: mat4x4f;
uniform matrix_viewProjection: mat4x4f;
varying vWorld: vec3f;
@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let wp = uniform.matrix_model * vec4f(input.aPosition, 1.0);
    output.vWorld = wp.xyz;
    // Pin to the far plane (z = w) so the shell never far-clips at the horizon.
    let cp = uniform.matrix_viewProjection * wp;
    output.position = vec4f(cp.xy, cp.w, cp.w);
    return output;
}
`;
const SKY_FRAG_WGSL = /* wgsl */ `
${ATMO_FUNC_WGSL}
uniform uWorldToTile: mat4x4f;
uniform uCamTile: vec3f;
uniform uSunDirTile: vec3f;
uniform uPlanetRadius: f32;
uniform uAtmoRadius: f32;
uniform uSunIntensity: f32;
uniform uSkyExposure: f32;
varying vWorld: vec3f;
@fragment
fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let p = (uniform.uWorldToTile * vec4f(input.vWorld, 1.0)).xyz;
    let dir = normalize(p - uniform.uCamTile);
    let r = gtAtmosphere(uniform.uCamTile, dir, 1.0e20, uniform.uSunDirTile,
                         uniform.uPlanetRadius, uniform.uAtmoRadius, uniform.uSunIntensity);
    let col = vec3f(1.0) - exp(-r.inscatter * uniform.uSkyExposure);
    let a = 1.0 - dot(r.trans, vec3f(0.2126, 0.7152, 0.0722));
    output.color = vec4f(col, a);
    return output;
}
`;

/**
 * Minimal Google 3D Tiles tree — traversal adapted from playcanvas/earthatile
 * (MIT). Nodes expand while the camera is within `lodFactor` times their
 * bounding-box size and collapse when it leaves; `.json` content references
 * are fetched lazily and spliced into the tree as children.
 */
class TileTree {
    session = null;

    lodFactor = 4;

    expanded = new Set();

    contentHidden = new Map();

    constructor(apiKey, handlers) {
        this.apiKey = apiKey;
        this.handlers = handlers;
    }

    async fetchJson(url) {
        const res = await fetch(url);
        if (!res.ok) {
            // Keep Google's error body — the status alone can't tell an EEA
            // region block apart from a bad key or disabled API (both 403).
            let detail = "";
            try { detail = (await res.json())?.error?.message || ""; } catch (_) { /* non-JSON body */ }
            const err = new Error(detail || `HTTP ${res.status}`);
            err.status = res.status;
            err.detail = detail;
            throw err;
        }
        return res.json();
    }

    /**
     * Google returns content URIs in two formats:
     *   1. With a session:  v1/.../file.glb?session=xxx  -> append &key=yyy
     *   2. Without one:     v1/.../file.glb              -> append ?key=yyy&session=zzz
     * The session token from format 1 is cached and reused for format 2.
     */
    buildTileUrl(uri) {
        uri = uri.replace(/^\//, "");
        if (uri.includes("?")) {
            const url = `${TILE_API}${uri}&key=${this.apiKey}`;
            if (!this.session) {
                this.session = new URL(url).searchParams.get("session");
            }
            return url;
        }
        let url = `${TILE_API}${uri}?key=${this.apiKey}`;
        if (this.session) url += `&session=${this.session}`;
        return url;
    }

    async start() {
        const json = await this.fetchJson(`${TILE_API}v1/3dtiles/root.json?key=${this.apiKey}`);
        this.root = json.root;
        await this.expandNode(this.root);
    }

    /**
     * Camera is in the Y-up flip of ECEF: (x, z, -y). Boxes are Z-up ECEF.
     *
     * Range is measured from the camera to the box's bounding sphere, not
     * its center — center distance misjudges planet-scale tiles, where the
     * camera is always ~one earth radius from the center, leaving them
     * flickering at the expand/collapse boundary (a collapse there drops a
     * whole-earth-face mesh on top of the streamed city).
     */
    inRange(node, cam, slack = 1) {
        const box = node.boundingVolume?.box;
        if (!box) return true;
        const [bx, by, bz, xx, xy, xz, yx, yy, yz, zx, zy, zz] = box;
        const dist = len3(bx - cam[0], bz - cam[1], -by - cam[2]);
        const lx = len3(xx, xy, xz), ly = len3(yx, yy, yz), lz = len3(zx, zy, zz);
        const size = Math.max(lx, ly, lz, 100);
        const radius = Math.sqrt(lx * lx + ly * ly + lz * lz);
        const surface = Math.max(0, dist - radius);
        return surface < size * Math.max(this.lodFactor - 1, 1) * slack;
    }

    async loadContent(node) {
        const uri = node.content?.uri;
        if (!uri) return;
        if (uri.includes(".glb")) {
            await this.handlers.load(node);
            if (this.contentHidden.get(uri)) this.handlers.hide(node);
        } else if (uri.includes(".json")) {
            if (!node.children) {
                const json = await this.fetchJson(this.buildTileUrl(uri));
                // The spliced root carries THIS node's LOD-level geometry
                // (unlike real children, which are one level below)
                json.root._isSpliceRoot = true;
                node.children = [json.root];
            }
            // Load the sub-tileset root's geometry too — without it, this
            // subtree is a hole along the LOD transition border ("only some
            // children of the parent are drawn") until it expands further.
            await this.loadContent(node.children[0]);
        }
    }

    /** Recursively unload a child subtree's level geometry (descends through .json refs). */
    unloadContent(node) {
        const uri = node.content?.uri;
        if (!uri) return;
        if (uri.includes(".glb")) {
            this.handlers.unload(node);
        } else if (uri.includes(".json") && node.children) {
            this.unloadContent(node.children[0]);
        }
    }

    /**
     * Expanding a node loads all of its children's content, then hides the
     * node's own content. If any child fails (network hiccup, quota), the
     * node is collapsed again so a later update() retries it.
     */
    async expandNode(node) {
        if (this.expanded.has(node)) return;
        this.expanded.add(node);

        if (node.children) {
            const results = await Promise.allSettled(node.children.map(c => this.loadContent(c)));
            // Collapsed while the children were loading (player moved on) —
            // they were unloaded, so don't hide this node over a hole.
            if (!this.expanded.has(node)) return;
            const failed = results.find(r => r.status === "rejected");
            if (failed) {
                console.warn("GoogleTiles: expand failed, will retry:", failed.reason?.message);
                this.collapseNode(node);
                return;
            }
        }

        if (node.content?.uri.includes(".glb")) {
            this.handlers.hide(node);
            this.contentHidden.set(node.content.uri, true);
        }
    }

    /**
     * Collapsing unloads the children's GLB content and re-shows the node's
     * own (already loaded) content. Fetched sub-tileset JSON is kept as a
     * cache — descendants that were expanded collapse themselves later.
     */
    collapseNode(node) {
        if (node.children) {
            for (const child of node.children) {
                // A splice root is this node's own LOD level, not the level
                // below — it must survive the collapse
                if (child._isSpliceRoot) continue;
                this.unloadContent(child);
            }
        }
        if (node.content?.uri.includes(".glb")) {
            this.handlers.show(node);
            this.contentHidden.set(node.content.uri, false);
        }
        this.expanded.delete(node);
    }

    update(cameraPos) {
        for (const node of Array.from(this.expanded)) {
            // 1.15 slack = hysteresis so nodes at the boundary don't churn
            if (!this.inRange(node, cameraPos, 1.15)) {
                this.collapseNode(node);
                continue;
            }
            if (!node.children) continue;
            for (const child of node.children) {
                if (child.children && !this.expanded.has(child) && this.inRange(child, cameraPos)) {
                    this.expandNode(child).catch(err => console.warn("GoogleTiles:", err.message));
                }
            }
        }
    }
}

export class GoogleTiles extends ArrivalScript {
    static scriptName = "Google 3D Tiles";

    apiKey = "";
    cesiumIonToken = "";
    latitude = 48.20849;
    longitude = 16.37208;
    groundAltitude = 216;
    detail = 4;
    tileScale = 1.0;
    altitudeAdaptive = true;
    cameraNearClip = 0.1;
    cameraFarClip = 30000;
    freeCamMaxSpeed = 1000;
    showStatus = true;

    // Material tuning. Direct Light is the master gate: while OFF the plugin
    // touches no tile material at all (tiles render exactly as Google's loader
    // produced them — effectively unlit baked photogrammetry — at zero per-tile
    // cost) and every knob below is inert. While ON, each tile is switched to
    // lit and the knobs apply.
    directLight = false;
    materialBrightness = 1.0;
    diffuseTint = "#ffffff";
    saturation = 1.0;
    gloss = 0.5;
    metalness = 0.0;
    ambientResponse = 1.0;
    emissiveBoost = 0.0;

    // Atmosphere (analytic single-scattering sky + aerial perspective).
    atmosphere = true;
    timeUTC = 12;        // hour of day, UTC (0..24)
    dayOfYear = 172;     // 1..366 (172 ≈ summer solstice) — drives sun declination
    sunIntensity = 22;
    skyExposure = 1.0;

    static properties = {
        apiKey: { title: "Google Maps API Key" },
        cesiumIonToken: { title: "Cesium Ion Token (EEA)" },
        latitude: { title: "Latitude", min: -90, max: 90, step: 0.00001 },
        longitude: { title: "Longitude", min: -180, max: 180, step: 0.00001 },
        groundAltitude: { title: "Ground Altitude (m)", min: -500, max: 9000, step: 1 },
        detail: { title: "Detail", min: 2, max: 6, step: 0.5 },
        tileScale: { title: "Scale", min: 0.000001, max: 1, step: 0.000001 },
        altitudeAdaptive: { title: "Altitude Adaptive Cam" },
        cameraNearClip: { title: "Near Clip (m)", min: 0.01, max: 100, step: 0.01 },
        cameraFarClip: { title: "Far Clip (m)", min: 1000, max: 20000000, step: 1000 },
        freeCamMaxSpeed: { title: "Free Cam Max Speed (m/s)", min: 50, max: 1000000, step: 50 },
        showStatus: { title: "Show Status" },
        directLight: { title: "Direct Light (scene sun)" },
        materialBrightness: { title: "Brightness", min: 0, max: 3, step: 0.05 },
        diffuseTint: { title: "Tint" },
        saturation: { title: "Saturation", min: 0, max: 2, step: 0.05 },
        gloss: { title: "Gloss (lit)", min: 0, max: 1, step: 0.01 },
        metalness: { title: "Metalness (lit)", min: 0, max: 1, step: 0.01 },
        ambientResponse: { title: "Ambient Response (lit)", min: 0, max: 2, step: 0.05 },
        emissiveBoost: { title: "Emissive Boost (lit)", min: 0, max: 2, step: 0.05 },
        atmosphere: { title: "Atmosphere" },
        timeUTC: { title: "Time UTC (h)", min: 0, max: 24, step: 0.25 },
        dayOfYear: { title: "Day of Year", min: 1, max: 366, step: 1 },
        sunIntensity: { title: "Sun Intensity", min: 0, max: 100, step: 1 },
        skyExposure: { title: "Sky Exposure", min: 0.1, max: 5, step: 0.1 },
    };

    // ── Internal state ──
    _anchor = null;
    _tileRoot = null;
    _tree = null;
    _records = new Map(); // tile node -> { entity, asset, dead }
    _sessionId = 0;
    _updateTimer = 0;
    _loadSlots = 0;
    _loadQueue = [];
    _statusEl = null;
    _lastStatus = "";
    _origNearClip = null;
    _origFarClip = null;
    _lastCameraMode = null;
    _targetRadius = 6378137; // geocentric radius of the anchor point (tile meters)
    _speedMult = 1;          // user's scroll preference relative to the auto speed
    _lastAutoSpeed = null;

    // Tile shader chunks (Splat Crop carve + saturation) and material tuning
    _patchRegions = new Map();      // id -> { inv: number[16], half: [x,y,z] }
    _chunkedMaterials = new Set();  // materials carrying the combined shader chunks
    _tunedMaterials = new Set();    // materials whose lit props we overrode (for restore)
    _patchActive = false;
    _onPatchRegion = null;
    _onPatchClear = null;
    _tintColor = new pc.Color();    // scratch for diffuseTint parsing

    // Atmosphere
    _skyEntity = null;
    _skyMaterial = null;
    _enu = null;                    // { east, up, north } basis in the tile frame
    _sunDirTile = [0, 1, 0];        // sun direction in the tile frame (normalized)
    _invTileMat = new pc.Mat4();    // scratch: world -> tile frame (real metres)

    // Concurrent GLB downloads. Movement triggers expand cascades; without a
    // cap, hundreds of parallel loads choke the main thread and the stream
    // appears to stall.
    static MAX_CONCURRENT_LOADS = 10;

    // ────────────────────────────────────────────
    // Lifecycle
    // ────────────────────────────────────────────

    initialize() {
        this._applyCameraClips();

        // this.entity -> _anchor (ENU rotation + scale) -> _tileRoot (-ECEF offset) -> tiles
        this._anchor = new pc.Entity("google-tiles-anchor");
        this.entity.addChild(this._anchor);
        this._tileRoot = new pc.Entity("google-tiles-root");
        this._anchor.addChild(this._tileRoot);
        this._applyOrigin();

        this._makeAttribution();

        if (this.atmosphere) this._buildSky();

        // Listen for Splat Crop carve regions
        this._onPatchRegion = (id, region) => {
            if (!id || !region) return;
            this._patchRegions.set(id, region);
            if (!this._patchActive) {
                this._patchActive = true;
                this._chunkAllTiles();
            }
            this._applyPatchUniforms();
        };
        this._onPatchClear = (id) => {
            this._patchRegions.delete(id);
            this._applyPatchUniforms();
        };
        this.app.on("googletiles:patch-region", this._onPatchRegion, this);
        this.app.on("googletiles:patch-region-clear", this._onPatchClear, this);

        if (!this.apiKey && !this.cesiumIonToken) {
            this._status("Enter a Google Maps API key, or a Cesium Ion token for EEA accounts");
            return;
        }
        this._start();
    }

    update(dt) {
        if (!this._tree) return;

        this._updateTimer += dt;
        if (this._updateTimer < 0.1) return;
        this._updateTimer = 0;

        const viewer = ArrivalSpace.getCamera() || ArrivalSpace.getPlayer();
        if (!viewer) return;

        // Uncap the free cam's scroll-wheel speed when free mode is entered
        // (the stock cap of 50 m/s is room-scale; useless for flying a city).
        // Requires client VERSION >= 1.11.2; older clients keep the default.
        const mode = ArrivalSpace.getCameraMode?.();
        if (mode !== this._lastCameraMode) {
            this._lastCameraMode = mode;
            this._lastAutoSpeed = null;
            if (mode === "free") {
                ArrivalSpace.setFreeCamSpeed?.(null, this.freeCamMaxSpeed);
            }
        }

        // Camera position in the tile frame (Y-up flipped ECEF, in meters —
        // the inverse world transform also folds in tileScale). Cache the
        // inverse so the atmosphere shaders can reuse it as uWorldToTile.
        this._invTileMat.copy(this._tileRoot.getWorldTransform()).invert();
        const local = this._invTileMat.transformPoint(viewer.getPosition());

        if (this.altitudeAdaptive) {
            const altitude = Math.max(
                0, (len3(local.x, local.y, local.z) - this._targetRadius) * this.tileScale
            );
            this._updateDynamicClips(viewer, altitude);
            if (mode === "free") this._updateFreeCamSpeed(altitude);
        } else if (viewer.camera &&
                   (viewer.camera.farClip !== this.cameraFarClip ||
                    viewer.camera.nearClip !== this.cameraNearClip)) {
            // static clips — re-assert if a camera mode switch reset them
            this._applyCameraClips();
        }

        this._tree.update([local.x, local.y, local.z]);

        if (this.atmosphere) this._updateAtmosphereUniforms(local);

        if (this.showStatus) {
            const queued = this._loadQueue.length;
            this._status(
                `${this._records.size} tiles · ${this._loadSlots} loading` +
                (queued ? ` · ${queued} queued` : "")
            );
        }
    }

    onPropertyChanged(name) {
        switch (name) {
            case "apiKey":
            case "cesiumIonToken":
                if (this.apiKey || this.cesiumIonToken) this._start();
                break;
            case "latitude":
            case "longitude":
            case "groundAltitude":
            case "tileScale":
                // Re-anchors the already-streamed globe — no re-download
                this._applyOrigin();
                break;
            case "detail":
                if (this._tree) this._tree.lodFactor = this.detail;
                break;
            case "cameraNearClip":
            case "cameraFarClip":
                this._applyCameraClips();
                break;
            case "altitudeAdaptive":
                if (!this.altitudeAdaptive) {
                    // back to plain static behavior: baseline clips, scroll-only speed
                    this._applyCameraClips();
                    this._speedMult = 1;
                    this._lastAutoSpeed = null;
                }
                break;
            case "freeCamMaxSpeed":
                if (ArrivalSpace.getCameraMode?.() === "free") {
                    ArrivalSpace.setFreeCamSpeed?.(null, this.freeCamMaxSpeed);
                }
                break;
            case "showStatus":
                if (this._statusEl) {
                    this._statusEl.style.display = this.showStatus ? "block" : "none";
                }
                break;
            case "directLight":
                // master gate: switch every loaded tile to/from lit
                if (this.directLight) this._tuneAllTiles();
                else this._restoreAllTiles();
                this._applySaturationUniform();
                break;
            case "materialBrightness":
            case "diffuseTint":
            case "gloss":
            case "metalness":
            case "ambientResponse":
            case "emissiveBoost":
                // unlit does nothing — only re-tune while Direct Light is on
                if (this.directLight) this._tuneAllTiles();
                break;
            case "saturation":
                // live uniform, no recompile; inert while unlit
                if (this.directLight) this._applySaturationUniform();
                break;
            case "atmosphere":
                if (this.atmosphere && !this._skyEntity) this._buildSky();
                if (this._skyEntity) this._skyEntity.enabled = this.atmosphere;
                if (this.atmosphere) this._chunkAllTiles();
                for (const mat of this._chunkedMaterials) {
                    mat.setParameter("uAtmoEnable", this.atmosphere ? 1 : 0);
                }
                break;
            case "timeUTC":
            case "dayOfYear":
                this._computeSunDir();   // sun uniforms refresh next update() tick
                break;
            case "sunIntensity":
            case "skyExposure":
                // live uniforms, picked up by the next _updateAtmosphereUniforms
                break;
        }
    }

    destroy() {
        this._sessionId++;
        if (this._onPatchRegion) this.app.off("googletiles:patch-region", this._onPatchRegion, this);
        if (this._onPatchClear) this.app.off("googletiles:patch-region-clear", this._onPatchClear, this);
        this._tree = null;
        this._clearTiles();
        if (this._skyEntity) { this._skyEntity.destroy(); this._skyEntity = null; }
        this._skyMaterial = null;
        const cam = ArrivalSpace.getCamera()?.camera;
        if (cam) {
            if (this._origNearClip !== null) cam.nearClip = this._origNearClip;
            if (this._origFarClip !== null) cam.farClip = this._origFarClip;
        }
        this.removeUI();
        this._statusEl = null;
    }

    // ────────────────────────────────────────────
    // Anchoring
    // ────────────────────────────────────────────

    /**
     * Position and orient the tile hierarchy so the target lat/lon sits at
     * this entity's origin with the local East/Up/North axes mapped to
     * +X/+Y/-Z. Tiles (and 3D Tiles bounding boxes) live in a Y-up flip of
     * ECEF: pc = (ecef.x, ecef.z, -ecef.y).
     */
    _applyOrigin() {
        const lat = this.latitude * Math.PI / 180;
        const lon = this.longitude * Math.PI / 180;
        const sLat = Math.sin(lat), cLat = Math.cos(lat);
        const sLon = Math.sin(lon), cLon = Math.cos(lon);

        // WGS84 geodetic -> ECEF
        const a = 6378137;
        const e2 = 0.00669437999014;
        const N = a / Math.sqrt(1 - e2 * sLat * sLat);
        const alt = this.groundAltitude;
        const ex = (N + alt) * cLat * cLon;
        const ey = (N + alt) * cLat * sLon;
        const ez = (N * (1 - e2) + alt) * sLat;

        // ENU basis at the target, expressed in the Y-up flipped ECEF frame
        const east = [-sLon, 0, -cLon];
        const up = [cLat * cLon, sLat, -cLat * sLon];
        const south = [sLat * cLon, -cLat, -sLat * sLon];

        // Rotation with rows [east, up, south] maps the tile frame to local
        // ENU. pc.Mat4.set takes column-major data.
        const m = new pc.Mat4();
        m.set([
            east[0], up[0], south[0], 0,
            east[1], up[1], south[1], 0,
            east[2], up[2], south[2], 0,
            0, 0, 0, 1,
        ]);
        const q = new pc.Quat();
        q.setFromMat4(m);

        this._anchor.setLocalRotation(q);
        const s = this.tileScale;
        this._anchor.setLocalScale(s, s, s);
        this._tileRoot.setLocalPosition(-ex, -ez, ey);

        // geocentric radius of the ground at the anchor — reference for the
        // altitude-adaptive clip planes
        this._targetRadius = len3(ex, ey, ez);

        // ENU basis (north = -south) + sun direction, both in the tile frame
        this._enu = { east, up, north: [-south[0], -south[1], -south[2]] };
        this._computeSunDir();
        // keep the sky shell sized to the (possibly moved) ground radius
        if (this._skyEntity) {
            const r = 2 * (this._targetRadius + ATMO_THICKNESS);
            this._skyEntity.setLocalScale(r, r, r);
        }
    }

    /**
     * Apply the baseline clip planes (used at init, when the properties
     * change, and as the fixed values when altitudeAdaptive is off).
     */
    _applyCameraClips() {
        const cam = ArrivalSpace.getCamera()?.camera;
        if (!cam) return;
        if (this._origNearClip === null) this._origNearClip = cam.nearClip;
        if (this._origFarClip === null) this._origFarClip = cam.farClip;
        cam.nearClip = this.cameraNearClip;
        cam.farClip = this.cameraFarClip;
    }

    /**
     * Altitude-adaptive clip planes (altitudeAdaptive on). The properties are
     * the GROUND-LEVEL baselines; both planes grow with the camera's height
     * above the anchor ground so the far/near depth ratio stays healthy:
     *   near = max(baseline, altitude / 200), capped at 50 km
     *   far  = max(baseline, 1.5 x horizon distance), capped at 20,000 km
     * At street level you get the baselines; from orbit (altitude in the
     * millions) near exceeds 1,000 m and far reaches the planet scale.
     * Heights come from the camera's geocentric radius in the tile frame,
     * so this stays correct for a scaled-down tabletop globe too.
     */
    _updateDynamicClips(viewer, altitude) {
        const cam = viewer.camera;
        if (!cam) return;

        const earthRadius = 6378137 * this.tileScale;
        const horizon = Math.sqrt(2 * earthRadius * altitude + altitude * altitude);

        const near = Math.min(50000, Math.max(this.cameraNearClip, altitude / 200));
        const far = Math.min(20000000, Math.max(this.cameraFarClip, (horizon + altitude) * 1.5));

        if (this._origNearClip === null) this._origNearClip = cam.nearClip;
        if (this._origFarClip === null) this._origFarClip = cam.farClip;

        // only write on >1% change to avoid redundant projection updates
        if (Math.abs(cam.nearClip - near) > near * 0.01) cam.nearClip = near;
        if (Math.abs(cam.farClip - far) > far * 0.01) cam.farClip = far;
    }

    /**
     * Altitude-proportional fly speed (Google Earth feel): speed = altitude/2,
     * so descending automatically eases you into a landing and from orbit you
     * cross continents. The user's scroll-wheel input is preserved as a
     * multiplier on top of the auto speed instead of being stomped.
     * Requires client VERSION >= 1.11.2 (getFreeCamSpeed/setFreeCamSpeed).
     */
    _updateFreeCamSpeed(altitude) {
        const info = ArrivalSpace.getFreeCamSpeed?.();
        if (!info) return;

        // detect scroll-wheel changes since our last write
        if (this._lastAutoSpeed !== null &&
            Math.abs(info.speed - this._lastAutoSpeed) > this._lastAutoSpeed * 0.01) {
            this._speedMult *= info.speed / this._lastAutoSpeed;
            this._speedMult = Math.min(20, Math.max(0.05, this._speedMult));
        }

        const auto = Math.max(15, altitude / 2);
        const target = Math.min(this.freeCamMaxSpeed, Math.max(1, auto * this._speedMult));
        ArrivalSpace.setFreeCamSpeed?.(target, this.freeCamMaxSpeed);
        this._lastAutoSpeed = target;
    }

    // ────────────────────────────────────────────
    // Streaming
    // ────────────────────────────────────────────

    async _start() {
        const session = ++this._sessionId;
        this._clearTiles();

        const viaIon = !this.apiKey && this.cesiumIonToken;
        this._status(viaIon ? "Connecting via Cesium Ion..." : "Connecting to Google 3D Tiles...");

        let apiKey;
        try {
            apiKey = await this._resolveApiKey();
        } catch (err) {
            if (session !== this._sessionId) return;
            this._tree = null;
            this._status(`Cesium Ion handshake failed: ${err.message}\nCheck the Cesium Ion token.`);
            return;
        }
        if (session !== this._sessionId) return;   // re-entered while awaiting Ion
        if (!apiKey) {
            this._status("Enter a Google Maps API key, or a Cesium Ion token for EEA accounts");
            return;
        }

        const tree = new TileTree(apiKey, {
            load: node => this._loadTile(node, tree, session),
            unload: node => this._unloadTile(node),
            show: node => this._setTileVisible(node, true),
            hide: node => this._setTileVisible(node, false),
        });
        tree.lodFactor = this.detail;
        this._tree = tree;

        try {
            await tree.start();
        } catch (err) {
            if (session !== this._sessionId) return;
            this._tree = null;
            // Google blocks satellite + 3D tiles for keys on an EEA-billing
            // project (effective 8 Jul 2025), with this exact 403 message.
            const eeaBlocked = err.status === 403 &&
                /not available for your account and region/i.test(err.detail || "");
            this._status(
                eeaBlocked
                    ? "Google blocked 3D tiles for this key's billing region (EEA).\n" +
                      "Provide a Cesium Ion token instead to stream the tiles."
                    : `Failed to load root tileset: ${err.message}\n` +
                      `Check the API key and that "Map Tiles API" is enabled.`
            );
        }
    }

    /**
     * Resolve the Google Maps key used for every tile request. A direct Google
     * key (apiKey) takes precedence; otherwise a Cesium Ion token triggers a
     * one-time handshake against Ion's Google Photorealistic 3D Tiles asset.
     * That asset is "external": Ion returns a tile.googleapis.com root URL
     * carrying Cesium's own (non-EEA-billing) Google key rather than proxying
     * the tiles, so the loader streams them unchanged — and Google's regional
     * block, keyed on the API key's project rather than the viewer, never fires.
     */
    async _resolveApiKey() {
        if (this.apiKey) return this.apiKey;
        if (!this.cesiumIonToken) return "";

        const url = `${CESIUM_ION_API}assets/${CESIUM_GOOGLE_ASSET_ID}/endpoint` +
            `?access_token=${encodeURIComponent(this.cesiumIonToken)}`;
        const res = await fetch(url);
        if (!res.ok) {
            let detail = "";
            try { detail = (await res.json())?.message || ""; } catch (_) { /* non-JSON body */ }
            const err = new Error(detail || `HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        const json = await res.json();
        // External Google asset: the key rides in the returned tileset URL.
        const tilesetUrl = json.options?.url;
        const key = tilesetUrl && new URL(tilesetUrl).searchParams.get("key");
        if (!key) throw new Error("Ion endpoint returned no Google tile key");
        return key;
    }

    /**
     * Wait for a download slot. The queue is drained newest-first (LIFO):
     * while the player moves, the most recent expands are the nearest tiles,
     * and stale queued loads usually get tombstoned before they ever run.
     */
    _acquireSlot() {
        if (this._loadSlots < GoogleTiles.MAX_CONCURRENT_LOADS) {
            this._loadSlots++;
            return Promise.resolve();
        }
        return new Promise(resolve => this._loadQueue.push(resolve))
            .then(() => { this._loadSlots++; });
    }

    _releaseSlot() {
        this._loadSlots--;
        const next = this._loadQueue.pop();
        if (next) next();
    }

    async _loadTile(node, tree, session) {
        const existing = this._records.get(node);
        if (existing && !existing.dead) return; // already loaded or loading

        // Record exists before any await so an unload during the download
        // can tombstone it (dead flag) instead of leaking the entity
        const rec = { entity: null, asset: null, dead: false };
        this._records.set(node, rec);
        try {
            await this._acquireSlot();
            try {
                if (session !== this._sessionId || rec.dead) return;
                const url = tree.buildTileUrl(node.content.uri);
                const { entity, asset } = await ArrivalSpace.loadGLB(url, {
                    parent: this._tileRoot,
                    name: "google-tile",
                    castShadows: false,
                });

                if (session !== this._sessionId || rec.dead) {
                    this._disposeTile(entity, asset);
                    return;
                }

                rec.entity = entity;
                rec.asset = asset;
                if (this._patchActive || this.atmosphere) this._chunkEntity(entity);
                if (this.directLight) this._tuneEntity(entity);
            } finally {
                this._releaseSlot();
            }
        } finally {
            // tombstoned or failed loads leave no record behind
            if (this._records.get(node) === rec && !rec.entity) {
                this._records.delete(node);
            }
        }
    }

    _unloadTile(node) {
        const rec = this._records.get(node);
        if (!rec) return;
        this._records.delete(node);
        rec.dead = true;
        if (rec.entity) this._forgetEntityMaterials(rec.entity);
        this._disposeTile(rec.entity, rec.asset);
    }

    /**
     * Free BOTH the scene entity and its container asset.
     *
     * Each tile's geometry is resident twice: PlayCanvas keeps the client-side
     * ArrayBuffer (VertexBuffer/IndexBuffer.storage) after uploading to the GPU
     * and only releases it on the buffer's destroy() — true on both the WebGL
     * and WebGPU backends (neither nulls .storage post-upload), so a tile costs
     * ~2x its GPU footprint plus its textures. Destroying only the entity tears
     * down the mesh instances but leaves the container asset — and thus both the
     * CPU copies and the GPU buffers/textures — alive in app.assets. (loadGLB
     * containers aren't referenced via render.asset, so disposeEntity({
     * destroyAssets }) misses them too.) Across a long flight that double pool
     * balloons; remove and unload the container explicitly to reclaim it.
     */
    _disposeTile(entity, asset) {
        try { entity?.destroy(); } catch (_) { /* already gone */ }
        if (asset) {
            try {
                this.app.assets.remove(asset);
                asset.unload();
            } catch (_) { /* already gone */ }
        }
    }

    _setTileVisible(node, visible) {
        const rec = this._records.get(node);
        if (rec?.entity) rec.entity.enabled = visible;
    }

    _clearTiles() {
        for (const node of Array.from(this._records.keys())) {
            this._unloadTile(node);
        }
        // Wake queued waiters — they bail on the session/tombstone check
        for (const resolve of this._loadQueue.splice(0)) resolve();
    }

    // ────────────────────────────────────────────
    // Shader-chunk layer (carve + saturation)
    // ────────────────────────────────────────────

    _shaderLang() {
        return this.app.graphicsDevice?.isWebGPU ? "wgsl" : "glsl";
    }

    /** Inject the combined chunks once per material and seed its uniforms. */
    _ensureChunks(mat) {
        if (!mat || this._chunkedMaterials.has(mat)) return;
        const lang = this._shaderLang();
        try {
            const chunks = mat.getShaderChunks(lang);
            chunks.set(CHUNK_DECL_NAME, lang === "wgsl" ? CHUNK_DECL_WGSL : CHUNK_DECL_GLSL);
            chunks.set(CHUNK_MAIN_NAME, lang === "wgsl" ? CHUNK_MAIN_WGSL : CHUNK_MAIN_GLSL);
            mat.update();
        } catch (e) { return; }
        this._chunkedMaterials.add(mat);
        // Declared uniforms read as 0 until set — seed them so a freshly chunked
        // material isn't carved (uPatchEnable) or forced to greyscale (uSaturation).
        const region = this._activeRegion();
        if (region) {
            mat.setParameter("uPatchInv", region.inv);
            mat.setParameter("uPatchHalf", region.half);
        }
        mat.setParameter("uPatchEnable", region ? 1 : 0);
        mat.setParameter("uSaturation", this.directLight ? this.saturation : 1.0);
        // Atmosphere seeds — per-frame values (uWorldToTile/uCamTile/uSunDirTile)
        // are refreshed in _updateAtmosphereUniforms.
        mat.setParameter("uAtmoEnable", this.atmosphere ? 1 : 0);
        mat.setParameter("uSunIntensity", this.sunIntensity);
        mat.setParameter("uSkyExposure", this.skyExposure);
        mat.setParameter("uPlanetRadius", this._targetRadius);
        mat.setParameter("uAtmoRadius", this._targetRadius + ATMO_THICKNESS);
    }

    _chunkEntity(entity) {
        if (!entity) return;
        const renders = entity.findComponents("render") || [];
        for (const r of renders) {
            for (const mi of r.meshInstances || []) {
                if (mi.material) this._ensureChunks(mi.material);
            }
        }
    }

    _chunkAllTiles() {
        for (const rec of this._records.values()) {
            if (rec.entity) this._chunkEntity(rec.entity);
        }
    }

    /** Drop a tile's materials from the tracking sets before it is destroyed,
     *  so a long flight doesn't accumulate references to dead materials. */
    _forgetEntityMaterials(entity) {
        const renders = entity.findComponents("render") || [];
        for (const r of renders) {
            for (const mi of r.meshInstances || []) {
                if (!mi.material) continue;
                this._chunkedMaterials.delete(mi.material);
                this._tunedMaterials.delete(mi.material);
            }
        }
    }

    // Single active region drives the carve (v1). Last-inserted wins.
    _activeRegion() {
        let region = null;
        for (const r of this._patchRegions.values()) region = r;
        return region;
    }

    _applyPatchUniforms() {
        const region = this._activeRegion();
        const enable = region ? 1 : 0;
        for (const mat of this._chunkedMaterials) {
            if (region) {
                mat.setParameter("uPatchInv", region.inv);
                mat.setParameter("uPatchHalf", region.half);
            }
            mat.setParameter("uPatchEnable", enable);
        }
        if (this._patchRegions.size > 1) {
            console.warn(
                `GoogleTiles: ${this._patchRegions.size} patch regions active; v1 carves only the most recent.`
            );
        }
    }

    _applySaturationUniform() {
        const s = this.directLight ? this.saturation : 1.0;
        for (const mat of this._chunkedMaterials) mat.setParameter("uSaturation", s);
    }

    // ────────────────────────────────────────────
    // Atmosphere
    // ────────────────────────────────────────────

    /**
     * Sun direction in the tile frame from the anchor's lat/lon + day-of-year +
     * UTC hour (low-precision solar position; good enough for lighting/sky).
     */
    _computeSunDir() {
        if (!this._enu) return;
        const lat = this.latitude * Math.PI / 180;
        // declination: ±23.44° over the year, peak near the solstices
        const decl = -0.40928 * Math.cos((2 * Math.PI / 365) * (this.dayOfYear + 10));
        const solarTime = this.timeUTC + this.longitude / 15;   // longitude east → solar time
        const H = (solarTime - 12) * 15 * Math.PI / 180;        // hour angle (rad)
        const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
        const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
        const cosEl = Math.cos(el);
        let az = 0;
        if (cosEl > 1e-4) {
            let cosAz = (Math.sin(decl) - Math.sin(lat) * sinEl) / (Math.cos(lat) * cosEl);
            az = Math.acos(Math.max(-1, Math.min(1, cosAz)));   // azimuth from north
            if (H > 0) az = 2 * Math.PI - az;                   // afternoon → west
        }
        const sE = cosEl * Math.sin(az), sN = cosEl * Math.cos(az), sU = Math.sin(el);
        const e = this._enu.east, u = this._enu.up, n = this._enu.north;
        const x = sE * e[0] + sN * n[0] + sU * u[0];
        const y = sE * e[1] + sN * n[1] + sU * u[1];
        const z = sE * e[2] + sN * n[2] + sU * u[2];
        const L = len3(x, y, z) || 1;
        this._sunDirTile = [x / L, y / L, z / L];
    }

    /**
     * Build the sky-shell sphere: a double-sided sphere at the atmosphere-top
     * radius whose material ray-marches the atmosphere. Centred at the tile
     * frame origin (planet centre), so it scales with the globe.
     */
    _buildSky() {
        if (this._skyEntity) { this._skyEntity.enabled = true; return; }
        let mat;
        try {
            mat = new pc.ShaderMaterial({
                uniqueName: "google-tiles-atmosphere-sky",
                attributes: { aPosition: pc.SEMANTIC_POSITION },
                vertexGLSL: SKY_VERT_GLSL,
                fragmentGLSL: SKY_FRAG_GLSL,
                vertexWGSL: SKY_VERT_WGSL,
                fragmentWGSL: SKY_FRAG_WGSL,
            });
        } catch (e) {
            // Haze (chunk layer) still works without the sky shell.
            console.warn("GoogleTiles: sky material unavailable:", e.message);
            return;
        }
        mat.cull = pc.CULLFACE_NONE;    // visible from inside (sky) and outside (halo)
        mat.blendType = pc.BLEND_PREMULTIPLIED;   // emit inscatter, bg through by transmittance
        mat.depthWrite = false;         // never occludes the tiles
        mat.depthTest = true;
        mat.update();

        // High-res sphere: the scattering colour changes steeply across the
        // limb, so a coarse mesh shows each latitude band as a discrete ring.
        // 256×128 makes the per-vertex direction step imperceptible.
        let mi = null;
        try {
            const geom = new pc.SphereGeometry({ radius: 0.5, latitudeBands: 256, longitudeBands: 128 });
            mi = new pc.MeshInstance(pc.Mesh.fromGeometry(this.app.graphicsDevice, geom), mat);
            mi.castShadows = false;
        } catch (e) {
            console.warn("GoogleTiles: hi-res sphere unavailable, using primitive:", e.message);
        }

        const sky = new pc.Entity("google-tiles-atmosphere-sky");
        if (mi) sky.addComponent("render", { meshInstances: [mi], castShadows: false });
        else sky.addComponent("render", { type: "sphere", material: mat, castShadows: false });
        const r = 2 * (this._targetRadius + ATMO_THICKNESS);  // unit sphere d=1 → radius
        sky.setLocalScale(r, r, r);
        this._tileRoot.addChild(sky);
        this._skyEntity = sky;
        this._skyMaterial = mat;
    }

    /** Refresh the per-frame atmosphere uniforms on the tiles and the sky shell. */
    _updateAtmosphereUniforms(camLocal) {
        const m = this._invTileMat.data;          // world → tile frame
        const cam = [camLocal.x, camLocal.y, camLocal.z];
        const sun = this._sunDirTile;
        const pr = this._targetRadius;
        const ar = this._targetRadius + ATMO_THICKNESS;

        for (const mat of this._chunkedMaterials) {
            mat.setParameter("uWorldToTile", m);
            mat.setParameter("uCamTile", cam);
            mat.setParameter("uSunDirTile", sun);
            mat.setParameter("uPlanetRadius", pr);
            mat.setParameter("uAtmoRadius", ar);
            mat.setParameter("uSunIntensity", this.sunIntensity);
            mat.setParameter("uSkyExposure", this.skyExposure);
            mat.setParameter("uAtmoEnable", 1);
        }
        const sky = this._skyMaterial;
        if (sky) {
            sky.setParameter("uWorldToTile", m);
            sky.setParameter("uCamTile", cam);
            sky.setParameter("uSunDirTile", sun);
            sky.setParameter("uPlanetRadius", pr);
            sky.setParameter("uAtmoRadius", ar);
            sky.setParameter("uSunIntensity", this.sunIntensity);
            sky.setParameter("uSkyExposure", this.skyExposure);
        }
    }

    // ────────────────────────────────────────────
    // Direct-light material tuning
    // ────────────────────────────────────────────
    //
    // Master-gated by directLight. While OFF nothing here runs, so tiles keep
    // Google's stock (effectively unlit) materials at zero per-tile cost. While
    // ON each tile material is switched to lit and the knobs applied; the
    // pre-tune state is stashed on the material so toggling off restores it.

    _tuneMaterial(mat) {
        if (!mat) return;
        if (!mat._gtOrig) {
            mat._gtOrig = {
                useLighting: mat.useLighting,
                diffuse: mat.diffuse.clone(),
                diffuseMap: mat.diffuseMap,
                emissive: mat.emissive.clone(),
                emissiveMap: mat.emissiveMap,
                emissiveIntensity: mat.emissiveIntensity,
                gloss: mat.gloss,
                metalness: mat.metalness,
                useMetalness: mat.useMetalness,
                ambient: mat.ambient.clone(),
            };
            // Google parks the baked aerial photo in emissiveMap (unlit); fall
            // back to diffuseMap for a normally-lit GLB.
            mat._gtBaseMap = mat.emissiveMap || mat.diffuseMap || null;
        }

        const b = this.materialBrightness;
        this._tintColor.fromString(this.diffuseTint);
        const t = this._tintColor;

        mat.useLighting = true;
        if (mat._gtBaseMap) mat.diffuseMap = mat._gtBaseMap;
        mat.diffuse.set(t.r * b, t.g * b, t.b * b);
        mat.useMetalness = true;
        mat.metalness = this.metalness;
        mat.gloss = this.gloss;
        mat.ambient.set(this.ambientResponse, this.ambientResponse, this.ambientResponse);
        // self-illumination — 0 boost keeps tiles purely lit (no glow in shadow)
        if (mat._gtBaseMap) mat.emissiveMap = mat._gtBaseMap;
        mat.emissive.set(t.r, t.g, t.b);
        mat.emissiveIntensity = this.emissiveBoost;
        mat.update();

        this._tunedMaterials.add(mat);
        this._ensureChunks(mat);                 // saturation rides the chunk layer
        mat.setParameter("uSaturation", this.saturation);
    }

    _restoreMaterial(mat) {
        const o = mat._gtOrig;
        if (!o) return;
        mat.useLighting = o.useLighting;
        mat.diffuse.copy(o.diffuse);
        mat.diffuseMap = o.diffuseMap;
        mat.emissive.copy(o.emissive);
        mat.emissiveMap = o.emissiveMap;
        mat.emissiveIntensity = o.emissiveIntensity;
        mat.gloss = o.gloss;
        mat.metalness = o.metalness;
        mat.useMetalness = o.useMetalness;
        mat.ambient.copy(o.ambient);
        mat.update();
        this._tunedMaterials.delete(mat);
        mat.setParameter("uSaturation", 1.0);    // neutralize (chunk persists for carve)
    }

    _tuneEntity(entity) {
        if (!entity) return;
        const renders = entity.findComponents("render") || [];
        for (const r of renders) {
            for (const mi of r.meshInstances || []) {
                if (mi.material) this._tuneMaterial(mi.material);
            }
        }
    }

    _tuneAllTiles() {
        for (const rec of this._records.values()) {
            if (rec.entity) this._tuneEntity(rec.entity);
        }
    }

    _restoreAllTiles() {
        for (const mat of Array.from(this._tunedMaterials)) this._restoreMaterial(mat);
    }

    // ────────────────────────────────────────────
    // UI
    // ────────────────────────────────────────────

    _status(msg) {
        if (msg === this._lastStatus) return;
        this._lastStatus = msg;
        try {
            if (!this._statusEl) {
                this._statusEl = this.createUI("div");
                if (this._statusEl) {
                    Object.assign(this._statusEl.style, {
                        position: "fixed",
                        bottom: "32px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "rgba(10,15,25,0.82)",
                        color: "#6fdf6f",
                        padding: "8px 14px",
                        fontFamily: "monospace",
                        fontSize: "13px",
                        borderRadius: "6px",
                        maxWidth: "420px",
                        whiteSpace: "pre-wrap",
                        lineHeight: "1.4",
                        textAlign: "center",
                        zIndex: "999",
                        pointerEvents: "none",
                    });
                    this._statusEl.style.display = this.showStatus ? "block" : "none";
                }
            }
            if (this._statusEl) this._statusEl.textContent = msg;
        } catch (_) { /* UI not available */ }
    }

    /** Google's terms require visible attribution while tiles are displayed */
    _makeAttribution() {
        try {
            const el = this.createUI("div");
            if (!el) return;
            el.textContent = "Map data © Google";
            Object.assign(el.style, {
                position: "fixed",
                bottom: "8px",
                right: "12px",
                color: "#fff",
                textShadow: "0 0 3px rgba(0,0,0,0.9)",
                fontFamily: "sans-serif",
                fontSize: "11px",
                zIndex: "999",
                pointerEvents: "none",
            });
        } catch (_) { /* UI not available */ }
    }
}
