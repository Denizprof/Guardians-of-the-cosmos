// The swipe divider must stay on the visible map when the window is resized or a phone is rotated.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANEL_W, useSwipe } from '../../src/app/useSwipe';

const realWidth = window.innerWidth;
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
const resizeTo = (w: number) => act(() => { setWidth(w); window.dispatchEvent(new Event('resize')); });

describe('useSwipe on resize', () => {
  let app: HTMLDivElement;
  let appRef: { current: HTMLDivElement }; // one stable ref, as in App
  const swipeX = () => parseFloat(app.style.getPropertyValue('--swipe-x'));

  beforeEach(() => {
    app = document.createElement('div');
    appRef = { current: app };
    // paint at once; 0 is returned so the hook's "a frame is pending" flag stays clear
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  });
  afterEach(() => { vi.unstubAllGlobals(); setWidth(realWidth); });

  it('desktop: narrowing the window pulls the divider back out from under the side panel', () => {
    setWidth(1920);
    const { result } = renderHook(() => useSwipe(appRef, false, 'some-event'));
    expect(swipeX()).toBe((1920 - PANEL_W) / 2);
    resizeTo(1000);
    expect(swipeX()).toBeLessThanOrEqual(1000 - PANEL_W);
    expect(result.current.swipePct).toBeLessThanOrEqual(100);
  });

  it('phone: rotating from landscape to portrait keeps the divider on screen', () => {
    setWidth(780);
    renderHook(() => useSwipe(appRef, true, 'some-event'));
    expect(swipeX()).toBe(390);
    resizeTo(360);
    expect(swipeX()).toBeLessThanOrEqual(360);
  });

  it('a divider that still fits is left where it is', () => {
    setWidth(1920);
    renderHook(() => useSwipe(appRef, false, 'some-event'));
    resizeTo(1800);
    expect(swipeX()).toBe(748);
  });

  it('does nothing while no investigation is open', () => {
    setWidth(1920);
    renderHook(() => useSwipe(appRef, false, null));
    resizeTo(1000);
    expect(app.style.getPropertyValue('--swipe-x')).toBe('');
  });
});
