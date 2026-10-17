import type { PhaseProgress } from '../lib/metrics';

/** How a phase reads on the dashboard: every topic passed, the phase you are studying now, started, or ahead. */
export type PhaseState = 'done' | 'now' | 'prog' | 'todo';

export function phaseState(ph: PhaseProgress, currentPhaseId: string | undefined): PhaseState {
  if (ph.id === currentPhaseId) return 'now';
  if (ph.total > 0 && ph.passed === ph.total) return 'done';
  if (ph.passed || ph.inProgress) return 'prog';
  return 'todo';
}

export const STATE_COLOR: Record<PhaseState, string> = { done: 'var(--cyan)', now: 'var(--amber)', prog: 'var(--blue)', todo: 'var(--ink-4)' };
