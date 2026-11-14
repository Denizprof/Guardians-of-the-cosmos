// New spec for the redesigned shell. Behaviour under test:
//  - panels on demand (nothing open on landing; investigation / reported event / probe / about open one; clear close + Esc)
//  - popovers (investigations, filters) replace the permanent left rail
//  - the SAR lens: label, drag, resize, full screen, close, source switch inside an investigation
//  - reported-event panel: stored record + live provider record (recorded USGS fixture)
//  - regressions: swipe drag is a CSS variable, a date change right after enabling a layer wins, reduced motion stops the spin
// Third-party tiles are routed to a 1x1 PNG and Photon/ASF/USGS to recorded fixtures: no dependence on live services.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { FIX, aboutPanel, anyPanel, appReady, expect, featured, hashOf, openAbout, panel, probePanel, readData, strip, stubExternal, test } from './helpers';

const tools = (p: Page) => p.getByRole('toolbar', { name: 'Map tools' });
const tool = (p: Page, name: string | RegExp) => tools(p).getByRole('button', { name });
const lensFrame = (p: Page) => p.getByRole('group', { name: 'SAR lens', exact: true });
const cssVar = (p: Page, name: string) => p.evaluate((n) => parseFloat(getComputedStyle(document.querySelector('.app')!).getPropertyValue(n)), name);
const usgsFixture = fs.readFileSync(path.join(FIX, 'usgs-event-us6000u43g.fixture.json'), 'utf8');

/** Screen position of a stored context event after centring the map on it (the same path a real marker click takes). */
async function markerPoint(page: Page, lon: number, lat: number) {
  await page.waitForFunction(() => (window as any).__gsMaps?.a?.getSource?.('ctx'));
  return page.evaluate(
    async ([lo, la]) => {
      const a = (window as any).__gsMaps.a;
      a.jumpTo({ center: [lo, la], zoom: 8 });
      for (let i = 0; i < 80; i++) {
        const p = a.project([lo, la]);
        if (a.queryRenderedFeatures([p.x, p.y], { layers: ['ctx-points'] }).length) return { x: p.x, y: p.y };
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    },
    [lon, lat]
  );
}

test.describe('panels on demand', () => {
  test('landing shows the globe, the top bar and the investigations strip: no panel, no popover', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await expect(anyPanel(page)).toHaveCount(0);
    await expect(page.locator('aside.popover')).toHaveCount(0);
    for (const name of ['Investigations', 'Filters', /^Satellite layers/, 'SAR lens', 'Coverage probe', 'About Global SAR']) await expect(tool(page, name)).toBeVisible();
    expect(await strip(page).getByRole('button').count()).toBe(readData('events.json').events.length);
    // the map is not padded for a panel that is not there: the top bar spans the window
    const bar = (await page.locator('header.topbar').boundingBox())!;
    expect(bar.x + bar.width).toBeGreaterThan(1440 - 20);
  });

  test('selecting an investigation opens the panel; the close control and Escape both close it', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await featured(page, /Krasheninnikov/).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Krasheninnikov volcano');
    await expect(strip(page)).toHaveCount(0);
    // the top bar makes room for the panel
    const bar = (await page.locator('header.topbar').boundingBox())!;
    const pb = (await panel(page).boundingBox())!;
    expect(bar.x + bar.width).toBeLessThanOrEqual(pb.x);
    await panel(page).getByRole('button', { name: 'Close investigation' }).click();
    await expect(anyPanel(page)).toHaveCount(0);
    await featured(page, /Krasheninnikov/).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(anyPanel(page)).toHaveCount(0);
    await expect.poll(() => hashOf(page)).toBe('#/');
  });

  test('information hierarchy of the investigation panel: summary, compare, explanation, then provenance (collapsed) and references', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await featured(page, /Limpopo/).click();
    const heads = await panel(page).locator('.panel-body .section > h3, .panel-body .section > .row > h3, .panel-body .section > details > summary > span:first-child').allInnerTexts();
    const order = heads.map((h) => h.trim().toLowerCase());
    const at = (t: string) => order.findIndex((h) => h.startsWith(t));
    expect(at('what happened')).toBe(0);
    expect(at('compare')).toBe(1);
    expect(at('what the radar sees')).toBe(2);
    expect(at('data provenance')).toBeGreaterThan(at('what the radar sees'));
    expect(at('references')).toBeGreaterThan(at('data provenance'));
    // provenance is present but collapsed until asked for
    const prov = panel(page).locator('details.prov').first();
    await expect(prov).not.toHaveAttribute('open', '');
    await prov.locator('summary').click();
    await expect(prov.locator('dt', { hasText: 'Granule' })).toBeVisible();
  });

  test('the Investigations menu lists every investigation and opens the chosen one', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await tool(page, 'Investigations').click();
    const menu = page.getByRole('complementary', { name: 'Investigations list' });
    await expect(menu).toBeVisible();
    await expect(tool(page, 'Investigations')).toHaveAttribute('aria-expanded', 'true');
    expect(await menu.locator('button.inv-row').count()).toBe(readData('events.json').events.length);
    await menu.getByRole('button', { name: /Venezuela earthquakes/ }).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Venezuela earthquakes');
    await expect(menu).toHaveCount(0);
    // still reachable while an investigation is open (switching), and marks the current one
    await tool(page, 'Investigations').click();
    await expect(menu.getByRole('button', { name: /Venezuela earthquakes/ })).toHaveAttribute('aria-current', 'true');
    await menu.getByRole('button', { name: /Limpopo/ }).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Limpopo and Incomati floods');
  });

  test('Filters is a popover: opens from the top bar, only one popover at a time, Escape closes it before the panel', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    const filters = page.getByRole('complementary', { name: 'Map filters' });
    await tool(page, 'Filters').click();
    await expect(filters).toBeVisible();
    await expect(filters.getByRole('checkbox', { name: /Geohazards/ })).toBeChecked();
    await expect(filters.getByLabel('From year')).toHaveValue('1900');
    await expect(filters).toContainText('not satellite-confirmed here');
    await tool(page, /^Satellite layers/).click();
    await expect(filters).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Satellite layers' })).toBeVisible();
    // Escape: popover first, then the panel
    await featured(page, /Limpopo/).click();
    await expect(panel(page)).toBeVisible();
    await tool(page, 'Filters').click();
    await expect(filters).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(filters).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });

  test('typing in a filter input and pressing Escape there does not close the popover', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await tool(page, 'Filters').click();
    const from = page.getByLabel('From year');
    await from.fill('1990');
    await from.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Map filters' })).toBeVisible();
    await page.getByRole('button', { name: 'Close filters' }).click();
    await expect(page.getByRole('complementary', { name: 'Map filters' })).toHaveCount(0);
  });

  test('the year filter is debounced: one marker rebuild for a typed year, and the filter is applied', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await page.waitForFunction(() => (window as any).__gsMaps?.a?.getSource?.('ctx'));
    await page.waitForTimeout(1500); // default catalogs loaded
    await page.evaluate(() => {
      const s = (window as any).__gsMaps.a.getSource('ctx');
      const orig = s.setData.bind(s);
      (window as any).__ctxSets = [];
      s.setData = (d: any) => ((window as any).__ctxSets.push(d.features.length), orig(d));
    });
    await tool(page, 'Filters').click();
    const from = page.getByLabel('From year');
    await from.click();
    await from.press('Control+a');
    await from.pressSequentially('2020', { delay: 50 });
    await expect.poll(() => page.evaluate(() => (window as any).__ctxSets.length)).toBe(1);
    await page.waitForTimeout(700);
    const sets: number[] = await page.evaluate(() => (window as any).__ctxSets);
    expect(sets).toHaveLength(1); // not one per keystroke
    const tsunamis = readData('catalogs/noaa-tsunamis.json').events as { date: string }[];
    expect(tsunamis.some((e) => e.date < '2020')).toBe(true);
    const all: number = await page.evaluate(() => (window as any).__gsMaps.a.getSource('ctx').serialize().data.features.length);
    expect(all).toBe(sets[0]);
    expect(sets[0]).toBeLessThan(tsunamis.length + 3000); // the 1900-2019 tsunami records are gone
  });

  test('About opens on demand, lists the investigations and closes with its close control', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openAbout(page);
    await expect(tool(page, 'About Global SAR')).toHaveAttribute('aria-pressed', 'true');
    await expect(aboutPanel(page)).toContainText('Data package built');
    await aboutPanel(page).getByRole('button', { name: /Limpopo and Incomati floods/ }).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Limpopo and Incomati floods');
    await page.keyboard.press('Escape');
    await expect(anyPanel(page)).toHaveCount(0); // closing the investigation does not bring About back
    await openAbout(page);
    await aboutPanel(page).getByRole('button', { name: 'Close panel' }).click();
    await expect(anyPanel(page)).toHaveCount(0);
  });

  test('coverage probe: arming it and clicking the globe opens the probe panel for that spot; closing clears it', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await tool(page, 'Coverage probe').click();
    await expect(tool(page, 'Coverage probe')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Coverage probe on' })).toBeVisible();
    await expect(anyPanel(page)).toHaveCount(0); // arming alone opens nothing
    await page.mouse.click(720, 430); // centre of the globe
    await expect(probePanel(page)).toBeVisible();
    await expect(probePanel(page).getByRole('heading', { level: 2 })).toHaveText('What satellites recorded here');
    await expect(probePanel(page).getByText('NISAR data at this point')).toBeVisible();
    await expect(probePanel(page).locator('.coverage-list li').first()).toBeVisible();
    const focus = await page.evaluate(() => (window as any).__gsMaps.a.getSource('focus').serialize().data);
    expect(focus.geometry?.type).toBe('Point'); // the probed spot is ringed on the map
    await probePanel(page).getByRole('button', { name: 'Close panel' }).click();
    await expect(anyPanel(page)).toHaveCount(0);
    const cleared = await page.evaluate(() => (window as any).__gsMaps.a.getSource('focus').serialize().data);
    expect(cleared.features ?? []).toEqual([]);
  });

  test('a click on the globe without the probe armed opens nothing', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await page.waitForFunction(() => (window as any).__gsMaps?.a?.getSource?.('ctx'));
    await page.mouse.click(100, 450); // empty space left of the globe
    await page.waitForTimeout(500);
    await expect(anyPanel(page)).toHaveCount(0);
  });
});

test.describe('reported event panel (catalog / context events)', () => {
  const ctx = readData('context.json').events as { id: string; title: string; lon: number; lat: number; source: string; url: string }[];
  const quake = ctx.find((e) => e.id.startsWith('usgs-'))!;

  test('clicking a reported earthquake opens its full stored record and the live USGS record (recorded fixture)', async ({ page }) => {
    await stubExternal(page);
    const calls: string[] = [];
    await page.route('https://earthquake.usgs.gov/fdsnws/**', (r) => {
      calls.push(r.request().url());
      return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: usgsFixture });
    });
    await appReady(page);
    const pt = await markerPoint(page, quake.lon, quake.lat);
    expect(pt, 'marker rendered').not.toBeNull();
    await page.mouse.click(pt!.x, pt!.y);
    const p = page.locator('section.panel[aria-label$="reported event"]');
    await expect(p.getByRole('heading', { level: 2 })).toHaveText(quake.title);
    await expect(p).toContainText('Reported event from a catalog. Not analyzed or confirmed by satellite in this app.');
    // stored record: labelled key/value list
    const stored = p.locator('.section', { hasText: 'Stored record' });
    for (const dt of ['Type', 'Date (UTC)', 'Location', 'Magnitude', 'Source', 'Source link', 'Record id']) await expect(stored.locator('dt', { hasText: new RegExp(`^${dt.replace(/[()]/g, '\\$&')}$`) })).toBeVisible();
    await expect(stored.locator('dt', { hasText: /^Record id$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(quake.id);
    // live record from the provider API
    const live = p.locator('details.live-record');
    await expect(live.locator('dt', { hasText: 'Felt reports (DYFI)' })).toBeVisible();
    await expect(live.locator('dt', { hasText: 'PAGER alert level' }).locator('xpath=following-sibling::dd[1]')).toHaveText('orange');
    await expect(live).toContainText('Products');
    // one event, one endpoint (React StrictMode in the dev build mounts effects twice: the first request is aborted)
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(new Set(calls).size).toBe(1);
    expect(new URL(calls[0]).searchParams.get('eventid')).toBe(quake.id.replace(/^usgs-/, ''));
    // every link in the panel is http(s) and opens safely
    for (const a of await p.getByRole('link').all()) {
      expect(await a.getAttribute('href')).toMatch(/^https?:\/\//);
      expect(await a.getAttribute('rel')).toContain('noopener');
    }
    // the collapsible section collapses
    await live.locator('summary').click();
    await expect(live.locator('dt', { hasText: 'Felt reports (DYFI)' })).toBeHidden();
    await p.getByRole('button', { name: 'Close event details' }).click();
    await expect(anyPanel(page)).toHaveCount(0);
  });

  test('provider outage: the error is shown with a retry, the stored record stays', async ({ page, allow }) => {
    allow.console.push(/earthquake\.usgs\.gov/);
    await stubExternal(page);
    let up = false;
    await page.route('https://earthquake.usgs.gov/fdsnws/**', (r) =>
      up
        ? r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: usgsFixture })
        : r.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'Service Unavailable' })
    );
    await appReady(page);
    const pt = await markerPoint(page, quake.lon, quake.lat);
    await page.mouse.click(pt!.x, pt!.y);
    const p = page.locator('section.panel[aria-label$="reported event"]');
    await expect(p.getByRole('alert')).toContainText('USGS ComCat request failed (HTTP 503)');
    await expect(p.locator('dt', { hasText: /^Record id$/ })).toBeVisible();
    up = true;
    await p.getByRole('button', { name: 'Retry' }).click();
    await expect(p.locator('dt', { hasText: 'Felt reports (DYFI)' })).toBeVisible();
  });

  test('"Satellite data here?" switches the panel to the coverage probe for that event', async ({ page }) => {
    await stubExternal(page);
    await page.route('https://earthquake.usgs.gov/fdsnws/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: usgsFixture }));
    await page.route('https://cmr.earthdata.nasa.gov/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"feed":{"entry":[]}}' }));
    await appReady(page);
    const pt = await markerPoint(page, quake.lon, quake.lat);
    await page.mouse.click(pt!.x, pt!.y);
    await page.getByRole('button', { name: 'Satellite data here?' }).click();
    await expect(probePanel(page).getByText('NISAR data at this point')).toBeVisible();
    await expect(page.locator('section.panel')).toHaveCount(1);
  });
});

test.describe('SAR lens', () => {
  const openLens = async (page: Page) => {
    await tool(page, 'SAR lens').click();
    await expect(lensFrame(page)).toBeVisible();
    await expect(page.locator('.map.lens[data-ready="true"] canvas')).toBeAttached();
  };

  test('off by default; turning it on shows a labelled square with a camera-synced SAR map clipped to it', async ({ page }) => {
    const { tiles } = await stubExternal(page);
    await appReady(page);
    await expect(lensFrame(page)).toHaveCount(0);
    await expect(page.locator('.map.lens')).toHaveCount(0); // no third map (and no WebGL context) until asked for
    await openLens(page);
    await expect(tool(page, 'SAR lens')).toHaveAttribute('aria-pressed', 'true');
    // label: "SAR view: <source, date>" + honest partial-coverage note + provenance tooltip
    const label = lensFrame(page).locator('.lens-label');
    await expect(label).toHaveText(/^SAR view: NISAR over Sentinel-1 radar, \d{1,2}( \w{3} \d{4})? to \d{1,2} \w{3} \d{4}$/);
    await expect(lensFrame(page).locator('.lens-note')).toHaveText(/gaps/);
    expect(await label.getAttribute('title')).toMatch(/NISAR L2 GCOV[\s\S]*OPERA L2 RTC-S1[\s\S]*NASA GIBS/);
    // the frame is a square and the lens map is clipped to exactly that square
    const box = (await lensFrame(page).boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
    const clip = await page.locator('.map.lens').evaluate((el) => getComputedStyle(el).clipPath);
    expect(clip).toMatch(/^inset\(/);
    const [x, y, s] = [await cssVar(page, '--lens-x'), await cssVar(page, '--lens-y'), await cssVar(page, '--lens-s')];
    expect(Math.abs(box.x - x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - s)).toBeLessThanOrEqual(2);
    // same camera as the main globe, also after the globe moves
    await page.evaluate(() => (window as any).__gsMaps.a.jumpTo({ center: [30, -20], zoom: 4.2, bearing: 12, pitch: 20 }));
    const cams = await page.evaluate(() => {
      const { a, lens } = (window as any).__gsMaps;
      const cam = (m: any) => [m.getCenter().lng, m.getCenter().lat, m.getZoom(), m.getBearing(), m.getPitch()].map((v: number) => +v.toFixed(4));
      return { a: cam(a), lens: cam(lens) };
    });
    expect(cams.lens).toEqual(cams.a);
    // SAR-only basemap: NISAR and Sentinel-1 tiles are requested, with real dates, and no optical basemap in the lens style
    await expect.poll(() => tiles.some((u) => u.includes('NISAR_L2_Geocoded_Polarimetric_Covariance')) && tiles.some((u) => u.includes('OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1')), { timeout: 30_000 }).toBe(true);
    const sar = tiles.find((u) => u.includes('NISAR_L2_Geocoded_Polarimetric_Covariance'))!;
    expect(sar).toMatch(/\/default\/\d{4}-\d{2}-\d{2}\/GoogleMapsCompatible_Level13\/\d+\/\d+\/\d+\.png$/);
    const lensSources: string[] = await page.evaluate(() => Object.keys((window as any).__gsMaps.lens.getStyle().sources));
    expect(lensSources).not.toContain('satellite');
    expect(lensSources.filter((id) => id.startsWith('lens-')).length).toBeGreaterThanOrEqual(2);
  });

  test('drag by the bar moves the square (and its clip); the globe underneath does not pan', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLens(page);
    const before = (await lensFrame(page).boundingBox())!;
    const centre = await page.evaluate(() => (window as any).__gsMaps.a.getCenter().lng);
    const grip = (await lensFrame(page).getByRole('button', { name: /Move SAR lens/ }).boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 180, grip.y + grip.height / 2 + 90, { steps: 10 });
    // the square follows while the button is still down (CSS variable, no commit needed)
    await expect.poll(async () => (await lensFrame(page).boundingBox())!.x).toBeLessThan(before.x - 150);
    await page.mouse.up();
    const after = (await lensFrame(page).boundingBox())!;
    expect(Math.round(after.x - before.x)).toBe(-180);
    expect(Math.round(after.y - before.y)).toBe(90);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    expect(Math.abs((await cssVar(page, '--lens-x')) - after.x)).toBeLessThanOrEqual(1);
    // the drag did not pan the globe (the idle spin is stopped while the lens is open)
    expect(await page.evaluate(() => (window as any).__gsMaps.a.getCenter().lng)).toBeCloseTo(centre, 3);
  });

  test('the globe can still be panned through the square (the lens does not swallow map gestures)', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLens(page);
    const box = (await lensFrame(page).boundingBox())!;
    const lng0 = await page.evaluate(() => (window as any).__gsMaps.a.getCenter().lng);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as any).__gsMaps.a.getCenter().lng)).not.toBeCloseTo(lng0, 1);
    const moved = (await lensFrame(page).boundingBox())!;
    expect(Math.abs(moved.x - box.x)).toBeLessThanOrEqual(1); // the square stayed put
  });

  test('resize by the corner handle and by keyboard, within limits', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLens(page);
    const b0 = (await lensFrame(page).boundingBox())!;
    const handle = lensFrame(page).getByRole('button', { name: /Resize SAR lens/ });
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + 100, h.y + h.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    const b1 = (await lensFrame(page).boundingBox())!;
    expect(Math.round(b1.width - b0.width)).toBe(100); // the larger axis wins, the square stays square
    expect(Math.abs(b1.width - b1.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(b1.x - b0.x)).toBeLessThanOrEqual(1); // anchored at its top-left corner
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Math.round((await lensFrame(page).boundingBox())!.width - b1.width)).toBe(-16);
    for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => Math.round((await lensFrame(page).boundingBox())!.width)).toBe(140); // minimum size
    // keyboard move
    const b2 = (await lensFrame(page).boundingBox())!;
    await lensFrame(page).getByRole('button', { name: /Move SAR lens/ }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => Math.round((await lensFrame(page).boundingBox())!.x - b2.x)).toBe(16);
    expect(Math.round((await lensFrame(page).boundingBox())!.y - b2.y)).toBe(16);
  });

  test('expand to the whole screen and back; Escape also leaves full screen; the square keeps its place', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLens(page);
    const b0 = (await lensFrame(page).boundingBox())!;
    await lensFrame(page).getByRole('button', { name: 'Expand SAR lens to full screen' }).click();
    await expect.poll(() => page.locator('.map.lens').evaluate((el) => getComputedStyle(el).clipPath)).toBe('none');
    const full = (await lensFrame(page).boundingBox())!;
    expect(full.width).toBe(1440);
    expect(full.height).toBe(900);
    await expect(lensFrame(page).getByRole('button', { name: /Move SAR lens/ })).toHaveCount(0);
    await expect(lensFrame(page).locator('.lens-label')).toBeVisible(); // still labelled in full screen
    await lensFrame(page).getByRole('button', { name: 'Restore SAR lens to a square' }).click();
    const b1 = (await lensFrame(page).boundingBox())!;
    expect([Math.round(b1.x), Math.round(b1.y), Math.round(b1.width)]).toEqual([Math.round(b0.x), Math.round(b0.y), Math.round(b0.width)]);
    await lensFrame(page).getByRole('button', { name: 'Expand SAR lens to full screen' }).click();
    await page.keyboard.press('Escape');
    await expect(lensFrame(page).getByRole('button', { name: 'Expand SAR lens to full screen' })).toBeVisible();
    await expect(lensFrame(page)).toBeVisible(); // Escape left full screen, it did not close the lens
  });

  test('provenance popover and close; closing removes the SAR map', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLens(page);
    const info = lensFrame(page).getByRole('button', { name: 'SAR view data provenance' });
    await info.click();
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expect(lensFrame(page).getByRole('note')).toContainText('no global composite exists');
    await expect(lensFrame(page).getByRole('note')).toContainText('NISAR / OPERA (Sentinel-1) imagery via NASA GIBS');
    await lensFrame(page).getByRole('button', { name: 'Close SAR lens' }).click();
    await expect(lensFrame(page)).toHaveCount(0);
    await expect(page.locator('.map.lens')).toHaveCount(0);
    await expect(tool(page, 'SAR lens')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => 'lens' in (window as any).__gsMaps)).toBe(false);
    // reopening puts it back where it was
    await openLens(page);
  });

  test('inside an investigation the lens can show that investigation\'s NISAR layer and stays clear of the panel', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await openLens(page);
    await expect(lensFrame(page).getByRole('group', { name: 'SAR lens source' })).toHaveCount(0); // nothing to choose on the landing globe
    await featured(page, /Limpopo/).click();
    await expect(panel(page)).toBeVisible();
    const pb = (await panel(page).boundingBox())!;
    const lb = (await lensFrame(page).boundingBox())!;
    expect(lb.x + lb.width).toBeLessThanOrEqual(pb.x);
    const src = lensFrame(page).getByRole('group', { name: 'SAR lens source' });
    await expect(src.getByRole('button', { name: 'Global mosaic' })).toHaveAttribute('aria-pressed', 'true');
    await src.getByRole('button', { name: 'This investigation' }).click();
    await expect(lensFrame(page).locator('.lens-label')).toHaveText(/^SAR view: NISAR GCOV \(this investigation\), \d{1,2} \w{3} \d{4}/);
    const after = new URLSearchParams(hashOf(page).split('?')[1]).get('a')!;
    await expect.poll(() => page.evaluate((id) => !!(window as any).__gsMaps.lens.getLayer(`sar-${id}`), after)).toBe(true);
    // it follows the After layer
    await panel(page).getByRole('combobox', { name: 'After observation' }).selectOption('gcov_20260105');
    await expect.poll(() => page.evaluate(() => !!(window as any).__gsMaps.lens.getLayer('sar-gcov_20260105'))).toBe(true);
    expect(await page.evaluate((id) => !!(window as any).__gsMaps.lens.getLayer(`sar-${id}`), after)).toBe(false);
    // closing the investigation drops the investigation layer from the lens
    await page.keyboard.press('Escape');
    await expect(lensFrame(page).locator('.lens-label')).toHaveText(/^SAR view: NISAR over Sentinel-1 radar/);
    await expect.poll(() => page.evaluate(() => (window as any).__gsMaps.lens.getStyle().layers.some((l: any) => l.id.startsWith('sar-')))).toBe(false);
  });
});

test.describe('rendering regressions', () => {
  test('swipe: the divider is a CSS variable that moves during the drag; opening an investigation does not rebuild the markers', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await page.waitForFunction(() => (window as any).__gsMaps?.a?.getSource?.('ctx'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      (window as any).__sets = 0;
      for (const id of ['ctx', 'sar']) {
        const s = (window as any).__gsMaps.a.getSource(id);
        const orig = s.setData.bind(s);
        s.setData = (d: any) => ((window as any).__sets++, orig(d));
      }
    });
    await featured(page, /Limpopo/).click();
    await expect(panel(page)).toBeVisible();
    const grip = page.locator('.swipe-handle .grip');
    await expect(grip).toBeVisible();
    const x0 = await cssVar(page, '--swipe-x');
    const b = (await grip.boundingBox())!;
    expect(Math.abs(b.x + b.width / 2 - x0)).toBeLessThanOrEqual(1);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 150, b.y + b.height / 2, { steps: 10 });
    await expect.poll(() => cssVar(page, '--swipe-x')).toBe(Math.round(x0 - 150)); // before the button is released
    expect(await page.locator('.map.b').evaluate((el) => getComputedStyle(el).clipPath)).toBe(`inset(0px 0px 0px ${Math.round(x0 - 150)}px)`);
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__sets)).toBe(0); // visibility toggles only
    // and the context markers are visible again after closing
    expect(await page.evaluate(() => (window as any).__gsMaps.a.getLayoutProperty('ctx-points', 'visibility'))).toBe('visible');
  });

  test('a date change made right after enabling a layer wins (no stale tiles source)', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    const layer = (readData('layers.json').layers as { id: string; title: string }[]).find((l) => /Daily true-colour Earth/.test(l.title))!;
    await tool(page, /^Satellite layers/).click();
    const pop = page.getByRole('complementary', { name: 'Satellite layers' });
    for (const day of ['2024-03-15', '2023-07-01', '2022-12-25']) {
      await pop.getByRole('checkbox', { name: /Daily true-colour Earth/ }).check();
      await pop.getByLabel(/Daily true-colour Earth.*date/).fill(day); // immediately: the source has not loaded yet
      await expect
        .poll(() => page.evaluate((id) => (window as any).__gsMaps.a.getStyle().sources[`ov-${id}`]?.tiles?.[0] ?? null, layer.id))
        .toContain(`/default/${day}/`);
      await pop.getByRole('checkbox', { name: /Daily true-colour Earth/ }).uncheck();
      await expect.poll(() => page.evaluate((id) => !!(window as any).__gsMaps.a.getSource(`ov-${id}`), layer.id)).toBe(false);
    }
  });

  test('prefers-reduced-motion: the landing globe does not spin', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stubExternal(page);
    await appReady(page);
    await page.waitForFunction(() => (window as any).__gsMaps?.a);
    const c0 = await page.evaluate(() => (window as any).__gsMaps.a.getCenter().lng);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as any).__gsMaps.a.getCenter().lng)).toBe(c0);
  });

  test('without the preference the globe turns, and turning the preference on stops it (matchMedia change listener)', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await page.waitForFunction(() => (window as any).__gsMaps?.a);
    const c0 = await page.evaluate(() => (window as any).__gsMaps.a.getCenter().lng);
    await expect.poll(() => page.evaluate(() => (window as any).__gsMaps.a.getCenter().lng)).not.toBe(c0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(300);
    const c1 = await page.evaluate(() => (window as any).__gsMaps.a.getCenter().lng);
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => (window as any).__gsMaps.a.getCenter().lng)).toBe(c1);
  });
});
