import { boxRing, DRAG_MIN_PX, normalizeBox, pointBox, type Box } from '../inspect';
import { memo, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Category, CompareMode, ContextEvent, SarEvent, SarLayer } from '../types';
import { layerBounds } from '../lib';
import type { CoverageResult } from '../services';
import type { Pin } from '../content/explain';
import { registerNodataProtocol } from './nodataKey';
import { registerCropProtocol } from './cropTiles';
import { lensDayUnpublished, onLensDayUnpublished, registerLensTileProtocol } from './lensTiles';
import { createTileErrorPolicy } from './tileErrors';
import { browseBounds, coverageFeatures, trimmedBrowseUrl } from './coverageSelect';
import {
  EVENT_BEARING, EVENT_PITCH, HOME_CENTER, MAX_ZOOM, STYLE, TERRAIN, TERRAIN_OFF_ZOOM, TERRAIN_ON_ZOOM, homeZoom, lensStyle, zoomCeiling,
} from './style';
import { mapNameExpression, onLangChange } from '../i18n';
import { attachHalo } from './halo';
import { registerHires } from './hires';
import { attachSatellite } from './satellite';
import { isLite, mapPixelRatio } from '../app/perf';
import {
  addOverlays, createLensDropPolicy, detachLayer, leaseObjectUrl, overlayUrls, reattachLayer, syncImageLayers, syncTileOverlays,
} from './overlays';
import type { DetachedLayer, TileOverlay } from './overlays';
import { addMarkers } from './markers';
import { drawStars } from './starfield';

export type { TileOverlay };

// Untouched worker copy served from public/vendor (see vite.config.ts).
maplibregl.setWorkerUrl(new URL('vendor/maplibre-gl-worker.mjs', document.baseURI).href);
// JPEG satellite layers with black no-data (VIIRS true colour etc.) are keyed to transparent; see nodataKey.ts
registerNodataProtocol(maplibregl as unknown as Parameters<typeof registerNodataProtocol>[0]);
// the farmland and crop-type layer is four WorldCereal maps stacked into one tile; see cropTiles.ts
registerCropProtocol(maplibregl as unknown as Parameters<typeof registerCropProtocol>[0]);
// SAR lens radar tiles: a one-off server error is asked for again, and failures keep their HTTP status; see lensTiles.ts
registerLensTileProtocol(maplibregl as unknown as Parameters<typeof registerLensTileProtocol>[0]);
// Up to three maps (A, B, SAR lens) share one image queue; the lens alone stacks twelve raster sources (two products x six days).
maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS = 32;
maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME = 16;

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
  /** Coverage probe: the one product drawn on the map (footprint + browse picture); null = nothing drawn. */
  coverageScene?: string | null;
  pins: Pin[];
  activePin: string | null;
  panelInset: { right: number; bottom: number };
  onSelectEvent: (id: string) => void;
  /** A reported / catalog marker was clicked (id of the ContextEvent). */
  onSelectContext: (id: string) => void;
  onMapClick: (lon: number, lat: number) => void;
  /** Coverage probe on: every click on the globe is a probe, also on a marker or a cluster. */
  probing?: boolean;
  /** Inspect area on: a drag draws a box (a click inspects a small square round it); the box is reported once. */
  inspecting?: boolean;
  /** 3D buildings layer on (default) or off. */
  buildings?: boolean;
  onInspectBox?: (box: Box) => void;
  /** The box the side panel is describing: drawn on the globe. */
  inspectBox?: Box | null;
  onPin: (id: string) => void;
  flyTo: { lon: number; lat: number; zoom?: number; bbox?: [number, number, number, number]; nonce: number } | null;
  tileOverlays?: TileOverlay[];
  /** The point the side panel is about (reported event or coverage probe): drawn as a ring. */
  focus: { lon: number; lat: number } | null;
  /** SAR lens: null = off. `nisar` is the investigation layer to draw over the SAR basemap, if any. */
  lens: { nisar: SarLayer | null } | null;
  /** The assistant's satellite (map/satellite.ts) was clicked. */
  onAskAssistant?: () => void;
  /** A source failed to load (tiles, NISAR image, style). Failures must be visible, never read as "no data". */
  onMapError?: (where: 'globe' | 'lens', source: string) => void;
  /** The camera settled: where the globe is looking. The assistant uses it to answer "what am I viewing?". */
  onViewChange?: (view: { center: [number, number]; zoom: number; bbox: [number, number, number, number] }) => void;
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
  if (!map.getSource('dem') || isLite()) return; // lite mode: no 3D terrain (the costliest effect)
  const z = map.getZoom();
  const on = !!map.getTerrain();
  if (!on && z >= TERRAIN_ON_ZOOM) map.setTerrain(TERRAIN);
  else if (on && z < TERRAIN_OFF_ZOOM) map.setTerrain(null);
}

/** Keep the map's place labels in the chosen language (Turkish names where the tiles carry them). */
function bindLabelLanguage(map: MlMap) {
  const apply = () => {
    let layers;
    try {
      layers = map.getStyle()?.layers;
    } catch {
      return; // style not parsed yet: 'style.load' calls again
    }
    const expr = mapNameExpression() as maplibregl.ExpressionSpecification;
    for (const l of layers ?? []) {
      if (l.type === 'symbol' && l.id.startsWith('label-')) map.setLayoutProperty(l.id, 'text-field', expr);
    }
  };
  map.on('style.load', apply);
  const off = onLangChange(apply);
  map.once('remove', off);
}

function makeMap(container: HTMLElement, reducedMotion: () => boolean): MlMap {
  registerHires();
  const map = new maplibregl.Map({
    container,
    style: STYLE,
    center: HOME_CENTER,
    zoom: homeZoom(),
    attributionControl: { compact: true },
    maxPitch: 75,
    fadeDuration: 0,
    // Two terrain-enabled maps at 3x device pixels is too heavy for phones.
    pixelRatio: mapPixelRatio(),
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
  map.on('style.load', () => {
    map.setProjection({ type: 'globe' });
    if (isLite()) map.setSky({ 'atmosphere-blend': 0, 'fog-ground-blend': 0, 'horizon-fog-blend': 0 });
  });
  bindLabelLanguage(map);
  map.on('zoom', () => syncTerrain(map));
  map.on('moveend', () => syncTerrain(map));
  // Like Google Earth: when the user zooms back out to globe scale, level the camera so the
  // whole globe (and its atmosphere) is seen straight on.
  map.on('zoomend', (e) => {
    if (!(e as any).originalEvent) return; // only react to the user's own zooming, not fly-ins
    if (map.getZoom() < 4.5 && map.getPitch() > 1) map.easeTo({ pitch: 0, duration: reducedMotion() ? 0 : 600 });
  });
  if (!isLite()) attachHalo(map);
  return map;
}

const SPIN_MAX_MS = 30_000;
const BASE_PIXEL_RATIO = mapPixelRatio();
/** From this zoom the SAR lens renders only its square (see the lens effect); below it, a clipped full view. */
const LENS_WINDOW_MIN_ZOOM = 5;
/** A stacked lens day whose tiles failed this many times without delivering one is taken off the stack (retried later). */
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
  // The probe was switched on with the mouse already over a marker: drop the pointer that marker had set.
  useEffect(() => {
    if (p.probing) maps.current?.a.getCanvas().style.removeProperty('cursor');
  }, [p.probing]);

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
    const reportView = () => {
      const c = a.getCenter();
      const bounds = a.getBounds();
      cb.current.onViewChange?.({ center: [c.lng, c.lat], zoom: a.getZoom(), bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] });
    };
    a.on('moveend', reportView);
    a.once('load', reportView);
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
    // Closest view: the scale bar never reads less than 50 m, at any latitude. zoomCeiling() is always a
    // value setMaxZoom() accepts: a throw here, in a 'moveend' fired from a React effect, stopped the whole app.
    const limitZoom = () => a.setMaxZoom(zoomCeiling(a.getCenter().lat, a.getMinZoom()));
    a.on('moveend', limitZoom);
    limitZoom();
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
    // Start with the attribution folded into its (i) button on every screen size (MapLibre opens it once
    // the first source reports its attribution); the About panel carries the full credits.
    {
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
    // A position in the space round the globe is not on the map: MapLibre still reports a location for it (and
    // can hit markers on the far side), so the point is projected back and must land where the pointer is.
    // Not checked under 3D terrain, which is only on when zoomed in, where the globe fills the view.
    const onGlobe = (e: { point: { x: number; y: number }; lngLat: maplibregl.LngLat }) => {
      if (a.getTerrain()) return true;
      const back = a.project(e.lngLat);
      return Math.hypot(back.x - e.point.x, back.y - e.point.y) <= 3;
    };
    a.on('click', (e) => {
      if (!onGlobe(e)) return;
      if (cb.current.inspecting) return; // the drag handlers below own the gesture
      // Coverage probe on: the click is a probe wherever it lands, markers and clusters included.
      if (cb.current.probing) return cb.current.onMapClick(e.lngLat.lng, e.lngLat.lat);
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
    // Inspect area: press, drag, release. Map dragging is suppressed for the gesture (preventDefault on the press).
    let inspectStart: { lon: number; lat: number; x: number; y: number } | null = null;
    const setInspect = (box: Box | null) => {
      const src = a.getSource('inspect') as GeoJSONSource | undefined;
      src?.setData(box ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: [boxRing(box)] }, properties: {} } : EMPTY_FC);
    };
    const onPress = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!cb.current.inspecting || !onGlobe(e)) return;
      e.preventDefault();
      inspectStart = { lon: e.lngLat.lng, lat: e.lngLat.lat, x: e.point.x, y: e.point.y };
    };
    const onDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!inspectStart) return;
      setInspect(normalizeBox(inspectStart, { lon: e.lngLat.lng, lat: e.lngLat.lat }));
    };
    const onRelease = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      const start = inspectStart;
      inspectStart = null;
      if (!start) return;
      const moved = Math.hypot(e.point.x - start.x, e.point.y - start.y);
      const box = moved < DRAG_MIN_PX ? pointBox(start.lon, start.lat) : normalizeBox(start, { lon: e.lngLat.lng, lat: e.lngLat.lat });
      setInspect(box);
      cb.current.onInspectBox?.(box);
    };
    a.on('mousedown', onPress);
    a.on('touchstart', onPress);
    a.on('mousemove', onDrag);
    a.on('touchmove', onDrag);
    a.on('mouseup', onRelease);
    a.on('touchend', onRelease);
    for (const id of clickable) {
      // The pointer cursor only where a click opens the marker: not while probing (a click there is a probe, the
      // probe's crosshair stays) and not over a far-side marker in the space round the globe (a click there does
      // nothing). On every move, not only on entering, because the hit area of a hidden marker can touch a visible one.
      a.on('mousemove', id, (e) => {
        a.getCanvas().style.cursor = !cb.current.probing && onGlobe(e) ? 'pointer' : '';
      });
      a.on('mouseleave', id, () => (a.getCanvas().style.cursor = ''));
    }
    maps.current = { a, b };
    // the assistant's mascot, circling the globe; it stays still in lite mode and for people who asked for less motion
    const removeSatellite = attachSatellite(a, aEl.current!.parentElement!, { onAsk: () => cb.current.onAskAssistant?.(), still: () => reduced.current || isLite() });
    // two canvases must not share the same accessible name (QA-21)
    a.getCanvas().setAttribute('aria-label', 'Globe: before view and event markers');
    b.getCanvas().setAttribute('aria-label', 'Globe: after view');
    if (import.meta.env.DEV) (window as any).__gsMaps = { a, b };
    return () => {
      stopSpin();
      window.clearTimeout(restoreTimer);
      mq.removeEventListener('change', onMotionPref);
      for (const el of containers) for (const ev of stopEvents) el.removeEventListener(ev, stopSpin, { capture: true });
      removeSatellite();
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

  // ---- 3D buildings on/off
  useEffect(() => {
    if (!loaded) return;
    const { a, b } = maps.current!;
    for (const m of [a, b]) if (m.getLayer('buildings-3d')) m.setLayoutProperty('buildings-3d', 'visibility', p.buildings === false ? 'none' : 'visible');
  }, [loaded, p.buildings]);

  // ---- Inspect area: the box the side panel is about, and a crosshair while the tool is on
  useEffect(() => {
    if (!loaded) return;
    const a = maps.current!.a;
    const src = a.getSource('inspect') as GeoJSONSource | undefined;
    src?.setData(p.inspectBox ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: [boxRing(p.inspectBox)] }, properties: {} } : EMPTY_FC);
  }, [loaded, p.inspectBox]);
  useEffect(() => {
    const canvas = maps.current?.a.getCanvas();
    if (!canvas) return;
    if (p.inspecting) canvas.style.cursor = 'crosshair';
    else canvas.style.removeProperty('cursor');
  }, [p.inspecting]);

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
      // one product at a time: drawing every footprint stacked into an opaque blob (see coverageSelect.ts)
      features: coverageFeatures(p.coverage?.granules ?? [], p.coverageScene ?? null),
    };
    const a = maps.current!.a;
    (a.getSource('coverage') as GeoJSONSource).setData(fc);
    // the selected product's NASA browse picture, under its outline
    const g = p.coverage?.granules.find((x) => x.scene === p.coverageScene);
    const coords = g?.browse ? browseBounds(g.footprint) : null;
    const clear = () => {
      if (a.getLayer('coverage-browse')) a.removeLayer('coverage-browse');
      if (a.getSource('coverage-browse')) a.removeSource('coverage-browse');
    };
    clear();
    if (!g?.browse || !coords) return;
    // The picture has transparent margins: trim them so the data fills the footprint's bounding box.
    const browse = g.browse;
    // leaseObjectUrl also revokes a picture that finishes decoding after the selection has moved on
    const release = leaseObjectUrl(
      (signal) => trimmedBrowseUrl(browse, signal),
      (u) => {
        clear();
        a.addSource('coverage-browse', { type: 'image', url: u, coordinates: coords });
        a.addLayer({ id: 'coverage-browse', type: 'raster', source: 'coverage-browse', paint: { 'raster-opacity': 0.92, 'raster-fade-duration': 0 } }, 'coverage-fill');
      },
      (e) => {
        // the outline still shows; say that the picture did not load instead of leaving a silent gap
        console.warn('[map:globe] coverage browse picture failed', e instanceof Error ? e.message : e);
        cb.current.onMapError?.('globe', 'coverage-browse');
      }
    );
    return () => {
      clear();
      release();
    };
  }, [loaded, p.coverage, p.coverageScene]);

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
    bindLabelLanguage(lens);
    lens.getCanvas().setAttribute('aria-label', 'Globe: SAR lens view');
    // Lens tile errors. GIBS answers a day *without a pass* with a transparent 200 tile, but a day that is
    // *not published yet* fails on every tile, and GIBS occasionally returns a one-off 500 (measured
    // 14 Nov 2026: all failures were the unpublished newest NISAR day plus two isolated OPERA 500s).
    // The tiles come through the lens-tile protocol (lensTiles.ts): a 5xx or network error has already been
    // asked for again (up to three times) before it reaches this handler, with its real HTTP status; a 404
    // (day not published) never reaches it, because MapLibre raises no error event for a status-404 tile, and
    // the loader stops requesting that day for a while. One late day is normal and stays quiet; but when every
    // day still on the stack answers 404 there is no radar to show at all, and that is reported (see
    // checkAllUnpublished below, which asks the loader).
    // So (see createLensDropPolicy): isolated errors are logged only; a stacked day that has failed
    // LENS_DROP_AFTER times and still has delivered nothing after a grace period is taken off the stack. A
    // drop after server / network errors is not final: the day is put back when the camera next comes to rest
    // or the browser comes back online. Such a drop raises the visible notice, as does an empty stack: a
    // radar day that failed to load must not read as "no radar pass".
    const report = mapErrorReporter('lens', () => cb.current.onMapError);
    const dropPolicy = createLensDropPolicy(LENS_DROP_AFTER);
    const detached = new Map<string, DetachedLayer>();
    const graceTimers = new Set<number>();
    let lensOrder: string[] | null = null; // the stack's layer order before anything was dropped
    let lensGone = false;
    lens.on('data', (e: { dataType?: string; sourceId?: string; tile?: unknown }) => {
      // a day that has delivered tiles is real data with a few flaky tiles (GIBS sporadic 500s): never dropped
      if (e.dataType === 'source' && e.tile && e.sourceId?.startsWith('lens-')) dropPolicy.delivered(e.sourceId);
    });
    const dropLensDay = (src: string) => {
      const r = dropPolicy.graceElapsed(src);
      if (!r.drop) return;
      console.warn(
        r.notify
          ? `[map:lens] ${src}: tiles keep failing (server or network error); dropped from the lens stack until the next retry`
          : `[map:lens] ${src}: the service has no such day (HTTP 404 / 410); dropped from the lens stack`
      );
      lensOrder ??= (lens.getStyle()?.layers ?? []).map((l) => l.id);
      const d = detachLayer(lens, src);
      if (d) detached.set(src, d);
      const left = Object.keys(lens.getStyle()?.sources ?? {}).filter((k) => k.startsWith('lens-'));
      if (r.notify) cb.current.onMapError?.('lens', src);
      else if (!left.length) cb.current.onMapError?.('lens', 'all SAR lens sources');
    };
    lens.on('error', (e: { sourceId?: string; error?: { message?: string; status?: number } }) => {
      const src = e?.sourceId;
      if (!src || !src.startsWith('lens-')) return report(e); // style / terrain / labels: report as usual
      const r = dropPolicy.failed(src, e?.error?.status);
      console.warn(`[map:lens] ${src} tile failed (${r.count})`, e?.error?.status ?? '', e?.error?.message ?? '');
      if (r.action !== 'arm') return;
      // a layer's first tiles can fail before any good one arrives: decide after a few seconds
      const t = window.setTimeout(() => {
        graceTimers.delete(t);
        if (!lensGone) dropLensDay(src);
      }, TILE_NOTICE_GRACE_MS);
      graceTimers.add(t);
    });
    // Every day left on the stack answers 404 (a renamed layer, a clock far ahead, GIBS far behind): MapLibre
    // tells the error handler nothing, so the loader does. Checked after the same grace period, said once.
    let allGoneTimer = 0;
    let allGoneSaid = false;
    const checkAllUnpublished = () => {
      allGoneTimer = 0;
      if (lensGone || allGoneSaid) return;
      const sources = Object.entries(lens.getStyle()?.sources ?? {}).filter(([k]) => k.startsWith('lens-'));
      if (!sources.length || !sources.every(([, s]) => lensDayUnpublished((s as { tiles?: string[] }).tiles?.[0] ?? ''))) return;
      allGoneSaid = true;
      console.warn(`[map:lens] every radar day on the lens stack (${sources.length}) answers HTTP 404: nothing to show`);
      cb.current.onMapError?.('lens', 'all SAR lens sources');
    };
    const offUnpublished = onLensDayUnpublished(() => {
      if (!allGoneTimer && !allGoneSaid && !lensGone) allGoneTimer = window.setTimeout(checkAllUnpublished, TILE_NOTICE_GRACE_MS);
    });
    /** Put every dropped day back for another attempt (it is dropped again if it still cannot load). */
    const retryDropped = () => {
      if (lensGone) return;
      for (const src of dropPolicy.retry()) {
        const d = detached.get(src);
        detached.delete(src);
        if (d) reattachLayer(lens, d, lensOrder ?? []);
      }
    };
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
    a.on('moveend', retryDropped);
    window.addEventListener('online', retryDropped);
    lensMap.current = lens;
    apply();
    if (import.meta.env.DEV && (window as any).__gsMaps) (window as any).__gsMaps.lens = lens;
    return () => {
      a.off('move', sync);
      a.off('moveend', sync);
      a.off('moveend', retryDropped);
      window.removeEventListener('online', retryDropped);
      lensGone = true;
      graceTimers.forEach((t) => window.clearTimeout(t));
      offUnpublished();
      window.clearTimeout(allGoneTimer);
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

