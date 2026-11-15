// SAR lens: the radar basemap shown inside the draggable square (a second, camera-synced map).
// Swap SAR_LENS_SOURCE to plug in a different global SAR mosaic; nothing else needs to change.
// Source research: docs/research/sar-basemap.md.
import { fmtDate } from '../lib';

/** One daily (or static) raster product in the lens stack. */
export interface SarLensLayer {
  id: string;
  /** XYZ raster template. `{time}` (optional) is replaced by a YYYY-MM-DD date. */
  tiles: string;
  /**
   * On-screen size of one tile. The services serve 256 px tiles; 256 shows them at native sharpness. (512 drew
   * each at 2x, one zoom level coarser, and looked blocky. It was a load-saving choice from when the lens
   * rendered the whole window; it now renders only its square from zoom 5, so full resolution is affordable.)
   */
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  /**
   * Daily-swath products cover only what the satellite flew over that day and no multi-day composite is
   * published, so the lens stacks the last N days (newest on top). Ignored without `{time}`.
   */
  stackDays: number;
  /** Days between acquisition and tiles being served (the newest stacked day is today minus this). */
  lagDays: number;
}

export interface SarLensSource {
  id: string;
  /** Short name used in the lens label: "SAR view: <label>, <date>". */
  label: string;
  /** Drawn bottom to top: the first entry is the underlay, the last one wins where both have data. */
  layers: SarLensLayer[];
  /** Fixed end date (YYYY-MM-DD) for the stack; null = most recent complete UTC day. */
  date: string | null;
  /** True when the source does not cover the whole globe at any one time; shown in the label. */
  partial: boolean;
  /** Short honest caveat shown next to the label when `partial`. */
  partialNote: string;
  attribution: string;
  /** Provenance lines for the lens tooltip. */
  provenance: string[];
}

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

/** NASA GIBS (key-free, CORS *): NISAR L2 GCOV on top of OPERA RTC-S1 (Sentinel-1). */
export const SAR_LENS_SOURCE: SarLensSource = {
  id: 'gibs-nisar-gcov+opera-rtc-s1',
  label: 'NISAR over Sentinel-1 radar',
  layers: [
    {
      id: 'opera-rtc-s1',
      tiles: `${GIBS}/OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1/default/{time}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`,
      tileSize: 256,
      minzoom: 0,
      maxzoom: 12,
      stackDays: 6,
      lagDays: 1,
    },
    {
      id: 'nisar-gcov',
      tiles: `${GIBS}/NISAR_L2_Geocoded_Polarimetric_Covariance/default/{time}/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`,
      tileSize: 256,
      minzoom: 0,
      maxzoom: 13,
      stackDays: 6,
      // checked 14 Nov 2026 (headless run): 12 Nov still answered 404 on every tile, so the newest published
      // day is three back. A day that is published later than this answers 404; the tile loader
      // (map/lensTiles.ts) reports that status, does not retry it and stops asking for that day for a while,
      // and MapLibre raises no error for a 404 tile: a late day costs one missing layer, not a failure notice.
      lagDays: 3,
    },
  ],
  date: null,
  partial: true,
  partialNote: 'mosaic of recent daily passes, with gaps',
  attribution: 'NISAR / OPERA (Sentinel-1) imagery via NASA GIBS',
  provenance: [
    'Top: NISAR L2 GCOV, L-band 24 cm geocoded backscatter (NASA/JPL-Caltech and ISRO), daily tiles since 29 Oct 2025.',
    'Beneath: OPERA L2 RTC-S1, Copernicus Sentinel-1 C-band 5.6 cm terrain-corrected backscatter (NASA JPL OPERA, ASF DAAC).',
    'Shown in grey: brightness is the strength of the radar echo (bright = rough ground, buildings, vegetation; dark = smooth surfaces such as calm water). NASA publishes these tiles in false colour (co-polarized signal in red and blue, cross-polarized in green) with a different colour balance for each mission; the lens removes the colour so the two missions read as one picture. 8-bit visualization, not calibrated dB values.',
    'Coverage: each day holds only the swaths flown that day and no global composite exists. The lens stacks the most recent days, newest on top; dark areas had no radar pass in that window (or lie outside the product footprint).',
  ],
};

/**
 * How the lens draws every radar tile. The two products arrive in different false-colour balances (NISAR
 * passes looked like green stripes over a white and magenta Sentinel-1 picture), so colour is removed and
 * the peak brightness is lowered a little so bright land is not a flat white. Display only: no values change.
 */
export const LENS_RASTER_PAINT = {
  'raster-fade-duration': 0,
  'raster-saturation': -1,
  'raster-brightness-max': 0.86,
  'raster-contrast': 0.12,
  'raster-resampling': 'linear',
} as const;

const DAY = 864e5;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const timed = (l: SarLensLayer) => l.tiles.includes('{time}');

function endOf(src: SarLensSource, layer: SarLensLayer, now: number): number {
  const parsed = src.date ? Date.parse(`${src.date}T00:00:00Z`) : NaN;
  // Today's tiles are still being produced, so the stack ends `lagDays` back.
  return Number.isNaN(parsed) ? now - Math.max(1, layer.lagDays) * DAY : parsed;
}

/** The UTC days one layer draws, oldest first (drawn first) to newest. Empty for a time-less mosaic. */
export function layerDates(src: SarLensSource, layer: SarLensLayer, now: number = Date.now()): string[] {
  if (!timed(layer)) return [];
  const end = endOf(src, layer, now);
  const n = Math.max(1, Math.floor(layer.stackDays));
  return Array.from({ length: n }, (_, i) => iso(end - (n - 1 - i) * DAY));
}

/** Every UTC day any layer of the lens shows, oldest first. */
export function lensDates(src: SarLensSource, now: number = Date.now()): string[] {
  return [...new Set(src.layers.flatMap((l) => layerDates(src, l, now)))].sort();
}

export interface LensTile {
  /** Unique within the stack, e.g. "nisar-gcov-2026-11-13". */
  id: string;
  date: string | null;
  url: string;
  tileSize: number;
  minzoom: number;
  maxzoom: number;
}

/** Raster sources in draw order (bottom first). */
export function lensTileUrls(src: SarLensSource, now?: number): LensTile[] {
  return src.layers.flatMap((l): LensTile[] => {
    const base = { tileSize: l.tileSize, minzoom: l.minzoom, maxzoom: l.maxzoom };
    const dates = layerDates(src, l, now);
    if (!dates.length) return [{ id: l.id, date: null, url: l.tiles, ...base }];
    return dates.map((date) => ({ id: `${l.id}-${date}`, date, url: l.tiles.replace('{time}', date), ...base }));
  });
}

/** "8 to 13 Nov 2026" / "13 Nov 2026" / "" (time-less mosaic). */
export function lensDateLabel(src: SarLensSource, now?: number): string {
  const d = lensDates(src, now);
  if (!d.length) return src.date ? fmtDate(src.date) : '';
  if (d.length === 1) return fmtDate(d[0]);
  const a = fmtDate(d[0]);
  const b = fmtDate(d[d.length - 1]);
  // Same month and year: "8 to 13 Nov 2026"
  const [ad, ...arest] = a.split(' ');
  return arest.join(' ') === b.split(' ').slice(1).join(' ') ? `${ad} to ${b}` : `${a} to ${b}`;
}
