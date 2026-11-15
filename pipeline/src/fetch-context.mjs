// Context events for the globe: real recent events from USGS and NASA EONET.
// These are shown as markers WITHOUT any SAR analysis claim. Fetched at build
// time so the demo does not depend on third-party CORS or rate limits.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../web/public/data/context.json');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const since = day(Date.now() - 365 * 864e5);

/** fetch + JSON with retries and backoff (this network drops connections intermittently). */
async function fetchJson(url, tries = 5) {
  let delay = 1000;
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

async function usgs() {
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${since}&minmagnitude=6.3&orderby=time`;
  const json = await fetchJson(url);
  if (!Array.isArray(json?.features)) throw new Error('USGS: response has no features array');
  return json.features.map((f) => ({
    id: `usgs-${f.id}`,
    title: f.properties.title,
    category: 'earthquake',
    date: new Date(f.properties.time).toISOString(),
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    magnitude: f.properties.mag,
    depth_km: f.geometry.coordinates[2],
    source: 'USGS',
    url: f.properties.url,
  }));
}

// EONET category -> app taxonomy (web/src/lib.ts GROUPS). Storms, dust, snow, heat and
// water colour are atmospheric/ocean phenomena rather than surface change, so they are skipped.
const EONET_CATS = {
  volcanoes: 'volcano', floods: 'flood', landslides: 'landslide', wildfires: 'wildfire',
  seaLakeIce: 'sea-ice', drought: 'drought', manmade: 'human-other',
};

// EONET returns the newest "limit" events and has no paging, so a limit that is reached means the older part of
// the window is missing. The limit is set well above what each requested window holds, and reaching it is recorded.
export const EONET_LIMIT = 5000;
// Days requested per EONET category (default 365). Wildfires: ~9,800 events a year (measured 2026-11-15), too many
// to ship, so a 30-day window (~850 events) is fetched completely and the window is written to the file.
export const EONET_DAYS = { wildfires: 30 };

/**
 * One EONET category response -> events plus a coverage record that says what the events really cover.
 * Pure (unit-tested). Throws when the body has no events array: an error body must not look like "no events".
 */
export function eonetCategory(json, { mapped, days, limit, now = Date.now() }) {
  if (!Array.isArray(json?.events)) throw new Error('EONET: response has no events array');
  const events = [];
  let skipped = 0, oldestReturned = null;
  for (const e of json.events) {
    const g = e.geometry?.at(-1);
    if (g?.date && (!oldestReturned || g.date < oldestReturned)) oldestReturned = g.date;
    // Polygon-only events (most GDACS-derived floods) have no point to put a marker on; they are counted, not hidden.
    if (!g || g.type !== 'Point') { skipped++; continue; }
    events.push({
      id: `eonet-${e.id}`,
      title: e.title,
      category: mapped,
      date: g.date,
      lon: g.coordinates[0],
      lat: g.coordinates[1],
      source: 'NASA EONET',
      // QA-11: only https links in the app; fall back to the EONET event record
      url: (e.sources || []).map((s) => s.url).find((u) => u?.startsWith('https://')) || e.link,
    });
  }
  const dates = events.map((e) => e.date).sort();
  const truncated = json.events.length >= limit;
  const coverage = {
    source: 'NASA EONET',
    count: events.length,
    oldest: dates[0] ?? null,
    newest: dates.at(-1) ?? null,
    truncated,
    limit,
    window_days: days,
    // the window the events really cover: the requested one, or from the oldest returned event when the limit was hit
    window_from: truncated && oldestReturned ? oldestReturned.slice(0, 10) : day(now - days * 864e5),
    window_to: day(now),
    skipped_non_point: skipped,
  };
  return { events, coverage };
}

async function eonet() {
  const out = [], coverage = {};
  for (const [cat, mapped] of Object.entries(EONET_CATS)) {
    const days = EONET_DAYS[cat] ?? 365;
    const url = `https://eonet.gsfc.nasa.gov/api/v3/events?status=all&days=${days}&category=${cat}&limit=${EONET_LIMIT}`;
    const r = eonetCategory(await fetchJson(url), { mapped, days, limit: EONET_LIMIT });
    if (r.coverage.truncated) console.warn(`EONET ${cat}: limit ${EONET_LIMIT} reached, events before ${r.coverage.window_from} are missing (recorded in coverage)`);
    if (r.coverage.skipped_non_point) console.warn(`EONET ${cat}: ${r.coverage.skipped_non_point} events without a point location not included (recorded in coverage)`);
    out.push(...r.events);
    coverage[mapped] = r.coverage;
  }
  return { events: out, coverage };
}

async function main() {
  const [q, { events: e, coverage }] = await Promise.all([usgs(), eonet()]);
  // Never replace a good context file with an empty or half-empty one (an API outage must not look like
  // "no events this year"): both feeds must return something before we write.
  if (!q.length || !e.length) {
    console.error(`Refusing to write ${OUT}: USGS returned ${q.length}, EONET ${e.length} events (previous file kept).`);
    process.exit(1);
  }
  const qd = q.map((x) => x.date).sort();
  coverage.earthquake = {
    source: 'USGS', count: q.length, oldest: qd[0], newest: qd.at(-1), truncated: false,
    window_days: 365, window_from: since, window_to: day(Date.now()), min_magnitude: 6.3,
  };
  const events = [...q, ...e].sort((a, b) => b.date.localeCompare(a.date));
  const tmp = `${OUT}.tmp`;
  // coverage: per app category, what the events really cover (count, date range, window, whether a limit cut it short)
  await fs.writeFile(tmp, JSON.stringify({ generated: new Date().toISOString(), since, coverage, events }, null, 1));
  await fs.rename(tmp, OUT); // atomic replace: readers never see a truncated file
  console.log(`USGS ${q.length}, EONET ${e.length} -> ${OUT}`);
  console.table(coverage, ['count', 'oldest', 'truncated', 'window_from', 'skipped_non_point']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
