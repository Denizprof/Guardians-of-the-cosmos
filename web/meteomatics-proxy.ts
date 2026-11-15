// Server-side Meteomatics route for the Vite dev / preview server.
//
// Meteomatics authenticates every request with the account username and password (HTTP Basic). Those must
// never reach the browser bundle, so the browser calls this same-origin route and the server adds the
// credentials. They are read from web/.env.local (gitignored): METEOMATICS_USERNAME / METEOMATICS_PASSWORD.
//
// This is NOT an open proxy: the route accepts only a point and a time, validates them, and requests a fixed
// list of weather parameters. Credentials and upstream URLs are never logged or returned.
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const METEOMATICS_HOST = 'https://api.meteomatics.com';

/** Parameters requested for a point. All are in Meteomatics' basic parameter set. */
export const METEOMATICS_PARAMS = ['t_2m:C', 'precip_24h:mm', 'wind_speed_10m:ms', 'msl_pressure:hPa'] as const;

export interface PointQuery {
  lat: number;
  lon: number;
  /** ISO 8601 UTC, seconds precision, e.g. 2026-11-14T12:00:00Z */
  time: string;
}

/** Validate untrusted query values. Returns an error message, or the cleaned query. */
export function parsePointQuery(q: URLSearchParams, now = Date.now()): PointQuery | string {
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  if (q.get('lat') === null || q.get('lon') === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return 'lat and lon are required numbers';
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'lat/lon out of range';
  const raw = q.get('time');
  // never a future time: a forecast is not the weather of an event (the Open-Meteo path clamps the same way)
  const ms = raw ? Math.min(Date.parse(raw), now) : now;
  if (raw && (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(raw) || Number.isNaN(ms))) return 'time must be an ISO 8601 date';
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, time: new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

/** Upstream URL for a validated query (no credentials in the URL). */
export function buildPointUrl(q: PointQuery): string {
  return `${METEOMATICS_HOST}/${q.time}/${METEOMATICS_PARAMS.join(',')}/${q.lat},${q.lon}/json`;
}

export interface WeatherValue {
  parameter: string;
  value: number | null;
  date: string | null;
}

/** Reduce a Meteomatics JSON body to the values we asked for. Returns null when the shape is not recognised. */
export function parsePointResponse(body: unknown): WeatherValue[] | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const out: WeatherValue[] = [];
  for (const d of data) {
    const parameter = (d as { parameter?: unknown })?.parameter;
    if (typeof parameter !== 'string') continue;
    const first = (d as { coordinates?: { dates?: { date?: unknown; value?: unknown }[] }[] }).coordinates?.[0]?.dates?.[0];
    out.push({
      parameter,
      value: typeof first?.value === 'number' && Number.isFinite(first.value) ? first.value : null,
      date: typeof first?.date === 'string' ? first.date : null,
    });
  }
  return out;
}

export const MAX_UPSTREAM_PER_MIN = 30;
const CACHE_MS = 10 * 60_000;

/** True for a browser request that comes from another site (or another origin on this machine). */
export function crossSite(req: IncomingMessage): boolean {
  const site = req.headers?.['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers?.origin;
  if (typeof origin === 'string') {
    try {
      if (new URL(origin).host !== req.headers.host) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export function meteomaticsMiddleware(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch) {
  const user = (env.METEOMATICS_USERNAME ?? '').trim();
  const pass = env.METEOMATICS_PASSWORD ?? '';
  const configured = Boolean(user && pass);
  const auth = configured ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` : '';
  // Quota protection. While the server runs, any web page open in the same browser could fire blind
  // requests at this route and spend the account's Meteomatics quota (it could not read the answers).
  // So: only same-origin browser requests are served, identical requests are cached briefly, and the
  // number of upstream calls per minute is capped.
  const cache = new Map<string, { at: number; body: unknown }>();
  let windowStart = 0;
  let calls = 0;

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/meteomatics/')) return next();
    if (req.method !== 'GET') return send(res, 405, { error: 'Use GET.' });
    if (url.pathname === '/api/meteomatics/status') return send(res, 200, { configured });
    if (url.pathname !== '/api/meteomatics/point') return send(res, 404, { error: 'Not found.' });
    if (crossSite(req)) return send(res, 403, { error: 'Cross-site requests are not allowed.' });
    if (!configured) return send(res, 503, { error: 'Meteomatics is not configured: set METEOMATICS_USERNAME and METEOMATICS_PASSWORD in web/.env.local and restart the server.' });
    const q = parsePointQuery(url.searchParams);
    if (typeof q === 'string') return send(res, 400, { error: q });
    const key = `${q.lat},${q.lon},${q.time.slice(0, 13)}`; // same point within the same hour
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return send(res, 200, hit.body);
    if (now - windowStart >= 60_000) { windowStart = now; calls = 0; }
    if (++calls > MAX_UPSTREAM_PER_MIN) return send(res, 429, { error: 'Too many weather requests in a minute. Try again shortly.' });
    try {
      const up = await fetchImpl(buildPointUrl(q), { headers: { Authorization: auth, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (up.status === 401) return send(res, 502, { error: 'Meteomatics rejected the username or password. Check web/.env.local.' });
      if (up.status === 403) return send(res, 502, { error: 'Your Meteomatics plan does not allow this request (parameter or date outside the plan).' });
      if (up.status === 429) return send(res, 502, { error: 'Meteomatics request limit reached. Try again later.' });
      if (!up.ok) return send(res, 502, { error: `Meteomatics responded HTTP ${up.status}.` });
      const values = parsePointResponse(await up.json());
      if (!values) return send(res, 502, { error: 'Meteomatics returned an unexpected response.' });
      const body = { lat: q.lat, lon: q.lon, time: q.time, values, source: 'Meteomatics Weather API', retrieved: new Date().toISOString() };
      if (cache.size > 500) cache.clear();
      cache.set(key, { at: now, body });
      return send(res, 200, body);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      // error class only: never the URL, headers or credentials
      console.error(`[meteomatics] request failed: ${name || 'error'}`);
      return send(res, 502, { error: name === 'TimeoutError' ? 'Meteomatics did not answer in time.' : 'Meteomatics could not be reached.' });
    }
  };
}

/** Vite plugin: mounts the route on the dev server and on `vite preview`. */
export function meteomatics(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'meteomatics-proxy',
    configureServer(server) {
      server.middlewares.use(meteomaticsMiddleware(env));
    },
    configurePreviewServer(server) {
      server.middlewares.use(meteomaticsMiddleware(env));
    },
  };
}
