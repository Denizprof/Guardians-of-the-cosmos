// WHAT IF? Planetary Simulation Lab: pick an event, a place on the globe and parameters; validate; run the engine.
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ASYNC, CATEGORIES, ENGINES, runAsync, runSimulation } from '../../sim/registry';
import { simStore } from '../../sim/store';
import { HISTORICAL_IMPACTS } from '../../sim/history';
import { VOLCANOES } from '../../sim/parse';
import { COMPOSITION_DENSITY } from '../../sim/impact';
import { topicForCategory } from '../../sim/helpContent';
import type { SimCategory, ValidationIssue } from '../../sim/types';
import { IconChevron, IconClose } from '../icons';
import LazySection from '../LazySection';
import SimResults from './SimResults';
import './sim.css';

const loadAssistantPanel = () => import('../../assistant/AssistantPanel').then((m) => ({ default: m.AssistantPanel }));

export interface SimLabProps {
  collapsed: boolean;
  picking: boolean;
  picked: { lat: number; lon: number; nonce: number } | null;
  simT: number;
  onPicking: (on: boolean) => void;
  onFly: (lat: number, lon: number, zoom: number) => void;
  onToggleCollapsed: () => void;
  onClose: () => void;
  /** Open the guide at a topic (an event id, "results", "time", "words"…). */
  onHelp: (topic: string) => void;
  /** A ready-made scenario from the guide: fills the form (nothing is run). */
  tryExample: { category: SimCategory; params: Record<string, unknown>; nonce: number } | null;
}

const defaultsFor = (c: SimCategory): Record<string, unknown> => {
  const e = ENGINES[c];
  if (!e) return {};
  return Object.fromEntries([...e.params.map((p) => [p.key, p.default]), ...e.choices.map((x) => [x.key, x.default])]);
};

function SimLab({ collapsed, picking, picked, simT, onPicking, onFly, onToggleCollapsed, onClose, onHelp, tryExample }: SimLabProps) {
  const store = useSyncExternalStore(simStore.subscribe, simStore.get);
  const active = store.scenarios.find((s) => s.id === store.activeId);
  const [category, setCategory] = useState<SimCategory>(active?.category ?? 'impact');
  const [params, setParams] = useState<Record<string, unknown>>(() => ({ ...defaultsFor('impact'), lat: 41.0082, lon: 28.9784, label: 'Istanbul' }));
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const engine = ENGINES[category];
  const info = CATEGORIES.find((c) => c.category === category)!;

  useEffect(() => {
    if (!picked) return;
    setParams((p) => ({ ...p, lat: Number(picked.lat.toFixed(4)), lon: Number(picked.lon.toFixed(4)), label: undefined }));
    onPicking(false);
  }, [picked, onPicking]);

  // a scenario run elsewhere (the assistant) becomes the form's starting point
  useEffect(() => {
    if (!active) return;
    setCategory(active.category);
    setParams({ ...defaultsFor(active.category), ...active.params });
  }, [active]);

  // an example chosen in the guide fills the form; the visitor decides when to run it. It is declared after the
  // effect above so that, when the Lab opens with a stored run, the example still wins.
  useEffect(() => {
    if (!tryExample) return;
    setCategory(tryExample.category);
    setIssues([]);
    setParams({ ...defaultsFor(tryExample.category), ...tryExample.params });
    const { lat, lon } = tryExample.params;
    if (typeof lat === 'number' && typeof lon === 'number') onFly(lat, lon, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tryExample?.nonce]);

  const set = useCallback((k: string, v: unknown) => {
    setParams((p) => {
      const next = { ...p, [k]: v };
      if (k === 'lat' || k === 'lon') next.label = undefined; // typed coordinates no longer match the named place
      if (k === 'composition' && v !== 'custom') next.density = COMPOSITION_DENSITY[v as keyof typeof COMPOSITION_DENSITY];
      if (k === 'density') next.composition = 'custom';
      return next;
    });
  }, []);

  const run = useCallback((override?: Record<string, unknown>, name?: string, forced?: SimCategory) => {
    const cat = forced ?? category;
    const p = override ?? params;
    if (ASYNC.has(cat)) {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setIssues([]);
      const what = cat === 'tsunami' ? 'sea-floor depths' : cat === 'volcano' ? 'terrain and winds aloft' : cat === 'wildfire' ? 'terrain and current weather' : cat === 'climate' ? 'the world land mask' : 'elevation data';
      const solving = cat === 'volcano' ? 'Settling ash through the wind field' : cat === 'wildfire' ? 'Spreading the fire front' : cat === 'climate' ? 'Running the energy-balance model' : 'Solving the shallow-water equations';
      setBusy(`Loading ${what}…`);
      void runAsync(cat, p, { signal: ac.signal, onProgress: (stage, f) => setBusy(stage === 'dem' ? `Loading ${what}…` : `${solving}… ${Math.round(f * 100)}%`) })
        .then((res) => {
          if (!res.ok) { setIssues(res.issues); return; }
          simStore.add({ category: cat, params: p, result: res.result, ...(name ? { name } : {}) });
          onFly(res.result.location.lat, res.result.location.lon, cat === 'tsunami' ? 4 : cat === 'volcano' ? 6 : cat === 'wildfire' ? 11 : cat === 'climate' ? 1.6 : 10.5);
        })
        .catch((e: unknown) => { if (!(e instanceof DOMException && e.name === 'AbortError')) setIssues([{ field: 'engine', message: e instanceof Error ? e.message : 'The run failed' }]); })
        .finally(() => { if (abort.current === ac) { abort.current = null; setBusy(null); } });
      return;
    }
    const res = runSimulation(cat, p);
    if (!res.ok) { setIssues(res.issues); return; }
    setIssues([]);
    simStore.add({ category: cat, params: p, result: res.result, ...(name ? { name } : {}) });
    onFly(res.result.location.lat, res.result.location.lon, 5);
  }, [category, params, onFly]);

  const err = useMemo(() => Object.fromEntries(issues.map((i) => [i.field, i.message])), [issues]);
  const changeCategory = (c: SimCategory) => { setCategory(c); setIssues([]); setParams((p) => ({ ...defaultsFor(c), lat: p.lat, lon: p.lon, label: p.label })); };

  return (
    <section className={`panel sim-lab${collapsed ? ' collapsed' : ''}`} aria-label="Planetary Simulation Lab">
      <header className="panel-head">
        <div className="kicker">
          <span className="kicker-text">WHAT IF? · Planetary Simulation Lab</span>
          <button type="button" className="btn small" onClick={() => onHelp(topicForCategory(category))} aria-label="Open the guide: what everything means" title="What every circle, colour and setting means, with animations">? Guide</button>
          <button className="close mobile-only" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}><IconChevron up={collapsed} /></button>
          <button className="close" onClick={onClose} aria-label="Close panel"><IconClose /></button>
        </div>
        <h2>Simulate what could happen</h2>
        <p className="muted small">Real equations from the scientific literature, computed in your browser. Every result is a hypothetical simulation.</p>
      </header>
      <div className="panel-body">
        <div className="section">
          <label className="sim-field">
            <span>Event</span>
            <select className="layer-select" value={category} onChange={(e) => changeCategory(e.target.value as SimCategory)}>
              {CATEGORIES.map((c) => <option key={c.category} value={c.category} disabled={c.status !== 'available'}>{c.label}{c.status === 'planned' ? ' (planned)' : ''}</option>)}
            </select>
          </label>
          {info.status === 'planned' && <p className="muted small">{info.plan}</p>}
          <p className="small"><button type="button" className="link" onClick={() => onHelp(topicForCategory(category))}>New here? Open the guide with animations for this event</button></p>
          <details className="small sim-planned">
            <summary>Planned engines</summary>
            <ul>{CATEGORIES.filter((c) => c.status === 'planned').map((c) => <li key={c.category}><b>{c.label}</b>: {c.plan}</li>)}</ul>
          </details>
        </div>

        {engine && (
          <form className="section sim-form" onSubmit={(e) => { e.preventDefault(); run(); }} noValidate>
            <fieldset>
              <legend>Location</legend>
              <div className="sim-row">
                <label className="sim-field"><span>Latitude</span><input type="number" step="0.0001" value={String(params.lat ?? '')} onChange={(e) => set('lat', e.target.value)} aria-invalid={!!err.lat} /></label>
                <label className="sim-field"><span>Longitude</span><input type="number" step="0.0001" value={String(params.lon ?? '')} onChange={(e) => set('lon', e.target.value)} aria-invalid={!!err.lon} /></label>
              </div>
              {(err.lat || err.lon) && <p className="sim-error" role="alert">{err.lat ?? err.lon}</p>}
              <button type="button" className="btn" aria-pressed={picking} onClick={() => onPicking(!picking)}>{picking ? 'Click the globe…' : 'Pick on the globe'}</button>
              {typeof params.label === 'string' && params.label && <span className="muted small"> {params.label}</span>}
            </fieldset>
            <fieldset>
              <legend>Parameters</legend>
              {engine.choices.map((c) => (
                <label key={c.key} className="sim-field"><span>{c.label}</span>
                  <select className="layer-select" value={String(params[c.key] ?? c.default)} onChange={(e) => set(c.key, e.target.value)}>
                    {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              ))}
              {engine.params.filter((p) => p.key !== 'waterDepth' || params.target === 'water').map((p) => (
                <label key={p.key} className="sim-field" title={p.help}>
                  <span>{p.label} <span className="muted">({p.unit})</span></span>
                  <input type="number" min={p.min} max={p.max} step={p.step} value={String(params[p.key] ?? p.default)} onChange={(e) => set(p.key, e.target.value)} aria-invalid={!!err[p.key]} aria-describedby={err[p.key] ? `err-${p.key}` : undefined} />
                  {err[p.key] && <span id={`err-${p.key}`} className="sim-error" role="alert">{err[p.key]}</span>}
                  {p.help && <span className="muted small">{p.help}</span>}
                </label>
              ))}
            </fieldset>
            {err.engine && <p className="sim-error" role="alert">{err.engine}</p>}
            <button type="submit" className="btn primary" disabled={!!busy}>Validate and run</button>
            {busy && (
              <p className="small" role="status">{busy} <button type="button" className="link" onClick={() => abort.current?.abort()}>Cancel</button></p>
            )}
            {category === 'flood' && <p className="muted small">Uses real terrain (AWS Terrain Tiles) and runs in the background; the globe stays usable.</p>}
            {category === 'climate' && <p className="muted small">A simple climate model driven by an emissions scenario (SSP). The map covers the whole Earth; the numbers are for the point you chose. It is a scenario, not a forecast.</p>}
            {category === 'wildfire' && <p className="muted small">Uses real terrain (slope) and, unless you choose to enter values by hand, the current wind, humidity and temperature at the ignition point (Open-Meteo). The fire starts at the chosen point and runs in the background.</p>}
            {category === 'volcano' && <p className="muted small">Uses real terrain (vent height and pyroclastic-flow reach) and current winds aloft at up to 15 pressure levels (Open-Meteo), and runs in the background.</p>}
            {category === 'tsunami' && <p className="muted small">Uses real sea-floor depths (AWS Terrain Tiles: ETOPO1 / SRTM15+) and runs in the background. Put the epicentre offshore on a subduction trench, with the strike along the trench.</p>}
          </form>
        )}

        {category === 'volcano' && (
          <div className="section">
            <h3 className="small">Pick a volcano</h3>
            <div className="sim-scenarios">
              {VOLCANOES.map((v) => (
                <span key={v.name} className="sim-chip">
                  <button type="button" aria-pressed={params.lat === v.lat && params.lon === v.lon} onClick={() => { setParams((p) => ({ ...p, lat: v.lat, lon: v.lon, label: v.name })); onFly(v.lat, v.lon, 8); }}>{v.name}</button>
                </span>
              ))}
            </div>
            <p className="muted small">Summit coordinates from the Smithsonian Global Volcanism Program. The vent height is read from the terrain.</p>
          </div>
        )}

        {category === 'impact' && (
          <div className="section">
            <h3 className="small">Earth through time: known impacts</h3>
            <ul className="sim-history">
              {HISTORICAL_IMPACTS.map((h) => (
                <li key={h.id}>
                  <button type="button" className="link" onClick={() => onFly(h.lat, h.lon, 6)}>{h.name}</button>
                  <span className="muted small"> · {h.age} · <span className={`ev ev-${h.evidence}`}>{h.evidence === 'historical-record' ? 'historical record' : 'scientific reconstruction'}</span></span>
                  <div className="small">{h.observed} <a href={h.source.url} target="_blank" rel="noreferrer">Source</a></div>
                  {h.params && <button type="button" className="btn small" onClick={() => { const p = { ...defaultsFor('impact'), ...h.params, lat: h.lat, lon: h.lon, label: h.name }; setParams(p); run(p, `${h.name} (model check)`); }}>Re-run with published estimates</button>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {store.scenarios.length > 0 && (
          <div className="section">
            <div className="sim-scenarios" role="group" aria-label="Scenarios">
              {store.scenarios.map((s) => (
                <span key={s.id} className="sim-chip">
                  <button type="button" aria-pressed={s.id === store.activeId} onClick={() => simStore.setActive(s.id)} title={s.result.title}>{s.name}</button>
                  <button type="button" aria-label={`Remove ${s.name}`} onClick={() => simStore.remove(s.id)}>×</button>
                </span>
              ))}
            </div>
            {active && <SimResults result={active.result} scenarios={store.scenarios} activeId={store.activeId} simT={simT} onHelp={onHelp} />}
          </div>
        )}

        {active?.category === 'climate' && (() => {
          const sl = active.result.outputs.find((o) => o.id === 'gmsl');
          if (!sl) return null;
          const metres = Math.min(10, Math.max(0.1, Math.round(sl.value * 10) / 10));
          return (
            <div className="section">
              <h3 className="small">What would that sea level do to the coast here?</h3>
              <button type="button" className="btn" disabled={!!busy} onClick={() => run({ ...defaultsFor('flood'), lat: active.params.lat, lon: active.params.lon, label: active.params.label, seaLevel: metres, rainfall: 0, duration: 0 }, `Sea +${metres} m (${active.name})`, 'flood')}>Show a coastal flood map for +{metres} m of sea level</button>
              <p className="muted small">Uses the flood engine on real terrain with the sea raised by the projected global sea-level rise ({metres} m). Storm surges, tides and local land movement are not included, so treat it as a rough picture of exposure.</p>
            </div>
          );
        })()}

        <div className="section">
          <details data-ask>
            <summary>Ask the Global SAR AI about this simulation</summary>
            <LazySection load={loadAssistantPanel} fallback={<p className="muted small" role="status">Loading the assistant…</p>}>
              {(AssistantPanel) => <AssistantPanel event={null} variant="inline" />}
            </LazySection>
          </details>
        </div>
      </div>
    </section>
  );
}

export default memo(SimLab);
