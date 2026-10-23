import { useRef, type ReactNode } from 'react';
import { gsap, heroIn, MOTION_OK, revealOnScroll, useGSAP } from '../lib/gsap';

// the page's hero group (heading, lead, intro copy) enters together; sticky HUDs and filter controls stay put
const INTRO = ':scope > .eyebrow, :scope > h1, :scope > .lead, :scope > header:not(.ex-hud)';
// each block is its own group; grids are revealed as one collection, not card by card
const REVEAL = [
  ':scope > .card',
  ':scope > section',
  ':scope > .two-col',
  ':scope > .weak-grid',
  ':scope > .card-grid',
  ':scope > .wk-list',
  ':scope > .ex-setup-grid',
  ':scope > .ex-grid',
].join(', ');

/**
 * Wraps each route (it remounts with the route): pages without their own choreography get a hero entrance for their
 * header and scroll reveals for their top-level blocks. Pages that run their own (root `data-motion="own"`: dashboard,
 * contents, topic) are left alone. `display: contents`, so it adds no box to the layout.
 */
export function RouteMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const page = ref.current?.querySelector<HTMLElement>(':scope > .page');
      if (!page || page.dataset.motion === 'own') return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const intro = Array.from(page.querySelectorAll<HTMLElement>(INTRO));
        heroIn(intro);
        revealOnScroll(Array.from(page.querySelectorAll<HTMLElement>(REVEAL)).filter((el) => !intro.includes(el)));
      });
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className="route-motion">
      {children}
    </div>
  );
}
