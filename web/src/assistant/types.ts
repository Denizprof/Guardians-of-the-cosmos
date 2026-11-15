// TypeScript mirror of shared/assistant-contract/*.schema.json (contract version 1.x).
// Keep in sync with the schemas; the schemas are the source of truth.

export const CONTRACT_VERSION = '1.0';

export type ExplanationLevel = 'simple' | 'scientific';
export type CitationType = 'observation' | 'derived' | 'reference';
export type Tier = 'BETA' | 'PROVISIONAL' | 'VALIDATED' | 'URGENT RESPONSE';

export interface ContextAcquisition {
  start?: string;
  stop?: string;
  reference?: string;
  secondary?: string;
}

export interface ContextProvenance {
  mission: string;
  sensor?: string;
  granule: string;
  collection?: string;
  tier: Tier;
  crid?: string | null;
  track?: number;
  frame?: number;
  direction?: string;
  polarizations?: string[] | null;
  acquisition: ContextAcquisition;
  processing_date?: string;
  processing: string[];
  product_url?: string;
  credit?: string;
  /** nasa_browse = NASA image as published; derived_by_team = computed by this project. */
  origin: 'nasa_browse' | 'derived_by_team';
}

export interface ContextLayer {
  citation_id: string;
  layer_id: string;
  type: 'observation' | 'derived';
  role: string;
  kind: string;
  product: string;
  legend?: Record<string, unknown> & { units?: string };
  provenance: ContextProvenance;
}

export interface ContextReference {
  citation_id: string;
  label: string;
  url: string;
}

export interface ContextEvent {
  citation_id: string;
  id: string;
  title: string;
  subtitle?: string;
  category: string;
  date?: string | null;
  technique: 'insar' | 'backscatter' | 'timeseries';
  location: { lon: number; lat: number };
  references?: ContextReference[];
}

export interface ContextMapView {
  center: [number, number]; // [lon, lat]
  zoom: number;
  bbox: [number, number, number, number]; // [west, south, east, north]
}

export interface ContextCoverageGranule {
  citation_id: string;
  scene: string;
  product: string;
  start: string;
  tier: string;
  track: number;
  frame: number;
  direction: string;
}

export interface ContextCoverage {
  lon: number;
  lat: number;
  /** Number of products the search listed. Not the full count when `truncated` is set. */
  total: number;
  /** Present (true) only when the search hit its row limit: more products exist than `total`. */
  truncated?: boolean;
  granules: ContextCoverageGranule[];
}

/** A checked statement from the app's knowledge base, retrieved for the current question (contract 1.1). */
export interface ContextKnowledge {
  citation_id: string; // kb:<slug>
  title: string;
  text: string;
  source_label: string;
  url: string;
}

export interface AssistantContext {
  event?: ContextEvent;
  selected_layers?: ContextLayer[];
  map_view?: ContextMapView;
  clicked_location?: { lon: number; lat: number };
  coverage?: ContextCoverage;
  knowledge?: ContextKnowledge[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantRequest {
  version: string;
  query: string;
  locale: string;
  explanation_level: ExplanationLevel;
  context: AssistantContext;
  conversation?: ConversationTurn[];
}

export interface Citation {
  id: string;
  type: CitationType;
  label: string;
  granule?: string;
  url?: string;
  layer_id?: string;
}

export interface AssistantResponse {
  version: string;
  status: 'ok' | 'error' | 'unavailable';
  answer?: { text: string; format: 'markdown' | 'plain' };
  citations?: Citation[];
  confidence?: number;
  limitations?: string[];
  error?: { code: string; message: string };
}

/** Result of AssistantAdapter.health(). */
export interface Health {
  /** ok = gateway reachable and a model is configured. */
  status: 'ok' | 'unavailable' | 'error';
  model_configured: boolean;
  contract_version?: string;
  detail?: string;
}
