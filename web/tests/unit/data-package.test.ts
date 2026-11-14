// @vitest-environment node
// Validates the REAL generated data package that ships with the app
// (web/public/data/events.json + context.json + the overlay images). No mocks.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORY_LABEL } from '../../src/lib';

const DATA = resolve(__dirname, '../../public/data');
const events = JSON.parse(readFileSync(resolve(DATA, 'events.json'), 'utf8'));
const context = JSON.parse(readFileSync(resolve(DATA, 'context.json'), 'utf8'));
const CATEGORIES = Object.keys(CATEGORY_LABEL);
const LAYER_KINDS = ['browse', 'backscatter', 'change', 'water', 'los', 'coherence'];
const ROLES = ['before', 'after', 'timeline', 'change'];
const TIERS = ['BETA', 'PROVISIONAL', 'VALIDATED', 'URGENT RESPONSE'];
const TECHNIQUES = ['insar', 'backscatter', 'timeseries'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

type Layer = any;
const allLayers: { ev: any; l: Layer }[] = events.events.flatMap((ev: any) => ev.layers.map((l: Layer) => ({ ev, l })));
const label = ({ ev, l }: { ev: any; l: Layer }) => `${ev.id}/${l.id}`;

/** Parse the parts of a NISAR granule name (JPL D-102255): NISAR_L2_PR_<PROD>_<cycle>_<track>_<A|D>_<frame>_... */
function granuleParts(g: string) {
  const p = g.split('_');
  const stamps = p.filter((s) => /^\d{8}T\d{6}$/.test(s));
  return { product: p[3], track: Number(p[5]), dir: p[6], frame: Number(p[7]), stamps };
}
const stampIso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;

describe('events.json: top level', () => {
  it('has a parseable generated timestamp and at least one event', () => {
    expect(Number.isNaN(Date.parse(events.generated))).toBe(false);
    expect(events.events.length).toBeGreaterThan(0);
  });
  it('event ids are unique, URL-safe and match the hash-router pattern', () => {
    const ids = events.events.map((e: any) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[\w-]+$/); // App.readHash uses /^e\/([\w-]+)/
  });
});

describe.each(events.events as any[])('event $id', (ev) => {
  it('has the required descriptive fields with valid enums', () => {
    expect(ev.title?.length).toBeGreaterThan(2);
    expect(ev.subtitle?.length).toBeGreaterThan(2);
    expect(CATEGORIES, `category ${ev.category}`).toContain(ev.category);
    expect(TECHNIQUES).toContain(ev.technique);
    expect(isNum(ev.location?.lon) && ev.location.lon >= -180 && ev.location.lon <= 180).toBe(true);
    expect(isNum(ev.location?.lat) && ev.location.lat >= -90 && ev.location.lat <= 90).toBe(true);
    if (ev.date !== null) expect(ev.date).toMatch(ISO);
  });
  it('has references with http(s) URLs', () => {
    expect(ev.references.length).toBeGreaterThan(0);
    for (const r of ev.references) {
      expect(r.label).toBeTruthy();
      expect(r.url).toMatch(/^https:\/\//);
    }
  });
  it('has a before and an after layer, and unique layer ids', () => {
    const roles = ev.layers.map((l: Layer) => l.role);
    expect(roles).toContain('before');
    expect(roles).toContain('after');
    const ids = ev.layers.map((l: Layer) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('technique matches the layer products (insar -> GUNW, backscatter/timeseries -> GCOV)', () => {
    const want = ev.technique === 'insar' ? 'GUNW' : 'GCOV';
    for (const l of ev.layers) expect(l.product, l.id).toBe(want);
  });
  it('the event location falls inside the footprint of at least one layer', () => {
    const inside = ev.layers.some((l: Layer) => {
      const lons = l.coordinates.map((c: number[]) => c[0]);
      const lats = l.coordinates.map((c: number[]) => c[1]);
      return ev.location.lon >= Math.min(...lons) && ev.location.lon <= Math.max(...lons) && ev.location.lat >= Math.min(...lats) && ev.location.lat <= Math.max(...lats);
    });
    expect(inside).toBe(true);
  });
  it('extra_points (if any) are valid lon/lat', () => {
    for (const p of ev.extra_points ?? []) {
      expect(p.label).toBeTruthy();
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
    }
  });
});

describe.each(allLayers.map((x) => [label(x), x] as const))('layer %s', (_n, { ev, l }) => {
  it('has valid kind, role and product', () => {
    expect(LAYER_KINDS).toContain(l.kind);
    expect(ROLES).toContain(l.role);
    expect(l.product).toMatch(/^G(COV|UNW)$/);
  });

  it('has four finite lon/lat corners in TL, TR, BR, BL order', () => {
    expect(l.coordinates).toHaveLength(4);
    for (const c of l.coordinates) {
      expect(c).toHaveLength(2);
      expect(isNum(c[0]) && Math.abs(c[0]) <= 180, `lon ${c[0]}`).toBe(true);
      expect(isNum(c[1]) && Math.abs(c[1]) <= 90, `lat ${c[1]}`).toBe(true);
    }
    const [tl, tr, br, bl] = l.coordinates;
    // North edge above south edge, west edge left of east edge (tolerant of rotated/sheared georeferencing).
    expect((tl[1] + tr[1]) / 2).toBeGreaterThan((bl[1] + br[1]) / 2);
    expect((tl[0] + bl[0]) / 2).toBeLessThan((tr[0] + br[0]) / 2);
    // Non-degenerate and sane size (a NISAR frame is up to ~500 km; allow up to 8 deg).
    const lons = l.coordinates.map((c: number[]) => c[0]);
    const lats = l.coordinates.map((c: number[]) => c[1]);
    expect(Math.max(...lons) - Math.min(...lons)).toBeGreaterThan(0.01);
    expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(0.01);
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(8);
    expect(Math.max(...lats) - Math.min(...lats)).toBeLessThan(8);
  });

  it('image file exists, is a non-trivial WebP, and the path is relative (works under any base)', () => {
    expect(l.url).toMatch(/^data\/events\/[\w-]+\/[\w-]+\.webp$/);
    const file = resolve(DATA, '..', l.url);
    expect(existsSync(file), file).toBe(true);
    const buf = readFileSync(file);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(buf.subarray(8, 12).toString('ascii')).toBe('WEBP');
    // image lives in its own event's folder
    expect(l.url.split('/')[2]).toBe(ev.id);
  });

  it('has acquisition dates (single start, or reference+secondary pair) in ISO-8601 UTC', () => {
    const a = l.acquisition;
    if (a.secondary) {
      expect(a.reference).toMatch(ISO);
      expect(a.secondary).toMatch(ISO);
      expect(Date.parse(a.secondary)).toBeGreaterThan(Date.parse(a.reference));
    } else {
      expect(a.start).toMatch(ISO);
    }
  });

  it('has full provenance (mission, granule, tier, track, frame, processing steps, credit, links)', () => {
    const p = l.provenance;
    expect(p.mission).toBe('NISAR');
    expect(p.sensor).toBeTruthy();
    expect(p.granule).toMatch(/^NISAR_L2_PR_G(COV|UNW)_/);
    expect(p.collection).toMatch(/^NISAR_L2_G(COV|UNW)_/);
    expect(TIERS).toContain(p.tier);
    expect(Number.isInteger(p.track) && p.track > 0).toBe(true);
    expect(Number.isInteger(p.frame) && p.frame > 0).toBe(true);
    expect(['ASCENDING', 'DESCENDING']).toContain(p.direction);
    expect(Number.isNaN(Date.parse(p.processing_date)), 'processing_date parses').toBe(false);
    expect(Array.isArray(p.processing) && p.processing.length > 0).toBe(true);
    for (const s of p.processing) expect(typeof s === 'string' && s.length > 5).toBe(true);
    expect(p.distributor).toBe('ASF DAAC');
    expect(p.credit).toMatch(/NASA/);
    expect(p.product_url).toMatch(/^https:\/\/.*\.h5$/);
    expect(p.product_url).toContain(p.granule);
    expect(p.crid).toMatch(/^[XPV]\d{5}$/);
  });

  it('provenance is internally consistent with the granule file name', () => {
    const p = l.provenance;
    const g = granuleParts(p.granule);
    expect(g.product).toBe(l.product);
    expect(p.track).toBe(g.track);
    expect(p.frame).toBe(g.frame);
    expect(p.direction).toBe(g.dir === 'A' ? 'ASCENDING' : 'DESCENDING');
    expect(p.granule).toContain(`_${p.crid}_`);
    // tier is encoded in the collection name
    const tierFromCollection = p.collection.includes('_BETA_') ? 'BETA' : p.collection.includes('_PROVISIONAL_') ? 'PROVISIONAL' : p.collection.startsWith('NISAR_UR') ? 'URGENT RESPONSE' : 'VALIDATED';
    expect(p.tier).toBe(tierFromCollection);
  });

  it('acquisition timestamps match the timestamps encoded in the granule name', () => {
    const { stamps } = granuleParts(l.provenance.granule);
    const a = l.acquisition;
    if (l.product === 'GUNW') {
      // GUNW names: ref start, ref stop, sec start, sec stop
      expect(a.reference).toBe(stampIso(stamps[0]));
      expect(a.secondary).toBe(stampIso(stamps[2]));
    } else if (!a.secondary) {
      expect(a.start).toBe(stampIso(stamps[0]));
    }
    // (GCOV pair layers like change maps legitimately reference two different granules.)
  });

  it('browse layers carry the georeferencing residual and the browse source; derived layers have a legend', () => {
    if (l.kind === 'browse') {
      expect(isNum(l.provenance.georef_residual_m), 'georef_residual_m').toBe(true);
      expect(l.provenance.georef_residual_m).toBeLessThan(1000); // see ISSUE-QA-10: some browse layers are > 500 m
      expect(l.provenance.browse_source).toMatch(/^https:\/\/.*\.png$/);
      expect(l.legend).toBeUndefined();
    } else {
      expect(l.legend, `derived layer ${l.id} needs a legend`).toBeTruthy();
      expect(l.legend.units).toBeTruthy();
    }
  });

  it('legend ranges / classes are coherent', () => {
    const lg = l.legend;
    if (!lg) return;
    if (lg.classes) {
      expect(Object.keys(lg.classes).length).toBeGreaterThan(0);
      expect(isNum(lg.threshold_db)).toBe(true);
    } else if (lg.colormap !== 'composite') {
      // The app draws min/max labels under the colour bar: they must exist.
      expect(isNum(lg.vmin) && isNum(lg.vmax), `legend vmin/vmax for ${l.id}`).toBe(true);
      expect(lg.vmax).toBeGreaterThan(lg.vmin);
    }
    if (lg.colormap) expect(['diverging', 'gray', 'composite']).toContain(lg.colormap);
  });
});

describe('timestamps', () => {
  // ISSUE-QA-04 (fixed): process.py writes processing_date with an explicit Z (utc_iso), so browsers
  // never parse it as local time.
  it('every provenance.processing_date is ISO-8601 with an explicit Z', () => {
    for (const x of allLayers) expect(x.l.provenance.processing_date, label(x)).toMatch(ISO);
  });
});

describe('context.json', () => {
  it('has generated, since and an events array', () => {
    expect(Number.isNaN(Date.parse(context.generated))).toBe(false);
    expect(context.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(context.events)).toBe(true);
    expect(context.events.length).toBeGreaterThan(0);
  });
  it('every context event matches the schema', () => {
    for (const e of context.events) {
      expect(e.id, JSON.stringify(e)).toMatch(/^(usgs|eonet)-[\w.-]+$/);
      expect(typeof e.title === 'string' && e.title.length > 0).toBe(true);
      expect(CATEGORIES, `category of ${e.id}`).toContain(e.category);
      expect(e.date).toMatch(ISO);
      expect(isNum(e.lon) && Math.abs(e.lon) <= 180, `lon of ${e.id}`).toBe(true);
      expect(isNum(e.lat) && Math.abs(e.lat) <= 90, `lat of ${e.id}`).toBe(true);
      expect(['USGS', 'NASA EONET']).toContain(e.source);
      expect(e.url).toMatch(/^https?:\/\//); // one EONET source link is plain http (ISSUE-QA-11)
    }
  });
  it('ids are unique', () => {
    const ids = context.events.map((e: any) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('USGS events are M6.3+ with magnitude and depth; ids/source agree', () => {
    for (const e of context.events.filter((x: any) => x.source === 'USGS')) {
      expect(e.id.startsWith('usgs-')).toBe(true);
      expect(e.category).toBe('earthquake');
      expect(isNum(e.magnitude) && e.magnitude >= 6.3, `${e.id} magnitude ${e.magnitude}`).toBe(true);
      expect(isNum(e.depth_km) && e.depth_km >= 0).toBe(true);
    }
    for (const e of context.events.filter((x: any) => x.source === 'NASA EONET')) expect(e.id.startsWith('eonet-')).toBe(true);
  });
  it('dates fall inside the declared 12-month window and not in the future', () => {
    const lo = Date.parse(context.since);
    const hi = Date.parse(context.generated) + 36e5;
    for (const e of context.events) {
      const t = Date.parse(e.date);
      expect(t, `${e.id} ${e.date}`).toBeGreaterThanOrEqual(lo - 864e5);
      expect(t, `${e.id} ${e.date}`).toBeLessThanOrEqual(hi);
    }
  });
  it('context ids do not collide with curated event ids', () => {
    const curated = new Set(events.events.map((e: any) => e.id));
    for (const e of context.events) expect(curated.has(e.id)).toBe(false);
  });
});

describe('data package size budget', () => {
  it('no single overlay image exceeds 6 MB (mobile data budget)', () => {
    for (const x of allLayers) {
      const size = statSync(resolve(DATA, '..', x.l.url)).size;
      expect(size, label(x)).toBeLessThan(6 * 1024 * 1024);
    }
  });
});
