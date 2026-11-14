// Behaviour under test: visual regression of the non-WebGL UI (top bar, investigations strip, filters / layers popovers,
// About and investigation panels, timeline) on desktop and 375x812. Map canvases, the starfield and imagery are masked
// because software GL and live basemap tiles are not pixel-stable. Per the user's instruction
// "debug all code with zillion different type tests".
// Before every screenshot the test asserts there is no `.map-error` banner, so a baseline can never silently
// capture a failure state. Baselines live in visual.spec.ts-snapshots; update deliberately with:
//   npx playwright test extended/visual --update-snapshots   (then LOOK at the images)
import type { Locator, Page } from '@playwright/test';
import { appReady, expect, openInvestigation, stubExternal, test } from './helpers';

const SHOT = { animations: 'disabled' as const, caret: 'hide' as const, maxDiffPixelRatio: 0.015 };
// NOTE: the map canvas is full-bleed BEHIND all UI, so Playwright's `mask` option (which paints over the whole rect) would
// hide the UI itself (an earlier version produced all-magenta baselines). The map, starfield and map controls are instead made
// invisible with CSS, leaving the solid app background behind the UI. That the globe really renders is covered by app.spec.ts.
const HIDE_MAP_CSS = '.maps, canvas.starfield, .maplibregl-map, .maplibregl-ctrl, .maplibregl-canvas { visibility: hidden !important; } .panel img { visibility: hidden !important; }';
const masks = (_p: Page): Locator[] => [];
const toolbar = (p: Page) => p.getByRole('toolbar', { name: 'Map tools' });

async function settle(page: Page) {
  await stubExternal(page);
  await appReady(page);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: HIDE_MAP_CSS });
}
/** Everything that could be mid-transition or failing is settled/absent before the pixels are compared. */
async function stable(page: Page) {
  await expect(page.locator('.map-error')).toHaveCount(0);
  await expect(page.locator('.fatal')).toHaveCount(0);
  // a focus ring that depends on the previous step would make baselines order-dependent
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
const shot = async (page: Page, target: Locator | Page, name: string, extra: Record<string, unknown> = {}) => {
  await stable(page);
  if (target !== (page as unknown)) {
    // wait out CSS transitions (panels / timeline slide in): the box must be identical on 3 consecutive animation frames
    const loc = target as Locator;
    await expect.poll(async () => {
      const boxes: string[] = [];
      for (let i = 0; i < 3; i++) {
        boxes.push(JSON.stringify(await loc.boundingBox()));
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      }
      return new Set(boxes).size;
    }, { message: 'element box never settled' }).toBe(1);
  }
  if (target === (page as unknown)) {
    await expect(page).toHaveScreenshot(name, { ...SHOT, mask: masks(page), ...extra });
  } else {
    // Clip a page screenshot to the (already settled) element box instead of an element screenshot: Playwright's element
    // stability pre-check starves while the hidden maps keep rendering under software GL and times out intermittently.
    const clip = (await (target as Locator).boundingBox())!;
    await expect(page).toHaveScreenshot(name, { ...SHOT, mask: masks(page), clip, ...extra });
  }
};
const counts = async (page: Page) => {
  await expect(page.getByRole('complementary', { name: 'Map filters' }).locator('label', { hasText: /Tsunamis since 1900/ }).locator('.count')).toHaveText(/^\d+$/);
};

test.describe('visual: desktop 1440x900', () => {
  test('top bar', async ({ page }) => {
    await settle(page);
    await shot(page, page.locator('header.topbar'), 'desktop-topbar.png');
  });

  test('investigations strip', async ({ page }) => {
    await settle(page);
    await shot(page, page.getByRole('navigation', { name: 'Investigations' }), 'desktop-strip.png');
  });

  test('filters popover (categories, catalogs, FIRMS snapshot line, years)', async ({ page }) => {
    await settle(page);
    await toolbar(page).getByRole('button', { name: 'Filters' }).click();
    const pop = page.getByRole('complementary', { name: 'Map filters' });
    await counts(page);
    await expect(pop.locator('.catalog-meta')).toBeVisible();
    // the snapshot line contains a build timestamp and a relative-age branch: mask that line (data-dependent, not layout)
    await shot(page, pop, 'desktop-filters-popover.png', { mask: [...masks(page), pop.locator('.catalog-meta')] });
  });

  test('filters popover with a group expanded', async ({ page }) => {
    await settle(page);
    await toolbar(page).getByRole('button', { name: 'Filters' }).click();
    const pop = page.getByRole('complementary', { name: 'Map filters' });
    await pop.getByRole('button', { name: /Show Geohazards types/ }).click();
    await expect(pop.locator('.subcats')).toBeVisible();
    await counts(page);
    await shot(page, pop, 'desktop-filters-expanded.png', { mask: [...masks(page), pop.locator('.catalog-meta')] });
  });

  test('satellite layers popover', async ({ page }) => {
    await settle(page);
    await toolbar(page).getByRole('button', { name: /^Satellite layers/ }).click();
    const pop = page.getByRole('complementary', { name: 'Satellite layers' });
    await expect(pop.getByRole('checkbox').first()).toBeVisible();
    await shot(page, pop, 'desktop-layers-popover.png');
  });

  test('investigations popover', async ({ page }) => {
    await settle(page);
    await toolbar(page).getByRole('button', { name: 'Investigations' }).click();
    await shot(page, page.getByRole('complementary', { name: 'Investigations list' }), 'desktop-investigations-popover.png');
  });

  test('About panel', async ({ page }) => {
    await settle(page);
    await page.getByRole('button', { name: 'About Global SAR' }).click();
    const p = page.locator('section.panel[aria-label="About Global SAR"]');
    await expect(p).toBeVisible();
    // "Data package built <date>" is data, not layout
    await shot(page, p, 'desktop-about-panel.png', { mask: [...masks(page), p.getByText(/Data package built/)] });
  });

  test('investigation panel (Venezuela) with the assistant disclosure collapsed', async ({ page }) => {
    await settle(page);
    await openInvestigation(page, /Venezuela earthquakes/);
    await expect(page.locator('section.panel h2')).toHaveText('Venezuela earthquakes');
    await shot(page, page.locator('section.panel[aria-label$="investigation"]'), 'desktop-investigation-panel.png');
  });

  test('observation timeline', async ({ page }) => {
    await settle(page);
    await openInvestigation(page, /Venezuela earthquakes/);
    // clip instead of an element screenshot: the element-stability pre-check starves while the (hidden) swipe maps keep rendering
    const box = (await page.getByRole('group', { name: 'Observation timeline' }).boundingBox())!;
    await shot(page, page as unknown as Locator, 'desktop-timeline.png', { clip: box });
  });

  test('whole page, map masked (layout regression, landing)', async ({ page }) => {
    await settle(page);
    await shot(page, page as unknown as Locator, 'desktop-landing-masked.png', { mask: [...masks(page)], maxDiffPixelRatio: 0.02 });
  });
});

test.describe('visual: mobile 375x812', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('landing, map masked (icon-only tool buttons, strip)', async ({ page }) => {
    await settle(page);
    await shot(page, page as unknown as Locator, 'mobile-landing-masked.png', { mask: [...masks(page)], maxDiffPixelRatio: 0.02 });
  });

  test('filters popover', async ({ page }) => {
    await settle(page);
    await toolbar(page).getByRole('button', { name: 'Filters' }).click();
    const pop = page.getByRole('complementary', { name: 'Map filters' });
    await counts(page);
    await shot(page, pop, 'mobile-filters-popover.png', { mask: [...masks(page), pop.locator('.catalog-meta')] });
  });

  test('investigation sheet', async ({ page }) => {
    await settle(page);
    await openInvestigation(page, /Venezuela/);
    await expect(page.locator('section.panel h2')).toHaveText('Venezuela earthquakes');
    await shot(page, page.locator('section.panel[aria-label$="investigation"]'), 'mobile-investigation-sheet.png');
  });
});
