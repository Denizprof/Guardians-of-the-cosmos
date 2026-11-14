import { memo, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { IconClose, IconExpand, IconGrip, IconInfo, IconShrink } from './icons';

export interface LensGeometry {
  x: number;
  y: number;
  size: number;
}

interface Props {
  /** Element that carries the --lens-* CSS variables (the .app root): the frame and the map clip both read them. */
  rootRef: RefObject<HTMLElement | null>;
  /** Survives closing and reopening the lens. */
  geometry: RefObject<LensGeometry | null>;
  full: boolean;
  /** "<source>, <date>" shown after "SAR view:". */
  label: string;
  /** Honest coverage caveat shown next to the label (null = none). */
  note: string | null;
  provenance: string[];
  attribution: string;
  /** Present while an investigation is open: lets the lens show that investigation's NISAR layer. */
  choice: { value: 'base' | 'nisar'; baseLabel: string; nisarLabel: string; onChange: (v: 'base' | 'nisar') => void } | null;
  /** Width of the side panel covering the right of the map (0 when closed or on phones). */
  insetRight: number;
  /** Height covered at the bottom (timeline, investigation strip or the mobile sheet). */
  insetBottom?: number;
  onFull: (v: boolean) => void;
  onClose: () => void;
}

const MIN_SIZE = 140;
const LABEL_BAR = 40; // the lens' own label bar sits above the square
/** Below the real top bar (measured: it wraps to two rows on phones) plus the lens label bar. */
const topClear = () => {
  const bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom;
  return Math.round((bar !== undefined && Number.isFinite(bar) && bar > 0 ? bar : window.innerWidth <= 820 ? 106 : 62) + LABEL_BAR);
};
const STEP = 16;

const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });

/** Keep the square on the visible part of the map: inside the window, clear of the side panel and of the bottom bars. */
function clamp(g: LensGeometry, insetRight = 0, insetBottom = 0): LensGeometry {
  const { w: full, h: fullH } = viewport();
  const top = topClear();
  const w = Math.max(MIN_SIZE + 16, full - insetRight);
  const h = Math.max(top + MIN_SIZE + 8, fullH - insetBottom);
  const size = Math.round(Math.max(MIN_SIZE, Math.min(g.size, w - 16, h - top - 8)));
  return {
    size,
    x: Math.round(Math.max(8, Math.min(g.x, w - size - 8))),
    y: Math.round(Math.max(top, Math.min(g.y, h - size - 8))),
  };
}

function initial(insetRight: number, insetBottom: number): LensGeometry {
  const { w, h: fullH } = viewport();
  const free = Math.max(240, w - insetRight);
  const h = Math.max(240, fullH - insetBottom);
  const size = Math.max(MIN_SIZE, Math.min(360, Math.round(Math.min(free, h) * 0.42)));
  return clamp({ size, x: (free - size) / 2, y: (h - size) / 2 }, insetRight, insetBottom);
}

/**
 * The SAR lens frame: a draggable, resizable square. The SAR map itself lives in MapView and is clipped
 * to this square with CSS variables, so moving the lens never re-renders React (ref + rAF only).
 */
function SarLens({ rootRef, geometry, full, label, note, provenance, attribution, choice, insetRight, insetBottom = 0, onFull, onClose }: Props) {
  const [info, setInfo] = useState(false);
  const infoId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const inset = useRef(insetRight);
  inset.current = insetRight;
  const insetB = useRef(insetBottom);
  insetB.current = insetBottom;

  // The provenance popover closes on Escape (before the app's own Escape chain sees it) and on outside clicks.
  useEffect(() => {
    if (!info) return;
    const onDown = (e: PointerEvent) => {
      if (!frameRef.current?.querySelector('.lens-bar')?.contains(e.target as Node)) setInfo(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [info]);
  const onFrameKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && info) {
      e.preventDefault();
      e.stopPropagation();
      setInfo(false);
    }
  };
  const drag = useRef<{ kind: 'move' | 'resize'; px: number; py: number; start: LensGeometry } | null>(null);

  const apply = useCallback(() => {
    raf.current = 0;
    const g = geometry.current;
    const el = rootRef.current;
    if (!g || !el) return;
    el.style.setProperty('--lens-x', `${g.x}px`);
    el.style.setProperty('--lens-y', `${g.y}px`);
    el.style.setProperty('--lens-s', `${g.size}px`);
    el.style.setProperty('--lens-inset', `${inset.current}px`);
  }, [geometry, rootRef]);

  const set = useCallback(
    (g: LensGeometry) => {
      geometry.current = clamp(g, inset.current, insetB.current);
      if (!raf.current) raf.current = requestAnimationFrame(apply);
    },
    [geometry, apply]
  );

  useEffect(() => {
    geometry.current = clamp(geometry.current ?? initial(insetRight, insetBottom), insetRight, insetBottom);
    apply();
    const onResize = () => geometry.current && set(geometry.current);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The side panel, timeline or mobile sheet opened or closed: slide the square back onto the visible map.
  useEffect(() => {
    if (geometry.current) set(geometry.current);
  }, [insetRight, insetBottom, geometry, set]);

  const begin = (kind: 'move' | 'resize') => (e: ReactPointerEvent<HTMLElement>) => {
    if (full || !geometry.current) return;
    // Buttons inside the bar keep their own clicks; only the grip and the bar surface start a drag.
    if (kind === 'move' && (e.target as HTMLElement).closest('button:not(.lens-move), .seg, .lens-info')) return;
    drag.current = { kind, px: e.clientX, py: e.clientY, start: { ...geometry.current } };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (d.kind === 'move') set({ ...d.start, x: d.start.x + dx, y: d.start.y + dy });
    // dominant axis: dragging the corner left/up shrinks, right/down grows (max(dx, dy) grew on any small downward drift)
    else set({ ...d.start, size: d.start.size + (Math.abs(dx) >= Math.abs(dy) ? dx : dy) });
  };
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const keys = (kind: 'move' | 'resize') => (e: KeyboardEvent<HTMLElement>) => {
    const g = geometry.current;
    if (!g || full) return;
    const step = e.shiftKey ? STEP * 4 : STEP;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    if (kind === 'move') set({ ...g, x: g.x + dx, y: g.y + dy });
    else set({ ...g, size: g.size + (dx || dy) });
  };

  const tooltip = [...provenance, attribution].join('\n');

  return (
    <div ref={frameRef} className={`lens-frame${full ? ' full' : ''}`} role="group" aria-label="SAR lens" onKeyDown={onFrameKey}>
      <div className="lens-bar" onPointerDown={begin('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        {!full && (
          <button type="button" className="lens-btn lens-move" aria-label="Move SAR lens (drag, or use the arrow keys)" onKeyDown={keys('move')}>
            <IconGrip />
          </button>
        )}
        <span className="lens-label" title={tooltip}>
          <b>SAR view:</b> {label}
        </span>
        {note && (
          <span className="lens-note" title={note}>
            {note}
          </span>
        )}
        {choice && (
          <span className="seg lens-seg" role="group" aria-label="SAR lens source">
            <button type="button" aria-pressed={choice.value === 'base'} onClick={() => choice.onChange('base')}>{choice.baseLabel}</button>
            <button type="button" aria-pressed={choice.value === 'nisar'} onClick={() => choice.onChange('nisar')}>{choice.nisarLabel}</button>
          </span>
        )}
        <button type="button" className="lens-btn" aria-label="SAR view data provenance" aria-expanded={info} aria-controls={infoId} title={tooltip} onClick={() => setInfo((v) => !v)}>
          <IconInfo />
        </button>
        <button type="button" className="lens-btn" aria-label={full ? 'Restore SAR lens to a square' : 'Expand SAR lens to full screen'} aria-pressed={full} onClick={() => onFull(!full)}>
          {full ? <IconShrink /> : <IconExpand />}
        </button>
        <button type="button" className="lens-btn" aria-label="Close SAR lens" onClick={onClose}>
          <IconClose />
        </button>
        {info && (
          <div className="lens-info" id={infoId} role="note">
            <h3>SAR view provenance</h3>
            <ul>
              {provenance.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="faint">{attribution}</p>
          </div>
        )}
      </div>
      {!full && (
        <>
          <span className="lens-tick tl" aria-hidden="true" />
          <span className="lens-tick tr" aria-hidden="true" />
          <span className="lens-tick bl" aria-hidden="true" />
          <button
            type="button"
            className="lens-resize"
            aria-label="Resize SAR lens (drag, or use the arrow keys)"
            onPointerDown={begin('resize')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={keys('resize')}
          />
        </>
      )}
    </div>
  );
}

export default memo(SarLens);
