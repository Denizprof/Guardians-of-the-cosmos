// Web Worker: runs the tsunami solver off the main thread.
import { solveTsunami, type TsunamiInput } from './tsunami';
import type { Dem } from './flood';

self.onmessage = (e: MessageEvent<{ inp: TsunamiInput; dem: Dem; eta0: Float32Array }>) => {
  try {
    let last = 0;
    const raw = solveTsunami(e.data.inp, e.data.dem, e.data.eta0, (f) => {
      if (f - last >= 0.03) { last = f; self.postMessage({ type: 'progress', f }); }
    });
    const buffers = [...raw.frames.map((fr) => fr.depth.buffer), raw.maxAmp.buffer, raw.arrival.buffer];
    (self as unknown as Worker).postMessage({ type: 'done', raw }, buffers as Transferable[]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : 'solver error' });
  }
};
