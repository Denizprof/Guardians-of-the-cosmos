// The optional on-device model behind the chat (see adapter.ts for how its output is checked).
// Nothing is downloaded until load() is called from a visitor's click.
import type { ModelControl, ModelState } from '../adapter';
import type { Engine } from './adapter';
import type { ChatMessage } from './core';
import type { WorkerIn, WorkerOut } from './worker';

export interface EngineConfig {
  /** Hugging Face repository with ONNX weights, e.g. "onnx-community/Qwen3-1.7B-ONNX". */
  model: string;
  /** Weight format in that repository. q4 = 4-bit weights with 32-bit arithmetic (assistant-model/export_onnx.py says why not q4f16). */
  dtype: string;
  /** Shown before the download starts. */
  size: string;
}

const hasWebGpu = () => typeof navigator !== 'undefined' && 'gpu' in navigator;

export function createEngine(cfg: EngineConfig, makeWorker: () => Worker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })): Engine {
  let state: ModelState = hasWebGpu() ? { phase: 'idle' } : { phase: 'unsupported', detail: 'This browser has no WebGPU, which the AI model needs.' };
  const listeners = new Set<() => void>();
  const set = (s: ModelState) => { state = s; listeners.forEach((l) => l()); };
  let worker: Worker | null = null;
  let loading: Promise<void> | null = null;
  let nextId = 0;
  const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  const send = (m: WorkerIn) => worker?.postMessage(m);

  const control: ModelControl = {
    size: cfg.size,
    state: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load() {
      if (state.phase === 'unsupported') return Promise.reject(new Error(state.detail));
      if (loading) return loading;
      loading = new Promise<void>((resolve, reject) => {
        set({ phase: 'loading', progress: 0 });
        try { worker = makeWorker(); } catch (e) { loading = null; set({ phase: 'error', detail: 'The model could not be started in this browser.' }); return reject(e as Error); }
        // Handlers belong to this worker only: a late message from a worker that was already replaced is ignored.
        const w = worker;
        w.onmessage = (ev: MessageEvent<WorkerOut>) => {
          if (w !== worker) return;
          const m = ev.data;
          if (m.type === 'progress') set({ phase: 'loading', progress: m.progress, detail: m.detail });
          else if (m.type === 'ready') { set({ phase: 'ready' }); resolve(); }
          else if (m.type === 'load-error') { loading = null; worker?.terminate(); worker = null; set({ phase: 'error', detail: m.message.slice(0, 300) }); reject(new Error(m.message)); }
          else if (m.type === 'result') { pending.get(m.id)?.resolve(m.text); pending.delete(m.id); }
          else if (m.type === 'error') {
            // the chat falls back to the knowledge base; the reason must still be findable
            console.warn(`[assistant] the AI model failed to answer: ${m.message}`);
            pending.get(m.id)?.reject(new Error(m.message));
            pending.delete(m.id);
          }
        };
        w.onerror = (ev) => {
          if (w !== worker) return;
          const err = new Error(ev.message || 'model worker failed');
          pending.forEach((p) => p.reject(err));
          pending.clear();
          loading = null;
          // An uncaught error does not stop a worker: stop it, or a retry would load a second copy of the model next to it.
          w.terminate();
          worker = null;
          set({ phase: 'error', detail: err.message.slice(0, 300) });
          reject(err);
        };
        // A path ("./models/x", "/models/x") means a folder of this site: resolve it against the page, not the worker script.
        const isPath = cfg.model.startsWith('/') || cfg.model.startsWith('./');
        send({ type: 'load', model: isPath ? new URL(cfg.model, document.baseURI).href : cfg.model, dtype: cfg.dtype });
      });
      return loading;
    },
  };

  return {
    control,
    generate(messages: ChatMessage[], signal?: AbortSignal) {
      if (state.phase !== 'ready' || !worker) return Promise.reject(new Error('model not loaded'));
      const id = ++nextId;
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        signal?.addEventListener('abort', () => {
          send({ type: 'abort', id });
          pending.delete(id);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
        send({ type: 'generate', id, messages, maxNewTokens: 320 });
      });
    },
  };
}
