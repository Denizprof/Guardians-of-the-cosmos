// Defect: the coverage probe drew every product footprint at once as translucent fills, which stacked into an
// opaque blob that hid the map. Wanted: one product at a time, each viewable on its own (outline + picture).
// SYNTHETIC granules; no network.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntroPanel from '../../src/components/IntroPanel';
import { browseBounds, coverageFeatures, stepScene } from '../../src/map/coverageSelect';
import type { CoverageGranule, CoverageResult } from '../../src/services';

const g = (i: number): CoverageGranule => ({
  scene: `SCENE_${i}`,
  product: i % 2 ? 'GUNW' : 'GCOV',
  start: `2026-10-${String(29 - i).padStart(2, '0')}T16:31:00Z`,
  tier: 'PROVISIONAL',
  track: 79,
  frame: 69,
  direction: 'DESCENDING',
  thumb: `https://example.org/${i}_thumbnail.png`,
  browse: `https://example.org/${i}_LATLON.png`,
  footprint: { type: 'Polygon', coordinates: [[[34.8, 40.06], [34.0, 37.95], [36.7, 37.26], [37.6, 39.35], [34.8, 40.06]]] },
});
const many = Array.from({ length: 20 }, (_, i) => g(i));

describe('coverage footprints on the map: one at a time, never a stack', () => {
  it('draws nothing when no product is selected, however many products there are', () => {
    expect(coverageFeatures(many, null)).toEqual([]);
  });
  it('draws exactly the selected product', () => {
    const f = coverageFeatures(many, 'SCENE_7');
    expect(f).toHaveLength(1);
    expect(f[0].properties).toEqual({ scene: 'SCENE_7' });
    expect(f[0].geometry).toBe(many[7].footprint);
  });
  it('an unknown or footprint-less selection draws nothing', () => {
    expect(coverageFeatures(many, 'NOPE')).toEqual([]);
    expect(coverageFeatures([{ ...g(0), footprint: null as never }], 'SCENE_0')).toEqual([]);
  });
});

describe('placing a browse picture', () => {
  it('uses the north-up bounding box of the footprint, corners in MapLibre order (TL, TR, BR, BL)', () => {
    expect(browseBounds(many[0].footprint)).toEqual([[34.0, 40.06], [37.6, 40.06], [37.6, 37.26], [34.0, 37.26]]);
  });
  it('returns null for a missing or degenerate footprint', () => {
    expect(browseBounds(null)).toBeNull();
    expect(browseBounds({ type: 'Polygon', coordinates: [[[1, 1], [1, 1], [1, 1]]] })).toBeNull();
  });
});

// Defect: a footprint with longitudes on both sides of 180 degrees (179.4 and -179.7) was boxed by plain min
// and max, so a picture about 1 degree wide was stretched over 359 degrees, and the outline went the long way too.
describe('a footprint that crosses the antimeridian', () => {
  const crossing: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[179.4, -17], [-179.7, -17], [-179.7, -16], [179.4, -16], [179.4, -17]]] };
  // the same area as archives often deliver it: cut in two at the 180th meridian
  const split: GeoJSON.MultiPolygon = {
    type: 'MultiPolygon',
    coordinates: [
      [[[179.4, -17], [180, -17], [180, -16], [179.4, -16], [179.4, -17]]],
      [[[-180, -17], [-179.7, -17], [-179.7, -16], [-180, -16], [-180, -17]]],
    ],
  };
  const lonSpan = (geom: GeoJSON.Geometry) => {
    const c = (geom as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates.flat(geom.type === 'Polygon' ? 1 : 2) as number[][];
    const lons = c.map((p) => p[0]);
    return Math.max(...lons) - Math.min(...lons);
  };

  it('never places the picture on a box that runs the long way round the globe', () => {
    for (const fp of [crossing, split]) {
      const b = browseBounds(fp);
      if (b) expect(b[1][0] - b[0][0]).toBeLessThan(180);
    }
  });
  it('draws the outline the short way across the 180th meridian, without changing latitudes', () => {
    for (const fp of [crossing, split]) {
      const [f] = coverageFeatures([{ ...g(0), footprint: fp }], 'SCENE_0');
      expect(lonSpan(f.geometry)).toBeCloseTo(0.9, 6);
      expect(f.geometry.type).toBe(fp.type);
    }
    const [f] = coverageFeatures([{ ...g(0), footprint: crossing }], 'SCENE_0');
    expect((f.geometry as GeoJSON.Polygon).coordinates[0]).toEqual([[179.4, -17], [180.3, -17], [180.3, -16], [179.4, -16], [179.4, -17]]);
    expect(crossing.coordinates[0][1]).toEqual([-179.7, -17]); // the stored footprint is not modified
  });
});

describe('stepping through products', () => {
  it('moves to the next / previous product and stops at the ends', () => {
    expect(stepScene(many, 'SCENE_3', 1)).toBe('SCENE_4');
    expect(stepScene(many, 'SCENE_3', -1)).toBe('SCENE_2');
    expect(stepScene(many, 'SCENE_0', -1)).toBe('SCENE_0');
    expect(stepScene(many, 'SCENE_19', 1)).toBe('SCENE_19');
    expect(stepScene(many, null, 1)).toBe('SCENE_0');
  });
});

describe('coverage panel: every product can be viewed on its own', () => {
  const cov: CoverageResult = { lon: 35.4449, lat: 38.9512, total: many.length, granules: many };
  const props = (over: object = {}) => ({
    events: [], generated: '', coverage: cov, coverageState: 'idle' as const, coverageError: null, coverageMode: true,
    probe: null, collapsed: false, onSelect: vi.fn(), onCoverageMode: vi.fn(), onClearCoverage: vi.fn(), onToggleCollapsed: vi.fn(),
    selectedScene: null as string | null, onSelectScene: vi.fn(), ...over,
  });

  it('lists every product (not only the first 8) as a selectable button', () => {
    render(<IntroPanel {...props()} />);
    const list = screen.getByRole('list', { name: /NISAR products/ });
    expect(within(list).getAllByRole('button')).toHaveLength(20);
    expect(within(list).getAllByRole('button').every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
  });
  it('clicking a product selects that one', async () => {
    const p = props();
    render(<IntroPanel {...p} />);
    await userEvent.click(within(screen.getByRole('list', { name: /NISAR products/ })).getAllByRole('button')[5]);
    expect(p.onSelectScene).toHaveBeenCalledWith('SCENE_5');
  });
  it('the selected product shows its own large picture, its details and previous / next controls', async () => {
    const p = props({ selectedScene: 'SCENE_5' });
    render(<IntroPanel {...p} />);
    const viewer = screen.getByRole('group', { name: /Selected product/ });
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', 'https://example.org/5_LATLON.png');
    expect(viewer).toHaveTextContent('6 of 20');
    expect(within(screen.getByRole('list', { name: /NISAR products/ })).getAllByRole('button')[5]).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(viewer).getByRole('button', { name: /Next product/ }));
    expect(p.onSelectScene).toHaveBeenCalledWith('SCENE_6');
    await userEvent.click(within(viewer).getByRole('button', { name: /Previous product/ }));
    expect(p.onSelectScene).toHaveBeenCalledWith('SCENE_4');
  });
  // SYNTHETIC: a row whose ASF path and frame numbers were unusable arrives with no track and no frame
  // (services.ts never guesses them). It must not be counted as an orbit track of its own, and the missing
  // values must read as missing, not as a gap in the text.
  it('a product with no usable track is not counted as an orbit track and shows a dash for the missing values', () => {
    const bad = { ...g(1), scene: 'SCENE_BAD', track: undefined as never, frame: undefined as never, direction: 'UNKNOWN', product: 'UNKNOWN' };
    const three = [g(0), bad, { ...g(2), track: 80 }];
    render(<IntroPanel {...props({ coverage: { ...cov, total: 3, granules: three }, selectedScene: 'SCENE_BAD' })} />);
    const stat = screen.getByText(/^orbit tracks/).previousElementSibling!;
    expect(stat).toHaveTextContent(/^2$/);
    const item = within(screen.getByRole('list', { name: /NISAR products/ })).getAllByRole('button')[1];
    expect(item).toHaveTextContent('UNKNOWN · track – unknown · frame –');
    expect(screen.getByRole('group', { name: /Selected product/ })).toHaveTextContent('UNKNOWN · track – unknown · frame –');
  });
  it('says plainly that nothing is drawn until a product is chosen', () => {
    render(<IntroPanel {...props()} />);
    expect(screen.getByText(/Choose a product to see its picture and footprint/)).toBeInTheDocument();
  });
});

import { opaqueBounds } from '../../src/map/coverageSelect';

describe('trimming the transparent margin of a browse picture', () => {
  const img = (w: number, h: number, opaque: [number, number][]) => {
    const a = new Uint8ClampedArray(w * h * 4);
    for (const [x, y] of opaque) a[(y * w + x) * 4 + 3] = 255;
    return a;
  };
  it('finds the tight box around the data, so the data (not the margin) is placed on the footprint', () => {
    expect(opaqueBounds(img(10, 8, [[3, 2], [7, 2], [5, 6]]), 10, 8)).toEqual({ x: 3, y: 2, w: 5, h: 5 });
  });
  it('a picture without margins is kept whole, and an empty one gives null', () => {
    expect(opaqueBounds(img(2, 2, [[0, 0], [1, 1]]), 2, 2)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(opaqueBounds(img(4, 4, []), 4, 4)).toBeNull();
  });
});
