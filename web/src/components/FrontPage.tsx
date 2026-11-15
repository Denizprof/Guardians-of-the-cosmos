import { useEffect, useRef } from 'react';
import LangSwitch from './LangSwitch';

interface Props {
  /** "Get started" / "Open the app": leave the front page for the tool. */
  onStart: () => void;
  /** Leave the front page and open the four-step guided tour (components/Welcome.tsx) over the tool. */
  onTour: () => void;
}

const BASE = import.meta.env.BASE_URL;

/**
 * One entry per tool, named exactly as on its toolbar button, with the steps to use it and a screenshot of the
 * real app (public/front, taken from the running tool). Every sentence is something the app does.
 */
const TOOLS: { n: string; id: string; name: string; text: string; steps: string[]; caption: string }[] = [
  {
    n: '01', id: 'investigations', name: 'Investigations',
    text: 'Worked examples on real NISAR data. Each one compares radar images from before and after an event and explains what changed.',
    steps: [
      'Press Investigations, or pick one of the cards at the bottom of the globe.',
      'Drag the handle on the map to swipe between the before and after images, or switch to Side by side or Overlay.',
      'Click a date on the timeline to change the before or the after image.',
      'Read the explanation at the Simple or the Scientific level.',
    ],
    caption: 'The Limpopo and Incomati floods investigation: radar before and after, split by the swipe handle.',
  },
  {
    n: '02', id: 'filters', name: 'Filters',
    text: 'Decide which events appear on the globe.',
    steps: [
      'Press Filters.',
      'Tick the kinds of change you want to see, such as geohazards, fire and forests, or water.',
      'Switch event catalogs on or off: earthquakes, tsunamis, active fires, eruptions, flood alerts and landslides.',
      'Set a range of years to narrow the events down.',
      'Click any dot on the globe to read about that event.',
    ],
    caption: 'The Filters panel: categories, event catalogs and years.',
  },
  {
    n: '03', id: 'layers', name: 'Satellite layers',
    text: 'Lay any of 20 global datasets over the globe, from daily true-colour imagery to flood water, night lights and crop types.',
    steps: [
      'Press Satellite layers and tick a layer.',
      'Move the slider under it to make the layer more or less transparent.',
      'Read the colour legend to see what each colour means and where that comes from.',
      'Press the i button next to a layer to read what it shows and its known limits.',
    ],
    caption: 'The farmland and crop types layer with its colour legend.',
  },
  {
    n: '04', id: 'lens', name: 'SAR lens',
    text: 'Look at the same place in radar instead of in a photo.',
    steps: [
      'Press SAR lens. A square appears that shows radar inside it.',
      'Drag the square by its handle to move it, and use its corner to resize it.',
      'Expand it to fill the screen, or close it when you are done.',
    ],
    caption: 'The SAR lens over Istanbul: radar inside the square, a photo outside.',
  },
  {
    n: '05', id: 'probe', name: 'Coverage probe',
    text: 'Find out what NISAR has recorded at any point on Earth.',
    steps: [
      'Press Coverage probe, then click a point on the globe.',
      'The panel lists the NISAR products recorded there, with their dates and orbit tracks.',
      'Step through them with Prev and Next to see each one on the map.',
    ],
    caption: 'The coverage probe in Iowa, listing the NISAR products recorded at that point.',
  },
  {
    n: '06', id: 'search', name: 'Search',
    text: 'Fly straight to a place, an investigation or a pair of coordinates.',
    steps: [
      'Type a place name and choose a result to fly there.',
      'Type the name of an investigation to open it.',
      'Type coordinates, such as 41.0, 29.0, to go to an exact point.',
    ],
    caption: 'Searching for Istanbul.',
  },
  {
    n: '07', id: 'ask', name: 'Ask',
    text: 'Put a question about radar, NISAR or the app to the built-in assistant.',
    steps: [
      'Press Ask, or click the satellite circling the globe.',
      'Type a question, or pick one of the examples.',
      'Every answer names its sources. When the app has no source, it says so rather than guessing.',
    ],
    caption: 'The assistant answering a question, with its sources.',
  },
];

/**
 * The front page: a screen of its own, shown on a first visit instead of the tool. It says what Global SAR is,
 * who it is for, what it is not, how to use each tool step by step and where the data comes from, and ends
 * with "Get started". The tool loads behind it (inert), so the globe is ready when the visitor arrives.
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
            <a className="fp-jump" href="#fp-how" onClick={(e) => { e.preventDefault(); document.getElementById('fp-how')?.scrollIntoView({ block: 'start' }); }}>How to use it</a>
          </div>
          {/* 3D render of a radar satellite and its beam over Europe and North Africa: an illustration, not a photograph */}
          <img className="fp-art" src={`${BASE}intro/nisar-earth.webp`} alt="" aria-hidden="true" width={1200} height={984} decoding="async" />
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
          <ul className="fp-moves" aria-label="Moving the globe">
            <li>Drag to turn the globe.</li>
            <li>Scroll or pinch to zoom.</li>
            <li>Right-drag, or use two fingers, to tilt.</li>
          </ul>
          <ol className="fp-tools" aria-label="The tools">
            {TOOLS.map((t) => (
              <li key={t.id} className="fp-tool">
                <figure className="fp-shot">
                  <img src={`${BASE}front/${t.id}.webp`} alt="" width={1200} height={750} loading="lazy" decoding="async" />
                  <figcaption>{t.caption}</figcaption>
                </figure>
                <div className="fp-tool-text">
                  <span className="fp-num" aria-hidden="true" data-no-i18n>{t.n}</span>
                  <h3>{t.name}</h3>
                  <p>{t.text}</p>
                  <ol className="fp-steps">
                    {t.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              </li>
            ))}
          </ol>
          <p className="fp-levels">Every explanation comes at two levels, Simple and Scientific, and you can switch between them at any time. The interface is available in English and Turkish.</p>
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
