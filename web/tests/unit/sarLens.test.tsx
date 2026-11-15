import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAR_LENS_SOURCE, layerDates, lensDateLabel, lensDates, lensTileUrls, type SarLensSource } from '../../src/map/sarLens';
import { LENS_TILE_PROTOCOL } from '../../src/map/lensTiles';
import { lensStyle } from '../../src/map/style';
import SarLens, { type LensGeometry } from '../../src/components/SarLens';
import ContextPanel from '../../src/components/ContextPanel';
import type { ContextEvent } from '../../src/types';

const NOW = Date.UTC(2026, 10, 14, 9, 0, 0); // 14 Nov 2026 09:00 UTC
const fixture = (n: string) => JSON.parse(readFileSync(resolve(__dirname, '../fixtures', n), 'utf8'));
afterEach(() => vi.unstubAllGlobals());

describe('SAR lens source', () => {
  it('stacks each layer back from its own latest served day, oldest first', () => {
    const [opera, nisar] = SAR_LENS_SOURCE.layers;
    expect(layerDates(SAR_LENS_SOURCE, opera, NOW)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    // NISAR tiles for the last two UTC days were not served yet (404 when checked 14 Nov 2026), hence the 3-day lag
    expect(layerDates(SAR_LENS_SOURCE, nisar, NOW).at(-1)).toBe('2026-11-11');
    expect(lensDates(SAR_LENS_SOURCE, NOW)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  });
  it('never asks for today (tiles of the current day are incomplete)', () => {
    for (const l of SAR_LENS_SOURCE.layers) expect(layerDates(SAR_LENS_SOURCE, l, NOW)).not.toContain('2026-11-14');
  });
  it('draws the underlay first and NISAR on top, with every {time} token substituted', () => {
    const tiles = lensTileUrls(SAR_LENS_SOURCE, NOW);
    expect(tiles).toHaveLength(SAR_LENS_SOURCE.layers.reduce((n, l) => n + l.stackDays, 0));
    expect(tiles[0].url).toContain('OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1/default/2026-11-08/GoogleMapsCompatible_Level12/');
    expect(tiles.at(-1)!.url).toContain('NISAR_L2_Geocoded_Polarimetric_Covariance/default/2026-11-11/GoogleMapsCompatible_Level13/');
    expect(new Set(tiles.map((t) => t.id)).size).toBe(tiles.length);
    for (const t of tiles) {
      expect(t.url).not.toContain('{time}');
      expect(t.url).toMatch(/\{z\}\/\{y\}\/\{x\}\.png$/); // GIBS order is z/y/x
      expect(t.url.startsWith('https://gibs.earthdata.nasa.gov/')).toBe(true);
    }
  });
  it('labels the date span, and is honest that the mosaic is partial', () => {
    expect(lensDateLabel(SAR_LENS_SOURCE, NOW)).toBe('6 to 13 Nov 2026');
    expect(lensDateLabel(SAR_LENS_SOURCE, Date.UTC(2026, 11, 3))).toBe('25 Nov 2026 to 2 Dec 2026');
    expect(SAR_LENS_SOURCE.partial).toBe(true);
    expect(SAR_LENS_SOURCE.partialNote).toMatch(/gaps/);
    expect(SAR_LENS_SOURCE.provenance.join(' ')).toMatch(/no global composite/);
  });
  it('a time-less mosaic plugged in later needs no dates', () => {
    const mosaic: SarLensSource = { ...SAR_LENS_SOURCE, partial: false, layers: [{ id: 'm', tiles: 'https://example.invalid/{z}/{x}/{y}.png', tileSize: 256, minzoom: 0, maxzoom: 10, stackDays: 6, lagDays: 1 }] };
    expect(lensTileUrls(mosaic, NOW)).toEqual([{ id: 'm', date: null, url: 'https://example.invalid/{z}/{x}/{y}.png', tileSize: 256, minzoom: 0, maxzoom: 10 }]);
    expect(lensDateLabel(mosaic, NOW)).toBe('');
  });
  it('every radar source of the lens style loads through the retrying loader, never the plain <img> path', () => {
    const sources = Object.entries(lensStyle().sources).filter(([id]) => id.startsWith('lens-'));
    expect(sources).toHaveLength(SAR_LENS_SOURCE.layers.reduce((n, l) => n + l.stackDays, 0));
    for (const [, s] of sources) {
      const tiles = (s as { tiles: string[] }).tiles;
      expect(tiles).toHaveLength(1);
      expect(tiles[0].startsWith(`${LENS_TILE_PROTOCOL}://gibs.earthdata.nasa.gov/`)).toBe(true);
      expect(tiles[0]).toMatch(/\{z\}\/\{y\}\/\{x\}\.png$/);
    }
  });
  it('a fixed end date pins the stack', () => {
    const pinned: SarLensSource = { ...SAR_LENS_SOURCE, date: '2026-01-17' };
    expect(lensDates(pinned, NOW).at(-1)).toBe('2026-01-17');
  });
});

describe('SarLens frame', () => {
  const setup = (over: Partial<Parameters<typeof SarLens>[0]> = {}) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rootRef = { current: root };
    const geometry = createRef<LensGeometry | null>() as { current: LensGeometry | null };
    const props = {
      rootRef,
      geometry,
      full: false,
      label: 'NISAR over Sentinel-1 radar, 7 to 13 Nov 2026',
      note: 'mosaic of recent daily passes, with gaps',
      provenance: ['Line one about the product.', 'Line two about coverage.'],
      attribution: 'NISAR / OPERA (Sentinel-1) imagery via NASA GIBS',
      choice: null,
      insetRight: 0,
      onFull: vi.fn(),
      onClose: vi.fn(),
      ...over,
    };
    const utils = render(<SarLens {...props} />);
    return { props, root, geometry, ...utils };
  };
  const cssVar = (el: HTMLElement, n: string) => parseFloat(el.style.getPropertyValue(n));

  it('labels the view "SAR view: <source, date>" with the coverage caveat and provenance in the tooltip', () => {
    setup();
    const label = screen.getByText(/NISAR over Sentinel-1 radar, 7 to 13 Nov 2026/);
    expect(label).toHaveTextContent('SAR view: NISAR over Sentinel-1 radar, 7 to 13 Nov 2026');
    expect(label.getAttribute('title')).toContain('Line two about coverage.');
    expect(label.getAttribute('title')).toContain('NASA GIBS');
    expect(screen.getByText('mosaic of recent daily passes, with gaps')).toBeInTheDocument();
  });

  it('writes its geometry to CSS variables on the root, inside the viewport', async () => {
    const { root } = setup();
    await waitFor(() => expect(cssVar(root, '--lens-s')).toBeGreaterThanOrEqual(140));
    expect(cssVar(root, '--lens-x')).toBeGreaterThanOrEqual(8);
    expect(cssVar(root, '--lens-x') + cssVar(root, '--lens-s')).toBeLessThanOrEqual(window.innerWidth);
  });

  it('arrow keys on the grip move the square; on the corner handle they resize it', async () => {
    const { root, geometry } = setup();
    await waitFor(() => expect(geometry.current).not.toBeNull());
    const g0 = { ...geometry.current! };
    fireEvent.keyDown(screen.getByRole('button', { name: /Move SAR lens/ }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('button', { name: /Move SAR lens/ }), { key: 'ArrowDown' });
    expect(geometry.current).toMatchObject({ x: g0.x + 16, y: g0.y + 16, size: g0.size });
    fireEvent.keyDown(screen.getByRole('button', { name: /Resize SAR lens/ }), { key: 'ArrowLeft' });
    expect(geometry.current!.size).toBe(g0.size - 16);
    await waitFor(() => expect(cssVar(root, '--lens-s')).toBe(g0.size - 16));
  });

  it('cannot be shrunk below its minimum or pushed off screen', async () => {
    const { geometry } = setup();
    await waitFor(() => expect(geometry.current).not.toBeNull());
    for (let i = 0; i < 60; i++) fireEvent.keyDown(screen.getByRole('button', { name: /Resize SAR lens/ }), { key: 'ArrowUp', shiftKey: true });
    expect(geometry.current!.size).toBe(140);
    for (let i = 0; i < 60; i++) fireEvent.keyDown(screen.getByRole('button', { name: /Move SAR lens/ }), { key: 'ArrowLeft', shiftKey: true });
    expect(geometry.current!.x).toBe(8);
  });

  it('expand, restore and close call their handlers; full screen has no move or resize handles', async () => {
    const { props, rerender } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Expand SAR lens to full screen' }));
    expect(props.onFull).toHaveBeenCalledWith(true);
    rerender(<SarLens {...props} full />);
    expect(screen.queryByRole('button', { name: /Move SAR lens/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Resize SAR lens/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Restore SAR lens to a square' }));
    expect(props.onFull).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Close SAR lens' }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('the provenance button discloses the provenance text and credit', async () => {
    setup();
    const b = screen.getByRole('button', { name: 'SAR view data provenance' });
    expect(b).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(b);
    expect(b).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('note')).toHaveTextContent('Line one about the product.');
    expect(screen.getByRole('note')).toHaveTextContent('NISAR / OPERA (Sentinel-1) imagery via NASA GIBS');
  });

  it('offers the investigation layer as a lens source only when one is open', async () => {
    const onChange = vi.fn();
    setup({ choice: { value: 'base', baseLabel: 'Global mosaic', nisarLabel: 'This investigation', onChange } });
    const group = screen.getByRole('group', { name: 'SAR lens source' });
    expect(group).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'This investigation' }));
    expect(onChange).toHaveBeenCalledWith('nisar');
  });
});

describe('ContextPanel (reported / catalog event)', () => {
  const quake: ContextEvent = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/catalogs/usgs-earthquakes.json'), 'utf8')).events.find((e: ContextEvent) => e.id === 'usgs-us6000u43g');
  const landslide: ContextEvent = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/catalogs/nasa-glc.json'), 'utf8')).events[0];
  const fires: ContextEvent = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/catalogs/firms-fires.json'), 'utf8')).events[0];
  const props = (event: ContextEvent) => ({ event, collapsed: false, onCheckCoverage: vi.fn(), onClose: vi.fn(), onToggleCollapsed: vi.fn() });
  const stub = (impl: () => Promise<Response>) => {
    const f = vi.fn(impl);
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('shows the stored record at once, keeps the "not satellite-confirmed" label, then the live USGS record', async () => {
    const f = stub(async () => ({ ok: true, status: 200, json: async () => fixture('usgs-event-us6000u43g.fixture.json') }) as Response);
    render(<ContextPanel {...props(quake)} />);
    expect(screen.getByRole('heading', { level: 2, name: quake.title })).toBeInTheDocument();
    expect(screen.getByText(/Reported event from a catalog\. Not analyzed or confirmed by satellite/)).toBeInTheDocument();
    expect(screen.getByText('Stored record')).toBeInTheDocument();
    expect(screen.getByText('Requesting the full record from USGS ComCat…')).toBeInTheDocument();
    expect(await screen.findByText('Felt reports (DYFI)')).toBeInTheDocument();
    expect(screen.getByText('PAGER alert level').nextElementSibling).toHaveTextContent('orange');
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(f).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'raw API response' })).toHaveAttribute('href', 'https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=us6000u43g&format=geojson');
  });

  it('a failed live fetch shows the reason and a retry, and leaves the stored record in place', async () => {
    let fail = true;
    const f = stub(async () => (fail ? ({ ok: false, status: 503, json: async () => ({}) } as Response) : ({ ok: true, status: 200, json: async () => fixture('usgs-event-us6000u43g.fixture.json') } as Response)));
    render(<ContextPanel {...props(quake)} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('USGS ComCat request failed (HTTP 503)');
    expect(screen.getByText('Record id').nextElementSibling).toHaveTextContent('usgs-us6000u43g');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Felt reports (DYFI)')).toBeInTheDocument();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('catalogs without a per-event API say so and make no request', () => {
    const f = stub(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    render(<ContextPanel {...props(landslide)} />);
    expect(screen.getByText(/no public per-event API wired into the app/)).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
    for (const a of screen.getAllByRole('link')) expect(a.getAttribute('href')).toMatch(/^https?:\/\//);
  });

  it('a FIRMS cell is labelled as a thermal detection, not as a confirmed wildfire', () => {
    stub(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    render(<ContextPanel {...props(fires)} />);
    expect(screen.getByText(/^Satellite thermal detection \(FIRMS\)\. .*not a confirmed wildfire\.$/)).toBeInTheDocument();
    expect(screen.getByText('Detections').nextElementSibling).toHaveTextContent(String(fires.count));
  });

  it('"Satellite data here?" probes the event place and date; close calls back', async () => {
    stub(async () => ({ ok: true, status: 200, json: async () => fixture('usgs-event-us6000u43g.fixture.json') }) as Response);
    const p = props(quake);
    render(<ContextPanel {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Satellite data here?' }));
    expect(p.onCheckCoverage).toHaveBeenCalledWith(quake.lon, quake.lat, quake.date, quake.date_precision); // the record's date precision goes with it
    await userEvent.click(screen.getByRole('button', { name: 'Close event details' }));
    expect(p.onClose).toHaveBeenCalledOnce();
  });
});
