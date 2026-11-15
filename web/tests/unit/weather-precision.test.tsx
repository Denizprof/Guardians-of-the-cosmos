import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WeatherSection from '../../src/components/WeatherSection';

// The idle text must not claim more time precision than the record has. Nothing is fetched until the button is pressed.
describe('WeatherSection wording by date precision', () => {
  const intro = () => screen.getByText(/Temperature, rain, wind and pressure/).textContent;

  it('a date known only to the day is offered as the event day, not the event time', () => {
    render(<WeatherSection lon={127.878} lat={1.699} date="2026-05-07T00:00:00.000Z" precision="day" />);
    expect(intro()).toContain('on the event day');
    expect(intro()).not.toContain('at the event time');
  });

  it('a date known to the minute, or with no precision given, keeps "at the event time"', () => {
    const { unmount } = render(<WeatherSection lon={1} lat={2} date="2026-10-24T02:31:00.000Z" precision="minute" />);
    expect(intro()).toContain('at the event time');
    unmount();
    render(<WeatherSection lon={1} lat={2} date="2026-10-24T02:31:00.000Z" />);
    expect(intro()).toContain('at the event time');
  });

  it('no date still reads "now", whatever the precision', () => {
    render(<WeatherSection lon={1} lat={2} date={null} precision="day" />);
    expect(intro()).toContain(' now');
    expect(intro()).not.toContain('event');
  });
});
