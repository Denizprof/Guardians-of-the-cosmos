import { test as base, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// RECORDED FIXTURES (real responses captured 2026-11-14; see tests/fixtures/*.fixture.json).
const FIX = path.resolve(__dirname, '../fixtures');
export const photonFixture = fs.readFileSync(path.join(FIX, 'photon-caracas.fixture.json'), 'utf8');
export const asfFixture = fs.readFileSync(path.join(FIX, 'asf-coverage-venezuela.fixture.json'), 'utf8');

const CORS = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

/** Replace the two live third-party APIs with recorded responses so tests are deterministic and offline-safe. */
export async function mockServices(page: Page) {
  const calls = { photon: [] as string[], asf: [] as string[] };
  await page.route('https://photon.komoot.io/**', (r: Route) => {
    calls.photon.push(r.request().url());
    return r.fulfill({ status: 200, headers: CORS, body: photonFixture });
  });
  await page.route('https://api.daac.asf.alaska.edu/**', (r: Route) => {
    calls.asf.push(r.request().url());
    return r.fulfill({ status: 200, headers: CORS, body: asfFixture });
  });
  return calls;
}

export interface Problems {
  /** Console errors / uncaught exceptions / same-origin HTTP >= 400: these FAIL the test. */
  errors: string[];
  /** Failures attributable to third-party hosts (tiles, catalogs): reported, not failing. */
  thirdParty: string[];
}

/**
 * Auto-fixture: watches every test for console errors, uncaught page errors and same-origin 4xx/5xx.
 * Third-party failures (basemap tiles, external catalogs) are attached to the report instead, because
 * they depend on the outside world, not on this app's code.
 */
export const test = base.extend<{ problems: Problems }>({
  problems: [
    async ({ page, baseURL }, use, testInfo) => {
      const problems: Problems = { errors: [], thirdParty: [] };
      const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
      page.on('pageerror', (e) => problems.errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const url = m.location().url;
        const text = m.text().slice(0, 300);
        if (url.endsWith('/favicon.ico')) return; // covered by its own test (ISSUE-QA-18)
        if (url && !url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:')) problems.thirdParty.push(`${text} <- ${url.slice(0, 120)}`);
        else problems.errors.push(`console.error: ${text} <- ${url}`);
      });
      page.on('response', (r) => {
        if (r.status() >= 400 && r.url().startsWith(origin) && !r.url().endsWith('/favicon.ico')) problems.errors.push(`HTTP ${r.status()} ${r.url()}`);
      });
      await use(problems);
      if (problems.thirdParty.length) await testInfo.attach('third-party-failures', { body: problems.thirdParty.join('\n'), contentType: 'text/plain' });
      expect(problems.errors, 'console errors / page errors / same-origin HTTP failures').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Wait until the map canvas exists and the data package has been rendered into the UI.
 * The landing view is the globe, the top bar and the investigations strip: no side panel (panels are on demand).
 */
export async function appReady(page: Page) {
  await page.goto('/');
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
  await expect(page.locator('.app[data-ready="true"]')).toBeVisible();
  await expect(strip(page).getByRole('button').first()).toBeVisible();
}

/** The landing strip of curated investigations (replaces the old left filter rail list). */
export const strip = (page: Page) => page.getByRole('navigation', { name: 'Investigations' });
export const featured = (page: Page, title: RegExp | string) => strip(page).getByRole('button', { name: title });
/** Any side panel (investigation, reported event, coverage probe, about). */
export const anyPanel = (page: Page) => page.locator('section.panel');
export const aboutPanel = (page: Page) => page.locator('section.panel[aria-label="About Global SAR"]');
export const probePanel = (page: Page) => page.locator('section.panel[aria-label="Coverage probe"]');
export const openAbout = async (page: Page) => {
  await page.getByRole('button', { name: 'About Global SAR' }).click();
  await expect(aboutPanel(page)).toBeVisible();
};
export const panel = (page: Page) => page.locator('section.panel[aria-label$="investigation"]');
export const hashOf = (page: Page) => new URL(page.url()).hash;
export const hashParams = (page: Page) => new URLSearchParams(hashOf(page).split('?')[1] ?? '');
