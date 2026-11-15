// Behaviour under test: resilience / chaos. The app must stay usable and free of uncaught page errors when
// tiles fail, the network is slow, third parties are down, or the connection drops after load; failures must be
// VISIBLE (map-error notice, catalog/CMR error states), never silent. Per the user's instruction
// "debug all code with zillion different type tests".
// Console errors caused by the injected failures are tolerated only through narrow patterns (allow.console);
// uncaught exceptions are never tolerated.
import type { Page } from '@playwright/test';
import { appReady, expect, featured, hashOf, openInvestigation, panel, readData, stubExternal, test } from './helpers';

const isThirdParty = (url: string) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) && /^https?:/.test(url);
const search = (p: Page) => p.getByRole('combobox', { name: /Search places/ });
const toolbar = (p: Page) => p.getByRole('toolbar', { name: 'Map tools' });
const filtersPopover = (p: Page) => p.getByRole('complementary', { name: 'Map filters' });
const sleep = (ms: number) => new Promise((f) => setTimeout(f, ms));

/** Injected network failures surface as these console messages (browser resource errors, MapLibre/fetch failures). */
const NET_NOISE = [/Failed to load resource/, /net::ERR_/, /AJAXError/, /Failed to fetch/, /NetworkError/, /Load failed/];

/** The app responds to input: an investigation opens from the strip and closes with Escape. */
async function expectUsable(page: Page) {
  await openInvestigation(page, /Limpopo/);
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Limpopo and Incomati floods');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Investigations' })).toBeVisible();
}

test.describe('chaos: tiles and third parties', () => {
  test('ALL third-party requests aborted: globe shell, strip and investigations still work, failure is announced', async ({ page, allow }) => {
    allow.console.push(...NET_NOISE);
    await page.route((u) => isThirdParty(u.toString()), (r) => r.abort('failed'));
    await appReady(page);
    // not silent: the user is told map data is missing (and that this is not "no data")
    await expect(page.locator('.map-error')).toContainText('Some map data failed to load');
    await expect(page.locator('.map-error')).toContainText('does not mean there is no data');
    await expectUsable(page);
    await page.locator('.map-error').getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.map-error')).toHaveCount(0);
  });

  test('all tile requests aborted while a satellite layer is on: panel stays responsive and names the layer', async ({ page, allow }) => {
    allow.console.push(...NET_NOISE);
    await page.route('https://gibs.earthdata.nasa.gov/**', (r) => r.abort('failed'));
    await page.route('https://tiles.openfreemap.org/**', (r) => r.abort('failed'));
    await page.route('https://tiles.maps.eox.at/**', (r) => r.abort('failed'));
    await page.route('https://s3.amazonaws.com/**', (r) => r.abort('failed'));
    await appReady(page);
    await toolbar(page).getByRole('button', { name: /^Satellite layers/ }).click();
    const layers = page.getByRole('complementary', { name: 'Satellite layers' });
    await layers.getByRole('checkbox', { name: /Daily true-colour Earth/ }).check();
    await layers.getByLabel(/Daily true-colour Earth.*opacity/).fill('0.5');
    await layers.getByRole('button', { name: /About Daily true-colour Earth/ }).click();
    await expect(layers.locator('.layer-info')).toBeVisible();
    await expect(page.locator('.map-error')).toContainText(/satellite layer "gibs-viirs-noaa20-truecolor"|satellite imagery/, { timeout: 30_000 });
    await layers.getByRole('button', { name: 'Close satellite layers' }).click();
    await expectUsable(page);
  });

  test('tiles answered with HTTP 500 / garbage bodies do not crash the page', async ({ page, allow }) => {
    allow.console.push(...NET_NOISE, /Could not load image|decode|EncodingError|InvalidStateError/i);
    let n = 0;
    await page.route((u) => isThirdParty(u.toString()) && /\.(png|jpe?g|pbf)/i.test(u.toString()), (r) =>
      n++ % 2 ? r.fulfill({ status: 500, body: 'nope' }) : r.fulfill({ status: 200, contentType: 'image/png', body: 'not-an-image' }));
    await appReady(page);
    await toolbar(page).getByRole('button', { name: /^Satellite layers/ }).click();
    const layers = page.getByRole('complementary', { name: 'Satellite layers' });
    await layers.getByRole('checkbox', { name: /Daily true-colour Earth/ }).check();
    await layers.getByRole('button', { name: 'Close satellite layers' }).click();
    await expect(page.locator('.map-error')).toBeVisible({ timeout: 30_000 });
    await expectUsable(page);
  });

  test('place search with the geocoder down shows the fallback message; coordinates still work', async ({ page, allow }) => {
    allow.console.push(...NET_NOISE);
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
    allow.console.push(...NET_NOISE, /JSON|Unexpected token|photon/);
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
    allow.console.push(...NET_NOISE, /asf|503/i);
    await stubExternal(page);
    await page.unroute('https://api.daac.asf.alaska.edu/**');
    await page.route('https://api.daac.asf.alaska.edu/**', (r) => r.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'down' }));
    await appReady(page);
    await search(page).fill('10.5, -67.2');
    await page.getByRole('listbox').getByRole('option').first().click();
    await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
    await expect(page.locator('section.panel[aria-label="Coverage probe"]')).toBeVisible();
    // (Escape is deliberately ignored while the search input has focus, so use the panel's close button)
    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(page.locator('section.panel')).toHaveCount(0);
    await expectUsable(page);
  });

  test('layers.json failing shows an alert in the layers popover (not an empty list)', async ({ page, allow }) => {
    allow.console.push(...NET_NOISE, /layers\.json/);
    await stubExternal(page);
    await page.route('**/data/layers.json', (r) => r.fulfill({ status: 500, body: 'x' }));
    await appReady(page);
    await toolbar(page).getByRole('button', { name: /^Satellite layers/ }).click();
    await expect(page.getByRole('complementary', { name: 'Satellite layers' }).getByRole('alert')).toContainText('layer catalog could not be loaded');
  });
});

test.describe('chaos: slow network', () => {
  test('every data response delayed 1.5s: app converges to the ready state and stays interactive', async ({ page }) => {
    test.setTimeout(120_000);
    await stubExternal(page);
    await page.route(/\/data\/(events|context|layers)\.json/, async (r) => { await sleep(1500); await r.fallback(); });
    await page.route(/\/data\/catalogs\//, async (r) => { await sleep(1500); await r.fallback(); });
    await page.goto('/');
    await expect(page.locator('.app[data-ready="true"]')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('navigation', { name: 'Investigations' }).getByRole('button').first()).toBeVisible();
    await expectUsable(page);
  });

  test('a catalog held in flight shows the loading ellipsis (never a wrong number), then the exact count', async ({ page }) => {
    await stubExternal(page);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/data/catalogs/noaa-volcanoes.json', async (r) => { await gate; await r.fallback(); });
    await appReady(page);
    await toolbar(page).getByRole('button', { name: 'Filters' }).click();
    const row = filtersPopover(page).locator('label', { hasText: /Significant eruptions/ });
    await row.getByRole('checkbox').check();
    await expect(row.locator('.count')).toHaveText('…');
    release();
    await expect(row.locator('.count')).toHaveText(String(readData('catalogs/noaa-volcanoes.json').events.length));
  });

  test('slow geocoder: a late response never overwrites newer input', async ({ page }) => {
    await stubExternal(page);
    await page.unroute('https://photon.komoot.io/**');
    const seen: string[] = [];
    let slowDone = false;
    await page.route('https://photon.komoot.io/**', async (r) => {
      const q = new URL(r.request().url()).searchParams.get('q') ?? '';
      seen.push(q);
      if (q.startsWith('Cara')) { await sleep(2500); slowDone = true; } // first query is slow
      await r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ type: 'FeatureCollection', features: [] }) });
    });
    await appReady(page);
    await search(page).fill('Caracas');
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    await search(page).fill('10.5, -67.2'); // supersedes the slow request
    await expect(page.getByRole('listbox')).toContainText('Go to coordinates');
    await expect.poll(() => slowDone, { timeout: 10_000 }).toBe(true); // the late response has now been delivered (or aborted)
    await expect(page.getByRole('listbox')).toContainText('Go to coordinates'); // still the coords result
  });

  test('slow CMR: loading state is visible, then results', async ({ page }) => {
    await stubExternal(page);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('https://cmr.earthdata.nasa.gov/search/**', async (r) => {
      await gate;
      await r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'CMR-Hits', 'CMR-Hits': '0', 'content-type': 'application/json' }, body: '{"feed":{"entry":[]}}' });
    });
    await appReady(page);
    await openInvestigation(page, /Venezuela/);
    await page.getByRole('button', { name: 'Search NASA Earthdata' }).click();
    const edp = page.getByRole('region', { name: 'NASA Earthdata available here' });
    await expect(edp.getByRole('status')).toContainText('Searching');
    release();
    await expect(edp).toContainText('No NASA collections with granules found', { timeout: 20_000 });
  });
});

test.describe('chaos: offline after load', () => {
  test('going offline after load: filters, layers popover and in-memory investigations keep working; uncached catalog shows its error', async ({ page, context, allow }) => {
    allow.console.push(...NET_NOISE);
    await stubExternal(page);
    await appReady(page);
    await context.setOffline(true);
    // local-state UI keeps working
    await toolbar(page).getByRole('button', { name: 'Filters' }).click();
    const geo = filtersPopover(page).getByRole('checkbox', { name: /Geohazards/ });
    await geo.uncheck();
    await expect(geo).not.toBeChecked();
    await geo.check();
    // a not-yet-fetched catalog fails cleanly: '!' plus visible reason and Retry, not a crash
    // (a catalog that is off by default; earthquakes are on by default and so already loaded)
    const eq = filtersPopover(page).locator('label', { hasText: /Significant eruptions/ });
    await eq.getByRole('checkbox').check();
    await expect(eq.locator('.count')).toHaveText('!');
    await expect(filtersPopover(page).locator('.catalog-error')).toContainText('Could not load');
    await expect(filtersPopover(page).locator('.catalog-error').getByRole('button', { name: 'Retry' })).toBeVisible();
    await filtersPopover(page).getByRole('button', { name: 'Close filters' }).click();
    // search: local investigations still matched
    await search(page).fill('Venezuela');
    await expect(page.getByRole('listbox')).toContainText('Venezuela earthquakes');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    // back online: Retry now works
    await context.setOffline(false);
    await toolbar(page).getByRole('button', { name: 'Filters' }).click();
    await filtersPopover(page).locator('.catalog-error').getByRole('button', { name: 'Retry' }).click();
    await expect(eq.locator('.count')).toHaveText(String(readData('catalogs/noaa-volcanoes.json').events.length));
  });

  test('offline when an investigation opens: the panel itself renders from memory', async ({ page, context, allow }) => {
    allow.console.push(...NET_NOISE);
    await appReady(page);
    await context.setOffline(true);
    await featured(page, /Venezuela/).click();
    await expect(panel(page)).toBeVisible();
    await expect.poll(() => hashOf(page)).toMatch(/^#\/e\/venezuela-2026/);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });

  // BUG (real): EarthdataPanel and AssistantPanel are React.lazy chunks. If the chunk cannot be fetched (offline, flaky network,
  // deploy replaced the hashed chunk), the rejection reaches the root ErrorBoundary and the WHOLE app is replaced by
  // "Something went wrong and the app stopped." instead of an inline "could not load" in that one section.
  // Repro: open an investigation, go offline, click "Search NASA Earthdata" (or open "Ask about this investigation").
  test('BUG: offline, opening the lazy Earthdata section must degrade inline, not crash the whole app', async ({ page, context, allow }) => {
    test.fail(true, 'Known app bug: lazy chunk load failure is caught only by the root ErrorBoundary (.fatal)');
    allow.console.push(...NET_NOISE, /dynamically imported module|EarthdataPanel|ErrorBoundary|The above error occurred/);
    await appReady(page);
    await context.setOffline(true); // offline BEFORE the lazy chunk is first requested
    await featured(page, /Venezuela/).click();
    await expect(panel(page)).toBeVisible();
    await page.getByRole('button', { name: 'Search NASA Earthdata' }).click();
    // wait for the section to settle into SOME final state first (a bare count(0) check would pass before the import fails)
    await expect(page.locator('.fatal, section.edp').first()).toBeVisible();
    await expect(page.locator('.fatal'), 'whole app replaced by the fatal-error screen').toHaveCount(0);
    await expect(panel(page)).toBeVisible();
  });

  test('BUG: offline, opening the lazy assistant section must degrade inline, not crash the whole app', async ({ page, context, allow }) => {
    test.fail(true, 'Known app bug: lazy chunk load failure is caught only by the root ErrorBoundary (.fatal)');
    allow.console.push(...NET_NOISE, /dynamically imported module|AssistantPanel|ErrorBoundary|The above error occurred/);
    await appReady(page);
    await context.setOffline(true); // offline BEFORE the lazy chunk is first requested
    await featured(page, /Venezuela/).click();
    await expect(panel(page)).toBeVisible();
    await page.locator('section.panel details.disclosure > summary', { hasText: 'Ask about this investigation' }).click();
    await expect(page.locator('.fatal, section.asst').first()).toBeVisible();
    await expect(page.locator('.fatal'), 'whole app replaced by the fatal-error screen').toHaveCount(0);
    await expect(panel(page)).toBeVisible();
  });
});
