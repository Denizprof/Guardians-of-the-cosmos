import { useEffect, useRef, useState } from 'react';
import { EVIDENCE_LABEL, fmtDateTime } from '../lib';

/**
 * Weather at a point and time from the Meteomatics Weather API, through the app's own server route
 * (/api/meteomatics, see web/meteomatics-proxy.ts). The browser never sees the account credentials.
 * Meteomatics values are MODEL output (analysis / forecast), not satellite observations: labelled as such.
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

type State =
  | { s: 'idle' }
  | { s: 'loading' }
  | { s: 'unconfigured' }
  | { s: 'error'; message: string }
  | { s: 'ready'; result: WeatherResult };

export default function WeatherSection({ lon, lat, date }: { lon: number; lat: number; date: string | null }) {
  const [state, setState] = useState<State>({ s: 'idle' });
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const load = async () => {
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    setState({ s: 'loading' });
    try {
      // Static hosting (GitHub Pages) has no server route: say so without sending a request that can only 404.
      if (STATIC_SITE || !(await meteomaticsConfigured(c.signal))) return setState({ s: 'unconfigured' });
      const result = await fetchWeather(lon, lat, date, c.signal);
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
            Temperature, rain, wind and pressure at this point{date ? ' at the event time' : ' now'}, from the Meteomatics weather model.
          </p>
          <button type="button" className="btn" onClick={load}>Get weather (Meteomatics)</button>
        </>
      )}
      {state.s === 'loading' && <p className="muted small" role="status">Asking Meteomatics…</p>}
      {state.s === 'unconfigured' && (
        <p className="callout" role="status">
          {STATIC_SITE ? (
            <>Weather data is not connected on this hosted site: it needs the app's own server to keep the weather account private. No weather values are shown.</>
          ) : (
            <>
              Meteomatics is not connected. Add your username and password to <span className="mono">web/.env.local</span> and restart the server (see{' '}
              <span className="mono">docs/meteomatics.md</span>). No weather values are shown without it.
            </>
          )}
        </p>
      )}
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
