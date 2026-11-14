// Coverage probe: one product at a time.
//
// The probe used to draw every product footprint at once as translucent fills. Dozens of near-identical
// footprints (the same track and frame every 12 days) stacked into an opaque blob that hid the map and told
// the reader nothing. Now nothing is drawn until one product is chosen, and then only that product is shown:
// its footprint outline and its NASA browse picture.
import type { CoverageGranule } from '../services';

type Ring = number[][];
const rings = (g: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined): Ring[] =>
  !g ? [] : g.type === 'Polygon' ? (g.coordinates as Ring[]) : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]).flat() : [];

/** GeoJSON features for the map: the selected product only (0 or 1 feature), never the whole list. */
export function coverageFeatures(granules: CoverageGranule[], selectedScene: string | null): GeoJSON.Feature[] {
  if (!selectedScene) return [];
  const g = granules.find((x) => x.scene === selectedScene);
  if (!g || !g.footprint) return [];
  return [{ type: 'Feature', geometry: g.footprint, properties: { scene: g.scene } }];
}

/**
 * Where to draw a product's "LATLON" browse picture: it is a north-up latitude/longitude image of the whole
 * product, so it is placed on the footprint's bounding box. Corners in MapLibre image-source order
 * (top-left, top-right, bottom-right, bottom-left). Approximate: the picture is linear in latitude while the
 * map is Mercator, and the image may carry a small margin; good to roughly a kilometre, for looking, not measuring.
 */
export function browseBounds(footprint: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined): [[number, number], [number, number], [number, number], [number, number]] | null {
  const pts = rings(footprint).flat().filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 3) return null;
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const w = Math.min(...lons), e = Math.max(...lons), s = Math.min(...lats), n = Math.max(...lats);
  if (!(e > w) || !(n > s)) return null;
  return [[w, n], [e, n], [e, s], [w, s]];
}

/** The scene one step before / after the current one in the list (clamped at the ends; null starts at the first). */
export function stepScene(granules: CoverageGranule[], current: string | null, delta: 1 | -1): string | null {
  if (!granules.length) return null;
  const i = granules.findIndex((g) => g.scene === current);
  if (i < 0) return granules[0].scene;
  return granules[Math.max(0, Math.min(granules.length - 1, i + delta))].scene;
}

/** Tight box around the non-transparent pixels of an RGBA image, or null when it is fully transparent. */
export function opaqueBounds(rgba: Uint8ClampedArray, width: number, height: number, minAlpha = 8): { x: number; y: number; w: number; h: number } | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] >= minAlpha) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * NASA's LATLON browse PNG has transparent margins around the data. Stretching the whole image over the
 * footprint's bounding box would draw the data too small, so the margins are trimmed first: the data's own
 * bounding box is what corresponds to the footprint's bounding box. Returns an object URL for the trimmed
 * picture (the caller revokes it), downscaled to at most `maxSide` pixels to keep the map texture light.
 */
export async function trimmedBrowseUrl(url: string, signal: AbortSignal, maxSide = 1600): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`browse picture: HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  try {
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const full = document.createElement('canvas');
    full.width = w;
    full.height = h;
    const ctx = full.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(bmp, 0, 0, w, h);
    const box = opaqueBounds(ctx.getImageData(0, 0, w, h).data, w, h);
    if (!box) throw new Error('browse picture is empty');
    const out = document.createElement('canvas');
    out.width = box.w;
    out.height = box.h;
    out.getContext('2d')!.drawImage(full, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const blob = await new Promise<Blob>((ok, bad) => out.toBlob((b) => (b ? ok(b) : bad(new Error('PNG encode failed'))), 'image/png'));
    return URL.createObjectURL(blob);
  } finally {
    bmp.close();
  }
}
