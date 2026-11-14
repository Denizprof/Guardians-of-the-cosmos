// node --test pipeline/tests
// Property-based + fuzz tests (fast-check) for asf.mjs, georef.mjs and the fetch-catalogs normalizers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { parseGranuleName, tierOf } from '../src/asf.mjs';
import { georeference } from '../src/georef.mjs';
import {
  parseCsv, normalizeTsunamis, normalizeVolcanoes, normalizeUsgs, normalizeGlc, normalizeGdacsFloods,
  aggregateFirms, firmsCellsToEvents, confidenceClass,
} from '../src/fetch-catalogs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', `${n}.fixture.json`), 'utf8'));
const RUNS = { numRuns: 300 };

/** A known bug: the property must FAIL today (strict: if it starts passing, this test fails so the marker is removed). */
function knownBug(id, title, fn) {
  test(`${id}: ${title}`, async () => {
    let failed = false;
    try { await fn(); } catch { failed = true; }
    assert.ok(failed, `${id} appears fixed: convert this knownBug() into a regular test`);
  });
}

// ------------------------------------------------------------------ asf.mjs
test('tierOf: total, one of four tiers, UR prefix wins, BETA/PROVISIONAL by infix', () => {
  fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 40 }), fc.string({ unit: 'binary', maxLength: 40 })), (s) => {
    const t = tierOf(s);
    assert.ok(['URGENT RESPONSE', 'BETA', 'PROVISIONAL', 'VALIDATED'].includes(t));
    assert.equal(t === 'URGENT RESPONSE', s.startsWith('NISAR_UR'));
  }), { numRuns: 1000 });
  fc.assert(fc.property(fc.string({ maxLength: 10 }).filter((s) => !s.startsWith('NISAR_UR')), fc.string({ maxLength: 10 }), (a, b) => {
    assert.equal(tierOf(`${a}_BETA_${b}`), 'BETA');
    if (!`${a}_PROVISIONAL_${b}`.includes('_BETA_')) assert.equal(tierOf(`${a}_PROVISIONAL_${b}`), 'PROVISIONAL');
    assert.equal(tierOf(`NISAR_UR${a}_BETA_${b}`), 'URGENT RESPONSE');
  }), RUNS);
});

test('parseGranuleName never throws on arbitrary strings and only emits well-formed timestamps', () => {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  const soup = fc.array(fc.constantFrom(...'0123456789TXPVNAGUCOVW_-.'.split('')), { maxLength: 80 }).map((a) => a.join(''));
  fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 80 }), fc.string({ unit: 'binary', maxLength: 80 }), soup), (s) => {
    const m = parseGranuleName(s);
    assert.equal(typeof m, 'object');
    const stamps = s.match(/\d{8}T\d{6}/g) || [];
    if (stamps.length) {
      assert.match(m.start, ISO);
      assert.equal(m.startDate, stamps[0].slice(0, 8));
    } else {
      assert.equal(m.start, undefined);
    }
    assert.ok(m.crid === null || /^[XPV]\d{5}$/.test(m.crid));
    if (m.secondaryStart !== undefined) {
      assert.equal(m.product, 'GUNW');
      assert.match(m.secondaryStart, ISO);
    }
  }), { numRuns: 2000 });
});

test('parseGranuleName round-trips synthesized NISAR names', () => {
  const stamp = fc.date({ min: new Date('2025-01-01'), max: new Date('2035-01-01'), noInvalidDate: true })
    .map((d) => d.toISOString().replace(/[-:]/g, '').slice(0, 15));
  const digits = (n) => fc.integer({ min: 0, max: 10 ** n - 1 }).map((v) => String(v).padStart(n, '0'));
  const crid = fc.tuple(fc.constantFrom('X', 'P', 'V'), digits(5)).map((a) => a.join(''));
  fc.assert(fc.property(fc.constantFrom('GCOV', 'GSLC', 'GOFF', 'RSLC'), stamp, stamp, crid, digits(3), (product, s1, s2, c, track) => {
    const g = `NISAR_L2_PR_${product}_${track}_114_A_165_4005_DHDH_A_${s1}_${s2}_${c}_N_P_J_001`;
    const m = parseGranuleName(g);
    assert.equal(m.product, product);
    assert.equal(m.crid, c);
    assert.equal(m.startDate, s1.slice(0, 8));
    assert.equal(m.start, `${s1.slice(0, 4)}-${s1.slice(4, 6)}-${s1.slice(6, 8)}T${s1.slice(9, 11)}:${s1.slice(11, 13)}:${s1.slice(13, 15)}Z`);
    assert.equal(m.secondaryDate, undefined);
  }), RUNS);
  fc.assert(fc.property(stamp, stamp, stamp, stamp, crid, (a, b, c2, d, c) => {
    const g = `NISAR_L2_PR_GUNW_021_162_A_007_022_4000_SH_${a}_${b}_${c2}_${d}_${c}_N_F_J_001`;
    const m = parseGranuleName(g);
    assert.equal(m.product, 'GUNW');
    assert.equal(m.startDate, a.slice(0, 8));
    assert.equal(m.secondaryDate, c2.slice(0, 8));
    assert.equal(Date.parse(m.secondaryStart), Date.UTC(+c2.slice(0, 4), +c2.slice(4, 6) - 1, +c2.slice(6, 8), +c2.slice(9, 11), +c2.slice(11, 13), +c2.slice(13, 15)));
  }), RUNS);
});

// ------------------------------------------------------------------ georef.mjs
const M_PER_DEG = 111320;
const DEG = 0.001;
const PX_M = DEG * M_PER_DEG;
const errM = (a, b) => Math.hypot((a[0] - b[0]) * M_PER_DEG * Math.cos((b[1] * Math.PI) / 180), (a[1] - b[1]) * M_PER_DEG);

function synthetic({ w, h, cx, cy, rw, rh, angleDeg, lon0, lat0 }) {
  const px = new Uint8ClampedArray(w * h * 4);
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
      if (Math.abs(u) > rw / 2 || Math.abs(v) > rh / 2) continue;
      const i = (y * w + x) * 4;
      px[i] = 120 + ((x * 7 + y * 3) % 100); px[i + 1] = 90; px[i + 2] = 60; px[i + 3] = 255;
    }
  }
  const truth = (x, y) => [lon0 + DEG * x, lat0 - DEG * y];
  const corner = (su, sv) => { const u = (su * rw) / 2, v = (sv * rh) / 2; return [cx + u * cos - v * sin, cy + u * sin + v * cos]; };
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const ring = corners.map(([x, y]) => truth(x, y));
  ring.push(ring[0]);
  return { px, w, h, ring, truth, corners };
}

// Random rotated rectangle that fits inside the image, tilt -30..30 deg.
const sceneWith = (angleDeg) => fc.record({
  angleDeg,
  rw: fc.integer({ min: 200, max: 420 }),
  rh: fc.integer({ min: 180, max: 380 }),
  lon0: fc.double({ min: -170, max: 170, noNaN: true }),
  lat0: fc.double({ min: -55, max: 55, noNaN: true }),
  jx: fc.double({ min: -1, max: 1, noNaN: true }),
  jy: fc.double({ min: -1, max: 1, noNaN: true }),
}).map(({ angleDeg, rw, rh, lon0, lat0, jx, jy }) => {
  const a = (Math.abs(angleDeg) * Math.PI) / 180;
  const ex = (rw * Math.cos(a) + rh * Math.sin(a)) / 2, ey = (rw * Math.sin(a) + rh * Math.cos(a)) / 2; // half extents
  const margin = 12;
  const w = Math.ceil(2 * ex + 2 * margin + 120), h = Math.ceil(2 * ey + 2 * margin + 120);
  const cx = w / 2 + jx * (w / 2 - ex - margin), cy = h / 2 + jy * (h / 2 - ey - margin);
  return { w, h, cx, cy, rw, rh, angleDeg, lon0, lat0 };
});
const tilt = fc.double({ min: -30, max: 30, noNaN: true });
// tilts the heuristic currently handles: exactly north-up, or 10 <= |tilt| <= 25 deg (beyond ~25 deg elongated rectangles fail too, e.g. tilt -29.7, 201x369 px: 142 px off; part of BUG-PIPE-6)
const supportedTilt = fc.oneof(fc.constant(0), fc.double({ min: 10, max: 25, noNaN: true }), fc.double({ min: -25, max: -10, noNaN: true }));
const cornerErrors = (p) => {
  const s = synthetic(p);
  const geo = georeference(s.px, s.w, s.h, s.ring);
  return s.corners.map(([x, y]) => errM(geo.toLonLat(x, y), s.truth(x, y)) / PX_M);
};

test('georeference: random rotated rectangles (tilt 0 or 10..25 deg either way, sizes, offsets) have corner error <= 6 px', () => {
  fc.assert(fc.property(sceneWith(supportedTilt), (p) => {
    const worst = Math.max(...cornerErrors(p));
    assert.ok(worst <= 6, `worst corner off by ${worst.toFixed(1)} px for ${JSON.stringify(p)}`);
  }), { numRuns: 150 });
});

// BUG-PIPE-6: for a rectangle that is only slightly tilted (0 < |tilt| < ~4 deg, also ~6) the corner-matching in
// georef.mjs picks the wrong footprint corner for the "axis" flavour (top/bottom/left/right ties between two nearly
// equal-latitude / equal-longitude corners) while its residual stays small, so the fit is off by up to ~18 px at 1 deg
// and ~180-220 px (20+ km) for a tilt of 1e-3..1e-12 deg, yet residualMeters reports only ~28 m (cf. ISSUE-QA-12).
// src/georef.mjs footprintCorners()/georeference() ~lines 55-70 and 138-142.
// Failing input: 600x500 image, 360x300 rectangle at the centre, angleDeg=1 (error 18 px) or 1e-12 (error 224 px).
knownBug('BUG-PIPE-6', 'georeference corner error <= 6 px for any tilt in -30..30 deg', () => {
  fc.assert(fc.property(sceneWith(fc.oneof(tilt, fc.double({ min: -4, max: 4, noNaN: true }))), (p) => {
    const worst = Math.max(...cornerErrors(p));
    assert.ok(worst <= 6, `worst corner off by ${worst.toFixed(1)} px`);
  }), { numRuns: 150 });
});

test('georeference: toPixel inverts toLonLat on random scenes and the fit stays finite', () => {
  fc.assert(fc.property(sceneWith(supportedTilt), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (p, fx_, fy_) => {
    const s = synthetic(p);
    const geo = georeference(s.px, s.w, s.h, s.ring);
    assert.ok(Number.isFinite(geo.residualMeters));
    const x = fx_ * s.w, y = fy_ * s.h;
    const [lon, lat] = geo.toLonLat(x, y);
    const [x2, y2] = geo.toPixel(lon, lat);
    assert.ok(Math.abs(x - x2) < 1e-4 && Math.abs(y - y2) < 1e-4, `(${x},${y}) -> (${x2},${y2}) for ${JSON.stringify(p)}`);
  }), { numRuns: 60 });
});

test('georeference: random noise images either fail loudly or never yield non-finite transforms silently', () => {
  fc.assert(fc.property(fc.integer({ min: 4, max: 30 }), fc.integer({ min: 4, max: 30 }), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (w, h, seed) => {
    let s = seed || 1;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const px = new Uint8ClampedArray(w * h * 4).map(() => Math.floor(rnd() * 256));
    const ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    try {
      const g = georeference(px, w, h, ring);
      assert.equal(typeof g.toLonLat, 'function');
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  }), { numRuns: 200 });
});

// ------------------------------------------------------------------ catalog normalizers
const CATEGORIES = new Set(['earthquake', 'volcano', 'landslide', 'tsunami', 'wildfire', 'flood']);
function eventProblems(e) {
  const p = [];
  if (!e || typeof e !== 'object') return ['not an object'];
  if (typeof e.id !== 'string' || !e.id) p.push('id');
  if (typeof e.title !== 'string' || !e.title) p.push('title');
  if (!CATEGORIES.has(e.category)) p.push('category');
  if (!(typeof e.lon === 'number' && Number.isFinite(e.lon) && Math.abs(e.lon) <= 180)) p.push(`lon=${e.lon}`);
  if (!(typeof e.lat === 'number' && Number.isFinite(e.lat) && Math.abs(e.lat) <= 90)) p.push(`lat=${e.lat}`);
  if (typeof e.date !== 'string' || Number.isNaN(Date.parse(e.date)) || !/^-?\d{4,6}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(e.date)) p.push(`date=${e.date}`);
  return p;
}
const assertValid = (evs) => {
  assert.ok(Array.isArray(evs));
  for (const e of evs) assert.deepEqual(eventProblems(e), [], JSON.stringify(e));
};

const junk = fc.oneof(
  fc.constant(null), fc.constant(undefined), fc.constant(''), fc.constant('abc'), fc.constant('-5'), fc.constant('NaN'),
  fc.integer(), fc.double({ noNaN: true }), fc.constantFrom(1e21, -1e21, 0, -0, 13, 99, 1950.5, 2 ** 53),
  fc.boolean(), fc.array(fc.integer(), { maxLength: 2 }), fc.dictionary(fc.string({ maxLength: 3 }), fc.integer(), { maxKeys: 2 }),
);
/** Randomly delete or retype fields of records (deep copy). */
function perturbed(records, { stringOnly = false } = {}) {
  const jv = stringOnly ? fc.oneof(fc.constant(''), fc.constant('abc'), fc.constant('-5'), fc.constant('99/99/9999'), fc.constant('13/45/2020 25:61:61 PM'), fc.string({ maxLength: 8 })) : junk;
  return fc.array(fc.record({ ri: fc.nat(), ki: fc.nat(), del: fc.boolean(), v: jv, nested: fc.boolean() }), { minLength: 1, maxLength: 10 }).map((muts) => {
    const out = structuredClone(records);
    for (const m of muts) {
      let rec = out[m.ri % out.length];
      // nested: perturb inside geometry / properties containers when present
      if (m.nested) for (const k of ['properties', 'geometry']) if (rec[k] && typeof rec[k] === 'object') { rec = rec[k]; break; }
      const keys = Object.keys(rec);
      if (!keys.length) continue;
      const k = keys[m.ki % keys.length];
      if (m.del || m.v === undefined) delete rec[k];
      else rec[k] = JSON.parse(JSON.stringify(m.v)); // JSON-realistic (no null-prototype objects, NaN -> null)
    }
    return out;
  });
}
const prop = (arb, fn, runs = 400) => fc.assert(fc.property(arb, fn), { numRuns: runs });

test('normalizers: pristine fixtures produce only valid events (baseline for the fuzz below)', () => {
  assertValid(normalizeTsunamis(fx('noaa-tsunamis').items));
  assertValid(normalizeVolcanoes(fx('noaa-volcanoes').items));
  assertValid(normalizeUsgs(fx('usgs-earthquakes').geojson));
  assertValid(normalizeGlc(parseCsv(fx('nasa-glc').csv)));
  assertValid(normalizeGdacsFloods(fx('gdacs-floods').features));
});

test('parseCsv never throws on arbitrary text and always returns an array of plain objects', () => {
  fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 200 }), fc.array(fc.constantFrom('a', 'b', ',', '"', '\n', '\r', ' '), { maxLength: 60 }).map((a) => a.join(''))), (s) => {
    const rows = parseCsv(s);
    assert.ok(Array.isArray(rows));
    for (const r of rows) assert.equal(typeof r, 'object');
  }), { numRuns: 1500 });
});

test('parseCsv round-trips simple quoted CSV', () => {
  const cell = fc.string({ maxLength: 8 }).filter((s) => !s.includes('\0'));
  fc.assert(fc.property(fc.array(fc.string({ minLength: 1, maxLength: 5 }).filter((h) => /^[a-z]+$/i.test(h)), { minLength: 2, maxLength: 4 }).map((h) => [...new Set(h.map((x) => x.toLowerCase()))]).filter((h) => h.length >= 2),
    fc.array(fc.array(cell, { minLength: 4, maxLength: 4 }), { minLength: 1, maxLength: 5 }), (head, body) => {
      const q = (c) => `"${c.replace(/"/g, '""')}"`;
      const csv = [head.map(q).join(','), ...body.map((r) => r.slice(0, head.length).map(q).join(','))].join('\n');
      const rows = parseCsv(csv).filter((r) => Object.values(r).some((v) => v !== ''));
      const expected = body.filter((r) => r.slice(0, head.length).some((v) => v !== ''));
      assert.equal(rows.length, expected.length);
      rows.forEach((r, i) => head.forEach((h, j) => assert.equal(r[h], expected[i][j])));
    }), { numRuns: 200 });
});

// NOAA tsunamis / volcanoes: non-throwing under field perturbation, and lon/lat validity always holds.
test('normalizeTsunamis: perturbed records never throw and never emit invalid lon/lat', () => {
  const items = fx('noaa-tsunamis').items;
  prop(perturbed(items), (recs) => { for (const e of normalizeTsunamis(recs)) { const p = eventProblems(e).filter((x) => /^(lon|lat)/.test(x)); assert.deepEqual(p, []); } });
});
test('normalizeVolcanoes: perturbed records never throw and never emit invalid lon/lat', () => {
  const items = fx('noaa-volcanoes').items;
  prop(perturbed(items), (recs) => { for (const e of normalizeVolcanoes(recs)) { const p = eventProblems(e).filter((x) => /^(lon|lat)/.test(x)); assert.deepEqual(p, []); } });
});
test('normalizeUsgs: perturbed features never emit invalid lon/lat', () => {
  const features = fx('usgs-earthquakes').geojson.features;
  prop(perturbed(features), (recs) => {
    try { for (const e of normalizeUsgs({ features: recs })) assert.deepEqual(eventProblems(e).filter((x) => /^(lon|lat)/.test(x)), []); } catch (e) { if (e instanceof assert.AssertionError) throw e; /* thrown: tracked by BUG-PIPE-2 below */ }
  });
});
test('normalizeGlc: perturbed rows never throw and never emit invalid lon/lat', () => {
  const rows = parseCsv(fx('nasa-glc').csv);
  prop(perturbed(rows, { stringOnly: true }), (recs) => { for (const e of normalizeGlc(recs)) assert.deepEqual(eventProblems(e).filter((x) => /^(lon|lat)/.test(x)), []); });
});
test('normalizeGdacsFloods: perturbed features never emit invalid lon/lat', () => {
  const features = fx('gdacs-floods').features;
  prop(perturbed(features), (recs) => {
    try { for (const e of normalizeGdacsFloods(recs)) assert.deepEqual(eventProblems(e).filter((x) => /^(lon|lat)/.test(x)), []); } catch (e) { if (e instanceof assert.AssertionError) throw e; }
  });
});

test('normalizers: events with out-of-range or non-finite coordinates are always dropped', () => {
  const bad = fc.oneof(fc.constantFrom(NaN, Infinity, -Infinity, null, undefined, '5', 181, -181, 1e9), fc.double({ min: 180.0001, max: 1e6, noNaN: true }));
  const t = fx('noaa-tsunamis').items[0];
  prop(fc.tuple(bad, bad), ([a, b]) => {
    assert.equal(normalizeTsunamis([{ ...t, longitude: a }]).length, 0);
    assert.equal(normalizeTsunamis([{ ...t, latitude: b }]).length, 0);
    assert.equal(normalizeVolcanoes([{ ...fx('noaa-volcanoes').items[0], longitude: a }]).length, 0);
    assert.equal(normalizeGdacsFloods([{ properties: { eventid: 1, fromdate: '2020-01-01T00:00:00' }, geometry: { coordinates: [a, 0] } }]).length, 0);
  }, 100);
});

test('FIRMS: aggregateFirms/firmsCellsToEvents on random rows keep every cell centre valid and counts consistent', () => {
  const row = fc.record({
    latitude: fc.oneof(fc.double({ min: -95, max: 95, noNaN: true }).map(String), fc.constantFrom('', 'x', 'NaN')),
    longitude: fc.oneof(fc.double({ min: -185, max: 185, noNaN: true }).map(String), fc.constantFrom('', 'x', 'NaN')),
    acq_date: fc.date({ min: new Date('2024-01-01'), max: new Date('2030-01-01'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
    acq_time: fc.integer({ min: 0, max: 2359 }).filter((n) => n % 100 < 60).map((n) => String(n).padStart(4, '0')),
    confidence: fc.constantFrom('l', 'n', 'h', 'low', 'nominal', 'high', '10', '50', '95', '', 'x'),
    frp: fc.oneof(fc.double({ min: 0, max: 5000, noNaN: true }).map(String), fc.constantFrom('', 'x')),
  });
  prop(fc.array(row, { maxLength: 60 }), (rows) => {
    const cells = new Map();
    const used = aggregateFirms(rows, 'S', cells);
    const { events, total_cells } = firmsCellsToEvents(cells);
    assert.equal(events.length, total_cells);
    assert.equal(events.reduce((s, e) => s + e.count, 0), used);
    assert.ok(used <= rows.length);
    for (const e of events) assert.deepEqual(eventProblems(e), [], JSON.stringify(e));
    for (let i = 1; i < events.length; i++) assert.ok(events[i - 1].size.value >= events[i].size.value);
  }, 300);
});

test('confidenceClass is total and returns one of three classes', () => {
  prop(fc.oneof(fc.string({ maxLength: 10 }), fc.integer(), fc.double(), fc.constantFrom(null, undefined, true)), (c) => {
    assert.ok(['low', 'nominal', 'high'].includes(confidenceClass(c)));
  }, 800);
});

// ------------------------------------------------------------------ known bugs found by the fuzzers above
// Each runs a targeted property that FAILS against the current source (see the comment for the failing input).

// BUG-PIPE-1: isoFromParts pads whatever it is given, so a wrong-typed / out-of-range month, day, hour or a
// fractional year passes the isNum(year) guard and the normalizers emit an unparseable date string.
// src/fetch-catalogs.mjs:47-53 (isoFromParts) used by normalizeTsunamis:86 and normalizeVolcanoes:126.
// Failing input: tsunami {year: 1950, month: 13} or {year: 1950, day: 99} or {year: 1950, month: 'x'}.
test('BUG-PIPE-1 (fixed, regression): normalizeTsunamis/Volcanoes emit only parseable dates for wrong-typed or out-of-range date parts', () => {
  const t = fx('noaa-tsunamis').items[0], v = fx('noaa-volcanoes').items[0];
  const part = fc.oneof(fc.constantFrom('x', 13, 99, 32, 25, 61, -3, 1.5), junk);
  prop(fc.record({ month: part, day: part, hour: part, minute: part }, { requiredKeys: [] }), (parts) => {
    for (const e of normalizeTsunamis([{ ...t, eventValidity: 3, ...parts }])) assert.equal(Number.isNaN(Date.parse(e.date)), false, `date=${e.date}`);
    for (const e of normalizeVolcanoes([{ ...v, ...parts }])) assert.equal(Number.isNaN(Date.parse(e.date)), false, `date=${e.date}`);
  }, 300);
});

// BUG-PIPE-2: normalizeUsgs calls new Date(p.time).toISOString() on any finite number; |time| > 8.64e15 ms
// throws RangeError and aborts the whole catalog build. Failing input: properties.time = 1e21.
// src/fetch-catalogs.mjs:170.
test('BUG-PIPE-2 (fixed, regression): normalizeUsgs does not throw on out-of-range numeric time', () => {
  const f = fx('usgs-earthquakes').geojson.features[0];
  prop(fc.constantFrom(1e21, -1e21, 8.65e15, -8.65e15), (time) => {
    normalizeUsgs({ features: [{ ...f, properties: { ...f.properties, time } }] });
  }, 20);
});

// BUG-PIPE-3: normalizeGdacsFloods does new Date(`${p.fromdate}Z`).toISOString() with any truthy fromdate;
// an unparseable string (e.g. "n/a", "0000") throws RangeError for the whole feed.
// src/fetch-catalogs.mjs:225. Failing input: properties.fromdate = "n/a".
test('BUG-PIPE-3 (fixed, regression): normalizeGdacsFloods does not throw on an unparseable fromdate', () => {
  const f = fx('gdacs-floods').features[0];
  prop(fc.constantFrom('n/a', 'garbage', 'T', '2020-13-45T00:00:00'), (fromdate) => {
    normalizeGdacsFloods([{ ...f, properties: { ...f.properties, fromdate } }]);
  }, 20);
});

// BUG-PIPE-4: normalizeGlc only regex-matches the SHAPE dd/dd/dddd, so impossible calendar dates ("13/45/2020",
// month 00) are emitted as events with unparseable dates. src/fetch-catalogs.mjs:188-192.
// Failing input: event_date = "13/45/2020" (MM/DD/YYYY).
test('BUG-PIPE-4 (fixed, regression): normalizeGlc never emits an unparseable date', () => {
  const r = parseCsv(fx('nasa-glc').csv)[0];
  prop(fc.constantFrom('13/45/2020', '00/00/2020', '02/31/2021', '12/01/2020 25:61:61 PM'), (event_date) => {
    for (const e of normalizeGlc([{ ...r, event_date }])) assert.equal(Number.isNaN(Date.parse(e.date)), false, `date=${e.date}`);
  }, 20);
});

// BUG-PIPE-5: aggregateFirms builds the cell timestamp from raw acq_date / acq_time without validation, so a row with
// a garbage acq_date yields a firmsCellsToEvents event whose `date` is not a date. src/fetch-catalogs.mjs:268,283.
// Failing input: {latitude:'10.2', longitude:'20.2', acq_date:'garbage', confidence:'h'}.
test('BUG-PIPE-5 (fixed, regression): FIRMS cells never carry an unparseable date', () => {
  prop(fc.constantFrom('garbage', '', '2026-13-45', 'NaN-NaN-NaN'), (acq_date) => {
    const cells = new Map();
    aggregateFirms([{ latitude: '10.2', longitude: '20.2', acq_date, acq_time: '0130', confidence: 'h', frp: '3' }], 'V', cells);
    for (const e of firmsCellsToEvents(cells).events) assert.equal(Number.isNaN(Date.parse(e.date)), false, `date=${e.date}`);
  }, 20);
});
