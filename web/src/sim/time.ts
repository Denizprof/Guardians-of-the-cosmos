// Simulation time control: maps the timeline slider to model time and evaluates the state at a time.
// Before the event the slider is linear (the entry lasts seconds); after it, logarithmic (seconds to a day).
import type { SimResult, SimSeries, SimZone } from './types';

export const SLIDER_MAX = 1000;
const PRE = 200; // slider units for the pre-event part

export function sliderToTime(s: number, [t0, t1]: [number, number]): number {
  if (t0 < 0 && s <= PRE) return t0 + (s / PRE) * -t0;
  const lo = t0 < 0 ? PRE : 0;
  const f = (s - lo) / (SLIDER_MAX - lo);
  return Math.max(0, t0) + ((t1 - Math.max(0, t0) + 1) ** f - 1);
}

export function timeToSlider(t: number, [t0, t1]: [number, number]): number {
  if (t0 < 0 && t <= 0) return ((t - t0) / -t0) * PRE;
  const lo = t0 < 0 ? PRE : 0;
  const base = Math.max(0, t0);
  const span = t1 - base + 1;
  return lo + (Math.log(Math.max(1, t - base + 1)) / Math.log(span)) * (SLIDER_MAX - lo);
}

/** Radius of a zone's front at time t (km): grows at its physical front speed until the modelled extent. */
export function zoneRadiusAt(z: SimZone, t: number): number {
  if (t < 0) return 0;
  if (z.frontKmS === null) return z.radiusKm;
  return Math.min(z.radiusKm, z.frontKmS * t);
}

/** Linear interpolation in a series by x (x ascending). */
export function interp(series: SimSeries | undefined, x: number): number | null {
  const p = series?.points;
  if (!p?.length || x < p[0][0] || x > p[p.length - 1][0]) return null;
  for (let i = 1; i < p.length; i++) {
    if (x <= p[i][0]) {
      const [x0, y0] = p[i - 1];
      const [x1, y1] = p[i];
      return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return p[p.length - 1][1];
}

/** Clock text for a result: years for a climate run (t counts years from 2015), T−/T+ otherwise. */
export function formatSimTime(r: SimResult, t: number): string {
  return r.engine === 'climate' ? `Year ${Math.round(2015 + t)}` : formatTime(t);
}

export function formatTime(t: number): string {
  const a = Math.abs(t);
  const sign = t < 0 ? 'T−' : 'T+';
  if (a < 60) return `${sign}${a.toFixed(a < 10 ? 1 : 0)} s`;
  if (a < 3600) return `${sign}${Math.floor(a / 60)} min ${Math.round(a % 60)} s`;
  if (a < 86400) return `${sign}${Math.floor(a / 3600)} h ${Math.round((a % 3600) / 60)} min`;
  return `${sign}${(a / 86400).toFixed(1)} d`;
}

/** What is happening at time t, from the model's own outputs (used for the on-globe caption). */
export function stateAt(r: SimResult, t: number): string {
  if (r.engine === 'impact' && t < 0) {
    const z = interp(r.series.find((s) => s.id === 'altitude'), t);
    const v = interp(r.series.find((s) => s.id === 'velocity'), t);
    if (z === null || v === null) return 'Approaching Earth';
    return `Atmospheric entry · altitude ${z.toFixed(1)} km · ${v.toFixed(2)} km/s`;
  }
  if (t < 0) return 'Before the event';
  if (r.engine === 'climate') {
    const g = interp(r.series.find((s) => s.id === 'gsat'), 2015 + t);
    const l = interp(r.series.find((s) => s.id === 'local'), 2015 + t);
    const h = interp(r.series.find((s) => s.id === 'gmsl'), 2015 + t);
    return `${Math.round(2015 + t)} · global ${g === null ? '–' : `+${g.toFixed(1)} °C`} · here ${l === null ? '–' : `+${l.toFixed(1)} °C`} · sea level ${h === null ? '–' : `+${h.toFixed(2)} m`} (since 1995–2014)`;
  }
  if (r.engine === 'wildfire') {
    const a = interp(r.series.find((s) => s.id === 'area'), t / 3600);
    return `Fire spreading · ${a === null ? '–' : a.toFixed(2)} km² burned`;
  }
  if (r.engine === 'volcano') {
    const a = interp(r.series.find((s) => s.id === 'area1mm'), t / 3600);
    const stop = r.phases.find((p) => p.id === 'stop')?.t ?? 0;
    return `${t < stop ? 'Erupting' : 'Eruption over, ash still settling'} · ${a === null ? '–' : Math.round(a).toLocaleString('en-US')} km² under ≥ 1 mm of ash`;
  }
  if (r.engine === 'tsunami') {
    const n = interp(r.series.find((s) => s.id === 'arrivals'), t / 3600);
    const g = r.series.find((s) => s.id === 'gauge');
    const eta = interp(g, t / 3600);
    return `Waves spreading · ${n === null ? '–' : Math.round(n)} coastal cells reached${g && eta !== null ? ` · ${g.label.replace('Sea level offshore of ', 'offshore of ')}: ${eta >= 0 ? '+' : ''}${eta.toFixed(2)} m` : ''}`;
  }
  if (r.engine === 'flood') {
    const a = interp(r.series.find((s) => s.id === 'area'), t / 3600);
    const rainEnd = r.phases.find((p) => p.id === 'rainend')?.t ?? 0;
    return `${t < rainEnd ? 'Raining' : 'Rain has stopped'} · ${a === null ? '–' : a.toFixed(2)} km² under more than 10 cm of water`;
  }
  const growing = r.zones.filter((z) => z.frontKmS !== null && zoneRadiusAt(z, t) < z.radiusKm);
  if (!growing.length) return 'All modelled effects have reached their full extent';
  const g = growing[0];
  return `${g.label}: front at ${zoneRadiusAt(g, t).toFixed(0)} of ${g.radiusKm.toFixed(0)} km`;
}
