// New spec. Behaviour under test: long-session stability. Opening and closing each investigation 10 times must not
// grow the DOM or leak map markers, must not log console errors, and records page-load navigation metrics.
// Per the user's instruction "debug all code with zillion different type tests".
import { appReady, expect, featured, hashOf, panel, strip, stubExternal, test } from './helpers';
import type { Page } from '@playwright/test';

const INVESTIGATIONS = [
  { title: /Venezuela earthquakes/, id: 'venezuela-2026' },
  { title: /Limpopo and Incomati floods/, id: 'mozambique-floods-2026' },
  { title: /Krasheninnikov volcano/, id: 'krasheninnikov-2026' },
];
const CYCLES = 10;

const metrics = (page: Page) =>
  page.evaluate(() => ({
    nodes: document.getElementsByTagName('*').length,
    markers: document.querySelectorAll('.maplibregl-marker').length,
    canvases: document.querySelectorAll('canvas').length,
    heap: (performance as any).memory?.usedJSHeapSize ?? null,
  }));

async function cycle(page: Page, t: (typeof INVESTIGATIONS)[number]) {
  await featured(page, t.title).click();
  await expect.poll(() => hashOf(page)).toContain(`#/e/${t.id}`);
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(() => hashOf(page)).toBe('#/');
}

test.describe('long session', () => {
  test('page-load navigation metrics are recorded and sane', async ({ page }, testInfo) => {
    await stubExternal(page);
    await appReady(page);
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const t = performance.timing;
      return {
        domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
        loadEventMs: Math.round(n.loadEventEnd),
        responseEndMs: Math.round(n.responseEnd),
        ttfbMs: Math.round(n.responseStart),
        transferSize: n.transferSize,
        legacyTiming: { navigationStartToLoadEnd: t.loadEventEnd - t.navigationStart, navigationStartToDomInteractive: t.domInteractive - t.navigationStart },
        resources: performance.getEntriesByType('resource').length,
      };
    });
    await testInfo.attach('navigation-timing.json', { body: JSON.stringify(nav, null, 2), contentType: 'application/json' });
    console.log('NAVIGATION TIMING', JSON.stringify(nav));
    expect(nav.loadEventMs).toBeGreaterThan(0);
    expect(nav.loadEventMs, 'load event within 30s on a dev server with software GL').toBeLessThan(30_000);
    expect(nav.legacyTiming.navigationStartToLoadEnd).toBeGreaterThan(0);
  });

  test(`open + close every investigation ${CYCLES}x: DOM and markers do not grow, no console errors`, async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    await stubExternal(page);
    await appReady(page);
    await expect(strip(page).getByRole('button').first()).toBeVisible();
    const idle0 = await metrics(page);
    expect(idle0.markers).toBe(0);
    const report: Record<string, unknown> = { idle0 };

    for (const t of INVESTIGATIONS) {
      await cycle(page, t); // warm-up (lazy chunks, caches)
      const warm = await metrics(page);
      let during: Awaited<ReturnType<typeof metrics>> | undefined;
      for (let i = 1; i <= CYCLES; i++) {
        await featured(page, t.title).click();
        await expect(panel(page)).toBeVisible();
        if (i === CYCLES) during = await metrics(page);
        await page.keyboard.press('Escape');
        await expect(panel(page)).toHaveCount(0);
        await expect.poll(() => hashOf(page)).toBe('#/');
        const m = await metrics(page);
        // markers are removed on close every single time
        expect(m.markers, `markers after close #${i} of ${t.id}`).toBe(warm.markers);
      }
      const after = await metrics(page);
      report[t.id] = { warm, after, during };
      // bounded: <= 5% (+50 nodes) over the warm baseline after 10 more cycles, and a constant canvas count
      expect(after.nodes, `DOM nodes ${t.id}: warm ${warm.nodes} -> after ${after.nodes}`).toBeLessThanOrEqual(Math.ceil(warm.nodes * 1.05) + 50);
      expect(after.canvases, `canvas count ${t.id}`).toBe(warm.canvases);
      // open-state markers must also be stable (pins are re-created, not accumulated)
      expect(during!.markers, `markers while open ${t.id}`).toBeLessThanOrEqual(2 * 40);
    }
    const end = await metrics(page);
    report.end = end;
    expect(end.nodes, `total DOM nodes: idle ${idle0.nodes} -> end ${end.nodes}`).toBeLessThanOrEqual(Math.ceil(idle0.nodes * 1.1) + 100);
    expect(end.markers).toBe(0);
    await testInfo.attach('long-session-metrics.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    console.log('LONG SESSION', JSON.stringify(report));
  });

  test('rapid open/close without waiting (click storm) leaves a consistent state', async ({ page }) => {
    test.setTimeout(120_000);
    await stubExternal(page);
    await appReady(page);
    const idle = await metrics(page);
    for (let i = 0; i < 15; i++) {
      await featured(page, INVESTIGATIONS[i % 3].title).click();
      await page.keyboard.press('Escape');
    }
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => hashOf(page)).toBe('#/');
    await expect.poll(async () => (await metrics(page)).markers).toBe(0);
    expect((await metrics(page)).nodes).toBeLessThanOrEqual(Math.ceil(idle.nodes * 1.1) + 100);
  });

  test('toggling every catalog and layer 5x does not accumulate DOM or errors', async ({ page }) => {
    test.setTimeout(180_000);
    await stubExternal(page);
    await appReady(page);
    await page.getByRole('toolbar', { name: 'Map tools' }).getByRole('button', { name: 'Filters' }).click();
    const rail = page.getByRole('complementary', { name: 'Map filters' });
    await expect(rail).toBeVisible();
    const before = await metrics(page);
    const boxes = rail.locator('label:has(input[type=checkbox]) input[type=checkbox]');
    const n = await boxes.count();
    for (let r = 0; r < 5; r++) for (let i = 0; i < n; i++) await boxes.nth(i).click({ force: true });
    // 5 is odd: every checkbox ends toggled; click again once to restore, then compare
    for (let i = 0; i < n; i++) await boxes.nth(i).click({ force: true });
    await expect(rail).toBeVisible();
    const after = await metrics(page);
    expect(after.nodes).toBeLessThanOrEqual(Math.ceil(before.nodes * 1.1) + 100);
  });
});
