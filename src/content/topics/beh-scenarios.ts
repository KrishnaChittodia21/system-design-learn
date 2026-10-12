import type { Topic } from '../../types';

const topic: Topic = {
  id: 'beh-scenarios',
  phase: 'behavioral',
  order: 3,
  title: 'Senior Behavioural Scenarios: Conflict, Failure, Incidents, Influence & Mentoring',
  subtitle:
    'The twelve high-frequency senior prompts (design disagreements, incidents you owned, missed deadlines, scope pushback, tech debt, cross-team influence, mentoring, ambiguity, pressure, difficult teammates, tough feedback and decisions on incomplete data), each with the signal, the trap and an example STAR answer from a backend engineer’s world.',
  estimatedMinutes: 95,
  sources: [
    'Austen McDonald (ex-Meta hiring committee), "Deeper dive into the signal areas for behavioral interviews" (conflict resolution, growth, ambiguity, perseverance, initiative, scope, communication)',
    'Meta behavioural signal write-ups (techinterview.org cheat sheet; university career-centre guides 2025): raise disagreement directly, show what happened afterwards, including when you did not get your way',
    'Google re:Work: Guide to structured interviewing (behavioural vs hypothetical; follow-up probes such as "what was your primary goal and why?")',
    'Google SRE Book, Ch 15 "Postmortem Culture: Learning from Failure" (blameless postmortems)',
    'Atlassian Incident Handbook and published values ("Open company, no bullshit"; "Play, as a team")',
    'Amazon Leadership Principles (amazon.jobs), referenced only; e.g. "Have Backbone; Disagree and Commit". See topic beh-amazon-lp',
    'Hello Interview: "How behavioral interviews really work" (level-appropriate conflict scope)',
    'Tech Interview Handbook: Behavioral interviews for senior candidates (technical, people, operational and strategic leadership)',
    'Taro: Master the Behavioral Interview (senior engineer and staff engineer lessons)',
    'Glassdoor: Razorpay SDE interview reviews (hiring-manager round questions about arguments with seniors)',
    'LeetCode Discuss: Flipkart SDE-2 interview experiences (HM round: handling conflicts at work)',
    'Will Larson, "Staff Engineer" and "An Elegant Puzzle" (influence without authority, tech-debt investment)',
  ],
  tags: ['behavioral', 'conflict', 'incident', 'postmortem', 'failure', 'influence', 'mentoring', 'ambiguity', 'prioritisation', 'feedback', 'tech-debt'],
  cheatSheet: [
    'Each prompt tests one primary signal; find it before answering. Disagreement = conflict + judgment, incident = ownership + calm, failure = self-awareness, mentoring = growing others.',
    'Conflict: raise it early and directly, steelman their view, settle it with data or a time-boxed experiment, then disagree-and-commit if you lose. Say how the relationship ended up.',
    'Incident: timeline with timestamps → your role (IC, responder, owner) → mitigate before root-cause → blameless postmortem → action items that were actually completed.',
    'Failure: a real cost, your share of it owned in one sentence, no blaming, and a concrete practice you changed with later evidence that it stuck.',
    'Scope or product pushback: never a bare "no". Give options with costs (cut scope, phase it, add risk), ask what the user actually needs, and decide together.',
    'Tech debt vs features: express the debt in business units (incidents, lead time, on-call hours, revenue risk) and pay it down incrementally inside the roadmap.',
    'Influence without authority: data + written proposal + prototype that lowers adoption cost + an early ally. Escalation is the last step, not the first.',
    'Mentoring and raising the bar: name the person’s starting point, your specific interventions, and a measurable change in THEIR output, not yours.',
    'Ambiguity and incomplete data: frame the decision, separate reversible from irreversible choices, time-box discovery, set a checkpoint to revisit.',
    'Difficult teammate or tough feedback: assume good intent, talk privately and specifically (situation, behaviour, impact), and show the change over the following weeks.',
  ],
  sections: [
    {
      heading: '1. How scenario prompts are scored: signal, trap, evidence',
      body: `**Intuition:** every "Tell me about a time..." prompt is a test for one or two specific signals. The trap is usually a *natural* way to tell the story that accidentally shows an anti-signal, such as "I was right", "the other team messed up" or "I worked all weekend".

| Prompt | Primary signal | The trap | Evidence that scores |
|---|---|---|---|
| Disagreed with manager/peer on a design | Conflict resolution, judgment | "I was right and they eventually saw it" | Steelmanned view, data or experiment, outcome, relationship after |
| Production incident you owned | Ownership, composure, learning | Blaming a person or another team | Timeline, mitigation-first, blameless RCA, closed action items |
| Failure / missed deadline | Self-awareness, growth | Humblebrag, or blaming estimates on others | Your share owned, a concrete change, a later proof |
| Pushing back on product scope | Customer focus, influence | A bare "no", or caving silently | Options with costs, a phased plan, shared decision |
| Tech debt vs features | Business judgment | "Engineers know best, stop features" | Debt priced in business terms, incremental paydown |
| Influencing without authority | Influence, cross-team scope | Escalating first | Data, proposal, prototype, allies, adoption |
| Mentoring / raising the bar | Growing others | Talking about your own output | The mentee’s measurable growth |
| Ambiguous project you drove | Ambiguity, initiative | Waiting for requirements | Problem framing, milestones, explicit non-goals |
| Prioritising under pressure | Judgment, communication | Doing everything, burning out | An explicit ranking, a stakeholder agreement, what was dropped |
| Difficult teammate / low performer | Empathy, directness | Gossip, or going straight to the manager | A private, specific conversation, support, follow-through |
| Receiving tough feedback | Growth, humility | Defensiveness, "the feedback was unfair" | Acceptance, a specific change, re-checked later |
| Decision with incomplete data | Bias for action, risk management | Analysis paralysis, or a reckless guess | Reversibility, time-box, checkpoint, outcome |

**The probing ladder.** Interviewers rarely stop at your first answer. Expect 2–4 layers: *What exactly did you say? → What did they say back? → What would you do differently? → What if they had still disagreed?* Prepare stories at that depth. A story you can't go three levels deep on is a rehearsed script, and it shows.

**Amazon note:** many of these map directly to Amazon's Leadership Principles (for example, "Have Backbone; Disagree and Commit", "Ownership", "Learn and Be Curious"). The *Amazon Leadership Principles & Bar Raiser* topic covers that mapping in depth. This topic is about the scenarios themselves.`,
      keyPoints: [
        'Identify the primary signal before you start telling the story.',
        'Each prompt has a natural trap; know it in advance.',
        'Prepare every story to three levels of follow-up depth.',
      ],
      source: 'Austen McDonald, Meta signal areas; Google re:Work structured interviewing; Tech Interview Handbook (senior)',
    },
    {
      heading: '2. Disagreement with a manager or peer on a design',
      body: `**Signal:** you disagree *early, directly and respectfully*, and you get to a better decision without damaging the relationship. Meta-focused write-ups stress showing how you worked with the person **afterwards**, including cases where you didn't get your way. Indian HM rounds ask about it too: Razorpay candidates report questions about arguments with seniors, and Flipkart's about handling conflicts at work.

**Trap:** the "I was right" arc. Even if you were right, a story that ends with the other person being proven wrong shows the anti-signal. Also avoid trivial conflicts (naming, formatting). They signal low scope.

**The shape of a strong answer:**
1. **What we disagreed about and why it mattered** (the stakes).
2. **Their view, steelmanned:** what was good about it, and what constraint they were optimising for.
3. **How you raised it:** privately or in a design review, with data, and at the right time.
4. **How it was resolved:** a data point, a time-boxed spike, a decision owner. Name who decided.
5. **Disagree and commit** if you lost, and what you did to make their approach succeed.
6. **Outcome and relationship:** what happened, and how you work with them now.

**Example STAR (illustrative, adapt it):**
- **S:** "Our architect proposed GraphQL federation across 8 services for a new merchant dashboard. I thought a single BFF (backend-for-frontend) aggregating REST calls was enough for the next year."
- **T:** "I was the senior engineer on the first two subgraphs, so I'd own most of the complexity either way."
- **A:** "I asked for 30 minutes with him first, not the group, and opened with what federation got right: team autonomy and a single schema. My concern was operational. We had no gateway expertise, and federation's query planning would add a network hop per subgraph. I proposed a one-week spike: build two subgraphs both ways and measure p95 and developer effort. The federated version added ~40ms p95 but cut cross-team schema coordination significantly. We agreed: federation, but starting with 3 services, not 8, and a gateway runbook before onboarding more."
- **R:** "Three services shipped in 6 weeks. I wrote the gateway runbook. We onboarded the rest over two quarters with no gateway incidents. He later asked me to co-own the schema governance review."
- **L:** "Proposing an experiment instead of arguing turned a two-camp debate into a shared question."`,
      diagram: `   Conflict resolution ladder (go up only as needed)

   5  Escalate together, with a shared doc of both options
   4  Decision owner decides; you disagree and commit
   3  Time-boxed spike / data settles it
   2  1:1 conversation: steelman their view, share yours
   1  Clarify goals & constraints (often dissolves the conflict)`,
      keyPoints: [
        'Steelman the other view out loud.',
        'Prefer an experiment or data to argument; name the decision owner.',
        'End with the relationship and how you supported the final decision.',
      ],
      source: 'Meta conflict-resolution signal write-ups; Glassdoor Razorpay and LeetCode Discuss Flipkart HM-round reports',
    },
    {
      heading: '3. A production incident you owned: the blameless postmortem story',
      body: `**Signal:** ownership under pressure, a calm and structured response, mitigation before root cause, and systemic learning. Google's SRE book defines the culture interviewers want to hear about: blameless postmortems that focus on contributing causes and process gaps, not on people.

**Trap:** blaming a person ("a junior pushed a bad config") or another team. Also heroics ("I stayed up 36 hours") with no systemic fix. And postmortem action items that were never completed.

**Structure for an incident story:**
- **Detection:** how it was noticed (alert, customer), and the time to detect.
- **Your role:** incident commander, primary responder, or owner of the affected service.
- **Mitigation first:** roll back, fail over, shed load. Use timestamps.
- **Root cause and contributing factors:** technical *and* process.
- **Postmortem:** blameless, with action items, owners and dates.
- **Follow-through:** which actions were completed, and the measured effect, such as no repeat incidents.

**Example STAR (illustrative):**
- **S:** "During a sale, checkout error rate jumped from 0.2% to 18% at 20:04. I was on-call for the order service."
- **T:** "I became incident commander until the SRE lead joined, and later owned the postmortem."
- **A:** "At 20:07 I saw Redis connection errors and pod restarts. A deploy at 19:55 had changed the ioredis client config. I made the call to roll back at 20:11 rather than debug live. Error rate was back under 1% by 20:16. The root cause was a new per-request Redis client created inside a request-scoped NestJS provider: under 6x traffic it opened thousands of connections and hit maxclients. Contributing factors: no connection-count alert, a load test that ran at 2x not 6x, and a review checklist that didn't cover client lifecycle. I ran a blameless postmortem. The engineer who wrote the change co-presented it with me."
- **R:** "Impact: 12 minutes, roughly 4,000 failed checkouts, most retried successfully. Action items: a singleton Redis client lint rule, a connection-count alert at 70% of maxclients, and sale load tests at 6x. All three closed within 3 weeks. Zero Redis-connection incidents in the next two sales."
- **L:** "Rolling back first and debugging later is now our team's default during peak, and it's written into the runbook."`,
      diagram: `   Incident story timeline (say timestamps out loud)

   19:55 deploy --- 20:04 alert --- 20:07 diagnosis --- 20:11 rollback
                     |  detect 9m        |                     |
                     |                   |   mitigate 7m       v
                     +-------------------+------------> 20:16 recovered
   Postmortem (blameless) -> 3 action items -> closed in 3 weeks -> verified`,
      keyPoints: [
        'Mitigate first (rollback), then root-cause.',
        'Contributing factors include process gaps, not just the code bug.',
        'Name the action items, who owned them, and whether they were completed.',
      ],
      source: 'Google SRE Book, Ch 15 Postmortem Culture; Atlassian Incident Handbook',
    },
    {
      heading: '4. A failure or a missed deadline',
      body: `**Signal:** self-awareness and growth. Can you name your own mistake without deflecting, and did you actually change something afterwards?

**Trap:** a humblebrag ("I care too much"), a failure that was really someone else's ("PM changed requirements"), or a failure with no cost. The opposite trap is a catastrophic failure that shows poor judgment and no recovery.

**How to pick:** a real failure with **moderate, recoverable stakes** where **your decision** was a cause, and where you can show **a changed practice with later evidence**.

**Example STAR (illustrative):**
- **S:** "I committed to migrating our notification service from a cron-based poller to an event-driven consumer in 4 weeks."
- **T:** "I owned the estimate and the delivery."
- **A (the failure):** "I estimated from the code changes and ignored the data backfill. There were 180M historical notification records whose schema changed. In week 3 the backfill ran at ~2k rows/s, which meant ~25 hours per pass. We needed several passes because of validation failures. I flagged the slip in week 3, not week 1. That was my real mistake: I'd seen the backfill risk in week 1 and assumed it would be fine."
- **A (recovery):** "I told my manager and the two dependent teams the same day, with a new date and a plan: batch the backfill by month, run it in parallel workers with rate limiting, and cut over new traffic first while old data backfilled."
- **R:** "We delivered 3 weeks late. The dependent team's launch slipped by one week, not three, because new-traffic cut-over unblocked them."
- **L:** "I now split estimates into known work plus named unknowns, and run a one-day spike on the riskiest unknown before giving a date. On the next migration (payments ledger) the spike found a similar backfill issue on day 2, and we landed within 3 days of the estimate."

**What makes it strong:** the candidate names *their* specific mistake (seeing the risk and not escalating), explains the recovery, and proves the learning on a later project.`,
      keyPoints: [
        'Pick a real, moderate failure where your decision mattered.',
        'Own your share in one clear sentence.',
        'Prove the learning with a later outcome.',
      ],
    },
    {
      heading: '5. Pushing back on product scope, and tech debt vs features',
      body: `**Signal:** you protect the customer and the system while still enabling the business. Pushback is not obstruction. It is **offering better options**.

**Trap (scope):** a bare "that's impossible", or silently agreeing and then missing the date. **Trap (tech debt):** "we need a quarter to refactor" with no business framing. Engineers who can't price debt don't get funded.

**Scope pushback pattern:**
1. Ask what problem the requirement solves ("Why real-time? Who looks at it, how often?").
2. Offer 2–3 options with costs: *full scope later*, *phased MVP now*, *full scope now with named risk*.
3. Recommend one, and let the PM decide with the trade-offs visible.

**Tech-debt pattern:** convert debt into **business units**:

| Debt | Business translation |
|---|---|
| Shared database between 5 services | 6 weeks per schema change; 2 incidents a year from cross-service locks |
| No idempotency on webhook consumer | ~N duplicate notifications a week; support tickets |
| Flaky integration tests | ~40 min per PR in reruns × 30 PRs/week = ~20 engineer-hours/week |
| Manual deploys | Release frequency capped at weekly; slower incident fixes |

Then propose **incremental paydown**: 15–20% capacity, or debt attached to features that touch the same code, with a metric that shows progress.

**Example STAR (illustrative):**
- **S:** "Product wanted 'live order tracking for merchants' in 4 weeks: every status change pushed to the merchant dashboard instantly via WebSockets."
- **T:** "I was the tech lead. Our order events weren't reliable enough for push. We had no outbox, so ~0.3% of status changes were never emitted."
- **A:** "I asked the PM what merchants actually did with it. Mostly, they checked whether an order was packed before a courier arrived. I proposed: (1) 15-second polling plus a 'last updated' timestamp in 2 weeks, (2) fixing event reliability with an outbox (2 weeks, which we needed anyway), (3) then push. I showed that pushing unreliable events would mean merchants seeing wrong statuses, which is worse than slightly stale ones."
- **R:** "Polling shipped in 2 weeks. The outbox fix eliminated the missing-event class of bug. Push shipped in week 7. Merchant complaints about wrong statuses fell to near zero, and the outbox work counted as both debt paydown and feature work."`,
      keyPoints: [
        'Pushback = options with costs, not "no".',
        'Price tech debt in business units: incidents, hours, lead time, revenue risk.',
        'Attach debt paydown to features where possible.',
      ],
      source: 'Will Larson, An Elegant Puzzle (managing technical debt); Tech Interview Handbook (senior strategic leadership)',
    },
    {
      heading: '6. Influencing without authority across teams',
      body: `**Signal:** you can change what other teams do without a reporting line. This is *the* senior-to-staff signal.

**Trap:** escalating first ("I asked my manager to tell their manager"), mandating, or "I convinced them with a meeting" with no mechanism.

**The toolkit, from the most to the least preferred:**
1. **Shared data:** their own incident or latency numbers, not yours.
2. **A written proposal or RFC:** async, reviewable, invites their input.
3. **Lowering the adoption cost:** a library, a migration script, or pairing time.
4. **An early adopter or ally** who shows it works.
5. **Aligning with their goals:** what their OKR gets from this.
6. **Escalating together**, with both options written up, only if it is truly blocked.

**Example STAR (illustrative):**
- **S:** "Five teams published events to Kafka with ad-hoc JSON. Schema breaks caused 3 consumer incidents in a quarter, including one that dropped order-cancellation events."
- **T:** "I owned one consumer team's services. No authority over producers."
- **A:** "I collected the three incident timelines and estimated the cost (about 30 engineer-hours plus a refund backlog). I wrote an RFC for a schema registry with backward-compatibility checks in CI, and invited every producer team to review it. I changed the design based on their feedback, for example allowing JSON Schema rather than forcing Avro. I built a CLI and a GitHub Action so adoption was a 20-line PR, and paired with the payments team first because they'd been burned the most. They presented their migration in the guild meeting."
- **R:** "Four of five teams adopted it within a quarter. The fifth adopted it after a breaking change was caught in CI for a neighbouring team. Zero schema-break incidents in the following two quarters."`,
      keyPoints: [
        'Use their data, a written proposal, and lower their adoption cost.',
        'Incorporate their feedback, so it becomes their idea too.',
        'Escalation is the last step, and done jointly.',
      ],
      source: 'Will Larson, Staff Engineer (influence without authority); Taro staff lessons',
    },
    {
      heading: '7. Mentoring and raising the bar',
      body: `**Signal:** you make other engineers better and raise the team's standards. At senior level this is expected; it is not a bonus.

**Trap:** the story is really about your own output ("I reviewed 200 PRs"), or it is vague ("I helped juniors"). The proof is **the other person's growth**.

**Structure:** the person's starting point → the specific gap → your interventions (pairing, graduated ownership, feedback) → the measurable change in **their** behaviour or output → what you changed in the team's systems so the improvement lasts.

**Example STAR (illustrative):**
- **S:** "A new SDE-1 on my team was technically solid but avoided on-call. Their first two incidents ended with them escalating to me within minutes."
- **T:** "I was their onboarding buddy. Our team goal was every engineer on the on-call rotation within a quarter."
- **A:** "I ran three 'game days': I broke a staging service (Redis down, consumer lag, a bad deploy) and let them drive while I only asked questions. I wrote a runbook template with them, rather than for them, and agreed graduated ownership: shadow, then primary with me as secondary, then solo. After each real incident we did a 15-minute debrief on what they noticed first and what they'd check next time."
- **R:** "By week 10 they handled a consumer-lag incident solo end to end and wrote the postmortem. The runbook template became the team default. Median time-to-mitigate on our service dropped from ~25 to ~12 minutes over two quarters as more people could handle incidents alone."

**Raising the bar variants:** introducing a design-doc template, review checklists (idempotency, timeouts, migrations), or "golden path" service templates. Always show adoption and the effect.`,
      keyPoints: [
        'The evidence is the mentee’s growth, not your effort.',
        'Graduated ownership: shadow, then primary with backup, then solo.',
        'Make it last with team systems (templates, checklists).',
      ],
    },
    {
      heading: '8. An ambiguous project you drove',
      body: `**Signal:** you create structure out of a fuzzy goal: define the problem, set non-goals, de-risk early, and communicate progress.

**Trap:** waiting for requirements, or describing a well-specified project as "ambiguous". Interviewers notice when the ambiguity was only a few missing details.

**Structure:** the vague ask → how you found the real problem (data, users, stakeholders) → a problem statement and non-goals → a milestone plan with the riskiest part first → how you kept stakeholders aligned → the outcome.

**Example STAR (illustrative):**
- **S:** "My director said: 'Merchants say our settlements are confusing. Fix it.' No spec, no PM for the first month."
- **T:** "I volunteered to own discovery and the first deliverable."
- **A:** "I read 150 recent support tickets and tagged them. 60% were 'why is my payout less than my sales' (fees, refunds and chargebacks netted without explanation), and 20% were timing questions. I interviewed four merchants with the account managers. I wrote a one-page problem statement with explicit **non-goals**: no change to the settlement schedule, no new payout rails. Milestone 1: a per-payout breakdown API and CSV, built from the existing ledger. I built the riskiest piece first, reconciling ledger entries to payouts, because if the ledger couldn't explain payouts, nothing else mattered. I sent a short weekly update to the director and support lead."
- **R:** "The breakdown shipped in 6 weeks. Settlement-related tickets fell ~45% in the next two months. The problem statement became the PM's starting doc when one joined."`,
      keyPoints: [
        'Turn vague into specific: data from tickets or users, then a problem statement.',
        'Write non-goals; de-risk the hardest part first.',
        'Communicate on a regular rhythm while the work is ambiguous.',
      ],
    },
    {
      heading: '9. Prioritisation under pressure, and decisions with incomplete data',
      body: `**Signal (prioritisation):** an explicit ranking, made visible, with stakeholders agreeing on what *won't* happen. **Signal (incomplete data):** a sensible bias for action, managed by reversibility and checkpoints.

**Traps:** trying to do everything (burnout, missed dates); a reckless guess presented as decisiveness; or analysis paralysis presented as rigour.

**Prioritisation tools to name:** impact × urgency, cost of delay, "what breaks if this slips a week?", and **one-way vs two-way doors** (reversibility).

**Decision with incomplete data, the pattern:**
1. What decision, by when, and what does waiting cost?
2. What can be known cheaply in the time available (a 1-day spike, a log query)?
3. Is it reversible? If yes, decide fast and set a checkpoint. If no, spend more effort.
4. State the assumptions, and what signal would change the decision.

**Example STAR (illustrative, incomplete data):**
- **S:** "Three days before a festival sale, our payment gateway's p99 started spiking to 4s intermittently. The PSP said 'investigating' with no ETA."
- **T:** "I owned the payment service and had to decide whether to switch a share of traffic to our secondary PSP, which we had integrated but never run at scale."
- **A:** "Unknowns: the root cause, and whether the secondary could take sale load. Cost of waiting: if the primary degraded during the sale, checkout conversion would drop sharply. I treated routing as a **two-way door**: routing was a config flag, reversible in a minute. I moved 10% of traffic to the secondary, watched success rate and latency for 24 hours, then 30%. I defined rollback triggers in advance: secondary success rate under 97% or p99 over 2s."
- **R:** "The secondary held at 30% with a 98.6% success rate. During the sale the primary had a 20-minute degradation, and the split kept overall payment success above 97%. Afterwards we made multi-PSP routing a standard capability with health-based weights."`,
      keyPoints: [
        'Make the ranking explicit, including what you will NOT do.',
        'Classify the decision as reversible or not; decide reversible ones quickly.',
        'Pre-commit to rollback triggers and checkpoints.',
      ],
    },
    {
      heading: '10. A difficult teammate or an under-performing peer',
      body: `**Signal:** directness with empathy. You address the issue privately and specifically, try to understand the cause, and escalate only after a genuine attempt.

**Trap:** gossip, passive-aggression, going to the manager first, or a story that is really a complaint about a person. As an IC, also don't describe "managing" someone you don't manage. Say *supporting* or *working with*.

**A useful script to name: situation → behaviour → impact (SBI).** "In yesterday's design review (situation), you rejected three proposals without suggesting alternatives (behaviour), and two people told me they've stopped proposing ideas (impact)."

**Example STAR (illustrative):**
- **S:** "A senior peer on my team often blocked PRs with long, sharp review comments late at night. Two juniors started routing their PRs to anyone else. PR cycle time for juniors had grown to ~4 days."
- **T:** "I wasn't his manager, but I was the tech lead for our service, and review health was part of my remit."
- **A:** "I asked him for a coffee and opened with curiosity, not accusation. I said I'd noticed the juniors avoiding his reviews, and asked how he saw it. It turned out he was frustrated after a production bug that a junior's PR had introduced, and he felt he was the only one catching problems. I acknowledged that was real. We agreed on two things together: a review checklist for the recurring issues (timeouts, idempotency, migrations), so the standard was written down and not personal, and him pairing for 30 minutes with a junior on complex PRs instead of writing 30 comments. I told our manager what we'd agreed, as an update rather than an escalation."
- **R:** "Junior PR cycle time went back to ~1.5 days in a month. He ran the team's review-checklist session the next quarter. The production bug class he was worried about didn't recur."

**If the issue is genuine under-performance:** focus on clarity (what good looks like), support (pairing, smaller scoped tasks), and timing (raise it with the manager when it affects delivery and private help hasn't worked). Never share speculation about someone's personal life.`,
      keyPoints: [
        'Talk privately first; use situation, behaviour, impact.',
        'Look for the cause behind the behaviour; agree changes together.',
        'Escalate as an update or after a genuine attempt, not as the opening move.',
      ],
    },
    {
      heading: '11. Receiving tough feedback',
      body: `**Signal:** you listen without defending yourself, take the feedback seriously, change your behaviour and close the loop. Meta-oriented guides describe the growth signal as hearing hard feedback and changing because of it, ideally noticing your gaps before others do.

**Trap:** "the feedback was unfair" (even if partly true), trivial feedback ("use more comments"), or feedback with no visible change.

**Structure:** the feedback, as close to verbatim as you can → your honest first reaction (a little defensiveness, admitted, is human and credible) → how you checked it (asked for examples, asked others) → what you changed → how you verified the change → what it taught you about yourself.

**Example STAR (illustrative):**
- **S:** "In my mid-year review, my manager said: 'Your designs are good, but in reviews you defend them so hard that people stop raising concerns. Two engineers told me they don't comment on your docs any more.'"
- **T:** "I was about to lead the design for our ledger migration, which needed many people's input."
- **A:** "My first reaction was defensive. I thought I was just explaining. I asked for a specific example. He pointed to a review where I'd answered every comment within minutes with a counter-argument. I asked two peers privately; they confirmed it. I changed three things: in reviews I now reply to concerns with a question first ('What failure are you worried about?'); I added an explicit 'Open questions / where I'm least sure' section to my design docs; and I let comments sit for a day before responding."
- **R:** "The ledger design doc got 40+ comments from 9 people, versus about 10 on my previous doc. Two of them caught real issues, including a rounding problem in multi-currency fees. In the next review cycle, my manager specifically mentioned the change. I now ask for feedback on my reviews every quarter."`,
      keyPoints: [
        'Quote the feedback; admit your first reaction honestly.',
        'Validate it with examples and other people.',
        'Show the change and how you measured it.',
      ],
      source: 'Meta growth-signal write-ups; Austen McDonald signal areas',
    },
    {
      heading: '12. Handling the follow-up probes',
      body: `**Intuition:** your prepared story gets you to a "lean hire". How you handle the probes decides whether it becomes a "strong hire" and at which level. The probes are predictable, so prepare for them.

| Probe | What it tests | Strong move |
|---|---|---|
| "What would you do differently?" | Self-awareness | One concrete, non-trivial change, plus why you didn't do it at the time |
| "What did your manager / the other person say?" | Consistency, relationships | Their actual words or view, including the critical part |
| "How did you measure that?" | Honesty of numbers | The source, the method and your confidence |
| "What if they had still disagreed?" | Commitment, escalation judgment | Disagree and commit, or a joint escalation with a written trade-off |
| "What was the hardest part for you personally?" | Emotional maturity | A real feeling (frustration, doubt) and how you handled it |
| "Tell me about another time." | Breadth, not a one-off | A second story from your bank for the same signal |
| "What did you learn about yourself?" | Growth | A pattern in yourself, not a platitude |
| "Why didn't you escalate earlier/later?" | Judgment on timing | The trigger you used, and whether it was the right one |

**Two final rules:**
- **Consistency:** the follow-ups will cross-check names, numbers and timelines. Invented details fall apart by the third probe.
- **Admitting limits scores:** "I didn't handle that part well" followed by what you'd change reads as senior. Defending every choice reads as junior.`,
      keyPoints: [
        'Prepare every story for the eight standard probes.',
        'A second story per signal is your answer to "another time?".',
        'Admitting what went badly, with a fix, raises your level.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'beh-scenarios-cc-1',
      title: 'Answer Lab: turn a blame-heavy outage story into a blameless ownership story',
      context:
        'Prompt: "Tell me about a production incident you were responsible for handling." The candidate is interviewing for a Senior Backend Engineer role at a fintech in Bengaluru. This is their answer.',
      task: 'Rewrite the answer so it shows ownership and composure, puts mitigation before root cause, is blameless, uses concrete timestamps and impact, and closes with completed action items and verified learning.',
      starter: {
        language: 'text',
        title: 'Weak answer (as delivered)',
        code: `"One day our payments API went down for almost an hour. It happened because
the DevOps guy changed some database setting without telling anyone, and the
connection pool got exhausted. Also the junior developer in my team had
written a query without an index which made it worse.

I was on call so I had to handle everything. I checked the logs for a long
time and finally found the issue and told DevOps to revert. I stayed online
till 3 AM. After that we told DevOps they must inform us before changes.

It was a very stressful day but we fixed it."`,
      },
      hints: [
        'Count the people blamed. What process or system gap let each mistake reach production?',
        '"Checked the logs for a long time": was there a faster mitigation available before finding the root cause? When was it decided?',
        'What were the impact, the timeline and the action items? Which actions were closed, and how do you know they worked?',
      ],
      solution: {
        language: 'text',
        title: 'Strong rewrite (example to adapt; illustrative numbers)',
        code: `SITUATION
"On a weekday evening, payment API error rate went from ~0.1% to 35% at 18:42.
I was primary on-call for the payments service."

MY ROLE
"I acted as incident commander until 19:05, then handed command to the SRE lead
and stayed on as payments owner. I later owned the postmortem."

MITIGATION FIRST
"By 18:48 I saw the PgBouncer pool saturated, clients queueing, and p99 at
9s. I didn't know the cause yet, so I first shed load: I paused the
reconciliation batch job and set the merchant-report endpoints to read from
the replica. Errors dropped to ~8% by 18:55. The change log showed a pooler
config change meant for the 23:00 window had been applied at 18:40,
lowering PgBouncer default_pool_size from 100 to 40. We rolled it back at 19:02, and
errors were back to baseline by 19:06."

ROOT CAUSE & CONTRIBUTING FACTORS (blameless)
- "A pooler config change was applied outside the change window. Our infra
  pipeline allowed direct apply without a change ticket."
- "A recently merged report query lacked an index, so each request held a
  connection ~10x longer. Our review checklist didn't include EXPLAIN plans."
- "No alert on connection-pool saturation; we learned from error rate."

IMPACT
"24 minutes of degraded payments, ~3,100 failed attempts, of which ~85% were
retried successfully by customers within 10 minutes."

ACTION ITEMS (owner, status)
1. DB and pooler config changes only via the pipeline with an approval: infra, done in
   1 week.
2. Pool-saturation alert at 80%: me, done in 2 days.
3. EXPLAIN-plan check for new queries on hot tables in our PR template: me +
   the query's author, done in 1 week.
4. Load-shedding switches (batch pause, replica reads) documented in runbook:
   me, done.

VERIFIED LEARNING
"Two months later, a similar pool spike was caught by the new alert at 80%,
and the on-call used the runbook switches. No customer impact. I now treat
'shed load first' as step one of our payments runbook."`,
      },
      explanation: `**What improved:**
- **Blameless framing.** "The DevOps guy" and "the junior developer" become **system gaps**: a pipeline that allowed direct changes, and a review checklist without EXPLAIN plans. The query's author co-owns the fix, which shows a healthy culture rather than finger-pointing.
- **The candidate's role is clear:** incident commander, then the handover, then postmortem owner.
- **Mitigation before root cause.** Load shedding and replica reads cut errors from 35% to 8% before the cause was known. This is the composure signal.
- **Timestamps and impact** (duration, failed attempts, retry rate) make the story credible and measurable.
- **Action items have owners and statuses**, and the **verified learning** (the alert caught a later spike) proves the system improved.
- **Heroics were removed.** "Stayed till 3 AM" adds nothing. A shorter, controlled incident is the better story.`,
      followUps: [
        {
          q: 'The infra engineer who applied the change early was upset when the postmortem was circulated. How did you handle it?',
          a: 'Show you protected blamelessness. For example: "I spoke to him before circulating the doc and showed him the wording: the contributing factor was the pipeline allowing an out-of-window apply, not his judgment. I asked him to co-write the pipeline action item." If the doc named him, fix it and say so. Senior engineers make postmortems safe, because people hide information in the next incident if they expect blame.',
        },
        {
          q: 'Why did you hand over incident command at 19:05 instead of keeping it?',
          a: 'Explain role separation. The IC coordinates, communicates and decides, while the subject-matter expert debugs. Once the SRE lead joined, the most useful thing I could do was to stay hands-on with the payments service and DB, while they ran comms with support and leadership. Holding both roles slows mitigation. A clean handover ("current state, hypotheses, actions in flight") is itself a signal of incident maturity.',
        },
      ],
    },
    {
      id: 'beh-scenarios-cc-2',
      title: 'Answer Lab: a design disagreement told as a victory lap',
      context:
        'Prompt from a hiring manager at a Bangalore product company: "Tell me about a time you disagreed with your manager on a technical decision." The candidate is targeting Senior SDE.',
      task: 'Rewrite the answer so it shows conflict-resolution skill rather than being right: steelman the manager’s view, show how the disagreement was raised and settled, include disagree-and-commit or a shared decision, and end with the relationship and outcome.',
      starter: {
        language: 'text',
        title: 'Weak answer (as delivered)',
        code: `"My manager wanted to use MongoDB for our new wallet service because he had
used it before. I knew this was wrong because wallets need transactions and
Postgres is obviously better for that. I told him in the team meeting that
MongoDB is a bad choice for financial data. He didn't agree, so I went to the
architect and the architect also agreed with me. Then my manager had to
change the decision to Postgres. Later, the system worked perfectly and
my manager admitted I was right. So I believe in speaking up for the right
thing."`,
      },
      hints: [
        'What constraint might the manager have been optimising for? Is "because he had used it before" the steelmanned version?',
        'Raising it first in a team meeting and then going around the manager to the architect: how does that read to an HM? What sequence would be better?',
        'What happened to the relationship? Is "my manager admitted I was right" a signal the interviewer wants?',
      ],
      solution: {
        language: 'text',
        title: 'Strong rewrite (example to adapt; illustrative details)',
        code: `SITUATION & STAKES
"We were starting a wallet service, holding customer balances, with a 10-week
deadline. My manager proposed MongoDB. I had concerns about multi-document
transactional guarantees for balance updates and ledger entries."

THEIR VIEW, STEELMANNED
"His reasons were real: the team had run MongoDB in production for two years,
our ops runbooks and backups were built around it, and MongoDB does support
multi-document transactions on replica sets. Changing stacks under a
10-week deadline is a genuine risk."

HOW I RAISED IT
"I asked for a 1:1 rather than debating in the team meeting. I said I might
be missing context, then shared two concerns: our ledger needed strict
double-entry invariants and reporting joins, and our team's MongoDB
experience was with single-document writes, not transactions under contention.
I proposed a 3-day spike: implement the debit/credit path on both, run a
concurrency test with 200 parallel transfers on the same wallets, and compare
correctness, p99 and code complexity."

RESOLUTION
"Both were correct under test. Postgres came out simpler for the ledger
queries, and MongoDB's transaction retries added complexity to our error
handling. My manager made the call: Postgres for the ledger, and he asked
me to own the ops runbook so the team wasn't exposed. I also agreed with his
point that the wallet metadata (preferences, limits config) could stay in
MongoDB, which we did."

OUTCOME & RELATIONSHIP
"We shipped in 11 weeks, one week late because of the runbook and backup
work, which I'd flagged up front. Zero balance mismatches in the reconciliation
job since launch. He now asks for a spike when the team disagrees on
anything costly, and we used the same format for our queue choice the next
quarter."

LEARNING
"Raising it 1:1 with a proposed experiment, instead of an argument in a
meeting, turned it into a shared question rather than a contest."`,
      },
      explanation: `**Improvements:**
- **The manager's view is steelmanned** with real constraints (team expertise, ops tooling, deadline) and a factually fair point (MongoDB supports multi-document transactions). The original's "because he had used it before" made the manager look foolish.
- **The escalation path was fixed.** A 1:1 first, not a public challenge followed by going around the manager to the architect, which reads as political.
- **An experiment replaced the argument**, with concrete test design (200 parallel transfers, correctness, p99, complexity).
- **The decision owner is named** (the manager decided), and the candidate took on the cost of the decision (the runbook), so the new choice carried less risk.
- **The candidate conceded a point** (metadata stays in MongoDB), which shows they were not trying to win.
- **The relationship and process outcome** replace "he admitted I was right". The lasting change (spikes for costly disagreements) is the real win.`,
      followUps: [
        {
          q: 'Suppose the spike results had been a tie and your manager still chose MongoDB. What would you have done?',
          a: 'Disagree and commit, visibly. Write down the risk once (for example, contention behaviour under transactions) with the mitigations: idempotent transfer IDs, retry-on-TransientTransactionError, and a nightly reconciliation job. Then put full effort into making MongoDB succeed, and agree a checkpoint to revisit, such as "if we see more than N transaction aborts per minute at peak". Don’t keep re-arguing in every meeting. The interviewer is checking that you can commit to a decision that went against you.',
        },
        {
          q: 'When, if ever, would going to the architect have been the right move?',
          a: 'When the stakes are high (money, data loss, security) and the direct conversation has genuinely failed, and even then **with** your manager, not around them. For example: "I’d like to get the architect’s view since we disagree on something hard to reverse. Can we bring it to them together?" Joint escalation keeps trust intact. Going around your manager is reserved for ethical or safety issues, where it is the right thing to do.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'beh-scenarios-iq-01',
      difficulty: 'hard',
      question:
        'Walk me through a design debate with a peer engineer that ended with the team adopting their proposal over yours. What did you do in the weeks after the decision?',
      context:
        'Targets conflict resolution where the candidate lost. Write-ups on Meta’s conflict signal stress showing the outcome when you did not get your way; Razorpay HM rounds reportedly ask about arguments with seniors.',
      whatInterviewerLooksFor: [
        'Genuine respect for the other proposal (it can be steelmanned)',
        'A clear decision mechanism (data, owner, review)',
        'Full commitment after losing, with no "I told you so"',
        'Reflection on what the candidate learned from the other view',
      ],
      modelAnswer: `**Approach:** losing gracefully is a *stronger* conflict signal than winning. Show both proposals fairly, show how it was decided, and spend real time on **what you did after**.

**Example STAR (illustrative):**
- **S:** "We needed per-merchant rate limiting on our public payments API. I proposed a Redis sliding-window limiter inside our NestJS gateway. A peer proposed using our API gateway's (Kong) built-in rate-limiting plugin with a Redis backend."
- **T:** "We were both senior on the team, and the tech lead asked us to bring both options to the design review."
- **A:** "I wrote my option up honestly, including its cost: about 2 weeks to build and test, plus owning the code. Her option was about 3 days, but limited us to the plugin's algorithms and per-route configuration. In review, the deciding question was whether we needed per-merchant dynamic tiers in the next 6 months. Product said no. The team chose her proposal, and I agreed it was right for that horizon. Afterwards I volunteered to write the load test for the plugin. I found that the plugin's Redis calls added ~3ms p99 at 5k RPS, which was acceptable, and that a misconfigured Redis timeout would fail *open*. We documented it and set an alert. I also wrote a short note on what would trigger revisiting the decision: dynamic tiers, or more than ~20k RPS."
- **R:** "It shipped in a week, and it has been running for over a year. When dynamic tiers did come up 9 months later, we used my note to decide. We extended the plugin config instead of building our own. That proved her approach had more runway than I'd expected."
- **L:** "I'd been over-indexing on flexibility we didn't need yet. I now ask 'what is the 6-month requirement?' before proposing anything custom."`,
      followUps: [
        {
          q: 'Did any part of you want the plugin to fail? How did you guard against that bias in your load test?',
          a: 'Honest answers admit the temptation and describe a safeguard. For example: "A little, yes. So I wrote the test plan and pass criteria (p99 overhead under 5ms at 5k RPS, correct 429s at the limit) and shared them with her before running anything, and we reviewed the results together." Pre-agreeing criteria removes any doubt about how the results were judged, and saying so shows unusual self-awareness.',
        },
        {
          q: 'How did you behave in the review when it started going against you?',
          a: 'Describe specific behaviour: "I stopped arguing for my option once the 6-month requirement was clear, said out loud that her option fit better, and asked what risks we should cover." Mention tone: no long rebuttals, no re-opening the decision later in Slack. Interviewers want to know you can tell the difference between advocating and obstructing.',
        },
        {
          q: 'What if you had believed her option was genuinely unsafe, not just less flexible?',
          a: 'Then the bar changes: say clearly that it is a safety or correctness concern, not a preference, with evidence ("fails open under Redis timeout, which lets abusive traffic through to the PSP"). Ask for a mitigation as a condition (fail closed, or an alert plus a circuit breaker). If that is refused for something truly risky, escalate jointly with a written trade-off. Separating preference from risk is the senior judgment being tested.',
        },
      ],
      pitfalls: [
        'Telling a story where you "lost" but were later proven right',
        'Describing the peer’s proposal in a strawman way',
        'Saying "I went along with it" with no active commitment',
        'Choosing a trivial disagreement (naming, formatting)',
      ],
    },
    {
      id: 'beh-scenarios-iq-02',
      difficulty: 'expert',
      question:
        'Tell me about a severe outage where you were the incident commander and the trigger was a change made by a different team. How did you keep the response and the postmortem blameless?',
      context:
        'Cross-team incident leadership. Google’s SRE book describes blameless postmortems as focusing on contributing causes rather than individuals; senior candidates are expected to have run them.',
      whatInterviewerLooksFor: [
        'Structured incident command: roles, comms cadence, mitigation first',
        'Cross-team coordination without blame during the incident',
        'A postmortem focused on system gaps, written with the other team',
        'Action items across team boundaries that were actually completed',
      ],
      modelAnswer: `**Approach:** separate the **response** (command, comms, mitigation) from the **learning** (postmortem). In both, the other team is a partner, not the accused.

**Example STAR (illustrative):**
- **S:** "During a weekday peak, order creation success dropped from 99.8% to 70% at 13:10. The trigger turned out to be the identity team rotating JWT signing keys. Our order service cached the public keys (JWKS) for 24 hours and rejected new tokens."
- **T:** "I was on-call for orders and declared a SEV-1 at 13:14, taking incident command."
- **A (response):** "I opened an incident channel and assigned roles: me as IC, one engineer on diagnosis, our EM on stakeholder comms with 15-minute updates. I paged identity on-call *as a responder, not a suspect*: 'We're seeing JWT validation failures since 13:08. Any recent key changes?' They confirmed the rotation within 5 minutes. Fastest mitigation: identity re-published the old key alongside the new one (13:27), and we forced a JWKS refresh by restarting pods in batches. Success rate was back to 99.7% by 13:41."
- **A (postmortem):** "I co-authored it with the identity on-call. Contributing factors: our 24h key cache with no refresh-on-unknown-kid, their rotation runbook not including a key overlap period, and no shared contract test for key rotation. The doc had no names in the timeline, only roles."
- **R:** "31 minutes of impact, ~9,000 failed order attempts, with ~70% retried successfully. Action items: we refresh the JWKS on an unknown key ID with rate limiting (done in a week); identity added a 48-hour key overlap to their runbook (done); a quarterly rotation game day across 6 consuming services (the first one ran 6 weeks later and caught a similar cache bug in the notifications service)."

**Why it scores:** calm command, a partner framing in real time, and **fixes on both sides of the boundary**, including our own.`,
      followUps: [
        {
          q: 'Your VP asked in the incident channel "which team broke this?" How did you respond in the moment?',
          a: 'Redirect to impact and mitigation without naming a culprit: "Root cause is still being confirmed. Current impact is 30% of order creation failing, and the mitigation is in progress with identity and orders working together. ETA for recovery is about 15 minutes, and a full postmortem will follow." Then message the VP privately after recovery if needed. Protecting the responders during the incident keeps people sharing information quickly.',
        },
        {
          q: 'The identity team pushed back on the 48-hour overlap action item as "your cache bug, not ours". How did you resolve it?',
          a: 'Accept your share first: our cache not refreshing on an unknown key ID was a genuine bug, and we fixed it in a week. Then frame the overlap as protection for **all six consumers**, not just us, with the game-day evidence that another service had the same bug. Offer to draft the runbook change. If they still disagreed, take it to the reliability review as a shared standard, not as one team versus another.',
        },
        {
          q: 'Why restart pods in batches instead of all at once during the mitigation?',
          a: 'Restarting all pods at once would turn a 30% failure into 100% unavailability while pods restarted, warmed connection pools and refetched keys, and it could cause a thundering herd on the JWKS endpoint and the database. Batches of ~25% with readiness checks kept capacity up while each batch picked up the new keys. Saying why you chose the safer, slightly slower mitigation is part of the composure signal.',
        },
      ],
      pitfalls: [
        'Naming the other team or person as "the cause" in the story',
        'No clear roles; the IC is also debugging alone',
        'Action items only for the other team',
        'No evidence the action items were completed or worked',
      ],
    },
    {
      id: 'beh-scenarios-iq-03',
      difficulty: 'hard',
      question:
        'Tell me about a delivery date you personally committed to and missed. When did you first suspect it would slip, and how long did it take you to tell people?',
      whatInterviewerLooksFor: [
        'Honest ownership of the estimate and of the communication delay',
        'The gap between "I suspected" and "I told people", acknowledged',
        'A recovery that limited the damage to others',
        'A changed estimation or communication practice, with later evidence',
      ],
      modelAnswer: `**Approach:** the interviewer is really asking about the **gap between knowing and telling**. Own it explicitly. The strongest answers say "I knew earlier than I said, and here is what I changed."

**Example STAR (illustrative):**
- **S:** "I committed to delivering a GraphQL subscriptions feature (live order updates for our partner app) in 5 weeks."
- **T:** "I owned the estimate and the build. The partner team planned a release around it."
- **A:** "In week 2 I discovered that our GraphQL gateway's WebSocket handling didn't work behind our load balancer's 60-second idle timeout. Connections dropped silently. I suspected it would cost a week or more. I didn't say anything until the end of week 3, because I hoped I could fix it quickly with keepalives. That was my mistake. When I did raise it, I gave a new date (week 7) and options: ship polling for the partner's release now and subscriptions later, or move their release. They chose polling. I then fixed the root issue: server pings every 25s, an LB idle timeout raised to 120s, and client reconnection with resume tokens."
- **R:** "Subscriptions shipped in week 7, two weeks late. Because of the polling fallback, the partner's release went out on its original date. Their lead told me later that a week-2 heads-up would have let them avoid a weekend of rework on their side."
- **L:** "Two changes I still use: any risk that could move the date by more than 20% gets raised within 48 hours, even if I think I can fix it. And my status updates have a 'confidence in date' line (high/medium/low). On my next project, I flagged a medium-confidence risk in week 1, and we landed on time."`,
      followUps: [
        {
          q: 'Why did you wait a week before raising it? What was going on in your head?',
          a: 'Name the real psychology: optimism bias, wanting to look capable, and believing "one more day" would fix it. Then say what you do about it now: a rule-based trigger (more than 20% date risk means raise it within 48 hours) instead of judging case by case, because your own judgment is biased in exactly those moments. Interviewers value candidates who know their failure modes and build guardrails against them.',
        },
        {
          q: 'How did your manager react, and did it change how they worked with you?',
          a: 'Give an honest answer, including any criticism: "She was clear that the late heads-up was the real problem, not the slip. For the next two projects she asked for weekly confidence ratings, which I found useful and kept doing even after she stopped asking." Showing that you accepted extra oversight without resentment, and earned trust back, signals maturity.',
        },
      ],
      pitfalls: [
        'Blaming the slip entirely on unknowns or other teams',
        'Claiming they told people immediately when the story suggests otherwise',
        'A trivial miss (a day or two) with no consequences',
        'A learning like "I will estimate better" with no mechanism',
      ],
    },
    {
      id: 'beh-scenarios-iq-04',
      difficulty: 'hard',
      question:
        'Your business team wants a loyalty-points feature live for the festive sale in three weeks; your honest estimate is seven. Tell me about a real situation like this. What did you say, and what shipped?',
      context:
        'Pushback on product scope under a fixed business date, a common situation at Indian consumer companies with sale-driven calendars.',
      whatInterviewerLooksFor: [
        'Uncovering the real goal behind the requested scope',
        'Options with explicit costs and risks, not a bare "no"',
        'Protecting correctness for money-like features',
        'A shared decision and a delivered outcome',
      ],
      modelAnswer: `**Approach:** a fixed date usually means a **flexible scope**. Find the minimum that delivers the business goal, and protect the parts that can't be wrong (balances, money).

**Example STAR (illustrative):**
- **S:** "Marketing wanted a full loyalty programme for the Diwali sale in 3 weeks: earn points on orders, redeem at checkout, tiers and a points history page. My estimate was ~7 weeks, mainly because redemption at checkout touches payments and needs ledger-grade correctness."
- **T:** "I was the backend lead for checkout and had to give the business a credible plan."
- **A:** "I met the marketing lead and asked what success for the sale looked like. The answer was 'drive repeat purchases after the sale', not redemption during it. That reframed everything. I proposed three options:
  1. Full scope in 7 weeks, which misses the sale.
  2. **Earn-only for the sale** (points credited asynchronously after delivery, a points balance in the app, redemption launching 4 weeks later). About 3 weeks.
  3. Full scope in 3 weeks, by skipping the ledger and idempotency work. I said clearly I wouldn't recommend it: double-redemptions at sale traffic would cost real money and trust.

  They picked option 2. I designed points as an append-only ledger from day one, so redemption later wouldn't need a migration, and made crediting idempotent on order ID."
- **R:** "Earn-only shipped 2 days before the sale. About 1.1M orders earned points during the sale period, with zero balance discrepancies in daily reconciliation. Redemption launched 4 weeks later, and marketing reported a higher repeat-purchase rate among points holders, which was their actual goal."

**The key moves:** reframing from *feature list* to *business outcome*, and refusing only the option that would put correctness at risk, with the reason stated plainly.`,
      followUps: [
        {
          q: 'The marketing head escalated to your VP saying engineering was "blocking the sale". What happened?',
          a: 'Describe calm, documented escalation handling: "I’d already sent the three options with costs in writing, so the VP saw a plan, not a refusal. In the meeting I restated the risk of option 3 in business terms (double redemptions at peak, refunds, trust), and the VP backed option 2." The lesson is to write the options down before anyone escalates, so the escalation is about trade-offs, not personalities.',
        },
        {
          q: 'Why was the append-only ledger worth building in a 3-week window?',
          a: 'Because it was cheap then and expensive later. Storing credit entries as immutable events (orderId, points, reason, timestamp) cost a few days. Retrofitting a mutable balance column into a ledger after a million users had balances would need a risky backfill and reconciliation. It also gave us auditability for disputes from day one. Spending time on the part that is hard to reverse, and cutting the reversible UI, is the judgment being shown.',
        },
      ],
      pitfalls: [
        '"I told them it was impossible" with no alternatives',
        'Agreeing to 3 weeks and then cutting corners silently',
        'Ignoring correctness risks for a money-like feature',
        'No outcome after the sale',
      ],
    },
    {
      id: 'beh-scenarios-iq-05',
      difficulty: 'expert',
      question:
        'How did you win roadmap time to pay down technical debt that had no customer-visible feature attached to it? Give me the actual numbers you used to make the case.',
      whatInterviewerLooksFor: [
        'Debt expressed in business units (incidents, hours, lead time, risk)',
        'An incremental paydown plan, not a big-bang rewrite',
        'Negotiation with product or leadership, with trade-offs accepted',
        'Measured improvement after the paydown',
      ],
      modelAnswer: `**Approach:** product leaders fund outcomes, not refactors. Translate the debt into **what it costs the business today** and **what it blocks tomorrow**. Ask for a bounded investment with a measurable return.

**Example STAR (illustrative):**
- **S:** "Our order service had a 25-minute CI pipeline with ~15% flaky integration tests, and a shared test database. Engineers re-ran builds constantly. Deploys were batched weekly because nobody trusted the suite."
- **T:** "I was a senior engineer on the team. Our PM's roadmap was fully booked with merchant features for two quarters."
- **A:** "I gathered numbers over two weeks:
  - ~30 PRs/week × an average of 1.6 re-runs × 25 min = **~20 engineer-hours/week waiting**, about half an engineer.
  - Weekly batched deploys meant **median lead time of 5 days** from merge to production.
  - 2 incidents in the last quarter where a hotfix took over 2 hours because of the pipeline.

  I proposed **one engineer (me) for 4 weeks** plus 10% of one teammate: parallelise tests with per-worker DB schemas via Testcontainers, quarantine flaky tests with an auto-ticket, and cache dependencies. In return I committed to measurable targets: CI under 10 minutes, flake rate under 2%, and daily deploys. The PM agreed to slip one low-priority feature by a sprint. I also paired the work with the next feature that touched the same test modules, so some of it rode along."
- **R:** "After 5 weeks: CI went from 25 to 8 minutes, flakes to ~1%, and we moved to on-demand deploys (about 3 a day). Median lead time dropped from 5 days to under 1. The PM later used the lead-time chart in a quarterly review as a team achievement."

**Why it works:** it is priced in hours and lead time, it is bounded (4 weeks, one person), it has **targets agreed before starting**, and the paydown is partly attached to feature work.`,
      followUps: [
        {
          q: 'What if the PM had said "not this quarter" despite the numbers?',
          a: 'Accept it and reduce the cost anyway. Fix the top 5 flakiest tests in small PRs alongside feature work, add a quarantine label so flakes stop blocking merges, and keep tracking the hours lost each week. Then bring the updated numbers to the next planning cycle. Persistent, data-backed and non-confrontational is the signal. Doing the work secretly and blowing feature dates is the anti-signal.',
        },
        {
          q: 'How do you decide which tech debt is NOT worth paying down?',
          a: 'Look at interest, not ugliness. Debt in code that rarely changes, rarely breaks, and isn’t on a critical path has little interest. Leave it. Prioritise debt that is touched often (high change frequency), causes incidents, or blocks a roadmap item. A rough score is change frequency × pain per change, plus incident risk. Saying "we deliberately left the legacy reporting module alone" shows prioritisation maturity.',
        },
      ],
      pitfalls: [
        '"We needed a quarter to refactor everything" with no business case',
        'Numbers that are vague ("a lot of time wasted")',
        'Doing the debt work secretly on top of features',
        'No measurement after the investment',
      ],
    },
    {
      id: 'beh-scenarios-iq-06',
      difficulty: 'expert',
      question:
        'Describe a time a neighbouring team’s service kept hurting your service’s reliability, and they had other priorities. How did you get them to change without anyone ordering them to?',
      context:
        'Influence without authority, at senior-to-staff scope. Here the other team owns the fix; the candidate cannot simply fix it themselves.',
      whatInterviewerLooksFor: [
        'Understanding the other team’s incentives and constraints',
        'Shared data and a low-cost path to the fix',
        'Protecting your own service in the meantime (no dependence on goodwill alone)',
        'Escalation used last, transparently and jointly',
      ],
      modelAnswer: `**Approach:** two tracks at once. **Protect your service now** with defensive engineering, and **influence the fix** by making it cheap and in their interest.

**Example STAR (illustrative):**
- **S:** "Our checkout service called the pricing service synchronously. Pricing's p99 spiked from 80ms to 1.5s several times a week, during their cache rebuilds, and our checkout error budget was burning at about 3x the sustainable rate."
- **T:** "I was the senior engineer on checkout. Pricing belonged to another team whose quarter was committed to a new promotions engine."
- **A (protect):** "First I reduced our own exposure: a 300ms timeout with one retry on a different pod, a circuit breaker, and a last-known-price fallback for up to 5 minutes for non-promotional items, which product signed off. That cut checkout errors from pricing by ~70% without waiting for anyone."
- **A (influence):** "Then I went to their tech lead with data from *their* perspective. Their own SLO dashboard showed the same spikes, and the promotions engine they were building would make cache rebuilds heavier. I proposed a specific fix: rebuild the cache in the background and swap atomically, instead of evicting and refilling. I offered to write the first PR. They agreed to review it. I paired with one of their engineers, so they owned the code."
- **R:** "The atomic swap shipped in 3 weeks. Pricing p99 during rebuilds dropped to ~120ms. Our error-budget burn returned to normal, and their promotions launch went smoothly. Their lead brought me into their next design review."

**Note:** I never escalated. If they had refused despite the error-budget data, I'd have brought both teams' SLO data to the reliability review **together with their lead**, as a shared prioritisation question.`,
      followUps: [
        {
          q: 'Writing a PR in another team’s codebase can feel like overstepping. How did you avoid that?',
          a: 'Ask first and follow their process. "I asked whether they’d accept a contribution, followed their contribution guidelines and code-owner review, and paired with their engineer so the design was theirs too." Leave the decision with them: they could reject the PR. Offering effort that makes their decision easier, without taking it over, is the boundary that makes influence work.',
        },
        {
          q: 'Product signed off on last-known-price fallback. What risks did you raise about it?',
          a: 'Stale prices can under- or over-charge customers. We limited it to non-promotional items, capped staleness at 5 minutes, logged every fallback with the price used, and had a reconciliation report for any mismatch with the eventual price. Promotional items failed closed (an error) because their prices change fast and carry legal and marketing commitments. Stating the blast radius you accepted shows judgment.',
        },
      ],
      pitfalls: [
        'Escalating to managers as the first step',
        'Only complaining, without protecting your own service',
        'Doing the fix in their codebase without their buy-in',
        'Describing the other team as incompetent',
      ],
    },
    {
      id: 'beh-scenarios-iq-07',
      difficulty: 'hard',
      question:
        'Apart from coaching any one person, what have you done that measurably raised the engineering bar of your whole team (reviews, design docs, testing or on-call)?',
      whatInterviewerLooksFor: [
        'A team-level mechanism, not individual heroics',
        'Adoption by others, ideally sustained without the candidate',
        'A measurable change in quality or speed',
        'Pragmatism: a bar raised without slowing the team to a crawl',
      ],
      modelAnswer: `**Approach:** a mechanism that **outlives your involvement**: templates, checklists, automated checks, rituals. Show adoption and a metric.

**Example STAR (illustrative):**
- **S:** "Our team of 8 had a pattern: 4 of the last 6 production incidents came from the same three classes of mistake: missing timeouts on outbound HTTP calls, non-idempotent Kafka consumers, and schema migrations that locked large tables."
- **T:** "As a senior engineer I didn't own the process, but these incidents were landing on our on-call rotation."
- **A:** "I did three things, in increasing order of durability:
  1. **A one-page 'production readiness' checklist** in the PR template (timeouts, retries with backoff, idempotency keys, migration safety: concurrent index creation, batched backfills). I wrote it from the incident data, and asked two teammates to edit it so it wasn't 'my' checklist.
  2. **Automated what I could:** an ESLint rule that flagged axios or fetch calls without a timeout in our NestJS services, and a CI check that ran migrations against a production-sized snapshot and failed if any lock was held for more than 2s.
  3. **A monthly 30-minute 'incident review' slot** where whoever was on-call presented one learning. I ran the first two, then rotated it."
- **R:** "Over the next two quarters, incidents from those three classes went from 4 to 0, and total incidents fell from 6 to 2. The lint rule caught 11 missing timeouts in the first month. The incident review continued after I moved teams. The new tech lead told me it was the most useful ritual they inherited."

**Note the trade-off handling:** the checklist was one page on purpose, and anything automatable was automated, so the bar went up without adding review friction.`,
      followUps: [
        {
          q: 'Some engineers saw the checklist as bureaucracy. How did you handle that?',
          a: 'Make it evidence-based and lightweight. Every item was tied to a real incident on our team ("this item exists because of the March outage"). Items that didn’t apply could be ticked N/A. I removed two items after a month because they never caught anything. Automating the most common checks meant reviewers stopped nagging about them. Asking the sceptics to co-own the next revision turned them into maintainers.',
        },
        {
          q: 'How do you know the drop in incidents was because of these changes and not luck?',
          a: 'Be honest about how strong the evidence is. We tracked the specific failure classes: the lint and CI checks blocked 11 timeout issues and 3 risky migrations before merge, which are prevented incidents we can count. The overall incident count is noisier, so I’d call that a supporting signal, not proof. Distinguishing direct evidence (blocked defects) from correlated evidence (incident totals) is a senior habit.',
        },
      ],
      pitfalls: [
        'Describing only personal mentoring of one person',
        'A process that only works while the candidate enforces it',
        'Heavyweight bureaucracy with no automation',
        'No measurement of effect',
      ],
    },
    {
      id: 'beh-scenarios-iq-08',
      difficulty: 'hard',
      question:
        'Tell me about a time leadership handed you a one-line problem with no spec, no PM and no obvious owner. How did you turn it into a plan people could execute?',
      whatInterviewerLooksFor: [
        'Problem discovery from data and users before solutioning',
        'A written problem statement with explicit non-goals',
        'De-risking the hardest unknown first',
        'Stakeholder alignment and a regular communication rhythm',
      ],
      modelAnswer: `**Approach:** *discover → define → de-risk → deliver → communicate.* The non-goals are often the most senior part of the answer.

**Example STAR (illustrative):**
- **S:** "Our CTO said in a review: 'Our cloud bill is growing faster than our orders. Look into it.' There was no target, no owner and no FinOps team."
- **T:** "I volunteered to lead it, alongside my regular work, for the first month."
- **A:**
  - **Discover:** "I exported 6 months of billing data, tagged by service and environment. 38% of spend was non-production (staging and preview environments), 22% was one analytics Postgres cluster, and compute in production grew 2.5x while orders grew 1.4x."
  - **Define:** "I wrote a one-page problem statement: 'Bring cost per order back to the January level within two quarters without affecting SLOs.' Non-goals: no multi-cloud, no re-architecture of the analytics pipeline this half, no reserved-instance commitments until usage stabilised."
  - **De-risk:** "The riskiest assumption was that production pods were over-provisioned. I validated it on two services using p95 CPU and memory for 30 days before proposing anything org-wide."
  - **Deliver:** "Three workstreams with owners from three teams: preview environments auto-deleted after 48 hours, right-sizing using the Kubernetes VPA in recommendation mode, and moving the analytics cluster to a smaller instance with a read replica for heavy queries."
  - **Communicate:** "A fortnightly one-slide update to the CTO: spend, cost per order, the SLO dashboard."
- **R:** "Cost per order dropped ~27% in two quarters with no SLO breaches. Preview-environment clean-up alone saved ~12%. The cost-per-order metric became a standing item in monthly engineering reviews."`,
      followUps: [
        {
          q: 'How did you get engineers from three other teams to work on this when it was nobody’s OKR?',
          a: 'Make it visible and cheap. I showed each team their own share of the bill, which was surprising for most. I asked the CTO to mention it in the all-hands, so it had a sponsor. I took on the analysis and tooling (dashboards and VPA recommendations) so each team’s change was a few days’ work. And I gave public credit in every update. Sponsorship plus a low cost of participation is how unowned work gets done.',
        },
        {
          q: 'Why did you explicitly rule out reserved-instance commitments?',
          a: 'Reserved instances and savings plans give large discounts but lock you into a usage level for 1–3 years. With usage about to drop from right-sizing and clean-up, committing early would have locked in the waste. The plan was to reduce first, watch usage stabilise for a month or two, then commit to the new baseline. Explaining a non-goal with its reasoning shows you understand the order in which the work has to happen.',
        },
      ],
      pitfalls: [
        'Jumping straight to solutions ("we moved to spot instances") without discovery',
        'No problem statement or success metric',
        'Calling a well-specified project "ambiguous"',
        'Doing everything alone instead of creating ownership',
      ],
    },
    {
      id: 'beh-scenarios-iq-09',
      difficulty: 'hard',
      question:
        'In the same week you had a P1 customer bug, a release your PM had promised to a large merchant, and a security patch with a disclosure deadline. Tell me about a week like that: how did you sequence it, and what did you drop?',
      whatInterviewerLooksFor: [
        'An explicit prioritisation rationale (risk, reversibility, cost of delay)',
        'Saying no or "later" to something, and communicating it',
        'Delegation and parallelisation, not heroics',
        'Outcomes for all stakeholders, including the ones deprioritised',
      ],
      modelAnswer: `**Approach:** rank by **severity of harm × how irreversible it is × cost of delay**. Make the ranking visible to stakeholders. **Delegate** wherever you can. Say clearly what slipped.

**Example STAR (illustrative):**
- **S:** "In one week: (1) a P1 where ~2% of UPI refunds were stuck in 'processing'; (2) a dashboard export promised to a top merchant for Friday; (3) a critical CVE in a JSON parsing library we used in 6 services, which our security team required patched within 5 days."
- **T:** "I was the senior engineer on payments, with two other engineers available."
- **A:** "I wrote the three items in our channel with my proposed order and reasoning, and tagged the PM and EM:
  1. **The P1 refunds first.** Customer money was stuck and support load was growing. I took it myself, since I knew the refund state machine best.
  2. **The CVE in parallel, delegated.** A teammate bumped the dependency across 6 services with a single scripted PR series. I reviewed the first PR and the canary checks.
  3. **The merchant export moved to Monday.** I asked the PM to tell the merchant on Wednesday, not Friday, and offered a manual CSV from a read replica for Friday as a bridge.

  The refund bug was a missing transition when the PSP returned an unknown intermediate status. I fixed the transition, added a sweeper job for stuck refunds, and reprocessed ~1,400 affected refunds idempotently."
- **R:** "Refunds were resolved in 2 days. The CVE was patched across all services in 3 days. The merchant got a manual CSV on Friday and the self-serve export on Monday. The PM said the early heads-up made the conversation easy. In the retro, we added the unknown-status case to our PSP contract tests."

**Key signal:** the ranking was **explicit and shared on day one**, not decided silently.`,
      followUps: [
        {
          q: 'Why not put the security patch first? It had an external deadline.',
          a: 'It did, but the risk had to be weighed. The vulnerable path parsed only internal, authenticated payloads in 4 of 6 services, and the deadline was 5 days away, while the refund bug was harming customers right now. So the patch went in parallel, not first. If the CVE had been actively exploited on an internet-facing endpoint, it would have gone first, and I’d have pulled someone off the refunds. Showing what conditions would change the order is the judgment signal.',
        },
        {
          q: 'How did you make sure the 1,400 reprocessed refunds were not double-paid?',
          a: 'Reprocessing used the original refund ID as the idempotency key at the PSP, and before each retry we checked the current PSP status, so anything already succeeded was just marked complete. We ran it in batches of 100 with a dry-run report first, compared the totals against the PSP settlement file, and kept a manual-review list for edge cases. Mentioning reconciliation after a bulk money operation is expected at senior level.',
        },
      ],
      pitfalls: [
        'Doing all three personally through late nights',
        'Deprioritising silently, so the merchant finds out on Friday',
        'No clear ranking rationale',
        'Ignoring the security deadline because it "seemed less urgent"',
      ],
    },
    {
      id: 'beh-scenarios-iq-10',
      difficulty: 'expert',
      question:
        'Tell me about working closely with a peer whose deliverables repeatedly arrived late or broken and blocked your work. What did you say to them, word for word, and what changed?',
      context:
        'Difficult teammate / under-performance, from an IC perspective (the candidate is not the manager). Interviewers probe for directness, empathy and when the manager was involved.',
      whatInterviewerLooksFor: [
        'A direct, private, specific conversation (not gossip or escalation first)',
        'Curiosity about root causes (skills, overload, unclear expectations, personal issues)',
        'Practical support plus clear expectations',
        'An appropriate, transparent manager involvement if things did not improve',
      ],
      modelAnswer: `**Approach:** say the actual words (the interviewer asks "word for word" to test whether the conversation really happened), show curiosity, offer support, agree on expectations and follow up.

**Example STAR (illustrative):**
- **S:** "A peer owned the inventory-reservation API my checkout work depended on. Over a month, three handoffs slipped by 3–4 days each, and one shipped without handling the 'reservation expired' case. That caused a staging bug that cost me two days."
- **T:** "I'm not his manager, but our shared milestone was at risk, and I'd rather fix it with him than around him."
- **A:** "I asked for a 1:1 and said roughly: *'The last three API handoffs came in later than we agreed, and the expired-reservation case was missing in the last one. That cost me about two days, and our milestone is now at risk. I wanted to talk to you before anyone else. Is something making these harder than we expected?'* He told me he was also on a payments migration that his manager had added mid-sprint, and that he hadn't felt able to push back. We agreed three things: (1) we'd write the API contract together first as an OpenAPI spec with error cases, so I could build against a mock and wasn't blocked; (2) he'd give me a 'confidence' signal at each standup; (3) he'd raise the double booking with his manager, and I offered to join that conversation if useful. He asked me to join."
- **R:** "His manager moved the migration out a sprint. The next two handoffs arrived on time and contract-tested. Our milestone slipped by 3 days instead of 2 weeks. We kept the contract-first approach for every cross-team API after that."
- **If it had not improved:** "I'd have told him first that I was going to raise it with our managers as a delivery risk, and framed it around the milestone, not his performance."`,
      followUps: [
        {
          q: 'What if he had become defensive and denied there was a problem?',
          a: 'Lower the temperature and stick to facts: "I might be missing context. Here are the three handoff dates and what we agreed." Then focus on the forward plan rather than agreement about the past: "Can we try writing the contract first for the next one?" If he keeps denying it and the risk remains, tell him you will raise the milestone risk with the managers. Telling him first keeps it fair and transparent.',
        },
        {
          q: 'At what point would you go to your manager without talking to him first?',
          a: 'Only when talking to him first would be inappropriate or unsafe: harassment, a security or integrity issue, or a pattern that has already been discussed directly without change. For ordinary delivery problems, the direct conversation comes first. Going straight to the manager damages trust and removes his chance to fix it. Being able to say clearly where that line is shows judgment.',
        },
      ],
      pitfalls: [
        'Going to the manager first',
        'Vague retelling ("I talked to him nicely") with no specifics',
        'Speculating about the peer’s competence or personal life',
        'Taking over all his work silently, which hides the problem',
      ],
    },
    {
      id: 'beh-scenarios-iq-11',
      difficulty: 'hard',
      question:
        'What is the hardest piece of feedback you have received in the last two years? Quote it as closely as you can, tell me how you reacted that day, and show me what is different now.',
      whatInterviewerLooksFor: [
        'Feedback that is genuinely uncomfortable, not cosmetic',
        'An honest account of the initial reaction',
        'Validation of the feedback and a specific behaviour change',
        'Evidence that the change stuck (observed by others or measured)',
      ],
      modelAnswer: `**Approach:** pick feedback about **how you work with people or make decisions**, not about a technical skill gap. Honesty about your first reaction makes it credible. **Evidence that the change stuck** is what scores.

**Example STAR (illustrative):**
- **S:** "After a tough migration, my skip-level said in a 1:1: *'You're the person I trust most in a crisis, but between crises you go quiet. I find out about risks from other people. That makes it hard to put you on bigger projects.'*"
- **T:** "I wanted to lead the next platform initiative, and this was directly in the way."
- **Reaction:** "Honestly, my first reaction was to think 'I'm busy doing the work'. I was annoyed for a day. Then I realised the feedback was about *visibility*, which is part of the job at senior level, not about effort."
- **A:** "I asked my manager for two specific examples, which confirmed the pattern. I'd known about a vendor API deprecation for two weeks before mentioning it. I changed three things:
  1. **A weekly 5-line written update** to my manager and skip-level: progress, risks, decisions needed, confidence in dates.
  2. **'Risk first' in standups.** I lead with what might go wrong, not what I did yesterday.
  3. **A design doc for anything over two weeks**, shared early, even in rough form."
- **R:** "Three months later, the skip-level picked me to lead a cross-team Kafka migration and mentioned the weekly updates as the reason she felt comfortable. I've kept the updates going for over a year. Two people on my team now write them too, after seeing them."
- **L:** "Doing good work isn't enough at senior level. The people relying on me need to *see* the risks early enough to act on them."`,
      followUps: [
        {
          q: 'Was any part of that feedback unfair? How did you handle that part?',
          a: 'A mature answer separates the substance from the framing: "Part of it felt unfair. During the migration I was heads-down because the deadline was tight, and the quietness was partly the situation. But the pattern existed outside crises too, so I acted on the part that was true and mentioned the context once in a calm follow-up." Admitting partial disagreement while still changing shows confidence, not defensiveness.',
        },
        {
          q: 'How do you ask for feedback now, rather than waiting for it?',
          a: 'Ask specific questions on a regular schedule. For example: after each design review, I ask one reviewer "what’s one thing that would have made this doc easier to review?"; in quarterly 1:1s, "what’s one thing I should start doing to operate at the next level?". General questions ("any feedback?") get "all good". Specific questions get useful data. Showing the mechanism proves the growth is ongoing, not a one-off.',
        },
      ],
      pitfalls: [
        'Picking cosmetic feedback ("I should add more comments")',
        'Arguing that the feedback was wrong',
        'No evidence that anything changed',
        'Claiming to have had no reaction at all, which is not credible',
      ],
    },
    {
      id: 'beh-scenarios-iq-12',
      difficulty: 'expert',
      question:
        'Describe a design or vendor choice you had to commit to before you could benchmark properly, for example a datastore, queue or third-party provider. How did you limit the damage if you were wrong?',
      context:
        'Decision-making under incomplete data, outside an incident setting. Separating reversible from irreversible choices is the core of the signal.',
      whatInterviewerLooksFor: [
        'A clear statement of what was known, unknown and the cost of waiting',
        'Reversibility analysis and design for an exit',
        'Explicit assumptions and triggers that would change the decision',
        'An outcome, including whether the assumptions held',
      ],
      modelAnswer: `**Approach:** state the **decision, the deadline and the cost of waiting**. Then show how you **made the choice reversible**, or limited the irreversible part, and **which signals would trigger a revisit**.

**Example STAR (illustrative):**
- **S:** "We had to choose an SMS/OTP provider for a new login flow within a week, because the old provider's contract was ending. We had no time to benchmark delivery rates across Indian telecom operators at scale."
- **T:** "I owned the notification service and the recommendation."
- **A:**
  - **Known:** pricing, API features, DLT (sender-ID) registration support, and two peer companies' informal reports.
  - **Unknown:** real delivery latency and success rate on our traffic mix, especially during peak hours.
  - **Cost of waiting:** OTP outage risk when the old contract lapsed.
  - **Decision:** "I picked the provider with the best informal reports and solid DLT support. More importantly, I built a **provider-agnostic interface** in our NestJS notification service (a strategy pattern behind a single \`sendOtp\` port) and integrated a **second provider as a fallback** at low volume (5%) from day one. That made switching a config change, not a project."
  - **Triggers:** "OTP delivery under 95% within 30s, or p95 delivery latency over 10s for any operator, measured from the provider's delivery receipts, for 2 consecutive days. Either one would shift traffic automatically, and if it continued, we'd review the contract."
- **R:** "In week 3, the primary's delivery to one operator dropped to ~88% during evening peaks. Routing by operator moved that slice to the secondary within an hour of the alert. Login success stayed above 98%. We renegotiated the contract to per-operator routing with both providers, and that became the standard pattern for email and WhatsApp too."

**The core move:** the *provider* choice was a one-way door (a contract), but the *architecture* made switching cheap, so the decision could be made quickly and safely.`,
      followUps: [
        {
          q: 'Running a second provider at 5% costs money and effort. How did you justify it?',
          a: 'Compare it with the cost of being wrong. OTP failure blocks logins and payments, so even an hour of degraded OTP means lost transactions and support load. The second provider cost a small monthly minimum plus about a week of integration, and the 5% traffic kept the integration tested continuously, so the fallback wasn’t broken when we needed it. A fallback that is never exercised usually doesn’t work when it is finally needed.',
        },
        {
          q: 'Which assumption turned out wrong, and what did you learn about making these calls?',
          a: 'The informal peer reports were accurate on average but hid per-operator variance. Our traffic mix was more concentrated on one operator than theirs. The learning: when using others’ data, ask how their situation differs from yours, and instrument the dimension most likely to differ (here, per-operator metrics) from day one. Naming the specific wrong assumption shows real reflection.',
        },
      ],
      pitfalls: [
        'Presenting a guess as a confident, fully analysed decision',
        'Analysis paralysis: waiting for perfect data past the deadline',
        'No exit strategy or triggers defined in advance',
        'Not checking afterwards whether the assumptions held',
      ],
    },
  ],
  envelopeQuestions: [],
  test: [
    {
      id: 'beh-scenarios-mcq-01',
      difficulty: 'hard',
      question:
        'Which ending to a design-disagreement story gives the strongest conflict-resolution signal?',
      options: [
        '"Three months later the system hit exactly the problem I predicted, and my lead admitted I had been right."',
        '"The architect made the call against my proposal. I built the load test for their design, documented two risks with alerts, and we now co-review schema changes."',
        '"We couldn’t agree, so each of us built our own version and let the team pick the better one."',
        '"I escalated to the director, who sided with me, and the project went smoothly afterwards."',
      ],
      correct: [1],
      explanation:
        'The best ending shows disagree-and-commit with active support (a load test, mitigations) and a relationship that got stronger afterwards. Option 1 is the "I was right" victory lap. Option 3 wastes effort and avoids resolving the conflict. Option 4 escalates as the resolution, and "sided with me" frames it as winning rather than deciding well.',
      followUps: [
        {
          q: 'The interviewer asks "Were you right in the end?" and you genuinely were. How do you answer without undoing the signal?',
          a: 'Acknowledge it briefly, then move to the system-level learning. For example: "Partly. We did hit the retry-storm issue I’d flagged, but the mitigation we’d agreed in the review contained it within minutes, and the design had benefits I’d undervalued." Then say what you both changed afterwards. Being right matters less than how the team handled the risk together.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-02',
      difficulty: 'expert',
      question:
        'An incident story includes this line. What is the biggest problem with it from an interviewer’s point of view?',
      code: {
        language: 'text',
        title: 'Candidate answer (excerpt)',
        code: `"...the outage happened because Rahul from the platform team pushed a broken
Helm chart without testing it. I found his change in 40 minutes, reverted it
myself, and then told his manager so it would not happen again."`,
      },
      options: [
        'It names a specific person as the cause, which is the opposite of blameless culture and suggests the candidate would make incidents unsafe to report',
        'It is too short. Incident stories need more technical detail about Helm',
        'Reverting another team’s change is never acceptable during an incident',
        '40 minutes to find the change is too slow, which shows weak debugging skills',
      ],
      correct: [0],
      explanation:
        'Naming and blaming an individual, and reporting them to their manager, is a strong anti-signal. Blameless postmortems focus on system gaps (an untested chart could ship, there was no canary, no change correlation in alerts). Reverting a change during an incident can be correct if your runbook allows it. Time-to-detect could be discussed, but it is not the main problem here.',
      followUps: [
        {
          q: 'Rewrite the line blamelessly while keeping the facts.',
          a: '"A platform Helm change rolled out without a canary step, and our alerts didn’t correlate errors with recent deploys, so it took 40 minutes to identify. I reverted it under our incident runbook and looped in platform on-call. In the joint postmortem we added canary analysis to the chart pipeline and deploy markers on our dashboards." The facts are the same, but the focus is on system gaps and joint fixes.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-03',
      difficulty: 'hard',
      question:
        'Select ALL elements that make a "failure" story credible and level-appropriate for a senior engineer.',
      options: [
        'A failure where your own decision or inaction was a material cause',
        'Real but recoverable consequences, with numbers (days slipped, customers affected)',
        'A learning stated as a principle ("communication is important")',
        'A specific practice you changed, and a later project where it made a difference',
        'A failure that happened because of factors fully outside your control',
      ],
      correct: [0, 1, 3],
      explanation:
        'Credible failure stories have your own causal role, a real and quantified cost, and a concrete practice that was changed and later proven. A general principle with no mechanism is filler. A failure caused entirely by outside factors gives no self-awareness signal and sounds like deflection.',
      followUps: [
        {
          q: 'How big should the failure be? Is an outage that lost significant revenue too risky to share?',
          a: 'A large failure is fine if your role, response and learning are strong. It can even signal scope. The risk is a failure showing poor judgment that was never fixed (for example, repeated data loss from skipping backups). Choose one where your recovery was solid and the systemic change is clear. Avoid trivial failures: they read as evasive.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-04',
      difficulty: 'medium',
      question:
        'Product asks for a feature in 3 weeks; your estimate is 8. Which first response best demonstrates senior pushback?',
      options: [
        '"That’s not possible. Engineering needs 8 weeks for quality work."',
        '"OK, we’ll try our best." Then you quietly cut tests to hit the date.',
        '"What outcome do we need by that date? Here are three options with costs: a phased MVP in 3 weeks, the full scope in 8, or the full scope in 3 with these named risks."',
        '"Let me ask my manager to talk to your manager about the timeline."',
      ],
      correct: [2],
      explanation:
        'Senior pushback asks what the deadline is really for, then offers options with explicit costs so the business can decide with full information. A flat "no" stalls the conversation. Silently cutting quality hides risk and usually fails later. Escalating first skips the direct problem-solving the PM is entitled to.',
      followUps: [
        {
          q: 'The PM picks "full scope in 3 weeks with named risks." What do you do next?',
          a: 'Write the risks down with the mitigations you will still apply, and get the PM and EM to acknowledge them. For example: "no load test at sale scale, so we add a feature flag and a kill switch"; "reduced test coverage on edge cases, so we reconcile daily for the first two weeks". Commit fully to the delivery and plan a hardening sprint straight after. If any risk involves money or security, insist on that minimum safeguard as a condition, not an option.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-05',
      difficulty: 'hard',
      question:
        'You want 20% of next quarter for tech debt. Which argument is most likely to win the PM and EM over?',
      options: [
        '"The codebase is messy and engineers are unhappy working in it."',
        '"Industry best practice is to spend 20% on tech debt, as Google does."',
        '"Flaky CI costs us about 20 engineer-hours a week, weekly deploys push lead time to 5 days, and 2 of 3 recent incidents traced to the shared schema. Here is a 4-week plan with targets."',
        '"If we don’t refactor now, we will need a full rewrite in a year."',
      ],
      correct: [2],
      explanation:
        'Debt gets funded when it is priced in business units and bounded by a plan with measurable targets. Developer happiness matters but rarely wins on its own. "Industry practice" claims are unverifiable and context-free. Rewrite threats are speculative and tend to reduce trust.',
      followUps: [
        {
          q: 'The PM agrees to 10%, not 20%. How do you spend it?',
          a: 'Rank by interest: the debt that costs the most per week and is touched most often. Here the flaky CI comes first (hours saved every week, starting immediately), then the shared-schema hot spots attached to features already planned in that code. Publish the before and after numbers so the next request is easier. Accepting the smaller amount and showing a quick return builds the case for more.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-06',
      difficulty: 'expert',
      question:
        'Select ALL tactics that typically count as influence without authority when you need three other teams to adopt a shared idempotency library.',
      options: [
        'Showing each team its own duplicate-processing incidents and their cost',
        'Building a drop-in module and offering to pair on the first migration',
        'Asking your VP to mandate adoption in the next all-hands before talking to the teams',
        'Running an RFC where the teams can change the design, and incorporating their feedback',
        'Getting one respected team to adopt first and share its results',
      ],
      correct: [0, 1, 3, 4],
      explanation:
        'Their own data, a lower adoption cost, co-designing through an RFC, and social proof from an early adopter are classic influence mechanisms. A top-down mandate before any engagement is authority, not influence. It also tends to produce reluctant, shallow adoption. Leadership sponsorship can help later, once teams have had their say.',
      followUps: [
        {
          q: 'One team says "our service never has duplicates." How do you respond?',
          a: 'Check the claim with data rather than arguing. For example, run a query for duplicate (orderId, eventType) rows in their tables over 90 days, or replay a Kafka partition through a consumer in staging after a forced rebalance. If they really have none, accept it and ask them to review the library as a stakeholder. If duplicates turn up, share the findings privately first. Persuading them with their own data, without embarrassing them, keeps the relationship intact.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-07',
      difficulty: 'medium',
      question:
        'Which detail most strengthens a mentoring story?',
      options: [
        '"I spent two hours every week with them for six months."',
        '"I’m known as the go-to person for help on my team."',
        '"Within ten weeks they ran sale-day on-call alone and wrote the postmortem for a consumer-lag incident."',
        '"I shared many articles and books with them about distributed systems."',
      ],
      correct: [2],
      explanation:
        'The evidence for mentoring is the mentee’s observable growth, here independent on-call and owning a postmortem. Time spent (option 1) and resources shared (option 4) are inputs, not outcomes. Being "the go-to person" (option 2) may even signal a bottleneck rather than someone who grows others.',
      followUps: [
        {
          q: 'How would you show that the improvement came from your mentoring and not just from their experience?',
          a: 'Link specific interventions to specific changes. For example, the game days targeted diagnosis order, and their time-to-first-hypothesis in real incidents dropped. The runbook template we wrote together is what they used in the solo incident. Also mention their own credit ("they did the hard work"). Interviewers do not expect proof of causation, but they do expect a plausible, specific link.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-08',
      difficulty: 'hard',
      question:
        'A candidate describes an "ambiguous project" in which the PM provided a PRD, designs and acceptance criteria, and the ambiguity was "which ORM to use". What is the main weakness?',
      options: [
        'ORM choice is too technical for a behavioural round',
        'The story lacks real ambiguity: the problem, users and success criteria were defined, so it shows execution, not handling ambiguity',
        'The candidate should have used a different ORM',
        'Ambiguity stories should always involve a production incident',
      ],
      correct: [1],
      explanation:
        'The ambiguity signal is about creating structure where the problem, goals or ownership are unclear. A fully specified project with one open implementation detail does not test that, and interviewers notice the mismatch. Technical detail is fine in behavioural answers, and incidents are a separate category.',
      followUps: [
        {
          q: 'The candidate’s best ambiguity example is small in scope. How can they still make it land?',
          a: 'Focus on the moves rather than the size: how they found the real problem (data, users), wrote a problem statement with non-goals, de-risked the biggest unknown first, and kept stakeholders updated. A small project handled with clear structure shows the behaviour. Then mention how they would apply it at larger scope, ideally with a second, partial example.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-09',
      difficulty: 'expert',
      question:
        'During an outage you must decide whether to fail over to a secondary payment provider never tested at full load. Select ALL elements of a strong decision-under-uncertainty answer.',
      options: [
        'Classifying the routing change as reversible (config flag) and acting quickly because of that',
        'Shifting a fraction of traffic first, with rollback triggers defined in advance',
        'Waiting for the primary provider’s root-cause analysis before acting, to avoid making things worse',
        'Stating explicitly what was unknown and what signal would change the decision',
        'Moving 100% of traffic immediately, since a decisive action is what interviewers want to hear',
      ],
      correct: [0, 1, 3],
      explanation:
        'Strong answers use reversibility to justify speed, limit the blast radius with a gradual shift and rollback triggers set in advance, and state the unknowns and the signals that would change course. Waiting for the vendor’s RCA during an active outage is analysis paralysis. Moving 100% at once is reckless, not decisive.',
      followUps: [
        {
          q: 'What rollback triggers would you set for the secondary provider, concretely?',
          a: 'Use metrics you can observe within minutes: payment success rate below a floor (for example under 97% over 5 minutes, compared with the primary’s normal ~98–99%), p99 authorisation latency above a ceiling (for example 2s), and an error-code spike such as timeouts or "issuer unavailable". Decide in advance who can flip it back, and announce the thresholds in the incident channel so nobody debates them under pressure.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-10',
      difficulty: 'hard',
      question:
        'A peer’s PRs repeatedly break the build, and you depend on their work. What is the best first step?',
      options: [
        'Raise it with your manager so it is documented before it gets worse',
        'Mention it in the team retro so everyone can discuss the pattern',
        'Talk to them privately with specific examples and impact, and ask what is making it hard',
        'Quietly fix their PRs yourself so your work is not blocked',
      ],
      correct: [2],
      explanation:
        'A private, specific, curious conversation respects the peer, often uncovers the cause (overload, unclear expectations, missing tooling) and keeps escalation for later. Going to the manager first damages trust. Raising it in a public retro can humiliate them. Silently fixing their work hides the problem and does not scale.',
      followUps: [
        {
          q: 'The conversation reveals they are overloaded by work from another team. What now?',
          a: 'Help them raise it rather than solve it for them. For example: "Would it help if we brought this to your manager together, with the list of commitments and dates?" Meanwhile reduce the coupling: agree an API contract or mock so you can work in parallel, and add a pre-merge CI check for the breakage pattern. Overload is a prioritisation problem for managers to resolve; your job is to make it visible.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-11',
      difficulty: 'medium',
      question:
        'Asked about tough feedback, which candidate response raises the interviewer’s confidence the most?',
      options: [
        '"I haven’t really received negative feedback. My reviews have always been strong."',
        '"My manager said I was too blunt in reviews. I don’t fully agree, because I think directness is good engineering culture."',
        '"I was told I go quiet between crises and leadership learns about risks from others. I was annoyed at first, then started weekly risk-first updates. Three months later I was picked to lead a cross-team migration because of them."',
        '"I was told to improve my documentation, so I now write more comments in my code."',
      ],
      correct: [2],
      explanation:
        'The strongest answer has uncomfortable, meaningful feedback, an honest first reaction, a specific change, and evidence that the change worked. Claiming never to have had negative feedback is not credible. Disputing the feedback signals defensiveness. Cosmetic feedback with a cosmetic fix avoids the real question.',
      followUps: [
        {
          q: 'The interviewer asks: "What feedback would your current team give you today?" How should you approach it?',
          a: 'Give a current, honest growth area that you are working on, not a solved one. For example: "Probably that I take on too much of the hard debugging myself instead of pairing. I’ve started pairing juniors on the gnarly incidents." Show self-awareness and the action you are taking. Consistency with what references would say matters, because interviewers sometimes check.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-12',
      difficulty: 'expert',
      question:
        'Select ALL statements that describe a well-run blameless postmortem that an interviewer would credit.',
      options: [
        'The timeline uses roles and system events rather than individual names',
        'Contributing factors include process and tooling gaps, not only the triggering code change',
        'Action items have owners and dates, and the story says which were completed',
        'The person whose change triggered the incident is excluded from the review to avoid embarrassment',
        'The postmortem concludes with "human error" as the root cause so that the fix is clear',
      ],
      correct: [0, 1, 2],
      explanation:
        'Blameless postmortems (as in Google’s SRE book) describe the timeline in terms of roles and events, look for contributing factors in systems and processes, and track actions to completion. The person who made the change is usually the best source of context, so excluding them loses information. "Human error" as a root cause is the classic blameful dead end.',
      followUps: [
        {
          q: 'Your postmortem had 9 action items; 6 months later only 3 are done. How do you talk about that in an interview?',
          a: 'Honestly, and with what you learned about follow-through. For example: "We closed the 3 highest-impact ones (alerting, canary, runbook). The rest stalled because they had no owner’s quarter attached. Since then I limit postmortems to the top 3–4 actions, each with a ticket in the owning team’s sprint, and review them in the monthly ops meeting." Showing you learned how to make action items get done is itself a senior signal.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-13',
      difficulty: 'hard',
      question:
        'A candidate answers "Tell me about a time you had too much on your plate" with: "I worked 14-hour days for three weeks and delivered everything." What is the interviewer most likely to conclude?',
      options: [
        'Strong ownership and dedication, which deserve a high score',
        'Weak prioritisation and communication: there was no explicit trade-off, no delegation and no stakeholder conversation, and the approach is not sustainable',
        'The candidate is lying, because nobody can work 14-hour days',
        'The story is fine but should be told with more technical detail',
      ],
      correct: [1],
      explanation:
        'The prioritisation signal is about making trade-offs explicit, delegating and setting expectations, not absorbing everything through overtime. Heroics suggest a hidden bottleneck and burnout risk. Dedication is not ignored, but it does not answer the question. Calling the candidate a liar is not a reasonable conclusion, and adding technical detail would not fix the missing signal.',
      followUps: [
        {
          q: 'If the 14-hour days really happened, how could the candidate retell the story honestly and still score well?',
          a: 'Keep the truth and add the reflection: "I absorbed it by working long hours. It worked once, but it wasn’t sustainable and it hid the overload from my manager. In the next crunch I listed the commitments, proposed what to defer, and delegated the CVE patch, and we delivered without overtime." Turning it into a learning story shows growth instead of praising the heroics.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-14',
      difficulty: 'hard',
      question:
        'After your design-disagreement story, the interviewer asks "And what if your manager had still said no?" Which answer best signals senior judgment?',
      options: [
        '"I would keep raising it in every design review until they agreed."',
        '"I would implement my approach anyway in a separate branch to prove it worked."',
        '"For a reversible preference I would commit fully. For a real correctness or safety risk, I would document it, ask for a specific mitigation, and if needed escalate jointly with them."',
        '"I would accept it and stop caring about the outcome, since it is their decision."',
      ],
      correct: [2],
      explanation:
        'Separating preference from risk, then choosing commitment or a transparent joint escalation, is the mature answer. Repeated re-litigation and shadow implementations are obstruction. Disengaging ("stop caring") fails the commit half of disagree-and-commit, which requires active support for the decision.',
      followUps: [
        {
          q: 'Give an example from backend work where the risk would justify escalation even after the manager said no.',
          a: 'Shipping a payment-capture path without idempotency, so retries can double-charge customers. Or storing card data or PII outside the compliance boundary (PCI DSS, India’s DPDP Act obligations). Or disabling auth on an internal endpoint that is internet-reachable. These cause irreversible harm to customers or legal exposure. Even then: document it, propose the minimum safeguard, and escalate together with the manager, not around them.',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-15',
      difficulty: 'expert',
      question:
        'Following a sale-day outage story, the interviewer probes: "what would you do differently, and how did you know it worked?" Select ALL replies that make the candidate look more senior.',
      options: [
        '"Looking back, I’d have rolled back at minute 5 instead of 12. I spent 7 minutes confirming a hypothesis that a rollback would have tested faster."',
        '"Nothing. Our response was textbook and I wouldn’t change anything."',
        '"The deeper fix was organisational: three teams deployed into the sale freeze, so I proposed a shared change calendar, which the platform group now runs."',
        '"I don’t remember the numbers, but it was a big outage and we fixed it fast."',
        '"I measured success by repeat incidents: zero of that class in the next two sales, and the connection alert fired once and was handled from the runbook."',
      ],
      correct: [0, 2, 4],
      explanation:
        'Specific hindsight about your own decisions, a systemic fix beyond your team, and a measured way of verifying the learning all signal senior or staff maturity. Claiming nothing could be improved signals low self-awareness. Vague recall without numbers suggests limited involvement, or a story the candidate cannot go deep on.',
      followUps: [
        {
          q: 'Why is "rollback at minute 5 instead of 12" such a strong hindsight line?',
          a: 'It is specific and about your own decision, and it shows a principle you now apply: when a recent deploy correlates with the impact, roll back first and diagnose second. It also shows you understand time-to-mitigate as the key metric for customers. It is self-critical without being self-destructive, which is exactly the self-awareness interviewers try to find through "what would you do differently?".',
        },
      ],
    },
    {
      id: 'beh-scenarios-mcq-16',
      difficulty: 'medium',
      question:
        'A candidate has one good conflict story and is asked "Tell me about another time you disagreed with someone." What is the best move?',
      options: [
        'Retell the same story from a different angle, hoping the interviewer will not notice',
        'Tell a second, smaller but real disagreement from the story bank, ideally with a different kind of counterpart (PM vs engineer)',
        'Say that conflict is rare on their team because everyone gets along',
        'Describe how they would handle a hypothetical future disagreement',
      ],
      correct: [1],
      explanation:
        '"Another time" checks that the behaviour is a pattern, not a one-off. A second real story, ideally with a different counterpart, provides that evidence. Retelling the same story is noticed. Claiming conflict never happens reads as conflict-avoidance. A hypothetical answer gives no evidence of past behaviour.',
      followUps: [
        {
          q: 'Which three counterpart types should a senior backend engineer have conflict stories for?',
          a: 'A peer engineer (a design or approach debate), a manager or someone more senior (direction, priorities, deadlines), and a cross-functional partner such as product, SRE or security (scope, risk, rollout). Different counterparts test different skills: technical persuasion, upward disagreement, and trade-offs across functions. Covering all three in your story bank means most disagreement prompts have a ready answer.',
        },
      ],
    },
  ],
};

export default topic;
