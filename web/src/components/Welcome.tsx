import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconFilters, IconInvestigations, IconLayers, IconLens, IconProbe } from './icons';

interface Props {
  /** "Get started", "Skip tour", Escape: close the intro and hand over to the tool. */
  onClose: () => void;
  /** Close the intro and open the About panel, which carries the full data credits. */
  onCredits: () => void;
}

const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);

/** One entry per main control, named exactly as on its toolbar button. Every claim here is something the app does. */
const TOOLS: { icon: ReactNode; name: string; text: string }[] = [
  { icon: <IconInvestigations />, name: 'Investigations', text: 'Five worked examples, each comparing radar images from before and after.' },
  { icon: <IconFilters />, name: 'Filters', text: 'Choose event types, switch on catalogs and set a range of years.' },
  { icon: <IconLayers />, name: 'Satellite layers', text: 'Lay global datasets over the globe, each with a colour legend.' },
  { icon: <IconLens />, name: 'SAR lens', text: 'A movable square that shows the same place in radar.' },
  { icon: <IconProbe />, name: 'Coverage probe', text: 'Click anywhere to list the real NISAR products recorded there.' },
  { icon: <IconSearch />, name: 'Search', text: 'Find a place, an investigation or coordinates and fly there.' },
];

/** The five investigations the app ships (checked against events.json by the tests). */
const CASES: { cat: string; label: string; name: string; what: string }[] = [
  { cat: 'earthquake', label: 'Earthquake', name: 'Venezuela earthquakes', what: 'Ground motion in centimetres' },
  { cat: 'flood', label: 'Flood', name: 'Limpopo and Incomati floods', what: 'New flood water under the clouds' },
  { cat: 'volcano', label: 'Volcano', name: 'Krasheninnikov volcano', what: 'Lava fields over five months' },
  { cat: 'deforestation', label: 'Deforestation', name: 'Amazon clear-cut, União do Sul', what: 'Forest loss seen by HV radar' },
  { cat: 'wildfire', label: 'Wildfire', name: 'Aspen Acres wildfire', what: 'Burned canopy in Colorado' },
];

const STEP_TITLES = ['Welcome', 'Investigations', 'Tools', 'Before you start'];
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** A radar satellite sending pulses down to the globe: the idea of the app in one picture. Decorative. */
function RadarArt() {
  return (
    <svg className="tour-art" viewBox="0 0 320 220" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="tour-globe" cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#2f6fb0" />
          <stop offset="0.55" stopColor="#173a63" />
          <stop offset="1" stopColor="#0b1626" />
        </radialGradient>
        <linearGradient id="tour-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9c46a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#e9c46a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="160" cy="250" r="150" fill="url(#tour-globe)" />
      <path d="M40 214c34-20 70-26 104-16s60 6 92-12 60-18 88-6" fill="none" stroke="#3d8c5a" strokeWidth="10" strokeLinecap="round" opacity="0.55" />
      <path d="M186 44 L120 196 L250 196 Z" fill="url(#tour-beam)" />
      {[0, 1, 2].map((i) => (
        <path key={i} className="tour-pulse" style={{ animationDelay: `${i * 0.6}s` }} d="M150 150 Q186 132 222 150" fill="none" stroke="#e9c46a" strokeWidth="2.5" strokeLinecap="round" />
      ))}
      <g className="tour-sat" transform="translate(186 40) rotate(-14)">
        <rect x="-34" y="-7" width="24" height="14" rx="2" fill="#6fb3ff" opacity="0.9" />
        <rect x="10" y="-7" width="24" height="14" rx="2" fill="#6fb3ff" opacity="0.9" />
        <rect x="-10" y="-11" width="20" height="22" rx="4" fill="#e7e9ec" />
        <circle cx="0" cy="13" r="3" fill="#e9c46a" />
      </g>
      <g fill="#e7e9ec" opacity="0.8">
        <circle cx="34" cy="30" r="1.4" /><circle cx="70" cy="70" r="1" /><circle cx="270" cy="24" r="1.6" />
        <circle cx="292" cy="90" r="1" /><circle cx="110" cy="18" r="1" /><circle cx="250" cy="120" r="1.2" />
      </g>
    </svg>
  );
}

/** Before / after illustration: the same field, dark (flooded) after. Decorative. */
function CompareArt() {
  return (
    <svg className="tour-art" viewBox="0 0 320 180" aria-hidden="true" focusable="false">
      <rect x="10" y="20" width="148" height="140" rx="10" fill="#3a4a3a" />
      <rect x="162" y="20" width="148" height="140" rx="10" fill="#3a4a3a" />
      <path d="M10 110c30-10 60 4 90-6s40-8 58-2v58H20a10 10 0 0 1-10-10z" fill="#566b52" />
      <path d="M162 70c30 4 60-10 90 2s40 8 58 4v74a10 10 0 0 1-10 10H172a10 10 0 0 1-10-10z" fill="#0d1a2b" />
      <path d="M162 70c30 4 60-10 90 2s40 8 58 4" fill="none" stroke="#3fa9ff" strokeWidth="2.5" />
      <rect x="157" y="14" width="6" height="152" rx="3" fill="#e7e9ec" />
      <circle cx="160" cy="90" r="13" fill="#e7e9ec" />
      <path d="M154 90h12M154 90l3-3M154 90l3 3M166 90l-3-3M166 90l-3 3" stroke="#111419" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Guided introduction shown over the (blurred) live globe on a first visit, in four short steps: what the tool
 * is, the investigations, the tools, and what to know before starting. A modal dialog: focus moves in on open
 * and to each step's heading as the step changes, stays inside while open; Escape closes it without reaching the
 * app's own Escape handling; the left and right arrow keys change step.
 */
export default function Welcome({ onClose, onCredits }: Props) {
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const last = STEP_TITLES.length - 1;

  useEffect(() => {
    // focus the step heading so a screen reader reads each step from the top
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // the app behind has its own Escape chain (popover, lens, panel)
        close.current();
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      if (!typing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        e.stopPropagation();
        setStep((s) => Math.max(0, Math.min(last, s + (e.key === 'ArrowRight' ? 1 : -1))));
        return;
      }
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && dialog.current.contains(active);
      if (e.shiftKey ? !inside || active === firstEl || active === heading.current : !inside || active === lastEl) {
        e.preventDefault();
        (e.shiftKey ? lastEl : firstEl).focus();
      }
    };
    // capture phase on the document: runs before, and stops, the app's window-level key handling
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [last]);

  const next = () => (step === last ? onClose() : setStep(step + 1));

  return (
    <div className="welcome">
      <div ref={dialog} className="welcome-card tour" role="dialog" aria-modal="true" aria-label="Global SAR introduction">
        <div className="tour-top">
          <p className="welcome-kicker" lang="en">NASA Space Apps Challenge 2026 · Dancing with the SARs</p>
          {step < last && (
            <button type="button" className="link tour-skip" onClick={onClose}>
              Skip tour
            </button>
          )}
        </div>

        <div className="tour-progress" aria-hidden="true">
          {STEP_TITLES.map((t, i) => (
            <span key={t} className={i <= step ? 'on' : ''} />
          ))}
        </div>
        <p className="sr-only" aria-live="polite">{`Step ${step + 1} of ${STEP_TITLES.length}: ${STEP_TITLES[step]}`}</p>

        <div className="welcome-scroll tour-body" key={step}>
          {step === 0 && (
            <section className="tour-step tour-hero">
              <div className="tour-hero-text">
                <h1 id="welcome-title" ref={heading} tabIndex={-1}>
                  Global SAR: see how Earth changes, by radar
                </h1>
                <p className="welcome-lede">
                  A 3D globe for exploring real radar observations of Earth, led by NISAR, the NASA and ISRO radar satellite. Radar sends its own signal, so it can show what an ordinary photograph cannot.
                </p>
                <ul className="tour-facts">
                  <li><b>Sees through clouds</b><span>and smoke, when floods and fires hide from cameras</span></li>
                  <li><b>Works day and night</b><span>because it brings its own signal</span></li>
                  <li><b>Measures centimetres</b><span>of ground motion after an earthquake</span></li>
                </ul>
                <p className="tour-who">
                  <b>Who it is for:</b> students and teachers, journalists, people who work on disasters and the environment, and anyone curious. No radar knowledge needed.
                </p>
              </div>
              <RadarArt />
            </section>
          )}

          {step === 1 && (
            <section className="tour-step">
              <h2 ref={heading} tabIndex={-1}>Start with an investigation</h2>
              <div className="tour-split">
                <div>
                  <p className="welcome-lede">
                    Five worked examples on real NISAR data. Each compares radar images from before and after an event, with a timeline, and explains what you see at a <b>Simple</b> or <b>Scientific</b> level.
                  </p>
                  <CompareArt />
                  <p className="tour-caption">Drag the handle to swipe between before and after, or view them side by side.</p>
                </div>
                <ul className="tour-cases" aria-label="The five investigations">
                  {CASES.map((c) => (
                    <li key={c.cat} className={`tour-case cat-${c.cat}`}>
                      <span className="tour-dot" aria-hidden="true" />
                      <span>
                        <span className="tour-case-cat">{c.label}</span>
                        <b>{c.name}</b>
                        <span className="tour-case-what">{c.what}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="tour-step">
              <h2 ref={heading} tabIndex={-1}>Explore with the tools</h2>
              <p className="tour-sub">Every tool sits in the bar at the top of the screen.</p>
              <ol className="tour-tools" aria-label="How to use the tools">
                {TOOLS.map((s) => (
                  <li key={s.name}>
                    <span className="tour-tool-icon" aria-hidden="true">{s.icon}</span>
                    <b>{s.name}</b>
                    <span className="tour-tool-text">{s.text}</span>
                  </li>
                ))}
              </ol>
              <div className="tour-gestures" aria-label="Moving the globe">
                <span><kbd>Drag</kbd> turn the globe</span>
                <span><kbd>Scroll</kbd> or pinch to zoom</span>
                <span><kbd>Right-drag</kbd> or two fingers to tilt</span>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="tour-step">
              <h2 ref={heading} tabIndex={-1}>Before you start</h2>
              <div className="tour-split">
                <div className="tour-note">
                  <h3>Please note</h3>
                  <p>This is not a live emergency alert system. The investigations are our own analysis, not official NASA products.</p>
                  <p>Every layer says whether it is an observation, a measurement we derived or an interpretation, and known limits are shown next to the results.</p>
                </div>
                <div className="tour-sources">
                  <h3>Where the data comes from</h3>
                  <p>
                    Radar: NISAR (NASA/JPL-Caltech and ISRO), distributed by the Alaska Satellite Facility. Other layers and event records come from NASA (GIBS, FIRMS, EONET, the Global Landslide Catalog), USGS, NOAA, GDACS, the European Commission's JRC, the University of Maryland, Copernicus Sentinel imagery by EOX and OpenStreetMap.
                  </p>
                  <button type="button" className="link" onClick={onCredits}>See the full credits</button>
                </div>
              </div>
              <h3 className="tour-badges-title">Every layer carries a label</h3>
              <ul className="tour-badges" aria-label="Evidence labels">
                <li><span className="tour-badge obs">Observation</span><span>What a satellite recorded, shown as NASA published it.</span></li>
                <li><span className="tour-badge der">Derived measurement</span><span>A number our team computed from the radar, such as centimetres of motion.</span></li>
                <li><span className="tour-badge int">Interpretation</span><span>What we think it means, with the evidence and its limits.</span></li>
              </ul>
            </section>
          )}
        </div>

        <div className="welcome-actions tour-actions">
          <button type="button" className="btn tour-back" onClick={() => setStep(step - 1)} disabled={step === 0} aria-hidden={step === 0} tabIndex={step === 0 ? -1 : 0}>
            Back
          </button>
          <span className="tour-count" aria-hidden="true">{`${step + 1} / ${STEP_TITLES.length}`}</span>
          <button type="button" className="btn primary welcome-start" onClick={next}>
            {step === last ? 'Get started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
