// Climate engine: checks against the observed record and IPCC AR6 assessed values, sanity checks of the patterns,
// and the validation and packaging of a run (no network).
import { describe, expect, it } from 'vitest';
import { WORLD_N, buildPatterns, climateResult, crossingYear, forcing, localFactors, meanOver, runEbm, validateClimate, worldLat, type ClimateInput } from '../../../src/sim/climate';
import { landMaskFrom, runClimateScenario } from '../../../src/sim/climateRun';
import { runAsync } from '../../../src/sim/registry';
import type { Dem } from '../../../src/sim/flood';

const base: ClimateInput = { lat: 41, lon: 29, scenario: 'ssp245', map: 'warming', year: 2100, ecs: 3, extra: 0 };
const T = (ssp: ClimateInput['scenario'], ecs = 3) => meanOver(runEbm(ecs, ssp), 'T', 2081, 2100);
const SLR = (ssp: ClimateInput['scenario']) => runEbm(3, ssp).gmsl[2100 - 1750];

describe('the energy-balance model against the observed record (AR6)', () => {
  it('reproduces observed warming: 1995–2014 ≈ 0.85 °C and 2011–2020 ≈ 1.09 °C above 1850–1900', () => {
    const t = runEbm(3, 'ssp245');
    expect(meanOver(t, 'T', 1995, 2014)).toBeGreaterThan(0.7);
    expect(meanOver(t, 'T', 1995, 2014)).toBeLessThan(1.0);
    expect(meanOver(t, 'T', 2011, 2020)).toBeGreaterThan(0.95);
    expect(meanOver(t, 'T', 2011, 2020)).toBeLessThan(1.25);
  });
  it('ocean heat uptake in the 2010s is about 0.6–1 W/m² (observed about 0.7)', () => {
    const t = runEbm(3, 'ssp245');
    const n = t.N.slice(256, 269).reduce((a, x) => a + x, 0) / 13;
    expect(n).toBeGreaterThan(0.55);
    expect(n).toBeLessThan(1.05);
  });
  it('observed sea level: about 0.20 m rise 1901–2018 and about 3.7 mm/yr in 2006–2018', () => {
    const t = runEbm(3, 'ssp245');
    const rise = t.gmsl[2018 - 1750] - t.gmsl[1901 - 1750];
    expect(rise).toBeGreaterThan(0.15);
    expect(rise).toBeLessThan(0.25);
    const rate = ((t.gmsl[2018 - 1750] - t.gmsl[2006 - 1750]) / 12) * 1000;
    expect(rate).toBeGreaterThan(3.2);
    expect(rate).toBeLessThan(4.3);
  });
});

describe('projections against IPCC AR6 assessed ranges', () => {
  // AR6 2081–2100 warming vs 1850–1900, very likely ranges
  it.each([['ssp126', 1.3, 2.4], ['ssp245', 2.1, 3.5], ['ssp370', 2.8, 4.6], ['ssp585', 3.3, 5.7]] as const)('%s warming is inside the AR6 very likely range', (ssp, lo, hi) => {
    expect(T(ssp)).toBeGreaterThanOrEqual(lo);
    expect(T(ssp)).toBeLessThanOrEqual(hi);
  });
  // AR6 2100 sea-level rise vs 1995–2014, likely ranges
  it.each([['ssp126', 0.32, 0.62], ['ssp245', 0.44, 0.76], ['ssp370', 0.55, 0.9], ['ssp585', 0.63, 1.01]] as const)('%s sea level is inside the AR6 likely range', (ssp, lo, hi) => {
    expect(SLR(ssp)).toBeGreaterThanOrEqual(lo);
    expect(SLR(ssp)).toBeLessThanOrEqual(hi);
  });
  it('more emissions give more warming: the four scenarios are in order', () => {
    const order = (['ssp126', 'ssp245', 'ssp370', 'ssp585'] as const).map((s) => T(s));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('a higher climate sensitivity warms more, and a cooling push cools', () => {
    expect(T('ssp245', 4)).toBeGreaterThan(T('ssp245', 2.5));
    expect(meanOver(runEbm(3, 'ssp245', -2), 'T', 2081, 2100)).toBeLessThan(T('ssp245'));
    expect(forcing('ssp245', 2100, 1)).toBeCloseTo(4.5 + 1, 6);
    expect(forcing('ssp245', 2025, 1)).toBeCloseTo(forcing('ssp245', 2025, 0), 6); // the extra push starts after 2030
  });
  it('finds the year warming crosses 1.5 °C, and null when it never does', () => {
    const y = crossingYear(runEbm(3, 'ssp585'), 1.5)!;
    expect(y).toBeGreaterThan(2015);
    expect(y).toBeLessThan(2045);
    expect(crossingYear(runEbm(3, 'ssp126', -3), 3)).toBeNull();
  });
});

describe('regional patterns', () => {
  it('the temperature pattern has an area-weighted mean of 1, with polar amplification and faster land warming', () => {
    const land = new Uint8Array(WORLD_N * WORLD_N);
    for (let j = 0; j < WORLD_N; j++) for (let i = 0; i < WORLD_N; i++) land[j * WORLD_N + i] = (i * 7 + j * 3) % 10 < 3 ? 1 : 0;
    const p = buildPatterns(land);
    let w = 0, s = 0;
    for (let j = 0; j < WORLD_N; j++) for (let i = 0; i < WORLD_N; i++) {
      const c = Math.cos((worldLat(j) * Math.PI) / 180);
      w += c;
      s += c * (land[j * WORLD_N + i] ? p.tempLand[j] : p.tempOcean[j]);
    }
    expect(s / w).toBeCloseTo(1, 6);
    expect(p.tempOcean[2]).toBeGreaterThan(p.tempOcean[WORLD_N / 2]); // the Arctic warms faster than the tropics
    expect(p.tempLand[40]).toBeGreaterThan(p.tempOcean[40]);
  });
  it('rainfall: global mean +2 %/K, wetter tropics and high latitudes, drier subtropics', () => {
    const p = buildPatterns(null);
    let w = 0, s = 0;
    for (let j = 0; j < WORLD_N; j++) { const c = Math.cos((worldLat(j) * Math.PI) / 180); w += c; s += c * p.precip[j]; }
    expect(s / w).toBeCloseTo(2, 6);
    const at = (lat: number) => localFactors(p, lat, 0).precip;
    expect(at(0)).toBeGreaterThan(at(25));
    expect(at(25)).toBeLessThan(at(65));
    expect(at(25)).toBeLessThan(0);
  });
});

describe('packaging and running', () => {
  it('a result is labelled as a projection, with ranges, four-scenario charts and map frames', () => {
    const r = climateResult(base, buildPatterns(null), 'test');
    expect(r.evidence).toBe('projection');
    expect(r.raster!.kind).toBe('warming');
    expect(r.raster!.frames.length).toBeGreaterThan(10);
    expect(r.timeSpan).toEqual([0, 85]);
    expect(r.series.find((s) => s.id === 'gsat')!.extra).toHaveLength(3);
    const g = r.outputs.find((o) => o.id === 'gwarm')!;
    expect(g.range![0]).toBeLessThan(g.value);
    expect(g.range![1]).toBeGreaterThan(g.value);
    expect(r.limitations.join(' ')).toMatch(/not a forecast/);
  });
  it('the map can show rainfall change', () => {
    expect(climateResult({ ...base, map: 'precip' }, buildPatterns(null), 'test').raster!.kind).toBe('precip');
  });
  it('validation rejects nonsense', () => {
    expect(validateClimate({ lat: 0, lon: 0, year: 2010 }).ok).toBe(false);
    expect(validateClimate({ lat: 0, lon: 0, year: 2050.5 }).ok).toBe(false);
    expect(validateClimate({ lat: 0, lon: 0, scenario: 'ssp999' }).ok).toBe(false);
    expect(validateClimate({ lat: 95, lon: 0 }).ok).toBe(false);
    expect(validateClimate({ lat: 41, lon: 29 }).ok).toBe(true);
  });
  it('builds a land mask from a DEM and runs through the registry, also without any terrain data', async () => {
    const dem: Dem = { nx: 90, ny: 90, dx: 1, z: Float32Array.from({ length: 8100 }, (_, k) => ((k % 90) < 45 ? -3000 : 500)), corners: [[-180, 85], [180, 85], [180, -85], [-180, -85]], source: 'synthetic' };
    const mask = landMaskFrom(dem);
    expect(mask[0]).toBe(0);
    expect(mask[WORLD_N - 1]).toBe(1);
    const ok = await runAsync('climate', { lat: 41, lon: 29 }, { demLoader: async () => dem });
    expect(ok.ok && ok.result.inputs.land_sea_mask).toMatch(/synthetic/);
    const offline = await runClimateScenario({ lat: 41, lon: 29 }, { demLoader: async () => { throw new Error('offline'); } });
    expect(offline.ok && offline.result.inputs.land_sea_mask).toMatch(/not available/);
  });
});
