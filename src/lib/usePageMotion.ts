import type { RefObject } from 'react';
import { gsap, heroIn, MOTION_OK, revealOnScroll, useGSAP } from './gsap';

/**
 * Page choreography (GSAP), scoped to the page root so a route change reverts it:
 * - `intro`: the hero group, entering together when the page mounts; `introMedia`: standalone media in the hero
 * - `reveal`: blocks revealed one by one as they scroll into view (each is its own group)
 * Selectors are resolved inside the root (`:scope > …` works). Elements that Framer Motion animates must not be
 * listed here. With reduced motion nothing runs and every element keeps its natural state.
 */
export function usePageMotion(
  scope: RefObject<HTMLElement | null>,
  { intro, introMedia, reveal, deps = [] }: { intro?: string; introMedia?: string; reveal?: string; deps?: unknown[] },
) {
  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const introEls = intro ? Array.from(root.querySelectorAll<HTMLElement>(intro)) : [];
        const mediaEls = introMedia ? Array.from(root.querySelectorAll<HTMLElement>(introMedia)) : [];
        heroIn(introEls);
        heroIn(mediaEls, { media: true });
        if (reveal) revealOnScroll(Array.from(root.querySelectorAll<HTMLElement>(reveal)).filter((el) => !introEls.includes(el) && !mediaEls.includes(el)));
      });
    },
    { scope, dependencies: deps, revertOnUpdate: true },
  );
}
