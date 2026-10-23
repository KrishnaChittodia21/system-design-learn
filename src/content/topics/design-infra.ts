import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-infra',
  phase: 'designs',
  order: 4,
  title: 'Infrastructure Systems: Distributed Message Queue, Metrics Monitoring, Ad Click Aggregation, Job Scheduler & Logging Platform',
  subtitle:
    'Designing the systems other systems stand on — a Kafka-like log, a time-series monitoring stack, an exactly-once click pipeline, a distributed scheduler, and a log platform with tiered storage.',
  estimatedMinutes: 170,
  sources: [
    'Pelkonen et al. — Gorilla: A Fast, Scalable, In-Memory Time Series Database (VLDB 2015)',
    'Varghese & Lauck — Hashed and Hierarchical Timing Wheels (1987); Kafka purgatory design',
    'Apache Kafka documentation (replication, ISR, idempotent producer, transactions, KRaft)',
  ],
  tags: [
    'message-queue',
    'kafka',
    'replication',
    'isr',
    'consumer-groups',
    'time-series',
    'monitoring',
    'alerting',
    'downsampling',
    'stream-processing',
    'exactly-once',
    'watermarks',
    'job-scheduler',
    'timing-wheel',
    'logging',
    'tiered-storage',
  ],
  cheatSheet: [
    'MQ storage: partition = append-only segmented log (Kafka default 1 GB segments) + sparse offset index; sequential I/O, OS page cache, zero-copy sendfile, batching + compression → 100s of MB/s per broker.',
    'Durability knobs: RF=3, acks=all, min.insync.replicas=2 → survives 1 broker loss without losing acked writes; acks=1 can lose data on leader failover; unclean leader election trades durability for availability.',
    'Consumer groups: each partition consumed by exactly one member of a group; ordering is per partition only; commit offsets after processing for at-least-once, before for at-most-once; exactly-once = idempotent producer + transactions (read-process-write inside Kafka) or idempotent sinks.',
    'Metrics: ~10M active series (1,000 pools × 100 hosts × 100 metrics); write-heavy, read-spiky; TSDB with Gorilla compression (delta-of-delta timestamps + XOR values ≈ 1.37 B/sample).',
    'Pull (Prometheus: scrape /metrics, easy health detection) vs push (agents → collector/Kafka: short-lived jobs, firewalls, multi-DC); downsample raw → 1-min (30 d) → 1-h (1 yr); cardinality (labels like user_id) is the #1 killer.',
    'Alerting: rules evaluated on a schedule → alert manager (dedup, group, inhibit, silence, route) → PagerDuty/Slack/email; alert on symptoms (SLO burn rate), not every cause.',
    'Ad clicks: 1B clicks/day ≈ 10K QPS avg, 50K peak; 0.1 KB/event ≈ 100 GB/day; aggregate per ad per minute + top-100 per minute; results are billing data → correctness first.',
    'Streaming correctness: event time + watermarks (allowed lateness), tumbling windows per minute, dedup by click_id, exactly-once by committing offsets atomically with results; nightly batch reconciliation against raw data; kappa (replay the log) over lambda (two code paths).',
    'Job scheduler: jobs table indexed by next_run_at, partitioned; schedulers own partitions via leases; near-term jobs in a (hierarchical) timing wheel; workers claim with lease + fencing token; handlers must be idempotent because execution is at-least-once.',
    'Logging platform: agents (Fluent Bit/Vector) → Kafka (buffer) → processors (parse, enrich, redact PII, sample) → index (Elasticsearch/OpenSearch or Loki) with hot (SSD, 1–7 d) → warm → cold/frozen (S3) lifecycle; raw archive in S3 for replay and compliance.',
  ],
  sections: [
    {
      heading: 'Distributed Message Queue (1/3): requirements, messaging model & high-level design',
      body: `**Intuition:** a Kafka-style queue is a **giant, replicated, append-only notebook split into chapters (partitions)**. Producers write at the end; each consumer keeps a bookmark (offset). Nothing is deleted when read — it expires by retention — so many readers can replay the same data.

**Requirements:** producers send, consumers consume; messages can be **consumed repeatedly** (and by multiple consumer groups); old data is truncated by **retention (e.g. 2 weeks)**; message size KB range; **ordering** preserved (within a partition); configurable delivery semantics (at-most-once / at-least-once / exactly-once); configurable **throughput vs latency**; scalable; persistent and durable.

**Traditional queue vs event-streaming log:**

| | RabbitMQ/SQS-style queue | Kafka/Pulsar-style log |
|---|---|---|
| After consume | Message deleted (acked) | Stays until retention |
| Replay | No | Yes — reset offsets |
| Multiple independent readers | Needs fan-out exchange/copies | Native (consumer groups) |
| Ordering | Per queue, weakened by competing consumers | Per partition, strict |
| Per-message routing, priorities, delays | Rich | Minimal |

**Core concepts:**
- **Topic** → split into **partitions** (unit of parallelism and ordering). A message's key (e.g. user_id) hashes to a partition → all events of a key stay ordered.
- **Broker**: a server hosting partition replicas.
- **Consumer group**: a set of consumers sharing work; each partition is assigned to **exactly one** consumer in the group → max parallelism = number of partitions.
- **Offset**: position in a partition; consumers commit offsets (Kafka stores them in the internal \`__consumer_offsets\` topic).
- **Metadata/coordination**: cluster membership, partition leadership, configs — historically ZooKeeper, now Kafka's built-in Raft (**KRaft**; Kafka 4.0 removed ZooKeeper entirely).

**High-level flow:** producer (with a buffer + routing layer that knows partition leaders) → leader replica of the partition → followers replicate → consumer group coordinator assigns partitions → consumers pull (fetch) from leaders in batches. **Pull, not push**: consumers control their rate, batch naturally, and can rewind; long-polling fetches avoid busy loops.`,
      diagram: `  producers (key -> partition)                 consumer group "billing"
   P1  P2  P3                                    C1        C2
    |   |   |                                    ^         ^
    v   v   v                                    | fetch   | fetch
 +------------------------------------------------------------------+
 | Broker 1              Broker 2               Broker 3            |
 | topic A p0 (LEADER)   topic A p0 (follower)  topic A p1 (LEADER)  |
 | topic A p1 (follower) topic A p2 (LEADER)    topic A p2 (follower)|
 +------------------------------------------------------------------+
        ^  replication (followers fetch from leader, ISR tracking)
        |
 +-------------------------+     +-------------------------------+
 | Controller quorum (KRaft|     | Group coordinator: partition  |
 | / ZooKeeper): metadata, |     | assignment, offsets in        |
 | leader election         |     | __consumer_offsets            |
 +-------------------------+     +-------------------------------+`,
      keyPoints: [
        'Log, not queue: consumption doesn’t delete; retention does.',
        'Partitions give parallelism and per-key ordering; one consumer per partition per group.',
        'Consumers pull in batches; metadata via KRaft (ZooKeeper removed in Kafka 4.0).',
      ],
    },
    {
      heading: 'Distributed Message Queue (2/3): the storage engine — segments, indexes, batching & zero-copy',
      body: `**Why a log is fast:** disks are terrible at random I/O but great at sequential I/O (hundreds of MB/s even on HDDs; GB/s on NVMe). An append-only log never seeks on write and reads are mostly sequential scans from an offset.

**On-disk layout per partition:**
- The log is split into **segments** (Kafka default 1 GB or 7 days). Only the active segment is appended to; old segments are immutable and deleted/compacted as a whole by retention — cheap.
- Each segment has a **sparse offset index** (an entry every ~4 KB of log: offset → byte position) and a **time index** (timestamp → offset). To read offset N: binary search the segment by base offset (file name), binary search the index, then scan forward a few KB.

**Message format (a record batch):** base offset, CRC, attributes (compression), producer ID + epoch + base sequence (for idempotence), timestamps, then records (key, value, headers). **Batching** amortises headers, syscalls and network round trips; **compression** (lz4/zstd) works per batch and the broker stores it compressed — decompression happens only at the consumer.

**Throughput tricks:**
- **OS page cache** instead of an application cache: recently written data is read by consumers straight from memory; the broker process stays small (JVM heap ~6 GB even on 64+ GB boxes).
- **Zero-copy** (\`sendfile\`): bytes go from page cache to the socket without passing through user space (not possible with TLS in the kernel path unless kTLS).
- **Producer batching knobs:** \`linger.ms\` (wait to fill a batch) and \`batch.size\` — the throughput-vs-latency dial the requirements asked for.

**Log compaction** (optional per topic): keep only the latest value per key — turns a topic into a durable changelog/table (used for \`__consumer_offsets\` and CDC).

**Retention math:** 2 weeks × ingest rate × RF is your disk bill; tiered storage (KIP-405, GA in Kafka 3.9) offloads old segments to S3 so brokers keep only recent data locally.`,
      code: [
        {
          language: 'typescript',
          title: 'Locating an offset: segment by base offset, then the sparse index, then a short scan',
          code: `type IndexEntry = { relOffset: number; position: number };   // every ~4 KB of log
type Segment = { baseOffset: number; index: IndexEntry[]; file: string };

/** Largest element with key <= target (classic floor binary search). */
function floor<T>(arr: T[], target: number, key: (t: T) => number): T | undefined {
  let lo = 0, hi = arr.length - 1, ans: T | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) <= target) { ans = arr[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function locate(segments: Segment[], offset: number) {
  // Segment files are named by base offset: 00000000000000368769.log etc.
  const seg = floor(segments, offset, (s) => s.baseOffset);
  if (!seg) throw new Error('OFFSET_OUT_OF_RANGE (deleted by retention)');
  const entry = floor(seg.index, offset - seg.baseOffset, (e) => e.relOffset);
  return {
    file: seg.file,
    startPosition: entry?.position ?? 0,     // then scan forward <= ~4 KB of batches
    scanUntilOffset: offset,
  };
}

// Example: segments at base offsets 0, 368769, 737337; fetch offset 400000
// -> segment 368769, relOffset 31231, index floor -> byte 5_231_104, scan a few KB.`,
        },
      ],
      keyPoints: [
        'Segmented append-only log + sparse offset index + time index.',
        'Batching, compression, page cache and zero-copy give the throughput.',
        'Retention deletes whole segments; compaction keeps the latest per key; tiered storage offloads to S3.',
      ],
      source: 'Kafka docs (log, segments)',
    },
    {
      heading: 'Distributed Message Queue (3/3): replication, ISR, consumer rebalancing & delivery semantics',
      body: `**Replication:** each partition has one **leader** and followers on other brokers (RF = 3 typical, spread across racks/AZs). Followers fetch from the leader like consumers. The **in-sync replica set (ISR)** contains replicas caught up within \`replica.lag.time.max.ms\` (default 30 s).

**Producer acks:**
| acks | Waits for | Risk |
|---|---|---|
| 0 | Nothing | Lost on any failure — metrics/logs only |
| 1 | Leader write | Lost if leader dies before followers copy |
| all (-1) | All ISR replicas | Safe if ISR ≥ \`min.insync.replicas\`; with RF=3 and min ISR=2 you tolerate one broker down |

A message is **committed** once all ISR replicas have it; consumers only see messages up to the **high watermark**. \`unclean.leader.election.enable=false\` (default) forbids electing an out-of-sync replica — availability loss instead of data loss.

**Consumer rebalancing:** the group coordinator (a broker) tracks members via heartbeats. On join/leave/crash (missed \`session.timeout.ms\`) or when processing exceeds \`max.poll.interval.ms\`, it triggers a **rebalance** and a leader member computes the assignment. Eager rebalancing stops the world; **cooperative-sticky** rebalancing and KIP-848 (new broker-side protocol) move only the affected partitions. Static membership (\`group.instance.id\`) avoids rebalances on rolling restarts.

**Delivery semantics:**
- **At-most-once:** commit offset, then process. Crash → message skipped.
- **At-least-once:** process, then commit. Crash → reprocess → handlers must be **idempotent**.
- **Exactly-once:** (a) **idempotent producer** (producer ID + per-partition sequence numbers — broker drops duplicates from retries) + (b) **transactions**: consume → produce outputs and commit input offsets **atomically** (\`sendOffsetsToTransaction\`); downstream consumers use \`isolation.level=read_committed\`. For side effects outside Kafka (DB writes, emails), exactly-once requires an idempotent sink or storing offsets in the same DB transaction as results.

**Scaling:** add brokers and reassign partitions (data movement — throttle it); adding partitions to a keyed topic **changes key → partition mapping** and breaks per-key ordering during the transition — over-provision partitions up front.`,
      code: [
        {
          language: 'typescript',
          title: 'kafkajs: exactly-once read-process-write with an idempotent transactional producer',
          code: `import { Kafka } from 'kafkajs';

const kafka = new Kafka({ clientId: 'enricher', brokers: ['b1:9092', 'b2:9092', 'b3:9092'] });
const producer = kafka.producer({
  idempotent: true,                    // producerId + sequence numbers: broker dedups retries
  transactionalId: 'enricher-1',       // stable per instance: fences zombie instances
  maxInFlightRequests: 1,
});
const consumer = kafka.consumer({ groupId: 'enricher', readUncommitted: false });

export async function run(enrich: (v: Buffer) => Buffer) {
  await Promise.all([producer.connect(), consumer.connect()]);
  await consumer.subscribe({ topic: 'clicks-raw' });
  await consumer.run({
    autoCommit: false,                  // offsets are committed INSIDE the transaction
    eachBatch: async ({ batch, heartbeat }) => {
      const tx = await producer.transaction();
      try {
        await tx.send({
          topic: 'clicks-enriched',
          acks: -1,                     // all in-sync replicas
          messages: batch.messages.map((m) => ({ key: m.key, value: enrich(m.value!) })),
        });
        await tx.sendOffsets({          // input offsets commit atomically with outputs
          consumerGroupId: 'enricher',
          topics: [{ topic: batch.topic, partitions: [{
            partition: batch.partition,
            offset: (BigInt(batch.lastOffset()) + 1n).toString(),  // next offset to read
          }] }],
        });
        await tx.commit();
      } catch (e) {
        await tx.abort();               // nothing visible to read_committed consumers
        throw e;                        // batch is re-fetched from the last committed offset
      }
      await heartbeat();
    },
  });
}`,
        },
      ],
      keyPoints: [
        'RF=3 + acks=all + min.insync.replicas=2 = no acked-data loss with one broker down.',
        'Rebalances: cooperative-sticky, static membership, KIP-848 to reduce stop-the-world.',
        'Exactly-once = idempotent producer + transactions (inside Kafka) or idempotent/transactional sinks outside.',
      ],
      source: 'Kafka docs (replication, transactions)',
    },
    {
      heading: 'Metrics Monitoring (1/3): requirements, data model & time-series storage',
      body: `**Intuition:** metrics are billions of tiny "(what, where, when, how much)" tuples, written constantly and read in bursts (dashboards, alerts, incidents). A time-series database is optimised for exactly that shape.

**Requirements:** monitor a large infra — 100M DAU product, **1,000 server pools × 100 machines × ~100 metrics ≈ 10M metrics** (series); 1-year retention with policy **raw for 7 days, 1-minute rollups for 30 days, 1-hour rollups for 1 year**; metrics: CPU, memory, disk, request counts, latency, queue lag…; alerting and visualization. Out of scope: log monitoring and distributed tracing (separate systems).

**Non-functional:** scalability with growing series, low query latency for dashboards/alerts, **reliability** (don't miss critical alerts — the monitoring system must be more available than what it monitors), flexibility (plug in new sources/sinks).

**Data model:** a series is identified by metric name + labels; each point is (timestamp, float value).
- \`http_requests_total{service="checkout", region="us-east-1", code="500"} 1712345678 1024\`
- Write load: 10M series ÷ 10 s scrape interval ≈ **1M samples/s**.
- Reads: dashboards and alert rules issue range queries with aggregations (\`rate()\`, \`sum by\`, percentiles over histograms).

**Why not Postgres/MySQL?** Possible at small scale, but general-purpose DBs struggle with 1M inserts/s of tiny rows, time-window aggregations, and cheap retention. Cassandra/Bigtable work (OpenTSDB on HBase), but you'd reinvent compression and rollups. Purpose-built TSDBs: **Prometheus** (single-node, pull), **M3** (Uber), **VictoriaMetrics**, **Thanos/Cortex/Mimir** (Prometheus + object storage, horizontally scalable), **InfluxDB**, **Timescale**.

**Gorilla-style compression (Facebook):** timestamps stored as **delta-of-delta** (regular intervals → mostly 0 → 1 bit), values as **XOR with previous value** (slowly changing floats share most bits) → **~1.37 bytes per sample** instead of 16. That's why a TSDB keeps weeks of hot data in memory/SSD cheaply.

**Cardinality is the killer:** labels multiply series. Adding \`user_id\` or \`request_id\` as a label can turn 10M series into billions and take down the TSDB. Enforce label allow-lists and per-tenant series limits.`,
      code: [
        {
          language: 'typescript',
          title: 'prom-client in NestJS/Node: bounded labels, histogram for latency',
          code: `import client from 'prom-client';

client.collectDefaultMetrics();                 // process CPU, heap, event-loop lag

export const httpDuration = new client.Histogram({
  name: 'http_server_duration_seconds',
  help: 'HTTP server latency',
  // BOUNDED labels only: route template (not raw URL), method, status class
  labelNames: ['route', 'method', 'status_class'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export function observe(routeTemplate: string, method: string, status: number, seconds: number) {
  httpDuration.labels(routeTemplate, method, Math.floor(status / 100) + 'xx').observe(seconds);
  // NEVER: .labels(req.url, userId) -> unbounded cardinality, one series per user
}

// Exposed at GET /metrics for Prometheus to scrape (pull model)
export async function metricsHandler(): Promise<{ body: string; contentType: string }> {
  return { body: await client.register.metrics(), contentType: client.register.contentType };
}

// Series count for this histogram:
// routes(50) x methods(4) x status classes(5) x (10 buckets + sum + count) = 12,000 series/pod`,
        },
      ],
      keyPoints: [
        '~10M series, ~1M samples/s; tiered retention raw 7 d → 1 min 30 d → 1 h 1 yr.',
        'TSDB with Gorilla compression ≈ 1.37 B/sample.',
        'Cardinality control (no user_id labels) is an operational must.',
      ],
      source: 'Gorilla paper (VLDB 2015)',
    },
    {
      heading: 'Metrics Monitoring (2/3): collection — pull vs push, Kafka buffering & aggregation points',
      body: `**Pull (Prometheus):** the collector discovers targets (Kubernetes API, Consul, etcd) and scrapes \`/metrics\` every 10–60 s.
**Push (StatsD, OpenTelemetry OTLP, CloudWatch agent, Graphite):** agents on each host send metrics to a collector endpoint.

| | Pull | Push |
|---|---|---|
| Health detection | Failed scrape = target down, immediately visible | Missing data could be down *or* network issue |
| Short-lived jobs (batch, serverless) | May finish before scrape → need Pushgateway | Natural fit |
| Firewalls / multi-DC / NAT | Collector must reach every target | Agents push outward through one endpoint |
| Performance | Scrapes over HTTP; collector controls rate | Often UDP (StatsD) or batched gRPC; senders can overwhelm collector |
| Data authenticity | Only scrapes known targets | Need auth/allow-listing of senders |

Large companies use **both**: pull inside clusters, push for serverless/edge, unified by OpenTelemetry collectors.

**Scaling the pull collectors:** shard targets across a pool of collectors with **consistent hashing** on target ID so each target is scraped by exactly one collector; ring membership in etcd/ZooKeeper.

**Kafka between collectors and the TSDB:** decouples ingestion from storage — if the TSDB is slow or down for maintenance, data buffers in Kafka instead of being dropped; also lets multiple consumers (stream alerting, anomaly detection, long-term storage) read the same stream. Partition by metric name (and labels) so consumers can aggregate. Downside: another system to run — Facebook's Gorilla/Beringei ingests directly, trading buffering for simplicity.

**Where to aggregate (pre-reduce data):**
- **Collection agent**: simple aggregation (e.g. counter sums per minute) before sending.
- **Ingestion pipeline** (Flink/Kafka Streams): rollups before writing — much less storage, but you lose raw precision and late-arriving data handling gets tricky.
- **Query time**: keep raw, aggregate when queried — flexible but slower.`,
      diagram: `  targets (pods/hosts)            short-lived jobs / serverless
   /metrics endpoints               |  push (OTLP / StatsD)
        ^  scrape (pull)            v
  +-------------------+     +------------------+
  | collectors (ring  |     | push gateway /   |
  | of shards, etcd)  |     | OTel collector   |
  +---------+---------+     +--------+---------+
            |                        |
            v                        v
        +--------------------------------+
        | Kafka (partition by metric)    |  buffer, fan-out
        +------+---------------+---------+
               |               |
               v               v
      +----------------+  +------------------+
      | TSDB ingesters |  | stream alerting / |
      | (hot: mem+SSD) |  | anomaly detection |
      +-------+--------+  +------------------+
              | downsample + compact
              v
      object storage (1-min / 1-h rollups, 1 year)`,
      keyPoints: [
        'Pull gives free liveness; push suits short-lived jobs and restricted networks — use both.',
        'Shard scrape targets with consistent hashing; buffer with Kafka.',
        'Aggregate at agent, pipeline or query time — precision vs cost.',
      ],
    },
    {
      heading: 'Metrics Monitoring (3/3): query, storage tiers, alerting & visualization',
      body: `**Query service:** exposes PromQL/SQL-like queries; a **cache** stores results for repeated dashboard panels (e.g., last-24h panels refreshed every 30 s: cache aligned time buckets and only compute the newest bucket). Query splitting by time range and parallelism across shards (Thanos/Mimir query frontends).

**Storage optimizations:**
- **Data encoding & compression** (Gorilla).
- **Downsampling**: raw 7 days → 1-minute resolution for 30 days → 1-hour for 1 year. Keep min/max/sum/count per bucket so averages and extrema remain correct.
- **Cold storage**: old, rarely queried data in object storage at a fraction of the cost.
- Space math: 10M series × 8,640 samples/day (one per 10 s) × 1.37 B ≈ **118 GB/day** of compressed raw data (~830 GB for the 7-day raw tier, before replication).

**Alerting pipeline:**
1. **Rules** (YAML, in git) are evaluated at intervals against the TSDB.
2. **Alert manager**: dedup (same alert from many rule evaluators), **group** (one page for 200 pods failing, not 200 pages), **inhibit** (don't page "high latency" if "region down" is firing), **silence** (maintenance windows), **route** by team/severity.
3. Alert state stored durably (Cassandra/etcd) with retries until the notification is acknowledged; delivery via PagerDuty/Opsgenie, Slack, email, webhooks — through Kafka so a slow channel doesn't block others.

**Alert design (what seniors say):** page on **symptoms** users feel (error rate, latency SLO burn rate), not causes (CPU 80%). Use **multi-window burn-rate alerts** (Google SRE workbook): e.g. page if 2% of a 30-day error budget burns in 1 h (fast burn, 14.4× rate) or 5% in 6 h (6×); ticket on slower burns. Every page must be actionable.

**Visualization:** Grafana on top of the query service. Build vs buy: most teams **buy** (Datadog, Grafana Cloud, New Relic) or run open-source (Prometheus + Thanos/Mimir + Grafana); the interview asks you to design one, but mention the trade-off.

**Meta-monitoring:** monitor the monitoring system from outside (a separate small Prometheus, dead-man's switch alert that must always fire — if it stops, the pipeline is broken).`,
      code: [
        {
          language: 'yaml',
          title: 'Prometheus rules: recording rule + multi-window SLO burn-rate alert',
          code: `groups:
  - name: checkout-slo
    rules:
      # Recording rule: precompute error ratio so alerts/dashboards are cheap
      - record: service:http_error_ratio:rate5m
        expr: |
          sum by (service) (rate(http_server_duration_seconds_count{status_class="5xx"}[5m]))
          /
          sum by (service) (rate(http_server_duration_seconds_count[5m]))
      - record: service:http_error_ratio:rate1h
        expr: |
          sum by (service) (rate(http_server_duration_seconds_count{status_class="5xx"}[1h]))
          /
          sum by (service) (rate(http_server_duration_seconds_count[1h]))

      # SLO 99.9% => error budget 0.1%. Fast burn = 14.4x budget rate.
      - alert: CheckoutErrorBudgetFastBurn
        expr: |
          service:http_error_ratio:rate1h{service="checkout"} > (14.4 * 0.001)
          and
          service:http_error_ratio:rate5m{service="checkout"} > (14.4 * 0.001)
        for: 2m
        labels:
          severity: page
          team: payments
        annotations:
          summary: 'Checkout burning 2% of monthly error budget per hour'
          runbook: 'https://runbooks.internal/checkout/error-budget'

      # Dead man's switch: always firing; alert manager pages if it STOPS arriving
      - alert: Watchdog
        expr: vector(1)
        labels:
          severity: none`,
        },
      ],
      keyPoints: [
        'Downsample with min/max/sum/count; cold data to object storage.',
        'Alert manager: dedup, group, inhibit, silence, route; durable retries.',
        'Page on SLO burn rate; monitor the monitor (dead man’s switch).',
      ],
      source: 'Google SRE Workbook — Alerting on SLOs',
    },
    {
      heading: 'Ad Click Aggregation (1/4): requirements, estimation & data model',
      body: `**Intuition:** every ad click is a coin in a till. Advertisers are billed from the totals, so this is an **accounting system disguised as a streaming system** — being a few minutes late is fine, being wrong is not.

**Requirements:**
- Aggregate the number of clicks of \`ad_id\` in the last M minutes.
- Return the **top 100 most clicked ads** every minute.
- Support **filtering** by attributes (ip, user_id, country).
- Data volume at Facebook/Google scale.
**Non-functional:** correctness (billing, RTB bidding), handle **delayed and duplicate events**, robustness to partial failures, **end-to-end latency of a few minutes at most**.

**Estimation:** 1B DAU, 1 click/user/day → **1B clicks/day** → 10^9 ÷ 10^5 = **10K QPS** avg, peak 5× = **50K QPS**; 2M ads total; click events grow **30% YoY**. 0.1 KB per event → **100 GB/day**, ~3 TB/month.

**Query API (for dashboards/billing):**
- \`GET /v1/ads/{ad_id}/aggregated_count?from=&to=&filter=\` → {ad_id, count}
- \`GET /v1/ads/popular_ads?count=100&window=1&filter=\` → {ad_ids: [...]}

**Data model — store both raw and aggregated:**

| | Raw events | Aggregated (per ad, per minute, per filter) |
|---|---|---|
| Content | ad_id, click_timestamp, user_id, ip, country, click_id | ad_id, click_minute, filter_id, count |
| Use | Replay/recalculation, debugging, reconciliation (cold storage) | Fast queries, dashboards, billing |
| Size | 100 GB/day | Orders of magnitude smaller |

**Filtering via a star schema:** pre-define filters (e.g. country=US) as dimensions and aggregate per (ad, minute, filter_id) — queries are pre-computed and fast, at the cost of more buckets.

**DB choice:** write-heavy time-series-ish data with simple queries → **Cassandra** or a time-series DB (InfluxDB); ClickHouse/Druid if ad-hoc slicing matters. Raw data in **S3 in a columnar format** (Parquet/ORC) for batch reprocessing.`,
      keyPoints: [
        '1B clicks/day ≈ 10K QPS avg / 50K peak; 100 GB/day raw.',
        'Keep raw (replay, reconciliation) and aggregated (queries) data.',
        'Pre-defined filter dimensions (star schema) keep queries fast.',
      ],
    },
    {
      heading: 'Ad Click Aggregation (2/4): architecture & the MapReduce-style aggregation DAG',
      body: `**Pipeline:** log watcher on ad servers → **Kafka (raw clicks)** → **aggregation service** → **Kafka (aggregated results)** → **database writer** → aggregation DB → query service. Raw events are also written to raw storage (S3/Cassandra).

**Why a second queue for results?** It decouples aggregation from the DB (slow writes don't back-pressure aggregation) and, crucially, is how we get **end-to-end exactly-once**: results + consumed offsets can be committed atomically in Kafka (transactions), and the DB writer can apply them idempotently.

**The aggregation service as a DAG (MapReduce paradigm):**
- **Map nodes** read from Kafka partitions, clean/normalise events (drop malformed, apply filters) and **route by ad_id** (\`ad_id % N\`) so all clicks of an ad reach the same aggregate node.
- **Aggregate nodes** keep in-memory counts per (ad_id, minute, filter) and a per-node **top-K heap**.
- **Reduce node** merges the per-node top-K lists into the global **top 100** each minute (e.g., 3 nodes × top 3 → reduce 9 candidates → global top 3).

Why a Map stage if Kafka already partitions? Input topics may not be partitioned by ad_id, and map nodes can filter and enrich before shuffling. In practice this DAG is a **Flink/Kafka Streams/Spark Structured Streaming** job, and "nodes" are parallel operator instances.

**Top-K correctness note:** merging per-node top-K is exact here only because all clicks of an ad land on one aggregate node (partitioned by key). If counts for one key were split across nodes, local top-K lists could miss a globally heavy key — you'd need to merge full counts or use approximate heavy-hitter sketches.`,
      diagram: `  ad servers --log watcher--> Kafka: clicks-raw (partitioned)
                                   |          |
                                   v          +--> raw store (S3 Parquet)
        +------------- aggregation service (Flink job) -------------+
        |  map (clean, filter, key by ad_id)                       |
        |     |            |             |                         |
        |     v            v             v   shuffle by ad_id      |
        |  aggregate    aggregate     aggregate  (count per ad per |
        |  node 1       node 2        node 3      minute + top-K)  |
        |     \\            |            /                          |
        |      +------> reduce (global top-100 per minute)         |
        +---------------------------+------------------------------+
                                    | results + offsets (atomic)
                                    v
                         Kafka: clicks-aggregated
                                    |
                         database writer (idempotent upserts)
                                    v
        aggregation DB (Cassandra/ClickHouse) <-- query service <-- dashboards`,
      code: [
        {
          language: 'typescript',
          title: 'Per-node aggregation: counts per (ad, minute) + local top-K, then global reduce',
          code: `type Click = { clickId: string; adId: string; ts: number; country: string };

export class AggregateNode {
  // key: minute|adId|filter -> count
  private counts = new Map<string, number>();

  add(c: Click) {
    const minute = Math.floor(c.ts / 60_000);
    for (const filter of ['all', 'country=' + c.country]) {   // star-schema dimensions
      const k = minute + '|' + c.adId + '|' + filter;
      this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    }
  }

  /** Local top-K for a closed minute; exact because ads are partitioned by adId. */
  topK(minute: number, k: number, filter = 'all'): [string, number][] {
    const prefix = minute + '|';
    const rows: [string, number][] = [];
    for (const [key, n] of this.counts) {
      if (!key.startsWith(prefix) || !key.endsWith('|' + filter)) continue;
      rows.push([key.split('|')[1], n]);
    }
    return rows.sort((a, b) => b[1] - a[1]).slice(0, k);   // a size-k heap in production
  }

  evictBefore(minute: number) {                               // bounded state
    for (const key of this.counts.keys()) if (Number(key.split('|')[0]) < minute) this.counts.delete(key);
  }
}

export function reduceTopK(perNode: [string, number][][], k: number) {
  return perNode.flat().sort((a, b) => b[1] - a[1]).slice(0, k);
}`,
        },
      ],
      keyPoints: [
        'Kafka → map → aggregate (by ad_id) → reduce → Kafka → idempotent DB writer.',
        'Second queue enables end-to-end exactly-once and decouples DB speed.',
        'Local top-K merge is exact only when each key lives on one node.',
      ],
    },
    {
      heading: 'Ad Click Aggregation (3/4): event time, watermarks, windows & lambda vs kappa',
      body: `**Event time vs processing time:**
- **Event time** = when the click happened (on the ad server). **Processing time** = when the aggregator sees it.
- Network delays, mobile buffering and consumer lag mean events arrive late and out of order. For billing, we must aggregate by **event time** — otherwise a 5-minute consumer lag moves clicks into the wrong minute.

**Watermarks:** a watermark says "I believe all events with event time ≤ T have arrived". It's typically \`max event time seen − allowed lateness\` (e.g. 15 s–2 min). When the watermark passes the end of a window, the window **fires**. Longer lateness → more accurate, higher latency. Events arriving after the watermark are **late events**: drop, send to a side output for correction, or update the already-emitted result (retractions/upserts).

**Window types:**
| Window | Shape | Use |
|---|---|---|
| **Tumbling** | Fixed, non-overlapping (1 min) | Clicks per ad per minute |
| **Sliding/hopping** | Fixed size, overlapping (last 5 min every 1 min) | Top-100 in the last M minutes |
| **Session** | Gap-based per key | User sessions |

**Lambda vs kappa:**
- **Lambda:** a batch layer (accurate, slow) and a speed layer (fast, approximate) with results merged at serving. Two codebases doing the same logic → drift and double maintenance.
- **Kappa (the classic design's choice):** one streaming path; **recalculation** = replay raw data from storage through the same (or a dedicated instance of the) aggregation service into the results pipeline. Keeping the raw events retained is what makes kappa feasible.

**Recalculation flow (bug found in aggregation logic):** recalculation service reads raw data from storage for the affected time range → dedicated aggregation service (so real-time processing isn't slowed) → second Kafka topic → aggregation DB overwrites affected buckets (idempotent upserts keyed by (ad, minute, filter)).`,
      code: [
        {
          language: 'typescript',
          title: 'Event-time tumbling windows with a watermark and late-event side output',
          code: `type Click = { clickId: string; adId: string; ts: number };
type Emit = (r: { adId: string; windowStart: number; count: number }) => void;

export class TumblingCounter {
  private windows = new Map<number, Map<string, number>>();  // windowStart -> adId -> count
  private maxEventTs = 0;

  constructor(
    private sizeMs = 60_000,
    private allowedLatenessMs = 30_000,
    private emit: Emit = () => {},
    private late: (c: Click) => void = () => {},             // side output for correction
  ) {}

  private watermark() { return this.maxEventTs - this.allowedLatenessMs; }

  onEvent(c: Click) {
    const start = Math.floor(c.ts / this.sizeMs) * this.sizeMs;
    if (start + this.sizeMs <= this.watermark()) return this.late(c); // window already fired
    const w = this.windows.get(start) ?? new Map<string, number>();
    w.set(c.adId, (w.get(c.adId) ?? 0) + 1);
    this.windows.set(start, w);
    this.maxEventTs = Math.max(this.maxEventTs, c.ts);         // event time drives progress
    this.fireReady();
  }

  private fireReady() {
    const wm = this.watermark();
    for (const [start, counts] of [...this.windows].sort((a, b) => a[0] - b[0])) {
      if (start + this.sizeMs > wm) break;                     // not complete yet
      for (const [adId, count] of counts) this.emit({ adId, windowStart: start, count });
      this.windows.delete(start);                              // bounded state
    }
  }
}
// NOTE: with idle partitions the watermark stalls; real engines use per-partition
// watermarks (min across inputs) plus idleness timeouts.`,
        },
      ],
      keyPoints: [
        'Aggregate by event time; watermark = max event time − allowed lateness.',
        'Tumbling for per-minute counts, sliding for last-M-minutes top-K.',
        'Kappa: one streaming codebase + replay from raw storage for recalculation.',
      ],
      source: 'Akidau et al. — Streaming Systems',
    },
    {
      heading: 'Ad Click Aggregation (4/4): exactly-once, dedup, hot spots, fault tolerance & reconciliation',
      body: `**Where duplicates come from:** clients/ad servers retry (same click sent twice — often fraud too), and aggregators reprocess after a crash (at-least-once consumption).

**Exactly-once processing:** the danger window is "results sent downstream, but offset not yet committed" (→ double count on restart) or "offset committed, but results not yet sent" (→ lost clicks). Solution: treat **sending results + committing the consumed offset as one atomic operation** — Kafka transactions, or a distributed transaction, or store the last processed offset *inside* the results store in the same write. Flink achieves this with **checkpoints** (Chandy-Lamport barriers snapshot operator state + source offsets) and **two-phase-commit sinks**.

**Event-level dedup:** each click carries a unique \`click_id\` (generated at the ad server); aggregators dedup within a window (keyed state with TTL, or a Bloom filter for approximate dedup at huge scale). Fraud filtering (bots, click farms) is a separate stage.

**Scaling:**
- Kafka partitions sized for peak growth (30% YoY) — pre-allocate (e.g. 64–128) to avoid repartitioning keyed topics.
- Aggregation parallelism = partitions; state per node is small (per-minute counts).
- **Hot spots:** a Super Bowl ad receives far more clicks than others. Options: split the hot key across sub-keys (\`ad_id#0..7\`) with a second-stage sum; the book's approach — the hot ad's aggregate node requests extra resources and splits its events across additional nodes; or local pre-aggregation in map nodes before the shuffle.
- Database: Cassandra scales writes horizontally; aggregated writes are ~2M ads × a few filters per minute at most.

**Fault tolerance:** aggregation state lives in memory; snapshot it periodically (with the offsets it corresponds to) to durable storage so a replacement node restores the snapshot and replays only from the snapshotted offset.

**Reconciliation (the accountant's check):** a nightly **batch job** re-aggregates the day's raw events by event time (with full knowledge of late data) and compares with the real-time results; mismatches beyond tolerance are investigated and corrected. Billing uses the reconciled numbers.

**Monitoring:** end-to-end latency per stage (event time → result written), Kafka consumer lag, aggregation-node CPU/state size, late-event counts, dedup rates.`,
      code: [
        {
          language: 'sql',
          title: 'Idempotent sink: results and consumed offsets in one DB transaction',
          code: `-- Aggregated results keyed so that replays overwrite instead of double counting
CREATE TABLE ad_clicks_minute (
  ad_id        bigint,
  click_minute timestamptz,
  filter_id    int,
  clicks       bigint NOT NULL,
  PRIMARY KEY (ad_id, click_minute, filter_id)
);

-- Offsets the writer has durably applied, per input partition
CREATE TABLE consumer_offsets (
  topic text, partition int, next_offset bigint NOT NULL,
  PRIMARY KEY (topic, partition)
);

-- One transaction per batch from partition 7 of clicks-aggregated:
BEGIN;
INSERT INTO ad_clicks_minute (ad_id, click_minute, filter_id, clicks)
VALUES ($1, $2, $3, $4)                         -- ... for each result in the batch
ON CONFLICT (ad_id, click_minute, filter_id)
DO UPDATE SET clicks = EXCLUDED.clicks;         -- window results are final values, so SET
UPDATE consumer_offsets SET next_offset = $5    -- last offset in batch + 1
WHERE topic = 'clicks-aggregated' AND partition = 7 AND next_offset <= $5;
COMMIT;
-- On restart the writer seeks Kafka to next_offset from THIS table,
-- not from Kafka's committed offsets: results and progress can never diverge.`,
        },
      ],
      keyPoints: [
        'Atomically commit results + offsets (Kafka transactions, Flink checkpoints + 2PC sinks, or offsets in the sink DB).',
        'Dedup by click_id; filter fraud separately.',
        'Hot ads: key splitting / extra nodes; nightly batch reconciliation for billing.',
      ],
    },
    {
      heading: 'Distributed Job Scheduler (1/2): requirements, architecture & claiming jobs safely',
      body: `**Intuition:** a scheduler is an **alarm clock for millions of tasks**: persist "run X at time T", wake up at T, hand X to a worker exactly once (or as close as physics allows), and remember the result.

**Requirements:** one-off delayed jobs ("send reminder in 24 h") and recurring cron jobs; up to ~100M jobs/day with bursts at round times (00:00, top of the hour); schedule precision ~1 s; retries with backoff; job priorities; dependencies (optional DAGs); visibility (status, history, logs); multi-tenant quotas.
**Non-functional:** no lost jobs (durable), **at-least-once execution with idempotent handlers** (exactly-once is impossible across crashes — say so), horizontal scalability, HA with no single scheduler SPOF.

**Estimation:** 100M jobs/day ≈ 1.2K/s avg, but "midnight" spikes can be 50–100× → design for ~100K due jobs/s in a burst (spread with jitter where semantics allow).

**Architecture:**
1. **API** → **job store**: \`jobs(id, tenant, next_run_at, cron, payload, status, attempts, lease_owner, lease_until, version)\`, partitioned (e.g. hash(job_id) → 1,024 partitions) with an index on (partition, next_run_at) for due jobs.
2. **Scheduler nodes** each own a set of partitions via **leases** in etcd/ZooKeeper (or a DB lease table). Every ~1 s they fetch jobs due in the next window (e.g. next 30 s) from their partitions and load them into an in-memory **timing wheel**.
3. When a job fires, the scheduler **enqueues** it to a work queue (Kafka/SQS) by priority/tenant, marking status QUEUED.
4. **Workers** claim a job execution with a **lease + fencing token**, heartbeat to extend it, run the handler, and record the outcome (SUCCEEDED/FAILED → retry with backoff → DEAD).
5. For cron jobs, compute the next \`next_run_at\` (in the job's time zone, DST-aware) in the same transaction as enqueuing — so a crash never loses the next occurrence.

**Claiming without double-execution races:** in SQL, \`SELECT ... FOR UPDATE SKIP LOCKED\` lets many schedulers/workers grab disjoint rows without blocking each other. A **lease** (lease_until) handles crashed claimers — expired leases are reclaimable. A **fencing token** (monotonic version) stops a paused "zombie" worker from overwriting the result after its lease was reassigned.`,
      diagram: `  clients --> Job API --> job store (partitioned by hash(job_id);
                           index (partition, next_run_at))
                                ^            |
              claim due jobs     |            | leases on partitions (etcd)
              (SKIP LOCKED)      |            v
                         +------------------------------+
                         | scheduler nodes              |
                         | own partitions via leases    |
                         | load next 30 s into a        |
                         | hierarchical timing wheel    |
                         +--------------+---------------+
                                        | fire -> enqueue (priority lanes)
                                        v
                                Kafka / SQS work queues
                                        |
                          +-------------+-------------+
                          v             v             v
                       worker        worker        worker   lease + heartbeat +
                          |             |             |     fencing token
                          +-------------+-------------+
                                        |
                           result -> job store (status, attempts, next_run_at)`,
      code: [
        {
          language: 'sql',
          title: 'Claim due jobs with SKIP LOCKED, a lease and a fencing token (Postgres)',
          code: `-- Claim up to 500 due jobs from my partitions; concurrent claimers skip locked rows
WITH due AS (
  SELECT id
  FROM jobs
  WHERE partition = ANY($1::int[])                 -- partitions this node leases
    AND status IN ('SCHEDULED', 'RETRY')
    AND next_run_at <= now() + interval '30 seconds'
    AND (lease_until IS NULL OR lease_until < now())
  ORDER BY next_run_at
  LIMIT 500
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs j
SET status      = 'CLAIMED',
    lease_owner = $2,                              -- scheduler/worker id
    lease_until = now() + interval '60 seconds',
    version     = j.version + 1                    -- fencing token for this claim
FROM due
WHERE j.id = due.id
RETURNING j.id, j.next_run_at, j.payload, j.version;

-- Completing: only the current lease holder (matching fencing token) may write
UPDATE jobs
SET status = 'SUCCEEDED', lease_owner = NULL, lease_until = NULL, finished_at = now()
WHERE id = $1 AND version = $2;                    -- 0 rows => we were fenced off`,
        },
      ],
      keyPoints: [
        'Durable job store indexed by next_run_at; schedulers own partitions via leases.',
        'SKIP LOCKED + lease + fencing token = safe concurrent claiming.',
        'At-least-once execution; handlers must be idempotent; compute next cron run transactionally.',
      ],
      source: 'Distributed scheduler designs (Airflow, Quartz clustering, Uber Cadence/Temporal timers)',
    },
    {
      heading: 'Distributed Job Scheduler (2/2): timing wheels, retries, cron pitfalls & failure modes',
      body: `**Why a timing wheel:** keeping millions of pending timers in a priority queue costs O(log n) per insert/delete. A **timing wheel** is a circular array of buckets, one per tick (e.g., 1 s); a timer goes into bucket \`(now + delay) mod size\`; each tick you fire one bucket — **O(1)** insert and expire. **Hierarchical wheels** (seconds → minutes → hours) handle long delays: a timer 3 h away sits in the hour wheel and **cascades** down to finer wheels as it gets close. Kafka uses a hierarchical timing wheel for request purgatory; Netty's HashedWheelTimer uses a single wheel with "rounds".

In a distributed scheduler, the wheel is only a **near-term, in-memory cache** of the durable store (next ~30–60 s); the DB remains the source of truth, so losing a node loses nothing — the partition's new owner reloads its window.

**Retries:** exponential backoff with jitter (\`base × 2^attempt ± random\`), max attempts, then **DEAD** with alerting; distinguish retryable (timeouts, 5xx) from permanent (validation) errors. Retry = new \`next_run_at\` + status RETRY in the store (durable).

**Cron pitfalls (seniors mention these):**
- **Time zones & DST**: "every day at 02:30 America/New_York" doesn't exist on spring-forward day and happens twice on fall-back. Pick a policy (skip/run once) and compute in the job's zone, store UTC.
- **Misfire policy**: after an outage, do you run all missed occurrences, only the latest, or skip? Make it per job.
- **Thundering herd at :00**: millions of "0 * * * *" jobs; add deterministic jitter (hash(job_id) mod 60 s) when the job allows.
- **Overlap**: a 10-min job scheduled every 5 min — allow, skip, or queue (concurrency policy per job, like Kubernetes CronJob \`concurrencyPolicy\`).

**Failure modes:**
- Scheduler node dies → its partition leases expire (~10 s) → another node takes over and reloads due jobs; jobs already enqueued but not marked may be enqueued twice → dedup by (job_id, scheduled_time) at enqueue/worker.
- Worker dies mid-job → lease expires → reclaimed and retried → idempotent handlers (idempotency key = job_id + scheduled_time).
- Zombie worker (long GC pause) finishes after its lease was reassigned → **fencing token** rejects its write; side effects outside the DB must also check the token or be idempotent.
- Clock skew → use DB time (\`now()\`) or a single time authority for due checks, not each node's clock.

**Build vs buy:** Temporal/Cadence (durable timers + workflows), Airflow (batch DAGs), Kubernetes CronJobs (simple, cluster-local), AWS EventBridge Scheduler / Cloud Scheduler (managed). Interviewers still want the internals above.`,
      code: [
        {
          language: 'typescript',
          title: 'Hierarchical timing wheel (seconds → minutes) with cascading',
          code: `type Timer = { id: string; fireAt: number; fn: () => void };   // fireAt in whole seconds

class Wheel {
  buckets: Timer[][];
  constructor(public size: number, public tickSec: number) {
    this.buckets = Array.from({ length: size }, () => []);
  }
  span() { return this.size * this.tickSec; }
  slot(t: number) { return Math.floor(t / this.tickSec) % this.size; }
}

export class HierarchicalTimingWheel {
  private sec = new Wheel(60, 1);       // 60 x 1 s
  private min = new Wheel(60, 60);      // 60 x 1 min -> 1 h horizon
  private overflow: Timer[] = [];       // > 1 h: stays in the DB in the real system

  constructor(private now: number) {}

  add(t: Timer) {
    const delay = t.fireAt - this.now;
    if (delay <= 0) return t.fn();                                // already due
    if (delay < this.sec.span()) this.sec.buckets[this.sec.slot(t.fireAt)].push(t);
    else if (delay < this.min.span()) this.min.buckets[this.min.slot(t.fireAt)].push(t);
    else this.overflow.push(t);
  }

  /** Called once per second. O(1) amortised per timer. */
  tick() {
    this.now += 1;
    if (this.now % 60 === 0) {                                    // minute boundary:
      const due = this.min.buckets[this.min.slot(this.now)];      // cascade the minute
      this.min.buckets[this.min.slot(this.now)] = [];             // bucket into seconds
      due.forEach((t) => this.add(t));
    }
    const bucket = this.sec.buckets[this.sec.slot(this.now)];
    this.sec.buckets[this.sec.slot(this.now)] = [];
    for (const t of bucket) {
      if (t.fireAt <= this.now) t.fn();                           // enqueue to work queue
      else this.add(t);                                           // defensive re-slot
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Timing wheel: O(1) timers; hierarchical wheels cascade long delays.',
        'Wheel is a near-term cache; the DB is the source of truth.',
        'Plan for DST, misfires, :00 herds, overlap, zombies (fencing), clock skew.',
      ],
      source: 'Varghese & Lauck (1987); Kafka purgatory (hierarchical timing wheels); Netty HashedWheelTimer',
    },
    {
      heading: 'Logging Platform: agents → Kafka → processing → indexing with hot/warm/cold tiers',
      body: `**Intuition:** logs are the **flight recorder** — huge, mostly never read, but invaluable during an incident or audit. The design is about ingesting everything cheaply, making the last few days fast to search, and keeping the rest cheap.

**Requirements:** collect logs from ~10K+ hosts/pods; search by service/level/trace_id/text within seconds for recent data; retention e.g. 7 days hot, 30 days warm, 1 year cold (compliance), raw archive for replay; PII redaction; multi-tenant quotas; the platform must survive the incident it's being used to debug (bursts of error logs are exactly when it's needed).

**Estimation:** 20K pods × 50 lines/s × 300 B ≈ **300 MB/s** ≈ 26 TB/day raw; with indexing overhead (Elasticsearch ~1–1.5× raw with replicas off, 2–3× with one replica) — tens of TB per day in the hot tier. This is why **Loki-style** designs (index only labels, store compressed chunks in object storage, brute-force grep at query time) are popular: ~10× cheaper storage at the cost of slower full-text queries.

**Pipeline:**
1. **Agents** (Fluent Bit, Vector, OpenTelemetry Collector) as DaemonSets tail container stdout/files, add metadata (k8s namespace, pod, node), buffer on disk, batch and compress. Structured JSON logs with trace_id make correlation possible.
2. **Kafka** as the durable buffer: absorbs bursts, decouples indexers, allows replay after indexer bugs. Partition by service/tenant.
3. **Processors** (Vector/Logstash/Flink): parse, normalise, **redact PII** (emails, card numbers), drop/sample noisy debug logs, route (security logs to SIEM, audit logs to immutable storage).
4. **Indexers/storage:** Elasticsearch/OpenSearch (inverted index, fast full text) or Loki/ClickHouse (cheaper, label/columnar). Index per day per tenant (time-based indices → retention is "delete old index").
5. **Tiers** via Index Lifecycle Management: **hot** (NVMe, 1–7 d, replicas) → **warm** (HDD/fewer replicas, force-merged, read-only) → **cold/frozen** (searchable snapshots on S3) → delete. Plus raw compressed archive in S3 (Glacier after N days).
6. **Query/UI**: Kibana/Grafana; query guards (time-range limits, max buckets) to protect the cluster.

**Protecting the platform:** per-tenant rate limits and quotas at ingestion, sampling of repetitive logs, backpressure (agents buffer to disk rather than dropping), and a separate small cluster for the platform's own logs.`,
      diagram: `  pods/hosts                                           users (Grafana/Kibana)
  [app]->stdout                                                 |
     |                                                          v
  Fluent Bit / Vector (DaemonSet: tail, enrich,          query service
  disk buffer, batch, compress)                           (limits, auth)
     |                                                          |
     v                                                          v
  Kafka (partition by tenant/service) --> processors --> indexers
     |                                   parse, redact    |
     |                                   PII, sample,     v
     |                                   route         HOT  (NVMe, 1-7 d)
     |                                      |            | ILM rollover
     |                                      +-> SIEM     v
     |                                               WARM (HDD, 30 d)
     +--> raw archive (S3, Parquet/zstd)               |
          -> Glacier after 90 d                        v
                                               COLD/FROZEN (S3 snapshots, 1y)`,
      code: [
        {
          language: 'json',
          title: 'OpenSearch/Elasticsearch-style ILM policy: hot → warm → cold → delete',
          code: `{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": { "max_primary_shard_size": "50gb", "max_age": "1d" },
          "set_priority": { "priority": 100 }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "allocate": { "number_of_replicas": 1, "require": { "data": "warm" } },
          "forcemerge": { "max_num_segments": 1 },
          "readonly": {}
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": {
          "searchable_snapshot": { "snapshot_repository": "s3-logs-repo" }
        }
      },
      "delete": {
        "min_age": "365d",
        "actions": { "delete": {} }
      }
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Agents with disk buffers → Kafka → processors (redact, sample, route) → indexers.',
        'Time-based indices + ILM: hot (SSD) → warm → cold (S3) → delete; raw archive in S3.',
        'Full-text inverted index (ES) vs label index + object storage (Loki) is a 10× cost trade-off.',
      ],
      source: 'Elastic ILM docs; Grafana Loki architecture; Fluent Bit / Vector docs',
    },
    {
      heading: 'Bottlenecks, trade-offs & wrap-up across infrastructure designs',
      body: `| Design | Core invariant | Main bottleneck | Key trade-off |
|---|---|---|---|
| Message queue | Acked messages are never lost; per-partition order | Disk/network per broker, rebalances, partition count | acks/ISR durability vs latency; partitions (parallelism) vs ordering and metadata overhead |
| Metrics & alerting | Critical alerts always fire | Cardinality, ingestion rate, query fan-out | Pull vs push; raw precision vs downsampled cost; build vs buy |
| Ad click aggregation | Every click counted once in the right minute | Hot ads, late events, state checkpoints | Latency (watermark lateness) vs accuracy; lambda vs kappa |
| Job scheduler | Every due job runs (at least once) on time | Round-time bursts, store hot spots | Precision vs load; exactly-once illusion via idempotency |
| Logging | Logs survive the incident being debugged | Index cost, burst ingestion | Full-text index vs cheap label index; retention vs cost |

**Recurring patterns to name out loud:**
- **Log-structured everything:** Kafka segments, TSDB blocks, LSM trees, time-based log indices — append, then compact/roll/expire in bulk.
- **Decouple with a durable buffer** (Kafka) so the slow consumer never drops data at the fast producer.
- **Exactly-once is an end-to-end property**: idempotent producers + atomic offset/result commits + idempotent sinks.
- **Leases + fencing tokens** whenever one node must "own" something (a partition, a job).
- **Tiered storage**: hot/warm/cold for metrics, logs and Kafka itself.

**Closing line:** *"The part I'd validate first is the burst behaviour — midnight cron spikes, incident-time log floods, a viral ad — because these systems fail at peaks, not averages. I'd load test at 3× peak and chaos-test broker and scheduler failover."*`,
      keyPoints: [
        'State the invariant each system must never violate.',
        'Recurring tools: append-only logs, durable buffers, leases + fencing, tiered storage.',
        'Design and test for bursts, not averages.',
      ],
    },
    {
      heading: 'Level bar: what mid, senior and staff answers include',
      body: `Calibration: **mid** is about 80% breadth / 20% depth, with the interviewer steering. **Senior** is about 60/40: a quick HLD, then deep dives you start yourself on durability, time and failure. **Staff** is about 40/60: you drive, and you raise multi-tenancy, cost, upgrades and the system's blast radius without being asked. Infra designs are the ones staff candidates are expected to run themselves.

**Distributed message queue (Kafka-like)**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | Produce, consume, retain | 1M msgs/s × 1 KB ≈ 1 GB/s; 7 days ≈ 600 TB × RF 3; per-partition ordering | Tenant quotas, geo-replication, schema governance |
| High-level design | Brokers + topics + consumers | Partitioned append-only log, KRaft metadata, consumer-group offsets | Tiered storage to S3; control plane separate from brokers |
| Deep dives expected | Partitions | Segments + sparse index, batching, zero-copy, ISR | Cooperative rebalancing, idempotent/transactional producers |
| Trade-offs & failure handling | — | acks=1 vs all latency | Unclean leader election: availability vs data loss |
| Ops/cost/evolution | — | Consumer lag, under-replicated partitions | Partition-count limits, throttled reassignment, disk vs tiered cost |

- Down-levelled: "delete on consume" semantics; promising ordering across partitions.

**Metrics monitoring**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | Collect, query, alert | 10M series / 10 s ≈ 1M samples/s; 1 year of retention with downsampling | Cardinality governance, monitoring of the monitoring |
| High-level design | Agents → DB → dashboards | Pull/push collectors → Kafka → TSDB (~1.4 B/sample compressed) → query + alert manager | Independent alert path that survives the main cluster failing |
| Deep dives expected | — | Gorilla delta-of-delta/XOR, downsampling tiers | Per-tenant series limits, absent-data alerts |
| Trade-offs & failure handling | — | Pull vs push for short-lived jobs | Dropping samples vs back-pressuring producers |
| Ops/cost/evolution | — | ≈ 120 GB/day raw | Hot/cold tiers; recording rules to cut query cost |

- Down-levelled: metrics as rows in Postgres; alerts that depend on the cluster being monitored.

**Ad click aggregation**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | Count clicks per ad/minute | 1B/day ≈ 12K/s (peak 50K); billing-grade accuracy; minutes of latency | Advertiser audit, fraud filtering, restatement policy |
| High-level design | Queue → aggregator → DB | Kafka → Flink (event-time windows) → OLAP; raw events to S3 | Kappa replay from raw; daily batch reconciliation |
| Deep dives expected | Windows | Watermarks, late events, checkpoints | Exactly-once sink, hot-ad key salting |
| Trade-offs & failure handling | — | Allowed lateness vs freshness | Real-time number vs billed number, and who owns the difference |
| Ops/cost/evolution | — | Watermark lag | Reprocessing cost; schema evolution of click events |

- Down-levelled: processing-time windows for billing; \`UPDATE count = count + 1\`.

**Distributed job scheduler**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | One-off + cron jobs | 10M jobs/day, ±1 s precision, at-least-once | Tenant fairness; exactly-once effects pushed to job idempotency |
| High-level design | Cron box + workers | Jobs DB → partitioned schedulers → queue → workers + heartbeats | Timing wheel for near-term jobs, DB for long-term |
| Deep dives expected | — | Claiming with SKIP LOCKED, leases | Fencing on completion, the :00 thundering herd, DST cron |
| Trade-offs & failure handling | — | Poll interval vs DB load | Retries vs side effects; poison-job quarantine |
| Ops/cost/evolution | — | Schedule-delay SLO | Rebalancing scheduler partitions, tenant quotas |

- Down-levelled: a single cron host; no lease, so a slow job runs twice.

**Logging platform**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | Collect + search | 1M lines/s × 500 B ≈ 43 TB/day | PII redaction, per-team cost |
| High-level design | Agents → ES | Agents → Kafka → processors → index + S3 | Label-only index + columnar cold tier |
| Deep dives expected | — | Hot/warm/cold tiers | Noisy-tenant isolation, sampling |
| Trade-offs & failure handling | — | Full-text vs label index | Drop debug logs under back-pressure |
| Ops/cost/evolution | — | Retention per tier | Chargeback, retention compliance |

- Down-levelled: full-text indexing of everything, kept hot for 30 days.`,
      keyPoints: [
        'Infra designs give the most credit for durability settings and time semantics.',
        'Staff candidates raise multi-tenancy, upgrade paths and cost per GB unprompted.',
        'Billing-grade pipelines need reconciliation, not just a streaming job.',
      ],
      source: 'Hello Interview — problem breakdowns (levelling expectations)',
    },
    {
      heading: 'Deep-dive ladders: bad → good → great',
      body: `**Message queue: never lose an acknowledged write**
- **Bad:** \`acks=1\`. The leader acks, then dies before followers fetch, and the new leader truncates the write.
- **Good:** \`acks=all\` with RF 3. But with \`min.insync.replicas=1\` the ISR can shrink to just the leader, so the same loss is possible.
- **Great:** RF 3, \`min.insync.replicas=2\`, \`acks=all\`, \`unclean.leader.election.enable=false\`, and an idempotent producer so retries do not duplicate. Cost: a few ms of p99, and writes stop while 2 of 3 replicas are down (CP for that partition).

**Ad clicks: exactly-once counts**
- **Bad:** the consumer increments DB counters, then commits the offset. A crash between the two replays the batch and double-bills. Committing first loses clicks instead.
- **Good:** dedup by \`click_id\` in Redis with a TTL. The counter write and the offset commit are still not atomic.
- **Great:** Flink keeps window state in checkpoints, and the sink is either a two-phase-commit (transactional) sink or an idempotent upsert keyed by (ad_id, minute) carrying the checkpoint ID. Raw events in S3 feed a daily batch recompute that reconciles and restates. Cost: checkpoint latency (~1 min of output delay) and a second batch pipeline.

**Scheduler: claim each job exactly once**
- **Bad:** every scheduler runs \`SELECT ... WHERE run_at <= now()\` and executes the results, so N schedulers run each job N times.
- **Good:** \`FOR UPDATE SKIP LOCKED\` + status RUNNING. A worker that crashes leaves the job RUNNING forever, and every node polls the same hot index.
- **Great:** a lease (\`lease_until\`) renewed by heartbeat, a reaper that re-queues expired leases, and the attempt number as a fencing token checked on completion. Jobs are hash-partitioned across scheduler shards, and jobs due in the next minute load into an in-memory timing wheel. Cost: a heartbeat write every ~10 s per running job, and handlers must be idempotent.

**Metrics: cardinality explosion**
- **Bad:** accept any label. One \`user_id\` label turns a metric into 100M series and the TSDB runs out of memory.
- **Good:** per-tenant active-series limits that reject new series. This is safe but blunt: the team notices only when dashboards go blank.
- **Great:** relabel/drop rules at ingest, recording rules for heavy queries, a cardinality report per team, and alerts at 80% of quota. Cost: governance work across teams.

**Logging: cost at 43 TB/day**
- **Bad:** full-text index of everything, hot for 30 days, with 2 replicas: about 2.6 PB of SSD.
- **Good:** 3 days hot, then warm, then S3 searchable snapshots.
- **Great:** a label-only index (Loki-style) over compressed chunks in S3, sampling of debug logs, and per-team quotas with chargeback. Cost: cold-tier searches take seconds to minutes.`,
      code: [
        {
          language: 'sql',
          title: 'Scheduler claim with lease + fencing (Postgres)',
          code: `-- Claim up to 100 due jobs without blocking other schedulers
WITH due AS (
  SELECT id FROM jobs
  WHERE status = 'QUEUED' AND run_at <= now()
  ORDER BY run_at
  LIMIT 100
  FOR UPDATE SKIP LOCKED          -- other pollers skip these rows
)
UPDATE jobs j
SET status = 'RUNNING',
    attempt = j.attempt + 1,      -- fencing token for this run
    lease_until = now() + interval '30 seconds',
    worker_id = $1
FROM due WHERE j.id = due.id
RETURNING j.id, j.attempt;

-- Completion only wins if this worker still holds the same attempt
UPDATE jobs SET status = 'DONE'
WHERE id = $2 AND attempt = $3 AND status = 'RUNNING';

-- Reaper: re-queue jobs whose lease expired (worker died)
UPDATE jobs SET status = 'QUEUED'
WHERE status = 'RUNNING' AND lease_until < now();`,
        },
      ],
      keyPoints: [
        'Durability: acks=all only helps together with min.insync.replicas=2 and no unclean election.',
        'Exactly-once = checkpointed state + transactional or idempotent sink + batch reconciliation.',
        'Leases need fencing (an attempt number) or a zombie worker can still complete a job.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'design-infra-cc-1',
      title: 'Make the click aggregator billing-grade',
      context:
        'Finance found that per-minute click totals differ from the raw logs by 0.5–3%: after deployments counts drop, after broker hiccups counts spike, and clicks near minute boundaries land in the wrong minute when the consumer lags.',
      task:
        'Rewrite the consumer so each click is counted exactly once, in the minute it actually happened, and a crash at any point neither loses nor double-counts clicks.',
      starter: {
        language: 'typescript',
        code: `import { Kafka } from 'kafkajs';
import { pool } from './pg';

const consumer = new Kafka({ brokers: ['kafka:9092'] }).consumer({ groupId: 'click-agg' });

export async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'clicks-raw' });
  await consumer.run({
    autoCommit: true,                      // commits periodically in the background
    eachMessage: async ({ message }) => {
      const click = JSON.parse(message.value!.toString());
      const minute = new Date(Math.floor(Date.now() / 60000) * 60000);
      await pool.query(
        'INSERT INTO ad_clicks_minute (ad_id, click_minute, clicks) VALUES ($1,$2,1) ' +
        'ON CONFLICT (ad_id, click_minute) DO UPDATE SET clicks = ad_clicks_minute.clicks + 1',
        [click.adId, minute]);
    },
  });
}`,
      },
      hints: [
        'Which timestamp decides the minute? What happens to minute buckets when the consumer is 5 minutes behind?',
        'With autoCommit, can the offset be committed before the DB write completes, or after the write but not committed before a crash? What does "+1" do on replay?',
        'Consider aggregating a batch in memory and writing results together with the consumed offset in one DB transaction; dedup by click_id.',
      ],
      solution: {
        language: 'typescript',
        code: `import { Kafka } from 'kafkajs';
import type { Pool } from 'pg';

type Click = { clickId: string; adId: string; ts: number };

export async function run(pool: Pool) {
  const kafka = new Kafka({ clientId: 'click-agg', brokers: ['kafka:9092'] });
  const consumer = kafka.consumer({ groupId: 'click-agg' });
  await consumer.connect();
  await consumer.subscribe({ topic: 'clicks-raw' });

  // Resume from offsets stored in OUR DB (source of truth), not Kafka's commits
  consumer.on(consumer.events.GROUP_JOIN, async ({ payload }) => {
    const parts = payload.memberAssignment['clicks-raw'] ?? [];
    for (const p of parts) {
      const r = await pool.query(
        "SELECT next_offset FROM consumer_offsets WHERE topic='clicks-raw' AND partition=$1", [p]);
      if (r.rowCount) consumer.seek({ topic: 'clicks-raw', partition: p, offset: String(r.rows[0].next_offset) });
    }
  });

  await consumer.run({
    autoCommit: false,
    eachBatch: async ({ batch, heartbeat }) => {
      const clicks: Click[] = batch.messages.map((m) => JSON.parse(m.value!.toString()));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // 1. Dedup: only clicks never seen before survive (click_id PK, TTL'd by partition drop)
        const fresh = await client.query(
          'INSERT INTO seen_clicks (click_id) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING RETURNING click_id',
          [clicks.map((c) => c.clickId)]);
        const keep = new Set(fresh.rows.map((r: { click_id: string }) => r.click_id));
        // 2. Aggregate by EVENT time minute in memory
        const agg = new Map<string, number>();
        for (const c of clicks) {
          if (!keep.has(c.clickId)) continue;
          const k = c.adId + '|' + Math.floor(c.ts / 60_000) * 60_000;
          agg.set(k, (agg.get(k) ?? 0) + 1);
        }
        for (const [k, n] of agg) {
          const [adId, minuteMs] = k.split('|');
          await client.query(
            'INSERT INTO ad_clicks_minute (ad_id, click_minute, clicks) VALUES ($1, to_timestamp($2 / 1000.0), $3) ' +
            'ON CONFLICT (ad_id, click_minute) DO UPDATE SET clicks = ad_clicks_minute.clicks + EXCLUDED.clicks',
            [adId, Number(minuteMs), n]);
        }
        // 3. Progress committed atomically with the results
        await client.query(
          "INSERT INTO consumer_offsets (topic, partition, next_offset) VALUES ('clicks-raw', $1, $2) " +
          'ON CONFLICT (topic, partition) DO UPDATE SET next_offset = EXCLUDED.next_offset',
          [batch.partition, (BigInt(batch.lastOffset()) + 1n).toString()]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;                        // batch is re-delivered; nothing was applied
      } finally {
        client.release();
      }
      await heartbeat();
    },
  });
}`,
      },
      explanation: `**Fixes:**
- **Processing-time bucketing:** \`Date.now()\` put lagging clicks in the wrong minute. Buckets now use the click's **event time** (\`c.ts\`).
- **Lost clicks (at-most-once):** background auto-commit could commit an offset before the DB write finished; a crash then skipped those clicks. Now offsets are only advanced inside the same DB transaction as the results.
- **Double counts (at-least-once replays):** after a crash between write and commit, the non-idempotent \`+1\` was re-applied. Results and offsets now commit atomically, and on (re)assignment the consumer **seeks to the offset stored in the DB**, so a batch is either fully applied or not at all.
- **Upstream duplicates:** ad-server retries send the same click twice; the \`seen_clicks\` table (partitioned by day and dropped after the dedup window) filters them by \`click_id\`.
- **Throughput:** batch-level transactions and in-memory pre-aggregation replace one DB round trip per click.
- Remaining work for production: allowed-lateness policy for very late events and nightly reconciliation against raw storage.`,
      followUps: [
        {
          "q": "The `seen_clicks` dedup table gets 1B inserts a day. How do you keep it from becoming the bottleneck?",
          "a": "Bound and partition it: dedup only within a window (e.g. 24–48 h, matching how late retries can arrive), store `click_id` in daily partitions and drop old ones instead of deleting rows. 1B × ~40 B ≈ 40 GB/day of index — fine for a sharded Postgres, but write amplification hurts. Alternatives: shard the aggregator by partition and keep dedup state in Flink keyed state (RocksDB with TTL), or a Bloom filter per minute to skip the DB for clicks that are definitely new and check exactly only on maybe-duplicates."
        },
        {
          "q": "How would you prove this consumer is exactly-once before finance trusts it?",
          "a": "Chaos tests: replay a fixed dataset with known per-minute totals while killing the consumer at random points (before BEGIN, mid-batch, after COMMIT before heartbeat), forcing rebalances, and injecting duplicate click_ids; assert totals match exactly. In production, run a reconciliation job comparing hourly sums from raw events in S3 against `ad_clicks_minute` and alert on any non-zero diff. Also emit a counter of dedup hits and late drops so a drift has an explanation."
        }
      ],
    },
    {
      id: 'design-infra-cc-2',
      title: 'Fix the cron scheduler that runs jobs twice (and sometimes never)',
      context:
        'Three scheduler replicas run this loop. Customers report duplicate invoices at midnight, some daily jobs silently stop recurring after a deploy, and a flaky downstream causes a retry storm.',
      task:
        'Rewrite the tick so jobs are claimed safely across replicas, recurring schedules can’t be lost on crash, retries are bounded with backoff, and a slow or dead run can be recovered.',
      starter: {
        language: 'typescript',
        code: `import { pool } from './pg';
import { nextCron } from './cron';
import { runHandler } from './handlers';

export async function tick() {
  const { rows } = await pool.query(
    "SELECT * FROM jobs WHERE status = 'SCHEDULED' AND next_run_at <= now() LIMIT 100");
  for (const job of rows) {
    await pool.query("UPDATE jobs SET status = 'RUNNING' WHERE id = $1", [job.id]);
    try {
      await runHandler(job.type, job.payload);
      await pool.query(
        "UPDATE jobs SET status = 'SCHEDULED', next_run_at = $2 WHERE id = $1",
        [job.id, nextCron(job.cron, new Date())]);
    } catch (e) {
      // try again immediately next tick
      await pool.query("UPDATE jobs SET status = 'SCHEDULED' WHERE id = $1", [job.id]);
    }
  }
}
setInterval(tick, 1000);`,
      },
      hints: [
        'Two replicas run the SELECT at the same instant — what stops both from picking the same row?',
        'If the process dies after setting RUNNING, what ever moves the job out of RUNNING? And where does the next occurrence come from?',
        'Separate "schedule the next occurrence" from "execute this occurrence", and give each execution an idempotency key.',
      ],
      solution: {
        language: 'typescript',
        code: `import type { Pool } from 'pg';
import { nextCron } from './cron';                 // tz/DST-aware
import { enqueue } from './queue';                 // durable work queue (Kafka/SQS)

const LEASE_S = 60;

/** Scheduler: turns due schedules into execution records, atomically advancing the cron. */
export async function schedulerTick(pool: Pool, nodeId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "SELECT id, cron, tz, next_run_at, type, payload FROM jobs " +
      "WHERE status = 'ACTIVE' AND next_run_at <= now() ORDER BY next_run_at LIMIT 500 " +
      'FOR UPDATE SKIP LOCKED');                   // replicas grab disjoint rows
    for (const j of rows) {
      const runKey = j.id + ':' + j.next_run_at.toISOString();   // idempotency key per occurrence
      await client.query(
        "INSERT INTO executions (run_key, job_id, type, payload, status, attempts, run_after) " +
        "VALUES ($1,$2,$3,$4,'PENDING',0, now()) ON CONFLICT (run_key) DO NOTHING",
        [runKey, j.id, j.type, j.payload]);
      await client.query('UPDATE jobs SET next_run_at = $2 WHERE id = $1',   // same txn:
        [j.id, nextCron(j.cron, j.tz, j.next_run_at)]);                    // never lost
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  // Dispatch PENDING executions (and ones whose lease expired) with a lease + fencing token
  const { rows: claimed } = await pool.query(
    "UPDATE executions e SET status='CLAIMED', lease_owner=$1, lease_until=now() + ($2 || ' seconds')::interval, " +
    'fence = e.fence + 1 WHERE e.run_key IN (' +
    "  SELECT run_key FROM executions WHERE (status IN ('PENDING','RETRY') AND run_after <= now()) " +
    "     OR (status = 'CLAIMED' AND lease_until < now()) LIMIT 500 FOR UPDATE SKIP LOCKED) " +
    'RETURNING run_key, type, payload, fence, attempts',
    [nodeId, LEASE_S]);
  for (const ex of claimed) await enqueue(ex);     // worker completes with WHERE fence = $fence
}

/** Worker failure path: bounded exponential backoff with jitter, then DEAD. */
export async function markFailed(pool: Pool, runKey: string, fence: number, attempts: number, retryable: boolean) {
  const next = attempts + 1;
  const dead = !retryable || next >= 8;
  const delayS = Math.min(3_600, 2 ** next * 5) * (0.8 + Math.random() * 0.4);
  await pool.query(
    "UPDATE executions SET status = $3, attempts = $4, run_after = now() + ($5 || ' seconds')::interval, " +
    'lease_owner = NULL, lease_until = NULL WHERE run_key = $1 AND fence = $2',
    [runKey, fence, dead ? 'DEAD' : 'RETRY', next, Math.round(delayS)]);
}`,
      },
      explanation: `**Fixes:**
- **Double runs across replicas:** plain SELECT then UPDATE lets every replica pick the same rows. \`FOR UPDATE SKIP LOCKED\` hands out disjoint rows without blocking.
- **Lost recurrences:** the next \`next_run_at\` was computed only after a *successful* run; a crash or failure could leave the job RUNNING/SCHEDULED incorrectly and deploys killed in-flight runs. Now the next occurrence is advanced in the **same transaction** that records the execution, and it is computed from the scheduled time (not \`new Date()\`), so drift and missed occurrences don't accumulate.
- **Stuck RUNNING:** executions carry a **lease**; expired leases are reclaimed and re-dispatched. The **fencing token** (\`fence\`) prevents a zombie worker from completing or failing an execution that was reassigned.
- **Duplicate invoices:** each occurrence has a deterministic \`run_key\` (job + scheduled time) that is the unique key for the execution and should be passed to handlers as the idempotency key for side effects.
- **Retry storm:** immediate retries every tick hammered the flaky downstream. Now bounded exponential backoff with jitter, permanent errors go straight to DEAD, and DEAD executions alert.
- **Execution decoupled from scheduling:** running handlers inline in the tick loop meant a slow job delayed every other job; executions are enqueued to workers.`,
      followUps: [
        {
          "q": "A daily job's scheduler was down for 3 hours across its fire time. When it comes back, should it run the missed occurrence? How does the code decide?",
          "a": "That's a per-job misfire policy, not a global rule. The loop picks up rows whose `next_run_at <= now()`, so it fires once and advances via `nextCron` from the scheduled time; if many intervals were missed, compute the next run from the scheduled time repeatedly and either run once ('fire once now'), run all missed ('catch up', for billing), or skip to the next future time ('do nothing', for reminders). Store the policy on the job and pass the original scheduled time to the handler so it knows it's late."
        },
        {
          "q": "Cron jobs are written in local time by tenants. What breaks on DST transitions, and how do you test it?",
          "a": "On spring-forward, 02:30 local doesn't exist, so a naive library may skip the job or loop. On fall-back, 01:30 happens twice and can fire twice. `nextCron(cron, tz, prev)` must compute in the tenant's zone with defined rules (skip-forward to 03:00, fire once on the first 01:30), and the run_key must use the UTC instant so a repeated local time doesn't collide. Test with table-driven cases across known DST dates for several zones, using a fake clock."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-infra-iq-01',
      difficulty: 'expert',
      question: 'Design a distributed message queue like Kafka that supports replay, per-key ordering and configurable delivery guarantees.',
      whatInterviewerLooksFor: [
        'Log-based storage model with segments and indexes; why sequential I/O',
        'Partitioning, consumer groups and the ordering guarantee’s scope',
        'Replication with ISR, acks and min ISR; leader election and unclean election trade-off',
        'Delivery semantics including idempotent producer and transactions',
        'Operational concerns: rebalances, partition count, retention/tiered storage',
      ],
      modelAnswer: `### Model
- Topics split into **partitions**; each partition is an append-only, **segmented log** on disk with a sparse offset index and time index. Messages are retained by time/size (e.g. 2 weeks), not deleted on read → replay and multiple consumer groups.

### Write path
- Producer batches by partition (key hash), compresses (lz4/zstd), sends to the **leader**. \`linger.ms\`/\`batch.size\` tune latency vs throughput.
- Followers fetch from the leader; the **ISR** is the caught-up set. With \`acks=all\` + RF=3 + \`min.insync.replicas=2\`, a write is committed when all ISR members have it; consumers read up to the high watermark. Unclean leader election disabled → no data loss, possible unavailability.

### Read path
- **Consumer groups**: each partition owned by one consumer per group; group coordinator manages membership (heartbeats) and offsets (compacted internal topic). Consumers pull batches with long polling; page cache + zero-copy make reads cheap.

### Semantics
- At-most-once (commit then process), at-least-once (process then commit + idempotent handlers), exactly-once (idempotent producer with producer ID + sequence numbers, transactions atomically committing outputs and input offsets; read_committed consumers).

### Metadata & scaling
- Controller quorum (Raft/KRaft) stores metadata, elects partition leaders. Add brokers → reassign partitions with throttled copying. Over-provision partitions: adding them changes key → partition mapping.

### Numbers
- A broker sustains ~100s MB/s; 1 GB/s ingest with RF=3 = 3 GB/s of disk writes cluster-wide → ~10–20 brokers depending on disks/NICs, plus retention storage.`,
      followUps: [
        { q: 'A consumer group of 40 members reads a 24-partition topic. What happens?', a: '16 consumers sit idle — parallelism is capped by partitions. Either add partitions (mind key remapping) or reduce members.' },
        { q: 'How would you support delayed messages?', a: 'Kafka lacks native delays; use per-delay-level topics (e.g. 1 min, 10 min) with consumers that sleep until due, or a timing-wheel service; RabbitMQ/SQS support delays natively.' },
        { q: 'Why pull instead of push to consumers?', a: 'Consumers control their rate (no overwhelm), batch naturally, and can rewind; the cost is empty polls, mitigated by long polling.' },
      ],
      pitfalls: [
        'Claiming global ordering across partitions.',
        'acks=1 described as durable.',
        'Designing per-message deletion on consume for a replayable log.',
      ],
    },
    {
      id: 'design-infra-iq-02',
      difficulty: 'hard',
      question: 'Design a metrics monitoring and alerting system (like Datadog/Prometheus) for 10M active time series.',
      whatInterviewerLooksFor: [
        'Data model (name + labels) and cardinality awareness',
        'Pull vs push discussion with a hybrid answer',
        'TSDB choice, compression, downsampling and retention tiers',
        'Alerting pipeline (rules, dedup, grouping, routing) and meta-monitoring',
      ],
      modelAnswer: `### Numbers
- 1,000 pools × 100 hosts × 100 metrics ≈ **10M series**; 10 s interval → **1M samples/s**; Gorilla ≈ 1.37 B/sample → ~118 GB/day compressed raw.

### Collection
- **Pull** in Kubernetes (service discovery + scrape \`/metrics\`, failed scrape = down signal), collectors sharded by consistent hashing over targets. **Push** (OTLP) for batch/serverless/edge. Both land in **Kafka** partitioned by series → buffers TSDB outages and feeds stream alerting.

### Storage
- Horizontally scalable TSDB (Mimir/Thanos/M3/VictoriaMetrics): in-memory head block + WAL, 2-hour compressed blocks flushed to object storage. Retention: raw 7 d, 1-min rollups 30 d, 1-h rollups 1 yr (keep min/max/sum/count).
- Guardrails: per-tenant series limits, label allow-lists (no user_id), cardinality dashboards.

### Query
- Query frontend splits by time range, caches aligned results, fans out to shards; Grafana on top.

### Alerting
- Rule evaluators (recording + alert rules in git) → **alert manager**: dedup, group, inhibit, silence, route → PagerDuty/Slack via retrying queue. Page on **SLO burn rates**, ticket on slow burns.

### Reliability
- Monitoring must be more available than monitored systems: run per region, replicate ingesters (RF 3), **dead man's switch** alert, and a separate meta-monitoring stack.`,
      followUps: [
        { q: 'A team adds a label with customer_id (2M values) to a latency histogram. What happens and how do you prevent it?', a: 'Series explode (2M × buckets × other labels) → ingester OOM and slow queries for everyone. Enforce per-metric/tenant series limits at ingestion, reject new series over limit, and review label schemas in CI.' },
        { q: 'How do you compute p99 across 500 pods?', a: 'Aggregate histogram buckets (sum by le) then histogram_quantile; averaging per-pod p99s is mathematically wrong.' },
      ],
      pitfalls: [
        'Using a general-purpose RDBMS without justification.',
        'Averaging percentiles.',
        'Alerting on every CPU spike.',
      ],
    },
    {
      id: 'design-infra-iq-03',
      difficulty: 'expert',
      question: 'Design an ad click event aggregation system that powers advertiser billing: clicks per ad per minute and the top 100 ads every minute, at 1B clicks/day.',
      whatInterviewerLooksFor: [
        'Estimates and the correctness-over-latency framing',
        'Raw + aggregated storage; Kafka → stream job → Kafka → DB',
        'Event time, watermarks, windows',
        'Exactly-once end-to-end and dedup',
        'Hot spots, fault tolerance, reconciliation',
      ],
      modelAnswer: `### Numbers
- 1B/day → **10K QPS**, peak **50K**; 0.1 KB/event → 100 GB/day raw; 2M ads; +30%/yr.

### Architecture
- Ad servers → log watcher → **Kafka (raw)** → **Flink aggregation job** (map: clean/filter/key by ad_id; aggregate: per (ad, minute, filter) counts + local top-K heap; reduce: global top-100) → **Kafka (aggregated)** → DB writer → Cassandra/ClickHouse → query service. Raw events also to S3 (Parquet) for replay.

### Time semantics
- **Event-time** tumbling 1-min windows; watermark = max event time − allowed lateness (e.g. 30–60 s); late events to a side output → correction path. Sliding windows for "last M minutes".

### Exactly-once
- Flink checkpoints snapshot state + Kafka offsets; transactional (2PC) Kafka sink; DB writer upserts keyed by (ad, minute, filter) and stores applied offsets in the same transaction. Dedup by \`click_id\` in keyed state with TTL.

### Scale & hot spots
- 64–128 partitions pre-provisioned; hot ads split into sub-keys with a second-stage sum (or dedicated extra nodes).

### Correctness
- Nightly **batch reconciliation** from raw data vs real-time results; billing uses reconciled numbers. Kappa-style recalculation (replay raw through the same code) for bug fixes.

### Monitoring
- End-to-end latency, consumer lag, late-event rate, dedup rate, reconciliation drift.`,
      followUps: [
        { q: 'Why not Lambda architecture?', a: 'Two codebases (batch + streaming) implementing the same aggregation drift apart; kappa keeps one streaming path and replays raw data for recomputation — feasible because raw events are retained.' },
        { q: 'A region’s ad servers were partitioned for 20 minutes and then flushed all clicks at once.', a: 'They arrive long after the watermark. Route to the late-event correction path (or reprocess that time range via recalculation) and upsert corrected minute buckets; flag the affected invoices until reconciliation.' },
      ],
      pitfalls: [
        'Bucketing by processing time.',
        'Assuming Kafka exactly-once covers the external database.',
        'Discarding raw data after aggregation.',
      ],
    },
    {
      id: 'design-infra-iq-04',
      difficulty: 'hard',
      question: 'Design a distributed job scheduler that runs 100M one-off and cron jobs per day with ~1-second precision.',
      context: 'Think of the scheduler behind "remind me tomorrow", nightly billing runs and webhook retries at a SaaS company.',
      whatInterviewerLooksFor: [
        'Durable job store with due-time index and partitioning',
        'Scheduler ownership via leases; in-memory timing wheel for near-term jobs',
        'Safe claiming (SKIP LOCKED), leases, fencing, at-least-once + idempotency',
        'Cron specifics: DST, misfires, :00 bursts, overlap',
      ],
      modelAnswer: `### Numbers
- 100M/day ≈ 1.2K/s average; bursts at :00 can reach ~100K due/s → partitioned store and jitter.

### Data model
- \`jobs(id, tenant, type, payload, cron, tz, next_run_at, status, version)\` partitioned by hash(id) into ~1K partitions; index (partition, next_run_at). \`executions(run_key = job_id + scheduled_time, status, attempts, lease_until, fence)\`.

### Components
- **API** (create/cancel/list), **job store** (Postgres/Cockroach/Cassandra with due index), **schedulers** holding **partition leases** (etcd), each loading jobs due in the next 30–60 s into a **hierarchical timing wheel** (O(1) timers), **work queues** by priority/tenant, **workers**.

### Execution flow
- Due job → in one transaction: insert execution (idempotent on run_key) + advance next_run_at (tz/DST-aware). Dispatch: claim executions with **SKIP LOCKED**, set lease + increment fence → enqueue → worker runs handler with run_key as idempotency key, heartbeats to extend lease, completes with \`WHERE fence = $fence\`.
- Failures: retryable → exponential backoff + jitter; max attempts → DEAD + alert. Expired leases are reclaimed.

### Guarantees
- **At-least-once** execution; "exactly-once effects" only via idempotent handlers — state it plainly.

### Cron edge cases
- DST gaps/overlaps policy, misfire policy (run once/skip/all), concurrency policy (forbid/allow/replace), deterministic jitter for "0 * * * *".

### HA
- Scheduler death → leases expire → partitions reassigned → new owner reloads window. Use DB \`now()\` as the time authority.`,
      followUps: [
        { q: 'Why not just a Redis sorted set with score = run time?', a: 'Works for moderate scale (ZRANGEBYSCORE + atomic claim via Lua), but durability depends on Redis persistence/failover (async replication can lose jobs), and cron/audit/history needs a real store; many teams use Redis only as the near-term index.' },
        { q: 'How do you give a tenant fair share during a burst?', a: 'Per-tenant queues or weighted fair queuing at dispatch, plus per-tenant concurrency limits on workers.' },
      ],
      pitfalls: [
        'Claiming exactly-once execution.',
        'Single scheduler node as leader with no failover story.',
        'Computing the next cron run only after a successful run.',
      ],
    },
    {
      id: 'design-infra-iq-05',
      difficulty: 'hard',
      question: 'Design a centralized logging platform for 20K pods producing ~300 MB/s of logs, searchable within seconds, retained for a year.',
      whatInterviewerLooksFor: [
        'Agent → buffer → processing → index pipeline with back-pressure',
        'Cost-aware storage: hot/warm/cold, index choices',
        'PII redaction, sampling, multi-tenancy and quotas',
        'Survives incident-time bursts',
      ],
      modelAnswer: `### Numbers
- 300 MB/s ≈ 26 TB/day raw. Full-text indexing with one replica ≈ 2–3× → ~50–75 TB/day on hot storage if everything is indexed — the cost driver.

### Pipeline
- **Agents** (Fluent Bit/Vector DaemonSets): tail stdout, enrich with k8s metadata, **disk buffer**, batch + compress.
- **Kafka** (partition by tenant/service): burst absorption (hours of retention), replay, fan-out (SIEM, archive, indexers).
- **Processors**: parse JSON/grok, normalise fields (service, level, trace_id), **redact PII**, drop/sample noisy debug logs, route audit logs to immutable storage.
- **Storage**: tiered — **hot** (7 d, NVMe, Elasticsearch/OpenSearch or Loki ingesters), **warm** (30 d, HDD, read-only, force-merged), **cold/frozen** (searchable snapshots/chunks on S3, 1 yr); raw zstd archive in S3 → Glacier.
- **Query**: Grafana/Kibana with time-range and result limits; trace_id links to tracing.

### Index strategy trade-off
- Elasticsearch: fast arbitrary full-text search, expensive. Loki/ClickHouse: index labels/columns only, chunks in S3, ~10× cheaper, slower needle-in-haystack queries. Many orgs use Loki for app logs and ES for security/search-heavy use.

### Protection
- Per-tenant ingestion quotas, rate limits and sampling; back-pressure to agents (disk buffering) instead of dropping; separate cluster for platform self-logs; alert on ingestion lag.

### Compliance
- Retention per data class, delete-by-tenant, access controls on sensitive indices, immutable audit storage (S3 Object Lock).`,
      followUps: [
        { q: 'During an outage, error logs spike 20× and the platform falls behind. What do you do?', a: 'Kafka absorbs the burst; indexers autoscale; processors apply dynamic sampling of repetitive messages (keep first N per fingerprint per minute + counts); prioritise ERROR over DEBUG lanes.' },
        { q: 'How would you make "all logs for trace X" fast?', a: 'Index trace_id as a keyword field/label, include it in every log line via the logging library/OTel context, and link from traces UI to a pre-built query.' },
      ],
      pitfalls: [
        'Indexing everything in the hot tier for a year.',
        'No buffer between agents and indexers.',
        'Ignoring PII in logs.',
      ],
    },
    {
      id: 'design-infra-iq-06',
      difficulty: 'expert',
      question: 'Deep-dive probe: after a broker failure, your payments team says a few hundred acknowledged events disappeared from a Kafka topic. Explain how that is possible and how you would configure the cluster so it can’t happen.',
      context: 'Topic RF=3, producers use acks=1, min.insync.replicas=1, unclean.leader.election.enable=true (someone turned it on during a past incident).',
      whatInterviewerLooksFor: [
        'Explains acks=1 loss window on leader failover',
        'Explains unclean leader election truncation',
        'Correct config: acks=all, min ISR 2, unclean disabled, idempotence',
        'Trade-offs: availability and latency cost',
      ],
      modelAnswer: `### How acked data disappears
1. **acks=1**: the leader acks after writing locally, before followers replicate. If the leader dies right after acking, a follower that never received those messages becomes leader → the acked messages are gone; when the old leader returns it **truncates** its log to match the new leader.
2. **min.insync.replicas=1**: even with acks=all, the ISR can shrink to just the leader (followers lagging), so "all ISR" = one broker — the same single-copy risk.
3. **Unclean leader election = true**: if all ISR members are down, an out-of-sync replica can become leader, discarding everything it lacked — explicit data loss for availability.

### Fix
- Producers: \`acks=all\`, \`enable.idempotence=true\` (default in modern clients), retries with delivery timeout; \`max.in.flight.requests.per.connection ≤ 5\` preserves ordering with idempotence.
- Topic/broker: RF=3 across AZs, \`min.insync.replicas=2\`, \`unclean.leader.election.enable=false\`.
- Result: an ack means at least two replicas have the data; with one broker down writes continue; with two down, producers get \`NotEnoughReplicas\` errors (**unavailable, not lossy**) — the right trade for payments.

### Costs
- Higher produce latency (wait for follower fetch, ~ a few ms in-region), lower availability under double failure.

### Verify & monitor
- Alert on under-replicated partitions, ISR shrink rate, offline partitions; chaos-test leader kills while producing with sequence checks on the consumer side (gap detection).`,
      followUps: [
        { q: 'Does acks=all with min ISR 2 give exactly-once?', a: 'No — it gives durability of acked writes. Retries can still duplicate unless the idempotent producer is enabled; end-to-end exactly-once also needs transactional or idempotent consumers.' },
        { q: 'Why not RF=2 with min ISR 2?', a: 'Then any single broker failure blocks writes (ISR drops to 1 < 2). RF=3 with min ISR 2 tolerates one failure while keeping two copies of every acked write.' },
      ],
      pitfalls: [
        'Blaming consumers or retention.',
        'Thinking RF=3 alone prevents loss.',
        'Not knowing the old leader truncates on rejoin.',
      ],
    },
    {
      id: 'design-infra-iq-07',
      difficulty: 'hard',
      question: 'Deep-dive probe: your Flink-based click aggregator shows the watermark stuck and no windows firing for one region, while Kafka lag is near zero. What is happening and how do you fix it?',
      whatInterviewerLooksFor: [
        'Understands per-partition watermarks and min() propagation',
        'Identifies idle partitions / skewed sources',
        'Idleness detection, watermark alignment, rebalancing partitions',
        'Awareness of correctness impact of forcing progress',
      ],
      modelAnswer: `### Diagnosis
- An operator's watermark is the **minimum** of its input partitions' watermarks. If one Kafka partition receives no events (e.g., a region's traffic is routed elsewhere, or keys hash unevenly), its watermark never advances → the **combined watermark is stuck** → event-time windows never close, state grows, results stop — even though lag is ~0 (there's nothing to read on that partition).
- Variants: one source far behind (clock skew on some ad servers producing old event times), or a single slow subtask.

### Fixes
- **Idleness detection**: \`WatermarkStrategy.withIdleness(Duration.ofMinutes(1))\` marks a partition idle so it's excluded from the min until data returns.
- **Fix the skew**: ensure producers spread keys across partitions; match partition count to parallelism; avoid partitions dedicated to low-traffic regions.
- **Watermark alignment** (Flink 1.15+) to stop fast sources from racing ahead and bloating state.
- **Clock hygiene** on producers: reject/clamp events with event time far in the future/past; route to a quarantine topic.

### Correctness trade-off
- Marking idle can make windows fire before a slow partition's late data arrives → those events become **late**; handle with allowed lateness + side output + reconciliation. For billing, prefer slightly delayed but complete windows and alert on watermark lag (processing time − watermark) per operator.`,
      followUps: [
        { q: 'Why not just use processing-time windows to avoid watermark issues?', a: 'Processing time attributes clicks to the minute they were processed, so any lag or replay shifts counts between minutes — unacceptable for billing and non-deterministic on reprocessing.' },
        { q: 'What metric would have caught this early?', a: 'Watermark lag per operator/partition (current processing time minus current watermark) and state size growth; alert when lag exceeds allowed lateness by a margin.' },
      ],
      pitfalls: [
        'Assuming zero consumer lag means the pipeline is healthy.',
        'Switching to processing time.',
        'Not knowing watermarks take the min across inputs.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-infra-boe-1',
      question: 'Size the distributed job scheduler for 100M one-off jobs created per day (reminders, delayed emails, retries), scheduled on average 7 days ahead and fired within ±2 s. 40% of jobs are set for "round" times (:00 or :30). Estimate pending storage, average vs peak fire rate, and executor concurrency.',
      assumptions: [
        'Job row ≈ 250 B (id, owner, fire_at, status, payload reference); indexes add ~50%',
        'Round-time jobs spread evenly over the 48 half-hour marks per day (a simplification; real traffic is even more peaky)',
        'Each execution takes ~200 ms (mostly an HTTP call to the owning service)',
        'Steady state: jobs created per day = jobs fired per day',
      ],
      steps: [
        { label: 'Pending jobs', calc: '100M/day × 7 days ahead ≈ 700M rows' },
        { label: 'Pending storage', calc: '700M × 250 B ≈ 175 GB; ×1.5 with indexes ≈ 260 GB → partition by fire-time bucket' },
        { label: 'Average fire rate', calc: '100M ÷ 86,400 ≈ 1,160 jobs/s → ×0.2 s ≈ 230 concurrent executions' },
        { label: 'Jobs due at one round mark', calc: '40M ÷ 48 ≈ 833K jobs due at the same instant' },
        { label: 'Peak with ±2 s precision', calc: '833K ÷ 4 s ≈ 208K jobs/s → ×0.2 s ≈ 42K concurrent executions (180× the average)' },
        { label: 'Peak with 60 s jitter for non-urgent jobs', calc: '833K ÷ 60 s ≈ 13.9K jobs/s → ≈ 2.8K concurrent executions' },
      ],
      answer: 'About 700M pending jobs (~260 GB with indexes). The average rate is only ~1.2K fires/s (~230 concurrent executions), but each round mark releases ~833K jobs: ~208K/s and ~42K concurrent executions at ±2 s, or ~14K/s and ~2.8K concurrent if non-urgent jobs may spread over a minute.',
      insight: 'The round-time spike, not the average, sizes the executor fleet and the downstream services it calls, so precision is a product decision. Offer a strict tier (±2 s, small volume) and a default tier with deterministic jitter over ~60 s. Load each upcoming time bucket from the partitioned table into an in-memory timing wheel ahead of time, rather than having every scheduler poll the database for due rows.',
      followUps: [
        {
          "q": "Product insists every job keeps ±2 s precision. The downstream email service can only take 20K requests/s. What breaks, and what do you do?",
          "a": "The round mark releases ~833K jobs in a 4 s window, ~208K/s — over 10× what the email service accepts, so it sheds load, errors trigger retries and the burst compounds. The scheduler must rate-limit per downstream (token bucket at 20K/s), which drains 833K jobs in ~42 s anyway, so ±2 s is physically impossible for this tier. Negotiate a per-destination precision SLA, or pre-render and hand the provider a batch with a scheduled-send time ahead of the mark."
        },
        {
          "q": "Jobs are now scheduled up to a year ahead instead of 7 days on average. What changes in the storage design?",
          "a": "Pending rows grow with the horizon: if the average lead time grows to ~180 days, 100M/day × 180 ≈ 18B rows, ≈ 4.5 TB raw or ~6.75 TB with indexes. That's beyond one Postgres. Keep far-future jobs in cheap cold storage (a partitioned table or object store by fire day) and promote a day's bucket into the hot store a few hours before it's due. Hot set stays ~1 day ≈ 100M rows; the timing wheel only ever sees the next minutes."
        }
      ],
    },
    {
      id: 'design-infra-boe-2',
      question: 'Estimate TSDB ingestion and storage for 10M active series scraped every 15 s, with tiered retention: raw 7 days, 1-minute rollups 30 days, 1-hour rollups 1 year.',
      assumptions: [
        'Gorilla-style compression ≈ 1.37 B per raw sample',
        'Rollup points store min/max/sum/count ≈ 4 values ≈ ~6 B compressed per rollup point',
        'Replication factor 3 for the raw hot tier; rollups in object storage (durable, no extra replicas)',
        'Series churn adds ~20% more series-days (pods restarting)',
      ],
      steps: [
        { label: 'Ingest rate', calc: '10M ÷ 15 s ≈ 667K samples/s' },
        { label: 'Raw per day', calc: '667K × 86,400 ≈ 5.8 × 10^10 samples × 1.37 B ≈ 79 GB/day; +20% churn ≈ 95 GB/day' },
        { label: 'Raw tier (7 d, RF3)', calc: '95 GB × 7 × 3 ≈ 2 TB' },
        { label: '1-min rollups (30 d)', calc: '12M × 1,440 × 30 × 6 B ≈ 3.1 TB' },
        { label: '1-h rollups (1 yr)', calc: '12M × 24 × 365 × 6 B ≈ 630 GB' },
        { label: 'Index/labels', calc: 'Postings + symbol tables typically 10–30% extra → ~1 TB' },
      ],
      answer: '~667K samples/s ingest and on the order of 6–7 TB total storage across tiers.',
      insight: 'Thanks to compression the storage is modest — the real limits are ingestion CPU/memory per series (head block) and query fan-out. So cardinality limits, not disk, are what keep the system healthy.',
      followUps: [
        {
          "q": "A team adds a pod_id label to 200 histograms with 12 buckets each, across 2,000 pods. How much does the active series count grow, and does the estimate still hold?",
          "a": "Each histogram has ~14 series per label set (12 buckets + sum + count). 200 × 14 × 2,000 pods ≈ 5.6M new series — a 56% jump on 10M. Ingest grows proportionally (~373K extra samples/s at 15 s), raw storage by roughly half, and head-block memory (~several KB per active series) by gigabytes per ingester. Pod restarts churn the label, multiplying series-days further. Disk is still affordable; ingester memory and query fan-out are what break, which is why per-metric series limits exist."
        },
        {
          "q": "You want to keep raw 15 s data for 90 days instead of 7 for SLO debugging. What does it cost, and is there a cheaper way?",
          "a": "Raw is ~95 GB/day per copy. 90 days × 95 GB × RF3 ≈ 25.7 TB on replicated disks versus ~2 TB today. Better: keep RF3 only for the 2-hour head/recent blocks, compact blocks to object storage (Thanos/Mimir style), where 90 days ≈ 8.6 TB in S3 at ~$0.023/GB ≈ $200/month. The cost is query latency for old data, served by store gateways with index caches."
        }
      ],
    },
    {
      id: 'design-infra-boe-3',
      question: 'For the logging platform (300 MB/s raw), estimate the hot/warm/cold storage footprint and the monthly storage cost difference between indexing everything in Elasticsearch vs a Loki-style label index.',
      assumptions: [
        '300 MB/s raw ≈ 26 TB/day',
        'Elasticsearch on-disk ≈ 1.1× raw per copy; 1 replica in hot and warm; cold as searchable snapshot in S3 compressed to ~0.15× raw',
        'Loki: chunks compressed ~0.12× raw in S3, small label index; ingesters hold ~2 h in memory',
        'Prices: NVMe hot ~$0.10/GB-month, HDD warm ~$0.04/GB-month, S3 ~$0.023/GB-month',
      ],
      steps: [
        { label: 'ES hot (7 d)', calc: '26 TB × 7 × 1.1 × 2 ≈ 400 TB × $0.10 ≈ $40K/month' },
        { label: 'ES warm (days 8–30)', calc: '26 TB × 23 × 1.1 × 2 ≈ 1,316 TB × $0.04 ≈ $53K/month' },
        { label: 'ES cold (to 1 yr)', calc: '26 TB × 335 × 0.15 ≈ 1,306 TB × $0.023 ≈ $30K/month' },
        { label: 'ES total', calc: '≈ $123K/month storage (compute not included)' },
        { label: 'Loki (all 365 d in S3)', calc: '26 TB × 365 × 0.12 ≈ 1,139 TB × $0.023 ≈ $26K/month' },
      ],
      answer: 'Roughly $120K+/month of storage for a fully indexed Elasticsearch design vs ~$26K/month for a Loki-style design — about 4–5× cheaper on storage alone (more once indexing compute is included).',
      insight: 'The index is the expensive part. Index only what you search by (service, level, trace_id), keep bodies compressed in object storage, and reserve full-text indexing for the small set of logs (security, audit) that truly need it. Sampling DEBUG/INFO noise at ingestion is the next biggest lever.',
      followUps: [
        {
          "q": "During an incident, log volume spikes to 10× (3 GB/s) for 2 hours. What absorbs the burst, and how big must it be?",
          "a": "Kafka between shippers and indexers. Extra data: (3,000 − 300) MB/s × 7,200 s ≈ 19.4 TB in 2 hours. If indexers keep consuming at their normal capacity (say 2× baseline, 600 MB/s), the backlog peaks around 17 TB, so Kafka needs ~17 TB × RF3 ≈ 52 TB of headroom, and catch-up takes ~16 h at 300 MB/s spare. Alternatively, sample or drop DEBUG at the shipper when lag exceeds a threshold, and prioritise ERROR topics so they stay near-real-time."
        },
        {
          "q": "With the Loki design, a 'grep for this request ID across all services for the last 24 h' query is slow. Why, and how do you fix it without indexing everything?",
          "a": "Loki only indexes labels, so a query without narrow labels must fetch and decompress every chunk in the time range: 24 h is ~26 TB raw, ~3 TB compressed — far too much to scan interactively. Fix by promoting trace_id/request_id into structured metadata with bloom filters per chunk (Loki 3.x), so most chunks are skipped, or keep a small side index of request_id → (stream, time) in a KV store. Encouraging queries scoped by service label also cuts the scan by orders of magnitude."
        }
      ],
    },
  ],
  test: [
    {
      id: 'design-infra-mcq-01',
      difficulty: 'hard',
      question: 'RF=3, min.insync.replicas=2, producers use acks=all. No broker is down, but one follower has a degraded disk: it still catches up with the leader on every fetch, but each fetch cycle now takes ~2 s instead of a few ms (replica.lag.time.max.ms = 30 s). What do producers of that partition see?',
      options: [
        'Produce latency rises to roughly 2 s and stays there, because the leader waits for every ISR member and the slow follower never lags enough to be dropped from the ISR',
        'No change: acks=all returns once min.insync.replicas (2) copies have the batch, so the slow third replica is never waited on',
        'Writes fail with NotEnoughReplicas until the slow follower\'s disk is replaced',
        'The controller moves leadership to the slow follower\'s broker to rebalance load',
      ],
      correct: [0],
      explanation: 'With acks=all the leader waits for all replicas currently in the ISR, not just min.insync.replicas of them. min.insync is only the floor below which writes are rejected. A follower that catches up within replica.lag.time.max.ms stays in the ISR, so every produce waits for its ~2 s fetch cycle and p99 latency follows it. The fix is operational: repair or reassign the replica (or remove it from the ISR). Nothing is rejected because the ISR never drops below 2, and the controller does not move leadership to a degraded broker.',
      followUps: [
        {
          "q": "You can't touch the disk for a week. How do you stop the slow follower from dragging produce latency, without dropping below min.insync.replicas = 2?",
          "a": "Reassign the partition's replicas away from the degraded broker with `kafka-reassign-partitions` (add a healthy broker, then drop the slow one once it catches up), or take that broker down so it leaves the ISR — the ISR then shrinks to 2, which still meets min.insync, so writes keep succeeding at normal latency. Lowering `replica.lag.time.max.ms` to a few seconds would also evict it automatically, but risks ISR flapping on every GC pause cluster-wide. The real lesson: alert on per-broker fetch latency and `UnderReplicatedPartitions`, not just on broker liveness."
        },
        {
          "q": "Now a second broker in the same partition's replica set dies while the slow one is still in the ISR. What happens to producers?",
          "a": "If the dead broker was the leader, the controller elects a new leader from the ISR — possibly the slow broker, which is then the bottleneck for everything. Either way the ISR is now 2 (one healthy, one slow), still at min.insync, so writes succeed but every ack waits on the 2 s replica. If the slow one then falls out of the ISR, the ISR becomes 1 < min.insync and acks=all producers get `NotEnoughReplicas` — the partition is read-only until a replica recovers. That is the intended trade: unavailability over silent data loss."
        }
      ],
    },
    {
      id: 'design-infra-mcq-02',
      difficulty: 'expert',
      question: 'What delivery semantics does this consumer provide?',
      code: {
        language: 'typescript',
        code: `await consumer.run({
  autoCommit: false,
  eachMessage: async ({ topic, partition, message }) => {
    await consumer.commitOffsets([{ topic, partition,
      offset: (BigInt(message.offset) + 1n).toString() }]);
    await chargeCustomer(JSON.parse(message.value!.toString()));
  },
});`,
      },
      options: [
        'Exactly-once, because offsets are committed manually',
        'At-least-once, because the charge can be retried',
        'At-most-once: a crash after the commit but before chargeCustomer completes skips that message forever',
        'Exactly-once if chargeCustomer is fast enough',
      ],
      correct: [2],
      explanation: 'Committing before processing means the committed position already moved past the message; a crash before the charge completes loses it — at-most-once. Manual commits don’t imply exactly-once; you need process-then-commit (at-least-once) plus an idempotent charge (idempotency key = topic/partition/offset or event ID) for effectively-once.',
      followUps: [
        {
          "q": "You switch to process-then-commit. The consumer crashes after `chargeCustomer` succeeds but before the commit. How do you stop the customer from being charged twice?",
          "a": "Pass an idempotency key derived from the event (an event ID, or `topic-partition-offset` if the producer doesn't set one) to the payment provider, or record it in your own DB in the same transaction as the charge record with a unique constraint. On replay the provider returns the original result instead of charging again. Offsets alone can't fix this because the charge is an external side effect Kafka can't roll back; Kafka transactions (EOS) only cover writes back into Kafka."
        },
        {
          "q": "chargeCustomer calls a provider with a 5 s p99. One partition has a backlog of 200K messages. What breaks with `eachMessage`, and what do you change?",
          "a": "Messages in a partition are processed strictly one at a time, so throughput is ~1/latency: at a 5 s p99 the partition crawls and lag grows. Long calls can also exceed `max.poll.interval.ms`/session timeouts and trigger rebalances, causing replays. Options: process concurrently within a partition by key (e.g. per-customer queues) while committing only the lowest contiguous completed offset, add partitions, or move the charge to an async workflow and have the consumer only enqueue it. Monitor consumer lag per partition and charge latency."
        }
      ],
    },
    {
      id: 'design-infra-mcq-03',
      difficulty: 'medium',
      question: 'A keyed topic (key = orderId) has 12 partitions. You increase it to 24 to add throughput. What is the main risk?',
      options: [
        'Existing data is re-hashed and moved to new partitions, doubling storage',
        'Consumers must be restarted with a new group ID',
        'Kafka rejects partition increases on keyed topics',
        'New messages for an orderId may go to a different partition than its older messages, so per-order ordering across the transition is not guaranteed',
      ],
      correct: [3],
      explanation: 'hash(key) % partitions changes when the count changes, so a key’s new events can land in a different partition while old events remain in the old one — consumers may process them out of order during the transition. Kafka doesn’t move existing data, allows increases (not decreases), and consumer groups rebalance automatically.',
      followUps: [
        {
          "q": "Orders must stay strictly ordered per orderId even during the change. How do you grow from 12 to 24 partitions safely?",
          "a": "Don't expand in place. Create a new 24-partition topic, dual-write or migrate producers at a cut-over point, and let consumers drain the old topic completely before reading the new one for any given key — a common trick is to pause producers briefly, wait until old-topic lag hits zero, then switch. Alternatively, over-partition from day one (e.g. 96) so you never resize. Consumers should also tolerate reordering defensively with a per-order version number and ignore stale transitions."
        }
      ],
    },
    {
      id: 'design-infra-mcq-04',
      difficulty: 'hard',
      question: 'Consumers in a group are constantly rebalancing; logs show members being kicked after long processing batches. Which changes address the cause? Select ALL that apply.',
      options: [
        'Reduce max.poll.records / batch size or increase max.poll.interval.ms so processing between polls stays within the limit',
        'Use static membership (group.instance.id) so rolling restarts don’t trigger rebalances',
        'Switch to cooperative-sticky assignment so rebalances only move affected partitions',
        'Increase the number of partitions to 10× the consumer count',
      ],
      correct: [0, 1, 2],
      explanation: 'Exceeding max.poll.interval.ms makes the coordinator consider the member dead; smaller batches or a longer interval fix that. Static membership avoids rebalances when a member restarts within session timeout, and cooperative-sticky minimises disruption. More partitions don’t address slow processing between polls and add overhead.',
      followUps: [
        {
          "q": "After the fix, processing a batch legitimately takes up to 8 minutes for some messages (video transcodes). Raising max.poll.interval.ms to 15 minutes is proposed. What's the downside, and what's a better design?",
          "a": "A huge poll interval means a truly hung consumer isn't detected for 15 minutes, so its partitions stall that long. Better: decouple — the consumer polls fast, hands work to a worker pool, pauses the partition (`consumer.pause`) while the backlog is full, keeps calling poll to stay in the group, and commits offsets only after work completes. Or treat the topic as a job trigger and run transcodes through a proper job queue with per-job leases and visibility timeouts."
        }
      ],
    },
    {
      id: 'design-infra-mcq-05',
      difficulty: 'medium',
      question: 'Why does a Kafka broker rely on the OS page cache rather than a large in-process cache?',
      options: [
        'The JVM cannot allocate more than 4 GB of heap',
        'Page cache avoids double-buffering and GC pressure, survives broker process restarts, and enables zero-copy sendfile to sockets for reads of recent data',
        'Page cache guarantees durability without fsync',
        'In-process caches are not allowed by the Kafka license',
      ],
      correct: [1],
      explanation: 'Using the page cache keeps the JVM heap small (less GC), avoids storing data twice (heap + page cache), stays warm across process restarts, and lets the kernel send file bytes directly to the socket. It doesn’t guarantee durability — Kafka relies on replication for that, not per-message fsync. The JVM heap limit claim is false.',
      followUps: [
        {
          "q": "A consumer group replays 3 days of data from the start of a topic while producers are writing. Latency for real-time consumers jumps. Why, and how do you mitigate it?",
          "a": "The catch-up consumer reads old segments that are not in page cache, so the broker does disk reads and pulls those pages into cache, evicting the hot tail that real-time consumers and replication rely on. They now miss cache too and hit disk. Mitigate with consumer quotas (`consumer_byte_rate`) on the replay client, replaying from a follower via rack-aware fetch (KIP-392), reading from tiered storage/S3 for old data, or running backfills on a separate cluster or mirror."
        }
      ],
    },
    {
      id: 'design-infra-mcq-06',
      difficulty: 'expert',
      question: 'You run Prometheus-style pull collection. Which scenarios are better served by push? Select ALL that apply.',
      options: [
        'A nightly batch job that runs for 40 seconds',
        'Edge devices behind NAT that cannot accept inbound connections',
        'Long-running Kubernetes services discovered via the Kubernetes API',
        'Serverless functions with sub-second lifetimes',
      ],
      correct: [0, 1, 3],
      explanation: 'Short-lived jobs and functions may finish between scrapes, and NAT/firewalled devices can’t be scraped — push (Pushgateway, OTLP, StatsD) fits them. Long-running, discoverable services are the ideal pull case: a failed scrape doubles as a liveness signal.',
      followUps: [
        {
          "q": "You add a Pushgateway for the nightly batch job. Three months later dashboards show a job 'succeeding' that was deleted. What went wrong, and how should batch metrics be modelled?",
          "a": "The Pushgateway retains the last pushed values forever until explicitly deleted, and Prometheus scrapes them as if live. So stale series never disappear. Push a `last_success_timestamp_seconds` gauge and alert on `time() - last_success > 26h`, delete the group at job teardown, and avoid per-instance labels that pile up. For very many short-lived jobs, push via OTLP to a collector that aggregates instead of the Pushgateway, which is a single non-HA cache rather than a buffer."
        }
      ],
    },
    {
      id: 'design-infra-mcq-07',
      difficulty: 'hard',
      question: 'A dashboard shows "p99 latency" computed like this. What is wrong?',
      code: {
        language: 'text',
        code: `avg(
  histogram_quantile(0.99,
    sum by (pod, le) (rate(http_server_duration_seconds_bucket[5m])))
)`,
      },
      options: [
        'Nothing; averaging per-pod p99 gives the fleet p99',
        'rate() should be irate() for quantiles',
        'It averages per-pod quantiles, which is not a quantile of the combined distribution; aggregate buckets across pods first (sum by (le)) and then take histogram_quantile',
        'Histograms can’t be used for percentiles; use a gauge',
      ],
      correct: [2],
      explanation: 'Quantiles don’t average: a pod handling 1% of traffic with terrible latency distorts the average, and busy pods are under-weighted. Summing bucket counters across pods and then computing the quantile yields the fleet-wide p99 (within bucket resolution). irate is for volatile instant rates, not correctness here.',
      followUps: [
        {
          "q": "Your histogram buckets are 0.1, 0.5, 1, 5 seconds and the SLO is 'p99 < 300 ms'. Can this query answer whether you meet it?",
          "a": "Not reliably. histogram_quantile linearly interpolates inside a bucket, so a true p99 anywhere between 100 and 500 ms reports a number that's mostly an artefact. Add a bucket boundary exactly at the SLO threshold (0.3) and alert on the ratio `sum(rate(bucket{le=\"0.3\"})) / sum(rate(count))` against 0.99 — that's exact, not estimated. Or adopt native/exponential histograms, which give ~few % relative error at every value without hand-chosen buckets."
        },
        {
          "q": "Now compute the fleet p99 across 3 regions, each with its own Prometheus. Where do you aggregate?",
          "a": "Same rule: sum buckets across regions, then take the quantile. Use a global query layer (Thanos Querier, Mimir, or federation of pre-aggregated `sum by (le)` recording rules from each region) so the bucket counters can be summed globally. Averaging three regional p99s is wrong for the same reason as averaging pods. Recording rules per region keep the global query cheap: each region exports a few dozen bucket series instead of per-pod data."
        }
      ],
    },
    {
      id: 'design-infra-mcq-08',
      difficulty: 'expert',
      question: 'Your TSDB ingesters are OOM-killed after a deploy. Series count jumped from 8M to 90M. Which is the most likely cause?',
      options: [
        'A new label with unbounded values (e.g. request path with IDs, or user_id) was added to a high-volume metric',
        'The scrape interval was reduced from 30 s to 15 s',
        'Gorilla compression was disabled',
        'Retention was increased from 7 to 30 days',
      ],
      correct: [0],
      explanation: 'Series count explodes with label cardinality; a raw URL path or user ID label multiplies series by millions. Halving the interval doubles samples, not series. Compression affects bytes per sample, and retention affects disk, not in-memory active series in the head block.',
      followUps: [
        {
          "q": "You must stop this from happening again without blocking teams from adding labels. What controls do you put in the ingest path?",
          "a": "Enforce per-tenant limits at the distributor: max active series per tenant and per metric, and max label-value length; reject samples beyond the limit with a clear error and a metric. In scrape config, use `sample_limit` per target so one bad deploy fails its own scrape rather than OOMing ingesters. Add a CI lint for metric definitions and a cardinality dashboard (top metrics by series count via TSDB status API). Teams that need per-user detail should emit exemplars, traces or logs instead of labels."
        }
      ],
    },
    {
      id: 'design-infra-mcq-09',
      difficulty: 'medium',
      question: 'An alert manager receives the same "HighErrorRate" alert from 3 replicated rule evaluators and 200 pods at once. Which features prevent 600 pages?',
      options: [
        'Increasing the rule evaluation interval to 10 minutes',
        'Sending alerts only by email',
        'Disabling replicas of the rule evaluator',
        'Deduplication of identical alerts and grouping by labels (e.g. service) into one notification',
      ],
      correct: [3],
      explanation: 'Alert managers dedup identical alerts from replicated evaluators and group related alerts (by service/cluster) into a single notification, optionally inhibiting symptom alerts when a root-cause alert fires. Slowing evaluation delays detection, email doesn’t reduce volume, and removing evaluator replicas sacrifices reliability.',
      followUps: [
        {
          "q": "Grouping works, but during a database outage on-call still gets 40 separate pages from every dependent service. How do you reduce it to one actionable page?",
          "a": "Use inhibition rules: when `DatabaseDown{cluster=X}` fires, suppress symptom alerts (HighErrorRate, HighLatency) whose labels share `cluster=X`. That needs consistent labels across alerts, so a dependency label on services is required. Also page on symptoms close to the user (SLO burn rate on the edge) and route cause-level alerts to tickets, so a single burn-rate alert pages and the rest annotate it. Measure pages per incident as a health metric."
        }
      ],
    },
    {
      id: 'design-infra-mcq-10',
      difficulty: 'expert',
      question:
        'The click aggregator does keyBy(adId) → 1-minute count, with parallelism 64. A Super Bowl ad suddenly gets 40% of all clicks. One subtask sits at 100% busy, upstream operators show backpressure, and per-minute results for every ad arrive late. Which change fixes the cause while keeping the counts exact?',
      options: [
        'Raise the parallelism from 64 to 256 so each subtask handles fewer ads',
        'Pre-aggregate in two stages: key by (adId, random salt 0..N−1) for partial per-minute counts, then key by adId to sum the N partials',
        'Switch the state backend from heap to RocksDB so the hot key has more room for state',
        'Replace the tumbling window with a 10-second sliding window so the hot ad\'s work is spread over more windows',
      ],
      correct: [1],
      explanation:
        'All events for one key go to one subtask, so extra parallelism cannot split a single hot adId: 40% of the traffic still lands on one core, and the slowest subtask holds back the watermark for everyone downstream. Salting the key spreads the hot ad over N subtasks; the second stage then sums only N partial counts per ad per minute, so the totals stay exact. RocksDB addresses state size, not CPU on one key. A sliding window multiplies the work because each event belongs to several windows.',
      followUps: [
        {
          "q": "With salting, how do you pick N, and what does it cost the second stage?",
          "a": "Choose N so the hot key's share fits per subtask: at 40% of traffic and a goal of no subtask above ~3–5% load, N ≈ 8–16. Salting every key with N multiplies stage-1 state and stage-2 input by up to N, so apply it adaptively: only to keys flagged hot by a heavy-hitter sketch (count-min) or a known list. The second stage receives at most N partials per ad per minute, which is trivial. Both stages must use the same event-time windows so partials align."
        },
        {
          "q": "Results arrive late for every ad, not just the hot one. Why does one slow subtask delay unrelated keys?",
          "a": "Watermarks propagate as the minimum across input channels. The overloaded subtask's output watermark lags, and any downstream operator that merges its stream (e.g. a global top-100 or the sink) can't advance its watermark, so no window closes anywhere. Backpressure also slows the shared upstream source, delaying all partitions it reads. Watch `currentOutputWatermark` skew across subtasks and `busyTimeMsPerSecond`; a skew alarm catches a hot key before results go late."
        }
      ],
    },
    {
      id: 'design-infra-mcq-11',
      difficulty: 'hard',
      question: 'This aggregator writes to Cassandra and then commits Kafka offsets. It crashes between the two steps. What happens on restart?',
      code: {
        language: 'typescript',
        code: `for (const [key, n] of windowCounts) {
  await cassandra.execute(
    'UPDATE ad_counts SET clicks = clicks + ? WHERE ad_id = ? AND minute = ?',
    [n, key.adId, key.minute]);      // counter column
}
await consumer.commitOffsets(offsets);`,
      },
      options: [
        'The batch is reprocessed and counter increments are applied again, double counting',
        'Nothing is lost or duplicated because Cassandra counters are idempotent',
        'The batch is skipped because Cassandra already has the data',
        'Kafka automatically rolls back the Cassandra writes',
      ],
      correct: [0],
      explanation: 'Offsets weren’t committed, so the consumer re-reads the batch; Cassandra counters are increments (explicitly not idempotent), so clicks are added twice. Kafka cannot roll back external writes. Fix: write final window values with an upsert keyed by window (SET, not +), store offsets with results, or use a transactional/2PC sink.',
      followUps: [
        {
          "q": "You switch to `SET clicks = ?` with the final window value. A late click for minute 12:03 arrives at 12:09 after the window was written. What happens, and how do you handle it?",
          "a": "If the window state was purged, the late event either opens a new window containing only itself and SET overwrites the correct total with 1 — silent data loss — or it's dropped. Keep state for an allowed-lateness period and re-emit the updated full total (SET stays correct since it's the complete value), and route events later than that to a side output for a correction job. For billing, the nightly batch recompute from raw events is the final source of truth."
        }
      ],
    },
    {
      id: 'design-infra-mcq-12',
      difficulty: 'medium',
      question: 'Why does the classic ad-click design keep raw click events even though queries only use aggregates? Select ALL that apply.',
      options: [
        'To recalculate aggregates after a bug by replaying raw data (kappa-style)',
        'To reconcile real-time results against a batch recomputation for billing',
        'To debug disputes about specific clicks',
        'Because the aggregation database cannot store integers',
      ],
      correct: [0, 1, 2],
      explanation: 'Raw events are the source of truth: replay after bugs, nightly reconciliation, and audit/debugging of individual clicks all require them. They go to cheap cold storage (S3/Parquet). The storage-of-integers option is nonsense.',
      followUps: [
        {
          "q": "Raw clicks at 1B/day must be kept for 2 years for disputes. How do you store them cheaply and still find a specific click quickly?",
          "a": "Write Parquet files to S3 partitioned by date/hour (and maybe advertiser), compressed with zstd: ~100 B/click compressed → ~100 GB/day → ~73 TB over 2 years, about $1.7K/month on S3 Standard, less on Infrequent Access/Glacier for older partitions. Query with Athena/Trino using partition pruning plus Parquet min/max statistics or bloom filters on click_id, so a lookup scans a few files. Apply lifecycle rules and GDPR deletion by partition rewrite."
        }
      ],
    },
    {
      id: 'design-infra-mcq-13',
      difficulty: 'expert',
      question: 'Two scheduler replicas both run this. What can go wrong?',
      code: {
        language: 'sql',
        code: `-- replica A and B, same instant
SELECT id FROM jobs WHERE status='SCHEDULED' AND next_run_at <= now() LIMIT 100;
-- then, for each id:
UPDATE jobs SET status='RUNNING' WHERE id = $1;`,
      },
      options: [
        'Nothing, the UPDATE takes a row lock so only one replica can run the job',
        'Postgres deadlocks every time',
        'Both replicas can select the same rows and both run the job, because the UPDATE doesn’t re-check status and the SELECT took no locks',
        'The second UPDATE fails with a serialization error under READ COMMITTED',
      ],
      correct: [2],
      explanation: 'The SELECT doesn’t lock, so both replicas get the same IDs; the unconditional UPDATE succeeds for both (the second just waits for the first’s lock and then overwrites). Under READ COMMITTED there’s no serialization error. Fix: SELECT … FOR UPDATE SKIP LOCKED in the same transaction, or a conditional UPDATE … WHERE status = SCHEDULED RETURNING.',
      followUps: [
        {
          "q": "You add `FOR UPDATE SKIP LOCKED`. Under load, one replica claims all 100 due jobs every tick while the others idle. Why, and how do you balance?",
          "a": "Whichever replica's tick hits first locks the oldest 100 rows; the others find them locked and get the next ones, but if fewer than 100 are due, the first replica wins everything. Use smaller claim batches proportional to free worker capacity, stagger ticks with jitter, or claim into a durable queue that workers pull from so execution balances naturally. At larger scale, shard jobs by hash(job_id) across replicas with lease-based ownership of shards."
        },
        {
          "q": "Postgres now runs 50 replicas polling every second with SKIP LOCKED. What degrades first?",
          "a": "The `(status, next_run_at)` index scan contends: each poller walks over rows other transactions have locked, and dead tuples from constant status updates bloat the index, so scans get slower and vacuum falls behind. Connection count also grows. Mitigate with a partial index `WHERE status='SCHEDULED'`, partitioning by time bucket, fewer pollers that prefetch the next minute into an in-memory timing wheel, and LISTEN/NOTIFY or a queue for dispatch."
        }
      ],
    },
    {
      id: 'design-infra-mcq-14',
      difficulty: 'expert',
      question: 'A worker holding a job lease pauses for 90 s (GC/VM stall); the lease (60 s) expires and another worker re-runs the job. Which mechanisms make this safe? Select ALL that apply.',
      options: [
        'A fencing token incremented on each claim, with result writes conditioned on it',
        'Idempotent side effects keyed by (job_id, scheduled_time)',
        'Increasing the lease to 10 minutes and assuming pauses never exceed it',
        'Having the paused worker check the wall clock before writing its result',
      ],
      correct: [0, 1],
      explanation: 'Fencing tokens let the store reject the stale worker’s writes, and idempotent side effects make the double execution harmless. Longer leases just move the problem (pauses are unbounded, and long leases slow recovery). Checking the local clock before writing is racy — the pause can happen right after the check.',
      followUps: [
        {
          "q": "The job sends an email through a third-party API that has no idempotency key and no fencing support. How do you make a double run harmless?",
          "a": "Put a dedup record in a store you control: before sending, `INSERT INTO sent (job_id, scheduled_time) ON CONFLICT DO NOTHING` and only send if the insert won, with the insert conditioned on the current fence. A crash between insert and send means at-most-once for that email, so pick the order based on whether a missed or duplicate email is worse, and add a reconciliation job that checks the provider's message log. Exactly-once against a non-idempotent external system isn't achievable — you choose the failure mode."
        }
      ],
    },
    {
      id: 'design-infra-mcq-15',
      difficulty: 'hard',
      question: 'Your Elasticsearch logging cluster is 70% of the observability budget. Which changes reduce cost without losing the ability to debug recent incidents? Select ALL that apply.',
      options: [
        'Move indices older than 7 days to warm nodes and older than 30 days to searchable snapshots in S3 via ILM',
        'Sample repetitive INFO/DEBUG logs at ingestion while keeping all ERROR logs',
        'Index only the fields you search by (service, level, trace_id) and store message bodies unindexed or in a label-indexed store like Loki',
        'Turn off Kafka buffering so logs go directly to Elasticsearch',
      ],
      correct: [0, 1, 2],
      explanation: 'Tiering, sampling noise and reducing indexed fields all cut storage and indexing cost while keeping recent, important data searchable. Removing the Kafka buffer saves little and makes the platform drop logs during incident-time bursts — exactly when you need them.',
      followUps: [
        {
          "q": "Leadership wants search over a year of logs for a security investigation, but cold data is in S3 snapshots. What latency do you promise, and how do you make it workable?",
          "a": "Searchable snapshots fetch blocks from S3 on demand, so a full-text query across months can take minutes and costs requests. Promise seconds for 7 days, tens of seconds for 30 days, and minutes (async query) for older data. Narrow scans by requiring service/time filters, keep per-segment bloom filters on fields like user_id or IP, and for security use cases ship the relevant subset (auth, audit) to a separate always-indexed store with its own retention."
        }
      ],
    },
  ],
};

export default topic;
