import { Suspense, lazy, memo } from 'react';
import type { SarEvent } from '../types';
import { CATEGORY_COLOR, CATEGORY_LABEL, fmtCoord, fmtDate } from '../lib';
import type { CoverageResult } from '../services';
import { IconChevron, IconClose } from './icons';

// NASA CMR search UI is only needed once a point has been probed.
const EarthdataPanel = lazy(() => import('./EarthdataPanel'));

interface Props {
  events: SarEvent[];
  generated: string;
  coverage: CoverageResult | null;
  coverageState: 'idle' | 'loading' | 'error';
  coverageError: string | null;
  coverageMode: boolean;
  probe: { lon: number; lat: number; date: string | null } | null;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onCoverageMode: (v: boolean) => void;
  onClearCoverage: () => void;
  onToggleCollapsed: () => void;
  /** Close control (the panel is on demand: it is not part of the landing view). */
  onClose?: () => void;
}

const TECHNIQUE: Record<SarEvent['technique'], string> = {
  insar: 'Interferometry: ground motion',
  backscatter: 'Backscatter: water and surfaces',
  timeseries: 'Time series: change over months',
};

function Coverage({ c, onClear }: { c: CoverageResult; onClear: () => void }) {
  const byTier = c.granules.reduce<Record<string, number>>((m, g) => ((m[g.tier] = (m[g.tier] ?? 0) + 1), m), {});
  const byProduct = c.granules.reduce<Record<string, number>>((m, g) => ((m[g.product] = (m[g.product] ?? 0) + 1), m), {});
  const tracks = new Set(c.granules.map((g) => `${g.track}${g.direction[0]}`));
  return (
    <div className="section">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>NISAR data at this point</h3>
        <button className="close" onClick={onClear} aria-label="Clear coverage"><IconClose /></button>
      </div>
      <div className="mono muted" style={{ marginTop: 4 }}>
        {c.lat.toFixed(4)}, {c.lon.toFixed(4)}
      </div>
      {c.total === 0 ? (
        <p style={{ marginTop: 10 }}>
          No public routine NISAR GCOV or GUNW products cover this point yet. NISAR maps nearly all land every 12 days, but the public archive has gaps (for example no products from 27 Jul to 10 Aug 2026).
          {(c.urgentResponse ?? 0) > 0 && ` ${c.urgentResponse} Urgent Response product(s) exist here; they are tasked acquisitions and are not listed.`}
        </p>
      ) : (
        <>
          <div className="row" style={{ gap: 20, marginTop: 10 }}>
            <div>
              <div className="stat">{c.total}{c.truncated ? '+' : ''}</div>
              <div className="muted" style={{ fontSize: 12 }}>products{c.truncated ? ' (list capped)' : ''}</div>
            </div>
            <div>
              <div className="stat">{tracks.size}</div>
              <div className="muted" style={{ fontSize: 12 }}>orbit tracks{c.truncated ? ' (in list)' : ''}</div>
            </div>
            <div>
              <div className="stat" style={{ fontSize: 14 }}>{fmtDate(c.granules.at(-1)?.start)}</div>
              {/* with a capped list the oldest listed product is not necessarily the first acquisition */}
              <div className="muted" style={{ fontSize: 12 }}>{c.truncated ? 'oldest listed' : 'earliest'} → {fmtDate(c.granules[0]?.start)}</div>
            </div>
          </div>
          {(c.urgentResponse ?? 0) > 0 && (
            <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{c.urgentResponse} Urgent Response product(s) here are not listed (tasked acquisitions).</p>
          )}
          <div className="row" style={{ gap: 6, marginTop: 10 }}>
            {Object.entries(byTier).map(([t, n]) => (
              <span key={t} className={`tier ${t.split(' ')[0]}`}>{t} {n}</span>
            ))}
            {Object.entries(byProduct).map(([t, n]) => (
              <span key={t} className="badge">{t} {n}</span>
            ))}
          </div>
          <ul className="coverage-list">
            {c.granules.slice(0, 8).map((g) => (
              <li key={g.scene}>
                {g.thumb ? <img src={g.thumb} alt={`NISAR ${g.product} browse thumbnail, ${fmtDate(g.start)}`} loading="lazy" /> : <span />}
                <div>
                  <div className="mono">{fmtDate(g.start)} <span className="faint">{g.start.slice(11, 16)} UTC</span></div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {g.product} · track {g.track} {g.direction.toLowerCase()} · frame {g.frame}
                  </div>
                  <span className={`tier ${g.tier.split(' ')[0]}`}>{g.tier}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            Live from the ASF DAAC search API. Blue outlines on the map are the footprints of the {Math.min(c.granules.length, 80)} most recent products.
          </p>
        </>
      )}
    </div>
  );
}


/**
 * On-demand side panel for everything that is not an investigation:
 *  - "Coverage probe": what NISAR (and other NASA missions) recorded at a probed point;
 *  - "About Global SAR": what the app is, the investigations, the probe and the credits.
 */
function IntroPanel(p: Props) {
  const probing = !!p.coverage || !!p.probe || p.coverageState !== 'idle';
  const at = p.probe ?? (p.coverage ? { lon: p.coverage.lon, lat: p.coverage.lat } : null);
  return (
    <section className={`panel${p.collapsed ? ' collapsed' : ''}`} aria-label={probing ? 'Coverage probe' : 'About Global SAR'}>
      <header className="panel-head">
        <div className="kicker">
          <span className="kicker-text">{probing ? <>Coverage probe{at ? <> · <span className="mono">{fmtCoord(at.lon, at.lat)}</span></> : null}</> : 'NASA Space Apps 2026 · Dancing with the SARs'}</span>
          <button className="close mobile-only" onClick={p.onToggleCollapsed} aria-label={p.collapsed ? 'Expand panel' : 'Collapse panel'}>
            <IconChevron up={p.collapsed} />
          </button>
          {p.onClose && (
            <button className="close" onClick={p.onClose} aria-label="Close panel">
              <IconClose />
            </button>
          )}
        </div>
        <h2>{probing ? 'What satellites recorded here' : 'See what happened. Compare what changed. Understand what the radar sees.'}</h2>
      </header>
      <div className="panel-body">
        {p.coverageState === 'loading' && (
          <div className="section muted" role="status">Searching the ASF archive for NISAR products…</div>
        )}
        {p.coverageState === 'error' && (
          <div className="section">
            <div className="callout warn">{p.coverageError}</div>
          </div>
        )}
        {p.coverage && p.coverageState === 'idle' && <Coverage c={p.coverage} onClear={p.onClearCoverage} />}
        {p.probe && (
          <div className="section">
            <Suspense fallback={<p className="muted small" role="status">Loading the NASA Earthdata search…</p>}>
              <EarthdataPanel key={`${p.probe.lon},${p.probe.lat},${p.probe.date}`} lon={p.probe.lon} lat={p.probe.lat} date={p.probe.date} windowDays={p.probe.date ? 7 : 3} />
            </Suspense>
          </div>
        )}

        {!probing && (
          <>
            <div className="section">
              <p>
                Explore how Earth’s surface changes: geohazards, fire and forests, climate and ice, water, ecosystems and human activity. Investigations compare genuine satellite observations from before and after, led by NISAR, the NASA–ISRO radar that sees through clouds and darkness every 12 days. Every layer says whether it is an observation, a derived measurement or an interpretation.
              </p>
            </div>
            <div className="section">
              <h3>Investigations</h3>
              {p.events.map((e) => (
                <button key={e.id} onClick={() => p.onSelect(e.id)} className="obs inv-row">
                  <span className="dot" style={{ background: CATEGORY_COLOR[e.category] }} />
                  <span className="inv-title">{e.title}</span>
                  <span className="what">
                    {CATEGORY_LABEL[e.category]} · {TECHNIQUE[e.technique]} · {e.layers.length} NISAR scenes
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="section">
          <h3>{probing ? 'Probe another point' : 'What data exists where?'}</h3>
          <p className="muted">Turn on the probe, then click anywhere on Earth to list the real NISAR acquisitions over that point.</p>
          <button className="btn" aria-pressed={p.coverageMode} onClick={() => p.onCoverageMode(!p.coverageMode)}>
            {p.coverageMode ? 'Coverage probe on: click the map' : 'Check NISAR coverage'}
          </button>
        </div>
        {!probing && (
          <div className="section faint small">
            Imagery: NISAR L-band, NASA/JPL-Caltech &amp; ISRO, distributed by ASF DAAC. Context markers: USGS (earthquakes M6.3+) and NASA EONET, past 12 months. Globe imagery: Sentinel-2 cloudless 2024 – <a href="https://cloudless.eox.at" target="_blank" rel="noopener">https://cloudless.eox.at</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0. Terrain: Mapzen/AWS Terrain Tiles. Borders and place names © OpenStreetMap contributors, OpenMapTiles, served by OpenFreeMap. Data package built {fmtDate(p.generated)}.
          </div>
        )}
      </div>
    </section>
  );
}

export default memo(IntroPanel);

