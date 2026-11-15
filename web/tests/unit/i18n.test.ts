import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLang, mapNameExpression, setLang, translate } from '../../src/i18n';
import { TR } from '../../src/i18n/tr';
import { startDomTranslation } from '../../src/i18n/dom';
import { EVENT_CONTENT } from '../../src/content/explain';

afterEach(() => {
  setLang('en');
  vi.unstubAllEnvs();
});

describe('translate', () => {
  it('leaves English untouched when EN is selected', () => {
    expect(translate('Investigations', 'en')).toBe('Investigations');
  });

  it('translates exact entries and keeps surrounding whitespace', () => {
    expect(translate('Investigations', 'tr')).toBe('Araştırmalar');
    expect(translate('  Satellite layers ', 'tr')).toBe('  Uydu katmanları ');
  });

  it('collapses inner whitespace before looking a string up', () => {
    expect(translate('Satellite\n      layers', 'tr')).toBe('Uydu katmanları');
  });

  it('applies number patterns and translates the names inside them', () => {
    expect(translate('4 NISAR layers', 'tr')).toBe('4 NISAR katmanı');
    expect(translate('11 observations of Krasheninnikov volcano', 'tr')).toBe('Krasheninnikov yanardağı: 11 gözlem');
    expect(translate('About Daily snow cover (MODIS Terra NDSI)', 'tr')).toBe('Günlük kar örtüsü (MODIS Terra NDSI) hakkında');
  });

  it('translates month names in dates and axis labels', () => {
    expect(translate('24 Jun 2026', 'tr')).toBe('24 Haz 2026');
    expect(translate('Oct 26', 'tr')).toBe('Eki 26');
  });

  it('shows Turkey as Türkiye', () => {
    expect(translate('city · Istanbul, Turkey', 'tr')).toBe('şehir · Istanbul, Türkiye');
  });

  it('keeps unknown text in English instead of blanking it', () => {
    expect(translate('NISAR_L2_PR_GCOV_009', 'tr')).toBe('NISAR_L2_PR_GCOV_009');
  });

  it('has no empty translations', () => {
    for (const [en, tr] of Object.entries(TR)) expect(tr.trim().length, en).toBeGreaterThan(0);
  });
});

describe('map labels', () => {
  it('uses Türkiye in English and Turkish names in Turkish', () => {
    expect(JSON.stringify(mapNameExpression('en'))).toContain('Türkiye');
    expect(JSON.stringify(mapNameExpression('tr'))).toContain('name:tr');
  });
});

describe('page translation', () => {
  it('switches rendered text to Turkish and restores the English exactly', async () => {
    document.body.innerHTML = '<div id="t"><button aria-label="Close panel">Investigations</button><span data-no-i18n>Investigations</span></div>';
    startDomTranslation(document.body);
    expect(getLang()).toBe('en');
    setLang('tr');
    const btn = document.querySelector('button')!;
    expect(btn.textContent).toBe('Araştırmalar');
    expect(btn.getAttribute('aria-label')).toBe('Paneli kapat');
    expect(document.querySelector('span')!.textContent).toBe('Investigations');
    expect(document.documentElement.lang).toBe('tr');

    // React writes new English text: it is translated too
    btn.firstChild!.nodeValue = 'Filters';
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.textContent).toBe('Filtreler');

    setLang('en');
    expect(btn.textContent).toBe('Filters');
    expect(btn.getAttribute('aria-label')).toBe('Close panel');
  });
});

describe('free text is not rewritten', () => {
  it('does not read inherited object members as translations', () => {
    for (const k of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) expect(translate(k, 'tr'), k).toBe(k);
    expect(translate('About constructor', 'tr')).toBe('About constructor');
    expect(translate('toString investigation', 'tr')).toBe('toString investigation');
    expect(translate('Colour legend: constructor', 'tr')).toBe('Renk açıklaması: constructor');
  });

  it('applies the label rules only to known titles, not to sentences', () => {
    const free = [
      'About 45 cm of line-of-sight motion away from the satellite',
      'I asked about the Krasheninnikov volcano investigation',
      '3 observations of the flood',
    ];
    for (const s of free) expect(translate(s, 'tr'), s).toBe(s);
    expect(translate('Krasheninnikov volcano investigation', 'tr')).toBe('Krasheninnikov yanardağı araştırması');
  });

  it('leaves a one-word message that names an object member unchanged on the page', async () => {
    startDomTranslation(document.body);
    setLang('tr');
    const el = document.createElement('div');
    el.className = 'asst-text';
    el.textContent = 'constructor';
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));
    expect(el.textContent).toBe('constructor');
    el.remove();
  });
});

describe('missing-translation log', () => {
  const g = globalThis as { __i18nMissing?: Set<string> };

  it('is capped', () => {
    delete g.__i18nMissing;
    for (let i = 0; i < 1000; i++) translate(`zz unknown ${i}`, 'tr');
    expect(g.__i18nMissing!.size).toBeGreaterThan(0);
    expect(g.__i18nMissing!.size).toBeLessThanOrEqual(500);
  });

  it('keeps nothing outside development', () => {
    vi.stubEnv('DEV', false);
    delete g.__i18nMissing;
    expect(translate('Some unknown sentence', 'tr')).toBe('Some unknown sentence');
    expect(g.__i18nMissing).toBeUndefined();
  });
});

describe('Krasheninnikov text matches the shipped passes', () => {
  const data = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/events.json'), 'utf8')) as {
    events: { id: string; layers: { id: string; acquisition: { start: string } }[] }[];
  };
  const days = data.events
    .find((e) => e.id === 'krasheninnikov-2026')!
    .layers.filter((l) => l.id.startsWith('gcov_'))
    .map((l) => Math.floor(Date.parse(l.acquisition.start) / 86_400_000))
    .sort((a, b) => a - b);
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  const text = EVENT_CONTENT['krasheninnikov-2026'].readSimple[0];
  const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen'];

  it('states the real number of passes', () => {
    expect(text.startsWith(`${WORDS[days.length]} NISAR passes`)).toBe(true);
  });

  it('names every interval that is not 12 days', () => {
    const odd = [...new Set(gaps.filter((g2) => g2 !== 12))];
    if (odd.length === 0) return;
    expect(text).not.toMatch(/orbit, 12 days apart, from/);
    for (const g2 of odd) expect(text).toContain(`${g2}-day gap`);
  });

  it('has a Turkish entry for the exact English sentence', () => {
    expect(translate(text, 'tr')).not.toBe(text);
    for (const g2 of gaps.filter((x) => x !== 12)) expect(translate(text, 'tr')).toContain(`${g2} gün`);
  });
});
