// Tsunami engine: earthquake source + linear shallow-water propagation over real bathymetry.
//
// Source: rupture length and width from Wells & Coppersmith (1994, reverse faults); average slip from the seismic
// moment, D = M₀ / (μ L W); peak vertical seafloor uplift u₀ = D sin δ, spread over the rupture with a raised-cosine
// shape and copied to the sea surface (the usual instantaneous-source assumption).
// Propagation: linear long-wave equations on a staggered (Arakawa C) grid, as in the deep-ocean stage of TUNAMI /
// COMCOT:  ∂η/∂t + ∂M/∂x + ∂N/∂y = 0,  ∂(M, N)/∂t = −g d ∇η,  stable for Δt < Δx / √(2 g d_max).
// Land is a reflecting wall (no inundation); a sponge layer absorbs waves at the domain edge.
import type { Dem } from './flood';
import { GAZETTEER } from './parse';
import { haversineKm } from './geo';
import { fmt } from './validate';
import type { CalcStep, ParamSpec, SimOutput, SimResult, SimSeries, ValidationIssue } from './types';

export const TSUNAMI_VERSION = '1.0.0';
const G = 9.81;
const MU = 3e10; // crustal rigidity, Pa
const D_MIN = 5; // m: shallower cells are treated as land (the linear model is not valid there)
const SPONGE = 10; // cells
const FRAMES = 36;
const ARRIVAL = 0.05; // m: first-arrival threshold
const SHORE_DEPTH = 10; // m: Green's-law target depth for near-shore estimates

export interface TsunamiInput {
  lat: number;
  lon: number;
  label?: string;
  magnitude: number;
  strike: number; // degrees clockwise from north
  dip: number; // degrees
  domainKm: number;
  simHours: number;
}

export const TSUNAMI_PARAMS: ParamSpec[] = [
  { key: 'magnitude', label: 'Earthquake magnitude', unit: 'Mw', min: 7, max: 9.5, step: 0.1, default: 8.5, help: 'Ocean-crossing tsunamis need roughly Mw 8.5+ thrust earthquakes (Indian Ocean 2004: 9.1; Tōhoku 2011: 9.0–9.1).' },
  { key: 'strike', label: 'Fault strike', unit: '° from north', min: 0, max: 360, step: 1, default: 0, help: 'Direction the rupture runs; the wave beams strongest at right angles to it. Subduction zones usually run along the coast.' },
  { key: 'dip', label: 'Fault dip', unit: '°', min: 5, max: 45, step: 1, default: 15, help: 'Subduction megathrusts dip about 10–20°.' },
  { key: 'domainKm', label: 'Domain size', unit: 'km', min: 300, max: 5000, step: 50, default: 2000 },
  { key: 'simHours', label: 'Simulated time', unit: 'h', min: 0.5, max: 24, step: 0.5, default: 6 },
];

export function validateTsunami(raw: Record<string, unknown>): { ok: true; value: TsunamiInput } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const v: Record<string, number> = {};
  for (const p of TSUNAMI_PARAMS) {
    const x = raw[p.key] === undefined || raw[p.key] === '' ? p.default : Number(raw[p.key]);
    if (!Number.isFinite(x) || x < p.min || x > p.max) issues.push({ field: p.key, message: `${p.label} must be between ${p.min} and ${p.max} ${p.unit}.` });
    else v[p.key] = x;
  }
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 75) issues.push({ field: 'lat', message: 'Latitude must be between -75 and 75 for an ocean-scale grid.' });
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) issues.push({ field: 'lon', message: 'Longitude must be between -180 and 180.' });
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { lat, lon, label: typeof raw.label === 'string' ? raw.label : undefined, magnitude: v.magnitude, strike: v.strike, dip: v.dip, domainKm: v.domainKm, simHours: v.simHours } };
}

export interface Rupture { M0: number; L: number; W: number; D: number; u0: number }

/** Fault size and slip from magnitude (Wells & Coppersmith 1994, reverse; Hanks & Kanamori 1979). Lengths in m. */
export function rupture(M: number, dipDeg: number): Rupture {
  const M0 = 10 ** (1.5 * M + 9.1);
  const L = 10 ** (-2.42 + 0.58 * M) * 1000; // subsurface rupture length
  const W = 10 ** (-1.61 + 0.41 * M) * 1000; // downdip rupture width
  const D = M0 / (MU * L * W);
  return { M0, L, W, D, u0: D * Math.sin((dipDeg * Math.PI) / 180) };
}

export interface TsunamiRaw {
  frames: { t: number; depth: Float32Array }[]; // `depth` holds η (sea-surface elevation, m)
  maxAmp: Float32Array;
  arrival: Float32Array; // s, NaN where the wave never exceeded the threshold
  ocean: Uint8Array;
  depth: Float32Array; // still-water depth, m (0 on land)
  sourcePeak: number;
  sourceVolume: number;
  steps: number;
  dt: number;
  /** Relative change of Σ η·A while no wave has reached the sponge (conservation check). */
  volumeDrift: number;
}

const cosShape = (s: number) => (Math.abs(s) >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * s)));
const cellSize = (dem: Dem, j: number) => (dem.dxRows ? dem.dxRows[j] : dem.dx);

/** Cell centre [lon, lat] for grid index (i, j). */
export function cellLonLat(dem: Dem, i: number, j: number): [number, number] {
  const [[W, N], [E], , [, S]] = dem.corners;
  const lon = W + ((i + 0.5) / dem.nx) * (E - W);
  const lat = dem.rowLat ? dem.rowLat[j] : N + ((j + 0.5) / dem.ny) * (S - N);
  return [lon, lat];
}

/** Initial sea-surface displacement (m) on the grid. */
export function sourceField(inp: TsunamiInput, dem: Dem): { eta: Float32Array; rup: Rupture } {
  const rup = rupture(inp.magnitude, inp.dip);
  const eta = new Float32Array(dem.nx * dem.ny);
  const th = (inp.strike * Math.PI) / 180;
  const kmPerDegLat = 111.195;
  const kmPerDegLon = 111.195 * Math.cos((inp.lat * Math.PI) / 180);
  for (let j = 0; j < dem.ny; j++) {
    for (let i = 0; i < dem.nx; i++) {
      if (dem.z[j * dem.nx + i] > -D_MIN) continue;
      const [lon, lat] = cellLonLat(dem, i, j);
      const e = (lon - inp.lon) * kmPerDegLon * 1000; // local east offset, m
      const n = (lat - inp.lat) * kmPerDegLat * 1000; // local north offset, m
      const along = e * Math.sin(th) + n * Math.cos(th);
      const across = e * Math.cos(th) - n * Math.sin(th);
      eta[j * dem.nx + i] = rup.u0 * cosShape(along / (rup.L / 2)) * cosShape(across / (rup.W / 2));
    }
  }
  return { eta, rup };
}

export function solveTsunami(inp: TsunamiInput, dem: Dem, eta0: Float32Array, onProgress?: (f: number) => void): TsunamiRaw {
  const { nx, ny } = dem;
  const n = nx * ny;
  const d = new Float32Array(n);
  const ocean = new Uint8Array(n);
  let dMax = D_MIN;
  for (let k = 0; k < n; k++) if (dem.z[k] <= -D_MIN) { ocean[k] = 1; d[k] = -dem.z[k]; if (d[k] > dMax) dMax = d[k]; }
  const eta = Float64Array.from(eta0);
  for (let k = 0; k < n; k++) if (!ocean[k]) eta[k] = 0;
  const M = new Float64Array((nx + 1) * ny); // x-flux at the face west of (i, j)
  const N = new Float64Array(nx * (ny + 1)); // y-flux at the face north of (i, j); positive = northward
  let dxMin = Infinity;
  for (let j = 0; j < ny; j++) dxMin = Math.min(dxMin, cellSize(dem, j));
  const dt = (0.5 * dxMin) / Math.sqrt(2 * G * dMax);
  const tEnd = inp.simHours * 3600;
  const maxAmp = new Float32Array(n);
  const arrival = new Float32Array(n).fill(NaN);
  const frames: TsunamiRaw['frames'] = [{ t: 0, depth: Float32Array.from(eta) }];
  const damp = new Float64Array(n).fill(1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const e = Math.min(i, j, nx - 1 - i, ny - 1 - j);
    if (e < SPONGE) damp[j * nx + i] = 1 - 0.15 * ((SPONGE - e) / SPONGE) ** 2;
  }
  const volume = () => { let v = 0; for (let j = 0; j < ny; j++) { const a = cellSize(dem, j) ** 2; for (let i = 0; i < nx; i++) v += eta[j * nx + i] * a; } return v; };
  const v0 = volume();
  let volumeDrift = 0;
  let spongeHit = false;
  let t = 0;
  let steps = 0;
  let nextFrame = tEnd / FRAMES;
  for (let k = 0; k < n; k++) maxAmp[k] = Math.abs(eta[k]);

  while (t < tEnd - 1e-9) {
    for (let j = 0; j < ny; j++) {
      const dx = cellSize(dem, j);
      for (let i = 1; i < nx; i++) {
        const a = j * nx + i - 1, b = a + 1, f = j * (nx + 1) + i;
        M[f] = ocean[a] && ocean[b] ? M[f] - (G * 0.5 * (d[a] + d[b]) * dt * (eta[b] - eta[a])) / dx : 0;
      }
    }
    for (let j = 1; j < ny; j++) {
      const dy = 0.5 * (cellSize(dem, j - 1) + cellSize(dem, j));
      for (let i = 0; i < nx; i++) {
        const a = j * nx + i, b = (j - 1) * nx + i, f = j * nx + i; // b is north of a
        N[f] = ocean[a] && ocean[b] ? N[f] - (G * 0.5 * (d[a] + d[b]) * dt * (eta[b] - eta[a])) / dy : 0;
      }
    }
    t += dt;
    steps++;
    for (let j = 0; j < ny; j++) {
      const dx = cellSize(dem, j);
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!ocean[k]) continue;
        const div = (M[j * (nx + 1) + i + 1] - M[j * (nx + 1) + i] + N[j * nx + i] - N[(j + 1) * nx + i]) / dx;
        let e = eta[k] - dt * div;
        if (damp[k] < 1) {
          if (!spongeHit && Math.abs(e) > 1e-3) spongeHit = true;
          e *= damp[k];
          M[j * (nx + 1) + i] *= damp[k];
          N[j * nx + i] *= damp[k];
        }
        eta[k] = e;
        const amp = Math.abs(e);
        if (amp > maxAmp[k]) maxAmp[k] = amp;
        if (Number.isNaN(arrival[k]) && amp > ARRIVAL) arrival[k] = t;
      }
    }
    if (!spongeHit && steps % 10 === 0) volumeDrift = Math.max(volumeDrift, Math.abs(volume() - v0) / Math.max(Math.abs(v0), 1));
    if (t >= nextFrame - 1e-6) {
      frames.push({ t, depth: Float32Array.from(eta) });
      nextFrame += tEnd / FRAMES;
      onProgress?.(t / tEnd);
      if (!Number.isFinite(maxAmp.reduce((a, b) => Math.max(a, b), 0))) throw new Error('The tsunami solver became unstable');
    }
    if (steps > 5e6) throw new Error('The tsunami solver exceeded its step limit');
  }
  let peak = 0, vol = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = eta0[j * nx + i];
    if (v > peak) peak = v;
    vol += Math.max(0, v) * cellSize(dem, j) ** 2;
  }
  return { frames, maxAmp, arrival, ocean, depth: d, sourcePeak: peak, sourceVolume: vol, steps, dt, volumeDrift };
}

export interface CoastPoint { name: string; lat: number; lon: number; k: number; arrivalS: number; amp: number; depth: number; shoreAmp: number;
  /** The rupture lifts this cell at t = 0: it is inside the source area, so it has no travel-time arrival. */
  inSource: boolean }

/** Coastal ocean cells (ocean cells with a land neighbour) and named places within 60 km of one. */
export function coastalReport(dem: Dem, raw: TsunamiRaw): { coast: CoastPoint[]; places: CoastPoint[] } {
  const { nx, ny } = dem;
  const coast: CoastPoint[] = [];
  for (let j = SPONGE; j < ny - SPONGE; j++) for (let i = SPONGE; i < nx - SPONGE; i++) {
    const k = j * nx + i;
    if (!raw.ocean[k] || (raw.ocean[k - 1] && raw.ocean[k + 1] && raw.ocean[k - nx] && raw.ocean[k + nx])) continue;
    const [lon, lat] = cellLonLat(dem, i, j);
    const amp = raw.maxAmp[k];
    // Green's law: A₂ = A₁ (d₁ / d₂)^(1/4), carried in to 10 m depth
    const inSource = Math.abs(raw.frames[0].depth[k]) > ARRIVAL;
    coast.push({ name: '', lat, lon, k, inSource, arrivalS: inSource ? 0 : raw.arrival[k], amp, depth: raw.depth[k], shoreAmp: amp * Math.max(1, raw.depth[k] / SHORE_DEPTH) ** 0.25 });
  }
  const places: CoastPoint[] = [];
  for (const p of GAZETTEER) {
    if (p.water) continue;
    let best: CoastPoint | null = null;
    let bestD = 60;
    for (const c of coast) { const dd = haversineKm(p.lat, p.lon, c.lat, c.lon); if (dd < bestD) { bestD = dd; best = c; } }
    if (best) places.push({ ...best, name: p.name });
  }
  return { coast, places };
}

export const hm = (s: number): string => (Number.isNaN(s) ? 'not reached' : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

export function tsunamiResult(inp: TsunamiInput, dem: Dem, raw: TsunamiRaw, rup: Rupture): SimResult {
  const { coast, places } = coastalReport(dem, raw);
  const reached = coast.filter((c) => !Number.isNaN(c.arrivalS));
  const inSourceKm = coast.filter((c) => c.inSource).length * (dem.dx / 1000);
  const first = reached.filter((c) => !c.inSource).reduce<CoastPoint | null>((b, c) => (!b || c.arrivalS < b.arrivalS ? c : b), null);
  const maxCoast = coast.reduce<CoastPoint | null>((b, c) => (!b || c.amp > b.amp ? c : b), null);
  let a1 = 0;
  for (let j = 0; j < dem.ny; j++) for (let i = 0; i < dem.nx; i++) { const k = j * dem.nx + i; if (raw.ocean[k] && raw.maxAmp[k] >= 1) a1 += cellSize(dem, j) ** 2; }
  let dDeep = 0;
  for (let k = 0; k < raw.depth.length; k++) if (raw.depth[k] > dDeep) dDeep = raw.depth[k];
  const steps: CalcStep[] = [
    { id: 'moment', label: 'Seismic moment', equation: 'M₀ = 10^(1.5 Mw + 9.1)', value: rup.M0, unit: 'N·m', ref: 'hk1979' },
    { id: 'length', label: 'Rupture length (reverse fault)', equation: 'log₁₀ L = −2.42 + 0.58 Mw', value: rup.L / 1000, unit: 'km', ref: 'wc1994' },
    { id: 'width', label: 'Rupture width (reverse fault)', equation: 'log₁₀ W = −1.61 + 0.41 Mw', value: rup.W / 1000, unit: 'km', ref: 'wc1994' },
    { id: 'slip', label: 'Average slip', equation: 'D = M₀ / (μ L W),  μ = 3×10¹⁰ Pa', value: rup.D, unit: 'm', ref: 'hk1979' },
    { id: 'uplift', label: 'Peak seafloor uplift', equation: 'u₀ = D sin δ  (raised-cosine over L × W)', substituted: `u₀ = ${fmt(rup.D)} · sin ${inp.dip}°`, value: rup.u0, unit: 'm' },
    { id: 'volume', label: 'Water volume lifted', equation: 'V = Σ max(η₀, 0) · A', value: raw.sourceVolume, unit: 'm³' },
    { id: 'momentum', label: 'Linear long-wave equations (staggered grid)', equation: '∂η/∂t + ∂M/∂x + ∂N/∂y = 0,  ∂(M, N)/∂t = −g d ∇η', value: raw.steps, unit: 'time steps', ref: 'imamura' },
    { id: 'cfl', label: 'Stable time step', equation: 'Δt = 0.5 Δx_min / √(2 g d_max)', value: raw.dt, unit: 's', ref: 'imamura' },
    { id: 'speed', label: 'Wave speed in the deepest water', equation: 'c = √(g d)', substituted: `c = √(9.81 · ${fmt(dDeep)})`, value: Math.sqrt(G * dDeep) * 3.6, unit: 'km/h' },
    { id: 'green', label: 'Near-shore amplification (estimate)', equation: "Green's law: A_shore = A (d / 10 m)^(1/4)", value: maxCoast?.shoreAmp ?? 0, unit: 'm (largest coastal estimate)', ref: 'synolakis' },
    { id: 'drift', label: 'Volume conservation check', equation: '|Σ η A − V₀| / V₀ before waves reach the sponge', value: raw.volumeDrift * 100, unit: '%', note: 'should be close to 0' },
  ];
  const sortedPlaces = [...places].sort((a, b) => (Number.isNaN(a.arrivalS) ? Infinity : a.arrivalS) - (Number.isNaN(b.arrivalS) ? Infinity : b.arrivalS));
  const outputs: SimOutput[] = [
    { id: 'uplift', label: 'Peak initial wave (seafloor uplift)', value: rup.u0, unit: 'm', range: [rup.u0 / 2, rup.u0 * 2] },
    { id: 'slip', label: 'Average fault slip', value: rup.D, unit: 'm', range: [rup.D / 2, rup.D * 2] },
    { id: 'length', label: 'Rupture length', value: rup.L / 1000, unit: 'km' },
  ];
  if (first) outputs.push({ id: 'first', label: 'First coastal arrival (≥ 5 cm)', value: first.arrivalS / 60, unit: 'min', range: [first.arrivalS / 66, first.arrivalS / 54] });
  if (maxCoast) {
    outputs.push({ id: 'coastamp', label: 'Largest wave at a modelled coast cell', value: maxCoast.amp, unit: 'm', range: [maxCoast.amp / 2, maxCoast.amp * 2] });
    outputs.push({ id: 'shoreamp', label: "Near-shore estimate (Green's law to 10 m)", value: maxCoast.shoreAmp, unit: 'm', range: [maxCoast.shoreAmp / 2, maxCoast.shoreAmp * 3] });
  }
  outputs.push({ id: 'area1m', label: 'Sea area where the wave exceeded 1 m', value: a1 / 1e6, unit: 'km²' });
  for (const p of sortedPlaces.slice(0, 8)) {
    outputs.push({ id: `place-${p.name}`, label: `${p.name}: ${p.inSource ? 'inside the source area (sea level changes at once)' : `arrival ${hm(p.arrivalS)}`}, offshore wave`, value: p.amp, unit: 'm', alt: `≈ ${fmt(p.shoreAmp)} m near shore (Green's law)` });
  }
  const tEnd = inp.simHours * 3600;
  const series: SimSeries[] = [];
  const gauge = sortedPlaces.find((p) => !Number.isNaN(p.arrivalS)) ?? first;
  if (gauge) series.push({ id: 'gauge', label: `Sea level offshore of ${gauge.name || 'the first coast reached'}`, xLabel: 'Time (h)', yLabel: 'η (m)', points: raw.frames.map((f) => [f.t / 3600, f.depth[gauge.k]]) });
  series.push({ id: 'arrivals', label: 'Coast cells reached over time', xLabel: 'Time (h)', yLabel: 'Coast cells', points: raw.frames.map((f) => [f.t / 3600, reached.filter((c) => c.arrivalS <= f.t).length]) });
  return {
    engine: 'tsunami', engineVersion: TSUNAMI_VERSION, evidence: 'simulation',
    title: `Tsunami from a Mw ${inp.magnitude} thrust earthquake (strike ${inp.strike}°, dip ${inp.dip}°)`,
    location: { lat: inp.lat, lon: inp.lon, label: inp.label },
    inputs: { magnitude: inp.magnitude, strike_deg: inp.strike, dip_deg: inp.dip, domain_km: inp.domainKm, sim_h: inp.simHours, grid: `${dem.nx}×${dem.ny} cells of ~${fmt(dem.dx / 1000)} km`, bathymetry: dem.source, lat: inp.lat, lon: inp.lon },
    steps, outputs, zones: [], series,
    phases: [
      { id: 'start', label: 'Rupture (t = 0)', t: 0 },
      ...(first ? [{ id: 'first', label: 'First coast reached', t: first.arrivalS }] : []),
      { id: 'h1', label: '+1 hour', t: 3600 },
      { id: 'end', label: 'End of run', t: tEnd },
    ].filter((p) => p.t <= tEnd).sort((a, b) => a.t - b.t),
    timeSpan: [0, tEnd],
    summary: `A hypothetical Mw ${inp.magnitude} thrust earthquake lifts the seafloor by up to ${fmt(rup.u0)} m along a ${fmt(rup.L / 1000)} km rupture.${inSourceKm > 0 ? ` About ${fmt(inSourceKm)} km of modelled coastline lies inside the rupture area, where the sea surface changes at once.` : ''} ${first ? `The wave reaches the first modelled coast outside the source area after about ${hm(first.arrivalS)}.` : 'Within the simulated time no modelled coast is reached.'}${maxCoast ? ` The largest wave at a coastal cell is ${fmt(maxCoast.amp)} m (about ${fmt(maxCoast.shoreAmp)} m near shore by Green's law).` : ''}`,
    assumptions: [
      'Uniform slip on a rectangular thrust fault sized by Wells & Coppersmith (1994). The seafloor uplift is a raised-cosine bump of peak D sin δ, copied instantly to the sea surface. A full (Okada) source also has a subsidence lobe and varies along the fault.',
      'Bathymetry from the AWS Terrain Tiles (Terrarium), which use ETOPO1 / SRTM15+ in the oceans, resampled to the grid.',
      'Linear long-wave equations without friction or Coriolis; land is a reflecting wall; water shallower than 5 m is treated as land.',
    ],
    limitations: [
      `Cells are about ${fmt(dem.dx / 1000)} km: bays and harbours are not resolved, and no inundation or run-up on land is computed. Near-shore heights use Green's law only and can be several times off; real run-up often exceeds them.`,
      'Arrival times are usually good to about 10%; wave heights are uncertain by a factor of about 2.',
      'Over shallow shelves the wave shortens; where it becomes shorter than a few grid cells the coarse grid smooths it out, so coastal heights can be UNDER-estimated. Use a smaller domain (finer cells) for a specific coast.',
      'Hypothetical simulation, not a tsunami warning. Follow official warnings (NOAA PTWC and national agencies).',
    ],
    references: [
      { id: 'wc1994', label: 'Wells & Coppersmith (1994), BSSA 84', url: 'https://doi.org/10.1785/BSSA0840040974' },
      { id: 'hk1979', label: 'Hanks & Kanamori (1979), JGR 84', url: 'https://doi.org/10.1029/JB084iB05p02348' },
      { id: 'imamura', label: 'Imamura (2009), Tsunami modeling: calculating inundation and hazard maps, in The Sea vol. 15 (TUNAMI linear long-wave scheme)', url: 'https://www.hup.harvard.edu/books/9780674031739' },
      { id: 'synolakis', label: "Synolakis (1991), Green's law and the evolution of solitary waves, Physics of Fluids A 3", url: 'https://doi.org/10.1063/1.858084' },
      { id: 'dem', label: 'AWS Terrain Tiles (Tilezen), data sources', url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md' },
    ],
    raster: { kind: 'sea-surface', corners: dem.corners, nx: dem.nx, ny: dem.ny, frames: raw.frames, maxDepth: raw.maxAmp },
    computedAt: new Date().toISOString(),
  };
}
