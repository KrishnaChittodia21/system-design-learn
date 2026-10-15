// "Your next step": one obvious action for the learner, derived only from progress + content.
// Pure (type-only imports) so it can be unit-tested outside the browser.
import type { Topic } from '../types';
import type { Progress } from './progress';

/** The study path every topic follows. Ids match the topic page's `?tab=` values. */
export type StepId = 'learn' | 'code' | 'interview' | 'envelope' | 'exam' | 'capstone';

export interface TopicStep {
  id: StepId;
  label: string;
  done: number;
  total: number;
  complete: boolean;
  /** short progress text, e.g. "3/9 read", "best 80%" */
  progress: string;
}

const passed = (p: Progress, id: string) => !!p.tests[id]?.passedAt;

export function codeLabLabel(t: Topic) {
  return t.phase === 'behavioral' ? 'Answer Lab' : 'Code Lab';
}

/**
 * The study-path steps of one topic, in order: Learn → Code Lab → Interview Qs → Back-of-Envelope → Exam
 * (→ Capstone when the topic has capstone projects). Steps with no content are left out.
 */
export function topicSteps(p: Progress, t: Topic, capstoneCount = 0): TopicStep[] {
  const read = new Set(p.sections[t.id] ?? []);
  const readCount = t.sections.filter((_, i) => read.has(i)).length;
  const cc = t.codeChallenges.filter((c) => p.cc[c.id]).length;
  const iq = t.interviewQuestions.filter((q) => p.iq[q.id]).length;
  const boe = t.envelopeQuestions.filter((q) => p.boe[q.id]).length;
  const rec = p.tests[t.id];
  const steps: TopicStep[] = [
    { id: 'learn', label: 'Learn', done: readCount, total: t.sections.length, complete: false, progress: `${readCount}/${t.sections.length} read` },
    { id: 'code', label: codeLabLabel(t), done: cc, total: t.codeChallenges.length, complete: false, progress: `${cc}/${t.codeChallenges.length} done` },
    { id: 'interview', label: 'Interview Qs', done: iq, total: t.interviewQuestions.length, complete: false, progress: `${iq}/${t.interviewQuestions.length} rated` },
    { id: 'envelope', label: 'Back-of-Envelope', done: boe, total: t.envelopeQuestions.length, complete: false, progress: `${boe}/${t.envelopeQuestions.length} done` },
    {
      id: 'exam',
      label: 'Exam',
      done: passed(p, t.id) ? 1 : 0,
      total: t.test.length ? 1 : 0,
      complete: false,
      progress: rec ? `best ${rec.best}%` : `${t.test.length} Qs`,
    },
  ];
  if (capstoneCount > 0) {
    steps.push({ id: 'capstone', label: 'Capstone', done: 0, total: capstoneCount, complete: false, progress: `${capstoneCount} project${capstoneCount === 1 ? '' : 's'}` });
  }
  return steps
    .filter((s) => s.total > 0)
    .map((s) => ({ ...s, complete: s.id === 'exam' ? passed(p, t.id) : s.id !== 'capstone' && s.done >= s.total }));
}

export type NextKind = 'start' | 'read' | 'code' | 'interview' | 'envelope' | 'exam' | 'company' | 'done';

export interface NextStep {
  title: string;
  /** one line on why this is the next step */
  detail: string;
  href: string;
  kind: NextKind;
  topic?: Topic;
  /** optional second action, e.g. revising a weak area */
  secondary?: { title: string; href: string };
}

export interface WeakHint {
  topic: Topic;
  /** section index inside the topic */
  index: number;
  heading: string;
}

export interface NextStepOptions {
  /** the learner's weakest section (from lib/weak), offered as a secondary action */
  weak?: WeakHint | null;
  /** company questions available / completed, for the "all passed" state */
  companyTotal?: number;
}

function hasAnyProgress(p: Progress): boolean {
  return (
    Object.values(p.sections).some((s) => s.length > 0) ||
    Object.keys(p.tests).length > 0 ||
    Object.keys(p.iq).length > 0 ||
    Object.keys(p.boe).length > 0 ||
    Object.keys(p.cc).length > 0
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function nextStep(p: Progress, topics: Topic[], opts: NextStepOptions = {}): NextStep {
  const step = primary(p, topics, opts);
  const weak = opts.weak;
  if (weak && step.kind !== 'start') {
    step.secondary = {
      title: `Revise weak area: ${weak.heading}`,
      href: `/topic/${weak.topic.id}?tab=learn&s=${weak.index}`,
    };
  }
  return step;
}

function primary(p: Progress, topics: Topic[], opts: NextStepOptions): NextStep {
  const first = topics[0];
  if (first && !hasAnyProgress(p)) {
    return {
      kind: 'start',
      title: `Start Phase 1: ${first.title}`,
      detail: 'Begin with the first lesson. Read each section, then tick "Read" so the app can guide you.',
      href: `/topic/${first.id}?tab=learn&s=0`,
      topic: first,
    };
  }

  const t = topics.find((x) => !passed(p, x.id));
  if (!t) {
    const done = Object.keys(p.company).length;
    const total = opts.companyTotal ?? 0;
    if (total > 0 && done < total) {
      return {
        kind: 'company',
        title: done ? `Continue the company track (${done}/${total} done)` : 'Start the company track',
        detail: 'Every topic exam is passed. Run timed mock interviews on real company questions.',
        href: '/companies',
      };
    }
    return {
      kind: 'done',
      title: 'Keep sharp: drill your weak areas',
      detail: 'You have finished the course. Re-practise missed questions and run more mocks.',
      href: '/weak-areas',
    };
  }

  const base = `/topic/${t.id}`;
  const read = new Set(p.sections[t.id] ?? []);
  const unread = t.sections.findIndex((_, i) => !read.has(i));
  if (unread >= 0) {
    return {
      kind: 'read',
      title: `Read §${unread + 1} ${t.sections[unread].heading}`,
      detail: `${t.title}: ${read.size}/${t.sections.length} sections read. Tick "Read" when you finish a section.`,
      href: `${base}?tab=learn&s=${unread}`,
      topic: t,
    };
  }
  const steps = topicSteps(p, t);
  const get = (id: StepId) => steps.find((s) => s.id === id);
  const code = get('code');
  if (code && !code.complete) {
    const left = code.total - code.done;
    return {
      kind: 'code',
      title: `Try the ${code.label} (${left} left)`,
      detail: `${t.title}: fix realistic code the way a senior engineer would, then compare with the reference.`,
      href: `${base}?tab=code`,
      topic: t,
    };
  }
  const iq = get('interview');
  if (iq && !iq.complete) {
    const left = iq.total - iq.done;
    return {
      kind: 'interview',
      title: `Practise interview questions (${left} left)`,
      detail: `${t.title}: answer out loud first, then compare with the model answer and rate yourself.`,
      href: `${base}?tab=interview`,
      topic: t,
    };
  }
  const boe = get('envelope');
  if (boe && !boe.complete) {
    return {
      kind: 'envelope',
      title: `Work through the estimation drills (${plural(boe.total - boe.done, 'drill')} left)`,
      detail: `${t.title}: back-of-the-envelope maths, revealed step by step.`,
      href: `${base}?tab=envelope`,
      topic: t,
    };
  }
  const rec = p.tests[t.id];
  return {
    kind: 'exam',
    title: rec ? `Retake the exam: best ${rec.best}%` : `Take the exam (pass mark ${p.settings.passMark}%)`,
    detail: `${t.title}: ${t.test.length} timed scenario questions. Passing it moves you to the next topic.`,
    href: `${base}?tab=exam`,
    topic: t,
  };
}
