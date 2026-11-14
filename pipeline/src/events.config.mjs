// Curated demo events. Every granule listed here was confirmed to exist in the
// ASF DAAC NISAR archive on 2026-11-14 (ASF SearchAPI, dataset=NISAR).
// Event facts (time, location, magnitude) come from the cited agency pages.

const gcov = (role, granule) => ({ role, product: 'GCOV', granule });

export const EVENTS = [
  {
    id: 'venezuela-2026',
    title: 'Venezuela earthquakes',
    subtitle: 'M7.5 and M7.2, north-central Venezuela',
    category: 'earthquake',
    date: '2026-06-24T22:04:00Z',
    // USGS epicentres (M7.5 and M7.2)
    location: { lon: -67.2205, lat: 10.5955 },
    extra_points: [{ label: 'M7.2 epicentre', lon: -68.5564, lat: 10.3713 }],
    technique: 'insar',
    references: [
      { label: 'NASA Earth Observatory: Where Venezuela’s earthquakes shifted the ground', url: 'https://science.nasa.gov/earth/earth-observatory/where-venezuelas-earthquakes-shifted-the-ground/' },
      { label: 'UCSD / JPL line-of-sight displacement grids', url: 'https://topex.ucsd.edu/VNZ_7.5/index.html' },
      { label: 'USGS earthquake catalog', url: 'https://earthquake.usgs.gov/earthquakes/search/' },
    ],
    // InSAR before/after = an interferogram that does NOT span the quake vs one that does,
    // on the same track and geometry (track 162, ascending, frame 007).
    observations: [
      { role: 'before', product: 'GUNW', granule: 'NISAR_L2_PR_GUNW_021_162_A_007_022_4000_SH_20260601T100657_20260601T100731_20260613T100656_20260613T100731_P05023_N_F_J_001' },
      { role: 'after', product: 'GUNW', granule: 'NISAR_L2_PR_GUNW_022_162_A_007_023_4000_SH_20260613T100656_20260613T100731_20260625T100655_20260625T100730_P05023_N_F_J_001' },
    ],
  },
  {
    id: 'mozambique-floods-2026',
    title: 'Limpopo and Incomati floods',
    subtitle: 'Southern Mozambique',
    category: 'flood',
    date: '2026-01-12T00:00:00Z',
    date_precision: 'month',
    location: { lon: 33.0, lat: -24.55 },
    technique: 'backscatter',
    references: [
      { label: 'NASA SVS 5661: NISAR views Mozambique floods', url: 'https://svs.gsfc.nasa.gov/5661' },
    ],
    observations: [
      { role: 'timeline', product: 'GCOV', granule: 'NISAR_L2_PR_GCOV_008_114_A_165_4005_DHDH_A_20251224T034231_20251224T034253_X05010_N_P_J_001' },
      { role: 'before', product: 'GCOV', granule: 'NISAR_L2_PR_GCOV_009_114_A_165_4005_DHDH_A_20260105T034232_20260105T034253_X05010_N_P_J_001' },
      { role: 'after', product: 'GCOV', granule: 'NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001' },
    ],
  },
  {
    id: 'krasheninnikov-2026',
    title: 'Krasheninnikov volcano',
    subtitle: 'Kronotsky Reserve, Kamchatka, Russia',
    category: 'volcano',
    date: '2025-08-02T00:00:00Z', // eruption onset per Smithsonian GVP (local reports: 3 Aug)
    date_precision: 'day',
    location: { lon: 160.273, lat: 54.593 }, // summit, GVP volcano 300190 (via Wikipedia citation)
    technique: 'timeseries',
    crop_km: 40,
    references: [
      { label: 'NASA SVS 5675: NISAR time-lapse of Krasheninnikov', url: 'https://svs.gsfc.nasa.gov/5675' },
      { label: 'JPL: US-India satellite captures time-lapse of volcanic eruption', url: 'https://www.jpl.nasa.gov/news/us-india-satellite-captures-time-lapse-video-of-volcanic-eruption/' },
    ],
    // One track/frame (060 descending, frame 061) so geometry is identical between dates.
    observations: [
      '20260618T084927_20260618T085005_P05023_N_F_J_001|023',
      '20260630T084926_20260630T085005_P05023_N_F_J_001|024',
      '20260712T084929_20260712T085004_P05023_N_F_J_001|025',
      '20260724T084925_20260724T085003_P05023_N_F_J_001|026',
      '20260817T084924_20260817T085002_P05023_N_F_J_001|028',
      '20260829T084924_20260829T085002_P05023_N_F_J_001|029',
      '20260910T084923_20260910T085002_P05023_N_F_J_001|030',
      '20260922T084923_20260922T085002_P05023_N_F_J_001|031',
      '20261004T084924_20261004T085002_P05023_N_F_J_001|032',
      '20261016T084924_20261016T085002_P05023_N_F_J_001|033',
      '20261028T084924_20261028T085002_P05036_N_F_J_001|034',
    ].map((s, i, all) => {
      const [tail, cycle] = s.split('|');
      return {
        role: i === 0 ? 'before' : i === all.length - 1 ? 'after' : 'timeline',
        product: 'GCOV',
        granule: `NISAR_L2_PR_GCOV_${cycle}_060_D_061_4005_DHDH_A_${tail}`,
      };
    }),
  },
  {
    id: 'uniao-do-sul-deforestation-2026',
    title: 'Amazon clear-cut, União do Sul',
    subtitle: 'Mato Grosso, Brazil · INPE DETER alert',
    category: 'deforestation',
    date: '2026-10-14T00:00:00Z', // DETER view_date (detection), clearing between 26 Sep and 14 Oct per Sentinel-2
    date_precision: 'detection',
    location: { lon: -54.0364, lat: -11.3613 },
    technique: 'backscatter',
    crop_km: 30,
    references: [
      { label: 'INPE DETER (TerraBrasilis), alert deter_amz.41873_curr', url: 'https://terrabrasilis.dpi.inpe.br/en/home-page/' },
    ],
    observations: [
      gcov('timeline', 'NISAR_L2_PR_GCOV_031_002_A_172_2005_DHDH_A_20260918T091907_20260918T091941_P05023_F_F_J_001'),
      gcov('before', 'NISAR_L2_PR_GCOV_032_002_A_172_2005_DHDH_A_20260930T091907_20260930T091941_P05023_N_F_J_001'),
      gcov('timeline', 'NISAR_L2_PR_GCOV_033_002_A_172_2005_DHDH_A_20261012T091907_20261012T091941_P05023_N_F_J_001'),
      gcov('after', 'NISAR_L2_PR_GCOV_034_002_A_172_2005_DHDH_A_20261024T091907_20261024T091942_P05036_N_F_J_001'),
    ],
  },
  {
    id: 'aspen-acres-fire-2026',
    title: 'Aspen Acres wildfire',
    subtitle: 'Custer County, Colorado, USA',
    category: 'wildfire',
    date: '2026-06-29T10:21:00Z', // NASA EONET / IRWIN record date
    location: { lon: -105.0713, lat: 38.0193 },
    technique: 'backscatter',
    crop_km: 50,
    references: [
      { label: 'NASA EONET event EONET_21019 (IRWIN 2026-COCUX-001160)', url: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_21019' },
    ],
    observations: [
      gcov('timeline', 'NISAR_L2_PR_GCOV_023_019_A_021_4005_DHDH_A_20260615T121118_20260615T121152_P05023_N_F_J_001'),
      gcov('before', 'NISAR_L2_PR_GCOV_024_019_A_021_4005_DHDH_A_20260627T121117_20260627T121152_P05023_N_F_J_001'),
      gcov('timeline', 'NISAR_L2_PR_GCOV_025_019_A_021_4005_DHDH_A_20260709T121116_20260709T121151_P05023_N_F_J_001'),
      gcov('after', 'NISAR_L2_PR_GCOV_028_019_A_021_4005_DHDH_A_20260814T121114_20260814T121149_P05023_N_F_J_001'),
    ],
  },
];
