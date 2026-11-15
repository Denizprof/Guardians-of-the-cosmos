/**
 * Browser client for NASA CMR (Common Metadata Repository) search — CORS-enabled, no login.
 * https://cmr.earthdata.nasa.gov/search/
 *
 * Question answered: "which NASA Earthdata collections have granules covering this point and time window?"
 * AVAILABILITY of data is not the same as the event being visible in it.
 *
 * Strategy (verified live):
 *  1. collections.json?has_granules=true&point=&temporal[]=   -> candidate collections. Two queries run in
 *     parallel: the most-used collections overall, plus a platform-targeted query so SAR / optical / radar /
 *     lidar missions (NISAR, Sentinel, Landsat, SMAP, GPM, ICESat-2, GEDI via ISS, SWOT ...) are not crowded
 *     out by thousands of L0/L1 products. The platform list is only a SEARCH HINT; nothing in the result is hardcoded.
 *  2. granules.json?collection_concept_id=&point=&temporal[]=&page_size=0 -> exact granule count via the
 *     CMR-Hits header (exposed to browsers). Collections with 0 granules there are dropped.
 */
import { parseUTC } from './lib';

export interface EarthdataQuery {
  lon: number;
  lat: number;
  /** ISO start/end of the temporal window. */
  start: string;
  end: string;
  signal?: AbortSignal;
  /** Overall budget in ms (default 25 000). */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface EarthdataCollection {
  conceptId: string;
  shortName: string;
  version: string;
  title: string;
  platforms: string[];
  provider: string;
  processingLevel: string | null;
  granules: number;
  cloudHosted: boolean;
  /** Earthdata Search deep link prefilled with this collection, the point and the time window. */
  searchUrl: string;
  /** https://doi.org/... when the collection metadata links one. */
  doi: string | null;
  /** Project / landing page when available. */
  landingPage: string | null;
}

export interface EarthdataGroup {
  /** Platform family, e.g. "Sentinel-1", "Landsat", "NISAR". */
  platform: string;
  granules: number;
  collections: EarthdataCollection[];
}

export interface EarthdataResult {
  groups: EarthdataGroup[];
  totalCollections: number;
  totalGranules: number;
  /** Collections whose granule count request failed: availability unknown, NOT "none". */
  uncheckedCollections?: number;
  /** True when CMR matched more candidate collections than were checked (each candidate query returns one page). */
  truncated?: boolean;
  /** Candidate collections whose granule count was actually obtained. */
  checkedCollections?: number;
  /** Candidate collections CMR matched in total (CMR-Hits of the general query); null = unknown. */
  candidateCollections?: number | null;
  /** Earthdata Search link for the point + window with no collection preselected. */
  searchUrl: string;
  query: { lon: number; lat: number; start: string; end: string };
}

const CMR = 'https://cmr.earthdata.nasa.gov/search';
/** Page size of each candidate query; only this first page is read. */
const PAGE_SIZE = 50;
const EDS = 'https://search.earthdata.nasa.gov/search';

/** Platforms used as a search HINT for the targeted query (matching is case-insensitive in CMR). */
const PLATFORM_HINTS = [
  'NISAR', 'Sentinel-1A', 'Sentinel-1B', 'Sentinel-1C', 'Sentinel-2A', 'Sentinel-2B', 'Sentinel-2C', 'Sentinel-3A', 'Sentinel-5P',
  'LANDSAT-8', 'LANDSAT-9', 'Terra', 'Aqua', 'SUOMI-NPP', 'NOAA-20', 'NOAA-21', 'GPM', 'SMAP', 'ICESat-2', 'ISS', 'SWOT', 'ALOS-2', 'ECOSTRESS',
];

/** Families shown first (in this order) when they occur; the rest follow by granule count. */
const FAMILY_PRIORITY = ['NISAR', 'Sentinel-1', 'Sentinel-2', 'Landsat', 'Terra', 'Aqua', 'Suomi-NPP', 'NOAA-20', 'GPM', 'SMAP', 'ICESat-2', 'ISS', 'SWOT'];

// ---------- raw CMR entry (subset) ----------
export interface CmrCollectionEntry {
  id: string;
  short_name: string;
  version_id?: string;
  title?: string;
  dataset_id?: string;
  data_center?: string;
  processing_level_id?: string;
  cloud_hosted?: boolean;
  platforms?: string[];
  links?: { rel: string; href: string }[];
}

export function formatTemporal(start: string, end: string): string {
  return `${new Date(start).toISOString().replace(/\.\d{3}Z$/, 'Z')},${new Date(end).toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
}

function pointParam(lon: number, lat: number): string {
  return `${+lon.toFixed(5)},${+lat.toFixed(5)}`;
}

/** Earthdata Search deep link; with a conceptId it opens that collection's granules. */
export function buildSearchUrl(opts: { lon: number; lat: number; start: string; end: string; conceptId?: string }): string {
  const { lon, lat, start, end, conceptId } = opts;
  const qt = new Date(start).toISOString().replace(/\.\d{3}Z$/, '.000Z') + ',' + new Date(end).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  const params: string[] = [];
  if (conceptId) params.push(`p=${encodeURIComponent(conceptId)}`);
  params.push(`sp%5B0%5D=${encodeURIComponent(pointParam(lon, lat))}`);
  params.push(`qt=${encodeURIComponent(qt)}`);
  params.push(`lat=${+lat.toFixed(3)}`, `long=${+lon.toFixed(3)}`, 'zoom=6');
  return `${EDS}${conceptId ? '/granules' : ''}?${params.join('&')}`;
}

/** Platform family: Sentinel-1A/B/C -> "Sentinel-1", LANDSAT-8 -> "Landsat", case-insensitive merge of the rest. */
export function platformFamily(p: string | undefined): string {
  const name = typeof p === 'string' ? p.trim() : '';
  if (!name || /^not provided$/i.test(name)) return 'Other platforms';
  let m = /^sentinel-?(\d)/i.exec(name);
  if (m) return `Sentinel-${m[1]}`;
  if (/^landsat/i.test(name)) return 'Landsat';
  if (/^suomi[- ]?npp$/i.test(name)) return 'Suomi-NPP';
  if (/^nisar$/i.test(name)) return 'NISAR';
  if (/^iss$/i.test(name)) return 'ISS';
  return name;
}

function findLink(links: CmrCollectionEntry['links'], pred: (l: { rel: string; href: string }) => boolean) {
  if (!Array.isArray(links)) return null;
  const ok = links.filter((l): l is { rel: string; href: string } => !!l && typeof l.href === 'string' && typeof l.rel === 'string');
  return ok.find(pred)?.href ?? null;
}

/** Parse a collections.json body into entries. Tolerates missing feed/entry. */
export function parseCollectionEntries(json: unknown): CmrCollectionEntry[] {
  const entry = (json as { feed?: { entry?: unknown } } | null)?.feed?.entry;
  return Array.isArray(entry)
    ? (entry as Partial<CmrCollectionEntry>[])
        .filter((e): e is Partial<CmrCollectionEntry> & { id: string } => !!e && typeof e.id === 'string')
        // short_name is required downstream (sorting, labels): fall back to the concept id instead of crashing
        .map((e) => ({ ...e, short_name: typeof e.short_name === 'string' && e.short_name ? e.short_name : e.id }) as CmrCollectionEntry)
    : [];
}

export function toCollection(e: CmrCollectionEntry, granules: number, q: { lon: number; lat: number; start: string; end: string }): EarthdataCollection {
  const doi = findLink(e.links, (l) => /^https?:\/\/(dx\.)?doi\.org\//i.test(l.href));
  const landing = findLink(e.links, (l) => /metadata#$/.test(l.rel) && !/doi\.org/i.test(l.href)) ?? findLink(e.links, (l) => /documentation#$/.test(l.rel) && !/\.pdf($|\?)/i.test(l.href));
  return {
    conceptId: e.id,
    shortName: e.short_name,
    version: e.version_id ?? '',
    title: e.title ?? e.dataset_id ?? e.short_name,
    platforms: Array.isArray(e.platforms) ? e.platforms.filter((x): x is string => typeof x === 'string') : [],
    provider: e.data_center ?? e.id.split('-').slice(1).join('-'),
    processingLevel: e.processing_level_id && e.processing_level_id !== 'Not provided' ? e.processing_level_id : null,
    granules,
    cloudHosted: !!e.cloud_hosted,
    searchUrl: buildSearchUrl({ ...q, conceptId: e.id }),
    doi,
    landingPage: landing,
  };
}

/** Group collections by platform family (a collection with several platforms appears under its first one). */
export function groupByPlatform(cols: EarthdataCollection[]): EarthdataGroup[] {
  const map = new Map<string, EarthdataGroup>();
  for (const c of cols) {
    const fam = platformFamily(c.platforms[0]);
    let g = map.get(fam.toLowerCase());
    if (!g) map.set(fam.toLowerCase(), (g = { platform: fam, granules: 0, collections: [] }));
    g.collections.push(c);
    g.granules += c.granules;
  }
  const rank = (p: string) => {
    const i = FAMILY_PRIORITY.findIndex((f) => f.toLowerCase() === p.toLowerCase());
    return i < 0 ? FAMILY_PRIORITY.length : i;
  };
  const groups = [...map.values()];
  for (const g of groups) g.collections.sort((a, b) => b.granules - a.granules || a.shortName.localeCompare(b.shortName));
  groups.sort((a, b) => rank(a.platform) - rank(b.platform) || b.granules - a.granules);
  return groups;
}

// ---------- network ----------
function withTimeout(parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), ms);
  const onAbort = () => ctl.abort(parent?.reason);
  if (parent) parent.aborted ? ctl.abort(parent.reason) : parent.addEventListener('abort', onAbort, { once: true });
  return { signal: ctl.signal, done: () => { clearTimeout(timer); parent?.removeEventListener('abort', onAbort); } };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** CMR-Hits header as a number; null when missing or not numeric ("unknown", never 0). */
function hitsOf(r: Response): number | null {
  const h = r.headers.get('CMR-Hits');
  return h !== null && /^\d+$/.test(h.trim()) ? Number(h) : null;
}

const nf = new Intl.NumberFormat('en-US');

/**
 * Sentence stating how much of the candidate list was checked; null when everything was checked.
 * One plain string so the translation layer sees a single text node.
 */
export function coverageNote(r: Pick<EarthdataResult, 'truncated' | 'checkedCollections' | 'candidateCollections' | 'totalCollections'>): string | null {
  if (!r.truncated) return null;
  const n = nf.format(r.checkedCollections ?? 0);
  const m = r.candidateCollections == null ? null : nf.format(r.candidateCollections);
  if (r.totalCollections === 0) {
    return `None of the ${n} candidate collections checked (the most-used and platform-targeted ones${m ? `, of ${m}` : '; more exist'}) has granules for this point and window. This is not a complete search.`;
  }
  return m
    ? `Checked ${n} of ${m} candidate collections (the most-used and platform-targeted ones); use Earthdata Search for the full list.`
    : `Checked ${n} candidate collections (the most-used and platform-targeted ones), but more exist; use Earthdata Search for the full list.`;
}

/** Collections (with granules) whose granules cover the point in the window, grouped by platform. */
export async function queryEarthdata(q: EarthdataQuery): Promise<EarthdataResult> {
  const { lon, lat, start, end } = q;
  if (![lon, lat].every(Number.isFinite) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    throw new Error('Invalid Earthdata query (lon/lat/start/end)');
  }
  const doFetch = q.fetchImpl ?? fetch;
  const t = withTimeout(q.signal, q.timeoutMs ?? 25000);
  const spatialTemporal = `point=${encodeURIComponent(pointParam(lon, lat))}&temporal%5B%5D=${encodeURIComponent(formatTemporal(start, end))}`;
  const base = `${CMR}/collections.json?has_granules=true&${spatialTemporal}&page_size=${PAGE_SIZE}&sort_key%5B%5D=-usage_score`;
  const hint = PLATFORM_HINTS.map((p) => `platform%5B%5D=${encodeURIComponent(p)}`).join('&');
  try {
    const [general, targeted] = await Promise.all([
      doFetch(base, { signal: t.signal }),
      doFetch(`${base}&options%5Bplatform%5D%5Bignore_case%5D=true&${hint}`, { signal: t.signal }),
    ]);
    const bodies = await Promise.all(
      [general, targeted].map(async (r) => {
        if (!r.ok) throw new Error(`NASA CMR responded HTTP ${r.status}`);
        return parseCollectionEntries(await r.json());
      }),
    );
    // Total matches of each candidate query; null = header missing (stripped by a proxy, not exposed via CORS).
    const hits = [general, targeted].map(hitsOf);
    const unique = new Map<string, CmrCollectionEntry>();
    for (const e of bodies.flat()) if (!unique.has(e.id)) unique.set(e.id, e);
    const MAX_CHECKED = 90;
    const entries = [...unique.values()].slice(0, MAX_CHECKED);

    // null = the count request failed: availability unknown, which must not be shown as "no data".
    const counted = await mapLimit(entries, 10, async (e): Promise<number | null> => {
      try {
        const r = await doFetch(`${CMR}/granules.json?collection_concept_id=${encodeURIComponent(e.id)}&${spatialTemporal}&page_size=0`, { signal: t.signal });
        if (!r.ok) return null;
        // A missing header (stripped by a proxy, not exposed via CORS) means "unknown", never 0 granules.
        return hitsOf(r);
      } catch (err) {
        if (t.signal.aborted) throw err;
        return null;
      }
    });
    const qq = { lon, lat, start, end };
    const cols = entries.flatMap((e, i) => {
      const n = counted[i];
      return n != null && n > 0 ? [toCollection(e, n, qq)] : [];
    });
    const groups = groupByPlatform(cols);
    return {
      groups,
      uncheckedCollections: counted.filter((n) => n == null).length,
      // Without the header a full page is assumed to have more behind it.
      truncated: unique.size > MAX_CHECKED || bodies.some((b, i) => (hits[i] == null ? b.length >= PAGE_SIZE : hits[i]! > b.length)),
      checkedCollections: counted.filter((n) => n != null).length,
      // The targeted query is a subset of the general one, so the general total is the candidate total.
      candidateCollections: hits[0] == null ? null : Math.max(hits[0], hits[1] ?? 0),
      totalCollections: cols.length,
      totalGranules: cols.reduce((s, c) => s + c.granules, 0),
      searchUrl: buildSearchUrl(qq),
      query: qq,
    };
  } catch (e) {
    if (q.signal?.aborted) throw e;
    if (t.signal.aborted) throw new Error('NASA CMR did not respond in time. Try again.');
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    t.done();
  }
}

/** Window helper: date (ISO) +/- days. */
export function windowAround(dateIso: string, days: number): { start: string; end: string } {
  const t = parseUTC(dateIso).getTime(); // offset-less times are UTC in this app (Date.parse would use local time)
  const ms = days * 864e5;
  const now = Date.now();
  return { start: new Date(t - ms).toISOString(), end: new Date(Math.min(t + ms, now)).toISOString() };
}
