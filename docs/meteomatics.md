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
3. Open an investigation, a catalog event or probe a point, then press **Get weather** in the "Weather here" section. The result names its source ("Meteomatics Weather API" when the account is used).

Check the connection without the UI: `http://localhost:5173/api/meteomatics/status` returns `{"configured":true}` once both values are set.

## How it works

- `web/meteomatics-proxy.ts` adds two routes to the Vite dev and preview servers:
  - `GET /api/meteomatics/status`
  - `GET /api/meteomatics/point?lat=&lon=&time=`
- The route is not an open proxy: it accepts only a point and a time and asks for a fixed parameter list (`t_2m:C`, `precip_24h:mm`, `wind_speed_10m:ms`, `msl_pressure:hPa`).
- Credentials and upstream URLs are never logged or returned.
- Errors are reported as errors (wrong password, plan limits, timeouts), never as empty weather. A response with no value for any parameter is also shown as an error ("The weather service returned no values for this place and time"), not as four "not available" rows.

## Which time is asked

- No date (a plain probe): now.
- A date with a time of day: that instant. `precip_24h:mm` is the rain of the 24 hours ending at it.
- A date known only to the day (`date_precision: "day"`, stored as 00:00 UTC): the end of that UTC day, so the 24 h rain is the total of the event day itself, labelled "Precipitation, event day (UTC)". Temperature, wind and pressure are then one sample at the end of that day. This applies to investigations, catalog events and a coverage probe started from a catalog event.
- A date known only to the month or year: no date is used; the weather is for now.
- A future time is never asked: both the browser code and the route clamp it to now.

## Without an account: Open-Meteo

When the route is missing (static build) or the credentials are not set, the browser asks the key-less [Open-Meteo](https://open-meteo.com/) API directly, with the same four values and the same timing rules. The result names its source.

- Dates up to 60 days old use the forecast endpoint; older dates use the ERA5 reanalysis archive. If the forecast endpoint answers with no values for a date more than 7 days old, the archive is asked once.
- The two providers use different weather models. Rain totals for the same point and day can differ by large factors; temperature and pressure usually agree closely.

## Limits

- All values are weather-model output for the point, not a station measurement and not a satellite observation.
- Free and trial Meteomatics plans restrict the date range and the parameters. A request for an older event date can be refused with "plan does not allow this request". There is no automatic fallback to Open-Meteo when a configured Meteomatics request fails: the error is shown.
- The route caches an answer for 10 minutes per point and hour, so a repeated "now" request can show values up to 10 minutes old (with their real valid time).
- The static build (`npm run build`, GitHub Pages) has no server, so Meteomatics is not used there; weather comes from Open-Meteo instead. A hosted deployment that should use Meteomatics needs the same route on its own server.
