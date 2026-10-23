// Pure data + scoring for the STAR(L) story builder. Fragments come from the topic's weak vs
// strong table for "Tell me about a time you improved a system's performance", its "I" vs "we"
// table and its quantifying-impact rules. assess() turns a set of choices into the signals an
// interviewer would write down. No React here so the scoring can be checked with Node.
import type { BaseFrame } from '../../core';

export type Slot = 'S' | 'T' | 'A' | 'R' | 'L';
export const SLOTS: { id: Slot; name: string; budget: string }[] = [
  { id: 'S', name: 'Situation', budget: 'S + T together ≈ 30–40 s' },
  { id: 'T', name: 'Task', budget: 'your stake, in one line' },
  { id: 'A', name: 'Action', budget: '≈ 90–120 s, half the answer' },
  { id: 'R', name: 'Result', budget: 'R + L together ≈ 30–45 s' },
  { id: 'L', name: 'Learning', budget: 'the L in STARL' },
];

export interface Fragment {
  id: string;
  slot: Slot;
  text: string;
  /** spoken seconds, roughly */
  secs: number;
  i?: boolean;
  we?: boolean;
  metric?: boolean;
  customer?: boolean;
  notTaken?: boolean;
  ownsTarget?: boolean;
  vague?: boolean;
  inflated?: boolean;
  fakePrecision?: boolean;
  learning?: 'concrete' | 'platitude';
  note: string;
}

export const FRAGMENTS: Fragment[] = [
  // Situation
  { id: 's-ramble', slot: 'S', secs: 90, vague: true, we: true, text: 'We had a big monolith with lots of APIs and performance issues, and the team was very busy with other things, and there was a sale coming up, and…', note: '90 seconds of context with no number and no stakes: the interviewer is still waiting for the problem.' },
  { id: 's-generic', slot: 'S', secs: 10, customer: true, text: 'Our order API was slow during sales and customers complained.', note: 'Short and names the customer, but no baseline number to measure the result against.' },
  { id: 's-strong', slot: 'S', secs: 20, metric: true, customer: true, text: 'Our order-history GraphQL API in a NestJS service had a p99 of 2.4 s during sale events, and support tickets about “orders not loading” tripled.', note: 'Specific system, a baseline (p99 2.4 s) and the user pain (tickets tripled) in two lines.' },
  // Task
  { id: 't-asked', slot: 'T', secs: 5, text: 'I was asked to fix it.', note: 'Passive: says nothing about ownership or what “fixed” means.' },
  { id: 't-team', slot: 'T', secs: 5, we: true, text: 'The team decided we should look into it.', note: '“The team decided” hides your judgment and your role.' },
  { id: 't-strong', slot: 'T', secs: 15, i: true, ownsTarget: true, metric: true, text: 'I owned the read path for that service and committed to getting p99 under 500 ms before the next sale, 5 weeks away.', note: 'Your stake, a measurable target and a deadline.' },
  // Action
  { id: 'a-we', slot: 'A', secs: 10, we: true, vague: true, text: 'We added caching and optimised queries.', note: 'Ten seconds of Action, all “we”, no decisions: the interviewer will ask “what did YOU do?”.' },
  { id: 'a-inflated', slot: 'A', secs: 40, i: true, inflated: true, text: 'I built the whole performance platform and rewrote the service single-handedly over a weekend.', note: 'Implausible and reads as credit-taking; the follow-up “who else worked on it?” will hurt.' },
  {
    id: 'a-strong',
    slot: 'A',
    secs: 105,
    i: true,
    metric: true,
    notTaken: true,
    text: 'I traced it and found an N+1 on line items (up to 60 queries per request). I introduced DataLoader batching, added a composite index on (user_id, created_at) and a 60 s Redis cache on the summary. I chose not to cache line-item status, because stale status caused tickets. I load-tested at 3× sale traffic before rollout.',
    note: 'Specific verbs, all “I”, evidence, and one decision NOT taken: that is the judgment signal.',
  },
  // Result
  { id: 'r-vague', slot: 'R', secs: 5, vague: true, text: 'It became much faster and everyone was happy.', note: 'No number: “I think it went well” is not evidence.' },
  { id: 'r-fake', slot: 'R', secs: 5, metric: true, fakePrecision: true, text: 'Latency dropped by exactly 87.43%.', note: 'Invented precision with no baseline or measurement: it folds at “how did you measure that?”.' },
  { id: 'r-strong', slot: 'R', secs: 20, metric: true, customer: true, text: 'p99 went 2.4 s → 380 ms, DB CPU 75% → 30% at peak, and “orders not loading” tickets fell about 80% in the next sale.', note: 'Baseline → after, how it was measured, and the so-what for users.' },
  // Learning
  { id: 'l-none', slot: 'L', secs: 0, text: '(no learning: the answer just stops)', note: 'Without an L the story ends on a result; fine for STAR, a missed signal for STARL.' },
  { id: 'l-platitude', slot: 'L', secs: 5, learning: 'platitude', text: 'I learned that performance is really important.', note: 'A platitude: nothing changed in how you work.' },
  { id: 'l-strong', slot: 'L', secs: 10, learning: 'concrete', i: true, text: 'Since then, I add query-count assertions to integration tests for every new resolver.', note: 'A concrete, repeatable change in behaviour.' },
];

export type Choices = Partial<Record<Slot, string>>;

export interface Signal {
  name: string;
  level: 0 | 1 | 2;
  why: string;
}

export interface Assessment {
  signals: Signal[];
  seconds: { st: number; a: number; rl: number; total: number };
  score: number; // 0..100
  verdict: string;
}

export const byId = (id?: string) => FRAGMENTS.find((f) => f.id === id);

export function assess(c: Choices): Assessment {
  const pick = (s: Slot) => byId(c[s]);
  const parts = SLOTS.map((s) => pick(s.id)).filter((x): x is Fragment => !!x);
  const S = pick('S');
  const T = pick('T');
  const A = pick('A');
  const R = pick('R');
  const L = pick('L');
  const secs = (fs: (Fragment | undefined)[]) => fs.reduce((a, f) => a + (f?.secs ?? 0), 0);
  const st = secs([S, T]);
  const a = secs([A]);
  const rl = secs([R, L]);

  const sig: Signal[] = [];
  // Ownership: "I" for every verb in Action, plus a stake in Task
  const own: 0 | 1 | 2 = A?.inflated ? 1 : A?.i && T?.ownsTarget ? 2 : A?.i || T?.ownsTarget ? 1 : 0;
  sig.push({
    name: 'Ownership (“I”)',
    level: own,
    why: A?.inflated ? '“I” everywhere, but implausibly so' : own === 2 ? 'your stake and every action verb is “I”' : A?.we || T?.we ? '“we” hides what you did' : 'your part is unclear',
  });
  // Impact: baseline and after
  const impact: 0 | 1 | 2 = R?.fakePrecision ? 0 : R?.metric && S?.metric ? 2 : R?.metric ? 1 : 0;
  sig.push({
    name: 'Impact with data',
    level: impact,
    why: R?.fakePrecision ? 'a number you cannot defend is worse than none' : impact === 2 ? 'baseline → after, measured' : R?.metric ? 'a result number without a baseline' : 'no result number',
  });
  // Judgment
  const judgment: 0 | 1 | 2 = A?.notTaken ? 2 : A && !A.vague ? 1 : 0;
  sig.push({ name: 'Judgment', level: judgment, why: A?.notTaken ? 'names a decision NOT taken, and why' : 'no trade-off or alternative mentioned' });
  // Customer focus
  const cust = parts.filter((f) => f.customer).length;
  sig.push({ name: 'Customer focus', level: cust >= 2 ? 2 : cust ? 1 : 0, why: cust >= 2 ? 'user pain at the start and the end' : cust ? 'user pain mentioned once' : 'pure tech-for-tech' });
  // Learning
  sig.push({
    name: 'Learning',
    level: L?.learning === 'concrete' ? 2 : L?.learning === 'platitude' ? 1 : 0,
    why: L?.learning === 'concrete' ? 'a changed practice' : L?.learning === 'platitude' ? 'a platitude, not a change' : 'missing',
  });
  // Communication: the time budget
  const total = st + a + rl;
  let comm: 0 | 1 | 2 = 2;
  const notes: string[] = [];
  if (st > 45) {
    comm = 0;
    notes.push(`set-up ${st} s (aim 30–40)`);
  }
  if (A && a < 60) {
    comm = Math.min(comm, 1) as 0 | 1;
    notes.push(`Action only ${a} s (aim 90–120)`);
  }
  if (R && rl > 60) {
    comm = Math.min(comm, 1) as 0 | 1;
    notes.push('long close');
  }
  sig.push({ name: 'Communication', level: comm, why: notes.length ? notes.join('; ') : `≈${Math.round(total / 6) / 10} min, half of it on Action` });

  const credibilityHit = A?.inflated || R?.fakePrecision;
  const raw = sig.reduce((x, s) => x + s.level, 0);
  const score = Math.max(0, Math.round((raw / (sig.length * 2)) * 100) - (credibilityHit ? 15 : 0));
  const verdict =
    parts.length < 5
      ? `${5 - parts.length} part(s) still empty.`
      : score >= 85
        ? 'Strong: every signal box has evidence the interviewer can write down.'
        : score >= 55
          ? 'Mixed: some boxes filled; expect “what exactly did you do?” and “how did you measure it?”.'
          : 'Weak: the story is pleasant but fills almost no boxes.';
  return { signals: sig, seconds: { st, a, rl, total }, score, verdict };
}

export interface Frame extends BaseFrame {
  slot: Slot | 'debrief';
}

/** steps are fixed (S, T, A, R, L, debrief); captions are filled in from the learner's choices */
export const STEPS: Frame[] = [
  ...SLOTS.map((s) => ({ slot: s.id, caption: `${s.name}: ${s.budget}.` })),
  { slot: 'debrief' as const, caption: 'Debrief.' },
];
