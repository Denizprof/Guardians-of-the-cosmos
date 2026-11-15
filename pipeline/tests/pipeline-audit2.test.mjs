// node --test tests/pipeline-audit2.test.mjs
// Regression tests for audit round 2, findings 32 and 33. No network: nothing here calls fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tierOf } from '../src/asf.mjs';
import { auditGranules, mergeManifest } from '../src/fetch-browse.mjs';

// ------------------------------------------------------------------ finding 33
test('tierOf never labels a missing or unrecognised collection name as VALIDATED', () => {
  assert.equal(tierOf(), 'UNKNOWN');
  assert.equal(tierOf(''), 'UNKNOWN');
  assert.equal(tierOf(null), 'UNKNOWN');
  assert.equal(tierOf(42), 'UNKNOWN');
  assert.equal(tierOf('NISAR_L2_GCOV_CALVAL_V1'), 'UNKNOWN');
  assert.equal(tierOf('nisar_l2_gcov_beta_v1'), 'UNKNOWN');
  assert.equal(tierOf('SENTINEL-1A_SLC'), 'UNKNOWN');
});

test('tierOf keeps the four recognised tiers', () => {
  assert.equal(tierOf('NISAR_L2_GCOV_V1'), 'VALIDATED');
  assert.equal(tierOf('NISAR_L2_GCOV_BETA_V1'), 'BETA');
  assert.equal(tierOf('NISAR_L2_GUNW_PROVISIONAL_V1'), 'PROVISIONAL');
  assert.equal(tierOf('NISAR_UR_L2_GCOV_V1'), 'URGENT RESPONSE');
  assert.equal(tierOf('NISAR_UR_L2_GCOV_BETA_V1'), 'URGENT RESPONSE');
});

// ------------------------------------------------------------------ finding 32
const feat = (sceneName, collectionName) => ({ properties: { sceneName, collectionName } });
const ev = { id: 'e1', observations: [{ granule: 'A', role: 'before' }, { granule: 'B', role: 'after' }] };
const browse = (granule) => ({ id: granule, kind: 'browse', provenance: { granule } });
const prevManifest = () => ({
  generated: '2026-01-01T00:00:00.000Z',
  events: [
    { id: 'e1', layers: [browse('A'), browse('B'), { id: 'rgb', kind: 'derived' }] },
    { id: 'e0', layers: [browse('Z')] },
  ],
});

test('auditGranules reports a configured granule that ASF did not return', () => {
  const found = new Map([['A', feat('A', 'NISAR_L2_GCOV_BETA_V1')]]);
  const problems = auditGranules(ev, found);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /B/);
  assert.match(problems[0], /not found on ASF/);
});

test('auditGranules reports a granule whose collection name gives no recognised tier', () => {
  const found = new Map([['A', feat('A', 'NISAR_L2_GCOV_BETA_V1')], ['B', feat('B', undefined)]]);
  const problems = auditGranules(ev, found);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /B/);
  assert.match(problems[0], /tier/);
});

test('auditGranules is empty when every granule is found with a recognised tier', () => {
  const found = new Map([['A', feat('A', 'NISAR_L2_GCOV_BETA_V1')], ['B', feat('B', 'NISAR_L2_GCOV_PROVISIONAL_V1')]]);
  assert.deepEqual(auditGranules(ev, found), []);
});

test('mergeManifest refuses to write and keeps the previous manifest untouched when a lookup failed', () => {
  const prev = prevManifest();
  const snapshot = JSON.stringify(prev);
  const partial = { id: 'e1', layers: [browse('A')] }; // B was missed by ASF
  const r = mergeManifest(prev, [partial], ['B: not found on ASF'], ['e0', 'e1']);
  assert.equal(r.write, false);
  assert.equal(JSON.stringify(r.manifest), snapshot);
  assert.equal(JSON.stringify(prev), snapshot, 'the input must not be mutated');
});

test('mergeManifest writes when nothing failed, keeps derived layers and the configured order', () => {
  const prev = prevManifest();
  const fresh = { id: 'e1', layers: [browse('A'), browse('B')] };
  const r = mergeManifest(prev, [fresh], [], ['e0', 'e1']);
  assert.equal(r.write, true);
  assert.deepEqual(r.manifest.events.map((e) => e.id), ['e0', 'e1']);
  const e1 = r.manifest.events.find((e) => e.id === 'e1');
  assert.deepEqual(e1.layers.map((l) => l.id), ['A', 'B', 'rgb']);
  assert.deepEqual(r.manifest.events.find((e) => e.id === 'e0').layers.map((l) => l.id), ['Z']);
});
