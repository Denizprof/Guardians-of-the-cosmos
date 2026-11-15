// Loads the shared JSON Schemas and applies the contract's semantic (citation) rules.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate } from './schema.mjs';

const dir = fileURLToPath(new URL('../../shared/assistant-contract/', import.meta.url));
export const requestSchema = JSON.parse(readFileSync(dir + 'assistant-request.schema.json', 'utf8'));
export const responseSchema = JSON.parse(readFileSync(dir + 'assistant-response.schema.json', 'utf8'));
export const CONTRACT_VERSION = '1.0';

export function validateRequest(body) {
  const errors = validate(requestSchema, body);
  return errors.length ? { ok: false, errors } : { ok: true, value: body };
}

/** All citation ids a response is allowed to use for this request. */
export function collectCitationIds(request) {
  const ids = new Set();
  const c = request.context ?? {};
  if (c.event) {
    ids.add(c.event.citation_id);
    for (const r of c.event.references ?? []) ids.add(r.citation_id);
  }
  for (const l of c.selected_layers ?? []) ids.add(l.citation_id);
  for (const g of c.coverage?.granules ?? []) ids.add(g.citation_id);
  for (const k of c.knowledge ?? []) ids.add(k.citation_id); // knowledge records (contract 1.1, "kb:" ids)
  return ids;
}

const MARKER = /\[\[([A-Za-z0-9._:/#-]{1,200})\]\]/g;

/** Schema + semantic validation of a model response against the request it answers. */
export function validateResponse(body, request) {
  const errors = validate(responseSchema, body);
  if (errors.length) return { ok: false, errors };
  const allowed = collectCitationIds(request);
  const cites = body.citations ?? [];
  if (body.status === 'ok') {
    if (!body.answer) errors.push('answer: required when status is ok');
    if (cites.length === 0) errors.push('citations: at least one required when status is ok');
  }
  if (body.status === 'error' && !body.error) errors.push('error: required when status is error');
  const declared = new Set();
  cites.forEach((c, i) => {
    declared.add(c.id);
    if (!allowed.has(c.id)) errors.push(`citations[${i}].id: "${c.id}" is not in the request context`);
  });
  if (body.answer) {
    for (const m of body.answer.text.matchAll(MARKER)) {
      if (!declared.has(m[1])) errors.push(`answer.text: marker [[${m[1]}]] has no matching citation`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: body };
}
