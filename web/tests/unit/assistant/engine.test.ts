// The on-device model control (assistant/local/engine.ts): nothing loads before load() is called, progress and
// failures are reported as states, and a failed load can be retried. The worker is replaced by a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../../src/assistant/local/engine';
import type { WorkerIn, WorkerOut } from '../../../src/assistant/local/worker';

class FakeWorker {
  sent: WorkerIn[] = [];
  onmessage: ((e: MessageEvent<WorkerOut>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(m: WorkerIn) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  reply(m: WorkerOut) { this.onmessage?.({ data: m } as MessageEvent<WorkerOut>); }
}

const CFG = { model: 'someone/model-onnx', dtype: 'q4', size: 'about 1.7 GB' };
const setGpu = (on: boolean) => {
  if (on) Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
  else delete (navigator as unknown as { gpu?: unknown }).gpu;
};

describe('createEngine', () => {
  let workers: FakeWorker[];
  const make = () => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker; };
  beforeEach(() => { workers = []; setGpu(true); });
  afterEach(() => { setGpu(false); vi.restoreAllMocks(); });

  it('without WebGPU it says so, and never starts a worker', async () => {
    setGpu(false);
    const engine = createEngine(CFG, make);
    expect(engine.control.state().phase).toBe('unsupported');
    await expect(engine.control.load()).rejects.toThrow(/WebGPU/);
    expect(workers).toHaveLength(0);
  });

  it('starts nothing until load() is called', () => {
    const engine = createEngine(CFG, make);
    expect(engine.control.state().phase).toBe('idle');
    expect(engine.control.size).toBe('about 1.7 GB');
    expect(workers).toHaveLength(0);
  });

  it('load(): reports progress, then ready; listeners are told of every change', async () => {
    const engine = createEngine(CFG, make);
    const seen: string[] = [];
    engine.control.subscribe(() => seen.push(engine.control.state().phase));
    const loading = engine.control.load();
    expect(workers[0].sent[0]).toEqual({ type: 'load', model: 'someone/model-onnx', dtype: 'q4' });
    workers[0].reply({ type: 'progress', progress: 0.4, detail: '680 of 1700 MB' });
    expect(engine.control.state()).toMatchObject({ phase: 'loading', progress: 0.4, detail: '680 of 1700 MB' });
    workers[0].reply({ type: 'ready' });
    await loading;
    expect(engine.control.state().phase).toBe('ready');
    expect(seen).toEqual(['loading', 'loading', 'ready']);
  });

  it('a model given as a path is resolved against the page, not the worker script', () => {
    const engine = createEngine({ ...CFG, model: './models/my-model' }, make);
    void engine.control.load();
    const sent = workers[0].sent[0] as Extract<WorkerIn, { type: 'load' }>;
    expect(sent.model).toBe(new URL('./models/my-model', document.baseURI).href);
  });

  it('calling load() twice starts one worker', () => {
    const engine = createEngine(CFG, make);
    void engine.control.load();
    void engine.control.load();
    expect(workers).toHaveLength(1);
  });

  it('a failed load is reported with its reason and can be retried', async () => {
    const engine = createEngine(CFG, make);
    const first = engine.control.load();
    workers[0].reply({ type: 'load-error', message: 'out of memory' });
    await expect(first).rejects.toThrow('out of memory');
    expect(engine.control.state()).toMatchObject({ phase: 'error', detail: 'out of memory' });
    expect(workers[0].terminated).toBe(true);
    const second = engine.control.load();
    workers[1].reply({ type: 'ready' });
    await second;
    expect(engine.control.state().phase).toBe('ready');
  });

  it('generate(): refuses before the model is ready; resolves with the worker text; rejects on a worker error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createEngine(CFG, make);
    await expect(engine.generate([{ role: 'user', content: 'q' }])).rejects.toThrow(/not loaded/);
    const loading = engine.control.load();
    workers[0].reply({ type: 'ready' });
    await loading;

    const a = engine.generate([{ role: 'user', content: 'q' }]);
    const sentA = workers[0].sent.at(-1) as Extract<WorkerIn, { type: 'generate' }>;
    expect(sentA).toMatchObject({ type: 'generate', messages: [{ role: 'user', content: 'q' }] });
    workers[0].reply({ type: 'result', id: sentA.id, text: 'A. [[kb:a]]' });
    await expect(a).resolves.toBe('A. [[kb:a]]');

    const b = engine.generate([{ role: 'user', content: 'q2' }]);
    const sentB = workers[0].sent.at(-1) as Extract<WorkerIn, { type: 'generate' }>;
    workers[0].reply({ type: 'error', id: sentB.id, message: 'device lost' });
    await expect(b).rejects.toThrow('device lost');
  });

  it('aborting a question tells the worker to stop and rejects with AbortError', async () => {
    const engine = createEngine(CFG, make);
    const loading = engine.control.load();
    workers[0].reply({ type: 'ready' });
    await loading;
    const ac = new AbortController();
    const p = engine.generate([{ role: 'user', content: 'q' }], ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].sent.at(-1)).toMatchObject({ type: 'abort' });
  });
});
