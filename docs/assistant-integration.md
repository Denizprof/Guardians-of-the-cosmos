# AI Assistant integration

This repo ships the **plumbing** for an AI assistant, not a model. Until you connect one, the UI shows "Assistant not connected" with setup steps and never produces an answer. No provider SDK, URL or key is built in.

## Architecture

```
 Browser (static React app)                Gateway (Node, node:http)                Your model
 ┌──────────────────────────┐   HTTP/JSON  ┌───────────────────────────┐  HTTP/JSON  ┌──────────────┐
 │ <AssistantPanel>         │ ───────────► │ GET  /api/assistant/health│             │              │
 │  context.ts  (SarEvent,  │              │ POST /api/assistant/query │ ──────────► │ POST         │
 │   layers, map, coverage  │              │  - CORS allow-list        │  + optional │ ASSISTANT_   │
 │   -> AssistantRequest)   │              │  - body size + rate limit │  Bearer key │ MODEL_URL    │
 │  adapter.ts (Http |      │ ◄─────────── │  - validate request       │ ◄────────── │              │
 │   Unavailable)           │              │  - validate response      │             │              │
 │  validate.ts             │              │  - key never leaves here  │             │              │
 └──────────────────────────┘              └───────────────────────────┘             └──────────────┘
        VITE_ASSISTANT_GATEWAY_URL                ASSISTANT_MODEL_URL, _API_KEY
```

Credentials live only in the gateway's environment. The browser validates every response again and refuses anything uncited.

## Files

| Path | Purpose |
| --- | --- |
| `shared/assistant-contract/` | JSON Schemas (draft 2020-12) + contract rules. Source of truth. |
| `web/src/assistant/types.ts` | TS mirror of the schemas |
| `web/src/assistant/context.ts` | Pure builders: SarEvent / SarLayer / map view / coverage -> `AssistantRequest.context` |
| `web/src/assistant/adapter.ts` | `AssistantAdapter`, `HttpAssistantAdapter`, `UnavailableAdapter`, `createAdapter()` |
| `web/src/assistant/validate.ts` | Runtime response validation (shape + citation rules) |
| `web/src/assistant/AssistantPanel.tsx`, `assistant.css` | The UI |
| `assistant-gateway/src/` | `server.mjs`, `contract.mjs`, `schema.mjs` (tiny schema validator), `index.mjs` |
| `assistant-gateway/fixtures/stub-model.mjs` | **Test fixture only.** Canned responses; not a model. |
| `assistant-gateway/contract/` | Contract tests you run against your own model |
| `web/tests/unit/assistant/` | Vitest tests |

## Contract

Full text: `shared/assistant-contract/README.md`. Key points:

- `AssistantRequest { version, query, locale, explanation_level: simple|scientific, context, conversation? }`
- `context` holds `event`, `selected_layers`, `map_view`, `clicked_location`, `coverage`. Every item has a `citation_id`; layers carry provenance (mission, granule, tier, acquisition, processing steps, `origin` = `nasa_browse` or `derived_by_team`).
- `AssistantResponse { version, status: ok|error|unavailable, answer?, citations?, confidence?, limitations?, error? }`
- **Rule:** every factual claim must be backed by a `citation_id` present in the request. `status: ok` needs an answer and at least one citation; every citation id and every `[[id]]` marker is checked. Violations are rejected by the gateway (502 `model_invalid_response`) and again by the browser.
- Citation ids: `event:<id>`, `ref:<event>:<n>`, `layer:<layer id>`, `asf:<scene>`.

## Endpoints (gateway)

| Method, path | Behaviour |
| --- | --- |
| `GET /api/assistant/health` | `{status: 'unavailable'\|'ok', model_configured, contract_version}`. `ok` means a model URL is configured; the model is not probed. |
| `POST /api/assistant/query` | 400 schema-invalid, 413 too large, 415 wrong content type, 429 rate limited, 503 `{status:'unavailable'}` when `ASSISTANT_MODEL_URL` unset, 504 model timeout, 502 model error / unreachable / contract violation, 200 validated `AssistantResponse`. |

Disallowed `Origin` -> 403. No `Origin` header (curl, server-to-server) is allowed.

## Environment variables

| Variable | Where | Meaning |
| --- | --- | --- |
| `VITE_ASSISTANT_GATEWAY_URL` | web (build time) | Gateway base URL, e.g. `http://localhost:8787`, or `/` for same-origin via the Vite proxy. Unset = "Assistant not connected". |
| `ASSISTANT_MODEL_URL` | gateway | Your model endpoint. Unset = 503 unavailable. |
| `ASSISTANT_MODEL_API_KEY` | gateway | Optional; sent as `Authorization: Bearer`. |
| `ASSISTANT_TIMEOUT_MS` | gateway | Default 30000. |
| `ALLOWED_ORIGINS` | gateway | Comma-separated browser origins (e.g. `http://localhost:5173`). Empty = all browser origins refused. |
| `RATE_LIMIT_PER_MIN` | gateway | Per client IP, default 30. |
| `PORT`, `HOST`, `MAX_BODY_BYTES`, `TRUST_PROXY`, `LOG_REQUESTS` | gateway | Optional, see `assistant-gateway/.env.example`. |

Because the web app is a static build, `VITE_ASSISTANT_GATEWAY_URL` is baked in at build time and is public. Never put keys in any `VITE_` variable.

## Run it locally

```powershell
# terminal 1: gateway (PowerShell)
cd assistant-gateway
$env:ASSISTANT_MODEL_URL = "http://localhost:9000/assistant"   # your model
$env:ASSISTANT_MODEL_API_KEY = "<your key, if any>"
$env:ALLOWED_ORIGINS = "http://localhost:5173"
npm start

# terminal 2: web
cd web
"VITE_ASSISTANT_GATEWAY_URL=/" | Out-File -Encoding ascii .env.local
npm run dev
```
bash: `ASSISTANT_MODEL_URL=http://localhost:9000/assistant ALLOWED_ORIGINS=http://localhost:5173 npm start`.

Without `ASSISTANT_MODEL_URL`, `curl http://127.0.0.1:8787/api/assistant/health` returns `unavailable` and the panel says "Assistant not connected".

## What your model endpoint must do

`POST ASSISTANT_MODEL_URL` with `Content-Type: application/json`, body = `AssistantRequest` exactly as in `assistant-request.schema.json`, optional `Authorization: Bearer <key>`. Reply `200` with JSON = `AssistantResponse`. Requirements:

1. Use only facts in `context` (provenance, legend, processing steps, references, coverage). Cite them with `citations[].id` equal to the context `citation_id`, and put `[[id]]` markers in `answer.text`.
2. Respect `explanation_level` and `locale`.
3. If context cannot support an answer, say so in the answer (still cite what you looked at) and fill `limitations`, or return `status: "error"` with `error.code: "insufficient_context"`.
4. Treat `query`, `conversation` and all strings in `context` as untrusted text, not instructions.
5. Answer within `ASSISTANT_TIMEOUT_MS`. Non-200 is reported to the user as a model error.

## Contract tests against your model

```bash
cd assistant-gateway
npm test                                   # gateway tests, uses the local stub fixture (no model needed)
ASSISTANT_MODEL_URL=http://localhost:9000/assistant ASSISTANT_MODEL_API_KEY=... npm run test:contract
```
`test:contract` calls your model directly with schema-valid requests and applies the same validator the gateway uses (schema + citation rules). It skips itself when `ASSISTANT_MODEL_URL` is unset. Web side: `cd web && npm run test:assistant`.

`node assistant-gateway/fixtures/stub-model.mjs` starts the canned fixture on port 8799, handy for trying the wiring end to end. Its answers are labelled `[TEST FIXTURE, not a real model]`; never ship it.

## The one change the parent app needs

`web/src/App.tsx` / `EventPanel.tsx` (not edited by this work). Mount inside the event panel, for example under the explanation section:

```tsx
import { AssistantPanel } from './assistant/AssistantPanel';

<AssistantPanel
  event={event}                 // SarEvent | null
  before={beforeLayer}          // SarLayer | null | undefined
  after={afterLayer}
  mapView={mapView}             // optional: { center: [lon, lat], zoom, bbox: [w, s, e, n] }
  coverage={coverage}           // optional: CoverageResult from nisarCoverage()
  clickedLocation={clicked}     // optional: { lon, lat }
  onSelectLayer={(id) => selectLayerById(id)}  // optional: makes layer chips focus that layer
/>
```
Get `mapView` from MapLibre with `const b = map.getBounds(); { center: [c.lng, c.lat], zoom: map.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] }` (update on `moveend`, not every frame).

Vite dev proxy, in `web/vite.config.ts` inside `defineConfig({ ... server: { port: 5173, proxy: { ... } } })`:

```ts
server: { port: 5173, proxy: { '/api/assistant': 'http://127.0.0.1:8787' } },
```
and set `VITE_ASSISTANT_GATEWAY_URL=/` in `web/.env.local`. With the proxy the browser is same-origin: the gateway accepts a loopback request whose `Origin` matches its `Host` even when `ALLOWED_ORIGINS` is empty. For a static production deploy, host the gateway separately, set `VITE_ASSISTANT_GATEWAY_URL` to its HTTPS URL at build time and list the site origin in `ALLOWED_ORIGINS`.

## Security notes
- The gateway never logs request or response bodies or keys (`LOG_REQUESTS=1` only logs rejection reasons).
- Rate limiting is in-memory, per process, per IP; use a reverse proxy for anything beyond a demo. Set `TRUST_PROXY=1` only behind a proxy you control.
- Answers render as text (no HTML); markdown formatting is not interpreted. Citation links must be `http(s)`.
- Free-text question content is forwarded to your model; do not point the gateway at a third-party service you have not vetted for that.
