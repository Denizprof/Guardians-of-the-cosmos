// Fuzz tests: src/earthdata.ts and src/services.ts fed with random / garbled JSON.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  parseCollectionEntries, toCollection, groupByPlatform, platformFamily, buildSearchUrl, queryEarthdata,
  type CmrCollectionEntry,
} from '../../../src/earthdata';
import { geocode, nisarCoverage } from '../../../src/services';

const RUNS = { numRuns: 300 };
const Q = { lon: 10, lat: 20, start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' };

afterEach(() => vi.unstubAllGlobals());

// Arbitrary JSON, including nulls, nested junk and wrong types.
const junk = fc.jsonValue({ maxDepth: 4 });
// A plausible CMR entry whose fields are randomly replaced by wrong types or removed.
const wrong = fc.oneof(fc.constant(null), fc.integer(), fc.string(), fc.boolean(), fc.array(fc.anything(), { maxLength: 3 }), fc.dictionary(fc.string({ maxLength: 4 }), fc.integer(), { maxKeys: 2 }));
const maybe = <T>(good: fc.Arbitrary<T>) => fc.oneof({ weight: 3, arbitrary: good }, { weight: 1, arbitrary: wrong }, { weight: 1, arbitrary: fc.constant(undefined) });
const link = fc.record({ rel: fc.constantFrom('http://esipfed.org/ns/fedsearch/1.1/metadata#', 'http://esipfed.org/ns/fedsearch/1.1/documentation#', 'x'), href: fc.constantFrom('https://doi.org/10.1/x', 'https://a.b/c.pdf', 'https://a.b/c', '') });
const entry = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }).map((s) => `C${s}-PROV`),
  short_name: maybe(fc.string({ maxLength: 8 })),
  version_id: maybe(fc.string({ maxLength: 4 })),
  title: maybe(fc.string({ maxLength: 20 })),
  dataset_id: maybe(fc.string({ maxLength: 20 })),
  data_center: maybe(fc.string({ maxLength: 8 })),
  processing_level_id: maybe(fc.constantFrom('Not provided', '1', '2A')),
  cloud_hosted: maybe(fc.boolean()),
  platforms: maybe(fc.array(fc.constantFrom('Sentinel-1A', 'LANDSAT-8', 'NISAR', 'ISS', 'Not provided', ''), { maxLength: 3 })),
  links: maybe(fc.array(link, { maxLength: 4 })),
}, { requiredKeys: ['id'] });

function mockFetch(bodyFor: (url: string) => unknown, { ok = true, hits = '5' } = {}) {
  return vi.fn(async (url: string) => ({
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => hits },
    json: async () => bodyFor(String(url)),
  })) as unknown as typeof fetch;
}

describe('earthdata.parseCollectionEntries', () => {
  it('never throws on arbitrary JSON and only returns entries with a string id', () => {
    fc.assert(fc.property(fc.oneof(junk, fc.anything()), (j) => {
      const out = parseCollectionEntries(j);
      expect(Array.isArray(out)).toBe(true);
      for (const e of out) expect(typeof e.id).toBe('string');
    }), { numRuns: 1000 });
  });

  it('garbled feed shapes give an empty list', () => {
    fc.assert(fc.property(fc.oneof(fc.constant(null), fc.integer(), fc.string(), fc.constant({ feed: null }), fc.constant({ feed: { entry: 'x' } }), fc.constant({ feed: { entry: { id: 'a' } } })), (j) => {
      expect(parseCollectionEntries(j)).toEqual([]);
    }), { numRuns: 20 });
  });

  it('entries with a non-string id or non-object members are dropped', () => {
    fc.assert(fc.property(fc.array(fc.oneof(fc.constant(null), fc.integer(), fc.string(), fc.record({ id: fc.integer() })), { maxLength: 8 }), (items) => {
      expect(parseCollectionEntries({ feed: { entry: items } })).toEqual([]);
    }), RUNS);
  });
});

describe('earthdata pure helpers on perturbed entries', () => {
  // BUG-WEB-2: toCollection / groupByPlatform trust field types inside a CMR entry. A garbled but
  // string-id entry crashes: `links` not an array -> `(links ?? []).find is not a function`
  // (web/src/earthdata.ts findLink), a null link element -> `l.href` of null, and a non-string
  // platform -> `p.trim is not a function` (platformFamily). Failing input: {id:'C1-P', links:'x'}.
  // parseCollectionEntries only checks `id`, so these reach the UI path as a thrown TypeError.
  it('BUG-WEB-2 (fixed, regression): toCollection + groupByPlatform survive wrong-typed fields', () => {
    fc.assert(fc.property(fc.array(entry, { maxLength: 6 }), (entries) => {
      const cols = entries.map((e, i) => toCollection(e as unknown as CmrCollectionEntry, i, Q));
      const groups = groupByPlatform(cols);
      expect(groups.reduce((n, g) => n + g.collections.length, 0)).toBe(cols.length);
    }), { numRuns: 600 });
  });

  it('well-typed entries: grouping is a partition, sorted, and every searchUrl is http(s)', () => {
    const typed = fc.record({
      id: fc.string({ minLength: 1, maxLength: 10 }).map((s) => `C${s}-PROV`),
      short_name: fc.string({ maxLength: 8 }),
      platforms: fc.array(fc.constantFrom('Sentinel-1A', 'Sentinel-1B', 'LANDSAT-8', 'landsat-9', 'NISAR', 'ISS', 'iss', 'Not provided', ''), { maxLength: 3 }),
      links: fc.array(link, { maxLength: 3 }),
    }, { requiredKeys: ['id', 'short_name'] });
    fc.assert(fc.property(fc.array(fc.tuple(typed, fc.integer({ min: 1, max: 1e6 })), { maxLength: 30 }), (items) => {
      const cols = items.map(([e, n]) => toCollection(e as CmrCollectionEntry, n, Q));
      const groups = groupByPlatform(cols);
      expect(groups.flatMap((g) => g.collections).length).toBe(cols.length);
      for (const g of groups) {
        expect(g.granules).toBe(g.collections.reduce((s, c) => s + c.granules, 0));
        for (let i = 1; i < g.collections.length; i++) expect(g.collections[i - 1].granules).toBeGreaterThanOrEqual(g.collections[i].granules);
      }
      for (const c of cols) expect(c.searchUrl).toMatch(/^https:\/\/search\.earthdata\.nasa\.gov\//);
      expect(new Set(groups.map((g) => g.platform.toLowerCase())).size).toBe(groups.length);
    }), RUNS);
  });

  it('platformFamily is total on strings and undefined', () => {
    fc.assert(fc.property(fc.option(fc.string({ maxLength: 30 }), { nil: undefined }), (p) => {
      expect(typeof platformFamily(p)).toBe('string');
      expect(platformFamily(p).length).toBeGreaterThan(0);
    }), { numRuns: 600 });
  });

  it('buildSearchUrl is a valid URL for any finite point and valid dates', () => {
    fc.assert(fc.property(fc.double({ min: -180, max: 180, noNaN: true }), fc.double({ min: -90, max: 90, noNaN: true }),
      fc.date({ noInvalidDate: true, min: new Date('1970-01-01'), max: new Date('2100-01-01') }), fc.date({ noInvalidDate: true, min: new Date('1970-01-01'), max: new Date('2100-01-01') }),
      (lon, lat, a, b) => {
        const u = buildSearchUrl({ lon, lat, start: a.toISOString(), end: b.toISOString() });
        expect(() => new URL(u)).not.toThrow();
      }), RUNS);
  });
});

describe('earthdata.queryEarthdata with garbled network bodies', () => {
  it('resolves to a typed result or rejects with an Error (never an unhandled non-Error / hang)', async () => {
    await fc.assert(fc.asyncProperty(fc.oneof(junk, fc.array(entry, { maxLength: 4 }).map((e) => ({ feed: { entry: e } }))), fc.constantFrom('0', '3', 'abc', ''), async (body, hits) => {
      const f = mockFetch(() => body, { hits });
      try {
        const r = await queryEarthdata({ ...Q, fetchImpl: f, timeoutMs: 5000 });
        expect(Array.isArray(r.groups)).toBe(true);
        expect(Number.isInteger(r.totalCollections) && r.totalCollections >= 0).toBe(true);
        expect(Number.isFinite(r.totalGranules) && r.totalGranules >= 0).toBe(true);
        expect(r.groups.flatMap((g) => g.collections).length).toBe(r.totalCollections);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    }), { numRuns: 150 });
  });

  it('junk bodies (no usable entries) return the empty typed result', async () => {
    await fc.assert(fc.asyncProperty(junk.filter((j) => parseCollectionEntries(j).length === 0), async (body) => {
      const r = await queryEarthdata({ ...Q, fetchImpl: mockFetch(() => body), timeoutMs: 5000 });
      expect(r.groups).toEqual([]);
      expect(r.totalCollections).toBe(0);
      expect(r.totalGranules).toBe(0);
    }), { numRuns: 150 });
  });

  it('non-finite / invalid queries are rejected up front', async () => {
    const f = mockFetch(() => ({}));
    await fc.assert(fc.asyncProperty(fc.constantFrom(NaN, Infinity, -Infinity), async (bad) => {
      await expect(queryEarthdata({ ...Q, lon: bad, fetchImpl: f })).rejects.toThrow(/Invalid Earthdata query/);
      await expect(queryEarthdata({ ...Q, lat: bad, fetchImpl: f })).rejects.toThrow(/Invalid Earthdata query/);
    }), { numRuns: 6 });
    await expect(queryEarthdata({ ...Q, start: 'garbage', fetchImpl: f })).rejects.toThrow(/Invalid/);
    expect(f).not.toHaveBeenCalled();
  });

  it('HTTP errors surface as an Error mentioning the status', async () => {
    await expect(queryEarthdata({ ...Q, fetchImpl: mockFetch(() => ({}), { ok: false }) })).rejects.toThrow(/HTTP 500/);
  });
});

describe('services.geocode / nisarCoverage with garbled bodies', () => {
  const stub = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
  const noFeatures = junk.filter((j) => !(j && typeof j === 'object' && !Array.isArray(j) && Array.isArray((j as { features?: unknown }).features)));

  // BUG-WEB-3: both services call `json.features.map(...)` / `.filter(...)` with no shape check, so any
  // body without a `features` array (e.g. {}, null, an error object from a proxy) rejects with a raw
  // TypeError ("Cannot read properties of undefined (reading 'map')") instead of an empty typed result.
  // Failing input: {}  (web/src/services.ts geocode ~line 18, nisarCoverage ~line 60)
  // BUG-WEB-3 (fixed): a body without a features array now rejects with a clear message instead of a
  // raw TypeError. It deliberately does NOT return an empty result: an error body must never be shown
  // to users as "no places" / "no NISAR coverage here" (silent-failure rule for a science app).
  it('BUG-WEB-3: geocode rejects clearly when the body has no features array', async () => {
    await fc.assert(fc.asyncProperty(noFeatures, async (body) => {
      stub(body);
      await expect(geocode('x')).rejects.toThrow(/unexpected response/);
    }), { numRuns: 100 });
  });

  it('BUG-WEB-3: nisarCoverage rejects clearly when the body has no features array', async () => {
    await fc.assert(fc.asyncProperty(noFeatures, async (body) => {
      stub(body);
      await expect(nisarCoverage(10, 20)).rejects.toThrow(/unexpected response/);
    }), { numRuns: 100 });
  });

  // BUG-WEB-4: individual garbled features crash the whole result: `f.properties` of null/undefined
  // feature, `String(f.properties.collectionName)` with properties missing, and
  // `b.start.localeCompare` when startTime is absent. Failing input: {features:[{geometry:null}]}
  it('BUG-WEB-4 (fixed, regression): nisarCoverage tolerates features with missing properties / startTime', async () => {
    const feat = fc.oneof(fc.constant(null), fc.constant({}), fc.record({ properties: fc.constant({ sceneName: 'S', collectionName: 'NISAR_X' }), geometry: fc.constant(null) }), fc.record({ properties: fc.dictionary(fc.string({ maxLength: 5 }), fc.anything(), { maxKeys: 3 }) }));
    await fc.assert(fc.asyncProperty(fc.array(feat, { maxLength: 5 }), async (features) => {
      stub({ features });
      const r = await nisarCoverage(10, 20);
      expect(r.total).toBe(r.granules.length);
    }), { numRuns: 100 });
  });

  it('BUG-WEB-4 (fixed, regression): geocode tolerates features with missing properties / geometry', async () => {
    const feat = fc.oneof(fc.constant(null), fc.constant({}), fc.record({ properties: fc.constant({ name: 'X' }) }), fc.record({ geometry: fc.constant({ coordinates: [1, 2] }) }));
    await fc.assert(fc.asyncProperty(fc.array(feat, { minLength: 1, maxLength: 5 }), async (features) => {
      stub({ features });
      const r = await geocode('x');
      expect(Array.isArray(r)).toBe(true);
    }), { numRuns: 100 });
  });

  it('well-formed bodies: coverage is sorted newest first, urgent-response scenes dropped, tiers valid', async () => {
    const feat = fc.record({
      properties: fc.record({
        sceneName: fc.string({ minLength: 1, maxLength: 10 }),
        collectionName: fc.constantFrom('NISAR_UR_X', 'NISAR_L2_BETA_GCOV', 'NISAR_L2_PROVISIONAL_GCOV', 'NISAR_L2_GCOV'),
        processingLevel: fc.constantFrom('GCOV', 'GUNW'),
        startTime: fc.date({ noInvalidDate: true, min: new Date('2024-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
        pathNumber: fc.integer({ min: 1, max: 173 }),
        frameNumber: fc.integer({ min: 1, max: 600 }),
        flightDirection: fc.constantFrom('ASCENDING', 'DESCENDING'),
        browse: fc.option(fc.array(fc.constantFrom('https://a/thumbnail.png', 'https://a/full.png'), { maxLength: 3 }), { nil: undefined }),
      }),
      geometry: fc.constant({ type: 'Polygon', coordinates: [] }),
    });
    await fc.assert(fc.asyncProperty(fc.array(feat, { maxLength: 20 }), async (features) => {
      stub({ features });
      const r = await nisarCoverage(1.23456, -7.5);
      const kept = features.filter((f) => !f.properties.collectionName.startsWith('NISAR_UR'));
      expect(r.total).toBe(kept.length);
      expect(r.granules.length).toBe(kept.length);
      for (let i = 1; i < r.granules.length; i++) expect(r.granules[i - 1].start >= r.granules[i].start).toBe(true);
      for (const g of r.granules) expect(['BETA', 'PROVISIONAL', 'VALIDATED']).toContain(g.tier);
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }), { numRuns: 100 });
  });

  it('HTTP errors reject with an Error (typed message)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    await expect(geocode('x')).rejects.toThrow(/HTTP 503/);
    await expect(nisarCoverage(1, 2)).rejects.toThrow(/HTTP 503/);
  });

  it('geocode on well-formed features maps coordinates and drops empty sub labels', async () => {
    const f = fc.record({
      properties: fc.record({ name: fc.stringMatching(/^[a-z]{1,8}$/), state: fc.option(fc.stringMatching(/^[a-z]{1,5}$/), { nil: undefined }), country: fc.stringMatching(/^[a-z]{1,5}$/) }),
      geometry: fc.record({ coordinates: fc.tuple(fc.double({ min: -180, max: 180, noNaN: true }), fc.double({ min: -90, max: 90, noNaN: true })) }),
    });
    await fc.assert(fc.asyncProperty(fc.array(f, { maxLength: 6 }), async (features) => {
      stub({ features });
      const r = await geocode('q');
      expect(r.length).toBe(features.length);
      r.forEach((h, i) => {
        expect(h.lon).toBe(features[i].geometry.coordinates[0]);
        expect(h.lat).toBe(features[i].geometry.coordinates[1]);
        expect(h.sub).not.toMatch(/^,|,$|, ,/);
      });
    }), { numRuns: 100 });
  });
});
