// Retrieval must keep understanding differently-worded questions. The questions live in
// assistant-model/knowledge/stress_test2.json: written after the search logic was frozen, never used to tune it,
// and with no question in common with the knowledge base. If a change makes these numbers fall, find out why.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildIndex, retrieve } from '../../../src/assistant/local/core';

const root = path.resolve(__dirname, '../../../..');
const kb = JSON.parse(fs.readFileSync(path.join(root, 'web/public/data/assistant/kb.json'), 'utf8'));
const set = JSON.parse(fs.readFileSync(path.join(root, 'assistant-model/knowledge/stress_test2.json'), 'utf8')) as {
  cases: { q: string; gold: string[] }[];
  off: string[];
};
const index = buildIndex(kb.records);
const ids = (q: string) => retrieve(index, q, 3).map((h) => h.record.id.replace('kb:', ''));

describe('retrieval on unseen wordings (stress_test2)', () => {
  it('finds the right record in the top 3 for at least 78 % of differently-worded questions', () => {
    const ok = set.cases.filter((c) => ids(c.q).some((id) => c.gold.includes(id))).length;
    expect(ok / set.cases.length).toBeGreaterThanOrEqual(0.78);
  });
  it('puts the right record first for at least 70 %', () => {
    const ok = set.cases.filter((c) => c.gold.includes(ids(c.q)[0])).length;
    expect(ok / set.cases.length).toBeGreaterThanOrEqual(0.7);
  });
  it('gives a source to no more than a third of off-topic questions', () => {
    const wrong = set.off.filter((q) => ids(q).length > 0).length;
    expect(wrong / set.off.length).toBeLessThanOrEqual(0.34);
  });
  it('fixes typos: "wat is interferomtry" and "sentinal 1 nedir" find their record', () => {
    expect(ids('wat is interferomtry')).toContain('concept-insar');
    expect(ids('sentinal 1 nedir')).toContain('sar-sentinel');
  });
  it('understands Turkish questions about English-only records', () => {
    expect(ids('geceleri şehir ışıkları katmanı ne gösteriyor')).toContain('layer-gibs-viirs-noaa20-night-lights');
  });
  it('declines clearly unrelated questions in both languages', () => {
    for (const q of ['write me a poem about the sea', 'what is bitcoin worth today', 'bana bir şiir yaz', 'yemek tarifi verir misin']) expect(ids(q)).toEqual([]);
  });
});
