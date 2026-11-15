import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detailSource, fetchEventDetails, humanizeKey, parseEonet, parseNceiTsunami, parseUsgs, storedFields, type DetailField } from '../../src/eventDetails';
import type { ContextEvent } from '../../src/types';

// RECORDED FIXTURES: real responses captured 2026-11-14 with PowerShell Invoke-WebRequest from
//   earthquake.usgs.gov  /fdsnws/event/1/query?eventid=us6000u43g&format=geojson
//   eonet.gsfc.nasa.gov  /api/v3/events/EONET_26331
//   www.ngdc.noaa.gov    /hazel/hazard-service/api/v1/tsunamis/events/6196
// fetch itself is stubbed: these test OUR parsing of real bodies, not the live services.
const load = (n: string) => JSON.parse(readFileSync(resolve(__dirname, '../fixtures', n), 'utf8'));
const usgs = load('usgs-event-us6000u43g.fixture.json');
const eonet = load('eonet-event-26331.fixture.json');
const ncei = load('ncei-tsunami-6196.fixture.json');
const data = (rel: string) => JSON.parse(readFileSync(resolve(__dirname, '../../public/data', rel), 'utf8'));

const get = (fields: DetailField[], label: string) => fields.find((f) => f.label === label);
afterEach(() => vi.unstubAllGlobals());

describe('storedFields (the record shipped in public/data)', () => {
  const quake: ContextEvent = data('catalogs/usgs-earthquakes.json').events.find((e: ContextEvent) => e.id === 'usgs-us6000u43g');
  const tsunami: ContextEvent = data('catalogs/noaa-tsunamis.json').events.find((e: ContextEvent) => e.id === 'ncei-tsu-6196');

  it('labels every field of a real USGS catalog record', () => {
    const f = storedFields(quake);
    expect(get(f, 'Type')?.value).toBe('Earthquake');
    expect(get(f, 'Date (UTC)')?.value).toBe('22 Oct 2026 14:33 UTC');
    expect(get(f, 'Location')?.value).toBe('32.338°N 93.784°E');
    expect(get(f, 'Magnitude')?.value).toBe('M 7');
    expect(get(f, 'Depth')?.value).toBe('18 km');
    expect(get(f, 'Size')?.value).toBe('7 mww');
    expect(get(f, 'Evidence')?.value).toMatch(/not satellite-confirmed/);
    expect(get(f, 'Source')?.value).toBe('USGS ComCat');
    expect(get(f, 'Source link')).toMatchObject({ value: 'earthquake.usgs.gov', href: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u43g' });
    expect(get(f, 'Notes')?.value).toMatch(/PAGER alert level orange/);
    expect(get(f, 'Record id')?.value).toBe('usgs-us6000u43g');
  });

  it('shows date precision, water height and (when present) deaths for a real NCEI tsunami record', () => {
    const f = storedFields(tsunami);
    expect(get(f, 'Date precision')?.value).toBe('minute');
    expect(get(f, 'Size')?.value).toBe('0.06 m max water height');
    expect(get(f, 'Deaths reported')).toBeUndefined(); // absent in the record: not invented
  });

  it('a date known only to the day is printed without a time (no invented 00:00 UTC)', () => {
    const eruption: ContextEvent = data('catalogs/noaa-volcanoes.json').events.find((e: ContextEvent) => e.id === 'ncei-vol-7588');
    expect(eruption.date_precision).toBe('day');
    expect(get(storedFields(eruption), 'Date (UTC)')?.value).toBe('7 May 2026');
    expect(get(storedFields({ ...quake, date: '2026-05-07T00:00:00.000Z', date_precision: 'day' }), 'Date (UTC)')?.value).toBe('7 May 2026');
  });

  it('a date known to the minute or better keeps its time', () => {
    expect(get(storedFields({ ...quake, date: '2026-05-07T00:00:00.000Z', date_precision: 'minute' }), 'Date (UTC)')?.value).toBe('7 May 2026 00:00 UTC');
    expect(get(storedFields({ ...quake, date: '2026-05-07T09:41:12.000Z', date_precision: 'second' }), 'Date (UTC)')?.value).toBe('7 May 2026 09:41 UTC');
    expect(get(storedFields(tsunami), 'Date (UTC)')?.value).toMatch(/ \d{2}:\d{2} UTC$/);
  });

  it('every stored field of every shipped catalog record is rendered (nothing silently dropped)', () => {
    const files = ['context.json', 'catalogs/usgs-earthquakes.json', 'catalogs/noaa-tsunamis.json', 'catalogs/noaa-volcanoes.json', 'catalogs/gdacs-floods.json', 'catalogs/nasa-glc.json', 'catalogs/firms-fires.json'];
    const labelOf: Record<string, string> = {
      category: 'Type', date: 'Date (UTC)', date_precision: 'Date precision', magnitude: 'Magnitude', depth_km: 'Depth', size: 'Size', deaths: 'Deaths reported',
      count: 'Detections', evidence: 'Evidence', source: 'Source', notes: 'Notes', id: 'Record id',
    };
    for (const file of files) {
      const events: ContextEvent[] = data(file).events;
      // every distinct key set is covered by sampling one record per key signature
      const seen = new Set<string>();
      for (const ev of events) {
        const sig = Object.keys(ev).sort().join(',');
        if (seen.has(sig)) continue;
        seen.add(sig);
        const labels = storedFields(ev).map((f) => f.label);
        for (const [key, value] of Object.entries(ev)) {
          if (value === null || value === '' || ['title', 'lon', 'lat', 'url'].includes(key)) continue;
          expect(labels, `${file} ${ev.id} field "${key}"`).toContain(labelOf[key] ?? humanizeKey(key));
        }
        expect(labels, `${file} ${ev.id} location`).toContain('Location');
      }
      expect(seen.size, file).toBeGreaterThan(0);
    }
  });

  it('never turns a non-http(s) URL into a link, and keeps unknown future fields', () => {
    const f = storedFields({ ...quake, url: 'javascript:alert(1)', felt_reports: 12 } as unknown as ContextEvent);
    expect(get(f, 'Source link')).toBeUndefined();
    expect(f.every((x) => !x.href || /^https?:/.test(x.href))).toBe(true);
    expect(get(f, 'Felt reports')?.value).toBe('12');
  });
});

describe('detailSource (which provider API holds the full record)', () => {
  it('maps stored ids to the provider endpoints', () => {
    expect(detailSource({ id: 'usgs-us6000u43g' })).toMatchObject({ kind: 'usgs', apiUrl: 'https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=us6000u43g&format=geojson' });
    expect(detailSource({ id: 'eonet-EONET_26331' })).toMatchObject({ kind: 'eonet', apiUrl: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_26331' });
    expect(detailSource({ id: 'ncei-tsu-6196' })).toMatchObject({ kind: 'ncei-tsunami', apiUrl: 'https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events/6196' });
  });
  it('has no per-event API for volcano, flood, landslide and fire-cell records', () => {
    for (const id of ['ncei-vol-7588', 'gdacs-fl-1104124', 'glc-10393', 'firms-645-152']) expect(detailSource({ id }), id).toBeNull();
  });
  it('rejects ids that could alter the request URL', () => {
    for (const id of ['usgs-../../admin', 'usgs-a&format=xml', 'eonet-x/y?z', 'usgs-', 'ncei-tsu-12abc', 'usgs-' + 'a'.repeat(80)]) expect(detailSource({ id }), id).toBeNull();
    expect(detailSource({ id: undefined as unknown as string })).toBeNull();
  });
  it('every id in the shipped context and catalogs resolves to a provider or to null, never to a malformed URL', () => {
    for (const file of ['context.json', 'catalogs/usgs-earthquakes.json', 'catalogs/noaa-tsunamis.json']) {
      const events: ContextEvent[] = data(file).events;
      const missing = events.filter((e) => !detailSource(e)).map((e) => e.id);
      expect(missing.slice(0, 5), file).toEqual([]);
    }
  });
});

describe('parseUsgs (recorded us6000u43g)', () => {
  const r = parseUsgs(usgs, 'https://earthquake.usgs.gov/x');
  it('parses the real response', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = r.details.fields;
    expect(r.details.provider).toBe('USGS ComCat');
    expect(get(f, 'Place')?.value).toBe('189 km ENE of Nagqu, China');
    expect(get(f, 'Magnitude')?.value).toBe('M 7');
    expect(get(f, 'Magnitude type')?.value).toBe('mww');
    expect(get(f, 'Origin time')?.value).toBe('22 Oct 2026 14:33 UTC'); // epoch ms rendered in UTC
    expect(get(f, 'Hypocentre')?.value).toMatch(/^32\.338°N 93\.784°E · depth \d+(\.\d)? km$/);
    expect(get(f, 'Felt reports (DYFI)')?.value).toBe('9');
    expect(get(f, 'Max instrumental intensity (MMI)')?.value).toBe('8.75');
    expect(get(f, 'PAGER alert level')?.value).toBe('orange');
    expect(get(f, 'Tsunami flag')?.value).toBe('no');
    expect(get(f, 'Significance (0-1000+)')?.value).toBe('1007');
    expect(get(f, 'Contributing networks')?.value).toBe('us, usauto, at');
    expect(get(f, 'Event page')).toMatchObject({ href: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u43g' });
  });
  it('lists every product type of the real response with its version count', () => {
    if (!r.ok) throw new Error(r.reason);
    const products = r.details.lists.find((l) => l.label === 'Products')!;
    expect(products.items.map((p) => p.label).sort()).toEqual(Object.keys(usgs.properties.products).sort());
    expect(products.items.find((p) => p.label === 'shakemap')?.value).toMatch(/^\d+ versions? · source \w+ · updated \d{1,2} \w{3} \d{4}/);
  });
  it('null properties are omitted, never printed as "null"', () => {
    if (!r.ok) throw new Error(r.reason);
    expect(usgs.properties.tz).toBeNull();
    expect(get(r.details.fields, 'Timezone offset')).toBeUndefined();
    expect(r.details.fields.every((f) => !/^(null|undefined|NaN)$/.test(f.value))).toBe(true);
  });
  it('rejects odd bodies clearly instead of throwing or returning an empty record', () => {
    for (const body of [null, undefined, 'Bad Request', 42, [], {}, { type: 'FeatureCollection', features: [] }, { type: 'Feature' }, { type: 'Feature', properties: null }, { type: 'Feature', properties: {} }]) {
      const res = parseUsgs(body);
      expect(res.ok, JSON.stringify(body)).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/USGS/);
    }
  });
  it('drops non-http(s) links and survives wrong value types', () => {
    const res = parseUsgs({ type: 'Feature', properties: { title: 'x', url: 'javascript:alert(1)', time: 'yesterday', mag: 'big', products: 'nope' }, geometry: { coordinates: 'here' } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.details.fields.some((f) => f.href)).toBe(false);
    expect(get(res.details.fields, 'Origin time')).toBeUndefined();
    expect(res.details.lists).toEqual([]);
  });
});

describe('parseEonet (recorded EONET_26331)', () => {
  const r = parseEonet(eonet);
  it('parses the real response: categories, sources, open status and the dated geometry as a timeline', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = r.details.fields;
    expect(get(f, 'Title')?.value).toBe('Wildfire Red Hill, Perry, Mississippi');
    expect(get(f, 'EONET id')?.value).toBe('EONET_26331');
    expect(get(f, 'Categories')?.value).toBe('Wildfires');
    expect(get(f, 'Status')?.value).toMatch(/^open/);
    expect(get(f, 'Description')).toBeUndefined(); // null in the record
    expect(r.details.lists[0]).toMatchObject({ label: 'Sources', items: [{ label: 'IRWIN', value: 'irwin.doi.gov', href: 'https://irwin.doi.gov/observer/incidents/2026-MSMNF-000713' }] });
    expect(r.details.timeline).toEqual([{ date: '12 Nov 2026 00:22 UTC', text: '519 acres · 31.130°N 89.064°W' }]);
  });
  it('a multi-observation event yields one timeline entry per dated geometry, undated ones skipped', () => {
    const multi = { ...eonet, closed: '2026-11-20T00:00:00Z', geometry: [...eonet.geometry, { date: '2026-11-13T06:00:00Z', type: 'Point', coordinates: [-89.1, 31.2] }, { type: 'Point', coordinates: [0, 0] }, 'junk'] };
    const res = parseEonet(multi);
    if (!res.ok) throw new Error(res.reason);
    expect(res.details.timeline.map((t) => t.date)).toEqual(['12 Nov 2026 00:22 UTC', '13 Nov 2026 06:00 UTC']);
    expect(get(res.details.fields, 'Status')?.value).toBe('closed 20 Nov 2026 00:00 UTC');
  });
  it('rejects odd bodies clearly', () => {
    for (const body of [null, 'Not Found', [], {}, { id: 'EONET_1' }, { id: '', geometry: [] }, { title: 'x', geometry: [] }]) {
      const res = parseEonet(body);
      expect(res.ok, JSON.stringify(body)).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/EONET/);
    }
  });
});

describe('parseNceiTsunami (recorded event 6196)', () => {
  const r = parseNceiTsunami(ncei);
  it('parses the real response and decodes the cause and validity codes', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = r.details.fields;
    expect(get(f, 'Date')?.value).toBe('2026-10-24 02:31 UTC');
    expect(get(f, 'Location')?.value).toBe('VANUATU ISLANDS');
    expect(get(f, 'Country')?.value).toBe('VANUATU');
    expect(get(f, 'Cause')?.value).toBe('Earthquake (code 1)');
    expect(get(f, 'Event validity')?.value).toBe('definite (4)');
    expect(get(f, 'Max water height (m)')?.value).toBe('0.06');
    expect(get(f, 'Earthquake magnitude (Mw)')?.value).toBe('6.9');
    expect(get(f, 'NCEI reference ids')?.value).toBe('14545, 14544');
  });
  it('strips the HTML that NCEI puts in comments (text only reaches the page)', () => {
    if (!r.ok) throw new Error(r.reason);
    expect(ncei.comments).toContain('<p>');
    const c = get(r.details.fields, 'Comments')!.value;
    expect(c).toMatch(/^Tide gauges picked up/);
    expect(c).not.toMatch(/[<>]/);
  });
  it('every scalar field of the real response is shown under some label', () => {
    if (!r.ok) throw new Error(r.reason);
    const dateKeys = ['year', 'month', 'day', 'hour', 'minute', 'second'];
    const expected = Object.keys(ncei).filter((k) => !dateKeys.includes(k)).length;
    expect(r.details.fields.length).toBe(expected + 1); // + the assembled Date
  });
  it('a record without day or time says so instead of inventing a date', () => {
    const res = parseNceiTsunami({ id: 1, year: 1905, month: 7 });
    if (!res.ok) throw new Error(res.reason);
    expect(get(res.details.fields, 'Date')?.value).toBe('1905-07 (day or month not recorded)');
  });
  it('accepts the paged envelope with exactly one item and rejects everything else clearly', () => {
    expect(parseNceiTsunami({ items: [ncei] }).ok).toBe(true);
    for (const body of [null, '<html>503</html>', [], {}, { items: [] }, { items: [ncei, ncei] }, { id: '6196', year: 2026 }, { id: 6196 }]) {
      const res = parseNceiTsunami(body);
      expect(res.ok, JSON.stringify(body)?.slice(0, 40)).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/NCEI/);
    }
  });
});

describe('fetchEventDetails', () => {
  const respond = (body: unknown, init: { ok?: boolean; status?: number; bad?: boolean } = {}) => {
    const f = vi.fn(async (..._a: unknown[]) => ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => {
        if (init.bad) throw new SyntaxError('Unexpected token <');
        return body;
      },
    }) as Response);
    vi.stubGlobal('fetch', f);
    return f;
  };
  it('requests the provider URL for the id and resolves with the parsed record', async () => {
    const f = respond(usgs);
    const d = await fetchEventDetails({ id: 'usgs-us6000u43g' });
    expect(f.mock.calls[0][0]).toBe('https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=us6000u43g&format=geojson');
    expect(d.apiUrl).toBe(f.mock.calls[0][0]);
    expect(d.fields.length).toBeGreaterThan(15);
  });
  it('forwards the AbortSignal', async () => {
    const f = respond(eonet);
    const ctl = new AbortController();
    await fetchEventDetails({ id: 'eonet-EONET_26331' }, ctl.signal);
    expect((f.mock.calls[0][1] as RequestInit).signal).toBe(ctl.signal);
  });
  it('rejects with a readable message on HTTP errors, non-JSON bodies and unexpected shapes', async () => {
    respond({}, { ok: false, status: 404 });
    await expect(fetchEventDetails({ id: 'usgs-nope' })).rejects.toThrow('USGS ComCat request failed (HTTP 404)');
    respond(null, { bad: true });
    await expect(fetchEventDetails({ id: 'ncei-tsu-6196' })).rejects.toThrow('NOAA NCEI tsunami database did not return JSON');
    respond({ error: 'rate limited' });
    await expect(fetchEventDetails({ id: 'eonet-EONET_26331' })).rejects.toThrow(/EONET returned an unexpected response/);
  });
  it('rejects without calling the network when the catalog has no per-event API', async () => {
    const f = respond({});
    await expect(fetchEventDetails({ id: 'glc-10393' })).rejects.toThrow(/No per-event API/);
    expect(f).not.toHaveBeenCalled();
  });
  it('lets a network failure propagate (it must not look like an empty record)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchEventDetails({ id: 'usgs-us6000u43g' })).rejects.toThrow('Failed to fetch');
  });
});
