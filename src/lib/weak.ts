// Weak-area analysis: which topics, sections and question types the learner struggles with.
import type { Difficulty, MCQ, Topic } from '../types';
import type { Progress } from './progress';

// ---------- question → section matching ----------
// Questions aren't tagged with a section, so we match them with TF-IDF cosine
// similarity between the question text and each section of its own topic.

const STOP = new Set(
  'the a an and or of to in on for is are be it this that with as at by from what which when why how does do not but if then than can will would should into your you its their they them was were has have had use using used per each any all one two more most less very only also so such there these those our we i'.split(
    ' ',
  ),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*_#>|[\]()]/g, ' ')
    .split(/[^a-z0-9+]+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

type Vec = Map<string, number>;

function termFreq(words: string[], weight = 1, into: Vec = new Map()): Vec {
  for (const w of words) into.set(w, (into.get(w) ?? 0) + weight);
  return into;
}

interface SectionIndex {
  vectors: Vec[];
  idf: Map<string, number>;
}

const indexCache = new Map<string, SectionIndex>();

function sectionIndex(topic: Topic): SectionIndex {
  const cached = indexCache.get(topic.id);
  if (cached) return cached;
  const raw = topic.sections.map((s) => {
    const v = termFreq(tokens(s.heading), 4);
    termFreq(tokens(s.body), 1, v);
    termFreq(tokens((s.keyPoints ?? []).join(' ')), 2, v);
    termFreq(tokens((s.code ?? []).map((c) => c.title ?? '').join(' ')), 2, v);
    return v;
  });
  const df = new Map<string, number>();
  raw.forEach((v) => v.forEach((_, w) => df.set(w, (df.get(w) ?? 0) + 1)));
  const n = raw.length;
  const idf = new Map([...df].map(([w, d]) => [w, Math.log((n + 1) / (d + 0.5))]));
  const vectors = raw.map((v) => new Map([...v].map(([w, f]) => [w, (1 + Math.log(f)) * (idf.get(w) ?? 0)])));
  const idx = { vectors, idf };
  indexCache.set(topic.id, idx);
  return idx;
}

function cosine(a: Vec, b: Vec) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((x, w) => {
    na += x * x;
    const y = b.get(w);
    if (y) dot += x * y;
  });
  b.forEach((y) => (nb += y * y));
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const sectionCache = new Map<string, number>();

/** index of the section in `topic` that a question most likely tests */
export function sectionForQuestion(topic: Topic, q: MCQ): number {
  const hit = sectionCache.get(q.id);
  if (hit !== undefined) return hit;
  const { vectors, idf } = sectionIndex(topic);
  const correct = q.correct.map((i) => q.options[i]).join(' ');
  const qv = termFreq(tokens(q.question), 2);
  termFreq(tokens(correct), 2, qv);
  termFreq(tokens(q.explanation), 1, qv);
  if (q.code?.title) termFreq(tokens(q.code.title), 1, qv);
  const weighted: Vec = new Map([...qv].map(([w, f]) => [w, (1 + Math.log(f)) * (idf.get(w) ?? 0)]));
  let best = 0;
  let bestScore = -1;
  vectors.forEach((v, i) => {
    const s = cosine(weighted, v);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  sectionCache.set(q.id, best);
  return best;
}

// ---------- aggregation ----------

export interface WeakSection {
  index: number;
  heading: string;
  missed: MCQ[];
}

/** group a topic's missed questions by the section they map to, most-missed first */
export function weakSections(topic: Topic, missed: MCQ[]): WeakSection[] {
  const groups = new Map<number, MCQ[]>();
  for (const q of missed) {
    const i = sectionForQuestion(topic, q);
    groups.set(i, [...(groups.get(i) ?? []), q]);
  }
  return [...groups]
    .map(([index, qs]) => ({ index, heading: topic.sections[index]?.heading ?? 'General', missed: qs }))
    .sort((a, b) => b.missed.length - a.missed.length || a.index - b.index);
}

/** questions in this topic whose most recent answer was wrong */
export function currentlyWrong(p: Progress, topic: Topic): MCQ[] {
  return topic.test.filter((q) => p.mcq[q.id] && !p.mcq[q.id].lastCorrect);
}

export interface TopicWeakness {
  topic: Topic;
  last: number;
  best: number;
  attempts: number;
  passed: boolean;
  history: number[];
  wrong: MCQ[];
  sections: WeakSection[];
  /** interview questions self-rated missed/partial */
  shakyInterview: number;
}

/** attempted topics that need work, weakest first */
export function weakTopics(p: Progress, topics: Topic[]): TopicWeakness[] {
  return topics
    .map((topic) => {
      const rec = p.tests[topic.id];
      const wrong = currentlyWrong(p, topic);
      const shakyInterview = topic.interviewQuestions.filter((q) => p.iq[q.id] === 'missed' || p.iq[q.id] === 'partial').length;
      return {
        topic,
        last: rec?.last ?? 0,
        best: rec?.best ?? 0,
        attempts: rec?.attempts ?? 0,
        passed: !!rec?.passedAt,
        history: (rec?.history ?? []).map((h) => h.score),
        wrong,
        sections: weakSections(topic, wrong),
        shakyInterview,
      };
    })
    .filter((w) => w.wrong.length > 0 || w.shakyInterview > 0 || (w.attempts > 0 && !w.passed))
    .sort((a, b) => Number(a.passed) - Number(b.passed) || a.last - b.last || b.wrong.length - a.wrong.length);
}

export interface Accuracy {
  seen: number;
  correct: number;
}

/** accuracy by difficulty and by question format, using the latest answer to each question */
export function accuracyBreakdown(p: Progress, topics: Topic[]) {
  const byDifficulty: Record<Difficulty, Accuracy> = {
    medium: { seen: 0, correct: 0 },
    hard: { seen: 0, correct: 0 },
    expert: { seen: 0, correct: 0 },
  };
  const byFormat = {
    single: { seen: 0, correct: 0 },
    multi: { seen: 0, correct: 0 },
    code: { seen: 0, correct: 0 },
  };
  for (const t of topics) {
    for (const q of t.test) {
      const r = p.mcq[q.id];
      if (!r) continue;
      const ok = r.lastCorrect ? 1 : 0;
      byDifficulty[q.difficulty].seen++;
      byDifficulty[q.difficulty].correct += ok;
      const fmt = q.correct.length > 1 ? byFormat.multi : byFormat.single;
      fmt.seen++;
      fmt.correct += ok;
      if (q.code) {
        byFormat.code.seen++;
        byFormat.code.correct += ok;
      }
    }
  }
  return { byDifficulty, byFormat };
}

export const pct = (a: Accuracy) => (a.seen ? Math.round((a.correct / a.seen) * 100) : null);
