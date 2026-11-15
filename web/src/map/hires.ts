import * as maplibregl from 'maplibre-gl';

// Esri World Imagery answers HTTP 200 with a flat grey "Map data not yet available" tile wherever its photos
// end, so MapLibre cannot tell it from a real tile. This loader fetches the tile itself, recognises that
// placeholder and returns a transparent pixel instead, so the Sentinel-2 imagery underneath stays visible.
export const HIRES_PROTOCOL = 'esrihires';
export const HIRES_URL = `${HIRES_PROTOCOL}://{z}/{y}/{x}`;

const BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
// 1x1 fully transparent PNG
const CLEAR = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0)).buffer;

/** True for Esri's flat grey placeholder: nearly every pixel is the same light grey (the text is a few white strokes). */
export function isPlaceholder(rgba: Uint8ClampedArray | Uint8Array): boolean {
  let grey = 0;
  const total = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    if (Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && r > 185 && r < 225) grey++;
  }
  return total > 0 && grey / total > 0.9;
}

async function looksEmpty(blob: Blob): Promise<boolean> {
  const bmp = await createImageBitmap(blob);
  const size = 32;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return isPlaceholder(ctx.getImageData(0, 0, size, size).data);
}

let registered = false;
export function registerHires(): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(HIRES_PROTOCOL, async (params, abort) => {
    const [z, y, x] = params.url.slice(HIRES_PROTOCOL.length + 3).split('/').map(Number);
    const res = await fetch(`${BASE}/${z}/${y}/${x}`, { signal: abort.signal });
    if (!res.ok) throw new Error(`Esri tile ${z}/${y}/${x}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    // Photos always exist at the low levels; only look inside tiles deep enough for coverage to run out.
    if (z >= 13) {
      try {
        if (await looksEmpty(new Blob([buf], { type: 'image/jpeg' }))) return { data: CLEAR };
      } catch {
        // cannot decode here: show the tile as delivered
      }
    }
    return { data: buf };
  });
}
