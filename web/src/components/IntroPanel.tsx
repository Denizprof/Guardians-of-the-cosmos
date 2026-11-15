import { memo } from 'react';
import type { SarEvent } from '../types';
import { CATEGORY_COLOR, CATEGORY_LABEL, fmtCoord, fmtDate } from '../lib';
import type { CoverageResult } from '../services';
import { stepScene } from '../map/coverageSelect';
import { IconChevron, IconClose } from './icons';
import WeatherSection from './WeatherSection';
import LazySection from './LazySection';

// NASA CMR search UI is only needed once a point has been probed.
const loadEarthdataPanel = () => import('./EarthdataPanel');

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
  /** Reopen the introduction screen (About view only). */
  onShowIntro?: () => void;
  /** Go back to the front page, the full-screen explanation shown on a first visit (About view only). */
  onShowFront?: () => void;
  /** Start the interactive tutorial (About view only). */
  onShowTutorial?: () => void;
  /** Coverage probe: the one product currently shown on the map (null = none). */
  selectedScene?: string | null;
  onSelectScene?: (scene: string | null) => void;
}

const TECHNIQUE: Record<SarEvent['technique'], string> = {
  insar: 'Interferometry: ground motion',
  backscatter: 'Backscatter: water and surfaces',
  timeseries: 'Time series: change over months',
};

function Coverage({ c, selectedScene, onSelectScene }: { c: CoverageResult; selectedScene: string | null; onSelectScene: (scene: string | null) => void }) {
  const selIndex = c.granules.findIndex((g) => g.scene === selectedScene);
  const sel = selIndex >= 0 ? c.granules[selIndex] : null;
  const byTier = c.granules.reduce<Record<string, number>>((m, g) => ((m[g.tier] = (m[g.tier] ?? 0) + 1), m), {});
  const byProduct = c.granules.reduce<Record<string, number>>((m, g) => ((m[g.product] = (m[g.product] ?? 0) + 1), m), {});
  const tracks = new Set(c.granules.map((g) => `${g.track}${g.direction[0]}`));
  return (
    <div className="section">
      <h3 style={{ margin: 0 }}>NISAR data at this point</h3>
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
              <div className="muted fine">products{c.truncated ? ' (list capped)' : ''}</div>
            </div>
            <div>
              <div className="stat">{tracks.size}</div>
              <div className="muted fine">orbit tracks{c.truncated ? ' (in list)' : ''}</div>
            </div>
            <div>
              <div className="stat stat-date">{fmtDate(c.granules.at(-1)?.start)}</div>
              {/* with a capped list the oldest listed product is not necessarily the first acquisition */}
              <div className="muted fine">{c.truncated ? 'oldest listed' : 'earliest'} → {fmtDate(c.granules[0]?.start)}</div>
            </div>
          </div>
          {(c.urgentResponse ?? 0) > 0 && (
            <p className="faint fine" style={{ marginTop: 6 }}>{c.urgentResponse} Urgent Response product(s) here are not listed (tasked acquisitions).</p>
          )}
          <div className="row" style={{ gap: 6, marginTop: 10 }}>
            {Object.entries(byTier).map(([t, n]) => (
              <span key={t} className={`tier ${t.split(' ')[0]}`}>{t} {n}</span>
            ))}
            {Object.entries(byProduct).map(([t, n]) => (
              <span key={t} className="badge">{t} {n}</span>
            ))}
          </div>
          {sel ? (
            <div className="coverage-viewer" role="group" aria-label="Selected product">
              <div className="row spread" style={{ flexWrap: 'nowrap' }}>
                <span className="mono">{selIndex + 1} of {c.granules.length}</span>
                <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <button type="button" className="btn" aria-label="Previous product (newer)" disabled={selIndex === 0} onClick={() => onSelectScene(stepScene(c.granules, sel.scene, -1))}>‹ Prev</button>
                  <button type="button" className="btn" aria-label="Next product (older)" disabled={selIndex === c.granules.length - 1} onClick={() => onSelectScene(stepScene(c.granules, sel.scene, 1))}>Next ›</button>
                  <button type="button" className="btn" aria-label="Hide this product" onClick={() => onSelectScene(null)}>Hide</button>
                </span>
              </div>
              {sel.browse || sel.thumb ? (
                <img src={sel.browse ?? sel.thumb} alt={`NASA browse picture of the NISAR ${sel.product} product acquired ${fmtDate(sel.start)}`} />
              ) : (
                <p className="muted">NASA published no browse picture for this product.</p>
              )}
              <div className="mono">{fmtDate(sel.start)} <span className="faint">{sel.start.slice(11, 16)} UTC</span></div>
              <div className="muted fine">
                {sel.product} · track {sel.track} {sel.direction.toLowerCase()} · frame {sel.frame} · <span className={`tier ${sel.tier.split(' ')[0]}`}>{sel.tier}</span>
              </div>
              <p className="faint fine" style={{ margin: '6px 0 0' }}>
                The map shows this product only: its footprint outline and this picture, placed on the footprint's bounding box (approximate, about a kilometre). NASA browse rendering: for looking, not measuring.
              </p>
            </div>
          ) : (
            <p className="callout" style={{ marginTop: 10 }}>Choose a product to see its picture and footprint on the map. Only one product is drawn at a time.</p>
          )}
          <ul className="coverage-list" aria-label="NISAR products at this point">
            {c.granules.map((g) => (
              <li key={g.scene}>
                <button type="button" className="coverage-item" aria-pressed={g.scene === selectedScene} onClick={() => onSelectScene(g.scene === selectedScene ? null : g.scene)}>
                  {g.thumb ? <img src={g.thumb} alt="" loading="lazy" /> : <span />}
                  <span>
                    <span className="mono" style={{ display: 'block' }}>{fmtDate(g.start)} <span className="faint">{g.start.slice(11, 16)} UTC</span></span>
                    <span className="muted fine" style={{ display: 'block' }}>
                      {g.product} · track {g.track} {g.direction.toLowerCase()} · frame {g.frame}
                    </span>
                    <span className={`tier ${g.tier.split(' ')[0]}`}>{g.tier}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="faint fine" style={{ marginTop: 8 }}>
            Live from the ASF DAAC search API. Pictures are NASA browse renderings of each product.
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
        {p.coverage && p.coverageState === 'idle' && <Coverage c={p.coverage} selectedScene={p.selectedScene ?? null} onSelectScene={p.onSelectScene ?? (() => {})} />}
        {p.probe && (
          <div className="section">
            <LazySection load={loadEarthdataPanel} fallback={<p className="muted small" role="status">Loading the NASA Earthdata search…</p>}>
              {(EarthdataPanel) =>
                p.probe && <EarthdataPanel key={`${p.probe.lon},${p.probe.lat},${p.probe.date}`} lon={p.probe.lon} lat={p.probe.lat} date={p.probe.date} windowDays={p.probe.date ? 7 : 3} />
              }
            </LazySection>
          </div>
        )}

        {p.probe && (
          <div className="section">
            <WeatherSection key={`${p.probe.lon},${p.probe.lat},${p.probe.date}`} lon={p.probe.lon} lat={p.probe.lat} date={p.probe.date} />
          </div>
        )}

        {!probing && (
          <>
            <div className="section summary">
              <p>
                Explore how Earth’s surface changes: geohazards, fire and forests, climate and ice, water, ecosystems and human activity. Investigations compare genuine satellite observations from before and after, led by NISAR, the NASA–ISRO radar that sees through clouds and darkness every 12 days. Every layer says whether it is an observation, a derived measurement or an interpretation.
              </p>
              {p.onShowFront && (
                <button type="button" className="btn primary about-front" onClick={p.onShowFront}>Back to the front page</button>
              )}
              {p.onShowTutorial && (
                <button type="button" className="btn about-front" onClick={p.onShowTutorial}>Start the interactive tutorial</button>
              )}
              {p.onShowIntro && (
                <button type="button" className="btn" onClick={p.onShowIntro}>Show the introduction again</button>
              )}
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
          <div className="section">
            <h3>Data credits</h3>
            <dl className="credits">
              <dt>Radar imagery</dt>
              <dd>NISAR L-band, NASA/JPL-Caltech &amp; ISRO, distributed by ASF DAAC.</dd>
              <dt>Context markers</dt>
              <dd>USGS (earthquakes M6.3+) and NASA EONET, past 12 months; wildfires past 30 days. Floods that EONET records only as an area, not a point, are not shown.</dd>
              <dt>Globe imagery</dt>
              <dd>Sentinel-2 cloudless 2024 – <a href="https://cloudless.eox.at" target="_blank" rel="noopener">https://cloudless.eox.at</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0.</dd>
              <dt>Close-up imagery</dt>
              <dd>Esri World Imagery (Esri, Maxar, Earthstar Geographics and the GIS User Community), shown when zoomed in close.</dd>
              <dt>Terrain</dt>
              <dd>Mapzen/AWS Terrain Tiles.</dd>
              <dt>Borders and place names</dt>
              <dd>© OpenStreetMap contributors, OpenMapTiles, served by OpenFreeMap.</dd>
            </dl>
            <p className="faint fine credits-built">Data package built {fmtDate(p.generated)}.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default memo(IntroPanel);

