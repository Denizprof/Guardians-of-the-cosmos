import type { CatalogFile, Category, CategoryGroup, ContextEvent, EvidenceClass, SarEvent, SarLayer } from './types';

export const GROUPS: { id: CategoryGroup; label: string; color: string; categories: Category[] }[] = [
  { id: 'geohazards', label: 'Geohazards', color: '#ff7a45', categories: ['earthquake', 'volcano', 'landslide', 'subsidence', 'tsunami'] },
  { id: 'fire-forest', label: 'Fire & forests', color: '#ff4f7b', categories: ['wildfire', 'deforestation', 'vegetation'] },
  { id: 'climate', label: 'Climate & cryosphere', color: '#7fe0ff', categories: ['glacier', 'sea-ice', 'permafrost', 'coastal-change', 'drought', 'desertification'] },
  { id: 'water', label: 'Water', color: '#3fa9ff', categories: ['flood', 'reservoir', 'river-change', 'wetland'] },
  { id: 'ecosystems', label: 'Ecosystems', color: '#9fd36b', categories: ['habitat-loss', 'land-degradation', 'agri-conversion'] },
  {
    id: 'human-activity', label: 'Human activity', color: '#c9a0ff',
    categories: ['urban', 'industrial', 'mining', 'agriculture', 'infrastructure', 'energy', 'reclamation', 'conflict-damage', 'human-other'],
  },
];

export const CATEGORY_LABEL: Record<Category, string> = {
  earthquake: 'Earthquake', volcano: 'Volcano', landslide: 'Landslide', subsidence: 'Subsidence / uplift', tsunami: 'Tsunami',
  wildfire: 'Wildfire', deforestation: 'Deforestation', vegetation: 'Vegetation change',
  glacier: 'Glacier', 'sea-ice': 'Sea ice', permafrost: 'Permafrost', 'coastal-change': 'Coastal change', drought: 'Drought', desertification: 'Desertification',
  flood: 'Flood', reservoir: 'Lake / reservoir', 'river-change': 'River change', wetland: 'Wetland',
  'habitat-loss': 'Habitat loss', 'land-degradation': 'Land degradation', 'agri-conversion': 'Agricultural conversion',
  urban: 'Urban expansion', industrial: 'Industrial', mining: 'Mining / quarry', agriculture: 'Agriculture / irrigation',
  infrastructure: 'Transport infrastructure', energy: 'Energy infrastructure', reclamation: 'Land reclamation',
  'conflict-damage': 'Conflict damage', 'human-other': 'Other human activity',
};

export const CATEGORY_GROUP = Object.fromEntries(GROUPS.flatMap((g) => g.categories.map((c) => [c, g.id]))) as Record<Category, CategoryGroup>;

/** One accent colour per group, shared by all its categories. */
export const CATEGORY_COLOR = Object.fromEntries(
  GROUPS.flatMap((g) => g.categories.map((c) => [c, g.color]))
) as Record<Category, string>;

export const EVIDENCE_LABEL: Record<EvidenceClass, string> = {
  observation: 'Satellite observation',
  derived: 'Derived measurement',
  interpretation: 'Interpretation',
  model: 'Model output',
  simulation: 'Simulation',
};

/** NASA browse renderings are observations (visualized); our computations are derived. */
export function evidenceOf(l: SarLayer): EvidenceClass {
  return l.evidence ?? (l.kind === 'browse' ? 'observation' : 'derived');
}

/** Authoritative event catalogs built by pipeline/src/fetch-catalogs.mjs (loaded on demand). */
export const CATALOGS: { id: string; label: string; defaultOn: boolean }[] = [
  { id: 'firms-fires', label: 'Active fires, last 24 h (NASA FIRMS)', defaultOn: true },
  { id: 'noaa-tsunamis', label: 'Tsunamis since 1900 (NOAA NCEI)', defaultOn: true },
  { id: 'usgs-earthquakes', label: 'Earthquakes M7+ since 1900 (USGS)', defaultOn: false },
  { id: 'noaa-volcanoes', label: 'Significant eruptions since 1900 (NOAA NCEI)', defaultOn: false },
  { id: 'gdacs-floods', label: 'Flood alerts since 2000 (GDACS)', defaultOn: false },
  { id: 'nasa-glc', label: 'Landslides (NASA Global Landslide Catalog)', defaultOn: false },
];

const catalogCache = new Map<string, Promise<CatalogFile>>();
export function loadCatalog(id: string): Promise<CatalogFile> {
  if (!catalogCache.has(id)) {
    catalogCache.set(
      id,
      fetch(`data/catalogs/${id}.json`)
        .then((r) => {
          if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
          return r.json();
        })
        .then((c) => {
          if (!c || !Array.isArray(c.events)) throw new Error(`${id}: file has no events array`);
          return c as CatalogFile;
        })
        .catch((e) => {
          catalogCache.delete(id); // a transient failure must be retryable without reloading the page
          throw e;
        })
    );
  }
  return catalogCache.get(id)!;
}

export async function loadData(): Promise<{ events: SarEvent[]; context: ContextEvent[]; contextError: string | null; generated: string }> {
  const [ev, ctx] = await Promise.all([
    fetch('data/events.json').then(async (r) => {
      if (!r.ok) throw new Error(`events.json: HTTP ${r.status}`);
      const j = await r.json();
      if (!j || !Array.isArray(j.events)) throw new Error('events.json has no events array');
      return j;
    }),
    // Recent context events are optional for the app to work, but a failure must be visible, never "no events".
    fetch('data/context.json')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!j || !Array.isArray(j.events)) throw new Error('file has no events array');
        return { events: j.events as ContextEvent[], error: null as string | null };
      })
      .catch((e: unknown) => ({ events: [] as ContextEvent[], error: `Recent events could not be loaded (${e instanceof Error ? e.message : 'network error'}).` })),
  ]);
  return { events: ev.events, context: ctx.events, contextError: ctx.error, generated: ev.generated };
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Only http(s) links from external data may become hrefs (blocks javascript:, data:, etc.). */
export function safeHref(u: unknown): string | undefined {
  if (typeof u !== 'string') return undefined;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : undefined;
  } catch {
    return undefined;
  }
}

/** Parse an ISO timestamp as UTC. Strings without an offset (e.g. HDF5 "2026-08-11T02:08:40") are UTC in NISAR metadata. */
export function parseUTC(iso: string): Date {
  const s = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso) ? `${iso}Z` : iso;
  return new Date(s);
}

/** "17 Jan 2026" in UTC (dates are UTC everywhere in this app). */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = parseUTC(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Date at the precision the source actually knows. Historical catalog records known only to the year or
 * month are stored as YYYY-01-01 / YYYY-MM-01; showing "1 Jan 2002" would invent a day.
 */
export function fmtDatePrecise(iso?: string | null, precision?: string | null): string {
  if (!iso) return '—';
  const d = parseUTC(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (precision === 'year') return String(d.getUTCFullYear());
  if (precision === 'month') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return fmtDate(iso);
}

/** A date known only to the year or month cannot anchor a ±days satellite search window. */
export const isCoarseDate = (precision?: string | null) => precision === 'year' || precision === 'month';

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = parseUTC(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (!/T\d{2}:\d{2}/.test(iso)) return fmtDate(iso); // date only: no time to show
  return `${fmtDate(iso)} ${d.toISOString().slice(11, 16)} UTC`;
}

export function fmtCoord(lon: number, lat: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
}

/** Start date of a layer: single acquisition, or the reference date of a pair. */
export function layerStart(l: SarLayer): string {
  return (l.acquisition.start || l.acquisition.reference) as string;
}

export function layerLabel(l: SarLayer): string {
  if (l.acquisition.secondary) return `${fmtDate(l.acquisition.reference)} → ${fmtDate(l.acquisition.secondary)}`;
  return fmtDate(l.acquisition.start);
}

/** Bounding box of layers; null when there is nothing to bound (callers must not fitBounds to Infinity). */
export function layerBounds(layers: SarLayer[]): [[number, number], [number, number]] | null {
  const pts = layers.flatMap((l) => l.coordinates);
  if (!pts.length) return null;
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

/**
 * Parse coordinates typed or pasted by users. Accepts "10.5, -67.2", "+10.5 +67.2", "10.5N 67.2W",
 * lon-first with hemisphere letters ("67.2W 10.5N"), decimal commas ("10,5 N 67,2 W") and the Unicode
 * minus. Without letters the order is lat, lon. Returns [lon, lat] or null.
 */
export function parseCoords(q: string): [number, number] | null {
  let s = q.trim().replace(/−/g, '-');
  // Decimal comma only when no dots are used AND another separator (space / semicolon) splits the pair:
  // "45,5 90,2" -> 45.5 / 90.2, but a bare "45,90" is a lat,lon pair, not the number 45.90.
  if (!s.includes('.') && /[\s;]/.test(s)) s = s.replace(/(\d),(\d)/g, '$1.$2');
  const re = /^([NSEW])?\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/i;
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  // re-join "N 10.5" style tokens where the letter is separated from its number
  const tokens: string[] = [];
  for (const p of parts) {
    const last = tokens[tokens.length - 1];
    // a lone letter suffixes the previous number only if that number has no hemisphere yet
    if (/^[NSEW]$/i.test(p) && tokens.length && /\d$/.test(last) && !/[NSEW]/i.test(last)) tokens[tokens.length - 1] += p;
    else if (tokens.length && /^[NSEW]$/i.test(tokens[tokens.length - 1])) tokens[tokens.length - 1] += p;
    else tokens.push(p);
  }
  if (tokens.length !== 2) return null;
  const parsed = tokens.map((t) => {
    const m = t.match(re);
    if (!m) return null;
    const hemi = (m[1] || m[3] || '').toUpperCase();
    let v = parseFloat(m[2]);
    if (hemi === 'S' || hemi === 'W') v = -Math.abs(v);
    return { v, axis: hemi === 'N' || hemi === 'S' ? 'lat' : hemi === 'E' || hemi === 'W' ? 'lon' : null };
  });
  if (parsed.some((p) => p === null)) return null;
  const [a, b] = parsed as { v: number; axis: string | null }[];
  let lat: number, lon: number;
  if (a.axis === 'lon' || b.axis === 'lat') [lon, lat] = [a.v, b.v];
  else [lat, lon] = [a.v, b.v];
  if (a.axis && b.axis && a.axis === b.axis) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}
