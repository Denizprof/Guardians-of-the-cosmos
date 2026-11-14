// New spec. Behaviour under test: event catalogs in the filter rail (toggle each, year-range filter, failed catalog
// shows a '!' state). Per the user's instruction "debug all code with zillion different type tests".
// Counts are asserted exactly against the static JSON the app serves (public/data).
import { appReady, expect, readData, stubExternal, test } from './helpers';
import type { Page } from '@playwright/test';

const CATALOGS = [
  { id: 'firms-fires', label: /Active fires, last 24 h/, defaultOn: true },
  { id: 'noaa-tsunamis', label: /Tsunamis since 1900/, defaultOn: true },
  { id: 'usgs-earthquakes', label: /Earthquakes M7\+ since 1900/, defaultOn: false },
  { id: 'noaa-volcanoes', label: /Significant eruptions since 1900/, defaultOn: false },
  { id: 'gdacs-floods', label: /Flood alerts since 2000/, defaultOn: false },
  { id: 'nasa-glc', label: /Landslides \(NASA Global Landslide Catalog\)/, defaultOn: false },
];

const rail = (p: Page) => p.getByRole('complementary', { name: 'Map filters' });
const catRow = (p: Page, label: RegExp) => rail(p).locator('label', { hasText: label });
const openFilters = async (p: Page) => { await p.locator('.topbar .tool', { hasText: 'Filters' }).first().click(); await expect(rail(p)).toBeVisible(); };
const yearOf = (d: string) => new Date(d).getUTCFullYear();
const inRange = (d: string, from: number, to: number) => { const y = yearOf(d); return Number.isNaN(y) || (y >= from && y <= to); };

/** Sum of the per-group counts at the top of the rail = SAR events + visible reported events. */
async function groupTotal(p: Page) {
  const texts = await rail(p).locator('.group-row .count').allTextContents();
  return texts.reduce((s, t) => s + Number(t), 0);
}
/** SAR events + visible reported events. The app de-duplicates by id (context.json and the USGS catalog both emit usgs-<id>). */
function expectedTotal(active: string[], from: number, to: number) {
  const sar = readData('events.json').events.length;
  const ids = new Set<string>();
  for (const id of active) for (const e of readData(`catalogs/${id}.json`).events) if (inRange(e.date, from, to)) ids.add(e.id);
  for (const e of readData('context.json').events) if (inRange(e.date, from, to)) ids.add(e.id);
  return sar + ids.size;
}

test.describe('event catalogs', () => {
  test('the FIRMS snapshot line is shown with its build time and an honest "not live" note', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openFilters(page);
    const meta = rail(page).locator('.catalog-meta');
    await expect(meta).toContainText('Snapshot from');
    await expect(meta).toContainText(/(not live)|older than 24 h/);
  });

  test.beforeEach(async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openFilters(page);
  });

  test('default catalogs are on (fires, tsunamis) and show their exact counts', async ({ page }) => {
    for (const c of CATALOGS) {
      const row = catRow(page, c.label);
      if (c.defaultOn) {
        await expect(row.getByRole('checkbox')).toBeChecked();
        await expect(row.locator('.count')).toHaveText(String(readData(`catalogs/${c.id}.json`).events.length));
      } else {
        await expect(row.getByRole('checkbox')).not.toBeChecked();
        await expect(row.locator('.count')).toHaveText('');
      }
    }
  });

  for (const c of CATALOGS.filter((x) => !x.defaultOn)) {
    test(`toggle ${c.id}: on shows its count, group totals grow, off clears it`, async ({ page }) => {
      const before = await groupTotal(page);
      const row = catRow(page, c.label);
      await row.getByRole('checkbox').check();
      const n = readData(`catalogs/${c.id}.json`).events.length;
      await expect(row.locator('.count')).toHaveText(String(n));
      await expect.poll(() => groupTotal(page)).toBe(expectedTotal(['firms-fires', 'noaa-tsunamis', c.id], 1900, new Date().getUTCFullYear()));
      expect(await groupTotal(page)).toBeGreaterThan(before - 1);
      await row.getByRole('checkbox').uncheck();
      await expect(row.locator('.count')).toHaveText('');
      await expect.poll(() => groupTotal(page)).toBe(before);
    });
  }

  test('turning a default catalog off removes its events from the totals', async ({ page }) => {
    const before = await groupTotal(page);
    await catRow(page, /Tsunamis since 1900/).getByRole('checkbox').uncheck();
    const n = readData('catalogs/noaa-tsunamis.json').events.length;
    await expect.poll(() => groupTotal(page)).toBe(before - n);
  });

  test('the "recent events" context checkbox toggles the context markers out of the totals', async ({ page }) => {
    const before = await groupTotal(page);
    await rail(page).getByRole('checkbox', { name: /Recent events, 12 months/ }).uncheck();
    const n = readData('context.json').events.length;
    await expect.poll(() => groupTotal(page)).toBe(before - n);
  });

  test('year range: narrowing "From year" drops older events, exactly', async ({ page }) => {
    await catRow(page, /Earthquakes M7\+/).getByRole('checkbox').check();
    await catRow(page, /Significant eruptions/).getByRole('checkbox').check();
    const now = new Date().getUTCFullYear();
    const active = ['firms-fires', 'noaa-tsunamis', 'usgs-earthquakes', 'noaa-volcanoes'];
    await expect.poll(() => groupTotal(page)).toBe(expectedTotal(active, 1900, now));
    for (const from of [1950, 2000, 2020]) {
      await rail(page).getByLabel('From year').fill(String(from));
      await expect.poll(() => groupTotal(page), { message: `from ${from}` }).toBe(expectedTotal(active, from, now));
    }
  });

  test('year range: a single-year window and an inverted range are handled', async ({ page }) => {
    await catRow(page, /Earthquakes M7\+/).getByRole('checkbox').check();
    const now = new Date().getUTCFullYear();
    const active = ['firms-fires', 'noaa-tsunamis', 'usgs-earthquakes'];
    await rail(page).getByLabel('From year').fill('2011');
    await rail(page).getByLabel('To year').fill('2011');
    await expect.poll(() => groupTotal(page)).toBe(expectedTotal(active, 2011, 2011));
    // inverted: To below From is clamped up to From when applied (the totals are the single-year window, never empty/negative)
    await rail(page).getByLabel('To year').fill('1990');
    await expect.poll(() => groupTotal(page)).toBe(expectedTotal(active, 2011, 2011));
    // From above To: clamped down to the (applied) upper bound
    await rail(page).getByLabel('From year').fill('2030');
    await expect.poll(() => groupTotal(page)).toBe(expectedTotal(active, now, now)); // From 2030 -> capped to this year, To raised to it
    await rail(page).getByLabel('From year').fill('1900');
    await rail(page).getByLabel('To year').fill(String(now));
    await expect.poll(() => groupTotal(page)).toBe(expectedTotal(active, 1900, now));
  });

  test('year range inputs reject garbage (non-numeric) without breaking the totals', async ({ page }) => {
    const now = new Date().getUTCFullYear();
    const base = expectedTotal(['firms-fires', 'noaa-tsunamis'], 1900, now);
    const from = rail(page).getByLabel('From year');
    await expect(from).toHaveAttribute('type', 'number'); // the browser itself refuses letters
    await from.fill('');
    await expect.poll(() => groupTotal(page)).toBe(base);
  });

  test('a catalog that returns HTTP 500 shows "!" (and others keep working)', async ({ page, allow }) => {
    allow.console.push(/HTTP 500 .*gdacs-floods|status of 500.*gdacs-floods|gdacs-floods.json/);
    // route AFTER beforeEach loaded the app; catalogs are fetched on demand when switched on
    await page.route('**/data/catalogs/gdacs-floods.json', (r) => r.fulfill({ status: 500, body: 'boom' }));
    const row = catRow(page, /Flood alerts since 2000/);
    await row.getByRole('checkbox').check();
    await expect(row.locator('.count')).toHaveText('!');
    // the reason is visible text with a Retry button (not a hover-only tooltip)
    const err = rail(page).locator('.catalog-error', { hasText: /gdacs-floods: HTTP 500/ });
    await expect(err).toBeVisible();
    await expect(err).toHaveAttribute('role', 'alert');
    // another catalog still loads fine
    const eq = catRow(page, /Earthquakes M7\+/);
    await eq.getByRole('checkbox').check();
    await expect(eq.locator('.count')).toHaveText(String(readData('catalogs/usgs-earthquakes.json').events.length));
    // the failed catalog contributes nothing to totals
    await expect.poll(() => groupTotal(page)).toBe(expectedTotal(['firms-fires', 'noaa-tsunamis', 'usgs-earthquakes'], 1900, new Date().getUTCFullYear()));
  });

  test('a catalog that returns malformed JSON also surfaces "!" instead of crashing', async ({ page, allow }) => {
    allow.console.push(/nasa-glc/);
    await page.route('**/data/catalogs/nasa-glc.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{not json' }));
    const row = catRow(page, /Landslides \(NASA/);
    await row.getByRole('checkbox').check();
    await expect(row.locator('.count')).toHaveText('!');
    await expect(rail(page)).toBeVisible();
  });

  test('a catalog that never answers shows the loading ellipsis, not a count', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/data/catalogs/noaa-volcanoes.json', async (r) => { await gate; await r.continue(); });
    const row = catRow(page, /Significant eruptions/);
    await row.getByRole('checkbox').check();
    await expect(row.locator('.count')).toHaveText('…');
    release();
    await expect(row.locator('.count')).toHaveText(String(readData('catalogs/noaa-volcanoes.json').events.length));
  });

  test('Retry on a failed catalog reloads it once the server recovers', async ({ page, allow }) => {
    allow.console.push(/gdacs-floods/);
    await page.route('**/data/catalogs/gdacs-floods.json', (r) => r.fulfill({ status: 500, body: 'boom' }));
    const row = catRow(page, /Flood alerts since 2000/);
    await row.getByRole('checkbox').check();
    await expect(row.locator('.count')).toHaveText('!');
    await page.unroute('**/data/catalogs/gdacs-floods.json');
    await rail(page).locator('.catalog-error').getByRole('button', { name: 'Retry' }).click();
    await expect(row.locator('.count')).toHaveText(String(readData('catalogs/gdacs-floods.json').events.length));
    await expect(rail(page).locator('.catalog-error')).toHaveCount(0);
  });
});
