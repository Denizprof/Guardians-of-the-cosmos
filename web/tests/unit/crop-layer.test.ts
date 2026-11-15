// The farmland and crop-type satellite layer (ESA WorldCereal 2021): map/cropTiles.ts, its entry in layers.json
// and the pre-rendered world-view tiles in public/data/crops.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CROP_CLASSES, CROP_LAYER_ID, CROP_LIVE_MIN_ZOOM, CROP_PROTOCOL, PART_TRIES, cropTileRequests, fetchPart, parseCropUrl } from '../../src/map/cropTiles';
import { cleanLegend } from '../../src/components/LayerLegend';
import { toOverlay, type CatalogLayer } from '../../src/layers';
import shippedLayers from '../../public/data/layers.json';

const layer = (shippedLayers as unknown as { layers: CatalogLayer[] }).layers.find((l) => l.id === CROP_LAYER_ID)!;
const cropsDir = path.resolve(__dirname, '../../public/data/crops');

describe('crop classes', () => {
  it('four classes, each with its own colour, drawn from the most general to the most specific', () => {
    expect(CROP_CLASSES.map((c) => c.product)).toEqual(['temporarycrops', 'springcereals', 'wintercereals', 'maize']);
    for (const c of CROP_CLASSES) expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(CROP_CLASSES.map((c) => c.color)).size).toBe(4);
  });
});

describe('tile requests', () => {
  it('parses the layer URL and refuses anything else', () => {
    expect(parseCropUrl(`${CROP_PROTOCOL}://2021/5/9/12`)).toEqual({ z: 5, x: 9, y: 12 });
    for (const bad of [`${CROP_PROTOCOL}://2021/5/9`, `${CROP_PROTOCOL}://2021/a/9/12`, `${CROP_PROTOCOL}://2021/5/40/12`, 'https://2021/5/9/12', `${CROP_PROTOCOL}://2021/5/9/-1`]) {
      expect(parseCropUrl(bad), bad).toBeNull();
    }
  });

  it('from zoom 4 on: one request per crop class to the Terrascope WorldCereal service, each recoloured to its class colour only', () => {
    const urls = cropTileRequests({ z: 5, x: 9, y: 12 }, 'https://globalsar.earth/');
    expect(urls).toHaveLength(4);
    urls.forEach((u, i) => {
      const url = new URL(u);
      expect(url.origin).toBe('https://titiler.terrascope.be');
      const q = url.searchParams;
      expect(q.get('layer')).toBe(`esa-worldcereal-${CROP_CLASSES[i].product}-10m-2021-v1_classification`);
      expect([q.get('TileMatrix'), q.get('TileCol'), q.get('TileRow')]).toEqual(['5', '9', '12']);
      expect(q.get('TileMatrixSet')).toBe('EPSG:3857');
      expect(q.get('TIME')).toBe('2021-01-01');
      // only value 100 ("this crop") gets a colour: "not this crop" (0) and no data (255) stay transparent
      expect(JSON.parse(q.get('colormap')!)).toEqual({ '100': CROP_CLASSES[i].color });
    });
  });

  it('below zoom 4: one pre-rendered tile shipped with the app, so the world view asks the provider for nothing', () => {
    expect(CROP_LIVE_MIN_ZOOM).toBe(4);
    expect(cropTileRequests({ z: 3, x: 7, y: 0 }, 'https://globalsar.earth/')).toEqual(['https://globalsar.earth/data/crops/3/7/0.png']);
    expect(cropTileRequests({ z: 2, x: 1, y: 3 }, 'https://globalsar.earth/sub/')).toEqual(['https://globalsar.earth/sub/data/crops/2/1/3.png']);
    expect(cropTileRequests({ z: 0, x: 0, y: 0 }, 'http://localhost:5173/')).toEqual(['http://localhost:5173/data/crops/0/0/0.png']);
  });
});

describe('the catalog entry (layers.json)', () => {
  it('exists, is a derived product for one fixed year, and draws through the crop protocol', () => {
    expect(layer).toBeTruthy();
    expect(layer.kind).toBe('derived');
    expect(layer.time).toBeNull();
    expect(layer.title).toMatch(/2021/);
    expect(layer.license).toMatch(/CC.BY 4\.0/);
    const o = toOverlay(layer, null, 0.8);
    expect(o.url).toBe(`${CROP_PROTOCOL}://2021/{z}/{x}/{y}`);
    expect(o.minzoom).toBe(0);
  });

  it('the legend lists exactly the colours the tiles are drawn with, most specific first', () => {
    const g = cleanLegend(layer.legend)!;
    expect(g.type).toBe('classes');
    expect(g.classes!.map((c) => c.color)).toEqual([...CROP_CLASSES].reverse().map((c) => c.color));
    expect(g.classes![0].label).toMatch(/maize/i);
    expect(g.source.url).toMatch(/^https:\/\//);
  });

  it('says plainly what the map cannot tell apart', () => {
    const text = `${layer.limitations} ${(layer.legend as { note?: string }).note ?? ''} ${layer.description_simple}`;
    expect(text).toMatch(/rice/i); // not a separate class
    expect(text).toMatch(/orchards|perennial/i); // not mapped at all
    expect(text).toMatch(/2021/);
  });
});

describe('pre-rendered world-view tiles (public/data/crops)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(cropsDir, 'manifest.json'), 'utf8')) as { classes: { product: string; color: string }[]; tiles: number; retrieved: string };
  it('cover zooms 0 to 3 completely, as PNG files', () => {
    let n = 0;
    for (let z = 0; z < CROP_LIVE_MIN_ZOOM; z++) {
      for (let x = 0; x < 2 ** z; x++) {
        for (let y = 0; y < 2 ** z; y++) {
          const buf = fs.readFileSync(path.join(cropsDir, String(z), String(x), `${y}.png`));
          expect(buf.subarray(0, 8).toString('hex'), `${z}/${x}/${y}`).toBe('89504e470d0a1a0a');
          n++;
        }
      }
    }
    expect(n).toBe(85);
    expect(manifest.tiles).toBe(85);
  });
  it('were drawn with the same colours as the live tiles', () => {
    expect(manifest.classes).toEqual(CROP_CLASSES.map((c) => ({ product: c.product, color: c.color })));
    expect(Number.isNaN(Date.parse(manifest.retrieved))).toBe(false);
  });
});

// A tile needs all four parts, and the service drops some connections under load: a part is tried again
// before the tile is given up, and a tile that still fails is an error, never an empty picture.
describe('loading one part of a tile', () => {
  afterEach(() => vi.unstubAllGlobals());
  const png = () => new Response('x', { status: 200 });
  const signal = () => new AbortController().signal;

  it('tries again after a dropped connection and after HTTP 503 or 429', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('reset')).mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(png());
    vi.stubGlobal('fetch', f);
    expect((await fetchPart('https://x/t', signal(), 0)).size).toBe(1);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('gives up with an error after the last try', async () => {
    const f = vi.fn().mockResolvedValue(new Response('', { status: 502 }));
    vi.stubGlobal('fetch', f);
    await expect(fetchPart('https://x/t', signal(), 0)).rejects.toThrow(/HTTP 502/);
    expect(f).toHaveBeenCalledTimes(PART_TRIES);
  });
  it('does not retry an answer that will not change (HTTP 400, 404)', async () => {
    const f = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', f);
    await expect(fetchPart('https://x/t', signal(), 0)).rejects.toThrow(/HTTP 404/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('stops at once when the map no longer wants the tile', async () => {
    const c = new AbortController();
    c.abort();
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(fetchPart('https://x/t', c.signal, 0)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
