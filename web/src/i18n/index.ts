/**
 * EN/TR language support.
 *
 * The app is written in English. Turkish is applied by a translation layer that swaps rendered text
 * (text nodes and a few attributes) for its Turkish entry in `tr.ts`, so components stay unchanged and
 * English remains the default. Anything without a Turkish entry stays in English, never blank.
 */
import { TR, TR_PATTERNS } from './tr';

export type Lang = 'en' | 'tr';
const KEY = 'gsar-lang';

function initialLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (q === 'tr' || q === 'en') return q;
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'tr' || saved === 'en') return saved;
  } catch {
    // storage blocked: fall back to English
  }
  return 'en';
}

let current: Lang = typeof window === 'undefined' ? 'en' : initialLang();
const listeners = new Set<(l: Lang) => void>();

export const getLang = (): Lang => current;

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try {
    window.localStorage.setItem(KEY, l);
  } catch {
    // not persisted; the choice still applies to this visit
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f(l));
}

export function onLangChange(f: (l: Lang) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

const TR_MONTHS: Record<string, string> = {
  Jan: 'Oca', Feb: 'Şub', Mar: 'Mar', Apr: 'Nis', May: 'May', Jun: 'Haz',
  Jul: 'Tem', Aug: 'Ağu', Sep: 'Eyl', Oct: 'Eki', Nov: 'Kas', Dec: 'Ara',
};
const MONTH_RE = /\b(\d{1,2} )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b( ?'?\d{2,4}\b)?/g;

/** Translate one English string into Turkish. Leading/trailing whitespace is kept. Unknown text is returned unchanged. */
export function translate(text: string, lang: Lang = current): string {
  if (lang === 'en' || !text) return text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  const core = m[2].replace(/\s+/g, ' ');
  if (!core) return text;
  let out = TR[core];
  if (out === undefined) {
    for (const [re, rep] of TR_PATTERNS) {
      if (re.test(core)) {
        out = core.replace(re, rep as never);
        break;
      }
    }
  }
  if (out === undefined) {
    // dates and axis labels: "24 Jun 2026", "Jun 26", "31 May"
    const d = core.replace(MONTH_RE, (all, day, mon, yr) => (day || yr ? `${day ?? ''}${TR_MONTHS[mon]}${yr ?? ''}` : all));
    if (d !== core) out = d;
  }
  if (out === undefined) {
    // Untranslated text stays English; collect it so missing entries are easy to find (window.__i18nMissing).
    const w = globalThis as { __i18nMissing?: Set<string> };
    (w.__i18nMissing ??= new Set()).add(core);
    return text;
  }
  return m[1] + out + m[3];
}

/** Map label expression: Turkish names where the tiles have them, else the English one (Türkiye for Turkey). */
export function mapNameExpression(lang: Lang = current): unknown {
  const en = ['match', ['get', 'name_en'], 'Turkey', 'Türkiye', ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']]];
  return lang === 'tr' ? ['coalesce', ['get', 'name:tr'], en] : en;
}
