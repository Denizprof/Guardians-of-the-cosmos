// Scientific Results Laboratory: every number of a run, with the working, zones, charts, comparison and sources.
import { memo, useState } from 'react';
import type { Scenario } from '../../sim/store';
import type { SimResult } from '../../sim/types';
import { fmt } from '../../sim/validate';
import { toMarkdown } from '../../sim/explain';
import { SIM_COLORS } from '../../map/markers';
import LineChart from './LineChart';
import { ASH_CLASSES, DEPTH_CLASSES, FIRE_CLASSES, SURFACE_CLASSES } from '../../sim/floodRender';

type Tab = 'summary' | 'working' | 'zones' | 'charts' | 'compare' | 'sources';
const TABS: [Tab, string][] = [['summary', 'Summary'], ['working', 'Working'], ['zones', 'Zones'], ['charts', 'Charts'], ['compare', 'Compare'], ['sources', 'Sources']];

interface Props {
  result: SimResult;
  scenarios: Scenario[];
  activeId: string | null;
  simT: number;
  /** Opens the guide at a topic ("What do these numbers mean?"). */
  onHelp?: (topic: string) => void;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SimResults({ result: r, scenarios, activeId, simT, onHelp }: Props) {
  const [tab, setTab] = useState<Tab>('summary');
  const slug = `${r.engine}-${r.computedAt.slice(0, 19).replace(/[:T]/g, '-')}`;
  return (
    <div className="sim-results">
      <p className="sim-badge" role="note"><b>Hypothetical simulation</b> · model output, not an observation or forecast</p>
      {onHelp && (
        <p className="small">
          <button type="button" className="link" onClick={() => onHelp(r.engine)}>What do the circles, colours and numbers mean?</button>
          {' · '}
          <button type="button" className="link" onClick={() => onHelp('results')}>How to read these tabs</button>
        </p>
      )}
      <div className="seg sim-tabs" role="tablist" aria-label="Results">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" className="sim-tabpanel">
        {tab === 'summary' && (
          <>
            <p>{r.summary}</p>
            <table className="sim-table">
              <tbody>
                {r.outputs.map((o) => (
                  <tr key={o.id}>
                    <th scope="row">{o.label}</th>
                    <td className="mono">{fmt(o.value)} {o.unit}{o.alt ? <span className="muted"> {o.alt}</span> : null}{o.range ? <span className="muted small"> ({fmt(o.range[0])}–{fmt(o.range[1])})</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details className="small"><summary>Inputs</summary>
              <ul>{Object.entries(r.inputs).map(([k, v]) => <li key={k}><span className="mono">{k}</span>: {String(v)}</li>)}</ul>
            </details>
          </>
        )}
        {tab === 'working' && (
          <ol className="sim-steps">
            {r.steps.map((s) => (
              <li key={s.id}>
                <div><b>{s.label}</b></div>
                <div className="mono eq">{s.equation}</div>
                {s.substituted && <div className="mono eq muted">{s.substituted}</div>}
                <div className="mono">= {fmt(s.value, 4)} {s.unit}{s.note ? <span className="muted"> ({s.note})</span> : null}</div>
              </li>
            ))}
          </ol>
        )}
        {tab === 'zones' && (
          <ul className="sim-zones">
            {r.zones.map((z) => (
              <li key={z.id}>
                <span className="swatch" style={{ background: SIM_COLORS[z.severity] }} aria-hidden="true" />
                <b>{z.label}</b>: {fmt(z.radiusKm)} km
                {z.threshold && <div className="muted small">{z.threshold}{z.frontKmS !== null ? ` · front travels at ${fmt(z.frontKmS * 3600)} km/h` : ' · appears at once'}</div>}
              </li>
            ))}
            {!r.zones.length && !r.raster && <li className="muted">No zone exceeds the modelled thresholds.</li>}
            {r.raster && (r.raster.kind === 'sea-surface' ? SURFACE_CLASSES.filter((c) => c.label) : r.raster.kind === 'thickness' ? ASH_CLASSES : r.raster.kind === 'fire' ? FIRE_CLASSES : DEPTH_CLASSES).map((c) => (
              <li key={c.label}><span className="swatch" style={{ background: `rgb(${c.color.join(',')})` }} aria-hidden="true" />{r.raster!.kind === 'sea-surface' ? 'Sea surface' : r.raster!.kind === 'thickness' ? 'Ash thickness' : r.raster!.kind === 'fire' ? 'Fire:' : 'Water depth'} {c.label}</li>
            ))}
            {r.raster && <li className="muted small">The globe shows the grid at the time on the timeline ({r.raster.nx}×{r.raster.ny} cells).</li>}
          </ul>
        )}
        {tab === 'charts' && (
          <>
            {r.series.map((s) => <LineChart key={s.id} series={s} reverseX={s.id === 'entry'} markerX={s.id === 'altitude' || s.id === 'velocity' ? simT : null} />)}
          </>
        )}
        {tab === 'compare' && <Compare scenarios={scenarios} activeId={activeId} />}
        {tab === 'sources' && (
          <>
            <h4>Assumptions</h4>
            <ul className="small">{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            <h4>Limitations</h4>
            <ul className="small">{r.limitations.map((a) => <li key={a}>{a}</li>)}</ul>
            <h4>References</h4>
            <ul className="small">{r.references.map((x) => <li key={x.id}><a href={x.url} target="_blank" rel="noreferrer">{x.label}</a></li>)}</ul>
            <p className="muted small">Engine {r.engine} v{r.engineVersion}, computed {r.computedAt}. The same inputs always give the same outputs.</p>
          </>
        )}
      </div>
      <div className="sim-export">
        <button className="btn" onClick={() => download(`${slug}.md`, toMarkdown(r), 'text/markdown')}>Export report (.md)</button>
        <button className="btn" onClick={() => download(`${slug}.json`, JSON.stringify(r, (_k, v) => (v instanceof Float32Array ? Array.from(v, (x) => Math.round(x * 1000) / 1000) : v)), 'application/json')}>Export data (.json)</button>
      </div>
    </div>
  );
}

const ROWS = ['burned', 'ros', 'flame', 'intensity', 'vei', 'mass', 'ash1mm', 'ash1cm', 'ash10cm', 'pdc', 'uplift', 'first', 'coastamp', 'shoreamp', 'area1m', 'area01', 'area05', 'area15', 'maxdepth', 'peak', 'energy', 'vi', 'burst', 'crater', 'depth', 'blast-20psi', 'blast-5psi', 'blast-1psi', 'thermal-3rd', 'magnitude', 'tsunami-1m', 'mmi0', 'rupture', 'mmi-6'];

function Compare({ scenarios, activeId }: { scenarios: Scenario[]; activeId: string | null }) {
  if (scenarios.length < 2) return <p className="muted">Run at least two scenarios to compare them side by side. Each run is kept as Scenario A, B, C…</p>;
  const rows = ROWS.filter((id) => scenarios.some((s) => s.result.outputs.some((o) => o.id === id)));
  return (
    <div className="sim-compare">
      <table className="sim-table">
        <thead>
          <tr><th />{scenarios.map((s) => <th key={s.id} scope="col" className={s.id === activeId ? 'active' : ''}>{s.name}</th>)}</tr>
        </thead>
        <tbody>
          <tr><th scope="row">Setup</th>{scenarios.map((s) => <td key={s.id} className="small">{s.result.title}</td>)}</tr>
          {rows.map((id) => {
            const label = scenarios.flatMap((s) => s.result.outputs).find((o) => o.id === id)!;
            return (
              <tr key={id}>
                <th scope="row">{label.label} <span className="muted">({label.unit})</span></th>
                {scenarios.map((s) => { const o = s.result.outputs.find((x) => x.id === id); return <td key={s.id} className="mono">{o ? fmt(o.value) : '–'}{o?.range ? <div className="muted small">{fmt(o.range[0])}–{fmt(o.range[1])}</div> : null}</td>; })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Other scenarios are outlined in grey (dotted) on the globe at their own ground zero, on the same map, for a like-for-like comparison.</p>
    </div>
  );
}

export default memo(SimResults);
