import { memo } from 'react';
import type { CoverageResult } from '../services';
import { IconChevron, IconClose } from './icons';
import LazySection from './LazySection';

// The chat (and its knowledge base) is loaded only when someone opens it.
const loadAssistantPanel = () => import('../assistant/AssistantPanel').then((m) => ({ default: m.AssistantPanel }));

interface Props {
  collapsed: boolean;
  /** A probed point's NISAR products, when the Coverage probe has been used: the chat can then cite them. */
  coverage?: CoverageResult | null;
  /** Where the globe is looking: the chat can then answer "what am I viewing?". */
  mapView?: { center: [number, number]; zoom: number; bbox: [number, number, number, number] } | null;
  onToggleCollapsed: () => void;
  onClose: () => void;
}

/**
 * The assistant as a side panel of its own, opened from "Ask" in the top bar when no investigation is open.
 * Inside an investigation the same chat lives in that panel, where it also knows the event and its layers.
 */
function AssistantSidePanel({ collapsed, coverage, mapView, onToggleCollapsed, onClose }: Props) {
  return (
    <section className={`panel${collapsed ? ' collapsed' : ''}`} aria-label="Assistant">
      <header className="panel-head">
        <div className="kicker">
          <span className="kicker-text">Global SAR AI</span>
          <button className="close mobile-only" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
            <IconChevron up={collapsed} />
          </button>
          <button className="close" onClick={onClose} aria-label="Close panel">
            <IconClose />
          </button>
        </div>
        <h2>Ask about radar, NISAR, this app or anything else</h2>
      </header>
      <div className="panel-body">
        <div className="section">
          <LazySection load={loadAssistantPanel} fallback={<p className="muted small" role="status">Loading the assistant…</p>}>
            {(AssistantPanel) => <AssistantPanel event={null} coverage={coverage} mapView={mapView} variant="full" />}
          </LazySection>
        </div>
      </div>
    </section>
  );
}

export default memo(AssistantSidePanel);
