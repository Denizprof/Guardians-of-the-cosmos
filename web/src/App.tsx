import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './map/MapView';
import SearchBox from './components/SearchBox';
import Filters from './components/Filters';
import EventPanel from './components/EventPanel';
import IntroPanel from './components/IntroPanel';
import Timeline from './components/Timeline';
import { CATALOGS, GROUPS, loadCatalog, loadData, layerLabel } from './lib';
import { loadLayerCatalog, toOverlay, type CatalogLayer } from './layers';
import LayersPanel, { type LayerState } from './components/LayersPanel';
import { nisarCoverage, type CoverageResult } from './services';
import { EVENT_CONTENT } from './content/explain';
import type { Category, CompareMode, ContextEvent, SarEvent } from './types';

const ALL_CATS: Category[] = GROUPS.flatMap((g) => g.categories);

// ---- URL state: #/e/<event>?mode=swipe&b=<layer>&a=<layer>&lvl=simple
function readHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const q = new URLSearchParams(qs || '');
  const m = path.match(/^e\/([\w-]+)/);
  const mode = q.get('mode');
  const lvl = q.get('lvl');
  return {
    event: m?.[1] ?? null,
    // whitelist: an unknown value in a shared link must not leave the UI with no mode
    mode: mode === 'swipe' || mode === 'side' || mode === 'overlay' ? (mode as CompareMode) : null,
    b: q.get('b'),
    a: q.get('a'),
    lvl: lvl === 'simple' || lvl === 'scientific' ? (lvl as 'simple' | 'scientific') : null,
  };
}

function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return m;
}

export default function App() {
  const [events, setEvents] = useState<SarEvent[]>([]);
  const [context, setContext] = useState<ContextEvent[]>([]);
  const [generated, setGenerated] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const init = useMemo(readHash, []);
  const [selectedId, setSelectedId] = useState<string | null>(init.event);
  const [beforeId, setBeforeId] = useState<string | null>(init.b);
  const [afterId, setAfterId] = useState<string | null>(init.a);
  const [mode, setMode] = useState<CompareMode>(init.mode ?? 'swipe');
  const [level, setLevel] = useState<'simple' | 'scientific'>(init.lvl ?? 'simple');
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [slot, setSlot] = useState<'before' | 'after'>('after');
  const [activePin, setActivePin] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<Category>>(new Set(ALL_CATS));
  const [showContext, setShowContext] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [coverageMode, setCoverageMode] = useState(false);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [coverageState, setCoverageState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; zoom?: number; bbox?: [number, number, number, number]; nonce: number } | null>(null);
  const isMobile = useIsMobile();
  const [activeCatalogs, setActiveCatalogs] = useState<Set<string>>(() => new Set(CATALOGS.filter((c) => c.defaultOn).map((c) => c.id)));
  const [catalogEvents, setCatalogEvents] = useState<Record<string, ContextEvent[]>>({});
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  const [years, setYears] = useState<[number, number]>([1900, new Date().getUTCFullYear()]);
  const [probe, setProbe] = useState<{ lon: number; lat: number; date: string | null } | null>(null);
  const [catalogLayers, setCatalogLayers] = useState<CatalogLayer[]>([]);
  const [layerState, setLayerState] = useState<Record<string, LayerState>>({});
  const [layersOpen, setLayersOpen] = useState(false);

  useEffect(() => {
    loadLayerCatalog().then(setCatalogLayers).catch(() => setCatalogLayers([]));
  }, []);

  const tileOverlays = useMemo(
    () => catalogLayers.filter((l) => layerState[l.id]?.on).map((l) => toOverlay(l, layerState[l.id].date, layerState[l.id].opacity)),
    [catalogLayers, layerState]
  );

  // load catalogs on demand when switched on
  useEffect(() => {
    for (const id of activeCatalogs) {
      if (catalogEvents[id] || catalogErrors[id]) continue;
      loadCatalog(id)
        .then((c) => setCatalogEvents((m) => ({ ...m, [id]: c.events })))
        .catch((e) => setCatalogErrors((m) => ({ ...m, [id]: String(e.message || e) })));
    }
  }, [activeCatalogs, catalogEvents, catalogErrors]);

  // everything shown as reported/context markers: recent EONET/USGS + active catalogs, filtered by year
  const mapContext = useMemo(() => {
    const all = [...(showContext ? context : []), ...[...activeCatalogs].flatMap((id) => catalogEvents[id] ?? [])];
    return all.filter((e) => {
      const y = new Date(e.date).getUTCFullYear();
      return Number.isNaN(y) || (y >= years[0] && y <= years[1]);
    });
  }, [context, showContext, activeCatalogs, catalogEvents, years]);

  useEffect(() => {
    loadData()
      .then((d) => {
        setEvents(d.events);
        setContext(d.context);
        setGenerated(d.generated);
      })
      .catch((e) => setLoadError(String(e.message || e)));
  }, []);

  const selected = events.find((e) => e.id === selectedId) ?? null;
  const before = selected?.layers.find((l) => l.id === beforeId) ?? null;
  const after = selected?.layers.find((l) => l.id === afterId) ?? null;

  // default before/after when an event opens (or the URL names unknown layers)
  useEffect(() => {
    if (!selected) return;
    // Prefer our measured (derived) layers when they exist; NASA browse images otherwise.
    const pick = (role: string) =>
      selected.layers.find((l) => l.role === role && l.kind !== 'browse') ?? selected.layers.find((l) => l.role === role);
    if (!before) setBeforeId(pick('before')?.id ?? selected.layers[0]?.id ?? null);
    if (!after) setAfterId(pick('after')?.id ?? selected.layers.at(-1)?.id ?? null);
  }, [selected, before, after]);

  // follow external hash changes (pasted/shared links, back/forward)
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setSelectedId(h.event);
      setBeforeId(h.b);
      setAfterId(h.a);
      if (h.mode) setMode(h.mode);
      if (h.lvl) setLevel(h.lvl);
      setActivePin(null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // write URL state
  useEffect(() => {
    if (!events.length) return;
    const hash = selected
      ? `#/e/${selected.id}?${new URLSearchParams({ mode, b: beforeId ?? '', a: afterId ?? '', lvl: level })}`
      : '#/';
    if (window.location.hash === hash) return;
    // Opening/closing an investigation is a navigation (Back returns to the globe);
    // mode/layer/level tweaks only replace the current entry.
    const curEvent = readHash().event;
    if (curEvent !== (selected?.id ?? null)) history.pushState(null, '', hash);
    else history.replaceState(null, '', hash);
  }, [events.length, selected, mode, beforeId, afterId, level]);

  const selectEvent = useCallback((id: string | null) => {
    setSelectedId(id);
    setBeforeId(null);
    setAfterId(null);
    setActivePin(null);
    setPanelCollapsed(false);
    if (id) setCoverageMode(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (e.target as HTMLElement)?.tagName !== 'INPUT') selectEvent(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectEvent]);

  const covAbort = useRef<AbortController | null>(null);
  const runCoverage = useCallback(async (lon: number, lat: number, date: string | null = null) => {
    setSelectedId(null);
    setProbe({ lon, lat, date });
    setCoverageState('loading');
    setCoverageError(null);
    setPanelCollapsed(false);
    covAbort.current?.abort();
    covAbort.current = new AbortController();
    try {
      const r = await nisarCoverage(lon, lat, covAbort.current.signal);
      setCoverage(r);
      setCoverageState('idle');
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setCoverageState('error');
      setCoverageError(`Could not reach the ASF search service (${e.message}). The curated investigations still work offline.`);
    }
  }, []);

  // ---- swipe divider, in px from the left edge of the map area
  const mapWidth = () => (isMobile ? window.innerWidth : window.innerWidth - 424);
  const [swipeX, setSwipeX] = useState(() => Math.round((window.innerWidth - (window.innerWidth <= 820 ? 0 : 424)) / 2));
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      setSwipeX(Math.max(0, Math.min(window.innerWidth, e.clientX)));
    };
    const up = () => (dragging.current = false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const pins = selected ? EVENT_CONTENT[selected.id]?.pins ?? [] : [];
  const panelInset = isMobile ? { right: 0, bottom: Math.round(window.innerHeight * 0.52) + 84 } : { right: 424, bottom: 116 };

  if (loadError) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="panel" style={{ position: 'static', width: 420, height: 'auto', padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Data package missing</h2>
          <p className="muted">Could not load the event data ({loadError}). Run the pipeline first: <span className="mono">cd pipeline &amp;&amp; node src/fetch-browse.mjs</span></p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <MapView
        events={events}
        context={mapContext}
        visibleCategories={visible}
        showContext={true}
        selected={selected}
        before={before}
        after={after}
        mode={mode}
        swipeX={swipeX}
        overlayOpacity={overlayOpacity}
        coverage={selected ? null : coverage}
        pins={pins}
        activePin={activePin}
        panelInset={panelInset}
        onSelectEvent={selectEvent}
        onMapClick={(lon, lat) => {
          if (coverageMode && !selected) runCoverage(lon, lat);
        }}
        onCheckCoverage={runCoverage}
        onPin={(id) => setActivePin((cur) => (cur === id ? null : id))}
        flyTo={flyTo}
        tileOverlays={tileOverlays}
      />

      {selected && mode === 'swipe' && (
        <>
          <div
            className="swipe-handle"
            style={{ left: swipeX }}
            onPointerDown={(e) => {
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            role="slider"
            aria-label="Swipe between before and after"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((swipeX / mapWidth()) * 100)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setSwipeX((x) => Math.max(0, x - 24));
              if (e.key === 'ArrowRight') setSwipeX((x) => Math.min(window.innerWidth, x + 24));
            }}
          >
            <div className="grip">⇔</div>
          </div>
          {before && <div className="map-tag" style={{ left: Math.max(12, swipeX - 250), maxWidth: 236, textAlign: 'right' }}>BEFORE · {layerLabel(before)}</div>}
          {after && <div className="map-tag" style={{ left: swipeX + 12 }}>AFTER · {layerLabel(after)}</div>}
        </>
      )}
      {selected && mode === 'side' && (
        <>
          {before && <div className="map-tag" style={{ left: 12 }}>BEFORE · {layerLabel(before)}</div>}
          {after && <div className="map-tag" style={{ left: isMobile ? 12 : 'calc(50% + 12px)', top: isMobile ? 'calc(50% + 12px)' : undefined }}>AFTER · {layerLabel(after)}</div>}
        </>
      )}
      {selected && mode === 'overlay' && before && after && (
        <div className="map-tag" style={{ left: 12 }}>
          BEFORE {layerLabel(before)} · AFTER {layerLabel(after)} at {Math.round(overlayOpacity * 100)}%
        </div>
      )}

      <div className="topbar">
        <div className="brand">
          <b>GLOBAL SAR</b>
          <span className="mono">Earth change explorer</span>
        </div>
        <SearchBox
          events={events}
          onEvent={selectEvent}
          onPlace={(hit) => {
            selectEvent(null);
            setFlyTo({ lon: hit.lon, lat: hit.lat, bbox: hit.extent, zoom: 8, nonce: Date.now() });
            runCoverage(hit.lon, hit.lat);
          }}
        />
        {!selected && (
          <button className="tool" aria-pressed={coverageMode} onClick={() => setCoverageMode((v) => !v)} title="Click the map to list real NISAR acquisitions there">
            ◎ Coverage probe
          </button>
        )}
        <button className="tool" aria-pressed={layersOpen} onClick={() => setLayersOpen((v) => !v)} title="Global satellite layers (NASA, ESA, partners)">
          ▦ Satellite layers{tileOverlays.length ? ` (${tileOverlays.length})` : ''}
        </button>
        <button className="tool mobile-only" aria-pressed={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
          Filters
        </button>
      </div>

      {layersOpen && (
        <LayersPanel
          layers={catalogLayers}
          state={layerState}
          level={level}
          onChange={(id, s) => setLayerState((m) => ({ ...m, [id]: s }))}
          onClose={() => setLayersOpen(false)}
        />
      )}
      {!selected && !layersOpen && (
        <Filters
          events={events}
          context={mapContext}
          visible={visible}
          showContext={showContext}
          open={filtersOpen}
          activeCatalogs={activeCatalogs}
          catalogCounts={Object.fromEntries(Object.entries(catalogEvents).map(([k, v]) => [k, v.length]))}
          catalogErrors={catalogErrors}
          onToggleCatalog={(id) =>
            setActiveCatalogs((s) => {
              const n = new Set(s);
              n.has(id) ? n.delete(id) : n.add(id);
              return n;
            })
          }
          years={years}
          onYears={setYears}
          onSetVisible={(cats, on) =>
            setVisible((s) => {
              const n = new Set(s);
              cats.forEach((c) => (on ? n.add(c) : n.delete(c)));
              return n;
            })
          }
          onShowContext={setShowContext}
          onSelect={selectEvent}
        />
      )}

      {selected ? (
        <EventPanel
          event={selected}
          before={before}
          after={after}
          mode={mode}
          overlayOpacity={overlayOpacity}
          level={level}
          activePin={activePin}
          collapsed={panelCollapsed}
          onMode={setMode}
          onBefore={setBeforeId}
          onAfter={setAfterId}
          onOpacity={setOverlayOpacity}
          onLevel={setLevel}
          onPin={setActivePin}
          onClose={() => selectEvent(null)}
          onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
        />
      ) : (
        <IntroPanel
          events={events}
          generated={generated}
          coverage={coverage}
          coverageState={coverageState}
          coverageError={coverageError}
          coverageMode={coverageMode}
          probe={probe}
          collapsed={panelCollapsed}
          onSelect={selectEvent}
          onCoverageMode={setCoverageMode}
          onClearCoverage={() => {
            setCoverage(null);
            setProbe(null);
          }}
          onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
        />
      )}

      {selected && (
        <Timeline
          event={selected}
          before={before}
          after={after}
          slot={slot}
          onSlot={setSlot}
          onPick={(id) => (slot === 'before' ? setBeforeId(id) : setAfterId(id))}
        />
      )}
    </div>
  );
}
