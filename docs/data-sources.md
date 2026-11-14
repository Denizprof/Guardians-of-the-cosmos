# Data Sources

All sources were checked live on 14 Nov 2026. Only one needs a key: the free NASA Earthdata Login token used by the offline pipeline. The web app itself needs no keys.

| Source | URL | What we use it for | Access/key needed |
|--------|-----|--------------------|-------------------|
| NISAR L2 GUNW (geocoded unwrapped interferogram) | https://nisar-docs.asf.alaska.edu/gunw/ | Venezuela earthquakes: line-of-sight ground motion (cm), coherence | Earthdata Login token (offline pipeline only) |
| NISAR L2 GCOV (geocoded backscatter, HH/HV) | https://nisar-docs.asf.alaska.edu/gcov/ | Mozambique floods (dB change, water masks); Krasheninnikov time series | Earthdata Login token (offline pipeline only) |
| NISAR browse images (official PNG quicklooks) | https://nisar.asf.earthdatacloud.nasa.gov/BROWSE/ | Before/after imagery for all three events, no login | None |
| ASF SearchAPI | https://api.daac.asf.alaska.edu/services/search/param | Finding granules; live "what NISAR data exists here?" coverage probe in the app | None |
| NISAR data availability (BETA / PROVISIONAL / VALIDATED tiers) | https://nisar-docs.asf.alaska.edu/availability-overview/ | Data-tier badges and gap explanations | None |
| USGS earthquake catalog | https://earthquake.usgs.gov/fdsnws/event/1/ | Context markers (M6.3+, past 12 months) | None |
| NASA EONET v3 | https://eonet.gsfc.nasa.gov/docs/v3 | Context markers (volcanoes, floods, landslides, wildfires) | None |
| EOX Sentinel-2 cloudless 2024 | https://s2maps.eu | Photoreal globe imagery (CC BY-NC-SA 4.0, non-commercial) | None |
| AWS Terrain Tiles (Terrarium) | https://registry.opendata.aws/terrain-tiles/ | 3D terrain | None |
| OpenFreeMap / OpenStreetMap | https://openfreemap.org | Borders and place labels | None |
| Photon geocoder (komoot) | https://photon.komoot.io | Place search | None |

## References used to validate our results
- NASA Earth Observatory, Venezuela earthquakes: https://science.nasa.gov/earth/earth-observatory/where-venezuelas-earthquakes-shifted-the-ground/
- UCSD/JPL line-of-sight displacement grids: https://topex.ucsd.edu/VNZ_7.5/index.html
- NASA SVS 5661, Mozambique floods: https://svs.gsfc.nasa.gov/5661
- NASA SVS 5675, Krasheninnikov time-lapse: https://svs.gsfc.nasa.gov/5675

## Credit line
NISAR L-band data: NASA/JPL-Caltech & ISRO, distributed by ASF DAAC (EOSDIS open data policy).
