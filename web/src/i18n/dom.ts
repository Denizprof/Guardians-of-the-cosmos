/**
 * Applies the current language to the rendered page.
 *
 * React writes English text; this observer swaps each text node and the attributes below for Turkish when
 * TR is selected, and restores the English it saved when EN is selected again. React never reads text back
 * from the DOM, so when it writes a new English value the observer simply sees a change and translates it.
 * Elements marked `data-no-i18n` (and their children) are left alone.
 */
import { getLang, onLangChange, translate, type Lang } from './index';

const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']);

const textOrig = new WeakMap<Text, { en: string; shown: string }>();
const attrOrig = new WeakMap<Element, Map<string, { en: string; shown: string }>>();

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName) || e.hasAttribute('data-no-i18n') || (e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function doText(node: Text, lang: Lang) {
  const value = node.nodeValue ?? '';
  const rec = textOrig.get(node);
  // React (or anything else) wrote a new value since we last touched it: that is the new English source.
  const en = rec && rec.shown === value ? rec.en : value;
  if (!/[A-Za-z]/.test(en)) return;
  if (skipped(node.parentElement)) return;
  const shown = translate(en, lang);
  textOrig.set(node, { en, shown });
  if (node.nodeValue !== shown) node.nodeValue = shown;
}

function doAttrs(el: Element, lang: Lang) {
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const value = el.getAttribute(a) ?? '';
    let map = attrOrig.get(el);
    const rec = map?.get(a);
    const en = rec && rec.shown === value ? rec.en : value;
    if (!/[A-Za-z]/.test(en) || skipped(el)) continue;
    const shown = translate(en, lang);
    if (!map) attrOrig.set(el, (map = new Map()));
    map.set(a, { en, shown });
    if (value !== shown) el.setAttribute(a, shown);
  }
}

function applyTree(root: Node, lang: Lang) {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text, lang);
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    if (skipped(root as Element)) return;
    doAttrs(root as Element, lang);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) =>
      n.nodeType === Node.ELEMENT_NODE && (SKIP_TAGS.has((n as Element).tagName) || (n as Element).hasAttribute('data-no-i18n'))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text, lang);
    else doAttrs(n as Element, lang);
  }
}

let started = false;

/** Start translating the page. Safe to call more than once. */
export function startDomTranslation(root: HTMLElement = document.body) {
  if (started || typeof MutationObserver === 'undefined') return;
  started = true;
  document.documentElement.lang = getLang();
  const obs = new MutationObserver((records) => {
    const lang = getLang();
    for (const r of records) {
      if (r.type === 'characterData') doText(r.target as Text, lang);
      else if (r.type === 'attributes') doAttrs(r.target as Element, lang);
      else r.addedNodes.forEach((n) => applyTree(n, lang));
    }
  });
  obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  const title = { en: document.title };
  const applyAll = (lang: Lang) => {
    applyTree(root, lang);
    document.title = translate(title.en, lang);
  };
  applyAll(getLang());
  onLangChange(applyAll);
}
