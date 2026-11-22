// The existing assistant's simulation tool: a "what if" question runs the real engine and the answer quotes only
// the engine's numbers, cited and labelled as a hypothetical simulation.
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalAssistantAdapter } from '../../../src/assistant/local/adapter';
import { buildRequest, collectCitationIds } from '../../../src/assistant/context';
import { validateResponse } from '../../../src/assistant/validate';
import { simStore } from '../../../src/sim/store';
import { runImpact } from '../../../src/sim/impact';
import { fmt } from '../../../src/sim/validate';
import type { KbFile } from '../../../src/assistant/local/core';

const KB: KbFile = { version: '1', generated: '2026-11-22', records: [
  { id: 'kb:concept-sar', topic: 't', title: 'What is SAR?', text_en: 'A radar satellite sends its own microwave pulses.', questions_en: ['What is SAR?'], source: { label: 'NASA', url: 'https://science.nasa.gov/x' } },
] };
const adapter = () => new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => undefined, loadCatalog: async () => undefined });
async function ask(a: LocalAssistantAdapter, query: string) {
  const req = await a.prepare(buildRequest({ query, locale: 'en', level: 'simple', context: {} }));
  const res = await a.query(req);
  return { req, res, allowed: collectCitationIds(req.context) };
}

describe('assistant simulation tool', () => {
  beforeEach(() => simStore.clear());

  it('runs the impact engine for the flagship question and quotes its numbers', async () => {
    const { res, allowed } = await ask(adapter(), 'What would happen if a 500-meter asteroid hit Istanbul at 20 km/s?');
    expect(res.status).toBe('ok');
    expect(validateResponse(res, allowed).ok).toBe(true);
    expect(res.answer!.text).toContain('HYPOTHETICAL SIMULATION');
    expect(res.answer!.text).toContain('Istanbul');
    expect(res.citations![0].id).toMatch(/^sim:/);
    expect(res.limitations!.join(' ')).toMatch(/not an observation/);
    const direct = runImpact({ lat: 41.0082, lon: 28.9784, diameter: 500, density: 3000, velocity: 20, angle: 45, target: 'sedimentary', waterDepth: 3000, composition: 'stony' });
    expect(res.answer!.text).toContain(fmt(direct.outputs.find((o) => o.id === 'energy')!.value));
    expect(simStore.get().scenarios).toHaveLength(1);
    expect(simStore.get().openNonce).toBeGreaterThan(0);
    expect(res.answer!.text).toMatch(/defaults were used for: .*angle/);
  });

  it('scales the last scenario, explains it and compares scenarios', async () => {
    const a = adapter();
    await ask(a, 'What if a 500 m asteroid hit Istanbul at 15 km/s?');
    const faster = await ask(a, 'What if it were twice as fast?');
    expect(faster.res.answer!.text).toContain('HYPOTHETICAL SIMULATION');
    expect(simStore.get().scenarios).toHaveLength(2);
    expect(simStore.get().scenarios[1].result.inputs.velocity_km_s).toBe(30);
    const cmp = await ask(a, 'Compare the scenarios');
    expect(cmp.res.answer!.text).toMatch(/Comparison of 2 hypothetical simulations/);
    const exp = await ask(a, 'Explain the simulation');
    expect(exp.res.answer!.text).toMatch(/How it was calculated/);
  });

  it('refuses parameters outside the model instead of inventing numbers', async () => {
    const { res } = await ask(adapter(), 'What if a 500 m asteroid hit Istanbul at 500 km/s?');
    expect(res.answer!.text).toMatch(/not run/);
    expect(simStore.get().scenarios).toHaveLength(0);
  });

  it('runs the flood solver on the terrain for a rain question', async () => {
    const dem = { nx: 30, ny: 30, dx: 100, z: Float32Array.from({ length: 900 }, (_, k) => 10 + 0.02 * ((k % 30 - 14.5) ** 2 + (Math.floor(k / 30) - 14.5) ** 2)), corners: [[0, 1], [1, 1], [1, 0], [0, 0]] as [number, number][], source: 'synthetic' };
    const a = new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => undefined, loadCatalog: async () => undefined, loadDem: async () => dem });
    const { res, allowed } = await ask(a, 'What would happen if 100 mm of rain fell on Istanbul in 2 hours?');
    expect(validateResponse(res, allowed).ok).toBe(true);
    expect(res.answer!.text).toMatch(/HYPOTHETICAL SIMULATION \(flood engine/);
    expect(res.answer!.text).toMatch(/km² under more than 10 cm/);
    expect(simStore.get().scenarios[0].result.raster).toBeDefined();
  });

  it('says nothing was calculated when terrain cannot be loaded', async () => {
    const a = new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => undefined, loadCatalog: async () => undefined, loadDem: async () => { throw new Error('offline'); } });
    const { res } = await ask(a, 'What if 100 mm of rain fell on Istanbul in 2 hours?');
    expect(res.answer!.text).toMatch(/Elevation data could not be loaded/);
    expect(simStore.get().scenarios).toHaveLength(0);
  });

  it('runs the tsunami solver for a tsunami question and reports coastal arrivals', async () => {
    // synthetic ocean around the Japan Trench: deep water east of 140.5° E, land to the west
    const nx = 120, ny = 120;
    const z = Float32Array.from({ length: nx * ny }, (_, k) => (k % nx < 25 ? 50 : -4000));
    const dem = { nx, ny, dx: 9000, z, corners: [[137.5, 43.2], [149.5, 43.2], [149.5, 33.4], [137.5, 33.4]] as [number, number][], source: 'synthetic' };
    const a = new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => undefined, loadCatalog: async () => undefined, loadDem: async () => dem });
    const { res, allowed } = await ask(a, 'What if a magnitude 9 earthquake caused a tsunami at the Japan Trench?');
    expect(validateResponse(res, allowed).ok).toBe(true);
    expect(res.answer!.text).toMatch(/HYPOTHETICAL SIMULATION \(tsunami engine/);
    expect(res.answer!.text).toMatch(/first modelled coast/);
    expect(simStore.get().scenarios[0].result.raster!.kind).toBe('sea-surface');
  });

  it('refuses a tsunami source on land', async () => {
    const dem = { nx: 40, ny: 40, dx: 9000, z: new Float32Array(1600).fill(100), corners: [[137, 43], [149, 43], [149, 33], [137, 33]] as [number, number][], source: 'synthetic' };
    const a = new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => undefined, loadCatalog: async () => undefined, loadDem: async () => dem });
    const { res } = await ask(a, 'Simulate a tsunami from the Japan Trench');
    expect(res.answer!.text).toMatch(/not at sea/);
  });

  it('runs the volcano engine with terrain and winds and reports ash fall', async () => {
    const n = 81, dx = 300;
    const z = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = Math.max(20, 1280 - 0.12 * Math.hypot(i - 40, j - 40) * dx);
    const dem = { nx: n, ny: n, dx, z, corners: [[14.1, 41.0], [14.7, 41.0], [14.7, 40.6], [14.1, 40.6]] as [number, number][], source: 'synthetic' };
    const wind = { layers: [{ z: 0, u: 5, v: 0 }, { z: 12000, u: 25, v: 0 }, { z: 30000, u: 15, v: 0 }], source: 'test winds' };
    const a = new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => undefined, loadCatalog: async () => undefined, loadDem: async () => dem, loadWind: async () => wind });
    const { res, allowed } = await ask(a, 'What would happen if Vesuvius erupted with a 20 km ash column for 6 hours?');
    expect(validateResponse(res, allowed).ok).toBe(true);
    expect(res.answer!.text).toMatch(/HYPOTHETICAL SIMULATION \(volcano engine/);
    expect(res.answer!.text).toMatch(/blowing towards 90°/);
    const r = simStore.get().scenarios[0].result;
    expect(r.raster!.kind).toBe('thickness');
    expect(r.outputs.find((o) => o.id === 'pdc')!.value).toBeGreaterThan(0);
  });

  it('runs the wildfire engine with terrain and current weather', async () => {
    const n = 101, dx = 100;
    const z = new Float32Array(n * n).fill(150);
    const dem = { nx: n, ny: n, dx, z, corners: [[27.08, 38.47], [27.2, 38.47], [27.2, 38.38], [27.08, 38.38]] as [number, number][], source: 'synthetic' };
    const a = new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => undefined, loadCatalog: async () => undefined, loadDem: async () => dem, loadWeather: async () => ({ tempC: 33, rh: 15, windKmh: 30, windFrom: 0, time: '2026-11-22T13:00' }) });
    const { res, allowed } = await ask(a, 'What would happen if a wildfire started near Izmir in maquis?');
    expect(validateResponse(res, allowed).ok).toBe(true);
    expect(res.answer!.text).toMatch(/HYPOTHETICAL SIMULATION \(wildfire engine/);
    expect(res.answer!.text).toMatch(/30 km\/h wind from 0°/);
    const r = simStore.get().scenarios[0].result;
    expect(r.raster!.kind).toBe('fire');
    expect(r.outputs.find((o) => o.id === 'burned')!.value).toBeGreaterThan(0);
  });

  it('runs the climate engine for a future-climate question and labels it a projection, not a forecast', async () => {
    const dem = { nx: 64, ny: 64, dx: 1, z: Float32Array.from({ length: 4096 }, (_, k) => ((k % 64) < 32 ? -3000 : 400)), corners: [[-180, 85], [180, 85], [180, -85], [-180, -85]] as [number, number][], source: 'synthetic' };
    const a = new LocalAssistantAdapter({ loadKb: async () => KB, loadIntent: async () => undefined, loadCatalog: async () => undefined, loadDem: async () => dem });
    const { res, allowed } = await ask(a, 'How much will temperature and sea level rise in Istanbul by 2100 under high emissions?');
    expect(validateResponse(res, allowed).ok).toBe(true);
    expect(res.answer!.text).toMatch(/CLIMATE PROJECTION SCENARIO \(climate engine/);
    expect(res.answer!.text).toMatch(/Global warming in 2100/);
    expect(res.limitations!.join(' ')).toMatch(/not a forecast/);
    const r = simStore.get().scenarios[0].result;
    expect(r.evidence).toBe('projection');
    expect(r.inputs.scenario).toBe('SSP5-8.5');
    // a follow-up moves to the next scenario up
    const hi = await ask(a, 'What if emissions were lower?');
    expect(hi.res.answer!.text).toMatch(/CLIMATE PROJECTION SCENARIO/);
    expect(simStore.get().scenarios[1].result.inputs.scenario).toBe('SSP3-7.0');
  });

  it('leaves ordinary questions to the knowledge base', async () => {
    const { res } = await ask(adapter(), 'What is SAR?');
    expect(res.citations![0].id).toBe('kb:concept-sar');
  });
});
