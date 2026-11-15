import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WeatherSection, { buildOpenMeteoUrl, isEventDayResult, parseOpenMeteo, weatherSampleTime } from '../../src/components/WeatherSection';
import ContextPanel from '../../src/components/ContextPanel';
import IntroPanel from '../../src/components/IntroPanel';
import { parsePointQuery } from '../../meteomatics-proxy';
import { fmtDateTime } from '../../src/lib';

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

// A day-precision record is stored as 00:00 UTC of its day. Sampling that instant gives the rain of the day BEFORE
// the event; the request must instead end at the close of the event's UTC day so the 24 h sum is the event day.
describe('day-precision events are sampled over the event day, not the day before', () => {
  const NOW = Date.parse('2026-11-15T12:00:00Z');
  const hours = (day: string) => Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`);
  // 1 mm in every hour of 05-01, 2 mm in every hour of 05-02 (hour value = sum of the preceding hour), 0 on 05-03.
  const rainOf = (t: string) => {
    const end = Date.parse(`${t}Z`);
    if (end > Date.parse('2024-05-02T00:00Z') && end <= Date.parse('2024-05-03T00:00Z')) return 2;
    if (end > Date.parse('2024-05-01T00:00Z') && end <= Date.parse('2024-05-02T00:00Z')) return 1;
    return 0;
  };
  const body = (days: string[]) => {
    const time = days.flatMap(hours);
    return {
      hourly: {
        time,
        temperature_2m: time.map(() => 20),
        precipitation: time.map(rainOf),
        wind_speed_10m: time.map(() => 3),
        pressure_msl: time.map(() => 1010),
      },
    };
  };

  it('weatherSampleTime moves a day-precision date to the end of its UTC day and leaves other dates alone', () => {
    expect(weatherSampleTime('2024-05-02T00:00:00.000Z', 'day', NOW)).toBe('2024-05-03T00:00:00.000Z');
    expect(weatherSampleTime('2024-05-02T09:30:00.000Z', 'minute', NOW)).toBe('2024-05-02T09:30:00.000Z');
    expect(weatherSampleTime('2024-05-02T09:30:00.000Z', undefined, NOW)).toBe('2024-05-02T09:30:00.000Z');
    expect(weatherSampleTime(null, 'day', NOW)).toBeNull();
    // an event dated today: the day is not over, so the sample is clamped to now (never a future time)
    expect(weatherSampleTime('2026-11-15T00:00:00.000Z', 'day', NOW)).toBe('2026-11-15T12:00:00.000Z');
    // an unparseable date is passed through untouched for the caller to handle as before
    expect(weatherSampleTime('not a date', 'day', NOW)).toBe('not a date');
  });

  it('the Open-Meteo request and 24 h sum then cover exactly the event day', () => {
    const t = weatherSampleTime('2024-05-02T00:00:00.000Z', 'day', NOW);
    const url = buildOpenMeteoUrl(10, 20, t, NOW);
    expect(url).toContain('start_date=2024-05-02');
    expect(url).toContain('end_date=2024-05-03');
    const parsed = parseOpenMeteo(body(['2024-05-02', '2024-05-03']), t, NOW)!;
    expect(parsed.time).toBe('2024-05-03T00:00:00Z');
    expect(parsed.values.find((v) => v.parameter === 'precip_24h:mm')!.value).toBe(48); // 24 x 2 mm, not the 24 mm of 05-01
  });

  it('isEventDayResult is true only when the sample really is the end of the event day', () => {
    expect(isEventDayResult('2024-05-02T00:00:00.000Z', 'day', '2024-05-03T00:00:00Z')).toBe(true);
    expect(isEventDayResult('2024-05-02T00:00:00.000Z', 'day', '2024-05-02T23:00:00Z')).toBe(false);
    expect(isEventDayResult('2024-05-02T00:00:00.000Z', 'minute', '2024-05-03T00:00:00Z')).toBe(false);
    expect(isEventDayResult(null, 'day', '2024-05-03T00:00:00Z')).toBe(false);
  });

  describe('rendered result', () => {
    let requested: string[] = [];
    const stubFetch = (days: string[]) => {
      requested = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        requested.push(String(url));
        if (String(url).includes('api/meteomatics/status')) return new Response(JSON.stringify({ configured: false }), { status: 200 });
        return new Response(JSON.stringify(body(days)), { status: 200 });
      }));
    };
    afterEach(() => vi.unstubAllGlobals());

    it('day precision: rain row is the event day total and is not called "previous 24 h"', async () => {
      stubFetch(['2024-05-02', '2024-05-03']);
      render(<WeatherSection lon={10} lat={20} date="2024-05-02T00:00:00.000Z" precision="day" />);
      fireEvent.click(screen.getByRole('button', { name: 'Get weather' }));
      const label = await screen.findByText('Precipitation, event day (UTC)');
      expect(label.nextElementSibling?.textContent).toBe('48.0 mm');
      expect(screen.queryByText('Precipitation, previous 24 h')).toBeNull();
      expect(screen.getByText(/one sample at the end of that day/)).toBeTruthy();
      const om = requested.find((u) => u.includes('open-meteo'))!;
      expect(om).toContain('start_date=2024-05-02');
      expect(om).toContain('end_date=2024-05-03');
    });

    it('minute precision keeps the instant and the "previous 24 h" label', async () => {
      stubFetch(['2024-05-01', '2024-05-02']);
      render(<WeatherSection lon={10} lat={20} date="2024-05-02T00:00:00.000Z" precision="minute" />);
      fireEvent.click(screen.getByRole('button', { name: 'Get weather' }));
      const label = await screen.findByText('Precipitation, previous 24 h');
      expect(label.nextElementSibling?.textContent).toBe('24.0 mm');
      expect(screen.queryByText('Precipitation, event day (UTC)')).toBeNull();
      expect(screen.queryByText(/one sample at the end of that day/)).toBeNull();
      expect(requested.find((u) => u.includes('open-meteo'))).toContain('end_date=2024-05-02');
    });

    it('day precision but the service returned a different hour: the label stays "previous 24 h"', async () => {
      stubFetch(['2024-05-02']); // last hour is 05-02 23:00, not the end of the day
      render(<WeatherSection lon={10} lat={20} date="2024-05-02T00:00:00.000Z" precision="day" />);
      fireEvent.click(screen.getByRole('button', { name: 'Get weather' }));
      expect(await screen.findByText('Precipitation, previous 24 h')).toBeTruthy();
      expect(screen.queryByText('Precipitation, event day (UTC)')).toBeNull();
    });
  });
});

// The coverage probe started from a day-dated catalog record used to drop the precision on the way to the probe
// panel, so its weather was again sampled at 00:00 UTC (the rain of the day before).
describe('a coverage probe started from a day-dated record keeps the day precision', () => {
  let requested: string[] = [];
  const stubMeteomatics = () => {
    requested = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      requested.push(u);
      if (u.includes('api/meteomatics/status')) return new Response(JSON.stringify({ configured: true }), { status: 200 });
      if (u.includes('api/meteomatics/point')) {
        const time = new URL(u, 'http://localhost').searchParams.get('time')!;
        const value = (parameter: string, v: number) => ({ parameter, value: v, date: time });
        return new Response(JSON.stringify({
          lat: 1, lon: 2, time, source: 'Meteomatics Weather API', retrieved: '2026-11-15T12:00:00.000Z',
          values: [value('t_2m:C', 10), value('precip_24h:mm', 8.1), value('wind_speed_10m:ms', 3), value('msl_pressure:hPa', 1010)],
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));
  };
  afterEach(() => vi.unstubAllGlobals());

  it('ContextPanel hands the record\'s date precision to the probe', () => {
    stubMeteomatics();
    const onCheckCoverage = vi.fn();
    const ev = { id: 'gdacs-fl-1', title: 'Flood', category: 'flood', date: '2026-11-14T00:00:00Z', date_precision: 'day', lon: 5.32, lat: 60.39, source: 'GDACS', url: 'https://www.gdacs.org/' };
    render(<ContextPanel event={ev as never} collapsed={false} onCheckCoverage={onCheckCoverage} onClose={() => {}} onToggleCollapsed={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Satellite data here?' }));
    expect(onCheckCoverage).toHaveBeenCalledWith(5.32, 60.39, '2026-11-14T00:00:00Z', 'day');
  });

  it('IntroPanel asks for the end of the event day and labels the rain as the event day', async () => {
    stubMeteomatics();
    render(
      <IntroPanel
        events={[]} generated="2026-11-14T05:54:21.816Z" coverage={null} coverageState="loading" coverageError={null} coverageMode={false} collapsed={false}
        probe={{ lon: 160.27, lat: 54.59, date: '2025-08-02T00:00:00Z', precision: 'day' }}
        onSelect={() => {}} onCoverageMode={() => {}} onClearCoverage={() => {}} onToggleCollapsed={() => {}}
      />,
    );
    expect(screen.getByText(/Temperature, rain, wind and pressure/).textContent).toContain('on the event day');
    fireEvent.click(screen.getByRole('button', { name: 'Get weather' }));
    const label = await screen.findByText('Precipitation, event day (UTC)');
    expect(label.nextElementSibling?.textContent).toBe('8.1 mm');
    const point = requested.find((u) => u.includes('api/meteomatics/point'))!;
    expect(new URL(point, 'http://localhost').searchParams.get('time')).toBe('2025-08-03T00:00:00.000Z');
  });

  it('a plain probe (no date) still asks for "now"', () => {
    render(
      <IntroPanel
        events={[]} generated="2026-11-14T05:54:21.816Z" coverage={null} coverageState="loading" coverageError={null} coverageMode={false} collapsed={false}
        probe={{ lon: 1, lat: 2, date: null }}
        onSelect={() => {}} onCoverageMode={() => {}} onClearCoverage={() => {}} onToggleCollapsed={() => {}}
      />,
    );
    expect(screen.getByText(/Temperature, rain, wind and pressure/).textContent).toContain(' now');
  });
});

// A future instant has no weather to report as the event's: both providers must be asked for "now" at the latest.
describe('a future time is never requested, from either provider', () => {
  const NOW = Date.parse('2026-11-15T12:00:00Z');

  it('weatherSampleTime clamps a future date to now whatever its precision, and leaves past dates as written', () => {
    expect(weatherSampleTime('2027-06-01T12:00:00Z', undefined, NOW)).toBe('2026-11-15T12:00:00.000Z');
    expect(weatherSampleTime('2027-06-01T12:00:00Z', 'minute', NOW)).toBe('2026-11-15T12:00:00.000Z');
    expect(weatherSampleTime('2027-06-01T00:00:00Z', 'day', NOW)).toBe('2026-11-15T12:00:00.000Z');
    expect(weatherSampleTime('2026-11-15T11:59:00Z', 'minute', NOW)).toBe('2026-11-15T11:59:00Z');
  });

  it('the Meteomatics route clamps a future time to now too', () => {
    const q = parsePointQuery(new URLSearchParams('lat=1&lon=2&time=2027-06-01T12:00:00Z'), NOW);
    expect(q).toEqual({ lat: 1, lon: 2, time: '2026-11-15T12:00:00Z' });
    const past = parsePointQuery(new URLSearchParams('lat=1&lon=2&time=2026-06-29T10:21:00Z'), NOW);
    expect(past).toEqual({ lat: 1, lon: 2, time: '2026-06-29T10:21:00Z' });
  });
});

// A response with no values at all is not a weather result: it must read as a failure, not as four empty rows.
describe('a provider that returns no values at all is an error, not a result', () => {
  const DAY = 86_400_000;
  // the fixtures' only hour is the hour of the date the retry tests ask for (30 days ago), so the time match is a real one
  const PAST = new Date(Math.floor((Date.now() - 30 * DAY) / 3_600_000) * 3_600_000).toISOString();
  const HOUR = PAST.slice(0, 16);
  const allNull = { hourly: { time: [HOUR], temperature_2m: [null], precipitation: [null], wind_speed_10m: [null], pressure_msl: [null] } };
  const full = { hourly: { time: [HOUR], temperature_2m: [7], precipitation: [0.5], wind_speed_10m: [2], pressure_msl: [1000] } };
  let requested: string[] = [];
  const stub = (answer: (url: string) => unknown, configured = false) => {
    requested = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      requested.push(u);
      if (u.includes('api/meteomatics/status')) return new Response(JSON.stringify({ configured }), { status: 200 });
      return new Response(JSON.stringify(answer(u)), { status: 200 });
    }));
  };
  afterEach(() => vi.unstubAllGlobals());

  it('Open-Meteo, "now": all four values null is shown as an error with a retry, and no value rows', async () => {
    stub(() => allNull);
    render(<WeatherSection lon={10} lat={20} date={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get weather' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The weather service returned no values for this place and time');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('not available')).toBeNull();
    expect(screen.queryByText('Valid time')).toBeNull();
  });

  it('Open-Meteo, a past date the forecast endpoint has dropped: the archive is asked, and its values are shown with its source', async () => {
    stub((u) => (u.includes('archive-api') ? full : allNull));
    render(<WeatherSection lon={10} lat={20} date={PAST} precision="minute" />);
    fireEvent.click(screen.getByRole('button', { name: 'Get weather' }));
    expect((await screen.findByText('Air temperature (2 m)')).nextElementSibling?.textContent).toBe('7.0 °C');
    expect(screen.getByText('Valid time').nextElementSibling?.textContent).toBe(fmtDateTime(PAST));
    expect(screen.getByText(/ECMWF ERA5 reanalysis/)).toBeTruthy();
    const om = requested.filter((u) => u.includes('open-meteo'));
    expect(om).toHaveLength(2);
    expect(om[0]).toContain('https://api.open-meteo.com/v1/forecast');
    expect(om[1]).toContain('https://archive-api.open-meteo.com/v1/archive');
  });

  it('Open-Meteo, neither endpoint has values: an error, after asking both once', async () => {
    stub(() => allNull);
    render(<WeatherSection lon={10} lat={20} date={PAST} precision="minute" />);
    fireEvent.click(screen.getByRole('button', { name: 'Get weather' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The weather service returned no values for this place and time');
    expect(requested.filter((u) => u.includes('open-meteo'))).toHaveLength(2);
  });

  it('a future-dated record is asked as now, so the idle text says "now", not "at the event time"', () => {
    const { container, unmount } = render(<WeatherSection lon={10} lat={20} date="2999-06-01T12:00:00Z" precision="minute" />);
    expect(container.querySelector('p')?.textContent).toBe('Temperature, rain, wind and pressure at this point now, from weather models.');
    unmount();
    const day = render(<WeatherSection lon={10} lat={20} date="2999-06-01T00:00:00Z" precision="day" />);
    expect(day.container.querySelector('p')?.textContent).toBe('Temperature, rain, wind and pressure at this point now, from weather models.');
    day.unmount();
    const past = render(<WeatherSection lon={10} lat={20} date="2025-08-02T10:00:00Z" precision="minute" />);
    expect(past.container.querySelector('p')?.textContent).toBe('Temperature, rain, wind and pressure at this point at the event time, from weather models.');
  });

  it('Meteomatics: all values null is an error too', async () => {
    const v = (parameter: string) => ({ parameter, value: null, date: null });
    stub(() => ({ lat: 20, lon: 10, time: '2026-11-15T12:00:00Z', source: 'Meteomatics Weather API', retrieved: '2026-11-15T12:00:00.000Z', values: [v('t_2m:C'), v('precip_24h:mm'), v('wind_speed_10m:ms'), v('msl_pressure:hPa')] }), true);
    render(<WeatherSection lon={10} lat={20} date={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get weather' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The weather service returned no values for this place and time');
    expect(screen.queryByText('not available')).toBeNull();
  });

  it('one missing value among real ones is still a result, with that row "not available"', async () => {
    stub(() => ({ hourly: { ...full.hourly, temperature_2m: [null] } }));
    render(<WeatherSection lon={10} lat={20} date={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get weather' }));
    expect((await screen.findByText('Air temperature (2 m)')).nextElementSibling?.textContent).toBe('not available');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
