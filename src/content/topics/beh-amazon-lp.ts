import type { Topic } from '../../types';

// Leadership Principle names and wording verified against amazon.jobs (16 principles, checked Oct 2026).
// Loop / Bar Raiser facts come from aboutamazon.com pages, Working Backwards (Carr & Bryar) and
// candidate reports cited in `sources`. Example stories are illustrations to adapt, never to recite.

const topic: Topic = {
  id: 'beh-amazon-lp',
  phase: 'behavioral',
  order: 2,
  title: 'Amazon Leadership Principles & The Bar Raiser',
  subtitle:
    'All 16 LPs decoded for a backend engineer: how the loop and the Bar Raiser work, how answers are scored at SDE-2 vs SDE-3, example STAR stories, the follow-up drill-down and the traps',
  estimatedMinutes: 150,
  sources: [
    'Amazon.jobs: Leadership Principles (16 principles, official wording): https://www.amazon.jobs/content/en/our-workplace/leadership-principles',
    'About Amazon: The Amazon Bar Raiser program (3,600+ Bar Raisers, "better than 50% of would-be peers", training): https://aboutamazon.com/news/workplace/amazon-bar-raiser',
    'About Amazon: How Amazon hires / All about Bar Raisers (objective third party, written feedback): https://www.aboutamazon.com/working-at-amazon/how-amazon-hires',
    'About Amazon: Amazon interview process (phone screens, loops, STAR, examples for each LP): https://aboutamazon.com/news/workplace/amazon-interview-process-phone-screens-loops',
    'About Amazon: Interview tips from recruiters (use data, "I" not "we", avoid staying high-level): https://aboutamazon.com/news/workplace/amazon-interview-best-tips',
    'About Amazon Australia: 8 interview tips from Amazon Bar Raisers (be self-critical, end with a result): https://www.aboutamazon.com.au/news/workplace/8-interview-tips-from-amazon-bar-raisers-to-help-you-clinch-the-job',
    'About Amazon India: Two new Leadership Principles (2021): https://www.aboutamazon.in/news/company-news/two-new-leadership-principles',
    'GeekWire (Jul 2021): Amazon adds two new leadership principles: https://www.geekwire.com/2021/amazon-adds-two-new-leadership-principles-just-days-jeff-bezos-steps-ceo/',
    'Bill Carr & Colin Bryar: Working Backwards (2021), Ch. 2 "Hiring: Amazon\'s Unique Bar Raiser Process" (written feedback and vote before debrief, Bar Raiser cannot be the hiring manager, veto power)',
    'Fortune (Aug 2024): Amazon reinstates Bar Raisers for SDE-1 (L4) loops: https://fortune.com/2024/08/07/amazon-bar-raisers-entry-level-interview-hiring-procedure',
    'Jeff Bezos: 2015 Letter to Shareholders (Type 1 vs Type 2, one-way vs two-way door decisions)',
    'ITPro / Business Insider (Feb 2025): Amazon asks candidates not to use GenAI tools in interviews unless explicitly permitted: https://itpro.com/business/careers-and-training/amazon-bans-ai-tools-during-job-interviews',
    'LeetCode Discuss: Amazon SDE-2 India interview experiences, 2025 (rounds = DSA+LP, LLD+LP, HLD+LP, Bar Raiser; LP prompts on ownership, conflicts, unfamiliar tech, saying no to customers, tight deadlines): https://leetcode.com/discuss/post/6699329/amazon-sde-2-india-interview-experience-5gzeo/ , https://leetcode.com/discuss/post/7009755/amazon-sde-2-bangalore-4-yoe-july-2025-o-o826/ , https://leetcode.com/discuss/post/6923887/amazon-sde-2-interview-experience-select-rwpm/',
    'Glassdoor: Amazon interview reviews, India (2025–2026): https://www.glassdoor.co.in/Interview/Amazon-Interview-E6036-RVW102270038.htm',
    'Hello Interview: Amazon L6 guide; DesignGurus: Amazon SDE levels (L5 team scope vs L6 multi-team scope): https://www.hellointerview.com/guides/amazon/l6 , https://www.designgurus.io/blog/amazon-sde-levels',
    'IGotAnOffer: Amazon Bar Raiser interview; Ophy AI / Interview Kickstart 2026 guides (Bar Raiser drill-down patterns, "a more recent failure"): https://igotanoffer.com/blogs/tech/amazon-bar-raiser-interview , https://ophyai.com/blog/company-guides/amazon-interview-guide',
    'Companies with LP-style / bar-raiser rounds: Uber (DesignGurus Uber guide, Educative 2025), Flipkart (TechPrep 2026), Coinbase (Prepfully), Meesho (Dataford, LeetCode Discuss SDE-III)',
  ],
  tags: [
    'behavioral',
    'amazon',
    'leadership-principles',
    'bar-raiser',
    'star',
    'sde-2',
    'sde-3',
    'ownership',
    'dive-deep',
    'disagree-and-commit',
  ],
  cheatSheet: [
    'There are **16** LPs on amazon.jobs (Oct 2026). "Have Backbone; Disagree and Commit" is ONE principle. The two newest (added July 2021) are Strive to be Earth\'s Best Employer and Success and Scale Bring Broad Responsibility.',
    'Loop = 4–5 x ~60 min. Each interviewer is assigned 2–3 LPs, and most rounds are LP + tech (India SDE-2 reports: DSA+LP, LLD+LP, HLD+LP, Bar Raiser = DSA + deep LP).',
    'Bar Raiser = trained interviewer from outside the hiring team, cannot be the hiring manager, runs the debrief and can veto (Working Backwards). The bar: better than 50% of would-be peers.',
    'Interviewers write their feedback and vote BEFORE the debrief, so each round stands alone. A strong DSA round does not rescue a "we did it" LP answer.',
    'Scoring = a specific situation + "I" actions + numbers before/after + scope that fits the level + survives 3–4 follow-ups + honest learning. Without numbers the result is just an opinion.',
    'SDE-2 (L5) stories own a team-level project end to end. SDE-3 (L6) stories span multiple teams, set direction, build mechanisms and make one-way-door calls.',
    'Bank about 10–12 real stories and make each one serve 2–3 LPs, giving 2 per LP. Never use the same story twice in one loop, because debrief compares notes.',
    'Prepare bullet notes, not scripts: headline, 3 actions, 2 numbers, 1 mistake, 1 thing you would change. Practise out loud with someone who keeps asking "why?".',
    'Classic traps: blaming others in conflict stories, "failures" that are humble-brags, disagree-and-commit with no commit, Frugality that cut reliability, Bias for Action on a one-way door.',
    'Recency matters: prefer the last 2–3 years, and have a failure from the last 6–12 months ready, because Bar Raisers often ask for a "more recent" one.',
  ],
  sections: [
    {
      heading: 'The 16 Leadership Principles, decoded for an engineer',
      body: `**Intuition:** the LPs are Amazon's scoring rubric, not a culture poster. Each interviewer leaves the room with a written note on a few LPs, so you are graded on **evidence**, not enthusiasm.

The list below was checked against amazon.jobs in October 2026. It has **16** principles. Many prep blogs still say 14 (the count before July 2021) or list "Have Backbone" and "Disagree and Commit" as two separate items. **They are one principle.**

| # | Leadership Principle | Official anchor phrase | What the interviewer is really checking |
|---|---|---|---|
| 1 | Customer Obsession | "start with the customer and work backwards" | Did you name a real customer, internal or external, and change course for them? |
| 2 | Ownership | "They never say 'that's not my job.'" | Long-term fixes, and acting outside your lane when nobody owned the problem |
| 3 | Invent and Simplify | "always find ways to simplify" | Did you remove complexity, or just add a new tool? |
| 4 | Are Right, A Lot | "work to disconfirm their beliefs" | Judgment under uncertainty, and changing your mind on evidence |
| 5 | Learn and Be Curious | "never done learning" | Self-driven learning that changed an outcome |
| 6 | Hire and Develop the Best | "take seriously their role in coaching others" | Mentoring with a measurable result, and raising the bar in interviews |
| 7 | Insist on the Highest Standards | "defects do not get sent down the line" | Did you fix the class of problem so it stays fixed? |
| 8 | Think Big | "create and communicate a bold direction" | Vision beyond the ticket, and getting others to follow it |
| 9 | Bias for Action | "We value calculated risk taking." | Speed on reversible decisions, plus a rollback plan |
| 10 | Frugality | "no extra points for growing headcount, budget size, or fixed expense" | More with less, without trading away quality |
| 11 | Earn Trust | "vocally self-critical" | Owning your mistakes in public, candour and respect |
| 12 | Dive Deep | "skeptical when metrics and anecdote differ" | Can you go 4 levels down into your own system? |
| 13 | Have Backbone; Disagree and Commit | "do not compromise for the sake of social cohesion" | Challenging with data, then committing fully |
| 14 | Deliver Results | "rise to the occasion and never settle" | Shipping the right thing despite setbacks, with honest trade-offs |
| 15 | Strive to be Earth's Best Employer | "lead with empathy" | Growing others, and making the team safer and fairer |
| 16 | Success and Scale Bring Broad Responsibility | "leave things better than how they found them" | Secondary effects of your work on users, communities and the planet |

**In the interview, say this:** you will never be asked to recite the list. You will be asked "Tell me about a time…", and the interviewer maps your story to their assigned LPs. Know the anchor phrases so you can tell which LP a question is probing.`,
      keyPoints: [
        '16 principles. Backbone and Disagree-and-Commit are one LP.',
        'Each prompt targets 1–2 LPs. Recognise which ones from the wording.',
        'Anchor phrases such as "work backwards", "disconfirm", "no task is beneath them" reveal what will be probed.',
      ],
      source: 'amazon.jobs: Leadership Principles (verified Oct 2026)',
    },
    {
      heading: 'How the Amazon loop works, and how LP and technical questions mix',
      body: `**Intuition:** an Amazon loop is several independent exams. Each exam has a coding or design part and an LP part. Each examiner marks only their assigned LPs, and the marks are compared at the end.

**The pipeline (SDE-2 / SDE-3, India, as candidates report it in 2025–2026):**
- **Online assessment:** coding problems, and candidates commonly report a work-style section too. SDE-3 candidates are sometimes taken straight to a phone screen.
- **Phone screen (optional):** one coding or design problem plus 1–2 LP questions.
- **Loop:** About Amazon says you meet "two to seven" employees. SDE-2 reports usually describe 4 rounds: **DSA + LP, LLD + LP, HLD + LP, and the Bar Raiser (DSA + deep LP)**. SDE-3 loops lean more on HLD and on LP depth.
- **Assignment:** each interviewer is typically given **2–3 LPs to probe**, so across a loop most of the 16 get covered. Interviewers coordinate so the same LP is not probed twice.
- **Time split:** candidates often report 15–25 minutes of LP at the start of a round, then the technical problem. In the Bar Raiser round, LP can take half the hour or more.
- **Decision:** Amazon says to expect a decision within about 5 business days after the loop, and the whole process takes about 3–6 weeks.

**What this means for you:**
1. Every round can sink you on LP. A great LLD round with a vague Ownership answer is a "mixed" vote.
2. Plan **different stories for different rounds**. Interviewers read each other's notes in the debrief, and repeating a story wastes a round.
3. The technical part also produces LP evidence. How you handle a hint shows **Learn and Be Curious**. Pushing back on a requirement shows **Customer Obsession**. Checking edge cases shows **Insist on the Highest Standards**.
4. Since February 2025, Amazon has asked candidates **not to use GenAI tools during interviews unless explicitly permitted**, and breaking this can lead to disqualification. Reading a prepared answer off a screen is easy to spot and counts against you.`,
      diagram: `  OA (coding + work-style)    Phone screen (optional)
        |                            |
        v                            v
  +---------------------------------------------------------+
  |  LOOP  (each ~60 min, each interviewer owns 2-3 LPs)    |
  |  R1  DSA  + LP  [e.g. Ownership, Deliver Results]       |
  |  R2  LLD  + LP  [e.g. Insist on Highest Standards]      |
  |  R3  HLD  + LP  [e.g. Think Big, Dive Deep]             |
  |  R4  Bar Raiser: DSA/design + DEEP LP [any LP]          |
  +---------------------------------------------------------+
        |
        v
  Each interviewer writes feedback + votes (before talking)
        |
        v
  Debrief run by the Bar Raiser -> hire / no hire
  (hiring manager decides; Bar Raiser can veto)`,
      source: 'About Amazon: interview process; LeetCode Discuss Amazon SDE-2 India 2025 reports; ITPro 2025',
    },
    {
      heading: 'The Bar Raiser: who they are, what they veto, and how the debrief works',
      body: `**Intuition:** the Bar Raiser is a referee from another team. They have no deadline pressure to fill the seat, so they can say "not this one".

**Facts from Amazon's own pages and from *Working Backwards*:**
- A Bar Raiser is "a specially trained interviewer" who acts as "an objective third party" and "a steward of the company's Leadership Principles". There are **3,600+** of them, drawn from every job family (SDEs, PMs, HR, marketing). They are not paid extra.
- Training takes **3 months to a year**, including shadowing experienced Bar Raisers.
- The bar: every hire should be **"better than 50% of their would-be peers in similar roles"** and should have growth potential.
- *Working Backwards* (Carr & Bryar) says the Bar Raiser **cannot be the hiring manager or the recruiter**, runs the debrief, and **can veto a hire, overriding the hiring manager**. The hiring manager normally makes the final call.
- Every interviewer **writes feedback and casts a vote before the debrief**, so nobody anchors on the most senior voice. In the debrief the Bar Raiser pushes each interviewer to back their vote with evidence from your answers. Fortune reports they ask questions like "What does Amazon miss out on if we don't hire this person?".
- Amazon dropped Bar Raisers from many SDE-1 loops during pandemic hiring and **reinstated them in 2024** (Fortune). Expect one in every loop.

**What the Bar Raiser round feels like** (candidate reports and coaching guides):
- Fewer questions, much deeper. One story can take 10–15 minutes.
- Common probes: "What exactly did *you* do?", "Where's the data?", "What would you do differently?", "Tell me about a **more recent** failure."
- They often test LPs that no other interviewer covered, and they check whether your level fits. A story that reads as SDE-2 in an SDE-3 loop gets a down-level suggestion.
- You are usually not told which interviewer is the Bar Raiser, so treat every round as if it were.

**In interviews, say this:** nothing special. Just never coast in any round.`,
      keyPoints: [
        'Bar Raiser comes from outside the team, is not the hiring manager, runs the debrief and holds a veto.',
        'Written votes come before discussion, which prevents groupthink, so every round must stand on its own.',
        'Bar: better than 50% of current peers at that level, with growth potential.',
      ],
      source: 'About Amazon: Bar Raiser program; Working Backwards Ch. 2; Fortune 2024',
    },
    {
      heading: 'How LP answers are scored: data, scope, "I", and depth under follow-ups',
      body: `**Intuition:** the interviewer is a journalist checking a claim. Your headline is the claim, and the follow-ups are fact-checks. They score what still stands after the fact-checks.

**The five things every LP answer is scored on:**

| Signal | Weak | Strong |
|---|---|---|
| Specificity | "Usually when there's an incident I…" | "On 14 March, checkout p99 went from 180 ms to 4 s…" |
| Personal action ("I") | "We decided to migrate…" | "I wrote the migration RFC, I built the dual-write shim, I ran the cutover" |
| Data | "Performance improved a lot" | "p99 4 s to 210 ms, error rate 3.1% to 0.05%, ₹9 lakh/month saved" |
| Scope for the level | Your own ticket | SDE-2: team project end to end. SDE-3: 3+ teams, a mechanism, a direction |
| Depth under probing | Story collapses at "why?" | Can explain trade-offs, alternatives and who disagreed, 4 levels deep |

Amazon's own interview tips say this directly: **use data and metrics, use "I" not "we", and don't stay high-level.** Bar Raisers add: **be self-critical** and **end with a result**.

**SDE-2 (L5) vs SDE-3 (L6): the same prompt, different bar**

| Dimension | SDE-2 (L5) | SDE-3 (L6) |
|---|---|---|
| Scope | A feature or service your team owns | Systems that cross team boundaries, multi-quarter |
| Ambiguity | Well-defined problem, unclear solution | Unclear problem. You defined it |
| Influence | Convinced your team or tech lead | Convinced other teams' leads and managers without authority |
| Mechanisms | Fixed the bug, added a test | Built a guardrail, process or platform so the problem class can't recur |
| People | Helped a new joiner ramp up | Grew SDE-1s to SDE-2, ran design reviews, interviewed |
| Risk | Reversible calls | Made and owned one-way-door calls |

**STAR with an L at the end:** Situation (2 sentences), Task (your responsibility), Action (60% of the time, "I"), Result (numbers), and **Learning** (what you changed afterwards). Aim for about 2–3 minutes before the first follow-up.`,
      diagram: `  "Tell me about a time..."         <- your 2-3 min STAR
   |
   +- L1  What exactly did YOU do?    (Ownership, "I")
   |   +- L2  How did you know? Data? (Dive Deep)
   |       +- L3  Who disagreed? What did they say?
   |       |        (Earn Trust / Backbone)
   |       +- L3' What else did you consider? Why not that?
   |           +- L4  What would you do differently today?
   |                 What changed in the team after?
   |                 (Learning, mechanisms, level)
   Rehearsed stories collapse around L2-L3. Real ones get richer.`,
      source: 'About Amazon: recruiter and Bar Raiser tips; Hello Interview L6 guide; DesignGurus SDE levels',
    },
    {
      heading: 'Customer Obsession & Earn Trust',
      body: `**Customer Obsession: what it really means.** "Start with the customer and work backwards." For a backend engineer, the customer is often **internal**: the mobile team calling your API, the seller-ops team using your tool, the on-call engineer reading your alerts. The interviewer wants you to **name the customer, show what they needed, and show a decision you changed because of them**, not just that you "care about users".

**Common prompts:** "Tell me about a time you said no to a customer request." "…went above and beyond for a customer." "…used customer feedback to change a technical decision." "…balanced customer needs against engineering effort."

**Earn Trust: what it really means.** "Listen attentively, speak candidly… vocally self-critical, even when doing so is awkward or embarrassing." The strongest Earn Trust stories are about **your own mistake, owned in public**, or about rebuilding a relationship you damaged.

**Common prompts:** "Tell me about a time you had a conflict with a teammate." "…received critical feedback." "…had to deliver bad news to a stakeholder." "…made a mistake that affected others."

**Follow-up probes:** "How did you know this is what the customer wanted, not what they asked for?" "What did the customer say afterwards?" "How did the other person feel? How do you know?" "What would you do if it happened tomorrow?"

**Classic traps:**
- Customer Obsession stories where the "customer" is your manager.
- Saying yes to everything. A good "no" with an alternative scores higher.
- Earn Trust stories where the other person is the villain and you are the hero.
- Owning a mistake privately ("I quietly fixed it"). Being **vocally** self-critical is the signal.`,
      code: [
        {
          language: 'text',
          title: 'Example story to adapt (Customer Obsession + Earn Trust), not to recite',
          code: `S: Our Payments API (NestJS, ~4K RPS) was used by 6 client teams. The
   checkout-mobile team asked for a new endpoint returning the full
   order + payment + refund history in one call (about 40 KB per response).
T: I owned the API. Building it as asked would take 2 sprints and
   triple payload size on 2G/3G networks in tier-2 cities.
A: - I pulled their client traces: 92% of calls only rendered the latest
     payment status and the refund state.
   - I sat with their lead for 30 minutes on the actual screen, and the
     history was for a rarely opened "details" page.
   - I proposed a 1.2 KB status field on the existing response now, plus a
     paginated history endpoint later. I said no to the one-big-call
     design and explained why with their own data.
   - I shipped the status field in 4 days behind a feature flag.
R: The checkout screen's p95 render fell from 1.9 s to 1.1 s on 3G, and
   their "payment pending" support tickets dropped 23% in the next month.
   The history endpoint shipped 6 weeks later, used by 4% of sessions.
L: I now ask for the screen or job-to-be-done before reviewing any API
   request. Our API intake template has a "what will you render?" field.`,
        },
      ],
      keyPoints: [
        'Name the customer, internal or external. Show the data that revealed their real need.',
        'A reasoned "no, but here is what you need" beats "I did everything they asked".',
        'Earn Trust is strongest when you are the one who made the mistake and said so publicly.',
      ],
      source: 'amazon.jobs LPs; LeetCode Discuss Amazon SDE-2 India 2025 ("saying no to customers", conflicts)',
    },
    {
      heading: 'Ownership & Bias for Action',
      body: `**Ownership: what it really means.** "Leaders are owners. They think long term… They act on behalf of the entire company… never say 'that's not my job.'" The interviewer is listening for two things: **(1) you acted outside your formal responsibility** when nobody else did, and **(2) you fixed the long-term cause**, not only the symptom.

**Common prompts:** "Tell me about a time you took on something outside your area of responsibility." "…something that wasn't your job but you did it anyway." "…you made a long-term decision at the cost of short-term results." "…you saw a problem in another team's system."

**Bias for Action: what it really means.** "Speed matters… Many decisions and actions are reversible and do not need extensive study. We value calculated risk taking." The key word is **calculated**. Bezos's 2015 shareholder letter separates **two-way doors** (reversible decisions, so move fast) from **one-way doors** (irreversible, so be careful). A strong answer says which kind of door it was and how you made it reversible: a feature flag, a canary release, a rollback plan.

**Common prompts:** "Tell me about a time you made a decision without all the data." "…had to act quickly in an incident." "…took a calculated risk."

**Follow-up probes:** "Who should have owned it? Did you tell them?" "What did you stop doing to make time?" "What was the worst case if you were wrong? How would you have rolled back?" "Would you do it the same way at 10× the blast radius?"

**Classic traps:**
- An "Ownership" story that is just your assigned sprint work.
- Heroics with no lasting fix: "I stayed up 3 nights" and the problem came back.
- Bias for Action on a one-way door, such as dropping a production column or emailing all customers, with no safety net.
- Acting fast but not telling the owning team, which then fails Earn Trust.`,
      code: [
        {
          language: 'text',
          title: 'Example story to adapt (Ownership + Bias for Action), not to recite',
          code: `S: Our shared Kafka cluster (12 brokers) had no owner after the platform
   team was reorganised. Consumer lag alerts fired about 30 times a week,
   and each team muted them as "not mine".
T: I was an SDE-2 on the order-events team. Nobody asked me to fix it,
   but our order-confirmation SLA (2 min) was being missed about 1% of
   the time.
A: - Bias for Action: during a lag spike I found one team's consumer with
     max.poll.records=5000 and 9-minute rebalances. I made a reversible
     config change behind their feature flag, with their on-call on the
     call, and lag cleared in 6 minutes.
   - Ownership: I wrote a 2-page doc with 4 weeks of alert data, proposed
     per-team lag SLOs and routing alerts to the owning team, and took it
     to the 3 team leads.
   - I built the alert-routing (Terraform + team tags) myself over two
     weeks, on top of my sprint work, and handed it over to the new
     platform team with a runbook.
R: Unowned lag alerts went from about 30/week to 2/week. Order-confirmation
   SLA misses fell from 1% to 0.05% that quarter.
L: My mistake was a 6-week delay before raising it. I now raise an
   orphaned-alert problem within one on-call rotation.`,
        },
      ],
      keyPoints: [
        'Ownership = acting beyond your lane + a long-term fix + a clean handover.',
        'Bias for Action = speed on two-way doors. Say what made the decision reversible.',
        'Always say who the rightful owner was and how you kept them informed.',
      ],
      source: 'amazon.jobs LPs; Jeff Bezos 2015 Letter to Shareholders (Type 1 / Type 2 decisions)',
    },
    {
      heading: 'Dive Deep & Deliver Results',
      body: `**Dive Deep: what it really means.** "Leaders operate at all levels, stay connected to the details, audit frequently, and are skeptical when metrics and anecdote differ. No task is beneath them." This is the LP where backend engineers can shine, and where **made-up stories die fastest**. The interviewer keeps asking "why?" until you reach either bedrock or a bluff.

**Common prompts:** "Tell me about the hardest bug you've debugged." "…a time the metrics looked fine but customers were complaining." "…had to learn an unfamiliar system quickly to solve a problem." (Reported in 2025 India SDE-2 loops.) "…found the root cause behind a recurring issue."

**Deliver Results: what it really means.** "Focus on the key inputs… deliver them with the right quality and in a timely fashion. Despite setbacks, they rise to the occasion and never settle." Look for **a hard goal, a real setback, the trade-off you made, and a number at the end**. Cutting scope is fine if you say what you cut and why.

**Common prompts:** "Tell me about a time you delivered under a tight deadline." (Reported in 2025 India SDE-2 loops.) "…missed a deadline." "…had to make a trade-off between quality and speed." "…your most significant achievement."

**Follow-up probes (Dive Deep):** "What did the flame graph or query plan actually show?" "Why that threshold?" "What did you rule out, and how?" "How do you know it was the root cause and not a coincidence?"
**Follow-up probes (Deliver Results):** "What did you cut? Who agreed?" "What was the cost of the delay?" "What did the metric look like 3 months later?"

**Classic traps:**
- Dive Deep at the wrong level: "I looked at the dashboards and escalated."
- Forgetting your own numbers. If you don't remember, say how you would find them. Never invent them.
- Deliver Results with no setback. That makes it a status report, not a story.
- Delivering on time by quietly shipping defects, which fails Insist on the Highest Standards.`,
      code: [
        {
          language: 'text',
          title: 'Example story to adapt (Dive Deep + Deliver Results), not to recite',
          code: `S: Two weeks before a Diwali sale, our GraphQL gateway (NestJS + Apollo,
   ~9K RPS at peak) showed healthy p50/p99 on dashboards. But the support
   team had 140 tickets saying "cart takes forever".
T: I was the on-call SDE-2 and owned the cart resolvers. The sale freeze
   was 10 days away.
A: - Metrics and anecdotes disagreed, so I distrusted the dashboard. It
     sampled 1% of traces and skipped requests that timed out at the
     edge (those never reached our span exporter).
   - I enabled 100% tracing for the cart operation for 2 hours. The slow
     requests were carts with more than 25 items: one resolver ran per
     item and made ~3 SQL queries each (an N+1 problem: 75+ queries).
   - I added a DataLoader batch per request, plus a composite index on
     (cart_id, sku). In EXPLAIN ANALYZE, a 38 ms seq scan became 0.4 ms.
   - Setback: the batch broke a promo-pricing edge case in staging. I cut
     the planned resolver refactor, kept only the batched path behind a
     flag, and paired with the promo owner to add 14 regression tests.
R: Shipped 3 days before the freeze. Large-cart p99 went from 6.8 s to
   420 ms, and cart tickets fell from 140/week to 9 during the sale.
L: I added an edge-timeout counter to the dashboard and a rule in our
   review checklist: any list field resolver must say how it batches.`,
        },
      ],
      keyPoints: [
        'Dive Deep: "metrics and anecdote differ" is the classic setup, so trust the anecdote and verify it.',
        'Know your own numbers 4 levels deep: symptom, mechanism, fix, proof.',
        'Deliver Results needs a setback and an explicit trade-off, or it is just a status update.',
      ],
      source: 'amazon.jobs LPs; LeetCode Discuss Amazon SDE-2 India 2025 (unfamiliar tech, tight deadlines)',
    },
    {
      heading: 'Have Backbone; Disagree and Commit & Are Right, A Lot',
      body: `**Have Backbone; Disagree and Commit: what it really means.** This is **one LP with two halves**. "Leaders are obligated to respectfully challenge decisions when they disagree, even when doing so is uncomfortable or exhausting… They do not compromise for the sake of social cohesion. Once a decision is determined, they commit wholly." The interviewer scores **both halves**: did you push back **with data**, and when you lost (or won), did you **commit without sabotage or "I told you so"**?

**Common prompts:** "Tell me about a time you disagreed with your manager." "…disagreed with a senior engineer about a design." "…committed to a decision you didn't agree with." "…pushed back on a deadline or requirement."

**Are Right, A Lot: what it really means.** "Strong judgment and good instincts. They seek diverse perspectives and work to disconfirm their beliefs." Judgment is shown by **how you decided**: what options you considered, what evidence would have changed your mind, and how you tested your own assumption. Being right by luck doesn't count.

**Common prompts:** "Tell me about a time you made a decision with incomplete information." "…you were wrong." "…you changed your mind." "…a decision that turned out well even though people opposed it."

**Follow-up probes:** "What was their strongest argument?" "What data would have changed your mind?" "Once you committed, what did you do to make it succeed?" "Looking back, who was right?" "Did the relationship with that person change?"

**Classic traps:**
- Disagree and Commit without the disagreement: "I raised a concern in standup and then went along."
- Backbone that turns into escalation as a first move, or into winning at all costs.
- "I was right and they eventually saw it." Interviewers hear a lack of humility.
- Are Right, A Lot stories with no alternatives considered and no step to disprove yourself.`,
      code: [
        {
          language: 'text',
          title: 'Example story to adapt (Backbone; Disagree and Commit), not to recite',
          code: `S: Our principal engineer proposed moving inventory reads from Postgres
   to a new Cassandra cluster before the sale season (8 weeks away).
T: I was the SDE-2 owning inventory reads. I believed the real problem
   was 2 hot queries, not the database, and I had to say so to someone
   two levels above me.
A: - Backbone: I ran pg_stat_statements for a week. 2 queries were 71% of
     DB time, both fixable with a covering index and a read replica.
   - I wrote a 1-page comparison: Cassandra = 6-8 weeks, a new on-call
     skill, eventual consistency on stock counts. Index + replica = 4
     days, reversible. I shared it 1:1 with him first, then in review.
   - The decision: index + replica now (my proposal), but Cassandra stays
     on the roadmap for multi-region next year (his concern was real).
   - Commit: when the multi-region RFC started 5 months later, I
     volunteered to write the Postgres-to-Cassandra dual-write plan,
     even though I had argued against Cassandra earlier.
R: Sale peak: DB CPU at 48% (was 92% the year before), zero inventory
   incidents. The multi-region migration later shipped with my plan.
L: Taking it to him privately first kept the trust. I now share data
   1:1 with the decision owner before any public review.`,
        },
      ],
      keyPoints: [
        'Score both halves: challenge with data, then commit visibly and fully.',
        'Show the other side\'s strongest argument. It proves you listened.',
        'Are Right, A Lot = your decision process plus actively trying to prove yourself wrong.',
      ],
      source: 'amazon.jobs LPs',
    },
    {
      heading: 'Invent and Simplify, Think Big & Frugality',
      body: `**Invent and Simplify: what it really means.** "Expect and require innovation and invention from their teams and always find ways to simplify… not limited by 'not invented here'… may be misunderstood for long periods of time." For engineers the strongest version is usually **simplify**: deleting a service, collapsing 3 queues into 1, replacing a custom scheduler with a managed one. "Invent" doesn't mean "built from scratch". Reusing what exists is part of this LP.

**Think Big: what it really means.** "Thinking small is a self-fulfilling prophecy. Leaders create and communicate a bold direction that inspires results… look around corners." At SDE-2, Think Big is reframing a ticket into a platform. At SDE-3 it is a **multi-team direction** you wrote down and sold.

**Frugality: what it really means.** "Accomplish more with less… no extra points for growing headcount, budget size, or fixed expense." Cloud cost cuts are the natural engineering story. The BR will check that **you didn't buy savings with reliability or customer experience**.

**Common prompts:** "Tell me about your most innovative solution." "…simplified a complex process." "…had a vision that others didn't see at first." "…delivered with fewer resources than you wanted." "…saved your team money."

**Follow-up probes:** "What did you remove?" "Who resisted the simplification?" "How did you get others to buy in to the bigger vision?" "What did the cost cut risk, and how did you protect against it?" "How did you measure the saving: list price or actual bill?"

**Classic traps:**
- Invent = "I introduced Kafka/Kubernetes/GraphQL". Adding tech isn't simplifying.
- Think Big with no execution, just a vision deck.
- Frugality that is really cheapness: "We didn't add monitoring to save cost."
- Savings quoted as projections that nobody checked against the bill.`,
      code: [
        {
          language: 'text',
          title: 'Example story to adapt (Frugality + Invent and Simplify), not to recite',
          code: `S: Our notification platform ran 7 microservices (one per channel plus
   a router, scheduler and template service) on 46 always-on pods.
   AWS cost was about Rs 14 lakh/month, and every new template needed
   PRs in 3 repos.
T: I was asked to add WhatsApp as a channel with no extra headcount.
   The obvious path was an 8th service.
A: - I measured first: 80% of pod-hours were idle. Traffic was bursty
     (campaign blasts) and real-time sends were only 6% of volume.
   - Simplify: I proposed one "channel adapter" interface and folded
     the 4 channel services into one worker with plugins, scaled by
     queue depth (KEDA) instead of fixed replicas.
   - Frugality guardrail: OTP and payment alerts stayed on a separate
     always-warm pool with its own SLO (p99 < 3 s). Cost cuts could
     not touch that path.
   - I wrote the adapter, migrated SMS first behind a flag, and ran
     both paths in parallel for 2 weeks comparing delivery rates.
R: 7 services became 3, and 46 pods became 12 baseline. The bill fell to
   about Rs 6 lakh/month (verified on 3 monthly invoices). WhatsApp
   shipped as a 300-line adapter in 9 days. OTP p99 unchanged at 1.8 s.
L: I should have involved the on-call team earlier. Their runbooks
   lagged for 3 weeks after the merge.`,
        },
      ],
      keyPoints: [
        'Simplify = remove something. Invent includes smart reuse.',
        'Think Big at SDE-3 = a written, multi-team direction plus proof that others followed it.',
        'Frugality must protect the customer path explicitly. Quote actual bills, not projections.',
      ],
      source: 'amazon.jobs LPs',
    },
    {
      heading: 'Learn and Be Curious, Hire and Develop the Best & Insist on the Highest Standards',
      body: `**Learn and Be Curious: what it really means.** "Never done learning and always seek to improve themselves… curious about new possibilities and act to explore them." The interviewer wants **self-driven learning that changed an outcome**: you learned eBPF, Postgres internals or a new domain *because a problem needed it*, and then used it. A list of courses you've taken doesn't count.

**Hire and Develop the Best: what it really means.** "Raise the performance bar with every hire and promotion… develop leaders and take seriously their role in coaching others." Engineer versions: mentoring a junior to independence, giving hard feedback, running interview loops, raising the bar in code review. **Measure the mentee's outcome**, not your effort.

**Insist on the Highest Standards: what it really means.** "Relentlessly high standards… continually raising the bar… ensure that defects do not get sent down the line and that problems are fixed so they stay fixed." The strongest stories **raise the bar for a whole team**: a test gate, an SLO, a design-review checklist. "I personally rewrote it at 2 a.m." is weak.

**Common prompts:** "Tell me about something you learned recently that you applied at work." "…mentored someone." "…gave difficult feedback to a peer." "…refused to compromise on quality." "…were not satisfied with the status quo."

**Follow-up probes:** "How did you know the mentee had improved? What do they do now?" "What did the person say when you gave the feedback?" "Did your higher standard slow the team down? How did you justify the cost?" "What is the last thing you learned purely out of curiosity?"

**Classic traps:**
- Mentoring that is just "I answered their questions".
- Standards stories that are perfectionism: blocking a release over style nits.
- Learning stories with no application.
- Not knowing where the mentee is now. Interviewers ask.`,
      code: [
        {
          language: 'text',
          title: 'Example story to adapt (Insist on the Highest Standards + Hire and Develop), not to recite',
          code: `S: Our team shipped 3 Sev-2s in one quarter from schema migrations that
   locked large Postgres tables (ALTER TABLE on a 180M-row orders table).
T: I was the senior-most SDE-2. Rollbacks were fine, but "be careful"
   was the only guardrail, and two SDE-1s had caused 2 of the 3.
A: - Standard: I wrote a CI check (squawk lint + a staging dry-run with
     lock_timeout = 2s) that fails any migration taking an ACCESS
     EXCLUSIVE lock on tables over 1M rows without an approved plan.
   - Develop: instead of reviewing every migration myself, I ran two
     45-minute sessions on expand/contract migrations. Then I paired
     with each SDE-1 on their next real migration, and they drove.
   - I made one of them, Riya, the owner of the migration runbook, and
     had her present it at the org engineering forum.
R: Zero migration-caused incidents in the next 3 quarters (vs 3 in one).
   The CI check blocked 7 risky migrations in 6 months. Riya was promoted
   to SDE-2 a year later and now reviews migrations for 2 teams.
L: My first draft of the check was too strict (11 false positives in a
   week). I tuned it with the team instead of defending it.`,
        },
      ],
      keyPoints: [
        'Learning counts only when it changes an outcome. Name what you did with it.',
        'Develop: measure the mentee\'s growth. Where are they now?',
        'Standards: build a mechanism that keeps problems fixed, not a one-off heroic fix.',
      ],
      source: 'amazon.jobs LPs',
    },
    {
      heading: 'The two newest LPs: Earth\'s Best Employer & Success and Scale Bring Broad Responsibility',
      body: `**Background:** Amazon added both in **July 2021**, the first additions since 2015 (Learn and Be Curious was the 14th). Many older prep sheets miss them, but they are on the official list and can be assigned.

**Strive to be Earth's Best Employer: what it really means.** "Leaders work every day to create a safer, more productive, higher performing, more diverse, and more just work environment. They lead with empathy… Are my fellow employees growing? Are they empowered? Are they ready for what's next?" For an IC engineer, good evidence includes: **fixing a toxic on-call rotation**, making a team process more inclusive (e.g. async design reviews for remote and quieter engineers), supporting a colleague through a hard time, or helping someone grow even when they then leave your team.

**Success and Scale Bring Broad Responsibility: what it really means.** "We are big, we impact the world, and we are far from perfect. We must be humble and thoughtful about even the secondary effects of our actions… Leaders create more than they consume and always leave things better than how they found them." Engineering evidence: **thinking through second-order effects** such as privacy (PII in logs), accessibility, energy and compute waste, the effect of an API change on partner sellers, or abuse vectors of a feature you built.

**Common prompts:** "Tell me about a time you made your team's work environment better." "…supported a teammate who was struggling." "…considered the broader impact of a technical decision." "…left a system or codebase better than you found it."

**Follow-up probes:** "How did you know people were burning out? What data?" "What did it cost the team in delivery?" "Who outside your team was affected, and how did you find out?" "What did you give up to do the right thing?"

**Classic traps:** turning these into generic diversity statements with no action, or confusing them with Customer Obsession. The secondary-effects angle is what makes the second one distinct.`,
      code: [
        {
          language: 'text',
          title: 'Example story to adapt (Earth\'s Best Employer + Broad Responsibility), not to recite',
          code: `S: Our 6-person team's on-call got 55 pages/week, 60% of them between
   11 p.m. and 7 a.m. Two engineers had asked to switch teams, and
   one had a newborn.
T: I wasn't the manager, but I ran the on-call retro that quarter.
A: - Data: I tagged 8 weeks of pages. 70% were non-actionable (CPU > 80%
     style), and 3 noisy alerts produced half the night pages.
   - I proposed SLO burn-rate alerts instead of resource alerts, and
     converted 22 alerts to daytime tickets. The manager approved a
     2-sprint budget.
   - Empathy: I proposed a "parent swap" rule (no night shifts for
     3 months, covered by volunteers who got comp days) and took 2 of
     those weeks myself.
   - Broad responsibility: while tagging, I found we logged full phone
     numbers in 4 services. I raised it with security, masked them, and
     added a log-linter rule so it can't come back.
R: Pages fell from 55 to 12/week (night pages from 33 to 4). Neither
   engineer left. The PII log rule is now used by 9 teams.
L: I should have pushed for this a quarter earlier instead of normalising
   the pain.`,
        },
      ],
      keyPoints: [
        'Added July 2021, so older prep material often omits them.',
        'Earth\'s Best Employer for an IC = safer, fairer and more growth-oriented team mechanics.',
        'Broad Responsibility = second-order effects (privacy, partners, waste), and leaving things better.',
      ],
      source: 'amazon.jobs LPs; About Amazon India / GeekWire, July 2021',
    },
    {
      heading: 'One story, many LPs: building a story bank that does not sound rehearsed',
      body: `**Intuition:** you don't need 32 stories. You need about **10–12 real, rich stories**, each told from different angles. A big migration contains an Ownership story, a Dive Deep story, a Disagree-and-Commit moment and a Deliver Results ending. You choose which **slice** to tell for the LP being asked. About Amazon's own advice is to prepare **8–9 strong examples** mapped to the LPs. Aiming for 2 per LP pushes you to 10–12.

**Mapping table: how 6 stories cover all 16 LPs**

| Story (a backend engineer's world) | Primary LPs | Secondary LPs |
|---|---|---|
| Postgres to Aurora migration with dual writes | Deliver Results, Dive Deep | Ownership, Insist on the Highest Standards |
| Sev-1 payment outage you caused and fixed | Earn Trust, Ownership | Bias for Action, Insist on the Highest Standards |
| API design dispute with a principal engineer | Have Backbone; Disagree and Commit | Are Right, A Lot, Earn Trust |
| Notification platform cost cut (₹14L to ₹6L/month) | Frugality, Invent and Simplify | Think Big, Customer Obsession |
| Saying no to a client team's API request | Customer Obsession | Are Right, A Lot, Invent and Simplify |
| On-call health + mentoring two SDE-1s | Earth's Best Employer, Hire and Develop the Best | Learn and Be Curious, Broad Responsibility |

**Rules for using the bank in a loop:**
1. **One story per round, and never the same story twice in a loop.** Interviewers compare notes in the debrief, and a repeated story counts as one data point, not two.
2. **Lead with the slice that fits the LP.** For Dive Deep, start at the anomaly. For Earn Trust, start at your mistake.
3. **Have a second story for every LP**, because the interviewer may say "Can you give me another example?".

**Sounding real, not rehearsed:**
- Store **bullets, not scripts**: headline, 3 actions, 2 numbers, 1 mistake, 1 thing you'd change.
- Practise **out loud** with a friend who interrupts with "why?" every 30 seconds. Record yourself and listen once.
- Keep the **messy parts**: what you got wrong, who pushed back. Polished stories with no friction sound invented.
- When you don't remember a number, say "about 40%, I'd have to check". Never make one up. BRs probe numbers.

**Other companies that run LP-style rounds:** Uber runs a dedicated bar-raiser interview. Flipkart and Meesho report bar-raiser or hiring-manager rounds focused on ownership and bias for action. Coinbase grades behavioural rounds against its own principles. The same story bank works there: just re-map the stories to each company's values.`,
      code: [
        {
          language: 'text',
          title: 'Story-bank card (one per story), kept as bullets',
          code: `STORY: Orders DB migration (Postgres 11 -> Aurora PG 15), 2025
HEADLINE: Led a zero-downtime migration of 1.2 TB / 9K TPS for 4 teams
MY ACTIONS (I):
  1. Wrote the RFC and won approval for CDC + dual reads over big-bang
  2. Built the row-level checksum verifier (found 0.003% drift)
  3. Ran 3 rehearsals, then the 11-minute cutover at 3 a.m. IST
NUMBERS: p99 140 -> 60 ms; cost -22%; 0 customer-visible errors
FRICTION: payments lead wanted a 2-hr maintenance window; I disagreed
MISTAKE: underestimated sequence resets -> 4 min of failed inserts in
         rehearsal 2; added a pre-cutover sequence sync step
WOULD CHANGE: involve the analytics team earlier (their ETL broke)
LP SLICES: Deliver Results | Dive Deep (drift) | Backbone (window)
           | Insist on Highest Standards (verifier) | Ownership
LEVEL: SDE-2+ (4 teams); SDE-3 framing = migration playbook reused 3x`,
        },
      ],
      keyPoints: [
        '10–12 rich stories x 2–3 LP slices each = 2 stories per LP.',
        'Never repeat a story within one loop. Debrief compares notes.',
        'Bullets, not scripts. Keep the friction and the mistake, because they make it credible.',
      ],
      source: 'About Amazon: interview tips (8–9 examples mapped to LPs); Uber/Flipkart/Coinbase/Meesho interview guides',
    },
  ],
  codeChallenges: [
    {
      id: 'beh-amazon-lp-cc-1',
      title: 'Answer Lab: the "we fixed the latency" Dive Deep answer',
      context:
        'Round 3 (HLD + LP) of an Amazon SDE-2 loop. The interviewer is assigned Dive Deep and Ownership and asks: "Tell me about a time you had to dig into a problem to find its root cause." The candidate gives the answer below and the interviewer writes "insufficient data" in their notes.',
      task: 'Rewrite this answer so it scores "strong" on Dive Deep and Ownership at SDE-2. Keep it to about 2–3 minutes spoken. Identify every missing signal before you rewrite.',
      starter: {
        language: 'text',
        title: 'Weak answer (real-sounding, scores "not enough evidence")',
        code: `So in my last company we had a lot of latency issues in our order
service. Customers were complaining and the dashboards were red. We
got together as a team and looked at it, and we figured out it was a
database problem, some queries were slow. So we added some indexes and
also added Redis caching, and after that the latency improved a lot.
The business was really happy. I learned that performance is really
important and that we should always monitor our systems. I think it
shows I can dive deep into problems.`,
      },
      hints: [
        'Count the "we"s and "I"s, then list what the candidate personally did. Could the interviewer write one sentence starting "The candidate…"?',
        'Where are the numbers: the before and after latency, the scale, the time taken? Which query, which index, and why?',
        'Dive Deep is about going below the dashboard. What hypothesis did they rule out, and how did they prove the root cause? Also check whether adding a cache was a fix or a mask.',
      ],
      solution: {
        language: 'text',
        title: 'Strong rewrite (Dive Deep + Ownership, SDE-2)',
        code: `S: Last March our order-history API (NestJS on Postgres, ~2K RPS) went
   from 120 ms to 2.4 s p99 over three days, with no deploy in between.
   Support logged 60 tickets from sellers whose dashboards timed out.
T: I was the on-call engineer and the owner of that service, so finding
   the root cause, not just stopping the pages, was mine.
A: - I first ruled out the usual suspects: no deploy, CPU at 35%, pool
     not saturated. That told me it wasn't capacity.
   - pg_stat_statements showed one query, "orders by seller, last 90
     days", went from 3% to 64% of DB time. EXPLAIN ANALYZE showed a
     seq scan on 85M rows where we used to get an index scan.
   - Why the change? Autovacuum had stalled on that table behind a
     long-running analytics transaction (open for 3 days). Stats were
     stale, so the planner flipped plans after a bulk import.
   - Immediate fix: I ran ANALYZE, killed the stuck transaction with the
     analytics owner on the call, and p99 dropped to 150 ms in minutes.
   - Lasting fix (Ownership): I added a composite index (seller_id,
     created_at), set idle_in_transaction_session_timeout = 10 min for
     the analytics role, and added an alert on table stats age.
     I deliberately did NOT add Redis: it would have hidden the plan
     flip, not fixed it.
R: p99 settled at 95 ms (better than before the incident), seller
   tickets went to zero, and the stats-age alert has caught 2 similar
   cases since, both fixed before customers noticed.
L: I now check planner stats and long transactions in the first
   10 minutes of any "slow with no deploy" incident. I added that step
   to our runbook.`,
      },
      explanation: `**What changed and why it scores:**
- **"We" became "I".** Every action has an owner, so the interviewer can write "candidate diagnosed…", "candidate killed…", "candidate added…".
- **Numbers at every layer:** traffic (2K RPS), symptom (120 ms to 2.4 s), evidence (3% to 64% of DB time, 85M rows), result (95 ms, zero tickets, 2 later catches).
- **A real Dive Deep chain:** symptom, then ruling out capacity, then the guilty query, then the plan flip, then *why* the plan flipped (stalled autovacuum and stale stats). This is four levels below the dashboard, which is exactly where follow-ups go.
- **Judgment about the fix:** the weak answer's "added Redis" masks the cause. The rewrite explicitly rejects caching and says why. That also earns Are Right, A Lot.
- **Ownership = a lasting mechanism:** a session timeout, a stats-age alert and a runbook step, so the problem "stays fixed".
- **The learning is specific and changed behaviour.** "Performance is important" is a platitude.
- Dropped the self-grading line ("shows I can dive deep"). Let the evidence speak.`,
      followUps: [
        {
          q: 'You killed another team\'s analytics transaction during the incident. Did you have the authority, and what did that team say afterwards?',
          a: 'A strong answer shows Earn Trust inside Bias for Action: "I didn\'t kill it alone. I paged their on-call, showed the 3-day transaction and the lock graph, and they agreed on the call. Afterwards I wrote the incident review with them as co-authors and proposed the session timeout for their role, not ours. They asked for a read replica for long reports, and we set one up within two sprints." If you acted without them, say so and own it. The probe is checking whether speed came at the cost of trust.',
        },
        {
          q: 'How do you know the stale statistics were the root cause and not just correlated with the bulk import?',
          a: 'This is the Dive Deep proof probe. Good evidence: "I captured EXPLAIN ANALYZE before and after ANALYZE on the same query and parameters. The only change was the plan, which went from a seq scan back to an index scan, and latency dropped right away with no other change. I also checked pg_stat_user_tables: last_autoanalyze was 3 days old, matching the transaction start. Two later stats-age alerts reproduced the same pattern." Correlation plus a controlled before/after on one variable is what convinces a Bar Raiser.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-cc-2',
      title: 'Answer Lab: the Disagree and Commit answer with no commit',
      context:
        'Bar Raiser round, Amazon SDE-3 loop. Prompt: "Tell me about a time you strongly disagreed with your manager or a senior leader." The Bar Raiser\'s notes say "Backbone: yes. Commit: concerning. Level: SDE-2 scope."',
      task: 'Rewrite the answer so it shows both halves of Have Backbone; Disagree and Commit, at SDE-3 scope (multi-team, a mechanism, influence without authority). Fix the tone problems as well.',
      starter: {
        language: 'text',
        title: 'Weak answer (backbone without commit, SDE-2 scope)',
        code: `My manager wanted us to move from REST to GraphQL federation for all
our services, which I thought was a bad idea because it adds a lot of
complexity and our team didn't know it. I told him in the meeting that
it was over-engineering. He didn't listen and went ahead anyway. I
did my part of the work but honestly I kept saying it was a mistake,
and later we did have performance problems with N+1 queries in the
gateway, which proved my point. Eventually he agreed with me that we
should have been more careful. I think it shows I have backbone and
I'm not afraid to speak up.`,
      },
      hints: [
        'The "Disagree" half has no data: what evidence did the candidate bring, and to whom, and how? A public "it\'s over-engineering" is an opinion, not backbone.',
        'The "Commit" half fails: "kept saying it was a mistake" and "proved my point" are exactly what the BR is checking for. What would full commitment have looked like?',
        'For SDE-3: was it really only the manager? Who else (other teams, the platform group) was affected, and what mechanism could the candidate have built to reduce the risk they feared?',
      ],
      solution: {
        language: 'text',
        title: 'Strong rewrite (both halves, SDE-3 scope)',
        code: `S: In 2025 our director proposed moving 14 REST services owned by 5
   teams behind an Apollo Federation gateway in one quarter, so the
   new mobile app could make single-round-trip calls.
T: I was the senior engineer on the checkout domain. I agreed with the
   goal but believed a one-quarter big-bang risked checkout latency
   during the sale season, and I owed him that view with evidence.
A: Disagree:
   - I prototyped federation over 3 checkout services in a week. The
     naive version made 41 downstream calls for one cart query, and
     p99 went from 180 to 900 ms.
   - I met him 1:1 first with a 2-page memo: I supported the goal, here
     is the data, and here is an alternative (federate read-only
     catalog/profile first, checkout after the sale, with batching
     mandatory).
   - He kept the one-quarter target for non-checkout services and
     accepted my sequencing for checkout. Not everything I asked for.
   Commit:
   - I volunteered to own the risk I'd raised: I wrote the DataLoader
     + query-cost guidelines and a CI check that fails a subgraph with
     an unbatched list resolver, used by all 5 teams.
   - I ran 3 brown-bag sessions and reviewed the first subgraph of each
     team. In public I presented it as our plan, not "his plan".
R: 11 of 14 services were federated that quarter. Checkout followed
   in 6 weeks after the sale, with gateway p99 at 210 ms. The CI check
   blocked 9 N+1 resolvers before production. The mobile team cut
   app-start API calls from 7 to 1.
L: My first message in the planning meeting ("this is over-engineered")
   was wrong in tone. It made people defensive. Now I bring data 1:1
   before any public disagreement.`,
      },
      explanation: `**What changed and why it scores:**
- **Backbone with data, not adjectives:** a one-week prototype, 41 downstream calls, and p99 from 180 to 900 ms replace "it's over-engineering".
- **The right channel:** 1:1 first with a memo, then the public forum. This also shows Earn Trust.
- **A real outcome of disagreement:** a partial win with the director's goal intact. That is more credible than "eventually he agreed with me".
- **Commit is visible and active:** the candidate owned the very risk they warned about, through guidelines, a CI mechanism, brown-bags and reviews, and backed the plan publicly. The weak answer's "kept saying it was a mistake" is the opposite of commit and a common no-hire signal.
- **SDE-3 scope:** 14 services, 5 teams, a cross-team mechanism, and influence without authority.
- **Self-critical learning:** the candidate names their own tone mistake instead of claiming "I proved my point".
- Removed the self-grading closing line and any blame of the manager.`,
      followUps: [
        {
          q: 'What if the director had rejected your sequencing completely and kept checkout in the big-bang? What would you have done?',
          a: 'The BR is testing whether commitment depends on winning. A strong answer: "I would commit fully and reduce the risk inside his plan. That means checkout migrates first, not last, so we find problems early; a shadow-traffic comparison at 100% for 2 weeks; a per-service fallback flag to REST; and a written sign-off on the risk. I wouldn\'t escalate over his head unless the risk was a one-way door, such as data loss or a compliance breach. A latency risk with a rollback isn\'t one."',
        },
        {
          q: 'Looking back, was the director right to push for federation at all?',
          a: 'This probes Are Right, A Lot. The candidate must be able to say where the other side was right: "Yes, on the goal. Mobile went from 7 calls to 1, which my sequencing alone wouldn\'t have delivered that quarter. I was right about checkout timing and the batching risk. If I were deciding again, I\'d still federate, but I\'d make the CI batching check a day-one requirement instead of one I built after objecting." Admitting the other side was partly right is a strong signal. "I was right all along" is a red flag.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'beh-amazon-lp-iq-01',
      difficulty: 'hard',
      question:
        'Customer Obsession: tell me about a time an internal client team asked your service for something and you decided not to build what they asked for.',
      context:
        'Reported in Amazon SDE-2 India loops (2025) as a "saying no to a customer" prompt. The interviewer is assigned Customer Obsession and Are Right, A Lot.',
      whatInterviewerLooksFor: [
        'Identifies a concrete customer and their underlying need, not just the request',
        'Uses evidence (traces, usage data, a conversation) to separate the need from the ask',
        'Offers an alternative that serves the need, rather than a flat refusal',
        'Measures the customer outcome afterwards',
      ],
      modelAnswer: `**Approach:** the customer is the client team and, behind them, their end users. Show that you **worked backwards** from what they were trying to achieve, said "no" to the *solution* and "yes" to the *need*, and then proved it with their metric.

**Example STAR (adapt, don't recite):**
- **S:** The seller-analytics team asked my Orders service (Postgres, ~3K RPS) for a "give me all orders" bulk endpoint with no pagination, to power a new seller dashboard.
- **T:** I owned the Orders API and its SLO (p99 < 250 ms). A 200K-row response per large seller would have blown the SLO for every caller.
- **A:** I asked for their dashboard mock and found they only showed **daily aggregates for 30 days**. I checked our logs: 70% of their planned calls would come from the top 2% of sellers. I proposed two things: (1) publish order events to a Kafka topic that they could aggregate into their own store, and (2) a paginated, cursor-based endpoint for drill-downs. I wrote the Avro schema with them in one session and shipped the event stream in 2 sprints.
- **R:** Their dashboard loaded in 600 ms instead of the 8–12 s the prototype took. Our p99 stayed at 180 ms through the sale. Two more teams later consumed the same topic, which removed 3 planned bulk APIs.
- **L:** I now ask "what will you render or compute with this?" before reviewing any API request.

**Why this scores:** customer named, need discovered with data, alternative delivered, both customers' metrics (theirs and our other callers') protected.`,
      followUps: [
        {
          q: 'The analytics team\'s manager escalated to yours, saying you were blocking them. What happened?',
          a: 'Show Earn Trust and Backbone. "I sent both managers a half-page note: their goal, the SLO risk with numbers (a 200K-row response is about 60 MB and would put roughly 8 s of DB time on the shared replica), and a delivery date for the alternative that was earlier than their bulk-API estimate. My manager backed me after reading it, and their manager agreed because the date was better." Escalation is resolved with data and a date, not by authority.',
        },
        {
          q: 'How did you know the event stream was what they needed, and not just what was convenient for you?',
          a: 'The interviewer is checking that you didn\'t confuse your own convenience with the customer\'s need. Point to their artefacts: the mock showed daily aggregates only, and their stated freshness need was "hourly is fine", so a stream into their store matched it. Also give a disconfirming check: "I asked whether any screen needed live per-order data. One drill-down did, which is why I added the paginated endpoint too." Changing the plan when you learned something new is the signal.',
        },
        {
          q: 'Would your answer change if the requester were an external enterprise customer paying for the API?',
          a: 'Partly. Working backwards still applies, but the cost of saying no is higher and contracts matter. "I\'d involve the product manager and the account owner, offer the async export as a first-class feature with an SLA, and if they truly needed bulk sync, price and rate-limit it separately on an isolated read path, so one customer can\'t degrade others." Customer Obsession isn\'t "yes to everything". It means protecting all customers.',
        },
      ],
      pitfalls: [
        'Making the manager or PM the "customer".',
        'A flat "no, it was a bad idea" with no alternative and no outcome for the requester.',
        'Not measuring the customer outcome afterwards. "They were happy" is not a metric.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-02',
      difficulty: 'expert',
      question:
        'Earn Trust: describe a production incident that you personally caused. Walk me through the first hour, and then what you said in the postmortem.',
      context: 'A Bar Raiser drilling into vocal self-criticism. Expect "and a more recent one?" if the story is old.',
      whatInterviewerLooksFor: [
        'Clear personal ownership of the cause, with no passive voice ("a config was changed")',
        'Calm, transparent incident handling, with communication before perfection',
        'A blameless but self-critical postmortem with mechanism-level fixes',
        'Recency (last 1–2 years) and evidence that the behaviour changed',
      ],
      modelAnswer: `**Approach:** pick a real incident where **you** made the change. Structure it as: detection, your own disclosure, mitigation, communication, postmortem, mechanism. Earn Trust is scored on how quickly and openly you said "this was me".

**Example STAR (adapt, don't recite):**
- **S:** In 2025 I shipped a refactor of our payment-callback handler (NestJS, ~800 callbacks/min from the payment gateway). It accidentally changed the idempotency key from the gateway's txn_id to our internal order_id.
- **T:** At 7:40 p.m. on-call saw duplicate "payment success" events. I was the author.
- **A (first hour):** Within 5 minutes I posted in the incident channel: "Likely my deploy at 6:55, investigating the idempotency path." I rolled back by 7:52 instead of debugging forward. I wrote a query listing 312 orders with duplicate settlement events and paired with finance ops to hold refunds on them. I updated the status page with customer support every 15 minutes.
- **A (postmortem):** I wrote it myself and opened with "the root cause was my change, and our review didn't catch it because there was no test on key composition". The fixes were a contract test on the idempotency key, a canary that compares duplicate-event rates (fail if over 0.1%), and a checklist item for payment-path PRs.
- **R:** No customer was double-charged, and finance reconciled all 312 in 2 days. The canary has since blocked 2 bad deploys. My tech lead later asked me to present the postmortem at the org reliability review.
- **L:** Disclose first, diagnose second. Saying "it's probably mine" in minute 5 saved 20 minutes of people chasing other theories.`,
      followUps: [
        {
          q: 'Why did you roll back instead of shipping a quick fix forward, when you already knew the bug?',
          a: 'This tests judgment under pressure. "Rollback was a known-good, two-way door taking under 5 minutes. A forward fix meant new code in the payment path, written at 7:45 p.m. with adrenaline, and the risk of a second bug. The duplicate rate was rising every minute, so the fastest safe state mattered more than the elegant fix. I shipped the proper fix the next day with the contract test."',
        },
        {
          q: 'What did your manager say to you after the incident?',
          a: 'An honest answer that shows self-awareness scores well. For example: "She said the response was right but asked why a payment-path change went out at 6:55 p.m. before the evening peak. That was fair, and I proposed a deploy-window rule for payment services that the team adopted." Avoid "she said I did great". The probe checks whether you invite and accept critique.',
        },
        {
          q: 'Tell me about a failure from the last six months instead.',
          a: 'Bar Raisers ask this to get past polished stories. Keep a smaller, recent, real failure ready, such as a wrong estimate, a design you had to reverse, or feedback you got. Tell it with the same structure: what happened, your part, the impact, what you changed. Saying "I can\'t think of one" or offering a humble-brag ("I work too hard") is a strong negative signal.',
        },
      ],
      pitfalls: [
        'Passive voice and shared blame: "a bad config got deployed".',
        'Choosing an incident someone else caused and casting yourself as the rescuer.',
        'A postmortem that ends with "be more careful" and no mechanism.',
        'A story more than 3–4 years old with nothing recent to back it up.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-03',
      difficulty: 'hard',
      question:
        'Ownership: tell me about a problem in a system your team did not own that you fixed anyway. How did you decide it was yours to fix?',
      context: 'Reported in Amazon SDE-2 India loops (2025) as "going beyond your responsibilities".',
      whatInterviewerLooksFor: [
        'The problem had real customer or business impact, not just annoyance',
        'Clear reasoning about why you stepped in: the owner was missing, overloaded or unaware',
        'Coordination with the rightful owner, so there was no unilateral change',
        'A long-term fix and a clean handover, not ongoing heroics',
      ],
      modelAnswer: `**Approach:** the interviewer wants to hear **"that's not my job" turned down**, done with respect for the real owner. Explain the decision rule you used. Example: "impact on my customers + no active owner + I had the skills + I told the owner first."

**Example STAR (adapt, don't recite):**
- **S:** Our checkout service depended on a shared feature-flag service owned by a platform team that had shrunk from 5 engineers to 1. Its SDK cached flags for 10 minutes with no push invalidation. During a payment-gateway outage it took 10 minutes to turn off the broken gateway via a flag.
- **T:** I was an SDE-2 on checkout. The flag service wasn't mine, but its 10-minute delay cost us about ₹18 lakh in failed orders in one incident.
- **A:** I messaged the remaining platform engineer with the incident data and offered to build the fix under her review. I designed a Redis pub/sub invalidation channel with a 30-second TTL as a fallback, wrote it in their repo following their conventions, and added load tests at 5K subscribers. I rolled it out to 3 consumer services first, then wrote the migration guide and ran office hours for the other 9.
- **R:** The time for a flag to take effect dropped from up to 10 minutes to under 2 seconds at p99. In the next gateway outage we switched over in 40 seconds. The platform team took over ownership when they re-staffed, and I'm still listed as a reviewer.
- **L:** I took over 3 sprints, part of it on my own time. In hindsight I should have asked my manager to formally trade one sprint of roadmap, which she later said she would have approved.`,
      followUps: [
        {
          q: 'What did you deprioritise to do this, and did your own team\'s work suffer?',
          a: 'Ownership includes owning the trade-off. "I slipped one roadmap item, a coupon refactor, by a sprint and told my manager and PM in week one with the incident cost as justification. The rest I did by pairing reviews with my sprint work. If I hadn\'t been able to protect my commitments, I\'d have escalated for the platform team to be staffed rather than silently taking it on." Silent overtime is not the signal.',
        },
        {
          q: 'What would you have done if the platform engineer had said no, that they didn\'t want outside changes?',
          a: 'Respect the owner and still solve the customer problem. "I\'d ask what would make it acceptable: a design review, a test bar, them owning the merge. If it was still no, I\'d mitigate on our side, for example a local override flag in checkout with a 30-second refresh, and raise the systemic risk to both managers with the incident cost, so it got prioritised properly." Going around the owner is a trust failure.',
        },
      ],
      pitfalls: [
        'A story where the work was actually assigned to you.',
        'Changing another team\'s system without telling them.',
        'No handover, so you became a permanent single point of failure.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-04',
      difficulty: 'hard',
      question:
        'Bias for Action: during an incident you had to make a call with incomplete information. What did you know, what didn\'t you know, and how did you limit the downside?',
      whatInterviewerLooksFor: [
        'Explicitly distinguishes reversible from irreversible actions (two-way vs one-way door)',
        'Acts in minutes, not hours, on the reversible path',
        'States the risk and the rollback before acting',
        'Follows up with proper analysis after the fire is out',
      ],
      modelAnswer: `**Approach:** say the uncertainty out loud, classify the decision as a two-way or one-way door, act on the reversible option, and show how you **capped the blast radius**. The calculated part of "calculated risk" is what gets scored.

**Example STAR (adapt, don't recite):**
- **S:** On a Saturday sale, our inventory-reservation service (Node + Redis Cluster, ~12K RPS) started timing out. Redis CPU on one shard was at 100%. We did not know if it was a hot key, a bad deploy by another team, or a Redis bug.
- **T:** I was incident commander. Orders were failing at about 18%, roughly ₹40K of GMV per minute.
- **A:** I listed options in the channel with a time box of 5 minutes each. **(1)** Roll back the morning deploy: reversible, low risk, done first, but no improvement. **(2)** Enable the read-from-local-cache flag for product stock reads (a two-way door, already tested in staging, with a staleness risk of up to 5 s on stock counts). I stated the risk ("we may oversell by a few units; finance accepts up to 0.1%") and enabled it for 10% of traffic, then 100% after 3 minutes of clean metrics. **(3)** I explicitly did **not** reshard live, because moving slots under load is closer to a one-way door.
- **R:** Errors fell from 18% to 0.4% in 9 minutes. We oversold 11 units, which were refunded with a voucher. The root cause, found the next day, was a single flash-deal SKU key at 70K reads/s. We added hot-key detection and key-splitting.
- **L:** Our flag existed but wasn't in the runbook, and that cost us 6 minutes. I added a "known levers" section to every Sev-2 runbook.`,
      followUps: [
        {
          q: 'Who did you check with before accepting the oversell risk? Was that your call to make?',
          a: 'A strong answer shows calculated, not reckless, risk. "I pinged the business on-call with the trade-off in one line: about 0.1% oversell vs 18% failed orders. She approved in 2 minutes. If no one had answered, I\'d still have acted, because the oversell was bounded and refundable, and I\'d have documented the decision in the channel with a timestamp." Saying who owns the risk shows judgment.',
        },
        {
          q: 'What decision in that incident would you NOT have made quickly, and why?',
          a: 'This checks that you understand where Bias for Action stops. "Live resharding, or flushing the cluster to clear the hot key. Both are hard to reverse under load and could have turned an 18% outage into a 100% one or lost reservations. Anything that drops data, migrates state or is visible to every customer gets a second pair of eyes, even in an incident."',
        },
      ],
      pitfalls: [
        'Describing speed with no risk analysis, such as "I just restarted everything".',
        'Analysis paralysis framed as caution: waiting 40 minutes for root cause before mitigating.',
        'Not knowing the business cost per minute of the incident.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-05',
      difficulty: 'expert',
      question:
        'Dive Deep: tell me about a time your dashboards said everything was healthy but users said otherwise. How did you find the truth?',
      context: 'Maps to the official phrase "skeptical when metrics and anecdote differ". The Bar Raiser will ask technical "why?" questions until the story runs out of depth.',
      whatInterviewerLooksFor: [
        'Treats the anecdote as a signal and questions how the metric was built',
        'A technically precise diagnosis chain (sampling, aggregation, survivorship, percentiles)',
        'Evidence that proved the hypothesis',
        'Fixes the measurement as well as the bug',
      ],
      modelAnswer: `**Approach:** the strongest Dive Deep stories find a flaw in **the measurement itself**. Explain why the metric lied, prove it, fix the bug, and fix the metric so it can't lie that way again.

**Example STAR (adapt, don't recite):**
- **S:** Our search API dashboard showed p99 at 220 ms and a 99.95% success rate. Meanwhile the app-store rating had dropped from 4.4 to 4.1, with reviews saying "search spins forever" in Tier-2 cities.
- **T:** I owned search-api latency SLOs. The metric and the anecdote disagreed, so one of them was wrong.
- **A:** I listed how the metric was produced: server-side histograms, measured **after** the load balancer and **only for completed requests**. Requests the client abandoned or that the load balancer timed out at 30 s were never recorded. I asked the mobile team for client RUM data: client-side p95 was 4.8 s on Jio/Airtel 4G in 3 states. Then I correlated by POP: one CDN edge region routed search to us-east instead of ap-south-1 because of a stale geo-DNS rule, adding about 250 ms RTT per round trip, times 9 round trips (no HTTP keep-alive on that path).
- **R:** After fixing the routing and enabling keep-alive, client p95 in those states dropped from 4.8 s to 1.1 s and "search slow" reviews fell by 80% in a month. I added client-side p95 by region as the primary SLO and LB-timeout counts to the dashboard.
- **L:** A server-side p99 only measures requests that reach the server and finish. I now ask "what doesn't this metric see?" for every new SLO.`,
      followUps: [
        {
          q: 'Why did the server-side p99 stay at 220 ms if users were waiting almost 5 seconds?',
          a: 'This is a depth check, so answer mechanically. The latency was in the network path before our server (an extra cross-region RTT times 9 sequential round trips without keep-alive, about 2.2 s, plus TLS handshakes). Server processing per request really was about 200 ms. Requests that the client abandoned were never completed, so they never entered the histogram, which is a survivorship bias. Server metrics were accurate about the server and silent about the user.',
        },
        {
          q: 'How did you convince the mobile team to share RUM data and prioritise keep-alive on their side?',
          a: 'Influence probe. "I came with their own pain: the review-rating drop and a list of 40 review quotes mapped to the 3 states. I asked for read access to their RUM dashboard, not engineering time. The keep-alive change was a one-line OkHttp config that I offered to review and test in their beta channel. Sharing the win, where their app rating recovered, made the next ask easier."',
        },
        {
          q: 'If you could only add one metric to prevent this class of problem, which would it be?',
          a: 'Client-observed latency by region and network from RUM, with p95/p99, alongside server-side latency, and an alert when the two diverge by more than about 3x. Server metrics alone can\'t see network paths, DNS or abandoned requests. If RUM isn\'t available, the next best is load balancer or edge timeout and 499 (client-closed) counts per region, which show users who gave up.',
        },
      ],
      pitfalls: [
        'Stopping at "I checked the dashboards and escalated to the network team".',
        'Vague causes like "it was a network issue" with no mechanism.',
        'Fixing the bug but leaving the misleading metric as the main SLO.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-06',
      difficulty: 'hard',
      question:
        'Deliver Results: tell me about a hard deadline where something went badly wrong halfway through. What did you cut, and who did you tell?',
      context: 'Reported in Amazon SDE-2 India loops (2025) as a "managing tight deadlines" prompt.',
      whatInterviewerLooksFor: [
        'A real, external deadline and a real setback',
        'An explicit trade-off decision (scope, quality bar, sequencing) made early, not at the last minute',
        'Stakeholder communication before the miss, not after',
        'A delivered outcome with numbers, and honesty about what was not delivered',
      ],
      modelAnswer: `**Approach:** Deliver Results is about **inputs and trade-offs under pressure**, not just "we shipped on time". Show the setback, the decision you made, who agreed, and what you delivered.

**Example STAR (adapt, don't recite):**
- **S:** RBI's card tokenisation mandate had a fixed compliance date. We had 10 weeks to replace stored card numbers with network tokens across 3 services (checkout, subscriptions, refunds), about 9M saved cards.
- **T:** I led the backend work with 2 SDE-1s and owned the migration plan.
- **A:** In week 5 the card network's sandbox had a token-provisioning bug: 4% of test cards failed with no fix date. I did three things in 48 hours. **(1)** I split scope: checkout and subscriptions were compliance-critical, while refunds on old transactions could use the network's token-lookup API later. **(2)** I built a retry-and-quarantine queue so failed provisioning didn't block a user, who would just re-enter the card. **(3)** I wrote a one-page update to my manager, the PM and the compliance lead with the risk, the cut and the new date for refunds, and got sign-off the same day.
- **R:** Checkout and subscriptions went live 6 days before the deadline. 99.2% of cards were tokenised in the first run, and the quarantine queue cleared the rest in 3 weeks. Refunds followed 4 weeks after the date, which was compliant because no raw card data was stored. Checkout conversion dipped 0.3% for 2 weeks (users re-entering cards) and then recovered.
- **L:** I'd now run a third-party sandbox spike in week 1. The bug was there from the start.`,
      followUps: [
        {
          q: 'Why not ask for more engineers when the setback hit?',
          a: 'This tests judgment. "Brooks\'s law: new engineers in week 5 of a compliance-critical payments change would have cost more in onboarding and review than they added. The bottleneck was the network\'s sandbox, not our hands. I did ask for one thing: a dedicated QA engineer for the final 2 weeks, because test coverage of edge cards was the real risk."',
        },
        {
          q: 'The 0.3% conversion dip: did you consider that a failure, and who knew about it?',
          a: 'Insist-on-Standards probe. "It was a known, accepted cost. I forecast it at about 0.5% in the sign-off note, and I watched it daily on a shared dashboard with the PM. It wasn\'t a surprise to anyone. If it had crossed 1%, our pre-agreed action was to add a one-tap card re-save prompt, which was ready behind a flag." Predicting your side-effects is part of delivering results.',
        },
      ],
      pitfalls: [
        'A deadline story with no setback.',
        'Hitting the date by working 80-hour weeks and calling that the result.',
        'Informing stakeholders only after the deadline was missed.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-07',
      difficulty: 'expert',
      question:
        'Have Backbone: tell me about a time you challenged a technical decision made by someone more senior than you, where staying quiet would have been easier.',
      context: 'SDE-3 loop. The interviewer will press on whether you escalated, how you disagreed, and what happened to the relationship.',
      whatInterviewerLooksFor: [
        'The disagreement mattered, with customer or operational stakes',
        'Data-backed challenge, delivered through the right channel and respectfully',
        'Seeks to understand the other side and acknowledges their valid points',
        'Clear resolution and commitment, with the relationship intact or improved',
      ],
      modelAnswer: `**Approach:** pick a disagreement where the stakes were real and the **power gap** made it uncomfortable. Show your preparation (data and alternatives), the channel you used, the result, and your commitment. Don't pick a story where you simply won.

**Example STAR (adapt, don't recite):**
- **S:** A principal engineer proposed that all 20 services in our org standardise on synchronous gRPC calls for order processing, replacing our SQS-based async flow, to "simplify debugging".
- **T:** I was a senior SDE leading the fulfilment service. I believed it would chain availability across 6 hops (0.999 to the 6th power is about 99.4%) and lose buffering for sale-day spikes.
- **A:** I spent a week gathering data: 14 months of incidents showed the async queue had absorbed 3 downstream outages that would otherwise have failed orders. I modelled peak: 9x normal traffic for 20 minutes, and synchronous calls would need 9x capacity provisioned in 6 services. I asked him for 30 minutes 1:1 and opened with what I agreed with: debugging was genuinely painful. I proposed keeping async for the order pipeline, adding end-to-end tracing with OpenTelemetry context propagated through SQS message attributes, and using gRPC for the read paths.
- **R:** He accepted async for the pipeline and asked me to own the tracing work. With trace propagation, mean time to diagnose order issues dropped from 45 to 12 minutes. gRPC was adopted for 9 read services. He later asked me to co-review the org's integration guidelines.
- **L:** Opening with his valid point changed the whole conversation. I've used that structure in every disagreement since.`,
      followUps: [
        {
          q: 'Suppose he had overruled you. Would you have escalated to his manager?',
          a: 'Escalation is a tool, not a reflex. "Only if it were a one-way door with serious customer risk and I believed he lacked information. Even then I\'d tell him first: \'I\'d like to bring this to the architecture review for a second opinion, are you OK with that?\' For a reversible, bounded-risk decision like this, I\'d disagree, write down my concerns with numbers, and then commit fully, including helping to make gRPC succeed."',
        },
        {
          q: 'What was his strongest argument, and were you wrong about anything?',
          a: 'This tests Are Right, A Lot: can you steel-man the other side? "His strongest point was that async flows had no owner for end-to-end latency, so incidents bounced between teams. He was right. My original framing, that async was simply better, ignored the operational cost. The tracing work was really me conceding that point. I was also wrong that gRPC would hurt read paths: latency on those improved by about 30%."',
        },
        {
          q: 'How did the relationship look six months later?',
          a: 'Healthy backbone strengthens trust. Give observable evidence: "He asked me to co-review the integration guidelines and later nominated me to the architecture review rota." If the relationship cooled, be honest and say what you did to repair it. Interviewers distrust stories where conflict leaves no trace.',
        },
      ],
      pitfalls: [
        'Disagreement by opinion: "I told him it was a bad idea".',
        'Escalating first and talking to the person second.',
        'Hero framing: "I was right and he eventually admitted it."',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-08',
      difficulty: 'hard',
      question:
        'Are Right, A Lot: tell me about a technical judgment call you got wrong. How did you discover it, and what do you now do differently when deciding?',
      whatInterviewerLooksFor: [
        'A genuine wrong call with real consequences, not a humble-brag',
        'How the decision was originally made (process), not just the outcome',
        'Fast recognition and correction, ideally driven by data the candidate looked for',
        'A durable change to their decision-making process',
      ],
      modelAnswer: `**Approach:** "Are Right, A Lot" is about **judgment quality**, and the best evidence is how you **update when wrong**. Explain your original reasoning (so it was a reasonable call), what disconfirmed it, how quickly you reversed, and the process change.

**Example STAR (adapt, don't recite):**
- **S:** In 2024 I chose MongoDB for a new seller-catalogue service. My reasoning was flexible attributes per category (1,800 categories) and an expected 10x write growth.
- **T:** As the tech lead, I owned the choice.
- **A (the miss):** I tested writes but not the **cross-entity queries** that sellers actually ran: "all SKUs under brand X with stock < 10 across warehouses". By month 4, three aggregation pipelines took 2–6 s and needed hand-tuned indexes for every new filter. Write growth turned out to be 2x, not 10x.
- **A (correction):** I didn't defend the choice. I ran a 2-week spike: Postgres with JSONB for flexible attributes plus relational columns for the 12 fields that were actually filtered on. The same queries took 40–120 ms. I presented the comparison, including my original mistake, to my manager and the team, and proposed a migration behind a CDC-fed dual read, which took 7 weeks.
- **R:** p95 for seller search went from 3.1 s to 140 ms. Storage cost dropped 35%. We retired a 3-node cluster that only one engineer knew how to operate.
- **L:** I now write a **"what would prove me wrong"** list in every design doc, with the top 5 real queries prototyped against the candidate store, not just synthetic writes. I also ask a peer to argue for the alternative before I decide.`,
      followUps: [
        {
          q: 'What signal did you ignore early on that, in hindsight, was telling you it was wrong?',
          a: 'Strong candidates can name it. "In month 2 an SDE-1 asked why we needed $lookup for a basic listing page. I treated it as a learning gap, but it was the first sign that our access patterns were relational. Today I treat repeated workarounds as data about the design, not about the people writing them." This shows real reflection rather than a scripted lesson.',
        },
        {
          q: 'How did you justify a 7-week migration to your manager after you had picked the database?',
          a: 'Owning the cost of your mistake is part of Earn Trust. "I quantified the cost of staying: about 1 engineer-week per month on index tuning, seller-search tickets, and the on-call risk of a store only one person could operate. That roughly matched the migration cost within 2 quarters. I also proposed doing it in slices behind a dual read, so we could stop at any point if the numbers didn\'t hold."',
        },
      ],
      pitfalls: [
        'A "wrong call" that was someone else\'s, or that turned out right anyway.',
        'Only describing the outcome, with no insight into the original reasoning.',
        'A lesson like "research more next time" with no concrete process change.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-09',
      difficulty: 'hard',
      question:
        'Invent and Simplify: tell me about a time you made a system meaningfully simpler by removing something, rather than adding a new tool.',
      whatInterviewerLooksFor: [
        'A concrete reduction in components, steps, code or cognitive load',
        'Resisting the urge to add complexity, or reusing what already existed',
        'Handling the resistance of people attached to the old design',
        'Measurable effect on reliability, speed or developer time',
      ],
      modelAnswer: `**Approach:** "simplify" scores when you can **count what disappeared**: services, queues, steps, pages, lines of code. Show the insight that made the simplification possible and the courage to delete.

**Example STAR (adapt, don't recite):**
- **S:** Our order-status flow had 3 layers of retries: the NestJS HTTP client (3 attempts), a BullMQ retry queue (5 attempts) and a nightly reconciliation cron. A single slow partner API call could fan out to 15 attempts, and duplicate shipment requests happened about 40 times a week.
- **T:** I was asked to "add deduplication" to the shipment service.
- **A:** I mapped the full retry graph on one page and showed that dedup would treat a symptom. My proposal was to **remove** two of the retry layers: no HTTP-client retries, and one durable queue with exponential backoff and a dead-letter queue, plus an idempotency key on the partner call (the partner already supported it, and we had never used it). I deleted about 1,400 lines, including a custom retry library, and the nightly cron became a weekly audit job. The cron's author was worried about losing the safety net, so I ran the old cron in report-only mode for 4 weeks to prove it found nothing.
- **R:** Duplicate shipments dropped from about 40 a week to 0. Partner API calls fell 38%. On-call pages for the order-status flow dropped from 9 to 2 a month. A new engineer could follow the flow in one diagram.
- **L:** Before adding a mechanism, I now ask "which existing mechanism is failing, and can I delete it?".`,
      followUps: [
        {
          q: 'Removing retries sounds risky. How did you prove reliability didn\'t get worse?',
          a: 'Show the evidence. "I ran the old reconciliation cron in report-only mode for 4 weeks next to the new flow. It found zero missed status updates. I also tracked DLQ depth (median 0, maximum 3 messages, all from a partner outage) and end-to-end success rate (99.97%, the same as before). Simplifying without proof would have been a gamble."',
        },
        {
          q: 'You mentioned the partner idempotency key was never used. Why do you think nobody had noticed it?',
          a: 'This probes Dive Deep and Learn and Be Curious. "The integration was written 3 years earlier against an older version of the partner API. The key came in a later version, and nobody re-read the changelog because the integration worked. I now add a yearly \'re-read the docs\' review for our top 5 external dependencies, which also found 2 deprecations early."',
        },
      ],
      pitfalls: [
        'Equating "invent" with adopting a trendy technology.',
        'Claiming a simplification with nothing removed, only refactored.',
        'Ignoring the people cost: steamrolling the original author.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-10',
      difficulty: 'expert',
      question:
        'Think Big: describe a technical direction you set that went well beyond your own team\'s roadmap. How did you get other teams to adopt it?',
      context: 'An SDE-3 (L6) calibration prompt. The interviewer is checking multi-team scope and influence without authority.',
      whatInterviewerLooksFor: [
        'A bold, clearly articulated direction, preferably written down',
        'Multi-team or org-level scope with adoption by others',
        'Incremental delivery that proved value early (not a vision with no execution)',
        'Influence without authority, and measurable impact',
      ],
      modelAnswer: `**Approach:** Think Big at SDE-3 means **you saw a pattern across teams, wrote the direction down, and other teams adopted it**. Lead with the insight, then the document, the first proof point and adoption.

**Example STAR (adapt, don't recite):**
- **S:** Across 8 teams in our payments org, every service built its own outbox and retry logic for publishing events to Kafka. We had 8 implementations and 3 incidents in a year from lost or duplicate events.
- **T:** As a senior engineer on the ledger team, I owned one of those 8. Nobody owned the cross-team problem.
- **A:** I wrote a 6-page proposal: "Every payment event exactly-once to consumers by default." It included a shared transactional-outbox library (Postgres + Debezium CDC to Kafka), idempotent consumer middleware for NestJS, and a 3-quarter roadmap. Instead of asking for headcount, I built version 1 for my own team in 5 weeks and published the metrics: zero lost events and p99 publish lag of 800 ms. Then I recruited one engineer each from the 2 teams with the worst incidents to co-own version 2, presented at the org architecture review, and offered office hours and migration pairing.
- **R:** In 3 quarters, 7 of 8 teams adopted it. Event-related incidents went from 3 a year to 0 in the following year, and about 4,000 lines of duplicated code were deleted. The library became the default in our service template.
- **L:** The proof point mattered more than the document. Nobody read the doc until our own numbers were in it.`,
      followUps: [
        {
          q: 'The eighth team never adopted it. Why, and what did you do about it?',
          a: 'Strong candidates respect valid dissent. "They ran MySQL with an existing Maxwell CDC pipeline that already gave them the same guarantees. Forcing a migration would have cost them a quarter for no customer benefit. We agreed on the consumer-side contract (idempotency keys and schema) instead of the implementation. Think Big doesn\'t mean everyone uses my code. It means the org gets the outcome."',
        },
        {
          q: 'How did you keep your own team\'s roadmap on track while running this?',
          a: 'Ownership and Deliver Results probe. "I negotiated with my manager that about 30% of my time went to the platform work for 2 quarters, framed against the incident cost. Version 1 was our own team\'s fix, so it counted as roadmap work. I handed the library\'s maintenance to the 3-team working group in quarter 3, so it didn\'t become my permanent second job."',
        },
      ],
      pitfalls: [
        'Vision only: a slide deck with no shipped proof point.',
        'Scope limited to your own team, which is SDE-2 evidence in an SDE-3 loop.',
        'Claiming adoption by mandate ("my director made everyone use it").',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-11',
      difficulty: 'hard',
      question:
        'Frugality: walk me through the biggest infrastructure cost reduction you drove. How did you make sure the savings did not quietly hurt reliability?',
      whatInterviewerLooksFor: [
        'Savings measured on the actual bill, not projected',
        'A root-cause view of the waste (idle capacity, over-provisioning, data growth)',
        'Explicit guardrails protecting customer-facing SLOs',
        'Resourcefulness: more output for less, not just cutting',
      ],
      modelAnswer: `**Approach:** a Frugality story is credible when you show **where the money went, why, what you changed, the guardrails you kept, and the verified saving**. The Bar Raiser will look for the reliability trade-off, so name it before they ask.

**Example STAR (adapt, don't recite):**
- **S:** Our observability bill (managed logging plus metrics) had grown to about ₹22 lakh a month, growing 9% month on month, faster than traffic (3%).
- **T:** I volunteered to own the cost review for our 40-service platform. The goal was to cut cost without losing incident-diagnosis ability.
- **A:** I broke the bill down by service and log level. 62% of log volume was DEBUG/INFO from 4 chatty services, including full GraphQL request bodies. Custom metrics with a userId label had created 1.8M time series. Changes: **(1)** dynamic log levels (INFO by default, DEBUG switchable per pod for 30 minutes); **(2)** sampled request-body logging at 1%, always kept for errors; **(3)** removed high-cardinality labels and moved per-user analysis to traces; **(4)** 7-day hot retention with older logs archived to S3. **Guardrail:** before each change, I replayed the last 5 incident postmortems and checked we could still diagnose every one with the reduced data.
- **R:** Verified on 3 consecutive invoices, the bill fell from ₹22 lakh to ₹9 lakh a month (about ₹1.5 crore a year). Mean time to diagnose was unchanged at about 14 minutes over the next 2 quarters. Queries got faster with less data to scan.
- **L:** I should have added per-team cost dashboards first. The 4 chatty services' owners didn't know their footprint, and visibility alone changed behaviour.`,
      followUps: [
        {
          q: 'Months later, an incident hits and the debug logs you removed would have helped. How do you handle that?',
          a: 'Owning the trade-off is the signal. "I\'d own it in the postmortem: our sampling missed it. Then I\'d check whether it was a gap in the policy (for example, errors in a code path not tagged as an error) or a one-off. The fix would be targeted, such as always-on logging for that path or tail-based trace sampling for slow requests, not reverting everything. Frugality is a continuous trade-off you keep managing, not a single decision."',
        },
        {
          q: 'How did you get the 4 chatty-service owners to change, given they weren\'t your teams?',
          a: 'Influence without authority. "I sent each owner their own number, for example \'your service is ₹6 lakh a month, 27% of the total\', plus a 1-line PR that switched their logger to the dynamic-level config. Three merged within a week. The fourth was worried about losing payload logs for compliance, so we kept full logging for their audit endpoint only." Make the right change the easiest change.',
        },
      ],
      pitfalls: [
        'Projected savings ("this will save ₹X a year") with no verification.',
        'Cuts that removed monitoring, redundancy or backups.',
        'Treating Frugality as never spending, instead of spending well.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-12',
      difficulty: 'hard',
      question:
        'Hire and Develop the Best: tell me about an engineer you helped grow. Where were they when you started, what did you do, and where are they now?',
      whatInterviewerLooksFor: [
        'A specific person and a specific gap, not "I mentor juniors"',
        'Deliberate actions: stretch work, feedback, safe-to-fail ownership',
        'Measurable growth (scope, promotion, independence)',
        'Willingness to give hard feedback, and to let them shine',
      ],
      modelAnswer: `**Approach:** the outcome is the **mentee's growth**, not your hours spent. Name the gap, the plan, a hard-feedback moment and their trajectory.

**Example STAR (adapt, don't recite):**
- **S:** Arjun, an SDE-1 with 1 year of experience, wrote solid code but froze in design discussions. His design docs went through 5–6 review rounds, and he avoided on-call.
- **T:** My manager asked me to mentor him toward SDE-2 within about a year.
- **A:** I agreed 3 goals with him in writing: lead one design end to end, run an incident, and review others' designs. I gave him the webhook-retry redesign: real but bounded, with me as reviewer, not co-author. I used a "think out loud" format. Before I commented on his doc, he presented the 2 alternatives he rejected and why. Hard feedback: after his first design review, I told him he'd agreed to 4 changes without defending a sound choice. We role-played pushback. I also took the shadow on-call slot so he could be primary, with me as backup.
- **R:** His design review rounds dropped from 6 to 2 by his third doc. He handled a Sev-2 as incident commander in month 7. He was promoted to SDE-2 in 13 months and now mentors 2 new joiners. His webhook design cut retry storms by 90%.
- **L:** I initially over-reviewed his code, which slowed him down. Pulling back to design-level feedback helped him more.`,
      followUps: [
        {
          q: 'Tell me about a time mentoring did not work. What did you do?',
          a: 'Mature answers include a miss. "I mentored an engineer who kept missing estimates. My coaching on breaking down tasks didn\'t help. The real issue was a mismatch: he was strong at front end and on a backend-heavy team. I raised it with our manager, he moved to the web team, and he did well there. Developing people sometimes means helping them find the right place, not forcing growth in the wrong one."',
        },
        {
          q: 'How have you raised the bar in hiring, not just in mentoring?',
          a: 'The "hire" half of this LP. "I\'ve done about 40 interviews over 2 years. I rewrote our LLD question to remove a trick that rewarded memorisation, added a written rubric with example answers for each level, and calibrate monthly with 2 other interviewers. I write evidence-based feedback within 24 hours, before the debrief, and push for a decision on evidence when a loop is split." Keep the numbers honest.',
        },
      ],
      pitfalls: [
        'Generic mentoring with no named person or outcome.',
        'Taking credit for the mentee\'s achievements.',
        'Not knowing where the mentee is now.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-13',
      difficulty: 'expert',
      question:
        'Insist on the Highest Standards: tell me about a time you refused to ship something your team considered good enough. What did that cost, and was it worth it?',
      whatInterviewerLooksFor: [
        'The standard tied to customer impact, not personal taste',
        'Quantified risk and a clear threshold for "good enough"',
        'A mechanism that raises the bar for others, not a one-off block',
        'Honest accounting of the cost (delay, friction) and the result',
      ],
      modelAnswer: `**Approach:** distinguish **high standards** from **perfectionism**. Your bar must be grounded in customer risk and expressed as a measurable threshold. The best stories turn your bar into the team's mechanism.

**Example STAR (adapt, don't recite):**
- **S:** We were launching UPI autopay mandates for subscriptions. Integration tests passed and the PM wanted to ship on Friday for a marketing campaign.
- **T:** I was the reviewer for the mandate-execution service. Reading the code, I saw that retries on the bank's "pending" status had no upper bound or idempotency check against our ledger.
- **A:** I didn't just say "not ready". I wrote a 20-line chaos test that simulated 3% "pending then success" responses at 1K executions per minute. It produced 11 double debits per 10K executions. I showed the PM the numbers and the regulatory cost of a double debit (refund plus customer complaint escalation), and proposed a 4-day delay with a clear exit criterion: zero duplicates in 1M simulated executions. I paired with the author to add a ledger-backed idempotency check and a bounded retry with reconciliation. Then I added the chaos test to CI for every payment-path service.
- **R:** We shipped the next Wednesday. The campaign moved by 4 days at a cost of roughly ₹3 lakh in expected sign-ups that week. In 6 months: zero double debits across 2.3M mandate executions. The CI chaos suite has since caught 2 similar bugs in other teams' code.
- **L:** I raised it on Thursday evening. Had I reviewed earlier in the sprint, there would have been no delay at all. I now ask to review payment-path designs before code.`,
      followUps: [
        {
          q: 'The PM says the campaign date was fixed by the CMO. Do you still block it?',
          a: 'Backbone with options, not a veto. "I\'d escalate the trade-off, not the person: one page to the PM, my manager and the CMO\'s team showing the duplicate-debit rate, the regulatory exposure, and two options. Option A: delay 4 days. Option B: launch on Friday with autopay limited to 5% of users and a manual reconciliation team on watch. If leadership picks B with the risk understood, I commit and help run it. High standards means making the risk visible, not owning the final call."',
        },
        {
          q: 'How do you avoid becoming the reviewer who blocks everything?',
          a: 'Self-awareness probe. "I separate must-fix from nice-to-have explicitly in reviews, and I only block on customer, security or data-integrity risk with a reproducible test. I also track my own review data. Last quarter about 5% of my reviews had blocking comments, and each one had a test attached. If I\'m blocking more than that, either the team has a systemic gap I should fix with a mechanism, or I\'m being a perfectionist."',
        },
      ],
      pitfalls: [
        'Standards as personal taste: naming conventions, style nits.',
        'Blocking without data or an exit criterion.',
        'Not mentioning the cost of the delay, as if high standards were free.',
      ],
    },
    {
      id: 'beh-amazon-lp-iq-14',
      difficulty: 'hard',
      question:
        'Success and Scale Bring Broad Responsibility: tell me about a time you noticed a secondary effect of your system on people outside your users or your team, and acted on it.',
      context: 'One of the two LPs added in July 2021. Some interviewers combine it with Strive to be Earth\'s Best Employer.',
      whatInterviewerLooksFor: [
        'Notices second-order effects: privacy, partners, communities, environment, abuse',
        'Acts beyond the immediate requirement and leaves the system better',
        'Balances that responsibility against delivery, with data',
        'Builds a lasting mechanism, not a one-off fix',
      ],
      modelAnswer: `**Approach:** this LP asks whether you think beyond the ticket and beyond the immediate customer. Good engineering angles include PII and privacy, effects on partner businesses (sellers, delivery partners), accessibility, abuse of a feature, and wasted compute or energy. Show that you **noticed, quantified, acted and left a mechanism**.

**Example STAR (adapt, don't recite):**
- **S:** I built a "smart retry" feature in our delivery-partner dispatch service. If a partner didn't accept an order within 20 s, we re-pinged them up to 6 times and then reassigned.
- **T:** The feature hit its goal (assignment time −18%), but I owned its behaviour in production.
- **A:** Reading partner-app analytics a month later, I noticed something nobody had asked about. Partners on low-end Android phones received up to 6 notifications in 2 minutes. Their battery drain complaints had doubled, and some had turned off notifications, which **reduced** their earnings. I quantified it: 11% of partners, mostly on devices with under 3 GB RAM, were affected. I proposed and built a change: re-ping at most twice, then offer the order to the next partner, and a per-device notification budget. I also worked with the partner-ops team to add a "notification fatigue" metric to the weekly review.
- **R:** Assignment-time gains held at −15% (versus −18%). Partner notification opt-outs fell 40%, and earnings per active hour for the affected group rose 6%. The notification budget became a shared library used by 2 other teams.
- **L:** "Our metric went up" isn't the end of the review. I now add a "who else does this touch?" section to every design doc.`,
      followUps: [
        {
          q: 'You gave back 3 points of assignment-time improvement. How did you justify that to your PM?',
          a: 'Show balance with data. "I framed it as protecting supply. Partners turning off notifications was a slow leak in fleet capacity, and in 2 cities opt-outs were trending toward a level where peak assignment time would get worse than before the feature. I showed the trend line and the earnings drop, and proposed a 2-week A/B test. The test showed net supply was healthier with the cap, so the PM agreed."',
        },
        {
          q: 'How is this different from Customer Obsession?',
          a: 'Customer Obsession works backwards from the customer you are serving directly. Broad Responsibility asks about **secondary effects** on people who aren\'t your target customer or who are affected indirectly, such as partners, communities, the environment, or users of systems downstream of yours. In this story the target customer was the person ordering. The delivery partners felt the side-effect. Naming that distinction shows you understand the LP rather than relabelling a customer story.',
        },
      ],
      pitfalls: [
        'Generic statements about values with no action.',
        'Relabelling a plain customer story as "broad responsibility".',
        'Doing the right thing by quietly missing the original goal, without discussing the trade-off.',
      ],
    },
  ],
  envelopeQuestions: [],
  test: [
    {
      id: 'beh-amazon-lp-mcq-01',
      difficulty: 'medium',
      question:
        'A friend\'s Amazon prep sheet from 2020 lists "14 Leadership Principles", including "Have Backbone" and "Disagree and Commit" as separate items. Which corrections should you make before your 2026 loop? Select ALL that apply.',
      options: [
        'The official list on amazon.jobs now has 16 principles',
        '"Have Backbone; Disagree and Commit" is a single principle with two halves that are scored together',
        'Strive to be Earth\'s Best Employer and Success and Scale Bring Broad Responsibility were added in 2021 and can be assigned to interviewers',
        '"Vocally Self-Critical" was promoted from a phrase inside Earn Trust to a separate principle',
        'Learn and Be Curious was removed when the two new principles were added',
      ],
      correct: [0, 1, 2],
      explanation:
        'Amazon.jobs lists 16 principles. The two newest (July 2021) are Earth\'s Best Employer and Success and Scale Bring Broad Responsibility. "Have Backbone; Disagree and Commit" has always been one principle. "Vocally self-critical" is still a phrase inside Earn Trust, not its own LP. Learn and Be Curious, added in 2015, is still on the list. A stale list makes you miss two LPs an interviewer can be assigned.',
      followUps: [
        {
          q: 'Your interviewer asks a question clearly aimed at Strive to be Earth\'s Best Employer, and you have no story. What do you do in the moment?',
          a: 'Take 10–15 seconds to think. Saying so is fine. Then pick an adjacent real story with a people or team-health slice: an on-call rotation you made fairer, a teammate you supported, a process you made more inclusive. Tell it from the people angle, not the technical one. Don\'t bluff a story you can\'t defend through 3 follow-ups, and don\'t say "I haven\'t prepared for that LP".',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-02',
      difficulty: 'hard',
      question:
        'After a loop, three interviewers vote "hire", the hiring manager strongly wants to hire to fill a sale-season gap, and the Bar Raiser votes "no hire", citing weak Ownership evidence. Based on how Amazon describes the process, what is the most likely outcome?',
      options: [
        'The candidate is hired because the majority voted hire and the hiring manager makes the final call',
        'The Bar Raiser can block the hire; the debrief will test whether the Ownership evidence really supports a hire, and urgency to fill the role is not a reason to lower the bar',
        'The loop is automatically extended with a fifth interview focused only on Ownership',
        'The recruiter breaks the tie, because the recruiter owns the candidate relationship',
      ],
      correct: [1],
      explanation:
        'Working Backwards describes the Bar Raiser as someone outside the hiring team, not the hiring manager or recruiter, with power to veto a hire and override the hiring manager. The program exists precisely to stop urgency ("we need someone for the sale") from lowering the bar. Votes aren\'t a simple majority. The debrief examines evidence. Extra interviews sometimes happen, but they are not automatic, and recruiters don\'t break ties.',
      followUps: [
        {
          q: 'As a candidate, what does this tell you about how to spread your effort across rounds?',
          a: 'Every round is an independent evidence source, written up before the debrief, and any one strong "no hire" with evidence can sink the loop. So you can\'t bank on a brilliant DSA round. Prepare distinct, deep LP stories for each round, and treat every interviewer as the possible Bar Raiser, since you\'re usually not told who it is.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-03',
      difficulty: 'medium',
      question: 'What is the single biggest problem with this Ownership answer from an SDE-2 candidate?',
      code: {
        language: 'text',
        title: 'Candidate answer excerpt',
        code: `"Our team noticed the payment reconciliation job kept failing at month
end. We discussed it in retro and we decided to rewrite it using a
streaming approach with Kafka. We worked really hard for 3 sprints and
we delivered it on time. Now it never fails and finance is very happy."`,
      },
      options: [
        'It uses Kafka, which signals over-engineering for a batch reconciliation job',
        'The interviewer cannot tell what the candidate personally did; every action is "we", and there are no numbers',
        'It is too short; STAR answers must be at least 5 minutes long',
        'Ownership stories should be about failures, not successes',
      ],
      correct: [1],
      explanation:
        'Amazon\'s own tips say to use "I" not "we" and to use data. The interviewer must write evidence about you, and here every action belongs to the team, with no failure rate, volume or before/after numbers. The technology choice might be questioned later, but it isn\'t the main issue. Length isn\'t the problem: 2–3 minutes is fine. Ownership stories can be successes.',
      followUps: [
        {
          q: 'The interviewer asks "What was your specific role?" and honestly you were one of four engineers. How do you answer without inflating it?',
          a: 'Be precise and proud of your slice: "I owned the idempotent consumer and the replay tool. Priya owned the producer side. I also proposed the streaming approach in retro with failure data from 6 months of runs." Then go deep on your slice with numbers. Interviewers reward an accurate scope over an inflated one. Inflation gets exposed at the second follow-up.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-04',
      difficulty: 'hard',
      question:
        'The interviewer says: "Tell me about a time you took a calculated risk." Which story excerpt best demonstrates Bias for Action as Amazon defines it?',
      options: [
        'During a sale I dropped an unused 400 GB column from the orders table without a backup to free disk quickly, since speed mattered',
        'I spent 3 weeks benchmarking 4 message brokers before picking one, so the decision would never need revisiting',
        'With partial data, I enabled a pre-tested degraded-mode flag for 10% of traffic, stated the worst case and rollback in the channel, then ramped to 100% after 3 minutes of clean metrics',
        'I waited for my manager\'s approval before mitigating, because acting without it would show poor Earn Trust',
      ],
      correct: [2],
      explanation:
        'Bias for Action is speed on reversible decisions ("many decisions and actions are reversible… We value calculated risk taking"). The flag rollout is fast, bounded, reversible and communicated. Dropping a column without a backup is a one-way door taken recklessly. Three weeks of benchmarking may be good judgment for a long-lived choice, but it isn\'t Bias for Action. Waiting for approval during an incident trades speed for nothing when the action is reversible.',
      followUps: [
        {
          q: 'The interviewer pushes: "What if the flag had made things worse at 10%?" What does a strong answer include?',
          a: 'A pre-defined abort condition and an owner. For example: "If the error rate or p99 at 10% got worse than the control group within 2 minutes, I\'d turn the flag off, which takes about 5 seconds through the config service, and move to the next option on my list, a rollback of the morning deploy." Naming the abort criterion before acting is what turns a risk into a calculated one.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-05',
      difficulty: 'expert',
      question:
        'Deep in a Dive Deep story, the Bar Raiser asks: "What was the p99 before your fix?" You genuinely don\'t remember the exact number. Which response is best?',
      options: [
        'Give a confident, precise number like "1,840 ms" so the story stays credible',
        'Say you\'d need to check, then give the honest range you do remember, how it was measured, and the relative change you are sure of',
        'Say the numbers aren\'t important, because the interviewer should focus on your approach',
        'Redirect to a different story where you remember the numbers better',
      ],
      correct: [1],
      explanation:
        'Bar Raisers probe numbers repeatedly. A made-up precise figure tends to contradict itself under the next question and destroys trust, which is an Earn Trust failure that is worse than a fuzzy number. An honest range plus the measurement method ("about 2 s at p99, from the ALB target-response metric; it dropped about 10x") still shows Dive Deep. Dismissing numbers or switching stories looks evasive.',
      followUps: [
        {
          q: 'How should you prepare so this doesn\'t happen for your top stories?',
          a: 'For each story-bank card, write down 2–4 anchor numbers with their source: the before/after metric, the scale (RPS, rows, users), the money or time impact, and the date. Re-check them against old dashboards, tickets or postmortems if you can still reach them. Memorise the ranges and how each was measured, not false precision. "About 9K RPS at peak, from the Grafana panel" is perfect.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-06',
      difficulty: 'expert',
      question:
        'You disagreed with your manager about using DynamoDB for a reporting feature, lost the argument, and committed. Three months later the feature is slow because of scan-heavy queries, as you predicted. In a Disagree and Commit answer, which next step scores best?',
      options: [
        'Remind the team in retro that you raised this risk, so the decision process improves next time',
        'Quietly add a Postgres read model on the side without telling anyone, to protect customers',
        'Bring the latency data and a proposed fix (e.g. a stream into a query-friendly store or adding GSIs) to the manager as a problem to solve together, without assigning blame',
        'Keep committing to the original decision indefinitely, because reopening it would violate "Disagree and Commit"',
      ],
      correct: [2],
      explanation:
        'Committing means working to make the decision succeed. When new data shows a problem, a leader brings data and options, not "I told you so". The retro reminder damages trust. A quiet side system fails Earn Trust and fragments ownership. Committing does not mean ignoring evidence forever: reopening a decision with new data is expected, and Are Right, A Lot asks you to update on evidence.',
      followUps: [
        {
          q: 'The manager asks, "Were you right all along?" in front of the team. How do you answer?',
          a: 'Shift from who was right to what we learned. For example: "I flagged scan risk, but I underestimated how fast the reporting needs would grow, and the DynamoDB choice did deliver the write path we needed. The fix is a DynamoDB Streams pipeline into an OpenSearch index for reports." Generosity in public builds trust and makes the next disagreement easier.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-07',
      difficulty: 'expert',
      question:
        'An SDE-2 candidate interviewing for SDE-3 is asked a follow-up after a migration story. Which responses would push the interviewer\'s level assessment toward SDE-3? Select ALL that apply.',
      options: [
        '"I aligned the 4 consuming teams on a cutover contract and ran the joint go/no-go, though none of them reported to me"',
        '"I turned our dual-write + checksum approach into a migration playbook that 3 other teams have since reused"',
        '"I personally wrote 80% of the migration code over two weekends to make the date"',
        '"I chose to accept 2 weeks of slower reports as a deliberate trade-off, documented it, and got sign-off from finance and analytics leads"',
        '"I made sure my tickets were always closed before the sprint ended"',
      ],
      correct: [0, 1, 3],
      explanation:
        'SDE-3 (L6) evidence is multi-team influence without authority, mechanisms that scale beyond your team (a reusable playbook), and owning explicit cross-team trade-offs. Writing most of the code over weekends is individual heroics, which is SDE-2-level evidence at best and can suggest poor delegation. Closing tickets on time is a baseline expectation, not a level signal.',
      followUps: [
        {
          q: 'The interviewer asks how you got the 4 teams to agree on a cutover date. What detail makes this believable?',
          a: 'Concrete mechanics: who disagreed and why, and what you traded. For example: "Analytics wanted to move the date because of their quarter-end ETL. I offered a 6-hour read-only snapshot for them, which unblocked the date. I published a one-page cutover contract with rollback triggers and ran a go/no-go call with a named owner from each team." Specific friction plus a resolution makes influence believable. "Everyone agreed" does not.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-08',
      difficulty: 'hard',
      question:
        'A candidate tells a Frugality story: "I cut our AWS bill by 45% by moving all services to spot instances and removing the multi-AZ replica of our orders database." What is the Bar Raiser most likely to probe?',
      options: [
        'Whether the candidate got approval from the finance team before changing instances',
        'Whether the saving traded away reliability and customer experience, which conflicts with Insist on the Highest Standards and Customer Obsession',
        'Whether the candidate considered Reserved Instances, which are always cheaper than spot',
        'Whether 45% is precise enough, since Amazon expects percentages to one decimal place',
      ],
      correct: [1],
      explanation:
        'LPs are evaluated together. Removing the multi-AZ replica of an orders database increases the risk of a long outage or data loss, and putting all services on spot without interruption handling threatens availability. A BR will check whether frugality was bought with customer risk. Finance approval is secondary. Reserved Instances are not always cheaper than spot, since spot is usually the deepest discount. Precision to a decimal place is not the issue.',
      followUps: [
        {
          q: 'How could the candidate re-tell the same cost work so it scores well?',
          a: 'Keep the frugal moves that don\'t touch customer risk and show the guardrails. For example: spot only for stateless, interruption-tolerant workers with a capacity-rebalance handler and an on-demand fallback; right-sizing on p95 CPU; and keeping multi-AZ for the orders DB, perhaps moving it to Graviton instances to save there instead. State the SLOs that stayed flat and verify the saving on invoices. Same theme, but now it reads as judgment.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-09',
      difficulty: 'hard',
      question:
        'You are preparing a story bank for a 4-round Amazon loop. Which practices are sound? Select ALL that apply.',
      options: [
        'Prepare about 10–12 real stories and know 2–3 LP angles for each, so each LP has 2 candidate stories',
        'Write word-for-word scripts and memorise them so you never hesitate',
        'Avoid telling the same story to two different interviewers in the same loop',
        'Keep the mistake and the friction in each story rather than polishing them out',
        'Use one flagship story for every round, since consistency is valued in the debrief',
      ],
      correct: [0, 2, 3],
      explanation:
        'Rich stories with multiple LP slices give coverage without 32 separate stories. Interviewers compare notes, so a repeated story is one data point instead of two. Mistakes and friction make stories credible and survive follow-ups. Word-for-word scripts sound rehearsed and break when the interviewer interrupts. Reusing one flagship story across rounds wastes evidence and looks thin.',
      followUps: [
        {
          q: 'Two interviewers in the same loop ask essentially the same question ("Tell me about a conflict"). You already used your best conflict story. What now?',
          a: 'Use your second conflict story. That\'s why you prepare 2 per LP. If you truly have only one, say "I shared one with your colleague. Here\'s a different one", and tell a smaller but real story, or a different slice of a bigger one (for example the cross-team negotiation inside the migration). Don\'t silently repeat. The debrief will notice.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-10',
      difficulty: 'medium',
      question:
        'A backend engineer with no external-customer contact is asked a Customer Obsession question. Which framing is strongest?',
      options: [
        '"As a backend engineer I don\'t interact with customers, but I always write clean code, which ultimately helps them"',
        '"My customer was the mobile team consuming our API. I studied their client traces, found their real need, and changed our API so their screen\'s p95 render time dropped 40%"',
        '"My manager is my customer, so I make sure to deliver exactly what they ask for on time"',
        '"I read every app-store review each week to stay connected to customers"',
      ],
      correct: [1],
      explanation:
        'Internal customers are valid, and backend engineers usually have them: client teams, ops users, on-call engineers. The strong answer names the customer, works backwards from their need with data, and measures their outcome, ideally linked to end users. "Clean code helps them" is indirect and has no evidence. Treating your manager as the customer misreads the LP. Reading reviews is a habit, not a story with an action and a result.',
      followUps: [
        {
          q: 'The interviewer asks: "And how did that affect the end customer, not just the mobile team?" How do you connect it?',
          a: 'Trace the chain with a number: "The faster render was on the checkout status screen. The mobile team saw \'payment pending\' support tickets drop 23% the following month, and checkout abandonment on 3G fell about 1.5 points." If you don\'t have end-customer numbers, say what signal you\'d look at and why you believe the link, without inventing figures.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-11',
      difficulty: 'expert',
      question:
        'The Bar Raiser says: "That failure was 5 years ago. Tell me about a failure from the last six months." Which response is strongest?',
      options: [
        '"Honestly, I haven\'t had a real failure recently. Our processes are quite mature now."',
        '"I sometimes care too much about code quality, which slows me down."',
        '"Last quarter I estimated a webhook migration at 2 sprints; it took 4 because I didn\'t check partner sandbox limits. I told the PM in week 2, re-planned, and now I run a 1-day spike on any external dependency before estimating."',
        '"My team missed a deadline last month because QA was late, which taught me to follow up with QA more often."',
      ],
      correct: [2],
      explanation:
        'A recent, real, owned failure with a concrete cause, an early disclosure and a process change shows Earn Trust and learning. Saying you have no recent failures signals a lack of self-awareness or risk-taking. The "care too much" line is a humble-brag that Bar Raisers recognise at once. Blaming QA puts the failure on someone else and teaches only a shallow lesson.',
      followUps: [
        {
          q: 'The interviewer continues: "What did the PM say when you told them in week 2?" Why does this probe matter?',
          a: 'It tests whether the disclosure really happened early and how the relationship held up. A credible answer: "She was frustrated, because sales had already told 2 clients the date. She asked for a date I\'d stand behind. I gave her one with a 20% buffer and a weekly status update, and we hit it." Real stories have reactions and consequences. Invented ones go vague here.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-12',
      difficulty: 'hard',
      question:
        'Your strongest story is a zero-downtime migration of a 1.2 TB orders database, during which you challenged a 2-hour maintenance-window plan with data and built a row-checksum verifier that caught 0.003% drift. Which LPs can this ONE story credibly serve, if you tell the right slice? Select ALL that apply.',
      options: [
        'Dive Deep (the drift investigation and verifier)',
        'Have Backbone; Disagree and Commit (challenging the maintenance-window plan)',
        'Hire and Develop the Best (the story mentions no people development)',
        'Insist on the Highest Standards (refusing to cut over without verified data parity)',
        'Strive to be Earth\'s Best Employer (the migration happened at 3 a.m.)',
      ],
      correct: [0, 1, 3],
      explanation:
        'The verifier and drift hunt are Dive Deep. The maintenance-window challenge is Backbone. Refusing to cut over without verified parity is Insist on the Highest Standards. Nothing in the story shows developing people, so claiming Hire and Develop would be a stretch. A 3 a.m. cutover is not evidence for Earth\'s Best Employer. If anything, the interviewer may ask how you protected the team\'s health.',
      followUps: [
        {
          q: 'How would you change the opening of the story when telling it for Dive Deep versus Backbone?',
          a: 'For Dive Deep, open at the anomaly: "Two days before cutover, the checksum verifier flagged 0.003% of rows (about 36K) mismatched…" and spend the time on the investigation. For Backbone, open at the disagreement: "The payments lead wanted a 2-hour maintenance window during the Diwali run-up; I believed we could avoid downtime and owed him the data…" Same facts, different first 30 seconds and a different emphasis.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-13',
      difficulty: 'expert',
      question:
        'For an Earn Trust prompt about conflict, which excerpt is the biggest red flag to a Bar Raiser?',
      code: {
        language: 'text',
        title: 'Four candidate excerpts',
        code: `A: "I realised my review comments on his PR read as harsh, so I
    apologised 1:1 and suggested we pair on the next one."
B: "Honestly, he was just a difficult person and everyone knew it,
    so I documented everything and escalated to his manager."
C: "We disagreed on the retry strategy; I asked him to walk me through
    his failure scenario and realised he'd seen an outage I hadn't."
D: "I told the team in standup that the delay was due to my wrong
    estimate, not the vendor."`,
      },
      options: ['Excerpt A', 'Excerpt B', 'Excerpt C', 'Excerpt D'],
      correct: [1],
      explanation:
        'B labels the other person ("difficult"), relies on others agreeing ("everyone knew it"), and escalates without showing any attempt to listen or resolve. That is the opposite of "listen attentively, speak candidly, treat others respectfully". A is self-critical and repairs the relationship. C shows listening and changing your mind. D is vocal self-criticism in public, the textbook Earn Trust behaviour.',
      followUps: [
        {
          q: 'Sometimes escalation really is the right move. How would you tell a conflict story that ends in escalation without triggering this red flag?',
          a: 'Show the steps before escalating and keep it about behaviour, not character. For example: "I raised the issue 1:1 twice with specific examples, proposed a working agreement, and tracked the impact (3 missed handoffs in 2 sprints). When it continued, I told him I\'d involve our manager and why, and we had a three-way conversation focused on the process." Transparency about escalating keeps the trust intact.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-14',
      difficulty: 'expert',
      question:
        'Which details in a Hire and Develop the Best story give the interviewer the strongest evidence? Select ALL that apply.',
      options: [
        'The mentee\'s concrete growth: what they can now do independently, plus a scope or level change',
        'The total hours you spent mentoring each week',
        'A moment where you gave hard, specific feedback and how the mentee responded',
        'That you deliberately gave them a stretch ownership you could have done faster yourself',
        'A list of the internal training courses you recommended',
      ],
      correct: [0, 2, 3],
      explanation:
        'The LP is about raising the bar through people, so the evidence is the mentee\'s outcome, hard feedback (which shows you "take seriously the role in coaching"), and delegating stretch work at a cost to your own speed. Hours spent measure input, not results. A list of courses is passive and doesn\'t show coaching.',
      followUps: [
        {
          q: 'The interviewer asks: "What would your mentee say was the least helpful thing you did?" How do you answer?',
          a: 'Name a real misstep from their side. For example: "Early on I left 30+ line-level comments on his PRs. He told me later it made him feel he couldn\'t ship anything alone. I switched to design-level feedback and a weekly 1:1, and his PR cycle time halved." It shows you asked for feedback on your coaching, which is also Earn Trust.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-15',
      difficulty: 'hard',
      question:
        'A candidate gives a strong Insist on the Highest Standards story: they blocked a release over a data-integrity bug. Which follow-up response would LOWER the interviewer\'s rating?',
      options: [
        '"The delay cost about 4 days and an estimated ₹3 lakh in campaign sign-ups; I made that cost explicit to the PM before blocking"',
        '"I set a clear exit criterion: zero duplicates in 1M simulated executions"',
        '"I block most releases I review until everything is perfect. It\'s just my personal standard"',
        '"I added the failing scenario to CI so the next team doesn\'t depend on my review"',
      ],
      correct: [2],
      explanation:
        'High standards must be grounded in customer risk with a clear threshold. Blocking most releases on a personal standard signals perfectionism and poor judgment, and it conflicts with Deliver Results and Bias for Action. Making the cost explicit shows you weighed it. An exit criterion makes the bar objective. A CI mechanism turns your standard into a team standard, which is exactly the "fixed so they stay fixed" signal.',
      followUps: [
        {
          q: 'How would you show that your blocks are rare and justified, without sounding defensive?',
          a: 'Give data about your own behaviour. For example: "Across about 120 reviews last half-year, I left blocking comments on 6, all on payment or data-integrity paths, each with a reproducing test. Everything else was suggestions the author could take or leave." Self-measurement shows Dive Deep applied to yourself and puts the perfectionism worry to rest.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-16',
      difficulty: 'expert',
      question:
        'Which story slices are credible evidence for Success and Scale Bring Broad Responsibility for a backend engineer? Select ALL that apply.',
      options: [
        'Finding and masking full phone numbers in production logs across services, then adding a lint rule that prevents recurrence',
        'Noticing your dispatch retries were draining delivery partners\' phone batteries and changing the design, at a small cost to your headline metric',
        'Hitting a 99.99% availability SLO for your checkout service for 4 straight quarters',
        'Cutting idle compute on a nightly batch fleet by 60% and documenting the energy and cost reduction',
        'Shipping a feature 2 weeks ahead of schedule so the sales team could close a large deal',
      ],
      correct: [0, 1, 3],
      explanation:
        'The LP is about secondary effects on people and the world, and leaving things better: privacy (PII in logs), effects on partners outside your target users, and waste (idle compute and energy) all fit. Hitting an availability SLO is excellent Deliver Results or Insist on the Highest Standards evidence but has no secondary-effects angle. Shipping early for sales is Deliver Results or Customer Obsession.',
      followUps: [
        {
          q: 'For the PII-in-logs story, the interviewer asks: "Why was this your job and not the security team\'s?" What is a strong answer?',
          a: 'Combine Ownership with Broad Responsibility: "Security owns the policy, but the leak was in code my team wrote and operated, so fixing it was ours. I still told security right away, because they needed to judge whether it was a reportable exposure and check retention on the log store. The lint rule was my contribution so every team, not just us, would catch it in CI." Acting while bringing in the owner is the pattern.',
        },
      ],
    },
    {
      id: 'beh-amazon-lp-mcq-17',
      difficulty: 'hard',
      question:
        'In the Bar Raiser round, the interviewer asks only two LP questions in 30 minutes and keeps asking "why?" on the first one. A candidate concludes the round went badly. What is the most accurate reading?',
      options: [
        'Long drilling on one story is normal for a Bar Raiser and is how they test depth and authenticity. It is not by itself a negative signal',
        'Two questions in 30 minutes means the candidate failed the first answer and the interviewer was trying to rescue them',
        'The interviewer was probably not the Bar Raiser, since Bar Raisers ask as many questions as possible to cover all 16 LPs',
        'Repeated "why?" questions mean the interviewer disagreed with the technical choices in the story',
      ],
      correct: [0],
      explanation:
        'Candidate reports and coaching guides consistently describe Bar Raisers spending 10–15 minutes or more on one story, peeling it back 3–4 levels to separate real experience from rehearsed narrative. Fewer, deeper questions is the expected pattern. They don\'t try to cover all 16 LPs, since the loop covers them collectively. "Why?" usually tests understanding, not disagreement.',
      followUps: [
        {
          q: 'At the fourth "why?", you reach the limit of what you know about a decision your tech lead made. What do you say?',
          a: 'Be honest about the boundary and show curiosity. For example: "That part was my tech lead\'s call. My understanding is he was worried about Kafka partition rebalancing under consumer churn, but I didn\'t dig into his benchmark at the time. Looking back, I would have, because it affected my consumer design." Admitting the edge of your knowledge plus showing what you\'d explore is better than improvising.',
        },
      ],
    },
  ],
};

export default topic;
