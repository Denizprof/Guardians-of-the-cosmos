// Volcano engine: tephra (ash) fall and pyroclastic-flow reach for an explosive eruption.
//
// Eruption source: plume height ↔ eruption rate by Mastin et al. (2009), H = 2.00 V^0.241 (H km above vent, V DRE m³/s).
// Ash fall: the Tephra2 approach (Bonadonna et al. 2005): mass released along the column with a Suzuki profile,
// split into grain-size classes; each class falls at its terminal velocity (Bonadonna et al. 1998 regimes) through
// layers whose wind carries it; on the ground it spreads as a Gaussian of variance σ² = 2K·t_fall + σ₀².
// Pyroclastic flows: the energy-cone model (Malin & Sheridan 1982): a flow reaches where the cone
// z = z_vent + H_c − r·(H/L) stays above the terrain, starting from a column-collapse height H_c.
import type { Dem } from './flood';
import { GAZETTEER } from './parse';
import { haversineKm } from './geo';
import { fmt } from './validate';
import type { CalcStep, ParamSpec, SimOutput, SimResult, SimSeries, SimZone, ValidationIssue } from './types';

export const VOLCANO_VERSION = '1.0.0';
const G = 9.81;
const MU_AIR = 1.8e-5; // Pa·s
const RHO_DRE = 2500; // kg/m³ dense-rock magma
const RHO_DEPOSIT = 1000; // kg/m³ bulk ash deposit
const LEVELS = 20;
const PHI = [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8]; // grain sizes, d = 2^−φ mm
const FRAMES = 24;
export const GRID = 160;

export interface WindLayer { z: number; u: number; v: number } // m above sea level; m/s towards east and north

export interface VolcanoInput {
  lat: number;
  lon: number;
  label?: string;
  columnKm: number; // plume height above the vent
  durationH: number;
  ventKm: number; // vent elevation, km above sea level (from the DEM when known)
  medianPhi: number;
  sigmaPhi: number;
  diffusion: number; // K, m²/s
  collapseKm: number; // energy-cone collapse height above the vent
  heimRatio: number; // H/L
  domainKm: number;
}

export const VOLCANO_PARAMS: ParamSpec[] = [
  { key: 'columnKm', label: 'Eruption column height', unit: 'km above vent', min: 2, max: 45, step: 0.5, default: 20, help: 'Mount St. Helens 1980 ≈ 24 km; Pinatubo 1991 ≈ 35 km; Eyjafjallajökull 2010 ≈ 6–9 km.' },
  { key: 'durationH', label: 'Eruption duration', unit: 'h', min: 0.5, max: 48, step: 0.5, default: 6 },
  { key: 'medianPhi', label: 'Median grain size', unit: 'φ (d = 2^−φ mm)', min: -3, max: 5, step: 0.5, default: 1, help: 'φ = 1 is 0.5 mm (coarse ash); larger φ = finer ash that travels further.' },
  { key: 'sigmaPhi', label: 'Grain-size spread', unit: 'φ', min: 0.5, max: 4, step: 0.1, default: 1.5 },
  { key: 'diffusion', label: 'Atmospheric diffusion K', unit: 'm²/s', min: 100, max: 20000, step: 100, default: 4000, help: 'Tephra2 studies fit about 1,000–10,000 m²/s.' },
  { key: 'collapseKm', label: 'Column-collapse height (pyroclastic flows)', unit: 'km', min: 0, max: 3, step: 0.1, default: 1 },
  { key: 'heimRatio', label: 'Pyroclastic-flow mobility H/L', unit: '', min: 0.05, max: 0.5, step: 0.01, default: 0.2, help: 'Lower = more mobile flows. Observed ≈ 0.1–0.3.' },
  { key: 'domainKm', label: 'Ash-fall domain size', unit: 'km', min: 50, max: 1500, step: 50, default: 500 },
];

export function validateVolcano(raw: Record<string, unknown>): { ok: true; value: VolcanoInput } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const v: Record<string, number> = {};
  for (const p of VOLCANO_PARAMS) {
    const x = raw[p.key] === undefined || raw[p.key] === '' ? p.default : Number(raw[p.key]);
    if (!Number.isFinite(x) || x < p.min || x > p.max) issues.push({ field: p.key, message: `${p.label} must be between ${p.min} and ${p.max} ${p.unit}.` });
    else v[p.key] = x;
  }
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 80) issues.push({ field: 'lat', message: 'Latitude must be between -80 and 80.' });
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) issues.push({ field: 'lon', message: 'Longitude must be between -180 and 180.' });
  if (issues.length) return { ok: false, issues };
  const vent = Number(raw.ventKm);
  return { ok: true, value: { lat, lon, label: typeof raw.label === 'string' ? raw.label : undefined, columnKm: v.columnKm, durationH: v.durationH, ventKm: Number.isFinite(vent) ? vent : 0, medianPhi: v.medianPhi, sigmaPhi: v.sigmaPhi, diffusion: v.diffusion, collapseKm: v.collapseKm, heimRatio: v.heimRatio, domainKm: v.domainKm } };
}

/** Mastin et al. (2009): DRE volume rate (m³/s) for a plume height H km above the vent, and its inverse. */
export const mastinRate = (hKm: number): number => (hKm / 2.0) ** (1 / 0.241);
export const mastinHeight = (vDre: number): number => 2.0 * vDre ** 0.241;

/** Volcanic Explosivity Index from bulk tephra volume (Newhall & Self 1982): VEI 2 ≥ 10⁶ m³, +1 per decade, up to 8. */
export function vei(bulkM3: number): number {
  if (bulkM3 < 1e4) return 0;
  if (bulkM3 < 1e6) return 1;
  return Math.min(8, Math.floor(Math.log10(bulkM3)) - 4);
}

const airDensity = (z: number): number => 1.225 * Math.exp(-z / 8200);
/** Particle density: pumice-like for coarse grains, lithic/crystal-like for fine (Tephra2 convention). */
export const particleDensity = (phi: number): number => (phi <= -1 ? 1000 : phi >= 4 ? 2600 : 1000 + ((phi + 1) / 5) * 1600);

/** Terminal fall velocity (m/s), Bonadonna et al. (1998) regimes by Reynolds number. */
export function settlingVelocity(dM: number, rhoP: number, z: number): number {
  const ra = airDensity(z);
  const stokes = (G * rhoP * dM * dM) / (18 * MU_AIR);
  if ((ra * stokes * dM) / MU_AIR < 6) return stokes;
  const inter = dM * Math.cbrt((4 * G * G * rhoP * rhoP) / (225 * MU_AIR * ra));
  if ((ra * inter * dM) / MU_AIR < 500) return inter;
  return Math.sqrt((3.1 * rhoP * G * dM) / ra);
}

/** Wind at height z: linear between layers, constant beyond them. */
export function windAt(wind: WindLayer[], z: number): { u: number; v: number } {
  if (!wind.length) return { u: 0, v: 0 };
  if (z <= wind[0].z) return wind[0];
  for (let i = 1; i < wind.length; i++) {
    if (z <= wind[i].z) {
      const f = (z - wind[i - 1].z) / (wind[i].z - wind[i - 1].z);
      return { u: wind[i - 1].u + f * (wind[i].u - wind[i - 1].u), v: wind[i - 1].v + f * (wind[i].v - wind[i - 1].v) };
    }
  }
  return wind[wind.length - 1];
}

/** Fall of one particle class from height z0 (m a.s.l.) to the ground at zg: time and wind drift (m east/north). */
export function fall(dM: number, rhoP: number, z0: number, zg: number, wind: WindLayer[]): { t: number; dx: number; dy: number } {
  let t = 0, dx = 0, dy = 0;
  const STEP = 250;
  for (let z = z0; z > zg; z -= STEP) {
    const h = Math.min(STEP, z - zg);
    const zm = z - h / 2;
    const dt = h / settlingVelocity(dM, rhoP, zm);
    const w = windAt(wind, zm);
    t += dt; dx += w.u * dt; dy += w.v * dt;
  }
  return { t, dx, dy };
}

export interface AshSource { mass: number; t: number; x: number; y: number; s2: number }

/** Mass, landing time and Gaussian landing patch for each (release height, grain class). */
export function ashSources(inp: VolcanoInput, wind: WindLayer[]): { sources: AshSource[]; totalMass: number; mer: number } {
  const mer = mastinRate(inp.columnKm) * RHO_DRE; // kg/s
  const totalMass = mer * inp.durationH * 3600;
  const zVent = inp.ventKm * 1000;
  const H = inp.columnKm * 1000;
  // Suzuki (1983) release profile, A = 4, λ = 1: f ∝ (1 − z/H) e^(A(z/H − 1))
  const A = 4;
  const zs = Array.from({ length: LEVELS }, (_, i) => ((i + 0.5) / LEVELS) * H);
  const fz = zs.map((z) => Math.max(0, (1 - z / H) * Math.exp(A * (z / H - 1))));
  const sz = fz.reduce((a, b) => a + b, 0);
  const gp = PHI.map((p) => Math.exp(-((p - inp.medianPhi) ** 2) / (2 * inp.sigmaPhi ** 2)));
  const sg = gp.reduce((a, b) => a + b, 0);
  const s0 = 0.2 * H; // source (umbrella) width scale
  const sources: AshSource[] = [];
  for (let i = 0; i < LEVELS; i++) {
    for (let k = 0; k < PHI.length; k++) {
      const m = totalMass * (fz[i] / sz) * (gp[k] / sg);
      if (m <= 0) continue;
      const f = fall(2 ** -PHI[k] / 1000, particleDensity(PHI[k]), zVent + zs[i], zVent, wind);
      sources.push({ mass: m, t: f.t, x: f.dx, y: f.dy, s2: 2 * inp.diffusion * f.t + ((s0 * zs[i]) / H) ** 2 });
    }
  }
  return { sources, totalMass, mer };
}

/** Error function (Abramowitz & Stegun 7.1.26, |error| < 1.5×10⁻⁷). */
export function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

export interface AshGrid { nx: number; ny: number; cell: number; frames: { t: number; depth: Float32Array }[]; load: Float32Array; tEnd: number }

/** Deposit on a local grid centred on the vent, as thickness frames (m) over time: mass lands as it arrives. */
export function ashGrid(inp: VolcanoInput, sources: AshSource[], onProgress?: (f: number) => void): AshGrid {
  const n = GRID;
  const cell = (inp.domainKm * 1000) / n;
  const dur = inp.durationH * 3600;
  let maxFall = 0;
  for (const s of sources) if (s.t > maxFall) maxFall = s.t;
  // fine ash can take days to settle: end the timeline when 99% of the mass has landed
  const byT = [...sources].sort((a, b) => a.t - b.t);
  let acc = 0, t99 = maxFall;
  const total = sources.reduce((a, s) => a + s.mass, 0);
  for (const s of byT) { acc += s.mass; if (acc >= 0.99 * total) { t99 = s.t; break; } }
  const tEnd = dur + t99;
  const frames = Array.from({ length: FRAMES + 1 }, (_, i) => ({ t: (i / FRAMES) * tEnd, depth: new Float32Array(n * n) }));
  const field = new Float32Array(n * n);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  sources.forEach((s, si) => {
    // the Gaussian is integrated exactly over each cell (separable in x and y), so no mass is lost to sampling
    const sq = Math.sqrt(2 * s.s2);
    for (let i = 0; i < n; i++) {
      const x0 = (i - n / 2) * cell - s.x;
      px[i] = 0.5 * (erf((x0 + cell) / sq) - erf(x0 / sq));
    }
    for (let j = 0; j < n; j++) {
      const y1 = (n / 2 - j) * cell - s.y; // row 0 = north: its top edge is the domain's north edge
      py[j] = 0.5 * (erf(y1 / sq) - erf((y1 - cell) / sq));
    }
    const perArea = s.mass / (cell * cell);
    for (let j = 0; j < n; j++) {
      const f = perArea * py[j];
      for (let i = 0; i < n; i++) field[j * n + i] = f * px[i];
    }
    // released uniformly over the eruption, landing t_fall later
    for (const fr of frames) {
      const w = Math.min(1, Math.max(0, (fr.t - s.t) / dur));
      if (w <= 0) continue;
      const d = fr.depth;
      for (let k = 0; k < d.length; k++) d[k] += field[k] * w;
    }
    if (si % 20 === 0) onProgress?.(si / sources.length);
  });
  const load = Float32Array.from(frames[frames.length - 1].depth);
  for (const fr of frames) for (let k = 0; k < fr.depth.length; k++) fr.depth[k] /= RHO_DEPOSIT;
  return { nx: n, ny: n, cell, frames, load, tEnd };
}

/** Energy cone on the DEM: cells a pyroclastic flow can reach, its runout and area. */
export function energyCone(inp: VolcanoInput, dem: Dem): { reach: Uint8Array; runoutKm: number; areaKm2: number; ventM: number } {
  const { nx, ny, z } = dem;
  const ci = Math.floor(nx / 2), cj = Math.floor(ny / 2);
  // vent = highest point within 1.5 km of the chosen location (the summit)
  let vent = -Infinity;
  const r0 = Math.max(1, Math.round(1500 / dem.dx));
  for (let j = cj - r0; j <= cj + r0; j++) for (let i = ci - r0; i <= ci + r0; i++) if (i >= 0 && j >= 0 && i < nx && j < ny) vent = Math.max(vent, z[j * nx + i]);
  const top = vent + inp.collapseKm * 1000;
  const reach = new Uint8Array(nx * ny);
  let runout = 0, area = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const r = Math.hypot(i - ci, j - cj) * dem.dx;
    const cone = top - r * inp.heimRatio;
    if (cone > z[j * nx + i] && cone > 0) {
      reach[j * nx + i] = 1;
      area += dem.dx * dem.dx;
      if (r > runout) runout = r;
    }
  }
  return { reach, runoutKm: runout / 1000, areaKm2: area / 1e6, ventM: vent };
}

const KM_PER_DEG = 111.195;

/** Corners [lon, lat] of the local ash grid (equirectangular around the vent). */
export function ashCorners(inp: VolcanoInput): [number, number][] {
  const h = inp.domainKm / 2;
  const dLat = h / KM_PER_DEG;
  const dLon = h / (KM_PER_DEG * Math.cos((inp.lat * Math.PI) / 180));
  return [[inp.lon - dLon, inp.lat + dLat], [inp.lon + dLon, inp.lat + dLat], [inp.lon + dLon, inp.lat - dLat], [inp.lon - dLon, inp.lat - dLat]];
}

export function volcanoResult(inp: VolcanoInput, wind: WindLayer[], windSource: string, ash: AshGrid, totalMass: number, mer: number, cone: ReturnType<typeof energyCone> | null): SimResult {
  const bulk = totalMass / RHO_DEPOSIT;
  const veiV = vei(bulk);
  const thick = ash.frames[ash.frames.length - 1].depth;
  const cellA = ash.cell * ash.cell;
  const areaOver = (m: number, d: Float32Array = thick) => { let c = 0; for (let k = 0; k < d.length; k++) if (d[k] >= m) c++; return (c * cellA) / 1e6; };
  let maxT = 0;
  for (let k = 0; k < thick.length; k++) if (thick[k] > maxT) maxT = thick[k];
  let inGrid = 0;
  for (let k = 0; k < ash.load.length; k++) inGrid += ash.load[k] * cellA;
  const corners = ashCorners(inp);
  const places = GAZETTEER.filter((p) => !p.water).map((p) => {
    const i = Math.floor(((p.lon - corners[0][0]) / (corners[1][0] - corners[0][0])) * ash.nx);
    const j = Math.floor(((p.lat - corners[0][1]) / (corners[3][1] - corners[0][1])) * ash.ny);
    if (i < 0 || j < 0 || i >= ash.nx || j >= ash.ny) return null;
    const k = j * ash.nx + i;
    const first = ash.frames.find((f) => f.depth[k] >= 1e-4);
    return { name: p.name, mm: thick[k] * 1000, firstH: first ? first.t / 3600 : null, km: haversineKm(inp.lat, inp.lon, p.lat, p.lon) };
  }).filter((p): p is NonNullable<typeof p> => !!p && p.mm >= 0.01);
  const wMid = windAt(wind, inp.ventKm * 1000 + 0.5 * inp.columnKm * 1000);
  const windDir = ((Math.atan2(wMid.u, wMid.v) * 180) / Math.PI + 360) % 360; // direction the wind blows towards
  const steps: CalcStep[] = [
    { id: 'mer', label: 'Eruption rate from plume height (Mastin et al. 2009)', equation: 'H = 2.00 V^0.241  ⇒  V = (H / 2)^(1/0.241)', substituted: `V = (${inp.columnKm} / 2)^4.15`, value: mer, unit: 'kg/s', note: `${fmt(mer / RHO_DRE)} m³/s dense rock`, ref: 'mastin2009' },
    { id: 'mass', label: 'Total erupted mass', equation: 'M = ṁ · T', value: totalMass, unit: 'kg', ref: 'mastin2009' },
    { id: 'vei', label: 'Volcanic Explosivity Index', equation: 'VEI from bulk tephra volume M / ρ_deposit (Newhall & Self 1982)', value: veiV, unit: 'VEI', note: `bulk volume ≈ ${fmt(bulk / 1e9)} km³`, ref: 'newhall1982' },
    { id: 'suzuki', label: 'Release along the column (Suzuki profile)', equation: 'f(z) ∝ (1 − z/H) e^(A (z/H − 1)),  A = 4', value: LEVELS, unit: 'release levels', ref: 'bonadonna2005' },
    { id: 'settling', label: 'Terminal fall velocity (example: 0.5 mm grain at 10 km)', equation: 'Stokes / intermediate / turbulent regimes by Reynolds number', value: settlingVelocity(0.0005, particleDensity(1), 10000), unit: 'm/s', ref: 'bonadonna1998' },
    { id: 'diffusion', label: 'Spreading on the ground', equation: 'σ² = 2 K t_fall + σ₀²,  load = Σ m / (2πσ²) · e^(−r²/2σ²)', value: inp.diffusion, unit: 'm²/s (K)', ref: 'bonadonna2005' },
    { id: 'wind', label: 'Wind at mid-column height', equation: `|u| from ${windSource}`, value: Math.hypot(wMid.u, wMid.v), unit: 'm/s', note: `blowing towards ${Math.round(windDir)}°` },
    { id: 'ingrid', label: 'Share of erupted mass deposited inside the domain', equation: 'Σ load · A / M', value: (100 * inGrid) / totalMass, unit: '%', note: 'the rest lands farther away' },
  ];
  const zones: SimZone[] = [];
  if (cone) {
    steps.push({ id: 'cone', label: 'Pyroclastic-flow energy cone', equation: 'z_cone(r) = z_vent + H_c − r · (H/L)  > terrain', substituted: `z_vent = ${fmt(cone.ventM)} m, H_c = ${inp.collapseKm} km, H/L = ${inp.heimRatio}`, value: cone.runoutKm, unit: 'km maximum runout', ref: 'malin1982' });
    if (cone.runoutKm > 0) zones.push({ id: 'pdc', label: 'Pyroclastic flows: maximum runout', radiusKm: cone.runoutKm, frontKmS: 0.05, severity: 3, threshold: `Terrain under the energy cone: ${fmt(cone.areaKm2)} km². Flows travel about 10–100 m/s.` });
  }
  const outputs: SimOutput[] = [
    { id: 'vei', label: 'Volcanic Explosivity Index (from mass)', value: veiV, unit: 'VEI' },
    { id: 'mer', label: 'Eruption rate', value: mer, unit: 'kg/s', range: [mer / 4, mer * 4] },
    { id: 'mass', label: 'Erupted mass', value: totalMass, unit: 'kg', range: [totalMass / 4, totalMass * 4] },
    { id: 'ash1mm', label: 'Area with ≥ 1 mm ash (airports close, health advice)', value: areaOver(0.001), unit: 'km²' },
    { id: 'ash1cm', label: 'Area with ≥ 1 cm ash (crops, roads, power lines)', value: areaOver(0.01), unit: 'km²' },
    { id: 'ash10cm', label: 'Area with ≥ 10 cm ash (weak roofs at risk when wet)', value: areaOver(0.1), unit: 'km²' },
    { id: 'maxash', label: 'Thickest deposit in the domain', value: maxT * 1000, unit: 'mm', range: [maxT * 300, maxT * 3000] },
  ];
  if (cone) outputs.push({ id: 'pdc', label: 'Pyroclastic-flow maximum runout', value: cone.runoutKm, unit: 'km' }, { id: 'pdcarea', label: 'Area reachable by pyroclastic flows', value: cone.areaKm2, unit: 'km²' });
  for (const p of places.sort((a, b) => b.mm - a.mm).slice(0, 8)) {
    outputs.push({ id: `place-${p.name}`, label: `${p.name} (${fmt(p.km)} km away): ash thickness${p.firstH !== null ? `, first ash after ~${fmt(p.firstH)} h` : ''}`, value: p.mm, unit: 'mm', range: [p.mm / 3, p.mm * 3] });
  }
  const series: SimSeries[] = [
    { id: 'wind', label: 'Wind speed with height (input)', xLabel: 'Height (km a.s.l.)', yLabel: 'Wind (m/s)', points: wind.map((w) => [w.z / 1000, Math.hypot(w.u, w.v)]) },
    { id: 'area1mm', label: 'Area under ≥ 1 mm of ash over time', xLabel: 'Time (h)', yLabel: 'Area (km²)', points: ash.frames.map((f) => [f.t / 3600, areaOver(0.001, f.depth)]) },
  ];
  return {
    engine: 'volcano', engineVersion: VOLCANO_VERSION, evidence: 'simulation',
    title: `Explosive eruption: ${inp.columnKm} km column for ${inp.durationH} h (VEI ${veiV})`,
    location: { lat: inp.lat, lon: inp.lon, label: inp.label },
    inputs: { column_km: inp.columnKm, duration_h: inp.durationH, vent_km: Number(inp.ventKm.toFixed(3)), median_phi: inp.medianPhi, sigma_phi: inp.sigmaPhi, diffusion_m2_s: inp.diffusion, collapse_km: inp.collapseKm, heim_ratio: inp.heimRatio, domain_km: inp.domainKm, wind: windSource, lat: inp.lat, lon: inp.lon },
    steps, outputs, zones, series,
    phases: [
      { id: 'start', label: 'Eruption starts', t: 0 },
      { id: 'stop', label: 'Eruption stops', t: inp.durationH * 3600 },
      { id: 'end', label: '99% of the ash has landed', t: ash.tEnd },
    ],
    timeSpan: [0, ash.tEnd],
    summary: `A hypothetical ${inp.columnKm} km eruption column for ${inp.durationH} h erupts about ${fmt(totalMass)} kg of tephra (VEI ${veiV}). With the wind at mid-column blowing towards ${Math.round(windDir)}°, ash at least 1 mm thick covers about ${fmt(areaOver(0.001))} km² and at least 1 cm about ${fmt(areaOver(0.01))} km².${cone && cone.runoutKm > 0 ? ` Pyroclastic flows from a ${inp.collapseKm} km column collapse could reach about ${fmt(cone.runoutKm)} km from the vent.` : ''}${places.length ? '' : ' None of the cities in the app’s place list lies in the ash path with this wind.'}`,
    assumptions: [
      'Steady eruption at a constant rate set by the plume height (Mastin et al. 2009 fit, uncertain by a factor of about 4 in rate).',
      `One wind profile for the whole event (${windSource}). Real winds change during long eruptions.`,
      'Gaussian grain-size distribution in φ; particle density 1000 kg/m³ for coarse pumice rising to 2600 kg/m³ for fine ash; deposit density 1000 kg/m³.',
      'Pyroclastic flows: an energy cone from the highest DEM point within 1.5 km of the chosen location.',
    ],
    limitations: [
      'No ash aggregation (which makes fine ash fall sooner and closer, especially in wet weather), no plume bending by strong wind, and no airborne-ash concentrations for aviation (only ground deposits).',
      'Lava flows, lahars, ballistic blocks and gas are not modelled. The energy cone is a first-order reach estimate; real flows follow valleys.',
      'Hypothetical simulation, not an eruption forecast. Follow official volcano observatories and VAAC advisories.',
    ],
    references: [
      { id: 'mastin2009', label: 'Mastin et al. (2009), A multidisciplinary effort to assign realistic source parameters to models of volcanic ash-cloud transport, JVGR 186', url: 'https://doi.org/10.1016/j.jvolgeores.2009.01.008' },
      { id: 'bonadonna2005', label: 'Bonadonna et al. (2005), Probabilistic modeling of tephra dispersal (Tephra2), JGR 110', url: 'https://doi.org/10.1029/2003JB002896' },
      { id: 'bonadonna1998', label: 'Bonadonna, Ernst & Sparks (1998), Thickness variations and volume estimates of tephra fall deposits, JVGR 81', url: 'https://doi.org/10.1016/S0377-0273(98)00007-9' },
      { id: 'newhall1982', label: 'Newhall & Self (1982), The Volcanic Explosivity Index (VEI), JGR 87', url: 'https://doi.org/10.1029/JC087iC02p01231' },
      { id: 'malin1982', label: 'Malin & Sheridan (1982), Computer-assisted mapping of pyroclastic surges, Science 217', url: 'https://doi.org/10.1126/science.217.4560.637' },
    ],
    raster: { kind: 'thickness', corners, nx: ash.nx, ny: ash.ny, frames: ash.frames, maxDepth: thick },
    computedAt: new Date().toISOString(),
  };
}

export { VOLCANOES } from './parse';
