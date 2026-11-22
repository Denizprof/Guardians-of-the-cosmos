// Orchestrates a climate run: validate → a world land-sea mask from the real elevation tiles (the run still works
// without it, then oceans and land get the same pattern and the result says so) → the energy-balance model → SimResult.
import { buildPatterns, climateResult, validateClimate, WORLD_N } from './climate';
import { loadDem } from './dem';
import type { Dem } from './flood';
import type { FloodRun, FloodRunOptions } from './floodRun';

/** Land (elevation above 0 m) on the 180×180 Web-Mercator map grid, sampled from a world DEM. */
export function landMaskFrom(dem: Dem): Uint8Array {
  const mask = new Uint8Array(WORLD_N * WORLD_N);
  for (let j = 0; j < WORLD_N; j++) {
    const y = Math.min(dem.ny - 1, Math.floor(((j + 0.5) / WORLD_N) * dem.ny));
    for (let i = 0; i < WORLD_N; i++) {
      const x = Math.min(dem.nx - 1, Math.floor(((i + 0.5) / WORLD_N) * dem.nx));
      mask[j * WORLD_N + i] = dem.z[y * dem.nx + x] > 0 ? 1 : 0;
    }
  }
  return mask;
}

export async function runClimateScenario(raw: Record<string, unknown>, opts: FloodRunOptions = {}): Promise<FloodRun> {
  const v = validateClimate(raw);
  if (!v.ok) return v;
  let mask: Uint8Array | null = null;
  let note = 'not available: oceans and land use the same pattern';
  try {
    opts.onProgress?.('dem', 0);
    const dem = opts.demLoader ? await opts.demLoader(0, 0, 40075, opts.signal) : await loadDem(0, 0, 40075, opts.tileLoader, opts.signal, 1024);
    mask = landMaskFrom(dem);
    note = `${dem.nx}×${dem.ny} world elevation grid, ${dem.source}`;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
  }
  try {
    opts.onProgress?.('solve', 0.5);
    return { ok: true, result: climateResult(v.value, buildPatterns(mask), note) };
  } catch (e) {
    return { ok: false, issues: [{ field: 'engine', message: `The climate model failed: ${e instanceof Error ? e.message : 'unknown error'}` }] };
  }
}
