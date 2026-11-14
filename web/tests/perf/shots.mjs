// Rendered-evidence screenshots for the design review (run: node tests/perf/shots.mjs [name ...]).
// Writes PNGs to test-results/design-evidence/. Uses the system Edge with software WebGL, like the e2e suite.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

function findEdge() {
  for (const root of ['C:/Program Files (x86)/Microsoft/Edge/Application', 'C:/Program Files/Microsoft/Edge/Application']) {
    const p = path.join(root, 'msedge.exe');
    if (fs.existsSync(p)) return p;
  }
  for (const root of ['C:/Program Files (x86)/Microsoft/EdgeCore', 'C:/Program Files/Microsoft/EdgeCore']) {
    if (!fs.existsSync(root)) continue;
    for (const v of fs.readdirSync(root).sort().reverse()) {
      const p = path.join(root, v, 'msedge.exe');
      if (fs.existsSync(p)) return p;
    }
  }
}
const OUT = 'test-results/design-evidence';
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const exe = process.env.EDGE_PATH ?? findEdge();
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : { channel: 'msedge' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});

async function open(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5173/');
  await page.locator('.inv-strip button').first().waitFor();
  return { page, ctx, errors };
}
const shot = async (page, name, wait = 6000) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', name);
};

const scenes = {
  async landing() {
    const { page, ctx, errors } = await open({ width: 1440, height: 900 });
    await shot(page, 'desktop-landing');
    await page.getByRole('button', { name: 'Filters' }).click();
    await shot(page, 'desktop-filters', 800);
    await page.getByRole('button', { name: /^Satellite layers/ }).click();
    await shot(page, 'desktop-layers', 800);
    await page.keyboard.press('Escape');
    console.log('errors', errors);
    await ctx.close();
  },
  async investigation() {
    const { page, ctx, errors } = await open({ width: 1440, height: 900 });
    await page.locator('.inv-strip button', { hasText: 'Limpopo' }).click();
    await shot(page, 'desktop-investigation', 9000);
    await page.locator('.panel-body').evaluate((el) => (el.scrollTop = 620));
    await shot(page, 'desktop-investigation-scrolled', 600);
    console.log('errors', errors);
    await ctx.close();
  },
  async lens() {
    const { page, ctx, errors } = await open({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'SAR lens' }).click();
    await shot(page, 'desktop-lens', 20000);
    await page.getByRole('button', { name: 'SAR view data provenance' }).click();
    await shot(page, 'desktop-lens-provenance', 500);
    await page.getByRole('button', { name: 'SAR view data provenance' }).click();
    await page.getByRole('button', { name: 'Expand SAR lens to full screen' }).click();
    await shot(page, 'desktop-lens-full', 1000);
    await page.getByRole('button', { name: 'Restore SAR lens to a square' }).click();
    await page.locator('.inv-strip button', { hasText: 'Limpopo' }).click();
    await page.getByRole('group', { name: 'SAR lens source' }).getByRole('button', { name: 'This investigation' }).click();
    await shot(page, 'desktop-lens-investigation', 10000);
    console.log('errors', errors);
    await ctx.close();
  },
  async context() {
    const { page, ctx, errors } = await open({ width: 1440, height: 900 });
    await page.waitForFunction(() => window.__gsMaps?.a?.getSource?.('ctx'));
    await page.waitForTimeout(3000);
    // open a reported USGS event through the same path a marker click takes
    const pt = await page.evaluate(async () => {
      const a = window.__gsMaps.a;
      const ctxData = await (await fetch('data/context.json')).json();
      const ev = ctxData.events.find((e) => e.id.startsWith('usgs-'));
      a.jumpTo({ center: [ev.lon, ev.lat], zoom: 7.5 });
      await new Promise((r) => a.once('idle', r));
      const p = a.project([ev.lon, ev.lat]);
      return { x: p.x, y: p.y, id: ev.id };
    });
    await page.mouse.click(pt.x, pt.y);
    await shot(page, 'desktop-context-event', 5000);
    console.log('errors', errors);
    await ctx.close();
  },
  async mobile() {
    const { page, ctx, errors } = await open({ width: 390, height: 844 }, true);
    await shot(page, 'mobile-landing');
    await page.locator('.inv-strip button', { hasText: 'Limpopo' }).click();
    await shot(page, 'mobile-investigation', 8000);
    await page.getByRole('button', { name: 'Close investigation' }).click();
    await page.getByRole('button', { name: 'SAR lens' }).click();
    await shot(page, 'mobile-lens', 9000);
    console.log('errors', errors);
    await ctx.close();
  },
};
for (const [name, run] of Object.entries(scenes)) {
  if (only.length && !only.includes(name)) continue;
  try {
    await run();
  } catch (e) {
    console.log(`scene ${name} FAILED:`, e.message.slice(0, 900));
  }
}
await browser.close();
