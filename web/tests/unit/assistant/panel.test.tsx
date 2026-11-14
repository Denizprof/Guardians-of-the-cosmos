import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { AssistantPanel } from '../../../src/assistant/AssistantPanel';
import { UnavailableAdapter, type AssistantAdapter } from '../../../src/assistant/adapter';
import type { AssistantResponse } from '../../../src/assistant/types';

afterEach(cleanup);

const fake = (res: AssistantResponse, query = vi.fn()): AssistantAdapter => ({
  health: async () => ({ status: 'ok', model_configured: true }),
  query: query.mockResolvedValue(res),
});

describe('AssistantPanel', () => {
  it('says "Assistant not connected" with setup steps and no input when unavailable', async () => {
    render(<AssistantPanel event={null} adapter={new UnavailableAdapter()} />);
    expect(await screen.findByText('Assistant not connected')).toBeTruthy();
    expect(screen.getByText(/ASSISTANT_MODEL_URL/)).toBeTruthy();
    expect(screen.queryByLabelText('Ask the assistant')).toBeNull();
  });

  it('sends a query and renders the answer with a citation chip', async () => {
    const query = vi.fn();
    const adapter = fake({ version: '1.0', status: 'ok', answer: { text: 'Hello [[ref:x:0]]', format: 'plain' }, citations: [{ id: 'ref:x:0', type: 'reference', label: 'Ref label', url: 'https://example.org/r' }] }, query);
    // Build a minimal event so the reference id exists in context.
    const event = { id: 'x', title: 'X', subtitle: '', category: 'flood', date: null, location: { lon: 0, lat: 0 }, technique: 'backscatter', references: [{ label: 'Ref label', url: 'https://example.org/r' }], layers: [] } as never;
    render(<AssistantPanel event={event} adapter={adapter} locale="en" />);
    const box = await screen.findByLabelText('Ask the assistant');
    await userEvent.type(box, 'What is this?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const link = await screen.findByRole('link', { name: /Ref label/ });
    expect(link.getAttribute('href')).toBe('https://example.org/r');
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0].query).toBe('What is this?');
  });

  it('shows an error state instead of an answer when the adapter returns an error', async () => {
    const adapter = fake({ version: '1.0', status: 'error', error: { code: 'model_timeout', message: 'The model did not answer in time.' } });
    render(<AssistantPanel event={null} adapter={adapter} />);
    await userEvent.type(await screen.findByLabelText('Ask the assistant'), 'hi');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/did not answer in time/));
  });

  it('toggles the explanation level and passes it to the model', async () => {
    const query = vi.fn();
    const adapter = fake({ version: '1.0', status: 'error', error: { code: 'x', message: 'x' } }, query);
    render(<AssistantPanel event={null} adapter={adapter} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Scientific' }));
    await userEvent.type(screen.getByLabelText('Ask the assistant'), 'q');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(query).toHaveBeenCalled());
    expect(query.mock.calls[0][0].explanation_level).toBe('scientific');
  });
});
