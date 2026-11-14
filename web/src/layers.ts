// Global satellite layer catalog (NASA GIBS, ESA WorldCover, UMD forest loss, ...).
// Entries are live-verified by the research step and stored in public/data/layers.json.
import type { CategoryGroup, EvidenceClass } from './types';
import type { TileOverlay } from './map/MapView';
import { withNodataKey } from './map/nodataKey';

export interface CatalogLayer {
  id: string;
  title: string;
  category: CategoryGroup;
  subcategories: string[];
  kind: Extract<EvidenceClass, 'observation' | 'derived' | 'model'>;
  provider: string;
  mission: string;
  sensor: string;
  url: string;
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  time: null | { start: string; end: string; step: string; default: string; format?: 'YYYY' };
  resolution: string;
  license: string;
  attribution: string;
  description_simple: string;
  description_scientific: string;
  limitations: string;
  verified: { date: string; sample_tile: string; status: number; content_type: string; cors: string | null };
  /** Colour legend from the provider's official colormap / documentation (see components/LayerLegend.tsx). */
  legend?: unknown;
  /** 'black': a JPEG layer whose no-data pixels are solid black; keyed to transparent when drawn. */
  nodata?: 'black';
}

export async function loadLayerCatalog(): Promise<CatalogLayer[]> {
  const r = await fetch('data/layers.json');
  // A failure is an error the panel shows, not an "empty catalog".
  if (!r.ok) throw new Error(`layers.json: HTTP ${r.status}`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : j?.layers;
  if (!Array.isArray(list)) throw new Error('layers.json has no layer list');
  // drop entries without the fields every layer row and tile URL needs
  return list.filter((l): l is CatalogLayer => !!l && typeof l.id === 'string' && typeof l.title === 'string' && typeof l.category === 'string');
}

const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

/** Clamp a date into the layer's valid range (end 'present' = yesterday, since today's tiles may be incomplete). */
export function clampDate(l: CatalogLayer, d: string): string {
  if (!l.time || l.time.step.startsWith('PT')) return d.slice(0, 10);
  d = d.slice(0, 10);
  const end = l.time.end === 'present' ? yesterday() : l.time.end;
  return d > end ? end : d < l.time.start ? l.time.start : d;
}

export function defaultDate(l: CatalogLayer): string | null {
  if (!l.time) return null;
  return clampDate(l, l.time.default || yesterday());
}

/** Sub-daily layers (e.g. GOES every 10 min) are shown at their latest slot; no date picker. */
export function isSubDaily(l: CatalogLayer): boolean {
  return !!l.time && l.time.step.startsWith('PT');
}

/**
 * Turn a picked date into the exact {time} token each service expects:
 *  - P1Y with format 'YYYY' (EOX yearly mosaics): "2025"
 *  - P1Y otherwise (GIBS annual products): "2025-01-01"
 *  - P16D (MODIS 16-day composites): start of the composite period (day-of-year 1, 17, 33, ...)
 *  - PT10M (GOES): latest 10-minute boundary at least 40 min old, ISO with Z
 */
export function timeToken(l: CatalogLayer, date: string | null): string {
  if (!l.time) return '';
  const step = l.time.step;
  if (step.startsWith('PT')) {
    const t = new Date(Date.now() - 40 * 60 * 1000);
    t.setUTCMinutes(Math.floor(t.getUTCMinutes() / 10) * 10, 0, 0);
    return t.toISOString().replace('.000Z', 'Z');
  }
  const d = clampDate(l, date ?? defaultDate(l) ?? l.time.start);
  if (step === 'P1Y') return l.time.format === 'YYYY' ? d.slice(0, 4) : `${d.slice(0, 4)}-01-01`;
  if (step === 'P16D') {
    const y = Number(d.slice(0, 4));
    const doy = Math.floor((Date.parse(d) - Date.UTC(y, 0, 1)) / 864e5); // 0-based
    const start = new Date(Date.UTC(y, 0, 1 + Math.floor(doy / 16) * 16));
    return start.toISOString().slice(0, 10);
  }
  return d;
}

export function toOverlay(l: CatalogLayer, date: string | null, opacity: number): TileOverlay {
  // Sub-daily layers (GOES, every 10 min): time slots are published irregularly (probed 14 Nov 2026: -40 min
  // 404, -60 min 200, -3 h to -6 h 404), so any computed slot can miss. GIBS serves the latest available
  // image when the time segment is left out, which is exactly what "latest" in the panel promises.
  const url = isSubDaily(l) ? l.url.replace('{time}/', '') : l.url.replace('{time}', timeToken(l, date));
  return {
    id: l.id,
    // JPEG layers whose no-data is solid black get it keyed to transparent (see map/nodataKey.ts)
    url: l.nodata === 'black' ? withNodataKey(url) : url,
    tileSize: l.tileSize,
    minzoom: l.minzoom,
    maxzoom: l.maxzoom,
    opacity,
    attribution: l.attribution,
  };
}
