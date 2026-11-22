// Animated explainers for the Simulation Lab guide. Each scene is an SVG whose parts run one-shot CSS animations
// placed on a shared timeline (animation-delay = start − t0), so the loop can be paused, resumed and jumped to any
// step. Colours of the fireball, shock dome, crater and ash follow the Event Atlas visual language; the zone circles
// use the same severity colours as the globe.
import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { SIM_COLORS } from '../../map/markers';
import { ASH_CLASSES } from '../../sim/floodRender';
import type { Level, SceneId } from '../../sim/helpContent';
import { SCENES, stepAt } from '../../sim/helpScenes';
import './help.css';

type Vars = Record<string, string | number>;
/** Props for a part that runs animation `kind` for `dur` seconds, starting `delay` seconds into the loop. */
const at = (kind: string, delay: number, dur = 1, vars: Vars = {}, extra = ''): { className: string; style: CSSProperties } => ({
  className: `a k-${kind}${extra ? ` ${extra}` : ''}`,
  style: { '--d': `${delay}s`, '--t': `${dur}s`, ...vars } as CSSProperties,
});
const px = (n: number): string => `${n}px`;
const rgb = (c: readonly number[]): string => `rgb(${c.join(',')})`;

const STARS: [number, number, number][] = [[24, 14, 1], [88, 40, 1.2], [150, 18, 0.9], [210, 52, 1], [300, 16, 1.2], [350, 44, 0.9], [60, 66, 0.8], [260, 30, 0.8]];

function Impact(): ReactNode {
  const rings = [
    { r: 104, sev: 0 as const, d: 7.2, t: 1.8, label: 'Felt shaking' },
    { r: 78, sev: 1 as const, d: 6.6, t: 1.5, label: 'Windows break' },
    { r: 52, sev: 2 as const, d: 6.0, t: 1.2, label: 'Houses collapse' },
    { r: 26, sev: 3 as const, d: 5.4, t: 0.9, label: 'Crater, total destruction' },
  ];
  const ejecta: [number, number][] = [[-44, -62], [-22, -84], [8, -92], [34, -72], [56, -50], [-58, -34]];
  return (
    <>
      <rect width="400" height="240" className="s-bg" />
      <g {...at('fadeout', 4.9, 0.7)}>
        {STARS.map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} className="s-star" />)}
        <rect x="0" y="82" width="400" height="108" className="s-air" />
        <text x="350" y="22" className="s-note">space</text>
        <text x="8" y="96" className="s-note">air</text>
        <rect x="0" y="190" width="400" height="50" className="s-ground" />
        {[262, 282, 304, 328, 350, 372].map((x, i) => <rect key={x} x={x} y={190 - 10 - (i % 3) * 5} width="12" height={10 + (i % 3) * 5} className="s-town" />)}
        <g {...at('fadeout', 4.4, 0.05)}>
          <g {...at('move', 0, 4.4, { '--dx': px(190), '--dy': px(165), '--e': 'cubic-bezier(.45,0,.85,.55)' })}>
            <g {...at('fadein', 1.8, 1.6)}>
              <path d="M40 20 L12 0 L20 16 Z" className="s-trail" />
              <circle cx="40" cy="20" r="15" className="s-glow" />
            </g>
            <circle cx="40" cy="20" r="7" className="s-rock" />
          </g>
        </g>
        <circle cx="230" cy="190" r="16" {...at('flash', 4.4, 1.3, {}, 's-flash')} />
        <g {...at('fadeout', 5.0, 0.5)}><circle cx="230" cy="186" r="11" {...at('pop', 4.4, 0.5, {}, 's-fire')} /></g>
        <ellipse cx="230" cy="190" rx="22" ry="6" {...at('pop', 4.5, 0.6, {}, 's-crater')} />
        {ejecta.map(([dx, dy], i) => <circle key={i} cx="230" cy="188" r="2.2" {...at('movefade', 4.4, 1.4, { '--dx': px(dx), '--dy': px(dy), '--e': 'ease-out' }, 's-ejecta')} />)}
      </g>
      <g {...at('fadein', 4.9, 0.8)}>
        <rect width="400" height="240" className="s-map" />
        {[40, 90, 140, 190].map((y) => <line key={y} x1="0" x2="400" y1={y} y2={y} className="s-grid" />)}
        {[50, 130, 210, 290, 370].map((x) => <line key={x} y1="0" y2="240" x1={x} x2={x} className="s-grid" />)}
        {rings.map((g) => <circle key={g.r} cx="200" cy="110" r={g.r} {...at('pop', g.d, g.t, {}, 's-zone')} style={{ ...at('pop', g.d, g.t).style, fill: SIM_COLORS[g.sev], stroke: SIM_COLORS[g.sev] }} />)}
        <circle cx="200" cy="110" r="104" {...at('ringout', 5.4, 2.2, {}, 's-shock')} />
        {rings.map((g) => <circle key={`d${g.r}`} cx="200" cy="110" r={g.r} {...at('fadein', 8.8, 0.6, {}, 's-dash')} style={{ ...at('fadein', 8.8, 0.6).style, stroke: SIM_COLORS[g.sev] }} />)}
        <circle cx="200" cy="110" r="4" className="s-gz" />
        {rings.map((g, i) => (
          <g key={`l${g.r}`} {...at('fadein', 9.2 + i * 0.18, 0.5)}>
            <rect x={i < 2 ? 14 : 214} y={i % 2 === 0 ? 208 : 224} width="9" height="9" rx="2" style={{ fill: SIM_COLORS[g.sev] }} />
            <text x={i < 2 ? 27 : 227} y={i % 2 === 0 ? 216 : 232} className="s-note-b">{g.label}</text>
          </g>
        ))}
      </g>
    </>
  );
}

function Earthquake(): ReactNode {
  const houses: [number, number][] = [[50, 1.5], [110, 3], [200, 6], [290, 3], [350, 1.5]];
  const building = (x: number, amp: number, shake: boolean) => (
    <g key={x} {...(shake ? at('shake', 0, 0.16, { '--amp': px(amp) }) : { className: '' })}>
      <rect x={x - 11} y="82" width="22" height="28" className="s-house" />
      <path d={`M${x - 14} 82 L${x} 70 L${x + 14} 82 Z`} className="s-roof" />
    </g>
  );
  return (
    <>
      <rect width="400" height="240" className="s-bg" />
      <rect width="400" height="110" className="s-sky" />
      <rect y="110" width="400" height="130" className="s-ground" />
      {[140, 175, 215].map((y) => <path key={y} d={`M0 ${y} Q100 ${y - 8} 200 ${y} T400 ${y}`} className="s-strata" />)}
      <line x1="165" y1="240" x2="228" y2="150" className="s-fault" />
      <path d="M150 215 l8 -12 l8 12 z" {...at('move', 0.6, 0.7, { '--dx': px(-6), '--dy': px(8) }, 's-arrow-f')} />
      <path d="M232 185 l8 -12 l8 12 z" {...at('move', 0.6, 0.7, { '--dx': px(8), '--dy': px(-12) }, 's-arrow-f')} />
      <clipPath id="qk-clip"><rect x="0" y="110" width="400" height="130" /></clipPath>
      <g clipPath="url(#qk-clip)">
        {[0, 1, 2].map((i) => <circle key={i} cx="200" cy="190" r="215" {...at('ringout', 1.4 + i * 0.7, 2.4, {}, 's-seis')} />)}
      </g>
      <circle cx="200" cy="190" r="5" className="s-focus" />
      <circle cx="200" cy="190" r="5" {...at('ping', 0.6, 1.4, {}, 's-focus-ring')} />
      <text x="212" y="206" className="s-note-b">focus</text>
      <g {...at('hidewin', 3.6, 4.2)}>{houses.map(([x, a]) => building(x, a, false))}</g>
      <g {...at('window', 3.6, 4.2)}>{houses.map(([x, a]) => building(x, a, true))}</g>
      {[{ w: 330, sev: 0 as const }, { w: 190, sev: 2 as const }, { w: 90, sev: 3 as const }].map((b, i) => (
        <rect key={b.w} x={200 - b.w / 2} y="108" width={b.w} height="6" rx="3" {...at('pop', 6.0 + i * 0.4, 0.6)} style={{ ...at('pop', 6.0 + i * 0.4, 0.6).style, fill: SIM_COLORS[b.sev] }} />
      ))}
      <g {...at('fadein', 7.4, 0.6)}>
        <text x="200" y="130" textAnchor="middle" className="s-note-b">violent</text>
        <text x="128" y="130" textAnchor="middle" className="s-note-b">strong</text>
        <text x="272" y="130" textAnchor="middle" className="s-note-b">strong</text>
        <text x="52" y="130" textAnchor="middle" className="s-note-b">light</text>
        <text x="348" y="130" textAnchor="middle" className="s-note-b">light</text>
      </g>
    </>
  );
}

function Flood(): ReactNode {
  const houses = [170, 200, 230];
  return (
    <>
      <rect width="400" height="240" className="s-bg" />
      <rect width="400" height="240" className="s-sky" />
      {[80, 200, 320].map((x, i) => <ellipse key={x} cx={x} cy={24 + (i % 2) * 6} rx="46" ry="14" {...at('fadein', 0.1, 0.5, {}, 's-rain-cloud')} />)}
      <g {...at('window', 0.2, 5.4)}>
        {Array.from({ length: 18 }, (_, i) => 20 + i * 21).map((x, i) => (
          <line key={x} x1={x} y1="40" x2={x - 3} y2="50" {...at('rain', (i % 6) * 0.14, 0.8, { '--dy': px(120) }, 's-rain')} />
        ))}
      </g>
      {houses.map((x) => (
        <g key={x}>
          <rect x={x - 7} y="154" width="14" height="18" className="s-house" />
          <path d={`M${x - 9} 154 L${x} 144 L${x + 9} 154 Z`} className="s-roof" />
        </g>
      ))}
      <g {...at('move', 8.4, 2.6, { '--dx': px(0), '--dy': px(16) })}>
        <rect x="0" y="150" width="400" height="100" {...at('rise', 1.6, 4.2, { '--dy': px(45) }, 's-water')} />
      </g>
      <path d="M0 240 L0 96 Q36 96 66 124 Q106 170 150 172 L250 172 Q294 170 334 124 Q364 96 400 96 L400 240 Z" className="s-terrain" />
      <g {...at('fadein', 6.0, 0.6)}>
        <line x1="276" y1="172" x2="276" y2="150" className="s-gauge" />
        <path d="M272 154 L276 148 L280 154 M272 168 L276 174 L280 168" className="s-gauge" />
        <text x="284" y="164" className="s-note-b">depth</text>
      </g>
      {[130, 170, 230, 270].map((x, i) => (
        <path key={x} d="M0 0 L0 12 M-4 8 L0 13 L4 8" transform={`translate(${x} 178)`} {...at('movefade', 8.6 + i * 0.15, 1.6, { '--dx': px(0), '--dy': px(14) }, 's-arrow')} />
      ))}
      <text x="14" y="232" {...at('fadein', 8.4, 0.5, {}, 's-note-b')}>rain stopped · water soaks in</text>
    </>
  );
}

function Tsunami(): ReactNode {
  return (
    <>
      <rect width="400" height="240" className="s-bg" />
      <g {...at('fadeout', 9.2, 0.7)}>
        <rect width="400" height="100" className="s-sky" />
        <rect x="0" y="100" width="345" height="140" className="s-sea" />
        <path d="M0 240 L0 210 L120 214 Q210 205 260 170 Q310 130 345 100 L400 96 L400 240 Z" className="s-ground" />
        {[356, 376].map((x) => <g key={x}><rect x={x - 7} y="82" width="14" height="14" className="s-house" /><path d={`M${x - 9} 82 L${x} 73 L${x + 9} 82 Z`} className="s-roof" /></g>)}
        <ellipse cx="70" cy="213" rx="42" ry="10" {...at('pop', 0.3, 0.7, {}, 's-bump')} />
        {[56, 70, 84].map((x) => <path key={x} d="M0 0 L0 -12 M-4 -8 L0 -13 L4 -8" transform={`translate(${x} 204)`} {...at('movefade', 0.5, 1.4, { '--dx': px(0), '--dy': px(-38) }, 's-arrow')} />)}
        <g {...at('fadein', 0.8, 0.5)}>
          <g {...at('move', 1.4, 4.2, { '--dx': px(150), '--dy': px(0), '--e': 'linear' })}>
            <g {...at('shoal', 5.6, 3, { '--dx': px(100), '--e': 'cubic-bezier(.2,.6,.3,1)' })}>
              <ellipse cx="70" cy="100" rx="36" ry="5" className="s-crest" />
            </g>
          </g>
        </g>
        <g {...at('fadeout', 5.4, 0.4)}><text x="104" y="72" {...at('fadein', 2.0, 0.5, {}, 's-note-b')}>≈ 700 km/h in deep water</text></g>
        <text x="206" y="58" {...at('fadein', 6.4, 0.6, {}, 's-note-b')}>slower, taller</text>
        <text x="8" y="232" className="s-note">wave heights exaggerated</text>
      </g>
      <g {...at('fadein', 9.2, 0.8)}>
        <rect width="400" height="240" className="s-map" />
        <clipPath id="ts-sea"><path d="M0 0 L296 0 Q286 120 312 240 L0 240 Z" /></clipPath>
        <path d="M296 0 L400 0 L400 240 L312 240 Q286 120 296 0 Z" className="s-land" />
        <path d="M62 30 Q50 120 76 210" className="s-trench" />
        <g clipPath="url(#ts-sea)">
          <circle cx="90" cy="120" r="240" {...at('grow', 9.6, 2.8, {}, 's-ring-crest')} />
          <circle cx="90" cy="120" r="212" {...at('grow', 9.95, 2.8, {}, 's-ring-trough')} />
        </g>
        <circle cx="90" cy="120" r="5" className="s-epi" />
        <circle cx="302" cy="120" r="4.5" className="s-city" />
        <g {...at('fadein', 11.8, 0.6)}><text x="246" y="108" className="s-note-b">city: wave arrives</text></g>
        <g {...at('fadein', 10.2, 0.5)}>
          <rect x="14" y="208" width="9" height="9" rx="2" className="s-leg-crest" /><text x="27" y="216" className="s-note-b">sea higher than normal</text>
          <rect x="14" y="224" width="9" height="9" rx="2" className="s-leg-trough" /><text x="27" y="232" className="s-note-b">sea lower than normal</text>
        </g>
      </g>
    </>
  );
}

function Volcano(): ReactNode {
  const parts: { xs: number[]; t: number; r: number; cls: string }[] = [
    { xs: [226, 236, 246, 256, 266], t: 1.6, r: 2.6, cls: 's-ash-c' },
    { xs: [290, 300, 310, 320, 330], t: 3.0, r: 1.9, cls: 's-ash-m' },
    { xs: [346, 356, 366, 376, 386], t: 4.6, r: 1.3, cls: 's-ash-f' },
  ];
  const strips = [{ x: 318, w: 28, h: 6, c: ASH_CLASSES[3].color }, { x: 346, w: 28, h: 4, c: ASH_CLASSES[2].color }, { x: 374, w: 26, h: 2.5, c: ASH_CLASSES[1].color }];
  return (
    <>
      <rect width="400" height="240" className="s-bg" />
      <rect width="400" height="200" className="s-sky" />
      <rect y="200" width="400" height="40" className="s-ground" />
      <path d="M60 200 L172 102 L200 102 L318 200 Z" className="s-mount" />
      <ellipse cx="186" cy="102" rx="14" ry="4" {...at('fadein', 0.3, 0.5, {}, 's-lava')} />
      <rect x="177" y="26" width="18" height="76" rx="8" {...at('growy', 0.5, 3, {}, 's-plume')} />
      <ellipse cx="186" cy="30" rx="52" ry="16" {...at('driftgrow', 2.6, 3, { '--dx': px(40), '--dy': px(4) }, 's-umbrella')} />
      <g {...at('fadein', 3.2, 0.5)}>
        {[12, 24, 36].map((y) => <path key={y} d={`M290 ${y} L330 ${y} M322 ${y - 4} L330 ${y} L322 ${y + 4}`} className="s-wind" />)}
        <text x="336" y="28" className="s-note-b">wind</text>
      </g>
      {parts.map((p) => (
        <g key={p.cls} {...at('window', 5.4, 5.2)}>
          {p.xs.map((x, i) => <circle key={x} cx={x} cy="44" r={p.r} {...at('rain', i * (p.t / 5), p.t, { '--dy': px(150) }, p.cls)} />)}
        </g>
      ))}
      <g {...at('fadeout', 10.6, 0.8)}>
        <g {...at('fadein', 8.3, 0.2)}>
          <g {...at('move', 8.4, 2.2, { '--dx': px(-96), '--dy': px(92), '--e': 'ease-in' })}>
            <ellipse cx="181" cy="106" rx="17" ry="8" transform="rotate(-42 181 106)" className="s-pdc" />
          </g>
        </g>
      </g>
      {strips.map((s, i) => <rect key={s.x} x={s.x} y={200 - s.h} width={s.w} height={s.h} {...at('growy', 10.6 + i * 0.4, 0.6)} style={{ ...at('growy', 10.6 + i * 0.4, 0.6).style, fill: rgb(s.c) }} />)}
      <g {...at('fadein', 11.6, 0.5)}>
        <text x="322" y="184" className="s-note-b">thick</text>
        <text x="372" y="190" className="s-note-b">thin</text>
        <text x="70" y="226" className="s-note">ash on the ground (colours = thickness)</text>
      </g>
    </>
  );
}

const GRID = { cols: 18, rows: 11, size: 20, ox: 20, oy: 10, ign: [4.5, 5.5] as const };
const lake = (c: number, r: number): boolean => c >= 8 && c <= 12 && r >= 7 && r <= 9;
/** Arrival time of the front in each cell: an ellipse stretched downwind (east), as in Anderson (1983). */
function arrivals(): { c: number; r: number; t: number }[] {
  const e = 0.78;
  const cells: { c: number; r: number; t: number }[] = [];
  let max = 0;
  for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) {
    if (lake(c, r)) continue;
    const dx = c + 0.5 - GRID.ign[0], dy = r + 0.5 - GRID.ign[1];
    const dist = Math.hypot(dx, dy) || 0.001;
    const speed = (1 - e) / (1 - e * (dx / dist));
    const t = dist / speed;
    max = Math.max(max, t);
    cells.push({ c, r, t });
  }
  return cells.map((x) => ({ ...x, t: (x.t / max) * 9.2 }));
}
const FIRE_CELLS = arrivals();

function Wildfire(): ReactNode {
  return (
    <>
      <rect width="400" height="240" className="s-bg" />
      <rect x={GRID.ox - 4} y={GRID.oy - 4} width={GRID.cols * GRID.size + 8} height={GRID.rows * GRID.size + 8} rx="4" className="s-field" />
      {FIRE_CELLS.map((x) => (
        <rect key={`${x.c}-${x.r}`} x={GRID.ox + x.c * GRID.size + 0.5} y={GRID.oy + x.r * GRID.size + 0.5} width={GRID.size - 1} height={GRID.size - 1} rx="2" {...at('burn', 1.2 + x.t, 2.6, {}, 's-cell')} />
      ))}
      {Array.from({ length: GRID.rows * GRID.cols }, (_, k) => ({ c: k % GRID.cols, r: Math.floor(k / GRID.cols) })).filter((x) => lake(x.c, x.r)).map((x) => (
        <rect key={`l${x.c}-${x.r}`} x={GRID.ox + x.c * GRID.size + 0.5} y={GRID.oy + x.r * GRID.size + 0.5} width={GRID.size - 1} height={GRID.size - 1} rx="2" className="s-lake" />
      ))}
      <g {...at('window', 0.2, 1.6)}><circle cx={GRID.ox + GRID.ign[0] * GRID.size} cy={GRID.oy + GRID.ign[1] * GRID.size} r="6" {...at('ping', 0, 0.8, {}, 's-ign')} /></g>
      <g {...at('fadein', 2.2, 0.6)}>
        <path d="M30 22 L70 22 M62 17 L70 22 L62 27" className="s-wind" />
        <text x="76" y="26" className="s-note-b">wind</text>
      </g>
      <g {...at('fadein', 8.0, 0.6)}><text x={GRID.ox + 10.2 * GRID.size} y={GRID.oy + 8.6 * GRID.size} textAnchor="middle" className="s-note-b">lake</text></g>
      <g {...at('fadein', 5.0, 0.5)}>
        <rect x="262" y="12" width="9" height="9" rx="2" className="s-leg-green" /><text x="275" y="20" className="s-note-b">not burned</text>
        <rect x="262" y="26" width="9" height="9" rx="2" className="s-leg-orange" /><text x="275" y="34" className="s-note-b">burning now</text>
        <rect x="262" y="40" width="9" height="9" rx="2" className="s-leg-brown" /><text x="275" y="48" className="s-note-b">burned</text>
      </g>
    </>
  );
}

function Timeline(): ReactNode {
  const marks: [number, string, number][] = [[60, 'Entry', 1.2], [110, 'Impact', 2.2], [190, '+1 min', 4.2], [265, '+1 hour', 5.7], [335, '+1 day', 7.1]];
  const ticks = [40, 52, 64, 76, 88, 100, 112, 128, 150, 178, 214, 258, 308, 360];
  return (
    <>
      <rect width="400" height="240" className="s-bg" />
      <rect x="30" y="56" width="340" height="124" rx="10" className="s-bar" />
      <g className="s-btns">
        <path d="M48 76 L40 82 L48 88 Z M40 76 L40 88" className="s-btn-shape" />
        <circle cx="76" cy="82" r="11" className="s-play" />
        <circle cx="76" cy="82" r="11" {...at('ping', 0.2, 1.4, {}, 's-play-ring')} />
        <path d="M73 76 L82 82 L73 88 Z" className="s-btn-shape" />
        <text x="100" y="86" className="s-note-b">1×</text>
        <text x="330" y="86" textAnchor="end" className="s-note-b">T+1 h</text>
      </g>
      <line x1="46" x2="354" y1="130" y2="130" className="s-track" />
      {ticks.map((x) => <line key={x} x1={x + 6} x2={x + 6} y1="124" y2="136" className="s-tick" />)}
      <text x="50" y="152" className="s-note">even steps</text>
      <text x="260" y="152" className="s-note">stretched: seconds → days</text>
      {marks.map(([x, label, when], i) => (
        <g key={label}>
          <circle cx={x} cy="130" r="4" {...at('pop', when, 0.4, {}, 's-mark')} />
          <text x={x} y={i % 2 ? 114 : 170} textAnchor="middle" {...at('fadein', when, 0.4, {}, 's-note-b')}>{label}</text>
        </g>
      ))}
      <circle cx="46" cy="130" r="7" {...at('move', 1.0, 6.4, { '--dx': px(300), '--dy': px(0), '--e': 'cubic-bezier(.25,.1,.6,1)' }, 's-handle')} />
    </>
  );
}

const VIEWS: Record<SceneId, () => ReactNode> = { impact: Impact, earthquake: Earthquake, flood: Flood, tsunami: Tsunami, volcano: Volcano, wildfire: Wildfire, timeline: Timeline };

function useReducedMotion(): boolean {
  const [r] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  return r;
}

interface StageProps { id: SceneId; level: Level }

/** An animation with Play/Pause, a step list that follows the loop, and chapter buttons that jump to a step. */
function SceneStageBase({ id, level }: StageProps) {
  const spec = SCENES[id];
  const reduced = useReducedMotion();
  const [st, setSt] = useState(() => ({ epoch: 0, t0: reduced ? spec.still : 0, playing: !reduced }));
  const startedAt = useRef(0);
  const [clock, setClock] = useState(st.t0);

  useEffect(() => {
    startedAt.current = performance.now();
    setClock(st.t0);
    if (!st.playing) return;
    const loop = setTimeout(() => setSt((s) => ({ epoch: s.epoch + 1, t0: 0, playing: true })), Math.max(50, (spec.duration - st.t0) * 1000));
    const tick = setInterval(() => setClock(Math.min(spec.duration, st.t0 + (performance.now() - startedAt.current) / 1000)), 120);
    return () => { clearTimeout(loop); clearInterval(tick); };
  }, [st.epoch, st.playing, st.t0, spec.duration]);

  const toggle = () => setSt(st.playing
    ? { epoch: st.epoch + 1, t0: Math.min(spec.duration, st.t0 + (performance.now() - startedAt.current) / 1000), playing: false }
    : { epoch: st.epoch + 1, t0: st.t0 >= spec.duration - 0.3 ? 0 : st.t0, playing: true });
  const jump = (t: number) => setSt({ epoch: st.epoch + 1, t0: t, playing: true });
  const active = stepAt(spec, clock);
  const View = VIEWS[id];

  return (
    <figure className="help-stage">
      <div className={`help-frame${st.playing ? '' : ' is-paused'}`}>
        <svg key={st.epoch} viewBox="0 0 400 240" role="img" aria-label={spec.alt} className="help-svg" style={{ '--t0': `${st.t0}s` } as CSSProperties}>
          <View />
        </svg>
        <button type="button" className="help-play" onClick={toggle} aria-label={st.playing ? 'Pause the animation' : 'Play the animation'}>
          {st.playing ? '❚❚ Pause' : '▶ Play'}
        </button>
      </div>
      <ol className="help-steps" aria-label="Steps of the animation">
        {spec.steps.map((s, i) => (
          <li key={s.t} className={i === active ? 'on' : ''}>
            <button type="button" onClick={() => jump(s.t)} aria-current={i === active ? 'step' : undefined}>
              <span className="n" aria-hidden="true">{i + 1}</span>
              <span>{s.text[level]}</span>
            </button>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export const SceneStage = memo(SceneStageBase);
