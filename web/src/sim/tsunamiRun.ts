// Orchestrates a tsunami run: validate → load bathymetry → check the source is at sea → build the earthquake source →
// solve in a Web Worker (main thread where workers are unavailable, e.g. tests) → package as a SimResult.
import { solveTsunami, sourceField, tsunamiResult, validateTsunami, type TsunamiInput, type TsunamiRaw } from './tsunami';
import { loadDem } from './dem';
import type { Dem } from './flood';
import type { FloodRun, FloodRunOptions } from './floodRun';

const MAX_CELLS = 250;

function solveInWorker(inp: TsunamiInput, dem: Dem, eta0: Float32Array, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<TsunamiRaw> {
  if (typeof Worker === 'undefined') return Promise.resolve(solveTsunami(inp, dem, eta0, onProgress));
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./tsunamiWorker.ts', import.meta.url), { type: 'module' });
    const stop = () => { w.terminate(); reject(new DOMException('Simulation cancelled', 'AbortError')); };
    signal?.addEventListener('abort', stop, { once: true });
    w.onmessage = (e: MessageEvent<{ type: 'progress'; f: number } | { type: 'done'; raw: TsunamiRaw } | { type: 'error'; message: string }>) => {
      const m = e.data;
      if (m.type === 'progress') { onProgress?.(m.f); return; }
      signal?.removeEventListener('abort', stop);
      w.terminate();
      if (m.type === 'done') resolve(m.raw);
      else reject(new Error(m.message));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'The tsunami worker failed')); };
    w.postMessage({ inp, dem, eta0 });
  });
}

export async function runTsunamiScenario(raw: Record<string, unknown>, opts: FloodRunOptions = {}): Promise<FloodRun> {
  const v = validateTsunami(raw);
  if (!v.ok) return v;
  const inp = v.value;
  let dem: Dem;
  try {
    opts.onProgress?.('dem', 0);
    dem = opts.demLoader ? await opts.demLoader(inp.lat, inp.lon, inp.domainKm, opts.signal) : await loadDem(inp.lat, inp.lon, inp.domainKm, opts.tileLoader, opts.signal, MAX_CELLS);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return { ok: false, issues: [{ field: 'engine', message: `Bathymetry could not be loaded (${e instanceof Error ? e.message : 'network error'}). The tsunami model needs real sea-floor depths, so nothing was calculated.` }] };
  }
  const { eta, rup } = sourceField(inp, dem);
  let peak = 0;
  for (let k = 0; k < eta.length; k++) if (eta[k] > peak) peak = eta[k];
  if (peak < 0.01) return { ok: false, issues: [{ field: 'lat', message: 'The epicentre is not at sea (or the rupture lies on land): a seafloor earthquake is needed to make a tsunami. Pick a point offshore, e.g. on an ocean trench.' }] };
  try {
    const out = await solveInWorker(inp, dem, eta, (f) => opts.onProgress?.('solve', f), opts.signal);
    return { ok: true, result: tsunamiResult(inp, dem, out, rup) };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return { ok: false, issues: [{ field: 'engine', message: `The tsunami solver failed: ${e instanceof Error ? e.message : 'unknown error'}` }] };
  }
}
