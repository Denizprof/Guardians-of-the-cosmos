# Assistant contract (version 1.0)

Language-neutral contract between the Global SAR web app, the gateway (`assistant-gateway/`) and **your** AI model. This project ships no model; this folder only defines what the model receives and must return.

- `assistant-request.schema.json`: `AssistantRequest` (JSON Schema draft 2020-12)
- `assistant-response.schema.json`: `AssistantResponse`
- Both the web validator (`web/src/assistant/validate.ts`) and the gateway (`assistant-gateway/src/schema.mjs`) enforce these.

## Versioning
- `version` is `"MAJOR.MINOR"`. Current: `1.0`.
- Minor bumps only add optional fields; consumers must ignore nothing silently, so unknown fields are rejected today (`additionalProperties: false`). When a minor adds fields, update the schemas in this folder first, then both validators.
- A breaking change bumps MAJOR and the `^1\.` pattern in both schemas. The gateway rejects other majors with HTTP 400.

## Request shape (summary)
```
{ version, query, locale, explanation_level: "simple"|"scientific",
  context: { event?, selected_layers?, map_view?, clicked_location?, coverage? },
  conversation?: [{ role: "user"|"assistant", content }] }
```
`map_view` is optional in the schema because the map can be absent when the panel opens; when present it needs `center [lon,lat]`, `zoom`, `bbox [w,s,e,n]`.

Every context item carries a **`citation_id`**:

| Context item | citation_id | provenance |
| --- | --- | --- |
| event | `event:<event id>` | via its layers |
| event reference | `ref:<event id>:<index>` | label + url |
| selected layer | `layer:<layer id>` | full: mission, granule, tier, acquisition, processing steps, `origin` (`nasa_browse` or `derived_by_team`) |
| coverage granule | `asf:<scene name>` | scene, product, tier, track, frame, start |

## Response shape (summary)
```
{ version, status: "ok"|"error"|"unavailable",
  answer?: { text, format: "markdown"|"plain" },
  citations?: [{ id, type: "observation"|"derived"|"reference", label, granule?, url?, layer_id? }],
  confidence?: 0..1, limitations?: string[], error?: { code, message } }
```

## Citation rules (enforced, not advisory)
1. Every factual claim must be backed by a citation id that is **present in the request context**. Use inline markers `[[citation_id]]` in `answer.text`.
2. `status: "ok"` requires `answer` and at least one citation.
3. Every entry in `citations[].id` must equal a `citation_id` from the request context; unknown ids are rejected.
4. Every `[[id]]` marker in the text must have a matching `citations` entry.
5. `citations[].type`: `observation` = NASA browse imagery or ASF acquisition, `derived` = a layer computed by the team, `reference` = an external reference URL from the event.
6. `citations[].url` must be `http(s)://`.
7. If the context cannot support an answer, return `status: "ok"` with a short answer that says so (cite the context item you looked at) and fill `limitations`, or return `status: "error"` with code `insufficient_context`. Never invent data.
8. `status: "error"` requires `error`. `status: "unavailable"` means the model is up but cannot serve (maintenance, quota).

Violations make the gateway return HTTP 502 `model_invalid_response` and the web app discards the response.

## Example
Request (abridged):
```json
{
  "version": "1.0", "query": "What does the colour scale show?", "locale": "en", "explanation_level": "simple",
  "context": { "selected_layers": [ { "citation_id": "layer:gunw_20260613_20260625", "layer_id": "gunw_20260613_20260625",
    "type": "derived", "role": "after", "kind": "los", "product": "GUNW",
    "legend": { "units": "cm" },
    "provenance": { "mission": "NISAR", "granule": "NISAR_L2_...", "tier": "PROVISIONAL",
      "acquisition": { "reference": "2026-06-13T10:06:56Z", "secondary": "2026-06-25T10:06:55Z" },
      "processing": ["Ionosphere screen removed"], "origin": "derived_by_team" } } ] }
}
```
Response:
```json
{
  "version": "1.0", "status": "ok",
  "answer": { "text": "Colours show line-of-sight motion in cm. [[layer:gunw_20260613_20260625]]", "format": "markdown" },
  "citations": [ { "id": "layer:gunw_20260613_20260625", "type": "derived", "label": "GUNW line-of-sight displacement", "layer_id": "gunw_20260613_20260625" } ],
  "confidence": 0.8,
  "limitations": ["Line-of-sight only; troposphere not corrected."]
}
```
