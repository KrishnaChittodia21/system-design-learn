import type { Topic } from '../../types';

const topic: Topic = {
  id: 'mq-scenarios',
  phase: 'messaging',
  order: 2,
  title: 'Async Processing Failure Modes',
  subtitle:
    'The production incidents of queue-based systems: slow APIs, 10× spikes, lag, crashes mid-message, duplicates, poison pills, ordering under retries, hot partitions and backpressure. For each one: symptoms, root cause, fix.',
  estimatedMinutes: 105,
  sources: [
    'Alex Xu — System Design Interview Vol 2, Ch 4 Distributed Message Queue',
    'Alex Xu — System Design Interview Vol 2, Ch 11 Payment System (retry queue, DLQ, idempotency)',
    'Uber Engineering — Reliable reprocessing with Kafka (retry topics and DLQs)',
    'AWS SQS Developer Guide (visibility timeout, DLQ redrive)',
  ],
  tags: ['async', '202-accepted', 'webhooks', 'consumer-lag', 'load-leveling', 'idempotent-consumer', 'retry-topic', 'dlq', 'poison-pill', 'ordering', 'hot-partition', 'backpressure', 'keda'],
  cheatSheet: [
    'Slow API (>1–2s)? Return 202 + Location: /jobs/{id}; client polls with Retry-After or gets a signed webhook. Create the job idempotently (Idempotency-Key).',
    'Queue = shock absorber: backlog = (in − out) × spike duration; drain time = backlog ÷ (capacity − normal rate). Retention must exceed spike + drain.',
    'Alert on lag in TIME (age of oldest unprocessed message), not just message count. 1M messages is 10s for one topic and 3 hours for another.',
    'Lag triage order: producer spike? consumer throughput drop? error/retry rate? rebalance loop? one hot partition? downstream (DB/API) saturated? Fix the bottleneck, not the symptom.',
    'Scaling consumers helps only up to #partitions AND only if the bottleneck is the consumer, not the DB behind it. Batching writes often beats adding pods.',
    'Crash-safe = side effect first, ack/commit after. SQS: visibility timeout > p99 processing (heartbeat with ChangeMessageVisibility). Kafka: commit after process, disconnect on SIGTERM.',
    'Every consumer is at-least-once → idempotent: dedup table insert in the SAME txn as the effect, upsert with version guard, or idempotency key to external APIs.',
    'Retries: in-place (short, 2–3 tries) → retry topics with growing delays (1m, 10m, 1h) → DLQ with error headers → alert + redrive tool. Never retry permanent errors (validation, 4xx).',
    'Retry topics break per-key order. If order matters: version checks on apply, or "park" the key (route all later messages for that key to retry until it clears).',
    'Hot partition: detect with per-partition lag/bytes-in. Salt only hot keys (key#0..7) and accept losing per-key order, or split the hot tenant to its own topic. Backpressure: pause partitions, bounded concurrency, honor 429 Retry-After.',
  ],
  sections: [
    {
      heading: 'A mental model for async incidents: rates, lag and Little\'s law',
      body: `**Intuition:** a queue is a bathtub. The tap is the producer, the drain is the consumer. The water level (lag) only tells you the tap is faster than the drain *right now* — you have to look at both to know why.

**The four numbers to always look at:**
1. **Produce rate** (msgs/s in) — did traffic spike?
2. **Consume rate** (msgs/s successfully processed) — did consumers slow down or stop?
3. **Lag** — in messages *and* in time (age of the oldest unprocessed message).
4. **Error / retry rate** — are consumers busy failing and retrying?

**Little's law** relates them: \`in-flight = throughput × latency\`. A consumer doing 50 ms of I/O per message at concurrency 1 caps at **20 msgs/s**; to do 2,000/s you need ~100 messages in flight (across partitions or with per-key concurrency). This is the first calculation for any "consumer is too slow" problem.

**Lag in time is what users feel:** "notifications are 40 minutes late" is time lag. Message-count lag is misleading across topics with different rates — 1M messages is 10 seconds on a 100K/s topic and 3 hours on a 100/s one.

**Failure-mode map (each is a section below):**
| Symptom | Likely scenario |
|---|---|
| HTTP timeouts on a slow endpoint | synchronous work that should be async (202) |
| lag spikes with traffic, recovers later | load leveling working as designed — check drain time |
| lag grows steadily, traffic flat | consumer slower than producer / downstream saturated |
| lag on ONE partition | hot key or stuck poison pill |
| duplicates in DB, double emails | at-least-once without idempotency |
| same message failing forever | poison pill without DLQ |
| wrong final state | ordering broken by retries/parallelism |`,
      diagram: `         produce rate                consume rate
  producers -------> [||||||| lag |||||||] -------> consumers --> DB/API
                      ^ age of oldest msg = time lag    |
                                                        '-- error/retry rate

  lag growth = in − out.   in-flight = throughput × latency (Little's law)`,
      keyPoints: [
        'Always look at produce rate, consume rate, lag (count and time) and error rate together.',
        'Little\'s law gives the concurrency you need for a target throughput.',
        'Per-partition lag distinguishes hot keys/poison pills from global slowness.',
      ],
    },
    {
      heading: 'Scenario: the API takes 10 seconds → 202 Accepted, polling and webhooks',
      body: `**Symptoms:** p99 of \`POST /reports\` is 10–40 s; LB/gateway timeouts (often 30–60 s) produce 504s; clients retry, creating duplicate work; worker threads/connections are pinned; one slow dependency slows the whole service.

**Root cause:** long-running work (PDF/export generation, video transcoding, bulk imports, ML inference, third-party calls) is done inside the request.

**Fix — the async request-reply pattern:**
1. \`POST /reports\` validates, persists a job (\`PENDING\`) idempotently (using the client's \`Idempotency-Key\`), enqueues a message, and returns **202 Accepted** with \`Location: /reports/jobs/{id}\` and \`Retry-After: 5\`.
2. Workers consume, process, update status (\`RUNNING → SUCCEEDED/FAILED\`) and store the result (e.g., S3 key).
3. The client **polls** \`GET /reports/jobs/{id}\` → \`{ status, progress, resultUrl }\` (resultUrl can be a presigned S3 link). When done, return 200 with the result link, or 303 See Other to the result resource.
4. Or the server calls a **webhook** the client registered: sign the payload (HMAC-SHA256 with a timestamp to prevent replay), include an event id for receiver-side dedup, retry with exponential backoff for up to ~24–72 h, and provide a way to re-fetch missed events. For browsers, push via WebSocket/SSE instead.

**Polling vs webhooks:**
| | Polling | Webhooks |
|---|---|---|
| Client complexity | trivial | needs a public, secured endpoint |
| Latency to notice | ≤ poll interval | near real-time |
| Server load | N polls per job (use Retry-After, ETag/304) | 1+ deliveries per job |
| Failure handling | client-driven | sender retries, receiver dedupes |

**Numbers:** at 200 jobs/s with clients polling every 2 s for a 10 s job, that's ~1,000 status reads/s — cache status in Redis or serve from a replica.

**In interviews say this:** "Anything over a second or two, or anything dependent on a flaky third party, becomes a job: 202 with a status resource, idempotent creation, and webhook or push notification on completion."`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS: 202 Accepted + status resource with idempotent job creation',
          code: `@Controller('reports')
export class ReportsController {
  constructor(private readonly jobs: JobsRepo, private readonly queue: SqsClient) {}

  @Post()
  @HttpCode(202)
  async create(
    @Headers('idempotency-key') idemKey: string,
    @Body() dto: CreateReportDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idemKey) throw new BadRequestException('Idempotency-Key header required');
    // INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING *, else SELECT existing
    const { job, created } = await this.jobs.createOrGet(idemKey, dto);
    if (created) {
      await this.queue.send(new SendMessageCommand({
        QueueUrl: process.env.REPORTS_QUEUE_URL!,
        MessageBody: JSON.stringify({ jobId: job.id }),
      })); // if this fails, a sweeper re-enqueues PENDING jobs older than 1 min
    }
    res.setHeader('Location', '/reports/jobs/' + job.id);
    res.setHeader('Retry-After', '5');
    return { jobId: job.id, status: job.status };
  }

  @Get('jobs/:id')
  async status(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const job = await this.jobs.get(id);
    if (!job) throw new NotFoundException();
    if (job.status === 'PENDING' || job.status === 'RUNNING') res.setHeader('Retry-After', '5');
    return {
      status: job.status,
      progress: job.progress,
      resultUrl: job.status === 'SUCCEEDED' ? await presign(job.resultKey, 900) : undefined,
      error: job.status === 'FAILED' ? job.errorCode : undefined,
    };
  }
}`,
        },
        {
          language: 'typescript',
          title: 'Signing a webhook so receivers can verify and dedupe',
          code: `import { createHmac, timingSafeEqual } from 'node:crypto';

export function signWebhook(secret: string, eventId: string, body: string, ts = Date.now()) {
  const payload = ts + '.' + body;                       // timestamp binds signature to time
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return {
    'Webhook-Id': eventId,                               // receiver dedupes on this
    'Webhook-Timestamp': String(ts),
    'Webhook-Signature': 'v1=' + sig,
  };
}

export function verifyWebhook(secret: string, headers: Record<string, string>, body: string) {
  const ts = Number(headers['webhook-timestamp']);
  if (Math.abs(Date.now() - ts) > 5 * 60_000) return false; // reject replays older than 5 min
  const expected = createHmac('sha256', secret).update(ts + '.' + body).digest();
  const given = Buffer.from((headers['webhook-signature'] ?? '').replace('v1=', ''), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}`,
        },
      ],
      keyPoints: [
        '202 + Location + Retry-After; the job resource is the source of truth.',
        'Job creation must be idempotent, or client retries create duplicate jobs.',
        'Webhooks: HMAC signature with a timestamp, event id for dedup, sender retries with backoff.',
      ],
    },
    {
      heading: 'Scenario: traffic spikes 10× → queue buffering and load leveling',
      body: `**Symptoms (without a queue):** the database hits 100% CPU, connection pools exhaust, latency cascades into timeouts, retries amplify the spike, and the whole service falls over — even though the average daily load is fine.

**Root cause:** synchronous coupling means downstream capacity must match **peak** load, not average.

**Fix — put a queue in front of the expensive part and drain at a sustainable rate:**
- Producers enqueue quickly (a Kafka append costs ~ms). Consumers process at the rate the DB can handle. The spike turns into **temporary lag** instead of an outage.
- **Capacity math:** backlog = (spike rate − consumer capacity) × spike duration; drain time = backlog ÷ (consumer capacity − post-spike rate). Example: normal 2K/s, spike 20K/s for 15 min, capacity 5K/s → backlog 13.5M, drain ≈ 75 min at 3K/s net.
- **Retention must cover spike + drain** with margin. SQS max is 14 days; Kafka is whatever you configure — but check disk.
- **Is the lag acceptable?** Load leveling trades latency for survival. For "send receipt email" 75 minutes may be OK; for "payment authorized" it isn't — those need real capacity or prioritisation.

**Make it better:**
- **Priority lanes:** separate topics/queues for critical vs bulk traffic (\`orders.critical\`, \`orders.bulk\`), each with its own consumers, so a bulk import can't starve checkouts.
- **Autoscale consumers on lag** (KEDA) up to the partition count and the downstream limit.
- **Admission control at the edge:** rate-limit per client and shed low-value traffic (return 429/503 with Retry-After) before it enters the queue if the backlog is beyond what you can drain in your SLO.
- **Coalesce:** many updates to the same entity (e.g., "recompute cart total") can be merged — process the latest only.

**Anti-pattern:** a queue in front of a synchronous user request that then *waits* for the result. You get all the latency of queueing and none of the decoupling — the gateway still times out.`,
      diagram: `  rate
  20K |      ________________               produce rate (spike 15 min)
      |     |                |
   5K |- - -|- - - - - - - - |- - - - - - - - - - - -   consumer capacity
   2K |_____|                |______________________    normal produce rate
      +-----+----------------+--------------------+---> time
            t0              t0+15m            t0+90m
  backlog grows at 15K/s -> 13.5M msgs ; drains at 3K/s -> ~75 min`,
      code: [
        {
          language: 'yaml',
          title: 'KEDA: autoscale consumers on Kafka lag, capped at partition count',
          code: `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-projector
spec:
  scaleTargetRef:
    name: order-projector          # Deployment of consumers
  minReplicaCount: 4
  maxReplicaCount: 48              # = partitions of orders.v1; more would idle
  cooldownPeriod: 300              # avoid flapping (each scale = a rebalance)
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka-0:9092,kafka-1:9092
        consumerGroup: order-projector
        topic: orders.v1
        lagThreshold: '5000'       # target lag per replica
        allowIdleConsumers: 'false'
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 600`,
        },
      ],
      keyPoints: [
        'Queues let downstream capacity match average plus drain, not peak.',
        'Compute backlog and drain time; ensure retention covers both.',
        'Separate priority lanes; shed load at the edge if the backlog is beyond the SLO.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 4 (decoupling, buffering)',
    },
    {
      heading: 'Scenario: the consumer is slower than the producer',
      body: `**Symptoms:** lag grows steadily even at normal traffic; time-lag alerts; downstream data (search index, balances view) visibly stale.

**Root causes, from most to least common:**
1. **Per-message I/O at concurrency 1:** 30 ms DB write per message → 33 msgs/s per partition. Little's law says you need more in flight.
2. **Downstream saturation:** the DB/API behind the consumer is at its limit — more consumers make it worse.
3. **Not enough partitions** for the number of consumers you need.
4. **Rebalance churn** or **retries** consuming capacity (see other sections).

**Fixes (in the order I'd try them):**
- **Batch the downstream work:** one multi-row \`INSERT ... ON CONFLICT\` per 500 messages instead of 500 single inserts often gives **10–50×**. Kafka \`eachBatch\` and SQS \`ReceiveMessage\` with 10 messages are built for this.
- **Concurrency across partitions:** kafkajs \`partitionsConsumedConcurrently\`, multiple consumers.
- **Concurrency within a partition, serialized per key:** process different keys in parallel, same key in order, and commit only up to the lowest unfinished offset. This lifts the "max consumers = partitions" ceiling (Confluent Parallel Consumer does this).
- **Scale consumers** up to the partition count; add partitions if needed (mind key remapping for ordered topics).
- **Make each message cheaper:** avoid per-message HTTP calls (cache reference data), drop unnecessary work, and use projection-friendly schemas.
- **If downstream is the bottleneck:** scale it, batch it, or accept lag. Never let consumer autoscaling DDoS your own database.

**Monitor:** per-partition lag, records-consumed-rate, processing time per batch, and downstream saturation (DB CPU, connection waits). Lag exporters: kafka-lag-exporter, Burrow, CloudWatch \`ApproximateAgeOfOldestMessage\` for SQS.`,
      code: [
        {
          language: 'typescript',
          title: 'Batch consumer: one DB round-trip per batch (idempotent upsert)',
          code: `await consumer.run({
  autoCommit: false,
  eachBatchAutoResolve: false,
  partitionsConsumedConcurrently: 6,
  eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isStale }) => {
    const CHUNK = 500;
    for (let i = 0; i < batch.messages.length; i += CHUNK) {
      if (isStale()) return;
      const chunk = batch.messages.slice(i, i + CHUNK);
      const rows = chunk.map((m) => JSON.parse(m.value!.toString()) as PriceUpdate);

      // Collapse to the latest version per product inside the chunk
      const latest = new Map<string, PriceUpdate>();
      for (const r of rows) {
        const prev = latest.get(r.productId);
        if (!prev || prev.version < r.version) latest.set(r.productId, r);
      }
      const vals = [...latest.values()];
      await pg.query(
        'INSERT INTO prices (product_id, price, version) ' +
          'SELECT * FROM unnest($1::text[], $2::numeric[], $3::bigint[]) ' +
          'ON CONFLICT (product_id) DO UPDATE SET price = EXCLUDED.price, version = EXCLUDED.version ' +
          'WHERE prices.version < EXCLUDED.version',   // idempotent + order-safe
        [vals.map((v) => v.productId), vals.map((v) => v.price), vals.map((v) => v.version)],
      );
      resolveOffset(chunk[chunk.length - 1].offset);
      await heartbeat();
    }
    await commitOffsetsIfNecessary();
  },
});`,
        },
      ],
      keyPoints: [
        'Batching downstream writes is usually the biggest win.',
        'Per-key concurrency within a partition lifts the partition ceiling.',
        'If the DB is the bottleneck, more consumers make it worse.',
      ],
    },
    {
      heading: 'Scenario: the queue keeps growing — a triage runbook',
      body: `**Intuition:** before touching anything, find out whether the tap got faster, the drain got slower, or the drain is clogged with the same thing over and over.

**Step-by-step triage (what I'd say in an incident call):**
1. **Is it everywhere or one partition/queue?** One partition → hot key or stuck poison pill. All partitions → systemic.
2. **Produce rate vs baseline:** a spike (campaign, retry storm from an upstream, a bug publishing in a loop)? If the spike is legitimate → load leveling; compute drain time.
3. **Consume rate vs baseline:** dropped? Check consumer health — crashes/OOM, rebalance loop (rebalance-rate metric), CPU throttling, recent deploy.
4. **Error and retry rate:** consumers busy but not progressing → failing messages being retried in place. Look for a new error class in logs.
5. **Downstream saturation:** DB CPU/locks, API p99, 429s. Consumers waiting on a slow dependency show low CPU but high processing time.
6. **Recent changes:** deploy of consumer or producer, schema change (new field breaking deserialization), config change (max.poll.records, concurrency).

**Mitigations by cause:**
| Cause | Immediate | Durable |
|---|---|---|
| Legit spike | scale consumers ≤ partitions, pause low-priority consumers | priority lanes, capacity plan |
| Producer bug/loop | throttle producer quota (Kafka client quotas), fix/rollback | producer rate limits, alerts on produce rate |
| Poison pill | skip to DLQ, redeploy with fix | DLQ + error classification |
| Rebalance loop | increase max.poll.interval temporarily, reduce batch size | cooperative-sticky, static membership |
| Downstream slow | reduce concurrency, circuit-break | batching, bulkheads, capacity |
| Consumer bug after deploy | rollback | canary consumers, contract tests |

**Two things not to do:** blindly scale consumers (DB meltdown), and blindly purge the queue (data loss). If you must drop data, divert to a parking topic/queue so you can replay later.`,
      code: [
        {
          language: 'bash',
          title: 'First commands in a lag incident',
          code: `# Per-partition lag for the group (LAG column; look for skew)
kafka-consumer-groups.sh --bootstrap-server kafka-0:9092 \\
  --describe --group order-projector

# Are members stable? (state should be Stable, not PreparingRebalance)
kafka-consumer-groups.sh --bootstrap-server kafka-0:9092 \\
  --describe --group order-projector --state --members

# SQS: backlog and age of the oldest message (time lag)
aws cloudwatch get-metric-statistics --namespace AWS/SQS \\
  --metric-name ApproximateAgeOfOldestMessage \\
  --dimensions Name=QueueName,Value=email-jobs \\
  --statistics Maximum --period 60 \\
  --start-time "$(date -u -v-1H +%FT%TZ)" --end-time "$(date -u +%FT%TZ)"

# Temporarily cap a runaway producer (bytes/s) with a Kafka client quota
kafka-configs.sh --bootstrap-server kafka-0:9092 --alter \\
  --add-config 'producer_byte_rate=5242880' \\
  --entity-type clients --entity-name buggy-importer`,
        },
      ],
      keyPoints: [
        'Localize first: one partition vs all.',
        'Compare produce and consume rates to baseline, then errors, then downstream.',
        'Never blindly scale consumers or purge queues.',
      ],
    },
    {
      heading: 'Scenario: the consumer crashes mid-processing',
      body: `**Symptoms:** after OOM kills, node drains or deploys: some messages are **missing** (never processed), or some are **processed twice**.

**Root cause:** the acknowledgment (Kafka offset commit, SQS \`DeleteMessage\`, RabbitMQ \`ack\`) and the side effect are two separate steps; a crash between them decides between loss and duplication.

| Order of operations | Crash between them | Result |
|---|---|---|
| ack → process | processing never happened | **loss** (at-most-once) |
| process → ack | processed but not acked | **duplicate** on redelivery (at-least-once) |

**Fix:** always **process, then ack**, and make processing idempotent (next section). Platform specifics:
- **Kafka:** \`autoCommit: false\` or ensure the handler awaits all work before returning; commit after processing; on SIGTERM call \`consumer.disconnect()\` so the group rebalances immediately rather than after \`session.timeout.ms\`.
- **SQS:** delete only after success. **Visibility timeout** must exceed p99 processing time (default 30 s is often too low); for long jobs run a heartbeat that calls \`ChangeMessageVisibility\`. If the worker dies, the message reappears after the timeout and goes to the DLQ after \`maxReceiveCount\`.
- **RabbitMQ:** manual acks (\`noAck: false\`); unacked messages are redelivered when the channel/connection closes, flagged \`redelivered=true\`.

**Graceful shutdown on Kubernetes:** SIGTERM → stop fetching new messages → finish in-flight (bounded by \`terminationGracePeriodSeconds\`, default 30 s) → commit/delete → disconnect. Make the grace period > p99 processing time, or make in-flight work abortable.

**Long jobs (minutes to hours):** checkpoint progress (e.g., "rows 0–50K imported") so a retry resumes rather than restarts; or split into smaller messages.`,
      code: [
        {
          language: 'typescript',
          title: 'SQS worker: delete after success, heartbeat visibility, graceful stop',
          code: `import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand,
  ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});
const QueueUrl = process.env.QUEUE_URL!;
let stopping = false;
process.once('SIGTERM', () => { stopping = true; });   // finish in-flight, fetch no more

async function heartbeat(receiptHandle: string) {
  // extend visibility by 60s every 30s while the job runs
  const t = setInterval(() => {
    sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl, ReceiptHandle: receiptHandle,
      VisibilityTimeout: 60 })).catch(() => {});
  }, 30_000);
  return () => clearInterval(t);
}

while (!stopping) {
  const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({
    QueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, VisibilityTimeout: 60,
  }));
  await Promise.all(Messages.map(async (m) => {
    const stop = await heartbeat(m.ReceiptHandle!);
    try {
      await processJob(JSON.parse(m.Body!));             // idempotent
      await sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: m.ReceiptHandle! }));
    } catch (err) {
      logger.warn({ err, id: m.MessageId }, 'job failed; will reappear after visibility timeout');
    } finally {
      stop();
    }
  }));
}`,
        },
      ],
      keyPoints: [
        'Process then ack; the reverse loses messages.',
        'SQS visibility timeout > p99 processing, or heartbeat it.',
        'Graceful shutdown: stop fetching, finish in-flight, commit, disconnect.',
      ],
    },
    {
      heading: 'Scenario: a message is processed twice → idempotent consumers',
      body: `**Symptoms:** duplicate rows, double emails/SMS, double loyalty points, balances off by exactly one event — usually clustered around deploys, rebalances or broker failovers.

**Root cause:** at-least-once delivery is the default everywhere (Kafka commit-after-process, SQS standard, RabbitMQ redelivery, producer retries, upstream double-publish). Duplicates are not a bug in the broker; non-idempotent handlers are the bug.

**Idempotency techniques (pick per side effect):**
1. **Naturally idempotent operations:** \`SET status = 'SHIPPED'\`, upserts by natural key, \`PUT\` semantics. Replace increments (\`points = points + 10\`) with event-keyed facts (\`INSERT INTO point_grants (event_id, ...)\`) and derive totals.
2. **Dedup table in the same transaction as the effect:** \`INSERT INTO processed_events (consumer, event_id) ... ON CONFLICT DO NOTHING\`; if 0 rows, skip; else do the effect; commit both together. Crash anywhere → either both or neither.
3. **Version guards:** apply only if \`incoming.version > stored.version\` — handles duplicates *and* reordering.
4. **Offset-as-dedup (Kafka → DB):** store the last applied offset per partition in the same transaction; skip messages with offset ≤ stored. O(partitions) state instead of O(messages).
5. **External side effects:** pass a deterministic idempotency key (\`hash(consumer + eventId)\`) to the provider (Stripe, many email/SMS APIs). If the provider has none, record intent + status (\`SENDING\` → \`SENT\`) and accept a tiny at-most-once or at-least-once window by business choice.

**What the dedup key should be:** a producer-assigned **event id** (UUID in the envelope), *not* the Kafka offset (a producer retry or re-publish creates a new offset for the same event) and *not* a hash of the payload (two genuine identical events would collapse).

**Dedup window:** as long as duplicates can arrive — broker redelivery is short, but replays/DLQ redrives can come days later. For long windows prefer version guards and natural keys over giant dedup tables.

**Redis \`SET NX\` as a dedup store** is fine for low-stakes effects, but it is *separate* from your DB transaction: set-then-crash-before-effect loses the message; effect-then-crash-before-set duplicates it. Use it as a best-effort filter, not the guarantee.`,
      code: [
        {
          language: 'typescript',
          title: 'Idempotent handler: dedup row and side effect in one transaction',
          code: `export async function handleOrderPaid(pool: Pool, evt: OrderPaidEvent): Promise<'applied' | 'duplicate'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dedup = await client.query(
      'INSERT INTO processed_events (consumer, event_id, processed_at) VALUES ($1, $2, now()) ' +
        'ON CONFLICT (consumer, event_id) DO NOTHING',
      ['loyalty-service', evt.eventId],
    );
    if (dedup.rowCount === 0) {        // someone (maybe a concurrent redelivery) already did it
      await client.query('ROLLBACK');
      return 'duplicate';
    }

    // Effect is a fact keyed by the event, not a blind increment
    await client.query(
      'INSERT INTO point_grants (event_id, customer_id, points) VALUES ($1, $2, $3)',
      [evt.eventId, evt.customerId, Math.floor(evt.amountMinor / 100)],
    );
    await client.query(
      'UPDATE loyalty_accounts SET balance = balance + $2 WHERE customer_id = $1',
      [evt.customerId, Math.floor(evt.amountMinor / 100)],
    );
    await client.query('COMMIT');      // dedup marker and effect become visible together
    return 'applied';
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;                           // not acked -> redelivered -> safe to retry
  } finally {
    client.release();
  }
}
// processed_events: PRIMARY KEY (consumer, event_id); partition by day and drop after N days`,
        },
      ],
      keyPoints: [
        'At-least-once is the default; idempotent handlers are the fix.',
        'The dedup marker must commit atomically with the effect.',
        'Dedup on producer-assigned event ids, not offsets or payload hashes.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 11 (idempotency)',
    },
    {
      heading: 'Scenario: repeated failures → retry topics, DLQ, poison pills and redrive',
      body: `**Symptoms:** one partition's lag grows forever while others are fine (a **poison pill** is being retried in place); or CPU is high with no progress; or failed messages silently disappear.

**Root causes:** no distinction between transient and permanent errors; in-place infinite retry that blocks the partition; no DLQ; or a DLQ nobody watches.

**Classify errors first:**
| Class | Examples | Action |
|---|---|---|
| Transient | timeout, 503, 429, deadlock, broker leader change | retry with backoff |
| Permanent | schema/deserialization error, validation failure, 400/404/422, business rule violated | **no retry** → DLQ immediately |
| Unknown | unexpected exception | limited retries → DLQ |

**The tiered retry design (Uber-style, also the classic payment retry queue):**
1. **In-place retry** 2–3 times with short backoff (100 ms–1 s) for blips.
2. On continued failure, publish to **\`topic.retry.1m\`** with headers: original topic/partition/offset, attempt count, error, \`not-before\` timestamp. Commit the original offset — the main partition keeps flowing.
3. Retry consumers **pause** until \`not-before\` (don't \`sleep\` inside the handler — it breaks poll/heartbeat deadlines), then reprocess; on failure forward to \`retry.10m\`, \`retry.1h\`.
4. After the last tier → **DLQ** (\`topic.dlq\`) with full context. **Alert** on DLQ rate, and track DLQ age.
5. **Redrive tooling:** after fixing the bug, replay DLQ messages back to the main (or first retry) topic, rate-limited, with the same event ids so idempotent handlers ignore anything already applied.

**SQS/RabbitMQ equivalents:** SQS redrive policy (\`maxReceiveCount\` → DLQ) plus native DLQ redrive; per-message backoff via \`ChangeMessageVisibility\` on failure. RabbitMQ: DLX + per-queue TTL for delay tiers, or quorum queue \`x-delivery-limit\`.

**Retry storms:** when a dependency is fully down, retries multiply load on recovery. Use exponential backoff with jitter, a circuit breaker that pauses consumption while the dependency is unhealthy, and retry budgets.`,
      diagram: `   orders.v1 --> [main consumer] --ok--> done
                        | transient fail (after 3 quick tries)
                        v
               orders.retry.1m --> [retry consumer: pause until not-before]
                        | fail
                        v
               orders.retry.10m --> ... --> orders.retry.1h
                        | fail / or permanent error from any stage
                        v
                   orders.dlq  --> alert + dashboard + redrive tool`,
      code: [
        {
          language: 'typescript',
          title: 'Retry-topic consumer: classify, forward with headers, pause until due',
          code: `const TIERS = ['orders.retry.1m', 'orders.retry.10m', 'orders.retry.1h'];
const DELAY_MS: Record<string, number> = { 'orders.retry.1m': 60_000, 'orders.retry.10m': 600_000, 'orders.retry.1h': 3_600_000 };

async function forward(msg: KafkaMessage, fromTopic: string, err: Error, attempt: number) {
  const permanent = err instanceof ValidationError || err instanceof SyntaxError;
  const idx = TIERS.indexOf(fromTopic);                 // -1 when coming from the main topic
  const next = permanent || idx === TIERS.length - 1 ? 'orders.dlq' : TIERS[idx + 1];
  await producer.send({ topic: next, messages: [{
    key: msg.key, value: msg.value,
    headers: {
      ...msg.headers,
      'x-attempt': String(attempt + 1),
      'x-error': err.message.slice(0, 500),
      'x-original-topic': (msg.headers?.['x-original-topic'] as Buffer | undefined)?.toString() ?? fromTopic,
      'x-not-before': String(Date.now() + (DELAY_MS[next] ?? 0)),
    },
  }] });
}

// One consumer group for all retry tiers
await retryConsumer.run({
  eachMessage: async ({ topic, partition, message, pause }) => {
    const due = Number(message.headers?.['x-not-before']?.toString() ?? 0);
    const wait = due - Date.now();
    if (wait > 0) {
      const resume = pause();                           // pause THIS partition only
      setTimeout(resume, Math.min(wait, 60_000));       // re-poll later; same offset refetched
      throw new Error('not due yet');                   // don't commit this offset
    }
    const attempt = Number(message.headers?.['x-attempt']?.toString() ?? 1);
    try {
      await handleOrder(JSON.parse(message.value!.toString()));   // idempotent
    } catch (err) {
      await forward(message, topic, err as Error, attempt);       // then offset is committed
    }
  },
});`,
        },
      ],
      keyPoints: [
        'Classify: transient → retry with backoff; permanent → DLQ immediately.',
        'Retry topics keep the main partition flowing; pause, don\'t sleep, until due.',
        'A DLQ needs alerts, context headers and a redrive tool — or it\'s a black hole.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 11 (retry queue and dead letter queue)',
    },
    {
      heading: 'Scenario: ordering is required — keys, per-key serialization and sequence numbers',
      body: `**Symptoms:** an order shows \`PAID\` then flips back to \`PENDING\`; a withdrawal is applied before the deposit; a deleted item reappears.

**Root causes:**
- No key (or the wrong key) → related events on different partitions.
- Consumer parallelism inside a partition (Promise.all over a batch).
- **Retries reorder:** event v2 fails and goes to the retry topic, v3 succeeds, then v2 is applied an hour later → state regresses.
- Multiple producers for the same entity, or partitions added.
- SQS standard (no ordering) where FIFO was needed.

**Fixes:**
1. **Key by the entity whose order matters** (orderId, accountId). Ordering scope as small as the business allows.
2. **Per-key serialization when parallelizing:** a keyed work queue where each key's messages run one at a time, different keys in parallel (see code). Commit only up to the lowest unfinished offset.
3. **Sequence numbers / versions** in every event, assigned by the single writer of that entity; consumers apply only if \`version = stored + 1\` (strict: detect gaps) or \`version > stored\` (last-writer-wins: fine for state snapshots).
4. **Order-preserving retries:**
   - **Blocking retry:** retry in place, stall the partition. Correct but one bad message blocks all keys in that partition — acceptable only with short, bounded retries.
   - **Key parking:** when a key's message goes to retry, record the key as "parked"; subsequent messages for that key also go to the retry path until the parked message resolves. Other keys continue. More complex, but preserves order without blocking the partition.
   - **Version guard + reconcile:** let out-of-order retries happen but reject stale versions; a late v2 after v3 is simply ignored.
5. **SQS FIFO:** \`MessageGroupId = entityId\` gives per-group order; a failing message **blocks its group** until it succeeds or is moved to the DLQ.

**In interviews say this:** "I order per entity, not globally. Producers key by entity id and stamp a version; consumers serialize per key and ignore stale versions, so even retries or replays can't regress state."`,
      code: [
        {
          language: 'typescript',
          title: 'Per-key serialized concurrency inside one partition',
          code: `// Different keys run in parallel; the same key runs strictly in order.
export class KeyedExecutor {
  private chains = new Map<string, Promise<void>>();
  private inFlight = 0;
  constructor(private readonly maxInFlight = 200) {}

  get saturated() { return this.inFlight >= this.maxInFlight; } // backpressure signal

  submit(key: string, task: () => Promise<void>): Promise<void> {
    this.inFlight++;
    const prev = this.chains.get(key) ?? Promise.resolve(); // tails never reject
    const run = prev.then(task);                            // caller sees success/failure
    // tail swallows errors so one failure doesn't poison later tasks for this key
    const tail: Promise<void> = run.then(() => {}, () => {}).then(() => {
      this.inFlight--;
      if (this.chains.get(key) === tail) this.chains.delete(key); // last in chain: clean up
    });
    this.chains.set(key, tail);
    return run;
  }
}

// Usage in eachBatch: submit all, await all, then commit the batch.
// const exec = new KeyedExecutor(200);
// await Promise.all(batch.messages.map((m) =>
//   exec.submit(m.key!.toString(), () => applyWithVersionGuard(m))));
// resolveOffset(lastOffset); await commitOffsetsIfNecessary();`,
        },
      ],
      keyPoints: [
        'Key by the entity; order is per partition only.',
        'Retry topics reorder — use key parking or version guards.',
        'SQS FIFO blocks a message group until the failing message succeeds or is dead-lettered.',
      ],
    },
    {
      heading: 'Scenario: one consumer is a bottleneck / hot Kafka partition',
      body: `**Symptoms:** total lag is dominated by **one partition**; one consumer pod pegged at 100% CPU while others idle; broker bytes-in skewed toward one leader; adding consumers changes nothing.

**Root causes:**
- **Hot key:** one tenant/merchant/celebrity produces a big share of traffic (e.g., one merchant = 40% of payments), and \`hash(key)\` pins all of it to one partition → one consumer.
- **Poor key choice:** low-cardinality keys (country, status) → a handful of partitions carry everything.
- **Uneven assignment:** partition count not divisible by consumer count (48 partitions, 20 consumers → some own 3, some 2), or eager assignors after churn.
- **One slow consumer instance** (noisy neighbour node, CPU throttled).

**Fixes and their trade-offs:**
| Fix | How | Cost |
|---|---|---|
| Better key | key by orderId instead of merchantId | lose per-merchant ordering (usually fine if per-order is enough) |
| **Salt hot keys only** | \`merchantId + '#' + (hash(orderId) % 8)\` for known hot merchants | per-merchant order lost across 8 sub-streams; aggregations need a merge step |
| Dedicated topic/partitions for the whale | route tenant X to \`payments.tenant-x\` with its own consumers | routing logic, more topics |
| Per-key concurrency within the partition | KeyedExecutor (previous section) — if the hot partition has many distinct keys | doesn't help if it's literally one key |
| Custom partitioner | map known hot keys to a spread of partitions | must be identical in every producer |
| Rebalance assignment | partitions divisible by consumer count; cooperative-sticky | — |

**If ordering per hot key is required and one key exceeds one consumer's throughput:** you must make per-message work cheaper (batching, in-memory aggregation, e.g., sum 1,000 events into one DB update) — no partitioning trick can parallelize a strictly serial stream.

**Detect early:** per-partition bytes-in and lag dashboards; top-N keys by volume via sampling the producer or a stream job.`,
      code: [
        {
          language: 'typescript',
          title: 'Salting only known hot keys, with a merge on read',
          code: `import { createHash } from 'node:crypto';

const HOT_MERCHANTS = new Set(['m_amazon', 'm_flipkart']); // from config / top-N job
const SALT_BUCKETS = 8;

function bucket(s: string, n: number) {
  return createHash('md5').update(s).digest().readUInt32BE(0) % n;
}

// Per-ORDER ordering is preserved (same order -> same bucket -> same partition);
// per-MERCHANT ordering is deliberately given up for hot merchants only.
export function partitionKey(evt: PaymentEvent): string {
  if (!HOT_MERCHANTS.has(evt.merchantId)) return evt.merchantId;
  return evt.merchantId + '#' + bucket(evt.orderId, SALT_BUCKETS);
}

// Downstream per-merchant aggregates are computed per salted sub-key, then merged:
// SELECT merchant_id, SUM(amount) FROM merchant_totals_by_subkey GROUP BY merchant_id;`,
        },
      ],
      keyPoints: [
        'Detect skew with per-partition lag and bytes-in.',
        'Salt only hot keys and choose the salt from a finer key (orderId) to keep that order.',
        'A single strictly-ordered key can only be sped up by making each message cheaper.',
      ],
    },
    {
      heading: 'Scenario: downstream is overwhelmed → backpressure end to end',
      body: `**Intuition:** backpressure is the drain telling the tap "slow down" — instead of the tub overflowing onto the floor (OOM, dropped messages, a melted database).

**Symptoms without backpressure:** consumer memory grows until OOM (an unbounded in-process buffer); the downstream API returns 429/503 and retries amplify it; database connection pool waits climb; the whole pipeline oscillates between overload and idle.

**Where backpressure lives in each layer:**
- **Broker → consumer:** pull-based brokers (Kafka, SQS) give it for free *if* you don't pull faster than you process. With RabbitMQ push, **prefetch** is the valve.
- **Inside the consumer:** bounded concurrency (\`p-limit\`, KeyedExecutor with \`maxInFlight\`); when saturated, **pause** the partition (kafkajs \`consumer.pause([{ topic, partitions }])\`) and **resume** when capacity frees up. Heartbeats continue while paused.
- **Consumer → downstream:** honor \`429\` \`Retry-After\`; token-bucket rate limit your calls to the provider's quota; circuit-break when error rate spikes (stop consuming instead of burning retries).
- **Producer → broker:** Kafka producer blocks (\`buffer.memory\`, \`max.block.ms\`) when the broker can't keep up; client quotas throttle abusive producers.
- **Client → API:** when the backlog is beyond the SLO, the API returns **429/503 with Retry-After** at admission rather than accepting work it can't finish (load shedding).

**Adaptive concurrency:** start with N in flight; on success raise slowly, on 429/timeouts halve (AIMD, like TCP congestion control). Netflix's concurrency-limits library does exactly this.

**The anti-pattern:** "the queue is the backpressure" while the consumer reads everything into an in-memory array. The queue only helps if messages stay *in the queue* until you can process them.`,
      code: [
        {
          language: 'typescript',
          title: 'kafkajs: pause on saturation or 429, resume when healthy',
          code: `const limiter = new KeyedExecutor(100);        // max 100 in flight per pod

await consumer.run({
  autoCommit: false,
  eachBatchAutoResolve: false,
  eachBatch: async ({ batch, resolveOffset, commitOffsetsIfNecessary, pause, heartbeat }) => {
    const work: Promise<void>[] = [];
    for (const m of batch.messages) {
      if (limiter.saturated) break;               // stop pulling more work into memory
      work.push(limiter.submit(m.key!.toString(), () => callPartnerApi(m)));
    }
    const results = await Promise.allSettled(work);

    // Commit only the contiguous prefix that succeeded; the rest is refetched
    let lastOk: string | undefined;
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== 'fulfilled') break;
      lastOk = batch.messages[i].offset;
    }
    if (lastOk) resolveOffset(lastOk);
    await commitOffsetsIfNecessary();
    await heartbeat();

    const rateLimited = results.find(
      (r) => r.status === 'rejected' && (r.reason as any)?.status === 429);
    if (rateLimited) {
      const retryAfterMs = Number((rateLimited as PromiseRejectedResult).reason.retryAfter ?? 5) * 1000;
      const resume = pause();                      // pause this partition, keep group membership
      setTimeout(resume, retryAfterMs);
    }
  },
});`,
        },
      ],
      keyPoints: [
        'Backpressure must exist at every hop: broker, consumer, downstream, producer, client.',
        'Pause/resume partitions instead of buffering in memory.',
        'Honor 429 Retry-After; adapt concurrency with AIMD; shed load at admission.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'mq-scenarios-cc-1',
      title: 'Replace the infinite in-place retry with retry tiers and a DLQ',
      context: `The shipping-label consumer reads \`shipments.v1\` (12 partitions) and calls a carrier API. Last week the carrier rejected one malformed address and **partition 4 stopped moving for 9 hours**: 180K shipments stuck behind a single message. During a carrier outage the consumers also hammered the API at thousands of requests per second.`,
      task: 'Rewrite the consumer so a poison message cannot block its partition, transient failures back off without hammering the carrier, permanent failures are dead-lettered with enough context to fix and redrive, and nothing is silently lost.',
      starter: {
        language: 'typescript',
        title: 'shipping.consumer.ts (buggy)',
        code: `await consumer.run({
  eachMessage: async ({ message }) => {
    const shipment = JSON.parse(message.value!.toString());
    while (true) {                       // retry until it works
      try {
        const label = await carrier.createLabel(shipment);
        await db.query('UPDATE shipments SET label_url = $1 WHERE id = $2',
          [label.url, shipment.id]);
        return;
      } catch (err) {
        console.error('label failed, retrying', err);
        // no delay, no limit, no classification
      }
    }
  },
});`,
      },
      hints: [
        'Which errors will never succeed no matter how many times you retry? What should happen to those immediately?',
        'Waiting inside eachMessage blocks the partition and breaks poll/heartbeat deadlines. Where else could the message wait?',
        'Think about what a human needs to fix and redrive a DLQ message: original topic/partition/offset, error, attempt count. And how do you stop hammering a dead dependency?',
      ],
      solution: {
        language: 'typescript',
        title: 'shipping.consumer.ts (fixed)',
        code: `const RETRY_TOPICS = ['shipments.retry.1m', 'shipments.retry.15m', 'shipments.retry.2h'];
const breaker = new CircuitBreaker({ failureRateThreshold: 0.5, openMs: 30_000 });

function isPermanent(err: any): boolean {
  return err instanceof SyntaxError || err instanceof ValidationError ||
    (err?.status >= 400 && err?.status < 500 && err?.status !== 408 && err?.status !== 429);
}

async function processShipment(shipment: Shipment) {
  // Idempotency key: the carrier returns the same label for the same key
  const label = await breaker.exec(() =>
    carrier.createLabel(shipment, { idempotencyKey: 'label:' + shipment.id, timeoutMs: 5_000 }));
  await db.query('UPDATE shipments SET label_url = $1 WHERE id = $2 AND label_url IS NULL',
    [label.url, shipment.id]);
}

await consumer.run({
  eachMessage: async ({ topic, partition, message, pause }) => {
    let shipment: Shipment;
    try {
      shipment = JSON.parse(message.value!.toString());
    } catch (err) {
      return deadLetter(message, topic, partition, err as Error, 1); // poison: never retry
    }

    for (let attempt = 1; attempt <= 3; attempt++) {    // short in-place retries for blips
      try {
        return await processShipment(shipment);
      } catch (err: any) {
        if (err instanceof BreakerOpenError) {          // dependency down: stop consuming
          const resume = pause();
          setTimeout(resume, 30_000);
          throw err;                                    // offset not committed; refetched later
        }
        if (isPermanent(err)) return deadLetter(message, topic, partition, err, attempt);
        if (attempt < 3) await sleep(200 * 2 ** attempt + Math.random() * 100);
        else return sendToRetry(message, topic, partition, err, RETRY_TOPICS[0]);
      }
    }
  },
});

async function sendToRetry(m: KafkaMessage, topic: string, partition: number, err: Error, next: string) {
  await producer.send({ topic: next, messages: [{ key: m.key, value: m.value, headers: {
    ...m.headers, 'x-original-topic': topic, 'x-original-partition': String(partition),
    'x-original-offset': m.offset, 'x-attempt': '1', 'x-error': err.message.slice(0, 500),
    'x-not-before': String(Date.now() + 60_000),
  } }] });                                             // awaited: only then is the offset committed
}

async function deadLetter(m: KafkaMessage, topic: string, partition: number, err: Error, attempt: number) {
  await producer.send({ topic: 'shipments.dlq', messages: [{ key: m.key, value: m.value, headers: {
    ...m.headers, 'x-original-topic': topic, 'x-original-partition': String(partition),
    'x-original-offset': m.offset, 'x-attempt': String(attempt),
    'x-error-class': err.constructor.name, 'x-error': err.message.slice(0, 500),
    'x-failed-at': new Date().toISOString(),
  } }] });
  metrics.increment('shipments.dlq', { errorClass: err.constructor.name }); // alert on rate
}
// Retry-tier consumers pause until x-not-before, then run processShipment and forward
// to the next tier or the DLQ. A redrive CLI replays DLQ messages to shipments.v1 at a capped rate.`,
      },
      explanation: `**Fixes**
- **Poison pill blocking a partition:** the \`while (true)\` retried a permanently invalid message forever. Errors are now classified: parse, validation and 4xx errors (except 408/429) go straight to the DLQ, and the partition moves on.
- **Hammering a failing dependency:** zero-delay retries turned an outage into a self-inflicted DDoS. Now there are at most 3 quick retries with exponential backoff and jitter, then off-path retry topics with growing delays. A **circuit breaker** pauses the partition while the carrier is down, instead of burning messages through retries.
- **Long waits inside the handler:** delays of minutes or hours happen in retry topics (consumers pause until \`x-not-before\`), so poll and heartbeat deadlines are never violated.
- **Nothing silently lost:** each hand-off to a retry topic or DLQ is awaited before the offset is committed. If that publish fails, the handler throws and the message is refetched.
- **Actionable DLQ:** headers carry the original topic/partition/offset, error class and message, and attempt count; a DLQ-rate metric drives alerting; redrive replays at a capped rate.
- **Idempotency:** the carrier idempotency key and the conditional UPDATE (\`label_url IS NULL\`) make retries, redrives and duplicate deliveries safe.
- **Trade-off:** retry topics break per-key ordering. That is acceptable here because label creation for different shipments is independent, and each shipment's label is a single idempotent operation.`,
      followUps: [
        {
          "q": "The DLQ now holds 2,000 shipments with bad addresses. Ops fixes them in the source system. Design the redrive so it is safe and doesn't swamp the carrier.",
          "a": "Build a redrive CLI that reads DLQ messages filtered by error class and time range. For each one, re-fetch the corrected shipment from the source of truth by id instead of replaying the stale payload, then publish it to `shipments.v1` with a header `x-redrive-of: <original offset>`. Rate-limit it (for example 20/s against the carrier's limits). The carrier idempotency key `label:<id>` plus the `label_url IS NULL` guard make re-processing safe for shipments that somehow succeeded. Record the outcome per message (redriven, failed again, skipped) and only treat a message as handled once it is confirmed processed."
        },
        {
          "q": "How do you monitor this pipeline so a stuck retry tier or a broken classifier is noticed within minutes?",
          "a": "Metrics per topic and tier: consumer time lag for the main topic and each retry topic (a retry tier lagging beyond its delay plus slack means its consumer is stuck); rates of messages entering each tier and the DLQ, split by error class (a sudden jump in one class points to a classifier bug or carrier change); circuit-breaker state transitions; and carrier latency and error codes. Alert when DLQ rate exceeds 1% of throughput, any tier lags more than 2× its delay, or the breaker stays open over 10 minutes. Add an end-to-end canary shipment every minute that must get a label within 30 s."
        }
      ],
    },
    {
      id: 'mq-scenarios-cc-2',
      title: 'Fix the "deduplicated" notification consumer that still double-sends and loses messages',
      context: `A NestJS consumer handles \`PaymentSucceeded\` events: it credits cashback in Postgres and sends a push notification. It "deduplicates" with Redis. Support tickets show **double cashback** after rebalances, and some users **never got cashback** after a Redis failover.`,
      task: 'Make the handler safe under concurrent redelivery and crashes at any line: cashback must be applied exactly once, and the notification sent at most once per event under normal operation (a rare duplicate push is acceptable; missing cashback is not).',
      starter: {
        language: 'typescript',
        title: 'cashback.handler.ts (buggy)',
        code: `async function onPaymentSucceeded(evt: PaymentSucceeded) {
  const seen = await redis.sismember('processed', evt.paymentId);
  if (seen) return;

  const cashback = Math.round(evt.amountMinor * 0.02);
  await pg.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
    [cashback, evt.userId]);

  await push.send(evt.userId, 'You earned ' + cashback / 100 + ' cashback!');

  await redis.sadd('processed', evt.paymentId);  // set grows forever
}`,
      },
      hints: [
        'Two deliveries of the same event running concurrently: can both pass SISMEMBER? What if the process crashes after the UPDATE but before SADD?',
        'Redis and Postgres are two systems. Where must the "already processed" marker live so it commits atomically with the balance change?',
        'The push notification is an external side effect that can\'t join the transaction. How do you record intent so it runs once and survives crashes?',
      ],
      solution: {
        language: 'typescript',
        title: 'cashback.handler.ts (fixed)',
        code: `async function onPaymentSucceeded(evt: PaymentSucceeded) {
  const cashback = Math.round(evt.amountMinor * 0.02);
  const client = await pg.connect();
  let applied = false;
  try {
    await client.query('BEGIN');
    // 1) Atomic dedup: the event id is unique per consumer. Concurrent duplicates block here
    //    until the first txn commits, then see a conflict.
    const dedup = await client.query(
      "INSERT INTO processed_events (consumer, event_id) VALUES ('cashback', $1) " +
        'ON CONFLICT DO NOTHING', [evt.eventId]);
    if (dedup.rowCount === 1) {
      // 2) Effect recorded as a fact keyed by the payment, then applied to the balance
      await client.query(
        'INSERT INTO cashback_grants (payment_id, user_id, amount_minor) VALUES ($1, $2, $3)',
        [evt.paymentId, evt.userId, cashback]);   // UNIQUE(payment_id) is a second guard
      await client.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
        [cashback, evt.userId]);
      // 3) Notification intent in the same txn (outbox): survives crashes, sent later
      await client.query(
        "INSERT INTO notification_outbox (id, user_id, template, params, status) " +
          "VALUES ($1, $2, 'cashback_earned', $3, 'PENDING')",
        ['cashback:' + evt.paymentId, evt.userId, JSON.stringify({ cashback })]);
      applied = true;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;                                      // not committed -> offset not committed -> redelivered
  } finally {
    client.release();
  }
  return applied;
}

// Separate relay: claim PENDING rows with SKIP LOCKED, send with the outbox id as the
// provider's idempotency/collapse key, then mark SENT with WHERE status = 'PENDING'.
// A crash between send and mark can re-send one push: the accepted "rare duplicate".
// processed_events is partitioned by day and old partitions are dropped after 14 days.`,
      },
      explanation: `**Bugs**
- **Check-then-act race:** two concurrent deliveries (for example, a rebalance overlap) both pass \`SISMEMBER\` and both credit cashback.
- **Crash window:** after the UPDATE but before \`SADD\`, a crash causes redelivery, and the event is credited twice.
- **Split-brain dedup:** the Redis marker and the Postgres effect aren't atomic. After a failover that lost recent \`SADD\`s, messages could be re-applied. Conversely, if the marker had been set first, a crash would **lose** cashback.
- **Unbounded set:** \`processed\` grows forever.
- **Wrong dedup key:** \`paymentId\` conflates different event types for the same payment; use the event id (plus a per-payment unique constraint on the grant as a business-level guard).

**Fixes**
- The dedup marker lives in **Postgres, in the same transaction** as the balance change. \`ON CONFLICT DO NOTHING\` on a unique key is atomic, and concurrent duplicates serialize on the index.
- The cashback is stored as a fact (\`cashback_grants\` with \`UNIQUE(payment_id)\`), which gives auditability and a second guard.
- The push is moved to a **notification outbox** written in the same transaction, then relayed with an idempotency/collapse key. Cashback is exactly-once; the push is effectively once, with a rare duplicate at worst, matching the requirement.
- Retention: the dedup table is partitioned by day and old partitions are dropped, sized to the longest redelivery or replay window.`,
      followUps: [
        {
          "q": "Two deliveries of the same event arrive concurrently on two consumers during a rebalance. Walk through exactly what Postgres does.",
          "a": "Both open a transaction and run `INSERT INTO processed_events ... ON CONFLICT DO NOTHING`. Consumer A's insert takes the unique-index entry. Consumer B's insert finds A's uncommitted row and blocks waiting on A's transaction. When A commits, B's insert sees a conflict, does nothing and returns rowCount 0, so B skips the grant and commits an empty transaction. If A had rolled back instead, B's insert would succeed and B would apply the cashback. Either way exactly one credit is applied, with no application-level locking: correctness comes from the unique index plus row-level waits."
        },
        {
          "q": "The push provider has no idempotency key support. How small can you make the duplicate-push window, and how do you prove it in tests?",
          "a": "The relay claims a row (`UPDATE ... SET status='SENDING', claimed_at=now() WHERE status='PENDING'`), sends, then marks it SENT. A duplicate push needs a crash between the send and the mark; a stale-claim sweeper only retries rows stuck in SENDING longer than, say, 2 minutes. That makes the window milliseconds wide per crash. Client-side collapse keys (APNs `apns-collapse-id`, FCM `collapse_key`) make the device show one notification even if two arrive. Test with fault injection: kill the relay right after a mocked send, restart, and assert at most one extra send and that the collapse id is set."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'mq-scenarios-iq-01',
      difficulty: 'medium',
      question:
        'Our "export account statement" endpoint takes 8–40 seconds, and the gateway times out at 30 seconds. Users click again, and we generate the same PDF three times. How would you redesign it?',
      whatInterviewerLooksFor: [
        'Async request-reply with 202 and a status resource',
        'Idempotent job creation',
        'A notification strategy (polling vs webhook vs push)',
        'Worker scaling and result storage',
        'Handling failures, timeouts and stuck jobs',
      ],
      modelAnswer: `### API shape
- \`POST /statements\` with an \`Idempotency-Key\` header (or a natural key: accountId + period + format). Insert a job row (\`PENDING\`) with \`ON CONFLICT DO NOTHING\` and enqueue \`{ jobId }\`.
- Respond **202 Accepted**, \`Location: /statements/jobs/{id}\`, \`Retry-After: 3\`.
- \`GET /statements/jobs/{id}\` returns \`{ status, progress, downloadUrl?, error? }\`. On success, \`downloadUrl\` is a presigned S3 URL (e.g., 15 min expiry).
- The browser gets a WebSocket/SSE push when done; B2B clients can register a signed webhook.

### Dedup of repeated clicks
The natural key \`(account_id, period, format)\` with a unique index returns the existing job instead of creating a new one. Completed results can be reused for 24h, and \`?force=true\` regenerates.

### Workers
- A separate deployment consumes the queue (SQS or Kafka) and autoscales on backlog (KEDA). Concurrency is limited by the PDF engine's CPU and the DB read load.
- Stream data from a **read replica**, render, upload to S3, then update the job: \`SUCCEEDED\` with the result key.
- Idempotent: the output key is deterministic (\`statements/{jobId}.pdf\`), so a retry overwrites.

### Failure handling
- SQS visibility timeout of 60 s with heartbeat extension; \`maxReceiveCount=3\` → DLQ → job marked \`FAILED\` with an error code the UI can show.
- A sweeper marks jobs stuck in \`RUNNING\` longer than 10 minutes as failed or re-enqueues them, and re-enqueues \`PENDING\` jobs whose enqueue failed.

### Numbers
If 50 exports/s peak at ~15 s each, Little's law gives 750 concurrent renders. At ~1 CPU per render that's ~750 vCPU at peak, a strong argument for queueing and smoothing (users accept "ready in a minute"), plus caching repeated exports.`,
      followUps: [
        {
          q: 'Polling every second from 10K open tabs — is that a problem?',
          a: 'That is 10K req/s of status reads. Use Retry-After to space polls, serve status from Redis or a cache, return 304 with ETags, or prefer SSE/WebSocket push. Status reads should never hit the primary DB.',
        },
        {
          q: 'How do you cancel a job?',
          a: 'DELETE /statements/jobs/{id} sets status CANCELLED; workers check the status before expensive steps and before uploading, and skip cancelled jobs.',
        },
      ],
      pitfalls: [
        'Just raising the gateway timeout to 120s',
        'Creating a new job on every click',
        'Returning 200 with an empty body instead of 202 plus a status resource',
      ],
    },
    {
      id: 'mq-scenarios-iq-02',
      difficulty: 'hard',
      question:
        'It\'s Black Friday. Consumer lag on the order-projection topic went from ~0 to 40 million messages in two hours and is still climbing. You are the incident commander. Walk me through the first 30 minutes.',
      whatInterviewerLooksFor: [
        'A structured triage order rather than random actions',
        'Uses per-partition lag, rates and downstream metrics',
        'Computes drain time and communicates impact',
        'Picks safe mitigations and avoids data loss',
        'Follow-up actions to prevent recurrence',
      ],
      modelAnswer: `### Minutes 0–5: scope and impact
- Is lag spread across all 48 partitions or concentrated? What's the **time lag** (oldest unprocessed age)? Which user features read this projection (order history, "where's my order")?
- Communicate: "order history is N minutes stale; checkout is unaffected."

### Minutes 5–15: find the bottleneck
- **Produce rate:** 3× baseline (expected for Black Friday) or 20× (a bug or retry storm upstream)?
- **Consume rate:** flat at the old baseline (capacity-bound) or dropped (something broke)?
- **Consumer health:** restarts or OOMs, rebalance rate, CPU throttling, recent deploys.
- **Errors:** retry or DLQ rates, a new exception class, deserialization errors on one partition (poison pill).
- **Downstream:** projection DB CPU, lock waits, connection pool saturation.

### Minutes 15–30: mitigate by cause
- **Capacity-bound, DB healthy:** scale consumers up to 48 (the partition count). Raise the batch size to amortize DB writes; since this is a projection, collapse updates per order to the latest version.
- **DB saturated:** don't add consumers. Reduce per-message cost (batch upserts), scale DB read replicas away from the primary, or temporarily disable non-critical projections sharing the DB.
- **Rebalance loop:** stop deploys and autoscaler flapping, reduce \`max.poll.records\`, raise the poll interval temporarily.
- **Poison pill or a single hot partition:** skip to the DLQ; for a hot key, see the partition-skew playbook.
- **Upstream bug** (a producer re-publishing in a loop): apply a producer quota and roll back.

### Drain math
If produce is 12K/s and we can consume 20K/s, the net drain is 8K/s → 40M ÷ 8K ≈ 83 min. Check that retention (7 days) is nowhere near at risk.

### Afterwards
Load test at 3× peak; time-lag alerts; KEDA on lag; priority lanes so critical projections don't share consumers with bulk ones.`,
      followUps: [
        {
          q: 'Someone suggests resetting offsets to latest to "clear the lag". Thoughts?',
          a: 'That discards 40M events from the projection, leaving it permanently wrong for those orders. Only acceptable for truly disposable data (e.g., live metrics). For projections, drain or rebuild from source.',
        },
        {
          q: 'Could you rebuild faster than draining?',
          a: 'Sometimes: a snapshot/bulk rebuild from the source DB plus replay from a known offset can be faster than applying 40M incremental events, especially if most are superseded updates.',
        },
      ],
      pitfalls: [
        'Immediately scaling consumers without checking the DB',
        'Purging the queue',
        'Not computing drain time or communicating impact',
      ],
    },
    {
      id: 'mq-scenarios-iq-03',
      difficulty: 'hard',
      question:
        'Design the retry and dead-letter strategy for a consumer that posts ledger entries to a partner bank API. Some failures are transient, some permanent, and the partner rate-limits you.',
      whatInterviewerLooksFor: [
        'Error classification',
        'Backoff with jitter and delayed retries off the main path',
        'Rate-limit and circuit-breaker awareness',
        'DLQ with context, alerting and redrive',
        'Idempotency across retries and redrives',
      ],
      modelAnswer: `### Classify
- **Transient:** timeouts, 5xx, connection resets, 429 → retry.
- **Permanent:** 400/422 validation (bad IBAN), 401/403 (config), unknown account → no retry, straight to the DLQ.
- **Ambiguous:** a timeout after the request was sent. The partner may have posted it, so retry **with the same idempotency key**, or query status first.

### Retry ladder
1. In-place: 3 attempts, 200 ms × 2^n + jitter.
2. \`ledger.retry.5m\`, \`ledger.retry.1h\`, \`ledger.retry.6h\`: consumers pause until \`not-before\`.
3. \`ledger.dlq\` after the last tier, or immediately for permanent errors.
Total retry horizon ~7 hours, matched to the partner's typical incident durations and our SLA to the business.

### Rate limiting and outages
- A client-side token bucket at the partner's quota (e.g., 100 req/s shared across pods via Redis, or split per pod).
- Honor \`Retry-After\` on 429 by **pausing** the partition, not by failing messages into the retry tiers.
- A circuit breaker: when the error rate exceeds 50% for 30 s, pause consumption entirely. During a full outage, messages stay in the main topic and are not all shoved into retry tiers.

### DLQ operations
- Headers: original topic/partition/offset, attempt count, error class and body, first and last failure time.
- Alert on DLQ rate > 0 for money flows; dashboard by error class.
- Redrive tool: filter by error class or time, replay to the main topic at a capped rate.

### Correctness
- Idempotency key per ledger entry (\`entryId\`) sent to the partner and stored locally; the local state machine is \`PENDING → POSTED/FAILED\` with conditional transitions.
- **Ordering:** if entries for one account must be posted in order, use key parking for that account while an entry is in retry, instead of plain retry topics.
- Daily reconciliation against the partner's statement catches anything the pipeline missed.`,
      followUps: [
        {
          q: 'What if the DLQ fills with 50K messages from a bug we just fixed?',
          a: 'Deploy the fix, then redrive in batches at a controlled rate while watching error rates. Idempotency keys make re-posting already-posted entries a no-op on the partner side.',
        },
        {
          q: 'Why not just use a long in-place retry with exponential backoff?',
          a: 'It blocks every other message in the partition and breaks consumer liveness (max.poll.interval) once waits exceed minutes. Off-path retry keeps healthy messages flowing.',
        },
      ],
      pitfalls: [
        'Retrying 4xx validation errors',
        'A DLQ with no alerting or redrive process',
        'Retrying with a new idempotency key',
      ],
    },
    {
      id: 'mq-scenarios-iq-04',
      difficulty: 'expert',
      question:
        'A consumer occasionally processes the same message twice, which sends duplicate SMS and double-counts usage for billing. Design an idempotent consumer. Where exactly do you store dedup state, and what happens when the side effect is an external API that cannot join your transaction?',
      whatInterviewerLooksFor: [
        'Lists the sources of duplicates',
        'Keeps the dedup marker atomic with the local effect',
        'Picks the right dedup key and window',
        'Handles external effects via idempotency keys or an outbox with state',
        'Is explicit about residual guarantees',
      ],
      modelAnswer: `### Why duplicates happen
Commit-after-process plus a crash or rebalance, SQS visibility timeout expiry, producer retries or upstream double-publish, and DLQ redrives or replays.

### Local effect (usage counting in Postgres)
- Dedup key = the **event id** assigned by the producer (UUID in the envelope).
- In one transaction: \`INSERT INTO processed_events(consumer, event_id) ON CONFLICT DO NOTHING\`. If a row is inserted, apply the effect; commit. Concurrent duplicates wait on the unique index and then no-op.
- Better still, model usage as **facts**: \`usage_records(event_id PK, customer, units)\` and derive totals. The fact table is the dedup table.
- Alternative for high volume: store the **last applied offset per partition** in the same transaction and skip lower offsets. This handles redelivery but not upstream double-publish, which creates new offsets.

### External effect (SMS)
- You cannot make SMS and Postgres atomic. Record **intent** first: in the same transaction as dedup, insert \`sms_outbox(id = hash(eventId), status = PENDING)\`.
- A sender claims PENDING rows, calls the provider with \`id\` as the idempotency key if supported, then sets \`SENT\` conditionally.
- If the provider has no idempotency: a crash between the send and the \`SENT\` update can re-send. Choose between at-least-once (re-send on doubt) and at-most-once (mark \`SENDING\` first and never retry ambiguous sends) per message type. OTPs: at-least-once. Marketing: at-most-once.

### Dedup window and storage
Kafka retention is 7 days, but DLQ redrive can be later, so keep \`processed_events\` for 14 days, partitioned by day (drop partitions, no mass DELETEs). At 5K events/s that's ~6B rows over 14 days, which is big. For high-volume streams, prefer natural idempotency (upserts with version guards or offset tracking) and keep explicit dedup rows only for side-effecting events.

### What I'd tell the business
"Usage is counted exactly once. SMS is exactly once when the provider supports idempotency keys; otherwise a duplicate is possible only if we crash in a ~100 ms window."`,
      followUps: [
        {
          q: 'Why not dedupe with Redis SET NX and a 24h TTL?',
          a: 'It is not atomic with the Postgres effect: set-then-crash loses the message, and effect-then-crash duplicates it. Redis failover can also drop recent keys. It works as a fast pre-filter, not as the guarantee.',
        },
        {
          q: 'Could you use the Kafka offset as the dedup key?',
          a: 'Only against redelivery of the same record. A producer retry without idempotence or an upstream re-publish creates a new offset for the same logical event. Producer-assigned event ids cover both.',
        },
      ],
      pitfalls: [
        'Dedup check and mark in separate steps',
        'Hashing the payload as the dedup key',
        'Claiming exactly-once for external APIs without idempotency support',
      ],
    },
    {
      id: 'mq-scenarios-iq-05',
      difficulty: 'expert',
      question:
        'Account events (deposit, withdrawal, freeze) must be applied strictly in order per account. You also need retries for transient DB failures and a DLQ. How do you retry without breaking ordering, and without letting one bad account block everyone?',
      whatInterviewerLooksFor: [
        'Recognizes that retry topics reorder events',
        'Offers blocking retry vs key parking vs version-guard strategies with their trade-offs',
        'Uses sequence numbers to detect gaps',
        'Considers the DLQ\'s impact on per-key ordering',
      ],
      modelAnswer: `### Baseline
Key = accountId. The producer (the account service, the single writer) stamps \`seq\` per account. The consumer applies only when \`seq = last_seq + 1\`, updating \`last_seq\` in the same transaction as the effect.

### Why plain retry topics fail
Event 41 fails → goes to the retry topic; event 42 is processed first → state is wrong. With a strict seq check, 42 is rejected (a gap), so it has to go to retry as well, and now everything after it depends on the retry path.

### Options
1. **Blocking in-place retry** (short, bounded: e.g., 5 attempts over ~30 s). Correct and simple. Cost: the whole partition stalls for that time, affecting other accounts on it. Fine for rare, short DB blips.
2. **Key parking:**
   - On failure after quick retries, park the account: \`parked_keys(account_id, since_seq)\` plus the message into \`account.retry\`.
   - The main consumer checks for each message: is the key parked? If so, append it to the **same retry stream** (in order) and move on.
   - The retry consumer processes the parked key's messages in order; when the backlog for that key is empty, it unparks.
   - Other accounts are unaffected. Cost: complexity, plus an extra lookup per message (cache parked keys in memory with invalidation, since the set is usually tiny).
3. **Version-guard only:** accept reordering and reject stale updates. Fine for state snapshots ("current status"), **wrong** for deltas like deposits, where every event must be applied.

### DLQ with ordering
A permanent failure for account A means **all later events for A must wait** (park A, alert humans). You cannot skip event 41 and apply 42 for a ledger. Other accounts continue.

### Gap detection
If \`seq > last_seq + 1\` arrives (an upstream bug or lost event), park the key and alert. Never apply past a gap.

### Choice
Blocking retry for transient DB errors (seconds), key parking for longer failures, and a strict seq check as the safety net.`,
      followUps: [
        {
          q: 'How would SQS FIFO behave here?',
          a: 'With MessageGroupId = accountId, a failing message blocks only its group until it succeeds or hits maxReceiveCount and moves to the DLQ. After that, later messages for the group proceed, which can break ordering unless you check seq and park.',
        },
        {
          q: 'Where does the parked-key state live?',
          a: 'In the consumer\'s DB (same place as last_seq) so parking is transactional with processing; cache it in memory per consumer, since the parked set is small, and refresh on partition assignment.',
        },
      ],
      pitfalls: [
        'Using standard retry topics for ordered deltas',
        'Skipping a failed event and continuing for that key',
        'Serializing globally (one partition) to get ordering',
      ],
    },
    {
      id: 'mq-scenarios-iq-06',
      difficulty: 'expert',
      question:
        'One enterprise merchant generates ~40% of all payment events. Its partition is hours behind while the other 47 partitions are near zero lag. Walk me through your options.',
      whatInterviewerLooksFor: [
        'Confirms skew with data and identifies the key',
        'Asks what ordering is actually required for this merchant',
        'Offers salting, dedicated topics, and cheaper processing with trade-offs',
        'Considers downstream aggregates and migration safety',
      ],
      modelAnswer: `### Confirm
Per-partition bytes-in and lag show partition 17 at ~40% of the volume; sampling keys confirms \`merchantId = m_big\`. The single consumer owning partition 17 is CPU- or IO-bound. Adding consumers can't help, since one partition means one consumer.

### Clarify ordering
Is per-**merchant** order actually needed, or only per **payment/order**? Usually per-payment ordering (authorize → capture → refund) is what matters.

### Options
1. **Re-key by paymentId** for everyone: ideal spread, and per-payment order is preserved. Per-merchant order is lost, which is usually fine; merchant aggregates are computed downstream.
2. **Salt only the hot merchant:** key = \`m_big#\` + (hash(paymentId) % 16). The load spreads over up to 16 partitions while per-payment order is kept. Merchant-level aggregates need a merge step (sum over sub-keys).
3. **Dedicated topic** \`payments.m_big.v1\` with its own partitions and consumer group: isolates the noisy tenant and allows a separate SLA. Cost: routing logic in producers and more topics to operate.
4. **If per-merchant strict order is truly required:** you cannot parallelize, so make each message cheaper. Batch DB writes, pre-aggregate in memory (apply 1,000 events as one update), move heavy enrichment off the ordered path, and give that consumer a bigger machine.

### Migrating the key safely
Changing keys moves in-flight events for the same payment to a different partition. Cut over with a **drain-then-switch** (stop producers briefly, or switch at a point where old partitions are fully consumed), or have consumers tolerate cross-partition reordering during the transition via version guards.

### Prevent recurrence
Alert on partition skew (max/avg bytes-in > 3×); review key choice in design reviews; maintain a tenant-tier config for hot tenants.`,
      followUps: [
        {
          q: 'Why not just increase the partition count?',
          a: 'All of m_big\'s events hash to one partition regardless of N. More partitions spread other keys but the hot key stays on one partition, and it remaps keys, breaking ordering.',
        },
        {
          q: 'Does a custom partitioner help?',
          a: 'It can route known hot keys round-robin over a partition range (like salting, but inside the producer). Every producer must run the identical partitioner, and consumers still lose per-merchant ordering.',
        },
      ],
      pitfalls: [
        'Adding consumers or partitions without changing the key',
        'Salting every key, losing ordering everywhere',
        'Ignoring the migration reorder window',
      ],
    },
    {
      id: 'mq-scenarios-iq-07',
      difficulty: 'hard',
      question:
        'Marketing is launching a campaign that will push 10× normal traffic for about 20 minutes into our order-processing pipeline, which writes to a Postgres cluster that is already at 50% CPU. How do you make sure nothing falls over?',
      whatInterviewerLooksFor: [
        'Capacity math for the spike and drain',
        'Uses the queue for load leveling while protecting the DB',
        'Backpressure and admission control',
        'Prioritization of critical flows',
        'Rehearsal and observability',
      ],
      modelAnswer: `### Numbers first
Normal is 1K orders/s, spike 10K/s for 20 minutes. The DB at 50% CPU implies ~2K/s capacity for this workload, so consumers must not exceed ~1.8K/s sustained with headroom.
- Backlog during the spike ≈ (10K − 1.8K) × 1,200 s ≈ 9.8M messages.
- Drain after the spike at (1.8K − 1K) = 0.8K/s net → ~3.4 hours. Is a 3-hour delay in order processing acceptable? Probably not for payment capture, but fine for loyalty points.

### Design moves
1. **Split lanes:** critical steps (payment authorization, inventory reservation) versus deferrable ones (loyalty, analytics, emails) on separate topics with separate consumer groups and DB budgets. During the spike, **pause** deferrable consumers.
2. **Cheaper writes:** batch inserts (multi-row, 500 per statement) can cut DB CPU per order by 3–5×, turning 1.8K/s into maybe 6K/s. That changes the drain from hours to minutes.
3. **Consumer concurrency cap** tied to DB health: pause partitions when DB p99 or CPU exceeds a threshold (backpressure), rather than autoscaling blindly on lag.
4. **Admission control at the API:** accept orders quickly (append to Kafka is cheap), but if the projected drain time exceeds the SLO, queue users in a waiting room or return 503 with Retry-After for non-critical endpoints.
5. **Capacity:** pre-scale the DB (bigger instance or more read replicas for reads) and confirm Kafka retention and disk for ~10M extra messages (~20 GB at 2 KB each, trivial).

### Rehearse
A load test replaying 10× traffic in staging with production-like data; a game day that pauses consumers and verifies catch-up; dashboards for time lag per lane and DB saturation; a runbook with the knobs (pause lanes, batch size, concurrency).

### What the user sees
The order confirmation is instant (the order is accepted and persisted to Kafka); the "processing" state lasts seconds for critical steps, while loyalty points may show up an hour later.`,
      followUps: [
        {
          q: 'Why not autoscale consumers on lag?',
          a: 'Lag-based autoscaling assumes the downstream can absorb more throughput. Here the DB is the constraint; scaling consumers turns lag into DB overload and a full outage. Scale on lag but cap by DB health.',
        },
        {
          q: 'The campaign also drives read traffic to order status. Impact?',
          a: 'Order status reads should come from a cache or replica, not the primary; the status projection itself lags during the spike, so show "processing" states instead of errors.',
        },
      ],
      pitfalls: [
        'Assuming the queue alone solves it without computing drain time',
        'Treating all consumers as equally important',
        'Autoscaling consumers into a saturated DB',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'mq-scenarios-boe-1',
      question:
        'A consumer group fell behind by 36M messages during an outage. Producers write 20K msgs/s. Each consumer processes ~900 msgs/s, and there are 24 consumers on a 48-partition topic. How long until lag is zero, and what if you scale to 48 consumers?',
      assumptions: [
        'Consumer throughput scales linearly (the DB has headroom)',
        'Produce rate stays at 20K/s during catch-up',
        'The rebalance cost when scaling is negligible (~1 minute)',
      ],
      steps: [
        { label: 'Current capacity', calc: '24 × 900 = 21.6K msgs/s' },
        { label: 'Net drain rate', calc: '21.6K − 20K = 1.6K msgs/s' },
        { label: 'Time to drain', calc: '36M ÷ 1.6K ≈ 22,500 s ≈ 6.25 hours' },
        { label: 'Scaled capacity', calc: '48 × 900 = 43.2K msgs/s' },
        { label: 'Scaled net drain', calc: '43.2K − 20K = 23.2K msgs/s' },
        { label: 'Scaled time to drain', calc: '36M ÷ 23.2K ≈ 1,550 s ≈ 26 minutes' },
        { label: 'DB load check', calc: '43.2K writes/s vs 21.6K before → the DB must handle 2× write load during catch-up' },
      ],
      answer: 'About 6.25 hours at 24 consumers vs about 26 minutes at 48: a 2× increase in capacity gives ~14× faster catch-up, because only the capacity above the produce rate drains the backlog.',
      insight:
        'Catch-up time is backlog ÷ (capacity − inflow), which is very sensitive when capacity is barely above inflow. Keep 2× consumer headroom, and make sure the downstream DB can take the catch-up burst. Otherwise batch writes instead of adding pods.',
      followUps: [
        {
          "q": "The DB can only absorb 30K writes/s, not 43.2K. What is the realistic catch-up time, and what would you change?",
          "a": "Effective capacity is capped at 30K/s, so the net drain is 30K − 20K = 10K/s and 36M ÷ 10K = 3,600 s ≈ 1 hour, not 26 minutes. Adding pods past about 34 does nothing. Raise the DB ceiling instead: batch 100-row upserts (often 5–10× fewer round trips) and collapse superseded updates for the same key in the backlog, since for a 36M backlog many messages may be older versions of the same rows. Another option is to throttle producers of non-critical traffic during catch-up. Each 1K/s of extra DB capacity cuts the time noticeably because it all goes to net drain."
        }
      ],
    },
    {
      id: 'mq-scenarios-boe-2',
      question:
        'Load leveling for a flash event: normal traffic 2K msgs/s, spike 20K msgs/s for 15 minutes, consumer capacity capped at 5K msgs/s by the database. Messages are 2 KB. How big does the backlog get, how long does it take to drain, and is Kafka/SQS retention a concern?',
      assumptions: [
        'Consumers run at full 5K/s throughout',
        'Traffic returns to 2K/s immediately after the spike',
        'Kafka retention is 3 days; RF=3',
      ],
      steps: [
        { label: 'Backlog growth rate', calc: '20K − 5K = 15K msgs/s' },
        { label: 'Peak backlog', calc: '15K × 900 s = 13.5M messages' },
        { label: 'Backlog size', calc: '13.5M × 2 KB = 27 GB (× RF 3 = 81 GB on disk)' },
        { label: 'Drain rate after the spike', calc: '5K − 2K = 3K msgs/s' },
        { label: 'Drain time', calc: '13.5M ÷ 3K = 4,500 s = 75 minutes' },
        { label: 'Worst message delay', calc: 'The last message of the spike waits ~13.5M ÷ 5K = 2,700 s ≈ 45 min' },
        { label: 'Retention check', calc: '90 min spike + drain ≪ 3 days: safe; 81 GB extra is small for a cluster' },
      ],
      answer: 'Peak backlog is ~13.5M messages (27 GB, or 81 GB replicated), it drains in ~75 minutes after the spike, and the worst end-to-end delay is ~45 minutes. Retention is not a concern.',
      insight:
        'The queue keeps the system alive, but a 45-minute delay may breach the SLO for critical flows. That drives priority lanes, cheaper writes (batching to raise the 5K/s cap) or temporary DB scaling. Storage is almost never the constraint; drain time is.',
      followUps: [
        {
          "q": "The spike lasts 60 minutes instead of 15. Recompute the backlog and worst-case delay. Does anything break?",
          "a": "Backlog grows at 15K/s × 3,600 s = 54M messages (108 GB, or 324 GB replicated). Drain at 3K/s takes 18,000 s = 5 hours after the spike. The worst message delay is 54M ÷ 5K ≈ 3 hours. Retention of 3 days is still fine, and 324 GB is manageable. What breaks is the business SLO: downstream data is up to 3 hours stale, and any time-sensitive messages (OTPs, confirmations) are unusable. You need priority lanes, batching to raise the 5K/s DB cap, or temporary read/write capacity scale-up before the event."
        }
      ],
    },
    {
      id: 'mq-scenarios-boe-3',
      question:
        'You want a dedup store for a consumer handling 30K events/s. Compare a Redis set of event ids with a 24h window, a Postgres processed_events table with a 7-day window, and offset-per-partition tracking.',
      assumptions: [
        'Event id = 16-byte UUID; Redis per-key overhead ~70 B with a short value (as individual keys with TTL)',
        'Postgres row + PK index ≈ 80 B per event',
        'Topic has 64 partitions',
      ],
      steps: [
        { label: 'Events per day', calc: '30K × 86,400 ≈ 2.6B events/day' },
        { label: 'Redis 24h', calc: '2.6B × ~86 B ≈ 223 GB RAM → ~8–10 shards of 32 GB with headroom' },
        { label: 'Postgres 7 days', calc: '2.6B × 7 × 80 B ≈ 1.46 TB, plus 30K inserts/s of index churn' },
        { label: 'Offset tracking', calc: '64 partitions × (topic, partition, offset) ≈ 64 rows, updated once per batch' },
        { label: 'Offset write load', calc: 'with 500-message batches: 30K ÷ 500 = 60 small updates/s' },
      ],
      answer: 'Redis needs ~220 GB of RAM, Postgres ~1.5 TB with heavy index churn, and offset tracking only 64 rows.',
      insight:
        'At high volume, per-event dedup stores get expensive. Prefer offset-in-the-same-transaction (which handles redelivery) plus natural idempotency (upserts with version guards, which handle upstream duplicates). Keep per-event dedup only for the smaller stream of events that trigger external side effects.',
      followUps: [
        {
          "q": "You choose offset-in-transaction. Upstream producers can still emit duplicate events with different offsets. What covers that case, and at what cost?",
          "a": "Offset tracking only dedupes redelivery of the same record. A producer retry without idempotence, or a replayed outbox row, creates a new record with a new offset. Cover it with natural idempotency in the effect: upsert by business key with a version guard (`WHERE stored.version < incoming.version`), which costs one indexed column on the existing row and no extra table. For side-effecting events such as payments or SMS at maybe 1% of volume (300/s), keep a per-event dedup table: about 26M rows/day × 80 B ≈ 2 GB/day, which is cheap at that scale."
        }
      ],
    },
  ],
  test: [
    {
      id: 'mq-scenarios-mcq-01',
      difficulty: 'hard',
      question:
        'This kafkajs handler runs on a 12-partition topic. One message has a malformed address that the carrier API always rejects with 400. What happens?',
      code: {
        language: 'typescript',
        code: `eachMessage: async ({ message }) => {
  for (;;) {
    try { return await carrier.createLabel(parse(message)); }
    catch (e) { await sleep(1000); }
  }
},`,
      },
      options: [
        'The message\'s partition stops progressing forever while other partitions continue; the member may also be kicked from the group once it fails to heartbeat or poll in time, bouncing the stuck partition between consumers',
        'kafkajs detects the repeated failure and skips the message after its default retry count',
        'All 12 partitions stop, because a consumer processes partitions sequentially',
        'The message is automatically sent to a DLQ after max.poll.interval.ms',
      ],
      correct: [0],
      explanation:
        'The handler never returns or throws, so kafkajs never gets a chance to retry or skip, and the offset can\'t advance. That partition is blocked indefinitely, a poison pill. Other partitions keep going (they are consumed independently, and concurrently if configured), and there is no automatic DLQ in Kafka. The long-blocked member can also be removed from the group, moving the problem to another consumer. Fix by classifying the 400 as permanent and dead-lettering it.',
      followUps: [
        {
          "q": "You add 400-to-DLQ handling. A week later the carrier has a bug that returns 400 for every request for an hour. What happens, and how do you guard against it?",
          "a": "Every message is classified as permanent and dead-lettered, so the whole topic drains into the DLQ within minutes and nothing is processed. Guard by watching the DLQ rate, not just its existence: if more than a few percent of messages are dead-lettered in a window, stop treating the errors as per-message and open a circuit breaker that pauses consumption. Alert on the DLQ rate spike. Make redrive easy (a CLI that replays a time range of the DLQ at a capped rate) so recovery after the carrier fix takes minutes. Idempotency keys make the replay safe."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-02',
      difficulty: 'expert',
      question:
        'A consumer credits loyalty points in Postgres. Deliveries can be duplicated and can arrive concurrently on two consumers during a rebalance. Select ALL designs that guarantee points are credited exactly once.',
      options: [
        'Check Redis SISMEMBER(eventId), credit points in Postgres, then SADD(eventId)',
        'In one Postgres transaction: INSERT processed_events(eventId) ON CONFLICT DO NOTHING; credit only if a row was inserted; COMMIT',
        'Insert a point_grants row keyed by eventId (PRIMARY KEY) and derive the balance as SUM(points) over grants',
        'SET eventId NX in Redis first; if it succeeds, credit points in Postgres',
        'Wrap the handler in a Redis distributed lock keyed by the customer id',
      ],
      correct: [1, 2],
      explanation:
        'Both correct options make "seen this event?" and the effect a single atomic database action under a unique constraint, so concurrent duplicates serialize and no-op. Check-then-add in Redis races and has a crash window between the credit and SADD. SET NX first loses the credit if the process crashes before the Postgres write. A per-customer lock only serializes the two deliveries, and both still credit.',
      followUps: [
        {
          "q": "The processed_events table grows by 50M rows a day. How long must you keep entries, and how do you expire them cheaply?",
          "a": "Keep entries for at least the longest window in which a duplicate can arrive: consumer redelivery (minutes), plus producer retries, plus any deliberate replay or offset reset you support, typically 7–14 days. Partition the table by day (`PARTITION BY RANGE (created_at)`) and drop whole old partitions. DROP is instant and avoids the vacuum churn of DELETE on 50M rows. If you need to replay older history, rely on the natural idempotency of the effect instead, such as the `point_grants` primary key on eventId, which is stored permanently because it is the business record anyway."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-03',
      difficulty: 'medium',
      question:
        'The pricing service runs 6 pods. Each pod publishes a quote request to a RabbitMQ queue and waits (with a 5 s timeout) for the answer on a single shared "quote-replies" queue that all 6 pods consume. About 5 in 6 callers time out even though every reply is sent within 200 ms. What is the fix?',
      options: [
        'Raise the timeout to 30 s so slower replies have time to arrive',
        'Switch the shared reply queue to a fanout exchange so every pod receives every reply',
        'Give each pod its own exclusive reply queue (or direct reply-to), set replyTo and a correlationId on each request, and match replies to pending calls by correlationId',
        'Enable publisher confirms on the request queue so the caller knows the request was delivered',
      ],
      correct: [2],
      explanation:
        'Competing consumers on one reply queue means a reply usually lands on a pod that did not send the request (5 times out of 6 here), and that pod has no pending call to complete. Per-pod reply queues (or RabbitMQ direct reply-to) route each reply back to its sender, and the correlationId maps it to the right in-flight promise. A longer timeout doesn\'t help, because the reply went to the wrong pod. Fanout works but sends 6× the traffic and every pod has to discard 5 of 6 replies. Publisher confirms only cover the request leg.',
      followUps: [
        {
          "q": "A pod crashes after sending 200 requests and restarts with a new exclusive reply queue. What happens to the replies for those requests, and is that a problem?",
          "a": "The old exclusive queue was deleted when its connection closed, so the replies are routed nowhere and dropped (or go to an alternate exchange if configured). The callers that were waiting are gone too, so no one would consume those replies anyway. The real issue is side effects: if the quote service did work like reserving a price, it should be idempotent or time-bound. Upstream clients will retry through another pod with the same idempotency key. Request-reply over a broker gives no durability across caller restarts; if the result matters, persist it and let the caller fetch it by correlation id."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-04',
      difficulty: 'hard',
      question:
        'Lag is growing on a 24-partition topic with 12 consumers. Consumers show 15% CPU; the Postgres they write to is at 95% CPU with rising lock waits. What is the best next step?',
      options: [
        'Scale consumers to 24 to double throughput',
        'Increase the partition count to 96 and scale consumers to 96',
        'Switch the consumers from kafkajs to a faster client library',
        'Reduce per-message DB cost (batch multi-row upserts, collapse superseded updates) and cap consumer concurrency to what the DB can sustain',
      ],
      correct: [3],
      explanation:
        'Idle consumers waiting on a saturated database mean the database is the bottleneck. Adding consumers or partitions adds concurrent writes, which worsens lock contention and can tip the DB over. The client library is not the constraint at 15% CPU. Batching and collapsing updates reduce DB work per message, which is what raises throughput.',
      followUps: [
        {
          "q": "Batching helps, but the DB still saturates during catch-up after an outage. How do you cap consumer throughput to protect it?",
          "a": "Add explicit backpressure: limit DB concurrency with a semaphore shared across `partitionsConsumedConcurrently` (for example, at most 8 in-flight batches per pod) and size the pool so pods × in-flight ≤ what the DB sustains. Adapt it with AIMD: if DB p99 latency or lock waits rise above a threshold, halve concurrency or pause partitions; when healthy, increase it slowly. Collapse updates per key within a batch (keep only the latest state for each orderId) so catch-up writes far fewer rows than messages. Lag drains a little slower, but the DB never tips into lock storms that hurt the online traffic sharing it."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-05',
      difficulty: 'expert',
      question:
        'OrderStatusChanged events (keyed by orderId) are consumed with a retry-topic scheme. v2 (PAID) fails transiently and goes to retry.10m; v3 (SHIPPED) succeeds. Ten minutes later v2 is retried successfully. The projection blindly sets status from each event. What is the final status, and what is the minimal robust fix?',
      options: [
        'SHIPPED; Kafka guarantees per-key ordering, so retries preserve order',
        'PAID; add a version guard (apply only if event.version > stored.version) or park the key while an earlier event is in retry',
        'PAID; switch to acks=all on the producer',
        'SHIPPED; the retry consumer runs in the same consumer group, so Kafka reorders the events',
      ],
      correct: [1],
      explanation:
        'The retry topic is a different topic and partition, so v2 overtakes nothing and is simply applied last, regressing the state to PAID. Per-partition ordering does not span the retry path. A version guard makes stale events no-ops, and key parking preserves strict order when every event must be applied. Producer acks affect durability, not ordering. Consumer group membership never reorders records.',
      followUps: [
        {
          "q": "Some events can't be skipped even if stale, such as ledger entries where every event must apply in order. How does key parking work in practice?",
          "a": "When an event for key K fails and goes to the retry path, record K as parked (in a DB table or a compacted `parked-keys` topic) together with the failed offset. While processing the main topic, any new event for a parked key is also diverted to the parked queue behind it instead of being applied. When the retry succeeds, drain that key's parked events in order, then unpark it. Other keys keep flowing. The cost is extra state and complexity, plus a monitor for keys parked too long, which become manual-intervention alerts."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-06',
      difficulty: 'hard',
      question: 'What is the most serious problem with this SQS worker?',
      code: {
        language: 'typescript',
        code: `const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({
  QueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20,
}));
for (const m of Messages) {
  await sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: m.ReceiptHandle! }));
  await processOrder(JSON.parse(m.Body!));
}`,
      },
      options: [
        'Long polling with WaitTimeSeconds: 20 adds 20 s latency to every message',
        'Messages must be deleted in a batch call, or SQS redelivers them',
        'MaxNumberOfMessages: 10 exceeds the SQS limit of 1 per receive',
        'Deleting before processing makes it at-most-once: if the worker crashes or processOrder throws, the message is gone for good',
      ],
      correct: [3],
      explanation:
        'Acknowledging (deleting) before the side effect loses the message on any failure, and there is no DLQ path because it will never be received again. Delete only after successful processing and make the handler idempotent. Long polling returns as soon as messages arrive; it only waits when the queue is empty. The receive limit is 10, and single deletes are valid.',
      followUps: [
        {
          "q": "You move DeleteMessage after processOrder. processOrder charges a card and takes up to 45 s, and the visibility timeout is 30 s. What new problem appears?",
          "a": "The message becomes visible again at 30 s while the first worker is still charging, so a second worker can pick it up and charge the card again. Fixes: set the visibility timeout above p99 processing time, or extend it with `ChangeMessageVisibility` heartbeats while the work runs; and make the charge idempotent by passing an idempotency key derived from the order id to the payment provider, plus a DB guard that only one worker can move the order from PENDING to CHARGING. Configure a DLQ with a sensible `maxReceiveCount` so a permanently failing order stops cycling."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-07',
      difficulty: 'expert',
      question:
        'To fix a hot partition, you change the key for merchant m_big from merchantId to merchantId + "#" + random(0..7). What is the most important consequence?',
      options: [
        'Events for the same payment of m_big can land on different partitions, so even per-payment ordering is lost. Salting should use a hash of a finer key such as paymentId, and merchant aggregates need a merge step',
        'None: Kafka rebalances salted keys back to one consumer to keep ordering',
        'Throughput for m_big stays the same, because salting only affects consumers',
        'Consumers must now use exactly 8 instances',
      ],
      correct: [0],
      explanation:
        'Random salt scatters events for one payment (authorize, capture, refund) across up to 8 partitions, which can reorder them. Deriving the salt from hash(paymentId) keeps each payment on one partition while still spreading the merchant. Either way, per-merchant ordering and single-partition aggregates are gone, so downstream must merge sub-keys. Kafka never re-groups keys, and the consumer count is unrelated to the salt count.',
      followUps: [
        {
          "q": "With hash(paymentId) salting, a dashboard needs m_big's total processed volume per minute. How do you compute it now that its events span 8 partitions?",
          "a": "Use a two-stage aggregation. Stage 1 runs per partition: each consumer pre-aggregates m_big's events into per-minute partial sums keyed by `(merchantId, salt, minute)`. Stage 2 merges: partials are published to a topic keyed by `merchantId` (low volume, about 8 messages per minute) and summed, giving the final total. Use event time with a small allowed lateness (for example 30 s) so partials from lagging partitions still count. Kafka Streams or Flink do this natively with a repartition step. The merge stage is tiny because it handles aggregates, not raw events."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-08',
      difficulty: 'medium',
      question:
        'You run 30 topics with very different rates, from 50 msgs/s to 200K msgs/s. Which consumer lag alert is most meaningful across all of them?',
      options: [
        'Lag greater than 100,000 messages on any group',
        'Consumer CPU greater than 80%',
        'Age of the oldest unprocessed message (time lag) greater than the topic\'s freshness SLO',
        'Any increase in lag compared with 5 minutes ago',
      ],
      correct: [2],
      explanation:
        'Time lag maps directly to user-visible staleness and normalizes across topic rates: 100K messages is 0.5 s on the busy topic and 33 minutes on the slow one. CPU says nothing about progress. Lag rises briefly during every normal burst, so alerting on any increase is pure noise.',
      followUps: [
        {
          "q": "How do you actually compute 'age of the oldest unprocessed message' for a Kafka consumer group?",
          "a": "For each partition, take the committed offset of the group. The record at that offset is the oldest unprocessed one, and its timestamp gives the time lag: `now - record.timestamp`. Tools like Burrow, kafka-lag-exporter or Redpanda Console do this by sampling. A cheaper approximation interpolates from offset lag and recent produce rate (offset lag ÷ messages per second). Alternatively, have the consumer emit `now - message.timestamp` when it processes each record, but that shows nothing when the consumer is completely stuck, so pair it with a commit-progress check. Alert per topic against its own freshness SLO."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-09',
      difficulty: 'expert',
      question:
        'A kafkajs consumer calls a partner API that starts returning 429 with Retry-After: 30. Select ALL responses that apply correct backpressure.',
      options: [
        'Pause the affected partitions and resume after Retry-After, without committing the unprocessed offsets',
        'Reduce the in-flight concurrency limit (for example, halve it) and raise it gradually after successes',
        'Catch the 429 and immediately re-send the message to the same topic so the consumer keeps moving',
        'Read ahead and buffer messages in an in-memory array until the partner recovers',
        'Open a circuit breaker when 429s exceed a threshold and stop consuming until a probe succeeds',
      ],
      correct: [0, 1, 4],
      explanation:
        'Pausing, adaptive concurrency (AIMD) and circuit breaking all slow intake to what the partner can accept, while leaving messages safely in Kafka. Re-publishing to the same topic creates a hot loop that multiplies load and reorders messages. An unbounded in-memory buffer moves the backlog into RAM and ends in an OOM, losing whatever was buffered.',
      followUps: [
        {
          "q": "Twenty consumer pods all hit the same partner. Each pod's AIMD reacts independently. Why might that still overload the partner, and what fixes it?",
          "a": "Each pod sees only its own 429s and backs off on its own schedule. When Retry-After expires, all 20 resume at the same moment and overshoot again, which causes synchronised oscillation. Also, the partner's limit (say 200 rps) is global, while each pod's concurrency limit is local. Fixes: add jitter to resume times; use a shared rate limiter, such as a Redis token bucket at 200 rps that all pods draw from, so the total is enforced; or route all partner calls through a single egress proxy with a global limit. Then AIMD only fine-tunes around a hard global cap."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-10',
      difficulty: 'hard',
      question:
        'After a producer deploy, one partition\'s consumer throws "Unexpected token < in JSON" on every attempt; lag grows only on that partition. What is the correct long-term handling?',
      options: [
        'Increase retries with exponential backoff so the message eventually parses',
        'Treat deserialization errors as permanent: route the raw message to a DLQ with error and origin headers, alert, and continue. Add schema validation or a registry at the producer',
        'Reset the consumer group offset to latest to skip past the problem',
        'Restart the consumer pods so they reload the correct schema',
      ],
      correct: [1],
      explanation:
        'Bytes that are not valid JSON never become valid through retrying, so this is a classic poison pill. Dead-letter it with context and keep the partition flowing, then prevent recurrence with producer-side schemas and compatibility checks. Resetting to latest also skips every good message behind it. Restarts change nothing, because the bad bytes are already in the log.',
      followUps: [
        {
          "q": "After the fix, 50K bad messages are in the DLQ. How do you safely redrive them once the producer is fixed?",
          "a": "The bad bytes are in the DLQ, so redriving them unchanged fails again. First decide whether they can be repaired (for example, the producer wrapped JSON in an HTML error page, so the original payload is recoverable or can be regenerated from the source system). Write a redrive tool that reads the DLQ, applies the repair or re-fetches the event from the producer's outbox by id, validates against the schema, and republishes to the main topic at a capped rate, say 1K/s, to avoid a lag spike. Handlers are idempotent, so overlaps are safe. Track counts: redriven, still failing, discarded with a recorded reason."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-11',
      difficulty: 'expert',
      question: 'This consumer implements a "10-minute retry tier". What goes wrong in production?',
      code: {
        language: 'typescript',
        code: `// consumer for topic orders.retry.10m
eachMessage: async ({ message }) => {
  const due = Number(message.headers!['x-not-before']!.toString());
  const wait = due - Date.now();
  if (wait > 0) await sleep(wait);          // up to 10 minutes
  await handleOrder(message);
},`,
      },
      options: [
        'Sleeping for up to 10 minutes inside the handler exceeds the consumer\'s liveness deadlines (rebalance timeout, max.poll interval), so the member is kicked, partitions move, and the same messages are re-slept and re-processed. Pause the partition and resume at the due time instead',
        'Nothing: sleeping keeps the message\'s offset uncommitted, which is exactly what we want',
        'sleep() blocks the Node event loop, so all partitions on the pod freeze',
        'Retry topics must be read with fromBeginning: true, or the delay is ignored',
      ],
      correct: [0],
      explanation:
        'A 10-minute await inside the handler looks like a hung consumer to the group. After the relevant timeout the member is removed, and the new owner starts the same waits, which creates a loop of rebalances and duplicates. Pausing the partition until the due time keeps membership healthy. sleep() as a promise does not block the event loop, and fromBeginning is unrelated to delays.',
      followUps: [
        {
          "q": "Implement the retry-tier consumer correctly. How does it wait 10 minutes without sleeping in the handler?",
          "a": "Read a message and check its `x-not-before` header. If the due time is in the future, don't process it: `pause([{ topic, partitions: [partition] }])`, seek back to this offset so it is re-fetched, and schedule `resume()` with a timer at the due time. Messages in a retry topic are appended in order of failure time, so they are roughly ordered by due time; once the head is due, most of what follows is too. The consumer keeps polling (paused partitions return nothing), so heartbeats and poll deadlines stay healthy and there is no rebalance loop."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-12',
      difficulty: 'hard',
      question:
        'A campaign will cause a 10× traffic spike for 20 minutes into a queue-backed pipeline. Select ALL statements that are true.',
      options: [
        'The queue lets downstream services run at their sustainable rate; the spike becomes temporary lag',
        'Queue retention must exceed the spike duration plus the drain time, or messages will expire before being processed',
        'Autoscaling consumers beyond the partition count increases throughput during the spike',
        'Users of asynchronous results (emails, projections) will see increased delay proportional to the backlog',
        'Once there is a queue, consumer capacity no longer needs planning',
      ],
      correct: [0, 1, 3],
      explanation:
        'Load leveling converts overload into lag. Retention bounds how long the backlog can wait, and the delay users see grows with the backlog. Consumers beyond the partition count sit idle. Capacity still decides drain time and whether the backlog ever clears: if average capacity is below the average arrival rate, the queue grows without bound.',
      followUps: [
        {
          "q": "The campaign must still send order-confirmation emails within 2 minutes, even though projections can lag 45 minutes. How do you design for that?",
          "a": "Separate traffic by priority instead of sharing one backlog. Publish confirmations to their own topic (or partition set) with a dedicated consumer group sized for spike rate, kept light so a 20K/s spike needs only email-sending capacity. Projections and analytics consume the order stream on their own groups and just lag. If the bottleneck is shared, such as the email provider or DB, reserve capacity: for example, give confirmations a dedicated connection pool or rate-limit quota. Monitor time lag per priority class with separate SLOs."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-13',
      difficulty: 'medium',
      question:
        'Your platform delivers webhooks to customer endpoints. A customer\'s endpoint is down for 2 hours. What should the sender do?',
      options: [
        'Drop the events after 3 failed attempts in quick succession to protect the platform',
        'Switch the customer to polling automatically and delete their webhook subscription',
        'Retry every second until it succeeds, so the customer gets the data as soon as possible',
        'Retry with exponential backoff and jitter over hours to days, keep a stable event id and a signature on every attempt, and offer a way to list and replay missed events',
      ],
      correct: [3],
      explanation:
        'Mature webhook senders (Stripe, GitHub) retry with backoff for a long horizon, and a stable event id lets receivers dedupe retried deliveries. Signatures let the receiver verify each attempt, and a replay API recovers anything that still fails. Dropping after 3 attempts loses data for a routine outage. Per-second retries hammer a struggling endpoint. Silently removing the subscription breaks the integration.',
      followUps: [
        {
          "q": "One customer's slow endpoint (10 s per request) is delaying webhooks for every other customer. How do you isolate tenants in the sender?",
          "a": "Don't let one shared worker pool block on a single endpoint. Put per-endpoint concurrency limits and short timeouts (for example 5 s) on deliveries, and queue per endpoint (or shard by endpoint hash) so a slow endpoint only backs up its own queue. Track per-endpoint health: after repeated failures, move that endpoint to a slow lane with longer backoff and drop its concurrency to 1, then email the customer. Healthy endpoints keep sub-second delivery. This is the bulkhead pattern applied per tenant. Measure delivery latency percentiles per endpoint, not just globally."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-14',
      difficulty: 'expert',
      question:
        'SQS FIFO queue, MessageGroupId = customerId, redrive policy maxReceiveCount = 5. One message for customer C fails every time. What do other messages experience?',
      options: [
        'All messages in the queue are blocked until the failing message is deleted',
        'Nothing is blocked: FIFO queues skip failed messages and retry them at the end of the group',
        'Messages for customer C are blocked behind it until it has been received 5 times and moved to the DLQ. Other customers\' groups continue. After that, C\'s later messages proceed, which may break C\'s business ordering',
        'The failing message is retried forever, because FIFO queues do not support DLQs',
      ],
      correct: [2],
      explanation:
        'FIFO ordering is per message group, so an unacknowledged message holds back its own group only, and other groups are delivered in parallel. After maxReceiveCount it is dead-lettered and the group resumes, so later events for C are processed without the failed one. That is a correctness issue for ordered workflows (use sequence checks). FIFO queues do support DLQs, and they don\'t reorder failed messages to the end.',
      followUps: [
        {
          "q": "C's failed message was 'AccountCreated', so all of C's later messages are meaningless without it. How should the consumer handle the post-DLQ messages?",
          "a": "Add sequence awareness. Each message carries a per-customer sequence number, and the consumer stores the last applied sequence for C. If the next message's sequence is not last+1, the predecessor is missing: don't apply it. Park it (in a holding table or by sending it to a 'blocked' DLQ referencing the gap) and alert. Once an operator fixes and redrives `AccountCreated`, process the parked messages in sequence order. This makes the DLQ step explicit rather than silently continuing the group out of order. Alternatively, use maxReceiveCount high enough that transient errors never trigger it."
        }
      ],
    },
    {
      id: 'mq-scenarios-mcq-15',
      difficulty: 'expert',
      question: 'A consumer uses this dedup approach. The pod is OOM-killed right after the first query commits. What happens to that event?',
      code: {
        language: 'typescript',
        code: `// autocommit mode: each query is its own transaction
const r = await pg.query(
  'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
  [evt.eventId]);
if (r.rowCount === 0) return;               // already processed
await pg.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2',
  [evt.amount, evt.accountId]);`,
      },
      options: [
        'It is processed twice, because the offset was not committed',
        'It is lost: on redelivery the dedup row already exists, so the handler returns early and the balance update never happens',
        'It is processed exactly once, because the dedup insert is idempotent',
        'Postgres rolls back the dedup insert when the client connection drops',
      ],
      correct: [1],
      explanation:
        'The marker committed on its own, before the effect. The redelivered event is treated as a duplicate and skipped, so the credit is silently lost. The dedup insert and the balance update must be in the same transaction, so a crash undoes both. Postgres only rolls back uncommitted work on disconnect, and this insert had already committed.',
      followUps: [
        {
          "q": "The balance update runs against a different database from the dedup table. You can't use one transaction. What now?",
          "a": "Put the dedup marker where the effect lives. Make the balance update itself idempotent: store each credit as a row keyed by eventId in the balance DB (`INSERT ... ON CONFLICT DO NOTHING`) and derive or update the balance in that same local transaction. The separate dedup table becomes unnecessary. If the effect is in a system you don't control, pass an idempotency key to it. Only fall back to cross-database 2PC or a saga if neither is possible. The rule is that the dedup check and the effect must commit atomically in one store."
        }
      ],
    },
  ],
};

export default topic;
