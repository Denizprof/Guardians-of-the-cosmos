// Orchestrates a volcano run: validate → terrain around the vent (vent height + energy cone) → wind aloft
// (Open-Meteo, or calm air when chosen) → ash sources → ash grid in a Web Worker → SimResult.
import { ashGrid, ashSources, energyCone, validateVolcano, volcanoResult, type AshGrid, type AshSource, type VolcanoInput, type WindLayer } from './volcano';
import { loadDem } from './dem';
import { loadWind } from './wind';
import type { Dem } from './flood';
import type { FloodRun, FloodRunOptions } from './floodRun';

export interface VolcanoRunOptions extends FloodRunOptions {
  /** Replace the wind source (tests, or another forecast). */
  windLoader?: (lat: number, lon: number, signal?: AbortSignal) => Promise<{ layers: WindLayer[]; source: string }>;
}

const CALM: WindLayer[] = [{ z: 0, u: 0, v: 0 }, { z: 50000, u: 0, v: 0 }];

function gridInWorker(inp: VolcanoInput, sources: AshSource[], onProgress?: (f: number) => void, signal?: AbortSignal): Promise<AshGrid> {
  if (typeof Worker === 'undefined') return Promise.resolve(ashGrid(inp, sources, onProgress));
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./volcanoWorker.ts', import.meta.url), { type: 'module' });
    const stop = () => { w.terminate(); reject(new DOMException('Simulation cancelled', 'AbortError')); };
    signal?.addEventListener('abort', stop, { once: true });
    w.onmessage = (e: MessageEvent<{ type: 'progress'; f: number } | { type: 'done'; grid: AshGrid } | { type: 'error'; message: string }>) => {
      const m = e.data;
      if (m.type === 'progress') { onProgress?.(m.f); return; }
      signal?.removeEventListener('abort', stop);
      w.terminate();
      if (m.type === 'done') resolve(m.grid);
      else reject(new Error(m.message));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'The ash worker failed')); };
    w.postMessage({ inp, sources });
  });
}

export async function runVolcanoScenario(raw: Record<string, unknown>, opts: VolcanoRunOptions = {}): Promise<FloodRun> {
  const v = validateVolcano(raw);
  if (!v.ok) return v;
  let inp = v.value;
  const calm = raw.windMode === 'calm';
  let dem: Dem;
  let wind: { layers: WindLayer[]; source: string };
  try {
    opts.onProgress?.('dem', 0);
    // terrain wide enough for the most mobile flow: (z_vent + H_c) / (H/L), with a 6 km vent allowance
    const reachKm = Math.min(200, Math.max(20, (2.2 * (6 + inp.collapseKm)) / inp.heimRatio));
    const demP = opts.demLoader ? opts.demLoader(inp.lat, inp.lon, reachKm, opts.signal) : loadDem(inp.lat, inp.lon, reachKm, opts.tileLoader, opts.signal);
    const windP = calm ? Promise.resolve({ layers: CALM, source: 'calm air (no wind), chosen by the user' }) : (opts.windLoader ?? loadWind)(inp.lat, inp.lon, opts.signal);
    [dem, wind] = await Promise.all([demP, windP]);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return { ok: false, issues: [{ field: 'engine', message: `Input data could not be loaded (${e instanceof Error ? e.message : 'network error'}). The volcano model needs real terrain and winds aloft, so nothing was calculated. You can choose "calm air" to run without the wind forecast.` }] };
  }
  const cone = energyCone(inp, dem);
  if (cone.ventM < 0) return { ok: false, issues: [{ field: 'lat', message: 'The chosen point is under the sea: pick the volcano summit on land (submarine eruptions are not modelled).' }] };
  inp = { ...inp, ventKm: cone.ventM / 1000 };
  const { sources, totalMass, mer } = ashSources(inp, wind.layers);
  try {
    const grid = await gridInWorker(inp, sources, (f) => opts.onProgress?.('solve', f), opts.signal);
    return { ok: true, result: volcanoResult(inp, wind.layers, wind.source, grid, totalMass, mer, cone) };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return { ok: false, issues: [{ field: 'engine', message: `The ash model failed: ${e instanceof Error ? e.message : 'unknown error'}` }] };
  }
}
