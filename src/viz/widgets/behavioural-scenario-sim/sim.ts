// Pure data + scoring for the behavioural scenario walk-through. Five prompts from the topic
// (design disagreement, incident, failure, influence without authority, mentoring); each is
// told in four beats and every beat offers three ways to tell it. Options carry the signals
// they convey and the red flags (traps) they trip, taken from the topic's scoring table.
// No React here so the scoring can be checked with Node.
import type { BaseFrame } from '../../core';

export type ScenarioId = 'conflict' | 'incident' | 'failure' | 'influence' | 'mentoring';

export interface Option {
  text: string;
  /** −2 red flag … +2 strong evidence */
  pts: -2 | -1 | 0 | 1 | 2;
  signals?: string[];
  flags?: string[];
  why: string;
}

export interface Beat {
  ask: string;
  options: Option[];
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  prompt: string;
  signal: string;
  trap: string;
  beats: Beat[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'conflict',
    label: 'Design disagreement',
    prompt: 'Tell me about a time you disagreed with a manager or peer on a design.',
    signal: 'conflict resolution, judgment',
    trap: '“I was right and they eventually saw it”',
    beats: [
      {
        ask: 'Set the stakes',
        options: [
          { text: 'Our architect proposed GraphQL federation across 8 services; I thought a single BFF was enough for the next year. I’d own most of the complexity either way.', pts: 2, signals: ['clear stakes', 'senior scope'], why: 'A real design direction with something at stake for you.' },
          { text: 'A teammate kept naming variables badly and I pushed back in code review.', pts: -1, flags: ['trivial conflict'], why: 'Naming and formatting conflicts signal low scope.' },
          { text: 'There was some disagreement about the API approach.', pts: 0, why: 'Vague: the interviewer cannot tell what was at stake.' },
        ],
      },
      {
        ask: 'How did you raise it?',
        options: [
          { text: 'I asked him for 30 minutes one-to-one, opened with what federation got right (team autonomy, one schema), then my operational concern: no gateway expertise and an extra hop per subgraph.', pts: 2, signals: ['steelmanned their view', 'raised privately, early'], why: 'Steelman first, then your concern, in private.' },
          { text: 'I raised it in the all-hands design review so everyone could see the problems.', pts: -2, flags: ['public ambush'], why: 'Surprising someone in public damages the relationship you are being scored on.' },
          { text: 'I didn’t say anything at first and hoped the idea would be dropped.', pts: -1, flags: ['avoided the conflict'], why: 'Avoidance is the other anti-signal for conflict.' },
        ],
      },
      {
        ask: 'How was it resolved?',
        options: [
          { text: 'I proposed a one-week spike: two subgraphs both ways, measuring p95 and developer effort. Federation added ~40 ms but cut cross-team coordination; we agreed on federation starting with 3 services and a gateway runbook first.', pts: 2, signals: ['data / experiment', 'shared decision'], why: 'An experiment turned two camps into a shared question.' },
          { text: 'I escalated to my manager to overrule him.', pts: -2, flags: ['escalated first'], why: 'Escalation is the last rung of the ladder, done together, not step one.' },
          { text: 'We argued for a few weeks until he gave in.', pts: -1, flags: ['won by attrition'], why: 'No data and no decision owner; just stamina.' },
        ],
      },
      {
        ask: 'How does the story end?',
        options: [
          { text: 'Three services shipped in 6 weeks, I wrote the gateway runbook, and he later asked me to co-own the schema governance review.', pts: 2, signals: ['outcome', 'relationship after'], why: 'Ends with the outcome and how you work together now.' },
          { text: 'In the end the data proved I was right and he had to admit it.', pts: -2, flags: ['“I was right” arc'], why: 'The classic trap: even if true, it shows the anti-signal.' },
          { text: 'It shipped eventually.', pts: 0, why: 'No result, no relationship, no learning.' },
        ],
      },
    ],
  },
  {
    id: 'incident',
    label: 'Incident you owned',
    prompt: 'Tell me about a production incident you owned.',
    signal: 'ownership, composure, learning',
    trap: 'blaming a person or another team; heroics',
    beats: [
      {
        ask: 'Detection and your role',
        options: [
          { text: 'During a sale, checkout errors jumped from 0.2% to 18% at 20:04. I was on-call for the order service and acted as incident commander until the SRE lead joined.', pts: 2, signals: ['timestamps', 'clear role'], why: 'Time to detect and your role, said out loud.' },
          { text: 'We had an outage once and the infra team handled most of it.', pts: -1, flags: ['absent ownership'], why: 'Not your incident if someone else handled it.' },
          { text: 'A junior pushed a bad config and broke checkout.', pts: -2, flags: ['blamed a person'], why: 'Opening with a person to blame fails the blameless test immediately.' },
        ],
      },
      {
        ask: 'Your first move',
        options: [
          { text: 'I saw Redis connection errors after a 19:55 deploy and called a rollback at 20:11 instead of debugging live. Errors were back under 1% by 20:16.', pts: 2, signals: ['mitigation first', 'composure'], why: 'Stop the bleeding, then investigate.' },
          { text: 'I spent an hour reading the code to find the exact line before changing anything.', pts: -1, flags: ['root cause before mitigation'], why: 'Customers kept failing while you debugged.' },
          { text: 'I hot-patched production myself without telling anyone.', pts: -2, flags: ['unilateral risk'], why: 'Risky and invisible to the incident channel.' },
        ],
      },
      {
        ask: 'Root cause',
        options: [
          { text: 'A per-request Redis client in a request-scoped provider opened thousands of connections at 6× traffic. Contributing: no connection-count alert, a load test at 2× not 6×, and a review checklist that missed client lifecycle.', pts: 2, signals: ['technical + process causes'], why: 'Contributing factors include process gaps, not just the bug.' },
          { text: 'The root cause was a code bug.', pts: 0, why: 'True but shallow: no mechanism, no contributing factors.' },
          { text: 'Root cause: the engineer didn’t test properly.', pts: -2, flags: ['blame as root cause'], why: 'A person is never the root cause in a blameless postmortem.' },
        ],
      },
      {
        ask: 'Follow-through',
        options: [
          { text: 'I ran a blameless postmortem and the author co-presented it with me. Three action items (lint rule, connection alert, 6× load tests) closed in 3 weeks; zero repeats in the next two sales.', pts: 2, signals: ['closed action items', 'verified effect'], why: 'Named actions, owners, completion and measured effect.' },
          { text: 'I wrote a postmortem with some action items.', pts: 0, why: 'Were they done? Did it work? The interviewer will ask.' },
          { text: 'I stayed up 36 hours and fixed everything myself.', pts: -1, flags: ['heroics, no systemic fix'], why: 'Heroics without a mechanism is an anti-signal.' },
        ],
      },
    ],
  },
  {
    id: 'failure',
    label: 'Failure / missed deadline',
    prompt: 'Tell me about a failure or a missed deadline.',
    signal: 'self-awareness, growth',
    trap: 'humblebrag, or blaming others',
    beats: [
      {
        ask: 'Pick the failure',
        options: [
          { text: 'I committed to moving our notification service from a cron poller to an event-driven consumer in 4 weeks. I owned the estimate and the delivery.', pts: 2, signals: ['real, moderate stakes', 'your decision'], why: 'Recoverable stakes where your decision mattered.' },
          { text: 'My biggest failure is that I care too much about quality.', pts: -2, flags: ['humblebrag'], why: 'Not a failure; interviewers hear this often.' },
          { text: 'The PM kept changing requirements, so we missed the date.', pts: -2, flags: ['blamed others'], why: 'Someone else’s failure, not yours.' },
        ],
      },
      {
        ask: 'Own your share',
        options: [
          { text: 'I estimated from the code changes and ignored the 180M-row backfill. I saw that risk in week 1, assumed it would be fine, and only flagged the slip in week 3. That was my real mistake.', pts: 2, signals: ['names own mistake'], why: 'One clear sentence: what you did wrong.' },
          { text: 'The backfill turned out slower than anyone expected.', pts: -1, flags: ['passive voice'], why: 'Nobody owns it in this sentence.' },
          { text: 'Estimates are hard in general.', pts: -1, flags: ['platitude'], why: 'Deflects into a truism.' },
        ],
      },
      {
        ask: 'Recovery',
        options: [
          { text: 'I told my manager and both dependent teams the same day, with a new date and a plan: batch by month, parallel rate-limited workers, cut new traffic over first.', pts: 2, signals: ['early, honest communication', 'recovery plan'], why: 'Transparent, with options that limited the damage.' },
          { text: 'I worked weekends to catch up and didn’t mention it until the deadline.', pts: -2, flags: ['hid the slip'], why: 'Hiding the problem is worse than the slip.' },
          { text: 'I asked for more people.', pts: 0, why: 'Possibly sensible, but no plan or communication.' },
        ],
      },
      {
        ask: 'What changed afterwards?',
        options: [
          { text: 'I now split estimates into known work plus named unknowns and spike the riskiest first. On the next migration the spike found a backfill issue on day 2 and we landed within 3 days of the estimate.', pts: 2, signals: ['changed practice', 'later proof'], why: 'A concrete change, proven on a later project.' },
          { text: 'I learned to be more careful.', pts: 0, why: 'A platitude; nothing observable changed.' },
          { text: 'Honestly, looking back, it wasn’t really my fault.', pts: -2, flags: ['deflection'], why: 'Undoes the ownership you just showed.' },
        ],
      },
    ],
  },
  {
    id: 'influence',
    label: 'Influence w/o authority',
    prompt: 'Tell me about a time you influenced other teams without authority.',
    signal: 'influence, cross-team scope',
    trap: 'escalating first, or mandating',
    beats: [
      {
        ask: 'The problem',
        options: [
          { text: 'Five teams published ad-hoc JSON events. Schema breaks caused 3 consumer incidents in a quarter, one dropped order-cancellation events. I owned a consumer team, with no authority over producers.', pts: 2, signals: ['business impact', 'clear lack of authority'], why: 'The pain, in their terms, and your position.' },
          { text: 'Other teams’ code quality was bad and I wanted to fix it.', pts: -1, flags: ['judgmental framing'], why: 'Starts by blaming the people you need to win over.' },
          { text: 'We wanted a schema registry.', pts: 0, why: 'Solution first; the interviewer doesn’t yet know why it mattered.' },
        ],
      },
      {
        ask: 'Your first move',
        options: [
          { text: 'I collected the three incident timelines and estimated the cost: about 30 engineer-hours plus a refund backlog.', pts: 2, signals: ['shared data'], why: 'Their own incident data is the strongest lever.' },
          { text: 'I asked my manager to tell their managers to adopt it.', pts: -2, flags: ['escalated first'], why: 'Escalation as step one is the trap.' },
          { text: 'I announced in Slack that everyone must use Avro from next sprint.', pts: -1, flags: ['mandated'], why: 'You have no authority to mandate; it invites resistance.' },
        ],
      },
      {
        ask: 'The proposal',
        options: [
          { text: 'I wrote an RFC, invited every producer team to review, and changed the design on their feedback, e.g. allowing JSON Schema instead of forcing Avro.', pts: 2, signals: ['written proposal', 'incorporated feedback'], why: 'Their input makes it their idea too.' },
          { text: 'I built it alone and presented the finished design.', pts: 0, why: 'Works sometimes, but no buy-in was built.' },
          { text: 'I ignored the objections; they’d thank me later.', pts: -2, flags: ['dismissed stakeholders'], why: 'Influence without listening is just pushing.' },
        ],
      },
      {
        ask: 'Adoption',
        options: [
          { text: 'I built a CLI and a GitHub Action so adoption was a 20-line PR and paired with payments first. Four of five teams adopted in a quarter; zero schema-break incidents in the next two.', pts: 2, signals: ['lowered adoption cost', 'measured adoption'], why: 'Make the right thing easy, then show the result.' },
          { text: 'Most teams said they’d look at it.', pts: -1, flags: ['no adoption'], why: 'Influence is measured by what changed.' },
          { text: 'It became mandatory after the next incident.', pts: 0, why: 'An outcome, but not your influence.' },
        ],
      },
    ],
  },
  {
    id: 'mentoring',
    label: 'Mentoring',
    prompt: 'Tell me about mentoring someone or raising the bar on your team.',
    signal: 'growing others',
    trap: 'talking about your own output',
    beats: [
      {
        ask: 'Their starting point',
        options: [
          { text: 'A new SDE-1 was technically solid but avoided on-call; their first two incidents ended with them escalating to me within minutes.', pts: 2, signals: ['specific gap'], why: 'A named person, a specific gap.' },
          { text: 'I reviewed 200 PRs last year.', pts: -2, flags: ['own output'], why: 'This is about you, not their growth.' },
          { text: 'I help juniors whenever they ask.', pts: -1, flags: ['vague'], why: 'No person, no gap, no change.' },
        ],
      },
      {
        ask: 'Your intervention',
        options: [
          { text: 'Three game days where I broke staging and only asked questions; a runbook template written with them; graduated ownership: shadow, then primary with me as secondary, then solo.', pts: 2, signals: ['graduated ownership'], why: 'Builds their capability step by step.' },
          { text: 'I handled the incidents myself so they could watch.', pts: -1, flags: ['did it for them'], why: 'Watching doesn’t build ownership.' },
          { text: 'I sent them links to the docs.', pts: 0, why: 'Low effort, low evidence.' },
        ],
      },
      {
        ask: 'Evidence of growth',
        options: [
          { text: 'By week 10 they handled a consumer-lag incident solo, end to end, and wrote the postmortem.', pts: 2, signals: ['mentee’s measurable growth'], why: 'The proof is their behaviour change.' },
          { text: 'They said they found it really helpful.', pts: 0, why: 'Nice, but not evidence of growth.' },
          { text: 'My own on-call load dropped, so I could ship more features.', pts: -1, flags: ['about yourself'], why: 'Reframes their growth as your benefit.' },
        ],
      },
      {
        ask: 'Make it last',
        options: [
          { text: 'The runbook template became the team default; median time-to-mitigate fell from ~25 to ~12 minutes over two quarters as more people could handle incidents alone.', pts: 2, signals: ['team system', 'measured effect'], why: 'Raising the bar = a system that outlives you.' },
          { text: 'Nothing formal came out of it.', pts: 0, why: 'A missed senior signal.' },
          { text: 'I plan to write some docs about it someday.', pts: -1, flags: ['no follow-through'], why: 'Intentions are not evidence.' },
        ],
      },
    ],
  },
];

export type Picks = (number | undefined)[]; // option index per beat

export function debrief(s: Scenario, picks: Picks) {
  const chosen = s.beats.map((b, k) => (picks[k] === undefined ? undefined : b.options[picks[k]!]));
  const answered = chosen.filter(Boolean).length;
  const sum = chosen.reduce((a, o) => a + (o?.pts ?? 0), 0);
  const max = s.beats.length * 2;
  const score = Math.round(((sum + max) / (2 * max)) * 100);
  const signals = chosen.flatMap((o) => o?.signals ?? []);
  const flags = chosen.flatMap((o) => o?.flags ?? []);
  const verdict =
    answered < s.beats.length
      ? `${s.beats.length - answered} beat(s) unanswered`
      : flags.length === 0 && score >= 85
        ? 'Strong: the primary signal is evidenced and no trap was tripped'
        : flags.length <= 1 && score >= 60
          ? 'Mixed: some evidence, but the interviewer will probe the weak beats'
          : 'Red flags outweigh the evidence';
  return { score, signals, flags, verdict, answered };
}

export interface Frame extends BaseFrame {
  beat: number; // beats.length = debrief
}

export function simulate(p: { scenario: ScenarioId }): Frame[] {
  const s = SCENARIOS.find((x) => x.id === p.scenario)!;
  return [...s.beats.map((b, k) => ({ beat: k, caption: b.ask })), { beat: s.beats.length, caption: 'Debrief' }];
}
