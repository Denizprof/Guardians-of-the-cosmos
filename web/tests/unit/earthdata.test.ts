import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/cmr.fixture.json';
import {
  buildSearchUrl, formatTemporal, groupByPlatform, parseCollectionEntries, platformFamily, queryEarthdata, toCollection, windowAround,
} from '../../src/earthdata';

const q = fixture.query;
const hitsFor = (url: string) => {
  const id = /collection_concept_id=([^&]+)/.exec(url)?.[1];
  const e = fixture.feed.entry.find((x) => x.id === id);
  return e ? (fixture.hitsByShortName as Record<string, number>)[e.short_name] : 0;
};
const mockFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/collections.json')) return new Response(JSON.stringify({ feed: { entry: fixture.feed.entry } }), { status: 200 });
  return new Response('{"feed":{"entry":[]}}', { status: 200, headers: { 'CMR-Hits': String(hitsFor(url)) } });
}) as typeof fetch;

describe('earthdata parsing', () => {
  it('parses entries and tolerates garbage', () => {
    expect(parseCollectionEntries(fixture)).toHaveLength(8);
    expect(parseCollectionEntries(null)).toEqual([]);
    expect(parseCollectionEntries({ feed: {} })).toEqual([]);
  });

  it('merges Sentinel / Landsat platform variants into families', () => {
    expect(platformFamily('Sentinel-1A')).toBe('Sentinel-1');
    expect(platformFamily('SENTINEL-1C')).toBe('Sentinel-1');
    expect(platformFamily('LANDSAT-9')).toBe('Landsat');
    expect(platformFamily('Suomi-NPP')).toBe('Suomi-NPP');
    expect(platformFamily(undefined)).toBe('Other platforms');
  });

  it('builds a prefilled Earthdata Search link', () => {
    const u = new URL(buildSearchUrl({ ...q, conceptId: 'C2854338529-ASF' }));
    expect(u.origin + u.pathname).toBe('https://search.earthdata.nasa.gov/search/granules');
    expect(u.searchParams.get('p')).toBe('C2854338529-ASF');
    expect(u.searchParams.get('sp[0]')).toBe('139.7,35.7');
    expect(u.searchParams.get('qt')).toBe('2026-01-01T00:00:00.000Z,2026-01-20T00:00:00.000Z');
  });

  it('extracts DOI and landing page from links', () => {
    const atl = parseCollectionEntries(fixture).find((e) => e.short_name === 'ATL03')!;
    const c = toCollection(atl, 1, q);
    expect(c.doi).toBe('https://doi.org/10.5067/ATLAS/ATL03.007');
    expect(c.platforms).toEqual(['ICESat-2']);
    const nisar = toCollection(parseCollectionEntries(fixture).find((e) => e.short_name === 'NISAR_L2_GCOV_PROVISIONAL_V1')!, 5, q);
    expect(nisar.doi).toBeNull();
    expect(nisar.landingPage).toBe('https://nisar.jpl.nasa.gov/');
  });

  it('formats temporal strings', () => {
    expect(formatTemporal('2026-01-01T00:00:00.000Z', '2026-01-20T12:00:00.000Z')).toBe('2026-01-01T00:00:00Z,2026-01-20T12:00:00Z');
  });

  it('caps the window end at today', () => {
    const w = windowAround(new Date().toISOString(), 3);
    expect(Date.parse(w.end)).toBeLessThanOrEqual(Date.now());
  });
});

describe('queryEarthdata', () => {
  it('drops 0-granule collections and groups by platform with NISAR first', async () => {
    const r = await queryEarthdata({ ...q, fetchImpl: mockFetch });
    expect(r.totalCollections).toBe(7); // MOD00F has 0 hits
    expect(r.groups[0].platform).toBe('NISAR');
    expect(r.groups[0].collections.map((c) => c.granules)).toEqual([8, 5]);
    expect(r.groups.map((g) => g.platform)).toContain('Sentinel-1');
    expect(r.groups.find((g) => g.platform === 'Sentinel-1')!.collections).toHaveLength(2);
    expect(r.totalGranules).toBe(8 + 5 + 2 + 2 + 1 + 21 + 52);
    expect(r.searchUrl).toContain('search.earthdata.nasa.gov/search?');
  });

  it('groupByPlatform sums granules', () => {
    const cols = parseCollectionEntries(fixture).map((e, i) => toCollection(e, i + 1, q));
    const groups = groupByPlatform(cols);
    expect(groups.reduce((s, g) => s + g.granules, 0)).toBe(cols.reduce((s, c) => s + c.granules, 0));
  });

  it('surfaces HTTP errors', async () => {
    const bad = (async () => new Response('x', { status: 503 })) as typeof fetch;
    await expect(queryEarthdata({ ...q, fetchImpl: bad })).rejects.toThrow(/HTTP 503/);
  });

  it('times out with a friendly message', async () => {
    const hang = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch;
    await expect(queryEarthdata({ ...q, fetchImpl: hang, timeoutMs: 20 })).rejects.toThrow(/did not respond in time/);
  });

  it('returns empty groups for no results and rejects bad input', async () => {
    const empty = (async () => new Response('{"feed":{"entry":[]}}', { status: 200 })) as typeof fetch;
    const r = await queryEarthdata({ ...q, fetchImpl: empty });
    expect(r.totalCollections).toBe(0);
    expect(r.groups).toEqual([]);
    await expect(queryEarthdata({ ...q, lon: NaN })).rejects.toThrow(/Invalid/);
  });
});
