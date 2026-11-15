// Live, login-free services called from the browser.
import { safeHref } from './lib';

/** How long a live request may take (headers and body together) before it is reported as an error. */
export const REQUEST_TIMEOUT_MS = 20000;

/**
 * Runs one request with a time limit. A server that accepts the connection and never answers would
 * otherwise leave the panel on "loading" for minutes; here it ends as an error after REQUEST_TIMEOUT_MS.
 * The caller's own abort (a newer click or query) is passed through unchanged, so it stays an AbortError.
 */
export async function withDeadline<T>(signal: AbortSignal | undefined, timeoutMessage: string, run: (s: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctl.abort(signal?.reason);
  if (signal) signal.aborted ? onAbort() : signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort(new Error(timeoutMessage));
  }, REQUEST_TIMEOUT_MS);
  try {
    return await run(ctl.signal);
  } catch (e) {
    if (timedOut && !signal?.aborted) throw new Error(timeoutMessage);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export interface GeocodeHit {
  label: string;
  sub: string;
  lon: number;
  lat: number;
  extent?: [number, number, number, number]; // minLon, maxLat, maxLon, minLat (Photon order)
}

/** Photon (komoot) place search. Built for type-ahead; we debounce on the caller side. */
export async function geocode(q: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`;
  const json = await withDeadline(signal, `Search timed out after ${REQUEST_TIMEOUT_MS / 1000} s`, async (s) => {
    const res = await fetch(url, { signal: s });
    if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
    return res.json();
  });
  // An error body must not masquerade as "no places found".
  if (!Array.isArray(json?.features)) throw new Error('Search returned an unexpected response');
  // Skip individual garbled features (no properties / coordinates) instead of failing the whole search.
  return json.features.filter((f: any) => f?.properties && Array.isArray(f?.geometry?.coordinates) && Number.isFinite(f.geometry.coordinates[0]) && Number.isFinite(f.geometry.coordinates[1])).map((f: any) => {
    const p = f.properties;
    const sub = [p.state, p.country].filter(Boolean).join(', ');
    return {
      label: p.name || p.city || p.country,
      sub: [p.osm_value, sub].filter(Boolean).join(' · '),
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      extent: p.extent,
    };
  });
}

export interface CoverageGranule {
  scene: string;
  product: string;
  start: string;
  tier: string;
  track: number;
  frame: number;
  direction: string;
  thumb?: string;
  /** Full NASA browse picture (north-up lat/lon PNG of the whole product); http(s) only. */
  browse?: string;
  footprint: GeoJSON.Polygon;
}

export interface CoverageResult {
  lon: number;
  lat: number;
  total: number;
  granules: CoverageGranule[];
  /** ASF returned the maximum number of rows: there are more acquisitions than listed. */
  truncated?: boolean;
  /** Urgent Response granules found but not listed (tasked products, not routine coverage). */
  urgentResponse?: number;
}

const MAX_RESULTS = 250;

/**
 * Data tier from the ASF collection name. Same rules as pipeline/src/asf.mjs and pipeline/python/process.py,
 * except that an unrecognised name is 'UNKNOWN' here: a live API record must never be labelled VALIDATED
 * just because its name did not match (validated NISAR collections are named NISAR_L<level>_..._V<n>).
 */
export function tierOf(c = ''): string {
  if (c.startsWith('NISAR_UR')) return 'URGENT RESPONSE';
  if (c.includes('_BETA_')) return 'BETA';
  if (c.includes('_PROVISIONAL_')) return 'PROVISIONAL';
  if (/^NISAR_L\d/.test(c)) return 'VALIDATED';
  return 'UNKNOWN';
}

/** A non-empty string from an API row, or 'UNKNOWN' for anything else (missing, number, object). */
const text = (v: unknown): string => (typeof v === 'string' && v ? v : 'UNKNOWN');
/** A number (or numeric text) from an API row as it is; anything that cannot be shown as text is dropped. */
const printable = (v: unknown): number => (typeof v === 'number' || typeof v === 'string' ? v : undefined) as number;

/** Real NISAR acquisitions over a point, straight from the public ASF SearchAPI. */
export async function nisarCoverage(lon: number, lat: number, signal?: AbortSignal): Promise<CoverageResult> {
  const params = new URLSearchParams({
    dataset: 'NISAR',
    processingLevel: 'GCOV,GUNW',
    intersectsWith: `POINT(${lon.toFixed(4)} ${lat.toFixed(4)})`,
    maxResults: String(MAX_RESULTS),
    output: 'geojson',
  });
  const json = await withDeadline(signal, `ASF search timed out after ${REQUEST_TIMEOUT_MS / 1000} s`, async (s) => {
    const res = await fetch(`https://api.daac.asf.alaska.edu/services/search/param?${params}`, { signal: s });
    if (!res.ok) throw new Error(`ASF search failed (HTTP ${res.status})`);
    return res.json();
  });
  // An ASF error body must not masquerade as "no NISAR coverage here".
  if (!Array.isArray(json?.features)) throw new Error('ASF returned an unexpected response');
  const valid = json.features.filter((f: any) => f?.properties && typeof f.properties === 'object' && typeof f.properties.sceneName === 'string');
  const urgentResponse = valid.filter((f: any) => tierOf(String(f.properties.collectionName ?? '')) === 'URGENT RESPONSE').length;
  const granules: CoverageGranule[] = valid
    .filter((f: any) => tierOf(String(f.properties.collectionName ?? '')) !== 'URGENT RESPONSE')
    .map((f: any) => {
      const p = f.properties;
      // One malformed row must not stop the app: the panel calls string methods on product and direction and
      // renders track and frame as text, and the map reads footprint.coordinates. A value of the wrong type is
      // replaced by 'UNKNOWN' / nothing / no footprint; it is never guessed.
      const g = f.geometry;
      return {
        scene: p.sceneName,
        product: text(p.processingLevel),
        start: typeof p.startTime === 'string' ? p.startTime : '',
        tier: tierOf(typeof p.collectionName === 'string' ? p.collectionName : ''),
        track: printable(p.pathNumber),
        frame: printable(p.frameNumber),
        direction: text(p.flightDirection),
        // http(s) only, like every other external URL that reaches the DOM
        browse: Array.isArray(p.browse) ? safeHref(p.browse.find((u: unknown) => typeof u === 'string' && /_LATLON\.png$/i.test(u))) ?? undefined : undefined,
        thumb: Array.isArray(p.browse) ? safeHref(p.browse.find((u: unknown) => typeof u === 'string' && u.includes('thumbnail'))) ?? undefined : undefined,
        footprint: g && (g.type === 'Polygon' || g.type === 'MultiPolygon') && Array.isArray(g.coordinates) ? g : null,
      };
    })
    .sort((a: CoverageGranule, b: CoverageGranule) => b.start.localeCompare(a.start));
  // truncated is judged on the RAW response length: dropped urgent-response rows must not hide a capped list
  return { lon, lat, total: granules.length, granules, truncated: json.features.length >= MAX_RESULTS, urgentResponse };
}
