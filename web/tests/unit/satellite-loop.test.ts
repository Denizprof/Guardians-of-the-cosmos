// The mascot satellite's animation loop (map/satellite.ts): it must not keep redrawing while it cannot be seen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map as MlMap } from 'maplibre-gl';
import { attachSatellite } from '../../src/map/satellite';

/** A WebGL context where every call succeeds; `clear` is counted. */
function fakeGl() {
  const clear = vi.fn();
  const gl = new Proxy({} as Record<string, unknown>, { get: (_t, k) => (k === 'clear' ? clear : () => true) });
  return { gl, clear };
}

/** A one-triangle model file in the layout loadMesh expects. */
function modelFetch() {
  const bin = new ArrayBuffer(8 + 8 + 6);
  const head = new DataView(bin);
  head.setUint32(0, 1, true);
  head.setUint32(4, 3, true);
  const meta = { vertices: 1, triangles: 1, indexBytes: 2, materials: [{ colour: '#ffffff' }] };
  return vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => meta, arrayBuffer: async () => bin }) as unknown as Response).mockName(`fetch`) as unknown as typeof fetch;
}

function fakeMap(zoom: { value: number }) {
  const handlers: Record<string, (() => void)[]> = {};
  const box = { clientWidth: 800, clientHeight: 600, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const map = {
    getZoom: () => zoom.value,
    getCenter: () => ({ lng: 0, lat: 0 }),
    project: () => ({ x: 400, y: 300 }),
    getContainer: () => box,
    getPitch: () => 0,
    getBearing: () => 0,
    getVerticalFieldOfView: () => 36.87,
    loaded: () => true,
    once: () => undefined,
    on: (name: string, fn: () => void) => { (handlers[name] ??= []).push(fn); },
    off: (name: string, fn: () => void) => { handlers[name] = (handlers[name] ?? []).filter((f) => f !== fn); },
  };
  return { map: map as unknown as MlMap, fire: (name: string) => (handlers[name] ?? []).forEach((f) => f()) };
}

describe('satellite animation loop', () => {
  let frames: FrameRequestCallback[];
  let now: number;
  /** Run the frames that are queued now (not the ones they queue in turn). */
  const runFrames = () => { now += 40; frames.splice(0).forEach((f) => f(now)); };
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  beforeEach(() => {
    frames = [];
    now = 1000;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
    vi.stubGlobal('fetch', modelFetch());
  });
  afterEach(() => vi.unstubAllGlobals());

  const attach = (zoomValue: number) => {
    const { gl, clear } = fakeGl();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl as unknown as RenderingContext);
    const host = document.createElement('div');
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const zoom = { value: zoomValue };
    const { map, fire } = fakeMap(zoom);
    const remove = attachSatellite(map, host, { onAsk: () => undefined, still: () => false });
    return { zoom, fire, clear, remove, host };
  };

  it('keeps animating while the globe is zoomed out and the satellite can be seen', async () => {
    const { remove } = attach(1.5);
    await settle();
    for (let i = 0; i < 5; i++) { expect(frames.length).toBe(1); runFrames(); }
    remove();
  });

  it('stops requesting frames once zoomed in past its limit, and draws nothing more', async () => {
    const { clear, remove, host } = attach(6);
    await settle();
    runFrames();
    runFrames();
    expect(frames.length).toBe(0);
    const clears = clear.mock.calls.length;
    runFrames();
    expect(clear.mock.calls.length).toBe(clears);
    expect((host.querySelector('.sat-canvas') as HTMLCanvasElement).style.opacity).toBe('0');
    remove();
  });

  it('starts again when the map moves back into range', async () => {
    const { zoom, fire, clear, remove } = attach(6);
    await settle();
    runFrames();
    runFrames();
    expect(frames.length).toBe(0);
    fire('move'); // still zoomed in: one check, then idle again
    runFrames();
    expect(frames.length).toBe(0);
    zoom.value = 2;
    fire('move');
    expect(frames.length).toBe(1);
    const clears = clear.mock.calls.length;
    for (let i = 0; i < 3; i++) { runFrames(); expect(frames.length).toBe(1); }
    expect(clear.mock.calls.length).toBeGreaterThan(clears);
    remove();
  });
});
