import { memo, useEffect, useRef, useState } from 'react';
import type { SarEvent, SarLayer } from '../types';
import { MONTHS, fmtEventDate, layerLabel, parseUTC } from '../lib';

interface Props {
  event: SarEvent;
  before: SarLayer | null;
  after: SarLayer | null;
  slot: 'before' | 'after';
  onSlot: (s: 'before' | 'after') => void;
  onPick: (layerId: string) => void;
}

// parseUTC, not Date.parse: an offset-less ISO time is LOCAL time to Date.parse, which would shift every
// acquisition by the viewer's timezone (this app treats every date as UTC).
const t = (iso: string) => parseUTC(iso).getTime();

function Timeline({ event, before, after, slot, onSlot, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  // Show one layer type at a time (the type currently in the After slot) so the
  // same date doesn't appear twice (NASA browse + our derived version).
  const kind = after?.kind ?? before?.kind;
  const shown = event.layers.filter((l) => !kind || l.kind === kind || l.id === before?.id || l.id === after?.id);
  const spans = shown.map((l) => ({
    l,
    a: t((l.acquisition.reference || l.acquisition.start)!),
    b: t((l.acquisition.secondary || l.acquisition.start)!),
  }));
  const evT = event.date ? t(event.date) : null;
  const allT = spans.flatMap((s) => [s.a, s.b]).concat(evT ? [evT] : []);
  const pad = (Math.max(...allT) - Math.min(...allT)) * 0.06 + 2 * 864e5;
  const lo = Math.min(...allT) - pad, hi = Math.max(...allT) + pad;
  const X = (v: number) => 12 + ((v - lo) / (hi - lo)) * (w - 24);

  // Axis ticks: month starts for long spans, every N days for spans under ~40 days
  // (otherwise a 12-day window would show no date labels at all).
  const shortSpan = hi - lo < 40 * 864e5;
  const months: number[] = [];
  const d = new Date(lo);
  d.setUTCHours(0, 0, 0, 0);
  if (shortSpan) {
    const dayStep = Math.max(1, Math.ceil((hi - lo) / 864e5 / Math.max(2, Math.floor(w / 70))));
    while (d.getTime() <= hi) {
      if (d.getTime() >= lo) months.push(d.getTime());
      d.setUTCDate(d.getUTCDate() + dayStep);
    }
  } else {
    d.setUTCDate(1);
    while (d.getTime() <= hi) {
      if (d.getTime() >= lo) months.push(d.getTime());
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  }
  const step = shortSpan ? 1 : Math.ceil(months.length / Math.max(1, Math.floor(w / 70)));
  const tickLabel = (t: number) => {
    const dt = new Date(t);
    return shortSpan ? `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}` : `${MONTHS[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(2)}`;
  };

  const isPair = spans.some((s) => s.a !== s.b);
  const rowY = 40;
  // The event label sits to the right of its line unless it would run past the right edge (narrow phones):
  // then it is anchored to the left of the line, and never starts before the left edge either.
  const EV_LABEL_W = 130; // "event 12 Jan 2026" in 12 px mono plus the 4 px gap
  const evLabelLeft = evT !== null && X(evT) + EV_LABEL_W > w;
  const evLabelX = evT === null ? 0 : evLabelLeft ? Math.max(X(evT) - 4, Math.min(EV_LABEL_W, w)) : X(evT) + 4;

  return (
    <div className="timeline" role="group" aria-label="Observation timeline">
      <div className="timeline-slot">
        <span className="micro">Click a date to set</span>
        <div className="seg" role="group" aria-label="Which slot a click sets">
          <button aria-pressed={slot === 'before'} onClick={() => onSlot('before')}>Before</button>
          <button aria-pressed={slot === 'after'} onClick={() => onSlot('after')}>After</button>
        </div>
      </div>
      <div ref={ref} className="timeline-track">
        <svg height="72" role="group" aria-label={`${shown.length} observations of ${event.title}`}>
          <line x1={0} x2={w} y1={rowY} y2={rowY} stroke="#2e3540" />
          {months.map((m, i) =>
            i % step === 0 ? (
              <g key={m}>
                <line x1={X(m)} x2={X(m)} y1={rowY - 4} y2={rowY + 4} stroke="#3a4250" />
                <text x={X(m)} y={rowY + 22} textAnchor="middle" fontSize="12" fill="#8b94a1" fontFamily="var(--mono)">
                  {tickLabel(m)}
                </text>
              </g>
            ) : null
          )}
          {evT && (
            <g>
              <line x1={X(evT)} x2={X(evT)} y1={8} y2={rowY + 8} stroke="#ffffff" strokeDasharray="3 3" opacity={0.7} />
              <text className="ev-label" x={evLabelX} y={14} textAnchor={evLabelLeft ? 'end' : 'start'} fontSize="12" fill="#e7e9ec" fontFamily="var(--mono)">event {fmtEventDate(event)}</text>
            </g>
          )}
          {spans.map(({ l, a, b }, i) => {
            const isB = before?.id === l.id, isA = after?.id === l.id;
            const stroke = isA ? '#ffffff' : isB ? '#cfd6df' : '#5d6672';
            const y = isPair ? rowY - 10 + (i % 2) * 6 : rowY;
            return (
              <g key={l.id} className="tick" onClick={() => onPick(l.id)} role="button" tabIndex={0}
                 aria-label={`${layerLabel(l)}${isB ? ', current before' : ''}${isA ? ', current after' : ''}`}
                 onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(l.id)}>
                <title>{layerLabel(l)} · {l.provenance.tier}</title>
                {a !== b ? (
                  <rect x={X(a)} y={y - 3} width={Math.max(4, X(b) - X(a))} height={6} rx={3} fill={isA || isB ? stroke : '#3a4250'} stroke={stroke} strokeWidth={1} />
                ) : (
                  <circle cx={X(a)} cy={y} r={isA || isB ? 6 : 4.5} fill={isA || isB ? stroke : '#1b2028'} stroke={stroke} strokeWidth={1.5} />
                )}
                <rect x={X(a) - 8} y={y - 12} width={Math.max(16, X(b) - X(a) + 16)} height={24} fill="transparent" className="tick-hit" />
                {(isA || isB) && (
                  <text x={(X(a) + X(b)) / 2} y={y - 10} textAnchor="middle" fontSize="12" fontWeight={600} fill={stroke} fontFamily="var(--mono)">
                    {isB && isA ? 'B=A' : isB ? 'B' : 'A'}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default memo(Timeline);
