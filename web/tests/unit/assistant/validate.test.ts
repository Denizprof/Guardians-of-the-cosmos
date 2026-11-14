import { describe, expect, it } from 'vitest';
import { validateResponse } from '../../../src/assistant/validate';

const allowed = new Set(['layer:a', 'ref:e:0']);
const good = {
  version: '1.0',
  status: 'ok',
  answer: { text: 'Motion is away from the satellite. [[layer:a]]', format: 'markdown' },
  citations: [{ id: 'layer:a', type: 'derived', label: 'LOS displacement', layer_id: 'a' }],
  confidence: 0.7,
  limitations: ['Line-of-sight only'],
};

describe('validateResponse', () => {
  it('accepts a well-formed cited answer', () => {
    expect(validateResponse(good, allowed).ok).toBe(true);
  });

  it('rejects non-objects and wrong versions', () => {
    expect(validateResponse(null).ok).toBe(false);
    expect(validateResponse('x').ok).toBe(false);
    expect(validateResponse({ ...good, version: '2.0' }).ok).toBe(false);
  });

  it('rejects status ok without citations (uncited claims)', () => {
    const r = validateResponse({ ...good, citations: [] }, allowed);
    expect(r.ok).toBe(false);
    const r2 = validateResponse({ version: '1.0', status: 'ok', answer: good.answer }, allowed);
    expect(r2.ok).toBe(false);
  });

  it('rejects citations not present in the request context', () => {
    const r = validateResponse({ ...good, answer: { text: 'x [[layer:zzz]]', format: 'plain' }, citations: [{ id: 'layer:zzz', type: 'derived', label: 'x' }] }, allowed);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/not in the request context/);
  });

  it('rejects inline markers that have no citation entry', () => {
    const r = validateResponse({ ...good, answer: { text: 'a [[layer:a]] b [[ref:e:0]]', format: 'plain' } }, allowed);
    expect(r.ok).toBe(false);
  });

  it('rejects bad enums, missing label, unknown properties, bad confidence', () => {
    expect(validateResponse({ ...good, status: 'maybe' }).ok).toBe(false);
    expect(validateResponse({ ...good, answer: { text: 'x', format: 'html' } }).ok).toBe(false);
    expect(validateResponse({ ...good, citations: [{ id: 'layer:a', type: 'derived' }] }).ok).toBe(false);
    expect(validateResponse({ ...good, extra: 1 }).ok).toBe(false);
    expect(validateResponse({ ...good, confidence: 2 }).ok).toBe(false);
  });

  it('rejects non-http(s) citation urls such as javascript:', () => {
    const r = validateResponse({ ...good, citations: [{ id: 'layer:a', type: 'reference', label: 'x', url: 'javascript:alert(1)' }] }, allowed);
    expect(r.ok).toBe(false);
  });

  it('accepts error and unavailable responses; error requires an error object', () => {
    expect(validateResponse({ version: '1.0', status: 'unavailable' }).ok).toBe(true);
    expect(validateResponse({ version: '1.0', status: 'error', error: { code: 'x', message: 'y' } }).ok).toBe(true);
    expect(validateResponse({ version: '1.0', status: 'error' }).ok).toBe(false);
  });

  it('checks shape only when no allowed set is supplied', () => {
    expect(validateResponse({ ...good, citations: [{ id: 'anything', type: 'derived', label: 'x' }], answer: { text: 'ok [[anything]]', format: 'plain' } }).ok).toBe(true);
  });
});
