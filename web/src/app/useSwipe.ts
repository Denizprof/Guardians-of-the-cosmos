import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

export const PANEL_W = 424; // side panel width + gutters (see --panel-w in styles.css)

// ---- swipe divider. Its position is a CSS variable on .app (read by the map clip, the handle and the
// BEFORE/AFTER tags), written from a ref inside requestAnimationFrame: dragging re-renders nothing in React.
// The committed value (pointer up, arrow keys) only feeds aria-valuenow.
export function useSwipe(appRef: RefObject<HTMLDivElement | null>, isMobile: boolean, selectedId: string | null) {
  const freeWidth = useCallback(() => window.innerWidth - (isMobile ? 0 : PANEL_W), [isMobile]);
  const swipeX = useRef(Math.round((window.innerWidth - (window.innerWidth <= 820 ? 0 : PANEL_W)) / 2));
  const swipeRaf = useRef(0);
  const swipeDragging = useRef(false);
  const handleRef = useRef<HTMLDivElement>(null);
  const pct = useCallback((x: number) => Math.max(0, Math.min(100, Math.round((x / freeWidth()) * 100))), [freeWidth]);
  const [swipePct, setSwipePct] = useState(() => pct(swipeX.current));
  const paintSwipe = useCallback(() => {
    swipeRaf.current = 0;
    appRef.current?.style.setProperty('--swipe-x', `${swipeX.current}px`);
    handleRef.current?.setAttribute('aria-valuenow', String(pct(swipeX.current)));
  }, [appRef, pct]);
  const moveSwipe = useCallback(
    (x: number, commit: boolean) => {
      // clamp to the visible map (not the window): past freeWidth the handle hides under the side panel
      swipeX.current = Math.max(0, Math.min(freeWidth(), Math.round(x)));
      if (!swipeRaf.current) swipeRaf.current = requestAnimationFrame(paintSwipe);
      if (commit) setSwipePct(pct(swipeX.current));
    },
    [paintSwipe, pct, freeWidth]
  );
  useLayoutEffect(() => {
    // (re)centre in the free part of the map whenever an investigation opens or the layout flips
    if (!selectedId) return;
    swipeX.current = Math.round(freeWidth() / 2);
    paintSwipe();
    setSwipePct(pct(swipeX.current));
  }, [selectedId, freeWidth, paintSwipe, pct]);
  useEffect(() => {
    // a narrower window or a rotated phone must not leave the divider under the side panel or off-screen
    if (!selectedId) return;
    const onResize = () => moveSwipe(swipeX.current, true);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [selectedId, moveSwipe]);
  useEffect(() => () => cancelAnimationFrame(swipeRaf.current), []);
  const onSwipeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    swipeDragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onSwipeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (swipeDragging.current) moveSwipe(e.clientX, false);
  };
  const onSwipeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!swipeDragging.current) return;
    swipeDragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    moveSwipe(swipeX.current, true);
  };

  return { freeWidth, swipeX, handleRef, swipePct, moveSwipe, onSwipeDown, onSwipeMove, onSwipeUp };
}
