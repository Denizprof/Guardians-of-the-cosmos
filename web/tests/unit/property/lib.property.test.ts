// Property-based + fuzz tests for src/lib.ts (parseCoords, parseUTC, fmtDate, fmtDateTime, layerBounds).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseCoords, parseUTC, fmtDate, fmtDateTime, layerBounds } from '../../../src/lib';
import type { SarLayer } from '../../../src/types';

const RUNS = { numRuns: 400 };
// thousandths of a degree: exactly representable round trips through toFixed(3)
const latM = fc.integer({ min: -90000, max: 90000 });
const lonM = fc.integer({ min: -180000, max: 180000 });
const f3 = (m: number) => (m / 1000).toFixed(3);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const expectLonLat = (r: [number, number] | null, la: number, lo: number) => {
  expect(r).not.toBeNull();
  expect(near(r![0], lo / 1000) && near(r![1], la / 1000)).toBe(true);
};

describe('parseCoords round trip', () => {
  it('"lat, lon" decimal with signs', () => {
    fc.assert(fc.property(latM, lonM, fc.constantFrom(', ', ',', ' ', '; ', '  '), (la, lo, sep) => {
      expectLonLat(parseCoords(`${f3(la)}${sep}${f3(lo)}`), la, lo);
    }), RUNS);
  });

  it('explicit "+" signs and the Unicode minus', () => {
    fc.assert(fc.property(latM, lonM, (la, lo) => {
      const sg = (m: number) => (m < 0 ? `−${f3(-m)}` : `+${f3(m)}`);
      expectLonLat(parseCoords(`${sg(la)}, ${sg(lo)}`), la, lo);
    }), RUNS);
  });

  it('hemisphere letters, lat first, suffix or prefix, optional degree sign, any case', () => {
    fc.assert(fc.property(latM, lonM, fc.boolean(), fc.boolean(), fc.boolean(), fc.constantFrom(' ', ', ', '  '), (la, lo, prefix, deg, lower, sep) => {
      const ns = la < 0 ? 'S' : 'N', ew = lo < 0 ? 'W' : 'E';
      const one = (m: number, h: string) => {
        const H = lower ? h.toLowerCase() : h;
        const n = f3(Math.abs(m)) + (deg ? '°' : '');
        return prefix ? `${H}${n}` : `${n}${H}`;
      };
      expectLonLat(parseCoords(`${one(la, ns)}${sep}${one(lo, ew)}`), la, lo);
    }), RUNS);
  });

  it('hemisphere letters, lon first', () => {
    fc.assert(fc.property(latM, lonM, (la, lo) => {
      expectLonLat(parseCoords(`${f3(Math.abs(lo))}${lo < 0 ? 'W' : 'E'} ${f3(Math.abs(la))}${la < 0 ? 'S' : 'N'}`), la, lo);
    }), RUNS);
  });

  it('decimal comma with hemisphere letters ("10,500 N 67,200 W")', () => {
    fc.assert(fc.property(latM, lonM, (la, lo) => {
      const c = (m: number) => f3(Math.abs(m)).replace('.', ',');
      expectLonLat(parseCoords(`${c(la)} ${la < 0 ? 'S' : 'N'} ${c(lo)} ${lo < 0 ? 'W' : 'E'}`), la, lo);
    }), RUNS);
  });

  it('fmtCoord-style output ("12.345°N 67.890°W") parses back', () => {
    fc.assert(fc.property(latM, lonM, (la, lo) => {
      const s = `${f3(Math.abs(la))}°${la >= 0 ? 'N' : 'S'} ${f3(Math.abs(lo))}°${lo >= 0 ? 'E' : 'W'}`;
      expectLonLat(parseCoords(s), la, lo);
    }), RUNS);
  });

  // BUG-WEB-1: the "decimal comma" rewrite /(\d),(\d)/ -> "$1.$2" runs whenever the input has no dot,
  // so a plain integer pair such as "45,90" (lat,lon) becomes the single token "45.90" and returns null.
  // Failing input: "45,90" (also "10,20"). web/src/lib.ts:~129
  it('BUG-WEB-1 (fixed, regression): integer "lat,lon" pairs without a space parse', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 90 }), fc.integer({ min: 0, max: 180 }), (la, lo) => {
      expect(parseCoords(`${la},${lo}`)).toEqual([lo, la]);
    }), RUNS);
  });
});

describe('parseCoords never misbehaves', () => {
  const inRange = (r: [number, number] | null) => r === null || (Number.isFinite(r[0]) && Number.isFinite(r[1]) && Math.abs(r[0]) <= 180 && Math.abs(r[1]) <= 90);

  it('arbitrary strings: never throws, result null or in range', () => {
    fc.assert(fc.property(fc.string({ maxLength: 60 }), (s) => { expect(inRange(parseCoords(s))).toBe(true); }), { numRuns: 1000 });
    fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (s) => { expect(inRange(parseCoords(s))).toBe(true); }), RUNS);
    fc.assert(fc.property(fc.string({ unit: 'grapheme', maxLength: 40 }), (s) => { expect(inRange(parseCoords(s))).toBe(true); }), RUNS);
  });

  it('coordinate-like soup (digits, signs, letters, separators): never throws, in range', () => {
    const chars = '0123456789.,;+-− °NSEWnsew\t'.split('');
    const soup = fc.array(fc.constantFrom(...chars), { maxLength: 30 }).map((a) => a.join(''));
    fc.assert(fc.property(soup, (s) => { expect(inRange(parseCoords(s))).toBe(true); }), { numRuns: 2000 });
  });

  it('out-of-range numbers are rejected', () => {
    fc.assert(fc.property(fc.integer({ min: 90001, max: 99999 }), lonM, (la, lo) => {
      expect(parseCoords(`${f3(la)}, ${f3(lo)}`)).toBeNull();
      expect(parseCoords(`${f3(-la)}, ${f3(lo)}`)).toBeNull();
    }), RUNS);
    fc.assert(fc.property(latM, fc.integer({ min: 180001, max: 999999 }), (la, lo) => {
      expect(parseCoords(`${f3(la)}, ${f3(lo)}`)).toBeNull();
    }), RUNS);
  });

  it('two latitudes (or two longitudes) with hemisphere letters are rejected', () => {
    fc.assert(fc.property(latM, latM, (a, b) => {
      expect(parseCoords(`${f3(Math.abs(a))}N ${f3(Math.abs(b))}S`)).toBeNull();
      expect(parseCoords(`${f3(Math.abs(a))}E ${f3(Math.abs(b))}W`)).toBeNull();
    }), RUNS);
  });

  it('wrong token counts return null', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 80 }), { minLength: 3, maxLength: 6 }), (xs) => {
      expect(parseCoords(xs.join(' '))).toBeNull();
    }), RUNS);
    expect(parseCoords('')).toBeNull();
    expect(parseCoords('   ')).toBeNull();
    expect(parseCoords('12.5')).toBeNull();
  });
});

describe('date helpers', () => {
  const instants = fc.date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-12-31T23:59:59Z'), noInvalidDate: true });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const expected = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

  it('fmtDate / fmtDateTime / parseUTC never throw on arbitrary input', () => {
    const input = fc.oneof(fc.string({ maxLength: 40 }), fc.string({ unit: 'binary', maxLength: 40 }), fc.constantFrom(undefined, null, ''));
    fc.assert(fc.property(input, (s) => {
      expect(parseUTC(s as string)).toBeInstanceOf(Date);
      expect(typeof fmtDate(s)).toBe('string');
      expect(typeof fmtDateTime(s)).toBe('string');
    }), { numRuns: 1000 });
  });

  it('date-like soup returns the em dash or a well-formed string', () => {
    const soup = fc.array(fc.constantFrom(...'0123456789-:TZ.+ '.split('')), { maxLength: 30 }).map((a) => a.join(''));
    fc.assert(fc.property(soup, (s) => {
      expect(fmtDate(s)).toMatch(/^(—|\d{1,2} [A-Z][a-z]{2} -?\d+)$/);
      expect(fmtDateTime(s)).toMatch(/^(—|\d{1,2} [A-Z][a-z]{2} -?\d+( \d{2}:\d{2} UTC)?)$/);
    }), { numRuns: 1000 });
  });

  it('is UTC-stable: matches the UTC fields of the instant for Z timestamps', () => {
    fc.assert(fc.property(instants, (d) => {
      expect(fmtDate(d.toISOString())).toBe(expected(d));
      expect(fmtDateTime(d.toISOString())).toBe(`${expected(d)} ${d.toISOString().slice(11, 16)} UTC`);
    }), RUNS);
  });

  it('offset-less timestamps (HDF5 style) are read as UTC', () => {
    fc.assert(fc.property(instants, (d) => {
      const naive = d.toISOString().replace(/\.\d{3}Z$/, '');
      expect(parseUTC(naive).getTime()).toBe(Math.floor(d.getTime() / 1000) * 1000);
      expect(fmtDateTime(naive)).toBe(`${expected(d)} ${naive.slice(11, 16)} UTC`);
    }), RUNS);
  });

  it('formatting is independent of the process timezone', () => {
    const before = process.env.TZ;
    try {
      fc.assert(fc.property(instants, fc.constantFrom('Pacific/Kiritimati', 'America/Los_Angeles', 'UTC', 'Asia/Kolkata', 'Pacific/Pago_Pago'), (d, tz) => {
        process.env.TZ = tz;
        const day = d.toISOString().slice(0, 10);
        expect(fmtDate(day)).toBe(expected(new Date(`${day}T00:00:00Z`)));
        expect(fmtDateTime(day)).toBe(fmtDate(day));
        expect(fmtDate(d.toISOString())).toBe(expected(d));
      }), RUNS);
    } finally {
      process.env.TZ = before;
    }
  });

  it('fmtDateTime has a time only when the input has one', () => {
    fc.assert(fc.property(instants, (d) => {
      expect(fmtDateTime(d.toISOString().slice(0, 10))).not.toMatch(/UTC/);
      expect(fmtDateTime(d.toISOString())).toMatch(/ \d{2}:\d{2} UTC$/);
    }), RUNS);
  });
});

describe('layerBounds', () => {
  const pt = fc.tuple(fc.double({ min: -180, max: 180, noNaN: true }), fc.double({ min: -90, max: 90, noNaN: true }));
  const layer = fc.tuple(pt, pt, pt, pt).map((c) => ({ id: 'x', coordinates: c }) as unknown as SarLayer);

  it('contains every corner and is tight (min/max are attained)', () => {
    fc.assert(fc.property(fc.array(layer, { minLength: 1, maxLength: 30 }), (layers) => {
      const [[w, s], [e, n]] = layerBounds(layers)!;
      const pts = layers.flatMap((l) => l.coordinates);
      for (const [lon, lat] of pts) expect(lon >= w && lon <= e && lat >= s && lat <= n).toBe(true);
      expect(pts.some((p) => p[0] === w) && pts.some((p) => p[0] === e)).toBe(true);
      expect(pts.some((p) => p[1] === s) && pts.some((p) => p[1] === n)).toBe(true);
      expect(w <= e && s <= n).toBe(true);
    }), RUNS);
  });

  it('is order-independent and null for no layers', () => {
    expect(layerBounds([])).toBeNull();
    fc.assert(fc.property(fc.array(layer, { minLength: 1, maxLength: 10 }), (layers) => {
      expect(layerBounds([...layers].reverse())).toEqual(layerBounds(layers));
    }), RUNS);
  });
});
