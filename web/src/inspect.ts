// Inspect area: pure helpers for the box a visitor draws on the globe and what the app knows inside it.
import type { Category, ContextEvent, SarEvent } from './types';

/** west, south, east, north (degrees). */
export type Box = [number, number, number, number];

const EARTH_KM = 6371.0088;
const MAX_LAT = 85;
/** Half the side of the box a plain click inspects. */
export const CLICK_HALF_KM = 50;
/** A drag shorter than this many pixels is a click. */
export const DRAG_MIN_PX = 6;

const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface LonLat {
  lon: number;
  lat: number;
}

/** The box with two opposite corners, in either order. The poles are cut at 85° where the map stops. */
export function normalizeBox(a: LonLat, b: LonLat): Box {
  const lat1 = clamp(Math.min(a.lat, b.lat), -MAX_LAT, MAX_LAT);
  const lat2 = clamp(Math.max(a.lat, b.lat), -MAX_LAT, MAX_LAT);
  return [Math.min(a.lon, b.lon), lat1, Math.max(a.lon, b.lon), lat2];
}

/** A square of about 2 × halfKm round a point (what a click inspects). */
export function pointBox(lon: number, lat: number, halfKm = CLICK_HALF_KM): Box {
  const dLat = (halfKm / EARTH_KM) * (180 / Math.PI);
  const cos = Math.max(0.05, Math.cos(rad(clamp(lat, -MAX_LAT, MAX_LAT))));
  const dLon = Math.min(180, dLat / cos);
  return normalizeBox({ lon: lon - dLon, lat: lat - dLat }, { lon: lon + dLon, lat: lat + dLat });
}

export const boxCenter = (box: Box): LonLat => ({ lon: (box[0] + box[2]) / 2, lat: (box[1] + box[3]) / 2 });

/** Area of the box on the sphere, in km². */
export function boxAreaKm2(box: Box): number {
  const [w, s, e, n] = box;
  return Math.abs(EARTH_KM * EARTH_KM * rad(e - w) * (Math.sin(rad(n)) - Math.sin(rad(s))));
}

/** East-west width (along the middle parallel) and north-south height, in km. */
export function boxSizeKm(box: Box): { widthKm: number; heightKm: number } {
  const mid = (box[1] + box[3]) / 2;
  return {
    widthKm: Math.abs(EARTH_KM * rad(box[2] - box[0]) * Math.cos(rad(mid))),
    heightKm: Math.abs(EARTH_KM * rad(box[3] - box[1])),
  };
}

export const inBox = (box: Box, lon: number, lat: number) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];

/** The ring of the box as a closed polygon, each side split so that it curves with the globe. */
export function boxRing(box: Box, steps = 12): [number, number][] {
  const [w, s, e, n] = box;
  const ring: [number, number][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i < steps; i++) ring.push([x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]);
  };
  edge(w, s, e, s);
  edge(e, s, e, n);
  edge(e, n, w, n);
  edge(w, n, w, s);
  ring.push(ring[0]);
  return ring;
}

/** A 3 × 3 grid of points over the box (corners, edge middles, centre): where terrain height is sampled. */
export function samplePoints(box: Box): LonLat[] {
  const [w, s, e, n] = box;
  const pts: LonLat[] = [];
  for (const lat of [s, (s + n) / 2, n]) for (const lon of [w, (w + e) / 2, e]) pts.push({ lon, lat });
  return pts;
}

export interface CategoryCount {
  category: Category;
  count: number;
}

export interface AreaSummary {
  areaKm2: number;
  widthKm: number;
  heightKm: number;
  center: LonLat;
  /** Catalog events inside the box. */
  total: number;
  byCategory: CategoryCount[];
  /** Largest first by magnitude, then newest first; at most `limit`. */
  top: ContextEvent[];
  strongestQuake: ContextEvent | null;
  latest: ContextEvent | null;
  /** The investigations whose place lies inside the box. */
  investigations: SarEvent[];
}

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

export function summarizeArea(box: Box, context: readonly ContextEvent[], events: readonly SarEvent[], limit = 8): AreaSummary {
  const inside = context.filter((c) => inBox(box, c.lon, c.lat));
  const counts = new Map<Category, number>();
  for (const c of inside) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  const byCategory = [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const ordered = [...inside].sort((a, b) => (b.magnitude ?? -1) - (a.magnitude ?? -1) || time(b.date) - time(a.date) || a.id.localeCompare(b.id));
  const quakes = inside.filter((c) => c.category === 'earthquake' && typeof c.magnitude === 'number');
  const strongestQuake = quakes.reduce<ContextEvent | null>((best, c) => (!best || (c.magnitude as number) > (best.magnitude as number) ? c : best), null);
  const latest = inside.reduce<ContextEvent | null>((best, c) => (!best || time(c.date) > time(best.date) ? c : best), null);
  const investigations = events.filter((e) => inBox(box, e.location.lon, e.location.lat) || (e.extra_points ?? []).some((p) => inBox(box, p.lon, p.lat)));
  return {
    areaKm2: boxAreaKm2(box),
    ...boxSizeKm(box),
    center: boxCenter(box),
    total: inside.length,
    byCategory,
    top: ordered.slice(0, limit),
    strongestQuake,
    latest,
    investigations,
  };
}

export interface Elevation {
  min: number;
  max: number;
  mean: number;
  centre: number;
  samples: number;
}

/** Terrain height over the box from the key-less Open-Meteo elevation service (Copernicus DEM, about 90 m). */
export async function fetchElevation(box: Box, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Elevation> {
  const pts = samplePoints(box);
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p.lat.toFixed(4)).join(',')}&longitude=${pts.map((p) => p.lon.toFixed(4)).join(',')}`;
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body: unknown = await res.json();
  const list = (body as { elevation?: unknown })?.elevation;
  if (!Array.isArray(list) || list.length !== pts.length || !list.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('The elevation service sent an unexpected answer');
  const v = list as number[];
  return { min: Math.min(...v), max: Math.max(...v), mean: v.reduce((a, b) => a + b, 0) / v.length, centre: v[4], samples: v.length };
}
