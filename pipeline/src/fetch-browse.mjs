// Stage 1 of the pipeline (no login needed).
// For every curated event: look up each NISAR granule on ASF, download NASA's
// official browse PNG, georeference it from the granule footprint, and write
// web-ready images plus a provenance-rich events.json for the web app.
//
// Usage: node src/fetch-browse.mjs            (all events)
//        node src/fetch-browse.mjs <event-id>  (one event)

import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { EVENTS } from './events.config.mjs';
import { searchGranules, tierOf, parseGranuleName } from './asf.mjs';
import { georeference, cropBox } from './georef.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(HERE, '../../web/public/data');
const CACHE = path.resolve(HERE, '../.cache');

async function download(url, dest) {
  try {
    await fs.access(dest);
    return dest; // cached
  } catch {}
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return dest;
}

function pickBrowse(props) {
  const urls = (props.browse || []).filter((u) => !u.includes('thumbnail'));
  return urls.find((u) => u.endsWith('_LATLON.png')) || urls.find((u) => !u.endsWith('_NATIVE.png')) || urls[0];
}

async function processEvent(ev) {
  console.log(`\n== ${ev.id}`);
  const names = ev.observations.map((o) => o.granule);
  const found = await searchGranules(names);
  const outDir = path.join(OUT_ROOT, 'events', ev.id);
  await fs.mkdir(outDir, { recursive: true });

  // Pass 1: download and georeference every browse image.
  const items = [];
  for (const obs of ev.observations) {
    const feat = found.get(obs.granule);
    if (!feat) {
      console.warn(`  MISSING on ASF: ${obs.granule}`);
      continue;
    }
    const p = feat.properties;
    const browseUrl = pickBrowse(p);
    // Short hashed cache names: NISAR file names exceed the Windows 260-char path limit.
    const cacheFile = path.join(CACHE, createHash('sha1').update(browseUrl).digest('hex').slice(0, 16) + '.png');
    await download(browseUrl, cacheFile);
    const img = sharp(await fs.readFile(cacheFile)).ensureAlpha();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const geo = georeference(data, info.width, info.height, feat.geometry.coordinates[0]);
    items.push({ obs, p, browseUrl, data, info, geo, group: `${p.pathNumber}-${p.frameNumber}-${info.width}x${info.height}` });
  }
  // Images from the same track, frame and grid size share one geometry: reuse the
  // best-fitting georeference so a time series does not jitter between dates.
  const best = new Map();
  for (const it of items) {
    const b = best.get(it.group);
    if (!b || it.geo.residualMeters < b.residualMeters) best.set(it.group, it.geo);
  }

  // Pass 2: write images and metadata.
  const layers = [];
  for (const { obs, p, browseUrl, data, info, group } of items) {
    const geo = best.get(group);

    // Optional crop around the event location (keeps time series light and focused).
    let box = { left: 0, top: 0, width: info.width, height: info.height };
    if (ev.crop_km) box = cropBox(geo, ev.location, ev.crop_km, info.width, info.height);

    // Make the no-data background transparent (pure black RGB or alpha 0).
    const px = Buffer.from(data);
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0 || (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0)) px[i + 3] = 0;
    }
    const meta = parseGranuleName(obs.granule);
    const fileName = `${meta.product.toLowerCase()}_${meta.startDate}${meta.secondaryDate ? '_' + meta.secondaryDate : ''}.webp`;
    await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract(box)
      .webp({ quality: 88, alphaQuality: 100 })
      .toFile(path.join(outDir, fileName));

    const corners = [
      geo.toLonLat(box.left, box.top),
      geo.toLonLat(box.left + box.width, box.top),
      geo.toLonLat(box.left + box.width, box.top + box.height),
      geo.toLonLat(box.left, box.top + box.height),
    ].map(([lon, lat]) => [round(lon, 6), round(lat, 6)]);

    layers.push({
      id: path.basename(fileName, '.webp'),
      role: obs.role,
      kind: 'browse',
      product: meta.product,
      url: `data/events/${ev.id}/${fileName}`,
      coordinates: corners,
      acquisition: meta.secondaryDate
        ? { reference: p.startTime, secondary: meta.secondaryStart }
        : { start: p.startTime, stop: p.stopTime },
      provenance: {
        mission: 'NISAR',
        sensor: 'L-SAR (L-band, 24 cm)',
        granule: obs.granule,
        collection: p.collectionName,
        tier: tierOf(p.collectionName),
        crid: p.crid || meta.crid,
        track: p.pathNumber,
        frame: p.frameNumber,
        direction: p.flightDirection,
        polarizations: p.mainBandPolarization || null,
        processing_date: p.processingDate,
        browse_source: browseUrl,
        product_url: p.url,
        distributor: 'ASF DAAC',
        credit: 'NISAR L-band data: NASA/JPL-Caltech & ISRO, distributed by ASF DAAC',
        processing: [
          'Official NISAR browse image produced by the NISAR science data system (8-bit visualization, not calibrated values).',
          'Downloaded from the public ASF browse bucket; no login required.',
          `Georeferenced by an affine fit of the image data corners to the ASF granule footprint (residual ${geo.residualMeters.toFixed(0)} m RMS).`,
          'Pure-black background pixels set transparent.',
          ...(ev.crop_km ? [`Cropped to ${ev.crop_km} km around the event location.`] : []),
        ],
        georef_residual_m: round(geo.residualMeters, 1),
      },
    });
    console.log(`  ${obs.role.padEnd(8)} ${fileName}  residual=${geo.residualMeters.toFixed(0)} m  tier=${tierOf(p.collectionName)}`);
  }
  layers.sort((a, b) => (a.acquisition.start || a.acquisition.reference).localeCompare(b.acquisition.start || b.acquisition.reference));
  const { observations, ...rest } = ev;
  return { ...rest, layers };
}

function round(v, d) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

const only = process.argv[2];
const manifestPath = path.join(OUT_ROOT, 'events.json');
let manifest = { generated: null, events: [] };
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
} catch {}
for (const ev of EVENTS.filter((e) => !only || e.id === only)) {
  const out = await processEvent(ev);
  manifest.events = manifest.events.filter((e) => e.id !== out.id).concat(out);
}
manifest.events.sort((a, b) => EVENTS.findIndex((e) => e.id === a.id) - EVENTS.findIndex((e) => e.id === b.id));
manifest.generated = new Date().toISOString();
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nWrote ${manifestPath}`);
