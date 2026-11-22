// The assistant's simulation tool. For a "what if" question it: reads the parameters (sim/parse.ts), resolves the
// place, validates, runs the real engine (sim/registry.ts), stores the scenario so the globe and the Simulation Lab
// show it, and returns the computed numbers as a source the answer quotes. It never writes a number itself.
import type { ContextKnowledge } from '../types';
import { parseSimRequest, simFollowUp } from '../../sim/parse';
import { runSimulation, runAsync, ENGINES, ASYNC } from '../../sim/registry';
import type { WildfireRunOptions } from '../../sim/wildfireRun';
import { simStore } from '../../sim/store';
import { compareScenarios, explainResult } from '../../sim/explain';

export type Geocoder = (q: string) => Promise<{ lat: number; lon: number; label: string } | undefined>;

export interface SimAnswer {
  knowledge: ContextKnowledge[];
  notes: string[];
  suggestions: string[];
}

const NOTE = {
  en: 'Hypothetical simulation computed in your browser by the Planetary Simulation Lab engine from published equations. It is not an observation or a forecast. Open the Lab for the full working, uncertainty and limitations.',
  tr: 'Gezegen Simülasyon Laboratuvarı motorunun yayımlanmış denklemlerle tarayıcınızda hesapladığı varsayımsal bir simülasyondur. Gözlem ya da tahmin değildir. Tüm hesap, belirsizlik ve sınırlar için Laboratuvarı açın.',
};
const SUGGEST = {
  en: ['Explain the simulation', 'What if it were twice as fast?', 'Compare the scenarios'],
  tr: ['Simülasyonu açıkla', 'İki kat hızlı olsaydı ne olurdu?', 'Senaryoları karşılaştır'],
};
/** The "what if" follow-up that makes sense for each event type (the others keep explain / compare). */
const VARIANT: Partial<Record<string, { en: string; tr: string }>> = {
  flood: { en: 'What if twice as much rain fell?', tr: 'İki kat yağmur yağsaydı ne olurdu?' },
  earthquake: { en: 'What if it were twice as strong?', tr: 'İki kat güçlü olsaydı ne olurdu?' },
  tsunami: { en: 'What if it were twice as strong?', tr: 'İki kat güçlü olsaydı ne olurdu?' },
  volcano: { en: 'What if the eruption lasted twice as long?', tr: 'Patlama iki kat uzun sürseydi ne olurdu?' },
  wildfire: { en: 'What if the wind were twice as strong?', tr: 'Rüzgâr iki kat güçlü olsaydı ne olurdu?' },
};
const suggestFor = (category: string, lang: 'en' | 'tr'): string[] => {
  const v = VARIANT[category];
  return v ? [SUGGEST[lang][0], v[lang], SUGGEST[lang][2]] : SUGGEST[lang];
};
const REF = 'https://doi.org/10.1111/j.1945-5100.2005.tb00157.x';

export async function simulationAnswer(query: string, lang: 'en' | 'tr', level: 'simple' | 'scientific', geocode?: Geocoder, demLoader?: WildfireRunOptions['demLoader'], windLoader?: WildfireRunOptions['windLoader'], weatherLoader?: WildfireRunOptions['weatherLoader']): Promise<SimAnswer | null> {
  const follow = simFollowUp(query);
  const { scenarios } = simStore.get();
  const active = simStore.active();
  if (follow === 'compare' && scenarios.length) {
    return { knowledge: [{ citation_id: 'sim:compare', title: 'Scenario comparison', text: compareScenarios(scenarios), source_label: 'Planetary Simulation Lab (hypothetical simulations)', url: scenarios[0].result.references[0].url }], notes: [NOTE[lang]], suggestions: SUGGEST[lang].slice(0, 2) };
  }
  const req = parseSimRequest(query);
  const relative = !req && !!active && /\b(twice|double|half|iki kat|yarisi|yarı)\b/i.test(query);
  if (!req && !relative) {
    if (follow === 'explain' && active) return { knowledge: [toKnowledge(active.id, explainResult(active.result, [], 'scientific'), active.result)], notes: [NOTE[lang]], suggestions: SUGGEST[lang].slice(1) };
    return null;
  }

  let category = req ? req.category : active!.category;
  let params: Record<string, unknown> = req ? { ...req.params } : { ...active!.params };
  let stated = req ? req.stated : Object.keys(params);
  if (relative && active) {
    // "what if it were twice as fast?": the previous scenario with one parameter scaled
    category = active.category;
    const f = /\b(half|yarisi|yarı)\b/i.test(query) ? 0.5 : 2;
    const key = category === 'wildfire' ? 'windKmh' : category === 'volcano' ? 'durationH' : category === 'flood' ? (/\b(sea|surge|deniz)\b/i.test(query) ? 'seaLevel' : 'rainfall') : category === 'earthquake' || category === 'tsunami' ? 'magnitude' : /(fast|speed|velocity|hızlı|hizli|hız)/i.test(query) ? 'velocity' : 'diameter';
    if (key === 'magnitude') params.magnitude = Math.min(9.5, Number(params.magnitude ?? 7) + (f > 1 ? 0.2 : -0.2)); // 2× energy ≈ +0.2 Mw
    else params[key] = Number(params[key] ?? (key === 'velocity' ? 20 : 500)) * f;
    stated = [...new Set([...stated, key])];
  }
  let placeLabel = req ? req.placeName : (params.label as string | undefined);
  if (req?.unresolved && geocode) {
    try {
      const hit = await geocode(req.unresolved);
      if (hit) { params.lat = hit.lat; params.lon = hit.lon; placeLabel = hit.label; }
    } catch { /* reported below as "no place" */ }
  }
  const notes = [NOTE[lang]];
  if (req && !placeLabel) {
    notes.push(lang === 'tr' ? 'Bir yer bulunamadı; simülasyon 0°, 0° noktasında çalıştırıldı. Konumu Laboratuvarda küre üzerinde seçebilirsiniz.' : `No location was recognised${req.unresolved ? ` ("${req.unresolved}")` : ''}, so the simulation ran at 0°, 0°. Pick the place on the globe in the Lab.`);
  }
  params.label = placeLabel;
  const run = ASYNC.has(category) ? await runAsync(category, params, { demLoader, windLoader, weatherLoader }) : runSimulation(category, params);
  if (!run.ok) {
    const msg = run.issues.map((i) => i.message).join(' ');
    return { knowledge: [{ citation_id: 'sim:invalid', title: 'Simulation not run', text: `The simulation was not run: ${msg} Nothing was calculated, so no numbers are given.`, source_label: 'Planetary Simulation Lab validation', url: REF }], notes, suggestions: [] };
  }
  const engine = ENGINES[category]!;
  // values a run fetched itself (live weather for a fire, live winds aloft for ash) are not "defaults"
  const fetched = new Set(category === 'wildfire' && params.weather !== 'manual' ? ['windKmh', 'windFrom', 'rh', 'tempC', 'weather'] : category === 'volcano' && params.windMode !== 'calm' ? ['windMode'] : []);
  const defaults = [...engine.params.map((p) => p.key), ...engine.choices.map((c) => c.key)].filter((k) => !stated.includes(k) && !fetched.has(k) && !(k === 'waterDepth' && params.target !== 'water') && !(k === 'density' && params.composition !== 'custom'));
  const sc = simStore.add({ category, params, result: run.result }, true);
  return { knowledge: [toKnowledge(sc.id, explainResult(run.result, defaults, level), run.result)], notes, suggestions: suggestFor(category, lang) };
}

function toKnowledge(id: string, text: string, r: { title: string; references: { url: string }[]; engine: string; engineVersion: string }): ContextKnowledge {
  return { citation_id: `sim:${id}`, title: r.title.slice(0, 300), text, source_label: `Planetary Simulation Lab, ${r.engine} engine v${r.engineVersion} (hypothetical simulation)`, url: r.references[0]?.url ?? REF };
}
