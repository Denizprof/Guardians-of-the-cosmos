import type { CompareMode, SarEvent, SarLayer } from '../types';
import { CATEGORY_COLOR, CATEGORY_LABEL, EVIDENCE_LABEL, evidenceOf, safeHref, fmtCoord, fmtDate, fmtDateTime, fmtEventDate, layerLabel } from '../lib';
import { CONCEPTS, EVENT_CONTENT } from '../content/explain';
import { Suspense, lazy, memo, useState } from 'react';
import { IconChevron, IconClose } from './icons';
import WeatherSection from './WeatherSection';

// Both talk to live services and are only needed when the reader asks for them: keep them out of the first paint.
const AssistantPanel = lazy(() => import('../assistant/AssistantPanel').then((m) => ({ default: m.AssistantPanel })));
const EarthdataPanel = lazy(() => import('./EarthdataPanel'));

interface Props {
  event: SarEvent;
  before: SarLayer | null;
  after: SarLayer | null;
  mode: CompareMode;
  overlayOpacity: number;
  level: 'simple' | 'scientific';
  activePin: string | null;
  collapsed: boolean;
  onMode: (m: CompareMode) => void;
  onBefore: (id: string) => void;
  onAfter: (id: string) => void;
  onOpacity: (v: number) => void;
  onLevel: (l: 'simple' | 'scientific') => void;
  onPin: (id: string | null) => void;
  onClose: () => void;
  onToggleCollapsed: () => void;
}

const KIND_LABEL: Record<string, string> = {
  los: 'LOS displacement (cm)',
  backscatter: 'HH backscatter (dB)',
  change: 'change (dB)',
  water: 'water mask',
  coherence: 'coherence',
};

const PRODUCT_NAME: Record<string, string> = {
  GCOV: 'L2 GCOV · geocoded backscatter',
  GUNW: 'L2 GUNW · geocoded unwrapped interferogram',
};

function ObsRow({ slot, layer, layers, onPick }: { slot: 'B' | 'A'; layer: SarLayer | null; layers: SarLayer[]; onPick: (id: string) => void }) {
  return (
    <div className="obs">
      <span className={`slot ${slot.toLowerCase()}`}>{slot === 'B' ? 'BEFORE' : 'AFTER'}</span>
      <select className="layer-select" value={layer?.id ?? ''} onChange={(e) => onPick(e.target.value)} aria-label={slot === 'B' ? 'Before observation' : 'After observation'}>
        {layers.map((l) => (
          <option key={l.id} value={l.id}>
            {layerLabel(l)}{l.kind !== 'browse' ? ` · ${KIND_LABEL[l.kind] ?? l.kind}` : ''}
          </option>
        ))}
      </select>
      {layer && <span className={`tier ${layer.provenance.tier}`}>{layer.provenance.tier}</span>}
      {layer && (
        <span className="what">
          <span className={`evidence ${evidenceOf(layer)}`} title={EVIDENCE_LABEL[evidenceOf(layer)]}>{EVIDENCE_LABEL[evidenceOf(layer)]}</span>{' '}
          {layer.provenance.mission} {layer.product} · track {layer.provenance.track} {layer.provenance.direction.toLowerCase()} · frame {layer.provenance.frame}
        </span>
      )}
    </div>
  );
}

const RAMPS: Record<string, string> = {
  diverging: 'linear-gradient(90deg,#2166ac,#67a9cf,#f7f7f7,#ef8a62,#b2182b)',
  gray: 'linear-gradient(90deg,#000,#fff)',
};

/** Colour bar for a derived layer: what the colours mean, in physical units. */
function LegendBar({ label, layer }: { label: string; layer: SarLayer }) {
  const lg = layer.legend;
  if (!lg) return null;
  if (lg.colormap === 'composite') {
    // QA-15: three-channel composite has no single ramp; show the channel mapping instead
    return (
      <div className="legend-block">
        <div className="muted">{label}: fixed calibrated composite (same scale every date)</div>
        <div><span className="legend-swatch" style={{ background: 'linear-gradient(90deg,#000,#f0f)' }} />Red + blue = HH, −25 → 0 dB</div>
        <div><span className="legend-swatch" style={{ background: 'linear-gradient(90deg,#000,#0f0)' }} />Green = HV, −32 → −7 dB</div>
      </div>
    );
  }
  if (lg.classes) {
    return (
      <div className="legend-block">
        <div className="muted">{label}: {lg.units}{lg.threshold_db != null ? ` (HH < ${lg.threshold_db} dB)` : ''}</div>
        <div><span className="legend-swatch" style={{ background: 'rgba(120,170,220,0.7)' }} />{lg.classes['1']}</div>
        <div><span className="legend-swatch" style={{ background: '#28a0ff' }} />{lg.classes['2']}</div>
      </div>
    );
  }
  return (
    <div className="legend-scale">
      <div className="muted fine">{label}: {lg.units}</div>
      <div className="legend-scale-bar" style={{ background: RAMPS[lg.colormap ?? 'gray'] }} />
      <div className="row spread mono muted">
        <span>{lg.vmin}</span>
        {lg.colormap === 'diverging' && <span>0</span>}
        <span>{lg.vmax}</span>
      </div>
    </div>
  );
}

/** NASA CMR search is a 5–10 s live query, so it runs only when asked. */
function EarthdataSection({ lon, lat, date }: { lon: number; lat: number; date: string | null }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <>
        <h3>Other NASA data here</h3>
        <p className="muted small">Every NASA dataset covering this place around the event date (optical, thermal, rain, lidar…).</p>
        <button className="btn" onClick={() => setOpen(true)}>Search NASA Earthdata</button>
      </>
    );
  }
  return (
    <Suspense fallback={<p className="muted small" role="status">Loading the NASA Earthdata search…</p>}>
      <EarthdataPanel lon={lon} lat={lat} date={date} windowDays={7} onClose={() => setOpen(false)} />
    </Suspense>
  );
}

function Provenance({ label, layer }: { label: string; layer: SarLayer }) {
  const p = layer.provenance;
  return (
    <details className="prov">
      <summary>
        {label}: {layerLabel(layer)}{' '}
        <span className={`evidence ${evidenceOf(layer)}`}>{EVIDENCE_LABEL[evidenceOf(layer)]}</span>{' '}
        {layer.kind === 'browse' ? <span className="badge raw">NASA browse rendering</span> : <span className="badge derived">computed by team</span>}
      </summary>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Mission</dt>
        <dd>{p.mission} · {p.sensor}</dd>
        <dt>Product</dt>
        <dd>{PRODUCT_NAME[layer.product] ?? layer.product}</dd>
        <dt>Data tier</dt>
        <dd><span className={`tier ${p.tier}`}>{p.tier}</span> <span className="mono faint">{p.crid}</span></dd>
        <dt>Acquired</dt>
        <dd className="mono">
          {layer.acquisition.secondary ? (
            <>
              ref {fmtDateTime(layer.acquisition.reference)}
              <br />
              sec {fmtDateTime(layer.acquisition.secondary)}
            </>
          ) : (
            fmtDateTime(layer.acquisition.start)
          )}
        </dd>
        <dt>Geometry</dt>
        <dd>Track {p.track} · {p.direction.toLowerCase()} · frame {p.frame}{p.polarizations ? ` · ${p.polarizations.join('/')}` : ''}</dd>
        <dt>Granule</dt>
        <dd className="mono">{p.granule}</dd>
        <dt>Processed</dt>
        <dd className="mono">{fmtDate(p.processing_date)} by NISAR SDS</dd>
        <dt>Distributor</dt>
        <dd>{p.distributor} · <a href={safeHref(p.browse_source)} target="_blank" rel="noopener">browse image</a> · <a href={safeHref(p.product_url)} target="_blank" rel="noopener">full product</a> <span className="faint">(Earthdata login)</span></dd>
      </dl>
      <ol>
        {p.processing.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <div className="faint fine">{p.credit}</div>
    </details>
  );
}

/** The assistant checks its gateway as soon as it mounts, so it is mounted only once the reader opens it. */
function AskSection({ event, before, after, onAfter }: { event: SarEvent; before: SarLayer | null; after: SarLayer | null; onAfter: (id: string) => void }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="disclosure" data-ask onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setOpened(true)}>
      <summary>
        <span>Ask about this investigation</span>
        <span className="faint small">Assistant, cites its sources</span>
      </summary>
      {opened && (
        <Suspense fallback={<p className="muted small" role="status">Loading the assistant…</p>}>
          <AssistantPanel event={event} before={before} after={after} onSelectLayer={(id) => (event.layers.some((l) => l.id === id) ? onAfter(id) : undefined)} />
        </Suspense>
      )}
    </details>
  );
}

/**
 * Investigation panel. Reading order: what happened (summary) -> compare controls -> what the radar
 * sees (explanation) -> deeper tools -> provenance and references (collapsed).
 */
function EventPanel(p: Props) {
  const ev = p.event;
  const c = EVENT_CONTENT[ev.id];
  const color = CATEGORY_COLOR[ev.category];
  const sci = p.level === 'scientific';
  const pins = c?.pins ?? [];
  return (
    <section className={`panel${p.collapsed ? ' collapsed' : ''}`} aria-label={`${ev.title} investigation`}>
      <header className="panel-head">
        <div className="kicker">
          <span className="dot" style={{ background: color }} />
          <span className="kicker-text">
            {CATEGORY_LABEL[ev.category]} · {ev.date ? fmtEventDate(ev) : 'date pending'} · <span className="mono">{fmtCoord(ev.location.lon, ev.location.lat)}</span>
          </span>
          <button className="close mobile-only" onClick={p.onToggleCollapsed} aria-label={p.collapsed ? 'Expand panel' : 'Collapse panel'}>
            <IconChevron up={p.collapsed} />
          </button>
          <button className="close" onClick={p.onClose} aria-label="Close investigation">
            <IconClose />
          </button>
        </div>
        <h2>{ev.title}</h2>
        <div className="sub">{ev.subtitle}</div>
      </header>
      <div className="panel-body">
        {c && (
          <div className="section summary">
            <h3>What happened</h3>
            <p>{c.happened.text}</p>
            <div className="faint small">
              Source: <a href={safeHref(c.happened.url)} target="_blank" rel="noopener">{c.happened.source}</a>
            </div>
          </div>
        )}

        <div className="section">
          <div className="row spread">
            <h3>Compare</h3>
            <div className="seg" role="group" aria-label="Comparison mode" data-tut="compare">
              {(['swipe', 'side', 'overlay'] as CompareMode[]).map((m) => (
                <button key={m} aria-pressed={p.mode === m} onClick={() => p.onMode(m)}>
                  {m === 'swipe' ? 'Swipe' : m === 'side' ? 'Side by side' : 'Overlay'}
                </button>
              ))}
            </div>
          </div>
          <ObsRow slot="B" layer={p.before} layers={ev.layers} onPick={p.onBefore} />
          <ObsRow slot="A" layer={p.after} layers={ev.layers} onPick={p.onAfter} />
          {p.before?.legend && <LegendBar label="Before" layer={p.before} />}
          {p.after?.legend && p.after.legend.units !== p.before?.legend?.units && <LegendBar label="After" layer={p.after} />}
          {p.after?.legend && p.after.legend.units === p.before?.legend?.units && p.after.legend.vmax !== p.before?.legend?.vmax && <LegendBar label="After" layer={p.after} />}
          {p.mode === 'overlay' && (
            <label className="opacity-control">
              <span className="muted small">After opacity {Math.round(p.overlayOpacity * 100)}%</span>
              <input type="range" min={0} max={1} step={0.01} value={p.overlayOpacity} onChange={(e) => p.onOpacity(parseFloat(e.target.value))} />
            </label>
          )}
          {ev.technique === 'insar' && (
            <div className="callout">
              An interferogram is already a change measurement: it records motion between its two dates. Compare a pair that spans the event with one that doesn’t.
            </div>
          )}
        </div>

        {c && (
          <div className="section explain">
            <div className="row spread">
              <h3>What the radar sees</h3>
              <div className="seg" role="group" aria-label="Explanation level" data-tut="level">
                <button aria-pressed={!sci} onClick={() => p.onLevel('simple')}>Simple</button>
                <button aria-pressed={sci} onClick={() => p.onLevel('scientific')}>Scientific</button>
              </div>
            </div>
            <ul>
              {(sci ? c.readScientific : c.readSimple).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <h4>Legend</h4>
            {c.legend.map((l, i) => (
              <div key={i} className="legend-line">
                <span className="legend-swatch" style={{ background: l.swatch, width: l.swatch.includes('gradient') ? 40 : 12 }} />
                {l.label}
              </div>
            ))}
            {pins.length > 0 && (
              <>
                <h4>Look closer</h4>
                {pins.map((pin, i) => {
                  const active = p.activePin === pin.id;
                  return (
                    <div key={pin.id} className="pin-row">
                      <button className="pin-toggle" onClick={() => p.onPin(active ? null : pin.id)} aria-expanded={active}>
                        <span className={`pin-num${active ? ' active' : ''}`}>{i + 1}</span>
                        <span>{pin.label}</span>
                      </button>
                      {active && <p>{sci ? pin.scientific : pin.simple}</p>}
                    </div>
                  );
                })}
              </>
            )}
            {c.caveats.map((t, i) => (
              <div key={i} className={`callout${i === 0 ? ' warn' : ''}`}>{t}</div>
            ))}
          </div>
        )}

        <div className="section explain">
          <details className="disclosure">
            <summary>
              <span>Radar basics</span>
              <span className="faint small">{CONCEPTS.length} short explainers</span>
            </summary>
            {CONCEPTS.map((k) => (
              <details key={k.id} className="concept">
                <summary>{k.title}</summary>
                <p>{sci ? k.scientific : k.simple}</p>
              </details>
            ))}
          </details>
        </div>

        <div className="section">
          <EarthdataSection key={ev.id} lon={ev.location.lon} lat={ev.location.lat} date={ev.date} />
        </div>

        <div className="section">
          <WeatherSection key={ev.id} lon={ev.location.lon} lat={ev.location.lat} date={ev.date} />
        </div>

        <div className="section">
          <AskSection key={ev.id} event={ev} before={p.before} after={p.after} onAfter={p.onAfter} />
        </div>

        <div className="section">
          <h3>Data provenance</h3>
          {p.before && <Provenance label="Before" layer={p.before} />}
          {p.after && p.after.id !== p.before?.id && <Provenance label="After" layer={p.after} />}
        </div>

        <div className="section">
          <h3>References</h3>
          <ul className="refs">
            {ev.references.map((r) => (
              <li key={r.url}>
                <a href={safeHref(r.url)} target="_blank" rel="noopener">{r.label}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default memo(EventPanel);

