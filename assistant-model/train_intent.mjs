// Trains the assistant's intent classifier: which knowledge record is a question about?
//
//   node assistant-model/build_kb.mjs && node assistant-model/train_intent.mjs
//
// A multinomial logistic regression over hashed word and letter-group features (features() in
// web/src/assistant/local/core.ts, the same code the browser runs). One class per knowledge record plus an
// off-topic class. Training examples are the records' example questions (English and Turkish), each also in
// roughened forms (a typo, a dropped word, a filler phrase), and the off-topic lists in knowledge/.
// Deterministic: the same knowledge base always gives the same weights.
//
// Writes web/public/data/assistant/intent.json (labels, biases, scale, report) and intent.bin (8-bit weights).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { features, INTENT_DIM, OFF_LABEL, intentProbs } = await import(new URL('../web/src/assistant/local/core.ts', import.meta.url).href);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const OUT_DIR = path.join(here, '../web/public/data/assistant');

const EPOCHS = 40;
const LEARNING_RATE = 4;
const L2 = 2e-6;
const SEED = 20261116;
/** The last quarter of each off-topic list is never trained on; it measures the off-topic class. */
const OFF_HELD_OUT = 0.25;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILLERS_EN = ['please tell me', 'hey', 'can you explain', 'i want to know', 'quick question', 'so', 'ok and', 'could you tell me'];
const FILLERS_TR = ['lütfen söyler misin', 'merak ediyorum', 'bana anlatır mısın', 'peki', 'bir sorum var'];

/** Roughened copies of one question: how real people type. The answer (label) does not change. */
function variants(q, isTr, rnd) {
  const out = [q];
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    const i = Math.floor(rnd() * words.length);
    out.push(words.filter((_, j) => j !== i).join(' '));
  }
  const long = words.map((w, i) => [w, i]).filter(([w]) => w.length >= 6);
  if (long.length) {
    const [w, i] = long[Math.floor(rnd() * long.length)];
    const k = 1 + Math.floor(rnd() * (w.length - 2));
    const typo = rnd() < 0.5 ? w.slice(0, k) + w.slice(k + 1) : w.slice(0, k - 1) + w[k] + w[k - 1] + w.slice(k + 1);
    out.push(words.map((x, j) => (j === i ? typo : x)).join(' '));
  }
  if (words.length >= 2) {
    const fillers = isTr ? FILLERS_TR : FILLERS_EN;
    out.push(`${fillers[Math.floor(rnd() * fillers.length)]} ${q}`);
  }
  return out;
}

export function buildExamples(kb, off, rnd) {
  const examples = [];
  for (const r of kb.records) {
    for (const q of [r.title, ...r.questions_en]) for (const v of variants(q, false, rnd)) examples.push({ text: v, label: r.id });
    for (const q of r.questions_tr ?? []) for (const v of variants(q, true, rnd)) examples.push({ text: v, label: r.id });
  }
  for (const q of off.en) for (const v of variants(q, false, rnd)) examples.push({ text: v, label: OFF_LABEL });
  for (const q of off.tr) for (const v of variants(q, true, rnd)) examples.push({ text: v, label: OFF_LABEL });
  return examples;
}

function loadOff() {
  const a = readJson(path.join(here, 'knowledge/offtopic.json'));
  const b = readJson(path.join(here, 'knowledge/offtopic_extra.json'));
  const split = (list) => { const n = Math.floor(list.length * (1 - OFF_HELD_OUT)); return [list.slice(0, n), list.slice(n)]; };
  const [enTrain, enTest] = split(a.en);
  const [trTrain, trTest] = split(a.tr);
  return { train: { en: [...enTrain, ...b.en], tr: [...trTrain, ...b.tr] }, heldOut: [...enTest, ...trTest] };
}

export function trainIntent(kb) {
  const rnd = mulberry32(SEED);
  const off = loadOff();
  const examples = buildExamples(kb, off.train, rnd);
  const labels = [...kb.records.map((r) => r.id), OFF_LABEL];
  const labelIndex = new Map(labels.map((l, i) => [l, i]));
  const C = labels.length;
  const D = INTENT_DIM;
  const W = new Float32Array(D * C);
  const b = new Float32Array(C);
  const data = examples.map((e) => ({ x: [...features(e.text, D)], y: labelIndex.get(e.label) }));
  const order = data.map((_, i) => i);
  const logits = new Float64Array(C);
  let loss = 0;
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const lr = LEARNING_RATE / (1 + epoch * 0.15);
    loss = 0;
    for (const idx of order) {
      const { x, y } = data[idx];
      for (let c = 0; c < C; c++) logits[c] = b[c];
      for (const [f, v] of x) { const row = f * C; for (let c = 0; c < C; c++) logits[c] += W[row + c] * v; }
      let max = -Infinity;
      for (let c = 0; c < C; c++) if (logits[c] > max) max = logits[c];
      let sum = 0;
      for (let c = 0; c < C; c++) { logits[c] = Math.exp(logits[c] - max); sum += logits[c]; }
      loss -= Math.log(logits[y] / sum + 1e-12);
      for (let c = 0; c < C; c++) {
        const g = logits[c] / sum - (c === y ? 1 : 0);
        if (Math.abs(g) < 1e-4) continue;
        b[c] -= lr * 0.1 * g;
        for (const [f, v] of x) { const k = f * C + c; W[k] -= lr * (g * v + L2 * W[k]); }
      }
    }
    loss /= order.length;
  }
  let maxAbs = 0;
  for (let i = 0; i < W.length; i++) if (Math.abs(W[i]) > maxAbs) maxAbs = Math.abs(W[i]);
  const scale = maxAbs / 127 || 1;
  const weights = new Int8Array(W.length);
  for (let i = 0; i < W.length; i++) weights[i] = Math.max(-127, Math.min(127, Math.round(W[i] / scale)));
  const model = { dim: D, labels, scale, bias: [...b].map((v) => Math.round(v * 1e4) / 1e4), weights };

  // report, measured with the 8-bit weights the browser will use
  const top = (text) => { let best = ['', 0]; for (const e of intentProbs(model, text)) if (e[1] > best[1]) best = e; return best[0]; };
  const trainAcc = examples.filter((e) => top(e.text) === e.label).length / examples.length;
  const offHeld = off.heldOut.filter((q) => top(q) === OFF_LABEL).length;
  const report = {
    examples: examples.length,
    classes: C,
    epochs: EPOCHS,
    final_loss: Math.round(loss * 1e4) / 1e4,
    train_accuracy: Math.round(trainAcc * 1e4) / 1e4,
    off_topic_held_out: { total: off.heldOut.length, recognised: offHeld },
  };
  return { model, report };
}

/** Read the shipped classifier (intent.json + intent.bin), or undefined when it has not been trained yet. */
export function loadIntent(dir = OUT_DIR) {
  const meta = path.join(dir, 'intent.json');
  const bin = path.join(dir, 'intent.bin');
  if (!fs.existsSync(meta) || !fs.existsSync(bin)) return undefined;
  const m = readJson(meta);
  const buf = fs.readFileSync(bin);
  return { dim: m.dim, labels: m.labels, scale: m.scale, bias: m.bias, weights: new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const kb = readJson(path.join(OUT_DIR, 'kb.json'));
  const started = Date.now();
  const { model, report } = trainIntent(kb);
  fs.writeFileSync(path.join(OUT_DIR, 'intent.bin'), Buffer.from(model.weights.buffer, model.weights.byteOffset, model.weights.byteLength));
  const meta = { version: '1', kb_version: kb.version, kb_records: kb.records.length, dim: model.dim, scale: model.scale, labels: model.labels, bias: model.bias, report };
  fs.writeFileSync(path.join(OUT_DIR, 'intent.json'), `${JSON.stringify(meta)}\n`);
  console.log(`intent classifier: ${report.classes} classes, ${report.examples} training examples, ${report.epochs} epochs, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  loss ${report.final_loss}, training accuracy ${(report.train_accuracy * 100).toFixed(1)} %, held-out off-topic recognised ${report.off_topic_held_out.recognised}/${report.off_topic_held_out.total}`);
  console.log(`  intent.bin ${(model.weights.byteLength / 1024).toFixed(0)} kB`);
}
