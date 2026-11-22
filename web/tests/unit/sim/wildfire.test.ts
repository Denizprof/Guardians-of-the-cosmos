// Wildfire engine: Rothermel against the published Anderson (1982) fuel-model table, plus spread-shape benchmarks
// on synthetic terrain (no network).
import { describe, expect, it } from 'vitest';
import { FUEL_MODELS, emc, headFire, lengthToBreadth, spreadFire, validateWildfire, wildfireResult, type WildfireInput } from '../../../src/sim/wildfire';
import type { Dem } from '../../../src/sim/flood';

const CH_H = 0.3353; // 1 chain per hour in m/min
const FT = 0.3048;
const table = { d1: 0.08, d10: 0.08, d100: 0.08, live: 1.0 }; // Anderson (1982): 8% dead, 100% live, 5 mi/h midflame
const base: WildfireInput = { lat: 0, lon: 0, fuel: '1', hours: 1, windKmh: 0, windFrom: 270, rh: 20, tempC: 30, liveMoisture: 100, waf: 0.4, domainKm: 10 };
const flat = (n: number, dx: number, f: (i: number, j: number) => number = () => 100): Dem => {
  const z = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = f(i, j);
  return { nx: n, ny: n, dx, z, corners: [[0, 1], [1, 1], [1, 0], [0, 0]], source: 'synthetic' };
};

describe('Rothermel surface spread', () => {
  // Anderson (1982), Aids to determining fuel models: rate of spread (ch/h) and flame length (ft)
  const published: [string, number, number][] = [['1', 78, 4], ['2', 35, 6], ['3', 104, 12], ['4', 75, 19], ['5', 18, 4], ['8', 1.6, 1], ['9', 7.5, 2.6], ['10', 7.9, 4.8]];
  it.each(published)('fuel model %s matches the published spread rate and flame length', (id, ros, flame) => {
    const h = headFire(FUEL_MODELS.find((f) => f.id === id)!, table, 5 * 1.609344);
    expect(Math.abs(h.rosMMin / CH_H - ros) / ros).toBeLessThan(0.25);
    expect(Math.abs(h.flameM / FT - flame) / flame).toBeLessThan(0.25);
  });
  it('stops spreading at the moisture of extinction and speeds up when drier', () => {
    const fm = FUEL_MODELS[0];
    expect(headFire(fm, { d1: 0.13, d10: 0.13, d100: 0.13, live: 1 }, 8).rosMMin).toBe(0);
    expect(headFire(fm, { ...table, d1: 0.04 }, 8).rosMMin).toBeGreaterThan(headFire(fm, table, 8).rosMMin);
  });
  it('wind and upslope both speed up the head fire', () => {
    const fm = FUEL_MODELS[0];
    expect(headFire(fm, table, 16).rosMMin).toBeGreaterThan(headFire(fm, table, 8).rosMMin);
    expect(headFire(fm, table, 8, 0.5).rosMMin).toBeGreaterThan(headFire(fm, table, 8, 0).rosMMin);
  });
  it('fire shape is circular with no wind and elongates with wind (Anderson 1983)', () => {
    expect(lengthToBreadth(0)).toBeCloseTo(1, 6);
    expect(lengthToBreadth(10)).toBeGreaterThan(lengthToBreadth(5));
    expect(lengthToBreadth(100)).toBe(8);
  });
  it('equilibrium moisture is drier when hot and dry', () => {
    expect(emc(15, 35)).toBeLessThan(emc(60, 15));
    expect(emc(30, 25)).toBeGreaterThan(2);
  });
});

describe('spread over terrain', () => {
  it('no wind on flat ground: a circle of radius R₀·t', () => {
    const dem = flat(101, 30);
    const raw = spreadFire({ ...base, windKmh: 0, hours: 2 }, dem);
    const r0 = headFire(FUEL_MODELS[0], { d1: Math.max(2, emc(20, 30)) / 100, d10: 0, d100: 0, live: 1 }, 0).rosMMin;
    let burned = 0;
    for (const t of raw.arrival) if (t <= 120) burned++;
    const area = burned * 900;
    const expected = Math.PI * (r0 * 120) ** 2;
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.2);
  });
  it('a west wind pushes the fire east (downwind) much further than west', () => {
    const dem = flat(161, 30);
    const raw = spreadFire({ ...base, windKmh: 20, windFrom: 270, hours: 0.5 }, dem);
    const row = 80 * 161;
    let east = 0, west = 0;
    for (let i = 81; i < 161; i++) if (Number.isFinite(raw.arrival[row + i])) east++;
    for (let i = 79; i >= 0; i--) if (Number.isFinite(raw.arrival[row + i])) west++;
    expect(east).toBeGreaterThan(3 * west);
  });
  it('runs faster upslope, and water stops it', () => {
    // a hill rising to the north; a lake band south of the ignition
    const dem = flat(101, 30, (_i, j) => (j > 60 && j < 70 ? -1 : 100 + (100 - j) * 6));
    const raw = spreadFire({ ...base, windKmh: 0, hours: 1 }, dem);
    const c = 50;
    let up = 0, down = 0;
    for (let j = c - 1; j >= 0; j--) if (Number.isFinite(raw.arrival[j * 101 + c])) up++;
    for (let j = c + 1; j < 101; j++) if (Number.isFinite(raw.arrival[j * 101 + c])) down++;
    expect(up).toBeGreaterThan(down);
    for (let j = 70; j < 101; j++) expect(Number.isFinite(raw.arrival[j * 101 + c])).toBe(false);
  });
  it('packages a labelled result with fire frames and suppression advice', () => {
    const dem = flat(81, 50);
    const inp = { ...base, fuel: '4', windKmh: 25, hours: 1 };
    const r = wildfireResult(inp, dem, spreadFire(inp, dem), 'test weather');
    expect(r.evidence).toBe('simulation');
    expect(r.raster!.kind).toBe('fire');
    expect(r.outputs.find((o) => o.id === 'burned')!.value).toBeGreaterThan(0);
    expect(r.outputs.find((o) => o.id === 'flame')!.alt).toMatch(/crowning|engines|hand crews/);
  });
  it('rejects out-of-range input', () => {
    expect(validateWildfire({ lat: 0, lon: 0, windKmh: 500 }).ok).toBe(false);
    expect(validateWildfire({ lat: 0, lon: 0, fuel: '99' }).ok).toBe(false);
    expect(validateWildfire({ lat: 38, lon: 27 }).ok).toBe(true);
  });
});

describe('weather and question parsing', async () => {
  const { parseSurface, surfaceUrl } = await import('../../../src/sim/wind');
  const { parseSimRequest } = await import('../../../src/sim/parse');
  it('reads Open-Meteo current weather', () => {
    const w = parseSurface({ current: { time: '2026-11-22T13:00', temperature_2m: 31, relative_humidity_2m: 18, wind_speed_10m: 35, wind_direction_10m: 20 } });
    expect(w).toMatchObject({ tempC: 31, rh: 18, windKmh: 35, windFrom: 20 });
    expect(surfaceUrl(38, 27)).toMatch(/relative_humidity_2m/);
    expect(() => parseSurface({})).toThrow();
  });
  it('reads wildfire questions', () => {
    const p = parseSimRequest('What would happen if a wildfire started near Izmir in maquis with a 40 km/h north wind and 15% humidity?')!;
    expect(p.category).toBe('wildfire');
    expect(p.params).toMatchObject({ fuel: '4', windKmh: 40, windFrom: 0, rh: 15, weather: 'manual', lat: 38.4237 });
    expect(parseSimRequest('Simulate a forest fire near Ankara')!.params).toMatchObject({ fuel: '10' });
    expect(parseSimRequest('Simulate a forest fire near Ankara')!.params.weather).toBeUndefined();
    expect(parseSimRequest('How many fires are on the map?')).toBeNull();
  });
});
