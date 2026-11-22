// Wildfire engine: Rothermel surface-fire spread on real terrain, spread as an elliptical front.
//
// Rate of spread: Rothermel (1972) with the Albini (1976) dead/live formulation, as in BehavePlus / FARSITE
// (equations as summarised by Andrews 2018, RMRS-GTR-371), with the Anderson (1982) fuel models. Imperial units
// inside the model, as in the original; results are converted to metric.
// Shape: Anderson (1983) length-to-breadth ratio from the effective wind speed; the fire grows from its focus,
// R(θ) = R_head (1 − e) / (1 − e cos θ). Over the DEM the front is found as the minimum arrival time (Dijkstra on a
// 16-neighbour stencil), with wind and the local upslope direction combined per cell (Rothermel's vector sum).
import type { Dem } from './flood';
import { GAZETTEER } from './parse';
import { fmt } from './validate';
import type { CalcStep, ChoiceSpec, ParamSpec, SimOutput, SimResult, SimSeries, ValidationIssue } from './types';

export const WILDFIRE_VERSION = '1.0.0';
const T_AC = 0.0459137; // tons/acre → lb/ft²
const RHO_P = 32; // lb/ft³ particle density
const S_T = 0.0555; // total mineral content
const S_E = 0.01; // effective mineral content
const HEAT = 8000; // BTU/lb
const FT_MIN_TO_M_MIN = 0.3048;
const FRAMES = 24;

export interface FuelModel {
  id: string;
  name: string;
  load: [number, number, number, number]; // tons/acre: 1 h, 10 h, 100 h dead; live woody
  sav: [number, number, number, number]; // surface-area-to-volume, 1/ft
  depth: number; // ft
  mx: number; // dead fuel moisture of extinction, fraction
}

/** Anderson (1982) fire-behaviour fuel models (from the standard 13). */
export const FUEL_MODELS: FuelModel[] = [
  { id: '1', name: 'FM1 Short grass', load: [0.74, 0, 0, 0], sav: [3500, 109, 30, 1500], depth: 1.0, mx: 0.12 },
  { id: '2', name: 'FM2 Timber with grass understory', load: [2.0, 1.0, 0.5, 0.5], sav: [3000, 109, 30, 1500], depth: 1.0, mx: 0.15 },
  { id: '3', name: 'FM3 Tall grass', load: [3.01, 0, 0, 0], sav: [1500, 109, 30, 1500], depth: 2.5, mx: 0.25 },
  { id: '4', name: 'FM4 Chaparral / maquis', load: [5.01, 4.01, 2.0, 5.01], sav: [2000, 109, 30, 1500], depth: 6.0, mx: 0.2 },
  { id: '5', name: 'FM5 Brush', load: [1.0, 0.5, 0, 2.0], sav: [2000, 109, 30, 1500], depth: 2.0, mx: 0.2 },
  { id: '6', name: 'FM6 Dormant brush', load: [1.5, 2.5, 2.0, 0], sav: [1750, 109, 30, 1500], depth: 2.5, mx: 0.25 },
  { id: '8', name: 'FM8 Closed timber litter', load: [1.5, 1.0, 2.5, 0], sav: [2000, 109, 30, 1500], depth: 0.2, mx: 0.3 },
  { id: '9', name: 'FM9 Hardwood / pine litter', load: [2.92, 0.41, 0.15, 0], sav: [2500, 109, 30, 1500], depth: 0.2, mx: 0.25 },
  { id: '10', name: 'FM10 Timber litter and understory', load: [3.01, 2.0, 5.01, 2.0], sav: [2000, 109, 30, 1500], depth: 1.0, mx: 0.25 },
];

export interface Moisture { d1: number; d10: number; d100: number; live: number } // fractions

export interface RothermelOut {
  r0: number; // ft/min, no wind, no slope
  ir: number; // reaction intensity, BTU/ft²/min
  beta: number;
  betaOp: number;
  sigma: number;
  C: number;
  B: number;
  E: number;
  tr: number; // residence time, min
  heatSink: number;
  xi: number;
}

/** Rothermel no-wind, no-slope spread and the coefficients needed for wind and slope. */
export function rothermel(fm: FuelModel, m: Moisture): RothermelOut {
  const w0 = fm.load.map((l) => l * T_AC);
  const mf = [m.d1, m.d10, m.d100, m.live];
  const live = [false, false, false, true];
  const a = w0.map((w, i) => (fm.sav[i] * w) / RHO_P);
  const Ad = a[0] + a[1] + a[2];
  const Al = a[3];
  const At = Ad + Al;
  const fij = a.map((x, i) => (live[i] ? (Al > 0 ? x / Al : 0) : Ad > 0 ? x / Ad : 0));
  const fd = At > 0 ? Ad / At : 0;
  const fl = At > 0 ? Al / At : 0;
  const sigD = [0, 1, 2].reduce((s, i) => s + fij[i] * fm.sav[i], 0);
  const sigL = Al > 0 ? fm.sav[3] : 0;
  const sigma = fd * sigD + fl * sigL;
  const wnD = [0, 1, 2].reduce((s, i) => s + fij[i] * w0[i] * (1 - S_T), 0);
  const wnL = Al > 0 ? w0[3] * (1 - S_T) : 0;
  const mfD = [0, 1, 2].reduce((s, i) => s + fij[i] * mf[i], 0);
  const rhoB = w0.reduce((s, x) => s + x, 0) / fm.depth;
  const beta = rhoB / RHO_P;
  const betaOp = 3.348 * sigma ** -0.8189;
  const gMax = sigma ** 1.5 / (495 + 0.0594 * sigma ** 1.5);
  const A = 133 * sigma ** -0.7913;
  const gamma = gMax * (beta / betaOp) ** A * Math.exp(A * (1 - beta / betaOp));
  // moisture damping; exactly 0 at or above the moisture of extinction (the cubic only reaches ~1e-16 there)
  const damp = (mfv: number, mx: number) => { const r = mfv / mx; return r >= 1 ? 0 : Math.max(0, 1 - 2.59 * r + 5.11 * r * r - 3.52 * r ** 3); };
  // live-fuel moisture of extinction (Albini 1976)
  let mxL = fm.mx;
  if (Al > 0) {
    const Wd = [0, 1, 2].reduce((s, i) => s + w0[i] * Math.exp(-138 / fm.sav[i]), 0);
    const Wl = w0[3] * Math.exp(-500 / fm.sav[3]);
    const fineM = Wd > 0 ? [0, 1, 2].reduce((s, i) => s + w0[i] * Math.exp(-138 / fm.sav[i]) * mf[i], 0) / Wd : 0;
    mxL = Math.max(fm.mx, 2.9 * (Wd / Wl) * (1 - fineM / fm.mx) - 0.226);
  }
  const etaS = 0.174 * S_E ** -0.19;
  const ir = gamma * HEAT * etaS * (wnD * damp(mfD, fm.mx) + wnL * damp(m.live, mxL));
  const xi = Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) / (192 + 0.2595 * sigma);
  const sinkD = [0, 1, 2].reduce((s, i) => s + fij[i] * Math.exp(-138 / fm.sav[i]) * (250 + 1116 * mf[i]), 0);
  const sinkL = Al > 0 ? Math.exp(-138 / fm.sav[3]) * (250 + 1116 * m.live) : 0;
  const heatSink = rhoB * (fd * sinkD + fl * sinkL);
  const r0 = heatSink > 0 ? (ir * xi) / heatSink : 0;
  return {
    r0, ir, beta, betaOp, sigma, xi, heatSink,
    C: 7.47 * Math.exp(-0.133 * sigma ** 0.55), B: 0.02526 * sigma ** 0.54, E: 0.715 * Math.exp(-3.59e-4 * sigma),
    tr: 384 / sigma,
  };
}

/** Wind factor φw for midflame wind U (ft/min), capped at the Rothermel wind limit 0.9·I_R. */
export const windFactor = (r: RothermelOut, uFtMin: number): number => (uFtMin <= 0 ? 0 : r.C * Math.min(uFtMin, 0.9 * r.ir) ** r.B * (r.beta / r.betaOp) ** -r.E);
/** Slope factor φs for slope tan θ. */
export const slopeFactor = (r: RothermelOut, tanSlope: number): number => 5.275 * r.beta ** -0.3 * tanSlope * tanSlope;
/** Effective wind speed (mph) that alone would give φ. */
export const effectiveWindMph = (r: RothermelOut, phi: number): number => (phi <= 0 ? 0 : (phi * (r.beta / r.betaOp) ** r.E / r.C) ** (1 / r.B) / 88);
/** Anderson (1983) length-to-breadth ratio from effective midflame wind (mph). */
export const lengthToBreadth = (mph: number): number => Math.min(8, Math.max(1, 0.936 * Math.exp(0.2566 * mph) + 0.461 * Math.exp(-0.1548 * mph) - 0.397));

/** Dead-fuel equilibrium moisture (%) from relative humidity (%) and temperature (°C), Simard (1968). */
export function emc(rh: number, tC: number): number {
  const T = tC * 1.8 + 32;
  if (rh < 10) return 0.03229 + 0.281073 * rh - 0.000578 * rh * T;
  if (rh < 50) return 2.22749 + 0.160107 * rh - 0.01478 * T;
  return 21.0606 + 0.005565 * rh * rh - 0.00035 * rh * T - 0.483199 * rh;
}

export interface WildfireInput {
  lat: number;
  lon: number;
  label?: string;
  fuel: string;
  hours: number;
  windKmh: number; // 10 m wind
  windFrom: number; // degrees, meteorological (direction the wind comes from)
  rh: number; // %
  tempC: number;
  liveMoisture: number; // %
  waf: number; // wind adjustment factor 10 m → midflame
  domainKm: number;
}

export const WILDFIRE_PARAMS: ParamSpec[] = [
  { key: 'hours', label: 'Burn time', unit: 'h', min: 0.5, max: 24, step: 0.5, default: 6, help: 'Free-burning time without firefighting.' },
  { key: 'windKmh', label: '10 m wind speed', unit: 'km/h', min: 0, max: 100, step: 1, default: 20, help: 'Replaced by the current weather when "current weather" is chosen.' },
  { key: 'windFrom', label: 'Wind from', unit: '° (0 = north)', min: 0, max: 360, step: 5, default: 270 },
  { key: 'rh', label: 'Relative humidity', unit: '%', min: 2, max: 100, step: 1, default: 25 },
  { key: 'tempC', label: 'Air temperature', unit: '°C', min: -10, max: 50, step: 1, default: 30 },
  { key: 'liveMoisture', label: 'Live fuel moisture', unit: '%', min: 30, max: 300, step: 5, default: 90, help: 'Drought-stressed shrubs ≈ 60–80%; green growth ≥ 150%.' },
  { key: 'waf', label: 'Wind adjustment factor', unit: '', min: 0.1, max: 0.6, step: 0.05, default: 0.4, help: 'Midflame / 10 m wind: open grass or shrubs ≈ 0.4–0.5, under a forest canopy ≈ 0.1–0.2.' },
  { key: 'domainKm', label: 'Domain size', unit: 'km', min: 4, max: 60, step: 1, default: 20 },
];
export const WILDFIRE_CHOICES: ChoiceSpec[] = [
  { key: 'fuel', label: 'Fuel model (Anderson 1982)', default: '4', options: FUEL_MODELS.map((f) => ({ value: f.id, label: f.name })) },
  { key: 'weather', label: 'Weather', default: 'current', options: [{ value: 'current', label: 'Current weather at the ignition (Open-Meteo)' }, { value: 'manual', label: 'Use the values entered below' }] },
];

export function validateWildfire(raw: Record<string, unknown>): { ok: true; value: WildfireInput } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const v: Record<string, number> = {};
  for (const p of WILDFIRE_PARAMS) {
    const x = raw[p.key] === undefined || raw[p.key] === '' ? p.default : Number(raw[p.key]);
    if (!Number.isFinite(x) || x < p.min || x > p.max) issues.push({ field: p.key, message: `${p.label} must be between ${p.min} and ${p.max} ${p.unit}.` });
    else v[p.key] = x;
  }
  const fuel = raw.fuel === undefined ? '4' : String(raw.fuel);
  if (!FUEL_MODELS.some((f) => f.id === fuel)) issues.push({ field: 'fuel', message: 'Unknown fuel model.' });
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 80) issues.push({ field: 'lat', message: 'Latitude must be between -80 and 80.' });
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) issues.push({ field: 'lon', message: 'Longitude must be between -180 and 180.' });
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { lat, lon, label: typeof raw.label === 'string' ? raw.label : undefined, fuel, hours: v.hours, windKmh: v.windKmh, windFrom: v.windFrom, rh: v.rh, tempC: v.tempC, liveMoisture: v.liveMoisture, waf: v.waf, domainKm: v.domainKm } };
}

export function moistureFrom(inp: WildfireInput): Moisture {
  const d1 = Math.max(2, emc(inp.rh, inp.tempC)) / 100;
  return { d1, d10: d1 + 0.01, d100: d1 + 0.02, live: inp.liveMoisture / 100 };
}

/** Head-fire behaviour for a midflame wind (km/h) and slope: spread (m/min), L/B, intensity, flame length. */
export function headFire(fm: FuelModel, m: Moisture, midflameKmh: number, tanSlope = 0) {
  const r = rothermel(fm, m);
  const u = (midflameKmh * 1000) / 60 / 0.3048; // ft/min
  const phi = windFactor(r, u) + slopeFactor(r, tanSlope);
  const rosFt = r.r0 * (1 + phi);
  const lb = lengthToBreadth(effectiveWindMph(r, phi));
  const ib = (r.ir * rosFt * r.tr) / 60; // Byram intensity, BTU/ft/s
  const flameFt = ib > 0 ? 0.45 * ib ** 0.46 : 0;
  return { r, rosMMin: rosFt * FT_MIN_TO_M_MIN, lb, intensityKwM: ib * 3.4613, flameM: flameFt * 0.3048 };
}

/** The 16-neighbour stencil (as in FARSITE-style grid spread: a compromise between accuracy and speed). */
const STENCIL: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];

/** Binary min-heap on arrival time. */
class Heap {
  private k: number[] = [];
  private t: number[] = [];
  get size(): number { return this.k.length; }
  push(key: number, time: number): void {
    this.k.push(key); this.t.push(time);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.t[p] <= this.t[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
      [this.t[p], this.t[i]] = [this.t[i], this.t[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0], this.t[0]];
    const lk = this.k.pop()!, lt = this.t.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.t[0] = lt;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.t[l] < this.t[m]) m = l;
        if (r < this.k.length && this.t[r] < this.t[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
        [this.t[m], this.t[i]] = [this.t[i], this.t[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface FireRaw {
  arrival: Float32Array; // minutes; Infinity where unburned within the run
  frames: { t: number; depth: Float32Array }[]; // depth: 1 burned, 2 active front (last 30 min), 0 unburned
  headRos: Float32Array; // m/min per cell (direction of maximum spread)
  burnable: Uint8Array;
}

/** Minimum arrival time of the fire front over the DEM from an ignition at the grid centre. */
export function spreadFire(inp: WildfireInput, dem: Dem, onProgress?: (f: number) => void): FireRaw {
  const fm = FUEL_MODELS.find((f) => f.id === inp.fuel)!;
  const r = rothermel(fm, moistureFrom(inp));
  const { nx, ny, z } = dem;
  const n = nx * ny;
  const dx = dem.dx;
  const u = (inp.windKmh * inp.waf * 1000) / 60 / 0.3048; // midflame ft/min
  const phiW = windFactor(r, u);
  // the wind blows TOWARDS windFrom + 180°: unit vector (east, north)
  const to = ((inp.windFrom + 180) * Math.PI) / 180;
  const wx = Math.sin(to) * phiW, wy = Math.cos(to) * phiW;
  const burnable = new Uint8Array(n);
  const headRos = new Float32Array(n);
  const dirX = new Float32Array(n), dirY = new Float32Array(n), ecc = new Float32Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (z[k] <= 0 || r.r0 <= 0) continue;
    burnable[k] = 1;
    // upslope gradient (east, north); row 0 = north
    const zx = (z[j * nx + Math.min(nx - 1, i + 1)] - z[j * nx + Math.max(0, i - 1)]) / (2 * dx);
    const zy = (z[Math.max(0, j - 1) * nx + i] - z[Math.min(ny - 1, j + 1) * nx + i]) / (2 * dx);
    const tanS = Math.hypot(zx, zy);
    const phiS = slopeFactor(r, tanS);
    const sx = tanS > 0 ? (zx / tanS) * phiS : 0, sy = tanS > 0 ? (zy / tanS) * phiS : 0;
    const vx = wx + sx, vy = wy + sy;
    const phi = Math.hypot(vx, vy);
    headRos[k] = r.r0 * (1 + phi) * FT_MIN_TO_M_MIN;
    dirX[k] = phi > 0 ? vx / phi : 0;
    dirY[k] = phi > 0 ? vy / phi : 0;
    const lb = lengthToBreadth(effectiveWindMph(r, phi));
    ecc[k] = Math.sqrt(1 - 1 / (lb * lb));
  }
  const rosToward = (k: number, ex: number, ey: number): number => {
    const e = ecc[k];
    return (headRos[k] * (1 - e)) / (1 - e * (dirX[k] * ex + dirY[k] * ey));
  };
  const tEnd = inp.hours * 60;
  const arrival = new Float32Array(n).fill(Infinity);
  const c = Math.floor(ny / 2) * nx + Math.floor(nx / 2);
  const heap = new Heap();
  if (burnable[c]) { arrival[c] = 0; heap.push(c, 0); }
  let done = 0;
  while (heap.size) {
    const [k, t] = heap.pop();
    if (t > arrival[k] || t > tEnd) continue;
    if (++done % 2000 === 0) onProgress?.(Math.min(0.95, t / tEnd));
    const i = k % nx, j = (k - i) / nx;
    for (const [di, dj] of STENCIL) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const kk = jj * nx + ii;
      if (!burnable[kk]) continue;
      if (Math.abs(di) + Math.abs(dj) === 3) {
        // a knight's move must not jump a non-burnable cell (a river, a lake)
        const mi = i + (Math.abs(di) === 2 ? Math.sign(di) : 0), mj = j + (Math.abs(dj) === 2 ? Math.sign(dj) : 0);
        if (!burnable[mj * nx + mi]) continue;
      }
      const len = Math.hypot(di, dj);
      const ex = di / len, ey = -dj / len; // grid rows grow southward
      const ra = rosToward(k, ex, ey), rb = rosToward(kk, ex, ey);
      if (ra <= 0 || rb <= 0) continue;
      const tt = t + ((len * dx) / 2) * (1 / ra + 1 / rb);
      if (tt < arrival[kk] && tt <= tEnd) { arrival[kk] = tt; heap.push(kk, tt); }
    }
  }
  const frames: FireRaw['frames'] = [];
  for (let f = 0; f <= FRAMES; f++) {
    const t = (f / FRAMES) * tEnd;
    const d = new Float32Array(n);
    for (let k = 0; k < n; k++) if (arrival[k] <= t) d[k] = t - arrival[k] <= 30 ? 2 : 1;
    frames.push({ t: t * 60, depth: d });
  }
  onProgress?.(1);
  return { arrival, frames, headRos, burnable };
}

export function wildfireResult(inp: WildfireInput, dem: Dem, raw: FireRaw, weatherSource: string): SimResult {
  const fm = FUEL_MODELS.find((f) => f.id === inp.fuel)!;
  const m = moistureFrom(inp);
  const flat = headFire(fm, m, inp.windKmh * inp.waf);
  const cellA = dem.dx * dem.dx;
  const areaAt = (tMin: number) => { let c = 0; for (let k = 0; k < raw.arrival.length; k++) if (raw.arrival[k] <= tMin) c++; return (c * cellA) / 1e6; };
  const final = areaAt(inp.hours * 60);
  let maxRos = 0;
  for (let k = 0; k < raw.headRos.length; k++) if (raw.arrival[k] <= inp.hours * 60 && raw.headRos[k] > maxRos) maxRos = raw.headRos[k];
  let edge = false;
  for (let i = 0; i < dem.nx && !edge; i++) edge = Number.isFinite(raw.arrival[i]) || Number.isFinite(raw.arrival[(dem.ny - 1) * dem.nx + i]);
  for (let j = 0; j < dem.ny && !edge; j++) edge = Number.isFinite(raw.arrival[j * dem.nx]) || Number.isFinite(raw.arrival[j * dem.nx + dem.nx - 1]);
  const [[W, N], [E], , [, S]] = dem.corners;
  const places = GAZETTEER.filter((p) => !p.water).map((p) => {
    const i = Math.floor(((p.lon - W) / (E - W)) * dem.nx);
    const j = Math.floor(((N - p.lat) / (N - S)) * dem.ny);
    if (i < 0 || j < 0 || i >= dem.nx || j >= dem.ny) return null;
    const t = raw.arrival[j * dem.nx + i];
    return Number.isFinite(t) ? { name: p.name, h: t / 60 } : null;
  }).filter((x): x is { name: string; h: number } => !!x);
  // Andrews (2018) fire-suppression interpretation of flame length (4, 8, 11 ft)
  const suppress = flat.flameM < 1.2 ? 'hand crews can attack the head directly' : flat.flameM < 2.4 ? 'too intense for hand crews at the head; engines and dozers may hold it' : flat.flameM < 3.4 ? 'serious control problems: torching, crowning and spotting likely' : 'extreme: crowning and spotting likely; direct attack on the head is ineffective';
  const steps: CalcStep[] = [
    { id: 'moisture', label: '1-hour dead fuel moisture (Simard 1968 equilibrium moisture)', equation: 'EMC(RH, T): three-range regression', substituted: `RH ${inp.rh}%, T ${inp.tempC} °C`, value: m.d1 * 100, unit: '%', ref: 'simard1968' },
    { id: 'ir', label: 'Reaction intensity', equation: "I_R = Γ' Σ wₙ h η_M η_s", value: flat.r.ir * 0.1891, unit: 'kW/m²', ref: 'rothermel1972' },
    { id: 'r0', label: 'Spread with no wind and no slope', equation: 'R₀ = I_R ξ / (ρ_b ε Q_ig)', value: flat.r.r0 * FT_MIN_TO_M_MIN, unit: 'm/min', ref: 'rothermel1972' },
    { id: 'wind', label: 'Midflame wind', equation: 'U = WAF · U₁₀;  φ_w = C U^B (β/β_op)^−E', substituted: `U = ${inp.waf} · ${inp.windKmh} km/h`, value: inp.windKmh * inp.waf, unit: 'km/h', ref: 'rothermel1972' },
    { id: 'slope', label: 'Slope factor (per DEM cell, added to wind as a vector)', equation: 'φ_s = 5.275 β^−0.3 tan²θ', value: dem.dx, unit: 'm DEM cell', ref: 'rothermel1972' },
    { id: 'ros', label: 'Head-fire spread rate (flat ground)', equation: 'R = R₀ (1 + φ_w + φ_s)', value: flat.rosMMin, unit: 'm/min', ref: 'rothermel1972' },
    { id: 'lb', label: 'Fire shape (length-to-breadth)', equation: 'L/B = 0.936 e^(0.2566 U) + 0.461 e^(−0.1548 U) − 0.397', value: flat.lb, unit: '', ref: 'anderson1983' },
    { id: 'intensity', label: 'Fireline intensity (Byram)', equation: 'I_B = I_R · R · t_r,  t_r = 384 / σ', value: flat.intensityKwM, unit: 'kW/m', ref: 'andrews2018' },
    { id: 'flame', label: 'Flame length (Byram 1959)', equation: 'L_f = 0.45 I_B^0.46  (ft, BTU/ft/s)', value: flat.flameM, unit: 'm', ref: 'andrews2018' },
    { id: 'spread', label: 'Spread over the terrain', equation: 'minimum arrival time; R(θ) = R_head (1 − e)/(1 − e cos θ), e = √(1 − (B/L)²)', value: final, unit: 'km² burned', ref: 'finney1998' },
  ];
  const outputs: SimOutput[] = [
    { id: 'burned', label: `Area burned after ${inp.hours} h`, value: final, unit: 'km²', range: [final / 2, final * 2] },
    { id: 'ros', label: 'Head-fire spread rate (flat ground)', value: flat.rosMMin, unit: 'm/min', alt: `≈ ${fmt((flat.rosMMin * 60) / 1000)} km/h`, range: [flat.rosMMin / 2, flat.rosMMin * 2] },
    { id: 'rosmax', label: 'Fastest spread anywhere (wind + slope)', value: maxRos, unit: 'm/min' },
    { id: 'flame', label: 'Head flame length', value: flat.flameM, unit: 'm', alt: suppress },
    { id: 'intensity', label: 'Head fireline intensity', value: flat.intensityKwM, unit: 'kW/m' },
    { id: 'lb', label: 'Fire shape length-to-breadth', value: flat.lb, unit: '' },
    { id: 'moisture', label: '1-hour dead fuel moisture', value: m.d1 * 100, unit: '%' },
  ];
  for (const p of places.sort((a, b) => a.h - b.h)) outputs.push({ id: `place-${p.name}`, label: `${p.name}: fire front arrives`, value: p.h, unit: 'h' });
  const series: SimSeries[] = [{ id: 'area', label: 'Burned area over time', xLabel: 'Time (h)', yLabel: 'Area (km²)', points: raw.frames.map((f) => [f.t / 3600, areaAt(f.t / 60)]) }];
  const tEnd = inp.hours * 3600;
  return {
    engine: 'wildfire', engineVersion: WILDFIRE_VERSION, evidence: 'simulation',
    title: `Wildfire: ${fm.name}, wind ${inp.windKmh} km/h from ${inp.windFrom}°, RH ${inp.rh}%`,
    location: { lat: inp.lat, lon: inp.lon, label: inp.label },
    inputs: { fuel_model: fm.name, hours: inp.hours, wind_10m_kmh: inp.windKmh, wind_from_deg: inp.windFrom, rh_pct: inp.rh, temp_c: inp.tempC, live_moisture_pct: inp.liveMoisture, waf: inp.waf, domain_km: inp.domainKm, weather: weatherSource, terrain: dem.source, lat: inp.lat, lon: inp.lon },
    steps, outputs, zones: [], series,
    phases: [{ id: 'ignition', label: 'Ignition', t: 0 }, { id: 'h1', label: '+1 hour', t: Math.min(3600, tEnd) }, { id: 'end', label: 'End of run', t: tEnd }],
    timeSpan: [0, tEnd],
    summary: `A hypothetical fire in ${fm.name.replace(/^FM\d+ /, '').toLowerCase()} with ${inp.windKmh} km/h wind from ${inp.windFrom}° and ${fmt(m.d1 * 100)}% dead-fuel moisture spreads at about ${fmt(flat.rosMMin)} m/min on flat ground and burns about ${fmt(final)} km² in ${inp.hours} h without firefighting. Flames at the head are about ${fmt(flat.flameM)} m long: ${suppress}.${edge ? ' The fire reaches the edge of the simulated area, so the burned area is a lower bound: enlarge the domain.' : ''}`,
    assumptions: [
      `One fuel model wherever there is land (${fm.name}); water (elevation ≤ 0 m) does not burn. No fuel map is used.`,
      `Constant weather for the whole run (${weatherSource}); dead fuel moisture from equilibrium moisture, with 10 h and 100 h fuels 1 and 2 points wetter.`,
      'Surface fire only, steady state at every point; wind and slope combined as vectors (Rothermel).',
    ],
    limitations: [
      'No crown fire, spotting (embers jumping ahead), fire–atmosphere coupling or firefighting. Under extreme conditions real fires can spread several times faster than this model.',
      `Terrain cells are ${fmt(dem.dx)} m: roads, rivers and firebreaks narrower than a cell are not seen. Fuel is uniform, so the shape mostly reflects wind and slope.`,
      'Hypothetical simulation, not a fire-behaviour forecast. Follow official fire services and evacuation orders.',
    ],
    references: [
      { id: 'rothermel1972', label: 'Rothermel (1972), A mathematical model for predicting fire spread in wildland fuels, USDA Forest Service INT-115', url: 'https://www.fs.usda.gov/research/treesearch/32533' },
      { id: 'andrews2018', label: 'Andrews (2018), The Rothermel surface fire spread model and associated developments, USDA Forest Service RMRS-GTR-371', url: 'https://www.fs.usda.gov/research/treesearch/55928' },
      { id: 'anderson1983', label: 'Anderson (1983), Predicting wind-driven wild land fire size and shape, USDA Forest Service INT-305', url: 'https://www.fs.usda.gov/research/treesearch/32510' },
      { id: 'finney1998', label: 'Finney (1998), FARSITE: Fire Area Simulator, USDA Forest Service RMRS-RP-4', url: 'https://www.fs.usda.gov/research/treesearch/4617' },
      { id: 'simard1968', label: 'Simard (1968), The moisture content of forest fuels, Canadian Forestry Service report FF-X-14', url: 'https://cfs.nrcan.gc.ca/publications?id=24785' },
    ],
    raster: { kind: 'fire', corners: dem.corners, nx: dem.nx, ny: dem.ny, frames: raw.frames, maxDepth: raw.frames[raw.frames.length - 1].depth },
    computedAt: new Date().toISOString(),
  };
}
