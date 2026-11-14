# Global SAR: QA issue list

Audit date 2026-11-14. Bugs in app code are **reported, not fixed**. Line numbers refer to the working tree at the time of the audit; other engineers were editing `App.tsx`, `MapView.tsx`, the components and `process.py` concurrently, so lines may drift (function names are given too).

Every issue had a test that encoded the *desired* behaviour and was marked as an expected failure (`it.fails` in Vitest, `xfail(strict=True)` in pytest, `test.fail()` in Playwright, `todo` in node:test). The marker flips the suite red the day the bug is fixed, so it cannot rot silently; that is exactly how the 19 fixes below were detected. Only the two `todo` tests for QA-12 are still marked. Grep for the issue id (`ISSUE-QA-nn`) in `web/tests` and `pipeline/tests`.

Severity: **High** = wrong science or data shown to users; **Medium** = real user-facing malfunction; **Low** = edge case, polish or hardening.

| Id | Sev | Status at end of audit | Area | One line |
| --- | --- | --- | --- | --- |
| QA-12 | High | **OPEN** (provenance wording mitigated; `todo` tests still red) | pipeline/georef | `georef_residual_m` understates the real error ~30x; ~45 deg footprints break |
| QA-16 | Medium | **OPEN** | process.py science | 5x5 boxcar biases flooded area low (-36% on a synthetic 400 km2 patch) |
| QA-10 | Medium | **OPEN** (data unchanged: 641.7 m) | data | Mozambique browse layers carry 642 m RMS georeference residual |
| QA-04 | Medium | fixed during audit | data/process.py | derived layers' `processing_date` had no `Z` |
| QA-02 | Medium | fixed during audit | SearchBox | late geocoder response overwrote the coordinates option |
| QA-01 | Medium | fixed during audit | App.tsx | invalid `?mode=` left no comparison mode active |
| QA-17 | Medium | fixed during audit | EventPanel/CSS | Before/After rows overflowed the 400 px panel |
| QA-03 | Medium | fixed during audit | nisar_io | 429/408 not retried; no-Range server raised bare `KeyError` |
| QA-15 | Medium | fixed during audit | EventPanel | composite legend had no ramp and no labels |
| QA-14 | Low | fixed during audit | process.py | `histogram_valley` had no bimodality check |
| QA-18 | Low | fixed during audit | web/ | no favicon: 404 console error on every load |
| QA-19 | Low | fixed during audit (swipe handle is now 36 px wide; not re-measured) | App.tsx/CSS | swipe slider element was 0 px wide |
| QA-20 | Low | fixed during audit | a11y | map pins and close/collapse buttons below 24x24 |
| QA-21 | Low | mostly fixed (axe now reports only moderate `region`/`landmark-unique`) | a11y | contrast, link-in-text-block, nested-interactive |
| QA-05 | Low | fixed during audit | lib.ts | `fmtDate`/`fmtDateTime` on bad or date-only input |
| QA-06 | Low | fixed during audit (returns `null`) | lib.ts | `layerBounds([])` returned +-Infinity |
| QA-07 | Low | fixed during audit | App.tsx | Back button left the site |
| QA-08 | Low | fixed during audit | lib.ts | `parseCoords` gaps |
| QA-09 | Low | fixed during audit | Timeline | no axis ticks inside one calendar month |
| QA-11 | Low | fixed during audit (0 http links) | data | plain-http EONET link |
| QA-13 | Low | fixed in `process.py` (tier logic still lives in three places) | process.py/asf.mjs/services.ts | Python `tierOf` could not return URGENT RESPONSE |
| QA-22 | Low | fixed during audit (asf.mjs encoding, cropBox error, stage-1 keeps derived layers) | pipeline | hardening items |
| QA-23 | Low | fixed during audit | Timeline | svg label counted undrawn layers |

**Net: 23 issues reported; 19 were fixed by other engineers while the audit ran (each fix flipped its marked-expected-fail test red, and the test was converted to a normal regression test); 4 remain open (QA-12 high, QA-16, QA-10 medium, plus the tier-table duplication noted under QA-13).** Detail sections below keep the original reports, repros and root causes.

--- | --- | --- | --- |
| QA-12 | High | pipeline/georef | `georef_residual_m` understates the real error ~30x; ~45 deg footprints break |
| QA-04 | Medium | data/process.py | derived layers' `processing_date` has no `Z`: shown date can be off by a day |
| QA-16 | Medium | process.py science | 5x5 boxcar biases flooded area low (-36% on a synthetic 400 km2 patch) |
| QA-10 | Medium | data | Mozambique browse layers carry 642 m RMS georeference residual (shown as "residual 87 m"-style provenance) |
| QA-02 | Medium | SearchBox | **FIXED during the audit** (test now a regression test): late geocoder response overwrote the coordinates option |
| QA-01 | Medium | App.tsx | invalid `?mode=` in a shared link leaves no comparison mode active |
| QA-17 | Medium | EventPanel/CSS | Before/After observation rows overflow and are clipped by the 400 px panel |
| QA-03 | Medium | nisar_io | HTTP 429/408 not retried; server without Range support raises bare `KeyError` |
| QA-15 | Medium | data + EventPanel | Krasheninnikov composite legend has no ramp and no min/max |
| QA-14 | Low | process.py | `histogram_valley` has no bimodality check; all-NaN or land-only scenes get an arbitrary threshold |
| QA-18 | Low | web/ | **FIXED during the audit** (`favicon.svg` added): no favicon, a 404 console error on every load |
| QA-19 | Low | App.tsx/CSS | swipe slider element is 0 px wide (focus ring and hit area live on a child) |
| QA-20 | Low | a11y | map pins (22x22) and panel close/collapse buttons (23x22, 27x22) are below WCAG 2.2 AA 24x24 |
| QA-21 | Low | a11y | axe: colour contrast on `.faint` text, link-in-text-block, nested-interactive timeline svg, region |
| QA-05 | Low | lib.ts | **FIXED during the audit**: `fmtDate('garbage')` rendered "NaN undefined NaN"; `fmtDateTime` of a date-only string ended in " UTC" |
| QA-06 | Low | lib.ts | `layerBounds([])` returns +-Infinity |
| QA-07 | Low | App.tsx | hash is written with `replaceState`: Back button leaves the site instead of closing the panel |
| QA-08 | Low | lib.ts | **FIXED during the audit**: `parseCoords` rejected `+10.5`, lon-first hemisphere order, decimal comma |
| QA-09 | Low | Timeline | no month ticks at all when the observations span less than one calendar month |
| QA-11 | Low | data | one EONET context link is plain `http://` |
| QA-13 | Low | process.py/asf.mjs/services.ts | `tierOf` implemented three times; the Python one cannot return URGENT RESPONSE |
| QA-23 | Low | Timeline | svg label says "3 NISAR observations" while only the active kind (2) is drawn |
| QA-22 | Low | pipeline | stage-1 re-run drops derived layers; `cropBox` can return an empty box; `granule_list` built by string concat |

---

## High

### ISSUE-QA-12: georeference residual is not an uncertainty (and ~45 degree frames fail)
- **File**: `pipeline/src/georef.mjs` `georeference()` / `fitAffine()` (about L96-L127); consumed in `fetch-browse.mjs` (`georef_residual_m`) and shown in provenance text "residual N m RMS".
- **Repro**: `cd pipeline && node --test tests/georef.test.mjs`. A synthetic image whose true pixel-to-lon/lat mapping is known, rotated 4 degrees, is fitted with residual **19 m** while the real error at the true image corners is **633 m** (about 5.7 px). At 45 degrees the corner errors are 290-470 px (the axis/diagonal flavours swap).
- **Root cause**: the affine (6 parameters) is fitted to 4 matched points (8 equations); the RMS misfit of that fit says how consistent the 4 correspondences are with an affine, not how well each correspondence is located. The "top/left/bottom/right" extreme-row heuristic and quantisation to whole pixels move the matched points by several pixels systematically, which the residual cannot see.
- **Impact**: users read "residual 87 m" as the positional accuracy of the radar overlay. It is optimistic by an order of magnitude. Real frames are tilted ~10-25 degrees so the ~45 degree failure is not triggered today.
- **Suggested fix**: report an empirical bound (for example leave-one-corner-out error, or a fixed per-pixel floor `max(residual, 3 px)`), word the provenance as "corner fit residual", and add a guard that rejects fits where flavours disagree by more than a few pixels. Use the corner KML (login) as ground truth for at least one granule to calibrate the claim.
- **Tests**: `pipeline/tests/georef.test.mjs` (2 `todo` tests).

## Medium

### ISSUE-QA-04: `processing_date` of derived layers has no UTC designator
- **File**: `pipeline/python/process.py` `provenance()` (L119-L132, `meta.get("processingDateTime")` from `nisar_io._identification`); rendered by `web/src/components/EventPanel.tsx` (`fmtDate(p.processing_date)`, about L141).
- **Repro**: `web/public/data/events.json`: browse layers have `"2026-08-11T02:08:40Z"`, every derived layer (Venezuela LOS, Mozambique HH/change/water) has `"2026-08-11T02:08:40"`-style values without `Z`. `new Date('2026-08-11T02:08:40')` is parsed as **local** time; `fmtDate` then reads UTC fields. In UTC+3 or further east the page shows "10 Aug 2026". Test: `web/tests/unit/data-package.test.ts` (`it.fails` "processing_date ... explicit Z").
- **Suggested fix**: append `Z` when writing (`meta["processingDateTime"] + "Z"` if it has no offset) and make `fmtDate` treat offset-less ISO strings as UTC.

### ISSUE-QA-16: 5x5 boxcar biases flood area low
- **File**: `pipeline/python/process.py` `boxcar()` (L195) feeding `mozambique()` (`new_water`, `water_both_dates_km2`).
- **Repro**: `pytest tests/test_process.py::test_mozambique_water_classes_and_areas`. A synthetic 20x20 km water patch (400 km2) is classified as **256 km2** (the 16x16 interior): -36 %. The 5x5 averaging blends patch edges with land, so every water boundary loses about 2 px.
- **Impact**: the headline "about 316 km2 of new water" is a lower bound whose bias depends on the perimeter of the flooded area (large for river channels and fields). The text says "heuristic" but not "biased low".
- **Suggested fix**: classify on the un-filtered (or 3x3, or median-filtered) data, or erode/dilate symmetrically and report the area as a range; state the bias in `processing` steps and `explain.ts`.

### ISSUE-QA-10: Mozambique browse overlays are georeferenced to about 640 m
- **File**: data (`web/public/data/events.json`: `gcov_20251224`, `gcov_20260105`, `gcov_20260117`, `georef_residual_m: 641.7`) produced by `fetch-browse.mjs`.
- **Repro**: `node -e "..."` over events.json, or the data-package test (threshold is 1000 m, the three layers exceed 500 m). Combined with QA-12 the true error is likely larger.
- **Impact**: overlays are drawn on a Sentinel-2 basemap at city scale; a 0.6-2 km shift is visible for the Limpopo river and can mislead users comparing with place labels.
- **Suggested fix**: rerun with a better corner match (derived layers from the HDF5 grid are exact: prefer them as the default and label browse as "approximate position").

### ISSUE-QA-02 (FIXED during the audit): late geocoder response overwrites the search results
Status: another engineer changed `SearchBox.tsx` while this audit ran; the `it.fails` test turned red ("Expect test to fail") and was converted to a normal regression test. Original report:
- **File**: `web/src/components/SearchBox.tsx`, the debounce effect (about L22-L47).
- **Repro**: type `Caracas`, wait 300 ms (request fires), replace the text with `10.5, -67.2`. The in-flight request is only aborted by the *next geocode call*; when it resolves, `setItems([...local, ...hits])` replaces the "Go to coordinates" option with place hits. Same for clearing the box (stale hits appear under an empty query). Tests: `components.test.tsx` "a late geocoder response does not clobber..." (`it.fails`).
- **Suggested fix**: abort `abort.current` and ignore results in the effect cleanup (`let cancelled = false; return () => { cancelled = true; abort.current?.abort(); clearTimeout(t); }`), and check `cancelled` before `setItems`.

### ISSUE-QA-01: invalid `?mode=` (and `?lvl=`) is accepted verbatim
- **File**: `web/src/App.tsx` `readHash()` (L25: `mode: (q.get('mode') as CompareMode) || null`) and the `hashchange` handler (about L132-L140).
- **Repro**: open `#/e/venezuela-2026?mode=sideways`. No Swipe/Side/Overlay button is pressed, no swipe handle and no comparison is drawn; the mode string is also written back to the URL. E2E: `app.spec.ts` "an invalid ?mode= falls back to swipe" (`test.fail`).
- **Suggested fix**: whitelist `['swipe','side','overlay']` (same for `lvl`: `tsc` currently flags the unvalidated `lvl` cast at `App.tsx` L57/L140).

### ISSUE-QA-17: observation rows are clipped inside the panel
- **File**: `web/src/components/EventPanel.tsx` `ObsRow` (about L38-L60) with `.obs` in `web/src/styles.css` L178-L183.
- **Repro**: open Venezuela at 1440x900: the select text "1 Jun 2026 -> 13 Jun 2026 . LOS displaceme..." and the line "NISAR GUNW . track 162 ascen..." run past the right edge of the 400 px panel (see Playwright screenshot of a failing run). E2E: `app.spec.ts` "desktop: the investigation panel does not clip..." (`test.fail`).
- **Suspected root cause** (not confirmed in devtools): `.obs` is a 3-column grid (`auto 1fr auto`); grid children default to `min-width: auto`, so the long `<select>` label and the product line force the row wider than the 400 px panel.
- **Suggested fix**: `min-width: 0` on grid children, `max-width: 100%` and `text-overflow: ellipsis` on `.layer-select`, wrap the `.what` line.

### ISSUE-QA-03: RemoteFile retry gaps
- **File**: `pipeline/python/nisar_io.py` `RemoteFile._get()` (L70-L97).
- **Repro**: `pytest tests/test_nisar_io.py -k "429 or without_range"`. (a) A 429 or 408 is a 4xx, so `if e.code < 500: raise` aborts the download instead of backing off; CloudFront/ASF rate-limit with 429. (b) A server that ignores `Range` answers 200 without `Content-Range` and the code raises a bare `KeyError: 'Content-Range'`, which is not retried and not explained.
- **Suggested fix**: retry `{408, 425, 429}` (honour `Retry-After`), and raise `OSError("server ignored Range request")` when `Content-Range` is missing and status is 200.
- **Verified OK**: retries with 1,2,4,8,16,30,30,30 s backoff, gives up after 8 attempts with no token in the message, `Authorization` is *not* forwarded on redirect and `Range` is, signed URL is reused and refreshed on 401/403, subset reads fetch < 15 % of an 8 MB file.

### ISSUE-QA-15: Krasheninnikov composite legend is unrenderable (found by code and data inspection; not visually confirmed in the browser)
- **File**: `pipeline/python/process.py` `krasheninnikov()` legend (`"colormap": "composite"`, no `vmin`/`vmax`) and `web/src/components/EventPanel.tsx` `LegendBar` (L62 `RAMPS`, L83 `background: RAMPS[lg.colormap ?? 'gray']`).
- **Impact**: for `composite` the bar has `background: undefined` (empty) and the min/max labels print nothing. The text legend in `explain.ts` partly compensates.
- **Suggested fix**: add a `composite` branch that draws the three channel swatches from `legend.units`, or ship `vmin/vmax`.
- **Test**: `test_process.py::test_krasheninnikov_legend_is_renderable_by_the_web_legend_bar` (`xfail`, skips if the shipped data has no composite layers).

## Low

### ISSUE-QA-14: `histogram_valley` has no bimodality check
- `pipeline/python/process.py` L219-L234. All-NaN input returns -25.75 dB instead of the `fallback`; a land-only scene returns a threshold inside the land mode. With an empty gap between modes `argmin` returns the *first* empty bin, so the threshold hugs the water peak. Real Mozambique data is bimodal and reproduces the shipped -X dB threshold (test passes against the local cache), but a different frame would silently produce a nonsense mask. Tests: two `xfail` in `test_process.py`.
- Fix: require both peaks to exceed a minimum count/prominence, otherwise return `fallback`; take the *centre* of the minimal run.

### ISSUE-QA-18 (FIXED during the audit): no favicon
- `web/index.html` declares none and `public/` has none, so every load logs `Failed to load resource: 404 /favicon.ico`. E2E `test.fail`.

### ISSUE-QA-19: zero-width swipe slider
- `web/src/App.tsx` swipe handle (`role="slider"`, about L240-L262): the focusable element is a 0 px wide positioned div, only the child `.grip` has a box. Screen-reader and keyboard users get a slider with no focus ring/hit area on the element that is focused; Playwright treats it as hidden. Give the slider element the grip's box (or make the grip the slider).

### ISSUE-QA-20: touch targets below 24x24
- On a 375x812 viewport: map annotation pins 22x22, "Collapse panel" 27x22, "Close investigation" 23x22 (WCAG 2.2 SC 2.5.8, AA). axe reports `target-size` x8 on the Venezuela panel. E2E `test.fail` in `mobile.spec.ts`.

### ISSUE-QA-21: other axe findings (no critical)
From `web/test-results/axe-*.json` (re-generated by `npm run test:e2e`):
- `color-contrast` (serious): `.faint` credit text on the intro and on the Venezuela/Limpopo panels.
- `link-in-text-block` (serious): the EOX link inside `.faint` is distinguishable only by colour.
- `nested-interactive` (serious): Timeline `<svg role="img">` contains focusable `role="button"` groups (screen readers hide the children of `role=img`). Use `role="group"` on the svg or `role="list"`.
- `region` / `landmark-unique` (moderate): MapLibre controls and two canvases labelled "Map" outside landmarks.
- Also: the app has **two** `.maplibregl-canvas` elements (before/after maps); both are labelled "Map".

### ISSUE-QA-05 (FIXED during the audit): bad dates render as "NaN undefined NaN"
Status: fixed in `lib.ts` (invalid date -> em dash, date-only has no time part); tests are now regression tests. Original report:
- `web/src/lib.ts` `fmtDate` (L86) and `fmtDateTime` (L92). `fmtDateTime` uses `iso.slice(11,16)`, so a date-only string gives `"24 Jun 2026  UTC"`. Return the em dash for `Number.isNaN(d.getTime())` and omit the time when absent. Tests: 2 `it.fails`.

### ISSUE-QA-06: `layerBounds([])` returns infinities
- `web/src/lib.ts` L111. `Math.min(...[])` is `Infinity`; a caller that passes it to `map.fitBounds` throws. Guard for empty input. Test: `it.fails`.

### ISSUE-QA-07: Back button leaves the site
- `web/src/App.tsx` L150 uses `history.replaceState`, so opening an investigation adds no history entry; Back from an open investigation goes to the previous *site* (`about:blank` in the test). Use `pushState` when the selected event changes (and `replaceState` for mode/layer tweaks). E2E documents the current behaviour.

### ISSUE-QA-08 (FIXED during the audit): `parseCoords` coverage
Status: fixed in `lib.ts` (leading `+`, lon-first hemisphere letters, decimal comma, Unicode minus); tests are now regression tests. Original report:
- `web/src/lib.ts` L118. Rejects `+10.5, +67.2`, `67.2W 10.5N` (lon first with letters), `10,5 N 67,2 W` (decimal comma), and the Unicode minus. Common paste formats from Google Maps (`10.5, -67.2`) work. Three `it.fails` mark the gaps.

### ISSUE-QA-09: no month ticks inside one calendar month
- `web/src/components/Timeline.tsx` month-tick loop (about L38-L48) only emits ticks at the 1st of a month inside `[lo, hi]`. A 12-day window (5 to 17 Jan) therefore has an axis without any date labels (the markers have aria-labels but nothing visible). Add day ticks when the span is under ~40 days.

### ISSUE-QA-11: plain-http source link
- One `NASA EONET` context event links to `http://www.scp.byu.edu/...` (sea-ice iceberg source). Harmless as a link, but upgrade or drop non-https sources in `fetch-context.mjs`.

### ISSUE-QA-13: tier logic is implemented three times
- `web/src/services.ts` L49 `tierOf`, `pipeline/src/asf.mjs` L23 `tierOf`, `pipeline/python/process.py` L120. The Python copy cannot return `URGENT RESPONSE`. Export one table and test it (`test_provenance_tier_knows_urgent_response`, `xfail`).

### ISSUE-QA-23: timeline svg label counts layers that are not drawn
- `web/src/components/Timeline.tsx` L65 `aria-label={`${event.layers.length} NISAR observations of ...`}` while the component now draws only the layers of the active kind (`shown`). Krasheninnikov announces 23 observations and draws 11. Use `shown.length`. Test: `components.test.tsx` (`it.fails`).

### ISSUE-QA-22: pipeline hardening
- `fetch-browse.mjs` L157: `manifest.events.filter(...).concat(out)` replaces the whole event with browse-only layers, so re-running stage 1 silently deletes the stage-2 derived layers (until `process.py` is run again). Warn or merge.
- `georef.mjs` `cropBox()` returns `width/height <= 0` for a location outside the image and `sharp.extract` then throws (test documents it).
- `asf.mjs` L9 builds `granule_list=` by string concatenation: a name containing `&` would inject a parameter (test documents it; real NISAR names are `[A-Za-z0-9_]`).
- `georef.mjs` `imageCorners` throws a destructuring `TypeError` on sparse/empty data instead of a clear message (loud, but cryptic).
- `process.py` `to_mercator` uses `Affine * tuple`, which emits `PendingDeprecationWarning` (use `@`).
- `pipeline/package.json` is `"type": "commonjs"` while all sources are `.mjs`; works, but `node --test` needs the explicit `tests/` path.

---

## Not bugs, but worth knowing
- The Photon geocoder and the ASF search API are called straight from the browser. Both are public, key-less, CORS-enabled today; neither has a documented SLA. The app handles both outages (tested).
- `npm audit --omit=dev`: **0 vulnerabilities** (web and pipeline). No secrets in the repo or the build (see `test-report.md`).
- The assistant gateway, event catalogs, layers panel and Earthdata panel that appeared in the tree during the audit are **not covered** by this suite (other engineers were still building them). `web/tests/unit/assistant/*` and `web/tests/unit/earthdata.test.ts` belong to that work, not to this audit.
- `npm run build` currently fails at `tsc --noEmit` on someone else's in-progress edit: `src/App.tsx(57,63)` and `(140,27)` assign a `string` to the `'simple' | 'scientific'` level state (the unvalidated `?lvl=` hash value; same root cause as QA-01). `vite build` on its own succeeds.
