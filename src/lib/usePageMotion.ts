import type { RefObject } from 'react';
import { gsap, MOTION_OK, revealOnScroll, useGSAP } from './gsap';

/**
 * Page choreography (GSAP), scoped to the page root so a route change reverts it:
 * - `intro`: elements staggered in when the page mounts (headings, lead, hero)
 * - `reveal`: blocks revealed as they scroll into view (only those starting below the fold)
 * Selectors are resolved inside the root (`:scope > …` works). Elements that Framer Motion animates must not be
 * listed here. With reduced motion nothing runs and every element keeps its natural state.
 */
export function usePageMotion(
  scope: RefObject<HTMLElement | null>,
  { intro, reveal, deps = [] }: { intro?: string; reveal?: string; deps?: unknown[] },
) {
  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const introEls = intro ? Array.from(root.querySelectorAll<HTMLElement>(intro)) : [];
        if (introEls.length) {
          gsap.from(introEls, { autoAlpha: 0, y: 14, duration: 0.6, stagger: 0.055, ease: 'power3.out', clearProps: 'transform,opacity,visibility' });
        }
        if (reveal) revealOnScroll(Array.from(root.querySelectorAll<HTMLElement>(reveal)).filter((el) => !introEls.includes(el)));
      });
    },
    { scope, dependencies: deps, revertOnUpdate: true },
  );
}
