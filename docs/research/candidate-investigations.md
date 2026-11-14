# Candidate investigations (proposed, 14 Nov 2026)

These are eight new cases to add next to Venezuela (GUNW), Limpopo (GCOV) and Krasheninnikov (GCOV time series). Every granule and item ID below came from a live query on 2026-11-14:
- NISAR: the ASF SearchAPI, `dataset=NISAR&processingLevel=GCOV,GUNW&intersectsWith=POINT(lon lat)`.
- Sentinel-2 / Landsat: Microsoft Planetary Computer STAC `/search`, anonymous.

We did no NISAR processing yet. "Expected signal" says what the method should show; it is **not** a result.

**Tier note (verified today).** ASF returns PROVISIONAL granules (`NISAR_L2_*_PROVISIONAL_V1`, CRID `P05023`) acquired before the documented PROVISIONAL window of 2026-06-17..~10-23, at several sites:
- 2025-10-30 onward: Mexico City, Colorado.
- 2025-11 onward: Escondida, Hayli Gubbi.

Any tier badge must therefore come from `collectionName`, as `tierOf()` already does, not from the acquisition date. VALIDATED (`NISAR_L2_*_V1`, CRID `P05036`) appears from 2026-10-21.

The ASF availability page confirms the permanent data gap 2026-07-27T22:03Z to 2026-08-10T00:55Z. It also says BETA and PROVISIONAL use different CRIDs, so mixing them "may introduce processing-related differences". Prefer pairs with the same CRID.

## Ranking (feasibility × scientific clarity)

| # | Case | Category | NISAR technique | Why this rank |
|---|------|----------|-----------------|---------------|
| 1 | União do Sul (MT, Brazil) clear-cut, Sep–Oct 2026 | Deforestation | GCOV HV/HH change, same CRID | Change confirmed in Sentinel-2 (visual + NDVI) and by INPE DETER; dual-pol NISAR on both sides; cloudy season shows SAR's value |
| 2 | Aspen Acres fire (Colorado), late Jun 2026 | Wildfire / burned area | GCOV HV drop + GUNW coherence loss | Continuous 12-day PROVISIONAL series; pre-fire acquisition 2 days before; OPERA DIST-ALERT confirms a large loss patch |
| 3 | Hayli Gubbi eruption (Ethiopia), 23 Nov 2025 | Volcano (geohazard) | GUNW pre-event vs co-eruptive pair (same recipe as Venezuela) + GCOV | NASA EO and COMET document it; ascending and descending pairs bracket the eruption; Sentinel-2 imaged it 35 min before onset |
| 4 | Mexico City subsidence | Subsidence | GUNW 12-day stack (28 pairs on one track) | Among the fastest urban subsidence on Earth (peer-reviewed); a large, unambiguous InSAR signal |
| 5 | GERD reservoir (Ethiopia), 2026 rainy season | Water / dam / reservoir | GCOV water mask, June vs October | Strong water/land contrast; NASA EO context; same-CRID series |
| 6 | Egypt's New Administrative Capital | Human activity: urban expansion | GCOV backscatter (double bounce) + optical history | NASA EO 2017→2024 documents growth; NISAR shows current built-up state, and the optical archive shows the change |
| 7 | Escondida copper mine (Chile) | Human activity: open-pit mining | GUNW coherence/deformation + GCOV, 1-year same-CRID pair | NASA SVS 1985–2026 time series; a year-long PROVISIONAL record; the expected signal is less intuitive for a general audience |
| 8 | Alsek Glacier / Prow Knob (Alaska) | Climate: glacier retreat | GCOV ice / water / rock boundary, same-season pair | NASA EO documents the 2025 separation; one-year NISAR baseline mixes BETA and PROVISIONAL (calibration caveat) |

No war/conflict case is proposed: we did not verify an institutional assessment (UNOSAT/UN/peer-reviewed) overlapping NISAR data in this session.

---

## 1. União do Sul (Mato Grosso, Brazil): forest clear-cut, Sep–Oct 2026

- **Location:** -11.3613, -54.0364 (centre of INPE DETER polygon `deter_amz.41873_curr`, bbox lat -11.3797..-11.3429, lon -54.0553..-54.0175).
- **Dates:** clearing between 2026-09-26 and 2026-10-14 (from Sentinel-2, below). DETER `view_date` is 2026-10-14.
- **Why it matters:** this was the largest single DETER clear-cut (`DESMATAMENTO_CR`) polygon we found for 2026-06-20..10-31 in Legal Amazon, at 6.2 km². It falls at the start of the wet season, when optical monitoring degrades, which is exactly where L-band SAR adds value.
- **Method:** NISAR GCOV dual-pol. Forest removal lowers HV (volume scattering) strongly and HH moderately. Compute HV log-ratio (post/pre) and threshold, masked by the DETER polygon for validation.
- **NISAR (ASF), track 002 ascending, frame 172, all DHDH:**
  - Pre: `NISAR_L2_PR_GCOV_031_002_A_172_2005_DHDH_A_20260918T091907_20260918T091941_P05023_F_F_J_001` (PROVISIONAL).
  - Pre, closest: `NISAR_L2_PR_GCOV_032_002_A_172_2005_DHDH_A_20260930T091907_20260930T091941_P05023_N_F_J_001` (PROVISIONAL; S2 shows the forest intact on 09-26).
  - Post, same CRID: `NISAR_L2_PR_GCOV_033_002_A_172_2005_DHDH_A_20261012T091907_20261012T091941_P05023_N_F_J_001` (PROVISIONAL; may be partially cleared).
  - Post: `NISAR_L2_PR_GCOV_034_002_A_172_2005_DHDH_A_20261024T091907_20261024T091942_P05036_N_F_J_001` (VALIDATED; CRID differs from pre).
- **NISAR, track 010 descending, frame 094:**
  - `..._031_010_D_094_2005_DHDH_A_20260918T215345..._P05023_F_F_J_001` (PROVISIONAL).
  - `..._035_010_D_094_2005_DHDH_A_20261105T215346..._P05036_N_F_J_001` (VALIDATED).
  - Note: alternate dates on this track are single-pol `SHSH` (HH only).
- **Sentinel-2 L2A (PC STAC), tile T21LZH:**
  - `S2A_MSIL2A_20260926T135121_R024_T21LZH_20260926T195521` (cc 2.6 %): pre.
  - `S2C_MSIL2A_20261014T134711_R024_T21LZH_20261014T170711` (cc 10.9 %).
  - `S2C_MSIL2A_20261024T134701_R024_T21LZH_20261024T170016` (cc 2.0 %): post.
- **Our verification:**
  - A PC item tile at z13 shows closed forest on 09-26 and bare, brown cleared ground on 10-24 (partly cloudy).
  - Point samples via the PC `/item/point` API (B04/B08, with the -1000 BOA offset applied, assuming processing baseline ≥04.00): NDVI at (-54.045, -11.370) fell from 0.72 to 0.12, and at (-54.030, -11.355) from 0.75 to 0.22, between 09-26 and 10-14. The polygon centre stayed at 0.54–0.60, so clearing was partial there.
- **References:**
  - INPE DETER via TerraBrasilis WFS, queried 2026-11-14: `https://terrabrasilis.dpi.inpe.br/geoserver/deter-amz/ows` (layer `deter-amz:deter_amz`, feature `deter_amz.41873_curr`, AMAZONIA-1 WFI).
  - TerraBrasilis portal: https://terrabrasilis.dpi.inpe.br/en/home-page/

## 2. Aspen Acres wildfire (Custer County, Colorado), June 2026

- **Location:** 38.0193, -105.0713 (EONET point, "20 Miles SW from Pueblo, CO").
- **Dates:** EONET/IRWIN date 2026-06-29T10:21Z. Size 91,982 acres per IRWIN, via EONET. The exact ignition time is unverified.
- **Why it matters:** one of the ten largest fires in EONET's 17 Jun–Sep 2026 IRWIN list. The vegetation type is not verified from a fire agency, but OPERA DIST-ALERT shows widespread "≥50 % vegetation loss", which indicates woody cover. There, L-band HV and coherence respond strongly to canopy loss.
- **Method:**
  - GCOV HV/HH log-ratio between pre and post dates. Burned canopy lowers HV.
  - GUNW coherence: a 06-27→07-09 pair spanning the fire versus an earlier 12-day pair.
  - Validate against Sentinel-2 dNBR and OPERA DIST-ALERT.
- **NISAR (ASF), track 019 ascending, frame 021.** All DHDH PROVISIONAL `P05023`; the series runs every 12 days from 2025-10-30 to VALIDATED 2026-11-06.
  - Pre: `NISAR_L2_PR_GCOV_024_019_A_021_4005_DHDH_A_20260627T121117_20260627T121152_P05023_N_F_J_001`
  - Earlier pre: `NISAR_L2_PR_GCOV_023_019_A_021_4005_DHDH_A_20260615T121118_20260615T121152_P05023_N_F_J_001`
  - Post: `NISAR_L2_PR_GCOV_025_019_A_021_4005_DHDH_A_20260709T121116_20260709T121151_P05023_N_F_J_001`
  - Post: `NISAR_L2_PR_GCOV_028_019_A_021_4005_DHDH_A_20260814T121114_20260814T121149_P05023_N_F_J_001`
  - Also: track 027 descending frame 069 (06-28 → 07-10, PROVISIONAL), and GUNW on track 019 frame 021 (33 granules).
- **Sentinel-2 L2A, tile T13SDC:**
  - `S2B_MSIL2A_20260616T173859_R098_T13SDC_20260616T212324` (cc 0.00 %): pre.
  - `S2B_MSIL2A_20260805T173859_R098_T13SDC_20260805T212217` (cc 0.06 %): post.
- **Our verification:** OPERA DIST-ALERT-HLS (GIBS), 3×3 tiles at z11 around the point. Pixels classed "confirmed ≥50 % vegetation loss" (including "finished") went from 173 on 2026-06-25 to about 31,700 on 2026-09-15. Only 6 of 9 tiles loaded; 3 returned HTTP 500. This is indicative, not an area estimate.
- **References:**
  - NASA EONET event `EONET_21019`: https://eonet.gsfc.nasa.gov/api/v3/events/EONET_21019 (opened).
  - IRWIN record: https://irwin.doi.gov/observer/incidents/2026-COCUX-001160 (listed by EONET; not opened).

## 3. Hayli Gubbi eruption (Afar, Ethiopia), 23 November 2025

- **Location:** 13.5110, 40.7163 (OSM volcano node).
- **Dates:** eruption onset about 08:30 UTC on 2025-11-23; it subsided by 11-25 (NASA EO).
- **Why it matters:** the volcano's first documented explosive eruption. The NASA EO article cites InSAR and COMET reports of several centimetres of uplift from late July 2025, linked to a magma intrusion from Erta Ale. Co-eruptive deformation and new craters are a natural SAR story.
- **Method:** the same recipe as Venezuela.
  - GUNW pre-event noise pair versus co-eruptive pair, ascending and descending.
  - GCOV change for crater enlargement and ash or tephra deposits.
- **NISAR GUNW (PROVISIONAL, P05023), track 172 ascending, frame 008:**
  - Pre-event: `NISAR_L2_PR_GUNW_004_172_A_008_005_2000_SH_20251110T024617_20251110T024652_20251122T024618_20251122T024652_P05023_N_F_J_001`
  - Co-eruptive (11-22 02:46Z → 12-04): `NISAR_L2_PR_GUNW_005_172_A_008_006_2000_SH_20251122T024618_20251122T024652_20251204T024618_20251204T024653_P05023_N_F_J_001`
- **NISAR GUNW, track 165 descending, frame 082:**
  - Pre-event: `NISAR_L2_PR_GUNW_004_165_D_082_005_2000_SH_20251109T154910_20251109T154944_20251121T154910_20251121T154944_P05023_N_F_J_001`
  - Co-eruptive: `NISAR_L2_PR_GUNW_005_165_D_082_006_2000_SH_20251121T154910_20251121T154944_20251203T154910_20251203T154945_P05023_N_F_J_001`
  - BETA duplicates (X05007/X05009/X05010) also exist. Prefer P05023.
- **NISAR GCOV (DHDH, PROVISIONAL):**
  - `NISAR_L2_PR_GCOV_005_172_A_008_2005_DHDH_A_20251122T024618_20251122T024652_P05023_N_F_J_001`
  - `NISAR_L2_PR_GCOV_006_172_A_008_2005_DHDH_A_20251204T024618_20251204T024653_P05023_N_F_J_001`
- **Sentinel-2 L2A, tiles T37PFQ / T37PFR:**
  - Pre: `S2C_MSIL2A_20251123T075541_R092_T37PFQ_20251123T110315` (cc 0.004 %; sensed 07:55 UTC, about 35 min **before** onset).
  - Post: `S2A_MSIL2A_20251125T075451_R092_T37PFQ_20251125T100816` (cc 0.002 %).
  - Post: `S2C_MSIL2A_20251203T074311_R092_T37PFQ_20251203T113611` (cc 0.003 %).
- **References:**
  - NASA Earth Observatory, "Hayli Gubbi's Explosive First Impression" (4 Dec 2025): https://science.nasa.gov/earth/earth-observatory/hayli-gubbis-explosive-first-impression/ (opened).

## 4. Mexico City land subsidence (continuous)

- **Location:** 19.43, -99.03 (eastern basin, former Lake Texcoco area).
- **Dates:** a continuous record from 2025-10-30 to 2026-10-13 (GUNW) and to 2026-11-06 (GCOV VALIDATED).
- **Why it matters:** aquitard compaction from groundwater extraction. Chaussard et al. (2021, JGR Solid Earth, doi:10.1029/2020JB020648) report rates of up to about 50 cm/yr and nearly irreversible compaction. Damage to buildings, the metro and drainage follows.
- **Method:**
  - Sum or SBAS-invert the 12-day GUNW unwrapped phase into a cumulative line-of-sight time series.
  - Convert to vertical using ascending and descending tracks, assuming negligible horizontal motion. State this assumption.
  - Expected rate: tens of cm/yr. This is not yet computed.
- **NISAR GUNW (PROVISIONAL, P05023), track 019 ascending, frame 011:** 28 consecutive 12-day pairs.
  - First: `NISAR_L2_PR_GUNW_004_019_A_011_005_4000_SH_20251030T120539_20251030T120613_20251111T120539_20251111T120614_P05023_N_F_J_001`
  - Last: `NISAR_L2_PR_GUNW_032_019_A_011_033_4000_SH_20261001T120538_20261001T120612_20261013T120538_20261013T120612_P05023_N_F_J_001`
  - The series breaks across the 07-27..08-10 gap.
- **Descending:** track 113 frame 079 (33 GUNW, 36 GCOV).
- **References:**
  - Chaussard et al. 2021, doi:10.1029/2020JB020648. Found via search and the Eos research spotlight https://eos.org/research-spotlights/the-looming-crisis-of-sinking-ground-in-mexico-city. The paper itself was not opened, so rates are as summarized.

## 5. Grand Ethiopian Renaissance Dam reservoir, 2026 rainy season

- **Location:** dam at 11.2144, 35.0925 (OSM). Reservoir sample point 10.85, 35.15.
- **Dates:** 2026-06-23 (pre-rains) to 2026-10-21 (post-rains).
- **Why it matters:** Africa's largest hydropower reservoir. NASA EO notes downstream sensitivity to filling rate, and CIRA reports the dam's inauguration in Sept 2025. Seasonal storage swings change the shoreline across the flooded Blue Nile valley.
- **Method:**
  - GCOV HH/HV water classification (the existing Limpopo histogram-valley recipe) on each 12-day date.
  - Plot water area over time.
  - Validate against Sentinel-2 NDWI and the JRC GSW occurrence layer.
- **NISAR GCOV (DHDH, PROVISIONAL P05023), track 129 ascending, frame 007:** 10 dates.
  - First: `NISAR_L2_PR_GCOV_023_129_A_007_2005_DHDH_A_20260623T031045_20260623T031119_P05023_N_F_J_001`
  - Then: 07-05, 07-17, 08-10, 08-22, 09-03, 09-15, 09-27.
  - `NISAR_L2_PR_GCOV_032_129_A_007_2005_DHDH_A_20261009T031041_20261009T031115_P05023_N_F_J_001`
  - Last: `NISAR_L2_PR_GCOV_033_129_A_007_2005_DHDH_A_20261021T031041_20261021T031116_P05023_N_F_J_001`
- **Also available:**
  - Track 021 descending frame 083: BETA 2025-10-30..2026-01-10, PROVISIONAL 2026-06-27..10-01, VALIDATED 2026-10-25 and 11-06.
  - GUNW on both tracks.
- **Sentinel-2 L2A, tile T36PYT:**
  - Pre-rains: `S2A_MSIL2A_20260430T080021_R035_T36PYT_20260430T134617` (cc 0.003 %).
  - Pre-rains: `S2B_MSIL2A_20260612T075609_R035_T36PYT_20260612T102815` (cc 0.58 %).
  - Post: `S2B_MSIL2A_20261020T075939_R035_T36PYT_20261020T115745` (cc 1.1 %).
  - Post: `S2C_MSIL2A_20261104T080111_R035_T36PYT_20261104T113108` (cc 0.01 %).
- **Caveat:** the amount of 2026 storage change is not verified. We only know the data exist. Wind roughening of the reservoir surface can raise backscatter and break the water threshold.
- **References:**
  - NASA EO, "Keeping a Satellite Eye on GERD" (20 Apr 2022): https://science.nasa.gov/earth/earth-observatory/keeping-a-satellite-eye-on-gerd-149699/ (opened).
  - NASA EO, "A Grand New Dam on the Nile": https://science.nasa.gov/earth/earth-observatory/a-grand-new-dam-on-the-nile-149691/ (search result, not opened).
  - CIRA: https://satlib.cira.colostate.edu/weather_media/reservoir-filling-behind-the-grand-ethiopian-renaissance-dam (search result, not opened).

## 6. Egypt's New Administrative Capital: urban expansion

- **Location:** 30.0127, 31.6938 (Iconic Tower, OSM), about 45 km east of Cairo.
- **Dates:** optical record 2017 → 2026. NISAR 2026-06-23 → 2026-10-21 (PROVISIONAL), plus BETA 2025-11-12 → 2026-01-11 on track 028.
- **Why it matters:** a desert megaproject (announced 2015). NASA EO compares Landsat images from 14 Aug 2017 and 9 Aug 2024.
- **Method:**
  - Long-term change from optical: EOX annual mosaics 2017→2025 (`eox-s2cloudless-annual` layer) and Sentinel-2 2017 versus 2026.
  - NISAR: buildings give strong HH double-bounce over dark desert sand, so a GCOV HH/HV composite maps today's built-up extent. A June-to-October ratio can flag new structures; months of construction may give only small changes.
  - Over desert, coherence (GUNW) is high and drops where construction is active.
- **NISAR GCOV (DHDH, PROVISIONAL), track 129 ascending, frame 017:**
  - `NISAR_L2_PR_GCOV_023_129_A_017_4005_DHDH_A_20260623T031620_20260623T031651_P05023_N_F_J_001`
  - `NISAR_L2_PR_GCOV_033_129_A_017_4005_DHDH_A_20261021T031616_20261021T031649_P05023_N_F_J_001`
  - Also: track 079 descending frame 073 (06-19..VALIDATED 10-29) and track 007 descending frame 073.
- **Sentinel-2 L2A, tile T36RUU:**
  - `S2B_MSIL2A_20170827T083009_R021_T36RUU_20210201T124146` (cc 0.17 %).
  - `S2A_MSIL2A_20251021T083021_R021_T36RUU_20251021T121521` (cc 0.02 %).
  - `S2A_MSIL2A_20260916T083521_R021_T36RUU_20260916T132413` (cc 0.003 %).
- **Our verification:** EOX `s2cloudless-2017_3857` versus `s2cloudless-2025_3857` z15 tiles at the tower show bare desert in 2017 and dense blocks plus the tower's shadow in 2025.
- **References:**
  - NASA EO, "Constructing Egypt's New Capital" (24 Aug 2024): https://science.nasa.gov/earth/earth-observatory/constructing-egypts-new-capital-153237/ (opened).
  - NASA EO, "New Ground for an Ancient City" (2020): https://earthobservatory.nasa.gov/images/146521/new-ground-for-an-ancient-city (search result).

## 7. Escondida copper mine (Atacama, Chile): open-pit mining

- **Location:** -24.27, -69.07. OSM gives "Mina Escondida" at -24.333, -69.084 and pit "Rajo Escondida Norte" at -24.215, -69.050.
- **Dates:** NISAR 2025-11-01 → 2026-10-15, the same track and the same CRID (P05023) a year apart. The optical archive runs 1985 → 2026.
- **Why it matters:** NASA SVS (published 30 Aug 2026) calls it the highest-producing copper mine in the world, with "massive expansion" since the late 1980s. Pits, waste dumps and tailings change continuously.
- **Method:**
  - GCOV one-year difference for new dumps and benches.
  - GUNW coherence: active excavation and dumping decorrelate within 12 days, while the stable hyper-arid surroundings stay coherent.
  - GUNW LOS displacement on dumps and pit walls (settlement, slope movement).
  - Optical: Landsat/Sentinel-2 for pit outline growth.
- **NISAR (track 046 ascending, frame 165):**
  - `NISAR_L2_PR_GCOV_004_046_A_165_2005_DHDH_A_20251101T103008_20251101T103042_P05023_N_F_J_001`
  - `NISAR_L2_PR_GCOV_033_046_A_165_2005_DHDH_A_20261015T103007_20261015T103041_P05023_N_F_J_001`
  - GUNW example: `NISAR_L2_PR_GUNW_032_046_A_165_033_2000_SH_20261003T103007_20261003T103041_20261015T103007_20261015T103041_P05023_N_F_J_001`
  - 26 GUNW on this track, plus track 097 descending frame 101 (29 GCOV, 25 GUNW).
- **Sentinel-2 L2A, tile T19KDP:**
  - `S2A_MSIL2A_20251026T143801_R096_T19KDP_20251026T213603` (cc 0.04 %).
  - `S2B_MSIL2A_20261103T143749_R096_T19KDP_20261103T165520` (cc 0.08 %).
- **Caveat:** the magnitude of 2025→2026 change is unverified. One year may show only modest pit growth; coherence and deformation are the stronger NISAR story.
- **References:**
  - NASA SVS 15086, "Growth of the Escondida Mine, Chile": https://svs.gsfc.nasa.gov/15086/ (opened; credit NASA's Goddard Space Flight Center).

## 8. Alsek Glacier and Prow Knob (Alaska): glacier retreat

- **Location:** Prow Knob 59.1953, -138.0670 (OSM now tags it as an island). Alsek Lake 59.1787, -138.1103.
- **Dates:** separation between 13 Jul and 6 Aug 2025 (NASA EO). NISAR from 2025-10-24 (BETA) to 2026-10-19 (PROVISIONAL), same track and same season.
- **Why it matters:** both arms of Alsek Glacier have retreated more than 5 km since 1984, and Alsek Lake grew from 45 to 75 km² (NASA EO, citing M. Pelto). This is a vivid, documented climate signal.
- **Method:**
  - GCOV HH/HV classifies glacier ice, lake water and icebergs, and rock.
  - Digitize the terminus on same-season dates a year apart and measure frontal change.
  - Velocity context from ITS_LIVE (COGs on S3; no tile service).
- **NISAR GCOV, track 101 descending, frame 058:**
  - BETA: `NISAR_L2_PR_GCOV_003_101_D_058_4005_DHDH_A_20251024T050258_20251024T050337_X05009_N_F_J_001`
  - PROVISIONAL: `NISAR_L2_PR_GCOV_033_101_D_058_4005_DHDH_A_20261019T050258_20261019T050337_P05023_N_F_J_001`
  - The 2026 series runs 06-21..10-19 and is all P05023, for intra-season comparison.
  - Six other tracks cover the site (e.g. 063A/032, 135A/032, 164A/031, 173D/058, 072D/059 with VALIDATED 2026-10-29).
- **Optical:**
  - Landsat `LC09_L2SP_061018_20250806_02_T1` (cc 13.6 %): the 6 Aug 2025 date NASA EO used.
  - Sentinel-2 `S2C_MSIL2A_20250806T202901_R114_T08VLL_20250806T233814` (cc 10.7 %).
  - Sentinel-2 `S2B_MSIL2A_20260730T203839_R014_T07VFF_20260730T225253` (cc 0.6 %).
- **Caveats:**
  - The year-apart pair mixes BETA and PROVISIONAL CRIDs, so use geometry (terminus position), not radiometric differences.
  - Wet snow and ice in summer lower backscatter contrast; October pairs are preferable.
  - The 2025→2026 retreat distance is unverified.
- **References:**
  - NASA EO, "Alaska's Brand New Island" (8 Sep 2025): https://science.nasa.gov/earth/earth-observatory/alaskas-brand-new-island-154764 (opened).

---

### Considered but not proposed
- Large 2026 rangeland fires: BIG GRASS, OR, 280,000 acres; ROWE CREEK COMPLEX, OR. NISAR coverage and Urgent Response GCOV exist, e.g. `NISAR_UR` on track 042 2026-07-11/07-23 near BIG GRASS. DIST-ALERT shows mostly "<50 % loss" there, and sagebrush/grass burns give weaker, less intuitive L-band contrast than forest. They are a good second-tier wildfire case.
- Weda Bay nickel (Halmahera): only NGO and press sources found; no agency reference verified.
- Iceberg A-83 calving (NASA EO 152848, listed in context.json): not checked for NISAR coverage.

### Reproduce
- ASF: `https://api.daac.asf.alaska.edu/services/search/param?dataset=NISAR&processingLevel=GCOV,GUNW&intersectsWith=POINT(<lon>%20<lat>)&output=geojson&maxResults=1000`
- PC STAC: `POST https://planetarycomputer.microsoft.com/api/stac/v1/search` with `{"collections":["sentinel-2-l2a"],"intersects":{"type":"Point","coordinates":[lon,lat]},"datetime":"<start>/<end>","query":{"eo:cloud_cover":{"lt":N}}}`
- PC item tiles (anonymous, CORS `*` verified): `https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=sentinel-2-l2a&item=<ID>&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&format=png`
