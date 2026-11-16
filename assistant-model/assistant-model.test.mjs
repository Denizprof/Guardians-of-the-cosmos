// Regression tests for the assistant's knowledge base builder, its trained classifier and the README that describes them.
//
//   node --test assistant-model/assistant-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKb, fit } from './build_kb.mjs';
import { loadIntent, trainIntent } from './train_intent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const TEXT_KEYS = ['text_en', 'text_scientific_en', 'text_tr'];

// ---------- build_kb.mjs: a shortened text must say so, and a layer's limits must never be the part removed

test('fit() leaves a text that is short enough untouched', () => {
  assert.equal(fit('One  sentence.\nTwo sentences.', 100), 'One sentence. Two sentences.');
});

test('fit() marks every cut with an ellipsis and never stops on a semicolon', () => {
  const long = 'First sentence is here. Second part goes on; and on with many more words than the budget allows for this text.';
  const cut = fit(long, 60);
  assert.ok(cut.endsWith('…'), cut);
  assert.ok(!/[;,:(]\s*…$/.test(cut), cut);
  assert.ok(cut.replace(/\s*…$/, '').length <= 60);
  assert.ok(clean(long).startsWith(cut.replace(/\s*…$/, '')));
  // a cut at a sentence end is still a cut: it must be marked too
  const atSentence = fit('A first sentence that is fairly long for this. A second sentence that will not fit in the budget.', 60);
  assert.equal(atSentence, 'A first sentence that is fairly long for this. …');
});

test('every layer record keeps its resolution and its full limitations at both levels', async () => {
  const kb = await buildKb();
  const layers = readJson(path.join(here, '../web/public/data/layers.json')).layers;
  assert.ok(layers.length > 0);
  for (const l of layers) {
    const r = kb.records.find((x) => x.id === `kb:layer-${l.id}`);
    assert.ok(r, `no record for layer ${l.id}`);
    for (const [k, description] of [['text_en', l.description_simple], ['text_scientific_en', l.description_scientific]]) {
      const tail = `Provider: ${clean(l.provider)}. Mission: ${clean(l.mission)}. Resolution: ${clean(l.resolution)}. Limitations: ${clean(l.limitations)}`;
      assert.ok(r[k].endsWith(tail), `${r.id} ${k} does not end with the layer's facts and full limitations`);
      const head = r[k].slice(0, r[k].length - tail.length).trim();
      assert.ok(head === clean(description) || head.endsWith('…'), `${r.id} ${k}: the description was shortened without a mark`);
      assert.ok(clean(description).startsWith(head.replace(/\s*…$/, '')), `${r.id} ${k}: the description is not the layer's own text`);
    }
  }
});

test('no knowledge text stops in the middle of a sentence without a mark', async () => {
  const kb = await buildKb();
  for (const r of kb.records) for (const k of TEXT_KEYS) {
    if (!r[k]) continue;
    assert.ok(!/[;,:(]$/.test(r[k]), `${r.id} ${k} ends with "${r[k].slice(-25)}"`);
    const open = (r[k].match(/\(/g) ?? []).length, close = (r[k].match(/\)/g) ?? []).length;
    assert.ok(open <= close || r[k].endsWith('…'), `${r.id} ${k} ends inside an open parenthesis without a mark`);
  }
});

test('the shipped kb.json is what build_kb.mjs builds today', async () => {
  const kb = await buildKb();
  const shipped = readJson(path.join(here, '../web/public/data/assistant/kb.json'));
  assert.deepEqual(shipped.counts, kb.counts);
  assert.deepEqual(shipped.records, kb.records, 'kb.json is stale: run node assistant-model/build_kb.mjs');
});

// ---------- README.md: the numbers it states must be the ones on disk

const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
const num = (s) => Number(String(s).replace(/,/g, ''));

test('README: the knowledge-base record counts match kb.json', () => {
  const kb = readJson(path.join(here, '../web/public/data/assistant/kb.json'));
  const heading = readme.match(/## The knowledge base \((\d+) records\)/);
  assert.ok(heading, 'README has no "## The knowledge base (N records)" heading');
  assert.equal(num(heading[1]), kb.counts.total);
  const rows = [...readme.matchAll(/^\| (The app's own vetted text|App and project guide|Radar reference|General SAR)[^|]*\| (\d+) \|/gm)].map((m) => num(m[2]));
  const { total, app, reference, verified_sar: verified } = kb.counts;
  assert.deepEqual(rows, [total - app - reference - verified, app, reference, verified]);
  assert.match(readme, new RegExp(`${kb.counts.turkish} of the ${total} records have a Turkish text`));
});

// ---------- the trained classifier: what ships is what the script trains today, for today's knowledge base

test('the shipped classifier has one class per knowledge record and matches a fresh training run', async () => {
  const kb = await buildKb();
  const shipped = loadIntent();
  assert.ok(shipped, 'intent.json / intent.bin are missing: run node assistant-model/train_intent.mjs');
  assert.deepEqual(shipped.labels.filter((l) => !l.startsWith('__')), kb.records.map((r) => r.id), 'the classifier is stale: run node assistant-model/train_intent.mjs');
  const { model, report } = trainIntent(kb);
  assert.equal(model.weights.length, shipped.weights.length);
  // training is deterministic; one quantisation step of tolerance covers a different JavaScript engine's rounding
  let worst = 0;
  for (let i = 0; i < model.weights.length; i++) worst = Math.max(worst, Math.abs(model.weights[i] - shipped.weights[i]));
  assert.ok(worst <= 1, `shipped weights differ from a fresh training run (by up to ${worst} steps)`);
  const meta = readJson(path.join(here, '../web/public/data/assistant/intent.json'));
  assert.equal(meta.report.examples, report.examples);
  assert.equal(meta.report.classes, report.classes);
});

test('README: the classifier numbers are the ones recorded at training', () => {
  const meta = readJson(path.join(here, '../web/public/data/assistant/intent.json'));
  const kb = readJson(path.join(here, '../web/public/data/assistant/kb.json'));
  assert.match(readme, new RegExp(`${meta.report.classes} classes`));
  assert.match(readme, new RegExp(`${meta.report.examples.toLocaleString('en-US')} examples, ${meta.report.epochs} epochs`));
  const questions = kb.records.reduce((n, r) => n + r.questions_en.length + (r.questions_tr?.length ?? 0), 0);
  assert.match(readme, new RegExp(`${questions.toLocaleString('en-US')} of them`));
  assert.match(readme, new RegExp(`classifier alone recognises ${meta.report.off_topic_held_out.recognised}`));
});

test('nothing in the assistant names a third-party language model or model hub', () => {
  const files = ['README.md', 'build_kb.mjs', 'train_intent.mjs', 'eval_retrieval.mjs', 'knowledge/app.json', 'knowledge/project.json', 'knowledge/radar_reference.json',
    '../web/src/assistant/local/core.ts', '../web/src/assistant/local/adapter.ts', '../web/src/assistant/local/catalog.ts', '../web/src/assistant/local/index.ts', '../web/src/assistant/AssistantPanel.tsx'];
  for (const f of files) assert.ok(!/qwen|hugging ?face|transformers\.js|\bonnx\b|\blora\b/i.test(fs.readFileSync(path.join(here, f), 'utf8')), f);
});
