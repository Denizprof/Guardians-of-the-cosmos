import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGateway, configFromEnv } from '../src/server.mjs';
import { startStubModel } from '../fixtures/stub-model.mjs';
import { sampleRequest } from '../fixtures/sample-request.mjs';
import { requestSchema, responseSchema } from '../src/contract.mjs';
import { SUPPORTED_KEYWORDS, usedKeywords } from '../src/schema.mjs';

let stub;
const started = [];

before(async () => { stub = await startStubModel(); });
after(async () => {
  stub.server.closeAllConnections?.();
  await new Promise((r) => stub.server.close(r));
  for (const s of started) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
});

async function gateway(overrides = {}) {
  const config = { ...configFromEnv({}), port: 0, modelUrl: stub.url, timeoutMs: 2000, allowedOrigins: ['http://localhost:5173'], rateLimitPerMin: 1000, ...overrides };
  const server = createGateway(config);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  started.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base, body, headers = {}) =>
  fetch(`${base}/api/assistant/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('shipped schemas only use keywords the gateway validator supports', () => {
  for (const s of [requestSchema, responseSchema]) {
    for (const k of usedKeywords(s)) assert.ok(SUPPORTED_KEYWORDS.has(k), `unsupported keyword ${k}`);
  }
});

test('health reports unavailable when no model is configured', async () => {
  const base = await gateway({ modelUrl: '' });
  const res = await fetch(`${base}/api/assistant/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'unavailable', model_configured: false, contract_version: '1.0' });
});

test('health reports ok when a model URL is configured', async () => {
  const base = await gateway();
  const j = await (await fetch(`${base}/api/assistant/health`)).json();
  assert.equal(j.status, 'ok');
  assert.equal(j.model_configured, true);
});

test('query returns 503 unavailable when ASSISTANT_MODEL_URL is unset', async () => {
  const base = await gateway({ modelUrl: '' });
  const res = await post(base, sampleRequest());
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.status, 'unavailable');
  assert.match(j.error.message, /not connected/i);
});

test('schema-invalid request is rejected with 400 and details', async () => {
  const base = await gateway();
  const bad = sampleRequest({ explanation_level: 'expert' });
  const res = await post(base, bad);
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.equal(j.error.code, 'invalid_request');
  assert.ok(j.details.some((d) => d.includes('explanation_level')));
});

test('unknown properties and non-JSON bodies are rejected', async () => {
  const base = await gateway();
  assert.equal((await post(base, { ...sampleRequest(), extra: 1 })).status, 400);
  assert.equal((await post(base, '{nope')).status, 400);
});

test('valid request is forwarded to the stub model and a valid response is returned', async () => {
  const base = await gateway();
  const before = stub.seen.count;
  const res = await post(base, sampleRequest());
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.status, 'ok');
  assert.ok(j.answer.text.includes('TEST FIXTURE'));
  assert.equal(stub.seen.count, before + 1);
  assert.equal(stub.seen.lastBody.query, 'What does the colour scale show?');
});

test('bearer key is forwarded to the model but never returned to the client', async () => {
  const base = await gateway({ modelApiKey: 'test-key-123' });
  const res = await post(base, sampleRequest());
  assert.equal(stub.seen.lastAuth, 'Bearer test-key-123');
  assert.ok(!(await res.text()).includes('test-key-123'));
});

test('model timeout yields 504 model_timeout', async () => {
  const base = await gateway({ timeoutMs: 150 });
  const res = await post(base, sampleRequest({ query: '__timeout__' }));
  assert.equal(res.status, 504);
  assert.equal((await res.json()).error.code, 'model_timeout');
});

test('model HTTP error yields 502 model_error', async () => {
  const base = await gateway();
  const res = await post(base, sampleRequest({ query: '__http500__' }));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'model_error');
});

test('unreachable model yields 502 model_unreachable', async () => {
  const base = await gateway({ modelUrl: 'http://127.0.0.1:1/' });
  const res = await post(base, sampleRequest());
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'model_unreachable');
});

test('schema-invalid model response is rejected', async () => {
  const base = await gateway();
  const res = await post(base, sampleRequest({ query: '__invalid__' }));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'model_invalid_response');
});

test('model response citing an id absent from the request context is rejected', async () => {
  const base = await gateway();
  const res = await post(base, sampleRequest({ query: '__uncited__' }));
  assert.equal(res.status, 502);
  const j = await res.json();
  assert.equal(j.error.code, 'model_invalid_response');
  assert.ok(!JSON.stringify(j).includes('not-in-context'));
});

test('oversized body is rejected with 413 (declared and streamed)', async () => {
  const base = await gateway({ maxBodyBytes: 2000 });
  const big = sampleRequest({ query: 'x'.repeat(1500), conversation: [{ role: 'user', content: 'y'.repeat(3000) }] });
  const res = await post(base, big);
  assert.equal(res.status, 413);
});

test('oversized chunked body (no Content-Length) is rejected with 413', async () => {
  const base = await gateway({ maxBodyBytes: 2000 });
  const u = new URL(base);
  const status = await new Promise((resolve, reject) => {
    const r = http.request({ host: u.hostname, port: u.port, path: '/api/assistant/query', method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject);
    r.write('{"a":"' + 'x'.repeat(1500));
    r.end('x'.repeat(1500) + '"}');
  });
  assert.equal(status, 413);
});

test('wrong content type is 415, wrong method is 405, unknown path is 404', async () => {
  const base = await gateway();
  assert.equal((await post(base, sampleRequest(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${base}/api/assistant/query`)).status, 405);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test('CORS: allowed origin is echoed, others are refused, preflight works', async () => {
  const base = await gateway();
  const ok = await fetch(`${base}/api/assistant/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const bad = await fetch(`${base}/api/assistant/health`, { headers: { Origin: 'http://evil.example' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(`${base}/api/assistant/query`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  const preBad = await fetch(`${base}/api/assistant/query`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example' } });
  assert.equal(preBad.status, 403);
});

test('CORS: with empty ALLOWED_ORIGINS every browser origin is refused', async () => {
  const base = await gateway({ allowedOrigins: [] });
  assert.equal((await fetch(`${base}/api/assistant/health`, { headers: { Origin: 'http://localhost:5173' } })).status, 403);
});

test('rate limit returns 429 after RATE_LIMIT_PER_MIN requests', async () => {
  const base = await gateway({ rateLimitPerMin: 3 });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await post(base, sampleRequest())).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
});

test('gateway never logs request bodies or keys', async () => {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
  try {
    const base = await gateway({ modelApiKey: 'secret-key-xyz', log: true });
    await post(base, sampleRequest({ query: 'private-question-text __uncited__' }));
    await post(base, sampleRequest({ query: '__invalid__' }));
  } finally { Object.assign(console, orig); }
  const all = lines.join('\n');
  assert.ok(!all.includes('secret-key-xyz'));
  assert.ok(!all.includes('private-question-text'));
});

// ---- hardening (ECC security review, low findings) ------------------------------------
import { modelUrlProblem } from '../src/server.mjs';

test('model URL validation: https anywhere, http only to loopback, no embedded credentials', () => {
  assert.equal(modelUrlProblem(''), null);
  assert.equal(modelUrlProblem('https://models.example.org/v1/answer'), null);
  assert.equal(modelUrlProblem('http://127.0.0.1:8799/'), null);
  assert.equal(modelUrlProblem('http://localhost:8799/'), null);
  assert.match(modelUrlProblem('http://models.example.org/'), /https/);
  assert.match(modelUrlProblem('file:///etc/passwd'), /https/);
  assert.match(modelUrlProblem('not a url'), /valid absolute URL/);
  assert.match(modelUrlProblem('https://user:pw@models.example.org/'), /credentials/);
  assert.throws(() => createGateway({ ...configFromEnv({}), modelUrl: 'ftp://x.example/' }), /https/);
});

test('with TRUST_PROXY the right-most X-Forwarded-For entry is rate-limited (left-most is spoofable)', async () => {
  const base = await gateway({ rateLimitPerMin: 2, trustProxy: true });
  const codes = [];
  // a client rotating a fake left-most address must still hit the limit for the proxy-appended address
  for (let i = 0; i < 4; i++) codes.push((await post(base, sampleRequest(), { 'X-Forwarded-For': `10.0.0.${i}, 203.0.113.7` })).status);
  assert.deepEqual(codes, [200, 200, 429, 429]);
});

test('oversized model response is discarded with 502 model_response_too_large', async () => {
  const big = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ pad: 'x'.repeat(5000) })); });
  await new Promise((r) => big.listen(0, '127.0.0.1', r));
  started.push(big);
  const base = await gateway({ modelUrl: `http://127.0.0.1:${big.address().port}/`, maxModelResponseBytes: 1000 });
  const res = await post(base, sampleRequest());
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'model_response_too_large');
});

test('oversized chunked model response (no Content-Length) is also discarded', async () => {
  const big = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    for (let i = 0; i < 20; i++) res.write('"' + 'y'.repeat(500) + '",');
    res.end('1');
  });
  await new Promise((r) => big.listen(0, '127.0.0.1', r));
  started.push(big);
  const base = await gateway({ modelUrl: `http://127.0.0.1:${big.address().port}/`, maxModelResponseBytes: 1000 });
  const res = await post(base, sampleRequest());
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'model_response_too_large');
});

// ---- review fixes: same-origin proxy, redirects never leak the key --------------------
import { sameOriginLoopback } from '../src/server.mjs';

test('same-origin loopback requests are accepted with an empty ALLOWED_ORIGINS; rebinding hosts are not', () => {
  assert.equal(sameOriginLoopback('http://localhost:5173', 'localhost:5173'), true);
  assert.equal(sameOriginLoopback('http://127.0.0.1:5173', '127.0.0.1:5173'), true);
  assert.equal(sameOriginLoopback('http://localhost:5173', '127.0.0.1:8787'), false);   // different host
  assert.equal(sameOriginLoopback('http://evil.example:8787', 'evil.example:8787'), false); // DNS rebinding
  assert.equal(sameOriginLoopback('null', 'localhost:5173'), false);
  assert.equal(sameOriginLoopback('http://localhost:5173', undefined), false);
});

test('a query POST via the dev proxy (Origin = Host, loopback) is not refused as cross-origin', async () => {
  const base = await gateway({ allowedOrigins: [] });
  const host = new URL(base).host;
  const res = await post(base, sampleRequest(), { Origin: `http://${host}` });
  assert.equal(res.status, 200);
});

test('a model redirect is refused and the API key never reaches the redirect target', async () => {
  const hits = [];
  const target = http.createServer((req, res) => { hits.push(req.headers); res.end('{}'); });
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  started.push(target);
  const redirector = http.createServer((req, res) => { req.resume(); res.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/` }); res.end(); });
  await new Promise((r) => redirector.listen(0, '127.0.0.1', r));
  started.push(redirector);
  const base = await gateway({ modelUrl: `http://127.0.0.1:${redirector.address().port}/`, modelApiKey: 'TEST-KEY-NOT-REAL' });
  const res = await post(base, sampleRequest());
  assert.equal(res.status, 502);
  assert.equal(hits.length, 0);
});
