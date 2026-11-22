// Cinematic effects drawn over the globe, driven by the simulation time of the active run (so they play, pause and
// scrub with the time bar):
//   • impact: the meteor flies in from space along its real altitude track, glows as the air heats it, and ends in a
//     flash at the impact point (or at its burst altitude for an airburst);
//   • earthquake / tsunami source: lightning-like cracks spread over the surface from the epicentre while the rupture
//     runs (≈3 km/s along its real length), then fade.
// The picture is cinematic: the direction the meteor comes from is arbitrary, and crack paths are decorative (their
// length and, for a tsunami, their orientation come from the model; for an earthquake the orientation is arbitrary).
import { destination } from '../sim/geo';
import type { SimResult } from '../sim/types';

export type CinemaState =
  | { kind: 'meteor'; t: number; lat: number; lon: number; altitude: [number, number][]; entryT: number }
  | { kind: 'quake'; t: number; lat: number; lon: number; lengthKm: number; strikeDeg: number | null; seed: number };

export interface Pt { x: number; y: number }

const RUPTURE_KM_S = 3; // rupture speed, km/s
export const CINEMA_ENTRY_KM_S = 20; // speed assumed for the lead-in before the 100 km entry point
/** The meteor arrives from the upper left on screen (any direction would do). */
export const METEOR_DIR: Pt = (() => { const l = Math.hypot(0.62, 0.78); return { x: -0.62 / l, y: -0.78 / l }; })();

export const hashSeed = (lat: number, lon: number): number => {
  let h = Math.imul(Math.round(lat * 1000) | 0, 0x9e3779b1) ^ Math.imul(Math.round(lon * 1000) | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
};

/** Small deterministic random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cinemaFor(r: SimResult, t: number): CinemaState | null {
  const { lat, lon } = r.location;
  if (r.engine === 'impact') {
    const alt = r.series.find((s) => s.id === 'altitude')?.points;
    return alt && alt.length > 1 ? { kind: 'meteor', t, lat, lon, altitude: alt, entryT: alt[0][0] } : null;
  }
  if (r.engine === 'earthquake' || r.engine === 'tsunami') {
    const len = r.outputs.find((o) => o.id === (r.engine === 'tsunami' ? 'length' : 'rupture'))?.value ?? 30;
    const strike = r.engine === 'tsunami' ? Number(r.inputs.strike_deg) : NaN;
    return { kind: 'quake', t, lat, lon, lengthKm: len, strikeDeg: Number.isFinite(strike) ? strike : null, seed: hashSeed(lat, lon) };
  }
  return null;
}

// ---- meteor ----------------------------------------------------------------------------------------------------

/** Altitude (km) of the meteor at time t: the model's track, with a straight lead-in from space before entry. */
export function altitudeAt(points: [number, number][], t: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (t <= first[0]) return first[1] + (first[0] - t) * CINEMA_ENTRY_KM_S;
  if (t >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i][0]) {
      const f = (t - points[i - 1][0]) / (points[i][0] - points[i - 1][0] || 1);
      return points[i - 1][1] + f * (points[i][1] - points[i - 1][1]);
    }
  }
  return last[1];
}

export interface MeteorPose {
  /** The meteor is on screen and still falling. */
  flying: boolean;
  x: number;
  y: number;
  alt: number;
  /** 0 in space … 1 when the air has heated it fully. */
  heat: number;
  /** Where the flash happens (the ground point, or the burst point of an airburst). */
  burst: Pt;
  /** Flash strength after impact: 1 at the instant, then fading. */
  flash: number;
  /** Seconds since impact (0 before). */
  since: number;
}

const smooth = (e0: number, e1: number, x: number): number => { const f = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return f * f * (3 - 2 * f); };

/** Screen position of the meteor: along METEOR_DIR from the ground point, 100 km of altitude = `reach` pixels. */
export function meteorPose(s: Extract<CinemaState, { kind: 'meteor' }>, gz: Pt, reach: number): MeteorPose {
  const alt = altitudeAt(s.altitude, s.t);
  const endAlt = s.altitude[s.altitude.length - 1][1];
  const at = (a: number): Pt => ({ x: gz.x + METEOR_DIR.x * (a / 100) * reach, y: gz.y + METEOR_DIR.y * (a / 100) * reach });
  const p = at(alt);
  return {
    flying: s.t < 0,
    x: p.x, y: p.y, alt,
    heat: smooth(95, 40, alt),
    burst: at(endAlt),
    flash: s.t >= 0 ? Math.exp(-s.t / 1.8) : 0,
    since: Math.max(0, s.t),
  };
}

// ---- lightning-like cracks -------------------------------------------------------------------------------------

/** A jagged path from a to b by midpoint displacement. Deterministic for a given generator. */
export function jagged(a: Pt, b: Pt, rough: number, depth: number, rand: () => number): Pt[] {
  if (depth === 0) return [a, b];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = -(b.y - a.y) / (len || 1), ny = (b.x - a.x) / (len || 1);
  const off = (rand() - 0.5) * len * rough;
  const m = { x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off };
  return [...jagged(a, m, rough, depth - 1, rand).slice(0, -1), ...jagged(m, b, rough, depth - 1, rand)];
}

export interface Crack { pts: Pt[]; /** seconds after the rupture starts when this crack starts to grow */ start: number; /** 0 main, 1 branch, 2 twig */ order: number }

const pathLength = (p: Pt[]): number => p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0);

/** The part of a path up to a fraction of its length. */
export function truncate(p: Pt[], frac: number): Pt[] {
  if (frac >= 1) return p;
  if (frac <= 0) return [p[0]];
  const target = pathLength(p) * frac;
  const out: Pt[] = [p[0]];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const seg = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    if (acc + seg >= target) { const f = (target - acc) / (seg || 1); out.push({ x: p[i - 1].x + f * (p[i].x - p[i - 1].x), y: p[i - 1].y + f * (p[i].y - p[i - 1].y) }); return out; }
    out.push(p[i]);
    acc += seg;
  }
  return out;
}

/** Cracks around the epicentre (origin), relative to it: a main fault line with branches and twigs, both ways. */
export function buildCracks(seed: number, lengthPx: number, angle: number, durationS: number): Crack[] {
  const rand = rng(seed);
  const cracks: Crack[] = [];
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  for (const side of [1, -1]) {
    const tip = { x: dir.x * side * (lengthPx / 2), y: dir.y * side * (lengthPx / 2) };
    const main = jagged({ x: 0, y: 0 }, tip, 0.28, 6, rand);
    cracks.push({ pts: main, start: 0, order: 0 });
    const total = pathLength(main);
    const branches = 7;
    for (let k = 0; k < branches; k++) {
      const frac = (k + 0.6 + rand() * 0.6) / (branches + 1);
      const idx = Math.max(1, Math.min(main.length - 2, Math.round(frac * (main.length - 1))));
      const o = main[idx];
      const turn = (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.8);
      const a = Math.atan2(tip.y, tip.x) + turn;
      const len = total * (0.12 + rand() * 0.2);
      const end = { x: o.x + Math.cos(a) * len, y: o.y + Math.sin(a) * len };
      const branch = jagged(o, end, 0.3, 4, rand);
      const start = frac * durationS;
      cracks.push({ pts: branch, start, order: 1 });
      if (rand() < 0.7) {
        const j = Math.max(1, Math.min(branch.length - 2, Math.round((0.4 + rand() * 0.4) * (branch.length - 1))));
        const o2 = branch[j];
        const a2 = a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.6);
        const l2 = len * (0.35 + rand() * 0.25);
        cracks.push({ pts: jagged(o2, { x: o2.x + Math.cos(a2) * l2, y: o2.y + Math.sin(a2) * l2 }, 0.3, 3, rand), start: start + 0.15 * durationS, order: 2 });
      }
    }
  }
  return cracks;
}

export const ruptureSeconds = (lengthKm: number): number => Math.min(40, Math.max(4, lengthKm / RUPTURE_KM_S));

/** How far each crack has grown at time t (0..1). */
export function crackProgress(c: Crack, t: number, durationS: number): number {
  const grow = c.order === 0 ? durationS : Math.max(0.8, durationS * 0.25);
  return Math.min(1, Math.max(0, (t - c.start) / grow));
}
/** Brightness: on during the rupture, flickering like lightning, then fading. */
export function crackAlpha(t: number, durationS: number, seed: number): number {
  if (t < 0) return 0;
  const fade = t <= durationS ? 1 : Math.exp(-(t - durationS) / 5);
  const flicker = 0.7 + 0.3 * Math.sin(t * 37 + (seed % 97)) * Math.sin(t * 11.3 + 1.7);
  return Math.max(0, Math.min(1, fade * flicker));
}

// ---- the canvas ------------------------------------------------------------------------------------------------

export class CinemaOverlay {
  private state: CinemaState | null = null;
  private cache: { key: string; cracks: Crack[] } | null = null;

  constructor(private canvas: HTMLCanvasElement, private project: (lon: number, lat: number) => Pt) {}

  set(state: CinemaState | null): void {
    this.state = state;
    this.draw();
  }

  draw(): void {
    const c = this.canvas;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = this.state;
    if (!s || w < 10 || h < 10) return;
    const gz = this.project(s.lon, s.lat);
    if (s.kind === 'meteor') this.meteor(ctx, s, gz, Math.min(w, h));
    else this.quake(ctx, s, gz, w, h);
  }

  private pxPerKm(lat: number, lon: number): number {
    const a = this.project(lon, lat);
    const [lo2, la2] = destination(lat, lon, 10, 90);
    const b = this.project(lo2, la2);
    return Math.hypot(b.x - a.x, b.y - a.y) / 10;
  }

  private meteor(ctx: CanvasRenderingContext2D, s: Extract<CinemaState, { kind: 'meteor' }>, gz: Pt, size: number): void {
    const reach = size * 0.42;
    const m = meteorPose(s, gz, reach);
    ctx.globalCompositeOperation = 'lighter';
    if (m.flying) {
      // the impact point is marked as the rock closes in
      if (m.alt < 160) {
        const k = 1 - m.alt / 160;
        ctx.strokeStyle = `rgba(255,255,255,${0.15 + 0.35 * k})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(gz.x, gz.y, 10 + 8 * (1 - k), 0, Math.PI * 2);
        ctx.stroke();
      }
      const tail = 70 + 150 * m.heat + (m.alt > 100 ? 30 : 0);
      const tx = m.x - METEOR_DIR.x * tail, ty = m.y - METEOR_DIR.y * tail; // the tail points back up the track
      const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(255,${Math.round(200 - 60 * m.heat)},${Math.round(150 - 90 * m.heat)},0.95)`);
      g.addColorStop(0.35, `rgba(255,${Math.round(120 + 40 * (1 - m.heat))},60,${0.35 + 0.35 * m.heat})`);
      g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.strokeStyle = g;
      ctx.lineCap = 'round';
      ctx.lineWidth = 2 + 7 * m.heat;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - METEOR_DIR.x * tail * 0.45, m.y - METEOR_DIR.y * tail * 0.45); ctx.stroke();
      const r = 12 + 34 * m.heat;
      const glow = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, r);
      glow.addColorStop(0, 'rgba(255,240,210,0.95)');
      glow.addColorStop(0.35, `rgba(255,150,60,${0.35 + 0.35 * m.heat})`);
      glow.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(m.x, m.y, 2.5 + 2.5 * m.heat, 0, Math.PI * 2); ctx.fill();
    } else if (m.flash > 0.01) {
      const R = 70 + 190 * (1 - Math.exp(-m.since / 0.7));
      const g = ctx.createRadialGradient(m.burst.x, m.burst.y, 0, m.burst.x, m.burst.y, R);
      g.addColorStop(0, `rgba(255,250,235,${m.flash})`);
      g.addColorStop(0.25, `rgba(255,170,80,${0.8 * m.flash})`);
      g.addColorStop(0.6, `rgba(255,90,20,${0.35 * m.flash})`);
      g.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m.burst.x, m.burst.y, R, 0, Math.PI * 2); ctx.fill();
      // the blue-white shock dome
      const dome = Math.min(1, m.since / 4);
      ctx.strokeStyle = `rgba(190,220,255,${0.8 * (1 - dome)})`;
      ctx.lineWidth = 3 * (1 - dome) + 0.5;
      ctx.beginPath(); ctx.arc(m.burst.x, m.burst.y, 20 + 200 * dome, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private quake(ctx: CanvasRenderingContext2D, s: Extract<CinemaState, { kind: 'quake' }>, o: Pt, w: number, h: number): void {
    if (s.t < 0) return;
    const dur = ruptureSeconds(s.lengthKm);
    const alpha = crackAlpha(s.t, dur, s.seed);
    if (alpha <= 0.01) return;
    const lengthPx = Math.min(0.9 * Math.min(w, h), Math.max(190, s.lengthKm * this.pxPerKm(s.lat, s.lon)));
    // strike is measured clockwise from north; on screen north is up
    const angle = s.strikeDeg !== null ? ((s.strikeDeg - 90) * Math.PI) / 180 : rng(s.seed ^ 0x51ed)() * Math.PI;
    const key = `${s.seed}|${Math.round(lengthPx)}|${Math.round(angle * 100)}`;
    // the cracks spread out in at most 5 s so the picture reads; they then flicker until the rupture ends and fade
    const grow = Math.min(dur, 5);
    if (this.cache?.key !== key) this.cache = { key, cracks: buildCracks(s.seed, lengthPx, angle, grow) };
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const flash = Math.exp(-s.t / 0.5);
    if (flash > 0.02) {
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 90);
      g.addColorStop(0, `rgba(235,245,255,${0.9 * flash})`);
      g.addColorStop(1, 'rgba(120,170,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(o.x, o.y, 90, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of this.cache.cracks) {
      const p = crackProgress(c, s.t, grow);
      if (p <= 0) continue;
      const pts = truncate(c.pts, p);
      if (pts.length < 2) continue;
      const wScale = c.order === 0 ? 1 : c.order === 1 ? 0.6 : 0.38;
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(o.x + q.x, o.y + q.y) : ctx.moveTo(o.x + q.x, o.y + q.y)));
      ctx.strokeStyle = `rgba(110,160,255,${0.16 * alpha})`; ctx.lineWidth = 11 * wScale; ctx.stroke();
      ctx.strokeStyle = `rgba(190,215,255,${0.7 * alpha})`; ctx.lineWidth = 3.4 * wScale; ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = 1.5 * wScale; ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
