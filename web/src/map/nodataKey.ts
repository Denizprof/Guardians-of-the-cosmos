/**
 * Transparent no-data for JPEG satellite tiles.
 *
 * NASA GIBS serves the VIIRS corrected-reflectance layers only as JPEG (a .png request returns the same JPEG),
 * and JPEG has no alpha channel: areas with no daylight observation (polar night) or between orbits come back
 * as solid black (0,0,0) and were drawn as large black patches over the globe. Measured on a polar tile in
 * November: 56 % of pixels are exactly 0 and only ~1.8 % fall in 1..24, so "every channel <= 10" separates
 * no-data (plus JPEG ringing at its edge) from real imagery. Real ocean in true colour is ~ (20, 40, 70).
 *
 * Layers opt in with `"nodata": "black"` in layers.json; their tile URL is rewritten to the custom protocol
 * below, which fetches the JPEG, keys near-black to transparent and hands MapLibre a PNG.
 */
export const NODATA_PROTOCOL = 'nodata-black';
export const BLACK_THRESHOLD = 10;

/** In place: alpha = 0 where every colour channel is <= threshold. Returns the number of pixels keyed out. */
export function keyBlackToTransparent(rgba: Uint8ClampedArray, threshold = BLACK_THRESHOLD): number {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] <= threshold && rgba[i + 1] <= threshold && rgba[i + 2] <= threshold) {
      rgba[i + 3] = 0;
      n++;
    }
  }
  return n;
}

/** https://host/path -> nodata-black://host/path (only https sources are ever rewritten). */
export function withNodataKey(url: string): string {
  return url.startsWith('https://') ? `${NODATA_PROTOCOL}://${url.slice('https://'.length)}` : url;
}

const toHttps = (url: string) => `https://${url.slice(`${NODATA_PROTOCOL}://`.length)}`;

async function keyedPng(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(toHttps(url), { signal });
  // a failed tile must surface as a map error (MapView reports it), never as an empty transparent tile
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${toHttps(url)}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bmp.width, bmp.height)
      : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas unavailable for no-data keying');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  keyBlackToTransparent(img.data);
  ctx.putImageData(img, 0, 0);
  const blob =
    typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise<Blob>((ok, bad) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? ok(b) : bad(new Error('PNG encode failed'))), 'image/png'));
  return blob.arrayBuffer();
}

let registered = false;

/** Register once (idempotent). `addProtocol` is MapLibre's custom-protocol hook (v4+ promise API). */
export function registerNodataProtocol(lib: {
  addProtocol: (name: string, fn: (params: { url: string }, abort: AbortController) => Promise<{ data: ArrayBuffer }>) => void;
}) {
  if (registered) return;
  registered = true;
  lib.addProtocol(NODATA_PROTOCOL, async (params, abort) => ({ data: await keyedPng(params.url, abort.signal) }));
}
