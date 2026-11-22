// Web Worker: runs the fire-spread solver off the main thread.
import { spreadFire, type WildfireInput } from './wildfire';
import type { Dem } from './flood';

self.onmessage = (e: MessageEvent<{ inp: WildfireInput; dem: Dem }>) => {
  try {
    let last = 0;
    const raw = spreadFire(e.data.inp, e.data.dem, (f) => {
      if (f - last >= 0.04) { last = f; self.postMessage({ type: 'progress', f }); }
    });
    const buffers = [...raw.frames.map((fr) => fr.depth.buffer), raw.arrival.buffer, raw.headRos.buffer, raw.burnable.buffer];
    (self as unknown as Worker).postMessage({ type: 'done', raw }, buffers as Transferable[]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : 'fire model error' });
  }
};
