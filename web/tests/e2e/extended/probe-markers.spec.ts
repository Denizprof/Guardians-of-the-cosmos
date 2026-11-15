// Coverage probe and map markers. Behaviour under test:
//  - while the probe is on, a click on the globe is ALWAYS a probe, also when it lands on an investigation
//    marker, a cluster or a reported-event dot (before: the investigation opened and the probe was switched
//    off; the cluster only zoomed; the reported event replaced the result)
//  - with the probe off the markers behave as before
//  - a click that is not on the visible globe (the black space round it) does nothing in either mode
// Returning visitor, reduced motion (the globe does not spin). ASF is answered by a recorded fixture and
// every request to it is counted; third-party tiles are 1x1 PNGs. Uses window.__gsMaps (dev build only).
import type { Page } from '@playwright/test';
import { asfFixture as asfBody } from '../fixtures';
import { anyPanel, appReady, expect, hashOf, panel, probePanel, readData, stubExternal, test } from './helpers';

const probeButton = (p: Page) => p.locator('[data-tut="probe"]');
const CLICKABLE = ['sar-points', 'sar-halo', 'ctx-points', 'ctx-clusters'];

async function start(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubExternal(page);
  const asf: string[] = [];
  await page.route('https://api.daac.asf.alaska.edu/**', (r) => {
    asf.push(r.request().url());
    return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: asfBody });
  });
  await appReady(page);
  await page.waitForFunction(() => (window as any).__gsMaps?.a?.getSource?.('ctx') && (window as any).__gsMaps.a.getSource('sar'));
  return asf;
}

/**
 * A page position that lies on a rendered marker of one of `layers`: the marker is the top hit of the app's own
 * hit-test there, it is on the near side of the globe and no other element covers the canvas at that position.
 * `at` first moves the camera (needed for single reported-event dots, which are clustered in the home view).
 */
async function markerPoint(page: Page, layers: string[], at?: { lon: number; lat: number; zoom: number }) {
  return page.evaluate(
    async ([wanted, clickable, to]) => {
      const a = (window as any).__gsMaps.a;
      if (to) a.jumpTo({ center: [to.lon, to.lat], zoom: to.zoom });
      const canvas = a.getCanvas() as HTMLCanvasElement;
      const source = wanted[0].startsWith('sar') ? 'sar' : 'ctx';
      for (let i = 0; i < 80; i++) {
        const rect = canvas.getBoundingClientRect();
        for (const f of a.querySourceFeatures(source)) {
          const c = f.geometry.coordinates as [number, number];
          const p = a.project(c);
          const back = a.unproject(p);
          if (Math.abs(back.lat - c[1]) > 2 || Math.abs(((back.lng - c[0] + 540) % 360) - 180) > 2) continue; // far side
          const x = rect.left + p.x;
          const y = rect.top + p.y;
          if (document.elementFromPoint(x, y) !== canvas) continue;
          const top = a.queryRenderedFeatures([p.x, p.y], { layers: clickable.filter((id: string) => a.getLayer(id)) })[0];
          if (!top || !wanted.includes(top.layer.id)) continue;
          return { x, y, id: top.properties.id == null ? null : String(top.properties.id) };
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    },
    [layers, CLICKABLE, at ?? null] as const
  );
}

/** Page positions over the map canvas that are NOT on the visible globe (round trip through the projection moves them). */
async function offGlobePoints(page: Page) {
  return page.evaluate((clickable) => {
    const a = (window as any).__gsMaps.a;
    const canvas = a.getCanvas() as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const out: { x: number; y: number; off: number; hits: number }[] = [];
    for (let y = 20; y < rect.height - 20; y += 40) {
      for (let x = 20; x < rect.width - 20; x += 40) {
        if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) continue;
        const q = a.project(a.unproject([x, y]));
        const off = Math.hypot(q.x - x, q.y - y);
        if (!(off > 30)) continue;
        const hits = a.queryRenderedFeatures([x, y], { layers: clickable.filter((id: string) => a.getLayer(id)) }).length;
        out.push({ x: rect.left + x, y: rect.top + y, off: Math.round(off), hits });
      }
    }
    return out;
  }, CLICKABLE);
}

const camera = (page: Page) =>
  page.evaluate(() => {
    const a = (window as any).__gsMaps.a;
    const c = a.getCenter();
    return { lng: +c.lng.toFixed(4), lat: +c.lat.toFixed(4), zoom: +a.getZoom().toFixed(4) };
  });

async function expectProbed(page: Page, asf: string[]) {
  await expect(probePanel(page)).toBeVisible();
  await expect(probePanel(page).getByText('NISAR data at this point')).toBeVisible();
  expect(asf, 'exactly one ASF search').toHaveLength(1);
  await expect(anyPanel(page)).toHaveCount(1);
  expect(hashOf(page)).not.toMatch(/^#\/e\//);
  await expect(probeButton(page)).toBeVisible();
  await expect(probeButton(page)).toHaveAttribute('aria-pressed', 'true');
}

test.describe('coverage probe on: a click on the globe is always a probe', () => {
  test('on an investigation marker: probes there, the investigation does not open and the probe stays on', async ({ page }) => {
    const asf = await start(page);
    const pt = await markerPoint(page, ['sar-points', 'sar-halo']);
    expect(pt, 'an investigation marker is on screen').not.toBeNull();
    await probeButton(page).click();
    await expect(probeButton(page)).toHaveAttribute('aria-pressed', 'true');
    // the cursor does not promise a marker click while probing
    await page.mouse.move(pt!.x - 60, pt!.y - 60);
    await page.mouse.move(pt!.x, pt!.y, { steps: 6 });
    expect.soft(await page.evaluate(() => getComputedStyle((window as any).__gsMaps.a.getCanvas()).cursor)).toBe('crosshair');
    await page.mouse.click(pt!.x, pt!.y);
    await expectProbed(page, asf);
    await expect(panel(page)).toHaveCount(0);
  });

  test('on a cluster: probes there and the camera does not move', async ({ page }) => {
    const asf = await start(page);
    const pt = await markerPoint(page, ['ctx-clusters']);
    expect(pt, 'a cluster is on screen').not.toBeNull();
    await probeButton(page).click();
    const before = await camera(page);
    await page.mouse.click(pt!.x, pt!.y);
    await expectProbed(page, asf);
    await page.waitForTimeout(1000); // a cluster click used to ease the camera for 0..700 ms
    expect(await camera(page)).toEqual(before);
  });

  test('on a reported-event dot: probes there, the reported event does not open', async ({ page }) => {
    const asf = await start(page);
    const ctx = readData('context.json').events as { id: string; lon: number; lat: number }[];
    const quake = ctx.find((e) => e.id.startsWith('usgs-'))!;
    const pt = await markerPoint(page, ['ctx-points'], { lon: quake.lon, lat: quake.lat, zoom: 8 });
    expect(pt, 'a reported-event dot is on screen').not.toBeNull();
    await probeButton(page).click();
    await page.mouse.click(pt!.x, pt!.y);
    await expectProbed(page, asf);
    await expect(page.locator('section.panel[aria-label$="reported event"]')).toHaveCount(0);
  });
});

test.describe('coverage probe off: markers behave as before', () => {
  test('an investigation marker opens its investigation', async ({ page }) => {
    const asf = await start(page);
    const pt = await markerPoint(page, ['sar-points', 'sar-halo']);
    expect(pt, 'an investigation marker is on screen').not.toBeNull();
    await page.mouse.move(pt!.x - 60, pt!.y - 60);
    await page.mouse.move(pt!.x, pt!.y, { steps: 6 });
    expect(await page.evaluate(() => getComputedStyle((window as any).__gsMaps.a.getCanvas()).cursor)).toBe('pointer');
    await page.mouse.click(pt!.x, pt!.y);
    await expect(panel(page)).toBeVisible();
    await expect.poll(() => hashOf(page)).toMatch(new RegExp(`^#/e/${pt!.id}`));
    expect(asf).toHaveLength(0);
  });
});

test.describe('a click that is not on the visible globe does nothing', () => {
  for (const probing of [true, false]) {
    test(`probe ${probing ? 'on' : 'off'}: no search, no panel, no camera move`, async ({ page }) => {
      const asf = await start(page);
      // With the probe off a click on empty space never did anything, so this case only proves something at
      // off-globe points where the app's hit-test finds a marker of the far side: wait until the markers are
      // drawn and there are such points (the test fails here, loudly, if the view no longer has any).
      let all: Awaited<ReturnType<typeof offGlobePoints>> = [];
      await expect
        .poll(async () => (all = await offGlobePoints(page)).filter((p) => p.hits > 0).length, { message: 'off-globe points with a hidden marker under them', timeout: 20_000 })
        .toBeGreaterThan(0);
      // the points furthest from the disc, plus off-globe points with a marker hit, spread over the view
      const far = [...all].sort((p, q) => q.off - p.off).slice(0, 4);
      const hidden = all.filter((p) => p.hits > 0);
      const onHidden = hidden.filter((_, i) => i % Math.ceil(hidden.length / 4) === 0).slice(0, 4);
      test.info().annotations.push({ type: 'off-globe points', description: `${all.length} found, ${hidden.length} with a marker hit` });
      if (probing) await probeButton(page).click();
      const before = await camera(page);
      const hash = hashOf(page);
      for (const pt of [...far, ...onHidden]) {
        // the cursor does not promise a click there either
        await page.mouse.move(pt.x - 25, pt.y - 25);
        await page.mouse.move(pt.x, pt.y, { steps: 5 });
        expect(await page.evaluate(() => getComputedStyle((window as any).__gsMaps.a.getCanvas()).cursor), `cursor at ${pt.x},${pt.y}`).not.toBe('pointer');
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(1000);
        expect(asf, `ASF searches after a click at ${pt.x},${pt.y}`).toHaveLength(0);
        await expect(anyPanel(page)).toHaveCount(0);
        expect(await camera(page)).toEqual(before);
        expect(hashOf(page)).toBe(hash);
      }
      if (probing) await expect(probeButton(page)).toHaveAttribute('aria-pressed', 'true');
    });
  }
});
