import { useState } from 'react';
import type { CatalogLayer } from '../layers';
import { clampDate, defaultDate, isSubDaily } from '../layers';
import { EVIDENCE_LABEL, GROUPS } from '../lib';

export interface LayerState {
  on: boolean;
  opacity: number;
  date: string | null;
}

interface Props {
  layers: CatalogLayer[];
  state: Record<string, LayerState>;
  level: 'simple' | 'scientific';
  onChange: (id: string, s: LayerState) => void;
  onClose: () => void;
}

export default function LayersPanel({ layers, state, level, onChange, onClose }: Props) {
  const [info, setInfo] = useState<string | null>(null);
  const get = (l: CatalogLayer): LayerState => state[l.id] ?? { on: false, opacity: 0.85, date: defaultDate(l) };

  return (
    <aside className="filters layers-panel" aria-label="Satellite layers">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>Satellite layers</h3>
        <button className="close" onClick={onClose} aria-label="Close satellite layers">×</button>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 8px' }}>
        Global datasets from NASA, ESA and partners, each live-checked. They show conditions, not a specific event.
      </p>
      {layers.length === 0 && <p className="muted">Layer catalog not available.</p>}
      {GROUPS.map((g) => {
        const ls = layers.filter((l) => l.category === g.id);
        if (!ls.length) return null;
        return (
          <div key={g.id} style={{ marginBottom: 8 }}>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <span className="dot" style={{ background: g.color }} />
              <b style={{ fontSize: 12.5 }}>{g.label}</b>
            </div>
            {ls.map((l) => {
              const s = get(l);
              return (
                <div key={l.id} className="layer-item">
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <label style={{ flex: 1 }}>
                      <input type="checkbox" checked={s.on} onChange={() => onChange(l.id, { ...s, on: !s.on })} />
                      {l.title}
                    </label>
                    <button className="expand" aria-expanded={info === l.id} aria-label={`About ${l.title}`} onClick={() => setInfo(info === l.id ? null : l.id)}>i</button>
                  </div>
                  {s.on && (
                    <div className="layer-controls">
                      {l.time && isSubDaily(l) && <span className="mono muted" style={{ fontSize: 11 }}>latest ({l.time.step.replace('PT', '')})</span>}
                      {l.time && !isSubDaily(l) && (
                        <input
                          type="date"
                          className="year"
                          style={{ width: 130 }}
                          value={s.date ?? ''}
                          min={l.time.start}
                          max={clampDate(l, '9999-12-31')}
                          aria-label={`${l.title} date`}
                          onChange={(e) => onChange(l.id, { ...s, date: e.target.value ? clampDate(l, e.target.value) : defaultDate(l) })}
                        />
                      )}
                      <input
                        type="range" min={0.1} max={1} step={0.05} value={s.opacity} aria-label={`${l.title} opacity`}
                        onChange={(e) => onChange(l.id, { ...s, opacity: parseFloat(e.target.value) })}
                      />
                    </div>
                  )}
                  {info === l.id && (
                    <div className="layer-info">
                      <span className={`evidence ${l.kind}`}>{EVIDENCE_LABEL[l.kind]}</span>
                      <p>{level === 'scientific' ? l.description_scientific : l.description_simple}</p>
                      <dl className="kv" style={{ gridTemplateColumns: '84px 1fr', fontSize: 12 }}>
                        <dt>Source</dt><dd>{l.provider} · {l.mission} {l.sensor}</dd>
                        <dt>Resolution</dt><dd>{l.resolution}</dd>
                        {l.time && (<><dt>Time</dt><dd className="mono">{l.time.start} → {l.time.end} ({l.time.step})</dd></>)}
                        <dt>Licence</dt><dd>{l.license}</dd>
                        <dt>Checked</dt><dd className="mono">{l.verified.date} · HTTP {l.verified.status}</dd>
                      </dl>
                      <div className="callout">{l.limitations}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
}
