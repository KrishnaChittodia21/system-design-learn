// Dashboard metrics: pure aggregations of Progress + content for the charts on the dashboard.
// No React and no storage access, so they can be unit-tested outside the browser.
import type { Difficulty, Topic } from '../types';
import type { Phase } from '../content/phases';
import type { Progress } from './progress';
import { topicStatus } from './stats';
import { accuracyBreakdown, type Accuracy } from './weak';

export interface StatusCounts {
  passed: number;
  inProgress: number;
  notStarted: number;
  total: number;
}

/** topics by status: passed / in progress / not started */
export function statusCounts(p: Progress, topics: Topic[]): StatusCounts {
  const c = { passed: 0, inProgress: 0, notStarted: 0, total: topics.length };
  for (const t of topics) {
    const s = topicStatus(p, t);
    if (s === 'passed') c.passed++;
    else if (s === 'in-progress') c.inProgress++;
    else c.notStarted++;
  }
  return c;
}

export interface PhaseProgress {
  id: string;
  number: number;
  title: string;
  passed: number;
  total: number;
  /** 0–100, rounded */
  pct: number;
}

/** exams passed per phase, in course order; phases without topics are left out */
export function phaseProgress(p: Progress, topics: Topic[], phases: Phase[]): PhaseProgress[] {
  return phases
    .map((ph) => {
      const ts = topics.filter((t) => t.phase === ph.id);
      const passed = ts.filter((t) => !!p.tests[t.id]?.passedAt).length;
      return { id: ph.id, number: ph.number, title: ph.title, passed, total: ts.length, pct: ts.length ? Math.round((passed / ts.length) * 100) : 0 };
    })
    .filter((x) => x.total > 0);
}

export interface ExamScore {
  id: string;
  title: string;
  best: number;
  last: number;
  attempts: number;
  passed: boolean;
  /** ISO time of the latest recorded attempt, when known */
  lastAt?: string;
}

/** every attempted exam, most recently attempted first (topics without history keep course order at the end) */
export function examScores(p: Progress, topics: Topic[]): ExamScore[] {
  const rows = topics
    .filter((t) => p.tests[t.id])
    .map((t, i) => {
      const r = p.tests[t.id];
      const hist = r.history ?? [];
      return {
        i,
        row: { id: t.id, title: t.title, best: r.best, last: r.last, attempts: r.attempts, passed: !!r.passedAt, lastAt: hist[hist.length - 1]?.at ?? r.passedAt },
      };
    });
  rows.sort((a, b) => (b.row.lastAt ?? '').localeCompare(a.row.lastAt ?? '') || a.i - b.i);
  return rows.map((r) => r.row);
}

/** mean best score over attempted exams, or null when none attempted */
export function averageBest(p: Progress, topics: Topic[]): number | null {
  const scores = topics.map((t) => p.tests[t.id]?.best).filter((s): s is number => typeof s === 'number');
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

export interface Attempt {
  at: string;
  score: number;
  topicId: string;
  title: string;
}

/** full-length exam attempts across all topics in time order, latest `limit` */
export function attemptTimeline(p: Progress, topics: Topic[], limit = 20): Attempt[] {
  const all: Attempt[] = [];
  for (const t of topics) {
    for (const h of p.tests[t.id]?.history ?? []) all.push({ at: h.at, score: h.score, topicId: t.id, title: t.title });
  }
  all.sort((a, b) => a.at.localeCompare(b.at));
  return all.slice(-limit);
}

/** overall MCQ accuracy using the latest answer to each question */
export function mcqAccuracy(p: Progress, topics: Topic[]): Accuracy {
  const { byDifficulty } = accuracyBreakdown(p, topics);
  return Object.values(byDifficulty).reduce((acc, a) => ({ seen: acc.seen + a.seen, correct: acc.correct + a.correct }), { seen: 0, correct: 0 });
}

export interface LevelAccuracy {
  level: Difficulty;
  seen: number;
  correct: number;
  pct: number;
}

/** accuracy per difficulty, only for levels with answered questions */
export function difficultyAccuracy(p: Progress, topics: Topic[]): LevelAccuracy[] {
  const { byDifficulty } = accuracyBreakdown(p, topics);
  return (Object.keys(byDifficulty) as Difficulty[])
    .map((level) => ({ level, ...byDifficulty[level], pct: byDifficulty[level].seen ? Math.round((byDifficulty[level].correct / byDifficulty[level].seen) * 100) : 0 }))
    .filter((x) => x.seen > 0);
}

export interface RatingCounts {
  nailed: number;
  partial: number;
  missed: number;
  rated: number;
  total: number;
}

/** interview self-ratings across all topics */
export function ratingCounts(p: Progress, topics: Topic[]): RatingCounts {
  const c = { nailed: 0, partial: 0, missed: 0, rated: 0, total: 0 };
  for (const t of topics) {
    for (const q of t.interviewQuestions) {
      c.total++;
      const r = p.iq[q.id];
      if (r) {
        c[r]++;
        c.rated++;
      }
    }
  }
  return c;
}

/** YYYY-MM-DD shifted by `delta` days (local calendar) */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export interface ActivityCell {
  day: string;
  active: boolean;
  /** after today: drawn empty */
  future: boolean;
  today: boolean;
}

/**
 * Study activity as `weeks` columns of 7 days (Monday first), ending with the week that contains `today`.
 * Days after today are flagged `future`.
 */
export function activityGrid(days: string[] | undefined, today: string, weeks = 12): ActivityCell[][] {
  const set = new Set(days ?? []);
  const [y, m, d] = today.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
  const start = shiftDay(today, -dow - (weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const day = shiftDay(start, w * 7 + i);
      return { day, active: set.has(day), future: day > today, today: day === today };
    }),
  );
}

/** days with activity in the 7 days ending today */
export function activeDaysLastWeek(days: string[] | undefined, today: string): number {
  const from = shiftDay(today, -6);
  return (days ?? []).filter((d) => d >= from && d <= today).length;
}

export interface VolumeRow {
  id: string;
  label: string;
  done: number;
  total: number;
  pct: number;
  href: string;
}

/** how much of each kind of practice is done (system-design-learn specific) */
export function practiceVolume(p: Progress, topics: Topic[], companyTotal: number): VolumeRow[] {
  let read = 0;
  let sections = 0;
  let cc = 0;
  let ccTotal = 0;
  let boe = 0;
  let boeTotal = 0;
  let iq = 0;
  let iqTotal = 0;
  for (const t of topics) {
    const r = new Set(p.sections[t.id] ?? []);
    sections += t.sections.length;
    read += t.sections.filter((_, i) => r.has(i)).length;
    ccTotal += t.codeChallenges.length;
    cc += t.codeChallenges.filter((c) => p.cc[c.id]).length;
    boeTotal += t.envelopeQuestions.length;
    boe += t.envelopeQuestions.filter((q) => p.boe[q.id]).length;
    iqTotal += t.interviewQuestions.length;
    iq += t.interviewQuestions.filter((q) => p.iq[q.id]).length;
  }
  const company = Object.keys(p.company).length;
  const row = (id: string, label: string, done: number, total: number, href: string): VolumeRow => ({
    id,
    label,
    done: Math.min(done, total),
    total,
    pct: total ? Math.round((Math.min(done, total) / total) * 100) : 0,
    href,
  });
  return [
    row('learn', 'Learn sections read', read, sections, '/contents'),
    row('code', 'Code & answer labs', cc, ccTotal, '/contents'),
    row('interview', 'Interview Qs rated', iq, iqTotal, '/contents'),
    row('envelope', 'Back-of-envelope drills', boe, boeTotal, '/contents'),
    row('company', 'Company questions', company, companyTotal, '/companies'),
  ].filter((r) => r.total > 0);
}
