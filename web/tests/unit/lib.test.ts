import { describe, expect, it } from 'vitest';
import * as lib from '../../src/lib';
import { fmtCoord, fmtDate, fmtDateTime, layerBounds, layerLabel, layerStart, parseCoords } from '../../src/lib';
import { syntheticEvent, syntheticPairEvent } from '../fixtures/events.fixture';

describe('fmtDate (UTC, TZ=America/Los_Angeles set in setup)', () => {
  it('formats in UTC, not local time', () => {
    // 00:30Z on the 17th is still the 16th in Los Angeles.
    expect(fmtDate('2026-01-17T00:30:00Z')).toBe('17 Jan 2026');
    expect(fmtDate('2026-12-31T23:59:59Z')).toBe('31 Dec 2026');
  });
  it('handles year/month boundaries', () => {
    expect(fmtDate('2026-01-01T00:00:00Z')).toBe('1 Jan 2026');
    expect(fmtDate('2024-02-29T12:00:00Z')).toBe('29 Feb 2024');
  });
  it('returns an em dash for empty values', () => {
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('')).toBe('—');
  });
  // (ISSUE-QA-05: fixed during the audit; kept as a regression test.)
  it('does not render "NaN" for an unparseable date (fixed during the audit: ISSUE-QA-05)', () => {
    expect(fmtDate('not-a-date')).not.toMatch(/NaN|undefined/);
  });
});

describe('fmtDateTime', () => {
  it('appends UTC HH:MM', () => {
    expect(fmtDateTime('2026-06-24T22:04:00Z')).toBe('24 Jun 2026 22:04 UTC');
  });
  it('empty -> em dash', () => expect(fmtDateTime(null)).toBe('—'));
  // (ISSUE-QA-05 date-only part: fixed during the audit.)
  it('date-only input does not produce a dangling "UTC" (fixed during the audit: ISSUE-QA-05)', () => {
    expect(fmtDateTime('2026-06-24')).not.toMatch(/\s{2}UTC$/);
  });
});

describe('fmtCoord', () => {
  it('uses hemisphere letters', () => {
    expect(fmtCoord(-67.2205, 10.5956)).toBe('10.596°N 67.221°W');
    expect(fmtCoord(33, -24.55)).toBe('24.550°S 33.000°E');
  });
  it('treats 0 as N/E', () => expect(fmtCoord(0, 0)).toBe('0.000°N 0.000°E'));
});

describe('layer helpers', () => {
  const [b, a, d] = syntheticEvent.layers;
  it('layerStart prefers start, falls back to reference', () => {
    expect(layerStart(b)).toBe('2026-01-05T03:42:32Z');
    expect(layerStart(d)).toBe('2026-01-05T03:42:32Z');
  });
  it('layerLabel: single date or pair with arrow', () => {
    expect(layerLabel(a)).toBe('17 Jan 2026');
    expect(layerLabel(d)).toBe('5 Jan 2026 → 17 Jan 2026');
  });
  it('layerBounds returns [[minLon,minLat],[maxLon,maxLat]]', () => {
    expect(layerBounds(syntheticEvent.layers)).toEqual([[32, -25], [34, -24]]);
    expect(layerBounds(syntheticPairEvent.layers)).toEqual([[-69, 9.7], [-66.6, 10.9]]);
  });
  it('layerBounds of one layer is its own bbox', () => {
    expect(layerBounds([d])).toEqual([[32.5, -24.8], [33.5, -24.2]]);
  });
  // ISSUE-QA-06 (fixed): no layers -> null, never [[Infinity,Infinity],[-Infinity,-Infinity]].
  it('layerBounds of no layers returns null (callers fall back to the event location)', () => {
    expect(layerBounds([])).toBeNull();
  });
});

describe('parseCoords', () => {
  const ok: [string, [number, number]][] = [
    ['10.5, -67.2', [-67.2, 10.5]],
    ['10.5,-67.2', [-67.2, 10.5]],
    ['  10.5   -67.2  ', [-67.2, 10.5]],
    ['10.5; -67.2', [-67.2, 10.5]],
    ['10.5N 67.2W', [-67.2, 10.5]],
    ['10.5 N, 67.2 W', [-67.2, 10.5]],
    ['10.5°N, 67.2°W', [-67.2, 10.5]],
    ['10.5S 33E', [33, -10.5]],
    ['10.5s 33e', [33, -10.5]],
    ['-24.55, 33', [33, -24.55]],
    ['0, 0', [0, 0]],
    ['90, 180', [180, 90]],
    ['-90, -180', [-180, -90]],
    ['45 S, 120 W', [-120, -45]],
  ];
  it.each(ok)('parses %s', (q, expected) => expect(parseCoords(q)).toEqual(expected));

  const bad = ['', '   ', 'Caracas', '10.5', '10.5,', ',67.2', '91, 0', '-91, 0', '0, 181', '0, -181', '10.5 67.2 12', 'a, b', '10..5, 3', '10.5N67.2W'];
  it.each(bad)('rejects %j', (q) => expect(parseCoords(q)).toBeNull());

  it('S/W letters force the sign regardless of input sign', () => {
    expect(parseCoords('-10 S, -20 W')).toEqual([-20, -10]);
    expect(parseCoords('10 S, 20 W')).toEqual([-20, -10]);
  });
  it('N/E letters never flip a negative number (documented behaviour)', () => {
    expect(parseCoords('-10 N, -20 E')).toEqual([-20, -10]);
  });

  it('accepts a leading + sign ("+10.5, +67.2")', () => {
    expect(parseCoords('+10.5, +67.2')).toEqual([67.2, 10.5]);
  });
  it('accepts lon-first hemisphere ordering ("67.2W 10.5N")', () => {
    expect(parseCoords('67.2W 10.5N')).toEqual([-67.2, 10.5]);
  });
  it('accepts a decimal comma ("10,5 N 67,2 W")', () => {
    expect(parseCoords('10,5 N 67,2 W')).toEqual([-67.2, 10.5]);
  });

  // A hemisphere letter separated from "<number>°" must attach to THAT number, not the next one.
  it.each<[string, [number, number]]>([
    ['10.5° N, 67.2° W', [-67.2, 10.5]],
    ['45° N 90°', [90, 45]],
    ['40° S 20°', [20, -40]],
    ['67.2° W 10.5° N', [-67.2, 10.5]],
    ['10.5°N 67.2°W', [-67.2, 10.5]],
    ['N 10.5° W 67.2°', [-67.2, 10.5]],
  ])('degree sign before a separated hemisphere letter: %s', (q, expected) => {
    expect(parseCoords(q)).toEqual(expected);
  });
});

describe('category tables', () => {
  it('every category has a label and a colour, and the key sets agree', () => {
    const labels = Object.keys(lib.CATEGORY_LABEL).sort();
    const colors = Object.keys(lib.CATEGORY_COLOR).sort();
    expect(colors).toEqual(labels);
    for (const c of labels) {
      expect((lib.CATEGORY_LABEL as Record<string, string>)[c]).toBeTruthy();
      expect((lib.CATEGORY_COLOR as Record<string, string>)[c]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('category groups (if defined) partition the categories exactly once', () => {
    const groups = (lib as any).GROUPS as { categories: string[] }[] | undefined;
    if (!groups) return;
    const all = groups.flatMap((g) => g.categories);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(Object.keys(lib.CATEGORY_LABEL).sort());
  });
});
