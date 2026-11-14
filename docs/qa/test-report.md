# Global SAR: QA test report

Run date 2026-11-14, Windows 11, Node 26.13.1, Python 3.12.16 (venv with h5py 3.16, numpy 2.5), Microsoft Edge 157 (system install, no browser download). The tree was **being edited by other engineers during the run** (App.tsx, MapView.tsx, components, process.py, new assistant/catalog/Earthdata code), so a few tests were adapted mid-run to follow intentional UI changes; see "Notes on stability".

## How to run everything

| Suite | Command (from the repo root `global-sar/`) | Needs |
| --- | --- | --- |
| Web unit, component and data-package tests (Vitest) | `cd web && npm test` (coverage: `npm run test:coverage`) | `npm install` |
| End-to-end + accessibility (Playwright, Edge) | `cd web && npm run test:e2e` | dev server on :5173 (`npm run dev`); override with `BASE_URL`, Edge path with `EDGE_PATH` |
| Pipeline JS (node:test) | `cd pipeline && npm test` | Node >= 20 |
| Pipeline Python (pytest) | `cd pipeline && <venv>\Scripts\python.exe -I -m pytest` | h5py, numpy, rasterio, scipy, scikit-image, pyproj, pillow, pytest |
| Dependency audit | `npm audit --omit=dev` in `web/` and `pipeline/` | network |
| Bundle size | `cd web && npm run build` (tsc + vite; passes at the end of the audit) | |

`pytest` was installed into the scratch venv with `uv pip install pytest pytest-cov`; `requirements.txt` was not edited (pytest is a dev tool; add `pytest` to a dev requirements file when convenient).

## Results

| Suite | Files | Tests | Passed | Expected-fail (marked known bug) | Failed | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Web unit: `lib.ts` | 1 | 49 | 49 | 0 | 0 | runs in TZ=America/Los_Angeles to catch local-time date bugs |
| Web unit: `services.ts` (recorded Photon + ASF fixtures) | 1 | 17 | 17 | 0 | 0 | |
| Web component tests (Timeline, EventPanel, SearchBox, IntroPanel states) | 1 | 47 | 47 | 0 | 0 | |
| Data-package validation (events.json, context.json, 34 images) | 1 | 334 | 334 | 0 | 0 | real shipped data, no mocks |
| **Web Vitest total (my files)** | **4** | **447** | **447** | **0** | **0** | `npm test` also runs 44 tests of other engineers (`earthdata`, `assistant/*`): 491 total, all green, 3 consecutive identical runs |
| E2E (Playwright, Edge, 1 worker, no retries) | 3 | 46 | 46 | 0 | 0 | 2.6 min; 6 axe checks and 6 mobile tests included |
| Pipeline node:test (`asf.mjs`, `georef.mjs`) | 2 | 38 | 36 | 2 (`todo`, QA-12) | 0 | |
| Pipeline pytest (`process.py`, `nisar_io.py`) | 2 | 119 | 119 | 0 | 0 | |
| **Total** | | **650** | **648** | **2** | **0** | |

Throughout the audit every known bug had a test encoding the *desired* behaviour, marked as an expected failure (`it.fails`, `xfail(strict=True)`, `test.fail`, `todo`) so the suite stayed honest and green. Such a marker turns **red** the day the bug is fixed; that is how 19 of the 23 reported issues were detected as fixed by other engineers while the audit ran, after which each marker was removed and the test became a plain regression test. What remains marked: the two `todo` tests for QA-12 (georeference residual). No test was disabled, skipped or loosened to get green. The only `skip` is conditional: the real-Mozambique-cache threshold test skips when the untracked `pipeline/.cache` is absent (it ran here).

### Coverage
- Web (v8, `npm run test:coverage`, scope: `lib`, `services`, `components`, `content`): `lib.ts` 83 % lines, `services.ts` 100 %, `Timeline.tsx` 98 %, `IntroPanel.tsx` 100 %, `SearchBox.tsx` 98 %, `EventPanel.tsx` 89 %; `Filters.tsx`, `LayersPanel.tsx`, `EarthdataPanel.tsx` 0-11 % (new components, not covered by this suite); `MapView.tsx` and `App.tsx` are exercised only through E2E (WebGL), not instrumented. All files in scope: 77 % lines.
- Pipeline JS: `asf.mjs` 100 %, `georef.mjs` 100 % lines (node coverage).
- Pipeline Python (pytest-cov): `nisar_io.py` 95 %, `process.py` 86 % at the time of measurement (the CLI `run()` and event orchestration are the uncovered part), 91 % overall.

### What the suites actually exercise
- **lib.ts**: UTC dates (west-coast TZ), coordinate formatting, parseCoords (N/S/E/W, separators, `°`, bounds, 14 invalid inputs), layer labels, bounds, category tables.
- **services.ts**: Photon and ASF request construction (encoding, 4-decimal POINT, limit), parsing of the **recorded real responses** (`web/tests/fixtures/*.fixture.json`, captured today with PowerShell `Invoke-WebRequest`), tier mapping, UR filtering, sort order, HTTP and body-level errors.
- **Components**: Timeline (kind filtering, keyboard, slots, all real events render without NaN), EventPanel (modes, selects, opacity, legends, provenance, authored content for all three real events, pins), SearchBox (debounce, keyboard, errors, coordinates never hit the geocoder, stale-response race), IntroPanel (idle/loading/error/empty/result with the real ASF fixture, `250+`, list cap).
- **Data package**: for every layer (34): kind/role/product enums, 4 finite TL-TR-BR-BL corners with sane size, WebP file exists with RIFF/WEBP magic and path hygiene, acquisition dates, full provenance (mission, granule, tier, track, frame, direction, CRID, processing steps, links), provenance consistent with the granule file name and with its acquisition timestamps, browse layers carry `georef_residual_m`, derived layers have a legend with ranges/classes; per event: unique ids matching the hash router, technique vs product, event location inside a layer footprint, before+after roles; `context.json`: schema, uniqueness, USGS M6.3+, window dates, no id collisions.
- **georef.mjs**: synthetic rotated rectangles with known lon/lat mapping at 0, 4, 10, -10, 22 degrees recover corners to <= 6 px; inverse transform; speckle immunity; footprint-mismatch sensitivity; empty/black/alpha-0 images; `cropBox` size, clamping, latitude scaling, degenerate box.
- **asf.mjs**: `tierOf`, `parseGranuleName` against every real granule in the data package, `searchGranules` chunking/UR preference/errors (fetch stubbed, labelled).
- **process.py**: `name_parts` and `provenance` against all 34 shipped layers; `histogram_valley` on synthetic bimodal data (and the real cached Mozambique scene reproducing the shipped threshold); `db`, `boxcar`, `colorize` (alpha/NaN/inf/mask/clipping), `to_mercator` (corners, values, nearest classes), `save_layer` (WebP alpha, downscale), and the science code paths of `venezuela()` (LOS = -phi*lambda/(4 pi): sign, magnitude, ionosphere subtraction, referencing, coherence/component masks, shared colour scale), `mozambique()` (classes, areas, scene-wide brightening guard) and `krasheninnikov()` (fixed stretch) with only the HDF5 download seam replaced by synthetic grids.
- **nisar_io.RemoteFile**: real `ThreadingHTTPServer` on 127.0.0.1 serving a synthetic h5py file: exact bytes, Range/Bearer headers, block cache and LRU, 503 retries with 1-2-4-8-16-30 s backoff (sleep patched to record delays), give-up after 8 attempts with no token leak, no retry on 4xx, **redirect without forwarding Authorization (Range kept)**, signed-URL reuse and refresh on 403, subset reads (< 15 % of an 8 MB file), chunk prefetch, `_window` (clip/miss), `read_gcov`/`read_gunw` end to end over HTTP.
- **E2E**: landing (title, list, canvas, **WebGL not blank**), selection via the left list sets the hash, Esc/close/Back, swipe (keyboard + drag) / side / overlay, timeline click/keyboard/slot toggle, dropdown sync, deep links (valid, hashchange, unknown event, unknown layers, invalid mode), search by coordinates (recorded ASF fixture, exact POINT), by hemisphere letters, by event name, by place (recorded Photon fixture), geocoder outage, ASF outage, empty coverage, data package served over HTTP and degraded when files are missing, mobile 375x812 (overflow, sheet, timeline, stacked side-by-side, target sizes), 4 axe audits + keyboard + accessible names, and a per-test watcher that fails on **any** console error, page error or same-origin 4xx/5xx.

## Accessibility (axe-core 4.14, WCAG 2.0-2.2 A/AA + best practice)

Policy as requested: report everything, fail only on `critical`. **0 critical violations** on landing, Venezuela, Limpopo-overlay and search-open. First run found 3-5 serious violations per page (colour contrast on `.faint`, `link-in-text-block`, `nested-interactive` on the timeline svg, `target-size` x8); **by the final run only moderate ones remain** (`region` on MapLibre controls, `landmark-unique` for two canvases labelled "Map"). Full lists: `web/test-results/axe-*.json` (regenerated by every `npm run test:e2e`).

First-run findings (only the last row remains at the end of the audit):

| Rule | Impact | Where |
| --- | --- | --- |
| color-contrast | serious | `.faint` credit text (intro, panels) |
| link-in-text-block | serious | EOX link inside `.faint` |
| nested-interactive | serious | Timeline `<svg role="img">` with focusable children |
| target-size | serious | 8 nodes: map annotation pins (22x22) (first run only) |
| region, landmark-unique | moderate | MapLibre controls, two canvases labelled "Map" |

## Security and performance

- `npm audit --omit=dev`: **0 vulnerabilities** in `web/` and `pipeline/` (also 0 with dev dependencies in `web/` after installing the test tooling).
- **Secrets**: regex scan of source (excluding generated data, `node_modules`, `.venv`, `.tools`, `.git`) for API-key/secret/token/bearer assignments, AWS/GitHub/OpenAI/Google/JWT patterns and private keys found only test placeholders (`TEST-TOKEN-NOT-REAL`, `test-key-123`). No `.env*`, `.netrc` or key file is tracked or untracked-unignored. `.gitignore` covers `.env`, `.env.*`, `*.netrc`. The Earthdata token is read from the `EARTHDATA_TOKEN` environment variable only (`nisar_io._token`), is never logged, never put in an exception message, and is **not forwarded on redirects** (tested). The built JS (`dist/assets/*.js`) contains no key, bearer token or JWT; the only hostnames are public tile/geocoder/ASF/CMR/NASA endpoints. New code reads `VITE_ASSISTANT_GATEWAY_URL` (a URL, not a secret) and the gateway reads `ASSISTANT_MODEL_API_KEY` server-side from the environment; a `VITE_` variable is bundled into the browser, so **never put a model key in a `VITE_*` variable** (recommend a build-time check).
- **Bundle** (`vite build`): `index.js` **1,410 kB raw / 386-399 kB gzip** (MapLibre GL + React; Vite warns > 500 kB), CSS 90 kB / 15 kB gzip. One chunk, no code splitting; consider `import()` for MapLibre and for the assistant/Earthdata panels.
- **Data package**: `dist/` is 44 MB, of which `public/data/events` 33 MB (34 overlays; largest `hh_change.webp` 4.2 MB, `water_new.webp` 3.4 MB, `hh_change_first_last.webp` 2.6 MB) and `public/data/catalogs` 8.8 MB (`nasa-glc.json` 5.8 MB, `firms-fires.json` 1.4 MB). Overlays load on demand; the catalogs are downloaded when their toggles are on. No overlay exceeds the 6 MB test budget.
- Landing page makes third-party requests to EOX/OpenFreeMap/AWS terrain tiles and FIRMS/NOAA catalogs; failures there are attached to the E2E report but do not fail it.
- `npm run build`: during the run it was red at `tsc --noEmit` because of someone's in-progress `?lvl=` handling (`src/App.tsx` L57/L140); at the end of the audit it passes (`tsc` clean, `vite build` OK).

## Notes on stability and honesty

- Playwright ran with `retries: 0` and one worker. Run 1: 46/46 (4 marked bugs red-as-expected). Run 2: 7 reported failures, **none an app regression**: 5 were marked-expected-fail tests whose bugs had just been fixed ("Expected to fail, but passed"), 2 were `Could not load image ...: the response is empty` because another engineer's `process.py` run was rewriting the overlay `.webp` files at that moment (zero-byte files observed). Run 3, after converting the 5 markers and with the data stable: **46/46**. Vitest was run 3+ times and pytest 4 times with identical results once the code stopped moving.
- Edge: `channel: 'msedge'` only finds `C:\Program Files (x86)\Microsoft\Edge\Application`; this machine has Edge under `...\EdgeCore\157.0.4341.46\`, so `playwright.config.ts` falls back to an explicit `executablePath` (override with `EDGE_PATH`). WebGL runs on SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`).
- Tests that were adapted to intentional app changes made while the suite was being written (not to hide bugs): the Timeline now draws only the active layer kind (selectors became structural; a new test covers the filtering); an embedded assistant panel added a second "Simple/Scientific" group and "Explanation level" label (selectors scoped to `.explain`); the evidence badge copy changed ("NASA browse rendering", "computed by team": regexes accept both).
- **Mocks, clearly labelled**: (1) `tests/fixtures/events.fixture.ts` is synthetic (component tests); (2) `*.fixture.json` are recorded real Photon/ASF responses, replayed through `fetch` stubs (Vitest) or `page.route` (Playwright), so third-party outages cannot fail the build; (3) pipeline tests use synthetic images/grids/HDF5 built in the tests and a local HTTP server; the real processing code runs on them. There is no live-network test in the suite; the live APIs were exercised only when recording the fixtures and in the manual probe runs.
- **Not covered**: real NISAR products (need an Earthdata token), WebGL pixel-level correctness of overlays (only "canvas not blank"), the new assistant gateway / catalogs / layers / Earthdata panel, visual regression, Safari/Firefox, real touch gestures on the map, performance profiling beyond bundle size.

## Issues found

See [issues.md](issues.md) for the prioritized list with file:line, repro, cause and fix: 23 issues (1 high, 8 medium, 14 low); 19 fixed by other engineers during the audit, 4 still open (QA-12 georeference residual understates error; QA-16 boxcar biases flood area low; QA-10 Mozambique browse overlays ~640 m registration; tier logic duplicated in three places).
