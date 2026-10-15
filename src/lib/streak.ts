// Study streak: consecutive days with any study activity (Progress.activityDays).
import { localDay } from './progress';

function shift(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + delta));
}

/** Consecutive active days ending today, or yesterday if today has no activity yet (the streak is still alive). */
export function studyStreak(days: string[] | undefined, today = localDay()): number {
  const set = new Set(days ?? []);
  let cur = set.has(today) ? today : shift(today, -1);
  let n = 0;
  while (set.has(cur)) {
    n++;
    cur = shift(cur, -1);
  }
  return n;
}

/** The last 7 days, oldest first, with whether each had study activity. */
export function lastSevenDays(days: string[] | undefined, today = localDay()) {
  const set = new Set(days ?? []);
  return Array.from({ length: 7 }, (_, i) => {
    const day = shift(today, i - 6);
    const [y, m, d] = day.split('-').map(Number);
    return { day, active: set.has(day), label: new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'narrow' }) };
  });
}
