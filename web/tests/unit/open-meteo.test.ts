import { describe, expect, it } from 'vitest';
import { buildOpenMeteoUrl, parseOpenMeteo, formatWeatherValue } from '../../src/components/WeatherSection';

const NOW = Date.parse('2026-11-15T12:00:00Z');

describe('Open-Meteo weather (hosted site, no key)', () => {
  it('uses the ERA5 archive for old event dates and asks for the day before too', () => {
    const u = new URL(buildOpenMeteoUrl(-67.221, 10.595, '2026-06-24T22:04:00Z', NOW));
    expect(u.origin).toBe('https://archive-api.open-meteo.com');
    expect(u.searchParams.get('start_date')).toBe('2026-06-23');
    expect(u.searchParams.get('end_date')).toBe('2026-06-24');
    expect(u.searchParams.get('wind_speed_unit')).toBe('ms');
    expect(u.searchParams.get('hourly')).toBe('temperature_2m,precipitation,wind_speed_10m,pressure_msl');
  });

  it('uses the forecast API for recent dates and for "now"', () => {
    expect(buildOpenMeteoUrl(33, -24.55, '2026-11-10T00:00:00Z', NOW)).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    expect(buildOpenMeteoUrl(33, -24.55, null, NOW)).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  });

  // The forecast endpoint answers HTTP 200 with every value null from about 68 days back (measured 2026-11-15),
  // so dates older than 60 days must go to the archive, which has them.
  it('uses the archive, not the forecast endpoint, for dates 61 to 90 days old', () => {
    for (const days of [61, 68, 75, 89]) {
      const t = new Date(NOW - days * 86_400_000).toISOString();
      expect(buildOpenMeteoUrl(10, 20, t, NOW), `${days} days`).toMatch(/^https:\/\/archive-api\.open-meteo\.com\/v1\/archive\?/);
    }
    expect(buildOpenMeteoUrl(10, 20, new Date(NOW - 59 * 86_400_000).toISOString(), NOW)).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    // the endpoint can be forced, for the retry when the forecast endpoint has nothing
    expect(buildOpenMeteoUrl(10, 20, new Date(NOW - 30 * 86_400_000).toISOString(), NOW, true)).toMatch(/^https:\/\/archive-api\.open-meteo\.com\/v1\/archive\?/);
  });

  it('never asks for a future time', () => {
    const u = new URL(buildOpenMeteoUrl(0, 0, '2030-01-01T00:00:00Z', NOW));
    expect(u.searchParams.get('end_date')).toBe('2026-11-15');
  });

  it('picks the nearest hour and sums the previous 24 h of rain', () => {
    const time = Array.from({ length: 48 }, (_, k) => `2026-06-${k < 24 ? '23' : '24'}T${String(k % 24).padStart(2, '0')}:00`);
    const body = {
      hourly: {
        time,
        temperature_2m: time.map((_, k) => k),
        precipitation: time.map(() => 0.5),
        wind_speed_10m: time.map(() => 3.2),
        pressure_msl: time.map(() => 1012),
      },
    };
    const r = parseOpenMeteo(body, '2026-06-24T22:04:00Z', NOW)!;
    expect(r.time).toBe('2026-06-24T22:00:00Z');
    const byKey = Object.fromEntries(r.values.map((v) => [v.parameter, v.value]));
    expect(byKey['t_2m:C']).toBe(46);
    expect(byKey['precip_24h:mm']).toBeCloseTo(12);
    expect(byKey['wind_speed_10m:ms']).toBe(3.2);
    expect(byKey['msl_pressure:hPa']).toBe(1012);
    expect(formatWeatherValue(r.values[0]).text).toBe('46.0 °C');
  });

  it('reports a missing value as not available instead of zero', () => {
    const body = { hourly: { time: ['2026-06-24T22:00'], temperature_2m: [null], precipitation: [null], wind_speed_10m: [2], pressure_msl: [1000] } };
    const r = parseOpenMeteo(body, '2026-06-24T22:00:00Z', NOW)!;
    expect(formatWeatherValue(r.values[0]).text).toBe('not available');
    expect(r.values[1].value).toBeNull();
  });

  it('rejects an unexpected response shape', () => {
    expect(parseOpenMeteo({}, null, NOW)).toBeNull();
    expect(parseOpenMeteo({ hourly: { time: [] } }, null, NOW)).toBeNull();
    expect(parseOpenMeteo(null, null, NOW)).toBeNull();
  });
});
