import { useEffect, useRef, useState } from 'react';

/** What the tutorial can see of the app: just enough to tell whether the visitor did what a step asks. */
export interface TutorialState {
  selectedId: string | null;
  mode: string;
  level: string;
  /** satellite layers switched on */
  layersOn: number;
  lensOn: boolean;
  /** a point was picked with the coverage probe */
  probed: boolean;
  /** changes each time a place search moves the map */
  flyNonce: number;
  assistantOpen: boolean;
}
/** The app state plus what the tutorial watches itself: how often the visitor turned or zoomed the globe. */
export type TutorialSnapshot = TutorialState & { globeMoved: number };

export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  /** CSS selector of the control to mark (a stable data-tut attribute: labels are translated, selectors are not). */
  target?: string;
  /** `now` against `base`, the snapshot taken when the step began: only what the visitor does during the step counts. */
  done: (now: TutorialSnapshot, base: TutorialSnapshot) => boolean;
  /** Given the state when the step would begin: is there anything left for the visitor to do? If not, the step is passed over. */
  applies?: (start: TutorialSnapshot) => boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: 'globe', title: 'Move the globe', text: 'Drag the globe to turn it, or scroll to zoom in and out.', done: (n, b) => n.globeMoved > b.globeMoved },
  { id: 'investigation', title: 'Open an investigation', text: 'Press Investigations in the top bar, or pick one of the cards at the bottom, and choose an event.', target: '[data-tut="investigations"]', done: (n) => !!n.selectedId },
  { id: 'compare', title: 'Compare before and after', text: 'In the panel, next to Compare, choose Side by side to see the two radar images next to each other.', target: '[data-tut="compare"]', done: (n) => !!n.selectedId && n.mode === 'side' },
  { id: 'level', title: 'Change the explanation level', text: 'Further down the panel, next to What the radar sees, choose Scientific.', target: '[data-tut="level"]', done: (n) => !!n.selectedId && n.level === 'scientific' },
  { id: 'close', title: 'Close the investigation', text: 'Press the X at the top of the panel, or the Escape key, to go back to the globe.', done: (n) => !n.selectedId, applies: (s) => !!s.selectedId },
  { id: 'layers', title: 'Add a satellite layer', text: 'Press Satellite layers and tick any layer. Its colour legend appears under it.', target: '[data-tut="layers"]', done: (n, b) => n.layersOn > b.layersOn },
  { id: 'lens', title: 'Open the SAR lens', text: 'Press SAR lens. The square that appears shows radar instead of a photo; drag it around.', target: '[data-tut="lens"]', done: (n) => n.lensOn, applies: (s) => !s.lensOn },
  { id: 'probe', title: 'Probe NISAR coverage', text: 'Press Coverage probe, then click any point on the globe to list what NISAR recorded there.', target: '[data-tut="probe"]', done: (n) => n.probed, applies: (s) => !s.probed },
  { id: 'search', title: 'Search for a place', text: 'Type a place name or coordinates in the search box and choose a result to fly there.', target: '[data-tut="search"]', done: (n, b) => n.flyNonce !== b.flyNonce },
  { id: 'ask', title: 'Ask the assistant', text: 'Press Ask, or click the satellite circling the globe, to open the assistant.', target: '[data-tut="ask"]', done: (n) => n.assistantOpen, applies: (s) => !s.assistantOpen },
];

interface Props {
  state: TutorialState;
  /** "End tutorial" and the final "Close". */
  onEnd: () => void;
  /** How long "Done" shows before the next step, ms. */
  advanceMs?: number;
}

const ON_GLOBE = '.maplibregl-canvas-container, .maplibregl-canvas';
const DRAG_PX = 24;

/**
 * Interactive tutorial: a small card over the live app that asks the visitor to use each tool and moves on
 * when the app's state shows they did. It never acts for the visitor and never blocks the app: every step can
 * be skipped and the tutorial can be ended at any time.
 */
export default function Tutorial({ state, onEnd, advanceMs = 900 }: Props) {
  const [index, setIndex] = useState(0);
  const [moves, setMoves] = useState(0);
  const [passed, setPassed] = useState(false);
  const now: TutorialSnapshot = { ...state, globeMoved: moves };
  const latest = useRef(now);
  latest.current = now;
  const base = useRef(now);
  const heading = useRef<HTMLHeadingElement>(null);
  // keyboard and screen-reader users start at the card, not somewhere behind it
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const step: TutorialStep | undefined = TUTORIAL_STEPS[index];

  const go = (n: number) => {
    // pass over steps whose starting state leaves nothing to do (closing an investigation that is not open):
    // shown, they would say "Done" at once and move on without the visitor having done anything
    let i = n;
    for (let s = TUTORIAL_STEPS[i]; s?.applies && !s.applies(latest.current); s = TUTORIAL_STEPS[i]) i++;
    base.current = latest.current;
    setPassed(false);
    setIndex(i);
  };

  // the step is done when the app says so
  const isDone = !!step && step.done(now, base.current);
  useEffect(() => {
    if (isDone && !passed) setPassed(true);
  }, [isDone, passed]);
  useEffect(() => {
    if (!passed) return;
    const t = window.setTimeout(() => go(index + 1), advanceMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passed, index, advanceMs]);

  // first step: notice the visitor turning (a real drag, not a click) or zooming the globe
  const watching = step?.id === 'globe';
  useEffect(() => {
    if (!watching) return;
    let from: { x: number; y: number } | null = null;
    const onGlobe = (e: Event) => e.target instanceof Element && !!e.target.closest(ON_GLOBE);
    const down = (e: PointerEvent) => { from = onGlobe(e) ? { x: e.clientX, y: e.clientY } : null; };
    const move = (e: PointerEvent) => {
      if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_PX) return;
      from = null;
      setMoves((m) => m + 1);
    };
    const up = () => { from = null; };
    const wheel = (e: Event) => { if (onGlobe(e)) setMoves((m) => m + 1); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('wheel', wheel, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('wheel', wheel, true);
    };
  }, [watching]);

  // mark the control to press; it may appear later (inside a panel), so look again now and then
  const target = step?.target;
  useEffect(() => {
    if (!target) return;
    let marked: Element | null = null;
    const mark = () => {
      const el = document.querySelector(target);
      if (el !== marked) marked?.classList.remove('tut-target');
      el?.classList.add('tut-target'); // every time: a re-render may have rewritten the class list
      marked = el;
    };
    mark();
    const t = window.setInterval(mark, 500);
    return () => {
      window.clearInterval(t);
      marked?.classList.remove('tut-target');
    };
  }, [target]);

  const total = TUTORIAL_STEPS.length;
  return (
    <aside className="tutorial" role="region" aria-label="Interactive tutorial">
      <div className="tut-head">
        <span className="mono tut-count">{step ? `Step ${index + 1} of ${total}` : ''}</span>
        {step && <button type="button" className="link tut-end" onClick={onEnd}>End tutorial</button>}
      </div>
      <div className="tut-progress" aria-hidden="true">
        {TUTORIAL_STEPS.map((s, i) => (
          <span key={s.id} className={i < index || (i === index && passed) ? 'on' : i === index ? 'now' : ''} />
        ))}
      </div>
      <div aria-live="polite">
        <h2 className="tut-title" ref={heading} tabIndex={-1}>{step ? step.title : 'Tutorial complete'}</h2>
        <p className="tut-text">{step ? step.text : 'You have used every main tool. Explore on your own, or open About to run this tutorial again.'}</p>
      </div>
      <div className="tut-foot">
        {!step ? (
          <button type="button" className="btn primary" onClick={onEnd}>Close</button>
        ) : passed ? (
          <span className="tut-done" role="status">Done</span>
        ) : (
          <button type="button" className="btn" onClick={() => go(index + 1)}>Skip this step</button>
        )}
      </div>
    </aside>
  );
}
