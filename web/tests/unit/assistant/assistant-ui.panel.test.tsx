import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssistantPanel } from '../../../src/assistant/AssistantPanel';
import type { AssistantAdapter } from '../../../src/assistant/adapter';
import type { AssistantResponse } from '../../../src/assistant/types';

afterEach(() => { cleanup(); window.location.hash = ''; });

const res: AssistantResponse = { version: '1.0', status: 'ok', answer: { text: 'X [[event:e1]]', format: 'plain' }, citations: [{ id: 'event:e1', type: 'reference', label: 'Event record' }] };
const adapter = (): AssistantAdapter => ({ health: async () => ({ status: 'ok', model_configured: true }), query: vi.fn().mockResolvedValue(res) });
const event = { id: 'e1', title: 'E', subtitle: '', category: 'flood', date: null, location: { lon: 0, lat: 0 }, technique: 'backscatter', references: [], layers: [] } as never;

async function askTwice(container: HTMLElement) {
  for (const n of [1, 2]) {
    await userEvent.type(await screen.findByLabelText('Ask the assistant'), `question ${n}`);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(container.querySelectorAll('article.asst-assistant')).toHaveLength(n));
  }
  return Array.from(container.querySelectorAll<HTMLElement>('article.asst-assistant'));
}

describe('AssistantPanel citation marks', () => {
  it('gives every citation chip a unique DOM id across answers that cite the same source', async () => {
    const { container } = render(<AssistantPanel event={event} adapter={adapter()} locale="en" />);
    await askTwice(container);
    const ids = Array.from(container.querySelectorAll('.asst-chip')).map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a citation mark moves focus to the chip of its own answer and leaves the page route alone', async () => {
    const { container } = render(<AssistantPanel event={event} adapter={adapter()} locale="en" />);
    const answers = await askTwice(container);
    window.location.hash = '#/e/e1?mode=swipe';
    for (const article of answers) {
      const mark = article.querySelector<HTMLAnchorElement>('a.asst-mark')!;
      expect(mark.textContent).toBe('[1]');
      // the mark stays a real link whose target is the chip in the same answer
      expect(mark.getAttribute('href')).toBe(`#${article.querySelector('.asst-chip')!.id}`);
      const notPrevented = fireEvent.click(mark);
      expect(notPrevented).toBe(false); // default navigation (which would replace the route hash) was prevented
      expect(window.location.hash).toBe('#/e/e1?mode=swipe');
      expect(document.activeElement).toBe(article.querySelector('.asst-chip'));
    }
  });
});
