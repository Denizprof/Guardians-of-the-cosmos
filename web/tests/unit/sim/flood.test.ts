// Flood solver: analytical and conservation benchmarks on synthetic terrain (no network).
import { describe, expect, it } from 'vitest';
import { floodResult, solveFlood, validateFlood, type Dem, type FloodInput } from '../../../src/sim/flood';
import { decodeTerrarium, loadDem, planGrid } from '../../../src/sim/dem';

const grid = (nx: number, ny: number, dx: number, f: (i: number, j: number) => number): Dem => {
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = f(i, j);
  return { nx, ny, dx, z, corners: [[0, 1], [1, 1], [1, 0], [0, 0]], source: 'synthetic' };
};
const base: FloodInput = { lat: 0, lon: 0, rainfall: 50, duration: 1, simHours: 2, loss: 0, manning: 0.05, seaLevel: 0, domainKm: 2 };
const bowl = (n: number) => grid(n, n, 50, (i, j) => 10 + 0.02 * ((i - (n - 1) / 2) ** 2 + (j - (n - 1) / 2) ** 2));

describe('flood solver', () => {
  it('closed bowl: all rain is stored (mass conservation)', () => {
    const raw = solveFlood(base, bowl(40));
    const expected = 0.05 * 1 * (40 * 50) ** 2; // 50 mm over the area
    expect(raw.rainVolume / expected).toBeCloseTo(1, 6);
    expect(raw.storedVolume / expected).toBeCloseTo(1, 3);
    expect(raw.outflowVolume / expected).toBeLessThan(1e-3);
    expect(raw.maxDepth[20 * 40 + 20]).toBeGreaterThan(raw.maxDepth[2 * 40 + 2]); // water collects in the centre
  });

  it('lake at rest stays at rest (no rain, no sea: nothing moves)', () => {
    const raw = solveFlood({ ...base, rainfall: 0, duration: 0, simHours: 1 }, grid(20, 20, 50, (i) => 5 + Math.sin(i)));
    expect(raw.storedVolume).toBe(0);
  });

  it('infiltration removes water and the budget closes', () => {
    const raw = solveFlood({ ...base, loss: 20 }, bowl(30));
    const bal = raw.rainVolume - raw.lossVolume - raw.outflowVolume + raw.seaExchange - raw.storedVolume;
    expect(Math.abs(bal) / raw.rainVolume).toBeLessThan(1e-3);
    expect(raw.lossVolume).toBeGreaterThan(0);
  });

  it('a tilted plane drains through its low edge', () => {
    const raw = solveFlood({ ...base, simHours: 4 }, grid(40, 10, 50, (i) => 20 - 0.5 * i));
    expect(raw.outflowVolume / raw.rainVolume).toBeGreaterThan(0.5);
  });

  it('sea level rise floods connected lowland but not a walled-off depression', () => {
    // west: sea (−5 m); lowland at 1 m; a 5 m wall; a depression at 1 m behind it
    const dem = grid(40, 5, 100, (i) => (i < 5 ? -5 : i < 20 ? 1 : i < 23 ? 5 : 1));
    const raw = solveFlood({ ...base, rainfall: 0, duration: 0, seaLevel: 2, simHours: 6 }, dem);
    expect(raw.maxDepth[2 * 40 + 10]).toBeGreaterThan(0.8); // connected lowland ≈ 1 m deep
    expect(raw.maxDepth[2 * 40 + 30]).toBe(0); // dry behind the wall: not a "bathtub" model
    expect(raw.seaExchange).toBeGreaterThan(0);
  });

  it('packages results with a small mass-balance error, frames and labels', () => {
    const dem = bowl(30);
    const r = floodResult(base, dem, solveFlood(base, dem));
    expect(r.evidence).toBe('simulation');
    expect(Math.abs(r.outputs.find((o) => o.id === 'balance')!.value)).toBeLessThan(0.1);
    expect(r.raster!.frames.length).toBeGreaterThan(10);
    expect(r.outputs.find((o) => o.id === 'area01')!.value).toBeGreaterThan(0);
  });

  it('validation rejects out-of-range input and a scenario with no water', () => {
    expect(validateFlood({ lat: 0, lon: 0, rainfall: 500 }).ok).toBe(false);
    expect(validateFlood({ lat: 0, lon: 0, rainfall: 0, seaLevel: 0 }).ok).toBe(false);
    expect(validateFlood({ lat: 89, lon: 0 }).ok).toBe(false);
  });
});

describe('DEM loading', () => {
  it('decodes Terrarium pixels', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBe(100.5);
  });
  it('plans a grid near the requested size, capped at 200 cells', () => {
    const p = planGrid(41, 29, 20);
    expect(p.size).toBeLessThanOrEqual(200);
    expect(Math.abs(p.size * p.dx - 20000) / 20000).toBeLessThan(0.6);
  });
  it('mosaics tiles into a grid and georeferences it', async () => {
    const flat = (elev: number) => {
      const d = new Uint8ClampedArray(256 * 256 * 4);
      const v = elev + 32768;
      for (let k = 0; k < d.length; k += 4) { d[k] = Math.floor(v / 256); d[k + 1] = v % 256; d[k + 3] = 255; }
      return { data: d, width: 256, height: 256 } as unknown as ImageData;
    };
    const dem = await loadDem(41, 29, 10, async () => flat(42));
    expect(dem.z.every((v) => v === 42)).toBe(true);
    const [[w, n], , [e, s]] = dem.corners;
    expect(w).toBeLessThan(29);
    expect(e).toBeGreaterThan(29);
    expect(n).toBeGreaterThan(41);
    expect(s).toBeLessThan(41);
  });
});
