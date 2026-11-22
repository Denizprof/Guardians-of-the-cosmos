// The Simulation Lab guide: a full-screen help page with an animation for each event, and every circle, colour,
// setting and number explained in two registers (Simple / Scientific). Opened from the Lab ("Guide"), from the time bar
// and from the results; "Load this example" fills the Lab with a ready-made scenario.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TOPICS, rangeOf, topicById, type Dual, type HelpEntry, type HelpExample, type HelpTopic, type Level } from '../../sim/helpContent';
import { IconClose } from '../icons';
import { SceneStage } from './HelpScenes';
import './help.css';

const LEVEL_KEY = 'sar.simhelp.level';
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const T = {
  how: { simple: 'How it works', scientific: 'How it is calculated' } as Dual,
  numbers: { simple: 'What the numbers mean', scientific: 'Outputs' } as Dual,
  real: { simple: 'Real events to compare with', scientific: 'Reference events' } as Dual,
  limits: { simple: 'What it cannot do', scientific: 'Limitations' } as Dual,
  settings: { simple: 'Settings, one by one', scientific: 'Parameters' } as Dual,
};

function readLevel(): Level {
  try { return localStorage.getItem(LEVEL_KEY) === 'scientific' ? 'scientific' : 'simple'; } catch { return 'simple'; }
}

function Entries({ items, topic, level }: { items: HelpEntry[]; topic: HelpTopic; level: Level }) {
  return (
    <ul className="help-list">
      {items.map((e) => {
        const range = rangeOf(topic.category, e.key);
        return (
          <li key={e.name} className="help-item">
            {e.swatch && <span className="help-sw" style={{ background: e.swatch }} aria-hidden="true" />}
            <div>
              <b>{e.name}</b>
              {range && <span className="help-range">{range}</span>}
              <p>{e.text[level]}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export interface SimHelpProps {
  topic: string;
  onTopic: (id: string) => void;
  onClose: () => void;
  /** "Load this example": the Lab fills its form with the scenario (nothing is run). */
  onTry: (example: HelpExample) => void;
}

export default function SimHelp({ topic: topicId, onTopic, onClose, onTry }: SimHelpProps) {
  const [level, setLevel] = useState<Level>(readLevel);
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const article = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const topic = topicById(topicId);

  const choose = (l: Level) => {
    setLevel(l);
    try { localStorage.setItem(LEVEL_KEY, l); } catch { /* the level is only a convenience */ }
  };

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // the app behind has its own Escape chain
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !card.current) return;
      const items = [...card.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && card.current.contains(active);
      if (e.shiftKey ? !inside || active === first || active === heading.current : !inside || active === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); before?.focus?.(); };
  }, []);

  useEffect(() => { article.current?.scrollTo?.({ top: 0 }); }, [topicId]);

  return createPortal(
    <div className="help-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={card} className="help-card" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header className="help-head">
          <h1 id="help-title" ref={heading} tabIndex={-1}>Simulation Lab guide</h1>
          <div className="help-level" role="group" aria-label="Reading level">
            <span className="lbl">Language</span>
            <div className="seg">
              <button type="button" aria-pressed={level === 'simple'} onClick={() => choose('simple')}>Simple</button>
              <button type="button" aria-pressed={level === 'scientific'} onClick={() => choose('scientific')}>Scientific</button>
            </div>
          </div>
          <button type="button" className="close" onClick={onClose} aria-label="Close the guide"><IconClose /></button>
        </header>
        <div className="help-body">
          <nav className="help-nav" aria-label="Guide topics">
            {TOPICS.map((t) => (
              <button key={t.id} type="button" aria-current={t.id === topic.id ? 'page' : undefined} onClick={() => onTopic(t.id)}>
                <small>{t.kicker}</small>
                {t.title}
              </button>
            ))}
          </nav>
          <article ref={article} className="help-article" aria-live="polite">
            <p className="help-kicker">{topic.kicker}</p>
            <h2>{topic.title}</h2>
            <p className="help-lede">{topic.intro[level]}</p>

            {topic.scene && <SceneStage key={topic.scene} id={topic.scene} level={level} />}

            {topic.how && (
              <>
                <h3>{T.how[level]}</h3>
                <ol className="help-how">{topic.how[level].map((s) => <li key={s}>{s}</li>)}</ol>
              </>
            )}
            {topic.see && topic.seeTitle && (
              <>
                <h3>{topic.seeTitle[level]}</h3>
                <Entries items={topic.see} topic={topic} level={level} />
              </>
            )}
            {topic.settings && (
              <>
                <h3>{topic.settingsTitle?.[level] ?? T.settings[level]}</h3>
                <Entries items={topic.settings} topic={topic} level={level} />
              </>
            )}
            {topic.numbers && (
              <>
                <h3>{T.numbers[level]}</h3>
                <Entries items={topic.numbers} topic={topic} level={level} />
              </>
            )}
            {topic.real && (
              <>
                <h3>{T.real[level]}</h3>
                <Entries items={topic.real.map((r) => ({ name: r.name, text: r.text }))} topic={topic} level={level} />
              </>
            )}
            {topic.limits && <p className="help-limits"><b>{T.limits[level]}: </b>{topic.limits[level]}</p>}
            {topic.example && (
              <p className="help-try">
                <button type="button" className="btn primary" onClick={() => onTry(topic.example!)}>{topic.example.label}</button>
              </p>
            )}
            <p className="help-foot">Everything here describes hypothetical simulations. Pick “Simple” for everyday words or “Scientific” for the equations and units; your choice is remembered.</p>
          </article>
        </div>
      </div>
    </div>,
    document.body,
  );
}
