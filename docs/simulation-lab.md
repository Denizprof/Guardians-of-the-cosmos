# WHAT IF? Planetary Simulation Lab

Status of the Earth Intelligence and simulation upgrade (2026-11-22). Every Lab result carries the evidence class **simulation**. It is never presented as an observation or a forecast.

## Architecture (web/src)

| Layer | Files | Role |
| --- | --- | --- |
| Engines (pure TS, deterministic) | `sim/impact.ts`, `sim/earthquake.ts` | Inputs → `SimResult`: equations, intermediate steps, outputs with ranges, zones, series, phases, assumptions, limitations, references |
| Registry / validation | `sim/registry.ts`, `sim/validate.ts`, `sim/types.ts` | Engine lookup and range checks. Planned categories are listed with their blocker and are never faked |
| Orchestration state | `sim/store.ts` | Scenarios A, B, C… shared by the Lab, the globe and the assistant |
| Time | `sim/time.ts` | Slider ↔ model time (linear before the event, logarithmic after), zone fronts at time *t* |
| Existing AI, upgraded | `assistant/local/simulate.ts`, hooked into `LocalAssistantAdapter.prepare()` | "What if…" questions run the engine. Also handles "explain the simulation", "compare the scenarios" and "twice as fast". It quotes only computed numbers and cites `sim:*` |
| NL parsing | `sim/parse.ts` | Parameters, a gazetteer, and Photon geocoding as a fallback. English and Turkish |
| Reports | `sim/explain.ts` | Assistant text, plus Markdown and JSON export |
| UI | `components/sim/*`, `map/markers.ts#addSimLayers`, `MapView` `sim` prop | Lab panel ("What if?" in the top bar), time controls, Results Lab tabs, zones on the globe, comparison outlines |
| History | `sim/history.ts` | Known impacts (Chelyabinsk … Vredefort), labelled *historical record* or *reconstruction*, with the option to re-run them from published estimates |

## Models

- **Impact:** Collins, Melosh & Marcus (2005). Atmospheric entry is integrated numerically (drag plus pancake spreading, airburst at 7 L₀). Also covers transient and final crater, airblast overpressure, thermal fireball (≥ 15 km/s), ejecta thickness, seismic magnitude and effective magnitude with distance, and for ocean impacts the cavity and a 1/r wave amplitude at speed √(gd).
- **Earthquake:** Hanks–Kanamori moment, Gutenberg–Richter energy, Wells & Coppersmith (1994) rupture length, and the Atkinson & Wald (2007) intensity prediction (California coefficients, point source).
- **Flood** (`sim/flood.ts`, `sim/dem.ts`, `sim/floodRun.ts`, `sim/floodWorker.ts`):
  - Solver: the 2-D inertial shallow-water solver of Bates, Horritt & Fewtrell (2010), the LISFLOOD-FP scheme, with adaptive time steps.
  - Terrain: the real AWS Terrain Tiles (Terrarium) DEM, the same one the globe uses for relief, on a grid of up to 200×200 cells (2–60 km area).
  - Inputs: uniform rain with a constant infiltration loss, and an optional sea-level rise or surge. Sea cells keep a fixed level, so only lowland connected to the sea floods (not a "bathtub" model).
  - Runs in a Web Worker with progress and cancel. Output is depth frames on the globe, flooded area over time and a mass-balance check.
- **Tsunami** (`sim/tsunami.ts`, `sim/tsunamiRun.ts`, `sim/tsunamiWorker.ts`):
  - Source: a thrust earthquake. Rupture length and width come from Wells & Coppersmith (1994, reverse faults) and slip from D = M₀/(μLW). Peak seafloor uplift is D sin δ over a raised-cosine patch, copied instantly to the sea surface.
  - Propagation: the linear long-wave equations on a staggered grid (the deep-ocean scheme of TUNAMI/COMCOT), up to 250×250 cells over 300–5,000 km. Each grid row uses its true Web-Mercator cell size. Land is a reflecting wall and an edge sponge absorbs outgoing waves.
  - Bathymetry: the AWS Terrain Tiles (ETOPO1 / SRTM15+ offshore), the same tiles the globe uses.
  - Outputs: arrival time and maximum height at coastal cells and at named cities within 60 km, a Green's-law near-shore estimate, a tide-gauge-style record, and sea-surface frames on the globe (crests red, troughs blue). Coast inside the rupture area is reported separately and is not treated as an "arrival".
  - The assistant maps a question to a real subduction-zone source (`TSUNAMI_SOURCES` in `sim/parse.ts`: Japan Trench, Sunda, Chile, Peru, Cascadia, Alaska, Middle America, Hellenic Arc, Makran). A named city uses the nearest trench within 2,500 km.
  - Real-data check (Mw 9.0 at the Japan Trench):
    - The model gives 631 km rupture, 17.5 m slip, 4.2 m uplift, about 6.9 m at the coast, and about 700 km of travel in 1 h.
    - Tōhoku 2011 had a ~400–500 km rupture, ~10–20 m average slip, ~5 m uplift, and ~6–7 m offshore buoy readings.
    - This is a plausibility check, not a calibration.
- **Volcano** (`sim/volcano.ts`, `sim/volcanoRun.ts`, `sim/volcanoWorker.ts`, `sim/wind.ts`):
  - Eruption source: plume height sets the eruption rate (Mastin et al. 2009). The VEI comes from the bulk tephra volume (Newhall & Self 1982).
  - Ash fall follows the Tephra2 approach (Bonadonna et al. 2005):
    - mass is released along the column with a Suzuki profile in 13 grain sizes;
    - each size falls at its terminal velocity (Bonadonna et al. 1998 regimes) through the wind at each height;
    - on the ground each patch spreads as a Gaussian, integrated exactly over each cell with erf so mass is conserved.
  - Outputs: ash-thickness frames over time on a 160×160 grid (50–1,500 km), areas under ≥ 1 mm, 1 cm and 10 cm, and the ash thickness and first-arrival time at listed cities.
  - Pyroclastic flows: an energy cone (Malin & Sheridan 1982) run against the real DEM from the summit nearest the chosen point.
  - Winds aloft: the current Open-Meteo forecast at up to 15 pressure levels (no key needed), or calm air if you choose it.
  - The assistant reads eruption questions, a VEI or column height, a duration and 15 named volcanoes (`VOLCANOES` in `sim/parse.ts`). The Lab has a volcano picker.
  - Real-data checks:
    - Column height and duration reproduce the VEI of Mount St. Helens 1980 (VEI 5) and Pinatubo 1991 (VEI 6).
    - Vesuvius with today's winds: a 25 km column for 8 h gives VEI 5 (as in 79 AD), ash carried downwind, and pyroclastic flows reaching about 11 km (Pompeii is about 10 km from the summit).
- **Wildfire** (`sim/wildfire.ts`, `sim/wildfireRun.ts`, `sim/wildfireWorker.ts`, weather in `sim/wind.ts`):
  - Spread rate: the Rothermel (1972) surface-fire model with the Albini (1976) dead/live formulation, as in BehavePlus and FARSITE (equations from Andrews 2018), using 9 Anderson (1982) fuel models.
  - Dead-fuel moisture comes from humidity and temperature (Simard 1968). Wind and the slope of each DEM cell are combined as vectors.
  - Fire shape: Anderson (1983) length-to-breadth ratio. The fire grows from the focus of an ellipse, and its minimum arrival time across the terrain is found with Dijkstra on a 16-neighbour stencil. Water stops the fire, including knight-move jumps across it.
  - Weather: the current Open-Meteo 10 m wind, humidity and temperature, or values entered by hand.
  - Outputs:
    - burned area over time
    - head spread rate, intensity and flame length, with the standard suppression interpretation
    - L/B ratio
    - arrival time at listed places
    - an active front (last 30 min) and the burned area on the globe
  - The assistant reads fire questions with fuel words (grass, maquis or chaparral, forest), a wind speed and direction, humidity, temperature, duration, a place or coordinates.
  - Validation: all 8 fuel models tested reproduce Anderson's (1982) published table (8% dead and 100% live moisture, 5 mi/h midflame wind) to within 25%, most within 10%.

## Validation

- `tests/unit/sim/impact.test.ts`, analytical checks: mass, energy, overpressure crossover, √(gd), and geodesic circle radius.
- Reference events (order of magnitude):
  - Chelyabinsk: airburst at 15–45 km, ~0.3–0.7 Mt.
  - Meteor Crater: crater 0.5–2 km (observed 1.2 km).
  - Chicxulub: complex crater 90–250 km (observed ~180 km).
- `tests/unit/assistant/simulation.test.ts` checks that the answer's numbers equal a direct engine run and that out-of-range requests are refused.

## Not done yet / dependencies

- **The climate engine** is planned only. It should read published IPCC AR6 projections rather than run a climate model in the browser.
- **Wildfire limits:**
  - One fuel model everywhere (no fuel map); a global fuel or land-cover layer is the main missing dataset.
  - Constant weather.
  - No crown fire, spotting, fire–atmosphere coupling or firefighting.
  - Cells are about 100 m, so roads and firebreaks are not seen.
- **Wildfire validation** (`tests/unit/sim/wildfire.test.ts`):
  - The Anderson table above.
  - Spread stops at the moisture of extinction; drier fuel, more wind and upslope all spread faster.
  - Shape is circular with no wind.
  - A no-wind spread on flat ground gives the circle area πR₀²t² to within 20%.
  - Wind pushes the fire downwind, slope pushes it upslope, and water stops it.
  - Weather and question parsing.
- **Volcano limits:**
  - One wind profile for the whole event.
  - No ash aggregation, plume bending, or airborne-ash concentrations for aviation.
  - No lava flows, lahars, ballistic blocks or gas.
  - The energy cone ignores channelling in valleys.
  - The eruption rate from plume height is uncertain by about 4×.
  - Ash that leaves the domain is reported as a share in the Working tab.
- **Volcano validation** (`tests/unit/sim/volcano.test.ts`):
  - VEI for St. Helens and Pinatubo.
  - Settling velocities.
  - At least 99% of the ash mass is kept in the grid.
  - Calm air gives a centred deposit; wind gives downwind drift.
  - Deposits only grow over time and thin with distance.
  - The energy cone matches an analytic intersection.
  - Open-Meteo wind parsing.
  - The VEI-to-column inversion.
- **Tsunami limits:**
  - No inundation or run-up on land; near-shore height uses Green's law only.
  - No Okada subsidence lobe, friction, dispersion or Coriolis.
  - On coarse grids, waves that shorten over shelves are smoothed out, so coastal heights can be under-estimated (use a smaller domain for a specific coast).
  - Only earthquake sources (landslide and volcanic sources are not modelled).
  - Ocean impacts still use the separate 1/r estimate in the impact engine.
- **Tsunami validation** (`tests/unit/sim/tsunami.test.ts`):
  - The wave front speed matches √(gd) to within 10%.
  - Water volume is conserved in a closed basin to about 1e-9.
  - Waves grow over a resolved shelf.
  - Coastal arrivals are reported.
  - Coast inside the source area is not counted as an arrival.
  - Rupture scaling is in the Tōhoku range.
- **Flood limits:**
  - Cells are about 100–300 m wide, so drains, sewers and small channels are not resolved.
  - No upstream river inflow.
  - The DEM is partly a surface model.
  - Flat domain edges do not drain.
- **Flood validation** (`tests/unit/sim/flood.test.ts`):
  - A closed bowl stores all rain to within 0.1%.
  - Water at rest stays at rest.
  - Infiltration closes the water budget.
  - A tilted plane drains.
  - A raised sea floods connected lowland but not a basin behind a wall.
  - There is no comparison against an observed flood yet.
- **Predictive and historical intelligence** beyond the existing catalogs (multi-decade flood exposure, InSAR displacement trends) needs time-series datasets that this static app does not have. Nothing has been fabricated in their place.
- **Animated plate reconstructions** ("Earth through time") need a GPlates-derived dataset. Only impact history is included now.
- **Web Worker:** the impact and earthquake engines run in under ~20 ms on the main thread. The flood solver runs in a worker.
- **Known model limits:**
  - About ±2× on radii.
  - No terrain or bathymetry, coastal run-up or population exposure.
  - Thermal radiation from an airburst is not modelled.
  - Earthquake shaking uses a point source with no site effects.

## The in-app guide

Open it with "? Guide" in the Lab header, "What does this show?" on the time bar, or the links under the results.

- It is a full-screen help page (`components/sim/SimHelp.tsx`) with a topic list: Start here, the six events, Time controls, Reading the results, and Words and units.
- A **Simple / Scientific** switch changes every sentence. Simple uses everyday words; Scientific gives the model, equations and units. The choice is remembered.
- Each event has an animation (`HelpScenes.tsx`, drawn in the Event Atlas style) with Play/Pause and clickable steps. With "reduce motion" set, it opens paused on the finished picture.
- Each event explains every circle and colour (with the same colours as the globe), every setting with its allowed range, every result number, real events to compare with, and the limits.
- "Load" buttons fill the Lab with a ready-made example without running it.
- Content is in `sim/helpContent.ts` and `sim/helpScenes.ts`. Setting ranges are read from the engines, and tests fail if a setting has no explanation.
- The guide is in English only for now; the rest of the Lab is too.
