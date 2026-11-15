// Builds the fine-tuning data for the Global SAR chatbot: assistant-model/data/{train,val,test}.jsonl
//
//   node assistant-model/build_kb.mjs && node assistant-model/build_dataset.mjs
//
// What the model is taught is a SKILL, not facts: read the SOURCES in the prompt, answer only from them,
// mark the source used, and reply NO_ANSWER when they do not contain the answer. The facts stay in the
// knowledge base, where each one has a source and can be corrected without retraining.
//
// Every target answer is the text of a source (never invented wording), so the data cannot teach a false fact.
// The prompt is built by the same code the app runs (web/src/assistant/local/core.ts).
//
// Honest evaluation needs data the model never saw:
//   - TEST records: one knowledge record in six, plus everything about one whole investigation, are never
//     used in training (not as answers and not as distractors);
//   - TEST questions: the last quarter of the decline-list is held out;
//   - VAL: one unseen question wording per training record (same records, new wording).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const core = await import(new URL('../web/src/assistant/local/core.ts', import.meta.url).href);
const { buildIndex, retrieve, recordSource, contextSources, buildMessages, NO_ANSWER, PROMPT_VERSION } = core;
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const HELD_OUT_EVENT = 'aspen-acres-fire-2026';
const SEED = 20261114;

// small deterministic random generator, so the data set is reproducible
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** The way people actually type: lower case, no question mark, a lead-in. Never changes the meaning. */
function reword(q, lang) {
  const r = rand();
  if (r < 0.45) return q;
  if (r < 0.6) return q.toLowerCase().replace(/\?$/, '');
  const lead = lang === 'tr' ? ['Bir sorum var: ', 'Merak ettim, ', 'Kısaca: ', 'Lütfen açıkla: '] : ['Quick question: ', "I'm new here. ", 'Can you tell me: ', 'One thing I do not get: ', 'Please explain: '];
  if (r < 0.9) return pick(lead) + q;
  return `${q} ${lang === 'tr' ? 'Kısa tut.' : 'Keep it short.'}`;
}

// ---------- context (the open investigation), shaped exactly like assistant/context.ts builds it ----------
function ctxFromEvent(e, layers) {
  return {
    event: {
      citation_id: `event:${e.id}`, title: e.title, subtitle: e.subtitle, category: e.category, date: e.date, technique: e.technique,
      location: e.location, references: e.references.map((r, i) => ({ citation_id: `ref:${e.id}:${i}`, label: r.label, url: r.url })),
    },
    selected_layers: layers.map((l) => ({
      citation_id: `layer:${l.id}`, layer_id: l.id, type: l.kind === 'browse' ? 'observation' : 'derived', role: l.role, product: l.product,
      ...(l.legend ? { legend: l.legend } : {}),
      provenance: { ...l.provenance, acquisition: l.acquisition, processing: l.provenance.processing ?? [], origin: l.kind === 'browse' ? 'nasa_browse' : 'derived_by_team' },
    })),
  };
}

const EVENT_Q = ['What am I looking at?', 'What is this investigation about?', 'Where is this?', 'When did this happen?', 'Which method is used here?', 'What kind of event is this?'];
const LAYER_Q = (role) => [
  `When was the ${role} image acquired?`, `Is the ${role} layer an official NASA product?`, `What product is the ${role} layer?`,
  `Which satellite took the ${role} image?`, `What is the quality tier of the ${role} layer?`, `Tell me about the ${role} layer.`,
];
const REF_Q = ['Where can I read more about this?', 'What is the source for this investigation?', 'Is there a reference I can check?'];

export async function buildDataset() {
  const kb = readJson(path.join(here, '../web/public/data/assistant/kb.json'));
  const events = readJson(path.join(here, '../web/public/data/events.json')).events;
  const off = readJson(path.join(here, 'knowledge/offtopic.json'));
  const all = kb.records;

  // --- split the records
  const isHeldEvent = (r) => r.id.startsWith(`kb:event-${HELD_OUT_EVENT}`);
  const byTopic = new Map();
  for (const r of all) if (!isHeldEvent(r)) byTopic.set(r.topic, [...(byTopic.get(r.topic) ?? []), r]);
  const testIds = new Set(all.filter(isHeldEvent).map((r) => r.id));
  for (const list of byTopic.values()) list.forEach((r, i) => { if (i % 6 === 5) testIds.add(r.id); });
  const trainRecs = all.filter((r) => !testIds.has(r.id));
  const testRecs = all.filter((r) => testIds.has(r.id));
  const trainIndex = buildIndex(trainRecs);
  const fullIndex = buildIndex(all);

  const cut = (list) => Math.floor(list.length * 0.75);
  const offTrain = { en: off.en.slice(0, cut(off.en)), tr: off.tr.slice(0, cut(off.tr)) };
  const offTest = { en: off.en.slice(cut(off.en)), tr: off.tr.slice(cut(off.tr)) };

  const out = { train: [], val: [], test: [] };
  let n = 0;
  const emit = (split, type, question, sources, answer, gold, lang, level) => {
    const messages = [...buildMessages(question, sources, level), { role: 'assistant', content: answer }];
    out[split].push({ id: `${split}-${++n}`, type, lang, level, gold, source_ids: sources.map((s) => s.id), messages });
  };

  /** Other records to sit beside the right one: mostly near misses (what retrieval would really return), some random. */
  const distractors = (index, pool, question, exclude, count, lang, level) => {
    const near = retrieve(index, question, 6, 0).map((h) => h.record).filter((r) => !exclude.has(r.id));
    const chosen = [];
    while (chosen.length < count) {
      const from = rand() < 0.7 && near.length ? near : pool;
      const r = pick(from);
      if (exclude.has(r.id) || chosen.includes(r)) { if (chosen.length + exclude.size >= pool.length) break; continue; }
      chosen.push(r);
    }
    return chosen.map((r) => recordSource(r, lang, level));
  };

  const recordExamples = (split, index, pool, r, questions, lang) => {
    for (const q0 of questions) {
      const level = r.text_scientific_en && lang === 'en' && rand() < 0.4 ? 'scientific' : 'simple';
      const q = split === 'train' ? reword(q0, lang) : q0;
      const gold = recordSource(r, lang, level);
      // answerable: the right record is among the sources
      const sources = shuffle([gold, ...distractors(index, pool, q0, new Set([r.id]), Math.floor(rand() * 4), lang, level)]);
      emit(split, 'answer', q, sources, `${gold.text} [[${gold.id}]]`, [gold.id], lang, level);
      // not answerable: same question, the right record is missing -> the model must decline, not improvise
      if (rand() < 0.35) {
        const others = distractors(index, pool, q0, new Set([r.id]), 1 + Math.floor(rand() * 3), lang, level);
        emit(split, 'decline-missing', q, shuffle(others), NO_ANSWER, [], lang, level);
      }
    }
  };

  // --- knowledge records
  for (const r of trainRecs) {
    const en = r.questions_en;
    const held = en.length > 2 ? en[en.length - 1] : null; // unseen wording -> validation
    recordExamples('train', trainIndex, trainRecs, r, held ? en.slice(0, -1) : en, 'en');
    recordExamples('train', trainIndex, trainRecs, r, held ? en.slice(0, -1) : en, 'en'); // second pass: other distractors and wording
    if (held) recordExamples('val', trainIndex, trainRecs, r, [held], 'en');
    if (r.text_tr && r.questions_tr?.length) {
      const tr = r.questions_tr;
      const heldTr = tr.length > 2 ? tr[tr.length - 1] : null;
      recordExamples('train', trainIndex, trainRecs, r, heldTr ? tr.slice(0, -1) : tr, 'tr');
      if (heldTr) recordExamples('val', trainIndex, trainRecs, r, [heldTr], 'tr');
    }
  }
  for (const r of testRecs) {
    recordExamples('test', fullIndex, all, r, r.questions_en, 'en');
    if (r.text_tr && r.questions_tr?.length) recordExamples('test', fullIndex, all, r, r.questions_tr, 'tr');
  }

  // --- two records in one answer (an investigation's story and what the radar shows; a layer and its colours)
  const pairs = [];
  for (const r of all) {
    const m = /^kb:event-(.+)-happened$/.exec(r.id);
    if (m) { const b = all.find((x) => x.id === `kb:event-${m[1]}-radar`); if (b) pairs.push([r, b, `What happened in the ${r.title.split(':')[0]} and what does the radar show?`]); }
    const c = all.find((x) => x.id === `${r.id}-colours`);
    if (c && r.topic === 'layer') pairs.push([r, c, `What does the ${r.title.replace('Layer: ', '')} layer show, and what do its colours mean?`]);
  }
  for (const [a, b, q] of pairs) {
    const isTest = testIds.has(a.id) || testIds.has(b.id);
    const split = isTest ? 'test' : 'train';
    const index = isTest ? fullIndex : trainIndex;
    const pool = isTest ? all : trainRecs;
    const sa = recordSource(a, 'en', 'simple');
    const sb = recordSource(b, 'en', 'simple');
    const sources = shuffle([sa, sb, ...distractors(index, pool, q, new Set([a.id, b.id]), Math.floor(rand() * 2), 'en', 'simple')]);
    emit(split, 'answer-two', split === 'train' ? reword(q, 'en') : q, sources, `${sa.text} [[${sa.id}]]\n\n${sb.text} [[${sb.id}]]`, [sa.id, sb.id], 'en', 'simple');
  }

  // --- questions about what is open in the view (the investigation and its Before / After layers)
  for (const e of events) {
    const split = e.id === HELD_OUT_EVENT ? 'test' : 'train';
    const index = split === 'test' ? fullIndex : trainIndex;
    const pool = split === 'test' ? all : trainRecs;
    const combos = [];
    for (let i = 0; i < Math.min(4, e.layers.length - 1); i++) combos.push([{ ...e.layers[i], role: 'before' }, { ...e.layers[e.layers.length - 1 - i], role: 'after' }]);
    for (const layers of combos) {
      const view = contextSources(ctxFromEvent(e, layers));
      const eventSrc = view[0];
      const refSrc = view.find((s) => s.id.startsWith('ref:'));
      const withKb = (q) => shuffle([...view.filter((s) => !s.id.startsWith('ref:') || s === refSrc).slice(0, 4), ...distractors(index, pool, q, new Set(), Math.floor(rand() * 2), 'en', 'simple')]);
      for (const q of shuffle(EVENT_Q).slice(0, 3)) emit(split, 'view', split === 'train' ? reword(q, 'en') : q, withKb(q), `${eventSrc.text} [[${eventSrc.id}]]`, [eventSrc.id], 'en', 'simple');
      for (const role of ['before', 'after']) {
        const src = view.find((s) => s.id.startsWith('layer:') && s.text.startsWith(`The "${role}"`));
        if (!src) continue;
        for (const q of shuffle(LAYER_Q(role)).slice(0, 3)) emit(split, 'view', split === 'train' ? reword(q, 'en') : q, withKb(q), `${src.text} [[${src.id}]]`, [src.id], 'en', 'simple');
      }
      if (refSrc) { const q = pick(REF_Q); emit(split, 'view', q, withKb(q), `${refSrc.text} [[${refSrc.id}]]`, [refSrc.id], 'en', 'simple'); }
    }
  }

  // --- questions to decline: other subjects, predictions, safety verdicts, attempts to override the rules
  const decline = (split, index, pool, list, lang, repeats) => {
    for (const q of list) for (let k = 0; k < repeats; k++) {
      const count = Math.floor(rand() * 4); // sometimes no source at all
      const sources = count ? shuffle(distractors(index, pool, q, new Set(), count, lang, 'simple')) : [];
      emit(split, 'decline-offtopic', split === 'train' && k > 0 ? reword(q, lang) : q, sources, NO_ANSWER, [], lang, 'simple');
    }
  };
  decline('train', trainIndex, trainRecs, offTrain.en, 'en', 3);
  decline('train', trainIndex, trainRecs, offTrain.tr, 'tr', 3);
  decline('test', fullIndex, all, offTest.en, 'en', 1);
  decline('test', fullIndex, all, offTest.tr, 'tr', 1);

  out.train = shuffle(out.train);
  return { out, testIds: [...testIds], counts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { out, testIds, counts } = await buildDataset();
  const dir = path.join(here, 'data');
  fs.mkdirSync(dir, { recursive: true });
  // --manifest-only: record what the script builds today without replacing the .jsonl files a trained adapter
  // was made from and measured on (they are git-ignored and cannot be recovered once overwritten).
  const manifestOnly = process.argv.includes('--manifest-only');
  if (!manifestOnly) for (const [name, rows] of Object.entries(out)) fs.writeFileSync(path.join(dir, `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const byType = {};
  for (const [name, rows] of Object.entries(out)) for (const r of rows) byType[`${name}/${r.type}`] = (byType[`${name}/${r.type}`] ?? 0) + 1;
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({ prompt_version: PROMPT_VERSION, seed: SEED, held_out_event: HELD_OUT_EVENT, held_out_records: testIds, counts, by_type: byType }, null, 1)}\n`);
  console.log(manifestOnly ? 'manifest.json only (the .jsonl files were left as they are):' : 'wrote train/val/test .jsonl and manifest.json:', counts, byType);
}
