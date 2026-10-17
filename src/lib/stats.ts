import type { Topic } from '../types';
import type { Progress } from './progress';
import { isPassed } from './progress';

export type TopicStatus = 'new' | 'in-progress' | 'passed';

export function topicStatus(p: Progress, t: Topic): TopicStatus {
  if (isPassed(p, t.id)) return 'passed';
  const touched =
    (p.sections[t.id]?.length ?? 0) > 0 ||
    !!p.tests[t.id] ||
    t.interviewQuestions.some((q) => p.iq[q.id]) ||
    t.envelopeQuestions.some((q) => p.boe[q.id]) ||
    t.codeChallenges.some((c) => p.cc[c.id]);
  return touched ? 'in-progress' : 'new';
}

export function topicCompletion(p: Progress, t: Topic): number {
  // a part the topic has none of (e.g. no estimation drills in behavioural topics) is left out,
  // not scored as 0, so every topic can reach 100%
  const part = (done: number, total: number) => (total > 0 ? [done / total] : []);
  const parts = [
    ...part(p.sections[t.id]?.length ?? 0, t.sections.length),
    ...part(t.codeChallenges.filter((c) => p.cc[c.id]).length, t.codeChallenges.length),
    ...part(t.interviewQuestions.filter((q) => p.iq[q.id]).length, t.interviewQuestions.length),
    ...part(t.envelopeQuestions.filter((q) => p.boe[q.id]).length, t.envelopeQuestions.length),
    isPassed(p, t.id) ? 1 : 0,
  ];
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
}

/** every Learn section of the topic is marked read */
export function studyComplete(p: Progress, t: Topic): boolean {
  const read = new Set(p.sections[t.id] ?? []);
  return t.sections.every((_, i) => read.has(i));
}

/**
 * Study-first lock. A topic whose exam is already passed is never re-locked,
 * so turning the setting on can't take away earlier progress.
 */
export function practiceLocked(p: Progress, t: Topic, kind: 'exam' | 'interview'): boolean {
  const mode = p.settings.studyLock;
  if (mode === 'off' || isPassed(p, t.id) || studyComplete(p, t)) return false;
  return kind === 'exam' || mode === 'exam-interview';
}

export function companyUnlocked(p: Progress, topics: Topic[]) {
  const remaining = topics.filter((t) => !isPassed(p, t.id));
  return { unlocked: topics.length > 0 && remaining.length === 0, remaining };
}
