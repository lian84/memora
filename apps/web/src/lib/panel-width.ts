import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export const PANEL_MIN_WIDTH = 240;
export const PANEL_DEFAULT_WIDTH = 278;
export const PANEL_EXPANDED_WIDTH = 620;
export const PANEL_WIDTH_KEY = 'memora-panel-width';

export function clampPanelWidth(width: number, viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth): number {
  const max = Math.max(PANEL_MIN_WIDTH, Math.min(900, viewportWidth - 360));
  return Math.round(Math.min(max, Math.max(PANEL_MIN_WIDTH, width)));
}

function readStoredWidth(defaultWidth: number): number {
  if (typeof window === 'undefined') return defaultWidth;
  const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
  return Number.isFinite(stored) && stored > 0 ? clampPanelWidth(stored) : defaultWidth;
}

export function usePanelWidth(defaultWidth = PANEL_DEFAULT_WIDTH) {
  const [width, setWidthState] = useState(() => clampPanelWidth(readStoredWidth(defaultWidth)));
  const widthRef = useRef(width);

  const setWidth = useCallback((next: number | ((current: number) => number)) => {
    setWidthState(current => {
      const value = clampPanelWidth(typeof next === 'function' ? next(current) : next);
      widthRef.current = value;
      try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(value)); } catch { /* storage may be unavailable */ }
      return value;
    });
  }, []);

  useEffect(() => {
    const onResize = () => setWidth(current => current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setWidth]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const onMove = (moveEvent: PointerEvent) => {
      setWidth(startWidth + startX - moveEvent.clientX);
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.classList.remove('is-resizing-panel');
    };
    document.body.classList.add('is-resizing-panel');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, [setWidth]);

  return { width, setWidth, startResize };
}
