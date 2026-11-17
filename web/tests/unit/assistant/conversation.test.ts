// The assistant as a visitor meets it: the real knowledge base, the trained classifier and the map's catalog,
// asked the way people ask. Each case names the record(s) a good answer must cite.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LocalAssistantAdapter } from '../../../src/assistant/local/adapter';
import type { IntentModel, KbFile } from '../../../src/assistant/local/core';
import type { CatalogFile } from '../../../src/assistant/local/catalog';
import { buildRequest, collectCitationIds } from '../../../src/assistant/context';
import { validateResponse } from '../../../src/assistant/validate';
import type { AssistantContext, ConversationTurn } from '../../../src/assistant/types';

const data = path.resolve(__dirname, '../../../public/data');
const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(path.join(data, p), 'utf8')) as T;
const KB = readJson<KbFile>('assistant/kb.json');
const CATALOG = readJson<CatalogFile>('context.json');
function intentModel(): IntentModel {
  const meta = readJson<{ dim: number; labels: string[]; scale: number; bias: number[] }>('assistant/intent.json');
  const buf = fs.readFileSync(path.join(data, 'assistant/intent.bin'));
  return { ...meta, weights: new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}
const INTENT = intentModel();

const adapter = (opts: { intent?: boolean; catalog?: boolean } = {}) =>
  new LocalAssistantAdapter({
    loadKb: async () => KB,
    loadIntent: async () => { if (opts.intent === false) throw new Error('HTTP 404'); return INTENT; },
    loadCatalog: async () => { if (opts.catalog === false) throw new Error('HTTP 404'); return CATALOG; },
  });
const shared = adapter();

async function ask(query: string, o: { context?: AssistantContext; locale?: string; conversation?: ConversationTurn[]; a?: LocalAssistantAdapter } = {}) {
  const a = o.a ?? shared;
  const req = await a.prepare(buildRequest({ query, locale: o.locale ?? 'en', level: 'simple', context: o.context ?? {}, conversation: o.conversation }));
  const res = await a.query(req);
  return { res, cited: (res.citations ?? []).map((c) => c.id.replace(/^kb:/, '')), allowed: collectCitationIds(req.context) };
}

const EVENT_CTX: AssistantContext = {
  event: { citation_id: 'event:venezuela-2026', id: 'venezuela-2026', title: 'Venezuela earthquakes', subtitle: 'M7.5 and M7.2', category: 'earthquake', date: '2026-06-24T22:04:00Z', technique: 'insar', location: { lon: -67.22, lat: 10.6 } },
};

describe('the classifier files that ship with the app', () => {
  it('have one class per knowledge record, plus the off-topic class', () => {
    expect(INTENT.labels.filter((l) => !l.startsWith('__')).sort()).toEqual(KB.records.map((r) => r.id).sort());
    expect(INTENT.labels).toContain('__off__');
    expect(INTENT.weights.length).toBe(INTENT.dim * INTENT.labels.length);
  });
});

describe('answers about the project, radar and the app', () => {
  it.each([
    ['What is SAR?', ['concept-sar', 'sar-sar-nedir']],
    ['Who made this?', ['project-team']],
    ['who are the guardians of the cosmos', ['project-team']],
    ['what did you find', ['project-results']],
    ['how much did the ground move in venezuela', ['event-venezuela-2026-data', 'event-venezuela-2026-radar']],
    ['how many km2 were flooded in mozambique', ['event-mozambique-floods-2026-data']],
    ['is it free to use', ['project-open-source']],
    ['what tech stack is the site built with', ['project-tech']],
    ['which challenge is this for', ['project-challenge', 'app-what']],
    ['how does the data pipeline work', ['project-pipeline']],
    ['how often does NISAR come back to the same place', ['ref-nisar-orbit']],
    ['why is the radar image grey and noisy', ['ref-radar-vs-optical', 'sar-speckle']],
    ['what is GUNW', ['glossary-products']],
    ['the globe is very slow on my laptop', ['app-lite']],
    ['can i use it on my phone', ['app-install']],
    ['which investigations do you have', ['app-investigation-list', 'tool-investigations']],
    ['can you predict the next earthquake', ['sar-predict', 'sar-prediction-vs-warning']],
    ['what can you do', ['chat-capabilities']],
    ['hello', ['chat-hello']],
    ['thanks a lot', ['chat-thanks']],
    ['who are you', ['app-assistant', 'chat-name']],
  ])('%s', async (q, gold) => {
    const { res, cited, allowed } = await ask(q);
    expect(res.status, res.error?.message).toBe('ok');
    expect(gold).toContain(cited[0]);
    expect(validateResponse(res, allowed).ok).toBe(true);
  });

  it.each([
    ['Bunu kim yaptı?', ['project-team'], 'Guardians of the Cosmos takımı'],
    ['SAR nedir?', ['concept-sar', 'sar-sar-nedir'], ''],
    ['sonuçlar nelerdir', ['project-results'], 'Beş araştırmanın sonuçları'],
    ['merhaba', ['chat-hello'], 'Merhaba'],
    ['uygulama ücretsiz mi', ['project-open-source'], 'ücretsiz'],
    ['Venezuela depremlerinde ne oldu?', ['event-venezuela-2026-happened', 'event-venezuela-2026-data'], ''],
  ])('Turkish: %s', async (q, gold, phrase) => {
    const { res, cited } = await ask(q, { locale: 'tr' });
    expect(res.status, res.error?.message).toBe('ok');
    expect(gold).toContain(cited[0]);
    if (phrase) expect(res.answer?.text).toContain(phrase);
  });

  it('never names a third-party AI vendor or model when asked what it is', async () => {
    for (const q of ['who are you', 'which AI model are you', 'are you ChatGPT', 'how were you trained', 'hangi yapay zekâsın']) {
      const { res } = await ask(q);
      expect(res.status).toBe('ok');
      expect(res.answer?.text).toMatch(/Global SAR/);
    }
  });
});

describe('two questions in one', () => {
  it('answers both parts when each clearly has its own record', async () => {
    const { res, cited, allowed } = await ask('who built this and what did you find?');
    expect(res.status).toBe('ok');
    expect(cited).toEqual(['project-team', 'project-results']);
    expect(validateResponse(res, allowed).ok).toBe(true);
  });
  it('does not split a single question that merely contains "and"', async () => {
    const { cited } = await ask('What is the difference between HH and HV?');
    expect(cited.length).toBeLessThanOrEqual(2);
    expect(['concept-polarization', 'sar-polar']).toContain(cited[0]);
  });
});

describe('follow-up questions use the conversation', () => {
  const history: ConversationTurn[] = [
    { role: 'user', content: 'What happened in the Venezuela earthquakes?' },
    { role: 'assistant', content: 'Two earthquakes struck. [[kb:event-venezuela-2026-happened]]' },
  ];
  it('"tell me more" continues the previous topic with something not shown yet', async () => {
    const { res, cited } = await ask('tell me more', { conversation: history });
    expect(res.status, res.error?.message).toBe('ok');
    expect(cited[0]).toMatch(/^event-venezuela-2026-/);
    expect(cited[0]).not.toBe('event-venezuela-2026-happened');
  });
  it('a short follow-up is read together with the previous question', async () => {
    const { res, cited } = await ask('and the limits?', { conversation: history });
    expect(res.status, res.error?.message).toBe('ok');
    expect(cited[0]).toMatch(/venezuela|limitations/);
  });
  it('"tell me more" with no conversation is still answered helpfully, not with an error page', async () => {
    const { res } = await ask('tell me more');
    expect(['ok', 'error']).toContain(res.status);
    if (res.status === 'error') expect(res.suggestions?.length).toBeGreaterThan(0);
  });
});

describe('questions about the events on the map', () => {
  const quakes = CATALOG.events.filter((e) => e.category === 'earthquake');
  it('counts earthquakes from the catalog the map draws', async () => {
    const { res, cited, allowed } = await ask('how many earthquakes are on the map?');
    expect(cited).toEqual(['live-catalog']);
    expect(res.answer?.text).toContain(`lists ${quakes.length} earthquakes`);
    expect(res.answer?.text).toContain('not radar analysis');
    expect(validateResponse(res, allowed).ok).toBe(true);
  });
  it('finds the strongest earthquake', async () => {
    const strongest = [...quakes].sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0))[0];
    const { res, cited } = await ask('what was the strongest earthquake?');
    expect(cited).toEqual(['live-catalog']);
    expect(res.answer?.text).toContain(strongest.title);
  });
  it('filters by a place named in the question, in English and Turkish', async () => {
    const inJapan = quakes.filter((e) => /japan/i.test(e.title)).length;
    expect(inJapan).toBeGreaterThan(0);
    const en = await ask('were there any earthquakes in Japan recently?');
    expect(en.cited).toEqual(['live-catalog']);
    expect(en.res.answer?.text).toContain(`lists ${inJapan} earthquake`);
    const tr = await ask('Japonya\'da son depremler neler?', { locale: 'tr' });
    expect(tr.cited).toEqual(['live-catalog']);
    expect(tr.res.answer?.text).toContain(`${inJapan} deprem`);
  });
  it('says so when the catalog has nothing for a place, with the real total', async () => {
    const { res } = await ask('how many volcano eruptions in Iceland?');
    expect(res.status).toBe('ok');
    // no catalog event is in Iceland: it must not answer with the worldwide count as if it were Iceland's
    expect(res.answer?.text).toMatch(/has no volcano events matching "Iceland"/);
    expect((await ask('İzlanda\'da yanardağ patlaması oldu mu?', { locale: 'tr' })).res.answer?.text ?? '').not.toMatch(/kataloğunda \S+ ile/);
  });
  it('leaves questions about an investigation to the investigation, not the catalog', async () => {
    expect((await ask('How many dates are in the volcano time series?')).cited[0]).toBe('event-krasheninnikov-2026-data');
    expect((await ask('What happened in the Venezuela earthquakes?')).cited[0]).toBe('event-venezuela-2026-happened');
  });
  it('still works when the catalog cannot be loaded', async () => {
    const { res } = await ask('how many earthquakes are on the map?', { a: adapter({ catalog: false }) });
    expect(['ok', 'error']).toContain(res.status);
    expect(res.citations?.some((c) => c.id === 'kb:live-catalog') ?? false).toBe(false);
  });
});

describe('questions outside its field', () => {
  it.each(['Who won the football world cup?', 'write me a poem about the sea', 'what is bitcoin worth today', 'bana bir şiir yaz', 'yemek tarifi verir misin'])('%s', async (q) => {
    const { res } = await ask(q);
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('insufficient_context');
    expect(res.answer).toBeUndefined();
    // it says what it can help with and offers questions, instead of a bare "I don't know"
    expect(res.error?.message).toMatch(/Global SAR/);
    expect(res.error?.message).not.toMatch(/don't know|do not know|bilmiyorum/i);
    expect(res.suggestions?.length).toBeGreaterThan(0);
  });
});

describe('suggestions', () => {
  it('offers up to three follow-ups and never repeats the question just asked', async () => {
    const { res } = await ask('What is SAR?');
    expect(res.suggestions?.length).toBeGreaterThan(0);
    expect(res.suggestions!.length).toBeLessThanOrEqual(3);
    expect(res.suggestions!.map((s) => s.toLowerCase())).not.toContain('what is sar?');
    expect(new Set(res.suggestions).size).toBe(res.suggestions!.length);
  });
  it('with an investigation open, "Who made this?" is about the project, not the investigation', async () => {
    const { cited } = await ask('Who made this?', { context: EVENT_CTX });
    expect(cited).toEqual(['project-team']);
    expect((await ask('What does the radar show here?', { context: EVENT_CTX })).cited[0]).toMatch(/^event-venezuela-2026-/);
  });
  it('"Explain this investigation" gives the overview of the open investigation, in English and Turkish', async () => {
    expect((await ask('Explain this investigation.', { context: EVENT_CTX })).cited).toEqual(['event-venezuela-2026-happened', 'event-venezuela-2026-radar']);
    expect((await ask('Bu araştırmayı açıkla.', { context: EVENT_CTX, locale: 'tr' })).cited[0]).toBe('event-venezuela-2026-happened');
  });
  it('"What am I currently viewing?" with no investigation open describes the globe view, and cites it', async () => {
    const context: AssistantContext = { map_view: { center: [35, 39], zoom: 5.2, bbox: [26, 36, 45, 42] } };
    const { res, cited, allowed } = await ask('What am I currently viewing?', { context });
    expect(cited).toEqual(['view:map']);
    expect(res.answer?.text).toContain('39.000°N 35.000°E');
    expect(validateResponse(res, allowed).ok).toBe(true);
  });
  it('every starter question the panel offers has a confident answer', async () => {
    for (const q of ['What is SAR?', 'Which investigations are there?', 'Can radar predict earthquakes?', 'Who made this?']) expect((await ask(q)).res.status, q).toBe('ok');
    for (const q of ['SAR nedir?', 'Hangi araştırmalar var?', 'Radar depremleri tahmin edebilir mi?', 'Bunu kim yaptı?']) {
      const { res, cited } = await ask(q, { locale: 'tr' });
      expect(res.status, q).toBe('ok');
      if (q.startsWith('Radar depremleri')) expect(['sar-predict', 'sar-prediction-vs-warning']).toContain(cited[0]);
    }
  });
  it('suggests questions about the open investigation when one is open', async () => {
    const { res } = await ask('What am I looking at?', { context: EVENT_CTX });
    expect(res.status).toBe('ok');
    expect(res.answer?.text).toContain('Venezuela');
  });
});

describe('the same question, worded differently, gets the same answer', () => {
  it.each([
    ['What is SAR?', 'concept-sar'], ['SAR? what is it', 'concept-sar'], ['write SAR? what is it', 'concept-sar'], ['whats SAR', 'concept-sar'], ['sar?', 'concept-sar'],
    ['What is NISAR?', 'sar-nisar'], ['nisar?', 'sar-nisar'], ['tell me something about NISAR', 'sar-nisar'], ['do not tell me about SAR, tell me about NISAR', 'sar-nisar'],
    ['difference between NISAR and Sentinel-1', 'sar-sentinel'], ['SAR vs optical difference', 'ref-radar-vs-optical'], ['SAR ile optik arasındaki fark ne', 'ref-radar-vs-optical'],
  ])('%s', async (q, id) => {
    const { cited } = await ask(q, { locale: /ile|ne$/.test(q) ? 'tr' : 'en' });
    expect(cited[0]).toBe(id);
  });
  it('treats "Tell me about Turkey" and "give info about turkey" alike, sending both to the page for Turkey', async () => {
    const urls: string[] = [];
    const a = new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => INTENT, loadCatalog: async () => CATALOG, research: async (q) => { urls.push(q); return { ok: true, result: { title: 'Turkey', text: 'Turkey is a country.', url: 'https://en.wikipedia.org/wiki/Turkey', site: 'Wikipedia (English)', retrieved: '2026-11-16T00:00:00Z' } }; } });
    for (const q of ['Tell me about Türkiye.', 'give info about turkey', 'türkiye', 'info about Turkey']) expect((await ask(q, { a })).cited, q).toEqual(['web:research']);
    expect(urls.length).toBe(4);
  });
});

describe('review findings stay fixed', () => {
  it('a question that names no place is not answered as "no events matching <word>"', async () => {
    for (const q of ['what is the largest earthquake magnitude', 'how many earthquakes in the world']) {
      const { res } = await ask(q);
      expect(res.answer?.text ?? '', q).not.toMatch(/no earthquakes matching/);
    }
  });
  it('a second "tell me more" continues the original topic and never repeats a record', async () => {
    const history: ConversationTurn[] = [
      { role: 'user', content: 'What happened in the Venezuela earthquakes?' },
      { role: 'assistant', content: 'x [[kb:event-venezuela-2026-happened]]' },
      { role: 'user', content: 'tell me more' },
      { role: 'assistant', content: 'y [[kb:event-venezuela-2026-data]]' },
    ];
    const { res, cited } = await ask('tell me more', { conversation: history });
    expect(res.status).toBe('ok');
    expect(cited[0]).toMatch(/venezuela/);
    expect(cited).not.toContain('event-venezuela-2026-happened');
    expect(cited).not.toContain('event-venezuela-2026-data');
  });
  it('"ok" is an acknowledgement, not a repeat of the previous answer', async () => {
    const history: ConversationTurn[] = [{ role: 'user', content: 'What is SAR?' }, { role: 'assistant', content: 'x [[kb:concept-sar]]' }];
    expect((await ask('ok', { conversation: history })).cited).toEqual(['chat-thanks']);
  });
  it('reports the knowledge base being down instead of "I could not match that"', async () => {
    const a = new LocalAssistantAdapter({ loadKb: async () => { throw new Error('HTTP 500'); }, loadIntent: async () => undefined, loadCatalog: async () => undefined });
    const { res } = await ask('What is SAR?', { a });
    expect(res.status).toBe('unavailable');
    expect(res.error?.message).toMatch(/could not be loaded/);
  });
});

describe('acceptance questions that the knowledge base answers', () => {
  it('explains VV and VH polarization', async () => {
    const { res, cited } = await ask('Explain the difference between VV and VH polarization.');
    expect(cited[0]).toBe('ref-vv-vh');
    expect(res.answer?.text).toMatch(/cross-polarized/);
  });
  it('refuses to invent a measurement, in both languages, even with research available', async () => {
    let searched = false;
    const a = new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => INTENT, loadCatalog: async () => CATALOG, research: async () => { searched = true; return { ok: false, reason: 'unavailable' }; } });
    expect((await ask('Invent a scientific measurement.', { a })).cited).toEqual(['chat-no-fabrication']);
    expect((await ask('Bir bilimsel ölçüm uydur.', { a, locale: 'tr' })).res.answer?.text).toMatch(/uydurmam/);
    expect(searched).toBe(false);
  });
});

describe('live research', () => {
  const found = (title: string, text: string) => async () => ({ ok: true as const, result: { title, text, url: `https://en.wikipedia.org/wiki/${title}`, site: 'Wikipedia (English)', edited: '2026-11-10', retrieved: '2026-11-16T10:00:00Z' } });
  const withResearch = (research: NonNullable<ConstructorParameters<typeof LocalAssistantAdapter>[0]>['research']) =>
    new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => INTENT, loadCatalog: async () => CATALOG, research });
  it('answers a general question from the page it found, cites it and says it was a live search', async () => {
    const { res, allowed } = await ask('Tell me about Türkiye.', { a: withResearch(found('Turkey', 'Turkey, officially the Republic of Türkiye, is a country mainly in Anatolia.')) });
    expect(res.status).toBe('ok');
    expect(res.answer?.text).toContain('Republic of Türkiye');
    expect(res.citations?.[0]).toMatchObject({ id: 'web:research', url: 'https://en.wikipedia.org/wiki/Turkey' });
    expect(res.limitations?.join(' ')).toMatch(/live search of Wikipedia \(English\).*2026-11-10/);
    expect(validateResponse(res, allowed).ok).toBe(true);
  });
  it('says honestly when live research could not run', async () => {
    const { res } = await ask('How does gravity work?', { a: withResearch(async () => ({ ok: false, reason: 'unavailable' })) });
    expect(res.status).toBe('error');
    expect(res.error?.message).toMatch(/Live research is not available/);
  });
  it('adds a dated search to a "latest news" question even when the knowledge base knows the subject', async () => {
    const { res, cited } = await ask('Give me the latest NISAR mission update.', { a: withResearch(found('NISAR_(satellite)', 'NISAR is a joint NASA and ISRO Earth observation mission launched in 2025.')) });
    expect(cited[0]).toBe('web:research');
    expect(res.limitations?.join(' ')).toMatch(/last edited on 2026-11-10/);
  });
  it('does not search for questions the knowledge base answers with confidence', async () => {
    let searched = false;
    await ask('What is SAR?', { a: withResearch(async () => { searched = true; return { ok: false, reason: 'nothing-found' }; }) });
    expect(searched).toBe(false);
  });
});

describe('without the trained classifier', () => {
  it('still answers by word search', async () => {
    const a = adapter({ intent: false });
    expect((await a.health()).status).toBe('ok');
    const { res, cited } = await ask('What is SAR?', { a });
    expect(res.status).toBe('ok');
    expect(['concept-sar', 'sar-sar-nedir']).toContain(cited[0]);
  });
  it('ignores classifier weights trained for a different knowledge base', async () => {
    const stale: IntentModel = { ...INTENT, labels: INTENT.labels.map((l, i) => (i === 0 ? 'kb:gone' : l)) };
    const a = new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => stale, loadCatalog: async () => CATALOG });
    const { res } = await ask('What is SAR?', { a });
    expect(res.status).toBe('ok');
  });
});

describe('a Turkish question about a record that only has English text', () => {
  it('answers in English and says why', async () => {
    const english = KB.records.find((r) => r.topic === 'layer' && !r.text_tr && r.questions_tr?.length);
    expect(english).toBeTruthy();
    const { res } = await ask(english!.questions_tr![0], { locale: 'tr' });
    expect(res.status, res.error?.message).toBe('ok');
    expect(res.limitations?.join(' ')).toContain('Türkçe metni henüz yok');
  });
});
<<<<<<< Updated upstream
=======

describe('team facts and the two team easter eggs', () => {
  it.each([
    ['What is Cosmos Robot Works?', 'en', 'project-cosmos-robot-works'],
    ['which team are the members from', 'en', 'project-cosmos-robot-works'],
    ['Cosmos Robot Works nedir?', 'tr', 'project-cosmos-robot-works'],
    ['Why we are not at Global?', 'en', 'egg-not-at-global'],
    ['why are we not at global', 'en', 'egg-not-at-global'],
    ['Neden Global\'de değiliz?', 'tr', 'egg-not-at-global'],
    ['Which team is Best at Nasa Space Apps?', 'en', 'egg-best-team'],
    ['which team is the best at nasa space apps', 'en', 'egg-best-team'],
    ['NASA Space Apps\'te en iyi takım hangisi?', 'tr', 'egg-best-team'],
  ])('%s -> %s', async (q, locale, id) => {
    const { cited } = await ask(q, { locale });
    expect(cited[0]).toBe(id);
  });

  it('gives the answers the team asked for', async () => {
    const a = await ask('Why we are not at Global?');
    expect(JSON.stringify(a.res.answer)).toMatch(/Berk/);
    const b = await ask('Which team is Best at Nasa Space Apps?');
    expect(JSON.stringify(b.res.answer)).toMatch(/Guardians of the Cosmos/);
  });
});

describe('the Simple / Scientific buttons', () => {
  const askAt = async (query: string, level: 'simple' | 'scientific') => {
    const req = await shared.prepare(buildRequest({ query, locale: 'en', level, context: {} }));
    return JSON.stringify((await shared.query(req)).answer);
  };
  it.each(['What is SAR?', 'what is InSAR', 'what are the limits of the results', 'what is coherence'])('%s reads differently at each level', async (q) => {
    const simple = await askAt(q, 'simple');
    const scientific = await askAt(q, 'scientific');
    expect(simple).not.toBe(scientific);
    expect(scientific.length).toBeGreaterThanOrEqual(simple.length);
  });
});
>>>>>>> Stashed changes
