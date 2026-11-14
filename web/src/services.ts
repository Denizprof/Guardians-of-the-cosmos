// Live, login-free services called from the browser.

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
  return json.features.map((f: any) => {
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
}

function tierOf(c = ''): string {
  if (c.startsWith('NISAR_UR')) return 'URGENT RESPONSE';
  if (c.includes('_BETA_')) return 'BETA';
  if (c.includes('_PROVISIONAL_')) return 'PROVISIONAL';
  return 'VALIDATED';
}

/** Real NISAR acquisitions over a point, straight from the public ASF SearchAPI. */
export async function nisarCoverage(lon: number, lat: number, signal?: AbortSignal): Promise<CoverageResult> {
  const params = new URLSearchParams({
    dataset: 'NISAR',
    processingLevel: 'GCOV,GUNW',
    intersectsWith: `POINT(${lon.toFixed(4)} ${lat.toFixed(4)})`,
    maxResults: '250',
    output: 'geojson',
  });
  const res = await fetch(`https://api.daac.asf.alaska.edu/services/search/param?${params}`, { signal });
  if (!res.ok) throw new Error(`ASF search failed (HTTP ${res.status})`);
  const json = await res.json();
  const granules: CoverageGranule[] = json.features
    .filter((f: any) => !String(f.properties.collectionName).startsWith('NISAR_UR'))
    .map((f: any) => {
      const p = f.properties;
      return {
        scene: p.sceneName,
        product: p.processingLevel,
        start: p.startTime,
        tier: tierOf(p.collectionName),
        track: p.pathNumber,
        frame: p.frameNumber,
        direction: p.flightDirection,
        thumb: (p.browse || []).find((u: string) => u.includes('thumbnail')),
        footprint: f.geometry,
      };
    })
    .sort((a: CoverageGranule, b: CoverageGranule) => b.start.localeCompare(a.start));
  return { lon, lat, total: granules.length, granules };
}
