import type { LayerSpecification, Map as MlMap, SourceSpecification } from 'maplibre-gl';
import type { SarLayer } from '../types';

export function firstSymbolId(map: MlMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

/**
 * What each SAR image source was created with (picture URL + corner coordinates), per map. Layer ids are
 * only unique within one investigation ("hv_change" exists in two), so the id alone does not say which
 * picture a source holds: going straight from one investigation's layer to the other's (browser Back)
 * kept the first picture in its old place and never drew the second.
 */
const imageContent = new WeakMap<MlMap, Map<string, string>>();
const imageSignature = (layer: SarLayer) => `${layer.url}|${JSON.stringify(layer.coordinates)}`;

/** Show exactly the given SAR image layers on a map (others removed), in the given draw order. */
export function syncImageLayers(map: MlMap, wanted: { layer: SarLayer; opacity: number }[]) {
  const style = map.getStyle();
  if (!style) return;
  let known = imageContent.get(map);
  if (!known) imageContent.set(map, (known = new Map()));
  const content = known;
  const want = new Map(wanted.map((w) => [`sar-${w.layer.id}`, imageSignature(w.layer)]));
  // Unwanted, or the same id now stands for another picture / place: removed here, the latter re-added below.
  const stale = (id: string) => !want.has(id) || (content.has(id) && content.get(id) !== want.get(id));
  // Only raster layers / image sources: the event marker layers (sar-halo, sar-points, ...) share the prefix.
  for (const l of style.layers) {
    if (l.type === 'raster' && l.id.startsWith('sar-') && stale(l.id)) map.removeLayer(l.id);
  }
  for (const [id, src] of Object.entries(style.sources)) {
    if (src.type === 'image' && id.startsWith('sar-') && stale(id)) {
      map.removeSource(id);
      content.delete(id);
    }
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
      content.set(id, imageSignature(layer));
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

/** The answers that mean "this day does not exist at the service", as opposed to a failure. */
const noSuchDay = (status: number | undefined) => status === 404 || status === 410;

/**
 * When is a stacked SAR lens day taken off the stack, and when does it come back?
 *
 * A day whose tiles keep failing without ever delivering one is dropped, so a broken day does not keep
 * hammering the server. The lens tiles come through map/lensTiles.ts, which has already asked again after a
 * server / network error and passes the real HTTP status on; MapLibre raises no error event for a status-404
 * tile (day not published; MapView asks the loader about those), so what arrives here is a failure that
 * outlasted the retries, or another 4xx. So:
 *  - reaching the threshold only ARMS the drop; the caller waits a grace period and asks graceElapsed(),
 *    which says no if a tile arrived meanwhile;
 *  - a drop is reported (notify), so a missing radar day never passes for "no radar pass", unless the answer
 *    itself says "no such day" (404 / 410). Any other answer (5xx, network, 403, 429 ...) is a failure;
 *  - retry() hands back the sources dropped after a failure, with their count reset; the caller re-adds them
 *    (camera at rest, browser back online). A day dropped on 404 / 410 stays off the stack (until the lens is
 *    opened again): asking again after every camera stop would only repeat the same answer.
 * Limit: during a lasting outage every camera stop asks the dropped days again (see lensTiles.ts for the cost).
 */
export function createLensDropPolicy(dropAfter = 3) {
  const delivered = new Set<string>();
  const failures = new Map<string, number>();
  const lastStatus = new Map<string, number | undefined>();
  const dropped = new Set<string>();
  return {
    delivered(src: string) {
      delivered.add(src);
    },
    /** Count one failure. 'arm' is returned once per attempt, when the threshold is reached. */
    failed(src: string, status?: number): { action: 'log' | 'arm'; count: number } {
      const count = (failures.get(src) ?? 0) + 1;
      failures.set(src, count);
      lastStatus.set(src, status);
      return { action: count === dropAfter && !delivered.has(src) && !dropped.has(src) ? 'arm' : 'log', count };
    },
    /** The grace period after 'arm' is over: drop the source now? And must the reader be told? */
    graceElapsed(src: string): { drop: boolean; notify: boolean } {
      if (delivered.has(src) || dropped.has(src)) return { drop: false, notify: false };
      dropped.add(src);
      return { drop: true, notify: !noSuchDay(lastStatus.get(src)) };
    },
    dropped: () => [...dropped],
    /** The sources dropped after a failure (not "no such day"), to be re-added by the caller; each starts again with a clean record. */
    retry(): string[] {
      const again = [...dropped].filter((src) => !noSuchDay(lastStatus.get(src)));
      for (const src of again) {
        failures.delete(src);
        lastStatus.delete(src);
        dropped.delete(src);
      }
      return again;
    },
  };
}

export interface DetachedLayer {
  id: string;
  source: SourceSpecification;
  layer: LayerSpecification;
}

/** Remove a layer and its same-named source, keeping what is needed to put them back (see reattachLayer). */
export function detachLayer(map: MlMap, id: string): DetachedLayer | null {
  const style = map.getStyle();
  const layer = style?.layers.find((l) => l.id === id);
  const source = style?.sources[id];
  if (!layer || !source) return null;
  map.removeLayer(id);
  map.removeSource(id);
  return { id, source, layer };
}

/**
 * Put a detached layer back at its place in `order` (the map's layer ids before anything was detached):
 * under the nearest layer that followed it and is on the map now.
 */
export function reattachLayer(map: MlMap, d: DetachedLayer, order: string[]) {
  if (map.getLayer(d.id)) return;
  if (!map.getSource(d.id)) map.addSource(d.id, d.source);
  const at = order.indexOf(d.id);
  const before = at < 0 ? undefined : order.slice(at + 1).find((x) => map.getLayer(x));
  map.addLayer(d.layer, before);
}

/**
 * Load a picture as an object URL and hand it to `use`, unless the lease was released meanwhile.
 * Returns the release function: it cancels the load and revokes the URL. A URL that arrives after the release
 * (decoding and encoding do not observe the abort signal) is revoked on arrival, so no blob outlives its use.
 */
export function leaseObjectUrl(
  load: (signal: AbortSignal) => Promise<string>,
  use: (url: string) => void,
  fail: (e: unknown) => void
): () => void {
  const ctl = new AbortController();
  let objectUrl: string | null = null;
  load(ctl.signal)
    .then((u) => {
      if (ctl.signal.aborted) return URL.revokeObjectURL(u);
      objectUrl = u;
      use(u);
    })
    .catch((e: unknown) => {
      if (!ctl.signal.aborted) fail(e);
    });
  return () => {
    ctl.abort();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };
}

export function addOverlays(map: MlMap) {
  map.addSource('coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const top = firstSymbolId(map);
  map.addLayer({ id: 'coverage-fill', type: 'fill', source: 'coverage', paint: { 'fill-color': '#6fb3ff', 'fill-opacity': 0.04 } }, top);
  map.addLayer({ id: 'coverage-line-casing', type: 'line', source: 'coverage', paint: { 'line-color': '#04070c', 'line-width': 2.6, 'line-opacity': 0.45 } }, top);
  map.addLayer({ id: 'coverage-line', type: 'line', source: 'coverage', paint: { 'line-color': '#8cc4ff', 'line-width': 1.2, 'line-opacity': 0.85 } }, top);
}
