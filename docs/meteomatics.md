# Meteomatics weather data

The app can show weather-model values (air temperature, 24 h precipitation, wind speed, sea-level pressure) for an investigation, a catalog event or a probed point. They come from the [Meteomatics Weather API](https://www.meteomatics.com/en/api/getting-started/) and are labelled **Model output**: they are not satellite observations.

## Set up your account

Meteomatics signs every request with your account username and password, so they stay on the server and never reach browser code.

1. Open `web/.env.local` (git-ignored; create it if missing) and fill in:
   ```
   METEOMATICS_USERNAME=your-username
   METEOMATICS_PASSWORD=your-password
   ```
2. Restart the dev server (`cd web && npm run dev`).
3. Open an investigation or probe a point, then press **Get weather (Meteomatics)**.

Check the connection without the UI: `http://localhost:5173/api/meteomatics/status` returns `{"configured":true}` once both values are set.

## How it works

- `web/meteomatics-proxy.ts` adds two routes to the Vite dev and preview servers:
  - `GET /api/meteomatics/status`
  - `GET /api/meteomatics/point?lat=&lon=&time=`
- The route is not an open proxy: it accepts only a point and a time and asks for a fixed parameter list (`t_2m:C`, `precip_24h:mm`, `wind_speed_10m:ms`, `msl_pressure:hPa`).
- Credentials and upstream URLs are never logged or returned.
- Errors are reported as errors (wrong password, plan limits, timeouts), never as empty weather.

## Limits

- Free and trial Meteomatics plans restrict the date range and the parameters. A request for an older event date can be refused with "plan does not allow this request".
- The static build (`npm run build`, GitHub Pages) has no server, so weather is unavailable there and the panel says "not connected". A hosted deployment needs the same route on its own server.
