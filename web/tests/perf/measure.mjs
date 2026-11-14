// Perf probe used for the before/after numbers in docs (run: node tests/perf/measure.mjs <label>).
// Counts React commits (DevTools hook), GeoJSON setData calls (re-clustering) and map render frames.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const label = process.argv[2] ?? 'run';
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
const browser = await chromium.launch({
  executablePath: process.env.EDGE_PATH ?? findEdge(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  window.__commits = 0;
  window.__long = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; }, checkDCE() {},
    onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
  };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long += e.duration; }).observe({ entryTypes: ['longtask'] }); } catch {}
});
const out = { label };
const snap = () => page.evaluate(() => ({ commits: window.__commits, long: Math.round(window.__long), ctx: window.__n?.ctx ?? 0, sar: window.__n?.sar ?? 0, renders: window.__n?.renders ?? 0 }));
const diff = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, b[k] - a[k]]));

await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__gsMaps?.a?.getSource?.('ctx'), null, { timeout: 60000 });
await page.evaluate(() => {
  const a = window.__gsMaps.a;
  window.__n = { ctx: 0, sar: 0, renders: 0 };
  for (const id of ['ctx', 'sar']) {
    const s = a.getSource(id), orig = s.setData.bind(s);
    s.setData = (d) => { window.__n[id]++; return orig(d); };
  }
  a.on('render', () => window.__n.renders++);
});
await page.waitForTimeout(4000); // catalogs loaded

// M3: type a year into the "From year" filter, one key at a time
let s0 = await snap();
const from = page.getByLabel('From year');
if (!(await from.isVisible().catch(() => false))) await page.getByRole('button', { name: /Filters/ }).first().click();
await from.click();
await from.press('Control+a');
await from.pressSequentially('1950', { delay: 60 });
await page.waitForTimeout(1200);
out.yearTyping = diff(s0, await snap());
await page.keyboard.press('Escape');

// M2/M5: open + close an investigation (hash navigation, independent of the UI)
s0 = await snap();
await page.evaluate(() => (window.location.hash = '#/e/mozambique-floods-2026?mode=swipe'));
await page.waitForSelector('section.panel[aria-label$="investigation"]');
await page.waitForTimeout(3500);
out.openInvestigation = diff(s0, await snap());

// M1: swipe drag, 120 pointer moves
const grip = page.locator('.swipe-handle .grip');
const b = await grip.boundingBox();
s0 = await snap();
const t0 = Date.now();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down();
for (let i = 1; i <= 120; i++) await page.mouse.move(b.x + b.width / 2 - i * 3, b.y + b.height / 2);
await page.mouse.up();
await page.waitForTimeout(300);
out.swipeDrag120 = { ...diff(s0, await snap()), wallMs: Date.now() - t0 };

s0 = await snap();
await page.evaluate(() => (window.location.hash = '#/'));
await page.waitForTimeout(3000);
out.closeInvestigation = diff(s0, await snap());

// M4: idle landing globe: map A render frames in a 5 s window, 33 s after a fresh load
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__gsMaps?.a?.getSource?.('ctx'), null, { timeout: 60000 });
await page.evaluate(() => { window.__n = { renders: 0 }; window.__gsMaps.a.on('render', () => window.__n.renders++); });
await page.waitForTimeout(8000);
const r0 = (await snap()).renders;
await page.waitForTimeout(5000);
out.idleRenders5s_at8s = (await snap()).renders - r0;
await page.waitForTimeout(22000);
const r1 = (await snap()).renders;
await page.waitForTimeout(5000);
out.idleRenders5s_at35s = (await snap()).renders - r1;

console.log(JSON.stringify(out, null, 1));
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync(`test-results/perf-${label}.json`, JSON.stringify(out, null, 1));
await browser.close();
