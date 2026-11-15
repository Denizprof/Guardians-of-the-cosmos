import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Timeline from '../../src/components/Timeline';
import IntroPanel from '../../src/components/IntroPanel';
import { syntheticEvent } from '../fixtures/events.fixture';
import type { SarEvent } from '../../src/types';

const realEvents: SarEvent[] = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/events.json'), 'utf8')).events;
const ev = (id: string) => realEvents.find((e) => e.id === id)!;

/** A ResizeObserver that reports a chosen track width (the shared setup reports 600). */
const trackWidth = (width: number) => {
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) {
      this.cb([{ target: el, contentRect: { width, height: 72 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', RO);
};
afterEach(() => vi.unstubAllGlobals());

const draw = (event: SarEvent, over: Partial<Parameters<typeof Timeline>[0]> = {}) =>
  render(<Timeline event={event} before={null} after={null} slot="after" onSlot={() => {}} onPick={() => {}} {...over} />).container;

const num = (el: Element, a: string) => Number(el.getAttribute(a));
const tickXs = (c: HTMLElement) => [...new Set([...c.querySelectorAll('.tick circle')].map((e) => num(e, 'cx')))].sort((a, b) => a - b);
const minGap = (xs: number[]) => Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
const dashed = (c: HTMLElement) => [...c.querySelectorAll('svg line[stroke-dasharray]')];

describe('Timeline: an event date far from the acquisitions does not set the scale', () => {
  it('keeps the Krasheninnikov passes apart on a phone-width track and says the event is off scale', () => {
    trackWidth(215);
    const k = ev('krasheninnikov-2026');
    const browse = k.layers.filter((l) => l.kind === 'browse');
    const c = draw(k, { before: browse[0], after: browse[browse.length - 1] });
    const xs = tickXs(c);
    expect(xs).toHaveLength(11);
    expect(minGap(xs)).toBeGreaterThanOrEqual(12); // was about 4.5 px
    const label = c.querySelector('.ev-label')!;
    expect(label.textContent).toContain('event 2 Aug 2025');
    expect(label.textContent).toContain('(off scale)');
    // the limit is stated, and the pinned line sits at the left edge, before every pass
    expect(c.textContent).toContain('The event date is before the first pass shown. Its line at the edge is not drawn to scale.');
    expect(dashed(c)).toHaveLength(1);
    expect(num(dashed(c)[0], 'x1')).toBeLessThan(xs[0]);
    expect(num(dashed(c)[0], 'x1')).toBeLessThanOrEqual(2);
  });

  it('neighbouring single-date hit areas never overlap (hit width plus its 8 px stroke fits the gap)', () => {
    trackWidth(215);
    const k = ev('krasheninnikov-2026');
    const browse = k.layers.filter((l) => l.kind === 'browse');
    const c = draw(k, { before: browse[0], after: browse[browse.length - 1] });
    const gap = minGap(tickXs(c));
    const hits = [...c.querySelectorAll('.tick')].filter((g) => g.querySelector('circle')).map((g) => g.querySelector('.tick-hit')!);
    expect(hits).toHaveLength(11);
    for (const h of hits) {
      expect(num(h, 'width') + 8).toBeLessThanOrEqual(gap + 0.01);
      expect(num(h, 'width')).toBeGreaterThan(0);
      // centred on its own tick
      const cx = num(h.parentElement!.querySelector('circle')!, 'cx');
      expect(num(h, 'x') + num(h, 'width') / 2).toBeCloseTo(cx, 5);
    }
  });

  it('an event after the last pass is pinned at the right edge with the same wording', () => {
    const late: SarEvent = { ...syntheticEvent, date: '2027-06-01T00:00:00Z' };
    const c = draw(late);
    const xs = tickXs(c);
    expect(c.querySelector('.ev-label')!.textContent).toContain('(off scale)');
    expect(c.textContent).toContain('The event date is after the last pass shown. Its line at the edge is not drawn to scale.');
    expect(num(dashed(c)[0], 'x1')).toBeGreaterThan(xs[xs.length - 1]);
  });

  it('an event inside the acquisition range is drawn to scale, unchanged', () => {
    const c = draw(syntheticEvent); // 5 Jan and 17 Jan passes, event 12 Jan
    const xs = tickXs(c);
    const line = dashed(c);
    expect(line).toHaveLength(1);
    expect(num(line[0], 'x1')).toBeGreaterThan(xs[0]);
    expect(num(line[0], 'x1')).toBeLessThan(xs[xs.length - 1]);
    expect(c.querySelector('.ev-label')!.textContent).toBe('event 12 Jan 2026');
    expect(c.textContent).not.toContain('off scale');
    // wide spacing: the hit area keeps its full 16 px
    for (const g of c.querySelectorAll('.tick')) if (g.querySelector('circle')) expect(num(g.querySelector('.tick-hit')!, 'width')).toBe(16);
  });

  it('an event a few days outside the passes still sets the scale (no off-scale note)', () => {
    const c = draw({ ...syntheticEvent, date: '2026-01-02T00:00:00Z' });
    expect(c.textContent).not.toContain('off scale');
    expect(num(dashed(c)[0], 'x1')).toBeLessThan(tickXs(c)[0]);
    expect(num(dashed(c)[0], 'x1')).toBeGreaterThan(2);
  });
});

describe('Timeline: an event date known only to the month is a band, not a day-exact line', () => {
  it('Mozambique (precision "month"): no dashed line, a band over January that covers the 5 and 17 Jan passes', () => {
    const m = ev('mozambique-floods-2026');
    expect(m.date_precision).toBe('month');
    const browse = m.layers.filter((l) => l.kind === 'browse');
    const c = draw(m, { before: browse[1], after: browse[2] });
    expect(dashed(c)).toHaveLength(0);
    const band = c.querySelector('rect.ev-band')!;
    expect(band).not.toBeNull();
    const x0 = num(band, 'x'), x1 = x0 + num(band, 'width');
    const xs = tickXs(c); // 24 Dec, 5 Jan, 17 Jan
    expect(xs).toHaveLength(3);
    expect(x0).toBeGreaterThan(xs[0]); // 24 Dec is before January
    expect(x0).toBeLessThan(xs[1]);
    expect(x1).toBeGreaterThan(xs[2]);
    expect(c.querySelector('.ev-label')!.textContent).toBe('event Jan 2026');
    expect(c.textContent).toContain('The event date is known only to the month. The band covers the whole month.');
    expect(c.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('a year-precision date gets a band over the year, clipped to the axis', () => {
    const c = draw({ ...syntheticEvent, date_precision: 'year' } as SarEvent);
    expect(dashed(c)).toHaveLength(0);
    const band = c.querySelector('rect.ev-band')!;
    expect(num(band, 'width')).toBeGreaterThan(0);
    expect(num(band, 'x') + num(band, 'width')).toBeLessThanOrEqual(600);
    expect(c.querySelector('.ev-label')!.textContent).toBe('event 2026');
    expect(c.textContent).toContain('The event date is known only to the year. The band covers the whole year.');
  });

  it('day-or-better precision keeps exactly one dashed line and no band (Venezuela)', () => {
    const c = draw(ev('venezuela-2026'));
    expect(dashed(c)).toHaveLength(1);
    expect(c.querySelector('rect.ev-band')).toBeNull();
  });

  it('every real event renders without NaN geometry at phone and desktop widths', () => {
    for (const width of [215, 900]) {
      trackWidth(width);
      for (const e of realEvents) {
        const { container, unmount } = render(<Timeline event={e} before={null} after={null} slot="after" onSlot={() => {}} onPick={() => {}} />);
        expect(container.innerHTML, e.id).not.toMatch(/NaN|Infinity/);
        unmount();
      }
    }
  });
});

describe('IntroPanel: the investigation list counts layers, not scenes', () => {
  it('labels the number as NISAR layers (browse pictures and derived products of the same passes)', () => {
    const base = syntheticEvent.layers[0];
    const mk = (id: string, kind: string, start: string) => ({ ...base, id, kind, acquisition: { ...base.acquisition, start } });
    const fixture = {
      ...syntheticEvent,
      layers: [
        mk('b1', 'browse', '2026-01-05T03:42:32Z'), mk('b2', 'browse', '2026-01-17T03:42:32Z'),
        mk('d1', 'backscatter', '2026-01-05T03:42:32Z'), mk('d2', 'backscatter', '2026-01-17T03:42:32Z'),
        mk('c1', 'change', '2026-01-05T03:42:32Z'),
      ],
    } as SarEvent;
    render(
      <IntroPanel events={[fixture]} generated="2026-11-14T05:54:21.816Z" coverage={null} coverageState="idle" coverageError={null}
        coverageMode={false} collapsed={false} onSelect={() => {}} onCoverageMode={() => {}} onClearCoverage={() => {}} onToggleCollapsed={() => {}} />,
    );
    const row = screen.getByRole('button', { name: new RegExp(fixture.title) });
    expect(row.textContent).toMatch(/5 NISAR layers/);
    expect(row.textContent).not.toMatch(/NISAR scenes/);
  });
});
