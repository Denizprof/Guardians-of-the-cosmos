// Live, login-free services called from the browser.
import { safeHref } from './lib';

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
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  const json = await res.json();
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

/** Real NISAR acquisitions over a point, straight from the public ASF SearchAPI. */
export async function nisarCoverage(lon: number, lat: number, signal?: AbortSignal): Promise<CoverageResult> {
  const params = new URLSearchParams({
    dataset: 'NISAR',
    processingLevel: 'GCOV,GUNW',
    intersectsWith: `POINT(${lon.toFixed(4)} ${lat.toFixed(4)})`,
    maxResults: String(MAX_RESULTS),
    output: 'geojson',
  });
  const res = await fetch(`https://api.daac.asf.alaska.edu/services/search/param?${params}`, { signal });
  if (!res.ok) throw new Error(`ASF search failed (HTTP ${res.status})`);
  const json = await res.json();
  // An ASF error body must not masquerade as "no NISAR coverage here".
  if (!Array.isArray(json?.features)) throw new Error('ASF returned an unexpected response');
  const valid = json.features.filter((f: any) => f?.properties && typeof f.properties === 'object' && typeof f.properties.sceneName === 'string');
  const urgentResponse = valid.filter((f: any) => tierOf(String(f.properties.collectionName ?? '')) === 'URGENT RESPONSE').length;
  const granules: CoverageGranule[] = valid
    .filter((f: any) => tierOf(String(f.properties.collectionName ?? '')) !== 'URGENT RESPONSE')
    .map((f: any) => {
      const p = f.properties;
      return {
        scene: p.sceneName,
        product: p.processingLevel,
        start: typeof p.startTime === 'string' ? p.startTime : '',
        tier: tierOf(typeof p.collectionName === 'string' ? p.collectionName : ''),
        track: p.pathNumber,
        frame: p.frameNumber,
        direction: p.flightDirection ?? 'UNKNOWN',
        // http(s) only, like every other external URL that reaches the DOM
        thumb: Array.isArray(p.browse) ? safeHref(p.browse.find((u: unknown) => typeof u === 'string' && u.includes('thumbnail'))) ?? undefined : undefined,
        footprint: f.geometry ?? null,
      };
    })
    .sort((a: CoverageGranule, b: CoverageGranule) => b.start.localeCompare(a.start));
  // truncated is judged on the RAW response length: dropped urgent-response rows must not hide a capped list
  return { lon, lat, total: granules.length, granules, truncated: json.features.length >= MAX_RESULTS, urgentResponse };
}
