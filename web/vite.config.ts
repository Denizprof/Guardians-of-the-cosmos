import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
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
export default defineConfig({
  base: './',
  plugins: [react(), maplibreWorker()],
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: { port: 5173 },
});
