import type { Topic } from '../../types';

const topic: Topic = {
  id: 'data-pipelines',
  phase: 'messaging',
  order: 3,
  title: 'Data Pipelines: Batch, Streaming & CDC',
  subtitle:
    'ETL vs ELT, batch vs stream, lambda vs kappa, windows, event time and watermarks, exactly-once checkpoints, CDC with Debezium, lakes vs warehouses, real-time dashboards and reconciliation.',
  estimatedMinutes: 115,
  sources: [
    'Alex Xu — System Design Interview Vol 2, Ch 6 Ad Click Event Aggregation',
    'Designing Data-Intensive Applications — Ch 10 (batch) & Ch 11 (stream processing)',
    'Apache Flink documentation (event time, watermarks, checkpointing)',
    'Debezium documentation (PostgreSQL connector, outbox event router)',
  ],
  tags: ['etl', 'elt', 'batch', 'streaming', 'flink', 'kafka-streams', 'spark', 'lambda', 'kappa', 'windowing', 'watermarks', 'exactly-once', 'cdc', 'debezium', 'outbox', 'lakehouse', 'iceberg', 'clickhouse', 'reconciliation'],
  cheatSheet: [
    'ETL transforms before loading (fixed schema, less raw data); ELT loads raw into the warehouse/lake and transforms with SQL (dbt). ELT is the modern default: cheap storage, reprocessable raw data.',
    'Batch = bounded input, high throughput, minutes–hours latency, easy reruns (overwrite a partition). Stream = unbounded input, seconds latency, stateful, harder correctness.',
    'Lambda = batch layer (truth) + speed layer (fast, approximate), two codebases. Kappa = one streaming codebase, reprocess by replaying the log. Needs long retention or the lake as replay source.',
    'Windows: tumbling (fixed, non-overlapping), hopping (fixed size, overlapping with a slide), sliding (per event / continuous), session (gap-based, per key).',
    'Always aggregate on EVENT time. Processing-time windows shift data when consumers lag or replay, which gives fake spikes.',
    'Watermark W(t) = "no events older than t expected". Typical: max seen event time − allowed delay. Window fires when watermark passes its end. Later data → allowed lateness update, side output, or drop + count.',
    'An idle partition stalls the watermark (it is the MIN across inputs). Configure source idleness timeouts.',
    'Streaming exactly-once = checkpoint (Chandy-Lamport barriers) of state + source offsets, plus transactional (2PC) or idempotent sinks. End-to-end latency ≥ checkpoint interval for transactional sinks.',
    'CDC: read the DB log (Postgres logical replication / MySQL binlog) with Debezium → Kafka. No dual writes, captures deletes, preserves commit order. Watch replication slot WAL retention (max_slot_wal_keep_size).',
    'Reconcile streaming against batch (or source of truth) daily: counts, sums, checksums per partition. Batch wins; publish corrections. Dashboards should show data freshness.',
  ],
  sections: [
    {
      heading: 'The pipeline landscape: sources, sinks, ETL vs ELT',
      body: `**Intuition:** a data pipeline is plumbing that moves facts from where they happen (OLTP databases, event streams, logs, SaaS APIs) to where they're used (warehouse, search index, feature store, dashboards). ETL cleans the water before it enters the tank; ELT pours it all in and filters inside the tank.

**Typical sources → sinks:**
- Sources: service databases (via CDC), event topics (clickstream, orders), logs, third-party APIs (Stripe, Salesforce), files (partner SFTP drops).
- Sinks: warehouse (Snowflake, BigQuery, Redshift), lake/lakehouse (S3 + Iceberg/Delta), OLAP for real-time (ClickHouse, Druid, Pinot), search (Elasticsearch/OpenSearch), caches, ML feature stores.

**ETL vs ELT:**
| | ETL | ELT |
|---|---|---|
| Transform where | dedicated engine before load (Spark, Informatica) | inside the warehouse/lakehouse (SQL, dbt) |
| Raw data kept | often not | yes (bronze/raw layer) |
| Reprocessing after a logic bug | re-extract from sources (may be gone) | re-run SQL over raw |
| Cost profile | compute outside, smaller storage | cheap storage, warehouse compute |
| PII handling | can strip before landing (compliance plus) | must govern raw zone carefully |
| Modern default | streaming enrichment, privacy-sensitive paths | analytics platforms |

**Medallion layering** (common in lakehouses): **bronze** (raw, append-only, as received) → **silver** (cleaned, deduped, conformed types) → **gold** (business aggregates, dashboards). Each layer is reproducible from the previous one — the reason keeping raw data is so valuable.

**Non-functional questions to ask in any pipeline interview:** freshness SLO (seconds? hourly? daily?), correctness requirement (billing-grade vs directional analytics), volume and growth, late/out-of-order data, replay/backfill needs, schema evolution, PII/retention rules.`,
      diagram: `  OLTP DBs --CDC--> Kafka --Flink jobs--> OLAP (ClickHouse) --> dashboards
  services --events-->  |              \\--> search index / caches
  logs/files ----------'
                        '--sink--> Lake: bronze -> silver -> gold --> BI, ML
                                         (raw)    (clean)  (aggregates)
                           batch jobs (Spark/dbt) + daily reconciliation`,
      keyPoints: [
        'ETL transforms before load; ELT loads raw and transforms in-warehouse.',
        'Keep raw data: it makes every downstream layer reproducible.',
        'Ask freshness, correctness grade, volume, lateness, replay and PII up front.',
      ],
    },
    {
      heading: 'Batch processing: MapReduce, Spark and idempotent reruns',
      body: `**Intuition:** batch is doing the laundry once a day: collect everything, process it all together efficiently, and if something goes wrong, rewash the whole load.

**Mechanics:**
- **MapReduce model:** map (parse/filter/emit key-value) → **shuffle** (group by key across the cluster) → reduce (aggregate). Spark generalizes this into a DAG of stages with in-memory intermediate data; shuffles are stage boundaries and usually the most expensive step.
- **Inputs are bounded** (e.g., \`dt=2026-09-27\` partition), so results are deterministic: same input + same code = same output.
- **Throughput:** a Spark cluster scans TBs per hour; cost is dominated by I/O and shuffle. Columnar formats (Parquet/ORC) + partition pruning + predicate pushdown make scans cheap.

**Correctness properties that make batch great:**
1. **Idempotent reruns:** write outputs by **overwriting a partition** (\`INSERT OVERWRITE ... PARTITION (dt=...)\`) or atomic table snapshots (Iceberg/Delta). Re-running a failed or buggy day is safe — no duplicates.
2. **Backfills:** fix the code, rerun last 90 days — trivial if raw data is retained.
3. **Orchestration:** Airflow/Dagster DAGs with dependencies, retries, SLAs and sensors ("wait until upstream partition lands").

**Common batch problems (and fixes):**
| Problem | Symptom | Fix |
|---|---|---|
| Data skew | one task runs 10× longer | salt hot keys, broadcast small side of joins, AQE skew join (Spark 3) |
| Small files | job spends minutes listing/opening files | compaction, target 256 MB–1 GB files |
| Late upstream | job starts on incomplete data | sensors on partition completeness markers (_SUCCESS), data contracts |
| Non-idempotent writes | duplicates after retry | overwrite partitions / MERGE by key |
| Full recompute cost | nightly job grows with history | incremental processing (only new partitions), materialized aggregates |`,
      code: [
        {
          language: 'sql',
          title: 'Idempotent daily batch: overwrite one partition (Spark SQL on Iceberg)',
          code: `-- Rerunning this for the same dt produces the same result: no duplicates, no deletes needed.
INSERT OVERWRITE gold.daily_ad_metrics
SELECT
  ad_id,
  country,
  COUNT(*)                          AS clicks,
  COUNT(DISTINCT user_id)           AS unique_users,
  SUM(CASE WHEN is_bot THEN 1 ELSE 0 END) AS bot_clicks,
  DATE(event_time)                  AS dt          -- partition column
FROM silver.ad_clicks
WHERE DATE(event_time) = DATE '2026-09-27'         -- partition pruning: scan one day only
  AND NOT is_duplicate
GROUP BY ad_id, country, DATE(event_time);

-- With dynamic partition overwrite, only dt=2026-09-27 is replaced:
-- SET spark.sql.sources.partitionOverwriteMode = dynamic;`,
        },
      ],
      keyPoints: [
        'Shuffle is the expensive step; skew and small files are the classic slowdowns.',
        'Overwrite partitions or MERGE for idempotent reruns and backfills.',
        'Orchestrators give dependencies, retries and completeness sensors.',
      ],
      source: 'Designing Data-Intensive Applications — Ch 10 Batch Processing',
    },
    {
      heading: 'Stream processing: Flink, Kafka Streams and stateful operators',
      body: `**Intuition:** streaming is a conveyor belt: each item is processed as it passes, and workers keep small notebooks (state) — running counts, the last value per key — so they don't have to look at the whole history.

**Engines:**
| | Apache Flink | Kafka Streams | Spark Structured Streaming |
|---|---|---|---|
| Deployment | cluster (JobManager + TaskManagers), K8s operator | a library inside your service | Spark cluster |
| Latency | ms | ms | ~100 ms–seconds (micro-batch) |
| State | RocksDB/heap, incremental checkpoints to S3 | RocksDB + changelog topics in Kafka | state store + checkpoints |
| Event time/watermarks | first-class, rich | supported (grace periods) | supported |
| Sources/sinks | many connectors | Kafka in, Kafka out | many |
| Sweet spot | complex, large-state, multi-source jobs | Kafka-centric microservices | teams already on Spark |

**Stateful operations:** keyed aggregations (\`count by ad_id per minute\`), joins (stream-stream within a time bound, stream-table enrichment), deduplication (keep seen ids for a TTL), pattern detection (CEP). State is **partitioned by key** exactly like Kafka partitions, so parallelism = number of key groups/partitions.

**State size is the thing to estimate:** 10M active keys × 200 B = 2 GB — fine in RocksDB. Unbounded joins without time bounds or state TTL grow forever — the most common Flink production incident.

**Parallelism and backpressure:** Flink pipelines tasks via bounded network buffers; a slow sink fills buffers upstream, and backpressure propagates to the source, which simply reads Kafka slower (lag grows, nothing crashes). Look at the busiest/backpressured operator in the UI — the first backpressured-free operator downstream of backpressured ones is the bottleneck.

**Where Node fits:** for simple stateless transforms (filter, enrich via cache, route), a kafkajs consumer-producer is fine. As soon as you need windows, joins, large keyed state or exactly-once, use a stream processor instead of reimplementing checkpoints in your service.`,
      code: [
        {
          language: 'sql',
          title: 'Flink SQL: Kafka source with event time + deduplication + enrichment join',
          code: `CREATE TABLE clicks (
  click_id    STRING,
  ad_id       STRING,
  user_id     STRING,
  ip          STRING,
  event_time  TIMESTAMP(3),
  WATERMARK FOR event_time AS event_time - INTERVAL '10' SECOND   -- tolerate 10s disorder
) WITH (
  'connector' = 'kafka',
  'topic' = 'ad.clicks.v1',
  'properties.bootstrap.servers' = 'kafka-0:9092',
  'properties.group.id' = 'flink-click-agg',
  'scan.startup.mode' = 'group-offsets',
  'format' = 'json'
);

-- Drop duplicate click_ids (client retries), keeping the first occurrence.
-- State per click_id is bounded by table.exec.state.ttl (e.g., 1 h).
CREATE VIEW clicks_dedup AS
SELECT click_id, ad_id, user_id, ip, event_time FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY click_id ORDER BY event_time) AS rn
  FROM clicks
) WHERE rn = 1;`,
        },
      ],
      keyPoints: [
        'State is keyed and partitioned; estimate its size up front.',
        'Unbounded joins and dedup without TTL grow state forever.',
        'Backpressure slows the source (lag) rather than crashing.',
      ],
      source: 'Designing Data-Intensive Applications — Ch 11 Stream Processing',
    },
    {
      heading: 'Lambda vs Kappa architecture',
      body: `**Intuition:** Lambda runs two kitchens — a slow, meticulous one (batch) that is always right and a fast one (speed layer) that serves approximate dishes until the slow one catches up. Kappa runs one kitchen and, when the recipe changes, re-cooks from the recorded order log.

**Lambda:**
- Batch layer recomputes views from the immutable master dataset (e.g., nightly); speed layer processes the stream for recent data; the serving layer merges both.
- Pros: batch is the source of truth, easy to fix history, the speed layer can be approximate.
- Cons: **two codebases** implementing the same logic (drift → numbers disagree), two operational systems, merge logic in serving.

**Kappa:**
- Everything is a stream. Reprocessing = start a new version of the job from the beginning of the log (or from the lake), write to a new output table, switch readers when caught up, delete the old one.
- Pros: one codebase, one set of semantics.
- Cons: needs the full history replayable (long Kafka retention, tiered storage, or the lake as a bounded source); replaying months at speed needs capacity; streaming correctness (late data, exactly-once) is harder than batch.

| | Lambda | Kappa |
|---|---|---|
| Codebases | 2 (batch + stream) | 1 |
| Source of truth | batch outputs | the log |
| Reprocessing | rerun batch | replay stream into new output |
| Complexity | operational + logic duplication | streaming correctness |
| Good when | billing-grade numbers, heavy historical ML, legacy batch | freshness matters everywhere, logic evolves often |

**What Alex Xu's ad-click design does:** a streaming (kappa-style) aggregation for real-time numbers, plus an **end-of-day batch reconciliation** over the raw events that corrects the stream if they disagree — a pragmatic hybrid many companies run.

**Modern twist:** unified engines (Flink batch/stream mode, Spark Structured Streaming, Beam) let one codebase run in both modes, and lakehouse tables (Iceberg/Delta) act as both stream sink and batch source — narrowing the gap.`,
      diagram: `  LAMBDA
  events --> master dataset (lake) --> batch views (hours) ---.
        \\--> speed layer (stream) --> realtime views (sec) -+--> serving

  KAPPA
  events --> log (Kafka + tiered/lake) --> job v1 --> table_v1 <-- readers
                                     \\--> job v2 (replay from 0) --> table_v2
                                     when caught up: switch readers, drop v1`,
      keyPoints: [
        'Lambda = two codebases, batch is truth; Kappa = one codebase, replay the log.',
        'Kappa requires replayable history and capacity to reprocess.',
        'Hybrid: stream for freshness + batch reconciliation for correctness.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 6 (Lambda vs Kappa, reconciliation)',
    },
    {
      heading: 'Windowing: tumbling, hopping, sliding and session windows',
      body: `**Intuition:** an infinite stream can't be "counted" — you count within windows. The window type is the question you ask: "per minute?", "last 5 minutes, updated every minute?", "per user visit?"

| Window | Definition | Example | Output rate |
|---|---|---|---|
| **Tumbling** | fixed size, non-overlapping, aligned | clicks per ad per minute | 1 result per key per window |
| **Hopping** | fixed size, advance by a smaller hop → overlap | 5-min moving count, updated every 1 min | size/hop results per event (5×) |
| **Sliding** | window relative to each event or continuous (e.g., "last 10 min" at any instant) | "user made > 5 failed logins within 10 min" | per event |
| **Session** | per key, closes after an inactivity **gap** | user session ends after 30 min idle | 1 per session; variable length |
| **Global + trigger** | one window, custom firing | count every 1,000 events | custom |

**Details that bite:**
- **Alignment:** tumbling windows are aligned to the epoch (00:00, 00:01...) in UTC by default; daily windows in a local timezone need an offset.
- **Hopping cost:** each event belongs to size/hop windows — a 1-hour window with 1-minute hop puts every event into 60 windows (60× state and output). Use pre-aggregated tumbling "panes" then sum.
- **Session merging:** an out-of-order event can **merge** two sessions into one — sessions are only final after the watermark passes the gap.
- **Top-N per window** (Alex Xu's "top 100 most clicked ads in the last M minutes"): aggregate counts per ad per window, then a second keyed operator keeps a min-heap of size N per window.

**Alex Xu's ad-click system** uses 1-minute tumbling windows for per-ad click counts and a sliding window for top-N most-clicked ads, with watermarks to accept slightly late events.`,
      diagram: `  time --->   0    1    2    3    4    5    6   (minutes)
  tumbling    [----)[----)[----)[----)[----)[----)
  hopping     [--------------)                      size 3, hop 1
  (size3,hop1)     [--------------)
                        [--------------)
  session     user A: x  x x         x x      (gap = 1.5)
              [ session 1 ]          [ s2 ]`,
      code: [
        {
          language: 'sql',
          title: 'Flink SQL windowing TVFs: tumbling, hopping, session',
          code: `-- Tumbling: clicks per ad per minute
SELECT ad_id, window_start, window_end, COUNT(*) AS clicks
FROM TABLE(TUMBLE(TABLE clicks_dedup, DESCRIPTOR(event_time), INTERVAL '1' MINUTE))
GROUP BY ad_id, window_start, window_end;

-- Hopping: 5-minute window sliding every minute (each event lands in 5 windows)
SELECT ad_id, window_start, window_end, COUNT(*) AS clicks_5m
FROM TABLE(HOP(TABLE clicks_dedup, DESCRIPTOR(event_time),
               INTERVAL '1' MINUTE,      -- slide
               INTERVAL '5' MINUTE))     -- size
GROUP BY ad_id, window_start, window_end;

-- Session: per-user sessions closed after 30 minutes of inactivity (Flink 1.19+ TVF)
SELECT user_id, window_start, window_end, COUNT(*) AS events_in_session
FROM TABLE(SESSION(TABLE clicks_dedup PARTITION BY user_id,
                   DESCRIPTOR(event_time), INTERVAL '30' MINUTE))
GROUP BY user_id, window_start, window_end;`,
        },
      ],
      keyPoints: [
        'Tumbling = fixed buckets; hopping = overlapping fixed; sliding = relative to events; session = gap-based.',
        'Hopping multiplies state/output by size ÷ hop.',
        'Sessions can merge on late events; final only after the watermark passes.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 6 (aggregation windows)',
    },
    {
      heading: 'Event time vs processing time, watermarks and late data',
      body: `**Intuition:** a photo's timestamp is when it was *taken* (event time), not when it was *uploaded* (processing time). If your phone was offline for a day, uploads arrive late — you still want them in yesterday's album. A watermark is the system saying "I'm now fairly confident I've seen all photos taken before 10:00."

**Why event time:** with processing time, a consumer outage or replay dumps hours of events into "now" → fake spikes and empty dips on dashboards, and reprocessing produces different results. Event time makes results **deterministic** regardless of when data is processed.

**Sources of lateness:** mobile clients offline (hours–days), batching SDKs (seconds–minutes), multi-region replication, consumer lag, clock skew on devices (sanity-check client timestamps; many pipelines use server receive time when client time is implausible).

**Watermarks:**
- A watermark with timestamp t asserts: "no more events with event time ≤ t are expected".
- Common strategy: **bounded out-of-orderness** — watermark = max event time seen − delay (e.g., 10 s).
- A window [12:00, 12:01) fires when the watermark passes 12:01.
- With parallel inputs, an operator's watermark is the **minimum** of its inputs' watermarks. One **idle Kafka partition** (no events) holds the minimum back and **stalls all windows** — configure idleness (\`WatermarkStrategy.withIdleness\`, \`table.exec.source.idle-timeout\`).

**The latency/completeness trade-off:** a bigger watermark delay = more complete results but later output. Alex Xu's design extends the window by a watermark (e.g., 15 s) and accepts that events later than that are dropped or corrected by reconciliation.

**Handling data that is later than the watermark:**
| Strategy | Effect |
|---|---|
| **Allowed lateness** | keep window state for extra time; late events trigger **updated results** (sink must upsert) |
| **Side output** | route late events to a separate stream/table for correction or audit |
| **Drop + count** | simplest; emit a metric so you know the loss rate |
| **Batch correction** | daily reconciliation recomputes from raw events |`,
      diagram: `  event time of arriving events (out of order)
  processing ->  12:00:58  12:01:03  12:00:40  12:01:09  12:00:30 (very late)
  max seen:      12:00:58  12:01:03  12:01:03  12:01:09  12:01:09
  watermark(-5s):12:00:53  12:00:58  12:00:58  12:01:04  12:01:04
                                                  ^ passes 12:01:00
                                   window [12:00,12:01) FIRES here
  12:00:40 was out of order, but its window had not fired yet -> counted
  12:00:30 arrives after firing -> late: lateness update / side output / drop`,
      code: [
        {
          language: 'java',
          title: 'Flink DataStream: watermarks with idleness, allowed lateness, late side output',
          code: `WatermarkStrategy<Click> wm = WatermarkStrategy
    .<Click>forBoundedOutOfOrderness(Duration.ofSeconds(10))  // tolerate 10s disorder
    .withTimestampAssigner((c, ts) -> c.eventTimeMillis())
    .withIdleness(Duration.ofMinutes(1));  // idle partitions don't stall the watermark

OutputTag<Click> late = new OutputTag<Click>("late-clicks") {};

SingleOutputStreamOperator<AdCount> counts = env
    .fromSource(kafkaSource, wm, "clicks")
    .keyBy(Click::adId)
    .window(TumblingEventTimeWindows.of(Duration.ofMinutes(1)))
    .allowedLateness(Duration.ofMinutes(5))   // re-fire with corrected counts for 5 more min
    .sideOutputLateData(late)                 // anything later goes here, not silently dropped
    .aggregate(new CountAgg(), new WindowResultFn());

counts.sinkTo(upsertSink);                    // upsert by (adId, windowStart): re-fires overwrite
counts.getSideOutput(late).sinkTo(lateClicksSink);  // for reconciliation + metrics`,
        },
      ],
      keyPoints: [
        'Event time gives deterministic, replay-safe results; processing time does not.',
        'Watermark = max event time − delay; operator watermark = min over inputs.',
        'Idle partitions stall watermarks; late data needs an explicit policy.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 6 (event time, watermark)',
    },
    {
      heading: 'Exactly-once in streaming: checkpoints, 2PC sinks and idempotent writes',
      body: `**Intuition:** a video game save point. Periodically the whole pipeline saves "where I was reading" and "what I had counted" together. After a crash you reload the save and replay from there — as if the crash never happened. The only trick is making sure what you *already told the outside world* is consistent with the save.

**Flink checkpointing (asynchronous barrier snapshots, a Chandy-Lamport variant):**
1. The JobManager injects **checkpoint barriers** into the sources every N seconds (e.g., 30–60 s).
2. Each operator, on receiving the barrier from all inputs (**aligned** checkpoint), snapshots its state (async, incrementally with RocksDB) to durable storage (S3) and forwards the barrier.
3. Sources snapshot their **Kafka offsets** as part of the checkpoint. (Committing offsets back to Kafka is only for monitoring; Flink restores from the checkpoint.)
4. On failure: restore all state and offsets from the last completed checkpoint, replay from those offsets → internal state is **exactly-once**.

**Unaligned checkpoints** let barriers overtake buffered data under backpressure (snapshotting in-flight buffers), keeping checkpoint times bounded when the job is backpressured.

**End-to-end requires the sink to cooperate:**
| Sink strategy | How | Trade-off |
|---|---|---|
| **Transactional (2PC)** | sink opens a transaction per checkpoint, pre-commits on barrier, commits when the checkpoint completes (Kafka sink with \`EXACTLY_ONCE\`, Iceberg/Delta commits) | output visible only after checkpoint → latency ≥ checkpoint interval; Kafka transaction timeout must exceed checkpoint interval + recovery |
| **Idempotent upsert** | write keyed results with deterministic keys (\`ad_id, window_start\`) → replays overwrite | needs keyed, deterministic results; sink must support upserts |
| At-least-once append | plain inserts | duplicates after recovery |

**Alex Xu's ad-click approach:** consume from Kafka, aggregate, and record the offset **together with the result** only after downstream acknowledges; on recovery, resume from the stored offset — the same "atomic progress + output" idea.

**What exactly-once does NOT fix:** duplicates *in the source data* (client retries producing two click events). Those need **business-level dedup** (click_id) in the pipeline.`,
      code: [
        {
          language: 'yaml',
          title: 'Flink config for exactly-once with RocksDB incremental checkpoints',
          code: `# flink-conf.yaml (Flink 1.x naming; 2.x uses the same keys under new prefixes)
execution.checkpointing.interval: 30s
execution.checkpointing.mode: EXACTLY_ONCE
execution.checkpointing.min-pause: 10s          # breathing room between checkpoints
execution.checkpointing.timeout: 10min
execution.checkpointing.unaligned.enabled: true # bounded checkpoint time under backpressure
execution.checkpointing.externalized-checkpoint-retention: RETAIN_ON_CANCELLATION

state.backend.type: rocksdb
state.backend.incremental: true                 # upload only changed SST files
state.checkpoints.dir: s3://flink-state/ad-click-agg/checkpoints
state.savepoints.dir: s3://flink-state/ad-click-agg/savepoints

restart-strategy.type: exponential-delay
restart-strategy.exponential-delay.initial-backoff: 1s
restart-strategy.exponential-delay.max-backoff: 2min

# Kafka EXACTLY_ONCE sink: transaction.timeout.ms must be > checkpoint interval + max restart
# time, and <= broker transaction.max.timeout.ms (default 15 min).`,
        },
      ],
      keyPoints: [
        'Checkpoints snapshot state + source offsets consistently via barriers.',
        'End-to-end exactly-once needs a transactional (2PC) or idempotent sink.',
        'Transactional sinks add latency ≥ checkpoint interval.',
        'Source-data duplicates still need business-level dedup.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 6 (exactly-once, recalculation)',
    },
    {
      heading: 'Change Data Capture with Debezium (and the outbox pattern)',
      body: `**Intuition:** instead of asking the database "what changed since yesterday?" (and missing things), you read its diary — the write-ahead log it already keeps for crash recovery and replication. Every committed insert, update and delete, in commit order.

**Log-based CDC mechanics:**
- **Postgres:** logical replication — a **replication slot** + the \`pgoutput\` plugin decode WAL into row changes; a **publication** selects tables. Requires \`wal_level=logical\`.
- **MySQL:** row-based **binlog** (\`binlog_format=ROW\`, \`binlog_row_image=FULL\`), read as a replica would.
- **Debezium** (Kafka Connect source connector) reads the log and emits one event per row change: \`{ before, after, op: c|u|d|r, source: { lsn, txId, ts_ms, table } }\` to a topic per table, keyed by primary key → per-row ordering.
- **Initial snapshot:** Debezium first snapshots existing rows (\`op: r\`), then streams from the log position; incremental snapshots (signal table) allow re-snapshotting tables without stopping streaming.

**Why CDC beats the alternatives:**
| Approach | Deletes | Missed changes | Load on DB | Ordering |
|---|---|---|---|---|
| Nightly full dump | via diff only | no, but slow | heavy | n/a |
| Query \`updated_at > last\` | **no** | yes (long txns, clock, missing triggers) | repeated scans | none |
| Dual write from app | if coded | yes (partial failures) | none | race-prone |
| **Log-based CDC** | yes (tombstones) | no | light (reads WAL) | commit order per key |

**The outbox pattern with CDC:** CDC of raw tables leaks your internal schema as a public contract. Instead, the service writes business rows **and** an \`outbox\` row (a clean domain event) in the **same transaction**; Debezium captures only the outbox table and its **Outbox Event Router** SMT routes each row to a topic by \`aggregatetype\`, keyed by \`aggregateid\`. You get atomic "state change + event", no dual writes, and a stable event contract.

**Operational gotchas:**
- **Replication slot WAL retention:** if the connector stops, Postgres keeps all WAL since the slot's position → disk fills and the primary can go down. Monitor slot lag (\`pg_replication_slots\`), set \`max_slot_wal_keep_size\` (PG13+), alert early.
- **Schema changes:** add columns safely; renames/type changes break consumers — use a schema registry and version events.
- **Failover:** logical slots historically didn't survive primary failover (PG17 adds failover slots); plan re-snapshot procedures.
- **Delivery is at-least-once:** consumers must dedupe (by LSN/event id) or upsert.
- **Large transactions** appear as bursts; toasted (large) unchanged columns may be absent in updates unless \`REPLICA IDENTITY FULL\`.`,
      code: [
        {
          language: 'json',
          title: 'Debezium Postgres connector: capture only the outbox table and route events',
          code: `{
  "name": "orders-outbox-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "plugin.name": "pgoutput",
    "database.hostname": "orders-db.internal",
    "database.port": "5432",
    "database.user": "debezium",
    "database.password": "\${file:/secrets/db.properties:password}",
    "database.dbname": "orders",
    "topic.prefix": "orders",
    "slot.name": "debezium_orders",
    "publication.name": "dbz_orders_outbox",
    "table.include.list": "public.outbox",
    "snapshot.mode": "no_data",
    "heartbeat.interval.ms": "10000",
    "transforms": "outbox",
    "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
    "transforms.outbox.table.field.event.key": "aggregateid",
    "transforms.outbox.route.by.field": "aggregatetype",
    "transforms.outbox.route.topic.replacement": "\${routedByValue}.events.v1",
    "transforms.outbox.table.expand.json.payload": "true",
    "key.converter": "org.apache.kafka.connect.storage.StringConverter",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "false"
  }
}`,
        },
        {
          language: 'sql',
          title: 'Outbox table + atomic write in the business transaction',
          code: `CREATE TABLE outbox (
  id            uuid PRIMARY KEY,           -- event id: consumers dedupe on it
  aggregatetype text NOT NULL,              -- 'order' -> topic order.events.v1
  aggregateid   text NOT NULL,              -- Kafka key: per-order ordering
  type          text NOT NULL,              -- 'OrderPlaced'
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

BEGIN;
INSERT INTO orders (id, customer_id, total_minor, status)
VALUES ('o-981', 'c-17', 459900, 'PLACED');
INSERT INTO outbox (id, aggregatetype, aggregateid, type, payload)
VALUES (gen_random_uuid(), 'order', 'o-981', 'OrderPlaced',
        '{"orderId":"o-981","customerId":"c-17","totalMinor":459900}');
COMMIT;  -- both or neither; Debezium publishes the outbox row from the WAL
-- Delete old outbox rows periodically (the WAL already carried them to Kafka).`,
        },
      ],
      keyPoints: [
        'Log-based CDC captures every committed change including deletes, in commit order.',
        'Outbox + CDC = atomic state change and event, with a stable event contract.',
        'Monitor replication slot lag; set max_slot_wal_keep_size.',
      ],
    },
    {
      heading: 'Storage: data lake vs warehouse vs lakehouse',
      body: `**Intuition:** a lake is a huge cheap garage — throw anything in. A warehouse is a tidy store with labelled shelves and a fast checkout. A lakehouse puts shelves, labels and a checkout inside the garage.

| | Data lake | Data warehouse | Lakehouse |
|---|---|---|---|
| Storage | object store (S3/GCS), open files | proprietary managed storage | object store + open **table format** (Iceberg, Delta, Hudi) |
| Data | raw, semi-structured, any format | structured, modeled | both |
| Schema | on read | on write | on write with evolution |
| Transactions | none (files) | ACID | ACID (snapshot isolation via metadata commits) |
| Engines | Spark, Presto/Trino, Athena | the warehouse engine | many (Spark, Trino, Flink, Snowflake, DuckDB) |
| Cost | cheapest (~$23/TB-month S3 standard) | higher, compute + storage | lake storage cost + chosen compute |
| Weakness | "data swamp", no updates/deletes, consistency | lock-in, cost at scale, ML on raw data awkward | operational maturity, compaction/maintenance |

**Why table formats matter:** Iceberg/Delta add a metadata layer (manifests, snapshots) over Parquet files, giving atomic commits, **time travel**, schema evolution, hidden partitioning, row-level updates/deletes (GDPR), and safe concurrent writers — which plain "folders of Parquet" lack.

**Layout rules of thumb:**
- **Columnar Parquet** with zstd/snappy: 5–10× smaller than JSON and scans read only needed columns.
- **Partition by low-cardinality time** (\`dt\`, maybe \`hour\`) plus clustering/sorting on common filters (\`ad_id\`, \`country\`). Never partition by \`user_id\`.
- **Target file size 256 MB–1 GB.** Streaming sinks commit every minute → many small files → schedule compaction (Iceberg \`rewrite_data_files\`) and snapshot expiry.

**Choosing:** early-stage/BI-heavy → managed warehouse (BigQuery/Snowflake). Multi-engine, ML, large raw volumes, cost sensitivity → lakehouse on Iceberg. Many companies land raw in the lakehouse and serve curated gold tables to a warehouse or OLAP engine.`,
      code: [
        {
          language: 'sql',
          title: 'Iceberg: partitioned table, MERGE upsert, compaction and time travel (Spark SQL)',
          code: `CREATE TABLE lake.silver.orders (
  order_id     string,
  customer_id  string,
  status       string,
  total_minor  bigint,
  updated_at   timestamp,
  op_lsn       bigint                      -- CDC position: newest wins
) USING iceberg
PARTITIONED BY (days(updated_at));         -- hidden partitioning, no dt column needed

-- Apply a CDC micro-batch idempotently (replays are harmless)
MERGE INTO lake.silver.orders t
USING staged_cdc s ON t.order_id = s.order_id
WHEN MATCHED AND s.op = 'd' AND s.op_lsn > t.op_lsn THEN DELETE
WHEN MATCHED AND s.op_lsn > t.op_lsn THEN UPDATE SET *
WHEN NOT MATCHED AND s.op <> 'd' THEN INSERT *;

-- Fix the small-files problem from frequent streaming commits
CALL lake.system.rewrite_data_files(table => 'silver.orders',
  options => map('target-file-size-bytes', '536870912'));

-- Time travel for debugging / reproducible reports
SELECT count(*) FROM lake.silver.orders TIMESTAMP AS OF '2026-09-27 00:00:00';`,
        },
      ],
      keyPoints: [
        'Lake = cheap raw files; warehouse = managed ACID SQL; lakehouse = open table format with ACID on the lake.',
        'Parquet + time partitioning + 256 MB–1 GB files.',
        'MERGE with a CDC position makes lake upserts idempotent and order-safe.',
      ],
    },
    {
      heading: 'Real-time dashboards: pre-aggregation and OLAP serving',
      body: `**Intuition:** don't count the stadium every time someone asks how many people are inside — keep a running tally at each gate, and add up the gates when asked.

**Architecture:** events → Kafka → stream job (dedupe, enrich, window-aggregate) → **OLAP store** → dashboard API with caching. Keep the raw stream flowing to the lake for reconciliation and ad-hoc analysis.

**OLAP stores for real-time:**
| | ClickHouse | Apache Druid | Apache Pinot |
|---|---|---|---|
| Ingestion | Kafka engine / inserts in batches | Kafka indexing service | real-time Kafka ingestion |
| Strength | fast SQL on raw + materialized views, simple ops | time-series rollups, high concurrency | user-facing analytics at very high QPS, upserts |
| Typical latency | sub-second queries on billions of rows | sub-second | ms–sub-second |

**Design choices:**
- **Pre-aggregate** at ingest (per-minute rollups by ad, country) — raw events at 1B/day vs ~3M rollup rows per day for 2M ads × a few dims (sparse).
- **Rollup hierarchy:** minute → hour → day tables; queries pick the coarsest granularity that answers.
- **Idempotent writes into the OLAP store:** with window re-fires and replays, use engines that collapse by key (ClickHouse \`ReplacingMergeTree\` with a version, Pinot upserts) — and remember such dedup is often **eventual** (merge-time), so query with \`FINAL\` or \`argMax\` for exact answers.
- **Batch inserts:** ClickHouse wants inserts in batches of thousands of rows every ~1 s, not one row per insert (too many parts → "Too many parts" errors).
- **Freshness indicator:** show "data as of 12:03:10" on the dashboard (the watermark) — users trust numbers they know are 20 s old more than numbers that silently lag 20 minutes.
- **Serving:** cache dashboard queries for 5–10 s; 1,000 viewers refreshing every 5 s is 200 QPS, cached to a handful.`,
      code: [
        {
          language: 'sql',
          title: 'ClickHouse: idempotent per-minute rollups with ReplacingMergeTree',
          code: `-- Stream job writes one row per (ad_id, minute) and may re-emit on late data / replay.
CREATE TABLE ad_clicks_1m
(
  ad_id        String,
  window_start DateTime,
  clicks       UInt64,
  version      UInt64            -- e.g., emit time in ms; highest wins
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMMDD(window_start)
ORDER BY (ad_id, window_start)
TTL window_start + INTERVAL 90 DAY;

-- Dedup happens at background merge time, so query with argMax for exact results:
SELECT ad_id,
       toStartOfHour(window_start) AS hour,
       sum(c) AS clicks
FROM (
  SELECT ad_id, window_start, argMax(clicks, version) AS c
  FROM ad_clicks_1m
  WHERE window_start >= now() - INTERVAL 6 HOUR
  GROUP BY ad_id, window_start
)
GROUP BY ad_id, hour
ORDER BY hour, clicks DESC;`,
        },
      ],
      keyPoints: [
        'Pre-aggregate in the stream; serve from an OLAP store; keep raw for reconciliation.',
        'OLAP dedup (ReplacingMergeTree) is eventual — use FINAL/argMax for exactness.',
        'Show data freshness on dashboards; cache queries for seconds.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 6 (aggregation, query service)',
    },
    {
      heading: 'Reconciliation, data quality and the pipeline scenario playbook',
      body: `**Intuition:** streaming gives you fast numbers; reconciliation tells you whether they were right. Like a shop counting the till at the end of the day against the receipts.

**Reconciliation (Alex Xu Ch 6):** an end-of-day batch job recomputes aggregates from **raw events** in the lake and compares them with the streaming results — per key and window. Differences come from late data beyond the watermark, duplicates, dropped poison messages or bugs. The batch result is authoritative; corrections are written back (overwrite the day's partition) and discrepancies above a threshold (e.g., > 0.1%) alert.

**Data quality checks (per run or per partition):** row counts vs source (CDC: source table count vs lake), null rates, uniqueness of keys, referential integrity, freshness (max event time vs now), distribution drift. Tools: dbt tests, Great Expectations, Soda. **Data contracts** between producing teams and the platform (schema + semantics + SLOs) prevent silent breakage.

**Scenario playbook:**
| Scenario | Symptoms | Root cause | Fix |
|---|---|---|---|
| **DB changes need to reach analytics** | nightly dumps too slow, deletes missing | polling/dumps | Debezium CDC → Kafka → lakehouse MERGE by PK with LSN ordering; outbox for domain events |
| **Process millions of events** | single consumer can't keep up | no parallelism | partitioned topic, stream processor with keyed parallelism; batch for historical |
| **Real-time dashboard** | queries on raw data too slow | aggregation at query time | stream pre-aggregation → OLAP (ClickHouse/Pinot), rollups, cache, freshness label |
| **Pipeline delayed** | gold tables late, SLA missed | upstream late, skew, small files, resource contention, stalled watermark | completeness sensors, skew handling, compaction, dedicated pools, idleness config, freshness alerts |
| **Consumer/stream job can't keep up** | lag grows, backpressure in Flink UI | slow sink, skewed key, big state, checkpoint pressure | scale parallelism ≤ partitions, batch sink writes, salt/pre-aggregate hot keys, incremental + unaligned checkpoints |
| **Duplicate events** | counts slightly high | client retries, at-least-once sinks, replays | dedup by event id with TTL state, idempotent/upsert sinks, transactional sinks, reconciliation |`,
      code: [
        {
          language: 'sql',
          title: 'Daily reconciliation: streaming vs batch recompute (Trino/Spark SQL)',
          code: `WITH batch AS (                       -- authoritative: recomputed from raw events
  SELECT ad_id, date_trunc('minute', event_time) AS minute, count(*) AS clicks
  FROM lake.silver.ad_clicks
  WHERE dt = DATE '2026-09-27' AND NOT is_duplicate
  GROUP BY 1, 2
),
stream AS (                           -- what the real-time pipeline produced
  SELECT ad_id, window_start AS minute, clicks
  FROM lake.gold.ad_clicks_1m_stream
  WHERE date(window_start) = DATE '2026-09-27'
)
SELECT
  coalesce(b.ad_id, s.ad_id)   AS ad_id,
  coalesce(b.minute, s.minute) AS minute,
  b.clicks AS batch_clicks,
  s.clicks AS stream_clicks,
  coalesce(b.clicks, 0) - coalesce(s.clicks, 0) AS diff
FROM batch b
FULL OUTER JOIN stream s ON b.ad_id = s.ad_id AND b.minute = s.minute
WHERE coalesce(b.clicks, 0) <> coalesce(s.clicks, 0)
ORDER BY abs(coalesce(b.clicks, 0) - coalesce(s.clicks, 0)) DESC
LIMIT 1000;
-- Alert if sum(abs(diff)) / sum(batch_clicks) > 0.001; then overwrite the day with batch.`,
        },
      ],
      keyPoints: [
        'Batch recompute from raw events is the source of truth; stream is the fast estimate.',
        'Data quality: counts, uniqueness, nulls, freshness, contracts.',
        'Map each pipeline incident to its root cause before scaling anything.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 6 (reconciliation)',
    },
  ],
  codeChallenges: [
    {
      id: 'data-pipelines-cc-1',
      title: 'Turn a naive click counter into a correct event-time window aggregator',
      context: `A Node service consumes \`ad.clicks.v1\` (one consumer per partition) and writes per-ad, per-minute click counts to ClickHouse for an advertiser dashboard that is also used for billing estimates. Problems: after a 20-minute consumer outage the dashboard showed a **huge spike** followed by a gap; counts are **lost** when pods restart; replays **inflate** numbers; and SDK retries double-count clicks.`,
      task: 'Rewrite the aggregator so windows use event time with a watermark, results are idempotent under restarts and replays, duplicate click_ids are dropped, late clicks are kept for reconciliation, and offsets are committed only when it is safe.',
      starter: {
        language: 'typescript',
        title: 'click-aggregator.ts (buggy)',
        code: `const counts = new Map<string, number>();       // "adId|minute" -> count

await consumer.run({                             // autoCommit: true (default)
  eachMessage: async ({ message }) => {
    const click = JSON.parse(message.value!.toString());
    const minute = Math.floor(Date.now() / 60_000) * 60_000;   // processing time
    const key = click.adId + '|' + minute;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  },
});

setInterval(async () => {
  for (const [key, n] of counts) {
    const [adId, minute] = key.split('|');
    await clickhouse.insert({                    // one insert per row, appended
      table: 'ad_clicks_1m',
      values: [{ ad_id: adId, window_start: Number(minute) / 1000, clicks: n }],
      format: 'JSONEachRow',
    });
  }
  counts.clear();
}, 60_000);`,
      },
      hints: [
        'Which timestamp decides the window, and what happens to that choice when the consumer lags or replays?',
        'Offsets are auto-committed while the counts sit only in memory. When is it actually safe to move the offset forward?',
        'If a window can be emitted more than once (restart, replay), what kind of write makes the second emit harmless? Also, how do you know a window is complete?',
      ],
      solution: {
        language: 'typescript',
        title: 'click-aggregator.ts (fixed, per-partition state)',
        code: `const WIN = 60_000, DELAY = 10_000;             // 1-min tumbling windows, 10s disorder
type Win = { start: number; firstOffset: bigint; counts: Map<string, number>; seen: Set<string> };
const state = new Map<number, { wins: Map<number, Win>; maxTs: number; emittedWm: number }>();

await consumer.run({
  autoCommit: false, eachBatchAutoResolve: false,
  eachBatch: async ({ batch, heartbeat }) => {
    const p = batch.partition;
    const s = state.get(p) ?? { wins: new Map(), maxTs: 0, emittedWm: await progress.load(p) };
    state.set(p, s);
    const late: Click[] = [];

    for (const m of batch.messages) {
      const c: Click = JSON.parse(m.value!.toString());
      const start = Math.floor(c.eventTime / WIN) * WIN;      // EVENT time decides the window
      if (start + WIN <= s.emittedWm) { late.push(c); continue; } // window already emitted
      s.maxTs = Math.max(s.maxTs, c.eventTime);
      let w = s.wins.get(start);
      if (!w) s.wins.set(start, (w = { start, firstOffset: BigInt(m.offset), counts: new Map(), seen: new Set() }));
      if (w.seen.has(c.clickId)) continue;                     // SDK retry duplicate
      w.seen.add(c.clickId);
      w.counts.set(c.adId, (w.counts.get(c.adId) ?? 0) + 1);
    }

    const wm = s.maxTs - DELAY;                                 // watermark
    const closed = [...s.wins.values()].filter((w) => w.start + WIN <= wm);
    if (closed.length) {
      // Full per-(ad, window, partition) counts; ReplacingMergeTree(version) ORDER BY
      // (ad_id, window_start, partition) makes re-emits overwrite instead of adding.
      await clickhouse.insert({ table: 'ad_clicks_1m_part', format: 'JSONEachRow',
        values: closed.flatMap((w) => [...w.counts].map(([ad, n]) => ({
          ad_id: ad, window_start: w.start / 1000, partition: p, clicks: n, version: Date.now() }))) });
      closed.forEach((w) => s.wins.delete(w.start));
      s.emittedWm = Math.max(s.emittedWm, ...closed.map((w) => w.start + WIN));
      await progress.save(p, s.emittedWm);                     // persisted before commit
    }
    if (late.length) await lateClicks.insert(late);             // kept for reconciliation

    // Safe commit: never past the first offset of any still-open window,
    // so a restart replays every open window completely.
    const open = [...s.wins.values()].map((w) => w.firstOffset);
    const next = BigInt(batch.lastOffset()) + 1n;
    const safe = open.length ? open.reduce((a, b) => (a < b ? a : b)) : next;
    await consumer.commitOffsets([{ topic: batch.topic, partition: p, offset: safe.toString() }]);
    await heartbeat();
  },
});`,
      },
      explanation: `**Fixes**
- **Fake spikes after lag:** the window came from \`Date.now()\` (processing time), so a 20-minute outage dumped all of its clicks into the current minute and left a gap behind. Windows now come from the click's **event time**, so results don't depend on when they are processed.
- **Completeness:** a window is emitted only when the **watermark** (max event time − 10 s) passes its end, not on an arbitrary timer that flushes half-full windows.
- **Loss on restart:** auto-commit advanced offsets while counts lived only in memory. Offsets are now committed manually, and never past the **first offset of any open window**, so a restart replays and rebuilds every open window in full.
- **Inflation on replay:** appending partial counts meant each re-emit added rows. Each emit now writes the **full** count per (ad, window, partition) into a \`ReplacingMergeTree(version)\` keyed on those columns, so a re-emit replaces the old row. Dashboards sum over partitions using \`argMax\`/\`FINAL\`.
- **Already-emitted windows on replay:** the emitted watermark is persisted per partition before committing. Replayed events for windows at or behind it are treated as already handled.
- **SDK duplicates:** \`click_id\` is deduplicated within its window (bounded state, freed when the window closes).
- **Late data:** clicks for windows that have already been emitted go to a late table rather than being silently dropped. Daily reconciliation folds them in.
- **Efficiency:** one batched insert per flush instead of one insert per row (ClickHouse wants batches).
- **Remaining caveat:** an idle partition stops advancing its own watermark. Add an idle timeout that advances the watermark by wall clock after N minutes without events. This hand-rolled state is also why real deployments use Flink for this job.`,
      followUps: [
        {
          "q": "The ops team runs 3 pods, and a rebalance moves partition 4 from pod A to pod B mid-window. Is your solution still correct?",
          "a": "Yes, because nothing important lives only in memory. Pod A committed offsets no further than the first offset of any open window, and the emitted watermark is persisted per partition. Pod B starts with empty state, loads emittedWm for partition 4, replays from the safe offset, rebuilds open windows fully and skips windows already emitted. Any window A emitted that B re-emits is overwritten through ReplacingMergeTree. Add an `onPartitionsRevoked` hook that drops A's state for partition 4, so A doesn't emit stale windows after losing ownership."
        },
        {
          "q": "How would you test this aggregator before trusting it for billing estimates?",
          "a": "Use a deterministic replay harness. Generate a click stream with known per-ad, per-minute ground truth, including out-of-order events within 10 s, duplicate click_ids, late clicks beyond the watermark, and an idle partition. Run it through the consumer against a test Kafka and ClickHouse, injecting kills at random points (between insert and commit, mid-batch). Then assert three things: argMax-deduplicated totals equal ground truth minus late events; the late table holds exactly the late events; and repeated runs give identical results. Property-based tests over random kill points catch most offset-ordering bugs."
        }
      ],
    },
    {
      id: 'data-pipelines-cc-2',
      title: 'Fix the hourly incremental extract that silently loses rows',
      context: `Before CDC is approved, analytics relies on an hourly job that copies changed \`orders\` rows from Postgres into the warehouse. Finance found orders **missing** from reports, **cancelled orders still showing** as active, and **duplicate rows** after a job retry. The orders table has 400M rows and ~2K updates/s at peak.`,
      task: 'Rewrite the extract so it cannot skip committed changes, propagates deletes, is idempotent on retry, and doesn\'t hammer the primary. Then explain why log-based CDC is still the better end state.',
      starter: {
        language: 'typescript',
        title: 'sync-orders.job.ts (buggy)',
        code: `export async function syncOrders() {
  const last = await state.get('orders_last_sync');        // ISO string, app clock

  const { rows } = await primary.query(
    'SELECT * FROM orders WHERE updated_at > $1 ORDER BY updated_at LIMIT 50000',
    [last],
  );

  for (const r of rows) {
    await warehouse.query(
      'INSERT INTO analytics.orders VALUES ($1, $2, $3, $4, $5)',
      [r.id, r.customer_id, r.status, r.total_minor, r.updated_at],
    );
  }

  await state.set('orders_last_sync', new Date().toISOString());
}`,
      },
      hints: [
        'If more than 50,000 rows changed, which ones are skipped when you store now() as the cursor? And what about two rows with the same updated_at at the page boundary?',
        'A transaction that started at 10:59:58 and commits at 11:00:05 writes updated_at = 10:59:58. Your 11:00 run did not see it. Will the next run?',
        'Deletes leave no row to select. And what makes a retry of the load step harmless?',
      ],
      solution: {
        language: 'typescript',
        title: 'sync-orders.job.ts (fixed)',
        code: `// Prereqs (migration): trigger keeps updated_at = clock_timestamp() on every write;
// index on (updated_at, id); deletes are soft (deleted_at) or captured by a trigger into
// orders_tombstones(id, deleted_at) with the same (deleted_at, id) index.
const SAFETY_LAG = "interval '10 minutes'";   // let in-flight transactions commit
const PAGE = 5_000;

export async function syncOrders() {
  let cur = await state.get('orders_cursor') ?? { ts: '1970-01-01T00:00:00Z', id: '' };
  // Upper bound from the DB clock, not the app clock
  const { rows: [{ upper }] } = await replica.query(
    'SELECT now() - ' + SAFETY_LAG + ' AS upper');

  for (;;) {
    const { rows } = await replica.query(                  // read replica, not the primary
      'SELECT id, customer_id, status, total_minor, updated_at, deleted_at FROM orders ' +
        'WHERE (updated_at, id) > ($1, $2) AND updated_at <= $3 ' +   // keyset: no ties lost
        'ORDER BY updated_at, id LIMIT ' + PAGE,
      [cur.ts, cur.id, upper]);
    if (rows.length === 0) break;

    await warehouse.stageAndMerge('analytics.orders', rows, {
      key: ['id'],
      // MERGE: update only if incoming updated_at is newer; deleted_at -> is_deleted = true
      whenMatched: 'source.updated_at > target.updated_at',
    });                                                    // idempotent: a retry re-merges

    const last = rows[rows.length - 1];
    cur = { ts: last.updated_at.toISOString(), id: last.id };
    await state.set('orders_cursor', cur);                 // advance only after a durable load
    if (rows.length < PAGE) break;
  }
  // Same loop for orders_tombstones -> MERGE ... WHEN MATCHED THEN UPDATE SET is_deleted = true.
  // Nightly: compare counts/checksums per day partition between source and warehouse.
}`,
      },
      explanation: `**Bugs**
- **Cursor = app \`now()\`:** with \`LIMIT 50000\`, every row past the first page is skipped forever. Clock skew between the app and the DB loses or duplicates rows too.
- **Commit order ≠ timestamp order:** a transaction that commits after the run but carries an earlier \`updated_at\` falls behind the cursor and is never picked up. Hence the **safety lag** (only extract up to DB \`now() − 10 min\`), plus nightly count reconciliation for anything longer.
- **Ties at page boundaries:** \`updated_at > $1\` drops rows that share the boundary timestamp. A **keyset cursor on (updated_at, id)** fixes it.
- **Deletes invisible:** a deleted row can't be selected. Use soft deletes or a tombstone table fed by a trigger, and merge them as \`is_deleted\`.
- **Duplicates on retry:** row-by-row \`INSERT\` appended again. Now it's a staged **MERGE** keyed by id that only applies newer versions, so retries are idempotent. The cursor advances only after the load is durable.
- **Load on the primary and speed:** reads now come from a replica in 5K-row indexed pages; bulk MERGE replaces 50K single inserts.
- **\`updated_at\` reliability:** only a trigger guarantees every writer (including ad-hoc scripts) bumps it.

**Why CDC is still better:** Debezium reads the WAL in **commit order**, sees every change including deletes, has no safety-lag trade-off, puts almost no query load on the DB, and delivers in seconds instead of hourly. The polling approach remains a reasonable stopgap only with all of the guards above.`,
      followUps: [
        {
          "q": "The read replica lags 20 minutes during heavy batch loads. Does your 10-minute safety lag still hold?",
          "a": "No. The upper bound is computed as `now() - 10 min` on the replica, but `now()` on a hot standby is the replica's wall clock, not how far it has replayed. Rows committed on the primary in the last 20 minutes aren't on the replica yet and fall behind the cursor. Use `pg_last_xact_replay_timestamp() - interval '10 minutes'` as the upper bound, so the cursor never passes data the replica hasn't applied. Also alert when replica lag exceeds a threshold and skip the run instead of advancing."
        },
        {
          "q": "Finance asks you to prove no orders are missing in the warehouse. What reconciliation would you build?",
          "a": "Run a nightly per-day comparison. For each created_at day, compute on the replica and in the warehouse: row count, sum(total_minor), count by status, and a hash aggregate such as `sum(hashtext(id || status || updated_at))`. Mismatched days trigger a targeted re-extract of that day's ids with MERGE. Days are small enough (about 1M rows) to compare cheaply. Store the results as a reconciliation table that finance can query, so 'complete' becomes a visible check rather than an assumption."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'data-pipelines-iq-01',
      difficulty: 'expert',
      question:
        'Design a real-time ad click aggregation system: 1B clicks/day, advertisers see per-ad click counts per minute with <1 min freshness, and the same numbers drive billing. Walk me through ingestion, aggregation, storage, correctness and reconciliation.',
      context: 'Classic Alex Xu Vol 2 Ch 6 prompt, asked at ad-tech and marketplace companies.',
      whatInterviewerLooksFor: [
        'Back-of-envelope throughput and state sizing',
        'Event-time windows with watermarks and a late-data policy',
        'Exactly-once or idempotent path from Kafka to storage',
        'Dedup of client retries and bot filtering',
        'Reconciliation against raw data for billing-grade correctness',
      ],
      modelAnswer: `### Numbers
1B/day ≈ 11.6K clicks/s on average, ~50K/s at peak (5×). At ~200 B per event that's 10 MB/s at peak: easy for Kafka. Ads: ~2M active.

### Ingestion
Click servers log to Kafka (\`ad.clicks.v1\`, 64 partitions, key = ad_id, RF=3, acks=all). Raw events are also sunk to the lake (S3/Iceberg) for reconciliation, reprocessing and audits.

### Aggregation (Flink)
- **Event-time** 1-minute tumbling windows keyed by ad_id; watermark = max event time − 15 s, with 5 minutes of allowed lateness (windows re-fire with corrected counts). Anything later goes to a side output.
- **Dedup** on click_id with keyed state and a 1-hour TTL; bot/fraud filtering upstream or as an enrichment step.
- **Top-N most-clicked** ads per minute: a second operator keeps a per-window min-heap.
- **Hot ads:** key by (ad_id, salt), pre-aggregate, then merge by ad_id in a second stage.

### Exactly-once
Checkpoints every 30 s (RocksDB, incremental). The sink either uses Kafka transactions (to \`ad.clicks.agg.v1\`) or does **idempotent upserts** keyed by (ad_id, window_start) into the OLAP store, so re-fires and recovery replays overwrite rather than add.

### Storage and query
- ClickHouse or Pinot with per-minute rollups (\`ReplacingMergeTree\`), plus hourly and daily rollups.
- The query API caches for 5–10 s and shows a "data as of" watermark.

### Reconciliation (billing)
- A nightly batch recomputes from raw events in the lake, with the same dedup and bot rules and no lateness cutoff (the day is closed by T+1), and compares per (ad, minute).
- If the difference exceeds 0.1%, alert and overwrite with the batch numbers. **Billing uses the reconciled batch numbers**; the real-time view is labelled an estimate.

### Failure modes
- A Flink job failure restores from the checkpoint; Kafka retention of ≥ 3 days covers outages.
- A stalled watermark from an idle partition is handled by idleness config.
- A duplicate spike from an SDK bug is handled by dedup state, and reconciliation catches whatever gets past it.`,
      followUps: [
        {
          q: 'Why not just UPDATE a counter row per ad in Postgres for every click?',
          a: 'At 50K/s with hot ads, per-row updates serialize on row locks and WAL; a few hundred to a few thousand updates per second per row is the ceiling. Pre-aggregating in memory per window and writing one row per ad-minute reduces writes by orders of magnitude.',
        },
        {
          q: 'How do you choose the watermark delay?',
          a: 'Measure the event-time lag distribution (arrival time minus event time). Pick the p99–p99.9 for the watermark delay and cover the tail with allowed lateness plus reconciliation. It is a freshness vs completeness trade-off.',
        },
        {
          q: 'An advertiser disputes the bill. What can you show?',
          a: 'Raw click events from the lake (immutable, time-travel via Iceberg snapshots), the dedup/bot rules applied, and the reconciled aggregates, all reproducible for that day.',
        },
      ],
      pitfalls: [
        'Processing-time windows',
        'Billing directly from the real-time stream with no reconciliation',
        'Ignoring duplicate clicks and hot ads',
      ],
    },
    {
      id: 'data-pipelines-iq-02',
      difficulty: 'hard',
      question:
        'Lambda or Kappa? Your team has a nightly Spark pipeline and a separate Flink job for real-time, and the two produce different numbers. Management asks you to "fix the architecture".',
      whatInterviewerLooksFor: [
        'Diagnoses why the numbers diverge (logic drift, late data, dedup differences)',
        'Clear trade-offs between the two architectures',
        'A migration path, not a big bang',
        'Knows the prerequisites for kappa (replayable history, reprocessing capacity)',
      ],
      modelAnswer: `### Why the numbers differ
Two codebases drift: different dedup rules, timezone handling, bot filters, and join semantics. Beyond that, the streaming job applies a lateness cutoff while batch sees the complete day, so the stream is always a little low. Some of the gap is **expected** (late data); some is **bugs** (logic drift).

### Options
- **Keep lambda but share logic:** move the business logic into shared SQL/UDF libraries, or into one engine that runs in both modes (Flink batch + streaming, Spark Structured Streaming, Beam). Batch remains the truth and the stream the fast estimate. The divergence drops to late data only, which reconciliation explains.
- **Move to kappa:** a single Flink job; history replays from Kafka tiered storage or from lake tables used as a bounded source. Reprocessing means running v2 from the start into a new table, validating, and switching readers.
  - Prerequisites: replayable history (retention covering the reprocessing horizon, or lake replay), capacity to reprocess months quickly (e.g., 90 days × 1B/day = 90B events at 1M/s ≈ 25 hours), and streaming-correctness maturity (watermarks, exactly-once sinks).

### My recommendation
A **kappa-style core with batch reconciliation**. One streaming codebase produces the real-time and the provisional daily numbers. A lightweight batch job (the same SQL on lake data) recomputes closed days and corrects them. Billing and finance read reconciled tables; dashboards read real-time ones.

### Migration
1. Define the metric contract (dedup keys, timezone, bot rules) as tests.
2. Port the logic to the shared engine and run it in shadow, comparing against the Spark output per day.
3. Switch readers per metric; decommission the old Spark jobs.
4. Keep reconciliation alerts (difference > 0.1%).`,
      followUps: [
        {
          q: 'When is lambda still the right answer?',
          a: 'When the batch side does heavy work streaming can\'t do cheaply (complex multi-TB joins, ML feature backfills), when regulators require batch-verified numbers, or when the team lacks streaming expertise.',
        },
        {
          q: 'How do you reprocess in kappa without disturbing live readers?',
          a: 'Run the new job version from the beginning into a new output table, let it catch up, validate the metrics, then atomically switch a view or alias and drain the old job.',
        },
      ],
      pitfalls: [
        'Assuming all divergence is a bug (late data is expected)',
        'Proposing kappa without replayable history',
        'A big-bang rewrite',
      ],
    },
    {
      id: 'data-pipelines-iq-03',
      difficulty: 'hard',
      question:
        'We need changes in our main Postgres (orders, customers, payments) to reach the warehouse, Elasticsearch and a fraud service within seconds. Today it is a nightly dump. Design it and tell me what will break in production.',
      whatInterviewerLooksFor: [
        'Log-based CDC with Debezium and snapshot semantics',
        'Outbox for domain events vs raw table CDC',
        'Consumer idempotency and ordering by primary key',
        'Operational risks: replication slot WAL growth, schema changes, failover, large transactions',
        'Per-sink semantics (upsert/MERGE, deletes)',
      ],
      modelAnswer: `### Architecture
- Postgres (\`wal_level=logical\`) → **Debezium** Postgres connector (pgoutput, one replication slot) on Kafka Connect → topics per table (\`pg.public.orders\`), keyed by primary key → sinks.
- **Initial snapshot** of existing rows, then streaming from the slot's LSN. Incremental snapshots allow re-bootstrapping a table later without downtime.
- For the **fraud service**, publish **domain events via an outbox** (\`PaymentAuthorized\` with the fields fraud needs), so it doesn't couple to table schemas.

### Sinks
- **Warehouse/lakehouse:** micro-batches (1–5 min) MERGE by PK, applying only when the incoming LSN is newer. Deletes become tombstones or \`is_deleted\`. Iceberg or Snowflake via a connector.
- **Elasticsearch:** Kafka Connect ES sink with document id = PK and external versioning (LSN), so replays and reorders never regress documents. Deletes map to document deletes.
- **Fraud:** a Kafka consumer, idempotent by event id.

### Expected latency
The connector adds sub-second to a few seconds; the ES refresh interval is 1 s; the warehouse runs on minutes-level micro-batches.

### What breaks in production
1. **WAL bloat:** if Debezium stops (a connector bug, Kafka down), the slot pins WAL and the primary's disk fills. Monitor \`pg_replication_slots\` lag, set \`max_slot_wal_keep_size\`, and alert at a few GB.
2. **Primary failover:** logical slots may not exist on the new primary (PG17 failover slots help). The runbook covers recreating the slot and re-snapshotting affected tables.
3. **Schema changes:** a column rename breaks downstream. Use a schema registry with compatibility checks and additive-only migrations.
4. **Big transactions:** a backfill updating 50M rows floods the topics. Throttle backfills and batch them in chunks.
5. **TOAST columns:** unchanged large columns are missing from update events unless \`REPLICA IDENTITY FULL\` is set, or the sink handles "unavailable value" placeholders.
6. **Duplicates** after connector restarts (at-least-once) are why every sink must be idempotent.
7. **PII:** raw table CDC ships every column. Apply column filters/masking in the connector (\`column.exclude.list\`).`,
      followUps: [
        {
          q: 'Why not have the application publish to Kafka after each write?',
          a: 'That is a dual write: a crash between the DB commit and the publish loses events, and publishing before commit emits events for rolled-back data. CDC and the outbox derive events from the committed log.',
        },
        {
          q: 'How are per-row changes ordered?',
          a: 'Debezium keys messages by primary key, so all changes to a row go to the same partition in commit order. Across rows or tables there is no global order; consumers needing transaction boundaries can use Debezium\'s transaction metadata topic.',
        },
      ],
      pitfalls: [
        'Polling updated_at and calling it CDC',
        'Ignoring replication slot WAL retention',
        'Non-idempotent sinks (plain INSERTs)',
      ],
    },
    {
      id: 'data-pipelines-iq-04',
      difficulty: 'expert',
      question:
        'Our mobile app batches analytics events and sends them when it has connectivity. Some events arrive 2 days late. The product team wants hourly active-user counts that are "correct" and available within 5 minutes. How do you reconcile those requirements?',
      whatInterviewerLooksFor: [
        'Separates the provisional and final result concepts',
        'Uses event time with watermarks and allowed lateness sized from data',
        'Upsert-capable sinks and restatement',
        'Guards against clock skew in client timestamps',
        'Communicates freshness and completeness to users',
      ],
      modelAnswer: `### Reframe the requirement
"Correct within 5 minutes" and "includes events 2 days late" can't both hold. Offer **provisional** hourly numbers within 5 minutes, which are then **restated** as late data arrives and **finalized** after 48–72 hours.

### Measure lateness first
The distribution of arrival time minus event time might be: p50 3 s, p95 2 min, p99 20 min, p99.9 30 h. That drives the parameters.

### Streaming layer
- Event-time 1-hour tumbling windows. Watermark = max event time − 2 min, so the first result lands about 2–5 minutes after the hour.
- **Allowed lateness of 3 hours** re-fires windows with updated distinct counts (HyperLogLog sketches are mergeable, so updates are cheap). The sink **upserts** by (hour).
- Events later than 3 hours go to a side output/table.

### Batch finalization
- A daily job over the lake recomputes the last 3 days of hours from all events, including very late ones, and overwrites those partitions. After T+3 days the hour is marked **final**.

### Clock skew
Client clocks can be wrong by hours or years. Take a server receive timestamp; if the client event time is in the future or older than the app install, clamp it or use receive time, and track the rate of adjustments.

### Presenting it
The dashboard shows a "provisional" badge for hours younger than 72 h, a completeness estimate (percentage of expected late volume already arrived, from historical curves), and a "last restated" time.

### Why not just wait?
A 48-hour watermark makes the dashboard useless for operations. A 5-minute watermark with no restatement undercounts permanently by the late share (maybe 3–5%). Provisional-then-final gives both.`,
      followUps: [
        {
          q: 'Why HyperLogLog for active users?',
          a: 'Exact distinct counts require keeping every user id per window. HLL uses ~12 KB per sketch with ~0.8% error, and sketches merge across partitions and late updates, which makes re-firing and roll-ups cheap.',
        },
        {
          q: 'What does allowed lateness cost?',
          a: 'Window state must be kept for the lateness period (3 hours of hourly windows per key), and downstream receives multiple versions of each result, so the sink must upsert and consumers must tolerate restatements.',
        },
      ],
      pitfalls: [
        'Processing-time windows',
        'Setting a 2-day watermark',
        'Trusting client timestamps blindly',
      ],
    },
    {
      id: 'data-pipelines-iq-05',
      difficulty: 'expert',
      question:
        'The revenue dashboard fed by Kafka → Flink → warehouse sometimes shows totals ~2% too high right after incidents. The team says the job is configured for exactly-once. Where do duplicates come from, and how do you make the pipeline truly exactly-once end to end?',
      whatInterviewerLooksFor: [
        'Knows the scope of Flink exactly-once (state + offsets)',
        'Identifies sink-side and source-side duplicate paths',
        'Proposes 2PC or idempotent sinks with deterministic keys',
        'Mentions producer-side duplicates and business-key dedup',
        'Validates via reconciliation',
      ],
      modelAnswer: `### What "exactly-once" in Flink guarantees
State and source offsets are restored consistently from checkpoints, so the **internal** computation is exactly-once. Anything written to the outside world between the last checkpoint and the failure is **replayed** after recovery.

### Likely duplicate paths
1. **At-least-once sink:** a JDBC/warehouse sink doing plain INSERTs. After recovery, results emitted since the last checkpoint are inserted again. With a 60 s checkpoint interval and an incident, that easily explains a 2% spike in that window.
2. **Source duplicates:** upstream producers without idempotence, or the app re-publishing on timeouts, create the same order event twice with different offsets. Flink EOS can't know they're the same.
3. **Manual restarts from an older savepoint** or offset resets replay already-emitted windows.
4. **Allowed-lateness re-fires** appended as new rows instead of updates.

### Fixes
- **Sink:** use a **transactional sink** that commits on checkpoint completion (Kafka EXACTLY_ONCE sink, Iceberg/Delta sink committing per checkpoint), or an **idempotent upsert/MERGE** keyed by deterministic ids (\`order_id\` for facts, \`(metric, window_start)\` for aggregates).
- **Source:** dedupe on business keys (order_id / event_id) with keyed state and a TTL covering the redelivery horizon. Make producers idempotent and use the outbox.
- **Re-fires:** the sink treats each emit as the latest version of a key, never as an increment.
- **Operational:** restoring from savepoints must go into a new output version, or rely on idempotent sinks.

### Prove it
Reconcile daily revenue with the source of truth (the payments DB or PSP settlement): sum and count per day and per currency, alerting above 0.01%. Chaos-test by killing TaskManagers mid-checkpoint and asserting the totals.

### Latency trade-off
Transactional sinks make results visible only at checkpoint commit, so a 30 s checkpoint means ~30 s or more of extra latency. Idempotent upserts give low latency but need a keyed, upsert-capable sink.`,
      followUps: [
        {
          q: 'Why do Kafka EXACTLY_ONCE sinks need a large transaction timeout?',
          a: 'Transactions stay open from checkpoint start to completion, and across a failure until recovery commits them. If transaction.timeout.ms is shorter than checkpoint interval plus recovery time, the broker aborts them and data is lost; it must also be ≤ the broker\'s transaction.max.timeout.ms (default 15 min).',
        },
        {
          q: 'Can consumers of Flink\'s output topic see uncommitted data?',
          a: 'Only if they use read_uncommitted. Downstream consumers must set isolation.level=read_committed to benefit from the transactional sink.',
        },
      ],
      pitfalls: [
        'Believing a Flink EOS checkbox covers the sink',
        'Ignoring duplicates already present in the source',
        'Treating window re-fires as increments',
      ],
    },
    {
      id: 'data-pipelines-iq-06',
      difficulty: 'hard',
      question:
        'The nightly pipeline that builds finance tables used to finish at 5 AM; now it finishes at 11 AM, missing the 7 AM SLA. Nothing obvious changed. How do you investigate and fix it?',
      whatInterviewerLooksFor: [
        'Critical-path analysis of the DAG',
        'Checks upstream lateness, skew, small files and resource contention',
        'Concrete Spark/warehouse diagnostics',
        'Short-term mitigation plus structural fixes',
        'Freshness SLO monitoring',
      ],
      modelAnswer: `### 1. Find the critical path
In Airflow/Dagster, compare task start/end times for the last 30 runs. Which task grew? Did it start late (waiting on an upstream sensor) or run long?

### 2. If it started late
Upstream data landed late: a source extract slowed, CDC lag, or a partner file arrived late. Fix with SLAs on upstream datasets, earlier alerting, and decoupling so unaffected branches proceed.

### 3. If it runs long, check the usual suspects
- **Data growth or skew:** in the Spark UI, one task in a stage takes 40 min while the median is 30 s. A skewed join key (a big merchant, a null key) is the classic cause. Fix with AQE skew join, salting, broadcasting the small side, or filtering nulls before the join.
- **Small files:** a streaming sink started committing every minute, so the input is now 2M files of 1 MB. The job spends most of its time listing and opening them. Fix with compaction (Iceberg \`rewrite_data_files\`) and bigger commit intervals.
- **Full recompute over growing history:** the job re-scans all history nightly. Make it incremental: process only new partitions and MERGE.
- **Resource contention:** new jobs sharing the cluster or warehouse at 2 AM, or spot instance loss causing retries. Fix with dedicated pools, priorities and autoscaling.
- **Query plan regression:** stale stats or a new join order. Check \`EXPLAIN\` and refresh statistics.

### 4. Mitigate now
Increase resources for the critical-path task, run independent branches in parallel, and publish partial tables with clear flags if finance can use them.

### 5. Prevent recurrence
Track per-task duration trends, alert when the projected finish exceeds the SLA (not only on a miss), run data-volume and skew checks, and set freshness SLOs on the final tables ("finance.daily_revenue updated by 07:00").`,
      followUps: [
        {
          q: 'How does AQE help with skew?',
          a: 'Spark 3 Adaptive Query Execution detects oversized shuffle partitions at runtime and splits them into sub-partitions (with the matching side replicated), so one hot key no longer defines the stage duration.',
        },
        {
          q: 'Why do small files hurt so much?',
          a: 'Each file costs a metadata operation, an open, a footer read and task scheduling overhead. With object stores, list and GET latency (tens of ms) dominates, so millions of small files can cost more time than the data itself.',
        },
      ],
      pitfalls: [
        'Throwing more executors at it without finding the bottleneck',
        'Ignoring upstream lateness',
        'Only alerting after the SLA is missed',
      ],
    },
    {
      id: 'data-pipelines-iq-07',
      difficulty: 'medium',
      question:
        'We ingest ~5 TB/day of events and have a small data team. Should we build a data lake, a warehouse, or a lakehouse? What would the first version look like?',
      whatInterviewerLooksFor: [
        'Understands the three storage paradigms and their costs',
        'Right-sizes for team size and use cases',
        'Covers file formats, partitioning and table formats',
        'Covers governance/PII and data lifecycle',
      ],
      modelAnswer: `### Clarify use cases
BI dashboards and finance reporting? ML feature engineering on raw events? Ad-hoc exploration? Regulatory retention? Real-time needs?

### Recommendation for a small team at 5 TB/day
A **lakehouse on object storage with an open table format (Iceberg)**, plus a managed query engine, or land raw in the lake and load curated tables into a managed warehouse.
- Raw JSON at 5 TB/day becomes ~0.5–1 TB/day as Parquet+zstd, so 1 year ≈ 180–365 TB at ~$23/TB-month on S3 Standard (cheaper tiers for old data).
- A warehouse storing everything raw would cost more and lock ML teams into its engine.

### v1 layout
- **Bronze:** Kafka → an Iceberg sink (Flink or Kafka Connect), partitioned by \`days(event_time)\`, committing every 5–10 minutes, with nightly compaction to ~512 MB files.
- **Silver:** dbt/Spark jobs clean, dedupe by event_id, and conform types.
- **Gold:** business aggregates for BI, served via Trino/Athena, or synced to Snowflake/BigQuery for analyst comfort.
- **Catalog:** AWS Glue or a REST catalog, with schemas in a registry.

### Governance
- PII columns tagged; hashing/tokenization in silver; row-level deletes for GDPR (Iceberg supports them).
- Retention: bronze 90 days hot then Glacier; silver/gold longer.
- Access by role; audit logs.

### Operations
Table maintenance (compaction, snapshot expiry, orphan file cleanup), data-quality tests on silver/gold, freshness SLOs.

### When to choose differently
If it's mostly BI and SQL analysts with little ML, a managed warehouse alone is the fastest path for a small team, since there are no table-maintenance chores. A plain lake without a table format tends to become a "swamp" with no updates, deletes or consistent reads.`,
      followUps: [
        {
          q: 'Iceberg vs Delta vs Hudi?',
          a: 'All provide ACID tables on object storage. Iceberg has the broadest multi-engine support and hidden partitioning; Delta is tightest with Databricks/Spark; Hudi is strong for upsert-heavy CDC ingestion. Pick by the engines you will use.',
        },
        {
          q: 'How do you handle GDPR deletion in the lake?',
          a: 'Row-level deletes via table-format MERGE/DELETE (copy-on-write or merge-on-read), then snapshot expiry and file rewrite so deleted data is physically removed; also purge from bronze copies and backups by policy.',
        },
      ],
      pitfalls: [
        'Folders of JSON with no table format',
        'Partitioning by high-cardinality columns',
        'Ignoring table maintenance',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'data-pipelines-boe-1',
      question:
        'Ad click aggregation: 1B clicks/day, 2M active ads, 1-minute tumbling windows, dedup on click_id with a 1-hour TTL. Estimate ingest throughput, Flink state size and the number of output rows.',
      assumptions: [
        'Peak = 5× average; event size 200 B',
        'Dedup state per click_id ≈ 60 B in RocksDB (key + timestamp + overhead)',
        'On average ~10% of ads get at least one click in a given minute',
      ],
      steps: [
        { label: 'Average rate', calc: '1B ÷ 86,400 ≈ 11.6K clicks/s' },
        { label: 'Peak rate', calc: '11.6K × 5 ≈ 58K clicks/s → × 200 B ≈ 11.6 MB/s' },
        { label: 'Dedup state', calc: '1-hour TTL at average rate: 11.6K × 3,600 ≈ 42M ids × 60 B ≈ 2.5 GB (peak hour ~12 GB)' },
        { label: 'Window state', calc: 'Open windows ≈ current + late: 2 × 200K active ads × ~50 B ≈ 20 MB (tiny)' },
        { label: 'Output rows per minute', calc: '2M × 10% ≈ 200K rows/min ≈ 3.3K rows/s into the OLAP store' },
        { label: 'Output rows per day', calc: '200K × 1,440 ≈ 288M rows/day ≈ 288M × 40 B ≈ 11.5 GB/day before compression' },
      ],
      answer: 'About 58K events/s (~12 MB/s) at peak; dedup state of 2.5–12 GB dominates Flink state; ~200K aggregate rows per minute (~288M/day) into the OLAP store.',
      insight:
        'Ingest is easy for Kafka. The design pressure is on dedup state (use RocksDB with incremental checkpoints, and parallelism so each TaskManager holds a few GB) and on OLAP write batching. Hourly/daily rollups keep long-range queries off the minute table.',
      followUps: [
        {
          "q": "Bot traffic pushes peak to 50× average for 10 minutes. Which estimate breaks first, and what do you do?",
          "a": "Ingest is about 580K events/s, roughly 116 MB/s, which Kafka absorbs with enough partitions. The dedup state breaks first. A 1-hour TTL at that rate adds about 2.1B ids in an hour, around 125 GB in RocksDB, and spills disk and checkpoint size. Options: use a probabilistic dedup (a Bloom filter per time bucket, with a small false-positive rate), shorten the TTL for anonymous traffic, and filter bots before dedup so they never enter the state."
        },
        {
          "q": "Advertisers now want per-ad, per-country, per-device counts. How does the output estimate change?",
          "a": "Output rows grow with the number of distinct (ad, country, device) combinations that get clicks in a minute, not with the full cross product. If an active ad typically spans about 8 country × device combos, that's about 1.6M rows/min instead of 200K, around 2.3B rows/day and 90 GB/day raw. Pre-aggregating to coarser rollups for long time ranges, plus ClickHouse compression (often 5–10× on such data), keeps it manageable."
        }
      ],
    },
    {
      id: 'data-pipelines-boe-2',
      question:
        'A lakehouse ingests 5 TB/day of raw JSON events. Estimate storage for 2 years, the number of files per day, and the effect of streaming commits every minute.',
      assumptions: [
        'JSON → Parquet + zstd compression ≈ 8×',
        'Target file size 512 MB after compaction',
        'Streaming sink with 32 parallel writers, committing every 1 minute before compaction',
      ],
      steps: [
        { label: 'Compressed per day', calc: '5 TB ÷ 8 ≈ 625 GB/day' },
        { label: '2-year storage', calc: '625 GB × 730 ≈ 456 TB (≈ $10.5K/month at $23/TB on S3 Standard)' },
        { label: 'Files per day (compacted)', calc: '625 GB ÷ 512 MB ≈ 1,220 files/day' },
        { label: 'Files per day (uncompacted streaming)', calc: '32 writers × 1,440 commits ≈ 46K files/day of ~13.5 MB each' },
        { label: 'Query impact', calc: 'A 30-day scan: 1.4M small files vs 37K compacted files → ~38× more open/footer operations' },
      ],
      answer: 'About 625 GB/day compressed, ~456 TB over 2 years; compaction turns ~46K small files/day into ~1.2K large ones.',
      insight:
        'Compression makes the lake affordable, but streaming commit frequency creates a small-files problem that dominates query latency and metadata size. Schedule compaction plus snapshot expiry, move older partitions to cheaper storage tiers, and pick commit intervals by the freshness the consumers actually need.',
      followUps: [
        {
          "q": "Storage cost must halve. Which assumption do you attack?",
          "a": "Attack retention and tiering first. Keep 90 days hot in S3 Standard and move older data to Infrequent Access (about $12.5/TB) or Glacier Instant Retrieval (about $4/TB); that alone more than halves the 456 TB bill. Second, drop or aggregate low-value raw fields after 30 days, since debug payloads often make up much of the JSON. Third, tune compression: zstd at a higher level plus sorting by a low-cardinality column can push 8× toward 10–12×. Cutting the replication factor is not an option on S3."
        }
      ],
    },
    {
      id: 'data-pipelines-boe-3',
      question:
        'A Postgres primary produces ~30 MB/s of WAL at peak (20K row changes/s). The Debezium connector goes down for 6 hours overnight. How much WAL does the replication slot retain, and how long does catch-up take?',
      assumptions: [
        'Average WAL rate overnight ≈ 12 MB/s (40% of peak)',
        'Primary has 1 TB of free disk',
        'Debezium can process ~40K change events/s when catching up; overnight rate ≈ 8K changes/s',
      ],
      steps: [
        { label: 'WAL retained', calc: '12 MB/s × 6 h × 3,600 ≈ 259 GB pinned by the slot' },
        { label: 'Disk headroom', calc: '1 TB − 259 GB ≈ 740 GB left; at peak 30 MB/s a full outage day would be ~2.6 TB → the disk fills in < 10 h at peak' },
        { label: 'Backlog of change events', calc: '8K/s × 21,600 s ≈ 173M events' },
        { label: 'Catch-up time', calc: '173M ÷ (40K − 8K net) ≈ 5,400 s ≈ 1.5 h' },
      ],
      answer: 'About 260 GB of WAL retained after 6 hours, with ~1.5 hours of catch-up. A day-long outage at peak rates would fill the primary\'s disk.',
      insight:
        'A stuck CDC consumer is a risk to the primary database, not just to analytics. Alert on slot lag in bytes (for example > 50 GB), set max_slot_wal_keep_size so the slot is invalidated before the primary dies (then re-snapshot), and give the connector the same on-call priority as the DB.',
      followUps: [
        {
          "q": "Debezium can now only process 10K events/s because of a slow downstream sink. Redo the catch-up estimate.",
          "a": "Net drain = 10K − 8K overnight = 2K events/s. The 173M backlog takes about 86,500 s, roughly 24 hours, and if daytime traffic exceeds 10K/s the backlog grows instead of draining. Meanwhile WAL stays pinned until the slot advances, so the primary keeps accumulating hundreds of GB. Fix the sink (batching, more tasks) or put Kafka in between so Debezium can confirm WAL positions as soon as events land in Kafka, decoupling the slot from the slow sink."
        }
      ],
    },
  ],
  test: [
    {
      id: 'data-pipelines-mcq-01',
      difficulty: 'hard',
      question:
        'A per-minute click dashboard uses processing-time windows. The aggregation job was down from 10:00 to 10:20, then caught up in 2 minutes. What does the dashboard show?',
      options: [
        'Zero clicks for 10:00–10:20 and a huge spike at ~10:20–10:22, because events were assigned to the minute they were processed',
        'Correct counts for 10:00–10:20, because Kafka retained the events',
        'Duplicate counts for 10:00–10:20, because of redelivery',
        'Correct counts, but delayed by 20 minutes',
      ],
      correct: [0],
      explanation:
        'Processing-time windows assign an event to the wall-clock minute in which it is processed, so 20 minutes of backlog lands in the catch-up minutes and the outage window looks empty. Kafka retaining the data doesn\'t help if the window assignment ignores event time. Nothing here causes redelivery duplicates. With event-time windows the counts would be correct, just late.',
      followUps: [
        {
          "q": "You switch to event-time windows. The same 20-minute outage happens again. What does the dashboard show during and right after catch-up, and what still needs care?",
          "a": "During the outage the 10:00–10:20 minutes are empty because nothing has been computed yet. During catch-up they fill in with correct counts as the watermark sweeps forward through the backlog, about 20 minutes of event time in 2 minutes of wall time. The spike is gone. Two things still need care. Windows emitted before the outage must not be double-counted on replay, so sink writes must be upserts. And the dashboard should show a freshness indicator (current watermark vs now) so viewers can tell 'zero clicks' from 'not computed yet'."
        },
        {
          "q": "Billing uses these numbers. How would you detect an outage-shaped distortion automatically instead of waiting for an advertiser to notice?",
          "a": "Emit pipeline-health metrics next to the data: consumer lag per partition, watermark lag (now − watermark), and records per window. Alert when watermark lag passes a few minutes. Then run a reconciliation job that recomputes per-minute totals from the raw events in the lake for each closed hour and compares them to the served table, alerting at more than 0.5% divergence. A processing-time bug shows up as a large positive and negative diff in adjacent minutes even when the daily totals match."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-02',
      difficulty: 'expert',
      question:
        'A Flink job has 1-minute event-time tumbling windows, a watermark of max event time − 5 s, and NO allowed lateness. The window [12:00, 12:01) has already fired. An event with event time 12:00:30 arrives. What happens by default?',
      options: [
        'The window re-fires with an updated count',
        'The event is counted in the current open window instead',
        'The event is dropped as late (no side output is configured), and the result stays uncorrected',
        'The job fails with a late-data exception',
      ],
      correct: [2],
      explanation:
        'Once the watermark has passed the window end plus the allowed lateness (zero here), Flink discards late elements for that window by default. Re-firing requires allowedLateness, and keeping the event requires sideOutputLateData. Flink never reassigns events to other windows, and late data doesn\'t fail the job, so without a metric the loss is silent.',
      followUps: [
        {
          "q": "You add allowedLateness of 10 minutes. What changes for the sink and for state size, and which sink semantics do you now need?",
          "a": "The window keeps its state for 10 extra minutes past the watermark, and every late element re-fires it with an updated aggregate. The sink therefore receives several results for the same window, and appending them would over-count. Write results as an upsert keyed on (key, window_start), or emit retractions. State grows roughly in proportion to the extra retention. With 1-minute windows, 10 minutes of lateness means about 11 windows per key are open instead of 1, which matters for high-cardinality keys."
        },
        {
          "q": "How would you find out how much data the default policy is silently dropping?",
          "a": "Flink exposes the `numLateRecordsDropped` metric per operator, so chart and alert on it relative to input rate. For detail, add `sideOutputLateData` and write late events to a table with their event time and arrival time. The distribution of (arrival − event time) tells you which watermark delay or allowed lateness would capture 99.9% of events, so the policy rests on measurements rather than guesses."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-03',
      difficulty: 'medium',
      question:
        'Product wants "error rate over the last 5 minutes, refreshed every minute" on a dashboard. Which window fits?',
      options: [
        'Tumbling 5-minute window',
        'Tumbling 1-minute window',
        'Session window with a 5-minute gap',
        'Hopping window with size 5 minutes and slide 1 minute',
      ],
      correct: [3],
      explanation:
        'A hopping window of size 5 with a 1-minute slide produces a new 5-minute aggregate every minute; each event belongs to 5 windows. A 5-minute tumbling window updates only every 5 minutes. 1-minute tumbling windows answer a different question (unless you sum the last 5, which is the pane optimisation of the same hopping window). Session windows depend on per-key inactivity gaps.',
      followUps: [
        {
          "q": "There are 50K services, and each event lands in 5 hopping windows. How do you keep that from costing 5× in state and CPU?",
          "a": "Use panes, i.e. slicing. Aggregate each event once into a 1-minute tumbling slice per key, then build each 5-minute result by combining the last 5 slices. That works because error-rate counts (errors, total) are mergeable. Flink's window TVF HOP and its slicing optimisation do this automatically for SQL aggregates. State becomes 5 small slices per key instead of 5 full windows, and per-event work drops from 5 updates to 1. Non-mergeable aggregates such as exact percentiles break this, so use sketches (t-digest) instead."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-04',
      difficulty: 'expert',
      question:
        'This Flink SQL job reads a 12-partition topic. At night, 3 partitions receive no events at all (their producers are regional and idle). Hourly results stop being emitted until morning. Why?',
      code: {
        language: 'sql',
        code: `CREATE TABLE events (
  user_id STRING, region STRING, event_time TIMESTAMP(3),
  WATERMARK FOR event_time AS event_time - INTERVAL '30' SECOND
) WITH ('connector' = 'kafka', 'topic' = 'events', 'format' = 'json');

SELECT region, window_start, COUNT(*)
FROM TABLE(TUMBLE(TABLE events, DESCRIPTOR(event_time), INTERVAL '1' HOUR))
GROUP BY region, window_start, window_end;`,
      },
      options: [
        'Tumbling windows only fire when every region has data in the window',
        'The source watermark is the minimum across partitions; idle partitions never advance theirs, so the global watermark stalls. Set table.exec.source.idle-timeout',
        'A 30-second watermark delay is too small for hourly windows',
        'GROUP BY on window_end prevents firing until the next window starts',
      ],
      correct: [1],
      explanation:
        'Each source split tracks its own watermark, and the operator takes the minimum. Partitions with no events keep reporting an old watermark, so no window can close. Marking splits idle after a timeout excludes them from the minimum. Windows fire per key once the watermark passes their end, regardless of other regions, and the delay size and window_end grouping are unrelated to the stall.',
      followUps: [
        {
          "q": "You set an idle timeout of 1 minute. At 6 AM a regional producer comes back and sends events stamped 05:59. What happens to them?",
          "a": "While the partition was idle, the global watermark advanced on the other partitions and is probably past 06:00. When the idle partition resumes, its events at 05:59 are behind the watermark, so any window ending at or before 06:00 that already fired treats them as late and drops them, unless allowed lateness or a side output is set. The idle timeout trades completeness for liveness. Pick it based on how long a producer can be idle while still holding buffered data, and route late events to a side output."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-05',
      difficulty: 'hard',
      question:
        'A Flink job with exactly-once checkpointing writes per-order revenue facts to a warehouse. Select ALL sink designs that avoid duplicate facts after a TaskManager failure and recovery.',
      options: [
        'A transactional sink that pre-commits on the checkpoint barrier and commits when the checkpoint completes (2PC)',
        'MERGE/upsert keyed by order_id, so replayed results overwrite the same rows',
        'Plain INSERT with batching every 5 seconds',
        'Writing results and the source offsets atomically in the same warehouse transaction, and restoring from those offsets',
        'Enabling Kafka consumer auto-commit so offsets are saved more often',
      ],
      correct: [0, 1, 3],
      explanation:
        'After recovery Flink replays from the last checkpoint, so any output emitted after it is produced again. A 2PC sink exposes only checkpointed output. Idempotent upserts make replays overwrite. Atomic output plus offsets means the replay starts exactly after what was written. Plain inserts duplicate the replayed results, and Kafka auto-commit is irrelevant because Flink restores offsets from its own checkpoints.',
      followUps: [
        {
          "q": "You chose the 2PC Kafka transactional sink. Downstream consumers complain the results arrive in bursts every 60 seconds. Why, and what are your options?",
          "a": "The transactions commit only when a checkpoint completes, and read_committed consumers can't see records until the commit. Output therefore becomes visible once per checkpoint interval (60 s), so end-to-end latency is at least the checkpoint interval plus the checkpoint duration. Options are a shorter checkpoint interval (10–15 s, at a cost in checkpoint overhead), letting latency-tolerant consumers read uncommitted data (they then see duplicates on failure), or switching to an idempotent upsert sink. With upserts, results are visible immediately and replays simply overwrite."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-06',
      difficulty: 'expert',
      question:
        'The Debezium connector for a Postgres primary has been failing silently for 2 days. The on-call engineer is paged for the primary, not for analytics. What is the most likely page?',
      options: [
        'High CPU on the primary from Debezium retrying queries',
        'Table bloat from Debezium holding row locks',
        'Replication lag on physical read replicas caused by Debezium',
        'The primary\'s disk is filling, because the logical replication slot retains all WAL since the connector\'s last confirmed position',
      ],
      correct: [3],
      explanation:
        'A replication slot guarantees WAL is kept until its consumer confirms it, so with the consumer gone WAL piles up and can exhaust the primary\'s disk. max_slot_wal_keep_size (PG13+) caps this by invalidating the slot. Debezium reads WAL rather than running heavy queries, it doesn\'t hold row locks, and physical replicas stream WAL independently of the logical slot.',
      followUps: [
        {
          "q": "You set max_slot_wal_keep_size = 200GB and it triggers. What happens next, and how do you recover the CDC pipeline without losing changes?",
          "a": "Postgres invalidates the slot and removes the WAL it held. The primary is saved, but Debezium can no longer resume from its offset because that WAL is gone. Recovery means creating a new slot and running a new snapshot. Debezium's incremental snapshot (signal table, chunked by primary key) does this without long locks, while new changes stream concurrently. Downstream sinks must be idempotent upserts so the overlap between snapshot rows and streamed changes resolves to the latest version. Also alert on slot lag at, say, 50 GB, well before the cap."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-07',
      difficulty: 'hard',
      question:
        'An hourly job extracts changes with this query and then sets :last to the job start time. A transaction begins at 10:59:50, sets updated_at = now(), and commits at 11:00:20. The job ran at 11:00:00. What happens to that row?',
      code: {
        language: 'sql',
        code: `SELECT * FROM orders
WHERE updated_at > :last        -- :last = previous run start time
ORDER BY updated_at;`,
      },
      options: [
        'It is never extracted: the 11:00 run couldn\'t see the uncommitted row, and the 12:00 run uses :last = 11:00:00, which is after its updated_at of 10:59:50',
        'It is picked up by the 12:00 run, because updated_at is after 10:00',
        'It is extracted twice, by the 11:00 and 12:00 runs',
        'Postgres sets now() at commit time, so updated_at = 11:00:20 and the next run picks it up',
      ],
      correct: [0],
      explanation:
        'In Postgres, now() is the transaction start time, so the row carries 10:59:50 but becomes visible only at 11:00:20. The 11:00 run missed it because it wasn\'t visible yet, and the 12:00 run looks only after 11:00:00, so the row falls through the gap. That is why polling needs a safety lag or overlap, and why log-based CDC, which follows commit order, avoids the problem.',
      followUps: [
        {
          "q": "You can't touch the source schema or add CDC. What is the minimal change to this query that makes it safe, and what does it cost?",
          "a": "Keep a lookback window. Query `updated_at > :last - interval '15 minutes'` and make the load an idempotent MERGE by primary key that keeps the newer version. Each run then re-reads the overlap and catches rows that committed late. The cost is re-reading about 15 minutes of changes every run, and transactions longer than the overlap can still slip through, so add a nightly per-day count/checksum reconciliation. Also set `:last` from the max extracted updated_at or the DB clock, not the app's job start time."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-08',
      difficulty: 'medium',
      question:
        'A team maintains a Spark nightly job and a Flink real-time job that compute the same metrics, and they constantly drift apart. Which architecture change most directly removes the root cause?',
      options: [
        'Run the Spark job every hour instead of nightly',
        'Add more monitoring to both jobs',
        'Move to a Kappa-style design (or one unified engine) so a single codebase computes the metrics, with reprocessing done by replay',
        'Switch the warehouse from Redshift to Snowflake',
      ],
      correct: [2],
      explanation:
        'The drift comes from implementing the same logic twice, which is Lambda\'s core weakness. One codebase, via kappa or an engine that runs in both batch and streaming modes, removes it. Running Spark more often narrows the time gap but keeps two implementations. Monitoring detects drift without preventing it, and the warehouse vendor is irrelevant.',
      followUps: [
        {
          "q": "You move to one Flink codebase. Finance still wants a nightly 'final' number that never changes after month-end close. How do you serve both?",
          "a": "Run the same job code in two modes. Streaming produces provisional real-time results. A bounded batch run of the same code over the closed day, reading raw events from the lake, produces the final numbers and writes them to a separate, versioned table that is frozen after close. Since the code is shared, any difference is down to late data rather than logic. Publish the difference as a reconciliation metric, and point finance reports only at the frozen table."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-09',
      difficulty: 'expert',
      question:
        'A Flink job\'s checkpoint duration grew from 20 s to 9 minutes and the web UI shows backpressure. Select ALL statements that are true.',
      options: [
        'Under backpressure, aligned checkpoint barriers queue behind buffered records, so checkpoints take longer; unaligned checkpoints can bound this',
        'A slow or throttled sink is a common root cause, and backpressure appears on the operators upstream of it',
        'Switching from incremental to full RocksDB checkpoints will reduce the duration',
        'A skewed key concentrating traffic on one subtask can backpressure the whole job',
        'Increasing the Kafka topic\'s partition count always fixes backpressure',
      ],
      correct: [0, 1, 3],
      explanation:
        'Barriers travel with the data, so full buffers delay them, and unaligned checkpoints let barriers overtake in-flight data. Backpressure propagates upstream from the bottleneck, which is often the sink or a hot subtask handling a skewed key. Full checkpoints upload the entire state and are slower than incremental ones. More partitions don\'t fix a slow sink or a single hot key.',
      followUps: [
        {
          "q": "The backpressure starts at the JDBC sink to the warehouse. You can't make the warehouse faster. What do you change in the job?",
          "a": "Batch more. Use larger JDBC batches (for example 5K rows or 1 s) or switch to bulk loading: write files to object storage and COPY them in, which warehouses handle far better than row inserts. Pre-aggregate before the sink so fewer rows reach it. Raise sink parallelism only if the warehouse has spare concurrency. If spikes are temporary, let Kafka absorb them, since backpressure merely slows consumption. Enable unaligned checkpoints so checkpoints keep completing while the sink is slow, and alert on consumer lag."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-10',
      difficulty: 'hard',
      question:
        'Daily reconciliation shows the streaming click totals are 0.4% lower than the batch recompute from raw events, consistently every day. What is the most likely explanation and action?',
      options: [
        'The batch job double counts; switch billing to the streaming numbers',
        'Events arriving after the watermark plus allowed lateness are dropped by the stream but included by batch. Measure the late share, route late data to a side output, and keep batch as the source of truth for billing',
        'Kafka is losing 0.4% of messages; increase replication factor',
        'Clock skew between Flink TaskManagers causes the difference',
      ],
      correct: [1],
      explanation:
        'A small, consistent undercount in streaming is the signature of late data cut off by the watermark policy. Batch over a closed day sees everything. Kafka with RF=3 and acks=all doesn\'t lose data at a steady 0.4%. Event time comes from the data, so TaskManager clocks don\'t matter. Streaming is the estimate and batch the reconciled truth; sizing lateness from measurements narrows the gap.',
      followUps: [
        {
          "q": "One day the gap jumps from 0.4% to 6%. What would you check first?",
          "a": "A sudden jump means something changed. Check, in order: a client release or SDK change that batches events offline, so arrival lateness spikes (look at the late side-output volume and the event-time-to-arrival histogram); a partition or region whose producer stalled, so its events arrived after the watermark moved on; the job restarting from an old checkpoint or with a changed watermark config; and batch-side changes such as duplicated raw files. Compare the gap by partition, app version and region to localise it."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-11',
      difficulty: 'expert',
      question:
        'A stream job emits per-minute counts into this ClickHouse table, re-emitting a row when late data arrives. Right after a burst of re-emits, what does the dashboard query return?',
      code: {
        language: 'sql',
        code: `CREATE TABLE ad_clicks_1m (ad_id String, window_start DateTime,
  clicks UInt64, version UInt64)
ENGINE = ReplacingMergeTree(version) ORDER BY (ad_id, window_start);

-- dashboard
SELECT ad_id, sum(clicks) FROM ad_clicks_1m
WHERE window_start >= now() - INTERVAL 1 HOUR GROUP BY ad_id;`,
      },
      options: [
        'Possibly inflated totals: duplicate versions of a (ad_id, window_start) row coexist until a background merge, so sum() adds them. Use FINAL or argMax(clicks, version) per key',
        'Exact totals: ReplacingMergeTree deduplicates on insert',
        'Only the oldest version of each row',
        'An error, because ReplacingMergeTree does not support sum()',
      ],
      correct: [0],
      explanation:
        'ReplacingMergeTree collapses rows with the same sorting key during background merges, which happen at an unpredictable time. Until then, all versions are visible and summing them over-counts. FINAL or an argMax subquery gives exact results. Deduplication does not happen at insert, and aggregate functions work normally on the table.',
      followUps: [
        {
          "q": "FINAL makes the dashboard query 4× slower at 288M rows/day. What alternative design keeps exact results fast?",
          "a": "Write deltas instead of replacements. Insert only the increment (new count − previously emitted count) into a SummingMergeTree, or into an AggregatingMergeTree with sumState, so summing all rows is correct without dedup. Alternatively, keep ReplacingMergeTree but query hourly or daily rollup tables populated by materialized views, and use FINAL only on the last hour, where most re-emits occur. Newer ClickHouse versions also parallelise FINAL by partition, so partitioning by day bounds the cost."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-12',
      difficulty: 'medium',
      question:
        'With this outbox pattern and Debezium\'s outbox event router, what should consumers of order.events.v1 expect?',
      code: {
        language: 'sql',
        code: `BEGIN;
UPDATE orders SET status = 'PAID' WHERE id = 'o-7';
INSERT INTO outbox (id, aggregatetype, aggregateid, type, payload)
VALUES (gen_random_uuid(), 'order', 'o-7', 'OrderPaid', '{"orderId":"o-7"}');
COMMIT;`,
      },
      options: [
        'Exactly-once delivery with global ordering across all orders',
        'No ordering guarantees at all, since Debezium publishes rows in random order',
        'Events may be published for transactions that later roll back',
        'An event for every committed change (none for rolled-back ones), ordered per order via key = aggregateid, delivered at-least-once, so consumers should dedupe on the outbox id',
      ],
      correct: [3],
      explanation:
        'Because the outbox row commits atomically with the business change, rolled-back transactions produce no event. Debezium reads the WAL in commit order and keys events by aggregateid, so events for one order stay ordered. Connector restarts can re-send, so delivery is at-least-once and consumers dedupe by event id. There is no global order across orders, since different keys land on different partitions.',
      followUps: [
        {
          "q": "The outbox table grows by 5M rows a day. How do you keep it from bloating Postgres, and is it safe to delete rows right after insert?",
          "a": "Debezium reads the INSERT from the WAL, not from the table, so a row can be deleted right away. A common pattern is to insert and delete in the same transaction, or delete in a periodic job. The event still flows because it's in the WAL. Batched deletes or time-partitioned outbox tables (drop old partitions) avoid vacuum pressure. Don't depend on the table for replay; replay from Kafka. Do confirm the connector is configured not to emit tombstones for those deletes."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-13',
      difficulty: 'hard',
      question:
        'An Iceberg table fed by a streaming sink is getting slow to query. Select ALL statements that are true about the small-files problem.',
      options: [
        'Frequent streaming commits from many parallel writers create large numbers of small files',
        'Query engines pay per-file costs (listing, open, footer reads, task scheduling), so many small files can dominate query time',
        'Periodic compaction (for example, rewrite_data_files to ~512 MB) plus snapshot expiry addresses it',
        'Partitioning the table by user_id will reduce the number of files',
        'Switching the file format from Parquet to JSON removes per-file overhead',
      ],
      correct: [0, 1, 2],
      explanation:
        'Commit frequency times writer parallelism sets the file count, and per-file overhead, amplified by object-store latency, dominates scans. Compaction rewrites small files into large ones, and snapshot expiry cleans up metadata. Partitioning by a high-cardinality column like user_id multiplies files dramatically. JSON is larger and slower than columnar Parquet and doesn\'t change per-file costs.',
      followUps: [
        {
          "q": "Compaction runs hourly, but the streaming writer keeps committing to the same partitions. What conflicts can happen, and how do you avoid them?",
          "a": "Iceberg uses optimistic concurrency. A rewrite_data_files commit fails validation if the writer deleted or modified (for example upserted) the same files in the meantime, and the compaction is wasted. Append-only writers seldom conflict, but merge-on-read upsert sinks do. Mitigations: compact only partitions that are no longer hot (for example hours older than now − 1h), use partial-progress commits so a big rewrite commits in groups, and schedule compaction away from peak write times."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-14',
      difficulty: 'expert',
      question:
        'In a Kappa architecture, you must deploy v2 of a job that changes how sessions are computed, and restate the last 180 days. Kafka retention is 7 days. What is the right approach?',
      options: [
        'Increase Kafka retention to 180 days now and replay tomorrow',
        'Run v2 only on new data and accept that history uses the old logic',
        'Replay history from a durable replayable store (Kafka tiered storage if it holds 180 days, or the lake\'s raw events as a bounded source) into a new output table, then switch readers once validated',
        'Reset the v1 consumer group to the earliest offset and redeploy as v2 over the existing output table',
      ],
      correct: [2],
      explanation:
        'Kappa reprocessing needs the full history to be replayable. Raising retention now does not bring back data already deleted. The lake\'s raw bronze layer (or tiered storage) serves as the replay source, and writing into a new table with an atomic switch avoids corrupting live results. Running v2 only on new data leaves history inconsistent. Resetting v1 reaches back only 7 days and overwrites live output mid-flight.',
      followUps: [
        {
          "q": "The 180-day replay from the lake will take 2 days. Meanwhile live data keeps arriving. How do you cut over without a gap or overlap?",
          "a": "Run v2 as a bounded source over the lake up to a cut-off time T, then switch it to Kafka starting at the offsets that correspond to T. Flink's HybridSource does exactly this. v2 writes to its own table while v1 keeps serving. When v2 has caught up to live, compare the two tables over a recent window. Then switch readers atomically through a view or alias swap. Keep v1 running for a rollback period, then retire it. Idempotent upserts around T absorb any small overlap."
        }
      ],
    },
    {
      id: 'data-pipelines-mcq-15',
      difficulty: 'expert',
      question:
        'A Flink SQL job joins a clicks stream with an impressions stream on impression_id using a regular join (no time bounds). After two weeks, checkpoints are huge and the job keeps running out of memory or disk. What is the fix?',
      options: [
        'Increase TaskManager memory; the state will stabilise once all impressions are seen',
        'Use an interval join (for example, click time BETWEEN impression time AND impression time + 1 hour) or set a state TTL, so join state is bounded by time',
        'Switch the state backend from RocksDB to the heap backend',
        'Increase the checkpoint interval so checkpoints happen less often',
      ],
      correct: [1],
      explanation:
        'A regular streaming join must keep both sides forever, because a matching record could arrive at any time, so state grows without bound. An interval join lets Flink drop state once the watermark passes the interval, and a state TTL caps retention explicitly. More memory only delays the failure. The heap backend holds less state than RocksDB. A longer checkpoint interval doesn\'t shrink the state.',
      followUps: [
        {
          "q": "With a 1-hour interval join, 3% of clicks never find an impression. How do you decide whether to widen the interval?",
          "a": "Measure first. Send unmatched clicks to a side output, then join them offline against the full impressions table to see the actual click − impression delay distribution. If most matches arrive at 1–3 hours, widen the interval, knowing state grows roughly linearly (3 hours of impressions instead of 1). If they never match, they are bot clicks or impressions lost upstream, which is a data-quality problem. A hybrid also works: a 1-hour streaming join for freshness plus a batch backfill that attributes the rest."
        }
      ],
    },
  ],
};

export default topic;
