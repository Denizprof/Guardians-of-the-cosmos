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

/** Minimal SVG line chart of a computed series. */
function LineChart({ series, reverseX, markerX }: Props) {
  const pts = series.points;
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(0, ...ys);
  const y1 = Math.max(...ys) * 1.05 || 1;
  const sx = (x: number) => { const f = (x - x0) / (x1 - x0 || 1); return PAD.l + (reverseX ? 1 - f : f) * (W - PAD.l - PAD.r); };
  const sy = (y: number) => HT - PAD.b - ((y - y0) / (y1 - y0 || 1)) * (HT - PAD.t - PAD.b);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
  const midY = PAD.t + (HT - PAD.b - PAD.t) / 2;
  return (
    <figure className="sim-chart">
      <figcaption className="small">{series.label}</figcaption>
      <svg viewBox={`0 0 ${W} ${HT}`} role="img" aria-label={`${series.label}: ${series.yLabel} against ${series.xLabel}`}>
        <line x1={PAD.l} y1={HT - PAD.b} x2={W - PAD.r} y2={HT - PAD.b} className="axis" />
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={HT - PAD.b} className="axis" />
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <text x={sx(x0 + f * (x1 - x0))} y={HT - PAD.b + 13} textAnchor="middle" className="tick">{fmt(x0 + f * (x1 - x0), 2)}</text>
            <text x={PAD.l - 4} y={sy(y0 + f * (y1 - y0)) + 3} textAnchor="end" className="tick">{fmt(y0 + f * (y1 - y0), 2)}</text>
          </g>
        ))}
        <path d={d} className="line" />
        {markerX !== undefined && markerX !== null && markerX >= x0 && markerX <= x1 && <line x1={sx(markerX)} x2={sx(markerX)} y1={PAD.t} y2={HT - PAD.b} className="marker" />}
        <text x={(PAD.l + W - PAD.r) / 2} y={HT - 4} textAnchor="middle" className="label">{series.xLabel}</text>
        <text x={10} y={midY} textAnchor="middle" className="label" transform={`rotate(-90 10 ${midY})`}>{series.yLabel}</text>
      </svg>
    </figure>
  );
}

export default memo(LineChart);
