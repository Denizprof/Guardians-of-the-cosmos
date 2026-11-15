// Pure functions that turn app state into AssistantRequest.context. No I/O, no React.
import type { SarEvent, SarLayer } from '../types';
import type { CoverageResult } from '../services';
import { evidenceOf } from '../lib';
import {
  CONTRACT_VERSION,
  type AssistantContext,
  type AssistantRequest,
  type ContextCoverage,
  type ContextEvent,
  type ContextLayer,
  type ContextMapView,
  type ConversationTurn,
  type ExplanationLevel,
} from './types';

export const MAX_COVERAGE_GRANULES = 25;
export const MAX_CONVERSATION_TURNS = 10;

export const eventCitationId = (eventId: string) => `event:${eventId}`;
export const referenceCitationId = (eventId: string, index: number) => `ref:${eventId}:${index}`;
export const layerCitationId = (layerId: string) => `layer:${layerId}`;
export const granuleCitationId = (scene: string) => `asf:${scene}`;

/** Clip text to the request schema's maxLength (shared/assistant-contract): an over-long field must not get the
 *  whole request rejected by the gateway. */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildEventContext(event: SarEvent): ContextEvent {
  return {
    citation_id: eventCitationId(event.id),
    id: clip(event.id, 100),
    title: clip(event.title, 300),
    subtitle: clip(event.subtitle, 300),
    category: clip(event.category, 30),
    // a date known only to the month or year is sent as "2026-01" / "2026", so the assistant cannot quote a day nobody recorded
    date: event.date ? clip(event.date_precision === 'month' ? event.date.slice(0, 7) : event.date_precision === 'year' ? event.date.slice(0, 4) : event.date, 40) : event.date,
    technique: event.technique,
    location: { lon: event.location.lon, lat: event.location.lat },
    references: event.references.slice(0, 20).map((r, i) => ({ citation_id: referenceCitationId(event.id, i), label: clip(r.label, 300), url: clip(r.url, 1000) })),
  };
}

/**
 * Same evidence rule as the UI badges (lib.ts evidenceOf): NASA browse imagery is an observation, our HDF5
 * computations are derived. A layer the UI labels interpretation / model / simulation cannot be described
 * truthfully with the contract's observation|derived types, so it is left out (null) rather than overstated.
 */
export function buildLayerContext(layer: SarLayer): ContextLayer | null {
  const p = layer.provenance;
  const evidence = evidenceOf(layer);
  if (evidence !== 'observation' && evidence !== 'derived') return null;
  const isBrowse = layer.kind === 'browse';
  return {
    citation_id: layerCitationId(layer.id),
    layer_id: layer.id,
    type: evidence,
    role: layer.role,
    kind: layer.kind,
    product: layer.product,
    ...(layer.legend ? { legend: { ...layer.legend } } : {}),
    provenance: {
      mission: p.mission,
      sensor: p.sensor,
      granule: p.granule,
      collection: p.collection,
      tier: p.tier,
      crid: p.crid,
      track: p.track,
      frame: p.frame,
      direction: p.direction,
      polarizations: p.polarizations,
      acquisition: { ...layer.acquisition },
      processing_date: p.processing_date,
      processing: p.processing.slice(0, 30).map((s) => clip(s, 600)),
      product_url: p.product_url,
      credit: p.credit,
      origin: isBrowse ? 'nasa_browse' : 'derived_by_team',
    },
  };
}

const finite = (n: number) => Number.isFinite(n);

/** Returns undefined when the view is unusable (NaN, wrong shape) rather than sending garbage. */
export function buildMapView(view?: { center: [number, number]; zoom: number; bbox: [number, number, number, number] } | null): ContextMapView | undefined {
  if (!view) return undefined;
  const { center, zoom, bbox } = view;
  if (!Array.isArray(center) || center.length !== 2 || !center.every(finite) || !finite(zoom)) return undefined;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(finite)) return undefined;
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return { center: [r(center[0]), r(center[1])], zoom: Math.round(zoom * 100) / 100, bbox: [r(bbox[0]), r(bbox[1]), r(bbox[2]), r(bbox[3])] };
}

/** Caps the granule list (newest first, as returned by the service) but keeps the true total. */
export function buildCoverageContext(cov: CoverageResult, max = MAX_COVERAGE_GRANULES): ContextCoverage {
  return {
    lon: cov.lon,
    lat: cov.lat,
    total: cov.total,
    granules: cov.granules.slice(0, max).map((g) => ({
      citation_id: granuleCitationId(g.scene),
      scene: g.scene,
      product: g.product,
      start: g.start,
      tier: g.tier,
      track: g.track,
      frame: g.frame,
      direction: g.direction,
    })),
  };
}

export interface ContextInput {
  event?: SarEvent | null;
  layers?: (SarLayer | null | undefined)[];
  mapView?: Parameters<typeof buildMapView>[0];
  clicked?: { lon: number; lat: number } | null;
  coverage?: CoverageResult | null;
}

export function buildContext(input: ContextInput): AssistantContext {
  const ctx: AssistantContext = {};
  if (input.event) ctx.event = buildEventContext(input.event);
  const seen = new Set<string>();
  const layers = (input.layers ?? []).filter((l): l is SarLayer => !!l && !seen.has(l.id) && !!seen.add(l.id));
  const layerCtx = layers.map(buildLayerContext).filter((l): l is ContextLayer => l !== null).slice(0, 12);
  if (layerCtx.length) ctx.selected_layers = layerCtx;
  const mv = buildMapView(input.mapView);
  if (mv) ctx.map_view = mv;
  if (input.clicked && finite(input.clicked.lon) && finite(input.clicked.lat)) ctx.clicked_location = { lon: input.clicked.lon, lat: input.clicked.lat };
  if (input.coverage) ctx.coverage = buildCoverageContext(input.coverage);
  return ctx;
}

/** Every citation id a response may legitimately use for this context. */
export function collectCitationIds(ctx: AssistantContext): Set<string> {
  const ids = new Set<string>();
  if (ctx.event) {
    ids.add(ctx.event.citation_id);
    ctx.event.references?.forEach((r) => ids.add(r.citation_id));
  }
  ctx.selected_layers?.forEach((l) => ids.add(l.citation_id));
  ctx.coverage?.granules.forEach((g) => ids.add(g.citation_id));
  ctx.knowledge?.forEach((k) => ids.add(k.citation_id));
  return ids;
}

export function buildRequest(args: {
  query: string;
  locale: string;
  level: ExplanationLevel;
  context: AssistantContext;
  conversation?: ConversationTurn[];
}): AssistantRequest {
  const req: AssistantRequest = {
    version: CONTRACT_VERSION,
    query: args.query.trim().slice(0, 2000),
    locale: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(args.locale) ? args.locale : 'en',
    explanation_level: args.level,
    context: args.context,
  };
  const turns = (args.conversation ?? []).slice(-MAX_CONVERSATION_TURNS).map((t) => ({ role: t.role, content: t.content.slice(0, 8000) }));
  if (turns.length) req.conversation = turns;
  return req;
}
