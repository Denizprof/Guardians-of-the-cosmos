// Flood engine: 2-D inertial shallow-water solver on a real DEM.
//
// Model: Bates, Horritt & Fewtrell (2010), "A simple inertial formulation of the shallow water equations for
// efficient two-dimensional flood inundation modelling", J. Hydrology 387, the scheme used by LISFLOOD-FP.
// Per cell face:  q⁺ = (q − g h_f Δt ∂η/∂x) / (1 + g Δt n² |q| / h_f^(7/3)),  h_f = max(η) − max(z)
// Per cell:       h⁺ = h + Δt (Σq_in − Σq_out)/Δx + Δt (rain − loss)
// Stable step:    Δt = α Δx / √(g h_max), α = 0.7.
// Sea cells (DEM ≤ 0) hold a fixed water level (0 + sea-level offset), so coastal flooding by a raised sea and
// rain running off to the sea are both represented. This module is pure: the DEM is passed in (see dem.ts).
import type { CalcStep, ParamSpec, SimOutput, SimResult, SimSeries, ValidationIssue } from './types';
import { fmt } from './validate';

export const FLOOD_VERSION = '1.0.0';
const G = 9.81;
const ALPHA = 0.7;
const H_MIN = 1e-3; // m, depth below which a face carries no flow
const FRAMES = 24;

export interface FloodInput {
  lat: number;
  lon: number;
  label?: string;
  rainfall: number; // mm/h
  duration: number; // h of rain
  simHours: number; // total simulated time
  loss: number; // mm/h infiltration (constant-rate loss)
  manning: number; // n, s/m^(1/3)
  seaLevel: number; // m offset of the sea surface above present mean sea level
  domainKm: number; // side of the square domain
}

export interface Dem {
  nx: number;
  ny: number;
  dx: number; // m (cell size at the domain centre)
  z: Float32Array; // row-major, row 0 = north
  /** Latitude of each row's centre and the true cell size per row (Web Mercator), when known. */
  rowLat?: Float32Array;
  dxRows?: Float32Array;
  /** Corners [lon, lat]: top-left, top-right, bottom-right, bottom-left (MapLibre image order). */
  corners: [number, number][];
  source: string;
}

export interface FloodFrame { t: number; depth: Float32Array }

export interface FloodRaw {
  frames: FloodFrame[];
  maxDepth: Float32Array;
  rainVolume: number;
  lossVolume: number;
  outflowVolume: number;
  /** Net volume that entered from the sea (+) or drained to it (−). */
  seaExchange: number;
  storedVolume: number;
  steps: number;
  series: { t: number; area01: number; area05: number; stored: number }[];
}

export const FLOOD_PARAMS: ParamSpec[] = [
  { key: 'rainfall', label: 'Rainfall intensity', unit: 'mm/h', min: 0, max: 300, step: 1, default: 50, help: '50 mm/h is a severe cloudburst; 1-in-100-year hourly rain in many cities is 60–100 mm.' },
  { key: 'duration', label: 'Rain duration', unit: 'h', min: 0, max: 72, step: 0.5, default: 3 },
  { key: 'simHours', label: 'Simulated time', unit: 'h', min: 0.5, max: 72, step: 0.5, default: 6, help: 'Total time to run, including after the rain stops.' },
  { key: 'loss', label: 'Infiltration loss', unit: 'mm/h', min: 0, max: 100, step: 1, default: 5, help: 'Sealed urban ≈ 0–5, clay ≈ 1–5, sandy soil ≈ 10–30.' },
  { key: 'manning', label: 'Manning roughness n', unit: 's/m^⅓', min: 0.01, max: 0.2, step: 0.005, default: 0.05, help: 'Smooth urban ≈ 0.015–0.03, fields ≈ 0.035–0.05, forest ≈ 0.1.' },
  { key: 'seaLevel', label: 'Sea level rise / surge', unit: 'm', min: 0, max: 10, step: 0.1, default: 0, help: 'Raises the sea surface (storm surge or long-term sea-level rise).' },
  { key: 'domainKm', label: 'Domain size', unit: 'km', min: 2, max: 60, step: 1, default: 20, help: 'Side of the square area simulated around the point.' },
];

export function validateFlood(raw: Record<string, unknown>): { ok: true; value: FloodInput } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const v: Record<string, number> = {};
  for (const p of FLOOD_PARAMS) {
    const x = raw[p.key] === undefined || raw[p.key] === '' ? p.default : Number(raw[p.key]);
    if (!Number.isFinite(x) || x < p.min || x > p.max) issues.push({ field: p.key, message: `${p.label} must be between ${p.min} and ${p.max} ${p.unit}.` });
    else v[p.key] = x;
  }
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 84) issues.push({ field: 'lat', message: 'Latitude must be between -84 and 84 (limit of the elevation tiles).' });
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) issues.push({ field: 'lon', message: 'Longitude must be between -180 and 180.' });
  if (!issues.length && v.rainfall * v.duration === 0 && v.seaLevel === 0) issues.push({ field: 'rainfall', message: 'Set some rain (intensity and duration) or a sea level rise: otherwise nothing floods.' });
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { lat, lon, label: typeof raw.label === 'string' ? raw.label : undefined, rainfall: v.rainfall, duration: v.duration, simHours: v.simHours, loss: v.loss, manning: v.manning, seaLevel: v.seaLevel, domainKm: v.domainKm } };
}

/** Run the solver. `onProgress` receives 0..1. Pure and deterministic for a given DEM. */
export function solveFlood(inp: FloodInput, dem: Dem, onProgress?: (f: number) => void): FloodRaw {
  const { nx, ny, dx, z } = dem;
  const n = nx * ny;
  const h = new Float64Array(n);
  const qx = new Float64Array((nx + 1) * ny); // face west of cell (i,j): index j*(nx+1)+i
  const qy = new Float64Array(nx * (ny + 1)); // face north of cell (i,j): index j*nx+i
  const sea = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (z[k] <= 0) { sea[k] = 1; h[k] = Math.max(0, inp.seaLevel - z[k]); }
  const maxDepth = new Float32Array(n);
  const area = dx * dx;
  const rain = inp.rainfall / 1000 / 3600; // m/s
  const loss = inp.loss / 1000 / 3600;
  const n2 = inp.manning * inp.manning;
  const tEnd = inp.simHours * 3600;
  const tRain = Math.min(inp.duration, inp.simHours) * 3600;
  const frameDt = tEnd / FRAMES;
  const frames: FloodFrame[] = [{ t: 0, depth: landDepth(h, sea) }];
  const series: FloodRaw['series'] = [{ t: 0, area01: 0, area05: 0, stored: 0 }];
  let nextFrame = frameDt;
  let t = 0;
  let steps = 0;
  let rainV = 0, lossV = 0, outV = 0, seaV = 0;
  // the coast's wave speed: sea cells touching land use the depth at the shoreline, not the open ocean
  const hCoast = Math.max(0.5, inp.seaLevel + 2);

  const face = (q: number, ka: number, kb: number, dt: number): number => {
    // positive q flows from a to b
    if (sea[ka] && sea[kb]) return 0;
    const ea = h[ka] + z[ka];
    const eb = h[kb] + z[kb];
    const zb = Math.max(z[ka], z[kb]);
    const hf = Math.max(ea, eb) - zb;
    if (hf <= H_MIN) return 0;
    // at the coast the sea's flow depth is bounded by the shoreline depth (avoids ocean-depth wave speeds)
    const hfc = sea[ka] || sea[kb] ? Math.min(hf, hCoast) : hf;
    const slope = (eb - ea) / dx;
    const qn = (q - G * hfc * dt * slope) / (1 + (G * dt * n2 * Math.abs(q)) / hfc ** (7 / 3));
    // positivity: one face never drains more than a quarter of the upstream cell in one step
    const up = qn > 0 ? ka : kb;
    if (sea[up]) return Math.max(-hfc * Math.sqrt(G * hfc), Math.min(hfc * Math.sqrt(G * hfc), qn));
    const cap = (h[up] * dx) / (4 * dt);
    return Math.max(-cap, Math.min(cap, qn));
  };
  const edge = (k: number, kIn: number, dt: number): number => {
    // open edge: free outflow at normal depth with the inward bed slope (never inflow)
    // only where the ground falls away outward (the terrain beyond the edge is assumed to continue that slope)
    if (sea[k] || h[k] <= H_MIN || z[kIn] <= z[k]) return 0;
    const s = (z[kIn] - z[k]) / dx;
    return Math.min((h[k] ** (5 / 3) * Math.sqrt(s)) / inp.manning, (h[k] * dx) / (4 * dt));
  };

  while (t < tEnd - 1e-9) {
    let hmax = hCoast;
    for (let k = 0; k < n; k++) if (!sea[k] && h[k] > hmax) hmax = h[k];
    const dt = Math.max(1e-3, Math.min((ALPHA * dx) / Math.sqrt(G * hmax), 120, nextFrame - t, tEnd - t, tRain > t ? tRain - t : Infinity));

    for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) { const f = j * (nx + 1) + i; qx[f] = face(qx[f], j * nx + i - 1, j * nx + i, dt); }
    for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) { const f = j * nx + i; qy[f] = face(qy[f], (j - 1) * nx + i, j * nx + i, dt); }
    if (nx > 1 && ny > 1) {
      for (let j = 0; j < ny; j++) {
        qx[j * (nx + 1)] = -edge(j * nx, j * nx + 1, dt);
        qx[j * (nx + 1) + nx] = edge(j * nx + nx - 1, j * nx + nx - 2, dt);
      }
      for (let i = 0; i < nx; i++) {
        qy[i] = -edge(i, nx + i, dt);
        qy[ny * nx + i] = edge((ny - 1) * nx + i, (ny - 2) * nx + i, dt);
      }
    }

    const r = t < tRain ? rain : 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const net = qx[j * (nx + 1) + i] - qx[j * (nx + 1) + i + 1] + qy[j * nx + i] - qy[(j + 1) * nx + i];
        const dV = net * dx * dt;
        if (sea[k]) { seaV -= dV; continue; } // the sea absorbs or supplies whatever crosses the coast
        let hn = h[k] + dV / area + r * dt;
        rainV += r * dt * area;
        const l = Math.min(loss * dt, Math.max(0, hn));
        hn -= l;
        lossV += l * area;
        if (hn < 0) { rainV -= hn * area; hn = 0; } // round-off guard, booked so the balance stays exact
        h[k] = hn;
        if (hn > maxDepth[k]) maxDepth[k] = hn;
      }
    }
    for (let j = 0; j < ny; j++) outV += (-qx[j * (nx + 1)] + qx[j * (nx + 1) + nx]) * dx * dt;
    for (let i = 0; i < nx; i++) outV += (-qy[i] + qy[ny * nx + i]) * dx * dt;

    t += dt;
    steps++;
    if (t >= nextFrame - 1e-6) {
      frames.push({ t, depth: landDepth(h, sea) });
      let a1 = 0, a5 = 0, st = 0;
      for (let k = 0; k < n; k++) if (!sea[k]) { if (h[k] > 0.1) a1++; if (h[k] > 0.5) a5++; st += h[k]; }
      series.push({ t, area01: (a1 * area) / 1e6, area05: (a5 * area) / 1e6, stored: st * area });
      nextFrame += frameDt;
      onProgress?.(t / tEnd);
    }
    if (steps > 3e6) throw new Error('Flood solver exceeded its step limit');
  }
  let stored = 0;
  for (let k = 0; k < n; k++) if (!sea[k]) stored += h[k] * area;
  return { frames, maxDepth, rainVolume: rainV, lossVolume: lossV, outflowVolume: outV, seaExchange: seaV, storedVolume: stored, steps, series };
}

function landDepth(h: Float64Array, sea: Uint8Array): Float32Array {
  const d = new Float32Array(h.length);
  for (let k = 0; k < h.length; k++) d[k] = sea[k] ? 0 : h[k];
  return d;
}

/** Package the solver output as a SimResult (depth frames travel in `raster`). */
export function floodResult(inp: FloodInput, dem: Dem, raw: FloodRaw): SimResult {
  const area = dem.dx * dem.dx;
  let a1 = 0, a5 = 0, a15 = 0, maxD = 0;
  for (let k = 0; k < raw.maxDepth.length; k++) {
    const d = raw.maxDepth[k];
    if (d > 0.1) a1++;
    if (d > 0.5) a5++;
    if (d > 1.5) a15++;
    if (d > maxD) maxD = d;
  }
  const km2 = (c: number) => (c * area) / 1e6;
  const balance = raw.rainVolume - raw.lossVolume - raw.outflowVolume + raw.seaExchange - raw.storedVolume;
  const scale = Math.max(raw.rainVolume, Math.abs(raw.seaExchange), raw.storedVolume, 1);
  const peak = raw.series.reduce((b, s) => (s.area01 > b.area01 ? s : b), raw.series[0]);
  const steps: CalcStep[] = [
    { id: 'grid', label: 'Computational grid', equation: 'Δx from Web-Mercator tile resolution at the domain centre', value: dem.dx, unit: `m (${dem.nx}×${dem.ny} cells)`, ref: 'dem' },
    { id: 'rainvol', label: 'Rain volume on the domain', equation: 'V_rain = i · T · A', value: raw.rainVolume, unit: 'm³', ref: 'bates2010' },
    { id: 'momentum', label: 'Face discharge (inertial shallow-water equation)', equation: 'q⁺ = (q − g h_f Δt ∂η/∂x) / (1 + g Δt n² |q| / h_f^(7/3))', value: raw.steps, unit: 'time steps taken', ref: 'bates2010' },
    { id: 'cfl', label: 'Stable time step', equation: 'Δt = α Δx / √(g h_max),  α = 0.7', value: (inp.simHours * 3600) / raw.steps, unit: 's (mean Δt)', ref: 'bates2010' },
    { id: 'continuity', label: 'Cell depth update (mass conservation)', equation: 'h⁺ = h + Δt (Σq_in − Σq_out)/Δx + Δt (i − f)', value: raw.storedVolume, unit: 'm³ on land at the end', ref: 'bates2010' },
    { id: 'loss', label: 'Infiltration loss', equation: 'f = constant rate (capped by available water)', value: raw.lossVolume, unit: 'm³' },
    { id: 'outflow', label: 'Water leaving the domain edges', equation: 'q_edge = h^(5/3) S^(1/2) / n  (normal depth)', value: raw.outflowVolume, unit: 'm³' },
    { id: 'sea', label: 'Net exchange with the sea', equation: 'sea cells keep η = 0 + Δ_sea', value: raw.seaExchange, unit: 'm³ (+ = from the sea)' },
    { id: 'balance', label: 'Mass-balance error', equation: '(V_rain − V_loss − V_out + V_sea − V_stored) / V', value: (100 * balance) / scale, unit: '%', note: 'a check on the solver: should be close to 0' },
  ];
  const outputs: SimOutput[] = [
    { id: 'area01', label: 'Area flooded > 10 cm (at any time)', value: km2(a1), unit: 'km²', range: [km2(a1) * 0.6, km2(a1) * 1.5] },
    { id: 'area05', label: 'Area flooded > 50 cm', value: km2(a5), unit: 'km²', range: [km2(a5) * 0.5, km2(a5) * 1.7] },
    { id: 'area15', label: 'Area flooded > 1.5 m', value: km2(a15), unit: 'km²' },
    { id: 'maxdepth', label: 'Maximum water depth', value: maxD, unit: 'm' },
    { id: 'peak', label: 'Largest flooded extent at', value: peak.t / 3600, unit: 'h' },
    { id: 'rain', label: 'Rain volume', value: raw.rainVolume, unit: 'm³' },
    { id: 'balance', label: 'Mass-balance error', value: (100 * balance) / scale, unit: '%' },
  ];
  const series: SimSeries[] = [
    { id: 'area', label: 'Flooded area (> 10 cm) over time', xLabel: 'Time (h)', yLabel: 'Area (km²)', points: raw.series.map((s) => [s.t / 3600, s.area01]) },
    { id: 'stored', label: 'Water stored on land over time', xLabel: 'Time (h)', yLabel: 'Volume (million m³)', points: raw.series.map((s) => [s.t / 3600, s.stored / 1e6]) },
  ];
  const tEnd = inp.simHours * 3600;
  return {
    engine: 'flood', engineVersion: FLOOD_VERSION, evidence: 'simulation',
    title: `Flood: ${inp.rainfall} mm/h for ${inp.duration} h${inp.seaLevel ? `, sea +${inp.seaLevel} m` : ''}, ${inp.domainKm} km area`,
    location: { lat: inp.lat, lon: inp.lon, label: inp.label },
    inputs: { rainfall_mm_h: inp.rainfall, duration_h: inp.duration, sim_h: inp.simHours, loss_mm_h: inp.loss, manning_n: inp.manning, sea_level_m: inp.seaLevel, domain_km: inp.domainKm, grid: `${dem.nx}×${dem.ny} cells of ${fmt(dem.dx)} m`, dem: dem.source, lat: inp.lat, lon: inp.lon },
    steps, outputs, zones: [], series,
    phases: [
      { id: 'start', label: 'Rain starts', t: 0 },
      { id: 'rainend', label: 'Rain stops', t: Math.min(inp.duration, inp.simHours) * 3600 },
      { id: 'peak', label: 'Largest extent', t: peak.t },
      { id: 'end', label: 'End of run', t: tEnd },
    ].sort((a, b) => a.t - b.t),
    timeSpan: [0, tEnd],
    summary: `${inp.rainfall} mm/h of rain for ${inp.duration} h${inp.seaLevel ? ` with the sea raised by ${inp.seaLevel} m` : ''} over a ${inp.domainKm} km × ${inp.domainKm} km area. The solver gives up to ${fmt(km2(a1))} km² under more than 10 cm of water and ${fmt(km2(a5))} km² under more than 50 cm, a maximum depth of ${fmt(maxD)} m, and the largest extent about ${fmt(peak.t / 3600)} h after the start.`,
    assumptions: [
      'Uniform rain over the whole area and a constant infiltration loss.',
      'Terrain from the AWS Terrain Tiles (Terrarium) elevation model, which blends SRTM, GMTED, ETOPO1 and national lidar where available. It is partly a surface model: buildings and trees can raise the ground.',
      'Sea cells (elevation ≤ 0 m) keep a fixed level. Domain edges let water out at normal depth where the ground slopes outward, and let none in (no upstream river inflow).',
      'One Manning roughness for every cell.',
    ],
    limitations: [
      `Cells are ${fmt(dem.dx)} m wide: streets, drains, small channels and flood walls narrower than a cell are not resolved, and storm sewers are not modelled.`,
      'No river baseflow or catchment beyond the area: a flood fed by a large river from outside is under-estimated.',
      'Hypothetical simulation for exploring scenarios, not a flood forecast or an official hazard map.',
    ],
    references: [
      { id: 'bates2010', label: 'Bates, Horritt & Fewtrell (2010), A simple inertial formulation of the shallow water equations…, Journal of Hydrology 387', url: 'https://doi.org/10.1016/j.jhydrol.2010.03.027' },
      { id: 'dem', label: 'AWS Terrain Tiles (Tilezen), data sources and attribution', url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md' },
    ],
    raster: { corners: dem.corners, nx: dem.nx, ny: dem.ny, frames: raw.frames, maxDepth: raw.maxDepth },
    computedAt: new Date().toISOString(),
  };
}
