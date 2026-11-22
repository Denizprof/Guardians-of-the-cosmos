// Planetary Simulation Lab: shared types for every simulation engine.
// An engine is a pure function: validated inputs -> a SimResult whose every number comes from a stated equation.
// Results are always HYPOTHETICAL SIMULATIONS (evidence class "simulation"), never observations.

export type SimCategory = 'impact' | 'earthquake' | 'flood' | 'tsunami' | 'volcano' | 'wildfire' | 'climate';

export interface SimLocation {
  lat: number;
  lon: number;
  label?: string;
}

/** One step of the calculation: the equation, its inputs and its value, so the Results Lab can show the working. */
export interface CalcStep {
  id: string;
  label: string;
  /** Plain-text equation, e.g. "E = ½ m v²". */
  equation: string;
  /** The equation with numbers substituted, for display. */
  substituted?: string;
  value: number;
  unit: string;
  note?: string;
  /** Key into SimResult.references. */
  ref?: string;
}

/** A circular zone on the globe around the event, with the speed its front travels at (for the timeline). */
export interface SimZone {
  id: string;
  label: string;
  radiusKm: number;
  /** Physical front speed in km/s used to animate the zone growing (null = appears instantly). */
  frontKmS: number | null;
  /** Severity 0 (mild) .. 3 (extreme), drives colour. */
  severity: 0 | 1 | 2 | 3;
  threshold?: string;
}

export interface SimSeries {
  id: string;
  label: string;
  xLabel: string;
  yLabel: string;
  points: [number, number][];
  /** Further lines drawn in the same chart (e.g. the other emissions scenarios). */
  extra?: { label: string; points: [number, number][] }[];
}

export interface SimPhase {
  id: string;
  label: string;
  /** Seconds relative to the event (negative = before impact / rupture). */
  t: number;
}

export interface SimOutput {
  id: string;
  label: string;
  value: number;
  unit: string;
  /** Low/high estimate, when the model gives an uncertainty range. */
  range?: [number, number];
  alt?: string;
}

export interface SimReference {
  id: string;
  label: string;
  url: string;
}

export interface SimResult {
  engine: SimCategory;
  engineVersion: string;
  /** simulation = hypothetical event; projection = model-based scenario of a future climate. */
  evidence: 'simulation' | 'projection';
  title: string;
  location: SimLocation;
  inputs: Record<string, number | string>;
  steps: CalcStep[];
  outputs: SimOutput[];
  zones: SimZone[];
  series: SimSeries[];
  phases: SimPhase[];
  /** Time span the model supports, in seconds relative to the event: [start, end]. */
  timeSpan: [number, number];
  /** Plain-language summary built only from the outputs above. */
  summary: string;
  assumptions: string[];
  limitations: string[];
  references: SimReference[];
  /** Gridded output (flood depth): frames over time on a georeferenced grid. */
  raster?: SimRaster;
  computedAt: string;
}

export interface SimRaster {
  /** depth = water depth on land (flood); sea-surface = elevation η above sea level (tsunami). */
  kind?: 'depth' | 'sea-surface' | 'thickness' | 'fire' | 'warming' | 'precip';
  /** [lon, lat] corners: top-left, top-right, bottom-right, bottom-left. */
  corners: [number, number][];
  nx: number;
  ny: number;
  /** Water depth in metres per cell (row 0 = north), at time t seconds. */
  frames: { t: number; depth: Float32Array }[];
  maxDepth: Float32Array;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export interface ParamSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  help?: string;
}

export interface ChoiceSpec {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
}

export interface SimEngine<I> {
  category: SimCategory;
  label: string;
  version: string;
  params: ParamSpec[];
  choices: ChoiceSpec[];
  validate(raw: Record<string, unknown>): Validated<I>;
  run(input: I): SimResult;
}
