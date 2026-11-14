# Code review, 14 Nov 2026

Seven review agents read the whole working tree (web app, data pipeline, assistant gateway, docs) and reported only findings with confidence ≥ 80 %:
- correctness and security
- silent failures
- type design
- test gaps
- comment accuracy
- simplification
- React frontend

Each finding below was checked against the current code before it was fixed. Each fix has a regression test unless marked otherwise.

## Fixed: science and data integrity

| Finding | Fix |
|---|---|
| The Limpopo provenance claimed each date had its own measured water threshold. The 5 Jan histogram is not bimodal, so both dates used the 17 Jan valley threshold (−14.75 dB). | `histogram_valley_info` reports when the fallback is used. The provenance, report and in-app text now say so. Results are unchanged (new water 322–379 km²). |
| The NISAR GCOV validity `mask` was read but never applied. | Applied per the dataset's own description: 0 = not fully focused (invalid), 255 = outside the swath. This affected at most 0.02 % of pixels in our scenes, and the step is recorded in every GCOV provenance record. |
| An almost empty radar window would publish a transparent layer that reads as "no change". | `cached_gcov` raises when fewer than 20 % of HH pixels are valid. |
| The coverage panel labelled unrecognised ASF collections "VALIDATED". | `tierOf` returns `UNKNOWN` for unrecognised names. |
| Year- or month-precision catalog dates were shown and searched as 1 January. | `fmtDatePrecise`. A coarse date no longer anchors a ±days search window. |
| The timeline and Earthdata search window parsed offset-less times as local time. | `parseUTC` is used everywhere. |
| 15 earthquakes were drawn twice (context.json and the USGS catalog). | De-duplicated by id. |
| "Active fires, last 24 h" showed no snapshot time. | The Filters panel shows "Snapshot from …" and flags snapshots older than 24 h. |
| The coverage "earliest" label and "250+" were wrong when ASF truncated the list or Urgent Response rows were dropped. | Truncation is judged on the raw response. The panel says "oldest listed", counts Urgent Response products, and says how many footprints it draws. |
| Docs and app text claimed "January–June 2026 is unreleased", which contradicts our January and June investigations. | The claim was removed; only the verified 27 Jul–10 Aug gap is stated. |

## Fixed: errors that looked like "no data"

- **Earthdata panel:**
  - A missing `CMR-Hits` header was read as 0 granules. It is now "unknown".
  - When every count request fails, the panel shows an error with Retry instead of "no collections found".
- **context.json and layers.json failures** are shown in their panels; previously they were silent empties.
- **Catalog loads:** a failed load is no longer cached forever. Toggling the catalog, or its Retry button, tries again, and the error is visible text rather than a hover-only "!".
- **Map tile, image and style failures** on the globe and in the SAR lens now show a dismissible notice. The lens used to log them only in development builds, so a failed radar tile looked like a day without a pass.
- **Crashes:** an ErrorBoundary with a WebGL2-specific message replaces the blank page.
- **Pipeline exit codes:** `fetch-catalogs` and `fetch-browse` exit non-zero when a source or a configured granule is missing.
- **Pipeline response shapes:** paged USGS and NOAA responses without data arrays fail the source instead of leaving a silent gap.
- **Pipeline cache:** the GCOV cache is written atomically, versioned, and refetched when corrupt.
- **Missing polarisation:** a requested polarisation that a file lacks now fails at read time with a clear error.

## Fixed: security

- The coverage thumbnail URL now passes through `safeHref` (http(s) only), like every other external URL.
- Gateway: same-origin requests through the local Vite proxy are accepted even with an empty `ALLOWED_ORIGINS`. Only loopback hosts qualify, so a DNS-rebinding page cannot use it.
- A model redirect can never forward the API key (test added).
- The gateway now logs sanitized operator errors: event name, status and error code only.
- The assistant context uses the same evidence rule as the UI badges, and clips text to the request schema limits.

## Fixed: frontend usability, accessibility and performance

- **SAR lens:**
  - From zoom 5 the lens renders only its square instead of a full-screen globe clipped by CSS: a 360×360 canvas instead of the whole window, across 12 raster sources. At globe zoom and in full screen it keeps the exact clipped view.
  - Camera sync is throttled to one update per frame.
  - The square is kept clear of the bottom timeline and the mobile sheet, using the measured top bar.
  - Resizing follows the dominant axis.
  - Escape and outside clicks close the provenance popover.
  - The date label is recomputed when the lens opens.
- **Phones (≤ 520 px):** tool buttons are icon-only, so all six fit at 375 px; the SAR lens button was previously cut off.
- **Focus management:** opening a side panel moves focus to its heading, and closing it returns focus to the opener.
- **Search box:** follows the WAI-ARIA combobox pattern (`aria-activedescendant`, options are not tab stops, ArrowDown reopens, live result count, stale errors cleared).
- **Swipe divider:** clamped to the visible map; Home/End/Shift+arrow keys; `aria-valuetext`.
- **Contrast:** the active pin number contrast goes from about 2.1:1 to about 8:1.
- **Sheet height:** the mobile sheet height follows rotation and resize.

## Fixed: comments and docs

- A stale cache description, "decade" paging (it is 25-year windows), raster-source counts, and the DEM resolution and tile-count arithmetic.
- The Aspen before/after pair wording and the attribution of the "20 miles south-west of Pueblo" description.
- The process.py module docstring, the README rebuild command, and the archive-gap statement.

## New tests

- **Web:** `tests/unit/review-fixes.test.ts` (16 tests); IntroPanel coverage states updated for the new contract.
- **Pipeline Python:** `tests/test_science_review.py` (11 tests):
  - the HV-loss workflow with a known loss patch and a calibration offset that must not count as loss
  - the `same_grid` guard
  - pixel placement in `to_mercator`
  - the mask and the threshold fallback
- **Pipeline Node:** catalog date fuzz cases BUG-PIPE-1 to 5 are now regression tests.
- **Gateway:** model-URL validation, spoofed proxy headers, response size caps, the same-origin proxy, and redirects.

## Not done (lower payoff, or needs a decision)

- Splitting `App.tsx` (~700 lines) and `MapView.tsx` (~900 lines) into smaller modules, and a shared fetch-JSON helper (simplification review). These are behaviour-preserving refactors, left for after the demo.
- A single shared tier rules table for Python, Node and the browser. The copies are consistent and now cross-commented.
- Runtime validators for every external API shape (type-design review). The shape checks added here cover the paths that could crash or mislabel data.
- An ESLint setup with `react-hooks` and `jsx-a11y` rules.
- An e2e migration to the redesigned UI is in progress; results go to `docs/qa/test-report.md`.
