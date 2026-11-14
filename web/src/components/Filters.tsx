import type { Category, ContextEvent, SarEvent } from '../types';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../lib';

interface Props {
  events: SarEvent[];
  context: ContextEvent[];
  visible: Set<Category>;
  showContext: boolean;
  open: boolean;
  onToggle: (c: Category) => void;
  onShowContext: (v: boolean) => void;
  onSelect: (id: string) => void;
}

const ORDER: Category[] = ['earthquake', 'flood', 'volcano', 'wildfire', 'landslide'];

export default function Filters({ events, context, visible, showContext, open, onToggle, onShowContext, onSelect }: Props) {
  return (
    <aside className={`filters${open ? ' open' : ''}`} aria-label="Map filters">
      <h3>Event types</h3>
      {ORDER.map((c) => {
        const n = context.filter((e) => e.category === c).length + events.filter((e) => e.category === c).length;
        return (
          <label key={c}>
            <input type="checkbox" checked={visible.has(c)} onChange={() => onToggle(c)} />
            <span className="dot" style={{ background: CATEGORY_COLOR[c] }} />
            {CATEGORY_LABEL[c]}
            <span className="count">{n}</span>
          </label>
        );
      })}
      <label style={{ marginTop: 6 }}>
        <input type="checkbox" checked={showContext} onChange={(e) => onShowContext(e.target.checked)} />
        Recent events (past 12 months)
      </label>
      <div className="legend-note">
        <div className="row" style={{ gap: 8 }}>
          <span className="dot ring" style={{ color: '#e7e9ec' }} /> NISAR radar analysis available
        </div>
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <span className="dot" style={{ background: '#8b94a1' }} /> Context only (USGS, NASA EONET)
        </div>
      </div>
      <div className="featured">
        <h3>Radar investigations</h3>
        {events.map((e) => (
          <button key={e.id} onClick={() => onSelect(e.id)}>
            <span className="dot" style={{ background: CATEGORY_COLOR[e.category] }} />
            <span>
              <span className="t">{e.title}</span>
              <br />
              <span className="s">{CATEGORY_LABEL[e.category]} · {e.layers.length} NISAR scenes</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
