// Property-based + fuzz tests for src/assistant/validate.ts: no uncited claim ever validates.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateResponse, isSafeHttpUrl } from '../../../src/assistant/validate';

const MARKER = /\[\[([A-Za-z0-9._:/#-]{1,200})\]\]/g;
const idChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:/#-'.split('');
const cid = fc.array(fc.constantFrom(...idChars), { minLength: 1, maxLength: 12 }).map((a) => a.join(''));
const citation = (id: fc.Arbitrary<string>) => fc.record({
  id,
  type: fc.constantFrom('observation', 'derived', 'reference'),
  label: fc.string({ minLength: 1, maxLength: 30 }),
}, { requiredKeys: ['id', 'type', 'label'] });

// Text with random citation markers sprinkled in.
const textWith = (ids: fc.Arbitrary<string>) =>
  fc.array(fc.oneof(fc.string({ maxLength: 15 }), ids.map((i) => `[[${i}]]`)), { minLength: 1, maxLength: 8 }).map((p) => p.join(' ')).filter((t) => t.length > 0);

const okResponse = fc.record({
  version: fc.constantFrom('1.0', '1.2', '1.10'),
  status: fc.constant('ok'),
  answer: textWith(cid).map((text) => ({ text, format: 'plain' as const })),
  citations: fc.array(citation(cid), { maxLength: 6 }),
});

describe('validateResponse: no uncited claim validates', () => {
  it('ok => at least one citation, every [[marker]] declared, every citation in the allowed context', () => {
    fc.assert(fc.property(okResponse, fc.array(cid, { maxLength: 8 }), (resp, allowedList) => {
      const allowed = new Set(allowedList);
      const res = validateResponse(resp, allowed);
      if (res.ok) {
        const declared = new Set(resp.citations.map((c) => c.id));
        expect(declared.size).toBeGreaterThan(0);
        for (const m of resp.answer.text.matchAll(MARKER)) expect(declared.has(m[1])).toBe(true);
        for (const id of declared) expect(allowed.has(id)).toBe(true);
      } else {
        expect(res.errors.length).toBeGreaterThan(0);
      }
    }), { numRuns: 1500 });
  });

  it('completeness: a response built from allowed, declared ids only is accepted', () => {
    fc.assert(fc.property(fc.uniqueArray(cid, { minLength: 1, maxLength: 5 }), fc.array(fc.nat(), { maxLength: 4 }), (ids, picks) => {
      const text = `Claim text ${picks.map((p) => `[[${ids[p % ids.length]}]]`).join(' ')}`;
      const res = validateResponse({
        version: '1.0', status: 'ok', answer: { text, format: 'markdown' },
        citations: ids.map((id) => ({ id, type: 'reference', label: 'l' })),
      }, new Set(ids));
      expect(res.ok).toBe(true);
    }), { numRuns: 500 });
  });

  it('status ok without citations is always rejected', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 50 }), fc.constantFrom(undefined, []), (text, cites) => {
      const res = validateResponse({ version: '1.0', status: 'ok', answer: { text, format: 'plain' }, citations: cites });
      expect(res.ok).toBe(false);
    }), { numRuns: 300 });
  });

  it('a marker with no matching citation is always rejected', () => {
    fc.assert(fc.property(fc.uniqueArray(cid, { minLength: 2, maxLength: 5 }), (ids) => {
      const [stray, ...declared] = ids;
      const res = validateResponse({
        version: '1.0', status: 'ok', answer: { text: `claim [[${stray}]]`, format: 'plain' },
        citations: declared.map((id) => ({ id, type: 'derived', label: 'l' })),
      });
      expect(res.ok).toBe(false);
    }), { numRuns: 300 });
  });

  it('citations outside the request context are rejected even when the answer is consistent', () => {
    fc.assert(fc.property(fc.uniqueArray(cid, { minLength: 2, maxLength: 5 }), (ids) => {
      const [outside, ...inside] = ids;
      const res = validateResponse({
        version: '1.0', status: 'ok', answer: { text: `claim [[${outside}]]`, format: 'plain' },
        citations: [{ id: outside, type: 'derived', label: 'l' }],
      }, new Set(inside));
      expect(res.ok).toBe(false);
    }), { numRuns: 300 });
  });
});

describe('validateResponse fuzz', () => {
  it('never throws and returns a well-formed result for arbitrary JSON', () => {
    fc.assert(fc.property(fc.oneof(fc.jsonValue({ maxDepth: 5 }), fc.anything()), (raw) => {
      const res = validateResponse(raw, new Set(['a']));
      expect(typeof res.ok).toBe('boolean');
      if (!res.ok) expect(res.errors.every((e) => typeof e === 'string')).toBe(true);
    }), { numRuns: 1500 });
  });

  it('mutating a valid response (random field replaced by junk) never throws; an ok result still satisfies the citation contract', () => {
    const base = () => ({
      version: '1.0', status: 'ok', answer: { text: 'x [[a]]', format: 'plain' },
      citations: [{ id: 'a', type: 'derived', label: 'l', url: 'https://x.y' }], confidence: 0.5, limitations: ['l'],
    }) as Record<string, any>;
    fc.assert(fc.property(fc.constantFrom('version', 'status', 'answer', 'citations', 'confidence', 'limitations', 'error', 'extra'), fc.oneof(fc.anything(), fc.constant(undefined)), (key, val) => {
      const raw = base();
      raw[key] = val;
      const res = validateResponse(raw, new Set(['a']));
      if (res.ok && res.value.status === 'ok') {
        expect(res.value.citations?.length ?? 0).toBeGreaterThan(0);
        for (const m of String(res.value.answer?.text ?? '').matchAll(MARKER)) expect(res.value.citations!.some((c) => c.id === m[1])).toBe(true);
      }
    }), { numRuns: 1500 });
  });

  it('prototype-pollution style keys and ids are handled', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const res = validateResponse({
        version: '1.0', status: 'ok', answer: { text: `t [[${id}]]`, format: 'plain' },
        citations: [{ id: 'zzz', type: 'derived', label: 'l' }],
      }, new Set(['zzz']));
      expect(res.ok).toBe(false);
    }
    const res = JSON.parse('{"version":"1.0","status":"ok","__proto__":{"x":1},"answer":{"text":"t [[a]]","format":"plain"},"citations":[{"id":"a","type":"derived","label":"l"}]}');
    expect(validateResponse(res, new Set(['a'])).ok).toBe(false); // unknown property
  });

  it('isSafeHttpUrl only accepts http(s) and never throws', () => {
    fc.assert(fc.property(fc.anything(), (u) => {
      const r = isSafeHttpUrl(u);
      if (r) expect(/^https?:\/\//i.test(u as string)).toBe(true);
    }), { numRuns: 500 });
    fc.assert(fc.property(fc.constantFrom('javascript:', 'data:', 'file:', 'ftp:', 'vbscript:'), fc.string({ maxLength: 20 }), (scheme, rest) => {
      expect(isSafeHttpUrl(`${scheme}${rest}`)).toBe(false);
    }), { numRuns: 200 });
    fc.assert(fc.property(fc.webUrl(), (u) => { expect(isSafeHttpUrl(u)).toBe(true); }), { numRuns: 200 });
  });
});
