// Answers questions about the events on the map ("earthquakes in Japan", "the strongest earthquake", "how many
// floods") from the same catalog snapshot the globe draws (public/data/context.json). Every number in an answer is
// counted from that file; nothing is estimated. Catalog events are reports for context, never radar analysis, and
// each answer says so.
import { fold, type Lang } from './core';

export interface CatalogEvent {
  title: string;
  category: string;
  date: string;
  magnitude?: number;
  source?: string;
  url?: string;
}
export interface CatalogCoverage {
  source?: string;
  count?: number;
  window_from?: string;
  window_to?: string;
  min_magnitude?: number;
}
export interface CatalogFile {
  events: CatalogEvent[];
  coverage?: Record<string, CatalogCoverage>;
}

export interface CatalogAnswer {
  text: string;
  sourceLabel: string;
  url: string;
}

type Category = 'earthquake' | 'flood' | 'wildfire' | 'volcano' | 'sea-ice';

const CATEGORY_WORDS: Record<Category, string[]> = {
  earthquake: ['earthquake', 'earthquakes', 'quake', 'quakes', 'seismic', 'deprem', 'depremler', 'sarsinti'],
  flood: ['flood', 'floods', 'flooding', 'sel', 'seller', 'taskin', 'taskinlar'],
  wildfire: ['wildfire', 'wildfires', 'fire', 'fires', 'yangin', 'yanginlar'],
  volcano: ['volcano', 'volcanoes', 'eruption', 'eruptions', 'volcanic', 'yanardag', 'yanardaglar', 'volkan', 'patlama', 'patlamalar'],
  'sea-ice': ['iceberg', 'icebergs', 'buzdagi', 'buzdaglari'],
};
const NAME: Record<Category, { en: [string, string]; tr: string }> = {
  earthquake: { en: ['earthquake', 'earthquakes'], tr: 'deprem' },
  flood: { en: ['flood', 'floods'], tr: 'sel' },
  wildfire: { en: ['wildfire', 'wildfires'], tr: 'orman yangını' },
  volcano: { en: ['volcano event', 'volcano events'], tr: 'yanardağ olayı' },
  'sea-ice': { en: ['iceberg', 'icebergs'], tr: 'buzdağı' },
};
const SOURCE_URL: Record<string, string> = {
  USGS: 'https://earthquake.usgs.gov/earthquakes/search/',
  'NASA EONET': 'https://eonet.gsfc.nasa.gov/',
};

const COUNT = /\b(how many|number of|count|total|kac|kac tane|sayisi)\b/;
const LATEST = /\b(latest|recent|recently|last|newest|most recent|son|en son|guncel|yakin zamanda)\b/;
const BIGGEST = /\b(biggest|largest|strongest|most powerful|highest magnitude|worst|en buyuk|en guclu|en siddetli)\b/;
const LIST = /\b(list|which|what|show|any|were there|are there|was there|is there|hangi|listele|goster|var mi|oldu mu|neler)\b/;
const CATALOG = /\b(catalog|catalogue|on the map|on the globe|markers|katalog|haritada|kurede)\b/;

// Turkish (and a few other) place names as people type them, mapped to the English name used in catalog titles.
const PLACE_ALIAS: Record<string, string> = {
  japonya: 'japan', turkiye: 'turkey', endonezya: 'indonesia', sili: 'chile', cin: 'china', rusya: 'russia', yunanistan: 'greece',
  meksika: 'mexico', filipinler: 'philippines', hindistan: 'india', italya: 'italy', ispanya: 'spain', brezilya: 'brazil', kanada: 'canada',
  avustralya: 'australia', kaliforniya: 'california', izlanda: 'iceland', ukrayna: 'ukraine', almanya: 'germany', fransa: 'france',
  portekiz: 'portugal', arjantin: 'argentina', kolombiya: 'colombia', afganistan: 'afghanistan', tayvan: 'taiwan', misir: 'egypt',
  yeni: 'new', amerika: 'united states', abd: 'united states', usa: 'united states',
};
// Words of a question that are never a place.
const NOT_PLACE = new Set(
  ('the and for with from that this what which where when were there have has been show list tell give many much most more some any all near around about over ' +
    'catalog catalogue events event map globe markers recent recently latest last newest biggest largest strongest powerful magnitude year years month months today ' +
    'happened happen happening reported report reports record records does did are was is how big strong number count total please ' +
    'world worldwide global globally general overall total whole planet earth recorded magnitude latitude longitude satellite minute january february march april june july august september october november december ' +
    'katalog olay olaylar harita kure dunya dunyada son guncel buyuk guclu siddetli tane kac hangi nerede oldu olan var yil bu yilki gecen neler listele goster')
    .split(' '),
);

const words = (s: string): string[] => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
const dayOf = (iso: string) => iso.slice(0, 10);

function categoryOf(ws: string[]): Category | undefined {
  for (const [cat, list] of Object.entries(CATEGORY_WORDS) as [Category, string[]][]) {
    // Turkish suffixes: "depremleri", "yanginlarda"
    if (ws.some((w) => list.some((c) => w === c || (c.length >= 5 && w.startsWith(c))))) return cat;
  }
  return undefined;
}

/** The place a question names, if any event title of that category contains it. */
function placeOf(ws: string[], events: CatalogEvent[], categoryWords: string[]): string | undefined {
  const titles = events.map((e) => ` ${words(e.title).join(' ')} `);
  for (let i = 0; i < ws.length; i++) {
    const raw = ws[i];
    if (raw.length < 4 || NOT_PLACE.has(raw) || categoryWords.some((c) => raw === c || (c.length >= 5 && raw.startsWith(c)))) continue;
    const candidates = [PLACE_ALIAS[raw], raw, raw.length > 6 ? raw.replace(/(daki|deki|da|de|nin|nin|in|un|ya|ye)$/, '') : undefined].filter((x): x is string => !!x && x.length >= 4);
    // two-word names first ("new zealand", "solomon islands")
    const next = ws[i + 1];
    if (next && titles.some((t) => t.includes(` ${raw} ${next} `))) return `${raw} ${next}`;
    for (const c of candidates) if (titles.some((t) => t.includes(` ${c} `))) return c;
  }
  return undefined;
}

export interface CatalogIntent {
  category?: Category;
  place?: string;
  count: boolean;
  latest: boolean;
  biggest: boolean;
  /** How strongly the question asks for catalog facts: 2 = clearly, 1 = only by naming a place, 0 = not at all. */
  strength: 0 | 1 | 2;
}

/** Decide whether a question asks about the events on the map, and what it wants to know. */
export function catalogIntent(question: string, file: CatalogFile): CatalogIntent {
  const folded = ` ${words(question).join(' ')} `;
  const ws = words(question);
  const category = categoryOf(ws);
  const count = COUNT.test(folded);
  const latest = LATEST.test(folded);
  const biggest = BIGGEST.test(folded);
  const none: CatalogIntent = { category, count, latest, biggest, strength: 0 };
  if (!category) {
    // "how many events are on the map?"
    return count && /\b(event|events|olay|olaylar)\b/.test(folded) && CATALOG.test(folded) ? { ...none, strength: 2 } : none;
  }
  const pool = file.events.filter((e) => e.category === category);
  const place = placeOf(ws, pool, CATEGORY_WORDS[category]) ?? namedPlace(folded, CATEGORY_WORDS[category], /[^a-z0-9 ]/.test(question.toLowerCase().replace(/['’]/g, '')) || /\b(deprem|sel|taskin|yangin|yanardag|volkan|buzdag)/.test(folded));
  if (count || latest || biggest) return { category, place, count, latest, biggest, strength: 2 };
  if (place && (LIST.test(folded) || ws.length <= 4)) return { category, place, count, latest, biggest, strength: 1 };
  if (CATALOG.test(folded) && LIST.test(folded)) return { category, place, count, latest, biggest, strength: 2 };
  return { ...none, place };
}

/** A place the question names after "in", "near"... (or with a Turkish -da/-de suffix), whether or not the catalog has it. */
function namedPlace(folded: string, categoryWords: string[], turkish: boolean): string | undefined {
  const isPlace = (w: string | undefined): w is string => !!w && w.length >= 4 && !NOT_PLACE.has(w) && !categoryWords.some((c) => w === c || (c.length >= 5 && w.startsWith(c)));
  const en = /\b(?:in|near|around|off)\s+(?:the\s+)?([a-z]+)/.exec(folded)?.[1];
  if (isPlace(en)) return PLACE_ALIAS[en] ?? en;
  // Turkish locative ("izlanda'da", "japonyadaki"): only for a Turkish question, and only a whole word
  if (!turkish) return undefined;
  for (const w of folded.trim().split(/\s+/)) {
    if (NOT_PLACE.has(w)) continue;
    const stem = /^([a-z]{4,})(?:daki|deki|taki|teki|da|de|ta|te)$/.exec(w)?.[1];
    if (isPlace(stem)) return PLACE_ALIAS[stem] ?? stem;
  }
  return undefined;
}

const cap = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Compose the answer for a catalog question. Returns undefined when the question is not about the catalog. */
export function answerFromCatalog(question: string, file: CatalogFile, lang: Lang, intent: CatalogIntent = catalogIntent(question, file)): CatalogAnswer | undefined {
  if (intent.strength === 0) return undefined;
  const tr = lang === 'tr';
  const note = tr
    ? 'Bunlar bağlam için gösterilen katalog kayıtlarıdır; radar analizi değildir.'
    : 'These are catalog reports shown for context, not radar analysis.';
  if (!intent.category) {
    const by = new Map<string, number>();
    for (const e of file.events) by.set(e.category, (by.get(e.category) ?? 0) + 1);
    const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${tr ? NAME[c as Category]?.tr ?? c : NAME[c as Category]?.en[n === 1 ? 0 : 1] ?? c}`);
    const text = tr
      ? `Haritadaki katalogda toplam ${file.events.length} olay var: ${parts.join(', ')}. Daha fazla katalog Filtreler'den açılabilir. ${note}`
      : `The map's catalog holds ${file.events.length} events: ${parts.join(', ')}. More catalogs can be switched on in Filters. ${note}`;
    return { text, sourceLabel: 'USGS and NASA EONET catalogs (snapshot in the app)', url: SOURCE_URL['NASA EONET'] };
  }
  const cat = intent.category;
  const cov = file.coverage?.[cat] ?? {};
  const source = cov.source ?? (cat === 'earthquake' ? 'USGS' : 'NASA EONET');
  const all = file.events.filter((e) => e.category === cat);
  const place = intent.place;
  const subset = (place ? all.filter((e) => ` ${words(e.title).join(' ')} `.includes(` ${place} `)) : all).slice().sort((a, b) => b.date.localeCompare(a.date));
  const where = place ? (tr ? ` (${cap(place)})` : ` matching "${cap(place)}"`) : '';
  const window = cov.window_from && cov.window_to ? (tr ? `${cov.window_from} ile ${cov.window_to} arasında` : `between ${cov.window_from} and ${cov.window_to}`) : '';
  const minMag = cat === 'earthquake' && cov.min_magnitude ? (tr ? `, büyüklüğü ${cov.min_magnitude} ve üzeri` : ` of magnitude ${cov.min_magnitude} or more`) : '';
  const name = tr ? NAME[cat].tr : NAME[cat].en[subset.length === 1 ? 0 : 1];
  const item = (e: CatalogEvent) => `${e.title} (${dayOf(e.date)})`;
  const sentences: string[] = [];
  if (!subset.length) {
    sentences.push(
      tr
        ? `Haritadaki ${source} kataloğunda${where} ${window} kayıtlı bir ${name} yok${minMag}. Katalogda bu türden toplam ${all.length} kayıt var.`
        : `The map's ${source} catalog has no ${NAME[cat].en[1]}${where} ${window}${minMag}. It holds ${all.length} ${NAME[cat].en[1]} in total.`,
    );
  } else {
    sentences.push(
      tr
        ? `Haritadaki ${source} kataloğunda${where} ${window} ${subset.length} ${name} kayıtlı${minMag}.`
        : `The map's ${source} catalog lists ${subset.length} ${name}${where} ${window}${minMag}.`,
    );
    if (intent.biggest) {
      const withMag = subset.filter((e) => typeof e.magnitude === 'number').sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0));
      if (withMag.length) sentences.push(tr ? `En güçlüleri: ${withMag.slice(0, 3).map(item).join('; ')}.` : `The strongest: ${withMag.slice(0, 3).map(item).join('; ')}.`);
      else sentences.push(tr ? `Bu katalog olayların büyüklüğünü kaydetmez; en yenileri: ${subset.slice(0, 3).map(item).join('; ')}.` : `This catalog does not record how large each event was; the most recent are: ${subset.slice(0, 3).map(item).join('; ')}.`);
    }
    if (!intent.biggest || intent.latest) sentences.push(tr ? `En yenileri: ${subset.slice(0, 3).map(item).join('; ')}.` : `Most recent: ${subset.slice(0, 3).map(item).join('; ')}.`);
  }
  sentences.push(note);
  return {
    text: sentences.join(' ').replace(/\s+/g, ' ').trim(),
    sourceLabel: `${source} catalog (snapshot in the app)`,
    url: SOURCE_URL[source] ?? 'https://globalsar.earth/',
  };
}
