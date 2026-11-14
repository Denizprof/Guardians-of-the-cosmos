import type { Category, ContextEvent, SarEvent, SarLayer } from './types';

export const CATEGORY_LABEL: Record<Category, string> = {
  earthquake: 'Earthquake',
  flood: 'Flood',
  volcano: 'Volcano',
  wildfire: 'Wildfire',
  landslide: 'Landslide',
  glacier: 'Glacier',
  subsidence: 'Subsidence',
};

export const CATEGORY_COLOR: Record<Category, string> = {
  earthquake: '#ff7a45',
  flood: '#3fa9ff',
  volcano: '#ffb31a',
  wildfire: '#ff4f7b',
  landslide: '#b48cff',
  glacier: '#7fe0ff',
  subsidence: '#9fd36b',
};

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

/** "17 Jan 2026" in UTC (dates are UTC everywhere in this app). */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return `${fmtDate(iso)} ${iso.slice(11, 16)} UTC`;
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

export function layerBounds(layers: SarLayer[]): [[number, number], [number, number]] {
  const pts = layers.flatMap((l) => l.coordinates);
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

/** Parse "10.5, -67.2" / "10.5N 67.2W" style coordinates. Returns [lon, lat] or null. */
export function parseCoords(q: string): [number, number] | null {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSns])?[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EWew])?$/);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[3]);
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}
