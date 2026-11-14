# Global SAR: engineering report

State as of 14 Nov 2026. Everything listed as **verified** was exercised by an automated test or a live check today. **Partial** means it works but has a known limit. **Blocked** means it needs something outside this repo.

## 1. Feature inventory

| Feature | Status | Where |
|---|---|---|
| Photoreal 3D globe (Sentinel-2 cloudless imagery, terrain, atmosphere, tilt/rotate) | Verified (e2e: canvas renders) | `web/src/map/MapView.tsx` |
| Investigations with before / after / change on real NISAR data | Verified (e2e + data tests) | `web/public/data/events.json` |
| Swipe, side-by-side and overlay comparison; timeline; shareable URL state; Back button | Verified (e2e) | `App.tsx`, `Timeline.tsx` |
| Simple / Scientific explanations, annotation pins, legends with physical units | Verified (unit + e2e) | `content/explain.ts`, `EventPanel.tsx` |
| Evidence badges: observation / derived / interpretation / model / simulation | Verified (unit) | `lib.ts` `evidenceOf` |
| Six-group taxonomy with subtypes and filters | Verified (unit + e2e) | `lib.ts` `GROUPS`, `Filters.tsx` |
| Event catalogs: tsunamis, M7+ earthquakes, eruptions, FIRMS fires, landslides, flood alerts; year filter | Verified (node tests on normalizers; app loads them) | `pipeline/src/fetch-catalogs.mjs`, `web/public/data/catalogs/` |
| 19 global satellite layers (NASA GIBS, UMD, JRC, EOX) with per-layer dates | Verified (live HTTP 200 per layer today) | `web/public/data/layers.json`, `LayersPanel.tsx` |
| Live NISAR coverage probe (ASF SearchAPI) | Verified (e2e with recorded fixture + live use) | `services.ts` |
| Live "NASA Earthdata available here" search (CMR) | Verified (unit with recorded fixture); live query 5–10 s | `earthdata.ts`, `EarthdataPanel.tsx` |
| Place / coordinate search (Photon geocoder) | Verified (e2e with recorded fixture, outage path) | `SearchBox.tsx` |
| AI Assistant integration layer (UI, adapter, contract, gateway) | Verified to the contract; **no model connected** (by design) | `web/src/assistant/`, `assistant-gateway/`, `shared/assistant-contract/` |
| Mobile layout (bottom sheet, stacked side-by-side) | Verified (e2e 375×812) | `styles.css` |

## 2. Categories

| Group | Types | What the app has today |
|---|---|---|
| Geohazards | earthquake, volcano, landslide, subsidence/uplift, tsunami | Venezuela quake (NISAR InSAR), Krasheninnikov volcano (NISAR time series); catalogs of earthquakes, eruptions, landslides, tsunamis |
| Fire & forests | wildfire, deforestation, vegetation change | Aspen Acres fire and União do Sul clear-cut (NISAR HV change); FIRMS fires; GIBS fire/DIST layers; UMD forest loss |
| Climate & cryosphere | glacier, sea ice, permafrost, coastal change, drought, desertification | GIBS snow, sea ice, land surface temperature, soil moisture layers; EONET sea-ice/drought reports. No glacier investigation yet |
| Water | flood, reservoir, river change, wetland | Limpopo flood (NISAR water mapping); GIBS MODIS flood and OPERA DSWx; JRC surface water occurrence and transitions; GDACS flood alerts |
| Ecosystems | habitat loss, land degradation, agricultural conversion | OPERA DIST-ANN, MODIS NDVI layers |
| Human activity | urban, industrial, mining, agriculture, infrastructure, energy, reclamation, conflict damage | Landsat built-up (HBASE), VIIRS night lights, EOX yearly mosaics; EONET man-made reports. No dedicated investigation yet; candidates researched (`docs/research/candidate-investigations.md`) |

## 3. Data sources

Listed with licences in `docs/data-sources.md` and `docs/research/category-datasets.md`. Only the offline pipeline needs a key: a free NASA Earthdata token.

## 4. Scientific methods

- **InSAR (GUNW):**
  - Line-of-sight displacement d = −φλ/4π, with λ taken from `centerFrequency`.
  - The ionosphere screen is subtracted and pixels with coherence < 0.3 or outside connected components are masked.
  - Displacement is referenced to a far-field box, and both pairs share one colour scale.
  - The noise floor comes from the pre-event pair: 3.5 cm standard deviation for Venezuela.
- **Water (GCOV HH):**
  - The threshold is the centre of the histogram valley, with bimodality checked, computed per date. For Limpopo the 5 Jan histogram is not bimodal, so both dates use the 17 Jan valley threshold (−14.75 dB); the provenance record says so.
  - New water = water-like after AND not water-like before AND darkened by more than 3 dB relative to the scene-wide median change (removes calibration / soil-moisture offsets between dates).
  - Area is reported as a range from two speckle filters: a 3×3 median as the estimate, and a 5×5 boxcar as the lower bound.
- **Vegetation loss (GCOV HV):** HV log-ratio on a 3×3 median; the scene-wide median change is removed first, then strong loss is below −3 dB. Volume scattering collapses when canopy is removed or burned. Where an independent reference exists (INPE DETER), the loss fraction inside its box is reported next to the AOI-wide fraction.
- **Time series:** an HH/HV composite on one fixed calibrated stretch for all dates, so colours are comparable between dates.
- **Browse imagery:** NASA renderings georeferenced from footprint corners, with an honest positional uncertainty of about 1–1.4 km. They are labelled as visualizations and never used for measurement.

### Investigation results (derived by team; heuristic, not field-validated)

| Investigation | NISAR data | Result | Check against independent source |
|---|---|---|---|
| Venezuela earthquakes, 24 Jun 2026 | GUNW, track 162A frame 007, PROVISIONAL | Up to ~45 cm LOS motion away from the satellite (p1 −45 cm) | Pre-event pair noise 3.5 cm std; pattern consistent with NASA's published analysis |
| Limpopo floods, Jan 2026 | GCOV HH, track 114A frame 165, BETA | New water 322–379 km² (of 3,370 km²); water on both dates 328–482 km²; threshold −14.75 dB | Scene-wide +3.07 dB brightening removed before change test |
| Krasheninnikov volcano, 2026 | GCOV HH/HV, track 060D frame 061, 11 dates | 12 derived time-series layers on one fixed calibrated stretch; scene median change +0.12 dB | Qualitative (no quantitative claim) |
| União do Sul clear-cut, Oct 2026 | GCOV HV, track 002A frame 172, PROVISIONAL→VALIDATED | 35.7 km² strong HV loss of 336 km² (11 %) | Inside the INPE DETER alert box: 11.4 of 16.8 km² (68 %) |
| Aspen Acres fire, Jun 2026 | GCOV HV, track 019A frame 021, PROVISIONAL | 68.1 km² strong HV loss of 1,539 km² | Reported fire size 372 km² (EONET/IRWIN); L-band HV maps woody canopy loss only, so it under-counts grass/shrub burn |

## 5. Tests (all run today)

| Suite | Command | Result |
|---|---|---|
| Web unit + property/fuzz (Vitest, fast-check) | `cd web && npm test` | 789 / 789 pass |
| End-to-end + accessibility (Playwright, Edge) | `cd web && npm run test:e2e` | being migrated to the redesigned UI; see `docs/qa/test-report.md` for the latest run |
| Pipeline JS (node:test + fast-check) | `cd pipeline && npm test` | 59 pass, 2 todo (see QA-12) |
| Pipeline Python (pytest + hypothesis) | `cd pipeline && <venv>/python -m pytest` | 196 / 196 pass |
| Assistant gateway (node:test) | `cd assistant-gateway && npm test` | 27 / 27 pass |
| Type check + production build | `cd web && npm run build` | pass |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |

Database and authentication tests are **not applicable**: the app is a static site with no database and no user accounts. The only server component is the assistant gateway, which has API, contract, CORS, size-limit and rate-limit tests.

Of the 23 issues the QA audit found (`docs/qa/issues.md`), 19 are fixed with regression tests. A second, seven-perspective code review (14 Nov 2026) and its fixes are recorded in `docs/qa/code-review-2026-11-14.md`.

## 6. Known limitations

- Investigation results are our own derived analysis, not official NASA products. The flood and vegetation-loss areas are heuristic and not field-validated.
- The InSAR sign convention comes from the ISCE3 source code, not from a NISAR document. It is consistent with the physics and with NASA's published Venezuela analysis.
- Browse georeferencing is approximate (about ±1–1.4 km), and footprints rotated about 45° are unsupported (2 todo tests, QA-12).
- NISAR public archive coverage is uneven: early-2026 products are BETA (CRID X05010) and we found no products from 27 Jul to 10 Aug 2026. Several investigations use BETA or mixed-CRID data (PROVISIONAL and VALIDATED), which is flagged in each provenance record.
- The ESA WorldCover layer is excluded because its Planetary Computer search ID expires; it needs runtime registration. ITS_LIVE and GHSL have no tile service.
- Tier logic is implemented three times (`services.ts`, `asf.mjs`, `process.py`). The copies are consistent, but they are duplicated.
- On Windows, the Python geospatial stack needs a short path (keep the repo near the drive root).

## 7. AI Assistant integration

Full instructions are in `docs/assistant-integration.md`. In short:

1. Implement your model behind an HTTP endpoint that accepts `shared/assistant-contract/assistant-request.schema.json` and returns `assistant-response.schema.json`. Every claim must cite ids from the request context.
2. Start the gateway: `cd assistant-gateway && ASSISTANT_MODEL_URL=<your endpoint> ASSISTANT_MODEL_API_KEY=<optional> npm start` (port 8787).
3. Put `VITE_ASSISTANT_GATEWAY_URL=/` in `web/.env.local`. The dev server proxies `/api/assistant` to the gateway.
4. Check your model against the contract: `cd assistant-gateway && ASSISTANT_MODEL_URL=<url> npm run test:contract`.

Until then, the panel shows "Assistant not connected" and never fabricates answers.

## 8. Commands

```bash
cd web && npm install && npm run dev        # run the app at http://localhost:5173
cd web && npm test && npm run test:e2e      # tests
cd web && npm run build                     # static build in web/dist
cd pipeline && npm install && node src/fetch-browse.mjs && node src/fetch-context.mjs && node src/fetch-catalogs.mjs
python pipeline/python/process.py           # needs EARTHDATA_TOKEN
```
