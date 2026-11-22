import type { Map as MlMap } from 'maplibre-gl';
import { CATEGORY_COLOR } from '../lib';
import { FONT } from './style';

export function addMarkers(map: MlMap) {
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
  // The box the visitor draws with Inspect area (and the one being dragged).
  map.addSource('inspect', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'inspect-fill', type: 'fill', source: 'inspect', paint: { 'fill-color': '#6cc4ff', 'fill-opacity': 0.14 } });
  map.addLayer({
    id: 'inspect-line', type: 'line', source: 'inspect',
    paint: { 'line-color': '#6cc4ff', 'line-width': 2, 'line-dasharray': [2, 1.5] },
  });
}

/** Severity colours for Simulation Lab zones (0 mild .. 3 extreme). */
export const SIM_COLORS = ['#f2d16b', '#f29b4b', '#e8603c', '#c2253a'] as const;

/** Planetary Simulation Lab: zones growing to their front (fill), the model's final extent (dashed) and ground zero. */
export function addSimLayers(map: MlMap) {
  const fc = { type: 'FeatureCollection' as const, features: [] };
  const sev: any = ['match', ['get', 'severity'], 0, SIM_COLORS[0], 1, SIM_COLORS[1], 2, SIM_COLORS[2], SIM_COLORS[3]];
  map.addSource('sim-zones', { type: 'geojson', data: fc });
  map.addSource('sim-extent', { type: 'geojson', data: fc });
  map.addSource('sim-compare', { type: 'geojson', data: fc });
  map.addSource('sim-point', { type: 'geojson', data: fc });
  map.addLayer({ id: 'sim-zone-fill', type: 'fill', source: 'sim-zones', paint: { 'fill-color': sev, 'fill-opacity': 0.16 } });
  map.addLayer({ id: 'sim-zone-line', type: 'line', source: 'sim-zones', paint: { 'line-color': sev, 'line-width': 2 } });
  map.addLayer({ id: 'sim-extent-line', type: 'line', source: 'sim-extent', paint: { 'line-color': sev, 'line-width': 1.2, 'line-opacity': 0.75, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'sim-compare-line', type: 'line', source: 'sim-compare', paint: { 'line-color': '#b9c4d0', 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [1, 2] } });
  map.addLayer({
    id: 'sim-extent-label', type: 'symbol', source: 'sim-extent',
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 11, 'text-max-angle': 30, 'symbol-spacing': 400 },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#05070a', 'text-halo-width': 1.5 },
  });
  map.addLayer({ id: 'sim-point', type: 'circle', source: 'sim-point', paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': SIM_COLORS[3], 'circle-stroke-width': 3 } });
}
