// The interactive tutorial (components/Tutorial.tsx): a coach card that asks the visitor to use each tool and
// moves on when the app's state shows they did.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Tutorial, { TUTORIAL_STEPS, type TutorialState } from '../../src/components/Tutorial';
import { translate } from '../../src/i18n';

const idle: TutorialState = { selectedId: null, mode: 'swipe', level: 'simple', layersOn: 0, lensOn: false, probed: false, flyNonce: 0, assistantOpen: false };
const step = (id: string) => TUTORIAL_STEPS.find((s) => s.id === id)!;
const withMoves = (s: TutorialState, globeMoved = 0) => ({ ...s, globeMoved });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('tutorial steps', () => {
  it('walk through the app in a sensible order, one tool at a time', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual(['globe', 'investigation', 'compare', 'level', 'close', 'layers', 'lens', 'probe', 'search', 'ask']);
    for (const s of TUTORIAL_STEPS) {
      expect(s.title.length, s.id).toBeGreaterThan(5);
      expect(s.text.length, s.id).toBeGreaterThan(20);
    }
  });

  it('nothing counts as done before the visitor has acted', () => {
    const s = withMoves(idle);
    for (const st of TUTORIAL_STEPS.filter((x) => x.id !== 'close')) expect(st.done(s, s), st.id).toBe(false);
  });

  it('each step is done exactly when the visitor did the thing it asks for', () => {
    const base = withMoves(idle);
    expect(step('globe').done(withMoves(idle, 1), base)).toBe(true);
    expect(step('investigation').done(withMoves({ ...idle, selectedId: 'venezuela-2026' }), base)).toBe(true);
    expect(step('compare').done(withMoves({ ...idle, selectedId: 'x', mode: 'side' }), base)).toBe(true);
    expect(step('compare').done(withMoves({ ...idle, selectedId: 'x', mode: 'overlay' }), base)).toBe(false);
    expect(step('level').done(withMoves({ ...idle, selectedId: 'x', level: 'scientific' }), base)).toBe(true);
    expect(step('close').done(withMoves({ ...idle, selectedId: 'x' }), base)).toBe(false);
    expect(step('close').done(withMoves(idle), base)).toBe(true);
    expect(step('layers').done(withMoves({ ...idle, layersOn: 1 }), base)).toBe(true);
    expect(step('lens').done(withMoves({ ...idle, lensOn: true }), base)).toBe(true);
    expect(step('probe').done(withMoves({ ...idle, probed: true }), base)).toBe(true);
    expect(step('ask').done(withMoves({ ...idle, assistantOpen: true }), base)).toBe(true);
  });

  it('a search only counts when it happened during the search step, not earlier', () => {
    const base = withMoves({ ...idle, flyNonce: 5 });
    expect(step('search').done(base, base)).toBe(false);
    expect(step('search').done(withMoves({ ...idle, flyNonce: 6 }), base)).toBe(true);
  });

  it('a layer that was already on before the layers step does not count: the visitor has to add one', () => {
    const base = withMoves({ ...idle, layersOn: 1 });
    expect(step('layers').done(base, base)).toBe(false);
    expect(step('layers').done(withMoves({ ...idle, layersOn: 2 }), base)).toBe(true);
  });
});

describe('tutorial card', () => {
  const title = () => screen.getByRole('heading', { level: 2 }).textContent;
  const settle = () => act(() => { vi.advanceTimersByTime(1000); });
  /** To the end: skip each step, or wait where the step is already done (closing an investigation that is not open). */
  const skipAll = () => {
    for (let guard = 0; guard < 40 && screen.queryByRole('button', { name: 'Close' }) === null; guard++) {
      const skip = screen.queryByRole('button', { name: 'Skip this step' });
      if (skip) fireEvent.click(skip);
      else settle();
    }
  };

  it('starts on the first step, in a labelled region, and says which step it is', () => {
    render(<Tutorial state={idle} onEnd={() => {}} />);
    expect(screen.getByRole('region', { name: 'Interactive tutorial' })).toBeInTheDocument();
    expect(title()).toBe(TUTORIAL_STEPS[0].title);
    expect(screen.getByText(`Step 1 of ${TUTORIAL_STEPS.length}`)).toBeInTheDocument();
  });

  it('takes keyboard focus when it opens, without trapping it', () => {
    render(<Tutorial state={idle} onEnd={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }));
    screen.getByRole('button', { name: 'End tutorial' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End tutorial' }));
  });

  it('keeps the mark on the control even if the app rewrites its classes', () => {
    const { container } = render(
      <div>
        <button data-tut="investigations">Investigations</button>
        <Tutorial state={idle} onEnd={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    const target = container.querySelector('[data-tut="investigations"]')!;
    target.className = 'tool';
    act(() => { vi.advanceTimersByTime(700); });
    expect(target.classList.contains('tut-target')).toBe(true);
  });

  it('does not move on by itself: the visitor has to do the step', () => {
    render(<Tutorial state={idle} onEnd={() => {}} />);
    settle();
    settle();
    expect(title()).toBe(TUTORIAL_STEPS[0].title);
  });

  it('moves on when the app shows the step was done, after saying so', () => {
    const { rerender } = render(<Tutorial state={idle} onEnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' })); // past "move the globe"
    expect(title()).toBe(step('investigation').title);
    rerender(<Tutorial state={{ ...idle, selectedId: 'venezuela-2026' }} onEnd={() => {}} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(title()).toBe(step('investigation').title); // still shown for a moment
    settle();
    expect(title()).toBe(step('compare').title);
    expect(screen.getByText(`Step 3 of ${TUTORIAL_STEPS.length}`)).toBeInTheDocument();
  });

  it('turning or zooming the globe completes the first step', () => {
    const { container } = render(
      <div>
        <div className="maplibregl-canvas-container"><canvas className="maplibregl-canvas" /></div>
        <Tutorial state={idle} onEnd={() => {}} />
      </div>,
    );
    fireEvent.wheel(container.querySelector('canvas')!, { deltaY: -100 });
    expect(screen.getByText('Done')).toBeInTheDocument();
    settle();
    expect(title()).toBe(step('investigation').title);
  });

  it('Skip this step goes to the next step without doing it; the last skip reaches the end', () => {
    render(<Tutorial state={idle} onEnd={() => {}} />);
    skipAll();
    expect(title()).toBe('Tutorial complete');
    expect(screen.queryByRole('button', { name: 'Skip this step' })).toBeNull();
  });

  it('never shows a step the visitor has nothing to do for: no investigation open means no "close it" step', () => {
    render(<Tutorial state={idle} onEnd={() => {}} />);
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    expect(screen.queryByText('Done')).toBeNull();
    expect(title()).toBe(step('layers').title);
    expect(screen.getByText(`Step 6 of ${TUTORIAL_STEPS.length}`)).toBeInTheDocument();
    settle();
    expect(title()).toBe(step('layers').title); // and it does not move on by itself
  });

  it('still asks to close an investigation that is open', () => {
    const open = { ...idle, selectedId: 'venezuela-2026' };
    const { rerender } = render(<Tutorial state={open} onEnd={() => {}} />);
    for (let i = 0; i < 4; i++) {
      const skip = screen.queryByRole('button', { name: 'Skip this step' });
      if (skip) fireEvent.click(skip);
      else settle(); // "open an investigation" is done by the visitor here
    }
    expect(title()).toBe(step('close').title);
    expect(screen.queryByText('Done')).toBeNull();
    rerender(<Tutorial state={idle} onEnd={() => {}} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    settle();
    expect(title()).toBe(step('layers').title);
  });

  it('passes over the lens, probe and assistant steps when those were already used earlier in the run', () => {
    const { rerender } = render(<Tutorial state={idle} onEnd={() => {}} />);
    rerender(<Tutorial state={{ ...idle, lensOn: true, probed: true, assistantOpen: true }} onEnd={() => {}} />);
    const seen: (string | null)[] = [];
    for (let guard = 0; guard < 20 && screen.queryByRole('button', { name: 'Close' }) === null; guard++) {
      seen.push(title());
      expect(screen.queryByText('Done')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    }
    expect(seen).toEqual(['globe', 'investigation', 'compare', 'level', 'layers', 'search'].map((id) => step(id).title));
    expect(title()).toBe('Tutorial complete');
  });

  it('a step that is shown can always be finished, and one that stops applying mid-step can still be skipped', () => {
    const { rerender } = render(<Tutorial state={idle} onEnd={() => {}} />);
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: 'Skip this step' })); // on "SAR lens"
    expect(title()).toBe(step('lens').title);
    rerender(<Tutorial state={{ ...idle, lensOn: true }} onEnd={() => {}} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    settle();
    expect(title()).toBe(step('probe').title);
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    expect(title()).toBe(step('search').title);
  });

  it('End tutorial and the final Close both hand back to the app', () => {
    const onEnd = vi.fn();
    render(<Tutorial state={idle} onEnd={onEnd} />);
    fireEvent.click(screen.getByRole('button', { name: 'End tutorial' }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    skipAll();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('marks the control to press and unmarks it when the step changes', () => {
    const { container } = render(
      <div>
        <button data-tut="investigations">Investigations</button>
        <Tutorial state={idle} onEnd={() => {}} />
      </div>,
    );
    const target = container.querySelector('[data-tut="investigations"]')!;
    expect(target.classList.contains('tut-target')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    act(() => { vi.advanceTimersByTime(700); });
    expect(target.classList.contains('tut-target')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    act(() => { vi.advanceTimersByTime(700); });
    expect(target.classList.contains('tut-target')).toBe(false);
  });

  it('every sentence has a Turkish version', () => {
    const texts = ['Interactive tutorial', 'Skip this step', 'End tutorial', 'Done', 'Close', 'Tutorial complete', ...TUTORIAL_STEPS.flatMap((s) => [s.title, s.text])];
    render(<Tutorial state={idle} onEnd={() => {}} />);
    skipAll();
    texts.push(screen.getByRole('heading', { level: 2 }).nextElementSibling!.textContent!);
    expect(texts.filter((t) => translate(t, 'tr') === t)).toEqual([]);
    expect(translate('Step 3 of 10', 'tr')).not.toBe('Step 3 of 10');
  });
});
