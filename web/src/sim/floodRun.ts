// Orchestrates a flood run: validate → load the real DEM → solve in a Web Worker (falls back to the main thread
// where workers are unavailable, e.g. tests) → package as a SimResult.
import { floodResult, solveFlood, validateFlood, type Dem, type FloodInput, type FloodRaw } from './flood';
import { loadDem, type TileLoader } from './dem';
import type { SimResult, ValidationIssue } from './types';

export type FloodRun = { ok: true; result: SimResult } | { ok: false; issues: ValidationIssue[] };

export interface FloodRunOptions {
  onProgress?: (stage: 'dem' | 'solve', fraction: number) => void;
  signal?: AbortSignal;
  /** Replace the DEM source (tests, or a different elevation service). */
  demLoader?: (lat: number, lon: number, km: number, signal?: AbortSignal) => Promise<Dem>;
  tileLoader?: TileLoader;
}

function solveInWorker(inp: FloodInput, dem: Dem, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<FloodRaw> {
  if (typeof Worker === 'undefined') return Promise.resolve(solveFlood(inp, dem, onProgress));
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./floodWorker.ts', import.meta.url), { type: 'module' });
    const stop = () => { w.terminate(); reject(new DOMException('Simulation cancelled', 'AbortError')); };
    signal?.addEventListener('abort', stop, { once: true });
    w.onmessage = (e: MessageEvent<{ type: 'progress'; f: number } | { type: 'done'; raw: FloodRaw } | { type: 'error'; message: string }>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress?.(m.f);
      else {
        signal?.removeEventListener('abort', stop);
        w.terminate();
        if (m.type === 'done') resolve(m.raw);
        else reject(new Error(m.message));
      }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'The flood worker failed')); };
    w.postMessage({ inp, dem });
  });
}

export async function runFloodScenario(raw: Record<string, unknown>, opts: FloodRunOptions = {}): Promise<FloodRun> {
  const v = validateFlood(raw);
  if (!v.ok) return v;
  const inp = v.value;
  let dem: Dem;
  try {
    opts.onProgress?.('dem', 0);
    dem = opts.demLoader ? await opts.demLoader(inp.lat, inp.lon, inp.domainKm, opts.signal) : await loadDem(inp.lat, inp.lon, inp.domainKm, opts.tileLoader, opts.signal);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return { ok: false, issues: [{ field: 'engine', message: `Elevation data could not be loaded (${e instanceof Error ? e.message : 'network error'}). The flood model needs real terrain, so nothing was calculated.` }] };
  }
  let hasLand = false;
  for (let k = 0; k < dem.z.length && !hasLand; k++) hasLand = dem.z[k] > 0;
  if (!hasLand) return { ok: false, issues: [{ field: 'lat', message: 'The whole area is sea (elevation ≤ 0 m): pick a place on land or on a coast.' }] };
  try {
    const out = await solveInWorker(inp, dem, (f) => opts.onProgress?.('solve', f), opts.signal);
    return { ok: true, result: floodResult(inp, dem, out) };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return { ok: false, issues: [{ field: 'engine', message: `The flood solver failed: ${e instanceof Error ? e.message : 'unknown error'}` }] };
  }
}
