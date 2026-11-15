import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Component, type ComponentType, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import LazySection from '../../src/components/LazySection';
import EventPanel from '../../src/components/EventPanel';
import { syntheticEvent } from '../fixtures/events.fixture';
import type { SarEvent } from '../../src/types';

// WeatherSection is replaced by a probe that prints the date it was given (it would otherwise call a live service).
vi.mock('../../src/components/WeatherSection', () => ({
  default: ({ date }: { date: string | null }) => <div data-testid="weather-date">{date === null ? 'null' : date}</div>,
}));

type Mod = { default: ComponentType<{ label: string }> };
const Loaded = ({ label }: { label: string }) => <p>loaded: {label}</p>;

const Host = ({ load }: { load: () => Promise<Mod> }) => (
  <div>
    <h2>Surrounding content</h2>
    <LazySection load={load} fallback={<p role="status">Loading…</p>}>
      {(C) => <C label="section" />}
    </LazySection>
  </div>
);

describe('LazySection (a lazy chunk that fails to load degrades inline)', () => {
  it('shows an inline alert, keeps the surrounding content, and Retry re-attempts the import', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React logs the caught error
    const load = vi
      .fn<() => Promise<Mod>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValue({ default: Loaded });

    render(<Host load={load} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This section could not be loaded. Check your connection and try again.');
    expect(screen.getByRole('heading', { name: 'Surrounding content' })).toBeInTheDocument();
    expect(screen.queryByText(/loaded:/)).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('loaded: section')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Surrounding content' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shows the alert again when the retry fails too, and still recovers afterwards', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi
      .fn<() => Promise<Mod>>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue({ default: Loaded });

    render(<Host load={load} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('loaded: section')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('loads a module once and reuses it across mounts', async () => {
    const load = vi.fn<() => Promise<Mod>>().mockResolvedValue({ default: Loaded });
    const first = render(<Host load={load} />);
    expect(await screen.findByText('loaded: section')).toBeInTheDocument();
    first.unmount();
    render(<Host load={load} />);
    expect(await screen.findByText('loaded: section')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not swallow an error thrown by the loaded component itself', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = (): never => {
      throw new Error('render bug');
    };
    const load = vi.fn<() => Promise<Mod>>().mockResolvedValue({ default: Broken as unknown as Mod['default'] });
    // stands in for the app-level boundary in main.tsx
    class Outer extends Component<{ children: ReactNode }, { message: string | null }> {
      state = { message: null as string | null };
      static getDerivedStateFromError(e: Error) {
        return { message: e.message };
      }
      render() {
        return this.state.message ? <p>outer caught: {this.state.message}</p> : this.props.children;
      }
    }
    render(
      <Outer>
        <Host load={load} />
      </Outer>,
    );
    expect(await screen.findByText('outer caught: render bug')).toBeInTheDocument();
    expect(screen.queryByText('This section could not be loaded. Check your connection and try again.')).not.toBeInTheDocument();
  });
});

describe('EventPanel with a date known only to the month', () => {
  const props = (ev: SarEvent) => ({
    event: ev,
    before: ev.layers[0],
    after: ev.layers[1],
    mode: 'swipe' as const,
    overlayOpacity: 0.5,
    level: 'simple' as const,
    activePin: null,
    collapsed: false,
    onMode: vi.fn(),
    onBefore: vi.fn(),
    onAfter: vi.fn(),
    onOpacity: vi.fn(),
    onLevel: vi.fn(),
    onPin: vi.fn(),
    onClose: vi.fn(),
    onToggleCollapsed: vi.fn(),
  });
  const monthEvent: SarEvent = { ...syntheticEvent, date_precision: 'month' };

  it('gives the weather section no event time', () => {
    render(<EventPanel {...(props(monthEvent) as unknown as Parameters<typeof EventPanel>[0])} />);
    expect(screen.getByTestId('weather-date')).toHaveTextContent('null');
  });

  it('offers no Earthdata search around a day the record does not know', () => {
    render(<EventPanel {...(props(monthEvent) as unknown as Parameters<typeof EventPanel>[0])} />);
    expect(screen.queryByRole('button', { name: 'Search NASA Earthdata' })).not.toBeInTheDocument();
    expect(screen.getByText('The event date is not known to the day, so there is no time window to search.')).toBeInTheDocument();
  });

  it('still passes an exact date through and offers the Earthdata search', () => {
    render(<EventPanel {...(props(syntheticEvent) as unknown as Parameters<typeof EventPanel>[0])} />);
    expect(screen.getByTestId('weather-date')).toHaveTextContent('2026-01-12T00:00:00Z');
    expect(screen.getByRole('button', { name: 'Search NASA Earthdata' })).toBeInTheDocument();
  });
});
