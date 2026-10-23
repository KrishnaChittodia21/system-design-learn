// Pointer-event drag (mouse, pen, touch) from a source element onto any element carrying `data-drop="<id>"`.
// A press without movement is a tap (tap a card, then tap a target); a keyboard "click" (Enter / Space)
// is reported as a tap too.
//
// Touch notes (why this is built the way it is):
// - Sources carry `touch-action: none` (challenge.css), so the browser never turns the gesture into a scroll
//   and never fires pointercancel; swipes elsewhere on the page still scroll normally.
// - Moves / ups are tracked on `window` for the gesture's pointerId, not on the source element. Pointer capture
//   is requested but not relied on: on touch the browser first captures the pointer implicitly on the exact
//   child that was hit (a label span), and re-targeting can fire a bubbling `lostpointercapture` that must not
//   end the drag; and if capture fails or the source re-renders, window listeners still see every move and up.
// - A non-passive window `touchmove` listener calls preventDefault while dragging (belt and braces for iOS
//   Safari), and `contextmenu` is suppressed during a gesture so an Android long-press can't cancel it.
// - Auto-scroll near the viewport edges stops short of fixed / sticky bars (the phone tab bar, the header),
//   so targets hidden under them scroll into reach; the drop target under the finger is re-evaluated after
//   every scroll step.
import { useEffect, useRef, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react';

export interface DragOptions {
  /** element whose `data-dragging` attribute is set while a drag is in progress (for target styling) */
  scope: React.RefObject<HTMLElement | null>;
  onDrop: (sourceId: string, targetId: string) => void;
  onTap: (sourceId: string) => void;
  /** follow a ghost copy of the source under the pointer (default true) */
  ghost?: boolean;
  /** pointer position while dragging (viewport coordinates); null when the drag ends */
  onMove?: (sourceId: string, p: { x: number; y: number } | null) => void;
}

interface Active {
  id: string;
  el: HTMLElement;
  pointerId: number;
  touch: boolean;
  x0: number;
  y0: number;
  dragging: boolean;
  ghost: HTMLElement | null;
  over: HTMLElement | null;
  lastX: number;
  lastY: number;
  /** usable viewport band for auto-scroll (excludes fixed / sticky bars) */
  top: number;
  bottom: number;
  cleanup: () => void;
}

const EDGE = 56; // px from the (usable) viewport edge where a drag auto-scrolls
const SLOP_MOUSE = 5; // px of movement before a press becomes a drag
const SLOP_TOUCH = 8;

/** nearest fixed / sticky ancestor (or self) of an element, if any */
function pinned(el: Element | null): HTMLElement | null {
  for (let e = el as HTMLElement | null; e && e !== document.body; e = e.parentElement) {
    const p = getComputedStyle(e).position;
    if (p === 'fixed' || p === 'sticky') return e;
  }
  return null;
}

/** the part of the viewport not covered by fixed / sticky bars along the top and bottom edges */
function usableBand(): { top: number; bottom: number } {
  let top = 0;
  let bottom = innerHeight;
  // probe a strip along each edge (bars may float a few px off the edge, e.g. the phone tab bar)
  for (const f of [0.25, 0.5, 0.75])
    for (let d = 1; d <= 41; d += 10) {
      const x = innerWidth * f;
      const b = pinned(document.elementFromPoint(x, innerHeight - d));
      if (b) bottom = Math.min(bottom, b.getBoundingClientRect().top);
      const t = pinned(document.elementFromPoint(x, d));
      if (t) top = Math.max(top, t.getBoundingClientRect().bottom);
    }
  // a pinned element covering most of the screen (a dialog) is not a bar
  if (bottom < innerHeight * 0.6) bottom = innerHeight;
  if (top > innerHeight * 0.4) top = 0;
  return { top, bottom };
}

export function useDrag(opts: DragOptions) {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const active = useRef<Active | null>(null);
  const scrollRaf = useRef(0);
  /** time the last pointer gesture ended: the click that follows it must not count as a keyboard tap */
  const lastUp = useRef(0);

  const setOver = (a: Active) => {
    const hit = document.elementFromPoint(a.lastX, a.lastY)?.closest<HTMLElement>('[data-drop]') ?? null;
    const target = hit && !hit.hasAttribute('data-drop-off') ? hit : null;
    if (target === a.over) return;
    a.over?.removeAttribute('data-over');
    target?.setAttribute('data-over', '');
    a.over = target;
  };

  const autoScroll = () => {
    cancelAnimationFrame(scrollRaf.current);
    const step = () => {
      const a = active.current;
      if (!a?.dragging) return;
      const y = a.lastY;
      const top = a.top + EDGE;
      const bottom = a.bottom - EDGE;
      const dy = y < top ? -Math.ceil((top - y) / 4) : y > bottom ? Math.ceil((y - bottom) / 4) : 0;
      if (dy) {
        const before = scrollY;
        window.scrollBy(0, Math.max(-24, Math.min(24, dy)));
        if (scrollY !== before) {
          // the page moved under a still finger: the target under it (and match's cable end) changed
          setOver(a);
          optsRef.current.onMove?.(a.id, { x: a.lastX, y: a.lastY });
        }
      }
      scrollRaf.current = requestAnimationFrame(step);
    };
    scrollRaf.current = requestAnimationFrame(step);
  };

  const finish = (cancelled: boolean) => {
    const a = active.current;
    if (!a) return;
    active.current = null;
    lastUp.current = performance.now();
    cancelAnimationFrame(scrollRaf.current);
    a.cleanup();
    try {
      if (a.el.hasPointerCapture?.(a.pointerId)) a.el.releasePointerCapture(a.pointerId);
    } catch {
      // already released
    }
    a.ghost?.remove();
    a.el.classList.remove('is-dragging');
    a.over?.removeAttribute('data-over');
    optsRef.current.scope.current?.removeAttribute('data-dragging');
    if (a.dragging) optsRef.current.onMove?.(a.id, null);
    if (cancelled) return;
    if (a.dragging) {
      const target = a.over?.dataset.drop;
      if (target) optsRef.current.onDrop(a.id, target);
    } else optsRef.current.onTap(a.id);
  };

  const move = (a: Active, x: number, y: number) => {
    a.lastX = x;
    a.lastY = y;
    if (!a.dragging) {
      if (Math.hypot(x - a.x0, y - a.y0) < (a.touch ? SLOP_TOUCH : SLOP_MOUSE)) return;
      a.dragging = true;
      a.el.classList.add('is-dragging');
      optsRef.current.scope.current?.setAttribute('data-dragging', '');
      Object.assign(a, usableBand());
      if (optsRef.current.ghost !== false) {
        const g = a.el.cloneNode(true) as HTMLElement;
        g.classList.remove('is-dragging');
        g.classList.add('cg-ghost');
        // a finger covers the card it holds: on touch the ghost floats just above the finger
        if (a.touch) g.classList.add('touch');
        g.removeAttribute('aria-pressed');
        g.removeAttribute('id');
        g.setAttribute('aria-hidden', 'true');
        g.style.width = `${a.el.offsetWidth}px`;
        document.body.append(g);
        a.ghost = g;
      }
      autoScroll();
    }
    if (a.ghost) {
      a.ghost.style.left = `${x}px`;
      a.ghost.style.top = `${y}px`;
    }
    optsRef.current.onMove?.(a.id, { x, y });
    setOver(a);
  };

  // finish any gesture still running when the component unmounts
  useEffect(() => () => finish(true), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (id: string) => ({
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || !e.isPrimary || active.current) return;
      const el = e.currentTarget;
      const pointerId = e.pointerId;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // synthetic or already-released pointer: the window listeners below still track the gesture
      }
      const mine = (ev: PointerEvent) => ev.pointerId === pointerId;
      const onMoveW = (ev: PointerEvent) => {
        const a = active.current;
        if (a && mine(ev)) move(a, ev.clientX, ev.clientY);
      };
      const onUp = (ev: PointerEvent) => {
        if (!mine(ev)) return;
        const a = active.current;
        if (a) move(a, ev.clientX, ev.clientY);
        finish(false);
      };
      const onCancel = (ev: PointerEvent) => {
        if (mine(ev)) finish(true);
      };
      const onBlur = () => finish(true);
      const onTouchMove = (ev: TouchEvent) => {
        if (active.current?.dragging && ev.cancelable) ev.preventDefault();
      };
      const onContext = (ev: Event) => ev.preventDefault();
      window.addEventListener('pointermove', onMoveW);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onBlur);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('contextmenu', onContext);
      active.current = {
        id,
        el,
        pointerId,
        touch: e.pointerType === 'touch',
        x0: e.clientX,
        y0: e.clientY,
        dragging: false,
        ghost: null,
        over: null,
        lastX: e.clientX,
        lastY: e.clientY,
        top: 0,
        bottom: innerHeight,
        cleanup: () => {
          window.removeEventListener('pointermove', onMoveW);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
          window.removeEventListener('blur', onBlur);
          window.removeEventListener('touchmove', onTouchMove);
          window.removeEventListener('contextmenu', onContext);
        },
      };
    },
    // Enter / Space "click" a button with detail 0; pointer clicks were already handled on pointerup
    // (some browsers report detail 0 for touch clicks too, hence the time guard)
    onClick: (e: RMouseEvent<HTMLElement>) => {
      if (e.detail === 0 && performance.now() - lastUp.current > 600) optsRef.current.onTap(id);
    },
  });
}

/** Esc puts a held card back. */
export function useEscape(active: boolean, onEscape: () => void) {
  const fn = useRef(onEscape);
  useEffect(() => {
    fn.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fn.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
