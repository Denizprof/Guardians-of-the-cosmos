import { useEffect, useRef, type ReactNode } from 'react';
import { IconFilters, IconInvestigations, IconLayers, IconLens, IconProbe } from './icons';

interface Props {
  /** "Get started", Escape: close the intro and hand over to the tool. */
  onClose: () => void;
  /** Close the intro and open the About panel, which carries the full data credits. */
  onCredits: () => void;
}

const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);

/** One entry per main control, named exactly as on its toolbar button. Every claim here is something the app does. */
const STEPS: { icon: ReactNode; name: string; text: string }[] = [
  { icon: <IconInvestigations />, name: 'Investigations', text: 'Five worked examples (an earthquake, a flood, a volcano, a forest clearing and a wildfire). Each compares radar images from before and after, with a timeline, and explains what you see at a Simple or Scientific level.' },
  { icon: <IconFilters />, name: 'Filters', text: 'Choose which kinds of events appear on the globe, switch on catalogs of past earthquakes, tsunamis, eruptions, fires, landslides and floods, and set a range of years. Click a marker to read its record.' },
  { icon: <IconLayers />, name: 'Satellite layers', text: 'Lay global satellite datasets over the globe, such as daily true-colour imagery, snow, flood water or night lights. Each layer has a colour legend that says what its colours mean and where that comes from.' },
  { icon: <IconLens />, name: 'SAR lens', text: 'A square you can move and resize. Inside it the same place is shown in radar, from recent NISAR and Sentinel-1 passes. It can be expanded to the full screen.' },
  { icon: <IconProbe />, name: 'Coverage probe', text: 'Click anywhere on Earth to list the real NISAR products recorded over that point, and view each one on its own: its picture and its footprint.' },
  { icon: <IconSearch />, name: 'Search', text: 'Find a place, an investigation or a pair of coordinates and fly there.' },
];

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Introduction shown over the (blurred) live globe on a first visit: what the tool is, who it is for, how to
 * use it and where the data comes from, ending in "Get started". A modal dialog: focus moves in on open, stays
 * inside while it is open, and Escape closes it without reaching the app's own Escape handling.
 *
 * Layout: the text scrolls inside the card; "Get started" sits in a footer that is always in view. On wide
 * screens the explanation and the tool walkthrough sit side by side (reading order is unchanged).
 */
export default function Welcome({ onClose, onCredits }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    title.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // the app behind has its own Escape chain (popover, lens, panel)
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && dialog.current.contains(active);
      if (e.shiftKey ? !inside || active === first || active === title.current : !inside || active === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    // capture phase on the document: runs before, and stops, the app's window-level key handling
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="welcome">
      <div ref={dialog} className="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className="welcome-scroll">
          <header className="welcome-head">
            <p className="welcome-kicker">NASA Space Apps Challenge 2026 · Dancing with the SARs</p>
            <h1 id="welcome-title" ref={title} tabIndex={-1}>
              Global SAR: see how Earth changes, by radar
            </h1>
          </header>

          <div className="welcome-cols">
            <div className="welcome-col">
              <h2>What it is</h2>
              <p className="welcome-lede">
                Global SAR is a 3D globe for exploring real radar observations of Earth, led by NISAR, the NASA and ISRO radar satellite. Radar sends its own signal, so it sees through clouds, smoke and darkness, and it can show things an ordinary photograph cannot: ground that moved by centimetres in an earthquake, or flood water hidden under storm clouds.
              </p>

              <h2>Who it is for</h2>
              <p>
                Students and teachers, journalists, people who work on disasters and the environment, and anyone curious about how our planet changes. You do not need to know anything about radar: every investigation explains what you are looking at.
              </p>
              <p className="welcome-note">
                Please note: this is not a live emergency alert system. The investigations are our own analysis, not official NASA products, and every layer says whether it is an observation, a measurement we derived or an interpretation.
              </p>
            </div>

            <div className="welcome-col">
              <h2>How to use it</h2>
              <ol className="welcome-steps" aria-label="How to use the tools">
                {STEPS.map((s) => (
                  <li key={s.name}>
                    <span className="welcome-icon" aria-hidden="true">{s.icon}</span>
                    <span>
                      <strong>{s.name}</strong>
                      <span className="welcome-step-text">{s.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="muted welcome-hint">Drag to turn the globe, scroll or pinch to zoom, and hold the right mouse button (or use two fingers) to tilt.</p>
            </div>
          </div>

          <div className="welcome-sources">
            <h2>Where the data comes from</h2>
            <p>
              Radar: NISAR (NASA/JPL-Caltech and ISRO), distributed by the Alaska Satellite Facility. Other layers and event records come from NASA (GIBS, FIRMS, EONET, the Global Landslide Catalog), USGS, NOAA, GDACS, the European Commission's JRC, the University of Maryland, Copernicus Sentinel imagery by EOX and OpenStreetMap.{' '}
              <button type="button" className="link" onClick={onCredits}>See the full credits</button>
            </p>
          </div>
        </div>

        <div className="welcome-actions">
          <button type="button" className="btn primary welcome-start" onClick={onClose}>Get started</button>
        </div>
      </div>
    </div>
  );
}
