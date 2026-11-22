import type { ChoiceSpec, ParamSpec, ValidationIssue } from './types';

/** Read numeric params and choices against their specs. Missing values take the default; bad ones are reported. */
export function readParams(
  raw: Record<string, unknown>,
  params: readonly ParamSpec[],
  choices: readonly ChoiceSpec[],
): { values: Record<string, number>; picks: Record<string, string>; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const values: Record<string, number> = {};
  const picks: Record<string, string> = {};
  for (const p of params) {
    const v = raw[p.key];
    const n = v === undefined || v === '' ? p.default : typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) issues.push({ field: p.key, message: `${p.label} must be a number.` });
    else if (n < p.min || n > p.max) issues.push({ field: p.key, message: `${p.label} must be between ${p.min} and ${p.max} ${p.unit}.` });
    else values[p.key] = n;
  }
  for (const c of choices) {
    const v = raw[c.key] === undefined ? c.default : String(raw[c.key]);
    if (!c.options.some((o) => o.value === v)) issues.push({ field: c.key, message: `${c.label} must be one of ${c.options.map((o) => o.value).join(', ')}.` });
    else picks[c.key] = v;
  }
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) issues.push({ field: 'lat', message: 'Latitude must be between -90 and 90.' });
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) issues.push({ field: 'lon', message: 'Longitude must be between -180 and 180.' });
  return { values, picks, issues };
}

/** Find r where f(r) crosses `target` on [lo, hi] for a function decreasing in r. Returns null when outside. */
export function solveDecreasing(f: (r: number) => number, target: number, lo: number, hi: number): number | null {
  if (f(lo) < target) return null;
  if (f(hi) >= target) return hi;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 100; i++) {
    const m = Math.sqrt(a * b); // geometric bisection: the range spans many orders of magnitude
    if (f(m) >= target) a = m;
    else b = m;
    if (b / a < 1 + 1e-6) break;
  }
  return a;
}

export function fmt(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e6 || a < 1e-3) return n.toExponential(digits - 1).replace('e+', 'e');
  return Number(n.toPrecision(digits)).toLocaleString('en-US');
}
