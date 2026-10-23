// GSAP, registered once. Responsibilities (Framer Motion — `motion/react` — owns component/state-driven UI:
// route transitions, layoutId pills, modals, toasts, exam answer feedback, progress springs):
// - page-load choreography (hero entrances)
// - ScrollTrigger reveals on long pages
// - number counters and SVG line-draw / connector motifs
// Every effect runs inside useGSAP (a gsap.context scoped to a ref), so a route change reverts its tweens and
// kills its ScrollTriggers. Everything is set up inside gsap.matchMedia('(prefers-reduced-motion: no-preference)'):
// with reduced motion nothing is hidden or moved. Initial states come from gsap.from / fromTo inside the effect
// (never CSS opacity: 0), so content is fully visible if the script does not run.
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, CustomEase, useGSAP);
gsap.defaults({ ease: 'power3.out', duration: 0.7 });
// the mobile URL bar resizing the viewport should not re-run every trigger
ScrollTrigger.config({ ignoreMobileResize: true });

export const MOTION_OK = '(prefers-reduced-motion: no-preference)';

// Entrance and reveal values (the "effects" rules): one easing curve, opacity 0 → 1, a short upward travel for
// copy / mixed groups / card collections (8px on phones), and a 0.98 → 1 scale for standalone media.
export const ENTRANCE_EASE = CustomEase.create('entrance', '0.22,1,0.36,1');
const PHONE = '(max-width: 640px)';
const travel = () => (window.matchMedia(PHONE).matches ? 8 : 12);
const shown = (el: HTMLElement) => el.getClientRects().length > 0; // skip display:none alternatives

/** Refresh trigger positions once layout has settled (fonts, lazy widgets, route transition). */
export function refreshSoon(delay = 0.35) {
  return gsap.delayedCall(delay, () => ScrollTrigger.refresh());
}

/**
 * Hero entrance on mount: 0.8s, no delay. All targets enter together (one group, no stagger); `media` scales
 * 0.98 → 1 instead of travelling.
 */
export function heroIn(targets: gsap.DOMTarget, { media = false }: { media?: boolean } = {}) {
  const els = gsap.utils.toArray<HTMLElement>(targets).filter(shown);
  if (!els.length) return;
  gsap.from(els, { opacity: 0, ...(media ? { scale: 0.98 } : { y: travel() }), duration: 0.8, ease: ENTRANCE_EASE, clearProps: 'transform,opacity' });
}

/**
 * Reveal each element as its own group when 15% of it is in view (from its top for groups taller than the
 * viewport, so they stay reachable): 1s with a 0.1s delay from entering view, once. `steps` is for 2–4 sibling
 * cards that show a progression: they share one trigger and start 0.1s apart (no stagger on phones).
 * Groups already scrolled past stay as they are. Opacity only, never visibility: faded blocks stay in the tab
 * order and in find-in-page, and focusing one reveals it.
 */
export function revealOnScroll(targets: gsap.DOMTarget, { steps = false, media = false }: { steps?: boolean; media?: boolean } = {}) {
  const els = gsap.utils.toArray<HTMLElement>(targets).filter((el) => shown(el) && el.getBoundingClientRect().bottom > 0);
  if (!els.length) return;
  const from = media ? { scale: 0.98 } : { y: travel() };
  const gap = steps && !window.matchMedia(PHONE).matches ? 0.1 : 0;
  gsap.set(els, { opacity: 0, ...from });
  const show = (group: HTMLElement[]) =>
    group.forEach((el) =>
      gsap.to(el, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 1,
        delay: 0.1 + (gap ? els.indexOf(el) * gap : 0),
        ease: ENTRANCE_EASE,
        overwrite: true,
        clearProps: 'transform,opacity',
      }),
    );
  const start = (el: HTMLElement) => (el.offsetHeight > window.innerHeight ? 'top bottom' : '15% bottom');
  if (steps) ScrollTrigger.create({ trigger: els[0], start: start(els[0]), once: true, onEnter: () => show(els) });
  else els.forEach((el) => ScrollTrigger.create({ trigger: el, start: start(el), once: true, onEnter: () => show([el]) }));
  // short pages: whatever is still faded when the page bottom is reached shows too
  ScrollTrigger.create({
    trigger: document.documentElement,
    start: 'bottom bottom+=4',
    once: true,
    onEnter: () => show(els.filter((el) => Number(gsap.getProperty(el, 'opacity')) < 1)),
  });
  // keyboard users: a block that receives focus shows at once
  els.forEach((el) => el.addEventListener('focusin', () => show([el]), { once: true }));
}

/** Stroke-draw SVG paths (connector / diagram motifs) using the dash offset; no extra plugin needed. */
export function drawPaths(paths: SVGGeometryElement[], vars: gsap.TweenVars = {}) {
  paths.forEach((p) => {
    const len = Math.ceil(p.getTotalLength());
    gsap.set(p, { strokeDasharray: `${len} ${len}`, strokeDashoffset: len });
  });
  return gsap.to(paths, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut', stagger: 0.12, ...vars });
}

export { gsap, ScrollTrigger, useGSAP };
