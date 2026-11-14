// node --test pipeline/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGranuleName, tierOf, searchGranules } from '../src/asf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// REAL granule names, read from the shipped data package.
const events = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../web/public/data/events.json'), 'utf8')).events;
const layers = events.flatMap((e) => e.layers.filter((l) => l.kind === 'browse'));

test('tierOf maps CMR collection names to data tiers', () => {
  assert.equal(tierOf('NISAR_L2_GCOV_BETA_V1'), 'BETA');
  assert.equal(tierOf('NISAR_L2_GUNW_PROVISIONAL_V1'), 'PROVISIONAL');
  assert.equal(tierOf('NISAR_L2_GCOV_V1'), 'VALIDATED');
  assert.equal(tierOf('NISAR_UR_L2_GCOV_V1'), 'URGENT RESPONSE');
  assert.equal(tierOf(), 'VALIDATED');
  assert.equal(tierOf(''), 'VALIDATED');
});

test('tierOf: Urgent Response wins even when the name also says BETA', () => {
  assert.equal(tierOf('NISAR_UR_L2_GCOV_BETA_V1'), 'URGENT RESPONSE');
});

test('parseGranuleName: GCOV single acquisition', () => {
  const g = 'NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001';
  const m = parseGranuleName(g);
  assert.equal(m.product, 'GCOV');
  assert.equal(m.crid, 'X05010');
  assert.equal(m.startDate, '20260117');
  assert.equal(m.start, '2026-01-17T03:42:32Z');
  assert.equal(m.secondaryDate, undefined);
});

test('parseGranuleName: GUNW pair has reference and secondary', () => {
  const g = 'NISAR_L2_PR_GUNW_021_162_A_007_022_4000_SH_20260601T100657_20260601T100731_20260613T100656_20260613T100731_P05023_N_F_J_001';
  const m = parseGranuleName(g);
  assert.equal(m.product, 'GUNW');
  assert.equal(m.crid, 'P05023');
  assert.equal(m.startDate, '20260601');
  assert.equal(m.start, '2026-06-01T10:06:57Z');
  assert.equal(m.secondaryDate, '20260613');
  assert.equal(m.secondaryStart, '2026-06-13T10:06:56Z');
});

test('parseGranuleName agrees with the acquisition dates stored for every real browse layer', () => {
  assert.ok(layers.length >= 10, 'expected the real data package to have browse layers');
  for (const l of layers) {
    const m = parseGranuleName(l.provenance.granule);
    assert.equal(m.product, l.product, l.id);
    assert.equal(m.crid, l.provenance.crid, `${l.id} crid`);
    const refOrStart = l.acquisition.reference || l.acquisition.start;
    // ASF startTime has the same second resolution as the file name.
    assert.equal(m.start.slice(0, 16), refOrStart.slice(0, 16), `${l.id} start`);
    if (l.acquisition.secondary) assert.equal(m.secondaryStart.slice(0, 16), l.acquisition.secondary.slice(0, 16), `${l.id} secondary`);
  }
});

test('parseGranuleName on a name without timestamps does not throw', () => {
  const m = parseGranuleName('NISAR_L2_PR_GCOV_garbage');
  assert.equal(m.product, 'GCOV');
  assert.equal(m.start, undefined);
  assert.equal(m.crid, null);
});

test('parseGranuleName on an empty string does not throw', () => {
  assert.doesNotThrow(() => parseGranuleName(''));
});

// --------------------------------------------------- searchGranules (fetch is STUBBED)
function stubFetch(handler) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return handler(String(url), calls.length);
  };
  return { calls, restore: () => (globalThis.fetch = orig) };
}
const feat = (sceneName, collectionName) => ({ properties: { sceneName, collectionName } });

test('searchGranules chunks requests by 20 names and merges the results [stubbed fetch]', async () => {
  const names = Array.from({ length: 45 }, (_, i) => `S${i}`);
  const s = stubFetch((url) => {
    const list = new URL(url).searchParams.get('granule_list').split(',');
    return { ok: true, status: 200, json: async () => ({ features: list.map((n) => feat(n, 'NISAR_L2_GCOV_V1')) }) };
  });
  try {
    const out = await searchGranules(names);
    assert.equal(s.calls.length, 3);
    assert.deepEqual(s.calls.map((u) => new URL(u).searchParams.get('granule_list').split(',').length), [20, 20, 5]);
    assert.equal(out.size, 45);
    assert.ok(new URL(s.calls[0]).searchParams.get('dataset') === 'NISAR');
  } finally {
    s.restore();
  }
});

test('searchGranules prefers the standard product over an Urgent Response duplicate regardless of order', async () => {
  for (const order of [['UR', 'STD'], ['STD', 'UR']]) {
    const feats = order.map((o) => feat('X', o === 'UR' ? 'NISAR_UR_L2_GCOV_V1' : 'NISAR_L2_GCOV_V1'));
    const s = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ features: feats }) }));
    try {
      const out = await searchGranules(['X']);
      assert.equal(out.get('X').properties.collectionName, 'NISAR_L2_GCOV_V1', order.join('>'));
    } finally {
      s.restore();
    }
  }
});

test('searchGranules throws on HTTP errors', async () => {
  const s = stubFetch(() => ({ ok: false, status: 502, json: async () => ({}) }));
  try {
    await assert.rejects(() => searchGranules(['X']), /HTTP 502/);
  } finally {
    s.restore();
  }
});

test('searchGranules with no names makes no request', async () => {
  const s = stubFetch(() => assert.fail('should not fetch'));
  try {
    assert.equal((await searchGranules([])).size, 0);
  } finally {
    s.restore();
  }
});

test('searchGranules encodes the granule list (a name containing "&" cannot inject a parameter)', async () => {
  // ISSUE-QA-22 (fixed during the audit): granule_list used to be built by string concatenation.
  const s = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ features: [] }) }));
  try {
    await searchGranules(['A&maxResults=1']);
    const u = new URL(s.calls[0]);
    assert.equal(u.searchParams.get('maxResults'), null);
    assert.equal(u.searchParams.get('granule_list'), 'A&maxResults=1');
  } finally {
    s.restore();
  }
});
