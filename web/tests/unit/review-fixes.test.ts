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

describe('sub-daily layers ask the service for its latest image', () => {
  it('drops the {time} segment (computed 10-minute slots are published irregularly and 404)', () => {
    const goes = { id: 'g', url: 'https://gibs.example/L/default/{time}/M/{z}/{y}/{x}.png', tileSize: 256, minzoom: 0, maxzoom: 7, attribution: 'a', time: { start: '2026-11-10', end: 'present', step: 'PT10M', default: '' } } as unknown as CatalogLayer;
    expect(toOverlay(goes, null, 1).url).toBe('https://gibs.example/L/default/M/{z}/{y}/{x}.png');
  });
});

import { buildPointUrl, meteomaticsMiddleware, parsePointQuery, parsePointResponse, METEOMATICS_PARAMS } from '../../meteomatics-proxy';
import { formatWeatherValue } from '../../src/components/WeatherSection';

describe('Meteomatics server route', () => {
  const call = async (env: Record<string, string>, path: string, upstream?: (url: string, init: RequestInit) => Promise<Response>) => {
    const seen: { url: string; init: RequestInit }[] = [];
    const mw = meteomaticsMiddleware(env, (async (u: string, i: RequestInit) => { seen.push({ url: u, init: i }); return upstream!(u, i); }) as unknown as typeof fetch);
    let body = ''; let nexted = false;
    const res = { statusCode: 0, setHeader() {}, end(b: string) { body = b; } };
    await mw({ url: path, method: 'GET' } as never, res as never, () => { nexted = true; });
    return { status: res.statusCode, json: body ? JSON.parse(body) : null, raw: body, seen, nexted };
  };
  const creds = { METEOMATICS_USERNAME: 'test-user', METEOMATICS_PASSWORD: 'TEST-PASS-NOT-REAL' };
  const good = { data: [{ parameter: 't_2m:C', coordinates: [{ lat: 1, lon: 2, dates: [{ date: '2026-11-14T12:00:00Z', value: 12.3 }] }] }] };

  it('validates the point and time, and builds a fixed-parameter URL with no credentials in it', () => {
    expect(parsePointQuery(new URLSearchParams('lat=95&lon=0'))).toMatch(/out of range/);
    expect(parsePointQuery(new URLSearchParams('lon=0'))).toMatch(/required/);
    expect(parsePointQuery(new URLSearchParams('lat=1&lon=2&time=../../x'))).toMatch(/ISO 8601/);
    const q = parsePointQuery(new URLSearchParams('lat=38.01934&lon=-105.07134&time=2026-06-29T10:21:00Z'));
    expect(q).toEqual({ lat: 38.0193, lon: -105.0713, time: '2026-06-29T10:21:00Z' });
    expect(buildPointUrl(q as never)).toBe(`https://api.meteomatics.com/2026-06-29T10:21:00Z/${METEOMATICS_PARAMS.join(',')}/38.0193,-105.0713/json`);
  });
  it('reports not configured, and never calls Meteomatics, without credentials', async () => {
    expect((await call({}, '/api/meteomatics/status')).json).toEqual({ configured: false });
    const r = await call({}, '/api/meteomatics/point?lat=1&lon=2', async () => new Response('{}'));
    expect(r.status).toBe(503);
    expect(r.seen).toHaveLength(0);
  });
  it('adds Basic auth server-side and never returns the credentials', async () => {
    const r = await call(creds, '/api/meteomatics/point?lat=1&lon=2&time=2026-11-14T12:00:00Z', async () => new Response(JSON.stringify(good), { status: 200 }));
    expect(r.status).toBe(200);
    expect(r.json.values).toEqual([{ parameter: 't_2m:C', value: 12.3, date: '2026-11-14T12:00:00Z' }]);
    expect((r.seen[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('test-user:TEST-PASS-NOT-REAL').toString('base64')}`);
    expect(r.raw).not.toContain('TEST-PASS-NOT-REAL');
    expect(r.raw).not.toContain('test-user');
  });
  it('turns upstream failures into clear errors, not empty weather', async () => {
    expect((await call(creds, '/api/meteomatics/point?lat=1&lon=2', async () => new Response('', { status: 401 }))).json.error).toMatch(/username or password/);
    expect((await call(creds, '/api/meteomatics/point?lat=1&lon=2', async () => new Response('', { status: 403 }))).json.error).toMatch(/plan/);
    expect((await call(creds, '/api/meteomatics/point?lat=1&lon=2', async () => new Response('{"x":1}', { status: 200 }))).json.error).toMatch(/unexpected/);
    expect((await call(creds, '/api/meteomatics/point?lat=1&lon=2', async () => { throw new Error('net'); })).status).toBe(502);
  });
  it('leaves other paths alone and parses missing values as not available', async () => {
    expect((await call(creds, '/data/events.json')).nexted).toBe(true);
    expect(parsePointResponse({ data: [{ parameter: 'p', coordinates: [] }] })).toEqual([{ parameter: 'p', value: null, date: null }]);
    expect(formatWeatherValue({ parameter: 't_2m:C', value: 12.34, date: null })).toEqual({ label: 'Air temperature (2 m)', text: '12.3 °C' });
    expect(formatWeatherValue({ parameter: 'precip_24h:mm', value: null, date: null }).text).toBe('not available');
  });
});

import { crossSite, MAX_UPSTREAM_PER_MIN } from '../../meteomatics-proxy';

describe('Meteomatics route protects the account quota', () => {
  const env = { METEOMATICS_USERNAME: 'u', METEOMATICS_PASSWORD: 'p' };
  const good = () => new Response(JSON.stringify({ data: [{ parameter: 't_2m:C', coordinates: [{ dates: [{ date: 'd', value: 1 }] }] }] }));
  const run = async (mw: ReturnType<typeof meteomaticsMiddleware>, url: string, headers: Record<string, string> = {}) => {
    const res = { statusCode: 0, setHeader() {}, end() {} };
    await mw({ url, method: 'GET', headers } as never, res as never, () => {});
    return res.statusCode;
  };
  it('refuses cross-site browser requests and accepts same-origin ones', () => {
    const r = (h: Record<string, string>) => crossSite({ headers: h } as never);
    expect(r({ 'sec-fetch-site': 'cross-site' })).toBe(true);
    expect(r({ 'sec-fetch-site': 'same-site' })).toBe(true);
    expect(r({ origin: 'https://evil.example', host: 'localhost:5173' })).toBe(true);
    expect(r({ 'sec-fetch-site': 'same-origin', origin: 'http://localhost:5173', host: 'localhost:5173' })).toBe(false);
    expect(r({})).toBe(false); // curl / server-side checks
  });
  it('a cross-site request never reaches Meteomatics', async () => {
    let n = 0;
    const mw = meteomaticsMiddleware(env, (async () => { n++; return good(); }) as unknown as typeof fetch);
    expect(await run(mw, '/api/meteomatics/point?lat=1&lon=2', { 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(n).toBe(0);
  });
  it('serves a repeated point from cache and caps upstream calls per minute', async () => {
    let n = 0;
    const mw = meteomaticsMiddleware(env, (async () => { n++; return good(); }) as unknown as typeof fetch);
    const t = '&time=2026-11-14T12:00:00Z';
    expect(await run(mw, `/api/meteomatics/point?lat=1&lon=2${t}`)).toBe(200);
    expect(await run(mw, `/api/meteomatics/point?lat=1&lon=2${t}`)).toBe(200);
    expect(n).toBe(1);
    let last = 200;
    for (let i = 0; i < MAX_UPSTREAM_PER_MIN + 2; i++) last = await run(mw, `/api/meteomatics/point?lat=${10 + i}&lon=2${t}`);
    expect(last).toBe(429);
    expect(n).toBeLessThanOrEqual(MAX_UPSTREAM_PER_MIN);
  });
});

import { createTileErrorPolicy } from '../../src/map/tileErrors';

describe('tile error policy: notify only for a source that never delivered, per layer AND date', () => {
  it('a source that delivered tiles only logs its later failures', () => {
    const p = createTileErrorPolicy(3);
    p.delivered('ov-x|url-day1');
    expect([1, 2, 3, 4].map(() => p.failed('ov-x|url-day1').action)).toEqual(['log', 'log', 'log', 'log']);
  });
  it('a source that never delivered notifies exactly once, at the threshold', () => {
    const p = createTileErrorPolicy(3);
    expect([1, 2, 3, 4, 5].map(() => p.failed('ov-y|u').action)).toEqual(['log', 'log', 'notify', 'log', 'log']);
  });
  it('a broken new date of a layer that worked on another date still notifies', () => {
    const p = createTileErrorPolicy(3);
    p.delivered('ov-x|url-day1');
    p.failed('ov-x|url-day1');
    expect([1, 2, 3].map(() => p.failed('ov-x|url-day2').action)).toEqual(['log', 'log', 'notify']);
  });
});

describe('tile error policy: late success cancels a pending notice', () => {
  it('hasDelivered turns true once a tile arrives, also after early failures', () => {
    const p = createTileErrorPolicy(3);
    expect([1, 2, 3].map(() => p.failed('k').action).at(-1)).toBe('notify');
    expect(p.hasDelivered('k')).toBe(false);
    p.delivered('k');
    expect(p.hasDelivered('k')).toBe(true);
  });
});
