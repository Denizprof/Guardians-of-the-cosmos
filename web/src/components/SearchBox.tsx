import { useEffect, useId, useRef, useState } from 'react';
import { geocode, type GeocodeHit } from '../services';
import { parseCoords } from '../lib';
import type { SarEvent } from '../types';

interface Props {
  events: SarEvent[];
  onEvent: (id: string) => void;
  onPlace: (hit: GeocodeHit) => void;
}

type Item = { kind: 'event'; ev: SarEvent } | { kind: 'place'; hit: GeocodeHit } | { kind: 'coords'; lon: number; lat: number };

const itemKey = (it: Item, i: number) =>
  it.kind === 'event' ? `e:${it.ev.id}` : it.kind === 'coords' ? `c:${it.lat},${it.lon}` : `p:${i}:${it.hit.lon},${it.hit.lat}`;

/**
 * Combobox (WAI-ARIA 1.2 pattern): focus stays in the input, the highlighted option is announced through
 * aria-activedescendant, options are not tab stops, and Enter / click choose the option.
 */
export default function SearchBox({ events, onEvent, onPlace }: Props) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const listId = useId();
  const optId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => {
    // Any change of query invalidates the in-flight geocoder request, so a late
    // response can never overwrite newer results (coordinates option, cleared box).
    abort.current?.abort();
    setErr(null); // an earlier failure must not linger once the query changes
    const query = q.trim();
    if (query.length < 2) {
      setItems([]);
      return;
    }
    const local: Item[] = events
      .filter((e) => `${e.title} ${e.subtitle} ${e.category}`.toLowerCase().includes(query.toLowerCase()))
      .map((ev) => ({ kind: 'event', ev }));
    const c = parseCoords(query);
    if (c) {
      setItems([{ kind: 'coords', lon: c[0], lat: c[1] }, ...local]);
      return;
    }
    setItems(local);
    let cancelled = false;
    const t = setTimeout(async () => {
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const hits = await geocode(query, ctrl.signal);
        if (cancelled) return;
        setItems([...local, ...hits.map((hit) => ({ kind: 'place' as const, hit }))]);
      } catch (e: unknown) {
        if (cancelled || (e instanceof Error && e.name === 'AbortError')) return;
        console.warn('[search] place search failed:', e instanceof Error ? e.message : e);
        setErr('Place search is unavailable right now. Coordinates still work, e.g. "10.5, -67.2".');
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
      abort.current?.abort();
    };
  }, [q, events]);

  // async results can shrink the list under the highlight: keep it on a real option
  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items]);

  const choose = (it: Item) => {
    setOpen(false);
    if (it.kind === 'event') onEvent(it.ev.id);
    else if (it.kind === 'place') onPlace(it.hit);
    else onPlace({ label: 'Coordinates', sub: '', lon: it.lon, lat: it.lat });
  };

  const expanded = open && (items.length > 0 || !!err);
  const active = expanded && items[sel] ? optId(sel) : undefined;

  return (
    <div className="search" data-tut="search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <input
        value={q}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={active}
        placeholder="Search a place, event or lat, lon"
        aria-label="Search places, events or coordinates"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setSel(0);
        }}
        onFocus={() => setOpen(true)}
        // options use onMouseDown + preventDefault, so focus never leaves the input when one is clicked
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) setOpen(true);
            else setSel((s) => Math.min(s + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === 'Home' && expanded) {
            setSel(0);
          } else if (e.key === 'End' && expanded) {
            setSel(Math.max(0, items.length - 1));
          } else if (e.key === 'Enter' && expanded && items[sel]) {
            e.preventDefault();
            choose(items[sel]);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault(); // close the list only; the app's Escape chain must not also close a panel
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      <span className="sr-only" role="status" aria-live="polite">
        {open && q.trim().length >= 2
          ? `${items.length} result${items.length === 1 ? '' : 's'}${err ? '; the place search service did not answer' : ''}`
          : ''}
      </span>
      {expanded && (
        <div className="search-results" role="listbox" id={listId} aria-label="Search results">
          {items.map((it, i) => (
            <button
              key={itemKey(it, i)}
              id={optId(i)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={i === sel}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(it)}
            >
              {it.kind === 'event' && (
                <>
                  <div>{it.ev.title}</div>
                  <div className="sub">NISAR event analysis · {it.ev.subtitle}</div>
                </>
              )}
              {it.kind === 'place' && (
                <>
                  <div>{it.hit.label || 'Unnamed place'}</div>
                  <div className="sub">{it.hit.sub}</div>
                </>
              )}
              {it.kind === 'coords' && (
                <>
                  <div className="mono">
                    {it.lat.toFixed(4)}, {it.lon.toFixed(4)}
                  </div>
                  <div className="sub">Go to coordinates and check NISAR coverage</div>
                </>
              )}
            </button>
          ))}
          {err && <div className="sub" style={{ padding: '8px 12px' }}>{err}</div>}
        </div>
      )}
    </div>
  );
}
