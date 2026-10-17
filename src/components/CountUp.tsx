import { useRef } from 'react';
import { gsap, MOTION_OK, useGSAP } from '../lib/gsap';

/**
 * A number that counts up to its value (GSAP) when it scrolls into view. React renders the final value, so it is
 * correct without the animation, for screen readers (aria-label) and with reduced motion (the tween is never set
 * up). A later change counts on from the number last shown.
 */
export function CountUp({ value, suffix = '', delay = 0 }: { value: number; suffix?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      // the DOM remembers what it last showed (survives StrictMode's effect replay and value changes)
      const start = Number(el.dataset.shown ?? 0);
      if (start === value) return;
      // write into React's own text node (never replace it), so React's later updates still land
      const node = el.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) return;
      const show = (n: number) => {
        node.nodeValue = `${n}${suffix}`;
      };
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const box = { n: start };
        show(start);
        gsap.to(box, {
          n: value,
          duration: Math.min(1.4, 0.7 + Math.abs(value - start) / 150),
          delay,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 96%', once: true },
          onUpdate: () => {
            const n = Math.round(box.n);
            el.dataset.shown = String(n);
            show(n);
          },
        });
        // reverted (unmount, new value, motion preference change): put the real value back
        return () => show(value);
      });
    },
    { dependencies: [value, suffix, delay], revertOnUpdate: true },
  );
  return (
    <span ref={ref} className="count-up" aria-label={`${value}${suffix}`}>
      {`${value}${suffix}`}
    </span>
  );
}
