/**
 * Time of Day Sky — a sky that follows the hours: the sun crosses it, lights the space, sets in a
 * warm glow and leaves a dark-blue night full of stars. Volumetric clouds drift with the wind.
 *
 * Drop it in and set the time, or give the day a length to let it run (every visitor sees the same
 * hour: the cycle runs on the clock). While it is in the space it replaces the skybox, turns the
 * room's main light into the sun (the moon at night) and dims the sky image's light with the day;
 * remove it and the room's own sky and light come back.
 *
 * Features demonstrated:
 * - a procedural sky dome in the Skybox layer: meshes hide it by depth, splats blend over it
 * - volumetric clouds ray-marched at a fraction of the screen's resolution into a render target
 *   the dome samples (its noise volumes built a few milliseconds per frame, so loading never stalls)
 * - driving the room's lighting: ArrivalSpace.setSkyboxHidden, the main directional light, scene.skyboxIntensity
 * - a lens flare, hidden when a collider stands between you and the sun (ArrivalSpace.raycastPhysics)
 *
 * The clouds and the flare are lifted from the Flight Simulator space (Extra 300L at Meigs Field).
 * In VR the clouds are off (the march is per screen, not per eye). On WebGPU there is no flare.
 *
 * Requires ArrivalSpace.VERSION >= 1.27.0.
 */

// ---- clouds: noise volumes (generators: the plugin runs them a few ms per frame) -----------------
function hash3(x, y, z, seed) {
  let h = x * 374761393 + y * 668265263 + z * 1274126177 + seed * 2654435761 | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const mod = (a, n) => (a % n + n) % n;
function worley(x, y, z, freq, seed) {
  const px = x * freq, py = y * freq, pz = z * freq;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy, cz = iz + dz;
    const wx = mod(cx, freq), wy = mod(cy, freq), wz = mod(cz, freq);
    const fx = cx + hash3(wx, wy, wz, seed), fy = cy + hash3(wx, wy, wz, seed + 1), fz = cz + hash3(wx, wy, wz, seed + 2);
    const d = (fx - px) ** 2 + (fy - py) ** 2 + (fz - pz) ** 2;
    if (d < best) best = d;
  }
  return 1 - Math.min(1, Math.sqrt(best));
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const GRAD = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
function perlin(x, y, z, freq, seed) {
  const px = x * freq, py = y * freq, pz = z * freq;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const g = (i, j, k, dx, dy, dz) => {
    const v2 = GRAD[Math.floor(hash3(mod(i, freq), mod(j, freq), mod(k, freq), seed) * 12)];
    return v2[0] * dx + v2[1] * dy + v2[2] * dz;
  };
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(g(ix, iy, iz, fx, fy, fz), g(ix + 1, iy, iz, fx - 1, fy, fz), u), l(g(ix, iy + 1, iz, fx, fy - 1, fz), g(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), u), v),
    l(l(g(ix, iy, iz + 1, fx, fy, fz - 1), g(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), u), l(g(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), g(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1), u), v),
    w
  );
}
const worleyFbm = (x, y, z, f, seed) => worley(x, y, z, f, seed) * 0.625 + worley(x, y, z, f * 2, seed + 7) * 0.25 + worley(x, y, z, f * 4, seed + 13) * 0.125;
const remap = (v, a, b, c, d) => c + (v - a) / (b - a) * (d - c);
const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
function* shapeSlices(out, N5, z0, z1, seed = 3) {
  for (let z = z0; z < z1; z++) for (let y = 0; y < N5; y++) for (let x = 0; x < N5; x++) {
    const u = x / N5, v = y / N5, w = z / N5;
    let p = 0, amp = 1, norm2 = 0;
    for (let o = 0; o < 3; o++) {
      p += perlin(u, v, w, 4 << o, seed + o) * amp;
      norm2 += amp;
      amp *= 0.5;
    }
    p = Math.max(0, Math.min(1, p / norm2 * 0.9 + 0.5));
    const w1 = worleyFbm(u, v, w, 4, seed + 20), w2 = worleyFbm(u, v, w, 8, seed + 40), w3 = worleyFbm(u, v, w, 16, seed + 60);
    const pw = remap(p, 0, 1, w1, 1);
    const k = ((z * N5 + y) * N5 + x) * 4;
    out[k] = byte(pw);
    out[k + 1] = byte(w1);
    out[k + 2] = byte(w2);
    out[k + 3] = byte(w3);
    yield;
  }
}
function* detailNoise(N5 = 32, seed = 101) {
  const out = new Uint8Array(N5 * N5 * N5 * 4);
  for (let z = 0; z < N5; z++) for (let y = 0; y < N5; y++) for (let x = 0; x < N5; x++) {
    const u = x / N5, v = y / N5, w = z / N5;
    const k = ((z * N5 + y) * N5 + x) * 4;
    out[k] = byte(worleyFbm(u, v, w, 2, seed));
    out[k + 1] = byte(worleyFbm(u, v, w, 4, seed + 30));
    out[k + 2] = byte(worleyFbm(u, v, w, 8, seed + 60));
    out[k + 3] = 255;
    yield;
  }
  return { size: N5, data: out };
}
function* weatherMap(S = 256, seed = 211) {
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let p = 0, amp = 1, norm2 = 0;
    for (let o = 0; o < 5; o++) {
      p += perlin(u, v, 0.5, 4 << o, seed + o) * amp;
      norm2 += amp;
      amp *= 0.5;
    }
    const cells = worley(u, v, 0.5, 6, seed + 10) * 0.6 + worley(u, v, 0.5, 12, seed + 11) * 0.4;
    const cov = Math.max(0, Math.min(1, 0.5 + p / norm2 * 2.4 + (cells - 0.5) * 0.7));
    let t = 0;
    for (let o = 0; o < 3; o++) t += perlin(u, v, 0.25, 2 << o, seed + 20 + o) * 0.5 ** o;
    const k = (y * S + x) * 4;
    out[k] = byte(cov);
    out[k + 1] = byte(t * 0.6 + 0.5);
    out[k + 2] = byte(0.5 + 0.5 * perlin(u, v, 0.75, 3, seed + 30));
    out[k + 3] = 255;
    yield;
  }
  return { size: S, data: out };
}

// ---- clouds: CPU sampling, the sky's light, presets --------------------------------------------
const sstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const remapC = (v, a, b, c, d) => c + (v - a) / (b - a) * (d - c);
const wrap3 = (v, n) => (v % n + n) % n;
const W2 = new Float64Array(2);
const S4 = new Float64Array(4);
function weatherAt(wm, u, v) {
  const S = wm.size, d = wm.data, x = wrap3(u * S - 0.5, S), y = wrap3(v * S - 0.5, S);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, x1 = (x0 + 1) % S, y1 = (y0 + 1) % S;
  const k00 = (y0 * S + x0) * 4, k10 = (y0 * S + x1) * 4, k01 = (y1 * S + x0) * 4, k11 = (y1 * S + x1) * 4;
  const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, e = fx * fy;
  W2[0] = (d[k00] * a + d[k10] * b + d[k01] * c + d[k11] * e) / 255;
  W2[1] = (d[k00 + 1] * a + d[k10 + 1] * b + d[k01 + 1] * c + d[k11 + 1] * e) / 255;
}
function shapeAt(data, N5, u, v, w) {
  const x = wrap3(u * N5 - 0.5, N5), y = wrap3(v * N5 - 0.5, N5), z = wrap3(w * N5 - 0.5, N5);
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0;
  const x1 = (x0 + 1) % N5, y1 = (y0 + 1) % N5, z1 = (z0 + 1) % N5;
  S4[0] = S4[1] = S4[2] = S4[3] = 0;
  for (let iz = 0; iz < 2; iz++) {
    const zz = iz ? z1 : z0, wz = iz ? fz : 1 - fz;
    for (let iy = 0; iy < 2; iy++) {
      const yy = iy ? y1 : y0, wzy = wz * (iy ? fy : 1 - fy), row = (zz * N5 + yy) * N5;
      const k0 = (row + x0) * 4, k1 = (row + x1) * 4, w0 = wzy * (1 - fx), w1 = wzy * fx;
      S4[0] += data[k0] * w0 + data[k1] * w1;
      S4[1] += data[k0 + 1] * w0 + data[k1 + 1] * w1;
      S4[2] += data[k0 + 2] * w0 + data[k1 + 2] * w1;
      S4[3] += data[k0 + 3] * w0 + data[k1 + 3] * w1;
    }
  }
  for (let c = 0; c < 4; c++) S4[c] /= 255;
}
const HEIGHTS = [0.2, 0.4, 0.6];
function cloudColumn(wm, shape, layer, wind, x, z) {
  weatherAt(wm, (x + wind[0]) / 36e3, (z + wind[1]) / 36e3);
  const cov = Math.max(0, Math.min(1, layer.coverage + (W2[0] - 0.5) * 0.9));
  if (cov < 0.01) return 0;
  const kind = Math.max(0, Math.min(1, W2[1] * 1.4 - 0.2 + layer.coverage * 0.25));
  const top = 0.3 + 0.7 * kind;
  let sum = 0;
  for (let h = 0; h < 3; h++) {
    const hf = HEIGHTS[h];
    const prof = sstep(0, 0.07, hf) * (1 - sstep(top * 0.55, top, hf));
    if (prof <= 0) continue;
    const y = layer.base + hf * layer.depth;
    shapeAt(shape.data, shape.size, (x + wind[0]) / 4200, y / 4200, (z + wind[1]) / 4200);
    const lowFbm = S4[1] * 0.625 + S4[2] * 0.25 + S4[3] * 0.125;
    const b = remapC(S4[0], lowFbm - 1, 1, 0, 1) * prof;
    sum += Math.max(0, Math.min(1, remapC(b, 1 - cov, 1, 0, 1))) * cov;
  }
  return sstep(5e-3, 0.2, sum / 3);
}
const smooth2 = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function sunTint(s) {
  const h = Math.max(-1, Math.asin(Math.max(-1, Math.min(1, s))) * 180 / Math.PI);
  const m = Math.max(1.4, 1 / (Math.max(0, Math.sin(h * Math.PI / 180)) + 0.50572 * Math.pow(h + 6.07995, -1.6364)));
  const c = [0.1, 0.16, 0.3].map((t) => Math.exp(-t * (m - 1.4)));
  const k = Math.max(c[0], c[1], c[2]);
  return [0.15 + 0.85 * c[0] / k, 0.15 + 0.85 * c[1] / k, 0.15 + 0.85 * c[2] / k];
}
function skyLight(sunUp) {
  const day = smooth2(-0.04, 0.12, sunUp);
  const warm = 1 - smooth2(0.02, 0.35, sunUp);
  const sun = sunTint(sunUp).map((v, i) => v * [1, 0.97, 0.92][i] * day * 1.15);
  const top = mix3([0.05, 0.06, 0.1], [0.36, 0.48, 0.7], day);
  const bottom = mix3([0.03, 0.03, 0.04], [0.15, 0.16, 0.18], day);
  const haze = mix3([0.08, 0.09, 0.12], mix3([0.72, 0.8, 0.9], [0.9, 0.62, 0.45], warm * 0.7), day);
  return { sun, top, bottom, haze };
}
const CLOUD_PRESETS = {
  None: null,
  Few: { coverage: 0.26, depth: 1400 },
  Scattered: { coverage: 0.4, depth: 1700 },
  Broken: { coverage: 0.58, depth: 2e3 },
  Overcast: { coverage: 0.9, depth: 900 }
};

// ---- clouds: the ray march (a full-screen triangle into a low-resolution target) ------------------
const MARCH_VS_GLSL = (
  /* glsl */
  `
attribute vec3 vertex_position;
varying vec2 vNdc;
void main(void) {
    vNdc = vertex_position.xy;
    gl_Position = vec4(vertex_position.xy, 0.5, 1.0);
}
`
);
const MARCH_VS_WGSL = (
  /* wgsl */
  `
attribute vertex_position: vec3f;
varying vNdc: vec2f;
@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.vNdc = input.vertex_position.xy;
    output.position = vec4f(input.vertex_position.xy, 0.5, 1.0);
    return output;
}
`
);
const MARCH_FS_GLSL = (
  /* glsl */
  `
#define R_EARTH 6371000.0
uniform mat4 uInvViewProj;     // clip -> world
uniform vec3 uCamWorld;        // the camera, world
uniform vec3 uCamPos;          // the camera, metres: x/z on the ground, y above sea level
uniform vec3 uSunDir;          // toward the sun
uniform vec3 uSunColor;        // its light (linear)
uniform vec3 uAmbTop;          // the sky's light from above
uniform vec3 uAmbBottom;       // the ground's from below
uniform vec3 uHaze;            // the horizon's haze
uniform vec4 uLayer;           // base, top (m above sea level), coverage 0..1, extinction (1/m)
uniform vec4 uWind;            // drift (m, x and z), time (s), -
uniform vec4 uMarch;           // steps, the farthest (m), frame, light samples
uniform vec4 uLook;            // coloured absorption (0 grey .. 1), sky light's occlusion from above (0 .. 1), its height (m), -
uniform highp sampler3D uShape;
uniform highp sampler3D uDetail;
uniform sampler2D uWeather;
varying vec2 vNdc;

float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566371 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

// each kind's height profile in the layer: stratus a low flat band, cumulus rounded to its top
float profile(float hf, float kind) {
    float top = mix(0.3, 1.0, kind);
    return smoothstep(0.0, 0.07, hf) * (1.0 - smoothstep(top * 0.55, top, hf));
}

float density(vec3 p, float hf, bool detail) {
    if (hf <= 0.0 || hf >= 1.0) return 0.0;
    vec4 wm = textureLod(uWeather, (p.xz + uWind.xy) / 36000.0, 0.0);
    float cov = clamp(uLayer.z + (wm.r - 0.5) * 0.9, 0.0, 1.0);
    float kind = clamp(wm.g * 1.4 - 0.2 + uLayer.z * 0.25, 0.0, 1.0);
    float prof = profile(hf, kind);
    if (cov < 0.01 || prof <= 0.0) return 0.0;
    vec3 q = (p + vec3(uWind.x, 0.0, uWind.y)) / 4200.0;
    vec4 n = textureLod(uShape, q, 0.0);
    float lowFbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
    float base = remap(n.r, lowFbm - 1.0, 1.0, 0.0, 1.0) * prof;
    float d = clamp(remap(base, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0) * cov;
    if (detail && d > 0.0) {
        vec3 dn = textureLod(uDetail, q * 7.0 + vec3(0.0, uWind.z * 0.003, 0.0), 0.0).rgb;
        float df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
        float m = mix(df, 1.0 - df, clamp(hf * 5.0, 0.0, 1.0));
        d = clamp(remap(d, m * 0.4, 1.0, 0.0, 1.0), 0.0, 1.0);
    }
    return d * uLayer.w;
}

vec2 sphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c;
    float b = dot(oc, rd), h = b * b - dot(oc, oc) + r * r;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
}

void main(void) {
    vec4 w = uInvViewProj * vec4(vNdc, 1.0, 1.0);
    vec3 rd = normalize(w.xyz / w.w - uCamWorld);
    vec3 ro = uCamPos;
    vec3 C = vec3(ro.x, -R_EARTH, ro.z);
    float base = uLayer.x, top = uLayer.y;
    vec2 ib = sphere(ro, rd, C, R_EARTH + base), it = sphere(ro, rd, C, R_EARTH + top);
    float camH = length(ro - C) - R_EARTH;
    float t0 = 0.0, t1 = -1.0;
    if (camH < base) { t0 = ib.y; t1 = it.y; }
    else if (camH < top) { t0 = 0.0; t1 = ib.x > 0.0 ? ib.x : it.y; }
    else if (it.x > 0.0) { t0 = it.x; t1 = ib.x > 0.0 ? ib.x : it.y; }
    t1 = min(t1, uMarch.y);
    vec3 col = vec3(0.0);
    float T = 1.0, dsum = 0.0, wsum = 0.0;
    if (t1 > t0 && t0 >= 0.0) {
        float dt = max((t1 - t0) / uMarch.x, 30.0);
        float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uMarch.z * 0.618034);
        float t = t0 + dt * jitter;
        float cosT = dot(rd, uSunDir);
        for (int i = 0; i < 160; i++) {
            if (float(i) >= uMarch.x * 1.6 || t > t1 || T < 0.02) break;
            vec3 p = ro + rd * t;
            float hf = (length(p - C) - R_EARTH - base) / (top - base);
            float d = density(p, hf, true);
            if (d > 0.0) {
                // toward the sun: optical depth through six growing steps
                float od = 0.0, lt = 0.0, seg = 35.0;
                for (int j = 0; j < 6; j++) {
                    if (float(j) >= uMarch.w) break;
                    vec3 lp = p + uSunDir * (lt + seg * 0.5);
                    od += density(lp, (length(lp - C) - R_EARTH - base) / (top - base), false) * seg;
                    lt += seg;
                    seg *= 2.0;
                }
                // multiple scattering: octaves of weaker, more transmitted, less forward light; per colour, the
                // blue a little more absorbed (the light deep in a cloud warmer) with the sun low, none at noon
                // (white clouds there, not beige)
                float lowSun = 1.0 - smoothstep(0.17, 0.57, dot(uSunDir, normalize(p - C)));
                vec3 K = mix(vec3(1.0), vec3(0.82, 1.0, 1.2), uLook.x * lowSun);
                vec3 sun = vec3(0.0);
                float a = 1.0, b = 1.0, c = 1.0;
                for (int o = 0; o < 3; o++) {
                    sun += a * mix(hg(cosT, 0.8 * c), hg(cosT, -0.25 * c), 0.25) * exp(-od * b * K);
                    a *= 0.5; b *= 0.35; c *= 0.5;
                }
                // powder: thin wisps and edges catch less light than the cloud's depths scatter out
                float powder = 1.0 - exp(-2.5 * d / uLayer.w);
                powder = mix(powder, 1.0, 0.5 + 0.5 * cosT);
                // the sky's light from above, less where cloud lies over the point (one sample higher up)
                vec3 pu = p + normalize(p - C) * uLook.z;
                float occ = exp(-density(pu, (length(pu - C) - R_EARTH - base) / (top - base), false) * uLook.z * 0.25);
                vec3 amb = mix(uAmbBottom, uAmbTop * mix(1.0, occ, uLook.y), clamp(hf, 0.0, 1.0));
                vec3 S = uSunColor * sun * 12.566371 * 2.2 * powder + amb * 0.65;
                float Td = exp(-d * dt);
                col += T * S * (1.0 - Td);
                dsum += t * T * (1.0 - Td);
                wsum += T * (1.0 - Td);
                T *= Td;
                t += dt;
            } else {
                t += dt * 1.6;      // empty air: stride on
            }
        }
    }
    float depth = wsum > 0.0 ? dsum / wsum : uMarch.y;
    // the far clouds fade into the haze, and out at the farthest
    float fog = exp(-depth / 30000.0);
    col = mix(uHaze * (1.0 - T), col, fog);
    float edge = 1.0 - smoothstep(0.7 * uMarch.y, uMarch.y, depth);
    col *= edge;
    T = mix(1.0, T, edge);
    gl_FragColor = vec4(col, T);
}
`
);
const MARCH_FS_WGSL = (
  /* wgsl */
  `
const R_EARTH: f32 = 6371000.0;
uniform uInvViewProj: mat4x4f;
uniform uCamWorld: vec3f;
uniform uCamPos: vec3f;
uniform uSunDir: vec3f;
uniform uSunColor: vec3f;
uniform uAmbTop: vec3f;
uniform uAmbBottom: vec3f;
uniform uHaze: vec3f;
uniform uLayer: vec4f;
uniform uWind: vec4f;
uniform uMarch: vec4f;
uniform uLook: vec4f;
var uShape: texture_3d<f32>;
var uShapeSampler: sampler;
var uDetail: texture_3d<f32>;
var uDetailSampler: sampler;
var uWeather: texture_2d<f32>;
var uWeatherSampler: sampler;
varying vNdc: vec2f;

fn remap(v: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return c + (v - a) / (b - a) * (d - c); }
fn hg(c: f32, g: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (12.566371 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

fn profile(hf: f32, kind: f32) -> f32 {
    let top = mix(0.3, 1.0, kind);
    return smoothstep(0.0, 0.07, hf) * (1.0 - smoothstep(top * 0.55, top, hf));
}

fn density(p: vec3f, hf: f32, detail: bool) -> f32 {
    if (hf <= 0.0 || hf >= 1.0) { return 0.0; }
    let wm = textureSampleLevel(uWeather, uWeatherSampler, (p.xz + uniform.uWind.xy) / 36000.0, 0.0);
    let cov = clamp(uniform.uLayer.z + (wm.r - 0.5) * 0.9, 0.0, 1.0);
    let kind = clamp(wm.g * 1.4 - 0.2 + uniform.uLayer.z * 0.25, 0.0, 1.0);
    let prof = profile(hf, kind);
    if (cov < 0.01 || prof <= 0.0) { return 0.0; }
    let q = (p + vec3f(uniform.uWind.x, 0.0, uniform.uWind.y)) / 4200.0;
    let n = textureSampleLevel(uShape, uShapeSampler, q, 0.0);
    let lowFbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
    let base = remap(n.r, lowFbm - 1.0, 1.0, 0.0, 1.0) * prof;
    var d = clamp(remap(base, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0) * cov;
    if (detail && d > 0.0) {
        let dn = textureSampleLevel(uDetail, uDetailSampler, q * 7.0 + vec3f(0.0, uniform.uWind.z * 0.003, 0.0), 0.0).rgb;
        let df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
        let m = mix(df, 1.0 - df, clamp(hf * 5.0, 0.0, 1.0));
        d = clamp(remap(d, m * 0.4, 1.0, 0.0, 1.0), 0.0, 1.0);
    }
    return d * uniform.uLayer.w;
}

fn sphere(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> vec2f {
    let oc = ro - c;
    let b = dot(oc, rd);
    var h = b * b - dot(oc, oc) + r * r;
    if (h < 0.0) { return vec2f(-1.0); }
    h = sqrt(h);
    return vec2f(-b - h, -b + h);
}

@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let w = uniform.uInvViewProj * vec4f(input.vNdc, 1.0, 1.0);
    let rd = normalize(w.xyz / w.w - uniform.uCamWorld);
    let ro = uniform.uCamPos;
    let C = vec3f(ro.x, -R_EARTH, ro.z);
    let base = uniform.uLayer.x;
    let top = uniform.uLayer.y;
    let ib = sphere(ro, rd, C, R_EARTH + base);
    let it = sphere(ro, rd, C, R_EARTH + top);
    let camH = length(ro - C) - R_EARTH;
    var t0 = 0.0;
    var t1 = -1.0;
    if (camH < base) { t0 = ib.y; t1 = it.y; }
    else if (camH < top) { t0 = 0.0; t1 = select(it.y, ib.x, ib.x > 0.0); }
    else if (it.x > 0.0) { t0 = it.x; t1 = select(it.y, ib.x, ib.x > 0.0); }
    t1 = min(t1, uniform.uMarch.y);
    var col = vec3f(0.0);
    var T = 1.0;
    var dsum = 0.0;
    var wsum = 0.0;
    if (t1 > t0 && t0 >= 0.0) {
        let dt = max((t1 - t0) / uniform.uMarch.x, 30.0);
        let jitter = fract(52.9829189 * fract(dot(pcPosition.xy, vec2f(0.06711056, 0.00583715))) + uniform.uMarch.z * 0.618034);
        var t = t0 + dt * jitter;
        let cosT = dot(rd, uniform.uSunDir);
        for (var i = 0; i < 160; i++) {
            if (f32(i) >= uniform.uMarch.x * 1.6 || t > t1 || T < 0.02) { break; }
            let p = ro + rd * t;
            let hf = (length(p - C) - R_EARTH - base) / (top - base);
            let d = density(p, hf, true);
            if (d > 0.0) {
                var od = 0.0;
                var lt = 0.0;
                var seg = 35.0;
                for (var j = 0; j < 6; j++) {
                    if (f32(j) >= uniform.uMarch.w) { break; }
                    let lp = p + uniform.uSunDir * (lt + seg * 0.5);
                    od += density(lp, (length(lp - C) - R_EARTH - base) / (top - base), false) * seg;
                    lt += seg;
                    seg *= 2.0;
                }
                let lowSun = 1.0 - smoothstep(0.17, 0.57, dot(uniform.uSunDir, normalize(p - C)));
                let K = mix(vec3f(1.0), vec3f(0.82, 1.0, 1.2), uniform.uLook.x * lowSun);
                var sun = vec3f(0.0);
                var a = 1.0;
                var b = 1.0;
                var c = 1.0;
                for (var o = 0; o < 3; o++) {
                    sun += a * mix(hg(cosT, 0.8 * c), hg(cosT, -0.25 * c), 0.25) * exp(-od * b * K);
                    a *= 0.5; b *= 0.35; c *= 0.5;
                }
                var powder = 1.0 - exp(-2.5 * d / uniform.uLayer.w);
                powder = mix(powder, 1.0, 0.5 + 0.5 * cosT);
                let pu = p + normalize(p - C) * uniform.uLook.z;
                let occ = exp(-density(pu, (length(pu - C) - R_EARTH - base) / (top - base), false) * uniform.uLook.z * 0.25);
                let amb = mix(uniform.uAmbBottom, uniform.uAmbTop * mix(1.0, occ, uniform.uLook.y), clamp(hf, 0.0, 1.0));
                let S = uniform.uSunColor * sun * 12.566371 * 2.2 * powder + amb * 0.65;
                let Td = exp(-d * dt);
                col += T * S * (1.0 - Td);
                dsum += t * T * (1.0 - Td);
                wsum += T * (1.0 - Td);
                T *= Td;
                t += dt;
            } else {
                t += dt * 1.6;
            }
        }
    }
    var depth = select(uniform.uMarch.y, dsum / max(wsum, 1e-6), wsum > 0.0);
    let fog = exp(-depth / 30000.0);
    col = mix(uniform.uHaze * (1.0 - T), col, fog);
    let edge = 1.0 - smoothstep(0.7 * uniform.uMarch.y, uniform.uMarch.y, depth);
    col *= edge;
    T = mix(1.0, T, edge);
    output.color = vec4f(col, T);
    return output;
}
`
);

// ---- lens flare ----------------------------------------------------------------------------------
const ELEMENTS = [
  [1, 0.55, 0, 1, [1, 0.92, 0.8], 0.55],
  [1, 0.42, 1, 1, [1, 0.95, 0.88], 0.5],
  [1, 0.05, 2, 34, [0.55, 0.7, 1], 0.35],
  [0.62, 0.06, 4, 1, [0.4, 1, 0.6], 0.16],
  [0.35, 0.11, 3, 1, [1, 0.65, 0.35], 0.1],
  [0.12, 0.04, 4, 1, [0.6, 0.6, 1], 0.2],
  [-0.22, 0.09, 4, 1, [0.9, 0.5, 1], 0.12],
  [-0.45, 0.18, 3, 1, [0.35, 0.75, 1], 0.07],
  [-0.7, 0.05, 3, 1, [1, 0.85, 0.4], 0.18],
  [-1, 0.36, 5, 1, [1, 1, 1], 0.1]
];
const N3 = ELEMENTS.length;
const FLARE_VS = (
  /* glsl */
  `
attribute vec3 vertex_position;      // the quad's corner (x, y in -1..1), the element (z)
uniform vec4 uEl[${N3}];              // along, size, shape, width
uniform vec4 uCol[${N3}];             // rgb, strength
uniform vec4 uSun;                   // the sun on screen (NDC x, y), the screen's aspect, the flare's strength
varying vec2 vQ;
varying vec4 vCol;
varying float vShape;
void main(void) {
    int i = int(vertex_position.z + 0.5);
    vec4 e = uEl[i];
    vec2 at = uSun.xy * e.x;
    vec2 size = vec2(e.y * e.w / uSun.z, e.y);
    vQ = vertex_position.xy;
    vCol = vec4(uCol[i].rgb, uCol[i].a * uSun.w);
    vShape = e.z;
    gl_Position = vec4(at + vertex_position.xy * size, 0.5, 1.0);
}
`
);
const FLARE_FS = (
  /* glsl */
  `
uniform vec4 uOcc;                   // the sun on screen (uv), its visibility (0..1), clouds on (1)
uniform vec4 uTint;                  // the sun's colour (low: warmer), the rays' turn
uniform sampler2D uCloudColor;       // the clouds' march: their transmittance in alpha
varying vec2 vQ;
varying vec4 vCol;
varying float vShape;

void main(void) {
    // how much of the sun the lens sees: the sky at its disc, through the clouds
    vec2 s = uOcc.xy;
    float vis = uOcc.z;
    if (uOcc.w > 0.5) vis *= texture2D(uCloudColor, s).a;
    if (vis < 0.002) discard;
    float d = length(vQ), a = 0.0;
    if (vShape < 0.5) a = exp(-d * d * 5.0) + 0.35 * exp(-d * 14.0);
    else if (vShape < 1.5) {
        float ang = atan(vQ.y, vQ.x) + uTint.w;
        a = (pow(abs(cos(ang * 3.0)), 60.0) + 0.6 * pow(abs(cos(ang * 5.0 + 0.4)), 90.0)) * exp(-d * 2.6) * (1.0 - smoothstep(0.8, 1.0, d));
    }
    else if (vShape < 2.5) a = exp(-vQ.y * vQ.y * 40.0) * pow(max(0.0, 1.0 - abs(vQ.x)), 3.0);
    else if (vShape < 3.5) a = smoothstep(1.0, 0.86, d) * (0.55 + 0.45 * smoothstep(0.55, 0.95, d));
    else if (vShape < 4.5) {
        vec2 q = abs(vQ);
        float h = max(q.x * 0.866 + q.y * 0.5, q.y);
        a = smoothstep(1.0, 0.9, h) * (0.6 + 0.4 * smoothstep(0.4, 0.95, h));
    }
    else {
        // the ring: a faint rainbow, red outside
        float w = exp(-pow((d - 0.86) * 16.0, 2.0));
        vec3 rb = clamp(vec3(1.0 - abs(d - 0.92) * 14.0, 1.0 - abs(d - 0.86) * 14.0, 1.0 - abs(d - 0.8) * 14.0), 0.0, 1.0);
        gl_FragColor = vec4(rb * w * vCol.a * vis * uTint.rgb, 0.0);
        return;
    }
    gl_FragColor = vec4(vCol.rgb * uTint.rgb * a * vCol.a * vis, 0.0);
}
`
);

// ---------------------------------------------------------------------------------------------
// The sky dome: gradient, sun, twilight, stars, and the clouds' march target composited over it.
// Drawn in the Skybox layer, behind everything: meshes hide it by depth, splats blend over it.
// ---------------------------------------------------------------------------------------------
const DOME_VS_GLSL = /* glsl */ `
attribute vec3 vertex_position;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec3 vDir;
varying vec4 vClip;
void main(void) {
    vDir = vertex_position;
    gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
    vClip = gl_Position;
}
`;
const DOME_VS_WGSL = /* wgsl */ `
attribute vertex_position: vec3f;
uniform matrix_model: mat4x4f;
uniform matrix_viewProjection: mat4x4f;
varying vDir: vec3f;
varying vClip: vec4f;
@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.vDir = input.vertex_position;
    output.position = uniform.matrix_viewProjection * uniform.matrix_model * vec4f(input.vertex_position, 1.0);
    output.vClip = output.position;
    return output;
}
`;
const DOME_FS_GLSL = /* glsl */ `
#include "tonemappingPS"
#include "gammaPS"
uniform vec3 uSunDir;          // toward the sun
uniform vec3 uSunColor;        // its light (linear), 0 at night
uniform vec4 uSky;             // day 0..1, twilight 0..1, night 0..1, sun disc on (1)
uniform vec4 uClouds;          // clouds on (1), -, the march target's texel (u, v)
uniform sampler2D uCloudColor; // the march: in-scattered light (rgb), transmittance (a)
varying vec3 vDir;
varying vec4 vClip;

float starHash(vec3 c) { return fract(sin(dot(c, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main(void) {
    vec3 d = normalize(vDir);
    float el = d.y;
    vec3 zen = mix(vec3(0.008, 0.017, 0.05), vec3(0.06, 0.19, 0.51), uSky.x);
    vec3 hor = mix(vec3(0.02, 0.036, 0.085), vec3(0.55, 0.67, 0.77), uSky.x);
    vec3 col = mix(hor, zen, pow(clamp(el, 0.0, 1.0), 0.45));
    col = mix(col, hor * 0.55, smoothstep(0.0, -0.25, el));
    float mu = max(dot(d, uSunDir), 0.0);
    // twilight: a warm band along the horizon, strongest toward the sun, a pink-violet one above it
    vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(0.0, 1e-4, 0.0));
    float toward = max(dot(normalize(vec3(d.x, 0.0, d.z) + vec3(0.0, 1e-4, 0.0)), sunFlat), 0.0);
    float band = exp(-max(el, 0.0) * 7.0) * smoothstep(-0.2, 0.02, el);
    col += vec3(1.0, 0.38, 0.1) * uSky.y * band * (0.12 + 0.88 * pow(toward, 3.0)) * 0.9;
    col += vec3(0.35, 0.18, 0.4) * uSky.y * exp(-abs(el - 0.25) * 5.0) * 0.12;
    // the sun's glow and disc
    col += uSunColor * (0.55 * pow(mu, 32.0) + 0.18 * pow(mu, 5.0));
    col += uSunColor * smoothstep(0.99996, 0.99999, mu) * 40.0 * uSky.w;
    // stars, fading in after dusk
    vec3 cell = floor(d * 280.0);
    float h = starHash(cell);
    if (h > 0.9975 && el > 0.0) {
        vec3 c = (cell + 0.5) / 280.0;
        float s = smoothstep(0.0022, 0.0, length(d - normalize(c)));
        col += vec3(0.9, 0.95, 1.0) * s * uSky.z * (h - 0.9975) * 900.0;
    }
    if (uClouds.x > 0.5) {
        vec2 uv = vClip.xy / vClip.w * 0.5 + 0.5, t = uClouds.zw * 0.75;
        // a tent over the low-resolution march: no stair-stepped cloud edges
        vec4 c = texture2D(uCloudColor, uv) * 0.4 + (texture2D(uCloudColor, uv + vec2(t.x, t.y)) + texture2D(uCloudColor, uv - vec2(t.x, t.y))
            + texture2D(uCloudColor, uv + vec2(t.x, -t.y)) + texture2D(uCloudColor, uv - vec2(t.x, -t.y))) * 0.15;
        col = col * c.a + c.rgb;
    }
    gl_FragColor = vec4(gammaCorrectOutput(toneMap(col)), 1.0);
}
`;
const DOME_FS_WGSL = /* wgsl */ `
#include "tonemappingPS"
#include "gammaPS"
uniform uSunDir: vec3f;
uniform uSunColor: vec3f;
uniform uSky: vec4f;
uniform uClouds: vec4f;
var uCloudColor: texture_2d<f32>;
var uCloudColorSampler: sampler;
varying vDir: vec3f;
varying vClip: vec4f;

fn starHash(c: vec3f) -> f32 { return fract(sin(dot(c, vec3f(12.9898, 78.233, 45.164))) * 43758.5453); }
@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let d = normalize(input.vDir);
    let el = d.y;
    let sky = uniform.uSky;
    let zen = mix(vec3f(0.008, 0.017, 0.05), vec3f(0.06, 0.19, 0.51), sky.x);
    let hor = mix(vec3f(0.02, 0.036, 0.085), vec3f(0.55, 0.67, 0.77), sky.x);
    var col = mix(hor, zen, pow(clamp(el, 0.0, 1.0), 0.45));
    col = mix(col, hor * 0.55, smoothstep(0.0, -0.25, el));
    let mu = max(dot(d, uniform.uSunDir), 0.0);
    let flatSun = normalize(vec3f(uniform.uSunDir.x, 0.0, uniform.uSunDir.z) + vec3f(0.0, 1e-4, 0.0));
    let toward = max(dot(normalize(vec3f(d.x, 0.0, d.z) + vec3f(0.0, 1e-4, 0.0)), flatSun), 0.0);
    let band = exp(-max(el, 0.0) * 7.0) * smoothstep(-0.2, 0.02, el);
    col += vec3f(1.0, 0.38, 0.1) * sky.y * band * (0.12 + 0.88 * pow(toward, 3.0)) * 0.9;
    col += vec3f(0.35, 0.18, 0.4) * sky.y * exp(-abs(el - 0.25) * 5.0) * 0.12;
    col += uniform.uSunColor * (0.55 * pow(mu, 32.0) + 0.18 * pow(mu, 5.0));
    col += uniform.uSunColor * smoothstep(0.99996, 0.99999, mu) * 40.0 * sky.w;
    let cell = floor(d * 280.0);
    let h = starHash(cell);
    if (h > 0.9975 && el > 0.0) {
        let c = (cell + 0.5) / 280.0;
        let s = smoothstep(0.0022, 0.0, length(d - normalize(c)));
        col += vec3f(0.9, 0.95, 1.0) * s * sky.z * (h - 0.9975) * 900.0;
    }
    if (uniform.uClouds.x > 0.5) {
        let ndc = input.vClip.xy / input.vClip.w;
        let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
        let t = uniform.uClouds.zw * 0.75;
        let c = textureSampleLevel(uCloudColor, uCloudColorSampler, uv, 0.0) * 0.4
            + (textureSampleLevel(uCloudColor, uCloudColorSampler, uv + vec2f(t.x, t.y), 0.0) + textureSampleLevel(uCloudColor, uCloudColorSampler, uv - vec2f(t.x, t.y), 0.0)
            + textureSampleLevel(uCloudColor, uCloudColorSampler, uv + vec2f(t.x, -t.y), 0.0) + textureSampleLevel(uCloudColor, uCloudColorSampler, uv - vec2f(t.x, -t.y), 0.0)) * 0.15;
        col = col * c.a + c.rgb;
    }
    output.color = vec4f(gammaCorrectOutput(toneMap(col)), 1.0);
    return output;
}
`;

const QUALITY = { Low: { scale: 0.25, steps: 36, lightSteps: 3 }, Medium: { scale: 0.33, steps: 48, lightSteps: 4 }, High: { scale: 0.45, steps: 64, lightSteps: 5 } };
const LAT = 45 * Math.PI / 180, DEC = 12 * Math.PI / 180;   // a mid-latitude spring day: sunrise ~5:15, sunset ~18:45
const UP = new pc.Vec3(0, 1, 0);

export class TimeOfDaySky extends ArrivalScript {
    static scriptName = "Time of Day Sky";

    timeOfDay = 18;
    dayLengthMinutes = 0;
    sunHeading = 0;
    sunIntensity = 1.6;
    clouds = "Few";
    cloudBase = 1500;
    windSpeed = 8;
    windFrom = 250;
    cloudQuality = "Auto";
    sunFlare = true;

    static properties = {
        timeOfDay: { title: "Time of day (hours, 0-24)", min: 0, max: 24, step: 0.25 },
        dayLengthMinutes: { title: "Day cycle length (minutes, 0: the time stands still)", min: 0, max: 120, step: 1 },
        sunHeading: { title: "Where the sun stands at noon (degrees around the space)", min: 0, max: 360, step: 1 },
        sunIntensity: { title: "Sunlight strength at noon", min: 0, max: 5, step: 0.1 },
        clouds: { title: "Clouds", options: Object.keys(CLOUD_PRESETS) },
        cloudBase: { title: "Cloud base (m above the ground)", min: 200, max: 6000, step: 50 },
        windSpeed: { title: "Wind: cloud drift (m/s)", min: 0, max: 40, step: 1 },
        windFrom: { title: "Wind from (degrees)", min: 0, max: 359, step: 1 },
        cloudQuality: { title: "Cloud quality (Auto: Low on phones)", options: ["Auto", ...Object.keys(QUALITY)] },
        sunFlare: { title: "Lens flare when looking into the sun" },
    };

    initialize() {
        const app = this.app;
        const dev = app.graphicsDevice;
        this._ctc = app.customTravelCenter;
        this._envBase = this._ctc.envLightFinal ?? app.scene.skyboxIntensity;
        this._sun = new pc.Vec3();
        this._q = new pc.Quat();
        this._col = new pc.Color();
        this._wind = [0, 0];
        this._time = 0;
        this._frame = 0;
        this._shade = 1;
        this._flareVis = 0;
        this._flareCheck = 0;

        ArrivalSpace.setSkyboxHidden(true);

        // the dome
        const mesh = this._domeMesh = pc.Mesh.fromGeometry(dev, new pc.SphereGeometry({ radius: 1, latitudeBands: 24, longitudeBands: 48 }));
        const dm = this._domeMat = new pc.ShaderMaterial({
            uniqueName: "time-of-day-sky-dome",
            attributes: { vertex_position: pc.SEMANTIC_POSITION },
            vertexGLSL: DOME_VS_GLSL, fragmentGLSL: DOME_FS_GLSL,
            vertexWGSL: DOME_VS_WGSL, fragmentWGSL: DOME_FS_WGSL,
        });
        dm.cull = pc.CULLFACE_FRONT;
        dm.depthWrite = false;
        dm.update();
        const mi = new pc.MeshInstance(mesh, dm);
        mi.cull = false;
        this._dome = new pc.Entity("TimeOfDaySkyDome");
        this._dome.addComponent("render", { meshInstances: [mi], layers: [pc.LAYERID_SKYBOX], castShadows: false, receiveShadows: false });
        app.root.addChild(this._dome);

        // the clouds: a low-resolution march into a target the dome samples
        this._cloudLayer = new pc.Layer({ name: "TimeOfDayClouds" });
        app.scene.layers.push(this._cloudLayer);
        const cm = this._marchMat = new pc.ShaderMaterial({
            uniqueName: "time-of-day-sky-clouds",
            attributes: { vertex_position: pc.SEMANTIC_POSITION },
            vertexGLSL: MARCH_VS_GLSL, fragmentGLSL: MARCH_FS_GLSL,
            vertexWGSL: MARCH_VS_WGSL, fragmentWGSL: MARCH_FS_WGSL,
        });
        cm.depthTest = false;
        cm.depthWrite = false;
        cm.cull = pc.CULLFACE_NONE;
        cm.update();
        this._triMesh = new pc.Mesh(dev);
        this._triMesh.setPositions(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]));
        this._triMesh.setIndices(new Uint16Array([0, 1, 2]));
        this._triMesh.update(pc.PRIMITIVE_TRIANGLES);
        const tri = new pc.MeshInstance(this._triMesh, cm);
        tri.cull = false;
        this._march = new pc.Entity("TimeOfDayCloudMarch");
        this._march.addComponent("render", { meshInstances: [tri], layers: [this._cloudLayer.id], castShadows: false, receiveShadows: false });
        app.root.addChild(this._march);
        this._marchCam = new pc.Entity("TimeOfDayCloudCamera");
        this._marchCam.addComponent("camera", {
            layers: [this._cloudLayer.id], priority: -50, clearColor: new pc.Color(0, 0, 0, 1),
            clearColorBuffer: true, clearDepthBuffer: false, clearStencilBuffer: false, frustumCulling: false,
        });
        app.root.addChild(this._marchCam);
        this._cloudsReady = false;

        this._flare = dev.isWebGPU ? null : this._createFlare();
        this._applyClouds();
        this._onPrerender = () => this._prerender();
        app.on("prerender", this._onPrerender);
    }

    /** The noise volumes (about a second of CPU, more on a phone), a few milliseconds per frame. */
    *_buildNoise() {
        const N = 64, shape = new Uint8Array(N * N * N * 4);
        yield* shapeSlices(shape, N, 0, N);
        const detail = yield* detailNoise();
        const weather = yield* weatherMap();
        this._noiseReady({ size: N, data: shape }, detail, weather);
    }

    _noiseReady(shape, detail, weather) {
        const dev = this.app.graphicsDevice;
        const vol = (n, data) => new pc.Texture(dev, {
            width: n, height: n, depth: n, volume: true, format: pc.PIXELFORMAT_RGBA8, mipmaps: false,
            minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, addressW: pc.ADDRESS_REPEAT, levels: [data],
        });
        this._shape = shape;
        this._weather = weather;
        this._shapeTex = vol(shape.size, shape.data);
        this._detailTex = vol(detail.size, detail.data);
        this._weatherTex = new pc.Texture(dev, {
            width: weather.size, height: weather.size, format: pc.PIXELFORMAT_RGBA8, mipmaps: true,
            addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, levels: [weather.data],
        });
        this._marchMat.setParameter("uShape", this._shapeTex);
        this._marchMat.setParameter("uDetail", this._detailTex);
        this._marchMat.setParameter("uWeather", this._weatherTex);
        this._cloudsReady = true;
        this._fade = 0;
        this._applyClouds();
    }

    _applyClouds() {
        this._preset = CLOUD_PRESETS[this.clouds] || null;
        const q = QUALITY[this.cloudQuality] || (this.isMobile ? QUALITY.Low : QUALITY.Medium);
        this._quality = q;
        if (this._preset && !this._cloudsReady) this._noiseJob ??= this._buildNoise();
        const on = !!this._preset && this._cloudsReady && !this.app.xr?.active;
        this._cloudsOn = on;
        this._march.enabled = on;
        this._marchCam.enabled = on;
    }

    onPropertyChanged(name) {
        if (name === "clouds" || name === "cloudQuality") this._applyClouds();
    }

    /** The hour now: the set time, or with a day cycle the same moment for every visitor (it runs on the clock). */
    _hour() {
        if (!(this.dayLengthMinutes > 0)) return this.timeOfDay;
        const cycleMs = this.dayLengthMinutes * 60000;
        return (this.timeOfDay + (Date.now() % cycleMs) / cycleMs * 24) % 24;
    }

    /** Toward the sun (world, y up) for an hour of the day; noon's sun stands at sunHeading. */
    _sunAt(hour, out) {
        const H = (hour - 12) / 24 * Math.PI * 2;
        const east = -Math.cos(DEC) * Math.sin(H);
        const north = Math.cos(LAT) * Math.sin(DEC) - Math.sin(LAT) * Math.cos(DEC) * Math.cos(H);
        const up = Math.sin(LAT) * Math.sin(DEC) + Math.cos(LAT) * Math.cos(DEC) * Math.cos(H);
        const a = this.sunHeading * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        // north is -z, east +x; then turned about y so noon's sun (south, +z) points to sunHeading
        const x = east, z = -north;
        return out.set(x * c + z * s, up, -x * s + z * c).normalize();
    }

    update(dt) {
        this._dt = dt;
        this._time += dt;
        if (this._noiseJob) {
            const t0 = performance.now();
            for (let i = 1; ; i++) {
                if (this._noiseJob.next().done) {
                    this._noiseJob = null;
                    break;
                }
                if (!(i & 63) && performance.now() - t0 > 4) break;
            }
        }
        this._fade = Math.min(1, (this._fade ?? 0) + dt / 4);
        this._frame = (this._frame + 1) % 64;
        const w = this.windFrom * Math.PI / 180;
        // the clouds drift downwind (windFrom 0: from -z, 90: from +x); the noise moves against them
        this._wind[0] += Math.sin(w) * this.windSpeed * dt;
        this._wind[1] -= Math.cos(w) * this.windSpeed * dt;
        if (!!this.app.xr?.active !== this._xr) {
            this._xr = !!this.app.xr?.active;
            this._applyClouds();
        }
        this._light(dt);
    }

    /** The room's main light becomes the sun (or the moon), the sky image's light follows the day. */
    _light(dt) {
        const sun = this._sunAt(this._hour(), this._sun);
        const ctc = this._ctc;
        const dir = ctc.getPrimaryLightEntity({ stageLightType: "directional" });
        const point = ctc.getPrimaryLightEntity({});
        if (point.enabled) point.enabled = false;
        if (!dir.enabled) dir.enabled = true;
        const up = sun.y;
        const day = smooth2(-0.04, 0.2, up);
        const night = smooth2(0.04, 0.2, -up);
        // a cloud between the player and the sun dims it (sampled where the sun's ray crosses the layer)
        let shade = 1;
        if (this._cloudsOn && up > 0.02) {
            const p = ArrivalSpace.getPlayer()?.getPosition() || this._dome.getPosition();
            const ws = this.app.worldScale || 1;
            const mid = this.cloudBase + this._preset.depth * 0.4;
            const k = mid / up;
            shade = 1 - 0.7 * cloudColumn(this._weather, this._shape, { coverage: this._preset.coverage * this._fade, base: this.cloudBase, depth: this._preset.depth },
                this._wind, p.x / ws + sun.x * k, p.z / ws + sun.z * k);
        }
        this._shade += (shade - this._shade) * Math.min(1, dt * 1.5);
        const L = dir.light;
        if (up > -0.04) {
            const t = sunTint(up);
            L.color = this._col.set(t[0], t[1], t[2]);
            L.intensity = this.sunIntensity * day * this._shade;
            this._q.setFromDirections(UP, sun);
        } else {
            L.color = this._col.set(0.55, 0.66, 1);
            L.intensity = this.sunIntensity * 0.16 * night;
            const m = new pc.Vec3(-sun.x, Math.max(0.5, -sun.y), -sun.z).normalize();
            this._q.setFromDirections(UP, m);
        }
        dir.setRotation(this._q);
        this.app.scene.skyboxIntensity = this._envBase * (0.1 + 0.9 * smooth2(-0.12, 0.25, up)) * (0.75 + 0.25 * this._shade);
    }

    /** After everything moved: the dome round the camera, the march's matrices and light, the flare. */
    _prerender() {
        const cam = ArrivalSpace.getCamera();
        const cc = cam.camera;
        const p = cam.getPosition();
        const r = cc.farClip * 0.9;
        this._dome.setPosition(p);
        this._dome.setLocalScale(r, r, r);
        const sun = this._sun;
        const sky = skyLight(sun.y);
        const sunUp = sun.y;
        const day = smooth2(-0.12, 0.15, sunUp);
        const twilight = smooth2(-0.22, -0.02, sunUp) * (1 - smooth2(0.02, 0.3, sunUp));
        const dm = this._domeMat;
        dm.setParameter("uSunDir", [sun.x, sun.y, sun.z]);
        dm.setParameter("uSunColor", sky.sun);
        dm.setParameter("uSky", [day, twilight, 1 - smooth2(-0.2, -0.05, sunUp), sunUp > -0.03 ? 1 : 0]);
        dm.setParameter("uClouds", [this._cloudsOn ? 1 : 0, 0, this._rt ? 1 / this._rt.width : 0, this._rt ? 1 / this._rt.height : 0]);
        if (this._cloudsOn) this._marchUpdate(cam, sky);
        if (this._flare) this._flareUpdate(cam);
    }

    _marchUpdate(cam, sky) {
        const dev = this.app.graphicsDevice;
        const q = this._quality;
        const w = Math.max(16, Math.round(dev.width * q.scale)), h = Math.max(16, Math.round(dev.height * q.scale));
        if (!this._rt || this._rt.width !== w || this._rt.height !== h) {
            this._rt?.destroy();
            this._cloudTex?.destroy();
            this._cloudTex = new pc.Texture(dev, {
                name: "time-of-day-clouds", width: w, height: h,
                format: dev.textureHalfFloatRenderable ? pc.PIXELFORMAT_RGBA16F : pc.PIXELFORMAT_RGBA8, mipmaps: false,
                minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
            });
            this._rt = new pc.RenderTarget({ colorBuffer: this._cloudTex, depth: false });
            this._marchCam.camera.renderTarget = this._rt;
            this._domeMat.setParameter("uCloudColor", this._cloudTex);
            this._flareMat?.setParameter("uCloudColor", this._cloudTex);
        }
        const camWorld = cam.getPosition();
        const view = new pc.Mat4().copy(cam.getWorldTransform()).invert();
        const inv = new pc.Mat4().mul2(cam.camera.projectionMatrix, view).invert();
        const ws = this.app.worldScale || 1;
        const sun = this._sun;
        const p = this._preset;
        const m = this._marchMat;
        const night = 0.45 + 0.55 * smooth2(-0.15, 0.05, sun.y);
        const dim = (c) => c.map((v) => v * night);
        m.setParameter("uInvViewProj", inv.data);
        m.setParameter("uCamWorld", [camWorld.x, camWorld.y, camWorld.z]);
        m.setParameter("uCamPos", [camWorld.x / ws, camWorld.y / ws, camWorld.z / ws]);
        m.setParameter("uSunDir", [sun.x, sun.y, sun.z]);
        m.setParameter("uSunColor", sky.sun);
        m.setParameter("uAmbTop", dim(sky.top));
        m.setParameter("uAmbBottom", dim(sky.bottom));
        m.setParameter("uHaze", dim(sky.haze));
        m.setParameter("uLayer", [this.cloudBase, this.cloudBase + p.depth, p.coverage * this._fade, 0.045]);
        m.setParameter("uWind", [this._wind[0], this._wind[1], this._time, 0]);
        m.setParameter("uMarch", [q.steps, 6e4, this._frame, q.lightSteps]);
        m.setParameter("uLook", [1, 0.85, 300, 0]);
    }

    // ---- lens flare: an occlusion probe along the sun's ray (colliders) a few times a second -------------
    _createFlare() {
        const n = ELEMENTS.length, pos = [], idx = [];
        for (let i = 0; i < n; i++) {
            const k = pos.length / 3;
            pos.push(-1, -1, i, 1, -1, i, 1, 1, i, -1, 1, i);
            idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
        }
        const mesh = this._flareMesh = new pc.Mesh(this.app.graphicsDevice);
        mesh.setPositions(pos);
        mesh.setIndices(idx);
        mesh.update(pc.PRIMITIVE_TRIANGLES);
        const m = this._flareMat = new pc.ShaderMaterial({
            uniqueName: "time-of-day-sky-flare",
            attributes: { vertex_position: pc.SEMANTIC_POSITION },
            vertexGLSL: FLARE_VS, fragmentGLSL: FLARE_FS,
        });
        m.blendType = pc.BLEND_ADDITIVE;
        m.depthTest = false;
        m.depthWrite = false;
        m.cull = pc.CULLFACE_NONE;
        m.update();
        const el = new Float32Array(n * 4), col = new Float32Array(n * 4);
        ELEMENTS.forEach(([along, size, shape, width, rgb, k], i) => {
            el.set([along, size, shape, width], i * 4);
            col.set([rgb[0], rgb[1], rgb[2], k], i * 4);
        });
        m.setParameter("uEl[0]", el);
        m.setParameter("uCol[0]", col);
        m.setParameter("uCloudColor", this._blank = new pc.Texture(this.app.graphicsDevice, {
            width: 1, height: 1, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, levels: [new Uint8Array([0, 0, 0, 255])],
        }));
        const mi = new pc.MeshInstance(mesh, m);
        mi.cull = false;
        mi.calculateSortDistance = () => -1e7;
        const e = new pc.Entity("TimeOfDaySunFlare");
        e.addComponent("render", { meshInstances: [mi], layers: [pc.LAYERID_WORLD], castShadows: false, receiveShadows: false });
        e.enabled = false;
        this.app.root.addChild(e);
        this._p = new pc.Vec3();
        this._v = new pc.Vec3();
        return e;
    }

    _flareUpdate(cam) {
        const sun = this._sun;
        const fwd = cam.forward;
        let on = this.sunFlare && sun.y > -0.02 && fwd.x * sun.x + fwd.y * sun.y + fwd.z * sun.z > 0.05;
        let ndc = null;
        if (on) {
            const cp = cam.getPosition();
            const far = cam.camera.farClip * 0.5;
            this._p.set(cp.x + sun.x * far, cp.y + sun.y * far, cp.z + sun.z * far);
            const sc = cam.camera.worldToScreen(this._p, this._v);
            const gd = this.app.graphicsDevice, cw = gd.canvas.clientWidth || gd.width, ch = gd.canvas.clientHeight || gd.height;
            ndc = [sc.x / cw * 2 - 1, 1 - sc.y / ch * 2];
            on = Math.max(Math.abs(ndc[0]), Math.abs(ndc[1])) < 1.25;
        }
        if (on && (this._flareCheck -= this._dt || 0) <= 0) {
            this._flareCheck = 0.2;
            this._flareHit = !!ArrivalSpace.raycastPhysics(cam.getPosition(), sun, 2000);
        }
        this._flareVis += ((on && !this._flareHit ? 1 : 0) - this._flareVis) * 0.2;
        const show = this._flareVis > 0.01 && !!ndc;
        if (this._flare.enabled !== show) this._flare.enabled = show;
        if (!show) return;
        const out = Math.max(Math.abs(ndc[0]), Math.abs(ndc[1]));
        const edge = Math.min(1, Math.max(0, (1.25 - out) / 0.3));
        const centre = 0.75 + 0.25 * Math.max(0, 1 - Math.hypot(ndc[0], ndc[1]));
        const gd = this.app.graphicsDevice;
        const up = Math.min(1, Math.max(0, sun.y / 0.3));
        const m = this._flareMat;
        m.setParameter("uSun", [ndc[0], ndc[1], gd.width / Math.max(1, gd.height), 0.8 * edge * centre * this._flareVis]);
        m.setParameter("uOcc", [ndc[0] * 0.5 + 0.5, ndc[1] * 0.5 + 0.5, 1, this._cloudsOn ? 1 : 0]);
        m.setParameter("uTint", [1, 0.62 + 0.36 * up, 0.38 + 0.55 * up, ndc[0] * 0.6 + ndc[1] * 0.3]);
    }

    destroy() {
        const app = this.app;
        app.off("prerender", this._onPrerender);
        ArrivalSpace.setSkyboxHidden(null);
        this._ctc.updateStageLight(this._ctc.roomData || {});
        app.scene.skyboxIntensity = this._ctc.envLightFinal ?? this._envBase;
        for (const e of [this._dome, this._march, this._marchCam, this._flare]) e?.destroy();
        app.scene.layers.remove(this._cloudLayer);
        this._rt?.destroy();
        for (const t of [this._cloudTex, this._shapeTex, this._detailTex, this._weatherTex, this._blank]) t?.destroy();
        for (const m of [this._domeMesh, this._triMesh, this._flareMesh]) m?.destroy();
        for (const m of [this._domeMat, this._marchMat, this._flareMat]) m?.destroy();
    }
}
