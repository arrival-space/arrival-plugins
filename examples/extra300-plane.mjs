/**
 * Extra 300 Plane — an aerobatic airplane parked where you place it. Walk up and press E (or click
 * it) to climb in, then fly it round your space: no airfield, no scenery, just the airplane over
 * whatever the space is. It rolls, lands and stops on the space's own collision (its floor, its
 * collision mesh); fly off the edge and it falls, Backspace puts it back on its spot.
 *
 * Controls: R / F throttle (the engine starts on the first throttle), W / S pitch, A / D roll,
 * Q / E rudder, B brakes, L easy mode, V cockpit / chase / tower / fly-by view, mouse drag looks
 * round, wheel zooms, Backspace back to the start, Esc (or E standing still) gets out. A gamepad
 * works too: left stick flies, right stick rudder and throttle. Take-off: hold R, at about 60 kt
 * ease back on S.
 *
 * Easy mode (on by default) keeps the wing from stalling and holds the attitude when you let go.
 * Other visitors see your airplane where your avatar sits in it.
 *
 * Features demonstrated:
 * - a 480 Hz rigid-body flight model (aerodynamic strips, propeller, engine, sprung gear) driven by the frame
 * - ArrivalSpace.raycastPhysics as the ground: one ray a frame under the airplane, a plane fitted
 *   to its hit and normal for the sim's sub-steps, and a ray ahead that ends the flight at a wall
 * - ArrivalSpace.attachPlayerToEntity with a named mount child: the avatar in the seat, and the
 *   other clients' airplanes posed round their avatars from the controls sent with it (extra)
 * - ArrivalSpace.onEntityClick on the airplane, lockKeyboard while flying, setCameraMode("free")
 *   with the camera posed every frame, kinematic box colliders so a parked airplane is solid
 * - Web Audio engine sound driven by rpm, power and airspeed
 *
 * Built from the Flight Simulator space's sim (the Extra 300L's modules), with this file's own entry
 * class at the end. The airplane's mesh (540 KB) is fetched from EXTRA300L_MODEL_URL: plugins are
 * limited to 500 KB. Requires ArrivalSpace.VERSION >= 1.27.0.
 */

// src/math/vec3.js
var set = (out, x, y, z) => {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
};
var add = (a, b, out = [0, 0, 0]) => set(out, a[0] + b[0], a[1] + b[1], a[2] + b[2]);
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross = (a, b, out = [0, 0, 0]) => set(out, a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
var length = (a) => Math.hypot(a[0], a[1], a[2]);
function inertiaMul(I, w, out = [0, 0, 0]) {
  const { xx, yy, zz, xz = 0 } = I;
  return set(out, xx * w[0] - xz * w[2], yy * w[1], zz * w[2] - xz * w[0]);
}
function inertiaSolve(I, b, out = [0, 0, 0]) {
  const { xx, yy, zz, xz = 0 } = I;
  const det = xx * zz - xz * xz;
  return set(out, (zz * b[0] + xz * b[2]) / det, b[1] / yy, (xx * b[2] + xz * b[0]) / det);
}

// src/math/quat.js
function qMul(a, b, out = [0, 0, 0, 0]) {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  out[0] = aw * bw - ax * bx - ay * by - az * bz;
  out[1] = aw * bx + ax * bw + ay * bz - az * by;
  out[2] = aw * by - ax * bz + ay * bw + az * bx;
  out[3] = aw * bz + ax * by - ay * bx + az * bw;
  return out;
}
function qNormalize(q, out = q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  out[0] = q[0] / l;
  out[1] = q[1] / l;
  out[2] = q[2] / l;
  out[3] = q[3] / l;
  return out;
}
function qRotate(q, v, out = [0, 0, 0]) {
  const [w, x, y, z] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return set(out, vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx));
}
function qRotateInv(q, v, out = [0, 0, 0]) {
  return qRotate([q[0], -q[1], -q[2], -q[3]], v, out);
}
function qFromEuler(phi, theta, psi) {
  const cr = Math.cos(phi / 2), sr = Math.sin(phi / 2);
  const cp = Math.cos(theta / 2), sp = Math.sin(theta / 2);
  const cy = Math.cos(psi / 2), sy = Math.sin(psi / 2);
  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy
  ];
}
function qToEuler(q) {
  const [w, x, y, z] = q;
  const phi = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const s = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  const theta = Math.asin(s);
  let psi = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  if (psi < 0) psi += 2 * Math.PI;
  return { phi, theta, psi };
}
function qIntegrate(q, w, dt, out = q) {
  const wl = Math.hypot(w[0], w[1], w[2]);
  if (wl < 1e-12) {
    if (out !== q) {
      out[0] = q[0];
      out[1] = q[1];
      out[2] = q[2];
      out[3] = q[3];
    }
    return out;
  }
  const half = 0.5 * wl * dt;
  const s = Math.sin(half) / wl;
  const dq = [Math.cos(half), w[0] * s, w[1] * s, w[2] * s];
  qMul(q, dq, out);
  return qNormalize(out);
}

// src/sim/units.js
var G0 = 9.80665;
var KT = 0.514444;
var FT = 0.3048;
var FPM = FT / 60;
var HP = 745.7;
var INHG = 3386.39;
var DEG = Math.PI / 180;
var RPM = 2 * Math.PI / 60;
var clamp = (x, a, b) => x < a ? a : x > b ? b : x;
var lerp = (a, b, t) => a + (b - a) * t;
function table1(tbl, x) {
  if (x <= tbl[0][0]) return tbl[0][1];
  for (let i = 1; i < tbl.length; i++) {
    if (x <= tbl[i][0]) {
      const [x0, y0] = tbl[i - 1];
      const [x1, y1] = tbl[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return tbl[tbl.length - 1][1];
}
var lag = (value, target, tau, dt) => tau <= 0 ? target : target + (value - target) * Math.exp(-dt / tau);

// src/sim/aero.js
var FLAT_PLATE_CL = 1.15;
var FLAT_PLATE_CD = 1.95;
function flapTau(cf) {
  const th = Math.acos(2 * cf - 1);
  return 1 - (th - Math.sin(th)) / Math.PI;
}
function deflectionEfficiency(delta) {
  const d = Math.abs(delta);
  return d <= 10 * DEG ? 1 : 1 - 0.4 * clamp((d - 10 * DEG) / (25 * DEG), 0, 1);
}
var smooth = (t) => t * t * (3 - 2 * t);
function clForward(x, a, stall, lossFrac = 0.22, width = 4 * DEG) {
  const clmax = a * stall;
  if (x <= stall) return a * x;
  if (x <= stall + width) return clmax * (1 - lossFrac * ((x - stall) / width));
  const fp = FLAT_PLATE_CL * Math.sin(2 * x);
  const end = Math.max(40 * DEG, stall + width + 10 * DEG);
  const t = smooth(clamp((x - stall - width) / (end - stall - width), 0, 1));
  return (1 - lossFrac) * clmax * (1 - t) + fp * t;
}
function sectionCoefficients(alpha, g, groundFactor = 1) {
  let al = alpha;
  while (al > Math.PI) al -= 2 * Math.PI;
  while (al <= -Math.PI) al += 2 * Math.PI;
  const s = al < 0 ? -1 : 1;
  const x = Math.abs(al);
  let cl;
  let stalled;
  if (x <= Math.PI / 2) {
    cl = s * clForward(x, g.a, g.stall, g.stallDrop, g.stallWidth);
    stalled = x > g.stall;
  } else {
    cl = -s * clForward(Math.PI - x, g.a * 0.7, g.stall * 0.75);
    stalled = Math.PI - x > g.stall * 0.75;
  }
  const induced = cl * cl / (Math.PI * g.e * g.aspect) * groundFactor;
  const plate = FLAT_PLATE_CD * Math.sin(x) ** 2;
  let cd = g.cd0 + induced;
  if (stalled || x > Math.PI / 2) cd = Math.max(cd, g.cd0 + plate);
  return { cl, cd, stalled };
}
function groundEffectFactor(h, span4) {
  if (!(h > 0)) return 0;
  if (h > 2 * span4) return 1;
  const r = 16 * h / span4;
  return r * r / (1 + r * r);
}
function controlDeflection(st, controls, rigging) {
  if (!st.control) return 0;
  let input = (controls[st.control.input] || 0) + (rigging?.[st.control.input] || 0);
  if (st.control.input === "elevator") input += 0.35 * (controls.elevatorTrim || 0);
  if (st.control.mix) for (const m of st.control.mix) input += m.gain * (controls[m.input] || 0);
  return st.control.sign * clamp(input, -1, 1) * st.control.maxDefl;
}
var Aero = class {
  /** @param {object} ac  aircraft data, e.g. EXTRA_300L from aircraft/extra300l.js */
  constructor(ac) {
    this.ac = ac;
    this.eps = 0;
    this.alphaBody = 0;
    this.betaBody = 0;
    this.strips = ac.aero.surfaces.map((s) => ({
      ...s,
      tau: s.control ? flapTau(s.control.chordFrac) : 0,
      // inner wing strips sit in the slipstream
      propwash: s.propwash ?? (ac.prop && s.group === "wing" && Math.abs(s.pos[1]) < ac.prop.diameter / 2 * 0.9 ? 0.55 : 0),
      out: { alpha: 0, cl: 0, stalled: false, q: 0 },
      deflection: 0
    }));
  }
  /**
   * @param {object} p
   * @param {number[]} p.vAir   aircraft velocity through the air, body axes (m/s)
   * @param {number[]} p.omega  body rates (rad/s)
   * @param {number[]} p.cg     CG relative to the reference point (m)
   * @param {number} p.rho
   * @param {{aileron:number, elevator:number, rudder:number, elevatorTrim?:number}} p.controls
   * @param {{dv:number, swirl:number, rot:number}} p.slip  slipstream axial increment & swirl at the tail
   * @param {number} p.hWing   wing height above ground (m), Infinity in the air
   * @param {number} [p.mach]  flight Mach number (the jet's compressibility tables; the Extra never notices)
   * @param {number} p.dt
   * @returns {{ force: number[], moment: number[] }} body axes, about the CG
   */
  compute({ vAir, omega, cg, rho, controls, slip, hWing = Infinity, mach = 0, dt }) {
    const F3 = [0, 0, 0];
    const M = [0, 0, 0];
    const V = length(vAir);
    const gd = this.ac.aero.groupData;
    const mt = this.ac.aero.mach;
    const liftK = mt ? table1(mt.lift, mach) : 1;
    const dragK = mt ? table1(mt.drag, mach) : 1;
    this.alphaBody = vAir[0] > 0.1 ? Math.atan2(vAir[2], vAir[0]) : 0;
    this.betaBody = V > 0.1 ? Math.asin(clamp(vAir[1] / V, -1, 1)) : 0;
    const tailArm = 4;
    const aw = clamp(this.alphaBody, -gd.wing.stall, gd.wing.stall);
    this.eps = lag(this.eps, this.ac.aero.downwash.deda * aw, V > 1 ? tailArm / V : 0.5, dt);
    const ge = groundEffectFactor(hWing, this.ac.wing.span);
    const r = [0, 0, 0];
    const u = [0, 0, 0];
    const tmp = [0, 0, 0];
    const slats = this.ac.aero.slats;
    for (const st of this.strips) {
      const g = gd[st.group];
      r[0] = st.pos[0] - cg[0];
      r[1] = st.pos[1] - cg[1];
      r[2] = st.pos[2] - cg[2];
      cross(omega, r, u);
      u[0] += vAir[0];
      u[1] += vAir[1];
      u[2] += vAir[2];
      if (st.propwash && slip) u[0] += st.propwash * slip.dv;
      if (st.swirl && slip) u[1] -= slip.rot * slip.swirl;
      const us = dot(u, st.span);
      u[0] -= us * st.span[0];
      u[1] -= us * st.span[1];
      u[2] -= us * st.span[2];
      const Vp = length(u);
      const delta = controlDeflection(st, controls, this.ac.rigging);
      st.deflection = delta;
      if (Vp < 0.05) {
        st.out.q = 0;
        continue;
      }
      let alpha = Math.atan2(-dot(u, st.normal), u[0]) + (st.incidence || 0);
      if (st.downwash) alpha -= this.eps;
      const eff = st.control?.allMoving ? 1 : deflectionEfficiency(delta);
      const alphaEff = alpha + st.tau * eff * delta;
      let flapStall = st.control?.clmaxGain && delta > 0 ? st.control.clmaxGain * st.tau * eff * delta : 0;
      if (slats && st.group === "wing") flapStall += slats.stall * (controls.flaps || 0);
      const gs = mt || flapStall ? { ...g, a: g.a * liftK, cd0: g.cd0 * dragK, stall: g.stall + flapStall } : g;
      const sc = sectionCoefficients(alphaEff, gs, st.group === "wing" ? ge : 1);
      const { cl, cd, stalled } = sc;
      const q = 0.5 * rho * Vp * Vp;
      const qS = q * st.area;
      cross(st.span, u, tmp);
      const tl = length(tmp) || 1;
      const L2 = qS * cl / tl;
      const D = -qS * cd / Vp;
      const fx = L2 * tmp[0] + D * u[0];
      const fy = L2 * tmp[1] + D * u[1];
      const fz = L2 * tmp[2] + D * u[2];
      let cpShift = stalled ? -0.18 * st.chord * clamp((Math.abs(alphaEff) - g.stall) / (25 * DEG), 0, 1) : 0;
      if (st.control?.cpAft && delta > 0) cpShift -= st.control.cpAft * st.chord * (delta / st.control.maxDefl);
      const rx = r[0] + cpShift;
      F3[0] += fx;
      F3[1] += fy;
      F3[2] += fz;
      M[0] += r[1] * fz - r[2] * fy;
      M[1] += r[2] * fx - rx * fz;
      M[2] += rx * fy - r[1] * fx;
      st.out.alpha = alphaEff;
      st.out.cl = cl;
      st.out.stalled = stalled;
      st.out.q = q;
    }
    const b = this.ac.aero.body;
    if (V > 0.05) {
      const q = 0.5 * rho * V * V;
      const sa = vAir[1] / V;
      const sz = vAir[2] / V;
      const ca = Math.abs(vAir[0]) / V;
      const Y = -q * b.sideArea * (b.sideSlope * sa * ca + 1.1 * sa * Math.abs(sa));
      const Z = -q * b.topArea * (b.topSlope * sz * ca + 1.1 * sz * Math.abs(sz));
      const extra = (b.gearDragArea || 0) * (controls.gearPos ?? 1) + (b.speedbrakeDragArea || 0) * (controls.speedbrakePos || 0) + (b.sfoilDragArea || 0) * (controls.sfoilPos || 0);
      const Dk = -q * (b.dragArea * dragK + extra) / V;
      const fx = Dk * vAir[0];
      const fy = Dk * vAir[1] + Y;
      const fz = Dk * vAir[2] + Z;
      r[0] = b.pos[0] - cg[0];
      r[1] = b.pos[1] - cg[1];
      r[2] = b.pos[2] - cg[2];
      F3[0] += fx;
      F3[1] += fy;
      F3[2] += fz;
      M[0] += r[1] * fz - r[2] * fy;
      M[1] += r[2] * fx - r[0] * fz;
      M[2] += r[0] * fy - r[1] * fx;
    }
    return { force: F3, moment: M };
  }
  /** Highest fraction of wing strips that are stalled (0..1) — for the buffet and stall horn. */
  wingStallFraction() {
    let n = 0, s = 0;
    for (const st of this.strips) if (st.group === "wing") {
      n++;
      if (st.out.stalled) s++;
    }
    return n ? s / n : 0;
  }
};

// src/sim/atmosphere.js
var P0 = 101325;
var T0 = 288.15;
var RHO0 = 1.225;
var L = 65e-4;
var R = 287.053;
var GAMMA = 1.4;
var G = 9.80665;
var EXP = G / (R * L);
function atmosphere(h, wx = {}) {
  const qnh = wx.qnh ?? P0;
  const dT = wx.dT ?? 0;
  const hc = Math.min(h, 11e3);
  const Tstd = T0 - L * hc;
  let p = qnh * Math.pow(Tstd / T0, EXP);
  if (h > 11e3) p *= Math.exp(-G * (h - 11e3) / (R * Tstd));
  const T = Tstd + dT;
  const rho = p / (R * T);
  const a = Math.sqrt(GAMMA * R * T);
  return { p, T, rho, a, sigma: rho / RHO0 };
}
function pressureAltitude(p, kollsman = P0) {
  const T11 = T0 - L * 11e3;
  const p11 = kollsman * Math.pow(T11 / T0, EXP);
  if (p < p11) return 11e3 + R * T11 / G * Math.log(p11 / p);
  return T0 / L * (1 - Math.pow(p / kollsman, 1 / EXP));
}
function casFromImpact(qc) {
  if (qc <= 0) return 0;
  const a0 = Math.sqrt(GAMMA * R * T0);
  return a0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
}
function impactPressure(V, { p, a }) {
  const M = V / a;
  return p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
}

// src/sim/engine.js
var GAMMA2 = 1.4;
var R_CRIT = Math.pow(2 / (GAMMA2 + 1), GAMMA2 / (GAMMA2 - 1));
var psiRaw = (r) => Math.sqrt(Math.max(0, Math.pow(r, 2 / GAMMA2) - Math.pow(r, (GAMMA2 + 1) / GAMMA2)));
var PSI_MAX = psiRaw(R_CRIT);
var orificeFlow = (r) => r <= R_CRIT ? 1 : psiRaw(Math.min(r, 1)) / PSI_MAX;
var Engine = class {
  constructor(spec) {
    this.spec = spec;
    const rFull = (P0 - spec.intakeLossFull) / P0;
    this.kappa = rFull * spec.ratedRpm / orificeFlow(rFull);
    const rIdle = spec.idleMp / P0;
    this.areaIdle = rIdle * spec.idleRpm / (this.kappa * orificeFlow(rIdle));
    this.cInd = (spec.ratedPower + spec.frictionPowerRated) / ((P0 - spec.intakeLossFull - spec.mpZeroWork) * spec.ratedRpm);
    this.running = false;
    this.mp = P0;
    this.power = 0;
    this.torque = 0;
    this.fuelFlow = 0;
    this.oilTemp = 15;
    this.oilPress = 0;
    this.cht = 15;
    this.egt = 15;
  }
  throttleArea(t) {
    const th = clamp(t, 0, 1);
    return this.areaIdle + (1 - this.areaIdle) * (1 - Math.cos(th * Math.PI / 2));
  }
  /** Manifold pressure (Pa) where throttle flow equals cylinder demand. */
  manifold(throttle, rpm, pInlet) {
    if (rpm < 1) return pInlet;
    const A3 = this.throttleArea(throttle);
    let lo = 0.02, hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      if (mid * rpm - this.kappa * A3 * orificeFlow(mid) > 0) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi) * pInlet;
  }
  /**
   * @param {object} c controls { throttle, mixture, magnetos, starter }
   * @param {number} rpm current shaft rpm
   * @param {{p:number, T:number}} atm
   * @param {number} ram  ram pressure recovered at the intake, Pa
   * @param {number} airspeed true airspeed, for cooling
   * @param {boolean} fuelAvailable
   * @param {number} dt
   */
  update(c, rpm, atm, ram, airspeed2, fuelAvailable, dt) {
    const s = this.spec;
    const pInlet = atm.p + ram;
    const mixtureOn = (c.mixture ?? 1) > 0.05;
    const ignition = c.magnetos ?? true;
    if (!this.running && ignition && mixtureOn && fuelAvailable && rpm > 150) this.running = true;
    if (this.running && (!ignition || !mixtureOn || !fuelAvailable || rpm < 250)) this.running = false;
    this.mp = this.manifold(c.throttle ?? 0, Math.max(rpm, 1), pInlet);
    const tempCorr = Math.sqrt(T0 / atm.T);
    const pInd = this.running ? Math.max(0, this.cInd * (this.mp - s.mpZeroWork) * rpm * tempCorr) : 0;
    const pFric = s.frictionPowerRated * (rpm / s.ratedRpm) ** 2 + 1.5 * HP * (rpm / s.ratedRpm);
    this.power = pInd - pFric;
    const omega = Math.max(rpm * RPM, 1);
    this.torque = this.power / omega + (c.starter ? s.starterTorque * (rpm < 400 ? 1 : 0) : 0);
    if (!this.running && rpm < 5 && !c.starter) this.torque = 0;
    const lbPerHpH = 0.45359237 / 3600;
    this.fuelFlow = this.running ? s.bsfc * (pInd / HP) * lbPerHpH * (0.85 + 0.15 * clamp(c.mixture ?? 1, 0, 1)) : 0;
    const oat = atm.T - 273.15;
    const pFrac = clamp(pInd / s.ratedPower, 0, 1.2);
    const cooling = 0.55 + 0.45 * clamp(airspeed2 / 45, 0, 1);
    const chtEq = this.running ? oat + (95 + 160 * pFrac) / cooling : oat;
    const oilEq = this.running ? oat + (45 + 60 * pFrac) / (0.7 + 0.3 * clamp(airspeed2 / 45, 0, 1)) : oat;
    this.cht = lag(this.cht, chtEq, 70, dt);
    this.oilTemp = lag(this.oilTemp, oilEq, 260, dt);
    this.egt = lag(this.egt, this.running ? 380 + 360 * clamp(pFrac, 0.05, 1) : this.cht, 6, dt);
    const visc = 1 + clamp((s.oil.tempNormal - this.oilTemp) / 160, -0.2, 0.6);
    const pressEq = rpm < 50 ? 0 : Math.min(100, (22 + 58 * Math.pow(rpm / s.ratedRpm, 0.55)) * visc);
    this.oilPress = lag(this.oilPress, pressEq, 0.6, dt);
  }
};

// src/sim/gear.js
var LOW_SPEED = 0.6;
var Gear = class {
  constructor(spec) {
    this.units = spec.units.map((u) => ({
      ...u,
      compression: 0,
      load: 0,
      onGround: false,
      wheelSpeed: 0,
      wheelAngle: 0,
      steerAngle: 0,
      surface: null
    }));
    this.scrape = spec.scrape.map((s) => ({ ...s, load: 0, touching: false }));
    this.events = [];
  }
  get onGround() {
    return this.units.some((u) => u.onGround);
  }
  get weightOnWheels() {
    return this.units.reduce((s, u) => s + u.load, 0);
  }
  /**
   * @param {object} st  rigid-body state { pos (NED), vel (NED), q, omega }
   * @param {number[]} cg  CG relative to the reference point (body)
   * @param {object} controls { rudder, brakeL, brakeR, parkingBrake }
   * @param {(n:number, e:number) => {h:number, normal:number[], surface:string}} ground
   * @param {number} dt
   * @returns {{ force: number[], moment: number[] }} body axes about the CG
   */
  compute(st, cg, controls, ground, dt) {
    const F3 = [0, 0, 0];
    const M = [0, 0, 0];
    const rb = [0, 0, 0];
    const re = [0, 0, 0];
    const vp = [0, 0, 0];
    const strutE = qRotate(st.q, [0, 0, 1]);
    const gearDown = controls.gearPos ?? 1;
    const groundSpeed = Math.hypot(st.vel[0], st.vel[1]);
    for (const u of this.units) {
      if (u.retracts && gearDown < 0.98) {
        u.compression = 0;
        u.load = 0;
        u.onGround = false;
        u.wheelSpeed *= Math.exp(-dt * 2);
        continue;
      }
      rb[0] = u.pos[0] - cg[0];
      rb[1] = u.pos[1] - cg[1];
      rb[2] = u.pos[2] - cg[2];
      qRotate(st.q, rb, re);
      const pn = st.pos[0] + re[0], pe = st.pos[1] + re[1], pd = st.pos[2] + re[2];
      const gnd = ground(pn, pe, pd);
      const nUp = gnd.normal;
      const depth = (pd + gnd.h) * -nUp[2];
      u.surface = gnd.surface;
      if (depth <= 0 || gnd.surface === "water") {
        u.compression = Math.max(0, u.compression - dt * 2);
        u.load = 0;
        u.onGround = false;
        if (depth > 0.3 && gnd.surface === "water") this.events.push("splash");
        u.wheelSpeed *= Math.exp(-dt * 0.3);
        u.wheelAngle += u.wheelSpeed * dt;
        continue;
      }
      const cosTilt = Math.max(0.3, -dot(strutE, nUp));
      let x = depth / cosTilt;
      cross(st.omega, rb, vp);
      const vpe = qRotate(st.q, vp);
      vpe[0] += st.vel[0];
      vpe[1] += st.vel[1];
      vpe[2] += st.vel[2];
      const vn = -dot(vpe, nUp);
      let k = u.k, c = u.c;
      if (x > u.travel) {
        k *= 12;
        c *= 3;
      }
      let N5 = k * x + c * vn;
      if (N5 < 0) N5 = 0;
      x = Math.min(x, u.travel * 1.5);
      u.compression = x;
      u.load = N5;
      u.onGround = true;
      let steer = 0;
      if (u.steer) {
        steer = u.steer.sign * clamp(controls[u.steer.input] || 0, -1, 1) * u.steer.maxAngle;
        if (u.steer.fadeSpeed) steer /= 1 + (groundSpeed / u.steer.fadeSpeed) ** 2;
      }
      u.steerAngle = steer;
      const wheelFwdB = [Math.cos(steer), Math.sin(steer), 0];
      const wf = qRotate(st.q, wheelFwdB);
      const wn = dot(wf, nUp);
      wf[0] -= wn * nUp[0];
      wf[1] -= wn * nUp[1];
      wf[2] -= wn * nUp[2];
      const wfl = Math.hypot(wf[0], wf[1], wf[2]) || 1;
      wf[0] /= wfl;
      wf[1] /= wfl;
      wf[2] /= wfl;
      const wl = cross(nUp, wf);
      const vLong = dot(vpe, wf);
      const vLat = dot(vpe, wl);
      const mu = u.tyre.mu * (gnd.surface === "grass" ? 0.75 : 1);
      let torque = 0;
      if (u.brake) {
        const pedal = u.brake === "left" ? controls.brakeL || 0 : controls.brakeR || 0;
        torque = Math.max(controls.parkingBrake ? u.parkBrakeTorque ?? u.maxBrakeTorque : 0, u.maxBrakeTorque * pedal);
      }
      const rolling = u.tyre.rolling * (gnd.surface === "grass" ? 2.5 : 1) * N5;
      const brakeMax = torque > 0 ? Math.min(torque / u.tyre.radius, mu * N5) : 0;
      let fLong = -rolling * Math.tanh(vLong / 0.15) - brakeMax * Math.tanh(vLong / 0.03);
      const slip = Math.atan2(vLat, Math.abs(vLong) + LOW_SPEED);
      let fLat = -mu * N5 * Math.tanh(slip / (7 * Math.PI / 180));
      const ft = Math.hypot(fLong, fLat);
      const fmax = mu * N5;
      if (ft > fmax) {
        fLong *= fmax / ft;
        fLat *= fmax / ft;
      }
      const locked = brakeMax >= rolling + 0.98 * mu * N5 && Math.abs(vLong) > 0.5;
      u.wheelSpeed = locked ? 0 : vLong / u.tyre.radius;
      u.wheelAngle += u.wheelSpeed * dt;
      const fe = [
        N5 * nUp[0] + fLong * wf[0] + fLat * wl[0],
        N5 * nUp[1] + fLong * wf[1] + fLat * wl[1],
        N5 * nUp[2] + fLong * wf[2] + fLat * wl[2]
      ];
      const fb = qRotateInv(st.q, fe);
      F3[0] += fb[0];
      F3[1] += fb[1];
      F3[2] += fb[2];
      const m = cross(rb, fb);
      M[0] += m[0];
      M[1] += m[1];
      M[2] += m[2];
    }
    for (const s of this.scrape) {
      rb[0] = s.pos[0] - cg[0];
      rb[1] = s.pos[1] - cg[1];
      rb[2] = s.pos[2] - cg[2];
      qRotate(st.q, rb, re);
      const pd = st.pos[2] + re[2];
      const gnd = ground(st.pos[0] + re[0], st.pos[1] + re[1], pd);
      const depth = pd + gnd.h;
      if (depth <= 0) {
        s.touching = false;
        s.load = 0;
        continue;
      }
      cross(st.omega, rb, vp);
      const vpe = qRotate(st.q, vp);
      vpe[0] += st.vel[0];
      vpe[1] += st.vel[1];
      vpe[2] += st.vel[2];
      const N5 = Math.max(0, s.k * depth + s.c * vpe[2]);
      const vh = Math.hypot(vpe[0], vpe[1]) || 1;
      const fr = s.mu * N5 * Math.tanh(vh / 0.3);
      const fe = [-fr * vpe[0] / vh, -fr * vpe[1] / vh, -N5];
      const fb = qRotateInv(st.q, fe);
      F3[0] += fb[0];
      F3[1] += fb[1];
      F3[2] += fb[2];
      const m = cross(rb, fb);
      M[0] += m[0];
      M[1] += m[1];
      M[2] += m[2];
      if (!s.touching) this.events.push(s.name === "propTip" ? "propStrike" : `${s.name}Strike`);
      s.touching = true;
      s.load = N5;
    }
    return { force: F3, moment: M };
  }
};

// src/sim/jet.js
var JetEngine = class {
  constructor(spec) {
    this.spec = spec;
    this.running = false;
    this.n2 = 0;
    this.ab = 0;
    this.thrust = 0;
    this.fuelFlow = 0;
    this.ftit = 15;
    this.nozzle = 0.8;
    this.oilPress = 0;
    this.power = 0;
    this._abDelay = 0;
  }
  /** Throttle 0..1 → (dry 0..1, burner 0..1). The detent sits at `abDetent`. */
  split(throttle) {
    const d = this.spec.abDetent;
    const t = clamp(throttle, 0, 1);
    return t <= d ? { dry: t / d, ab: 0 } : { dry: 1, ab: (t - d) / (1 - d) };
  }
  /** Put it straight at idle (or stop it): a started engine, a cold one. */
  setRunning(on) {
    this.running = on;
    this.n2 = on ? this.spec.idleN2 : 0;
    this.ab = 0;
    this.ftit = on ? this.spec.ftitIdle : 15;
    this.oilPress = on ? 45 : 0;
  }
  /**
   * @param {object} c  controls { throttle, mixture (fuel shut-off), starter }
   * @param {{sigma:number, T:number}} atm
   * @param {number} mach
   * @param {boolean} fuelAvailable
   * @param {number} dt
   */
  update(c, atm, mach, fuelAvailable, dt) {
    const s = this.spec;
    const fuelOn = (c.mixture ?? 1) > 0.05 && fuelAvailable;
    if (!this.running && fuelOn && this.n2 >= s.lightOffN2) this.running = true;
    if (this.running && (!fuelOn || this.n2 < s.lightOffN2 * 0.8)) this.running = false;
    const { dry, ab } = this.split(c.throttle ?? 0);
    let target;
    if (this.running) target = s.idleN2 + (s.milN2 - s.idleN2) * dry;
    else if (c.starter) target = s.starterN2;
    else target = 0;
    const tau = this.running ? this._spoolTau() : target > this.n2 ? s.starterTau : s.windDownTau;
    const windmill = this.running ? 0 : clamp(mach * 30, 0, 22);
    this.n2 = lag(this.n2, Math.max(target, windmill), tau, dt);
    const atMil = this.running && dry >= 0.999 && this.n2 > s.milN2 - 1.5;
    this._abDelay = atMil && ab > 0 ? this._abDelay + dt : 0;
    const abTarget = this._abDelay > s.abLightDelay ? ab : 0;
    this.ab = lag(this.ab, abTarget, abTarget > this.ab ? s.abTau : s.abTau * 0.5, dt);
    const nFrac = clamp((this.n2 - s.idleN2) / (s.milN2 - s.idleN2), 0, 1.05);
    const lapse = Math.pow(atm.sigma, s.densityExp);
    const dryT = this.running ? (s.idleThrust + (s.milThrust - s.idleThrust) * Math.pow(nFrac, 1.7)) * table1(s.ramDry, mach) : 0;
    const abT = this.running ? this.ab * (s.maxThrust - s.milThrust) * table1(s.ramAb, mach) : 0;
    this.thrust = s.count * lapse * (dryT + abT);
    if (!this.running) this.thrust = -s.count * s.windmillDrag * mach * mach * atm.sigma;
    this.fuelFlow = this.running ? s.count * lapse * (dryT * s.tsfcDry + abT * s.tsfcAb) : 0;
    this.power = this.running ? clamp(nFrac, 0, 1) + this.ab : 0;
    this.nozzle = this.running ? clamp(0.85 - 1.1 * nFrac, 0, 0.85) + 0.95 * this.ab : clamp(this.n2 / 100, 0.2, 0.8);
    this.nozzle = clamp(this.nozzle, 0, 1);
    const ftitEq = this.running ? s.ftitIdle + (s.ftitMil - s.ftitIdle) * Math.pow(nFrac, 1.4) + 25 * this.ab : atm.T - 273.15 + this.n2;
    this.ftit = lag(this.ftit, ftitEq, 1.6, dt);
    this.oilPress = lag(this.oilPress, this.n2 > 10 ? 25 + 35 * clamp(this.n2 / s.milN2, 0, 1) : 0, 0.8, dt);
  }
  _spoolTau() {
    const s = this.spec;
    const u = clamp((this.n2 - s.idleN2) / (s.milN2 - s.idleN2), 0, 1);
    return s.spoolTauIdle + (s.spoolTauMil - s.spoolTauIdle) * u;
  }
};

// src/sim/massprops.js
function massProperties(spec, load) {
  const items = [{ m: spec.empty.m, pos: spec.empty.pos }];
  const it = spec.items;
  items.push({ m: load.pilot ?? it.pilot.m, pos: it.pilot.pos });
  items.push({ m: load.passenger ?? it.passenger.m, pos: it.passenger.pos });
  items.push({ m: load.baggage ?? it.baggage.m, pos: it.baggage.pos });
  items.push({ m: (load.fuelCenterL ?? 0) * spec.fuelDensity, pos: it.fuelCenter.pos });
  items.push({ m: (load.fuelWingsL ?? 0) * spec.fuelDensity, pos: it.fuelWings.pos });
  let m = 0;
  const cg = [0, 0, 0];
  for (const i of items) {
    m += i.m;
    cg[0] += i.m * i.pos[0];
    cg[1] += i.m * i.pos[1];
    cg[2] += i.m * i.pos[2];
  }
  cg[0] /= m;
  cg[1] /= m;
  cg[2] /= m;
  const I = { xx: 0, yy: 0, zz: 0, xz: 0 };
  const e = spec.inertiaEmpty;
  const shift = (mass, p) => {
    const dx = p[0] - cg[0], dy = p[1] - cg[1], dz = p[2] - cg[2];
    I.xx += mass * (dy * dy + dz * dz);
    I.yy += mass * (dx * dx + dz * dz);
    I.zz += mass * (dx * dx + dy * dy);
    I.xz += mass * dx * dz;
  };
  I.xx += e.xx;
  I.yy += e.yy;
  I.zz += e.zz;
  I.xz += e.xz;
  for (const i of items) shift(i.m, i.pos);
  return { mass: m, cg, inertia: I };
}

// src/sim/propeller.js
var BLADE_SECTION = { a: 5.6, stall: 14 * DEG, cd0: 0.011, e: 1, aspect: 1e9 };
var Propeller = class {
  constructor(spec) {
    this.spec = spec;
    this.R = spec.diameter / 2;
    this.A = Math.PI * this.R * this.R * (spec.discEfficiency ?? 1);
    this.beta = spec.betaFine;
    this.vi = 0;
    this.thrust = 0;
    this.torque = 0;
    this.slipDv = 0;
    this.swirl = 0;
    this.governing = false;
    this.lastRpm = 0;
  }
  setRpmFromLever(lever) {
    const g = this.spec.governor;
    return lerp(g.rpmMin, g.rpmMax, clamp(lever, 0, 1));
  }
  /** Aerodynamics at a given blade angle — pure, used by the governor and the tests. */
  evaluate(Vax, rpm, rho, beta = this.beta, viGuess = this.vi) {
    const s = this.spec;
    const r = 0.75 * this.R;
    const Vt = Math.max(rpm * RPM * r, 0.01);
    const bladeSpan = 0.8 * this.R;
    let vi = viGuess;
    let T = 0, Q = 0;
    for (let it = 0; it < 10; it++) {
      const Va = Vax + vi;
      const phi = Math.atan2(Va, Vt);
      const W22 = Va * Va + Vt * Vt;
      const { cl, cd } = sectionCoefficients(beta - phi, BLADE_SECTION);
      const k = s.blades * 0.5 * rho * W22 * s.chord75 * bladeSpan;
      T = k * (cl * Math.cos(phi) - cd * Math.sin(phi));
      Q = k * (cl * Math.sin(phi) + cd * Math.cos(phi)) * r;
      const V = Math.max(Vax, 0);
      const target = T >= 0 ? 0.5 * (-V + Math.sqrt(V * V + 2 * T / (rho * this.A))) : -0.5 * (-V + Math.sqrt(V * V + 2 * -T / (rho * this.A)));
      vi = lerp(vi, clamp(target, -0.5 * Math.max(V, 1), 60), 0.5);
    }
    return { T, Q, vi };
  }
  /**
   * @param {number} Vax  axial airspeed at the disc (m/s, + from ahead)
   * @param {number} rpm
   * @param {number} rho
   * @param {number} lever 0..1 prop lever → rpm setpoint
   * @param {number} dt
   */
  update(Vax, rpm, rho, lever, dt) {
    const g = this.spec.governor;
    const setRpm = this.setRpmFromLever(lever);
    const dRpm = dt > 0 ? (rpm - this.lastRpm) / dt : 0;
    this.lastRpm = rpm;
    if (rpm > 1500) {
      const rate = clamp(g.gain * (rpm - setRpm) + g.damping * dRpm, -g.rateLimit, g.rateLimit);
      this.beta = clamp(this.beta + rate * dt, this.spec.betaFine, this.spec.betaCoarse);
    } else {
      this.beta = Math.max(this.spec.betaFine, this.beta - g.rateLimit * dt);
    }
    this.governing = this.beta > this.spec.betaFine + 0.2 * DEG;
    const { T, Q, vi } = this.evaluate(Vax, rpm, rho);
    this.vi = vi;
    this.thrust = T;
    this.torque = Q;
    this.slipDv = 2 * vi * 0.85;
    const sweptArea = Math.PI * this.R * this.R;
    const mdot = rho * sweptArea * Math.max(Vax + vi, 1);
    this.swirl = clamp(0.5 * Q / (mdot * 0.7 * this.R), 0, 15);
  }
};

// src/sim/aircraft.js
var SIM_HZ = 480;
var H = 1 / SIM_HZ;
var MAX_SUBSTEPS = 48;
function defaultControls() {
  return {
    aileron: 0,
    elevator: 0,
    rudder: 0,
    elevatorTrim: 0,
    throttle: 0,
    prop: 1,
    mixture: 1,
    magnetos: true,
    starter: false,
    brakeL: 0,
    brakeR: 0,
    parkingBrake: false,
    gear: 1,
    speedbrake: 0,
    // handles: gear down, speed brake in (jets)
    hook: 0,
    // tail hook handle: up
    sfoils: 0
    // the X-wing's S-foils: 0 closed (cruise), 1 open (attack position)
  };
}
var Aircraft = class {
  /**
   * @param {object} spec  aircraft data (see aircraft/extra300l.js)
   * @param {object} [opts]
   * @param {object} [opts.load]  { pilot, passenger, baggage, fuelCenterL, fuelWingsL }
   * @param {(n:number, e:number) => {h:number, normal:number[], surface:string}} [opts.ground]
   * @param {number} [opts.datumMsl]  MSL height of the earth-frame origin, m
   * @param {object} [opts.weather]  { qnh, dT, wind: [n, e, d] m/s (air velocity, NED) }
   */
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.ground = opts.ground || (() => ({ h: 0, normal: [0, 0, -1], surface: "asphalt" }));
    this.datumMsl = opts.datumMsl ?? 0;
    this.weather = { qnh: 101325, dT: 0, wind: [0, 0, 0], ...opts.weather || {} };
    this.load = { fuelCenterL: spec.mass.items.fuelCenter.capacityL, fuelWingsL: 0, ...spec.mass.defaultLoad || {}, ...opts.load || {} };
    this.jet = !!spec.jet;
    this.aero = new Aero(spec);
    this.engine = this.jet ? new JetEngine(spec.jet) : new Engine(spec.engine);
    this.prop = this.jet ? null : new Propeller(spec.prop);
    this.gear = new Gear(spec.gear);
    this.controls = defaultControls();
    this.gearPos = 1;
    this.speedbrakePos = 0;
    this.hookPos = 0;
    this.sfoilPos = 0;
    this.hookAngle = 0;
    this.arrestor = null;
    this.state = { pos: [0, 0, 0], vel: [0, 0, 0], q: [1, 0, 0, 0], omega: [0, 0, 0] };
    this.rpm = 0;
    this.time = 0;
    this._acc = 0;
    this.out = {
      vAirBody: [0, 0, 0],
      tas: 0,
      alpha: 0,
      beta: 0,
      specificForce: [0, 0, -G0],
      loadFactor: 1,
      atm: atmosphere(this.datumMsl, this.weather),
      qbar: 0
    };
    this.events = [];
    this.damage = { propStrike: false, gearCollapsed: false, crashed: false };
    this.updateMass();
  }
  updateMass() {
    const mp = massProperties(this.spec.mass, this.load);
    this.mass = mp.mass;
    this.cg = mp.cg;
    this.inertia = mp.inertia;
  }
  get altitudeMsl() {
    return this.datumMsl - this.state.pos[2];
  }
  get euler() {
    return qToEuler(this.state.q);
  }
  get fuelL() {
    return this.load.fuelCenterL + this.load.fuelWingsL;
  }
  /** Does the gear go up? */
  get retractable() {
    return this.spec.gear.units.some((u) => u.retracts);
  }
  /** Engine started and at idle (warm), or stopped. `rpm` is the prop's rpm, or the jet's core speed in %. */
  setEngineRunning(on) {
    if (this.jet) {
      this.engine.setRunning(on);
      this.rpm = this.engine.n2;
      return;
    }
    this.engine.running = on;
    this.rpm = on ? Math.max(this.rpm, this.spec.engine.idleRpm + 50) : 0;
    if (this.prop) this.prop.lastRpm = this.rpm;
  }
  /** Put the aircraft at rest on its three wheels at (n, e) facing `heading` (rad, true). */
  placeOnGround(n, e, heading) {
    const g = this.spec.gear.units;
    const main = g[0], third = g.find((u) => u.steer || /nose|tail/i.test(u.name)) || g[2];
    const [fore, aft] = third.pos[0] > main.pos[0] ? [third, main] : [main, third];
    const theta = Math.atan2(fore.pos[2] - aft.pos[2], fore.pos[0] - aft.pos[0]);
    const q = qFromEuler(0, theta, heading);
    const gh = this.ground(n, e).h;
    const rel = [main.pos[0] - this.cg[0], main.pos[1] - this.cg[1], main.pos[2] - this.cg[2]];
    const re = qRotate(q, rel);
    const mains = g.filter((u) => u.brake).length || 2;
    const staticDefl = this.mass * G0 * 0.9 / mains / main.k;
    this.state = { pos: [n, e, -gh - re[2] + staticDefl], vel: [0, 0, 0], q, omega: [0, 0, 0] };
    this.aero.eps = 0;
    this.gearPos = 1;
    this.controls.gear = 1;
    this.speedbrakePos = 0;
    this.controls.speedbrake = 0;
    this.hookPos = 0;
    this.controls.hook = 0;
    if (this.spec.autoFlaps?.time > 3) this.controls.flaps = 1;
    this.arrestor?.reset();
    this.damage = { propStrike: false, gearCollapsed: false, crashed: false };
  }
  /** Start in the air at a given true airspeed, level, wings level. */
  placeInFlight(n, e, altMsl, heading, tas, alpha = 3 * Math.PI / 180) {
    const q = qFromEuler(0, alpha, heading);
    const vb = [tas * Math.cos(alpha), 0, tas * Math.sin(alpha)];
    this.state = { pos: [n, e, this.datumMsl - altMsl], vel: qRotate(q, vb), q, omega: [0, 0, 0] };
    for (const u of this.gear.units) {
      u.onGround = false;
      u.load = 0;
      u.compression = 0;
    }
    if (this.jet) {
      this.engine.setRunning(true);
      this.engine.n2 = this.spec.jet.idleN2 + 0.8 * (this.spec.jet.milN2 - this.spec.jet.idleN2);
      this.rpm = this.engine.n2;
      this.gearPos = this.controls.gear = this.retractable ? 0 : 1;
      this.hookPos = this.controls.hook = 0;
      this.arrestor?.reset();
    } else {
      this.engine.running = true;
      this.rpm = 2400;
      this.prop.lastRpm = this.rpm;
    }
    this.damage = { propStrike: false, gearCollapsed: false, crashed: false };
  }
  /** Advance by a frame time; runs whole 480 Hz substeps and carries the remainder. */
  update(dt) {
    this._acc += Math.min(dt, MAX_SUBSTEPS * H);
    let n = 0;
    while (this._acc >= H && n < MAX_SUBSTEPS) {
      this.step(H);
      this._acc -= H;
      n++;
    }
    return n;
  }
  step(h) {
    const st = this.state;
    const c = this.controls;
    const sp = this.spec;
    const atm = atmosphere(this.altitudeMsl, this.weather);
    const w = this.weather.wind;
    const vAirE = [st.vel[0] - w[0], st.vel[1] - w[1], st.vel[2] - w[2]];
    const vAirB = qRotateInv(st.q, vAirE);
    const tas = length(vAirB);
    const qbar = 0.5 * atm.rho * tas * tas;
    const mach = tas / atm.a;
    if (this.retractable) {
      const want = c.gear ?? 1;
      const wow = this.gear.onGround && this.gearPos > 0.98;
      const tgt = wow ? 1 : want;
      const rate = h / (sp.gear.transitTime || 6);
      this.gearPos = clamp(this.gearPos + clamp(tgt - this.gearPos, -rate, rate), 0, 1);
    }
    if (sp.hook) this.hookPos = clamp(this.hookPos + clamp((c.hook || 0) - this.hookPos, -h / 1.5, h / 1.5), 0, 1);
    const sbRate = h / 1.5;
    this.speedbrakePos = clamp(this.speedbrakePos + clamp((c.speedbrake || 0) - this.speedbrakePos, -sbRate, sbRate), 0, 1);
    c.gearPos = this.gearPos;
    c.speedbrakePos = this.speedbrakePos;
    if (sp.autoFlaps) {
      const want = this.gearPos > 0.5 && tas < sp.autoFlaps.maxSpeed ? 1 : 0;
      const ft = sp.autoFlaps.time || 3;
      c.flaps = clamp((c.flaps || 0) + clamp(want - (c.flaps || 0), -h / ft, h / ft), 0, 1);
    }
    const rot = this.jet ? 0 : sp.engine.rotation;
    let T, Irot = 0;
    if (this.jet) {
      const fuelAvailable = this.fuelL > 0.05;
      this.engine.update(c, atm, mach, fuelAvailable, h);
      this.rpm = this.engine.n2;
      this.burnFuel(this.engine.fuelFlow * h);
      T = this.engine.thrust;
    } else {
      const fuelAvailable = this.fuelL > 0.05 && !this.damage.propStrike;
      this.prop.update(vAirB[0], this.rpm, atm.rho, c.prop, h);
      this.engine.update(c, this.rpm, atm, 0.6 * qbar, tas, fuelAvailable, h);
      Irot = sp.engine.rotInertia;
      const omegaShaft = this.rpm * RPM + (this.engine.torque - this.prop.torque) / Irot * h;
      this.rpm = Math.max(0, omegaShaft / RPM);
      if (this.damage.propStrike) this.rpm *= Math.exp(-h * 8);
      this.burnFuel(this.engine.fuelFlow * h);
      T = this.prop.thrust;
    }
    const hWing = this.wingHeight();
    const aero = this.aero.compute({
      vAir: vAirB,
      omega: st.omega,
      cg: this.cg,
      rho: atm.rho,
      controls: c,
      slip: this.prop ? { dv: this.prop.slipDv, swirl: this.prop.swirl, rot } : null,
      hWing,
      mach,
      dt: h
    });
    const F3 = aero.force;
    const M = aero.moment;
    if (this.jet) {
      const tp = sp.jet.pos;
      F3[0] += T;
      M[1] += (tp[2] - this.cg[2]) * T;
      M[2] += -(tp[1] - this.cg[1]) * T;
    } else {
      const R3 = this.prop.R;
      const Vp = Math.max(tas, 5);
      const pf = sp.prop.pFactor * R3 * rot / Vp;
      const rT = [sp.prop.pos[0] - this.cg[0], sp.prop.pos[1] - this.cg[1] + pf * vAirB[2], sp.prop.pos[2] - this.cg[2] - pf * vAirB[1]];
      F3[0] += T;
      M[1] += rT[2] * T;
      M[2] += -rT[1] * T;
      M[0] += -rot * this.engine.torque;
    }
    if (sp.hook) {
      const hk = sp.hook;
      let a = hk.maxAngle * this.hookPos;
      const tipAt = (ang) => {
        const tb = [hk.pivot[0] - hk.length * Math.cos(ang) - this.cg[0], hk.pivot[1] - this.cg[1], hk.pivot[2] + hk.length * Math.sin(ang) - this.cg[2]];
        const te = qRotate(st.q, tb);
        return { tb, te: [st.pos[0] + te[0], st.pos[1] + te[1], st.pos[2] + te[2]] };
      };
      let tip = tipAt(a);
      const under = this.ground(tip.te[0], tip.te[1], tip.te[2]);
      const pen = tip.te[2] + under.h;
      if (pen > 0 && a > 0 && under.surface !== "water") {
        a = Math.max(0, a - pen / (hk.length * Math.max(0.3, Math.cos(a))));
        tip = tipAt(a);
      }
      this.hookAngle = a;
      this.hookTip = tip.te;
      if (this.arrestor) {
        const pull = this.arrestor.update(tip.te, st.vel, this.mass, this.hookPos > 0.95, h);
        for (const ev of this.arrestor.events.splice(0)) this.events.push({ t: this.time, ...ev });
        if (pull) {
          const fb = qRotateInv(st.q, [pull[0], pull[1], 0.15 * Math.hypot(pull[0], pull[1])]);
          add(F3, fb, F3);
          add(M, cross([hk.pivot[0] - this.cg[0], hk.pivot[1] - this.cg[1], hk.pivot[2] - this.cg[2]], fb), M);
        }
      }
    }
    if (sp.sfoils) {
      const want = this.gear.onGround ? 0 : c.sfoils || 0;
      this.sfoilPos = clamp(this.sfoilPos + clamp(want - this.sfoilPos, -h, h), 0, 1);
      c.sfoilPos = this.sfoilPos;
    }
    if (sp.thrusters) {
      const t = sp.thrusters, I = this.inertia;
      const k = t.gain * (this.gear.onGround ? 0.3 : 1);
      const qMax = t.gLimit ? Math.min(t.pitch, t.gLimit * G0 / Math.max(tas, 1)) : t.pitch;
      M[0] += I.xx * k * (clamp(c.aileron || 0, -1, 1) * t.roll - st.omega[0]);
      M[1] += I.yy * k * (clamp(c.elevator || 0, -1, 1) * qMax - st.omega[1]);
      M[2] += I.zz * k * (clamp(c.rudder || 0, -1, 1) * t.yaw - st.omega[2]);
    }
    if (sp.stabilizers && tas > 2) {
      const s = sp.stabilizers, m2 = this.mass;
      let fy = -m2 * s.rate * vAirB[1], fz = -m2 * s.rate * vAirB[2];
      const f = Math.hypot(fy, fz), lim = s.maxG ? m2 * G0 * s.maxG : Infinity;
      if (f > lim) {
        fy *= lim / f;
        fz *= lim / f;
      }
      F3[1] += fy;
      F3[2] += fz;
    }
    if (sp.repulsor && this.engine.running) {
      const r = sp.repulsor;
      const resting = this.gear.onGround && (c.throttle || 0) < 0.2;
      const carry = resting ? 0 : r.share * clamp(1 - tas / r.fadeSpeed, 0, 1);
      const agl = -st.pos[2] - this.ground(st.pos[0], st.pos[1]).h;
      const near = clamp(1 - agl / r.cushionHeight, 0, 1);
      const up = this.mass * (G0 * carry - r.damping * near * st.vel[2] * (st.vel[2] > 0 ? 1 : 0.3));
      add(F3, qRotateInv(st.q, [0, 0, -up]), F3);
    }
    const gear = this.gear.compute(st, this.cg, c, this.ground, h);
    add(F3, gear.force, F3);
    add(M, gear.moment, M);
    for (const e of this.gear.events) this.onEvent(e);
    this.gear.events.length = 0;
    const Fe = qRotate(st.q, F3);
    const m = this.mass;
    st.vel[0] += Fe[0] / m * h;
    st.vel[1] += Fe[1] / m * h;
    st.vel[2] += (Fe[2] / m + G0) * h;
    st.pos[0] += st.vel[0] * h;
    st.pos[1] += st.vel[1] * h;
    st.pos[2] += st.vel[2] * h;
    const Hrot = [rot * Irot * this.rpm * RPM, 0, 0];
    const L2 = inertiaMul(this.inertia, st.omega);
    L2[0] += Hrot[0];
    const gyro = cross(st.omega, L2);
    const wdot = inertiaSolve(this.inertia, [M[0] - gyro[0], M[1] - gyro[1], M[2] - gyro[2]]);
    st.omega[0] += wdot[0] * h;
    st.omega[1] += wdot[1] * h;
    st.omega[2] += wdot[2] * h;
    qIntegrate(st.q, st.omega, h);
    this.time += h;
    const o = this.out;
    o.vAirBody = vAirB;
    o.tas = tas;
    o.mach = mach;
    o.qbar = qbar;
    o.atm = atm;
    o.alpha = Math.atan2(vAirB[2], vAirB[0]);
    o.beta = tas > 0.1 ? Math.asin(clamp(vAirB[1] / tas, -1, 1)) : 0;
    o.specificForce = [F3[0] / m, F3[1] / m, F3[2] / m];
    o.loadFactor = -o.specificForce[2] / G0;
    o.gear = gear;
  }
  wingHeight() {
    const st = this.state;
    const g = this.ground(st.pos[0], st.pos[1]);
    const agl = -st.pos[2] - g.h;
    return agl < this.spec.wing.span * 2 ? Math.max(0.1, agl) : Infinity;
  }
  burnFuel(kg) {
    if (kg <= 0) return;
    const L2 = kg / this.spec.mass.fuelDensity;
    if (this.load.fuelCenterL > 0) this.load.fuelCenterL = Math.max(0, this.load.fuelCenterL - L2);
    else this.load.fuelWingsL = Math.max(0, this.load.fuelWingsL - L2);
    this._massAcc = (this._massAcc || 0) + L2;
    if (this._massAcc > 0.05) {
      this._massAcc = 0;
      this.updateMass();
    }
  }
  onEvent(e) {
    if (e === "propStrike" && this.rpm > 100) {
      this.damage.propStrike = true;
      this.engine.running = false;
    }
    if (e === "splash") this.damage.crashed = true;
    this.events.push({ t: this.time, e });
  }
  /** NED position of the reference point R (the model origin), which sits at -cg from the CG. */
  referencePoint() {
    const r = qRotate(this.state.q, [-this.cg[0], -this.cg[1], -this.cg[2]]);
    const p = this.state.pos;
    return [p[0] + r[0], p[1] + r[1], p[2] + r[2]];
  }
  /** What the control mapper reads (input/controlMapper.js): air data, attitude, rates, the wheels. */
  flightState() {
    const e = this.euler, o = this.out, w = this.state.omega;
    return {
      qbar: o.qbar,
      alpha: o.alpha,
      beta: o.beta,
      loadFactor: o.loadFactor,
      yawRate: w[2],
      rollRate: w[0],
      pitchRate: w[1],
      heading: e.psi,
      bank: e.phi,
      pitch: e.theta,
      onGround: this.gear.onGround,
      agl: this.agl,
      climbRate: -this.state.vel[2],
      retractable: this.retractable,
      hasHook: !!this.spec.hook
    };
  }
  /** Ground speed, m/s. */
  get groundSpeed() {
    return Math.hypot(this.state.vel[0], this.state.vel[1]);
  }
  /** Height of the CG above the ground, m. */
  get agl() {
    const st = this.state;
    return -st.pos[2] - this.ground(st.pos[0], st.pos[1]).h;
  }
};

// src/instruments/instruments.js
var Needle = class {
  constructor(wn, zeta, value = 0) {
    this.wn = wn;
    this.zeta = zeta;
    this.x = value;
    this.v = 0;
  }
  step(target, dt) {
    const n = Math.max(1, Math.ceil(dt * this.wn * 4));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = this.wn * this.wn * (target - this.x) - 2 * this.zeta * this.wn * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
};
var CHICAGO_FIELD = { declination: -2 * DEG, inclination: 70.5 * DEG };
var Instruments = class {
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.field = opts.field || CHICAGO_FIELD;
    this.kollsman = opts.kollsman ?? P0;
    this.pStatic = null;
    this.vsiCase = null;
    this.asi = new Needle(14, 0.8);
    this.vsiNeedle = new Needle(6, 0.9);
    this.gNeedle = new Needle(16, 0.55, 1);
    this.gMax = 1;
    this.gMin = 1;
    this.card = { angle: 0, rate: 0 };
    this.ball = new Needle(7, 0.45);
    this.values = {};
    this._compassReady = false;
  }
  resetG() {
    this.gMax = 1;
    this.gMin = 1;
  }
  /** Kollsman window in inHg, as the knob is labelled. */
  setKollsmanInHg(inHg) {
    this.kollsman = inHg * INHG;
  }
  /**
   * @param {object} ac  the Aircraft (sim/aircraft.js)
   * @param {number} dt
   */
  update(ac, dt) {
    const o = ac.out;
    const atm = o.atm;
    const v = this.values;
    const vb = o.vAirBody;
    const flowAngle = Math.acos(clamp(vb[0] / Math.max(o.tas, 0.1), -1, 1));
    const recovery = flowAngle < 20 * DEG ? 1 : flowAngle > 55 * DEG ? 0 : Math.cos((flowAngle - 20 * DEG) / (35 * DEG) * (Math.PI / 2));
    const M = o.tas / atm.a;
    const qc = Math.max(0, vb[0]) > 0 ? atm.p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1) * recovery : 0;
    const ias = casFromImpact(qc) / KT;
    v.ias = this.asi.step(ias, dt);
    this.pStatic = this.pStatic == null ? atm.p : lag(this.pStatic, atm.p, 0.25, dt);
    const hInd = pressureAltitude(this.pStatic, this.kollsman) / FT;
    v.altitude = hInd;
    v.kollsmanInHg = this.kollsman / INHG;
    const tau = 4;
    if (this.vsiCase == null) this.vsiCase = hInd;
    this.vsiCase = lag(this.vsiCase, hInd, tau, dt);
    const fpm = (hInd - this.vsiCase) / tau * 60;
    v.vsi = this.vsiNeedle.step(clamp(fpm, -6500, 6500), dt);
    const g = this.gNeedle.step(o.loadFactor, dt);
    v.g = g;
    this.gMax = Math.max(this.gMax, g);
    this.gMin = Math.min(this.gMin, g);
    v.gMax = this.gMax;
    v.gMin = this.gMin;
    const f = o.specificForce;
    const ballAngle = Math.atan2(-f[1], Math.max(0.5, -f[2]));
    v.ball = clamp(this.ball.step(ballAngle / (14 * DEG), dt), -1, 1);
    v.compass = this.compass(ac, dt);
    v.heading = ac.euler.psi / DEG;
    v.mach = M;
    v.aoa = o.tas > 15 ? o.alpha / DEG : 0;
    const eu = ac.euler;
    v.pitch = eu.theta / DEG;
    v.bank = eu.phi / DEG;
    v.flightPath = Math.atan2(-ac.state.vel[2], Math.max(0.1, Math.hypot(ac.state.vel[0], ac.state.vel[1]))) / DEG;
    v.drift = Math.atan2(vb[1], Math.max(0.1, vb[0])) / DEG;
    const e = ac.engine;
    v.rpm = v.rpm == null ? ac.rpm : lag(v.rpm, ac.rpm, 0.12, dt);
    if (ac.jet) {
      v.n2 = v.rpm;
      v.ftit = e.ftit;
      const pph = e.fuelFlow * 3600 / 0.45359237;
      v.fuelFlow = v.fuelFlow == null ? pph : lag(v.fuelFlow, pph, 0.8, dt);
      v.fuelLb = ac.fuelL * ac.spec.mass.fuelDensity / 0.45359237;
      v.nozzle = e.nozzle * 100;
      v.ab = e.ab;
      v.oilPress = e.oilPress;
      v.oat = atm.T - 273.15;
      v.stallWarning = M * atm.a > 20 && ac.aero.wingStallFraction() > 0.3;
      return v;
    }
    v.mp = v.mp == null ? e.mp / INHG : lag(v.mp, e.mp / INHG, 0.25, dt);
    const gph = e.fuelFlow / ac.spec.mass.fuelDensity * 3600 / 3.785411784;
    v.fuelFlow = v.fuelFlow == null ? gph : lag(v.fuelFlow, gph, 0.8, dt);
    v.oilTempF = e.oilTemp * 9 / 5 + 32;
    v.oilPress = e.oilPress;
    v.chtF = e.cht * 9 / 5 + 32;
    v.egtF = e.egt * 9 / 5 + 32;
    v.fuelCenterL = ac.load.fuelCenterL;
    v.fuelWingsL = ac.load.fuelWingsL;
    v.oat = atm.T - 273.15;
    const casKt2 = Math.sqrt(2 * Math.max(0, o.qbar) / 1.225) / 0.514444;
    v.stallWarning = casKt2 > 40 && (ac.aero.wingStallFraction() > 0 || Math.abs(o.alpha) > 15 * DEG && Math.abs(o.alpha) < 60 * DEG);
    return v;
  }
  /** Pendulous card: aligns with the field projected onto the plane normal to apparent gravity. */
  compass(ac, dt) {
    const { declination: D, inclination: I } = this.field;
    const Bn = [Math.cos(I) * Math.cos(D), Math.cos(I) * Math.sin(D), Math.sin(I)];
    const B2 = qRotateInv(ac.state.q, Bn);
    const f = ac.out.specificForce;
    let n = [-f[0], -f[1], -f[2]];
    const nl = Math.hypot(n[0], n[1], n[2]);
    n = nl > 0.5 ? [n[0] / nl, n[1] / nl, n[2] / nl] : [0, 0, 1];
    const tilt = Math.acos(clamp(n[2], -1, 1));
    const maxTilt = 18 * DEG;
    if (tilt > maxTilt) {
      const h = Math.hypot(n[0], n[1]) || 1;
      n = [n[0] / h * Math.sin(maxTilt), n[1] / h * Math.sin(maxTilt), Math.cos(maxTilt)];
    }
    const bn = B2[0] * n[0] + B2[1] * n[1] + B2[2] * n[2];
    const Bp = [B2[0] - bn * n[0], B2[1] - bn * n[1], B2[2] - bn * n[2]];
    const xn = n[0];
    const e1 = [1 - xn * n[0], -xn * n[1], -xn * n[2]];
    const e1l = Math.hypot(e1[0], e1[1], e1[2]) || 1;
    e1[0] /= e1l;
    e1[1] /= e1l;
    e1[2] /= e1l;
    const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
    let target = Math.atan2(-(Bp[0] * e2[0] + Bp[1] * e2[1] + Bp[2] * e2[2]), Bp[0] * e1[0] + Bp[1] * e1[1] + Bp[2] * e1[2]);
    if (!this._compassReady) {
      this.card.angle = target;
      this._compassReady = true;
    }
    let err = target - this.card.angle;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    const wn = 2.6, zeta = 0.35;
    const n2 = Math.max(1, Math.ceil(dt * 20));
    for (let i = 0; i < n2; i++) {
      const h = dt / n2;
      this.card.rate += (wn * wn * err - 2 * zeta * wn * this.card.rate) * h;
      this.card.angle += this.card.rate * h;
      err -= this.card.rate * h;
    }
    let deg = this.card.angle / DEG;
    deg = (deg % 360 + 360) % 360;
    return deg;
  }
};

// src/input/controlMapper.js
var BINDINGS = {
  pitchDown: ["ArrowUp", "w"],
  pitchUp: ["ArrowDown", "s"],
  rollLeft: ["ArrowLeft", "a"],
  rollRight: ["ArrowRight", "d"],
  yawLeft: ["q", "z"],
  yawRight: ["e", "x"],
  throttleUp: ["r", "PageUp", "=", "+", "Shift"],
  throttleDown: ["f", "PageDown", "-", "Control"],
  throttleFull: ["End"],
  throttleIdle: ["Home"],
  propUp: ["]"],
  propDown: ["["],
  trimUp: ["'"],
  // nose up
  trimDown: [";"],
  // nose down
  brakes: [".", "b"],
  starter: ["k"],
  fire: [" "],
  // the X-wing's lasers (held)
  boost: [" ", "Alt"]
  // held with a stick key: pull (push, roll) twice as hard, through the buffet (an aircraft's handling.boostKeys can narrow it)
};
var ACTIONS = {
  view: ["v"],
  panel: ["i"],
  reset: ["Backspace"],
  pause: ["p"],
  help: ["h", "?"],
  smoke: ["t"],
  mixture: ["m"],
  parkingBrake: [","],
  autoRudder: ["u"],
  easy: ["l"],
  demo: ["o"],
  gReset: ["g"],
  kollsman: ["n"],
  exit: ["Escape"],
  yoke: ["y"],
  lookCenter: ["c"],
  gear: ["g"],
  speedbrake: ["j"],
  // the jet's: G is the gear handle there (the Extra's G resets its g-meter)
  hook: ["/"]
  // the tail hook, for the carrier's wires
};
var KEY_AUTHORITY = {
  elevator: { c: 686e-6, k0: 0.63 },
  aileron: { c: 314e-6, k0: 0.75 },
  rudder: { c: 257e-6, k0: 0.79 }
};
var BUFFET_ALPHA = 15.5 * Math.PI / 180;
var EASE_PER_RAD = 16;
var EASY = {
  alphaMax: 15.5 * Math.PI / 180,
  // body α; the first wing strip stalls at 17.8° (sweeps at 80 and 140 kt)
  lead: 0.25,
  // s of α-rate the limiter looks ahead [tune] tests/handling.test.js easy
  kp: 3,
  // elevator per rad past the limit
  ki: 9,
  // per rad·s: learns the elevator that holds the limit
  liftoffMargin: 2 * Math.PI / 180,
  // the limit while the wheels are still on the ground is this much lower
  slew: 3.5,
  // elevator travel per s
  minQ: 60,
  // Pa (~20 kt): below this α means nothing
  rotateQ: 685,
  // Pa (65 kt): hands-off take-off, the nose comes up here
  climbPitch: 13 * Math.PI / 180,
  // … to this attitude
  holdKp: 2.2,
  holdKi: 1.6,
  holdKd: 0.5,
  // pitch hold: elevator per rad, per rad·s, per rad/s [tune] tests/handling.test.js
  gMax: 7,
  gMin: -4.5,
  // and a load limit inside the airplane's ±10 g [tune]
  radPerG: 0.03,
  // α per g at aerobatic speeds, to fold the g limit into the same loop
  holdSpeedKt: [50, 95]
  // the pitch hold: 8° nose-down at the first speed, up to 25° nose-up by the second
};
var KEY_CAP = { elevator: 1, aileron: 0.75, rudder: 1 };
var KEY_RAMP_S = 1.2;
var BANK_HOLD_Q = 700;
var TRIM_Q = 700;
var TRIM_PER_RATE = 0.5;
var YAW_Q = 700;
function keyAuthority(axis, qbar, boost = 1, table2 = KEY_AUTHORITY) {
  const a = table2[axis];
  return Math.min(1, boost / (a.c * Math.max(0, qbar) + a.k0));
}
var FLIGHT_KEYS = ["pitchDown", "pitchUp", "rollLeft", "rollRight", "yawLeft", "yawRight", "throttleUp", "throttleDown", "throttleFull", "throttleIdle", "brakes"];
var expo = (x, e) => Math.sign(x) * (e * Math.abs(x) ** 3 + (1 - e) * Math.abs(x));
var dead = (x, d) => Math.abs(x) < d ? 0 : Math.sign(x) * (Math.abs(x) - d) / (1 - d);
var ControlMapper = class _ControlMapper {
  /**
   * @param {object} [opts]
   * @param {object} [opts.handling]  the aircraft's own stick feel and easy-mode limits (spec.handling):
   *   { keyAuthority, keyCap, buffetAlpha, easy, throttleRate, boostKeys }, each over the Extra's defaults here
   */
  constructor(opts = {}) {
    this.setHandling(opts.handling);
    this.keyRamp = opts.keyRamp ?? KEY_RAMP_S;
    this.rampIn = opts.rampIn ?? 2.5;
    this.rampOut = opts.rampOut ?? 5;
    this.expo = opts.expo ?? 0.45;
    this.kb = { aileron: 0, elevator: 0, rudder: 0 };
    this.throttle = 0;
    this.prop = 1;
    this.trim = 0;
    this.speedbrake = false;
    this.gear = 1;
    this.hook = 0;
    this.sfoils = 0;
    this.autoRudder = opts.autoRudder ?? true;
    this.autoTrim = opts.autoTrim ?? true;
    this.yawKb = 1;
    this.yawKr = 3;
    this.yawKi = 1.5;
    this._rSteady = 0;
    this._autoRud = 0;
    this.easy = opts.easy ?? false;
    this._lim = { hi: null, lo: null };
    this._alphaPrev = null;
    this._alphaDot = 0;
    this._rudI = 0;
    this._phiRef = null;
    this._psiRef = null;
    this._ele = 0;
    this._thetaRef = null;
    this._holdI = 0;
  }
  /** Another airplane: its key feel and easy-mode limits. */
  setHandling(h = {}) {
    this.keyTable = { ...KEY_AUTHORITY, ...h.keyAuthority || {} };
    this.keyCap = { ...KEY_CAP, ...h.keyCap || {} };
    this.buffetAlpha = h.buffetAlpha ?? BUFFET_ALPHA;
    this.E = { ...EASY, ...h.easy || {} };
    this.throttleRate = h.throttleRate ?? 0.5;
    this.boostKeys = h.boostKeys ?? BINDINGS.boost;
  }
  /** Forget the held heading and bank (the airplane was put somewhere new). */
  resetHolds() {
    this._psiRef = this._phiRef = null;
    this._rudI = 0;
    this._lim.hi = this._lim.lo = null;
    this._thetaRef = null;
    this._holdI = 0;
  }
  static pressed(keys, names) {
    for (const n of names) if (keys.has(n) || keys.has(n.toLowerCase())) return true;
    return false;
  }
  /**
   * @param {object} raw
   * @param {Set<string>} raw.keys          keys currently held (KeyboardEvent.key)
   * @param {{x:number,y:number}} [raw.left]   touch left stick  (x right, y up = push forward)
   * @param {{x:number,y:number}} [raw.right]  touch right stick
   * @param {object} [raw.pad]   { axes: number[], buttons: number[] } standard mapping, values 0..1
   * @param {{x:number,y:number}|null} [raw.yoke] mouse yoke, -1..1 from screen centre
   * @param {number} dt
   * @param {object} controls  aircraft controls object, written in place
   * @param {{ qbar?: number, alpha?: number, beta?: number, yawRate?: number, rollRate?: number, pitchRate?: number, heading?: number, bank?: number, pitch?: number, loadFactor?: number, onGround?: boolean, agl?: number, climbRate?: number, retractable?: boolean }} [flight]
   *   dynamic pressure (Pa), angle of attack and sideslip (rad), yaw and roll rate (rad/s), true heading, bank and pitch (rad), load factor: for
   *   the keyboard's pilot-force model, its feel for the buffet, the auto-rudder and easy mode
   */
  update(raw, dt, controls, flight = {}) {
    const k = raw.keys || /* @__PURE__ */ new Set();
    const P2 = (b) => _ControlMapper.pressed(k, BINDINGS[b]);
    const boost = _ControlMapper.pressed(k, this.boostKeys) ? 2 : 1;
    const ramp = (cur, dir) => {
      if (dir !== 0) {
        const rate = Math.sign(cur) === -dir ? this.rampOut : boost > 1 ? this.rampIn : 1 / this.keyRamp;
        return clamp(cur + dir * rate * dt, -1, 1);
      }
      const back = this.rampOut * dt;
      return Math.abs(cur) <= back ? 0 : cur - Math.sign(cur) * back;
    };
    this.kb.aileron = ramp(this.kb.aileron, (P2("rollRight") ? 1 : 0) - (P2("rollLeft") ? 1 : 0));
    this.kb.elevator = ramp(this.kb.elevator, (P2("pitchUp") ? 1 : 0) - (P2("pitchDown") ? 1 : 0));
    this.kb.rudder = ramp(this.kb.rudder, (P2("yawRight") ? 1 : 0) - (P2("yawLeft") ? 1 : 0));
    const q = flight.qbar ?? 0;
    const soft = (h, cap) => {
      const x = Math.sqrt(Math.abs(h));
      return Math.sign(h) * x * x * (3 - 2 * x) * (boost > 1 ? 1 : cap);
    };
    let ail = soft(this.kb.aileron, this.keyCap.aileron) * keyAuthority("aileron", q, boost, this.keyTable);
    let ele = soft(this.kb.elevator, this.keyCap.elevator) * keyAuthority("elevator", q, boost, this.keyTable);
    const alpha = flight.alpha ?? 0;
    if (boost === 1 && q > 150 && !this.easy) {
      const ba = this.buffetAlpha;
      if (ele > 0 && alpha > ba) ele = Math.max(0, ele - EASE_PER_RAD * (alpha - ba));
      if (ele < 0 && alpha < -ba) ele = Math.min(0, ele - EASE_PER_RAD * (alpha + ba));
    }
    let rud = soft(this.kb.rudder, this.keyCap.rudder) * keyAuthority("rudder", q, boost, this.keyTable);
    const target = this.easy ? this._easyRudder(flight, dt) : this.autoRudder && !flight.onGround && q > 300 ? this._yawDamper(flight, dt) : 0;
    this._autoRud += (target - this._autoRud) * Math.min(1, dt * 8);
    if (this.kb.rudder === 0) rud = this._autoRud;
    else {
      this._psiRef = null;
      this._rudI = 0;
    }
    this._kbBrake = P2("brakes") ? Math.min(1, Math.max(0.5, (this._kbBrake || 0) + dt * 0.5)) : 0;
    let brake = this._kbBrake;
    let brakeL = brake, brakeR = brake;
    let elevIn = this.kb.elevator !== 0;
    const pad3 = raw.pad;
    if (pad3 && pad3.axes && pad3.axes.length >= 4) {
      const lx = dead(pad3.axes[0], 0.08), ly = dead(pad3.axes[1], 0.08), rx = dead(pad3.axes[2], 0.1), ry = dead(pad3.axes[3], 0.15);
      if (lx || ly) {
        ail = expo(lx, this.expo);
        ele = expo(ly, this.expo);
      }
      if (ly) elevIn = true;
      if (rx) rud = expo(rx, 0.3);
      if (ry) this.throttle = clamp(this.throttle - ry * 0.6 * dt, 0, 1);
      const lt = pad3.buttons?.[6] ?? 0, rt = pad3.buttons?.[7] ?? 0;
      brakeL = Math.max(brakeL, lt);
      brakeR = Math.max(brakeR, rt);
      if (pad3.buttons?.[12]) this.trim = clamp(this.trim - 0.25 * dt, -1, 1);
      if (pad3.buttons?.[13]) this.trim = clamp(this.trim + 0.25 * dt, -1, 1);
    }
    if (raw.left && (raw.left.x || raw.left.y)) {
      ail = expo(raw.left.x, this.expo);
      ele = expo(-raw.left.y, this.expo);
    }
    if (raw.left?.y) elevIn = true;
    if (raw.right && (raw.right.x || raw.right.y)) {
      rud = expo(raw.right.x, 0.3);
      this.throttle = clamp(this.throttle + raw.right.y * 0.6 * dt, 0, 1);
    }
    if (raw.yoke) {
      ail = expo(clamp(raw.yoke.x, -1, 1), this.expo);
      ele = expo(clamp(raw.yoke.y, -1, 1), this.expo);
    }
    if (raw.yoke && Math.abs(raw.yoke.y) > 0.02) elevIn = true;
    if (P2("throttleUp")) this.throttle = clamp(this.throttle + this.throttleRate * dt, 0, 1);
    if (P2("throttleDown")) this.throttle = clamp(this.throttle - this.throttleRate * dt, 0, 1);
    if (P2("throttleFull")) this.throttle = 1;
    if (P2("throttleIdle")) this.throttle = 0;
    if (P2("propUp")) this.prop = clamp(this.prop + 0.4 * dt, 0, 1);
    if (P2("propDown")) this.prop = clamp(this.prop - 0.4 * dt, 0, 1);
    if (P2("trimUp")) this.trim = clamp(this.trim + 0.25 * dt, -1, 1);
    if (P2("trimDown")) this.trim = clamp(this.trim - 0.25 * dt, -1, 1);
    if (this.easy && !elevIn) ele = this._pitchHold(flight, dt);
    else {
      this._thetaRef = null;
      this._holdI = ele;
    }
    if (!this.easy && this.autoTrim && !elevIn) this._autoTrim(flight, dt);
    ele = clamp(ele, -1, 1);
    if (this.easy) {
      const slew = this.E.slew * dt;
      if (this.E.elevPerGq && q > 0 && boost === 1) {
        const up = (this.E.gMax - 1) * this.E.elevPerGq / q, down = (1 - this.E.gMin) * this.E.elevPerGq / q;
        ele = clamp(ele, -down, up);
      }
      this._ele = clamp(ele, this._ele - slew, this._ele + slew);
      if (boost === 1) ele = this._limitAlpha(this._ele, flight, dt);
      else {
        ele = this._ele;
        this._lim.hi = this._lim.lo = null;
      }
    } else this._ele = ele;
    if (this.easy && !flight.onGround && q > 40 && ail === 0 && this.kb.aileron === 0) {
      const p = flight.rollRate ?? 0, phi = flight.bank ?? 0;
      const steep = Math.abs(flight.pitch ?? 0) > 60 * Math.PI / 180;
      if (steep) this._phiRef = null;
      else if (this._phiRef == null) this._phiRef = phi;
      const err = steep ? 0 : Math.atan2(Math.sin(this._phiRef - phi), Math.cos(this._phiRef - phi));
      const g = Math.min(1, BANK_HOLD_Q / q);
      ail = clamp(g * (2 * err - 0.25 * p), -0.6, 0.6);
    } else this._phiRef = flight.onGround ? 0 : null;
    if (!this.easy) this._lim.hi = this._lim.lo = null;
    controls.aileron = clamp(ail, -1, 1);
    controls.elevator = ele;
    controls.rudder = clamp(rud, -1, 1);
    controls.throttle = this.throttle;
    controls.prop = this.prop;
    controls.elevatorTrim = this.trim;
    controls.brakeL = brakeL;
    controls.brakeR = brakeR;
    controls.starter = P2("starter");
    controls.speedbrake = Math.max(this.speedbrake ? 1 : 0, !flight.onGround && brake ? 1 : 0);
    if (this.easy && flight.retractable && !flight.onGround) {
      const kt = Math.sqrt(2 * Math.max(0, q) / 1.225) / 0.514444;
      if (this.gear === 1 && flight.agl > 15 && flight.climbRate > 2) {
        this.gear = 0;
        this.hook = 0;
      } else if (this.gear === 0 && flight.agl < 150 && flight.climbRate < -1 && kt < 220) {
        this.gear = 1;
        this.hook = flight.hasHook ? 1 : 0;
      }
    }
    if (flight.onGround) this.gear = 1;
    controls.gear = this.gear;
    controls.hook = this.hook;
    controls.sfoils = this.sfoils;
    controls.fire = P2("fire") || !!raw.pad?.buttons?.[0] || !!raw.fire;
    return controls;
  }
  /**
   * Easy mode's α-limiter. Within 3° of the limit an integrator starts from the stick and learns the
   * elevator that holds α there; whatever asks for more (key, boost, pad) gets that instead.
   * Mirrored for pushing.
   */
  _limitAlpha(ele, flight, dt) {
    const a = flight.alpha ?? 0;
    if (this._alphaPrev != null && dt > 0) this._alphaDot += ((a - this._alphaPrev) / dt - this._alphaDot) * Math.min(1, dt * 20);
    this._alphaPrev = a;
    if ((flight.qbar ?? 0) < this.E.minQ) {
      this._lim.hi = this._lim.lo = null;
      return ele;
    }
    const pred = a + this.E.lead * this._alphaDot;
    const alphaMax = this.E.alphaMax - (flight.onGround ? this.E.liftoffMargin : 0);
    for (const sgn of [1, -1]) {
      const key = sgn > 0 ? "hi" : "lo";
      const n = flight.loadFactor ?? 1;
      const gLeft = sgn > 0 ? this.E.gMax - n : n - this.E.gMin;
      const margin = Math.min(alphaMax - sgn * pred, gLeft * this.E.radPerG);
      const e = sgn * ele;
      if (margin > 6 * Math.PI / 180) {
        this._lim[key] = null;
        continue;
      }
      const I = Math.max(-1, Math.min(1, e, (this._lim[key] ?? e) + this.E.ki * margin * dt));
      this._lim[key] = I;
      const cap = I + this.E.kp * margin;
      if (e > cap) ele = sgn * Math.max(-1, cap);
    }
    return ele;
  }
  /**
   * Easy mode's pitch hold, while nobody touches the elevator: on the take-off roll the nose comes up
   * to the climb attitude at 65 kt; in the air the pitch attitude the stick was released at is held
   * (within ±25°, and never more nose-up than the speed can carry), the elevator trimming itself through
   * an integrator. Upside down, near vertical or slow, it lets go: the α-limiter still guards the wing.
   */
  _pitchHold(flight, dt) {
    const q = flight.qbar ?? 0, theta = flight.pitch ?? 0, phi = flight.bank ?? 0;
    const qr = flight.pitchRate ?? 0;
    const D = Math.PI / 180;
    if (flight.onGround) {
      this._holdI = 0;
      this._thetaRef = q > this.E.rotateQ ? this.E.climbPitch : null;
      if (this._thetaRef == null) return 0;
    } else if (Math.abs(phi) > 80 * D || Math.abs(theta) > 80 * D || q < this.E.minQ) {
      this._thetaRef = null;
      this._holdI = 0;
      return 0;
    } else if (this._thetaRef == null) {
      this._thetaRef = clamp(theta, -25 * D, 25 * D);
    }
    const kt = Math.sqrt(2 * Math.max(0, q) / 1.225) / 0.514444;
    const [lo, hi] = this.E.holdSpeedKt;
    const thetaMax = clamp(-8 * D + (kt - lo) * (33 * D / (hi - lo)), -8 * D, 25 * D);
    const target = flight.onGround ? this._thetaRef : Math.min(this._thetaRef, thetaMax);
    const err = target - theta;
    this._holdI = clamp((this._holdI ?? 0) + this.E.holdKi * err * dt, -0.6, 0.8);
    return clamp(this._holdI + this.E.holdKp * err - this.E.holdKd * qr, -1, 1);
  }
  /** The trim run toward no pitch rate, scaled by dynamic pressure; not on the wheels, steep, upside down or slow. */
  _autoTrim(flight, dt) {
    const q = flight.qbar ?? 0, D = Math.PI / 180;
    if (flight.onGround || q < 40 || Math.abs(flight.bank ?? 0) > 60 * D || Math.abs(flight.pitch ?? 0) > 60 * D) return;
    const g = Math.min(1, TRIM_Q / q);
    this.trim = clamp(this.trim - TRIM_PER_RATE * g * (flight.pitchRate ?? 0) * dt, -1, 1);
  }
  /** Easy mode's feet: the ball centred in the air (with an integrator for the climb torque), the heading held on the ground. */
  _easyRudder(flight, dt) {
    const q = flight.qbar ?? 0, r = flight.yawRate ?? 0, psi = flight.heading ?? 0;
    if (flight.onGround) {
      this._rudI = 0;
      if (this._psiRef == null) this._psiRef = psi;
      const err = Math.atan2(Math.sin(this._psiRef - psi), Math.cos(this._psiRef - psi));
      return clamp(3 * err - 1.2 * r, -1, 1);
    }
    this._psiRef = null;
    if (q < 40) return 0;
    return this._yawDamper(flight, dt);
  }
  /**
   * The pilot's feet in the air: rudder against the swing of the nose, and gently toward no sideslip.
   * It used to push hard toward no sideslip alone: let go after a bootful of rudder, it slammed the
   * opposite pedal while the nose was already swinging back, and swung it on through, side to side.
   * Only the yaw rate's changes are damped (a turn's steady rate washes out in ~1.5 s), and scaled by
   * dynamic pressure it asks for the same yaw at any speed (and holds steady at a low frame rate).
   */
  _yawDamper(flight, dt) {
    const q = flight.qbar ?? 0, g = Math.min(1, YAW_Q / Math.max(q, 1)), r = flight.yawRate ?? 0, beta = flight.beta ?? 0;
    this._rSteady += (r - this._rSteady) * Math.min(1, dt / 1.5);
    this._rudI = clamp(this._rudI + this.yawKi * g * beta * dt, -0.6, 0.6);
    return clamp(g * (this.yawKb * beta - this.yawKr * (r - this._rSteady)) + this._rudI, -1, 1);
  }
};

// src/render/geometry.js
var fromBody = (p) => [p[1], -p[2], -p[0]];
var fromNE = (n, e, up = 0) => [e, up, -n];
var MeshBuilder = class {
  /** @param {{ uv?: boolean, color?: boolean }} [opts] optional texture coordinates and vertex colours */
  constructor(opts = {}) {
    this.positions = [];
    this.normals = [];
    this.indices = [];
    this.uvs = opts.uv ? [] : null;
    this.colors = opts.color ? [] : null;
  }
  get vertexCount() {
    return this.positions.length / 3;
  }
  vertex(p, n, uv = null, color = null) {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    if (this.uvs) this.uvs.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
    if (this.colors) this.colors.push(color ? color[0] : 255, color ? color[1] : 255, color ? color[2] : 255, 255);
    return this.vertexCount - 1;
  }
  /** Flat-shaded triangle, counter-clockwise seen from outside. */
  tri(a, b, c) {
    const n = faceNormal(a, b, c);
    const i = this.vertex(a, n);
    this.vertex(b, n);
    this.vertex(c, n);
    this.indices.push(i, i + 1, i + 2);
    return this;
  }
  /** Flat quad a-b-c-d, counter-clockwise seen from outside. */
  quad(a, b, c, d) {
    const n = faceNormal(a, b, c);
    const i = this.vertex(a, n);
    this.vertex(b, n);
    this.vertex(c, n);
    this.vertex(d, n);
    this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    return this;
  }
  /**
   * Smooth-shaded surface through rings of points (a loft). Each ring has the
   * same count; rings are joined in order, and each ring is closed on itself.
   * The faces are turned outward whichever way the rings run.
   */
  loft(rings, { closeEnds = true } = {}) {
    const m = rings[0].length;
    const centre = (r) => r.reduce((c, p) => [c[0] + p[0] / r.length, c[1] + p[1] / r.length, c[2] + p[2] / r.length], [0, 0, 0]);
    let facing = 0;
    for (let i = 0; i < rings.length - 1; i++) {
      const c0 = centre(rings[i]);
      for (let j = 0; j < m; j++) {
        const n = faceNormal(rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % m]);
        const p = rings[i][j];
        facing += n[0] * (p[0] - c0[0]) + n[1] * (p[1] - c0[1]) + n[2] * (p[2] - c0[2]);
      }
    }
    const flip = facing < 0;
    const base = this.vertexCount;
    const acc = rings.map((r) => r.map(() => [0, 0, 0]));
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < m; j++) {
        const j1 = (j + 1) % m;
        const n = faceNormal(rings[i][j], rings[i + 1][j], rings[i + 1][j1]);
        for (const [a, b] of [[i, j], [i + 1, j], [i + 1, j1], [i, j1]]) {
          acc[a][b][0] += n[0];
          acc[a][b][1] += n[1];
          acc[a][b][2] += n[2];
        }
      }
    }
    for (let i = 0; i < rings.length; i++) {
      for (let j = 0; j < m; j++) {
        const n = normalize(acc[i][j]);
        this.vertex(rings[i][j], flip ? [-n[0], -n[1], -n[2]] : n);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < m; j++) {
        const j1 = (j + 1) % m;
        const a = base + i * m + j, b = base + (i + 1) * m + j, c = base + (i + 1) * m + j1, d = base + i * m + j1;
        if (flip) this.indices.push(a, c, b, a, d, c);
        else this.indices.push(a, b, c, a, c, d);
      }
    }
    if (closeEnds) {
      const body = centre(rings.map(centre));
      const cap = (ring2) => {
        const c = centre(ring2);
        const n = faceNormal(c, ring2[0], ring2[1]);
        this.fan(ring2, n[0] * (c[0] - body[0]) + n[1] * (c[1] - body[1]) + n[2] * (c[2] - body[2]) < 0);
      };
      cap(rings[0]);
      cap(rings[rings.length - 1]);
    }
    return this;
  }
  /** Flat cap over a ring (fan from its centroid). */
  fan(ring2, reverse = false) {
    const c = [0, 0, 0];
    for (const p of ring2) {
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
    }
    c[0] /= ring2.length;
    c[1] /= ring2.length;
    c[2] /= ring2.length;
    for (let j = 0; j < ring2.length; j++) {
      const a = ring2[j], b = ring2[(j + 1) % ring2.length];
      if (reverse) this.tri(c, b, a);
      else this.tri(c, a, b);
    }
    return this;
  }
  /** A quad wound to face away from `inside` (a point inside the body it skins). */
  quadOut(a, b, c, d, inside) {
    const n = faceNormal(a, b, c);
    const m = [0, 1, 2].map((k) => (a[k] + b[k] + c[k] + d[k]) / 4 - inside[k]);
    return n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0 ? this.quad(a, b, c, d) : this.quad(a, d, c, b);
  }
  box(min, max) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    return this;
  }
  /** Vertical prism over a footprint polygon [[x, z], ...] (counter-clockwise from above). */
  prism(footprint, y0, y1) {
    const n = footprint.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = footprint[i];
      const [bx, bz] = footprint[(i + 1) % n];
      this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]);
    }
    this.fan(footprint.map(([x, z]) => [x, y1, z]), true);
    return this;
  }
  /** Append another builder, optionally transforming its points with f(p) and normals with g(n). */
  append(other, f = null, g = null) {
    const base = this.vertexCount;
    for (let i = 0; i < other.positions.length; i += 3) {
      const p = [other.positions[i], other.positions[i + 1], other.positions[i + 2]];
      const n = [other.normals[i], other.normals[i + 1], other.normals[i + 2]];
      this.vertex(f ? f(p) : p, g ? g(n) : n);
    }
    for (const i of other.indices) this.indices.push(base + i);
    return this;
  }
  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], this.positions[i + k]);
        max[k] = Math.max(max[k], this.positions[i + k]);
      }
    }
    return { min, max };
  }
};
function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return normalize([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
}
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}

// src/plugin/finishes.js
function skyColour(dx, dy, dz) {
  const l = Math.hypot(dx, dy, dz) || 1;
  const y = dy / l;
  if (y < 0) {
    const t2 = Math.min(1, -y * 4);
    return [0.55 - t2 * 0.43, 0.58 - t2 * 0.43, 0.6 - t2 * 0.5];
  }
  const t = Math.pow(y, 0.45);
  return [0.78 - t * 0.55, 0.84 - t * 0.44, 0.9 - t * 0.12];
}
function skyCube(device, S = 32) {
  const faces = [
    (u, v) => [1, -v, -u],
    (u, v) => [-1, -v, u],
    (u, v) => [u, 1, v],
    (u, v) => [u, -1, -v],
    (u, v) => [u, -v, 1],
    (u, v) => [-u, -v, -1]
  ];
  const levels = faces.map((dir) => {
    const px = new Uint8Array(S * S * 4);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const c = skyColour(...dir((i + 0.5) / S * 2 - 1, (j + 0.5) / S * 2 - 1));
      const k = (j * S + i) * 4;
      px[k] = c[0] * 255;
      px[k + 1] = c[1] * 255;
      px[k + 2] = c[2] * 255;
      px[k + 3] = 255;
    }
    return px;
  });
  return new pc.Texture(device, {
    cubemap: true,
    width: S,
    height: S,
    format: pc.PIXELFORMAT_SRGBA8,
    mipmaps: false,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    levels: [levels]
  });
}
var REFLECTANCE = 1.3;
var cube = null;
var live = null;
var cache = /* @__PURE__ */ new Map();
var reflective = /* @__PURE__ */ new Set();
function reflecting(m, probe) {
  m.cubeMap = probe && live || cube;
  if (probe) reflective.add(m);
}
function setReflectionCube(tex) {
  if (tex === live) return;
  live = tex;
  for (const m of reflective) {
    m.cubeMap = live || cube;
    m.update();
  }
}
var COAT_IOR = 1.58;
var COAT_F0 = ((COAT_IOR - 1) / (COAT_IOR + 1)) ** 2;
var FRESNEL_DEFAULT_GLSL = `
float pow5(float x) { float x2 = x * x; return x2 * x2 * x; }
vec3 getFresnel(float cosTheta, float gloss, vec3 specularity
#if defined(LIT_IRIDESCENCE)
    , vec3 iridescenceFresnel, float iridescenceIntensity
#endif
) {
    float fresnel = pow5(1.0 - saturate(cosTheta));
    float glossSq = gloss * gloss;
    float specIntensity = max(specularity.r, max(specularity.g, specularity.b));
    vec3 ret = specularity + (max(vec3(glossSq * specIntensity), specularity) - specularity) * fresnel;
#if defined(LIT_IRIDESCENCE)
    return mix(ret, iridescenceFresnel, iridescenceIntensity);
#else
    return ret;
#endif
}
`;
var FRESNEL_DEFAULT_WGSL = `
fn pow5(x: f32) -> f32 { let x2: f32 = x * x; return x2 * x2 * x; }
fn getFresnel(cosTheta: f32, gloss: f32, specularity: vec3f
#if defined(LIT_IRIDESCENCE)
    , iridescenceFresnel: vec3f, iridescenceIntensity: f32
#endif
) -> vec3f {
    let fresnel: f32 = pow5(1.0 - saturate(cosTheta));
    let glossSq: f32 = gloss * gloss;
    let specIntensity: f32 = max(specularity.r, max(specularity.g, specularity.b));
    let ret: vec3f = specularity + (max(vec3f(glossSq * specIntensity), specularity) - specularity) * fresnel;
#if defined(LIT_IRIDESCENCE)
    return mix(ret, iridescenceFresnel, iridescenceIntensity);
#else
    return ret;
#endif
}
`;
function paintCoat(m) {
  const f0 = COAT_F0.toFixed(5), f1 = (1 - COAT_F0).toFixed(5);
  m.getShaderChunks("glsl").set("fresnelSchlickPS", `${FRESNEL_DEFAULT_GLSL}
float getFresnelCC(float cosTheta) { return ${f0} + ${f1} * pow5(1.0 - saturate(cosTheta)); }
`);
  m.getShaderChunks("wgsl").set("fresnelSchlickPS", `${FRESNEL_DEFAULT_WGSL}
fn getFresnelCC(cosTheta: f32) -> f32 { return ${f0} + ${f1} * pow5(1.0 - saturate(cosTheta)); }
`);
}
function paintMaterial(device, colour, satin = false, probe = true) {
  const key = `paint${colour}${satin}${probe}`;
  if (cache.has(key)) return cache.get(key);
  cube ??= skyCube(device);
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color().fromString(colour);
  m.useMetalness = true;
  m.metalness = 0;
  const matte = satin === "matte";
  m.gloss = matte ? 0.3 : satin ? 0.55 : 0.82;
  m.clearCoat = matte ? 0 : satin ? 0.25 : 1;
  m.clearCoatGloss = satin ? 0.7 : 0.93;
  if (!matte) paintCoat(m);
  reflecting(m, probe);
  m.update();
  cache.set(key, m);
  return m;
}
function texturedPaintMaterial(device, src, fallback = "#8b9096", shade = 1) {
  if (!src) return paintMaterial(device, fallback, "matte");
  const key = `texpaint${src.id}${shade}`;
  if (cache.has(key)) return cache.get(key);
  cube ??= skyCube(device);
  const m = src.clone();
  m.metalness = 1;
  m.gloss = 1;
  m.clearCoat = 0;
  if (shade !== 1) m.diffuse = new pc.Color(shade, shade, shade);
  reflecting(m, true);
  m.update();
  cache.set(key, m);
  return m;
}
function metalMaterial(device, colour, polished = false, probe = false) {
  const key = `metal${colour}${polished}${probe}`;
  if (cache.has(key)) return cache.get(key);
  cube ??= skyCube(device);
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color().fromString(colour);
  m.useMetalness = true;
  m.metalness = 1;
  m.gloss = polished ? 0.9 : 0.6;
  reflecting(m, probe);
  m.reflectivity = REFLECTANCE;
  m.update();
  cache.set(key, m);
  return m;
}
function glassMaterial(device, tint, probe = false) {
  const key = `glass${tint}${probe}`;
  if (cache.has(key)) return cache.get(key);
  cube ??= skyCube(device);
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color().fromString(tint);
  m.opacity = 0.22;
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = 0.96;
  reflecting(m, probe);
  m.reflectivity = REFLECTANCE;
  m.opacityFadesSpecular = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  cache.set(key, m);
  return m;
}
function glassTintMaterial(device, tint, opacity = 0.1) {
  const key = `glassTint${tint}${opacity}`;
  if (cache.has(key)) return cache.get(key);
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color().fromString(tint);
  m.opacity = opacity;
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.useMetalness = false;
  m.specular = new pc.Color(0, 0, 0);
  m.cull = pc.CULLFACE_NONE;
  m.update();
  cache.set(key, m);
  return m;
}
function glassFilterMaterial(device, transmittance) {
  const key = `glassFilter${transmittance.join()}`;
  if (cache.has(key)) return cache.get(key);
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.useFog = false;
  m.useSkybox = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(...transmittance);
  m.blendType = pc.BLEND_MULTIPLICATIVE;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  cache.set(key, m);
  return m;
}
var FRESNEL_GLSL = `
float pow5(float x) { float x2 = x * x; return x2 * x2 * x; }
vec3 getFresnel(float cosTheta, float gloss, vec3 specularity
#if defined(LIT_IRIDESCENCE)
    , vec3 iridescenceFresnel, float iridescenceIntensity
#endif
) {
    return specularity + (1.0 - specularity) * pow5(1.0 - saturate(cosTheta));
}
float getFresnelCC(float cosTheta) { return 0.04 + 0.96 * pow5(1.0 - saturate(cosTheta)); }
`;
var FRESNEL_WGSL = `
fn pow5(x: f32) -> f32 { let x2: f32 = x * x; return x2 * x2 * x; }
fn getFresnel(cosTheta: f32, gloss: f32, specularity: vec3f
#if defined(LIT_IRIDESCENCE)
    , iridescenceFresnel: vec3f, iridescenceIntensity: f32
#endif
) -> vec3f {
    return specularity + (vec3f(1.0) - specularity) * pow5(1.0 - saturate(cosTheta));
}
fn getFresnelCC(cosTheta: f32) -> f32 { return 0.04 + 0.96 * pow5(1.0 - saturate(cosTheta)); }
`;
var SUN_RADIANCE = 10;
var sunSpecGlsl = (radiance) => `
float calcLightSpecular(float gloss, vec3 worldNormal, vec3 h) {
    float nh = max(dot(h, worldNormal), 0.0);
    float specPow = max(exp2(gloss * 11.0), 0.0001);
    return pow(nh, specPow) * (specPow + 2.0) / 8.0 * ${radiance.toFixed(1)};
}
float getLightSpecular(vec3 h, vec3 reflDir, vec3 worldNormal, vec3 viewDir, vec3 lightDirNorm, float gloss, mat3 tbn) {
    return calcLightSpecular(gloss, worldNormal, h);
}
`;
var sunSpecWgsl = (radiance) => `
fn calcLightSpecular(gloss: f32, worldNormal: vec3f, h: vec3f) -> f32 {
    let nh: f32 = max(dot(h, worldNormal), 0.0);
    let specPow: f32 = max(exp2(gloss * 11.0), 0.0001);
    return pow(nh, specPow) * (specPow + 2.0) / 8.0 * ${radiance.toFixed(1)};
}
fn getLightSpecular(h: vec3f, reflDir: vec3f, worldNormal: vec3f, viewDir: vec3f, lightDirNorm: vec3f, gloss: f32, tbn: mat3x3f) -> f32 {
    return calcLightSpecular(gloss, worldNormal, h);
}
`;
var FRESNEL_GOLD_GLSL = `
float pow5(float x) { float x2 = x * x; return x2 * x2 * x; }
vec3 getFresnel(float cosTheta, float gloss, vec3 specularity
#if defined(LIT_IRIDESCENCE)
    , vec3 iridescenceFresnel, float iridescenceIntensity
#endif
) {
    float x = 1.0 - saturate(cosTheta), x2 = x * x;
    vec3 graze = mix(specularity * (0.85 / max(specularity.r, 0.001)), vec3(0.85), 0.45);
    return specularity + (graze - specularity) * (x2 * x2);
}
float getFresnelCC(float cosTheta) { return 0.04 + 0.96 * pow5(1.0 - saturate(cosTheta)); }
`;
var FRESNEL_GOLD_WGSL = `
fn pow5(x: f32) -> f32 { let x2: f32 = x * x; return x2 * x2 * x; }
fn getFresnel(cosTheta: f32, gloss: f32, specularity: vec3f
#if defined(LIT_IRIDESCENCE)
    , iridescenceFresnel: vec3f, iridescenceIntensity: f32
#endif
) -> vec3f {
    let x: f32 = 1.0 - saturate(cosTheta);
    let x2: f32 = x * x;
    let graze: vec3f = mix(specularity * (0.85 / max(specularity.r, 0.001)), vec3f(0.85), 0.45);
    return specularity + (graze - specularity) * (x2 * x2);
}
fn getFresnelCC(cosTheta: f32) -> f32 { return 0.04 + 0.96 * pow5(1.0 - saturate(cosTheta)); }
`;
function glassReflectionMaterial(device, f0 = 0.06, gold = false) {
  const key = `glassReflection${f0}${gold}`;
  if (cache.has(key)) return cache.get(key);
  cube ??= skyCube(device);
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(0, 0, 0);
  m.ambient = new pc.Color(0, 0, 0);
  m.useMetalness = false;
  m.specular = gold ? new pc.Color(f0 * 1.15, f0 * 0.85, f0 * 0.42) : new pc.Color(f0, f0, f0);
  m.gloss = gold ? 0.94 : 0.88;
  m.occludeSpecular = pc.SPECOCC_NONE;
  m.getShaderChunks("glsl").set("fresnelSchlickPS", gold ? FRESNEL_GOLD_GLSL : FRESNEL_GLSL);
  m.getShaderChunks("wgsl").set("fresnelSchlickPS", gold ? FRESNEL_GOLD_WGSL : FRESNEL_WGSL);
  const sun = gold ? SUN_RADIANCE * 0.4 : SUN_RADIANCE;
  m.getShaderChunks("glsl").set("lightSpecularBlinnPS", sunSpecGlsl(sun));
  m.getShaderChunks("wgsl").set("lightSpecularBlinnPS", sunSpecWgsl(sun));
  reflecting(m, true);
  m.reflectivity = REFLECTANCE;
  m.blendType = pc.BLEND_ADDITIVE;
  m.depthWrite = false;
  m.update();
  cache.set(key, m);
  return m;
}
function mirrorMaterial(device) {
  const key = "mirror";
  if (cache.has(key)) return cache.get(key);
  cube ??= skyCube(device);
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(1, 1, 1);
  m.useMetalness = true;
  m.metalness = 1;
  m.gloss = 1;
  reflecting(m, true);
  m.update();
  cache.set(key, m);
  return m;
}
function flameMaterial(colour) {
  const key = `flame${colour}`;
  if (cache.has(key)) return cache.get(key);
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color().fromString(colour);
  m.emissiveIntensity = 2.2;
  m.useLighting = false;
  m.useFog = false;
  m.blendType = pc.BLEND_ADDITIVEALPHA;
  m.opacity = 0.35;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  bendable(m);
  m.update();
  cache.set(key, m);
  return m;
}
function bendable(m) {
  try {
    const dev = pc.app.graphicsDevice;
    const g = pc.ShaderChunks.get(dev, "glsl").get("transformCoreVS");
    const a = "vec3 localPos = vertexPosition;", fa = "vec3 getLocalPosition(vec3 vertexPosition) {";
    if (g?.includes(a) && g.includes(fa)) {
      m.getShaderChunks("glsl").set("transformCoreVS", g.replace(fa, "uniform vec2 plume_bend;\n" + fa).replace(a, a + "\n	localPos.xy += plume_bend * (localPos.z * localPos.z);"));
    }
    const w = pc.ShaderChunks.get(dev, "wgsl").get("transformCoreVS");
    const b = "var localPos: vec3f = vertexPosition;", fb = "fn getLocalPosition(vertexPosition: vec3f) -> vec3f {";
    if (w?.includes(b) && w.includes(fb)) {
      m.getShaderChunks("wgsl").set("transformCoreVS", w.replace(fb, "uniform plume_bend: vec2f;\n" + fb).replace(b, b + "\n		localPos = vec3f(localPos.xy + uniform.plume_bend * (localPos.z * localPos.z), localPos.z);"));
    }
    m.setParameter("plume_bend", [0, 0]);
  } catch {
  }
}
function propDiscMaterial(dev) {
  const key = "propDisc";
  if (cache.has(key)) return cache.get(key);
  const S = 256, px = new Uint8Array(S * S * 4);
  const TAU2 = Math.PI * 2;
  const sm = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = (i + 0.5) / S * 2 - 1, y = (j + 0.5) / S * 2 - 1, r = Math.hypot(x, y), k = (j * S + i) * 4;
      if (r > 1 || r < 0.1) {
        px[k + 3] = 0;
        continue;
      }
      const th = Math.atan2(y, x);
      const film = 0.18 * sm(0.1, 0.3, r) * (1.15 - 0.35 * r);
      let arcs = 0;
      for (let b = 0; b < 3; b++) {
        let p = th - b * TAU2 / 3 - 0.3 * r * r;
        p = (p % TAU2 + TAU2) % TAU2;
        const d = Math.min(p, TAU2 - p);
        arcs += Math.exp(-((d / 0.55) ** 2)) * 0.26 * (1.1 - 0.6 * r);
      }
      const edge = 1 - sm(0.8, 1, r);
      const tip = Math.exp(-(((r - 0.935) / 0.028) ** 2));
      const a = Math.min(1, (film + arcs * sm(0.12, 0.3, r)) * edge + 0.03 * tip);
      const yellow = Math.min(0.6, tip);
      px[k] = Math.round(34 + (232 - 34) * yellow);
      px[k + 1] = Math.round(36 + (196 - 36) * yellow);
      px[k + 2] = Math.round(42 + (48 - 42) * yellow);
      px[k + 3] = Math.round(255 * a);
    }
  }
  const tex = new pc.Texture(dev, {
    name: "extra300-prop-disc",
    width: S,
    height: S,
    format: pc.PIXELFORMAT_SRGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE
  });
  tex.lock().set(px);
  tex.unlock();
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseMap = tex;
  m.opacityMap = tex;
  m.opacityMapChannel = "a";
  m.opacity = 1;
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.twoSidedLighting = true;
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = 0.25;
  m.update();
  m._ownTex = tex;
  cache.set(key, m);
  return m;
}
function plumeMaterial() {
  const key = "plume";
  if (cache.has(key)) return cache.get(key);
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveVertexColor = true;
  m.emissiveIntensity = 1.2;
  m.useLighting = false;
  m.useFog = false;
  m.useSkybox = false;
  m.blendType = pc.BLEND_ADDITIVE;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  bendable(m);
  m.update();
  cache.set(key, m);
  return m;
}
function disposeFinishes() {
  for (const m of cache.values()) {
    m._ownTex?.destroy();
    m.destroy?.();
  }
  cache.clear();
  reflective.clear();
  live = null;
  cube?.destroy?.();
  cube = null;
}

// src/plugin/pcMesh.js
var materialCache = /* @__PURE__ */ new Map();
function material(color, { transparent = false, opacity = 1, emissive = null, twoSided = true, scope = "" } = {}) {
  const key = `${color}|${transparent}|${opacity}|${emissive}|${twoSided}|${scope}`;
  if (materialCache.has(key)) return materialCache.get(key);
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color().fromString(color);
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = transparent ? 0.9 : 0.35;
  m.reflectivity = REFLECTANCE;
  if (emissive) {
    m.emissive = new pc.Color().fromString(emissive);
  }
  if (twoSided) m.cull = pc.CULLFACE_NONE;
  if (transparent) {
    m.blendType = pc.BLEND_NORMAL;
    m.opacity = opacity;
    m.depthWrite = false;
  }
  m.update();
  materialCache.set(key, m);
  return m;
}
function disposeMaterials() {
  for (const m of materialCache.values()) m.destroy?.();
  materialCache.clear();
}
function toMesh(device, mb) {
  const mesh = new pc.Mesh(device);
  mesh.setPositions(new Float32Array(mb.positions));
  mesh.setNormals(new Float32Array(mb.normals));
  if (mb.uvs) mesh.setUvs(0, new Float32Array(mb.uvs));
  if (mb.colors) mesh.setColors32(new Uint8Array(mb.colors));
  const idx = mb.vertexCount > 65535 ? new Uint32Array(mb.indices) : new Uint16Array(mb.indices);
  mesh.setIndices(idx);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}
function mergeBuilders(device, pieces) {
  let nv = 0, ni = 0;
  for (const { mb } of pieces) {
    nv += mb.vertexCount;
    ni += mb.indices.length;
  }
  const pos2 = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Uint8Array(nv * 4).fill(255);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new pc.Vec3(), w = new pc.Vec3();
  let bv = 0, bi = 0;
  for (const { mb, m } of pieces) {
    for (let k = 0; k < mb.vertexCount; k++) {
      v.set(mb.positions[k * 3], mb.positions[k * 3 + 1], mb.positions[k * 3 + 2]);
      if (m) m.transformPoint(v, w);
      else w.copy(v);
      pos2[(bv + k) * 3] = w.x;
      pos2[(bv + k) * 3 + 1] = w.y;
      pos2[(bv + k) * 3 + 2] = w.z;
      v.set(mb.normals[k * 3], mb.normals[k * 3 + 1], mb.normals[k * 3 + 2]);
      if (m) m.transformVector(v, w).normalize();
      else w.copy(v);
      nor[(bv + k) * 3] = w.x;
      nor[(bv + k) * 3 + 1] = w.y;
      nor[(bv + k) * 3 + 2] = w.z;
    }
    if (mb.uvs) uv.set(mb.uvs.slice(0, mb.vertexCount * 2), bv * 2);
    if (mb.colors) col.set(mb.colors.slice(0, mb.vertexCount * 4), bv * 4);
    for (let k = 0; k < mb.indices.length; k++) idx[bi + k] = mb.indices[k] + bv;
    bv += mb.vertexCount;
    bi += mb.indices.length;
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(pos2);
  mesh.setNormals(nor);
  mesh.setUvs(0, uv);
  mesh.setColors32(col);
  mesh.setIndices(idx);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return { mesh, pos: pos2, idx };
}
function meshEntity(app, parent, name, mb, mat, { castShadows = true, receiveShadows = true } = {}) {
  const e = new pc.Entity(name);
  if (!mb.vertexCount) {
    parent.addChild(e);
    return e;
  }
  const mi = new pc.MeshInstance(toMesh(app.graphicsDevice, mb), mat);
  e.addComponent("render", { meshInstances: [mi], castShadows, receiveShadows });
  parent.addChild(e);
  return e;
}

// src/sim/aircraft/extra300l.js
var span = 8;
var rootChord = 1.86;
var tipChord = 0.82;
var semi = span / 2;
var leRoot = 0.5;
var leSweep = 0.24;
var wingLE = (y) => leRoot - leSweep * Math.abs(y) / semi;
var wingChord = (y) => rootChord + (tipChord - rootChord) * Math.abs(y) / semi;
function wingSegments(n = 6, yInner = 0) {
  const segs = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const y0 = yInner + (semi - yInner) * i / n;
      const y1 = yInner + (semi - yInner) * (i + 1) / n;
      const ym = 0.5 * (y0 + y1);
      const c = wingChord(ym);
      segs.push({
        name: `wing${side < 0 ? "L" : "R"}${i}`,
        group: "wing",
        side,
        pos: [wingLE(ym) - 0.25 * c, side * ym, 0.2],
        // low wing: chord plane 0.2 m below R
        chord: c,
        area: (y1 - y0) * c,
        span: [0, 1, 0],
        // spanwise axis (same for both sides so lift is up)
        // Sign conventions (checked in tests/aero.test.js): stick right = +aileron rolls right,
        // stick back = +elevator pitches up, right pedal = +rudder yaws right.
        normal: [0, 0, -1],
        // lift-positive normal
        // [pub] ailerons nearly full span; [est] 30 % chord
        control: ym > 0.75 ? { input: "aileron", sign: -side, chordFrac: 0.3, maxDefl: 27 * DEG } : null
        // [tune] roll rate test
      });
    }
  }
  return segs;
}
var EXTRA_300L = {
  name: "Extra 300L",
  // ── geometry ────────────────────────────────────────────────────────────
  wing: { span, area: 10.7, mac: 1.407, aspect: span * span / 10.7, oswald: 0.82 },
  // [pub] S, b; [est] e
  // ── mass & balance ──────────────────────────────────────────────────────
  mass: {
    empty: { m: 667, pos: [0.06, 0, 0.05] },
    // [pub] ~667 kg; [est] empty CG
    // Ixx, Iyy, Izz about the empty CG [est] radii of gyration for a light aerobatic airframe
    inertiaEmpty: { xx: 360, yy: 760, zz: 1060, xz: 25 },
    items: {
      pilot: { m: 85, pos: [-1.05, 0, -0.35] },
      // rear seat [est]
      passenger: { m: 0, pos: [0.25, 0, -0.35] },
      // front seat
      fuelCenter: { capacityL: 60, pos: [0.85, 0, -0.1] },
      // [pub] 60 L aerobatic tank, ahead of the front seat
      fuelWings: { capacityL: 120, pos: [-0.1, 0, 0.05] },
      // [pub] 2×60 L wing tanks (empty for aerobatics)
      baggage: { m: 0, pos: [-1.7, 0, -0.2] }
    },
    fuelDensity: 0.72,
    // kg/L avgas
    mtow: 950,
    mtowAcro: 870
    // [pub]
  },
  // ── aerodynamic surfaces (component build-up) ───────────────────────────
  aero: {
    // Lift slope of the finite surfaces, per radian [est] from AR via Helmbold
    surfaces: [
      ...wingSegments(6, 0),
      // Horizontal tail [est] 3.2 m span, 2.5 m², elevator 45 % chord
      ...[-1, 1].flatMap((side) => [0, 1].map((i) => ({
        name: `htail${side < 0 ? "L" : "R"}${i}`,
        group: "htail",
        side,
        pos: [-3.95, side * (0.4 + 0.8 * i), -0.15],
        chord: 0.82 - 0.12 * i,
        area: 0.8 * (0.82 - 0.12 * i),
        span: [0, 1, 0],
        normal: [0, 0, -1],
        control: { input: "elevator", sign: -1, chordFrac: 0.45, maxDefl: 25 * DEG },
        downwash: true,
        propwash: i === 0 ? 0.9 : 0.35
      }))),
      // Vertical tail [est] 1.25 m² with a 50 % chord rudder
      ...[0, 1].map((i) => ({
        name: `vtail${i}`,
        group: "vtail",
        side: 0,
        pos: [-4.05 - 0.1 * i, 0, -0.35 - 0.55 * i],
        chord: 1.05 - 0.25 * i,
        area: 0.55 * (1.05 - 0.25 * i) + (i === 0 ? 0.08 : 0),
        span: [0, 0, -1],
        normal: [0, -1, 0],
        control: { input: "rudder", sign: 1, chordFrac: 0.5, maxDefl: 30 * DEG },
        propwash: i === 0 ? 0.9 : 0.5,
        swirl: true
      }))
    ],
    groupData: {
      // a: 3D lift slope /rad; stall: section stall angle; cd0: profile drag
      // [tune] wing CLmax = a·stall ≈ 1.43 — power-off stall test (thick symmetric MA 15 S/12 S)
      wing: { a: 4.55, stall: 18 * DEG, cd0: 85e-4, e: 0.82, aspect: 6 },
      htail: { a: 3.7, stall: 18 * DEG, cd0: 95e-4, e: 0.8, aspect: 4.1 },
      vtail: { a: 2.6, stall: 22 * DEG, cd0: 95e-4, e: 0.7, aspect: 1.6 }
    },
    downwash: { deda: 0.42 },
    // [est] dε/dα at the tail
    // Fuselage, gear, cooling, canopy as an equivalent body [tune] Vmax test
    body: {
      dragArea: 0.205,
      // m² flat-plate equivalent
      sideArea: 3.6,
      sideSlope: 0.9,
      // side force, knife-edge [est]
      topArea: 2.2,
      topSlope: 0.6,
      pos: [0.15, 0, -0.05]
    },
    groundEffect: true
  },
  // ── engine: Lycoming AEIO-540-L1B5 ──────────────────────────────────────
  engine: {
    ratedPower: 300 * HP,
    // [pub] 300 hp
    ratedRpm: 2700,
    // [pub]
    idleRpm: 700,
    // [pub] POH idle ~700
    frictionPowerRated: 42 * HP,
    // [est] friction+pumping at rated rpm
    mpZeroWork: 9.3 * INHG,
    // [tune] manifold pressure below which no net indicated work
    intakeLossFull: 1 * INHG,
    // [est] full-throttle manifold loss, static
    idleMp: 11.5 * INHG,
    // [est] MP at idle rpm, throttle closed
    rotInertia: 1.75,
    // kg m² prop + crank [est] MT 3-blade composite
    rotation: 1,
    // +1: clockwise seen from the cockpit (Lycoming)
    bsfc: 0.47,
    // lb/hp/h at best power [est]
    fuelInverted: true,
    // Christen inverted fuel & oil
    starterTorque: 120,
    // N m at the prop
    oil: { capacityQt: 16, tempNormal: 82, pressNormal: 75 }
  },
  // ── propeller: MT-Propeller MTV-9-B-C, 3 blades, constant speed ─────────
  prop: {
    pos: [2.05, 0, 0],
    // [est] disc centre
    diameter: 1.98,
    // [pub] MTV-9-B/198-25 (198 cm)
    blades: 3,
    discEfficiency: 0.55,
    // [tune] hub, tip and swirl losses; static thrust ≈ 5.5 kN (~4 lbf/hp)
    chord75: 0.125,
    // [tune] static thrust & full-power climb
    betaFine: 17.5 * DEG,
    // [tune] full-throttle static rpm ~2,650 on the fine stop
    betaCoarse: 42 * DEG,
    governor: { gain: 45e-4, damping: 12e-4, rateLimit: 18 * DEG, rpmMin: 2e3, rpmMax: 2700 },
    pFactor: 0.12
    // thrust-line offset per radian of disc AoA, in radii [est]
  },
  // ── landing gear (spring-steel/composite mains, steerable tailwheel) ────
  gear: {
    // pos = wheel contact point with the strut fully extended
    // brakes: full pedal is ~0.35 g from 50 kt (stopped in ~90 m), the tail kept down (1250 N·m stood it on its prop at a
    // quarter); the parking brake holds full power, as it did
    units: [
      {
        name: "mainL",
        pos: [0.55, -0.93, 1.33],
        k: 62e3,
        c: 4200,
        travel: 0.2,
        tyre: { mu: 0.85, rolling: 0.03, radius: 0.18 },
        brake: "left",
        maxBrakeTorque: 225,
        parkBrakeTorque: 1250
      },
      {
        name: "mainR",
        pos: [0.55, 0.93, 1.33],
        k: 62e3,
        c: 4200,
        travel: 0.2,
        tyre: { mu: 0.85, rolling: 0.03, radius: 0.18 },
        brake: "right",
        maxBrakeTorque: 225,
        parkBrakeTorque: 1250
      },
      {
        name: "tail",
        pos: [-4.45, 0, 0.42],
        k: 16e3,
        c: 900,
        travel: 0.12,
        tyre: { mu: 0.7, rolling: 0.04, radius: 0.08 },
        steer: { maxAngle: 30 * DEG, input: "rudder", sign: -1 }
      }
    ],
    // hard points that touch the ground in a ground loop or a nose-over
    scrape: [
      { name: "propTip", pos: [2.1, 0, 0.99], mu: 0.5, k: 12e4, c: 6e3 },
      { name: "wingtipL", pos: [-0.2, -4, 0.15], mu: 0.5, k: 6e4, c: 3e3 },
      { name: "wingtipR", pos: [-0.2, 4, 0.15], mu: 0.5, k: 6e4, c: 3e3 },
      { name: "rudderBottom", pos: [-4.65, 0, 0.12], mu: 0.5, k: 6e4, c: 3e3 }
    ]
  },
  // ── limits & V-speeds for the gauges ────────────────────────────────────
  limits: {
    vso: 55,
    vs1: 55,
    vfe: null,
    va: 158,
    vno: 158,
    vne: 219,
    // KIAS [pub]
    gPos: 10,
    gNeg: -10,
    // solo, acrobatic category [pub]
    rpmRedline: 2700,
    mpMax: 30
  },
  // ground-adjustable trim tabs, set so it flies hands-off at cruise power [tune]
  // tests/performance.test.js "hands off at cruise"
  rigging: { aileron: 6e-3, rudder: 0.03 },
  // where the pilot's eyes are (rear seat) for the cockpit camera: under the canopy's highest point,
  // a hand's width below it (three-view: canopy top 0.71 m above the thrust line) [est]
  eye: [-1.12, 0, -0.6]
};
var extra300l_default = EXTRA_300L;

// src/render/data/extra300lModel.js (fetched by the entry)
var EXTRA300L_MODEL = null;
var EXTRA300L_MODEL_URL = "https://ugc.arrival.space/42485456/plugins/vibes/extra300l-model-1792955578.bin";

// src/render/extraModel.js
var POS_SCALE = 4096;
function bytesOf(b64) {
  if (typeof b64 !== "string") return b64;
  if (typeof atob === "function") return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(b64, "base64"));
}
function decodeModel(b64 = EXTRA300L_MODEL) {
  const u8 = bytesOf(b64);
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const hl = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  const head = 4 + hl, pad3 = (4 - head % 4) % 4;
  const nvAll = header.parts.reduce((s, p) => s + p.nv, 0), niAll = header.parts.reduce((s, p) => s + p.ni, 0);
  const P2 = new Int16Array(buf, head + pad3, nvAll * 3);
  const I = new Uint16Array(buf, head + pad3 + nvAll * 6, niAll);
  const N5 = new Int8Array(buf, head + pad3 + nvAll * 6 + niAll * 2, nvAll * 3);
  const scale = header.posScale || POS_SCALE;
  let pv = 0, pi = 0;
  const parts = header.parts.map(({ nv, ni, ...meta }) => {
    const mb = new MeshBuilder();
    for (let v = 0; v < nv; v++) {
      const k = (pv + v) * 3;
      mb.positions.push(...fromBody([P2[k] / scale, P2[k + 1] / scale, P2[k + 2] / scale]));
      mb.normals.push(...fromBody([N5[k] / 127, N5[k + 1] / 127, N5[k + 2] / 127]));
    }
    for (let i = 0; i < ni; i++) mb.indices.push(I[pi + i]);
    pv += nv;
    pi += ni;
    return { ...meta, mesh: mb };
  });
  return { eye: header.eye, parts };
}
function propDisc() {
  const mb = new MeshBuilder({ uv: true });
  const R3 = extra300l_default.prop.diameter / 2, n = 48;
  const nrm = fromBody([1, 0, 0]);
  const c = mb.vertex(fromBody([0, 0, 0]), nrm, [0.5, 0.5]);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, y = Math.cos(a), z = Math.sin(a);
    mb.vertex(fromBody([0, R3 * y, R3 * z]), nrm, [0.5 + 0.5 * y, 0.5 + 0.5 * z]);
  }
  for (let i = 0; i < n; i++) mb.indices.push(c, c + 1 + i, c + 1 + (i + 1) % n);
  return mb;
}
function buildExtraModel() {
  const { parts } = decodeModel();
  const prop = parts.find((p) => p.kind === "prop");
  parts.push({ name: "propDisc", color: "#1b1d22", mesh: propDisc(), hinge: prop.hinge, axis: [1, 0, 0], kind: "propDisc", transparent: true });
  return parts;
}

// src/render/cameraRig.js
var VIEWS = ["cockpit", "chase", "tower", "flyby", "deck"];
function simToRenderQuat(q) {
  return [q[2], -q[3], -q[1], q[0]];
}
var nedToRender = (p) => [p[1], -p[2], -p[0]];
var qmul = (a, b) => {
  const r = qMul([a[3], a[0], a[1], a[2]], [b[3], b[0], b[1], b[2]]);
  return [r[1], r[2], r[3], r[0]];
};
var axisAngle = (ax, ay, az, ang) => {
  const s = Math.sin(ang / 2);
  return [ax * s, ay * s, az * s, Math.cos(ang / 2)];
};
var rotateVec = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
function lookRotation(eye, target, up = [0, 1, 0]) {
  let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  const zx = -fx, zy = -fy, zz = -fz;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl;
  xy /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const tr = xx + yy + zz;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(yz - zy) / s, (zx - xz) / s, (xy - yx) / s, 0.25 * s];
  } else if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    q = [0.25 * s, (yx + xy) / s, (zx + xz) / s, (yz - zy) / s];
  } else if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    q = [(yx + xy) / s, 0.25 * s, (zy + yz) / s, (zx - xz) / s];
  } else {
    const s = Math.sqrt(1 + zz - xx - yy) * 2;
    q = [(zx + xz) / s, (zy + yz) / s, 0.25 * s, (xy - yx) / s];
  }
  const n = qNormalize([q[3], q[0], q[1], q[2]]);
  return [n[1], n[2], n[3], n[0]];
}
var CameraRig = class {
  constructor({ eye, towerPos, size = 1 }) {
    this.eye = eye;
    this.size = size;
    this.towerPos = towerPos;
    this.deckPos = null;
    this.view = "cockpit";
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.chasePos = null;
    this.flybyPos = null;
    this.fov = 70;
    this.chaseScale = 1;
    this.fovScale = 1;
  }
  /** Mouse wheel: steps > 0 zoom out (the chase camera backs off, the others widen), < 0 zoom in. */
  zoom(steps) {
    const f = Math.pow(1.12, steps);
    if (this.view === "chase") this.chaseScale = Math.max(0.35, Math.min(6, this.chaseScale * f));
    else this.fovScale = Math.max(0.3, Math.min(1.3, this.fovScale * f));
  }
  cycle() {
    do
      this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length];
    while (this.view === "deck" && !this.deckPos);
    this.chasePos = null;
    this.flybyPos = null;
    return this.view;
  }
  look(dYaw, dPitch) {
    this.lookYaw = this.view === "chase" ? (this.lookYaw + dYaw) % (2 * Math.PI) : Math.max(-2.6, Math.min(2.6, this.lookYaw + dYaw));
    this.lookPitch = Math.max(-1.2, Math.min(1.3, this.lookPitch + dPitch));
  }
  centre() {
    this.lookYaw = 0;
    this.lookPitch = 0;
  }
  /**
   * A camera at body-axes point `eye` looking at body-axes point `at` (both from R, as the model is
   * built), carried along with the airplane: the intro's shots.
   */
  bodyPose(ac, eye, at, fov, cg = [0, 0, 0], tilt = 0) {
    const pos2 = nedToRender(ac.state.pos);
    const rot = simToRenderQuat(ac.state.q);
    const toWorld = (p) => {
      const o = rotateVec(rot, fromBody([p[0] - cg[0], p[1] - cg[1], p[2] - cg[2]]));
      return [pos2[0] + o[0], pos2[1] + o[1], pos2[2] + o[2]];
    };
    const e = toWorld(eye), t = toWorld(at);
    const rot0 = lookRotation(e, t);
    return { pos: e, rot: tilt ? qmul(rot0, axisAngle(1, 0, 0, tilt)) : rot0, fov };
  }
  /**
   * @param {object} ac  aircraft (sim) — state.pos (NED), state.q, state.vel
   * @param {number} dt
   * @returns {{ pos: number[], rot: number[], fov: number }} render space, metres
   */
  update(ac, dt, cg = [0, 0, 0]) {
    const st = ac.state;
    const pos2 = nedToRender(st.pos);
    const rot = simToRenderQuat(st.q);
    if (this.view === "cockpit") {
      const e = fromBody([this.eye[0] - cg[0], this.eye[1] - cg[1], this.eye[2] - cg[2]]);
      const eo = rotateVec(rot, e);
      const look = qmul(axisAngle(0, 1, 0, this.lookYaw), axisAngle(1, 0, 0, this.lookPitch));
      return { pos: [pos2[0] + eo[0], pos2[1] + eo[1], pos2[2] + eo[2]], rot: qmul(rot, look), fov: 72 * this.fovScale };
    }
    if (this.view === "chase") {
      const v2 = nedToRender(st.vel);
      const sp2 = Math.hypot(v2[0], v2[1], v2[2]);
      const nose = rotateVec(rot, [0, 0, -1]);
      const dir = sp2 > 8 ? [v2[0] / sp2, v2[1] / sp2, v2[2] / sp2] : nose;
      const D = 14 * this.size * this.chaseScale, H4 = 3.2 * this.size * this.chaseScale;
      const want = [-dir[0] * D, -dir[1] * D + H4, -dir[2] * D];
      if (!this.chasePos) this.chasePos = want;
      const k = 1 - Math.exp(-dt * 4.5);
      for (let i = 0; i < 3; i++) this.chasePos[i] += (want[i] - this.chasePos[i]) * k;
      const off = this.chasePos;
      const r = Math.hypot(D, H4);
      const az = Math.atan2(off[0], off[2]) + this.lookYaw;
      const el = Math.max(-1.45, Math.min(1.45, Math.asin(off[1] / (Math.hypot(off[0], off[1], off[2]) || 1)) - this.lookPitch));
      const cam = [pos2[0] + r * Math.cos(el) * Math.sin(az), pos2[1] + r * Math.sin(el), pos2[2] + r * Math.cos(el) * Math.cos(az)];
      cam[1] = Math.max(cam[1], groundUnder(ac, cam) + 1);
      return { pos: cam, rot: lookRotation(cam, pos2), fov: 60 };
    }
    if (this.view === "tower" || this.view === "deck" && this.deckPos) {
      const t = this.view === "deck" ? this.deckPos : this.towerPos;
      const d = Math.hypot(pos2[0] - t[0], pos2[1] - t[1], pos2[2] - t[2]);
      const fov = Math.max(2, Math.min(80, 2 * Math.atan(30 / Math.max(d, 1)) * 180 / Math.PI * this.fovScale));
      return { pos: t.slice(), rot: lookRotation(t, pos2), fov };
    }
    const v = nedToRender(st.vel);
    const sp = Math.hypot(v[0], v[1], v[2]);
    const reset = !this.flybyPos || Math.hypot(pos2[0] - this.flybyPos[0], pos2[2] - this.flybyPos[2]) > Math.max(200, sp * 6);
    if (reset) {
      const lead = Math.max(60, sp * 4);
      const dir = sp > 5 ? [v[0] / sp, 0, v[2] / sp] : rotateVec(rot, [0, 0, -1]);
      this.flybyPos = [pos2[0] + dir[0] * lead + dir[2] * 18, pos2[1] + 4, pos2[2] + dir[2] * lead - dir[0] * 18];
      this.flybyPos[1] = Math.max(this.flybyPos[1], groundUnder(ac, this.flybyPos) + 1.5);
    }
    return { pos: this.flybyPos.slice(), rot: lookRotation(this.flybyPos, pos2), fov: 50 * this.fovScale };
  }
};
function groundUnder(ac, p) {
  const g = ac.ground?.(-p[2], p[0]);
  return g && Number.isFinite(g.h) ? g.h : 0;
}

// src/plugin/aircraftColliders.js
var SKIP = /seat|harness|buckle|stick|pedal|throttle|knob|panel|dial|bezel|mark|att(Sky|Ground)|toggle|gps|hood|inset|display|screen|lamp|cockpitShell|floor|prop|hud|debug/i;
var SLICE = 0.6;
var MIN = 0.12;
function colliderBoxes(parts) {
  const boxes = [];
  for (const part of parts) {
    if (SKIP.test(part.name) || part.parent || part.transparent || /prop|flame|glow|stick/i.test(part.kind || "")) continue;
    const p = part.mesh?.positions;
    if (!p?.length) continue;
    const o = part.hinge ? fromBody(part.hinge) : [0, 0, 0];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k] + o[k]);
      hi[k] = Math.max(hi[k], p[i + k] + o[k]);
    }
    const size = hi.map((v, k) => v - lo[k]);
    if (Math.max(...size) < MIN) continue;
    const ax = size.indexOf(Math.max(...size));
    const n = Math.max(1, Math.min(24, Math.ceil(size[ax] / SLICE)));
    for (let s = 0; s < n; s++) {
      const a0 = lo[ax] + size[ax] * s / n, a1 = lo[ax] + size[ax] * (s + 1) / n;
      const l = [Infinity, Infinity, Infinity], h = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) {
        const v = p[i + ax] + o[ax];
        if (v < a0 - 1e-6 || v > a1 + 1e-6) continue;
        for (let k = 0; k < 3; k++) {
          l[k] = Math.min(l[k], p[i + k] + o[k]);
          h[k] = Math.max(h[k], p[i + k] + o[k]);
        }
      }
      if (!Number.isFinite(l[0])) continue;
      l[ax] = a0;
      h[ax] = a1;
      const half = h.map((v, k) => Math.max(0.02, (v - l[k]) / 2));
      boxes.push({ c: l.map((v, k) => (v + h[k]) / 2), h: half });
    }
  }
  return boxes;
}
var AircraftColliders = class {
  /**
   * @param {pc.AppBase} app
   * @param {pc.Entity} root  the airplane's root (metres, under the world's scale)
   * @param {object[]} parts  its model
   * @param {number} ws       the world's scale (primitive colliders ignore entity scale: world units)
   */
  constructor(app, root, parts, ws) {
    Object.assign(this, { app, parent: root, parts, ws, root: null, on: true });
    this.tick();
  }
  /** Built once the platform's physics (Ammo) is there: it may load after us (none in the harness). */
  tick() {
    if (this.root || this.destroyed || !this.app.systems.rigidbody || typeof Ammo === "undefined") return;
    const ws = this.ws;
    this.root = new pc.Entity("AircraftColliders");
    this.root.enabled = this.on;
    this.parent.addChild(this.root);
    for (const b of colliderBoxes(this.parts)) {
      const e = new pc.Entity("aircraftCollider");
      e.setLocalPosition(b.c[0], b.c[1], b.c[2]);
      e.addComponent("collision", { type: "box", halfExtents: new pc.Vec3(b.h[0] * ws, b.h[1] * ws, b.h[2] * ws) });
      e.addComponent("rigidbody", { type: pc.BODYTYPE_KINEMATIC, friction: 0.8, restitution: 0 });
      this.root.addChild(e);
    }
  }
  /** Solid while parked, off in flight. */
  set enabled(on) {
    this.on = on;
    if (this.root) this.root.enabled = on;
  }
  destroy() {
    this.destroyed = true;
    this.root?.destroy();
    this.root = null;
  }
};

// src/plugin/shadowProxy.js
var MERGED = /* @__PURE__ */ new Set(["aileron", "flap", "elevator", "stabilator", "rudder", "leFlap", "wheel", "tailwheel", "steerwheel", "pant"]);
var OWN = /* @__PURE__ */ new Set(["gearLeg", "gearDoor", "bayShut", "sfoil", "hook", "speedbrake"]);
var NONE = /seat|harness|buckle|stick|pedal|throttle|knob|panel|dial|bezel|mark|att(Sky|Ground)|toggle|gps|hood|inset|display|screen|lamp|cockpitShell|floor|hud|debug|nav|pilot/i;
var NO_KIND = /* @__PURE__ */ new Set(["prop", "propDisc", "abFlame", "engineGlow", "throttle", "stick"]);
var MIN2 = 0.25;
var LAYER = "AircraftShadow";
function shadowProxyLayer(app) {
  let layer = app.scene.layers.getLayerByName(LAYER);
  if (!layer) {
    layer = new pc.Layer({ name: LAYER });
    app.scene.layers.push(layer);
  }
  return layer;
}
function castProxiesFrom(app, light) {
  if (!light) return;
  const id = shadowProxyLayer(app).id;
  if (!light.layers.includes(id)) light.layers = [...light.layers, id];
}
function buildShadowProxy(app, root, parts) {
  const byName = new Map(parts.map((p) => [p.name, p]));
  const ownChain = (p) => {
    for (let x = p; x; x = x.parent ? byName.get(x.parent) : null) if (OWN.has(x.kind)) return true;
    return false;
  };
  const pos2 = [], idx = [];
  for (const r of root.findComponents("render")) {
    const part = byName.get(r.entity.name);
    if (!r.castShadows || !part) continue;
    if (part.hinge && ownChain(part)) continue;
    r.castShadows = false;
    const mb = part.mesh;
    if (!mb?.vertexCount || NO_KIND.has(part.kind) || NONE.test(part.name) || part.transparent) continue;
    if (part.hinge && !MERGED.has(part.kind)) continue;
    const p = mb.positions, o = part.hinge ? fromBody(part.hinge) : [0, 0, 0];
    let ext = 0;
    for (let k = 0; k < 3; k++) {
      let a = Infinity, b = -Infinity;
      for (let i = k; i < p.length; i += 3) {
        a = Math.min(a, p[i]);
        b = Math.max(b, p[i]);
      }
      ext = Math.max(ext, b - a);
    }
    if (ext < MIN2) continue;
    const base = pos2.length / 3;
    for (let i = 0; i < p.length; i += 3) pos2.push(p[i] + o[0], p[i + 1] + o[1], p[i + 2] + o[2]);
    for (const i of mb.indices) idx.push(i + base);
  }
  if (!idx.length) return null;
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(pos2);
  mesh.setIndices(pos2.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx));
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const mat = new pc.StandardMaterial();
  mat.cull = pc.CULLFACE_NONE;
  mat.update();
  const e = new pc.Entity("shadowProxy");
  e.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, mat)], castShadows: true, receiveShadows: false, layers: [shadowProxyLayer(app).id] });
  root.addChild(e);
  return e;
}

// src/plugin/aircraftVisual.js
var PAINTED = /* @__PURE__ */ new Set(["white", "red", "yellow", "navRed", "navGreen", "blue", "belly", "nacelle", "carbon"]);
var SATIN = /* @__PURE__ */ new Set(["grey", "darkGrey", "radome", "gearWhite", "wingGrey", "gearGrey"]);
var METAL = /* @__PURE__ */ new Set(["metal", "chrome", "nozzle"]);
var GLASS = /* @__PURE__ */ new Set(["glass", "hud"]);
var STICK_THROW = 0.3;
var SPEEDBRAKE_ANGLE = 50 * Math.PI / 180;
var DEG5 = Math.PI / 180;
var AircraftVisual = class {
  /**
   * @param {object} app
   * @param {object} parent  entity
   * @param {object[]} parts  the model (render/extraModel.js buildExtraModel, render/f15Model.js buildF15Model)
   * @param {string} [name]
   * @param {{ shadowProxy?: boolean, merge?: boolean, keep?: string[] }} [o]  shadowProxy, merge: false for a parked one (baked:
   *        parkedAircraft.js); keep: parts left as they are (by name: a badge's)
   */
  constructor(app, parent, parts, name = "Aircraft", { shadowProxy = true, merge = true, keep = [] } = {}) {
    this.root = new pc.Entity(name);
    parent.addChild(this.root);
    this.moving = [];
    this._q = new pc.Quat();
    this._q2 = new pc.Quat();
    this.propAngle = 0;
    const byName = /* @__PURE__ */ new Map();
    const dev = app.graphicsDevice;
    for (const part of parts) {
      const mat = part.material === "airframe" && "pbr" in part ? texturedPaintMaterial(dev, part.pbr, part.color, part.shade ?? 1) : part.name === "hudGlass" ? material("#b8ffd2", { transparent: true, opacity: 0.1, scope: "aircraft" }) : /^(screen|lamp)/.test(part.material) ? material(part.color, { emissive: part.color, scope: "aircraft" }) : part.kind === "abFlame" ? part.plume ? plumeMaterial() : flameMaterial(part.color) : part.kind === "engineGlow" ? flameMaterial("#ff6a48") : part.kind === "propDisc" ? propDiscMaterial(dev) : GLASS.has(part.material) || part.name === "canopy" ? part.filter ? glassFilterMaterial(dev, part.filter) : glassTintMaterial(dev, part.color, part.tintOpacity) : PAINTED.has(part.material) ? paintMaterial(dev, part.color) : SATIN.has(part.material) ? paintMaterial(dev, part.color, part.matte ? "matte" : true) : METAL.has(part.material) ? metalMaterial(dev, part.color, part.material === "chrome", true) : material(part.color, part.transparent ? { transparent: true, opacity: 0.28, scope: "aircraft" } : { scope: "aircraft" });
      const glass2 = part.name !== "hudGlass" && (GLASS.has(part.material) || part.name === "canopy");
      if (!part.hinge) {
        const e = meshEntity(app, this.root, part.name, part.mesh, mat);
        if (glass2) this._reflect(e, dev, part.coating);
        continue;
      }
      const up = part.parent ? byName.get(part.parent) : null;
      const pivot = new pc.Entity(`${part.name}Pivot`);
      const rel = up ? part.hinge.map((v, i) => v - up.hinge[i]) : part.hinge;
      const hp = fromBody(rel);
      pivot.setLocalPosition(hp[0], hp[1], hp[2]);
      (up ? up.pivot : this.root).addChild(pivot);
      const glow = part.kind === "propDisc" || part.kind === "abFlame" || part.kind === "engineGlow";
      const ent = meshEntity(app, pivot, part.name, part.mesh, mat, { castShadows: !glow, receiveShadows: !glow });
      const ax = fromBody(part.axis);
      const l = Math.hypot(ax[0], ax[1], ax[2]);
      if (glass2) this._reflect(ent, dev, part.coating);
      const m = { ...part, pivot, ent, axis: new pc.Vec3(ax[0] / l, ax[1] / l, ax[2] / l), rel };
      this.moving.push(m);
      byName.set(part.name, m);
    }
    this.shadowProxy = shadowProxy ? buildShadowProxy(app, this.root, parts) : null;
    if (merge) this._mergeStatic(app, parts, new Set(keep.filter(Boolean)));
  }
  /**
   * Its fixed parts drawn as one mesh per material (the Extra's 56 in 21): each part was a draw call of its own,
   * in every pass. Left as they are: the moving ones (on their pivots), glass and see-through parts (the cockpit
   * view hides the canopy; they sort apart), the fin(s) and `keep` (the tail badge is laid on them by name).
   */
  _mergeStatic(app, parts, keep) {
    const byName = new Map(parts.map((p) => [p.name, p]));
    const groups = /* @__PURE__ */ new Map();
    for (const e of [...this.root.children]) {
      const part = e.render && byName.get(e.name);
      if (!part || part.hinge || !part.mesh?.vertexCount || keep.has(e.name) || /^fin[LR]?$/.test(e.name)) continue;
      const mis = e.render.meshInstances;
      if (mis.length !== 1 || mis[0].material.blendType !== pc.BLEND_NONE || part.transparent) continue;
      const key = `${mis[0].material.id}|${e.render.castShadows}|${e.render.receiveShadows}`;
      if (!groups.has(key)) groups.set(key, { material: mis[0].material, cast: e.render.castShadows, receive: e.render.receiveShadows, pieces: [], ents: [] });
      const g = groups.get(key);
      g.pieces.push({ mb: part.mesh, m: e.getLocalTransform().clone() });
      g.ents.push(e);
    }
    for (const g of groups.values()) {
      if (g.ents.length < 2) continue;
      const { mesh } = mergeBuilders(app.graphicsDevice, g.pieces);
      const e = new pc.Entity("merged");
      e.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, g.material)], castShadows: g.cast, receiveShadows: g.receive });
      this.root.addChild(e);
      for (const old of g.ents) {
        for (const mi of old.render.meshInstances) mi.mesh.destroy?.();
        old.destroy();
      }
    }
  }
  /** Glass: its reflection, added over the tint (plugin/finishes.js glassTintMaterial), on the same mesh. */
  _reflect(e, dev, coating = null) {
    const was = e.render?.meshInstances[0];
    if (!was) return;
    const { mesh, material: material2 } = was;
    const r = new pc.MeshInstance(mesh, glassReflectionMaterial(dev, coating === "gold" ? 0.45 : 0.15, coating === "gold"));
    e.render.meshInstances = [new pc.MeshInstance(mesh, material2), r];
    r.castShadow = false;
  }
  /**
   * Hide what the pilot's own eye shouldn't see through from inside: the canopy and windscreen. (The HUD's
   * combiner glass stays, faint: its symbols are drawn over the view.)
   */
  setCockpitView(inside) {
    this.inside = inside;
    for (const e of this.root.find((n) => n.name === "canopy" || n.name === "windscreen")) e.enabled = !inside;
  }
  /** Pose the whole airplane and its moving parts from the sim. */
  update(ac, dt) {
    const p = nedToRender(ac.referencePoint());
    this.root.setLocalPosition(p[0], p[1], p[2]);
    const q = simToRenderQuat(ac.state.q);
    this.root.setLocalRotation(q[0], q[1], q[2], q[3]);
    const strips = ac.aero.strips;
    const defl = (name, side = null) => {
      const s = strips.find((st) => st.control && st.control.input === name && (side == null || st.side === side));
      return s ? s.deflection : 0;
    };
    const RAD = 180 / Math.PI;
    if (ac.spec.engine) this.propAngle = (this.propAngle + ac.rpm * (360 / 60) * dt * ac.spec.engine.rotation) % 360;
    for (const m of this.moving) {
      let angle = 0;
      switch (m.kind) {
        case "aileron":
          angle = defl("aileron", m.side) * m.side;
          break;
        case "flap":
          angle = defl("flaps", m.side) * m.side;
          break;
        case "elevator":
          angle = defl("elevator");
          break;
        case "stabilator":
          angle = defl("elevator", m.side);
          break;
        case "rudder":
          angle = defl("rudder");
          break;
        case "speedbrake":
          angle = -SPEEDBRAKE_ANGLE * (ac.speedbrakePos || 0);
          break;
        case "hook":
          angle = ac.hookAngle || 0;
          break;
        // down from stowed, as far as the deck lets it
        case "leFlap": {
          const a = ac.out?.alpha || 0;
          const droop = Math.max(Math.min(30 * DEG5, Math.max(0, a - 3 * DEG5) * 1.1), 15 * DEG5 * (ac.controls.flaps || 0));
          angle = -droop * m.side;
          break;
        }
        case "gearDoor":
          m.pivot.enabled = ac.gearPos > 0.02;
          continue;
        // open while the gear is out
        case "bayShut":
          m.pivot.enabled = ac.gearPos <= 0.02;
          continue;
        // the bays shut with it up
        case "throttle":
          angle = 0.35 - 0.6 * (ac.controls.throttle || 0);
          break;
        // forward for more
        case "sfoil":
          angle = -m.side * m.layer * (ac.spec.sfoils?.open || 0) * (ac.sfoilPos || 0);
          break;
        case "engineGlow": {
          const on = ac.engine.running;
          m.ent.enabled = on;
          const f = on ? 0.7 + 0.35 * Math.min(2, ac.engine.power || 0) + 0.03 * Math.sin(performance.now() * 0.04 + m.side * 3 + m.layer) : 1;
          m.ent.setLocalScale(f, f, f);
          continue;
        }
        case "gearLeg":
          m.pivot.enabled = ac.gearPos > 0.02;
          angle = (m.fold || 90) * Math.PI / 180 * (1 - ac.gearPos);
          break;
        case "abFlame": {
          const ab = ac.engine.ab || 0;
          m.pivot.enabled = ab > 0.03;
          if (ab > 0.03 && m.plume) {
            const t = performance.now(), ph = m.hinge[1] * 7;
            const len2 = 0.35 + 0.65 * ab + 0.04 * Math.sin(t * 0.031) + 0.012 * Math.sin(t * 0.087 + ph);
            const w = 0.85 + 0.15 * ab + 0.02 * Math.sin(t * 0.053 + ph);
            m.pivot.setLocalScale(w, w, len2);
          } else if (ab > 0.03) {
            const f = 0.45 + 0.55 * ab + 0.04 * Math.sin(performance.now() * 0.05 + m.hinge[1] * 7);
            m.pivot.setLocalScale(f, f, f);
          }
          if (ab > 0.03) this._bendFlame(m, ac);
          continue;
        }
        case "prop":
          m.ent.enabled = ac.rpm < 350;
          angle = this.propAngle * Math.PI / 180;
          break;
        case "propDisc": {
          m.ent.enabled = ac.rpm > 400;
          this.discAngle = ((this.discAngle || 0) + (0.25 + 5.6 * ac.rpm / 2700) * dt * (ac.spec.engine?.rotation || 1)) % (Math.PI * 2);
          angle = this.discAngle;
          const mi = m.ent.render?.meshInstances?.[0];
          if (mi) mi.setParameter("material_opacity", 1 - 0.1 * Math.min(1, Math.max(0, (ac.rpm - 700) / 2e3)));
          break;
        }
        case "wheel":
        case "tailwheel":
        case "steerwheel": {
          const g = ac.gear.units[m.gear];
          const hub = fromBody([m.rel[0], m.rel[1], m.rel[2] - g.compression]);
          m.pivot.setLocalPosition(hub[0], hub[1], hub[2]);
          angle = -g.wheelAngle;
          if (m.kind !== "wheel") {
            this._q2.setFromAxisAngle(pc.Vec3.DOWN, g.steerAngle * RAD);
            this._q.setFromAxisAngle(m.axis, angle * RAD);
            this._q2.mul(this._q);
            m.pivot.setLocalRotation(this._q2);
            continue;
          }
          break;
        }
        case "pant": {
          const g = ac.gear.units[m.gear];
          const hub = fromBody([m.rel[0], m.rel[1], m.rel[2] - g.compression]);
          m.pivot.setLocalPosition(hub[0], hub[1], hub[2]);
          continue;
        }
        case "stick": {
          const c = ac.controls;
          this._stickRoll ??= new pc.Vec3(...fromBody([1, 0, 0]));
          this._stickPitch ??= new pc.Vec3(...fromBody([0, 1, 0]));
          this._q.setFromAxisAngle(this._stickRoll, (c.aileron || 0) * STICK_THROW * RAD);
          this._q2.setFromAxisAngle(this._stickPitch, (c.elevator || 0) * STICK_THROW * RAD);
          this._q.mul(this._q2);
          m.pivot.setLocalRotation(this._q);
          continue;
        }
        default:
          break;
      }
      this._q.setFromAxisAngle(m.axis, angle * RAD);
      m.pivot.setLocalRotation(this._q);
    }
  }
  /**
   * A lit flame bent at its outer end toward where the air carries it (behind the airplane along its path, off
   * the nozzle's axis by the angle of attack and the sideslip, at most 12°), its tip along that line: straight
   * out of the nozzle, curving into the trail (plugin/exhaustTrails.js starts it there). plume_bend: finishes.js.
   */
  _bendFlame(m, ac) {
    const va = ac.out?.vAirBody, al = ac.out?.alpha || 0;
    const air = fromBody(va && (va[0] || va[2]) ? [-va[0], -va[1], -va[2]] : [-Math.cos(al), 0, -Math.sin(al)]);
    let sx = 0, sy = 0;
    if (air[2] > 0.2) {
      sx = air[0] / air[2];
      sy = air[1] / air[2];
      const s = Math.hypot(sx, sy), lim = Math.tan(12 * DEG5);
      if (s > lim) {
        sx *= lim / s;
        sy *= lim / s;
      }
    }
    if (m._flameLen == null) {
      const P2 = m.mesh?.positions || [];
      let z = 0;
      for (let i = 2; i < P2.length; i += 3) z = Math.max(z, P2[i]);
      m._flameLen = z || 1;
    }
    const sc = m.pivot.getLocalScale(), k = sc.z / (2 * m._flameLen * (sc.x || 1));
    m._bend = [sx * k, sy * k];
    for (const mi of m.ent?.render?.meshInstances || []) mi.setParameter("plume_bend", m._bend);
  }
  destroy() {
    this.root.destroy();
  }
};

// src/plugin/sceneCamera.js
var cached = null;
function sceneCamera() {
  if (!cached || cached._destroyed || !cached.camera) cached = ArrivalSpace.getCamera?.() || null;
  return cached;
}

// src/render/audio.js
var WORKLET = (
  /* js */
  `
const TAU = Math.PI * 2;
const rnd = () => Math.random() * 2 - 1;

/** Two-pole resonator: a band ringing at f with quality q, unit gain at its peak. */
class Res {
  constructor() { this.y1 = 0; this.y2 = 0; this.a1 = 0; this.a2 = 0; this.g = 0; }
  set(f, q) {
    const w = TAU * Math.min(f, sampleRate * 0.45) / sampleRate, r = Math.exp(-w / (2 * q));
    this.a1 = 2 * r * Math.cos(w); this.a2 = -r * r; this.g = (1 - r) * Math.sqrt(1 - 2 * r * Math.cos(2 * w) + r * r);
  }
  tick(x) { const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}

/**
 * The Extra's Lycoming AEIO-540 and its three-blade prop.
 * Out 0: the exhaust (and the starter); out 1: the prop.
 */
class Piston extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return ['rpm', 'load', 'running', 'thrust'].map((name) => ({ name, defaultValue: 0, automationRate: 'k-rate' }));
  }
  constructor() {
    super();
    this.ph = 0; this.cyl = 0; this.jit = 0;
    this.env = 0; this.decay = 0.99; this.amp = 0;
    this.var = [1.0, 0.82, 1.12, 0.92, 1.16, 0.95];   // each cylinder a little different
    this.r1 = new Res(); this.r2 = new Res(); this.r3 = new Res(); this.ring = new Res();
    this.ring.set(900, 4);
    this.lp = 0; this.hpx = 0; this.hpy = 0;
    this.pp = 0; this.phase = Array.from({ length: 15 }, () => Math.random() * TAU); this.w = new Float32Array(15);
    this.ex1 = 0; this.ey1 = 0;
    this.sp = 0;                        // the starter's phase
    this.loadSlow = 0; this.pops = 0; this.pop = 0;
  }
  process(_in, outputs, p) {
    const ex = outputs[0][0], pr = outputs[1][0];
    if (!ex) return true;
    const n = ex.length, sr = sampleRate;
    const rpm = Math.max(0, p.rpm[0]), load = Math.min(1.2, Math.max(0, p.load[0])), run = p.running[0] > 0.5;
    const thrust = Math.min(1.2, Math.max(0, p.thrust[0]));
    const fire = rpm / 20;                              // firings a second: 3 a revolution
    this.r1.set(80 + 45 * load, 3.0); this.r2.set(340 + 160 * load, 2.2); this.r3.set(1900 + 500 * load, 1.5);
    // the throttle chopped at speed: the pipes pop for a couple of seconds
    this.loadSlow += (load - this.loadSlow) * 0.015;
    if (run && rpm > 1700 && this.loadSlow - load > 0.3) this.pops = 1;
    this.pops = Math.max(0, this.pops - n / sr / 2.2);
    // the prop's harmonics: more of them, harder, as its tips near Mach 1
    const tip = Math.min(1.1, rpm / 2700), pw = 2.5 - 1.3 * tip * tip;
    for (let k = 1; k <= 14; k++) this.w[k] = Math.pow(k, -pw);
    const fb = rpm / 20, spin = Math.min(1, rpm / 2700), propA = spin * spin * (0.25 + 0.75 * Math.min(1, thrust));
    const crank = !run && rpm > 20 && rpm < 900;
    for (let i = 0; i < n; i++) {
      // the firing order round: a pulse each, its timing a little loose at idle
      this.ph += fire / sr * (1 + this.jit);
      if (this.ph >= 1) {
        this.ph -= 1; this.cyl = (this.cyl + 1) % 6;
        const idle = Math.max(0, 1 - rpm / 1400);
        this.jit = rnd() * (run ? 0.015 + 0.09 * idle : 0.1);
        this.amp = run ? (0.1 + 0.9 * Math.pow(Math.min(1, load), 0.9)) * this.var[this.cyl] * (1 + 0.35 * rnd() * (1 - Math.min(1, load)))
          : (crank ? 0.18 * this.var[this.cyl] : 0);
        const tau = run ? 0.0018 + 0.0012 * (1 - Math.min(1, load)) : 0.006;
        this.decay = Math.exp(-1 / (tau * sr));
        this.env = 1;
        if (this.pops > 0 && Math.random() < 0.18 * this.pops) this.pop = 1.4 + Math.random() * 1.6;
      }
      this.env *= this.decay;
      this.lp += (rnd() - this.lp) * 0.3;
      const pulse = this.amp * this.env * (0.55 * this.lp + this.env);
      // its edge: the crack of the exhaust valve opening, sharper with power
      const nz0 = rnd(); this.ey1 = 0.8 * (this.ey1 + nz0 - this.ex1); this.ex1 = nz0;
      const edge = this.amp * this.env * this.env * this.ey1 * (0.25 + 0.9 * Math.min(1, load));
      let x = this.r1.tick(pulse) * 2.4 + this.r2.tick(pulse) * 1.6 + this.r3.tick(pulse) * 0.9 + pulse * 0.35 + edge;
      // a pop: a crack and its ring in the pipe
      if (this.pop > 0.002) { const c = this.pop * (0.6 * rnd() + 0.5); x += this.ring.tick(c) * 1.6 + c * 0.5; this.pop *= 0.9985; }
      // the starter: a geared whine while it cranks
      if (crank) { this.sp += rpm * 2.4 / sr; if (this.sp > 1) this.sp -= 1; x += 0.05 * (Math.sin(TAU * this.sp) + 0.4 * Math.sin(2 * TAU * this.sp)); }
      ex[i] = x;
      // the prop: its blade-pass tone and harmonics, and the swish of each blade going by
      this.pp += fb / sr; if (this.pp >= 1) this.pp -= 1;
      let s = 0;
      for (let k = 1; k <= 14; k++) s += this.w[k] * Math.sin(TAU * k * this.pp + this.phase[k]);
      const nz = rnd(); this.hpy = 0.92 * (this.hpy + nz - this.hpx); this.hpx = nz;
      const m = Math.pow(0.5 + 0.5 * Math.cos(TAU * this.pp), 6);
      pr[i] = propA * (0.55 * s + 0.5 * this.hpy * (0.2 + m));
    }
    return true;
  }
}
registerProcessor('flight-piston', Piston);

/**
 * A jet's two engines. Out 0: the whine and the buzz-saw (heard ahead); out 1: the crackle and the
 * burner's light-off (behind).
 */
class Jet extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return ['n2', 'thrust', 'ab', 'running', 'pitch'].map((name) => ({ name, defaultValue: name === 'pitch' ? 1 : 0, automationRate: 'k-rate' }));
  }
  constructor() {
    super();
    this.ph = new Float32Array(4); this.bz = new Float32Array(32); this.bzA = new Float32Array(32);
    for (let h = 8; h < 32; h++) this.bzA[h] = (0.25 + 0.75 * Math.random()) / Math.sqrt(h);
    this.vib = 0; this.vibT = 0;
    this.cr = 0; this.crPend = 0; this.hpx = 0; this.hpy = 0; this.res = new Res(); this.res.set(2300, 1.3);
    this.abWas = 0; this.th = 0; this.thPh = 0; this.thLp = 0;
  }
  process(_in, outputs, p) {
    const front = outputs[0][0], aft = outputs[1][0];
    if (!front) return true;
    const n = front.length, sr = sampleRate;
    const n2 = Math.max(0, p.n2[0]), thrust = Math.min(1, Math.max(0, p.thrust[0])), ab = Math.min(1, Math.max(0, p.ab[0]));
    const k = p.pitch[0];
    const spin = Math.min(1, n2 / 0.6);
    const fH = (1800 + 3600 * n2) * k, fF = (420 + 1200 * n2) * k;      // the core's compressor, the fan
    const whineA = spin * (0.35 + 0.65 * n2);
    // the buzz-saw: the fan's tips past Mach 1, the shaft's harmonics all at once
    const bzA = Math.max(0, Math.min(1, (n2 - 0.9) / 0.12)), fS = (60 + 120 * n2) * k;
    // the crackle: sparse cracks, thicker with thrust, thickest in the burner
    const rate = (500 * thrust * thrust * thrust + 1400 * ab) / sr;
    // the burner lighting: a thump
    if (ab > 0.03 && this.abWas <= 0.01) this.th = 1;
    this.abWas = ab;
    for (let i = 0; i < n; i++) {
      // a slow wander in the spool (no tone stays dead still)
      if (--this.vibT <= 0) { this.vibT = 2048; this.vibTo = rnd(); }
      this.vib += ((this.vibTo || 0) - this.vib) * 0.0006;
      const v = 1 + 0.002 * this.vib;
      let w = 0;
      for (let e = 0; e < 2; e++) {
        // the two engines a hair apart, a hertz or two: a slow beat (a per-cent apart beat at 40 Hz on the
        // core's whine, and that was a propeller's chop)
        this.ph[e] += (fH * v + e * 1.7) / sr; if (this.ph[e] > 1) this.ph[e] -= 1;
        this.ph[e + 2] += (fF * v + e * 0.9) / sr; if (this.ph[e + 2] > 1) this.ph[e + 2] -= 1;
        w += Math.sin(TAU * this.ph[e]) * 0.55 + Math.sin(2 * TAU * this.ph[e]) * 0.15 + Math.sin(TAU * this.ph[e + 2]) * 0.3 + Math.sin(2 * TAU * this.ph[e + 2]) * 0.12;
      }
      let b = 0;
      if (bzA > 0) {
        for (let h = 8; h < 32; h++) { this.bz[h] += fS * h * v / sr; if (this.bz[h] > 1) this.bz[h] -= 1; b += this.bzA[h] * Math.sin(TAU * this.bz[h]); }
      }
      front[i] = whineA * w * 0.22 + bzA * b * 0.25;
      // a crack: a sharp N-wave, sized by a heavy tail (most small, a few loud)
      let x = 0;
      if (Math.random() < rate) { const a = Math.min(6, Math.pow(Math.random(), -1 / 1.7) - 0.6); x = a; this.crPend = -0.7 * a; }
      else if (this.crPend) { x = this.crPend; this.crPend = 0; }
      this.hpy = 0.86 * (this.hpy + x - this.hpx); this.hpx = x;
      let y = this.hpy * 0.55 + this.res.tick(x) * 0.8;
      // the thump: a falling low note and a rush
      if (this.th > 0.001) {
        this.thPh += (30 + 55 * this.th * this.th) / sr; if (this.thPh > 1) this.thPh -= 1;
        this.thLp += (rnd() - this.thLp) * 0.05;
        y += this.th * (1.4 * Math.sin(TAU * this.thPh) + 1.2 * this.thLp);
        this.th *= 0.99992;
      }
      aft[i] = y;
    }
    return true;
  }
}
registerProcessor('flight-jet', Jet);
`
);
var clamp2 = (x, a, b) => Math.max(a, Math.min(b, x));
var len = (v) => Math.hypot(v[0], v[1], v[2]);
var C_SOUND = 343;
var MAX_DELAY = 7;
var FIXED_DELAY = 0.04;
var FIXED_REFL = 0.012;
var FlightSound = class {
  constructor() {
    this.ctx = null;
    this.nodes = null;
    this.muted = false;
    this._wheels = [];
  }
  /**
   * From a user gesture (the browser's rule). `ctx`: one to render into instead (an OfflineAudioContext,
   * for listening to it off line).
   */
  start(ctx = null) {
    if (this.ctx) {
      this.ctx.resume?.();
      return this._ready;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!ctx && !AC) return null;
    this.ctx = ctx || new AC({ latencyHint: "interactive" });
    this._ready = (async () => {
      const c = this.ctx;
      if (c.audioWorklet) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        try {
          await c.audioWorklet.addModule(url);
        } catch (e) {
          console.warn("[sound] no worklet:", e);
        }
        URL.revokeObjectURL(url);
      }
      if (this.ctx !== c) return;
      this._common();
      this._build();
    })();
    return this._ready;
  }
  stop() {
    if (!this.ctx) return;
    if (!(this.ctx instanceof (globalThis.OfflineAudioContext || Object))) {
      try {
        this.ctx.close();
      } catch {
      }
    }
    this.ctx = null;
    this.nodes = null;
  }
  // ── the paths ──────────────────────────────────────────────────────────────
  _common() {
    const c = this.ctx;
    const N5 = this.nodes = {};
    const buf = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    N5.comp = c.createDynamicsCompressor();
    N5.comp.threshold.value = -10;
    N5.comp.knee.value = 10;
    N5.comp.ratio.value = 3;
    N5.comp.attack.value = 4e-3;
    N5.comp.release.value = 0.22;
    N5.master = this._gain(0);
    N5.limit = c.createDynamicsCompressor();
    N5.limit.threshold.value = -3;
    N5.limit.knee.value = 0;
    N5.limit.ratio.value = 20;
    N5.limit.attack.value = 1e-3;
    N5.limit.release.value = 0.08;
    N5.comp.connect(N5.master).connect(N5.limit).connect(c.destination);
    N5.bus = this._gain(1);
    N5.cabinLP = this._filter("lowpass", this.cabinCut ?? 1400, 0.5);
    N5.cabinLow = this._filter("peaking", 90, 0.8);
    N5.cabinLow.gain.value = 5;
    N5.inside = this._gain(0);
    N5.bus.connect(N5.cabinLP).connect(N5.cabinLow).connect(N5.inside).connect(N5.comp);
    const pan = () => {
      const p = c.createPanner();
      p.panningModel = "HRTF";
      p.distanceModel = "linear";
      p.rolloffFactor = 0;
      p.refDistance = 1;
      return p;
    };
    N5.air = this._filter("lowpass", 18e3, 0.5);
    N5.delay = c.createDelay(MAX_DELAY + 0.5);
    N5.pan = pan();
    N5.outside = this._gain(0);
    N5.bus.connect(N5.air).connect(N5.delay).connect(N5.pan).connect(N5.outside).connect(N5.comp);
    N5.reflAir = this._filter("lowpass", 4e3, 0.5);
    N5.reflDelay = c.createDelay(MAX_DELAY + 0.5);
    N5.reflPan = pan();
    N5.refl = this._gain(0);
    N5.bus.connect(N5.reflAir).connect(N5.reflDelay).connect(N5.reflPan).connect(N5.refl).connect(N5.comp);
    N5.windHi = this._filter("bandpass", 900, 0.5);
    N5.windLo = this._filter("lowpass", 220, 0.7);
    N5.wind = this._gain(0);
    this._noise().connect(N5.windHi).connect(N5.wind);
    this._noise().connect(N5.windLo).connect(N5.wind);
    N5.wind.connect(N5.comp);
    N5.gust = this._gain(0);
    for (const f of [0.21, 0.37, 0.83]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.start();
      const g = this._gain(0.33);
      o.connect(g).connect(N5.gust);
    }
    N5.gust.connect(N5.wind.gain);
    N5.buffetLP = this._filter("lowpass", 45, 1.2);
    N5.buffet = this._gain(0);
    this._noise().connect(N5.buffetLP).connect(N5.buffet).connect(N5.comp);
    N5.rollLP = this._filter("lowpass", 180, 0.8);
    N5.rollPk = this._filter("peaking", 55, 1.5);
    N5.rollPk.gain.value = 8;
    N5.roll = this._gain(0);
    this._noise().connect(N5.rollLP).connect(N5.rollPk).connect(N5.roll).connect(N5.bus);
    N5.hyd = this._gain(0);
    const ho = c.createOscillator();
    ho.type = "sawtooth";
    ho.frequency.value = 340;
    ho.start();
    const hf = this._filter("bandpass", 700, 2);
    ho.connect(hf).connect(N5.hyd);
    this._noise().connect(this._filter("bandpass", 2400, 1.5)).connect(N5.hyd);
    N5.hyd.connect(N5.bus);
    N5.horn = c.createOscillator();
    N5.horn.type = "square";
    N5.horn.frequency.value = 1150;
    N5.horn.start();
    N5.hornF = this._filter("lowpass", 2500, 0.7);
    N5.hornG = this._gain(0);
    N5.horn.connect(N5.hornF).connect(N5.hornG).connect(N5.comp);
    this._lastDist = null;
  }
  _gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }
  _filter(type, f, q) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }
  _noise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    s.loop = true;
    s.loopStart = Math.random() * 2;
    s.start(0, Math.random() * 2);
    return s;
  }
  _set(param, v, k = 0.08) {
    param.setTargetAtTime(v, this.ctx.currentTime, k);
  }
  /**
   * Once a frame.
   * @param {object} s
   *   rpm, powerFrac, ab, running, qbar, stall, inside (the cockpit view), and where it is heard from:
   *   rel [x, y, z] the airplane from the listener (m, the camera's frame: x right, y up, −z ahead),
   *   relImg its reflection in the ground (or null, high up), fwd its nose in that frame,
   *   camSpeed (m/s: the wind the listener is in; the airplane's airspeed when riding with it), buffet 0..1, onGround, groundSpeed (m/s),
   *   wheels [bool…] each in contact, sink (m/s down), actuating (gear/flaps/brake moving),
   *   doppler (false: the camera moves with the airplane, its lag held)
   */
  update(s) {
    const N5 = this.nodes;
    if (!N5) return;
    const t = this.ctx.currentTime;
    const inside = !!s.inside;
    this._set(N5.master.gain, this.muted ? 0 : 0.8, 0.15);
    this._set(N5.inside.gain, inside ? this.cabinLevel : 0, 0.05);
    const rel = s.rel || [0, 0, -12];
    const d = Math.max(1, len(rel));
    const near = clamp2(this.refDist / d, 0, 1);
    this._set(N5.outside.gain, inside ? 0 : this.outLevel * near, 0.05);
    const jump = this._lastDist == null || Math.abs(d - this._lastDist) > 80;
    this._lastDist = d;
    const fixed = s.doppler === false;
    const delay = fixed ? FIXED_DELAY : Math.min(MAX_DELAY, d / C_SOUND);
    const setNow = (param, v) => {
      param.cancelScheduledValues(t);
      param.setValueAtTime(v, t);
    };
    if (jump || fixed !== this._fixed) setNow(N5.delay.delayTime, delay);
    else if (!fixed) N5.delay.delayTime.setTargetAtTime(delay, t, 0.06);
    this._set(N5.air.frequency, clamp2(19e3 * Math.exp(-d / 900), 1200, 19e3), 0.1);
    const pp = (p, v) => {
      p.positionX.setTargetAtTime(v[0], t, 0.03);
      p.positionY.setTargetAtTime(v[1], t, 0.03);
      p.positionZ.setTargetAtTime(v[2], t, 0.03);
    };
    pp(N5.pan, rel);
    if (s.relImg && !inside) {
      const di = Math.max(1, len(s.relImg));
      const dl = fixed ? FIXED_DELAY + FIXED_REFL : Math.min(MAX_DELAY, di / C_SOUND);
      if (jump || fixed !== this._fixed) setNow(N5.reflDelay.delayTime, dl);
      else if (!fixed) N5.reflDelay.delayTime.setTargetAtTime(dl, t, 0.06);
      pp(N5.reflPan, s.relImg);
      this._set(N5.refl.gain, this.outLevel * 0.42 * clamp2(this.refDist / di, 0, 1), 0.08);
    } else this._set(N5.refl.gain, 0, 0.1);
    this._fixed = fixed;
    const cs = s.camSpeed ?? 0;
    const w = clamp2(cs / 160, 0, 1.4);
    this._set(N5.wind.gain, (inside ? 0.32 : 0.2) * w * w, 0.2);
    this._set(N5.windHi.frequency, 500 + 1300 * clamp2(w, 0, 1), 0.2);
    this._set(N5.gust.gain, 0.12 * w * w, 0.3);
    this._set(N5.buffet.gain, (inside ? 1.6 : 0.35) * (s.buffet || 0), 0.05);
    const gs = s.onGround ? clamp2((s.groundSpeed || 0) / 45, 0, 1) : 0;
    this._set(N5.roll.gain, 0.5 * gs, 0.05);
    this._set(N5.rollLP.frequency, 120 + 260 * gs, 0.1);
    this._set(N5.hyd.gain, s.actuating ? 0.035 : 0, 0.12);
    const wh = s.wheels || [];
    for (let i = 0; i < wh.length; i++) {
      if (wh[i] && !this._wheels[i] && (s.sink ?? 0) > 0.3) this._touch(clamp2((s.sink - 0.3) / 2.5, 0.08, 1));
    }
    this._wheels = wh.slice();
    this._engine(s, t, inside);
  }
  /** A tyre touching down: its squeal, short, and the thump of the leg taking the weight. */
  _touch(k) {
    const c = this.ctx, t = c.currentTime, N5 = this.nodes;
    const env = (g2, peak, a, dcy) => {
      g2.gain.setValueAtTime(1e-4, t);
      g2.gain.exponentialRampToValueAtTime(peak, t + a);
      g2.gain.exponentialRampToValueAtTime(1e-4, t + a + dcy);
    };
    const src = c.createBufferSource();
    src.buffer = this._noiseBuf;
    const bp = this._filter("bandpass", 2600, 4);
    const g = this._gain(0);
    env(g, 0.5 * k, 5e-3, 0.12 + 0.12 * k);
    src.connect(bp).connect(g).connect(N5.bus);
    src.start(t, Math.random());
    src.stop(t + 0.4);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const og = this._gain(0);
    env(og, 0.9 * k, 4e-3, 0.16);
    o.connect(og).connect(N5.bus);
    o.start(t);
    o.stop(t + 0.3);
  }
};
var CockpitSound = class extends FlightSound {
  refDist = 35;
  // m: full loudness this close, then falling as 1/distance
  cabinCut = 3200;
  cabinLevel = 0.8;
  outLevel = 1.1;
  _build() {
    const c = this.ctx, N5 = this.nodes;
    N5.ex = this._gain(0.9);
    N5.prop = this._gain(0.55);
    if (globalThis.AudioWorkletNode && c.audioWorklet) {
      try {
        N5.eng = new AudioWorkletNode(c, "flight-piston", { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [1, 1] });
        N5.eng.connect(N5.ex, 0);
        N5.eng.connect(N5.prop, 1);
      } catch (e) {
        console.warn("[sound] piston:", e);
      }
    }
    N5.growlF = this._filter("lowpass", 160, 0.9);
    N5.growl = this._gain(0);
    this._noise().connect(N5.growlF).connect(N5.growl).connect(N5.bus);
    N5.ex.connect(N5.bus);
    N5.prop.connect(N5.bus);
    N5.hornF.frequency.value = 1800;
    N5.horn.frequency.value = 520;
  }
  _engine(s, t, inside) {
    const N5 = this.nodes, P2 = N5.eng?.parameters;
    const power = clamp2(s.powerFrac, 0, 1.15);
    if (P2) {
      P2.get("rpm").setTargetAtTime(s.rpm, t, 0.05);
      P2.get("load").setTargetAtTime(s.running ? power : 0, t, 0.05);
      P2.get("running").setValueAtTime(s.running ? 1 : 0, t);
      P2.get("thrust").setTargetAtTime(power, t, 0.08);
    }
    const spin = clamp2(s.rpm / 2700, 0, 1.1);
    this._set(N5.growl.gain, s.running ? (0.12 + 0.5 * power) * spin : 0, 0.08);
    this._set(N5.growlF.frequency, 90 + 220 * power, 0.1);
    const rel = s.rel || [0, 0, -12], fwd = s.fwd || [0, 0, -1], d = Math.max(1, len(rel));
    const along = Math.abs((fwd[0] * rel[0] + fwd[1] * rel[1] + fwd[2] * rel[2]) / d);
    this._set(N5.prop.gain, inside ? 0.45 : 0.4 + 0.45 * (1 - along), 0.08);
    this._set(N5.hornG.gain, s.stall ? 0.045 : 0, 0.03);
  }
};
var JetSound = class extends FlightSound {
  refDist = 150;
  // m: a fighter is loud a long way off
  cabinCut = 1800;
  cabinLevel = 0.75;
  outLevel = 1;
  /** Its spools' pitch (an airliner's fans slower, an X-wing's whine higher). */
  pitch = 1;
  /** How much of a fighter's crackle and burner it has. */
  fierce = 1;
  _build() {
    const c = this.ctx, N5 = this.nodes;
    N5.front = this._gain(0);
    N5.aft = this._gain(0);
    if (globalThis.AudioWorkletNode && c.audioWorklet) {
      try {
        N5.eng = new AudioWorkletNode(c, "flight-jet", { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [1, 1] });
        N5.eng.connect(N5.front, 0);
        N5.eng.connect(N5.aft, 1);
      } catch (e) {
        console.warn("[sound] jet:", e);
      }
    }
    N5.aftLP = this._filter("lowpass", 9e3, 0.7);
    N5.front.connect(N5.bus);
    N5.aft.connect(N5.aftLP).connect(N5.bus);
    N5.roarLo = this._filter("lowpass", 400, 0.6);
    N5.roarMid = this._filter("bandpass", 900, 0.6);
    N5.roar = this._gain(0);
    this._noise().connect(N5.roarLo).connect(N5.roar);
    this._noise().connect(N5.roarMid).connect(N5.roar);
    N5.roar.connect(N5.bus);
    N5.burnF = this._filter("lowpass", 110, 0.9);
    N5.burnPk = this._filter("peaking", 45, 1.2);
    N5.burnPk.gain.value = 6;
    N5.burn = this._gain(0);
    this._noise().connect(N5.burnF).connect(N5.burnPk).connect(N5.burn).connect(N5.bus);
    N5.ecs = this._gain(0);
    this._noise().connect(this._filter("highpass", 3500, 0.5)).connect(N5.ecs).connect(N5.comp);
    N5.horn.type = "sine";
    N5.horn.frequency.value = 900;
    N5.beep = c.createOscillator();
    N5.beep.type = "square";
    N5.beep.frequency.value = 4;
    N5.beep.start();
    N5.beepG = this._gain(0);
    N5.beep.connect(N5.beepG).connect(N5.hornG.gain);
  }
  _engine(s, t, inside) {
    const N5 = this.nodes, P2 = N5.eng?.parameters;
    const n2 = clamp2(s.rpm / 100, 0, 1.08);
    const thrust = clamp2(s.powerFrac, 0, 1), ab = clamp2(s.ab || 0, 0, 1) * this.fierce;
    if (P2) {
      P2.get("n2").setTargetAtTime(n2, t, 0.1);
      P2.get("thrust").setTargetAtTime(thrust, t, 0.1);
      P2.get("ab").setTargetAtTime(ab, t, 0.08);
      P2.get("running").setValueAtTime(s.running ? 1 : 0, t);
      P2.get("pitch").setValueAtTime(this.pitch, t);
    }
    const rel = s.rel || [0, 0, -12], fwd = s.fwd || [0, 0, -1], d = Math.max(1, len(rel));
    const ahead = -(fwd[0] * rel[0] + fwd[1] * rel[1] + fwd[2] * rel[2]) / d;
    const fr = clamp2(ahead, 0, 1), af = clamp2(-ahead, 0, 1);
    const spin = clamp2(n2 / 0.6, 0, 1);
    this._set(N5.front.gain, inside ? 0.35 : 0.5 + 0.9 * fr, 0.08);
    this._set(N5.aft.gain, (inside ? 0.12 : 0.35 + 1.4 * Math.pow(af, 1.5)) * this.fierce, 0.08);
    const roar = s.running ? (0.16 + 0.5 * thrust + 0.45 * ab) * spin : 0.04 * spin;
    this._set(N5.roar.gain, roar * (inside ? 0.9 : 0.6 + 0.9 * af), 0.1);
    this._set(N5.roarLo.frequency, 220 + 650 * thrust - 120 * ab, 0.1);
    this._set(N5.roarMid.frequency, 600 + 900 * thrust, 0.1);
    this._set(N5.burn.gain, ab * (inside ? 1.4 : 1.1 + 1.6 * af), 0.12);
    this._set(N5.ecs.gain, inside && s.running ? 0.012 : 0, 0.3);
    this._set(N5.hornG.gain, 0, 0.03);
    this._set(N5.beepG.gain, s.stall ? 0.035 : 0, 0.03);
  }
};
var AirlinerSound = class extends JetSound {
  refDist = 120;
  pitch = 0.55;
  fierce = 0.25;
  cabinLevel = 0.55;
};
var XwingSound = class extends JetSound {
  pitch = 1.6;
  fierce = 0.5;
  pew() {
    const ctx = this.ctx;
    if (!ctx || !this.nodes || this.muted) return;
    const t = ctx.currentTime;
    if (!this._pewOut) {
      this._pewOut = ctx.createGain();
      this._pewOut.gain.value = 0.8;
      this._pewOut.connect(ctx.destination);
    }
    const out = this._pewOut;
    const env = (g, peak, attack, decay) => {
      g.gain.setValueAtTime(1e-4, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(1e-4, t + attack + decay);
    };
    const sweepG = ctx.createGain();
    env(sweepG, 0.32, 4e-3, 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    bp.connect(sweepG).connect(out);
    for (const m of [1, 1.02]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(2800 * m, t);
      o.frequency.exponentialRampToValueAtTime(320 * m, t + 0.17);
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.24);
    }
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(190, t);
    sub.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const subG = ctx.createGain();
    env(subG, 0.35, 3e-3, 0.1);
    sub.connect(subG).connect(out);
    sub.start(t);
    sub.stop(t + 0.12);
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2500;
    const nG = ctx.createGain();
    env(nG, 0.25, 2e-3, 0.04);
    n.connect(hp).connect(nG).connect(out);
    n.start(t, Math.random());
    n.stop(t + 0.1);
  }
};

// src/plugin/seatPose.js
var SEAT_POSE = {
  RightArm: [55, -20, 0],
  // down and in: the hand in front of the lap, on the stick
  RightForeArm: [-35, 0, 0],
  // the elbow opened: reaching forward to it
  LeftArm: [45, 25, -35],
  // down and out to the left: on the throttle
  LeftForeArm: [-10, 0, 0],
  // the knees up (+x raises them on this rig): at +8 the toes rest on the Extra's floor, 17 cm over the belly;
  // −12 (meant as up) swung them down, the left toe 8 cm out under the fuselage
  RightUpLeg: [8, 0, 0],
  LeftUpLeg: [8, 0, 0],
  RightLeg: [10, 0, 0],
  // the feet lifted, forward onto the pedals
  LeftLeg: [10, 0, 0]
};
var STICK_ARM = { roll: [0, 0, 12], pitch: [-12, 0, 0] };
var SeatPose = class {
  constructor() {
    this.pose = structuredClone(SEAT_POSE);
    this.stickArm = structuredClone(STICK_ARM);
    this._mesh = null;
    this._bones = null;
    this._q = new pc.Quat();
  }
  /** After the animation, this frame: `mesh` the avatar's (ArrivalSpace.getPlayerMesh), `stick` { x: roll, y: pitch } −1…1. */
  apply(mesh, stick = { x: 0, y: 0 }) {
    if (!mesh) return;
    if (this._mesh !== mesh) {
      this._mesh = mesh;
      this._bones = {};
      for (const name of Object.keys(this.pose)) this._bones[name] = mesh.findByName(name);
    }
    for (const [name, d] of Object.entries(this.pose)) {
      const b = this._bones[name];
      if (!b) continue;
      let [x, y, z] = d;
      if (name === "RightArm") {
        const r = this.stickArm.roll, p = this.stickArm.pitch;
        x += r[0] * stick.x + p[0] * stick.y;
        y += r[1] * stick.x + p[1] * stick.y;
        z += r[2] * stick.x + p[2] * stick.y;
      }
      if (!x && !y && !z) continue;
      this._q.setFromEulerAngles(x, y, z);
      const q = b.getLocalRotation().clone().mul(this._q);
      b.setLocalRotation(q);
    }
  }
};

// src/plugin/extra300Plane.js — the Extra 300L as a vehicle in any space: no airfield, no scenery
var SEAT = { forward: -0.9, height: 0.79, lean: 20 };
var SEAT_ANIMATION = "driving.glb";
var PLANE_BOARD_DISTANCE = 9;
var PLANE_AIR = { h: -1e5, normal: [0, 0, -1], surface: "asphalt" };
var PATCH_REACH = 40;
var PLANE_KEYS = ["view", "reset", "pause", "help", "parkingBrake", "autoRudder", "easy", "exit", "lookCenter"];
var HELP_LINE = "R / F throttle \xB7 W / S pitch \xB7 A / D roll \xB7 Q / E rudder \xB7 B brakes \xB7 L easy mode \xB7 V view \xB7 Backspace back to start \xB7 Esc get out";

var extraModelLoad = null;
/** The model's bytes, fetched once (decodeModel reads EXTRA300L_MODEL). */
function loadExtraModel() {
  extraModelLoad ??= fetch(EXTRA300L_MODEL_URL).then((r) => {
    if (!r.ok) throw new Error(`Extra 300L model: HTTP ${r.status}`);
    return r.arrayBuffer();
  }).then((b) => {
    EXTRA300L_MODEL = new Uint8Array(b);
  });
  return extraModelLoad;
}
/** The Extra's parts, its white and red repainted. */
function paintedExtra(paint, trim) {
  return buildExtraModel().map((p) => p.material === "white" ? { ...p, color: paint } : p.material === "red" ? { ...p, color: trim } : p);
}

/** The Extra's data with the engine's power scaled. */
function extraSpec(power) {
  const s = structuredClone(extra300l_default);
  s.engine.ratedPower *= power;
  return s;
}

var Extra300Plane = class extends ArrivalScript {
  static scriptName = "Extra 300 Plane";
  paint = "#f3f1ec";
  trim = "#c41e2a";
  power = 1;
  easyMode = true;
  chaseDistance = 1;
  static properties = {
    paint: { title: "Main paint" },
    trim: { title: "Trim paint: stripes, tips" },
    power: { title: "Engine power \xD7", min: 0.5, max: 3, step: 0.1 },
    easyMode: { title: "Easy mode at start: the wing can't stall, the torque is handled (L in flight)" },
    chaseDistance: { title: "Chase camera distance \xD7", min: 0.3, max: 4, step: 0.1 }
  };
  initialize() {
    this._flying = false;
    this._keys = /* @__PURE__ */ new Set();
    this._mouse = { dragging: false, id: null, lastX: 0, lastY: 0 };
    this._root = new pc.Entity("Extra300Root");
    this.entity.addChild(this._root);
    this.mapper = new ControlMapper({ easy: this.easyMode, autoTrim: true });
    this.cameraRig = new CameraRig({ eye: extra300l_default.eye, towerPos: [0, 0, 0] });
    this._buildHud();
    loadExtraModel().then(() => {
      if (!this._destroyed) this._build();
    });
    this._onKeyDown = (e) => this._keyDown(e);
    this._onKeyUp = (e) => this._keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    this._onBlur = () => this._keys.clear();
    this._onPointerDown = (e) => {
      if (this._mouse.dragging && e.pointerId !== this._mouse.id) return;
      Object.assign(this._mouse, { dragging: true, id: e.pointerId, lastX: e.clientX, lastY: e.clientY });
    };
    this._onPointerUp = (e) => {
      if (e.pointerId === this._mouse.id) this._mouse.dragging = false;
    };
    this._onPointerMove = (e) => {
      if (!this._mouse.dragging || e.pointerId !== this._mouse.id) return;
      if (this._flying) this.cameraRig.look(-(e.clientX - this._mouse.lastX) * 5e-3, -(e.clientY - this._mouse.lastY) * 5e-3);
      this._mouse.lastX = e.clientX;
      this._mouse.lastY = e.clientY;
    };
    this._onWheel = (e) => {
      if (!this._flying) return;
      this.cameraRig.zoom(Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100 || 1));
      e.preventDefault();
    };
    const canvas = this.app.graphicsDevice.canvas;
    window.addEventListener("keydown", this._onKeyDown, true);
    window.addEventListener("keyup", this._onKeyUp, true);
    window.addEventListener("blur", this._onBlur);
    canvas.addEventListener("pointerdown", this._onPointerDown);
    canvas.addEventListener("wheel", this._onWheel, { passive: false });
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointercancel", this._onPointerUp);
    window.addEventListener("pointermove", this._onPointerMove);
    this._initNetwork();
  }
  get _ws() {
    const s = Number(this.app.worldScale);
    return s > 0 ? s : 0.7;
  }
  // ── the airplane ──────────────────────────────────────────────────────────
  /** Flight model, instruments, 3D model, colliders and sound, parked at the vibe's place. */
  _build() {
    const spec = extraSpec(this.power);
    this.ac = new Aircraft(spec, { ground: (n, e) => this._ground(n, e), load: { fuelCenterL: spec.mass.items.fuelCenter.capacityL } });
    this.instruments = new Instruments(spec, { kollsman: 29.92 * INHG });
    this.mapper.setHandling(spec.handling);
    this.cameraRig.eye = spec.eye;
    this.cameraRig.size = this.chaseDistance;
    this._unsubClick?.();
    this._colliders?.destroy();
    this.visual?.destroy();
    this.sound?.stop();
    const parts = paintedExtra(this.paint, this.trim);
    this.visual = new AircraftVisual(this.app, this._root, parts, "Extra 300L");
    this._colliders = new AircraftColliders(this.app, this.visual.root, parts, this._ws);
    this.sound = new CockpitSound();
    this._unsubClick = ArrivalSpace.onEntityClick(this.visual.root, (e) => {
      e.stopPropagation();
      this._enter();
    });
    this._park();
  }
  /** On its wheels where the vibe stands, nose along the vibe's forward, engine off, brake set. */
  _park() {
    const ps = this.entity.getWorldTransform().getScale(), ws = this._ws;
    this._root.setLocalScale(ws / (ps.x || 1), ws / (ps.y || 1), ws / (ps.z || 1));
    this._root.setRotation(pc.Quat.IDENTITY);
    this._root.setPosition(this.entity.getPosition());
    const f = this.entity.forward;
    const heading = Math.atan2(f.x, -f.z);
    const side = fromNE(-Math.sin(heading) * 25, Math.cos(heading) * 25, 6);
    this.cameraRig.towerPos = side;
    this._sampleGround(0, 0, 0);
    this.mapper.resetHolds();
    this.ac.placeOnGround(0, 0, heading);
    this.ac.controls.parkingBrake = true;
    this._autoBrake = true;
    this.ac.setEngineRunning(false);
    this._autoStarter = true;
    this._crankT = 0;
    this.mapper.throttle = 0;
    this.instruments.resetG();
    for (let i = 0; i < 480; i++) this.ac.step(1 / 480);
    this._broken = false;
    this.visual.update(this.ac, 0);
  }
  // ── the ground: the space's colliders ────────────────────────────────────
  /** The sim's ground at (n, e): a plane fitted under the airplane once a frame, a ray of its own further out. */
  _ground(n, e) {
    const p = this._patch;
    if (!p || Math.abs(n - p.n) > PATCH_REACH || Math.abs(e - p.e) > PATCH_REACH) return this._ray(n, e) || PLANE_AIR;
    if (p.miss) return PLANE_AIR;
    return { h: p.h + (p.normal[0] * (n - p.n) + p.normal[1] * (e - p.e)) / p.normal[2], normal: p.normal, surface: "asphalt" };
  }
  /** A ray down at (n, e) from just above the airplane's centre of gravity: { h, normal } or null. */
  _ray(n, e, up = -this.ac.state.pos[2] + 2) {
    const ws = this._ws, o = this._root.getPosition();
    const from = fromNE(n, e, up);
    const hit = ArrivalSpace.raycastPhysics(
      { x: o.x + from[0] * ws, y: o.y + from[1] * ws, z: o.z + from[2] * ws },
      { x: 0, y: -1, z: 0 },
      5e3 * ws,
      { ignore: [this._root] }
    );
    if (!hit) return null;
    const nm = hit.normal;
    return { h: (hit.point.y - o.y) / ws, normal: [-nm.z, nm.x, -nm.y], surface: "asphalt" };
  }
  /** The patch under (n, e) for this frame. Parking (`fallback` set): the ray from 2 m over the spot, and that height where no collider is. */
  _sampleGround(n, e, fallback = null) {
    const r = this._ray(n, e, fallback == null ? void 0 : 2) || (fallback == null ? null : { h: fallback, normal: [0, 0, -1] });
    this._patch = r ? { n, e, h: r.h, normal: r.normal, miss: false } : { n, e, miss: true };
  }
  // ── boarding ─────────────────────────────────────────────────────────────
  _near() {
    const player = ArrivalSpace.getPlayer();
    return !!player && player.getPosition().distance(this.visual.root.getPosition()) < PLANE_BOARD_DISTANCE * this._ws;
  }
  _enter() {
    if (this._flying || ArrivalSpace.getLocalAttachedEntity?.()) return;
    this._flying = true;
    this._colliders.enabled = false;
    this.cameraRig.view = "chase";
    this.cameraRig.chasePos = null;
    this.cameraRig.centre();
    this.mapper.easy = this.easyMode;
    this.lockKeyboard();
    this._prevMode = ArrivalSpace.getCameraMode() || "third";
    const cam0 = sceneCamera();
    this._camLocal = cam0 ? { parent: cam0.parent, p: cam0.getLocalPosition().clone(), r: cam0.getLocalRotation().clone() } : null;
    this._attachPilot();
    ArrivalSpace.setCameraMode("free");
    const cam = sceneCamera();
    if (cam?.camera) {
      this._camSaved = { near: cam.camera.nearClip, far: cam.camera.farClip, fov: cam.camera.fov };
      cam.camera.nearClip = 0.1 * this._ws;
      cam.camera.farClip = Math.max(cam.camera.farClip, 8e3 * this._ws);
    }
    this._setAvatarVisible(true);
    this.visual.setCockpitView(false);
    this.sound.start();
    ArrivalSpace.setAppUIVisible(false);
    this._pose = this.cameraRig.update(this.ac, 0, this.ac.cg);
    this._hudFlying(true);
    this._flash("Hold R for full throttle, at 60 kt ease back on S", 6);
  }
  /** The avatar in the rear seat, carried by a mount every client knows by name (the others see the airplane round it). */
  _attachPilot() {
    const mount = this._mountEntity();
    if (mount) this._follow(mount);
    this._attach = ArrivalSpace.attachPlayerToEntity(mount || this.visual.root, {
      offset: { x: this.ac.spec.eye[1], y: -SEAT.height, z: -SEAT.forward },
      animations: { Idle: SEAT_ANIMATION, Forward: SEAT_ANIMATION, Backward: SEAT_ANIMATION, Left: SEAT_ANIMATION, Right: SEAT_ANIMATION },
      // the avatar faces the entity's +z, the airplane's nose is its -z: turned round, leaning back into the seat
      meshEuler: () => ({ x: -SEAT.lean, y: 180, z: 0 }),
      disableCollision: true,
      rate: 20,
      extra: () => {
        const c = this.ac.controls;
        return { x3: [this.paint, this.trim], c: [c.aileron, c.elevator, c.rudder, c.elevatorTrim, c.flaps || 0, c.throttle].map((x) => Math.round((x || 0) * 1e3) / 1e3), rpm: Math.round(this.ac.rpm) };
      }
    }) || null;
  }
  /** Out beside the airplane; it stays where it stopped, or goes back to its place if it is up in the air or broken. */
  _exit() {
    if (!this._flying) return;
    this._flying = false;
    this._colliders.enabled = true;
    this.unlockKeyboard();
    this._keys.clear();
    this._attach?.detach?.();
    this._attach = null;
    ArrivalSpace.setCameraMode(this._prevMode || "third");
    const cam = sceneCamera();
    if (cam && this._camLocal && cam.parent === this._camLocal.parent) {
      cam.setLocalPosition(this._camLocal.p);
      cam.setLocalRotation(this._camLocal.r);
    }
    if (cam?.camera && this._camSaved) {
      cam.camera.nearClip = this._camSaved.near;
      cam.camera.farClip = this._camSaved.far;
      cam.camera.fov = this._camSaved.fov;
    }
    ArrivalSpace.setAppUIVisible(true);
    this._setAvatarVisible(true);
    this.visual.setCockpitView(false);
    this.sound.stop();
    this._hudFlying(false);
    if (this._patch?.miss || this.ac.agl > 3 || this._broken) this._park();
    else {
      this.ac.state.vel = [0, 0, 0];
      this.ac.state.omega = [0, 0, 0];
      this.ac.setEngineRunning(false);
      this.ac.controls.parkingBrake = true;
      this._autoBrake = true;
      this._autoStarter = true;
      this.mapper.throttle = 0;
    }
    const ws = this._ws, p = this.ac.referencePoint(), psi = this.ac.euler.psi;
    const out0 = this.ac.spec.wing.span / 2 + 1.5;
    const local = fromNE(p[0] + Math.sin(psi) * out0, p[1] - Math.cos(psi) * out0, -p[2] + 1);
    const o = this._root.getPosition();
    ArrivalSpace.teleportPlayer({ x: o.x + local[0] * ws, y: o.y + local[1] * ws, z: o.z + local[2] * ws }, { azimuth: -(psi / DEG + 90) });
  }
  _setAvatarVisible(v) {
    const mesh = ArrivalSpace.getPlayerMesh();
    if (mesh) mesh.enabled = v;
  }
  // ── input ────────────────────────────────────────────────────────────────
  _keyDown(e) {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!this._flying) {
      if (this.visual && key === "e" && ArrivalSpace.getCameraMode() !== "free" && this._near()) {
        this._enter();
        e.preventDefault();
      }
      return;
    }
    this.sound.start();
    // E standing still with the throttle closed: out (moving, it is the rudder)
    if (key === "e" && this.ac.gear.onGround && this.ac.groundSpeed < 0.5 && this.mapper.throttle < 0.02) {
      this._exit();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!this._keys.has(key)) {
      for (const name of PLANE_KEYS) if (ACTIONS[name].includes(key)) this._action(name);
    }
    if (!this._flying) return;
    this._keys.add(key);
    if (key.startsWith("Arrow") || key.startsWith("Page") || key === " " || key === "Home" || key === "End" || key === "Backspace") e.preventDefault();
    if (e.ctrlKey || e.altKey || key === "Alt" || key === "Control") e.preventDefault();
    e.stopPropagation();
  }
  _action(name) {
    switch (name) {
      case "view": {
        const v = this.cameraRig.cycle();
        this._setAvatarVisible(v !== "cockpit");
        this.visual.setCockpitView(v === "cockpit");
        this._flash(`View: ${v}`, 1.5);
        break;
      }
      case "reset":
        this._park();
        this._flash("Back at the start", 2);
        break;
      case "pause":
        this._paused = !this._paused;
        this._flash(this._paused ? "Paused (P)" : "", 1);
        break;
      case "help":
        this._hud.help.style.display = this._hud.help.style.display === "none" ? "block" : "none";
        break;
      case "parkingBrake":
        this._autoBrake = false;
        this.ac.controls.parkingBrake = !this.ac.controls.parkingBrake;
        this._flash(this.ac.controls.parkingBrake ? "Parking brake on" : "Parking brake off", 1.2);
        break;
      case "autoRudder":
        this.mapper.autoRudder = !this.mapper.autoRudder;
        this._flash(this.mapper.autoRudder ? "Auto-rudder on" : "Auto-rudder off", 1.5);
        break;
      case "easy":
        this.mapper.easy = !this.mapper.easy;
        this._flash(this.mapper.easy ? "Easy mode: the wing can't stall, the torque is handled" : "Easy mode off: all yours", 2.5);
        break;
      case "lookCenter":
        this.cameraRig.centre();
        break;
      case "exit":
        this._exit();
        break;
    }
  }
  _readPad() {
    for (const p of navigator.getGamepads?.() || []) {
      if (p && p.connected && p.axes.length >= 4) return { axes: [...p.axes], buttons: p.buttons.map((b) => b.value) };
    }
    return null;
  }
  // ── frame ────────────────────────────────────────────────────────────────
  update(dt) {
    this._dt = dt;
    if (!this.visual) return;
    this._colliders.tick();
    this._remotesUpdate();
    if (!this._flying) {
      this._hud.prompt.style.display = this._near() && ArrivalSpace.getCameraMode() !== "free" ? "block" : "none";
      return;
    }
    const st = this.ac.state;
    this._sampleGround(st.pos[0], st.pos[1]);
    if (!this._paused && !this._broken) {
      const raw = { keys: this._keys, pad: this._readPad(), left: null, right: null, yoke: null, fire: false };
      const n = Math.min(12, Math.ceil(dt * 120 - 1e-6)), h = dt / n;
      for (let i = 0; i < n; i++) {
        this.mapper.update(raw, h, this.ac.controls, this.ac.flightState());
        this._engineAndBrakes(h);
        this.ac.update(h);
      }
      this._checkCrash(dt);
    }
    for (const ev of this.ac.events.splice(0)) {
      if (ev.e === "propStrike" || /^belly/.test(ev.e)) {
        this._broken = true;
        this._flash("Crashed. Backspace: back to the start", 5);
      }
    }
    if (this._patch.miss && -st.pos[2] < -500) {
      this._park();
      this._flash("Off the edge of the world: back at the start", 3);
    }
    const v = this.instruments.update(this.ac, dt);
    this.visual.update(this.ac, this._paused ? 0 : dt);
    if (this._mount) this._follow(this._mount);
    this._pose = this.cameraRig.update(this.ac, dt, this.ac.cg);
    this.sound.update(this._soundState(v));
    this._hudTick(v, dt);
  }
  /** Flown into something that is not ground (a wall, a tree trunk, a building's side): the flight ends there. */
  _checkCrash(dt) {
    const st = this.ac.state, speed = Math.hypot(st.vel[0], st.vel[1], st.vel[2]);
    if (this.ac.gear.onGround || speed < 5) return;
    const ws = this._ws, o = this._root.getPosition(), c = fromNE(st.pos[0], st.pos[1], -st.pos[2]), v = fromNE(st.vel[0], st.vel[1], -st.vel[2]);
    const hit = ArrivalSpace.raycastPhysics(
      { x: o.x + c[0] * ws, y: o.y + c[1] * ws, z: o.z + c[2] * ws },
      { x: v[0], y: v[1], z: v[2] },
      (speed * dt + 3) * ws,
      { ignore: [this._root] }
    );
    if (!hit || hit.normal.y > 0.7) return;
    this._broken = true;
    st.vel = [0, 0, 0];
    st.omega = [0, 0, 0];
    this.ac.setEngineRunning(false);
    this._flash("Crashed. Backspace: back to the start", 5);
  }
  /** The engine cranked and the brake let go as the throttle comes up (each control step). */
  _engineAndBrakes(dt) {
    const c = this.ac.controls;
    if (this._autoStarter && this.mapper.throttle > 0.02) {
      this._crankT += dt;
      if (this.ac.engine.running || this._crankT > 30) {
        c.starter = false;
        this._autoStarter = false;
      } else c.starter = true;
    }
    if (this._autoBrake) {
      if (this.mapper.throttle > 0.1 || !this.ac.gear.onGround) {
        this._autoBrake = false;
        c.parkingBrake = false;
      } else c.parkingBrake = true;
    }
  }
  _soundState(v) {
    const ac = this.ac, ws = this._ws;
    const s = {
      rpm: ac.rpm,
      powerFrac: Math.max(0, ac.engine.power) / ac.spec.engine.ratedPower,
      ab: 0,
      running: ac.engine.running,
      qbar: ac.out.qbar,
      stall: v.stallWarning,
      inside: this.cameraRig.view === "cockpit",
      doppler: !["cockpit", "chase"].includes(this.cameraRig.view)
    };
    const cam = sceneCamera(), root = this.visual.root;
    if (cam) {
      const inv = (this._sndInv ??= new pc.Mat4()).copy(cam.getWorldTransform()).invert();
      const r = inv.transformPoint(root.getPosition(), this._sndV ??= new pc.Vec3());
      s.rel = [r.x / ws, r.y / ws, r.z / ws];
      const f = inv.transformVector(root.forward, this._sndF ??= new pc.Vec3()).normalize();
      s.fwd = [f.x, f.y, f.z];
      s.camSpeed = s.doppler ? 0 : ac.out.tas || 0;
    }
    s.buffet = ac.gear.onGround ? 0 : Math.max(0, Math.min(1, (Math.abs(v.aoa || 0) * DEG - (this.mapper.buffetAlpha || 0.27)) / 0.08)) * Math.min(1, ac.out.qbar / 1500);
    s.onGround = ac.gear.onGround;
    s.groundSpeed = ac.groundSpeed;
    s.wheels = ac.gear.units.map((u) => u.onGround);
    s.sink = Math.max(0, this._sndSink ?? 0);
    this._sndSink = ac.state.vel[2];
    s.actuating = false;
    return s;
  }
  postUpdate() {
    if (this._flying) {
      const cam = sceneCamera(), pose = this._pose, o = this._root.getPosition(), ws = this._ws;
      if (cam) {
        cam.setPosition(o.x + pose.pos[0] * ws, o.y + pose.pos[1] * ws, o.z + pose.pos[2] * ws);
        cam.setRotation(pose.rot[0], pose.rot[1], pose.rot[2], pose.rot[3]);
        if (cam.camera) cam.camera.fov = pose.fov;
      }
      this._seatPose ??= new SeatPose();
      const c = this.ac.controls;
      this._seatPose.apply(ArrivalSpace.getPlayerMesh(), { x: c.aileron || 0, y: c.elevator || 0 });
    }
    for (const r of this._remotes.values()) {
      if (r.mesh && r.meshQ && r.visual?.root.enabled && !r.mesh._destroyed) r.mesh.setRotation(r.meshQ);
    }
  }
  // ── on screen ────────────────────────────────────────────────────────────
  _buildHud() {
    const box = { position: "fixed", left: "50%", transform: "translateX(-50%)", zIndex: "20", color: "#f4f2ec", font: '600 13px/1.4 "Helvetica Neue", Arial, sans-serif', textShadow: "0 1px 2px rgba(0,0,0,0.8)", whiteSpace: "nowrap" };
    const prompt = this.createUI("div", { style: { ...box, bottom: "110px", padding: "8px 14px", background: "rgba(20,24,30,0.72)", borderRadius: "8px", display: "none", pointerEvents: "none" } });
    prompt.textContent = "E \xB7 fly the Extra 300L (or click it)";
    const bar = this.createUI("div", { style: { ...box, top: "14px", padding: "8px 14px", background: "rgba(20,24,30,0.72)", borderRadius: "8px", display: "none", pointerEvents: "auto" } });
    bar.innerHTML = '<span data-k="data"></span> <button data-k="reset" style="margin-left:10px">Back to start</button> <button data-k="exit">Get out</button>';
    bar.querySelector('[data-k="reset"]').onclick = (ev) => {
      ev.stopPropagation();
      this._action("reset");
    };
    bar.querySelector('[data-k="exit"]').onclick = (ev) => {
      ev.stopPropagation();
      this._exit();
    };
    const help = this.createUI("div", { style: { ...box, bottom: "16px", padding: "6px 12px", background: "rgba(20,24,30,0.6)", borderRadius: "8px", fontWeight: "500", fontSize: "12px", display: "none", pointerEvents: "none" } });
    help.textContent = HELP_LINE;
    const flash = this.createUI("div", { style: { ...box, top: "64px", fontSize: "15px", display: "none", pointerEvents: "none" } });
    this._hud = { prompt, bar, data: bar.querySelector('[data-k="data"]'), help, flash, flashT: 0 };
  }
  _hudFlying(on) {
    const h = this._hud;
    h.bar.style.display = on ? "block" : "none";
    h.help.style.display = on ? "block" : "none";
    h.prompt.style.display = "none";
    if (!on) h.flash.style.display = "none";
  }
  _flash(text, seconds) {
    const h = this._hud;
    h.flash.textContent = text;
    h.flash.style.display = text ? "block" : "none";
    h.flashT = seconds;
  }
  _hudTick(v, dt) {
    const h = this._hud;
    if (h.flashT > 0 && (h.flashT -= dt) <= 0) h.flash.style.display = "none";
    this._hudAcc = (this._hudAcc || 0) + dt;
    if (this._hudAcc < 0.1) return;
    this._hudAcc = 0;
    const ac = this.ac, agl = this._patch.miss ? null : Math.max(0, ac.agl - 1);
    const parts = [
      `${Math.round(v.ias || 0)} kt`,
      `ALT ${Math.round(-ac.state.pos[2])} m`,
      agl == null ? "no ground below" : `AGL ${Math.round(agl)} m`,
      `VS ${((-ac.state.vel[2]) || 0).toFixed(1)} m/s`,
      `THR ${Math.round((ac.controls.throttle || 0) * 100)} %`,
      ac.engine.running ? `${Math.round(ac.rpm)} rpm` : "engine off",
      this.mapper.easy ? "EASY" : "",
      v.stallWarning ? "STALL" : ""
    ];
    h.data.textContent = parts.filter(Boolean).join("  \xB7  ");
  }
  // ── the other pilots ─────────────────────────────────────────────────────
  /** Every other visitor's airplane where their avatar sits: a stub named as their mount, told when they board. */
  _initNetwork() {
    this._remotes = /* @__PURE__ */ new Map();
    this._unsubs = [];
    const net = ArrivalSpace.net;
    if (!net) return;
    this._unsubs.push(
      net.onPlayerJoin?.((p) => this._watch(p.socketId)),
      net.onPlayerLeave?.((p) => this._unwatch(p.socketId)),
      net.onConnect?.(() => this._watchAll())
    );
    this._watchAll();
  }
  _watchAll() {
    for (const p of ArrivalSpace.net?.getPlayers() || []) this._watch(p.socketId);
  }
  _watch(sid) {
    const host = this.entity.parent;
    if (!sid || this._remotes.has(sid) || !host?.script?.userModelEntity) return;
    const stub = new pc.Entity(`pilot-${sid}`);
    host.addChild(stub);
    const r = { stub, info: null, visual: null, ac: null, key: "" };
    r.unsub = ArrivalSpace.onEntityAttachChanged(stub, (info) => {
      r.info = info || null;
      if (!info) this._dropRemote(r);
    });
    this._remotes.set(sid, r);
  }
  _unwatch(sid) {
    const r = this._remotes.get(sid);
    if (!r) return;
    this._dropRemote(r);
    r.unsub?.();
    r.stub.destroy();
    this._remotes.delete(sid);
  }
  _dropRemote(r) {
    r.visual?.destroy();
    r.visual = null;
    r.key = "";
    r.mesh = null;
  }
  /** Ours, by name on every client: a child of the space entity that follows our airplane. */
  _mountEntity() {
    const host = this.entity.parent, sid = this.app.networkManager?.mySocketID;
    if (!host?.script?.userModelEntity || !sid) return null;
    if (this._mount && this._mount.name !== `pilot-${sid}`) {
      this._mount.destroy();
      this._mount = null;
    }
    if (!this._mount) {
      this._mount = new pc.Entity(`pilot-${sid}`);
      host.addChild(this._mount);
    }
    return this._mount;
  }
  _follow(m) {
    const root = this.visual.root;
    m.setPosition(root.getPosition());
    m.setRotation(root.getRotation());
    const s = root.getWorldTransform().getScale().x, hs = m.parent.getWorldTransform().getScale().x || 1;
    m.setLocalScale(s / hs, s / hs, s / hs);
  }
  /** Posed from what they send (controls, rpm), placed: their avatar less the seat offset turned by the airplane. */
  _remotesUpdate() {
    const players = ArrivalSpace.net?.getPlayers() || [];
    for (const r of this._remotes.values()) {
      const ex = r.info?.extra;
      const driver = ex?.x3 && players.find((p) => p.socketId === r.info.networkId)?.entity;
      if (!driver || driver.getPosition().y < -900) {
        if (r.visual) r.visual.root.enabled = false;
        continue;
      }
      const key = ex.x3.join("|");
      if (r.key !== key) {
        r.visual?.destroy();
        r.visual = new AircraftVisual(this.app, this._root, paintedExtra(ex.x3[0], ex.x3[1]), "Extra 300L (pilot)");
        r.ac = new Aircraft(extra300l_default, { ground: () => PLANE_AIR });
        r.key = key;
      }
      const c = ex.c || [];
      const controls = { aileron: c[0] || 0, elevator: c[1] || 0, rudder: c[2] || 0, elevatorTrim: c[3] || 0, flaps: c[4] || 0, throttle: c[5] || 0 };
      for (const s of r.ac.aero.strips) s.deflection = controlDeflection(s, controls, r.ac.spec.rigging);
      r.visual.update({ spec: r.ac.spec, aero: r.ac.aero, gear: r.ac.gear, state: r.ac.state, referencePoint: () => r.ac.referencePoint(), controls, rpm: ex.rpm || 0, gearPos: 1, out: { alpha: 0 }, engine: r.ac.engine }, this._dt || 0);
      const off = r.info.offset || { x: 0, y: 0, z: 0 }, q = r.info.quaternion, ws = this._ws;
      const d = (this._rv ??= new pc.Vec3()).set(off.x * ws, off.y * ws, off.z * ws);
      q.transformVector(d, d);
      const p = driver.getPosition();
      r.visual.root.enabled = true;
      r.visual.root.setPosition(p.x - d.x, p.y - d.y, p.z - d.z);
      r.visual.root.setRotation(q);
      r.mesh = driver.findByName("ReadyPlayerMe");
      (this._rq ??= new pc.Quat()).setFromEulerAngles(-SEAT.lean, 180, 0);
      r.meshQ = (r.meshQ || new pc.Quat()).copy(q).mul(this._rq);
    }
  }
  // ── editor ───────────────────────────────────────────────────────────────
  onPropertyChanged(name) {
    if (!this.visual) return;
    if (name === "easyMode") this.mapper.easy = this.easyMode;
    else if (name === "chaseDistance") this.cameraRig.size = this.chaseDistance;
    else if (name === "paint" || name === "trim" || name === "power") {
      this._exit();
      this._build();
    }
  }
  onEntityMoved() {
    if (this.visual && !this._flying) this._park();
  }
  destroy() {
    this._destroyed = true;
    this._exit();
    window.removeEventListener("keydown", this._onKeyDown, true);
    window.removeEventListener("keyup", this._onKeyUp, true);
    window.removeEventListener("blur", this._onBlur);
    const canvas = this.app.graphicsDevice.canvas;
    canvas.removeEventListener("pointerdown", this._onPointerDown);
    canvas.removeEventListener("wheel", this._onWheel);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointercancel", this._onPointerUp);
    window.removeEventListener("pointermove", this._onPointerMove);
    for (const u of this._unsubs) if (typeof u === "function") u();
    for (const sid of [...this._remotes.keys()]) this._unwatch(sid);
    this._unsubClick?.();
    this._mount?.destroy();
    this._colliders?.destroy();
    this.sound?.stop();
    this.removeUI();
    this._root.destroy();
  }
};
export {
  Extra300Plane
};
