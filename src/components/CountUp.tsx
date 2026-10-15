import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';

/** A number that counts up to its value on first render (instantly when reduced motion is on). */
export function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = `${value}${suffix}`;
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (v) => (el.textContent = `${Math.round(v)}${suffix}`),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, suffix, reduce]);
  return (
    <span ref={ref} aria-label={`${value}${suffix}`}>
      {reduce ? `${value}${suffix}` : `0${suffix}`}
    </span>
  );
}
