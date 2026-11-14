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
      fetch(`data/catalogs/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
        return r.json();
      })
    );
  }
  return catalogCache.get(id)!;
}

export async function loadData(): Promise<{ events: SarEvent[]; context: ContextEvent[]; generated: string }> {
  const [ev, ctx] = await Promise.all([
    fetch('data/events.json').then((r) => {
      if (!r.ok) throw new Error(`events.json: HTTP ${r.status}`);
      return r.json();
    }),
    fetch('data/context.json')
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .catch(() => ({ events: [] })),
  ]);
  return { events: ev.events, context: ctx.events, generated: ev.generated };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  if (!s.includes('.')) s = s.replace(/(\d),(\d)/g, '$1.$2'); // decimal comma only when no dots are used
  const re = /^([NSEW])?\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/i;
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  // re-join "N 10.5" style tokens where the letter is separated from its number
  const tokens: string[] = [];
  for (const p of parts) {
    if (/^[NSEW]$/i.test(p) && tokens.length && /\d$/.test(tokens[tokens.length - 1]) && !/[NSEW]$/i.test(tokens[tokens.length - 1])) tokens[tokens.length - 1] += p;
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
