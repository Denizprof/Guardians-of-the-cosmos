/**
 * Loader for the SAR lens radar tiles (NASA GIBS), used through a MapLibre custom protocol.
 *
 * Why not MapLibre's own loading: with refreshExpiredTiles off it loads raster tiles through an <img>, which
 * cannot tell an HTTP 500 from a 404 (every failure reads "Could not load image ... supported image type",
 * with no status) and never asks for a failed tile again. Measured on GIBS (Nov 2026): OPERA RTC-S1 tile
 * requests answer a transient HTTP 500 now and then, more often under a burst of parallel requests (about
 * 1 in 100 in quiet browser runs, 17 of 450 in one run, 124 of 576 first answers when asked 16 at a time).
 * The same URL usually answers 200 on the next request, but some needed several seconds (worst seen: 4.2 s).
 * A day that is not published yet answers 404 on every tile.
 *
 * So this loader:
 *  - asks again after a server error (5xx), a 408 / 429, or a network error: at most RETRY_DELAYS_MS.length
 *    more times, with growing pauses. A tile that loads on a later attempt is simply a loaded tile;
 *  - once a tile of a day that has delivered nothing has outlasted all the retries, gives the tiles of that
 *    product's days that have delivered nothing a single attempt for FAILING_TTL_MS (renewed by each failure,
 *    ended by the first good tile of the product), so a real outage does not keep MapLibre's shared image
 *    queue busy with pauses;
 *  - does not retry other 4xx. A 404 on a day that has delivered nothing is remembered for that day
 *    (UNPUBLISHED_TTL_MS), so its other tiles fail at once without a request; after that time one tile is
 *    asked again, which finds a day published late. A good tile of that day clears the memory;
 *  - on a final failure throws an Error carrying the real HTTP `status` (none for a network error), so the
 *    map's error handler can decide and log truthfully. MapLibre itself does not raise an error event for a
 *    tile whose error has status 404, so the map asks this loader (isUnpublished / onUnpublished) to learn
 *    that every day is missing.
 * It returns only the bytes (no cache headers), so GIBS's no-store answers start no refresh timers.
 *
 * Limits: a tile whose server error outlasts the retries (about 4.6 s of pauses) stays missing until MapLibre
 * needs it again; during an outage each tile of the first batch costs up to four requests.
 */
export const LENS_TILE_PROTOCOL = 'lens-tile';
/** Pauses before the 2nd, 3rd and 4th attempt. Four attempts in all: bounded, 4.6 s of waiting at most. */
export const RETRY_DELAYS_MS: readonly number[] = [400, 1200, 3000];
/** How long "this day is not published" is believed before one tile is asked again. */
export const UNPUBLISHED_TTL_MS = 10 * 60_000;
/** How long after an exhausted tile the tiles of that product's still empty days get one attempt only. */
export const FAILING_TTL_MS = 30_000;

export type LensTileError = Error & { status?: number };

/** https://host/path -> lens-tile://host/path (only https sources are rewritten). */
export function withLensLoader(url: string): string {
  return url.startsWith('https://') ? `${LENS_TILE_PROTOCOL}://${url.slice('https://'.length)}` : url;
}

const toHttps = (url: string) => (url.startsWith(`${LENS_TILE_PROTOCOL}://`) ? `https://${url.slice(`${LENS_TILE_PROTOCOL}://`.length)}` : url);

/** Everything up to and including the YYYY-MM-DD path segment: one product on one day. Null for a time-less URL. */
const dayOf = (url: string) => /^(.*?\/\d{4}-\d{2}-\d{2})\//.exec(url)?.[1] ?? null;

const abortError = () => new DOMException('The lens tile request was aborted', 'AbortError');
const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

function httpError(status: number, url: string, note = ''): LensTileError {
  return Object.assign(new Error(`HTTP ${status} for ${url}${note}`), { status });
}

/** Wait `ms`, or reject with an AbortError as soon as the signal aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((ok, bad) => {
    const done = () => {
      signal.removeEventListener('abort', stop);
      ok();
    };
    const stop = () => {
      clearTimeout(t);
      bad(abortError());
    };
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}

export interface LensTileLoaderOptions {
  /** Injected in tests; defaults to the global fetch (looked up per call). */
  fetch?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  delays?: readonly number[];
  now?: () => number;
  unpublishedTtlMs?: number;
  failingTtlMs?: number;
  /** Called each time a tile is refused because its day answers 404 (fresh answer or from memory). */
  onUnpublished?: (url: string) => void;
}

/** Answers that are worth asking again: server errors, request timeout, rate limit. */
const transient = (status: number) => status >= 500 || status === 408 || status === 429;

/** One loader = one memory of delivered / unpublished / failing days. */
export function createLensTileLoader(opts: LensTileLoaderOptions = {}) {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const now = opts.now ?? Date.now;
  const ttl = opts.unpublishedTtlMs ?? UNPUBLISHED_TTL_MS;
  const failingTtl = opts.failingTtlMs ?? FAILING_TTL_MS;
  const doFetch = (url: string, signal: AbortSignal) => (opts.fetch ?? fetch)(url, { signal });
  const deliveredDays = new Set<string>();
  const unpublished = new Map<string, number>(); // day -> time of the 404
  const failing = new Map<string, number>(); // product -> time a tile of a day with nothing delivered last failed for good

  /** Is this URL's day (a tile URL or a source's tile template) currently held as "not published"? */
  const isUnpublished = (rawUrl: string) => {
    const day = dayOf(toHttps(rawUrl));
    const since = day ? unpublished.get(day) : undefined;
    return since !== undefined && now() - since < ttl;
  };

  async function loadLensTile(rawUrl: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const url = toHttps(rawUrl);
    const day = dayOf(url);
    if (isUnpublished(url)) {
      opts.onUnpublished?.(url);
      throw httpError(404, url, ' (the day answered 404 earlier; not requested again yet)');
    }
    if (day) unpublished.delete(day); // expired, if it was there
    const product = day ? day.slice(0, day.lastIndexOf('/')) : null;
    const failedAt = product ? failing.get(product) : undefined;
    const oneAttempt = failedAt !== undefined && now() - failedAt < failingTtl && !deliveredDays.has(day!);
    /** A final failure that is not a 404, on a day that has delivered nothing: remember it for the product. */
    const gaveUp = () => {
      if (product && !deliveredDays.has(day!)) failing.set(product, now());
    };
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw abortError();
      const last = oneAttempt || attempt >= delays.length;
      const tries = attempt ? ` (after ${attempt + 1} attempts)` : '';
      let res: Response;
      try {
        res = await doFetch(url, signal);
      } catch (e) {
        if (isAbort(e) || signal.aborted) throw abortError();
        if (last) {
          gaveUp();
          throw new Error(`network error for ${url}${tries}: ${(e as Error)?.message ?? String(e)}`) as LensTileError;
        }
        await pause(delays[attempt], signal);
        continue;
      }
      if (res.ok) {
        const data = await res.arrayBuffer();
        if (day) {
          // the day is published and answering, whatever an earlier tile said
          deliveredDays.add(day);
          unpublished.delete(day);
          failing.delete(product!);
        }
        return data;
      }
      if (transient(res.status) && !last) {
        await pause(delays[attempt], signal);
        continue;
      }
      // a day that has delivered tiles is published: a stray 404 there concerns that one tile only
      if (res.status === 404 && day && !deliveredDays.has(day)) {
        unpublished.set(day, now());
        opts.onUnpublished?.(url);
      } else if (transient(res.status)) gaveUp();
      throw httpError(res.status, url, tries);
    }
  }
  return Object.assign(loadLensTile, { isUnpublished });
}

let registered: ReturnType<typeof createLensTileLoader> | null = null;
const unpublishedListeners = new Set<(url: string) => void>();

/** Register once (idempotent). `addProtocol` is MapLibre's custom-protocol hook (v4+ promise API). */
export function registerLensTileProtocol(lib: {
  addProtocol: (name: string, fn: (params: { url: string }, abort: AbortController) => Promise<{ data: ArrayBuffer }>) => void;
}) {
  if (registered) return;
  const load = (registered = createLensTileLoader({ onUnpublished: (url) => unpublishedListeners.forEach((fn) => fn(url)) }));
  lib.addProtocol(LENS_TILE_PROTOCOL, async (params, abort) => ({ data: await load(params.url, abort.signal) }));
}

/** Does the registered loader currently hold this tile URL's (or tile template's) day as "not published" (404)? */
export const lensDayUnpublished = (url: string) => !!registered?.isUnpublished(url);

/** Hear about every lens tile refused because its day answers 404. Returns the unsubscribe function. */
export function onLensDayUnpublished(fn: (url: string) => void): () => void {
  unpublishedListeners.add(fn);
  return () => void unpublishedListeners.delete(fn);
}
