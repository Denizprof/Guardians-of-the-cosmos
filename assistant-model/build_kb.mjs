// Builds the chatbot's knowledge base: web/public/data/assistant/kb.json
//
//   node assistant-model/build_kb.mjs
//
// Nothing here is written by a model. Every record is one of:
//   - the app's own vetted text (web/src/content/explain.ts, events.json, layers.json), copied as is;
//   - a hand-written description of an app tool (knowledge/app.json), taken from what the app shows;
//   - a general SAR fact from knowledge/verified_sar.json, kept only if a person or reviewer checked it
//     against its cited source (verdict "supported" or "partly"; anything else is left out).
// Each record names its source, so every answer the chatbot gives can be traced.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../web');
const SITE = 'https://globalsar.earth/';
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** A layer description is never cut below this many characters to make room for its facts and limitations. */
const DESCRIPTION_MIN = 320;
/**
 * Cut at a sentence end so a record stays short enough for a small model's prompt.
 * A shortened text always ends in "…", so it never looks complete; a semicolon is not a sentence end.
 */
export function fit(text, maxChars) {
  const t = clean(text);
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const end = cut.lastIndexOf('. ');
  if (end > maxChars * 0.5) return `${cut.slice(0, end + 1)} …`;
  const word = cut.lastIndexOf(' ');
  return `${(word > 0 ? cut.slice(0, word) : cut).replace(/[\s;,:(]+$/, '')}…`;
}

export async function buildKb() {
  const { CONCEPTS, EVENT_CONTENT } = await import(new URL('../web/src/content/explain.ts', import.meta.url).href);
  const events = readJson(path.join(web, 'public/data/events.json')).events;
  const layers = readJson(path.join(web, 'public/data/layers.json')).layers;
  const app = readJson(path.join(here, 'knowledge/app.json'));
  const verifiedPath = path.join(here, 'knowledge/verified_sar.json');
  const verified = fs.existsSync(verifiedPath) ? readJson(verifiedPath) : { records: [] };
  const records = [];
  const add = (r) => records.push(r);

  // --- the app itself
  for (const a of app) {
    add({ id: `kb:${a.slug}`, topic: 'app', title: a.title, text_en: clean(a.text_en), text_tr: clean(a.text_tr), questions_en: a.questions_en, questions_tr: a.questions_tr, source: { label: 'Global SAR app guide', url: SITE } });
  }

  // --- radar explainers written for the app (Simple and Scientific versions)
  const CONCEPT_Q = {
    sar: ['What is SAR?', 'What is synthetic aperture radar?', 'How does a radar satellite work?', 'How can radar see at night and through clouds?'],
    backscatter: ['What is backscatter?', 'Why is water black in radar images?', 'Why are cities bright in radar images?', 'What do bright and dark mean in a radar image?'],
    polarization: ['What is polarization?', 'What do HH and HV mean?', 'What is the difference between HH and HV?', 'Why is HV good for vegetation?'],
    insar: ['What is interferometry?', 'What is InSAR?', 'What are the rainbow fringes?', 'How does radar measure ground motion?'],
    coherence: ['What is coherence?', 'Why is there noise over water in an interferogram?', 'Why does the radar lose track?', 'What does low coherence mean?'],
    lband: ['Why does L-band matter?', 'What is L-band?', 'Why does NISAR use a long wavelength?', 'What is special about NISAR radar?'],
  };
  for (const c of CONCEPTS) {
    add({ id: `kb:concept-${c.id}`, topic: 'radar', title: c.title, text_en: fit(c.simple, 520), text_scientific_en: fit(c.scientific, 620), questions_en: [c.title, ...(CONCEPT_Q[c.id] ?? [])], source: { label: 'Global SAR radar explainer', url: SITE } });
  }

  // --- the investigations
  for (const e of events) {
    const c = EVENT_CONTENT[e.id];
    if (!c) continue;
    const name = e.title;
    const link = `${SITE}#/e/${e.id}`;
    const own = { label: `Global SAR investigation "${name}" (the project's own analysis, not an official NASA product)`, url: link };
    add({
      id: `kb:event-${e.id}-happened`, topic: 'investigation', title: `${name}: what happened`,
      text_en: fit(c.happened.text, 600),
      questions_en: [`What happened in the ${name}?`, `Tell me about the ${name}.`, `When did the ${name} happen?`, `Where was the ${name}?`, `What is the ${name} investigation about?`],
      source: { label: c.happened.source, url: c.happened.url },
    });
    add({
      id: `kb:event-${e.id}-radar`, topic: 'investigation', title: `${name}: what the radar shows`,
      text_en: fit(c.readSimple.slice(0, 3).join(' '), 640), text_scientific_en: fit(c.readScientific.slice(0, 2).join(' '), 760),
      questions_en: [`What does the radar show for the ${name}?`, `How do I read the ${name} images?`, `What do the colours mean in the ${name} investigation?`, `What changed between before and after in the ${name}?`],
      source: own,
    });
    add({
      id: `kb:event-${e.id}-caveats`, topic: 'investigation', title: `${name}: limits of the analysis`,
      text_en: fit(c.caveats.join(' '), 600),
      questions_en: [`How reliable is the ${name} analysis?`, `What are the limitations of the ${name} investigation?`, `Is the ${name} map an official NASA product?`, `How accurate is the ${name} measurement?`],
      source: own,
    });
    for (const p of c.pins) {
      add({
        id: `kb:event-${e.id}-pin-${p.id}`, topic: 'investigation', title: `${name}: ${p.label}`,
        text_en: fit(p.simple, 520), text_scientific_en: fit(p.scientific, 520),
        questions_en: [`What is "${p.label}" in the ${name} investigation?`, `What does the marker "${p.label}" show?`, `Explain ${p.label}.`],
        source: own,
      });
    }
  }

  // --- the satellite layers and their colour legends
  for (const l of layers) {
    const src = l.legend?.source?.url ? l.legend.source : { label: l.provider, url: SITE };
    // The provider, resolution and limitations are never shortened: only the description gives way when a record
    // is long (and is then marked with "…"). A layer's limits must always be stated in full.
    const tail = clean(`Provider: ${l.provider}. Mission: ${l.mission}. Resolution: ${l.resolution}. Limitations: ${l.limitations}`);
    const withTail = (description, budget) => `${fit(description, Math.max(DESCRIPTION_MIN, budget - tail.length - 1))} ${tail}`;
    add({
      id: `kb:layer-${l.id}`, topic: 'layer', title: `Layer: ${l.title}`,
      text_en: withTail(l.description_simple, 620),
      text_scientific_en: withTail(l.description_scientific, 760),
      questions_en: [`What does the ${l.title} layer show?`, `What is ${l.title}?`, `What are the limitations of ${l.title}?`, `Where does the ${l.title} data come from?`, `What is the resolution of ${l.title}?`],
      source: { label: l.provider, url: src.url },
    });
    if (l.legend?.simple) {
      const flag = l.legend.verified === false ? 'These colours are not officially documented by the provider. ' : '';
      add({
        id: `kb:layer-${l.id}-colours`, topic: 'layer', title: `Colours of: ${l.title}`,
        text_en: fit(`${flag}${l.legend.simple}${l.legend.note ? ` ${l.legend.note}` : ''}`, 620),
        text_scientific_en: fit(`${flag}${l.legend.scientific ?? l.legend.simple}${l.legend.note ? ` ${l.legend.note}` : ''}`, 700),
        questions_en: [`What do the colours mean in ${l.title}?`, `How do I read the ${l.title} legend?`, `What do the colors of the ${l.title} layer mean?`],
        source: src,
      });
    }
  }

  // --- general SAR facts, only those checked against their source
  const kept = verified.records.filter((r) => r.verdict === 'supported' || r.verdict === 'partly');
  for (const r of kept) {
    add({
      id: `kb:sar-${r.intent.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, topic: 'sar',
      title: clean(r.questions_en?.[0] ?? r.intent).replace(/\?$/, ''),
      text_en: clean(r.text_en), text_tr: clean(r.text_tr), questions_en: r.questions_en ?? [], questions_tr: r.questions_tr ?? [],
      source: { label: r.source_title || new URL(r.source_url).hostname, url: r.source_url },
    });
  }

  // --- more ways to ask (knowledge/paraphrases.json): slang, indirect, Turkish, keywords. They only help find the
  //     record; the answer text is never touched. An alias key covers a record and its sibling records
  //     (an investigation's "what happened / radar / limits / markers", a layer and its colours).
  const parPath = path.join(here, 'knowledge/paraphrases.json');
  if (fs.existsSync(parPath)) {
    const par = readJson(parPath);
    const ids = new Set(records.map((r) => r.id));
    for (const [slug, p] of Object.entries(par.records)) {
      const r = records.find((x) => x.id === `kb:${slug}`);
      if (!r) throw new Error(`paraphrases.json: no record kb:${slug}`);
      r.questions_en = [...new Set([...r.questions_en, ...(p.en ?? [])])];
      if (p.tr?.length) r.questions_tr = [...new Set([...(r.questions_tr ?? []), ...p.tr])];
    }
    for (const [prefix, p] of Object.entries(par.aliases)) {
      const group = records.filter((r) => r.id === `kb:${prefix}` || r.id.startsWith(`kb:${prefix}-`));
      if (!group.length) throw new Error(`paraphrases.json: no records for alias ${prefix}`);
      for (const r of group) {
        const isMain = r.id === `kb:${prefix}` || r.id === `kb:${prefix}-happened`;
        if (!isMain) continue; // keywords point at the main record only; the others keep their own, more specific questions
        r.questions_en = [...new Set([...r.questions_en, ...(p.en ?? [])])];
        if (p.tr?.length) r.questions_tr = [...new Set([...(r.questions_tr ?? []), ...p.tr])];
      }
    }
    void ids;
  }

  // --- checks: ids unique and well formed, no empty text, every source an http(s) link
  const seen = new Set();
  for (const r of records) {
    if (!/^kb:[a-z0-9-]{1,120}$/.test(r.id)) throw new Error(`bad id ${r.id}`);
    if (seen.has(r.id)) throw new Error(`duplicate id ${r.id}`);
    seen.add(r.id);
    if (!r.text_en || !r.questions_en?.length) throw new Error(`empty record ${r.id}`);
    if (!/^https?:\/\//.test(r.source.url) || !r.source.label) throw new Error(`record ${r.id} has no usable source`);
    if (r.topic === 'layer' && !r.id.endsWith('-colours')) {
      for (const k of ['text_en', 'text_scientific_en']) {
        if (!r[k]?.includes('Resolution:') || !r[k].includes('Limitations:')) throw new Error(`layer record ${r.id} ${k} lost its resolution or limitations`);
      }
    }
    for (const k of Object.keys(r)) if (r[k] === undefined || r[k] === '') delete r[k];
  }
  return {
    version: '1',
    generated: new Date().toISOString().slice(0, 10),
    counts: { total: records.length, app: app.length, verified_sar: kept.length, rejected_sar: verified.records.length - kept.length },
    records,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const kb = await buildKb();
  const out = path.join(web, 'public/data/assistant/kb.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(kb, null, 1)}\n`);
  console.log(`kb.json: ${kb.counts.total} records (${kb.counts.verified_sar} checked SAR facts kept, ${kb.counts.rejected_sar} left out), ${(fs.statSync(out).size / 1024).toFixed(0)} kB`);
}
