// Simulation time control: play, pause, rewind, speed, scrub, reset and jump to model-supported moments.
import { memo, useEffect, useRef, useState } from 'react';
import type { SimResult } from '../../sim/types';
import './sim.css';
import { SLIDER_MAX, formatTime, sliderToTime, stateAt, timeToSlider } from '../../sim/time';

interface Props {
  result: SimResult;
  t: number;
  onTime: (t: number) => void;
}

const SPEEDS = [1, 10, 60, 600, 3600];

function SimTimeline({ result, t, onTime }: Props) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const tRef = useRef(t);
  tRef.current = t;
  const [t0, t1] = result.timeSpan;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      // the entry lasts seconds: play it in real time at 1×, then use the chosen speed
      const next = tRef.current + dt * (tRef.current < 0 ? Math.max(1, Math.min(speed, 2)) : speed);
      if (next >= t1) { onTime(t1); setPlaying(false); return; }
      onTime(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, t1, onTime]);

  return (
    <div className="sim-timeline" role="group" aria-label="Simulation time">
      <div className="sim-tl-row">
        <button className="btn" onClick={() => { onTime(t0); setPlaying(false); }} aria-label="Rewind to start" title="Rewind">⏮</button>
        <button className="btn primary" onClick={() => { if (t >= t1) onTime(t0); setPlaying((p) => !p); }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        <label className="small sim-speed">Speed
          <select className="layer-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <span className="mono sim-clock" aria-live="off">{formatTime(t)}</span>
        <button className="btn" onClick={() => { setPlaying(false); onTime(t1); }} title="Show the final state">Reset to final</button>
      </div>
      <input type="range" min={0} max={SLIDER_MAX} step={1} value={timeToSlider(t, result.timeSpan)} onChange={(e) => { setPlaying(false); onTime(sliderToTime(Number(e.target.value), result.timeSpan)); }} aria-label="Simulation time" aria-valuetext={formatTime(t)} />
      <div className="sim-phases">
        {result.phases.map((p) => (
          <button key={p.id} className="link small" onClick={() => { setPlaying(false); onTime(p.t); }}>{p.label}</button>
        ))}
      </div>
      <p className="small sim-state" role="status">{stateAt(result, t)}</p>
      <p className="muted small">Time span limited to what the model supports ({formatTime(t0)} to {formatTime(t1)}).</p>
    </div>
  );
}

export default memo(SimTimeline);
