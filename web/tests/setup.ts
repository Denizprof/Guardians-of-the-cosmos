import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Run every test in a far-west timezone: the app promises UTC dates, so any
// accidental use of local-time getters shows up as an off-by-one-day failure.
process.env.TZ = 'America/Los_Angeles';

// jsdom has no ResizeObserver (Timeline uses it).
class RO {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width: 600, height: 72 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = RO; // plain assignment: survives vi.unstubAllGlobals()

afterEach(() => cleanup());
