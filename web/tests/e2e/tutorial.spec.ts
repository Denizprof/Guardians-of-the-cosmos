// The interactive tutorial (components/Tutorial.tsx) in a real browser: the visitor does each step in the live
// app and the coach card moves on by itself.
// Uses Playwright's own `test`, not ./fixtures (this spec decides itself whether the visitor is new).
import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;
const INTRO_SEEN_KEY = 'global-sar.intro-seen';
const ready = (page: Page) => expect(page.locator('.app[data-ready="true"]')).toBeAttached();
const card = (page: Page) => page.getByRole('region', { name: 'Interactive tutorial' });
const onStep = (page: Page, title: string) => expect(card(page).getByRole('heading', { level: 2 })).toHaveText(title, { timeout: 15000 });
const seen = (page: Page) => page.addInitScript((k) => { try { localStorage.setItem(k, '3'); } catch { /* storage blocked */ } }, INTRO_SEEN_KEY);

test.describe('interactive tutorial', () => {
  test('from the front page: the visitor uses each tool and the tutorial follows along to the end', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await ready(page);
    const link = page.locator('.front').getByRole('button', { name: 'Take the interactive tutorial' });
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page.locator('.front')).toHaveCount(0);
    await expect(card(page)).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), INTRO_SEEN_KEY)).toBe('3');

    // 1 move the globe: nothing happens until the visitor does it
    await onStep(page, 'Move the globe');
    await page.waitForTimeout(1500);
    await onStep(page, 'Move the globe');
    await page.mouse.move(420, 300);
    await page.mouse.wheel(0, -240);

    // 2 open an investigation: the toolbar button is marked
    await onStep(page, 'Open an investigation');
    await expect(page.locator('[data-tut="investigations"]')).toHaveClass(/tut-target/);
    await page.locator('.inv-strip button').first().click();

    // 3 and 4: inside the panel
    await onStep(page, 'Compare before and after');
    await expect(page.locator('[data-tut="investigations"]')).not.toHaveClass(/tut-target/);
    await page.getByRole('group', { name: 'Comparison mode' }).getByRole('button', { name: 'Side by side' }).click();
    await onStep(page, 'Change the explanation level');
    await page.getByRole('group', { name: 'Explanation level' }).getByRole('button', { name: 'Scientific' }).click();

    // 5 close it
    await onStep(page, 'Close the investigation');
    await page.locator('section.panel').getByRole('button', { name: /^Close/ }).first().click();

    // 6 a satellite layer
    await onStep(page, 'Add a satellite layer');
    await page.locator('[data-tut="layers"]').click();
    await page.getByRole('checkbox', { name: /Farmland and crop types/ }).check();

    // 7 the SAR lens
    await onStep(page, 'Open the SAR lens');
    await page.keyboard.press('Escape'); // close the layers list
    await page.locator('[data-tut="lens"]').click();

    // 8 the coverage probe (close the lens first so the click lands on the globe)
    await onStep(page, 'Probe NISAR coverage');
    await page.locator('[data-tut="lens"]').click();
    await page.locator('[data-tut="probe"]').click();
    // a click in the space round the globe is not a probe, so the point is chosen on the visible globe: it
    // survives the round trip through the map's projection and nothing else covers the map there
    const onGlobe = await page.evaluate(() => {
      const a = (window as any).__gsMaps.a;
      const canvas = a.getCanvas() as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      for (const [dx, dy] of [[0, 0], [-60, 0], [60, 0], [0, -60], [0, 60], [-120, -60], [120, -60], [-120, 60], [120, 60]]) {
        const x = cx + dx;
        const y = cy + dy;
        const back = a.project(a.unproject([x, y]));
        if (Math.hypot(back.x - x, back.y - y) > 1) continue;
        if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) continue;
        return { x: rect.left + x, y: rect.top + y };
      }
      return null;
    });
    expect(onGlobe, 'a free point on the visible globe').not.toBeNull();
    await page.mouse.click(onGlobe!.x, onGlobe!.y);

    // 9 search
    await onStep(page, 'Search for a place');
    const box = page.locator('[data-tut="search"] input');
    await box.fill('41.0, 29.0');
    await box.press('Enter');

    // 10 the assistant
    await onStep(page, 'Ask the assistant');
    await page.locator('[data-tut="ask"]').click();

    await onStep(page, 'Tutorial complete');
    await card(page).getByRole('button', { name: 'Close' }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('.tut-target')).toHaveCount(0);
  });

  test('from About: it can be started again, a step can be skipped, and it can be ended at any time', async ({ page }) => {
    await seen(page);
    await page.goto('/');
    await ready(page);
    await page.getByRole('button', { name: 'About Global SAR' }).click();
    const start = page.getByRole('button', { name: 'Start the interactive tutorial' });
    await start.scrollIntoViewIfNeeded();
    await start.click();
    await onStep(page, 'Move the globe');
    await expect(page.locator('section.panel[aria-label="About Global SAR"]')).toHaveCount(0); // starts on a clean tool
    await card(page).getByRole('button', { name: 'Skip this step' }).click();
    await onStep(page, 'Open an investigation');

    // starting it again from About begins at the first step, on a clean tool
    await page.locator('[data-tut="lens"]').click();
    await page.getByRole('button', { name: 'About Global SAR' }).click();
    await page.getByRole('button', { name: 'Start the interactive tutorial' }).click();
    await onStep(page, 'Move the globe');
    await expect(page.locator('[data-tut="lens"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(card(page).getByRole('heading', { level: 2 })).toBeFocused();

    // going back to the front page ends it; it does not come back by itself
    await page.getByRole('button', { name: 'About Global SAR' }).click();
    await page.getByRole('button', { name: 'Back to the front page' }).click();
    await page.locator('.front').getByRole('button', { name: 'Open the app' }).click();
    await expect(card(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'About Global SAR' }).click();
    await page.getByRole('button', { name: 'Start the interactive tutorial' }).click();
    await card(page).getByRole('button', { name: 'Skip this step' }).click();
    await onStep(page, 'Open an investigation');
    await card(page).getByRole('button', { name: 'End tutorial' }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('.tut-target')).toHaveCount(0);
  });

  test('the tool stays usable under the card: it does not cover the top bar, on a desktop or a phone', async ({ page }) => {
    for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
      await page.setViewportSize(vp);
      await seen(page);
      await page.goto('/');
      await ready(page);
      await page.getByRole('button', { name: 'About Global SAR' }).click();
      const start = page.getByRole('button', { name: 'Start the interactive tutorial' });
      await start.scrollIntoViewIfNeeded();
      await start.click();
      await expect(card(page)).toBeVisible();
      const c = (await card(page).boundingBox())!;
      const bar = (await page.locator('.topbar').boundingBox())!;
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(vp.width);
      expect(c.y, `${vp.width}px`).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // the menus a step sends the visitor to are not hidden behind the card
      await page.locator('[data-tut="layers"]').click();
      await page.getByRole('checkbox').first().click({ trial: true });
      await page.keyboard.press('Escape');
      const box = page.locator('[data-tut="search"] input');
      await box.fill('41.0, 29.0');
      await page.getByRole('option').first().click({ trial: true });
    }
  });

  test('at tablet width, with an investigation open, the card still has a usable size', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await seen(page);
    await page.goto('/');
    await ready(page);
    await page.getByRole('button', { name: 'About Global SAR' }).click();
    await page.getByRole('button', { name: 'Start the interactive tutorial' }).click();
    await card(page).getByRole('button', { name: 'Skip this step' }).click();
    await page.locator('.inv-strip button').first().click();
    await onStep(page, 'Compare before and after');
    const c = (await card(page).boundingBox())!;
    expect(c.width).toBeGreaterThan(300);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(800);
    const sheet = (await page.locator('section.panel').boundingBox())!;
    expect(c.y + c.height).toBeLessThanOrEqual(sheet.y + 1); // above the bottom sheet, not over it
  });
});
