// Runtime validation of AssistantResponse. The browser never trusts a response: anything
// that breaks the contract (including uncited claims) is rejected, not rendered.
import type { AssistantResponse, Citation } from './types';

export type ValidationResult = { ok: true; value: AssistantResponse } | { ok: false; errors: string[] };

const MARKER = /\[\[([A-Za-z0-9._:/#-]{1,200})\]\]/g;
const ID = /^[A-Za-z0-9._:/#-]{1,200}$/;
const VERSION = /^1\.\d+$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number, min = 0): v is string => typeof v === 'string' && v.length >= min && v.length <= max;

export function isSafeHttpUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return false;
  try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:'; } catch { return false; }
}

function checkKeys(obj: Record<string, unknown>, allowed: string[], path: string, errors: string[]) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${path}${k}: unknown property`);
}

/**
 * @param allowedCitationIds ids present in the request context. When given, every citation
 * must be in it. Pass it always in production; omit only to check shape.
 */
export function validateResponse(raw: unknown, allowedCitationIds?: ReadonlySet<string>): ValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['response: expected object'] };
  checkKeys(raw, ['version', 'status', 'answer', 'citations', 'confidence', 'limitations', 'error'], '', errors);

  if (typeof raw.version !== 'string' || !VERSION.test(raw.version)) errors.push('version: must be 1.x');
  if (raw.status !== 'ok' && raw.status !== 'error' && raw.status !== 'unavailable') errors.push('status: must be ok, error or unavailable');

  let answerText: string | undefined;
  if (raw.answer !== undefined) {
    const a = raw.answer;
    if (!isObj(a)) errors.push('answer: expected object');
    else {
      checkKeys(a, ['text', 'format'], 'answer.', errors);
      if (!isStr(a.text, 20000, 1)) errors.push('answer.text: required string, 1-20000 chars');
      else answerText = a.text;
      if (a.format !== 'markdown' && a.format !== 'plain') errors.push('answer.format: must be markdown or plain');
    }
  }

  const declared = new Set<string>();
  if (raw.citations !== undefined) {
    if (!Array.isArray(raw.citations) || raw.citations.length > 50) errors.push('citations: expected array of at most 50');
    else raw.citations.forEach((c, i) => {
      const p = `citations[${i}]`;
      if (!isObj(c)) return errors.push(`${p}: expected object`);
      checkKeys(c, ['id', 'type', 'label', 'granule', 'url', 'layer_id'], `${p}.`, errors);
      if (typeof c.id !== 'string' || !ID.test(c.id)) errors.push(`${p}.id: invalid`);
      else {
        declared.add(c.id);
        if (allowedCitationIds && !allowedCitationIds.has(c.id)) errors.push(`${p}.id: "${c.id}" is not in the request context`);
      }
      if (c.type !== 'observation' && c.type !== 'derived' && c.type !== 'reference') errors.push(`${p}.type: invalid`);
      if (!isStr(c.label, 400, 1)) errors.push(`${p}.label: required string`);
      if (c.granule !== undefined && !isStr(c.granule, 300)) errors.push(`${p}.granule: invalid`);
      if (c.layer_id !== undefined && !isStr(c.layer_id, 200)) errors.push(`${p}.layer_id: invalid`);
      if (c.url !== undefined && !isSafeHttpUrl(c.url)) errors.push(`${p}.url: must be http(s)`);
    });
  }

  if (raw.confidence !== undefined && !(typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1)) errors.push('confidence: must be 0..1');
  if (raw.limitations !== undefined && !(Array.isArray(raw.limitations) && raw.limitations.length <= 20 && raw.limitations.every((l) => isStr(l, 1000)))) errors.push('limitations: expected array of strings');
  if (raw.error !== undefined) {
    if (!isObj(raw.error) || !isStr(raw.error.code, 64) || !isStr(raw.error.message, 1000)) errors.push('error: expected {code, message}');
  }

  if (raw.status === 'ok') {
    if (raw.answer === undefined) errors.push('answer: required when status is ok');
    if (declared.size === 0) errors.push('citations: at least one required when status is ok (uncited answer rejected)');
  }
  if (raw.status === 'error' && raw.error === undefined) errors.push('error: required when status is error');
  if (answerText) for (const m of answerText.matchAll(MARKER)) if (!declared.has(m[1])) errors.push(`answer.text: marker [[${m[1]}]] has no matching citation`);

  return errors.length ? { ok: false, errors } : { ok: true, value: raw as unknown as AssistantResponse };
}

export type { Citation };
