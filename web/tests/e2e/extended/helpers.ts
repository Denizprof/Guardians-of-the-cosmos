// Shared helpers for the extended (new test types) suite.
// Behaviour under test: see each spec. Own `test` fixture because several specs deliberately
// provoke same-origin HTTP 5xx / console errors (e.g. a catalog routed to 500) and must be able to allow them.
import { test as base, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appReady, asfFixture, photonFixture } from '../fixtures';

export { expect, appReady };
export { featured, panel, hashOf, hashParams, strip, anyPanel, aboutPanel, probePanel, openAbout } from '../fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(here, '../../..');
export const FIX = path.resolve(here, '../../fixtures');
export const readData = <T = any>(rel: string): T => JSON.parse(fs.readFileSync(path.join(WEB, 'public/data', rel), 'utf8'));

/** 1x1 transparent PNG. */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const CORS = { 'access-control-allow-origin': '*' };

export interface Allow {
  /** console.error / HTTP failures matching any of these are tolerated (never applies to uncaught page errors). */
  console: RegExp[];
}

export const test = base.extend<{ allow: Allow; pageErrors: string[] }>({
  allow: async ({}, use) => use({ console: [] }),
  pageErrors: [
    async ({ page, baseURL, allow }, use, testInfo) => {
      const errors: string[] = [];
      // The first-visit introduction (components/Welcome.tsx) is covered by its own spec; every other test starts in the tool.
      await page.addInitScript(() => { try { localStorage.setItem('global-sar.intro-seen', '3'); } catch { /* storage blocked */ } });
      const soft: string[] = [];
      const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
      const tolerated = (s: string) => allow.console.some((r) => r.test(s));
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const url = m.location().url;
        const text = `${m.text().slice(0, 300)} <- ${url}`;
        if (url.endsWith('/favicon.ico')) return;
        if (url && !url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:')) return soft.push(text);
        (tolerated(text) ? soft : errors).push(`console.error: ${text}`);
      });
      page.on('response', (r) => {
        if (r.status() >= 400 && r.url().startsWith(origin) && !r.url().endsWith('/favicon.ico')) {
          const s = `HTTP ${r.status()} ${r.url()}`;
          (tolerated(s) ? soft : errors).push(s);
        }
      });
      await use(errors);
      if (soft.length) await testInfo.attach('tolerated-or-third-party', { body: soft.join('\n'), contentType: 'text/plain' });
      expect(errors, 'uncaught page errors / unexpected console errors / same-origin HTTP failures').toEqual([]);
    },
    { auto: true },
  ],
});

/** Recorded Photon/ASF (offline-safe) + every third-party raster tile host answered with a 1x1 PNG. Returns request logs. */
export async function stubExternal(page: Page) {
  const tiles: string[] = [];
  const handler = (r: Route) => {
    tiles.push(r.request().url());
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: PNG_1X1 });
  };
  await page.route('https://photon.komoot.io/**', (r) => r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: photonFixture }));
  await page.route('https://api.daac.asf.alaska.edu/**', (r) => r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: asfFixture }));
  await page.route('https://gibs.earthdata.nasa.gov/**', handler);
  await page.route('https://tiles.maps.eox.at/**', handler);
  await page.route('https://storage.googleapis.com/**', handler);
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', handler);
  return { tiles };
}

/** Open an investigation from the landing strip. */
export async function openInvestigation(page: Page, title: RegExp | string) {
  await page.getByRole('navigation', { name: 'Investigations' }).getByRole('button', { name: title }).click();
  await expect(page.locator('section.panel[aria-label$="investigation"]')).toBeVisible();
}

/** Make the (otherwise unconfigured) assistant talk to same-origin /api/assistant by patching the served
 *  adapter module in the browser only (no source change). The dev build has no VITE_ASSISTANT_GATEWAY_URL. */
export async function connectAssistantGateway(page: Page) {
  await page.route('**/src/assistant/adapter.ts*', async (route) => {
    const res = await route.fetch();
    const original = await res.text();
    const body = original.replace('const url = env.VITE_ASSISTANT_GATEWAY_URL;', "const url = '/';");
    // If the adapter source changes shape this patch silently does nothing and every "connected" test would test the wrong thing.
    if (body === original) throw new Error('connectAssistantGateway: adapter.ts no longer contains the expected createAdapter line; update the patch');
    await route.fulfill({ response: res, body });
  });
}
