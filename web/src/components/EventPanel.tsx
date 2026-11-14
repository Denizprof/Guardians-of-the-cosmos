import type { CompareMode, SarEvent, SarLayer } from '../types';
import { CATEGORY_COLOR, CATEGORY_LABEL, fmtCoord, fmtDate, fmtDateTime, layerLabel } from '../lib';
import { CONCEPTS, EVENT_CONTENT } from '../content/explain';

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
          NISAR {layer.product} · track {layer.provenance.track} {layer.provenance.direction.toLowerCase()} · frame {layer.provenance.frame}
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
  if (lg.classes) {
    return (
      <div style={{ marginTop: 8, fontSize: 12.5 }}>
        <div className="muted">{label}: {lg.units}{lg.threshold_db != null ? ` (HH < ${lg.threshold_db} dB)` : ''}</div>
        <div><span className="legend-swatch" style={{ background: 'rgba(120,170,220,0.7)' }} />{lg.classes['1']}</div>
        <div><span className="legend-swatch" style={{ background: '#28a0ff' }} />{lg.classes['2']}</div>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}: {lg.units}</div>
      <div style={{ height: 10, borderRadius: 2, background: RAMPS[lg.colormap ?? 'gray'], border: '1px solid var(--line-2)' }} />
      <div className="row spread mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
        <span>{lg.vmin}</span>
        {lg.colormap === 'diverging' && <span>0</span>}
        <span>{lg.vmax}</span>
      </div>
    </div>
  );
}

function Provenance({ label, layer }: { label: string; layer: SarLayer }) {
  const p = layer.provenance;
  return (
    <details className="prov">
      <summary>
        {label}: {layerLabel(layer)}{' '}
        {layer.kind === 'browse' ? <span className="badge raw">NASA browse</span> : <span className="badge derived">derived by team</span>}
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
        <dd className="mono" style={{ fontSize: 11 }}>{p.granule}</dd>
        <dt>Processed</dt>
        <dd className="mono">{fmtDate(p.processing_date)} by NISAR SDS</dd>
        <dt>Distributor</dt>
        <dd>{p.distributor} · <a href={p.browse_source} target="_blank" rel="noopener">browse image</a> · <a href={p.product_url} target="_blank" rel="noopener">full product</a> <span className="faint">(Earthdata login)</span></dd>
      </dl>
      <ol>
        {p.processing.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <div className="faint" style={{ fontSize: 12 }}>{p.credit}</div>
    </details>
  );
}

export default function EventPanel(p: Props) {
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
          {CATEGORY_LABEL[ev.category]} · {ev.date ? fmtDate(ev.date) : 'date pending'} · <span className="mono">{fmtCoord(ev.location.lon, ev.location.lat)}</span>
          <button className="close mobile-only" onClick={p.onToggleCollapsed} aria-label={p.collapsed ? 'Expand panel' : 'Collapse panel'}>{p.collapsed ? '▴' : '▾'}</button>
          <button className="close" onClick={p.onClose} aria-label="Close investigation">×</button>
        </div>
        <h2>{ev.title}</h2>
        <div className="sub">{ev.subtitle}</div>
      </header>
      <div className="panel-body">
        {c && (
          <div className="section">
            <h3>What happened</h3>
            <p>{c.happened.text}</p>
            <div className="faint" style={{ fontSize: 12 }}>
              Source: <a href={c.happened.url} target="_blank" rel="noopener">{c.happened.source}</a>
            </div>
          </div>
        )}

        <div className="section">
          <div className="row spread">
            <h3 style={{ margin: 0 }}>Compare</h3>
            <div className="seg" role="group" aria-label="Comparison mode">
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
            <label style={{ display: 'block', marginTop: 10 }}>
              <span className="muted" style={{ fontSize: 12 }}>After opacity {Math.round(p.overlayOpacity * 100)}%</span>
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
              <h3 style={{ margin: 0 }}>What the radar sees</h3>
              <div className="seg" role="group" aria-label="Explanation level">
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
              <div key={i} style={{ fontSize: 13, margin: '3px 0' }}>
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
                    <div key={pin.id} style={{ margin: '6px 0' }}>
                      <button
                        onClick={() => p.onPin(active ? null : pin.id)}
                        aria-expanded={active}
                        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left' }}
                      >
                        <span className={`pin${active ? ' active' : ''}`} style={{ width: 20, height: 20, fontSize: 11 }}>{i + 1}</span>
                        <span style={{ fontWeight: 500 }}>{pin.label}</span>
                      </button>
                      {active && <p style={{ margin: '6px 0 0 28px' }}>{sci ? pin.scientific : pin.simple}</p>}
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
          <h3>Radar basics</h3>
          {CONCEPTS.map((k) => (
            <details key={k.id} style={{ margin: '4px 0' }}>
              <summary style={{ cursor: 'pointer' }}>{k.title}</summary>
              <p style={{ marginTop: 6 }}>{sci ? k.scientific : k.simple}</p>
            </details>
          ))}
        </div>

        <div className="section">
          <h3>Data provenance</h3>
          {p.before && <Provenance label="Before" layer={p.before} />}
          {p.after && p.after.id !== p.before?.id && <Provenance label="After" layer={p.after} />}
        </div>

        <div className="section">
          <h3>References</h3>
          <ul className="refs" style={{ paddingLeft: 18, margin: 0 }}>
            {ev.references.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noopener">{r.label}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
