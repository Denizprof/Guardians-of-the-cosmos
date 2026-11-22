// Renders a flood depth grid to a transparent PNG data URL for a MapLibre image source (browser only).
import type { SimRaster } from './types';

/** Depth classes (m) and colours, shared by the map and its legend. */
export const DEPTH_CLASSES: { min: number; color: [number, number, number]; label: string }[] = [
  { min: 0.05, color: [158, 202, 225], label: '5–30 cm' },
  { min: 0.3, color: [66, 146, 198], label: '30 cm–1 m' },
  { min: 1, color: [33, 113, 181], label: '1–2 m' },
  { min: 2, color: [8, 48, 107], label: '> 2 m' },
];

const cache = new WeakMap<Float32Array, string>();

/** Sea-surface colours (tsunami): red = above sea level, blue = below; nearly-still water is transparent. */
export const SURFACE_CLASSES: { min: number; color: [number, number, number]; label: string }[] = [
  { min: 2, color: [165, 0, 38], label: '> +2 m' },
  { min: 0.5, color: [244, 109, 67], label: '+0.5 to +2 m' },
  { min: 0.05, color: [253, 174, 97], label: '+5 to +50 cm' },
  { min: -0.05, color: [0, 0, 0], label: '' },
  { min: -0.5, color: [116, 173, 209], label: '−5 to −50 cm' },
  { min: -Infinity, color: [49, 54, 149], label: '< −50 cm' },
];

/** Ash-fall thickness colours (volcano), with the impact thresholds used in the results. */
export const ASH_CLASSES: { min: number; color: [number, number, number]; label: string }[] = [
  { min: 0.0001, color: [255, 237, 160], label: '0.1–1 mm' },
  { min: 0.001, color: [254, 196, 79], label: '1 mm–1 cm' },
  { min: 0.01, color: [217, 95, 14], label: '1–10 cm' },
  { min: 0.1, color: [127, 39, 4], label: '> 10 cm' },
];

/** Fire state colours (wildfire): burned area and the active front (burned in the last 30 minutes). */
export const FIRE_CLASSES: { min: number; color: [number, number, number]; label: string }[] = [
  { min: 1, color: [60, 20, 20], label: 'burned' },
  { min: 2, color: [255, 120, 20], label: 'active front (last 30 min)' },
];

function surfaceColor(v: number): [number, number, number] | null {
  if (Math.abs(v) < 0.05) return null;
  for (const c of SURFACE_CLASSES) if (v >= c.min) return c.label ? c.color : null;
  return null;
}

export function depthToDataUrl(depth: Float32Array, nx: number, ny: number, kind: 'depth' | 'sea-surface' | 'thickness' | 'fire' = 'depth'): string | null {
  const hit = cache.get(depth);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = nx;
  c.height = ny;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(nx, ny);
  for (let k = 0; k < depth.length; k++) {
    const d = depth[k];
    if (kind === 'sea-surface') {
      const col = surfaceColor(d);
      if (col) img.data.set([...col, 210], k * 4);
      continue;
    }
    const classes = kind === 'thickness' ? ASH_CLASSES : kind === 'fire' ? FIRE_CLASSES : DEPTH_CLASSES;
    let cls = -1;
    for (let i = classes.length - 1; i >= 0; i--) if (d >= classes[i].min) { cls = i; break; }
    if (cls < 0) continue;
    const [r, g, b] = classes[cls].color;
    img.data.set([r, g, b, 200], k * 4);
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL('image/png');
  cache.set(depth, url);
  return url;
}

/** The last frame at or before time t. */
export function frameAt(r: SimRaster, t: number): SimRaster['frames'][number] {
  let f = r.frames[0];
  for (const fr of r.frames) if (fr.t <= t + 1e-6) f = fr;
  return f;
}
