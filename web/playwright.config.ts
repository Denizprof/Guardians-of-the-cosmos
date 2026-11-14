import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Uses the system Microsoft Edge (no browser download). `channel: 'msedge'` is tried first;
 * on this machine Edge lives under "EdgeCore", which the channel lookup does not know, so we
 * fall back to an explicit executablePath. Override with EDGE_PATH.
 */
function findEdge(): string | undefined {
  if (process.env.EDGE_PATH) return process.env.EDGE_PATH;
  const std = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  if (std.some((p) => fs.existsSync(p))) return undefined; // channel lookup will work
  for (const root of ['C:\\Program Files (x86)\\Microsoft\\EdgeCore', 'C:\\Program Files\\Microsoft\\EdgeCore']) {
    if (!fs.existsSync(root)) continue;
    const vers = fs.readdirSync(root).sort().reverse();
    for (const v of vers) {
      const p = path.join(root, v, 'msedge.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}
const executablePath = findEdge();

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // one software-GL browser at a time keeps WebGL deterministic
  retries: 0, // no retries: a flaky test is a bug in the test or the app, not something to paper over
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: BASE,
    ...(executablePath ? { launchOptions: { executablePath } } : { channel: 'msedge' as const }),
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'edge',
      use: {
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
        },
        ...(executablePath ? {} : { channel: 'msedge' as const }),
      },
    },
  ],
});
