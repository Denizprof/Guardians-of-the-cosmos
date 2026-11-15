// Regression tests for the map-core audit findings (overlays.ts helpers used by MapView).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as MlMap } from 'maplibre-gl';
import type { SarLayer } from '../../src/types';
import * as overlays from '../../src/map/overlays';

type Coords = [[number, number], [number, number], [number, number], [number, number]];
const A: Coords = [[-105.4, 38.3], [-105.2, 38.3], [-105.2, 38.1], [-105.4, 38.1]];
const B: Coords = [[-54.2, -11.2], [-54.0, -11.2], [-54.0, -11.4], [-54.2, -11.4]];
const sar = (id: string, url: string, coordinates: Coords) => ({ id, url, coordinates }) as unknown as SarLayer;

/** A minimal MapLibre map: sources and ordered layers, with every image load recorded. */
function fakeMap(initialLayers: { id: string; type: string; source?: string }[] = [{ id: 'label-city', type: 'symbol' }]) {
  const sources: Record<string, any> = {};
  let layers: any[] = [...initialLayers];
  const loads: { id: string; url: string; coordinates: unknown }[] = [];
  const map = {
    getStyle: () => ({ layers: [...layers], sources: { ...sources } }),
    getSource: (id: string) => {
      const s = sources[id];
      if (!s) return undefined;
      return {
        ...s,
        updateImage: (o: { url: string; coordinates: unknown }) => {
          Object.assign(s, o);
          loads.push({ id, ...o });
        },
      };
    },
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addSource: (id: string, spec: any) => {
      if (sources[id]) throw new Error(`source ${id} exists`);
      sources[id] = { ...spec };
      if (spec.type === 'image') loads.push({ id, url: spec.url, coordinates: spec.coordinates });
    },
    removeSource: (id: string) => {
      if (layers.some((l) => l.source === id)) throw new Error(`source ${id} in use`);
      delete sources[id];
    },
    addLayer: (l: any, before?: string) => {
      const i = before ? layers.findIndex((x) => x.id === before) : -1;
      if (i < 0) layers.push(l);
      else layers.splice(i, 0, l);
    },
    removeLayer: (id: string) => {
      layers = layers.filter((l) => l.id !== id);
    },
    moveLayer: (id: string, before?: string) => {
      const l = layers.find((x) => x.id === id);
      layers = layers.filter((x) => x.id !== id);
      const i = before ? layers.findIndex((x) => x.id === before) : -1;
      if (i < 0) layers.push(l);
      else layers.splice(i, 0, l);
    },
    setPaintProperty: vi.fn(),
  };
  return { map: map as unknown as MlMap, sources, loads, ids: () => layers.map((l) => l.id) };
}

describe('syncImageLayers: two investigations sharing a layer id (finding 20)', () => {
  it('loads the other picture and position when the same layer id arrives with new content', () => {
    const f = fakeMap();
    overlays.syncImageLayers(f.map, [{ layer: sar('hv_change', 'data/events/aspen/hv_change.webp', A), opacity: 1 }]);
    overlays.syncImageLayers(f.map, [{ layer: sar('hv_change', 'data/events/uniao/hv_change.webp', B), opacity: 1 }]);
    expect(f.sources['sar-hv_change'].url).toBe('data/events/uniao/hv_change.webp');
    expect(f.sources['sar-hv_change'].coordinates).toEqual(B);
    expect(f.loads.at(-1)).toMatchObject({ url: 'data/events/uniao/hv_change.webp', coordinates: B });
    expect(f.ids()).toEqual(['sar-hv_change', 'label-city']);
  });
  it('does not reload the picture when the same layer is synced again (opacity only)', () => {
    const f = fakeMap();
    const layer = sar('hv_change', 'a.webp', A);
    overlays.syncImageLayers(f.map, [{ layer, opacity: 1 }]);
    overlays.syncImageLayers(f.map, [{ layer: { ...layer }, opacity: 0.5 }]);
    expect(f.loads).toHaveLength(1);
    expect((f.map.setPaintProperty as any).mock.calls.at(-1)).toEqual(['sar-hv_change', 'raster-opacity', 0.5]);
  });
  it('a layer removed and shown again with other content is loaded fresh', () => {
    const f = fakeMap();
    overlays.syncImageLayers(f.map, [{ layer: sar('hv_change', 'a.webp', A), opacity: 1 }]);
    overlays.syncImageLayers(f.map, []);
    expect(f.sources['sar-hv_change']).toBeUndefined();
    overlays.syncImageLayers(f.map, [{ layer: sar('hv_change', 'b.webp', B), opacity: 1 }]);
    expect(f.sources['sar-hv_change']).toMatchObject({ url: 'b.webp', coordinates: B });
  });
});

describe('SAR lens drop policy (finding 21)', () => {
  it('three early failures only arm the drop; nothing is dropped before the grace period ends', () => {
    const p = overlays.createLensDropPolicy(3);
    expect(p.failed('lens-a', 500).action).toBe('log');
    expect(p.failed('lens-a', 500).action).toBe('log');
    expect(p.failed('lens-a', 500)).toEqual({ action: 'arm', count: 3 });
    expect(p.dropped()).toEqual([]);
    expect(p.failed('lens-a', 500).action).toBe('log'); // armed once, not once per further failure
  });
  it('a tile delivered during the grace period cancels the drop', () => {
    const p = overlays.createLensDropPolicy(3);
    for (let i = 0; i < 3; i++) p.failed('lens-a', 500);
    p.delivered('lens-a');
    expect(p.graceElapsed('lens-a')).toEqual({ drop: false, notify: false });
    expect(p.dropped()).toEqual([]);
  });
  it('a source that has delivered tiles is never armed', () => {
    const p = overlays.createLensDropPolicy(3);
    p.delivered('lens-a');
    for (let i = 0; i < 5; i++) expect(p.failed('lens-a', 500).action).toBe('log');
  });
  it('a drop is reported unless the answer says "no such day" (404 / 410): 403 or 429 are failures, not absence', () => {
    const p = overlays.createLensDropPolicy(3);
    for (let i = 0; i < 3; i++) p.failed('lens-a', 500);
    for (let i = 0; i < 3; i++) p.failed('lens-b', undefined);
    for (let i = 0; i < 3; i++) p.failed('lens-c', 410);
    for (let i = 0; i < 3; i++) p.failed('lens-d', 403);
    for (let i = 0; i < 3; i++) p.failed('lens-e', 429);
    expect(p.graceElapsed('lens-a')).toEqual({ drop: true, notify: true });
    expect(p.graceElapsed('lens-b')).toEqual({ drop: true, notify: true });
    expect(p.graceElapsed('lens-c')).toEqual({ drop: true, notify: false });
    expect(p.graceElapsed('lens-d')).toEqual({ drop: true, notify: true });
    expect(p.graceElapsed('lens-e')).toEqual({ drop: true, notify: true });
    expect(p.graceElapsed('lens-a')).toEqual({ drop: false, notify: false }); // already dropped
    expect(p.dropped().sort()).toEqual(['lens-a', 'lens-b', 'lens-c', 'lens-d', 'lens-e']);
    expect(p.retry().sort()).toEqual(['lens-a', 'lens-b', 'lens-d', 'lens-e']); // the failures get another attempt
  });
  it('retry() hands back the dropped sources with their counters reset, so they can fail or recover afresh', () => {
    const p = overlays.createLensDropPolicy(3);
    for (let i = 0; i < 3; i++) p.failed('lens-a', 500);
    p.graceElapsed('lens-a');
    expect(p.retry()).toEqual(['lens-a']);
    expect(p.dropped()).toEqual([]);
    expect(p.retry()).toEqual([]);
    expect(p.failed('lens-a', 500)).toEqual({ action: 'log', count: 1 });
    p.failed('lens-a', 500);
    expect(p.failed('lens-a', 500).action).toBe('arm');
  });
  // In the browser MapLibre raises no error event for a status-404 tile, so 404 reaches the policy only if that changes; 410 does today.
  it('a day dropped on "no such day" (404 / 410) is not handed back by retry(): no re-request after every camera stop', () => {
    const p = overlays.createLensDropPolicy(3);
    p.failed('lens-late', 410);
    for (let i = 0; i < 2; i++) p.failed('lens-late', 404);
    for (let i = 0; i < 3; i++) p.failed('lens-flaky', 500);
    for (let i = 0; i < 3; i++) p.failed('lens-offline', undefined);
    expect(p.graceElapsed('lens-late')).toEqual({ drop: true, notify: false });
    expect(p.graceElapsed('lens-flaky')).toEqual({ drop: true, notify: true });
    expect(p.graceElapsed('lens-offline')).toEqual({ drop: true, notify: true });
    expect(p.retry().sort()).toEqual(['lens-flaky', 'lens-offline']);
    expect(p.dropped()).toEqual(['lens-late']); // stays off the stack
    expect(p.retry()).toEqual([]);
  });
});

describe('detachLayer / reattachLayer (finding 21: a dropped lens day can come back)', () => {
  const stack = () =>
    fakeMap([
      { id: 'background', type: 'background' },
      { id: 'lens-1', type: 'raster', source: 'lens-1' },
      { id: 'lens-2', type: 'raster', source: 'lens-2' },
      { id: 'lens-3', type: 'raster', source: 'lens-3' },
      { id: 'boundary', type: 'line' },
    ]);
  it('puts dropped layers back in their original place, whatever the drop order', () => {
    const f = stack();
    for (const id of ['lens-1', 'lens-2', 'lens-3']) f.map.addSource(id, { type: 'raster', tiles: [`https://example.invalid/${id}/{z}/{y}/{x}.png`] });
    const order = f.ids();
    const d2 = overlays.detachLayer(f.map, 'lens-2')!;
    const d1 = overlays.detachLayer(f.map, 'lens-1')!;
    expect(f.ids()).toEqual(['background', 'lens-3', 'boundary']);
    expect(f.sources['lens-1']).toBeUndefined();
    overlays.reattachLayer(f.map, d2, order);
    overlays.reattachLayer(f.map, d1, order);
    expect(f.ids()).toEqual(order);
    expect(f.sources['lens-2'].tiles).toEqual(['https://example.invalid/lens-2/{z}/{y}/{x}.png']);
    overlays.reattachLayer(f.map, d1, order); // already back: no duplicate, no throw
    expect(f.ids()).toEqual(order);
  });
  it('returns null for a layer that is not on the map', () => {
    expect(overlays.detachLayer(stack().map, 'lens-9')).toBeNull();
  });
});

describe('leaseObjectUrl (finding 22: coverage browse picture)', () => {
  const deferred = <T,>() => {
    let ok!: (v: T) => void;
    let bad!: (e: unknown) => void;
    const promise = new Promise<T>((a, b) => ((ok = a), (bad = b)));
    return { promise, ok, bad };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const original = URL.revokeObjectURL;
  afterEach(() => {
    URL.revokeObjectURL = original;
  });
  const spyRevoke = () => {
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    return revoke;
  };

  it('revokes a URL that arrives after the lease was released, and never hands it over', async () => {
    const revoke = spyRevoke();
    const d = deferred<string>();
    const use = vi.fn();
    const fail = vi.fn();
    let signal!: AbortSignal;
    const release = overlays.leaseObjectUrl((s) => ((signal = s), d.promise), use, fail);
    release(); // selection changed while the picture was still being decoded
    expect(signal.aborted).toBe(true);
    d.ok('blob:late');
    await flush();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:late');
    expect(use).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });
  it('hands over a URL that arrives in time and revokes it once on release', async () => {
    const revoke = spyRevoke();
    const use = vi.fn();
    const release = overlays.leaseObjectUrl(async () => 'blob:ok', use, vi.fn());
    await flush();
    expect(use).toHaveBeenCalledWith('blob:ok');
    expect(revoke).not.toHaveBeenCalled();
    release();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:ok');
  });
  it('reports a failed load, but not one that was cancelled', async () => {
    spyRevoke();
    const fail = vi.fn();
    overlays.leaseObjectUrl(() => Promise.reject(new Error('HTTP 503')), vi.fn(), fail);
    await flush();
    expect(fail).toHaveBeenCalledTimes(1);
    const d = deferred<string>();
    const fail2 = vi.fn();
    overlays.leaseObjectUrl(() => d.promise, vi.fn(), fail2)();
    d.bad(new DOMException('aborted', 'AbortError'));
    await flush();
    expect(fail2).not.toHaveBeenCalled();
  });
});
