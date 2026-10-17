// GSAP, registered once. Responsibilities (Framer Motion — `motion/react` — owns component/state-driven UI:
// route transitions, layoutId pills, modals, toasts, exam answer feedback, progress springs):
// - page-load choreography (hero sequences, staggered headings/cards)
// - ScrollTrigger reveals on long pages
// - number counters and SVG line-draw / connector motifs
// Every effect runs inside useGSAP (a gsap.context scoped to a ref), so a route change reverts its tweens and
// kills its ScrollTriggers. Everything is set up inside gsap.matchMedia('(prefers-reduced-motion: no-preference)'):
// with reduced motion nothing is hidden or moved. Initial states come from gsap.from / fromTo inside the effect
// (never CSS opacity: 0), so content is fully visible if the script does not run.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, useGSAP);
gsap.defaults({ ease: 'power3.out', duration: 0.7 });
// the mobile URL bar resizing the viewport should not re-run every trigger
ScrollTrigger.config({ ignoreMobileResize: true });

export const MOTION_OK = '(prefers-reduced-motion: no-preference)';

/** Refresh trigger positions once layout has settled (fonts, lazy widgets, route transition). */
export function refreshSoon(delay = 0.35) {
  return gsap.delayedCall(delay, () => ScrollTrigger.refresh());
}

/**
 * Reveal elements as they scroll into view. Only elements that start below the fold are faded (so nothing above
 * the viewport, e.g. after a restored scroll position, can be left invisible); `once` keeps them shown. Opacity
 * only, never visibility: faded blocks stay in the tab order and in find-in-page, and focusing one (which scrolls
 * it into view) reveals it.
 */
export function revealOnScroll(targets: gsap.DOMTarget, opts: { y?: number; stagger?: number } = {}) {
  const els = gsap.utils.toArray<HTMLElement>(targets).filter((el) => el.getBoundingClientRect().top > window.innerHeight * 0.92);
  if (!els.length) return;
  gsap.set(els, { opacity: 0, y: opts.y ?? 22 });
  const show = (batch: Element[]) =>
    gsap.to(batch, { opacity: 1, y: 0, duration: 0.75, stagger: opts.stagger ?? 0.08, overwrite: true, clearProps: 'transform,opacity' });
  ScrollTrigger.batch(els, { start: 'top 92%', once: true, onEnter: show });
  // short pages: whatever is still faded when the page bottom is reached shows too
  ScrollTrigger.create({
    trigger: document.documentElement,
    start: 'bottom bottom+=4',
    once: true,
    onEnter: () => {
      const left = els.filter((el) => Number(gsap.getProperty(el, 'opacity')) < 1);
      if (left.length) show(left);
    },
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
