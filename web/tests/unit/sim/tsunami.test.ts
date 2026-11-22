// Tsunami engine: analytical benchmarks on synthetic bathymetry (no network).
import { describe, expect, it } from 'vitest';
import { coastalReport, rupture, solveTsunami, sourceField, tsunamiResult, validateTsunami, type TsunamiInput } from '../../../src/sim/tsunami';
import type { Dem } from '../../../src/sim/flood';

const DX = 5000;
const grid = (nx: number, ny: number, f: (i: number, j: number) => number): Dem => {
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = f(i, j);
  const deg = DX / 111195; // degrees per 5 km cell at the equator
  return { nx, ny, dx: DX, z, corners: [[0, (ny * deg) / 2], [nx * deg, (ny * deg) / 2], [nx * deg, -(ny * deg) / 2], [0, -(ny * deg) / 2]], source: 'synthetic' };
};
const hump = (dem: Dem, ci: number, cj: number, r: number, a: number) => {
  const e = new Float32Array(dem.nx * dem.ny);
  for (let j = 0; j < dem.ny; j++) for (let i = 0; i < dem.nx; i++) {
    const s = Math.hypot(i - ci, j - cj) / r;
    if (s < 1) e[j * dem.nx + i] = a * 0.5 * (1 + Math.cos(Math.PI * s));
  }
  return e;
};
const base: TsunamiInput = { lat: 0, lon: 0, magnitude: 8.5, strike: 0, dip: 15, domainKm: 1000, simHours: 1 };

describe('tsunami source', () => {
  it('a Tōhoku-size (Mw 9.0) rupture has realistic dimensions and slip', () => {
    const r = rupture(9.0, 15);
    expect(r.L / 1000).toBeGreaterThan(300); // observed rupture ~400–500 km
    expect(r.L / 1000).toBeLessThan(800);
    expect(r.D).toBeGreaterThan(5); // average slip ~10–20 m
    expect(r.D).toBeLessThan(40);
    expect(r.u0).toBeGreaterThan(1); // observed seafloor uplift: several metres
    expect(r.u0).toBeLessThan(12);
  });
  it('bigger earthquakes lift more water', () => {
    expect(rupture(9, 15).u0).toBeGreaterThan(rupture(8, 15).u0);
  });
  it('places the uplift on the ocean around the epicentre', () => {
    const dem = grid(200, 200, () => -4000);
    const { eta } = sourceField({ ...base, lat: 0, lon: dem.corners[1][0] / 2 }, dem);
    expect(Math.max(...eta)).toBeGreaterThan(0.5);
  });
});

describe('tsunami propagation', () => {
  it('a wave front travels at √(g d) in uniform depth', () => {
    const d = 4000;
    const dem = grid(160, 60, () => -d);
    const raw = solveTsunami({ ...base, simHours: 0.5 }, dem, hump(dem, 30, 30, 4, 10));
    const c = Math.sqrt(9.81 * d);
    const t = raw.arrival[30 * 160 + 90]; // 60 cells (300 km) east of the hump centre
    const expected = (60 * DX - 2 * DX) / c; // the front starts about half the hump radius out
    expect(Math.abs(t - expected) / expected).toBeLessThan(0.1);
  });
  it('conserves water volume in a closed basin', () => {
    const dem = grid(80, 80, (i, j) => (i < 12 || j < 12 || i > 67 || j > 67 ? 100 : -3000));
    const raw = solveTsunami({ ...base, simHours: 1 }, dem, hump(dem, 40, 40, 5, 2));
    expect(raw.volumeDrift).toBeLessThan(1e-9);
  });
  it('waves grow over a shelf and coastal arrivals are reported', () => {
    // a broad wave and a 400 m shelf, so the shortened wave is still resolved by the grid
    const dem = grid(160, 60, (i) => (i < 80 ? -4000 : i < 125 ? -400 : 50));
    const raw = solveTsunami({ ...base, simHours: 2 }, dem, hump(dem, 30, 30, 14, 10));
    const hit = coastalReport(dem, raw).coast.filter((c) => !Number.isNaN(c.arrivalS));
    expect(hit.length).toBeGreaterThan(0);
    expect(raw.maxAmp[30 * 160 + 100]).toBeGreaterThan(raw.maxAmp[30 * 160 + 60]); // shoaling (Green's law)
  });
  it('packages a labelled result with sea-surface frames', () => {
    const dem = grid(120, 120, (i) => (i < 100 ? -4000 : 20));
    const inp = { ...base, lon: dem.corners[1][0] * 0.4, lat: 0, simHours: 1 };
    const { eta, rup } = sourceField(inp, dem);
    const r = tsunamiResult(inp, dem, solveTsunami(inp, dem, eta), rup);
    expect(r.evidence).toBe('simulation');
    expect(r.raster!.kind).toBe('sea-surface');
    expect(r.outputs.find((o) => o.id === 'first')).toBeDefined();
    expect(r.steps.find((s) => s.id === 'drift')!.value).toBeLessThan(1e-3); // percent
  });
  it('coast inside the rupture area is not reported as an instant "arrival"', () => {
    // land starts 6 cells (30 km) east of the epicentre: the rupture (half-width ~37 km at Mw 8.5) overlaps that coast
    const dem = grid(120, 160, (i) => (i < 66 ? -4000 : 20));
    const inp = { ...base, lon: (dem.corners[1][0] * 60) / 120, lat: 0, simHours: 1 };
    const { eta, rup } = sourceField(inp, dem);
    const raw = solveTsunami(inp, dem, eta);
    const { coast } = coastalReport(dem, raw);
    expect(coast.some((c) => c.inSource)).toBe(true);
    const r = tsunamiResult(inp, dem, raw, rup);
    expect(r.summary).toMatch(/inside the rupture area/);
    const first = r.outputs.find((o) => o.id === 'first');
    if (first) expect(first.value).toBeGreaterThan(0); // a travel time from outside the source, not t = 0
  });
  it('validation rejects out-of-range input', () => {
    expect(validateTsunami({ lat: 0, lon: 0, magnitude: 6 }).ok).toBe(false);
    expect(validateTsunami({ lat: 80, lon: 0 }).ok).toBe(false);
    expect(validateTsunami({ lat: 38.3, lon: 142.4 }).ok).toBe(true);
  });
});
