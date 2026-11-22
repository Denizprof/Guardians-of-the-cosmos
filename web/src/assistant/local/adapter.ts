// The Global SAR assistant. It runs in the visitor's own browser: no server, no account, nothing leaves the device.
//
// How a question is answered:
//   1. understand: core.rank() combines word search with the trained intent classifier and says how sure it is;
//      a follow-up ("and the flood one?", "tell me more") is read together with the previous question;
//   2. gather sources: checked knowledge records (public/data/assistant/kb.json), the items open in the view
//      (assistant/context.ts) and, for questions about events on the map, the catalog snapshot (catalog.ts);
//   3. answer: the text of the best source(s), each marked with its citation, plus follow-up suggestions.
// An answer is always the text of a source. When nothing matches, the assistant says what it can help with instead
// of guessing.
import type { AssistantAdapter, ModelControl } from '../adapter';
import type { Research } from './research';
import { CONTRACT_VERSION, type AssistantRequest, type AssistantResponse, type Citation, type ContextKnowledge, type Health } from '../types';
import { buildIndex, buildMessages, contextSources, detectLang, fold, parseOutput, rank, recordSource, retrieve, simplify, tokens, type ChatMessage, type Hit, type IntentModel, type KbFile, type KbIndex, type Lang, type Ranked, type Source } from './core';
import { answerFromCatalog, catalogIntent, type CatalogFile } from './catalog';
import { simulationAnswer, type Geocoder } from './simulate';
import type { WildfireRunOptions } from '../../sim/wildfireRun';

const CATALOG_ID = 'kb:live-catalog';
/** The knowledge record the classifier picks for questions about events on the map (project.json). */
const CATALOG_RECORD = 'kb:catalog-lookup';
const MAX_SUGGESTIONS = 3;
const MARKER = /\[\[([A-Za-z0-9._:/#-]{1,200})\]\]/g;
/** Words that point at what is on screen ("what is this?", "what does the radar show here?"). */
const DEICTIC = /\b(this|these|here|looking at|shown|am i seeing|viewing|on (?:my|the) screen|see right now|bu|bunu|buna|burada|burasi|gordugum|goruyorum|bakiyorum|ekranda)\b/;
/** "Tell me more": answer the previous question again with what has not been shown yet. */
const MORE = /^(tell me more|more|more details?|more info(rmation)?|go on|continue|keep going|and\??|anything else|what else|explain more|elaborate|daha fazla( bilgi)?( ver)?|devam( et)?|baska|baska ne var|biraz daha( anlat)?|detay ver)[\s?.!]*$/;
/** A question that leans on the one before it ("and the flood?", "why?", "what about its limits?"). */
const LEANS = /^(and|or|but|so|what about|how about|why|how so|really|peki|ya|neden|niye|nasil yani|ve)\b|\b(it|its|that|they|them|those|onun|bunun|onlar)\b/;
/** Where a question with two parts splits ("who built this and what did you find?"). */
const PART_BREAK = /\s+(?:and|also|plus|ve|ayrica)\s+|[?;]\s+(?=\S)/;
/** Greetings and thanks carry no topic word, so word search alone cannot place them: they go straight to their record. */
const SMALL_TALK: [RegExp, string][] = [
  [/^(hi|hello|hey|yo|good (morning|afternoon|evening)|merhaba|merhabalar|selam|selamlar|gunaydin|iyi (gunler|aksamlar))\b[\s!.,]*$/, 'kb:chat-hello'],
  [/^(thanks|thank you|thanks a lot|thank you very much|cheers|ok|okay|ok thanks|cool|nice|great|got it|tesekkurler|tesekkur ederim|cok tesekkurler|sag ol|sag olun|eyvallah|tamam|anladim|super)\b[\s!.,]*$/, 'kb:chat-thanks'],
];
/** A request to make data up ("invent a measurement"), answered with the refusal record, never with research. */
const FABRICATE = /\b(invent|make up|made up|fabricate|fake|falsify|uydur|uydurur|sahte|tahmini bir olcum)\w*\b/;
/** A question that asks for news, which a fixed knowledge base cannot hold: it also gets a live search. */
const LATEST_NEWS = /\b(latest|newest|recent|current|update|updates|news|today|this week|son durum|guncel|en son|haber|haberler|bugun)\b/;
const RESEARCH_ID = 'web:research';
/** "Explain this investigation", "summarise this": a request for the overview of what is open, not one detail. */
const OVERVIEW = /^(?:please |can you |could you )?(?:explain|describe|summari[sz]e|overview|tell me about|what is|aciklar? misin|acikla|anlat|ozetle|nedir)\b[^?.!]*\b(?:this|it|here|investigation|study|event|bu|bunu|arastirma\w*|olay\w*)\b[\s?.!]*$|^(?:bu|bunu) (?:arastirma\w* )?(?:acikla|anlat|ozetle)/;
/** A question that names the app or the assistant ("what is this app?", "bu uygulama nedir?") is about the app,
 *  not about what is on screen. tokens() maps app, website, site, page, tool, uygulama, sayfa... to "app". */
const namesApp =(q: string) => tokens(q).some((x) => x === 'app' || x === 'assistant' || x === 'chatbot' || x === 'asistan');
const pointsAtView = (q: string) => DEICTIC.test(fold(q)) && !namesApp(q);

const TEXT = {
  en: {
    grounded: 'Answered from the Global SAR knowledge base. Open the source to check anything important.',
    view: 'Read from what is open in your view right now.',
    catalog: 'Counted from the event catalog snapshot the map uses; it is not live.',
    closest: "I'm not certain this is what you meant, so this is the closest topic I know. Reword the question or pick a suggestion below for a better match.",
    off: "That one is outside my field. I'm the Global SAR guide: ask me about radar and NISAR, the five investigations, the satellite layers, the events on the map or any tool in this app.",
    none: "I couldn't match that to what I know. Try naming the thing you mean, for example an investigation, a layer or a tool, or pick one of the suggestions.",
    englishOnly: '',
    research: (site: string, edited?: string) => `Found by a live search of ${site} just now${edited ? `; the page was last edited on ${edited}` : ''}. This is general reference material, not checked by the Global SAR team: open the source for anything important.`,
    researchFailed: 'Live research is not available right now (the search service could not be reached), so this answer comes only from the Global SAR knowledge base.',
    researchNothing: 'A live search found no page for this either.',
    kbDown: 'The knowledge base could not be loaded, so I cannot answer right now. Check your connection and try again.',
    model: 'Worded by the Global SAR AI model running in your browser, using only the cited sources. Check the sources for anything important.',
    defaults: ['What is SAR?', 'Which investigations are there?', 'What can you do?'],
    eventDefaults: ['What am I looking at?', 'What does the radar show here?', 'How reliable is this analysis?'],
  },
  tr: {
    grounded: 'Global SAR bilgi tabanından yanıtlandı. Önemli konularda kaynağı açıp kontrol edin.',
    view: 'Şu anda görünümünüzde açık olandan okundu.',
    catalog: 'Haritanın kullandığı olay kataloğu kopyasından sayıldı; canlı değildir.',
    closest: 'Tam olarak bunu mu kastettiğinizden emin değilim; bu, bildiğim en yakın konu. Daha iyi bir eşleşme için soruyu başka sözcüklerle sorun ya da aşağıdaki önerilerden birini seçin.',
    off: 'Bu benim alanımın dışında. Ben Global SAR rehberiyim: bana radarı ve NISAR\'ı, beş araştırmayı, uydu katmanlarını, haritadaki olayları ya da bu uygulamadaki herhangi bir aracı sorabilirsiniz.',
    none: 'Bunu bildiklerimle eşleştiremedim. Kastettiğiniz şeyin adını vermeyi deneyin (örneğin bir araştırma, bir katman ya da bir araç) ya da önerilerden birini seçin.',
    englishOnly: 'Bu konunun Türkçe metni henüz yok; yanıt İngilizce gösteriliyor.',
    research: (site: string, edited?: string) => `Az önce ${site} üzerinde canlı bir aramayla bulundu${edited ? `; sayfa en son ${edited} tarihinde düzenlenmiş` : ''}. Bu, Global SAR ekibinin kontrol etmediği genel bir başvuru kaynağıdır: önemli konularda kaynağı açın.`,
    researchFailed: 'Canlı araştırma şu anda kullanılamıyor (arama servisine ulaşılamadı); bu yüzden bu yanıt yalnızca Global SAR bilgi tabanından geliyor.',
    researchNothing: 'Canlı bir arama da bunun için bir sayfa bulamadı.',
    kbDown: 'Bilgi tabanı yüklenemedi, bu yüzden şu anda yanıt veremiyorum. Bağlantınızı kontrol edip yeniden deneyin.',
    model: 'Tarayıcınızda çalışan Global SAR AI modeli tarafından, yalnızca belirtilen kaynaklar kullanılarak yazıldı. Önemli konularda kaynakları kontrol edin.',
    defaults: ['SAR nedir?', 'Hangi araştırmalar var?', 'Ne yapabilirsin?'],
    eventDefaults: ['Neye bakıyorum?', 'Radar burada ne gösteriyor?', 'Bu analiz ne kadar güvenilir?'],
  },
} as const;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const defaultLoadKb = async (): Promise<KbFile> => {
  const kb = await fetchJson<KbFile>('data/assistant/kb.json');
  if (!kb || !Array.isArray(kb.records) || kb.records.length === 0) throw new Error('file has no records');
  return kb;
};

interface IntentMeta { dim: number; labels: string[]; scale: number; bias: number[] }

/** The trained classifier's weights. They are an improvement, not a requirement: when they cannot be loaded the
 *  assistant still answers by word search, so a failure here must not take the chat down. */
const defaultLoadIntent = async (): Promise<IntentModel | undefined> => {
  const meta = await fetchJson<IntentMeta>('data/assistant/intent.json');
  const res = await fetch('data/assistant/intent.bin');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const weights = new Int8Array(await res.arrayBuffer());
  if (!Array.isArray(meta.labels) || !Array.isArray(meta.bias) || meta.bias.length !== meta.labels.length || !Number.isFinite(meta.scale) || weights.length !== meta.dim * meta.labels.length) throw new Error('classifier files do not match');
  return { dim: meta.dim, labels: meta.labels, scale: meta.scale, bias: meta.bias, weights };
};

const defaultLoadCatalog = (): Promise<CatalogFile> => fetchJson<CatalogFile>('data/context.json');

export interface LocalAdapterOptions {
  loadKb?: () => Promise<KbFile>;
  /** Resolves with undefined (or rejects) when there is no classifier: the assistant then searches by words alone. */
  loadIntent?: () => Promise<IntentModel | undefined>;
  /** The event catalog the map draws. Optional: without it, catalog questions are answered from the knowledge base. */
  loadCatalog?: () => Promise<CatalogFile | undefined>;
  /** Live research for questions outside the knowledge base. Omitted: no research, and the assistant says so. */
  research?: Research | null;
  /** The optional language model that words answers from the sources. Omitted: answers quote the sources. */
  engine?: Engine | null;
  /** Place search for simulation requests that name a place outside the built-in gazetteer. */
  geocode?: Geocoder | null;
  /** Elevation source for flood simulations (default: AWS Terrain Tiles). */
  loadDem?: WildfireRunOptions['demLoader'];
  /** Current surface weather for wildfire simulations (default: Open-Meteo). */
  loadWeather?: WildfireRunOptions['weatherLoader'];
  /** Winds aloft for volcano simulations (default: Open-Meteo forecast). */
  loadWind?: WildfireRunOptions['windLoader'];
  /** Run the Planetary Simulation Lab for "what if" questions (default on). */
  simulate?: boolean;
}

/** An on-device language model. `generate` returns the raw text of one reply. */
export interface Engine {
  control: ModelControl;
  generate(messages: ChatMessage[], signal?: AbortSignal): Promise<string>;
}

type Mode = 'answer' | 'closest' | 'off' | 'none' | 'down';
interface Plan {
  mode: Mode;
  /** How many of the leading knowledge items the answer quotes. */
  quote: number;
  suggestions: string[];
  notes: string[];
  /** The classifier backs the top record, or it belongs to the open investigation: the view must not replace it. */
  sure: boolean;
  /** Said with a decline: what live research did (found nothing, or could not run). */
  researchNote?: string;
}

interface Loaded {
  index: KbIndex;
}

export class LocalAssistantAdapter implements AssistantAdapter {
  readonly model?: ModelControl;
  private engine: Engine | null;
  private research: Research | null;
  private geocode: Geocoder | null;
  private simulate: boolean;
  private loadDem?: WildfireRunOptions['demLoader'];
  private loadWind?: WildfireRunOptions['windLoader'];
  private loadWeather?: WildfireRunOptions['weatherLoader'];
  private loadKb: () => Promise<KbFile>;
  private loadIntent: () => Promise<IntentModel | undefined>;
  private loadCatalog: () => Promise<CatalogFile | undefined>;
  private loaded: Promise<Loaded> | null = null;
  private catalog: Promise<CatalogFile | undefined> | null = null;
  /** What prepare() decided for a request, read back by query(). */
  private plans = new WeakMap<AssistantRequest, Plan>();

  constructor(opts: LocalAdapterOptions = {}) {
    this.loadKb = opts.loadKb ?? defaultLoadKb;
    this.loadIntent = opts.loadIntent ?? defaultLoadIntent;
    this.loadCatalog = opts.loadCatalog ?? defaultLoadCatalog;
    this.research = opts.research ?? null;
    this.engine = opts.engine ?? null;
    this.geocode = opts.geocode ?? null;
    this.simulate = opts.simulate ?? true;
    this.loadDem = opts.loadDem;
    this.loadWind = opts.loadWind;
    this.loadWeather = opts.loadWeather;
    this.model = this.engine?.control;
  }

  private kb(): Promise<Loaded> {
    if (!this.loaded) {
      this.loaded = Promise.all([this.loadKb(), this.loadIntent().catch(() => undefined)]).then(([kb, intent]) => {
        // weights trained for another knowledge base would vote for the wrong records: use them only when they fit
        const ids = new Set(kb.records.map((r) => r.id));
        const fits = !!intent && intent.labels.every((l) => l.startsWith('__') || ids.has(l));
        return { index: buildIndex(kb.records, fits ? intent : undefined) };
      });
      this.loaded.catch(() => { this.loaded = null; }); // a failed load must be retryable
    }
    return this.loaded;
  }

  private events(): Promise<CatalogFile | undefined> {
    if (!this.catalog) {
      this.catalog = this.loadCatalog().then((c) => (c && Array.isArray(c.events) ? c : undefined)).catch(() => undefined);
      void this.catalog.then((c) => { if (!c) this.catalog = null; }); // retry on the next catalog question
    }
    return this.catalog;
  }

  async health(): Promise<Health> {
    try {
      await this.kb();
      return { status: 'ok', model_configured: true, contract_version: CONTRACT_VERSION };
    } catch (e) {
      return { status: 'error', model_configured: false, detail: `The knowledge base could not be loaded (${e instanceof Error ? e.message : 'network error'}).` };
    }
  }

  /** Understand the question, pick its sources and attach them to the request context. */
  async prepare(req: AssistantRequest): Promise<AssistantRequest> {
    let loaded: Loaded;
    try { loaded = await this.kb(); } catch {
      const out = { ...req };
      this.plans.set(out, { mode: 'down', quote: 0, suggestions: [], notes: [], sure: false });
      return out;
    }
    const { index } = loaded;
    const lang = detectLang(req.query, req.locale);
    const t = TEXT[lang];
    const query = req.query.trim();
    // Simulation tool: a "what if" question runs the real engine; its computed numbers are the only source quoted.
    if (this.simulate) {
      const sim = await simulationAnswer(query, lang, req.explanation_level, this.geocode ?? undefined, this.loadDem, this.loadWind, this.loadWeather);
      if (sim) {
        const out: AssistantRequest = { ...req, context: { ...req.context, knowledge: sim.knowledge } };
        this.plans.set(out, { mode: 'answer', quote: 1, suggestions: sim.suggestions, notes: sim.notes, sure: true });
        return out;
      }
    }
    const turns = req.conversation ?? [];
    // the question a follow-up refers to: the last one that was not itself a "tell me more"
    const prevUser = [...turns].reverse().find((x) => x.role === 'user' && !MORE.test(fold(x.content)))?.content;
    // everything already shown in this conversation, so "more" never repeats an answer
    const shown = new Set(turns.filter((x) => x.role === 'assistant').flatMap((x) => [...x.content.matchAll(MARKER)].map((m) => m[1])));
    const smallTalk = SMALL_TALK.find(([re]) => re.test(fold(query)))?.[1];
    const fabricate = FABRICATE.test(fold(query));
    const eventId = req.context.event?.id;
    const knowledge: ContextKnowledge[] = [];
    const notes: string[] = [];
    let researchNote: string | undefined;
    let mode: Mode = 'none';
    let quote = 1;

    let ranked: Ranked = rank(index, query, 4);
    let hits: Hit[] = ranked.hits;
    const pinned = fabricate ? 'kb:chat-no-fabrication' : smallTalk;
    const pinnedDoc = pinned ? index.docs.find((d) => d.record.id === pinned) : undefined;
    if (pinnedDoc) {
      // greetings, thanks and requests to make data up have one right answer, whatever the conversation was about
      hits = [{ record: pinnedDoc.record, score: 0, p: 1 }];
      ranked = { hits, confident: true, offTopic: false };
    } else if (prevUser && MORE.test(fold(query))) {
      // "tell me more": the next records for the previous question, leaving out what was already shown
      const again = rank(index, prevUser, 8);
      hits = again.hits.filter((h) => !shown.has(h.record.id));
      ranked = { hits, confident: hits.length > 0 && again.confident, offTopic: false };
    } else if (prevUser && !ranked.offTopic) {
      // "and the limits?", "why?": a question that leans on the one before it is read together with it, unless the
      // classifier is already sure what it is about ("and what is SAR?")
      const sure = ranked.confident && (ranked.hits[0]?.p ?? 0) >= 0.5;
      const words = tokens(query).length;
      const leans = words > 0 && (LEANS.test(fold(query)) || words <= 2);
      if (!sure && words > 0 && (leans || !ranked.confident)) {
        const joined = rank(index, `${prevUser} ${query}`, 4);
        if (joined.confident) { ranked = joined; hits = joined.hits; }
      }
    }

    let twoParts = false;
    if (!pinnedDoc && !MORE.test(fold(query)) && !/\b(between|difference|differ|versus|vs|compare|both|fark|arasinda)\b/.test(fold(query))) {
      // two questions in one: answer both, when each part on its own clearly has its own record
      const parts = fold(query).split(PART_BREAK).filter((p) => tokens(p).length >= 1);
      if (parts.length === 2) {
        const [a, b] = parts.map((p) => rank(index, p, 1));
        if (a.confident && b.confident && a.hits[0].p >= 0.5 && b.hits[0].p >= 0.5 && a.hits[0].record.id !== b.hits[0].record.id && a.hits[0].record.topic !== 'chat' && b.hits[0].record.topic !== 'chat') {
          hits = [a.hits[0], b.hits[0], ...hits.filter((h) => h.record.id !== a.hits[0].record.id && h.record.id !== b.hits[0].record.id)];
          ranked = { hits, confident: true, offTopic: false };
          twoParts = true;
        }
      }
    }
    // "Who made this?" also says "this", but the classifier knows it is about the project, not the open investigation
    const aboutSomethingElse = ranked.confident && !!hits[0] && hits[0].p >= 0.6 && hits[0].record.topic !== 'investigation';
    if (eventId && pointsAtView(query) && !aboutSomethingElse && !pinnedDoc) {
      // A question about "this" while an investigation is open is about that investigation: use its own records
      // (what the radar shows, the limits of the analysis...), or none, so the open investigation itself answers.
      const prefix = `kb:event-${eventId}-`;
      const own = retrieve(index, query, 200, 0).filter((h) => h.record.id.startsWith(prefix));
      hits = own.filter((h) => h.score >= 1 && h.score >= own[0].score * 0.6).slice(0, 2);
      if (OVERVIEW.test(fold(query))) {
        // "explain this investigation": the overview (what happened, what the radar shows), not one marker on it
        const overview = [`${prefix}happened`, `${prefix}radar`].map((id) => index.docs.find((d) => d.record.id === id)).filter((d) => !!d);
        if (overview.length) hits = overview.map((d) => ({ record: d.record, score: 10, p: 1 }));
      }
      ranked = { hits, confident: hits.length > 0, offTopic: false };
    }

    const file = pinnedDoc ? undefined : await this.catalogFor(query);
    const intent = file ? catalogIntent(query, file) : undefined;
    const wantsCatalog = hits[0]?.record.id === CATALOG_RECORD;
    const kbIsSure = !wantsCatalog && ranked.confident && !!hits[0] && hits[0].p >= (intent?.strength === 2 ? 0.6 : 0.35);
    const fromCatalog = file && intent && intent.strength > 0 && !kbIsSure ? answerFromCatalog(query, file, lang, intent) : undefined;
    // the catalog's own numbers replace the record that only says such a lookup is possible
    if (fromCatalog) hits = hits.filter((h) => h.record.id !== CATALOG_RECORD);
    const top = hits[0];
    if (fromCatalog) {
      knowledge.push({ citation_id: CATALOG_ID, title: 'Events on the map', text: fromCatalog.text.slice(0, 2000), source_label: fromCatalog.sourceLabel, url: fromCatalog.url });
      notes.push(t.catalog);
      mode = 'answer';
    }

    const usable = fromCatalog ? (ranked.confident ? hits.slice(0, 2) : []) : ranked.confident ? hits.slice(0, 3) : ranked.offTopic ? [] : hits.slice(0, 1);
    for (const h of usable) {
      const s = recordSource(h.record, lang, req.explanation_level);
      knowledge.push({ citation_id: s.id, title: h.record.title.slice(0, 300), text: s.text.slice(0, 2000), source_label: h.record.source.label.slice(0, 300), url: h.record.source.url });
    }
    if (!fromCatalog) {
      if (ranked.confident && top) {
        mode = 'answer';
        notes.push(t.grounded);
        // a second record joins the answer only when it is nearly as relevant and says something different
        const second = hits[1];
        if (twoParts) quote = 2;
        else if (second && second.score >= top.score * 0.85 && second.record.topic !== 'chat' && top.record.topic !== 'chat' && overlapShare(top.record.text_en, second.record.text_en) < 0.3) quote = 2;
      } else if (top && !ranked.offTopic) {
        mode = 'closest';
        notes.push(t.closest);
      } else {
        mode = ranked.offTopic ? 'off' : 'none';
      }
    }
    // Live research: for a question the knowledge base cannot answer with confidence (general knowledge such as
    // "Tell me about Türkiye"), and for one that asks for the latest news, which a fixed knowledge base cannot hold.
    const wantsLatest = LATEST_NEWS.test(fold(query));
    // an answer the trained classifier does not back is a guess from shared words ("how does gravity work" shares
    // "how does ... work" with the app's guide): research is the better source for it
    const weak = mode === 'off' || mode === 'none' || (mode === 'closest' && (top?.p ?? 0) < 0.3) || (!!this.research && mode === 'answer' && (top?.p ?? 1) < 0.3);
    const hasView = !!eventId || !!req.context.map_view;
    if (!pinnedDoc && !fromCatalog && !(hasView && pointsAtView(query)) && (weak || wantsLatest)) {
      const found = this.research ? await this.research(query, lang) : { ok: false as const, reason: 'unavailable' as const };
      if (found.ok) {
        const r = found.result;
        const item: ContextKnowledge = { citation_id: RESEARCH_ID, title: r.title.slice(0, 300), text: (req.explanation_level === 'simple' ? simplify(r.text, 3) : r.text).slice(0, 2000), source_label: `${r.site}, retrieved ${r.retrieved.slice(0, 10)}`, url: r.url };
        if (weak) {
          // the unsure guess from the knowledge base is replaced, not shown next to the real answer
          knowledge.splice(0, knowledge.length, item);
          notes.splice(0, notes.length, t.research(r.site, r.edited));
          quote = 1;
        } else {
          knowledge.unshift(item);
          notes.unshift(t.research(r.site, r.edited));
          quote = Math.min(2, knowledge.length);
        }
        mode = 'answer';
      } else if (found.reason === 'unavailable') {
        if (mode === 'answer' || mode === 'closest') notes.push(t.researchFailed);
        else researchNote = t.researchFailed;
      } else if (mode === 'off' || mode === 'none') researchNote = t.researchNothing;
    }
    if (lang === 'tr' && mode !== 'off' && mode !== 'none' && !fromCatalog && top && !top.record.text_tr && knowledge[0]?.citation_id !== RESEARCH_ID) notes.push(t.englishOnly);

    const quoted = new Set(usable.slice(0, quote).map((h) => h.record.id));
    const suggestions = suggest(hits.filter((h) => !quoted.has(h.record.id)), lang, eventId ? t.eventDefaults : t.defaults, MAX_SUGGESTIONS, query);
    const out: AssistantRequest = knowledge.length ? { ...req, context: { ...req.context, knowledge } } : { ...req };
    const researched = knowledge[0]?.citation_id === RESEARCH_ID;
    const sure = researched || !!fromCatalog || (!!top && (top.p >= 0.35 || (!!eventId && top.record.id.startsWith(`kb:event-${eventId}-`))));
    this.plans.set(out, { mode, quote, suggestions, notes, sure, ...(researchNote ? { researchNote } : {}) });
    return out;
  }

  /** The catalog is fetched only for a question that mentions a kind of event or the catalog itself. */
  private async catalogFor(query: string): Promise<CatalogFile | undefined> {
    if (!/\b(earthquakes?|quakes?|seismic|floods?|flooding|fires?|wildfires?|volcan\w*|eruptions?|icebergs?|events?|deprem\w*|sarsinti\w*|sel\w{0,4}|taskin\w*|yangin\w*|yanardag\w*|volkan\w*|patlama\w*|buzdag\w*|olay\w*)\b/.test(fold(query))) return undefined;
    return this.events();
  }

  async query(req: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse> {
    const lang: Lang = detectLang(req.query, req.locale);
    const t = TEXT[lang];
    const kb: Source[] = (req.context.knowledge ?? []).map((k) => ({ id: k.citation_id, text: k.text, label: `${k.title} (${k.source_label})`, url: k.url, type: 'reference' }));
    const view = rankView(contextSources(req.context), req.query, !!req.context.event);
    const plan: Plan = this.plans.get(req) ?? { mode: kb.length ? 'answer' : 'none', quote: 1, suggestions: [...(req.context.event ? t.eventDefaults : t.defaults)], notes: kb.length ? [t.grounded] : [], sure: true };
    if (plan.mode === 'down') return { version: CONTRACT_VERSION, status: 'unavailable', error: { code: 'knowledge_unavailable', message: t.kbDown } };
    const suggestions = plan.suggestions.length ? { suggestions: plan.suggestions } : {};

    // An item of the view may answer only a question that is about the view: one that points at it ("what is
    // this?") or shares a word with it. Otherwise an unrelated question would get the open investigation's
    // description as its "answer".
    const aboutView = view.length > 0 && (pointsAtView(req.query) || viewOverlap(view[0], req.query) > 0);
    // with an investigation open, a question that shares words with it is about it unless the knowledge base is sure
    const useView = !kb.length || ((plan.mode === 'closest' || !plan.sure) && aboutView && !!req.context.event);
    const quoted: Source[] = useView ? (aboutView ? [view[0]] : []) : kb.slice(0, Math.max(1, plan.quote));
    if (!quoted.length) {
      const message = `${plan.mode === 'off' ? t.off : t.none}${plan.researchNote ? ` ${plan.researchNote}` : ''}`;
      return { version: CONTRACT_VERSION, status: 'error', error: { code: 'insufficient_context', message }, ...suggestions };
    }
    const notes = useView ? [t.view] : plan.notes.filter(Boolean);

    // With the language model loaded, it words the answer from the same sources. Its text is shown only when every
    // citation marker names a source it was given; otherwise the sources are quoted as below.
    if (this.engine && this.engine.control.state().phase === 'ready') {
      const given = [...quoted, ...kb.filter((s) => !quoted.includes(s)), ...view.filter((s) => !quoted.includes(s))].slice(0, 5);
      try {
        const parsed = parseOutput(await this.engine.generate(buildMessages(req.query, given, req.explanation_level), signal), given);
        if (parsed.kind === 'answer') {
          return {
            version: CONTRACT_VERSION,
            status: 'ok',
            answer: { text: parsed.text, format: 'plain' },
            citations: parsed.cited.map((id) => toCitation(given.find((s) => s.id === id)!)),
            limitations: [t.model, ...notes.filter((n) => n !== t.grounded)],
            ...suggestions,
          };
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
      }
    }
    return {
      version: CONTRACT_VERSION,
      status: 'ok',
      answer: { text: quoted.map((s) => `${s.text} [[${s.id}]]`).join('\n\n'), format: 'plain' },
      citations: quoted.map(toCitation),
      ...(notes.length ? { limitations: notes } : {}),
      ...suggestions,
    };
  }
}

/** Share of the shorter text's distinct content words that the other text also has. */
function overlapShare(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  if (!small.size) return 1;
  let shared = 0;
  for (const x of small) if (large.has(x)) shared++;
  return shared / small.size;
}

/** Follow-up questions: how the next-best records are usually asked, then general ones. Never the question just asked. */
function suggest(others: Hit[], lang: Lang, defaults: readonly string[], max: number, asked: string): string[] {
  const out: string[] = [];
  const askedFold = fold(asked).replace(/[^a-z0-9]+/g, ' ').trim();
  const push = (q: string | undefined) => {
    if (!q || out.length >= max) return;
    const f = fold(q).replace(/[^a-z0-9]+/g, ' ').trim();
    if (f === askedFold || out.some((o) => fold(o).replace(/[^a-z0-9]+/g, ' ').trim() === f)) return;
    out.push(q.length > 200 ? q.slice(0, 200) : q);
  };
  for (const h of others) {
    if (h.record.topic === 'chat') continue;
    push(lang === 'tr' ? h.record.questions_tr?.[0] : h.record.questions_en[0]);
  }
  for (const d of defaults) push(d);
  return out;
}

/** Order the items of the view by how many words they share with the question; the open investigation stays
 *  first when nothing matches, because "what am I looking at?" shares no words with it. */
function rankView(view: Source[], question: string, hasEvent: boolean): Source[] {
  const q = new Set(tokens(question));
  return view
    .map((s, i) => ({ s, i, overlap: tokens(s.text).filter((x) => q.has(x)).length }))
    .sort((a, b) => b.overlap - a.overlap || Number(b.i === 0 && hasEvent) - Number(a.i === 0 && hasEvent) || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.s);
}

function viewOverlap(source: Source | undefined, question: string): number {
  if (!source) return 0;
  const q = new Set(tokens(question));
  return tokens(source.text).filter((x) => q.has(x)).length;
}

function toCitation(s: Source): Citation {
  return {
    id: s.id,
    type: s.type,
    label: s.label.slice(0, 400),
    ...(s.url ? { url: s.url } : {}),
    ...(s.layer_id ? { layer_id: s.layer_id } : {}),
    ...(s.granule ? { granule: s.granule.slice(0, 300) } : {}),
  };
}
