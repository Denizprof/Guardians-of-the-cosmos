// SYNTHETIC FIXTURE: hand-written events for deterministic component tests.
// These are NOT real NISAR data. Real-data checks live in data-package.test.ts.
import type { SarEvent, SarLayer } from '../../src/types';

const prov = (granule: string, tier: SarLayer['provenance']['tier'] = 'BETA') => ({
  mission: 'NISAR',
  sensor: 'L-SAR (L-band, 24 cm)',
  granule,
  collection: `NISAR_L2_GCOV_${tier}_V1`,
  tier,
  crid: 'X05010',
  track: 114,
  frame: 165,
  direction: 'ASCENDING',
  polarizations: ['HH', 'HV'],
  processing_date: '2026-02-01T00:00:00Z',
  browse_source: 'https://example.invalid/browse.png',
  product_url: 'https://example.invalid/product.h5',
  distributor: 'ASF DAAC',
  credit: 'SYNTHETIC test credit',
  processing: ['SYNTHETIC step one', 'SYNTHETIC step two'],
});
const quad = (w: number, s: number, e: number, n: number): SarLayer['coordinates'] => [[w, n], [e, n], [e, s], [w, s]];

export const syntheticEvent: SarEvent = {
  id: 'synthetic-flood',
  title: 'Synthetic flood',
  subtitle: 'Fixture region',
  category: 'flood',
  date: '2026-01-12T00:00:00Z',
  location: { lon: 33, lat: -24.5 },
  technique: 'backscatter',
  references: [{ label: 'Example reference', url: 'https://example.invalid/ref' }],
  layers: [
    {
      id: 'b1', role: 'before', kind: 'browse', product: 'GCOV', url: 'data/b1.webp', coordinates: quad(32, -25, 34, -24),
      acquisition: { start: '2026-01-05T03:42:32Z' }, provenance: prov('NISAR_L2_PR_GCOV_009_114_A_165_FIXTURE'),
    },
    {
      id: 'a1', role: 'after', kind: 'browse', product: 'GCOV', url: 'data/a1.webp', coordinates: quad(32, -25, 34, -24),
      acquisition: { start: '2026-01-17T03:42:32Z' }, provenance: prov('NISAR_L2_PR_GCOV_010_114_A_165_FIXTURE'),
    },
    {
      id: 'd1', role: 'change', kind: 'water', product: 'GCOV', url: 'data/d1.webp', coordinates: quad(32.5, -24.8, 33.5, -24.2),
      acquisition: { reference: '2026-01-05T03:42:32Z', secondary: '2026-01-17T03:42:32Z' },
      legend: { units: 'water mask', threshold_db: -15.5, classes: { '1': 'water on both dates', '2': 'new water' } },
      provenance: prov('NISAR_L2_PR_GCOV_010_114_A_165_FIXTURE'),
    },
  ],
};

export const syntheticPairEvent: SarEvent = {
  id: 'synthetic-quake',
  title: 'Synthetic earthquake',
  subtitle: 'Fixture pair',
  category: 'earthquake',
  date: null, // exercises the "date pending" branch
  location: { lon: -67.2, lat: 10.6 },
  technique: 'insar',
  references: [],
  layers: [
    {
      id: 'p1', role: 'before', kind: 'los', product: 'GUNW', url: 'data/p1.webp', coordinates: quad(-69, 9.7, -66.6, 10.9),
      acquisition: { reference: '2026-06-01T10:06:57Z', secondary: '2026-06-13T10:06:56Z' },
      legend: { units: 'cm toward satellite (LOS)', vmin: -50, vmax: 50, colormap: 'diverging' },
      provenance: prov('NISAR_L2_PR_GUNW_FIXTURE_A', 'PROVISIONAL'),
    },
    {
      id: 'p2', role: 'after', kind: 'los', product: 'GUNW', url: 'data/p2.webp', coordinates: quad(-69, 9.7, -66.6, 10.9),
      acquisition: { reference: '2026-06-13T10:06:56Z', secondary: '2026-06-25T10:06:55Z' },
      legend: { units: 'cm toward satellite (LOS)', vmin: -50, vmax: 50, colormap: 'diverging' },
      provenance: prov('NISAR_L2_PR_GUNW_FIXTURE_B', 'PROVISIONAL'),
    },
  ],
};
