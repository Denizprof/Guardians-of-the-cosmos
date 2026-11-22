// Content of the Simulation Lab guide: every circle, colour, setting and number, in two registers.
// "simple" = everyday words and pictures; "scientific" = the model, equations, units and references.
// Ranges of settings are read from the engines themselves (rangeOf), so they cannot drift from the Lab.
import { SIM_COLORS } from '../map/markers';
import { ASH_CLASSES, DEPTH_CLASSES, FIRE_CLASSES, PRECIP_CLASSES, SURFACE_CLASSES, WARM_CLASSES } from './floodRender';
import { ENGINES } from './registry';
import type { SimCategory } from './types';

export type Level = 'simple' | 'scientific';
export interface Dual { simple: string; scientific: string }
export interface HelpEntry {
  name: string;
  /** Engine setting key: the allowed range is added automatically. */
  key?: string;
  /** CSS colour of the circle / band this entry explains. */
  swatch?: string;
  text: Dual;
}
export type SceneId = 'impact' | 'earthquake' | 'flood' | 'tsunami' | 'volcano' | 'wildfire' | 'climate' | 'timeline';
export interface HelpExample { label: string; category: SimCategory; params: Record<string, unknown> }
export interface HelpTopic {
  id: string;
  title: string;
  kicker: string;
  category?: SimCategory;
  intro: Dual;
  scene?: SceneId;
  how?: { simple: string[]; scientific: string[] };
  seeTitle?: Dual;
  see?: HelpEntry[];
  settingsTitle?: Dual;
  settings?: HelpEntry[];
  numbers?: HelpEntry[];
  real?: { name: string; text: Dual }[];
  limits?: Dual;
  example?: HelpExample;
}

const d = (simple: string, scientific: string): Dual => ({ simple, scientific });
const rgb = (c: readonly number[]): string => `rgb(${c.join(',')})`;
const sev = (i: 0 | 1 | 2 | 3): string => SIM_COLORS[i];

/** "1 – 20,000 m · starts at 500", or the list of choices, for an engine setting. */
export function rangeOf(category: SimCategory | undefined, key: string | undefined): string | null {
  const engine = category ? ENGINES[category] : undefined;
  if (!engine || !key) return null;
  const p = engine.params.find((x) => x.key === key);
  const n = (x: number): string => (key === 'year' ? String(x) : x.toLocaleString('en-US'));
  if (p) return `${n(p.min)} – ${n(p.max)}${p.unit ? ` ${p.unit}` : ''} · starts at ${n(p.default)}`;
  const c = engine.choices.find((x) => x.key === key);
  return c ? c.options.map((o) => o.label).join(' · ') : null;
}

const GLOBE_MARKS: HelpEntry[] = [
  { name: 'White dot with a red ring', swatch: sev(3), text: d('Ground zero: the exact spot where the event starts (where the rock lands, where the earthquake begins, where the fire is lit).', 'The event location (impact point, epicentre, vent or ignition point) at the latitude and longitude you gave.') },
  { name: 'Solid coloured area', text: d('How far the effect has reached at the moment shown on the time bar. Press play and watch it grow.', 'The state of each modelled field at the current simulation time t. Fronts grow at the model’s physical speed (sound for blast, ≈5 km/s for shaking, √(gd) for waves…).') },
  { name: 'Dashed line', text: d('The final size the model calculated. The solid colour grows until it touches the dashed line.', 'The final modelled extent of each zone (radius at which a threshold is last exceeded).') },
  { name: 'Grey dotted circles', text: d('Your other runs (Scenario A, B…), drawn on the same map so you can compare their sizes.', 'The largest zone of every other stored scenario, at its own ground zero, for like-for-like comparison.') },
  { name: 'Red label “Hypothetical simulation”', swatch: '#c2253a', text: d('A reminder: this is a “what if”, not something that happened or a prediction.', 'Evidence class “simulation”: model output from stated assumptions. It is not an observation, a forecast or an official hazard map.') },
];

export const TOPICS: HelpTopic[] = [
  {
    id: 'start', title: 'Start here', kicker: 'Overview',
    intro: d(
      'The Lab is a “what if?” machine. Pick a big event — a space rock hitting Earth, an earthquake, a flood, a tsunami, a volcano or a wildfire — pick a place, and watch what could happen on the globe. It is like a science experiment on a computer. Nothing is real: you are just playing “what if”.',
      'The Planetary Simulation Lab runs seven physical models in your browser from published equations (Collins et al. 2005; Bates et al. 2010; Bonadonna et al. 2005; Rothermel 1972 and others). Every run is a deterministic hypothetical scenario with stated assumptions, uncertainty ranges and references. The same inputs always give the same outputs.'),
    how: {
      simple: ['Open the Lab with the “What if?” button at the top.', 'Choose an Event (a space rock, an earthquake…).', 'Choose a place: type two numbers, or press “Pick on the globe” and click the map.', 'Change the settings, or leave them as they are.', 'Press “Validate and run”.', 'Watch the globe. Press ▶ on the time bar to see it happen.', 'Read the results below, then try changing one setting and run again to compare.'],
      scientific: ['Select an engine; coordinates are validated against its domain (e.g. tsunami: |lat| ≤ 75°).', 'Parameters are range-checked; an invalid one is reported by name and nothing is calculated.', 'Engines that need data (flood, tsunami, volcano, wildfire) download real terrain or weather, then solve in a Web Worker with progress and Cancel.', 'The result (steps, outputs with ranges, zones, series, phases, raster frames) is stored as Scenario A, B, C… (up to 6).', 'The globe, the time bar, the results tabs and the assistant all read the same stored scenario.', 'Export the report (.md) or the data (.json) to reproduce the run.']
    },
    seeTitle: d('What the marks on the globe mean', 'Marks on the globe (all engines)'),
    see: GLOBE_MARKS,
    settingsTitle: d('The Lab panel, button by button', 'Lab panel controls'),
    settings: [
      { name: 'Event', text: d('Which kind of event to simulate. “Planned” ones cannot be run yet.', 'Selects the engine. Categories without an engine are listed with the data they need and are never faked.') },
      { name: 'Latitude / Longitude', text: d('Where the event happens. Latitude is north–south (−90 to 90), longitude is east–west (−180 to 180).', 'Geographic coordinates in degrees (WGS-84). Typing new numbers clears the place name.') },
      { name: 'Pick on the globe', text: d('Click this, then click anywhere on the map to fill in the two numbers for you.', 'Switches the map into pick mode; the next click sets lat/lon.') },
      { name: 'Validate and run', text: d('Checks your numbers make sense, then runs the experiment. If something is out of range it tells you which one.', 'Validates every parameter against the engine’s ranges, then runs it (asynchronously for engines that fetch data).') },
      { name: 'Cancel', text: d('Stops a run that is still working.', 'Aborts the download and terminates the worker.') },
      { name: 'Scenario A, B, C… chips', text: d('Every run is saved as a chip. Click one to look at it again. Press × to delete it.', 'Up to six stored runs; the active one drives the globe, timeline and results.') },
      { name: 'Ask the Global SAR AI', text: d('The assistant can explain a run or run new ones. Try: “What would happen if a 500-meter asteroid hit Istanbul at 20 km/s?”', 'The existing in-browser assistant calls the same engines, quotes only computed numbers, and cites the model.') },
    ],
    limits: d('All results are estimates for exploring ideas. They are not forecasts and not safety advice.', 'Results are first-order scenario models. Follow official warning agencies for real events.'),
  },

  {
    id: 'impact', title: 'Asteroid / meteor impact', kicker: 'Event 1', category: 'impact', scene: 'impact',
    intro: d(
      'A space rock crashes into Earth. Big or fast rocks dig a hole and push out a huge wave of air that smashes buildings. Small ones usually explode in the air before they reach the ground.',
      'Collins, Melosh & Marcus (2005) impact-effects scaling. Atmospheric entry is integrated numerically (drag plus “pancake” fragment spreading, airburst at 7 L₀), followed by crater, airblast, thermal, ejecta, seismic and (ocean) wave scaling.'),
    how: {
      simple: ['The rock weighs a lot and moves incredibly fast, so it carries a huge amount of energy.', 'On the way down, air rubs against it and heats it.', 'It hits (or explodes in the air). The energy turns into a flash, a hole, flying rock and a shockwave.', 'The shockwave and the ground shaking spread out in circles.'],
      scientific: ['Mass m = ρ·(4/3)πr³; kinetic energy E = ½mv².', 'Entry: dv/dt = −3ρₐC_D v²L²/(4ρᵢL₀³) integrated from 100 km; break-up when ρₐv² > Y, Y = 10^(2.107+0.0624√ρ) Pa.', 'Crater: D_tc = 1.161(ρᵢ/ρ_t)^(1/3)L^0.78 v^0.44 g^−0.22 sin^(1/3)θ; simple → complex above 3.2 km.', 'Airblast: p(r) = (pₓrₓ/4r₁)(1+3(rₓ/r₁)^1.3), r₁ = r/E_kt^(1/3).', 'Seismic: M = 0.67 log₁₀E − 5.87; effective magnitude falls with distance.']
    },
    seeTitle: d('The circles, from far to near', 'Zones drawn for an impact'),
    see: [
      { name: 'Ground shaking ≈ M4+', swatch: sev(0), text: d('Far away the ground still shakes a little, like a small earthquake you can feel.', 'Distance where the effective seismic magnitude still ≥ 4 (felt).') },
      { name: 'Ground shaking ≈ M6+', swatch: sev(2), text: d('Closer in, the shaking is like a strong earthquake that can damage weak buildings.', 'Effective magnitude ≥ 6 (damaging shaking).') },
      { name: 'Airblast ≥ 1 psi (6.9 kPa)', swatch: sev(1), text: d('The blast wave breaks windows. Flying glass hurts people.', 'Peak overpressure 6.9 kPa: window glass fails, light damage (Glasstone & Dolan 1977).') },
      { name: 'Airblast ≥ 5 psi (34.5 kPa)', swatch: sev(2), text: d('Most houses collapse inside this circle.', '34.5 kPa: most residential buildings collapse.') },
      { name: 'Airblast ≥ 20 psi (138 kPa)', swatch: sev(3), text: d('Even strong concrete buildings are destroyed.', '138 kPa: reinforced-concrete structures severely damaged.') },
      { name: 'Thermal: 2nd / 3rd-degree burns', swatch: sev(1), text: d('The bright fireball is so hot it burns skin from far away. Shown only for fast ground impacts (15 km/s or more).', 'Radiant exposure thresholds scaled as E_Mt^(1/6); shown for ground impacts with v ≥ 15 km/s (vapour fireball, R_f = 0.002E^(1/3)).') },
      { name: 'Ejecta deposit ≥ 10 cm', swatch: sev(2), text: d('Rock thrown out of the hole falls back and lies at least a hand’s width (10 cm) deep.', 'Ejecta blanket thickness t_e = D_tc⁴/(112 r³) ≥ 10 cm.') },
      { name: 'Crater', swatch: sev(3), text: d('The hole in the ground. “Simple” is a bowl. “Complex” is a huge crater that collapses into a ring with a hill in the middle.', 'Final crater D_fr = 1.25 D_tc (simple) or 1.17 D_tc^1.13/D_c^0.13 (complex, D_c = 3.2 km). Depth in the Working tab.') },
      { name: 'The meteor flying in from space', text: d('A cinematic: the rock streaks in from the sky, glows as the air heats it, and flashes where it lands. It follows the model’s real height and speed, but the direction it comes from is just for the picture.', 'Drawn from the computed altitude track (100 km at entry, ≈20 km/s lead-in before); the glow follows the heating, the flash sits at the burst point (the ground, or the airburst altitude). The approach direction on screen is arbitrary.') },
  { name: 'Open-ocean wave ≥ 1 m / ≥ 10 m', swatch: sev(1), text: d('Only for ocean hits: how far a tall wave travels across deep water. It does not say how high it climbs on a beach.', 'Ocean impacts: A(r) ≈ A_max(R_c/r) with A_max = min(D_tc,w/14.1, depth); coastal run-up is not computed.') },
      { name: 'No crater at all?', text: d('A small rock can burn up and explode in the air (an “airburst”). Then you only see blast circles — like the 2013 Chelyabinsk meteor.', 'When the fragmented body reaches 7 L₀ before the ground, energy is released at the burst altitude; no crater is produced.') },
    ],
    settingsTitle: d('Settings, one by one', 'Parameters'),
    settings: [
      { name: 'Composition', key: 'composition', text: d('What the rock is made of: stone, metal or icy comet. Metal is heavy and strong; comets are fluffy and break up easily.', 'Sets bulk density: stony 3000, iron 8000, cometary 1000 kg/m³, or custom.') },
      { name: 'Target', key: 'target', text: d('What it hits: ground (soft or hard rock) or the ocean.', 'Land: sedimentary (2500 kg/m³) or crystalline rock (2750); ocean: water column over a rock seabed.') },
      { name: 'Diameter', key: 'diameter', text: d('How wide the rock is. This is the most important setting: twice as wide is eight times as heavy.', 'Pre-entry diameter L₀. Energy ∝ L₀³.') },
      { name: 'Density', key: 'density', text: d('How heavy the material is for its size. Changing it switches Composition to “custom”.', 'Projectile bulk density ρᵢ.') },
      { name: 'Velocity', key: 'velocity', text: d('How fast it is moving when it reaches the atmosphere. Twice as fast is four times the energy.', 'Entry speed v₀. Energy ∝ v₀². Earth-crossing asteroids are 11–72 km/s, typically ≈ 20.') },
      { name: 'Impact angle', key: 'angle', text: d('90° is straight down; a low angle is a glancing blow. 45° is the most common.', 'Angle from horizontal θ; crater scales with sin^(1/3)θ. 45° is the most probable.') },
      { name: 'Water depth', key: 'waterDepth', text: d('Only for ocean hits: how deep the sea is where it lands.', 'Sea depth d_w; the body is slowed by v_sf = v exp(−3ρ_wC_D d_w/(2ρᵢL sinθ)) before the seabed.') },
    ],
    numbers: [
      { name: 'Kinetic energy at entry', text: d('How much energy the rock carries, also shown as millions of tonnes of TNT (Mt). Hiroshima was about 0.015 Mt.', 'E = ½mv₀² in joules; 1 Mt TNT = 4.184×10¹⁵ J.') },
      { name: 'Impact energy / Airburst energy', text: d('What is left when it arrives. Air slows it a little.', 'Eᵢ = ½mvᵢ² after atmospheric deceleration.') },
      { name: 'Airburst altitude', text: d('How high up it explodes (only if it explodes in the air).', 'Altitude where L = 7 L₀ (Collins et al. 2005).') },
      { name: 'Crater diameter / depth', text: d('How wide and deep the hole is. The grey (low–high) is the likely range.', 'Final crater; range ≈ D/1.3 … D/0.77.') },
      { name: 'Radius of … overpressure', text: d('How far each blast circle reaches. The range in brackets is ±50%.', 'Distance where peak overpressure falls to the threshold; shown ÷/× 1.5.') },
      { name: 'Equivalent earthquake magnitude', text: d('How big an earthquake the impact’s shaking would be like.', 'M = 0.67 log₁₀(Eᵢ) − 5.87 (seismic efficiency 10⁻⁴), ±0.5.') },
    ],
    real: [
      { name: 'Chelyabinsk, 2013', text: d('A rock about 19 m wide exploded about 30 km up. Windows broke across a city.', '≈19 m stony body, 19 km/s, 18°: airburst ≈ 30 km, ≈0.5 Mt (Popova et al. 2013).') },
      { name: 'Meteor Crater, Arizona', text: d('A metal rock about 50 m wide made a crater 1.2 km across about 50,000 years ago.', '≈50 m iron, ≈12.8 km/s: simple crater 1.2 km, ≈180 m deep.') },
      { name: 'Chicxulub', text: d('A rock about 10 km wide hit Mexico 66 million years ago and helped end the dinosaurs.', '≈10 km body at ≈20 km/s: complex crater ≈180 km (Schulte et al. 2010).') },
    ],
    limits: d('Not exact: most circles could be about twice as big or small. The model ignores hills, buildings and weather, and it does not guess how many people are hurt.', 'First-order scaling: ±factor ≈ 2 on most radii. No terrain, no population or casualty model; airburst thermal radiation is not modelled.'),
    example: { label: 'Load: 500 m asteroid hits Istanbul at 20 km/s', category: 'impact', params: { diameter: 500, velocity: 20, lat: 41.0082, lon: 28.9784, label: 'Istanbul' } },
  },

  {
    id: 'earthquake', title: 'Earthquake', kicker: 'Event 2', category: 'earthquake', scene: 'earthquake',
    intro: d(
      'Rock deep underground suddenly slips and the ground shakes. The circles show how strongly people would feel it at each distance.',
      'Seismic moment, radiated energy and rupture size from Hanks & Kanamori (1979), Gutenberg–Richter and Wells & Coppersmith (1994); an intensity footprint (MMI) from Atkinson & Wald (2007), as a point source.'),
    how: {
      simple: ['Two big pieces of rock under the ground are stuck together while pushing on each other.', 'Suddenly they slip. The slip starts a wave of shaking.', 'The shaking is strongest near the spot above the slip and weaker far away.'],
      scientific: ['M₀ = 10^(1.5Mw+9.1) N·m; log₁₀E = 1.5M + 4.8.', 'Rupture length: log₁₀L = a + bM (fault-type coefficients).', 'MMI = c₁ + c₂(M−6) + c₃(M−6)² + c₄log R + c₅R + c₆B + c₇M log R, R = √(D²+h²), h = max(14 km, depth).', 'Arrival times use P ≈ 6 km/s and S ≈ 3.5 km/s.']
    },
    seeTitle: d('The circles (Mercalli shaking scale)', 'Intensity zones (Modified Mercalli, MMI)'),
    see: [
      { name: 'Lightning cracks at the surface', text: d('A cinematic: when the earthquake starts, a white flash and branching cracks spread out from the epicentre like lightning, then fade. Their length follows the rupture length; their exact paths are just for the picture.', 'Drawn from the rupture length L (≈3 km/s rupture speed, shown spreading in ≤ 5 s so it can be seen) with deterministic jagged branching. For a tsunami source the cracks follow the real strike; for the point-source earthquake the orientation is arbitrary.') },
  { name: 'Intensity IV+ — light', swatch: sev(0), text: d('Felt indoors by many people. Dishes rattle.', 'MMI ≥ IV: felt indoors by many.') },
      { name: 'Intensity VI+ — strong', swatch: sev(2), text: d('Everyone feels it. Small damage, things fall off shelves.', 'MMI ≥ VI: felt by all, slight damage.') },
      { name: 'Intensity VIII+ — severe', swatch: sev(3), text: d('Ordinary buildings are badly damaged.', 'MMI ≥ VIII: considerable damage to ordinary buildings.') },
      { name: 'Intensity IX+ — violent', swatch: sev(3), text: d('Even well-built buildings are heavily damaged.', 'MMI ≥ IX: heavy damage even to well-designed structures.') },
    ],
    settings: [
      { name: 'Moment magnitude (Mw)', key: 'magnitude', text: d('The size of the earthquake. Each +1 is about 32 times more energy. The biggest ever recorded was 9.5 (Chile, 1960).', 'Moment magnitude. Energy grows ≈ 10^(1.5 ΔM) (×31.6 per unit).') },
      { name: 'Hypocentre depth', key: 'depth', text: d('How deep underground it starts. Deeper means weaker shaking at the surface.', 'Depth of rupture start; enters the distance R = √(D²+h²).') },
      { name: 'Fault type', key: 'fault', text: d('How the rocks move: sliding sideways (strike-slip), one side pushed up over the other (reverse/thrust), or one side dropping (normal).', 'Selects the Wells & Coppersmith length coefficients (log₁₀L = a + bM).') },
    ],
    numbers: [
      { name: 'Radiated energy', text: d('Energy released as shaking, also in tonnes of TNT.', 'E = 10^(1.5M+4.8) J.') },
      { name: 'Rupture length', text: d('How long the cracked fault is. Bigger quakes break a longer crack.', 'Subsurface rupture length, range ÷/× 1.9.') },
      { name: 'Peak intensity (epicentre)', text: d('How hard the ground shakes right above the start, on a 1–12 scale.', 'MMI at D = 0, ±0.7.') },
      { name: 'MMI … out to', text: d('How far each shaking circle reaches.', 'Radius where predicted MMI falls to the level, ÷/× 1.6.') },
    ],
    limits: d('The model treats the quake as one point. Real faults are long, and soft ground can shake much harder. It does not predict landslides or tsunamis.', 'Point source, California coefficients, no site amplification or directivity (±1 MMI scatter).'),
    example: { label: 'Load: Mw 7.5 earthquake', category: 'earthquake', params: { magnitude: 7.5, depth: 15, lat: 37.0, lon: 37.2, label: 'Example epicentre' } },
  },

  {
    id: 'flood', title: 'Flood', kicker: 'Event 3', category: 'flood', scene: 'flood',
    intro: d(
      'Heavy rain (or the sea rising) covers the land with water. The simulator uses the real shape of the ground, so water runs downhill and collects in low places, like in real life.',
      'A 2-D inertial shallow-water solver (Bates, Horritt & Fewtrell 2010, the LISFLOOD-FP scheme) on the real AWS Terrain Tiles DEM, with uniform rain, constant infiltration, Manning friction and an optional sea-level boundary.'),
    how: {
      simple: ['The computer downloads the real height of the ground around your point.', 'It lets rain fall and shows the water moving downhill, step by step.', 'Water that soaks into the soil disappears. Water that leaves the edge is gone.', 'If you raise the sea, water enters from the coast — but only into land that is connected to the sea (a bowl behind a hill stays dry).'],
      scientific: ['Per face: q⁺ = (q − g h_f Δt ∂η/∂x)/(1 + g Δt n²|q|/h_f^(7/3)), h_f = max η − max z.', 'Per cell: h⁺ = h + Δt(Σq_in − Σq_out)/Δx + Δt(i − f).', 'Δt = 0.7Δx/√(g h_max) (adaptive).', 'Sea cells (DEM ≤ 0) hold η = Δ_sea; edges drain at normal depth where the ground slopes outward.', 'Grid ≤ 200×200 cells; solved in a Web Worker; a mass-balance error is reported.']
    },
    seeTitle: d('The blue colours (water depth)', 'Depth classes (maximum-extent raster)'),
    see: [
      { name: '5–30 cm', swatch: rgb(DEPTH_CLASSES[0].color), text: d('Shallow: up to your ankle or shin.', 'Depth 0.05–0.3 m.') },
      { name: '30 cm – 1 m', swatch: rgb(DEPTH_CLASSES[1].color), text: d('Up to your waist. Cars start to float.', 'Depth 0.3–1 m.') },
      { name: '1 – 2 m', swatch: rgb(DEPTH_CLASSES[2].color), text: d('Deeper than a child is tall. Dangerous.', 'Depth 1–2 m.') },
      { name: 'More than 2 m', swatch: rgb(DEPTH_CLASSES[3].color), text: d('Over a person’s head. The ground floor of a house is under water.', 'Depth > 2 m.') },
    ],
    settings: [
      { name: 'Rainfall intensity', key: 'rainfall', text: d('How hard it rains, in millimetres of water per hour. 50 is a very strong storm; 100 is extreme.', 'Uniform rain rate i. ≈50 mm/h is a severe cloudburst.') },
      { name: 'Rain duration', key: 'duration', text: d('How many hours the rain lasts.', 'Duration T of rain over the whole domain.') },
      { name: 'Simulated time', key: 'simHours', text: d('How long to watch in total. It can be longer than the rain, to see the water drain.', 'Total model time, including the recession after rain.') },
      { name: 'Infiltration loss', key: 'loss', text: d('How much water the ground drinks per hour. Concrete drinks almost none; sand drinks a lot.', 'Constant loss rate f (mm/h): sealed urban 0–5, clay 1–5, sand 10–30.') },
      { name: 'Manning roughness n', key: 'manning', text: d('How rough the ground is. Water moves slowly through forest and fast over smooth roads.', 'Manning friction n (s/m^⅓): smooth urban 0.015–0.03, fields 0.035–0.05, forest ≈0.1.') },
      { name: 'Sea level rise / surge', key: 'seaLevel', text: d('Raises the sea by this many metres, like a storm surge or future sea-level rise.', 'Sets the sea-surface level above present mean sea level for DEM cells ≤ 0 m.') },
      { name: 'Domain size', key: 'domainKm', text: d('The width of the square area to simulate. Bigger areas have rougher detail.', 'Side of the square domain; cell size ≈ side/200.') },
    ],
    numbers: [
      { name: 'Area flooded > 10 cm / 50 cm / 1.5 m', text: d('How much land (in square kilometres) is under at least that much water at some moment.', 'Cells whose maximum depth exceeds the threshold; ranges ÷/× ≈ 1.5–2.') },
      { name: 'Maximum water depth', text: d('The deepest water anywhere.', 'max over cells and time of h.') },
      { name: 'Largest flooded extent at', text: d('The hour when the flood covers the most land.', 'Time of maximum flooded area.') },
      { name: 'Mass-balance error', text: d('A self-check: water in minus water out should add up. Close to 0% means the calculation is sound.', '(V_rain − V_loss − V_out + V_sea − V_stored)/V in %.') },
    ],
    limits: d('The ground map is rough (cells of 100 m or more), so drains, small streams and walls are missed. Water coming from rivers outside the area is not included.', 'No sewers, channels < cell size or defences; no upstream inflow; the DEM is partly a surface model.'),
    example: { label: 'Load: 50 mm/h rain for 3 hours near Venice', category: 'flood', params: { lat: 45.45, lon: 12.3, label: 'Near Venice', rainfall: 50, duration: 3 } },
  },

  {
    id: 'tsunami', title: 'Tsunami', kicker: 'Event 4', category: 'tsunami', scene: 'tsunami',
    intro: d(
      'A huge earthquake under the sea pushes the seafloor up, and the water above it spreads out as giant waves that cross the whole ocean. In the deep sea they are low but extremely fast; near the coast they slow down and get tall.',
      'Earthquake source (Wells & Coppersmith 1994; Hanks & Kanamori 1979) plus linear long-wave propagation on a staggered grid over real bathymetry (AWS Terrain Tiles: ETOPO1 / SRTM15+), as in the deep-ocean stage of TUNAMI / COMCOT.'),
    how: {
      simple: ['The earthquake lifts a big patch of seafloor.', 'The lifted water falls back and spreads out in all directions.', 'The deeper the sea, the faster the wave (a jet plane speed in the deep ocean).', 'Near the coast the sea is shallow: the wave slows and grows taller.'],
      scientific: ['u₀ = D sinδ, D = M₀/(μLW), μ = 3×10¹⁰ Pa; raised-cosine uplift over L×W copied to the sea surface.', '∂η/∂t + ∂M/∂x + ∂N/∂y = 0; ∂(M,N)/∂t = −g d ∇η; Δt = 0.5Δx_min/√(2 g d_max).', 'Land is a reflecting wall, water < 5 m deep is treated as land, an edge sponge absorbs waves.', 'Near-shore estimate by Green’s law: A_shore = A (d/10 m)^(1/4).']
    },
    seeTitle: d('The colours (sea level)', 'Sea-surface classes (η, above/below still water)'),
    see: SURFACE_CLASSES.filter((c) => c.label).map((c) => ({
      name: c.label, swatch: rgb(c.color),
      text: c.min >= 0.05
        ? d('The sea is higher than normal here (a wave crest). Warmer colours mean a taller wave.', 'Positive elevation η of the sea surface (crest).')
        : d('The sea is lower than normal here (a wave trough). Before the crest arrives the sea often pulls back first.', 'Negative elevation η (trough).'),
    })),
    settings: [
      { name: 'Earthquake magnitude', key: 'magnitude', text: d('How strong the earthquake is. Only very big ones (about 8.5 or more) make ocean-crossing tsunamis.', 'Mw of the thrust rupture; sets L, W, slip and uplift.') },
      { name: 'Fault strike', key: 'strike', text: d('The compass direction the crack runs. The wave is strongest sideways to it. Ocean trenches usually run along the coast.', 'Azimuth of the rupture (° from north); tsunamis beam perpendicular to strike.') },
      { name: 'Fault dip', key: 'dip', text: d('How steeply the crack slopes down. Big ocean-trench quakes are gentle, about 10–20 degrees.', 'Dip δ; subduction megathrusts dip ≈ 10–20°. Uplift ∝ sin δ.') },
      { name: 'Domain size', key: 'domainKm', text: d('How wide an area of ocean to simulate.', 'Side of the square domain (≤ 250×250 cells).') },
      { name: 'Simulated time', key: 'simHours', text: d('How many hours of waves to watch.', 'Model duration in hours.') },
    ],
    numbers: [
      { name: 'Peak initial wave (seafloor uplift)', text: d('How high the seafloor was pushed up — the first wave’s height.', 'u₀ = D sin δ, range ÷/× 2.') },
      { name: 'Average fault slip', text: d('How far the two sides of the crack slid past each other.', 'D = M₀/(μLW).') },
      { name: 'First coastal arrival', text: d('Minutes until the first wave reaches land outside the earthquake area.', 'First time |η| > 5 cm at a coast cell, outside the source area.') },
      { name: 'Largest wave at a coast cell', text: d('The tallest wave next to the coast in the simulation.', 'Maximum |η| at coastal cells (range ÷/× 2).') },
      { name: 'Near-shore estimate', text: d('A rough guess of how tall the wave becomes in shallow water.', 'Green’s law to 10 m depth; range ÷2 … ×3.') },
      { name: 'City arrival times', text: d('For listed cities near the coast: when the wave arrives and how tall it is out at sea.', 'Nearest coast cell within 60 km of each listed place.') },
    ],
    real: [
      { name: 'Tōhoku, Japan, 2011', text: d('Magnitude 9.0. A huge wave hit Japan’s coast within about half an hour.', 'Mw 9.0–9.1; rupture ≈ 400–500 km, uplift ≈ 5 m.') },
      { name: 'Indian Ocean, 2004', text: d('Magnitude 9.1. The waves crossed the whole ocean.', 'Mw 9.1 Sumatra–Andaman.') },
    ],
    limits: d('The model stops at the coast: it does not show water flooding onto land. Wave heights could be off by a factor of about 2, and a coarse map can make coastal waves look too small.', 'No inundation or run-up; no Okada subsidence lobe, friction, dispersion or Coriolis; coastal heights can be under-estimated on coarse grids.'),
    example: { label: 'Load: magnitude 9 earthquake at the Japan Trench', category: 'tsunami', params: { magnitude: 9, strike: 193, dip: 14, lat: 38.3, lon: 142.4, label: 'Japan Trench' } },
  },

  {
    id: 'volcano', title: 'Volcanic eruption', kicker: 'Event 5', category: 'volcano', scene: 'volcano',
    intro: d(
      'A volcano blasts ash high into the sky. The wind carries the ash away and it falls on the land like grey snow. Hot avalanches of ash and gas can also rush down the mountain.',
      'Tephra2-style ash fall (Bonadonna et al. 2005) with the Mastin et al. (2009) source, driven by real Open-Meteo winds aloft, plus an energy-cone (Malin & Sheridan 1982) pyroclastic-flow reach on the real DEM.'),
    how: {
      simple: ['The taller the ash column, the more material came out.', 'The wind at every height pushes the ash sideways.', 'Big grains fall fast and land close; tiny grains float and travel far.', 'The computer adds up the ash that lands in each square of the map.'],
      scientific: ['H = 2.00 V^0.241 (km, m³/s DRE) → mass flux; VEI from bulk volume (Newhall & Self 1982).', 'Release along the column: f(z) ∝ (1−z/H)e^(A(z/H−1)), A = 4, 13 grain-size classes (φ = −4…8).', 'Fall through the wind layers at Bonadonna et al. (1998) terminal velocities; landing patch σ² = 2Kt + σ₀², integrated exactly per cell (erf).', 'Energy cone: z_cone = z_vent + H_c − r·H/L must stay above the terrain.']
    },
    seeTitle: d('The colours and the dark circle', 'Ash-thickness classes and the pyroclastic zone'),
    see: [
      ...ASH_CLASSES.map((c, i) => ({
        name: `Ash ${c.label}`, swatch: rgb(c.color),
        text: [
          d('A light dusting. Dirty cars and windows.', 'Thickness 0.1–1 mm.'),
          d('Airports close and people should wear masks. Roads get slippery.', '1 mm – 1 cm: aviation and health thresholds; roads slippery.'),
          d('Crops and power lines suffer. Roads can be blocked.', '1–10 cm: crop damage, line flashover, road closure.'),
          d('Heavy. Weak roofs can collapse, especially if the ash is wet.', '> 10 cm: roof-collapse risk for weak or flat roofs when wet.'),
        ][i],
      })),
      { name: 'Dark red circle — pyroclastic flows', swatch: sev(3), text: d('The farthest a hot, fast avalanche of ash and gas could reach. Almost nothing survives it.', 'Maximum runout of the energy cone over the terrain; flows move ≈ 10–100 m/s. The Working tab gives the covered area.') },
    ],
    settings: [
      { name: 'Eruption column height', key: 'columnKm', text: d('How high the ash column rises. Higher means a much bigger eruption.', 'Plume height H above the vent; sets eruption rate (Mastin et al. 2009).') },
      { name: 'Eruption duration', key: 'durationH', text: d('How many hours it keeps erupting.', 'Steady eruption duration; total mass = flux × time.') },
      { name: 'Median grain size', key: 'medianPhi', text: d('How big the typical ash grain is. Larger numbers = finer dust that travels farther.', 'Median of a Gaussian φ distribution; d = 2^−φ mm (φ = 1 is 0.5 mm).') },
      { name: 'Grain-size spread', key: 'sigmaPhi', text: d('How mixed the sizes are: a small number means all grains are about the same size.', 'Standard deviation σφ of the grain-size distribution.') },
      { name: 'Atmospheric diffusion K', key: 'diffusion', text: d('How much the air’s swirling spreads the ash sideways as it falls.', 'Horizontal eddy diffusivity K (m²/s); fits are ≈ 1,000–10,000.') },
      { name: 'Column-collapse height', key: 'collapseKm', text: d('How high above the crater the ash falls back down and starts the hot avalanches.', 'Collapse height H_c above the vent for the energy cone.') },
      { name: 'Pyroclastic-flow mobility H/L', key: 'heimRatio', text: d('How slippery the avalanche is. A smaller number means it goes much farther.', 'Heim coefficient H/L; observed ≈ 0.1–0.3 (lower = more mobile).') },
      { name: 'Ash-fall domain size', key: 'domainKm', text: d('How wide an area of ground to calculate ash for.', 'Side of the 160×160-cell ash grid.') },
      { name: 'Winds aloft', key: 'windMode', text: d('Use today’s real winds high in the sky, or pretend the air is still.', 'Open-Meteo pressure-level winds (up to 15 levels), or calm air.') },
    ],
    numbers: [
      { name: 'Volcanic Explosivity Index (VEI)', text: d('The size of the eruption from 0 (small) to 8 (gigantic). Each step is ten times more material.', 'VEI from bulk tephra volume (Newhall & Self 1982): 10⁶ m³ = VEI 2, +1 per decade.') },
      { name: 'Eruption rate / Erupted mass', text: d('How much material comes out per second, and in total.', 'Mass flux ṁ and M = ṁ·T, range ÷/× 4.') },
      { name: 'Area with ≥ 1 mm / 1 cm / 10 cm ash', text: d('How much land (square kilometres) gets at least that much ash.', 'Area where the final deposit ≥ threshold.') },
      { name: 'Thickest deposit', text: d('The deepest ash anywhere on the map.', 'max thickness in the domain, range ÷/× 3.') },
      { name: 'Pyroclastic-flow runout and area', text: d('How far the hot avalanches could go, and how much ground they could cover.', 'Max r and terrain area under the energy cone.') },
      { name: 'City ash thickness, first ash', text: d('For listed cities: how thick the ash is and when it first arrives. No row means no ash there.', 'Ash thickness in the cell containing the city; time of first ≥ 0.1 mm.') },
    ],
    real: [
      { name: 'Mount St. Helens, 1980', text: d('A column about 24 km high. Ash fell across several states.', '≈24 km, ≈9 h: VEI 5.') },
      { name: 'Pinatubo, 1991', text: d('A column about 35 km high. It cooled the whole planet for a year.', '≈35 km: VEI 6.') },
    ],
    limits: d('One wind forecast is used for the whole eruption. The model leaves out lava, mudflows, flying rocks, gas, and ash clumping together.', 'No aggregation, plume bending, lava, lahars, ballistics or gas; constant wind; energy cone ignores valley channelling.'),
    example: { label: 'Load: Vesuvius, 25 km column for 8 hours', category: 'volcano', params: { lat: 40.821, lon: 14.426, columnKm: 25, durationH: 8, label: 'Vesuvius' } },
  },

  {
    id: 'wildfire', title: 'Wildfire', kicker: 'Event 6', category: 'wildfire', scene: 'wildfire',
    intro: d(
      'A fire starts at one point and spreads through grass, bushes or trees. Wind pushes it, slopes make it run uphill faster, and dry plants burn quickly. Water stops it.',
      'Rothermel (1972) surface-fire spread with the Albini formulation and Anderson (1982) fuel models, as in BehavePlus / FARSITE; an elliptical front (Anderson 1983) propagated over the DEM by minimum travel time.'),
    how: {
      simple: ['The computer works out how fast fire moves through the chosen plants on flat ground.', 'Wind and uphill slopes make it faster in some directions.', 'It then spreads the fire cell by cell across the real ground shape.', 'Lakes and the sea do not burn.'],
      scientific: ['R₀ = I_Rξ/(ρ_bεQ_ig); R = R₀(1 + φ_w + φ_s); φ_w = C U^B (β/β_op)^−E; φ_s = 5.275β^−0.3 tan²θ.', 'Wind and upslope vectors are added per DEM cell.', 'L/B = 0.936e^(0.2566U) + 0.461e^(−0.1548U) − 0.397; R(θ) = R_head(1−e)/(1−e cos θ).', 'Dead-fuel moisture from relative humidity and temperature (Simard 1968); flame length L_f = 0.45 I_B^0.46 (ft, BTU/ft/s).']
    },
    seeTitle: d('The colours on the map', 'Fire raster classes'),
    see: [
      { name: 'Dark brown — burned', swatch: rgb(FIRE_CLASSES[0].color), text: d('Already burned. The fire has passed.', 'Cells with arrival time more than 30 min before t.') },
      { name: 'Bright orange — active front', swatch: rgb(FIRE_CLASSES[1].color), text: d('Burning right now (it caught fire in the last 30 minutes). This is the moving edge of the fire.', 'Cells that ignited within the last 30 min of simulated time.') },
      { name: 'Flame length (in the numbers)', text: d('Under 1.2 m: people with tools can fight it. 1.2–2.4 m: needs fire engines and bulldozers. 2.4–3.4 m: very hard to control. Over 3.4 m: extreme.', 'Suppression interpretation of flame length (4, 8, 11 ft), Andrews (2018).') },
    ],
    settings: [
      { name: 'Fuel model', key: 'fuel', text: d('What is burning: short grass, tall grass, bushes, chaparral/maquis, forest litter… Each burns differently.', 'Anderson (1982) fire-behaviour fuel model: loads, surface-area-to-volume ratios, bed depth and moisture of extinction.') },
      { name: 'Weather', key: 'weather', text: d('Use today’s real wind, humidity and temperature at the spot, or type your own.', 'Open-Meteo current conditions, or the values entered below.') },
      { name: 'Burn time', key: 'hours', text: d('How many hours the fire burns with nobody fighting it.', 'Free-burning duration.') },
      { name: '10 m wind speed', key: 'windKmh', text: d('How strong the wind is. More wind = a faster, longer fire.', 'Wind at 10 m above ground; reduced to midflame by the wind adjustment factor.') },
      { name: 'Wind from', key: 'windFrom', text: d('The direction the wind comes FROM: 0 = north, 90 = east, 180 = south, 270 = west. The fire runs the opposite way.', 'Meteorological direction (°); the fire head points to windFrom + 180°.') },
      { name: 'Relative humidity', key: 'rh', text: d('How damp the air is. Dry air dries the plants, so they burn easily.', 'RH (%), used with temperature for the dead-fuel equilibrium moisture.') },
      { name: 'Air temperature', key: 'tempC', text: d('How hot the air is. Hot days dry plants out.', 'Air temperature (°C).') },
      { name: 'Live fuel moisture', key: 'liveMoisture', text: d('How much water is in living plants. In a drought it is low (60–80); fresh green plants are 150 or more.', 'Live-fuel moisture (% of dry weight); live moisture of extinction from Albini (1976).') },
      { name: 'Wind adjustment factor', key: 'waf', text: d('How much of the wind reaches the flames. Open land is about 0.4; under thick trees it is only 0.1–0.2 because the trees block wind.', 'Midflame / 10 m wind ratio: ≈ 0.4–0.5 open, 0.1–0.2 under canopy.') },
      { name: 'Domain size', key: 'domainKm', text: d('How wide an area to simulate around the starting point.', 'Side of the square terrain domain.') },
    ],
    numbers: [
      { name: 'Area burned', text: d('How much land (square kilometres) burned. If the fire reaches the edge of the map, the real area is bigger.', 'Cells with arrival ≤ burn time; range ÷/× 2.') },
      { name: 'Head-fire spread rate', text: d('How fast the fastest edge of the fire moves on flat ground, in metres per minute.', 'R on flat ground with the given wind; range ÷/× 2.') },
      { name: 'Fastest spread anywhere', text: d('The top speed once uphill slopes are included.', 'max R over burned cells (wind + slope).') },
      { name: 'Head flame length / Fireline intensity', text: d('How tall the flames are, and how much heat the edge gives off (kilowatts per metre of fire edge).', 'L_f and Byram intensity I_B = I_R·R·t_r, t_r = 384/σ.') },
      { name: 'Fire shape (length ÷ breadth)', text: d('1 means round. Bigger means a long thin egg shape, pushed by wind.', 'Anderson (1983) L/B from effective wind, capped at 8.') },
      { name: 'Dead fuel moisture', text: d('How damp the dry plant bits are. Below about 10% burns fast; above 20–30% hardly burns.', '1-h dead-fuel moisture from Simard (1968).') },
    ],
    limits: d('It assumes the same plants everywhere and the same weather for the whole run. Fire jumping ahead on wind-blown sparks, flames in the treetops and firefighters are not included — real fires can be much faster.', 'One fuel model, constant weather; no crown fire, spotting, fire–atmosphere coupling or suppression.'),
    example: { label: 'Load: fire in maquis hills near Izmir', category: 'wildfire', params: { lat: 38.4, lon: 27.33, label: 'Hills near Izmir', fuel: '4', weather: 'manual', windKmh: 30, windFrom: 270, rh: 20, tempC: 32, hours: 6 } },
  },

  {
    id: 'climate', title: 'Climate scenario', kicker: 'Event 7', category: 'climate', scene: 'climate',
    intro: d(
      'Ask: “what if the world keeps putting heat-trapping gas into the air in this way?” The Lab shows how much hotter the world, a place of your choice, and the sea could get by a year up to 2100. It is a scenario to explore, not a weather forecast.',
      'A reduced-complexity climate model: the two-layer energy-balance model (Held 2010; Geoffroy 2013) driven by approximate effective radiative forcing for the CMIP6 SSP scenarios, semi-empirical sea level, and pattern scaling for regional warming and rainfall. It is an emulator-style tool, not a general circulation model.'),
    how: {
      simple: ['Pick an emissions story (a scenario): low, middle, high or very high.', 'The computer works out how much extra heat the Earth traps each year.', 'The oceans soak up most of that heat slowly, so the air warms gradually. Warm water expands and ice melts, so the sea rises.', 'The poles and the land warm more than the oceans, so your chosen place warms more or less than the world average.', 'The map and the time bar play the years from 2015 to the year you chose.'],
      scientific: ['ERF(t) from 1750 (≈2.72 W/m² in 2019, AR6) joins the SSP pathway; the SSP number is the 2100 forcing in W/m².', 'C dT/dt = F − λT − γ(T − T_d);  C_d dT_d/dt = γ(T − T_d);  λ = F₂ₓ/ECS, F₂ₓ = 3.93 W/m².', 'Sea level: thermal expansion ≈ 1.9 mm/yr per W/m² of heat uptake, plus glaciers and ice sheets max(0, 1.75(T + 0.21)) mm/yr (fitted to the observed 1901–2018 rise and 2006–2018 rate).', 'Regional: ΔT_local = ΔT_global × pattern(latitude, land/ocean), normalised to an area-weighted mean of 1; rainfall pattern p(latitude) with mean +2 %/K.', 'Ranges: ECS − 0.5 … ECS + 1.0 (AR6 likely 2.5–4.0) and ×0.85 … ×1.2 on sea level for ice-sheet uncertainty.']
    },
    seeTitle: d('The colours on the globe', 'Map classes (warming since 1850–1900, or rainfall change)'),
    see: [
      ...WARM_CLASSES.map((c, i) => ({
        name: `Warming ${c.label}`, swatch: rgb(c.color),
        text: [
          d('A little warmer than before factories and cars (1850–1900).', 'Local warming 0.25–1 °C.'),
          d('About where the world is today.', 'Local warming 1–2 °C (global mean today ≈ 1.1 °C).'),
          d('The “2 degrees” people talk about in climate targets.', 'Local warming 2–3 °C.'),
          d('Hot summers become much harder and many ice areas shrink a lot.', 'Local warming 3–4 °C.'),
          d('Very hot. Mostly the polar regions and big landmasses in the high-emission stories.', 'Local warming 4–6 °C, typical of the Arctic and continental interiors at high emissions.'),
          d('Extreme warming, only near the poles in the very-high story.', 'Local warming above 6 °C.'),
        ][i],
      })),
      ...PRECIP_CLASSES.map((c, i) => ({
        name: `Rainfall ${c.label}`, swatch: rgb(c.color),
        text: i < 3 ? d('Less rain than before, so more dry spells. Many warm, dry regions get drier.', 'Negative precipitation change (the illustrative pattern: subtropics).') : d('More rain than before, often in heavier bursts. The tropics and the far north get wetter.', 'Positive precipitation change (the illustrative pattern: tropics and high latitudes).'),
      })),
    ],
    settings: [
      { name: 'Emissions scenario (SSP)', key: 'scenario', text: d('A story about the future. SSP1-2.6: fast cuts. SSP2-4.5: the middle road. SSP3-7.0: high emissions. SSP5-8.5: very high. The number is the extra heat-trapping push in 2100 (W/m²).', 'Shared Socioeconomic Pathway with its radiative forcing (CMIP6 ScenarioMIP): the name gives the 2100 forcing in W/m².') },
      { name: 'Show on the globe', key: 'map', text: d('Colour the whole Earth by how much warmer it gets, or by how much wetter or drier. The numbers in the results are for the place you chose.', 'Selects the raster: local warming (°C) or rainfall change (%), both since 1850–1900.') },
      { name: 'Year to look at', key: 'year', text: d('The year the results describe. The time bar plays from 2015 up to this year.', 'Target year; values are 20-year means around it (to 2100).') },
      { name: 'Climate sensitivity (ECS)', key: 'ecs', text: d('How strongly the Earth warms when the heat-trapping gas doubles. Scientists’ best guess is 3 degrees; it is probably between 2.5 and 4.', 'Equilibrium climate sensitivity. AR6: best estimate 3.0 °C, likely 2.5–4.0, very likely 2–5. Sets λ = F₂ₓ/ECS.') },
      { name: 'Extra forcing from 2030', key: 'extra', text: d('A “what if” push added on top of the story from 2030: below zero cools (like reflecting sunlight), above zero warms more.', 'Hypothetical additional effective radiative forcing, ramped in over 2030–2040 (negative: e.g. reflective aerosols; positive: extra emissions).') },
    ],
    numbers: [
      { name: 'Global warming (since 1850–1900 / 1995–2014)', text: d('How much hotter the whole world is, compared with before factories (1850–1900) and with recent times (1995–2014). The grey range comes from the climate-sensitivity guess.', 'Global-mean surface air temperature, 20-year mean around the year; range from ECS − 0.5 … ECS + 1.0.') },
      { name: 'Warming at this place', text: d('How much your chosen place warms. It is the world number times a pattern: more at the poles and on land.', 'ΔT_global × pattern(latitude, land/ocean); the pattern is qualitative, not a CMIP6 map.') },
      { name: 'Rainfall change at this place', text: d('Wetter or drier, in percent. This is the least certain number; real changes can be different, even the opposite.', 'ΔT_global × p(latitude), a zonal pattern with global mean +2 %/K (illustrative); the range is ×0.5 … ×2.') },
      { name: 'Global sea-level rise (since 1995–2014)', text: d('How many metres the ocean surface is higher. Warm water expands and melting ice adds water.', 'GMSL = thermal expansion + glaciers and ice sheets; range ×0.85 (ECS low) … ×1.2 (ECS high).') },
      { name: 'Sea-level rise rate', text: d('How fast the sea is rising in that year, in millimetres per year.', 'dH/dt in mm/yr for the year.') },
      { name: 'First reaches 1.5 °C / 2 °C in', text: d('The year the world’s long-term average passes these famous limits.', 'First year the centred 20-year mean warming reaches the level (as the IPCC reports); absent if not reached by 2090.') },
    ],
    real: [
      { name: 'Today', text: d('The world is about 1.1 degrees hotter than before factories. The sea has risen about 20 cm since 1901.', '2011–2020: ≈1.09 °C above 1850–1900; GMSL +0.20 m 1901–2018, rate ≈3.7 mm/yr in 2006–2018 (AR6).') },
      { name: 'What the model is checked against', text: d('It matches today’s measured warming and sea level, and its 2100 numbers fall inside the ranges of the big IPCC report for all four stories.', 'Observed warming and heat uptake are reproduced without tuning; the sea-level constants are fitted to the observed rise; the AR6 2081–2100 warming and 2100 sea-level ranges are an independent cross-check for all four SSPs.') },
    ],
    limits: d('It is a simple model, not a full climate model: no storms, no ocean currents, no sudden “tipping” events. The maps are rough patterns and can be wrong in many places, especially for rain. It is not a forecast; for decisions use the official IPCC reports and your national climate service.', 'No ocean dynamics, clouds, sea ice, tipping points, extremes or variability; patterns are qualitative; sea level is global-mean only and ice-sheet instabilities could add more. The coastal flood map reuses the flood engine with the sea raised by the projected rise.'),
    example: { label: 'Load: Istanbul under very high emissions, 2100', category: 'climate', params: { lat: 41.0082, lon: 28.9784, label: 'Istanbul', scenario: 'ssp585', year: 2100 } },
  },

  {
    id: 'time', title: 'Time controls', kicker: 'The time bar', scene: 'timeline',
    intro: d(
      'The bar at the bottom of the globe is a video player for the event. You can play it, pause it, go back, speed it up or jump to an important moment.',
      'Playback of the stored scenario: simulation time maps to the slider (linear before the event, logarithmic after), and every layer is re-evaluated at t.'),
    settingsTitle: d('The buttons', 'Controls'),
    settings: [
      { name: '⏮ Rewind', text: d('Go back to the start.', 'Sets t to the start of the model time span.') },
      { name: '▶ / ❚❚ Play / Pause', text: d('Starts or stops the playback.', 'Animation loop advancing t by Δwall × speed.') },
      { name: 'Speed (1× … 3600×)', text: d('1× is real time. 3600× means one hour passes every second.', 'Playback multiplier; before an impact (t < 0) the speed is capped at 2× so the seconds-long entry stays visible.') },
      { name: 'Clock (T− / T+)', text: d('How long before (T−) or after (T+) the event it is now.', 'Time relative to the event (t = 0).') },
      { name: 'Reset to final', text: d('Jump to the end, to see everything the event did.', 'Sets t to the end of the model time span.') },
      { name: 'The slider', text: d('Drag it to any moment. Before the event the bar moves evenly; after it the bar stretches so seconds, hours and days all fit.', 'Linear for t < 0 (the entry), logarithmic after: s ↔ t mapping in sim/time.ts.') },
      { name: 'Named moments (links)', text: d('Words like “Impact”, “+1 hour” or “Rain stops”. Click one to jump there.', 'Phases supplied by the engine (entry, impact, first coast reached, eruption stops…).') },
      { name: 'Status line', text: d('A sentence about what is happening right now, taken from the calculation.', 'Computed from the result series at t (e.g. altitude and speed during entry; km² flooded; coastal cells reached).') },
      { name: 'Open in Simulation Lab / Hide simulation', text: d('Open the results, or take the drawing off the globe.', 'Shows the Lab panel for the active scenario; hiding only removes the overlay.') },
    ],
    limits: d('The bar only covers times the model can actually calculate.', 'The span is limited to what each engine supports (e.g. no long-term aftermath beyond the modelled hours).'),
  },

  {
    id: 'results', title: 'Reading the results', kicker: 'The tabs',
    intro: d(
      'Under the settings you get the answers. Each tab shows the same run in a different way.',
      'The Scientific Results Laboratory: every number of a run with its working, uncertainty and sources.'),
    settingsTitle: d('The tabs and buttons', 'Tabs'),
    settings: [
      { name: 'Summary', text: d('A short story of what happened and the main numbers. A grey (low–high) after a number is the range the true value probably lies in.', 'Plain-language summary, outputs with ranges, and the inputs (fold-out).') },
      { name: 'Working', text: d('Every calculation, step by step, so you can check the maths.', 'Each step: equation, substituted values, result, unit and reference.') },
      { name: 'Zones', text: d('The list of circles or colours on the globe, with what each one means.', 'Zone radii, thresholds and front speeds, or the raster legend.') },
      { name: 'Charts', text: d('Graphs, such as speed against height or flooded area over time. The white dashed line is “now” on the time bar.', 'Computed series (entry profile, area vs time, wind profile, tide-gauge record…); the marker follows t.') },
      { name: 'Compare', text: d('All your runs side by side in one table.', 'Output table across stored scenarios, with ranges.') },
      { name: 'Sources', text: d('What the model assumes, what it leaves out, and the science papers behind it.', 'Assumptions, limitations and references; engine version and run time (reproducibility).') },
      { name: 'Export report / data', text: d('Download a readable report (.md) or the raw numbers (.json).', 'Markdown report and full SimResult JSON.') },
    ],
    numbers: [
      { name: '(low – high) after a number', text: d('The model is not exact. The true value could be anywhere in this range.', 'Uncertainty range of the scaling law, typically ÷/× 1.5–4 (see each engine).') },
      { name: 'Mass-balance error', text: d('A check that no water was created or lost by mistake. It should be close to 0%.', 'Conservation diagnostic of the solvers.') },
    ],
    limits: d('Treat results as good guesses for learning and comparing, not exact predictions.', 'Scenario-level models; compare relative changes between runs rather than trusting absolute values.'),
  },

  {
    id: 'words', title: 'Words and units', kicker: 'Glossary',
    intro: d('Short meanings of words you will see.', 'Definitions of terms and units used in the Lab.'),
    settingsTitle: d('A to Z', 'Glossary'),
    settings: [
      { name: 'Hypothetical simulation', text: d('A “what if” made by a computer from science equations. It did not happen.', 'Evidence class “simulation”.') },
      { name: 'Airburst', text: d('A space rock exploding in the air before touching the ground.', 'Break-up and energy release in the atmosphere.') },
      { name: 'Overpressure (psi, kPa)', text: d('How much harder the air pushes in a blast. 1 psi breaks windows; 5 psi knocks houses down.', 'Peak pressure above ambient; 1 psi = 6.895 kPa.') },
      { name: 'Mt TNT (megaton)', text: d('Energy measured as millions of tonnes of explosive.', '1 Mt = 4.184×10¹⁵ J.') },
      { name: 'Magnitude (Mw)', text: d('The size of an earthquake. Each +1 is about 32 times more energy.', 'Moment magnitude; energy ∝ 10^(1.5M).') },
      { name: 'Mercalli intensity (MMI)', text: d('How strongly shaking is felt and what it breaks, on a scale of I to XII.', 'Modified Mercalli scale from observed effects.') },
      { name: 'Fault', text: d('A crack in the Earth where rocks can slip.', 'A planar discontinuity along which rupture occurs.') },
      { name: 'Subduction trench', text: d('Where one piece of the Earth’s crust dives under another. The biggest earthquakes and tsunamis happen here.', 'Convergent plate boundary hosting megathrust earthquakes.') },
      { name: 'Run-up / inundation', text: d('How high and how far a wave climbs onto land. The tsunami engine does not calculate it.', 'Maximum vertical / horizontal reach of water on shore.') },
      { name: 'Green’s law', text: d('A rule of thumb: waves get taller when the water gets shallower.', 'A ∝ d^(−1/4) for long waves shoaling in slowly varying depth.') },
      { name: 'DEM / bathymetry', text: d('A height map of the land (DEM) or of the seafloor (bathymetry).', 'Digital elevation model / seafloor depth grid (AWS Terrain Tiles).') },
      { name: 'VEI', text: d('Volcano size from 0 to 8. Each step is ten times more.', 'Volcanic Explosivity Index.') },
      { name: 'Pyroclastic flow', text: d('A fast, hot avalanche of ash, gas and rock.', 'Ground-hugging density current of hot tephra and gas.') },
      { name: 'φ (phi) grain size', text: d('A scale for how fine the ash is. Bigger φ = finer dust.', 'φ = −log₂(d/1 mm).') },
      { name: 'Manning n', text: d('A number for how rough the ground is; water slows over rough ground.', 'Empirical friction coefficient (s/m^⅓).') },
      { name: 'Infiltration', text: d('Water soaking into the ground.', 'Loss of surface water to soil.') },
      { name: 'Fuel model', text: d('A recipe for what is burning (how much, how thick, how fine).', 'Anderson (1982) parameter sets for Rothermel.') },
      { name: 'Domain', text: d('The square piece of map that is calculated.', 'The computational region of a simulation.') },
      { name: 'Uncertainty range', text: d('The “between this and that” guess instead of one exact number.', 'Interval expressing model and input uncertainty.') },
    ],
  },
];

export const TOPIC_IDS = TOPICS.map((t) => t.id);
export const topicById = (id: string): HelpTopic => TOPICS.find((t) => t.id === id) ?? TOPICS[0];
export const topicForCategory = (c: SimCategory | undefined): string => TOPICS.find((t) => t.category === c)?.id ?? 'start';
