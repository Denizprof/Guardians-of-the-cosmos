// Climate scenario engine: a reduced-complexity climate model, not a general circulation model.
//
// Global temperature: the two-layer energy-balance model (Held et al. 2010; Geoffroy et al. 2013)
//   C dT/dt = F − λT − γ(T − T_d),   C_d dT_d/dt = γ(T − T_d),   λ = F₂ₓ / ECS,
// driven by approximate effective radiative forcing (ERF) from 1750 and by the SSP scenarios of CMIP6/AR6
// (the number in an SSP name is the 2100 forcing in W/m²). Output is relative to 1850–1900, as in AR6.
// Sea level: thermal expansion from the model's heat uptake (≈1.9 mm/yr per W/m²) plus a semi-empirical
// glacier and ice-sheet term k·(T − T₀) fitted to the observed 1901–2018 rise and the 2006–2018 rate.
// Regional maps: PATTERN SCALING. Local change = global change × a fixed spatial pattern. The patterns here are
// qualitative (polar amplification, land warms faster than ocean, wetter tropics and high latitudes, drier
// subtropics), normalised so their area-weighted mean is the global value. They are illustrative, not CMIP6 maps.
import { fmt } from './validate';
import type { CalcStep, ChoiceSpec, ParamSpec, SimOutput, SimResult, SimSeries, ValidationIssue } from './types';

export const CLIMATE_VERSION = '1.0.0';
export const BASE_YEAR = 2015; // the timeline starts here
export const WORLD_N = 180; // map grid, Web-Mercator rows
const F2X = 3.93; // W/m² per CO₂ doubling (AR6)
const C_UP = 8.0, C_DEEP = 100, GAMMA = 0.7; // W yr m⁻² K⁻¹, W yr m⁻² K⁻¹, W m⁻² K⁻¹
const DT = 0.1; // yr
const THERMO = 1.9; // mm/yr of sea level per W/m² of heat uptake
const CRYO_K = 1.75, CRYO_T0 = -0.21; // mm/yr/K and K, fitted to observed sea-level rise
const HYDRO = 2.0; // global-mean precipitation increase, %/K (AR6: 1–3 %/K)

export type Ssp = 'ssp126' | 'ssp245' | 'ssp370' | 'ssp585';
export const SSPS: { id: Ssp; label: string; story: string }[] = [
  { id: 'ssp126', label: 'SSP1-2.6', story: 'Low emissions: rapid cuts, net-zero CO₂ around 2075' },
  { id: 'ssp245', label: 'SSP2-4.5', story: 'Middle road: emissions peak mid-century' },
  { id: 'ssp370', label: 'SSP3-7.0', story: 'High emissions, little climate policy' },
  { id: 'ssp585', label: 'SSP5-8.5', story: 'Very high emissions, fossil-fuelled growth' },
];

/** Approximate total effective radiative forcing vs 1750 (W/m²): AR6 gives 2.72 for 2019; SSP names give 2100. */
const HIST: [number, number][] = [[1750, 0], [1850, 0.25], [1900, 0.45], [1950, 0.75], [1980, 1.3], [2000, 1.9], [2019, 2.72]];
const FUTURE: Record<Ssp, [number, number][]> = {
  ssp126: [[2019, 2.72], [2040, 3.0], [2050, 2.95], [2070, 2.8], [2100, 2.6]],
  ssp245: [[2019, 2.72], [2040, 3.4], [2060, 4.0], [2080, 4.4], [2100, 4.5]],
  ssp370: [[2019, 2.72], [2040, 3.8], [2060, 5.0], [2080, 6.2], [2100, 7.0]],
  ssp585: [[2019, 2.72], [2040, 4.3], [2060, 6.0], [2080, 7.4], [2100, 8.5]],
};

const lin = (a: [number, number][], x: number): number => {
  if (x <= a[0][0]) return a[0][1];
  for (let i = 1; i < a.length; i++) if (x <= a[i][0]) { const f = (x - a[i - 1][0]) / (a[i][0] - a[i - 1][0]); return a[i - 1][1] + f * (a[i][1] - a[i - 1][1]); }
  return a[a.length - 1][1];
};

export function forcing(ssp: Ssp, year: number, extra = 0): number {
  const f = year <= 2019 ? lin(HIST, year) : lin(FUTURE[ssp], year);
  return f + extra * Math.min(1, Math.max(0, (year - 2030) / 10)); // a hypothetical extra forcing ramps in 2030–2040
}

export interface Trajectory {
  years: number[]; // 1750…2100
  F: number[];
  T: number[]; // °C relative to 1850–1900
  N: number[]; // Earth's heat uptake, W/m²
  gmsl: number[]; // m relative to 1995–2014
  rate: number[]; // mm/yr
}

export function runEbm(ecs: number, ssp: Ssp, extra = 0): Trajectory {
  const lam = F2X / ecs;
  let T = 0, Td = 0;
  const years: number[] = [], F: number[] = [], Tr: number[] = [], N: number[] = [];
  for (let y = 1750; y <= 2100; y++) {
    const f = forcing(ssp, y, extra);
    years.push(y); F.push(f); Tr.push(T); N.push(f - lam * T);
    for (let s = 0; s < 10; s++) {
      T += ((f - lam * T - GAMMA * (T - Td)) / C_UP) * DT;
      Td += ((GAMMA * (T - Td)) / C_DEEP) * DT;
    }
  }
  const base = Tr.slice(100, 151).reduce((a, x) => a + x, 0) / 51; // 1850–1900
  const T2 = Tr.map((x) => x - base);
  const rate = T2.map((t, i) => THERMO * N[i] + Math.max(0, CRYO_K * (t - CRYO_T0)));
  let h = 0;
  const raw = rate.map((r) => (h += r / 1000));
  const ref = raw.slice(245, 265).reduce((a, x) => a + x, 0) / 20; // 1995–2014
  return { years, F, T: T2, N, gmsl: raw.map((x) => x - ref), rate };
}

export const meanOver = (t: Trajectory, key: 'T' | 'gmsl', a: number, b: number): number => {
  let s = 0, n = 0;
  for (let y = a; y <= b; y++) { s += t[key][y - 1750]; n++; }
  return s / n;
};

// ---- spatial patterns -----------------------------------------------------------------------------------------

const rawTemp = (lat: number, land: boolean): number => (0.8 + 1.4 * (Math.abs(lat) / 90) ** 3) * (land ? 1.35 : 0.9);
const rawPrecip = (lat: number): number => {
  const a = Math.abs(lat);
  return 4 * Math.exp(-((lat / 12) ** 2)) - 3 * Math.exp(-(((a - 25) / 9) ** 2)) + 5 * Math.exp(-(((a - 65) / 18) ** 2));
};

export const worldLat = (j: number, n = WORLD_N): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (j + 0.5)) / n))) * 180) / Math.PI;

export interface Patterns {
  /** Local warming per °C of global warming, for ocean and land at each map row. */
  tempOcean: Float32Array;
  tempLand: Float32Array;
  /** Local precipitation change in %/K at each map row. */
  precip: Float32Array;
  land: Uint8Array | null;
  rows: number;
}

/** Patterns normalised so their area-weighted global mean is 1 (temperature) and HYDRO %/K (precipitation). */
export function buildPatterns(land: Uint8Array | null): Patterns {
  const n = WORLD_N;
  const lat = Array.from({ length: n }, (_, j) => worldLat(j));
  let wSum = 0, tSum = 0, pSum = 0;
  for (let j = 0; j < n; j++) {
    const w = Math.cos((lat[j] * Math.PI) / 180);
    for (let i = 0; i < n; i++) { wSum += w; tSum += w * rawTemp(lat[j], !!land?.[j * n + i]); }
    pSum += w * n * rawPrecip(lat[j]);
  }
  const tNorm = 1 / (tSum / wSum);
  const pShift = HYDRO - pSum / wSum;
  return {
    tempOcean: Float32Array.from(lat, (l) => rawTemp(l, false) * tNorm),
    tempLand: Float32Array.from(lat, (l) => rawTemp(l, true) * tNorm),
    precip: Float32Array.from(lat, (l) => rawPrecip(l) + pShift),
    land, rows: n,
  };
}

const rowOf = (lat: number): number => {
  const y = Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));
  return Math.min(WORLD_N - 1, Math.max(0, Math.floor(((1 - y / Math.PI) / 2) * WORLD_N)));
};
const colOf = (lon: number): number => Math.min(WORLD_N - 1, Math.max(0, Math.floor(((lon + 180) / 360) * WORLD_N)));

/** Local pattern values at a point. */
export function localFactors(p: Patterns, lat: number, lon: number): { temp: number; precip: number; land: boolean } {
  const j = rowOf(lat), i = colOf(lon);
  const land = !!p.land?.[j * WORLD_N + i];
  return { temp: land ? p.tempLand[j] : p.tempOcean[j], precip: p.precip[j], land };
}

// ---- engine ----------------------------------------------------------------------------------------------------

export interface ClimateInput {
  lat: number;
  lon: number;
  label?: string;
  scenario: Ssp;
  map: 'warming' | 'precip';
  year: number;
  ecs: number;
  extra: number;
}

export const CLIMATE_PARAMS: ParamSpec[] = [
  { key: 'year', label: 'Year to look at', unit: '', min: 2025, max: 2100, step: 1, default: 2100, help: 'Results are shown for this year; the time bar plays from 2015.' },
  { key: 'ecs', label: 'Climate sensitivity (ECS)', unit: '°C per CO₂ doubling', min: 2, max: 5, step: 0.1, default: 3, help: 'How much the Earth warms in the long run if CO₂ doubles. IPCC AR6: best estimate 3.0, likely range 2.5–4.0.' },
  { key: 'extra', label: 'Extra forcing from 2030', unit: 'W/m²', min: -3, max: 3, step: 0.1, default: 0, help: 'A hypothetical push added on top of the scenario: negative cools (like sunlight-reflecting particles), positive warms.' },
];
export const CLIMATE_CHOICES: ChoiceSpec[] = [
  { key: 'scenario', label: 'Emissions scenario (SSP)', default: 'ssp245', options: SSPS.map((s) => ({ value: s.id, label: `${s.label} · ${s.story}` })) },
  { key: 'map', label: 'Show on the globe', default: 'warming', options: [{ value: 'warming', label: 'Warming since 1850–1900' }, { value: 'precip', label: 'Rainfall change since 1850–1900' }] },
];

export function validateClimate(raw: Record<string, unknown>): { ok: true; value: ClimateInput } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const v: Record<string, number> = {};
  for (const p of CLIMATE_PARAMS) {
    const x = raw[p.key] === undefined || raw[p.key] === '' ? p.default : Number(raw[p.key]);
    if (!Number.isFinite(x) || x < p.min || x > p.max) issues.push({ field: p.key, message: `${p.label} must be between ${p.min} and ${p.max}${p.unit ? ` ${p.unit}` : ''}.` });
    else v[p.key] = x;
  }
  if (!issues.length && !Number.isInteger(v.year)) issues.push({ field: 'year', message: 'Year to look at must be a whole year.' });
  const scenario = String(raw.scenario ?? 'ssp245');
  if (!SSPS.some((s) => s.id === scenario)) issues.push({ field: 'scenario', message: 'Choose one of the four SSP scenarios.' });
  const map = String(raw.map ?? 'warming');
  if (map !== 'warming' && map !== 'precip') issues.push({ field: 'map', message: 'The map must show warming or rainfall change.' });
  const lat = Number(raw.lat), lon = Number(raw.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) issues.push({ field: 'lat', message: 'Latitude must be between -90 and 90.' });
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) issues.push({ field: 'lon', message: 'Longitude must be between -180 and 180.' });
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { lat, lon, label: typeof raw.label === 'string' ? raw.label : undefined, scenario: scenario as Ssp, map: map as 'warming' | 'precip', year: v.year, ecs: v.ecs, extra: v.extra } };
}

/** First year the 20-year-average warming reaches a level (centred window, as the IPCC reports), or null. */
export function crossingYear(t: Trajectory, level: number): number | null {
  for (let y = 1860; y <= 2090; y++) if (meanOver(t, 'T', y - 10, y + 9) >= level) return y;
  return null;
}

export function climateResult(inp: ClimateInput, patterns: Patterns, landNote: string): SimResult {
  const central = runEbm(inp.ecs, inp.scenario, inp.extra);
  const lo = runEbm(Math.max(2, inp.ecs - 0.5), inp.scenario, inp.extra);
  const hi = runEbm(Math.min(5, inp.ecs + 1.0), inp.scenario, inp.extra);
  const idx = inp.year - 1750;
  const win = (t: Trajectory) => meanOver(t, 'T', Math.max(1850, inp.year - 9), Math.min(2100, inp.year + 10));
  const gT = win(central), gTlo = win(lo), gThi = win(hi);
  const gT9500 = meanOver(central, 'T', 1995, 2014);
  const lf = localFactors(patterns, inp.lat, inp.lon);
  const localT = gT * lf.temp, localP = gT * lf.precip;
  const slr = central.gmsl[idx], slrLo = lo.gmsl[idx] * 0.85, slrHi = hi.gmsl[idx] * 1.2;
  const c15 = crossingYear(central, 1.5), c20 = crossingYear(central, 2.0);
  const sc = SSPS.find((s) => s.id === inp.scenario)!;

  const years: number[] = [];
  for (let y = BASE_YEAR; y < inp.year; y += 5) years.push(y);
  years.push(inp.year);
  const n = WORLD_N;
  const frames = years.map((y) => {
    const g = meanOver(central, 'T', Math.max(1850, y - 9), Math.min(2100, y + 10));
    const d = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      d[j * n + i] = inp.map === 'warming'
        ? g * (patterns.land?.[j * n + i] ? patterns.tempLand[j] : patterns.tempOcean[j])
        : g * patterns.precip[j];
    }
    return { t: y - BASE_YEAR, depth: d };
  });

  const others = SSPS.filter((s) => s.id !== inp.scenario);
  const yrs = central.years.map((y, i) => [y, i] as const).filter(([y]) => y >= 1950);
  const smooth = (t: Trajectory, key: 'T' | 'gmsl') => yrs.map(([y]) => [y, meanOver(t, key, Math.max(1850, y - 5), Math.min(2100, y + 5))] as [number, number]);
  const steps: CalcStep[] = [
    { id: 'forcing', label: `Radiative forcing in ${inp.year} (${sc.label})`, equation: 'ERF(t): historical + SSP pathway; SSP name = 2100 forcing in W/m²', value: central.F[idx], unit: 'W/m²', ref: 'ar6' },
    { id: 'lambda', label: 'Climate feedback parameter', equation: 'λ = F₂ₓ / ECS,  F₂ₓ = 3.93 W/m²', substituted: `λ = 3.93 / ${inp.ecs}`, value: F2X / inp.ecs, unit: 'W/m²/K', ref: 'ar6' },
    { id: 'ebm', label: 'Two-layer energy-balance model', equation: 'C dT/dt = F − λT − γ(T − T_d);  C_d dT_d/dt = γ(T − T_d)', substituted: `C = ${C_UP}, C_d = ${C_DEEP}, γ = ${GAMMA}`, value: gT, unit: '°C global warming (20-yr mean around the year)', ref: 'geoffroy2013' },
    { id: 'pattern', label: 'Pattern scaling to the chosen place', equation: 'ΔT_local = ΔT_global × pattern(latitude, land or ocean)', substituted: `pattern = ${fmt(lf.temp)} (${lf.land ? 'land' : 'ocean'}, ${inp.lat.toFixed(1)}°)`, value: localT, unit: '°C', ref: 'pattern' },
    { id: 'precip', label: 'Rainfall change at the chosen place', equation: 'ΔP/P = ΔT_global × p(latitude),  global mean p = 2 %/K', value: localP, unit: '% (illustrative pattern)', ref: 'ar6' },
    { id: 'uptake', label: 'Heat uptake (drives thermal expansion)', equation: 'N = F − λT;  dH_thermal/dt = 1.9 mm/yr per W/m² × N', value: central.N[idx], unit: 'W/m² in the year', ref: 'ar6' },
    { id: 'cryo', label: 'Glaciers and ice sheets (semi-empirical)', equation: 'dH/dt = max(0, k (T − T₀)),  k = 1.75 mm/yr/K, T₀ = −0.21 K', value: Math.max(0, CRYO_K * (central.T[idx] - CRYO_T0)), unit: 'mm/yr in the year', ref: 'rahmstorf2007' },
    { id: 'gmsl', label: 'Global-mean sea level (since 1995–2014)', equation: 'H(t) = ∫ (thermal + glacier and ice-sheet rates) dt', value: slr, unit: 'm', ref: 'ar6' },
  ];
  const outputs: SimOutput[] = [
    { id: 'gwarm', label: `Global warming in ${inp.year} (since 1850–1900)`, value: gT, unit: '°C', range: [gTlo, gThi] },
    { id: 'gwarm2', label: `Global warming in ${inp.year} (since 1995–2014)`, value: gT - gT9500, unit: '°C', range: [gTlo - meanOver(lo, 'T', 1995, 2014), gThi - meanOver(hi, 'T', 1995, 2014)] },
    { id: 'lwarm', label: `Warming at this place in ${inp.year}`, value: localT, unit: '°C', range: [gTlo * lf.temp, gThi * lf.temp] },
    { id: 'lprecip', label: `Rainfall change at this place in ${inp.year}`, value: localP, unit: '%', range: [localP * 0.5, localP * 2] },
    { id: 'gmsl', label: `Global sea-level rise by ${inp.year} (since 1995–2014)`, value: slr, unit: 'm', range: [slrLo, slrHi] },
    { id: 'slrrate', label: `Sea-level rise rate in ${inp.year}`, value: central.rate[idx], unit: 'mm/yr' },
    { id: 'force', label: 'Radiative forcing', value: central.F[idx], unit: 'W/m²' },
  ];
  if (c15) outputs.push({ id: 'y15', label: '20-year average first reaches 1.5 °C in', value: c15, unit: 'year' });
  if (c20) outputs.push({ id: 'y20', label: '20-year average first reaches 2 °C in', value: c20, unit: 'year' });
  const series: SimSeries[] = [
    { id: 'gsat', label: 'Global warming since 1850–1900', xLabel: 'Year', yLabel: '°C', points: smooth(central, 'T'), extra: others.map((s) => ({ label: s.label, points: smooth(runEbm(inp.ecs, s.id, inp.extra), 'T') })) },
    { id: 'local', label: 'Warming at this place', xLabel: 'Year', yLabel: '°C', points: smooth(central, 'T').map(([y, t]) => [y, t * lf.temp] as [number, number]) },
    { id: 'gmsl', label: 'Global sea-level rise since 1995–2014', xLabel: 'Year', yLabel: 'm', points: yrs.map(([y, i]) => [y, central.gmsl[i]] as [number, number]), extra: others.map((s) => { const t = runEbm(inp.ecs, s.id, inp.extra); return { label: s.label, points: yrs.map(([y, i]) => [y, t.gmsl[i]] as [number, number]) }; }) },
    { id: 'forcing', label: 'Radiative forcing', xLabel: 'Year', yLabel: 'W/m²', points: yrs.map(([y, i]) => [y, central.F[i]] as [number, number]) },
  ];
  const span = inp.year - BASE_YEAR;
  const corners: [number, number][] = [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]];
  return {
    engine: 'climate', engineVersion: CLIMATE_VERSION, evidence: 'projection',
    title: `Climate ${sc.label} to ${inp.year}: ECS ${inp.ecs} °C${inp.extra ? `, extra forcing ${inp.extra > 0 ? '+' : ''}${inp.extra} W/m²` : ''}`,
    location: { lat: inp.lat, lon: inp.lon, label: inp.label },
    inputs: { scenario: sc.label, year: inp.year, ecs_c: inp.ecs, extra_forcing_w_m2: inp.extra, map: inp.map, land_sea_mask: landNote, lat: inp.lat, lon: inp.lon },
    steps, outputs, zones: [], series,
    phases: [{ id: 'now', label: '2015 (start)', t: 0 }, ...[2030, 2050, 2075].filter((y) => y < inp.year).map((y) => ({ id: `y${y}`, label: String(y), t: y - BASE_YEAR })), { id: 'end', label: String(inp.year), t: span }],
    timeSpan: [0, span],
    summary: `Under ${sc.label} (${sc.story.toLowerCase()}) with a climate sensitivity of ${inp.ecs} °C, the world is about ${fmt(gT)} °C warmer than in 1850–1900 around ${inp.year} (range ${fmt(gTlo)}–${fmt(gThi)} °C). At ${inp.label ?? `${inp.lat.toFixed(1)}°, ${inp.lon.toFixed(1)}°`} the pattern-scaled warming is about ${fmt(localT)} °C and the rainfall change about ${localP >= 0 ? '+' : ''}${fmt(localP)} %. Global sea level is about ${fmt(slr)} m higher than in 1995–2014 (range ${fmt(slrLo)}–${fmt(slrHi)} m). This is a scenario for exploring "what if emissions follow this path", not a forecast.`,
    assumptions: [
      'Annual-mean global temperature from a two-layer energy-balance model with fixed heat capacities; forcing from 1750 is approximate and was chosen to reproduce the assessed 2019 value (2.72 W/m², AR6).',
      'Emissions scenarios are the CMIP6 SSPs, represented only by their total radiative forcing; non-CO₂ gases, aerosols and land use are not separated.',
      'Regional warming and rainfall use fixed patterns scaled by global warming (pattern scaling); the patterns are qualitative and normalised to the global mean.',
      `The land–sea mask comes from the AWS Terrain Tiles (${landNote}).`,
    ],
    limitations: [
      'Not a climate model: no ocean circulation, clouds, sea ice, tipping points, extremes or year-to-year variability. Real regional changes can differ greatly from the patterns shown, especially for rainfall, where even the sign is uncertain in many regions.',
      'Sea level is global-mean only; local sea level also depends on land movement and ocean dynamics. Ice-sheet instabilities could add more than shown (the range includes ×0.85–×1.2 of ice uncertainty).',
      'The sea-level constants were fitted to the observed 1901–2018 rise and the 2006–2018 rate; the AR6 projections for 2100 are an independent cross-check (see the guide).',
      'A scenario for exploring consequences, not a forecast and not the output of an official assessment. Use IPCC AR6 and national climate services for decisions.',
    ],
    references: [
      { id: 'ar6', label: 'IPCC AR6 WGI (2021), Climate Change 2021: The Physical Science Basis (Chapters 4, 7, 9; SPM)', url: 'https://www.ipcc.ch/report/ar6/wg1/' },
      { id: 'geoffroy2013', label: 'Geoffroy et al. (2013), Transient climate response in a two-layer energy-balance model, J. Climate 26', url: 'https://doi.org/10.1175/JCLI-D-12-00195.1' },
      { id: 'rahmstorf2007', label: 'Rahmstorf (2007), A semi-empirical approach to projecting future sea-level rise, Science 315', url: 'https://doi.org/10.1126/science.1135456' },
      { id: 'pattern', label: 'Tebaldi & Arblaster (2014), Pattern scaling: its strengths and limitations, Climatic Change 122', url: 'https://doi.org/10.1007/s10584-013-1032-9' },
      { id: 'ssp', label: 'O’Neill et al. (2016), The Scenario Model Intercomparison Project (ScenarioMIP) for CMIP6, GMD 9', url: 'https://doi.org/10.5194/gmd-9-3461-2016' },
    ],
    raster: { kind: inp.map, corners, nx: n, ny: n, frames, maxDepth: frames[frames.length - 1].depth },
    computedAt: new Date().toISOString(),
  };
}
