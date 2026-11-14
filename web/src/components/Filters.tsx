import { useState } from 'react';
import type { Category, ContextEvent, SarEvent } from '../types';
import { CATALOGS, CATEGORY_COLOR, CATEGORY_LABEL, GROUPS } from '../lib';

interface Props {
  events: SarEvent[];
  context: ContextEvent[];
  visible: Set<Category>;
  showContext: boolean;
  open: boolean;
  onSetVisible: (cats: Category[], on: boolean) => void;
  onShowContext: (v: boolean) => void;
  onSelect: (id: string) => void;
  activeCatalogs: Set<string>;
  catalogCounts: Record<string, number>;
  catalogErrors: Record<string, string>;
  onToggleCatalog: (id: string) => void;
  years: [number, number];
  onYears: (y: [number, number]) => void;
}

const THIS_YEAR = new Date().getUTCFullYear();

export default function Filters(props: Props) {
  const { events, context, visible, showContext, open, onSetVisible, onShowContext, onSelect } = props;
  const [expanded, setExpanded] = useState<string | null>(null);
  const count = (cats: Category[]) =>
    context.filter((e) => cats.includes(e.category)).length + events.filter((e) => cats.includes(e.category)).length;

  return (
    <aside className={`filters${open ? ' open' : ''}`} aria-label="Map filters">
      <h3>Analysis categories</h3>
      {GROUPS.map((g) => {
        const on = g.categories.filter((c) => visible.has(c)).length;
        const all = on === g.categories.length;
        const isOpen = expanded === g.id;
        return (
          <div key={g.id} className="group">
            <div className="group-row">
              <label>
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && !all;
                  }}
                  onChange={() => onSetVisible(g.categories, !all)}
                />
                <span className="dot" style={{ background: g.color }} />
                {g.label}
              </label>
              <span className="count">{count(g.categories)}</span>
              <button
                className="expand"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? 'Hide' : 'Show'} ${g.label} types`}
                onClick={() => setExpanded(isOpen ? null : g.id)}
              >
                {isOpen ? '−' : '+'}
              </button>
            </div>
            {isOpen && (
              <div className="subcats">
                {g.categories.map((c) => (
                  <label key={c}>
                    <input type="checkbox" checked={visible.has(c)} onChange={() => onSetVisible([c], !visible.has(c))} />
                    {CATEGORY_LABEL[c]}
                    <span className="count">{count([c])}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <h3 style={{ marginTop: 10 }}>Event catalogs</h3>
      <label>
        <input type="checkbox" checked={showContext} onChange={(e) => onShowContext(e.target.checked)} />
        Recent events, 12 months (USGS, EONET)
      </label>
      {CATALOGS.map((c) => (
        <label key={c.id} title={props.catalogErrors[c.id] ?? ''}>
          <input type="checkbox" checked={props.activeCatalogs.has(c.id)} onChange={() => props.onToggleCatalog(c.id)} />
          {c.label}
          <span className="count">
            {props.catalogErrors[c.id] ? '!' : props.activeCatalogs.has(c.id) ? props.catalogCounts[c.id] ?? '…' : ''}
          </span>
        </label>
      ))}
      <div className="row" style={{ gap: 6, marginTop: 6, fontSize: 12.5 }}>
        <span className="muted">Years</span>
        <input
          className="year" type="number" min={1900} max={props.years[1]} value={props.years[0]} aria-label="From year"
          onChange={(e) => props.onYears([Math.min(Number(e.target.value) || 1900, props.years[1]), props.years[1]])}
        />
        <span className="muted">to</span>
        <input
          className="year" type="number" min={props.years[0]} max={THIS_YEAR} value={props.years[1]} aria-label="To year"
          onChange={(e) => props.onYears([props.years[0], Math.max(Number(e.target.value) || THIS_YEAR, props.years[0])])}
        />
      </div>
      <div className="legend-note">
        <div className="row" style={{ gap: 8 }}>
          <span className="dot ring" style={{ color: '#e7e9ec' }} /> Satellite investigation in this app
        </div>
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <span className="dot" style={{ background: '#8b94a1' }} /> Reported event (USGS, NASA EONET): not satellite-confirmed here
        </div>
      </div>
      <div className="featured">
        <h3>Investigations</h3>
        {events.map((e) => (
          <button key={e.id} onClick={() => onSelect(e.id)}>
            <span className="dot" style={{ background: CATEGORY_COLOR[e.category] }} />
            <span>
              <span className="t">{e.title}</span>
              <br />
              <span className="s">{CATEGORY_LABEL[e.category]} · {e.layers.length} layers</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
