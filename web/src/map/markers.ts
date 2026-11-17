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
