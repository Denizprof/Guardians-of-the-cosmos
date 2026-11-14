import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { SarEvent, SarLayer } from '../types';
import type { CoverageResult } from '../services';
import type { AssistantAdapter, ModelControl } from './adapter';
import { defaultAdapter } from './local';
import { buildContext, buildRequest, collectCitationIds, type ContextInput } from './context';
import { isSafeHttpUrl } from './validate';
import type { AssistantContext, AssistantResponse, Citation, ExplanationLevel, Health } from './types';
import './assistant.css';

export interface AssistantPanelProps {
  event: SarEvent | null;
  before?: SarLayer | null;
  after?: SarLayer | null;
  mapView?: ContextInput['mapView'];
  coverage?: CoverageResult | null;
  clickedLocation?: { lon: number; lat: number } | null;
  /** Called when the user activates a citation chip that points at a layer. */
  onSelectLayer?: (layerId: string) => void;
  /** Override for tests or a custom backend. Defaults to the gateway when one is configured, else the in-browser chatbot. */
  adapter?: AssistantAdapter;
  locale?: string;
  /** 'full' = the chat is the whole side panel (taller conversation, no heading of its own). */
  variant?: 'inline' | 'full';
}

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  response?: AssistantResponse;
  context?: AssistantContext;
  failed?: boolean;
  /** The assistant had no source and said so: an honest outcome, not a malfunction. */
  declined?: boolean;
}

type Conn = { state: 'checking' } | { state: 'ready' } | { state: 'disconnected'; health: Health };

const MARKER = /\[\[([A-Za-z0-9._:/#-]{1,200})\]\]/g;
const TYPE_LABEL: Record<Citation['type'], string> = { observation: 'Observation', derived: 'Derived', reference: 'Reference' };

function lookupFor(ctx?: AssistantContext) {
  const layers = new Map<string, string>();
  const urls = new Map<string, string>();
  ctx?.selected_layers?.forEach((l) => layers.set(l.citation_id, l.layer_id));
  ctx?.event?.references?.forEach((r) => urls.set(r.citation_id, r.url));
  ctx?.knowledge?.forEach((k) => urls.set(k.citation_id, k.url));
  return { layers, urls };
}

function CitationChip({ c, n, ctx, onSelectLayer }: { c: Citation; n: number; ctx?: AssistantContext; onSelectLayer?: (id: string) => void }) {
  const { layers, urls } = lookupFor(ctx);
  // Prefer values from the request context we built ourselves over what the model echoed back.
  const layerId = layers.get(c.id);
  const known = urls.get(c.id);
  const url = (isSafeHttpUrl(known) ? known : undefined) ?? (isSafeHttpUrl(c.url) ? c.url : undefined);
  const inner = (
    <>
      <span className="asst-chip-n">{n}</span>
      <span className="asst-chip-type" data-type={c.type}>{TYPE_LABEL[c.type]}</span>
      <span className="asst-chip-label">{c.label}</span>
    </>
  );
  const title = c.granule ? `Granule ${c.granule}` : c.label;
  if (layerId && onSelectLayer) {
    return <button type="button" className="asst-chip" id={`asst-c-${c.id}`} title={`${title}. Show layer on the map`} onClick={() => onSelectLayer(layerId)}>{inner}</button>;
  }
  if (url) {
    return <a className="asst-chip" id={`asst-c-${c.id}`} href={url} target="_blank" rel="noopener noreferrer" title={`${title}. Opens in a new tab`}>{inner}</a>;
  }
  return <span className="asst-chip" id={`asst-c-${c.id}`} title={title}>{inner}</span>;
}

function renderAnswer(text: string, citations: Citation[]): ReactNode {
  const index = new Map(citations.map((c, i) => [c.id, i + 1]));
  return text.split(/\n{2,}/).map((para, pi) => {
    const parts: ReactNode[] = [];
    let last = 0;
    for (const m of para.matchAll(MARKER)) {
      parts.push(para.slice(last, m.index));
      const n = index.get(m[1]);
      if (n) parts.push(<a key={`${pi}-${m.index}`} className="asst-mark" href={`#asst-c-${m[1]}`} aria-label={`Citation ${n}`}>[{n}]</a>);
      last = (m.index ?? 0) + m[0].length;
    }
    parts.push(para.slice(last));
    return <p key={pi}>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</p>;
  });
}

function NotConnected({ health, onRetry, local }: { health: Health; onRetry: () => void; local: boolean }) {
  const gatewayDown = health.status === 'error';
  if (local) {
    // the in-browser chatbot has no gateway: the only thing that can fail is loading its knowledge base
    return (
      <div className="asst-notice" role="status">
        <h4>Assistant unavailable</h4>
        <p>The assistant answers only from its checked knowledge base, and that could not be loaded. It will not answer without it.</p>
        {health.detail && <p className="asst-detail">{health.detail}</p>}
        <button type="button" className="asst-btn" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  return (
    <div className="asst-notice" role="status">
      <h4>Assistant not connected</h4>
      <p>
        {gatewayDown
          ? 'The assistant gateway could not be reached. '
          : 'No AI model is configured for this build, so there is nothing to answer questions yet. '}
        The assistant does not guess or answer from a placeholder; it stays off until it is connected.
      </p>
      {health.detail && <p className="asst-detail">{health.detail}</p>}
      <ol>
        <li>Start the gateway with your model: <code>cd assistant-gateway</code>, set <code>ASSISTANT_MODEL_URL</code>, run <code>npm start</code>.</li>
        <li>Set <code>VITE_ASSISTANT_GATEWAY_URL</code> in <code>web/.env.local</code> (for example <code>/</code> with the Vite proxy, or <code>http://localhost:8787</code>).</li>
        <li>Restart <code>npm run dev</code>.</li>
      </ol>
      <p>Full instructions: <code>docs/assistant-integration.md</code>.</p>
      <button type="button" className="asst-btn" onClick={onRetry}>Check again</button>
    </div>
  );
}

/** How answers are produced right now, and the opt-in download of the on-device model. Nothing is fetched until the button is pressed. */
function ModelBar({ model }: { model: ModelControl }) {
  const state = useSyncExternalStore(model.subscribe, model.state, model.state);
  const pct = Math.round((state.progress ?? 0) * 100);
  return (
    <div className="asst-mode" role="status">
      {state.phase === 'ready' && <p><strong>AI model loaded.</strong> It runs on your device and words its answers only from the cited sources.</p>}
      {state.phase === 'idle' && (
        <>
          <p><strong>Knowledge-base answers.</strong> Each answer is quoted from a checked record. An AI model can word the answers instead: it downloads once ({model.size}, from Hugging Face) and then runs on your device.</p>
          <button type="button" className="asst-btn" onClick={() => { void model.load().catch(() => {}); }}>Load the AI model</button>
        </>
      )}
      {state.phase === 'loading' && (
        <>
          <p><strong>Loading the AI model…</strong> {state.detail ?? ''} You can keep asking in the meantime.</p>
          <progress className="asst-progress" max={100} value={pct} aria-label="AI model download">{pct}%</progress>
        </>
      )}
      {state.phase === 'unsupported' && <p><strong>Knowledge-base answers.</strong> {state.detail} Each answer is quoted from a checked record.</p>}
      {state.phase === 'error' && (
        <>
          <p className="asst-mode-error"><strong>The AI model could not be loaded.</strong> {state.detail} Answers are quoted from the knowledge base.</p>
          <button type="button" className="asst-btn" onClick={() => { void model.load().catch(() => {}); }}>Try again</button>
        </>
      )}
    </div>
  );
}

export function AssistantPanel(props: AssistantPanelProps) {
  const { event, before, after, mapView, coverage, clickedLocation, onSelectLayer, locale, variant = 'inline' } = props;
  const adapter = useMemo(() => props.adapter ?? defaultAdapter(), [props.adapter]);
  const [conn, setConn] = useState<Conn>({ state: 'checking' });
  const [level, setLevel] = useState<ExplanationLevel>('simple');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  const checkHealth = useCallback(() => {
    setConn({ state: 'checking' });
    adapter.health().then((h) => setConn(h.status === 'ok' ? { state: 'ready' } : { state: 'disconnected', health: h }));
  }, [adapter]);
  useEffect(() => { checkHealth(); return () => abortRef.current?.abort(); }, [checkHealth]);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, busy]);

  const context = useMemo(
    () => buildContext({ event, layers: [before, after], mapView, clicked: clickedLocation, coverage }),
    [event, before, after, mapView, clickedLocation, coverage],
  );
  const contextSummary = [
    context.event ? 'event' : null,
    context.selected_layers?.length ? `${context.selected_layers.length} layer${context.selected_layers.length > 1 ? 's' : ''}` : null,
    context.map_view ? 'map view' : null,
    context.clicked_location ? 'clicked point' : null,
    context.coverage ? `${context.coverage.granules.length} coverage granules` : null,
  ].filter(Boolean).join(', ');
  const suggestions = event
    ? ['What am I looking at?', 'What does the radar show here?', 'How reliable is this analysis?']
    : ['What is SAR?', 'What can I do in this app?', 'Can radar predict earthquakes?'];

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy || conn.state !== 'ready') return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const history = msgs.filter((m) => !m.failed && !m.declined).map((m) => ({ role: m.role, content: m.text }));
    const base = buildRequest({ query: q, locale: locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en'), level, context, conversation: history });
    setMsgs((m) => [...m, { id: ++idRef.current, role: 'user', text: q }]);
    setDraft('');
    setBusy(true);
    try {
      // the adapter may attach knowledge records for this question; they become citable sources
      const req = adapter.prepare ? await adapter.prepare(base) : base;
      const res = await adapter.query(req, ac.signal);
      const ids = collectCitationIds(req.context);
      const ok = res.status === 'ok' && res.answer && (res.citations ?? []).every((c) => ids.has(c.id));
      const declined = !ok && res.status === 'error' && res.error?.code === 'insufficient_context';
      const text = ok ? res.answer!.text : res.error?.message ?? 'The assistant could not answer.';
      setMsgs((m) => [...m, { id: ++idRef.current, role: 'assistant', text, response: res, context: req.context, failed: !ok && !declined, declined }]);
      if (res.status === 'unavailable') checkHealth();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setMsgs((m) => [...m, { id: ++idRef.current, role: 'assistant', text: 'Request failed unexpectedly.', failed: true }]);
      }
    } finally {
      if (abortRef.current === ac) setBusy(false);
    }
  };
  const send = (e?: FormEvent) => { e?.preventDefault(); void ask(draft); };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(draft); }
  };

  const disabled = conn.state !== 'ready';

  return (
    <section className={`asst${variant === 'full' ? ' asst-full' : ''}`} aria-labelledby={`${uid}-h`}>
      <header className="asst-head">
        <h3 id={`${uid}-h`} className={variant === 'full' ? 'asst-sr' : undefined}>Assistant</h3>
        <div className="asst-level" role="group" aria-label="Explanation level">
          {(['simple', 'scientific'] as const).map((l) => (
            <button key={l} type="button" className="asst-seg" aria-pressed={level === l} onClick={() => setLevel(l)}>
              {l === 'simple' ? 'Simple' : 'Scientific'}
            </button>
          ))}
        </div>
      </header>

      {conn.state === 'checking' && <p className="asst-muted" role="status">Checking assistant connection…</p>}
      {conn.state === 'disconnected' && <NotConnected health={conn.health} onRetry={checkHealth} local={typeof adapter.prepare === 'function'} />}

      {conn.state === 'ready' && (
        <>
          {adapter.model && <ModelBar model={adapter.model} />}
          <div className="asst-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions" aria-busy={busy} tabIndex={0} aria-label="Conversation">
            {msgs.length === 0 && (
              <>
                <p className="asst-muted">Ask about radar, NISAR, this app or what you are looking at. Every answer cites its sources; when there is no source, you get no answer rather than a guess.</p>
                <ul className="asst-suggest" aria-label="Example questions">
                  {suggestions.map((s) => (
                    <li key={s}><button type="button" className="asst-btn" onClick={() => { void ask(s); }}>{s}</button></li>
                  ))}
                </ul>
              </>
            )}
            {msgs.map((m) => (
              <article key={m.id} className={`asst-msg asst-${m.role}${m.failed ? ' asst-failed' : ''}${m.declined ? ' asst-declined' : ''}`}>
                <span className="asst-who">{m.role === 'user' ? 'You' : 'Assistant'}</span>
                {m.role === 'assistant' && !m.failed && !m.declined && m.response?.answer ? (
                  <div className="asst-text">{renderAnswer(m.text, m.response.citations ?? [])}</div>
                ) : (
                  <div className="asst-text" role={m.failed ? 'alert' : undefined}>
                    {m.role === 'user' || m.declined ? m.text : <>{m.response?.status === 'unavailable' ? 'Assistant unavailable: ' : 'Error: '}{m.text}</>}
                  </div>
                )}
                {!m.failed && !m.declined && m.response?.citations && m.response.citations.length > 0 && (
                  <ul className="asst-cites" aria-label="Citations">
                    {m.response.citations.map((c, i) => (
                      <li key={c.id}><CitationChip c={c} n={i + 1} ctx={m.context} onSelectLayer={onSelectLayer} /></li>
                    ))}
                  </ul>
                )}
                {!m.failed && typeof m.response?.confidence === 'number' && (
                  <p className="asst-meta">Model-reported confidence: {Math.round(m.response.confidence * 100)}%. This is the model's own estimate, not a verified measure.</p>
                )}
                {!m.failed && !m.declined && m.response?.limitations && m.response.limitations.length > 0 && (
                  <div className="asst-limits">
                    <strong>Limitations</strong>
                    <ul>{m.response.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  </div>
                )}
              </article>
            ))}
            {busy && <p className="asst-muted" role="status">Thinking…</p>}
          </div>
          <form className="asst-form" onSubmit={send}>
            <label htmlFor={`${uid}-q`} className="asst-sr">Ask the assistant</label>
            <textarea id={`${uid}-q`} rows={2} maxLength={2000} value={draft} placeholder={event ? 'Ask about this scene…' : 'Ask about radar, NISAR or this app…'} disabled={disabled} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
            <button type="submit" className="asst-btn asst-primary" disabled={disabled || busy || !draft.trim()}>Send</button>
          </form>
          <p className="asst-ctx" id={`${uid}-ctx`}>Context sent with each question: {contextSummary || 'none (no event selected)'}.</p>
        </>
      )}
    </section>
  );
}

export default AssistantPanel;
