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
/**
 * Dates older than this come from the ERA5 reanalysis archive. The forecast API is documented to keep about 92
 * past days, but it answers HTTP 200 with every value null from about 68 days back (measured 2026-11-15), while
 * the archive has those dates. 60 days leaves a margin; fetchOpenMeteo also retries the archive on an empty answer.
 */
const FORECAST_PAST_DAYS = 60;
/** The archive lags real time by some days: it had every hour 7 days back when measured (2026-11-15). */
const ARCHIVE_DELAY_DAYS = 7;
/** Shown when a provider answers but has no value for any parameter: that is a failure, not a weather result. */
export const NO_VALUES_MESSAGE = 'The weather service returned no values for this place and time';

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** End of the UTC day of a day-precision date, in ms; null when the date is not day-precision or cannot be parsed. */
function eventDayEnd(date: string | null, precision?: string | null): number | null {
  if (!date || precision !== 'day') return null;
  const start = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(start) ? null : start + 86_400_000;
}

/**
 * The instant to ask the weather services for. A date known only to the day is stored as 00:00 UTC, and the
 * "previous 24 h" rain at that instant is the day BEFORE the event. So for day precision the sample is taken at
 * the end of the event's UTC day (never later than now): the 24 h sum then covers exactly the event day.
 * A future instant of any precision is asked as now, for both providers: a forecast is not the event's weather.
 */
export function weatherSampleTime(date: string | null, precision?: string | null, now = Date.now()): string | null {
  const end = eventDayEnd(date, precision);
  if (end !== null) return new Date(Math.min(end, now)).toISOString();
  return date && Date.parse(date) > now ? new Date(now).toISOString() : date;
}

/** True when the returned sample is the end of the event's UTC day, so its 24 h rain sum is the event day's total. */
export function isEventDayResult(date: string | null, precision: string | null | undefined, resultTime: string): boolean {
  const end = eventDayEnd(date, precision);
  return end !== null && Date.parse(resultTime) === end;
}

/** The instant an Open-Meteo request is for: the given time, never later than now; now when missing or unparseable. */
function openMeteoTarget(time: string | null, now: number): number {
  const target = time ? Date.parse(time) : now;
  return Number.isNaN(target) ? now : Math.min(target, now);
}

/** Build the Open-Meteo request for a point and time (no key needed, CORS enabled). `forceArchive` picks the archive endpoint whatever the age. */
export function buildOpenMeteoUrl(lon: number, lat: number, time: string | null, now = Date.now(), forceArchive = false): string {
  const t = openMeteoTarget(time, now);
  const archive = forceArchive || now - t > FORECAST_PAST_DAYS * 86_400_000;
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

/** True when a response carries no number for any parameter. */
export const hasNoValues = (values: WeatherValue[]) => values.every((v) => v.value === null);

export async function fetchOpenMeteo(lon: number, lat: number, time: string | null, signal: AbortSignal): Promise<WeatherResult> {
  const now = Date.now();
  const ask = async (url: string) => {
    const r = await getJson(url, signal);
    if (!r.ok) throw new Error(typeof r.body?.reason === 'string' ? r.body.reason : `Weather request failed (HTTP ${r.status})`);
    const parsed = parseOpenMeteo(r.body, time, now);
    if (!parsed) throw new Error('Weather service returned an unexpected response');
    return parsed;
  };
  let url = buildOpenMeteoUrl(lon, lat, time, now);
  let parsed = await ask(url);
  // The forecast endpoint can answer with every value null for a past date it no longer keeps: the archive has it.
  if (hasNoValues(parsed.values) && !url.includes('archive-api') && now - openMeteoTarget(time, now) > ARCHIVE_DELAY_DAYS * 86_400_000) {
    url = buildOpenMeteoUrl(lon, lat, time, now, true);
    parsed = await ask(url);
  }
  if (hasNoValues(parsed.values)) throw new Error(NO_VALUES_MESSAGE);
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
      const at = weatherSampleTime(date, precision);
      const result = useMeteomatics ? await fetchWeather(lon, lat, at, c.signal) : await fetchOpenMeteo(lon, lat, at, c.signal);
      // no value for any parameter is not a weather result: say so instead of listing empty rows
      if (hasNoValues(result.values)) throw new Error(NO_VALUES_MESSAGE);
      if (!c.signal.aborted) setState({ s: 'ready', result });
    } catch (e) {
      if (c.signal.aborted) return;
      setState({ s: 'error', message: e instanceof Error ? e.message : 'Weather request failed' });
    }
  };

  // Only when the service really returned the end of the event's UTC day is the 24 h rain sum that day's total.
  const eventDay = state.s === 'ready' && isEventDayResult(date, precision, state.result.time);
  // A future-dated record is asked as now (weatherSampleTime), so the offer must not promise the event's time.
  const past = !!date && !(Date.parse(date) > Date.now());

  return (
    <div className="weather">
      <h3>Weather here</h3>
      {state.s === 'idle' && (
        <>
          <p className="muted small">
            Temperature, rain, wind and pressure at this point{past ? (precision === 'day' ? ' on the event day' : ' at the event time') : ' now'}, from weather models.
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
                  <dt>{eventDay && v.parameter === 'precip_24h:mm' ? 'Precipitation, event day (UTC)' : f.label}</dt>
                  <dd className="mono">{f.text}</dd>
                </div>
              );
            })}
            <dt>Valid time</dt>
            <dd className="mono">{fmtDateTime(state.result.time)}</dd>
          </dl>
          {eventDay && (
            <p className="muted small">
              This event is dated to the day only. Rain is the total for that UTC day; temperature, wind and pressure are one sample at the end of that day.
            </p>
          )}
          <p className="faint small">
            Source: {state.result.source}, retrieved {fmtDateTime(state.result.retrieved)}. Weather-model values for this point, not a satellite observation and not a measurement at a weather station.
          </p>
        </>
      )}
    </div>
  );
}
