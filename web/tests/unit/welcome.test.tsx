// Introduction screen: what the tool is, who it is for, how to use it, where the data comes from, Get started.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Welcome from '../../src/components/Welcome';
import { INTRO_SEEN_KEY, markIntroSeen, shouldShowIntro } from '../../src/app/introSeen';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('first-visit memory', () => {
  it('shows the intro on a first visit to the landing view', () => {
    expect(shouldShowIntro({ event: null })).toBe(true);
  });
  it('does not show it again once the visitor has seen it', () => {
    markIntroSeen();
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe('1');
    expect(shouldShowIntro({ event: null })).toBe(false);
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

describe('Welcome screen', () => {
  const setup = () => {
    const onClose = vi.fn();
    const onCredits = vi.fn();
    render(<Welcome onClose={onClose} onCredits={onCredits} />);
    return { onClose, onCredits, dialog: screen.getByRole('dialog', { name: /Global SAR/ }) };
  };

  it('is a modal dialog with the four sections in order and Get started last', () => {
    const { dialog } = setup();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const headings = within(dialog).getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['What it is', 'Who it is for', 'How to use it', 'Where the data comes from']);
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons.at(-1)).toHaveAccessibleName('Get started');
  });

  it('explains every main tool by the name on its toolbar button, and both explanation levels', () => {
    const { dialog } = setup();
    const steps = within(dialog).getByRole('list', { name: /How to use/ });
    for (const name of ['Investigations', 'Filters', 'Satellite layers', 'SAR lens', 'Coverage probe', 'Search']) {
      expect(within(steps).getByText(name)).toBeInTheDocument();
    }
    expect(within(steps).getAllByRole('listitem')).toHaveLength(6);
    expect(dialog).toHaveTextContent(/Simple/);
    expect(dialog).toHaveTextContent(/Scientific/);
    expect(dialog).toHaveTextContent(/colour legend/i);
  });

  it('says honestly what the tool is not', () => {
    const { dialog } = setup();
    expect(dialog).toHaveTextContent(/not a live emergency alert/i);
    expect(dialog).toHaveTextContent(/our own analysis, not official NASA products/i);
  });

  it('names the real data sources and offers the full credits', async () => {
    const { dialog, onCredits } = setup();
    expect(dialog).toHaveTextContent(/NISAR/);
    expect(dialog).toHaveTextContent(/NASA/);
    expect(dialog).toHaveTextContent(/ISRO/);
    await userEvent.click(within(dialog).getByRole('button', { name: /full credits/i }));
    expect(onCredits).toHaveBeenCalledOnce();
  });

  it('moves focus into the intro when it opens', () => {
    const { dialog } = setup();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Get started closes it', async () => {
    const { onClose } = setup();
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
  it('"Five worked examples (an earthquake, a flood, a volcano, a forest clearing and a wildfire)" is what the app ships', () => {
    const events = (shipped as { events: { category: string }[] }).events;
    expect(events.map((e) => e.category).sort()).toEqual(['deforestation', 'earthquake', 'flood', 'volcano', 'wildfire']);
  });
});
