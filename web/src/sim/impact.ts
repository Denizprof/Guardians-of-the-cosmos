// Asteroid / meteor impact engine.
//
// Model: Collins, Melosh & Marcus (2005), "Earth Impact Effects Program", Meteoritics & Planetary Science 40(6),
// with the atmospheric entry integrated numerically (drag + "pancake" spreading after break-up) instead of the
// paper's closed-form approximation, so the altitude/velocity history can be charted. Every number in the result
// comes from an equation listed in `steps`. This is a scientifically defensible first-order model, not a hydrocode.
import { fmt, readParams, solveDecreasing } from './validate';
import type { CalcStep, ChoiceSpec, ParamSpec, SimEngine, SimOutput, SimPhase, SimResult, SimSeries, SimZone, Validated } from './types';

export const IMPACT_VERSION = '1.0.0';

const G = 9.81; // m/s²
const CD = 2; // drag coefficient
const H = 8000; // atmospheric scale height, m
const RHO0 = 1; // surface air density, kg/m³ (Collins et al. 2005)
const FP = 7; // pancake factor: airburst when diameter reaches FP × L0
const Z0 = 100e3; // start of integration, m
const DC = 3200; // simple-to-complex crater transition diameter on Earth, m
const RHO_W = 1000; // water density
const KT = 4.184e12; // J per kiloton TNT
const MT = 4.184e15; // J per megaton TNT
const SOUND = 0.34; // km/s, blast-front speed used for timing (far field)
const SEISMIC = 5; // km/s, surface-wave timing (approximate)

export type Target = 'sedimentary' | 'crystalline' | 'water';
export type Composition = 'stony' | 'iron' | 'comet' | 'custom';

export const COMPOSITION_DENSITY: Record<Exclude<Composition, 'custom'>, number> = { stony: 3000, iron: 8000, comet: 1000 };
const TARGET_DENSITY: Record<Target, number> = { sedimentary: 2500, crystalline: 2750, water: 2700 }; // water: seafloor rock

export interface ImpactInput {
  lat: number;
  lon: number;
  label?: string;
  diameter: number; // m
  density: number; // kg/m³
  velocity: number; // km/s at top of atmosphere
  angle: number; // degrees from horizontal
  target: Target;
  waterDepth: number; // m, used when target = water
  composition: Composition;
}

export const IMPACT_PARAMS: ParamSpec[] = [
  { key: 'diameter', label: 'Diameter', unit: 'm', min: 1, max: 20000, step: 1, default: 500, help: 'Size of the body before it enters the atmosphere.' },
  { key: 'density', label: 'Density', unit: 'kg/m³', min: 500, max: 8000, step: 50, default: 3000, help: 'Comet ≈ 1000, stony ≈ 3000, iron ≈ 8000.' },
  { key: 'velocity', label: 'Velocity', unit: 'km/s', min: 11, max: 72, step: 0.5, default: 20, help: 'Entry speed. Earth-crossing asteroids: about 11–72 km/s, typically ~20.' },
  { key: 'angle', label: 'Impact angle', unit: '° from horizontal', min: 5, max: 90, step: 1, default: 45, help: '45° is the most probable angle.' },
  { key: 'waterDepth', label: 'Water depth', unit: 'm', min: 10, max: 11000, step: 10, default: 3000, help: 'Used only for an ocean impact.' },
];

export const IMPACT_CHOICES: ChoiceSpec[] = [
  { key: 'composition', label: 'Composition', default: 'stony', options: [
    { value: 'stony', label: 'Stony (3000 kg/m³)' }, { value: 'iron', label: 'Iron (8000 kg/m³)' }, { value: 'comet', label: 'Cometary ice (1000 kg/m³)' }, { value: 'custom', label: 'Custom density' },
  ] },
  { key: 'target', label: 'Target', default: 'sedimentary', options: [
    { value: 'sedimentary', label: 'Land: sedimentary rock' }, { value: 'crystalline', label: 'Land: crystalline rock' }, { value: 'water', label: 'Ocean' },
  ] },
];

export const IMPACT_REFS = [
  { id: 'collins2005', label: 'Collins, Melosh & Marcus (2005), Earth Impact Effects Program, Meteoritics & Planetary Science 40:817–840', url: 'https://doi.org/10.1111/j.1945-5100.2005.tb00157.x' },
  { id: 'chyba1993', label: 'Chyba, Thomas & Zahnle (1993), The 1908 Tunguska explosion: atmospheric disruption of a stony asteroid, Nature 361', url: 'https://doi.org/10.1038/361040a0' },
  { id: 'glasstone1977', label: 'Glasstone & Dolan (1977), The Effects of Nuclear Weapons, 3rd ed. (overpressure and thermal damage thresholds)', url: 'https://www.osti.gov/biblio/6852629' },
  { id: 'ward2000', label: 'Ward & Asphaug (2000), Asteroid impact tsunami: a probabilistic hazard assessment, Icarus 145', url: 'https://doi.org/10.1006/icar.1999.6336' },
];

interface EntryResult {
  airburst: boolean;
  breakupAltitude: number | null; // m
  burstAltitude: number | null; // m
  vFinal: number; // m/s at burst or ground
  entryTime: number; // s from Z0 to burst/ground
  strength: number; // Pa
  series: [number, number][]; // [altitude km, velocity km/s]
  timeline: [number, number, number][]; // [t s from Z0, altitude km, velocity km/s]
  stopped: boolean; // decelerated to near-terminal speed (negligible effects)
}

/** Numerically integrate entry: dv/dt = -3 ρa C_D v² L² / (4 ρi L0³); after break-up d²L/dt² = C_D ρa v² / (ρi L). */
export function integrateEntry(L0: number, rhoI: number, v0: number, thetaDeg: number): EntryResult {
  const sinT = Math.sin((thetaDeg * Math.PI) / 180);
  const Yi = 10 ** (2.107 + 0.0624 * Math.sqrt(rhoI)); // yield strength, Pa (Collins eq. 10)
  let z = Z0;
  let v = v0;
  let L = L0;
  let dL = 0;
  let t = 0;
  let broken = false;
  let breakup: number | null = null;
  const series: [number, number][] = [[z / 1000, v / 1000]];
  const timeline: [number, number, number][] = [[0, z / 1000, v / 1000]];
  const dt = Math.min(0.002, (0.05 * L0) / v0 + 1e-4);
  let n = 0;
  while (z > 0) {
    const rhoA = RHO0 * Math.exp(-z / H);
    if (!broken && rhoA * v * v > Yi) { broken = true; breakup = z; }
    const a = (-3 * rhoA * CD * v * v * L * L) / (4 * rhoI * L0 ** 3);
    if (broken) {
      dL += ((CD * rhoA * v * v) / (rhoI * L)) * dt;
      L += dL * dt;
    }
    v += a * dt;
    z -= v * sinT * dt;
    t += dt;
    if (++n % 250 === 0) { series.push([Math.max(0, z) / 1000, v / 1000]); timeline.push([t, Math.max(0, z) / 1000, v / 1000]); }
    if (broken && L >= FP * L0) {
      series.push([z / 1000, v / 1000]);
      timeline.push([t, z / 1000, v / 1000]);
      return { airburst: true, breakupAltitude: breakup, burstAltitude: z, vFinal: v, entryTime: t, strength: Yi, series, timeline, stopped: false };
    }
    if (v < 100) return { airburst: false, breakupAltitude: breakup, burstAltitude: null, vFinal: v, entryTime: t, strength: Yi, series, timeline, stopped: true };
    if (t > 3600) break;
  }
  series.push([0, v / 1000]);
  timeline.push([t, 0, v / 1000]);
  return { airburst: false, breakupAltitude: breakup, burstAltitude: null, vFinal: v, entryTime: t, strength: Yi, series, timeline, stopped: false };
}

/** Peak overpressure (Pa) of a surface burst at distance r (m) for energy in kt (Collins eq. 54). */
export function overpressure(rM: number, eKt: number): number {
  const r1 = rM / Math.cbrt(eKt);
  const px = 75000;
  const rx = 290;
  return ((px * rx) / (4 * r1)) * (1 + 3 * (rx / r1) ** 1.3);
}

/** Effective seismic magnitude felt at distance r km (Collins eqs. 58–60). */
export function effectiveMagnitude(M: number, rKm: number): number {
  if (rKm < 60) return M - 0.0238 * rKm;
  if (rKm < 700) return M - 0.0048 * rKm - 1.1644;
  const deltaDeg = rKm / 111.2;
  return M - 1.66 * Math.log10(deltaDeg) - 6.399;
}

export function validateImpact(raw: Record<string, unknown>): Validated<ImpactInput> {
  const { values, picks, issues } = readParams(raw, IMPACT_PARAMS, IMPACT_CHOICES);
  if (issues.length) return { ok: false, issues };
  const composition = picks.composition as Composition;
  const density = composition === 'custom' ? values.density : COMPOSITION_DENSITY[composition];
  return {
    ok: true,
    value: {
      lat: Number(raw.lat), lon: Number(raw.lon), label: typeof raw.label === 'string' ? raw.label : undefined,
      diameter: values.diameter, density, velocity: values.velocity, angle: values.angle,
      target: picks.target as Target, waterDepth: values.waterDepth, composition,
    },
  };
}

const mt = (j: number): string => `≈ ${fmt(j / MT)} Mt TNT`;

export function runImpact(inp: ImpactInput): SimResult {
  const steps: CalcStep[] = [];
  const outputs: SimOutput[] = [];
  const zones: SimZone[] = [];
  const series: SimSeries[] = [];
  const assumptions: string[] = [
    'Spherical, non-rotating projectile entering a flat, exponential atmosphere (scale height 8 km, surface density 1 kg/m³, drag coefficient 2).',
    'No ablation (mass loss) during entry; after break-up the fragments spread as one "pancake" until 7× the initial diameter (airburst criterion of Collins et al. 2005).',
    'Projectile yield strength from density: Y = 10^(2.107 + 0.0624 √ρ) Pa.',
    'Blast-front arrival times use the speed of sound (340 m/s); near ground zero the real front is faster (supersonic).',
  ];
  const limitations: string[] = [
    'First-order scaling model (±factor of ~2 on most radii, larger for thresholds). It is not a hydrocode simulation and ignores local terrain, buildings and weather.',
    'Results are a hypothetical simulation. No observation, NASA or ISRO data is used to produce them.',
    'Population and casualty estimates are deliberately not computed: the app has no validated exposure dataset.',
  ];

  const r = inp.diameter / 2;
  const v0 = inp.velocity * 1000;
  const m = inp.density * (4 / 3) * Math.PI * r ** 3;
  steps.push({ id: 'mass', label: 'Projectile mass', equation: 'm = ρ · (4/3) π r³', substituted: `m = ${inp.density} · (4/3) π · ${fmt(r)}³`, value: m, unit: 'kg', ref: 'collins2005' });
  const E0 = 0.5 * m * v0 * v0;
  steps.push({ id: 'ke', label: 'Kinetic energy at entry', equation: 'E = ½ m v²', substituted: `E = ½ · ${fmt(m)} · (${fmt(v0)})²`, value: E0, unit: 'J', note: mt(E0), ref: 'collins2005' });
  outputs.push({ id: 'energy0', label: 'Kinetic energy at entry', value: E0, unit: 'J', alt: mt(E0) });

  const entry = integrateEntry(inp.diameter, inp.density, v0, inp.angle);
  series.push({ id: 'entry', label: 'Atmospheric entry: velocity vs altitude', xLabel: 'Altitude (km)', yLabel: 'Velocity (km/s)', points: entry.series });
  series.push({ id: 'altitude', label: 'Altitude vs time before impact', xLabel: 'Time (s, 0 = impact/burst)', yLabel: 'Altitude (km)', points: entry.timeline.map(([t, z]) => [t - entry.entryTime, z]) });
  series.push({ id: 'velocity', label: 'Velocity vs time before impact', xLabel: 'Time (s, 0 = impact/burst)', yLabel: 'Velocity (km/s)', points: entry.timeline.map(([t, , v]) => [t - entry.entryTime, v]) });
  steps.push({ id: 'strength', label: 'Projectile yield strength', equation: 'Y = 10^(2.107 + 0.0624 √ρ)', substituted: `Y = 10^(2.107 + 0.0624 √${inp.density})`, value: entry.strength, unit: 'Pa', ref: 'collins2005' });
  if (entry.breakupAltitude !== null) {
    steps.push({ id: 'breakup', label: 'Break-up altitude (ram pressure ρₐv² exceeds Y)', equation: 'ρₐ(z) v² = Y,  ρₐ(z) = ρ₀ e^(−z/H)', value: entry.breakupAltitude / 1000, unit: 'km', ref: 'collins2005' });
  }
  const phases: SimPhase[] = [
    { id: 'before', label: 'Before entry', t: -entry.entryTime - 5 },
    { id: 'entry', label: 'Atmospheric entry (100 km)', t: -entry.entryTime },
  ];

  if (entry.stopped) {
    const Ef = 0.5 * m * entry.vFinal ** 2;
    outputs.push({ id: 'vfinal', label: 'Speed when decelerated', value: entry.vFinal / 1000, unit: 'km/s' });
    return finish(inp, 'Decelerated in the atmosphere', steps, outputs, zones, series, phases, [-(entry.entryTime + 5), 60], assumptions, limitations,
      `A ${fmt(inp.diameter)} m body at ${inp.velocity} km/s is slowed to below 100 m/s by air drag before reaching the ground. Its remaining energy (${fmt(Ef)} J) is negligible: it would land as meteorites, without a crater or blast.`);
  }

  const vI = entry.vFinal;
  const Ei = 0.5 * m * vI * vI;
  const eKt = Ei / KT;
  steps.push({ id: 'vimpact', label: entry.airburst ? 'Velocity at airburst' : 'Velocity at the surface', equation: 'dv/dt = −3 ρₐ C_D v² L² / (4 ρᵢ L₀³) (integrated numerically)', value: vI / 1000, unit: 'km/s', ref: 'collins2005' });
  steps.push({ id: 'eimpact', label: entry.airburst ? 'Energy released in the airburst' : 'Energy delivered at impact', equation: 'Eᵢ = ½ m vᵢ²', substituted: `Eᵢ = ½ · ${fmt(m)} · (${fmt(vI)})²`, value: Ei, unit: 'J', note: mt(Ei), ref: 'collins2005' });
  outputs.push({ id: 'energy', label: entry.airburst ? 'Airburst energy' : 'Impact energy', value: Ei, unit: 'J', alt: mt(Ei) });
  outputs.push({ id: 'vi', label: entry.airburst ? 'Velocity at burst' : 'Impact velocity', value: vI / 1000, unit: 'km/s' });
  phases.push({ id: 'impact', label: entry.airburst ? 'Airburst' : 'Impact', t: 0 }, { id: 'min', label: '+1 minute', t: 60 }, { id: 'hour', label: '+1 hour', t: 3600 });

  // ---- airblast: radii of peak-overpressure thresholds
  const burstZ = entry.airburst ? entry.burstAltitude ?? 0 : 0;
  if (entry.airburst) {
    steps.push({ id: 'burstz', label: 'Airburst altitude (debris cloud reaches 7 L₀)', equation: 'L(z_b) = f_p L₀,  f_p = 7', value: burstZ / 1000, unit: 'km', ref: 'collins2005' });
    outputs.push({ id: 'burst', label: 'Airburst altitude', value: burstZ / 1000, unit: 'km' });
    assumptions.push('Airburst overpressure uses the surface-burst relation evaluated at the slant range √(r² + z_b²): a simplification of the Mach-reflection treatment in Collins et al.');
  }
  const pAt = (groundKm: number): number => overpressure(Math.hypot(groundKm * 1000, burstZ), eKt);
  const blast: [string, number, 0 | 1 | 2 | 3, string][] = [
    ['blast-20psi', 138e3, 3, '138 kPa (20 psi): reinforced concrete buildings severely damaged'],
    ['blast-5psi', 34.5e3, 2, '34.5 kPa (5 psi): most residential buildings collapse'],
    ['blast-1psi', 6.9e3, 1, '6.9 kPa (1 psi): windows shatter, light damage'],
  ];
  steps.push({ id: 'overpressure', label: 'Peak overpressure vs distance', equation: 'p(r) = (pₓ rₓ / 4r₁)(1 + 3 (rₓ/r₁)^1.3),  r₁ = r / E_kt^(1/3),  pₓ = 75 kPa, rₓ = 290 m', value: eKt, unit: 'kt TNT (E used)', ref: 'collins2005' });
  for (const [id, p, sev, label] of blast) {
    const rad = solveDecreasing(pAt, p, 1e-3, 20000);
    if (rad !== null && rad > 1e-3) {
      zones.push({ id, label: `Airblast ≥ ${label.split(':')[0]}`, radiusKm: rad, frontKmS: SOUND, severity: sev, threshold: label });
      outputs.push({ id, label: `Radius of ${label.split(':')[0]} overpressure`, value: rad, unit: 'km', range: [rad / 1.5, rad * 1.5] });
    }
  }

  // ---- thermal radiation (ground impacts at ≥ 15 km/s produce a vapour fireball; Collins §6)
  if (!entry.airburst && vI >= 15000) {
    const Rf = 0.002 * Math.cbrt(Ei); // m
    steps.push({ id: 'fireball', label: 'Fireball radius', equation: 'R_f = 0.002 Eᵢ^(1/3)', value: Rf / 1000, unit: 'km', ref: 'collins2005' });
    const eta = 3e-3;
    const horizonKm = (Math.sqrt((2 * Rf) / 6371e3) * 6371e3) / 1000;
    const eMt = Ei / MT;
    const thermal: [string, number, 0 | 1 | 2 | 3, string][] = [
      ['thermal-3rd', 3.35e5, 2, 'third-degree burns (8 cal/cm² at 1 Mt)'],
      ['thermal-2nd', 2.1e5, 1, 'second-degree burns (5 cal/cm² at 1 Mt)'],
    ];
    steps.push({ id: 'thermal', label: 'Thermal exposure vs distance', equation: 'Φ(r) = η Eᵢ / (2π r²),  η = 3×10⁻³; thresholds scale as E_Mt^(1/6)', value: eta * Ei, unit: 'J radiated', ref: 'collins2005' });
    for (const [id, phi1, sev, label] of thermal) {
      const thr = phi1 * eMt ** (1 / 6);
      const rad = Math.min(Math.sqrt((eta * Ei) / (2 * Math.PI * thr)) / 1000, horizonKm);
      if (rad * 1000 > Rf) {
        zones.push({ id, label: `Thermal: ${label.split(' (')[0]}`, radiusKm: rad, frontKmS: null, severity: sev, threshold: label });
        outputs.push({ id, label: `Radius of ${label.split(' (')[0]}`, value: rad, unit: 'km', range: [rad / 1.5, rad * 1.5] });
      }
    }
    outputs.push({ id: 'fireball', label: 'Fireball radius', value: Rf / 1000, unit: 'km' });
  } else {
    limitations.push(entry.airburst ? 'Thermal radiation from an airburst is not modelled.' : 'Impact speed below 15 km/s: no vapour fireball is modelled (Collins et al. 2005).');
  }

  if (entry.airburst) {
    return finish(inp, 'Airburst', steps, outputs, zones, series, phases, [-(entry.entryTime + 5), 3600], assumptions, limitations,
      `The ${fmt(inp.diameter)} m body breaks up ${fmt((entry.breakupAltitude ?? 0) / 1000)} km up and explodes as an airburst at about ${fmt(burstZ / 1000)} km altitude, releasing ${mt(Ei)}. No crater forms. ${zoneSentence(zones)}`);
  }

  // ---- crater
  const sinT = Math.sin((inp.angle * Math.PI) / 180);
  let vFloor = vI;
  const isWater = inp.target === 'water';
  if (isWater) {
    const Dtcw = 1.365 * (inp.density / RHO_W) ** (1 / 3) * inp.diameter ** 0.78 * vI ** 0.44 * G ** -0.22 * sinT ** (1 / 3);
    steps.push({ id: 'watercavity', label: 'Transient cavity in the water', equation: 'D_tc,w = 1.365 (ρᵢ/ρ_w)^(1/3) L^0.78 vᵢ^0.44 g^−0.22 sin^(1/3)θ', value: Dtcw / 1000, unit: 'km', ref: 'collins2005' });
    vFloor = vI * Math.exp((-3 * RHO_W * CD * inp.waterDepth) / (2 * inp.density * inp.diameter * sinT));
    steps.push({ id: 'vfloor', label: 'Velocity at the seafloor', equation: 'v_sf = vᵢ exp(−3 ρ_w C_D d_w / (2 ρᵢ L sinθ))', value: vFloor / 1000, unit: 'km/s', ref: 'collins2005' });
    const Amax = Math.min(Dtcw / 14.1, inp.waterDepth);
    const Rc = Dtcw / 2;
    steps.push({ id: 'wave', label: 'Wave amplitude at the cavity rim', equation: 'A_max = min(D_tc,w / 14.1, d_w);  A(r) ≈ A_max (R_c / r)', value: Amax, unit: 'm', ref: 'collins2005' });
    const c = Math.sqrt(G * inp.waterDepth) / 1000; // km/s, shallow-water wave speed
    steps.push({ id: 'wavespeed', label: 'Tsunami propagation speed', equation: 'c = √(g d_w)', value: c * 3600, unit: 'km/h', ref: 'ward2000' });
    for (const [id, a, sev] of [['tsunami-10m', 10, 3], ['tsunami-1m', 1, 1]] as const) {
      if (Amax >= a) {
        const rad = (Amax * Rc) / a / 1000;
        zones.push({ id, label: `Open-ocean wave ≥ ${a} m`, radiusKm: rad, frontKmS: c, severity: sev, threshold: `Amplitude ${a} m in deep water (not coastal run-up)` });
        outputs.push({ id, label: `Distance where the wave is still ≥ ${a} m`, value: rad, unit: 'km', range: [rad / 3, rad * 2] });
        phases.push({ id: `arrive-${id}`, label: `Wave reaches ${fmt(rad)} km`, t: rad / c });
      }
    }
    outputs.push({ id: 'wavemax', label: 'Wave amplitude at cavity rim', value: Amax, unit: 'm' });
    limitations.push('Tsunami amplitudes use 1/r decay in uniform-depth water. Real waves depend on bathymetry and coastline; coastal run-up (often 2–5× the open-ocean amplitude) and inundation are not computed.');
  }

  const crateringV = isWater ? vFloor : vI;
  if (!isWater || vFloor > 1000) {
    const rhoT = TARGET_DENSITY[inp.target];
    const Dtc = 1.161 * (inp.density / rhoT) ** (1 / 3) * inp.diameter ** 0.78 * crateringV ** 0.44 * G ** -0.22 * sinT ** (1 / 3);
    steps.push({ id: 'dtc', label: 'Transient crater diameter', equation: 'D_tc = 1.161 (ρᵢ/ρ_t)^(1/3) L^0.78 vᵢ^0.44 g^−0.22 sin^(1/3)θ', substituted: `D_tc = 1.161 (${inp.density}/${rhoT})^(1/3) · ${inp.diameter}^0.78 · ${fmt(crateringV)}^0.44 · 9.81^−0.22 · sin^(1/3)${inp.angle}°`, value: Dtc / 1000, unit: 'km', ref: 'collins2005' });
    const simple = 1.25 * Dtc < DC;
    const Dfr = simple ? 1.25 * Dtc : (1.17 * Dtc ** 1.13) / DC ** 0.13;
    steps.push({ id: 'dfr', label: simple ? 'Final crater diameter (simple crater)' : 'Final crater diameter (complex crater)', equation: simple ? 'D_fr = 1.25 D_tc' : 'D_fr = 1.17 D_tc^1.13 / D_c^0.13,  D_c = 3.2 km', value: Dfr / 1000, unit: 'km', ref: 'collins2005' });
    const depth = simple ? Dtc / (2 * Math.SQRT2) : 400 * (Dfr / 1000) ** 0.3; // m
    steps.push({ id: 'depth', label: simple ? 'Transient crater depth' : 'Final crater depth', equation: simple ? 'd_tc = D_tc / 2√2' : 'd_fr = 0.4 D_fr^0.3  (km)', value: depth / 1000, unit: 'km', ref: 'collins2005' });
    outputs.push({ id: 'crater', label: 'Final crater diameter', value: Dfr / 1000, unit: 'km', range: [Dfr / 1300, Dfr / 770] });
    outputs.push({ id: 'depth', label: 'Crater depth', value: depth / 1000, unit: 'km' });
    zones.push({ id: 'crater', label: `${isWater ? 'Seafloor crater' : 'Crater'} (${simple ? 'simple' : 'complex'})`, radiusKm: Dfr / 2000, frontKmS: null, severity: 3, threshold: 'Ground excavated or collapsed' });
    // ejecta blanket ≥ 10 cm: t_e = D_tc⁴ / (112 r³)
    const rEj = Math.cbrt(Dtc ** 4 / (112 * 0.1)) / 1000;
    steps.push({ id: 'ejecta', label: 'Ejecta thickness vs distance', equation: 't_e(r) = D_tc⁴ / (112 r³)', value: rEj, unit: 'km (where t_e = 10 cm)', ref: 'collins2005' });
    if (rEj > Dfr / 2000) {
      // ballistic flight time over the range at 45°: t = √(2 r / g)
      zones.push({ id: 'ejecta', label: 'Ejecta deposit ≥ 10 cm', radiusKm: rEj, frontKmS: (rEj * 1000) / Math.sqrt((2 * rEj * 1000) / G) / 1000, severity: 2, threshold: 'Ejecta blanket at least 10 cm thick' });
      outputs.push({ id: 'ejecta', label: 'Ejecta ≥ 10 cm out to', value: rEj, unit: 'km' });
    }
  } else {
    limitations.push('The projectile is stopped by the water column before reaching the seafloor: no seafloor crater.');
  }

  // ---- seismic
  const Ms = 0.67 * Math.log10(Ei) - 5.87;
  steps.push({ id: 'seismic', label: 'Equivalent seismic magnitude', equation: 'M = 0.67 log₁₀(Eᵢ) − 5.87  (seismic efficiency 10⁻⁴)', value: Ms, unit: 'Richter', ref: 'collins2005' });
  outputs.push({ id: 'magnitude', label: 'Equivalent earthquake magnitude', value: Ms, unit: 'M', range: [Ms - 0.5, Ms + 0.5] });
  for (const [id, mEff, sev] of [['shake-strong', 6, 2], ['shake-felt', 4, 0]] as const) {
    const rad = solveDecreasing((rk) => effectiveMagnitude(Ms, rk), mEff, 0.01, 20000);
    if (rad !== null && rad > 0.01) {
      zones.push({ id, label: `Ground shaking ≈ M${mEff}+ equivalent`, radiusKm: rad, frontKmS: SEISMIC, severity: sev, threshold: `Effective magnitude ≥ ${mEff} at this distance` });
      outputs.push({ id, label: `Shaking like an M${mEff}+ earthquake out to`, value: rad, unit: 'km' });
    }
  }
  phases.push({ id: 'day', label: '+1 day', t: 86400 });

  return finish(inp, isWater ? 'Ocean impact' : 'Ground impact', steps, outputs, zones, series, phases, [-(entry.entryTime + 5), isWater ? 86400 : 3600 * 3], assumptions, limitations,
    `The ${fmt(inp.diameter)} m body reaches the ${isWater ? 'ocean' : 'ground'} at ${fmt(vI / 1000)} km/s and delivers ${mt(Ei)}. ${outputs.find((o) => o.id === 'crater') ? `It leaves a crater about ${fmt(outputs.find((o) => o.id === 'crater')!.value)} km across. ` : ''}${zoneSentence(zones)}`);
}

function zoneSentence(zones: SimZone[]): string {
  const big = [...zones].sort((a, b) => b.radiusKm - a.radiusKm)[0];
  return big ? `The widest modelled effect, "${big.label}", reaches about ${fmt(big.radiusKm)} km from ground zero.` : '';
}

function finish(
  inp: ImpactInput, kind: string, steps: CalcStep[], outputs: SimOutput[], zones: SimZone[], series: SimSeries[], phases: SimPhase[],
  timeSpan: [number, number], assumptions: string[], limitations: string[], summary: string,
): SimResult {
  return {
    engine: 'impact', engineVersion: IMPACT_VERSION, evidence: 'simulation',
    title: `${kind}: ${fmt(inp.diameter)} m ${inp.composition} body at ${inp.velocity} km/s, ${inp.angle}°`,
    location: { lat: inp.lat, lon: inp.lon, label: inp.label },
    inputs: { diameter_m: inp.diameter, density_kg_m3: inp.density, velocity_km_s: inp.velocity, angle_deg: inp.angle, target: inp.target, water_depth_m: inp.target === 'water' ? inp.waterDepth : 0, composition: inp.composition, lat: inp.lat, lon: inp.lon },
    steps, outputs, zones: zones.sort((a, b) => b.radiusKm - a.radiusKm), series,
    phases: phases.filter((p) => p.t >= timeSpan[0] && p.t <= timeSpan[1]).sort((a, b) => a.t - b.t),
    timeSpan, summary, assumptions, limitations, references: IMPACT_REFS, computedAt: new Date().toISOString(),
  };
}

export const impactEngine: SimEngine<ImpactInput> = {
  category: 'impact', label: 'Asteroid / meteor impact', version: IMPACT_VERSION,
  params: IMPACT_PARAMS, choices: IMPACT_CHOICES, validate: validateImpact, run: runImpact,
};
