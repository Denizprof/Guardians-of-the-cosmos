// SAR lens radar tile loader (map/lensTiles.ts): a transient server error is asked for again a bounded number
// of times; a day that is not published (HTTP 404) is not retried and not re-requested; a lasting failure
// rejects with the real HTTP status so the map's error handler can report it truthfully.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LENS_TILE_PROTOCOL, createLensTileLoader, lensDayUnpublished, onLensDayUnpublished, registerLensTileProtocol, withLensLoader } from '../../src/map/lensTiles';

const DAY = 'https://gibs.example/wmts/best/OPERA/default/2026-11-10/Level12';
const OTHER_DAY = 'https://gibs.example/wmts/best/OPERA/default/2026-11-11/Level12';
const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
const http = (status: number) => new Response('<html>error</html>', { status, headers: { 'content-type': 'text/html' } });

/** A fetch that answers from a script, one entry per call (the last entry repeats). */
function scripted(...answers: Array<() => Response | Promise<Response>>) {
  let i = 0;
  return vi.fn(async (_url: string, _init?: { signal?: AbortSignal }) => answers[Math.min(i++, answers.length - 1)]());
}

/** Run a loader call to its end under fake timers; returns the settled outcome. */
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: any }> {
  const out = p.then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
  await vi.runAllTimersAsync();
  return out;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SAR lens tile loader', () => {
  it('rewrites only https tile URLs to the loader scheme, and back', () => {
    expect(withLensLoader(`${DAY}/{z}/{y}/{x}.png`)).toBe(`${LENS_TILE_PROTOCOL}://gibs.example/wmts/best/OPERA/default/2026-11-10/Level12/{z}/{y}/{x}.png`);
    expect(withLensLoader('/local/{z}/{x}/{y}.png')).toBe('/local/{z}/{x}/{y}.png');
  });

  it('a transient HTTP 500 is asked for again and the tile loads (no hole)', async () => {
    const fetch = scripted(() => http(500), png);
    const load = createLensTileLoader({ fetch });
    const r = await settle(load(`${DAY}/3/3/4.png`, new AbortController().signal));
    expect(r.ok).toBe(true);
    expect(new Uint8Array((r as { value: ArrayBuffer }).value)).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe(`${DAY}/3/3/4.png`); // the real https URL, same one both times
    expect(fetch.mock.calls[1][0]).toBe(`${DAY}/3/3/4.png`);
  });

  it('accepts the loader-scheme URL MapLibre hands to a custom protocol', async () => {
    const fetch = scripted(png);
    const load = createLensTileLoader({ fetch });
    await settle(load(withLensLoader(`${DAY}/3/3/4.png`), new AbortController().signal));
    expect(fetch.mock.calls[0][0]).toBe(`${DAY}/3/3/4.png`);
  });

  it('a short network drop is retried too', async () => {
    const fetch = scripted(() => Promise.reject(new TypeError('Failed to fetch')), png);
    const r = await settle(createLensTileLoader({ fetch })(`${DAY}/3/3/4.png`, new AbortController().signal));
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a lasting HTTP 500 gives up after 4 attempts and rejects with the real status', async () => {
    const fetch = scripted(() => http(500));
    const r = await settle(createLensTileLoader({ fetch })(`${DAY}/3/3/4.png`, new AbortController().signal));
    expect(r.ok).toBe(false);
    const { error } = r as { error: Error & { status?: number } };
    expect(error.status).toBe(500);
    expect(error.message).toMatch(/HTTP 500/);
    expect(error.message).toMatch(/after 4 attempts/);
    expect(error.message).not.toMatch(/image type/i);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('a 500 that lasts a few seconds (seen on GIBS: up to about 4 s) is still outlasted', async () => {
    const fetch = scripted(() => http(500), () => http(500), () => http(500), png);
    const r = await settle(createLensTileLoader({ fetch })(`${DAY}/3/3/4.png`, new AbortController().signal));
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('HTTP 429 and 408 (rate limit, timeout) are transient too: asked again, not treated as "no such day"', async () => {
    for (const status of [429, 408]) {
      const fetch = scripted(() => http(status), png);
      const r = await settle(createLensTileLoader({ fetch })(`${DAY}/3/3/4.png`, new AbortController().signal));
      expect(r.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it('once a tile of a product has outlasted the retries, tiles of its days that have delivered nothing get one attempt for a while (no queue held by pauses)', async () => {
    let now = 1_000_000;
    const fetch = scripted(() => http(500));
    const load = createLensTileLoader({ fetch, now: () => now, failingTtlMs: 30_000 });
    await settle(load(`${DAY}/3/3/4.png`, new AbortController().signal));
    expect(fetch).toHaveBeenCalledTimes(4);
    const b = await settle(load(`${DAY}/3/3/5.png`, new AbortController().signal));
    expect((b as { error: { status?: number } }).error.status).toBe(500);
    expect(fetch).toHaveBeenCalledTimes(5); // one attempt only
    await settle(load(`${OTHER_DAY}/3/3/4.png`, new AbortController().signal));
    expect(fetch).toHaveBeenCalledTimes(6); // another day of the same product: one attempt too
    await settle(load(`${DAY.replace('OPERA', 'NISAR')}/3/3/4.png`, new AbortController().signal));
    expect(fetch).toHaveBeenCalledTimes(10); // another product keeps its full retries
    now += 30_001; // each failure renews the memory, so step past the last one
    await settle(load(`${DAY}/3/3/6.png`, new AbortController().signal));
    expect(fetch).toHaveBeenCalledTimes(14); // memory expired: full retries again
  });

  it('a day that has delivered tiles keeps its retries while another day of the product is failing', async () => {
    const fetch = vi.fn(async (url: string, _init?: { signal?: AbortSignal }) => (url.startsWith(OTHER_DAY) ? http(500) : png()));
    const load = createLensTileLoader({ fetch });
    await settle(load(`${DAY}/3/3/4.png`, new AbortController().signal)); // delivered
    await settle(load(`${OTHER_DAY}/3/3/4.png`, new AbortController().signal)); // 4 x 500: the product is marked
    expect(fetch).toHaveBeenCalledTimes(5);
    fetch.mockImplementationOnce(async () => http(500));
    expect((await settle(load(`${DAY}/3/3/5.png`, new AbortController().signal))).ok).toBe(true); // 500, asked again, good
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  it('a good tile ends the one-attempt mode, and a day that has delivered always keeps its retries', async () => {
    const fetch = scripted(() => http(500), () => http(500), () => http(500), () => http(500), png, () => http(500), png);
    const load = createLensTileLoader({ fetch });
    await settle(load(`${DAY}/3/3/4.png`, new AbortController().signal)); // 4 x 500
    expect((await settle(load(`${DAY}/3/3/5.png`, new AbortController().signal))).ok).toBe(true); // 1 attempt, good
    expect(fetch).toHaveBeenCalledTimes(5);
    expect((await settle(load(`${DAY}/3/3/6.png`, new AbortController().signal))).ok).toBe(true); // 500, then asked again
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  it('a lasting network failure rejects without a status and says so', async () => {
    const fetch = scripted(() => Promise.reject(new TypeError('Failed to fetch')));
    const r = await settle(createLensTileLoader({ fetch })(`${DAY}/3/3/4.png`, new AbortController().signal));
    const { error } = r as { error: Error & { status?: number } };
    expect(r.ok).toBe(false);
    expect(error.status).toBeUndefined();
    expect(error.message).toMatch(/network/i);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('pauses between attempts (bounded: 400 ms, 1200 ms, 3000 ms)', async () => {
    const fetch = scripted(() => http(503));
    const p = createLensTileLoader({ fetch })(`${DAY}/3/3/4.png`, new AbortController().signal).catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(399);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1199);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(((await p) as { status?: number }).status).toBe(503);
  });

  it('an aborted request is not retried and rejects with an AbortError', async () => {
    const ac = new AbortController();
    ac.abort();
    const fetch = scripted(() => http(500));
    const r = await settle(createLensTileLoader({ fetch })(`${DAY}/3/3/4.png`, ac.signal));
    expect(r.ok).toBe(false);
    expect((r as { error: Error }).error.name).toBe('AbortError');
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it('an abort during the pause stops the retries', async () => {
    const ac = new AbortController();
    const fetch = scripted(() => http(500));
    const p = createLensTileLoader({ fetch })(`${DAY}/3/3/4.png`, ac.signal).catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    ac.abort();
    await vi.runAllTimersAsync();
    expect(((await p) as Error).name).toBe('AbortError');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('HTTP 404 (day not published) is not retried, and further tiles of that day make no request', async () => {
    const fetch = scripted(() => http(404));
    const load = createLensTileLoader({ fetch });
    const a = await settle(load(`${DAY}/3/3/4.png`, new AbortController().signal));
    expect((a as { error: { status?: number } }).error.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
    const b = await settle(load(`${DAY}/3/3/5.png`, new AbortController().signal));
    expect(b.ok).toBe(false);
    expect((b as { error: { status?: number } }).error.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1); // answered from memory
    await settle(load(`${OTHER_DAY}/3/3/4.png`, new AbortController().signal));
    expect(fetch).toHaveBeenCalledTimes(2); // another day is still asked
    expect(fetch.mock.calls[1][0]).toBe(`${OTHER_DAY}/3/3/4.png`);
  });

  it('the "not published" memory expires, so a day published later is found (one probe per period)', async () => {
    let now = 1_000_000;
    const fetch = scripted(() => http(404), png);
    const load = createLensTileLoader({ fetch, now: () => now, unpublishedTtlMs: 600_000 });
    await settle(load(`${DAY}/3/3/4.png`, new AbortController().signal));
    now += 599_999;
    await settle(load(`${DAY}/3/3/5.png`, new AbortController().signal));
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 1;
    const r = await settle(load(`${DAY}/3/3/5.png`, new AbortController().signal));
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a 404 on one tile of a day that has delivered tiles does not silence the whole day', async () => {
    const fetch = scripted(png, () => http(404), png);
    const load = createLensTileLoader({ fetch });
    await settle(load(`${DAY}/3/3/4.png`, new AbortController().signal));
    const miss = await settle(load(`${DAY}/3/3/5.png`, new AbortController().signal));
    expect((miss as { error: { status?: number } }).error.status).toBe(404);
    const r = await settle(load(`${DAY}/3/3/6.png`, new AbortController().signal));
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('a 404 that comes back before the first good tile of the same day does not silence that day', async () => {
    // the first view asks a day's tiles together: here the 404 answer returns first, the 200 second
    let release!: (r: Response) => void;
    const slow = new Promise<Response>((ok) => (release = ok));
    const fetch = vi.fn(async (url: string, _init?: { signal?: AbortSignal }) => (url.endsWith('/4.png') ? http(404) : url.endsWith('/5.png') ? slow : png()));
    const load = createLensTileLoader({ fetch });
    const good = load(`${DAY}/3/3/5.png`, new AbortController().signal); // in flight ...
    const miss = await settle(load(`${DAY}/3/3/4.png`, new AbortController().signal)); // ... while this one answers 404
    expect((miss as { error: { status?: number } }).error.status).toBe(404);
    expect(load.isUnpublished(`${DAY}/3/3/9.png`)).toBe(true); // all that is known so far
    release(png());
    expect((await settle(good)).ok).toBe(true);
    expect(load.isUnpublished(`${DAY}/3/3/9.png`)).toBe(false); // the day is published after all
    const r = await settle(load(`${DAY}/3/3/6.png`, new AbortController().signal));
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3); // the third tile was really requested
  });

  it('says which days it holds as not published, and tells a listener each time a tile is refused for that reason', async () => {
    let now = 1_000_000;
    const seen: string[] = [];
    const fetch = scripted(() => http(404));
    const load = createLensTileLoader({ fetch, now: () => now, unpublishedTtlMs: 600_000, onUnpublished: (url) => seen.push(url) });
    expect(load.isUnpublished(`${DAY}/3/3/4.png`)).toBe(false);
    await settle(load(`${DAY}/3/3/4.png`, new AbortController().signal));
    expect(load.isUnpublished(withLensLoader(`${DAY}/{z}/{y}/{x}.png`))).toBe(true); // a source's tile template works too
    expect(load.isUnpublished(`${OTHER_DAY}/3/3/4.png`)).toBe(false);
    await settle(load(`${DAY}/3/3/5.png`, new AbortController().signal)); // from memory: still reported
    expect(seen).toEqual([`${DAY}/3/3/4.png`, `${DAY}/3/3/5.png`]);
    now += 600_000;
    expect(load.isUnpublished(`${DAY}/3/3/4.png`)).toBe(false); // expired: not claimed any more
  });

  it('other 4xx answers are not retried and keep their status', async () => {
    const fetch = scripted(() => http(400));
    const r = await settle(createLensTileLoader({ fetch })(`${DAY}/3/3/4.png`, new AbortController().signal));
    expect((r as { error: { status?: number } }).error.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('registers the protocol once and hands MapLibre only the bytes (no cache headers, so no refresh timers)', async () => {
    const addProtocol = vi.fn();
    const fetch = scripted(png);
    vi.stubGlobal('fetch', fetch);
    try {
      registerLensTileProtocol({ addProtocol });
      registerLensTileProtocol({ addProtocol });
      expect(addProtocol).toHaveBeenCalledTimes(1);
      expect(addProtocol.mock.calls[0][0]).toBe(LENS_TILE_PROTOCOL);
      const out = await addProtocol.mock.calls[0][1]({ url: withLensLoader(`${DAY}/1/0/1.png`) }, new AbortController());
      expect(Object.keys(out)).toEqual(['data']);
      expect(out.data).toBeInstanceOf(ArrayBuffer);
      expect(fetch.mock.calls[0][0]).toBe(`${DAY}/1/0/1.png`);
      // the registered loader's "not published" memory is readable by the map (MapView: every day missing = a notice)
      const heard: string[] = [];
      const off = onLensDayUnpublished((url) => heard.push(url));
      fetch.mockImplementation(async () => http(404));
      await addProtocol.mock.calls[0][1]({ url: withLensLoader(`${OTHER_DAY}/1/0/1.png`) }, new AbortController()).catch(() => {});
      expect(lensDayUnpublished(withLensLoader(`${OTHER_DAY}/{z}/{y}/{x}.png`))).toBe(true);
      expect(lensDayUnpublished(withLensLoader(`${DAY}/{z}/{y}/{x}.png`))).toBe(false);
      expect(heard).toEqual([`${OTHER_DAY}/1/0/1.png`]);
      off();
      await addProtocol.mock.calls[0][1]({ url: withLensLoader(`${OTHER_DAY}/1/0/2.png`) }, new AbortController()).catch(() => {});
      expect(heard).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
