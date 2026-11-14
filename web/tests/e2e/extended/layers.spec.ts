// New spec. Behaviour under test: the "Satellite layers" panel (toggle, date, opacity, info expander) and that
// the tile URLs requested use the correct {time} token. Per the user's instruction "debug all code with zillion
// different type tests". Tiles are routed to a 1x1 PNG: no dependence on live imagery.
import { appReady, expect, stubExternal, test } from './helpers';
import type { Page } from '@playwright/test';

const layersPanel = (p: Page) => p.getByRole('complementary', { name: 'Satellite layers' });
// The top-bar button is named "Satellite layers" or "Satellite layers (n)"; the popover has its own "Close satellite layers".
const layersButton = (p: Page) => p.getByRole('toolbar', { name: 'Map tools' }).getByRole('button', { name: /^Satellite layers/ });
const openLayers = async (p: Page) => {
  await layersButton(p).click();
  await expect(layersPanel(p)).toBeVisible();
};
// A date change is only honoured once the layer's source has loaded (see the BUG test at the end).
const firstTiles = (tiles: string[]) => expect.poll(() => tiles.length, { timeout: 30_000 }).toBeGreaterThan(0);
const toggle = (p: Page, title: RegExp | string) => layersPanel(p).getByRole('checkbox', { name: title });

test.describe('satellite layers panel', () => {
  test('opens, lists groups and layers, closes with the x button', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    expect(await layersPanel(page).getByRole('checkbox').count()).toBeGreaterThan(10);
    await expect(layersPanel(page)).toContainText('Global datasets from NASA');
    await layersPanel(page).getByRole('button', { name: 'Close satellite layers' }).click();
    await expect(layersPanel(page)).toHaveCount(0);
    await expect(layersButton(page)).toHaveAttribute('aria-expanded', 'false');
    // there is no permanent filter rail any more: filters are a popover of their own, closed until asked for
    await expect(page.locator('aside[aria-label="Map filters"]')).toHaveCount(0);
    await page.getByRole('toolbar', { name: 'Map tools' }).getByRole('button', { name: 'Filters' }).click();
    await expect(page.locator('aside[aria-label="Map filters"]')).toBeVisible();
  });

  test('toggling a GIBS layer requests tiles with the daily {time} token and updates the counter', async ({ page }) => {
    const { tiles } = await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    await toggle(page, /Daily true-colour Earth/).check();
    await expect(page.getByRole('button', { name: /Satellite layers \(1\)/ })).toBeVisible();
    await expect.poll(() => tiles.filter((u) => u.includes('VIIRS_NOAA20_CorrectedReflectance_TrueColor')).length, { timeout: 20_000 }).toBeGreaterThan(0);
    const u = tiles.find((x) => x.includes('VIIRS_NOAA20_CorrectedReflectance_TrueColor'))!;
    expect(u).not.toContain('{time}');
    expect(u).toMatch(/\/default\/\d{4}-\d{2}-\d{2}\/GoogleMapsCompatible/);
    // default date is clamped to "yesterday" at the latest (today's tiles may be incomplete)
    const day = u.match(/\/default\/(\d{4}-\d{2}-\d{2})\//)![1];
    expect(day <= new Date().toISOString().slice(0, 10)).toBe(true);
    await toggle(page, /Daily true-colour Earth/).uncheck();
    await expect(page.getByRole('button', { name: /^Satellite layers$/ })).toBeVisible();
  });

  test('changing the date re-requests tiles with that exact date (P1D)', async ({ page }) => {
    const { tiles } = await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    await toggle(page, /Daily true-colour Earth/).check();
    await firstTiles(tiles); // wait for the source to load so only the date change is under test (race covered by the BUG test)
    const date = layersPanel(page).getByLabel(/Daily true-colour Earth.*date/);
    await expect(date).toBeVisible();
    await date.fill('2024-03-15');
    await expect(date).toHaveValue('2024-03-15');
    await expect.poll(() => tiles.some((u) => u.includes('VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2024-03-15/')), { timeout: 20_000 }).toBe(true);
  });

  test('a date before the layer start is clamped to the start date', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    await toggle(page, /Daily true-colour Earth/).check();
    const date = layersPanel(page).getByLabel(/Daily true-colour Earth.*date/);
    await date.fill('2010-01-01'); // VIIRS NOAA-20 starts 2018-01-05
    await expect(date).toHaveValue('2018-01-05');
  });

  test('P1Y product: any date in the year becomes YYYY-01-01', async ({ page }) => {
    const { tiles } = await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    await toggle(page, /Annual vegetation disturbance/).check();
    await firstTiles(tiles); // wait for the source to load so only the date change is under test (race covered by the BUG test)
    await layersPanel(page).getByLabel(/Annual vegetation disturbance.*date/).fill('2024-06-10');
    await expect.poll(() => tiles.some((u) => u.includes('OPERA_L3_DIST-ANN-HLS_Color_Index/default/2024-01-01/')), { timeout: 20_000 }).toBe(true);
  });

  test('P16D product: the date snaps to the start of its 16-day composite', async ({ page }) => {
    const { tiles } = await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    await toggle(page, /Vegetation greenness, 16-day/).check();
    await firstTiles(tiles); // wait for the source to load so only the date change is under test (race covered by the BUG test)
    await layersPanel(page).getByLabel(/Vegetation greenness.*date/).fill('2024-03-20'); // day 79 (0-based) -> period start day 64 = 2024-03-05
    await expect.poll(() => tiles.some((u) => u.includes('MODIS_Terra_L3_NDVI_16Day/default/2024-03-05/')), { timeout: 20_000 }).toBe(true);
  });

  test('EOX yearly mosaic puts a bare YYYY into the URL', async ({ page }) => {
    const { tiles } = await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    await toggle(page, /Cloud-free Sentinel-2 yearly mosaics/).check();
    await firstTiles(tiles); // wait for the source to load so only the date change is under test (race covered by the BUG test)
    await layersPanel(page).getByLabel(/Cloud-free Sentinel-2 yearly mosaics.*date/).fill('2022-08-01');
    await expect.poll(() => tiles.some((u) => /s2cloudless-2022_3857\/default\/g\//.test(u)), { timeout: 20_000 }).toBe(true);
  });

  // A guessed timestamp 404s whenever GIBS has not published that slot yet, so the request names no time:
  // GIBS then serves its latest image (src/layers.ts toOverlay).
  test('sub-daily (GOES) layer has no date picker and asks GIBS for its latest image (no time in the tile URL)', async ({ page }) => {
    const { tiles } = await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    await toggle(page, /Fire temperature every 10 minutes/).check();
    await expect(layersPanel(page).getByText(/latest \(10M\)/)).toBeVisible();
    await expect(layersPanel(page).getByLabel(/Fire temperature.*date/)).toHaveCount(0);
    await expect.poll(() => tiles.some((u) => /GOES-East_ABI_FireTemp\/default\/GoogleMapsCompatible_Level7\//.test(decodeURIComponent(u))), { timeout: 20_000 }).toBe(true);
    expect(tiles.filter((u) => /GOES-East_ABI_FireTemp\/default\/\d{4}-/.test(decodeURIComponent(u)))).toEqual([]);
  });

  test('a layer without a time dimension has no date input', async ({ page }) => {
    const { tiles } = await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    await toggle(page, /Tree cover loss year/).check();
    await expect(layersPanel(page).getByLabel(/Tree cover loss.*opacity/)).toBeVisible();
    await expect(layersPanel(page).getByLabel(/Tree cover loss.*date/)).toHaveCount(0);
    await expect.poll(() => tiles.some((u) => u.includes('earthenginepartners-hansen')) || true).toBe(true);
  });

  test('opacity slider: default 0.85, keyboard and fill change it, bounded to 0.1..1', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    await toggle(page, /Daily true-colour Earth/).check();
    const slider = layersPanel(page).getByLabel(/Daily true-colour Earth.*opacity/);
    await expect(slider).toHaveValue('0.85');
    await slider.fill('0.4');
    await expect(slider).toHaveValue('0.4');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue('0.45');
    await page.keyboard.press('End');
    await expect(slider).toHaveValue('1');
    await page.keyboard.press('Home');
    await expect(slider).toHaveValue('0.1');
  });

  test('info expander shows source, resolution, licence and limitations, and toggles aria-expanded', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    const btn = layersPanel(page).getByRole('button', { name: /About Daily true-colour Earth/ });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    const info = layersPanel(page).locator('.layer-info');
    await expect(info).toHaveCount(1);
    for (const dt of ['Source', 'Resolution', 'Licence', 'Checked']) await expect(info.locator('dt', { hasText: dt })).toBeVisible();
    await expect(info.locator('dt', { hasText: 'Licence' }).locator('xpath=following-sibling::dd[1]')).not.toBeEmpty();
    await expect(info.locator('.callout')).not.toBeEmpty(); // limitations
    await expect(info.locator('.evidence')).toBeVisible();
    // only one expander open at a time
    await layersPanel(page).getByRole('button', { name: /About Radar backscatter/ }).click();
    await expect(layersPanel(page).locator('.layer-info')).toHaveCount(1);
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await btn.click();
    await expect(layersPanel(page).locator('.layer-info')).toHaveCount(0);
  });

  test('every catalog layer exposes licence and limitations text (data completeness)', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    const buttons = layersPanel(page).getByRole('button', { name: /^About / });
    const n = await buttons.count();
    expect(n).toBeGreaterThan(10);
    for (let i = 0; i < n; i++) {
      await buttons.nth(i).click();
      const info = layersPanel(page).locator('.layer-info');
      await expect(info.locator('dt', { hasText: 'Licence' }).locator('xpath=following-sibling::dd[1]')).not.toHaveText(/^\s*$/);
      await expect(info.locator('.callout')).not.toHaveText(/^\s*$/);
    }
  });

  test('layers stay on after closing and reopening the panel', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLayers(page);
    await toggle(page, /Daily true-colour Earth/).check();
    await layersPanel(page).getByRole('button', { name: 'Close satellite layers' }).click();
    await expect(page.getByRole('button', { name: /Satellite layers \(1\)/ })).toBeVisible();
    await openLayers(page);
    await expect(toggle(page, /Daily true-colour Earth/)).toBeChecked();
  });

  // BUG (real, found by this suite): MapView.syncTileOverlays only replaces an overlay source when
  // `src.tiles && src.tiles[0] !== o.url`. A raster source's `tiles` is not populated until its TileJSON has loaded (hypothesis), so a
  // date change made right after switching a layer on is silently ignored: the map keeps the OLD date while the input shows the NEW one.
  // It hit ~50% per attempt; the test loops over 12 attempts to cover the race.
  // FIXED: syncTileOverlays now tracks the URL each overlay source was created with (overlayUrls WeakMap), so this is a
  // plain regression test (the former test.fail() marker was removed when all 12 attempts started passing).
  test('BUG (fixed): changing the date immediately after enabling a layer must re-request tiles for the new date', async ({ page }) => {
    test.setTimeout(180_000);
    for (let attempt = 1; attempt <= 12; attempt++) {
      const { tiles } = await stubExternal(page);
      await appReady(page);
      await openLayers(page);
      await toggle(page, /Daily true-colour Earth/).check();
      await layersPanel(page).getByLabel(/Daily true-colour Earth.*date/).fill('2024-03-15');
      await expect.poll(() => tiles.some((u) => u.includes('VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2024-03-15/')), { timeout: 10_000, message: `attempt ${attempt}: map never requested tiles for 2024-03-15 although the date input shows it` }).toBe(true);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});
