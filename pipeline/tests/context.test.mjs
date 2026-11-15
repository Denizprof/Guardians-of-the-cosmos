// fetch-context.mjs: the EONET part must never truncate silently. Each category records its coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eonetCategory, EONET_DAYS } from '../src/fetch-context.mjs';

const NOW = Date.parse('2026-11-15T10:00:00Z');
const point = (id, date, lon = 10, lat = 20) => ({
  id, title: `Event ${id}`, link: `https://eonet.gsfc.nasa.gov/api/v3/events/${id}`,
  sources: [{ id: 'X', url: 'https://example.org/x' }],
  geometry: [{ date, type: 'Point', coordinates: [lon, lat] }],
});
const polygon = (id, date) => ({
  id, title: `Event ${id}`, link: `https://eonet.gsfc.nasa.gov/api/v3/events/${id}`, sources: [],
  geometry: [{ date, type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2], [1, 1]]] }],
});

test('a category under its limit is complete and covers the requested window', () => {
  const json = { events: [point('EONET_2', '2026-11-12T19:00:00Z'), point('EONET_1', '2026-10-20T08:00:00Z')] };
  const { events, coverage } = eonetCategory(json, { mapped: 'wildfire', days: 30, limit: 5000, now: NOW });
  assert.equal(events.length, 2);
  assert.deepEqual(coverage, {
    source: 'NASA EONET', count: 2, oldest: '2026-10-20T08:00:00Z', newest: '2026-11-12T19:00:00Z',
    truncated: false, limit: 5000, window_days: 30, window_from: '2026-10-16', window_to: '2026-11-15', skipped_non_point: 0,
  });
});

test('a category that hits its limit is marked truncated and reports the window it really covers', () => {
  const json = { events: [point('EONET_3', '2026-11-12T00:00:00Z'), point('EONET_2', '2026-11-09T00:00:00Z'), point('EONET_1', '2026-11-07T19:00:00Z')] };
  const { coverage } = eonetCategory(json, { mapped: 'wildfire', days: 365, limit: 3, now: NOW });
  assert.equal(coverage.truncated, true);
  assert.equal(coverage.count, 3);
  assert.equal(coverage.window_from, '2026-11-07'); // not the 365 days that were asked for
  assert.equal(coverage.window_days, 365);
});

test('events without a point location are counted, not silently dropped', () => {
  const json = { events: [polygon('EONET_9', '2026-11-09T20:00:00Z'), point('EONET_8', '2026-08-01T00:00:00Z')] };
  const { events, coverage } = eonetCategory(json, { mapped: 'flood', days: 365, limit: 5000, now: NOW });
  assert.deepEqual(events.map((e) => e.id), ['eonet-EONET_8']);
  assert.equal(events[0].category, 'flood');
  assert.equal(coverage.count, 1);
  assert.equal(coverage.skipped_non_point, 1);
});

test('an empty category is recorded with count 0, and a body without an events array is an error', () => {
  const { events, coverage } = eonetCategory({ events: [] }, { mapped: 'landslide', days: 365, limit: 5000, now: NOW });
  assert.equal(events.length, 0);
  assert.deepEqual([coverage.count, coverage.oldest, coverage.newest, coverage.truncated], [0, null, null, false]);
  assert.throws(() => eonetCategory({ message: 'maintenance' }, { mapped: 'flood', days: 365, limit: 5000, now: NOW }), /no events array/);
  assert.throws(() => eonetCategory(null, { mapped: 'flood', days: 365, limit: 5000, now: NOW }), /no events array/);
});

test('wildfires use a window short enough to be fetched completely', () => {
  assert.ok(EONET_DAYS.wildfires < 365);
});
