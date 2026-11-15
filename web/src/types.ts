/** Top-level analysis groups (the project owner's taxonomy). */
export type CategoryGroup = 'geohazards' | 'fire-forest' | 'climate' | 'water' | 'ecosystems' | 'human-activity';

/** Event / activity types. Each belongs to exactly one group (see CATEGORY_GROUP in lib.ts). */
export type Category =
  // geohazards
  | 'earthquake' | 'volcano' | 'landslide' | 'subsidence' | 'tsunami'
  // fire & forests
  | 'wildfire' | 'deforestation' | 'vegetation'
  // climate & cryosphere
  | 'glacier' | 'sea-ice' | 'permafrost' | 'coastal-change' | 'drought' | 'desertification'
  // water
  | 'flood' | 'reservoir' | 'river-change' | 'wetland'
  // ecosystems
  | 'habitat-loss' | 'land-degradation' | 'agri-conversion'
  // human activity
  | 'urban' | 'industrial' | 'mining' | 'agriculture' | 'infrastructure' | 'energy' | 'reclamation' | 'conflict-damage' | 'human-other';

/**
 * What a layer IS, scientifically. Shown as a badge on every layer so users never
 * confuse an observation with an interpretation or a model.
 */
export type EvidenceClass = 'observation' | 'derived' | 'interpretation' | 'model' | 'simulation';

export type LonLat = [number, number];

export interface Provenance {
  mission: string;
  sensor: string;
  granule: string;
  collection: string;
  tier: 'BETA' | 'PROVISIONAL' | 'VALIDATED' | 'URGENT RESPONSE';
  crid: string | null;
  track: number;
  frame: number;
  direction: string;
  polarizations: string[] | null;
  processing_date: string;
  browse_source: string;
  product_url: string;
  distributor: string;
  credit: string;
  processing: string[];
  georef_residual_m?: number;
}

export type LayerKind = 'browse' | 'backscatter' | 'change' | 'water' | 'los' | 'coherence';

export interface SarLayer {
  id: string;
  role: 'before' | 'after' | 'timeline' | 'change';
  kind: LayerKind;
  product: 'GCOV' | 'GUNW' | string;
  url: string;
  coordinates: [LonLat, LonLat, LonLat, LonLat]; // TL, TR, BR, BL
  acquisition: { start?: string; stop?: string; reference?: string; secondary?: string };
  /** Scientific nature of the layer; defaults by kind (browse = observation, else derived). */
  evidence?: EvidenceClass;
  /** Present on derived (stage-2) layers: what the colours mean. */
  legend?: { units: string; vmin?: number; vmax?: number; colormap?: string; threshold_db?: number; classes?: Record<string, string> };
  provenance: Provenance;
}

export interface Reference {
  label: string;
  url: string;
}

export interface SarEvent {
  id: string;
  title: string;
  subtitle: string;
  category: Category;
  date: string | null;
  date_precision?: string;
  location: { lon: number; lat: number };
  extra_points?: { label: string; lon: number; lat: number }[];
  technique: 'insar' | 'backscatter' | 'timeseries';
  references: Reference[];
  layers: SarLayer[];
}

export interface ContextEvent {
  id: string;
  title: string;
  category: Category;
  date: string;
  lon: number;
  lat: number;
  magnitude?: number;
  depth_km?: number;
  source: string;
  url: string;
  /** 'reported' (catalog record) or 'observation' (e.g. a FIRMS satellite fire detection). */
  evidence?: 'reported' | 'observation';
  notes?: string;
  size?: { value: number; unit: string };
  deaths?: number;
  date_precision?: string;
  count?: number;
}

export interface CatalogFile {
  source: string;
  provider: string;
  url: string;
  license: string;
  retrieved: string;
  count: number;
  evidence_note?: string;
  /** FIRMS only: grid cells with detections, and how many of them (the strongest) the file keeps. */
  cells_total?: number;
  cells_kept?: number;
  events: ContextEvent[];
}

export type CompareMode = 'swipe' | 'side' | 'overlay';
