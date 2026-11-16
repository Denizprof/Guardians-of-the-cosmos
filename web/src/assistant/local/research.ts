// Live research for questions the knowledge base does not cover ("Tell me about Türkiye", "How does gravity
// work?"). It searches Wikipedia from the visitor's browser (the public API allows that with origin=*), reads the
// summary of the best page and returns it with its address and dates, so the answer can cite it.
//
// Nothing is invented here: the text is the page's own summary. When the search fails or finds nothing, the caller
// is told so, and says so to the user.
import { fold, type Lang } from './core';

export interface ResearchResult {
  title: string;
  /** The page's own summary. */
  text: string;
  url: string;
  /** Which site was searched, for the citation label, e.g. "Wikipedia (English)". */
  site: string;
  /** When the page was last edited (ISO date), when the site reports it. */
  edited?: string;
  /** When this search was made (ISO date-time). */
  retrieved: string;
}

export type ResearchOutcome = { ok: true; result: ResearchResult } | { ok: false; reason: 'nothing-found' | 'unavailable' };
export type Research = (question: string, lang: Lang, signal?: AbortSignal) => Promise<ResearchOutcome>;

const TIMEOUT_MS = 8000;
const SITE: Record<Lang, string> = { en: 'Wikipedia (English)', tr: 'Vikipedi (Türkçe)' };

// The question's asking words are dropped so the search is about the subject ("Tell me about Türkiye" -> "Türkiye").
const ASKING = new RegExp(
  '^(?:' +
    [
      '(?:write|say|type|please)', 'give me (?:some )?(?:info|information|details) (?:about|on)', '(?:give )?(?:some )?(?:info|information|details|facts) (?:about|on)', 'tell me (?:a little |something )?about', 'what (?:is|are|was|were)', 'who (?:is|was|are|were)', 'where is', 'explain(?: to me)?', 'describe',
      'how (?:does|do|did)', 'how', 'give me(?: the)?', 'can you (?:tell me about|explain)', 'i want to know about', 'what do you know about', 'information about',
      'bana', 'hakkinda bilgi ver', 'nedir', 'kimdir', 'anlat',
    ].join('|') +
    ')\\s+',
  'i',
);
/** News words: they say what kind of answer is wanted, not what it is about ("latest NISAR mission update" -> "NISAR mission"). */
const NEWS = /\b(?:latest|newest|most recent|recent|current|update|updates|news|status|today|son durum|guncel|en son|son|haberler|haber)\b/gi;
const TRAILING = /\s+(?:hakkinda(?: bilgi)?(?: ver)?|nedir|kimdir|nasil calisir|anlat|work|works)\s*$/i;

/** The search words for a question: its subject, without the asking words. fold() keeps the length of
 *  Turkish text the same, so positions found in the folded text cut the original text correctly. */
export function searchTerms(question: string): string {
  let q = question.trim().replace(/[?!.]+$/, '');
  for (let i = 0; i < 3; i++) {
    const m = ASKING.exec(fold(q));
    if (!m) break;
    q = q.slice(m[0].length);
  }
  const t = TRAILING.exec(fold(q));
  if (t && t.index > 0) q = q.slice(0, t.index);
  const withoutNews = q.replace(NEWS, ' ').replace(/\s+/g, ' ').trim();
  if (withoutNews.length >= 3) q = withoutNews;
  return q.replace(/^(?:the|a|an)\s+/i, '').trim() || question.trim();
}

async function getJson(url: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface SearchJson { query?: { search?: { title?: unknown }[] } }
interface SummaryJson { title?: unknown; extract?: unknown; timestamp?: unknown; type?: unknown; content_urls?: { desktop?: { page?: unknown } } }

async function searchOne(terms: string, lang: Lang, signal: AbortSignal, fetchImpl: typeof fetch, verify: boolean): Promise<ResearchResult | undefined> {
  const host = `https://${lang}.wikipedia.org`;
  // A subject that is itself a page title ("Turkey", "Istanbul", "Moon") is read directly: the site follows redirects,
  // and a text search would rank sub-pages ("Demographics of Turkey") above the page itself.
  const direct = terms.trim().replace(/^./, (c) => c.toUpperCase());
  const first = await getJson(`${host}/api/rest_v1/page/summary/${encodeURIComponent(direct.replace(/ /g, '_'))}`, signal, fetchImpl).catch(() => undefined) as SummaryJson | undefined;
  if (first && first.type !== 'disambiguation' && typeof first.extract === 'string' && first.extract.length >= 40) {
    const url = first.content_urls?.desktop?.page;
    return {
      title: typeof first.title === 'string' ? first.title : direct,
      text: first.extract.replace(/\s+/g, ' ').trim(),
      url: typeof url === 'string' && /^https:\/\/[a-z]+\.wikipedia\.org\//.test(url) ? url : `${host}/wiki/${encodeURIComponent(direct.replace(/ /g, '_'))}`,
      site: SITE[lang],
      ...(typeof first.timestamp === 'string' ? { edited: first.timestamp.slice(0, 10) } : {}),
      retrieved: new Date().toISOString(),
    };
  }
  const q = new URLSearchParams({ action: 'query', list: 'search', srsearch: terms, srlimit: '3', format: 'json', origin: '*' });
  const found = (await getJson(`${host}/w/api.php?${q}`, signal, fetchImpl)) as SearchJson;
  const titles = (found.query?.search ?? []).map((s) => s.title).filter((t): t is string => typeof t === 'string');
  for (const title of titles) {
    const page = encodeURIComponent(title.replace(/ /g, '_'));
    const s = (await getJson(`${host}/api/rest_v1/page/summary/${page}`, signal, fetchImpl)) as SummaryJson;
    if (s.type === 'disambiguation' || typeof s.extract !== 'string' || s.extract.length < 40) continue;
    // verify: the page must be about the subject, sharing at least one of its words, or it is not an answer (not
    // possible across languages: a Turkish subject's words do not appear in the English page)
    const about = fold(`${typeof s.title === 'string' ? s.title : title} ${s.extract}`);
    const words = fold(terms).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (verify && words.length && !words.some((w) => about.includes(w.length > 5 ? w.slice(0, w.length - 2) : w))) continue;
    const url = s.content_urls?.desktop?.page;
    return {
      title: typeof s.title === 'string' ? s.title : title,
      text: s.extract.replace(/\s+/g, ' ').trim(),
      url: typeof url === 'string' && /^https:\/\/[a-z]+\.wikipedia\.org\//.test(url) ? url : `${host}/wiki/${page}`,
      site: SITE[lang],
      ...(typeof s.timestamp === 'string' ? { edited: s.timestamp.slice(0, 10) } : {}),
      retrieved: new Date().toISOString(),
    };
  }
  return undefined;
}

/** Search Wikipedia in the question's language, then in English. */
export function createWikipediaResearch(fetchImpl: typeof fetch = (...a) => fetch(...a)): Research {
  return async (question, lang, outer) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const stop = () => ac.abort();
    outer?.addEventListener('abort', stop, { once: true });
    try {
      const terms = searchTerms(question);
      for (const l of lang === 'tr' ? (['tr', 'en'] as const) : (['en'] as const)) {
        const r = await searchOne(terms, l, ac.signal, fetchImpl, l === lang);
        if (r) return { ok: true, result: r };
      }
      return { ok: false, reason: 'nothing-found' };
    } catch {
      if (outer?.aborted) throw new DOMException('Aborted', 'AbortError');
      return { ok: false, reason: 'unavailable' };
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', stop);
    }
  };
}
