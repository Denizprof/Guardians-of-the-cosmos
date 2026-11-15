import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error plain .mjs, shared with the gateway
import { validate } from '../../../../assistant-gateway/src/schema.mjs';
import type { SarEvent } from '../../../src/types';
import type { CoverageResult } from '../../../src/services';
import { buildContext, buildCoverageContext, buildLayerContext, buildMapView, buildRequest, collectCitationIds, MAX_COVERAGE_GRANULES } from '../../../src/assistant/context';

const root = resolve(process.cwd(), '..').split('\\').join('/') + '/'; // vitest runs with cwd = web/
const events: SarEvent[] = JSON.parse(readFileSync(root + 'web/public/data/events.json', 'utf8')).events;

async function schemaCheck(request: unknown) {
  // Reuse the gateway's dependency-free validator so the browser and gateway agree on the contract.
  const schema = JSON.parse(readFileSync(root + 'shared/assistant-contract/assistant-request.schema.json', 'utf8'));
  const errors = validate(schema, request) as string[];
  return { ok: errors.length === 0, errors };
}

const view = { center: [-67.2, 10.6] as [number, number], zoom: 5.123456, bbox: [-70, 9, -64, 12] as [number, number, number, number] };

describe('context builder with the real events.json', () => {
  it('loads the shipped events', () => {
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it.each(events.map((e) => [e.id, e] as const))('builds a schema-valid request for %s', async (_id, ev) => {
    const layers = [ev.layers.find((l) => l.role === 'before'), ev.layers.find((l) => l.role === 'after') ?? ev.layers[0]];
    const ctx = buildContext({ event: ev, layers, mapView: view, clicked: { lon: ev.location.lon, lat: ev.location.lat } });
    const req = buildRequest({ query: 'What changed?', locale: 'en', level: 'simple', context: ctx });
    const res = await schemaCheck(req);
    expect(res.errors ?? []).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('carries full provenance and classifies browse as observation, others as derived', () => {
    for (const ev of events) for (const layer of ev.layers) {
      const c = buildLayerContext(layer);
      expect(c.provenance.mission).toBe('NISAR');
      expect(c.provenance.granule).toBe(layer.provenance.granule);
      expect(c.provenance.tier).toBe(layer.provenance.tier);
      expect(c.provenance.acquisition).toEqual(layer.acquisition);
      expect(c.provenance.processing).toEqual(layer.provenance.processing);
      expect(c.type).toBe(layer.kind === 'browse' ? 'observation' : 'derived');
      expect(c.provenance.origin).toBe(layer.kind === 'browse' ? 'nasa_browse' : 'derived_by_team');
      expect(c.citation_id).toBe(`layer:${layer.id}`);
    }
  });

  it('collects citation ids for event, references, layers and coverage', () => {
    const ev = events[0];
    const cov: CoverageResult = { lon: 1, lat: 2, total: 1, granules: [{ scene: 'SCENE_A', product: 'GCOV', start: '2026-01-01T00:00:00Z', tier: 'BETA', track: 1, frame: 2, direction: 'ASCENDING', footprint: { type: 'Polygon', coordinates: [] } }] };
    const ids = collectCitationIds(buildContext({ event: ev, layers: [ev.layers[0]], coverage: cov }));
    expect(ids).toContain(`event:${ev.id}`);
    expect(ids).toContain(`ref:${ev.id}:0`);
    expect(ids).toContain(`layer:${ev.layers[0].id}`);
    expect(ids).toContain('asf:SCENE_A');
  });

  it('dedupes layers and ignores empty inputs', () => {
    const ev = events[0];
    expect(buildContext({ event: ev, layers: [ev.layers[0], ev.layers[0], null, undefined] }).selected_layers).toHaveLength(1);
    expect(buildContext({})).toEqual({});
  });
});

describe('map view and coverage', () => {
  it('rounds and rejects invalid map views', () => {
    expect(buildMapView(view)).toEqual({ center: [-67.2, 10.6], zoom: 5.12, bbox: [-70, 9, -64, 12] });
    expect(buildMapView({ ...view, zoom: NaN })).toBeUndefined();
    expect(buildMapView(null)).toBeUndefined();
  });

  it('caps granules but keeps the real total', () => {
    const granules = Array.from({ length: 80 }, (_, i) => ({ scene: `S${i}`, product: 'GCOV', start: '2026-01-01T00:00:00Z', tier: 'BETA', track: 1, frame: 1, direction: 'A', footprint: { type: 'Polygon' as const, coordinates: [] } }));
    const c = buildCoverageContext({ lon: 0, lat: 0, total: 80, granules });
    expect(c.granules).toHaveLength(MAX_COVERAGE_GRANULES);
    expect(c.total).toBe(80);
  });
});

describe('buildRequest', () => {
  it('trims, bounds conversation and falls back on a bad locale', () => {
    const conversation = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}` }));
    const r = buildRequest({ query: '  hi  ', locale: 'not a locale', level: 'scientific', context: {}, conversation });
    expect(r.query).toBe('hi');
    expect(r.locale).toBe('en');
    expect(r.conversation).toHaveLength(10);
    expect(r.version).toBe('1.0');
  });
});

describe('limits and precision are passed on, not hidden', () => {
  const granules = Array.from({ length: 30 }, (_, i) => ({ scene: `S${i}`, product: 'GCOV', start: '2026-01-01T00:00:00Z', tier: 'BETA', track: 1, frame: 1, direction: 'A', footprint: { type: 'Polygon' as const, coordinates: [] } }));

  it('marks a capped coverage search as truncated and leaves the key out otherwise', () => {
    expect(buildCoverageContext({ lon: 0, lat: 0, total: 250, granules, truncated: true }).truncated).toBe(true);
    expect('truncated' in buildCoverageContext({ lon: 0, lat: 0, total: 30, granules, truncated: false })).toBe(false);
    expect('truncated' in buildCoverageContext({ lon: 0, lat: 0, total: 30, granules })).toBe(false);
    expect(buildContext({ coverage: { lon: 0, lat: 0, total: 250, granules, truncated: true } }).coverage?.truncated).toBe(true);
  });

  it('a request with truncated coverage is valid under the shared request schema', async () => {
    const ctx = buildContext({ coverage: { lon: 0, lat: 0, total: 250, granules, truncated: true } });
    const res = await schemaCheck(buildRequest({ query: 'How many passes?', locale: 'en', level: 'simple', context: ctx }));
    expect(res.errors).toEqual([]);
  });

  it('sends a date only to the precision that was recorded', () => {
    const base = events[0];
    const at = (date: string, date_precision?: string) => buildContext({ event: { ...base, date, date_precision } as SarEvent }).event?.date;
    expect(at('2025-08-02T00:00:00Z', 'day')).toBe('2025-08-02');
    expect(at('2025-08-02T00:00:00Z', 'month')).toBe('2025-08');
    expect(at('2025-08-02T00:00:00Z', 'year')).toBe('2025');
    expect(at('2025-08-02T14:31:00Z', 'minute')).toBe('2025-08-02T14:31:00Z');
    expect(at('2025-08-02T14:31:00Z')).toBe('2025-08-02T14:31:00Z');
  });

  it('no shipped event with day precision is sent with a time of day', () => {
    const dayEvents = events.filter((e) => e.date && e.date_precision === 'day');
    for (const e of dayEvents) expect(buildContext({ event: e }).event?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
