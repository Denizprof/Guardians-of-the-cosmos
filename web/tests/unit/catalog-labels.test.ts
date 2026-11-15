// Regression: big earthquakes read as "tsunami" on the globe.
// The NOAA tsunami catalog (on by default) lists the small tsunami that followed many large earthquakes, titled
// only "Tsunami 2026 — Panama", while the USGS earthquake catalog that holds the earthquake itself was off by
// default. So a visitor saw a major earthquake labelled as a tsunami and nothing labelled as an earthquake.
// Also: a check of every date in the shipped catalogs.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CATALOGS, fmtEventDate } from '../../src/lib';
import { buildEventContext } from '../../src/assistant/context';
import type { SarEvent } from '../../src/types';

interface Rec { id: string; title: string; category: string; date: string; date_precision?: string; lon: number; lat: number; notes?: string; magnitude?: number }
interface CatalogFile { retrieved: string; events: Rec[] }
const dir = path.resolve(__dirname, '../../public/data/catalogs');
const load = (id: string) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as CatalogFile;

describe('earthquakes are shown as earthquakes', () => {
  it('the USGS earthquake catalog is on by default, next to the tsunami catalog', () => {
    const on = CATALOGS.filter((c) => c.defaultOn).map((c) => c.id);
    expect(on).toContain('usgs-earthquakes');
    expect(on).toContain('noaa-tsunamis');
  });

  const tsunamis = load('noaa-tsunamis').events;
  const quakeCaused = tsunamis.filter((e) => /^Cause: (Earthquake|Earthquake and landslide|Volcano and earthquake|Volcano, earthquake and landslide)\./.test(e.notes ?? ''));

  it('a tsunami record caused by an earthquake says so in its title, with the magnitude when NOAA gives one', () => {
    expect(quakeCaused.length).toBeGreaterThan(900);
    for (const e of quakeCaused) {
      expect(e.title, e.id).toMatch(/^Tsunami after (M \d+(\.\d+)?|an) earthquake, \d{4}/);
      if (typeof e.magnitude === 'number') expect(e.title, e.id).toContain(`M ${e.magnitude} earthquake`);
    }
  });

  it('the October 2026 Panama event: the tsunami record names the M 7.7 earthquake, and the earthquake has its own record', () => {
    expect(tsunamis.find((e) => e.id === 'ncei-tsu-6193')?.title).toBe('Tsunami after M 7.7 earthquake, 2026 — Isla Cañas, Panama');
    const quake = load('usgs-earthquakes').events.find((e) => e.id === 'usgs-us6000u18k');
    expect(quake?.category).toBe('earthquake');
    expect(quake?.title).toMatch(/^M 7\.7 /);
  });

  it('a tsunami with another or an uncertain cause is not called an earthquake', () => {
    for (const e of tsunamis.filter((t) => /^Cause: (Meteorological|Landslide|Volcano|Unknown|Questionable earthquake|Explosion|Astronomical tide)\./.test(t.notes ?? ''))) {
      expect(e.title, e.id).not.toMatch(/earthquake/i);
    }
  });

  it('no title repeats the country ("Panama, Panama")', () => {
    for (const e of tsunamis) expect(e.title, e.id).not.toMatch(/, ([A-Z][A-Za-z ]+), \1$/);
  });

  it('every record keeps the category of the catalog it came from', () => {
    for (const [id, category] of [['noaa-tsunamis', 'tsunami'], ['usgs-earthquakes', 'earthquake'], ['noaa-volcanoes', 'volcano'], ['gdacs-floods', 'flood'], ['nasa-glc', 'landslide'], ['firms-fires', 'wildfire']] as const) {
      expect(load(id).events.every((e) => e.category === category), id).toBe(true);
    }
  });
});

describe('dates in the shipped catalogs', () => {
  it.each(CATALOGS.map((c) => c.id))('%s: every date is a real UTC timestamp, not in the future, and not before the catalog starts', (id) => {
    const file = load(id);
    const retrieved = Date.parse(file.retrieved);
    expect(Number.isNaN(retrieved)).toBe(false);
    for (const e of file.events) {
      expect(e.date, e.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      const t = Date.parse(e.date);
      expect(Number.isNaN(t), e.id).toBe(false);
      expect(new Date(t).toISOString().slice(0, 10), e.id).toBe(e.date.slice(0, 10)); // no 31 February rolling into March
      expect(t, e.id).toBeLessThanOrEqual(retrieved);
      expect(t, e.id).toBeGreaterThanOrEqual(Date.parse('1900-01-01T00:00:00Z'));
    }
  });

  it('a date known only to the day, month or year carries no invented time of day', () => {
    for (const id of ['noaa-tsunamis', 'noaa-volcanoes']) {
      for (const e of load(id).events) {
        if (e.date_precision === 'day' || e.date_precision === 'month' || e.date_precision === 'year') expect(e.date.slice(11, 19), e.id).toBe('00:00:00');
        if (e.date_precision === 'month' || e.date_precision === 'year') expect(e.date.slice(8, 10), e.id).toBe('01');
        if (e.date_precision === 'year') expect(e.date.slice(5, 7), e.id).toBe('01');
      }
    }
  });

  it('the year in a tsunami or eruption title is the year of its date', () => {
    for (const id of ['noaa-tsunamis', 'noaa-volcanoes']) {
      for (const e of load(id).events) {
        const year = /\b(1[89]\d\d|20\d\d)\b/.exec(e.title)?.[1];
        expect(year, e.id).toBe(e.date.slice(0, 4));
      }
    }
  });

  it('NOAA and USGS agree on when an earthquake happened for records both hold to the minute', () => {
    // Same event in both catalogs = within 2 days and 400 km. Where NOAA gives the time to the minute and USGS is
    // instrumental (1960 on), the two must agree within 10 minutes. Older records legitimately differ between
    // the two agencies and are shown as each agency reports them.
    const R = 6371, rad = Math.PI / 180;
    const km = (a: Rec, b: Rec) => {
      const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    const quakes = load('usgs-earthquakes').events.map((q) => ({ q, t: Date.parse(q.date) }));
    let compared = 0;
    for (const t of load('noaa-tsunamis').events) {
      if (t.date_precision !== 'minute' || !(t.magnitude && t.magnitude >= 7) || t.date < '1960') continue;
      const tt = Date.parse(t.date);
      const near = quakes.filter((x) => Math.abs(x.t - tt) < 2 * 864e5 && km(t, x.q) < 400).sort((a, b) => Math.abs(a.t - tt) - Math.abs(b.t - tt))[0];
      if (!near) continue;
      compared++;
      expect(Math.abs(near.t - tt), `${t.id} ${t.date} vs ${near.q.id} ${near.q.date}`).toBeLessThanOrEqual(10 * 60e3);
    }
    expect(compared).toBeGreaterThan(200);
  });
});

// Regression: the Mozambique flood record says only the month is known (date_precision "month"), but the app
// showed "12 Jan 2026" on its card, panel and timeline: a day nobody recorded.
describe('investigation dates are shown as precisely as they are known, and no more', () => {
  const events = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/data/events.json'), 'utf8')) as { events: SarEvent[] }).events;
  const flood = events.find((e) => e.id === 'mozambique-floods-2026')!;
  it('a month-precision date is shown as month and year', () => {
    expect(flood.date_precision).toBe('month');
    expect(fmtEventDate(flood)).toBe('Jan 2026');
  });
  it('dates known to the day or better keep their day', () => {
    expect(fmtEventDate(events.find((e) => e.id === 'venezuela-2026')!)).toBe('24 Jun 2026');
    expect(fmtEventDate(events.find((e) => e.id === 'krasheninnikov-2026')!)).toBe('2 Aug 2025');
  });
  it('the assistant is not given the invented day either', () => {
    expect(buildEventContext(flood).date).toBe('2026-01');
    expect(buildEventContext(events.find((e) => e.id === 'venezuela-2026')!).date).toBe('2026-06-24T22:04:00Z');
  });
  it('every investigation date agrees with the dates of its radar layers (event year within their span, give or take a year)', () => {
    for (const e of events) {
      const years = e.layers.flatMap((l) => Object.values(l.acquisition).filter(Boolean).map((d) => Number(String(d).slice(0, 4))));
      const y = Number(e.date!.slice(0, 4));
      expect(y, e.id).toBeGreaterThanOrEqual(Math.min(...years) - 1);
      expect(y, e.id).toBeLessThanOrEqual(Math.max(...years));
    }
  });
});
