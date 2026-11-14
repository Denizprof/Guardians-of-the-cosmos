import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Timeline from '../../src/components/Timeline';
import EventPanel from '../../src/components/EventPanel';
import SearchBox from '../../src/components/SearchBox';
import IntroPanel from '../../src/components/IntroPanel';
import { nisarCoverage, type CoverageResult } from '../../src/services';
import { syntheticEvent, syntheticPairEvent } from '../fixtures/events.fixture';
import type { SarEvent } from '../../src/types';

// Fixtures: synthetic events (tests/fixtures/events.fixture.ts) and the REAL recorded
// photon/ASF responses. fetch is stubbed per test; no live network is used.
const fx = (n: string) => JSON.parse(readFileSync(resolve(__dirname, '../fixtures', n), 'utf8'));
const realEvents: SarEvent[] = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/events.json'), 'utf8')).events;

afterEach(() => vi.unstubAllGlobals());

describe('Timeline', () => {
  const setup = (over: Partial<Parameters<typeof Timeline>[0]> = {}) => {
    const props = {
      event: syntheticEvent,
      before: syntheticEvent.layers[0],
      after: syntheticEvent.layers[1],
      slot: 'after' as const,
      onSlot: vi.fn(),
      onPick: vi.fn(),
      ...over,
    };
    render(<Timeline {...props} />);
    return props;
  };

  const obsButtons = () => screen.getAllByRole('button').filter((b) => /\d{4}/.test(b.getAttribute('aria-label') ?? ''));

  it('shows one button per observation of the ACTIVE kind only (no duplicate dates)', () => {
    setup(); // after = browse layer: the derived water-mask layer is not drawn
    expect(obsButtons().map((b) => b.getAttribute('aria-label'))).toEqual(['5 Jan 2026, current before', '17 Jan 2026, current after']);
  });
  it('keeps the current Before layer visible even when it is of another kind', () => {
    setup({ before: syntheticEvent.layers[0], after: syntheticEvent.layers[2] });
    expect(obsButtons()).toHaveLength(2); // b1 (before) + d1 (after, water kind)
  });
  // ISSUE-QA-23 (fixed): the label counts only the observations actually drawn; the svg is a
  // role="group" (not "img") so its focusable children stay reachable (ISSUE-QA-21 nested-interactive).
  it('the svg label count equals the number of observations drawn', () => {
    setup();
    expect(screen.getByRole('group', { name: `${obsButtons().length} observations of Synthetic flood` })).toBeInTheDocument();
  });
  it('marks the current before/after observations for assistive tech', () => {
    setup();
    expect(screen.getByRole('button', { name: '5 Jan 2026, current before' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '17 Jan 2026, current after' })).toBeInTheDocument();
  });
  it('clicking an observation calls onPick with its layer id', async () => {
    const p = setup();
    await userEvent.click(screen.getByRole('button', { name: '17 Jan 2026, current after' }));
    expect(p.onPick).toHaveBeenCalledWith('a1');
  });
  it('Enter and Space on a focused observation pick it', () => {
    const p = setup();
    const b = screen.getByRole('button', { name: '5 Jan 2026, current before' });
    fireEvent.keyDown(b, { key: 'Enter' });
    fireEvent.keyDown(b, { key: ' ' });
    fireEvent.keyDown(b, { key: 'a' });
    expect(p.onPick).toHaveBeenCalledTimes(2);
    expect(p.onPick).toHaveBeenCalledWith('b1');
  });
  it('slot toggle reports before/after and reflects the pressed state', async () => {
    const p = setup({ slot: 'before' });
    expect(screen.getByRole('button', { name: 'Before' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'After' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'After' }));
    expect(p.onSlot).toHaveBeenCalledWith('after');
  });
  it('shows the event date marker and month ticks', () => {
    const { container } = render(<Timeline event={syntheticEvent} before={null} after={null} slot="after" onSlot={() => {}} onPick={() => {}} />);
    expect(container.textContent).toContain('event 12 Jan 2026');
    // ISSUE-QA-09 (fixed during the audit): a span inside one calendar month used to get NO axis labels.
    // The axis must now carry at least one date tick, for both a short and a multi-month span.
    const tickLabels = (root: HTMLElement) => [...root.querySelectorAll('svg text')].map((t) => t.textContent ?? '').filter((t) => /\d/.test(t) && !t.startsWith('event'));
    expect(tickLabels(container).length).toBeGreaterThan(0);
    const real = render(<Timeline event={realEvents.find((e) => e.id === 'venezuela-2026')!} before={null} after={null} slot="after" onSlot={() => {}} onPick={() => {}} />);
    expect(tickLabels(real.container).length).toBeGreaterThan(0);
    expect(real.container.textContent).toMatch(/Jun/);
  });
  it('renders events with no date (pairs only) and with pair intervals', () => {
    const { container } = render(<Timeline event={syntheticPairEvent} before={null} after={null} slot="after" onSlot={() => {}} onPick={() => {}} />);
    expect(container.textContent).not.toContain('event ');
    expect(container.querySelectorAll('rect[rx="3"]').length).toBe(2); // two interval bars
  });
  it('renders every real event from the data package without NaN coordinates', () => {
    for (const ev of realEvents) {
      const { container, unmount } = render(<Timeline event={ev} before={null} after={null} slot="after" onSlot={() => {}} onPick={() => {}} />);
      expect(container.innerHTML, ev.id).not.toMatch(/NaN|Infinity/);
      unmount();
    }
  });
  it('does not crash for an event with zero layers (renders no NaN geometry)', () => {
    const { container } = render(<Timeline event={{ ...syntheticEvent, date: null, layers: [] }} before={null} after={null} slot="after" onSlot={() => {}} onPick={() => {}} />);
    expect(container.innerHTML).not.toMatch(/NaN/);
  });
});

describe('EventPanel', () => {
  const baseProps = (ev: SarEvent, over: Record<string, unknown> = {}) => ({
    event: ev,
    before: ev.layers[0],
    after: ev.layers[1],
    mode: 'swipe' as const,
    overlayOpacity: 0.5,
    level: 'simple' as const,
    activePin: null,
    collapsed: false,
    onMode: vi.fn(),
    onBefore: vi.fn(),
    onAfter: vi.fn(),
    onOpacity: vi.fn(),
    onLevel: vi.fn(),
    onPin: vi.fn(),
    onClose: vi.fn(),
    onToggleCollapsed: vi.fn(),
    ...over,
  });

  it('shows title, category, date, hemisphere-formatted coordinates and subtitle', () => {
    render(<EventPanel {...baseProps(syntheticEvent)} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Synthetic flood' })).toBeInTheDocument();
    expect(screen.getByText('Fixture region')).toBeInTheDocument();
    expect(screen.getByText(/Flood · 12 Jan 2026/)).toBeInTheDocument();
    expect(screen.getByText('24.500°S 33.000°E')).toBeInTheDocument();
  });
  it('shows "date pending" when the event has no date', () => {
    render(<EventPanel {...baseProps(syntheticPairEvent)} />);
    expect(screen.getByText(/date pending/)).toBeInTheDocument();
  });
  it('close button and collapse button call their handlers', async () => {
    const p = baseProps(syntheticEvent);
    render(<EventPanel {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close investigation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    expect(p.onClose).toHaveBeenCalledOnce();
    expect(p.onToggleCollapsed).toHaveBeenCalledOnce();
  });
  it('comparison mode buttons reflect the active mode and emit the new one', async () => {
    const p = baseProps(syntheticEvent, { mode: 'side' });
    render(<EventPanel {...p} />);
    const group = screen.getByRole('group', { name: 'Comparison mode' });
    expect(within(group).getByRole('button', { name: 'Side by side' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(group).getByRole('button', { name: 'Overlay' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Swipe' }));
    expect(p.onMode.mock.calls.map((c) => c[0])).toEqual(['overlay', 'swipe']);
  });
  it('before/after selectors list every layer and emit the chosen id', async () => {
    const p = baseProps(syntheticEvent);
    render(<EventPanel {...p} />);
    const sel = screen.getByRole('combobox', { name: 'After observation' });
    expect(within(sel).getAllByRole('option')).toHaveLength(syntheticEvent.layers.length);
    await userEvent.selectOptions(sel, 'd1');
    expect(p.onAfter).toHaveBeenCalledWith('d1');
  });
  it('overlay mode exposes an opacity slider wired to onOpacity', () => {
    const p = baseProps(syntheticEvent, { mode: 'overlay' });
    render(<EventPanel {...p} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(p.onOpacity).toHaveBeenCalledWith(0.8);
    expect(screen.getByText('After opacity 50%')).toBeInTheDocument();
  });
  it('legend for a composite (RGB) layer shows the channel mapping instead of an empty colour ramp (ISSUE-QA-15, fixed)', () => {
    const kras = realEvents.find((e) => e.id === 'krasheninnikov-2026')!;
    const comp = kras.layers.find((l) => l.legend?.colormap === 'composite')!;
    render(<EventPanel {...baseProps(kras, { before: comp, after: comp })} />);
    expect(screen.getAllByText(/fixed calibrated composite/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Green = HV/).length).toBeGreaterThan(0);
  });
  it('legend bar for a classes layer lists both classes and the dB threshold', () => {
    const d1 = syntheticEvent.layers[2];
    render(<EventPanel {...baseProps(syntheticEvent, { before: d1, after: syntheticEvent.layers[1] })} />);
    expect(screen.getByText(/water mask \(HH < -15.5 dB\)/)).toBeInTheDocument();
    expect(screen.getByText('water on both dates')).toBeInTheDocument();
    expect(screen.getByText('new water')).toBeInTheDocument();
  });
  it('InSAR events show the interferogram callout; backscatter events do not', () => {
    const { unmount } = render(<EventPanel {...baseProps(syntheticPairEvent)} />);
    expect(screen.getByText(/already a change measurement/)).toBeInTheDocument();
    unmount();
    render(<EventPanel {...baseProps(syntheticEvent)} />);
    expect(screen.queryByText(/already a change measurement/)).toBeNull();
  });
  it('provenance block: tier, geometry, granule, distributor links, processing steps, credit', () => {
    const { container } = render(<EventPanel {...baseProps(syntheticEvent)} />);
    const prov = container.querySelectorAll('details.prov');
    expect(prov).toHaveLength(2); // before + after (distinct layers)
    const first = prov[0] as HTMLElement;
    expect(first.textContent).toMatch(/NASA browse/);
    expect(first.textContent).toContain('Track 114 · ascending · frame 165 · HH/HV');
    expect(first.textContent).toContain('NISAR_L2_PR_GCOV_009_114_A_165_FIXTURE');
    expect(first.textContent).toContain('SYNTHETIC step one');
    expect(within(first).getByRole('link', { name: 'full product' })).toHaveAttribute('href', 'https://example.invalid/product.h5');
    expect(within(first).getByRole('link', { name: 'browse image' })).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
  it('a derived layer is labelled "derived by team"', () => {
    render(<EventPanel {...baseProps(syntheticEvent, { before: syntheticEvent.layers[2] })} />);
    expect(screen.getByText(/(derived|computed) by team/)).toBeInTheDocument();
  });
  it('shows only one provenance block when before and after are the same layer', () => {
    const { container } = render(<EventPanel {...baseProps(syntheticEvent, { after: syntheticEvent.layers[0] })} />);
    expect(container.querySelectorAll('details.prov')).toHaveLength(1);
  });
  it('renders the reference links of the event', () => {
    render(<EventPanel {...baseProps(syntheticEvent)} />);
    expect(screen.getByRole('link', { name: 'Example reference' })).toHaveAttribute('href', 'https://example.invalid/ref');
  });
  it('does not crash when no layer is selected', () => {
    const { container } = render(<EventPanel {...baseProps(syntheticEvent, { before: null, after: null })} />);
    expect(screen.getByRole('combobox', { name: 'Before observation' })).toBeInTheDocument();
    expect(container.querySelectorAll('details.prov')).toHaveLength(0);
  });

  describe('authored content for the real investigations', () => {
    for (const ev of realEvents) {
      it(`${ev.id}: renders explanation, simple/scientific toggle, and pins`, async () => {
        const p = baseProps(ev);
        const { container, rerender } = render(<EventPanel {...p} />);
        expect(screen.getByRole('heading', { level: 2, name: ev.title })).toBeInTheDocument();
        expect(container.querySelectorAll('details.prov').length).toBeGreaterThan(0);
        // simple -> scientific changes the explanation text
        const simple = container.querySelector('.explain ul')?.textContent;
        rerender(<EventPanel {...p} level="scientific" />);
        const sci = container.querySelector('.explain ul')?.textContent;
        if (simple !== undefined) expect(sci).not.toBe(simple);
        // scoped to the "What the radar sees" block: the embedded assistant panel has its own Simple/Scientific toggle
        await userEvent.click(within(container.querySelector('.explain .seg') as HTMLElement).getByRole('button', { name: 'Simple' }));
        expect(p.onLevel).toHaveBeenCalledWith('simple');
      });
    }
    it('look-closer pins toggle via onPin and expose aria-expanded', async () => {
      const ev = realEvents.find((e) => e.id === 'venezuela-2026')!;
      const p = baseProps(ev);
      const { rerender } = render(<EventPanel {...p} />);
      const pinBtn = screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded'))!;
      expect(pinBtn).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(pinBtn);
      expect(p.onPin).toHaveBeenCalledOnce();
      const id = p.onPin.mock.calls[0][0];
      rerender(<EventPanel {...p} activePin={id} />);
      expect(screen.getAllByRole('button').find((b) => b.getAttribute('aria-expanded') === 'true')).toBeTruthy();
    });
  });
});

describe('SearchBox', () => {
  const photon = fx('photon-caracas.fixture.json');
  const stubPhoton = (impl?: (url: string, init?: RequestInit) => Promise<Response>) => {
    const f = vi.fn(impl ?? (async () => ({ ok: true, status: 200, json: async () => photon }) as Response));
    vi.stubGlobal('fetch', f);
    return f;
  };
  const events = [syntheticEvent, syntheticPairEvent];
  const box = () => screen.getByRole('combobox', { name: /Search places, events or coordinates/ });

  it('matches curated events locally on title/subtitle/category and selects on click', async () => {
    const f = stubPhoton();
    const onEvent = vi.fn();
    render(<SearchBox events={events} onEvent={onEvent} onPlace={vi.fn()} />);
    await userEvent.type(box(), 'earthq');
    const opt = await screen.findByRole('option', { name: /Synthetic earthquake/ });
    await userEvent.click(opt);
    expect(onEvent).toHaveBeenCalledWith('synthetic-quake');
    expect(f).not.toHaveBeenCalledWith(expect.stringContaining('NOPE'));
  });
  it('does not search for a single character', async () => {
    const f = stubPhoton();
    render(<SearchBox events={events} onEvent={vi.fn()} onPlace={vi.fn()} />);
    await userEvent.type(box(), 'v');
    await new Promise((r) => setTimeout(r, 400));
    expect(f).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('coordinates produce a "go to" option that calls onPlace with [lon, lat] in the right order, without hitting the geocoder', async () => {
    const f = stubPhoton();
    const onPlace = vi.fn();
    render(<SearchBox events={events} onEvent={vi.fn()} onPlace={onPlace} />);
    await userEvent.type(box(), '10.5, -67.2');
    expect(await screen.findByText('10.5000, -67.2000')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(onPlace).toHaveBeenCalledWith(expect.objectContaining({ lon: -67.2, lat: 10.5 }));
    await new Promise((r) => setTimeout(r, 400));
    expect(f).not.toHaveBeenCalled();
  });
  it('geocodes place names after the debounce and lists Photon hits (recorded fixture)', async () => {
    const f = stubPhoton();
    const onPlace = vi.fn();
    render(<SearchBox events={events} onEvent={vi.fn()} onPlace={onPlace} />);
    await userEvent.type(box(), 'Caracas');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(photon.features.length), { timeout: 2000 });
    expect(f).toHaveBeenCalledTimes(1); // debounced: one request for the whole word, not one per keystroke
    await userEvent.click(screen.getAllByRole('option')[0]);
    expect(onPlace).toHaveBeenCalledWith(expect.objectContaining({ lon: photon.features[0].geometry.coordinates[0] }));
  });
  it('keyboard: ArrowDown moves the selection and Enter chooses it', async () => {
    stubPhoton();
    const onPlace = vi.fn();
    render(<SearchBox events={[]} onEvent={vi.fn()} onPlace={onPlace} />);
    await userEvent.type(box(), 'Caracas');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1), { timeout: 2000 });
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(onPlace).toHaveBeenCalledWith(expect.objectContaining({ lon: photon.features[1].geometry.coordinates[0] }));
  });
  it('Escape closes the result list', async () => {
    stubPhoton();
    render(<SearchBox events={events} onEvent={vi.fn()} onPlace={vi.fn()} />);
    await userEvent.type(box(), 'flood');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('shows a helpful message when the geocoder fails, keeping local matches usable', async () => {
    stubPhoton(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response);
    render(<SearchBox events={events} onEvent={vi.fn()} onPlace={vi.fn()} />);
    await userEvent.type(box(), 'flood');
    expect(await screen.findByText(/Place search is unavailable/, undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Synthetic flood/ })).toBeInTheDocument();
  });
  it('an aborted (superseded) request is not shown as an error', async () => {
    stubPhoton(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    render(<SearchBox events={events} onEvent={vi.fn()} onPlace={vi.fn()} />);
    await userEvent.type(box(), 'flood');
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByText(/Place search is unavailable/)).toBeNull();
  });

  // WAS A KNOWN BUG, fixed during the audit (ISSUE-QA-02): the debounced fetch is only aborted by the NEXT
  // geocode call. If the user replaces a place name with coordinates (or clears the box) while a
  // request is in flight, the late response overwrites the list with stale place hits.
  it('a late geocoder response does not clobber the coordinates option (fixed during the audit: ISSUE-QA-02)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    stubPhoton(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => photon } as Response;
    });
    render(<SearchBox events={[]} onEvent={vi.fn()} onPlace={vi.fn()} />);
    await userEvent.type(box(), 'Caracas');
    await new Promise((r) => setTimeout(r, 400)); // debounce fired, request in flight
    await userEvent.clear(box());
    await userEvent.type(box(), '10.5, -67.2');
    expect(await screen.findByText('10.5000, -67.2000')).toBeInTheDocument();
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByText('10.5000, -67.2000')).toBeInTheDocument();
  });
});

describe('IntroPanel (coverage states)', () => {
  const asf = fx('asf-coverage-venezuela.fixture.json');
  const props = (over: Partial<Parameters<typeof IntroPanel>[0]> = {}) => ({
    events: realEvents,
    generated: '2026-11-14T05:54:21.816Z',
    coverage: null,
    coverageState: 'idle' as const,
    coverageError: null,
    coverageMode: false,
    collapsed: false,
    onSelect: vi.fn(),
    onCoverageMode: vi.fn(),
    onClearCoverage: vi.fn(),
    onToggleCollapsed: vi.fn(),
    ...over,
  });

  it('idle: lists every investigation with technique + scene count and selects on click', async () => {
    const p = props();
    render(<IntroPanel {...p} />);
    for (const e of realEvents) {
      const btn = screen.getByRole('button', { name: new RegExp(e.title) });
      expect(btn).toHaveTextContent(`${e.layers.length} NISAR scenes`);
    }
    await userEvent.click(screen.getByRole('button', { name: new RegExp(realEvents[0].title) }));
    expect(p.onSelect).toHaveBeenCalledWith(realEvents[0].id);
    expect(screen.getByText(/Data package built 14 Nov 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/NISAR data at this point/)).toBeNull();
  });
  it('loading: shows the searching message and no result card', () => {
    render(<IntroPanel {...props({ coverageState: 'loading' })} />);
    expect(screen.getByText(/Searching the ASF archive/)).toBeInTheDocument();
  });
  it('error: shows the error callout with the offline reassurance', () => {
    render(<IntroPanel {...props({ coverageState: 'error', coverageError: 'Could not reach the ASF search service (boom). The curated investigations still work offline.' })} />);
    expect(screen.getByText(/Could not reach the ASF search service \(boom\)/)).toBeInTheDocument();
  });
  it('empty: explains that no public NISAR product covers the point', () => {
    const c: CoverageResult = { lon: 0, lat: 0, total: 0, granules: [] };
    render(<IntroPanel {...props({ coverage: c })} />);
    expect(screen.getByText(/No public NISAR GCOV or GUNW products cover this point yet/)).toBeInTheDocument();
    expect(screen.getByText('0.0000, 0.0000')).toBeInTheDocument();
  });
  it('result: summarises products, tracks, tiers and lists granules from the recorded ASF response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => asf }) as Response));
    const cov = await nisarCoverage(-67.5, 10.5);
    const p = props({ coverage: cov });
    const { container } = render(<IntroPanel {...p} />);
    expect(screen.getByText('NISAR data at this point')).toBeInTheDocument();
    expect(container.querySelector('.stat')).toHaveTextContent(String(cov.total));
    expect(container.querySelectorAll('.coverage-list li')).toHaveLength(Math.min(8, cov.total));
    expect(container.querySelector('.coverage-list')).toHaveTextContent(/track 162 ascending · frame 7/);
    expect(container.querySelector('.tier')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear coverage' }));
    expect(p.onClearCoverage).toHaveBeenCalledOnce();
  });
  it('result: shows "250+" when the ASF page limit was hit, and caps the list at 8', () => {
    const g = (i: number) => ({
      scene: `S${i}`, product: 'GCOV', start: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`, tier: 'BETA',
      track: 1 + (i % 3), frame: 1, direction: 'ASCENDING', footprint: { type: 'Polygon', coordinates: [] } as never,
    });
    const c: CoverageResult = { lon: 1, lat: 2, total: 250, granules: Array.from({ length: 250 }, (_, i) => g(i)) };
    const { container } = render(<IntroPanel {...props({ coverage: c })} />);
    expect(container.querySelector('.stat')).toHaveTextContent('250+');
    expect(container.querySelectorAll('.coverage-list li')).toHaveLength(8);
  });
  it('coverage probe button toggles coverage mode and reflects it via aria-pressed', async () => {
    const p = props({ coverageMode: true });
    render(<IntroPanel {...p} />);
    const b = screen.getByRole('button', { name: /Coverage probe on/ });
    expect(b).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(b);
    expect(p.onCoverageMode).toHaveBeenCalledWith(false);
  });
  it('external links open safely', () => {
    render(<IntroPanel {...props()} />);
    for (const a of screen.getAllByRole('link')) {
      if (a.getAttribute('target') === '_blank') expect(a.getAttribute('rel')).toContain('noopener');
    }
  });
  it('does not show loading and result together (loading takes the stale result out of play)', () => {
    // Documents current behaviour: result is gated on coverageState === "idle".
    const c: CoverageResult = { lon: 1, lat: 2, total: 0, granules: [] };
    render(<IntroPanel {...props({ coverage: c, coverageState: 'loading' })} />);
    expect(screen.queryByText(/No public NISAR GCOV/)).toBeNull();
  });
});
