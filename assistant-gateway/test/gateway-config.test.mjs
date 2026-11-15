// Regression tests for the gateway-config audit findings: the Vite dev proxy must keep the
// browser's Host header, the schema validator must not see Object.prototype members as declared
// properties, and the documented .env.example template must not be swallowed by .gitignore.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGateway, configFromEnv } from '../src/server.mjs';
import { startStubModel } from '../fixtures/stub-model.mjs';
import { sampleRequest } from '../fixtures/sample-request.mjs';
import { validateRequest, validateResponse } from '../src/contract.mjs';
import { validate } from '../src/schema.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

let stub;
const started = [];
before(async () => { stub = await startStubModel(); });
after(async () => {
  stub.server.closeAllConnections?.();
  await new Promise((r) => stub.server.close(r));
  for (const s of started) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
});

async function gateway(overrides = {}) {
  const config = { ...configFromEnv({}), port: 0, modelUrl: stub.url, timeoutMs: 2000, allowedOrigins: [], rateLimitPerMin: 1000, ...overrides };
  const server = createGateway(config);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  started.push(server);
  return server.address().port;
}

/** POST with an explicit Host header (fetch cannot override Host), as a proxy would send it. */
function postWithHost(port, host, origin, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/api/assistant/query', method: 'POST',
      headers: { Host: host, Origin: origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

// ---- dev proxy must preserve Host ------------------------------------------------------

test('with ALLOWED_ORIGINS empty, a proxied query that keeps the browser Host is accepted and a rewritten Host is refused', async () => {
  const port = await gateway();
  const kept = await postWithHost(port, 'localhost:5173', 'http://localhost:5173', sampleRequest());
  assert.equal(kept.status, 200, kept.text);
  const rewritten = await postWithHost(port, '127.0.0.1:8787', 'http://localhost:5173', sampleRequest());
  assert.equal(rewritten.status, 403);
  assert.equal(JSON.parse(rewritten.text).error.code, 'origin_not_allowed');
});

test('web/vite.config.ts proxies /api/assistant without rewriting Host (changeOrigin: false, not the string shorthand)', () => {
  const src = readFileSync(repoRoot + 'web/vite.config.ts', 'utf8');
  // The string shorthand expands to changeOrigin: true, which makes every same-origin query fail with 403.
  assert.doesNotMatch(src, /['"]\/api\/assistant['"]\s*:\s*['"`]/, 'string shorthand proxy entry rewrites Host');
  const entry = src.match(/['"]\/api\/assistant['"]\s*:\s*\{([^}]*)\}/);
  assert.ok(entry, 'expected an object proxy entry for /api/assistant');
  assert.match(entry[1], /target\s*:\s*['"]http:\/\/127\.0\.0\.1:8787['"]/);
  assert.match(entry[1], /changeOrigin\s*:\s*false/);
});

// ---- prototype-named keys --------------------------------------------------------------

const PROTO_KEYS = ['"constructor": {"x": 1}', '"toString": "free text"', '"__proto__": {"evil": 1}', '"hasOwnProperty": 1', '"valueOf": "v"'];
/** Insert a raw JSON member at the start of an object so "__proto__" becomes an own key after JSON.parse. */
const inject = (json, anchor, member) => {
  assert.ok(json.includes(anchor), `anchor ${anchor} not found`);
  return JSON.parse(json.replace(anchor, `${anchor}${member}, `));
};
const keyOf = (member) => member.slice(1, member.indexOf('"', 1));

test('request: undeclared keys named after Object.prototype members are rejected at top level and nested', () => {
  const json = JSON.stringify(sampleRequest());
  assert.equal(validateRequest(JSON.parse(json)).ok, true);
  for (const member of PROTO_KEYS) {
    const top = validateRequest(inject(json, '{', member));
    assert.equal(top.ok, false, `top-level ${member} accepted`);
    assert.ok(top.errors.includes(`${keyOf(member)}: unknown property`), top.errors.join('; '));
    const nested = validateRequest(inject(json, '"context":{', member));
    assert.equal(nested.ok, false, `nested ${member} accepted`);
    assert.ok(nested.errors.includes(`context.${keyOf(member)}: unknown property`), nested.errors.join('; '));
  }
});

test('response: undeclared keys named after Object.prototype members are rejected', async () => {
  const request = sampleRequest();
  const port = await gateway();
  const good = await postWithHost(port, 'localhost:5173', 'http://localhost:5173', request);
  assert.equal(good.status, 200, good.text);
  assert.equal(validateResponse(JSON.parse(good.text), request).ok, true);
  for (const member of PROTO_KEYS) {
    const checked = validateResponse(inject(good.text, '{', member), request);
    assert.equal(checked.ok, false, `${member} accepted`);
    assert.ok(checked.errors.includes(`${keyOf(member)}: unknown property`), checked.errors.join('; '));
  }
});

test('validate: required and $ref do not resolve through the prototype chain', () => {
  assert.deepEqual(validate({ type: 'object', required: ['toString'], properties: {} }, {}), ['toString: required']);
  assert.deepEqual(validate({ type: 'object', required: ['a'], properties: { a: { type: 'string' } } }, { a: 'x' }), []);
  assert.throws(() => validate({ $ref: '#/$defs/constructor', $defs: {} }, 1), /Unresolvable \$ref/);
  // additionalProperties as a schema still applies to prototype-named keys.
  assert.deepEqual(
    validate({ type: 'object', additionalProperties: { type: 'number' } }, JSON.parse('{"constructor": "text"}')),
    ['constructor: expected number, got string'],
  );
});

// ---- .env.example template -------------------------------------------------------------

/** Exit status of `git check-ignore -q <path>`: 0 = ignored, 1 = not ignored. */
function ignoreStatus(path) {
  try { execFileSync('git', ['check-ignore', '-q', path], { cwd: repoRoot, stdio: 'ignore' }); return 0; }
  catch (e) { return e.status; }
}

test('.gitignore keeps real env files ignored but lets the documented .env.example template be committed', () => {
  assert.equal(ignoreStatus('assistant-gateway/.env.example'), 1, 'assistant-gateway/.env.example is git-ignored');
  assert.equal(ignoreStatus('assistant-gateway/.env'), 0);
  assert.equal(ignoreStatus('assistant-gateway/.env.local'), 0);
  assert.equal(ignoreStatus('web/.env.local'), 0);
});

test('assistant-gateway/.env.example holds placeholders only and documents the optional variables', () => {
  const vars = new Map();
  for (const line of readFileSync(repoRoot + 'assistant-gateway/.env.example', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) vars.set(m[1], m[2]);
  }
  assert.equal(vars.get('ASSISTANT_MODEL_API_KEY'), '', 'the template must not carry a key');
  assert.equal(vars.get('ASSISTANT_MODEL_URL'), '', 'the template must not carry a model URL');
  for (const name of ['PORT', 'HOST', 'MAX_BODY_BYTES', 'TRUST_PROXY', 'LOG_REQUESTS']) assert.ok(vars.has(name), `${name} missing from template`);
});
