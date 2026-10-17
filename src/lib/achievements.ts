// App wiring for the pure achievements catalogue (src/content/achievements.ts): the real content as its
// context, a memoised evaluation hook for pages, and shared label helpers.
import { useMemo } from 'react';
import {
  ACHIEVEMENTS,
  buildAchievementContext,
  evaluateAll,
  TIER_LABEL,
  type Achievement,
  type Evaluation,
  type Evaluations,
  type StoredAchievement,
} from '../content/achievements';
import { COMPANIES, COMPANY_QUESTIONS, PHASES, TOPICS } from '../content';
import type { Progress } from './progress';

export const achievementCtx = buildAchievementContext({
  topics: TOPICS,
  phases: PHASES,
  companies: COMPANIES,
  companyQuestions: COMPANY_QUESTIONS,
});

export const ACHIEVEMENT_TOTAL = ACHIEVEMENTS.length;

/** { [id]: evaluation } for the current progress (memoised on the progress object). */
export function useAchievementEvaluations(p: Progress): Evaluations {
  return useMemo(() => evaluateAll(p, achievementCtx), [p]);
}

export const formatEarnedDate = (ts?: number) =>
  ts ? new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** Accessible one-line description: "Horizontal Scaler — gold, earned 12 Oct 2026" / "Five Nines. Locked: pass all 4 exams…" */
export function badgeLabel(a: Achievement, stored?: StoredAchievement, ev?: Evaluation): string {
  if (stored?.tier) {
    const tier = TIER_LABEL[stored.tier] ? `${TIER_LABEL[stored.tier].toLowerCase()}, ` : '';
    return `${a.name}, ${tier}earned ${formatEarnedDate(stored.earnedAt)}`;
  }
  const req = ev?.requirement ?? '';
  return `${a.name}. Locked: ${req.charAt(0).toLowerCase()}${req.slice(1)}`;
}
