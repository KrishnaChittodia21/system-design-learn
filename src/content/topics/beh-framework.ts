import type { Topic } from '../../types';

const topic: Topic = {
  id: 'beh-framework',
  phase: 'behavioral',
  order: 1,
  title: 'The Behavioural Round: Signals, STAR & Your Story Bank',
  subtitle:
    'What behavioural and hiring-manager interviewers actually score, how your answers set your level (SDE-2 vs Senior vs Staff), STAR/STARL/CARL done well, quantified impact, a story bank built from a backend career, the project deep-dive, and the India-specific HM topics: notice period, buyout, counter-offers and compensation.',
  estimatedMinutes: 90,
  sources: [
    'Atlassian Careers: Interviewing at Atlassian, Engineering (values interview and manager/leadership interview), atlassian.com/company/careers/resources/interviewing/engineering',
    'Atlassian: Company values (Open company no bullshit; Build with heart and balance; Don’t #@!% the customer; Play, as a team; Be the change you seek)',
    'Google re:Work: Guide to structured interviewing (behavioural vs hypothetical questions, rubrics / behaviourally anchored rating scales)',
    'Google hiring attributes as reported by Business Insider and IGotAnOffer: general cognitive ability, role-related knowledge, leadership, Googleyness (G&L interview)',
    'Amazon (aboutamazon.com, amazon.jobs): Interview guide and STAR method recommendation',
    'Austen McDonald (ex-Meta hiring committee), "Deeper dive into the signal areas for behavioral interviews", thebehavioral.substack.com',
    'Hello Interview: "How behavioral interviews really work" (rubrics, hire vs level decisions, down-levelling, level-appropriate scope)',
    'Hello Interview Behavioral course: Project deep dive / special interview types',
    'Taro (jointaro.com): Master the Behavioral Interview (senior and staff lessons); "Project deep dive interviews" discussion',
    'Tech Interview Handbook: Behavioral interviews for senior candidates',
    'LeetCode Discuss: Uber SDE II Bangalore interview experiences (hiring manager round re-examining past design choices; IC vs leadership preferences)',
    'LeetCode Discuss: Flipkart SDE-2 interview experiences 2022–2024 (hiring manager round: past projects, why Flipkart, conflicts)',
    'LeetCode Discuss: Swiggy SDE-2 interview experiences (HM round: why you chose an approach, alternatives, why you are moving)',
    'Glassdoor: Razorpay SDE interview reviews (hiring manager round: disagreements with seniors, projects)',
    'Blind and candidate guides on Microsoft "As Appropriate" (AA) final round',
    'Instahyre and HR glossaries on India notice periods (contractual 30–90 days, buyouts) and counter-offers',
  ],
  tags: ['behavioral', 'star', 'story-bank', 'levelling', 'hiring-manager', 'project-deep-dive', 'impact', 'notice-period', 'compensation'],
  cheatSheet: [
    'Two decisions come out of the round: hire / no-hire AND level. A strong technical loop with small-scope stories is the classic route to being down-levelled from Senior to SDE-2.',
    'Signals scored almost everywhere: ownership, scope and impact, handling ambiguity, conflict, influence, growing others, customer focus, learning from failure, communication. Map every story to 2–3 of them before the interview.',
    'Time budget per story (~3 min): Situation + Task 20%, Action 50–60%, Result + Learning 20–25%. Most weak answers spend 70% on context.',
    'Results = baseline → after, measured how, over what period, and why it mattered to the business (p99 1.8s → 350ms for checkout; on-call pages 40 → 6 per week).',
    'Say "I" for your decisions and actions, "we" for the team outcome. If the interviewer cannot tell what YOU did, the story scores zero for you.',
    'Story bank: 8–10 stories, each tagged with signals, scope (team / multi-team / org), numbers and a learning. Two strong stories per signal beats one story per question.',
    'Project deep-dive: problem and constraints → architecture (draw it) → my part → hardest decision and alternatives → results → what I would change. Expect "why not X?" on every box.',
    '"Why not X?": acknowledge X’s strength, state the constraint at the time that ruled it out, say when X would be the right call. Never pretend you evaluated what you did not.',
    'India HM topics: state notice period and buyout facts plainly; give compensation as a researched range tied to role and level; never bluff on counter-offers or competing offers.',
    'Blanked? Ask for 20 seconds, restate the signal they want, pick the nearest story from your bank, and say which part is relevant. Silence with a plan beats rambling.',
  ],
  sections: [
    {
      heading: '1. What the behavioural and hiring-manager rounds really are',
      body: `**Intuition:** the technical rounds tell the company *whether you can do the work*. The behavioural round tells them *what kind of colleague you will be, at what level, and how much they can trust you with*. At senior levels it often carries a veto.

Different companies use different names for it, but they all look for the same thing: **evidence from your past behaviour**. Google's own re:Work guide to structured interviewing explains the reasoning. Behavioural questions ("Tell me about a time...") and hypothetical ones ("What would you do if...") are scored against rubrics, because structured interviews predict job performance better than unstructured chats.

| Company | What the round is called / how it is reported | What it emphasises |
|---|---|---|
| Google | Googleyness & Leadership (G&L) | Leadership (formal or emergent), collaboration, ambiguity, growth. Leadership and Googleyness are two of the hiring attributes Google is widely reported to score |
| Meta | Behavioural interview | Signal areas reported by an ex-Meta hiring-committee chair: scope, initiative, ambiguity, perseverance, conflict resolution, growth, communication |
| Microsoft | Final "As Appropriate" (AA) round, as candidates report it | A senior leader reviews earlier feedback and often settles the level. Usually part behavioural and part technical |
| Atlassian | Values interview + manager/leadership interview | The interview is explicitly against the five published values. The interviewer is often from outside the hiring team |
| Amazon | Behavioural questions in every round, with a Bar Raiser | Leadership Principles. See the next topic, *Amazon Leadership Principles & Bar Raiser* |
| Flipkart, Swiggy, Razorpay, Uber (India) | Hiring Manager (HM) round, usually 45–90 min | A deep dive on past projects ("why this approach, what alternatives"), conflicts with seniors, why you are moving, and team fit |

**What Indian candidates commonly underestimate:** the HM round at Indian product companies is *not* only soft. Candidate reports on LeetCode Discuss for Uber and Swiggy describe the hiring manager walking through the design choices your team made and asking whether you would still make them under different conditions. Treat it as **half system-design, half behavioural**.

**Say this in your head before you walk in:** "Every answer has to give them a signal they can write down, attached to a level."`,
      keyPoints: [
        'Behavioural = evidence from past behaviour, scored against a rubric, not a chat.',
        'Indian HM rounds mix a project deep-dive with behavioural questions; prepare both.',
        'At senior levels the behavioural round frequently decides the level, not only the hire.',
      ],
      source: 'Google re:Work structured interviewing guide; Atlassian engineering interview page; LeetCode Discuss candidate reports (Uber, Swiggy, Flipkart)',
    },
    {
      heading: '2. The signals interviewers write down',
      body: `**Intuition:** an interviewer has a scorecard with 5–8 boxes. Each story you tell should drop evidence into at least two boxes. A story that is pleasant but fills no box is wasted time.

| Signal | What the interviewer wants to see | Evidence that proves it | Anti-signal |
|---|---|---|---|
| **Ownership** | You treat outcomes as yours, beyond your ticket | You noticed a problem nobody had assigned, drove it to closure and followed up after launch | "That was the infra team's job" |
| **Scope & impact** | The size of the problems you are trusted with | Number of services, teams and users affected, and the business metric that moved | Only task-level work at a senior level |
| **Ambiguity** | You create structure where there is none | You defined the problem, wrote the doc, set milestones and picked what NOT to do | Waiting for requirements |
| **Conflict** | You disagree directly and keep the relationship | You used data, understood their constraints, and either converged or disagreed and committed | Avoiding it, or "I was right and they eventually saw it" |
| **Influence** | You move people you don't manage | You used an RFC, a prototype or metrics, and built alliances across teams | "I escalated to my manager" as step one |
| **Growing others** | You make the team better | You mentored people, raised the review bar and built docs or tooling others use | Only your own output |
| **Customer focus** | You connect technical work to users | You can name the user pain (failed payments, slow checkout) and how it was measured | Pure tech-for-tech stories |
| **Learning from failure** | Self-awareness and changed behaviour | You own your part, show a concrete change, and that change was later used | Blaming, or a "failure" that is a humblebrag |
| **Communication** | Clear and concise, and adapted to the audience | A structured answer, at the right altitude, that survives interruptions | 6-minute monologues |

**Meta-specific nuance (as reported):** if your answer doesn't surface the signal, the interviewer often *re-asks the same question in different words*. If you hear "OK, but what did you specifically do?" twice, you're missing the Ownership box.`,
      keyPoints: [
        'Every story should fill at least two signal boxes.',
        'A re-asked question means the signal is missing; change what you say, not how much.',
      ],
      source: 'Austen McDonald, Meta signal areas (thebehavioral.substack.com); Tech Interview Handbook, senior behavioral',
    },
    {
      heading: '3. How behavioural answers set your level: SDE-2 vs Senior vs Staff',
      body: `**Intuition:** the *same question* gets a different score depending on the scope of the story you choose. One common way to put it: a junior-level conflict is a debate about class structure in code review, while a staff-level conflict is disagreement about **the direction of two teams**.

Interviewers make two separate decisions: **hire / no-hire** and **level**. Practitioner guides report that most down-levelling decisions come from the behavioural round, not from coding gaps.

| Dimension | SDE-2 (approx. 2–5 yrs) | Senior (approx. 5‐9 yrs) | Staff (cross-org) |
|---|---|---|---|
| Scope | A feature or component in one service | A system or several services, and the team's roadmap | Multiple teams or an org-wide platform, with direction over years |
| Ambiguity | Given a problem, finds the solution | Given a goal, defines the problem and the plan | Given a vague business worry, finds the right problem to solve |
| Conflict | Code review, API shape | Design direction within the team, or scope with PM | Strategy between teams, build-vs-buy, org priorities |
| Influence | Persuades teammates | Aligns 2–3 teams through an RFC | Changes standards or architecture across an org |
| Growing others | Helps onboard someone | Mentors 2–3 engineers and raises the review bar | Grows senior engineers and creates leaders |
| Impact language | "Reduced latency of my API" | "Cut checkout p99 from 1.8s to 400ms, recovering ~2% of abandoned carts" | "Changed how 12 teams ship, halving incident rate org-wide" |

The year ranges are rough guides. Levels vary by company, and Indian product companies often map "SDE-3" or "Senior SDE" to the middle column.

**How to use this:** pick stories from the column you are targeting. If you only have SDE-2 sized stories, tell them with **senior framing**: why the problem mattered, what you decided not to do, who you aligned with, and what changed for other teams.`,
      diagram: `   Same prompt: "Tell me about a disagreement"

   SDE-2 story        Senior story              Staff story
   +-----------+      +------------------+      +----------------------+
   | PR review |      | Team design dir. |      | Two teams' platform  |
   | naming /  | ---> | Kafka vs SQS for | ---> | strategy: one shared |
   | class API |      | order events     |      | event bus for 9 svcs |
   +-----------+      +------------------+      +----------------------+
   scope: code        scope: system             scope: org`,
      keyPoints: [
        'Hire decision and level decision are separate; the behavioural round drives the second.',
        'Choose stories whose scope matches the target level, then frame them with business impact.',
      ],
      source: 'Hello Interview, "How behavioral interviews really work"; Taro, project deep dive (senior vs staff)',
    },
    {
      heading: '4. STAR, STARL and CARL with weak vs strong examples',
      body: `**Intuition:** STAR is a skeleton, not a script. Its job is to make sure you don't forget the result and don't drown in context.

| Framework | Parts | When to use |
|---|---|---|
| **STAR** | Situation, Task, Action, Result | The default. Amazon's interview guide explicitly recommends it |
| **STARL** | STAR + Learning | Failures, feedback and conflict, wherever growth is a signal |
| **CARL** | Context, Action, Result, Learning | Shorter set-up. Good for rapid follow-ups and for senior candidates who over-explain |

**Time budget for a ~3 minute answer:** S+T about 30–40 s, Action about 90–120 s, Result + Learning about 30–45 s.

**Weak vs strong (prompt: "Tell me about a time you improved a system's performance")**

| Part | Weak | Strong |
|---|---|---|
| S | "We had a big monolith with lots of APIs and performance issues and the team was very busy..." (90 s) | "Our order-history GraphQL API in a NestJS service had a p99 of 2.4s during sale events, and support tickets about 'orders not loading' tripled." |
| T | "I was asked to fix it." | "I owned the read path for that service and committed to getting p99 under 500ms before the next sale, 5 weeks away." |
| A | "We added caching and optimised queries." | "I traced it and found an N+1 on line items (up to 60 queries per request). I introduced DataLoader batching, added a composite index on (user_id, created_at), and put a 60s Redis cache on the summary. I chose not to cache line-item status, because stale order status caused tickets. I load-tested at 3x sale traffic before rollout." |
| R | "It became much faster." | "p99 went 2.4s → 380ms, DB CPU went 75% → 30% at peak, and 'orders not loading' tickets fell about 80% in the next sale." |
| L | (missing) | "Since then, I add query-count assertions to integration tests for every new resolver." |

All numbers in this topic's stories are **illustrative**. Use your own real numbers. Interviewers probe them.`,
      code: [
        {
          language: 'text',
          title: 'One-page STARL card (fill one per story)',
          code: `STORY: Order-history p99 fix                      SIGNALS: ownership, customer, depth
LEVEL SCOPE: one service, 2 consumer teams       DATE: 2024 Q3
S  (1-2 lines) : Sale-day p99 2.4s; 'orders not loading' tickets x3
T  (my stake)  : I owned read path; target p99 < 500ms in 5 weeks
A  (3-5 verbs) : traced N+1 -> DataLoader batching
                 composite index (user_id, created_at)
                 Redis 60s summary cache; NOT status (staleness = tickets)
                 load test at 3x peak; staged rollout 5% -> 100%
R  (numbers)   : p99 2.4s -> 380ms; DB CPU 75% -> 30%; tickets -80%
L  (change)    : query-count assertions in every resolver test
PROBES I EXPECT: why not read replica? why 60s TTL? how did you measure?`,
        },
      ],
      keyPoints: [
        'Spend half the time on Action, with specific verbs and decisions.',
        'Include one decision NOT taken; it signals judgment.',
        'Add the L for failures, feedback and conflict.',
      ],
      source: 'Amazon interview guide (STAR method); common STARL/CARL practice in interview coaching',
    },
    {
      heading: '5. Quantifying impact without lying',
      body: `**Intuition:** a number turns "I think it went well" into evidence. But a number you can't defend is worse than no number. Interviewers will ask "how did you measure that?"

**Metric families a backend engineer can almost always reconstruct:**

| Family | Example metrics | Where to find them later |
|---|---|---|
| Latency | p50/p95/p99, time-to-first-byte | APM dashboards (Datadog, New Relic, Grafana), old Slack screenshots, PR descriptions |
| Reliability | Incidents per quarter, MTTR, error rate, SLO burn | Postmortem docs, PagerDuty history |
| Cost | Monthly cloud spend, instance count, DB size | Billing exports, FinOps reviews |
| Throughput / scale | RPS, events/s, records migrated, tenants onboarded | Load-test reports, migration runbooks |
| Business | Conversion, payment success rate, tickets, revenue at risk | PM dashboards, launch emails, quarterly reviews |
| Engineering velocity | Deploy frequency, lead time, build time, onboarding time | CI metrics, DORA dashboards |

**Formula for a result line:** *baseline → after, by how it was measured, over what period, and so what.*
"Payment-callback failures went from ~1.2% to 0.1% over the following month, measured by the reconciliation job's mismatch count. That was roughly 900 fewer manual refunds a week for the ops team."

**Honest approximation is fine.** Say "roughly", "about", "order of magnitude". Say "I don't have the exact number; it was in the 30–40% range, from the Grafana board we reviewed weekly." What fails is inventing precision ("exactly 37.4%") and then folding under a follow-up.

**When the result was not measurable**, say what proxy you used and what you would instrument next time. That is itself a senior signal.`,
      keyPoints: [
        'Baseline, after, measurement, period, business meaning.',
        'Approximate honestly; never invent precision.',
        'No metric? Name the proxy and what you would instrument.',
      ],
    },
    {
      heading: '6. "I" vs "we": crediting the team while proving your part',
      body: `**Intuition:** the interviewer is hiring *you*, not your team. But claiming all the credit reads as arrogance or dishonesty. The fix is precise attribution.

| Weak | Why it hurts | Strong |
|---|---|---|
| "We migrated to Kafka." | Can't tell your role | "I wrote the migration RFC and built the dual-write and replay tooling. Two teammates migrated the consumers." |
| "I built the whole payments platform." | Implausible, and reads as credit-taking | "I designed the idempotency layer and the ledger schema. A team of 5 built the platform over 2 quarters." |
| "The team decided not to..." | Hides your judgment | "I argued against X because..., and the team agreed after the load test." |
| "We had an outage, and they fixed it." | Absent ownership | "I was incident commander. I made the call to roll back at minute 12." |

**Rule of thumb:** "we" for the context and the team outcome, "I" for every verb in the Action section. If your contribution was small, choose a different story; don't inflate.

**Probe to expect:** "If I called your tech lead, what would they say you did on this project?" Your answer should match what you already said.`,
    },
    {
      heading: '7. Building a story bank from a backend career',
      body: `**Intuition:** you will be asked 15–25 behavioural questions across a loop, but you only need **8–10 well-prepared stories**. Each story is reusable across several signals if you tag it.

**How to mine stories (the last 3–4 years):**
1. Go through your incidents and postmortems, migrations, launches, design docs and RFCs, performance reviews, and any feedback you received.
2. For each, write the STARL card (section 4) with **numbers** and **your exact role**.
3. Tag the signals and the scope (team / multi-team / org).
4. Make sure you have **at least one failure** and **one conflict you did not win**. Interviewers notice when every story ends in triumph.

**Example bank for a senior NestJS / microservices engineer (adapt, never recite):**

| # | Story (example) | Primary signals | Scope |
|---|---|---|---|
| 1 | Monolith → microservices extraction of the order service with the strangler pattern | Ambiguity, influence, depth | Multi-team |
| 2 | Sale-day incident: Redis connection storm, I was incident commander | Ownership, incident, learning | Team + SRE |
| 3 | Pushed back on PM's "real-time everything" scope; shipped polling + webhooks first | Pushback, customer, prioritisation | Team + product |
| 4 | Disagreed with the architect on GraphQL federation vs a BFF; disagreed and committed | Conflict, communication | Multi-team |
| 5 | Missed a migration deadline by 3 weeks (underestimated backfill) | Failure, learning | Team |
| 6 | Mentored two juniors to own on-call; wrote the runbook template | Growing others | Team |
| 7 | Payments idempotency fix that eliminated duplicate charges | Customer, depth, ownership | Cross-team |
| 8 | Tech-debt quarter: made the case with incident data, got 20% capacity | Influence, tech debt | Team + leadership |
| 9 | Chose a queue under incomplete data, with a reversible decision | Decision-making, ambiguity | Team |
| 10 | Received feedback that my reviews were blocking; changed my approach | Feedback, growth | Personal |

Stories 4, 5 and 10 are the ones most candidates lack, and they are the ones that separate senior from mid-level.`,
      code: [
        {
          language: 'text',
          title: 'Story-bank coverage matrix (tick at least 2 per column)',
          code: `                 Own  Amb  Confl Infl Grow Cust Fail Fdbk Decn Depth
1 Strangler mig   x    X         X                           x
2 Sale incident   X                        x    x            x
3 Scope pushback       x    x    x         X         x   x
4 Federation dsgn           X    x                      x    x
5 Missed deadline x                             X    x
6 On-call mentor  x                   X
7 Idempotency     X                        X                 X
8 Tech-debt case            x    X         x             x
9 Queue choice         X                             x   X
10 Review feedback                    x               X
X = primary, x = secondary. Empty column? Mine another story.`,
        },
      ],
      keyPoints: [
        '8–10 stories, each tagged with signals, scope, numbers and a learning.',
        'Include at least one failure and one conflict you did not win.',
        'Two stories per signal gives you a backup when the interviewer says "another example?".',
      ],
    },
    {
      heading: '8. The "walk me through your most complex project" deep-dive',
      body: `**Intuition:** this is a system-design interview where *you* are the source of truth. The interviewer will test whether you **understood** the system or only **worked on** it. Candidate reports from Uber and Swiggy HM rounds describe exactly this: your design choices are re-examined, and you're asked for alternatives and what changes under different conditions.

**Structure (10–15 minutes, then probes):**
1. **Problem and stakes (1 min):** who the users were, what was broken or missing, and the business reason.
2. **Constraints (1 min):** scale (RPS, data size), latency/consistency needs, team size, deadline, legacy.
3. **Architecture (3–4 min):** draw it. Name the data stores and why, the sync vs async boundaries, and the failure handling.
4. **My part (1–2 min):** which boxes you designed or built, and which decisions were yours.
5. **The hardest decision (2–3 min):** the options, the trade-off and why you chose what you did.
6. **Results (1 min):** numbers.
7. **Hindsight (1 min):** what you'd change now and why. This is the most senior-sounding minute of the answer.

**Probes that always follow:**
- "Why Postgres and not DynamoDB/Mongo here?"
- "What happens if this consumer is down for an hour?"
- "How did you guarantee exactly-once / idempotency?"
- "What was the bottleneck at 10x?"
- "Which part would you not build again?"
- "What did you personally write?"

**Handling "why not X?":**
1. **Acknowledge** X's real strength: "Kafka would have given us replay and higher throughput."
2. **State the constraint at the time:** "We were at ~300 events/s, the team had no Kafka ops experience, and we were already on AWS, so SQS + SNS removed an operational burden."
3. **Say when X wins:** "If we needed ordered replay for rebuilding projections, or passed ~10k events/s, I'd move to Kafka or MSK."
4. If you didn't evaluate X, **say so**: "We didn't seriously evaluate it. Thinking about it now, the trade-off would be..." Pretending is detectable and fatal.`,
      diagram: `   Deep-dive arc (aim for ~12 min before probes)

   Problem -> Constraints -> Architecture -> MY part -> Hardest decision
     1m          1m            3-4m           1-2m         2-3m
                                                              |
                     Hindsight <------ Results <--------------+
                        1m               1m
   Probes attach anywhere: "why not X?"  "what if 10x?"  "what did YOU do?"`,
      keyPoints: [
        'Draw the architecture; name data stores and failure handling.',
        'Separate the system from your contribution explicitly.',
        '"Why not X": strength, constraint at the time, when X wins. Never fake an evaluation.',
      ],
      source: 'Hello Interview behavioral course (project deep dive); Taro; LeetCode Discuss Uber and Swiggy HM round reports',
    },
    {
      heading: '9. "Tell me about yourself", "why are you leaving" and "why us"',
      body: `**Intuition:** these openers set the frame for the whole interview. Treat them as a 90-second **trailer**: the interviewer should know what level you operate at and which 2–3 stories to ask about.

**"Tell me about yourself" for a senior backend profile (60–90 s):**
- **Now:** current role, the domain and the scale ("payments/orders, ~X RPS, NestJS microservices on Kubernetes").
- **Signature work (2 items):** one depth item and one leadership item, each with a number.
- **How you work:** one line, e.g. "I care about reliability and making the team faster".
- **Why this conversation:** a bridge to the role.

Not this: a chronological CV readout from college onwards, a tech-stack list, or personal history the interviewer didn't ask for.

**"Why are you leaving?"** Be **forward-looking and true**. Good reasons: scope, scale, domain, product ownership, engineering culture, wanting to move from services to product. Never criticise your manager or company. If there was a real problem (layoffs, a reorg, a stalled project), state it in one neutral sentence and pivot: "After the reorg, my team moved to maintenance work. I want to build at higher scale again, which is why..."

**"Why us?"** Make it specific. Name the product problem, a public engineering blog post or talk, the domain (payments reliability, logistics optimisation, developer tools) and how your stories map to it. "Good brand and good pay" is true for everyone and scores nothing.`,
      code: [
        {
          language: 'text',
          title: 'Example 75-second intro (adapt; illustrative numbers)',
          code: `"I'm a backend engineer with about seven years of experience, the last four on
the order and payments platform at a mid-size e-commerce company. We run around
two dozen NestJS services on Kubernetes, peaking at roughly 8k RPS on sale days.

Two things I'm proud of: I led the extraction of order management out of our
monolith with a strangler approach, with zero-downtime cut-over across three
teams. And I redesigned payment callbacks around idempotency keys, which took
duplicate-charge tickets from weekly to essentially zero.

These days I spend about half my time on design reviews and mentoring. Two
engineers I mentored now run on-call independently.

I'm looking for a bigger scale and a product where reliability is the core of
the business, which is why this payments infrastructure role caught my eye."`,
        },
      ],
      keyPoints: [
        'Intro = trailer: scope now, two signature stories with numbers, how you work, the bridge.',
        'Reasons for leaving: forward-looking, true, never bitter.',
        '"Why us" must contain something that is not true of every other company.',
      ],
    },
    {
      heading: '10. India-specific hiring-manager topics: notice period, buyout, counter-offers, compensation',
      body: `**Intuition:** in India these practical questions often come up *inside* the HM or final round, not only with HR. Answer them like an engineer: facts first, no drama, no bluffing.

**Notice period.** Notice periods in Indian tech are contractual. They are commonly 30–90 days, and 90 is frequent for experienced hires in IT/services. Know your exact clause, whether your employer accepts a **buyout** (you or the new employer pay for the unserved days), and whether you can carry leave balance against it.
- Say: "My contractual notice is 90 days. The policy allows a buyout, and I've confirmed with HR that early release is possible after handover, so a realistic joining date is 45–60 days from offer."
- Avoid: "I can join in 15 days" when you can't. Joining dates that slip destroy trust before day one.

**Counter-offers.** Hiring managers in India ask about these because long notice windows give the current employer time to counter. The honest professional answer: "I'm moving for scope and the kind of problems, not only compensation. If I accept your offer, I'll decline a counter." Only say it if it is true. If you genuinely would consider a counter, don't promise otherwise. You can say "my decision will be based on role, team and growth, and I'll be transparent with you about timelines."

**Compensation expectations.** Do your homework before the call: levels data for that company and level (Levels.fyi, peers, recruiters), and your current CTC breakdown (fixed, variable, ESOPs/RSUs, joining bonus). Then:
- Prefer to anchor on **role and level** first: "I'd like to first agree on the level. For a Senior SDE role at this scale, my research suggests a range of [your researched range], depending on the equity mix."
- Be precise about **what is in your current CTC**. Variable pay and unvested equity are where misunderstandings happen.
- If the company asks for payslips or past documents, be consistent. Inflating current CTC is a background-check failure risk.

**Competing offers.** You can mention them factually ("I have an offer at a similar level with a decision date of the 20th"). Never invent one. Indian recruiting networks are small and offer letters get verified.

**Do not** let these questions change your tone. A candidate who stays calm and precise about notice and pay signals the same maturity they will show in incident calls.`,
      keyPoints: [
        'Know your clause, buyout policy and a realistic join date before the call.',
        'Counter-offer answers must be true; transparency beats a promise you would break.',
        'Anchor compensation on level and researched ranges; be exact about your CTC components.',
      ],
      source: 'Instahyre: notice period in India; HR glossaries on notice-period buyout; Uber/Flipkart HM round candidate reports',
    },
    {
      heading: '11. Red flags, and how to recover when you blank',
      body: `**Intuition:** interviewers often reject on *red flags* rather than on missing green ones. One bitter sentence about an ex-manager can outweigh three good stories.

| Red flag | What it signals | Fix |
|---|---|---|
| Blaming people or teams | Low ownership, team friction | Describe the system or process gap and your part in it |
| Vague outcomes ("it went well") | No impact or no awareness | Baseline → after, with a number or a proxy |
| No learning, or a humblebrag failure ("I work too hard") | Low self-awareness | A real mistake, a real change, and later evidence of the change |
| Only "we" | Unclear contribution | "I" for actions |
| The hero arc (you saved the day alone, again) | Single point of failure, weak collaboration | Credit others; show how you made it repeatable |
| Hypothetical answers to behavioural questions ("I would...") | No real example | "The closest real example I have is..." |
| Rambling past 4 minutes | Poor communication | Answer the headline first, then offer detail: "Want me to go deeper on the migration?" |
| Confidential details | Judgment risk | Abstract it: "a top-3 customer", "an internal ledger service" |

**When you blank:**
1. **Buy time honestly:** "Let me take 20 seconds to pick the best example."
2. **Restate the signal:** "So you're looking for a time I influenced a decision without authority."
3. **Pick the nearest story** from your bank, even if imperfect, and **say which part is relevant**: "This story is mainly about a migration, but the part that answers your question is how I got the payments team to adopt our schema."
4. If you truly have nothing, **say so and offer the adjacent experience**: "I haven't managed a low performer formally. What I have done is support a peer whose PRs kept failing review. Here's how..."

Silence with a plan beats a rambling invented story. Interviewers can usually tell when a story is being made up on the spot.`,
    },
  ],
  codeChallenges: [
    {
      id: 'beh-framework-cc-1',
      title: 'Answer Lab: rescue a "most complex project" answer that hides the candidate',
      context:
        'The hiring manager says: "Walk me through the most complex project you have worked on recently." The candidate is targeting a Senior SDE role at a payments company. Here is the first two minutes of their answer.',
      task: 'Rewrite the answer so it fills the Scope, Ownership, Depth and Impact boxes inside about 3 minutes, separates the system from the candidate’s own contribution, includes one real trade-off, and ends with a hindsight line.',
      starter: {
        language: 'text',
        title: 'Weak answer (as delivered)',
        code: `"So basically our company had a monolith, it was a very old Rails app, and
there were lots of problems with it, deployments were slow, and so management
decided we should move to microservices. We used NestJS and Kafka and Postgres
and Kubernetes and Redis. It was a very big project, around 15 people worked
on it, and it took more than a year. We created many services like order,
payment, inventory, notification. We faced many challenges like data
consistency and performance, but we solved them. We also did a lot of testing.
In the end the project was successful and everybody was happy and now the
system is much more scalable."`,
      },
      hints: [
        'Can the interviewer name one decision this candidate personally made? What would they write in the Ownership box?',
        '"Many challenges... we solved them" is the only place depth could appear. Pick ONE challenge and show the options considered.',
        'There is no baseline or after number, and no "what I would change". Which metrics would a payments HM care about?',
      ],
      solution: {
        language: 'text',
        title: 'Strong rewrite (example to adapt; illustrative numbers)',
        code: `PROBLEM & STAKES
"Our checkout ran in a Rails monolith. Deploys took ~90 minutes and were frozen
two weeks before every sale, and one slow inventory query could take checkout
down. Leadership wanted order and payment processing extracted so the payments
team could ship independently."

CONSTRAINTS
"~2k orders/min at peak, zero tolerance for double-charges, three teams
touching the same tables, and a hard deadline before the festive sale."

ARCHITECTURE (I'd sketch it)
"Strangler pattern: an API gateway routing /orders to a new NestJS order service
with its own Postgres. Monolith and service exchanged events via Kafka with an
outbox table so DB writes and events stayed consistent."

MY PART
"I owned the order service design and the data migration. I wrote the RFC,
built the outbox publisher and the dual-write verifier, and led the cut-over.
Two teammates built the consumers; the payments team owned their service."

HARDEST DECISION
"Whether to dual-write from the monolith or use CDC with Debezium. CDC was
cleaner, but nobody on the team had run Debezium in production and we had 8
weeks. I chose an application-level outbox plus a nightly reconciliation job
that diffed both stores, and wrote down the CDC move as a follow-up."

RESULTS
"Cut-over with zero downtime over 3 weekends at 5% -> 50% -> 100% traffic.
Order-service deploys went from 90 minutes to ~10, with ~15 deploys/week. The
reconciler found 14 mismatches in the first week, all fixed before full
cut-over. No duplicate charges during the sale."

HINDSIGHT
"I'd invest in contract tests between the monolith and the new service earlier.
We lost about a week to schema drift that a Pact-style test would have caught."`,
      },
      explanation: `**What changed and why it scores higher:**
- **Problem & stakes in business terms.** Frozen deploys and sale risk replace "lots of problems". The interviewer now knows why it mattered.
- **Constraints with numbers.** These let the interviewer calibrate scope (Senior: one critical system, three teams).
- **The system is separated from "my part".** The Ownership box now has concrete entries: RFC, outbox, verifier, cut-over lead. Others get credit too.
- **One real trade-off** (outbox vs CDC), with the constraint at the time and a recorded follow-up. This is the depth signal, and it invites the "why not X?" probe on the candidate's terms.
- **Results are measurable:** staged rollout, deploy time, reconciler mismatches, no duplicate charges.
- **Hindsight** shows self-awareness without undermining the project.
- The **tech-stack list was removed.** Naming technologies is not depth; explaining one decision is.`,
      followUps: [
        {
          q: 'The reconciler found 14 mismatches. How did they happen, and why did you trust the system enough to go to 100%?',
          a: 'Strong answers name a real root cause: for example, a retry path in the monolith that committed the order but skipped the outbox row when a timeout fired after commit. Then say how you fixed the class of bug (outbox insert in the same transaction, not after it), and set a **go/no-go criterion**: "zero mismatches for 5 consecutive days at 50% traffic". Trusting the cut-over because of a criterion you defined in advance is the senior signal. Saying "it looked fine" is not.',
        },
        {
          q: 'If you had 6 months instead of 8 weeks, would you still choose the outbox over CDC?',
          a: 'Show that the decision was conditional. With 6 months, I would likely pick CDC (Debezium on the Postgres WAL), because it removes app-level dual-write code from every service and captures writes made outside the app (scripts, manual fixes). The cost is running Kafka Connect, managing schema evolution and on-call skills. With the team we had, I’d still pilot CDC on one table first. Admitting the original choice was constraint-driven, not "best", raises credibility.',
        },
      ],
    },
    {
      id: 'beh-framework-cc-2',
      title: 'Answer Lab: "Why are you leaving, and what are your expectations?"',
      context:
        'Final hiring-manager round at a Bangalore product company. The HM asks: "Why are you looking to move, what is your notice period, and what are you expecting compensation-wise?" The candidate has a 90-day notice period with a buyout clause and is mid-way through another process.',
      task: 'Rewrite the answer so it is forward-looking, factually precise about notice and buyout, handles compensation professionally (no made-up figures; anchored on level and research), and is honest about the other process, all in under 90 seconds.',
      starter: {
        language: 'text',
        title: 'Weak answer (as delivered)',
        code: `"Honestly my current manager is not very good, he takes credit for everything
and there is a lot of politics, and the appraisal was very bad this year even
though I worked very hard. So I want to leave as soon as possible.

Notice period is 90 days but I can join in 15 days, I will manage somehow.

For salary, I want at least 60% hike, because other companies are giving
that. Actually I already have an offer from another company for much more
so you will have to match it. If you give a good offer I will join you."`,
      },
      hints: [
        'Every sentence about the manager and appraisal is a red flag. What forward-looking reason would be true for this candidate?',
        '"I can join in 15 days, I will manage somehow" against a 90-day clause: what facts should be stated instead?',
        'A percentage hike demand plus a vague, possibly unverifiable competing offer: how do you anchor on level and keep the offer claim factual?',
      ],
      solution: {
        language: 'text',
        title: 'Strong rewrite (example to adapt)',
        code: `WHY MOVING (forward-looking, one neutral fact)
"I've spent four years on our order platform and I'm proud of how it scales
now. The work has shifted to maintenance after a reorg, and I want to work on
payments reliability at higher scale, which is exactly this team's charter."

NOTICE (facts + realistic date)
"My contractual notice is 90 days. Policy allows a buyout, and I've confirmed
with HR that they usually release after a 30-45 day handover. So realistically
I can join 45-60 days from offer. If a buyout helps reach an earlier date, I'm
open to discussing it."

COMPENSATION (level first, researched range, exact current breakdown)
"I'd like us to first agree on the level. From what I've discussed with the
recruiter, this maps to Senior SDE. My current CTC is [fixed] + [variable] +
[unvested ESOPs], and I can share the breakdown. For this level and location,
my research puts a fair range at [researched range], depending on the equity
mix. I'm flexible on the split."

OTHER PROCESS (true, factual, no pressure tactics)
"I'm also in the final stage with one other company, with a decision expected
in about two weeks. This role is my first preference because of the domain,
and I'll keep you posted on timelines."`,
      },
      explanation: `**Improvements:**
- **No criticism of the manager.** The reorg is stated once, neutrally, and the answer pivots to what the candidate wants. A bitter answer is one of the strongest red flags in an HM round.
- **The notice period is factual.** It covers the clause, the buyout policy, the realistic release and a date range. Promising 15 days against 90 days is the kind of slip that loses offers after acceptance.
- **Compensation is anchored on level and research**, not on a hike percentage. A percentage ties your new pay to your old pay, which may be under market, and it sounds transactional. The CTC components are made explicit to avoid later surprises.
- **The other process is mentioned honestly.** It gives a timeline without "match it or else". Inventing or exaggerating offers is risky because offer letters are often verified.
- The answer stays **under 90 seconds**, and its tone is calm and precise, which is itself a seniority signal.`,
      followUps: [
        {
          q: 'Your current employer comes back with a counter-offer after you accept ours. What do you do?',
          a: 'Answer with your actual decision rule, stated in advance. For example: "My reasons for moving are scope and domain, and a counter does not change those, so I would decline it." If you genuinely would weigh a counter, don’t promise otherwise. Say you would make a decision within a day and be transparent with both sides. The HM is testing reliability. Accepting and then reneging damages your reputation in small Indian hiring networks far more than an honest "I’ll decide by Friday".',
        },
        {
          q: 'We can only offer the lower end of your range. Would you still consider it?',
          a: 'Move the discussion to the components and the level, not a yes or no. Ask whether a joining bonus, equity refresh, notice buyout reimbursement, or an early review at 6 months tied to agreed expectations can bridge the gap. Check that the level is right: being down-levelled costs more over 3 years than a smaller fixed pay. Say what matters most to you, then ask for a day to decide. Never accept or reject in panic on the call.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'beh-framework-iq-01',
      difficulty: 'hard',
      question:
        'Pick the system you know best from your current job and draw it for me. Then go box by box: which choices would you still make today, and which would you reverse if traffic were ten times higher?',
      context:
        'Reported in Uber SDE-2 hiring-manager rounds in Bangalore (LeetCode Discuss): the HM walked through the candidate’s past design choices and asked whether they would hold under different conditions. The round ran well over an hour.',
      whatInterviewerLooksFor: [
        'Real understanding of the system, not just familiarity with your own tickets',
        'Decisions explained by the constraints at the time (scale, team, deadline)',
        'The ability to name what breaks first at 10x, and why',
        'Honest hindsight without trashing the team',
        'A clear line between "the team decided" and "I decided"',
      ],
      modelAnswer: `**Approach:** draw first and narrate second. For each component, give *the choice, why it was right then, and what changes at 10x*. Pick 3–4 boxes to go deep on, not all 12.

**Example (illustrative): an order-and-payment backend**
- **API gateway → NestJS order service → Postgres (primary + 1 replica).** *Still right:* relational integrity for orders and payments, and the team knows Postgres. *At 10x:* write throughput on a single primary is the first wall (~2k orders/min becomes ~20k). I'd partition by merchant or region before sharding, and move order-history reads to a read model.
- **Order events via SQS/SNS.** *Then:* ~300 events/s, no Kafka ops skills, AWS-native. *At 10x:* still OK on throughput, but we would want replay to rebuild projections. That is the point where I'd move to Kafka/MSK. **I'd reverse this one.**
- **Redis cache for product price lookups (TTL 60s).** *Still right,* but at 10x a hot-key problem appears on sale items. I'd add request coalescing and local in-process caching for the top-N SKUs.
- **Synchronous call from order to inventory.** *I would reverse this now.* It couples checkout availability to inventory latency. A reservation via an async saga with a timeout is safer. We kept it because the inventory team's roadmap couldn't absorb the change. That was a cross-team constraint, not a technical one.

**My part:** I designed the order service's data model and the event contracts. The sync inventory call predates me. I raised it in a design review and it's in the backlog with an incident linked to it.

**What I'd stress:** "Right at the time" and "right at 10x" are different questions. A senior engineer can defend the first and still plan the second.`,
      followUps: [
        {
          q: 'You said the sync inventory call should be async. What did you do about it, given it was not your service?',
          a: 'Strong answers show influence without authority. For example: "I attached two incident timelines where inventory p99 spikes took checkout down, wrote a one-page proposal for a reservation API with a TTL, and offered to build the client side and the saga ourselves. The inventory team agreed to a Q3 slot." If nothing happened, say so honestly and explain what you did to reduce the risk meanwhile, such as a timeout plus a circuit breaker and a degraded "reserve later" mode.',
        },
        {
          q: 'Which of these decisions were yours, and which did you inherit?',
          a: 'Be precise and unembarrassed. For example: "The Postgres and SQS choices predate me. I owned the order data model, the event schemas and the idempotency design." Interviewers ask this because candidates often present the whole architecture as theirs. A clean answer here makes everything else you said more credible. Then say which inherited decision you would defend and why. Defending inherited choices on their merits shows you understood them.',
        },
        {
          q: 'What breaks first at 10x, and how would you find out before customers do?',
          a: 'Name a specific bottleneck and how you would test it. "The primary’s write IOPS and connection count: 40 pods × 20 pool size is already 800 connections against a max of ~1,000." Then the method: a load test at 3–10x with production-shaped data, saturation dashboards (CPU, connections, lock waits, queue depth), and a capacity review before the sale. Giving a number for the headroom is what makes the answer sound senior.',
        },
      ],
      pitfalls: [
        'Describing the architecture without ever saying what you personally designed',
        'Saying every choice was perfect, or that every choice was the previous team’s mistake',
        '"At 10x we would just add more pods" without naming the stateful bottleneck',
        'Going through all 12 boxes shallowly instead of 3–4 deeply',
      ],
    },
    {
      id: 'beh-framework-iq-02',
      difficulty: 'medium',
      question:
        'We have 45 minutes and I have read your CV. In about a minute and a half, tell me who you are as an engineer and what you want your next two years to look like.',
      whatInterviewerLooksFor: [
        'A level signal in the first 30 seconds (scope, scale, ownership)',
        'Two concrete accomplishments with numbers that invite deeper questions',
        'Self-awareness about how you work',
        'A believable bridge to this role, not a generic one',
      ],
      modelAnswer: `**Structure (now → signature work → how I work → next two years):**

**Now:** "I'm a backend engineer with about seven years of experience, the last four on the order and payments platform of an e-commerce company. Around two dozen NestJS services on Kubernetes, a GraphQL gateway, Postgres and Kafka, with peaks of several thousand RPS on sale days."

**Signature work (one depth, one leadership):**
- "I led the extraction of order management out of our monolith using a strangler approach. Three teams, zero-downtime cut-over, deploy time down from about 90 minutes to 10."
- "I redesigned our payment-callback handling around idempotency keys and a reconciliation job. Duplicate-charge tickets went from weekly to essentially none."

**How I work:** "I'm happiest when I'm making a system more reliable and making the people around me faster. About half my time now goes to design reviews and mentoring. Two engineers I mentored run on-call on their own now."

**Next two years:** "I want to go deeper on high-scale, correctness-critical systems, ideally owning a platform other teams depend on, and grow into a tech-lead role where I set direction across a couple of teams. That's why a payments infrastructure team at your scale is interesting to me."

**Why this works:** the interviewer now has three hooks (the strangler migration, idempotency, mentoring) and a level hint (multi-team scope, design reviews). Everything after this becomes a deep dive into material you chose.

**Delivery tips:** rehearse it until it is natural, but don't memorise it word for word. Stop at around 90 seconds. Don't list every technology, and don't start from college.`,
      followUps: [
        {
          q: 'You said you want to be a tech lead. Have you done any of that already?',
          a: 'Give evidence, not aspiration: "Informally, yes. For the order-service extraction I wrote the RFC, ran the design review, split the work across three engineers and ran a weekly sync with the payments team." Then say what you have NOT done yet ("I haven’t owned a team’s roadmap or done performance reviews"). Calibrated self-assessment shows maturity and gives the HM an honest picture of how ready you are.',
        },
        {
          q: 'Why the move to payments specifically, rather than staying general?',
          a: 'Tie it to experience and to a real interest, for example: "The idempotency and reconciliation work was the most satisfying engineering I’ve done. Correctness under failure is a problem I like more than raw feature delivery." Mention something specific about this company’s payments problem (scale, regulatory constraints, reliability expectations). Avoid "payments pays well" or "it’s a hot domain".',
        },
      ],
      pitfalls: [
        'Reading out the CV chronologically from college onwards',
        'A list of technologies without any outcome',
        'Going over 3 minutes and using up time meant for deeper questions',
        'Vague goals such as "I want to learn and grow" with no link to the role',
      ],
    },
    {
      id: 'beh-framework-iq-03',
      difficulty: 'medium',
      question:
        'You have been at your current company for under 18 months, and before that about two years at the previous one. Why move again now, and why should I believe you will stay here?',
      context:
        'Short stints are common in the Indian market and HMs do ask about them. Candidate reports from Swiggy and Flipkart HM rounds list "why are you moving out" among the standard questions.',
      whatInterviewerLooksFor: [
        'Honest, forward-looking reasons with no bitterness',
        'A pattern that makes sense (each move gained something specific)',
        'Evidence that this role matches what you are looking for',
        'Calm handling of a slightly uncomfortable question',
      ],
      modelAnswer: `**Approach:** acknowledge the pattern, explain each move by what you **gained**, give the real reason for now in one neutral sentence, and connect it to what this role offers that the last two did not.

**Example answer:**
"That's a fair question. Both moves were deliberate. At my first company I learned backend fundamentals in a services setup, but I was working across many short client projects and never owned anything in production for long. I moved to a product company to own a system end to end. Over the last 16 months I've owned the order service, its on-call and its roadmap.

The reason now is narrower. After the funding slowdown our team was merged into another, and the roadmap is now mostly maintenance and cost reduction. I've done a useful piece of that: I cut our compute bill by around 30% by right-sizing pods and moving batch jobs to spot instances. But I want to build at a larger scale again.

On staying: the two things I'm looking for are a product where reliability *is* the business, and a team that's investing for several years rather than one quarter. From what I've learned about this team's charter and your engineering blog's posts on payment routing, that's what this is. I'd rather join a place where I can see a 3–4 year arc, and I'm asking you questions today partly to test that."

**What makes it work:**
- The **pattern is reframed as intentional** (services → ownership → scale).
- **One neutral fact** (team merge) explains the timing, with no blame.
- Even in the "bad" period there is **impact** (the 30% cost cut).
- The answer **turns the question around**: the candidate is also evaluating fit, which signals they won't jump lightly.`,
      followUps: [
        {
          q: 'What would make you leave this job in a year?',
          a: 'Be honest and specific, not "nothing". For example: "If the team stops investing in the platform, say two quarters of pure feature churn with no reliability work, and I can’t influence that through the normal channels, I’d raise it with you first." This shows that you know your motivators, and that you raise problems before leaving. Mentioning a conversation with the manager before any exit is the key maturity signal.',
        },
        {
          q: 'If I called your current manager, what would they say about your decision to leave?',
          a: 'Answer only with what is likely true, for example: "They’d be disappointed but not surprised. We’ve discussed that the team’s direction doesn’t match what I want, and I’ve committed to a clean handover: runbooks, an on-call transition, and pairing with my replacement." If you haven’t told them yet, say you will handle it professionally once you have an offer. Never imply bad blood.',
        },
      ],
      pitfalls: [
        'Blaming the manager, appraisal or "politics"',
        'Saying compensation is the main reason (even if it matters, it should not be the headline)',
        'A defensive tone or over-explaining',
        'Promising "I will stay 10 years" with no reasoning',
      ],
    },
    {
      id: 'beh-framework-iq-04',
      difficulty: 'hard',
      question:
        'What is the single most impactful thing you shipped in the last twelve months, and how do you know it was impactful rather than just busy work?',
      whatInterviewerLooksFor: [
        'A choice of project tied to a business or user outcome, not just effort',
        'A baseline, an after number and a measurement method',
        'Awareness of confounders (seasonality, other launches)',
        'Scope appropriate to the target level',
      ],
      modelAnswer: `**Approach:** pick the project with the clearest *outcome*, not the biggest effort. Show the measurement chain: **the metric, the baseline, the change, the method, and why it matters to the business**. Then address attribution: how do you know it was *your* change?

**Example STAR (illustrative):**
- **S:** "About 2.5% of UPI payment attempts on our checkout ended 'pending' because the PSP callback arrived late or not at all. Each one became a support ticket and often a manual refund 3–5 days later."
- **T:** "I owned the payment-status service. My goal was to cut unresolved-pending payments in half within a quarter."
- **A:** "I analysed two weeks of callbacks and found 70% of 'pending' cases had actually succeeded at the PSP. We just never heard back. I built a status-poller with exponential backoff (30s, 2m, 10m, 1h) for payments without a callback, made the status transition idempotent so a late callback and a poll result couldn't double-credit, and added a reconciliation job against the PSP's settlement file. I rolled it out behind a flag to 10% of merchants first."
- **R:** "Unresolved-pending went from ~2.5% to ~0.4% of attempts. Payment-related support tickets fell about 60%. Finance cut manual refund processing from a daily task to a weekly one."
- **Attribution:** "The 10% flag rollout gave us a clean comparison group for two weeks, so the drop isn't from seasonality or a PSP improvement. The control group stayed at about 2.4%."

**Why it scores:** the impact is in **customer and business terms** (tickets, refunds, finance effort), the measurement is **credible** (a flag-based comparison), and the technical depth (backoff, idempotent transitions, reconciliation) is visible without being the headline.`,
      followUps: [
        {
          q: 'How did you decide the polling schedule, and did it cause any load problems with the PSP?',
          a: 'Explain the reasoning: callback latency data showed most late callbacks arrive within 2 minutes, so early polls catch the bulk, and back-off beyond 1 hour avoids hammering the PSP for payments that genuinely failed. Mention a budget: "at peak ~50 pending/min × 4 polls = ~200 calls/min, well below the PSP’s documented rate limit." Also mention a circuit breaker on the poller so a PSP outage doesn’t create a retry storm.',
        },
        {
          q: 'Suppose there had been no feature flag. How would you have shown it was your change that worked?',
          a: 'Use weaker but honest evidence. Compare the same weeks year over year, compare against PSPs or payment methods not covered by the change, look for a step change aligned with the deploy timestamp, and check that no other launch overlapped. State the confidence level: "strongly suggestive, not proven". Saying how certain you are, and why, is better than claiming full causation.',
        },
      ],
      pitfalls: [
        'Picking the longest or hardest project instead of the one with the clearest outcome',
        'Results with no baseline ("much faster", "very successful")',
        'Claiming full credit for a metric that many teams moved',
        'Being unable to explain how the number was measured',
      ],
    },
    {
      id: 'beh-framework-iq-05',
      difficulty: 'hard',
      question:
        'Give me an example of something you fixed or built that nobody assigned to you. How did you notice it, and how did you get the time to do it?',
      context:
        'Ownership / initiative probe. Meta’s publicly discussed signal areas include initiative and scope, and Atlassian’s published values include "Be the change you seek".',
      whatInterviewerLooksFor: [
        'Noticing a problem from signals others ignored (alerts, tickets, toil)',
        'Making the case and securing time legitimately, not working in secret',
        'Following through to adoption, not just a prototype',
        'Measured impact on others (team, on-call, customers)',
      ],
      modelAnswer: `**Approach:** show the full ownership loop: **notice → quantify → propose → secure time → deliver → drive adoption → measure.** The "how did you get time" part separates mature ownership from heroics.

**Example STAR (illustrative):**
- **S:** "Our Kafka consumers occasionally got stuck on poison messages. On-call would page, someone would manually skip the offset, and we'd lose the event. It happened 2–3 times a week across four teams' services, and nobody owned it because every team saw it as an occasional annoyance."
- **T:** "No-one asked me, but I'd been paged for it four times in a month and I could see it was a shared-library problem, not a per-service one."
- **A:** "I pulled three months of PagerDuty data: 31 pages and roughly 40 engineer-hours, plus two incidents where a skipped event caused a wrong order status. I wrote a one-page proposal for a retry-topic + DLQ wrapper in our shared NestJS Kafka module and took it to my manager with an ask of one sprint, traded against a low-priority feature. Once she agreed, I built the module with configurable retry tiers and an idempotency guard, added a DLQ replay CLI, and wrote a migration guide. Then I paired with one engineer from each of the other three teams to adopt it, instead of just announcing it."
- **R:** "Within six weeks, all four teams were on it. Poison-message pages went from ~2.5/week to near zero, and the DLQ replay tool was used about 20 times in the next quarter instead of skipping events. It became the default in our service template."

**Key signals:** the candidate **quantified the toil** to earn the time, **traded scope openly** with the manager, and **drove adoption** across teams. That last step is what makes it senior rather than a side project.`,
      followUps: [
        {
          q: 'What if your manager had said no, because the feature was more important?',
          a: 'Show that you accept prioritisation and still reduce the risk. For example: "I’d accept it, ask what evidence would change the decision, and agree a trigger, such as another data-loss incident or 10 more pages. Meanwhile I’d write the runbook and a small skip-with-log script so at least events aren’t silently lost." Disagree-and-commit, plus a cheap mitigation, beats going rogue on nights and weekends.',
        },
        {
          q: 'How did you convince the other three teams to adopt something they had not asked for?',
          a: 'Lower their cost to near zero and show them their own data. "I showed each team their own page count from PagerDuty, offered to pair on the migration (about 2 hours per service), and made the module a drop-in replacement with the same decorator API." Use an early adopter as social proof. Saying you got adoption through effort and evidence, not a mandate, is the influence signal.',
        },
      ],
      pitfalls: [
        'A story where "nobody assigned it" because it was trivial',
        'Doing it secretly on weekends with no alignment, which suggests prioritisation problems',
        'Stopping at "I built a library" with no adoption or results',
        'Criticising other teams for not owning it',
      ],
    },
    {
      id: 'beh-framework-iq-06',
      difficulty: 'medium',
      question:
        'Your profile says 90 days notice. This team needs someone in roughly six weeks. Walk me through how you would actually make that work, or tell me honestly if it cannot.',
      context:
        'India-specific hiring-manager topic. Notice periods are contractual (commonly 30–90 days), buyouts are company-policy dependent, and long notice windows are a known hiring friction in Indian tech.',
      whatInterviewerLooksFor: [
        'Exact knowledge of your own contract terms and policy',
        'A realistic date range rather than an optimistic promise',
        'Proactive options (buyout, early release, leave adjustment)',
        'Professionalism towards the current employer (clean handover)',
      ],
      modelAnswer: `**Approach:** facts → options → realistic commitment → risk disclosure.

**Example answer:**
"My contractual notice is 90 days. I've read the policy, and there are two levers.

1. **Buyout:** the policy allows the unserved notice to be paid off. My understanding is that it's calculated on basic pay, but I'd confirm the exact amount with HR once I have an offer. If your company supports buyout reimbursement, that changes things a lot.
2. **Early release:** in practice, my company releases people early once handover is done. In the last year, two engineers on my team were released after about 45 days. I'd also check whether my leave balance can be adjusted against notice.

So my **realistic** commitment is 45–60 days from offer acceptance. The six-week date is possible but not guaranteed. I'd rather tell you 60 and join at 45 than promise 42 and slip.

For the **handover**, I'd plan it from day one of my notice: documented runbooks for the two services I own, an on-call transition with a shadow week, and pairing with whoever takes over the order-service roadmap. A clean exit matters to me, and it also makes the early release much more likely.

If six weeks is a hard requirement, I'd ask whether a staggered start works. For example, I could do onboarding reading and access set-up in advance, if that's appropriate and doesn't conflict with my current employment terms."

**Why it scores:** it is precise, honest about uncertainty, and offers options. It is also loyal to the current employer, which tells the HM how you will behave when you eventually leave *them*.`,
      followUps: [
        {
          q: 'What if your company refuses buyout and insists on the full 90 days?',
          a: 'Accept the constraint and give the HM a firm date: "Then my joining date is 90 days from resignation. I won’t walk out early or ask for a fake release, because a relieving letter and clean exit matter for background checks." Offer to stay in touch: for example, "I can join one design review informally if that’s appropriate". Let the HM decide whether the role can wait. Integrity here signals how you will handle commitments later.',
        },
        {
          q: 'Have you resigned already? Some candidates resign before interviewing to shorten the wait.',
          a: 'Answer truthfully. If you haven’t: "No. I’ll resign once I have a written offer, and the notice countdown starts then." If you have, give the exact last working day. Don’t imply a shorter notice than you have. Resigning before interviewing is a legitimate personal choice in the Indian market, but the HM needs the actual date, not a sales pitch.',
        },
      ],
      pitfalls: [
        'Promising an early date "somehow" without checking policy',
        'Not knowing your own notice clause or buyout terms',
        'Suggesting you will skip the handover or abscond',
        'Sounding irritated by the question',
      ],
    },
    {
      id: 'beh-framework-iq-07',
      difficulty: 'hard',
      question:
        'Suppose we make you an offer next week and your current company counters with a significant raise and a promotion. What will you do, and why should I trust that answer?',
      context:
        'India-specific HM probe: counter-offers are common during 60–90 day notice windows, and offers declined after acceptance are a known pain for Indian hiring managers.',
      whatInterviewerLooksFor: [
        'A decision rule rooted in non-monetary reasons that are actually true',
        'Honesty over telling the HM what they want to hear',
        'A commitment to transparency about timelines',
        'Awareness of why counter-offers often fail to fix the underlying reason',
      ],
      modelAnswer: `**Approach:** state your **real motivation**, your **decision rule**, and a **commitment about behaviour** (speed and transparency). Don't make promises you wouldn't keep. The HM is testing reliability, not loyalty.

**Example answer (if it is true for you):**
"I've thought about that, because it's likely to happen. My reasons for moving are the kind of problems and the scale. Our team's roadmap is maintenance for the next year, and I want to build correctness-critical systems at a larger scale. A raise or a title doesn't change the roadmap, so I would decline it.

Why you should trust it: I've already had a conversation with my manager about the team's direction. They know it doesn't match what I want, and that wasn't about money. And I'm only in two processes, both for this kind of role.

What I commit to: if anything changes in my situation, you'll hear it from me within a day, not via silence on joining day."

**If you are genuinely open to a counter:** say that instead, framed honestly. "Compensation is one factor, so I'd consider a counter seriously, but the deciding factors will be scope and team. I'll be transparent and give you a decision within 48 hours of any counter." This loses a little in the moment and keeps your reputation intact.

**Why counter-offers often don't fix things (useful context, say it lightly):** the reasons people leave, such as scope, manager, growth or direction, rarely change with a pay adjustment. Your current employer also now knows you were looking.`,
      followUps: [
        {
          q: 'You mentioned you are in another process. If they offer more than us, what happens?',
          a: 'Be transparent and factual: "I’ll tell you the offer exists and its level, and compare on role, team and growth first. If compensation is the only gap, I’ll say so and ask if there is flexibility." Don’t use the offer as a threat or inflate it. Indian recruiters often verify offers, and saying where you would be flexible is more useful to the HM than an ultimatum.',
        },
        {
          q: 'Have you ever accepted an offer and then not joined?',
          a: 'Answer truthfully. If yes, own it briefly: what happened, how you communicated it, and what you do differently now (for example, "I now only accept once I’ve fully decided, and I tell the other company the same day"). A brief, owned answer recovers trust. Being evasive here, when an HR background check can surface it, is a serious red flag.',
        },
      ],
      pitfalls: [
        'An automatic "I will never accept a counter" that sounds rehearsed',
        'Using the counter-offer as leverage in the same breath',
        'Criticising the current employer to make the decision sound obvious',
        'Being vague about other processes and timelines',
      ],
    },
    {
      id: 'beh-framework-iq-08',
      difficulty: 'medium',
      question:
        'Before we talk numbers, how have you researched what this level pays, what is in your current CTC, and what range are you expecting?',
      context:
        'India-specific: CTC structures (fixed, variable, ESOP/RSU, joining bonus, retention) make comparisons error-prone, and this question often comes from the hiring manager as well as the recruiter.',
      whatInterviewerLooksFor: [
        'A level-first framing, so the conversation is about role, not past salary',
        'A precise understanding of CTC components (fixed vs variable vs equity)',
        'A researched, defensible range rather than a hike percentage',
        'A professional, non-adversarial tone',
      ],
      modelAnswer: `**Approach:** (1) agree the level, (2) describe your current CTC precisely, (3) give a researched range with its basis, (4) say what you're flexible on.

**Example answer:**
"I'd like to make sure we're aligned on level first. From my conversations with the recruiter, this role maps to Senior SDE, and I'd want the offer to reflect that level.

**Current CTC, precisely:** it's [fixed] base, plus a [variable] performance bonus that paid out at about [x]% last year, plus ESOPs vesting over four years. I'd separate those, because the ESOPs are illiquid and the variable isn't guaranteed. I'm happy to share the breakdown.

**Research:** I've looked at public data on Levels.fyi for this company and level in Bangalore, spoken to two people at similar companies, and compared offers peers received recently. On that basis, a fair range for this role is [your researched range] total, with the fixed component around [range].

**Flexibility:** I'm flexible on the split between fixed and equity, and a joining bonus can bridge timing gaps such as unvested equity I'd leave behind. What matters most to me is the level and the fixed component."

**Principles behind it:**
- **Level drives pay bands.** Getting the level right is worth more over 3 years than negotiating ₹X at the wrong level.
- **A hike percentage ties you to your old salary**, which may be below market. A range anchored on research ties you to the market.
- **Be exact about what you have.** Misstating CTC (for example, counting unvested ESOPs as cash) can surface during document checks and damage trust.

(Fill the brackets with your own researched figures. This topic deliberately gives no salary numbers.)`,
      followUps: [
        {
          q: 'Our policy is a fixed percentage over current CTC. Your range is above that. How do you respond?',
          a: 'Stay calm and reframe toward the market and the level. Explain why your current CTC is below the market for this level (for example, a services-company pay band), and point to your research for the level. Ask whether the cap can be met through other components: a joining bonus, equity, a notice buyout reimbursement, or an early compensation review tied to agreed goals. Ask what flexibility exists rather than making it a standoff, and ask for time to decide.',
        },
        {
          q: 'Why should we pay at the top of your range?',
          a: 'Link it to evidence from the interview loop, not need. For example: "I’m coming in with directly relevant experience, payments idempotency and reconciliation at scale, which is this team’s core problem, and I’ve led cross-team migrations. I expect to be productive on on-call and design reviews within the first quarter." Offer to anchor part of it on performance (for example, a review after 6 months) if they hesitate.',
        },
      ],
      pitfalls: [
        'Leading with a hike percentage ("at least 50%")',
        'Counting unvested ESOPs or uncertain bonuses as guaranteed pay',
        'Refusing to discuss compensation at all, or being aggressive about it',
        'Quoting a number with no research behind it',
      ],
    },
    {
      id: 'beh-framework-iq-09',
      difficulty: 'expert',
      question:
        'If you could rebuild one part of your current production system from scratch, what would it be? And why has your team not already done it?',
      context:
        'Mirrors reported Swiggy and Uber HM-round probing ("why did you choose that, what alternatives") but asks for the candidate’s own critique of the system.',
      whatInterviewerLooksFor: [
        'A specific, technically sound critique with its cost spelled out',
        'An understanding of why the debt persists (organisational, risk, priority)',
        'A pragmatic incremental path instead of a rewrite fantasy',
        'Evidence that you have already tried to move it',
      ],
      modelAnswer: `**Approach:** choose something with **measurable pain**, explain the **technical root cause**, be honest about **why it persists** (often organisational, not technical), and present an **incremental plan**, ideally one you have started.

**Example (illustrative):**
"I'd rebuild how our services share order state. Today, five services read and write the same 'orders' Postgres schema directly, a leftover from the monolith split. The pain is concrete:
- Every schema migration needs five teams to coordinate. Our last column rename took 6 weeks.
- Two incidents last year were caused by one service's long-running analytics query locking rows other services needed.
- Nobody can say which service owns an order's status.

**What I'd build:** a single order service that owns the table, with a narrow API for writes and change events (outbox → Kafka) for readers. Readers that need joins would get their own read models.

**Why it hasn't happened:**
1. It doesn't map to a product feature, so it loses quarterly prioritisation.
2. The migration risk is high. Orders are revenue-critical, and nobody wants to own a big-bang cut-over.
3. Ownership is fuzzy across five teams.

**What I've done about it:** I wrote an RFC with an incremental plan. First, add the outbox events while leaving direct reads in place. Then move one consumer at a time to events. Then revoke write grants service by service. I attached the incident costs. Step one is approved for next quarter, and I've already removed one service's write access, the analytics job, which was the riskiest."

**Why it scores:** it is specific, technically correct, and **organisationally aware**. A shared-database anti-pattern persists because of incentives, and it describes a plan already in motion. Senior and staff signal is about *getting the change made*, not only spotting it.`,
      followUps: [
        {
          q: 'Five teams use that schema. How would you sequence the migration so no team is blocked for a quarter?',
          a: 'Make it additive and reversible. (1) Publish events alongside the existing writes, with no consumer change needed. (2) Migrate readers one at a time, starting with the one that has the most incidents or least coupling, and keep a fallback to direct reads behind a flag. (3) Move writers onto the order service API with dual-write verification. (4) Revoke grants. Each team’s work is a sprint or less, scheduled in their quarter, with the platform team doing most of the heavy lifting.',
        },
        {
          q: 'What if leadership says this will never be prioritised?',
          a: 'Reduce the risk inside normal work instead of fighting the roadmap. Attach small steps to features that touch the schema anyway, add guardrails (statement timeouts and read-only replicas for analytics), and record the cost of each incident against the RFC. Bring it up again with data at planning time. Also accept it if the business trade-off is genuinely right: not every piece of debt needs paying.',
        },
      ],
      pitfalls: [
        '"I would rewrite everything in Go/Rust", a rewrite fantasy with no plan',
        'Blaming previous engineers for the design',
        'Choosing something cosmetic (folder structure, naming)',
        'No acknowledgement of why sensible people have not fixed it yet',
      ],
    },
    {
      id: 'beh-framework-iq-10',
      difficulty: 'hard',
      question:
        'Describe a time you had to get a non-engineering stakeholder (finance, ops or sales) to accept a technical trade-off they initially disliked. How did you explain it?',
      whatInterviewerLooksFor: [
        'Translation of technical constraints into business consequences',
        'Listening to and understanding the stakeholder’s real concern',
        'Options with explicit costs rather than a single "no"',
        'An outcome both sides accepted, plus how the relationship ended up',
      ],
      modelAnswer: `**Approach:** start from the **stakeholder's goal**, translate the trade-off into **their units** (money, risk, time, customers), offer **2–3 options with costs**, and let them choose within the constraints.

**Example STAR (illustrative):**
- **S:** "Finance wanted real-time settlement reports, with every payment reflected in their dashboard within seconds, because they were reconciling against bank statements manually and errors were costing them hours a day."
- **T:** "I owned the payments data pipeline. Real-time meant reading from the transactional Postgres under load, which would put checkout latency at risk during sales."
- **A:** "I first sat with the finance lead for an hour to see the actual workflow. It turned out they reconciled twice a day, at 11:00 and 17:00. They didn't need seconds. They needed *correct and complete* data at those times, and to know when a payment was still in flight. I gave them three options in a one-page doc:
  1. True real-time from the primary DB. Cost: checkout risk on sale days, so not recommended.
  2. CDC to a reporting store with ~1–2 minutes of lag. Cost: about 3 weeks of work plus a small infra cost.
  3. A 15-minute batch with an explicit 'in-flight' flag. Cost: 1 week.

  I recommended option 3 now and option 2 next quarter, and explained that 'real-time but occasionally missing rows' is worse for reconciliation than '15 minutes behind but complete'."
- **R:** "They picked option 3. Manual reconciliation time dropped from ~3 hours a day to ~30 minutes, with no checkout impact during the sale. We built CDC the next quarter when another team needed it too, and finance became one of our strongest supporters for platform work."

**The key move:** finding out the real need (twice-daily completeness) instead of arguing about the stated requirement ("real-time").`,
      followUps: [
        {
          q: 'What if the finance lead had insisted on real-time anyway?',
          a: 'Make the risk explicit and decide the trade-off at the right level, not escalate it as a fight. Write down the checkout risk with numbers (for example, "replica lag and lock contention during the last sale added 300ms to p99"), propose a safer real-time path (CDC) with its timeline, and ask both product and finance leadership to decide together. If they accept the risk, document it and add guardrails such as statement timeouts and a kill switch.',
        },
        {
          q: 'How did you make sure the "in-flight" flag was understood correctly by finance users?',
          a: 'Test it with real users: walk two finance analysts through a reconciliation with the new report, add a tooltip and a short doc explaining the states (settled, in-flight, failed), and watch the first week’s questions in their channel. One sentence on adoption and feedback shows the change was made to work for users, not just shipped.',
        },
      ],
      pitfalls: [
        'Explaining in technical jargon (replica lag, WAL) instead of business terms',
        'Saying "that is not possible" with no options',
        'Treating the stakeholder as unreasonable',
        'Never discovering the real underlying need',
      ],
    },
    {
      id: 'beh-framework-iq-11',
      difficulty: 'hard',
      question:
        'Tell me about a time you chose the customer’s interest over your team’s convenience or a deadline, when it cost your team something real.',
      context:
        'Values-style prompt. Atlassian runs a dedicated values interview against its five published values, one of which is "Don’t #@!% the customer"; the interviewer is often from outside the hiring team.',
      whatInterviewerLooksFor: [
        'A real, felt cost to the team (time, a missed date, extra on-call)',
        'A customer impact that is concrete and evidenced',
        'A decision made transparently, with stakeholders informed',
        'Reflection on the trade-off, not martyrdom',
      ],
      modelAnswer: `**Approach:** make both sides of the trade-off vivid. The **customer harm** you prevented and the **team cost** you accepted. Show you made the call transparently and would make it again (or explain what you would refine).

**Example STAR (illustrative):**
- **S:** "Two days before a planned release of a new refund API, I found in testing that partial refunds on split-payment orders (wallet + card) could refund the full amount to the card when the wallet leg had already been refunded. That affected roughly 1 in 400 refunds."
- **T:** "The release was tied to a marketing announcement for merchants, and my team had already moved on to the next quarter's work. Fixing it properly meant redoing the refund allocation logic."
- **A:** "I wrote up the issue with three real order examples and the expected money loss and confusion, and recommended holding the split-payment path while shipping everything else on schedule. I talked to the PM and the merchant-success lead the same afternoon. We agreed to release with split-payment refunds routed to the old flow behind a flag, and I told merchants via release notes that it was coming in two weeks. Then I worked with one teammate to rewrite allocation as a ledger-style calculation per payment leg, with property-based tests across 10k generated orders."
- **R:** "The release went out on time for 97% of refund volume. The split-payment fix shipped 11 days later with zero mismatches in the reconciliation job since. The cost: two engineers lost almost two sprint weeks of planned work, and a dashboard feature slipped a sprint. The merchant-success team later told us two large merchants specifically used split payments, so a bad launch would have hit our biggest accounts."

**Reflection:** "I'd catch this earlier next time. We now have a generated-orders test suite for every money-moving API, run in CI."`,
      followUps: [
        {
          q: 'Who could have disagreed with that call, and how would you have handled it?',
          a: 'Name them: marketing, who wanted the full announcement, or my EM, worried about the next quarter’s commitments. Handle it with the data: "1 in 400 refunds wrong, money leaves the company and affects our largest merchants", plus a partial-ship option so the announcement still lands. If they had insisted on shipping as-is, I’d escalate to the product head with the risk written down, because money-moving bugs are a different class of risk than UI bugs.',
        },
        {
          q: 'Is there a case where you would ship knowing about a customer-facing bug?',
          a: 'Yes, when the bug’s harm is small, reversible and visible, and delaying hurts more customers. For example, a cosmetic error on an admin page, or a rare edge case with a manual workaround support can apply, documented and fixed in the next release. The principle is to weigh the size of the harm and whether it can be reversed. Money, data loss and security bugs rarely qualify; small UX issues often do.',
        },
      ],
      pitfalls: [
        'A story where nothing was really sacrificed',
        'A unilateral decision that blindsided the PM or other stakeholders',
        'Presenting yourself as the only person who cared about the customer',
        'No learning about why the issue was found so late',
      ],
    },
  ],
  envelopeQuestions: [],
  test: [
    {
      id: 'beh-framework-mcq-01',
      difficulty: 'hard',
      question:
        'A candidate aced coding and system design for a Senior SDE role. In the behavioural round every story is about optimising a single API endpoint or fixing a bug in their own module, told clearly and with numbers. What is the most likely outcome?',
      options: [
        'Strong hire at Senior, because clear STAR answers with numbers are what the rubric rewards',
        'Hire, but down-levelled to SDE-2, because the scope of the stories does not show senior-level impact',
        'No hire, because behavioural rounds reject candidates who lack management experience',
        'The behavioural feedback is ignored, because technical rounds decide the level at product companies',
      ],
      correct: [1],
      explanation:
        'Interviewers make two decisions: hire and level. Clear, quantified stories can earn a hire, but stories confined to one endpoint or module show SDE-2 scope. Practitioner guides report that most down-levelling comes from the behavioural round. Management experience is not required for IC senior roles, and technical rounds alone rarely settle the level.',
      followUps: [
        {
          q: 'The candidate only has module-sized stories from the last two years. How can they still present at senior scope?',
          a: 'Reframe the same work at a higher altitude. Explain why it mattered to the business, which teams depended on it, what alternatives were rejected, who had to be aligned, and what changed for others afterwards (adoption, runbooks, standards). Also look further back or sideways: incidents led, onboarding owned, design reviews. The work itself does not change, but the evidence of scope and judgment becomes visible.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-02',
      difficulty: 'medium',
      question:
        'Which result line gives the interviewer the most usable evidence for the impact signal?',
      options: [
        '"The migration was a huge success, and the business and my manager were very happy with it."',
        '"After the migration, p99 order-history latency went from about 2.4s to 380ms on sale days, measured in Datadog, and ‘orders not loading’ tickets fell about 80%."',
        '"We migrated 14 services, wrote 40k lines of code, and closed 230 Jira tickets in two quarters."',
        '"Latency improved by exactly 84.17%, which is a significant improvement over the old system."',
      ],
      correct: [1],
      explanation:
        'The second option has a baseline, an after value, a measurement source and a business consequence (tickets). Option 1 is sentiment, not evidence. Option 3 measures effort (output), not outcome. Option 4 has suspicious false precision and no baseline, context or "so what", and it invites a probe the candidate probably cannot survive.',
      followUps: [
        {
          q: 'The interviewer asks "how do you know the ticket drop was caused by your change?" What makes a convincing reply?',
          a: 'Point to an attribution method: a flag-based rollout with a control group, a step change aligned with the deploy timestamp, and no overlapping launches or seasonality (comparing the same sale event year over year). Then state your confidence honestly, for example "strongly suggestive rather than proven". Showing that you thought about confounders is a senior signal in its own right.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-03',
      difficulty: 'hard',
      question:
        'An ownership story is delivered entirely as "we decided", "we built", "we fixed" for three minutes. The interviewer asks "What was your role?" and the candidate says "I was part of the team that did all of this." Select ALL problems this creates for scoring.',
      options: [
        'The Ownership box cannot be filled, because no decision or action is attributable to the candidate',
        'The level is uncertain, because the interviewer cannot tell whether the candidate led or followed',
        'It signals strong team orientation, which compensates fully for the missing individual evidence',
        'It wastes the follow-up, because the interviewer now has to spend time extracting what the candidate did',
        'It will be read as dishonest, so the candidate is automatically rejected',
      ],
      correct: [0, 1, 3],
      explanation:
        'Without "I" actions, ownership and level cannot be scored, and the interviewer burns follow-up time digging for attribution. Team orientation is good, but it does not replace evidence of individual contribution. "We" alone is not read as dishonesty or an automatic reject. It is simply missing signal, which often leads to re-asking or a lower score.',
      followUps: [
        {
          q: 'How should the candidate repair this mid-interview after the "What was your role?" question?',
          a: 'Answer with precise verbs and boundaries: "I wrote the RFC, designed the dual-write verifier, and ran the cut-over. Two teammates migrated the consumers, and the payments team owned their side." Then offer one decision that was yours and the alternative you rejected. That one clean answer usually recovers the Ownership signal for the whole story.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-04',
      difficulty: 'expert',
      question:
        'During a project deep-dive, the HM asks: "Why did you use SQS here instead of Kafka?" The candidate did not choose SQS. It was in place when they joined, and they never compared the two. Which response is best?',
      options: [
        '"We evaluated Kafka thoroughly, and SQS came out ahead on cost and simplicity."',
        '"That decision was before my time, so I can’t really comment on it."',
        '"It predates me and we didn’t formally compare them. Thinking it through now: at ~300 events/s with no Kafka ops experience, SQS was reasonable. Kafka would win once we needed replay or ordered partitions."',
        '"Kafka is overkill for most companies. SQS is always the better default on AWS."',
      ],
      correct: [2],
      explanation:
        'The best answer is honest about who made the decision and still shows judgment by reasoning through the trade-off live, including when the alternative would win. Option 1 fabricates an evaluation, and a single follow-up ("what throughput did you test?") exposes it. Option 2 is honest but gives no signal. Option 4 is a dogmatic generalisation without context.',
      followUps: [
        {
          q: 'The HM pushes: "So what would make you migrate to Kafka next quarter?" How do you answer concretely?',
          a: 'Name triggers you could measure: needing to rebuild read models by replaying history, needing per-key ordering beyond what SQS FIFO’s group throughput limits allow, many independent consumers needing the same stream at different offsets, or throughput growing into tens of thousands of events per second. Then mention the cost side: operating MSK or Kafka, partition planning, and team skills. A migration would start with a dual-publish on one stream.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-05',
      difficulty: 'medium',
      question:
        'A senior candidate opens "Tell me about yourself" with their college, first internship and every job in order, finishing after 4 minutes with "...and now I am looking for a change." What is the biggest problem?',
      options: [
        'It shows no passion, because the candidate did not mention any side projects',
        'It uses the opener as a CV readout: no level signal, no story hooks, and it eats time meant for deeper questions',
        'It is too short. Senior candidates should spend 6–8 minutes on the introduction',
        'It should have started with compensation expectations, so time is not wasted later',
      ],
      correct: [1],
      explanation:
        'The intro should be a 60–90 second trailer: current scope and scale, two signature accomplishments with numbers, how you work, and why this role. A chronological readout gives the interviewer nothing to score and burns the clock. Side projects are optional, longer is worse, and compensation does not belong in the opener.',
      followUps: [
        {
          q: 'Which two "hooks" would you plant in the intro, and why those?',
          a: 'One depth hook and one leadership hook, each with a number. For example, "redesigned payment callbacks around idempotency, taking duplicate-charge tickets from weekly to near zero" and "led a three-team strangler migration". They should be your strongest prepared stories, so that when the interviewer follows up, as they usually do, you are steering the conversation into material you know.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-06',
      difficulty: 'hard',
      question:
        'Which STARL time split for a roughly 3-minute answer best matches how strong candidates allocate time?',
      options: [
        'Situation + Task 50%, Action 30%, Result + Learning 20%',
        'Situation + Task 20%, Action 55%, Result + Learning 25%',
        'Situation + Task 10%, Action 85%, Result + Learning 5%',
        'Situation + Task 35%, Action 35%, Result + Learning 30%',
      ],
      correct: [1],
      explanation:
        'Action carries most of the signal: decisions, alternatives, influence and execution. Result + Learning must be substantial enough to show impact and growth. Option 1 is the most common failure (drowning in context). Option 3 skips the result, which leaves the "so what" unanswered. Option 4 under-weights the actions the interviewer actually scores.',
      followUps: [
        {
          q: 'The interviewer interrupts at 40 seconds with "OK, what did you do?" What does that tell you, and what should you change?',
          a: 'Your set-up is too long, or they already have enough context. Move straight to your first decision ("I traced the N+1 and chose DataLoader batching over a read replica because..."). For the rest of the loop, compress Situation + Task to two sentences and let the interviewer ask for context if they need it. Interruptions are useful feedback on how to calibrate your answers.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-07',
      difficulty: 'expert',
      question:
        'You are building a 9-story bank for a senior backend loop. Select ALL gaps that would most likely hurt you.',
      options: [
        'Every story ends in success, so there is no failure and no disagreement you lost',
        'Three of the nine stories involve the same migration project, told from different angles',
        'No story shows influence beyond your own team',
        'None of the stories has numbers or a proxy metric for the result',
        'Two stories are from more than three years ago',
      ],
      correct: [0, 2, 3],
      explanation:
        'Missing failure and conflict stories, missing cross-team influence (a core senior signal), and results with no numbers are real gaps that interviewers will find. Reusing one large project from several angles is fine, and often efficient, as long as each angle shows a different signal. A couple of older stories are acceptable if the recent ones carry the level.',
      followUps: [
        {
          q: 'You genuinely have no "lost a disagreement" story. How do you find one?',
          a: 'Look at design reviews where your proposal was changed, RFCs that were rejected or narrowed, PRs where you accepted another approach, and roadmap calls where your tech-debt item lost. "Lost" can mean converged on someone else’s idea. Then frame it with what you learned and how you supported the chosen path (disagree and commit), plus how it turned out. If their approach was better, saying so is a strong signal.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-08',
      difficulty: 'hard',
      question:
        'Asked "Tell me about a time you mentored someone", a candidate says: "I would first understand their goals, then set up weekly 1:1s, then pair on tasks..." for two minutes. What is the core issue?',
      options: [
        'Mentoring is a manager signal and should not appear in IC interviews',
        'The answer is hypothetical ("I would"), so it gives no evidence of past behaviour, which is what behavioural rubrics score',
        'The answer lacks a framework such as GROW, which interviewers expect for mentoring questions',
        'Weekly 1:1s are too frequent, which suggests micromanagement',
      ],
      correct: [1],
      explanation:
        'Behavioural rubrics score evidence of past behaviour. A plan of what you would do is a hypothetical answer, and it is a common red flag. Mentoring is an explicit senior IC signal (growing others). Naming a coaching framework is optional, and how often to meet is not the issue.',
      followUps: [
        {
          q: 'If the candidate has never formally mentored anyone, what is the best honest pivot?',
          a: '"I haven’t had a formal mentee, but the closest real example is this one." Then tell a real story: onboarding a new joiner to on-call, repeatedly pairing with a junior on code review feedback, or writing a runbook that let others handle incidents. Include what changed for that person (for example, "they ran the next sale-day on-call shift alone"). Real, smaller evidence beats an invented plan.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-09',
      difficulty: 'medium',
      question:
        'An HM in Bangalore asks about your notice period. You have 90 days contractually, buyout is allowed by policy, and colleagues are often released after about 45 days. Which reply is most professional?',
      options: [
        '"I can join in 15 days. I’ll manage it somehow."',
        '"90 days, and there is nothing I can do about it."',
        '"Contractually 90 days. Policy allows buyout and early release after handover is common, so realistically 45–60 days from offer. I’ll confirm once I resign."',
        '"It depends on your offer. A better offer means I will find a way to leave sooner."',
      ],
      correct: [2],
      explanation:
        'The best reply states the contract, the levers and a realistic range, and it commits to confirming. Option 1 is an unverified promise that commonly slips and damages trust. Option 2 is factual but shuts down options the HM could help with (such as buyout reimbursement). Option 4 ties joining logistics to money and sounds transactional.',
      followUps: [
        {
          q: 'The HM offers to reimburse the buyout if you can join in 30 days. What do you check before saying yes?',
          a: 'Check whether your employer actually accepts a buyout for your role, how it is calculated (often on basic pay for the unserved days) and its tax treatment, and whether a 30-day release is realistic given your handover duties. Also check whether you will get a proper relieving letter, which background checks often need. Then commit to a date you are confident about, not the hoped-for one.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-10',
      difficulty: 'expert',
      question:
        'In a final round, the HM asks your expected compensation. Select ALL approaches that protect both your outcome and your credibility.',
      options: [
        'Ask to align on level first, since level determines the band',
        'Give a range based on market research for this level and location, and say which components you are flexible on',
        'Quote a hike percentage over current CTC, since it is the simplest number for HR to process',
        'Present unvested ESOPs as part of current cash compensation to raise the baseline',
        'Break down your current CTC precisely into fixed, variable and equity',
      ],
      correct: [0, 1, 4],
      explanation:
        'Level-first framing, a researched range with flexibility, and a precise CTC breakdown keep the discussion grounded in the market and in trust. A hike percentage ties you to your current pay, which may be below market. Counting unvested equity as cash misrepresents CTC and can surface during document checks.',
      followUps: [
        {
          q: 'The HM says "We need a single number, not a range." What do you say?',
          a: 'Give a number at or near the upper-middle of your researched range for the level, and attach its assumptions: "Around [X] total, assuming the equity is in this form and the level is Senior SDE." Leave room for structure ("I’m flexible on the fixed/equity split"). A single number with stated assumptions is still precise without boxing you into an unexamined package.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-11',
      difficulty: 'hard',
      question:
        'Asked "Why are you leaving?", which answer is strongest for a candidate whose team was merged after a funding slowdown and now does mainly maintenance work?',
      options: [
        '"Leadership made poor decisions and the funding dried up, so there is no future there."',
        '"After a reorg my team moved to maintenance work. I did useful cost work there, but I want to build at larger scale, which is this team’s charter."',
        '"Mainly compensation. My current company has not given proper hikes for two years."',
        '"I just want a change. I’ve been there for a while and want new challenges."',
      ],
      correct: [1],
      explanation:
        'The strongest answer gives one neutral fact, evidence of contribution even in the "bad" period, and a forward-looking reason tied to this role. Option 1 blames leadership (a red flag). Option 3 makes money the headline, which is legitimate but scores poorly as the main motivation. Option 4 is generic and gives no signal.',
      followUps: [
        {
          q: 'The HM asks "What was the cost work you mentioned?" How should you use this opening?',
          a: 'Give a short STAR with numbers. For example: "I right-sized 20 services using p95 CPU/memory data, moved nightly batch jobs to spot nodes, and removed an idle staging cluster. That cut compute spend about 30% with no SLO regression." This turns a defensive question into a story about ownership and impact, and it shows you deliver even in less exciting periods.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-12',
      difficulty: 'expert',
      question:
        'Ten minutes into a project deep-dive, the interviewer asks three times in different words "And what specifically did you decide?" What is the most likely diagnosis?',
      options: [
        'The interviewer did not hear the answer, so repeat the same explanation more slowly',
        'The answer is missing the decision/ownership signal: you have described the system and team activity, not your choices and trade-offs',
        'The interviewer is testing consistency, so repeat exactly the same words each time',
        'The project is too complex for the interviewer, so simplify the architecture further',
      ],
      correct: [1],
      explanation:
        'When interviewers re-ask a question in different words, they usually have not got the signal they need, as described in Meta behavioural guidance. Here that signal is your personal decisions and the alternatives you rejected. Repeating the same content or simplifying the architecture does not add the missing evidence.',
      followUps: [
        {
          q: 'Give an example of a one-sentence "decision statement" that would end the re-asking.',
          a: '"I decided to use an application-level outbox instead of CDC, because the team had no Debezium experience and we had 8 weeks. I added a nightly reconciliation to cover the dual-write risk and wrote down CDC as a follow-up." It names the decision, the alternative, the constraint, the risk mitigation and the future path in one breath, and it is attributable to you.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-13',
      difficulty: 'medium',
      question:
        'Midway through a loop, you blank on "Tell me about a time you influenced another team’s roadmap." Which recovery is best?',
      options: [
        'Make up a plausible story on the spot, since interviewers rarely check details',
        'Say "I don’t have one" and wait for the next question',
        'Ask for 20 seconds, restate the signal, pick the closest real story from your bank and say which part of it answers the question',
        'Answer a different question you prepared well, without acknowledging the switch',
      ],
      correct: [2],
      explanation:
        'Taking a short pause, restating the signal and bridging openly to the nearest real story keeps the answer honest and relevant. Invented stories fall apart under follow-ups (names, numbers, timelines). Saying "I don’t have one" gives up the signal. Silently switching questions comes across as evasive.',
      followUps: [
        {
          q: 'Your closest story is about influencing your own team, not another team. How do you bridge?',
          a: 'Be explicit about the gap and show the transferable mechanism: "The closest example is within my team, but the approach is what I’d use across teams: data on the cost, a written proposal, a prototype that lowered adoption cost, and a sponsor." Then, if you can, add a smaller cross-team element, such as getting the SRE team to adopt your alert format. Honest framing scores better than a stretched claim.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-14',
      difficulty: 'hard',
      question:
        'Select ALL statements that reflect how behavioural answers are typically levelled for a Staff vs Senior backend role.',
      options: [
        'Staff stories more often involve direction across multiple teams or an org, not one system',
        'Staff candidates are expected to have formally managed people',
        'Staff-level impact is often expressed in org-wide or business terms (money saved, velocity of many teams, standards adopted)',
        'At Staff, finding the right problem in a vague business concern is weighted more than executing a well-defined plan',
        'Staff interviews skip behavioural rounds because the technical bar is higher',
      ],
      correct: [0, 2, 3],
      explanation:
        'Staff signal comes from cross-team scope, org-level impact and problem-finding under ambiguity (as practitioner guides describe it). Staff is an IC track and does not require people management. Behavioural and leadership conversations usually carry more weight at Staff, not less.',
      followUps: [
        {
          q: 'Turn this Senior story into Staff framing: "I designed idempotent payment callbacks for my service."',
          a: 'Staff framing: "I noticed duplicate-charge incidents across three services that all handled PSP callbacks differently. I wrote an org-wide idempotency standard and a shared library, got the payments, wallet and subscriptions teams to adopt it within two quarters, and duplicate-charge incidents dropped to zero across the org." The story now covers several teams, sets a standard, influences without authority and reports org-wide results.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-15',
      difficulty: 'expert',
      question:
        'Asked to describe a failure, a candidate offers the excerpt below. Which flaw most damages the self-awareness signal?',
      code: {
        language: 'text',
        title: 'Candidate answer (excerpt)',
        code: `"My biggest failure is that I care too much about code quality. On one
project I spent extra time writing tests and refactoring, so we were a bit
late, but in the end the code was very clean and nobody had bugs. My
manager said I should balance it, so now I try to balance it."`,
      },
      options: [
        'It is too short. Failure answers should be at least five minutes long',
        'It is a disguised strength with no real cost owned, vague impact, and a "learning" with no evidence of changed behaviour',
        'It mentions the manager, and failure stories should never involve other people',
        'Being late is not a real failure, so the candidate should pick a production outage instead',
      ],
      correct: [1],
      explanation:
        'A humblebrag failure ("I care too much") reads as low self-awareness. The cost is vague ("a bit late"), there is no measurable impact, and the learning ("I try to balance") has no evidence. Length is not the problem. Mentioning a manager is fine, and a missed deadline can be a strong failure story if it is owned properly.',
      followUps: [
        {
          q: 'What would a credible "changed behaviour" line look like for a missed-deadline failure?',
          a: 'Something specific and later proven. For example: "I now split estimates into known work plus explicit unknowns, and I run a one-day spike on the riskiest unknown before committing a date. On the next migration I flagged a 2-week risk in week one, and we delivered within 3 days of the estimate." A concrete practice plus a later outcome shows that you learned.',
        },
      ],
    },
    {
      id: 'beh-framework-mcq-16',
      difficulty: 'hard',
      question:
        'Select ALL details a candidate should abstract or omit when telling stories from a current employer in an interview.',
      options: [
        'The name of a specific large enterprise customer involved in an incident',
        'The general architecture pattern (for example, outbox + Kafka with consumer read models)',
        'Unreleased product plans and launch dates',
        'Exact internal revenue figures that are not public',
        'Their own measured improvements, such as p99 latency before and after',
      ],
      correct: [0, 2, 3],
      explanation:
        'Customer names, unreleased plans and non-public financials are confidential, and sharing them is a judgment red flag. Abstract them ("a top-3 enterprise customer", "a material share of revenue"). Architecture patterns and your own performance numbers are normally fine to discuss and are exactly the evidence interviewers want.',
      followUps: [
        {
          q: 'How do you express business impact when the revenue number itself is confidential?',
          a: 'Use relative or proxy measures: percentages ("recovered roughly 2% of abandoned checkouts"), orders of magnitude ("affecting a material share of daily GMV"), or operational measures (tickets, manual refunds, incidents). You can also say "I can’t share the absolute number, but it was among the top three revenue risks that quarter." Interviewers respect the discretion, and it is itself a signal of good judgment.',
        },
      ],
    },
  ],
};

export default topic;
