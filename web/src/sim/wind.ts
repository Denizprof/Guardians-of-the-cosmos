// Weather inputs for the simulations, from Open-Meteo (already used by the app; no key needed):
// - winds aloft at pressure levels (speed, direction, geopotential height) for ash dispersal;
// - current surface weather (10 m wind, humidity, temperature) for fire behaviour.
import type { WindLayer } from './volcano';

export const LEVELS_HPA = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30];

export function windUrl(lat: number, lon: number): string {
  const vars = LEVELS_HPA.flatMap((p) => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`]).join(',');
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=${vars}&wind_speed_unit=ms&forecast_days=1&timezone=GMT`;
}

/** Parse an Open-Meteo response into layers (m a.s.l., u/v m/s towards east/north) for the hour nearest `now`. */
export function parseWind(json: unknown, now = new Date()): { layers: WindLayer[]; time: string } {
  const h = (json as { hourly?: Record<string, unknown[]> })?.hourly;
  const times = h?.time as string[] | undefined;
  if (!h || !Array.isArray(times) || !times.length) throw new Error('The wind service returned no hourly data');
  const target = now.toISOString().slice(0, 13);
  let idx = times.findIndex((t) => t.slice(0, 13) === target);
  if (idx < 0) idx = 0;
  const layers: WindLayer[] = [];
  for (const p of LEVELS_HPA) {
    const s = Number(h[`wind_speed_${p}hPa`]?.[idx]);
    const d = Number(h[`wind_direction_${p}hPa`]?.[idx]);
    const z = Number(h[`geopotential_height_${p}hPa`]?.[idx]);
    if (![s, d, z].every(Number.isFinite)) continue;
    // meteorological direction is where the wind comes FROM
    const r = (d * Math.PI) / 180;
    layers.push({ z, u: -s * Math.sin(r), v: -s * Math.cos(r) });
  }
  if (layers.length < 3) throw new Error('The wind service returned too few pressure levels');
  layers.sort((a, b) => a.z - b.z);
  return { layers, time: times[idx] };
}

export async function loadWind(lat: number, lon: number, signal?: AbortSignal): Promise<{ layers: WindLayer[]; source: string }> {
  const res = await fetch(windUrl(lat, lon), { signal });
  if (!res.ok) throw new Error(`Wind forecast failed (HTTP ${res.status})`);
  const { layers, time } = parseWind(await res.json());
  return { layers, source: `Open-Meteo forecast winds at ${layers.length} pressure levels, ${time.replace('T', ' ')} UTC` };
}

export interface SurfaceWeather { tempC: number; rh: number; windKmh: number; windFrom: number; time: string }

export function surfaceUrl(lat: number, lon: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&timezone=GMT`;
}

export function parseSurface(json: unknown): SurfaceWeather {
  const c = (json as { current?: Record<string, unknown> })?.current;
  const w = { tempC: Number(c?.temperature_2m), rh: Number(c?.relative_humidity_2m), windKmh: Number(c?.wind_speed_10m), windFrom: Number(c?.wind_direction_10m) };
  if (!c || ![w.tempC, w.rh, w.windKmh, w.windFrom].every(Number.isFinite)) throw new Error('The weather service returned no current conditions');
  return { ...w, time: String(c.time ?? '') };
}

export async function loadSurfaceWeather(lat: number, lon: number, signal?: AbortSignal): Promise<SurfaceWeather> {
  const res = await fetch(surfaceUrl(lat, lon), { signal });
  if (!res.ok) throw new Error(`Weather request failed (HTTP ${res.status})`);
  return parseSurface(await res.json());
}
