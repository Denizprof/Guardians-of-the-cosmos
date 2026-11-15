// Full records for catalog / context events.
//  1. storedFields(): every field of the record shipped in public/data (context.json, catalogs/*.json).
//  2. fetchEventDetails(): the live record from the provider's own API (USGS, NASA EONET, NOAA NCEI tsunamis).
// Parsers are total: an unexpected body yields { ok: false, reason }, never a thrown TypeError and never a
// silently empty record. Every URL goes through safeHref; every date is read as UTC.
import type { ContextEvent } from './types';
import { CATEGORY_LABEL, fmtCoord, fmtDatePrecise, fmtDateTime, isCoarseDate, parseUTC, safeHref } from './lib';

export interface DetailField {
  label: string;
  value: string;
  /** http(s) only (already passed through safeHref). */
  href?: string;
}

export interface DetailTimelineEntry {
  date: string; // formatted, UTC
  text: string;
}

export interface EventDetails {
  provider: string;
  /** The API request this record came from. */
  apiUrl: string;
  fields: DetailField[];
  /** Dated observations of the event (EONET geometry list). */
  timeline: DetailTimelineEntry[];
  /** Named sub-records (USGS products, EONET sources). */
  lists: { label: string; items: DetailField[] }[];
}

export type ParseResult = { ok: true; details: EventDetails } | { ok: false; reason: string };

export interface DetailSource {
  kind: 'usgs' | 'eonet' | 'ncei-tsunami';
  provider: string;
  apiUrl: string;
}

const EVIDENCE_TEXT: Record<string, string> = {
  reported: 'Reported event (catalog record), not satellite-confirmed',
  observation: 'Satellite observation (thermal detection)',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: number, digits = 2) => String(Number(v.toFixed(digits)));

/** "maxWaterHeight" / "num-responses" / "depth_km" -> "Max water height" / "Num responses" / "Depth km". */
export function humanizeKey(k: string): string {
  const s = k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : k;
}

/** Epoch milliseconds (USGS) -> "22 Oct 2026 14:33 UTC"; null when not a real date. */
function fmtEpoch(ms: unknown): string | null {
  if (!isNum(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : fmtDateTime(d.toISOString());
}

function fmtIso(iso: unknown): string | null {
  const s = str(iso);
  if (!s || Number.isNaN(parseUTC(s).getTime())) return null;
  return fmtDateTime(s);
}

/** Provider text may carry markup (NCEI comments are HTML): keep the words, never the tags. */
const plain = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function scalar(v: unknown): string | null {
  if (isNum(v)) return num(v, 4);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) {
    const items = v.map((x) => (isNum(x) || typeof x === 'string' ? String(x) : null)).filter((x): x is string => x !== null);
    return items.length && items.length === v.length ? items.join(', ') : null;
  }
  const s = str(v);
  return s === null ? null : plain(s) || null;
}

// ------------------------------------------------------------------------------------------------
// 1. Stored record
// ------------------------------------------------------------------------------------------------

const STORED_KNOWN = new Set(['id', 'title', 'category', 'date', 'date_precision', 'lon', 'lat', 'magnitude', 'depth_km', 'source', 'url', 'evidence', 'notes', 'size', 'deaths', 'count']);

/** Every field present in the stored record, labelled, in a stable reading order. Absent fields are not invented. */
export function storedFields(ev: ContextEvent): DetailField[] {
  const out: DetailField[] = [];
  const add = (label: string, value: string | null, href?: string) => {
    if (value !== null) out.push(href ? { label, value, href } : { label, value });
  };
  add('Type', CATEGORY_LABEL[ev.category] ?? str(ev.category));
  // a date known only to the day (or coarser) has no time: printing "00:00 UTC" would invent one
  add('Date (UTC)', ev.date_precision === 'day' || isCoarseDate(ev.date_precision) ? fmtDatePrecise(ev.date, ev.date_precision) : (fmtIso(ev.date) ?? str(ev.date)));
  add('Date precision', str(ev.date_precision));
  if (isNum(ev.lon) && isNum(ev.lat)) add('Location', fmtCoord(ev.lon, ev.lat));
  if (isNum(ev.magnitude)) add('Magnitude', `M ${num(ev.magnitude, 1)}`);
  if (isNum(ev.depth_km)) add('Depth', `${num(ev.depth_km, 1)} km`);
  if (isRecord(ev.size) && isNum(ev.size.value)) add('Size', `${num(ev.size.value)} ${str(ev.size.unit) ?? ''}`.trim());
  if (isNum(ev.deaths)) add('Deaths reported', String(ev.deaths));
  if (isNum(ev.count)) add('Detections', String(ev.count));
  add('Evidence', ev.evidence ? (EVIDENCE_TEXT[ev.evidence] ?? ev.evidence) : null);
  add('Source', str(ev.source));
  const href = safeHref(ev.url);
  if (href) add('Source link', new URL(href).hostname, href);
  add('Notes', str(ev.notes));
  add('Record id', str(ev.id));
  // Anything a future pipeline adds is still shown rather than dropped.
  for (const [k, v] of Object.entries(ev as unknown as Record<string, unknown>)) {
    if (STORED_KNOWN.has(k)) continue;
    add(humanizeKey(k), scalar(v) ?? (v === null || v === undefined ? null : JSON.stringify(v)));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// 2. Live provider records
// ------------------------------------------------------------------------------------------------

const ID_OK = /^[A-Za-z0-9_.-]{1,64}$/;

/** Which provider API (if any) holds the full record of this event. */
export function detailSource(ev: Pick<ContextEvent, 'id'>): DetailSource | null {
  const id = typeof ev.id === 'string' ? ev.id : '';
  const make = (kind: DetailSource['kind'], provider: string, url: string): DetailSource | null => {
    const apiUrl = safeHref(url);
    return apiUrl ? { kind, provider, apiUrl } : null;
  };
  let m: RegExpMatchArray | null;
  if ((m = id.match(/^usgs-(.+)$/)) && ID_OK.test(m[1])) {
    return make('usgs', 'USGS ComCat', `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${encodeURIComponent(m[1])}&format=geojson`);
  }
  if ((m = id.match(/^eonet-(.+)$/)) && ID_OK.test(m[1])) {
    return make('eonet', 'NASA EONET', `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(m[1])}`);
  }
  if ((m = id.match(/^ncei-tsu-(\d{1,9})$/))) {
    return make('ncei-tsunami', 'NOAA NCEI tsunami database', `https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events/${m[1]}`);
  }
  return null;
}

const USGS_LABELS: Record<string, string> = {
  title: 'Title', place: 'Place', mag: 'Magnitude', magType: 'Magnitude type', time: 'Origin time', updated: 'Record updated',
  felt: 'Felt reports (DYFI)', cdi: 'Max reported intensity (CDI)', mmi: 'Max instrumental intensity (MMI)', alert: 'PAGER alert level',
  status: 'Review status', tsunami: 'Tsunami flag', sig: 'Significance (0-1000+)', net: 'Preferred network', code: 'Event code',
  ids: 'Associated ids', sources: 'Contributing networks', types: 'Product types', nst: 'Stations used', dmin: 'Nearest station (deg)',
  rms: 'RMS travel-time residual (s)', gap: 'Azimuthal gap (deg)', type: 'Event type', tz: 'Timezone offset', url: 'Event page', detail: 'Detail feed',
};
const USGS_ORDER = ['title', 'place', 'mag', 'magType', 'time', 'updated', 'status', 'type', 'alert', 'tsunami', 'felt', 'cdi', 'mmi', 'sig', 'nst', 'dmin', 'rms', 'gap', 'net', 'code', 'ids', 'sources', 'types', 'url'];
const commaList = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean).join(', ');

/** USGS FDSN event query, format=geojson with eventid: a single GeoJSON Feature. */
export function parseUsgs(json: unknown, apiUrl = ''): ParseResult {
  if (!isRecord(json) || json.type !== 'Feature' || !isRecord(json.properties)) {
    return { ok: false, reason: 'USGS returned an unexpected response (not a GeoJSON event feature)' };
  }
  const p = json.properties;
  const fields: DetailField[] = [];
  const seen = new Set<string>(['products']);
  const value = (k: string, v: unknown): string | null => {
    if (k === 'time' || k === 'updated') return fmtEpoch(v);
    if (k === 'tsunami') return isNum(v) ? (v === 1 ? 'yes (event in an oceanic region; not a tsunami confirmation)' : 'no') : null;
    if ((k === 'ids' || k === 'sources' || k === 'types') && typeof v === 'string') return commaList(v) || null;
    if (k === 'mag' && isNum(v)) return `M ${num(v, 2)}`;
    return scalar(v);
  };
  for (const k of [...USGS_ORDER, ...Object.keys(p).filter((k) => !USGS_ORDER.includes(k))]) {
    if (seen.has(k) || !(k in p)) continue;
    seen.add(k);
    const v = value(k, p[k]);
    if (v === null) continue;
    const href = k === 'url' || k === 'detail' ? safeHref(p[k]) : undefined;
    if ((k === 'url' || k === 'detail') && !href) continue; // never show a non-http(s) link
    fields.push(href ? { label: USGS_LABELS[k] ?? humanizeKey(k), value: new URL(href).hostname, href } : { label: USGS_LABELS[k] ?? humanizeKey(k), value: v });
  }
  const g = isRecord(json.geometry) && Array.isArray(json.geometry.coordinates) ? json.geometry.coordinates : null;
  if (g && isNum(g[0]) && isNum(g[1])) {
    fields.splice(2, 0, { label: 'Hypocentre', value: `${fmtCoord(g[0], g[1])}${isNum(g[2]) ? ` · depth ${num(g[2], 1)} km` : ''}` });
  }
  if (!fields.length) return { ok: false, reason: 'USGS returned an event with no readable properties' };
  const products: DetailField[] = [];
  if (isRecord(p.products)) {
    for (const [type, list] of Object.entries(p.products)) {
      if (!Array.isArray(list) || !list.length) continue;
      const first = isRecord(list[0]) ? list[0] : {};
      const bits = [`${list.length} version${list.length === 1 ? '' : 's'}`, str(first.source) ? `source ${String(first.source)}` : null, fmtEpoch(first.updateTime) ? `updated ${fmtEpoch(first.updateTime)}` : null];
      products.push({ label: type, value: bits.filter(Boolean).join(' · ') });
    }
  }
  return { ok: true, details: { provider: 'USGS ComCat', apiUrl, fields, timeline: [], lists: products.length ? [{ label: 'Products', items: products }] : [] } };
}

/** NASA EONET v3 /events/<id>. */
export function parseEonet(json: unknown, apiUrl = ''): ParseResult {
  if (!isRecord(json) || !str(json.id) || !Array.isArray(json.geometry)) {
    return { ok: false, reason: 'NASA EONET returned an unexpected response (no event id or geometry list)' };
  }
  const fields: DetailField[] = [];
  const add = (label: string, value: string | null, href?: string) => {
    if (value !== null) fields.push(href ? { label, value, href } : { label, value });
  };
  add('Title', str(json.title));
  add('EONET id', str(json.id));
  add('Description', str(json.description));
  add('Status', json.closed === null || json.closed === undefined ? 'open (no end date recorded)' : `closed ${fmtIso(json.closed) ?? String(json.closed)}`);
  if (Array.isArray(json.categories)) {
    const cats = json.categories.map((c) => (isRecord(c) ? (str(c.title) ?? str(c.id)) : null)).filter(Boolean);
    if (cats.length) add('Categories', cats.join(', '));
  }
  const link = safeHref(json.link);
  if (link) add('API record', new URL(link).hostname, link);
  const sources: DetailField[] = [];
  if (Array.isArray(json.sources)) {
    for (const s of json.sources) {
      if (!isRecord(s)) continue;
      const href = safeHref(s.url);
      const label = str(s.id) ?? 'Source';
      sources.push(href ? { label, value: new URL(href).hostname, href } : { label, value: 'no link provided' });
    }
  }
  const timeline: DetailTimelineEntry[] = [];
  for (const g of json.geometry) {
    if (!isRecord(g)) continue;
    const date = fmtIso(g.date);
    if (!date) continue;
    const c = Array.isArray(g.coordinates) ? g.coordinates : [];
    const bits = [
      isNum(g.magnitudeValue) ? `${num(g.magnitudeValue)} ${str(g.magnitudeUnit) ?? ''}`.trim() : null,
      str(g.type) === 'Point' && isNum(c[0]) && isNum(c[1]) ? fmtCoord(c[0], c[1]) : str(g.type),
    ];
    timeline.push({ date, text: bits.filter(Boolean).join(' · ') || 'position recorded' });
  }
  add('Observations', `${json.geometry.length} dated geometr${json.geometry.length === 1 ? 'y' : 'ies'}`);
  return { ok: true, details: { provider: 'NASA EONET', apiUrl, fields, timeline, lists: sources.length ? [{ label: 'Sources', items: sources }] : [] } };
}

const TSUNAMI_CAUSE: Record<string, string> = {
  0: 'Unknown', 1: 'Earthquake', 2: 'Questionable earthquake', 3: 'Earthquake and landslide', 4: 'Volcano and earthquake', 5: 'Volcano',
  6: 'Volcano, earthquake and landslide', 7: 'Landslide', 8: 'Meteorological', 9: 'Explosion', 10: 'Astronomical tide',
};
const TSUNAMI_VALIDITY: Record<string, string> = { '-1': 'erroneous entry', 0: 'event that only caused a seiche', 1: 'very doubtful', 2: 'questionable', 3: 'probable', 4: 'definite' };
const NCEI_LABELS: Record<string, string> = {
  id: 'NCEI event id', locationName: 'Location', country: 'Country', area: 'Area', regionCode: 'Region code', latitude: 'Latitude', longitude: 'Longitude',
  causeCode: 'Cause', eventValidity: 'Event validity', eqMagnitude: 'Earthquake magnitude', eqDepth: 'Earthquake depth (km)', maxWaterHeight: 'Max water height (m)',
  numRunups: 'Runup observations', tsIntensity: 'Tsunami intensity (Soloviev)', tsMtIi: 'Tsunami magnitude (Iida)', tsMtAbe: 'Tsunami magnitude (Abe)',
  deaths: 'Deaths', deathsTotal: 'Deaths (total, incl. source event)', injuries: 'Injuries', injuriesTotal: 'Injuries (total)', missing: 'Missing', missingTotal: 'Missing (total)',
  damageMillionsDollars: 'Damage (million US$)', damageMillionsDollarsTotal: 'Damage (million US$, total)', housesDestroyed: 'Houses destroyed', housesDestroyedTotal: 'Houses destroyed (total)',
  housesDamaged: 'Houses damaged', housesDamagedTotal: 'Houses damaged (total)', publish: 'Published', comments: 'Comments',
  eqMagMw: 'Earthquake magnitude (Mw)', eqMagMb: 'Earthquake magnitude (mb)', eqMagMs: 'Earthquake magnitude (Ms)', eqMagUnk: 'Earthquake magnitude (type unknown)',
  warningStatusId: 'Warning status id', oceanicTsunami: 'Oceanic tsunami', earthquakeEventId: 'Linked NCEI earthquake id', volcanoEventId: 'Linked NCEI volcano event id', referenceIds: 'NCEI reference ids',
};
const NCEI_DATE_KEYS = ['year', 'month', 'day', 'hour', 'minute', 'second'];

/** NOAA NCEI hazel tsunami source event. Also accepts the paged { items: [event] } envelope. */
export function parseNceiTsunami(json: unknown, apiUrl = ''): ParseResult {
  let ev: unknown = json;
  if (isRecord(json) && Array.isArray(json.items)) ev = json.items.length === 1 ? json.items[0] : null;
  if (!isRecord(ev) || !isNum(ev.id) || !isNum(ev.year)) {
    return { ok: false, reason: 'NOAA NCEI returned an unexpected response (no tsunami event with id and year)' };
  }
  const fields: DetailField[] = [];
  const two = (v: unknown) => (isNum(v) ? String(Math.trunc(v)).padStart(2, '0') : null);
  const dateBits = [String(ev.year), two(ev.month), two(ev.day)];
  const known = dateBits.findIndex((b) => b === null);
  const day = (known === -1 ? dateBits : dateBits.slice(0, known)).join('-');
  const time = two(ev.hour) && two(ev.minute) ? ` ${two(ev.hour)}:${two(ev.minute)} UTC` : '';
  fields.push({ label: 'Date', value: `${day}${known === -1 ? time : ''}${known !== -1 ? ' (day or month not recorded)' : ''}` });
  for (const [k, v] of Object.entries(ev)) {
    if (NCEI_DATE_KEYS.includes(k)) continue;
    let value = scalar(v);
    if (value === null) continue;
    if (k === 'causeCode') value = `${TSUNAMI_CAUSE[value] ?? 'Unlisted cause'} (code ${value})`;
    if (k === 'eventValidity') value = `${TSUNAMI_VALIDITY[value] ?? 'unlisted'} (${value})`;
    fields.push({ label: NCEI_LABELS[k] ?? humanizeKey(k), value });
  }
  return { ok: true, details: { provider: 'NOAA NCEI tsunami database', apiUrl, fields, timeline: [], lists: [] } };
}

const PARSERS: Record<DetailSource['kind'], (json: unknown, apiUrl: string) => ParseResult> = {
  usgs: parseUsgs,
  eonet: parseEonet,
  'ncei-tsunami': parseNceiTsunami,
};

/**
 * Fetch the provider's full record. Rejects with a readable Error on network failure, HTTP error,
 * a non-JSON body or an unexpected shape; resolves only with a record that has content.
 */
export async function fetchEventDetails(ev: Pick<ContextEvent, 'id'>, signal?: AbortSignal): Promise<EventDetails> {
  const src = detailSource(ev);
  if (!src) throw new Error('No per-event API is available for this catalog');
  const res = await fetch(src.apiUrl, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${src.provider} request failed (HTTP ${res.status})`);
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new Error(`${src.provider} did not return JSON`);
  }
  const parsed = PARSERS[src.kind](json, src.apiUrl);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.details;
}
