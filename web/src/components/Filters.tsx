import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Category, ContextEvent, SarEvent } from '../types';
import { CATALOGS, CATEGORY_LABEL, GROUPS, fmtDateTime, parseUTC } from '../lib';

/** Hours since a catalog snapshot was built (Infinity when unparseable, which reads as stale). */
const snapshotAgeH = (iso: string) => {
  const t = parseUTC(iso).getTime();
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 36e5;
};
import { IconClose } from './icons';

interface Props {
  events: SarEvent[];
  context: ContextEvent[];
  visible: Set<Category>;
  showContext: boolean;
  onSetVisible: (cats: Category[], on: boolean) => void;
  onShowContext: (v: boolean) => void;
  activeCatalogs: Set<string>;
  catalogCounts: Record<string, number>;
  catalogErrors: Record<string, string>;
  /** Why the recent USGS/EONET events failed to load, if they did. */
  contextError?: string | null;
  /** Build time of each loaded catalog snapshot (ISO). */
  catalogRetrieved?: Record<string, string>;
  onToggleCatalog: (id: string) => void;
  years: [number, number];
  onYears: (y: [number, number]) => void;
  onClose: () => void;
}

const THIS_YEAR = new Date().getUTCFullYear();
const YEAR_DEBOUNCE_MS = 300;

/**
 * Year range inputs. Typing "1950" used to filter and re-cluster ~15 000 markers on each of the four
 * keystrokes; the text is now local and the committed range follows after a short pause.
 */
function YearRange({ years, onYears }: { years: [number, number]; onYears: (y: [number, number]) => void }) {
  const [from, setFrom] = useState(String(years[0]));
  const [to, setTo] = useState(String(years[1]));
  const committed = useRef(years);
  // follow changes made elsewhere (none today, but the inputs must never drift from the applied range)
  useEffect(() => {
    if (committed.current[0] === years[0] && committed.current[1] === years[1]) return;
    committed.current = years;
    setFrom(String(years[0]));
    setTo(String(years[1]));
  }, [years]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const lo = Math.max(1900, Math.min(Number(from) || 1900, THIS_YEAR));
      const hi = Math.max(lo, Math.min(Number(to) || THIS_YEAR, THIS_YEAR));
      if (lo === committed.current[0] && hi === committed.current[1]) return;
      committed.current = [lo, hi];
      onYears([lo, hi]);
    }, YEAR_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [from, to, onYears]);
  return (
    <div className="year-range">
      <span className="muted">Years</span>
      <input className="year" type="number" inputMode="numeric" min={1900} max={THIS_YEAR} value={from} aria-label="From year" onChange={(e) => setFrom(e.target.value)} />
      <span className="muted">to</span>
      <input className="year" type="number" inputMode="numeric" min={1900} max={THIS_YEAR} value={to} aria-label="To year" onChange={(e) => setTo(e.target.value)} />
    </div>
  );
}

function Filters(props: Props) {
  const { events, context, visible, showContext, onSetVisible, onShowContext } = props;
  const [expanded, setExpanded] = useState<string | null>(null);
  // One pass over the markers instead of one pass per category row.
  const counts = useMemo(() => {
    const m = new Map<Category, number>();
    for (const e of context) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    for (const e of events) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  }, [context, events]);
  const count = (cats: Category[]) => cats.reduce((n, c) => n + (counts.get(c) ?? 0), 0);

  return (
    <aside className="popover filters" aria-label="Map filters">
      <div className="popover-head">
        <h2>Filters</h2>
        <button className="close" onClick={props.onClose} aria-label="Close filters">
          <IconClose />
        </button>
      </div>
      <div className="popover-body">
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
                <button className="expand" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} ${g.label} types`} onClick={() => setExpanded(isOpen ? null : g.id)}>
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

        <h3>Event catalogs</h3>
        <label>
          <input type="checkbox" checked={showContext} onChange={(e) => onShowContext(e.target.checked)} />
          Recent events, 12 months (USGS, EONET)
        </label>
        {props.contextError && <p className="catalog-error" role="alert">{props.contextError}</p>}
        {CATALOGS.map((c) => (
          <div key={c.id}>
            <label>
              <input type="checkbox" checked={props.activeCatalogs.has(c.id)} onChange={() => props.onToggleCatalog(c.id)} />
              {c.label}
              <span className="count">{props.catalogErrors[c.id] ? '!' : props.activeCatalogs.has(c.id) ? (props.catalogCounts[c.id] ?? '…') : ''}</span>
            </label>
            {c.id === 'firms-fires' && props.activeCatalogs.has(c.id) && props.catalogRetrieved?.[c.id] && (
              <p className={`catalog-meta${snapshotAgeH(props.catalogRetrieved[c.id]) > 24 ? ' stale' : ''}`}>
                Snapshot from {fmtDateTime(props.catalogRetrieved[c.id])}
                {snapshotAgeH(props.catalogRetrieved[c.id]) > 24 ? ': older than 24 h, so these are not current fires.' : ' (not live).'}
              </p>
            )}
            {/* visible text, not a hover-only tooltip (touch screens have no hover) */}
            {props.catalogErrors[c.id] && (
              <p className="catalog-error" role="alert">
                Could not load ({props.catalogErrors[c.id]}).{' '}
                <button type="button" className="link" onClick={() => { props.onToggleCatalog(c.id); props.onToggleCatalog(c.id); }}>Retry</button>
              </p>
            )}
          </div>
        ))}
        <YearRange years={props.years} onYears={props.onYears} />

        <div className="legend-note">
          <div className="legend-row">
            <span className="dot ring" style={{ color: '#e7e9ec' }} /> Satellite investigation in this app
          </div>
          <div className="legend-row">
            <span className="dot" style={{ background: '#8b94a1' }} /> Reported event (USGS, NASA EONET): not satellite-confirmed here
          </div>
        </div>
      </div>
    </aside>
  );
}

export default memo(Filters);
