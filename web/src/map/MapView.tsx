import { memo, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Category, CompareMode, ContextEvent, SarEvent, SarLayer } from '../types';
import { CATEGORY_COLOR, layerBounds } from '../lib';
import type { CoverageResult } from '../services';
import type { Pin } from '../content/explain';
import { LENS_RASTER_PAINT, SAR_LENS_SOURCE, lensTileUrls } from './sarLens';
import { registerNodataProtocol } from './nodataKey';
import { createTileErrorPolicy } from './tileErrors';

// Untouched worker copy served from public/vendor (see vite.config.ts).
maplibregl.setWorkerUrl(new URL('vendor/maplibre-gl-worker.mjs', document.baseURI).href);
// JPEG satellite layers with black no-data (VIIRS true colour etc.) are keyed to transparent; see nodataKey.ts
registerNodataProtocol(maplibregl as unknown as Parameters<typeof registerNodataProtocol>[0]);
// Up to three maps (A, B, SAR lens) share one image queue; the lens alone stacks twelve raster sources (two products x six days).
maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS = 32;
maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME = 16;

// ---------------------------------------------------------------------------------------------
// "Google Earth" style: photoreal satellite globe + 3D terrain + thin borders and labels on top.
// All sources are free and key-less; see the attribution strings (also credited in IntroPanel).
// ---------------------------------------------------------------------------------------------
const HOME_CENTER: [number, number] = [15, 12];
/** Whole-globe zoom that fills the view without clipping the limb (phones are narrower). */
const homeZoom = () => (window.innerWidth <= 820 ? 1.2 : 2);
const EVENT_PITCH = 45;
const EVENT_BEARING = -14;
const TERRAIN = { source: 'dem', exaggeration: 1.4 };
/** Terrain is only switched on when close enough to see relief (keeps the whole-globe view light). */
const TERRAIN_ON_ZOOM = 6.5;
const TERRAIN_OFF_ZOOM = 5.5;
/** Native detail of the 10 m Sentinel-2 basemap is ~z14; allow a little overzoom, no more. */
const MAX_ZOOM = 14.5;

const NAME: any = ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
const IS_POINT: any = ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false];
const LABEL_PAINT = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(4, 7, 12, 0.85)', 'text-halo-width': 1.4, 'text-halo-blur': 0.4 };
const FONT = ['Noto Sans Regular'];

const STYLE: StyleSpecification = {
  version: 8,
  name: 'Global SAR Earth',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  projection: { type: 'globe' },
  sky: {
    // Transparent "space" so the CSS starfield shows through; blue glow at the limb / horizon.
    'sky-color': ['interpolate', ['linear'], ['zoom'], 0, 'rgba(1, 4, 12, 0)', 6, 'rgba(2, 8, 22, 0.35)', 10, '#1d4f96', 13, '#4a8fdc'],
    'horizon-color': ['interpolate', ['linear'], ['zoom'], 0, '#4d9cf5', 8, '#8cc0f5', 13, '#cfe6fb'],
    'fog-color': '#a9cbee',
    'sky-horizon-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.35, 8, 0.6, 13, 0.9],
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.85,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 9, 0.4, 12, 0],
  },
  sources: {
    // Always-loaded low-resolution copy of the same imagery (z0-z3 = 85 tiles for the whole planet).
    // It sits under the full-resolution layer, so a fast zoom-out shows slightly soft imagery for a moment
    // instead of black holes while the right-zoom tiles load.
    'satellite-base': {
      type: 'raster',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      maxzoom: 3,
    },
    satellite: {
      type: 'raster',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      maxzoom: 14,
      attribution:
        '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">Sentinel-2 cloudless 2024</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0',
    },
    dem: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 11, // relief at z11 (~76 m/px at the equator) is plenty under 10 m imagery; 1/16 of the z13 DEM tile count for the same area
      attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen / AWS Terrain Tiles</a>',
    },
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  layers: [
    // Deep-ocean blue rather than near-black: the last-resort colour under any not-yet-loaded tile.
    { id: 'background', type: 'background', paint: { 'background-color': '#0b1d36' } },
    {
      id: 'satellite-base', type: 'raster', source: 'satellite-base',
      paint: { 'raster-fade-duration': 0, 'raster-saturation': 0.12, 'raster-contrast': 0.06 },
    },
    {
      id: 'satellite', type: 'raster', source: 'satellite',
      paint: { 'raster-fade-duration': 100, 'raster-saturation': 0.12, 'raster-contrast': 0.06 },
    },
    {
      id: 'road-major', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 8,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.12, 12, 0.3], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 14, 1.8] },
    },
    {
      id: 'boundary-state', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', minzoom: 3.5,
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.3, 'line-dasharray': [3, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 10, 1] },
    },
    {
      id: 'boundary-country-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#04070c', 'line-opacity': 0.35, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.4, 6, 2.6, 12, 4] },
    },
    {
      id: 'boundary-country', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.6, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.1, 12, 2] },
    },
    // ---- labels (first symbol layer = insertion point for SAR imagery and coverage footprints)
    {
      id: 'label-water', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name', filter: IS_POINT,
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 6, 13], 'text-letter-spacing': 0.18, 'text-max-width': 6 },
      paint: { 'text-color': '#bcd9f7', 'text-halo-color': 'rgba(2, 10, 24, 0.7)', 'text-halo-width': 1.2 },
    },
    {
      id: 'label-village', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 10.5,
      filter: ['all', IS_POINT, ['==', ['get', 'class'], 'village']],
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 11, 'text-max-width': 8 },
      paint: LABEL_PAINT,
    },
    {
      id: 'label-town', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 7.5,
      filter: ['all', IS_POINT, ['==', ['get', 'class'], 'town']],
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10.5, 12, 13], 'text-max-width': 8 },
      paint: LABEL_PAINT,
    },
    {
      id: 'label-city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 4,
      filter: ['all', IS_POINT, ['==', ['get', 'class'], 'city']],
      layout: {
        'text-field': NAME, 'text-font': FONT, 'text-max-width': 8,
        'symbol-sort-key': ['get', 'rank'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, ['case', ['<=', ['get', 'rank'], 3], 11.5, 10], 10, ['case', ['<=', ['get', 'rank'], 3], 16, 13.5]],
      },
      paint: LABEL_PAINT,
    },
    {
      id: 'label-state', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 4.5, maxzoom: 9,
      filter: ['all', IS_POINT, ['==', ['get', 'class'], 'state']],
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 10.5, 'text-transform': 'uppercase', 'text-letter-spacing': 0.12, 'text-max-width': 7 },
      paint: { ...LABEL_PAINT, 'text-color': 'rgba(255, 255, 255, 0.8)' },
    },
    {
      id: 'label-country', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', maxzoom: 8,
      filter: ['all', IS_POINT, ['==', ['get', 'class'], 'country']],
      layout: {
        'text-field': NAME, 'text-font': FONT, 'text-max-width': 7, 'text-letter-spacing': 0.06,
        'symbol-sort-key': ['get', 'rank'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['<=', ['get', 'rank'], 1], 11.5, 10], 5, ['case', ['<=', ['get', 'rank'], 1], 17, 14]],
      },
      paint: LABEL_PAINT,
    },
  ],
};

export interface MapViewProps {
  events: SarEvent[];
  context: ContextEvent[];
  visibleCategories: Set<Category>;
  showContext: boolean;
  selected: SarEvent | null;
  before: SarLayer | null;
  after: SarLayer | null;
  mode: CompareMode;
  overlayOpacity: number;
  coverage: CoverageResult | null;
  pins: Pin[];
  activePin: string | null;
  panelInset: { right: number; bottom: number };
  onSelectEvent: (id: string) => void;
  /** A reported / catalog marker was clicked (id of the ContextEvent). */
  onSelectContext: (id: string) => void;
  onMapClick: (lon: number, lat: number) => void;
  onPin: (id: string) => void;
  flyTo: { lon: number; lat: number; zoom?: number; bbox?: [number, number, number, number]; nonce: number } | null;
  tileOverlays?: TileOverlay[];
  /** The point the side panel is about (reported event or coverage probe): drawn as a ring. */
  focus: { lon: number; lat: number } | null;
  /** SAR lens: null = off. `nisar` is the investigation layer to draw over the SAR basemap, if any. */
  lens: { nisar: SarLayer | null } | null;
  /** A source failed to load (tiles, NISAR image, style). Failures must be visible, never read as "no data". */
  onMapError?: (where: 'globe' | 'lens', source: string) => void;
}

/** Turn a MapLibre error event into a short source label and report it (also logged for diagnosis). */
function mapErrorReporter(where: 'globe' | 'lens', report: () => MapViewProps['onMapError']) {
  return (e: { sourceId?: string; error?: { message?: string; status?: number } }) => {
    const source = e?.sourceId ?? 'map style';
    console.warn(`[map:${where}] ${source} failed to load`, e?.error?.status ?? '', e?.error?.message ?? '');
    report()?.(where, source);
  };
}

/** Enable 3D terrain when zoomed in, drop it again for the whole-globe view (with hysteresis). */
function syncTerrain(map: MlMap) {
  if (!map.getSource('dem')) return;
  const z = map.getZoom();
  const on = !!map.getTerrain();
  if (!on && z >= TERRAIN_ON_ZOOM) map.setTerrain(TERRAIN);
  else if (on && z < TERRAIN_OFF_ZOOM) map.setTerrain(null);
}

function makeMap(container: HTMLElement, reducedMotion: () => boolean): MlMap {
  const map = new maplibregl.Map({
    container,
    style: STYLE,
    center: HOME_CENTER,
    zoom: homeZoom(),
    attributionControl: { compact: true },
    maxPitch: 75,
    fadeDuration: 0,
    // Two terrain-enabled maps at 3x device pixels is too heavy for phones.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    // Sentinel-2 cloudless is 10 m/pixel (native ~z14). Deeper zoom only stretched tiles into blur
    // with visible seams between tile levels, so stop at ~1.4x overzoom.
    maxZoom: MAX_ZOOM,
    refreshExpiredTiles: false,
    // Keep tiles from more zoom levels in memory (default 5), so zooming back out reuses what was
    // already loaded on the way in instead of re-requesting it.
    maxTileCacheZoomLevels: 10,
    // Ask the browser for the high-performance (discrete) GPU. A page cannot pick a GPU by index;
    // to force one, set the browser to "High performance" in Windows Graphics settings.
    canvasContextAttributes: { powerPreference: 'high-performance', contextType: 'webgl2', antialias: false },
  });
  map.on('style.load', () => map.setProjection({ type: 'globe' }));
  map.on('zoom', () => syncTerrain(map));
  map.on('moveend', () => syncTerrain(map));
  // Like Google Earth: when the user zooms back out to globe scale, level the camera so the
  // whole globe (and its atmosphere) is seen straight on.
  map.on('zoomend', (e) => {
    if (!(e as any).originalEvent) return; // only react to the user's own zooming, not fly-ins
    if (map.getZoom() < 4.5 && map.getPitch() > 1) map.easeTo({ pitch: 0, duration: reducedMotion() ? 0 : 600 });
  });
  attachHalo(map);
  return map;
}

/**
 * Blue atmospheric glow around the limb. MapLibre's own atmosphere only shades the globe surface, so the
 * halo is a CSS ring placed behind the (transparent) canvas and tracked to the globe's on-screen silhouette.
 */
function attachHalo(map: MlMap) {
  const HALO_SCALE = 1.35; // element half-size relative to the globe radius; matches the gradient stops in styles.css
  const cont = map.getContainer();
  // One halo per container. The map can be created more than once on the same element (React StrictMode
  // remount in development, hot reload, a remounted MapView); a halo left behind by an earlier map no longer
  // follows the camera and stays frozen at its old size: when the user zoomed far out, that orphan showed as
  // a big detached ring around a small globe.
  cont.querySelectorAll(':scope > .globe-halo').forEach((old) => old.remove());
  const halo = document.createElement('div');
  halo.className = 'globe-halo';
  cont.prepend(halo);
  map.once('remove', () => halo.remove());
  const rad = Math.PI / 180;
  const update = () => {
    const z = map.getZoom();
    // Fades out as the globe outgrows the screen, and while the camera is tilted: the ring is
    // exact for a straight-down view only, so it must never float off the globe in tilted views.
    const tilt = map.getPitch();
    const k = Math.max(0, Math.min(1, (5.5 - z) / 1.5)) * Math.max(0, 1 - tilt / 8);
    if (k === 0) {
      halo.style.opacity = '0';
      return;
    }
    const H = cont.clientHeight;
    const h = H / 2 / Math.tan((map.getVerticalFieldOfView() * rad) / 2); // camera to map centre, px
    // globe radius, px: same as MapLibre's getGlobeRadiusPixels (latitude clamped to the Mercator limit)
    const R = (512 * 2 ** z) / (2 * Math.PI * Math.cos(Math.min(Math.abs(map.getCenter().lat), 85.051129) * rad));
    const p = map.getPitch() * rad;
    const D = Math.sqrt(R * R + h * h + 2 * R * h * Math.cos(p)); // camera to globe centre
    const r = h * Math.tan(Math.asin(Math.min(0.999, R / D))); // silhouette radius on screen
    // Anchor on where the camera's centre point actually lands on screen (robust to however the
    // projection applies camera padding), then shift for pitch: the globe's centre lies behind it.
    const c = map.project(map.getCenter());
    const cx = c.x;
    const cy = c.y + (h * R * Math.sin(p)) / (h + R * Math.cos(p));
    const half = r * HALO_SCALE;
    halo.style.width = halo.style.height = `${(2 * half).toFixed(1)}px`;
    halo.style.transform = `translate(${(cx - half).toFixed(1)}px, ${(cy - half).toFixed(1)}px)`;
    halo.style.opacity = k.toFixed(3);
  };
  map.on('move', update);
  map.on('resize', update);
  update();
}

function firstSymbolId(map: MlMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

/** Show exactly the given SAR image layers on a map (others removed), in the given draw order. */
function syncImageLayers(map: MlMap, wanted: { layer: SarLayer; opacity: number }[]) {
  const style = map.getStyle();
  if (!style) return;
  const wantIds = new Set(wanted.map((w) => `sar-${w.layer.id}`));
  // Only raster layers / image sources: the event marker layers (sar-halo, sar-points, ...) share the prefix.
  for (const l of style.layers) {
    if (l.type === 'raster' && l.id.startsWith('sar-') && !wantIds.has(l.id)) map.removeLayer(l.id);
  }
  for (const [id, src] of Object.entries(style.sources)) {
    if (src.type === 'image' && id.startsWith('sar-') && !wantIds.has(id)) map.removeSource(id);
  }
  // Above the satellite basemap and border lines, below coverage outlines and all labels.
  const beforeId = map.getLayer('coverage-fill') ? 'coverage-fill' : firstSymbolId(map);
  for (const { layer, opacity } of wanted) {
    const id = `sar-${layer.id}`;
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'image', url: layer.url, coordinates: layer.coordinates });
      map.addLayer(
        { id, type: 'raster', source: id, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear', 'raster-opacity': opacity } },
        beforeId
      );
    } else {
      map.setPaintProperty(id, 'raster-opacity', opacity);
      map.moveLayer(id, beforeId);
    }
  }
}

export interface TileOverlay {
  id: string;
  url: string; // XYZ template, {time} already substituted
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  opacity: number;
  attribution: string;
}

/**
 * The tile URL each overlay source was created with, per map. MapLibre only exposes a raster source's
 * `tiles` once the source has loaded, so comparing against the live source missed URL changes made right
 * after a layer was switched on (a new date kept the old date's tiles).
 */
const overlayUrls = new WeakMap<MlMap, Map<string, string>>();

/** Global catalog layers (GIBS, WorldCover, forest loss...): above the satellite basemap, below borders, NISAR imagery and labels. */
function syncTileOverlays(map: MlMap, wanted: TileOverlay[]) {
  const style = map.getStyle();
  if (!style) return;
  let urls = overlayUrls.get(map);
  if (!urls) overlayUrls.set(map, (urls = new Map()));
  const key = (o: TileOverlay) => `ov-${o.id}`;
  const want = new Map(wanted.map((o) => [key(o), o]));
  for (const l of style.layers) if (l.id.startsWith('ov-') && !want.has(l.id)) map.removeLayer(l.id);
  for (const id of Object.keys(style.sources)) {
    if (!id.startsWith('ov-')) continue;
    const o = want.get(id);
    // Switched off, or its URL changed (e.g. a new date): drop the layer and the source; re-added below.
    if (!o || urls.get(id) !== o.url) {
      if (map.getLayer(id)) map.removeLayer(id);
      map.removeSource(id);
      urls.delete(id);
    }
  }
  const beforeId = map.getLayer('road-major') ? 'road-major' : firstSymbolId(map);
  for (const [id, o] of want) {
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'raster', tiles: [o.url], tileSize: o.tileSize, minzoom: o.minzoom, maxzoom: o.maxzoom, attribution: o.attribution });
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': o.opacity, 'raster-fade-duration': 150 } }, beforeId);
      urls.set(id, o.url);
    } else {
      map.setPaintProperty(id, 'raster-opacity', o.opacity);
    }
  }
}

function addOverlays(map: MlMap) {
  map.addSource('coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const top = firstSymbolId(map);
  map.addLayer({ id: 'coverage-fill', type: 'fill', source: 'coverage', paint: { 'fill-color': '#6fb3ff', 'fill-opacity': 0.07 } }, top);
  map.addLayer({ id: 'coverage-line-casing', type: 'line', source: 'coverage', paint: { 'line-color': '#04070c', 'line-width': 2.6, 'line-opacity': 0.45 } }, top);
  map.addLayer({ id: 'coverage-line', type: 'line', source: 'coverage', paint: { 'line-color': '#8cc4ff', 'line-width': 1.2, 'line-opacity': 0.85 } }, top);
}

function addMarkers(map: MlMap) {
  map.addSource('ctx', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 38, clusterMaxZoom: 6 });
  map.addSource('sar', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const catColor: any = ['match', ['get', 'category'], ...Object.entries(CATEGORY_COLOR).flat(), '#9aa3ad'];
  // Everything gets a dark fill/outline so it reads on bright satellite imagery.
  map.addLayer({
    id: 'ctx-clusters', type: 'circle', source: 'ctx', filter: ['has', 'point_count'],
    paint: { 'circle-color': '#10141a', 'circle-opacity': 0.92, 'circle-stroke-color': '#c7ced6', 'circle-stroke-opacity': 0.75, 'circle-stroke-width': 1.25, 'circle-radius': ['step', ['get', 'point_count'], 11, 10, 14, 30, 18] },
  });
  map.addLayer({
    id: 'ctx-count', type: 'symbol', source: 'ctx', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11, 'text-font': FONT, 'text-allow-overlap': true },
    paint: { 'text-color': '#f1f3f5' },
  });
  map.addLayer({
    id: 'ctx-points', type: 'circle', source: 'ctx', filter: ['!', ['has', 'point_count']],
    paint: { 'circle-color': catColor, 'circle-opacity': 0.95, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.2, 6, 5], 'circle-stroke-color': '#05070a', 'circle-stroke-width': 1.5 },
  });
  map.addLayer({
    id: 'sar-halo-casing', type: 'circle', source: 'sar',
    paint: { 'circle-color': 'rgba(5, 7, 10, 0.35)', 'circle-stroke-color': '#05070a', 'circle-stroke-opacity': 0.8, 'circle-stroke-width': 4.5, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 9, 6, 13] },
  });
  map.addLayer({
    id: 'sar-halo', type: 'circle', source: 'sar',
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': catColor, 'circle-stroke-width': 2, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 9, 6, 13] },
  });
  map.addLayer({
    id: 'sar-points', type: 'circle', source: 'sar',
    paint: { 'circle-color': catColor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4.5, 6, 6], 'circle-stroke-color': '#05070a', 'circle-stroke-width': 1.5 },
  });
  map.addLayer({
    id: 'sar-labels', type: 'symbol', source: 'sar', minzoom: 2.2,
    layout: { 'text-field': ['get', 'title'], 'text-size': 12.5, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-font': FONT },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(4, 7, 12, 0.92)', 'text-halo-width': 1.8 },
  });
  // Ring around the reported event / probed point that the side panel is describing.
  map.addSource('focus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'focus-ring-casing', type: 'circle', source: 'focus',
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 13, 'circle-stroke-color': '#05070a', 'circle-stroke-opacity': 0.7, 'circle-stroke-width': 4.5 },
  });
  map.addLayer({
    id: 'focus-ring', type: 'circle', source: 'focus',
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 13, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  });
}

/** Static starfield behind the (transparent) globe canvases. */
function drawStars(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  let seed = 20261114; // deterministic so the sky does not reshuffle on resize
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = Math.round((w * h) / 1500);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const m = rnd() ** 4; // few bright, many faint
    const tint = rnd();
    g.globalAlpha = 0.25 + 0.75 * m;
    g.fillStyle = tint < 0.12 ? '#ffd9b8' : tint < 0.3 ? '#bcd4ff' : '#ffffff';
    g.beginPath();
    g.arc(x, y, 0.35 + 1.0 * m, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Radar-only style for the SAR lens map: dark ground, the SAR raster stack, thin borders and a few labels for orientation. */
function lensStyle(): StyleSpecification {
  const src = SAR_LENS_SOURCE;
  const urls = lensTileUrls(src);
  const keep = new Set(['boundary-country-casing', 'boundary-country', 'label-water', 'label-city', 'label-country']);
  return {
    ...STYLE,
    name: 'Global SAR lens',
    sources: {
      dem: STYLE.sources.dem,
      openmaptiles: STYLE.sources.openmaptiles,
      ...Object.fromEntries(
        urls.map((u) => [`lens-${u.id}`, { type: 'raster', tiles: [u.url], tileSize: u.tileSize, minzoom: u.minzoom, maxzoom: u.maxzoom, attribution: src.attribution }])
      ),
    },
    layers: [
      // Dark ground: where no pass happened the lens reads as 'no radar data', not as an error.
      { id: 'background', type: 'background', paint: { 'background-color': '#05080c' } },
      // bottom to top: underlay first, then the primary product, each oldest day first
      ...urls.map((u) => ({ id: `lens-${u.id}`, type: 'raster' as const, source: `lens-${u.id}`, paint: { ...LENS_RASTER_PAINT } })),
      ...STYLE.layers.filter((l) => keep.has(l.id)),
    ],
  };
}

const SPIN_MAX_MS = 30_000;
const BASE_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 1.5);
/** From this zoom the SAR lens renders only its square (see the lens effect); below it, a clipped full view. */
const LENS_WINDOW_MIN_ZOOM = 5;
/** A stacked lens day whose tiles failed this many times is treated as unavailable and removed. */
const LENS_DROP_AFTER = 3;
/** A tiled globe source that never delivered a tile raises the load-failure notice after this many errors. */
const TILE_FAILURES_BEFORE_NOTICE = 3;
const TILE_NOTICE_GRACE_MS = 5000;
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function MapView(p: MapViewProps) {
  const aEl = useRef<HTMLDivElement>(null);
  const bEl = useRef<HTMLDivElement>(null);
  const lensEl = useRef<HTMLDivElement>(null);
  const starsEl = useRef<HTMLCanvasElement>(null);
  const maps = useRef<{ a: MlMap; b: MlMap } | null>(null);
  const lensMap = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(0); // number of maps whose style has loaded
  const [lensReady, setLensReady] = useState(false);
  const cb = useRef(p);
  cb.current = p;

  const layoutClass = !p.selected || p.mode === 'overlay' ? 'single' : p.mode;
  // Map B is only kept in sync (and therefore only re-rendered) while it is on screen.
  const bActive = useRef(false);
  bActive.current = layoutClass !== 'single';
  const syncing = useRef(false);
  const spinning = useRef(true);
  const reduced = useRef(false);
  const prevSelected = useRef<string | null>(null);
  const lensOn = !!p.lens;
  /** Animation duration that collapses to an instant jump when the user asked for reduced motion. */
  const dur = (ms: number) => (reduced.current ? 0 : ms);

  // ---- starfield
  useEffect(() => {
    const c = starsEl.current;
    if (!c) return;
    drawStars(c);
    const onResize = () => drawStars(c);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ---- create the two camera-synced maps once
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.current = mq.matches;
    const a = makeMap(aEl.current!, () => reduced.current);
    const b = makeMap(bEl.current!, () => reduced.current);
    // Tile errors on the globe. Measured over all 19 satellite layers (14 Nov 2026): layers that loaded 100+
    // tiles still produced a few errors each: sporadic GIBS HTTP 500s and 404s for tiles outside a layer's
    // coverage (e.g. JRC surface water has no tiles near the poles). Alarming on those told users "data failed
    // to load" for layers that were working. So a tiled source raises the notice only when it has failed
    // repeatedly WITHOUT ever delivering a tile (a really broken layer); everything else is logged.
    // Non-tile failures (style, a NISAR investigation image) are always reported.
    for (const m of [a, b]) {
      const report = mapErrorReporter('globe', () => cb.current.onMapError);
      const policy = createTileErrorPolicy(TILE_FAILURES_BEFORE_NOTICE);
      // Keyed by source id AND its current tile URL: a satellite layer re-added for another date keeps its
      // id, and a date whose tiles all fail must not inherit "has delivered" from the date that worked.
      const keyOf = (src: string) => `${src}|${overlayUrls.get(m)?.get(src) ?? ''}`;
      m.on('data', (e: { dataType?: string; sourceId?: string; tile?: unknown }) => {
        if (e.dataType === 'source' && e.tile && e.sourceId) policy.delivered(keyOf(e.sourceId));
      });
      m.on('error', (e: { sourceId?: string; tile?: unknown; error?: { message?: string; status?: number } }) => {
        const src = e?.sourceId;
        if (!src || !e.tile) return report(e);
        const key = keyOf(src);
        const r = policy.failed(key);
        if (r.action === 'notify') {
          // GIBS returns bursts of one-off HTTP 500s; a layer's first tiles can fail before any good one
          // arrives. Give it a few seconds and notify only if still nothing has loaded for this layer + date.
          window.setTimeout(() => {
            if (!policy.hasDelivered(key) && keyOf(src) === key) report(e);
          }, TILE_NOTICE_GRACE_MS);
          return;
        }
        console.warn(`[map:globe] ${src} tile failed (${r.count})`, e?.error?.status ?? '', e?.error?.message ?? '');
      });
    }
    a.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-left');
    a.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    const sync = (src: MlMap, dst: MlMap) => () => {
      if (syncing.current || !bActive.current) return;
      syncing.current = true;
      dst.jumpTo({ center: src.getCenter(), zoom: src.getZoom(), bearing: src.getBearing(), pitch: src.getPitch() });
      syncing.current = false;
    };
    a.on('move', sync(a, b));
    b.on('move', sync(b, a));

    // While the camera moves, the secondary maps (B, SAR lens) drop to 1x device pixels; full sharpness returns at rest.
    let lowRes = false;
    let restoreTimer = 0;
    a.on('movestart', () => {
      window.clearTimeout(restoreTimer);
      if (lowRes || BASE_PIXEL_RATIO <= 1 || !(bActive.current || lensMap.current)) return;
      lowRes = true;
      if (bActive.current) b.setPixelRatio(1);
      lensMap.current?.setPixelRatio(1);
    });
    a.on('moveend', () => {
      if (!lowRes) return;
      window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => {
        lowRes = false;
        b.setPixelRatio(BASE_PIXEL_RATIO);
        lensMap.current?.setPixelRatio(BASE_PIXEL_RATIO);
      }, 180);
    });

    // 'style.load', not 'load': with satellite tiles streaming in, 'load' can take many seconds and the
    // markers must not wait for imagery.
    // On phones start with the attribution folded into its (i) button (MapLibre opens it once the first
    // source reports its attribution); the About panel carries the full credits.
    if (window.innerWidth <= 820) {
      const fold = () => {
        const attrib = aEl.current?.querySelector('.maplibregl-ctrl-attrib');
        if (!attrib?.classList.contains('maplibregl-compact-show')) return;
        attrib.classList.remove('maplibregl-compact-show');
        attrib.removeAttribute('open');
        a.off('sourcedata', fold);
      };
      a.on('sourcedata', fold);
    }
    a.once('style.load', () => {
      addOverlays(a);
      addMarkers(a);
      setReady((n) => n + 1);
    });
    b.once('style.load', () => {
      addOverlays(b);
      setReady((n) => n + 1);
    });

    // ---- slow idle rotation of the landing globe. Any interaction stops it for good, it stops by itself
    // after 30 s (an idle tab must not keep the GPU busy), and it never starts under reduced motion.
    let raf = 0;
    let last = 0;
    let started = 0;
    const stopSpin = () => {
      spinning.current = false;
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const tick = (t: number) => {
      raf = 0;
      if (!spinning.current) return; // stopped elsewhere (event opened, search fly-to): the loop ends here
      if (!started) started = t;
      if (t - started > SPIN_MAX_MS || cb.current.selected) return stopSpin();
      raf = requestAnimationFrame(tick);
      const dt = last ? Math.min(100, t - last) : 0;
      last = t;
      if (a.getZoom() > 3) return;
      const c = a.getCenter();
      a.jumpTo({ center: [c.lng - dt * 0.002, c.lat] }); // 2°/s, Earth turning eastwards
    };
    spinning.current = !mq.matches;
    if (spinning.current) raf = requestAnimationFrame(tick);
    const onMotionPref = (e: MediaQueryListEvent) => {
      reduced.current = e.matches;
      if (e.matches) {
        stopSpin();
        a.stop(); // end any fly animation in progress
      }
    };
    mq.addEventListener('change', onMotionPref);
    const stopEvents = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const;
    const containers = [aEl.current!, bEl.current!];
    for (const el of containers) for (const ev of stopEvents) el.addEventListener(ev, stopSpin, { passive: true, capture: true });

    const clickable = ['sar-points', 'sar-halo', 'ctx-points', 'ctx-clusters'];
    a.on('click', (e) => {
      const hits = a.queryRenderedFeatures(e.point, { layers: clickable.filter((id) => a.getLayer(id)) });
      const f = hits[0];
      if (!f) return cb.current.onMapClick(e.lngLat.lng, e.lngLat.lat);
      if (f.layer.id.startsWith('sar')) return cb.current.onSelectEvent(f.properties.id);
      if (f.layer.id === 'ctx-clusters') {
        (a.getSource('ctx') as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id).then((z) => {
          a.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: Math.min(z + 0.5, 9), duration: reduced.current ? 0 : 700 });
        });
        return;
      }
      // A reported / catalog event: its full record opens in the side panel.
      cb.current.onSelectContext(String(f.properties.id));
    });
    for (const id of clickable) {
      a.on('mouseenter', id, () => (a.getCanvas().style.cursor = 'pointer'));
      a.on('mouseleave', id, () => (a.getCanvas().style.cursor = ''));
    }
    maps.current = { a, b };
    // two canvases must not share the same accessible name (QA-21)
    a.getCanvas().setAttribute('aria-label', 'Globe: before view and event markers');
    b.getCanvas().setAttribute('aria-label', 'Globe: after view');
    if (import.meta.env.DEV) (window as any).__gsMaps = { a, b };
    return () => {
      stopSpin();
      window.clearTimeout(restoreTimer);
      mq.removeEventListener('change', onMotionPref);
      for (const el of containers) for (const ev of stopEvents) el.removeEventListener(ev, stopSpin, { capture: true });
      a.remove();
      b.remove();
      maps.current = null;
    };
  }, []);

  const loaded = ready >= 2;

  // ---- marker data: only when the data or the filters change. Opening or closing an investigation must not
  // re-serialize and re-cluster thousands of points (that is the visibility effect below).
  useEffect(() => {
    if (!loaded) return;
    const { a } = maps.current!;
    const sar: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: p.events
        .filter((e) => p.visibleCategories.has(e.category))
        .map((e) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.location.lon, e.location.lat] }, properties: { id: e.id, category: e.category, title: e.title } })),
    };
    const ctx: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: p.showContext
        ? p.context
            .filter((e) => p.visibleCategories.has(e.category))
            // The panel looks the full record up by id, so the map only carries what it draws.
            .map((e) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { id: e.id, category: e.category } }))
        : [],
    };
    (a.getSource('sar') as GeoJSONSource).setData(sar);
    (a.getSource('ctx') as GeoJSONSource).setData(ctx);
  }, [loaded, p.events, p.context, p.visibleCategories, p.showContext]);

  // ---- marker visibility: context markers and labels step back while an investigation is open
  const hasSelection = !!p.selected;
  useEffect(() => {
    if (!loaded) return;
    const { a } = maps.current!;
    const vis = hasSelection ? 'none' : 'visible';
    for (const id of ['ctx-clusters', 'ctx-count', 'ctx-points', 'sar-labels']) a.setLayoutProperty(id, 'visibility', vis);
  }, [loaded, hasSelection]);

  // ---- focus ring: the reported event or probed point the side panel is about
  useEffect(() => {
    if (!loaded) return;
    const src = maps.current!.a.getSource('focus') as GeoJSONSource;
    src.setData(p.focus ? { type: 'Feature', geometry: { type: 'Point', coordinates: [p.focus.lon, p.focus.lat] }, properties: {} } : EMPTY_FC);
  }, [loaded, p.focus]);

  // ---- global catalog tile layers (map B only while it is on screen)
  useEffect(() => {
    if (!loaded) return;
    const { a, b } = maps.current!;
    syncTileOverlays(a, p.tileOverlays ?? []);
    if (layoutClass !== 'single') syncTileOverlays(b, p.tileOverlays ?? []);
  }, [loaded, p.tileOverlays, layoutClass]);

  // ---- SAR imagery (raster layers, so they drape over the 3D terrain on both maps)
  useEffect(() => {
    if (!loaded) return;
    const { a, b } = maps.current!;
    const A: { layer: SarLayer; opacity: number }[] = [];
    const B: { layer: SarLayer; opacity: number }[] = [];
    if (p.before) A.push({ layer: p.before, opacity: 1 });
    if (p.mode === 'overlay') {
      if (p.after) A.push({ layer: p.after, opacity: p.overlayOpacity });
    } else if (p.after) B.push({ layer: p.after, opacity: 1 });
    syncImageLayers(a, A);
    syncImageLayers(b, B);
  }, [loaded, p.before, p.after, p.mode, p.overlayOpacity]);

  // Camera padding keeps the globe / target centred in the part of the map not covered by the side panel
  // (desktop) or the bottom sheet (phones). Side-by-side maps are half-size, so they get none.
  // The swipe divider and the lens square are pure CSS (variables on .app), so they need no effect here.
  const basePad =
    layoutClass === 'side'
      ? { top: 0, left: 0, right: 0, bottom: 0 }
      : p.panelInset.right > 0
        ? { top: 0, left: 0, right: p.panelInset.right, bottom: 0 }
        : { top: 0, left: 0, right: 0, bottom: Math.max(0, p.panelInset.bottom - 84) }; // sheet only, not the timeline
  const basePadRef = useRef(basePad);
  basePadRef.current = basePad;
  useEffect(() => {
    if (!maps.current) return;
    const { a, b } = maps.current;
    // Synchronous, so the fly-in effect below computes its fit against the right padding.
    syncing.current = true;
    a.setPadding(basePad);
    b.setPadding(basePad);
    syncing.current = false;
  }, [basePad.right, basePad.bottom]);
  useEffect(() => {
    if (!maps.current) return;
    const { a, b } = maps.current;
    requestAnimationFrame(() => {
      if (!maps.current) return;
      // Guarded: an echo from B back to A would jumpTo() on A and cancel the fly-in that starts at the same time.
      syncing.current = true;
      a.resize();
      if (bActive.current) {
        b.resize();
        b.jumpTo({ center: a.getCenter(), zoom: a.getZoom(), bearing: a.getBearing(), pitch: a.getPitch() });
      }
      lensMap.current?.resize();
      syncing.current = false;
    });
  }, [p.mode, p.selected]);

  // ---- cinematic camera: tilt into the selected event's imagery, ease back out to the globe on close
  useEffect(() => {
    if (!loaded) return;
    const { a } = maps.current!;
    if (p.selected) {
      spinning.current = false;
      const { lon, lat } = p.selected.location;
      a.fitBounds(layerBounds(p.selected.layers) ?? [[lon - 0.5, lat - 0.5], [lon + 0.5, lat + 0.5]], {
        // fitBounds padding is added to the camera padding set above
        padding: {
          top: 70,
          left: 30,
          right: p.panelInset.right - basePadRef.current.right + 30,
          bottom: p.panelInset.bottom - basePadRef.current.bottom + 30,
        },
        pitch: EVENT_PITCH,
        bearing: EVENT_BEARING,
        duration: dur(1800),
        curve: 1.5,
      });
    } else if (prevSelected.current) {
      const c = a.getCenter();
      a.flyTo({ center: [c.lng, Math.max(-30, Math.min(30, c.lat))], zoom: homeZoom(), pitch: 0, bearing: 0, duration: dur(1500), curve: 1.5 });
    }
    prevSelected.current = p.selected?.id ?? null;
  }, [loaded, p.selected?.id]);

  useEffect(() => {
    if (!loaded || !p.flyTo) return;
    const { a } = maps.current!;
    spinning.current = false;
    if (p.flyTo.bbox) {
      const [w, n, e, s] = p.flyTo.bbox;
      a.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 11, duration: dur(1200) });
    } else a.flyTo({ center: [p.flyTo.lon, p.flyTo.lat], zoom: p.flyTo.zoom ?? 8, duration: dur(1200) });
  }, [loaded, p.flyTo?.nonce]);

  // ---- NISAR coverage footprints (probe results; only ever shown on map A)
  useEffect(() => {
    if (!loaded) return;
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: (p.coverage?.granules ?? []).slice(0, 80).map((g) => ({ type: 'Feature', geometry: g.footprint, properties: { scene: g.scene } })),
    };
    (maps.current!.a.getSource('coverage') as GeoJSONSource).setData(fc);
  }, [loaded, p.coverage]);

  // ---- annotation pins (on both maps so they stay visible on both sides of the swipe)
  useEffect(() => {
    if (!loaded || !p.pins.length) return;
    const markers: maplibregl.Marker[] = [];
    const targets = layoutClass === 'single' ? [maps.current!.a] : [maps.current!.a, maps.current!.b];
    for (const m of targets) {
      p.pins.forEach((pin, i) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'pin';
        el.dataset.pinId = pin.id;
        if (m === maps.current!.b) el.tabIndex = -1; // one keyboard stop per pin (map A's copy)
        el.textContent = String(i + 1);
        el.title = pin.label;
        el.setAttribute('aria-label', `Annotation ${i + 1}: ${pin.label}`);
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          cb.current.onPin(pin.id);
        });
        markers.push(new maplibregl.Marker({ element: el }).setLngLat([pin.lon, pin.lat]).addTo(m));
      });
    }
    return () => markers.forEach((mk) => mk.remove());
  }, [loaded, p.pins, layoutClass]);

  // Active state is toggled in place, so activating a pin never destroys the focused button.
  useEffect(() => {
    document.querySelectorAll<HTMLElement>('.pin[data-pin-id]').forEach((el) => {
      const on = el.dataset.pinId === p.activePin;
      el.classList.toggle('active', on);
      el.setAttribute('aria-pressed', String(on));
    });
  }, [p.activePin, p.pins, layoutClass]);

  // ---- SAR lens: a third, non-interactive map that exists only while the lens is on. It mirrors map A's
  // camera (and terrain state) and is clipped to the square by CSS; see .map.lens in styles.css.
  useEffect(() => {
    if (!loaded || !lensOn || !lensEl.current) return;
    const { a } = maps.current!;
    spinning.current = false; // the reader is inspecting: a moving camera also throttles tile loading
    const lens = new maplibregl.Map({
      container: lensEl.current,
      style: lensStyle(),
      interactive: false,
      attributionControl: false, // credited in the lens label (the square would clip a map control)
      center: a.getCenter(),
      zoom: a.getZoom(),
      bearing: a.getBearing(),
      pitch: a.getPitch(),
      maxPitch: 75,
      maxZoom: MAX_ZOOM,
      fadeDuration: 0,
      pixelRatio: BASE_PIXEL_RATIO,
      refreshExpiredTiles: false,
      canvasContextAttributes: { powerPreference: 'high-performance', contextType: 'webgl2', antialias: false },
    });
    lens.getCanvas().setAttribute('aria-label', 'Globe: SAR lens view');
    // Lens tile errors. GIBS answers a day *without a pass* with a transparent 200 tile, but a day that is
    // *not published yet* answers 404 on every tile, and GIBS occasionally returns a one-off 500. Neither is
    // a reason to alarm the reader (measured 14 Nov 2026: all failures were the unpublished newest NISAR day
    // plus two isolated OPERA 500s). So: a stacked day whose tiles keep failing is dropped from the stack
    // (logged), isolated errors are logged only, and the visible notice appears only when no radar source is
    // left at all, which is the case where "no data" would otherwise be implied.
    const report = mapErrorReporter('lens', () => cb.current.onMapError);
    const lensFailures = new Map<string, number>();
    const delivered = new Set<string>(); // sources that have loaded at least one tile: never dropped
    const dropped = new Set<string>();
    lens.on('data', (e: { dataType?: string; sourceId?: string; tile?: unknown }) => {
      if (e.dataType === 'source' && e.tile && e.sourceId?.startsWith('lens-')) delivered.add(e.sourceId);
    });
    lens.on('error', (e: { sourceId?: string; error?: { message?: string; status?: number } }) => {
      const src = e?.sourceId;
      if (!src || !src.startsWith('lens-')) return report(e); // style / terrain / labels: report as usual
      const n = (lensFailures.get(src) ?? 0) + 1;
      lensFailures.set(src, n);
      console.warn(`[map:lens] ${src} tile failed (${n})`, e?.error?.status ?? '', e?.error?.message ?? '');
      // a day that has delivered tiles is real data with a few flaky tiles (GIBS sporadic 500s): keep it
      if (n < LENS_DROP_AFTER || dropped.has(src) || delivered.has(src)) return;
      dropped.add(src);
      console.warn(`[map:lens] ${src}: tiles keep failing (day not published yet or unavailable); dropped from the lens stack`);
      if (lens.getLayer(src)) lens.removeLayer(src);
      if (lens.getSource(src)) lens.removeSource(src);
      const left = Object.keys(lens.getStyle()?.sources ?? {}).filter((k) => k.startsWith('lens-') && !dropped.has(k));
      if (!left.length) cb.current.onMapError?.('lens', 'all SAR lens sources');
    });
    let styled = false;
    // Two ways to show the lens:
    //  - 'clip':   a full-viewport map with the same camera as map A, clipped to the square by CSS. Exact at
    //              globe scale (same perspective as the globe underneath); used full screen and below z5,
    //              where the whole planet is only a few tiles per source anyway.
    //  - 'window': the lens map is only as big as the square and looks at the point under its centre. At
    //              regional zoom the perspective difference is negligible, and it requests ~1/30 of the tiles
    //              (12 raster sources over a 320 px square instead of over the whole window).
    const el = lensEl.current;
    const root = el.closest('.app') as HTMLElement | null;
    let mode: 'clip' | 'window' = 'clip';
    let lastSize = -1;
    let raf = 0;
    const geom = () => {
      const cs = getComputedStyle(root ?? document.documentElement);
      return { x: parseFloat(cs.getPropertyValue('--lens-x')), y: parseFloat(cs.getPropertyValue('--lens-y')), s: parseFloat(cs.getPropertyValue('--lens-s')) };
    };
    const apply = () => {
      raf = 0;
      const z = a.getZoom();
      const g = geom();
      const full = !!root?.classList.contains('lens-full');
      const windowed = !full && z >= LENS_WINDOW_MIN_ZOOM && [g.x, g.y, g.s].every(Number.isFinite) && g.s > 0;
      if (windowed) {
        el.style.cssText = `left:${g.x}px;top:${g.y}px;width:${g.s}px;height:${g.s}px;right:auto;bottom:auto;clip-path:none`;
        if (mode !== 'window' || g.s !== lastSize) lens.resize();
        mode = 'window';
        lastSize = g.s;
        const c = a.unproject([g.x + g.s / 2, g.y + g.s / 2]);
        lens.jumpTo({ center: c, zoom: z, bearing: a.getBearing(), pitch: a.getPitch(), padding: { top: 0, right: 0, bottom: 0, left: 0 } });
      } else {
        if (mode !== 'clip') {
          el.style.cssText = '';
          lens.resize();
          mode = 'clip';
          lastSize = -1;
        }
        lens.jumpTo({ center: a.getCenter(), zoom: z, bearing: a.getBearing(), pitch: a.getPitch(), padding: a.getPadding() });
      }
      if (!styled) return;
      const terrainOn = !!a.getTerrain();
      if (terrainOn !== !!lens.getTerrain()) lens.setTerrain(terrainOn ? TERRAIN : null);
    };
    // at most one camera sync per animation frame (map A fires 'move' many times per frame while flying)
    const sync = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    // dragging / resizing the lens or toggling full screen changes only CSS variables / a class on the root
    const mo = new MutationObserver(sync);
    if (root) mo.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
    lens.once('style.load', () => {
      lens.setProjection({ type: 'globe' });
      styled = true;
      apply();
      setLensReady(true);
    });
    a.on('move', sync);
    a.on('moveend', sync);
    lensMap.current = lens;
    apply();
    if (import.meta.env.DEV && (window as any).__gsMaps) (window as any).__gsMaps.lens = lens;
    return () => {
      a.off('move', sync);
      a.off('moveend', sync);
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
      el.style.cssText = '';
      lensMap.current = null;
      if (import.meta.env.DEV && (window as any).__gsMaps) delete (window as any).__gsMaps.lens;
      setLensReady(false);
      lens.remove();
    };
  }, [loaded, lensOn]);

  // ---- the investigation's NISAR layer inside the lens (drawn over the Sentinel-1 base)
  const lensNisar = p.lens?.nisar ?? null;
  useEffect(() => {
    if (!lensReady || !lensMap.current) return;
    syncImageLayers(lensMap.current, lensNisar ? [{ layer: lensNisar, opacity: 1 }] : []);
  }, [lensReady, lensNisar]);

  return (
    <main className={`maps ${layoutClass}`} aria-label="Interactive globe">
      <canvas ref={starsEl} className="starfield" aria-hidden="true" />
      <div ref={aEl} className="map a" />
      <div ref={bEl} className="map b" aria-hidden={layoutClass === 'single'} />
      {lensOn && <div ref={lensEl} className="map lens" aria-hidden="true" data-ready={lensReady} />}
    </main>
  );
}

export default memo(MapView);

