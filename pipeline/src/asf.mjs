// Thin client for the public ASF SearchAPI (no login required).
const API = 'https://api.daac.asf.alaska.edu/services/search/param';

/** Look up granules by exact scene name. Returns Map<sceneName, GeoJSON feature>. */
export async function searchGranules(names) {
  const out = new Map();
  for (let i = 0; i < names.length; i += 20) {
    const chunk = names.slice(i, i + 20);
    const url = `${API}?${new URLSearchParams({ dataset: 'NISAR', output: 'geojson', granule_list: chunk.join(',') })}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ASF SearchAPI HTTP ${res.status}`);
    const json = await res.json();
    for (const f of json.features) {
      // Prefer standard products over Urgent Response duplicates.
      const key = f.properties.sceneName;
      if (!out.has(key) || !String(f.properties.collectionName).startsWith('NISAR_UR')) out.set(key, f);
    }
  }
  return out;
}

/**
 * BETA / PROVISIONAL / VALIDATED / URGENT RESPONSE from the CMR collection name.
 * A missing or unrecognised name is 'UNKNOWN': VALIDATED is a quality claim and is only returned
 * for a name that positively matches the plain standard-product pattern (e.g. NISAR_L2_GCOV_V1).
 */
export function tierOf(collection = '') {
  if (typeof collection !== 'string') return 'UNKNOWN';
  if (collection.startsWith('NISAR_UR')) return 'URGENT RESPONSE';
  if (collection.includes('_BETA_')) return 'BETA';
  if (collection.includes('_PROVISIONAL_')) return 'PROVISIONAL';
  if (/^NISAR_L\d_[A-Z0-9]+_V\d+$/.test(collection)) return 'VALIDATED';
  return 'UNKNOWN';
}

const ts = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;

/** Parse the parts of a NISAR file name we display (JPL D-102255 naming convention). */
export function parseGranuleName(name) {
  const product = name.split('_')[3]; // NISAR_L2_PR_<PRODUCT>_...
  const stamps = name.match(/\d{8}T\d{6}/g) || [];
  const crid = (name.match(/_([XPV]\d{5})_/) || [])[1] || null;
  const meta = { product, crid, startDate: stamps[0]?.slice(0, 8), start: stamps[0] && ts(stamps[0]) };
  if (product === 'GUNW' && stamps.length >= 4) {
    meta.secondaryDate = stamps[2].slice(0, 8);
    meta.secondaryStart = ts(stamps[2]);
  }
  return meta;
}
