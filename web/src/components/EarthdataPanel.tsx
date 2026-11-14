import { safeHref } from '../lib';
import { useEffect, useState } from 'react';
import { queryEarthdata, windowAround, type EarthdataResult } from '../earthdata';
import './earthdata.css';

export interface EarthdataPanelProps {
  lon: number;
  lat: number;
  /** ISO date of the event. null = no date known: the panel asks nothing and shows a hint. */
  date: string | null;
  /** Half-width of the time window around `date` (default 3 days). */
  windowDays?: number;
  onClose?: () => void;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: EarthdataResult };

const fmt = new Intl.NumberFormat('en-US');
const day = (iso: string) => iso.slice(0, 10);

export default function EarthdataPanel({ lon, lat, date, windowDays = 3, onClose }: EarthdataPanelProps) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!date || Number.isNaN(Date.parse(date))) return;
    const ctl = new AbortController();
    setState({ status: 'loading' });
    const { start, end } = windowAround(date, windowDays);
    queryEarthdata({ lon, lat, start, end, signal: ctl.signal })
      .then((result) => !ctl.signal.aborted && setState({ status: 'ready', result }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setState({ status: 'error', message: e instanceof Error ? e.message : 'Request failed' });
      });
    return () => ctl.abort();
  }, [lon, lat, date, windowDays, attempt]);

  return (
    <section className="edp" aria-label="NASA Earthdata available here" aria-busy={state.status === 'loading' && !!date}>
      <header className="edp-head">
        <h3>NASA Earthdata available here</h3>
        {onClose && (
          <button type="button" className="edp-close" onClick={onClose} aria-label="Close Earthdata panel">
            ×
          </button>
        )}
      </header>
      <p className="edp-note">
        Lists NASA collections that hold data covering this point and time window (±{windowDays} days). Availability does not mean the event is visible in that data.
      </p>

      {!date || Number.isNaN(Date.parse(date)) ? (
        <p className="edp-state muted">No event date, so no time window to search.</p>
      ) : state.status === 'loading' ? (
        <p className="edp-state muted" role="status">Searching NASA CMR…</p>
      ) : state.status === 'error' ? (
        <div className="edp-state" role="alert">
          <p>Could not reach NASA CMR: {state.message}</p>
          <button type="button" className="edp-retry" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </div>
      ) : state.result.totalCollections === 0 && (state.result.uncheckedCollections ?? 0) > 0 ? (
        // Every count request failed: that is an error, not "no data here".
        <div className="edp-state" role="alert">
          <p>NASA CMR did not answer the availability checks ({state.result.uncheckedCollections} collections unchecked), so we cannot say whether data exists here.</p>
          <button type="button" className="edp-retry" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </div>
      ) : state.result.totalCollections === 0 ? (
        <p className="edp-state muted">No NASA collections with granules found for this point and window.</p>
      ) : (
        <>
          <p className="edp-summary mono">
            {state.result.totalCollections} collections · {fmt.format(state.result.totalGranules)} granules · {day(state.result.query.start)} to {day(state.result.query.end)}
          </p>
          {(state.result.uncheckedCollections ?? 0) > 0 && (
            <p className="edp-state muted" role="status">
              {state.result.uncheckedCollections} further collections could not be checked (NASA CMR request failed); their availability is unknown.
            </p>
          )}
          {state.result.truncated && <p className="edp-state muted">Showing the first 90 candidate collections; use Earthdata Search for the full list.</p>}
          <ul className="edp-groups">
            {state.result.groups.map((g) => (
              <li key={g.platform} className="edp-group">
                <details open={g.collections.length <= 3 && g.granules > 0}>
                  <summary>
                    <span className="edp-plat">{g.platform}</span>
                    <span className="edp-count mono">{g.collections.length} coll. · {fmt.format(g.granules)} gran.</span>
                  </summary>
                  <ul className="edp-cols">
                    {g.collections.map((c) => (
                      <li key={c.conceptId} className="edp-col">
                        <div className="edp-col-top">
                          <span className="edp-short mono">{c.shortName}{c.version ? ` v${c.version}` : ''}</span>
                          <span className="edp-count mono">{fmt.format(c.granules)}</span>
                        </div>
                        <div className="edp-title">{c.title}</div>
                        <div className="edp-meta faint">
                          {c.provider}
                          {c.processingLevel ? ` · L${c.processingLevel.replace(/^L/i, '')}` : ''}
                          {c.cloudHosted ? ' · cloud-hosted' : ''}
                        </div>
                        <div className="edp-links">
                          <a href={safeHref(c.searchUrl)} target="_blank" rel="noopener noreferrer">Earthdata Search</a>
                          {c.doi && <a href={safeHref(c.doi)} target="_blank" rel="noopener noreferrer">DOI</a>}
                          {c.landingPage && <a href={safeHref(c.landingPage)} target="_blank" rel="noopener noreferrer">Product page</a>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
          <p className="edp-foot">
            <a href={safeHref(state.result.searchUrl)} target="_blank" rel="noopener noreferrer">Open this point and time in Earthdata Search</a>
          </p>
        </>
      )}
    </section>
  );
}
