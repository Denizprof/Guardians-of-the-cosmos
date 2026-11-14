// Introduction: a four-step guided tour (what it is, investigations, tools, before you start), then Get started.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Welcome from '../../src/components/Welcome';
import { INTRO_SEEN_KEY, INTRO_VERSION, markIntroSeen, shouldShowIntro } from '../../src/app/introSeen';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('first-visit memory', () => {
  it('shows the intro on a first visit to the landing view', () => {
    expect(shouldShowIntro({ event: null })).toBe(true);
  });
  it('does not show it again once the visitor has seen it', () => {
    markIntroSeen();
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe(INTRO_VERSION);
    expect(shouldShowIntro({ event: null })).toBe(false);
  });
  it('shows a redesigned intro once more to someone who only saw an older version', () => {
    localStorage.setItem(INTRO_SEEN_KEY, '2');
    expect(shouldShowIntro({ event: null })).toBe(true);
  });
  it('a shared link to an investigation goes straight to it, even on a first visit', () => {
    expect(shouldShowIntro({ event: 'venezuela-2026' })).toBe(false);
  });
  it('still works when browser storage is blocked (private mode): intro shows, nothing throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(shouldShowIntro({ event: null })).toBe(true);
    expect(() => markIntroSeen()).not.toThrow();
  });
});

describe('Welcome tour', () => {
  const setup = () => {
    const onClose = vi.fn();
    const onCredits = vi.fn();
    render(<Welcome onClose={onClose} onCredits={onCredits} />);
    return { onClose, onCredits, dialog: screen.getByRole('dialog', { name: /Global SAR/ }) };
  };
  const next = () => userEvent.click(screen.getByRole('button', { name: 'Next' }));

  it('is a modal dialog that opens on the first step with the title and a Next button', () => {
    const { dialog } = setup();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 1 })).toHaveTextContent('Global SAR: see how Earth changes, by radar');
    expect(within(dialog).getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Step 1 of 4/);
  });

  it('steps through the four parts in order and ends with Get started', async () => {
    const { dialog } = setup();
    await next();
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('Start with an investigation');
    await next();
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('Explore with the tools');
    await next();
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('Before you start');
    expect(within(dialog).getAllByRole('button').at(-1)).toHaveAccessibleName('Get started');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('Explore with the tools');
  });

  it('moves focus to each step heading, so a screen reader starts at the top', async () => {
    const { dialog } = setup();
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { level: 1 }));
    await next();
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { level: 2 }));
  });

  it('lists the five shipped investigations and both explanation levels', async () => {
    const { dialog } = setup();
    await next();
    const list = within(dialog).getByRole('list', { name: /five investigations/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(dialog).toHaveTextContent(/Simple/);
    expect(dialog).toHaveTextContent(/Scientific/);
  });

  it('explains every main tool by the name on its toolbar button', async () => {
    const { dialog } = setup();
    await next();
    await next();
    const tools = within(dialog).getByRole('list', { name: /How to use/ });
    for (const name of ['Investigations', 'Filters', 'Satellite layers', 'SAR lens', 'Coverage probe', 'Search']) {
      expect(within(tools).getByText(name)).toBeInTheDocument();
    }
    expect(within(tools).getAllByRole('listitem')).toHaveLength(6);
    expect(dialog).toHaveTextContent(/colour legend/i);
  });

  it('says honestly what the tool is not, and names the real data sources', async () => {
    const { dialog, onCredits } = setup();
    await next();
    await next();
    await next();
    expect(dialog).toHaveTextContent(/not a live emergency alert/i);
    expect(dialog).toHaveTextContent(/our own analysis, not official NASA products/i);
    expect(dialog).toHaveTextContent(/NISAR/);
    expect(dialog).toHaveTextContent(/ISRO/);
    await userEvent.click(within(dialog).getByRole('button', { name: /full credits/i }));
    expect(onCredits).toHaveBeenCalledOnce();
  });

  it('the arrow keys change step', async () => {
    const { dialog } = setup();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('Start with an investigation');
    await userEvent.keyboard('{ArrowLeft}');
    expect(within(dialog).getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('Skip tour closes it from any step but the last', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Get started on the last step closes it', async () => {
    const { onClose } = setup();
    await next();
    await next();
    await next();
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape closes it, and the key does not leak to the app behind', async () => {
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    const { onClose } = setup();
    await userEvent.keyboard('{Escape}');
    window.removeEventListener('keydown', outer);
    expect(onClose).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus inside while open (Tab wraps from the last control to the first)', async () => {
    const { dialog } = setup();
    const buttons = within(dialog).getAllByRole('button');
    buttons.at(-1)!.focus();
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

import shipped from '../../public/data/events.json';

describe('intro text matches the shipped data', () => {
  it('the five investigations in the tour are the ones the app ships', () => {
    const events = (shipped as { events: { category: string }[] }).events;
    expect(events.map((e) => e.category).sort()).toEqual(['deforestation', 'earthquake', 'flood', 'volcano', 'wildfire']);
  });
});
