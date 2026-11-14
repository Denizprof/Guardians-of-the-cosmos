// Regression tests for the multi-agent code review fixes (data layer). Synthetic inputs; fetch is stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tierOf, nisarCoverage } from '../../src/services';
import { queryEarthdata, parseCollectionEntries, windowAround } from '../../src/earthdata';
import { fmtDatePrecise, isCoarseDate, loadCatalog, loadData } from '../../src/lib';
import { loadLayerCatalog } from '../../src/layers';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) =>
  ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
  }) as unknown as Response;

describe('tierOf never defaults to VALIDATED', () => {
  it('maps known collection names', () => {
    expect(tierOf('NISAR_UR_L2_GCOV_V1')).toBe('URGENT RESPONSE');
    expect(tierOf('NISAR_L2_GCOV_BETA_V1')).toBe('BETA');
    expect(tierOf('NISAR_L2_GCOV_PROVISIONAL_V1')).toBe('PROVISIONAL');
    expect(tierOf('NISAR_L2_GCOV_V1')).toBe('VALIDATED');
  });
  it('labels unknown, empty or renamed collections UNKNOWN', () => {
    expect(tierOf('')).toBe('UNKNOWN');
    expect(tierOf('SOMETHING_NEW')).toBe('UNKNOWN');
    expect(tierOf('nisar_l2_gcov_v1')).toBe('UNKNOWN');
  });
});

describe('nisarCoverage truncation and urgent-response counts', () => {
  const feat = (i: number, coll: string) => ({
    properties: { sceneName: `S${i}`, collectionName: coll, processingLevel: 'GCOV', startTime: `2026-01-0${(i % 9) + 1}T00:00:00Z`, pathNumber: 1, frameNumber: 2, browse: ['javascript:alert(1)//thumbnail'] },
    geometry: { type: 'Polygon', coordinates: [] },
  });
  it('judges truncation on the raw response (before urgent-response rows are dropped)', async () => {
    const features = Array.from({ length: 250 }, (_, i) => feat(i, i < 2 ? 'NISAR_UR_L2_GCOV_V1' : 'NISAR_L2_GCOV_BETA_V1'));
    vi.stubGlobal('fetch', vi.fn(async () => json({ features })));
    const r = await nisarCoverage(1, 2);
    expect(r.total).toBe(248);
    expect(r.truncated).toBe(true);
    expect(r.urgentResponse).toBe(2);
  });
  it('drops non-http(s) thumbnail URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ features: [feat(1, 'NISAR_L2_GCOV_BETA_V1')] })));
    const r = await nisarCoverage(1, 2);
    expect(r.granules[0].thumb).toBeUndefined();
    expect(r.truncated).toBe(false);
  });
});

describe('Earthdata availability is never reported as "none" when it is unknown', () => {
  const coll = (id: string, extra: object = {}) => ({ id, short_name: id, ...extra });
  const q = { lon: 10, lat: 20, start: '2026-01-01T00:00:00Z', end: '2026-01-07T00:00:00Z' };
  it('a missing CMR-Hits header counts as unchecked, not as 0 granules', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('collections.json') ? json({ feed: { entry: [coll('C1-A'), coll('C2-B')] } }) : json({}, { headers: {} })
    );
    const r = await queryEarthdata({ ...q, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.totalCollections).toBe(0);
    expect(r.uncheckedCollections).toBe(2);
  });
  it('a numeric CMR-Hits header is used', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('collections.json') ? json({ feed: { entry: [coll('C1-A')] } }) : json({}, { headers: { 'CMR-Hits': '42' } })
    );
    const r = await queryEarthdata({ ...q, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.totalGranules).toBe(42);
    expect(r.uncheckedCollections).toBe(0);
  });
  it('an entry without short_name is kept (labelled by its id) instead of crashing the grouping', () => {
    const [e] = parseCollectionEntries({ feed: { entry: [{ id: 'C9-X' }] } });
    expect(e.short_name).toBe('C9-X');
  });
  it('windowAround treats an offset-less time as UTC', () => {
    expect(windowAround('2026-01-10T12:00:00', 1).start).toBe('2026-01-09T12:00:00.000Z');
  });
});

describe('coarse dates are shown at the precision the source knows', () => {
  it('year / month / day precision', () => {
    expect(fmtDatePrecise('2002-01-01T00:00:00.000Z', 'year')).toBe('2002');
    expect(fmtDatePrecise('2002-03-01T00:00:00.000Z', 'month')).toBe('Mar 2002');
    expect(fmtDatePrecise('2002-03-07T00:00:00.000Z', 'day')).toBe('7 Mar 2002');
    expect(fmtDatePrecise('2002-03-07T00:00:00.000Z', undefined)).toBe('7 Mar 2002');
    expect(isCoarseDate('year') && isCoarseDate('month') && !isCoarseDate('day') && !isCoarseDate(undefined)).toBe(true);
  });
});

describe('loaders surface failures instead of returning "empty"', () => {
  it('loadCatalog: a failed load is retryable (not cached forever)', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({}, { ok: false, status: 503 })).mockResolvedValueOnce(json({ events: [{ id: 'x' }] }));
    vi.stubGlobal('fetch', f);
    await expect(loadCatalog('retry-test')).rejects.toThrow(/HTTP 503/);
    await expect(loadCatalog('retry-test')).resolves.toMatchObject({ events: [{ id: 'x' }] });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('loadCatalog: a body without an events array is an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ nope: true })));
    await expect(loadCatalog('shape-test')).rejects.toThrow(/no events array/);
  });
  it('loadData: a context.json failure is reported, not silently empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('events.json') ? json({ events: [], generated: 'g' }) : json({}, { ok: false, status: 500 }))));
    const d = await loadData();
    expect(d.context).toEqual([]);
    expect(d.contextError).toMatch(/HTTP 500/);
  });
  it('loadData: events.json without an events array throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ generated: 'g' })));
    await expect(loadData()).rejects.toThrow(/no events array/);
  });
  it('loadLayerCatalog: HTTP errors throw and malformed rows are dropped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, { ok: false, status: 404 })));
    await expect(loadLayerCatalog()).rejects.toThrow(/HTTP 404/);
    vi.stubGlobal('fetch', vi.fn(async () => json({ layers: [{ id: 'a', title: 'A', category: 'water' }, { id: 1 }, null] })));
    expect((await loadLayerCatalog()).map((l) => l.id)).toEqual(['a']);
  });
});

import { buildContext, buildEventContext } from '../../src/assistant/context';
import type { SarEvent, SarLayer } from '../../src/types';

describe('assistant context stays truthful and schema-sized', () => {
  const layer = (over: Partial<SarLayer>): SarLayer =>
    ({
      id: 'l1', role: 'after', kind: 'change', product: 'GCOV', url: 'x', coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]],
      acquisition: { start: '2026-01-01T00:00:00Z' },
      provenance: { mission: 'NISAR', sensor: 'L-SAR', granule: 'G', collection: 'C', tier: 'BETA', crid: 'X', track: 1, frame: 2, direction: 'ASCENDING', polarizations: null, processing_date: '', browse_source: '', product_url: 'https://x', distributor: 'ASF', credit: 'c', processing: ['step'] },
      ...over,
    }) as SarLayer;
  it('describes layers with the same evidence class as the UI badge, and leaves out what it cannot describe truthfully', () => {
    const ctx = buildContext({ layers: [layer({ id: 'obs', kind: 'browse' }), layer({ id: 'der' }), layer({ id: 'interp', evidence: 'interpretation' })] });
    expect(ctx.selected_layers?.map((l) => [l.layer_id, l.type])).toEqual([['obs', 'observation'], ['der', 'derived']]);
  });
  it('clips over-long event text to the request schema limits instead of producing a rejected request', () => {
    const ev = { id: 'e', title: 'T'.repeat(500), subtitle: 's', category: 'flood', date: '2026-01-01', technique: 'backscatter', location: { lon: 0, lat: 0 }, references: Array.from({ length: 25 }, (_, i) => ({ label: `r${i}`, url: 'https://x' })), layers: [] } as unknown as SarEvent;
    const c = buildEventContext(ev);
    expect(c.title.length).toBe(300);
    expect(c.references).toHaveLength(20);
  });
});

import { keyBlackToTransparent, withNodataKey, NODATA_PROTOCOL } from '../../src/map/nodataKey';
import { toOverlay, type CatalogLayer } from '../../src/layers';

describe('JPEG no-data (solid black) is drawn transparent, real imagery is kept', () => {
  it('keys pixels whose channels are all <= 10 and leaves dark-but-real pixels opaque', () => {
    const px = new Uint8ClampedArray([
      0, 0, 0, 255, //     no-data
      8, 6, 9, 255, //     JPEG ringing at the no-data edge
      20, 40, 70, 255, //  dark ocean (real)
      11, 0, 0, 255, //    one channel above the threshold: kept
      200, 180, 150, 255, // land
    ]);
    expect(keyBlackToTransparent(px)).toBe(2);
    expect([px[3], px[7], px[11], px[15], px[19]]).toEqual([0, 0, 255, 255, 255]);
  });
  it('rewrites only https tile URLs to the keying protocol', () => {
    expect(withNodataKey('https://gibs.example/a/{z}/{y}/{x}.jpg')).toBe(`${NODATA_PROTOCOL}://gibs.example/a/{z}/{y}/{x}.jpg`);
    expect(withNodataKey('http://x/y.jpg')).toBe('http://x/y.jpg');
  });
  it('toOverlay applies the protocol only to layers flagged nodata: black', () => {
    const base = { id: 'v', url: 'https://gibs.example/L/default/{time}/{z}/{y}/{x}.jpg', tileSize: 256, minzoom: 0, maxzoom: 9, attribution: 'a', time: null } as unknown as CatalogLayer;
    expect(toOverlay({ ...base, nodata: 'black' }, null, 1).url.startsWith(`${NODATA_PROTOCOL}://`)).toBe(true);
    expect(toOverlay(base, null, 1).url.startsWith('https://')).toBe(true);
  });
});
