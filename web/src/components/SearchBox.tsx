import { useEffect, useRef, useState } from 'react';
import { geocode, type GeocodeHit } from '../services';
import { parseCoords } from '../lib';
import type { SarEvent } from '../types';

interface Props {
  events: SarEvent[];
  onEvent: (id: string) => void;
  onPlace: (hit: GeocodeHit) => void;
}

type Item = { kind: 'event'; ev: SarEvent } | { kind: 'place'; hit: GeocodeHit } | { kind: 'coords'; lon: number; lat: number };

export default function SearchBox({ events, onEvent, onPlace }: Props) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setItems([]);
      setErr(null);
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
    const t = setTimeout(async () => {
      abort.current?.abort();
      abort.current = new AbortController();
      try {
        const hits = await geocode(query, abort.current.signal);
        setItems([...local, ...hits.map((hit) => ({ kind: 'place' as const, hit }))]);
        setErr(null);
      } catch (e: any) {
        if (e.name !== 'AbortError') setErr('Place search is unavailable right now. Coordinates still work, e.g. "10.5, -67.2".');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, events]);

  const choose = (it: Item) => {
    setOpen(false);
    if (it.kind === 'event') onEvent(it.ev.id);
    else if (it.kind === 'place') onPlace(it.hit);
    else onPlace({ label: 'Coordinates', sub: '', lon: it.lon, lat: it.lat });
  };

  return (
    <div className="search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <input
        value={q}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls="search-results"
        placeholder="Search a place, event or lat, lon"
        aria-label="Search places, events or coordinates"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setSel(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, items.length - 1));
          else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0));
          else if (e.key === 'Enter' && items[sel]) choose(items[sel]);
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (items.length > 0 || err) && (
        <div className="search-results" role="listbox" id="search-results">
          {items.map((it, i) => (
            <button key={i} role="option" aria-selected={i === sel} onMouseDown={() => choose(it)}>
              {it.kind === 'event' && (
                <>
                  <div>{it.ev.title}</div>
                  <div className="sub">NISAR event analysis · {it.ev.subtitle}</div>
                </>
              )}
              {it.kind === 'place' && (
                <>
                  <div>{it.hit.label}</div>
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
