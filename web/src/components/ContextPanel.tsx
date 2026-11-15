import { memo, useEffect, useMemo, useState } from 'react';
import type { ContextEvent } from '../types';
import { CATEGORY_COLOR, CATEGORY_LABEL, fmtCoord, fmtDatePrecise, isCoarseDate, safeHref } from '../lib';
import { detailSource, fetchEventDetails, storedFields, type DetailField, type EventDetails } from '../eventDetails';
import { IconChevron, IconClose, IconExternal } from './icons';
import WeatherSection from './WeatherSection';

interface Props {
  event: ContextEvent;
  collapsed: boolean;
  /** Run the NISAR coverage probe + NASA Earthdata search at this event's place and date. */
  onCheckCoverage: (lon: number, lat: number, date: string | null) => void;
  onClose: () => void;
  onToggleCollapsed: () => void;
}

type Live = { status: 'none' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; details: EventDetails };

function FieldList({ fields }: { fields: DetailField[] }) {
  return (
    <dl className="kv">
      {fields.map((f, i) => (
        <div className="kv-row" key={`${f.label}-${i}`}>
          <dt>{f.label}</dt>
          <dd>
            {f.href ? (
              <a href={f.href} target="_blank" rel="noopener noreferrer">
                {f.value} <IconExternal />
              </a>
            ) : (
              f.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** On-demand panel for a reported / catalog event: everything stored for it, plus the provider's live record. */
function ContextPanel({ event: ev, collapsed, onCheckCoverage, onClose, onToggleCollapsed }: Props) {
  const stored = useMemo(() => storedFields(ev), [ev]);
  const src = useMemo(() => detailSource(ev), [ev]);
  const [live, setLive] = useState<Live>(src ? { status: 'loading' } : { status: 'none' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!src) {
      setLive({ status: 'none' });
      return;
    }
    const ctl = new AbortController();
    setLive({ status: 'loading' });
    fetchEventDetails(ev, ctl.signal)
      .then((details) => !ctl.signal.aborted && setLive({ status: 'ready', details }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setLive({ status: 'error', message: e instanceof Error ? e.message : 'Request failed' });
      });
    return () => ctl.abort();
  }, [ev, src, attempt]);

  const observation = ev.evidence === 'observation';
  const href = safeHref(ev.url);
  const facts: { value: string; label: string }[] = [];
  if (typeof ev.magnitude === 'number') facts.push({ value: `M ${ev.magnitude}`, label: 'magnitude' });
  if (typeof ev.depth_km === 'number') facts.push({ value: `${ev.depth_km} km`, label: 'depth' });
  if (ev.size && typeof ev.size.value === 'number') facts.push({ value: String(ev.size.value), label: ev.size.unit });
  if (typeof ev.deaths === 'number') facts.push({ value: String(ev.deaths), label: 'deaths reported' });
  if (typeof ev.count === 'number') facts.push({ value: String(ev.count), label: 'detections' });

  return (
    <section className={`panel${collapsed ? ' collapsed' : ''}`} aria-label={`${ev.title}: reported event`}>
      <header className="panel-head">
        <div className="kicker">
          <span className="dot" style={{ background: CATEGORY_COLOR[ev.category] ?? '#9aa3ad' }} />
          <span className="kicker-text">
            {CATEGORY_LABEL[ev.category] ?? ev.category} · {fmtDatePrecise(ev.date, ev.date_precision)} · <span className="mono">{fmtCoord(ev.lon, ev.lat)}</span>
          </span>
          <button className="close mobile-only" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
            <IconChevron up={collapsed} />
          </button>
          <button className="close" onClick={onClose} aria-label="Close event details">
            <IconClose />
          </button>
        </div>
        <h2>{ev.title}</h2>
        <div className="sub">{ev.source}</div>
      </header>
      <div className="panel-body">
        <div className="section">
          <span className={`evidence ${observation ? 'observation' : 'reported'}`}>{observation ? 'Satellite thermal detection' : 'Reported event'}</span>
          <div className={`callout${observation ? '' : ' warn'}`}>
            {observation
              ? 'Satellite thermal detection (FIRMS). Hot spots can also be gas flares, volcanoes or industry; not a confirmed wildfire.'
              : 'Reported event from a catalog. Not analyzed or confirmed by satellite in this app.'}
          </div>
          {facts.length > 0 && (
            <div className="facts">
              {facts.map((f) => (
                <div key={f.label}>
                  <div className="stat">{f.value}</div>
                  <div className="stat-label">{f.label}</div>
                </div>
              ))}
            </div>
          )}
          <div className="actions">
            {/* a date known only to the year/month cannot anchor a ±days search window: search without one */}
            <button type="button" className="btn primary" onClick={() => onCheckCoverage(ev.lon, ev.lat, isCoarseDate(ev.date_precision) ? null : (ev.date ?? null))}>
              Satellite data here?
            </button>
            {href && (
              <a className="btn" href={href} target="_blank" rel="noopener noreferrer">
                Source <IconExternal />
              </a>
            )}
          </div>
        </div>

        <div className="section">
          <h3>Stored record</h3>
          <FieldList fields={stored} />
        </div>

        <div className="section">
          {/* a date known only to the year/month cannot give a weather time: ask for current conditions instead */}
          <WeatherSection key={ev.id} lon={ev.lon} lat={ev.lat} date={isCoarseDate(ev.date_precision) ? null : (ev.date ?? null)} precision={ev.date_precision} />
        </div>

        <div className="section">
          <details className="disclosure live-record" open>
            <summary>
              <span>Full record from the source API</span>
              <span className="mono faint">
                {live.status === 'loading' ? 'loading…' : live.status === 'ready' ? `${live.details.fields.length} fields` : live.status === 'error' ? 'unavailable' : 'not available'}
              </span>
            </summary>
            {live.status === 'none' && (
              <p className="muted small">
                This catalog has no public per-event API wired into the app. The stored record above is everything we hold{href ? '; the source link has the provider’s own page.' : '.'}
              </p>
            )}
            {live.status === 'loading' && (
              <p className="muted small" role="status">
                Requesting the full record from {src?.provider}…
              </p>
            )}
            {live.status === 'error' && (
              <div role="alert">
                <p className="small">Could not load the live record: {live.message}. The stored record above is unaffected.</p>
                <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
                  Retry
                </button>
              </div>
            )}
            {live.status === 'ready' && (
              <>
                <FieldList fields={live.details.fields} />
                {live.details.timeline.length > 0 && (
                  <>
                    <h4>Timeline</h4>
                    <ol className="mini-timeline">
                      {live.details.timeline.map((t, i) => (
                        <li key={i}>
                          <span className="mono">{t.date}</span>
                          <span>{t.text}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                {live.details.lists.map((l) => (
                  <div key={l.label}>
                    <h4>
                      {l.label} <span className="faint mono">{l.items.length}</span>
                    </h4>
                    <FieldList fields={l.items} />
                  </div>
                ))}
                <p className="faint small">
                  Live from {live.details.provider}
                  {safeHref(live.details.apiUrl) && (
                    <>
                      {' · '}
                      <a href={safeHref(live.details.apiUrl)} target="_blank" rel="noopener noreferrer">
                        raw API response
                      </a>
                    </>
                  )}
                </p>
              </>
            )}
          </details>
        </div>
      </div>
    </section>
  );
}

export default memo(ContextPanel);
