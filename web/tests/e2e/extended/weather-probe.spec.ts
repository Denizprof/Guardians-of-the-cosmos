// Regression spec. Behaviour under test: a coverage probe started from a catalog record dated only to the day
// keeps that precision all the way to the weather request (ContextPanel -> App probe state -> IntroPanel ->
// WeatherSection). Before the fix the probe dropped it and the weather was asked at 00:00 UTC of the event day,
// so "previous 24 h" rain was the day BEFORE the event.
// The record is a real one from the shipped NOAA tsunami catalog. The weather route and third parties are stubbed:
// no live service and no account is used; the stubbed numbers are fixture values, not weather.
import type { Page } from '@playwright/test';
import { expect, appReady, probePanel, readData, stubExternal, test } from './helpers';

const record = (readData('catalogs/noaa-tsunamis.json').events as { id: string; date: string; date_precision?: string; lon: number; lat: number }[])
  .find((e) => e.id === 'ncei-tsu-5947')!;

/** Screen position of a stored context event after centring the map on it (the same path a real marker click takes). */
async function markerPoint(page: Page, lon: number, lat: number) {
  await page.waitForFunction(() => (window as any).__gsMaps?.a?.getSource?.('ctx'));
  return page.evaluate(
    async ([lo, la]) => {
      const a = (window as any).__gsMaps.a;
      a.jumpTo({ center: [lo, la], zoom: 8 });
      for (let i = 0; i < 80; i++) {
        const p = a.project([lo, la]);
        if (a.queryRenderedFeatures([p.x, p.y], { layers: ['ctx-points'] }).length) return { x: p.x, y: p.y };
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    },
    [lon, lat]
  );
}

test('probing from a day-dated catalog record asks the weather for the event day, not the midnight before it', async ({ page }) => {
  expect(record.date_precision).toBe('day');
  expect(record.date).toBe('2024-12-17T00:00:00.000Z');
  const json = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  await stubExternal(page);
  await page.route('https://www.ngdc.noaa.gov/**', (r) => r.fulfill({ status: 200, headers: json, body: '{}' }));
  await page.route('https://cmr.earthdata.nasa.gov/**', (r) => r.fulfill({ status: 200, headers: json, body: '{"feed":{"entry":[]}}' }));
  await page.route('**/api/meteomatics/status', (r) => r.fulfill({ status: 200, headers: json, body: '{"configured":true}' }));
  const asked: string[] = [];
  await page.route('**/api/meteomatics/point?**', (r) => {
    const time = new URL(r.request().url()).searchParams.get('time') ?? '';
    asked.push(time);
    const v = (parameter: string, value: number) => ({ parameter, value, date: time });
    return r.fulfill({
      status: 200,
      headers: json,
      body: JSON.stringify({
        lat: record.lat, lon: record.lon, time, source: 'Meteomatics Weather API', retrieved: '2026-11-15T12:00:00.000Z',
        values: [v('t_2m:C', -12.3), v('precip_24h:mm', 4.2), v('wind_speed_10m:ms', 3.1), v('msl_pressure:hPa', 1015)],
      }),
    });
  });

  await appReady(page);
  const pt = await markerPoint(page, record.lon, record.lat);
  expect(pt, 'marker rendered').not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
  await expect(page.locator('section.panel[aria-label$="reported event"]')).toContainText('Whitehorse');
  await page.getByRole('button', { name: 'Satellite data here?' }).click();

  const weather = probePanel(page).locator('.weather');
  await expect(weather).toContainText('on the event day');
  await weather.getByRole('button', { name: 'Get weather' }).click();
  const rain = weather.locator('dt', { hasText: 'Precipitation, event day (UTC)' });
  await expect(rain).toBeVisible();
  await expect(rain.locator('xpath=following-sibling::dd[1]')).toHaveText('4.2 mm');
  await expect(weather.locator('dt', { hasText: 'Precipitation, previous 24 h' })).toHaveCount(0);
  expect(asked).toEqual(['2024-12-18T00:00:00.000Z']); // the end of the event's UTC day: the 24 h sum is 17 Dec itself
});
