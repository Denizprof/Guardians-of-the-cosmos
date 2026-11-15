// The front page: a full screen shown on a first visit that says what the app is and how to use it, then
// "Get started" (components/FrontPage.tsx).
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FrontPage from '../../src/components/FrontPage';
import { CATALOGS } from '../../src/lib';
import { translate } from '../../src/i18n';
import shippedLayers from '../../public/data/layers.json';

const setup = () => {
  const onStart = vi.fn();
  const onTour = vi.fn();
  const { container } = render(<FrontPage onStart={onStart} onTour={onTour} />);
  return { onStart, onTour, container };
};

describe('front page', () => {
  it('is a page of its own with one main heading, focused so a screen reader starts at the top', () => {
    const { container } = setup();
    expect(container.querySelector('.front')).toBeTruthy();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Watch the surface of the Earth change, through radar.');
    expect(document.activeElement).toBe(h1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('explains, in this order: what it is, who it is for and what it is not, how to use it, where the data comes from', () => {
    setup();
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['What it is', 'Who it is for', 'What it is not', 'How to use it', 'Where the data comes from']);
    expect(screen.getByText(/not a live emergency alert system/)).toBeInTheDocument();
    expect(screen.getByText(/not official NASA products/)).toBeInTheDocument();
  });

  it('lists the seven tools by the names on their toolbar buttons, plus the two explanation levels', () => {
    setup();
    const list = screen.getByRole('list', { name: 'The tools' });
    const names = within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['Investigations', 'Filters', 'Satellite layers', 'SAR lens', 'Coverage probe', 'Search', 'Ask', 'Simple or Scientific']);
    expect(screen.getByText('Seven tools, all on the bar at the top of the globe.')).toBeInTheDocument();
  });

  it('states only numbers that are true of the shipped app', () => {
    setup();
    const layers = (shippedLayers as { layers: unknown[] }).layers.length;
    expect(screen.getByText(new RegExp(`Lay any of ${layers} global datasets over the globe`))).toBeInTheDocument();
    expect(CATALOGS).toHaveLength(6);
    expect(screen.getByText(/from six public catalogs/)).toBeInTheDocument();
  });

  it('"Get started" comes after the explanation and opens the app; so does "Open the app" at the top', async () => {
    const { onStart, container } = setup();
    const start = screen.getByRole('button', { name: 'Get started' });
    const lastSection = [...container.querySelectorAll('section')].at(-1)!;
    expect(lastSection.contains(start)).toBe(true);
    await userEvent.click(start);
    await userEvent.click(screen.getByRole('button', { name: 'Open the app' }));
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('offers the guided tour as a second way in', async () => {
    const { onTour, onStart } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Take the guided tour' }));
    expect(onTour).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('every sentence has a Turkish version (names and marked-as-English text aside)', () => {
    const { container } = setup();
    const keep = new Set(['GLOBAL SAR', 'EN', 'TR']);
    const missing: string[] = [];
    const walk = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = (n.nodeValue ?? '').trim();
      if (!/[A-Za-z]{2}/.test(text) || keep.has(text)) continue;
      if ((n.parentElement as HTMLElement).closest('[data-no-i18n]')) continue;
      if (translate(text, 'tr') === text) missing.push(text);
    }
    expect(missing).toEqual([]);
  });
});
