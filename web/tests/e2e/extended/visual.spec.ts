// New spec. Behaviour under test: visual regression of the non-WebGL UI (intro panel, filter rail, layers panel,
// investigation panel, timeline) on desktop and 375x812. Map canvases / imagery are masked because software GL is not
// pixel-stable. Per the user's instruction "debug all code with zillion different type tests".
// Baselines live next to this file (visual.spec.ts-snapshots). Update deliberately with: npx playwright test extended/visual --update-snapshots
import type { Locator, Page } from '@playwright/test';
import { appReady, expect, openInvestigation, stubExternal, test } from './helpers';

const SHOT = { animations: 'disabled' as const, caret: 'hide' as const, maxDiffPixelRatio: 0.015 };
const masks = (p: Page): Locator[] => [p.locator('canvas'), p.locator('.maplibregl-map'), p.locator('.panel img'), p.locator('.maplibregl-ctrl')];

async function settle(page: Page) {
  await stubExternal(page);
  await appReady(page);
  await page.evaluate(() => document.fonts.ready);
}

test.describe('visual: desktop 1440x900', () => {
  test('intro panel', async ({ page }) => {
    await settle(page);
    await expect(page.locator('section[aria-label="About Global SAR"]')).toHaveScreenshot('desktop-intro.png', { ...SHOT, mask: masks(page) });
  });

  test('filter rail (categories, catalogs, years, investigations list)', async ({ page }) => {
    await settle(page);
    const rail = page.locator('aside[aria-label="Map filters"]');
    await expect(rail.locator('label', { hasText: /Tsunamis since 1900/ }).locator('.count')).toHaveText(/^\d+$/);
    await expect(rail).toHaveScreenshot('desktop-filter-rail.png', { ...SHOT, mask: masks(page) });
  });

  test('filter rail with a group expanded', async ({ page }) => {
    await settle(page);
    const rail = page.locator('aside[aria-label="Map filters"]');
    await rail.getByRole('button', { name: /Show Geohazards types/ }).click();
    await expect(rail.locator('.subcats')).toBeVisible();
    await expect(rail.locator('label', { hasText: /Tsunamis since 1900/ }).locator('.count')).toHaveText(/^\d+$/);
    await expect(rail).toHaveScreenshot('desktop-filter-rail-expanded.png', { ...SHOT, mask: masks(page) });
  });

  test('satellite layers panel', async ({ page }) => {
    await settle(page);
    await page.getByRole('button', { name: /Satellite layers/ }).click();
    const panel = page.getByRole('complementary', { name: 'Satellite layers' });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveScreenshot('desktop-layers-panel.png', { ...SHOT, mask: masks(page) });
  });

  test('top toolbar (search + tool buttons)', async ({ page }) => {
    await settle(page);
    const bar = page.locator('.search').locator('xpath=..');
    await expect(bar).toHaveScreenshot('desktop-toolbar.png', { ...SHOT, mask: masks(page) });
  });

  test('investigation panel (Venezuela) with assistant in the not-connected state', async ({ page }) => {
    await settle(page);
    await openInvestigation(page, /Venezuela earthquakes/);
    await expect(page.locator('section.asst').getByRole('heading', { name: 'Assistant not connected' })).toBeVisible();
    await expect(page.locator('section.panel[aria-label$="investigation"]')).toHaveScreenshot('desktop-investigation-panel.png', { ...SHOT, mask: masks(page) });
  });

  test('observation timeline', async ({ page }) => {
    await settle(page);
    await openInvestigation(page, /Venezuela earthquakes/);
    await expect(page.getByRole('group', { name: 'Observation timeline' })).toHaveScreenshot('desktop-timeline.png', { ...SHOT, mask: masks(page) });
  });

  test('whole page with the map masked (layout regression, landing)', async ({ page }) => {
    await settle(page);
    await expect(page.locator('aside[aria-label="Map filters"] label', { hasText: /Tsunamis since 1900/ }).locator('.count')).toHaveText(/^\d+$/);
    await expect(page).toHaveScreenshot('desktop-landing-masked.png', { ...SHOT, mask: [...masks(page), page.locator('.maps')], maxDiffPixelRatio: 0.02 });
  });
});

test.describe('visual: mobile 375x812', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('landing: intro sheet and toolbar', async ({ page }) => {
    await settle(page);
    await expect(page.locator('section[aria-label="About Global SAR"]')).toHaveScreenshot('mobile-intro.png', { ...SHOT, mask: masks(page) });
  });

  test('filter rail opened with the Filters button', async ({ page }) => {
    await settle(page);
    await page.getByRole('button', { name: 'Filters' }).click();
    const rail = page.locator('aside[aria-label="Map filters"]');
    await expect(rail).toHaveClass(/open/);
    await expect(rail.locator('label', { hasText: /Tsunamis since 1900/ }).locator('.count')).toHaveText(/^\d+$/);
    await expect(rail).toHaveScreenshot('mobile-filter-rail.png', { ...SHOT, mask: masks(page) });
  });

  test('investigation sheet', async ({ page }) => {
    await settle(page);
    await page.locator('section[aria-label="About Global SAR"] button.obs', { hasText: /Venezuela/ }).click();
    const p = page.locator('section.panel[aria-label$="investigation"]');
    await expect(p).toBeVisible();
    await expect(p.locator('section.asst').getByRole('heading', { name: 'Assistant not connected' })).toBeAttached();
    await expect(p).toHaveScreenshot('mobile-investigation-sheet.png', { ...SHOT, mask: masks(page) });
  });

  test('whole page with the map masked (layout regression, landing)', async ({ page }) => {
    await settle(page);
    await expect(page).toHaveScreenshot('mobile-landing-masked.png', { ...SHOT, mask: [...masks(page), page.locator('.maps')], maxDiffPixelRatio: 0.02 });
  });
});
