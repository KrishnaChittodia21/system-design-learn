import type { Topic } from '../../types';

const topic: Topic = {
  id: 'prod-async-failure',
  phase: 'production',
  order: 3,
  title: 'Incidents III: Async, Dependencies & Resilience',
  subtitle:
    'Growing queues, slow and crashing consumers, duplicates, ordering, retries and retry storms, unavailable or slow downstreams, circuit breakers, cascading failures and noisy tenants',
  estimatedMinutes: 115,
  sources: [
    'Google SRE Book — Ch 21 Handling Overload & Ch 22 Addressing Cascading Failures',
    'Alex Xu — System Design Interview Vol 2, Ch 4 Distributed Message Queue',
    'Michael Nygard — Release It! (Stability Patterns: Circuit Breaker, Bulkhead, Timeouts)',
    'AWS Architecture Blog — Exponential Backoff and Jitter; AWS Builders Library — Shuffle Sharding',
  ],
  tags: ['incident', 'kafka', 'consumer-lag', 'idempotency', 'ordering', 'retries', 'circuit-breaker', 'cascading-failure', 'rate-limiting', 'noisy-neighbor', 'war-room'],
  cheatSheet: [
    'Queue incidents: look at lag AND age of oldest message, produce rate vs consume rate. Drain time = backlog ÷ (consume − produce). If consume ≤ produce the backlog never drains.',
    'Kafka parallelism cap = partitions per consumer group; consumer #25 on 24 partitions idles. Beyond that: faster per-message work, batching, or more partitions (which remaps keys → breaks per-key ordering during the change).',
    'Every real queue is at-least-once: crash between "process" and "commit/ack" = redelivery. Commit after processing, and make consumers idempotent (inbox table / unique constraint / idempotency key).',
    'Poison message = one message that always fails; with in-order partitions it blocks everything behind it. Bounded retries → retry topic → DLQ, with alerting and a replay tool.',
    'Ordering is per partition/key only. Retries, parallel consumers and DLQs all break ordering; protect correctness with per-key sequence numbers / version checks, not hope.',
    'Retries: only on retryable errors (timeouts, 503, 429 with Retry-After), only idempotent operations (or with idempotency keys), exponential backoff + full jitter, max attempts, and a retry budget (~10% extra load).',
    'Retry amplification: 3 attempts at each of 4 layers = 3⁴ = 81× load on the bottom service. Retry at one layer (usually the edge-most caller closest to the failure), not all.',
    'Timeouts are mandatory on every network call and must shrink down the call chain (deadline propagation). Little\'s law: in-flight = RPS × latency — a downstream going 50 ms → 5 s multiplies your in-flight requests 100×.',
    'Circuit breaker: closed → open after error-rate threshold over a minimum volume → half-open probes after a cool-down. Fail fast with a fallback instead of queueing on a dead dependency.',
    'Noisy neighbour: per-tenant rate limits and concurrency quotas, fair queuing, bulkheads (separate pools/queues), and shuffle sharding / cells so one customer can only hurt a small slice.',
  ],
  sections: [
    {
      heading: '1. Incident: the queue keeps growing — consumer slower than producer',
      body: `**Intuition:** a queue is a bathtub. If the tap (producers) runs faster than the drain (consumers), the water level rises no matter how big the tub is. A bigger tub only buys time.

**Symptoms:** consumer lag rising for minutes/hours; **age of oldest message** rising (users see stale notifications, late emails, delayed order confirmations); broker disk growing; possibly messages expiring past retention (Kafka \`retention.ms\`, SQS max 14 days) — i.e. data loss.

**First 5 minutes:**
1. **Rates, not depth**: produce rate vs consume rate per topic/queue. Did producers spike (campaign, backfill, replay) or did consumers slow down (deploy, downstream latency)?
2. **Per-partition lag**: is lag spread evenly (capacity problem) or concentrated on a few partitions (hot key, stuck consumer, poison message)?
3. **Consumer health**: how many members in the group vs partitions, rebalance frequency, per-message processing time, errors/retries.
4. **Downstream of the consumer**: most "slow consumers" are waiting on a DB or HTTP call.

**Root causes:** traffic spike; a deploy made per-message work slower; downstream (DB, API) slowed; consumers stuck in rebalance loops (processing longer than \`max.poll.interval.ms\`, default 5 min, kicks the consumer out → rebalance → reprocessing); a hot partition; a poison message retried forever at the head of a partition; fewer consumers than partitions after a crash.

**Fix now:**
- Scale consumers up to the partition count (Kafka) or add workers (SQS/RabbitMQ — no partition cap).
- If the downstream is the bottleneck, do **not** add consumers — reduce work: batch writes, skip non-essential side effects, shed low-priority messages to a later queue.
- Skip/park the poison message (move to DLQ) if one partition is stuck.
- Pause non-critical producers (backfills, replays).

**Fix permanently:** size partitions for the peak consumer parallelism you'll need (e.g. 2–3× today); autoscale consumers on lag/age (KEDA); batch processing (\`eachBatch\`, bulk DB writes); separate topics by priority; per-message timeouts; alert on *age of oldest message* against the SLO, not raw depth.

**What to say in the interview:** "Depth alone is meaningless — I compare produce and consume rates and look at per-partition lag. Even lag means capacity; skewed lag means a hot key or a stuck consumer. And I scale consumers only if the bottleneck is the consumer, not its downstream."`,
      code: [
        {
          language: 'bash',
          title: 'Kafka: where is the lag, and who owns which partition?',
          code: `# Per-partition lag and owner for a consumer group
kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group order-events-svc
# GROUP             TOPIC         PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG      CONSUMER-ID
# order-events-svc  order-events  0         91234011       91234210       199      consumer-1-ab..
# order-events-svc  order-events  7         88120000       90310554       2190554  consumer-4-9f..  <- hot/stuck
# order-events-svc  order-events  8         -              90110200       -        -               <- unassigned!

# Group state: Stable vs PreparingRebalance (rebalance loop?) and member count
kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group order-events-svc --state
kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group order-events-svc --members

# PromQL (kafka_exporter): total lag and lag growth rate (positive = falling behind)
#   sum by (consumergroup, topic) (kafka_consumergroup_lag)
#   deriv(sum by (consumergroup) (kafka_consumergroup_lag)[10m:1m])
# produce vs consume rate
#   sum(rate(kafka_topic_partition_current_offset{topic="order-events"}[5m]))
#   sum(rate(kafka_consumergroup_current_offset{consumergroup="order-events-svc"}[5m]))

# SQS equivalent: depth and age of the oldest message
aws cloudwatch get-metric-statistics --namespace AWS/SQS \\
  --metric-name ApproximateAgeOfOldestMessage --dimensions Name=QueueName,Value=emails \\
  --statistics Maximum --period 60 --start-time 2026-09-28T10:00:00Z --end-time 2026-09-28T10:30:00Z`,
        },
      ],
      keyPoints: [
        'Drain time = backlog ÷ (consume rate − produce rate).',
        'Even lag → capacity; skewed lag → hot key, stuck consumer or poison message.',
        'Consumers beyond partition count idle; the downstream is often the real bottleneck.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 4 Distributed Message Queue',
    },
    {
      heading: '2. Incident: consumer crashes during processing (and poison messages)',
      body: `**Intuition:** if a courier drops dead halfway through a delivery, the parcel must go back on the shelf for someone else — and if one parcel is cursed and kills every courier who touches it, you must quarantine it, not keep reassigning it.

**Symptoms:** consumer pods in CrashLoopBackOff or restarting; the same offsets processed repeatedly; lag stuck on one partition while others drain; SQS \`ApproximateReceiveCount\` climbing on specific messages; rebalance storms in the group.

**First 5 minutes:**
- Consumer logs around the crash: same message key/offset every time? → **poison message** (bad schema, null field, huge payload, unhandled enum).
- Crash on all messages after a deploy → code/config regression; roll back.
- OOMKilled → large messages or unbounded batch buffering.
- Processing time vs \`max.poll.interval.ms\` / SQS visibility timeout — slow processing looks like a crash to the broker (message redelivered to another consumer while the first is still working).

**Root causes:** unhandled exception on malformed input; schema change by a producer without compatibility checks; OOM on a large batch; processing exceeding poll interval / visibility timeout; downstream timeouts treated as fatal.

**Fix now:** roll back a bad consumer deploy; skip the poison offset (commit past it, after saving the payload) or let the retry/DLQ path park it; raise visibility timeout / poll interval if processing legitimately takes longer; lower batch size.

**Fix permanently:**
- **Commit/ack only after successful processing** (at-least-once) — and make processing idempotent (next section).
- **Classify errors**: transient (timeout, 503) → retry with backoff; permanent (validation, deserialisation) → straight to DLQ. Never crash the process on a single bad message.
- **Retry topics + DLQ** (\`orders.retry.1m\`, \`orders.retry.10m\`, \`orders.dlq\`) so a failing message doesn't block its partition, with a replay tool and an alert on DLQ inflow.
- **Schema registry** with backward-compatibility enforcement on producers.
- Heartbeats during long processing; keep per-message work well under the poll interval.

**What to say in the interview:** "A crash between processing and commit means redelivery — that's the at-least-once contract, so I make handlers idempotent. A poison message must never take down the consumer: I classify errors, retry transient ones with backoff, and park permanent failures in a DLQ with alerting and replay."`,
      code: [
        {
          language: 'typescript',
          title: 'KafkaJS consumer: commit after processing, classify errors, DLQ poison messages',
          code: `import { Kafka, EachMessagePayload } from 'kafkajs';

const kafka = new Kafka({ clientId: 'orders-consumer', brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'orders-svc', sessionTimeout: 30_000 });
const producer = kafka.producer({ idempotent: true });

class PermanentError extends Error {}           // validation, bad schema, unknown enum

async function handle({ topic, partition, message, heartbeat }: EachMessagePayload) {
  let event: { orderId: string; type: string };
  try {
    event = JSON.parse(message.value!.toString());
  } catch {
    throw new PermanentError('undeserializable');
  }
  await processOrderEvent(event, heartbeat);     // idempotent; calls heartbeat() on long work
}

export async function start() {
  await Promise.all([consumer.connect(), producer.connect()]);
  await consumer.subscribe({ topics: ['orders'] });
  await consumer.run({
    autoCommit: false,                           // we decide when an offset is done
    eachMessage: async (payload) => {
      const { topic, partition, message } = payload;
      try {
        await handle(payload);
      } catch (err) {
        const permanent = err instanceof PermanentError;
        // transient -> retry topic (delayed consumer); permanent -> DLQ. Never block the partition.
        await producer.send({
          topic: permanent ? 'orders.dlq' : 'orders.retry.1m',
          messages: [{ key: message.key, value: message.value,
            headers: { ...message.headers, 'x-error': String(err), 'x-src': topic + ':' + partition + ':' + message.offset } }],
        });
      }
      // commit only after processing OR parking the message (next offset = offset + 1)
      await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
    },
  });
}

declare function processOrderEvent(e: { orderId: string; type: string }, hb: () => Promise<void>): Promise<void>;`,
        },
      ],
      keyPoints: [
        'Ack/commit after processing; accept redelivery and design for it.',
        'Transient errors retry with backoff off the main path; permanent errors go to DLQ.',
        'Slow processing beyond poll interval/visibility timeout causes duplicate work and rebalances.',
      ],
    },
    {
      heading: '3. Incident: duplicate messages — "the customer got charged twice"',
      body: `**Intuition:** the postman may deliver the same letter twice. You can't stop him; you can keep a list of letters already opened.

**Symptoms:** duplicate emails/SMS, double ledger entries, inventory decremented twice; usually clustered around deploys, consumer restarts, rebalances or broker failovers.

**First 5 minutes:**
- Correlate duplicates with rebalances/restarts (consumer group events, pod restarts) and with producer retries (network blips → producer resends).
- Check whether duplicates share the same message ID/offset (redelivery) or different offsets with the same business payload (producer duplicated, or upstream retried the API call).
- Quantify blast radius: \`GROUP BY business_key HAVING count(*) > 1\`.

**Root causes:**
- **Consumer side**: processed but crashed/rebalanced before committing; SQS visibility timeout expired while still processing; manual replay.
- **Producer side**: producer retried after a timeout even though the first send succeeded (enable Kafka idempotent producer — dedupes per partition per producer session; it doesn't dedupe across app-level retries).
- **Upstream**: client retried the HTTP request that triggered the event.
- "Exactly-once" in Kafka (transactions) covers Kafka-to-Kafka read-process-write; side effects on external systems (DB, payment API, email) are still at-least-once.

**Fix now:** stop the bleeding (pause the consumer if duplicates are costly), reconcile and refund/compensate from the duplicates query, add a unique constraint on the business key if possible.

**Fix permanently — idempotent consumer:**
- **Inbox / processed-messages table**: insert the message ID in the *same DB transaction* as the side effect; a unique-violation means "already done" → ack and skip.
- **Natural idempotency**: upserts, \`SET status = 'PAID' WHERE status = 'PENDING'\`, unique constraints on \`(order_id, event_type)\`.
- **External calls** carry an **idempotency key** (e.g. Stripe's \`Idempotency-Key\`) derived from the message ID so the provider dedupes.
- Outbox pattern on the producer side so events and state change commit atomically.

**What to say in the interview:** "I assume at-least-once everywhere and make the effect idempotent: a dedup record committed atomically with the side effect, plus idempotency keys for external APIs. Exactly-once delivery is a myth outside a closed Kafka-to-Kafka transaction."`,
      code: [
        {
          language: 'sql',
          title: 'Inbox table: dedup committed atomically with the side effect',
          code: `CREATE TABLE inbox (
  consumer     text        NOT NULL,              -- e.g. 'ledger-svc'
  message_id   text        NOT NULL,              -- producer-assigned event ID (not the offset)
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, message_id)
);

-- Per message, in ONE transaction:
BEGIN;
INSERT INTO inbox (consumer, message_id)
VALUES ('ledger-svc', 'evt_01J9Z6X4Q8')
ON CONFLICT DO NOTHING;                           -- 0 rows inserted => duplicate
-- app checks rowCount: if 0 -> COMMIT (no-op) and ack; else continue:
INSERT INTO ledger_entries (account_id, amount_cents, source_event)
VALUES ('acc_42', -1999, 'evt_01J9Z6X4Q8');
COMMIT;                                           -- effect + dedup record atomically

-- Blast-radius query during the incident
SELECT source_event, count(*) FROM ledger_entries
WHERE created_at > now() - interval '6 hours'
GROUP BY source_event HAVING count(*) > 1;

-- Housekeeping: keep dedup records longer than the max redelivery/replay window
DELETE FROM inbox WHERE processed_at < now() - interval '14 days';`,
        },
      ],
      keyPoints: [
        'Dedup key = stable event ID from the producer, not the offset.',
        'Dedup record and side effect must commit in the same transaction.',
        'Idempotency keys extend dedup to external APIs.',
      ],
    },
    {
      heading: '4. Incident: message ordering required — "refund processed before the payment"',
      body: `**Intuition:** Kafka guarantees order inside one lane (partition), not across lanes. If two events about the same order travel in different lanes — or one takes a detour through a retry queue — they can arrive swapped.

**Symptoms:** state machines rejecting transitions ("cannot refund: order not paid"), final state wrong (older update overwrote newer), flapping values in read models, issues spiking after partition count changes or consumer parallelism changes.

**First 5 minutes:**
- Check the **message key** used by producers — is it the entity ID (\`orderId\`)? Null keys → round-robin/sticky partitioning → no per-entity order.
- Were partitions recently added? Hash(key) mod N changes → a key's new events go to a different partition while old ones are still unconsumed.
- Does the consumer process a partition in parallel (worker pool inside the consumer, \`partitionsConsumedConcurrently\` is fine; parallel *within* a partition is not)?
- Are failed messages retried via a retry topic while later messages for the same key proceed?

**Root causes:** wrong/missing key; partition count change; in-consumer parallelism; retry topics and DLQs reordering; multiple producers for the same entity without coordination; producer retries with \`max.in.flight.requests.per.connection\` > 1 and non-idempotent producer (can reorder on retry — the idempotent producer preserves order with up to 5 in flight).

**Fix now:** route the affected entity's processing to a serial path; re-drive from the source of truth (rebuild the read model from the DB) rather than trying to reorder events.

**Fix permanently:**
- Key by entity ID; enable the idempotent producer.
- **Per-key serial, cross-key parallel** processing inside the consumer (keyed worker queues).
- **Version/sequence numbers** in events; consumers apply only \`seq = last_seq + 1\` (or \`>\` for last-writer-wins read models) and buffer/park out-of-order ones.
- Retries: when a message for key K is parked, park subsequent messages for K too (blocking retry per key), or design handlers to be commutative.
- Plan partition increases: create a new topic with more partitions and migrate, or accept a drain window.

**What to say in the interview:** "Ordering is only per partition, so I key by entity and never rely on global order. Because retries and repartitioning still break order, correctness comes from sequence numbers the consumer enforces — ordering from the broker is an optimisation, not a guarantee I bet money on."`,
      code: [
        {
          language: 'typescript',
          title: 'Consumer: per-key serial, cross-key parallel, with version guard',
          code: `import { Pool } from 'pg';
const db = new Pool({ max: 10 });

// Each key gets a promise chain: events for the same order run strictly in sequence,
// different orders run concurrently.
const chains = new Map<string, Promise<void>>();

export function dispatch(key: string, event: { orderId: string; seq: number; status: string }) {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(() => apply(event)).finally(() => {
    if (chains.get(key) === next) chains.delete(key);   // avoid unbounded map growth
  });
  chains.set(key, next);
  return next;
}

async function apply(e: { orderId: string; seq: number; status: string }) {
  // Only apply the next expected version; stale or duplicate events are no-ops.
  const res = await db.query(
    'UPDATE orders SET status = $1, seq = $2 WHERE id = $3 AND seq = $2 - 1',
    [e.status, e.seq, e.orderId],
  );
  if (res.rowCount === 0) {
    const { rows } = await db.query('SELECT seq FROM orders WHERE id = $1', [e.orderId]);
    const current = rows[0]?.seq ?? 0;
    if (e.seq <= current) return;                        // duplicate/old: ignore
    throw new Error('gap: have ' + current + ', got ' + e.seq); // out of order: retry later
  }
}
// NOTE: commit a partition's offset only up to the lowest offset whose chain has finished.`,
        },
      ],
      keyPoints: [
        'Key by entity ID; order exists only within a partition.',
        'Adding partitions remaps keys; retries/DLQs reorder.',
        'Enforce order with per-entity sequence numbers in the consumer.',
      ],
    },
    {
      heading: '5. Incident: we need a retry mechanism (and the naive one made it worse)',
      body: `**Intuition:** retrying is knocking on a door again. Knock again politely after a pause, a few times, and only if the door might open — don't hammer it, and don't knock on a door that said "go away".

**Symptoms prompting it:** transient errors (timeouts, 503, connection resets) surfacing to users; lost events when a downstream blips; or the opposite — a naive retry loop amplifying an outage, duplicate side effects from retried POSTs.

**First 5 minutes (when retries are suspected):**
- Retry rate vs original request rate per client (\`http_client_retries_total\`); retries per request histogram.
- Which status codes are retried? Retrying 400/401/404/409 is pure waste.
- Are retried operations idempotent?

**Designing retries properly:**
- **What to retry**: connection errors, timeouts, 502/503/504, 429 (honour \`Retry-After\`). Not 4xx validation/auth errors.
- **What is safe**: GET/PUT/DELETE by HTTP semantics; POST only with an **idempotency key** the server dedupes.
- **Backoff with full jitter**: \`sleep = random(0, min(cap, base × 2^attempt))\` — decorrelates clients so they don't retry in lockstep waves.
- **Bounded**: max 2–3 attempts for synchronous calls, within the caller's deadline; async retries can be longer (minutes → hours) via retry topics / delayed queues.
- **Retry budget**: retries limited to ~10% of requests per client; when exceeded, fail fast.
- **Retry at one layer**: the layer closest to the failure that has context, not every hop.
- **Async retries**: retry topics with increasing delays, then DLQ; SQS: visibility timeout + \`maxReceiveCount\` redrive.

**What to say in the interview:** "Retries are a load multiplier, so I retry only retryable errors on idempotent operations, with exponential backoff and full jitter, a small attempt cap within the deadline, and a retry budget. For async work I move retries off the hot path into delayed retry queues and a DLQ."`,
      code: [
        {
          language: 'typescript',
          title: 'retry.ts — full jitter, retryable-only, deadline-aware, Retry-After aware',
          code: `export class HttpError extends Error {
  constructor(public status: number, public retryAfterMs?: number) { super('HTTP ' + status); }
}

const RETRYABLE = new Set([429, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return RETRYABLE.has(err.status);
  const code = (err as { code?: string }).code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || (err as Error).name === 'TimeoutError';
}

export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  { attempts = 3, baseMs = 100, capMs = 2000, deadlineMs = 3000 } = {},
): Promise<T> {
  const deadline = Date.now() + deadlineMs;
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    try {
      return await fn(AbortSignal.timeout(Math.max(remaining, 1))); // per-try timeout <= deadline
    } catch (err) {
      if (attempt + 1 >= attempts || !isRetryable(err)) throw err;
      const backoff = Math.random() * Math.min(capMs, baseMs * 2 ** attempt); // full jitter
      const wait = err instanceof HttpError && err.retryAfterMs ? err.retryAfterMs : backoff;
      if (Date.now() + wait >= deadline) throw err;   // no point retrying past the deadline
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Retry only retryable errors on idempotent (or idempotency-keyed) operations.',
        'Exponential backoff + full jitter, capped attempts, inside the deadline.',
        'Async retries belong in delayed queues + DLQ, not in-process loops.',
      ],
      source: 'AWS Architecture Blog — Exponential Backoff and Jitter',
    },
    {
      heading: '6. Incident: retry storm — the downstream recovered but we are still down',
      body: `**Intuition:** after a power cut, if every appliance in the city switches back on at the same instant the grid trips again. The recovery load, not the original fault, keeps you down.

**Symptoms:** a dependency had a 30-second blip, but errors persist for 20+ minutes; the dependency's incoming RPS is 5–50× normal; most traffic is retries; CPU of the dependency pegged doing work for requests whose callers already timed out. This is a **metastable failure**: the system stays in the bad state even after the trigger is gone.

**First 5 minutes:**
- Incoming RPS at the struggling service vs edge RPS — a ratio far above ~1.1 means amplification.
- Retry counters per caller; which layers retry.
- Queue/backlog inside the service: is it processing requests that have already timed out upstream (wasted work)?

**Root causes:**
- **Retries at every layer**: 3 attempts × 4 layers = 81× load at the bottom.
- No jitter → synchronized retry waves.
- Client timeouts shorter than server processing → server keeps working on abandoned requests while the client retries (double work).
- Connection re-establishment storms (TLS handshakes are expensive) after a restart.
- Queued work with no deadline — the service drains an hour-old backlog while new requests time out.

**Fix now:**
- Cut the amplification: disable retries at inner layers (config/flag), open circuit breakers, rate-limit at the edge to below the service's capacity.
- Shed load at the struggling service: reject early (fast 503) instead of queueing; drop requests whose deadline has passed.
- Bring traffic back gradually (ramp the edge limit up).

**Fix permanently:** retry budgets (per-client token bucket, ~10%); retry at a single layer; full jitter; deadline propagation so servers drop expired work; server-side admission control/concurrency limits (e.g. adaptive concurrency like Netflix's concurrency-limits / Envoy adaptive concurrency); circuit breakers; LIFO or CoDel-style queue management under overload.

**What to say in the interview:** "When a dependency stays down after its trigger is gone, I suspect a metastable retry storm. I measure amplification as downstream RPS over edge RPS, then cut retries and shed load to let it recover, and ramp traffic back. Permanently: retry budgets, single-layer retries, jitter and deadline propagation."`,
      diagram: `  edge (1x) ── API gw ── svc A ── svc B ── DB-backed svc C
  attempts:      3    x    3    x    3    x    3      = 81x at C

  with a 10% retry budget per hop:  1.1^4 ≈ 1.46x worst case

  load at C
   ^        trigger (30s blip)
   |   ____/\\____________________________   <- retries keep C saturated
   | _/                                   \\_ (metastable until load is cut)
   +---------------------------------------------> time`,
      code: [
        {
          language: 'typescript',
          title: 'Retry budget: allow retries only while they are < 10% of recent requests',
          code: `// Token bucket per downstream: each successful first attempt deposits 0.1 token,
// each retry costs 1 token. In steady state retries <= ~10% of traffic; during an
// outage the bucket empties and retries stop, so we fail fast instead of amplifying.
export class RetryBudget {
  private tokens: number;
  constructor(private readonly ratio = 0.1, private readonly maxTokens = 100) {
    this.tokens = maxTokens;
  }
  onRequest(): void {
    this.tokens = Math.min(this.maxTokens, this.tokens + this.ratio);
  }
  tryAcquireRetry(): boolean {
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;                      // budget exhausted: do not retry
  }
}

const budgets = new Map<string, RetryBudget>();
export function budgetFor(downstream: string): RetryBudget {
  let b = budgets.get(downstream);
  if (!b) { b = new RetryBudget(); budgets.set(downstream, b); }
  return b;
}

// usage inside the retry loop:
//   budget.onRequest();                           // once per logical request
//   if (!isRetryable(err) || !budget.tryAcquireRetry()) throw err;`,
        },
      ],
      keyPoints: [
        'Amplification ratio = downstream RPS ÷ edge RPS; alert on it.',
        'Metastable failures need load cut, not just the trigger fixed.',
        'Retry budgets and deadline propagation stop storms structurally.',
      ],
      source: 'Google SRE Book — Ch 22 Addressing Cascading Failures',
    },
    {
      heading: '7. Incident: a downstream is unavailable',
      body: `**Intuition:** when the bank's card machine is down, a good shop doesn't close — it takes cash, writes an IOU, or at least tells customers quickly instead of making them wait in line forever.

**Symptoms:** a dependency (payment provider, email API, inventory service, a partner's API) returns connection refused / 503 / DNS failures; our error rate for dependent endpoints jumps; threads/connections pile up waiting on it; queues of outbound work grow.

**First 5 minutes:**
- Scope: which endpoints depend on it synchronously vs asynchronously? Is it total or partial (one region, one endpoint)?
- Their status page / our synthetic probes to them; DNS resolution; TLS cert expiry; our egress (NAT gateway, firewall, expired credentials or rotated API keys — "unavailable" is often *our* side).
- Are our callers timing out fast or hanging? (connection pool wait, in-flight count)

**Root causes:** provider outage; network path/egress failure; expired certificate or credential; quota exhaustion (they return 429/403 that looks like an outage); DNS change; their deploy.

**Fix now — degrade, don't die:**
- **Fail fast**: circuit breaker open (or short timeouts) so requests don't pile up.
- **Fallbacks by criticality**: cached/stale data (product catalogue, prices with a "may be outdated" banner), default values (recommendations → bestsellers), feature hidden, or **accept and defer** (store the intent, process when the dependency returns).
- Fail over to a secondary provider if one exists (second PSP, second SMS/email provider).
- Communicate: status page, error messages that say "try again later" rather than generic 500s.

**Fix permanently:**
- Move non-essential dependencies **off the synchronous path**: API writes the intent in its DB + **transactional outbox**; a relay publishes; workers call the dependency with retries — the user gets 202 Accepted.
- Multi-provider strategies for critical external dependencies.
- Dependency classification (hard vs soft) with a documented fallback per soft dependency, and **game days** that actually take each one down.
- Synthetic monitoring of third parties; alerting on credential/cert expiry.

**What to say in the interview:** "For each dependency I ask: must the user wait for it? If not, I accept the request, persist the intent via an outbox and process asynchronously. If yes, I fail fast with a breaker and a fallback — stale cache, a default, or a secondary provider — so one dependency's outage becomes a degraded feature, not an outage."`,
      code: [
        {
          language: 'sql',
          title: 'Transactional outbox: accept the order even if the email/PSP is down',
          code: `-- Same transaction: state change + intent to call the downstream
BEGIN;
INSERT INTO orders (id, user_id, total_cents, status)
VALUES ('ord_981', 'usr_7', 4599, 'PENDING_CONFIRMATION');

INSERT INTO outbox (id, aggregate_id, type, payload, available_at)
VALUES (gen_random_uuid(), 'ord_981', 'SendOrderConfirmation',
        '{"orderId":"ord_981","email":"a@b.com"}', now());
COMMIT;

-- Relay (or Debezium CDC) picks due rows; safe with many relay workers
SELECT id, type, payload
FROM outbox
WHERE published_at IS NULL AND available_at <= now()
ORDER BY available_at
LIMIT 100
FOR UPDATE SKIP LOCKED;

-- On success:           UPDATE outbox SET published_at = now() WHERE id = $1;
-- On downstream outage: back off without blocking other rows
UPDATE outbox
SET attempts = attempts + 1,
    available_at = now() + least(interval '1 hour', interval '5 seconds' * power(2, attempts))
WHERE id = $1;`,
        },
      ],
      keyPoints: [
        'Classify dependencies as hard or soft; every soft one has a fallback.',
        'Accept-and-defer via outbox turns outages into delays.',
        'Check your own egress, certs, credentials and quotas before blaming the provider.',
      ],
    },
    {
      heading: '8. Incident: a downstream is slow (worse than down)',
      body: `**Intuition:** a dead dependency fails fast; a slow one holds your hand while the queue behind you grows. Slow is the more dangerous failure mode.

**Symptoms:** our p99 tracks the dependency's p99; in-flight requests and connection-pool wait rising; event-loop lag normal but HTTP agent sockets maxed; memory rising (buffered pending requests); eventually our own timeouts and 5xx — for endpoints that don't even use that dependency (shared pools).

**First 5 minutes:**
- Distributed trace of a slow request: which span grows?
- Client-side metrics for that dependency: latency histogram, in-flight, pool/socket saturation, timeouts.
- **Little's law**: in-flight = RPS × latency. At 500 RPS × 40 ms = 20 in flight; at 500 RPS × 4 s = 2,000 in flight — way past a pool of 50 sockets, so everything queues.

**Root causes:** no timeout (Node's \`fetch\` / \`http\` have no default overall request timeout); timeout longer than the caller's own deadline; shared connection pool/agent between critical and non-critical dependencies; the dependency is overloaded (maybe by our retries); GC or noisy-neighbour issues on their side.

**Fix now:** lower timeouts to slightly above the dependency's healthy p99 (e.g. p99 150 ms → timeout 300 ms); open the breaker; switch to fallback; cap concurrency to the dependency (bulkhead) so the rest of the service survives.

**Fix permanently:**
- **Timeouts everywhere**, derived from a **deadline** propagated from the edge (\`x-request-deadline\` header / gRPC deadlines); each hop uses \`min(own budget, remaining deadline)\`.
- **Bulkheads**: separate connection pools / concurrency limits per dependency, so a slow recommendations API cannot eat the sockets checkout needs.
- **Hedged requests** for idempotent reads with long tails: send a second request after the p95 latency, take the first response (cap hedges at a few % of traffic).
- Async where possible; cache results; ask the owner for an SLO and hold them to it.

**What to say in the interview:** "Slow is worse than down because it consumes my concurrency. By Little's law a 100× latency increase means 100× in-flight requests, so I enforce deadline-derived timeouts and bulkhead each dependency's concurrency, then open a breaker and fall back."`,
      code: [
        {
          language: 'typescript',
          title: 'Deadline propagation + per-dependency bulkhead',
          code: `import type { Request } from 'express';

// A tiny semaphore: at most "limit" concurrent calls to one dependency (bulkhead)
export class Bulkhead {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly limit: number, private readonly maxQueue: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.waiters.length >= this.maxQueue) throw new Error('bulkhead full'); // shed, don't queue forever
      await new Promise<void>((r) => this.waiters.push(r));
    }
    this.active++;
    try { return await fn(); } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

const recsBulkhead = new Bulkhead(20, 50);   // recommendations may use at most 20 sockets

// Remaining time budget from the edge; never wait longer than the caller will
export function remainingMs(req: Request, ownBudgetMs: number): number {
  const deadline = Number(req.header('x-request-deadline')); // epoch ms set at the edge
  const left = Number.isFinite(deadline) ? deadline - Date.now() - 20 : ownBudgetMs; // 20ms margin
  return Math.max(0, Math.min(ownBudgetMs, left));
}

export async function getRecommendations(req: Request, userId: string) {
  const budget = remainingMs(req, 250);
  if (budget < 30) return [];                 // not worth calling: fall back immediately
  return recsBulkhead.run(async () => {
    const res = await fetch('http://recs.internal/v1/users/' + userId, {
      signal: AbortSignal.timeout(budget),
      headers: { 'x-request-deadline': String(Date.now() + budget) }, // propagate
    });
    if (!res.ok) throw new Error('recs ' + res.status);
    return res.json();
  }).catch(() => []);                         // soft dependency: degrade to empty list
}`,
        },
      ],
      keyPoints: [
        'Little\'s law turns latency into concurrency — slow dependencies exhaust pools.',
        'Timeouts come from a propagated deadline, shrinking hop by hop.',
        'Bulkheads isolate each dependency\'s concurrency; hedging trims read tails.',
      ],
    },
    {
      heading: '9. Incident: we need a circuit breaker',
      body: `**Intuition:** a household circuit breaker trips so a faulty appliance doesn't burn the house down; after a while you try the switch again. Software breakers do the same for dependencies.

**Symptoms that call for one:** calls to a failing dependency keep consuming timeouts' worth of latency and connections; recovery of the dependency is delayed by our continuing traffic; users wait 10 s for an error that could be instant.

**Mechanics — three states:**
- **Closed**: calls pass; failures (errors + timeouts) counted in a rolling window.
- **Open**: after the error rate exceeds a threshold (e.g. 50%) **with at least a minimum volume** (e.g. 20 requests in 10 s), calls fail immediately (or go to the fallback) for a cool-down (e.g. 10–30 s).
- **Half-open**: a limited number of trial calls; success → closed, failure → open again.

**Design choices seniors discuss:**
- **Scope**: per dependency *and* per endpoint/host — one bad endpoint shouldn't open the breaker for healthy ones; per-instance breakers vs shared state (per-instance is usually fine and simpler).
- **What counts as failure**: timeouts, 5xx, connection errors — **not** 4xx (a client's bad request shouldn't open the breaker for everybody).
- **Fallback**: stale cache, default, queue for later, or a clear error. A breaker with no fallback still helps (fail fast), but pair them.
- **Mesh vs library**: Envoy/Istio outlier detection ejects bad *hosts*; library breakers (opossum, resilience4j) understand *business operations* and fallbacks. Often both.
- **Observability**: emit state changes as metrics and alert; an open breaker is an incident signal.

**What to say in the interview:** "I put a breaker around each remote operation with an error-rate threshold over a minimum volume, a cool-down and half-open probes, count only timeouts and 5xx as failures, and pair it with a fallback. It stops us burning connections on a dead dependency and gives it room to recover."`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS + opossum: breaker with timeout, fallback and metrics',
          code: `import { Injectable, Logger } from '@nestjs/common';
import CircuitBreaker from 'opossum';

@Injectable()
export class PricingClient {
  private readonly log = new Logger(PricingClient.name);
  private readonly breaker: CircuitBreaker<[string], { price: number; stale: boolean }>;
  private readonly lastKnown = new Map<string, number>();   // tiny stale cache for fallback

  constructor() {
    this.breaker = new CircuitBreaker((sku: string) => this.fetchPrice(sku), {
      timeout: 300,                   // ms; counts as failure
      errorThresholdPercentage: 50,   // open when >= 50% fail...
      volumeThreshold: 20,            // ...but only after 20 calls in the window
      rollingCountTimeout: 10_000,    // 10 s rolling window
      resetTimeout: 15_000,           // stay open 15 s, then half-open trial
      errorFilter: (err: { status?: number }) => !!err.status && err.status < 500, // 4xx != failure
    });
    this.breaker.fallback((sku: string) => {
      const cached = this.lastKnown.get(sku);
      if (cached === undefined) throw new Error('pricing unavailable');
      return { price: cached, stale: true };                // degrade: stale price
    });
    this.breaker.on('open', () => this.log.warn('pricing breaker OPEN'));
    this.breaker.on('halfOpen', () => this.log.log('pricing breaker HALF-OPEN'));
    this.breaker.on('close', () => this.log.log('pricing breaker CLOSED'));
  }

  getPrice(sku: string) {
    return this.breaker.fire(sku);
  }

  private async fetchPrice(sku: string) {
    const res = await fetch('http://pricing.internal/v1/prices/' + sku);
    if (!res.ok) throw Object.assign(new Error('pricing ' + res.status), { status: res.status });
    const body = (await res.json()) as { price: number };
    this.lastKnown.set(sku, body.price);
    return { price: body.price, stale: false };
  }
}`,
        },
      ],
      keyPoints: [
        'Closed → open (threshold + minimum volume) → half-open probes.',
        'Count timeouts/5xx, not 4xx; scope per dependency and operation.',
        'Pair with a fallback and alert on state changes.',
      ],
      source: 'Michael Nygard — Release It! (Circuit Breaker pattern)',
    },
    {
      heading: '10. Incident: cascading failure — one slow microservice takes down the platform',
      body: `**Intuition:** dominoes. Service D slows, C's threads wait on D, B's wait on C, the gateway's wait on B — and now the login page, which only needs B, is down too.

**Symptoms:** errors and latency spreading outward over minutes from one service to its callers and then to unrelated features; health checks failing on healthy-but-saturated services; pods restarting from liveness failures under load (making it worse); the dependency graph "lights up red" from the leaves inward.

**First 5 minutes:**
- **Find the origin**: service map / traces — which service's latency rose *first*? The earliest-degrading node in time, deepest in the call graph, is usually the root; the loud red ones near the edge are victims.
- Saturation per service: in-flight requests, pool waits, event-loop lag, CPU.
- Restarts: are liveness probes killing overloaded pods (reducing capacity further)?
- Recent changes on the origin service (deploy, config, traffic from a new caller).

**Root causes:** missing/too-long timeouts; shared pools/threads across dependencies (no bulkheads); retries at every layer; liveness probes that fail under load; autoscaling that adds callers but not callees; synchronous call chains for non-critical data (e.g. homepage waits for recommendations).

**Fix now:**
1. **Isolate the origin**: open breakers / flag off features that call it; shed its load at the gateway.
2. **Protect the healthy**: lower timeouts to it, disable retries to it.
3. Stop self-harm: relax liveness probes if they are restarting busy pods.
4. Restore the origin (rollback, scale, fix its downstream), then ramp traffic back gradually.

**Fix permanently:**
- Timeouts + deadlines, bulkheads, breakers, retry budgets (the stability-pattern set).
- **Load shedding** at every service: reject early when concurrency/latency exceeds capacity (priority-aware: shed prefetch/analytics first, checkout last).
- **Graceful degradation** designed per page (homepage without recommendations still renders).
- Async/event-driven edges for non-critical data; caches in front of slow reads.
- Capacity tests for the *downstream* when callers autoscale; chaos experiments injecting latency (not just failures).

**What to say in the interview:** "Cascades propagate through waiting. I find the origin as the first service to degrade, isolate it with breakers and feature flags, and stop self-inflicted damage like retries and liveness restarts. Structurally: deadlines, bulkheads, retry budgets and load shedding so each service fails alone."`,
      code: [
        {
          language: 'typescript',
          title: 'Load-shedding middleware: concurrency limit + event-loop lag + priority',
          code: `import type { Request, Response, NextFunction } from 'express';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
let lagP99Ms = 0;
setInterval(() => { lagP99Ms = lag.percentile(99) / 1e6; lag.reset(); }, 1000).unref();

const MAX_IN_FLIGHT = 200;          // from load tests: beyond this, latency explodes
let inFlight = 0;

// Low-priority traffic is shed first; critical paths only at hard saturation
function priority(req: Request): 'critical' | 'normal' | 'low' {
  if (req.path.startsWith('/checkout') || req.path.startsWith('/auth')) return 'critical';
  if (req.header('x-prefetch') === '1' || req.path.startsWith('/recommendations')) return 'low';
  return 'normal';
}

export function loadShedder(req: Request, res: Response, next: NextFunction) {
  const p = priority(req);
  const pressure = Math.max(inFlight / MAX_IN_FLIGHT, lagP99Ms / 200); // 1.0 = saturated
  const limit = p === 'critical' ? 1.0 : p === 'normal' ? 0.85 : 0.6;
  if (pressure >= limit) {
    res.setHeader('Retry-After', '2');
    res.status(503).json({ error: 'overloaded', priority: p }); // cheap, fast rejection
    return;
  }
  inFlight++;
  res.on('close', () => { inFlight--; });
  next();
}`,
        },
      ],
      keyPoints: [
        'The root is the first and deepest service to degrade, not the loudest.',
        'Isolate the origin, stop retries and probe restarts, then ramp back.',
        'Load shedding + graceful degradation make each service fail alone.',
      ],
      source: 'Google SRE Book — Ch 22 Addressing Cascading Failures',
    },
    {
      heading: '11. Incident: one customer consumes all resources — rate limiting & noisy neighbours',
      body: `**Intuition:** in a shared apartment, one tenant running a bakery in the kitchen means nobody else can cook. You need house rules (quotas), separate kitchens for the bakery (bulkheads/cells), and a way to find out which tenant is the bakery.

**Symptoms:** latency/errors for all tenants correlated with one tenant's bulk import, integration misconfigured in a tight loop, scraping, or a big customer's month-end batch; one tenant dominates DB CPU, queue depth or worker time; the worker queue is FIFO and one tenant enqueued 2M jobs.

**First 5 minutes:**
- **Top-N by tenant/API key**: RPS, error rate, DB time, queue share, bytes. (Requires tenant ID in logs, metrics labels — carefully, cardinality — and traces.)
- Is it legitimate (contracted bulk usage) or a bug/abuse (retry loop, leaked key)?
- Which shared resource is saturated: API pods, DB, a specific worker queue, cache?

**Root causes:** no per-tenant limits (only global); limits on requests but not on cost (one request exports 1M rows); FIFO shared queues; shared DB without per-tenant statement timeouts; all tenants in one cell.

**Fix now:** apply an emergency per-tenant rate limit/concurrency cap at the gateway; pause or deprioritise that tenant's queue; contact the customer; for abuse, revoke the key.

**Fix permanently:**
- **Per-tenant rate limits** (token bucket, returning 429 + \`Retry-After\` and \`RateLimit-*\` headers) *and* **concurrency limits** and **cost-based quotas** (weight expensive endpoints).
- **Fair queuing**: per-tenant queues with round-robin/weighted draining, or BullMQ groups; bulk work in a separate low-priority queue.
- **Bulkheads by tier**: enterprise/bulk workloads on dedicated worker pools or DB replicas.
- **Shuffle sharding / cells**: each tenant is assigned a small random subset of workers (e.g. 2 of 8 → 28 combinations) so a bad tenant only affects tenants that share *both* workers.
- DB guardrails: \`statement_timeout\` per role, per-tenant connection caps.
- Usage visibility and contractual quotas for customers.

**What to say in the interview:** "Global limits don't protect tenants from each other. I enforce per-tenant rate, concurrency and cost quotas at the gateway, drain work queues fairly per tenant, and isolate big tenants with bulkheads or shuffle sharding so one customer's blast radius is bounded."`,
      code: [
        {
          language: 'lua',
          title: 'Redis Lua: atomic per-tenant token bucket with cost weights',
          code: `-- KEYS[1] = 'rl:{tenant_42}'   (hash tag keeps it on one cluster slot)
-- ARGV[1] = capacity (burst), ARGV[2] = refill tokens/sec,
-- ARGV[3] = now in ms, ARGV[4] = cost of this request (e.g. export = 50, GET = 1)
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local state  = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity
local ts     = tonumber(state[2]) or now

-- refill proportionally to elapsed time, capped at capacity
tokens = math.min(capacity, tokens + (now - ts) / 1000 * rate)

local allowed = 0
local retry_after_ms = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_after_ms = math.ceil((cost - tokens) / rate * 1000)
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, math.ceil(capacity / rate * 1000) * 2)  -- idle keys expire
return { allowed, math.floor(tokens), retry_after_ms }`,
        },
      ],
      keyPoints: [
        'Per-tenant rate + concurrency + cost quotas, not just a global limit.',
        'Fair queuing per tenant; bulk work isolated in low-priority queues.',
        'Shuffle sharding and cells bound one tenant\'s blast radius.',
      ],
      source: 'AWS Builders Library — Workload isolation using shuffle-sharding',
    },
  ],
  codeChallenges: [
    {
      id: 'prod-async-failure-cc-1',
      title: 'Fix the payment-capture consumer that double-charges and stalls',
      context:
        'The payments team runs this KafkaJS consumer on the `order-confirmed` topic (24 partitions). Incidents this month: customers charged twice after a consumer deploy; a single malformed event stopped all captures on partition 11 for 3 hours; during a PSP slowdown the group went into a rebalance loop and lag hit 4M.',
      task: 'Rewrite the consumer so that captures are never duplicated, a bad message cannot block a partition, slow PSP calls cannot trigger rebalance loops, and failures are observable. Keep at-least-once semantics.',
      starter: {
        language: 'typescript',
        title: 'capture.consumer.ts (starter)',
        code: `import { Kafka } from 'kafkajs';
import { psp } from './psp';
import { db } from './db';

const kafka = new Kafka({ clientId: 'capture', brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'payment-capture' });

export async function start() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'order-confirmed' });
  await consumer.run({
    autoCommit: true,
    eachMessage: async ({ message }) => {
      const evt = JSON.parse(message.value!.toString());
      while (true) {                                      // retry until it works
        try {
          const charge = await psp.capture(evt.paymentIntentId, evt.amount); // no timeout
          await db.query('INSERT INTO captures (order_id, charge_id) VALUES ($1, $2)',
            [evt.orderId, charge.id]);
          break;
        } catch (e) {
          console.error('capture failed, retrying', e);
        }
      }
    },
  });
}`,
      },
      hints: [
        'What happens if the process dies after psp.capture succeeds but before the offset is committed? What does the PSP need to recognise a repeat?',
        'What does `while (true)` do to every message behind a malformed event on the same partition — and to max.poll/session timeouts?',
        'Where should a failed capture go if it is transient vs permanent, and how does the consumer check "already captured" cheaply?',
      ],
      solution: {
        language: 'typescript',
        title: 'capture.consumer.ts (solution)',
        code: `import { Kafka, KafkaMessage } from 'kafkajs';
import { psp, PspError } from './psp';
import { db } from './db';
import { metrics } from './metrics';

const kafka = new Kafka({ clientId: 'capture', brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'payment-capture', sessionTimeout: 30_000 });
const producer = kafka.producer({ idempotent: true });

type Evt = { eventId: string; orderId: string; paymentIntentId: string; amount: number };

function parse(m: KafkaMessage): Evt | null {
  try {
    const e = JSON.parse(m.value!.toString());
    return e.eventId && e.orderId && Number.isInteger(e.amount) ? e : null;
  } catch { return null; }
}

async function capture(evt: Evt) {
  const done = await db.query('SELECT 1 FROM captures WHERE order_id = $1', [evt.orderId]);
  if (done.rowCount) return;                               // already captured: idempotent skip
  const charge = await psp.capture(evt.paymentIntentId, evt.amount, {
    idempotencyKey: 'capture:' + evt.orderId,             // PSP dedupes repeats
    signal: AbortSignal.timeout(5_000),                   // bounded, far below session timeout
  });
  await db.query(
    'INSERT INTO captures (order_id, charge_id) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING',
    [evt.orderId, charge.id],
  );
}

export async function start() {
  await Promise.all([consumer.connect(), producer.connect()]);
  await consumer.subscribe({ topics: ['order-confirmed'] });
  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      const evt = parse(message);
      let target: string | null = evt ? null : 'order-confirmed.dlq';   // poison -> DLQ
      if (evt) {
        try {
          await capture(evt);
          metrics.captured.inc();
        } catch (err) {
          const permanent = err instanceof PspError && err.status >= 400 && err.status < 500 && err.status !== 429;
          target = permanent ? 'order-confirmed.dlq' : 'order-confirmed.retry.5m';
        }
      }
      if (target) {
        await producer.send({ topic: target, messages: [{ key: message.key, value: message.value,
          headers: { 'x-origin': topic + ':' + partition + ':' + message.offset } }] });
        metrics.parked.inc({ target });
      }
      await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
    },
  });
}`,
      },
      explanation: `**Fixes:**
- **Double charges**: the PSP call carries an **idempotency key** derived from the order, a pre-check skips already-captured orders, and \`captures.order_id\` is unique with \`ON CONFLICT DO NOTHING\`. Redelivery after a crash/rebalance is now harmless.
- **autoCommit** could commit offsets independently of the business outcome; offsets are now committed explicitly after the message is processed *or* safely parked.
- **Blocked partition**: \`while (true)\` retried a malformed event forever. Parsing is validated; poison messages go to a DLQ; transient failures go to a delayed retry topic, so the partition keeps moving.
- **Rebalance loop**: unbounded PSP calls inside an infinite retry loop exceeded the session/poll timeouts, so the broker evicted the consumer and reassigned the partition — reprocessing the same messages elsewhere. PSP calls now have a 5 s timeout and there is no in-process retry loop.
- **Classification**: 4xx (except 429) = permanent → DLQ for humans; timeouts/5xx/429 = transient → retry topic.
- **Observability**: counters for captured and parked messages (alert on DLQ inflow); \`x-origin\` headers support replay tooling.
- Ordering note: a message sent to the retry topic lets later events for the same order proceed — acceptable here because capture is the only event type per order; otherwise park per key.`,
      followUps: [
        {
          "q": "The retry topic `order-confirmed.retry.5m` — how does its consumer actually wait 5 minutes without blocking a partition or busy-looping?",
          "a": "Each retry message carries a `not-before` timestamp header (original failure time + 5 min). The retry consumer reads a message and, if `now < not-before`, calls `consumer.pause([{topic, partitions:[p]}])` and schedules `resume` at that time, without committing, so the message is re-read later. Since messages in a retry topic are roughly time-ordered, pausing the partition blocks only messages that aren't due yet either. Use tiers (`retry.1m`, `retry.5m`, `retry.30m`) and route to the DLQ after the last tier, tracking the attempt count in a header."
        },
        {
          "q": "How would you test that a crash between `psp.capture` and the `INSERT` doesn't double-charge?",
          "a": "Write an integration test with a fake PSP that records idempotency keys and returns the same charge for a repeated key. Inject a fault after `psp.capture` resolves (e.g. stub `db.query` to throw once, or kill the consumer process in a Testcontainers Kafka setup), then let the message be redelivered. Assert the PSP saw two calls with the same `capture:<orderId>` key but created only one charge, and that `captures` has exactly one row. Add a chaos run in staging that kills consumer pods during a load test, then reconcile captures against PSP charges."
        }
      ],
    },
    {
      id: 'prod-async-failure-cc-2',
      title: 'Turn this HTTP client into one that cannot start a retry storm',
      context:
        'Every service uses this shared `callService` helper. During last week\'s inventory incident a 40-second blip became a 35-minute outage: inventory saw 30× its normal RPS, mostly retries, and orders were created twice by retried POSTs.',
      task: 'Rewrite the helper so that retries are safe, bounded and decorrelated, calls cannot hang, repeated failures fail fast, and total retry load stays small even during an outage.',
      starter: {
        language: 'typescript',
        title: 'call-service.ts (starter)',
        code: `export async function callService(url: string, init: RequestInit = {}, retries = 5): Promise<any> {
  try {
    const res = await fetch(url, init);            // no timeout at all
    if (!res.ok) throw new Error('status ' + res.status);
    return await res.json();
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 100)); // fixed 100 ms, everyone in lockstep
      return callService(url, init, retries - 1);   // retries 400s, POSTs, everything
    }
    throw err;
  }
}`,
      },
      hints: [
        'Which status codes and HTTP methods are actually safe and useful to retry? How can a POST become safe?',
        'If 5,000 clients all retry after exactly 100 ms, what does the downstream see? What is "full jitter"?',
        'Per-call limits are not enough during an outage — how do you cap retries as a fraction of traffic, and when should you stop calling at all?',
      ],
      solution: {
        language: 'typescript',
        title: 'call-service.ts (solution)',
        code: `import CircuitBreaker from 'opossum';
import { randomUUID } from 'node:crypto';
import { RetryBudget } from './retry-budget';          // token bucket: ~10% retries

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);
const budgets = new Map<string, RetryBudget>();
const breakers = new Map<string, CircuitBreaker>();

class HttpError extends Error { constructor(public status: number, public retryAfterMs?: number) { super('HTTP ' + status); } }

async function once(url: string, init: RequestInit, timeoutMs: number) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const ra = Number(res.headers.get('retry-after'));
    throw new HttpError(res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
  return res.json();
}

export async function callService<T>(url: string, init: RequestInit = {}, opts = { attempts: 3, timeoutMs: 800, deadlineMs: 2500 }): Promise<T> {
  const host = new URL(url).host;
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!IDEMPOTENT.has(method) && !headers.has('Idempotency-Key')) headers.set('Idempotency-Key', randomUUID()); // same key on every retry
  const req = { ...init, method, headers };

  if (!budgets.has(host)) budgets.set(host, new RetryBudget(0.1));
  if (!breakers.has(host)) breakers.set(host, new CircuitBreaker(once, {
    timeout: false, errorThresholdPercentage: 50, volumeThreshold: 20, resetTimeout: 10_000,
    errorFilter: (e: HttpError) => e.status !== undefined && e.status < 500 && e.status !== 429,
  }));
  const budget = budgets.get(host)!, breaker = breakers.get(host)!;
  budget.onRequest();

  const deadline = Date.now() + opts.deadlineMs;
  for (let attempt = 0; ; attempt++) {
    try {
      const left = deadline - Date.now();
      return (await breaker.fire(url, req, Math.min(opts.timeoutMs, left))) as T; // open => fails fast
    } catch (err) {
      const status = err instanceof HttpError ? err.status : undefined;
      const retryable = status === undefined ? !breaker.opened : RETRYABLE_STATUS.has(status);
      if (!retryable || attempt + 1 >= opts.attempts || !budget.tryAcquireRetry()) throw err;
      const jitter = Math.random() * Math.min(2000, 100 * 2 ** attempt);            // full jitter
      const wait = err instanceof HttpError && err.retryAfterMs ? err.retryAfterMs : jitter;
      if (Date.now() + wait >= deadline) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}`,
      },
      explanation: `**Fixes:**
- **Timeouts**: every attempt has an \`AbortSignal.timeout\`, capped by an overall deadline — no call can hang or outlive its caller.
- **Only retry what's retryable**: 429/502/503/504 and network errors/timeouts; 4xx like 400/404/409 fail immediately.
- **Safe POSTs**: non-idempotent methods get one \`Idempotency-Key\` reused across retries, so the server dedupes instead of creating two orders (the server must honour it).
- **Decorrelated backoff**: exponential backoff with full jitter instead of a fixed 100 ms lockstep; \`Retry-After\` is honoured.
- **Bounded**: 3 attempts (not 6) within a 2.5 s deadline.
- **Retry budget per host** keeps retries ≲ 10% of traffic; during an outage the budget empties and callers stop amplifying.
- **Circuit breaker per host**: after ≥ 50% failures over ≥ 20 calls it opens and fails fast for 10 s, giving the downstream room to recover; 4xx do not count as failures, and there are no retries while it is open.
- The recursive implementation (a new promise chain per retry, with \`any\` types) is replaced by a typed loop.`,
      followUps: [
        {
          "q": "Implement `RetryBudget` with ~10% retries. What exactly does `onRequest` and `tryAcquireRetry` do?",
          "a": "Use a token bucket per host. `onRequest()` adds 0.1 tokens (the ratio), capped at some maximum (e.g. 10, to allow small bursts). `tryAcquireRetry()` succeeds only if at least 1 token is available, and then subtracts 1. In steady state, retries can't exceed about 10% of requests. During an outage, every request fails and wants a retry, but the bucket empties quickly, so retry load stays around 10% extra instead of 3×. Optionally add a minimum floor (e.g. 10 retries/s) so low-traffic callers can still retry occasionally. It's cheap: two numbers, with no timers needed."
        },
        {
          "q": "This helper runs in 50 pods. Each pod's breaker and budget are local. Is that a problem, and would you make them distributed?",
          "a": "Local is usually right. Each pod sees enough traffic to judge the downstream, and local state has no network dependency or latency, which matters because the breaker exists precisely for when things are failing. The downsides: low-traffic pods trip slowly, and 50 pods probe in half-open independently, which is fine with jitter. A distributed breaker in Redis adds a dependency into the failure path. If you need fleet-wide coordination, let a service mesh (Envoy outlier detection, retry budgets) do it at the proxy layer instead."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'prod-async-failure-iq-01',
      difficulty: 'hard',
      question:
        'It\'s 11:40. Consumer lag on the order-events topic is 3 million and growing by 4k/s. Order confirmation emails are already 25 minutes late and the SLO is 30 minutes. You are incident commander. Go.',
      context: 'Kafka, 24 partitions, 12 consumer pods, the consumer writes to Postgres and calls an email API.',
      whatInterviewerLooksFor: [
        'Quantifies drain time and time to SLO breach immediately',
        'Checks per-partition lag distribution and consumer group health',
        'Identifies the true bottleneck (consumer vs downstream) before scaling',
        'Uses prioritisation/shedding and communicates impact',
        'Permanent fixes: autoscale on lag/age, batching, partition sizing',
      ],
      modelAnswer: `### Frame the clock
Lag grows 4k/s, so consumers are ~4k/s short of producers. Oldest message is 25 min old, SLO 30 min — **~5 minutes** before breach. Even once we fix throughput, draining 3M at a net +10k/s would take 5 min. So mitigation must be immediate, and I'll tell stakeholders emails will be late.

### First 5 minutes
1. \`kafka-consumer-groups --describe\`: per-partition lag and owners.
   - **Even lag** across all 24 → capacity. **Skewed** → hot key or a stuck partition (poison message, stuck consumer).
   - Unassigned partitions or constant rebalancing → consumer health issue (crashes, \`max.poll.interval.ms\` exceeded).
2. Produce rate vs consume rate: did producers spike (a backfill, a campaign) or did consumers slow (deploy at 11:10? email API latency?).
3. Per-message processing time broken down: DB write vs email API call.

### Mitigate based on what I find
- **Consumer capacity-bound**: scale from 12 to 24 pods (partition cap) — roughly doubles throughput.
- **Email API slow/limiting**: adding consumers won't help (and may get us rate-limited harder). Instead decouple: consumer writes an "email pending" row and acks; a separate worker pool sends emails at the provider's rate. Or fail over to a secondary email provider.
- **DB-bound**: switch to batch processing (\`eachBatch\`, multi-row inserts).
- **Stuck partition**: park the poison message to the DLQ, move on.
- **Producer spike from a backfill**: pause the backfill.

### Afterwards
- Autoscale consumers on **lag and message age** (KEDA), with partition count sized for 2–3× current peak (repartitioning later breaks key ordering).
- Separate topics/queues for critical vs bulk events; decouple slow external calls from the consumer.
- Alert on age-of-oldest-message at 50% of SLO, not on raw lag.`,
      followUps: [
        {
          q: 'Scaling to 24 pods didn\'t help at all. Why might that be?',
          a: 'The bottleneck is downstream (email API rate limit, DB CPU or locks) or one hot partition that a single consumer must process serially. Adding consumers only increases pressure on the shared downstream. Check per-message latency breakdown and per-partition lag.',
        },
        {
          q: 'Can you just add partitions to 96 right now?',
          a: 'You can add partitions online, but hash(key) mod N changes so new events for a key land on a different partition while old ones are unconsumed — per-key ordering breaks during the transition — and existing lag stays on the old partitions. It helps future throughput, not the current backlog.',
        },
        {
          q: 'Business says old confirmations are worthless after 2 hours. How does that change your design?',
          a: 'Add a TTL/deadline check: consumers skip (and record) messages older than 2 hours, or process newest first via a separate fresh-lane topic. Draining stale work first is how backlogs keep hurting fresh users.',
        },
      ],
      pitfalls: [
        'Scaling consumers beyond the partition count.',
        'Scaling consumers when the email API or DB is the bottleneck.',
        'Watching lag depth instead of rates and message age.',
      ],
    },
    {
      id: 'prod-async-failure-iq-02',
      difficulty: 'expert',
      question:
        'Finance reports 312 customers double-charged yesterday between 14:02 and 14:09, exactly when we deployed the billing consumer. Explain how this happened and how you make it impossible.',
      whatInterviewerLooksFor: [
        'Explains at-least-once redelivery on rebalance/restart precisely',
        'Distinguishes producer duplicates vs consumer redelivery',
        'Idempotent consumer with atomic dedup + PSP idempotency keys',
        'Incident handling: blast radius query, refunds, communication',
      ],
      modelAnswer: `### What happened
The billing consumer processes an event, calls the PSP to charge, then commits the offset (auto-commit every few seconds or after the batch). During the rolling deploy, old pods received SIGTERM and were killed (or left the group) **after charging but before committing**. The group rebalanced, the new owners resumed from the last committed offset and charged the same events again. 7 minutes × partitions × in-flight window ≈ a few hundred duplicates — consistent with 312.

Contributing factors I'd check: no graceful shutdown (\`consumer.disconnect()\` with commit on SIGTERM), processing time close to the session timeout, and auto-commit decoupled from success.

### Immediate response
- Pause auto-refund risk: query duplicates (\`GROUP BY order_id HAVING count(*) > 1\` on charges), refund via the PSP, notify support and affected customers.
- Freeze billing-consumer deploys until fixed.

### Make it impossible
1. **Idempotency key to the PSP** = \`charge:{orderId}\` (or the event ID). The PSP returns the original charge on repeats — even if our DB write is lost.
2. **Idempotent consumer**: \`charges.order_id\` unique; insert-before-call pattern — insert a \`PENDING\` charge row keyed by order in a transaction, call the PSP with the key, update to \`SUCCEEDED\`. On redelivery the row exists → reconcile with the PSP instead of charging again.
3. **Commit after processing**, and graceful shutdown: stop fetching, finish in-flight, commit, leave the group.
4. **Reconciliation job**: daily compare our charges vs PSP settlement report; alert on mismatches.

### Why not "exactly-once Kafka"?
Kafka transactions make *Kafka-to-Kafka* read-process-write atomic. A PSP charge is an external side effect outside the transaction, so it's still at-least-once — idempotency is the only real fix.`,
      followUps: [
        {
          q: 'The PSP doesn\'t support idempotency keys. Now what?',
          a: 'Use their merchant reference/order ID as a unique field and query-before-charge (search charges by reference), and serialise per order (per-key partitioning plus a DB row lock or PENDING row). Add reconciliation. Remaining risk is the window between charge and record — surface it to finance as a known reconciliation item.',
        },
        {
          q: 'Could the producer have caused duplicates instead?',
          a: 'Yes: a producer retrying after a timeout can write the event twice (different offsets, same payload). The idempotent producer prevents this for broker-level retries within a session, not for application-level resends. The consumer dedup by business key covers both cases.',
        },
      ],
      pitfalls: [
        'Claiming Kafka exactly-once solves duplicates with an external PSP.',
        'Dedup by offset instead of a business/event ID.',
        'Putting the dedup check and the side effect in separate transactions without a PSP-level key.',
      ],
    },
    {
      id: 'prod-async-failure-iq-03',
      difficulty: 'expert',
      question:
        'Account balance events must be applied in order per account, we process 50k events/s, and some events fail transiently and need retries. Design the consumer so it\'s correct, parallel and doesn\'t stall.',
      whatInterviewerLooksFor: [
        'Partition by account; per-key serial, cross-key parallel',
        'Recognises retries/DLQ break ordering and designs blocking-per-key parking',
        'Sequence numbers / version checks for correctness',
        'Offset commit semantics with concurrent processing',
      ],
      modelAnswer: `### Partitioning
- Key = \`accountId\`. Kafka guarantees order per partition, so all events for an account are ordered. Pick partitions for peak parallelism: at 50k events/s and ~2 ms per event per worker, I need ~100 concurrent lanes — e.g. 128 partitions.

### Parallelism inside a consumer
- One partition per consumer is often too coarse, so inside each consumer I run **keyed lanes**: events are dispatched to a worker by \`hash(accountId) mod W\`; each lane is serial, lanes are parallel. Offsets are committed per partition only up to the **lowest offset not yet completed** (a watermark), so a crash can only cause redelivery, never loss.

### Correctness independent of delivery order
- Each event carries a per-account \`seq\`. The consumer applies with \`UPDATE ... WHERE account_id = $1 AND seq = $2 - 1\`; duplicates (\`seq <= current\`) are no-ops; gaps mean an earlier event hasn't arrived — retry later.

### Retries without reordering
- A transient failure for account A must **block only account A**: park the failing event *and all subsequent events for A* in a per-key retry store (a "retry-by-key" table or a retry topic keyed by account with a marker that A is blocked). Other accounts continue.
- The lane retries A with exponential backoff; after N attempts or a permanent error → DLQ **plus mark A as frozen** and alert — a later event must not apply after a skipped one for money.
- Non-blocking retries (send to a retry topic and move on) are fine only for commutative operations.

### Operational guardrails
- Alert on blocked-account count and age.
- Replay tooling that respects \`seq\`.
- Keep per-event work bounded (timeouts) so lanes don't stall behind a slow call.`,
      followUps: [
        {
          q: 'How do you commit offsets when lanes finish out of order?',
          a: 'Track completed offsets per partition and commit the contiguous low watermark (like the confluent parallel-consumer library does). Everything above the watermark may be redelivered after a crash — which the seq check makes harmless.',
        },
        {
          q: 'What if one account (a market maker) produces 30% of all events?',
          a: 'Its lane is serial by definition, so it caps its throughput at one worker. Options: make per-event work cheaper for it, batch its events (apply 100 deltas in one transaction preserving order), or split the account into sub-ledgers that are aggregated for balance reads.',
        },
      ],
      pitfalls: [
        'Assuming global ordering or ordering across partitions.',
        'Using a non-blocking retry topic for order-dependent events.',
        'Committing offsets of completed later messages past an unfinished earlier one.',
      ],
    },
    {
      id: 'prod-async-failure-iq-04',
      difficulty: 'hard',
      question:
        'The inventory service had a 30-second database failover at 09:00. The database has been healthy since 09:01, yet inventory is still returning 70% errors at 09:25 and its RPS is 12× normal. What\'s going on and what do you do?',
      whatInterviewerLooksFor: [
        'Recognises a metastable retry storm',
        'Quantifies amplification from multi-layer retries',
        'Mitigation that cuts load (edge limits, breakers, disabling inner retries)',
        'Structural fixes: retry budgets, jitter, deadlines, load shedding',
      ],
      modelAnswer: `### Diagnosis
The trigger (DB failover) is gone but the system stays broken: a **metastable failure** sustained by retries. 12× RPS is the signature: callers retry at several layers (gateway 3× → cart 3× → inventory client), synchronised without jitter. Inventory is now saturated, so requests time out, which generates more retries. Worse, inventory keeps working on requests whose callers already gave up — wasted capacity. Also likely: cold caches after the failover and a connection storm to the DB.

### Verify in minutes
- Inventory incoming RPS ÷ edge RPS for inventory-dependent routes (amplification ratio).
- Retry counters by caller; share of requests with \`attempt > 1\`.
- Inventory in-flight/queue time vs its callers' timeouts.

### Mitigate (cut the load, then ramp)
1. **Rate-limit at the edge** for inventory-dependent routes to ~80% of inventory's healthy capacity; excess gets fast 503/429 with \`Retry-After\`.
2. **Disable retries at inner layers** (config/flag) and **open the breaker** in cart for non-critical inventory calls (show "in stock" from cache).
3. Inventory: enable **load shedding** — reject when in-flight exceeds its limit; drop requests whose deadline has passed.
4. Once error rate drops, raise the edge limit gradually.

### Prevent
- Retry at one layer only; **retry budgets** (≤ 10% extra); exponential backoff with **full jitter**.
- **Deadline propagation** so servers skip expired work.
- Adaptive concurrency limits on inventory.
- Chaos test: inject a 30 s DB failover and verify recovery within 1–2 minutes.`,
      followUps: [
        {
          q: 'Why doesn\'t autoscaling inventory fix it?',
          a: 'The retry load grows with the failure rate, so more capacity is consumed by more retries, and the bottleneck may be the DB behind inventory — more pods means more DB connections. Autoscaling also reacts in minutes. Cutting amplification is faster and cheaper.',
        },
        {
          q: 'Wouldn\'t circuit breakers alone have prevented this?',
          a: 'They help a lot — an open breaker stops traffic and lets inventory recover — but breakers per instance on many callers can flap in sync on half-open, and they don\'t cap the steady-state retry ratio. Budgets + jitter + breakers together.',
        },
      ],
      pitfalls: [
        'Restarting inventory pods (brings the storm back with cold caches).',
        'Assuming the DB is still at fault because errors persist.',
        'Adding more retries or longer timeouts.',
      ],
    },
    {
      id: 'prod-async-failure-iq-05',
      difficulty: 'hard',
      question:
        'The recommendations service\'s p99 went from 80 ms to 6 s. Ten minutes later the whole homepage, login and even checkout are timing out. Walk me through how this cascaded and how you stop it now and forever.',
      whatInterviewerLooksFor: [
        'Explains cascade via Little\'s law and shared resources',
        'Finds the origin via traces/service map timing',
        'Immediate isolation: flags, breakers, timeouts, shedding',
        'Permanent: bulkheads, deadlines, graceful degradation, async',
      ],
      modelAnswer: `### How it cascaded
- The homepage BFF calls recommendations synchronously with a 10 s timeout (or none). At 2,000 RPS, in-flight calls to recs went from 2,000 × 0.08 = 160 to 2,000 × 6 = **12,000** (Little's law).
- The BFF uses one shared HTTP agent/pool for all downstreams. Recs calls consume every socket; calls to auth and cart queue behind them → login and checkout time out too, even though those services are healthy.
- BFF memory and event-loop pressure rise; liveness probes time out → pods restart → remaining pods get more load. Callers of the BFF retry → more load.

### Stop it now
1. **Flag off recommendations** on the homepage (render without it) — seconds.
2. Lower the recs timeout to ~200 ms and open its breaker.
3. Relax BFF liveness probes if they're restarting pods.
4. Then investigate recs itself (deploy? its DB? a model service?) and restore.

### Prevent it forever
- **Bulkheads**: separate pools/concurrency limits per downstream; recs capped at, say, 50 concurrent per pod.
- **Timeouts from deadlines**: homepage budget 500 ms; recs gets at most 150 ms, then fallback (bestsellers from cache).
- **Circuit breakers** with fallbacks for every soft dependency.
- **Graceful degradation by design**: each page section classified critical/optional; optional sections render async (client-side fetch or streamed) so they can't block the page.
- **Load shedding** by priority in the BFF; retry budgets.
- Latency-injection chaos tests on soft dependencies.`,
      followUps: [
        {
          q: 'How do you find the origin if everything is red?',
          a: 'Look at when each service started degrading and at the dependency direction: the deepest service that degraded first is the origin. Traces show which child span grew; client-side metrics per downstream in callers show which dependency\'s latency rose while others stayed flat.',
        },
        {
          q: 'Why is a 6 s slowdown worse than recommendations being down?',
          a: 'Down fails fast (connection refused in ms) and frees resources; slow holds sockets and memory for seconds, multiplying in-flight work by latency. Timeouts and breakers convert slow into fast failure.',
        },
      ],
      pitfalls: [
        'Scaling the BFF (more pods, more calls to a slow dependency).',
        'Only raising timeouts.',
        'Fixing recommendations without addressing why a soft dependency could take down checkout.',
      ],
    },
    {
      id: 'prod-async-failure-iq-06',
      difficulty: 'medium',
      question:
        'Your B2B API is multi-tenant. Yesterday one customer launched a bulk export integration and everyone else\'s p99 tripled for two hours. What controls should have existed, and how do you roll them out without breaking legitimate heavy users?',
      whatInterviewerLooksFor: [
        'Per-tenant rate, concurrency and cost-based limits',
        'Fair queuing / isolation of bulk workloads',
        'Observability by tenant',
        'Safe rollout: shadow mode, headers, customer communication, tiers',
      ],
      modelAnswer: `### What was missing
- **Per-tenant limits**: only a global rate limit existed, so one tenant could use most of the capacity legally.
- **Cost awareness**: an export request that scans 1M rows counts the same as a \`GET /me\`.
- **Isolation**: exports ran on the same pods, DB and worker queue as interactive traffic.
- **Visibility**: no per-tenant dashboard, so it took an hour to find the culprit.

### Controls
1. **Token bucket per tenant (and per API key)** at the gateway, with **cost weights** per endpoint (export = 50 tokens, list = 5, get = 1). Return 429 with \`Retry-After\` and \`RateLimit-*\` headers.
2. **Concurrency limit per tenant** (e.g. max 10 in-flight requests) — rate limits alone don't stop a few very slow requests from holding resources.
3. **Move bulk work to async jobs**: \`POST /exports\` → 202 + job ID; a separate worker pool with **per-tenant fair queuing** and a read replica.
4. DB guardrails: \`statement_timeout\` for API roles; per-tenant connection caps.
5. **Shuffle sharding** of workers/cells so a runaway tenant only shares capacity with a few others.

### Safe rollout
- **Shadow mode** first: compute limits, log "would have throttled", review which tenants would hit them.
- Set limits per plan tier with headroom above observed p99 usage; contract exceptions for big customers.
- Communicate: docs, headers visible before enforcement, a usage dashboard.
- Enforce gradually (start with the most expensive endpoints) with an override mechanism for on-call.`,
      followUps: [
        {
          q: 'Where do you store rate-limit state at 100k RPS?',
          a: 'Redis with atomic Lua token buckets, keyed with hash tags so each tenant\'s key stays on one slot; or local in-memory buckets per gateway instance with limits divided by instance count, periodically synced — cheaper, slightly less accurate.',
        },
        {
          q: 'What does the client do on 429?',
          a: 'Back off honouring Retry-After with jitter, reduce concurrency, and for bulk work use the async export API. Well-behaved SDKs implement this automatically.',
        },
      ],
      pitfalls: [
        'Only a global rate limit.',
        'Counting requests but not cost or concurrency.',
        'Enforcing new limits without shadow mode and breaking the biggest customers.',
      ],
    },
    {
      id: 'prod-async-failure-iq-07',
      difficulty: 'expert',
      question:
        'Design the resilience policy for our checkout service\'s calls to an external payment provider: timeouts, retries, circuit breaking, fallbacks and what happens when the provider is down for 20 minutes during a sale.',
      whatInterviewerLooksFor: [
        'Idempotency keys as prerequisite for any retry',
        'Timeout choice tied to provider latency and UX',
        'Breaker scope and failover to secondary PSP',
        'Handling unknown outcomes (timeouts after send) and reconciliation',
        'Business-aware fallback (queue authorisation, pending orders)',
      ],
      modelAnswer: `### Prerequisite: idempotency
Every authorisation carries \`Idempotency-Key = auth:{orderId}:{attemptGroup}\`. Without it, no retry is safe — a timeout doesn't tell you whether the charge happened.

### Timeouts
- Provider p99 ≈ 1.2 s; set per-attempt timeout 3 s, overall budget 8 s (user is on a spinner; beyond ~10 s they refresh and double-submit).
- Connect timeout short (~500 ms) — connection failures are safe to retry immediately.

### Retries
- Retry connection errors, 5xx, 429 (honour \`Retry-After\`), and timeouts — timeouts only because of the idempotency key.
- Max 2 attempts in the synchronous path, full jitter, retry budget per provider.
- **Unknown outcome** (final timeout): mark order \`PAYMENT_PENDING\`, poll the provider's status API/wait for the webhook; never tell the user "failed" if you don't know.

### Circuit breaker
- Per provider **and per operation** (auth vs refunds vs 3DS); open at ≥ 30–50% failures over ≥ 20 calls in 10 s; half-open after 30 s with a few probes.
- Alert on open.

### Provider down for 20 minutes
- **Failover to a secondary PSP** for new authorisations if contracted (routing layer; card tokens must be portable — network tokens or a vault).
- If no secondary: business decision per merchant/amount — **accept the order as "payment pending"** and authorise asynchronously when the provider returns (risk of later decline accepted for low-value orders), or show a clear "payments temporarily unavailable" message instead of timeouts.
- Queue the deferred authorisations durably (outbox) and drain them **rate-limited** when the breaker closes — don't cause our own retry storm against a recovering provider.

### Reconciliation
Webhooks + daily settlement reconciliation; alert on pending > 30 min.`,
      followUps: [
        {
          q: 'Should the checkout service retry or should the client/app retry?',
          a: 'One layer only. The server has the idempotency key, provider context and the retry budget, so the server retries; the client should not blindly resubmit — it polls order status instead. If the client does retry, it must reuse the same order/idempotency key.',
        },
        {
          q: 'How do you test this policy?',
          a: 'Fault injection against a provider sandbox or a stub: latency, 5xx, timeouts after the charge succeeded, webhook delays. Chaos drills in staging, and in production a controlled breaker-open game day for the secondary route.',
        },
      ],
      pitfalls: [
        'Retrying payment calls without idempotency keys.',
        'Treating a timeout as a failure and letting the user pay again.',
        'Draining a backlog of deferred charges at full speed when the provider recovers.',
      ],
    },
    {
      id: 'prod-async-failure-iq-08',
      difficulty: 'medium',
      question:
        'After a producer team\'s release, our notification consumer pods are in CrashLoopBackOff and lag is climbing on every partition. What happened most likely, and how do you restore service in minutes?',
      whatInterviewerLooksFor: [
        'Suspects schema/poison message from producer change',
        'Knows how to skip/park messages safely (offset reset, DLQ)',
        'Error classification so a bad message never crashes the consumer',
        'Schema registry compatibility for permanent prevention',
      ],
      modelAnswer: `### Likely cause
The producer changed the event shape (renamed field, new enum value, null where a value was expected, bigger payload). Our consumer throws an unhandled exception on deserialisation or in the handler → process exits → pod restarts → re-reads the same uncommitted message → crashes again. Every partition that received new-format events is stuck.

### Confirm (2 minutes)
- \`kubectl logs --previous\`: the same stack trace and message key/offset on every restart.
- Sample the message: \`kafka-console-consumer --topic notifications --partition 3 --offset <n> --max-messages 1\`.
- Timeline matches the producer deploy.

### Restore
1. **Fastest safe option**: ask the producer to roll back (stops new bad events).
2. Deploy a consumer hotfix that tolerates the new shape, or at minimum **catches the error and sends the message to the DLQ** instead of crashing.
3. If neither is quick: **reset the group's offsets** past the bad messages for affected partitions (\`kafka-consumer-groups --reset-offsets --to-offset\` with the group stopped), after copying those messages to a DLQ topic for later replay.

### Prevent
- **Schema registry** (Avro/Protobuf/JSON Schema) with BACKWARD compatibility enforced in the producer CI and at registration.
- Consumer never crashes on a single message: validate, classify, DLQ, alert.
- Consumer-driven contract tests between teams.
- Tolerant reader: ignore unknown fields, default unknown enums.`,
      followUps: [
        {
          q: 'Why is resetting offsets risky?',
          a: 'You may skip valid messages interleaved with bad ones, and it requires stopping the group. Always export the skipped range to a DLQ/replay topic first and reconcile afterwards.',
        },
        {
          q: 'What does BACKWARD compatibility guarantee?',
          a: 'Consumers using the new schema can read data written with the previous schema (e.g. new fields must have defaults). To protect old consumers from new producers you need FORWARD (or FULL) compatibility — choose based on which side upgrades first.',
        },
      ],
      pitfalls: [
        'Increasing pod memory or restarting the consumer repeatedly.',
        'Resetting offsets to latest and silently losing all backlog.',
        'Blaming Kafka rather than the event contract.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'prod-async-failure-boe-1',
      question:
        'An order-events topic has 12M messages of lag. Producers write 20k msg/s. 12 consumers on 24 partitions each process 1,250 msg/s. How long until the backlog drains if you scale to 24 consumers, and what if you also batch DB writes?',
      assumptions: [
        'Per-consumer throughput scales linearly until the DB saturates',
        'DB can absorb ~40k row writes/s with single-row inserts, ~150k/s with 500-row batches',
        'Batching raises per-consumer throughput to ~4,000 msg/s (DB round trips dominate)',
        'Producer rate stays at 20k msg/s',
      ],
      steps: [
        { label: 'Current consume rate', calc: '12 × 1,250 = 15,000 msg/s < 20,000 → lag grows 5,000/s (never drains)' },
        { label: 'Scale to 24 consumers', calc: '24 × 1,250 = 30,000 msg/s; net drain = 30,000 − 20,000 = 10,000/s' },
        { label: 'Drain time at 24 consumers', calc: '12,000,000 ÷ 10,000 = 1,200 s = 20 min' },
        { label: 'DB check', calc: '30k writes/s ≤ 40k/s single-row capacity — OK but at 75%' },
        { label: 'With batching', calc: '24 × 4,000 = 96,000 msg/s; net drain 76,000/s; DB 96k/s ≤ 150k/s batched capacity' },
        { label: 'Drain time with batching', calc: '12,000,000 ÷ 76,000 ≈ 158 s ≈ 2.6 min' },
        { label: 'Beyond 24 consumers', calc: '25th consumer idles (1 partition each); more parallelism needs more partitions or in-consumer keyed lanes' },
      ],
      answer:
        'Scaling to 24 consumers drains the backlog in ~20 minutes; adding batched writes cuts it to under 3 minutes. Beyond 24 consumers nothing improves without more partitions.',
      insight:
        'Per-message efficiency (batching) beats horizontal scaling, and the partition count is a hard cap on consumer parallelism — size partitions for future peak, and always check the downstream (DB) can absorb the drain rate.',
      followUps: [
        {
          "q": "A flash sale pushes producers to 40k msg/s while the 12M backlog exists. Do 24 consumers still drain it, single-row vs batched?",
          "a": "Single-row: 24 × 1,250 = 30,000 msg/s < 40,000, so lag grows by 10k/s and never drains. You also exceed nothing on the DB (30k ≤ 40k), so the consumer is the bottleneck. Batched: 24 × 4,000 = 96,000 msg/s, net drain 96,000 − 40,000 = 56,000/s, so 12M ÷ 56k ≈ 214 s ≈ 3.6 min. DB load is 96k/s ≤ 150k/s batched capacity. Batching is the difference between drowning and recovering at 2× traffic."
        },
        {
          "q": "The business wants the 12M backlog drained in under 1 minute (at 20k/s producer rate). Is that possible, and what's the binding constraint?",
          "a": "You'd need a net drain of 12M ÷ 60 s = 200k/s, i.e. 220k msg/s consumed. The DB's batched capacity is 150k writes/s, so the best possible net drain is 150k − 20k = 130k/s, giving 12M ÷ 130k ≈ 92 s. More partitions or consumers can't beat that, because the database is the binding constraint. Getting under a minute means raising DB write capacity (larger batches, COPY, sharding the table) or deferring part of the work, e.g. writing a compact summary now and backfilling detail later."
        }
      ],
    },
    {
      id: 'prod-async-failure-boe-2',
      question:
        'Edge traffic is 5,000 RPS. A request passes through gateway → BFF → orders → inventory, and each layer retries failed calls up to 2 times (3 attempts). Inventory goes hard down. How much load does inventory receive, and how much with a 10% retry budget at each layer?',
      assumptions: [
        'Inventory fails every request (fast failures, so callers retry immediately)',
        'Every layer retries all failures from its downstream',
        'Retry budget: retries ≤ 10% of that layer\'s incoming requests',
        'Inventory healthy capacity ≈ 7,000 RPS',
      ],
      steps: [
        { label: 'Orders → inventory', calc: 'each orders request makes 3 attempts' },
        { label: 'Amplification through layers', calc: 'gateway 3 × BFF 3 × orders 3 = 27 attempts at inventory per edge request (retrying layers: 3)' },
        { label: 'Load at inventory', calc: '5,000 × 27 = 135,000 RPS ≈ 19× its capacity' },
        { label: 'With 10% budget per layer', calc: 'each layer sends ≤ 1.1× its input: 5,000 × 1.1³ ≈ 6,655 RPS' },
        { label: 'Retry at one layer only (3 attempts at orders)', calc: '5,000 × 3 = 15,000 RPS — still 2× capacity without a budget' },
        { label: 'Single layer + budget', calc: '5,000 × 1.1 = 5,500 RPS < 7,000 capacity → recovery possible' },
      ],
      answer:
        'Without budgets inventory receives ~135k RPS (27×), which guarantees a metastable outage; 10% retry budgets cap it near 6.7k RPS, and single-layer retries with a budget keep it at ~5.5k RPS.',
      insight:
        'Retry amplification is multiplicative in depth. The fix is structural: retry at one layer, cap retries as a ratio of traffic, and use breakers to stop calling a dead dependency entirely.',
      followUps: [
        {
          "q": "Inventory isn't fully down: it fails 50% of requests. With 3 attempts at every layer and no budgets, what load does it see?",
          "a": "At orders, expected attempts per call = 1 + 0.5 + 0.25 = 1.75, and the call fails only if all three fail (0.5³ = 12.5%). The BFF retries those: 1 + 0.125 + 0.0156 ≈ 1.14 attempts per BFF call. A BFF call fails with probability 0.125³ ≈ 0.2%, so the gateway adds about 1.002×. Total ≈ 5,000 × 1.002 × 1.14 × 1.75 ≈ 10,000 RPS, already above the 7,000 capacity. The error rate then rises, which raises amplification further. A partial failure tips into a full one."
        },
        {
          "q": "You can only change one layer this week. Where do you put the retry budget and why?",
          "a": "Put it at the layer closest to the failing dependency that every path goes through, here orders → inventory, and remove retries in BFF and gateway, or set them to 0 for 5xx coming from below. Retrying at the lowest layer has the most context (it knows the error is transient and the operation is idempotent) and avoids multiplying attempts across layers. Upper layers should propagate a \"don't retry\" signal (e.g. a `retry-after` or a non-retryable status) once a lower layer has already exhausted its budget."
        }
      ],
    },
    {
      id: 'prod-async-failure-boe-3',
      question:
        'The BFF runs 20 pods at 1,000 RPS total, and calls the pricing service with p50 40 ms. Each pod has an HTTP agent with maxSockets 50 to pricing. Pricing degrades to 3 s latency. What happens with a 10 s timeout vs a 300 ms timeout + bulkhead?',
      assumptions: [
        'Every BFF request calls pricing once',
        'Requests beyond available sockets queue in the agent',
        'Healthy pricing p99 ≈ 150 ms',
        'BFF users time out at 5 s at the client',
      ],
      steps: [
        { label: 'Healthy in-flight (Little\'s law)', calc: '1,000 RPS × 0.04 s = 40 in flight → 2 per pod (of 50 sockets)' },
        { label: 'Degraded in-flight demand', calc: '1,000 × 3 s = 3,000 in flight → 150 per pod' },
        { label: 'Socket capacity', calc: '20 × 50 = 1,000 sockets → max throughput 1,000 ÷ 3 s ≈ 333 RPS; 667 RPS queue up' },
        { label: 'Queue growth', calc: '667 req/s × 5 s client timeout ≈ 3,300 queued requests → all users time out, memory grows' },
        { label: 'With 300 ms timeout', calc: 'in-flight capped at 1,000 × 0.3 = 300 → 15 per pod ≤ 50 sockets, no queueing' },
        { label: 'With bulkhead 20/pod + fallback', calc: 'pricing can hold at most 400 sockets fleet-wide; others fail fast to cached prices' },
      ],
      answer:
        'With a 10 s timeout the BFF can serve only ~333 RPS to pricing and everything else queues until clients time out; a 300 ms timeout plus a 20-socket bulkhead keeps in-flight bounded (~15 per pod) and falls back to cached prices.',
      insight:
        'Timeouts set concurrency: in-flight = RPS × min(latency, timeout). Choose timeouts slightly above healthy p99, bound concurrency per dependency, and provide a fallback — otherwise a slow dependency drains the whole pool.',
      followUps: [
        {
          "q": "Pricing is still at 3 s, but traffic triples to 3,000 RPS during a sale. With the 300 ms timeout and a 20-socket bulkhead per pod, what happens?",
          "a": "Demand in-flight = 3,000 × 0.3 s = 900, i.e. 45 per pod, but the bulkhead allows 20 per pod (400 fleet-wide). Max throughput to pricing is 400 ÷ 0.3 s ≈ 1,333 attempts/s, and all of those time out anyway since pricing takes 3 s. So about 1,667 RPS are rejected instantly by the bulkhead and about 1,333 RPS fail after 300 ms; all 3,000 go to cached prices. The BFF stays healthy. Pricing still gets 1,333 RPS of doomed calls, which is why a circuit breaker should stop them entirely."
        },
        {
          "q": "Cached prices can be up to 1 hour stale. Product says checkout must never charge a stale price. How do you change the fallback?",
          "a": "Split by context. Listing and product pages can show cached prices with a \"price may change\" note. Checkout must re-price authoritatively: if pricing is unavailable, fail the checkout step clearly (\"try again in a moment\") or queue the order as pending-price, rather than charging the cached value. You can narrow the impact by pre-computing prices for in-cart items into a short-TTL cache (e.g. 5 minutes) that pricing itself signs or versions, so checkout can accept a recent signed quote but never an arbitrary stale one."
        }
      ],
    },
  ],
  test: [
    {
      id: 'prod-async-failure-mcq-01',
      difficulty: 'hard',
      question:
        'A consumer group with 24 partitions has lag concentrated on partitions 7 and 19, while the other 22 are near zero. Consumers are at 30% CPU. What is the most likely explanation?',
      options: [
        'The group needs more consumers; scale from 12 to 48 pods.',
        'Hot keys map to those partitions, or messages there are stuck (poison message / slow consumer on those partitions) — scaling the group will not help.',
        'The broker hosting those partitions has too little disk.',
        'Auto-commit is disabled, so lag metrics are inaccurate for all partitions.',
      ],
      correct: [1],
      explanation:
        'Skewed lag with idle consumers points to per-partition problems: hot keys routing a disproportionate share to two partitions, or a stuck message/consumer. Each partition is processed by one consumer, so more pods (especially beyond 24) cannot parallelise a single partition. Broker disk would show broker-level errors, not consumer lag; and disabled auto-commit with manual commits does not distort lag on only two partitions.',
      followUps: [
        {
          "q": "You confirm partition 7 is hot because one merchant ID produces 40% of all events. You cannot change the producer's key. How do you drain that partition faster?",
          "a": "Parallelise inside the consumer that owns partition 7. Fan its messages into keyed lanes on a sub-key (e.g. orderId within the merchant) when ordering only matters per order, not per merchant, and commit using a completion watermark, i.e. the lowest offset whose processing has finished. If strict per-merchant order is required, the only levers are per-message efficiency: batch DB writes, cache lookups, and drop synchronous calls. Longer term, ask the producer to salt the hot key (`merchantId#bucket`) and resequence downstream if needed."
        },
        {
          "q": "How would you tell \"hot key\" apart from \"stuck poison message\" on partition 19 within two minutes using metrics alone?",
          "a": "Compare the committed offset with the log-end offset over time. With a hot key the committed offset keeps advancing, just slower than the produce rate, and per-partition produce-rate metrics show 19 receiving far more messages than the others. With a stuck message the committed offset is frozen, the produce rate into 19 is normal, and the consumer logs or error counters show the same offset failing repeatedly. A flat committed offset next to a rising end offset is the signature of a stuck message."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-02',
      difficulty: 'expert',
      question:
        'What goes wrong with this KafkaJS consumer during a rolling deploy?',
      code: {
        language: 'typescript',
        code: `await consumer.run({
  autoCommit: true,
  autoCommitInterval: 5000,
  eachMessage: async ({ message }) => {
    const evt = JSON.parse(message.value!.toString());
    await emailClient.send(evt.userId, 'order_shipped'); // external side effect
  },
});
// no SIGTERM handling; pods are killed after 30s grace`,
      },
      options: [
        'Nothing: KafkaJS only commits offsets for messages whose eachMessage resolved, so no email is sent twice.',
        'Offsets are committed before eachMessage runs, so emails are lost during deploys.',
        'Messages processed since the last commit are redelivered to another consumer after the rebalance, sending duplicate emails; the handler needs idempotency and shutdown should disconnect/commit.',
        'autoCommitInterval must be larger than sessionTimeout, otherwise the consumer is kicked out of the group.',
      ],
      correct: [2],
      explanation:
        'KafkaJS resolves offsets after eachMessage but commits periodically; any messages processed after the last commit are redelivered when the partition moves, so external side effects repeat. Option A is only half-right: resolved-but-uncommitted offsets are exactly the problem. Offsets are not committed before processing, so emails are not lost. There is no rule tying autoCommitInterval to sessionTimeout; heartbeats keep membership.',
      followUps: [
        {
          "q": "You add idempotency, but the email provider has no idempotency key. How do you make \"send exactly one email per event\" work anyway?",
          "a": "Record the intent in your own store before the side effect. Insert `(event_id) PRIMARY KEY` into a `sent_emails` table with state PENDING, call the provider, then mark it SENT. On redelivery, skip if the row is SENT. If it is PENDING, a crash happened mid-send and the outcome is unknown, so you choose between a rare duplicate (resend) and a rare loss (mark failed and alert). Most teams accept the rare duplicate for transactional email and keep the window to milliseconds by writing SENT immediately after the provider returns 2xx."
        },
        {
          "q": "How do you make shutdown during the rolling deploy commit cleanly so redelivery shrinks to near zero?",
          "a": "Handle SIGTERM by calling `consumer.disconnect()`, which stops fetching, waits for in-flight `eachMessage` handlers to finish, commits resolved offsets and leaves the group so the rebalance starts at once. Set the pod's `terminationGracePeriodSeconds` above your worst-case handler time (e.g. 30 s). Also use cooperative-sticky assignment, or static membership with `group.instance.id`, so a restarting pod doesn't trigger a full stop-the-world rebalance. Idempotency is still required, because a kill -9 or OOM bypasses all of this."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-03',
      difficulty: 'hard',
      question:
        'Select ALL that apply: which techniques make a consumer that inserts ledger entries safe against redelivered messages?',
      options: [
        'Insert the event ID into an inbox table with a primary key in the same transaction as the ledger insert, skipping on conflict.',
        'A unique constraint on ledger_entries(source_event_id) with ON CONFLICT DO NOTHING.',
        'Enabling the Kafka idempotent producer on the upstream service.',
        'Checking a Redis SET for the event ID before inserting, and adding it after the DB commit.',
      ],
      correct: [0, 1],
      explanation:
        'Both the inbox table and a unique constraint make the dedup decision atomic with the side effect in the same database. The idempotent producer only prevents broker-level duplicates from producer retries; it does nothing about consumer redelivery. A Redis check-then-set outside the DB transaction has a race window (crash after commit but before the Redis write, or concurrent redeliveries) and loses dedup state if Redis is flushed.',
      followUps: [
        {
          "q": "The ledger lives in Postgres but the consumer also calls an external tax service for each entry. Does the inbox table still protect you?",
          "a": "Only for the DB write. The inbox row and the ledger row commit atomically, but the external call sits outside that transaction. If you call the tax service and then crash before commit, the redelivery calls it again. Either make the external call idempotent (pass `event_id` as its idempotency key), or split the work: commit the ledger entry plus an outbox row in one transaction, and let a separate relay perform the external call idempotently. Never hold a DB transaction open across a slow remote call."
        },
        {
          "q": "The inbox table grows by 50M rows a day. How do you keep it from becoming the bottleneck?",
          "a": "Bound dedup to the redelivery window. Redelivery realistically happens within hours (rebalances, DLQ replays within a retention window), so partition the inbox table by day and drop partitions older than, say, 7 days. Dropping a partition is cheap, whereas `DELETE` causes bloat. Keep the primary key narrow (a UUID or `(topic, partition, offset)`) so inserts stay index-only. If DLQ replays can be older than the window, the replay tool must check the ledger's unique `source_event_id` instead, which is permanent."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-04',
      difficulty: 'expert',
      question:
        'A team needs per-customer event ordering. They increase the topic from 12 to 48 partitions during peak to fix lag. What happens next?',
      options: [
        'Existing messages are rebalanced across the 48 partitions, so lag drops immediately and ordering is preserved.',
        'Kafka rejects the change because keyed topics cannot grow partitions.',
        'Nothing changes until consumers restart, because producers cache partition counts forever.',
        'New events for a customer may hash to a different partition than that customer\'s unconsumed older events, so they can be processed out of order; the existing backlog stays on the original 12 partitions.',
      ],
      correct: [3],
      explanation:
        'Adding partitions changes hash(key) mod N for new records while old records remain where they were, so a customer\'s new event can be consumed before its older backlog. Kafka does not move existing data between partitions, so the backlog on the original 12 does not drain faster. Kafka allows increasing partitions on keyed topics (it just breaks key-to-partition mapping), and producers refresh metadata periodically, picking up new partitions within minutes.',
      followUps: [
        {
          "q": "You must go from 12 to 48 partitions on a keyed topic without breaking per-customer order. What's the safe migration?",
          "a": "Create a new 48-partition topic and switch producers to it at a cut-over point. Consumers drain the old topic completely before reading the new one, or they handle it per key: hold new-topic events for a customer until the old topic's backlog is past that customer. Simplest in practice: pause producers briefly, let consumers reach zero lag on the old topic, then flip producers and consumers to the new topic. Alternatively, dual-write with a per-key sequence number and have consumers reject or park out-of-order events. Plan partition counts for 2–3 years of peak growth up front."
        },
        {
          "q": "If you can't migrate topics, how would consumers detect and survive out-of-order events after the partition change?",
          "a": "Carry a per-customer monotonic version or sequence in each event (assigned by the producer from the source-of-truth row). The consumer stores the last applied version per customer and applies an event only if `version = last + 1`. If it is lower, it's a duplicate, so skip it. If it is higher, it arrived early, so park it in a per-key pending table or a delayed retry topic until the gap fills, and alert if a gap persists past N minutes. This makes ordering a property of the data, not of the partitioning."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-05',
      difficulty: 'medium',
      question:
        'Your mobile SDK uses the retry helper below. 10,000 clients lose connectivity to the API at the same moment during a 20-second outage. What happens when the API recovers?',
      code: {
        language: 'typescript',
        code: `async function retry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (err) {
      if (attempt + 1 >= attempts) throw err;
      const delay = 200 * 2 ** attempt;          // 200, 400, 800, 1600, 3200 ms
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}`,
      },
      options: [
        'Clients retry in synchronized waves (at 200 ms, 400 ms, 800 ms…), creating load spikes that can knock the API over again; full jitter spreads them out.',
        'Exponential backoff alone guarantees load is spread evenly, so recovery is smooth.',
        'The API sees less load than normal because clients are backing off.',
        'Clients give up permanently after the first backoff, so traffic drops to zero.',
      ],
      correct: [0],
      explanation:
        'Deterministic backoff keeps clients that failed together retrying together; each retry wave hits simultaneously. Full jitter (random between 0 and the exponential cap) decorrelates clients. Exponential growth reduces the rate over time but does not desynchronise clients; nothing in the helper makes clients give up permanently.',
      followUps: [
        {
          "q": "You ship full jitter, but old app versions without it make up 60% of installs and won't update for months. How do you protect the API now?",
          "a": "Control it server-side. Return `429` or `503` with a `Retry-After` header carrying a randomised value (e.g. 1–30 s); even old clients often honour it if the HTTP library does. Put admission control at the edge: a token bucket sized to recovery capacity, so the synchronized waves are clipped rather than reaching the API. Ramp traffic back with a gradual allow-percentage at the LB or feature flag. Also add a remote-config kill switch to future SDKs so retry policy can change without an app release."
        },
        {
          "q": "With full jitter and a 30 s cap, roughly how long until most of the 10,000 clients reconnect after the 20 s outage, and what's the peak rate?",
          "a": "With full jitter each attempt waits uniform(0, min(cap, base×2^n)). After 20 s of failures, clients are around attempt 6–7 (200 ms base reaches 12.8–25.6 s windows), so retries spread roughly uniformly over a ~25 s window. The peak is about 10,000 ÷ 25 s ≈ 400 req/s instead of 10,000 in one instant. Most clients reconnect within one window (~25 s) after recovery. The trade-off: jitter lowers the peak but stretches mean recovery time, which is why some systems use \"decorrelated jitter\" to balance both."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-06',
      difficulty: 'expert',
      question:
        'Select ALL that apply: which conditions are needed before automatically retrying a failed `POST /payments` call that timed out?',
      options: [
        'The request carries an idempotency key that the server uses to return the original result on repeats.',
        'The retry happens within the caller\'s remaining deadline.',
        'The server returned 400 Bad Request, which indicates a transient error.',
        'A retry budget or circuit breaker ensures retries do not amplify an outage.',
        'The client first waits exactly 1 s so all clients retry together after the provider recovers.',
      ],
      correct: [0, 1, 3],
      explanation:
        'A timed-out POST has an unknown outcome, so only an idempotency key makes a retry safe; the retry must also fit the deadline and be bounded by a budget or breaker. 400 is a permanent client error and should not be retried. A fixed synchronised delay is the opposite of jitter and causes retry waves.',
      followUps: [
        {
          "q": "The PSP honours idempotency keys for only 24 hours. Your retry tool replays a stuck payment after 3 days. What can happen and how do you prevent it?",
          "a": "After the key expires the PSP treats the replay as a new payment, so the customer is charged twice. Prevention: before any replay, query the PSP for the payment's status by your own reference (`merchant_reference = orderId`) and only charge if no succeeded charge exists. Store PSP charge IDs locally and reconcile daily against the PSP's settlement report. Make the replay tool refuse anything older than the key TTL unless it has done that status lookup first."
        },
        {
          "q": "The caller's deadline is 2 s and the first attempt timed out at 1.5 s. Should you retry?",
          "a": "Usually no. Only 500 ms is left, and if the PSP's healthy p99 is, say, 800 ms, a retry is likely to time out too, wasting PSP capacity and adding a possibly-duplicate request. Better: return a \"pending\" result to the user and let an async reconciler resolve the unknown outcome via the idempotency key or a status query. This is why per-attempt timeouts must be planned against the overall deadline, e.g. two attempts of 800 ms within 2 s, rather than one long attempt that eats the whole budget."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-07',
      difficulty: 'hard',
      question:
        'Given this opossum configuration, the pricing API fails 100% of calls, but only 5 requests arrive per 10-second window at night. What does the breaker do?',
      code: {
        language: 'typescript',
        code: `new CircuitBreaker(callPricing, {
  timeout: 300,
  errorThresholdPercentage: 50,
  volumeThreshold: 20,
  rollingCountTimeout: 10_000,
  resetTimeout: 15_000,
});`,
      },
      options: [
        'Opens after the 1st failure since the error rate is 100%.',
        'Opens after 10 failures, when 50% of the 20-request threshold is reached.',
        'Stays closed because fewer than 20 requests occur in the rolling window, so every call waits for the 300 ms timeout or fails.',
        'Moves to half-open every 15 s regardless of traffic.',
      ],
      correct: [2],
      explanation:
        'volumeThreshold is the minimum number of requests in the rolling window before the error percentage is evaluated; with only 5 calls per 10 s it never reaches 20, so the breaker never opens. This prevents flapping on tiny samples but means low-traffic dependencies need a lower threshold or a different signal. It does not open on the first failure or at 10 failures, and half-open only happens after it has opened.',
      followUps: [
        {
          "q": "How would you configure protection for this low-traffic pricing dependency so the night-time outage is caught quickly?",
          "a": "Lower `volumeThreshold` to something like 5 and lengthen `rollingCountTimeout` to 60 s, so 5–10 calls form a valid sample. Alternatively, trip on consecutive failures (e.g. 5 in a row) rather than a percentage. Add a synthetic health probe every few seconds so the breaker has signal even with no user traffic. And since each failed call costs the full 300 ms timeout, pair it with a cached-price fallback so night users don't wait at all."
        },
        {
          "q": "The breaker finally opens. During half-open, opossum lets one trial request through. What goes wrong if pricing is only partially recovered?",
          "a": "A single success closes the breaker, and then the full traffic of every pod hits a dependency that can only handle part of it, so it fails again and the breaker re-opens. This is flapping. Mitigations: require several consecutive successes before closing, ramp traffic gradually after closing (allow 10%, then 25%…), and add per-pod jitter to `resetTimeout` so 50 pods don't all probe at the same instant. Monitor breaker state transitions per minute; more than a few per minute means flapping."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-08',
      difficulty: 'expert',
      question:
        'A downstream\'s latency rises from 50 ms to 2.5 s at a steady 800 RPS, and your service holds a connection pool of 100 to it with a 10 s timeout. What is the maximum throughput you can achieve to that downstream, and what happens to the rest?',
      options: [
        'Still 800 RPS — the pool reuses connections, so latency does not affect throughput.',
        '~40 RPS; the rest is rejected immediately by the pool.',
        '~400 RPS; the rest is served from cache automatically.',
        '~40 RPS (100 connections ÷ 2.5 s); the remaining ~760 RPS queue waiting for connections until their own timeouts, growing memory and latency for everything sharing the pool.',
      ],
      correct: [3],
      explanation:
        'By Little\'s law, throughput = concurrency ÷ latency = 100 ÷ 2.5 s = 40 RPS. Excess requests do not fail fast by default; they queue for a pooled connection, consuming memory and time until they hit a timeout. Connection reuse does not remove the latency constraint, and nothing is served from cache unless you build a fallback; the pool does not reject immediately unless a max queue or acquire timeout is configured.',
      followUps: [
        {
          "q": "You add a pool acquire timeout of 50 ms. What does the caller now see at 800 RPS, and is that better?",
          "a": "The pool still completes only ~40 RPS. The other ~760 RPS fail after at most 50 ms with a \"pool exhausted\" error instead of queueing for 10 s. That's better: memory stays flat, threads and event-loop work aren't held, and callers get a fast error they can turn into a fallback (cached value, degraded response). You've converted a slow failure that spreads into a fast, contained one. Alert on pool-acquire timeouts, since they are the earliest sign of downstream latency."
        },
        {
          "q": "Could you just raise the pool to 2,000 connections to keep 800 RPS at 2.5 s latency? What breaks?",
          "a": "Little's law says 800 × 2.5 = 2,000 connections would do it on paper. But the downstream is slow because it's overloaded, and 20× more concurrent requests usually makes it slower or kills it. The downstream's connection/thread limits and its DB pool also cap it. Across 50 client pods that's 100k connections. You'd also use far more memory and file descriptors locally. Raising concurrency into a sick dependency feeds the failure; bounding it and shedding is what lets it recover."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-09',
      difficulty: 'medium',
      question:
        'During a cascading failure, BFF pods keep restarting with liveness failures, and each restart makes the remaining pods more overloaded. What is the best immediate action on the probes?',
      options: [
        'Make liveness checks the downstream services too, so pods restart when dependencies are down.',
        'Relax liveness (longer timeout/threshold, process-local check) so busy pods are not killed, and use readiness/load shedding to manage traffic.',
        'Remove readiness probes so all pods always receive traffic.',
        'Lower the liveness timeout to 100 ms so broken pods are replaced faster.',
      ],
      correct: [1],
      explanation:
        'Overloaded-but-alive pods failing liveness get restarted, reducing capacity and extending the cascade; liveness should be lenient and local, while readiness and load shedding handle overload. Checking dependencies in liveness makes fleet-wide restarts more likely. Removing readiness sends traffic to unready pods, and a tighter timeout kills more busy pods.',
      followUps: [
        {
          "q": "What should the liveness endpoint actually check for a Node BFF, and what should readiness check?",
          "a": "Liveness: only \"is this process able to make progress?\", e.g. the HTTP handler responds and event-loop lag is under, say, 5 s. Nothing about dependencies or request load. Failure threshold around 3–5 × 10 s, so only a truly wedged process restarts. Readiness: \"should I get new traffic?\", e.g. warm-up done, in-flight requests below a limit, and maybe critical local resources. Even readiness should rarely fail on a shared dependency, because then all pods go unready together and the Service has zero endpoints, which is worse than degraded responses."
        },
        {
          "q": "The cascade is stopped. How would you catch this probe misconfiguration in a game day before the next real incident?",
          "a": "Run a load test in staging at 1.5–2× peak and inject latency into a downstream (e.g. +2 s via a fault-injection proxy or service-mesh fault rule). Watch `kube_pod_container_status_restarts_total` and the probe failure events. Pass criteria: zero liveness restarts, readiness flaps bounded, error rate degrades gracefully via shedding, and capacity recovers within N seconds of removing the fault. Add a CI policy check (e.g. OPA/Conftest) that rejects liveness probes hitting dependency-checking paths or with timeouts under 1 s."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-10',
      difficulty: 'medium',
      question:
        'A message consistently throws a deserialization error. The consumer retries it in-process forever. What is the correct handling?',
      options: [
        'Classify it as a permanent error, publish it with context headers to a DLQ, commit past it and alert; keep a replay tool for after a fix.',
        'Restart the consumer; deserialization errors are usually transient.',
        'Increase max.poll.interval.ms so the consumer has more time to succeed.',
        'Delete the topic and recreate it to clear the bad message.',
      ],
      correct: [0],
      explanation:
        'Deserialization errors do not fix themselves on retry; parking the message in a DLQ unblocks the partition while preserving the data for replay. Restarting re-reads the same uncommitted message and crashes again. A longer poll interval only delays the rebalance, and deleting the topic destroys all other data.',
      followUps: [
        {
          "q": "The bad message came from a producer bug that affects 200k messages over an hour. What happens to your DLQ approach and how do you adapt?",
          "a": "Per-message DLQ still works, but now you're writing 200k records to the DLQ and alert fatigue sets in. Add a DLQ-rate breaker: if more than X% of messages per minute fail deserialization, pause the consumer and page someone, because it's systemic, not a poison pill. Once the producer is fixed, replay the DLQ in bulk with a rate limit and a version-aware deserializer. Better still, put a schema registry with compatibility checks in the producer's CI so incompatible schemas are rejected before deploy."
        },
        {
          "q": "How do you design the DLQ replay tool so a replay can't cause new damage?",
          "a": "Keep the original topic/partition/offset, the error class and the first-failure time in headers. Replay into the original topic, or a dedicated replay topic the same consumer reads, with a rate limit and a dry-run mode that only re-parses. Require the consumer to be idempotent, because replays are redeliveries. Support filtering by error type or time range so you don't replay messages that are still broken, and record who replayed what for audit. Replayed messages that fail again go to a terminal DLQ, not back into an infinite loop."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-11',
      difficulty: 'expert',
      question:
        'Select ALL that apply: which measures limit a single tenant\'s ability to degrade other tenants on a shared API and worker fleet?',
      options: [
        'Per-tenant token-bucket rate limits with cost weights per endpoint.',
        'Per-tenant concurrency limits on in-flight requests.',
        'A single global FIFO job queue with more workers.',
        'Shuffle sharding: each tenant is assigned a small random subset of workers.',
        'Raising the global rate limit so no tenant hits it.',
      ],
      correct: [0, 1, 3],
      explanation:
        'Rate limits with cost weights cap consumption, concurrency limits stop a few slow expensive requests from hogging resources, and shuffle sharding bounds the blast radius to tenants sharing the same subset. A global FIFO queue lets one tenant\'s 2M jobs delay everyone regardless of worker count, and raising the global limit removes protection instead of adding fairness.',
      followUps: [
        {
          "q": "With shuffle sharding, 100 workers and each tenant assigned 4, what's the chance two specific tenants share their whole subset?",
          "a": "The number of distinct 4-worker subsets is C(100,4) = 3,921,225, so two random tenants have an identical shard with probability about 1 in 3.9M. Partial overlap is common, but a noisy tenant that saturates its 4 workers fully blocks only tenants whose entire set is those same 4. Everyone else keeps at least one healthy worker, as long as clients route around busy workers. This is why shuffle sharding needs client-side retry to another worker in the shard, not just assignment."
        },
        {
          "q": "A legitimate enterprise tenant genuinely needs 10× the default limit for their nightly export. How do you serve them without reopening the noisy-neighbour hole?",
          "a": "Make limits a per-tenant plan, not a constant: raise their token-bucket rate and concurrency explicitly, and route the export to a separate, isolated pool (a dedicated queue and workers, or a \"bulk\" lane with lower priority). Give them an async export API (submit a job, poll or webhook) instead of hammering sync endpoints. Bill or contract for it so capacity is planned. The principle: heavy use is fine when it's provisioned and isolated; it's only harmful when it shares the interactive pool unannounced."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-12',
      difficulty: 'hard',
      question:
        'What is the flaw in this per-key ordering implementation when combined with offset commits?',
      code: {
        language: 'typescript',
        code: `// inside eachBatch
for (const m of batch.messages) {
  dispatchToLane(m.key!.toString(), m);            // runs async, per-key serial
  resolveOffset(m.offset);                         // mark consumed immediately
}
await commitOffsetsIfNecessary();`,
      },
      options: [
        'Keyed lanes cannot preserve ordering in Kafka at all.',
        'resolveOffset must be called before dispatching to guarantee ordering.',
        'Offsets are committed before the lanes finish processing, so a crash loses in-flight messages (at-most-once); commit only up to the lowest offset whose processing has completed.',
        'commitOffsetsIfNecessary sends one commit per message, overloading the broker.',
      ],
      correct: [2],
      explanation:
        'Marking offsets consumed at dispatch time means the committed position can move past messages still queued in lanes; after a crash they are never redelivered. The fix is a completion watermark per partition. Keyed lanes do preserve per-key order; resolving before dispatch has the same flaw; commitOffsetsIfNecessary batches commits according to autoCommit settings rather than committing per message.',
      followUps: [
        {
          "q": "Sketch the completion-watermark logic for one partition. Offsets 100–109 are dispatched and 100, 101, 103 finish. What do you commit?",
          "a": "Keep the dispatched offsets in a sorted set per partition and remove each one when its lane finishes. The committable offset is the smallest still-pending offset; Kafka's commit means \"next to read\". With 100, 101 and 103 done, 102 is the lowest pending, so you commit 102. After a crash, 102–109 are redelivered, including 103, which already succeeded, so handlers must be idempotent. Commit periodically (e.g. every 1 s), not per completion, to keep commit traffic low."
        },
        {
          "q": "One key's lane is stuck on a slow message for 10 minutes. What happens to the watermark and to the consumer's memory?",
          "a": "The watermark can't pass the stuck offset, so commits stall for the whole partition even though other lanes keep processing. Meanwhile the consumer keeps fetching and buffering completed-but-uncommitted work, so memory grows, and a crash would redeliver 10 minutes of messages. Bound it: cap the in-flight window per partition (pause fetching when more than N are pending), put a timeout on each handler, and move a message that exceeds it to a retry topic so the watermark can advance. Alert on \"oldest pending offset age\"."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-13',
      difficulty: 'expert',
      question:
        'A dependency recovered 15 minutes ago but your service still shows 60% errors, and the dependency\'s CPU is pegged processing requests whose callers timed out long ago. Which mitigation targets the mechanism most directly?',
      options: [
        'Increase caller timeouts so fewer requests time out.',
        'Add more retries with longer backoff.',
        'Scale the dependency horizontally and wait.',
        'Shed load at the edge below the dependency\'s capacity, disable inner-layer retries, and make the dependency drop requests whose propagated deadline has passed.',
      ],
      correct: [3],
      explanation:
        'This is a metastable state sustained by excess load and wasted work on expired requests. Cutting incoming load, removing retry amplification and dropping expired work let the dependency catch up. Longer timeouts increase in-flight work; more retries add load; scaling may take minutes and can overload the dependency\'s own database while the amplification continues.',
      followUps: [
        {
          "q": "How do you implement \"drop requests whose propagated deadline has passed\" in a Node service behind gRPC and HTTP?",
          "a": "Propagate an absolute deadline: gRPC does this natively (`grpc-timeout`), and over HTTP use a header like `x-request-deadline: <epoch ms>` set by the edge. On arrival, if `now >= deadline`, return 504 immediately without touching the DB. While queued, check again before starting expensive work. For downstream calls, set each call's timeout to `deadline - now - margin`. Use the monotonic clock locally and allow some clock-skew slack (e.g. 50 ms) for the cross-host absolute timestamp. Count \"expired on arrival\" as a metric; it spikes during a metastable state."
        },
        {
          "q": "After shedding, error rate drops to 5%. How do you restore full traffic without re-entering the metastable state?",
          "a": "Ramp gradually: raise the edge admission limit in steps (e.g. +10% every 2 minutes) while watching the dependency's queue depth, p99 and expired-work ratio, and back off automatically if any of them turns up. Keep inner-layer retries disabled until you're back at full traffic with headroom, then re-enable them with a retry budget. Warm caches first if the dependency relies on them, since a cold cache is often what made the post-failover load exceed capacity in the first place."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-14',
      difficulty: 'expert',
      question:
        'Select ALL that apply: why does an SQS consumer that sometimes takes 90 s per message, with the default 30 s visibility timeout, produce duplicates and wasted work?',
      options: [
        'After 30 s the message becomes visible again and another consumer receives it while the first is still processing.',
        'SQS deletes messages automatically after the visibility timeout, so the work is lost.',
        'ApproximateReceiveCount increases on each redelivery and may push the message to the DLQ via maxReceiveCount even though processing would have succeeded.',
        'Standard queues guarantee exactly-once delivery, so this cannot cause duplicates.',
      ],
      correct: [0, 2],
      explanation:
        'Visibility timeout only hides a message; when it expires the message is redelivered, so two consumers process it and the receive count rises toward the redrive threshold. Fix by extending visibility (ChangeMessageVisibility heartbeat) or raising the timeout above p99 processing time, and keep handlers idempotent. SQS never deletes messages at visibility expiry (only on DeleteMessage or retention), and standard queues are at-least-once.',
      followUps: [
        {
          "q": "You add a visibility heartbeat that extends by 30 s every 20 s. Now the consumer process freezes (stuck on a deadlocked DB call) but stays alive. What happens?",
          "a": "If the heartbeat runs on a separate timer, it keeps extending visibility forever, so the message is never redelivered and never reaches the DLQ. You've traded duplicates for a silent stall. Bound it: cap total extension (e.g. stop heartbeating after 10 minutes, the max sane processing time), give the handler its own timeout so the work is aborted, and emit a metric for the age of in-flight messages. SQS also caps visibility at 12 hours, but that's far too long to be your safety net."
        },
        {
          "q": "Would switching to a FIFO queue fix the duplicates here?",
          "a": "Partly. FIFO dedups producer sends within a 5-minute window via `MessageDeduplicationId`, and it blocks other messages in the same message group while one is in flight. But if visibility expires while processing, FIFO still redelivers that message to another consumer, so the duplicate processing remains. FIFO also caps throughput (300 msg/s per API action, or 3,000 with batching, higher in high-throughput mode). The real fixes are still visibility longer than p99 processing (or a heartbeat) plus an idempotent handler."
        }
      ],
    },
    {
      id: 'prod-async-failure-mcq-15',
      difficulty: 'hard',
      question:
        'Your homepage BFF calls recommendations, cart and auth through one shared HTTP agent with maxSockets 100. Recommendations becomes slow. Which change best prevents cart and auth from failing too?',
      options: [
        'Raise maxSockets to 1,000 on the shared agent.',
        'Add retries to the cart and auth calls.',
        'Give each downstream its own agent/bulkhead with a concurrency cap, plus a short timeout and fallback for recommendations.',
        'Increase the recommendations timeout so its calls eventually succeed.',
      ],
      correct: [2],
      explanation:
        'Separate pools (bulkheads) stop one slow dependency from consuming the sockets the others need, and a short timeout with a fallback bounds recommendations\' in-flight work. A bigger shared pool just lets more sockets be held by slow calls and adds memory pressure. Retries to cart/auth add load without freeing sockets, and a longer timeout increases in-flight work (Little\'s law).',
      followUps: [
        {
          "q": "How do you size the recommendations bulkhead if it handles 300 RPS per pod at a healthy p99 of 120 ms?",
          "a": "Little's law: healthy in-flight is 300 × 0.12 = 36. Set the concurrency cap with headroom, around 50–60, and the timeout slightly above p99, say 200 ms. When recommendations slows, in-flight is capped at about 60. Requests beyond that are rejected immediately to the fallback (popular items, cached recs), and the timeout bounds how long each slot is held. Cart and auth have their own agents, so their sockets are never touched. Re-derive the numbers when traffic changes, and alert on bulkhead rejections."
        },
        {
          "q": "Recommendations is optional but auth is critical. If the BFF itself is CPU-bound during the slowdown, what else would you do?",
          "a": "Prioritise work, not just sockets. Under CPU pressure, skip the recommendations call entirely: a feature flag or adaptive degradation that turns it off when event-loop lag or CPU passes a threshold, serving a static module instead. That frees CPU for auth and cart. Also shed lower-priority requests at the edge (e.g. anonymous homepage loads before logged-in checkout). Bulkheads isolate dependency failures; load shedding with priorities protects the service's own resources."
        }
      ],
    },
  ],
};

export default topic;
