// The in-browser assistant (assistant/local) on a small fixture knowledge base and no classifier: it answers only from
// sources, cites them, and says what it can help with when it has none. conversation.test.ts covers the real
// knowledge base with the trained classifier.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LocalAssistantAdapter } from '../../../src/assistant/local/adapter';
import { buildIndex, contextSources, detectLang, features, intentProbs, rank, retrieve, type IntentModel, type KbFile, type KbRecord } from '../../../src/assistant/local/core';
import { buildRequest, collectCitationIds } from '../../../src/assistant/context';
import { validateResponse } from '../../../src/assistant/validate';
import type { AssistantContext } from '../../../src/assistant/types';

const rec = (slug: string, title: string, text: string, questions: string[], extra: Partial<KbRecord> = {}): KbRecord => ({
  id: `kb:${slug}`, topic: 't', title, text_en: text, questions_en: questions, source: { label: 'NASA', url: 'https://science.nasa.gov/x' }, ...extra,
});
const KB: KbFile = {
  version: '1', generated: '2026-11-14',
  records: [
    rec('concept-sar', 'What is synthetic aperture radar?', 'A radar satellite sends its own microwave pulses and records the echoes.', ['What is SAR?', 'How does a radar satellite work?'], { text_tr: 'Radar uydusu kendi mikrodalga darbelerini gönderir ve yankıları kaydeder.', questions_tr: ['SAR nedir?'] }),
    rec('tool-lens', 'The SAR lens tool', 'The SAR lens is a square you can move and resize.', ['What is the SAR lens?', 'How do I see a place in radar?']),
    rec('sar-predict', 'Can earthquakes be predicted', 'No. According to the USGS, no scientist has ever predicted a major earthquake.', ['Can you predict earthquakes?', 'Will there be an earthquake?']),
    rec('chat-hello', 'Hello', 'Hello! I am the Global SAR assistant.', ['Hello', 'Hi'], { topic: 'chat' }),
    rec('app-assistant', 'How this assistant works', 'This assistant answers only from a checked knowledge base and cites what it used.', ['Who are you?', 'How do you work?'], { text_tr: 'Bu asistan yalnızca kontrol edilmiş bir bilgi tabanından yanıt verir.', questions_tr: ['Sen kimsin?'] }),
    rec('layer-snow', 'Layer: Daily snow cover', 'Shows where snow lies on the ground each day.', ['What does the snow cover layer show?']),
    rec('layer-night', 'Layer: Night lights', 'Shows the light people make at night.', ['What does the night lights layer show?']),
  ],
};
const EVENT_CTX: AssistantContext = {
  event: { citation_id: 'event:venezuela-2026', id: 'venezuela-2026', title: 'Venezuela earthquakes', subtitle: 'M7.5 and M7.2', category: 'earthquake', date: '2026-06-24T22:04:00Z', technique: 'insar', location: { lon: -67.22, lat: 10.6 } },
};

const adapterWith = (_none: null = null, kb: KbFile | Error = KB) =>
  new LocalAssistantAdapter({ loadKb: async () => { if (kb instanceof Error) throw kb; return kb; }, loadIntent: async () => undefined, loadCatalog: async () => undefined });
async function ask(a: LocalAssistantAdapter, query: string, context: AssistantContext = {}, locale = 'en') {
  const req = await a.prepare(buildRequest({ query, locale, level: 'simple', context }));
  const res = await a.query(req);
  return { req, res, allowed: collectCitationIds(req.context) };
}

describe('core: retrieval and output checks', () => {
  const index = buildIndex(KB.records);
  it('finds the record a question is about, and nothing for an unrelated question', () => {
    expect(retrieve(index, 'What is SAR?')[0].record.id).toBe('kb:concept-sar');
    expect(retrieve(index, 'how do i see a place in radar')[0].record.id).toBe('kb:tool-lens');
    expect(retrieve(index, 'Who won the football world cup?')).toEqual([]);
    expect(retrieve(index, '???')).toEqual([]);
  });
  it('matches Turkish wording, including dotted and dotless i', () => {
    expect(retrieve(index, 'SAR NEDİR')[0].record.id).toBe('kb:concept-sar');
    expect(detectLang('SAR nedir?')).toBe('tr');
    expect(detectLang('What is SAR?')).toBe('en');
  });
  it('does not take an English question for Turkish because of a place name with ö, ü, ç or ş', () => {
    expect(detectLang('Why is Zürich dark?')).toBe('en');
    expect(detectLang('Is there NISAR coverage over Kahramanmaraş?')).toBe('en');
    expect(detectLang('What does the radar show near Düsseldorf?')).toBe('en');
    expect(detectLang('Kahramanmaraş depremi nedir?')).toBe('tr');
    expect(detectLang('Görüntü neden karanlık?')).toBe('tr');
    expect(detectLang('Bu görüntü çok bulanık')).toBe('tr');
    // no telling word either way: Turkish-only letters, then the interface language, decide
    expect(detectLang('Kahramanmaraş')).toBe('tr');
    expect(detectLang('Zürich', 'tr-TR')).toBe('tr');
    expect(detectLang('Zürich', 'en-US')).toBe('en');
    expect(detectLang('Zürich')).toBe('en');
  });
});

describe('LocalAssistantAdapter on words alone (no classifier)', () => {
  it('is ready when the knowledge base loads, and reports an error (not "no data") when it does not', async () => {
    expect((await adapterWith().health()).status).toBe('ok');
    const broken = await adapterWith(null, new Error('HTTP 404')).health();
    expect(broken.status).toBe('error');
    expect(broken.detail).toMatch(/knowledge base/i);
  });

  it('quotes the matching record and cites it; the response passes the app contract', async () => {
    const { res, allowed } = await ask(adapterWith(), 'What is SAR?');
    expect(res.status).toBe('ok');
    expect(res.answer?.text).toContain('sends its own microwave pulses');
    expect(res.answer?.text).toContain('[[kb:concept-sar]]');
    expect(res.citations?.[0]).toMatchObject({ id: 'kb:concept-sar', type: 'reference', url: 'https://science.nasa.gov/x' });
    expect(res.limitations?.join(' ')).toMatch(/Global SAR knowledge base/i);
    expect(validateResponse(res, allowed).ok).toBe(true);
  });

  it('declines a question it has no source for, with no answer and no citation', async () => {
    const { res, req } = await ask(adapterWith(), 'Who won the football world cup?');
    expect(req.context.knowledge).toBeUndefined();
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('insufficient_context');
    expect(res.answer).toBeUndefined();
  });

  it('answers a Turkish question with the Turkish text of the record', async () => {
    const { res } = await ask(adapterWith(), 'SAR nedir?', {}, 'tr');
    expect(res.answer?.text).toContain('kendi mikrodalga darbelerini');
  });

  it('answers an English question in English even when it has a place name with ü', async () => {
    const { res } = await ask(adapterWith(), 'How does a radar satellite work over Zürich?', {}, 'en');
    expect(res.answer?.text).toContain('sends its own microwave pulses');
    expect(res.limitations?.[0]).toBe('Answered from the Global SAR knowledge base. Open the source to check anything important.');
    const none = await ask(adapterWith(), 'Why is Zürich so expensive?', {}, 'en');
    expect(none.res.error?.message).toMatch(/outside my field|couldn't match/);
    expect(none.res.suggestions?.length).toBeGreaterThan(0);
  });

  it('greets by introducing itself from its own record', async () => {
    const { res, allowed } = await ask(adapterWith(), 'Hello!');
    expect(res.status).toBe('ok');
    expect(res.citations?.map((c) => c.id)).toEqual(['kb:chat-hello']);
    expect(validateResponse(res, allowed).ok).toBe(true);
  });

  it('describes the open investigation from the view when the knowledge base has nothing', async () => {
    const { res, allowed } = await ask(adapterWith(), 'What am I looking at?', EVENT_CTX);
    expect(res.status).toBe('ok');
    expect(res.answer?.text).toContain('Venezuela earthquakes');
    expect(res.citations?.map((c) => c.id)).toEqual(['event:venezuela-2026']);
    expect(validateResponse(res, allowed).ok).toBe(true);
  });
});

describe('questions about "this" while an investigation is open', () => {
  const kb: KbFile = { ...KB, records: [
    ...KB.records,
    rec('app-who', 'Who Global SAR is for', 'Every investigation explains what you are looking at.', ['Who is this app for?']),
    rec('event-venezuela-2026-radar', 'Venezuela earthquakes: what the radar shows', 'The map shows how far the ground moved toward or away from the satellite.', ['What does the radar show for the Venezuela earthquakes?']),
    rec('event-other-2026-radar', 'Other event: what the radar shows', 'Dark means water.', ['What does the radar show for the other event?']),
  ] };
  it('"What am I looking at?" is answered by the open investigation, not by a general record', async () => {
    const { res } = await ask(adapterWith(null, kb), 'What am I looking at?', EVENT_CTX);
    expect(res.citations?.map((c) => c.id)).toEqual(['event:venezuela-2026']);
  });
  it('"What does the radar show here?" uses the record of the open investigation, never another one', async () => {
    const { res } = await ask(adapterWith(null, kb), 'What does the radar show here?', EVENT_CTX);
    expect(res.citations?.map((c) => c.id)).toEqual(['kb:event-venezuela-2026-radar']);
  });
  it('an unrelated question is declined even though an investigation is open', async () => {
    const { res } = await ask(adapterWith(null, kb), 'Who won the football world cup?', EVENT_CTX);
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('insufficient_context');
  });
  it('a question that shares words with the view is answered from it ("when did the earthquakes happen?")', async () => {
    const { res } = await ask(adapterWith(null, kb), 'When did the earthquakes happen?', EVENT_CTX);
    expect(res.citations?.map((c) => c.id)).toEqual(['event:venezuela-2026']);
  });
  it('a general question still finds the general record while an investigation is open', async () => {
    const { res } = await ask(adapterWith(null, kb), 'What is SAR?', EVENT_CTX);
    expect(res.citations?.map((c) => c.id)).toEqual(['kb:concept-sar']);
  });
});

describe('coverage probe sentence: a capped list is not stated as the full count', () => {
  const g = { citation_id: 'granule:A', scene: 'A', product: 'GCOV', start: '2026-01-01T00:00:00Z', tier: 'BETA', track: 1, frame: 2, direction: 'ASCENDING' };
  it('says "at least N" and that more exist when the search hit its row limit', () => {
    const text = contextSources({ coverage: { lon: 1, lat: 2, total: 250, truncated: true, granules: [g] } })[0].text;
    expect(text).toContain('lists at least 250 NISAR product(s) (the list is capped; more exist). Newest: ');
  });
  it('states the plain count when the list is complete', () => {
    const text = contextSources({ coverage: { lon: 1, lat: 2, total: 3, granules: [g] } })[0].text;
    expect(text).toContain('lists 3 NISAR product(s). Newest: ');
    expect(text).not.toContain('at least');
  });
});

describe('the shipped knowledge base (public/data/assistant/kb.json)', () => {
  const kb = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../public/data/assistant/kb.json'), 'utf8')) as KbFile;
  const meta = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../public/data/assistant/intent.json'), 'utf8')) as Omit<IntentModel, 'weights'>;
  const bin = fs.readFileSync(path.resolve(__dirname, '../../../public/data/assistant/intent.bin'));
  const intent: IntentModel = { ...meta, weights: new Int8Array(bin.buffer, bin.byteOffset, bin.byteLength) };
  const index = buildIndex(kb.records, intent);
  const withIntent = (k: KbFile) => new LocalAssistantAdapter({ loadKb: async () => k, loadIntent: async () => intent, loadCatalog: async () => undefined });
  it('the classifier turns a question into a normalised feature vector and a probability per record', () => {
    const x = features('What is SAR?');
    let norm = 0;
    for (const v of x.values()) norm += v * v;
    expect(norm).toBeCloseTo(1, 5);
    const probs = intentProbs(intent, 'What is SAR?');
    let sum = 0;
    for (const p of probs.values()) sum += p;
    expect(sum).toBeCloseTo(1, 5);
    expect(rank(index, 'write me a poem about the sea').offTopic).toBe(true);
    expect(rank(index, 'What is SAR?').confident).toBe(true);
  });
  it('every record has an id, text, example questions and an http(s) source', () => {
    expect(kb.records.length).toBeGreaterThan(80);
    const ids = new Set<string>();
    for (const r of kb.records) {
      expect(r.id).toMatch(/^kb:[a-z0-9-]+$/);
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
      expect(r.text_en.length).toBeGreaterThan(20);
      expect(r.questions_en.length).toBeGreaterThan(0);
      expect(r.source.url).toMatch(/^https?:\/\//);
      expect(r.source.label.length).toBeGreaterThan(1);
    }
  });
  it.each([
    ['why is water black in radar images', 'kb:concept-backscatter'],
    ['When was NISAR launched?', 'kb:sar-nisar-launch'],
    ['NISAR ne zaman fırlatıldı?', 'kb:sar-nisar-launch'],
    ['How do I see a place in radar?', 'kb:tool-lens'],
    ['What happened in the Venezuela earthquakes?', 'kb:event-venezuela-2026-happened'],
    ['Can you predict earthquakes?', 'kb:sar-predict'],
    ['how do i zoom', 'kb:app-navigate'],
    ['Are these official NASA products?', 'kb:app-not'],
  ])('"%s" finds %s first', (q, id) => {
    expect(retrieve(index, q)[0]?.record.id).toBe(id);
  });
  it('"What is SAR?" finds a record that defines SAR (the NASA-sourced fact or the app explainer)', () => {
    expect(['kb:sar-sar-nedir', 'kb:concept-sar']).toContain(retrieve(index, 'What is SAR?')[0]?.record.id);
  });
  it.each(['How do I cook pasta?', 'Tell me a joke about cats', 'What is the population of Turkey?', 'Write me a poem'])('"%s" finds nothing', (q) => {
    expect(retrieve(index, q)).toEqual([]);
  });
  // A question that names the app itself ("this app", "this website", "the assistant here") is about the app,
  // not about the open investigation, even though it contains a pointing word.
  const KRASH: AssistantContext = {
    event: { citation_id: 'event:krasheninnikov-2026', id: 'krasheninnikov-2026', title: 'Krasheninnikov eruption', category: 'volcano', date: '2026-01-01T00:00:00Z', technique: 'insar', location: { lon: 160.27, lat: 54.59 } },
  };
  it.each([
    ['What is this app?', 'kb:app-what'],
    ['Who made this website?', 'kb:project-team'],
    ['Bu uygulama nedir?', 'kb:app-what'],
    ['How do I use the assistant here?', 'kb:app-assistant'],
    ['How do I compare before and after in this app?', 'kb:app-compare'],
    ['What are the data tiers shown in this app?', 'kb:app-tiers'],
  ])('with an investigation open, "%s" is still answered by %s', async (q, id) => {
    const { res } = await ask(withIntent(kb), q, KRASH);
    expect(res.status).toBe('ok');
    expect(res.citations?.[0]?.id).toBe(id);
  });
  it.each([
    ['What am I looking at?', 'event:krasheninnikov-2026'],
    ['What does the radar show here?', 'kb:event-krasheninnikov-2026-radar'],
    ['How reliable is this analysis?', 'kb:event-krasheninnikov-2026-caveats'],
  ])('with an investigation open, "%s" is still answered by the investigation (%s)', async (q, id) => {
    const { res } = await ask(withIntent(kb), q, KRASH);
    expect(res.citations?.map((c) => c.id)).toEqual([id]);
  });
  it('a question that names the app but matches no record is declined, not answered with the open investigation', async () => {
    const { res } = await ask(adapterWith(null, KB), 'Is this website free of charge?', EVENT_CTX);
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('insufficient_context');
  });
  it('contains none of the legacy records that failed the source check', () => {
    const ids = new Set(kb.records.map((r) => r.id));
    for (const rejected of ['kb:sar-flood', 'kb:sar-tsunami', 'kb:sar-geotiff', 'kb:sar-insar', 'kb:sar-coherence']) expect(ids.has(rejected)).toBe(false);
  });
});
