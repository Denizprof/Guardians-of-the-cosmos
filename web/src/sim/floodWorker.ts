// Web Worker: runs the flood solver off the main thread so the globe stays responsive.
import { solveFlood, type Dem, type FloodInput } from './flood';

self.onmessage = (e: MessageEvent<{ inp: FloodInput; dem: Dem }>) => {
  try {
    let last = 0;
    const raw = solveFlood(e.data.inp, e.data.dem, (f) => {
      if (f - last >= 0.04) { last = f; self.postMessage({ type: 'progress', f }); }
    });
    const buffers = [...raw.frames.map((fr) => fr.depth.buffer), raw.maxDepth.buffer];
    (self as unknown as Worker).postMessage({ type: 'done', raw }, buffers as Transferable[]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : 'solver error' });
  }
};
