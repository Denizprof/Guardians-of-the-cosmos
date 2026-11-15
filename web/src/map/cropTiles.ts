/**
 * Farmland and crop types: one map layer made from four ESA WorldCereal 2021 products.
 *
 * WorldCereal (ESA; VITO and partners) maps the world's temporary crops at 10 m from Sentinel-1 radar and
 * Sentinel-2, and within them maize, winter cereals and spring cereals (wheat, barley and rye; the project
 * could not tell those three apart reliably). Each is a separate yes/no map, served as tiles by Terrascope
 * (titiler.terrascope.be). The service takes a colour table with each request, so this module asks for each
 * product in one colour of its own, with "not this crop" and "no data" left transparent, and stacks the four
 * tiles from the most general (any temporary crop) to the most specific (maize) into a single tile.
 *
 * Nothing is computed or guessed here: every coloured pixel is a pixel the provider classified. Other crops
 * (rice, soybean, cotton, vegetables ...) are not separate products, so they show in the "other crops" colour;
 * orchards, vineyards, plantations and pastures are not mapped at all. The layer's legend says so.
 *
 * The service starts at zoom 3. For the whole-world view, zooms 0 to 3 are pre-rendered from its zoom-3 tiles
 * by pipeline/src/build-crop-overview.mjs and shipped in public/data/crops (85 small files), so opening the
 * layer on the globe costs the provider no requests; from zoom 4 on the tiles come live from the service.
 */
export const CROP_PROTOCOL = 'worldcereal';
export const CROP_LAYER_ID = 'esa-worldcereal-crops-2021';
export const CROP_LIVE_MIN_ZOOM = 4;
const SERVICE = 'https://titiler.terrascope.be/wmts';
const TILE_PX = 256;

/** Draw order: bottom to top. Colours are the colour-blind-safe Okabe-Ito set; they are this app's choice. */
export const CROP_CLASSES = [
  { product: 'temporarycrops', color: '#009e73', label: 'Other temporary crops' },
  { product: 'springcereals', color: '#56b4e9', label: 'Spring cereals (wheat, barley, rye)' },
  { product: 'wintercereals', color: '#d55e00', label: 'Winter cereals (wheat, barley, rye)' },
  { product: 'maize', color: '#f0e442', label: 'Maize' },
] as const;

export interface TileXYZ { z: number; x: number; y: number }

/** worldcereal://2021/{z}/{x}/{y} -> tile address, or null when the URL is not one of ours. */
export function parseCropUrl(url: string): TileXYZ | null {
  const prefix = `${CROP_PROTOCOL}://2021/`;
  if (!url.startsWith(prefix)) return null;
  const parts = url.slice(prefix.length).split('/');
  if (parts.length !== 3 || !parts.every((p) => /^[0-9]{1,7}$/.test(p))) return null;
  const [z, x, y] = parts.map(Number);
  if (z > 22 || x >= 2 ** z || y >= 2 ** z) return null;
  return { z, x, y };
}

/** The image(s) that make up one tile, bottom first. `base` is the page address the shipped tiles hang off. */
export function cropTileRequests({ z, x, y }: TileXYZ, base: string): string[] {
  if (z < CROP_LIVE_MIN_ZOOM) return [new URL(`data/crops/${z}/${x}/${y}.png`, base).href];
  return CROP_CLASSES.map((c) => {
    const q = new URLSearchParams({
      service: 'WMTS', request: 'GetTile', version: '1.0.0',
      layer: `esa-worldcereal-${c.product}-10m-2021-v1_classification`,
      style: 'default', format: 'image/png',
      TileMatrixSet: 'EPSG:3857', TileMatrix: String(z), TileCol: String(x), TileRow: String(y),
      TIME: '2021-01-01',
      colormap: JSON.stringify({ '100': c.color }),
    });
    return `${SERVICE}?${q}`;
  });
}

async function composite(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const tile = parseCropUrl(url);
  if (!tile) throw new Error(`not a crop tile address: ${url}`);
  const requests = cropTileRequests(tile, document.baseURI);
  // A failed part fails the whole tile, so MapView reports it. A tile with one crop silently missing would
  // look like "no maize here", which is a claim the data did not make.
  const blobs = await Promise.all(requests.map((u) => fetchPart(u, signal)));
  if (blobs.length === 1) return blobs[0].arrayBuffer();
  signal.throwIfAborted();
  const decoded = await Promise.allSettled(blobs.map((b) => createImageBitmap(b)));
  const bitmaps = decoded.flatMap((d) => (d.status === 'fulfilled' ? [d.value] : []));
  try {
    const bad = decoded.find((d) => d.status === 'rejected');
    if (bad) throw new Error('a crop tile part is not an image');
    // Fixed size: the service answers a tile with nothing in it (open ocean) with a 1x1 transparent PNG,
    // which is stretched over the tile like any other part.
    const width = TILE_PX;
    const height = TILE_PX;
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2D canvas unavailable for the crop layer');
    ctx.imageSmoothingEnabled = false; // classes, not a photograph: never blend two crop colours
    for (const bmp of bitmaps) ctx.drawImage(bmp, 0, 0, width, height);
    const out =
      typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise<Blob>((ok, fail) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? ok(b) : fail(new Error('PNG encode failed'))), 'image/png'));
    return await out.arrayBuffer();
  } finally {
    for (const bmp of bitmaps) bmp.close();
  }
}

export const PART_TRIES = 3;
const retryable = (status: number) => status === 429 || status >= 500;

/**
 * One part of a tile, with up to PART_TRIES attempts: the service drops some connections under a burst of
 * requests, and a tile needs all four parts. Retries a dropped connection, HTTP 429 and 5xx, after a short
 * growing pause; any other answer, and the last failure, is an error.
 */
export async function fetchPart(url: string, signal: AbortSignal, pauseMs = 300): Promise<Blob> {
  let last: unknown;
  for (let attempt = 0; attempt < PART_TRIES; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, pauseMs * attempt));
    signal.throwIfAborted();
    try {
      const res = await fetch(url, { signal });
      if (res.ok) return await res.blob();
      last = new Error(`HTTP ${res.status} for ${url}`);
      if (!retryable(res.status)) break;
    } catch (e) {
      if (signal.aborted) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(`failed to load ${url}`);
}

let registered = false;

/** Register once (idempotent). `addProtocol` is MapLibre's custom-protocol hook (v4+ promise API). */
export function registerCropProtocol(lib: {
  addProtocol: (name: string, fn: (params: { url: string }, abort: AbortController) => Promise<{ data: ArrayBuffer }>) => void;
}) {
  if (registered) return;
  registered = true;
  lib.addProtocol(CROP_PROTOCOL, async (params, abort) => ({ data: await composite(params.url, abort.signal) }));
}
