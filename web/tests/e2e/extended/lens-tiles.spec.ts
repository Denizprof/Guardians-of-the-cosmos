// SAR lens radar tiles in a real browser (map/lensTiles.ts + the lens error handler in MapView):
//  - a one-off HTTP 500 from GIBS is asked for again and leaves no warning and no notice;
//  - a product whose days are not published (HTTP 404) raises no notice and no map error, and after the first answer is not asked again;
//  - a lasting server failure still raises the visible notice, and the console names the real HTTP status.
import type { Page, Route } from '@playwright/test';
import { PNG_1X1, appReady, expect, stubExternal, test } from './helpers';

const CORS = { 'access-control-allow-origin': '*' };
const OPERA = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1/**';
const NISAR = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance/**';
const png = (r: Route) => r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: PNG_1X1 });
const fail = (r: Route, status: number) => r.fulfill({ status, headers: { ...CORS, 'content-type': 'text/html' }, body: '<html>error</html>' });
const dayOf = (url: string) => /\/(\d{4}-\d{2}-\d{2})\//.exec(url)?.[1] ?? '';
/** Longer than MapView's TILE_NOTICE_GRACE_MS (5 s) plus the loader's retries. */
const SETTLE_MS = 8000;

function lensWarnings(page: Page) {
  const lines: string[] = [];
  page.on('console', (m) => {
    if (m.text().startsWith('[map:lens]')) lines.push(m.text());
  });
  return lines;
}

async function openLens(page: Page) {
  await page.getByRole('button', { name: 'SAR lens', exact: true }).click();
  await expect(page.locator('.map.lens[data-ready="true"] canvas')).toBeAttached();
}

test.describe('SAR lens tile loading', () => {
  test('a one-off HTTP 500 is asked for again: no hole, no warning, no notice', async ({ page }) => {
    await stubExternal(page);
    const seen = new Map<string, number>();
    let served500 = 0;
    await page.route(OPERA, (r) => {
      const url = r.request().url();
      const n = (seen.get(url) ?? 0) + 1;
      seen.set(url, n);
      if (n === 1) {
        served500++;
        return fail(r, 500);
      }
      return png(r);
    });
    const warnings = lensWarnings(page);
    await appReady(page);
    await openLens(page);
    await expect.poll(() => served500).toBeGreaterThan(0);
    await page.waitForTimeout(SETTLE_MS);
    expect([...seen.values()].filter((n) => n < 2), 'every tile that answered 500 was requested again').toEqual([]);
    expect(Math.max(...seen.values())).toBe(2); // and only once more: the second answer was good
    expect(warnings).toEqual([]);
    await expect(page.locator('.map-error')).toHaveCount(0);
    // the days stayed on the stack
    const sources: string[] = await page.evaluate(() => Object.keys((window as any).__gsMaps.lens.getStyle().sources).filter((id) => id.startsWith('lens-opera')));
    expect(sources).toHaveLength(6);
  });

  test('days that are not published (HTTP 404) raise no notice and are not asked for again', async ({ page }) => {
    const { tiles } = await stubExternal(page);
    const perDay = new Map<string, number>();
    await page.route(NISAR, (r) => {
      const day = dayOf(r.request().url());
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      return fail(r, 404);
    });
    const warnings = lensWarnings(page);
    await appReady(page);
    await openLens(page);
    await expect.poll(() => perDay.size).toBe(6);
    await page.waitForTimeout(SETTLE_MS);
    await expect(page.locator('.map-error')).toHaveCount(0);
    expect(warnings, 'MapLibre raises no error event for a status-404 tile').toEqual([]);
    // The tiles of the first view are asked together, before the first 404 is back: one batch per day, then silence.
    const firstBatch = [...perDay.values()];
    const operaBefore = tiles.filter((u) => u.includes('OPERA_L2')).length;
    // moving the camera needs new tiles: still nothing is requested for those days, and still no notice
    await page.evaluate(() => (window as any).__gsMaps.a.jumpTo({ center: [30, -20], zoom: 4.2 }));
    await page.waitForTimeout(3000);
    await page.evaluate(() => (window as any).__gsMaps.a.jumpTo({ center: [-60, 10], zoom: 3 }));
    await page.waitForTimeout(3000);
    expect(tiles.filter((u) => u.includes('OPERA_L2')).length, 'the moves did need new tiles').toBeGreaterThan(operaBefore);
    expect([...perDay.values()], 'no further request for the unpublished days').toEqual(firstBatch);
    expect(warnings).toEqual([]);
    await expect(page.locator('.map-error')).toHaveCount(0);
  });

  test('every radar day answering 404 is a failure the visitor is told about, not an empty lens', async ({ page }) => {
    await stubExternal(page);
    await page.route(OPERA, (r) => fail(r, 404));
    await page.route(NISAR, (r) => fail(r, 404));
    const warnings = lensWarnings(page);
    await appReady(page);
    await openLens(page);
    await expect(page.locator('.map-error[role="alert"]')).toContainText('SAR lens radar tiles', { timeout: 20_000 });
    expect(warnings.filter((w) => w.includes('404'))).toHaveLength(1); // said once, with the real status
    expect(warnings.join('\n')).not.toMatch(/image type/i);
  });

  test('a lasting server failure is shown to the visitor and logged with its real HTTP status', async ({ page }) => {
    await stubExternal(page);
    const seen = new Map<string, number>();
    const always500 = (r: Route) => {
      const url = r.request().url();
      seen.set(url, (seen.get(url) ?? 0) + 1);
      return fail(r, 500);
    };
    await page.route(OPERA, always500);
    await page.route(NISAR, always500);
    const warnings = lensWarnings(page);
    await appReady(page);
    await openLens(page);
    await expect(page.locator('.map-error[role="alert"]')).toContainText('SAR lens radar tiles', { timeout: 30_000 });
    const tileLines = warnings.filter((w) => w.includes('tile failed'));
    expect(tileLines.length).toBeGreaterThan(0);
    for (const w of tileLines) {
      expect(w).toContain('HTTP 500');
      expect(w).not.toMatch(/image type/i);
    }
    expect(Math.max(...seen.values()), 'bounded: at most 4 attempts per tile request').toBeLessThanOrEqual(4);
    // A camera stop puts the dropped days back for another try. While the outage lasts that costs one request
    // per tile, not another round of retries (the loader remembers that these days are failing).
    await expect.poll(() => warnings.filter((w) => w.includes('dropped from the lens stack')).length, { timeout: 30_000 }).toBe(12);
    const before = new Map(seen);
    await page.evaluate(() => (window as any).__gsMaps.a.jumpTo({ center: [30, -20], zoom: 4.2 }));
    await page.waitForTimeout(SETTLE_MS);
    const extra = [...seen].map(([url, n]) => n - (before.get(url) ?? 0));
    expect(extra.some((n) => n > 0), 'the dropped days were asked again').toBe(true);
    expect(Math.max(...extra), 'one attempt per tile on the re-try').toBeLessThanOrEqual(1);
  });
});
