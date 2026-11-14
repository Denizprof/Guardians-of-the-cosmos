import { Suspense, lazy, memo } from 'react';
import type { CoverageResult } from '../services';
import { IconChevron, IconClose } from './icons';

// The chat (and its knowledge base) is loaded only when someone opens it.
const AssistantPanel = lazy(() => import('../assistant/AssistantPanel').then((m) => ({ default: m.AssistantPanel })));

interface Props {
  collapsed: boolean;
  /** A probed point's NISAR products, when the Coverage probe has been used: the chat can then cite them. */
  coverage?: CoverageResult | null;
  onToggleCollapsed: () => void;
  onClose: () => void;
}

/**
 * The assistant as a side panel of its own, opened from "Ask" in the top bar when no investigation is open.
 * Inside an investigation the same chat lives in that panel, where it also knows the event and its layers.
 */
function AssistantSidePanel({ collapsed, coverage, onToggleCollapsed, onClose }: Props) {
  return (
    <section className={`panel${collapsed ? ' collapsed' : ''}`} aria-label="Assistant">
      <header className="panel-head">
        <div className="kicker">
          <span className="kicker-text">Global SAR assistant</span>
          <button className="close mobile-only" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
            <IconChevron up={collapsed} />
          </button>
          <button className="close" onClick={onClose} aria-label="Close panel">
            <IconClose />
          </button>
        </div>
        <h2>Ask about radar, NISAR and this app</h2>
      </header>
      <div className="panel-body">
        <div className="section">
          <Suspense fallback={<p className="muted small" role="status">Loading the assistant…</p>}>
            <AssistantPanel event={null} coverage={coverage} variant="full" />
          </Suspense>
        </div>
      </div>
    </section>
  );
}

export default memo(AssistantSidePanel);
