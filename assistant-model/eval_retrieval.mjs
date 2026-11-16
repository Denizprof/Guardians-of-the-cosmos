// Measures how well the app's retrieval finds the right knowledge record for differently-worded questions.
//   node assistant-model/eval_retrieval.mjs [--verbose]
// Gold = the record(s) that answer the question. recall@1 / @3 = a gold record is the top hit / among the top 3.
// "off" questions must find nothing (a hit there would hand the model a source it should not answer from).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { buildIndex, retrieve } = await import(new URL('../web/src/assistant/local/core.ts', import.meta.url).href);
const kb = JSON.parse(fs.readFileSync(path.join(here, '../web/public/data/assistant/kb.json'), 'utf8'));
const fileArg = process.argv.find((a) => a.startsWith('--file='))?.slice(7) ?? 'stress_test.json';
const test = JSON.parse(fs.readFileSync(path.join(here, 'knowledge', fileArg), 'utf8'));
console.log(`set: ${fileArg}`);
const { loadIntent } = await import('./train_intent.mjs');
// --words-only measures the search without the trained classifier
const intent = process.argv.includes('--words-only') ? undefined : loadIntent();
console.log(intent ? `classifier: ${intent.labels.length} classes` : 'classifier: none (words only)');
const index = buildIndex(kb.records, intent);
const verbose = process.argv.includes('--verbose');

let r1 = 0, r3 = 0, none = 0;
const misses = [];
for (const c of test.cases) {
  const hits = retrieve(index, c.q, 3).map((h) => h.record.id.replace('kb:', ''));
  const ok1 = c.gold.includes(hits[0]);
  const ok3 = hits.some((h) => c.gold.includes(h));
  if (ok1) r1++;
  if (ok3) r3++;
  if (!hits.length) none++;
  if (!ok3) misses.push({ q: c.q, gold: c.gold[0], got: hits.slice(0, 2).join(', ') || '(nothing)' });
}
let offHit = 0;
const offHits = [];
for (const q of test.off) {
  const hits = retrieve(index, q, 3);
  if (hits.length) { offHit++; offHits.push(`${q}  ->  ${hits[0].record.id.replace('kb:', '')}`); }
}
const n = test.cases.length;
const pct = (x, d) => `${((100 * x) / d).toFixed(1)}%`;
console.log(`answerable questions: ${n}`);
console.log(`  right record is top hit (recall@1): ${r1}  ${pct(r1, n)}`);
console.log(`  right record in top 3  (recall@3): ${r3}  ${pct(r3, n)}`);
console.log(`  nothing found at all: ${none}  ${pct(none, n)}`);
console.log(`off-topic questions: ${test.off.length}, wrongly given a source: ${offHit}  ${pct(offHit, test.off.length)}`);
if (verbose) {
  console.log('\nMISSES:'); for (const m of misses) console.log(`  "${m.q}"  want ${m.gold}  got ${m.got}`);
  console.log('\nOFF-TOPIC WRONGLY MATCHED:'); for (const o of offHits) console.log(`  ${o}`);
}
