// App shell: links to investigations (unknown id, link opened while the front page shows) and the tutorial's
// "Ask the assistant" step with an investigation open (src/App.tsx).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { INTRO_SEEN_KEY, INTRO_VERSION } from '../../src/app/introSeen';

const EVENTS = [
  {
    id: 'mozambique-floods-2026',
    title: 'Mozambique floods',
    subtitle: 'Test event',
    category: 'flood',
    date: '2026-01-20',
    location: { lon: 35, lat: -18 },
    technique: 'backscatter',
    references: [],
    layers: [],
  },
];

vi.mock('../../src/lib', async (orig) => ({
  ...(await orig<typeof import('../../src/lib')>()),
  loadData: vi.fn(async () => ({ events: EVENTS, context: [], contextError: null, generated: '2026-01-01T00:00:00Z' })),
  loadCatalog: vi.fn(async (id: string) => ({ id, events: [] })),
}));
vi.mock('../../src/layers', async (orig) => ({
  ...(await orig<typeof import('../../src/layers')>()),
  loadLayerCatalog: vi.fn(async () => []),
}));
vi.mock('../../src/map/MapView', () => ({
  default: (p: { onAskAssistant: () => void }) => (
    <button type="button" data-testid="satellite" onClick={p.onAskAssistant}>satellite</button>
  ),
}));
vi.mock('../../src/components/EventPanel', () => ({
  default: (p: { event: { title: string }; onClose: () => void }) => (
    <section className="panel" data-testid="event-panel">
      <h2>{p.event.title}</h2>
      <details data-ask><summary>Ask about this investigation</summary></details>
      <button type="button" onClick={p.onClose}>Close panel</button>
    </section>
  ),
}));
vi.mock('../../src/components/Timeline', () => ({ default: () => null }));

import App from '../../src/App';

const seenIntro = () => localStorage.setItem(INTRO_SEEN_KEY, INTRO_VERSION);
const root = (c: HTMLElement) => c.querySelector<HTMLElement>('.app')!;
const loaded = (c: HTMLElement) => waitFor(() => expect(root(c).getAttribute('data-ready')).toBe('true'));
const goHash = (hash: string) =>
  act(() => {
    history.pushState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '#/');
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  Element.prototype.scrollIntoView ??= () => {};
});

describe('a link to an investigation that does not exist', () => {
  it('says so, clears the dead link without a new history entry, and still shows the front page on a first visit', async () => {
    history.replaceState(null, '', '#/e/mozambique-floods-2025');
    const entries = history.length;
    const { container } = render(<App />);
    await loaded(container);
    const note = await screen.findByText('The linked investigation "mozambique-floods-2025" was not found.');
    expect(note.closest('[role="status"]')).toBeTruthy();
    expect(window.location.hash).toBe('#/');
    expect(history.length).toBe(entries);
    expect(screen.queryByTestId('event-panel')).toBeNull();
    expect(container.ownerDocument.querySelector('.front')).toBeTruthy();
  });

  it('can be dismissed, and does not bring the front page back for a returning visitor', async () => {
    seenIntro();
    history.replaceState(null, '', '#/e/nope');
    const { container } = render(<App />);
    await loaded(container);
    const note = await screen.findByText('The linked investigation "nope" was not found.');
    expect(document.querySelector('.front')).toBeNull();
    fireEvent.click(note.parentElement!.querySelector('button')!);
    expect(screen.queryByText(/was not found/)).toBeNull();
  });

  it('a later link to a missing investigation is reported too and leaves no dead entry behind', async () => {
    seenIntro();
    const { container } = render(<App />);
    await loaded(container);
    await goHash('#/e/gone');
    await screen.findByText('The linked investigation "gone" was not found.');
    expect(window.location.hash).toBe('#/');
  });

  it('a link to an investigation that exists opens it and shows no notice', async () => {
    history.replaceState(null, '', '#/e/mozambique-floods-2026');
    const { container } = render(<App />);
    await loaded(container);
    expect(await screen.findByTestId('event-panel')).toHaveTextContent('Mozambique floods');
    expect(screen.queryByText(/was not found/)).toBeNull();
    expect(document.querySelector('.front')).toBeNull();
  });
});

describe('an investigation link opened while the front page is showing', () => {
  it('closes the front page so the investigation is visible (first visit)', async () => {
    const { container } = render(<App />);
    await loaded(container);
    expect(document.querySelector('.front')).toBeTruthy();
    expect(root(container).hasAttribute('inert')).toBe(true);
    await goHash('#/e/mozambique-floods-2026');
    expect(await screen.findByTestId('event-panel')).toBeInTheDocument();
    expect(document.querySelector('.front')).toBeNull();
    expect(root(container).hasAttribute('inert')).toBe(false);
    // like a fresh load of an investigation link, this does not count as having seen the introduction
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBeNull();
  });

  it('closes it after About > "Back to the front page" as well', async () => {
    seenIntro();
    const { container } = render(<App />);
    await loaded(container);
    fireEvent.click(screen.getByRole('button', { name: 'About Global SAR' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the front page' }));
    expect(document.querySelector('.front')).toBeTruthy();
    await goHash('#/e/mozambique-floods-2026');
    expect(await screen.findByTestId('event-panel')).toBeInTheDocument();
    expect(document.querySelector('.front')).toBeNull();
    expect(root(container).hasAttribute('inert')).toBe(false);
  });
});

describe('tutorial step "Ask the assistant" with an investigation open', () => {
  const title = () => document.querySelector('.tut-title')?.textContent;
  /** Start the tutorial, skip to the last step, then open an investigation. */
  async function atAskStepWithInvestigation() {
    seenIntro();
    const { container } = render(<App />);
    await loaded(container);
    fireEvent.click(screen.getByRole('button', { name: 'About Global SAR' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start the interactive tutorial' }));
    await waitFor(
      () => {
        if (title() !== 'Ask the assistant') {
          const skip = screen.queryByRole('button', { name: 'Skip this step' });
          if (skip) fireEvent.click(skip);
        }
        expect(title()).toBe('Ask the assistant');
      },
      { timeout: 4000 },
    );
    fireEvent.click(container.querySelector<HTMLElement>('.inv-card')!);
    await screen.findByTestId('event-panel');
    expect(title()).toBe('Ask the assistant');
    return container;
  }

  it('completes when Ask in the top bar opens the chat inside the investigation panel', async () => {
    const container = await atAskStepWithInvestigation();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the assistant' }));
    expect(container.querySelector<HTMLDetailsElement>('details[data-ask]')!.open).toBe(true);
    expect(await screen.findByText('Done')).toBeInTheDocument();
    await waitFor(() => expect(title()).toBe('Tutorial complete'), { timeout: 3000 });
  });

  it('completes when the satellite on the globe opens it', async () => {
    const container = await atAskStepWithInvestigation();
    fireEvent.click(screen.getByTestId('satellite'));
    expect(container.querySelector<HTMLDetailsElement>('details[data-ask]')!.open).toBe(true);
    await waitFor(() => expect(title()).toBe('Tutorial complete'), { timeout: 3000 });
  });
});
