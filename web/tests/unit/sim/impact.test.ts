import { describe, expect, it } from 'vitest';
import { effectiveMagnitude, integrateEntry, overpressure, runImpact, validateImpact, type ImpactInput } from '../../../src/sim/impact';
import { runQuake, mmiAW2007 } from '../../../src/sim/earthquake';
import { runSimulation } from '../../../src/sim/registry';
import { parseSimRequest, simFollowUp } from '../../../src/sim/parse';
import { circleRing, haversineKm } from '../../../src/sim/geo';

const MT = 4.184e15;
const base: ImpactInput = { lat: 41, lon: 29, diameter: 500, density: 3000, velocity: 20, angle: 45, target: 'sedimentary', waterDepth: 3000, composition: 'stony' };
const out = (r: ReturnType<typeof runImpact>, id: string) => r.outputs.find((o) => o.id === id)?.value;

describe('impact engine: fundamental equations', () => {
  it('mass and kinetic energy follow m = ρ(4/3)πr³ and E = ½mv²', () => {
    const r = runImpact(base);
    const m = 3000 * (4 / 3) * Math.PI * 250 ** 3;
    expect(r.steps.find((s) => s.id === 'mass')!.value / m).toBeCloseTo(1, 9);
    expect(out(r, 'energy0')! / (0.5 * m * 20000 ** 2)).toBeCloseTo(1, 9);
  });
  it('overpressure matches Collins eq. 54 at the crossover distance', () => {
    expect(overpressure(290, 1)).toBeCloseTo(75000, 0);
    expect(overpressure(1000, 1000)).toBeGreaterThan(overpressure(5000, 1000));
  });
  it('effective magnitude falls with distance', () => {
    expect(effectiveMagnitude(7, 10)).toBeGreaterThan(effectiveMagnitude(7, 500));
  });
});

describe('impact engine: reference cases (order-of-magnitude benchmarks)', () => {
  it('Chelyabinsk 2013 (~19 m stony, 19 km/s, 18°) bursts in the air with ~0.4–0.5 Mt', () => {
    const r = runImpact({ ...base, diameter: 19, density: 3300, velocity: 19, angle: 18 });
    expect(r.zones.find((z) => z.id === 'crater')).toBeUndefined();
    const z = out(r, 'burst')!;
    expect(z).toBeGreaterThan(15); // observed peak brightness ~30 km
    expect(z).toBeLessThan(45);
    expect(out(r, 'energy0')! / MT).toBeGreaterThan(0.3);
    expect(out(r, 'energy0')! / MT).toBeLessThan(0.7);
  });
  it('Meteor Crater (~50 m iron, 12.8 km/s, 45°) gives a ~1 km crater', () => {
    const r = runImpact({ ...base, diameter: 50, density: 8000, velocity: 12.8, angle: 45, composition: 'iron' });
    const d = out(r, 'crater')!;
    expect(d).toBeGreaterThan(0.5); // observed 1.2 km
    expect(d).toBeLessThan(2);
  });
  it('Chicxulub-scale (~10 km, 20 km/s) gives a complex crater of ~100–250 km', () => {
    const r = runImpact({ ...base, diameter: 10000, velocity: 20, angle: 45 });
    const d = out(r, 'crater')!;
    expect(d).toBeGreaterThan(90); // observed ~180 km
    expect(d).toBeLessThan(250);
    expect(r.steps.some((s) => s.id === 'dfr' && s.label.includes('complex'))).toBe(true);
  });
  it('a 1 m body leaves no crater', () => {
    expect(runImpact({ ...base, diameter: 1 }).zones.some((z) => z.id === 'crater')).toBe(false);
  });
  it('ocean impact produces tsunami zones and a wave speed of √(g d)', () => {
    const r = runImpact({ ...base, target: 'water', waterDepth: 4000 });
    expect(r.zones.some((z) => z.id.startsWith('tsunami'))).toBe(true);
    expect(r.steps.find((s) => s.id === 'wavespeed')!.value).toBeCloseTo(Math.sqrt(9.81 * 4000) * 3.6, 3);
  });
  it('a faster impactor gives more energy and a larger crater', () => {
    const a = runImpact({ ...base, velocity: 15 });
    const b = runImpact({ ...base, velocity: 25 });
    expect(out(b, 'energy')!).toBeGreaterThan(out(a, 'energy')!);
    expect(out(b, 'crater')!).toBeGreaterThan(out(a, 'crater')!);
  });
  it('entry velocity never increases', () => {
    const e = integrateEntry(100, 3000, 20000, 45);
    for (let i = 1; i < e.series.length; i++) expect(e.series[i][1]).toBeLessThanOrEqual(e.series[i - 1][1] + 1e-9);
  });
  it('every result is labelled as a hypothetical simulation with references and limitations', () => {
    const r = runImpact(base);
    expect(r.evidence).toBe('simulation');
    expect(r.references.length).toBeGreaterThan(0);
    expect(r.limitations.length).toBeGreaterThan(0);
    expect(r.timeSpan[0]).toBeLessThan(0);
  });
});

describe('validation', () => {
  it('rejects out-of-range parameters with a message', () => {
    expect(validateImpact({ lat: 0, lon: 0, diameter: -5 }).ok).toBe(false);
    expect(runSimulation('impact', { lat: 200, lon: 0 }).ok).toBe(false);
  });
  it('refuses unimplemented categories instead of faking', () => {
    expect(runSimulation('volcano', { lat: 0, lon: 0 }).ok).toBe(false);
  });
});

describe('earthquake engine', () => {
  it('energy and moment follow the standard relations', () => {
    const r = runQuake({ lat: 0, lon: 0, magnitude: 7, depth: 10, fault: 'all' });
    expect(r.steps.find((s) => s.id === 'energy')!.value / 10 ** 15.3).toBeCloseTo(1, 9);
    expect(r.steps.find((s) => s.id === 'moment')!.value / 10 ** 19.6).toBeCloseTo(1, 9);
  });
  it('MMI decreases with distance; bigger quakes shake farther', () => {
    expect(mmiAW2007(7, 10)).toBeGreaterThan(mmiAW2007(7, 100));
    const a = runQuake({ lat: 0, lon: 0, magnitude: 6, depth: 10, fault: 'all' });
    const b = runQuake({ lat: 0, lon: 0, magnitude: 8, depth: 10, fault: 'all' });
    expect(b.zones[0].radiusKm).toBeGreaterThan(a.zones[0].radiusKm);
  });
});

describe('natural-language parsing for the assistant', () => {
  it('reads the flagship question', () => {
    const p = parseSimRequest('What would happen if a 500-meter asteroid hit Istanbul at 20 km/s?')!;
    expect(p.category).toBe('impact');
    expect(p.params).toMatchObject({ diameter: 500, velocity: 20, lat: 41.0082 });
    expect(p.placeName).toBe('Istanbul');
  });
  it('reads km diameters, ocean targets and Turkish', () => {
    expect(parseSimRequest('What if a 1 km asteroid hit the Pacific Ocean at 25 km/s')!.params).toMatchObject({ diameter: 1000, velocity: 25, target: 'water' });
    expect(parseSimRequest("Ankara'ya 300 metrelik bir asteroit çarparsa ne olur?")!.params).toMatchObject({ diameter: 300, lat: 39.9334 });
  });
  it('reads an earthquake scenario', () => {
    expect(parseSimRequest('What if a magnitude 7.5 earthquake hit Tokyo at 20 km depth?')!.params).toMatchObject({ magnitude: 7.5, depth: 20, lat: 35.6762 });
  });
  it('reads flood scenarios', () => {
    expect(parseSimRequest('What would happen if 100 mm of rain fell on Istanbul in 2 hours?')!).toMatchObject({ category: 'flood', params: { rainfall: 50, duration: 2, lat: 41.0082 } });
    expect(parseSimRequest('What if sea level rose 2 m in Lagos?')!.params).toMatchObject({ seaLevel: 2, rainfall: 0 });
    expect(parseSimRequest('What if it rained 40 mm/h for 3 hours in Tokyo')!.params).toMatchObject({ rainfall: 40, duration: 3 });
  });
  it('reads tsunami scenarios and picks a trench source', () => {
    const p = parseSimRequest('What would happen if a magnitude 9 earthquake caused a tsunami near Tokyo?')!;
    expect(p.category).toBe('tsunami');
    expect(p.params).toMatchObject({ magnitude: 9, lat: 38.3, lon: 142.4, strike: 193 });
    expect(p.placeName).toMatch(/Japan Trench.*Tokyo/);
    expect(parseSimRequest('Simulate a tsunami from Cascadia')!.params).toMatchObject({ lat: 46, lon: -125 });
    expect(parseSimRequest('What if a tsunami came from the Hellenic arc?')!.placeName).toMatch(/365 AD/);
  });
  it('reads climate questions and keeps the sea-level what-if as a flood', () => {
    const p = parseSimRequest('How warm will Istanbul be in 2080 under high emissions?')!;
    expect(p.category).toBe('climate');
    expect(p.params).toMatchObject({ year: 2080, scenario: 'ssp585', lat: 41.0082 });
    expect(parseSimRequest('What will rainfall do in Lagos by 2060 under SSP1-2.6?')!.params).toMatchObject({ year: 2060, scenario: 'ssp126', map: 'precip' });
    expect(parseSimRequest('Explain climate change in 2100 for Tokyo')!.category).toBe('climate');
    expect(parseSimRequest('What if sea level rose 2 m in Lagos?')!.category).toBe('flood');
    expect(parseSimRequest('What is the temperature today?')).toBeNull();
  });
  it('ignores ordinary questions', () => {
    expect(parseSimRequest('What is SAR?')).toBeNull();
    expect(parseSimRequest('earthquakes in Japan')).toBeNull();
    expect(parseSimRequest('show the flood investigation')).toBeNull();
    expect(simFollowUp('compare the scenarios')).toBe('compare');
    expect(simFollowUp('explain the simulation')).toBe('explain');
  });
});

describe('geodesy', () => {
  it('circle ring points sit at the requested distance', () => {
    for (const [lon, lat] of circleRing(41, 29, 100, 16)) expect(haversineKm(41, 29, lat, lon)).toBeCloseTo(100, 3);
  });
});
