// New spec. Behaviour under test: a mouse-free journey (Tab / Enter / Arrow keys / Escape) through search, opening an
// investigation, switching compare modes, the timeline, and closing. Per the user's instruction
// "debug all code with zillion different type tests". Keys only: no .click() / .fill() after page load.
import type { Page } from '@playwright/test';
import { appReady, expect, hashOf, hashParams, panel, strip, stubExternal, test } from './helpers';

interface Focus { tag: string; role: string | null; label: string | null; text: string; pressed: string | null; inTimeline: boolean }
const focus = (page: Page): Promise<Focus> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    return {
      tag: e?.tagName ?? '',
      role: e?.getAttribute('role') ?? null,
      label: e?.getAttribute('aria-label') ?? null,
      text: (e?.textContent ?? '').trim().slice(0, 80),
      pressed: e?.getAttribute('aria-pressed') ?? null,
      inTimeline: !!e?.closest('.timeline'),
    };
  });

/** Press Tab (or Shift+Tab) until the focused element satisfies `pred`; fail with the focus trail if it never does. */
async function tabTo(page: Page, what: string, pred: (f: Focus) => boolean, max = 120, key = 'Tab') {
  const trail: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    const f = await focus(page);
    trail.push(`${f.tag}:${f.role ?? ''}:${f.label ?? f.text}`);
    if (pred(f)) return f;
  }
  throw new Error(`Never focused "${what}" in ${max} presses of ${key}. Trail: ${trail.slice(-25).join(' | ')}`);
}

test.describe('keyboard-only', () => {
  test('search -> open investigation -> switch modes -> timeline -> close', async ({ page }) => {
    test.setTimeout(120_000);
    await stubExternal(page);
    await appReady(page);

    // 1. Tab reaches the search combobox; typing narrows to the local investigation
    await tabTo(page, 'search box', (f) => f.role === 'combobox');
    await page.keyboard.type('Venezuela');
    await expect(page.getByRole('listbox')).toContainText('Venezuela earthquakes');
    await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');

    // 2. Enter opens it
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Venezuela earthquakes');
    await expect.poll(() => hashOf(page)).toMatch(/^#\/e\/venezuela-2026\?/);
    expect(hashParams(page).get('mode')).toBe('swipe');
    // focus moves into the panel (its heading) when it opens
    await expect.poll(async () => (await focus(page)).tag).toBe('H2');

    // 3. Tab to the compare-mode buttons and switch with Enter
    await tabTo(page, 'Side by side', (f) => f.text === 'Side by side');
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('button', { name: 'Side by side' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => hashParams(page).get('mode')).toBe('side');
    await tabTo(page, 'Overlay', (f) => f.text === 'Overlay', 3);
    await page.keyboard.press('Space');
    await expect(panel(page).getByRole('button', { name: 'Overlay' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => hashParams(page).get('mode')).toBe('overlay');
    // go back to Swipe with Shift+Tab x2
    await tabTo(page, 'Swipe', (f) => f.text === 'Swipe', 4, 'Shift+Tab');
    await page.keyboard.press('Enter');
    await expect.poll(() => hashParams(page).get('mode')).toBe('swipe');

    // 4. Timeline: choose which slot a click sets (Before; "After" is the default), then pick the "after" observation for it with Enter.
    //    Venezuela has exactly two observations (before, after), so picking the other one makes both slots equal.
    const q0 = hashParams(page);
    expect(q0.get('a')).not.toBe(q0.get('b'));
    await tabTo(page, 'Before slot button', (f) => f.inTimeline && f.text === 'Before' && f.tag === 'BUTTON' && f.pressed === 'false', 500);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('group', { name: 'Which slot a click sets' }).getByRole('button', { name: 'Before' })).toHaveAttribute('aria-pressed', 'true');
    const tick = await tabTo(page, 'the timeline observation currently used as "after"', (f) => f.inTimeline && f.role === 'button' && /current after/.test(f.label ?? ''), 20);
    expect(tick.label).toBeTruthy();
    await page.keyboard.press('Enter');
    await expect.poll(() => hashParams(page).get('b')).toBe(q0.get('a'));

    // 5. Escape closes (focus is not in a text input, so the global handler applies)
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => hashOf(page)).toBe('#/');
    await expect(strip(page)).toBeVisible(); // landing strip is back
    // focus returns to where the journey started (the search box) instead of falling to <body>
    await expect.poll(async () => (await focus(page)).role).toBe('combobox');
  });

  test('search box keys: ArrowDown/ArrowUp move the selection, Escape closes the list but not the app', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await tabTo(page, 'search box', (f) => f.role === 'combobox');
    await page.keyboard.type('flood'); // matches more than one local investigation / category text
    const opts = page.getByRole('option');
    await expect(opts.first()).toBeVisible();
    const n = await opts.count();
    await expect(opts.first()).toHaveAttribute('aria-selected', 'true');
    if (n > 1) {
      await page.keyboard.press('ArrowDown');
      await expect(opts.nth(1)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ArrowUp');
      await expect(opts.first()).toHaveAttribute('aria-selected', 'true');
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
    await expect(panel(page)).toHaveCount(0); // Escape inside the input does not select/close anything else
  });

  test('coordinates typed in the box can be confirmed with Enter (no mouse) and the app stays alive', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await tabTo(page, 'search box', (f) => f.role === 'combobox');
    await page.keyboard.type('10.5, -67.2');
    await expect(page.getByRole('listbox')).toContainText('Go to coordinates');
    await page.keyboard.press('Enter');
    await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });

  test('every focusable control in the investigation panel has an accessible name', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await tabTo(page, 'search box', (f) => f.role === 'combobox');
    await page.keyboard.type('Limpopo');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    const unnamed = await panel(page).evaluate((root) => {
      const sel = 'button, a[href], input, select, textarea, [tabindex="0"], summary';
      return [...root.querySelectorAll<HTMLElement>(sel)]
        .filter((e) => e.offsetParent !== null || e.tagName === 'SUMMARY')
        .filter((e) => {
          const name = (e.getAttribute('aria-label') ?? '') + (e.getAttribute('aria-labelledby') ? 'x' : '') + (e.textContent ?? '').trim() + (e.getAttribute('title') ?? '') + ((e as HTMLInputElement).labels?.length ? 'x' : '');
          return name.trim() === '';
        })
        .map((e) => e.outerHTML.slice(0, 120));
    });
    expect(unnamed, 'focusable controls without any accessible name').toEqual([]);
  });

  test('focus is not trapped: Shift+Tab from the panel walks back out to the search box', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await tabTo(page, 'search box', (f) => f.role === 'combobox');
    await page.keyboard.type('Krasheninnikov');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await tabTo(page, 'Close investigation', (f) => f.label === 'Close investigation');
    await tabTo(page, 'search box (backwards)', (f) => f.role === 'combobox', 200, 'Shift+Tab');
  });
});
