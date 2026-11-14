// =====================================================================================
// TEST FIXTURE ONLY. This is NOT an AI model and must never be deployed or presented
// to users as an assistant. It returns canned, schema-valid responses so the gateway
// can be tested without a real model. Behaviour is selected by the request query:
//   "__timeout__"   never answers within the test timeout
//   "__invalid__"   returns a body that violates the response schema
//   "__uncited__"   returns status ok citing an id that is not in the request context
//   "__http500__"   returns HTTP 500
//   anything else   returns a canned ok response citing the first context citation id
// Run standalone: node fixtures/stub-model.mjs  (listens on 127.0.0.1:8799)
// =====================================================================================
import http from 'node:http';
import { collectCitationIds } from '../src/contract.mjs';

export function startStubModel(port = 0) {
  const seen = { count: 0, lastAuth: undefined, lastBody: undefined };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.count += 1;
      seen.lastAuth = req.headers.authorization;
      let body;
      try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
      seen.lastBody = body;
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      switch (body.query) {
        case '__timeout__': return; // hang
        case '__http500__': return send(500, { oops: true });
        case '__invalid__': return send(200, { version: '1.0', status: 'maybe' });
        case '__uncited__':
          return send(200, { version: '1.0', status: 'ok', answer: { text: 'Claim [[layer:not-in-context]]', format: 'plain' }, citations: [{ id: 'layer:not-in-context', type: 'derived', label: 'bogus' }] });
        default: {
          const id = [...collectCitationIds(body)][0];
          if (!id) return send(200, { version: '1.0', status: 'error', error: { code: 'insufficient_context', message: 'No context supplied.' } });
          return send(200, {
            version: '1.0', status: 'ok',
            answer: { text: `[TEST FIXTURE, not a real model] Canned reply. [[${id}]]`, format: 'plain' },
            citations: [{ id, type: 'derived', label: 'fixture citation' }],
            confidence: 0.5, limitations: ['Canned fixture response.'],
          });
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/` })));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('stub-model.mjs')) {
  const { url } = await startStubModel(8799);
  console.log(`[TEST FIXTURE] stub model at ${url}  (not a real assistant)`);
}
