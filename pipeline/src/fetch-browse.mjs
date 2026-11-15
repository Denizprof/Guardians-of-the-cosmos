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
/**
 * Lookup problems found in this run (see auditGranules). Any entry here means events.json is NOT
 * rewritten: a transient ASF search miss must not look like "not observed".
 */
const problems = [];

/**
 * Check one event's configured granules against the ASF search result, before anything is
 * downloaded or written. Returns one message per problem:
 *  - a granule ASF did not return (HTTP 200 with a partial or empty feature list), or
 *  - a granule whose collection name gives no recognised data tier (never guess VALIDATED).
 */
export function auditGranules(ev, found) {
  const out = [];
  for (const obs of ev.observations) {
    const feat = found.get(obs.granule);
    if (!feat) {
      out.push(`${obs.granule}: not found on ASF`);
      continue;
    }
    const collection = feat.properties?.collectionName;
    if (tierOf(collection) === 'UNKNOWN') {
      out.push(`${obs.granule}: data tier cannot be determined from collection name ${JSON.stringify(collection ?? null)}`);
    }
  }
  return out;
}

/**
 * Decide what to write. With any lookup problem the previous manifest is returned unchanged and
 * write is false. Otherwise each fresh event replaces its previous entry, keeping the stage-2
 * derived layers (QA-22), in the order of `order` (event ids from events.config.mjs).
 * Pure: `prev` is never mutated.
 */
export function mergeManifest(prev, outEvents, lookupProblems, order) {
  if (lookupProblems.length) return { manifest: prev, write: false };
  let events = prev.events;
  for (const out of outEvents) {
    const before = events.find((e) => e.id === out.id);
    const derived = (before?.layers ?? []).filter((l) => l.kind !== 'browse');
    if (derived.length) console.log(`  ${out.id}: kept ${derived.length} derived layers from the previous manifest`);
    events = events.filter((e) => e.id !== out.id).concat({ ...out, layers: out.layers.concat(derived) });
  }
  events = [...events].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { manifest: { ...prev, events }, write: true };
}

async function download(url, dest) {
  try {
    await fs.access(dest);
    return dest; // cached
  } catch (e) {
    if (e.code !== 'ENOENT') throw e; // only "not cached yet" means download; permissions etc. must surface
  }
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
  // Check the whole event first: an incomplete event writes no images and no manifest entry.
  const bad = auditGranules(ev, found);
  if (bad.length) {
    for (const b of bad) console.warn(`  PROBLEM: ${b}`);
    problems.push(...bad);
    return null;
  }
  const outDir = path.join(OUT_ROOT, 'events', ev.id);
  await fs.mkdir(outDir, { recursive: true });

  // Pass 1: download and georeference every browse image.
  const items = [];
  for (const obs of ev.observations) {
    const feat = found.get(obs.granule); // present: auditGranules passed
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
          `Georeferenced approximately: affine fit of the image's data corners to the ASF granule footprint (corner-fit residual ${geo.residualMeters.toFixed(0)} m). ` +
            `The residual is NOT the positional accuracy; corner detection is uncertain by several pixels, so the estimated positional uncertainty is about ±${uncertaintyM(geo).toFixed(0)} m. Measured layers derived from the HDF5 grid are exact.`,
          'Pure-black background pixels set transparent.',
          ...(ev.crop_km ? [`Cropped to ${ev.crop_km} km around the event location.`] : []),
        ],
        georef_residual_m: round(geo.residualMeters, 1),
        georef_uncertainty_m: round(uncertaintyM(geo), 0),
      },
    });
    console.log(`  ${obs.role.padEnd(8)} ${fileName}  residual=${geo.residualMeters.toFixed(0)} m  uncertainty~${uncertaintyM(geo).toFixed(0)} m  tier=${tierOf(p.collectionName)}`);
  }
  layers.sort((a, b) => (a.acquisition.start || a.acquisition.reference).localeCompare(b.acquisition.start || b.acquisition.reference));
  const { observations, ...rest } = ev;
  return { ...rest, layers };
}

/**
 * Honest positional uncertainty for a browse overlay (QA-12). The affine residual only measures
 * how consistent the 4 corner matches are; synthetic tests show the real corner error is ~6 px
 * for typical frame tilts, so we report max(residual, 6 px x pixel size).
 */
const CORNER_ERROR_PX = 6;
function uncertaintyM(geo) {
  const [lon0, lat0] = geo.toLonLat(0, 0);
  const [lon1, lat1] = geo.toLonLat(1, 0);
  const pxM = Math.hypot((lon1 - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), (lat1 - lat0) * 111320);
  return Math.max(geo.residualMeters, CORNER_ERROR_PX * pxM);
}

function round(v, d) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

async function main() {
  const only = process.argv[2];
  if (only && !EVENTS.some((e) => e.id === only)) {
    console.error(`Unknown event id "${only}". Known: ${EVENTS.map((e) => e.id).join(', ')}`);
    process.exit(1);
  }
  const manifestPath = path.join(OUT_ROOT, 'events.json');
  let manifest = { generated: null, events: [] };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (e) {
    // A missing manifest is a first run; a corrupt one must not be silently replaced (it holds the
    // stage-2 derived layers, which would be lost).
    if (e.code !== 'ENOENT') throw new Error(`Cannot read ${manifestPath}: ${e.message}`);
  }
  const outs = [];
  for (const ev of EVENTS.filter((e) => !only || e.id === only)) {
    const out = await processEvent(ev);
    if (out) outs.push(out);
  }
  const merged = mergeManifest(manifest, outs, problems, EVENTS.map((e) => e.id));
  if (!merged.write) {
    // A failed lookup must not replace a good manifest with one that has lost layers.
    console.error(
      `\n${problems.length} configured granule(s) could not be used; ${manifestPath} was NOT rewritten (the previous file, if any, is kept):\n  ${problems.join('\n  ')}`,
    );
    process.exitCode = 1;
    return;
  }
  merged.manifest.generated = new Date().toISOString();
  await fs.writeFile(`${manifestPath}.tmp`, JSON.stringify(merged.manifest, null, 2));
  await fs.rename(`${manifestPath}.tmp`, manifestPath);
  console.log(`\nWrote ${manifestPath}`);
}

// Run only as a script (node src/fetch-browse.mjs); importing the module for tests does nothing.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
