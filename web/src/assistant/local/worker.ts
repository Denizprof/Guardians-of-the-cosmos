/// <reference lib="webworker" />
// Runs the on-device language model off the main thread, with WebGPU, through transformers.js.
//
// transformers.js is loaded from a pinned CDN build only when a visitor chooses to load the model, so it adds
// nothing to the app bundle and nothing is fetched before that choice. The model files come from the Hugging
// Face repository named by the build (VITE_ASSISTANT_MODEL) and are cached by the browser after the first load.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';

export type WorkerIn =
  | { type: 'load'; model: string; dtype: string }
  | { type: 'generate'; id: number; messages: { role: string; content: string }[]; maxNewTokens: number }
  | { type: 'abort'; id: number };
export type WorkerOut =
  | { type: 'progress'; progress: number; detail: string }
  | { type: 'ready' }
  | { type: 'load-error'; message: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number; message: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
let tokenizer: any = null;
let model: any = null;
let lib: any = null;
const stops = new Map<number, { interrupt(): void }>();
const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

async function load(modelId: string, dtype: string) {
  lib = await import(/* @vite-ignore */ TRANSFORMERS_URL);
  // On a laptop with two GPUs the browser picks the integrated one by default, which is many times slower.
  if (lib.env.backends?.onnx) lib.env.backends.onnx.webgpu = { ...(lib.env.backends.onnx.webgpu ?? {}), powerPreference: 'high-performance' };
  // A path or URL instead of a Hugging Face repository id: load the files from that folder (a model served by
  // the site itself, or a local copy during development) and never contact the Hugging Face hub.
  if (modelId.startsWith('/') || modelId.startsWith('./') || modelId.startsWith('http:') || modelId.startsWith('https:')) {
    const dir = new URL(modelId.endsWith('/') ? modelId.slice(0, -1) : modelId, self.location.href).href;
    const cut = dir.lastIndexOf('/');
    lib.env.allowLocalModels = false;
    lib.env.remoteHost = dir.slice(0, cut + 1); // files are then fetched from <folder's parent>/<folder>/<file>
    lib.env.remotePathTemplate = '{model}/';
    modelId = dir.slice(cut + 1);
  }
  // total progress across files: transformers.js reports each file on its own
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: any) => {
    if (p.status !== 'progress' || !p.file || !p.total) return;
    files.set(p.file, { loaded: p.loaded, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    post({ type: 'progress', progress: total ? loaded / total : 0, detail: `${(loaded / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB` });
  };
  tokenizer = await lib.AutoTokenizer.from_pretrained(modelId, { progress_callback });
  model = await lib.AutoModelForCausalLM.from_pretrained(modelId, { device: 'webgpu', dtype, progress_callback });
}

async function generate(id: number, messages: { role: string; content: string }[], maxNewTokens: number) {
  // enable_thinking: false = answer directly, as the model was fine-tuned (assistant-model/train_lora.py)
  const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, enable_thinking: false });
  const stop = new lib.InterruptableStoppingCriteria();
  stops.set(id, stop);
  try {
    const out = await model.generate({ ...inputs, max_new_tokens: maxNewTokens, do_sample: false, repetition_penalty: 1.05, stopping_criteria: stop });
    const promptLength = inputs.input_ids.dims.at(-1);
    const text = tokenizer.batch_decode(out.slice(null, [promptLength, null]), { skip_special_tokens: true })[0] as string;
    post({ type: 'result', id, text });
  } finally {
    stops.delete(id);
  }
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === 'load') {
    load(m.model, m.dtype).then(() => post({ type: 'ready' }), (err) => post({ type: 'load-error', message: err instanceof Error ? err.message : String(err) }));
  } else if (m.type === 'generate') {
    generate(m.id, m.messages, m.maxNewTokens).catch((err) => post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) }));
  } else if (m.type === 'abort') {
    stops.get(m.id)?.interrupt();
  }
};
