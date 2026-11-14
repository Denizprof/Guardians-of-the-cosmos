import type { Page } from '@playwright/test';
import { anyPanel, appReady, expect, featured, hashOf, hashParams, panel, test } from './fixtures';

// iPhone-class viewport. isMobile/hasTouch make Edge report a touch phone (matchMedia, UA).
test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

// On phones the investigations are a horizontally scrolling strip at the bottom (no sheet is open on landing).
const introCard = (page: Page, t: RegExp) => featured(page, t);

test.describe('mobile 375x812', () => {
  test('landing: no horizontal page scroll, canvas fills the screen, controls are on screen', async ({ page }) => {
    await appReady(page);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth }));
    expect(m.sw).toBeLessThanOrEqual(m.iw);
    expect(m.bw).toBeLessThanOrEqual(m.iw);
    const canvas = (await page.locator('.maplibregl-canvas').first().boundingBox())!;
    expect(canvas.width).toBeGreaterThanOrEqual(370);
    await expect(page.getByRole('button', { name: 'Filters' })).toBeVisible();
    await expect(anyPanel(page)).toHaveCount(0); // no bottom sheet until something is selected
    await expect(page.getByRole('combobox', { name: /Search places/ })).toBeVisible();
    const sb = (await page.getByRole('combobox', { name: /Search places/ }).boundingBox())!;
    expect(sb.x).toBeGreaterThanOrEqual(0);
    expect(sb.x + sb.width).toBeLessThanOrEqual(376);
  });

  test('open an investigation from the landing strip; sheet collapses/expands; Close works', async ({ page }) => {
    await appReady(page);
    await introCard(page, /Limpopo/).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Limpopo and Incomati floods');
    await expect.poll(() => hashOf(page)).toContain('#/e/mozambique-floods-2026');
    const pb = (await panel(page).boundingBox())!;
    expect(pb.x).toBeGreaterThanOrEqual(-1);
    expect(pb.x + pb.width).toBeLessThanOrEqual(376);
    expect(pb.y + pb.height).toBeLessThanOrEqual(813);
    const h0 = pb.height;
    await panel(page).getByRole('button', { name: 'Collapse panel' }).click();
    await expect.poll(async () => (await panel(page).boundingBox())!.height).toBeLessThan(h0);
    await panel(page).getByRole('button', { name: 'Expand panel' }).click();
    await expect.poll(async () => (await panel(page).boundingBox())!.height).toBeGreaterThanOrEqual(h0 - 2);
    await panel(page).getByRole('button', { name: 'Close investigation' }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('timeline is inside the viewport and tapping a date changes the After layer', async ({ page }) => {
    await appReady(page);
    await introCard(page, /Krasheninnikov/).click();
    const tl = page.getByRole('group', { name: 'Observation timeline' });
    await expect(tl).toBeVisible();
    const b = (await tl.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width).toBeLessThanOrEqual(376);
    const a0 = hashParams(page).get('a');
    await tl.locator('g.tick').nth(4).dispatchEvent('click');
    await expect.poll(() => hashParams(page).get('a')).not.toBe(a0);
  });

  test('side-by-side on mobile stacks vertically (After label is in the lower part)', async ({ page }) => {
    await appReady(page);
    await introCard(page, /Limpopo/).click();
    await panel(page).getByRole('button', { name: 'Side by side' }).click();
    const after = page.locator('.map-tag', { hasText: /^AFTER/ });
    await expect(after).toBeVisible();
    const b = (await after.boundingBox())!;
    expect(b.y).toBeGreaterThan(812 * 0.3);
  });

  test('an open investigation does not overflow 375px horizontally', async ({ page }) => {
    await appReady(page);
    await introCard(page, /Venezuela/).click();
    await expect(panel(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('target size: visible controls are at least 24x24 CSS px (WCAG 2.2 AA 2.5.8)', async ({ page }) => {
    // ISSUE-QA-20 (fixed during the audit): pins (22x22) and collapse/close buttons (27x22, 23x22) used to be below 24x24.
    await appReady(page);
    await introCard(page, /Limpopo/).click();
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, [role=button], input, select, a[href]')) {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || st.visibility === 'hidden') continue;
        if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) continue;
        if (el.closest('.maplibregl-ctrl-attrib') || el.closest('svg')) continue;
        if (el.tagName === 'A') continue; // inline links are exempt from 2.5.8
        if (r.width < 24 || r.height < 24) out.push(`${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    test.info().annotations.push({ type: 'small-targets', description: small.join('; ') || 'none' });
    expect(small, 'targets smaller than 24x24 CSS px').toEqual([]);
  });
});
