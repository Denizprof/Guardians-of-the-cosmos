import type { CompareMode } from '../types';

// ---- URL state: #/e/<event>?mode=swipe&b=<layer>&a=<layer>&lvl=simple
export function readHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const q = new URLSearchParams(qs || '');
  const m = path.match(/^e\/([\w-]+)/);
  const mode = q.get('mode');
  const lvl = q.get('lvl');
  return {
    event: m?.[1] ?? null,
    // whitelist: an unknown value in a shared link must not leave the UI with no mode
    mode: mode === 'swipe' || mode === 'side' || mode === 'overlay' ? (mode as CompareMode) : null,
    b: q.get('b'),
    a: q.get('a'),
    lvl: lvl === 'simple' || lvl === 'scientific' ? (lvl as 'simple' | 'scientific') : null,
  };
}
