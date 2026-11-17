import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InspectPanel from '../../src/components/InspectPanel';
import type { ContextEvent, SarEvent } from '../../src/types';

afterEach(() => vi.unstubAllGlobals());

const quake: ContextEvent = { id: 'q1', title: 'M 6.4 near Test', category: 'earthquake', date: '2026-01-02', lon: 30, lat: 38, magnitude: 6.4, source: 'USGS', url: 'https://example.org' };
const sar = { id: 'inv', title: 'Test investigation', subtitle: 'Ground motion', category: 'earthquake', date: null, location: { lon: 31, lat: 38 }, technique: 'insar', references: [], layers: [] } as SarEvent;
const BOX: [number, number, number, number] = [28, 36, 34, 40];

function setup(over: Partial<Parameters<typeof InspectPanel>[0]> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u).includes('elevation') ? new Response(JSON.stringify({ elevation: [1, 2, 3, 4, 5, 6, 7, 8, 9] })) : new Response('{}', { status: 404 }))));
  const props = { box: BOX, context: [quake], events: [sar], collapsed: false, onSelectEvent: vi.fn(), onSelectContext: vi.fn(), onCheckCoverage: vi.fn(), onClose: vi.fn(), onToggleCollapsed: vi.fn(), ...over };
  render(<InspectPanel {...props} />);
  return props;
}

describe('InspectPanel', () => {
  it('shows the size of the area, the events and investigations inside it, and terrain height', async () => {
    setup();
    expect(screen.getByRole('heading', { name: 'The area you selected' })).toBeTruthy();
    expect(screen.getByText(/km²/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'M 6.4 near Test' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test investigation' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Mean of samples')).toBeTruthy());
  });

  it('every button works', async () => {
    const p = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'M 6.4 near Test' }));
    expect(p.onSelectContext).toHaveBeenCalledWith('q1');
    await user.click(screen.getByRole('button', { name: 'Test investigation' }));
    expect(p.onSelectEvent).toHaveBeenCalledWith('inv');
    await user.click(screen.getByRole('button', { name: 'Satellite data here?' }));
    expect(p.onCheckCoverage).toHaveBeenCalledWith(31, 38);
    await user.click(screen.getByRole('button', { name: 'Close area details' }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it('says plainly when the catalogs hold nothing inside the box', () => {
    setup({ context: [], events: [] });
    expect(screen.getByText(/lie inside this box/)).toBeTruthy();
    expect(screen.queryByText('Investigations here')).toBeNull();
  });

  it('shows an error with a working Retry when the terrain service fails', async () => {
    const fetchMock = vi.fn(async (u: string) => (String(u).includes('elevation') ? new Response('{}', { status: 500 }) : new Response('{}', { status: 404 })));
    vi.stubGlobal('fetch', fetchMock);
    render(<InspectPanel box={BOX} context={[]} events={[]} collapsed={false} onSelectEvent={vi.fn()} onSelectContext={vi.fn()} onCheckCoverage={vi.fn()} onClose={vi.fn()} onToggleCollapsed={vi.fn()} />);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes('elevation')).length;
    await userEvent.setup().click(retry);
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('elevation')).length).toBe(before + 1));
  });
});
