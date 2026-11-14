import { afterEach, describe, expect, it } from 'vitest';
import { getLang, mapNameExpression, setLang, translate } from '../../src/i18n';
import { TR } from '../../src/i18n/tr';
import { startDomTranslation } from '../../src/i18n/dom';

afterEach(() => setLang('en'));

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
