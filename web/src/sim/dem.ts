// Loads a real elevation grid around a point from the AWS Terrain Tiles (Terrarium encoding), the same DEM the
// globe uses for 3-D relief: elevation = R·256 + G + B/256 − 32768 metres.
import type { Dem } from './flood';

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TILE = 256;
const MAX_CELLS = 200; // per side: keeps a run to a few seconds in a worker
const EQ_M_PER_PX0 = 156543.03392804097; // m per pixel at zoom 0 on the equator

export const decodeTerrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;

const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const latToY = (lat: number, z: number) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z; };
const xToLon = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180;
const yToLat = (y: number, z: number) => { const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z); return (180 / Math.PI) * Math.atan(Math.sinh(n)); };

/** Zoom and pixel window for a square domain of `km` around (lat, lon), at most MAX_CELLS per side. */
export function planGrid(lat: number, lon: number, km: number, maxCells = MAX_CELLS): { z: number; x0: number; y0: number; size: number; dx: number } {
  const cos = Math.cos((lat * Math.PI) / 180);
  let z = 14;
  while (z > 1 && (km * 1000) / ((EQ_M_PER_PX0 * cos) / 2 ** z) > maxCells) z--;
  const dx = (EQ_M_PER_PX0 * cos) / 2 ** z;
  const size = Math.max(16, Math.min(maxCells, Math.round((km * 1000) / dx)));
  const cx = lonToX(lon, z);
  const cy = latToY(lat, z);
  return { z, x0: Math.round(cx - size / 2), y0: Math.round(cy - size / 2), size, dx };
}

export type TileLoader = (z: number, x: number, y: number, signal?: AbortSignal) => Promise<ImageData>;

/** Browser tile loader: fetch PNG → ImageBitmap → pixels. */
export const browserTileLoader: TileLoader = async (z, x, y, signal) => {
  const url = TERRARIUM_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url, { signal, mode: 'cors' });
  if (!res.ok) throw new Error(`Elevation tile ${z}/${x}/${y} failed (HTTP ${res.status})`);
  const bmp = await createImageBitmap(await res.blob());
  const c = new OffscreenCanvas(TILE, TILE);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No 2-D canvas available to decode elevation tiles');
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, TILE, TILE);
};

export async function loadDem(lat: number, lon: number, km: number, loader: TileLoader = browserTileLoader, signal?: AbortSignal, maxCells = MAX_CELLS): Promise<Dem> {
  const { z, x0, y0, size, dx } = planGrid(lat, lon, km, maxCells);
  const n = 2 ** z;
  const tiles = new Map<string, ImageData>();
  const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x0 + size - 1) / TILE);
  const ty0 = Math.max(0, Math.floor(y0 / TILE)), ty1 = Math.min(n - 1, Math.floor((y0 + size - 1) / TILE));
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const wx = ((tx % n) + n) % n;
    jobs.push(loader(z, wx, ty, signal).then((img) => { tiles.set(`${tx}/${ty}`, img); }));
  }
  await Promise.all(jobs);
  const zArr = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    const py = Math.min(n * TILE - 1, Math.max(0, y0 + j));
    for (let i = 0; i < size; i++) {
      const px = x0 + i;
      const img = tiles.get(`${Math.floor(px / TILE)}/${Math.floor(py / TILE)}`);
      if (!img) throw new Error('Missing elevation tile');
      const o = (((py % TILE) * TILE) + (((px % TILE) + TILE) % TILE)) * 4;
      zArr[j * size + i] = decodeTerrarium(img.data[o], img.data[o + 1], img.data[o + 2]);
    }
  }
  const W = xToLon(x0, z), E = xToLon(x0 + size, z), N = yToLat(y0, z), S = yToLat(y0 + size, z);
  // Web Mercator cells are square but shrink with latitude: true size per row, for ocean-scale grids
  const rowLat = new Float32Array(size);
  const dxRows = new Float32Array(size);
  for (let j = 0; j < size; j++) { rowLat[j] = yToLat(y0 + j + 0.5, z); dxRows[j] = (EQ_M_PER_PX0 * Math.cos((rowLat[j] * Math.PI) / 180)) / 2 ** z; }
  return { nx: size, ny: size, dx, rowLat, dxRows, z: zArr, corners: [[W, N], [E, N], [E, S], [W, S]], source: `AWS Terrain Tiles (Terrarium), zoom ${z}` };
}
