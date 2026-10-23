import type { Tone } from './sim';

// 'accent' maps to the fixed blue family rather than the user-selectable --accent, so the
// semantic colours stay distinct under every accent (teal = good, amber = warn would collide).
const BASE: Record<Tone, [string, string]> = {
  accent: ['var(--blue)', 'var(--blue-s)'],
  good: ['var(--good)', 'var(--good-soft)'],
  warn: ['var(--warn)', 'var(--warn-soft)'],
  bad: ['var(--bad)', 'var(--bad-soft)'],
  mag: ['var(--mag)', 'var(--mag-s)'],
  muted: ['var(--ink-4)', 'var(--tint)'],
};

/** stroke / text colour for a tone (tokens only) */
export const stroke = (t: Tone) => BASE[t][0];
/** soft fill for a tone */
export const soft = (t: Tone) => BASE[t][1];
