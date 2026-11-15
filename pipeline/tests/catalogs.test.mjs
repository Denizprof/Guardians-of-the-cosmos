import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCsv, normalizeTsunamis, tsunamiTitle, normalizeVolcanoes, normalizeUsgs, normalizeGlc, normalizeGdacsFloods,
  aggregateFirms, firmsCellsToEvents, confidenceClass, isoFromParts, SOURCES,
} from '../src/fetch-catalogs.mjs';

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = (n) => JSON.parse(fs.readFileSync(path.join(FX, `${n}.fixture.json`), 'utf8'));
const CATEGORIES = new Set(['earthquake', 'volcano', 'landslide', 'tsunami', 'wildfire', 'flood']);

function assertContextEvent(e) {
  assert.equal(typeof e.id, 'string');
  assert.ok(e.title);
  assert.ok(CATEGORIES.has(e.category), e.category);
  assert.ok(!Number.isNaN(Date.parse(e.date)), `date ${e.date}`);
  assert.ok(e.lon >= -180 && e.lon <= 180 && e.lat >= -90 && e.lat <= 90);
  assert.ok(e.source);
  assert.match(e.url, /^https?:\/\//);
  assert.ok(['reported', 'observation'].includes(e.evidence));
}

test('isoFromParts handles partial dates', () => {
  assert.deepEqual(isoFromParts({ year: 1900 }), { date: '1900-01-01T00:00:00.000Z', date_precision: 'year' });
  assert.equal(isoFromParts({ year: 1960, month: 5, day: 22, hour: 19, minute: 11 }).date, '1960-05-22T19:11:00.000Z');
});

test('parseCsv handles quotes, commas and embedded newlines', () => {
  const rows = parseCsv('a,b,c\n1,"x, y","he said ""hi""\nbye"\r\n2,,z\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].b, 'x, y');
  assert.equal(rows[0].c, 'he said "hi"\nbye');
  assert.equal(rows[1].b, '');
});

test('tsunami normalizer', () => {
  const { items } = fx('noaa-tsunamis');
  const ev = normalizeTsunamis(items);
  assert.ok(ev.length > 0 && ev.length <= items.length);
  ev.forEach(assertContextEvent);
  assert.ok(ev.every((e) => e.category === 'tsunami' && e.url.includes('/tsunami/event-more-info/')));
  assert.ok(ev.some((e) => e.size?.unit.includes('water height')));
  assert.ok(ev.some((e) => typeof e.deaths === 'number'));
  assert.ok(ev.every((e) => /not satellite-confirmed/.test(e.notes)));
  // very doubtful (validity 1) events are filtered at the default threshold
  const doubtful = items.filter((i) => i.eventValidity < 2).length;
  assert.equal(normalizeTsunamis(items, { minValidity: -1 }).length - ev.length, doubtful);
});

test('volcano normalizer', () => {
  const ev = normalizeVolcanoes(fx('noaa-volcanoes').items);
  assert.ok(ev.length > 0);
  ev.forEach(assertContextEvent);
  assert.ok(ev.every((e) => e.category === 'volcano'));
  assert.ok(ev.some((e) => e.size?.unit === 'VEI'));
});

test('usgs normalizer', () => {
  const ev = normalizeUsgs(fx('usgs-earthquakes').geojson);
  assert.equal(ev.length, 3);
  ev.forEach(assertContextEvent);
  assert.ok(ev.every((e) => e.magnitude >= 7 && typeof e.depth_km === 'number'));
});

test('glc normalizer parses CSV rows, dates and fatalities', () => {
  const ev = normalizeGlc(parseCsv(fx('nasa-glc').csv));
  assert.ok(ev.length >= 6);
  ev.forEach(assertContextEvent);
  assert.ok(ev.every((e) => e.category === 'landslide'));
  assert.ok(ev.some((e) => e.deaths > 0));
  assert.ok(ev.every((e) => /not satellite-confirmed/.test(e.notes)));
});

test('gdacs flood normalizer dedupes and keeps UTC dates', () => {
  const { features } = fx('gdacs-floods');
  const ev = normalizeGdacsFloods([...features, ...features]);
  assert.equal(ev.length, new Set(features.map((f) => f.properties.eventid)).size);
  ev.forEach(assertContextEvent);
  assert.ok(ev.every((e) => e.date.endsWith('.000Z')));
});

test('confidence classes', () => {
  assert.equal(confidenceClass('h'), 'high');
  assert.equal(confidenceClass('low'), 'low');
  assert.equal(confidenceClass('nominal'), 'nominal');
  assert.equal(confidenceClass('85'), 'high');
  assert.equal(confidenceClass('20'), 'low');
});

test('FIRMS aggregation into 0.5 deg cells', () => {
  const { csv } = fx('firms-fires');
  const cells = new Map();
  const n1 = aggregateFirms(parseCsv(csv.noaa20), 'VIIRS NOAA-20', cells);
  const n2 = aggregateFirms(parseCsv(csv.modis), 'MODIS', cells);
  assert.ok(n1 + n2 > 0);
  const { events, total_cells } = firmsCellsToEvents(cells);
  assert.equal(events.length, total_cells);
  assert.ok(events.length <= n1 + n2);
  events.forEach(assertContextEvent);
  assert.ok(events.every((e) => e.evidence === 'observation' && e.category === 'wildfire' && /not a confirmed wildfire/.test(e.notes)));
  assert.ok(events.every((e) => (e.lon * 2) % 1 !== 0 && (e.lat * 2) % 1 !== 0), 'centres sit mid-cell');
  assert.equal(events.reduce((s, e) => s + e.count, 0), n1 + n2);
  // size cap
  const capped = firmsCellsToEvents(cells, { maxBytes: 600 });
  assert.ok(capped.events.length < events.length || events.length <= 2);
  assert.equal(capped.total_cells, total_cells);
});

test('FIRMS drops low-confidence detections', () => {
  const cells = new Map();
  const used = aggregateFirms([
    { latitude: '10.1', longitude: '20.1', acq_date: '2026-11-13', acq_time: '0100', confidence: 'low', frp: '5' },
    { latitude: '10.2', longitude: '20.2', acq_date: '2026-11-13', acq_time: '0130', confidence: 'nominal', frp: '9' },
  ], 'VIIRS', cells);
  assert.equal(used, 1);
  assert.equal([...cells.values()][0].maxFrp, 9);
});

// Regression: a tsunami caused by an earthquake was titled only "Tsunami 2026 — Panama", so on the globe a major
// earthquake read as "a tsunami" and the earthquake itself was never named.
test('tsunami titles name what caused the tsunami, and do not repeat the country', () => {
  assert.equal(tsunamiTitle({ year: 2026, causeCode: 1, magnitude: 7.7, locationName: 'ISLA CAÑAS, PANAMA', country: 'PANAMA' }), 'Tsunami after M 7.7 earthquake, 2026 — Isla Cañas, Panama');
  assert.equal(tsunamiTitle({ year: 1946, causeCode: 3, magnitude: 8.6, locationName: 'UNIMAK ISLAND, AK', country: 'USA' }), 'Tsunami after M 8.6 earthquake, 1946 — Unimak Island, Ak, Usa');
  assert.equal(tsunamiTitle({ year: 1905, causeCode: 1, locationName: 'CALABRIA', country: 'ITALY' }), 'Tsunami after an earthquake, 1905 — Calabria, Italy');
  assert.equal(tsunamiTitle({ year: 2018, causeCode: 5, locationName: 'ANAK KRAKATAU', country: 'INDONESIA' }), 'Tsunami after a volcanic eruption, 2018 — Anak Krakatau, Indonesia');
  assert.equal(tsunamiTitle({ year: 1958, causeCode: 7, locationName: 'LITUYA BAY', country: 'USA' }), 'Tsunami after a landslide, 1958 — Lituya Bay, Usa');
  assert.equal(tsunamiTitle({ year: 2020, causeCode: 8, locationName: 'MENORCA', country: 'SPAIN' }), 'Meteotsunami (weather-driven), 2020 — Menorca, Spain');
  // a questionable or unknown cause is not presented as an earthquake
  assert.equal(tsunamiTitle({ year: 1930, causeCode: 2, magnitude: 7, locationName: 'X', country: 'Y' }), 'Tsunami 1930 — X, Y');
  assert.equal(tsunamiTitle({ year: 1930, causeCode: 0 }), 'Tsunami 1930');
});

test('the tsunami normalizer uses those titles', () => {
  const ev = normalizeTsunamis(fx('noaa-tsunamis').items);
  const quakeCaused = ev.filter((e) => /^Cause: (Earthquake|Volcano and earthquake|Earthquake and landslide|Volcano, earthquake and landslide)./.test(e.notes));
  assert.ok(quakeCaused.length > 0);
  assert.ok(quakeCaused.every((e) => /^Tsunami after (M [0-9.]+|an) earthquake, /.test(e.title)), quakeCaused.map((e) => e.title).join(' | '));
});

// ---------- audit regressions: date precision, GDACS paging, FIRMS partial feed ----------
// The GLC export writes "12:00:00 AM" for records whose time of day is unknown (5,533 of 11,033 rows on 2026-11-15).
test('glc normalizer records day precision when the source gave no time of day', () => {
  const row = (event_id, event_date) => ({ event_id, event_date, longitude: '10', latitude: '20', landslide_category: 'landslide', event_title: 'x' });
  const ev = normalizeGlc([row('1', '08/01/2008 12:00:00 AM'), row('2', '01/02/2009 02:00:00 AM'), row('3', '03/04/2010')]);
  assert.deepEqual(ev.map((e) => [e.date, e.date_precision]), [
    ['2008-08-01T00:00:00.000Z', 'day'],
    ['2009-01-02T02:00:00.000Z', 'minute'],
    ['2010-03-04T00:00:00.000Z', 'day'],
  ]);
  assert.ok(normalizeGlc(parseCsv(fx('nasa-glc').csv)).every((e) => ['day', 'minute'].includes(e.date_precision)));
});

test('gdacs flood normalizer records day precision for date-only and midnight fromdate', () => {
  const feat = (eventid, fromdate) => ({ geometry: { coordinates: [10, 20] }, properties: { eventid, fromdate, todate: fromdate, name: 'Flood' } });
  const ev = normalizeGdacsFloods([feat(1, '2020-05-07T00:00:00'), feat(2, '2020-05-07'), feat(3, '2025-12-12T13:00:00')]);
  assert.deepEqual(ev.map((e) => e.date_precision), ['day', 'day', 'minute']);
});

/** Replace global fetch for one test; `handler(url)` returns a Response. */
function stubFetch(t, handler) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => handler(String(url));
  t.after(() => { globalThis.fetch = real; });
}
const gdacsFeature = (eventid, year) => ({ geometry: { coordinates: [10, 20] }, properties: { eventid, fromdate: `${year}-03-01T00:00:00`, todate: `${year}-03-02T00:00:00`, name: 'Flood' } });
const gdacsPage = (url) => [Number(/fromdate=(\d{4})/.exec(url)[1]), Number(/pagenumber=(\d+)/.exec(url)[1])];

test('GDACS: a 200 response without a features array fails the source', async (t) => {
  stubFetch(t, (url) => {
    const [y] = gdacsPage(url);
    return y === 2003 ? new Response('{"message":"maintenance"}') : new Response(JSON.stringify({ features: [gdacsFeature(y, y)] }));
  });
  await assert.rejects(SOURCES['gdacs-floods'].run(), /GDACS 2003 page 1: response has no features array/);
});

test('GDACS: HTTP 204 (no body) means no more results, also after a full page of 100', async (t) => {
  const calls = [];
  stubFetch(t, (url) => {
    const [y, page] = gdacsPage(url);
    calls.push(`${y}/${page}`);
    if (y === 2001 && page === 1) return new Response(JSON.stringify({ features: Array.from({ length: 100 }, (_, i) => gdacsFeature(1000 + i, y)) }));
    if (y === 2002 && page === 1) return new Response(JSON.stringify({ features: [gdacsFeature(5, y)] }));
    return new Response(null, { status: 204 }); // every other year, and 2001 page 2
  });
  const ev = await SOURCES['gdacs-floods'].run();
  assert.equal(ev.length, 101);
  assert.ok(calls.includes('2001/2'));
  assert.ok(!calls.includes('2002/2'));
});

test('FIRMS: a sensor feed that returns no usable detections fails the source instead of writing a partial snapshot', async (t) => {
  const { csv } = fx('firms-fires');
  stubFetch(t, (url) => new Response(/MODIS/.test(url) ? '<html><body>Service unavailable</body></html>' : csv.noaa20));
  t.mock.method(console, 'warn', () => {});
  await assert.rejects(SOURCES['firms-fires'].run({}), /FIRMS feeds missing: modis/);
});

test('FIRMS: a complete fetch keeps cells_total / cells_kept and reports no partial flag', async (t) => {
  const { csv } = fx('firms-fires');
  stubFetch(t, (url) => new Response(/MODIS/.test(url) ? csv.modis : csv.noaa20));
  const meta = {};
  const ev = await SOURCES['firms-fires'].run(meta);
  assert.ok(ev.length > 0);
  assert.equal(meta.extra.cells_kept, ev.length);
  assert.ok(meta.extra.cells_total >= meta.extra.cells_kept);
  assert.ok(!('partial' in meta.extra));
});
