// Reads a simulation request out of a natural-language question, for the existing assistant.
// "What would happen if a 500-meter asteroid hit Istanbul at 20 km/s?" -> { category: 'impact', params, place }.
// Only parameters the question states are taken from it; the rest use the engine defaults, and the answer says so.
import type { SimCategory } from './types';
import { haversineKm } from './geo';

export interface Place { name: string; lat: number; lon: number; water?: boolean; depth?: number }

/** Small built-in gazetteer so common requests work offline. Coordinates: city centres / basin centroids. */
export const GAZETTEER: Place[] = [
  { name: 'Istanbul', lat: 41.0082, lon: 28.9784 }, { name: 'Ankara', lat: 39.9334, lon: 32.8597 }, { name: 'Izmir', lat: 38.4237, lon: 27.1428 },
  { name: 'London', lat: 51.5072, lon: -0.1276 }, { name: 'Paris', lat: 48.8566, lon: 2.3522 }, { name: 'Berlin', lat: 52.52, lon: 13.405 },
  { name: 'Rome', lat: 41.9028, lon: 12.4964 }, { name: 'Madrid', lat: 40.4168, lon: -3.7038 }, { name: 'Moscow', lat: 55.7558, lon: 37.6173 },
  { name: 'New York', lat: 40.7128, lon: -74.006 }, { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 }, { name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298 }, { name: 'Mexico City', lat: 19.4326, lon: -99.1332 }, { name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729 },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 }, { name: 'Beijing', lat: 39.9042, lon: 116.4074 }, { name: 'Shanghai', lat: 31.2304, lon: 121.4737 },
  { name: 'Delhi', lat: 28.6139, lon: 77.209 }, { name: 'Mumbai', lat: 19.076, lon: 72.8777 }, { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
  { name: 'Cairo', lat: 30.0444, lon: 31.2357 }, { name: 'Lagos', lat: 6.5244, lon: 3.3792 }, { name: 'Nairobi', lat: -1.2921, lon: 36.8219 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093 }, { name: 'Tehran', lat: 35.6892, lon: 51.389 }, { name: 'Kathmandu', lat: 27.7172, lon: 85.324 },
  { name: 'Lima', lat: -12.0464, lon: -77.0428 }, { name: 'Santiago', lat: -33.4489, lon: -70.6693 }, { name: 'Anchorage', lat: 61.2181, lon: -149.9003 },
  // cities near the volcanoes in VOLCANOES, so ash-fall results can name them
  { name: 'Naples', lat: 40.8518, lon: 14.2681 }, { name: 'Catania', lat: 37.5079, lon: 15.083 }, { name: 'Seattle', lat: 47.6062, lon: -122.3321 },
  { name: 'Portland', lat: 45.5152, lon: -122.6784 }, { name: 'Manila', lat: 14.5995, lon: 120.9842 }, { name: 'Kayseri', lat: 38.7205, lon: 35.4826 },
  { name: 'Reykjavik', lat: 64.1466, lon: -21.9426 }, { name: 'Yogyakarta', lat: -7.7956, lon: 110.3695 }, { name: 'Puebla', lat: 19.0414, lon: -98.2063 },
  { name: 'Van', lat: 38.5012, lon: 43.373 }, { name: 'Yerevan', lat: 40.1792, lon: 44.4991 },
  // ocean points: depth is a representative abyssal depth, stated as an assumption
  { name: 'Pacific Ocean', lat: 0, lon: -160, water: true, depth: 4000 }, { name: 'Atlantic Ocean', lat: 30, lon: -40, water: true, depth: 4000 },
  { name: 'Indian Ocean', lat: -20, lon: 80, water: true, depth: 4000 }, { name: 'Mediterranean Sea', lat: 35, lon: 18, water: true, depth: 1500 },
  { name: 'Black Sea', lat: 43, lon: 34, water: true, depth: 1200 }, { name: 'Gulf of Mexico', lat: 25, lon: -90, water: true, depth: 1600 },
];

export interface SimRequest {
  category: SimCategory;
  params: Record<string, unknown>;
  /** Parameters the question stated explicitly (the others are defaults). */
  stated: string[];
  placeName?: string;
  /** Location text that was not found in the gazetteer (to geocode). */
  unresolved?: string;
}

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

const IMPACT_WORDS = /\b(asteroids?|asteroit\w*|meteors?|meteorites?|meteoroids?|comets?|kuyruklu yildiz|goktas\w*|impactor|bolide|space rock)\b/;
const QUAKE_WORDS = /\b(earthquakes?|quakes?|deprem\w*)\b/;
const FLOOD_WORDS = /\b(floods?|flooding|inundat\w*|rain\w*|downpour|cloudburst|storm surge|sea levels?|sel\w{0,4}|taskin\w*|yagmur\w*|sagnak\w*|deniz seviyesi\w*)\b/;
const HYPOTHETICAL = /\b(what if|what would|would happen|happen if|simulat\w*|scenario|imagine|hypothetical|ne olur|olsaydi|carpsa|carparsa|dusse|dusers?e|olursa|benzet\w*)\b/;

const TSUNAMI_WORDS = /\b(tsunamis?|tsunami\w*|tidal waves?)\b/;

/** Subduction-zone sources for tsunami scenarios. Epicentres and strikes approximate the named historical events
 *  (instrumental for 2004/2010/2011; reconstructions for 365 AD and 1700). Used when a question names a coast. */
export const TSUNAMI_SOURCES: { name: string; aliases: string[]; lat: number; lon: number; strike: number; dip: number; note: string }[] = [
  { name: 'Japan Trench', aliases: ['japan trench', 'tohoku'], lat: 38.3, lon: 142.4, strike: 193, dip: 14, note: 'near the 2011 Tōhoku source' },
  { name: 'Sunda Trench', aliases: ['sunda', 'sumatra', 'indian ocean'], lat: 3.3, lon: 95.9, strike: 329, dip: 10, note: 'near the 2004 Sumatra–Andaman source' },
  { name: 'Peru–Chile Trench (central Chile)', aliases: ['chile trench', 'chile', 'maule'], lat: -36.1, lon: -73.2, strike: 18, dip: 18, note: 'near the 2010 Maule source' },
  { name: 'Peru–Chile Trench (Peru)', aliases: ['peru'], lat: -13.5, lon: -77.5, strike: 320, dip: 15, note: 'central Peru segment' },
  { name: 'Cascadia subduction zone', aliases: ['cascadia'], lat: 46.0, lon: -125.0, strike: 0, dip: 12, note: 'the 1700 Cascadia earthquake (reconstruction)' },
  { name: 'Alaska–Aleutian subduction zone', aliases: ['alaska', 'aleutian'], lat: 57.5, lon: -150.5, strike: 230, dip: 10, note: 'near the 1964 Alaska source' },
  { name: 'Middle America Trench', aliases: ['mexico', 'middle america trench'], lat: 15.8, lon: -99.5, strike: 290, dip: 15, note: 'Guerrero segment' },
  { name: 'Hellenic Arc', aliases: ['hellenic', 'crete', 'greece', 'eastern mediterranean'], lat: 34.9, lon: 23.2, strike: 315, dip: 30, note: 'the 365 AD Crete earthquake (reconstruction)' },
  { name: 'Makran subduction zone', aliases: ['makran', 'arabian sea'], lat: 24.6, lon: 62.5, strike: 270, dip: 8, note: 'the 1945 Makran earthquake region' },
];

function tsunamiSource(q: string, near?: { lat: number; lon: number }) {
  const named = TSUNAMI_SOURCES.find((s) => s.aliases.some((a) => q.includes(a)));
  if (named) return named;
  if (!near) return undefined;
  let best: (typeof TSUNAMI_SOURCES)[number] | undefined;
  let bd = 2500; // km: only a trench that could plausibly threaten the named place
  for (const s of TSUNAMI_SOURCES) { const d = haversineKm(near.lat, near.lon, s.lat, s.lon); if (d < bd) { bd = d; best = s; } }
  return best;
}

export function parseSimRequest(question: string): SimRequest | null {
  const q = fold(question);
  if (TSUNAMI_WORDS.test(q) && (HYPOTHETICAL.test(q) || /\b(magnitude|mw)\b/.test(q))) return parseTsunami(question, q);
  const volcanic = parseVolcano(q);
  if (volcanic) {
    const named = VOLCANOES.find((v) => v.aliases.some((a) => q.includes(a)));
    if (named) return { ...volcanic, params: { ...volcanic.params, lat: named.lat, lon: named.lon }, placeName: named.name };
    // no known volcano named: use a named place, or leave it for the geocoder / the default note
    const near = [...GAZETTEER].filter((p) => !p.water).sort((x, y) => y.name.length - x.name.length).find((p) => new RegExp(`\\b${fold(p.name)}`).test(q));
    if (near) return { ...volcanic, params: { ...volcanic.params, lat: near.lat, lon: near.lon }, placeName: near.name };
    return { ...volcanic, params: { ...volcanic.params, lat: 40.821, lon: 14.426 }, placeName: 'Vesuvius (no volcano was named, so Vesuvius is used)' };
  }
  const fire = parseWildfire(q);
  if (fire) return fire;
  const impact = IMPACT_WORDS.test(q);
  const quake = !impact && QUAKE_WORDS.test(q) && HYPOTHETICAL.test(q);
  const flood = !impact && !quake && FLOOD_WORDS.test(q) && HYPOTHETICAL.test(q);
  if (!impact && !quake && !flood) return null;
  if (impact && !HYPOTHETICAL.test(q) && !/\b(hit|hits|strike|strikes|struck|impact\w*|lands?|fell|falls?|crash\w*)\b/.test(q)) return null;
  const params: Record<string, unknown> = {};
  const stated: string[] = [];
  const num = (re: RegExp): number | undefined => { const m = q.match(re); return m ? Number(m[1].replace(',', '.')) : undefined; };

  if (impact) {
    const VEL = /(\d+(?:[.,]\d+)?)\s*(?:km\s*\/\s*s(?:ec|n)?|km\s*per\s*s(?:ec(?:ond)?)?|kilomet(?:er|re)s?\s*(?:per|a)\s*second)\b/;
    const v = num(VEL);
    if (v !== undefined) { params.velocity = v; stated.push('velocity'); }
    const rest = q.replace(new RegExp(VEL.source, 'g'), ' ');
    const km = rest.match(/(\d+(?:[.,]\d+)?)\s*-?\s*(?:km|kilomet(?:er|re)s?|kilometrelik)\b/);
    const m = rest.match(/(\d+(?:[.,]\d+)?)\s*-?\s*(?:m|meters?|metres?|metrelik)\b/);
    if (km) { params.diameter = Number(km[1].replace(',', '.')) * 1000; stated.push('diameter'); }
    else if (m) { params.diameter = Number(m[1].replace(',', '.')); stated.push('diameter'); }
    const a = num(/(\d+(?:[.,]\d+)?)\s*(?:°|deg(?:ree)?s?|derece)/);
    if (a !== undefined) { params.angle = a; stated.push('angle'); }
    if (/\biron|metal|demir\b/.test(q)) { params.composition = 'iron'; stated.push('composition'); }
    else if (/\bcomet|kuyruklu|ice\b/.test(q)) { params.composition = 'comet'; stated.push('composition'); }
    else if (/\bstony|rock|kaya\b/.test(q)) { params.composition = 'stony'; stated.push('composition'); }
  } else if (flood) {
    // "100 mm in 2 hours", "50 mm/h for 3 hours", "sea level rose 1 m", "2 saat boyunca saatte 40 mm"
    const total = q.match(/(\d+(?:[.,]\d+)?)\s*(?:mm|millimet\w+)[^\d]{0,40}?\b(?:in|over|within|icinde)\s*(\d+(?:[.,]\d+)?)\s*(?:h|hours?|hrs?|saat)/);
    const rate = num(/(\d+(?:[.,]\d+)?)\s*(?:mm\s*\/\s*h(?:our)?|mm\s*(?:per|an|a)\s*hour|mm\/saat)/) ?? num(/saatte\s*(\d+(?:[.,]\d+)?)\s*mm/);
    const dur = num(/(?:for|during|boyunca)?\s*(\d+(?:[.,]\d+)?)\s*(?:h|hours?|hrs?|saat)\b/);
    if (total) {
      const mm = Number(total[1].replace(',', '.'));
      const h = Number(total[2].replace(',', '.'));
      if (h > 0) { params.rainfall = Math.round((mm / h) * 10) / 10; params.duration = h; stated.push('rainfall', 'duration'); }
    } else {
      if (rate !== undefined) { params.rainfall = rate; stated.push('rainfall'); }
      if (dur !== undefined) { params.duration = dur; stated.push('duration'); }
    }
    const sl = num(/(?:sea levels?|surge|deniz seviyesi)\D{0,30}?(\d+(?:[.,]\d+)?)\s*(?:m|meters?|metres?|metre)\b/) ?? num(/(\d+(?:[.,]\d+)?)\s*(?:m|meters?|metres?|metre)\s*(?:of\s*)?(?:sea level|storm surge|surge)/);
    if (sl !== undefined) { params.seaLevel = sl; stated.push('seaLevel'); if (!stated.includes('rainfall')) { params.rainfall = 0; params.duration = 0; stated.push('rainfall', 'duration'); } }
    params.simHours = Math.min(72, Math.max(Number(params.duration ?? 3) * 2, Number(params.duration ?? 3) + 1, 6));
    stated.push('simHours');
  } else {
    const mag = num(/(?:magnitude|mw|m)\s*(\d(?:[.,]\d)?)\b/) ?? num(/(\d(?:[.,]\d)?)\s*(?:magnitude|buyuklu\w*|siddet\w*)/);
    if (mag !== undefined) { params.magnitude = mag; stated.push('magnitude'); }
    const d = num(/(\d+(?:[.,]\d+)?)\s*-?\s*km\s*(?:deep|depth|derinli\w*)/) ?? num(/depth\s*(?:of\s*)?(\d+(?:[.,]\d+)?)\s*km/);
    if (d !== undefined) { params.depth = d; stated.push('depth'); }
    if (/strike-?slip|dogrultu atimli/.test(q)) { params.fault = 'strike-slip'; stated.push('fault'); }
    else if (/thrust|reverse|ters/.test(q)) { params.fault = 'reverse'; stated.push('fault'); }
    else if (/\bnormal\b/.test(q)) { params.fault = 'normal'; stated.push('fault'); }
  }

  const coords = q.match(/(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([ns])?\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([ew])?/);
  let placeName: string | undefined;
  let unresolved: string | undefined;
  if (coords && /[.,]/.test(coords[0])) {
    const lat = Number(coords[1]) * (coords[2] === 's' ? -1 : 1);
    const lon = Number(coords[3]) * (coords[4] === 'w' ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { params.lat = lat; params.lon = lon; placeName = `${lat.toFixed(2)}, ${lon.toFixed(2)}`; }
  }
  if (params.lat === undefined) {
    const hit = [...GAZETTEER].sort((x, y) => y.name.length - x.name.length).find((p) => new RegExp(`\\b${fold(p.name)}`).test(q));
    if (hit) {
      params.lat = hit.lat; params.lon = hit.lon; placeName = hit.name;
      if (impact && hit.water) { params.target = 'water'; params.waterDepth = hit.depth; stated.push('target'); }
    } else {
      const m = question.match(/\b(?:hit|hits|strikes?|struck|on|in|into|near|at|over)\s+((?:the\s+)?[A-ZÇĞİÖŞÜ][\p{L}'-]+(?:\s+[A-ZÇĞİÖŞÜ][\p{L}'-]+){0,3})/u);
      if (m) unresolved = m[1].replace(/^the\s+/i, '');
    }
  }
  if (impact && /\b(ocean|sea|okyanus|deniz)\b/.test(q) && params.target === undefined) { params.target = 'water'; stated.push('target'); }
  if (params.lat === undefined && !unresolved) { params.lat = 0; params.lon = 0; }
  return { category: impact ? 'impact' : flood ? 'flood' : 'earthquake', params, stated, ...(placeName ? { placeName } : {}), ...(unresolved ? { unresolved } : {}) };
}

/** "Explain the simulation", "why is the crater so big", "compare the scenarios". */
export function simFollowUp(question: string): 'explain' | 'compare' | null {
  const q = fold(question);
  if (/\b(compare|comparison|versus|vs|karsilastir\w*)\b/.test(q) && /\b(scenario|simulation|senaryo|simulasyon|them|these|impacts?)\w*\b/.test(q)) return 'compare';
  if (/\b(simulation|scenario|simulasyon\w*|senaryo\w*|crater|krater|airburst|shockwave|ejecta|this impact)\b/.test(q) && /\b(explain|why|how|what|acikla|neden|nasil|ne)\b/.test(q)) return 'explain';
  return null;
}

function parseTsunami(question: string, q: string): SimRequest {
  const params: Record<string, unknown> = {};
  const stated: string[] = [];
  const mag = q.match(/(?:magnitude|mw|m)\s*(\d(?:[.,]\d)?)\b/) ?? q.match(/(\d(?:[.,]\d)?)\s*(?:magnitude|buyuklu\w*)/);
  if (mag) { params.magnitude = Number(mag[1].replace(',', '.')); stated.push('magnitude'); }
  const city = [...GAZETTEER].filter((p) => !p.water).sort((x, y) => y.name.length - x.name.length).find((p) => new RegExp(`\\b${fold(p.name)}`).test(q));
  const src = tsunamiSource(q, city);
  if (src) {
    Object.assign(params, { lat: src.lat, lon: src.lon, strike: src.strike, dip: src.dip });
    stated.push('strike', 'dip');
    return { category: 'tsunami', params, stated, placeName: `${src.name} (${src.note})${city ? `, threatening ${city.name}` : ''}` };
  }
  const coords = q.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (coords) { params.lat = Number(coords[1]); params.lon = Number(coords[2]); return { category: 'tsunami', params, stated, placeName: `${params.lat}, ${params.lon}` }; }
  void question;
  return { category: 'tsunami', params: { ...params, lat: 38.3, lon: 142.4, strike: 193, dip: 14 }, stated, placeName: 'Japan Trench (no source was named, so the 2011 Tōhoku source region is used)' };
}

const VOLCANO_WORDS = /\b(volcano\w*|erupt\w*|ash ?fall|ash cloud|pyroclastic|yanardag\w*|volkan\w*|puskur\w*|patlama\w*)\b/;

/** Column height (km above vent) that gives a VEI's mid-decade bulk volume over `hours`, via Mastin et al. (2009). */
export function columnForVei(veiN: number, hours: number): number {
  const bulk = 10 ** (veiN + 4.5); // m³, mid-decade of the VEI class
  const vDre = (bulk * 1000) / 2500 / (hours * 3600); // deposit 1000 kg/m³ → dense rock 2500 kg/m³
  return Math.min(45, Math.max(2, 2.0 * vDre ** 0.241));
}

export function parseVolcano(q: string): SimRequest | null {
  if (!VOLCANO_WORDS.test(q) || !HYPOTHETICAL.test(q)) return null;
  // lazy import cycle guard: the volcano list lives in volcano.ts, which imports this module
  const params: Record<string, unknown> = {};
  const stated: string[] = [];
  const hours = q.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hours?|hrs?|saat)\b/);
  if (hours) { params.durationH = Number(hours[1].replace(',', '.')); stated.push('durationH'); }
  const col = q.match(/(\d+(?:[.,]\d+)?)\s*-?\s*(?:km|kilomet\w+)\s*(?:high|tall|column|plume|ash column|yuksek\w*)/) ?? q.match(/(?:column|plume)\D{0,20}(\d+(?:[.,]\d+)?)\s*km/);
  const veiM = q.match(/\bvei\s*-?\s*(\d)\b/);
  if (col) { params.columnKm = Number(col[1].replace(',', '.')); stated.push('columnKm'); }
  else if (veiM) { params.columnKm = Number(columnForVei(Number(veiM[1]), Number(params.durationH ?? 6)).toFixed(1)); stated.push('columnKm'); }
  if (/\b(calm|no wind|ruzgarsiz)\b/.test(q)) { params.windMode = 'calm'; stated.push('windMode'); }
  return { category: 'volcano', params, stated };
}

/** Well-known volcanoes (approximate summit coordinates, Smithsonian GVP), so questions can name them. */
export const VOLCANOES: { name: string; aliases: string[]; lat: number; lon: number }[] = [
  { name: 'Vesuvius', aliases: ['vesuvius', 'vezuv'], lat: 40.821, lon: 14.426 },
  { name: 'Etna', aliases: ['etna'], lat: 37.748, lon: 14.999 },
  { name: 'Mount St. Helens', aliases: ['st. helens', 'st helens', 'saint helens'], lat: 46.2, lon: -122.18 },
  { name: 'Mount Rainier', aliases: ['rainier'], lat: 46.853, lon: -121.76 },
  { name: 'Pinatubo', aliases: ['pinatubo'], lat: 15.13, lon: 120.35 },
  { name: 'Mount Fuji', aliases: ['fuji'], lat: 35.361, lon: 138.728 },
  { name: 'Krakatau', aliases: ['krakatau', 'krakatoa'], lat: -6.102, lon: 105.423 },
  { name: 'Tambora', aliases: ['tambora'], lat: -8.25, lon: 118.0 },
  { name: 'Merapi', aliases: ['merapi'], lat: -7.54, lon: 110.446 },
  { name: 'Eyjafjallajökull', aliases: ['eyjafjallajokull', 'eyjafjalla'], lat: 63.63, lon: -19.62 },
  { name: 'Popocatépetl', aliases: ['popocatepetl'], lat: 19.023, lon: -98.622 },
  { name: 'Erciyes', aliases: ['erciyes'], lat: 38.531, lon: 35.447 },
  { name: 'Nemrut', aliases: ['nemrut'], lat: 38.654, lon: 42.229 },
  { name: 'Mount Ararat', aliases: ['ararat', 'agri dagi'], lat: 39.702, lon: 44.298 },
  { name: 'Hunga Tonga–Hunga Haʻapai', aliases: ['hunga tonga'], lat: -20.536, lon: -175.382 },
];

const FIRE_WORDS = /\b(wildfires?|forest fires?|bush ?fires?|brush ?fires?|grass ?fires?|wildland fire|orman yangin\w*|yangin\w*)\b/;

export function parseWildfire(q: string): SimRequest | null {
  if (!FIRE_WORDS.test(q) || !HYPOTHETICAL.test(q)) return null;
  const params: Record<string, unknown> = {};
  const stated: string[] = [];
  const wind = q.match(/(\d+(?:[.,]\d+)?)\s*(?:km\/h|kmh|km per hour|kph)/);
  if (wind) { params.windKmh = Number(wind[1].replace(',', '.')); stated.push('windKmh'); }
  const rh = q.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:relative\s*)?(?:humidity|nem)/) ?? q.match(/humidity\D{0,12}(\d+(?:[.,]\d+)?)\s*%/);
  if (rh) { params.rh = Number(rh[1].replace(',', '.')); stated.push('rh'); }
  const temp = q.match(/(-?\d+(?:[.,]\d+)?)\s*(?:°\s*c|degrees? c\w*|derece)/);
  if (temp) { params.tempC = Number(temp[1].replace(',', '.')); stated.push('tempC'); }
  const hours = q.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hours?|hrs?|saat)\b/);
  if (hours) { params.hours = Number(hours[1].replace(',', '.')); stated.push('hours'); }
  const dirs: Record<string, number> = { north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315 };
  const dir = q.match(/\b(north|northeast|east|southeast|south|southwest|west|northwest)(?:ern|erly)?\s+wind|wind\s+from\s+the\s+(north|northeast|east|southeast|south|southwest|west|northwest)\b/);
  if (dir) { params.windFrom = dirs[dir[1] ?? dir[2]]; stated.push('windFrom'); }
  if (/\b(tall grass|savanna)\b/.test(q)) { params.fuel = '3'; stated.push('fuel'); }
  else if (/\b(grass\w*|meadow|pasture|cayir)\b/.test(q)) { params.fuel = '1'; stated.push('fuel'); }
  else if (/\b(chaparral|maquis|maki|shrub\w*|scrub|brush|heath|calilik)\b/.test(q)) { params.fuel = '4'; stated.push('fuel'); }
  else if (/\b(forest|pine|timber|woodland|orman|cam)\b/.test(q)) { params.fuel = '10'; stated.push('fuel'); }
  // weather the question states is used as given; otherwise the current weather at the place is fetched
  if (wind || rh || temp) { params.weather = 'manual'; stated.push('weather'); }
  const near = [...GAZETTEER].filter((p) => !p.water).sort((x, y) => y.name.length - x.name.length).find((p) => new RegExp(`\\b${fold(p.name)}`).test(q));
  const coords = q.match(/(-?\d{1,2}\.\d+)\s*°?\s*([ns])?\s*,\s*(-?\d{1,3}\.\d+)\s*°?\s*([ew])?/);
  if (coords) {
    const lat = Number(coords[1]) * (coords[2] === 's' ? -1 : 1);
    const lon = Number(coords[3]) * (coords[4] === 'w' ? -1 : 1);
    return { category: 'wildfire', params: { ...params, lat, lon }, stated, placeName: `${lat.toFixed(3)}, ${lon.toFixed(3)}` };
  }
  if (near) return { category: 'wildfire', params: { ...params, lat: near.lat, lon: near.lon }, stated, placeName: near.name };
  // an unlisted place ("near Bodrum") is passed on to the geocoder
  const m = q.match(/\b(?:near|in|at|around|outside)\s+([a-z][\p{L}'-]+(?:\s+[a-z][\p{L}'-]+)?)\s*(?:$|[,.?!]|\bwith\b|\bin\b)/u);
  const skip = /^(the|a|an|maquis|grass|forest|chaparral|brush|shrubland|pine|summer|winter)$/;
  if (m && !skip.test(m[1].split(' ')[0])) return { category: 'wildfire', params: { ...params, lat: 0, lon: 0 }, stated, unresolved: m[1] };
  return { category: 'wildfire', params: { ...params, lat: 0, lon: 0 }, stated };
}
