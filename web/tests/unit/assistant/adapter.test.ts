import { describe, expect, it, vi } from 'vitest';
import { HttpAssistantAdapter, UnavailableAdapter, createAdapter } from '../../../src/assistant/adapter';
import { buildRequest } from '../../../src/assistant/context';
import type { AssistantRequest } from '../../../src/assistant/types';

const req: AssistantRequest = buildRequest({
  query: 'q', locale: 'en', level: 'simple',
  context: { event: { citation_id: 'event:e', id: 'e', title: 'E', category: 'flood', technique: 'backscatter', location: { lon: 0, lat: 0 } } },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const okBody = { version: '1.0', status: 'ok', answer: { text: 'a [[event:e]]', format: 'plain' }, citations: [{ id: 'event:e', type: 'observation', label: 'E' }] };

describe('UnavailableAdapter / createAdapter', () => {
  it('reports unavailable and never answers', async () => {
    const a = new UnavailableAdapter();
    expect((await a.health()).status).toBe('unavailable');
    const r = await a.query();
    expect(r.status).toBe('unavailable');
    expect(r.answer).toBeUndefined();
    expect(r.error?.message).toMatch(/not connected/i);
  });

  it('is chosen when the gateway URL is unset or blank', () => {
    expect(createAdapter({})).toBeInstanceOf(UnavailableAdapter);
    expect(createAdapter({ VITE_ASSISTANT_GATEWAY_URL: '  ' })).toBeInstanceOf(UnavailableAdapter);
    expect(createAdapter({ VITE_ASSISTANT_GATEWAY_URL: 'http://localhost:8787' })).toBeInstanceOf(HttpAssistantAdapter);
  });
});

describe('HttpAssistantAdapter', () => {
  it('health: ok only when the gateway says a model is configured', async () => {
    const f = vi.fn().mockResolvedValue(json({ status: 'ok', model_configured: true, contract_version: '1.0' }));
    const h = await new HttpAssistantAdapter('http://gw/', f).health();
    expect(h).toMatchObject({ status: 'ok', model_configured: true });
    expect(f.mock.calls[0][0]).toBe('http://gw/api/assistant/health');
    const f2 = vi.fn().mockResolvedValue(json({ status: 'unavailable', model_configured: false, contract_version: '1.0' }));
    expect((await new HttpAssistantAdapter('http://gw', f2).health()).status).toBe('unavailable');
  });

  it('health: network failure and bad payloads become error, not a thrown exception', async () => {
    expect((await new HttpAssistantAdapter('/', vi.fn().mockRejectedValue(new TypeError('x'))).health()).status).toBe('error');
    expect((await new HttpAssistantAdapter('/', vi.fn().mockResolvedValue(json({ hi: 1 }))).health()).status).toBe('error');
    expect((await new HttpAssistantAdapter('/', vi.fn().mockResolvedValue(json({}, 500))).health()).status).toBe('error');
  });

  it('"/" as gateway URL means same origin', async () => {
    const f = vi.fn().mockResolvedValue(json(okBody));
    await new HttpAssistantAdapter('/', f).query(req);
    expect(f.mock.calls[0][0]).toBe('/api/assistant/query');
  });

  it('query posts the request and returns a validated response', async () => {
    const f = vi.fn().mockResolvedValue(json(okBody));
    const r = await new HttpAssistantAdapter('http://gw', f).query(req);
    expect(r.status).toBe('ok');
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).query).toBe('q');
  });

  it('discards a response that cites something outside the request context', async () => {
    const bad = { ...okBody, answer: { text: 'a [[layer:zzz]]', format: 'plain' }, citations: [{ id: 'layer:zzz', type: 'derived', label: 'x' }] };
    const r = await new HttpAssistantAdapter('http://gw', vi.fn().mockResolvedValue(json(bad))).query(req);
    expect(r.status).toBe('error');
    expect(r.error?.code).toBe('invalid_response');
    expect(r.answer).toBeUndefined();
  });

  it('surfaces gateway 503 as unavailable and 429 as error with the gateway message', async () => {
    const r503 = await new HttpAssistantAdapter('http://gw', vi.fn().mockResolvedValue(json({ version: '1.0', status: 'unavailable', error: { code: 'model_not_configured', message: 'Assistant not connected: x' } }, 503))).query(req);
    expect(r503.status).toBe('unavailable');
    const r429 = await new HttpAssistantAdapter('http://gw', vi.fn().mockResolvedValue(json({ version: '1.0', status: 'error', error: { code: 'rate_limited', message: 'Too many requests.' } }, 429))).query(req);
    expect(r429).toMatchObject({ status: 'error', error: { code: 'rate_limited' } });
  });

  it('handles 400 bodies with extra "details" and non-JSON bodies', async () => {
    const r400 = await new HttpAssistantAdapter('http://gw', vi.fn().mockResolvedValue(json({ version: '1.0', status: 'error', error: { code: 'invalid_request', message: 'bad' }, details: ['x'] }, 400))).query(req);
    expect(r400.error?.code).toBe('invalid_request');
    const rtxt = await new HttpAssistantAdapter('http://gw', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 }))).query(req);
    expect(rtxt.error?.code).toBe('bad_gateway_response');
  });

  it('network errors resolve to an error response; aborts reject', async () => {
    const r = await new HttpAssistantAdapter('http://gw', vi.fn().mockRejectedValue(new TypeError('fail'))).query(req);
    expect(r.error?.code).toBe('network_error');
    const abort = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(new HttpAssistantAdapter('http://gw', abort).query(req, new AbortController().signal)).rejects.toThrow();
  });
});
