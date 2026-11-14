import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { appReady, expect, featured, panel, test } from './fixtures';

/**
 * Accessibility audit with axe-core (WCAG 2.0/2.1/2.2 A + AA + best-practice tags).
 * Policy requested by QA: report everything, FAIL only on `critical` violations.
 * Every run writes the full list to test-results/axe-<name>.json for docs/qa.
 */
const OUT = path.resolve(__dirname, '../../test-results');

async function audit(page: Page, name: string) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  fs.mkdirSync(OUT, { recursive: true });
  const slim = res.violations.map((v) => ({
    id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
  fs.writeFileSync(path.join(OUT, `axe-${name}.json`), JSON.stringify(slim, null, 2));
  test.info().annotations.push({ type: 'axe', description: slim.map((v) => `${v.impact}:${v.id}(${v.nodes})`).join(', ') || 'no violations' });
  const critical = slim.filter((v) => v.impact === 'critical');
  expect(critical, `critical axe violations on ${name}: ${JSON.stringify(critical, null, 1)}`).toEqual([]);
  return slim;
}

test.describe('accessibility (axe-core)', () => {
  test('landing page: no critical violations', async ({ page }) => {
    await appReady(page);
    await page.waitForTimeout(1500);
    await audit(page, 'landing');
  });

  test('investigation panel (Venezuela): no critical violations', async ({ page }) => {
    await appReady(page);
    await featured(page, /Venezuela/).click();
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(1500);
    await audit(page, 'venezuela');
  });

  test('investigation panel (Limpopo, overlay mode): no critical violations', async ({ page }) => {
    await page.goto('/#/e/mozambique-floods-2026?mode=overlay');
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(1500);
    await audit(page, 'limpopo-overlay');
  });

  test('search results listbox: no critical violations', async ({ page }) => {
    await appReady(page);
    await page.getByRole('combobox', { name: /Search places/ }).fill('flood');
    await expect(page.getByRole('listbox')).toBeVisible();
    await audit(page, 'search-open');
  });

  test('keyboard: Tab reaches the search box and the investigation list', async ({ page }) => {
    await appReady(page);
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      seen.push(
        await page.evaluate(() => {
          const e = document.activeElement as HTMLElement;
          return `${e.tagName}:${e.getAttribute('aria-label') || e.textContent?.trim().slice(0, 80) || ''}`; // 80: a strip card reads "<category><date><title>...", the title is not in the first 30 chars
        }),
      );
    }
    expect(seen.some((s) => /Search places/.test(s))).toBe(true);
    expect(seen.some((s) => /Venezuela earthquakes/.test(s))).toBe(true);
  });

  test('every visible interactive control has an accessible name', async ({ page }) => {
    await appReady(page);
    await featured(page, /Limpopo/).click();
    await expect(panel(page)).toBeVisible();
    const unnamed = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, [role=button], [role=slider], select, input, a[href]')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const name =
          el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent?.trim() ||
          (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || el.getAttribute('title');
        if (!name) out.push(el.outerHTML.slice(0, 120));
      }
      return out;
    });
    expect(unnamed).toEqual([]);
  });
});
