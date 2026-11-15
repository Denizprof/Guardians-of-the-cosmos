// Authoritative event catalogs for the globe's context layers.
//
// Writes web/public/data/catalogs/<source>.json, each:
//   { source, provider, url, license, retrieved, count, evidence_note, events: ContextEvent-compatible[] }
// Every event keeps its own source URL. Catalogued events are REPORTED events (or satellite thermal
// detections for FIRMS); none of them is a satellite-confirmed surface change.
//
// Usage:  node pipeline/src/fetch-catalogs.mjs [source ...]     (default: all)
// Sources: noaa-tsunamis noaa-volcanoes usgs-earthquakes nasa-glc firms-fires gdacs-floods
//
// Robust by design: per-source failure isolation, retries with backoff, and a previous good
// file is never overwritten with an empty or failed result.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = path.resolve(HERE, '../../web/public/data/catalogs');

// ---------- network ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with retries/backoff (this network drops connections intermittently). */
export async function fetchRetry(url, { tries = 6, timeout = 60000 } = {}) {
  let delay = 1500;
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}${e.cause ? ` (${e.cause.message ?? e.cause})` : ''}`);
      await sleep(delay);
      delay = Math.min(delay * 2, 15000);
    }
  }
}
const fetchJson = async (url, opts) => JSON.parse(await fetchRetry(url, opts));

// ---------- helpers ----------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const validCoord = (lon, lat) => isNum(lon) && isNum(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 && !(lon === 0 && lat === 0);
const pad = (n, w = 2) => String(n).padStart(w, '0');
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Strict UTC ISO string from calendar parts, or null for impossible dates (month 13, 31 Feb, hour 25 ...). */
export function strictIso(y, mo, d, h = 0, mi = 0, s = 0) {
  if (!Number.isInteger(y) || !intIn(mo, 1, 12) || !intIn(d, 1, 31) || !intIn(h, 0, 23) || !intIn(mi, 0, 59) || !intIn(s, 0, 59)) return null;
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  t.setUTCHours(h, mi, s, 0);
  if (Number.isNaN(t.getTime()) || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString();
}

/** ISO string for a timestamp in ms, or null when it is outside the representable range. */
export const isoFromMs = (ms) => (isNum(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null);

/**
 * ISO date from possibly-partial year/month/day/hour/min/sec parts; reports the precision.
 * Invalid parts (wrong type, out of range, impossible calendar date) lower the precision instead of
 * producing an unparseable string; a non-integer year gives { date: null } and the caller skips the record.
 */
export function isoFromParts({ year, month, day, hour, minute, second }) {
  if (!Number.isInteger(year)) return { date: null, date_precision: null };
  const sec = isNum(second) && second >= 0 && second < 60 ? Math.floor(second) : 0;
  if (intIn(month, 1, 12) && intIn(day, 1, 31) && hour != null) {
    const iso = strictIso(year, month, day, hour, intIn(minute, 0, 59) ? minute : 0, sec);
    if (iso) return { date: iso, date_precision: 'minute' };
  }
  if (intIn(month, 1, 12) && intIn(day, 1, 31)) {
    const iso = strictIso(year, month, day);
    if (iso) return { date: iso, date_precision: 'day' };
  }
  const y = strictIso(year, intIn(month, 1, 12) ? month : 1, 1);
  if (!y) return { date: null, date_precision: null };
  return { date: y, date_precision: intIn(month, 1, 12) ? 'month' : 'year' };
}

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines, "" escapes). Returns array of objects. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

// ---------- normalizers (pure; unit-tested) ----------
// NCEI cause codes, from NOAA's own list: https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/descriptors/tsunami/causes
// (checked live 2026-11-15). Keep in step with TSUNAMI_CAUSE in web/src/eventDetails.ts.
const TSUNAMI_CAUSE = {
  0: 'Unknown', 1: 'Earthquake', 2: 'Questionable earthquake', 3: 'Earthquake and landslide', 4: 'Volcano and earthquake',
  5: 'Volcano, earthquake and landslide', 6: 'Volcano', 7: 'Volcano and landslide', 8: 'Landslide', 9: 'Meteorological',
  10: 'Explosion', 11: 'Astronomical tide',
};
const TSUNAMI_VALIDITY = { '-1': 'erroneous', 0: 'event only', 1: 'very doubtful', 2: 'questionable', 3: 'probable', 4: 'definite' };

/** Cause codes whose cause is established and involves an earthquake (2 = "questionable earthquake" is not). */
const QUAKE_CAUSES = new Set([1, 3, 4, 5]);

/**
 * Title of a tsunami record. It names what caused the tsunami: most records in the NCEI database are small
 * tsunamis that followed a large earthquake, and a bare "Tsunami 2026 — Panama" made a major earthquake read
 * as if it had been a tsunami only. The record stays a tsunami record (that is what NCEI catalogued).
 */
export function tsunamiTitle(t) {
  const loc = t.locationName ? titleCase(String(t.locationName)) : '';
  const country = t.country ? titleCase(String(t.country)) : '';
  // NCEI often repeats the country inside the location name ("ISLA CAÑAS, PANAMA" + "PANAMA")
  const place = loc && country && loc.toLowerCase().endsWith(country.toLowerCase()) ? loc : [loc, country].filter(Boolean).join(', ');
  const where = place ? ` — ${place}` : '';
  if (QUAKE_CAUSES.has(t.causeCode)) return `Tsunami after ${isNum(t.magnitude) ? `M ${t.magnitude}` : 'an'} earthquake, ${t.year}${where}`;
  if (t.causeCode === 6) return `Tsunami after a volcanic eruption, ${t.year}${where}`;
  if (t.causeCode === 7) return `Tsunami after a volcanic landslide, ${t.year}${where}`;
  if (t.causeCode === 8) return `Tsunami after a landslide, ${t.year}${where}`;
  if (t.causeCode === 9) return `Meteotsunami (weather-driven), ${t.year}${where}`;
  return `Tsunami ${t.year}${where}`;
}

/** NOAA NCEI Global Historical Tsunami Database (hazel API) source events. Keeps validity >= 2. */
export function normalizeTsunamis(items, { minValidity = 2, minYear = 1900 } = {}) {
  const out = [];
  for (const t of items) {
    if (!validCoord(t.longitude, t.latitude) || !isNum(t.year) || t.year < minYear) continue;
    if ((t.eventValidity ?? 0) < minValidity) continue;
    const { date, date_precision } = isoFromParts(t);
    if (!date) continue;
    const cause = TSUNAMI_CAUSE[t.causeCode] ?? 'Unknown';
    const notes = [
      `Cause: ${cause}`,
      `Validity: ${TSUNAMI_VALIDITY[t.eventValidity] ?? 'n/a'}`,
      isNum(t.numRunups) && t.numRunups > 0 ? `${t.numRunups} runup observation(s)` : null,
      isNum(t.tsIntensity) ? `Soloviev intensity ${t.tsIntensity}` : null,
      'Reported tsunami (NOAA NCEI historical database); not satellite-confirmed.',
    ].filter(Boolean).join('. ');
    const ev = {
      id: `ncei-tsu-${t.id}`,
      title: tsunamiTitle({ year: t.year, causeCode: t.causeCode, magnitude: t.eqMagnitude, locationName: t.locationName, country: t.country }),
      category: 'tsunami',
      date,
      date_precision,
      lon: t.longitude,
      lat: t.latitude,
      source: 'NOAA NCEI tsunami database',
      url: `https://www.ngdc.noaa.gov/hazel/view/hazards/tsunami/event-more-info/${t.id}`,
      evidence: 'reported',
      notes,
    };
    if (isNum(t.eqMagnitude)) ev.magnitude = t.eqMagnitude;
    if (isNum(t.maxWaterHeight)) ev.size = { value: t.maxWaterHeight, unit: 'm max water height' };
    const deaths = t.deathsTotal ?? t.deaths;
    if (isNum(deaths)) ev.deaths = deaths;
    out.push(ev);
  }
  return out;
}

const VOLC_AGENT = { S: 'Explosive/other (tephra)', W: 'Water/lahar', I: 'Ignimbrite/pyroclastic flow', F: 'Floods', M: 'Mudflows', L: 'Lava flows', A: 'Avalanche', T: 'Tsunami', G: 'Gas', P: 'Pyroclastic flows', E: 'Earthquakes', Z: 'Ashfall' };

/** NOAA NCEI Significant Volcanic Eruptions database (hazel API). */
export function normalizeVolcanoes(items, { minYear = 1900 } = {}) {
  const out = [];
  for (const v of items) {
    if (v.eruption === false || !validCoord(v.longitude, v.latitude) || !isNum(v.year) || v.year < minYear) continue;
    const { date, date_precision } = isoFromParts(v);
    if (!date) continue;
    const ev = {
      id: `ncei-vol-${v.id}`,
      title: `${v.name ?? 'Volcano'} eruption ${v.year}${v.country ? ` — ${v.country}` : ''}`,
      category: 'volcano',
      date,
      date_precision,
      lon: v.longitude,
      lat: v.latitude,
      source: 'NOAA NCEI significant eruptions',
      url: `https://www.ngdc.noaa.gov/hazel/view/hazards/volcano/event-more-info/${v.id}`,
      evidence: 'reported',
      notes: [
        v.morphology ? `Type: ${v.morphology}` : null,
        isNum(v.elevation) ? `Summit ${v.elevation} m` : null,
        v.agent ? `Hazard agents: ${String(v.agent).split(',').map((a) => VOLC_AGENT[a.trim()] ?? a.trim()).join(', ')}` : null,
        'Reported eruption (NOAA NCEI / Smithsonian GVP record); not satellite-confirmed.',
      ].filter(Boolean).join('. '),
    };
    if (isNum(v.vei)) ev.magnitude = v.vei, ev.size = { value: v.vei, unit: 'VEI' };
    const deaths = v.deathsTotal ?? v.deaths;
    if (isNum(deaths)) ev.deaths = deaths;
    out.push(ev);
  }
  return out;
}

/** USGS ComCat GeoJSON (M7+). */
export function normalizeUsgs(geojson) {
  const out = [];
  for (const f of geojson.features ?? []) {
    const [lon, lat, depth] = f.geometry?.coordinates ?? [];
    const p = f.properties ?? {};
    const date = isoFromMs(p.time);
    if (!validCoord(lon, lat) || !date) continue;
    const ev = {
      id: `usgs-${f.id}`,
      title: p.title ?? `M ${p.mag} earthquake`,
      category: 'earthquake',
      date,
      lon, lat,
      source: 'USGS ComCat',
      url: p.url,
      evidence: 'reported',
      notes: `Instrumentally located by the USGS seismic network${p.alert ? `; PAGER alert level ${p.alert}` : ''}. Seismological record, not a satellite observation.`,
    };
    if (isNum(p.mag)) ev.magnitude = p.mag, ev.size = { value: p.mag, unit: p.magType ?? 'M' };
    if (isNum(depth)) ev.depth_km = depth;
    out.push(ev);
  }
  return out;
}

/** NASA Global Landslide Catalog (COOLR / data.nasa.gov CSV rows, already parsed to objects). */
export function normalizeGlc(rows) {
  const out = [];
  for (const r of rows) {
    const lon = parseFloat(r.longitude), lat = parseFloat(r.latitude);
    const d = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}) (AM|PM))?/.exec(r.event_date ?? '');
    if (!d || !validCoord(lon, lat)) continue;
    const h12 = d[4] ? parseInt(d[4], 10) : 12;
    const h = d[4] ? (h12 % 12) + (d[7] === 'PM' ? 12 : 0) : 0;
    const date = h12 >= 1 && h12 <= 12 ? strictIso(+d[3], +d[1], +d[2], h, d[5] ? +d[5] : 0, 0) : null;
    if (!date) continue;
    const fatalities = parseInt(r.fatality_count, 10);
    const desc = (r.event_description || '').trim().slice(0, 110);
    // The export writes "12:00:00 AM" when the time of day is unknown (half of all rows), so midnight is not a time.
    const date_precision = d[4] && !(h === 0 && +d[5] === 0 && +d[6] === 0) ? 'minute' : 'day';
    const ev = {
      id: `glc-${r.event_id}`,
      title: `${cap(r.landslide_category || 'landslide')} — ${(r.event_title || r.location_description || r.country_name || '').trim().slice(0, 90)}`.replace(/ — $/, ''),
      category: 'landslide',
      date,
      date_precision,
      lon, lat,
      source: 'NASA Global Landslide Catalog',
      url: /^https?:\/\//.test(r.source_link) ? r.source_link : 'https://data.nasa.gov/dataset/global-landslide-catalog-export',
      evidence: 'reported',
      notes: [
        r.landslide_trigger && r.landslide_trigger !== 'unknown' ? `Trigger: ${r.landslide_trigger}` : null,
        r.landslide_size && r.landslide_size !== 'unknown' ? `Size class: ${r.landslide_size}` : null,
        desc || null,
        'Media-reported (NASA GLC); not satellite-confirmed.',
      ].filter(Boolean).join('. '),
    };
    if (Number.isFinite(fatalities)) ev.deaths = fatalities;
    out.push(ev);
  }
  return out;
}

/** GDACS GeoJSON event list (flood centroids). Deduplicates by eventid. */
export function normalizeGdacsFloods(features) {
  const seen = new Map();
  for (const f of features) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const from = typeof p.fromdate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.fromdate) ? p.fromdate : null;
    const date = from ? isoFromMs(Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(from) ? from : `${from}Z`)) : null;
    if (!validCoord(lon, lat) || !date || seen.has(p.eventid)) continue;
    seen.set(p.eventid, {
      id: `gdacs-fl-${p.eventid}`,
      title: `${p.name || 'Flood'}${p.alertlevel ? ` (GDACS ${p.alertlevel} alert)` : ''}`,
      category: 'flood',
      date,
      // a date-only or exactly-midnight fromdate carries no time of day
      date_precision: /^\d{4}-\d{2}-\d{2}(T00:00(:00(\.0+)?)?)?$/.test(from) ? 'day' : 'minute',
      lon, lat,
      source: 'GDACS',
      url: p.url?.report ?? 'https://www.gdacs.org/',
      evidence: 'reported',
      notes: `Flood event ${p.fromdate.slice(0, 10)} to ${(p.todate ?? '').slice(0, 10)}; alert level ${p.alertlevel ?? 'n/a'}; source ${p.source ?? 'n/a'}. Centroid point of an alert-based record (not the flooded extent); not satellite-confirmed.`,
    });
  }
  return [...seen.values()];
}

const FIRMS_PRODUCTS = [
  { key: 'noaa20', label: 'VIIRS NOAA-20', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv' },
  { key: 'noaa21', label: 'VIIRS NOAA-21', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv' },
  { key: 'modis', label: 'MODIS C6.1 (Terra/Aqua)', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv' },
];

/** low / nominal / high from VIIRS letters or MODIS percentages. */
export function confidenceClass(c) {
  const s = String(c).trim().toLowerCase();
  if (s === 'l' || s === 'low') return 'low';
  if (s === 'n' || s === 'nominal') return 'nominal';
  if (s === 'h' || s === 'high') return 'high';
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 'low';
  return n < 30 ? 'low' : n < 80 ? 'nominal' : 'high';
}

/** Aggregate raw FIRMS rows into 0.5-degree cells. `cells` is a Map shared across products. */
export function aggregateFirms(rows, label, cells = new Map(), cell = 0.5) {
  let used = 0;
  for (const r of rows) {
    const lon = parseFloat(r.longitude), lat = parseFloat(r.latitude);
    if (!validCoord(lon, lat)) continue;
    const conf = confidenceClass(r.confidence);
    if (conf === 'low') continue; // standard practice: drop low-confidence detections
    const frp = parseFloat(r.frp);
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(r.acq_date ?? '').trim());
    const tm = /^(\d{1,2})(\d{2})$/.exec(String(r.acq_time ?? '0000').trim().padStart(4, '0'));
    const t = dm && tm ? strictIso(+dm[1], +dm[2], +dm[3], +tm[1], +tm[2], 0) : null;
    if (!t) continue; // unparseable acquisition time: drop the detection rather than emit a non-date
    const ix = Math.floor((lon + 180) / cell), iy = Math.floor((lat + 90) / cell);
    const k = `${ix}:${iy}`;
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { ix, iy, n: 0, maxFrp: 0, latest: '', hi: 0, nom: 0, sensors: new Set() }));
    c.n++;
    if (Number.isFinite(frp) && frp > c.maxFrp) c.maxFrp = frp;
    if (t > c.latest) c.latest = t;
    if (conf === 'high') c.hi++; else c.nom++;
    c.sensors.add(label);
    used++;
  }
  return used;
}

export function firmsCellsToEvents(cells, { cell = 0.5, maxBytes = 1_400_000 } = {}) {
  const evs = [...cells.values()].map((c) => {
    const lon = round(-180 + (c.ix + 0.5) * cell, 3), lat = round(-90 + (c.iy + 0.5) * cell, 3);
    const conf = c.hi >= c.nom ? 'high' : 'nominal';
    return {
      id: `firms-${c.ix}-${c.iy}`,
      title: `Thermal anomalies — ${c.n} detection${c.n === 1 ? '' : 's'}, max FRP ${round(c.maxFrp, 1)} MW`,
      category: 'wildfire',
      date: c.latest,
      lon, lat,
      source: 'NASA FIRMS',
      url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lon},${lat},9z`,
      evidence: 'observation',
      size: { value: round(c.maxFrp, 1), unit: 'MW FRP (max)' },
      notes: `${c.n} satellite thermal detections in a ${cell} deg cell within the last 24 h (${[...c.sensors].join(', ')}); dominant confidence ${conf}. Thermal anomalies include non-wildfire heat sources (gas flares, volcanoes, industry); this is a detection, not a confirmed wildfire.`,
      _n: c.n,
    };
  });
  evs.sort((a, b) => b.size.value - a.size.value || b._n - a._n);
  const kept = [];
  let bytes = 0;
  for (const e of evs) {
    bytes += JSON.stringify(e).length + 2;
    if (bytes > maxBytes) break;
    kept.push(e);
  }
  const total = evs.length;
  for (const e of kept) { e.count = e._n; delete e._n; }
  return { events: kept, total_cells: total };
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/(^|[\s,(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---------- per-source fetchers ----------
async function pagedHazel(base, params, perPage = 200) {
  const items = [];
  for (let page = 1; ; page++) {
    const j = await fetchJson(`${base}?${params}&itemsPerPage=${perPage}&page=${page}`);
    // An error body (no items array) must fail the source, not silently drop a page of events.
    if (!Array.isArray(j?.items)) throw new Error(`${base} page ${page}: response has no items array`);
    items.push(...j.items);
    if (page >= (Number.isInteger(j.totalPages) ? j.totalPages : 1)) break;
  }
  return items;
}

export const SOURCES = {
  'noaa-tsunamis': {
    provider: 'NOAA National Centers for Environmental Information (NCEI/WDS) — Global Historical Tsunami Database',
    url: 'https://www.ngdc.noaa.gov/hazard/tsu_db.shtml',
    license: 'US Government work, public domain (NOAA NCEI). Cite NCEI/WDS.',
    evidence_note: 'Reported tsunami source events (validity "questionable" or better, since 1900). Not satellite-confirmed.',
    async run() {
      const items = await pagedHazel('https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events', 'minYear=1900');
      return normalizeTsunamis(items);
    },
  },
  'noaa-volcanoes': {
    provider: 'NOAA NCEI — Significant Volcanic Eruptions Database (with Smithsonian GVP)',
    url: 'https://www.ngdc.noaa.gov/hazard/volcano.shtml',
    license: 'US Government work, public domain (NOAA NCEI). Cite NCEI/WDS.',
    evidence_note: 'Reported significant eruptions since 1900. Not satellite-confirmed.',
    async run() {
      const items = await pagedHazel('https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/volcanoes', 'minYear=1900');
      return normalizeVolcanoes(items);
    },
  },
  'usgs-earthquakes': {
    provider: 'U.S. Geological Survey — ComCat (FDSN event service)',
    url: 'https://earthquake.usgs.gov/earthquakes/search/',
    license: 'US Government work, public domain (USGS).',
    evidence_note: 'M7.0+ earthquakes since 1900 from seismological networks. Not satellite observations.',
    async run() {
      const out = [];
      // The service caps responses at 20000 events; M7+ since 1900 is ~1.5k, but page in 25-year windows to stay far below any limit.
      for (let y = 1900; y <= new Date().getUTCFullYear(); y += 25) {
        const end = Math.min(y + 24, new Date().getUTCFullYear());
        const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${y}-01-01&endtime=${end + 1}-01-01&minmagnitude=7&orderby=time&limit=20000`;
        const j = await fetchJson(url);
        if (!Array.isArray(j?.features)) throw new Error(`USGS window ${y}-${end}: response has no features array`);
        out.push(...normalizeUsgs(j));
      }
      return out;
    },
  },
  'nasa-glc': {
    provider: 'NASA Goddard — Global Landslide Catalog (COOLR), via NASA Open Data Portal',
    url: 'https://data.nasa.gov/dataset/global-landslide-catalog-export',
    license: 'NASA open data (public domain); credit Kirschbaum et al., NASA GSFC.',
    evidence_note: 'Media/report-based rainfall-triggered landslide records. Not satellite-confirmed.',
    async run() {
      const csv = await fetchRetry('https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/Global_Landslide_Catalog_Export_rows.csv', { timeout: 180000 });
      return normalizeGlc(parseCsv(csv));
    },
  },
  'firms-fires': {
    provider: 'NASA FIRMS (LANCE) — VIIRS NOAA-20/21 375 m and MODIS C6.1 1 km active fire, last 24 h',
    url: 'https://firms.modaps.eosdis.nasa.gov/active_fire/',
    license: 'NASA open data; acknowledge NASA FIRMS / LANCE.',
    evidence_note: 'Satellite thermal-anomaly detections (evidence class: observation) aggregated to 0.5 deg cells, low-confidence detections dropped. Includes non-wildfire heat sources (gas flares, volcanoes, industry); not confirmed wildfires. Strongest cells kept to bound file size.',
    async run(meta) {
      const cells = new Map();
      const used = {};
      const failed = [];
      for (const p of FIRMS_PRODUCTS) {
        try {
          const csv = await fetchRetry(p.url, { timeout: 180000 });
          const rows = parseCsv(csv);
          used[p.key] = aggregateFirms(rows, p.label, cells);
          if (!used[p.key]) throw new Error('no usable detections (empty or non-CSV body)');
        } catch (e) {
          console.warn(`  FIRMS ${p.key} skipped: ${e.message}`);
          failed.push(p.key);
        }
      }
      // A snapshot with a sensor missing would look like "no fires there": fail the source and keep the previous file.
      if (failed.length) throw new Error(`FIRMS feeds missing: ${failed.join(', ')}`);
      const { events, total_cells } = firmsCellsToEvents(cells);
      meta.extra = { window: '24h', cell_deg: 0.5, detections_used: used, cells_total: total_cells, cells_kept: events.length };
      return events;
    },
  },
  'gdacs-floods': {
    provider: 'GDACS — Global Disaster Alert and Coordination System (EC JRC / UN OCHA)',
    url: 'https://www.gdacs.org/',
    license: 'GDACS data is free to use with attribution (see gdacs.org).',
    evidence_note: 'Alert-based flood events (centroid points, GloFAS/DFO-derived), not flooded extent and not satellite-confirmed.',
    async run() {
      const feats = [];
      for (let y = 2000; y <= new Date().getUTCFullYear(); y++) {
        for (let page = 1; ; page++) {
          if (page >= 30) throw new Error(`GDACS ${y}: more than 29 pages of 100; raise the page cap instead of truncating`);
          const text = await fetchRetry(`https://gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&fromdate=${y}-01-01&todate=${y}-12-31&pagenumber=${page}&pagesize=100`);
          if (!text.trim()) break; // GDACS answers "no results" with HTTP 204 and no body (checked live 2026-11-15)
          const j = JSON.parse(text);
          // An error body (no features array) must fail the source, not look like a year without floods.
          if (!Array.isArray(j?.features)) throw new Error(`GDACS ${y} page ${page}: response has no features array`);
          feats.push(...j.features);
          if (j.features.length < 100) break;
        }
      }
      return normalizeGdacsFloods(feats);
    },
  },
};

// ---------- orchestration ----------
async function writeIfGood(name, def, events, extra) {
  const file = path.join(OUT_DIR, `${name}.json`);
  if (!events.length) {
    console.warn(`  ${name}: 0 events - keeping previous file (if any)`);
    return null;
  }
  events.sort((a, b) => b.date.localeCompare(a.date));
  const doc = {
    source: name, provider: def.provider, url: def.url, license: def.license,
    retrieved: new Date().toISOString(), count: events.length, evidence_note: def.evidence_note,
    ...(extra ?? {}), events,
  };
  const body = JSON.stringify(doc);
  await fs.mkdir(OUT_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, body);
  await fs.rename(tmp, file);
  return Buffer.byteLength(body);
}

export async function main(names = Object.keys(SOURCES)) {
  const report = [];
  for (const name of names) {
    const def = Object.hasOwn(SOURCES, name) ? SOURCES[name] : undefined;
    // A mistyped or renamed source fetched nothing: it must fail the run, not pass as a refresh.
    if (!def) { console.warn(`unknown source ${name}`); report.push({ name, ok: false, error: 'unknown source' }); continue; }
    console.log(`> ${name}`);
    const meta = {};
    try {
      const events = await def.run(meta);
      const bytes = await writeIfGood(name, def, events, meta.extra);
      report.push({ name, ok: bytes != null, count: events.length, bytes });
    } catch (e) {
      console.warn(`  ${name} FAILED: ${e.message} - previous file kept`);
      report.push({ name, ok: false, error: e.message });
    }
  }
  console.log('\nsource            status  count    size');
  for (const r of report) console.log(`${r.name.padEnd(17)} ${(r.ok ? 'ok' : 'FAIL').padEnd(7)} ${String(r.count ?? '-').padEnd(8)} ${r.bytes ? (r.bytes / 1024).toFixed(0) + ' KB' : r.error ?? ''}`);
  // A failed source keeps its previous file; a non-zero exit makes cron / CI notice the stale feed.
  if (report.some((r) => !r.ok)) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const names = process.argv.slice(2);
  await main(names.length ? names : undefined);
}
