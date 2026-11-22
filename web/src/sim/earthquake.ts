// Earthquake scenario engine: energy, moment, rupture size and an intensity (MMI) footprint.
//
// Models: Hanks & Kanamori (1979) moment magnitude; Gutenberg–Richter radiated energy; Wells & Coppersmith (1994)
// subsurface rupture length; Atkinson & Wald (2007) intensity-prediction equation (California coefficients) using a
// point source. A first-order, scenario-level estimate, not a ShakeMap.
import { fmt, readParams, solveDecreasing } from './validate';
import type { CalcStep, ChoiceSpec, ParamSpec, SimEngine, SimOutput, SimResult, SimZone, Validated } from './types';

export const QUAKE_VERSION = '1.0.0';
const VS = 3.5; // km/s, S-wave speed (timing)
const VP = 6.0; // km/s, P-wave speed (timing)

export type FaultType = 'all' | 'strike-slip' | 'reverse' | 'normal';

export interface QuakeInput {
  lat: number;
  lon: number;
  label?: string;
  magnitude: number;
  depth: number; // km
  fault: FaultType;
}

export const QUAKE_PARAMS: ParamSpec[] = [
  { key: 'magnitude', label: 'Moment magnitude', unit: 'Mw', min: 4, max: 9.5, step: 0.1, default: 7, help: 'The largest recorded earthquake (Chile, 1960) was Mw 9.5.' },
  { key: 'depth', label: 'Hypocentre depth', unit: 'km', min: 1, max: 700, step: 1, default: 15, help: 'Most damaging earthquakes are shallower than 70 km.' },
];
export const QUAKE_CHOICES: ChoiceSpec[] = [
  { key: 'fault', label: 'Fault type', default: 'all', options: [
    { value: 'all', label: 'Unknown / all types' }, { value: 'strike-slip', label: 'Strike-slip' }, { value: 'reverse', label: 'Reverse (thrust)' }, { value: 'normal', label: 'Normal' },
  ] },
];

/** Wells & Coppersmith (1994) subsurface rupture length: log10 L = a + b M. */
const WC94: Record<FaultType, [number, number]> = { all: [-2.44, 0.59], 'strike-slip': [-2.57, 0.62], reverse: [-2.42, 0.58], normal: [-1.88, 0.5] };

/** Atkinson & Wald (2007) intensity prediction, California coefficients. R = hypocentral-style distance (km). */
export function mmiAW2007(M: number, R: number): number {
  const c1 = 12.27, c2 = 2.27, c3 = 0.1304, c4 = -1.3, c5 = -0.0007070, c6 = 1.95, c7 = -0.577, Rt = 30;
  const Rr = Math.max(R, 1);
  const B = Math.max(0, Math.log10(Rr / Rt));
  return c1 + c2 * (M - 6) + c3 * (M - 6) ** 2 + c4 * Math.log10(Rr) + c5 * Rr + c6 * B + c7 * M * Math.log10(Rr);
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function validateQuake(raw: Record<string, unknown>): Validated<QuakeInput> {
  const { values, picks, issues } = readParams(raw, QUAKE_PARAMS, QUAKE_CHOICES);
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { lat: Number(raw.lat), lon: Number(raw.lon), label: typeof raw.label === 'string' ? raw.label : undefined, magnitude: values.magnitude, depth: values.depth, fault: picks.fault as FaultType } };
}

export function runQuake(q: QuakeInput): SimResult {
  const steps: CalcStep[] = [];
  const outputs: SimOutput[] = [];
  const zones: SimZone[] = [];
  const M0 = 10 ** (1.5 * q.magnitude + 9.1);
  steps.push({ id: 'moment', label: 'Seismic moment', equation: 'M₀ = 10^(1.5 Mw + 9.1)', substituted: `M₀ = 10^(1.5 · ${q.magnitude} + 9.1)`, value: M0, unit: 'N·m', ref: 'hk1979' });
  const E = 10 ** (1.5 * q.magnitude + 4.8);
  steps.push({ id: 'energy', label: 'Radiated seismic energy', equation: 'log₁₀ E = 1.5 M + 4.8', value: E, unit: 'J', note: `≈ ${fmt(E / 4.184e15)} Mt TNT`, ref: 'gr1956' });
  const [a, b] = WC94[q.fault];
  const L = 10 ** (a + b * q.magnitude);
  steps.push({ id: 'rupture', label: 'Subsurface rupture length', equation: `log₁₀ L = ${a} + ${b} M`, value: L, unit: 'km', ref: 'wc1994' });
  outputs.push({ id: 'energy', label: 'Radiated energy', value: E, unit: 'J', alt: `≈ ${fmt(E / 4.184e15)} Mt TNT` });
  outputs.push({ id: 'rupture', label: 'Rupture length', value: L, unit: 'km', range: [L / 1.9, L * 1.9] });
  const h = Math.max(14, q.depth);
  const mmiAt = (dKm: number): number => mmiAW2007(q.magnitude, Math.hypot(dKm, h));
  const epi = mmiAt(0);
  steps.push({ id: 'mmi', label: 'Intensity at the epicentre', equation: 'MMI = c₁ + c₂(M−6) + c₃(M−6)² + c₄ log R + c₅ R + c₆ B + c₇ M log R,  R = √(D² + h²)', value: epi, unit: 'MMI', ref: 'aw2007' });
  outputs.push({ id: 'mmi0', label: 'Peak intensity (epicentre)', value: Math.min(12, epi), unit: 'MMI', range: [Math.min(12, epi - 0.7), Math.min(12, epi + 0.7)] });
  const levels: [number, 0 | 1 | 2 | 3, string][] = [[9, 3, 'violent: heavy damage even to well-designed structures'], [8, 3, 'severe: considerable damage to ordinary buildings'], [6, 2, 'strong: felt by all, slight damage'], [4, 0, 'light: felt indoors by many']];
  for (const [lvl, sev, desc] of levels) {
    const rad = solveDecreasing(mmiAt, lvl, 0.01, 3000);
    if (rad !== null && rad > 0.01) {
      zones.push({ id: `mmi-${lvl}`, label: `Intensity ${ROMAN[lvl]}+ (${desc.split(':')[0]})`, radiusKm: rad, frontKmS: VS, severity: sev, threshold: `MMI ${ROMAN[lvl]}: ${desc}` });
      outputs.push({ id: `mmi-${lvl}`, label: `MMI ${ROMAN[lvl]}+ out to`, value: rad, unit: 'km', range: [rad / 1.6, rad * 1.6] });
    }
  }
  const far = zones[zones.length - 1]?.radiusKm ?? 100;
  const series = [{ id: 'mmi', label: 'Intensity vs distance', xLabel: 'Epicentral distance (km)', yLabel: 'MMI', points: Array.from({ length: 60 }, (_, i) => { const d = (far * 1.3 * i) / 59; return [d, Math.max(1, Math.min(12, mmiAt(d)))] as [number, number]; }) }];
  const end = Math.max(120, (far * 1.1) / VS);
  return {
    engine: 'earthquake', engineVersion: QUAKE_VERSION, evidence: 'simulation',
    title: `Mw ${q.magnitude} ${q.fault === 'all' ? '' : `${q.fault} `}earthquake at ${q.depth} km depth`,
    location: { lat: q.lat, lon: q.lon, label: q.label },
    inputs: { magnitude: q.magnitude, depth_km: q.depth, fault: q.fault, lat: q.lat, lon: q.lon },
    steps, outputs, zones: zones.sort((x, y) => y.radiusKm - x.radiusKm), series,
    phases: [
      { id: 'before', label: 'Before rupture', t: -10 }, { id: 'rupture', label: 'Rupture starts', t: 0 },
      { id: 'p', label: `P waves reach ${fmt(far)} km`, t: far / VP }, { id: 's', label: `S waves reach ${fmt(far)} km`, t: far / VS },
    ],
    timeSpan: [-10, end],
    summary: `A hypothetical Mw ${q.magnitude} earthquake at ${q.depth} km depth releases about ${fmt(E)} J of seismic energy on a rupture roughly ${fmt(L)} km long. The model predicts intensity ${ROMAN[Math.max(1, Math.min(12, Math.round(epi)))]} near the epicentre${zones[0] ? ` and shaking of intensity ${zones[0].label.split(' ')[1]} out to about ${fmt(zones[0].radiusKm)} km` : ''}.`,
    assumptions: [
      'Point source at the epicentre; the real rupture extends along the fault, so shaking is elongated along it.',
      'Atkinson & Wald (2007) California coefficients with a near-source term h = max(14 km, depth). Other regions attenuate differently (e.g. stable continents attenuate less).',
      'Wave arrival times use average crustal speeds (P 6 km/s, S 3.5 km/s).',
    ],
    limitations: [
      'No site amplification (soft soils can raise intensity by 1–2 units), no directivity, no aftershocks or secondary hazards (landslides, liquefaction, tsunami).',
      'Intensity radii carry about ±1 MMI unit of scatter, shown as an uncertainty range.',
      'Hypothetical simulation: not a forecast that this earthquake will happen.',
    ],
    references: [
      { id: 'hk1979', label: 'Hanks & Kanamori (1979), A moment magnitude scale, JGR 84', url: 'https://doi.org/10.1029/JB084iB05p02348' },
      { id: 'gr1956', label: 'Gutenberg & Richter (1956), Magnitude and energy of earthquakes, Annali di Geofisica 9', url: 'https://doi.org/10.4401/ag-5590' },
      { id: 'wc1994', label: 'Wells & Coppersmith (1994), New empirical relationships among magnitude, rupture length…, BSSA 84', url: 'https://doi.org/10.1785/BSSA0840040974' },
      { id: 'aw2007', label: 'Atkinson & Wald (2007), "Did You Feel It?" intensity data: a surprisingly good measure of earthquake ground motion, SRL 78', url: 'https://doi.org/10.1785/gssrl.78.3.362' },
    ],
    computedAt: new Date().toISOString(),
  };
}

export const quakeEngine: SimEngine<QuakeInput> = {
  category: 'earthquake', label: 'Earthquake', version: QUAKE_VERSION,
  params: QUAKE_PARAMS, choices: QUAKE_CHOICES, validate: validateQuake, run: runQuake,
};
