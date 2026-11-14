// Introduction screen (components/Welcome.tsx) in a real browser.
// Uses Playwright's own `test`, not ./fixtures: that fixture marks the intro as seen so every other spec starts in the tool.
import { expect, test } from '@playwright/test';

const INTRO_SEEN_KEY = 'global-sar.intro-seen';
const intro = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: /Global SAR/ });
const ready = (page: import('@playwright/test').Page) => expect(page.locator('.app[data-ready="true"]')).toBeVisible();

test.describe('introduction screen', () => {
  test('a first visit shows the intro; Get started closes it, remembers it, and hands focus to the tool', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(intro(page)).toBeVisible();
    await expect(intro(page)).toHaveAttribute('aria-modal', 'true');
    expect(await intro(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await page.getByRole('button', { name: 'Get started' }).click();
    await expect(intro(page)).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), INTRO_SEEN_KEY)).toBe('2');
    expect(await page.evaluate(() => !!document.activeElement && document.activeElement !== document.body)).toBe(true);

    await page.reload();
    await ready(page);
    await expect(intro(page)).toHaveCount(0);
  });

  test('Escape closes the intro', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(intro(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(intro(page)).toHaveCount(0);
  });

  test('a shared link to an investigation skips the intro, even on a first visit', async ({ page }) => {
    await page.goto('/#/e/venezuela-2026');
    await ready(page);
    await expect(page.locator('section.panel[aria-label$="investigation"]')).toBeVisible();
    await expect(intro(page)).toHaveCount(0);
  });

  test('the intro can be reopened from the About panel, and its credits link opens About', async ({ page }) => {
    await page.addInitScript((k) => { try { localStorage.setItem(k, '2'); } catch { /* storage blocked */ } }, INTRO_SEEN_KEY);
    await page.goto('/');
    await ready(page);
    await expect(intro(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'About Global SAR' }).click();
    await page.getByRole('button', { name: /Show the introduction again/ }).click();
    await expect(intro(page)).toBeVisible();

    await intro(page).getByRole('button', { name: /full credits/i }).click();
    await expect(intro(page)).toHaveCount(0);
    await expect(page.locator('section.panel[aria-label="About Global SAR"]')).toBeVisible();
  });

  test('on a phone the intro fits the screen width and Get started is reachable by scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await ready(page);
    await expect(intro(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const start = page.getByRole('button', { name: 'Get started' });
    await start.scrollIntoViewIfNeeded();
    await expect(start).toBeInViewport();
  });
});
