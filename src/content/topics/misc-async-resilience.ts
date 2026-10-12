import type { Topic } from '../../types';

const topic: Topic = {
  id: 'misc-async-resilience',
  phase: 'miscellaneous',
  order: 6,
  title: 'Queues, Kafka & Resilience Patterns',
  subtitle:
    'Question bank: queues vs logs, Kafka partitions and the KIP-848 rebalance protocol, lag that lies, DLQ redrive, the real scope of exactly-once, retry budgets, deadlines, breakers, backpressure, shedding and degradation ladders.',
  estimatedMinutes: 110,
  sources: [
    'Apache Kafka docs — Consumer Rebalance Protocol (KIP-848, GA in 4.0) and 4.2.0 release notes (share groups / KIP-932)',
    'Confluent blog — KIP-848: A New Consumer Rebalance Protocol for Apache Kafka 4.0',
    'Apache Kafka KIPs — KIP-447 (EOS v2), KIP-890 (Transactions Server-Side Defense), KIP-939 (2PC participation, in progress)',
    'RabbitMQ blog — Quorum queues in 4.0 (default delivery-limit 20)',
    'AWS docs — SQS dead-letter queues and redrive; SQS fair queues (July 2025)',
    'Amazon Builders\' Library — Timeouts, retries and backoff with jitter; Using load shedding to avoid overload',
    'Ben Maurer — Fail at Scale (ACM Queue): adaptive LIFO and CoDel',
    'Netflix TechBlog — Keeping Netflix Reliable Using Prioritized Load Shedding; Uber Engineering — Cinnamon load shedder',
    'Hello Interview — Kafka deep dive for system design interviews',
    'techinterview.org — Kafka interview questions that separate users from operators',
    'InterviewBee (aggregating InterviewExperiences.in) — Swiggy SDE-2 interview questions, 2025',
    'LeetCode Discuss — LinkedIn Staff SWE interview experience (June 2025); Oracle IC-2 backend interview experience (2025)',
    'DesignGurus — System design interview essentials: the retry pattern',
  ],
  tags: [
    'queues',
    'kafka',
    'rebalancing',
    'kip-848',
    'consumer-lag',
    'dlq',
    'exactly-once',
    'retries',
    'timeouts',
    'circuit-breaker',
    'backpressure',
    'load-shedding',
    'graceful-degradation',
    'question-bank',
  ],
  cheatSheet: [
    'Queue = work distribution (each message to one worker, deleted on ack, per-message redelivery); log = replayable history (offsets, many independent groups, order per partition). Kafka 4.2 share groups add queue semantics on top of the log.',
    'Partition count caps consumer parallelism in a classic consumer group and fixes the key → partition mapping; adding partitions later reroutes keys and breaks per-key order for in-flight data.',
    'KIP-848 (GA in Kafka 4.0, opt-in via group.protocol=consumer): broker-side assignor, heartbeat and session timeout; no group-wide sync barrier — only members whose partitions move pause them. Classic remains the default until a later major.',
    'Classic-protocol rebalance fixes in order: move slow work off the poll loop (max.poll.interval.ms), static membership (group.instance.id) for deploys, cooperative-sticky assignor, commit in the revoke callback.',
    'Measure lag in time (now − timestamp of the next unconsumed record) as well as offsets; offset lag hides rate differences, and an in-memory buffer that resolves offsets early makes lag read zero while work is still pending.',
    'A DLQ is only useful with an owner, an alert on arrival rate, full failure metadata in headers, retention longer than the fix time, and a rate-limited, idempotent redrive tool. SQS standard queues keep the original enqueue timestamp when a message moves to the DLQ.',
    'Kafka EOS = idempotent producer + transactions + read_committed consumers, atomic only over Kafka writes and consumer offsets. External side effects need idempotency keys or the outbox/inbox pattern. The Java consumer defaults to read_uncommitted.',
    'Retry only transient, idempotent (or key-protected) operations; honour Retry-After; cap attempts at one layer; add a retry budget (token bucket, retries ≤ ~10% of calls) so a hard outage costs ~1.1× load, not 4×.',
    'Timeouts must cancel work, not just stop waiting: AbortSignal for fetch, statement_timeout for Postgres, and a propagated absolute deadline so downstream hops use remaining budget minus a margin.',
    'Circuit breaker scope = failure domain (per host/endpoint, sometimes per tenant); count only dependency failures (5xx, timeouts), never caller 4xx; create one breaker per dependency at module scope, not per request.',
    'Backpressure = slow the producer (pull, credits, pause/resume, bounded queues); load shedding = refuse work you cannot finish in time (bounded queue wait ≤ client deadline, priority, exempt health checks); degradation = serve a smaller product on purpose.',
  ],
  sections: [
    {
      heading: 'Queues — work distribution vs replayable log',
      body: `**What it is:** a queue hands each message to exactly one of many competing workers and forgets it once acknowledged. It is the right tool for *jobs* (send email, render PDF), where who does the work does not matter and nobody needs history.

**Mechanism:** a worker receives a message, which becomes invisible (SQS visibility timeout, RabbitMQ unacked delivery). An ack deletes it; a nack, crash or timeout redelivers it. Redelivery is per message, so one slow job does not block the rest. Fairness across tenants is a real design concern: SQS fair queues (July 2025) use MessageGroupId on standard queues to keep a noisy tenant from inflating everyone else's dwell time.

**Queue vs log:**

| | Queue (SQS, RabbitMQ) | Log (Kafka) |
|---|---|---|
| Consumption | competing, per-message ack | offset per partition per group |
| Replay | no (gone after ack) | yes, within retention |
| Ordering | none / per group (FIFO) | per partition |
| Parallelism cap | number of workers | partitions (classic groups) |

Kafka 4.2 made share groups (KIP-932) production-ready: many consumers read the same partition with per-record acknowledgement and delivery counts — queue semantics on a log, without per-key ordering.

**#1 interview trap:** enqueueing a job inside a DB transaction before it commits. A fast worker reads a row that does not exist yet; a rollback leaves an orphan job. Enqueue after commit, or use an outbox.`,
      keyPoints: [
        'Queue for jobs, log for facts that many consumers read or replay.',
        'Per-message redelivery means no head-of-line blocking — unless you use FIFO groups.',
        'Enqueue after commit (or via outbox) to avoid phantom and orphan jobs.',
      ],
      source: 'AWS SQS developer guide (fair queues); Apache Kafka 4.2 release notes',
    },
    {
      heading: 'Kafka — partitions are the unit of order, parallelism and pain',
      body: `**What it is:** a distributed, replicated, append-only log. Topics are split into partitions; each partition is an ordered sequence of offsets with one leader broker.

**Mechanism:** the producer hashes the key (murmur2) to choose a partition, so all events for one key land in one partition in order. Keyless records use the sticky partitioner (fill a batch for one partition, then switch). Within a classic consumer group, each partition is owned by at most one member — so partitions are the ceiling on parallelism. Rough numbers: a partition sustains ~10–50 MB/s; a broker a few hundred MB/s; keep records under ~1 MB (store blobs in S3 and send a pointer).

**Choosing the partition count** trades three things: more partitions give more parallelism and less per-partition skew, but mean more open files, more replication work, slower leader elections and longer rebalances. The count is hard to change later because adding partitions changes hash(key) mod N — new events for a key go to a different partition than its history, breaking per-key order during the transition.

**#1 interview trap:** mixing keys for one entity. If OrderCreated is keyed by orderId and OrderPaid by customerId, the two events for one order can sit in different partitions and be consumed out of order. Key every event of an entity's lifecycle by the same id.`,
      diagram: `  key=order-42 --murmur2 % 12--> P7: [..., Created@901, Paid@902]
  key=order-77 ----------------> P3: [..., Created@455]

  group "billing" : P0-P5 -> pod A, P6-P11 -> pod B  (max 12 pods busy)
  group "search"  : independent offsets on the same partitions`,
      keyPoints: [
        'Order is per partition only; same entity → same key → same partition.',
        'Partition count = parallelism ceiling for a classic group; over-provision up front.',
        'Adding partitions remaps keys; plan it like a migration.',
      ],
      source: 'Hello Interview — Kafka deep dive; Kafka: The Definitive Guide (2nd ed), Ch 3–4',
    },
    {
      heading: 'Kafka rebalancing — classic protocol vs KIP-848',
      body: `**What it is:** reassigning partitions when group membership or subscriptions change (pod added, pod died, poll loop too slow, deploy).

**Classic protocol (client-driven):** the group coordinator collects JoinGroup from every member, a leader consumer computes the assignment, and SyncGroup distributes it. With the eager assignor every member revokes everything first — a stop-the-world pause. Cooperative-sticky (KIP-429) revokes only partitions that move, but still needs rounds of the global barrier. Static membership (group.instance.id, KIP-345) lets a restarted pod rejoin within session.timeout.ms without triggering a rebalance.

**KIP-848 (GA in Kafka 4.0, opt-in with group.protocol=consumer):** the broker computes assignments with server-side assignors (uniform, range), and session timeout and heartbeat interval become broker/group configs. Each member reconciles its target assignment independently via heartbeats — no global synchronisation barrier — so unaffected members never stop. Client configs such as partition.assignment.strategy, session.timeout.ms and heartbeat.interval.ms are not supported under the new protocol. max.poll.interval.ms still applies on the client. Classic remains the default in 4.x; groups can be migrated online with a rolling restart.

**#1 interview trap:** blaming heartbeats. Most "constant rebalancing" is a poll loop that exceeds max.poll.interval.ms because processing is slow — no protocol fixes that; move work off the poll thread or poll fewer records.`,
      keyPoints: [
        'Eager = everyone stops; cooperative = only movers stop, still barrier-based; KIP-848 = no barrier.',
        'Static membership avoids rebalances on quick restarts but delays failover for a dead pod.',
        'Slow processing (max.poll.interval.ms) is the most common real cause.',
      ],
      source: 'Apache Kafka docs — Consumer Rebalance Protocol; Confluent blog on KIP-848',
    },
    {
      heading: 'Consumer lag — the metric that can lie',
      body: `**What it is:** for each partition, log-end offset minus the group's committed offset — how many records are written but not yet processed (committed).

**Mechanism:** lag grows when the arrival rate exceeds the processing rate, and drains at (processing rate − arrival rate). Offsets alone mislead: 1M lag on a topic doing 200K msg/s is 5 seconds; 1M lag on 500 msg/s is 33 minutes. Alert on **time lag** (age of the oldest unconsumed record, or estimated time to drain) plus the slope, per partition.

**Ways lag lies:**

- **Reads zero, work pending:** the consumer resolves offsets as soon as it buffers records in memory. A crash loses the buffer, and lag never showed a backlog.
- **Never reaches zero:** transactional producers write commit markers that occupy offsets, so a fully caught-up read_committed consumer often shows a lag of 1 per partition.
- **Looks fine, users see delay:** the delay is upstream (outbox relay, producer batching, CDC connector) or downstream (an async worker pool after the consumer).
- **Skew:** a group-level sum hides one hot partition hours behind while 47 are at zero.

**#1 interview trap:** "add more consumers" when lag is on one partition or when the bottleneck is the database — neither gets faster.`,
      code: [
        {
          language: 'bash',
          title: 'Per-partition lag and time-based lag',
          code: `# Offset lag per partition (CURRENT-OFFSET, LOG-END-OFFSET, LAG columns)
kafka-consumer-groups.sh --bootstrap-server kafka:9092 \\
  --describe --group order-projection

# Time lag is what an SLO cares about: export it with a lag exporter
# (e.g. kafka-lag-exporter / Burrow) and alert on
#   max by (partition) (kafka_consumergroup_group_lag_seconds) > 300
# and on derivative(lag) > 0 for 10m, not on a raw offset threshold.`,
        },
      ],
      source: 'techinterview.org — Kafka interview questions; Kafka docs (transactions)',
    },
    {
      heading: 'Dead Letter Queue — a parking lot with an owner',
      body: `**What it is:** a separate queue/topic where messages go after they cannot be processed (poison payloads, permanent 4xx, retries exhausted), so the main flow keeps moving.

**Mechanism by broker:**

- **SQS:** a redrive policy with maxReceiveCount moves a message after N receives; DLQ redrive (StartMessageMoveTask) moves it back. For standard queues the message keeps its original enqueue timestamp, so the DLQ's retention must exceed the source's or messages can expire soon after landing.
- **RabbitMQ 4.x quorum queues:** delivery-limit defaults to 20; after that the message is dead-lettered to a DLX if one is configured, otherwise dropped.
- **Kafka:** no broker-side DLQ for classic consumers; the application publishes to a DLT with headers (error, stack, original topic/partition/offset, attempt count) and then commits. Share groups in 4.2 count deliveries and archive a record after the limit, still without a built-in DLQ.

**Design checklist:** classify errors (permanent → DLQ at once; transient → retry tiers first), alert on the DLQ arrival rate rather than depth alone, name an owning team, keep the full payload, and build an idempotent, rate-limited redrive that can filter by error type.

**#1 interview trap:** a DLQ on an ordered stream. Parking event v2 for a key while v3 is applied means the entity state is now wrong, and redriving v2 later makes it worse. Ordered streams need per-key blocking or version checks.`,
      keyPoints: [
        'DLQ arrival rate is the alert; depth alone hides a slow leak.',
        'Check the retention clock: SQS standard keeps the original enqueue time.',
        'Redrive must be idempotent, throttled and version-aware.',
      ],
      source: 'AWS SQS developer guide; RabbitMQ 4.0 quorum queue blog',
    },
    {
      heading: 'Exactly-once semantics — what Kafka actually guarantees',
      body: `**What it is:** in Kafka, "exactly-once" means a consume-transform-produce step has its output records and its input offsets committed atomically — either all become visible or none do.

**Three parts:**

1. **Idempotent producer** (default since Kafka 3.0): producer id + per-partition sequence numbers let the broker drop duplicate retries of the same batch.
2. **Transactions:** a transactional.id identifies the producer across restarts; sendOffsetsToTransaction puts consumer offsets in the same transaction; an epoch fences zombie instances. Since KIP-447 (EOS v2), fencing also uses consumer group metadata, so one producer per instance is enough. KIP-890 (Kafka 4.0) bumps the epoch on every transaction to stop hanging and zombie transactions.
3. **read_committed consumers** skip aborted records and wait at the last stable offset. The Java consumer defaults to read_uncommitted — a common silent gap.

**Scope limits:** nothing outside Kafka is covered. An HTTP call, email or Postgres write inside the transaction can happen twice when the transaction aborts and retries. For those, use idempotency keys, an inbox table (processed message ids with a unique constraint written in the same DB transaction as the effect), or the outbox pattern. KIP-939 (2PC participation for dual writes) is in progress — check release notes before relying on it.

**#1 interview trap:** saying "exactly-once delivery". What you get is exactly-once *effect* within Kafka, built on at-least-once delivery plus deduplication.`,
      source: 'Apache Kafka KIP-447, KIP-890, KIP-939; Confluent — Transactions in Apache Kafka',
    },
    {
      heading: 'Retries — transient only, one layer, on a budget',
      body: `**What it is:** re-attempting a failed call because the failure is probably temporary.

**Mechanism:** retry only transient failures — connection reset, 503, 429 (after Retry-After), gRPC UNAVAILABLE — and only when the operation is idempotent or carries an idempotency key that stays **the same across attempts**. Use capped exponential backoff with full jitter: sleep = random(0, min(cap, base × 2^attempt)). Stop when the caller's deadline cannot accommodate another attempt.

**Retry budgets:** per-request limits do not bound fleet load. At 3 retries, a hard outage turns 1× traffic into 4×. A budget (a token bucket where each success deposits 0.1 tokens and each retry spends 1, or gRPC's retryThrottling with maxTokens/tokenRatio) caps retries at ~10% of traffic, so the same outage costs ~1.1×. The AWS SDKs have shipped this client-side retry token bucket for years.

| Failure | Retry? |
|---|---|
| ECONNRESET, 502/503, UNAVAILABLE | yes, backoff + jitter |
| 429 with Retry-After | yes, after the header's delay |
| Timeout on a non-idempotent POST | only with an idempotency key |
| 400/401/403/404/409/422 | never |

**#1 interview trap:** retrying at every layer. Five layers × 3 retries = 4^5 ≈ 1,024 calls at the bottom. Retry at the layer closest to the failure; everyone else fails fast.`,
      code: [
        {
          language: 'typescript',
          title: 'Retry token bucket (budget) shared per downstream',
          code: `export class RetryBudget {
  private tokens: number;
  constructor(private readonly max = 100, private readonly ratio = 0.1) {
    this.tokens = max;
  }
  onSuccess(): void {
    this.tokens = Math.min(this.max, this.tokens + this.ratio); // 10 successes earn 1 retry
  }
  tryRetry(): boolean {
    if (this.tokens < 1) return false; // budget exhausted: fail fast instead of amplifying
    this.tokens -= 1;
    return true;
  }
}

export const fullJitter = (attempt: number, baseMs = 100, capMs = 5_000) =>
  Math.random() * Math.min(capMs, baseMs * 2 ** attempt);`,
        },
      ],
      source: "Amazon Builders' Library — Timeouts, retries and backoff with jitter",
    },
    {
      heading: 'Timeouts — stop waiting AND stop working',
      body: `**What it is:** an upper bound on how long a caller waits for a dependency, which turns a slow failure (resource leak) into a fast one (bounded cost).

**Mechanism:** use separate budgets. A **connect timeout** is small (in-region handshakes take ~1 ms, so 100–500 ms is generous); a **request timeout** is set from the dependency's measured p99–p99.9 plus headroom, never a library default (Node's http has no response timeout by default). The edge assigns an **absolute deadline**; every hop passes it down (for example an x-request-deadline header or a gRPC deadline) and uses remaining budget minus a margin, refusing to start work that cannot finish.

**Cancellation is the part people miss:** Promise.race with a timer returns early, but the socket, the upstream work and the pooled connection stay busy. Real cancellation means AbortSignal.timeout() on fetch/undici, statement_timeout (or query cancellation) on Postgres, and checking the deadline before each expensive step.

| Layer | Typical setting |
|---|---|
| Edge / gateway | total SLA, e.g. 1–2 s |
| Service → service | remaining deadline − 20–50 ms |
| Postgres | statement_timeout per role, e.g. 2 s OLTP |
| Kafka consumer handler | < max.poll.interval.ms, with its own per-call timeouts |

**#1 interview trap:** equal timeouts at every layer (1 s, 1 s, 1 s). The outer layer gives up while inner layers keep working on requests nobody will read.`,
      code: [
        {
          language: 'typescript',
          title: 'Deadline-aware call that really cancels',
          code: `export async function callWithDeadline(url: string, deadlineAt: number) {
  const remaining = deadlineAt - Date.now() - 30; // keep a margin for our own response
  if (remaining <= 0) throw new Error('DEADLINE_EXCEEDED'); // do not start doomed work
  const res = await fetch(url, {
    signal: AbortSignal.timeout(remaining), // aborts the socket, frees the pool slot
    headers: { 'x-request-deadline': String(deadlineAt) }, // downstream uses the same budget
  });
  if (!res.ok) throw new Error('HTTP_' + res.status);
  return res.json();
}`,
        },
      ],
      source: 'Google SRE Book — Ch 22 Addressing Cascading Failures (deadline propagation)',
    },
    {
      heading: 'Circuit Breaker — fail fast when a dependency is clearly broken',
      body: `**What it is:** a state machine around a dependency. When recent calls mostly fail, it stops sending traffic for a while, which saves the caller's resources and gives the dependency room to recover.

**Mechanism:** CLOSED (track failure rate over a rolling window with a minimum volume) → OPEN (reject immediately, run the fallback) → after a reset timeout, HALF-OPEN (let a few probes through) → CLOSED on success or back to OPEN. Slow calls should count as failures (opossum's timeout option; Resilience4j's slowCallRateThreshold).

**Scope and what counts:**

- **Scope = failure domain.** One breaker for a whole payment provider opens charges when only refunds are broken. Scope by endpoint or host; for tenant-specific failures, by tenant.
- **Count dependency failures only:** 5xx, timeouts and connection errors. A caller's 400/404/409 says nothing about dependency health (use opossum's errorFilter or Resilience4j's ignoreExceptions).
- **Order with retries:** Resilience4j's default decoration is Retry(CircuitBreaker(RateLimiter(TimeLimiter(Bulkhead(call))))). Retries sit outside, so each attempt is counted, and a CallNotPermitted rejection must not be retried.

**#1 interview trap:** constructing the breaker inside the request handler. Each request gets a fresh CLOSED breaker with no history, so it never opens. Breakers are long-lived, one per dependency scope.`,
      diagram: `            failure% > 50 over >= 20 calls
   CLOSED ------------------------------------> OPEN (fail fast, fallback)
     ^                                            |
     | probes succeed                             | resetTimeout (e.g. 30s)
     |                                            v
     +----------------------------------------- HALF-OPEN (1-5 probes)
                  probe fails -> back to OPEN`,
      source: 'Michael Nygard — Release It! (2nd ed); Resilience4j docs (decorator order)',
    },
    {
      heading: 'Backpressure — make the producer slow down',
      body: `**What it is:** a signal from a slower stage to a faster one that says "send less", so that queues stay bounded instead of growing until something runs out of memory.

**Mechanism:** backpressure is either built in, or you add it:

- **Pull-based systems** have it natively: a Kafka consumer only fetches what it polls; you add backpressure by pausing partitions (consumer.pause / resume) when your in-process work queue is full.
- **Node streams:** writable.write() returns false when its buffer passes highWaterMark; wait for 'drain'. stream.pipeline() does this for you and propagates errors.
- **HTTP/gRPC:** 429/503 with Retry-After, HTTP/2 flow-control windows, gRPC RESOURCE_EXHAUSTED.
- **Credit-based:** RabbitMQ prefetch (basic.qos), SQS MaxNumberOfMessages — the consumer only gets as many messages as it can hold.

The rule: **every queue must be bounded**, and when a bound is hit something must happen on purpose — block the producer (backpressure), reject new work (shedding), or drop low-value work (degradation).

**#1 interview trap:** "we use a queue, so we have backpressure". A queue absorbs a burst; it does not slow producers. If the average arrival rate exceeds the service rate, the queue grows without limit and latency becomes infinite — you just moved the overload.`,
      diagram: `  push without backpressure:  producer 5k/s --> [ buffer grows ∞ ] --> worker 2k/s  (OOM)
  with backpressure:          producer <-- pause / 429 / credits --- [ bounded 1k ] --> worker 2k/s`,
      source: 'Node.js docs — Backpressuring in streams; kafkajs docs — pause/resume',
    },
    {
      heading: 'Load shedding — refuse work you cannot finish in time',
      body: `**What it is:** deliberately rejecting some requests when overloaded, so the ones you accept still finish within their deadline. It protects **goodput** — throughput that is both successful and fast enough to be useful.

**Mechanism:** without shedding, an overloaded server accepts everything, queue wait exceeds the client timeout, and it spends 100% of its CPU on responses nobody reads: throughput is high and goodput is zero. The fix is to reject early and cheaply:

- **Signals:** in-flight concurrency above a limit (Little's law: limit ≈ capacity RPS × target latency), queue wait above the client's deadline, event-loop lag, CPU.
- **Policies:** bounded queue with a maximum wait; adaptive LIFO under overload with CoDel-style queue timeouts (as described in Facebook's Fail at Scale), so fresh requests get served; priority tiers (Netflix's prioritized shedding in Zuul, Uber's Cinnamon uses priorities plus a PID-style controller).
- **Response:** 503 or 429 with Retry-After, returned in microseconds, before expensive work.

**Priority order to shed:** prefetch/speculative and batch traffic → retries (mark attempt numbers in a header) → non-critical reads → critical user writes last. Never shed health checks blindly: failing the load balancer's check pulls the instance and piles its load onto the rest.

**#1 interview trap:** "autoscaling handles overload". Scaling takes minutes; overload collapse takes seconds. Shedding is what keeps you alive until the new capacity arrives.`,
      source: "Amazon Builders' Library — Using load shedding to avoid overload; Netflix TechBlog; Uber Engineering (Cinnamon)",
    },
    {
      heading: 'Graceful degradation — a smaller product, on purpose',
      body: `**What it is:** when a dependency or capacity is lost, you keep the core journey working by serving a reduced experience — stale data, defaults, hidden widgets — instead of an error page.

**Mechanism:** decide in advance, per feature, what "degraded" means, and implement it as a **degradation ladder** that can be switched by automatic triggers (breaker open, shedding level) or by an operator's kill switch:

1. Serve from cache with a staleness bound (last-known-good recommendations, prices re-validated at checkout).
2. Replace personalised content with static or precomputed defaults (top sellers per city, computed hourly).
3. Hide non-critical features (reviews, "people also bought", live tracking animations).
4. Switch writes to async (accept the order, confirm by notification later).
5. Read-only mode as a last resort.

**Rules that separate seniors:**

- A fallback must be **cheaper and more independent** than the thing it replaces. "If the cache fails, query the DB" moves the load onto the component most likely to be struggling.
- **Correctness-critical data does not degrade to stale:** balances, stock at checkout and prices at payment are re-validated or the step fails clearly.
- The flag/config system must **fail static** — last-known values baked into the pod — or the kill switch dies with the outage.
- Test fallbacks with game days; untested fallback paths rot.

**#1 interview trap:** fallbacks that are never exercised until the outage, and then turn out to be broken, slow or pointed at the same failing dependency.`,
      source: 'Netflix TechBlog — resilience and fallbacks; Google SRE Workbook — Managing load',
    },
  ],
  codeChallenges: [
    {
      id: 'misc-async-resilience-cc-1',
      title: 'Add admission control to a service that collapses under overload',
      context:
        'A NestJS/Express service fronts a pricing engine that can do ~400 concurrent requests per pod at ~80 ms each. Clients (the BFF) time out after 1 s. During a flash sale, p99 went to 12 s, success rate dropped to 3%, and the Kubernetes liveness probe started failing, so pods were restarted in a loop. The current middleware "helps" by queueing requests.',
      task: 'Rewrite the admission middleware so the pod keeps high goodput under 3× overload: bounded concurrency, bounded queue wait tied to the caller deadline, priority-aware rejection, cheap fast rejections, and health checks that are never shed. Keep it dependency-free.',
      starter: {
        language: 'typescript',
        title: 'admission.ts (naive)',
        code: `import type { Request, Response, NextFunction } from 'express';

const MAX_IN_FLIGHT = 400;
let inFlight = 0;
const waiting: Array<() => void> = []; // unbounded FIFO

export function admission(req: Request, res: Response, next: NextFunction) {
  const start = () => {
    inFlight++;
    res.on('finish', () => {
      inFlight--;
      const nextWaiter = waiting.shift(); // oldest first, even if its client gave up
      if (nextWaiter) nextWaiter();
    });
    next();
  };
  if (inFlight < MAX_IN_FLIGHT) return start();
  waiting.push(start); // every request eventually runs, no matter how late
}

// app.use(admission); app.get('/healthz', ...) is registered AFTER admission`,
      },
      hints: [
        'What is the value of a request that waited 1.2 s in your queue when its client gave up at 1 s? How do you detect that before doing the work?',
        'Under sustained overload, which request is more likely to still have a live client: the oldest waiter or the newest?',
        "What happens to the pod when the load balancer's health check waits behind 5,000 queued requests? Also: does 'finish' fire if the client disconnects?",
      ],
      solution: {
        language: 'typescript',
        title: 'admission.ts (production)',
        code: `import type { Request, Response, NextFunction } from 'express';

type Priority = 0 | 1 | 2; // 0 = critical (checkout), 1 = normal, 2 = sheddable (prefetch, batch)
interface Waiter { run: () => void; enqueuedAt: number; deadlineAt: number; priority: Priority; res: Response }

const MAX_IN_FLIGHT = 400;        // ≈ capacity: 400 conc / 0.08 s ≈ 5K rps per pod
const MAX_QUEUE = 800;            // hard bound on memory and wait
const DEFAULT_BUDGET_MS = 1_000;  // caller timeout when no deadline header is sent
const EXEMPT = new Set(['/healthz', '/readyz', '/metrics']);

let inFlight = 0;
const queue: Waiter[] = [];

const priorityOf = (req: Request): Priority => {
  if (req.header('x-retry-attempt')) return 2;                 // shed retries before first attempts
  const p = Number(req.header('x-priority'));
  return p === 0 || p === 1 || p === 2 ? (p as Priority) : 1;
};

const reject = (res: Response, reason: string) => {
  if (res.headersSent) return;
  res.set('Retry-After', '1').status(503).json({ error: 'overloaded', reason }); // cheap, before any real work
};

function release() {
  inFlight--;
  const now = Date.now();
  // Drop waiters whose caller has already given up: no point doing their work
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].deadlineAt <= now || queue[i].res.writableEnded) {
      reject(queue[i].res, 'deadline');
      queue.splice(i, 1);
    }
  }
  // Serve highest priority first; within a priority, newest first (adaptive LIFO under overload)
  let best = -1;
  for (let i = 0; i < queue.length; i++) {
    if (best === -1 || queue[i].priority < queue[best].priority ||
        (queue[i].priority === queue[best].priority && queue[i].enqueuedAt > queue[best].enqueuedAt)) best = i;
  }
  if (best >= 0) queue.splice(best, 1)[0].run();
}

export function admission(req: Request, res: Response, next: NextFunction) {
  if (EXEMPT.has(req.path)) return next(); // never shed probes: failing them moves load onto peers

  const now = Date.now();
  const hdr = Number(req.header('x-request-deadline'));
  const deadlineAt = Number.isFinite(hdr) && hdr > now ? hdr : now + DEFAULT_BUDGET_MS;
  const priority = priorityOf(req);

  const start = () => {
    inFlight++;
    let done = false;
    const finish = () => { if (!done) { done = true; release(); } };
    res.on('finish', finish);
    res.on('close', finish); // client disconnects also free the slot
    next();
  };

  if (inFlight < MAX_IN_FLIGHT) return start();
  if (priority === 2) return reject(res, 'sheddable');               // lowest tier never queues
  if (queue.length >= MAX_QUEUE) {
    // Evict the worst queued request if the newcomer is more important, else reject the newcomer
    const worst = queue.reduce((w, q, i) => (q.priority > queue[w].priority ? i : w), 0);
    if (queue[worst].priority <= priority) return reject(res, 'queue_full');
    reject(queue[worst].res, 'evicted');
    queue.splice(worst, 1);
  }
  queue.push({ run: start, enqueuedAt: now, deadlineAt: deadlineAt - 80, priority, res }); // 80 ms ≈ service time
}

// Register admission AFTER the probe routes, or keep the EXEMPT check as above.`,
      },
      explanation: `**Fixes, one by one:**

- **Bounded queue (800) with deadline-based expiry:** the naive FIFO grew without limit, so every request waited longer than the 1 s client timeout and the pod did 100% useless work (zero goodput). Now a waiter whose deadline, minus the ~80 ms service time, has passed is rejected without running.
- **Deadline propagation:** the caller's x-request-deadline (or a 1 s default) decides how long a request may wait. This matches the client's real timeout instead of an arbitrary constant.
- **Adaptive LIFO within a priority:** under overload the newest waiter is the most likely to still have a live client; FIFO serves the requests that are about to expire.
- **Priority tiers:** retries (x-retry-attempt) and sheddable traffic are rejected first and never queue; critical requests can evict lower-priority waiters when the queue is full.
- **Fast, cheap rejections:** 503 + Retry-After before auth, DB or pricing work, so rejecting costs microseconds and clients back off.
- **Probes exempt:** in the starter, /healthz queued behind thousands of requests, failed liveness, and Kubernetes restarted pods — each restart moved load onto the survivors. Probes now bypass admission.
- **Slot leak on disconnect:** 'finish' does not fire when the client aborts; listening to 'close' with a once-only guard frees the slot.`,
      followUps: [
        {
          "q": "This middleware runs per pod. 50 pods behind a load balancer each shed independently. Is per-pod admission enough, or do you need something global?",
          "a": "Per-pod admission is the right first layer: overload is local (CPU and connections on that pod) and decisions are instant without coordination. It still has gaps. An unbalanced load balancer can overload some pods while others idle, so use least-request balancing. Global quotas per tenant or client need a shared limiter at the edge (Redis token bucket or gateway rate limits) so one customer can't take 80% of fleet capacity. And clients need retry budgets, so the 503s don't cause synchronized retries across all pods. Admission protects the pod; fairness and amplification control live at the edge and in the client."
        },
        {
          "q": "How do you choose MAX_IN_FLIGHT in practice instead of guessing 400, and how do you verify the middleware under 3× load?",
          "a": "Measure. Run a load test that ramps traffic against a single pod while tracking throughput and p99. Throughput plateaus at the knee (say 5K rps) and latency climbs sharply after it. Concurrency at the knee (throughput × latency) is your limit, minus a little headroom. Verify with k6 at 3× capacity and a 1 s client timeout: assert goodput (2xx within 1 s) stays close to capacity, rejected requests return 503 in under 5 ms, `/healthz` p99 stays low, no pod restarts happen, and the queue never exceeds 800. Watch event-loop lag; if it climbs, the limit is too high for CPU-bound work."
        }
      ],
    },
    {
      id: 'misc-async-resilience-cc-2',
      title: 'Give a Kafka consumer real backpressure and honest lag',
      context:
        'A kafkajs consumer enriches clickstream events by calling a geo-IP service (p50 15 ms, p99 250 ms, rate-limited to 2,000 rps per pod). The team made it "fast" by firing all work concurrently. Dashboards show lag at ~0, yet pods get OOM-killed several times a day, and after every OOM analytics finds gaps of tens of thousands of events. Poison events (malformed JSON) sometimes crash the batch.',
      task: 'Rewrite the consumer so memory is bounded, the geo-IP limit is respected, offsets are committed only for work that is actually done, lag reflects real backlog, and poison events go to a DLT with enough metadata to redrive.',
      starter: {
        language: 'typescript',
        title: 'enricher.ts (naive)',
        code: `import { Kafka } from 'kafkajs';
import { lookupGeo, saveEnriched } from './deps';

const kafka = new Kafka({ clientId: 'enricher', brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'click-enricher' });

export async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'clicks.v1' });
  await consumer.run({
    eachBatchAutoResolve: true,
    eachBatch: async ({ batch }) => {
      for (const message of batch.messages) {
        const event = JSON.parse(message.value!.toString()); // throws on poison -> whole batch retried
        // fire-and-forget: the loop finishes instantly, offsets get resolved and committed
        lookupGeo(event.ip)
          .then((geo) => saveEnriched({ ...event, geo }))
          .catch((err) => console.error('enrich failed', err)); // failures silently dropped
      }
    },
  });
}`,
      },
      hints: [
        'When does kafkajs consider an offset done with eachBatchAutoResolve: true, and when does your work actually finish?',
        'How many promises can be outstanding if the broker hands you 10,000 records per batch and every batch returns immediately?',
        'You cannot process a partition out of order and still commit a single offset per partition. What must be true about every offset before the one you commit?',
      ],
      solution: {
        language: 'typescript',
        title: 'enricher.ts (production)',
        code: `import { Kafka, type EachBatchPayload, type KafkaMessage } from 'kafkajs';
import { lookupGeo, saveEnriched } from './deps';

const kafka = new Kafka({ clientId: 'enricher', brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'click-enricher', maxBytesPerPartition: 512 * 1024 });
const producer = kafka.producer({ idempotent: true });

const MAX_CONCURRENCY = 32;      // 32 in flight × ~15 ms ≈ 2,000 rps: the geo-IP limit per pod
const GEO_TIMEOUT_MS = 400;      // above p99 250 ms, well below the rebalance timeout

async function withLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers); // resolves only when every item is finished
}

async function toDlt(topic: string, partition: number, m: KafkaMessage, err: unknown) {
  await producer.send({
    topic: 'clicks.v1.dlt',
    messages: [{
      key: m.key, value: m.value,
      headers: {
        'x-original-topic': topic, 'x-original-partition': String(partition),
        'x-original-offset': m.offset, 'x-error': String(err).slice(0, 500),
        'x-failed-at': new Date().toISOString(),
      },
    }],
  });
}

async function handle(topic: string, partition: number, m: KafkaMessage) {
  let event: { ip: string };
  try { event = JSON.parse(m.value!.toString()); }
  catch (err) { return toDlt(topic, partition, m, err); }          // poison: park it, keep the partition moving
  try {
    const geo = await lookupGeo(event.ip, { signal: AbortSignal.timeout(GEO_TIMEOUT_MS) });
    await saveEnriched({ ...event, geo }, { idempotencyKey: topic + ':' + partition + ':' + m.offset });
  } catch (err) {
    await toDlt(topic, partition, m, err); // retries/tiers could go here; never drop silently
  }
}

export async function run() {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: 'clicks.v1' });
  await consumer.run({
    partitionsConsumedConcurrently: 3,  // bounded parallelism across partitions
    eachBatchAutoResolve: false,        // we decide which offsets are done
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale }: EachBatchPayload) => {
      const CHUNK = 200;                // bounded memory per partition
      for (let start = 0; start < batch.messages.length; start += CHUNK) {
        if (!isRunning() || isStale()) return;   // revoked mid-batch: stop, the new owner resumes from the commit
        const chunk = batch.messages.slice(start, start + CHUNK);
        await withLimit(chunk, MAX_CONCURRENCY, (m) => handle(batch.topic, batch.partition, m));
        resolveOffset(chunk[chunk.length - 1].offset); // every offset up to here is finished
        await heartbeat();
        await commitOffsetsIfNecessary();
      }
    },
  });
}`,
      },
      explanation: `**What was wrong and how each fix works:**

- **Lag lied, data was lost:** with auto-resolve and fire-and-forget promises, offsets were committed as soon as the loop *scheduled* work. Lag read ~0 while tens of thousands of lookups sat in memory; an OOM lost all of them. Now offsets are resolved only after every message in the chunk has finished, so the committed offset is always a safe restart point and lag reflects real backlog.
- **No backpressure → OOM:** the handler returned instantly, so kafkajs kept fetching. Now eachBatch awaits bounded work, so the consumer does not fetch more than it can process — pull-based backpressure. maxBytesPerPartition, CHUNK and partitionsConsumedConcurrently bound memory.
- **Rate limit respected:** 32 concurrent calls × ~15 ms ≈ 2,000 rps, matching the geo-IP limit instead of bursting thousands of calls.
- **Timeouts that cancel:** AbortSignal.timeout on the lookup, well under the rebalance timeout, so one slow call cannot stall the partition until the group kicks the member out.
- **Poison and failed events go to a DLT** with original topic/partition/offset, error and timestamp headers, so they can be inspected and redriven; nothing is swallowed with a console.error.
- **Idempotent writes:** topic:partition:offset is a stable idempotency key, so redelivery after a crash or rebalance does not duplicate enriched rows.
- **Rebalance-safe:** isRunning/isStale stop work on a revoked partition, and heartbeat keeps the member alive during long batches.`,
      followUps: [
        {
          "q": "Geo-IP has a 2-minute outage. With this code every event in that window goes to the DLT. Is that what you want, and what would you change?",
          "a": "No. The DLT should be for poison events, not dependency outages; dumping 2 minutes × several thousand events/s into it creates a large redrive job for a transient issue. Distinguish failures: parse and validation errors go straight to the DLT; timeouts and 5xx from geo-IP trigger backoff. Use a circuit breaker; when it opens, pause the partitions (don't resolve offsets) and resume when a probe succeeds. Messages stay in Kafka, which is already a durable buffer. Use retry tiers only for per-message transient failures. The DLT rate then stays near zero and alerts on it remain meaningful."
        },
        {
          "q": "withLimit processes a chunk of 200 and waits for all of them. One slow message at p99 250 ms holds back the next chunk. How would you improve throughput without breaking commit safety?",
          "a": "Replace chunk barriers with a sliding window and a commit watermark. Keep up to 32 messages in flight continuously, starting a new one as soon as any finishes. Track completion per offset, and resolve only the highest contiguous completed offset (if 100–150 are done except 120, the watermark is 119). Commit safety holds because everything at or below the watermark is complete. The heartbeat still fires periodically. Bound the window in offsets (for example no more than 1,000 beyond the watermark) so one stuck message can't let memory grow unbounded."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'misc-async-resilience-iq-01',
      difficulty: 'medium',
      question:
        'Rapid-fire: for a background-job system (render invoices, send emails), when do you pick SQS or RabbitMQ over Kafka — and does Kafka 4.2 share groups change that answer?',
      whatInterviewerLooksFor: [
        'Frames the choice as queue semantics (per-message ack, redelivery) vs log semantics (offsets, replay)',
        'Knows the partition-count parallelism ceiling of classic consumer groups',
        'Is current on share groups (KIP-932) and their limits',
        'Picks based on operations cost, not hype',
      ],
      modelAnswer: `**Default for jobs: a queue.** Invoice rendering and emails are independent units of work: nobody replays them, order rarely matters, and each job needs its own redelivery and retry count. SQS or RabbitMQ give that per message: one slow 40-second PDF does not block the next job, and a DLQ after N receives comes built in. Scaling is simply "add workers".

**Kafka in a classic group** fits jobs badly: a partition is owned by one consumer, so parallelism is capped by partitions, a slow record blocks everything behind it in that partition, and the offset model forces you to build retry topics and DLTs yourself.

**Share groups (production-ready in Kafka 4.2)** narrow the gap: many consumers read the same partition, each record is acquired with a lock timeout, acknowledged individually (accept, release, reject, and renew for long work), and delivery attempts are counted. So if the company already runs Kafka and the jobs are also useful as a replayable stream, share groups are now a reasonable choice. Caveats: no per-key ordering, no built-in DLQ (records past the delivery limit are archived), and client support outside Java is still young.

**Say:** "Queue for jobs, log for facts. If Kafka is already the platform, share groups let me avoid a second broker for simple job workloads."`,
      followUps: [
        {
          q: 'The jobs must run in order per customer. Does your choice change?',
          a: 'Yes. Use SQS FIFO with MessageGroupId = customerId, or Kafka keyed by customerId in a classic group. Share groups give up ordering. Per-group ordering also means one poison job blocks that customer, so a DLQ policy per group matters.',
        },
        {
          q: 'One tenant enqueues 2M jobs and everyone else waits. Fix?',
          a: 'Tenant fairness: SQS fair queues (MessageGroupId as tenant on standard queues), per-tenant queues with weighted round-robin workers, or per-tenant concurrency caps in the worker. Also rate-limit enqueue per tenant.',
        },
      ],
      pitfalls: [
        'Picking Kafka for every async use case "because it scales"',
        'Claiming Kafka cannot have more consumers than partitions without mentioning share groups',
        'Ignoring retry and DLQ needs when choosing',
      ],
    },
    {
      id: 'misc-async-resilience-iq-02',
      difficulty: 'hard',
      question:
        'Your API writes an order row and then enqueues a "send confirmation" job to a queue. About 1 in 5,000 orders gets a confirmation email for an order that does not exist, and some real orders never get one. Explain both bugs and fix them.',
      whatInterviewerLooksFor: [
        'Identifies the dual-write problem between DB and queue',
        'Explains both orderings: enqueue-before-commit and commit-then-crash-before-enqueue',
        'Proposes a transactional outbox (or enqueue-after-commit plus reconciliation) with idempotent consumers',
        'Mentions the worker read race when enqueue happens inside the transaction',
      ],
      modelAnswer: `**Bug 1 — phantom confirmations.** The job is enqueued *inside* the DB transaction. Two outcomes:

- The transaction later rolls back (constraint violation, payment decline, deadlock retry) — the job is already in the queue, so the email goes out for an order that never existed.
- A fast worker picks up the job before the commit becomes visible and reads nothing, or reads a half-written state.

**Bug 2 — missing confirmations.** Where the enqueue happens *after* commit, a pod crash, deploy or queue timeout between commit and enqueue loses the job. No retry exists because the request already returned 200.

Both are the **dual-write problem**: two systems, no shared transaction.

**Fix: transactional outbox.**

1. In the same transaction as the order, insert into an outbox table: id, aggregate id, type, payload, created_at.
2. A relay (a poller using FOR UPDATE SKIP LOCKED, or CDC such as Debezium) publishes outbox rows to the queue and marks them sent.
3. The relay is at-least-once, so the consumer is **idempotent**: dedupe on the outbox id (an inbox table with a unique constraint, or the email provider's idempotency key).

Now a rolled-back order produces no outbox row, and a committed order always produces a message eventually. Latency is ~100 ms–1 s with polling, less with CDC.

**Cheaper alternative** when the effect is low-stakes: enqueue after commit, plus a sweeper that finds orders older than 5 minutes without a confirmation_sent_at and enqueues them. That is simpler, but it is really a poor man's outbox.

**Operational details:** index the outbox on (sent_at IS NULL, created_at), delete or partition old rows, alert on the age of the oldest unsent row, and keep payload versions explicit.`,
      followUps: [
        {
          q: 'Why not just use a distributed transaction (XA) across Postgres and RabbitMQ?',
          a: 'XA is slow, poorly supported by modern brokers and cloud queues, and couples availability — if the broker is down, orders cannot commit. The outbox keeps order writes available and moves delivery to an async, retryable path.',
        },
        {
          q: 'The relay publishes, then crashes before marking the row sent. What happens?',
          a: 'It publishes again after restart — a duplicate. That is expected with at-least-once; the consumer dedupes on the outbox id. Never try to make the relay exactly-once; make the consumer idempotent.',
        },
        {
          q: 'How do you keep per-order ordering through the outbox?',
          a: 'Publish in outbox id order per aggregate and use the aggregate id as the message key or group id (Kafka key, SQS FIFO MessageGroupId). A single relay per shard of aggregates avoids reordering.',
        },
      ],
      pitfalls: [
        'Only fixing one ordering and creating the other bug',
        'Suggesting "retry the enqueue" without handling a crash between steps',
        'Forgetting the consumer must be idempotent because the relay is at-least-once',
      ],
    },
    {
      id: 'misc-async-resilience-iq-03',
      difficulty: 'medium',
      question:
        'Rapid-fire: a topic has 12 partitions. What does that number actually control, and what does it cost you to pick 12 versus 120?',
      whatInterviewerLooksFor: [
        'Ordering scope, parallelism ceiling and key mapping',
        'Costs of many partitions: metadata, open files, replication, recovery, rebalance time',
        'Knows increasing partitions later remaps keys',
        'Gives sizing heuristics from throughput per consumer',
      ],
      modelAnswer: `**What 12 controls:**

- **Ordering scope:** order is guaranteed only within a partition; all events for a key go to hash(key) mod 12.
- **Parallelism ceiling:** in a classic consumer group at most 12 members do work; a 13th is idle (share groups lift this, at the cost of ordering).
- **Throughput per partition:** each partition is a sequential log on one leader; ~10–50 MB/s per partition is a sane planning range.
- **Skew:** with fewer partitions, one hot key has a bigger effect on its partition's peers.

**12 vs 120:**

| | 12 | 120 |
|---|---|---|
| Max consumers | 12 | 120 |
| Rebalance / assignment work | small | larger (worse with eager classic protocol) |
| Broker cost | few files, cheap replication | 10× segments, file handles, replica fetchers, longer leader elections |
| Producer batching | bigger batches per partition | batches spread thinner, more requests |

**Sizing rule:** partitions ≥ max(target throughput ÷ per-partition write rate, target throughput ÷ per-consumer processing rate) with 2–3× headroom, because adding partitions later changes hash(key) mod N and breaks per-key order for in-flight data. For a topic needing 30K events/s where a consumer does 1K/s, that means ≥30, so pick ~48–64.`,
      followUps: [
        {
          q: 'You must go from 12 to 48 partitions on a keyed topic. How do you do it safely?',
          a: 'Either create a new 48-partition topic and migrate consumers (dual-read, cut over by offset or timestamp), or pause producers, drain consumers to zero lag, then add partitions so no in-flight key has history in the old partition. The first is safer.',
        },
        {
          q: 'Does the partition count affect end-to-end latency?',
          a: 'Indirectly: more partitions means smaller per-partition batches (more requests at the same linger.ms) and more replication work; fewer partitions can cause queueing behind a hot key. The biggest latency factors remain linger.ms, acks and consumer processing time.',
        },
      ],
      pitfalls: [
        'Saying more partitions is always better',
        'Forgetting that adding partitions breaks key-to-partition stability',
        'Confusing partitions with replicas',
      ],
    },
    {
      id: 'misc-async-resilience-iq-04',
      difficulty: 'expert',
      question:
        'Design an order-event processor: 200K events/min, strict ordering per orderId, at-least-once delivery, idempotent downstream effects, and p95 end-to-end latency under 1 second. Include how you handle backpressure and how you would know it is healthy.',
      context:
        'Reported in Swiggy SDE-2 system design / bar-raiser rounds (2025, via InterviewExperiences.in, aggregated by InterviewBee): a Kafka-backed order event processor with per-order ordering, at-least-once, idempotency, backpressure and observability requirements.',
      whatInterviewerLooksFor: [
        'Converts 200K/min into per-second numbers and partition math',
        'Keys by orderId and keeps per-key order while still processing in parallel',
        'Idempotency with per-order versioning, not just message-id dedupe',
        'Handles retries and poison events without breaking per-order order',
        'Concrete lag/latency SLIs and backpressure mechanism',
      ],
      modelAnswer: `**Numbers:** 200K/min ≈ 3.3K events/s average; plan for 3× peak ≈ 10K/s. At ~1 KB per event that is ~10 MB/s — small for Kafka. The hard parts are ordering, idempotency and latency.

**Topic:** order-events keyed by orderId, 48 partitions (a consumer doing ~500 events/s with DB writes needs 20 at peak; 48 leaves headroom and avoids repartitioning), RF 3, min.insync.replicas 2, acks=all, idempotent producer, linger.ms ~5.

**Producer side:** events come from an outbox in the order service, so a state change and its event commit together.

**Consumers:** 24 pods × 2 partitions. Inside a pod, parallelize **per key**, not per partition: hash orderId into N in-memory lanes, each processed sequentially. That keeps per-order order while using concurrency. Commit only the highest contiguous offset whose records are all done.

**Idempotency:** every event carries orderId and a monotonically increasing version. The projection does UPDATE ... WHERE order_id = $1 AND version < $2 — duplicates and stale replays become no-ops. Side effects (notifications, payouts) use idempotency keys like orderId:version:effect.

**Retries without breaking order:** transient errors retry in place with short backoff (the lane blocks, which is correct for that order). After ~5 attempts or a permanent error, mark the orderId **blocked**: park this event and every later event for that orderId in a parked table/DLT, alert, and keep other orders flowing. Redrive releases the order's events in version order.

**Backpressure:** bounded lanes; when the in-memory queue for a partition passes a high-water mark, consumer.pause() that partition and resume at the low-water mark. Downstream calls have timeouts and a breaker; if the DB slows, lag grows (visibly) instead of memory.

**Latency budget (p95 < 1 s):** outbox relay ~100–200 ms (CDC is faster than polling), Kafka ~10–20 ms, processing ~50–100 ms, leaving headroom for rebalances. Use static membership or KIP-848 so deploys do not stop the world.

**Health SLIs:** per-partition time lag (alert above ~30 s), end-to-end latency from event timestamp to apply time (p95, p99), parked-order count, DLT arrival rate and rebalance count per hour.`,
      followUps: [
        {
          q: 'One merchant produces 30% of events — a hot partition?',
          a: 'Keying is by orderId, not merchantId, so load spreads. If some aggregate is hot anyway, per-key lanes inside the pod still use parallelism across other keys; if a single key is hot, scale the per-key handler (batch its updates) rather than salting, because salting breaks its ordering.',
        },
        {
          q: 'How do you replay the last 6 hours after fixing a projection bug?',
          a: 'Start a new consumer group at a timestamp (offsetsForTimes) writing to a shadow table, rely on version checks for idempotency, then swap the tables. Kafka retention must cover the window — so set it to days, not hours.',
        },
        {
          q: 'Why not Kafka transactions for exactly-once here?',
          a: 'The effects land in Postgres and external services, outside Kafka transactions. Version-checked idempotent writes give the same effective outcome more cheaply.',
        },
      ],
      pitfalls: [
        'Processing a partition with Promise.all and losing per-order ordering',
        'Sending a failed event to a DLQ while later events for the same order continue',
        'Deduping only on message id, which misses stale replays',
        'No numbers for partitions or latency budget',
      ],
    },
    {
      id: 'misc-async-resilience-iq-05',
      difficulty: 'medium',
      question:
        'Rapid-fire: your platform team is upgrading to Kafka 4.x and wants to flip consumers to group.protocol=consumer. What changes for your application, and what does not?',
      whatInterviewerLooksFor: [
        'Knows KIP-848 is GA in 4.0 and opt-in',
        'Server-side assignment and broker-side session/heartbeat configs',
        'No global sync barrier, incremental reconciliation',
        'Knows which client configs become unsupported and that processing-time limits still apply',
      ],
      modelAnswer: `**What KIP-848 is:** the next-generation consumer rebalance protocol, GA in Kafka 4.0 and enabled per client with group.protocol=consumer (classic is still the default in 4.x).

**What changes:**

- **Assignment moves to the broker.** The group coordinator computes assignments with server-side assignors (uniform, range; configurable per group, overridable with group.remote.assignor). Custom client-side assignors are not supported.
- **No global barrier.** Members heartbeat, learn their target assignment and reconcile independently. Only a member losing a partition revokes it; everyone else keeps processing. Rebalances in large groups become much faster and less disruptive.
- **Configs move.** session.timeout.ms and heartbeat.interval.ms become broker-side group configs (group.consumer.session.timeout.ms, group.consumer.heartbeat.interval.ms); partition.assignment.strategy is unsupported on the client. Regex subscriptions are evaluated on the broker (RE2J syntax).
- **Migration:** online conversion of a classic group through a rolling restart is supported, with some limits (for example, rack-aware assignment is not fully supported yet).

**What does not change:**

- **max.poll.interval.ms** still applies: if your poll loop stalls on slow processing, the member is still removed. The protocol fixes coordination cost, not slow handlers.
- Offsets, commit semantics and at-least-once duplicates after revocation are unchanged, so handlers still need to be idempotent and commit on revoke.
- Client support varies: the Java client is GA; librdkafka-based clients were early access in 2025, so check your Node client before flipping.`,
      followUps: [
        {
          q: 'Your Node service uses kafkajs. Can it use KIP-848?',
          a: 'kafkajs implements the classic protocol itself and is effectively unmaintained, so no. You would move to a librdkafka-based client (such as Confluent\'s JavaScript client) with KIP-848 support, and test it before relying on it.',
        },
        {
          q: 'Does static membership still matter under KIP-848?',
          a: 'Less. Rebalances no longer stop unaffected members, but a restarting pod still loses and regains partitions unless it rejoins with the same instance id. Treat static membership as an optimization, not the fix.',
        },
      ],
      pitfalls: [
        'Believing KIP-848 fixes rebalances caused by slow processing',
        'Assuming it is on by default in Kafka 4.0',
        'Keeping client-side session.timeout.ms tuning and expecting it to apply',
      ],
    },
    {
      id: 'misc-async-resilience-iq-06',
      difficulty: 'hard',
      question:
        'Every rolling deploy of your 40-pod consumer group causes a ~3-minute throughput dip and a burst of duplicate side effects. You are on the classic protocol with the default eager assignor and auto-commit. Walk me through the fixes, in the order you would ship them.',
      whatInterviewerLooksFor: [
        'Counts rebalances per deploy (each pod leave/join)',
        'Explains duplicates from auto-commit plus revocation',
        'Orders fixes by effort/impact: commit on revoke, cooperative-sticky, static membership, deploy tuning, KIP-848',
        'Mentions graceful shutdown and idempotent handlers',
      ],
      modelAnswer: `**Why it happens:** a rolling deploy of 40 pods can trigger up to 80 rebalances (each pod leaving, then its replacement joining). With the **eager** assignor each one is stop-the-world: every member revokes every partition, rejoins and waits at the barrier. With auto-commit every 5 s, records processed since the last auto-commit are re-delivered to the new owner — the duplicates.

**Fixes, in shipping order:**

1. **Graceful shutdown + commit on revoke (hours of work).** On SIGTERM, stop fetching, finish in-flight records, commit synchronously, then leave the group. Commit in the partitions-revoked callback. Set terminationGracePeriodSeconds above the worst-case batch time. This removes most duplicates.
2. **Cooperative-sticky assignor.** Only partitions that actually move are revoked; the other ~39 pods keep working. Migrate with a two-step rolling bounce (add cooperative-sticky next to range, then remove range), because mixing incompatible strategies in one step fails.
3. **Static membership.** Give each pod a stable group.instance.id (the StatefulSet ordinal or pod name) and set session.timeout.ms above restart time (e.g. 60–90 s). A pod restarting within that window gets its old partitions back with **no rebalance**. Trade-off: a truly dead pod's partitions sit unowned until the session times out.
4. **Deploy shape.** maxSurge/maxUnavailable settings that restart a few pods at a time, and readiness that waits for the consumer to have joined, so the rollout does not outpace the group.
5. **KIP-848** once on Kafka 4.x with a supporting client: no barrier at all, broker-side assignment.

**Always:** idempotent handlers (dedupe keys or version checks), because at-least-once duplicates after a rebalance can only be reduced, not eliminated.

**Verify:** rebalance count per deploy (target: near zero with static membership), processing throughput over the deploy window, and the duplicate rate from dedupe-hit metrics.`,
      followUps: [
        {
          q: 'After adding static membership, a node dies and lag on 3 partitions climbs for 90 seconds. Expected?',
          a: 'Yes — the coordinator waits for session.timeout.ms before reassigning a static member\'s partitions. Choose the timeout as "longest normal restart" rather than "as long as possible", and alert on unowned partitions.',
        },
        {
          q: 'Could you avoid rebalances entirely with manual partition assignment?',
          a: 'Yes (assign() instead of subscribe()), but you take on failover yourself — a dead pod\'s partitions stop until something reassigns them. That fits a stateful system with its own orchestrator, not a typical stateless consumer fleet.',
        },
      ],
      pitfalls: [
        'Jumping to "increase session.timeout.ms" as the only fix',
        'Switching assignors in one step and breaking the group',
        'Claiming cooperative rebalancing removes duplicates',
      ],
    },
    {
      id: 'misc-async-resilience-iq-07',
      difficulty: 'medium',
      question:
        'Rapid-fire: the on-call channel says "consumer lag is 2 million". Is that bad? What do you need to know before answering, and how should lag be alerted on?',
      whatInterviewerLooksFor: [
        'Converts offset lag into time using the arrival and processing rates',
        'Asks per-partition vs aggregate and trend vs level',
        'Relates lag to the business SLO',
        'Proposes time-based lag plus slope alerts',
      ],
      modelAnswer: `**It depends on the rates and the SLO.** Offset lag is a count; users experience time.

- 2M lag on a topic producing 200K msg/s, with consumers doing 250K/s, is ~10 seconds behind and draining in ~40 s ((2M ÷ (250K − 200K))).
- 2M lag on a topic producing 2K msg/s, with consumers doing 1.5K/s, is ~17 minutes behind and **growing forever**.

**Questions to ask first:**

1. **Trend:** is it growing, flat or draining? Slope matters more than level.
2. **Distribution:** one partition or all? One hot partition means skew or a poison record; all partitions means under-capacity or a slow dependency.
3. **SLO:** "confirmation emails within 30 min" tolerates much more than "fraud decisions within 2 s".
4. **Is the metric honest?** Offsets committed early (fire-and-forget processing) under-report; transaction markers make it read a small non-zero number when caught up.

**Alerting:**

- Alert on **time lag** — the age of the oldest unconsumed record, or lag ÷ consumption rate — per partition, against the SLO (e.g. page at 50% of the SLO budget).
- Add a **sustained positive slope** alert (growing for 10+ minutes) to catch slow leaks early.
- Keep raw offsets for dashboards and capacity planning, not paging.`,
      followUps: [
        {
          q: 'How do you compute time lag without a special exporter?',
          a: 'Read the timestamp of the record at the committed offset (or the next one) and subtract it from now; or divide offset lag by the recent consumption rate. Exporters such as kafka-lag-exporter do the interpolation for you.',
        },
        {
          q: 'Lag is zero, but a consumer group has no active members. What does that mean?',
          a: 'Nothing is consuming; lag will only show once new records arrive and the committed offset stays put. Alert on "group has no members" and on committed offset not moving while log-end moves.',
        },
      ],
      pitfalls: [
        'A single static threshold on offset count across all topics',
        'Summing lag across partitions and missing a stuck partition',
        'Answering "yes, scale consumers" before knowing the cause',
      ],
    },
    {
      id: 'misc-async-resilience-iq-08',
      difficulty: 'hard',
      question:
        'The lag dashboard for the notification consumer is flat at zero, yet users report push notifications arriving 15–20 minutes late during evening peaks. Where can the delay hide, and how do you find it?',
      whatInterviewerLooksFor: [
        'Understands that consumer lag measures only one hop',
        'Lists hidden queues: producer/outbox, in-process buffers, downstream rate limits, provider queues',
        'Uses end-to-end latency tracing with event timestamps at each hop',
        'Identifies the early-commit pattern that zeros lag',
      ],
      modelAnswer: `**Consumer lag measures only one thing:** records in the partition that the group has not committed. Any queue before or after that point is invisible.

**Where 15–20 minutes can hide:**

1. **Before Kafka:** an outbox relay or CDC connector falling behind (polling a huge outbox table without an index, Debezium slot lag), or producer-side batching/retries. The event is late *before* it is written, so consumer lag stays zero.
2. **Inside the consumer:** handlers that push records into an in-memory queue or worker pool and resolve offsets immediately. Kafka thinks everything is done; the real backlog sits in the process — and is lost on a crash.
3. **After the consumer:** the notification service calls FCM/APNs through a rate-limited client with its own queue, or a secondary queue (per-user throttling, quiet hours). Peak traffic exceeds the provider quota and the delay accumulates there.
4. **Delayed by design:** batching or digest logic, or retry tiers — a message parked in a 10-minute retry topic has left the main topic's lag.

**How to find it:** put timestamps on the envelope at each hop — event created_at (business time), produced_at (record timestamp), consumed_at, handed_to_provider_at, provider_accepted_at — and emit histograms of each difference. The hop whose delta jumps during peak is the culprit. Also compare record timestamp with created_at to catch upstream delay, and measure in-process queue depth and the age of its oldest item.

**Fixes follow the hop:** index or partition the outbox (or move to CDC); commit offsets only after work finishes so lag becomes honest; size provider concurrency and request quota increases; add backpressure (pause partitions) instead of hidden buffers.

**Lesson:** the SLI should be **end-to-end latency** (created_at → delivered), and consumer lag is one diagnostic among several.`,
      followUps: [
        {
          q: 'Kafka record timestamps are set by the producer. Can you trust them?',
          a: 'With CreateTime they reflect the producer clock (and a relay\'s clock, not the business event\'s). Use LogAppendTime if you need broker time, and carry business created_at in the payload separately.',
        },
        {
          q: 'The culprit is the FCM quota. Options?',
          a: 'Request a higher quota, batch sends where the API supports it, prioritise transactional notifications over marketing with separate topics and quotas, and shed or delay low-priority pushes during peaks.',
        },
      ],
      pitfalls: [
        'Trusting consumer lag as an end-to-end latency metric',
        'Scaling consumers when the delay is downstream',
        'Not checking the upstream outbox or CDC path',
      ],
    },
    {
      id: 'misc-async-resilience-iq-09',
      difficulty: 'medium',
      question:
        'Rapid-fire: a team tells you "we have a DLQ, so we never lose messages". What has to exist around that DLQ for the statement to be true?',
      whatInterviewerLooksFor: [
        'Ownership and alerting on arrival',
        'Metadata to diagnose and redrive',
        'Retention settings that outlive the fix (SQS enqueue timestamp trap)',
        'Broker defaults that drop messages without a DLQ (RabbitMQ 4 delivery-limit)',
        'A tested redrive path',
      ],
      modelAnswer: `A DLQ only moves the problem somewhere quieter. For "never lose messages" to hold:

1. **It is actually wired.** RabbitMQ 4.x quorum queues default to a delivery-limit of 20: without a dead-letter exchange, the message is **dropped** after 20 attempts. SQS needs a redrive policy (maxReceiveCount) on the source queue. Kafka has no broker DLQ for classic consumers — the application must publish to a DLT before committing.
2. **Retention outlives the fix.** On SQS standard queues a message keeps its original enqueue timestamp when moved, so with 4-day retention on both queues a message that took 3 days to fail has 1 day left. Set DLQ retention to the 14-day maximum. On Kafka, give the DLT long retention too.
3. **Someone is paged.** Alert on DLQ arrival rate (any message on a payments DLQ; a rate threshold on noisy ones), with a named owning team. Depth-only alerts miss slow leaks.
4. **Messages are diagnosable.** Headers with the original topic/queue, partition/offset, error class and message, stack, attempt count, first/last failure time, consumer version.
5. **Redrive is a tool, not a script someone writes at 2 a.m.** Filter by error type, throttle, idempotent consumer, version-aware for ordered data.
6. **Permanent vs transient is classified,** so transient failures go through retries and poison ones reach the DLQ immediately rather than after 20 attempts.`,
      followUps: [
        {
          q: 'How big should maxReceiveCount be?',
          a: 'Large enough to ride out transient blips given the visibility timeout (e.g. 5 receives × 60 s), small enough that poison messages leave quickly. Better: catch permanent errors in code and dead-letter them immediately.',
        },
        {
          q: 'Should a DLQ ever be auto-redriven?',
          a: 'Only for classes known to be transient (dependency outage), with a delay, a cap on cycles and a rate limit; otherwise you build an infinite loop between the queue and the DLQ.',
        },
      ],
      pitfalls: [
        'No alert on the DLQ at all',
        'Same retention on source and DLQ',
        'Assuming the broker keeps failed messages by default',
      ],
    },
    {
      id: 'misc-async-resilience-iq-10',
      difficulty: 'expert',
      question:
        'A bad deploy of the payout consumer sent 2.3 million messages to the DLQ over 40 minutes. The fix is live. Design the redrive: how fast, in what order, and how do you avoid making things worse?',
      whatInterviewerLooksFor: [
        'Triage and sampling before bulk redrive',
        'Rate calculation against downstream headroom',
        'Staleness and ordering: events superseded while parked',
        'Idempotency on high-risk side effects (payouts)',
        'Canary redrive, kill switch and progress tracking',
      ],
      modelAnswer: `**1. Triage first (15–30 min).** Group the DLQ by error class and consumer version. Confirm the 2.3M are all "bug from deploy X" and not mixed with real poison messages. Sample 100, replay them against the fixed consumer in a dry-run mode, and check the results.

**2. Decide what is still valid.** During the 40 minutes the main flow kept going. For each message, ask: has a newer event for the same entity been applied? For payouts, check the ledger: is the payout already done (a retry by another path), cancelled or superseded? Filter or mark stale messages; version checks (apply only if version > current) make this automatic.

**3. Protect the side effect.** Payouts must carry the original idempotency key (payoutId) so the bank/PSP rejects duplicates. If the consumer generates a new key per attempt, fix that first — a redrive would double-pay.

**4. Rate.** Suppose the PSP allows 1,000 rps and live traffic uses 600 rps. Keep ~20% slack: redrive at ~200 rps → 2.3M ÷ 200 ≈ 11,500 s ≈ 3.2 hours. If that is too slow, ask the PSP for a temporary quota increase rather than exceeding it. Redrive through a throttled mover (SQS StartMessageMoveTask with a max velocity, or a Kafka redrive consumer with a token bucket), never "move all".

**5. Order.** For ordered entities, redrive per key in original order, and hold live events for keys still being redriven (or rely on version checks). For independent payouts, oldest first so the most-delayed users are paid first.

**6. Canary and watch.** Redrive 1,000, watch error rate, PSP latency, duplicates-rejected counter and DLQ re-arrival; then ramp. Keep a kill switch. Messages that fail again go to a *separate* redrive-failed queue, so they do not loop.

**7. Close the loop.** Reconcile: the count of paid + stale + failed equals 2.3M. Post-incident: a canary deploy with a DLQ-rate guard would have stopped this after ~1 minute instead of 40.`,
      followUps: [
        {
          q: 'Retention on the DLQ is 4 days and triage takes a week. Now what?',
          a: 'Immediately copy the DLQ contents to durable storage (S3/table) with their metadata, then redrive from there. Afterwards set DLQ retention to the maximum and archive automatically.',
        },
        {
          q: 'Why not replay from the source Kafka topic instead of the DLQ?',
          a: 'You can, if retention allows — reset a new group to the incident start timestamp. It replays everything, so the consumer must be idempotent; the DLQ is the precise subset, which is cheaper when only some messages failed.',
        },
      ],
      pitfalls: [
        'Bulk "redrive all" at full speed and overloading the PSP',
        'Ignoring superseded or cancelled payouts',
        'No idempotency key on money movement',
        'Letting failed redrives loop back into the same DLQ',
      ],
    },
    {
      id: 'misc-async-resilience-iq-11',
      difficulty: 'medium',
      question:
        'Rapid-fire: name the three building blocks of Kafka exactly-once and, for each, one failure it does NOT protect you from.',
      context:
        'Reported in Oracle IC-2 backend interview loops (LeetCode Discuss, 2025): a technical round centred on Kafka and reliable system design.',
      whatInterviewerLooksFor: [
        'Idempotent producer: scope is one producer session and one partition',
        'Transactions: atomic across Kafka writes and offsets only',
        'read_committed: only affects consumers that opt in; Java default is read_uncommitted',
        'Knows the external-effect gap and the fix',
      ],
      modelAnswer: `**1. Idempotent producer** (enable.idempotence=true, default since Kafka 3.0). The broker tracks producer id + sequence per partition and drops duplicate retries of a batch.
*Does not protect:* an application that calls send() twice for the same business event (for example, after its own retry or a restart without a transactional.id) — those are two different records with new sequences.

**2. Transactions** (transactional.id, beginTransaction, sendOffsetsToTransaction, commit). Output records to many partitions and the consumer's input offsets commit atomically; epochs fence zombie producers (since KIP-447 using consumer group metadata; KIP-890 in 4.0 bumps the epoch per transaction).
*Does not protect:* anything outside Kafka — a Postgres insert, HTTP call or email done inside the loop happens again when the transaction aborts and the batch is reprocessed.

**3. read_committed consumers.** They see only committed records and stop at the last stable offset.
*Does not protect:* consumers that did not opt in — the Java client defaults to read_uncommitted and will see records from aborted transactions. It also adds latency: consumers wait for open transactions to finish.

**Summary line:** "Kafka EOS is exactly-once *within Kafka* for consume-transform-produce. At the edges I still need idempotent consumers — an inbox table with a unique message id written in the same DB transaction as the effect, or idempotency keys to external APIs."`,
      followUps: [
        {
          q: 'What does exactly_once_v2 in Kafka Streams give you on top?',
          a: 'It wires all three for you — including state store changelogs — with one producer per stream thread (KIP-447), so state, outputs and offsets commit atomically. External calls from a processor are still not covered.',
        },
        {
          q: 'What is the latency cost of EOS?',
          a: 'Transactions commit on an interval (commit.interval.ms, 100 ms default in Streams EOS), and read_committed consumers wait for the commit marker, so end-to-end latency rises by roughly the commit interval plus coordinator round trips.',
        },
      ],
      pitfalls: [
        'Saying "exactly-once delivery"',
        'Believing transactions cover database writes',
        'Not knowing the default isolation level',
      ],
    },
    {
      id: 'misc-async-resilience-iq-12',
      difficulty: 'expert',
      question:
        'A consume-transform-produce service using Kafka transactions has a pod that freezes in a 90-second GC/network stall. Kubernetes starts a replacement, which takes over the partitions. Then the old pod wakes up and tries to commit its in-flight transaction. Walk me through exactly what stops duplicates — and where the protection ends.',
      whatInterviewerLooksFor: [
        'Zombie fencing via producer epoch and transactional.id',
        'KIP-447 group-metadata fencing (generation) for offset commits',
        'KIP-890 epoch bump per transaction and hanging transactions',
        'Transaction timeout and last stable offset effect on read_committed consumers',
        'Side effects outside Kafka are not protected',
      ],
      modelAnswer: `**Setup:** the old pod (A) has begun a transaction: it produced some output records and called sendOffsetsToTransaction with its consumer group metadata (member id, generation). It stalls.

**What happens while A is frozen:**

1. A stops heartbeating/polling; the group coordinator removes it after the session timeout or max.poll.interval.ms and assigns its partitions to the replacement (B) with a **new generation**.
2. B's producer initialises transactions. If B uses the same transactional.id (the pre-KIP-447 model of one id per input partition), initTransactions bumps the **producer epoch** and aborts A's open transaction. If ids are per instance (the KIP-447 model), the fencing comes from step 3 instead.
3. B reads the last committed offsets and reprocesses the records A had not committed.

**When A wakes up:**

- Its sendOffsetsToTransaction / commit carries the **old generation**; the group coordinator rejects it (fenced, since A is no longer a member of the current generation). With the shared transactional.id, the transaction coordinator rejects A's older epoch (ProducerFencedException).
- A's transaction is aborted, either by the fencing or by transaction.timeout.ms expiring. Its output records stay in the log but are marked aborted, so **read_committed** consumers never see them. Until the abort, they hold back the last stable offset — read_committed consumers downstream pause, which looks like a lag spike.
- KIP-890 (Kafka 4.0, with 4.x clients) bumps the epoch on every transaction and verifies partitions server-side, which closes the "hanging transaction" window where a late write from A could land in a *later* transaction.

**Where it ends:**

- **read_uncommitted consumers** see A's aborted records.
- **Side effects** A performed during the stall window (HTTP calls, DB writes, emails) already happened and B will perform them again. Kafka cannot fence those. Protect them with idempotency keys derived from input topic/partition/offset or business ids, or with a fencing token checked by the downstream store.

**Tuning:** keep transaction.timeout.ms modest (e.g. 60 s rather than the 15-minute broker max) so hanging transactions release the LSO quickly.`,
      followUps: [
        {
          q: 'Why did KIP-447 let apps use one transactional.id per instance?',
          a: 'Before it, fencing relied on each input partition mapping to a fixed transactional.id, which meant one producer per partition. KIP-447 makes the group coordinator fence commits by generation, so a single producer per instance is safe and much cheaper.',
        },
        {
          q: 'Downstream consumers reading read_committed stall for 60 seconds after this incident. Why?',
          a: 'A\'s open transaction held the last stable offset on those partitions until it timed out or was aborted. read_committed consumers cannot read past the LSO, so they wait. Lower transaction.timeout.ms and make sure fencing aborts quickly.',
        },
      ],
      pitfalls: [
        'Saying the idempotent producer alone handles zombies',
        'Forgetting the LSO stall on downstream consumers',
        'Claiming the external API calls are also rolled back',
      ],
    },
    {
      id: 'misc-async-resilience-iq-13',
      difficulty: 'medium',
      question:
        'Rapid-fire: which failures should a client never retry, which should it retry only conditionally, and what makes a timeout the hardest case?',
      whatInterviewerLooksFor: [
        'Clear retryable vs non-retryable classification',
        'Respects 429 Retry-After and server hints',
        'Explains the ambiguity of a timeout on a non-idempotent write',
        'Idempotency key must stay the same across attempts',
      ],
      modelAnswer: `**Never retry (the request itself is wrong):** 400/422 validation, 401/403 auth, 404, 409 conflict, 413 payload too large, business declines ("card declined"). Retrying produces the same answer and wastes capacity.

**Retry with backoff + jitter (transient):** connection refused/reset before the request was sent, 502/503/504 from a proxy, gRPC UNAVAILABLE, DNS blips.

**Retry only on the server's terms:** 429 and 503 with Retry-After — wait at least that long; the server is telling you it is overloaded, and immediate retries make it worse.

**The hard case: a timeout on a write.** The caller does not know whether the request never arrived, was processed and the response lost, or is still running. For a GET it is safe to retry. For POST /payments a blind retry can double-charge. Conditions for retrying:

- The server supports an **idempotency key** and the client sends the **same key** on every attempt (generate it once, before the retry loop).
- Or the operation is naturally idempotent (PUT with full state, conditional update with a version).
- Or the client queries status first ("did payment X happen?") before re-sending.

**Also:** never retry when the caller's deadline has already passed, and stop when a retry budget or circuit breaker says the dependency is unhealthy.`,
      followUps: [
        {
          q: 'Is 500 retryable?',
          a: 'Ambiguous. A 500 can be a transient crash or a deterministic bug for this input. Retry at most once or twice with backoff on idempotent calls, and track per-request-shape failures so deterministic 500s do not burn the retry budget.',
        },
        {
          q: 'What should the server do when it gets a second request with the same idempotency key while the first is still in progress?',
          a: 'Return 409 or a "processing" response, not run it again. Store key → status/response atomically, and return the stored response for completed keys.',
        },
      ],
      pitfalls: [
        'Retrying all non-2xx responses',
        'Generating a new idempotency key inside the retry loop',
        'Ignoring Retry-After',
      ],
    },
    {
      id: 'misc-async-resilience-iq-14',
      difficulty: 'hard',
      question:
        'A fleet of 300 Node pods calls a shared inventory service. Each call has "3 retries with exponential backoff". During last month\'s partial outage, inventory received 3.7× its normal load and could not recover. Design a retry policy that guarantees retries can never add more than ~10% load.',
      whatInterviewerLooksFor: [
        'Explains why per-request retry limits do not bound aggregate load',
        'Token-bucket retry budget per client/dependency (AWS SDK, gRPC retryThrottling)',
        'Combines with jitter, deadlines and circuit breaking',
        'Considers server-side signals and fleet-wide coordination',
      ],
      modelAnswer: `**Why 3.7×:** per-request limits bound each request, not the fleet. When most calls fail, each logical call becomes up to 4 attempts, so load approaches 4× — exactly when the dependency is weakest. Backoff spreads the retries in time but does not reduce their number.

**Design: a retry budget per pod per dependency.**

- A token bucket: each **successful** call deposits 0.1 token (capped, e.g. 100); each **retry** spends 1 token. First attempts are never blocked.
- In steady state, retries are limited to ~10% of successful volume. In a hard outage, successes stop, the bucket drains after at most ~100 retries per pod, and load converges to ~1.0–1.1×.
- This is what the AWS SDKs do by default, and what gRPC's retryThrottling (maxTokens, tokenRatio) provides for service configs.

**Complements:**

1. **Retry at one layer.** The pods are the layer closest to inventory; the BFF and gateway above them do not retry the same operation.
2. **Full jitter** on backoff (random(0, min(cap, base × 2^n))) so 300 pods do not retry in synchronized waves.
3. **Deadline-aware:** skip a retry if remaining deadline < expected latency.
4. **Circuit breaker** per inventory endpoint: when the failure rate stays high, stop even first attempts for a reset window and serve a fallback (cached availability, "check at checkout").
5. **Server hints:** honour Retry-After and a "do not retry" header when inventory is shedding load; mark retries with an attempt header so the server can shed retries first.

**Math check:** normal 10K rps, 30% errors. Naive 3 retries: ~10K + 3K + 0.9K + 0.27K ≈ 14.2K (1.42×), rising towards 4× as errors approach 100%. With a 10% budget: at most ~1K retries/s → ≤ 1.1×.

**Observability:** emit retries_attempted and retries_denied_by_budget per dependency; a rising denial count is an early outage signal.`,
      followUps: [
        {
          q: 'Pods are independent — could 300 separate budgets still overload inventory?',
          a: 'Each pod is capped at ~10% of its own successful traffic, so the fleet is capped at ~10% of fleet successes. That bound holds without coordination. A shared budget (e.g. in Redis) would only add latency and a new failure mode.',
        },
        {
          q: 'A low-traffic pod has only 5 calls a minute. Does the budget starve its retries?',
          a: 'Start the bucket full (or with a minimum floor of a few tokens) so low-volume clients can still retry occasional blips; the ratio matters only under sustained failure.',
        },
      ],
      pitfalls: [
        'Believing exponential backoff alone reduces total load',
        'Retrying at every layer',
        'Blocking first attempts with the budget',
      ],
    },
    {
      id: 'misc-async-resilience-iq-15',
      difficulty: 'medium',
      question:
        'Rapid-fire: you are adding a call to a new internal service. How do you choose its timeout values? "Use the library default" and "30 seconds" are not allowed answers.',
      whatInterviewerLooksFor: [
        'Separates connect, request, and overall deadline',
        'Derives from measured latency percentiles',
        'Considers the caller\'s own SLO and remaining budget',
        'Revisits with data; relates to pool sizing',
      ],
      modelAnswer: `**Three different numbers:**

1. **Connect timeout:** in-region TCP/TLS setup takes ~1–5 ms, so 100–300 ms (up to ~1 s cross-region) is generous. A connect timeout is about "host unreachable", not about slowness.
2. **Request timeout:** start from the dependency's measured latency — around p99.9 plus 20–50% headroom. If p99.9 is 180 ms, use ~250 ms. Setting it at the p50 causes false timeouts; setting it far above p99.9 only lets resources pile up.
3. **Overall deadline:** the caller's own SLO minus time already spent. If our endpoint promises 800 ms and we have used 300 ms, the call gets at most ~450 ms (keeping a margin to respond), even if its own timeout would allow more.

**Sanity checks:**

- **Little's law:** at 500 rps and a 250 ms timeout, the worst case is ~125 concurrent calls per pod — size the connection pool and memory for that, or add a bulkhead.
- **Retries fit inside:** if we allow one retry, 2 × timeout + backoff must fit in the deadline, otherwise drop the retry.
- **Unit:** set timeouts per endpoint, not per service: a search endpoint and a bulk export have different distributions.

**Process:** no p99.9 yet? Start with a conservative value from load tests, publish the latency SLO with the dependency owner, and revisit monthly from real histograms.`,
      followUps: [
        {
          q: 'The dependency has a bimodal latency: 20 ms cached, 900 ms cold. What now?',
          a: 'One timeout cannot fit both. Either ask for a separate endpoint or a hint for the cold path, give the call the larger timeout with a bulkhead so the slow mode cannot starve others, or hedge after ~p95 on idempotent reads.',
        },
        {
          q: 'Why is Node\'s default dangerous here?',
          a: 'Node\'s http client has no response timeout by default, and many wrappers set none either, so a hung upstream keeps the socket and the request context open indefinitely.',
        },
      ],
      pitfalls: [
        'One timeout for connect and read',
        'Timeouts larger than the caller\'s own SLA',
        'Ignoring the retry count when setting the timeout',
      ],
    },
    {
      id: 'misc-async-resilience-iq-16',
      difficulty: 'hard',
      question:
        'Your NestJS endpoint returns 504 after 3 seconds as designed, but during incidents the Postgres pool (max 20 per pod) is exhausted and even fast endpoints fail. Traces show queries still running 40 seconds after the 504. What is going on, and how do you make timeouts actually release resources?',
      whatInterviewerLooksFor: [
        'Realises a timeout that only stops waiting does not cancel work',
        'Knows Promise.race does not abort the underlying operation',
        'Uses statement_timeout / query cancel, AbortSignal, deadline checks',
        'Pool checkout timeouts and bulkheads per endpoint class',
      ],
      modelAnswer: `**Diagnosis:** the 3-second timeout is implemented as "stop waiting" — something like Promise.race(query, sleep(3000)) or a Nest interceptor with rxjs timeout(). The response returns 504, but the query keeps running inside Postgres and the pool client stays checked out until it finishes, 40 s later. With 20 connections per pod and slow queries arriving at even 1 per second, the pool is full after ~20 s — and every other endpoint, fast or not, now waits for a connection.

**Make timeouts cancel work:**

1. **Database side:** set statement_timeout per role or per transaction (SET LOCAL statement_timeout = '2500ms'), just below the request budget. Postgres cancels the query and the connection returns to the pool. Add idle_in_transaction_session_timeout for transactions left open by crashed handlers, and lock_timeout for lock waits.
2. **Pool checkout timeout:** pg's connectionTimeoutMillis (e.g. 200 ms) so a request fails fast when the pool is full instead of queueing for seconds.
3. **HTTP calls:** pass an AbortSignal (AbortSignal.timeout(remaining)) to fetch/undici; the socket is actually closed.
4. **Propagate a deadline** through the request context (AsyncLocalStorage) and check it before each step, so a handler that has already timed out does not start its next query.
5. **Bulkheads:** a separate small pool (or a semaphore) for the expensive report queries, so they can exhaust only their own compartment.

**Observability:** pool wait time, active vs idle clients, and pg_stat_activity for queries older than the request timeout — the smoking gun in this incident.

**Principle:** every timeout must be paired with a cancellation mechanism at the layer that holds the resource.`,
      followUps: [
        {
          q: 'statement_timeout fires in the middle of a transaction. What state is it in?',
          a: 'The statement errors and the transaction is aborted; the client must roll back before reusing the connection. Most pool wrappers do this, but make sure your transaction helper always issues ROLLBACK on error.',
        },
        {
          q: 'Can the Node side cancel a running query without statement_timeout?',
          a: 'Yes, by sending a cancel request (pg_cancel_backend on the backend pid, which some drivers expose as a cancel call), but statement_timeout is simpler and enforced even if the Node process dies.',
        },
      ],
      pitfalls: [
        'Raising the pool size, which just moves the overload to Postgres',
        'Assuming rxjs timeout() cancels the query',
        'Not separating slow and fast workloads',
      ],
    },
    {
      id: 'misc-async-resilience-iq-17',
      difficulty: 'medium',
      question:
        'Rapid-fire: you have both retries and a circuit breaker around a call. In what order do you wrap them, and what should a retry do when the breaker is open?',
      whatInterviewerLooksFor: [
        'Retry outside, breaker inside (so each attempt is counted)',
        'Open-breaker rejection is not retried',
        'Timeout innermost, as the failure signal',
        'Knows Resilience4j default order or equivalent',
      ],
      modelAnswer: `**Usual order (outermost → innermost):** Retry → CircuitBreaker → RateLimiter → TimeLimiter (timeout) → Bulkhead → call. This is the default decoration order in Resilience4j and a good mental model for any library.

**Why that order:**

- **Timeout innermost:** it turns a hang into a failure, which the breaker can count. Without it, a slow dependency never registers as failing.
- **Breaker inside retry:** each attempt passes through the breaker, so the breaker sees the true failure rate. If the breaker were outside the retry, three failed attempts would count as one failure and the breaker would open late.
- **Retry outermost:** it decides whether to try again based on the error type.

**When the breaker is open:** the call fails immediately with a "not permitted" error (CallNotPermittedException, opossum's EOPENBREAKER). The retry policy must treat that as **non-retryable**, and go straight to the fallback. Retrying an open breaker just spins, burning the deadline for nothing.

**Also:** retries should count against a retry budget, and only transient errors (timeouts, 503) are retried — the breaker counts them, but a 4xx should neither be retried nor counted by the breaker.`,
      followUps: [
        {
          q: 'Where does the fallback go?',
          a: 'Outside everything, so it runs once per logical call after retries are exhausted or the breaker rejects — not once per attempt.',
        },
        {
          q: 'Is there a case for breaker outside retry?',
          a: 'If retries are very fast and you want the breaker to count logical operations (e.g. per user action), but then set a lower threshold. The default remains retry outside.',
        },
      ],
      pitfalls: [
        'Retrying on open-breaker errors',
        'No timeout, so the breaker never sees slow failures',
        'Running the fallback per attempt',
      ],
    },
    {
      id: 'misc-async-resilience-iq-18',
      difficulty: 'expert',
      question:
        'Your checkout wraps the payment provider in a single circuit breaker. Yesterday the provider\'s refunds API started failing, the breaker opened, and for 4 minutes nobody could pay. Redesign the breaker strategy, including scope, what counts as a failure, and half-open behaviour across 150 pods.',
      whatInterviewerLooksFor: [
        'Breaker scope matched to the failure domain (endpoint, region, merchant/tenant)',
        'Failure classification: count 5xx/timeouts/slow calls; ignore 4xx and declines',
        'Half-open probing strategy and fleet-wide effects',
        'Fallbacks per operation (queue refunds, secondary PSP for charges)',
        'Observability and manual override',
      ],
      modelAnswer: `**Root cause:** one breaker for the whole provider mixed two failure domains. Refund failures pushed the shared failure rate over 50%, the breaker opened, and charges — which were healthy — were rejected. The breaker protected nothing and caused an outage.

**Scope by failure domain:**

- **Per operation/endpoint:** charge, capture, refund, payout each get their own breaker; they are served by different backends at the provider and fail independently.
- **Per provider region/host** if you call several endpoints (e.g. EU and IN clusters).
- **Per merchant/tenant** only for tenant-specific failures (bad credentials), and then as "disable this merchant", not a breaker that affects others.

**What counts as a failure:**

- Count: timeouts, connection errors, 5xx, and slow calls above ~2× the p99 (slow-call rate threshold).
- Ignore: card declines, 4xx validation, 409 idempotency conflicts — those are caller problems. A breaker that counts declines opens during a fraud spike.
- Minimum volume (e.g. ≥ 20 calls in a 10 s window) so a few failures at night do not flip it.

**Half-open across 150 pods:** each pod has its own breaker, so after the reset timeout 150 pods each send a few probes — fine for a payment API (hundreds of calls), but add **jitter to the reset timeout** (e.g. 20–40 s) so they do not probe in a synchronized wave, and allow only 1–3 probes per pod. For a fragile dependency, ramp traffic after closing (10% → 50% → 100% over a minute) instead of snapping back to full load.

**Fallbacks per operation:**

- **Charge:** fail over to a secondary PSP if configured (with the same idempotency key namespace), or fail clearly with "try again" — never silently queue a charge the user thinks failed.
- **Refund:** accept and queue it (refunds are asynchronous by nature), process when the breaker closes, and tell the customer "within 5–7 days".

**Operations:** export breaker state per operation as a metric, alert on OPEN, and have a manual force-closed/force-open override for incidents.`,
      followUps: [
        {
          q: 'Should the breaker state be shared across pods, e.g. in Redis?',
          a: 'Usually no — local breakers react in milliseconds and have no shared dependency. Share signals (dashboards, a manual override flag) instead of state. A shared breaker is useful only when per-pod traffic is too low to reach the minimum volume.',
        },
        {
          q: 'The provider is slow (3 s) but not failing. Does the breaker help?',
          a: 'Only if slow calls count as failures (slow-call threshold or a timeout inside the breaker). Otherwise the breaker stays closed while your pool fills with 3-second calls.',
        },
      ],
      pitfalls: [
        'One breaker per external company',
        'Counting business declines as failures',
        'Queuing charges silently as a fallback',
      ],
    },
    {
      id: 'misc-async-resilience-iq-19',
      difficulty: 'medium',
      question:
        'Rapid-fire: what is backpressure, how do pull-based and push-based systems implement it differently, and what are the options when a producer cannot be slowed down?',
      whatInterviewerLooksFor: [
        'Definition as a flow-control signal, not a buffer',
        'Pull (Kafka poll, credits) vs push (HTTP 429, TCP windows, Node write() false)',
        'Bounded queues as a requirement',
        'Options for uncontrollable producers: buffer durably, shed, sample, degrade',
      ],
      modelAnswer: `**Backpressure** is a signal from a slower stage to a faster one saying "send less", so buffers stay bounded. A buffer alone is not backpressure — it just delays the moment memory runs out.

**Pull-based:** the consumer asks for work only when it has capacity, so backpressure is natural.

- Kafka: the consumer polls; if processing is slow, it fetches less. Pause partitions (consumer.pause) when an internal queue is full.
- RabbitMQ prefetch (basic.qos), gRPC streaming flow-control windows, Reactive Streams request(n) credits.

**Push-based:** the producer sends, so the receiver must push back explicitly.

- HTTP: 429/503 with Retry-After; clients must honour it.
- TCP receive windows and HTTP/2 stream windows.
- Node streams: write() returns false above highWaterMark; wait for 'drain' (pipeline() handles it).

**When the producer cannot slow down** (mobile clients, IoT devices, third-party webhooks, market data):

1. **Absorb durably:** accept quickly into a durable log (Kafka) sized for the burst, and process behind it — but only if average input < average capacity.
2. **Shed:** reject with 429/503 so well-behaved clients retry later.
3. **Sample or aggregate:** keep 1 in N telemetry points, or coalesce updates (latest location per driver wins).
4. **Degrade:** process a cheaper version (skip enrichment) under load.

**Rule:** every queue has a bound, and a defined behaviour when it is hit.`,
      followUps: [
        {
          q: 'Does a Kafka topic give you backpressure between producer and consumer?',
          a: 'No — it decouples them. Producers are only slowed if brokers are overloaded (or quotas apply). The consumer side uses pull-based flow control; the topic itself just absorbs the difference until retention runs out.',
        },
        {
          q: 'What happens if you ignore write() returning false in Node?',
          a: 'Data keeps buffering in memory inside the writable; with a fast reader and slow destination, memory grows until the process is OOM-killed.',
        },
      ],
      pitfalls: [
        'Calling a large in-memory buffer "backpressure"',
        'Assuming Kafka slows producers automatically',
        'Unbounded Promise.all in consumers',
      ],
    },
    {
      id: 'misc-async-resilience-iq-20',
      difficulty: 'hard',
      question:
        'Design the delivery side of a large-scale notification system: a single event (a very popular creator posts) fans out to 20 million push notifications, and APNs/FCM throttle you. Where does backpressure live at each stage, and how do you keep transactional notifications (OTP, payment alerts) fast during the fan-out?',
      context:
        'Reported in LinkedIn Staff Software Engineer loops (LeetCode Discuss, June 2025): design an internal notification system at very large scale, with cross-questions on the internal microservices and on using Kafka for asynchronous handling.',
      whatInterviewerLooksFor: [
        'Staged pipeline with bounded fan-out and durable queues between stages',
        'Priority isolation: separate topics/quotas for transactional vs bulk',
        'Rate limiting against provider quotas; honouring 429/Retry-After',
        'Pause/resume consumer backpressure and lag-based autoscaling',
        'Numbers for fan-out time and throughput',
      ],
      modelAnswer: `**Pipeline:**

1. **Event intake:** "creator X posted" lands on posts.events (one record).
2. **Fan-out workers** page through the follower list (e.g. 10K ids per page) and write batched jobs to notify.bulk (keyed by recipient bucket). Fan-out is **incremental**: a worker writes a page, commits a cursor, then continues — it never holds 20M ids in memory.
3. **Preference/dedupe stage:** drops muted users and caps per-user frequency (no more than N pushes per hour), then emits send jobs.
4. **Delivery workers** call APNs/FCM.

**Backpressure at each stage:**

- **Fan-out → Kafka:** producers write to Kafka, which absorbs 20M jobs (~20M × 300 B ≈ 6 GB — fine). The fan-out worker checks lag of notify.bulk and **pauses paging** when it exceeds a threshold, so a single post cannot fill the pipeline with hours of work.
- **Delivery workers:** a token bucket per provider/app matching the quota (say 50K pushes/s overall). When 429 or Retry-After arrives, the bucket shrinks (AIMD) and workers **pause partitions** instead of spinning on retries.
- **Kafka consumer side:** bounded in-flight requests per worker (HTTP/2 multiplexing to APNs); offsets committed after acknowledgement.

**Throughput math:** 20M ÷ 50K/s = 400 s ≈ 7 minutes at full quota. Acceptable for a "new post" notification; product can accept up to ~15 minutes.

**Priority isolation (the key point):** OTPs and payment alerts use a **separate topic, separate consumer group and a reserved slice of the provider quota** (e.g. 20%), so they never queue behind the bulk fan-out. Bulk delivery gets what is left and is the first thing shed. A shared queue with a "priority field" is not enough, because a partition is FIFO — an OTP behind 2M bulk jobs is late.

**Autoscaling:** scale delivery workers on time lag, but cap at the provider quota — more workers than the quota allows just produce more 429s.

**Observability:** end-to-end latency per class (transactional p99 < 5 s), provider 429 rate, fan-out progress per post, and drop counts by reason.`,
      followUps: [
        {
          q: 'Most of the 20M users are inactive. How do you avoid wasting quota?',
          a: 'Filter by recent activity and valid tokens in the preference stage, purge tokens that providers report as unregistered, and optionally send in-app only (no push) to dormant users.',
        },
        {
          q: 'Two creators with 20M followers post in the same minute. What protects the system?',
          a: 'Fan-out pauses on notify.bulk lag, so the combined work spreads out in time; per-post fairness in the fan-out scheduler (round-robin pages across active posts) keeps one post from starving the other.',
        },
      ],
      pitfalls: [
        'Fanning out 20M messages synchronously in one request',
        'Mixing OTPs and bulk in one FIFO queue',
        'Retrying 429s immediately',
        'Autoscaling beyond the provider quota',
      ],
    },
    {
      id: 'misc-async-resilience-iq-21',
      difficulty: 'medium',
      question:
        'Rapid-fire: explain "goodput" and why an overloaded server that rejects 30% of requests can serve users better than one that accepts all of them.',
      whatInterviewerLooksFor: [
        'Defines goodput as useful throughput within deadlines',
        'Explains queue wait exceeding client timeouts, and wasted work',
        'Cheap early rejection with Retry-After',
        'Knows the goodput collapse curve',
      ],
      modelAnswer: `**Goodput** is the part of throughput that succeeds *and* arrives fast enough for the client to use it. A response delivered after the client timed out counts as throughput but not goodput — it is pure waste.

**Why accept-everything collapses:** a server with capacity 1,000 rps receiving 1,500 rps queues the extra 500 every second. Queue wait grows without bound: after 10 s there are 5,000 queued requests, i.e. ~5 s of waiting. If clients time out at 2 s, the server is now processing requests whose clients have already gone. It still does 1,000 rps of work, but goodput falls towards **zero**, and the timed-out clients retry, adding more load.

**Shedding 30%:** rejecting the excess ~500 rps within microseconds (503 + Retry-After, before auth or DB work) keeps the queue short. The 1,000 accepted requests finish in ~normal latency, so goodput stays ~1,000 rps. Rejected clients back off and retry later, some succeeding then.

**How to shed well:**

- Trigger on concurrency or queue time, not just CPU.
- Make rejections cheap.
- Drop requests that have waited longer than their deadline instead of processing them.
- Shed low-priority traffic first.

**One-liner:** "A fast no is better than a slow yes — shedding protects the work that can still succeed."`,
      followUps: [
        {
          q: 'Why not just let autoscaling handle it?',
          a: 'Autoscaling reacts in minutes (metrics lag, pod start, warm-up); collapse happens in seconds. Shedding keeps goodput up until capacity arrives, and some overloads (a DB) cannot be autoscaled at all.',
        },
        {
          q: 'Where do you shed: load balancer, gateway or service?',
          a: 'As early as possible for cheapness (gateway, per-client rate limits) and also in each service, because only the service knows its real concurrency and queue time.',
        },
      ],
      pitfalls: [
        'Equating high CPU utilisation with success',
        'Shedding after doing expensive work',
        'Not mentioning retries adding to overload',
      ],
    },
    {
      id: 'misc-async-resilience-iq-22',
      difficulty: 'expert',
      question:
        'A food-delivery app hits 4× normal traffic at 8 p.m. on a cricket-final night, and the order service can take only 2×. Design priority-based load shedding end to end: which requests go first, where the decision is made, what signal drives it, and how you avoid shedding a request that is halfway through an order.',
      whatInterviewerLooksFor: [
        'Priority taxonomy tied to business value',
        'Propagated priority header from the edge, enforced in each service',
        'Adaptive signal (concurrency/latency/queue time), not static RPS',
        'Protects in-progress journeys and retries of accepted work',
        'Client cooperation and degradation integration',
      ],
      modelAnswer: `**Priority tiers (set at the edge, propagated as a header):**

| Tier | Examples | Shed |
|---|---|---|
| P0 critical | place order, payment callback, OTP, delivery-partner location updates for active orders | last, ideally never |
| P1 degraded-OK | menu and restaurant pages, cart updates, order tracking | second |
| P2 deferrable | recommendations, "reorder" carousels, ratings, analytics beacons | first |
| P3 speculative | prefetch, image variants, background sync | always first |

The gateway classifies by route and client, sets x-priority, and every internal hop inherits it — a P2 request cannot become P0 by calling a P0 service.

**Signal:** not static RPS. Each service runs an adaptive concurrency limiter (a gradient/AIMD limit on in-flight requests driven by latency relative to the uncongested baseline) plus a check on queue wait time. When the limit is reached, the service rejects the lowest tier present first. The shed level (P3 → P2 → P1) rises and falls with the signal, with hysteresis so it does not flap. Netflix's prioritized shedding in Zuul and Uber's Cinnamon (priorities plus a PID-style controller) work this way.

**Where:** coarse shedding at the gateway (P3/P2 dropped when the fleet-wide shed level is high — cheapest place), fine shedding in each service (only it knows its real saturation).

**Protecting in-flight orders:**

- Once "place order" is accepted, every downstream call it makes (payment, inventory, restaurant notify) carries **P0 with a journey id**; they are never shed.
- Retries of an accepted order use the same idempotency key and keep P0; retries of *new* work are marked (x-retry-attempt) and shed before first attempts.
- Session-based admission: users who already have an active checkout session are admitted before new browse traffic.

**Client cooperation:** apps honour Retry-After with jitter, show cached menus, and hide P2 widgets when they get 503s.

**Capacity math:** at 4× load with 2× capacity, P2 + P3 are typically ~40–50% of requests; shedding them nearly brings demand to capacity, with P1 degraded (cached menus) covering the rest — P0 untouched.`,
      followUps: [
        {
          q: 'How do you test this before the final?',
          a: 'Load tests with production-shaped traffic mixes, forcing the shed level manually in staging and in a production game day at low traffic, and asserting that P0 success rate and latency stay within SLO while P2/P3 are rejected.',
        },
        {
          q: 'What stops every team from marking their endpoint P0?',
          a: 'Priority is assigned centrally at the gateway from a reviewed route catalogue, with a budget of P0 routes per domain and a quarterly review; services cannot raise priority, only inherit or lower it.',
        },
      ],
      pitfalls: [
        'Shedding by random sampling regardless of value',
        'Letting internal calls of an accepted order be shed',
        'Static RPS thresholds that are wrong after every deploy',
      ],
    },
    {
      id: 'misc-async-resilience-iq-23',
      difficulty: 'medium',
      question:
        'Rapid-fire: give me a degradation ladder for an e-commerce product page that depends on catalog, price, inventory, reviews and recommendations. What is allowed to go stale, and what is not?',
      whatInterviewerLooksFor: [
        'Separates core from optional dependencies',
        'Explicit staleness bounds and re-validation at checkout',
        'Ordered steps with triggers',
        'Fallbacks independent of the failing dependency',
      ],
      modelAnswer: `**Core vs optional:** catalog (title, images) and price are core; inventory is core at checkout but approximate on the page; reviews and recommendations are optional.

**Ladder (each step triggered by breaker state, latency or a kill switch):**

1. **Recommendations degrade first:** personalised → precomputed "popular in this category" (static JSON in the CDN, rebuilt hourly) → hidden.
2. **Reviews:** live → cached summary (rating + count, up to 24 h stale) → hidden.
3. **Inventory:** live → cached availability ("in stock" / "few left", up to 5 min stale) with the real check at add-to-cart/checkout.
4. **Price:** live → cached price up to ~15 min stale, labelled as re-validated at checkout; the checkout call **must** get a live price, otherwise it fails clearly ("price unavailable, try again").
5. **Catalog:** served from CDN/edge cache (hours stale is fine); if even that is gone, the page shows an error — there is no product page without the product.

**What must not go stale:** the price charged, stock reserved at checkout, promotions with limits, and anything legal or regulatory (tax, age restrictions).

**Implementation notes:** fallbacks are cheaper and **independent** of the failing path (a CDN file, not "query the DB instead"); each widget has its own timeout (e.g. 150 ms for recommendations) so optional parts cannot delay the core; the page renders progressively so slow optional widgets never block the HTML.`,
      followUps: [
        {
          q: 'How does the user know the page is degraded?',
          a: 'Only where it affects a decision: "price confirmed at checkout", "availability may change". Hidden optional widgets need no banner.',
        },
        {
          q: 'Who decides the ladder?',
          a: 'Product and engineering together, before incidents: product ranks features by business value; engineering defines the triggers and ensures each fallback is tested.',
        },
      ],
      pitfalls: [
        'Serving a stale price at payment',
        'Falling back to a heavier call on the same backend',
        'No per-widget timeouts',
      ],
    },
    {
      id: 'misc-async-resilience-iq-24',
      difficulty: 'hard',
      question:
        'After a regional incident, the postmortem found that three documented fallbacks did not work: one pointed at the same failing Redis, one had not been deployed in 8 months and threw on a renamed field, and the kill switch could not be toggled because the feature-flag service was down too. How do you make graceful degradation something you can trust?',
      whatInterviewerLooksFor: [
        'Fallback independence analysis (shared dependencies)',
        'Continuously exercised fallback paths (traffic, tests, chaos)',
        'Flag/config system that fails static with local last-known values',
        'Ownership, SLOs and runbooks for degraded modes',
      ],
      modelAnswer: `**Three failure types, three fixes.**

**1. Shared-fate fallbacks.** A fallback that shares a dependency with the primary fails with it. Fix: for every critical path, write down primary and fallback dependency graphs and check that they are **disjoint** for the failure you are planning for. Typical independent fallbacks: static files baked into the image or served from a CDN, a local in-process last-known-good cache, a different region. Add this check to design reviews.

**2. Fallback rot.** Code that runs only during incidents is untested code. Fixes:

- **Exercise continuously:** send a small share (e.g. 0.1–1%) of real traffic through the degraded path, or run it in shadow mode and compare, so schema changes break it in CI or canaries, not during incidents.
- **Contract tests** on fallback data (the precomputed "top sellers" file must match the current schema).
- **Game days** each quarter: force breakers open in production at low traffic, and verify user-facing SLOs in degraded mode.

**3. A kill switch that depends on what failed.** The flag service must **fail static**:

- The SDK keeps last-known flag values in memory and on local disk (or in a ConfigMap baked at deploy), and uses coded defaults if nothing is available at startup — defaults chosen as the *safe* state.
- Critical kill switches have a second path that does not depend on the flag service: an environment variable/ConfigMap rollout, or an edge rule at the CDN/gateway.
- Flag evaluation is local (streamed rules), never a remote call per request.

**Make it someone's job:** each degraded mode has an owner, a runbook entry, a metric that shows when it is active (degraded_mode{feature="recs"} = 1), and an SLO for how the product behaves while degraded. Automatic triggers (breaker open → fallback) are preferred; manual switches are the backup.`,
      followUps: [
        {
          q: 'Is routing 1% of traffic to a degraded path acceptable to product?',
          a: 'Usually yes for optional widgets (1% see "popular items" instead of personalised ones); for critical paths, use shadow execution (run the fallback, discard the result, compare) instead.',
        },
        {
          q: 'What should a service do if it starts during the flag-service outage with no cache?',
          a: 'Use compiled-in defaults set to the conservative state (new features off, kill switches in their safe position) and log loudly; never block startup on the flag service.',
        },
      ],
      pitfalls: [
        'Documenting fallbacks without ever running them',
        'Flags evaluated by a remote call per request',
        'Fallbacks that share a database, cache or region with the primary',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'misc-async-resilience-boe-1',
      question:
        'A 60-pod consumer group on the classic protocol with the eager assignor processes 1,500 msgs/s per pod. A rolling deploy restarts pods one at a time; each leave and each join triggers a stop-the-world rebalance of ~8 s, and auto-commit runs every 5 s. Estimate processing lost and duplicates per deploy, then compare with static membership.',
      assumptions: [
        '60 pods, 1,500 msgs/s each → 90K msgs/s group throughput',
        'Each pod restart = 1 leave + 1 join = 2 rebalances (no batching of rebalances)',
        'Each eager rebalance stops the whole group for ~8 s',
        'On revoke, on average 2.5 s of uncommitted work per pod is redelivered (half the auto-commit interval)',
        'Static membership: pod restarts within session.timeout.ms (60 s) cause no rebalance',
      ],
      steps: [
        { label: 'Rebalances per deploy', calc: '60 pods × 2 = 120 rebalances' },
        { label: 'Stopped time', calc: '120 × 8 s = 960 s ≈ 16 minutes of zero processing' },
        { label: 'Processing lost', calc: '960 s × 90K msgs/s ≈ 86M message-slots of delay (becomes lag)' },
        { label: 'Duplicates per rebalance', calc: 'every member revokes: 60 pods × 1,500 msgs/s × 2.5 s ≈ 225K redelivered' },
        { label: 'Duplicates per deploy', calc: '120 × 225K ≈ 27M duplicate deliveries (upper bound)' },
        { label: 'With static membership + commit on shutdown', calc: '0 rebalances; duplicates ≈ in-flight at SIGTERM only, ~few hundred per pod → ~20K total' },
      ],
      answer:
        'Roughly 16 minutes of full-group stoppage, ~86M messages of added lag and up to ~27M duplicate deliveries per deploy. Static membership plus a graceful commit on shutdown reduces that to near zero rebalances and ~tens of thousands of duplicates.',
      insight:
        'With eager rebalancing, deploy cost scales with group size squared (more pods × more rebalances × everyone stopping). Fix the protocol (static membership, cooperative-sticky, KIP-848) before adding pods, and make handlers idempotent because duplicates never reach zero.',
      followUps: [
        {
          "q": "The group grows to 200 pods next quarter. Redo the rough estimate on the eager protocol, and compare with KIP-848.",
          "a": "Eager: rebalances per deploy = 200 × 2 = 400; at ~8 s each that's about 53 minutes of full stoppage, and stop-the-world rebalances get slower as membership grows, so realistically more. Duplicates: 400 × (200 × 1,500 × 2.5 s) ≈ 300M redeliveries, an upper bound. Cost scales roughly with pods squared. With KIP-848 there is no global barrier: each restart moves only that pod's partitions, other members keep processing, and with commit-on-revoke duplicates are limited to in-flight work. That is about 200 small incremental moves of a few seconds each for one pod's partitions, and the group never stops."
        }
      ],
    },
    {
      id: 'misc-async-resilience-boe-2',
      question:
        'An inventory service normally handles 8,000 rps from 300 client pods with 1% errors. During an incident 60% of calls fail. Compare the load inventory receives under (a) 3 retries per call and (b) a 10% token-bucket retry budget per pod.',
      assumptions: [
        'First-attempt load stays at 8,000 rps (user traffic unchanged)',
        'Failure probability is independent per attempt: 60% during the incident',
        'Policy (a): up to 3 retries (4 attempts) on every failed attempt',
        'Policy (b): retries allowed while tokens last; each success adds 0.1 token, each retry costs 1',
      ],
      steps: [
        { label: '(a) attempts per call', calc: '1 + 0.6 + 0.36 + 0.216 ≈ 2.18 attempts' },
        { label: '(a) load', calc: '8,000 × 2.18 ≈ 17,400 rps ≈ 2.2× normal' },
        { label: '(b) successes per second', calc: '~8,000 × 0.4 = 3,200 successes/s (first attempts)' },
        { label: '(b) retry allowance', calc: '3,200 × 0.1 = 320 retries/s sustained (after the initial bucket drains)' },
        { label: '(b) load', calc: '8,000 + 320 ≈ 8,320 rps ≈ 1.04× normal' },
        { label: 'Hard outage (100% failure)', calc: '(a) 4× = 32,000 rps; (b) ≈ 8,000 rps plus a one-off burst of ≤ 100 tokens × 300 pods = 30K retries' },
      ],
      answer:
        'About 17.4K rps (2.2×) with fixed retries versus about 8.3K rps (1.04×) with a 10% retry budget; in a total outage it is 32K rps versus ~8K rps plus a short initial burst.',
      insight:
        'Per-call retry limits amplify load exactly when the dependency is weakest. A budget caps amplification at the ratio you choose, so retries help with blips but cannot sustain an outage. Size the bucket cap so the one-off burst (cap × pods) is also tolerable.',
      followUps: [
        {
          "q": "The inventory service's capacity is 10,000 rps. Under policy (a) during the 60% failure incident, what happens next, and how does that change the failure rate?",
          "a": "Policy (a) pushes 17.4K rps at a service with 10K capacity, so it overloads: queues grow, latency rises, timeouts add to the failures, and the failure rate climbs above 60%. At a higher failure rate the attempts per call rise toward 4 (32K rps), which is a positive feedback loop: the retry storm turns a partial incident into a full outage that persists even after the original cause is fixed, a metastable failure. With the budget, load stays at about 8.3K, under capacity, so the service can recover once the trigger clears."
        }
      ],
    },
    {
      id: 'misc-async-resilience-boe-3',
      question:
        '2.3M payout messages are in a DLQ after a bad deploy. The PSP quota is 1,000 rps; live traffic uses 450 rps at peak and 150 rps at night. How long will the redrive take, when should it run, and what DLQ retention do you need?',
      assumptions: [
        'Keep 20% of the quota as safety headroom → usable 800 rps',
        'Peak window 10:00–22:00 (12 h), night window 22:00–10:00 (12 h)',
        'Triage and dry-run take ~1 day before bulk redrive starts',
        'Each redriven message = one PSP call',
      ],
      steps: [
        { label: 'Redrive rate at peak', calc: '800 − 450 = 350 rps' },
        { label: 'Redrive rate at night', calc: '800 − 150 = 650 rps' },
        { label: 'Night-only duration', calc: '2.3M ÷ 650 ≈ 3,540 s ≈ 1 h' },
        { label: 'Peak-only duration', calc: '2.3M ÷ 350 ≈ 6,570 s ≈ 1.8 h' },
        { label: 'Retention needed', calc: 'time already in DLQ (≤ 1 day) + triage (1 day) + redrive + buffer (≥ 3 days) → ≥ 5–7 days; SQS standard keeps the original enqueue time, so use 14 days' },
      ],
      answer:
        'About 1 hour at night (650 rps) or ~1.8 hours at peak (350 rps). Start with a canary during the day, run the bulk redrive at night, and keep DLQ retention at 14 days.',
      insight:
        'The redrive rate is bounded by the downstream quota minus live traffic, not by how fast you can read the DLQ. Rate-limit redrives explicitly, and set DLQ retention from the time it takes to triage and fix, not from the source queue.',
      followUps: [
        {
          "q": "The PSP also limits to 100 rps per merchant account, and 60% of the DLQ is for one marketplace merchant. Does your 1-hour estimate hold?",
          "a": "No. That merchant's 1.38M messages at 100 rps take 13,800 s, about 3.8 hours, regardless of global headroom. The other 920K messages finish in about 25 minutes at night rates. Plan per-merchant rate limits in the redrive tool (a token bucket per merchant) and interleave merchants so the big one doesn't block the rest. Communicate a realistic ETA (about 4 hours, overnight) to that merchant. Check the live traffic for that merchant too: if they also have live payouts, the redrive must leave headroom within their 100 rps."
        }
      ],
    },
    {
      id: 'misc-async-resilience-boe-4',
      question:
        'A pricing service runs 20 pods. Each pod can handle ~250 rps at an uncongested latency of 40 ms before latency climbs. Clients time out at 800 ms. Size a per-pod concurrency limit and a maximum queue wait, and estimate goodput with and without shedding at 2× load.',
      assumptions: [
        'Capacity per pod ≈ 250 rps; fleet ≈ 5,000 rps',
        'Offered load during spike = 10,000 rps (2×)',
        'Little\'s law: concurrency = throughput × latency',
        'Without shedding, FIFO unbounded queue',
      ],
      steps: [
        { label: 'Concurrency at capacity', calc: '250 rps × 0.04 s = 10 in-flight per pod; add ~50% headroom → limit ≈ 15' },
        { label: 'Max queue wait', calc: 'client timeout 800 ms − service time 40 ms − margin ~160 ms ≈ 600 ms' },
        { label: 'Max queue length', calc: '600 ms × 250 rps ≈ 150 waiting per pod' },
        { label: 'Without shedding: queue growth', calc: '(500 − 250) = 250 extra rps per pod → after 4 s, 1,000 queued = 4 s wait > 800 ms timeout' },
        { label: 'Without shedding: goodput', calc: 'after ~3 s nearly all completions arrive after the client left → goodput → ~0 (plus client retries add load)' },
        { label: 'With shedding', calc: '~5,000 rps accepted and served in ≤ ~640 ms; ~5,000 rps rejected fast with 503 → goodput ≈ 5,000 rps' },
      ],
      answer:
        'Limit ~15 in-flight per pod with a queue bounded to ~150 entries or ~600 ms wait. Without shedding, goodput collapses to near zero within seconds at 2× load; with shedding it stays near the 5,000 rps capacity.',
      insight:
        'Concurrency limits and queue-wait caps derive directly from Little\'s law and the client timeout. The queue bound must be expressed in time, because a request that waits past its caller\'s deadline is wasted work.',
      followUps: [
        {
          "q": "Latency per request isn't constant: under load the DB makes service time rise from 40 ms to 120 ms. How does that change your concurrency limit?",
          "a": "A static limit of 15 assumes 40 ms. At 120 ms, Little's law gives 15 ÷ 0.12 ≈ 125 rps per pod, and the queue wait bound fills quickly. Throughput collapses but the limit doesn't adapt. Use an adaptive concurrency limiter (Netflix's concurrency-limits with Gradient2 or Vegas, or Envoy's adaptive concurrency): it measures minimum RTT and current RTT, and lowers the limit when latency inflates, keeping queues short. Also bound the queue in time (600 ms) rather than entries, because 150 entries at 120 ms each is 18 s of wait."
        }
      ],
    },
  ],
  test: [
    {
      id: 'misc-async-resilience-mcq-01',
      difficulty: 'hard',
      question:
        'This handler occasionally produces "order not found" errors in the worker, and after a payment decline some customers still get a confirmation email. What is the root cause?',
      code: {
        language: 'typescript',
        code: `await db.transaction(async (tx) => {
  const order = await tx.orders.insert({ userId, items, status: 'PENDING' });
  await emailQueue.add('send-confirmation', { orderId: order.id }); // BullMQ, Redis-backed
  await chargeCard(tx, order);   // may throw -> transaction rolls back
  await tx.orders.update(order.id, { status: 'PAID' });
});`,
      },
      options: [
        'BullMQ does not guarantee at-least-once delivery, so some jobs are lost and others duplicated',
        'The job is enqueued before the transaction commits: workers can run before the row is visible, and a rollback leaves the job queued',
        'The worker reads from a replica with replication lag; reading from the primary fixes both symptoms',
        'The transaction isolation level is too low; SERIALIZABLE would make the queue write part of the transaction',
      ],
      correct: [1],
      explanation:
        'Redis is not part of the Postgres transaction, so the job exists as soon as add() returns. A fast worker reads the order before commit (not found), and a rolled-back charge leaves an orphan job that sends an email. Replica lag could cause the first symptom but not the second. No isolation level makes an external system transactional; the fix is an outbox or enqueue-after-commit with an idempotent consumer.',
      followUps: [
        {
          "q": "You move enqueue to after COMMIT. What failure remains, and does that alone make the system correct?",
          "a": "A crash or Redis error between COMMIT and `queue.add()` leaves a committed order with no job, so the confirmation email is never sent. Enqueue-after-commit trades the phantom-job bug for a lost-job bug. To close the gap, write an outbox row in the same transaction, and have a relay (polling with `FOR UPDATE SKIP LOCKED`, or CDC) enqueue the job and mark the row done. The relay can enqueue twice after a crash, so use a deterministic BullMQ `jobId` (`confirm:<orderId>`), which BullMQ dedupes, and make the email worker idempotent too."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-02',
      difficulty: 'expert',
      question:
        'Your team is considering Kafka 4.2 share groups (KIP-932) to run an image-thumbnail job queue on an existing 6-partition topic. Select ALL statements that are true.',
      options: [
        'You can run 40 consumers in the share group and all of them can receive records, even though the topic has only 6 partitions',
        'Records are acknowledged individually, and a record whose acquisition lock times out becomes available to another consumer',
        'Per-key ordering is preserved because records with the same key are always delivered to the same share consumer',
        'Delivery attempts are counted, and a record exceeding the delivery limit is no longer delivered (archived) rather than blocking the partition',
        'Records exceeding the delivery limit are automatically written to a dead-letter topic named <topic>.dlq',
      ],
      correct: [0, 1, 3],
      explanation:
        'Share groups let many consumers read the same partitions cooperatively, with per-record acquisition locks, acknowledgements and delivery counts; after the limit a record is archived. They do not preserve per-key ordering — that is the trade-off for queue semantics. There is no built-in DLQ for share groups in 4.2; you still need to handle failures (for example, publish to a DLT before rejecting).',
      followUps: [
        {
          "q": "Thumbnail jobs for the same image must not run concurrently, because two workers overwrite each other's output. Share groups don't preserve key ordering. How do you protect this?",
          "a": "Make the work idempotent and conflict-safe rather than relying on the queue. Write output to a deterministic path (`thumbs/<imageId>/<size>.webp`) with conditional writes: S3 `If-None-Match: *` for create-only, or a version check in the DB row that records the thumbnail. Two workers then race harmlessly, and the loser's write is rejected or identical. If the jobs differ (for example re-crop after an edit), carry the image version in the message and skip if the stored version is newer. A per-key lease in Redis or Postgres works too, but costs a coordination round trip per job."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-03',
      difficulty: 'medium',
      question:
        'The payments projection sometimes shows an order as PAID before it exists (the PAID update is applied to a missing row and dropped). Producers look like this. What is wrong?',
      code: {
        language: 'typescript',
        code: `await producer.send({ topic: 'orders.v1', messages: [
  { key: order.id, value: JSON.stringify({ type: 'OrderCreated', order }) },
]});
// ... later, in the payment service
await producer.send({ topic: 'orders.v1', messages: [
  { key: payment.customerId, value: JSON.stringify({ type: 'OrderPaid', orderId: payment.orderId }) },
]});`,
      },
      options: [
        'The producer is not idempotent, so OrderPaid is reordered by retries within the partition',
        'Kafka does not guarantee ordering within a topic unless acks=all is set',
        'The two events for one order use different keys, so they can land in different partitions and be consumed in any relative order',
        'The consumer must use read_committed to see events in order',
      ],
      correct: [2],
      explanation:
        'Ordering is per partition, and the partition is chosen from the key. OrderCreated is keyed by order id, OrderPaid by customer id, so they can live in different partitions consumed independently. Idempotence does prevent reordering on retries, but only within one partition. acks and isolation level do not affect cross-partition order; key all lifecycle events by order id.',
      followUps: [
        {
          "q": "You change OrderPaid's key to orderId. Events already in the topic were keyed the old way. How do consumers cope during the transition?",
          "a": "For a while, an order's old OrderPaid events (keyed by customer) sit in different partitions from its OrderCreated. Make the projection tolerant: when an OrderPaid arrives for a missing row, don't drop it. Upsert a placeholder row with status PAID and a version, and let OrderCreated fill in the remaining fields without regressing status (version or state-machine guards). Or buffer orphans in a pending table and retry them for a few minutes. Once the old-key events are past retention or consumed, the special case becomes dead code. Add a metric for orphan events so you know when it reaches zero."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-04',
      difficulty: 'hard',
      question:
        'A service keeps a local user cache (SQLite on a persistent volume) fed from a compacted topic users.state with delete.retention.ms = 1 day; deleted users are published as tombstones. The service was scaled to zero for 5 days, then resumed from its committed offsets (still within offsets retention). Some users deleted during those 5 days are still in its cache and never get removed. Why?',
      options: [
        'Compaction keeps only the first value for each key, so the service reads stale creations',
        'Tombstones are never delivered to consumers; only the broker sees them',
        'Its committed offsets were reset to latest on restart, so it skipped every event from the 5 days',
        'While it was down, compaction removed the deleted users\' earlier records and then dropped their tombstones after 1 day, so on resume the consumer never receives a delete for keys it had cached before',
      ],
      correct: [3],
      explanation:
        'Tombstones are kept only for delete.retention.ms after compaction; a consumer that falls further behind than that can miss the delete entirely while its local store still holds the key. Compaction keeps the latest, not the first, value. Tombstones are delivered like any record. The offsets were still valid, and a reset to latest would drop all changes, not only deletes. Consumers of compacted topics must never lag more than delete.retention.ms, or must rebuild from the beginning.',
      followUps: [
        {
          "q": "How do you detect and recover from this situation automatically?",
          "a": "Detect: on startup, compare the consumer's committed offset age with `delete.retention.ms`. If the time since the last processed record's timestamp (or since the last shutdown) exceeds it, the local cache may hold zombie keys. Also export consumer time lag and alert well before it approaches 1 day. Recover: discard the local SQLite cache and rebuild from offset 0. A compacted topic holds the latest value for every live key, so the rebuild is complete and has no deleted users. Swap the rebuilt store in atomically. Raising `delete.retention.ms` (for example to 7 days) widens the safe window at a small storage cost."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-05',
      difficulty: 'expert',
      question:
        'You switch a Java consumer group on Kafka 4.0 to group.protocol=consumer (KIP-848). Select ALL statements that are true.',
      options: [
        'Partition assignment is computed by the group coordinator using a server-side assignor such as uniform or range',
        'A member that keeps its partitions continues processing while other members\' partitions are being moved',
        'max.poll.interval.ms no longer matters because liveness is tracked only through broker-side heartbeats',
        'Setting partition.assignment.strategy or session.timeout.ms on the client is not supported under the new protocol',
        'Every member must rejoin and resync at a common barrier on each membership change, but the barrier is faster',
      ],
      correct: [0, 1, 3],
      explanation:
        'KIP-848 moves assignment to the broker, lets each member reconcile independently (no global barrier), and moves session timeout and heartbeat interval to group configs, making those client configs unsupported. max.poll.interval.ms still applies: a consumer whose poll loop stalls is still removed. The "faster barrier" option describes the classic protocol, which KIP-848 replaces.',
      followUps: [
        {
          "q": "The group mixes old classic-protocol clients and new ones during the migration. What does the broker do, and what should you watch?",
          "a": "Kafka 4.x supports online migration: a classic group converts to a consumer-protocol group when the first new member joins, if the group is otherwise empty or eligible for upgrade. Mixed membership is handled by the coordinator, which tells classic members to rejoin or sync while new members reconcile incrementally. Mixed mode runs at the pace of the old protocol's barrier for classic members, so roll quickly through the fleet rather than leaving it mixed for days. Watch rebalance counts, assignment epoch churn, `max.poll.interval.ms` evictions and per-partition lag. Remove now-unsupported client configs to avoid startup errors."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-06',
      difficulty: 'hard',
      question:
        'To stop rebalances during deploys, a team sets the config below on its 12-pod consumer group. One night a Kubernetes node dies permanently, taking pod consumer-7 with it; the replacement is scheduled on a node that takes 20 minutes to provision. What do you observe?',
      code: {
        language: 'java',
        code: `props.put("group.instance.id", System.getenv("POD_NAME")); // consumer-0 .. consumer-11
props.put("session.timeout.ms", "900000");   // 15 minutes
props.put("partition.assignment.strategy",
          "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");`,
      },
      options: [
        'consumer-7\'s partitions stay assigned to it and receive no processing for about 15 minutes; then they move to other members until consumer-7 rejoins',
        'Its partitions move to other members within seconds, because cooperative-sticky reassigns revoked partitions immediately',
        'The whole group stops for 15 minutes because a static member is missing',
        'Nothing is lost or delayed: static members replicate their assignment to a standby member',
      ],
      correct: [0],
      explanation:
        'A static member that stops heartbeating keeps its assignment until session.timeout.ms expires; only then does the group rebalance its partitions to others. Cooperative-sticky affects how partitions move once a rebalance happens, not when it starts. Other members keep processing their own partitions, and there is no standby replication. Long session timeouts trade deploy smoothness for slow failover — alert on lag of unowned partitions.',
      followUps: [
        {
          "q": "You want both fast deploys and fast failover. What session timeout do you pick, and what else covers the gap?",
          "a": "Size `session.timeout.ms` to the longest normal restart, not to node provisioning. If a pod restart takes about 40 s, set 60–90 s, so deploys cause no rebalance while a dead member's partitions are reassigned in about a minute. Run on pre-provisioned nodes (over-provision or a buffer node pool) so replacements schedule in seconds. Alert on 'partitions with growing lag and no progress' to catch ownerless partitions. Use a PodDisruptionBudget so voluntary evictions are spread out. For hard failures you can also remove the static member explicitly with an admin call (`removeMembersFromConsumerGroup`) to trigger immediate reassignment."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-07',
      difficulty: 'expert',
      question:
        'A read_committed consumer group reads a topic written only by transactional producers. It is fully caught up — no new records for an hour — yet lag monitoring shows LAG = 1 on every partition. What is the most likely explanation?',
      options: [
        'The consumer is stuck on one poison record per partition that it cannot deserialize',
        'An open transaction is holding the last stable offset, so one record per partition is invisible',
        'Each transaction ends with a commit control marker that takes an offset but is never returned to the consumer, so the committed offset can sit one below the log-end offset',
        'Consumer lag is always off by one because the committed offset is the last processed record, not the next one',
      ],
      correct: [2],
      explanation:
        'Transactional writes append control markers that occupy offsets. After consuming the last data record the consumer commits lastOffset + 1, which points at the marker, while log-end offset is one higher. A poison record would block and grow lag over time. An open transaction would affect more than exactly one offset and would eventually time out. Committed offsets are already the next offset to read, so there is no general off-by-one.',
      followUps: [
        {
          "q": "Your lag alert pages when lag is above 0 for 10 minutes. How do you make it correct for transactional topics?",
          "a": "Alert on time lag or progress, not raw offset difference. Options: compute lag against the last stable offset rather than the log-end offset, because control markers sit at or past the LSO; or alert only when lag exceeds a small threshold (say 5) and is growing, or when the committed offset hasn't advanced while the LSO has. The most robust signal is age of the oldest unprocessed record: if the consumer is caught up on data records, that age is zero even though the offset lag reads 1. Kafka lag exporters often have options for this; check how yours handles markers."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-08',
      difficulty: 'expert',
      question:
        'This consumer\'s lag graph stays at ~0 all day, but analytics finds large gaps after each pod OOM-kill. Which statement best explains both symptoms?',
      code: {
        language: 'typescript',
        code: `const buffer: Array<Record<string, unknown>> = [];
setInterval(() => flushToWarehouse(buffer.splice(0, 5000)), 10_000);

await consumer.run({
  autoCommit: true,
  eachMessage: async ({ message }) => {
    buffer.push(JSON.parse(message.value!.toString())); // returns immediately
  },
});`,
      },
      options: [
        'autoCommit commits offsets before eachMessage is called, so records are skipped even without crashes',
        'Offsets are committed as soon as records enter the in-memory buffer, so lag reads ~0 while up to 10 s (or more, if flushes fall behind) of data exists only in memory and is lost on a crash',
        'setInterval blocks the event loop, which stops heartbeats and causes rebalances that lose data',
        'The OOM kill corrupts the committed offsets, so the consumer resumes from latest',
      ],
      correct: [1],
      explanation:
        'eachMessage returns instantly, so kafkajs marks offsets done and auto-commits them; the real backlog is the unbounded buffer, invisible to lag metrics and lost on a crash. Auto-commit does not commit before the handler runs. setInterval does not block the event loop. Committed offsets are stored in the broker and are not corrupted by the client being killed.',
      followUps: [
        {
          "q": "Batching writes in memory is genuinely needed for throughput, since the sink wants 10K-row inserts. How do you keep batching without losing data on a crash?",
          "a": "Commit offsets only after the flush that contains them succeeds. Use `eachBatchAutoResolve: false`: accumulate messages into the buffer, and after a successful flush call `resolveOffset` for the highest offset in that flush per partition, then commit. Bound the buffer (rows or bytes) and pause partitions when it's full, so the consumer can't outrun the sink. Flush on a timer too, so a partially filled buffer doesn't wait forever. On a crash, everything since the last flush is redelivered, so the sink write must be idempotent (upsert by event id or a dedupe key). Lag then reflects the true unflushed backlog."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-09',
      difficulty: 'medium',
      question:
        'After upgrading RabbitMQ from 3.13 to 4.x, a team notices that a few "impossible to parse" messages in a quorum queue now simply disappear, whereas before they looped forever. No DLX is configured. What changed?',
      options: [
        'RabbitMQ 4.x automatically moves poison messages to a built-in amq.dead-letter queue',
        'Classic mirrored queues were removed, so the queue silently became non-durable',
        'The consumer prefetch default changed to 1, which acknowledges messages automatically',
        'Quorum queues now have a default delivery-limit of 20, so after 20 redeliveries a message is dropped when no dead-letter exchange is configured',
      ],
      correct: [3],
      explanation:
        'RabbitMQ 4.0 set a default delivery-limit of 20 for quorum queues; exceeding it dead-letters the message if a DLX is configured, and otherwise drops it. There is no automatic built-in DLQ. Classic mirrored queues were removed in 4.0, but that does not make quorum queues non-durable. Prefetch does not acknowledge anything. The fix is to configure a DLX (for example a stream) for every quorum queue.',
      followUps: [
        {
          "q": "Configure the DLX. Where should poison messages go, and how do you redrive them in RabbitMQ 4.x?",
          "a": "Set `x-dead-letter-exchange` (and optionally a routing key) through a policy, so it applies to all quorum queues, and use `x-dead-letter-strategy: at-least-once` so dead-lettering is safe across leader changes (this requires `overflow: reject-publish`). Route to a stream or a dedicated quorum queue as the DLQ, keeping the `x-death` headers, which record the original queue, reason and count. Redrive with a small tool or Shovel that republishes to the original exchange at a capped rate after the fix. Alert on DLQ depth growth. Keep the delivery-limit at about 20 or lower so poison messages stop looping quickly."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-10',
      difficulty: 'expert',
      question:
        'Account events (keyed by accountId, each with a version) are consumed in order. On a permanent failure the consumer publishes the event to a DLT and continues. Select ALL statements that are true.',
      options: [
        'Later events for the same account are applied while the failed event is parked, so the account state can diverge from the source of truth',
        'Redriving the parked event later, without a version check, can apply an older state on top of newer ones',
        'Because the DLT is keyed by accountId too, redriving it restores the original order automatically',
        'A safer design parks the failed event and every subsequent event for that accountId until the failure is resolved, while other accounts keep flowing',
        'Using a DLT on an ordered stream is always safe if the consumer is idempotent',
      ],
      correct: [0, 1, 3],
      explanation:
        'On ordered streams, skipping one event lets later ones apply to wrong state, and a naive redrive applies stale data afterwards. Keying the DLT does not interleave it with the main topic, so order is not restored. Blocking the affected key (or version-checked writes) is the safe pattern. Idempotency prevents duplicates, not ordering violations.',
      followUps: [
        {
          "q": "Implement 'park the account'. What state do you keep, and how do the parked events get processed in order once fixed?",
          "a": "Keep a `parked_keys` table: (accountId, first_failed_offset, reason, parked_at). In the main consumer, check whether the event's accountId is parked (cache this in memory, refreshed on change). If so, append the event to a per-key holding store (a table ordered by original offset, or a 'parked' topic keyed by accountId) instead of applying it. Other accounts flow normally. After the fix, a redrive job processes that account's held events strictly in offset order, starting with the failed one, then deletes the parked row. Alert on parked count and age; a parked account is effectively frozen, so it needs a human."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-11',
      difficulty: 'expert',
      question:
        'This consume-transform-produce loop uses a Kafka transaction and also writes an audit row to Postgres. The pod crashes after the Postgres insert but before commit(). What happens after restart?',
      code: {
        language: 'typescript',
        code: `const tx = await producer.transaction();
try {
  await tx.send({ topic: 'invoices.v1', messages: [{ key: id, value: invoiceJson }] });
  await pg.query('INSERT INTO audit_log(event_id, action) VALUES ($1, $2)', [eventId, 'INVOICED']);
  await tx.sendOffsets({ consumerGroupId: 'invoicer', topics: [offsets] });
  await tx.commit();
} catch (e) {
  await tx.abort();
  throw e;
}`,
      },
      options: [
        'The invoice record is aborted and the input is reprocessed, so read_committed consumers see one invoice, but audit_log gets a second row for the same event',
        'Everything is exactly-once: the Kafka transaction also rolls back the Postgres insert',
        'The invoice is visible twice to read_committed consumers, but audit_log has one row',
        'The input offset was committed by sendOffsets, so the event is never reprocessed and the invoice is lost',
      ],
      correct: [0],
      explanation:
        'Kafka transactions cover Kafka writes and consumer offsets only. The uncommitted transaction is aborted, the offset is not committed, the event is reprocessed and a new invoice is committed once — but the Postgres insert happened outside the transaction and runs again. sendOffsets takes effect only on commit. Fix: a unique constraint on audit_log.event_id with ON CONFLICT DO NOTHING, or an inbox pattern.',
      followUps: [
        {
          "q": "The audit_log is in Postgres and invoices go to Kafka. Is there a design that gives you exactly one of each without ON CONFLICT tricks?",
          "a": "Flip the transaction boundary: make Postgres the transaction. In one DB transaction, insert the audit row, insert an outbox row for the invoice event, and record the consumed offset for this partition in a `consumer_offsets` table. Commit. A relay or CDC publishes the outbox to Kafka. On restart, the consumer seeks to the offset stored in Postgres, not Kafka's group offset. Input progress, audit and the pending output are atomic in one store. The relay may publish an invoice twice, so give it a stable event id for downstream dedupe."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-12',
      difficulty: 'hard',
      question:
        'A Java analytics consumer downstream of a transactional producer counts "orders created" and consistently reports ~0.5% more orders than the orders database. The producer aborts transactions when validation fails later in its pipeline. The consumer uses default settings. What is the most likely cause?',
      options: [
        'The idempotent producer is disabled, so retries create duplicates',
        'The Java consumer defaults to isolation.level=read_uncommitted, so it counts records from aborted transactions',
        'Aborted transactions are deleted from the log, which shifts offsets and causes re-reads',
        'The consumer auto-commits offsets too often, causing some records to be counted twice',
      ],
      correct: [1],
      explanation:
        'The Java consumer\'s default isolation level is read_uncommitted, so records written in aborted transactions are delivered. Setting read_committed filters them out. The producer is transactional, which implies idempotence. Aborted records are not deleted; they stay in the log with an abort marker. Frequent commits reduce duplicates, not increase them.',
      followUps: [
        {
          "q": "You switch to read_committed and counts match, but the dashboard now updates in bursts every few seconds instead of smoothly. Why?",
          "a": "read_committed consumers can only read up to the last stable offset, so records become visible only when their transaction commits. If the producer commits every few seconds (Kafka Streams' `commit.interval.ms` defaults to 100 ms under EOS but many custom producers batch for seconds), records arrive in bursts at commit time. To smooth it, have the producer commit more often (shorter transactions, at the cost of more marker overhead), or accept the latency. Watch long-running transactions in particular: one slow transaction delays every later record on that partition, even from other producers."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-13',
      difficulty: 'expert',
      question:
        'A Kafka Streams app uses processing.guarantee=exactly_once_v2. It reads payments, keeps per-merchant totals in a state store, writes to merchant-totals, and calls a webhook for every payment over ₹1 lakh. Select ALL outcomes guaranteed after an instance crash and restart.',
      options: [
        'Each input payment is reflected exactly once in the state store totals',
        'read_committed consumers of merchant-totals never see output from an aborted attempt',
        'Each large payment triggers exactly one webhook call',
        'Input offsets, state store changelog writes and output records commit atomically together',
        'Output reaches downstream consumers with no added latency compared with at-least-once mode',
      ],
      correct: [0, 1, 3],
      explanation:
        'EOS v2 commits offsets, changelog writes and outputs in one Kafka transaction, so state and output reflect each input once for read_committed readers. The webhook is an external side effect: after an abort the payment is reprocessed and the webhook can fire again, so it needs an idempotency key. Transactions add latency (commit interval plus markers), so the last option is false.',
      followUps: [
        {
          "q": "Design the webhook path so a large payment notifies the merchant once despite EOS replays.",
          "a": "Don't call the webhook from inside the Streams topology. Instead, emit a `LargePaymentDetected` record to an output topic within the EOS transaction, so it appears exactly once for read_committed readers. A separate webhook-sender service consumes that topic and calls the merchant with `Idempotency-Key: payment-<paymentId>`, recording delivery in a table with a unique paymentId. The sender is at-least-once (it retries with backoff), and the merchant dedupes by key. Replays inside Streams produce aborted records that the sender never sees, so the external side effect is decoupled from transaction retries."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-14',
      difficulty: 'hard',
      question:
        'Finance reports a handful of double charges that all happened during PSP timeouts, even though the PSP supports idempotency keys and this client "uses them". Why?',
      code: {
        language: 'typescript',
        code: `async function charge(orderId: string, amount: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await psp.post('/charges', { orderId, amount }, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        timeout: 2_000,
      });
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(fullJitter(attempt));
    }
  }
}`,
      },
      options: [
        'Full jitter can make two attempts overlap in time, and the PSP deduplicates only sequential requests',
        'The 2 s timeout is shorter than the PSP p99, which by itself causes double charges even without retries',
        'Idempotency keys only work with PUT requests, so POST /charges ignores them',
        'A new idempotency key is generated on every attempt, so after a timeout the PSP treats the retry as a different charge',
      ],
      correct: [3],
      explanation:
        'A timed-out request may have succeeded; the retry is safe only if it carries the same key so the PSP can return the original result. Generating the key inside the loop defeats that. The sleep happens before each retry, so attempts do not overlap. A short timeout causes more ambiguous outcomes but not duplicates by itself. Idempotency keys are designed for POST. Derive the key from orderId (or create it once before the loop).',
      followUps: [
        {
          "q": "Now the first attempt times out at 2 s, but the PSP is still processing it when the retry arrives with the same key. What does a correct PSP do, and what must your client handle?",
          "a": "A well-behaved PSP locks the key on first receipt. A concurrent request with the same key gets a `409 Conflict` (Stripe returns an idempotency error saying the original request is in progress) rather than a second charge. Your client must treat 409 or 'in progress' as retryable after a backoff, not as a failure, and eventually receive the original result. If the retry budget runs out, mark the order PAYMENT_UNKNOWN and reconcile asynchronously by querying the PSP by idempotency key or order reference, rather than showing 'payment failed' and inviting the user to pay again."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-15',
      difficulty: 'expert',
      question:
        'A client fleet uses a retry budget: each success adds 0.1 token (cap 50 per pod), each retry costs 1 token, first attempts are never blocked. The dependency goes fully down for 10 minutes. What load does it see, relative to normal, after the first few seconds?',
      options: [
        'About 1.1× for the whole outage, because the budget always permits 10% retries',
        'About 4×, because the budget only limits retries per request, not per pod',
        'About 1× — after each pod spends its 50 tokens, no retries are allowed because no successes refill the bucket',
        'About 0×, because the budget also blocks first attempts once tokens run out',
      ],
      correct: [2],
      explanation:
        'Tokens are earned only from successes. During a total outage the bucket drains after a one-off burst of up to 50 retries per pod, then only first attempts reach the dependency — ~1× load. 1.1× is the steady-state bound when ~all calls succeed, not during a total outage. The budget is per pod, not per request. First attempts are never blocked in this design.',
      followUps: [
        {
          "q": "The dependency recovers but only to 70% capacity. How does the budget behave, and is that what you want?",
          "a": "As successes return, tokens refill at 0.1 per success. With about 70% success, each pod earns tokens for roughly 7% extra retries, so load is about 1.07× first attempts. That's a gentle retry level that helps users without hammering a half-recovered service. The bucket refills toward its cap of 50 over time, so a later blip gets a modest burst again. If the dependency is still overloaded at 70%, combine this with client-side throttling (adaptive, like Google SRE's `requests/accepts` ratio) so even first attempts back off locally when the reject rate is high."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-16',
      difficulty: 'hard',
      question:
        'During an incident the recommendations service slows to ~20 s. This wrapper reliably returns a fallback after 300 ms, yet the calling pods run out of sockets and memory. Why?',
      code: {
        language: 'typescript',
        code: `const agent = new https.Agent({ keepAlive: true, maxSockets: 100 });

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

app.get('/home', async (_req, res) => {
  const recs = await withTimeout(fetchRecs(agent), 300, []);
  res.json({ recs, ...(await loadCore()) });
});`,
      },
      options: [
        'Promise.race stops waiting but does not cancel the request, so each call keeps a socket and its buffers for ~20 s; at 100 sockets new calls queue inside the agent',
        'setTimeout inside Promise.race blocks the event loop for 300 ms per request',
        'keepAlive connections cannot be reused after a timeout, so the agent opens a new socket every time',
        'The fallback [] is shared by reference between requests, which leaks memory',
      ],
      correct: [0],
      explanation:
        'The losing promise of Promise.race keeps running: the HTTP request holds its socket until the 20 s response arrives. With ~hundreds of calls per second, the 100-socket pool fills and requests queue behind it, still accumulating memory. Timers do not block the event loop. keepAlive reuse is not the problem here, and a shared empty array does not leak. Pass an AbortSignal (AbortSignal.timeout(300)) so the socket is actually released.',
      followUps: [
        {
          "q": "After switching to AbortSignal.timeout(300), sockets are released, but the recommendations service still receives the full load and keeps working on abandoned requests. Can you fix that too?",
          "a": "Aborting the client closes the socket, and many servers don't notice: they finish computing a response nobody reads. Fixes on the server: propagate a deadline header (`x-request-deadline`) and check it before expensive steps; listen for `req.on('close')` and cancel downstream work through an AbortController. On the client: add a circuit breaker so that when timeouts exceed a threshold, calls are skipped entirely and the fallback is returned immediately. That actually removes load from the struggling cluster, while aborts alone only protect the caller's resources."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-17',
      difficulty: 'expert',
      question:
        'The edge gives GET /itinerary an absolute deadline of 900 ms. Service A spends 550 ms on its own work and a first call, then needs to call service B, whose p99 is 250 ms. A has a static 1 s timeout for B. What should A do?',
      options: [
        'Call B with its 1 s timeout, because B\'s p99 of 250 ms means it will usually finish in time',
        'Call B with a 250 ms timeout and retry once on failure, because two attempts fit within the 1 s static timeout',
        'Return 504 immediately, because the remaining budget is shorter than B\'s static timeout',
        'Call B with a timeout of the remaining budget minus a margin (~300 ms), pass the deadline downstream, and skip the call if too little budget remains',
      ],
      correct: [3],
      explanation:
        'About 350 ms remain; keeping ~50 ms to respond leaves ~300 ms, which is above B\'s p99, so the call is worth making with that bound and with the deadline propagated so B can stop early. A 1 s timeout lets A keep working long after the edge has given up. A retry does not fit in the remaining budget. Returning 504 wastes a call that would very likely succeed.',
      followUps: [
        {
          "q": "B itself calls C. How should B use the propagated deadline, and what header format would you use?",
          "a": "Propagate an absolute deadline, not a duration. A sends `x-request-deadline: <epoch ms>` (or gRPC's `grpc-timeout`, which each hop recomputes). B computes remaining = deadline − now − its own margin, sets C's timeout to that, and skips C or returns partial data if remaining is below a useful floor. Absolute timestamps automatically account for queueing time at each hop. They require clocks synchronised within a few milliseconds via NTP, which is fine in a cloud region. Also, B should reject a request on arrival if its deadline has already passed, before doing any work."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-18',
      difficulty: 'medium',
      question:
        'Two services in the same AZ talk over HTTP. The client has connectTimeout = 10 s and requestTimeout = 500 ms. The target pod is killed without draining and its IP is not yet removed from the client\'s endpoint list. What is the main problem?',
      options: [
        'The request timeout is too short; it should be at least as long as the connect timeout',
        'Connections to a dead IP can hang for up to 10 s before failing, far longer than the request timeout; connect timeouts in-region should be ~100–300 ms',
        'Nothing: the request timeout of 500 ms always also bounds the connect phase',
        'The client should disable the connect timeout and rely on TCP keepalive',
      ],
      correct: [1],
      explanation:
        'Many clients apply the connect timeout separately from (or before) the request timeout, so a SYN to a dead IP waits up to 10 s. In-region handshakes take a few milliseconds, so a short connect timeout fails fast and lets the retry reach a healthy pod. The request timeout does not necessarily cover connect. TCP keepalive detects dead idle connections over minutes, not failed connects.',
      followUps: [
        {
          "q": "You set connect timeout to 200 ms. The endpoint list still includes the dead IP for 30 s. What else stops repeated 200 ms penalties on every request?",
          "a": "Use passive outlier detection in the client or sidecar. After N consecutive connect failures to an endpoint (say 3), eject it from the local pool for a backoff period (30 s, doubling). Combine that with a retry to a different endpoint (`previous_hosts` predicate), so the user sees roughly 200 ms extra once, not an error. Better still, shrink the window at the source: proper pod termination (readiness fails first, preStop sleep) means the IP leaves endpoints before the pod dies. Faster EndpointSlice propagation and client-side watch-based discovery reduce staleness further."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-19',
      difficulty: 'hard',
      question:
        'A signup service wraps calls to the address-validation API in a circuit breaker (50% error threshold). A marketing campaign brings many users who type invalid postcodes, for which the API returns 422. What happens, and what is the fix?',
      options: [
        'Nothing: circuit breakers ignore all 4xx responses by default in every library',
        'The breaker opens, which is correct because the API is clearly unhealthy under campaign load',
        'The breaker counts 422s as failures, opens, and blocks valid addresses too; configure it to count only 5xx, timeouts and connection errors',
        'The breaker half-opens repeatedly, doubling the load on the API',
      ],
      correct: [2],
      explanation:
        'A 422 is a correct answer about bad input, not a sign of an unhealthy dependency. Many breakers (opossum by default) count any rejected promise, so a surge of validation errors can open it and reject valid requests. Use an error filter so only dependency failures count. Library defaults vary, so do not assume. The API is healthy, so opening is wrong. Half-open probes are few and do not double load.',
      followUps: [
        {
          "q": "You filter 4xx out of the breaker. The API then starts returning 429 under the campaign load. Should 429 open the breaker?",
          "a": "429 is a capacity signal, not bad input, so it should drive backoff. But opening a breaker on 429 blocks all signups even though the API is partly accepting. Better: honour `Retry-After` and use a client-side rate limiter (token bucket) that adapts its rate down on 429 and slowly back up (AIMD), queueing or briefly delaying validation. If 429s persist, degrade: accept the address with 'validation pending' and validate asynchronously later, rather than failing signups. Track 429 separately in metrics from 5xx and timeouts."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-20',
      difficulty: 'expert',
      question:
        'During a pricing outage, dashboards show the breaker for pricing never opened, even though 100% of calls fail at ~800 RPS per pod. What is the bug?',
      code: {
        language: 'typescript',
        code: `import CircuitBreaker from 'opossum';

@Injectable()
export class PricingClient {
  async getPrice(sku: string) {
    const breaker = new CircuitBreaker(() => this.http.get('/price/' + sku), {
      timeout: 300, errorThresholdPercentage: 50, resetTimeout: 30_000, volumeThreshold: 20,
    });
    breaker.fallback(() => ({ sku, price: null, stale: true }));
    return breaker.fire();
  }
}`,
      },
      options: [
        'A new breaker is created per call, so each one has only one request of history and never reaches the volume threshold; it must be created once and reused',
        'volumeThreshold: 20 is too high for 800 RPS; the breaker needs a threshold below 5',
        'The fallback swallows errors, so opossum records every call as a success',
        'timeout: 300 is counted as a success in opossum, so slow failures never open the breaker',
      ],
      correct: [0],
      explanation:
        'Breaker state is per instance. Building one inside getPrice means every request gets a fresh CLOSED breaker with a single data point, so it can never open. 20 calls is reached in milliseconds at 800 RPS on a shared instance. Opossum still records the failure when a fallback runs, and timeouts count as failures. Create one breaker per dependency (or per endpoint) at construction time and pass the sku as an argument to fire().',
      followUps: [
        {
          "q": "With one shared breaker per dependency, a single slow SKU endpoint (one bad product) opens the breaker for all pricing calls. How do you scope breakers?",
          "a": "Scope by failure domain, not by individual argument. One breaker per downstream endpoint or operation (`GET /price`, `POST /quote`) rather than per SKU, since per-SKU breakers would be thousands of instances with too little data each to decide anything. If a single bad SKU causes errors, handle it as a data problem: per-key negative caching (remember that sku 123 fails for 60 s) and alerting. If pricing is sharded by host or region, use a breaker per shard so one bad shard doesn't block the rest. Limit the number of breaker instances (LRU) to avoid unbounded memory."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-21',
      difficulty: 'hard',
      question:
        'An export job streams 40 GB from S3 to a slow SFTP destination. Memory grows until the pod is OOM-killed. What is the most accurate diagnosis and fix?',
      code: {
        language: 'typescript',
        code: `const source = s3Stream(bucket, key);   // Readable, ~200 MB/s
const dest = sftp.createWriteStream(path); // Writable, ~20 MB/s
source.on('data', (chunk) => {
  dest.write(chunk);
});
source.on('end', () => dest.end());`,
      },
      options: [
        'The data event delivers chunks too large for SFTP; set a smaller highWaterMark on the source only',
        'write() returning false is ignored, so chunks pile up in the writable\'s buffer; use stream.pipeline(source, dest) (or pause on false and resume on drain)',
        'S3 streams must be fully downloaded before writing; buffer to disk first',
        'dest.end() is called too early, which makes Node retain all chunks until garbage collection',
      ],
      correct: [1],
      explanation:
        'The source produces 10× faster than the destination drains. write() returns false once the buffer passes highWaterMark, but the code keeps writing, so memory grows with the difference (~180 MB/s). pipeline() pauses the source on backpressure and resumes on drain, and propagates errors. A smaller source highWaterMark changes chunk size, not the rate mismatch. Buffering 40 GB to disk is unnecessary. end() is called only after the source ends.',
      followUps: [
        {
          "q": "With pipeline() the memory is flat, but the job now takes 6 hours because SFTP is slow. The job runs as a Kubernetes Job with a 2-hour deadline. What do you change?",
          "a": "Make it resumable and parallel. Split the 40 GB into ranges (S3 `Range` GETs) or into multiple files, upload in parallel over several SFTP connections if the destination allows, and record per-chunk completion in a DB or a manifest file. Write each chunk to a temp name and rename it after verifying size or checksum. On restart, skip completed chunks. Raise or remove the job deadline, or run each chunk as a separate job. Also check the SFTP client: many have small default window and packet sizes, and raising concurrency of outstanding writes often multiplies throughput on high-latency links."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-22',
      difficulty: 'expert',
      question:
        'A kafkajs consumer calls a downstream API that is rate-limited to 500 rps per pod, and memory spikes when the downstream slows. Select ALL changes that add real backpressure.',
      options: [
        'Pause the partition with consumer.pause() when the in-process work queue reaches a high-water mark, and resume at a low-water mark',
        'Await a bounded-concurrency pool inside eachBatch before resolving offsets, so the consumer does not fetch more until work completes',
        'Increase sessionTimeout so slow processing no longer triggers rebalances',
        'Use Promise.all over the whole batch so the batch completes as fast as possible',
        'Honour 429 Retry-After by shrinking the per-pod token bucket rate and pausing partitions while it is empty',
      ],
      correct: [0, 1, 4],
      explanation:
        'Pausing partitions, awaiting bounded work before fetching more, and adapting to the downstream\'s rate signals all slow intake to match capacity. A longer session timeout only hides slowness from the group coordinator; it does nothing to intake rate. Promise.all over a whole batch creates an unbounded burst against a rate-limited API — the opposite of backpressure.',
      followUps: [
        {
          "q": "Pausing partitions works, but the downstream recovers and the consumer resumes all partitions at once, spiking it again. How do you ramp back up?",
          "a": "Resume gradually. Use AIMD on the token-bucket rate: after a 429 or slowdown, halve the rate; on each healthy interval (for example 5 s without errors and p99 under target), add a small step (+10%). Resume partitions one at a time rather than all at once, and cap per-pod concurrency at the current rate × latency. Across 20 pods, add jitter to resume timing so they don't step up together. Track the effective rate as a metric so you can see the ramp and tune the step size."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-23',
      difficulty: 'expert',
      question:
        'A server processes requests from an unbounded FIFO queue. Capacity is 1,000 rps, offered load is 1,300 rps, and clients time out at 1 s and retry once. What happens after about a minute if nothing sheds?',
      options: [
        'Throughput settles at 1,000 rps and about 77% of requests succeed, because the server serves as many as it can',
        'The queue stabilises at 300 requests because clients time out and their requests are removed from the queue automatically',
        'Latency rises to about 1.3 s, and most requests succeed after one retry',
        'Queue wait exceeds 1 s within seconds; the server keeps working at 1,000 rps but nearly every response arrives after its client has timed out, and retries push offered load towards 2,600 rps — goodput close to zero',
      ],
      correct: [3],
      explanation:
        'The queue grows by ~300 requests per second, so wait passes 1 s after a few seconds and keeps rising. Timed-out requests are usually still in the queue and still get processed (servers rarely know the client left), so work is wasted and retries add load. The "77% success" answer assumes the server drops excess work, which an unbounded FIFO does not. Bounding the queue by wait time, dropping expired requests and rejecting fast restores goodput.',
      followUps: [
        {
          "q": "You bound the queue by wait time at 800 ms. What should happen to requests already being processed when their client has timed out?",
          "a": "Cancel them where possible. Propagate the deadline into the handler (AbortSignal), check it before expensive steps (DB queries, downstream calls), and abort when it passes. Listen for client disconnect (`req.on('close')`) and abort the downstream calls tied to that request. Not all work can stop: a DB write in a transaction should complete or roll back cleanly. But read paths can stop immediately. This reclaims capacity during overload and pairs with queue shedding: shedding stops new wasted work, cancellation stops in-flight wasted work."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-24',
      difficulty: 'hard',
      question:
        'You are adding load shedding to an API behind a load balancer that health-checks GET /healthz every 5 s. Select ALL design choices that are correct.',
      options: [
        'Exempt /healthz (and readiness probes) from the shedder so an overloaded but working instance is not pulled from rotation',
        'Shed requests marked as retries (for example with an x-retry-attempt header) before first attempts',
        'Return 503 with Retry-After before doing authentication, DB or downstream work',
        'Shed by random sampling only, so every client is treated equally regardless of endpoint',
        'Let /healthz queue with other requests so it fails first and the load balancer removes the instance, which reduces load',
      ],
      correct: [0, 1, 2],
      explanation:
        'If health checks are shed or queued, the load balancer removes an instance that is doing useful work, and its traffic moves to the remaining instances, which then overload too. Shedding retries first reduces amplification, and cheap early rejection keeps the cost of saying no low. Random shedding ignores business priority. Removing instances during overload increases the load on the others — it is a cascading failure pattern.',
      followUps: [
        {
          "q": "Every client claims x-priority: 0 once they discover it. How do you make priority trustworthy?",
          "a": "Don't trust client-supplied priority from outside the trust boundary. Strip or overwrite `x-priority` at the edge, and set it there from things the server controls: the route (checkout = critical, recommendations = sheddable), the authenticated client type (first-party app vs partner batch API key), or a signed claim in the service token. Internal services can propagate the edge-assigned priority. Monitor priority distribution: if 'critical' grows from 10% to 60% of traffic, something is mislabelled, and shedding loses its value."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-25',
      difficulty: 'medium',
      question:
        'The pricing service for a product page is down; a cached price from 10 minutes ago is available. Which degradation is the most appropriate?',
      options: [
        'Show the cached price and charge it at checkout, because 10 minutes is recent enough for most products',
        'Hide the whole product page until pricing recovers, because any stale price is misleading',
        'Show the cached price marked as "confirmed at checkout", and require a live price at checkout, failing that step clearly if pricing is still down',
        'Show the product with no price and let the payment service compute it at charge time from its own copy',
      ],
      correct: [2],
      explanation:
        'Browsing can tolerate bounded staleness, but the charged amount cannot — a price change or an expired promotion would mean charging the wrong amount. Hiding the whole page throws away a working catalog. Letting the payment service compute a price from a separate copy creates two sources of truth and moves the problem to the most sensitive step.',
      followUps: [
        {
          "q": "Pricing stays down for 2 hours. At what point does the 'stale but marked' approach stop being acceptable, and what do you do then?",
          "a": "Set a staleness ceiling per business rule. Many retailers allow displaying cached prices for about 30–60 minutes, but promotions with end times, flash sales or volatile categories need shorter limits. Beyond the ceiling, hide the price ('price unavailable, check back shortly') and disable add-to-cart for affected items, while keeping catalog browsing up. Checkout still requires a live price, so checkout is effectively down for those items: show a clear message and capture intent (wishlist or 'notify me'). Track how much revenue the degraded mode costs to decide whether pricing needs a cross-region standby."
        }
      ],
    },
    {
      id: 'misc-async-resilience-mcq-26',
      difficulty: 'hard',
      question:
        'During a regional incident the feature-flag service is also down. Pods restarted during the incident run with a recommendations kill switch "off" (recommendations enabled), and they overload the struggling recommendations cluster. What design prevents this?',
      options: [
        'The flag SDK persists last-known values locally and falls back to compiled-in safe defaults at startup; critical kill switches also have a path that does not depend on the flag service',
        'Evaluate flags with a synchronous remote call per request so pods always see the latest value',
        'Block pod startup until the flag service is reachable, so no pod runs with unknown flags',
        'Default every flag to "on" so that features keep working when the flag service is unavailable',
      ],
      correct: [0],
      explanation:
        'Flags must fail static: last-known-good values on disk and conservative coded defaults, plus an out-of-band path (ConfigMap/env or an edge rule) for kill switches. A remote call per request makes every request depend on the flag service. Blocking startup turns a flag outage into a capacity outage. Defaulting everything to on is exactly what overloaded the recommendations cluster.',
      followUps: [
        {
          "q": "How do you test that the flag fallbacks actually work before the next incident?",
          "a": "Run a chaos experiment: in staging, then in a production canary, block egress to the flag service with a network policy, then restart pods and assert that they start, read last-known values from the local cache file or fall back to the coded safe defaults (recommendations off), and serve traffic. Add a unit test that the SDK initialises within a timeout without the network. Verify the out-of-band kill switch (ConfigMap or edge rule) flips the feature within the expected time. Schedule this as a quarterly game day, because the postmortem's lesson is that untested fallbacks rot."
        }
      ],
    },
  ],
};

export default topic;
