import { safeHref } from '../lib';

/** Colour legend of a satellite layer, taken from the provider's official colormap or documentation. */
export interface LayerLegendData {
  type: 'ramp' | 'classes' | 'composite' | 'unverified';
  units?: string;
  /** ramp: low to high */
  stops?: { color: string; label: string }[];
  /** classes / composite: one entry per colour */
  classes?: { color: string; label: string }[];
  simple: string;
  scientific: string;
  source: { label: string; url: string };
  verified: boolean;
  note?: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const okColor = (c: unknown): c is string => typeof c === 'string' && HEX.test(c);

/** Only well-formed entries are drawn: a malformed colour must never be shown as if it were a real class. */
export function cleanLegend(l: unknown): LayerLegendData | null {
  if (!l || typeof l !== 'object') return null;
  const g = l as Partial<LayerLegendData>;
  if (typeof g.simple !== 'string' || typeof g.scientific !== 'string' || !g.source || typeof g.source.label !== 'string') return null;
  const entries = (a: unknown) =>
    Array.isArray(a) ? a.filter((e): e is { color: string; label: string } => !!e && okColor(e.color) && typeof e.label === 'string') : [];
  const stops = entries(g.stops);
  const classes = entries(g.classes);
  let type: LayerLegendData['type'] = g.type === 'ramp' || g.type === 'classes' || g.type === 'composite' ? g.type : 'unverified';
  if (type === 'ramp' && stops.length < 2) type = 'unverified';
  // a 'composite' may have no entries at all (natural-colour imagery: the picture is the information)
  if (type === 'classes' && classes.length === 0) type = 'unverified';
  return {
    type,
    units: typeof g.units === 'string' ? g.units : undefined,
    stops,
    classes,
    simple: g.simple,
    scientific: g.scientific,
    source: { label: g.source.label, url: typeof g.source.url === 'string' ? g.source.url : '' },
    verified: g.verified === true && type !== 'unverified',
    note: typeof g.note === 'string' ? g.note : undefined,
  };
}

export default function LayerLegend({ legend, level, title }: { legend: unknown; level: 'simple' | 'scientific'; title: string }) {
  const g = cleanLegend(legend);
  if (!g) {
    return (
      <div className="layer-legend" role="group" aria-label={`Colour legend: ${title}`}>
        <p className="muted">No colour legend is available for this layer.</p>
      </div>
    );
  }
  const href = safeHref(g.source.url);
  return (
    <div className="layer-legend" role="group" aria-label={`Colour legend: ${title}`}>
      <div className="legend-title">
        What the colours mean
        {!g.verified && <span className="legend-flag">not officially documented</span>}
      </div>
      {g.type === 'ramp' && (
        <>
          <div className="legend-ramp" aria-hidden="true" style={{ background: `linear-gradient(90deg, ${g.stops!.map((s) => s.color).join(', ')})` }} />
          <ol className="legend-stops">
            {g.stops!.map((s, i) => (
              <li key={`${s.color}-${i}`}>
                <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ol>
        </>
      )}
      {(g.type === 'classes' || g.type === 'composite') && g.classes!.length > 0 && (
        <ul className="legend-classes">
          {g.classes!.map((c, i) => (
            <li key={`${c.color}-${i}`}>
              <span className="swatch" style={{ background: c.color }} aria-hidden="true" />
              {c.label}
            </li>
          ))}
        </ul>
      )}
      <p>{level === 'scientific' ? g.scientific : g.simple}</p>
      {g.note && <p className="muted">{g.note}</p>}
      <p className="faint">
        Source:{' '}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">{g.source.label}</a>
        ) : (
          g.source.label
        )}
      </p>
    </div>
  );
}
