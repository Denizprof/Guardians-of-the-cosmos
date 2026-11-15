// Turkish for the sentences added by the audit fixes, including the ones that carry numbers.
import { describe, expect, it } from 'vitest';
import { translate } from '../../src/i18n';

describe('audit-fix sentences have Turkish', () => {
  it.each([
    'on the event day',
    'This section could not be loaded. Check your connection and try again.',
    'The event date is not known to the day, so there is no time window to search.',
    'Checked 80 of 3,640 candidate collections (the most-used and platform-targeted ones); use Earthdata Search for the full list.',
    'Checked 80 candidate collections (the most-used and platform-targeted ones), but more exist; use Earthdata Search for the full list.',
    'None of the 80 candidate collections checked (the most-used and platform-targeted ones, of 3,640) has granules for this point and window. This is not a complete search.',
    'None of the 80 candidate collections checked (the most-used and platform-targeted ones; more exist) has granules for this point and window. This is not a complete search.',
    'Showing the strongest 2,232 of 7,355 half-degree cells (peak fire power at least 16 MW); weaker fires are not shown.',
    'Showing the strongest 3 of 9 half-degree cells; weaker fires are not shown.',
  ])('%s', (en) => {
    const tr = translate(en, 'tr');
    expect(tr).not.toBe(en);
    for (const n of en.match(/[\d,]*\d/g) ?? []) expect(tr).toContain(n); // numbers are carried over, not dropped
  });
});

// Regression: the "Recent events" feed said "12 months" while its wildfires covered about five days (a capped
// fetch). The pipeline now records what each category really covers, and the label must agree with it.
import fs from 'node:fs';
import path from 'node:path';

describe('the recent-events label matches what the shipped feed covers', () => {
  const ctx = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/data/context.json'), 'utf8')) as {
    coverage: Record<string, { count: number; truncated: boolean; window_days: number; oldest: string | null; newest: string | null }>;
    events: { category: string }[];
  };
  const label = fs.readFileSync(path.resolve(__dirname, '../../src/components/Filters.tsx'), 'utf8');
  it('no category was cut short by a fetch limit', () => {
    for (const [k, c] of Object.entries(ctx.coverage)) expect(c.truncated, k).toBe(false);
  });
  it('wildfires cover 30 days and everything else 12 months, as the label says', () => {
    expect(ctx.coverage.wildfire.window_days).toBe(30);
    for (const [k, c] of Object.entries(ctx.coverage)) if (k !== 'wildfire') expect(c.window_days, k).toBe(365);
    expect(label).toContain('Recent events, 12 months; wildfires 30 days (USGS, EONET)');
    expect(translate('Recent events, 12 months; wildfires 30 days (USGS, EONET)', 'tr')).toContain('30');
  });
  it('the coverage record agrees with the events it describes', () => {
    for (const [k, c] of Object.entries(ctx.coverage)) expect(ctx.events.filter((e) => e.category === k).length, k).toBe(c.count);
  });
  it('the label states the window the pipeline is set to fetch, so a change there cannot leave the text stale', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../pipeline/src/fetch-context.mjs'), 'utf8');
    const days = /EONET_DAYS\s*=\s*\{\s*wildfires:\s*(\d+)/.exec(src)?.[1];
    expect(days).toBeTruthy();
    expect(label).toContain(`wildfires ${days} days`);
  });
});

// Regression: the recent-events feed (EONET) relays GDACS floods under its own ids; with the GDACS flood
// catalog switched on as well, ten floods were drawn twice and counted twice.
import { markerKey } from '../../src/lib';

describe('one marker per flood, whichever source reports it', () => {
  it('a GDACS flood has the same key from the feed and from the catalog', () => {
    const fromFeed = { id: 'eonet-EONET_20925', url: 'https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1104001' };
    const fromCatalog = { id: 'gdacs-fl-1104001', url: 'https://www.gdacs.org/report.aspx?eventid=1104001&episodeid=1&eventtype=FL' };
    expect(markerKey(fromFeed)).toBe('gdacs-fl-1104001');
    expect(markerKey(fromCatalog)).toBe('gdacs-fl-1104001');
  });
  it('everything else keeps its own id: other hazards on GDACS, other sites, records with no link', () => {
    expect(markerKey({ id: 'eonet-EONET_1', url: 'https://www.gdacs.org/report.aspx?eventtype=TC&eventid=1104001' })).toBe('eonet-EONET_1');
    expect(markerKey({ id: 'usgs-us6000u18k', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u18k' })).toBe('usgs-us6000u18k');
    expect(markerKey({ id: 'x', url: 'https://example.org/?eventtype=FL&eventid=7' })).toBe('x');
    expect(markerKey({ id: 'y' })).toBe('y');
    expect(markerKey({ id: 'z', url: null })).toBe('z');
  });
  it('in the shipped data, no flood is left that both sources would draw', () => {
    const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/data/catalogs/gdacs-floods.json'), 'utf8')) as { events: { id: string; url?: string }[] };
    const context = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/data/context.json'), 'utf8')) as { events: { id: string; url?: string; category: string }[] };
    const feed = context.events.filter((e) => e.category === 'flood');
    const keys = new Set(catalog.events.map(markerKey));
    const shared = feed.filter((e) => keys.has(markerKey(e)));
    expect(shared.length).toBeGreaterThan(0); // the overlap is real, which is why the key exists
    const merged = new Map<string, unknown>();
    for (const e of [...catalog.events, ...feed]) if (!merged.has(markerKey(e))) merged.set(markerKey(e), e);
    expect(merged.size).toBe(catalog.events.length + feed.length - shared.length);
  });
});
