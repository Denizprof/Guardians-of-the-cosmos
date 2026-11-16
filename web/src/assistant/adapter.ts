// The only seam between the UI and "an assistant". The UI depends on AssistantAdapter;
// which backend sits behind it is a deployment decision (VITE_ASSISTANT_GATEWAY_URL).
import { CONTRACT_VERSION, type AssistantRequest, type AssistantResponse, type Health } from './types';
import { collectCitationIds } from './context';
import { validateResponse } from './validate';

/** State of the optional on-device language model (assistant/local/engine.ts). */
export interface ModelState {
  /** unsupported = this browser cannot run it; idle = can be loaded on request. */
  phase: 'unsupported' | 'idle' | 'loading' | 'ready' | 'error';
  /** 0..1 while loading. */
  progress?: number;
  detail?: string;
}
export interface ModelControl {
  /** Human-readable download size, e.g. "about 1.1 GB". */
  size: string;
  state(): ModelState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
}

export interface AssistantAdapter {
  /** The optional language model that words answers, when the build offers one. */
  readonly model?: ModelControl;
  /** Add what the adapter knows to the request (knowledge records for this question) before it is sent. */
  prepare?(req: AssistantRequest): Promise<AssistantRequest>;
  health(): Promise<Health>;
  /** Resolves with an AssistantResponse (status ok/error/unavailable). Rejects only on abort. */
  query(req: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse>;
}

const errResp = (status: 'error' | 'unavailable', code: string, message: string): AssistantResponse => ({ version: CONTRACT_VERSION, status, error: { code, message } });
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** Used when no gateway is configured. Never produces an answer. */
export class UnavailableAdapter implements AssistantAdapter {
  constructor(private reason = 'VITE_ASSISTANT_GATEWAY_URL is not set.') {}
  async health(): Promise<Health> {
    return { status: 'unavailable', model_configured: false, detail: this.reason };
  }
  async query(): Promise<AssistantResponse> {
    return errResp('unavailable', 'not_configured', `Assistant not connected. ${this.reason}`);
  }
}

export class HttpAssistantAdapter implements AssistantAdapter {
  private base: string;
  constructor(gatewayUrl: string, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    // "/" or "" means same origin (use with the Vite dev proxy); otherwise an absolute URL.
    this.base = gatewayUrl.trim().replace(/\/+$/, '');
  }

  async health(): Promise<Health> {
    try {
      const res = await this.fetchImpl(`${this.base}/api/assistant/health`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return { status: 'error', model_configured: false, detail: `Gateway returned HTTP ${res.status}.` };
      const j = await res.json();
      if (!j || typeof j !== 'object' || typeof j.model_configured !== 'boolean') return { status: 'error', model_configured: false, detail: 'Unexpected health response.' };
      const ok = j.status === 'ok' && j.model_configured === true;
      return { status: ok ? 'ok' : 'unavailable', model_configured: j.model_configured, contract_version: typeof j.contract_version === 'string' ? j.contract_version : undefined };
    } catch {
      return { status: 'error', model_configured: false, detail: 'Gateway is not reachable.' };
    }
  }

  async query(req: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/api/assistant/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req),
        signal,
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      return errResp('error', 'network_error', 'Could not reach the assistant gateway.');
    }
    let json: unknown;
    try { json = await res.json(); } catch { return errResp('error', 'bad_gateway_response', `Gateway returned a non-JSON response (HTTP ${res.status}).`); }
    const checked = validateResponse(json, collectCitationIds(req.context));
    if (checked.ok) return checked.value;
    // Gateway-level errors (503/429/4xx/5xx) carry a contract-shaped error body; show their message only.
    const j = json as { status?: unknown; error?: { code?: unknown; message?: unknown } } | null;
    if (!res.ok && j && typeof j === 'object' && j.error && typeof j.error.code === 'string' && typeof j.error.message === 'string') {
      return errResp(j.status === 'unavailable' ? 'unavailable' : 'error', j.error.code.slice(0, 64), j.error.message.slice(0, 500));
    }
    return errResp('error', 'invalid_response', 'The assistant response did not match the contract and was discarded.');
  }
}

export function createAdapter(env: { VITE_ASSISTANT_GATEWAY_URL?: string } = import.meta.env as { VITE_ASSISTANT_GATEWAY_URL?: string }): AssistantAdapter {
  const url = env.VITE_ASSISTANT_GATEWAY_URL;
  return typeof url === 'string' && url.trim() !== '' ? new HttpAssistantAdapter(url) : new UnavailableAdapter();
}
