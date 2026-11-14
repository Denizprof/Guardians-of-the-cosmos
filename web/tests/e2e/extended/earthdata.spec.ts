// New spec. Behaviour under test: the "NASA Earthdata available here" panel inside an investigation
// (loading, results, error with Retry, empty). CMR is routed to tests/fixtures/cmr.fixture.json; no live calls.
// Per the user's instruction "debug all code with zillion different type tests".
import fs from 'node:fs';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';
import { appReady, expect, FIX, openInvestigation, stubExternal, test } from './helpers';

const cmr = JSON.parse(fs.readFileSync(path.join(FIX, 'cmr.fixture.json'), 'utf8'));
const HITS: Record<string, number> = cmr.hitsByShortName;
const byId = new Map<string, string>(cmr.feed.entry.map((e: any) => [e.id, e.short_name]));
const H = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'CMR-Hits', 'content-type': 'application/json' };
const EXPECT_COLLECTIONS = Object.values(HITS).filter((n) => n > 0).length; // 7 (MOD00F has 0 granules and is dropped)
const EXPECT_GRANULES = Object.values(HITS).reduce((s, n) => s + n, 0);

interface CmrLog { collections: string[]; granules: string[] }
async function routeCmr(page: Page, opts: { collectionsStatus?: number; empty?: boolean; gate?: Promise<void> } = {}): Promise<CmrLog> {
  const log: CmrLog = { collections: [], granules: [] };
  await page.route('https://cmr.earthdata.nasa.gov/search/**', async (r: Route) => {
    const url = r.request().url();
    if (opts.gate) await opts.gate;
    if (url.includes('/collections.json')) {
      log.collections.push(url);
      if (opts.collectionsStatus && opts.collectionsStatus >= 400) return r.fulfill({ status: opts.collectionsStatus, headers: H, body: '{"errors":["boom"]}' });
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ feed: { entry: opts.empty ? [] : cmr.feed.entry } }) });
    }
    if (url.includes('/granules.json')) {
      log.granules.push(url);
      const id = new URL(url).searchParams.get('collection_concept_id')!;
      return r.fulfill({ status: 200, headers: { ...H, 'CMR-Hits': String(HITS[byId.get(id) ?? ''] ?? 0) }, body: '{"feed":{"entry":[]}}' });
    }
    return r.fulfill({ status: 404, headers: H, body: '{}' });
  });
  return log;
}

const edp = (p: Page) => p.getByRole('region', { name: 'NASA Earthdata available here' });
async function open(page: Page) {
  await appReady(page);
  await openInvestigation(page, /Venezuela earthquakes/);
  const btn = page.getByRole('button', { name: 'Search NASA Earthdata' });
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
}

test.describe('NASA Earthdata panel', () => {
  test('nothing is requested until the user asks; the button explains what it does', async ({ page }) => {
    await stubExternal(page);
    const log = await routeCmr(page);
    await appReady(page);
    await openInvestigation(page, /Venezuela earthquakes/);
    await expect(page.getByRole('button', { name: 'Search NASA Earthdata' })).toBeVisible();
    await expect(edp(page)).toHaveCount(0);
    expect(log.collections).toHaveLength(0);
  });

  test('loading state is announced (role=status, aria-busy) while CMR is pending', async ({ page }) => {
    await stubExternal(page);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await routeCmr(page, { gate });
    await open(page);
    await expect(edp(page)).toHaveAttribute('aria-busy', 'true');
    await expect(edp(page).getByRole('status')).toHaveText(/Searching NASA CMR/);
    release();
    await expect(edp(page)).toHaveAttribute('aria-busy', 'false');
    await expect(edp(page).locator('.edp-summary')).toBeVisible();
  });

  test('results: summary totals, platform groups (NISAR first), collections, Earthdata Search links', async ({ page }) => {
    await stubExternal(page);
    const log = await routeCmr(page);
    await open(page);
    const summary = edp(page).locator('.edp-summary');
    await expect(summary).toContainText(`${EXPECT_COLLECTIONS} collections`);
    await expect(summary).toContainText(`${EXPECT_GRANULES} granules`);
    const groups = await edp(page).locator('.edp-plat').allTextContents();
    expect(groups[0]).toBe('NISAR');
    expect(groups).toEqual(expect.arrayContaining(['Sentinel-1', 'Terra', 'NOAA-20', 'ICESat-2']));
    // the zero-granule collection is dropped
    await expect(edp(page)).not.toContainText('MOD00F');
    await expect(edp(page).locator('.edp-short', { hasText: 'MOD11A1' })).toBeAttached();
    // links open safely in new tabs and point at Earthdata Search with the point + window
    const first = edp(page).locator('.edp-col a', { hasText: 'Earthdata Search' }).first();
    await expect(first).toHaveAttribute('target', '_blank');
    await expect(first).toHaveAttribute('rel', /noopener/);
    expect(await first.getAttribute('href')).toMatch(/^https:\/\/search\.earthdata\.nasa\.gov\/search\/granules\?p=C\d+-\w+&sp%5B0%5D=/);
    await expect(edp(page).getByRole('link', { name: /Open this point and time in Earthdata Search/ })).toHaveAttribute('href', /^https:\/\/search\.earthdata\.nasa\.gov\/search\?/);
    // requests: both collection queries (general + platform-targeted) carry the event point and a +-7 day window
    // two distinct queries (general + platform-targeted); StrictMode in dev may issue each twice (first one aborted)
    expect(new Set(log.collections).size).toBe(2);
    for (const u of log.collections) {
      const q = new URL(u).searchParams;
      expect(q.get('has_granules')).toBe('true');
      expect(q.get('point')).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
      expect(q.get('temporal[]')).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:]+Z,\d{4}-\d{2}-\d{2}T[\d:]+Z$/);
    }
    expect(new Set(log.granules).size).toBe(cmr.feed.entry.length);
  });

  test('platform groups are collapsible <details>; small groups start open', async ({ page }) => {
    await stubExternal(page);
    await routeCmr(page);
    await open(page);
    const nisar = edp(page).locator('details', { has: page.locator('.edp-plat', { hasText: 'NISAR' }) });
    await expect(nisar).toHaveJSProperty('open', true);
    await nisar.locator('summary').click();
    await expect(nisar).toHaveJSProperty('open', false);
  });

  test('error state (HTTP 500): alert with message, then Retry recovers', async ({ page, allow }) => {
    allow.console.push(/cmr\.earthdata|500|Failed to load resource/);
    await stubExternal(page);
    await routeCmr(page, { collectionsStatus: 500 });
    await open(page);
    const alert = edp(page).getByRole('alert');
    await expect(alert).toContainText('Could not reach NASA CMR');
    await expect(alert).toContainText('HTTP 500');
    await expect(edp(page).locator('.edp-summary')).toHaveCount(0);
    // now CMR recovers
    await page.unroute('https://cmr.earthdata.nasa.gov/search/**');
    await routeCmr(page);
    await edp(page).getByRole('button', { name: 'Retry' }).click();
    await expect(edp(page).locator('.edp-summary')).toContainText(`${EXPECT_COLLECTIONS} collections`);
    await expect(edp(page).getByRole('alert')).toHaveCount(0);
  });

  test('network failure (aborted) also ends in the error state, not an endless spinner', async ({ page, allow }) => {
    allow.console.push(/Failed to load resource|net::ERR_|Failed to fetch/);
    await stubExternal(page);
    await page.route('https://cmr.earthdata.nasa.gov/search/**', (r) => r.abort('failed'));
    await open(page);
    await expect(edp(page).getByRole('alert')).toContainText('Could not reach NASA CMR');
    await expect(edp(page).getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('empty state: no collections found', async ({ page }) => {
    await stubExternal(page);
    await routeCmr(page, { empty: true });
    await open(page);
    await expect(edp(page)).toContainText('No NASA collections with granules found');
    await expect(edp(page).getByRole('alert')).toHaveCount(0);
    await expect(edp(page).locator('.edp-summary')).toHaveCount(0);
  });

  test('empty state: collections exist but every granule count is 0', async ({ page }) => {
    await stubExternal(page);
    await page.route('https://cmr.earthdata.nasa.gov/search/**', (r) => {
      const u = r.request().url();
      if (u.includes('/collections.json')) return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ feed: { entry: cmr.feed.entry } }) });
      return r.fulfill({ status: 200, headers: { ...H, 'CMR-Hits': '0' }, body: '{"feed":{"entry":[]}}' });
    });
    await open(page);
    await expect(edp(page)).toContainText('No NASA collections with granules found');
  });

  test('close button removes the panel and brings the search button back', async ({ page }) => {
    await stubExternal(page);
    await routeCmr(page);
    await open(page);
    await edp(page).getByRole('button', { name: 'Close Earthdata panel' }).click();
    await expect(edp(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Search NASA Earthdata' })).toBeVisible();
  });

  test('closing while the request is in flight does not surface an error', async ({ page }) => {
    await stubExternal(page);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await routeCmr(page, { gate });
    await open(page);
    await edp(page).getByRole('button', { name: 'Close Earthdata panel' }).click();
    release();
    // let the (aborted) request settle: two animation frames plus a macrotask; the fixture asserts no page errors
    await page.evaluate(() => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 0)))));
    await expect(edp(page)).toHaveCount(0);
  });
});
