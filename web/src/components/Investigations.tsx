import { memo } from 'react';
import { IconClose } from './icons';
import { CATEGORY_COLOR, CATEGORY_LABEL, fmtDate } from '../lib';
import type { SarEvent } from '../types';

const TECHNIQUE: Record<SarEvent['technique'], string> = { insar: 'Ground motion', backscatter: 'Surface change', timeseries: 'Time series' };

function InvestigationCard({ e, onSelect }: { e: SarEvent; onSelect: (id: string) => void }) {
  return (
    <button type="button" className="inv-card" onClick={() => onSelect(e.id)}>
      <span className="inv-kicker">
        <span className="dot" style={{ background: CATEGORY_COLOR[e.category] }} />
        {CATEGORY_LABEL[e.category]}
        <span className="mono faint">{e.date ? fmtDate(e.date) : 'date pending'}</span>
      </span>
      <span className="inv-title">{e.title}</span>
      <span className="inv-sub">
        {TECHNIQUE[e.technique]} · {e.layers.length} NISAR layers
      </span>
    </button>
  );
}

/** Landing strip: the curated investigations, one tap away, without a permanent panel. */
export const InvestigationStrip = memo(function InvestigationStrip({ events, onSelect }: { events: SarEvent[]; onSelect: (id: string) => void }) {
  if (!events.length) return null;
  return (
    <nav className="inv-strip" aria-label="Investigations">
      {events.map((e) => (
        <InvestigationCard key={e.id} e={e} onSelect={onSelect} />
      ))}
    </nav>
  );
});

export const InvestigationsMenu = memo(function InvestigationsMenu({ events, selectedId, onSelect, onClose }: { events: SarEvent[]; selectedId: string | null; onSelect: (id: string) => void; onClose: () => void }) {
  return (
    <aside className="popover inv-menu" aria-label="Investigations list">
      <div className="popover-head">
        <h2>Investigations</h2>
        <button className="close" onClick={onClose} aria-label="Close investigations list">
          <IconClose />
        </button>
      </div>
      <div className="popover-body">
        <p className="muted small">Before and after, from real NISAR radar observations.</p>
        {events.map((e) => (
          <button key={e.id} type="button" className="inv-row" aria-current={e.id === selectedId ? 'true' : undefined} onClick={() => onSelect(e.id)}>
            <span className="dot" style={{ background: CATEGORY_COLOR[e.category] }} />
            <span className="inv-title">{e.title}</span>
            <span className="what">
              {CATEGORY_LABEL[e.category]} · {e.subtitle}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
});
