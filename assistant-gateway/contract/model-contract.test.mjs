// Contract tests against YOUR real model endpoint. Skipped unless ASSISTANT_MODEL_URL is set.
//   ASSISTANT_MODEL_URL=http://localhost:9000/assistant npm run test:contract
// Calls the model directly (no gateway) with schema-valid requests and checks that every
// response satisfies the response schema and the citation rules in shared/assistant-contract/README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResponse } from '../src/contract.mjs';
import { sampleRequest } from '../fixtures/sample-request.mjs';

const url = process.env.ASSISTANT_MODEL_URL;
const key = process.env.ASSISTANT_MODEL_API_KEY;
const timeout = Number(process.env.ASSISTANT_TIMEOUT_MS) || 60000;
const skip = url ? false : 'ASSISTANT_MODEL_URL not set; nothing to test';

async function ask(req) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(timeout),
  });
  assert.ok(res.ok, `model returned HTTP ${res.status}`);
  return res.json();
}

const cases = {
  'answers a question about a selected layer with valid citations': sampleRequest(),
  'scientific level': sampleRequest({ explanation_level: 'scientific', query: 'Explain the processing and its limits.' }),
  'question with no supporting context must not invent citations': sampleRequest({ query: 'What happened in Tokyo yesterday?', context: {} }),
  'multi-turn conversation': sampleRequest({ conversation: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }], query: 'And the tier of this data?' }),
};

for (const [name, req] of Object.entries(cases)) {
  test(name, { skip }, async () => {
    const json = await ask(req);
    const r = validateResponse(json, req);
    assert.ok(r.ok, `contract violations: ${r.errors?.join('; ')}`);
  });
}
