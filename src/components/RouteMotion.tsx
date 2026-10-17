import { useRef, type ReactNode } from 'react';
import { gsap, MOTION_OK, revealOnScroll, useGSAP } from '../lib/gsap';

const INTRO = ':scope > .eyebrow, :scope > h1, :scope > .lead, :scope > header > *, :scope > .ach-filters';
const REVEAL = [
  ':scope > .card',
  ':scope > section',
  ':scope > .two-col',
  ':scope > .weak-grid > *',
  ':scope > .card-grid > *',
  ':scope > .settings-group',
].join(', ');

/**
 * Wraps each route (it remounts with the route): pages without their own choreography get a GSAP header stagger
 * and scroll reveals for their top-level blocks. Pages that run their own (root `data-motion="own"`: dashboard,
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
        if (intro.length) gsap.from(intro, { autoAlpha: 0, y: 14, duration: 0.6, stagger: 0.06, clearProps: 'transform,opacity,visibility' });
        revealOnScroll(Array.from(page.querySelectorAll<HTMLElement>(REVEAL)).filter((el) => !intro.includes(el)), { stagger: 0.06 });
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
