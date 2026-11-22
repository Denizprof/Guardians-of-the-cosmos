// Timelines of the guide animations: each scene is a short story (steps start at `t` seconds) that loops.
// The steps are the captions under the animation and also chapter buttons; the drawing is in HelpScenes.tsx.
import type { Dual, SceneId } from './helpContent';

export interface SceneStep { t: number; text: Dual }
export interface SceneSpec {
  /** Loop length in seconds, including a short hold on the last frame. */
  duration: number;
  /** Time shown when the viewer prefers reduced motion (the finished picture). */
  still: number;
  alt: string;
  steps: SceneStep[];
}

const d = (simple: string, scientific: string): Dual => ({ simple, scientific });

export const SCENES: Record<SceneId, SceneSpec> = {
  impact: {
    duration: 12, still: 10.5,
    alt: 'Animation: a rock falls through the air and glows, hits the ground with a flash and a crater, then the view changes to a map where coloured circles spread out from the impact point.',
    steps: [
      { t: 0, text: d('A space rock speeds toward Earth.', 'Hypervelocity entry at 11–72 km/s (the Lab starts at 20 km/s).') },
      { t: 2, text: d('Rubbing against the air makes it very hot, so it glows.', 'Ram pressure ρₐv² heats and may break the body (Y = 10^(2.107+0.0624√ρ) Pa). Small bodies burst in the air; large ones reach the ground.') },
      { t: 4.4, text: d('Impact! A flash, a hole in the ground and flying rock.', 'Eᵢ = ½mvᵢ² is released; transient crater D_tc ∝ L^0.78 v^0.44 sin^(1/3)θ (Collins et al. 2005).') },
      { t: 5.4, text: d('Now the view is from above. The shockwave and the shaking spread out in circles. Solid colour = how far it has reached so far.', 'The airblast front moves at the speed of sound (≈0.34 km/s); overpressure p(r) falls with distance; shaking travels ≈5 km/s.') },
      { t: 8.6, text: d('The dashed lines show how far each effect finally reaches. Yellow is mild, dark red is the worst.', 'Dashed = final modelled radius; the true radius is uncertain by about ×/÷ 1.5–2 (the range shown in the results).') },
    ],
  },
  earthquake: {
    duration: 11, still: 9.5,
    alt: 'Animation: rock slips along a crack deep underground, waves spread upward and outward, buildings on the surface shake most right above the start and less farther away, and coloured bands on the ground show shaking strength by distance.',
    steps: [
      { t: 0, text: d('Deep underground, two blocks of rock suddenly slip past each other along a crack (a fault).', 'Rupture of a fault of length L (Wells & Coppersmith 1994) releases seismic moment M₀ = 10^(1.5Mw+9.1) N·m.') },
      { t: 1.4, text: d('Waves of shaking spread out in every direction.', 'P waves travel ≈6 km/s, S waves ≈3.5 km/s; energy log₁₀E = 1.5M + 4.8.') },
      { t: 3.6, text: d('At the surface the ground shakes. Buildings right above the start shake the most; far ones barely move.', 'Shaking decays with distance R = √(D² + h²) (h = max(14 km, depth)).') },
      { t: 6, text: d('On the map the colours show how strong the shaking is at each distance: dark red is violent, yellow is light.', 'Intensity from Atkinson & Wald (2007): MMI(M, R); bands are MMI ≥ IX/VIII, VI and IV.') },
    ],
  },
  flood: {
    duration: 12, still: 10,
    alt: 'Animation: rain falls on hills around a valley with small houses; water runs down and rises in the valley until it covers the houses, then the rain stops and the water slowly drains and soaks into the ground.',
    steps: [
      { t: 0, text: d('Heavy rain falls on the hills.', 'Uniform rain i (mm/h) over the whole domain, minus infiltration f.') },
      { t: 1.6, text: d('Water runs downhill and collects in the low land in the middle.', 'Inertial shallow-water equations (Bates et al. 2010): q⁺ = (q − g h_f Δt ∂η/∂x)/(1 + g Δt n²|q|/h_f^(7/3)).') },
      { t: 5.2, text: d('It gets deeper than the houses. On the map, darker blue means deeper water.', 'Depth classes 5–30 cm, 30 cm–1 m, 1–2 m, > 2 m of the maximum-extent raster.') },
      { t: 8.2, text: d('The rain stops. The water slowly drains away and soaks into the ground.', 'After rain: recession by infiltration f and outflow; the mass-balance error checks that no water is lost.') },
    ],
  },
  tsunami: {
    duration: 14, still: 12.6,
    alt: 'Animation: the seafloor bulges upward under the sea, a long low wave races across the deep water, grows taller as the water gets shallow near the coast, then a map view shows red and blue rings of high and low sea spreading to the coast.',
    steps: [
      { t: 0, text: d('A huge earthquake under the sea suddenly lifts the seafloor.', 'Thrust rupture: uplift u₀ = D sin δ over L×W (raised-cosine source).') },
      { t: 1.4, text: d('The lifted water spreads out as a very long wave. In the deep ocean it is only a little taller than normal but moves as fast as a jet plane.', 'Long-wave speed c = √(g d) ≈ 198 m/s ≈ 710 km/h at 4,000 m depth.') },
      { t: 5.6, text: d('Near the coast the sea is shallow, so the wave slows down and grows much taller.', 'Shoaling: Green’s law A ∝ d^(−1/4); the wavelength shortens ∝ √d.') },
      { t: 9.2, text: d('From above: red = sea higher than normal, blue = lower. The rings spread to every coast. The Lab stops at the shore.', 'η(x, y, t) from the linear long-wave equations; arrival time = first |η| > 5 cm; no run-up on land is modelled.') },
    ],
  },
  volcano: {
    duration: 15, still: 13.5,
    alt: 'Animation: a volcano shoots a tall column of ash, the wind bends the ash cloud sideways, ash falls with big grains close and fine grains far, a hot avalanche runs down the slope, and coloured bands on the ground show how thick the ash lies.',
    steps: [
      { t: 0, text: d('The volcano blasts a tall column of ash and gas into the sky.', 'Plume height H sets the eruption rate: H = 2.00 V^0.241 (Mastin et al. 2009).') },
      { t: 3, text: d('The wind blows the ash cloud sideways.', 'Winds from Open-Meteo at up to 15 pressure levels; mass released along the column with a Suzuki profile.') },
      { t: 5.4, text: d('Ash falls out. Big grains drop close to the volcano; tiny grains drift far away.', 'Terminal velocity by Reynolds regime (Bonadonna et al. 1998); landing patch σ² = 2Kt + σ₀².') },
      { t: 8.4, text: d('Hot avalanches of ash and gas (pyroclastic flows) can rush down the slopes.', 'Energy cone: z_vent + H_c − r·H/L must stay above the terrain (Malin & Sheridan 1982).') },
      { t: 10.6, text: d('On the ground the ash lies thick near the volcano and thin farther away. The map colours show the thickness.', 'Thickness = load / ρ_deposit (1000 kg/m³); thresholds 1 mm, 1 cm, 10 cm.') },
    ],
  },
  wildfire: {
    duration: 12, still: 10.5,
    alt: 'Animation: viewed from above, a fire starts at one point in a field of grass and bushes, spreads faster to the east with the wind into an egg shape, burning cells turn orange then dark brown, and a lake in the field does not burn.',
    steps: [
      { t: 0, text: d('A spark starts a fire at one point.', 'Ignition at the chosen point; the front is found as the minimum arrival time over the terrain.') },
      { t: 2.2, text: d('The wind pushes the fire faster downwind, so it grows into an egg shape instead of a circle.', 'Elliptical growth: R(θ) = R_head(1 − e)/(1 − e cos θ), L/B from the effective wind (Anderson 1983).') },
      { t: 5, text: d('Orange is burning right now; dark brown has already burned. Uphill slopes make it faster too.', 'R = R₀(1 + φ_w + φ_s) (Rothermel 1972); the slope vector is added to the wind vector per cell.') },
      { t: 8, text: d('Water (and bare ground) cannot burn, so the lake stops the fire.', 'Cells with elevation ≤ 0 m are not burnable; features narrower than a cell are not resolved.') },
    ],
  },
  timeline: {
    duration: 10, still: 8.6,
    alt: 'Animation: a dot moves along a time bar. Tick marks are evenly spaced before the event and then stretch apart, with named moments such as Impact, plus 1 minute, plus 1 hour and plus 1 day lighting up as the dot passes them.',
    steps: [
      { t: 0, text: d('Press ▶ and a dot moves along the time bar, like a video.', 'Playback advances t by Δwall × speed; the slider is a monotone map of t.') },
      { t: 1.4, text: d('Before the event, time moves in small even steps (seconds).', 'For t < 0 the slider is linear, so the seconds-long entry stays visible.') },
      { t: 3.8, text: d('After the event the bar stretches: minutes, hours and a whole day all fit on one bar.', 'For t ≥ 0 the slider is logarithmic: t = (T + 1)^f − 1.') },
      { t: 7, text: d('Click a named moment to jump straight to it.', 'Phases from the engine (entry, impact, +1 min, +1 h, +1 d, rain stops, first coast…).') },
    ],
  },
};

/** The step whose story is on screen at `elapsed` seconds. */
export function stepAt(spec: SceneSpec, elapsed: number): number {
  let i = 0;
  for (let k = 0; k < spec.steps.length; k++) if (spec.steps[k].t <= elapsed + 1e-6) i = k;
  return i;
}
