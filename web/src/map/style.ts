import type { StyleSpecification } from 'maplibre-gl';
import { LENS_RASTER_PAINT, SAR_LENS_SOURCE, lensTileUrls } from './sarLens';

// ---------------------------------------------------------------------------------------------
// "Google Earth" style: photoreal satellite globe + 3D terrain + thin borders and labels on top.
// All sources are free and key-less; see the attribution strings (also credited in IntroPanel).
// ---------------------------------------------------------------------------------------------
export const HOME_CENTER: [number, number] = [15, 12];
/** Whole-globe zoom that fills the view without clipping the limb (phones are narrower). */
export const homeZoom = () => (window.innerWidth <= 820 ? 1.2 : 2);
export const EVENT_PITCH = 45;
export const EVENT_BEARING = -14;
export const TERRAIN = { source: 'dem', exaggeration: 1.4 };
/** Terrain is only switched on when close enough to see relief (keeps the whole-globe view light). */
export const TERRAIN_ON_ZOOM = 6.5;
export const TERRAIN_OFF_ZOOM = 5.5;
/** Sentinel-2 (10 m) ends near z14; the Esri close-up imagery layered over it is sharp to z19. */
export const MAX_ZOOM = 19;

// Turkey is shown under its official name, Türkiye (the tiles carry the English exonym 'Turkey').
const NAME: any = ['match', ['get', 'name_en'], 'Turkey', 'Türkiye', ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']]];
const IS_POINT: any = ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false];
const LABEL_PAINT = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(4, 7, 12, 0.85)', 'text-halo-width': 1.4, 'text-halo-blur': 0.4 };
export const FONT = ['Noto Sans Regular'];

export const STYLE: StyleSpecification = {
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
    // Close-up photo imagery (sub-metre in cities), faded in once Sentinel-2's 10 m pixels run out (~z13).
    'satellite-hires': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      minzoom: 10,
      maxzoom: 19,
      attribution:
        'Close-up imagery: <a href="https://www.esri.com" target="_blank" rel="noopener">Esri, Maxar, Earthstar Geographics and the GIS User Community</a>',
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
      id: 'satellite-hires', type: 'raster', source: 'satellite-hires', minzoom: 12.5,
      paint: { 'raster-fade-duration': 150, 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 14, 1] },
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

/** Radar-only style for the SAR lens map: dark ground, the SAR raster stack, thin borders and a few labels for orientation. */
export function lensStyle(): StyleSpecification {
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
