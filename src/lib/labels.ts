/** Short phase name for compact UI: "Messaging & Data Pipelines" → "Messaging", "Low-Level Design (LLD) & …" → "Low-Level Design". */
export const shortTitle = (title: string) => title.split(/ & |: | \(| →/)[0];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Two-digit phase number, as printed on the sheet: 3 → "03". */
export const phaseCode = (n: number) => pad2(n);

/**
 * Drawing-style reference for a topic: "<phase>.<position in phase>", e.g. "03.02".
 * Derived from course order, so it is stable as long as the course order is.
 */
export function topicCode(topics: readonly { id: string; phase: string }[], phases: readonly { id: string; number: number }[], id: string): string {
  const t = topics.find((x) => x.id === id);
  if (!t) return '';
  const ph = phases.find((p) => p.id === t.phase);
  const pos = topics.filter((x) => x.phase === t.phase).findIndex((x) => x.id === id);
  return `${pad2(ph?.number ?? 0)}.${pad2(pos + 1)}`;
}
