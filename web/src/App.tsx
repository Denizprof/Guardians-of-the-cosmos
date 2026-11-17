import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './map/MapView';
import SearchBox from './components/SearchBox';
import Filters from './components/Filters';
import EventPanel from './components/EventPanel';
import IntroPanel from './components/IntroPanel';
import AssistantSidePanel from './components/AssistantSidePanel';
import ContextPanel from './components/ContextPanel';
import InspectPanel from './components/InspectPanel';
import type { Box } from './inspect';
import Timeline from './components/Timeline';
import SarLens, { type LensGeometry } from './components/SarLens';
import { IconAsk, IconBuildings, IconFilters, IconInfo, IconInspect, IconInvestigations, IconLayers, IconLens, IconProbe } from './components/icons';
import { InvestigationStrip, InvestigationsMenu } from './components/Investigations';
import { readHash } from './app/readHash';
import { markIntroSeen, shouldShowIntro } from './app/introSeen';
import Welcome from './components/Welcome';
import FrontPage from './components/FrontPage';
import Tutorial, { type TutorialState } from './components/Tutorial';
import LangSwitch from './components/LangSwitch';
import { useIsMobile, useViewportHeight } from './app/viewport';
import { useCatalogs } from './app/useCatalogs';
import { PANEL_W, useSwipe } from './app/useSwipe';
import { GROUPS, loadData, layerLabel, markerKey } from './lib';
import { loadLayerCatalog, toOverlay, type CatalogLayer } from './layers';
import LayersPanel, { type LayerState } from './components/LayersPanel';
import { nisarCoverage, type CoverageResult, type GeocodeHit } from './services';
import { EVENT_CONTENT, type Pin } from './content/explain';
import { SAR_LENS_SOURCE, lensDateLabel } from './map/sarLens';
import type { Category, CompareMode, ContextEvent, SarEvent } from './types';

/** Stable empty list: a fresh [] per render would re-run MapView's pin effect on every App render. */
const NO_PINS: Pin[] = [];
const ALL_CATS: Category[] = GROUPS.flatMap((g) => g.categories);

/** What the on-demand side panel shows when no investigation is open. */
type PanelView = 'none' | 'about' | 'probe' | 'context' | 'assistant' | 'inspect';
type Popover = null | 'investigations' | 'filters' | 'layers';

export default function App() {
  const [events, setEvents] = useState<SarEvent[]>([]);
  const [context, setContext] = useState<ContextEvent[]>([]);
  const [generated, setGenerated] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Where the globe is looking, for the assistant's "what am I viewing?". */
  const [mapView, setMapView] = useState<{ center: [number, number]; zoom: number; bbox: [number, number, number, number] } | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [layersError, setLayersError] = useState<string | null>(null);
  const [mapErrors, setMapErrors] = useState<Set<string>>(() => new Set());
  const onMapError = useCallback((where: 'globe' | 'lens', source: string) => {
    const label =
      where === 'lens' ? 'SAR lens radar tiles'
      : source.startsWith('satellite') ? 'satellite imagery'
      : source === 'dem' ? 'terrain'
      : source === 'openmaptiles' ? 'labels and borders'
      : source.startsWith('ov-') ? `satellite layer "${source.slice(3)}"`
      : source === 'coverage-browse' ? 'NISAR browse picture of the selected product'
      : source.startsWith('sar-') ? 'NISAR investigation image'
      : source;
    setMapErrors((s) => (s.has(label) ? s : new Set(s).add(label)));
  }, []);

  const init = useMemo(readHash, []);
  const [selectedId, setSelectedId] = useState<string | null>(init.event);
  // Front page: a screen of its own on a first visit to the landing view (a link to an investigation skips it).
  const [frontOpen, setFrontOpen] = useState(() => shouldShowIntro(init));
  // Guided tour: opened from the front page or from About.
  const [introOpen, setIntroOpen] = useState(false);
  // Interactive tutorial: a coach card over the live tool (from the front page or About).
  const [tutorialOn, setTutorialOn] = useState(false);
  /** Raised on every start, so starting again from About begins at step 1. */
  const [tutorialRun, setTutorialRun] = useState(0);
  const [beforeId, setBeforeId] = useState<string | null>(init.b);
  const [afterId, setAfterId] = useState<string | null>(init.a);
  const [mode, setMode] = useState<CompareMode>(init.mode ?? 'swipe');
  const [level, setLevel] = useState<'simple' | 'scientific'>(init.lvl ?? 'simple');
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [slot, setSlot] = useState<'before' | 'after'>('after');
  const [activePin, setActivePin] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<Category>>(new Set(ALL_CATS));
  const [showContext, setShowContext] = useState(true);
  const [panelView, setPanelView] = useState<PanelView>('none');
  /** The chat inside the open investigation's panel was opened with Ask or the satellite (the tutorial watches this). */
  const [panelAskOpen, setPanelAskOpen] = useState(false);
  /** A link named an investigation that is not in the data: said on screen, never a silent blank globe. */
  const [missingId, setMissingId] = useState<string | null>(null);
  const [ctxSel, setCtxSel] = useState<ContextEvent | null>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [coverageMode, setCoverageMode] = useState(false);
  /** Inspect area: while on, a drag on the globe selects a box; the box stays while its panel is open. */
  const [inspectMode, setInspectMode] = useState(false);
  const [inspectBox, setInspectBox] = useState<Box | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  /** Coverage probe: the one product shown on the map. A new probe result starts on its newest product. */
  const [coverageScene, setCoverageScene] = useState<string | null>(null);
  useEffect(() => setCoverageScene(coverage?.granules[0]?.scene ?? null), [coverage]);
  const [coverageState, setCoverageState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; zoom?: number; bbox?: [number, number, number, number]; nonce: number } | null>(null);
  const isMobile = useIsMobile();
  const viewportH = useViewportHeight();
  const [years, setYears] = useState<[number, number]>([1900, new Date().getUTCFullYear()]);
  const [probe, setProbe] = useState<{ lon: number; lat: number; date: string | null; precision?: string | null } | null>(null);
  const [catalogLayers, setCatalogLayers] = useState<CatalogLayer[]>([]);
  const [layerState, setLayerState] = useState<Record<string, LayerState>>({});
  const [lensOn, setLensOn] = useState(false);
  /** 3D buildings when zoomed in close: on by default, can be switched off on slow devices (remembered). */
  const [buildingsOn, setBuildingsOn] = useState(() => {
    try {
      return localStorage.getItem('gsar-buildings') !== 'off';
    } catch {
      return true;
    }
  });
  const toggleBuildings = useCallback(() => {
    setBuildingsOn((on) => {
      try {
        localStorage.setItem('gsar-buildings', on ? 'off' : 'on');
      } catch {
        // storage blocked: the choice lasts for this visit only
      }
      return !on;
    });
  }, []);
  const [lensFull, setLensFull] = useState(false);
  const [lensChoice, setLensChoice] = useState<'base' | 'nisar'>('base');
  const appRef = useRef<HTMLDivElement>(null);
  const lensGeometry = useRef<LensGeometry | null>(null);

  useEffect(() => {
    loadLayerCatalog()
      .then(setCatalogLayers)
      .catch((e: unknown) => {
        setCatalogLayers([]);
        setLayersError(e instanceof Error ? e.message : 'unknown error');
      });
  }, []);

  const tileOverlays = useMemo(
    () => catalogLayers.filter((l) => layerState[l.id]?.on).map((l) => toOverlay(l, layerState[l.id].date, layerState[l.id].opacity)),
    [catalogLayers, layerState]
  );

  const { activeCatalogs, catalogEvents, catalogErrors, catalogRetrieved, catalogLimits, catalogCounts, onToggleCatalog } = useCatalogs();

  // everything shown as reported/context markers: recent EONET/USGS + active catalogs, filtered by year
  const mapContext = useMemo(() => {
    // De-duplicate by id (context.json and the USGS catalog both emit usgs-<id>): one marker per event,
    // preferring the catalog record (it carries the fuller fields), so counts and clicks are not doubled.
    const byId = new Map<string, ContextEvent>();
    // (keyed by markerKey: the same GDACS flood arrives under different ids from the feed and from the catalog)
    for (const id of activeCatalogs) for (const e of catalogEvents[id] ?? []) if (!byId.has(markerKey(e))) byId.set(markerKey(e), e);
    if (showContext) for (const e of context) if (!byId.has(markerKey(e))) byId.set(markerKey(e), e);
    const all = [...byId.values()];
    return all.filter((e) => {
      const y = new Date(e.date).getUTCFullYear();
      return Number.isNaN(y) || (y >= years[0] && y <= years[1]);
    });
  }, [context, showContext, activeCatalogs, catalogEvents, years]);
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;

  useEffect(() => {
    loadData()
      .then((d) => {
        setEvents(d.events);
        setContext(d.context);
        setContextError(d.contextError);
        setGenerated(d.generated);
      })
      .catch((e) => setLoadError(String(e.message || e)));
  }, []);

  const selected = useMemo(() => events.find((e) => e.id === selectedId) ?? null, [events, selectedId]);
  const before = selected?.layers.find((l) => l.id === beforeId) ?? null;
  const after = selected?.layers.find((l) => l.id === afterId) ?? null;
  const openId = selected?.id ?? null;
  useEffect(() => setPanelAskOpen(false), [openId]); // another investigation, or none: its chat is not open yet

  // A link to an investigation that does not exist (old or mistyped): say so and go to the landing view.
  // Declared before the URL-write effect, so the dead link is replaced and does not stay as a Back entry.
  const firstLink = useRef(true);
  useEffect(() => {
    if (!events.length) return;
    const first = firstLink.current;
    firstLink.current = false;
    if (!selectedId || selected) return;
    setMissingId(selectedId);
    setSelectedId(null);
    setBeforeId(null);
    setAfterId(null);
    if (readHash().event === selectedId) history.replaceState(null, '', '#/');
    // the link named nothing after all: a first visit gets the front page, as on the landing view
    if (first && shouldShowIntro({ event: null })) setFrontOpen(true);
  }, [events.length, selectedId, selected]);

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
      // In-page anchors (e.g. assistant citation links "#asst-c-1") are not app routes.
      if (window.location.hash && !window.location.hash.startsWith('#/')) return;
      const h = readHash();
      setSelectedId(h.event);
      setBeforeId(h.b);
      setAfterId(h.a);
      if (h.mode) setMode(h.mode);
      if (h.lvl) setLevel(h.lvl);
      setActivePin(null);
      if (h.event) {
        // a linked investigation takes the side panel over, exactly like opening it from the UI
        setPanelView('none');
        setCtxSel(null);
        setPopover(null);
        clearCoverageRef.current();
        // the reader asked for this investigation: it must not stay hidden behind the front page or the tour
        setFrontOpen(false);
        setIntroOpen(false);
        focusToolAfterFront.current = true;
      }
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

  const covAbort = useRef<AbortController | null>(null);
  const clearCoverage = useCallback(() => {
    covAbort.current?.abort(); // a slow probe must not bring cleared results back
    setCoverage(null);
    setProbe(null);
    setCoverageState('idle');
    setCoverageError(null);
  }, []);
  const clearCoverageRef = useRef(clearCoverage);
  clearCoverageRef.current = clearCoverage;

  const focusToolAfterFront = useRef(false);
  const selectEvent = useCallback((id: string | null) => {
    setSelectedId(id);
    setBeforeId(null);
    setAfterId(null);
    setActivePin(null);
    setPanelCollapsed(false);
    if (id) {
      // an investigation takes the side panel over; probe results must not linger (or reappear on Back)
      setCoverageMode(false);
      setInspectMode(false);
      setInspectBox(null);
      setPanelView('none');
      setCtxSel(null);
      setPopover(null);
      clearCoverage();
    }
  }, [clearCoverage]);

  /** Close whatever the side panel is showing. */
  const closePanel = useCallback(() => {
    selectEvent(null);
    setPanelView('none');
    setCtxSel(null);
    setInspectBox(null);
    clearCoverage();
  }, [selectEvent, clearCoverage]);

  const runCoverage = useCallback(async (lon: number, lat: number, date: string | null = null, precision: string | null = null) => {
    setSelectedId(null);
    setCtxSel(null);
    setPanelView('probe');
    setPopover(null);
    setProbe({ lon, lat, date, precision });
    setCoverage(null);
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

  const selectContext = useCallback(
    (id: string) => {
      const ev = mapContextRef.current.find((e) => e.id === id);
      if (!ev) return;
      clearCoverage();
      setCtxSel(ev);
      setPanelView('context');
      setPanelCollapsed(false);
      setPopover(null);
    },
    [clearCoverage]
  );

  const panelOpen = !!selected || panelView !== 'none';

  // Focus management (keyboard / screen-reader users): when the side panel opens or switches to new content,
  // move focus to its heading; when it closes, return focus to the control that opened it (otherwise focus
  // falls to <body> and the reader loses their place).
  const panelKey = selected ? `e:${selected.id}` : panelView === 'context' ? `c:${ctxSel?.id ?? ''}` : panelView === 'none' ? null : `v:${panelView}`;
  const panelReturnFocus = useRef<HTMLElement | null>(null);
  const prevPanelKey = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPanelKey.current;
    prevPanelKey.current = panelKey;
    if (panelKey && panelKey !== prev) {
      if (!prev) panelReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const t = window.setTimeout(() => {
        const h = appRef.current?.querySelector<HTMLElement>('section.panel h2');
        if (!h) return;
        h.tabIndex = -1;
        h.focus({ preventScroll: true });
      }, 0);
      return () => window.clearTimeout(t);
    }
    if (!panelKey && prev) {
      const back = panelReturnFocus.current;
      panelReturnFocus.current = null;
      if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
      else {
        // the opener unmounted (e.g. the investigations strip hides while a panel is open): wait for it to
        // re-render, then land on it or, failing that, on the first toolbar control
        const t = window.setTimeout(() => {
          appRef.current?.querySelector<HTMLElement>('.inv-strip button, .topbar .tool')?.focus({ preventScroll: true });
        }, 0);
        return () => window.clearTimeout(t);
      }
    }
  }, [panelKey]);

  // Escape steps back one layer at a time: popover, full-screen lens, then the side panel.
  // Only a "global" Escape counts: never from form controls, the assistant textarea, selects or date pickers.
  const esc = useRef({ popover, lensFull, panelOpen });
  esc.current = { popover, lensFull: lensOn && lensFull, panelOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inControl = !!t?.closest?.('input, textarea, select, [contenteditable="true"], .maplibregl-popup');
      if (e.key !== 'Escape' || e.defaultPrevented || inControl) return;
      if (esc.current.popover) setPopover(null);
      else if (esc.current.lensFull) setLensFull(false);
      else if (esc.current.panelOpen) closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePanel]);

  const { freeWidth, swipeX, handleRef, swipePct, moveSwipe, onSwipeDown, onSwipeMove, onSwipeUp } = useSwipe(appRef, isMobile, selectedId);

  const pins = (selected && EVENT_CONTENT[selected.id]?.pins) || NO_PINS;
  const sheet = Math.round(viewportH * 0.52); // matches the 52vh mobile sheet in styles.css
  const insetRight = !isMobile && panelOpen ? PANEL_W : 0;
  const insetBottom = isMobile ? (panelOpen ? sheet + 84 : 84 + 96) : selected ? 116 : 0;
  const panelInset = useMemo(() => ({ right: insetRight, bottom: insetBottom }), [insetRight, insetBottom]);

  const focus = useMemo(() => {
    if (selected) return null;
    if (panelView === 'context' && ctxSel) return { lon: ctxSel.lon, lat: ctxSel.lat };
    if (panelView === 'probe' && probe) return { lon: probe.lon, lat: probe.lat };
    return null;
  }, [selected, panelView, ctxSel, probe]);

  // ---- SAR lens
  const lensNisar = lensOn && lensChoice === 'nisar' && selected && after ? after : null;
  const lensProp = useMemo(() => (lensOn ? { nisar: lensNisar } : null), [lensOn, lensNisar]);
  const lensInfo = useMemo(() => {
    if (lensNisar) {
      const pr = lensNisar.provenance;
      return {
        label: `${pr.mission} ${lensNisar.product} (this investigation), ${layerLabel(lensNisar)}`,
        note: 'investigation footprint only',
        provenance: [
          `${pr.mission} · ${pr.sensor}. Product ${lensNisar.product}, data tier ${pr.tier}.`,
          `Granule ${pr.granule}. Track ${pr.track}, frame ${pr.frame}, ${pr.direction.toLowerCase()}.`,
          `Distributor: ${pr.distributor}. ${pr.credit}`,
          `Outside this footprint the lens shows ${SAR_LENS_SOURCE.label}, ${lensDateLabel(SAR_LENS_SOURCE)}.`,
        ],
      };
    }
    const date = lensDateLabel(SAR_LENS_SOURCE);
    return {
      label: `${SAR_LENS_SOURCE.label}${date ? `, ${date}` : ''}`,
      note: SAR_LENS_SOURCE.partial ? SAR_LENS_SOURCE.partialNote : null,
      provenance: SAR_LENS_SOURCE.provenance,
    };
    // lensOn: the date range is recomputed each time the lens opens, the same moment MapView builds the
    // lens tile URLs, so the label and the tiles always name the same days (also across a UTC midnight).
  }, [lensNisar, lensOn]);
  const lensChoiceProp = useMemo(
    () => (selected && after ? { value: lensChoice, baseLabel: 'Global mosaic', nisarLabel: 'This investigation', onChange: setLensChoice } : null),
    [selected, after, lensChoice]
  );
  const closeLens = useCallback(() => {
    setLensOn(false);
    setLensFull(false);
  }, []);

  // ---- stable callbacks for the memoized children
  const onMapClick = useCallback(
    (lon: number, lat: number) => {
      if (coverageMode && !selected) runCoverage(lon, lat);
    },
    [coverageMode, selected, runCoverage]
  );
  const onInspectBox = useCallback(
    (box: Box) => {
      clearCoverage();
      setSelectedId(null);
      setCtxSel(null);
      setInspectBox(box);
      setPanelView('inspect');
      setPopover(null);
      setPanelCollapsed(false);
    },
    [clearCoverage]
  );
  const toggleInspect = useCallback(() => {
    setInspectMode((on) => {
      if (on) return false;
      setCoverageMode(false);
      return true;
    });
  }, []);
  const onMapPin = useCallback((id: string) => setActivePin((cur) => (cur === id ? null : id)), []);
  const onPlace = useCallback(
    (hit: GeocodeHit) => {
      selectEvent(null);
      setFlyTo({ lon: hit.lon, lat: hit.lat, bbox: hit.extent, zoom: 8, nonce: Date.now() });
      runCoverage(hit.lon, hit.lat);
    },
    [selectEvent, runCoverage]
  );
  const onSetVisible = useCallback(
    (cats: Category[], on: boolean) =>
      setVisible((s) => {
        const n = new Set(s);
        cats.forEach((c) => (on ? n.add(c) : n.delete(c)));
        return n;
      }),
    []
  );
  const onLayerChange = useCallback((id: string, s: LayerState) => setLayerState((m) => ({ ...m, [id]: s })), []);
  const closePopover = useCallback(() => setPopover(null), []);
  const toggleCollapsed = useCallback(() => setPanelCollapsed((v) => !v), []);
  const onTimelinePick = useCallback((id: string) => (slot === 'before' ? setBeforeId(id) : setAfterId(id)), [slot]);
  const toggle = (p: Exclude<Popover, null>) => setPopover((cur) => (cur === p ? null : p));

  // Hooks must all run before the early return below (a failed data load must show the error card, not crash).
  const closeIntro = useCallback(() => {
    markIntroSeen();
    setIntroOpen(false);
    // hand keyboard focus to the tool: its first toolbar control
    window.setTimeout(() => appRef.current?.querySelector<HTMLElement>('.topbar .tool')?.focus({ preventScroll: true }), 0);
  }, []);
  const startFromFront = useCallback(() => {
    setFrontOpen(false);
    markIntroSeen();
    focusToolAfterFront.current = true; // focus moves once the tool is no longer inert (effect below)
  }, []);
  useEffect(() => {
    if (frontOpen || !focusToolAfterFront.current) return;
    focusToolAfterFront.current = false;
    if (appRef.current?.contains(document.activeElement)) return; // focus is already in the tool (e.g. a panel heading)
    appRef.current?.querySelector<HTMLElement>('.topbar .tool')?.focus({ preventScroll: true });
  }, [frontOpen]);
  /** Start the interactive tutorial on a clean tool: nothing open, so its first steps make sense. */
  const startTutorial = useCallback(() => {
    markIntroSeen();
    selectEvent(null);
    closePanel();
    setPopover(null);
    // nothing left over from before: a step must not be "done" or behave oddly because of an earlier visit
    closeLens();
    setCoverageMode(false);
    setMode('swipe');
    setLevel('simple');
    setIntroOpen(false);
    setFrontOpen(false);
    setTutorialRun((n) => n + 1);
    setTutorialOn(true);
  }, [selectEvent, closePanel, closeLens]);
  const endTutorial = useCallback(() => setTutorialOn(false), []);
  const probed = probe !== null;
  const flyNonce = flyTo?.nonce ?? 0;
  const layersOn = tileOverlays.length;
  const assistantOpen = selected ? panelAskOpen : panelView === 'assistant';
  const tutorialState = useMemo<TutorialState>(
    () => ({ selectedId, mode, level, layersOn, lensOn, probed, flyNonce, assistantOpen }),
    [selectedId, mode, level, layersOn, lensOn, probed, flyNonce, assistantOpen],
  );
  const introCredits = useCallback(() => {
    markIntroSeen();
    setIntroOpen(false);
    setSelectedId(null);
    setPopover(null);
    setPanelCollapsed(false);
    setPanelView('about'); // the About panel carries the full credits; focus moves to its heading
  }, []);
  /** Open the assistant: from "Ask" in the top bar (a second press closes it) or from the satellite on the globe. */
  const askAssistant = useCallback((toggle: boolean) => {
    setPopover(null);
    if (selected) {
      // inside an investigation the chat lives in that panel, where it knows the event and its layers
      const ask = appRef.current?.querySelector<HTMLDetailsElement>('section.panel details[data-ask]');
      if (ask) {
        setPanelCollapsed(false);
        ask.open = true;
        ask.scrollIntoView({ block: 'start' });
        ask.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
        setPanelAskOpen(true);
      }
      return;
    }
    if (panelView === 'assistant') {
      if (toggle) closePanel();
      else setPanelCollapsed(false);
      return;
    }
    closePanel();
    setPanelView('assistant');
    setPanelCollapsed(false);
  }, [selected, panelView, closePanel]);
  const askFromSatellite = useCallback(() => askAssistant(false), [askAssistant]);
  /** About > "Back to the front page": the front page covers the tool again until Get started. */
  const showFront = useCallback(() => {
    closePanel();
    setPopover(null);
    setTutorialOn(false); // leaving the tool ends the tutorial; it does not resume by surprise
    setFrontOpen(true);
  }, [closePanel]);
  const showIntro = useCallback(() => {
    closePanel();
    setPopover(null);
    setTutorialOn(false);
    setIntroOpen(true);
  }, [closePanel]);

  if (loadError) {
    return (
      <div className="app error-screen">
        <div className="error-card">
          <h2>Data package missing</h2>
          <p className="muted">
            Could not load the event data ({loadError}). Run the pipeline first: <span className="mono">cd pipeline &amp;&amp; node src/fetch-browse.mjs</span>
          </p>
        </div>
      </div>
    );
  }

  const appClass = ['app', panelOpen ? 'has-panel' : '', selected ? 'has-event' : '', coverageMode && !selected ? 'probing' : '', lensOn ? (lensFull ? 'lens-on lens-full' : 'lens-on') : '']
    .filter(Boolean)
    .join(' ');

  return (
    <>
    <div className={appClass} ref={appRef} data-ready={events.length > 0} inert={frontOpen}>
      <header className="topbar">
        <h1 className="brand">
          <b>GLOBAL SAR</b>
          <span className="mono">Earth change explorer</span>
        </h1>
        <SearchBox events={events} onEvent={selectEvent} onPlace={onPlace} />
        <div className="tools" role="toolbar" aria-label="Map tools">
          <button className="tool" aria-expanded={popover === 'investigations'} onClick={() => toggle('investigations')} title="Curated before/after investigations" aria-label="Investigations" data-tut="investigations">
            <IconInvestigations />
            <span className="tool-label">Investigations</span>
          </button>
          <button className="tool" aria-expanded={popover === 'filters'} onClick={() => toggle('filters')} title="Categories, event catalogs and years" aria-label="Filters">
            <IconFilters />
            <span className="tool-label">Filters</span>
          </button>
          <button
            className="tool"
            aria-expanded={popover === 'layers'}
            onClick={() => toggle('layers')}
            title="Global satellite layers (NASA, ESA, partners)"
            data-tut="layers"
            aria-label={`Satellite layers${tileOverlays.length ? ` (${tileOverlays.length})` : ''}`}
          >
            <IconLayers />
            <span className="tool-label">Satellite layers</span>
            {tileOverlays.length > 0 && <span className="tool-count">{tileOverlays.length}</span>}
          </button>
          <button className="tool" aria-pressed={buildingsOn} onClick={toggleBuildings} title="Show or hide 3D buildings when zoomed in close (turn off if the map is slow)" aria-label="3D buildings">
            <IconBuildings />
            <span className="tool-label">3D buildings</span>
          </button>
          <button className="tool sar" aria-pressed={lensOn} onClick={() => (lensOn ? closeLens() : setLensOn(true))} title="A movable square that shows the same view in radar" aria-label="SAR lens" data-tut="lens">
            <IconLens />
            <span className="tool-label">SAR lens</span>
          </button>
          {!selected && (
            <button className="tool" aria-pressed={coverageMode} onClick={() => { setInspectMode(false); setCoverageMode((v) => !v); }} title="Click the map to list real NISAR acquisitions there" aria-label="Coverage probe" data-tut="probe">
              <IconProbe />
              <span className="tool-label">Coverage probe</span>
            </button>
          )}
          {!selected && (
            <button className="tool" aria-pressed={inspectMode} onClick={toggleInspect} title="Drag a box on the globe to see what is known inside it" aria-label="Inspect area" data-tut="inspect">
              <IconInspect />
              <span className="tool-label">Inspect area</span>
            </button>
          )}
          <button
            className="tool"
            aria-pressed={!selected && panelView === 'assistant'}
            onClick={() => askAssistant(true)}
            title="Ask the assistant about radar, NISAR and this app"
            aria-label="Ask the assistant"
            data-tut="ask"
          >
            <IconAsk />
            <span className="tool-label">Ask</span>
          </button>
          <button
            className="tool"
            aria-pressed={!selected && panelView === 'about'}
            onClick={() => {
              if (!selected && panelView === 'about') return; // already open: clicking again must not close it (the X and Escape do)
              closePanel();
              setPanelView('about');
              setPanelCollapsed(false);
              setPopover(null);
            }}
            title="About Global SAR, data credits"
            aria-label="About Global SAR"
          >
            <IconInfo />
            <span className="tool-label">About</span>
          </button>
          <LangSwitch />
        </div>
      </header>

      <MapView
        events={events}
        context={mapContext}
        visibleCategories={visible}
        showContext={true}
        selected={selected}
        before={before}
        after={after}
        mode={mode}
        overlayOpacity={overlayOpacity}
        coverage={selected ? null : coverage}
        coverageScene={coverageScene}
        pins={pins}
        activePin={activePin}
        panelInset={panelInset}
        onSelectEvent={selectEvent}
        onSelectContext={selectContext}
        onMapClick={onMapClick}
        probing={coverageMode && !selected}
        inspecting={inspectMode && !selected}
        buildings={buildingsOn}
        onInspectBox={onInspectBox}
        inspectBox={panelView === 'inspect' && !selected ? inspectBox : null}
        onAskAssistant={askFromSatellite}
        onPin={onMapPin}
        flyTo={flyTo}
        tileOverlays={tileOverlays}
        focus={focus}
        lens={lensProp}
        onMapError={onMapError}
        onViewChange={setMapView}
      />

      {mapErrors.size > 0 && (
        <div className="map-error" role="alert">
          <span>Some map data failed to load: {[...mapErrors].join(', ')}. What you see may be incomplete; it does not mean there is no data.</span>
          <button type="button" className="link" onClick={() => setMapErrors(new Set())}>Dismiss</button>
        </div>
      )}

      {missingId && (
        <div className="map-error" role="status" style={mapErrors.size > 0 ? { top: 'auto', bottom: 'var(--sp-4, 16px)' } : undefined}>
          <span>{`The linked investigation "${missingId}" was not found.`}</span>
          <button type="button" className="link" onClick={() => setMissingId(null)}>Dismiss</button>
        </div>
      )}

      {selected && mode === 'swipe' && (
        <>
          <div
            ref={handleRef}
            className="swipe-handle"
            onPointerDown={onSwipeDown}
            onPointerMove={onSwipeMove}
            onPointerUp={onSwipeUp}
            onPointerCancel={onSwipeUp}
            role="slider"
            aria-label="Swipe between before and after"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={swipePct}
            aria-valuetext={`${swipePct} percent before, ${100 - swipePct} percent after`}
            aria-orientation="horizontal"
            tabIndex={0}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 96 : 24;
              const to =
                e.key === 'ArrowLeft' ? swipeX.current - step
                : e.key === 'ArrowRight' ? swipeX.current + step
                : e.key === 'Home' ? 0
                : e.key === 'End' ? freeWidth()
                : null;
              if (to === null) return;
              e.preventDefault(); // keep the arrows from also panning the map / scrolling the page
              moveSwipe(to, true);
            }}
          >
            <div className="grip">⇔</div>
          </div>
          {before && <div className="map-tag swipe-before">BEFORE · {layerLabel(before)}</div>}
          {after && <div className="map-tag swipe-after">AFTER · {layerLabel(after)}</div>}
        </>
      )}
      {selected && mode === 'side' && (
        <>
          {before && <div className="map-tag side-before">BEFORE · {layerLabel(before)}</div>}
          {after && <div className="map-tag side-after">AFTER · {layerLabel(after)}</div>}
        </>
      )}
      {selected && mode === 'overlay' && before && after && (
        <div className="map-tag side-before">
          BEFORE {layerLabel(before)} · AFTER {layerLabel(after)} at {Math.round(overlayOpacity * 100)}%
        </div>
      )}

      {lensOn && (
        <SarLens
          rootRef={appRef}
          geometry={lensGeometry}
          full={lensFull}
          label={lensInfo.label}
          note={lensInfo.note}
          provenance={lensInfo.provenance}
          attribution={SAR_LENS_SOURCE.attribution}
          choice={lensChoiceProp}
          insetRight={insetRight}
          insetBottom={insetBottom}
          onFull={setLensFull}
          onClose={closeLens}
        />
      )}

      {coverageMode && !selected && (
        <div className="hint" role="status">
          Coverage probe on: click anywhere on the globe
        </div>
      )}

      {inspectMode && !selected && (
        <div className="hint" role="status">
          Inspect area on: drag a box on the globe, or click a place
        </div>
      )}

      {popover === 'investigations' && <InvestigationsMenu events={events} selectedId={selectedId} onSelect={selectEvent} onClose={closePopover} />}
      {popover === 'layers' && <LayersPanel layers={catalogLayers} state={layerState} level={level} onChange={onLayerChange} onClose={closePopover} error={layersError} />}
      {popover === 'filters' && (
        <Filters
          events={events}
          context={mapContext}
          visible={visible}
          showContext={showContext}
          activeCatalogs={activeCatalogs}
          catalogCounts={catalogCounts}
          catalogErrors={catalogErrors}
          catalogRetrieved={catalogRetrieved}
          catalogLimits={catalogLimits}
          contextError={contextError}
          onToggleCatalog={onToggleCatalog}
          years={years}
          onYears={setYears}
          onSetVisible={onSetVisible}
          onShowContext={setShowContext}
          onClose={closePopover}
        />
      )}

      {!panelOpen && <InvestigationStrip events={events} onSelect={selectEvent} />}

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
          onClose={closePanel}
          onToggleCollapsed={toggleCollapsed}
        />
      ) : panelView === 'context' && ctxSel ? (
        <ContextPanel key={ctxSel.id} event={ctxSel} collapsed={panelCollapsed} onCheckCoverage={runCoverage} onClose={closePanel} onToggleCollapsed={toggleCollapsed} />
      ) : panelView === 'inspect' && inspectBox ? (
        <InspectPanel
          box={inspectBox}
          context={mapContext}
          events={events}
          collapsed={panelCollapsed}
          onSelectEvent={selectEvent}
          onSelectContext={selectContext}
          onCheckCoverage={runCoverage}
          onClose={closePanel}
          onToggleCollapsed={toggleCollapsed}
        />
      ) : panelView === 'assistant' ? (
        <AssistantSidePanel mapView={mapView} collapsed={panelCollapsed} onToggleCollapsed={toggleCollapsed} onClose={closePanel} />
      ) : panelView === 'about' || panelView === 'probe' ? (
        <IntroPanel
          events={events}
          generated={generated}
          coverage={panelView === 'probe' ? coverage : null}
          coverageState={panelView === 'probe' ? coverageState : 'idle'}
          coverageError={coverageError}
          coverageMode={coverageMode}
          probe={panelView === 'probe' ? probe : null}
          collapsed={panelCollapsed}
          onSelect={selectEvent}
          onCoverageMode={setCoverageMode}
          onClearCoverage={closePanel}
          selectedScene={coverageScene}
          onSelectScene={setCoverageScene}
          onToggleCollapsed={toggleCollapsed}
          onClose={closePanel}
          onShowIntro={showIntro}
          onShowFront={showFront}
          onShowTutorial={startTutorial}
        />
      ) : null}

      {selected && <Timeline event={selected} before={before} after={after} slot={slot} onSlot={setSlot} onPick={onTimelinePick} />}

      {introOpen && <Welcome onClose={closeIntro} onCredits={introCredits} />}
      {tutorialOn && !frontOpen && !introOpen && <Tutorial key={tutorialRun} state={tutorialState} onEnd={endTutorial} />}
    </div>
    {frontOpen && <FrontPage onStart={startFromFront} onTutorial={startTutorial} />}
    </>
  );
}

