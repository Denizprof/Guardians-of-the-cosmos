// Web Worker: computes the ash-fall grid off the main thread.
import { ashGrid, type AshSource, type VolcanoInput } from './volcano';

self.onmessage = (e: MessageEvent<{ inp: VolcanoInput; sources: AshSource[] }>) => {
  try {
    let last = 0;
    const g = ashGrid(e.data.inp, e.data.sources, (f) => {
      if (f - last >= 0.04) { last = f; self.postMessage({ type: 'progress', f }); }
    });
    const buffers = [...g.frames.map((fr) => fr.depth.buffer), g.load.buffer];
    (self as unknown as Worker).postMessage({ type: 'done', grid: g }, buffers as Transferable[]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : 'ash model error' });
  }
};
