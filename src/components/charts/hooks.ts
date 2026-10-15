import { useCallback, useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';

export interface TipState {
  x: number;
  y: number;
  /** plot width, for clamping */
  w: number;
  content: ReactNode;
}

/**
 * One tooltip per plot. `bind(content)` returns pointer + focus handlers for a mark, so hover and keyboard
 * focus show the same readout. Coordinates are relative to the element holding `ref`.
 */
export function useTip<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const showAt = useCallback((clientX: number, clientY: number, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: clientX - box.left, y: clientY - box.top, w: box.width, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const bind = useCallback(
    (content: ReactNode) => ({
      onPointerMove: (e: PointerEvent) => showAt(e.clientX, e.clientY, content),
      onPointerLeave: hide,
      onFocus: (e: FocusEvent) => {
        const r = (e.currentTarget as Element).getBoundingClientRect();
        showAt(r.left + r.width / 2, r.top, content);
      },
      onBlur: hide,
    }),
    [showAt, hide],
  );
  return { ref, tip, bind, showAt, hide };
}

/** Width of an element, kept current with ResizeObserver (for SVG charts that draw in pixels). */
export function useWidth<T extends HTMLElement = HTMLDivElement>(initial = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || initial);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return { ref, width };
}
