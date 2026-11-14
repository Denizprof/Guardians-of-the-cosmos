import { memo, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Category, CompareMode, ContextEvent, SarEvent, SarLayer } from '../types';
import { layerBounds } from '../lib';
import type { CoverageResult } from '../services';
import type { Pin } from '../content/explain';
import { registerNodataProtocol } from './nodataKey';
import { createTileErrorPolicy } from './tileErrors';
import { browseBounds, coverageFeatures, trimmedBrowseUrl } from './coverageSelect';
import {
  EVENT_BEARING, EVENT_PITCH, HOME_CENTER, MAX_ZOOM, STYLE, TERRAIN, TERRAIN_OFF_ZOOM, TERRAIN_ON_ZOOM, homeZoom, lensStyle,
} from './style';
import { attachHalo } from './halo';
import { addOverlays, overlayUrls, syncImageLayers, syncTileOverlays } from './overlays';
import type { TileOverlay } from './overlays';
import { addMarkers } from './markers';
import { drawStars } from './starfield';

export type { TileOverlay };

// Untouched worker copy served from public/vendor (see vite.config.ts).
maplibregl.setWorkerUrl(new URL('vendor/maplibre-gl-worker.mjs', document.baseURI).href);
// JPEG satellite layers with black no-data (VIIRS true colour etc.) are keyed to transparent; see nodataKey.ts
registerNodataProtocol(maplibregl as unknown as Parameters<typeof registerNodataProtocol>[0]);
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
    const ctl = new AbortController();
    let objectUrl: string | null = null;
    trimmedBrowseUrl(g.browse, ctl.signal)
      .then((u) => {
        objectUrl = u;
        if (ctl.signal.aborted) return;
        clear();
        a.addSource('coverage-browse', { type: 'image', url: u, coordinates: coords });
        a.addLayer({ id: 'coverage-browse', type: 'raster', source: 'coverage-browse', paint: { 'raster-opacity': 0.92, 'raster-fade-duration': 0 } }, 'coverage-fill');
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        // the outline still shows; say that the picture did not load instead of leaving a silent gap
        console.warn('[map:globe] coverage browse picture failed', e instanceof Error ? e.message : e);
        cb.current.onMapError?.('globe', 'coverage-browse');
      });
    return () => {
      ctl.abort();
      clear();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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

