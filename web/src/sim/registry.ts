// Registry of simulation engines. Categories without an engine are listed with their status, never faked.
import { impactEngine } from './impact';
import { quakeEngine } from './earthquake';
import { FLOOD_PARAMS, FLOOD_VERSION, validateFlood } from './flood';
import { TSUNAMI_PARAMS, TSUNAMI_VERSION, validateTsunami } from './tsunami';
import { runFloodScenario, type FloodRun } from './floodRun';
import { runTsunamiScenario } from './tsunamiRun';
import { VOLCANO_PARAMS, VOLCANO_VERSION, validateVolcano } from './volcano';
import { runVolcanoScenario } from './volcanoRun';
import { WILDFIRE_CHOICES, WILDFIRE_PARAMS, WILDFIRE_VERSION, validateWildfire } from './wildfire';
import { runWildfireScenario, type WildfireRunOptions } from './wildfireRun';
import { CLIMATE_CHOICES, CLIMATE_PARAMS, CLIMATE_VERSION, validateClimate } from './climate';
import { runClimateScenario } from './climateRun';
import type { SimCategory, SimEngine, SimResult, Validated, ValidationIssue } from './types';

export interface CategoryInfo {
  category: SimCategory;
  label: string;
  status: 'available' | 'planned';
  /** For planned categories: what model it needs and what blocks it. */
  plan?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEngine = SimEngine<any>;

/** The flood engine needs elevation tiles and a worker, so it runs asynchronously through sim/floodRun.ts. */
const floodEngine: AnyEngine = {
  category: 'flood', label: 'Flood (rain and sea level)', version: FLOOD_VERSION, params: FLOOD_PARAMS, choices: [], validate: validateFlood,
  run: () => { throw new Error('The flood engine runs asynchronously: use runFloodScenario().'); },
};
const tsunamiEngine: AnyEngine = {
  category: 'tsunami', label: 'Tsunami (earthquake source)', version: TSUNAMI_VERSION, params: TSUNAMI_PARAMS, choices: [], validate: validateTsunami,
  run: () => { throw new Error('The tsunami engine runs asynchronously: use runAsync().'); },
};
const volcanoEngine: AnyEngine = {
  category: 'volcano', label: 'Volcanic eruption (ash fall and pyroclastic flows)', version: VOLCANO_VERSION, params: VOLCANO_PARAMS,
  choices: [{ key: 'windMode', label: 'Winds aloft', default: 'forecast', options: [{ value: 'forecast', label: 'Current forecast (Open-Meteo)' }, { value: 'calm', label: 'Calm air (no wind)' }] }],
  validate: validateVolcano,
  run: () => { throw new Error('The volcano engine runs asynchronously: use runAsync().'); },
};
const wildfireEngine: AnyEngine = {
  category: 'wildfire', label: 'Wildfire (Rothermel surface spread)', version: WILDFIRE_VERSION, params: WILDFIRE_PARAMS, choices: WILDFIRE_CHOICES, validate: validateWildfire,
  run: () => { throw new Error('The wildfire engine runs asynchronously: use runAsync().'); },
};
const climateEngine: AnyEngine = {
  category: 'climate', label: 'Climate scenario (SSP projections)', version: CLIMATE_VERSION, params: CLIMATE_PARAMS, choices: CLIMATE_CHOICES, validate: validateClimate,
  run: () => { throw new Error('The climate engine runs asynchronously: use runAsync().'); },
};
export const ASYNC: ReadonlySet<SimCategory> = new Set(['flood', 'tsunami', 'volcano', 'wildfire', 'climate']);

/** Run an engine that needs downloaded terrain and a worker (flood, tsunami). */
export function runAsync(category: SimCategory, raw: Record<string, unknown>, opts: WildfireRunOptions = {}): Promise<FloodRun> {
  if (category === 'climate') return runClimateScenario(raw, opts);
  if (category === 'wildfire') return runWildfireScenario(raw, opts);
  if (category === 'volcano') return runVolcanoScenario(raw, opts);
  return category === 'tsunami' ? runTsunamiScenario(raw, opts) : runFloodScenario(raw, opts);
}

export const ENGINES: Partial<Record<SimCategory, AnyEngine>> = { impact: impactEngine, earthquake: quakeEngine, flood: floodEngine, tsunami: tsunamiEngine, volcano: volcanoEngine, wildfire: wildfireEngine, climate: climateEngine };

export const CATEGORIES: CategoryInfo[] = [
  { category: 'impact', label: 'Asteroid / meteor impact', status: 'available' },
  { category: 'earthquake', label: 'Earthquake', status: 'available' },
  { category: 'tsunami', label: 'Tsunami (earthquake source)', status: 'available' },
  { category: 'flood', label: 'Flood (rain and sea level)', status: 'available' },
  { category: 'volcano', label: 'Volcanic eruption (ash fall and pyroclastic flows)', status: 'available' },
  { category: 'wildfire', label: 'Wildfire (Rothermel surface spread)', status: 'available' },
  { category: 'climate', label: 'Climate scenario (SSP projections)', status: 'available' },
];

export function runSimulation(category: SimCategory, raw: Record<string, unknown>): { ok: true; result: SimResult } | { ok: false; issues: ValidationIssue[] } {
  const engine = ENGINES[category];
  if (!engine) return { ok: false, issues: [{ field: 'category', message: `No ${category} engine is implemented yet.` }] };
  if (ASYNC.has(category)) return { ok: false, issues: [{ field: 'category', message: `The ${category} engine needs terrain data: run it with runAsync().` }] };
  const v: Validated<unknown> = engine.validate(raw);
  if (!v.ok) return v;
  try {
    return { ok: true, result: engine.run(v.value) };
  } catch (e) {
    return { ok: false, issues: [{ field: 'engine', message: `The simulation failed: ${e instanceof Error ? e.message : 'unknown error'}` }] };
  }
}
