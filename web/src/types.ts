export type Category = 'earthquake' | 'flood' | 'volcano' | 'wildfire' | 'landslide' | 'glacier' | 'subsidence';

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
}

export type CompareMode = 'swipe' | 'side' | 'overlay';
