import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { meteomatics } from './meteomatics-proxy';
import fs from 'node:fs';
import path from 'node:path';

// MapLibre 6 runs its tile parsing in a module worker. Vite's dev server rewrites
// node_modules files (injecting its HMR client), which breaks the worker, so we
// serve an untouched copy from public/vendor and point MapLibre at it.
function maplibreWorker(): Plugin {
  const copy = () => {
    const src = path.resolve(__dirname, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs');
    const dst = path.resolve(__dirname, 'public/vendor/maplibre-gl-worker.mjs');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  };
  return { name: 'maplibre-worker', buildStart: copy, configureServer: copy };
}

// Relative base so the static build works on GitHub Pages / any sub-path.
export default defineConfig(({ mode }) => {
  // Server-only secrets (no VITE_ prefix, so they are never exposed to browser code): the Meteomatics
  // username/password from web/.env.local or the process environment. See docs/meteomatics.md.
  const fileEnv = loadEnv(mode, __dirname, 'METEOMATICS_');
  const env = {
    METEOMATICS_USERNAME: process.env.METEOMATICS_USERNAME ?? fileEnv.METEOMATICS_USERNAME,
    METEOMATICS_PASSWORD: process.env.METEOMATICS_PASSWORD ?? fileEnv.METEOMATICS_PASSWORD,
  };
  return {
    base: './',
    plugins: [react(), maplibreWorker(), meteomatics(env)],
    optimizeDeps: { exclude: ['maplibre-gl'] },
    // /api/assistant -> local assistant-gateway (see docs/assistant-integration.md).
    server: { port: 5173, proxy: { '/api/assistant': 'http://127.0.0.1:8787' } },
  };
});
