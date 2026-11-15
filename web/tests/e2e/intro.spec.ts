// First visit in a real browser: the front page (components/FrontPage.tsx), then the tool; and the guided
// tour (components/Welcome.tsx), reached from the front page or from About.
// Uses Playwright's own `test`, not ./fixtures: that fixture marks the intro as seen so every other spec starts in the tool.
import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;
const INTRO_SEEN_KEY = 'global-sar.intro-seen';
const front = (page: Page) => page.locator('.front');
const intro = (page: Page) => page.getByRole('dialog', { name: /Global SAR/ });
const ready = (page: Page) => expect(page.locator('.app[data-ready="true"]')).toBeAttached();
const openTour = (page: Page) => front(page).getByRole('button', { name: 'Take the guided tour' }).click();

test.describe('front page', () => {
  test('a first visit shows the front page as a screen of its own; Get started opens the tool, remembers it, and hands it focus', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(front(page)).toBeVisible();
    await expect(front(page).getByRole('heading', { level: 1 })).toHaveText('Watch the surface of the Earth change, through radar.');
    // the tool behind it cannot be reached by keyboard or pointer while the front page is up
    await expect(page.locator('.app')).toHaveAttribute('inert', '');
    expect(await front(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
    // a whole screen: it covers the viewport and nothing of the tool shows through
    const box = await front(page).boundingBox();
    const vp = page.viewportSize()!;
    expect(box).toMatchObject({ x: 0, y: 0, width: vp.width, height: vp.height });

    const start = front(page).getByRole('button', { name: 'Get started' });
    await start.scrollIntoViewIfNeeded();
    await start.click();
    await expect(front(page)).toHaveCount(0);
    await expect(intro(page)).toHaveCount(0);
    await expect(page.locator('.app')).not.toHaveAttribute('inert', '');
    expect(await page.evaluate((k) => localStorage.getItem(k), INTRO_SEEN_KEY)).toBe('3');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.topbar'))).toBe(true);

    await page.reload();
    await ready(page);
    await expect(front(page)).toHaveCount(0);
  });

  test('"Open the app" at the top does the same as Get started', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await front(page).getByRole('button', { name: 'Open the app' }).click();
    await expect(front(page)).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Map tools' })).toBeVisible();
  });

  test('a shared link to an investigation skips the front page and the tour, even on a first visit', async ({ page }) => {
    await page.goto('/#/e/venezuela-2026');
    await ready(page);
    await expect(page.locator('section.panel[aria-label$="investigation"]')).toBeVisible();
    await expect(front(page)).toHaveCount(0);
    await expect(intro(page)).toHaveCount(0);
  });

  test('on a phone the front page fits the screen width and Get started can be reached', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await ready(page);
    await expect(front(page)).toBeVisible();
    expect(await front(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const start = front(page).getByRole('button', { name: 'Get started' });
    await start.scrollIntoViewIfNeeded();
    await expect(start).toBeInViewport();
    expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('the language switch on the front page turns it Turkish', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await front(page).getByRole('button', { name: 'TR' }).click();
    await expect(front(page).getByRole('heading', { level: 1 })).toHaveText('Yeryüzünün değişimini radarla izleyin.');
    await expect(front(page).getByRole('button', { name: 'Başlayın' })).toBeAttached();
  });
});

test.describe('guided tour', () => {
  test('the front page opens the tour; its last step, Get started, closes it and remembers the visit', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await openTour(page);
    await expect(front(page)).toHaveCount(0);
    await expect(intro(page)).toBeVisible();
    await expect(intro(page)).toHaveAttribute('aria-modal', 'true');
    expect(await intro(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);

    for (let i = 0; i < 3; i++) await intro(page).getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Get started' }).click();
    await expect(intro(page)).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), INTRO_SEEN_KEY)).toBe('3');
    // focus is handed over just after the dialog is gone
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.topbar'))).toBe(true);
  });

  test('Escape closes the tour', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await openTour(page);
    await expect(intro(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(intro(page)).toHaveCount(0);
  });

  test('the tour can be reopened from the About panel, and its credits link opens About', async ({ page }) => {
    await page.addInitScript((k) => { try { localStorage.setItem(k, '3'); } catch { /* storage blocked */ } }, INTRO_SEEN_KEY);
    await page.goto('/');
    await ready(page);
    await expect(front(page)).toHaveCount(0);
    await expect(intro(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'About Global SAR' }).click();
    await page.getByRole('button', { name: /Show the introduction again/ }).click();
    await expect(intro(page)).toBeVisible();

    for (let i = 0; i < 3; i++) await intro(page).getByRole('button', { name: 'Next' }).click();
    await intro(page).getByRole('button', { name: /full credits/i }).click();
    await expect(intro(page)).toHaveCount(0);
    await expect(page.locator('section.panel[aria-label="About Global SAR"]')).toBeVisible();
  });

  test('on a phone the tour fits the screen width and its buttons stay in view', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await ready(page);
    const tour = front(page).getByRole('button', { name: 'Take the guided tour' });
    await tour.scrollIntoViewIfNeeded();
    await tour.click();
    await expect(intro(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(intro(page).getByRole('button', { name: 'Next' })).toBeInViewport();
    for (let i = 0; i < 3; i++) await intro(page).getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('button', { name: 'Get started' })).toBeInViewport();
  });

  test('Skip tour closes the tour from the first step', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await openTour(page);
    await intro(page).getByRole('button', { name: 'Skip tour' }).click();
    await expect(intro(page)).toHaveCount(0);
  });
});
