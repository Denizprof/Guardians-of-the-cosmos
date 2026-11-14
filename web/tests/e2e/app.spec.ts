import { aboutPanel, anyPanel, appReady, expect, featured, hashOf, hashParams, mockServices, openAbout, panel, probePanel, strip, test } from './fixtures';

test.describe('landing page', () => {
  test('loads, shows the globe canvas, the brand and the investigations list', async ({ page }) => {
    await appReady(page);
    await expect(page).toHaveTitle(/Global SAR/);
    await expect(page.getByText('GLOBAL SAR', { exact: true })).toBeVisible();
    const canvas = page.locator('.maplibregl-canvas').first();
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(400);
    expect(box!.height).toBeGreaterThan(400);
    // the landing strip offers the curated investigations
    for (const t of [/Venezuela earthquakes/, /Limpopo and Incomati floods/, /Krasheninnikov volcano/]) await expect(featured(page, t)).toBeVisible();
    // panels are on demand: nothing is open on landing
    await expect(anyPanel(page)).toHaveCount(0);
    // landing URL is the clean root state
    expect(['', '#/']).toContain(hashOf(page));
  });

  test('WebGL actually rendered something (canvas is not blank)', async ({ page }) => {
    await appReady(page);
    await page.waitForTimeout(3000);
    const png = await page.locator('.maplibregl-canvas').first().screenshot();
    // a blank/transparent canvas compresses to a tiny PNG; a rendered globe is much larger
    expect(png.length).toBeGreaterThan(20_000);
  });

  test('the page declares a favicon that exists (no 404 console error on every load)', async ({ page, request }) => {
    // ISSUE-QA-18 (fixed during the audit: favicon.svg added): regression test.
    await appReady(page);
    const href = (await page.locator('link[rel~="icon"]').first().getAttribute('href', { timeout: 1000 }).catch(() => null)) ?? '/favicon.ico';
    const res = await request.get(new URL(href, page.url()).toString());
    expect(res.status()).toBe(200);
  });

  test('the About panel (opened from the top bar) explains the app and the data package date', async ({ page }) => {
    await appReady(page);
    await openAbout(page);
    const intro = aboutPanel(page);
    await expect(intro.getByRole('heading', { level: 2 })).toContainText('See what happened');
    await expect(intro).toContainText('NISAR');
    await expect(intro).toContainText('Data package built');
  });
});

test.describe('event selection', () => {
  test('clicking an investigation in the landing strip opens its panel and sets the URL hash', async ({ page }) => {
    await appReady(page);
    await featured(page, /Venezuela earthquakes/).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Venezuela earthquakes');
    await expect.poll(() => hashOf(page)).toMatch(/^#\/e\/venezuela-2026\?/);
    const q = hashParams(page);
    expect(q.get('mode')).toBe('swipe');
    expect(q.get('b')).toBeTruthy();
    expect(q.get('a')).toBeTruthy();
    expect(q.get('b')).not.toBe(q.get('a'));
    await expect(page.getByRole('group', { name: 'Observation timeline' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Swipe between before and after' })).toBeAttached();
  });

  test('every curated investigation opens without errors and has provenance', async ({ page }) => {
    await appReady(page);
    for (const [title, id] of [[/Venezuela/, 'venezuela-2026'], [/Limpopo/, 'mozambique-floods-2026'], [/Krasheninnikov/, 'krasheninnikov-2026']] as const) {
      await featured(page, title).click();
      await expect.poll(() => hashOf(page)).toContain(`#/e/${id}`);
      await expect(panel(page).locator('details.prov').first()).toBeAttached();
      await page.keyboard.press('Escape');
      await expect.poll(() => hashOf(page)).toBe('#/');
    }
  });

  test('Escape closes the investigation and restores the landing view and a clean hash', async ({ page }) => {
    await appReady(page);
    await featured(page, /Limpopo/).click();
    await expect(panel(page)).toBeVisible();
    await expect(strip(page)).toHaveCount(0); // the strip steps aside while a panel is open
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(anyPanel(page)).toHaveCount(0);
    await expect(featured(page, /Limpopo/)).toBeVisible();
    await expect.poll(() => hashOf(page)).toBe('#/');
  });

  test('the close button does the same as Escape', async ({ page }) => {
    await appReady(page);
    await featured(page, /Limpopo/).click();
    await page.getByRole('button', { name: 'Close investigation' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => hashOf(page)).toBe('#/');
  });

  test('Escape while typing in the search box does not close the open investigation', async ({ page }) => {
    await appReady(page);
    await featured(page, /Limpopo/).click();
    await page.getByRole('combobox', { name: /Search places/ }).fill('abc');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeVisible();
  });

  test('browser Back after opening an investigation returns to the landing state', async ({ page }) => {
    await appReady(page);
    await featured(page, /Limpopo/).click();
    await expect(panel(page)).toBeVisible();
    await page.goBack();
    // ISSUE-QA-07 (fixed during the audit): the app used history.replaceState, so Back left the site (about:blank).
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => hashOf(page)).toBe('#/');
    await expect(anyPanel(page)).toHaveCount(0);
    await expect(featured(page, /Limpopo/)).toBeVisible();
  });
});

test.describe('compare modes', () => {
  test.beforeEach(async ({ page }) => {
    await appReady(page);
    await featured(page, /Limpopo/).click();
    await expect(panel(page)).toBeVisible();
  });

  test('swipe (default): handle is shown, both labels, ArrowRight and dragging move the divider', async ({ page }) => {
    const handle = page.getByRole('slider', { name: 'Swipe between before and after' });
    // NOTE: the slider element itself is a 0px-wide line (only its child "grip" has a box). See ISSUE-QA-19.
    await expect(handle).toBeAttached();
    const grip = page.locator('.swipe-handle .grip');
    await expect(grip).toBeVisible();
    await expect(page.locator('.map-tag', { hasText: /^BEFORE/ })).toBeVisible();
    await expect(page.locator('.map-tag', { hasText: /^AFTER/ })).toBeVisible();
    // the app moves focus to the panel heading shortly after the panel opens; focusing the handle before that would be undone
    await expect(page.locator('section.panel h2')).toBeFocused();
    const v0 = Number(await handle.getAttribute('aria-valuenow'));
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(v0);
    const v1 = Number(await handle.getAttribute('aria-valuenow'));
    // the grip glides to its new position (CSS transition); grab it only once it has stopped moving, else the press misses it
    let last = '';
    await expect.poll(async () => { const cur = JSON.stringify(await grip.boundingBox()); const same = cur === last; last = cur; return same; }, { intervals: [100] }).toBe(true);
    const b = (await grip.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x - 200, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeLessThan(v1);
  });

  test('side by side: no swipe handle, two labels, mode in URL', async ({ page }) => {
    await page.getByRole('group', { name: 'Comparison mode' }).getByRole('button', { name: 'Side by side' }).click();
    await expect(page.getByRole('group', { name: 'Comparison mode' }).getByRole('button', { name: 'Side by side' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('slider', { name: 'Swipe between before and after' })).toHaveCount(0);
    await expect(page.locator('.map-tag')).toHaveCount(2);
    await expect.poll(() => hashParams(page).get('mode')).toBe('side');
  });

  test('overlay: opacity slider appears, label follows it, mode in URL', async ({ page }) => {
    await page.getByRole('group', { name: 'Comparison mode' }).getByRole('button', { name: 'Overlay' }).click();
    const slider = panel(page).locator('input[type=range]');
    await expect(slider).toBeVisible();
    await slider.fill('0.8');
    await expect(panel(page)).toContainText('After opacity 80%');
    await expect(page.locator('.map-tag')).toContainText('at 80%');
    await expect.poll(() => hashParams(page).get('mode')).toBe('overlay');
    // and back to swipe
    await page.getByRole('group', { name: 'Comparison mode' }).getByRole('button', { name: 'Swipe' }).click();
    await expect(page.getByRole('slider', { name: 'Swipe between before and after' })).toBeAttached();
    await expect.poll(() => hashParams(page).get('mode')).toBe('swipe');
  });

  test('simple/scientific toggle swaps the explanation and is stored in the URL', async ({ page }) => {
    const list = panel(page).locator('.explain ul').first();
    const simple = await list.innerText();
    await panel(page).locator('.explain').getByRole('group', { name: 'Explanation level' }).getByRole('button', { name: 'Scientific' }).click();
    await expect.poll(() => hashParams(page).get('lvl')).toBe('scientific');
    expect(await list.innerText()).not.toBe(simple);
  });
});

test.describe('timeline', () => {
  // The Krasheninnikov series has 11 dated observations, so there is always an idle date to click.
  // (Selectors are structural rather than date-specific because the layer set is regenerated by the pipeline.)
  const openSeries = async (page: import('@playwright/test').Page) => {
    await appReady(page);
    await featured(page, /Krasheninnikov/).click();
    await expect(panel(page)).toBeVisible();
    const tl = page.getByRole('group', { name: 'Observation timeline' });
    await expect(tl).toBeVisible();
    return tl;
  };
  const ticks = (tl: import('@playwright/test').Locator) => tl.locator('g.tick');

  test('clicking a date sets the After layer (URL, selector, timeline marker and map tag agree)', async ({ page }) => {
    const tl = await openSeries(page);
    expect(await ticks(tl).count()).toBeGreaterThanOrEqual(5);
    const before = hashParams(page).get('a');
    const target = ticks(tl).nth(4);
    const label = (await target.getAttribute('aria-label'))!;
    expect(label).not.toContain('current');
    await target.dispatchEvent('click'); // SVG <g>; a real click is intercepted by its own transparent hit-rect sibling
    await expect.poll(() => hashParams(page).get('a')).not.toBe(before);
    const newAfter = hashParams(page).get('a')!;
    await expect(tl.getByRole('button', { name: `${label}, current after` })).toBeVisible();
    await expect(panel(page).getByRole('combobox', { name: 'After observation' })).toHaveValue(newAfter);
    await expect(page.locator('.map-tag', { hasText: /AFTER/ })).toContainText(label.split(',')[0]);
  });

  test('the Before/After toggle redirects the next click to the Before slot', async ({ page }) => {
    const tl = await openSeries(page);
    const afterId = hashParams(page).get('a');
    const beforeId = hashParams(page).get('b');
    await tl.getByRole('group', { name: 'Which slot a click sets' }).getByRole('button', { name: 'Before' }).click();
    await ticks(tl).nth(3).dispatchEvent('click');
    await expect.poll(() => hashParams(page).get('b')).not.toBe(beforeId);
    expect(hashParams(page).get('a')).toBe(afterId); // After untouched
  });

  test('timeline observations are keyboard operable (Enter and Space)', async ({ page }) => {
    const tl = await openSeries(page);
    const a0 = hashParams(page).get('a');
    await ticks(tl).nth(2).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => hashParams(page).get('a')).not.toBe(a0);
    const a1 = hashParams(page).get('a');
    await ticks(tl).nth(6).focus();
    await page.keyboard.press(' ');
    await expect.poll(() => hashParams(page).get('a')).not.toBe(a1);
  });

  test('the Before/After dropdowns in the panel drive the same state', async ({ page }) => {
    await appReady(page);
    await featured(page, /Limpopo/).click();
    const sel = panel(page).getByRole('combobox', { name: 'Before observation' });
    await sel.selectOption('gcov_20251224');
    await expect.poll(() => hashParams(page).get('b')).toBe('gcov_20251224');
  });
});

test.describe('deep links', () => {
  test('a pasted hash opens the right event, mode, layers and explanation level', async ({ page }) => {
    await page.goto('/#/e/mozambique-floods-2026?mode=overlay&b=gcov_20260105&a=gcov_20260117&lvl=scientific');
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Limpopo and Incomati floods');
    const modes = page.getByRole('group', { name: 'Comparison mode' });
    await expect(modes.getByRole('button', { name: 'Overlay' })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).getByRole('combobox', { name: 'Before observation' })).toHaveValue('gcov_20260105');
    await expect(panel(page).getByRole('combobox', { name: 'After observation' })).toHaveValue('gcov_20260117');
    await expect(panel(page).locator('.explain').getByRole('group', { name: 'Explanation level' }).getByRole('button', { name: 'Scientific' })).toHaveAttribute('aria-pressed', 'true');
    // state survives intact in the URL (no rewrite to defaults)
    expect(hashParams(page).get('a')).toBe('gcov_20260117');
    expect(hashParams(page).get('mode')).toBe('overlay');
  });

  test('changing the hash of a running page navigates (hashchange)', async ({ page }) => {
    await appReady(page);
    await page.evaluate(() => (window.location.hash = '#/e/krasheninnikov-2026?mode=side'));
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Krasheninnikov volcano');
    await page.evaluate(() => (window.location.hash = '#/'));
    await expect(panel(page)).toHaveCount(0);
  });

  test('an unknown event id degrades to the landing state without errors', async ({ page }) => {
    await page.goto('/#/e/does-not-exist?mode=swipe');
    await expect(featured(page, /Venezuela/)).toBeVisible();
    await expect(anyPanel(page)).toHaveCount(0);
    await expect.poll(() => hashOf(page)).toBe('#/');
  });

  test('unknown layer ids in the hash fall back to the default before/after', async ({ page }) => {
    await page.goto('/#/e/venezuela-2026?mode=swipe&b=nope&a=nada');
    await expect(panel(page)).toBeVisible();
    await expect.poll(() => hashParams(page).get('b')).toBe('los_before');
    await expect.poll(() => hashParams(page).get('a')).toBe('los_after');
  });

  test('an invalid ?mode= falls back to swipe', async ({ page }) => {
    // ISSUE-QA-01 (fixed during the audit): "sideways" used to leave no mode selected and no comparison drawn.
    await page.goto('/#/e/venezuela-2026?mode=sideways');
    await expect(panel(page)).toBeVisible();
    const pressed = await page.getByRole('group', { name: 'Comparison mode' }).getByRole('button', { pressed: true }).count();
    expect(pressed).toBe(1);
  });
});

test.describe('search', () => {
  test('coordinates: shows a Go-to option and runs the NISAR coverage probe (ASF response is a recorded fixture)', async ({ page }) => {
    const calls = await mockServices(page);
    await appReady(page);
    const box = page.getByRole('combobox', { name: /Search places/ });
    await box.fill('10.5, -67.2');
    const opt = page.getByRole('option', { name: /10\.5000, -67\.2000/ });
    await expect(opt).toBeVisible();
    await box.press('Enter');
    const intro = probePanel(page);
    await expect(intro.getByText('NISAR data at this point')).toBeVisible();
    await expect(intro).toContainText('10.5000, -67.2000');
    expect(calls.asf.length).toBe(1);
    expect(new URL(calls.asf[0]).searchParams.get('intersectsWith')).toBe('POINT(-67.2000 10.5000)');
    expect(calls.photon).toHaveLength(0); // coordinates never hit the geocoder
    await expect(intro.locator('.coverage-list li').first()).toBeVisible();
    await intro.getByRole('button', { name: 'Clear coverage' }).click();
    await expect(page.getByText('NISAR data at this point')).toHaveCount(0);
    await expect(anyPanel(page)).toHaveCount(0); // clearing the probe closes its panel
  });

  test('hemisphere-letter coordinates are understood ("10.5N 67.2W")', async ({ page }) => {
    const calls = await mockServices(page);
    await appReady(page);
    await page.getByRole('combobox', { name: /Search places/ }).fill('10.5N 67.2W');
    await page.getByRole('option', { name: /10\.5000, -67\.2000/ }).click();
    await expect(page.getByText('NISAR data at this point')).toBeVisible();
    expect(new URL(calls.asf[0]).searchParams.get('intersectsWith')).toBe('POINT(-67.2000 10.5000)');
  });

  test('a curated event can be found by name and opened from the search box', async ({ page }) => {
    await mockServices(page);
    await appReady(page);
    await page.getByRole('combobox', { name: /Search places/ }).fill('krashen');
    await page.getByRole('option', { name: /Krasheninnikov volcano/ }).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Krasheninnikov volcano');
  });

  test('place names go to the geocoder (recorded Photon fixture) and selecting a hit probes coverage', async ({ page }) => {
    const calls = await mockServices(page);
    await appReady(page);
    await page.getByRole('combobox', { name: /Search places/ }).fill('Caracas');
    const first = page.getByRole('option').first();
    await expect(first).toBeVisible();
    expect(calls.photon.length).toBeGreaterThanOrEqual(1);
    expect(new URL(calls.photon[0]).searchParams.get('q')).toBe('Caracas');
    await first.click();
    await expect(page.getByText('NISAR data at this point')).toBeVisible();
  });

  test('geocoder outage shows a helpful message but coordinates keep working', async ({ page }) => {
    await mockServices(page); // ASF fixture; the later photon route below takes precedence
    await page.route('https://photon.komoot.io/**', (r) => r.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'down' }));
    await appReady(page);
    const box = page.getByRole('combobox', { name: /Search places/ });
    await box.fill('Caracas');
    await expect(page.getByText(/Place search is unavailable/)).toBeVisible();
    await box.fill('10.5, -67.2');
    await expect(page.getByRole('option', { name: /10\.5000, -67\.2000/ })).toBeVisible();
  });

  test('ASF outage shows the error callout and offline reassurance', async ({ page }) => {
    await page.route('https://api.daac.asf.alaska.edu/**', (r) => r.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'boom' }));
    await appReady(page);
    await page.getByRole('combobox', { name: /Search places/ }).fill('10.5, -67.2');
    await page.getByRole('option', { name: /10\.5000/ }).click();
    await expect(page.getByText(/Could not reach the ASF search service/)).toBeVisible();
    await expect(page.getByText(/still work offline/)).toBeVisible();
  });

  test('no coverage for a point shows the empty state', async ({ page }) => {
    await page.route('https://api.daac.asf.alaska.edu/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"type":"FeatureCollection","features":[]}' }));
    await appReady(page);
    await page.getByRole('combobox', { name: /Search places/ }).fill('0, 0');
    await page.getByRole('option', { name: /0\.0000, 0\.0000/ }).click();
    await expect(page.getByText(/No public (routine )?NISAR GCOV or GUNW products cover this point yet/)).toBeVisible();
  });
});

test.describe('data package over HTTP', () => {
  test('events.json and every overlay image are served', async ({ request }) => {
    const res = await request.get('/data/events.json');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    for (const ev of data.events) {
      for (const l of ev.layers) {
        const img = await request.get('/' + l.url);
        expect(img.status(), l.url).toBe(200);
        expect(img.headers()['content-type'], l.url).toMatch(/image\/webp/);
      }
    }
  });
  test('the app survives a missing events.json with a clear error panel', async ({ page, problems }) => {
    await page.route('**/data/events.json', (r) => r.fulfill({ status: 404, body: 'nope' }));
    await page.goto('/');
    await expect(page.getByText('Data package missing')).toBeVisible();
    // the 404 is injected on purpose: do not count it as an app error
    problems.errors.splice(0, problems.errors.length, ...problems.errors.filter((e) => !e.includes('events.json')));
  });
  test('the app still works when context.json is missing (events layer is optional)', async ({ page, problems }) => {
    await page.route('**/data/context.json', (r) => r.fulfill({ status: 404, body: 'nope' }));
    await page.goto('/');
    await expect(featured(page, /Venezuela/)).toBeVisible();
    await openAbout(page);
    await expect(aboutPanel(page).getByRole('heading', { level: 2 })).toContainText('See what happened');
    problems.errors.splice(0, problems.errors.length, ...problems.errors.filter((e) => !e.includes('context.json')));
  });
});

test.describe('layout', () => {
  test('desktop: the investigation panel does not clip its content horizontally', async ({ page }) => {
    // ISSUE-QA-17 (fixed during the audit): observation rows used to overflow the 400px panel.
    await appReady(page);
    await featured(page, /Venezuela/).click();
    await expect(panel(page)).toBeVisible();
    const clipped = await page.evaluate(() => {
      const p = document.querySelector('section.panel')!;
      const pr = p.getBoundingClientRect();
      return [...p.querySelectorAll('.obs *')].filter((el) => el.getBoundingClientRect().right > pr.right + 1).map((el) => `${el.tagName}.${el.className}`).slice(0, 5);
    });
    expect(clipped).toEqual([]);
  });
});
