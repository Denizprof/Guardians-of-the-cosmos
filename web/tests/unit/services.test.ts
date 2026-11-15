import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocode, nisarCoverage } from '../../src/services';
import { browseBounds, coverageFeatures } from '../../src/map/coverageSelect';

// RECORDED FIXTURES: real responses captured 2026-11-14 with PowerShell Invoke-WebRequest from
//   photon.komoot.io (q=Caracas) and api.daac.asf.alaska.edu (NISAR GCOV,GUNW at POINT(-67.5 10.5), 5 results).
// fetch itself is stubbed: these are canned-response tests of OUR parsing, not live calls.
const load = (n: string) => JSON.parse(readFileSync(resolve(__dirname, '../fixtures', n), 'utf8'));
const photon = load('photon-caracas.fixture.json');
const asf = load('asf-coverage-venezuela.fixture.json');

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const f = vi.fn(async (..._a: unknown[]) => ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => body }) as Response);
  vi.stubGlobal('fetch', f);
  return f;
}
afterEach(() => vi.unstubAllGlobals());

describe('geocode (Photon)', () => {
  it('requests the Photon API with an encoded query, limit and language', async () => {
    const f = stubFetch(photon);
    await geocode('São Paulo & co');
    const url = new URL(f.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/');
    expect(url.searchParams.get('q')).toBe('São Paulo & co');
    expect(url.searchParams.get('limit')).toBe('6');
    expect(url.searchParams.get('lang')).toBe('en');
  });
  it('forwards the caller abort to the request', async () => {
    const f = stubFetch(photon);
    await geocode('x', new AbortController().signal);
    expect(((f.mock.calls[0] as any)[1].signal as AbortSignal).aborted).toBe(false);
    // an already-aborted caller signal reaches fetch as aborted (mid-flight aborts: see the timeout block below)
    const ac = new AbortController();
    ac.abort();
    await geocode('x', ac.signal);
    expect(((f.mock.calls[1] as any)[1].signal as AbortSignal).aborted).toBe(true);
  });
  it('parses the recorded response into hits with lon/lat in the right order', async () => {
    stubFetch(photon);
    const hits = await geocode('Caracas');
    expect(hits.length).toBe(photon.features.length);
    const first = hits[0];
    expect(first.label).toBeTruthy();
    expect(first.lon).toBe(photon.features[0].geometry.coordinates[0]);
    expect(first.lat).toBe(photon.features[0].geometry.coordinates[1]);
    // Caracas is ~(-66.9, 10.5): catches a lon/lat swap.
    expect(first.lon).toBeGreaterThan(-68);
    expect(first.lon).toBeLessThan(-66);
    expect(first.lat).toBeGreaterThan(10);
    expect(first.lat).toBeLessThan(11);
  });
  it('builds the sub-label from osm_value, state and country, skipping missing parts', async () => {
    stubFetch({
      features: [
        { geometry: { coordinates: [1, 2] }, properties: { name: 'A', osm_value: 'city', state: 'S', country: 'C' } },
        { geometry: { coordinates: [3, 4] }, properties: { city: 'B', country: 'C' } },
        { geometry: { coordinates: [5, 6] }, properties: { country: 'OnlyCountry' } },
      ],
    });
    const [a, b, c] = await geocode('q');
    expect(a).toMatchObject({ label: 'A', sub: 'city · S, C' });
    expect(b).toMatchObject({ label: 'B', sub: 'C' });
    expect(c.label).toBe('OnlyCountry');
  });
  it('passes through Photon extent', async () => {
    stubFetch({ features: [{ geometry: { coordinates: [1, 2] }, properties: { name: 'A', extent: [0, 3, 2, 1] } }] });
    expect((await geocode('q'))[0].extent).toEqual([0, 3, 2, 1]);
  });
  it('returns [] when there are no features', async () => {
    stubFetch({ features: [] });
    expect(await geocode('zzzz')).toEqual([]);
  });
  it('throws a readable error on HTTP failure', async () => {
    stubFetch({}, { ok: false, status: 503 });
    await expect(geocode('q')).rejects.toThrow('Search failed (HTTP 503)');
  });
  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(geocode('q')).rejects.toThrow('Failed to fetch');
  });
});

describe('nisarCoverage (ASF SearchAPI)', () => {
  it('queries ASF with dataset, levels, an exact POINT and maxResults', async () => {
    const f = stubFetch(asf);
    await nisarCoverage(-67.5, 10.5);
    const url = new URL(f.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://api.daac.asf.alaska.edu/services/search/param');
    expect(url.searchParams.get('dataset')).toBe('NISAR');
    expect(url.searchParams.get('processingLevel')).toBe('GCOV,GUNW');
    expect(url.searchParams.get('intersectsWith')).toBe('POINT(-67.5000 10.5000)');
    expect(url.searchParams.get('maxResults')).toBe('250');
    expect(url.searchParams.get('output')).toBe('geojson');
  });
  it('rounds the probe point to 4 decimals', async () => {
    const f = stubFetch(asf);
    await nisarCoverage(33.123456789, -24.987654321);
    expect(new URL(f.mock.calls[0][0] as string).searchParams.get('intersectsWith')).toBe('POINT(33.1235 -24.9877)');
  });
  it('maps the recorded response to granules, newest first', async () => {
    stubFetch(asf);
    const r = await nisarCoverage(-67.5, 10.5);
    expect(r.lon).toBe(-67.5);
    expect(r.lat).toBe(10.5);
    expect(r.total).toBe(r.granules.length);
    expect(r.total).toBeGreaterThan(0);
    const starts = r.granules.map((g) => g.start);
    expect([...starts].sort().reverse()).toEqual(starts);
    const g = r.granules.find((x) => x.product === 'GCOV')!;
    expect(g.scene).toMatch(/^NISAR_L2_PR_GCOV_/);
    expect(g.track).toBe(162);
    expect(g.frame).toBe(7);
    expect(g.direction).toBe('ASCENDING');
    expect(g.footprint.type).toBe('Polygon');
  });
  it('picks the thumbnail URL, not the full browse', async () => {
    stubFetch(asf);
    const r = await nisarCoverage(-67.5, 10.5);
    expect(r.granules.find((g) => g.thumb)?.thumb).toMatch(/thumbnail/);
  });

  const feat = (coll: string, start: string, extra: Record<string, unknown> = {}) => ({
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    properties: {
      sceneName: `S_${coll}_${start}`, processingLevel: 'GCOV', startTime: start, collectionName: coll,
      pathNumber: 1, frameNumber: 2, flightDirection: 'DESCENDING', browse: [], ...extra,
    },
  });
  it('classifies tiers from the collection name and drops Urgent Response duplicates', async () => {
    stubFetch({
      features: [
        feat('NISAR_L2_GCOV_BETA_V1', '2026-01-01T00:00:00Z'),
        feat('NISAR_L2_GCOV_PROVISIONAL_V1', '2026-02-01T00:00:00Z'),
        feat('NISAR_L2_GCOV_V1', '2026-03-01T00:00:00Z'),
        feat('NISAR_UR_L2_GCOV_V1', '2026-04-01T00:00:00Z'),
      ],
    });
    const r = await nisarCoverage(0, 0);
    expect(r.granules.map((g) => g.tier)).toEqual(['VALIDATED', 'PROVISIONAL', 'BETA']);
    expect(r.total).toBe(3);
  });
  it('tolerates a missing browse list', async () => {
    stubFetch({ features: [feat('NISAR_L2_GCOV_V1', '2026-03-01T00:00:00Z', { browse: undefined })] });
    const r = await nisarCoverage(0, 0);
    expect(r.granules[0].thumb).toBeUndefined();
  });
  // SYNTHETIC rows (no real ASF response looked like this): one malformed row must not stop the whole app.
  // The panel calls direction[0] / direction.toLowerCase() and renders product, track and frame as text;
  // the map reads footprint.coordinates.
  it('a malformed row is made harmless instead of crashing the panel or the map', async () => {
    const t = '2026-03-01T00:00:00Z';
    stubFetch({
      features: [
        feat('NISAR_L2_GCOV_V1', t, { sceneName: 'BAD_DIRECTION', flightDirection: 7 }),
        feat('NISAR_L2_GCOV_V1', t, { sceneName: 'BAD_PRODUCT', processingLevel: { level: 'GCOV' } }),
        feat('NISAR_L2_GCOV_V1', t, { sceneName: 'BAD_NUMBERS', pathNumber: { n: 1 }, frameNumber: [2] }),
        { ...feat('NISAR_L2_GCOV_V1', t, { sceneName: 'NULL_GEOMETRY' }), geometry: null },
        { ...feat('NISAR_L2_GCOV_V1', t, { sceneName: 'POINT_GEOMETRY' }), geometry: { type: 'Point', coordinates: [1, 2] } },
        { ...feat('NISAR_L2_GCOV_V1', t, { sceneName: 'BAD_COORDINATES' }), geometry: { type: 'Polygon', coordinates: 'x' } },
        feat('NISAR_L2_GCOV_V1', t, { sceneName: 'GOOD' }),
      ],
    });
    const r = await nisarCoverage(0, 0);
    expect(r.total).toBe(7);
    const by = (scene: string) => r.granules.find((g) => g.scene === scene)!;
    for (const g of r.granules) {
      expect(typeof g.direction).toBe('string');
      expect(typeof g.product).toBe('string');
      // rendered as text by the panel: an object here would be a React render error
      expect(['number', 'string', 'undefined']).toContain(typeof g.track);
      expect(['number', 'string', 'undefined']).toContain(typeof g.frame);
    }
    expect(by('BAD_DIRECTION').direction).toBe('UNKNOWN');
    expect(by('BAD_PRODUCT').product).toBe('UNKNOWN');
    for (const scene of ['NULL_GEOMETRY', 'POINT_GEOMETRY', 'BAD_COORDINATES']) {
      expect(by(scene).footprint).toBeNull();
      expect(() => coverageFeatures(r.granules, scene)).not.toThrow();
      expect(coverageFeatures(r.granules, scene)).toEqual([]);
      expect(() => browseBounds(by(scene).footprint)).not.toThrow();
    }
    // the good row is untouched
    expect(by('GOOD')).toMatchObject({ product: 'GCOV', direction: 'DESCENDING', track: 1, frame: 2 });
    expect(by('GOOD').footprint.type).toBe('Polygon');
    expect(coverageFeatures(r.granules, 'GOOD')).toHaveLength(1);
  });
  it('empty result', async () => {
    stubFetch({ features: [] });
    expect(await nisarCoverage(0, 0)).toMatchObject({ total: 0, granules: [] });
  });
  it('throws a readable error on HTTP failure', async () => {
    stubFetch({}, { ok: false, status: 500 });
    await expect(nisarCoverage(0, 0)).rejects.toThrow('ASF search failed (HTTP 500)');
  });
  it('rejects (does not silently succeed) when ASF answers 200 with an error body', async () => {
    stubFetch({ error: { type: 'VALIDATION_ERROR', report: 'bad' } });
    await expect(nisarCoverage(0, 0)).rejects.toThrow();
  });
});

// A server that accepts the connection and never answers must end as an ERROR, not as endless "loading".
describe('request timeout (stalled upstream)', () => {
  afterEach(() => vi.useRealTimers());

  const untilAbort = (signal?: AbortSignal) =>
    new Promise<never>((_, reject) => {
      if (!signal) return; // no signal at all: hangs for ever (the defect)
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  /** fetch that never answers; rejects only when the signal it was given aborts. */
  const stallFetch = () => vi.stubGlobal('fetch', vi.fn((_u: unknown, init?: RequestInit) => untilAbort(init?.signal ?? undefined)));
  /** fetch whose headers arrive but whose body never does. */
  const stallBody = () =>
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => ({ ok: true, status: 200, json: () => untilAbort(init?.signal ?? undefined) }) as unknown as Response));

  const cases: [string, (s?: AbortSignal) => Promise<unknown>, RegExp][] = [
    ['nisarCoverage', (s) => nisarCoverage(0, 0, s), /^ASF search timed out/],
    ['geocode', (s) => geocode('q', s), /^Search timed out/],
  ];
  for (const [name, call, msg] of cases) {
    it(`${name}: a request that never answers rejects with a timeout error after 20 s`, async () => {
      vi.useFakeTimers();
      stallFetch();
      let err: any;
      let settled = false;
      call(new AbortController().signal).catch((e) => { err = e; }).finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(19_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      expect(err.message).toMatch(msg);
      expect(err.name).not.toBe('AbortError');
    }, 2000);
    it(`${name}: times out without a caller signal too`, async () => {
      vi.useFakeTimers();
      stallFetch();
      let err: any;
      call().catch((e) => { err = e; });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(err?.message).toMatch(msg);
    }, 2000);
    it(`${name}: a body that stalls after the headers times out too`, async () => {
      vi.useFakeTimers();
      stallBody();
      let err: any;
      call(new AbortController().signal).catch((e) => { err = e; });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(err?.message).toMatch(msg);
      expect(err?.name).not.toBe('AbortError');
    }, 2000);
    it(`${name}: the caller's abort before the timeout still rejects as AbortError`, async () => {
      vi.useFakeTimers();
      stallFetch();
      const ac = new AbortController();
      let err: any;
      call(ac.signal).catch((e) => { err = e; });
      await vi.advanceTimersByTimeAsync(5000);
      ac.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(err?.name).toBe('AbortError');
    }, 2000);
    it(`${name}: leaves no timer running after a normal answer`, async () => {
      vi.useFakeTimers();
      stubFetch({ features: [] });
      await call(new AbortController().signal);
      expect(vi.getTimerCount()).toBe(0);
    }, 2000);
  }
});
