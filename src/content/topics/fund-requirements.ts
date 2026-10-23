import type { Topic } from '../../types';

const topic: Topic = {
  id: 'fund-requirements',
  phase: 'fundamentals',
  order: 1,
  title: 'Requirements & The Interview Framework',
  subtitle:
    'Turn a one-line prompt into scoped functional requirements, measurable SLO-style NFRs, an API contract and a 45-minute plan you actually control.',
  estimatedMinutes: 75,
  sources: [
    'Mastering API Architecture — Ch 1 (Design, Build and Specify APIs)',
    'Google SRE Book — Ch 4 (Service Level Objectives)',
  ],
  tags: ['interview-framework', 'requirements', 'nfr', 'slo', 'api-first', 'scoping', 'trade-offs'],
  cheatSheet: [
    "4 steps: 1) understand & scope (3-10 min) 2) high-level design + buy-in (10-15) 3) deep dive (10-25) 4) wrap-up (3-5).",
    "Functional = verbs the user can do (post, follow, book). Pick 3-4 core ones and say out loud what is OUT of scope.",
    "Non-functional must be measurable: 'p99 read < 200ms at LB, 99.95% monthly availability, RPO 1 min' — never 'fast and scalable'.",
    "Nines per 30 days: 99.9% = 43.2 min, 99.95% = 21.6 min, 99.99% = 4.3 min, 99.999% = 26 s.",
    "Consistency is per feature, not per system: seat booking strong, seat map / like counts eventual with read-your-writes.",
    "Find the core entity + the contended row (seat, inventory date, wallet balance) — that is where the deep dive lives.",
    "Split read path vs write path and state the ratio (100:1 → cache + replicas; 1:1 write-heavy → partitioned log/LSM store).",
    "API-first: define 3-5 endpoints with idempotency keys, cursor pagination and auth context before drawing boxes.",
    "Trade-off sentence: 'I pick X because requirement Y; it costs Z; I mitigate with W; I would revisit if V changes.'",
    "Wrap-up: next bottleneck at 10x, failure modes (AZ loss, hot key, poison message), SLO dashboards/alerts — not a recap of boxes.",
  ],
  sections: [
    {
      heading: 'Why requirements decide the outcome',
      body: `**Intuition:** a system design interview is not a test of whether you know Kafka — it is a simulation of a senior engineer receiving a vague ask from a product manager. The interviewer grades *how you reduce ambiguity* as much as the boxes you draw.

The prompt ("Design Ticketmaster") is deliberately under-specified. Two candidates with identical technical knowledge produce wildly different designs because one asked "do we have on-sale spikes where 1M people fight for 50K seats?" and the other did not. That single answer moves the design from "one Postgres and a CRUD service" to "virtual waiting room, per-seat conditional holds, cached seat map".

**What is actually scored (typical senior rubric):**

| Signal | What a strong candidate shows |
|---|---|
| Problem navigation | Asks few but high-leverage questions, scopes explicitly |
| Solution design | Coherent high-level design that satisfies the stated NFRs |
| Technical depth | Goes deep on the 1-2 hardest parts, with numbers |
| Trade-offs | Names alternatives, picks one, states cost and trigger to revisit |
| Communication | Drives the session, checks in, recovers from pushback |

**In interviews say this:** "Before I draw anything, I want to spend about five minutes pinning down the scope and the few numbers that will drive the architecture." Then do it in five minutes — not fifteen.`,
      diagram: `45-minute interview — where the time should go
 0      5         10              25                     40    45
 |------|---------|---------------|----------------------|-----|
 | reqs | estimate| high-level +  |   deep dive (1-2     | wrap|
 | &    | (only   | API + data    |   hardest parts,     | -up |
 | scope| numbers | model, get    |   with numbers and   |     |
 |      | that    | buy-in        |   trade-offs)        |     |
 |      | matter) |               |                      |     |
 weak candidates: 15 min on reqs, 25 min on boxes, 0 min deep dive`,
      keyPoints: [
        "The interviewer wants to see ambiguity reduction, not a memorised reference architecture.",
        "One high-leverage question (spikes? group size? consistency?) can change the whole design.",
        "Announce your plan and time budget up front — it signals seniority and lets the interviewer redirect early.",
      ],
    },
    {
      heading: 'The 4-step framework (and how to run it in 45 minutes)',
      body: `**Intuition:** the framework is a checklist that stops you from diving into sharding before you know what you are building.

Every classic design (Proximity Service, Nearby Friends, Hotel Reservation, Payment, Stock Exchange…) is structured the same way:

| Step | Time | Output | Exit criterion |
|---|---|---|---|
| 1. Understand the problem & establish scope | 3-10 min | FR list, NFR list with numbers, out-of-scope list, rough scale | Interviewer nods at the list |
| 2. Propose high-level design & get buy-in | 10-15 min | API, data model sketch, box diagram of read and write paths | "Does this look reasonable before I go deeper?" |
| 3. Design deep dive | 10-25 min | 1-2 components in depth: contention, scaling, failure modes | You have defended a trade-off with numbers |
| 4. Wrap up | 3-5 min | Bottlenecks, failure scenarios, monitoring, next 10x | Interviewer has no "but what about…" left open |

**Mechanics that matter:**
- **Step 1 is a conversation, not a questionnaire.** Propose assumptions and let the interviewer correct them: "I'll assume 10M DAU and a 100:1 read:write ratio — does that sound right?" This is faster than asking open questions.
- **Estimation belongs in step 1 only as far as it changes decisions.** "12K QPS peak" tells you a single Postgres primary will not take the writes; computing it to three significant figures does not.
- **Step 2 must end with a check-in.** Buy-in is explicit in the framework for a reason: it is cheap to change direction at minute 15 and very expensive at minute 35.
- **Step 3 is where seniority shows.** Choose the component that is hardest *given the NFRs* (seat contention for ticketing, fan-out for feeds, exactly-once for payments), or ask: "I'd like to go deep on X — or is there another area you'd prefer?"

**In production terms:** this is exactly a design review — PRD → requirements and SLOs → RFC with API and architecture → deep review of risky parts → rollout, monitoring and open questions.`,
      diagram: `  prompt ──► [1] clarify ─► FR / NFR / out-of-scope / scale
                 │
                 ▼
             [2] API ─► data model ─► read path + write path boxes
                 │                        │
                 └──── "does this look right?" ◄─ buy-in
                 ▼
             [3] deep dive: hottest path / contended entity / failure
                 │   (numbers + alternatives + chosen trade-off)
                 ▼
             [4] wrap-up: 10x bottleneck, failure modes, SLO alerts`,
      keyPoints: [
        "State assumptions as proposals the interviewer can correct — faster than open-ended questions.",
        "Always ask for buy-in at the end of step 2.",
        "Choose the deep dive based on the NFRs, or offer the interviewer a choice.",
      ],
      source: 'Vol 2, all chapters',
    },
    {
      heading: 'Functional requirements: verbs, core use-cases and explicit scope',
      body: `**Intuition:** functional requirements are the verbs of the system — what a user (or another service) can *do*. Scope is the list of verbs you are *not* going to design today.

**How to extract them quickly:**
1. Name the actors (buyer, organiser, admin, payment provider webhook).
2. For each actor list the top verbs; keep **3-4 core use-cases** that exercise the interesting parts of the system.
3. Say out loud what is out of scope: "I'll leave out search ranking, refunds and the organiser dashboard unless you want them."
4. Write them on the board — you will reference them in step 4 to show the design satisfies every one.

**Good vs weak FRs (ticketing example):**

| Weak | Strong |
|---|---|
| "Users can buy tickets" | "Buyer can view an event's seat map, hold up to 8 seats for 10 minutes, and confirm by paying" |
| "Search" | "Buyer can search events by city + date range; results may be up to 1 minute stale" |
| "Notifications" | Out of scope (mention: email confirmation via async worker) |

Notice the strong version smuggles in NFR hints (10-minute hold, 1 minute staleness) — that is intentional; they fall out of good FRs.

**For a backend engineer:** think of FRs as the resolvers or controller methods you would write. If you can't name the endpoint, the requirement is too vague.`,
      code: [
        {
          language: 'typescript',
          title: 'Capturing scope as a typed spec (how I keep the whiteboard honest)',
          code: `// A lightweight "requirements object" — the same shape you'd put in an RFC.
type Consistency = 'strong' | 'read-your-writes' | 'eventual';

interface UseCase {
  actor: 'buyer' | 'organiser' | 'payment-webhook';
  verb: string;
  consistency: Consistency;   // per use-case, never per system
  latencyP99Ms: number;       // measured at the load balancer
}

export const ticketingSpec = {
  inScope: [
    { actor: 'buyer', verb: 'view event + seat map', consistency: 'eventual', latencyP99Ms: 200 },
    { actor: 'buyer', verb: 'hold seats (max 8, 10 min TTL)', consistency: 'strong', latencyP99Ms: 300 },
    { actor: 'buyer', verb: 'confirm booking after payment', consistency: 'strong', latencyP99Ms: 1000 },
    { actor: 'payment-webhook', verb: 'report payment result', consistency: 'strong', latencyP99Ms: 500 },
  ] satisfies UseCase[],
  outOfScope: ['search ranking', 'refunds', 'organiser analytics', 'resale marketplace'],
  scale: { dau: 2_000_000, peakOnSaleUsers: 1_000_000, seatsPerBigEvent: 50_000 },
  availability: { booking: 0.9995, browse: 0.999 },
} as const;`,
        },
      ],
      keyPoints: [
        "3-4 core use-cases; everything else explicitly out of scope.",
        "If you can't name the endpoint for a requirement, it is too vague.",
        "Attach consistency and latency expectations to each use-case, not to 'the system'.",
      ],
    },
    {
      heading: 'Clarifying questions that actually change the architecture',
      body: `**Intuition:** only ask questions whose answer would change a box, a data store, or a protocol. "What language should we use?" changes nothing; "can a group have 100K members?" changes the fan-out strategy.

| Category | High-leverage question | What the answer decides |
|---|---|---|
| Scale | DAU, peak vs average, spikes (on-sale, match day, New Year) | Single node vs partitioned; queue/waiting room |
| Read/write shape | Read:write ratio, object size, hot keys (celebrities, one big event) | Cache + replicas vs write-optimised store; hot-key handling |
| Consistency | Which operations must never be wrong (money, inventory)? What staleness is OK elsewhere? | Transactions/locks vs async replication, per feature |
| Latency | Interactive (p99 < 200ms) or batch (minutes)? Real-time push needed? | Sync vs async; WebSocket/SSE vs polling |
| Data lifecycle | Retention, history, deletes (GDPR), multi-device sync | Storage tiering, TTLs, tombstones |
| Geography | Single region or global? Data residency? | Multi-region replication, conflict handling |
| Clients | Mobile on flaky networks? Third-party API consumers? | Idempotency, retries, pagination, versioning |
| Integrations | External payment/PSP, email, maps? Their SLAs? | Timeouts, async webhooks, reconciliation |

**Technique — propose, don't interrogate:** "I'll assume single region, 10M DAU, 1 KB posts, users tolerate a few seconds of feed staleness, and posting must never lose data. Anything you'd change?" You get the same information in one exchange, and you look like someone who has run production systems.

**Red flag questions** (they signal you're solution-first): "Should we use Kafka?", "Can I use DynamoDB?", "Microservices or monolith?" — these are decisions *you* make and justify later.`,
      keyPoints: [
        "Only ask questions whose answer changes a component.",
        "Bundle assumptions into one proposal and let the interviewer correct it.",
        "Technology choices are your job to justify, not questions to ask.",
      ],
    },
    {
      heading: 'Non-functional requirements as SLOs (not adjectives)',
      body: `**Intuition:** "highly available, low latency, scalable" is what every candidate says. A senior says *which* percentile, *where* it is measured, *over what window*, and *what happens when we miss it*.

**Vocabulary:**
- **SLI** — the measurement: fraction of booking requests returning non-5xx within 300ms, measured at the load balancer.
- **SLO** — the target for the SLI over a window: 99.95% over 30 days.
- **SLA** — the contractual promise with penalties, always looser than the SLO (e.g. 99.9%).
- **Error budget** — 1 − SLO. At 99.95%, you may fail 0.05% of requests (or ~21.6 minutes of full downtime per 30 days). Burn it on deploys and experiments; freeze risky changes when it is gone.

| Availability | Downtime / 30 days | Downtime / year | What it usually requires |
|---|---|---|---|
| 99% | 7.2 h | 3.65 days | Single instance + restarts |
| 99.9% | 43.2 min | 8.76 h | Redundant instances, one AZ OK-ish |
| 99.95% | 21.6 min | 4.38 h | Multi-AZ, automated failover, fast rollback |
| 99.99% | 4.3 min | 52.6 min | Multi-AZ everything, no manual steps in recovery, careful deploys |
| 99.999% | 26 s | 5.3 min | Multi-region active-active, cell architecture — rarely justified |

**The NFR checklist I write on the board:** latency (p50/p99 per key operation), availability (per feature), durability (can we ever lose a confirmed booking? no → synchronous replication/fsync), consistency (per use-case), scale (peak QPS, data growth), RPO/RTO for disaster recovery, security/compliance (PCI, GDPR).

**Why percentiles, not averages:** an average of 50ms can hide a p99 of 2s; users making 20 requests per page view will hit the p99 on most page loads. Always specify p99 (or p99.9 for high-fan-out backends).

**In interviews say this:** "Booking needs 99.95% and strong consistency; browsing can be 99.9% and a few seconds stale, which lets me serve the seat map from cache and keep the booking path small and heavily protected."`,
      code: [
        {
          language: 'yaml',
          title: 'An NFR written as an OpenSLO object — measurable, windowed, owned',
          code: `apiVersion: openslo/v1
kind: SLO
metadata:
  name: booking-hold-availability
  displayName: Seat hold succeeds within 300ms
spec:
  service: booking-api
  description: Non-5xx hold responses under 300ms, measured at the ALB
  budgetingMethod: Occurrences        # count good/total requests
  timeWindow:
    - duration: 30d
      isRolling: true
  indicator:
    metadata:
      name: hold-good-ratio
    spec:
      ratioMetric:
        counter: true
        good:
          metricSource:
            type: Prometheus
            spec:
              query: sum(rate(http_request_duration_seconds_bucket{route="/v1/holds",code!~"5..",le="0.3"}[5m]))
        total:
          metricSource:
            type: Prometheus
            spec:
              query: sum(rate(http_request_duration_seconds_count{route="/v1/holds"}[5m]))
  objectives:
    - displayName: monthly
      target: 0.9995                  # error budget = 0.05% of requests`,
        },
      ],
      keyPoints: [
        "Every NFR needs: metric, percentile, measurement point, window, target.",
        "Different features get different SLOs — that is what lets you simplify the non-critical paths.",
        "Error budget turns availability into an engineering decision (deploy speed vs risk).",
      ],
      source: 'Google SRE Book — Ch 4 Service Level Objectives',
    },
    {
      heading: 'Core entity, read path and write path',
      body: `**Intuition:** almost every design has one entity everyone fights over and two very different paths: the read path (served millions of times, can be cached) and the write path (must be correct, often contended).

**Step 1 — name the core entity and its hot row.**
- Ticketing: **seat per event** (hot during on-sale).
- Hotel reservation: **room_type_inventory(hotel_id, room_type_id, date)** — the row updated by concurrent reservations.
- Digital wallet / payments: **account balance**.
- Feed: **post** is written once, but the **timeline** is the hot read structure.

**Step 2 — state the ratio.** Ticketing browsing is ~1000:1 read:write in steady state; during an on-sale the write path (holds) spikes to tens of thousands of attempts per second on a single event.

**Step 3 — design the paths separately.** The read path optimises for latency and cost (CDN, cache, replicas, denormalised views). The write path optimises for correctness (transaction, conditional update, idempotency, outbox for side effects). Mixing them — e.g. taking a lock just to render the seat map — is the most common design bug.

**In interviews say this:** "The hard part of this system is not throughput on average — it's contention on the seat row during on-sale. I'll keep the read path cache-heavy and eventually consistent, and make the write path a conditional update per seat so that exactly one buyer can win."`,
      diagram: `READ PATH (eventual, cache-heavy)            WRITE PATH (strong, small)
 client                                        client
   │ GET /events/42/seats                        │ POST /holds (Idempotency-Key)
   ▼                                             ▼
  CDN (1-2s TTL) ──miss──► API ──► Redis    waiting room / rate limit
                           │ miss             ▼
                           ▼                 Booking API
                       read replica          │ UPDATE seat ... WHERE status
                                             ▼   = 'AVAILABLE'  (1 winner)
                                          Primary DB ──► outbox ──► Kafka
                                             │                 (email, analytics)
                              replica lag 100ms-1s feeds the read path`,
      code: [
        {
          language: 'sql',
          title: 'The contended row and a single-winner conditional hold',
          code: `CREATE TABLE seat (
  event_id        bigint      NOT NULL,
  seat_id         text        NOT NULL,           -- e.g. 'A-12'
  status          text        NOT NULL DEFAULT 'AVAILABLE'
                  CHECK (status IN ('AVAILABLE', 'HELD', 'BOOKED')),
  hold_id         uuid,
  hold_expires_at timestamptz,
  PRIMARY KEY (event_id, seat_id)
);

-- Hold several seats atomically; expired holds are reclaimable in the same statement.
-- The app checks the returned row count == requested count, else ROLLBACK.
BEGIN;
UPDATE seat
   SET status = 'HELD', hold_id = $3, hold_expires_at = now() + interval '10 minutes'
 WHERE event_id = $1
   AND seat_id = ANY($2::text[])
   AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at < now()))
RETURNING seat_id;
COMMIT;`,
        },
      ],
      keyPoints: [
        "Name the core entity and the specific row that gets contended.",
        "Read path: latency and cost. Write path: correctness and idempotency.",
        "Never pay write-path costs (locks, primary reads) on the read path unless a requirement demands it.",
      ],
    },
    {
      heading: 'API-first thinking: the contract before the boxes',
      body: `**Intuition:** the API is the requirements written in a language machines understand. Designing it first forces decisions about identity, idempotency, pagination and consistency that boxes let you hand-wave.

**What a senior puts in the contract (and says why):**
- **Resource-oriented paths** with the actor from the auth context, never from the body (a buyer cannot hold seats "as" another user).
- **Idempotency-Key** on every non-idempotent POST that a mobile client may retry (holds, payments, orders). The server stores key → result and replays it.
- **Cursor pagination** (opaque cursor + capped limit) for any list that can grow — offset pagination degrades linearly with depth and skips/duplicates items when new rows arrive.
- **Explicit consistency hints**: e.g. the seat map response includes an "asOf" timestamp so clients know it may be stale.
- **Async where the work is slow**: confirm-booking returns 202 + a status resource while payment completes via webhook.
- **Versioning** (/v1 or a header) from day one.

REST vs GraphQL vs gRPC in the interview: choose by consumer. Public/mobile → REST or GraphQL (GraphQL shines for a seat map + event + venue in one round trip); internal service-to-service with tight latency → gRPC. The detailed comparison lives in the API design topics — here the point is to *write* 3-5 endpoints in step 2.`,
      code: [
        {
          language: 'yaml',
          title: 'OpenAPI excerpt: the hold endpoint encodes the NFRs',
          code: `paths:
  /v1/events/{eventId}/holds:
    post:
      summary: Hold up to 8 seats for 10 minutes
      parameters:
        - name: Idempotency-Key            # client-generated UUID, reused on retry
          in: header
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [seatIds]
              properties:
                seatIds: { type: array, maxItems: 8, items: { type: string } }
      responses:
        '201': { description: Hold created (holdId, expiresAt) }
        '409': { description: One or more seats no longer available }
        '422': { description: Idempotency-Key reused with a different body }
        '429': { description: Waiting room / rate limit, see Retry-After }
  /v1/events/{eventId}/seats:
    get:
      summary: Seat map (may be up to 2s stale; see asOf)
      responses:
        '200': { description: Seats + asOf timestamp, Cache-Control max-age=2 }`,
        },
        {
          language: 'graphql',
          title: 'GraphQL variant for the browse path: one round trip, bounded lists',
          code: `type Query {
  event(id: ID!): Event
}

type Event {
  id: ID!
  name: String!
  startsAt: DateTime!
  venue: Venue!
  # Paginated connection — never an unbounded [Seat!]!
  seats(first: Int = 200, after: String, section: String): SeatConnection!
  asOf: DateTime!          # explicit staleness for the eventually consistent read path
}

type SeatConnection {
  edges: [SeatEdge!]!
  pageInfo: PageInfo!
}

type Mutation {
  # Idempotency key is part of the contract, not an afterthought
  holdSeats(eventId: ID!, seatIds: [ID!]!, idempotencyKey: ID!): HoldPayload!
}`,
        },
      ],
      keyPoints: [
        "Write 3-5 endpoints in step 2; they become the checklist for the data model.",
        "Actor comes from the token, not the request body.",
        "Idempotency keys, cursor pagination and explicit staleness are requirements expressed as contract.",
      ],
      source: 'Mastering API Architecture — Ch 1 (REST, pagination, OpenAPI, versioning)',
    },
    {
      heading: 'Choosing the deep dive and articulating trade-offs',
      body: `**Intuition:** the deep dive is where you prove you have operated real systems. Pick the part that is hardest *because of the requirements* and argue it like an RFC, with alternatives and numbers.

**How to pick:** look at your NFRs and ask which one your high-level design satisfies least convincingly.
- Strong consistency under contention → locking/conditional updates, hold expiry, idempotency.
- Huge read fan-out → caching strategy, hot keys, precomputation (fan-out on write vs read).
- Real-time → connection servers, pub/sub fan-out, reconnection.
- Durability of money → ledger, exactly-once effects, reconciliation.

**The trade-off sentence** (use it every time):
> "I'll use **X** because **requirement Y**. It costs **Z**. I mitigate Z with **W**. I'd switch to **alternative A** if **condition V** changes."

Example: "I'll use a Postgres conditional update per seat because holds must have exactly one winner and 50K seats per event fits easily on one primary. It costs primary write throughput during on-sale — maybe 5-10K holds/s. I mitigate with a waiting room that admits buyers at a rate the DB can sustain. If we had 10x larger venues or many simultaneous mega on-sales, I'd move holds to Redis with Lua per-seat set-if-absent and reconcile to Postgres."

| Common tension | Option A | Option B | Decide by |
|---|---|---|---|
| Consistency vs latency | Sync replication / quorum | Async replicas | Can this operation ever be wrong? |
| Precompute vs compute on read | Fan-out on write | Fan-out on read | Read:write ratio, celebrity skew |
| Simplicity vs scale | Single primary | Sharded | Peak write QPS and growth |
| Sync vs async | Inline call | Queue + worker | Latency SLO vs work duration, failure isolation |
| Build vs buy | Self-host Kafka | Managed (MSK, Pub/Sub) | Team size, ops maturity, cost |

**When the interviewer pushes back,** don't defend to the death and don't instantly fold. Restate their concern as a requirement ("so you're worried about the primary being a bottleneck at peak"), quantify it, then either show the number is fine or evolve the design.`,
      keyPoints: [
        "Deep-dive the component that satisfies your NFRs least convincingly.",
        "Always name the alternative and the condition under which you'd switch.",
        "Treat pushback as a new requirement: restate, quantify, adapt.",
      ],
    },
    {
      heading: 'Wrap-up, red flags, and adapting the framework',
      body: `**Intuition:** the last five minutes are your chance to show you think about day-2 operations — the part of the job senior engineers actually get paged for.

**A strong wrap-up covers:**
1. **Next bottleneck at 10x:** "At 10x on-sale traffic the single booking primary is the limit; I'd shard by event_id since holds never span events."
2. **Failure modes:** AZ loss (multi-AZ primary with synchronous standby), hot key (one event → CDN + request coalescing), poison message in the outbox consumer (DLQ), payment provider timeouts (async confirmation + reconciliation job).
3. **Operability:** SLO dashboards for hold success rate and latency, burn-rate alerts, a kill switch for the waiting room.
4. **What you deliberately skipped** and how you'd add it.

**Red flags interviewers write down:**
- Jumping to technology names in minute one ("We'll use Kafka and Cassandra").
- NFRs as adjectives; no numbers anywhere.
- One consistency model for the whole system.
- Drawing 15 boxes with no data flow or API.
- Never checking in; ignoring hints ("interesting — what happens if two users click at the same time?" is a hint).
- Spending the deep dive on something trivial (e.g. load balancer algorithms) while the contended entity is unaddressed.

**Adapting the framework to the interview type:**

| Interview type | Adjustment |
|---|---|
| Product design (Ticketmaster, feed) | Standard 4 steps; heavy on FRs and API |
| Infrastructure design (rate limiter, message queue, metrics) | Users are services; NFRs dominate (throughput, durability, ordering); API is a client library |
| "Improve our existing system" / debugging | Step 1 becomes "what are the symptoms and SLOs being missed?"; measure before redesigning |
| Staff-level / ambiguous org problem | Add migration plan, rollout, team boundaries, cost |`,
      keyPoints: [
        "Wrap-up = 10x bottleneck + failure modes + operability + deliberate omissions.",
        "Hints from the interviewer are requirements in disguise.",
        "Infra designs swap user-facing FRs for throughput/durability/ordering NFRs.",
      ],
    },
    {
      heading: 'Staff-level habits under interview conditions',
      body: `**Intuition:** a senior answer shows you can build the system. A staff answer shows you can be trusted to decide *what* to build, what not to build, and what it will cost the organisation, while the interviewer mostly listens. The same 4-step framework applies. What changes is who drives and where the minutes go (≈40% breadth / 60% depth, versus ≈60/40 for senior and ≈80/20 for mid).

**The habits, and what each sounds like**

| Habit | Sounds like | Why it reads as staff |
|---|---|---|
| Talk as a peer | "Standard read-heavy shape: CDN, cache-aside, replicas. I'll skip explaining those unless you want them." | You don't re-teach load balancers to someone who has run them |
| Name the crux, skip the CRUD | "Profile and settings endpoints are boilerplate. The crux is the 50K holds/s on one event row." | Earmarks the hard part in minute 5 and returns to it |
| Cut complexity | "Let me check whether we need sharding at all: 2K writes/s fits one Postgres primary with headroom." | Simplest design that meets the numbers; complexity must be earned |
| Bring related experience | "On our payments ledger the outbox relay lagged under vacuum pressure, so I'd monitor relay lag here too." | Transfers real lessons to an unfamiliar problem |
| Decide, don't list | "Kafka, because we need replay for the backfill. If ordering per tenant weren't needed, SQS would be cheaper." | A decision + the condition that would flip it |
| Propose scope yourself | "I'll take ingest, fan-out and delivery guarantees; templates and analytics are out unless you object." | The interviewer only has to nod, not steer |
| Raise org concerns unprompted | migration from today's system, which team owns the queue, cost per million messages, the on-call story | Influence beyond your own service is the staff job |
| Choose your battles | Accept the company's existing stack choice unless it breaks a requirement | Spends time on what changes the outcome |

**How down-levelling actually happens** (the write-up says "solid senior" rather than "staff"):
- The interviewer had to pick every deep dive. Steering is the clearest mid/senior signal.
- Menus without decisions: three options, pros and cons, then "what do you prefer?"
- Over-explaining fundamentals, which reads as recently learned rather than lived.
- Building the scaled version first (sharding, multi-region, Kafka) before showing it is needed.
- Correct mechanics but no migration path, cost or ops: a design that only works on a green field.
- No insight the interviewer didn't already have. Staff bars often expect you to teach them one thing.

**In interviews, say this:** "Here's the scope I propose, here's the one hard problem, here's my decision and what would change it, and here's how we'd get there from what you run today."`,
      keyPoints: [
        'Staff ≈ 40% breadth / 60% depth: the candidate drives and the interviewer only focuses.',
        'Decision + flip condition beats a menu of options every time.',
        'Earn complexity: show the simple design fails the numbers before adding shards or queues.',
        'Raise migration, ownership, cost and on-call without being prompted.',
      ],
      source: 'Hello Interview — "Staff-level system design" blog; Hello Interview problem breakdowns (level expectations)',
    },
    {
      heading: 'Round formats & whiteboarding',
      body: `**Intuition:** the design is graded on reasoning, not drawing. But the *format* of the round changes how you show that reasoning, so ask your recruiter which one you'll get and rehearse in it.

**Shared diagram tools (most common).** Excalidraw, Whimsical, Google Drawings, Miro, or a company's in-house pad. Polish does not matter: boxes, arrows and labels are enough. What helps:
- Draw left-to-right in request order (client → edge → service → store), with **numbered arrows** for the write path and a different colour or dashed line for the read path.
- Keep a small text box for **requirements and numbers** in a corner and point back to it when you justify decisions.
- Practise the tool beforehand. Fighting the arrow tool for 3 minutes is pure loss.

**Verbal-only rounds (no diagram).** Some screens and full loops (some Amazon and Netflix candidates report this) are a voice or video call with no drawing tool:
- Announce the structure: "Five components, I'll name them once, then walk the write path, then the read path."
- **Number the components** and refer to them by number and name.
- Recap every ~5 minutes in one sentence, and check in more often, since the interviewer can't glance at a board.
- Keep a paper sketch for yourself if allowed. It organises *your* thinking.

**Multi-part rounds (Stripe-style, also some AI labs).** One problem, 3–5 sequential parts, often in a coding environment where part N+1 unlocks only when part N works:
- **Ship v1 fast and simple.** The grader needs v1 to pass before you see v2, and an over-designed v1 burns the time later parts need.
- Keep seams cheap to extend (a clean interface, an id on every record, injected clock) rather than prebuilding features.
- Expect later parts to add retries, idempotency, ordering, multi-tenancy or persistence. Mention where you would extend, then move on.

**Cost & operations wrap-up checklist** (now an explicit criterion at many companies; raise it before you are asked):
1. **Dominant cost line:** egress, GPUs, storage or compute, with a rough monthly number.
2. **Cost levers:** reserved vs spot/preemptible, cache vs recompute, tiered storage, serverless only for spiky low-volume paths.
3. **SLOs and alerts:** one or two SLIs per critical path, burn-rate alerting.
4. **Failure drills:** what pages someone, the runbook's first step, the blast radius per cell or region.
5. **Rollout and migration:** shadow traffic, dual writes or backfill, kill switch.
6. **Deferred work:** what you'd do with another hour and what you deliberately left out.`,
      diagram: `Multi-part round (60 min) — each part unlocks the next
 ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
 │ Part 1  │──▶│ Part 2  │──▶│ Part 3  │──▶│ Part 4  │
 │ core v1 │   │ retries │   │ ordering│   │ tenants │
 │ ~12 min │   │ ~15 min │   │ ~15 min │   │ ~15 min │
 └─────────┘   └─────────┘   └─────────┘   └─────────┘
  ship simple   extend via     same seams    stretch:
  + clean seams the seam       no rewrite    talk if short`,
      keyPoints: [
        'Diagram polish is irrelevant; numbered arrows and a numbers box help.',
        'Verbal-only: announce structure, number components, recap every ~5 minutes.',
        'Multi-part: ship v1 fast because later parts are gated on it working.',
        'Wrap-up: dominant cost, levers, SLOs, drills, rollout, deferred work.',
      ],
      source: 'Aced.io — "How to nail the system design interview" (2026 guide); Hello Interview staff-level guide',
    },
  ],
  codeChallenges: [
    {
      id: 'fund-requirements-cc-1',
      title: 'Turn implied requirements into an API contract that survives retries and growth',
      context: `Product said: "Mobile users on flaky networks create orders; order history must load fast even for power users with 50K orders; users must never be charged twice." A teammate shipped the controller below. It passed QA on Wi-Fi with 10 orders per user. The requirements were never written as NFRs, so none of them made it into the code.`,
      task: `Rewrite the controller so the stated (and implied) requirements are enforced by the contract: safe retries, bounded and stable pagination, correct identity, and a payment call that cannot hang the request or double-charge. Keep it NestJS + pg.`,
      starter: {
        language: 'typescript',
        title: 'orders.controller.ts (naive)',
        code: `@Controller('orders')
export class OrdersController {
  constructor(private readonly db: Pool, private readonly payments: PaymentsClient) {}

  @Post()
  async create(@Body() body: { userId: string; amountCents: number }) {
    // Client retries on timeout -> a second row and a second charge
    const { rows } = await this.db.query(
      'INSERT INTO orders (user_id, amount_cents, status) VALUES ($1, $2, $3) RETURNING *',
      [body.userId, body.amountCents, 'PENDING'],
    );
    await this.payments.charge(body.userId, body.amountCents); // no timeout, no idempotency
    await this.db.query('UPDATE orders SET status = $1 WHERE id = $2', ['PAID', rows[0].id]);
    return rows[0];
  }

  @Get()
  async list(
    @Query('userId') userId: string,
    @Query('page') page = 1,
    @Query('size') size = 20,
  ) {
    const { rows } = await this.db.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2 LIMIT $3',
      [userId, (page - 1) * size, size],
    );
    return rows;
  }
}`,
      },
      hints: [
        'Where should the user identity come from, and what stops user A listing user B\'s orders?',
        'A retry after the server committed but the response was lost looks identical to a new request — unless the client sends something stable. What do you store, and what unique constraint enforces it?',
        'OFFSET 49,980 still scans 49,980 index entries, and new orders shift pages. What do you order by so the cursor is unique and stable?',
      ],
      solution: {
        language: 'typescript',
        title: 'orders.controller.ts (requirements enforced by the contract)',
        code: `// Migration: ALTER TABLE orders ADD COLUMN idempotency_key uuid NOT NULL, ADD COLUMN request_hash text NOT NULL;
// CREATE UNIQUE INDEX orders_idem ON orders (user_id, idempotency_key);
// CREATE INDEX orders_user_created ON orders (user_id, created_at DESC, id DESC);
const MAX_PAGE = 100;

@Controller('v1/orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly db: Pool, private readonly payments: PaymentsClient) {}

  @Post()
  async create(
    @CurrentUser() user: { id: string },                       // identity from the token
    @Headers('idempotency-key') idemKey: string,
    @Body() body: CreateOrderDto,                              // validated: amountCents int > 0
  ) {
    if (!isUUID(idemKey)) throw new BadRequestException('Idempotency-Key (uuid) required');
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');

    // Insert-or-find in one statement; the unique index is the real guarantee.
    const inserted = await this.db.query(
      'INSERT INTO orders (user_id, amount_cents, status, idempotency_key, request_hash) ' +
        "VALUES ($1, $2, 'PENDING', $3, $4) ON CONFLICT (user_id, idempotency_key) DO NOTHING " +
        'RETURNING id, status, amount_cents, created_at',
      [user.id, body.amountCents, idemKey, hash],
    );
    if (inserted.rowCount === 0) {
      const { rows } = await this.db.query(
        'SELECT id, status, amount_cents, created_at, request_hash FROM orders WHERE user_id = $1 AND idempotency_key = $2',
        [user.id, idemKey],
      );
      if (rows[0].request_hash !== hash) throw new UnprocessableEntityException('Idempotency-Key reused with different body');
      const { request_hash, ...existing } = rows[0];
      return existing;                                          // replay: no second charge
    }
    const order = inserted.rows[0];
    // Provider-side idempotency keyed by our order id + a hard deadline.
    const result = await this.payments.charge(
      { orderId: order.id, amountCents: order.amount_cents },
      { idempotencyKey: order.id, signal: AbortSignal.timeout(3000) },
    ).catch(() => ({ status: 'UNKNOWN' as const }));            // reconciled later by webhook/job
    const status = result.status === 'SUCCEEDED' ? 'PAID' : result.status === 'FAILED' ? 'FAILED' : 'PENDING';
    await this.db.query('UPDATE orders SET status = $1 WHERE id = $2 AND status = $3', [status, order.id, 'PENDING']);
    return { ...order, status };
  }

  @Get()
  async list(@CurrentUser() user: { id: string }, @Query('limit') limitRaw?: string, @Query('cursor') cursor?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), MAX_PAGE);   // cap page size
    const after = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) : null;
    const { rows } = await this.db.query(
      'SELECT id, status, amount_cents, created_at FROM orders WHERE user_id = $1 ' +
        'AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid)) ' +
        'ORDER BY created_at DESC, id DESC LIMIT $4',
      [user.id, after?.createdAt ?? null, after?.id ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit
      ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString('base64url')
      : null;
    return { items: page, nextCursor };
  }
}`,
      },
      explanation: `**Fixes, each mapped to a requirement:**
- **Identity from the auth context** (guard + CurrentUser) instead of userId in body/query — the old code let any caller create or list orders for any user (broken object-level authorization).
- **Idempotency-Key + unique index (user_id, idempotency_key)** — "never charged twice" under retries. INSERT … ON CONFLICT DO NOTHING is race-free even for two concurrent retries; the request hash detects key reuse with a different body (422).
- **Provider idempotency keyed by order id** — if our process crashes between charge and UPDATE, a replay or reconciliation job re-sends the same key and the PSP returns the original charge.
- **Hard deadline (AbortSignal.timeout)** — a hung PSP cannot pin request handlers; an unknown outcome stays PENDING and is settled asynchronously (webhook/reconciliation) rather than guessed.
- **Guarded status transition** (WHERE status = 'PENDING') so a late webhook and this path cannot flip a terminal state.
- **Keyset (cursor) pagination on (created_at, id)** with a composite index — constant cost at any depth and no skipped/duplicated rows when new orders arrive; the tie-breaker id makes the order total.
- **Capped limit** and explicit columns instead of SELECT * — bounded response size is an NFR too.
- **Versioned route** (/v1) so the contract can evolve.`,
      followUps: [
        {
          "q": "Your process crashes after the PSP charge succeeds but before the UPDATE. The order sits in PENDING. Who fixes it, and how?",
          "a": "A reconciliation path. First, the PSP's webhook (charge.succeeded with our order ID as metadata) updates the order via the same guarded transition `WHERE status = 'PENDING'`. Second, a sweeper job finds orders PENDING longer than a few minutes and queries the PSP by idempotency key; because we passed `order.id` as the key, a retried charge returns the original result rather than charging again. The client sees 'processing' until then. Alert on the count of stale PENDING orders."
        },
        {
          "q": "Idempotency keys accumulate forever in the orders table. Is that a problem, and what retention would you choose?",
          "a": "Here the key lives on the order row itself, so it costs one UUID column plus the unique index, which is fine for the order's lifetime. The guarantee only needs to cover the retry window: mobile clients retry for minutes or hours, not months. If keys lived in a separate table, you'd expire them after ~24–72 hours (Stripe keeps keys for 24 h). After expiry a reused key would create a new order, so document the window in the API contract."
        }
      ],
    },
    {
      id: 'fund-requirements-cc-2',
      title: 'Meet a p99 < 200ms NFR with a latency budget instead of hope',
      context: `The event page must render with **p99 < 200ms at the load balancer**. The event details and seat map are critical (no page without them); reviews and personalised recommendations are nice-to-have. Measured downstream p99s: catalog 40ms, inventory 80ms, reviews 120ms, recs 150ms. The current handler's p99 is ~390ms and it returns 500 whenever the recommendation service is slow or down.`,
      task: `Refactor the aggregator so it respects the NFR: an end-to-end deadline, critical vs optional dependencies, graceful degradation, and cancellation of work nobody will use. Do not change the downstream services.`,
      starter: {
        language: 'typescript',
        title: 'event-page.service.ts (naive)',
        code: `@Injectable()
export class EventPageService {
  constructor(
    private readonly catalog: CatalogClient,
    private readonly inventory: InventoryClient,
    private readonly reviews: ReviewsClient,
    private readonly recs: RecsClient,
  ) {}

  async getEventPage(eventId: string, userId: string) {
    const event = await this.catalog.getEvent(eventId);      // p99 40ms
    const seatMap = await this.inventory.getSeatMap(eventId); // p99 80ms
    const reviews = await this.reviews.getTop(eventId);       // p99 120ms, optional
    const recs = await this.recs.forUser(userId);             // p99 150ms, optional
    return { event, seatMap, reviews, recs };
  }
}`,
      },
      hints: [
        'Sequential awaits add latencies; which of these calls actually depend on each other?',
        'An optional dependency should never be able to fail or slow the page — what is its maximum allowed time, given the overall budget?',
        'If a critical call fails early, what happens to the optional calls still in flight? Who cancels them?',
      ],
      solution: {
        language: 'typescript',
        title: 'event-page.service.ts (budgeted, degradable)',
        code: `const PAGE_BUDGET_MS = 170;     // 200ms SLO minus ~30ms for LB, TLS, serialization
const OPTIONAL_BUDGET_MS = 90;  // optional parts must never be the reason we miss the SLO

@Injectable()
export class EventPageService {
  constructor(
    private readonly catalog: CatalogClient,
    private readonly inventory: InventoryClient,
    private readonly reviews: ReviewsClient,
    private readonly recs: RecsClient,
  ) {}

  async getEventPage(eventId: string, userId: string, clientSignal: AbortSignal) {
    const cancelAll = new AbortController();                   // lets us kill stragglers
    const deadline = AbortSignal.any([clientSignal, cancelAll.signal, AbortSignal.timeout(PAGE_BUDGET_MS)]);
    const optionalDeadline = AbortSignal.any([deadline, AbortSignal.timeout(OPTIONAL_BUDGET_MS)]);

    // All four calls are independent -> start them together.
    const critical = Promise.all([
      this.catalog.getEvent(eventId, { signal: deadline }),
      this.inventory.getSeatMap(eventId, { signal: deadline }),
    ]);
    const optional = Promise.allSettled([
      this.reviews.getTop(eventId, { signal: optionalDeadline }),
      this.recs.forUser(userId, { signal: optionalDeadline }),
    ]);

    try {
      const [[event, seatMap], [reviews, recs]] = await Promise.all([critical, optional]);
      const degraded: string[] = [];
      if (reviews.status === 'rejected') degraded.push('reviews');
      if (recs.status === 'rejected') degraded.push('recs');
      return {
        event,
        seatMap,                                              // carries asOf (eventually consistent)
        reviews: reviews.status === 'fulfilled' ? reviews.value : null,
        recs: recs.status === 'fulfilled' ? recs.value : null,
        degraded,                                             // client hides widgets; metric per value
      };
    } catch (err) {
      cancelAll.abort();                                      // critical failed: stop optional work now
      throw new ServiceUnavailableException('event page unavailable', { cause: err });
    }
  }
}`,
      },
      explanation: `**What changed and why:**
- **Parallel fan-out:** the four calls are independent, so latency becomes max(critical) instead of the sum (≈ 80ms p99 on the critical path instead of ~390ms).
- **Explicit budget:** 200ms SLO at the LB minus ~30ms for network/TLS/serialisation → 170ms for the handler. AbortSignal.timeout enforces it; AbortSignal.any combines client disconnect, our own cancel, and the deadline (Node 20.3+).
- **Critical vs optional:** only catalog + seat map can fail the request. Reviews and recs are wrapped in allSettled with a tighter 90ms budget, so a slow or dead recs service degrades the page instead of breaking it — that is the requirement "nice-to-have" expressed in code.
- **Cancellation:** if a critical call fails, cancelAll aborts optional requests so we stop spending downstream capacity on a response we will not send.
- **Observable degradation:** the degraded array lets the client hide widgets and lets you emit a metric, so "partial page rate" can have its own SLO.
- Note the remaining tail risk: with parallel calls, the page p99 is driven by the slowest critical dependency's tail; if inventory p99 creeps up, the next steps are caching the seat map (it is allowed to be ~2s stale) or hedged requests — not a bigger timeout.`,
      followUps: [
        {
          "q": "The page is served to 10K RPS and recs is down entirely. Every request still waits 90 ms for recs to time out. How do you stop paying that cost?",
          "a": "Add a circuit breaker around the recs client: after the error rate over a short window exceeds a threshold, open the circuit and fail fast (return null immediately) for a cool-down period, then let a few probe requests through (half-open) to detect recovery. The page drops from the 90 ms optional wait to the critical path's ~80 ms, and you stop sending 10K RPS to a service trying to recover. Emit the breaker state as a metric so 'recs degraded' is visible."
        },
        {
          "q": "How would you test that this handler really meets p99 < 200 ms and degrades correctly?",
          "a": "Unit tests with fake clients that resolve after controlled delays or reject: assert recs at 500 ms yields `recs: null` and `degraded: ['recs']` within ~90 ms; a failing inventory gives 503 and aborts the optional signals. Use fake timers for determinism. Then a load test with fault injection (e.g. toxiproxy adding latency to reviews) at production RPS, measuring p99 at the LB. In production, track partial-page rate and p99 per dependency to catch regressions."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'fund-requirements-iq-01',
      difficulty: 'hard',
      question: 'The prompt is just "Design Twitter." Walk me through your first five minutes — exactly what you ask, what you assume, and what you write on the board before drawing anything.',
      whatInterviewerLooksFor: [
        'Scopes to 3-4 core use-cases and states what is out of scope',
        'Proposes numbers instead of asking open questions',
        'Identifies the architecture-changing questions (read:write ratio, celebrity fan-out, feed staleness)',
        'Attaches measurable NFRs per feature',
        'Keeps it to ~5 minutes and asks for confirmation',
      ],
      modelAnswer: `### 1. Scope by proposal (≈2 min)
"I'll focus on: **post a tweet** (text + media URL), **follow** a user, and **read the home timeline**. Out of scope unless you want them: search, DMs, trends, ads, notifications. OK?"

### 2. Scale assumptions (≈1 min)
"I'll assume **200M DAU**, each reads the timeline ~10 times/day and ~10% post once a day. Average user follows ~200 accounts; some accounts have **100M followers**."
- Timeline reads ≈ 200M × 10 / 10^5 ≈ **20K QPS avg, ~60K peak**.
- Writes ≈ 20M / 10^5 ≈ **200 tweets/s avg, ~1K peak**.
- So it is **~100:1 read-heavy**, and the write amplification of fan-out is the real cost: 200 tweets/s × 200 followers = 40K timeline inserts/s, but one celebrity tweet = 100M inserts.

### 3. NFRs (≈1 min)
| Feature | Latency | Availability | Consistency |
|---|---|---|---|
| Read timeline | p99 < 200ms | 99.95% | Eventual, a few seconds OK; read-your-own-tweets |
| Post tweet | p99 < 500ms | 99.95% | Durable once acknowledged |
| Follow | p99 < 300ms | 99.9% | Eventual for timeline effect |

### 4. What I write on the board
FR list, out-of-scope list, the four numbers above, and "**hard parts: fan-out for celebrities, timeline cache**". This tells the interviewer where my deep dive will go.

### 5. Check-in
"That gives me a read-heavy system where precomputed timelines make sense for most users and fan-out-on-read for celebrities. Does that match what you want me to focus on?"

Total ≈ 5 minutes; no technology names yet.`,
      followUps: [
        { q: 'The interviewer says "assume 1B DAU instead." What changes?', a: 'Reads ≈ 100K QPS avg / 300K peak and timeline cache memory grows 5x; the architecture shape (hybrid fan-out, cached timelines) stays, but I would partition timeline cache by user id across many more Redis shards and push harder on keeping only ~800 tweet ids per timeline.' },
        { q: 'Why not ask "should I use push or pull for the feed?"', a: 'That is a design decision I am being evaluated on. I ask about the inputs (follower distribution, staleness tolerance) and then make and justify the choice.' },
        { q: 'What if the interviewer refuses to give numbers?', a: 'Pick reasonable ones, state them, and design so the conclusion is robust across an order of magnitude — e.g. "at 20K or 200K QPS reads we still need a cache; only the shard count changes."' },
      ],
      pitfalls: [
        'Listing 12 features and trying to design all of them',
        'Spending 15 minutes on estimation with precise arithmetic',
        'Saying "highly available and scalable" without numbers or per-feature targets',
        'Naming Kafka/Cassandra before any requirement justifies them',
      ],
    },
    {
      id: 'fund-requirements-iq-02',
      difficulty: 'expert',
      question: 'Halfway through, the interviewer says: "This must be strongly consistent and highly available — no compromises." How do you respond without either caving or arguing?',
      context: 'You are designing an e-commerce checkout with product catalog, cart, inventory and orders.',
      whatInterviewerLooksFor: [
        'Recognises the CAP/PACELC tension without lecturing',
        'Decomposes consistency per operation',
        'Translates "strong" and "highly available" into measurable targets',
        'Proposes a design that gives strong guarantees exactly where money/inventory is at stake',
        'Stays collaborative — treats it as a requirements negotiation',
      ],
      modelAnswer: `### Restate and decompose
"Totally fair — let me make sure I put strong consistency where it matters. Can I check which operations must never be wrong?"

| Operation | Consequence of staleness | Proposed guarantee |
|---|---|---|
| Browse catalog / price display | Shows old price for seconds | Eventual (cache/CDN), but **price re-validated at checkout** |
| Cart | User sees an item they removed | Read-your-writes (session-sticky reads or primary reads for own cart) |
| Inventory decrement | Oversell | **Strong**: conditional update / reservation in one primary per SKU partition |
| Order + payment | Double charge / lost order | **Strong + idempotent**, durable (sync replica in another AZ) |

### Quantify "highly available"
"For checkout I'd target **99.95%** (≈21.6 min/month) with multi-AZ: a synchronous standby in a second AZ so we lose no committed orders (RPO = 0) and automatic failover in < 60s (RTO). Browse can be 99.99% because it's served from cache even if the DB is down."

### Name the real trade-off
During a network partition between AZs, the checkout path chooses **consistency**: it rejects writes rather than risk oversell — that's a small, bounded availability cost. Even with no partition, synchronous replication costs latency (~1-2ms intra-region per commit), which PACELC captures. Catalog chooses **availability** and serves stale data.

### Close the loop
"So: strong where money and stock move, eventual where users only look, and a precise availability number for each. If the business truly needs strong consistency *across regions* for inventory, we'd pay ~70-150ms per write for cross-region consensus (e.g. Spanner/CockroachDB) — I'd only do that if single-region failure isn't acceptable for checkout."

This turns an impossible absolute into a design with explicit, defensible guarantees.`,
      followUps: [
        { q: 'Why not just use a globally consistent database for everything?', a: 'Every write pays cross-region consensus latency (tens to 100+ ms) and cost, and read paths lose cheap caching. You spend that budget where oversell or double-charge is the risk, not on catalog views.' },
        { q: 'How do you give read-your-writes for the cart without reading the primary always?', a: 'Route the user\'s reads to the primary for a short window after a write (e.g. store last-write LSN/timestamp in the session and read from a replica only if it has caught up), or keep the cart in a single-leader KV keyed by user.' },
        { q: 'What does "strong" mean precisely for inventory?', a: 'Linearizable decrement per SKU: two concurrent checkouts for the last unit cannot both succeed. A conditional UPDATE ... WHERE stock >= qty on a single leader provides that.' },
      ],
      pitfalls: [
        'Agreeing and designing everything with distributed transactions',
        'Lecturing "CAP says you can\'t" without offering a design',
        'Treating consistency as one global setting',
        'Not converting "highly available" into a number and RPO/RTO',
      ],
    },
    {
      id: 'fund-requirements-iq-03',
      difficulty: 'hard',
      question: 'You have 45 minutes to design a URL shortener. You\'re 30 minutes in, still discussing hash collisions, and the interviewer asks about analytics. How should you have planned the time, and how do you recover now?',
      whatInterviewerLooksFor: [
        'Knows a time budget for each framework step',
        'Recognises they over-invested in one sub-problem',
        'Follows the interviewer\'s lead gracefully (analytics is a hint)',
        'Can compress remaining content and still wrap up',
      ],
      modelAnswer: `### The plan I should have announced at minute 0
| Minutes | Step |
|---|---|
| 0-5 | FRs (create short URL, redirect, optional custom alias, expiry), NFRs (redirect p99 < 50ms at edge, 99.99% for redirect, 100:1 read-heavy), rough scale |
| 5-15 | API (POST /v1/urls, GET /{code} → 301/302), data model, high-level: key generation service, KV store, cache/CDN on redirect path; **buy-in** |
| 15-35 | Deep dive on 1-2 items: key generation (base62 counter ranges vs hash + collision check) **and** the redirect hot path (cache, 301 vs 302) |
| 35-42 | Analytics / anything the interviewer wants |
| 42-45 | Wrap-up |

### Why I got stuck
Collision handling is a 5-minute topic: "base62 of a counter allocated in ranges per app server (e.g. 1M-id blocks from a coordinator) has no collisions; if we hash, 7 base62 chars ≈ 3.5 trillion keys and we insert with a conditional put and retry on conflict." Going beyond that has diminishing signal.

### Recovering now
1. **Close the thread in one sentence:** "To wrap collisions: range-allocated counters, no collision checks needed; I'll move on."
2. **Treat the analytics question as a requirement change** — that's a hint about where they want depth. "Redirects should stay fast, so analytics must be off the hot path: the redirect service emits a click event (code, ts, country, referrer) to Kafka asynchronously; a stream job aggregates per code per minute into an OLAP store (ClickHouse/Druid). That's why I'd use **302** if analytics must count every click — 301s are cached by browsers and we'd lose them."
3. **Reserve the last 3 minutes** for wrap-up: hot links (CDN + cache), abuse (rate-limit creation), failure of the analytics pipeline doesn't affect redirects.

### Lesson
Announce the time plan, check in at step boundaries, and when the interviewer asks about something new, that is usually the rubric item they still need to score.`,
      followUps: [
        { q: 'How do you notice you\'re going too deep in the moment?', a: 'Check the clock at each step boundary and ask "Is this level of detail useful, or should I move on to X?" If the interviewer hasn\'t asked a question in 5 minutes, you are probably monologuing.' },
        { q: '301 vs 302 — which requirement decides?', a: '301 reduces load (browsers cache) but hides repeat clicks from analytics and makes link retargeting/expiry harder; 302 keeps every click visible and controllable. Analytics or mutable links → 302.' },
      ],
      pitfalls: [
        'Refusing to leave the current sub-problem ("just one more thing")',
        'Answering analytics by adding synchronous DB writes on the redirect path',
        'Skipping the wrap-up entirely due to time',
      ],
    },
    {
      id: 'fund-requirements-iq-04',
      difficulty: 'expert',
      question: 'The PRD says "99.95% availability and p99 under 200ms." Translate that into concrete architecture and process decisions. What does each number force you to build?',
      whatInterviewerLooksFor: [
        'Converts nines into minutes of budget and uses it to reason about deploys and failover',
        'Knows where latency is measured and allocates a per-hop budget',
        'Links availability to redundancy, failover time, and change management',
        'Mentions error budgets and burn-rate alerting',
      ],
      modelAnswer: `### 99.95% → 21.6 minutes per 30 days (or 0.05% of requests)
- **No single-AZ anything on the critical path.** One AZ outage (hours) would burn several months of budget. So: ≥ 3 app replicas across 3 AZs, DB primary with **automatic failover** to a standby in another AZ (failover 30-60s ≈ 2-5% of the monthly budget per event).
- **Deploys must be nearly free:** rolling/canary with automatic rollback on SLO burn. A bad deploy that errors 100% for 10 minutes burns ~46% of the budget; the same bug caught by a 5% canary in 2 minutes burns < 1%.
- **Dependencies:** if checkout calls 4 services each at 99.95% serially, the composite is ≈ 99.8% — so either make them more available, make some calls async/optional, or accept a lower target. The math forces graceful degradation.
- **Process:** SLO dashboards, multi-window burn-rate alerts (e.g. page at 14.4x burn over 1h), and an error-budget policy (freeze feature launches when budget is exhausted).

### p99 < 200ms → a latency budget
First define *where*: at the load balancer (server-side), because client network is out of our control. Then allocate:

| Hop | p99 budget |
|---|---|
| LB + gateway + auth (local JWT verify) | 15ms |
| Service logic + serialisation | 20ms |
| Cache lookups | 5ms |
| DB (max 2 sequential indexed queries) | 60ms |
| Parallel fan-out to downstreams | 70ms |
| Headroom (GC pauses, retries) | 30ms |

This forces: **no sequential chains of remote calls**, per-call timeouts smaller than the remaining budget, indexed queries only, connection pooling (no TCP/TLS handshake per request), and caching for anything read-heavy. Anything slower (PDF generation, emails) goes **async** behind a queue.

### What I'd also say
Percentiles don't add — the sum of hop p99s is a conservative bound — and with fan-out the tail of each dependency dominates, so I'd monitor p99.9 on downstreams.`,
      followUps: [
        { q: 'Why is 99.99% dramatically more expensive than 99.95%?', a: '4.3 minutes/month leaves no room for human-in-the-loop recovery: failover, rollback and scaling must all be automatic and fast, and a single 5-minute incident exceeds the budget. It often implies multi-region or cell-based design.' },
        { q: 'Would you measure availability by time or by requests?', a: 'Request-based (good/total) for a high-traffic API — it weights incidents by impact and handles partial outages naturally. Time-based is simpler for low-traffic or binary systems.' },
        { q: 'How does a retry policy interact with the latency budget?', a: 'A retry only helps if there\'s budget left; set per-attempt timeouts (e.g. 60ms) so one retry fits, add jitter, and cap retries with a retry budget so a slow dependency isn\'t amplified into an outage.' },
      ],
      pitfalls: [
        'Not converting nines into minutes/requests',
        'Measuring latency at the client and budgeting for the mobile network',
        'Ignoring serial dependency composition',
        'Adding retries without a budget, which worsens tail latency',
      ],
    },
    {
      id: 'fund-requirements-iq-05',
      difficulty: 'hard',
      question: 'Design a movie/event ticket booking system (BookMyShow/Ticketmaster). Before any boxes: what is the core entity, where is the contention, and how do the read and write paths differ?',
      whatInterviewerLooksFor: [
        'Identifies seat-per-show as the contended entity',
        'Separates the browse path (eventual, cached) from the hold/confirm path (strong)',
        'Recognises flash-crowd on-sales as the dominant requirement',
        'Mentions holds with expiry and idempotent confirmation',
      ],
      modelAnswer: `### Core entities
Event/Show → Venue → **Seat(show_id, seat_id, status, hold_id, hold_expires_at)** → Booking → Payment. The seat row is the entity everyone fights over; exactly one buyer may win it.

### Read path (≈99% of traffic)
- Event listing, show times, seat map.
- Can be **seconds stale**: showing a seat as available that was just taken costs a 409 on hold, not money.
- Serve from CDN/Redis with 1-2s TTL and request coalescing; the seat map for a hot show is one key read by 100K+ clients, so it must not hit the DB per request.

### Write path (small but critical)
1. **Hold:** conditional update per seat — WHERE status = 'AVAILABLE' OR hold expired — in one transaction for up to 8 seats; row count mismatch → rollback → 409. Idempotency-Key on the request.
2. **Pay:** redirect to PSP with our booking id as the idempotency key; hold TTL (10 min) covers payment time.
3. **Confirm:** PSP webhook sets status BOOKED only if hold_id still matches and hold not expired (else refund path). Idempotent on webhook event id.
4. Side effects (ticket email, analytics) via transactional outbox → queue.

### Contention numbers
Normal: a few bookings/s — trivial. On-sale: 1M users × several attempts in 5 minutes on 50K seats ≈ **10-30K hold attempts/s on one show**, ~20 buyers per seat. A single Postgres primary can do a few thousand such transactions/s on hot rows, so we add a **virtual waiting room** that admits users at a sustainable rate (and gives fairness), plus per-user rate limits.

### Why this framing matters
It tells the interviewer my deep dive will be holds/expiry/waiting room — not load-balancer algorithms.`,
      followUps: [
        { q: 'Why not lock seats with SELECT ... FOR UPDATE while the user pays?', a: 'Holding DB locks for minutes across a user interaction exhausts connections and blocks others; a status column with an expiry is a logical lock that costs nothing while idle.' },
        { q: 'How do expired holds get released?', a: 'Lazily — the hold query treats expired HELD rows as available — plus a periodic sweeper for accurate seat maps. No timer per hold needed.' },
        { q: 'Would you move holds to Redis?', a: 'Only if the DB can\'t sustain the admitted rate: a Lua script doing per-seat SET NX with TTL across the requested seats gives ~50-100K ops/s per shard, but then Postgres becomes the system of record at confirm time and you need reconciliation.' },
      ],
      pitfalls: [
        'Treating booking as a generic CRUD write with no contention analysis',
        'Making the seat map strongly consistent and reading the primary for it',
        'Forgetting hold expiry or webhook idempotency',
      ],
    },
    {
      id: 'fund-requirements-iq-06',
      difficulty: 'expert',
      question: 'Sketch the API for a ride-hailing app\'s rider and driver flows in step 2. Which decisions do you bake into the contract, and why do they matter before you draw a single box?',
      whatInterviewerLooksFor: [
        'Chooses transport per interaction (REST for commands, push channel for matching/trip updates, high-frequency location ingestion)',
        'Idempotency on ride requests; actor from token',
        'State machine thinking for the trip resource',
        'Rate and payload of driver location updates drive capacity',
      ],
      modelAnswer: `### Rider
- **POST /v1/rides** with Idempotency-Key — body: pickup, dropoff, product. Returns 202 + ride id in state REQUESTED. A rider tapping twice on a flaky connection must not summon two cars.
- **GET /v1/rides/{id}** — state machine: REQUESTED → MATCHED → DRIVER_ARRIVING → IN_PROGRESS → COMPLETED / CANCELLED. Transitions are server-owned; clients can only request CANCEL, answered with 409 if illegal.
- **Real-time updates** (match found, driver location every few seconds) over a WebSocket/SSE or push channel — polling GET at 1/s from millions of riders is wasteful.

### Driver
- **Location ingestion:** a lightweight endpoint or persistent connection receiving lat/lng every ~4s. With 1M online drivers that is **~250K updates/s** — this single contract decision drives the biggest capacity component (in-memory geo index, not a relational DB write per update). Payload kept tiny (driver id from connection auth, lat, lng, heading, ts).
- **POST /v1/offers/{offerId}/accept** — idempotent and conditional: only the first accepting driver wins; others get 409.

### Cross-cutting decisions in the contract
- **Identity from token** (rider vs driver scopes) — never trust a driverId in the body.
- **Timestamps + sequence numbers** on location updates so out-of-order packets are dropped.
- **Cursor pagination** on trip history.
- **Versioning** (/v1) because mobile clients live for years.
- **Explicit async semantics** (202 + status resource) because matching can take seconds.

### Why before boxes
The API reveals the three subsystems (command API, real-time push, high-rate location ingest) and their very different NFRs — the boxes then follow almost mechanically.`,
      followUps: [
        { q: 'Why 202 instead of 201 for ride requests?', a: 'The ride isn\'t "created" in a meaningful sense until matching succeeds; 202 + status resource makes the async nature explicit and lets clients subscribe to updates instead of blocking.' },
        { q: 'Would you use gRPC anywhere?', a: 'Internally between matching, location and trip services for low-latency typed calls; possibly bidirectional streaming for driver apps, though many teams keep mobile on HTTPS/WebSocket for proxy/firewall friendliness.' },
      ],
      pitfalls: [
        'Designing one generic CRUD API for all interactions',
        'Ignoring retry behaviour of mobile clients',
        'Missing that location update frequency is the main scaling driver',
      ],
    },
    {
      id: 'fund-requirements-iq-07',
      difficulty: 'hard',
      question: 'You chose Postgres for the booking store. The interviewer challenges: "Why not Cassandra? It scales better." How do you articulate — and possibly revise — the trade-off?',
      whatInterviewerLooksFor: [
        'Anchors the choice to specific requirements (conditional multi-row updates, transactions)',
        'Quantifies whether "scales better" is actually needed',
        'Acknowledges what Cassandra would genuinely do better',
        'States the trigger at which they would switch or shard',
        'Stays calm and collaborative',
      ],
      modelAnswer: `### Restate the concern as a requirement
"So the worry is write throughput or data volume outgrowing a single primary. Let me check the numbers against that."

### Why Postgres for this workload
- **Correctness requirement:** a hold must atomically claim up to 8 seats — all or none — with a conditional check. Postgres gives this in one transaction. In Cassandra, lightweight transactions (Paxos-based compare-and-set) are limited to a single partition and cost ~4 round trips, and multi-partition atomicity isn't available; I'd need to model all seats of a show in one partition, which makes it a hot partition exactly during on-sale.
- **Numbers:** steady-state bookings are a few per second; on-sale writes are throttled by the waiting room to a few thousand holds/s — well within one well-tuned Postgres primary. Data volume: ~1B booking rows over 5 years at ~500 bytes ≈ 500 GB — fine for one primary with partitioning by month.
- **Operational:** team knows Postgres, rich querying for support/finance, easy reconciliation.

### What Cassandra would do better
Multi-region active-active writes, linear write scaling, and high-volume append-only data — e.g. **click/view events or seat-map change logs**. I'd happily use it (or Kafka + an OLAP store) there.

### The trigger to revisit
"If we need more than ~10K sustained holds/s, or multi-region writes for bookings, I'd first **shard Postgres by show_id** — holds never span shows, so there are no cross-shard transactions — before changing data model semantics."

### Structure
Requirement → alternative → cost → mitigation → trigger. Neither folding ("sure, Cassandra") nor digging in ("Postgres is always better").`,
      followUps: [
        { q: 'What if the interviewer insists on Cassandra?', a: 'Then model a partition per show with seats as clustering rows, use LWT per seat, accept that a multi-seat hold becomes a sequence of per-seat CAS with compensating releases, and reduce contention with a waiting room — and state the extra complexity explicitly.' },
        { q: 'How would you shard by show_id without hotspots?', a: 'Hash show_id across shards; a single mega-show still lands on one shard, so the per-show hot spot is handled by admission control, not sharding.' },
      ],
      pitfalls: [
        'Answering "Cassandra doesn\'t support transactions" without nuance (LWT exists)',
        'Switching databases immediately to please the interviewer',
        'Arguing from brand preference rather than requirements and numbers',
      ],
    },
    {
      id: 'fund-requirements-iq-08',
      difficulty: 'expert',
      question: 'This is a staff-level loop. The prompt is "Design a notification platform for our company," and after that the interviewer goes quiet and waits. How do you run the next 45 minutes so the write-up says staff rather than strong senior?',
      context: 'The company already sends email, SMS and push from five product teams, each with its own ad-hoc sender.',
      whatInterviewerLooksFor: [
        'Proposes scope and success criteria without being asked, and asks to confirm',
        'Names the crux early (fan-out bursts, per-channel provider limits, user preferences, dedup) and skips CRUD',
        'Makes decisions with flip conditions instead of listing options',
        'Raises migration from the five existing senders, team ownership and cost unprompted',
        'Keeps the design as simple as the numbers allow',
      ],
      modelAnswer: `### Minutes 0–5: propose the scope; don't ask for it
"I'll treat this as a **shared platform** that the five teams call. In scope: an API to send a notification, user preferences and quiet hours, channel routing (email, SMS, push), delivery guarantees and observability. Out of scope: template authoring UI and marketing campaigns. Success = teams migrate off their senders within two quarters, and duplicate or lost notifications drop below 0.01%." Then confirm with one question: "Are campaigns (10M recipients) in scope, or only transactional?"

### Minutes 5–10: numbers and the crux
Assume 50M sends/day ≈ 600/s average and ~20K/s campaign bursts. The CRUD (preferences, templates) is boilerplate, and I say so. The **crux** is: bursts against provider rate limits, at-least-once delivery without duplicate SMS (which costs money), and per-user preference checks at 20K/s.

### Minutes 10–20: the simple HLD, with decisions
- An API writes the request plus an outbox row into Postgres, so a send is durable once accepted (202 + id).
- **Decision:** Kafka partitioned by user_id, because we need per-user ordering, throttling and replay for incident backfills. If campaigns were out of scope, SQS would be cheaper and enough.
- Channel workers apply preferences (a cached snapshot), dedupe on (idempotency_key, channel), then call providers through per-provider token buckets.

### Minutes 20–40: two deep dives I choose
1. **Burst vs provider limits:** separate priority lanes (OTP > transactional > campaign), so a campaign can never delay an OTP, and drain time is computed from provider quotas.
2. **Exactly-once effect:** a dedup table with a TTL plus provider idempotency keys where they exist, and a reconciliation job on delivery receipts.

### Minutes 40–45: org, cost, ops
- **Migration:** a client library that dual-sends in shadow mode for one team, then cuts over team by team behind a flag.
- **Ownership:** the platform team owns the pipeline; product teams own templates and their own SLOs.
- **Cost:** SMS dominates (~$0.005–0.05 each), so preference suppression and dedup are cost controls, not only UX.
- **Ops:** SLIs for accept-to-provider latency per lane, and a DLQ with replay.`,
      followUps: [
        {
          q: 'The interviewer interrupts: "Why not let each team keep its sender and just share a library?" How do you respond?',
          a: 'Treat it as a real option and decide on the requirements: a library cannot enforce global per-user frequency caps, shared provider quotas or cross-team dedup, because each team\'s process sees only its own traffic. So central routing is needed for the problems we listed. I would still ship the client as a library over the API, so migration is a dependency bump. If the org only needed consistent templates, the library alone would be the cheaper answer.',
        },
        {
          q: 'Halfway through you realise campaigns at 20K/s will exceed the SMS provider\'s 1K/s limit. What do you change?',
          a: 'Nothing in the architecture, but you change the promise. 10M campaign SMS at 1K/s is ~2.8 hours, so campaigns become "delivered within N hours" with scheduled pacing, and a second provider is added for both capacity and failover. OTPs keep a reserved slice of the quota (say 20%) so they are never queued behind a campaign. Saying the new SLA out loud is the staff move: the constraint is commercial, not technical.',
        },
        {
          q: 'What is one insight you would expect to teach the interviewer here?',
          a: 'For example: preference and dedup checks are the biggest cost lever, because most notification spend is SMS and every suppressed send saves real money. Measure suppression rate as a first-class metric alongside delivery rate. Or: put the idempotency key on the business event (order_shipped:123), not on the send request, so retries from upstream services also dedupe.',
        },
      ],
      pitfalls: [
        'Asking "what do you want me to design?" and waiting, which hands steering to the interviewer',
        'Spending ten minutes on the preferences CRUD API',
        'Listing Kafka, SQS and RabbitMQ without choosing one',
        'Ending without migration, ownership or cost, a design that only works on a green field',
      ],
    },
    {
      id: 'fund-requirements-iq-09',
      difficulty: 'hard',
      question: 'Your design round turns out to be a voice-only call with no drawing tool. You are asked to design a webhook delivery service (customers register URLs, and you deliver events with retries). How do you keep the interviewer oriented and still show depth without a single diagram?',
      whatInterviewerLooksFor: [
        'Announces a structure up front and sticks to it',
        'Names and numbers components and reuses those names consistently',
        'Narrates data flow as numbered steps for the write and delivery paths',
        'Recaps and checks in more frequently than on a whiteboard',
        'Still reaches a real deep dive (retries, ordering, poison endpoints)',
      ],
      modelAnswer: `### Set the map before the content
"I'll do this in four parts: scope and numbers, then five components, then the delivery path step by step, then two deep dives: retries and slow endpoints. I'll recap after each part."

### Scope and numbers (spoken, short)
Events at ~5K/s, ~50K customer endpoints, at-least-once delivery, ordering per endpoint optional, and retries for up to 72 hours with exponential backoff.

### Number the components and reuse the names
"One, the **Ingest API**. Two, the **Event Log** (Kafka). Three, the **Dispatcher**. Four, the **Retry Scheduler**. Five, the **Endpoint Registry**." From then on, always say "the Dispatcher (3)", never "the service" or "that box".

### Walk paths as numbered steps
1. A producer calls the Ingest API (1), which validates and appends to the Event Log (2) keyed by endpoint_id, then returns 202.
2. The Dispatcher (3) consumes it, looks up the URL and secret in the Endpoint Registry (5), signs the payload with HMAC and POSTs with a 10 s timeout.
3. On a non-2xx response or a timeout, it writes to the Retry Scheduler (4) with next_attempt_at = now + backoff (with jitter).

**Recap:** "So far: append, dispatch, schedule a retry. Shall I go into the slow-endpoint problem?"

### Deep dive by contrast, not by picture
"Without isolation, one endpoint that takes 10 s per request ties up dispatcher concurrency for everyone. So each endpoint gets a concurrency cap and its own circuit breaker. After N consecutive failures we pause it and stop retrying, so its backlog can't starve healthy endpoints." Use numbers instead of visuals: "with 200 dispatcher slots, five dead endpoints at 10 s timeouts would otherwise consume them all."

### Close with a verbal summary
In one breath: the components in order, the guarantee (at-least-once, consumers dedupe by event_id), and the main trade-off (per-endpoint isolation costs some throughput).`,
      followUps: [
        {
          q: 'The interviewer says "I\'ve lost track. Where does the retry state live again?" How do you recover?',
          a: 'Don\'t re-explain everything. Re-anchor with the numbered map: "Five components. Retries live in four, the Retry Scheduler, a table keyed by (next_attempt_at, event_id) that a poller scans every second. The Dispatcher (3) writes to it on failure and re-reads from it when an attempt is due." Then offer a 15-second full recap of the path. Take the question as a signal to recap more often, and say so.',
        },
        {
          q: 'Would you still sketch on paper if you can\'t share it?',
          a: 'Yes, if it\'s allowed. Ask first: "Is it OK if I jot notes on paper for myself?" A private sketch keeps component names and numbers consistent and helps you notice a missing path, such as how a customer re-registers a URL. It doesn\'t replace narration, though: the interviewer grades what you say, so every decision must still be spoken with its reason.',
        },
      ],
      pitfalls: [
        'Saying "this box talks to that one" as if a diagram existed',
        'Long monologues with no recap or check-in',
        'Renaming components mid-way, so the interviewer can\'t tell whether it is a new service',
        'Staying at breadth only because depth feels hard to convey verbally',
      ],
    },
    {
      id: 'fund-requirements-iq-10',
      difficulty: 'hard',
      question: 'You are in a multi-part round: four parts in 60 minutes, and each part is revealed only after the previous one runs correctly. Part 1 says: "Implement an in-memory service that records payments and returns a merchant\'s balance." How do you approach part 1, and how do you avoid both over-engineering it and painting yourself into a corner?',
      context: 'This format is reported for Stripe and some AI labs: a single evolving problem on a HackerRank-style platform where tests gate the next part.',
      whatInterviewerLooksFor: [
        'Ships a correct, simple v1 quickly (within ~10–15 minutes)',
        'Chooses cheap seams (ids, injected clock, a clean interface) instead of prebuilt features',
        'States assumptions such as integer minor units and currency up front',
        'Anticipates likely later parts verbally without implementing them',
        'Keeps tests passing as the design evolves',
      ],
      modelAnswer: `### Why speed matters here
The grader needs part 1 to pass before part 2 appears. A 25-minute "production-grade" part 1 leaves ~35 minutes for three parts, and that is where most candidates fail. So the goal is a correct v1 in ~12 minutes.

### Part 1, deliberately small
- **Interface first:** recordPayment(merchantId, amountMinor, currency, paymentId) and getBalance(merchantId, currency).
- **Assumptions said out loud:** money in integer minor units (never floats), and balances kept per currency.
- **Storage:** a Map from merchantId to a Map from currency to balance, plus an append-only list of payment records.
- **Run the given tests,** then submit.

### Cheap seams, not features
| Seam (costs ~1 min) | Likely later part it enables |
|---|---|
| Every payment carries paymentId | Idempotent retries ("same id twice must not double count") |
| Keep the event list, not just the balance | Refunds, history and balance-at-time queries |
| Injected clock | Settlement windows, holds that expire |
| One class with a narrow interface | Swapping in persistence or multi-tenant limits |

What I do **not** build yet: persistence, locking, multi-currency conversion or rate limiting. I mention in one sentence where each would go.

### When part 2 lands
If part 2 is "refunds and idempotency", the seams mean it's additive: a processed-id set checked at the top of recordPayment, and refunds appended as negative entries. Re-run all tests after each part, because regressions in part 1 can fail the whole submission.

### What the interviewer is grading
Not cleverness in part 1, but **velocity with judgment**: correct first, extensible second, and talking through trade-offs while typing ("I'm keeping the event list because balances are derivable; it costs memory, which is fine at this size").`,
      followUps: [
        {
          q: 'Part 3 says "balances must be correct when recordPayment is called concurrently from multiple threads/requests". What do you change?',
          a: 'In Node, a single in-memory process is already serialised per event-loop turn, provided the update has no await between reading and writing. Say that explicitly and keep the read-modify-write synchronous. If the platform uses threads (Java), guard per merchant with a lock or use an atomic map update, for example ConcurrentHashMap.merge. Mention that in production the same requirement becomes a conditional UPDATE or a ledger insert with a unique paymentId. The seam you kept (an append-only event list keyed by id) makes that migration natural.',
        },
        {
          q: 'You\'re 8 minutes into part 1 and realise your Map-of-balances can\'t answer "balance as of time T". The tests don\'t need it. Do you refactor?',
          a: 'No. Submit what passes first, because unlocking part 2 is worth more than speculative refactoring. Note the gap aloud: "If a later part asks for point-in-time balances, I\'ll derive them from the event list, which I\'m already storing." Because you kept events, the refactor is a new query, not a rewrite. Refactor only when a revealed requirement actually needs it.',
        },
      ],
      pitfalls: [
        'Designing a full ledger with persistence and locking in part 1',
        'Using floating-point amounts',
        'Not re-running earlier parts\' tests after changes',
        'Silent coding, with no narration of assumptions and trade-offs',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'fund-requirements-boe-1',
      question: 'In step 1 of a ticket-booking interview you learn the scale. Turn it into the three or four numbers that decide the architecture — which path dominates, and what the averages hide.',
      assumptions: [
        '2M DAU browsing, ~30 page/API views each per day',
        '200K bookings/day in steady state',
        'Big on-sale: 1M users arrive within 5 minutes for one 50K-seat event, each making ~10 requests (seat map refresh + hold attempts)',
        'Use 10^5 s/day for quick math (true value 86,400 — ~15% more QPS)',
        'Peak factor for normal traffic ≈ 5x average',
      ],
      steps: [
        { label: 'Browse QPS', calc: '2M × 30 ÷ 10^5 ≈ 600 QPS avg; × 5 peak ≈ 3K QPS' },
        { label: 'Booking TPS (steady)', calc: '200K ÷ 10^5 ≈ 2 bookings/s — trivial for one Postgres' },
        { label: 'On-sale request rate', calc: '1M users × 10 req ÷ 300 s ≈ 33K RPS on a single event' },
        { label: 'Contention ratio', calc: '1M buyers ÷ 50K seats ≈ 20 buyers per seat; most hold attempts must fail fast (409)' },
        { label: 'Seat map read amplification', calc: '33K RPS mostly reading one key (event 42 seat map) → single hot key; 1 Redis node handles ~100K ops/s but a CDN/in-process cache with 1-2s TTL cuts origin load to ~1 req/s per edge' },
      ],
      answer: 'Averages (≈3K QPS browse, 2 TPS booking) fit a single database; the on-sale spike (~33K RPS, 20:1 contention on one event) is what the architecture must survive.',
      insight: 'The requirement question "are there on-sale spikes?" is worth more than all the average-QPS math: it forces a virtual waiting room (admission control), a cached, eventually consistent seat map, and single-winner conditional holds on the write path. Without it you would design a comfortable CRUD system that collapses at 10:00 on sale day.',
      followUps: [
        {
          "q": "Marketing says the on-sale will be 10× bigger: 10M users in 5 minutes for the same 50K seats. What breaks first, and what do you change?",
          "a": "Request rate goes to 10M × 10 ÷ 300 ≈ 333K RPS and contention to 200 buyers per seat. The seat-map hot key is fine behind a CDN, but the origin, auth and hold path would drown. The waiting room becomes mandatory: admit users at the rate the hold path can actually convert (e.g. a few thousand per second), give everyone else a queue position, and stop admitting once seats are exhausted. Pre-scale auth and cache, and reject at the edge rather than at the database."
        },
        {
          "q": "Holds last 10 minutes and 30% of them expire unpaid. How does that change the numbers and the requirements?",
          "a": "Expired holds return seats to the pool, so the event sells out in waves rather than once: about 15K of the first 50K holds come back after 10 minutes, then ~4.5K more, and so on. That creates new requirements: the seat map must reflect releases quickly (otherwise users keep seeing 'sold out' while seats exist), expiry must be processed precisely (a timer wheel or sorted set, not a cron every minute), and the waiting room must re-admit users as seats return. Shorter holds (e.g. 5 minutes) reduce the waves."
        }
      ],
    },
    {
      id: 'fund-requirements-boe-2',
      question: 'Your checkout API has an SLO of 99.95% successful requests over 30 days and serves ~2B requests/month. How much error budget do you have, and how much do deploys vs. a single bad incident consume?',
      assumptions: [
        '30-day window = 2.592M seconds',
        '2B requests / month; peak ~2,000 RPS',
        '20 deploys/month; each causes a 30 s blip with 5% errors at ~800 RPS',
        'One AZ failover per quarter: 5 minutes of 100% errors on 1/3 of traffic',
        'Worst case incident: 15-minute full outage at peak',
      ],
      steps: [
        { label: 'Average RPS', calc: '2B ÷ 2.592M s ≈ 772 RPS' },
        { label: 'Error budget (requests)', calc: '2B × 0.0005 = 1,000,000 failed requests / month' },
        { label: 'Error budget (time)', calc: '43,200 min × 0.0005 = 21.6 min of full outage' },
        { label: 'Deploy cost', calc: '30 s × 800 × 5% = 1,200 errors per deploy; × 20 = 24K ≈ 2.4% of budget' },
        { label: 'AZ failover cost', calc: '300 s × 800 × 1/3 ≈ 80K errors ≈ 8% of budget (in the month it happens)' },
        { label: 'Single bad incident', calc: '900 s × 2,000 RPS = 1.8M errors = 180% of budget → SLO missed' },
      ],
      answer: '~1M failed requests (≈21.6 min) per month; routine deploys use ~2.4%, an AZ failover ~8%, but one 15-minute peak outage blows 180% of the budget.',
      insight: 'Availability is dominated by rare long incidents, not frequent small ones. So the NFR drives investment in detection and recovery speed (canary + automatic rollback, burn-rate alerts, automated failover) rather than deploying less often. It also tells you whether a single region is acceptable: a region-level outage of an hour would exceed several months of budget.',
      followUps: [
        {
          "q": "The business raises the SLO to 99.99%. Redo the budget. What does a single incident now have to look like?",
          "a": "Budget drops to 2B × 0.0001 = 200K failed requests (≈4.32 minutes of full outage) per month. Deploy blips (24K) now use 12% and one AZ failover (80K) uses 40%. At 2,000 RPS peak, a full outage exhausts the whole month in 100 seconds, so detection plus rollback must complete in well under 2 minutes: automated canary analysis, automatic rollback, and zone-redundant everything. Human-in-the-loop incident response can't meet this target alone."
        },
        {
          "q": "How would you alert on this SLO so on-call is paged for the 15-minute outage within minutes but not for the deploy blips?",
          "a": "Use multi-window burn-rate alerts. A burn rate of 14.4 over 1 hour (with a 5-minute confirmation window) means 2% of a 30-day budget consumed in an hour: a full outage burns at 2,000× and trips within a minute or two. A deploy blip (5% errors for 30 s) has a high instantaneous rate but the 1-hour window averages it far below 14.4, so it doesn't page. Add a slow-burn ticket alert (burn rate 1 over 3 days) for chronic issues."
        }
      ],
    },
    {
      id: 'fund-requirements-boe-3',
      question: 'Product wants "p99 < 200ms" for the event page. Build a latency budget per hop and check whether a design with 2 sequential DB queries and a 5-way parallel fan-out can meet it.',
      assumptions: [
        'SLO measured server-side at the load balancer (client network excluded)',
        'Warm keep-alive connections (no TCP/TLS handshake per request)',
        'Intra-AZ RTT ≈ 0.5 ms; cross-AZ ≈ 1-2 ms',
        'Downstream services each have p99 = 60 ms, p99.9 = 150 ms, independent tails',
        'Indexed DB query p99 = 20 ms',
      ],
      steps: [
        { label: 'Fixed overhead', calc: 'LB + gateway + JWT verify + serialization ≈ 15 ms' },
        { label: 'Service CPU', calc: 'business logic + GC headroom ≈ 20 ms' },
        { label: 'DB', calc: '2 sequential queries × 20 ms p99 ≈ 40 ms (conservative: sum of p99s ≥ p99 of sum)' },
        { label: 'Fan-out naive', calc: 'P(all 5 under their p99) = 0.99^5 ≈ 0.951 → ~4.9% of requests wait for at least one tail > 60 ms' },
        { label: 'Fan-out effect on p99', calc: 'our p99 sits in that 4.9% → driven by downstream ~p99.8 (1 - 0.01/5), closer to 100-150 ms than 60 ms' },
        { label: 'Total', calc: '15 + 20 + 40 + ~130 ≈ 205 ms → misses; with a 70 ms per-call timeout + degrade optional calls: 15 + 20 + 40 + 70 = 145 ms, 55 ms headroom' },
      ],
      answer: 'As designed it lands at ~200 ms+ p99 because fan-out makes the downstream tail (not their p99) the page p99; with per-call timeouts, optional-call degradation (or hedging) it fits at ~145 ms.',
      insight: 'A p99 NFR cannot be met by adding hop p99s — fan-out amplifies tails. The budget forces concrete design rules: parallel not sequential calls, per-call deadlines derived from the remaining budget, critical vs optional dependencies, caching the seat map, and async for anything slow.',
      followUps: [
        {
          "q": "The page now needs 20 parallel downstream calls instead of 5, each with p99 60 ms. What happens to the page p99, and what do you do?",
          "a": "P(all 20 under their p99) = 0.99^20 ≈ 0.82, so ~18% of requests hit at least one tail; the page p99 is driven by each dependency's ~p99.95 (1 − 0.01/20), which is beyond the 150 ms p99.9. Per-call timeouts with degradation become essential, not optional. Reduce fan-out: batch calls to the same service, precompute or cache the slow-changing parts, and use hedged requests on critical calls so a single slow replica doesn't define the tail."
        }
      ],
    },
  ],
  test: [
    {
      id: 'fund-requirements-mcq-01',
      difficulty: 'medium',
      question: 'You are 12 minutes into "Design a news feed". You have listed FRs, NFRs and rough QPS. What is the highest-value next move?',
      options: [
        'Refine the QPS and storage estimates to three significant figures so the design is precise',
        'Present the API and a high-level read/write path diagram, then ask whether it looks right before going deeper',
        'Start the deep dive on feed ranking, since that is the most technically interesting component',
        'Pick the database technology first, because every other component depends on it',
      ],
      correct: [1],
      explanation: 'Step 2 of the framework is a high-level design with explicit buy-in; checking in at minute ~15 is cheap and prevents a wasted deep dive. Extra estimation precision rarely changes decisions. Ranking may not even be in scope, and choosing a database before the data model and access patterns are on the board is solution-first thinking.',
      followUps: [
        {
          "q": "You present the high-level design and the interviewer just says 'looks fine, continue' without picking anything. How do you choose the deep dive?",
          "a": "Pick the component where your own requirements create the hardest problem, and say why: 'Reads are 100× writes with a 200 ms p99, so the timeline read path and fan-out are where this design succeeds or fails — I'll go there first, then storage sharding if we have time.' Offer the alternative in one sentence so they can redirect. Choosing by the numbers you already wrote on the board shows the estimates were for something, not ritual."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-02',
      difficulty: 'hard',
      question: 'The interviewer says the like count on posts "must be strongly consistent". What response best balances correctness and cost?',
      options: [
        'Agree, and use a distributed transaction across the post and like tables on every like',
        'Push back that CAP makes strong consistency impossible, so likes must be eventually consistent',
        'Clarify: likes must never be lost or double-counted and the liker sees their own like immediately, while other viewers may see a count a few seconds stale',
        'Use a single global Redis counter with INCR so every read is linearizable worldwide',
      ],
      correct: [2],
      explanation: 'Decomposing "strong" into durability, idempotency (no double count) and read-your-writes captures what users actually notice at a fraction of the cost. Distributed transactions per like are wildly expensive. CAP does not make strong consistency impossible — it constrains behaviour during partitions. A single global Redis counter is a hot key and SPOF, and cross-region clients still pay latency.',
      followUps: [
        {
          "q": "The interviewer pushes further: 'The liker sees their own like immediately — how, if reads go to replicas that lag 2 seconds?'",
          "a": "Several cheap options: the client optimistically renders its own like and count+1, since it knows what it just did; the server returns the new state in the write response; or route that user's reads to the primary (or a replica caught up to their write's LSN) for a few seconds after a write, tracked with a session token or cookie holding the write timestamp. Read-your-writes is a per-session guarantee, so you don't need global strong consistency to deliver it."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-03',
      difficulty: 'expert',
      question: 'Given this SLO definition, how many minutes of complete outage can the service absorb in the window before the SLO is violated?',
      code: {
        language: 'yaml',
        code: `kind: SLO
spec:
  service: checkout-api
  budgetingMethod: Timeslices
  timeWindow:
    - duration: 30d
      isRolling: true
  objectives:
    - target: 0.9995
      timeSliceTarget: 0.95   # a 1-min slice is "good" if >=95% requests succeed
      timeSliceWindow: 1m`,
      },
      options: ['About 4.3 minutes', 'About 21.6 minutes', 'About 43.2 minutes', 'About 263 minutes'],
      correct: [1],
      explanation: '30 days = 43,200 one-minute slices; 0.05% of them may be bad = 21.6 minutes of full outage. 4.3 minutes corresponds to 99.99% over 30 days, 43.2 minutes to 99.9%, and ~263 minutes (4.38 h) is 99.95% over a full year — a common mix-up when the window is not read carefully.',
      followUps: [
        {
          "q": "An incident causes 4% errors for 3 hours straight. How much of this SLO's budget does it burn, and what does that tell you about the timeslice method?",
          "a": "Zero. Every 1-minute slice is 96% successful, above the 95% slice threshold, so all slices count as good. A request-based SLO over the same window would charge 180 min × 4% ≈ 7.2 minutes of full-outage equivalent, about a third of the 21.6-minute budget. Timeslice SLOs hide sustained partial degradation below the slice threshold, so pair them with a request-based SLO or a tighter slice target for checkout, where 4% failed payments is a serious incident."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-04',
      difficulty: 'expert',
      question: 'Which of these are well-formed non-functional requirements you could design and test against? Select ALL that apply.',
      options: [
        'p99 timeline read latency < 200 ms at 50K QPS, measured at the load balancer',
        'The system should be fast and highly scalable',
        'Order database: RPO ≤ 1 minute, RTO ≤ 15 minutes for a regional failure',
        'The platform must use microservices to scale independently',
        '99.95% of checkout requests succeed (non-5xx) over a rolling 30-day window',
      ],
      correct: [0, 2, 4],
      explanation: 'Good NFRs name a metric, a target, a measurement point or scenario, and a window — options 1, 3 and 5 do. "Fast and highly scalable" is an adjective with nothing to test. "Must use microservices" is an architectural decision (a solution), not a requirement; the underlying requirement might be independent deployability or team autonomy.',
      followUps: [
        {
          "q": "Take 'p99 timeline read latency < 200 ms at 50K QPS, measured at the load balancer'. How would you actually verify it before launch and keep it true after?",
          "a": "Before launch: a load test replaying a production-like request mix (cache hit ratios, user follower distributions) at 50K QPS and above, measuring p99 at the LB rather than in the client tool, which adds its own queueing. Watch for coordinated omission: use an open-loop load generator with a fixed arrival rate. After launch: an SLO dashboard computed from LB histogram metrics, a burn-rate alert, and a latency check in canary analysis so a regressing deploy rolls back automatically."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-05',
      difficulty: 'hard',
      question: 'Requirements: 100:1 read:write, ~1 KB objects, readers tolerate 1-5 s staleness, writes must be durable once acknowledged. Which design implication follows most directly?',
      options: [
        'Cache-aside in front of the primary plus read replicas, accepting replica lag within the staleness bound',
        'Quorum writes and reads (W = R = N) on every request so readers never see stale data',
        'Two-phase commit between the cache and the database to keep them in lockstep',
        'Write-behind caching: acknowledge writes from Redis and flush to the DB asynchronously',
      ],
      correct: [0],
      explanation: 'A read-heavy workload with explicit staleness tolerance is exactly what caches and async replicas exploit. Full quorum reads/writes pay latency for consistency nobody asked for. 2PC between cache and DB is heavy and unnecessary. Write-behind acknowledges before the data is durable in the system of record, violating the durability requirement.',
      followUps: [
        {
          "q": "A new requirement arrives: when a user edits an object, they must see their edit immediately, but others may still see stale data for 5 s. What changes in the cache-aside design?",
          "a": "On write, update the DB and delete (not set) the cache key so the next read repopulates, avoiding a race where an older value overwrites a newer one. For the writer, route their reads for that key to the primary for a few seconds, or return the new value in the write response and have the client use it. Replica lag stays acceptable for everyone else. If invalidations go through a queue, monitor invalidation lag against the 5 s bound."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-06',
      difficulty: 'expert',
      question: 'Mobile clients retry POST /v1/payments on a 10 s client timeout. What happens with this handler when the PSP is slow?',
      code: {
        language: 'typescript',
        code: `@Post('payments')
async pay(@CurrentUser() user: User, @Body() dto: PayDto) {
  const payment = await this.repo.insert({ userId: user.id, amount: dto.amount, status: 'PENDING' });
  const res = await this.psp.charge({ amount: dto.amount, customer: user.pspId }); // takes ~12 s
  await this.repo.update(payment.id, { status: res.ok ? 'PAID' : 'FAILED' });
  return payment;
}`,
      },
      options: [
        'Nothing bad: POST requests are deduplicated by TCP retransmission on the same connection',
        'The load balancer detects the duplicate body and drops the retry',
        'The retry creates a second payment row and a second PSP charge, because nothing ties the two attempts together',
        'Only a duplicate row is created; the PSP deduplicates charges by amount and customer automatically',
      ],
      correct: [2],
      explanation: 'The first request is still running when the client times out and retries, so the server processes two independent requests: two rows, two charges. TCP retransmission operates below HTTP and does not dedupe application-level retries; load balancers do not dedupe bodies; PSPs dedupe only when you pass an idempotency key, not by amount/customer. The fix is a client Idempotency-Key stored with a unique constraint and forwarded to the PSP.',
      followUps: [
        {
          "q": "You add an Idempotency-Key. The retry arrives while the first request is still waiting on the PSP. What should the second request return?",
          "a": "It must not start a second charge, and it can't return a final result yet. Return 409 Conflict (or 202 Accepted with a status URL) indicating the original request is in progress, and the client polls or retries later. Implement it with the unique key row in state IN_PROGRESS; the second request reads it and responds accordingly. Once the first finishes, the stored response is replayed for later retries. Stripe uses exactly this pattern: concurrent requests with the same key get a 409."
        },
        {
          "q": "The PSP call takes ~12 s but the client times out at 10 s. Without changing the client, how do you stop the timeout from happening at all?",
          "a": "Make the API asynchronous: insert the payment as PENDING, enqueue the charge, and return 202 with the payment ID within milliseconds. A worker calls the PSP with the payment ID as the idempotency key and updates the status; the client polls `GET /payments/{id}` or receives a push/webhook. The client's 10 s timeout then only covers a fast insert. The cost is a status state machine, a reconciliation job for UNKNOWN outcomes and UI that shows 'processing'."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-07',
      difficulty: 'hard',
      question: 'You are mid-way through a deep dive on sharding the message store when the interviewer asks, "How would push notifications reach offline users?" What is the best move?',
      options: [
        'Close sharding in one sentence, then answer the notification question — it likely reflects what they still need to evaluate',
        'Politely finish the sharding discussion first, since abandoning it would look indecisive',
        'Explain that notifications were out of scope and continue with sharding',
        'Restart the high-level design to incorporate notifications from the beginning',
      ],
      correct: [0],
      explanation: 'Interviewer questions are usually hints about rubric items not yet covered; following them while bookmarking the current thread shows collaboration and time management. Insisting on finishing wastes limited time; refusing on scope grounds ignores an explicit request (scope is negotiable). Restarting the whole design burns minutes for no new signal.',
      followUps: [
        {
          "q": "You answer the notifications question and there are 10 minutes left. Do you go back to sharding?",
          "a": "Only if it was unfinished in a way that matters. Say explicitly: 'I'd left the shard-key choice at conversation_id with time buckets; the open item was rebalancing. Do you want that, or should I cover failure modes?' Let the interviewer choose. Often the remaining rubric items (reliability, observability, bottlenecks at 10×) are worth more than finishing a thread they already interrupted, and the bookmark shows you knew where you stopped."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-08',
      difficulty: 'expert',
      question: 'In a hotel reservation system (guests book a room type for a date range, overbooking up to 10% allowed), which piece of data is the true contention hotspot the deep dive should focus on?',
      options: [
        'The reservation table, since each booking inserts a new row',
        'Hotel and room metadata, since every search reads it',
        'The per-(hotel, room type, date) inventory row holding total and reserved counts',
        'The guest/user table, since each reservation references a guest',
      ],
      correct: [2],
      explanation: 'Concurrent bookings for the same hotel, room type and night all update the same inventory counter row, so that is where locking/optimistic concurrency and the overbooking check live. Reservation inserts are independent rows with no contention. Metadata is read-heavy and cacheable. The guest table is read, not contended.',
      followUps: [
        {
          "q": "The hotel inventory row is (hotel, room type, date). A 3-night booking must reserve all three nights or none. How do you do it without deadlocks?",
          "a": "In one transaction, run a single conditional UPDATE over the three date rows: `UPDATE inventory SET reserved = reserved + 1 WHERE hotel=? AND room_type=? AND date BETWEEN ? AND ? AND reserved + 1 <= total * 1.1` and check that exactly 3 rows were updated; otherwise roll back. Locking rows in a consistent order (by date) prevents deadlocks between overlapping bookings. Alternatively use optimistic concurrency with a version column per row and retry on conflict."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-09',
      difficulty: 'expert',
      question: 'This feed endpoint must serve users who scroll through thousands of items while new posts arrive constantly. Select ALL real problems with the contract.',
      code: {
        language: 'typescript',
        code: `@Get('feed')
async feed(@CurrentUser() u: User, @Query('page') page = '1', @Query('size') size = '20') {
  const p = parseInt(page, 10), s = parseInt(size, 10);
  return this.db.query(
    'SELECT * FROM feed_items WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2 LIMIT $3',
    [u.id, (p - 1) * s, s],
  );
}`,
      },
      options: [
        'Deep pages get slower linearly, because the database must walk and discard OFFSET rows',
        'New items inserted at the top shift pages, so scrolling users see duplicates or skip items',
        'size is not capped, so a client can request 1,000,000 rows in one call',
        'The query is vulnerable to SQL injection through page and size',
        'Offset-paginated responses can never be cached by a CDN',
      ],
      correct: [0, 1, 2],
      explanation: 'OFFSET cost grows with depth, and offsets are unstable under inserts — both solved by keyset/cursor pagination on (created_at, id). The missing cap on size is an unbounded-response NFR violation. The values are passed as bind parameters, so there is no SQL injection. CDN cacheability depends on cache headers and personalization, not on offset vs cursor — and this per-user feed would not be CDN-cached anyway.',
      followUps: [
        {
          "q": "You switch to cursor pagination on (created_at, id). Product now wants a 'jump to page 50' control. How do you respond?",
          "a": "Push back on the requirement first: on an infinite feed nobody needs page 50, and offset pages are unstable anyway. If it's truly needed (e.g. an admin list), support jumping by a meaningful key — 'jump to date' becomes a cursor at that timestamp, cheap and stable. If arbitrary page numbers are mandatory, accept OFFSET only with a cap (e.g. page ≤ 100) and a stable sort, and document that results can shift as data changes."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-10',
      difficulty: 'medium',
      question: 'For "Design a chat app", which clarifying question most changes the data model and fan-out strategy?',
      options: [
        'Should we use WebSockets or long polling for delivery?',
        'Will the backend run on Kubernetes or on VMs?',
        'Should messages be stored in Cassandra or in Postgres?',
        'What is the maximum group size, and must history sync across a user\'s devices?',
      ],
      correct: [3],
      explanation: '1:1 chat vs groups of 100K members changes fan-out from trivial to the core scaling problem, and multi-device sync changes storage (per-device cursors, message history). The transport and database questions are design decisions you are expected to make and justify yourself, and the deployment platform rarely changes the high-level design.',
      followUps: [
        {
          "q": "The interviewer answers: groups up to 100K members, and history must sync across up to 5 devices. What changes in your design?",
          "a": "Groups of 100K can't use per-recipient fan-out on write for every message — store each message once per conversation and have members pull from a conversation log with a per-member read cursor, treating large groups like channels. Multi-device means per-device delivery state: the server tracks a sync cursor per device, and new devices backfill history from storage (or, with E2E, from another device). Delivery receipts become 'delivered to at least one device' and must be defined explicitly."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-11',
      difficulty: 'hard',
      question: 'Which statement best demonstrates senior-level trade-off articulation for choosing fan-out-on-write for a feed?',
      options: [
        'Fan-out-on-write is what Twitter uses, so it is the industry-standard approach',
        'Fan-out-on-write is faster, so it is always the better choice for feeds',
        'Fan-out-on-write because reads are 100x writes and the p99 read SLO is 200 ms; it costs write amplification, which I cap by switching celebrities (> 1M followers) to fan-out-on-read; I would revisit if writes grow faster than reads',
        'Either approach works; I will pick fan-out-on-write and optimise later if needed',
      ],
      correct: [2],
      explanation: 'The strong answer ties the choice to a requirement, names the cost, gives a concrete mitigation and a trigger to revisit. Appeals to authority ("Twitter does it") and absolutes ("always better") show no reasoning about this problem, and "either works, optimise later" signals no understanding of the trade-off being made.',
      followUps: [
        {
          "q": "You said you'd revisit 'if writes grow faster than reads'. What metric would trigger that, and what would you do?",
          "a": "Track fan-out work per post and timeline-write throughput against read QPS: e.g. if average fan-out inserts per second exceed a threshold of your timeline cache's write capacity, or p99 post-to-visible latency for followers exceeds the freshness requirement. Response options in order of cost: lower the celebrity threshold so more accounts go pull-based, only fan out to recently active followers, then move toward a pull model with per-user candidate caching if the read:write ratio drops below ~10:1."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-12',
      difficulty: 'expert',
      question: 'The SLO is p99 < 200 ms at the LB. The handler below measures p99 ≈ 250 ms. Which single change most directly fixes it?',
      code: {
        language: 'typescript',
        code: `// downstream p99: profile 40ms, orders 70ms, loyalty 60ms (all independent)
async summary(userId: string) {
  const profile = await this.profile.get(userId);
  const orders = await this.orders.recent(userId);
  const loyalty = await this.loyalty.points(userId);   // optional widget
  return { profile, orders, loyalty };
}`,
      },
      options: [
        'Add more replicas of this service behind the load balancer',
        'Enable HTTP/2 between the gateway and this service',
        'Increase each client timeout to 500 ms so fewer calls fail',
        'Run the independent calls concurrently with a deadline, and treat loyalty as optional so it degrades to null',
      ],
      correct: [3],
      explanation: 'The latency is the sum of three sequential dependencies; running them in parallel makes it roughly the max, and a deadline plus optional handling keeps the slowest non-critical call from breaking the SLO. More replicas help throughput/queueing, not the serial dependency chain on an unsaturated service. HTTP/2 saves little on warm connections. Raising timeouts makes the tail worse, not better.',
      followUps: [
        {
          "q": "After parallelising, p99 is ~80 ms but a week later it creeps to 180 ms. orders' p99 rose to 150 ms. What do you do without changing the orders service?",
          "a": "Orders is critical, so you can't drop it. Options: cache recent orders per user with a short TTL (orders change rarely relative to page views) and invalidate on order events; hedge the request — send a second copy to another replica if the first hasn't responded by ~p95 (say 60 ms), taking whichever returns first, at ~5% extra load; or ask whether the summary needs full orders or just a count. Also open a ticket with the orders team: your SLO depends on their SLO."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-13',
      difficulty: 'expert',
      question: 'You have 4 minutes left for the wrap-up. Which items give the strongest signal? Select ALL that apply.',
      options: [
        'The next bottleneck at 10x load and how you would address it (e.g. shard bookings by event id)',
        'Failure modes and mitigations: AZ loss, hot key on one event, poison message in the outbox consumer',
        'How you would observe the system: SLO dashboards and burn-rate alerts on hold success rate and latency',
        'A box-by-box recap of every component already drawn',
        'Offering to redo the design with a different database to show breadth',
      ],
      correct: [0, 1, 2],
      explanation: 'Scaling limits, failure modes and operability show you think beyond the happy path and about day-2 operations — exactly what a wrap-up is for. Recapping boxes adds no information the interviewer does not already have, and restarting with another database wastes the time and suggests you lack conviction in the trade-offs you made.',
      followUps: [
        {
          "q": "The interviewer picks 'hot key on one event'. You have 2 minutes. What do you say?",
          "a": "Name the hotspot and the fixes in order of cost. The seat-map read for one event is the hot key: serve it from an in-process or CDN cache with 1–2 s TTL so origin sees a few requests per second. The write side — seat holds — can't be cached, so shard holds by section of the venue (each section's rows live in a different partition), front it with a virtual waiting room that admits buyers at the rate the hold path can sustain, and make holds conditional updates that fail fast with 409."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-14',
      difficulty: 'hard',
      question: 'A public GraphQL API for a social app ships with this schema. Which requirement-level risk is the most important to address before launch?',
      code: {
        language: 'graphql',
        code: `type Query { user(id: ID!): User }
type User {
  id: ID!
  name: String!
  posts: [Post!]!         # all posts, newest first
  followers: [User!]!     # all followers
}
type Post { id: ID!, text: String!, author: User! }`,
      },
      options: [
        'Unbounded lists plus arbitrary nesting (user → followers → followers → posts) let one query fan out to millions of rows; add connection pagination with max page size and query depth/cost limits',
        'GraphQL cannot be cached, so the API will not meet any latency NFR; switch to REST',
        'Using ID instead of Int for identifiers will break clients that sort by id',
        'The schema lacks mutations, so the API is read-only and cannot satisfy the functional requirements',
      ],
      correct: [0],
      explanation: 'The contract allows unbounded, deeply nested queries — a latency, cost and denial-of-service risk; connections with capped first/after plus depth or cost analysis are the fix. GraphQL can be cached (persisted queries, entity caches, CDN for GET persisted queries), so switching to REST is unjustified. ID is an opaque string type by design. Missing mutations is an incomplete excerpt, not the launch-blocking risk here.',
      followUps: [
        {
          "q": "You add depth limits and pagination. A client sends a query with depth 4 and first: 100 on each level. Is it safe now?",
          "a": "No: 100 × 100 × 100 × 100 = 100M potential nodes at depth 4 even with per-list caps. Depth limits alone don't bound cost; you need query cost analysis — multiply list `first` arguments down the tree and reject queries above a budget (e.g. 10K nodes), counted per client with rate limiting on cost points (like GitHub's GraphQL API). For a public API, also consider persisted queries only, so arbitrary queries aren't accepted at all."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-15',
      difficulty: 'medium',
      question: 'Asked to "Design YouTube" in 45 minutes, which scoping statement sets you up best?',
      options: [
        'I will cover upload, transcoding, playback, comments, recommendations, search and monetization at a high level so nothing is missed',
        'I will focus on video upload, transcoding and playback via CDN; comments, recommendations, search and ads are out of scope unless you want one of them',
        'I will focus only on the recommendation system, since that is where YouTube is most complex',
        'I will first ask which cloud provider the company uses, because it determines the storage and CDN design',
      ],
      correct: [1],
      explanation: 'Picking the core flow (upload → transcode → stream) and explicitly listing out-of-scope items gives depth where it matters while leaving the interviewer room to redirect. Covering everything guarantees shallowness; jumping to recommendations skips the core system the prompt implies; the cloud provider does not change the high-level design and is a low-leverage question.',
      followUps: [
        {
          "q": "Fifteen minutes in, the interviewer says 'actually, let's talk about recommendations'. What do you do with what you've built?",
          "a": "Accept the redirect gracefully and connect it to the existing design: the view/watch events your playback path already emits become the input. Spend a minute on requirements for recommendations (latency for the home page, freshness of signals, cold start), then sketch the two-stage pipeline: offline candidate generation and embeddings, online ranking with a feature store, served with a cache per user. Mention you'll leave the upload/transcode design as-is unless they want to return to it."
        }
      ],
    },
    {
      id: 'fund-requirements-mcq-16',
      difficulty: 'expert',
      question: 'In a staff-level "Design a ticket booking system" round, which candidate moves raise the level signal rather than lower it? Select ALL that apply.',
      options: [
        'Proposing scope and an out-of-scope list in the first two minutes, then asking for a one-word confirmation',
        'Listing three databases with pros and cons and asking the interviewer which one they prefer',
        'Saying "the browse endpoints are standard CRUD, so I\'ll skip them; the crux is contention on hot seats during an on-sale"',
        'Explaining in detail how round-robin and least-connections load balancing differ before drawing the API',
        'Raising, unprompted, how bookings would migrate off the current monolith with dual writes and a backfill',
      ],
      correct: [0, 2, 4],
      explanation: 'Proposing scope, naming the crux while skipping boilerplate, and raising migration unprompted are all staff signals: the candidate drives and thinks beyond the green field. Handing the interviewer a menu of databases outsources the decision, a classic down-levelling signal. Explaining load-balancer algorithms in depth reads as re-teaching fundamentals to a peer and spends minutes on something that does not change the outcome.',
      followUps: [
        {
          q: 'The interviewer replies to your migration point: "Assume green field." Was raising it wasted time?',
          a: 'No, as long as it took about 20 seconds and you dropped it when told. You showed that you look for the organisational constraint. The mistake would be arguing or spending five minutes on it. Acknowledge, park it ("then I\'ll optimise for the simplest correct design"), and move on. Raising an unprompted concern is about awareness, and choosing your battles is part of the same signal.',
        },
      ],
    },
    {
      id: 'fund-requirements-mcq-17',
      difficulty: 'hard',
      question: 'A candidate says: "For the event bus we could use Kafka, SQS or Redis Streams. Kafka has replay, SQS is managed, and Redis is fast." Then they pause and look at the interviewer. Which rewrite best fixes the level signal?',
      options: [
        '"I\'ll use Kafka, since it is the industry standard for event-driven systems at scale."',
        '"Let me add RabbitMQ and NATS to the comparison so we have the full picture before choosing."',
        '"Kafka partitioned by order_id, because we need per-order ordering and 7-day replay for backfills. If we didn\'t need replay, SQS FIFO would be cheaper to run."',
        '"Any of them works at our scale, so I\'ll leave the choice to the platform team and continue with the design."',
      ],
      correct: [2],
      explanation: 'The strong rewrite makes a decision tied to the requirements (ordering key and replay) and states the condition that would flip it, which shows judgment and invites targeted push-back. "Industry standard" is a decision without a reason. Widening the menu delays the decision further. Deferring to another team avoids the call the interviewer is grading, even if "any of them works" is partly true.',
      followUps: [
        {
          q: 'The interviewer pushes back: "Our company runs everything on SQS today." Do you change your answer?',
          a: 'Re-check whether the requirement really needs Kafka. If per-order ordering is the only need, SQS FIFO with MessageGroupId = order_id provides it, and replay can come from an outbox table or S3 archive. Then switch: operating a new Kafka cluster is a real org cost. If 7-day replay at high volume is truly required, say so and quantify it. This is "choose your battles": accept the existing stack unless it breaks a requirement.',
        },
      ],
    },
    {
      id: 'fund-requirements-mcq-18',
      difficulty: 'hard',
      question: 'A multi-part round has 4 parts in 60 minutes, each unlocked only when the previous part\'s tests pass. Part 1 asks for an in-memory rate limiter: allow(clientId) returns true if the client made fewer than N calls in the last W seconds. Which plan gives the best expected outcome?',
      code: {
        language: 'text',
        code: `Plan A: Sliding-window log per client (array of timestamps), injected clock,
        submit in ~10 min; mention where Redis would slot in later.
Plan B: Redis-backed token bucket with Lua scripts and a connection pool,
        so later parts about distribution are already solved (~30 min).
Plan C: Fixed-window counter keyed by floor(now / W); a 3-line solution,
        submit in ~5 min, without checking it against the spec.
Plan D: Write the full design doc for all likely parts first (~15 min),
        then implement part 1.`,
      },
      options: [
        'Plan B, because distribution is the hardest likely part and solving it up front avoids a rewrite',
        'Plan A, because it meets the stated semantics quickly and keeps cheap seams such as an injected clock',
        'Plan C, because speed is everything in a gated format and any limiter unlocks the next part',
        'Plan D, because a design doc demonstrates staff-level planning before any code',
      ],
      correct: [1],
      explanation: 'Plan A matches the spec ("fewer than N calls in the last W seconds" is a sliding window) and ships fast with a seam that later parts, such as testing time or windows, will need. Plan B burns half the round on a part that may never be asked and adds failure modes. Plan C is fast but semantically wrong at window boundaries, so it can fail hidden tests and block everything. Plan D delays the gate. Planning can be spoken while coding.',
      followUps: [
        {
          q: 'Part 2 says memory must stay bounded with 10M distinct clients. What breaks in Plan A and how do you fix it?',
          a: 'A timestamp log per client costs O(N) entries per active client, and idle clients are never evicted, so 10M clients × up to N timestamps is too much. Switch to a sliding-window counter (current + previous window counts weighted by overlap), which uses two integers per client, and evict clients whose last call is older than 2W, using a sweep or a TTL map. The injected clock makes the eviction testable without real sleeps.',
        },
      ],
    },
    {
      id: 'fund-requirements-mcq-19',
      difficulty: 'medium',
      question: 'Your system design round is voice-only, with no drawing tool and no shared doc. Ten minutes in, you have described six components. Which technique most improves the interviewer\'s ability to follow and grade you?',
      options: [
        'Describe each component\'s internals in more detail, so the interviewer can picture it without a diagram',
        'Number the components, walk the write and read paths as numbered steps using those names, and recap in one sentence before each deep dive',
        'Ask the interviewer to draw the diagram on their side while you dictate the layout',
        'Reduce the design to two components so there is less to keep track of verbally',
      ],
      correct: [1],
      explanation: 'A stable, numbered vocabulary plus step-by-step paths and short recaps substitutes for the shared picture and keeps grading anchored. More internal detail increases the cognitive load without giving structure. Asking the interviewer to draw shifts work to them and is rarely allowed. Collapsing the design to two components trades away the depth you are being evaluated on.',
      followUps: [
        {
          q: 'How often should you check in during a verbal-only round compared to a whiteboard round, and what does a good check-in sound like?',
          a: 'More often, roughly every 5 minutes or at each phase boundary, because the interviewer cannot glance back at a board. Make it short and specific: "So far: Ingest (1) appends to the Log (2), the Dispatcher (3) delivers, and failures go to the Scheduler (4). Next I\'d go into slow endpoints. Does that work, or would you rather see ordering?" This both recaps and offers a choice, without asking open-ended "is this OK?" questions.',
        },
      ],
    },
  ],
};

export default topic;
