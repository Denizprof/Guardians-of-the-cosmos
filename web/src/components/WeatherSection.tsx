import { useEffect, useRef, useState } from 'react';
import { EVIDENCE_LABEL, fmtDateTime } from '../lib';

/**
 * Weather at a point and time. With a configured server, from the Meteomatics Weather API through the app's
 * own route (/api/meteomatics, see web/meteomatics-proxy.ts), so the browser never sees the credentials.
 * Otherwise (GitHub Pages, or no account) from the key-less Open-Meteo API: ERA5 reanalysis for past events,
 * forecast models for recent days. All values are MODEL output, not satellite observations: labelled as such.
 */
export interface WeatherValue {
  parameter: string;
  value: number | null;
  date: string | null;
}
export interface WeatherResult {
  lat: number;
  lon: number;
  time: string;
  values: WeatherValue[];
  source: string;
  retrieved: string;
}

const LABELS: Record<string, { label: string; unit: string; digits: number }> = {
  't_2m:C': { label: 'Air temperature (2 m)', unit: '°C', digits: 1 },
  'precip_24h:mm': { label: 'Precipitation, previous 24 h', unit: 'mm', digits: 1 },
  'wind_speed_10m:ms': { label: 'Wind speed (10 m)', unit: 'm/s', digits: 1 },
  'msl_pressure:hPa': { label: 'Sea-level pressure', unit: 'hPa', digits: 0 },
};

export function formatWeatherValue(v: WeatherValue): { label: string; text: string } {
  const m = LABELS[v.parameter];
  const label = m?.label ?? v.parameter;
  if (v.value === null) return { label, text: 'not available' };
  return { label, text: `${v.value.toFixed(m?.digits ?? 2)} ${m?.unit ?? ''}`.trim() };
}

async function getJson(url: string, signal: AbortSignal): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(url, { signal });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // a non-JSON body (e.g. the static build's index.html) means the route does not exist
  }
  return { ok: res.ok, status: res.status, body };
}

/** False when the server route is missing (static build) or the credentials are not set. */
export async function meteomaticsConfigured(signal: AbortSignal): Promise<boolean> {
  const r = await getJson('api/meteomatics/status', signal);
  return r.ok && r.body?.configured === true;
}

export async function fetchWeather(lon: number, lat: number, time: string | null, signal: AbortSignal): Promise<WeatherResult> {
  const q = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
  if (time) q.set('time', time);
  const r = await getJson(`api/meteomatics/point?${q}`, signal);
  if (!r.ok) throw new Error(typeof r.body?.error === 'string' ? r.body.error : `Weather request failed (HTTP ${r.status})`);
  if (!Array.isArray(r.body?.values)) throw new Error('Weather service returned an unexpected response');
  return r.body as WeatherResult;
}

/** Set by the GitHub Pages build (VITE_STATIC_SITE=1): there is no server, so server-backed features are off. */
const STATIC_SITE = import.meta.env.VITE_STATIC_SITE === '1';

/** Open-Meteo hourly variable for each parameter we show, in the same keys as Meteomatics. */
const OPEN_METEO_VARS = ['temperature_2m', 'precipitation', 'wind_speed_10m', 'pressure_msl'] as const;
/** The forecast API keeps about 92 past days; older dates come from the ERA5 reanalysis archive. */
const FORECAST_PAST_DAYS = 90;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Build the Open-Meteo request for a point and time (no key needed, CORS enabled). */
export function buildOpenMeteoUrl(lon: number, lat: number, time: string | null, now = Date.now()): string {
  const target = time ? Date.parse(time) : now;
  const t = Number.isNaN(target) ? now : Math.min(target, now);
  const archive = now - t > FORECAST_PAST_DAYS * 86_400_000;
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: OPEN_METEO_VARS.join(','),
    wind_speed_unit: 'ms',
    timezone: 'UTC',
    start_date: isoDay(t - 86_400_000), // the day before, for the 24 h precipitation sum
    end_date: isoDay(t),
  });
  return `${archive ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast'}?${q}`;
}

/** Reduce an Open-Meteo hourly response to the values at the hour nearest `time`. Null when the shape is wrong. */
export function parseOpenMeteo(body: unknown, time: string | null, now = Date.now()): { time: string; values: WeatherValue[] } | null {
  const h = (body as { hourly?: Record<string, unknown> } | null)?.hourly;
  const times = h?.time;
  if (!h || !Array.isArray(times) || times.length === 0) return null;
  const target = Math.min(time && !Number.isNaN(Date.parse(time)) ? Date.parse(time) : now, now);
  let i = 0;
  let best = Infinity;
  times.forEach((s, k) => {
    const d = Math.abs(Date.parse(`${s}Z`) - target);
    if (d < best) { best = d; i = k; }
  });
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const at = (name: string) => num((h[name] as unknown[] | undefined)?.[i]);
  const precip = (h.precipitation as unknown[] | undefined) ?? [];
  const window = precip.slice(Math.max(0, i - 23), i + 1).map(num);
  const precip24 = window.length > 0 && window.every((v) => v !== null) ? window.reduce((a, b) => a! + b!, 0) : null;
  const date = `${times[i]}:00Z`;
  return {
    time: date,
    values: [
      { parameter: 't_2m:C', value: at('temperature_2m'), date },
      { parameter: 'precip_24h:mm', value: precip24, date },
      { parameter: 'wind_speed_10m:ms', value: at('wind_speed_10m'), date },
      { parameter: 'msl_pressure:hPa', value: at('pressure_msl'), date },
    ],
  };
}

export async function fetchOpenMeteo(lon: number, lat: number, time: string | null, signal: AbortSignal): Promise<WeatherResult> {
  const url = buildOpenMeteoUrl(lon, lat, time);
  const r = await getJson(url, signal);
  if (!r.ok) throw new Error(typeof r.body?.reason === 'string' ? r.body.reason : `Weather request failed (HTTP ${r.status})`);
  const parsed = parseOpenMeteo(r.body, time);
  if (!parsed) throw new Error('Weather service returned an unexpected response');
  const archive = url.includes('archive-api');
  return {
    lat,
    lon,
    time: parsed.time,
    values: parsed.values,
    source: archive ? 'Open-Meteo historical weather (ECMWF ERA5 reanalysis)' : 'Open-Meteo weather forecast models',
    retrieved: new Date().toISOString(),
  };
}

type State =
  | { s: 'idle' }
  | { s: 'loading' }
  | { s: 'error'; message: string }
  | { s: 'ready'; result: WeatherResult };

/** `precision` is the record's date_precision: a date known only to the day has no event time to claim. */
export default function WeatherSection({ lon, lat, date, precision }: { lon: number; lat: number; date: string | null; precision?: string | null }) {
  const [state, setState] = useState<State>({ s: 'idle' });
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const load = async () => {
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    setState({ s: 'loading' });
    try {
      // Meteomatics when the app's own server has an account; otherwise (GitHub Pages, or no credentials)
      // the key-less Open-Meteo API, called directly from the browser.
      const useMeteomatics = !STATIC_SITE && (await meteomaticsConfigured(c.signal).catch(() => false));
      const result = useMeteomatics ? await fetchWeather(lon, lat, date, c.signal) : await fetchOpenMeteo(lon, lat, date, c.signal);
      if (!c.signal.aborted) setState({ s: 'ready', result });
    } catch (e) {
      if (c.signal.aborted) return;
      setState({ s: 'error', message: e instanceof Error ? e.message : 'Weather request failed' });
    }
  };

  return (
    <div className="weather">
      <h3>Weather here</h3>
      {state.s === 'idle' && (
        <>
          <p className="muted small">
            Temperature, rain, wind and pressure at this point{date ? (precision === 'day' ? ' on the event day' : ' at the event time') : ' now'}, from weather models.
          </p>
          <button type="button" className="btn" onClick={load}>Get weather</button>
        </>
      )}
      {state.s === 'loading' && <p className="muted small" role="status">Getting weather data…</p>}
      {state.s === 'error' && (
        <div role="alert">
          <p className="callout warn">Could not get weather data: {state.message}</p>
          <button type="button" className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {state.s === 'ready' && (
        <>
          <span className="evidence model">{EVIDENCE_LABEL.model}</span>
          <dl className="kv" style={{ marginTop: 8 }}>
            {state.result.values.map((v) => {
              const f = formatWeatherValue(v);
              return (
                <div key={v.parameter} style={{ display: 'contents' }}>
                  <dt>{f.label}</dt>
                  <dd className="mono">{f.text}</dd>
                </div>
              );
            })}
            <dt>Valid time</dt>
            <dd className="mono">{fmtDateTime(state.result.time)}</dd>
          </dl>
          <p className="faint small">
            Source: {state.result.source}, retrieved {fmtDateTime(state.result.retrieved)}. Weather-model values for this point, not a satellite observation and not a measurement at a weather station.
          </p>
        </>
      )}
    </div>
  );
}
