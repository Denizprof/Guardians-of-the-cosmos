// The chatbot that runs in the visitor's own browser: no server, no account, nothing leaves the device.
//
// It answers from two kinds of sources only: checked knowledge records (public/data/assistant/kb.json) and
// the items of the current view (assistant/context.ts). Two modes, always labelled to the user:
//   - knowledge-base mode: the best matching record is quoted as it is (works everywhere, instantly);
//   - model mode: an on-device language model words the answer from those same sources. Its text is shown
//     only if every citation marker names a source it was given; otherwise it is discarded and the record is
//     quoted instead. The model is never asked anything when there is no source.
import type { AssistantAdapter, ModelControl } from '../adapter';
import { CONTRACT_VERSION, type AssistantRequest, type AssistantResponse, type Citation, type ContextKnowledge, type Health } from '../types';
import {
  buildIndex,
  buildMessages,
  contextSources,
  detectLang,
  fold,
  parseOutput,
  recordSource,
  retrieve,
  tokens,
  type ChatMessage,
  type KbFile,
  type KbIndex,
  type Lang,
  type Parsed,
  type Source,
} from './core';

/** An on-device model. `generate` returns the raw text of one reply. */
export interface Engine {
  control: ModelControl;
  generate(messages: ChatMessage[], signal?: AbortSignal): Promise<string>;
}

const SELF_ID = 'kb:app-assistant';
/** Words that point at what is on screen ("what is this?", "what does the radar show here?"). */
const DEICTIC = /\b(this|these|here|looking at|shown|am i seeing|bu|bunu|buna|burada|burasi|gordugum)\b/;
/** A question that names the app or the assistant ("what is this app?", "bu uygulama nedir?") is about the app,
 *  not about what is on screen. tokens() maps app, website, site, page, tool, uygulama, sayfa... to "app". */
const namesApp = (q: string) => tokens(q).some((x) => x === 'app' || x === 'assistant' || x === 'chatbot' || x === 'asistan');
const pointsAtView = (q: string) => DEICTIC.test(fold(q)) && !namesApp(q);
const GREETING =/^(hi|hello|hey|good (morning|afternoon|evening)|thanks|thank you|merhaba|selam|gunaydin|iyi (gunler|aksamlar)|tesekkurler|tesekkur ederim|sag ol)\b[\s!.,]*$/;

const TEXT = {
  en: {
    none: "I don't have a checked source for that, so I won't guess. I can answer questions about radar (SAR), the NISAR mission, this app's tools, its satellite layers and its investigations.",
    quoted: 'Quoted from the knowledge base as it is written; no AI model worded this answer.',
    model: 'Written by an AI model running in your browser, using only the cited sources. Check the sources for anything important.',
    discarded: "The AI model's answer did not cite its sources correctly and was discarded; this is quoted from the knowledge base instead.",
    failed: 'The AI model could not answer; this is quoted from the knowledge base instead.',
    closest: 'The AI model did not find a clear answer in its sources. This is the closest record in the knowledge base, quoted as it is written; it may not answer your question exactly.',
  },
  tr: {
    none: 'Bunun için kontrol edilmiş bir kaynağım yok, bu yüzden tahmin yürütmeyeceğim. Radar (SAR), NISAR görevi, bu uygulamanın araçları, uydu katmanları ve incelemeleri hakkındaki soruları yanıtlayabilirim.',
    quoted: 'Bilgi tabanından olduğu gibi alıntılandı; bu yanıtı bir yapay zekâ modeli yazmadı.',
    model: 'Tarayıcınızda çalışan bir yapay zekâ modeli tarafından, yalnızca belirtilen kaynaklar kullanılarak yazıldı. Önemli konularda kaynakları kontrol edin.',
    discarded: 'Yapay zekâ modelinin yanıtı kaynaklarını doğru göstermediği için atıldı; bunun yerine bilgi tabanından alıntı yapıldı.',
    failed: 'Yapay zekâ modeli yanıt veremedi; bunun yerine bilgi tabanından alıntı yapıldı.',
    closest: 'Yapay zekâ modeli kaynaklarında net bir yanıt bulamadı. Bu, bilgi tabanındaki en yakın kayıttır ve olduğu gibi alıntılanmıştır; sorunuzu tam olarak yanıtlamayabilir.',
  },
} as const;

const defaultLoadKb = async (): Promise<KbFile> => {
  const res = await fetch('data/assistant/kb.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const kb = (await res.json()) as KbFile;
  if (!kb || !Array.isArray(kb.records) || kb.records.length === 0) throw new Error('file has no records');
  return kb;
};

export interface LocalAdapterOptions {
  loadKb?: () => Promise<KbFile>;
  /** null or omitted: knowledge-base mode only. */
  engine?: Engine | null;
}

export class LocalAssistantAdapter implements AssistantAdapter {
  readonly model?: ModelControl;
  private engine: Engine | null;
  private loadKb: () => Promise<KbFile>;
  private index: Promise<KbIndex> | null = null;

  constructor(opts: LocalAdapterOptions = {}) {
    this.engine = opts.engine ?? null;
    this.model = this.engine?.control;
    this.loadKb = opts.loadKb ?? defaultLoadKb;
  }

  private kb(): Promise<KbIndex> {
    if (!this.index) {
      this.index = this.loadKb().then((kb) => buildIndex(kb.records));
      this.index.catch(() => { this.index = null; }); // a failed load must be retryable
    }
    return this.index;
  }

  async health(): Promise<Health> {
    try {
      await this.kb();
      return { status: 'ok', model_configured: !!this.engine, contract_version: CONTRACT_VERSION };
    } catch (e) {
      return { status: 'error', model_configured: false, detail: `The knowledge base could not be loaded (${e instanceof Error ? e.message : 'network error'}).` };
    }
  }

  /** Retrieve the knowledge records for this question and attach them to the request context. */
  async prepare(req: AssistantRequest): Promise<AssistantRequest> {
    let index: KbIndex;
    try { index = await this.kb(); } catch { return req; }
    const lang = detectLang(req.query, req.locale);
    const greeting = GREETING.test(fold(req.query.trim()));
    let hits = greeting ? index.docs.filter((d) => d.record.id === SELF_ID).map((d) => ({ record: d.record, score: 0 })) : retrieve(index, req.query, 3);
    const eventId = req.context.event?.id;
    if (!greeting && eventId && pointsAtView(req.query)) {
      // A question about "this" while an investigation is open is about that investigation: use its own records
      // (what the radar shows, the limits of the analysis...), or none, so the open investigation itself answers.
      const prefix = `kb:event-${eventId}-`;
      const own = retrieve(index, req.query, 200, 0).filter((h) => h.record.id.startsWith(prefix));
      hits = own.filter((h) => h.score >= 1 && h.score >= own[0].score * 0.6).slice(0, 2);
    }
    if (!hits.length) return req;
    const knowledge: ContextKnowledge[] = hits.map((h) => {
      const s = recordSource(h.record, lang, req.explanation_level);
      return { citation_id: s.id, title: h.record.title.slice(0, 300), text: s.text.slice(0, 2000), source_label: h.record.source.label.slice(0, 300), url: h.record.source.url };
    });
    return { ...req, context: { ...req.context, knowledge } };
  }

  async query(req: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse> {
    const lang: Lang = detectLang(req.query, req.locale);
    const t = TEXT[lang];
    const kb: Source[] = (req.context.knowledge ?? []).map((k) => ({ id: k.citation_id, text: k.text, label: `${k.title} (${k.source_label})`, url: k.url, type: 'reference' }));
    const view = rankView(contextSources(req.context), req.query, !!req.context.event);
    // knowledge records passed a relevance threshold, so they lead; the view fills the rest
    const sources = [...kb, ...view].slice(0, 5);
    const decline = (): AssistantResponse => ({ version: CONTRACT_VERSION, status: 'error', error: { code: 'insufficient_context', message: t.none } });
    if (!sources.length) return decline();

    // Without a model, an item of the view may answer only a question that is about the view: one that points
    // at it ("what is this?") or shares a word with it. Otherwise an unrelated question would get the open
    // investigation's description as its "answer".
    const aboutView = pointsAtView(req.query) ||viewOverlap(view[0], req.query) > 0;
    const quoted = quote(kb, aboutView ? view : []);
    const respond = (p: Parsed, note: string): AssistantResponse => ({
      version: CONTRACT_VERSION,
      status: 'ok',
      answer: { text: p.text, format: 'plain' },
      citations: p.cited.map((id) => toCitation(sources.find((s) => s.id === id)!)),
      limitations: [note],
    });

    if (this.engine && this.engine.control.state().phase === 'ready') {
      let parsed: Parsed;
      try {
        const raw = await this.engine.generate(buildMessages(req.query, sources, req.explanation_level), signal);
        if (debugOn()) console.info(`[assistant] raw model output: ${JSON.stringify(raw)}`);
        parsed = parseOutput(raw, sources);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        return quoted.kind === 'answer' ? respond(quoted, t.failed) : decline();
      }
      if (parsed.kind === 'answer') return respond(parsed, t.model);
      // The fine-tuned model is deliberately cautious and declines about one answerable question in five (see
      // assistant-model/reports). When it declines but a record matched the question, show that record, clearly
      // labelled, rather than nothing: the reader can judge it, and it is exactly what knowledge-base mode shows.
      if (parsed.kind === 'none') return quoted.kind === 'answer' && kb.length ? respond(quoted, t.closest) : decline();
      return quoted.kind === 'answer' ? respond(quoted, t.discarded) : decline();
    }
    return quoted.kind === 'answer' ? respond(quoted, t.quoted) : decline();
  }
}

/** Set localStorage['global-sar.assistant-debug'] = '1' to see the model's raw text in the console (diagnosis only). */
function debugOn(): boolean {
  try { return localStorage.getItem('global-sar.assistant-debug') === '1'; } catch { return false; }
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

/** Knowledge-base mode: quote the best record (it already passed the relevance threshold), or failing that the
 *  most relevant item of the view. */
function quote(kb: Source[], view: Source[]): Parsed {
  const best = kb[0] ?? view[0];
  if (!best) return { kind: 'none', text: '', cited: [] };
  return { kind: 'answer', text: `${best.text} [[${best.id}]]`, cited: [best.id] };
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
