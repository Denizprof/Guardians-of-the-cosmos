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

const rail = (p: Page) => p.locator('aside[aria-label="Map filters"]');
const catRow = (p: Page, label: RegExp) => rail(p).locator('label', { hasText: label });
const yearOf = (d: string) => new Date(d).getUTCFullYear();
const inRange = (d: string, from: number, to: number) => { const y = yearOf(d); return Number.isNaN(y) || (y >= from && y <= to); };

/** Sum of the per-group counts at the top of the rail = SAR events + visible reported events. */
async function groupTotal(p: Page) {
  const texts = await rail(p).locator('.group-row .count').allTextContents();
  return texts.reduce((s, t) => s + Number(t), 0);
}
function expectedTotal(active: string[], from: number, to: number) {
  const sar = readData('events.json').events.length;
  const ctx = readData('context.json').events.filter((e: any) => inRange(e.date, from, to)).length;
  const cat = active.reduce((s, id) => s + readData(`catalogs/${id}.json`).events.filter((e: any) => inRange(e.date, from, to)).length, 0);
  return sar + ctx + cat;
}

test.describe('event catalogs', () => {
  test.beforeEach(async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await expect(rail(page)).toBeVisible();
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
    // inverted: To below From is clamped up to From (never an empty/negative window)
    await rail(page).getByLabel('To year').fill('1990');
    await expect(rail(page).getByLabel('To year')).toHaveValue('2011');
    // From above To is clamped down to To
    await rail(page).getByLabel('From year').fill('2030');
    await expect(rail(page).getByLabel('From year')).toHaveValue('2011');
    await rail(page).getByLabel('From year').fill('1900');
    await rail(page).getByLabel('To year').fill(String(now));
    await expect.poll(() => groupTotal(page)).toBe(expectedTotal(active, 1900, now));
  });

  test('year range inputs reject garbage (non-numeric) without breaking the totals', async ({ page }) => {
    const now = new Date().getUTCFullYear();
    const base = expectedTotal(['firms-fires', 'noaa-tsunamis'], 1900, now);
    const from = rail(page).getByLabel('From year');
    await from.fill('abc'); // number input: browser refuses, value becomes ''
    await from.fill('');
    await expect.poll(() => groupTotal(page)).toBe(base);
  });

  test('a catalog that returns HTTP 500 shows "!" (and others keep working)', async ({ page, allow }) => {
    allow.console.push(/gdacs-floods|500/);
    // route AFTER beforeEach loaded the app; catalogs are fetched on demand when switched on
    await page.route('**/data/catalogs/gdacs-floods.json', (r) => r.fulfill({ status: 500, body: 'boom' }));
    const row = catRow(page, /Flood alerts since 2000/);
    await row.getByRole('checkbox').check();
    await expect(row.locator('.count')).toHaveText('!');
    await expect(row).toHaveAttribute('title', /gdacs-floods: HTTP 500/);
    // another catalog still loads fine
    const eq = catRow(page, /Earthquakes M7\+/);
    await eq.getByRole('checkbox').check();
    await expect(eq.locator('.count')).toHaveText(String(readData('catalogs/usgs-earthquakes.json').events.length));
    // the failed catalog contributes nothing to totals
    await expect.poll(() => groupTotal(page)).toBe(expectedTotal(['firms-fires', 'noaa-tsunamis', 'usgs-earthquakes'], 1900, new Date().getUTCFullYear()));
  });

  test('a catalog that returns malformed JSON also surfaces "!" instead of crashing', async ({ page, allow }) => {
    allow.console.push(/nasa-glc|Unexpected|JSON/);
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
});
