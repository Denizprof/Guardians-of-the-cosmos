// Turns computed simulation results into the assistant's answer text and into an exportable report.
// The text only restates numbers the engine computed; nothing is added.
import { fmt, fmtOut } from './validate';
import type { Scenario } from './store';
import type { SimResult } from './types';

const LIMIT = 1950; // the assistant contract caps a knowledge text at 2000 characters

export function explainResult(r: SimResult, defaults: string[] = [], level: 'simple' | 'scientific' = 'simple'): string {
  const where = r.location.label ?? `${r.location.lat.toFixed(2)}°, ${r.location.lon.toFixed(2)}°`;
  const tag = r.evidence === 'projection' ? 'CLIMATE PROJECTION SCENARIO' : 'HYPOTHETICAL SIMULATION';
  const parts: string[] = [`${tag} (${r.engine} engine v${r.engineVersion}) at ${where}. ${r.summary}`];
  const key = r.outputs.slice(0, level === 'simple' ? 5 : 9).map((o) => `${o.label}: ${fmtOut(o)} ${o.unit}${o.alt ? ` (${o.alt})` : ''}${o.range ? ` [range ${fmt(o.range[0])}–${fmt(o.range[1])}]` : ''}`);
  parts.push(`Results: ${key.join('; ')}.`);
  const eqIds = level === 'simple' ? ['mass', 'ke', 'dtc', 'energy', 'mmi', 'momentum', 'continuity', 'balance'] : r.steps.map((s) => s.id);
  const eqs = r.steps.filter((s) => eqIds.includes(s.id)).slice(0, level === 'simple' ? 3 : 6).map((s) => `${s.label}: ${s.equation} → ${fmt(s.value)} ${s.unit}`);
  if (eqs.length) parts.push(`How it was calculated: ${eqs.join('; ')}.`);
  if (defaults.length) parts.push(`Not stated in your question, so engine defaults were used for: ${defaults.join(', ')}. Change them in the Simulation Lab.`);
  parts.push(`Main limitation: ${r.limitations[0]}`);
  return clip(parts.join(' '));
}

export function compareScenarios(list: Scenario[]): string {
  if (list.length < 2) return 'There is only one scenario so far. Run another one in the Simulation Lab (for example with a different speed or size) and ask again to compare them.';
  const ids = ['energy', 'crater', 'burst', 'blast-5psi', 'blast-1psi', 'magnitude', 'mmi-6', 'tsunami-1m', 'area01', 'area05', 'maxdepth'];
  const lines = list.map((s) => {
    const vals = ids.map((id) => s.result.outputs.find((o) => o.id === id)).filter((o) => !!o).map((o) => `${o!.label} ${fmtOut(o!)} ${o!.unit}`);
    return `${s.name} (${s.result.title}): ${vals.join(', ')}.`;
  });
  const energies = list.map((s) => s.result.outputs.find((o) => o.id === 'energy')?.value).filter((v): v is number => v !== undefined);
  const ratio = energies.length >= 2 ? ` The largest scenario releases ${fmt(Math.max(...energies) / Math.min(...energies))}× the energy of the smallest; energy grows with the cube of diameter and the square of speed, while crater size grows only with about energy^0.29, so radii change much less than energy.` : '';
  return clip(`Comparison of ${list.length} hypothetical simulations. ${lines.join(' ')}${ratio}`);
}

function clip(s: string): string {
  return s.length <= LIMIT ? s : `${s.slice(0, LIMIT - 1)}…`;
}

export function toMarkdown(r: SimResult): string {
  const row = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [
    `# ${r.title}`,
    '',
    `> **${r.evidence === 'projection' ? 'Climate projection scenario' : 'Hypothetical simulation'}** (evidence class: ${r.evidence}). Engine \`${r.engine}\` v${r.engineVersion}, computed ${r.computedAt}. Not an observation or a forecast.`,
    '',
    `Location: ${r.location.label ?? ''} (${r.location.lat.toFixed(4)}, ${r.location.lon.toFixed(4)})`,
    '',
    '## Summary', '', r.summary, '',
    '## Inputs', '', row(['Parameter', 'Value']), row(['---', '---']), ...Object.entries(r.inputs).map(([k, v]) => row([k, String(v)])), '',
    '## Calculation steps', '', row(['Step', 'Equation', 'Value', 'Unit']), row(['---', '---', '---', '---']), ...r.steps.map((s) => row([s.label, `\`${s.equation}\``, fmt(s.value, 4), s.unit])), '',
    '## Results', '', row(['Quantity', 'Value', 'Range', 'Unit']), row(['---', '---', '---', '---']), ...r.outputs.map((o) => row([o.label, fmtOut(o), o.range ? `${fmt(o.range[0])}–${fmt(o.range[1])}` : '', o.unit])), '',
    '## Affected zones', '', ...(r.raster ? ['Gridded water depth over time (see the JSON export for the values per cell).'] : []), ...r.zones.map((z) => `- **${z.label}**: radius ${fmt(z.radiusKm)} km${z.threshold ? ` (${z.threshold})` : ''}`), '',
    '## Assumptions', '', ...r.assumptions.map((a) => `- ${a}`), '',
    '## Limitations', '', ...r.limitations.map((a) => `- ${a}`), '',
    '## References', '', ...r.references.map((x) => `- [${x.label}](${x.url})`), '',
  ].join('\n');
}
