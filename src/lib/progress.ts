import { useSyncExternalStore } from 'react';
import { mergeEarned, type NewlyEarned, type StoredAchievements } from '../content/achievements';

export type Rating = 'nailed' | 'partial' | 'missed';

export interface TestRecord {
  best: number;
  last: number;
  attempts: number;
  passedAt?: string;
  /** most recent full-length attempts, oldest first (max 10) */
  history?: { at: string; score: number }[];
}

/** per-question outcome across every attempt (full exams and practice drills) */
export interface McqRecord {
  seen: number;
  wrong: number;
  lastCorrect: boolean;
  lastAt: string;
}

export interface Settings {
  passMark: number;
  secondsPerQuestion: number;
  shuffle: boolean;
  theme: 'system' | 'light' | 'dark';
  mockMinutes: number;
  /** study-first lock: which practice unlocks only after every Learn section is marked read */
  studyLock: 'off' | 'exam' | 'exam-interview';
  /**
   * Settings → Ink (applied as data-accent on <html> by lib/theme.ts). Optional, so saves made before it existed
   * load unchanged; a missing value means 'indigo' (blue-black).
   */
  accent?: Accent;
}

export type Accent = 'indigo' | 'teal' | 'rose' | 'amber';

export interface Progress {
  tests: Record<string, TestRecord>;
  sections: Record<string, number[]>;
  iq: Record<string, Rating>;
  boe: Record<string, true>;
  cc: Record<string, true>;
  drafts: Record<string, string>;
  company: Record<string, true>;
  mcq: Record<string, McqRecord>;
  /** applied one-off data migrations */
  migrations?: string[];
  /** local dates (YYYY-MM-DD) with any study activity, oldest first (max 120), for the study streak */
  activityDays?: string[];
  /**
   * earned badges: { [id]: { tier, earnedAt, tiers } } (src/content/achievements.ts). Optional, so saves made
   * before achievements existed load unchanged; they are earned (and celebrated once) on the next evaluation.
   */
  achievements?: StoredAchievements;
  settings: Settings;
}

const KEY = 'sdl-progress-v1';

const DEFAULT: Progress = {
  tests: {},
  sections: {},
  iq: {},
  boe: {},
  cc: {},
  drafts: {},
  company: {},
  mcq: {},
  // fresh progress already matches current content, so no migration applies
  migrations: ['fund-estimation-toolkit'],
  settings: { passMark: 70, secondsPerQuestion: 90, shuffle: true, theme: 'system', mockMinutes: 45, studyLock: 'exam' },
};

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<Progress>;
    // migrations are judged from what was saved, not from the defaults merged in
    return migrate({ ...DEFAULT, ...parsed, settings: { ...DEFAULT.settings, ...parsed.settings } }, parsed.migrations ?? []);
  } catch {
    return DEFAULT;
  }
}

// One-off content migrations for data keyed by section index.
function migrate(p: Progress, applied: string[]): Progress {
  const done = new Set(applied);
  // fund-estimation gained a new section at index 1 ("Estimation arithmetic toolkit")
  if (!done.has('fund-estimation-toolkit')) {
    const read = p.sections['fund-estimation'];
    if (read) p = { ...p, sections: { ...p.sections, 'fund-estimation': read.map((i) => (i >= 1 ? i + 1 : i)) } };
    done.add('fund-estimation-toolkit');
  }
  return { ...p, migrations: [...done] };
}

let state: Progress = load();
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useProgress(): Progress {
  return useSyncExternalStore(subscribe, () => state);
}

export function getProgress(): Progress {
  return state;
}

/** today's local date as YYYY-MM-DD */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function withActivity(p: Progress): Progress {
  const today = localDay();
  const days = p.activityDays ?? [];
  if (days[days.length - 1] === today) return p;
  return { ...p, activityDays: [...days.filter((d) => d !== today), today].slice(-120) };
}

/** Apply a change. Study actions (activity = true) also record today for the study streak. */
export function update(fn: (p: Progress) => Progress, activity = true) {
  state = fn(state);
  if (activity) state = withActivity(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full or blocked — keep in-memory state
  }
  listeners.forEach((l) => l());
}

export function recordTest(topicId: string, score: number) {
  update((p) => {
    const prev = p.tests[topicId];
    const passed = score >= p.settings.passMark;
    const rec: TestRecord = {
      best: Math.max(prev?.best ?? 0, score),
      last: score,
      attempts: (prev?.attempts ?? 0) + 1,
      passedAt: prev?.passedAt ?? (passed ? new Date().toISOString() : undefined),
      history: [...(prev?.history ?? []), { at: new Date().toISOString(), score }].slice(-10),
    };
    return { ...p, tests: { ...p.tests, [topicId]: rec } };
  });
}

export function recordAnswers(results: { id: string; correct: boolean }[]) {
  const at = new Date().toISOString();
  update((p) => {
    const mcq = { ...p.mcq };
    for (const r of results) {
      const prev = mcq[r.id];
      mcq[r.id] = {
        seen: (prev?.seen ?? 0) + 1,
        wrong: (prev?.wrong ?? 0) + (r.correct ? 0 : 1),
        lastCorrect: r.correct,
        lastAt: at,
      };
    }
    return { ...p, mcq };
  });
}

export function toggleSectionRead(topicId: string, index: number) {
  update((p) => {
    const cur = new Set(p.sections[topicId] ?? []);
    if (cur.has(index)) cur.delete(index);
    else cur.add(index);
    return { ...p, sections: { ...p.sections, [topicId]: [...cur].sort((a, b) => a - b) } };
  });
}

export function markAllSectionsRead(topicId: string, count: number) {
  update((p) => ({ ...p, sections: { ...p.sections, [topicId]: Array.from({ length: count }, (_, i) => i) } }));
}

export function setFlag(bucket: 'boe' | 'cc' | 'company', id: string, on: boolean) {
  update((p) => {
    const next = { ...p[bucket] };
    if (on) next[id] = true;
    else delete next[id];
    return { ...p, [bucket]: next };
  });
}

export function rateIQ(id: string, r: Rating | null) {
  update((p) => {
    const next = { ...p.iq };
    if (r) next[id] = r;
    else delete next[id];
    return { ...p, iq: next };
  });
}

export function setDraft(id: string, text: string) {
  update((p) => ({ ...p, drafts: { ...p.drafts, [id]: text } }));
}

export function setSettings(s: Partial<Settings>) {
  update((p) => ({ ...p, settings: { ...p.settings, ...s } }), false);
}

/** Store newly earned badges / tier-ups. Not study activity, and never downgrades a stored tier. */
export function earnAchievements(earned: NewlyEarned[], at = Date.now()) {
  if (!earned.length) return;
  update((p) => ({ ...p, achievements: mergeEarned(p.achievements, earned, at) }), false);
}

/** Clears study progress and earned achievements; settings are kept. */
export function resetProgress() {
  update((p) => ({ ...DEFAULT, settings: p.settings }), false);
}

export function isPassed(p: Progress, topicId: string) {
  return !!p.tests[topicId]?.passedAt;
}
