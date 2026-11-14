// Context events for the globe: real recent events from USGS and NASA EONET.
// These are shown as markers WITHOUT any SAR analysis claim. Fetched at build
// time so the demo does not depend on third-party CORS or rate limits.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../web/public/data/context.json');
const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);

async function usgs() {
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${since}&minmagnitude=6.3&orderby=time`;
  const json = await (await fetch(url)).json();
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

const EONET_CATS = { volcanoes: 'volcano', floods: 'flood', landslides: 'landslide', wildfires: 'wildfire' };

async function eonet() {
  const out = [];
  for (const [cat, mapped] of Object.entries(EONET_CATS)) {
    const url = `https://eonet.gsfc.nasa.gov/api/v3/events?status=all&days=365&category=${cat}&limit=${cat === 'wildfires' ? 80 : 150}`;
    const json = await (await fetch(url)).json();
    for (const e of json.events) {
      const g = e.geometry.at(-1);
      if (!g || g.type !== 'Point') continue;
      out.push({
        id: `eonet-${e.id}`,
        title: e.title,
        category: mapped,
        date: g.date,
        lon: g.coordinates[0],
        lat: g.coordinates[1],
        source: 'NASA EONET',
        url: e.sources?.[0]?.url || e.link,
      });
    }
  }
  return out;
}

const [q, e] = await Promise.all([usgs(), eonet()]);
const events = [...q, ...e].sort((a, b) => b.date.localeCompare(a.date));
await fs.writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), since, events }, null, 1));
console.log(`USGS ${q.length}, EONET ${e.length} -> ${OUT}`);
