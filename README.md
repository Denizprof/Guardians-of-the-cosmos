# Guardians of the Cosmos: Global SAR

**See what happened. Compare what changed. Understand what the radar sees.**

A map-first explorer of real NASA-ISRO **NISAR** L-band radar observations, built for the NASA Space Apps Challenge 2026 ("Dancing with the SARs").

## Status
- [x] Pick challenge: Dancing with the SARs
- [x] Define users and problem: see [docs/design-brief.md](docs/design-brief.md)
- [x] Design concept
- [x] Prototype: photoreal 3D globe, three NISAR investigations, quantitative layers
- [ ] Demo and submission

## Investigations

| Event | Technique | NISAR data (ASF DAAC) | Result |
| --- | --- | --- | --- |
| Venezuela earthquakes, 24 Jun 2026 | Interferometry (GUNW) | Track 162A frame 007: 1→13 Jun (pre-event) vs 13→25 Jun (spans the quake), PROVISIONAL | Up to about 45 cm line-of-sight motion away from the satellite along the coast; pre-event noise 3.5 cm (std) |
| Limpopo floods, Jan 2026 | Backscatter (GCOV HH/HV) | Track 114A frame 165: 24 Dec, 5 Jan, 17 Jan, BETA | About 316 km² of new water around Chókwè (3,370 km² study area) |
| Krasheninnikov volcano, 2025–26 | Backscatter time series (GCOV) | Track 060D frame 061: 11 dates, 18 Jun – 28 Oct 2026 | NASA browse time series (full-resolution processing pending) |

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

## Run the demo
```bash
cd web && npm install && npm run dev
```
Open http://localhost:5173. The data package is already committed.

## Rebuild the data
```bash
cd pipeline && npm install
node src/fetch-browse.mjs && node src/fetch-context.mjs
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
