// Achievements (GitHub-style milestone badges): pure data + pure evaluation. No React, no storage and
// only type imports, so the same code runs in the app and in plain-node checks.
//
// Every achievement is { id, name, description, group, art, tiers? | goal, measure, requirement, unit }.
//  - art: a glyph key resolved to a lucide icon by src/components/achievements/AchievementBadge.tsx
//  - tiers: bronze → silver → gold → diamond, each with a goal (a number, or a function of ctx for "all")
//  - goal: single-step badges (stored with tier 'standard')
//  - measure(progress, ctx) → number (the "34" in "34 / 50"); only reads what Progress really records
//  - requirement(goal, ctx, progress) → short text for a locked badge ("Pass 20 topic exams")
//
// ctx comes from buildAchievementContext(content): topic/phase/company lists precomputed once.
import type { Company, CompanyQuestion, Topic } from '../types';
import type { Phase } from './phases';
import type { Progress } from '../lib/progress';

export type Tier = 'bronze' | 'silver' | 'gold' | 'diamond';
/** 'standard' is the only step of a single-step badge */
export type TierStep = Tier | 'standard';

export const TIERS: Tier[] = ['bronze', 'silver', 'gold', 'diamond'];
export const TIER_LABEL: Record<TierStep, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', diamond: 'Diamond', standard: '' };
/** rank for comparisons; 'standard' ranks with bronze (it is the first and only step) */
export const tierRank = (tier: TierStep): number => (tier === 'standard' ? 0 : TIERS.indexOf(tier));

/** what progress.achievements stores per earned badge */
export interface StoredAchievement {
  /** highest tier reached */
  tier: TierStep;
  /** ms timestamp of the latest tier-up */
  earnedAt: number;
  /** when each tier was first reached */
  tiers?: Partial<Record<TierStep, number>>;
}
export type StoredAchievements = Record<string, StoredAchievement>;

export type GroupId = 'start' | 'content' | 'practice' | 'understanding' | 'consistency' | 'fun';

export const GROUPS: { id: GroupId; title: string; blurb: string }[] = [
  { id: 'start', title: 'Getting started', blurb: 'Your first requests through the system.' },
  { id: 'content', title: 'Topics & phases', blurb: 'Read the lessons and pass the exams, phase by phase.' },
  { id: 'practice', title: 'Practice', blurb: 'Code labs, estimation drills, interview questions and mocks.' },
  { id: 'understanding', title: 'Understanding', blurb: 'Get it right first time, and keep it right.' },
  { id: 'consistency', title: 'Consistency', blurb: 'High availability: show up day after day.' },
  { id: 'fun', title: 'Just for fun', blurb: 'Small surprises along the way.' },
];

export type ArtKey =
  | 'send'
  | 'check-badge'
  | 'calculator'
  | 'mic'
  | 'book'
  | 'scaling'
  | 'compass'
  | 'blocks'
  | 'network'
  | 'zap'
  | 'database'
  | 'waypoints'
  | 'workflow'
  | 'shield'
  | 'key'
  | 'server'
  | 'siren'
  | 'boxes'
  | 'puzzle'
  | 'list'
  | 'users'
  | 'crown'
  | 'code'
  | 'gauge'
  | 'briefcase'
  | 'mountain'
  | 'bug'
  | 'target'
  | 'rocket'
  | 'trophy'
  | 'heart'
  | 'activity'
  | 'moon'
  | 'rotate'
  | 'layers'
  | 'medal'
  | 'building'
  | 'messages';

export interface AchievementContext {
  topics: Topic[];
  /** phases that have at least one topic, in course order */
  phases: Phase[];
  phaseTopics: Record<string, Topic[]>;
  /** the Complete System Designs phase (case studies) */
  designTopics: Topic[];
  totals: { sections: number; cc: number; iq: number; boe: number; company: number };
  ccIds: string[];
  iqIds: string[];
  boeIds: string[];
  mcqIds: string[];
  expertMcqIds: string[];
  companyQuestionIds: string[];
  /** per company: its question ids (companies without questions left out) */
  companyBank: { company: Company; ids: string[] }[];
}

type Goal = number | ((ctx: AchievementContext, p?: Progress) => number);

export interface Achievement {
  id: string;
  name: string;
  description: string;
  group: GroupId;
  art: ArtKey;
  tiers?: { tier: Tier; goal: Goal }[];
  goal?: Goal;
  measure: (p: Progress, ctx: AchievementContext) => number;
  requirement: (goal: number, ctx: AchievementContext, p?: Progress) => string;
  /** what the measure counts, for "34 / 50 sections" */
  unit: string;
}

/** Precomputes the content-dependent lists every measure needs. */
export function buildAchievementContext({
  topics,
  phases,
  companies = [],
  companyQuestions = [],
}: {
  topics: Topic[];
  phases: Phase[];
  companies?: Company[];
  companyQuestions?: CompanyQuestion[];
}): AchievementContext {
  const phaseTopics: Record<string, Topic[]> = {};
  for (const t of topics) (phaseTopics[t.phase] ??= []).push(t);
  return {
    topics,
    phases: phases.filter((ph) => phaseTopics[ph.id]?.length),
    phaseTopics,
    designTopics: phaseTopics.designs ?? [],
    totals: {
      sections: topics.reduce((n, t) => n + t.sections.length, 0),
      cc: topics.reduce((n, t) => n + t.codeChallenges.length, 0),
      iq: topics.reduce((n, t) => n + t.interviewQuestions.length, 0),
      boe: topics.reduce((n, t) => n + t.envelopeQuestions.length, 0),
      company: companyQuestions.length,
    },
    ccIds: topics.flatMap((t) => t.codeChallenges.map((c) => c.id)),
    iqIds: topics.flatMap((t) => t.interviewQuestions.map((q) => q.id)),
    boeIds: topics.flatMap((t) => t.envelopeQuestions.map((q) => q.id)),
    mcqIds: topics.flatMap((t) => t.test.map((q) => q.id)),
    expertMcqIds: topics.flatMap((t) => t.test.filter((q) => q.difficulty === 'expert').map((q) => q.id)),
    companyQuestionIds: companyQuestions.map((q) => q.id),
    companyBank: companies
      .map((c) => ({ company: c, ids: companyQuestions.filter((q) => q.company === c.id).map((q) => q.id) }))
      .filter((c) => c.ids.length > 0),
  };
}

// ---------- measuring helpers (all read the real Progress shape; old saves may lack any bucket) ----------
const passed = (p: Progress, id: string) => !!p.tests?.[id]?.passedAt;
const passedIn = (p: Progress, list: Topic[]) => list.filter((t) => passed(p, t.id)).length;
const countIn = (bucket: Record<string, unknown> | undefined, ids: string[]) => (bucket ? ids.filter((id) => bucket[id]).length : 0);
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function sectionsRead(p: Progress, ctx: AchievementContext): number {
  let n = 0;
  for (const t of ctx.topics) {
    const read = p.sections?.[t.id];
    if (read) n += new Set(read.filter((i) => i >= 0 && i < t.sections.length)).size;
  }
  return n;
}

/**
 * Every part of a topic done: all sections read, every lab, interview question and drill, and the exam passed.
 * Parts a topic doesn't have count as done (the behavioural topics have no estimation drills).
 */
function topicFullyDone(p: Progress, t: Topic): boolean {
  const read = new Set(p.sections?.[t.id] ?? []);
  return (
    passed(p, t.id) &&
    t.sections.every((_, i) => read.has(i)) &&
    t.codeChallenges.every((c) => p.cc?.[c.id]) &&
    t.interviewQuestions.every((q) => p.iq?.[q.id]) &&
    t.envelopeQuestions.every((q) => p.boe?.[q.id])
  );
}

/** exam passed on its first full attempt (needs the attempt history, except for a single attempt) */
function passedFirstTry(p: Progress, t: Topic): boolean {
  const r = p.tests?.[t.id];
  if (!r?.passedAt) return false;
  if (r.attempts === 1) return true;
  const hist = r.history ?? [];
  // history keeps the last 10 attempts: earlier (possibly failed) ones may have dropped off
  if (!hist.length || r.attempts > hist.length) return false;
  return !hist.some((h) => h.at < r.passedAt!);
}

/** failed full attempts recorded before the exam was first passed */
function failsBeforePass(p: Progress, t: Topic): number {
  const r = p.tests?.[t.id];
  if (!r?.passedAt) return 0;
  return (r.history ?? []).filter((h) => h.at < r.passedAt!).length;
}

/** longest run of consecutive local days in activityDays (YYYY-MM-DD) */
export function longestStreak(days: string[] | undefined): number {
  const sorted = [...new Set(days ?? [])].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const dayNo = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, dd) / 86_400_000);
  };
  let best = 0;
  let run = 0;
  let prev = NaN;
  for (const d of sorted) {
    const n = dayNo(d);
    run = n === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = n;
  }
  return best;
}

const lateNight = (iso: string | undefined) => {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getHours() < 4;
};

/** The company whose mock list is closest to done (completed ones win, then by share done, then smaller list). */
function bestCompany(p: Progress, ctx: AchievementContext) {
  let best: { company: Company; done: number; total: number } | null = null;
  const score = (r: { done: number; total: number }) => (r.done === r.total ? 2 : 0) + r.done / r.total;
  for (const c of ctx.companyBank) {
    const row = { company: c.company, done: countIn(p.company, c.ids), total: c.ids.length };
    if (!best || score(row) > score(best) || (score(row) === score(best) && row.total < best.total)) best = row;
  }
  return best;
}

// ---------- phase graduates: pass every exam in a phase ----------
const PHASE_BADGES: { phase: string; name: string; art: ArtKey; about: string }[] = [
  { phase: 'fundamentals', name: 'Foundation Laid', art: 'blocks', about: 'requirements, estimation and the vocabulary of scale' },
  { phase: 'networking', name: 'Load Balancer', art: 'network', about: 'networking and traffic' },
  { phase: 'caching', name: 'Cache Hit', art: 'zap', about: 'caching and CDNs' },
  { phase: 'databases', name: 'Shard Master', art: 'database', about: 'databases, replication and sharding' },
  { phase: 'distributed', name: 'CAP Navigator', art: 'waypoints', about: 'distributed systems: consistency and consensus' },
  { phase: 'messaging', name: 'Exactly Once', art: 'workflow', about: 'messaging and data pipelines' },
  { phase: 'reliability', name: 'Five Nines', art: 'shield', about: 'reliability and resilience' },
  { phase: 'apis-security', name: 'Gatekeeper', art: 'key', about: 'APIs and security' },
  { phase: 'platform', name: 'Control Plane', art: 'server', about: 'platform and operations' },
  { phase: 'production', name: 'Incident Commander', art: 'siren', about: 'production problem → solution scenarios' },
  { phase: 'designs', name: 'Chief Architect', art: 'boxes', about: 'complete system design case studies' },
  { phase: 'lld', name: 'Class Act', art: 'puzzle', about: 'low-level design and machine coding' },
  { phase: 'miscellaneous', name: 'Rapid Fire', art: 'list', about: 'the miscellaneous interview question bank' },
  { phase: 'behavioral', name: 'Bar Raiser', art: 'users', about: 'the behavioural and hiring-manager round' },
];

const phaseOf = (ctx: AchievementContext, id: string) => ctx.phases.find((ph) => ph.id === id);

const phaseGraduate = ({ phase, name, art, about }: (typeof PHASE_BADGES)[number]): Achievement => ({
  id: `phase-${phase}`,
  name,
  description: `Passed every exam in the phase on ${about}.`,
  group: 'content',
  art,
  goal: (ctx) => ctx.phaseTopics[phase]?.length || 1,
  measure: (p, ctx) => passedIn(p, ctx.phaseTopics[phase] ?? []),
  requirement: (goal, ctx) => {
    const ph = phaseOf(ctx, phase);
    return `Pass all ${plural(goal, 'exam')} in ${ph ? `Phase ${ph.number}, ${ph.title}` : 'this phase'}`;
  },
  unit: 'exams',
});

export const ACHIEVEMENTS: Achievement[] = [
  // ---- getting started ----
  {
    id: 'first-request',
    name: 'First Request',
    description: 'Read your first Learn section.',
    group: 'start',
    art: 'send',
    goal: 1,
    measure: sectionsRead,
    requirement: () => 'Mark any Learn section as read',
    unit: 'sections',
  },
  {
    id: 'status-200',
    name: '200 OK',
    description: 'Passed your first topic exam.',
    group: 'start',
    art: 'check-badge',
    goal: 1,
    measure: (p, ctx) => passedIn(p, ctx.topics),
    requirement: () => 'Pass any topic exam',
    unit: 'exams',
  },
  {
    id: 'napkin-math',
    name: 'Napkin Math',
    description: 'Worked through your first back-of-the-envelope drill.',
    group: 'start',
    art: 'calculator',
    goal: 1,
    measure: (p, ctx) => countIn(p.boe, ctx.boeIds),
    requirement: () => 'Complete any back-of-the-envelope drill',
    unit: 'drills',
  },
  {
    id: 'mic-check',
    name: 'Mic Check',
    description: 'Answered and rated your first interview question.',
    group: 'start',
    art: 'mic',
    goal: 1,
    measure: (p, ctx) => countIn(p.iq, ctx.iqIds),
    requirement: () => 'Rate yourself on any interview question',
    unit: 'rated',
  },

  // ---- topics & phases ----
  {
    id: 'read-replica',
    name: 'Read Replica',
    description: 'Learn sections read.',
    group: 'content',
    art: 'book',
    tiers: [
      { tier: 'bronze', goal: 10 },
      { tier: 'silver', goal: 100 },
      { tier: 'gold', goal: 400 },
      { tier: 'diamond', goal: (ctx) => ctx.totals.sections },
    ],
    measure: sectionsRead,
    requirement: (goal) => `Read ${plural(goal, 'Learn section')}`,
    unit: 'sections',
  },
  {
    id: 'horizontal-scaler',
    name: 'Horizontal Scaler',
    description: 'Topic exams passed. Scale out one exam at a time.',
    group: 'content',
    art: 'scaling',
    tiers: [
      { tier: 'bronze', goal: 5 },
      { tier: 'silver', goal: 20 },
      { tier: 'gold', goal: 50 },
      { tier: 'diamond', goal: (ctx) => ctx.topics.length },
    ],
    measure: (p, ctx) => passedIn(p, ctx.topics),
    requirement: (goal) => `Pass ${plural(goal, 'topic exam')}`,
    unit: 'exams',
  },
  {
    id: 'case-studies',
    name: 'Whiteboard Hero',
    description: 'Complete-system-design case studies passed.',
    group: 'content',
    art: 'compass',
    tiers: [
      { tier: 'bronze', goal: 1 },
      { tier: 'silver', goal: 4 },
      { tier: 'gold', goal: 8 },
    ],
    measure: (p, ctx) => passedIn(p, ctx.designTopics),
    requirement: (goal) => `Pass ${plural(goal, 'case-study exam')} in Complete System Designs`,
    unit: 'case studies',
  },
  ...PHASE_BADGES.map(phaseGraduate),
  {
    id: 'principal-engineer',
    name: 'Principal Engineer',
    description: 'Every topic 100% complete: sections, labs, questions, drills and exam.',
    group: 'content',
    art: 'crown',
    goal: (ctx) => ctx.topics.length,
    measure: (p, ctx) => ctx.topics.filter((t) => topicFullyDone(p, t)).length,
    requirement: (goal) => `Bring all ${goal} topics to 100% complete`,
    unit: 'topics',
  },

  // ---- practice ----
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Code and answer labs completed.',
    group: 'practice',
    art: 'code',
    tiers: [
      { tier: 'bronze', goal: 5 },
      { tier: 'silver', goal: 25 },
      { tier: 'gold', goal: 80 },
      { tier: 'diamond', goal: (ctx) => ctx.totals.cc },
    ],
    measure: (p, ctx) => countIn(p.cc, ctx.ccIds),
    requirement: (goal) => `Complete ${plural(goal, 'code lab')}`,
    unit: 'labs',
  },
  {
    id: 'capacity-planner',
    name: 'Capacity Planner',
    description: 'Back-of-the-envelope drills worked through.',
    group: 'practice',
    art: 'gauge',
    tiers: [
      { tier: 'bronze', goal: 5 },
      { tier: 'silver', goal: 25 },
      { tier: 'gold', goal: 100 },
      { tier: 'diamond', goal: (ctx) => ctx.totals.boe },
    ],
    measure: (p, ctx) => countIn(p.boe, ctx.boeIds),
    requirement: (goal) => `Complete ${plural(goal, 'estimation drill')}`,
    unit: 'drills',
  },
  {
    id: 'whiteboard-warrior',
    name: 'Whiteboard Warrior',
    description: 'Interview questions answered and self-rated.',
    group: 'practice',
    art: 'messages',
    tiers: [
      { tier: 'bronze', goal: 10 },
      { tier: 'silver', goal: 100 },
      { tier: 'gold', goal: 300 },
      { tier: 'diamond', goal: (ctx) => ctx.totals.iq },
    ],
    measure: (p, ctx) => countIn(p.iq, ctx.iqIds),
    requirement: (goal) => `Answer and rate ${plural(goal, 'interview question')}`,
    unit: 'rated',
  },
  {
    id: 'on-site-loop',
    name: 'On-site Loop',
    description: 'Company mock interviews completed.',
    group: 'practice',
    art: 'briefcase',
    tiers: [
      { tier: 'bronze', goal: 1 },
      { tier: 'silver', goal: 12 },
      { tier: 'gold', goal: (ctx) => ctx.totals.company },
    ],
    measure: (p, ctx) => countIn(p.company, ctx.companyQuestionIds),
    requirement: (goal) => (goal === 1 ? 'Complete a company mock interview' : `Complete ${goal} company mock interviews`),
    unit: 'mocks',
  },
  {
    id: 'expert-mode',
    name: 'Expert Mode',
    description: 'Expert-level exam questions answered right (latest answer).',
    group: 'practice',
    art: 'mountain',
    tiers: [
      { tier: 'bronze', goal: 10 },
      { tier: 'silver', goal: 100 },
      { tier: 'gold', goal: (ctx) => ctx.expertMcqIds.length },
    ],
    measure: (p, ctx) => ctx.expertMcqIds.filter((id) => p.mcq?.[id]?.lastCorrect).length,
    requirement: (goal) => `Answer ${goal} expert-level exam questions correctly`,
    unit: 'correct',
  },
  {
    id: 'postmortem',
    name: 'Postmortem',
    description: 'Exam questions you got wrong once, then fixed.',
    group: 'practice',
    art: 'bug',
    tiers: [
      { tier: 'bronze', goal: 5 },
      { tier: 'silver', goal: 25 },
      { tier: 'gold', goal: 100 },
    ],
    measure: (p, ctx) => ctx.mcqIds.filter((id) => (p.mcq?.[id]?.wrong ?? 0) > 0 && p.mcq?.[id]?.lastCorrect).length,
    requirement: (goal) => `Fix ${plural(goal, 'exam question')} you once got wrong`,
    unit: 'fixed',
  },

  // ---- understanding ----
  {
    id: 'cache-warm',
    name: 'Warm Cache',
    description: 'Exam questions answered right every time you have seen them.',
    group: 'understanding',
    art: 'target',
    tiers: [
      { tier: 'bronze', goal: 25 },
      { tier: 'silver', goal: 150 },
      { tier: 'gold', goal: 500 },
      { tier: 'diamond', goal: 1000 },
    ],
    measure: (p, ctx) => ctx.mcqIds.filter((id) => (p.mcq?.[id]?.seen ?? 0) > 0 && p.mcq[id].wrong === 0).length,
    requirement: (goal) => `Get ${goal} exam questions right with no misses`,
    unit: 'never missed',
  },
  {
    id: 'happy-path',
    name: 'Happy Path',
    description: 'Topic exams passed on the first attempt.',
    group: 'understanding',
    art: 'rocket',
    tiers: [
      { tier: 'bronze', goal: 1 },
      { tier: 'silver', goal: 10 },
      { tier: 'gold', goal: 40 },
    ],
    measure: (p, ctx) => ctx.topics.filter((t) => passedFirstTry(p, t)).length,
    requirement: (goal) => (goal === 1 ? 'Pass a topic exam on your first attempt' : `Pass ${goal} topic exams on the first attempt`),
    unit: 'first-try passes',
  },
  {
    id: 'zero-downtime',
    name: 'Zero Downtime',
    description: 'Topic exams with a perfect 100% score.',
    group: 'understanding',
    art: 'trophy',
    tiers: [
      { tier: 'bronze', goal: 1 },
      { tier: 'silver', goal: 5 },
      { tier: 'gold', goal: 20 },
    ],
    measure: (p, ctx) => ctx.topics.filter((t) => (p.tests?.[t.id]?.best ?? 0) >= 100).length,
    requirement: (goal) => (goal === 1 ? 'Score 100% on a topic exam' : `Score 100% on ${goal} topic exams`),
    unit: 'perfect scores',
  },
  {
    id: 'strong-hire',
    name: 'Strong Hire',
    description: 'Interview questions you rated "nailed it".',
    group: 'understanding',
    art: 'medal',
    tiers: [
      { tier: 'bronze', goal: 10 },
      { tier: 'silver', goal: 50 },
      { tier: 'gold', goal: 200 },
    ],
    measure: (p, ctx) => ctx.iqIds.filter((id) => p.iq?.[id] === 'nailed').length,
    requirement: (goal) => `Rate ${goal} interview answers as nailed`,
    unit: 'nailed',
  },

  // ---- consistency ----
  {
    id: 'heartbeat',
    name: 'Heartbeat',
    description: 'Days studied in a row (your longest streak).',
    group: 'consistency',
    art: 'heart',
    tiers: [
      { tier: 'bronze', goal: 3 },
      { tier: 'silver', goal: 7 },
      { tier: 'gold', goal: 30 },
      { tier: 'diamond', goal: 100 },
    ],
    measure: (p) => longestStreak(p.activityDays),
    requirement: (goal) => `Study ${goal} days in a row`,
    unit: 'days',
  },
  {
    id: 'high-availability',
    name: 'High Availability',
    description: 'Total days with any study activity.',
    group: 'consistency',
    art: 'activity',
    tiers: [
      { tier: 'bronze', goal: 10 },
      { tier: 'silver', goal: 30 },
      { tier: 'gold', goal: 90 },
    ],
    // activityDays keeps the latest 120 days, so the gold goal stays reachable
    measure: (p) => new Set(p.activityDays ?? []).size,
    requirement: (goal) => `Study on ${goal} different days`,
    unit: 'days',
  },

  // ---- fun ----
  {
    id: 'on-call',
    name: 'On-Call',
    description: 'Sat an exam or answered exam questions between midnight and 4 am.',
    group: 'fun',
    art: 'moon',
    goal: 1,
    measure: (p, ctx) => {
      let n = 0;
      for (const t of ctx.topics) n += (p.tests?.[t.id]?.history ?? []).filter((h) => lateNight(h.at)).length;
      for (const id of ctx.mcqIds) if (lateNight(p.mcq?.[id]?.lastAt)) n++;
      return n;
    },
    requirement: () => 'Answer exam questions between 00:00 and 03:59',
    unit: 'late answers',
  },
  {
    id: 'retry-backoff',
    name: 'Retry with Backoff',
    description: 'Passed an exam after two or more failed attempts.',
    group: 'fun',
    art: 'rotate',
    goal: 1,
    measure: (p, ctx) => ctx.topics.filter((t) => failsBeforePass(p, t) >= 2).length,
    requirement: () => 'Pass an exam after 2+ failed attempts at it',
    unit: 'comebacks',
  },
  {
    id: 'full-stack',
    name: 'Full Stack',
    description: 'Passed at least one exam in every phase.',
    group: 'fun',
    art: 'layers',
    goal: (ctx) => ctx.phases.length || 1,
    measure: (p, ctx) => ctx.phases.filter((ph) => passedIn(p, ctx.phaseTopics[ph.id]) > 0).length,
    requirement: (goal) => `Pass an exam in each of the ${goal} phases`,
    unit: 'phases',
  },
  {
    id: 'dream-company',
    name: 'Dream Company',
    description: "Completed every mock interview on one company's list.",
    group: 'fun',
    art: 'building',
    // progress shows the company you are closest to finishing
    goal: (ctx, p) => (p ? bestCompany(p, ctx)?.total : null) || Math.min(...ctx.companyBank.map((c) => c.ids.length), Infinity) || 1,
    measure: (p, ctx) => bestCompany(p, ctx)?.done ?? 0,
    requirement: (_goal, ctx, p) => {
      const b = p && bestCompany(p, ctx);
      return b && b.done > 0 ? `Complete all ${b.total} ${b.company.name} mock interviews` : "Complete every mock interview on one company's list";
    },
    unit: 'mocks',
  },
];

export const achievementById: Record<string, Achievement> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

const resolve = (goal: Goal | undefined, ctx: AchievementContext, p?: Progress): number =>
  typeof goal === 'function' ? goal(ctx, p) : (goal ?? 1);

export interface LadderStep {
  tier: TierStep;
  goal: number;
}

/** The tier ladder of one achievement with goals resolved. */
export function tierLadder(a: Achievement, ctx: AchievementContext, p?: Progress): LadderStep[] {
  if (a.tiers) {
    const out: LadderStep[] = [];
    for (const t of a.tiers) {
      const goal = resolve(t.goal, ctx, p);
      // a content-sized goal ("all") never sits at or below an earlier fixed step
      if (!out.length || goal > out[out.length - 1].goal) out.push({ tier: t.tier, goal });
    }
    return out;
  }
  return [{ tier: 'standard', goal: resolve(a.goal, ctx, p) }];
}

export interface Evaluation {
  id: string;
  value: number;
  tiers: (LadderStep & { reached: boolean })[];
  /** highest tier reached, or null */
  tier: TierStep | null;
  /** next step to reach, or null when maxed */
  next: LadderStep | null;
  /** 0–1 toward next */
  fraction: number;
  requirement: string;
}

export function evaluateAchievement(a: Achievement, p: Progress, ctx: AchievementContext): Evaluation {
  const value = a.measure(p, ctx) || 0;
  const ladder = tierLadder(a, ctx, p).map((t) => ({ ...t, reached: value >= t.goal }));
  const reached = ladder.filter((t) => t.reached);
  const top = reached[reached.length - 1] ?? null;
  const next = ladder.find((t) => !t.reached) ?? null;
  return {
    id: a.id,
    value,
    tiers: ladder,
    tier: top?.tier ?? null,
    next: next ? { tier: next.tier, goal: next.goal } : null,
    fraction: next ? Math.min(1, value / next.goal) : 1,
    requirement: a.requirement((next ?? ladder[ladder.length - 1]).goal, ctx, p),
  };
}

export type Evaluations = Record<string, Evaluation>;

export function evaluateAll(p: Progress, ctx: AchievementContext): Evaluations {
  const out: Evaluations = {};
  for (const a of ACHIEVEMENTS) out[a.id] = evaluateAchievement(a, p, ctx);
  return out;
}

export interface NewlyEarned {
  id: string;
  /** the highest tier now reached */
  tier: TierStep;
  /** every tier newly reached (a jump from nothing to gold lists bronze, silver and gold) */
  tiers: TierStep[];
}

/** What is earned now but not yet stored. Stored tiers are never revoked, re-awarded or downgraded. */
export function newlyEarned(evaluations: Evaluations, stored: StoredAchievements = {}): NewlyEarned[] {
  const out: NewlyEarned[] = [];
  for (const a of ACHIEVEMENTS) {
    const ev = evaluations[a.id];
    if (!ev?.tier) continue;
    const have = stored[a.id];
    const haveRank = have?.tier ? tierRank(have.tier) : -1;
    if (tierRank(ev.tier) <= haveRank) continue;
    const fresh = ev.tiers.filter((t) => t.reached && tierRank(t.tier) > haveRank).map((t) => t.tier);
    out.push({ id: a.id, tier: ev.tier, tiers: fresh });
  }
  return out;
}

/** Merge newly earned badges into the stored map (never downgrades). Pure: returns a new map. */
export function mergeEarned(stored: StoredAchievements = {}, earned: NewlyEarned[], at: number): StoredAchievements {
  const next = { ...stored };
  for (const e of earned) {
    const prev = next[e.id];
    if (prev?.tier && tierRank(prev.tier) >= tierRank(e.tier)) continue;
    const tiers = { ...(prev?.tiers ?? {}) };
    for (const t of e.tiers.length ? e.tiers : [e.tier]) if (!tiers[t]) tiers[t] = at;
    next[e.id] = { tier: e.tier, earnedAt: at, tiers };
  }
  return next;
}

export interface EarnedEntry extends StoredAchievement {
  id: string;
  achievement: Achievement;
}

/** Stored entries as a list of earned badges, most recent first (unknown ids are ignored). */
export function earnedList(stored: StoredAchievements = {}): EarnedEntry[] {
  return Object.entries(stored)
    .filter(([id, s]) => achievementById[id] && s?.tier)
    .map(([id, s]) => ({ ...s, id, achievement: achievementById[id] }))
    .sort((a, b) => (b.earnedAt || 0) - (a.earnedAt || 0));
}

/**
 * The next step still to earn, above whatever is already stored. Stored tiers are kept even if the progress
 * behind them is undone later, so a badge earned before is never shown as "0 / 1" again.
 */
export function nextToEarn(ev: Evaluation, stored?: StoredAchievement): LadderStep | null {
  const have = stored?.tier ? tierRank(stored.tier) : -1;
  const step = ev.tiers.find((t) => !t.reached && tierRank(t.tier) > have);
  return step ? { tier: step.tier, goal: step.goal } : null;
}

/** The locked or still-climbing badge closest to its next step (highest fraction, ties → smaller gap). */
export function closestNext(evaluations: Evaluations, stored: StoredAchievements = {}): { achievement: Achievement; ev: Evaluation; gap: number } | null {
  let best: { achievement: Achievement; ev: Evaluation; gap: number } | null = null;
  for (const a of ACHIEVEMENTS) {
    const ev = evaluations[a.id];
    // only badges whose next step is not already stored (ev.next/requirement describe that step)
    if (!ev?.next || nextToEarn(ev, stored[a.id])?.tier !== ev.next.tier) continue;
    const gap = ev.next.goal - ev.value;
    if (!best || ev.fraction > best.ev.fraction || (ev.fraction === best.ev.fraction && gap < best.gap)) best = { achievement: a, ev, gap };
  }
  return best;
}
