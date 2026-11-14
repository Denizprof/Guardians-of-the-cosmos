// Authored explanations. Every event-specific statement here describes what is
// visible in the actual NISAR scenes shipped with the app, and is hedged where
// the browse imagery alone cannot prove it. Keep claims tied to sources.

export interface Pin {
  id: string;
  lon: number;
  lat: number;
  label: string;
  simple: string;
  scientific: string;
}

export interface EventContent {
  happened: { text: string; source: string; url: string };
  readSimple: string[];
  readScientific: string[];
  legend: { swatch: string; label: string }[];
  pins: Pin[];
  caveats: string[];
}

export interface Concept {
  id: string;
  title: string;
  simple: string;
  scientific: string;
}

export const CONCEPTS: Concept[] = [
  {
    id: 'sar',
    title: 'What is synthetic aperture radar?',
    simple:
      'A radar satellite sends its own microwave pulses to the ground and records the echoes. Because it brings its own "light", it sees at night and straight through clouds and smoke.',
    scientific:
      'SAR synthesizes a long antenna by coherently combining echoes recorded along the orbit, giving metre-scale resolution from 747 km altitude. Each pixel stores amplitude (how much energy came back) and phase (the exact distance to the ground, modulo the wavelength).',
  },
  {
    id: 'backscatter',
    title: 'Bright and dark: backscatter',
    simple:
      'Bright means a lot of the pulse bounced back to the satellite. Calm water acts like a mirror and sends the pulse away, so it looks black. Buildings act like corner reflectors and look very bright. Forests are medium-bright because the canopy scatters the pulse in all directions.',
    scientific:
      'Radar brightness (backscatter, γ⁰) depends on surface roughness relative to the wavelength, geometry (local incidence angle) and dielectric properties (moisture). Specular reflection from smooth water gives very low γ⁰; dihedral double-bounce (walls, flooded trunks) gives very high γ⁰; volume scattering in canopies is intermediate and strongly depolarizing.',
  },
  {
    id: 'polarization',
    title: 'Polarization: HH and HV',
    simple:
      'NISAR sends pulses with a horizontal wave (H) and listens for both horizontal (HH) and vertical (HV) echoes. Only messy, three-dimensional targets like tree branches flip the wave to vertical, so HV is a "vegetation detector".',
    scientific:
      'Co-polarized HH is dominated by surface and double-bounce scattering; cross-polarized HV arises mainly from multiple scattering in volumes (canopies). The HH/HV ratio helps separate bare ground, vegetation, urban areas and flooded vegetation (HH strongly enhanced by trunk–water double bounce).',
  },
  {
    id: 'insar',
    title: 'Interferometry: measuring motion',
    simple:
      'Compare the echo timing of two passes over the same place, 12 days apart. If the ground moved toward or away from the satellite, the echo arrives slightly earlier or later. The rainbow bands (fringes) are contour lines of that motion.',
    scientific:
      'The interferometric phase Δφ = 4πΔR/λ links phase to line-of-sight (LOS) range change ΔR. With λ ≈ 24 cm for NISAR L-band, one 2π fringe corresponds to λ/2 ≈ 12 cm of LOS change. Phase also contains atmospheric, ionospheric and orbital terms that must be separated from ground motion.',
  },
  {
    id: 'coherence',
    title: 'Coherence: when the radar loses track',
    simple:
      'Fringes only work where the ground looks the same in both passes. Water, moving leaves or a collapsed landscape scramble the echo, and the interferogram turns into random noise there.',
    scientific:
      'Coherence (0–1) measures the correlation of the two complex images. Water surfaces decorrelate within milliseconds; vegetation, snow, and surface disruption reduce coherence. Low-coherence pixels carry no usable phase and must be masked.',
  },
  {
    id: 'lband',
    title: 'Why L-band matters',
    simple:
      'NISAR uses long 24 cm waves, about four times longer than Europe’s Sentinel-1. Long waves slip past leaves and reach the ground, so NISAR can measure motion and floods under forests where shorter waves fail.',
    scientific:
      'Longer wavelength penetrates canopies and keeps interferometric coherence over vegetated and agricultural terrain for longer repeat intervals. The cost: L-band is more sensitive to the ionosphere, which adds long-wavelength phase ramps that must be estimated (e.g. by split-spectrum methods).',
  },
];

export const EVENT_CONTENT: Record<string, EventContent> = {
  'venezuela-2026': {
    happened: {
      text: 'On 24 June 2026 at about 22:04 UTC, two large earthquakes (M7.5 and M7.2) struck north-central Venezuela, near the coastal fault system that runs along the Caribbean shore. NASA used NISAR to map how far the ground shifted.',
      source: 'USGS; NASA Earth Observatory',
      url: 'https://science.nasa.gov/earth/earth-observatory/where-venezuelas-earthquakes-shifted-the-ground/',
    },
    readSimple: [
      'The default view is our measurement: how far the ground moved toward (red) or away from (blue) the satellite, in centimetres, computed from NISAR’s interferograms.',
      'BEFORE covers 1–13 June, with no earthquake: almost everything stays within a few centimetres (pale). AFTER covers 13–25 June: land south of the coast moved up to about 45 cm away from the satellite (deep blue).',
      'Black gaps are places where the radar could not get a reliable measurement (water, steep mountains, dense vegetation).',
      'Switch either slot to NASA’s rainbow pictures of the same data to see the raw interferometric fringes:',
      'Each full cycle of colours is a contour step of motion toward or away from the satellite: about 42 cm in NASA’s rendering. Crowded bands = the ground moved a lot over a short distance.',
      'The tight bands along the coast appear only in the AFTER image. That is the earthquake. The wide, gentle bands appear in BOTH images, so they are not the earthquake.',
      'The speckled noise in the north is the Caribbean Sea: water never looks the same twice, so radar cannot measure it.',
    ],
    readScientific: [
      'Derived layers (default): LOS displacement d = −φ·λ/4π (λ = 24.20 cm from centerFrequency 1239 MHz) from GUNW unwrappedPhase minus the product’s ionospherePhaseScreen, masked where coherence < 0.3 or outside connected components, referenced to a far-field box (69.1–68.7°W, 9.8–10.0°N). Both pairs share one ±50 cm colour scale.',
      'Pre-seismic pair (06-01 → 06-13): 1st–99th percentile −5.0 to +8.3 cm, standard deviation 3.5 cm, i.e. our noise floor (residual troposphere/ionosphere). Coseismic pair (06-13 → 06-25): 1st percentile −45 cm (away from the satellite), 99th +14.9 cm, standard deviation 12 cm. About half the area survives the coherence mask in each pair.',
      'Sign convention follows ISCE3 (interferogram = reference × conj(secondary); positive phase = range increase), inferred from source code and consistent with right-lateral (westward) motion of the block south of the coastal fault for this ascending geometry and with NASA’s reported ~60 cm of westward motion. It is one look direction only, so east–west and vertical motion are mixed.',
      'Product: NISAR L2 GUNW (geocoded unwrapped interferogram), track 162 ascending, frame 007. The browse image is the unwrapped phase rewrapped to [0, 7π) with a cyclic (twilight) colour map, per the NISAR QA software defaults. One colour cycle = 7π rad = 3.5 × λ/2 ≈ 42 cm of LOS change (λ ≈ 24.2 cm). The production rewrap value is recorded in the QA statistics file and could differ.',
      'In the browse rendering, the coseismic pair shows a dense, coast-parallel fringe band peaking near the USGS epicentres, matching the steep displacement gradient in our derived map.',
      'Long-wavelength fringes present in both the pre-seismic (2026-06-01 → 06-13) and coseismic pairs are most plausibly ionospheric and tropospheric delay, to which L-band is particularly sensitive. They are not interpreted as deformation.',
      'Decorrelation over the Caribbean Sea and Lake Valencia shows where phase is meaningless; a coherence mask would remove these pixels.',
    ],
    legend: [
      { swatch: 'linear-gradient(90deg,#2166ac,#67a9cf,#f7f7f7,#ef8a62,#b2182b)', label: 'Derived map: blue = away from the satellite, red = toward it (cm, see colour bar above)' },
      { swatch: 'linear-gradient(90deg,#2b1440,#3d5fc2,#f2f2f2,#c86a3b,#2b1440)', label: 'NASA browse: one colour cycle ≈ 42 cm of line-of-sight motion (cyclic, 7π rad)' },
      { swatch: 'repeating-linear-gradient(45deg,#7a5a7e 0 2px,#3c3f8f 2px 4px)', label: 'Speckled noise = no coherent signal (water)' },
    ],
    pins: [
      { id: 'v-coast', lon: -67.9, lat: 10.42, label: 'Crowded fringes along the coast', simple: 'The deepest blue in the AFTER map sits here, along the coast near the epicentres: the ground moved tens of centimetres away from the satellite. In NASA’s rainbow picture the colour bands crowd together here, and only after 24 June.', scientific: 'High fringe density = steep LOS displacement gradient near the rupture. The band is absent in the pre-seismic pair, which isolates it as coseismic.' },
      { id: 'v-broad', lon: -68.72, lat: 9.86, label: 'The noise floor', simple: 'In the BEFORE map (no earthquake) the ground here still shows a few centimetres of apparent motion, and NASA’s rainbow pictures show wide gentle bands in BOTH pairs. That is the air and the ionosphere slightly delaying the radar signal, not the earthquake: about ±3.5 cm is our measurement noise.', scientific: 'Long-wavelength phase common to both pairs: likely ionospheric (dispersive, strong at L-band) plus tropospheric delay. Split-spectrum ionosphere correction and weather-model tropospheric correction would reduce it.' },
      { id: 'v-lake', lon: -67.77, lat: 10.19, label: 'Lake Valencia: noise', simple: 'A patch of noise inside the land: this is Lake Valencia. Water changes from second to second, so the radar cannot compare the two passes there.', scientific: 'Temporal decorrelation of the water surface (coherence ≈ 0). Its position also checks our georeferencing of the browse image.' },
      { id: 'v-sea', lon: -67.4, lat: 11.4, label: 'Caribbean Sea: no signal', simple: 'All the speckle in the north is sea. No measurement is possible over water, which is why we only see motion on land.', scientific: 'Open ocean is fully decorrelated; any offshore part of the rupture is invisible to InSAR.' },
    ],
    caveats: [
      'Derived by our team from NISAR data, not an official NASA product. Troposphere and solid-earth tides are not corrected; expect a few centimetres of error (pre-seismic noise: 3.5 cm standard deviation).',
      'Interferograms show motion along the radar line of sight only (one direction), not full 3-D motion.',
      'PROVISIONAL data tier: calibrated, but will be reprocessed by NASA in 2027.',
    ],
  },
  'mozambique-floods-2026': {
    happened: {
      text: 'In January 2026, flooding along the Limpopo and Incomati rivers in southern Mozambique inundated floodplains and farmland. NASA compared NISAR observations from 5 and 17 January to map open water.',
      source: 'NASA Scientific Visualization Studio',
      url: 'https://svs.gsfc.nasa.gov/5661',
    },
    readSimple: [
      'The default view is our measurement of radar brightness on 5 and 17 January around Chókwè. Dark = the pulse bounced away, which is what calm water does.',
      'Pick “water mask” in the AFTER slot: bright blue = about 316 km² of new water on 17 January, mostly across the Limpopo floodplain and its irrigated fields. Muted blue = about 328 km² that was water on both dates (river channels, lakes, wetlands).',
      'Pick “change (dB)” to see where it got darker (blue) or brighter (red). The whole area got a little brighter, most likely because rain wetted the soil: that is why we only count new water where the ground also got much darker.',
      'Colour shows which of two radar "listening" channels was stronger: green leans to HV (vegetation), pink/magenta leans to HH (surfaces, buildings, and plants standing in water). White = both strong.',
      'Radar sees through the clouds that cover floods, which is why it is used in disasters like this.',
    ],
    readScientific: [
      'Product: NISAR L2 GCOV (geocoded, terrain-flattened backscatter γ⁰), dual-pol HH/HV, track 114 ascending, frame 165. Browse composite per NISAR QA defaults: R = HH, G = HV, B = HH; each channel in linear power, clipped to its own 5th–95th percentile, gamma 0.5. Because each date is stretched independently, brightness is not comparable quantitatively between dates.',
      'Open water appears as very low backscatter in both channels (specular reflection). An HH increase relative to HV in vegetated floodplains can indicate flooded vegetation via trunk–water double bounce, which L-band detects beneath canopies.',
      'Derived layers: GCOV HHHH/HVHV read for 32.75–33.35°E, 24.35–24.85°S (3,370 km²), 5×5 boxcar on linear power, then dB. The 17 Jan HH histogram is bimodal (water peak ≈ −18 dB, land ≈ −6 dB). Otsu gave −11.4 dB, biased by the much larger land class, so we use the histogram valley, −14.75 dB.',
      'New water = HH < −14.75 dB on 17 Jan AND 10·log10(after/before) < −3 dB: 316 km². Water on both dates: 328 km². The scene median change is +3.1 dB (land brightening from soil moisture and/or BETA calibration), so a threshold without the change criterion would be biased.',
      'The 24 Dec 2025 scene on the timeline gives a pre-flood baseline on the identical geometry.',
    ],
    legend: [
      { swatch: '#000', label: 'Very dark = little energy returned (open water, smooth surfaces)' },
      { swatch: '#7dffa0', label: 'Green = HV relatively strong (vegetation volume)' },
      { swatch: '#ff7dff', label: 'Magenta = HH relatively strong (surface / double bounce)' },
    ],
    pins: [
      { id: 'm-chokwe', lon: 33.0, lat: -24.53, label: 'Limpopo floodplain near Chókwè', simple: 'The Limpopo valley around Chókwè, a farming area that floods when the river overtops its banks. Compare how much of the valley floor is dark on each date.', scientific: 'Floodplain agriculture: expect γ⁰ to drop where fields become open water, and HH to rise where crops or shrubs stand in water.' },
      { id: 'm-corumana', lon: 32.12, lat: -25.2, label: 'Corumana reservoir (reference)', simple: 'A reservoir: permanent calm water, so it is dark on both dates. Use it as a reference for what water looks like to radar.', scientific: 'Stable open-water target; useful as an in-scene reference for the water threshold. Its mapped position also checks our georeferencing.' },
    ],
    caveats: [
      'BETA data tier: NASA states these early products are not fully calibrated and not intended for science. Relative patterns are still informative.',
      'Flood areas are our heuristic classification, not field-validated. Compare with NASA’s open-water maps (SVS 5661) before quoting them.',
      'Wind-roughened water and smooth surfaces such as tarmac can mimic or hide water in radar images.',
    ],
  },
  'krasheninnikov-2026': {
    happened: {
      text: 'Krasheninnikov, a volcano in the Kronotsky Reserve of Kamchatka, began erupting on 2–3 August 2025, days after the M8.8 Kamchatka earthquake; its previous eruption was around 1550. Lava was still flowing onto its eastern flanks in late October 2026 (KVERT). NASA released a NISAR time-lapse of the lava flows.',
      source: 'Smithsonian GVP / KVERT weekly reports; NASA JPL; NASA SVS',
      url: 'https://svs.gsfc.nasa.gov/5675',
    },
    readSimple: [
      'Eleven NISAR passes on the same orbit, 12 days apart, from June to October 2026. Step through them on the timeline.',
      'Radar keeps watching through cloud and polar night, which is common over Kamchatka.',
      'Not every change is the volcano: the whole scene shifts colour toward autumn as snow and frozen ground change how the surface reflects the radar.',
      'These images are about 200 m per pixel, too coarse to trace individual lava flows. NASA’s time-lapse uses the full 10 m data.',
    ],
    readScientific: [
      'Product: NISAR L2 GCOV, dual-pol HH/HV, track 060 descending, frame 061; 2026-06-18 to 2026-10-28 (PROVISIONAL, last date VALIDATED). Earlier passes used by NASA (Dec 2025 – Jan 2026) are not yet publicly released.',
      'The scene-wide colour change between summer and late October is consistent with seasonal snow and freeze, which alter dielectric properties and the HH/HV balance. It affects the whole scene, so it should not be read as volcanic.',
      'KVERT reported lava still advancing on the east-northeast and east flanks of the Northern Cone in late October 2026. Local changes there may be volcanic, but at browse resolution (≈200 m) and with per-image percentile stretching we cannot separate them from seasonal effects.',
      'Fresh lava fields are typically rough at L-band scale (bright) and lack vegetation (low HV). Detecting them reliably requires full-resolution γ⁰ and a seasonally matched baseline.',
    ],
    legend: [
      { swatch: '#000', label: 'Dark = little energy returned (smooth surfaces, radar shadow)' },
      { swatch: '#7dffa0', label: 'Green = HV relatively strong (vegetation volume)' },
      { swatch: '#ff7dff', label: 'Magenta = HH relatively strong (surface scattering)' },
    ],
    pins: [
      { id: 'k-summit', lon: 160.273, lat: 54.593, label: 'Krasheninnikov summit', simple: 'The volcano’s summit.', scientific: 'Steep slopes facing away from the radar fall into shadow (dark) and slopes facing it are compressed (layover).' },
    ],
    caveats: [
      'Browse resolution (about 200 m) is too coarse to map the lava flows; full-resolution processing is pending.',
      'Data tiers are mixed (PROVISIONAL and VALIDATED), so small calibration differences between dates are possible.',
      'Seasonal snow dominates the changes seen in this series.',
    ],
  },
};
