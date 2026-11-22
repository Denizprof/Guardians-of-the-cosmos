import { memo } from 'react';
import type { SimSeries } from '../../sim/types';
import { fmt } from '../../sim/validate';

interface Props {
  series: SimSeries;
  /** Draw x descending (e.g. altitude falling during entry). */
  reverseX?: boolean;
  markerX?: number | null;
}

const W = 340;
const HT = 170;
const PAD = { l: 44, r: 10, t: 10, b: 32 };
const EXTRA_COLORS = ['#7fb6ff', '#c79bff', '#7fe8ff', '#ffd060'];

/** Minimal SVG line chart of a computed series, with optional further lines (other scenarios). */
function LineChart({ series, reverseX, markerX }: Props) {
  const pts = series.points;
  if (pts.length < 2) return null;
  const extra = series.extra ?? [];
  const all = [pts, ...extra.map((e) => e.points)].flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(0, ...ys);
  const y1 = Math.max(...ys) * 1.05 || 1;
  const sx = (x: number) => { const f = (x - x0) / (x1 - x0 || 1); return PAD.l + (reverseX ? 1 - f : f) * (W - PAD.l - PAD.r); };
  const sy = (y: number) => HT - PAD.b - ((y - y0) / (y1 - y0 || 1)) * (HT - PAD.t - PAD.b);
  const path = (p: [number, number][]) => p.map((q, i) => `${i ? 'L' : 'M'}${sx(q[0]).toFixed(1)},${sy(q[1]).toFixed(1)}`).join('');
  const fx = (v: number) => (series.xLabel === 'Year' ? String(Math.round(v)) : fmt(v, 2));
  const midY = PAD.t + (HT - PAD.b - PAD.t) / 2;
  return (
    <figure className="sim-chart">
      <figcaption className="small">{series.label}</figcaption>
      <svg viewBox={`0 0 ${W} ${HT}`} role="img" aria-label={`${series.label}: ${series.yLabel} against ${series.xLabel}${extra.length ? `, with ${extra.map((e) => e.label).join(', ')}` : ''}`}>
        <line x1={PAD.l} y1={HT - PAD.b} x2={W - PAD.r} y2={HT - PAD.b} className="axis" />
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={HT - PAD.b} className="axis" />
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <text x={sx(x0 + f * (x1 - x0))} y={HT - PAD.b + 13} textAnchor="middle" className="tick">{fx(x0 + f * (x1 - x0))}</text>
            <text x={PAD.l - 4} y={sy(y0 + f * (y1 - y0)) + 3} textAnchor="end" className="tick">{fmt(y0 + f * (y1 - y0), 2)}</text>
          </g>
        ))}
        {extra.map((e, i) => <path key={e.label} d={path(e.points)} className="line extra" style={{ stroke: EXTRA_COLORS[i % EXTRA_COLORS.length] }} />)}
        <path d={path(pts)} className="line" />
        {markerX !== undefined && markerX !== null && markerX >= x0 && markerX <= x1 && <line x1={sx(markerX)} x2={sx(markerX)} y1={PAD.t} y2={HT - PAD.b} className="marker" />}
        <text x={(PAD.l + W - PAD.r) / 2} y={HT - 4} textAnchor="middle" className="label">{series.xLabel}</text>
        <text x={10} y={midY} textAnchor="middle" className="label" transform={`rotate(-90 10 ${midY})`}>{series.yLabel}</text>
      </svg>
      {extra.length > 0 && (
        <p className="small sim-legend">
          <span style={{ color: '#f29b4b' }}>● this scenario</span>
          {extra.map((e, i) => <span key={e.label} style={{ color: EXTRA_COLORS[i % EXTRA_COLORS.length] }}> ● {e.label}</span>)}
        </p>
      )}
    </figure>
  );
}

export default memo(LineChart);
