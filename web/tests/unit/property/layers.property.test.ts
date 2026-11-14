// Property-based tests for src/layers.ts (clampDate, timeToken, defaultDate, isSubDaily).
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { clampDate, timeToken, defaultDate, isSubDaily, type CatalogLayer } from '../../../src/layers';

const RUNS = { numRuns: 400 };
const iso = (days: number) => new Date(days * 864e5).toISOString().slice(0, 10);
const day = (y0 = 1990, y1 = 2040) => fc.integer({ min: Date.UTC(y0, 0, 1) / 864e5, max: Date.UTC(y1, 11, 31) / 864e5 }).map(iso);

type Time = NonNullable<CatalogLayer['time']>;
function mk(step: string, start: string, end: string, extra: Partial<Time> = {}): CatalogLayer {
  return {
    id: 'L', url: 'https://x/{time}/{z}/{x}/{y}', tileSize: 256, minzoom: 0, maxzoom: 9, attribution: 'a',
    time: { start, end, step, default: end, ...extra },
  } as unknown as CatalogLayer;
}
const noTime = { ...mk('P1D', 'a', 'b'), time: null } as CatalogLayer;
const range = fc.tuple(day(2000, 2030), day(2000, 2030)).map(([a, b]) => (a <= b ? [a, b] : [b, a]) as [string, string]);
const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const dayOfYear = (s: string) => Math.round((Date.parse(s) - Date.UTC(+s.slice(0, 4), 0, 1)) / 864e5) + 1;

afterEach(() => vi.useRealTimers());

describe('clampDate', () => {
  it('always lands inside [start, end]; identity inside; idempotent', () => {
    fc.assert(fc.property(range, day(1900, 2100), fc.boolean(), ([s, e], d, withTime) => {
      const l = mk('P1D', s, e);
      const c = clampDate(l, withTime ? `${d}T12:34:56Z` : d);
      expect(c >= s && c <= e).toBe(true);
      expect(c).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (d >= s && d <= e) expect(c).toBe(d);
      expect(clampDate(l, c)).toBe(c);
    }), RUNS);
  });

  it('end "present" caps at yesterday', () => {
    fc.assert(fc.property(day(2000, 2100), (d) => {
      const c = clampDate(mk('P1D', '2000-01-01', 'present'), d);
      expect(c >= '2000-01-01' && c <= yesterday()).toBe(true);
    }), RUNS);
  });

  it('layers without time or with sub-daily steps just truncate to 10 chars', () => {
    fc.assert(fc.property(fc.string({ minLength: 10, maxLength: 30 }), (d) => {
      expect(clampDate(noTime, d)).toBe(d.slice(0, 10));
      expect(clampDate(mk('PT10M', '2000-01-01', '2000-01-02'), d)).toBe(d.slice(0, 10));
    }), RUNS);
  });

  it('defaultDate is within range and null without time', () => {
    fc.assert(fc.property(range, ([s, e]) => {
      const d = defaultDate(mk('P1D', s, e))!;
      expect(d >= s && d <= e).toBe(true);
    }), RUNS);
    expect(defaultDate(noTime)).toBeNull();
  });

  it('isSubDaily iff step starts with PT', () => {
    fc.assert(fc.property(fc.constantFrom('P1D', 'P1Y', 'P16D', 'PT10M', 'PT1H', 'P1M'), (st) => {
      expect(isSubDaily(mk(st, '2000-01-01', '2001-01-01'))).toBe(st.startsWith('PT'));
    }), { numRuns: 30 });
  });
});

describe('timeToken', () => {
  it('P1D: the clamped date', () => {
    fc.assert(fc.property(range, day(1990, 2040), ([s, e], d) => {
      const l = mk('P1D', s, e);
      const t = timeToken(l, d);
      expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t).toBe(clampDate(l, d));
    }), RUNS);
  });

  it('P1Y: "YYYY" with format YYYY, else "YYYY-01-01"; year is the clamped year', () => {
    fc.assert(fc.property(range, day(1990, 2040), ([s, e], d) => {
      const c = clampDate(mk('P1Y', s, e), d);
      const y = timeToken(mk('P1Y', s, e, { format: 'YYYY' }), d);
      expect(y).toMatch(/^\d{4}$/);
      expect(y).toBe(c.slice(0, 4));
      const full = timeToken(mk('P1Y', s, e), d);
      expect(full).toMatch(/^\d{4}-01-01$/);
      expect(full).toBe(`${c.slice(0, 4)}-01-01`);
    }), RUNS);
  });

  it('P16D: token is a composite start (day-of-year 1,17,33,...), 0-15 days before the date, same year', () => {
    fc.assert(fc.property(range, day(2000, 2030), ([s, e], d) => {
      const l = mk('P16D', s, e);
      const c = clampDate(l, d);
      const t = timeToken(l, d);
      expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.slice(0, 4)).toBe(c.slice(0, 4));
      expect((dayOfYear(t) - 1) % 16).toBe(0);
      const gap = (Date.parse(c) - Date.parse(t)) / 864e5;
      expect(gap >= 0 && gap <= 15).toBe(true);
    }), { numRuns: 800 });
  });

  it('P16D: all days of a year map onto exactly the 23 expected composite starts', () => {
    const l = mk('P16D', '2000-01-01', '2040-12-31');
    for (const y of [2023, 2024]) {
      const starts = new Set<string>();
      for (let n = 0; n < (y === 2024 ? 366 : 365); n++) starts.add(timeToken(l, iso(Date.UTC(y, 0, 1 + n) / 864e5)));
      expect(starts.size).toBe(23);
      expect([...starts].every((s) => (dayOfYear(s) - 1) % 16 === 0)).toBe(true);
    }
  });

  it('PT10M: ISO with Z, on a 10-minute boundary, 40-50 minutes old', () => {
    fc.assert(fc.property(fc.date({ min: new Date('2001-01-01T00:00:00Z'), max: new Date('2090-01-01T00:00:00Z'), noInvalidDate: true }), (now) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
      const t = timeToken(mk('PT10M', '2000-01-01', 'present'), null);
      vi.useRealTimers();
      expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
      expect(+t.slice(14, 16) % 10).toBe(0);
      const age = (now.getTime() - Date.parse(t)) / 6e4;
      expect(age >= 40 && age < 50).toBe(true);
    }), RUNS);
  });

  it('no time dimension gives an empty token; null date falls back to the default', () => {
    expect(timeToken(noTime, '2020-01-01')).toBe('');
    fc.assert(fc.property(range, ([s, e]) => {
      expect(timeToken(mk('P1D', s, e), null)).toBe(clampDate(mk('P1D', s, e), e));
    }), RUNS);
  });
});
