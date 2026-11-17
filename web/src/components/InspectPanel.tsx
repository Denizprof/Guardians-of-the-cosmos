import { memo, useEffect, useMemo, useState } from 'react';
import type { ContextEvent, SarEvent } from '../types';
import { CATEGORY_COLOR, CATEGORY_LABEL, fmtCoord, fmtDate } from '../lib';
import { fetchElevation, summarizeArea, type Box, type Elevation } from '../inspect';
import { IconChevron, IconClose } from './icons';
import WeatherSection from './WeatherSection';

interface Props {
  box: Box;
  context: readonly ContextEvent[];
  events: readonly SarEvent[];
  collapsed: boolean;
  onSelectEvent: (id: string) => void;
  onSelectContext: (id: string) => void;
  /** Run the NISAR coverage probe + NASA Earthdata search at the middle of the box. */
  onCheckCoverage: (lon: number, lat: number) => void;
  onClose: () => void;
  onToggleCollapsed: () => void;
}

type Terrain = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; elevation: Elevation };

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtArea = (km2: number) => (km2 >= 100 ? fmtInt(km2) : km2.toFixed(1));
const fmtMetres = (m: number) => `${fmtInt(m)} m`;

/** Terrain height over the box, from the Open-Meteo elevation service (Copernicus DEM). */
function TerrainSection({ box }: { box: Box }) {
  const [state, setState] = useState<Terrain>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setState({ status: 'loading' });
    fetchElevation(box, ctl.signal)
      .then((elevation) => !ctl.signal.aborted && setState({ status: 'ready', elevation }))
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setState({ status: 'error', message: e instanceof Error ? e.message : 'Request failed' });
      });
    return () => ctl.abort();
  }, [box, attempt]);

  return (
    <div className="section">
      <h3>Terrain</h3>
      {state.status === 'loading' && (
        <p className="muted small" role="status">
          Requesting terrain height…
        </p>
      )}
      {state.status === 'error' && (
        <div role="alert">
          <p className="small">Could not load terrain height: {state.message}.</p>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {state.status === 'ready' && (
        <>
          <dl className="kv">
            <div className="kv-row">
              <dt>At the centre</dt>
              <dd>{fmtMetres(state.elevation.centre)}</dd>
            </div>
            <div className="kv-row">
              <dt>Lowest sampled</dt>
              <dd>{fmtMetres(state.elevation.min)}</dd>
            </div>
            <div className="kv-row">
              <dt>Highest sampled</dt>
              <dd>{fmtMetres(state.elevation.max)}</dd>
            </div>
            <div className="kv-row">
              <dt>Mean of samples</dt>
              <dd>{fmtMetres(state.elevation.mean)}</dd>
            </div>
          </dl>
          <p className="muted small">Height above sea level at nine points over the box (Copernicus DEM, about 90 m, through Open-Meteo). Not a survey of the whole area.</p>
        </>
      )}
    </div>
  );
}

/** On-demand panel for a box drawn with Inspect area: its size, the events inside it, terrain and weather. */
function InspectPanel({ box, context, events, collapsed, onSelectEvent, onSelectContext, onCheckCoverage, onClose, onToggleCollapsed }: Props) {
  const sum = useMemo(() => summarizeArea(box, context, events), [box, context, events]);
  const { center } = sum;

  return (
    <section className={`panel${collapsed ? ' collapsed' : ''}`} aria-label="Inspect area">
      <header className="panel-head">
        <div className="kicker">
          <span className="dot" style={{ background: '#6cc4ff' }} />
          <span className="kicker-text">
            Inspect area · <span className="mono">{fmtCoord(center.lon, center.lat)}</span>
          </span>
          <button className="close mobile-only" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
            <IconChevron up={collapsed} />
          </button>
          <button className="close" onClick={onClose} aria-label="Close area details">
            <IconClose />
          </button>
        </div>
        <h2>The area you selected</h2>
        <div className="sub">
          <span className="mono">
            {fmtCoord(box[0], box[3])} to {fmtCoord(box[2], box[1])}
          </span>
        </div>
      </header>
      <div className="panel-body">
        <div className="section">
          <div className="facts">
            <div>
              <div className="stat">{fmtArea(sum.areaKm2)} km²</div>
              <div className="stat-label">area</div>
            </div>
            <div>
              <div className="stat">
                {fmtInt(sum.widthKm)} × {fmtInt(sum.heightKm)} km
              </div>
              <div className="stat-label">width × height</div>
            </div>
            <div>
              <div className="stat">{sum.total}</div>
              <div className="stat-label">catalog events</div>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => onCheckCoverage(center.lon, center.lat)}>
              Satellite data here?
            </button>
          </div>
        </div>

        <div className="section">
          <h3>Events in this area</h3>
          {sum.total === 0 ? (
            <p className="muted small">None of the catalog events loaded in the app (USGS earthquakes, NASA EONET and other catalogs) lie inside this box. That does not mean nothing happened here: the catalogs are a snapshot and not complete.</p>
          ) : (
            <>
              <ul className="inspect-cats">
                {sum.byCategory.map((c) => (
                  <li key={c.category}>
                    <span className="dot" style={{ background: CATEGORY_COLOR[c.category] ?? '#9aa3ad' }} />
                    {CATEGORY_LABEL[c.category] ?? c.category}
                    <span className="mono faint"> {c.count}</span>
                  </li>
                ))}
              </ul>
              {sum.strongestQuake && (
                <p className="small">
                  Strongest earthquake: M{sum.strongestQuake.magnitude?.toFixed(1)}, {fmtDate(sum.strongestQuake.date)}.
                </p>
              )}
              <ul className="inspect-list">
                {sum.top.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="link-btn" onClick={() => onSelectContext(c.id)}>
                      {c.title}
                    </button>
                    <span className="mono faint">
                      {' '}
                      {fmtDate(c.date)}
                      {typeof c.magnitude === 'number' ? ` · M${c.magnitude.toFixed(1)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {sum.total > sum.top.length && <p className="muted small">The largest {sum.top.length} are listed.</p>}
            </>
          )}
        </div>

        {sum.investigations.length > 0 && (
          <div className="section">
            <h3>Investigations here</h3>
            <ul className="inspect-list">
              {sum.investigations.map((e) => (
                <li key={e.id}>
                  <button type="button" className="link-btn" onClick={() => onSelectEvent(e.id)}>
                    {e.title}
                  </button>
                  <span className="mono faint"> {e.subtitle}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <TerrainSection box={box} />

        <div className="section">
          <WeatherSection key={`${center.lon.toFixed(3)},${center.lat.toFixed(3)}`} lon={center.lon} lat={center.lat} date={null} />
        </div>
      </div>
    </section>
  );
}

export default memo(InspectPanel);
