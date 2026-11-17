import { describe, expect, it } from 'vitest';
import { boxAreaKm2, boxCenter, boxRing, boxSizeKm, fetchElevation, inBox, normalizeBox, pointBox, samplePoints, summarizeArea } from '../../src/inspect';
import type { ContextEvent, SarEvent } from '../../src/types';

const quake = (id: string, lon: number, lat: number, magnitude: number, date: string): ContextEvent => ({ id, title: id, category: 'earthquake', date, lon, lat, magnitude, source: 'USGS', url: 'https://example.org' });
const fire = (id: string, lon: number, lat: number, date: string): ContextEvent => ({ id, title: id, category: 'wildfire', date, lon, lat, source: 'EONET', url: 'https://example.org' });
const inv = (id: string, lon: number, lat: number): SarEvent => ({ id, title: id, subtitle: 'sub', category: 'earthquake', date: null, location: { lon, lat }, technique: 'insar', references: [], layers: [] });

describe('box maths', () => {
  it('orders the corners and cuts the poles', () => {
    expect(normalizeBox({ lon: 10, lat: 40 }, { lon: 2, lat: 30 })).toEqual([2, 30, 10, 40]);
    expect(normalizeBox({ lon: 0, lat: -90 }, { lon: 1, lat: 90 })).toEqual([0, -85, 1, 85]);
  });
  it('measures a one-degree box at the equator as about 12,300 km²', () => {
    expect(boxAreaKm2([0, 0, 1, 1])).toBeGreaterThan(12300);
    expect(boxAreaKm2([0, 0, 1, 1])).toBeLessThan(12400);
  });
  it('shrinks east-west width with latitude', () => {
    expect(boxSizeKm([0, 60, 1, 61]).widthKm).toBeLessThan(boxSizeKm([0, 0, 1, 1]).widthKm / 1.8);
  });
  it('a click makes a box about 100 km across, centred on the click', () => {
    const b = pointBox(30, 40);
    const c = boxCenter(b);
    expect(c.lon).toBeCloseTo(30, 6);
    expect(c.lat).toBeCloseTo(40, 6);
    const { widthKm, heightKm } = boxSizeKm(b);
    expect(heightKm).toBeGreaterThan(99);
    expect(heightKm).toBeLessThan(101);
    expect(widthKm).toBeGreaterThan(95);
    expect(widthKm).toBeLessThan(105);
  });
  it('draws a closed ring and samples a 3 x 3 grid with the centre in the middle', () => {
    const ring = boxRing([0, 0, 2, 2]);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const pts = samplePoints([0, 0, 2, 2]);
    expect(pts).toHaveLength(9);
    expect(pts[4]).toEqual({ lon: 1, lat: 1 });
  });
  it('inBox includes the edges', () => {
    expect(inBox([0, 0, 1, 1], 1, 1)).toBe(true);
    expect(inBox([0, 0, 1, 1], 1.01, 0.5)).toBe(false);
  });
});

describe('summarizeArea', () => {
  const box: [number, number, number, number] = [26, 36, 45, 42];
  const ctx = [quake('q1', 30, 38, 5.1, '2026-01-02'), quake('q2', 35, 39, 6.4, '2025-05-01'), fire('f1', 31, 37, '2026-03-04'), quake('far', 100, 10, 8, '2026-06-01')];
  it('counts only what lies inside and finds the strongest quake and the newest event', () => {
    const s = summarizeArea(box, ctx, []);
    expect(s.total).toBe(3);
    expect(s.byCategory).toEqual([{ category: 'earthquake', count: 2 }, { category: 'wildfire', count: 1 }]);
    expect(s.strongestQuake?.id).toBe('q2');
    expect(s.latest?.id).toBe('f1');
    expect(s.top[0].id).toBe('q2');
  });
  it('says there is nothing inside an empty box instead of inventing events', () => {
    const s = summarizeArea([0, 0, 1, 1], ctx, []);
    expect(s.total).toBe(0);
    expect(s.strongestQuake).toBeNull();
    expect(s.latest).toBeNull();
  });
  it('lists the investigations in the box, including their extra points', () => {
    const withExtra = { ...inv('b', 100, 10), extra_points: [{ label: 'x', lon: 30, lat: 38 }] };
    const s = summarizeArea(box, [], [inv('a', 29, 38), withExtra, inv('c', 100, 10)]);
    expect(s.investigations.map((e) => e.id)).toEqual(['a', 'b']);
  });
  it('limits the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => quake(`m${i}`, 30, 38, i / 10, '2026-01-01'));
    expect(summarizeArea(box, many, [], 5).top).toHaveLength(5);
  });
});

describe('fetchElevation', () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const ctl = new AbortController();
  it('summarises the nine samples', async () => {
    const e = await fetchElevation([0, 0, 1, 1], ctl.signal, ok({ elevation: [10, 20, 30, 40, 50, 60, 70, 80, 90] }));
    expect(e).toEqual({ min: 10, max: 90, mean: 50, centre: 50, samples: 9 });
  });
  it('asks for nine points of the box in one request', async () => {
    let url = '';
    const spy = (async (u: string) => { url = u; return new Response(JSON.stringify({ elevation: new Array(9).fill(1) })); }) as unknown as typeof fetch;
    await fetchElevation([0, 0, 1, 1], ctl.signal, spy);
    expect(url).toContain('https://api.open-meteo.com/v1/elevation?');
    expect(new URL(url).searchParams.get('latitude')?.split(',')).toHaveLength(9);
  });
  it('rejects an error status and a malformed answer', async () => {
    await expect(fetchElevation([0, 0, 1, 1], ctl.signal, ok({}, 500))).rejects.toThrow('HTTP 500');
    await expect(fetchElevation([0, 0, 1, 1], ctl.signal, ok({ elevation: [1, 2] }))).rejects.toThrow('unexpected');
    await expect(fetchElevation([0, 0, 1, 1], ctl.signal, ok({ elevation: [1, 2, 3, 4, 5, 6, 7, 8, 'x'] }))).rejects.toThrow('unexpected');
  });
});
