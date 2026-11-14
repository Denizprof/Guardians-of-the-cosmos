# Guardians of the Cosmos: Global SAR

**See what happened. Compare what changed. Understand what the radar sees.**

A map-first explorer of real NASA-ISRO **NISAR** L-band radar observations, built for the NASA Space Apps Challenge 2026 ("Dancing with the SARs").

## Status
- [x] Pick challenge: Dancing with the SARs
- [x] Define users and problem: see [docs/design-brief.md](docs/design-brief.md)
- [x] Design concept
- [x] Prototype: photoreal 3D globe, five NISAR investigations, quantitative layers
- [ ] Demo and submission

## Investigations

| Event | Technique | NISAR data (ASF DAAC) | Result |
| --- | --- | --- | --- |
| Venezuela earthquakes, 24 Jun 2026 | Interferometry (GUNW) | Track 162A frame 007: 1→13 Jun (pre-event) vs 13→25 Jun (spans the quake), PROVISIONAL | Up to about 45 cm line-of-sight motion away from the satellite along the coast; pre-event noise 3.5 cm (std) |
| Limpopo floods, Jan 2026 | Backscatter (GCOV HH/HV) | Track 114A frame 165: 24 Dec, 5 Jan, 17 Jan, BETA | About 322–379 km² of new water around Chókwè (3,370 km² study area; range from two speckle filters) |
| Krasheninnikov volcano, 2025–26 | Backscatter time series (GCOV) | Track 060D frame 061: 11 dates, 18 Jun – 28 Oct 2026 | Full-resolution HH/HV time series on one fixed calibrated stretch (12 layers) |
| União do Sul clear-cut (Mato Grosso), Oct 2026 | HV canopy change (GCOV) | Track 002A frame 172: 4 dates, 18 Sep – 24 Oct 2026 (change pair 30 Sep → 24 Oct) | 35.7 km² strong HV loss; 68 % of the INPE DETER alert box vs 11 % of the wider area |
| Aspen Acres fire (Colorado), Jun 2026 | HV canopy change (GCOV) | Track 019A frame 021: 4 dates, 15 Jun – 14 Aug 2026 | 68 km² woody canopy loss (reported fire size 372 km²; grass/shrub burn is under-detected by L-band HV) |

The globe also shows about 170 recent USGS (M6.3+) and NASA EONET events as **context only**, with no SAR analysis claimed. The coverage probe lists the real NISAR acquisitions over any clicked point, live from the ASF search API.

## Repo layout
- `web/`: the app (React + Vite + TypeScript + MapLibre GL 3D globe). Static build, no server, no API keys.
- `pipeline/`: offline data pipeline.
  - `src/*.mjs` (Node): NISAR browse images and context events. No login needed.
  - `python/` (Python): quantitative layers read from NISAR HDF5. Needs an Earthdata token.
- `web/public/data/`: the generated data package the app reads (`events.json` with full provenance, overlay images).
- `docs/design-brief.md`: challenge, problem, users, goals
- `docs/data-sources.md`: every dataset and API we use
- `design/`, `src/`: reserved from the original scaffold

## Publishing (not live yet)
The repository is private, and GitHub Pages needs a public repository or a paid plan, so the site is not published. A ready workflow (`.github/workflows/pages.yml`, manual trigger) builds and deploys the static site once Pages is available; it would be served at https://denizprof.github.io/Guardians-of-the-cosmos/.

A published site has no server, so the Meteomatics weather section and the AI assistant would show "not connected" there. Everything else works: the globe, investigations, satellite layers with colour legends, the SAR lens, the coverage probe and the event catalogs.

## Get it running

You need [Node.js](https://nodejs.org) 20.19 or newer (22 recommended) and git. No API keys are needed: the data package is already in the repository.

```bash
git clone https://github.com/Denizprof/Guardians-of-the-cosmos.git
```
```bash
cd Guardians-of-the-cosmos
```
```bash
npm run setup
```
```bash
npm start
```

`npm start` builds the app and serves it at http://localhost:4173. The repository is private, so you need to be invited as a collaborator before you can clone it.

| Command (from the repo root) | What it does |
| --- | --- |
| `npm run setup` | Installs the web app's dependencies (once) |
| `npm start` | Builds and serves the finished app at http://localhost:4173 |
| `npm run dev` | Development server with live reload at http://localhost:5173 |
| `npm test` | Runs the web unit tests |

### Install it as an app
Open the running app in Chrome or Edge and choose **Install Global SAR** (the icon at the right of the address bar, or the browser menu). It then opens in its own window with its own icon, like a desktop app. On a phone, use **Add to Home screen**. The app still needs the local server (or a hosted copy) and an internet connection, because the map imagery is loaded live.

### Optional: weather data
Weather-model values from Meteomatics need your own account. Copy `web/env.example` to `web/.env.local`, fill in your username and password, and restart. Details: [docs/meteomatics.md](docs/meteomatics.md). Without it the weather section says "not connected" and everything else works.

### Optional: AI assistant
The assistant panel says "not connected" until a model is plugged in. See [docs/assistant-integration.md](docs/assistant-integration.md).

## Rebuild the data
```bash
cd pipeline && npm install
node src/fetch-browse.mjs && node src/fetch-context.mjs && node src/fetch-catalogs.mjs
pip install -r python/requirements.txt
python python/process.py
```
`python/process.py` needs a free Earthdata Login token. Generate it at https://urs.earthdata.nasa.gov/user_tokens and set it as the `EARTHDATA_TOKEN` environment variable. Never commit it.

On Windows, keep the repo at a short path such as `C:\dev\...`; some Python packages fail beyond the 260-character path limit.

## How it works
- **Stage 1 (no login):** downloads NASA's official NISAR browse images and georeferences them. Their KML sidecars require a login, so the pipeline fits each image's data corners to the ASF footprint and records the residual per layer (about 25–650 m).
- **Stage 2 (Earthdata token):** streams only the needed HDF5 chunks over HTTPS, with retries for flaky networks.
  - GUNW: ionosphere screen removed, coherence mask applied, then line-of-sight displacement in cm.
  - GCOV: dB, log-ratio change, and a histogram-valley water threshold combined with a −3 dB change test.

## Scientific integrity
- Every layer records mission, product, data tier, CRID, track, frame, acquisition times, granule ID and each processing step.
- NASA browse images are labelled "NASA browse". Our computations are labelled "derived by team".
- Known limits are stated in the app: line-of-sight only, uncorrected troposphere, BETA calibration, seasonal snow, heuristic water classification.
- No simulated or predicted layers.

## Team
Add names and roles here.

## NASA resources
- Space Apps Challenge: https://www.spaceappschallenge.org
- NISAR data documentation (ASF): https://nisar-docs.asf.alaska.edu/
- Earthdata: https://www.earthdata.nasa.gov

## Credits
NISAR data: NASA/JPL-Caltech & ISRO, distributed by ASF DAAC. Event context: USGS, NASA EONET. Globe imagery: Sentinel-2 cloudless 2024 by EOX (CC BY-NC-SA 4.0). Terrain: Mapzen/AWS Terrain Tiles. Labels: © OpenStreetMap contributors, OpenFreeMap.
