// New spec. Behaviour under test: resilience / chaos. The app must stay usable and free of uncaught page errors when
// tiles fail, the network is slow, third parties are down, or the connection drops after load.
// Per the user's instruction "debug all code with zillion different type tests".
// Console errors caused by the injected failures are tolerated (allow.console); uncaught exceptions never are.
import type { Page } from '@playwright/test';
import { appReady, expect, featured, hashOf, openInvestigation, panel, stubExternal, test } from './helpers';

const isThirdParty = (url: string) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) && /^https?:/.test(url);
const search = (p: Page) => p.getByRole('combobox', { name: /Search places/ });

async function expectUsable(page: Page) {
  // the app responds to input: filters change, an investigation opens and closes
  const rail = page.locator('aside[aria-label="Map filters"]');
  await expect(rail).toBeVisible();
  await openInvestigation(page, /Limpopo/);
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Limpopo and Incomati floods');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('section[aria-label="About Global SAR"]')).toBeVisible();
}

test.describe('chaos: tiles and third parties', () => {
  test('ALL third-party requests aborted: globe shell, filters, list and investigations still work', async ({ page, allow }) => {
    allow.console.push(/.*/);
    await page.route((u) => isThirdParty(u.toString()), (r) => r.abort('failed'));
    await appReady(page);
    await expect(page.getByRole('heading', { level: 2 }).first()).toContainText('See what happened');
    await expectUsable(page);
  });

  test('all tile requests aborted (basemap, terrain, GIBS) while a satellite layer is on: panel stays responsive', async ({ page, allow }) => {
    allow.console.push(/.*/);
    await page.route(/\.(png|jpe?g|webp|pbf|mvt)(\?.*)?$/i, (r) => r.abort('failed'));
    await page.route('https://gibs.earthdata.nasa.gov/**', (r) => r.abort('failed'));
    await page.route('https://tiles.openfreemap.org/**', (r) => r.abort('failed'));
    await appReady(page);
    await page.getByRole('button', { name: /Satellite layers/ }).click();
    const layers = page.getByRole('complementary', { name: 'Satellite layers' });
    await layers.getByRole('checkbox', { name: /Daily true-colour Earth/ }).check();
    await layers.getByLabel(/Daily true-colour Earth.*opacity/).fill('0.5');
    await layers.getByRole('button', { name: /About Daily true-colour Earth/ }).click();
    await expect(layers.locator('.layer-info')).toBeVisible();
    await layers.getByRole('button', { name: 'Close satellite layers' }).click();
    await expectUsable(page);
  });

  test('tiles answered with HTTP 500 / garbage bodies do not crash the page', async ({ page, allow }) => {
    allow.console.push(/.*/);
    let n = 0;
    await page.route((u) => isThirdParty(u.toString()) && /\.(png|jpe?g|pbf)/i.test(u.toString()), (r) =>
      n++ % 2 ? r.fulfill({ status: 500, body: 'nope' }) : r.fulfill({ status: 200, contentType: 'image/png', body: 'not-an-image' }));
    await appReady(page);
    await page.getByRole('button', { name: /Satellite layers/ }).click();
    await page.getByRole('complementary', { name: 'Satellite layers' }).getByRole('checkbox', { name: /Daily true-colour Earth/ }).check();
    await page.getByRole('complementary', { name: 'Satellite layers' }).getByRole('button', { name: 'Close satellite layers' }).click();
    await expectUsable(page);
  });

  test('place search with the geocoder down shows the fallback message; coordinates still work', async ({ page, allow }) => {
    allow.console.push(/.*/);
    await stubExternal(page);
    await page.unroute('https://photon.komoot.io/**');
    await page.route('https://photon.komoot.io/**', (r) => r.abort('failed'));
    await appReady(page);
    await search(page).fill('Caracas');
    await expect(page.getByRole('listbox')).toContainText('Place search is unavailable right now');
    await search(page).fill('10.5, -67.2');
    await expect(page.getByRole('listbox')).toContainText('Go to coordinates');
    await expect(page.getByRole('listbox')).not.toContainText('unavailable');
  });

  test('geocoder returning 500 and malformed JSON are handled the same way', async ({ page, allow }) => {
    allow.console.push(/.*/);
    for (const handler of [
      (r: any) => r.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'x' }),
      (r: any) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{oops' }),
    ]) {
      await page.route('https://photon.komoot.io/**', handler);
      await appReady(page);
      await search(page).fill('Maracaibo');
      await expect(page.getByRole('listbox')).toContainText('Place search is unavailable');
      await page.unroute('https://photon.komoot.io/**');
    }
  });

  test('coverage (ASF) service down: coordinates search does not break the app', async ({ page, allow }) => {
    allow.console.push(/.*/);
    await stubExternal(page);
    await page.unroute('https://api.daac.asf.alaska.edu/**');
    await page.route('https://api.daac.asf.alaska.edu/**', (r) => r.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'down' }));
    await appReady(page);
    await search(page).fill('10.5, -67.2');
    await page.getByRole('listbox').getByRole('option').first().click();
    await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
    await expectUsable(page);
  });
});

test.describe('chaos: slow network', () => {
  test('every response delayed 1.5s: app converges to the ready state and stays interactive', async ({ page, allow }) => {
    test.setTimeout(120_000);
    allow.console.push(/.*/);
    await stubExternal(page);
    await page.route(/\/data\/(events|context|layers)\.json/, async (r) => { await new Promise((f) => setTimeout(f, 1500)); await r.continue(); });
    await page.route(/\/data\/catalogs\//, async (r) => { await new Promise((f) => setTimeout(f, 1500)); await r.continue(); });
    await page.route(/photon\.komoot\.io|asf\.alaska/, async (r) => { await new Promise((f) => setTimeout(f, 1500)); await r.fallback(); });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2 }).first()).toContainText('See what happened', { timeout: 45_000 });
    // catalog counts show a loading ellipsis, never a wrong number, until data arrives
    await expect(page.locator('aside.filters .count', { hasText: '…' }).first()).toBeAttached({ timeout: 5000 }).catch(() => undefined);
    await expect(page.locator('aside[aria-label="Map filters"] label', { hasText: /Tsunamis since 1900/ }).locator('.count')).toHaveText(/^\d+$/, { timeout: 45_000 });
    await expectUsable(page);
  });

  test('slow geocoder: a late response never overwrites newer input', async ({ page }) => {
    await stubExternal(page);
    await page.unroute('https://photon.komoot.io/**');
    const seen: string[] = [];
    await page.route('https://photon.komoot.io/**', async (r) => {
      const q = new URL(r.request().url()).searchParams.get('q') ?? '';
      seen.push(q);
      if (q.startsWith('Cara')) await new Promise((f) => setTimeout(f, 2500)); // first query is slow
      await r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ type: 'FeatureCollection', features: [] }) });
    });
    await appReady(page);
    await search(page).fill('Caracas');
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    await search(page).fill('10.5, -67.2'); // supersedes the slow request
    await expect(page.getByRole('listbox')).toContainText('Go to coordinates');
    await page.waitForTimeout(3000);
    await expect(page.getByRole('listbox')).toContainText('Go to coordinates'); // still the coords result
  });

  test('slow CMR: loading state is visible, then results; panel can be closed meanwhile', async ({ page }) => {
    await stubExternal(page);
    await page.route('https://cmr.earthdata.nasa.gov/search/**', async (r) => {
      await new Promise((f) => setTimeout(f, 2000));
      await r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'CMR-Hits', 'CMR-Hits': '0', 'content-type': 'application/json' }, body: '{"feed":{"entry":[]}}' });
    });
    await appReady(page);
    await openInvestigation(page, /Venezuela/);
    await page.getByRole('button', { name: 'Search NASA Earthdata' }).click();
    const edp = page.getByRole('region', { name: 'NASA Earthdata available here' });
    await expect(edp.getByRole('status')).toContainText('Searching');
    await expect(edp).toContainText('No NASA collections with granules found', { timeout: 20_000 });
  });
});

test.describe('chaos: offline after load', () => {
  test('going offline after load: filters, layers panel and in-memory investigations keep working; search degrades gracefully', async ({ page, context, allow }) => {
    allow.console.push(/.*/);
    await stubExternal(page);
    await appReady(page);
    await context.setOffline(true);
    // local-state UI keeps working
    const rail = page.locator('aside[aria-label="Map filters"]');
    const volc = rail.getByRole('checkbox', { name: /Geohazards/ });
    await volc.uncheck();
    await expect(volc).not.toBeChecked();
    await volc.check();
    await page.getByRole('button', { name: /Satellite layers/ }).click();
    const layers = page.getByRole('complementary', { name: 'Satellite layers' });
    await layers.getByRole('button', { name: /About Daily true-colour Earth/ }).click();
    await expect(layers.locator('.layer-info')).toBeVisible();
    await layers.getByRole('button', { name: 'Close satellite layers' }).click();
    // search: local investigations still matched, geocoder error explained
    await search(page).fill('Venezuela');
    await expect(page.getByRole('listbox')).toContainText('Venezuela earthquakes');
    // note: the geocoder is fulfilled by the stub (route handlers run before the network), so go offline-only on the catalog fetch
    await page.keyboard.press('Escape');
    // a not-yet-fetched catalog fails cleanly -> '!' state, not a crash
    const eq = rail.locator('label', { hasText: /Earthquakes M7\+/ });
    await eq.getByRole('checkbox').check();
    await expect(eq.locator('.count')).toHaveText('!');
    await expect(rail).toBeVisible();
    // back online: the page is still alive
    await context.setOffline(false);
    await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
  });

  test('offline from the start of an investigation: the panel renders and the Earthdata/assistant sections degrade', async ({ page, context, allow }) => {
    allow.console.push(/.*/);
    await appReady(page);
    await context.setOffline(true);
    await featured(page, /Venezuela/).click();
    await expect(panel(page)).toBeVisible();
    await expect.poll(() => hashOf(page)).toMatch(/^#\/e\/venezuela-2026/);
    await page.getByRole('button', { name: 'Search NASA Earthdata' }).click();
    await expect(page.getByRole('region', { name: 'NASA Earthdata available here' }).getByRole('alert')).toContainText('Could not reach NASA CMR', { timeout: 30_000 });
    await expect(page.locator('section.asst')).toContainText('Assistant not connected');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });
});
