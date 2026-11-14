// Global SAR assistant gateway. node:http only. Keeps model credentials server-side.
// Never logs request bodies, response bodies or keys.
import http from 'node:http';
import { CONTRACT_VERSION, validateRequest, validateResponse } from './contract.mjs';

export function configFromEnv(env = process.env) {
  const int = (v, d) => (Number.isFinite(parseInt(v, 10)) && parseInt(v, 10) > 0 ? parseInt(v, 10) : d);
  return {
    port: int(env.PORT, 8787),
    host: env.HOST || '127.0.0.1',
    modelUrl: (env.ASSISTANT_MODEL_URL || '').trim(),
    modelApiKey: (env.ASSISTANT_MODEL_API_KEY || '').trim(),
    timeoutMs: int(env.ASSISTANT_TIMEOUT_MS, 30000),
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    rateLimitPerMin: int(env.RATE_LIMIT_PER_MIN, 30),
    maxBodyBytes: int(env.MAX_BODY_BYTES, 256 * 1024),
    trustProxy: env.TRUST_PROXY === '1',
    log: env.LOG_REQUESTS === '1',
  };
}

const errorBody = (status, code, message) => ({ version: CONTRACT_VERSION, status, error: { code, message } });

export function createGateway(config) {
  const hits = new Map(); // ip -> { windowStart, count }

  function rateLimited(ip, now = Date.now()) {
    if (hits.size > 10000) for (const [k, v] of hits) if (now - v.windowStart >= 60000) hits.delete(k);
    const e = hits.get(ip);
    if (!e || now - e.windowStart >= 60000) { hits.set(ip, { windowStart: now, count: 1 }); return false; }
    e.count += 1;
    return e.count > config.rateLimitPerMin;
  }

  function clientIp(req) {
    if (config.trustProxy) {
      const xf = req.headers['x-forwarded-for'];
      if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function send(res, code, body, extra = {}) {
    const data = JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(data);
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > limit) return reject(Object.assign(new Error('too large'), { code: 'too_large' }));
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { chunks.length = 0; reject(Object.assign(new Error('too large'), { code: 'too_large' })); req.removeAllListeners('data'); req.resume(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function callModel(request) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (config.modelApiKey) headers.Authorization = `Bearer ${config.modelApiKey}`;
    let res;
    try {
      res = await fetch(config.modelUrl, {
        method: 'POST', headers, body: JSON.stringify(request), redirect: 'error',
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { code: 504, body: errorBody('error', 'model_timeout', 'The model did not answer in time.') };
      return { code: 502, body: errorBody('error', 'model_unreachable', 'The model endpoint could not be reached.') };
    }
    if (!res.ok) return { code: 502, body: errorBody('error', 'model_error', `The model endpoint returned HTTP ${res.status}.`) };
    let json;
    try { json = await res.json(); } catch { return { code: 502, body: errorBody('error', 'model_invalid_response', 'The model response was not valid JSON.') }; }
    const checked = validateResponse(json, request);
    if (!checked.ok) {
      if (config.log) console.warn('[gateway] model response rejected:', checked.errors.slice(0, 5).join('; '));
      return { code: 502, body: errorBody('error', 'model_invalid_response', 'The model response violated the assistant contract and was discarded.') };
    }
    return { code: 200, body: checked.value };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const origin = req.headers.origin;
    const cors = {};
    if (origin) {
      if (!config.allowedOrigins.includes(origin)) return send(res, 403, errorBody('error', 'origin_not_allowed', 'Origin not allowed.'));
      Object.assign(cors, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' });
    }
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
        return res.end();
      }
      if (url.pathname === '/api/assistant/health' && req.method === 'GET') {
        const configured = Boolean(config.modelUrl);
        // "ok" means a model endpoint is configured; the gateway does not probe it.
        return send(res, 200, { status: configured ? 'ok' : 'unavailable', model_configured: configured, contract_version: CONTRACT_VERSION }, cors);
      }
      if (url.pathname === '/api/assistant/query') {
        if (req.method !== 'POST') return send(res, 405, errorBody('error', 'method_not_allowed', 'Use POST.'), { ...cors, Allow: 'POST, OPTIONS' });
        if (rateLimited(clientIp(req))) return send(res, 429, errorBody('error', 'rate_limited', 'Too many requests.'), { ...cors, 'Retry-After': '60' });
        const ctype = String(req.headers['content-type'] || '');
        if (!ctype.toLowerCase().startsWith('application/json')) return send(res, 415, errorBody('error', 'unsupported_media_type', 'Content-Type must be application/json.'), cors);
        let raw;
        try { raw = await readBody(req, config.maxBodyBytes); } catch (e) {
          if (e.code === 'too_large') return send(res, 413, errorBody('error', 'payload_too_large', `Request exceeds ${config.maxBodyBytes} bytes.`), { ...cors, Connection: 'close' });
          return send(res, 400, errorBody('error', 'bad_request', 'Could not read request body.'), cors);
        }
        let body;
        try { body = JSON.parse(raw); } catch { return send(res, 400, errorBody('error', 'invalid_json', 'Body is not valid JSON.'), cors); }
        const checked = validateRequest(body);
        if (!checked.ok) return send(res, 400, { ...errorBody('error', 'invalid_request', 'Request does not match the AssistantRequest schema.'), details: checked.errors.slice(0, 10) }, cors);
        if (!config.modelUrl) return send(res, 503, { version: CONTRACT_VERSION, status: 'unavailable', error: { code: 'model_not_configured', message: 'Assistant not connected: ASSISTANT_MODEL_URL is not set.' } }, cors);
        const out = await callModel(checked.value);
        return send(res, out.code, out.body, cors);
      }
      return send(res, 404, errorBody('error', 'not_found', 'Not found.'), cors);
    } catch {
      if (!res.headersSent) send(res, 500, errorBody('error', 'internal_error', 'Internal error.'), cors);
    }
  });
  server.requestTimeout = 30000;
  return server;
}
