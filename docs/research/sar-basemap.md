# Global SAR basemap for a browser globe (MapLibre, XYZ, no key)

Research date: 2026-11-14. All results below were fetched live (PowerShell `Invoke-WebRequest` / HttpClient) unless marked "docs only". This is a new research note, requested by the user's "second globe which is fully created from SAR" instruction.

## Bottom line

No key-free service offers a seamless, gap-free, global SAR basemap from zoom 0. Two things come close:

1. NASA GIBS NISAR + OPERA daily layers: work at every zoom 0-12/13, CORS `*`, 100% key-free, but each is a daily partial-swath mosaic, so a "whole Earth" look needs client-side stacking of the last ~12 days (NISAR repeat cycle = 12 d).
2. Microsoft Planetary Computer (PC) Sentinel-1 RTC / ALOS PALSAR mosaics: great imagery, but the tiler refuses zoom < 8 (hard limit), so useful only as a zoomed-in detail layer.

## Ranking

| # | Option | Global at z2/z5? | z8+ | Key-free + CORS | Verdict |
|---|---|---|---|---|---|
| 1 | GIBS `NISAR_L2_Geocoded_Polarimetric_Covariance` (L-band, daily), stack last 12 days | yes (land swaths, oceans blank) | yes (max z13) | yes, ACAO `*` | Best "SAR lens" for the globe, and it is L-band like the user wants |
| 2 | GIBS `OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1` (C-band, daily) | yes but coverage regional (N. America, Europe, parts of Asia/Africa) | yes (max z12) | yes, ACAO `*` | Good second layer, higher detail at z5-z8 |
| 3 | PC `sentinel-1-rtc` mosaic (register at runtime) | NO, HTTP 204 below z8 | yes, 1-15 s per tile | yes, ACAO `*` incl. POST + preflight | Detail layer only |
| 3b | PC `sentinel-1-grd` | NO, below z8 empty | yes | yes | Worse than RTC (raw DN, no terrain correction) |
| 3c | PC `alos-palsar-mosaic` (JAXA L-band yearly 2015-2021) | NO, HTTP 400 "below minimum zoom 8" | yes | yes | Best-looking L-band detail layer, only z8+ |
| 4 | CDSE Sentinel-1 global mosaics (monthly) | n/a | n/a | NO: assets are `s3://eodata/...` COGs, need S3 credentials | Rejected |
| 5 | JAXA Earth API PALSAR-2 | n/a | n/a | No tile endpoint (STAC + COG, client-side JS lib); only FNF map found in catalog | Rejected for XYZ |
| 6 | ASF NISAR browse | none separate | | | GIBS is the delivery route (see below) |

## Verified evidence

### GIBS (WMTS, EPSG:3857, "best")
Capabilities: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml` (5.8 MB, ~110 s once on this network; do not fetch it at runtime).

SAR-related layers in the full capabilities: only `NISAR_L2_Geocoded_Polarimetric_Covariance`, `OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1`, `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1` (derived water product), `SMAP_*` radar soil-moisture/sigma0 (coarse, 3-36 km), `OrbitTracks_*` for S1/NISAR. No Sentinel-1 or NISAR multi-day/monthly composite layer exists: the NISAR ASF docs mention `NISAR_L2_Geocoded_Polarimetric_Covariance_12Day`, but I requested it and got "LAYER does not exist" (also absent from capabilities in 3857 and 4326). Treat the 12-day composite as Worldview-side stacking only.

Template (note order is row=y, then col=x):
`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{LAYER}/default/{YYYY-MM-DD}/{TMS}/{z}/{y}/{x}.png`
Open-ended (no date) variant also exists = latest.

| Layer | TileMatrixSet | Time range in capabilities |
|---|---|---|
| NISAR GCOV | GoogleMapsCompatible_Level13 | 2025-10-29 .. 2026-11-11 (a few gaps in Mar-Apr, Jul-Aug 2026) |
| OPERA RTC-S1 | GoogleMapsCompatible_Level12 | 2025-01-10 .. 2026-11-13, sparse in 2025, near-daily 2026 |

Tile samples (date 2026-11-10, HTTP 200 `image/png`, ACAO `*`):

| Layer | z/y/x | bytes | ms |
|---|---|---|---|
| NISAR | 2/1/2 (Asia) | 2781 | 488 |
| NISAR | 2/1/1 | 288 (blank transparent) | 603 |
| NISAR | 5/10/16, 8/87/135 | 288 (blank that day) | 453 / 1597 |
| OPERA | 2/1/1 | 26706 | 1678 |
| OPERA | 2/1/2 | 51670 | 2543 |
| OPERA | 5/10/16 (Europe) | 90709 | 905 |
| OPERA | 5/13/22 (Asia) | 42282 | 789 |
| OPERA | 8/87/135 (Germany) | 202814 | 5043 |
| OPERA | 8/100/230 (ocean) | 1189 | 1807 |

Empty areas return HTTP 200 with a tiny transparent PNG (not 404), so no error handling is needed.

Appearance: false-colour RGB (co-pol in R and B, cross-pol in G; vegetation green for NISAR, magenta/green for OPERA), transparent where no swath. Single-day tiles show diagonal swaths; I composited 11-12 daily tiles in order (oldest first, newest on top) for z2 tiles: NISAR gives nearly complete land coverage of the tile (Asia/India), OPERA fills North America and Europe but leaves the open ocean and much of the southern hemisphere empty. NISAR is mostly land-oriented (oceans and open sea mostly blank). NISAR notes from ASF docs: 15.625 m pixels, PROVISIONAL products before 2026-10-21, VALIDATED after.

Licence/attribution: GIBS imagery is open NASA data. Suggested credit: "NISAR / OPERA imagery via NASA GIBS (NASA EOSDIS, ASF DAAC / JPL OPERA). Contains modified Copernicus Sentinel data (OPERA)". NASA/ESDIS asks for acknowledgement of GIBS. No specific credit line published by ASF for the GIBS layer.

### Microsoft Planetary Computer mosaic
Register (anonymous, no key), `POST https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register`, Content-Type `application/json`:

```json
{"collections":["sentinel-1-rtc"],"filter-lang":"cql2-json",
 "filter":{"op":"and","args":[
   {"op":"=","args":[{"property":"collection"},"sentinel-1-rtc"]},
   {"op":"anyinteracts","args":[{"property":"datetime"},{"interval":["2026-09-01T00:00:00Z","2026-11-01T00:00:00Z"]}]}]},
 "sortby":[{"field":"datetime","direction":"desc"}]}
```
Response 200 `{"id":"pc1.<ts>.<md5>","searchid":"...","links":[...]}`. Facts:
- CORS: preflight OPTIONS returns 204 with `access-control-allow-origin: *`, `allow-methods: POST`, `allow-headers: content-type`. The POST response itself carries `access-control-allow-origin: *`. So registration works from a browser.
- The hash in the id is deterministic for identical bodies (info shows `hash`), so re-registering is idempotent and cheap. A search registered at 09:30 still served tiles 15+ minutes later; documented lifetime is not published, so re-register on any 4xx.
- Required tile params: `collection=<id>` is mandatory (else 422 "Tile request must contain a collection parameter"). `assets=vv` etc.
- Min zoom: tiles below z8 returned HTTP 204 for both RTC and GRD; for ALOS the API says explicitly: "Zoom level 2 is below the minimum zoom level 8 configured for collection alos-palsar-mosaic". So z0-7 can never be served.
- Tile URL (RTC grayscale VV): `.../mosaic/{id}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png?collection=sentinel-1-rtc&assets=vv&rescale=0,0.5&colormap_name=gray`
  Verified 200 image/png at z8 (1.2 s, 120 KB), z9 (4.3 s), z10 (14.5 s). Pixel values are linear gamma0 (float32): rescale 0..0.5 for VV.
- GRD: z8 10 s, z9 10.8 s, 100 KB PNG; values are DN, rescale 0..300 used.
- ALOS PALSAR mosaic (L-band, 25 m, yearly 2015-2021, HH/HV DN): `assets=HH&assets=HV&asset_as_band=true&expression=HH;HV;HH&rescale=0,8000&rescale=0,5000&rescale=0,8000`: z8 200 (218 KB, 3.9 s, 4.7 s), ocean tile 404 `No assets found`. License field "proprietary" (JAXA: free, attribution required).
- Latency 1-15 s per tile, no-store cache headers on the register call; tile caching is limited. Coverage: RTC is only available on land areas where Microsoft processed it (Europe/N. America-heavy historically; global in recent years but with revisit gaps, 1-3 month windows leave holes).
- Licence: Sentinel-1 RTC is CC-BY-4.0 (Copernicus Sentinel data, processed by Microsoft). Suggested credit: "Contains modified Copernicus Sentinel-1 data, processed by Microsoft Planetary Computer".

### Not usable
- CDSE `sentinel-1-global-mosaics` (STAC `https://stac.dataspace.copernicus.eu/v1/collections/sentinel-1-global-mosaics`, monthly 2026 present, IW VV/VH) lists `s3://eodata/...` hrefs and `download.dataspace.copernicus.eu` products needing an account/token. No keyless tile service.
- JAXA Earth API (data.earth.jaxa.jp): COG + STAC, consumed by a JS/Python client library, no XYZ endpoint (docs only; catalog lists a PALSAR-2 forest/non-forest layer, not the mosaic). Digital Earth Africa serves the same JAXA mosaics by WCS for Africa only. EOX tiles (tiles.maps.eox.at) have no SAR layers (checked layer list).
- NISAR: GIBS above is the only keyless route; ASF's own web map and GCOV products need Earthdata login for downloads.

## Recommendation

Primary: GIBS NISAR GCOV (L-band, same sensor family as the user's NISAR theme), stacked over the last 12 days (newest on top), with GIBS OPERA RTC-S1 stacked underneath as a C-band fill for N. America/Europe/Asia, and optional PC detail layers (`sentinel-1-rtc` or `alos-palsar-mosaic`) with `minzoom: 8`. Expect black/transparent oceans, so give the globe a dark background so that "SAR void" looks intentional.

- Sensor/band/pol: NISAR L-band, HH/HV (dual) or quad-pol; false-colour RGB (R,B = co-pol, G = cross-pol), 15.6 m pixels; Sentinel-1 C-band VV/VH (OPERA RTC, 30 m).
- Date range: NISAR 2025-10-29 .. latest (daily, ~1-2 day latency); OPERA 2025-01-10 .. latest.
- Limits: daily partial swaths; 12-day NISAR stack covers land but not the open ocean; max native zoom 13 (NISAR) / 12 (OPERA), MapLibre overzooms; bundle the dates list is not needed because missing dates return blank tiles (verify 2026-03-01..04 gaps).

### Tile URL templates (MapLibre raster `tiles`)
```
https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance/default/{DATE}/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png
https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1/default/{DATE}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png
```
MapLibre only substitutes `{z}/{x}/{y}`, so inline DATE in JS and write `{z}/{y}/{x}` literally (it is replaced by name, order in the URL does not matter).

### TypeScript
```ts
type SarLayer = { id: string; tiles: string[]; minzoom: number; maxzoom: number; attribution: string };

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** One daily GIBS tile URL template. layer: NISAR (L13) or OPERA (L12). */
export function gibsSarTileUrl(layer: 'nisar' | 'opera', date: string): string {
  const [name, tms] = layer === 'nisar'
    ? ['NISAR_L2_Geocoded_Polarimetric_Covariance', 'GoogleMapsCompatible_Level13']
    : ['OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1', 'GoogleMapsCompatible_Level12'];
  return `${GIBS}/${name}/default/${date}/${tms}/{z}/{y}/{x}.png`;
}

/** Rolling N-day stack, oldest first so the newest sits on top. Add in this order. */
export function sarStack(days = 12, today = new Date()): SarLayer[] {
  const out: SarLayer[] = [];
  for (const layer of ['opera', 'nisar'] as const) {          // opera below nisar
    for (let i = days - 1; i >= 0; i--) {
      const d = iso(new Date(today.getTime() - (i + 1) * 864e5)); // +1: latency
      out.push({
        id: `sar-${layer}-${d}`,
        tiles: [gibsSarTileUrl(layer, d)],
        minzoom: 0,
        maxzoom: layer === 'nisar' ? 13 : 12,
        attribution: 'NISAR / OPERA (Sentinel-1) imagery via NASA GIBS',
      });
    }
  }
  return out;
}
// map.addSource(l.id, {type:'raster', tileSize:256, tiles:l.tiles, minzoom:l.minzoom, maxzoom:l.maxzoom, attribution:l.attribution});
// map.addLayer({id:l.id, type:'raster', source:l.id, paint:{'raster-fade-duration':0}});

/** Optional zoom >= 8 detail layer: PC Sentinel-1 RTC. Registers a mosaic search (anonymous, CORS ok). */
export async function pcS1RtcTileUrl(from: string, to: string): Promise<string> {
  const body = {
    collections: ['sentinel-1-rtc'], 'filter-lang': 'cql2-json',
    filter: { op: 'and', args: [
      { op: '=', args: [{ property: 'collection' }, 'sentinel-1-rtc'] },
      { op: 'anyinteracts', args: [{ property: 'datetime' }, { interval: [from, to] }] }] },
    sortby: [{ field: 'datetime', direction: 'desc' }],
  };
  const r = await fetch('https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PC register ${r.status}`);
  const { searchid } = await r.json();
  return `https://planetarycomputer.microsoft.com/api/data/v1/mosaic/${searchid}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png`
    + `?collection=sentinel-1-rtc&assets=vv&rescale=0,0.5&colormap_name=gray`; // use minzoom: 8
}
```
Keep the layer count in check: 24 raster layers load 24 tiles per cell. Consider 6 NISAR days + 6 OPERA days for performance, or request only the NISAR stack above z6.

## Open items
- Not verified: how long a PC search id stays valid (still fine after 15+ min; hash is deterministic so re-register on failure).
- Not verified: GIBS NISAR tiles for dates in the 2026-03-02..03 and other capability gaps (expected blank).
- Capabilities page mentions no licence text; credit line above is a suggestion, check NASA GIBS acknowledgement page before shipping.
