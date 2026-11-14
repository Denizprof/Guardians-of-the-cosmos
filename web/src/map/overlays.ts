import type { Map as MlMap } from 'maplibre-gl';
import type { SarLayer } from '../types';

export function firstSymbolId(map: MlMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

/** Show exactly the given SAR image layers on a map (others removed), in the given draw order. */
export function syncImageLayers(map: MlMap, wanted: { layer: SarLayer; opacity: number }[]) {
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
export const overlayUrls = new WeakMap<MlMap, Map<string, string>>();

/** Global catalog layers (GIBS, WorldCover, forest loss...): above the satellite basemap, below borders, NISAR imagery and labels. */
export function syncTileOverlays(map: MlMap, wanted: TileOverlay[]) {
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

export function addOverlays(map: MlMap) {
  map.addSource('coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const top = firstSymbolId(map);
  map.addLayer({ id: 'coverage-fill', type: 'fill', source: 'coverage', paint: { 'fill-color': '#6fb3ff', 'fill-opacity': 0.04 } }, top);
  map.addLayer({ id: 'coverage-line-casing', type: 'line', source: 'coverage', paint: { 'line-color': '#04070c', 'line-width': 2.6, 'line-opacity': 0.45 } }, top);
  map.addLayer({ id: 'coverage-line', type: 'line', source: 'coverage', paint: { 'line-color': '#8cc4ff', 'line-width': 1.2, 'line-opacity': 0.85 } }, top);
}
