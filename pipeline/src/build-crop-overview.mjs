// Pre-renders the whole-world view (zooms 0 to 3) of the farmland and crop-type layer.
//
//   node pipeline/src/build-crop-overview.mjs
//
// The ESA WorldCereal tile service (titiler.terrascope.be) starts at zoom 3, but the app opens on a globe at
// zoom 1 to 2. This script downloads the service's 64 zoom-3 tiles for each of the four crop products, stacks
// them the same way the app does (web/src/map/cropTiles.ts), keeps that as zoom 3 and shrinks it into zooms 0,
// 1 and 2: 85 tiles in all, so the world view needs no request to the provider. Written to web/public/data/crops/{z}/{x}/{y}.png with a manifest.
//
// Shrinking rule (see `downsample`): an output pixel covers a block of zoom-3 samples. It is coloured when at
// least MIN_SHARE of them are mapped as crops, in the colour of the most common crop class among those. No
// value is invented: every coloured pixel stands for provider-classified samples.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = 'https://titiler.terrascope.be/wmts';
// Must stay identical to CROP_CLASSES in web/src/map/cropTiles.ts (a unit test compares the manifest with it).
export const CLASSES = [
  { product: 'temporarycrops', color: '#009e73' },
  { product: 'springcereals', color: '#56b4e9' },
  { product: 'wintercereals', color: '#d55e00' },
  { product: 'maize', color: '#f0e442' },
];
export const MIN_SHARE = 0.25;
const SRC_ZOOM = 3;
const TILE = 256;

/**
 * Shrink a square grid of class codes (0 = no crop, 1..n = class, higher = more specific) by `factor`.
 * A block becomes the most common non-zero class in it, when at least `minShare` of the block is non-zero;
 * ties go to the more specific class. Otherwise 0.
 */
export function downsample(grid, size, factor, minShare = MIN_SHARE, nClasses = CLASSES.length) {
  const outSize = size / factor;
  const out = new Uint8Array(outSize * outSize);
  const counts = new Uint32Array(nClasses + 1);
  const need = Math.max(1, Math.ceil(minShare * factor * factor));
  for (let oy = 0; oy < outSize; oy++) {
    for (let ox = 0; ox < outSize; ox++) {
      counts.fill(0);
      let covered = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (oy * factor + dy) * size + ox * factor;
        for (let dx = 0; dx < factor; dx++) {
          const c = grid[row + dx];
          if (c) { counts[c]++; covered++; }
        }
      }
      if (covered < need) continue;
      let best = 0;
      for (let c = 1; c <= nClasses; c++) if (counts[c] && counts[c] >= counts[best]) best = c;
      out[oy * outSize + ox] = best;
    }
  }
  return out;
}

const tileUrl = (product, color, z, x, y) => {
  const q = new URLSearchParams({
    service: 'WMTS', request: 'GetTile', version: '1.0.0',
    layer: `esa-worldcereal-${product}-10m-2021-v1_classification`,
    style: 'default', format: 'image/png',
    TileMatrixSet: 'EPSG:3857', TileMatrix: String(z), TileCol: String(x), TileRow: String(y),
    TIME: '2021-01-01',
    colormap: JSON.stringify({ '100': color }),
  });
  return `${SERVICE}?${q}`;
};

async function fetchTile(url, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  // a missing tile must stop the build: an empty tile would read as "no crops here"
  throw new Error(`${url}: ${last?.message ?? last}`);
}

async function main() {
  const { default: sharp } = await import('sharp');
  const n = 2 ** SRC_ZOOM;
  const size = n * TILE;
  const grid = new Uint8Array(size * size);
  const jobs = [];
  for (let ci = 0; ci < CLASSES.length; ci++) for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) jobs.push({ ci, x, y });
  let done = 0;
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const { ci, x, y } = job;
      const png = await fetchTile(tileUrl(CLASSES[ci].product, CLASSES[ci].color, SRC_ZOOM, x, y));
      // the service answers a tile with nothing in it (open ocean) with a 1x1 transparent PNG
      const { data, info } = await sharp(png).ensureAlpha().resize(TILE, TILE, { kernel: 'nearest', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      if (info.width !== TILE || info.height !== TILE || info.channels !== 4) throw new Error(`unexpected tile ${info.width}x${info.height}x${info.channels}`);
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          if (data[(py * TILE + px) * 4 + 3] < 128) continue;
          const g = (y * TILE + py) * size + x * TILE + px;
          if (grid[g] < ci + 1) grid[g] = ci + 1; // the more specific class wins, as in the app's stacking
        }
      }
      if (++done % 32 === 0) console.log(`${done}/${CLASSES.length * n * n} tiles`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  const rgb = CLASSES.map((c) => [parseInt(c.color.slice(1, 3), 16), parseInt(c.color.slice(3, 5), 16), parseInt(c.color.slice(5, 7), 16)]);
  const outDir = path.resolve(here, '../../web/public/data/crops');
  let tiles = 0;
  for (let z = 0; z <= SRC_ZOOM; z++) {
    const factor = 2 ** (SRC_ZOOM - z);
    const small = downsample(grid, size, factor);
    const sSize = size / factor;
    for (let x = 0; x < 2 ** z; x++) {
      for (let y = 0; y < 2 ** z; y++) {
        const buf = Buffer.alloc(TILE * TILE * 4);
        for (let py = 0; py < TILE; py++) {
          for (let px = 0; px < TILE; px++) {
            const c = small[(y * TILE + py) * sSize + x * TILE + px];
            if (!c) continue;
            const o = (py * TILE + px) * 4;
            buf[o] = rgb[c - 1][0]; buf[o + 1] = rgb[c - 1][1]; buf[o + 2] = rgb[c - 1][2]; buf[o + 3] = 255;
          }
        }
        const dir = path.join(outDir, String(z), String(x));
        fs.mkdirSync(dir, { recursive: true });
        await sharp(buf, { raw: { width: TILE, height: TILE, channels: 4 } }).png({ palette: true, compressionLevel: 9 }).toFile(path.join(dir, `${y}.png`));
        tiles++;
      }
    }
  }
  const manifest = {
    source: 'ESA WorldCereal 2021 v100 (10 m), tiles by Terrascope (titiler.terrascope.be), zoom 3',
    retrieved: new Date().toISOString(),
    rule: `Zoom 3 is the service's own tiles, stacked. Below that, a pixel is coloured when at least ${MIN_SHARE * 100}% of the zoom-3 samples it covers are mapped as crops, in the colour of the most common class among them (ties: the more specific class).`,
    classes: CLASSES,
    tiles,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`wrote ${tiles} tiles to ${outDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
