// Volcano engine: source scaling against historical eruptions, settling physics, ash-grid conservation,
// wind drift and the energy cone (no network).
import { describe, expect, it } from 'vitest';
import { ashGrid, ashSources, energyCone, mastinHeight, mastinRate, settlingVelocity, validateVolcano, vei, volcanoResult, type VolcanoInput, type WindLayer } from '../../../src/sim/volcano';
import type { Dem } from '../../../src/sim/flood';

const base: VolcanoInput = { lat: 40.821, lon: 14.426, columnKm: 20, durationH: 6, ventKm: 1.2, medianPhi: 1, sigmaPhi: 1.5, diffusion: 4000, collapseKm: 1, heimRatio: 0.2, domainKm: 500 };
const calm: WindLayer[] = [{ z: 0, u: 0, v: 0 }, { z: 30000, u: 0, v: 0 }];
const east: WindLayer[] = [{ z: 0, u: 5, v: 0 }, { z: 10000, u: 20, v: 0 }, { z: 30000, u: 20, v: 0 }];
const massOf = (g: ReturnType<typeof ashGrid>) => g.load.reduce((a, b) => a + b, 0) * g.cell * g.cell;

describe('eruption source', () => {
  it('Mastin plume-height relation round-trips', () => {
    expect(mastinHeight(mastinRate(24))).toBeCloseTo(24, 6);
  });
  it('reproduces the VEI of historical eruptions from column height and duration', () => {
    const veiOf = (h: number, hours: number) => vei((mastinRate(h) * 2500 * hours * 3600) / 1000);
    expect(veiOf(24, 9)).toBe(5); // Mount St. Helens, 18 May 1980: ~24 km for ~9 h, VEI 5
    expect(veiOf(35, 9)).toBe(6); // Pinatubo, 15 June 1991: ~35 km, VEI 6
  });
  it('settling velocity rises with grain size and with altitude (Bonadonna 1998 regimes)', () => {
    const fine = settlingVelocity(10e-6, 2600, 0);
    const coarse = settlingVelocity(2e-3, 1000, 0);
    expect(fine).toBeGreaterThan(0.001); // 10 µm: mm/s (Stokes)
    expect(fine).toBeLessThan(0.02);
    expect(coarse).toBeGreaterThan(2); // 2 mm pumice: several m/s
    expect(coarse).toBeLessThan(15);
    expect(settlingVelocity(1e-3, 2000, 15000)).toBeGreaterThan(settlingVelocity(1e-3, 2000, 0));
  });
});

describe('ash fall', () => {
  it('conserves mass: coarse ash in calm air lands inside a large domain', () => {
    const inp = { ...base, medianPhi: -1, sigmaPhi: 0.7, domainKm: 1500, durationH: 1 };
    const { sources, totalMass } = ashSources(inp, calm);
    expect(massOf(ashGrid(inp, sources)) / totalMass).toBeGreaterThan(0.99);
  });
  it('calm air centres the deposit on the vent; wind carries it downwind', () => {
    const centroidX = (g: ReturnType<typeof ashGrid>) => {
      let m = 0, mx = 0;
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const l = g.load[j * g.nx + i]; m += l; mx += l * (i + 0.5 - g.nx / 2) * g.cell; }
      return mx / m;
    };
    const still = ashGrid(base, ashSources(base, calm).sources);
    const windy = ashGrid(base, ashSources(base, east).sources);
    expect(Math.abs(centroidX(still)) / 1000).toBeLessThan(2);
    expect(centroidX(windy) / 1000).toBeGreaterThan(20);
  });
  it('deposits grow over time and thin with distance', () => {
    const g = ashGrid(base, ashSources(base, calm).sources);
    const c = (g.ny / 2) * g.nx + g.nx / 2;
    for (let f = 1; f < g.frames.length; f++) expect(g.frames[f].depth[c]).toBeGreaterThanOrEqual(g.frames[f - 1].depth[c]);
    expect(g.load[c]).toBeGreaterThan(g.load[(g.ny / 2) * g.nx + 10]);
  });
});

describe('pyroclastic flows (energy cone)', () => {
  it('reaches further with lower H/L and stops where the cone meets the ground', () => {
    const n = 101, dx = 200;
    const z = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = Math.max(0, 1500 - 0.15 * Math.hypot(i - 50, j - 50) * dx);
    const dem: Dem = { nx: n, ny: n, dx, z, corners: [[0, 1], [1, 1], [1, 0], [0, 0]], source: 'synthetic' };
    const mobile = energyCone({ ...base, heimRatio: 0.1 }, dem);
    const stiff = energyCone({ ...base, heimRatio: 0.3 }, dem);
    expect(mobile.runoutKm).toBeGreaterThan(stiff.runoutKm);
    // analytic: cone 2500 − 0.3 r meets the 1500 − 0.15 r mountainside at r = 1000 / 0.15 = 6.67 km
    expect(stiff.runoutKm).toBeGreaterThan(6.4);
    expect(stiff.runoutKm).toBeLessThan(6.9);
  });
});

describe('result and validation', () => {
  it('packages a labelled result with a thickness raster and VEI', () => {
    const { sources, totalMass, mer } = ashSources(base, east);
    const r = volcanoResult(base, east, 'test wind', ashGrid(base, sources), totalMass, mer, null);
    expect(r.evidence).toBe('simulation');
    expect(r.raster!.kind).toBe('thickness');
    expect(r.outputs.find((o) => o.id === 'vei')!.value).toBeGreaterThanOrEqual(4);
    expect(r.outputs.find((o) => o.id === 'ash1mm')!.value).toBeGreaterThan(0);
  });
  it('rejects out-of-range input', () => {
    expect(validateVolcano({ lat: 0, lon: 0, columnKm: 100 }).ok).toBe(false);
    expect(validateVolcano({ lat: 40.8, lon: 14.4 }).ok).toBe(true);
  });
});

describe('winds aloft and question parsing', async () => {
  const { parseWind, windUrl } = await import('../../../src/sim/wind');
  const { parseSimRequest, columnForVei } = await import('../../../src/sim/parse');
  it('turns Open-Meteo pressure-level winds into east/north components', () => {
    const hourly: Record<string, unknown[]> = { time: ['2026-11-22T13:00'] };
    // wind FROM the west (270°) at 20 m/s blows towards the east: u = +20
    for (const [p, z] of [[850, 1500], [500, 5600], [250, 10400]] as const) {
      hourly[`wind_speed_${p}hPa`] = [20];
      hourly[`wind_direction_${p}hPa`] = [270];
      hourly[`geopotential_height_${p}hPa`] = [z];
    }
    const { layers } = parseWind({ hourly }, new Date('2026-11-22T13:20:00Z'));
    expect(layers).toHaveLength(3);
    expect(layers[0].u).toBeCloseTo(20, 6);
    expect(Math.abs(layers[0].v)).toBeLessThan(1e-9);
    expect(windUrl(40.8, 14.4)).toMatch(/wind_speed_250hPa/);
    expect(() => parseWind({ hourly: { time: ['x'] } })).toThrow();
  });
  it('reads eruption questions and named volcanoes', () => {
    const p = parseSimRequest('What would happen if Vesuvius erupted with a 25 km high ash column for 8 hours?')!;
    expect(p.category).toBe('volcano');
    expect(p.params).toMatchObject({ lat: 40.821, lon: 14.426, columnKm: 25, durationH: 8 });
    expect(parseSimRequest('What if Erciyes had a VEI 5 eruption?')!.placeName).toBe('Erciyes');
    expect(parseSimRequest('Simulate an eruption of Mount Fuji in calm air')!.params).toMatchObject({ windMode: 'calm', lat: 35.361 });
    expect(parseSimRequest('Which volcanoes are on the map?')).toBeNull();
  });
  it('maps a VEI to a column height that reproduces that VEI', () => {
    for (const n of [3, 4, 5, 6]) {
      const h = columnForVei(n, 6);
      expect(vei((mastinRate(h) * 2500 * 6 * 3600) / 1000)).toBe(n);
    }
  });
});
