# Datasets by category (research, 14 Nov 2026)

This document pairs each subcategory in the owner's taxonomy with:
- the observation type that is scientifically appropriate,
- whether SAR should be the primary source,
- the datasets to use (IDs refer to the registry in Part 2).

**Verification legend (column "Chk"):**
- ✓T: a map tile was fetched today (HTTP 200, image). See `layer-catalog.proposed.json`.
- ✓A: the API or data endpoint was queried today and returned data.
- ✓P: the documentation page was opened today (HTTP 200) or read.
- ✗: tried today, unreachable from this network (unverified).
- —: not opened (unverified; from prior knowledge only).

## Part 1: Subcategory → technique → datasets

**SAR role:**
- **P**: SAR is the primary source.
- **S**: SAR is supporting or complementary.
- **N**: SAR is not appropriate; use another observation.

### A. Natural disasters and geology
| Subcategory | Best observation and technique | SAR | Datasets |
|---|---|---|---|
| Earthquakes, co-seismic deformation | InSAR line-of-sight displacement (GUNW); seismic catalog for context | P | D1 NISAR GUNW, D5 OPERA DISP-S1, D7 USGS ComCat |
| Volcanoes | InSAR deformation and coherence; backscatter for new deposits and craters; thermal IR for lava; UV for SO₂ | P (deformation) / S (thermal) | D1, D11 GOES FireTemp, D12 VIIRS imagery, D8 Smithsonian GVP |
| Landslides | SAR amplitude and coherence change, InSAR slow motion; optical for scars; susceptibility models | P / S | D1, D2 OPERA RTC-S1, D9 NASA LHASA (model), D28 Copernicus DEM |
| Subsidence / uplift | InSAR time series (SBAS/PS) | P | D1 GUNW stack, D5 OPERA DISP-S1 (N. America), D6 EGMS (Europe) |
| Tectonics (interseismic) | Multi-year InSAR plus GNSS | P | D1, D6 |
| Tsunami coastal impact | Pre/post SAR backscatter and coherence plus optical (inundation, debris) | P / S | D1, D2, D33 Sentinel-2/Landsat; no dedicated global tsunami product found |

### B. Wildfires and forests
| Subcategory | Best observation and technique | SAR | Datasets |
|---|---|---|---|
| Active fire | **Thermal IR** hotspots (3.9 / 11 µm). SAR cannot detect fire. | **N** | D10 NASA FIRMS (VIIRS 375 m, MODIS 1 km), D11 GOES ABI FireTemp |
| Burned area | Optical SWIR/NIR (dNBR); L-band HV drop and coherence loss in forests | S (P under persistent cloud) | D12 VIIRS M11-I2-I1, D4 OPERA DIST-ALERT, D33 Sentinel-2, D1 GCOV |
| Post-fire change / recovery | Optical NDVI/NBR time series; SAR HV recovery | S | D18 MODIS NDVI, D4, D1 |
| Deforestation | Landsat-scale loss maps; L-band HV change (cloud-proof); national alert systems | P/S (L-band is strong) | D13 Hansen GFC, D14 INPE DETER/PRODES, D4, D1 GCOV, D35 MapBiomas |
| Degradation (logging, edge) | Dense optical time series; L-band texture and HV | S | D4, D13, D1 |
| Vegetation / land-cover change | **Optical plus ML land-cover products** | N/S | D15 ESA WorldCover, D16 Dynamic World, D17 MODIS MCD12Q1, D18 |

### C. Climate change
| Subcategory | Best observation and technique | SAR | Datasets |
|---|---|---|---|
| Glacier retreat | Terminus mapping: optical (Landsat/S2) and SAR (ice/water boundary) | S/P | D1 GCOV, D33, D19 ITS_LIVE |
| Glacier velocity | Feature tracking of optical and SAR image pairs | P/S | D19 ITS_LIVE (COG, CORS ✓), D1 |
| Ice sheets | Velocity (SAR/optical tracking), elevation (altimetry), mass (gravimetry) | S | D19, D23 GRACE-FO |
| Sea ice | Passive microwave concentration (climate record); SAR for floes and leads | S (P for detail) | D21 MUR / AMSR2 via GIBS, D22 NSIDC Sea Ice Index (✗), D1 |
| Permafrost | InSAR seasonal subsidence; thermal and ML products | S | D1, D24 ESA CCI Permafrost |
| Coastal change | Shoreline from optical time series; SAR land/water | S | D26 JRC GSW transitions, D33, D1 |
| Sea-level impacts | **Altimetry** (not imaging SAR) plus tide gauges; InSAR for coastal land subsidence | N (S for land motion) | SWOT / Sentinel-6 (—), D1 |
| Sea-surface temperature | **Thermal IR / microwave radiometry**. SAR does not measure SST. | **N** | GHRSST MUR SST (GIBS layer exists and a tile was fetched; not in the catalog because it is outside the taxonomy) |
| Desertification | Long-term NDVI, land cover, soil moisture | N | D18, D15, D25 SMAP |
| Drought | Soil moisture, NDVI anomaly, LST, GRACE storage | N (L-band radiometry is not imaging SAR) | D25 SMAP L4, D18, D27 MODIS LST, D23 |

### D. Water
| Subcategory | Best observation and technique | SAR | Datasets |
|---|---|---|---|
| Floods | SAR water mapping (all-weather); optical when clear | **P** | D1 GCOV, D3 OPERA DSWx-S1, D29 MODIS/VIIRS flood |
| River course change | Multi-decadal optical water history; SAR for recent | S | D26 JRC GSW, D33, D1 |
| Lakes / reservoirs | Water extent (SAR/optical); level (altimetry) | P/S | D1, D3, D26 |
| Wetland loss | L-band (inundated vegetation, double bounce), optical water history | P (L-band) | D1, D26, D15, D34 Global Mangrove Watch |
| Coastal erosion | Optical shoreline; SAR land/water | S | D26, D33, D1 |
| Dams | Reservoir appearance (GSW transitions); SAR/optical change | S | D26, D33, D1 |

### E. Ecosystems
| Subcategory | Best observation and technique | SAR | Datasets |
|---|---|---|---|
| Habitat loss | Land-cover change (optical ML) plus disturbance alerts | S | D15, D4, D13 |
| Land degradation | NDVI trend, disturbance, soil exposure | N/S | D18, D4 (DIST-ANN) |
| Wetland transformation | L-band inundation, GSW transitions | P/S | D1, D26, D34 |
| Agricultural conversion | Land cover plus disturbance; SAR crop phenology | S | D15, D16, D4, D1 |
| Fragmentation | Derived from forest/land-cover maps (landscape metrics) | N | D13, D15 |

### F. Human activity
| Subcategory | Best observation and technique | SAR | Datasets |
|---|---|---|---|
| Urban expansion | Optical (S2/Landsat) and built-up products; SAR double-bounce brightness | P/S | D30 HBASE, D31 GHSL (no tiles found), D32 EOX annual, D15, D1 |
| Industrial zones | Optical VHR/S2; SAR brightness; night lights | S | D32, D20 VIIRS DNB, D1 |
| Mining / quarries / open pits | Optical pit outline; InSAR coherence and deformation | S/P | D32, D33, D1 GUNW |
| Agricultural expansion / irrigation | Optical NDVI and land cover; SAR soil moisture and phenology | S | D18, D15, D16, D1 |
| Roads / railways / airports / ports | **Optical VHR** (10 m S2 resolves only large works); SAR helps for new hard surfaces and structures | S | D32, D33, D1 |
| Energy (dams, solar, wind) | Optical (solar arrays); SAR bright point targets (turbines, especially offshore); GSW for reservoirs | S | D33, D1, D2, D26 |
| Human land clearing | Disturbance alerts; L-band HV change | P/S | D4, D13, D14, D1 |
| Coastal construction / land reclamation | SAR and optical land/water change; GSW transitions | P/S | D26, D32, D1 |
| Canals / water infrastructure | Optical; GSW | S | D26, D33 |
| Construction (general) | SAR coherence/backscatter time series; optical | P/S | D1, D32 |
| War / conflict physical damage | SAR coherent change detection plus VHR optical; **use only institutional assessments** | S | D36 UNOSAT (institutional), D1, D20 |

## Part 2: Dataset registry

The columns cover browser-direct XYZ/WMTS tiles and the CORS header seen today.

| ID | Dataset | Provider | Mission / sensor | Resolution | Temporal | Licence / attribution | Access | Auth | Browser tiles (CORS) | Chk |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 | NISAR L2 GCOV / GUNW | NASA JPL & ISRO; ASF DAAC | NISAR L-SAR (L-band 24 cm) | per product spec (not re-verified) | BETA subset 2025-10-17..2026-01-20; PROVISIONAL from 2026-06-17 (P05023); VALIDATED from 2026-10-21 (P05036); gap 2026-07-27..08-10 | EOSDIS open. Credit: "NISAR L-band data: NASA/JPL-Caltech & ISRO, distributed by ASF DAAC" | ASF SearchAPI (no auth); HDF5 (Earthdata token); browse PNG (no auth) | Search/browse: no. Data: Earthdata Login | No tile service. Browse PNGs only (pipeline georeferences them). ASF API CORS `*` | ✓A ✓P |
| D2 | OPERA RTC-S1 | NASA JPL OPERA; ASF | Sentinel-1 C-SAR | 30 m | 2025-01-10..present in GIBS | EOSDIS open; contains Copernicus data | GIBS WMTS; ASF | Tiles: no | Yes, GIBS `*` | ✓T |
| D3 | OPERA DSWx-S1 (also DSWx-HLS) | NASA JPL OPERA; PO.DAAC | Sentinel-1 (HLS for -HLS) | 30 m | DSWx-S1 2023-12-15..present | EOSDIS open | GIBS WMTS | No | Yes, `*` | ✓T |
| D4 | OPERA DIST-ALERT / DIST-ANN (HLS) | NASA JPL OPERA; LP DAAC | Landsat 8/9 + Sentinel-2 | 30 m | ALERT 2023-01-01..present; ANN 2023–2025 | EOSDIS open | GIBS WMTS | No | Yes, `*` (intermittent HTTP 500 seen) | ✓T |
| D5 | OPERA DISP-S1 | NASA JPL OPERA; ASF | Sentinel-1 InSAR | — | — | EOSDIS open | ASF | Earthdata | No GIBS 3857 layer found | — |
| D6 | European Ground Motion Service (EGMS) | Copernicus Land Monitoring Service | Sentinel-1 PS-InSAR | — | — | Copernicus (free) | Portal/API | — | — | ✓P |
| D7 | USGS ComCat earthquakes | USGS | Seismic network | point | real time | US public domain | FDSN event API (GeoJSON) | No | n/a (vector), CORS `*` | ✓A |
| D8 | Smithsonian Global Volcanism Program | Smithsonian | catalog | point | Holocene | — | Web | — | — | ✗ (HTTP 403 to our client) |
| D9 | NASA LHASA landslide nowcast / catalog | NASA GSFC | model + GPM rainfall | ~1 km | — | — | gpm.nasa.gov/landslides | — | — | ✓P |
| D10 | NASA FIRMS active fire | NASA LANCE | VIIRS 375 m, MODIS 1 km (thermal IR) | 375 m / 1 km | NRT + archive | EOSDIS open | FIRMS web/API (API key per FIRMS docs, —); GIBS thermal anomalies are **vector (MVT) only** in EPSG:3857 | Key for API (—) | GIBS MVT: our sample request returned 404 (unverified) | ✓P |
| D11 | GOES-East ABI Fire Temperature | NOAA, via GIBS | GOES-East ABI | 2 km | rolling ~4 days, 10-min | Open | GIBS WMTS | No | Yes, `*` | ✓T |
| D12 | VIIRS / MODIS corrected reflectance | NASA LANCE, via GIBS | NOAA-20 VIIRS, Terra MODIS | 250–375 m | 2000/2018..present | EOSDIS open | GIBS WMTS | No | Yes, `*` | ✓T |
| D13 | Global Forest Change v1.13 (2000–2025) | UMD GLAD / Google | Landsat | 30 m | annual loss 2001–2025 | CC BY 4.0. "Source: Hansen/UMD/Google/USGS/NASA" | GCS tiles (viewer path); 10° GeoTIFF download | No | Yes, `*` (path undocumented) | ✓T ✓P |
| D14 | INPE DETER / PRODES | INPE (Brazil) | AMAZONIA-1 WFI, CBERS-4 AWFI (DETER) | ~60 m sensors (—); delivered as polygons | DETER near-daily alerts; PRODES annual | — (licence not checked) | TerraBrasilis GeoServer WFS (GeoJSON) | No | WFS (vector); CORS not checked | ✓A ✓P |
| D15 | ESA WorldCover 2020/2021 | ESA / VITO consortium | Sentinel-1 + Sentinel-2 | 10 m | 2020, 2021 | CC BY 4.0 (from PC collection metadata) | Planetary Computer STAC + tiler; AWS COGs; Terrascope WMTS | No | PC mosaic tiles `*`; Terrascope ✗ (connection reset) | ✓T ✓A |
| D16 | Dynamic World | Google / WRI | Sentinel-2 + ML | 10 m | 2015..NRT | — | Earth Engine | Google account (—) | — | ✓P |
| D17 | MODIS MCD12Q1 IGBP land cover | NASA LP DAAC, via GIBS | Terra+Aqua MODIS | 500 m | annual 2001–2024 | EOSDIS open | GIBS WMTS | No | Yes, `*` | ✓T |
| D18 | MODIS NDVI 16-day (MOD13Q1) | NASA LP DAAC, via GIBS | Terra MODIS | 250 m | 2000..present | EOSDIS open | GIBS WMTS | No | Yes, `*` | ✓T |
| D19 | ITS_LIVE glacier velocity | NASA JPL / NSIDC | Landsat, Sentinel-1/2 (feature tracking) | 120 m mosaics | annual + static mosaics | — (NASA open; exact licence not checked) | S3 COGs `its-live-data.s3.amazonaws.com/velocity_mosaic/v2/{static,annual}/cog/` | No | **No XYZ tile service found**; COG range reads possible: HEAD returned `Access-Control-Allow-Origin: *`. Polar stereo/UTM grids need client reprojection | ✓A ✓P |
| D20 | VIIRS DNB night lights | NASA LANCE Black Marble, via GIBS | NOAA-20 VIIRS DNB | ~500–750 m | 2024-03-25..present | EOSDIS open | GIBS WMTS | No | Yes, `*` | ✓T |
| D21 | GHRSST MUR sea-ice / AMSR2 sea-ice concentration | NASA PO.DAAC / NSIDC, via GIBS | multi-sensor; AMSR2 | 1–12 km | MUR 2002..present; AMSR2 layers in GIBS end 2025-09-01 | EOSDIS open | GIBS WMTS | No | Yes, `*` (MUR) | ✓T |
| D22 | NSIDC Sea Ice Index | NSIDC | passive microwave | 25 km | 1978..present | — | nsidc.org | — | — | ✗ (DNS failure) |
| D23 | GRACE / GRACE-FO mass anomalies | NASA JPL / GFZ | GRACE-FO | ~300 km | GIBS 3857 layer ends 2022-07-01 | EOSDIS open | GIBS; grace.jpl.nasa.gov | No | GIBS layer exists (not tile-tested) | ✓P |
| D24 | ESA CCI Permafrost | ESA CCI | MODIS LST + model | ~1 km | — | — | climate.esa.int | — | — | ✓P |
| D25 | SMAP L4 soil moisture | NASA GMAO / NSIDC, via GIBS | SMAP + model | 9 km | 2015-03-31..present | EOSDIS open | GIBS WMTS | No | Yes, `*` | ✓T |
| D26 | JRC Global Surface Water v1.5 | EC JRC / Google | Landsat | 30 m | 1984–2024 | Copernicus, free of charge, no restriction. "Source: EC JRC/Google". Cite Pekel et al. 2016 | GCS tiles `water-world/tiles2024/{layer}`; downloads | No | Yes, `*` (z ≤ 13) | ✓T ✓P |
| D27 | MODIS LST | NASA LP DAAC, via GIBS | Terra MODIS TIR | 1 km | 2000..present | EOSDIS open | GIBS WMTS | No | Yes, `*` | ✓T |
| D28 | Copernicus DEM GLO-30 | ESA / Copernicus, AWS Open Data | TanDEM-X | 30 m | static | Copernicus DEM licence (—) | AWS S3 COGs | No | No tiles checked | ✓P |
| D29 | MODIS / VIIRS combined flood | NASA LANCE, via GIBS | MODIS Terra+Aqua; VIIRS | 250 m / 375 m | MODIS 2021..present; VIIRS 2025-06-03..present | EOSDIS open | GIBS WMTS | No | Yes, `*` | ✓T |
| D30 | HBASE 2010 built-up; GMIS impervious | NASA SEDAC / CIESIN, via GIBS | Landsat GLS 2010 | 30 m | ~2010 | SEDAC open (—) | GIBS WMTS | No | Yes, `*` | ✓T |
| D31 | GHSL built-up surface (GHS-BUILT-S) | EC JRC (Copernicus EMS) | Landsat / Sentinel-2 | 10 m–1 km | 1975–2030 (5-yr, modelled after 2020) | CC BY 4.0 (per search result; —) | Downloads; AWS S3 (`jrc-ghsl`) | No | **No XYZ/WMTS found**; an EEA ArcGIS LAEA map service exists (not tested) | ✓P |
| D32 | EOX Sentinel-2 cloudless 2016–2025 | EOX IT Services | Sentinel-2 MSI | 10 m | annual | CC BY-NC-SA 4.0 (non-commercial). "Sentinel-2 cloudless – https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data YYYY)" | WMTS/XYZ | No | Yes; CORS echoes the request origin | ✓T ✓P |
| D33 | Sentinel-2 L2A, Landsat C2 L2, Sentinel-1 GRD/RTC | ESA Copernicus / USGS, via Microsoft Planetary Computer | MSI, OLI/OLI-2, C-SAR | 10–30 m | 2015/1982..present | Copernicus free & open; USGS public domain | PC STAC search (anonymous); data API item tiles; asset download needs a PC SAS token (anonymous endpoint, —) | Search/tiles: no | Item tiles: yes, `*` | ✓A ✓T |
| D34 | Global Mangrove Watch | GMW consortium | ALOS PALSAR / Landsat | 25 m | 1996–2020+ | — | Web portal | — | — | ✓P |
| D35 | MapBiomas | MapBiomas network | Landsat + ML | 30 m | 1985..present | — | Portal / GEE | — | — | ✓P |
| D36 | UNOSAT damage assessments | UNITAR-UNOSAT | VHR optical / SAR | site-specific | event-based | per product | unosat.org products | No | n/a | ✓P |
| D37 | Global Forest Watch tiles | WRI | (redistributes UMD/GLAD) | 30 m | — | — | tiles.globalforestwatch.org | No | Returned HTTP 307 redirects (not followed) | ✓P |

## Key URLs opened today (2026-11-14)
- GIBS EPSG:3857 capabilities: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
- GIBS layer metadata: https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/{layer}.json
- GIBS colormaps: https://gibs.earthdata.nasa.gov/colormaps/v1.3/OPERA_Vegetation_Disturbance_Status.xml
- GIBS docs (acknowledgement text): https://nasa-gibs.github.io/gibs-api-docs/
- Hansen GFC v1.13: https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/download.html
- JRC GSW: https://global-surface-water.appspot.com/download
- EOX licence: https://cloudless.eox.at/documentation/license and WMTS capabilities https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml
- Planetary Computer: https://planetarycomputer.microsoft.com/api/stac/v1/collections/esa-worldcover and https://planetarycomputer.microsoft.com/api/data/v1/mosaic/info?collection=esa-worldcover
- ITS_LIVE: https://its-live.jpl.nasa.gov/ and the S3 listing https://its-live-data.s3.amazonaws.com/?list-type=2&prefix=velocity_mosaic/v2/
- NISAR availability: https://nisar-docs.asf.alaska.edu/availability-overview/
- ASF SearchAPI: https://api.daac.asf.alaska.edu/services/search/param
- NASA EONET: https://eonet.gsfc.nasa.gov/api/v3/events
- INPE TerraBrasilis WFS: https://terrabrasilis.dpi.inpe.br/geoserver/deter-amz/ows
- Status-only checks (HTTP 200): earthquake.usgs.gov/fdsnws/event/1/, earthdata.nasa.gov OPERA page, registry.opendata.aws (its-live-data, ghs-built-s, esa-worldcover, copernicus-dem), egms.land.copernicus.eu, gpm.nasa.gov/landslides, unosat.org/products, globalmangrovewatch.org, dynamicworld.app, firms.modaps.eosdis.nasa.gov (+/api), human-settlement.emergency.copernicus.eu, grace.jpl.nasa.gov, climate.esa.int permafrost, mapbiomas.org, glad.umd.edu/dataset, CMR C2777436413-ASF.

## Practical notes for the app
- **GIBS:**
  - Use the `epsg3857/best` REST path. The order is `{z}/{y}/{x}` (TileMatrix/TileRow/TileCol).
  - The TileMatrixSet name fixes the max zoom (`GoogleMapsCompatible_LevelN` → maxzoom N).
  - Out-of-range dates return 404 (tested). Use the time ranges in GetCapabilities and retry on 500.
  - Acknowledgement: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)."
- **Active fire:** GIBS serves VIIRS/MODIS thermal anomalies in EPSG:3857 only as Mapbox Vector Tiles (`application/vnd.mapbox-vector-tile`). Our sample MVT request returned 404, so the URL pattern is unverified. FIRMS is the authoritative fire product.
- **Unreachable from this corporate network** (behaviour from an end-user browser unknown): ESA Terrascope WMTS (connection reset), nsidc.org and esa-worldcover.org (DNS). DNS was intermittently flaky for several hosts, so we added retries.
