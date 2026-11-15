import { useEffect, useRef } from 'react';
import LangSwitch from './LangSwitch';

interface Props {
  /** "Get started" / "Open the app": leave the front page for the tool. */
  onStart: () => void;
  /** Leave the front page and open the four-step guided tour (components/Welcome.tsx) over the tool. */
  onTour: () => void;
}

/** Named exactly as on the toolbar buttons. Every sentence is something the app does (tests check the numbers). */
const TOOLS: { n: string; name: string; text: string }[] = [
  { n: '01', name: 'Investigations', text: 'Open a case study, such as an earthquake, a flood or a wildfire, and step through its radar scenes on a timeline.' },
  { n: '02', name: 'Filters', text: 'Choose which events appear on the globe: earthquakes, tsunamis, active fires, eruptions, flood alerts and landslides, from six public catalogs.' },
  { n: '03', name: 'Satellite layers', text: 'Lay any of 20 global datasets over the globe, from daily true-colour imagery to flood water, night lights and crop types. Each has a colour legend.' },
  { n: '04', name: 'SAR lens', text: 'Move a lens across the map to look at the same place in radar instead of in a photo.' },
  { n: '05', name: 'Coverage probe', text: 'Click any point on Earth to list what NISAR has recorded there: how many products, on which dates and orbit tracks.' },
  { n: '06', name: 'Search', text: 'Type a place name, an investigation, or a latitude and longitude to fly straight there.' },
  { n: '07', name: 'Ask', text: 'Put a question to the built-in assistant, or click the satellite circling the globe. It answers from the sources in the app and cites them.' },
  { n: '+', name: 'Simple or Scientific', text: 'Every explanation comes at two levels. Switch between them at any time. The interface is available in English and Turkish.' },
];

/** A radar satellite on its orbit, looking down at the globe. Decorative line drawing. */
function OrbitArt() {
  return (
    <svg className="fp-art" aria-hidden="true" viewBox="0 0 440 440" fill="none" strokeLinecap="round">
      <circle className="fp-art-globe" cx="220" cy="230" r="150" />
      <g className="fp-art-grid">
        <ellipse cx="220" cy="230" rx="150" ry="52" />
        <ellipse cx="220" cy="230" rx="150" ry="104" />
        <ellipse cx="220" cy="230" rx="52" ry="150" />
        <ellipse cx="220" cy="230" rx="104" ry="150" />
        <line x1="70" y1="230" x2="370" y2="230" />
        <line x1="220" y1="80" x2="220" y2="380" />
      </g>
      <ellipse className="fp-art-orbit" cx="220" cy="230" rx="62" ry="196" transform="rotate(24 220 230)" />
      <path className="fp-art-beam" d="M318 66 L250 196 L302 214 Z" strokeLinejoin="round" />
      <path className="fp-art-swath" d="M258 198 L296 211" />
      <g className="fp-art-sat">
        <rect x="306" y="52" width="24" height="16" rx="2" transform="rotate(24 318 60)" />
        <line x1="286" y1="46" x2="304" y2="54" />
        <line x1="332" y1="66" x2="350" y2="74" />
      </g>
    </svg>
  );
}

/**
 * The front page: a screen of its own, shown on a first visit instead of the tool. It says what Global SAR is,
 * who it is for, what it is not, how to use each tool and where the data comes from, and ends with
 * "Get started". The tool loads behind it (inert), so the globe is ready when the visitor arrives.
 */
export default function FrontPage({ onStart, onTour }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="front">
      <header className="fp-bar">
        <div className="fp-brand">
          <b data-no-i18n>GLOBAL SAR</b>
          <span className="mono">Earth change explorer</span>
        </div>
        <div className="fp-bar-actions">
          <LangSwitch />
          <button type="button" className="btn" onClick={onStart}>Open the app</button>
        </div>
      </header>

      <main className="fp-main">
        <section className="fp-hero">
          <div className="fp-hero-text">
            <p className="fp-kicker" lang="en" data-no-i18n>NASA Space Apps Challenge 2026 · Dancing with the SARs</p>
            <h1 ref={heading} tabIndex={-1}>Watch the surface of the Earth change, through radar.</h1>
            <p className="fp-lede">Global SAR is a globe you can explore. It compares real satellite observations from before and after earthquakes, floods, eruptions, fires and forest clearing, so you can see what changed on the ground.</p>
            <p className="fp-sub">It is led by NISAR, the NASA and ISRO radar satellite that sees through clouds and darkness and returns to the same place every 12 days.</p>
            <a className="fp-jump" href="#fp-how" onClick={(e) => { e.preventDefault(); document.getElementById('fp-how')?.scrollIntoView({ block: 'start' }); }}>How it works</a>
          </div>
          <OrbitArt />
        </section>

        <section className="fp-section">
          <h2 className="fp-label">What it is</h2>
          <div className="fp-cols">
            <div>
              <h3>Radar shows what photos cannot</h3>
              <p>A camera needs daylight and a clear sky. Radar sends its own signal, so it records the ground at night and through cloud, smoke and rain, which is exactly when disasters happen.</p>
            </div>
            <div>
              <h3>Before and after, side by side</h3>
              <p>Each investigation places radar scenes from before and after an event on the globe and explains what the difference means, in plain words or in scientific detail.</p>
            </div>
            <div>
              <h3>Every layer says what it is</h3>
              <p>Each layer is labelled as an observation, a measurement we derived, or an interpretation. Sources and known limits are shown next to the results.</p>
            </div>
          </div>
        </section>

        <section className="fp-section fp-two">
          <div>
            <h2 className="fp-label">Who it is for</h2>
            <p className="fp-big">Students and teachers, journalists, emergency and environmental analysts, and anyone curious about how the planet is changing.</p>
          </div>
          <div>
            <h2 className="fp-label">What it is not</h2>
            <p>It is not a live emergency alert system. Do not use it to decide whether a place is safe right now.</p>
            <p>The investigations are our own analysis of public data. They are not official NASA products.</p>
          </div>
        </section>

        <section className="fp-section" id="fp-how">
          <h2 className="fp-label">How to use it</h2>
          <p className="fp-how-title">Seven tools, all on the bar at the top of the globe.</p>
          <ol className="fp-tools" aria-label="The tools">
            {TOOLS.map((t) => (
              <li key={t.name}>
                <span className="fp-num" aria-hidden="true" data-no-i18n>{t.n}</span>
                <div>
                  <h3>{t.name}</h3>
                  <p>{t.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="fp-section">
          <h2 className="fp-label">Where the data comes from</h2>
          <p className="fp-sources">NISAR radar from NASA/JPL-Caltech and ISRO, distributed by the Alaska Satellite Facility. Global layers from NASA GIBS and OPERA, ESA WorldCereal, the Joint Research Centre of the European Commission, the University of Maryland and EOX. Event catalogs from USGS, NOAA, NASA FIRMS, GDACS and the NASA Global Landslide Catalog. Full credits are in the app, under About.</p>
        </section>

        <section className="fp-section fp-end">
          <p className="fp-end-title">That is all you need to know. The globe is waiting.</p>
          <div className="fp-end-actions">
            <button type="button" className="btn primary fp-start" onClick={onStart}>
              Get started
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h12M10 4l5 5-5 5" /></svg>
            </button>
            <button type="button" className="link fp-tour" onClick={onTour}>Take the guided tour</button>
          </div>
          <p className="fp-fine">Runs in your browser. No account and nothing to install.</p>
        </section>
      </main>

      <footer className="fp-foot">
        <span>Global SAR, built for the NASA Space Apps Challenge 2026</span>
        <span>Not affiliated with or endorsed by NASA or ISRO</span>
      </footer>
    </div>
  );
}
