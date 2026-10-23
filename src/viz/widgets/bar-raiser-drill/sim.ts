// Pure data + scoring for the Bar Raiser follow-up drill. The story is the topic's Dive Deep
// answer lab (order-history p99 2.4 s → stale planner statistics); the probes follow its ladder:
// "what did YOU do?" → "how did you know?" → "what else did you consider?" → "who disagreed?"
// → "what would you do differently?". Each answer adds evidence to (or erodes) the LPs the
// interviewer is assigned. No React here so the scoring can be checked with Node.
import type { BaseFrame } from '../../core';

export type LP = 'Dive Deep' | 'Ownership' | 'Earn Trust' | 'Are Right, A Lot';
export const LPS: LP[] = ['Dive Deep', 'Ownership', 'Earn Trust', 'Are Right, A Lot'];

export interface Answer {
  id: string;
  text: string;
  /** what the interviewer writes in their notes */
  note: string;
  /** evidence added (+) or eroded (−) per LP */
  lp: Partial<Record<LP, number>>;
  /** how much of the story still stands after this answer (0..100 change) */
  standing: number;
  kind: 'strong' | 'rehearsed' | 'flag';
}

export interface Probe {
  level: string;
  question: string;
  answers: Answer[];
}

export const PROBES: Probe[] = [
  {
    level: 'Opening',
    question: 'Tell me about a time you had to dig into a problem to find its root cause.',
    answers: [
      {
        id: 'o-we',
        kind: 'flag',
        text: 'We had latency issues in our order service, figured out it was the database, added indexes and Redis caching, and it improved a lot.',
        note: '“We” throughout, no numbers. Insufficient data.',
        lp: { 'Dive Deep': -1, Ownership: -1 },
        standing: -25,
      },
      {
        id: 'o-strong',
        kind: 'strong',
        text: 'Our order-history API (~2K RPS) went from 120 ms to 2.4 s p99 over three days with no deploy. I was on-call and owned the service, so finding the root cause was mine.',
        note: 'Specific symptom, scale and personal stake.',
        lp: { 'Dive Deep': 1, Ownership: 1 },
        standing: 0,
      },
      {
        id: 'o-generic',
        kind: 'rehearsed',
        text: 'Usually when there’s an incident I look at the dashboards, find the bottleneck and fix it. I’m very data-driven.',
        note: 'Hypothetical (“usually I…”), self-graded. No specific event.',
        lp: { 'Dive Deep': -1 },
        standing: -20,
      },
    ],
  },
  {
    level: 'L1 · Ownership',
    question: 'What exactly did YOU do?',
    answers: [
      {
        id: 'l1-strong',
        kind: 'strong',
        text: 'I ruled out capacity first: no deploy, CPU at 35%, pool not saturated. Then pg_stat_statements showed one query went from 3% to 64% of DB time.',
        note: 'Candidate ruled out capacity, isolated the query with pg_stat_statements.',
        lp: { 'Dive Deep': 1, Ownership: 1 },
        standing: 0,
      },
      {
        id: 'l1-we',
        kind: 'rehearsed',
        text: 'It was really a team effort; we all looked at different things and the DBA helped a lot.',
        note: 'Cannot attribute any action to the candidate.',
        lp: { Ownership: -1 },
        standing: -20,
      },
      {
        id: 'l1-hero',
        kind: 'flag',
        text: 'Honestly I did all of it. Nobody else on the team understood Postgres.',
        note: 'Credit-taking; dismissive of the team.',
        lp: { Ownership: 0, 'Earn Trust': -1 },
        standing: -15,
      },
    ],
  },
  {
    level: 'L2 · Dive Deep',
    question: 'How did you know that was the root cause and not just correlated?',
    answers: [
      {
        id: 'l2-strong',
        kind: 'strong',
        text: 'EXPLAIN ANALYZE showed a seq scan on 85M rows where we used to get an index scan. last_autoanalyze was 3 days old, blocked by a long-running analytics transaction. ANALYZE alone flipped the plan back and p99 dropped in minutes: one variable, before and after.',
        note: 'Four levels below the dashboard; controlled before/after on one variable.',
        lp: { 'Dive Deep': 2 },
        standing: 0,
      },
      {
        id: 'l2-vague',
        kind: 'rehearsed',
        text: 'The queries looked slow in the dashboard, so it was clearly the database.',
        note: 'Stops at the dashboard. Correlation only.',
        lp: { 'Dive Deep': -1 },
        standing: -20,
      },
      {
        id: 'l2-invent',
        kind: 'flag',
        text: 'Latency was exactly 2,437 ms and dropped by precisely 96.1% after my fix.',
        note: 'Invented precision; does not answer how cause was proven.',
        lp: { 'Dive Deep': -1, 'Are Right, A Lot': -1 },
        standing: -25,
      },
    ],
  },
  {
    level: 'L3 · Alternatives',
    question: 'Why didn’t you just put a Redis cache in front of it?',
    answers: [
      {
        id: 'l3-strong',
        kind: 'strong',
        text: 'I deliberately did not add Redis: it would have hidden the plan flip, not fixed it. The lasting fix was a composite index (seller_id, created_at), a 10-minute idle-in-transaction timeout for the analytics role and an alert on table stats age.',
        note: 'Rejected a masking fix with a reason; built mechanisms so it stays fixed.',
        lp: { 'Are Right, A Lot': 1, Ownership: 1 },
        standing: 0,
      },
      {
        id: 'l3-both',
        kind: 'rehearsed',
        text: 'We added Redis as well, to be safe; more caching is always good for performance.',
        note: 'Cache as a mask; no reasoning about trade-offs.',
        lp: { 'Are Right, A Lot': -1 },
        standing: -15,
      },
      {
        id: 'l3-dodge',
        kind: 'flag',
        text: 'I don’t remember, that was a long time ago.',
        note: 'Story collapses under the first “why?”.',
        lp: { 'Are Right, A Lot': -1, 'Dive Deep': -1 },
        standing: -30,
      },
    ],
  },
  {
    level: 'L3′ · Earn Trust',
    question: 'You killed another team’s analytics transaction. Did you have the authority, and what did they say?',
    answers: [
      {
        id: 'l3b-strong',
        kind: 'strong',
        text: 'I paged their on-call, showed the 3-day transaction and the lock graph, and they agreed on the call. I wrote the incident review with them as co-authors and proposed the timeout for their role. They asked for a read replica, and we set one up.',
        note: 'Speed without spending trust; shared the review; followed up.',
        lp: { 'Earn Trust': 2 },
        standing: 0,
      },
      {
        id: 'l3b-own',
        kind: 'rehearsed',
        text: 'I killed it myself because the customers mattered more; I told them afterwards.',
        note: 'Bias for action but trust spent; no follow-up described.',
        lp: { 'Earn Trust': -1 },
        standing: -10,
      },
      {
        id: 'l3b-blame',
        kind: 'flag',
        text: 'That team never cleans up their queries; honestly the whole incident was their fault.',
        note: 'Blame on another team. Not blameless; red flag for Earn Trust.',
        lp: { 'Earn Trust': -2 },
        standing: -25,
      },
    ],
  },
  {
    level: 'L4 · Learning',
    question: 'What would you do differently today, and what changed afterwards?',
    answers: [
      {
        id: 'l4-strong',
        kind: 'strong',
        text: 'I now check planner stats and long transactions in the first 10 minutes of any “slow with no deploy” incident; I added that to the runbook. The stats-age alert has caught two similar cases since, both before customers noticed.',
        note: 'Changed behaviour, a mechanism, and later evidence it worked.',
        lp: { Ownership: 1, 'Dive Deep': 1 },
        standing: 0,
      },
      {
        id: 'l4-nothing',
        kind: 'flag',
        text: 'Nothing really, it went well.',
        note: 'No self-critique. Bar Raisers probe for exactly this.',
        lp: { 'Earn Trust': -1 },
        standing: -20,
      },
      {
        id: 'l4-platitude',
        kind: 'rehearsed',
        text: 'I learned that monitoring is really important.',
        note: 'A platitude; nothing changed.',
        lp: {},
        standing: -10,
      },
    ],
  },
];

export type Choices = Record<number, string>;

export type Vote = 'Strongly inclined' | 'Inclined' | 'Not inclined' | 'Not enough data';

export function score(c: Choices) {
  const evidence = Object.fromEntries(LPS.map((l) => [l, 0])) as Record<LP, number>;
  const probed = Object.fromEntries(LPS.map((l) => [l, false])) as Record<LP, boolean>;
  let standing = 100;
  const notes: string[] = [];
  PROBES.forEach((p, k) => {
    const a = p.answers.find((x) => x.id === c[k]);
    if (!a) return;
    standing = Math.max(0, standing + a.standing);
    notes.push(a.note);
    for (const [lp, v] of Object.entries(a.lp) as [LP, number][]) {
      evidence[lp] += v;
      probed[lp] = true;
    }
  });
  const votes = Object.fromEntries(
    LPS.map((lp) => {
      const e = evidence[lp];
      const v: Vote = !probed[lp] ? 'Not enough data' : e >= 3 ? 'Strongly inclined' : e >= 1 ? 'Inclined' : 'Not inclined';
      return [lp, v];
    }),
  ) as Record<LP, Vote>;
  const answered = Object.keys(c).length;
  const flags = PROBES.filter((p, k) => p.answers.find((a) => a.id === c[k])?.kind === 'flag').length;
  const overall: Vote =
    answered < PROBES.length ? 'Not enough data' : flags === 0 && standing >= 90 && Object.values(votes).every((v) => v !== 'Not inclined') ? 'Strongly inclined' : flags <= 1 && standing >= 60 ? 'Inclined' : 'Not inclined';
  return { evidence, votes, standing, notes, overall, flags };
}

export interface Frame extends BaseFrame {
  probe: number; // index into PROBES, or PROBES.length for the debrief
}

export const STEPS: Frame[] = [...PROBES.map((p, k) => ({ probe: k, caption: p.question })), { probe: PROBES.length, caption: 'Debrief.' }];
