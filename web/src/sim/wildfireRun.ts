// Orchestrates a wildfire run: validate → terrain (and current weather unless entered by hand) → spread in a
// Web Worker (main thread where workers are unavailable, e.g. tests) → SimResult.
import { spreadFire, validateWildfire, wildfireResult, type FireRaw, type WildfireInput } from './wildfire';
import { loadDem } from './dem';
import { loadSurfaceWeather, type SurfaceWeather } from './wind';
import type { Dem } from './flood';
import type { FloodRun } from './floodRun';
import type { VolcanoRunOptions } from './volcanoRun';

export interface WildfireRunOptions extends VolcanoRunOptions {
  /** Replace the surface-weather source (tests). */
  weatherLoader?: (lat: number, lon: number, signal?: AbortSignal) => Promise<SurfaceWeather>;
}

function spreadInWorker(inp: WildfireInput, dem: Dem, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<FireRaw> {
  if (typeof Worker === 'undefined') return Promise.resolve(spreadFire(inp, dem, onProgress));
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./wildfireWorker.ts', import.meta.url), { type: 'module' });
    const stop = () => { w.terminate(); reject(new DOMException('Simulation cancelled', 'AbortError')); };
    signal?.addEventListener('abort', stop, { once: true });
    w.onmessage = (e: MessageEvent<{ type: 'progress'; f: number } | { type: 'done'; raw: FireRaw } | { type: 'error'; message: string }>) => {
      const m = e.data;
      if (m.type === 'progress') { onProgress?.(m.f); return; }
      signal?.removeEventListener('abort', stop);
      w.terminate();
      if (m.type === 'done') resolve(m.raw);
      else reject(new Error(m.message));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'The fire worker failed')); };
    w.postMessage({ inp, dem });
  });
}

export async function runWildfireScenario(raw: Record<string, unknown>, opts: WildfireRunOptions = {}): Promise<FloodRun> {
  const v = validateWildfire(raw);
  if (!v.ok) return v;
  let inp = v.value;
  const manual = raw.weather === 'manual';
  let dem: Dem;
  let weatherSource = 'values entered by the user';
  try {
    opts.onProgress?.('dem', 0);
    const demP = opts.demLoader ? opts.demLoader(inp.lat, inp.lon, inp.domainKm, opts.signal) : loadDem(inp.lat, inp.lon, inp.domainKm, opts.tileLoader, opts.signal);
    const wxP = manual ? Promise.resolve(null) : (opts.weatherLoader ?? loadSurfaceWeather)(inp.lat, inp.lon, opts.signal);
    const [d, wx] = await Promise.all([demP, wxP]);
    dem = d;
    if (wx) {
      inp = { ...inp, windKmh: Math.min(100, wx.windKmh), windFrom: wx.windFrom, rh: Math.max(2, wx.rh), tempC: wx.tempC };
      weatherSource = `Open-Meteo current weather${wx.time ? ` (${wx.time.replace('T', ' ')} UTC)` : ''}: ${wx.windKmh} km/h from ${wx.windFrom}°, RH ${wx.rh}%, ${wx.tempC} °C`;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    const extra = manual ? '' : ' and the current weather (or choose to use the values entered by hand)';
    return { ok: false, issues: [{ field: 'engine', message: `Input data could not be loaded (${e instanceof Error ? e.message : 'network error'}). The fire model needs real terrain${extra}, so nothing was calculated.` }] };
  }
  const c = Math.floor(dem.ny / 2) * dem.nx + Math.floor(dem.nx / 2);
  if (dem.z[c] <= 0) return { ok: false, issues: [{ field: 'lat', message: 'The ignition point is on water: pick a point on land.' }] };
  try {
    const out = await spreadInWorker(inp, dem, (f) => opts.onProgress?.('solve', f), opts.signal);
    return { ok: true, result: wildfireResult(inp, dem, out, weatherSource) };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return { ok: false, issues: [{ field: 'engine', message: `The fire model failed: ${e instanceof Error ? e.message : 'unknown error'}` }] };
  }
}
