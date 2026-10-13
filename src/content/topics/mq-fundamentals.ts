import type { Topic } from '../../types';

const topic: Topic = {
  id: 'mq-fundamentals',
  phase: 'messaging',
  order: 1,
  title: 'Message Queues & Kafka Internals',
  subtitle:
    'Queues vs pub/sub vs logs, Kafka partitions, replication, ISR and acks, consumer groups, offsets, ordering and exactly-once — plus when RabbitMQ or SQS is the better tool.',
  estimatedMinutes: 120,
  sources: [
    'Alex Xu — System Design Interview Vol 2, Ch 4 Distributed Message Queue',
    'Apache Kafka documentation (3.x / 4.x)',
    'Kafka: The Definitive Guide, 2nd ed.',
    'RabbitMQ and Amazon SQS documentation',
    'AWS documentation — Amazon SQS message quotas, Amazon SNS quotas and FIFO topics, Amazon EventBridge quotas and archive/replay, Kinesis Data Streams quotas (2026)',
    'ByteByteGo — SQS vs SNS vs EventBridge vs Kinesis (2025)',
  ],
  tags: ['kafka', 'rabbitmq', 'sqs', 'pub-sub', 'partitions', 'isr', 'acks', 'consumer-groups', 'offsets', 'exactly-once', 'kraft', 'event-driven', 'kafkajs'],
  cheatSheet: [
    'Queue = each message to ONE consumer, deleted on ack (SQS, RabbitMQ). Log = append-only, retained, many groups replay independently by offset (Kafka, Kinesis, Pulsar).',
    'Kafka unit of parallelism AND ordering = partition. Max active consumers per group = #partitions. Order is only per partition; same key → same partition (murmur2(key) % N).',
    'Durability recipe: replication.factor=3, min.insync.replicas=2, acks=all, unclean.leader.election.enable=false → survives 1 broker loss with zero acked-data loss.',
    'ISR = replicas caught up within replica.lag.time.max.ms (30s). Consumers only read up to the high watermark (replicated to all ISR).',
    'Kafka 3.0+ producer defaults: acks=all, enable.idempotence=true (PID + per-partition sequence → no dupes/reorder on retry with ≤5 in-flight).',
    'Commit offsets AFTER processing → at-least-once (dupes on crash). Commit BEFORE → at-most-once (loss). Exactly-once = transactions (read-process-write inside Kafka) or idempotent sinks.',
    'Rebalance triggers: join/leave, session.timeout.ms (45s) missed heartbeats, max.poll.interval.ms (5 min) exceeded. Use cooperative-sticky + static membership (group.instance.id) to avoid stop-the-world.',
    'Throughput comes from sequential appends, OS page cache, zero-copy sendfile, batching (linger.ms, batch.size) and compression (lz4/zstd). One partition ≈ 10s of MB/s; a broker ≈ hundreds of MB/s.',
    'KRaft replaced ZooKeeper (GA 3.3, ZooKeeper removed in 4.0): Raft-based controller quorum stores metadata → faster failover, millions of partitions.',
    'SQS: visibility timeout (default 30s, max 12h), retention 4 days default (max 14), FIFO = MessageGroupId ordering + 5-min dedup window. RabbitMQ: exchanges route, prefetch bounds unacked, quorum queues for durability.',
  ],
  sections: [
    {
      heading: 'Why messaging: synchronous calls vs asynchronous hand-off',
      body: `**Intuition:** a phone call needs both people free at the same moment; a letter box doesn't. A message broker is the letter box between services — the sender drops the message and moves on; the receiver picks it up when it can.

**What you buy with async:**
- **Temporal decoupling:** the consumer can be down for 10 minutes; messages wait. With a sync chain, availability multiplies: 5 services at 99.9% each give ~99.5% end to end.
- **Load leveling:** a 10× spike fills the queue instead of melting the database; consumers drain at their sustainable rate.
- **Fan-out:** one "OrderPlaced" event feeds billing, email, analytics and search indexing without the order service knowing any of them.
- **Latency hiding:** user gets **202 Accepted** in 30 ms; the 8-second PDF render happens later.

**What you pay:**
- **Eventual consistency** — the email arrives 2 s later; read-your-writes needs thought.
- **Duplicates and reordering** become normal (at-least-once delivery) → idempotent consumers.
- **Operational weight:** brokers, lag monitoring, DLQs, schema governance, tracing across hops.
- **Harder debugging:** a request is now a causal chain across topics; you need correlation ids and distributed tracing.

**Rule of thumb:** use sync (REST/gRPC) when the caller needs the answer to continue (auth check, price quote). Use async when the caller only needs to know the work *will* happen (notifications, projections, integrations, heavy processing).

**In interviews say this:** "I'd keep the user-facing path synchronous and minimal — validate, persist, respond — and publish an event for everything that doesn't need to block the user, accepting eventual consistency and designing consumers to be idempotent."`,
      diagram: `  Synchronous chain (availability multiplies, latency adds)
  client -> order -> payment -> inventory -> email     p99 = sum of hops

  Async hand-off (decoupled in time and failure)
  client -> order --(OrderPlaced)--> [ broker ] --> payment
              |                          |------> inventory
           202 Accepted                  |------> email
                                         '------> analytics`,
      keyPoints: [
        'Async buys decoupling, load leveling and fan-out; costs eventual consistency and duplicates.',
        'Sync when the caller needs the answer; async when it only needs a guarantee the work happens.',
        'Every async design needs idempotent consumers and correlation ids.',
      ],
    },
    {
      heading: 'Queue vs pub/sub vs log: three different contracts',
      body: `**Intuition:** a *queue* is a to-do list shared by workers — each task done once, then crossed off. *Pub/sub* is a radio broadcast — everyone tuned in hears it, late listeners miss it. A *log* is a newspaper archive — every reader keeps their own bookmark and can re-read old issues.

| | Work queue | Pub/sub (broadcast) | Distributed log |
|---|---|---|---|
| Delivery | one consumer per message | every subscriber gets a copy | every consumer *group* reads all; within a group one member per partition |
| After consume | deleted on ack | gone after delivery | **retained** (time/size), consumers track offsets |
| Replay | no (except DLQ redrive) | no | yes — reset offset |
| Ordering | weak (FIFO variants exist) | per-subscriber, usually weak | strict per partition |
| Consumer scaling | add workers freely | per subscription | bounded by partition count |
| Examples | SQS, RabbitMQ queue, BullMQ | SNS, RabbitMQ fanout, Redis Pub/Sub, Google Pub/Sub | Kafka, Kinesis, Pulsar, Redpanda |

**Hybrid reality:** Kafka gives pub/sub *across* consumer groups and queue semantics *within* a group. SNS → multiple SQS queues is the AWS fan-out pattern. RabbitMQ Streams and Pulsar blur the line further.

**Push vs pull:** RabbitMQ pushes to consumers (bounded by prefetch); Kafka and SQS consumers **pull**. Pull lets slow consumers go at their own pace and enables efficient batching; the cost is polling (Kafka uses long polling with \`fetch.min.bytes\`/\`fetch.max.wait.ms\`; SQS long polling up to 20 s). Alex Xu's design chooses pull for the same reasons.

**Choosing:** background jobs with per-message retries and no replay → queue. Many independent downstream systems, replay, event sourcing, stream processing → log.`,
      keyPoints: [
        'Queue deletes on ack; log retains and consumers track offsets.',
        'Kafka = pub/sub across groups, queue within a group.',
        'Pull enables batching and consumer-paced flow; push needs prefetch limits.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 4 (queue vs pub/sub, pull vs push)',
    },
    {
      heading: 'Kafka architecture: brokers, topics, partitions and segments',
      body: `**Intuition:** a topic is a book split into volumes (partitions) so many people can write and read at once. Each volume only ever grows at the end, and old chapters are torn out after a week.

**Components:**
- **Broker:** a Kafka server storing partitions. A cluster has 3 to hundreds.
- **Topic:** a named stream, split into **partitions** (e.g., \`orders\` with 48 partitions).
- **Partition:** an ordered, append-only log. Each record gets a monotonically increasing **offset**. Partitions are the unit of parallelism, ordering and replication.
- **Segment:** a partition on disk is a directory of segment files (\`00000000000000123456.log\` named by base offset) plus \`.index\` (offset → byte position) and \`.timeindex\` (timestamp → offset). Default \`log.segment.bytes\` = **1 GB**. Only the active segment is written; retention deletes whole closed segments.
- **Retention:** by time (\`retention.ms\`, default **7 days**) or size (\`retention.bytes\`), or **log compaction** (\`cleanup.policy=compact\`: keep the latest value per key — ideal for changelogs and "current state" topics; a null value is a tombstone).
- **Controller:** manages partition leadership and cluster metadata (KRaft quorum, see next section).

**Why Kafka is fast** (Alex Xu's WAL design, same ideas):
1. **Sequential I/O** only — appends and sequential reads; even HDDs do hundreds of MB/s sequentially.
2. **OS page cache** instead of a JVM heap cache: recent data is served from RAM; brokers survive GC easily.
3. **Zero-copy** (\`sendfile\`) from page cache to socket for consumers (not possible with TLS in-JVM encryption, which is why TLS costs CPU).
4. **Batching + compression** end to end: the producer compresses a batch, the broker stores it as-is, the consumer decompresses.
5. **Partitioned scale-out:** add partitions/brokers to add throughput.

**Numbers to quote:** a single partition handles roughly 10–50 MB/s of writes depending on hardware and replication; a well-provisioned broker 200–600 MB/s; end-to-end latency typically 2–20 ms with \`acks=all\` in one region. LinkedIn runs trillions of messages per day.`,
      diagram: `  Topic "orders" (3 partitions, RF=3) on brokers B1..B3

  P0: [0][1][2][3][4][5][6] <- append     leader B1, followers B2,B3
  P1: [0][1][2][3][4]       <- append     leader B2, followers B3,B1
  P2: [0][1][2][3][4][5]    <- append     leader B3, followers B1,B2

  On disk: /data/orders-0/
    00000000000000000000.log  .index  .timeindex   (closed, 1 GB)
    00000000000004718592.log  .index  .timeindex   (active segment)`,
      code: [
        {
          language: 'bash',
          title: 'Creating a production-grade topic',
          code: `# 48 partitions: room for 48 parallel consumers per group; RF 3 across racks/AZs
kafka-topics.sh --bootstrap-server kafka-0:9092 --create \\
  --topic orders.v1 \\
  --partitions 48 \\
  --replication-factor 3 \\
  --config min.insync.replicas=2 \\
  --config retention.ms=604800000 \\
  --config compression.type=producer \\
  --config max.message.bytes=1048576

# Compacted "latest state per key" topic (e.g., customer profile changelog)
kafka-topics.sh --bootstrap-server kafka-0:9092 --create \\
  --topic customers.state.v1 --partitions 24 --replication-factor 3 \\
  --config cleanup.policy=compact \\
  --config min.cleanable.dirty.ratio=0.5 \\
  --config delete.retention.ms=86400000   # keep tombstones 1 day

# Inspect partition leaders and ISR
kafka-topics.sh --bootstrap-server kafka-0:9092 --describe --topic orders.v1`,
        },
      ],
      keyPoints: [
        'Partition = ordered append-only log split into segments with offset/time indexes.',
        'Retention deletes whole segments; compaction keeps the latest value per key.',
        'Speed = sequential I/O + page cache + zero-copy + batching/compression + partitioning.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 4 (WAL, segments, batching)',
    },
    {
      heading: 'Replication, ISR, acks and leader election (and KRaft)',
      body: `**Intuition:** each partition has one "author" (leader) and a few "photocopiers" (followers). A write counts as safe once enough photocopiers have a copy. If the author dies, a photocopier that has *everything* takes over.

**Mechanics:**
- Each partition has **replication.factor** replicas (usually **3**). One is the **leader**; producers and (by default) consumers talk to it. Followers **fetch** from the leader like consumers.
- **ISR (in-sync replicas):** replicas that have caught up to the leader within \`replica.lag.time.max.ms\` (default **30 s**). Lagging followers are removed from ISR, and re-added once caught up.
- **High watermark (HW):** the highest offset replicated to all ISR. Consumers only see messages **below the HW**, so they never read data that could be lost in a failover.
- **acks** (producer):
  - \`acks=0\`: fire and forget — fastest, loses data on any failure.
  - \`acks=1\`: leader wrote it (to page cache). Lost if the leader dies before followers copy it.
  - \`acks=all\` (-1): all **current ISR** have it. Combined with \`min.insync.replicas=2\`, the write is rejected (\`NotEnoughReplicas\`) if fewer than 2 replicas are in sync — you choose unavailability over silent loss.
- **Leader election:** when a leader fails, the controller picks a new leader **from the ISR**. \`unclean.leader.election.enable=false\` (default) forbids electing an out-of-sync replica — otherwise acknowledged data is lost.
- Kafka acks writes once they are in the replicas' **page cache**, not fsynced; durability comes from replication across failure domains (racks/AZs, \`broker.rack\`), not from fsync.

**The classic configuration:** RF=3, min.insync=2, acks=all → tolerate 1 broker down with writes still accepted and no acked data lost; 2 down → writes to affected partitions fail (reads may still work).

**KRaft (Kafka Raft):** metadata (topics, partitions, ISR, configs) used to live in ZooKeeper. KRaft moves it into an internal Raft-replicated \`__cluster_metadata\` log managed by a quorum of **controllers** (3 or 5). Production-ready since 3.3; **ZooKeeper support removed in Kafka 4.0** (2025). Benefits: one system to operate, controller failover in seconds instead of reloading all metadata from ZK, and support for millions of partitions.`,
      diagram: `  acks=all, RF=3, min.insync.replicas=2

  producer --write(offset 105)--> Leader B1  [..101 102 103 104 105]
                                     |  followers fetch
                     B2 [..101 102 103 104 105]   in ISR
                     B3 [..101 102]               lagging -> removed from ISR
  ISR={B1,B2} (size 2 >= min.insync 2) -> ack sent once B2 has 105
  High watermark = 105 -> consumers may read 105
  If B1 dies: new leader elected from ISR = B2 (has 105). No acked loss.`,
      code: [
        {
          language: 'yaml',
          title: 'Durability-oriented broker settings (server.properties as YAML for readability)',
          code: `# Broker defaults for new topics
default.replication.factor: 3
min.insync.replicas: 2                 # with acks=all: reject writes if < 2 in sync
unclean.leader.election.enable: false  # never elect a replica missing acked data
replica.lag.time.max.ms: 30000         # follower out of ISR after 30s behind
broker.rack: us-east-1a                # rack-aware replica placement across AZs
auto.create.topics.enable: false       # typos should not silently create topics

# KRaft mode (Kafka 3.3+; required in 4.0)
process.roles: broker                  # dedicated controllers run process.roles=controller
controller.quorum.bootstrap.servers: ctrl-0:9093,ctrl-1:9093,ctrl-2:9093
node.id: 4`,
        },
      ],
      keyPoints: [
        'Consumers only read below the high watermark.',
        'acks=all waits for the current ISR; min.insync.replicas sets the floor.',
        'Unclean leader election trades acked-data loss for availability — keep it off for important data.',
        'KRaft replaces ZooKeeper; ZK removed in Kafka 4.0.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 4 (replication, ISR, ACK settings)',
    },
    {
      heading: 'Producers: keys, partitioning, batching and the idempotent producer',
      body: `**Intuition:** the producer is a smart post office: it sorts letters by destination (partition), bundles them into sacks (batches), shrinks them (compression), and numbers every sack so the receiving office can throw away duplicates.

**Partitioning:**
- **Keyed** records: \`partition = murmur2(key) % numPartitions\` (the Java default; kafkajs' DefaultPartitioner is compatible). Same key → same partition → ordered.
- **Null key:** the Java client uses sticky partitioning (fill a batch for one partition, then switch; KIP-480 and KIP-794) for bigger batches; there is no ordering relationship between records.
- **Adding partitions changes the mapping** for existing keys: key K may move from P3 to P17, so ordering across the change breaks. Size partitions up front (see the envelope questions).

**Batching:** records accumulate per partition until \`batch.size\` (default **16 KB**, often raised to 64–256 KB) or \`linger.ms\` elapses (default 0 in 3.x, **5 ms since Kafka 4.0**). A few ms of linger can multiply throughput and cut broker request rates. Compression (\`lz4\` or \`zstd\`) typically shrinks JSON 3–5×.

**Retries and ordering:** transient errors (leader change, \`NotEnoughReplicas\`) are retried. Without idempotence, retries can **duplicate** (the broker wrote it but the ack was lost) and, with \`max.in.flight.requests.per.connection > 1\`, **reorder** batches.

**Idempotent producer** (default since Kafka 3.0): the broker assigns a **producer id (PID)**; the producer numbers each batch with a per-partition **sequence number**. The broker rejects duplicates and out-of-order sequences, so retries are safe with up to **5** in-flight requests. Scope: one producer session and one partition. It does not dedupe your application calling \`send()\` twice after a restart — that needs transactions or consumer-side idempotency.

**Delivery timeout:** \`delivery.timeout.ms\` (default 2 min) bounds total retry time; after that, the send fails and **your code** must decide (retry with an idempotent key, log, or fail the request).`,
      code: [
        {
          language: 'typescript',
          title: 'kafkajs producer: keyed, idempotent, batched',
          code: `import { Kafka, CompressionTypes, logLevel } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'order-service',
  brokers: ['kafka-0:9092', 'kafka-1:9092', 'kafka-2:9092'],
  logLevel: logLevel.WARN,
});

const producer = kafka.producer({
  idempotent: true,          // PID + sequence numbers; requires acks=-1 and <=5 in flight
  maxInFlightRequests: 5,
  allowAutoTopicCreation: false,
});
await producer.connect();

export async function publishOrderEvents(events: OrderEvent[]) {
  await producer.send({
    topic: 'orders.v1',
    acks: -1,                                  // all in-sync replicas
    compression: CompressionTypes.GZIP,        // lz4/zstd need extra codec packages in kafkajs
    messages: events.map((e) => ({
      key: e.orderId,                          // per-order ordering
      value: JSON.stringify(e),
      headers: { 'event-type': e.type, 'correlation-id': e.correlationId },
      timestamp: String(e.occurredAt),         // event time, not send time
    })),
  });
}

// Note: kafkajs is no longer actively maintained; Confluent's
// @confluentinc/kafka-javascript offers a kafkajs-compatible API on librdkafka.`,
        },
      ],
      keyPoints: [
        'Same key → same partition → ordered; adding partitions remaps keys.',
        'batch.size + linger.ms + compression drive throughput.',
        'Idempotent producer dedupes retries per partition per session — not app-level resends.',
      ],
    },
    {
      heading: 'Consumer groups and rebalancing',
      body: `**Intuition:** a consumer group is a team splitting a pile of folders (partitions). Each folder belongs to exactly one teammate. When someone joins or leaves, the team re-deals the folders — that re-deal is a *rebalance*.

**Rules:**
- Within one group, each partition is assigned to **exactly one** consumer. A consumer may own many partitions.
- **Max useful consumers = number of partitions.** 48 partitions + 60 consumers → 12 sit idle.
- Different groups are independent: \`billing\` and \`analytics\` each read every message at their own pace.
- A **group coordinator** (a broker) tracks membership via heartbeats; one member (the leader) computes assignments with the configured **assignor** in the classic protocol.

**What triggers a rebalance:** a member joins/leaves (deploy, autoscale), a member misses heartbeats for \`session.timeout.ms\` (default **45 s**), a member doesn't call poll within \`max.poll.interval.ms\` (default **5 min** — slow processing!), or the partition count changes.

**Eager vs cooperative:**
| | Eager (Range/RoundRobin, legacy) | Cooperative sticky |
|---|---|---|
| During rebalance | **everyone** revokes all partitions → stop-the-world | only partitions that move are revoked |
| Rolling deploy of 30 pods | 30 full pauses | small, incremental moves |
| Assignment stability | may reshuffle | sticky: keeps prior owners |

**Static membership** (\`group.instance.id\`): a restarting pod with the same id rejoins without triggering a rebalance, as long as it's back within \`session.timeout.ms\`. Great for StatefulSets and rolling deploys.

**The next-gen protocol (KIP-848, GA in Kafka 4.0):** the broker computes assignments and reconciles members incrementally, with no global sync barrier. Rebalances become per-member and much faster.

**Operational must-knows:**
- Keep per-poll processing well under \`max.poll.interval.ms\`, or reduce \`max.poll.records\`. Long handlers get the consumer kicked, then the partition goes to another consumer, and **both** process the batch → duplicates.
- On revocation, **commit what you've processed** (rebalance listener) to minimize replays.
- Monitor **consumer lag** per partition (Burrow, kafka-exporter, Confluent/MSK metrics).`,
      diagram: `  topic orders.v1: 6 partitions

  group "billing" (3 consumers)        group "analytics" (2 consumers)
    C1: P0 P1                            A1: P0 P1 P2
    C2: P2 P3                            A2: P3 P4 P5
    C3: P4 P5
  C4 joins billing -> cooperative-sticky moves only P5 (C3 -> C4)
  each group tracks its own offsets in __consumer_offsets`,
      code: [
        {
          language: 'typescript',
          title: 'kafkajs consumer with a sticky-style setup and safe timeouts',
          code: `const consumer = kafka.consumer({
  groupId: 'billing-service',
  sessionTimeout: 45_000,       // declared dead after 45s without heartbeats
  heartbeatInterval: 3_000,     // ~1/3 of session timeout or less
  rebalanceTimeout: 60_000,     // time members get to rejoin during a rebalance
  maxBytesPerPartition: 1_048_576,
  // kafkajs ships RoundRobin; Java/librdkafka clients use
  // partition.assignment.strategy=cooperative-sticky and group.instance.id
});

await consumer.connect();
await consumer.subscribe({ topics: ['orders.v1'], fromBeginning: false });

consumer.on(consumer.events.GROUP_JOIN, (e) =>
  logger.info({ assignment: e.payload.memberAssignment }, 'partitions assigned'));
consumer.on(consumer.events.CRASH, (e) =>
  logger.error({ err: e.payload.error }, 'consumer crashed')); // alert + let k8s restart`,
        },
      ],
      keyPoints: [
        'One partition → one consumer per group; extra consumers idle.',
        'Rebalances from deploys, missed heartbeats, or slow processing (max.poll.interval.ms).',
        'Cooperative sticky + static membership avoid stop-the-world rebalances; KIP-848 moves assignment to the broker.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 4 (consumer groups, rebalancing, coordinator)',
    },
    {
      heading: 'Offsets and commit strategies',
      body: `**Intuition:** the offset is a bookmark. Where you put the bookmark relative to *actually reading the page* decides whether a crash makes you skip pages or re-read them.

**Mechanics:** the committed offset is the **next** offset to read (last processed + 1), stored per (group, topic, partition) in the internal compacted topic \`__consumer_offsets\`. On restart or reassignment, consumption resumes from the committed offset; if none exists, \`auto.offset.reset\` (\`latest\` default, or \`earliest\`) decides.

| Strategy | How | On crash | Use |
|---|---|---|---|
| Auto-commit (default on, every 5 s) | client commits the *polled* position periodically | may **lose** (committed before processed, with async handlers) or **duplicate** (processed, not yet committed) | metrics, logs where loss is OK |
| Commit before processing | commit, then handle | **at-most-once** — loss | rarely right |
| Commit after processing (sync) | handle, then commit | **at-least-once** — duplicates up to 1 batch | default for business events |
| Commit after batch | handle N, commit last+1 | duplicates up to N | high throughput |
| Offsets stored with results | write result + offset in same DB txn | **effectively exactly-once** | sinks into a DB |
| Kafka transactions | offsets committed atomically with output records | exactly-once within Kafka | stream processing |

**The async-handler trap in Node:** with auto-commit, if \`eachMessage\` kicks off work without awaiting it, the offset advances while the work is still in flight; a crash loses it. Always **await** the processing, and commit explicitly.

**Committing out of order:** if you process a partition's messages in parallel (e.g., 100 at once), you may only commit up to the **lowest unfinished** offset. Otherwise a crash skips messages that never completed. Libraries like Confluent's Parallel Consumer track this for you.

**Resetting offsets** (replay after a bug fix): \`kafka-consumer-groups.sh --reset-offsets --to-datetime ... --execute\` with the group stopped. Replay is safe only if consumers are idempotent.`,
      code: [
        {
          language: 'typescript',
          title: 'At-least-once with explicit commits after processing (eachBatch)',
          code: `await consumer.run({
  autoCommit: false,                      // we decide when the bookmark moves
  eachBatchAutoResolve: false,
  eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale }) => {
    for (const message of batch.messages) {
      if (!isRunning() || isStale()) break; // partition revoked mid-batch: stop, don't commit

      await handleOrderEvent(JSON.parse(message.value!.toString())); // idempotent handler
      resolveOffset(message.offset);        // mark processed (local)
      await heartbeat();                    // keep membership during long batches
    }
    await commitOffsetsIfNecessary();       // commits resolved offset + 1 to Kafka
  },
});

// Equivalent manual commit for one message: the committed value is NEXT offset to read
// await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);`,
        },
      ],
      keyPoints: [
        'Committed offset = next to read; stored in __consumer_offsets.',
        'Commit after processing → at-least-once; before → at-most-once.',
        'Parallel processing within a partition can only commit up to the lowest unfinished offset.',
      ],
    },
    {
      heading: 'Ordering guarantees: what Kafka does and does not promise',
      body: `**Intuition:** Kafka promises that letters in *one* mailbox stay in order. It promises nothing about letters in different mailboxes — so put everything that must stay in order in the same mailbox, using the key.

**What is guaranteed:**
- Within a partition, records are stored and delivered **in offset order**.
- With the idempotent producer, a single producer's records to one partition stay in send order even with retries and up to 5 in-flight requests.

**What is NOT guaranteed:**
- Order across partitions (so no global order for a multi-partition topic).
- Order across **different producers** writing the same key (two service instances publishing "status changed" for the same order interleave by arrival time).
- Order after **repartitioning** (key → partition mapping changes).
- Order after your consumer parallelizes: \`partitionsConsumedConcurrently\` is fine (different partitions), but processing messages *of one partition* concurrently breaks per-key order unless you serialize per key.
- Order through retries at the application level: moving a failed message to a retry topic lets later messages for the same key overtake it (covered in the async failure-modes topic).

**Designing for order:**
1. Pick the **ordering scope** as small as the business allows — per order, per account, per user — not global. Global order means **1 partition**, i.e., ~10–50 MB/s and one consumer.
2. Use that entity id as the **key**.
3. Include a per-entity **version/sequence** in the payload so consumers can drop stale updates (\`WHERE version < $new\`) — this protects you even when upstream ordering fails.
4. Single-writer per entity where possible (the service that owns the aggregate publishes its events).

**In interviews say this:** "Ordering is per partition, so I key by the aggregate id. Consumers also check a monotonically increasing version, so a reordered or replayed event can't regress state."`,
      code: [
        {
          language: 'sql',
          title: 'Consumer-side guard: apply only newer versions (defense in depth)',
          code: `-- Projection of order status built from OrderStatusChanged events
INSERT INTO order_view (order_id, status, version, updated_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (order_id) DO UPDATE
SET status = EXCLUDED.status,
    version = EXCLUDED.version,
    updated_at = EXCLUDED.updated_at
WHERE order_view.version < EXCLUDED.version;  -- stale/replayed events are no-ops`,
        },
      ],
      keyPoints: [
        'Order is per partition only; key by the entity whose order matters.',
        'Multiple producers, repartitioning and intra-partition parallelism break order.',
        'Version checks on the consumer make ordering failures harmless.',
      ],
    },
    {
      heading: 'Delivery semantics and Kafka exactly-once',
      body: `**Intuition:** at-most-once is "send and hope", at-least-once is "keep sending until acknowledged, accept repeats", exactly-once is "at-least-once plus a way to recognise repeats" — there is no magic, only dedup somewhere.

| Semantics | Producer | Consumer | Result on failure |
|---|---|---|---|
| At-most-once | acks=0 or no retry | commit before processing | loss, no dupes |
| At-least-once | acks=all + retries | commit after processing | no loss, dupes |
| Exactly-once (Kafka to Kafka) | idempotent + **transactions** | \`isolation.level=read_committed\` | no loss, no dupes *within Kafka* |
| Effectively-once (Kafka to DB/API) | at-least-once | **idempotent sink** (unique key, upsert, offsets stored with data) | no visible dupes |

**Kafka transactions (EOS, KIP-98):**
- Producer configured with a stable \`transactional.id\`. \`initTransactions\` fences older producer instances with the same id (a zombie gets \`ProducerFenced\`) using an **epoch**, which is Kafka's built-in fencing token.
- Read-process-write loop: consume from input → produce outputs → \`sendOffsetsToTransaction\` (input offsets become part of the txn) → \`commitTransaction\`. Either outputs **and** offsets commit together, or neither.
- A **transaction coordinator** writes commit/abort markers into each partition; \`read_committed\` consumers skip aborted records and don't read past the **last stable offset**.
- Cost: extra RPCs and markers; batching many records per transaction (e.g., every 100 ms) keeps overhead to a few percent. Kafka Streams enables all of this with \`processing.guarantee=exactly_once_v2\`.

**The boundary:** EOS covers **Kafka → Kafka**. The moment you call Stripe or write Postgres, you're back to at-least-once and need idempotency (unique constraints, idempotency keys, upserts) or store offsets in the same DB transaction as the result.

**Interview line:** "Exactly-once *delivery* over a network is impossible; exactly-once *processing* is achievable with idempotence plus atomic commit of results and progress."`,
      code: [
        {
          language: 'typescript',
          title: 'kafkajs read-process-write in one transaction',
          code: `const txProducer = kafka.producer({
  transactionalId: 'payment-enricher-' + process.env.POD_ORDINAL, // stable per instance
  idempotent: true,
  maxInFlightRequests: 1,
});
await txProducer.connect();

const consumer = kafka.consumer({ groupId: 'payment-enricher', readUncommitted: false });
await consumer.subscribe({ topics: ['payments.raw.v1'] });

await consumer.run({
  autoCommit: false,
  eachBatch: async ({ batch }) => {
    const txn = await txProducer.transaction();
    try {
      const out = batch.messages.map((m) => ({ key: m.key, value: enrich(m.value!) }));
      await txn.send({ topic: 'payments.enriched.v1', messages: out });

      const last = batch.messages[batch.messages.length - 1];
      await txn.sendOffsets({                // input offsets commit atomically with output
        consumerGroupId: 'payment-enricher',
        topics: [{ topic: batch.topic, partitions: [
          { partition: batch.partition, offset: (BigInt(last.offset) + 1n).toString() },
        ] }],
      });
      await txn.commit();
    } catch (err) {
      await txn.abort();                     // outputs discarded; batch will be re-read
      throw err;
    }
  },
});`,
        },
      ],
      keyPoints: [
        'Exactly-once = at-least-once + dedup/atomic commit, never magic.',
        'Kafka transactions commit outputs and consumer offsets atomically; epochs fence zombies.',
        'Side effects outside Kafka need idempotent sinks.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 4 (delivery semantics)',
    },
    {
      heading: 'Kafka vs RabbitMQ vs SQS: picking the right broker',
      body: `**Intuition:** Kafka is a durable, replayable firehose. RabbitMQ is a smart router with per-message control. SQS is a zero-ops task queue you rent by the request.

**RabbitMQ essentials:**
- Producers publish to an **exchange**; **bindings** route to **queues**: \`direct\` (exact routing key), \`topic\` (wildcards like \`order.*.eu\`), \`fanout\` (broadcast), \`headers\`.
- Consumers **ack** each message (\`basic.ack\`), or \`nack\`/\`reject\` with requeue or dead-lettering (DLX). Unacked messages are redelivered when the channel closes.
- **Prefetch** (\`basic.qos\`) caps unacked messages per consumer: too high → one consumer hoards messages and memory; too low → idle waiting on RTT. 10–300 is typical.
- **Quorum queues** (Raft-replicated) are the durable choice today; classic mirrored queues are deprecated and removed in 4.0. **Streams** add Kafka-like replayable logs.
- Throughput: roughly tens of thousands of msgs/s per queue; a queue lives on one node, so scale by more queues.

**Amazon SQS essentials:**
- **Standard:** near-unlimited throughput, **at-least-once**, best-effort ordering.
- **FIFO:** ordered per **MessageGroupId**, deduplication within a **5-minute** window (\`MessageDeduplicationId\` or content hash). 300 API calls/s per action (3,000 msgs/s with batches of 10); high-throughput mode raises this substantially.
- **Visibility timeout** (default **30 s**, max **12 h**): a received message is hidden, and reappears if not deleted in time → another consumer gets it. Extend with \`ChangeMessageVisibility\` for long jobs.
- Retention **4 days** default (1 min–14 days); **long polling** up to 20 s; redrive policy (\`maxReceiveCount\`) to a DLQ; payloads up to 256 KB historically (AWS raised the limit to 1 MiB in 2025), larger payloads go through S3 pointers.

| | Kafka | RabbitMQ | SQS |
|---|---|---|---|
| Model | partitioned log | exchanges + queues | managed queue |
| Retention/replay | days–forever, replay by offset | until acked (Streams: replay) | ≤14 days, no replay |
| Ordering | per partition | per queue (single consumer) | FIFO per group |
| Throughput | millions msg/s per cluster | ~10K–100K msg/s per node | standard: virtually unlimited |
| Routing | by topic/key only | rich (topic, headers) | none (use SNS filters) |
| Per-message retry/delay | build it (retry topics) | DLX, TTL, delayed plugin | native (visibility, DelaySeconds up to 15 min, DLQ) |
| Ops | heavy (or MSK/Confluent) | medium | none |
| Best for | event streaming, fan-out, CDC, analytics | task routing, RPC-ish workflows | AWS background jobs |`,
      code: [
        {
          language: 'typescript',
          title: 'RabbitMQ (amqplib) consumer with prefetch, manual ack and DLX',
          code: `import amqp from 'amqplib';

const conn = await amqp.connect(process.env.AMQP_URL!);
const ch = await conn.createChannel();

await ch.assertExchange('orders', 'topic', { durable: true });
await ch.assertExchange('orders.dlx', 'fanout', { durable: true });
await ch.assertQueue('email.order-confirmations', {
  durable: true,
  arguments: {
    'x-queue-type': 'quorum',               // Raft-replicated, durable
    'x-dead-letter-exchange': 'orders.dlx', // rejected messages go here
    'x-delivery-limit': 5,                  // quorum queues: dead-letter after 5 redeliveries
  },
});
await ch.bindQueue('email.order-confirmations', 'orders', 'order.placed.*');

await ch.prefetch(50);                      // at most 50 unacked messages per consumer
await ch.consume('email.order-confirmations', async (msg) => {
  if (!msg) return;
  try {
    await sendConfirmation(JSON.parse(msg.content.toString()));
    ch.ack(msg);
  } catch (err) {
    ch.nack(msg, false, !(err instanceof PermanentError)); // requeue transient, DLX permanent
  }
}, { noAck: false });`,
        },
      ],
      keyPoints: [
        'Kafka for replayable, high-throughput streams; RabbitMQ for routing and per-message control; SQS for zero-ops queues.',
        'RabbitMQ prefetch bounds unacked work; quorum queues for durability.',
        'SQS visibility timeout must exceed processing time, or extend it.',
      ],
    },
    {
      heading: 'Event-driven architecture: events, commands and contracts',
      body: `**Intuition:** a command is "please do X" addressed to someone; an event is "X happened", announced to whoever cares. Events let producers stop knowing about consumers — which is the whole point, and also the whole danger.

**Message kinds:**
| Kind | Example | Coupling | Typical channel |
|---|---|---|---|
| Command | \`ChargeCard\` | sender knows the receiver | queue (one consumer) |
| Event notification | \`OrderPlaced { orderId }\` | thin; consumers call back for details | topic |
| Event-carried state transfer | \`OrderPlaced { full order }\` | consumers keep local copies, no callbacks | topic (often compacted) |
| Event sourcing | the event log *is* the source of truth | strongest; replay rebuilds state | log with long retention |

**Choreography vs orchestration:** with choreography, services react to each other's events (simple, but the flow is implicit and hard to trace). With orchestration, a coordinator (workflow engine or saga orchestrator) sends commands (explicit, easier to monitor). Sagas themselves are covered in the distributed transactions topic.

**Contracts are the API:**
- Use a **schema registry** (Avro/Protobuf/JSON Schema) with compatibility rules (BACKWARD by default in Confluent): add optional fields; never rename or retype.
- Version topics for breaking changes (\`orders.v1\` → \`orders.v2\`, run both during migration).
- Standard envelope: \`eventId\` (dedup), \`eventType\`, \`occurredAt\` (event time), \`aggregateId\` + \`version\` (ordering), \`correlationId\`/\`traceparent\` (tracing), \`schemaVersion\`.

**The dual-write problem:** "save to DB, then publish to Kafka" loses events when the publish fails after commit, or publishes phantom events when the commit fails after publish. The fix is the **transactional outbox** (or CDC), covered in the data pipelines topic.

**Anti-patterns:** events that are really RPC (\`GetUserRequested\`, then waiting for a reply); god-events with 200 fields; consumers depending on field order or undocumented fields; no owner per topic.`,
      code: [
        {
          language: 'protobuf',
          title: 'Event envelope with ids for dedup, ordering and tracing',
          code: `syntax = "proto3";
package orders.v1;

import "google/protobuf/timestamp.proto";

message OrderPlaced {
  string event_id = 1;                         // UUID: consumers dedupe on this
  string order_id = 2;                         // Kafka key: per-order ordering
  int64 aggregate_version = 3;                 // monotonic per order: drop stale updates
  google.protobuf.Timestamp occurred_at = 4;   // event time (not publish time)
  string correlation_id = 5;                   // ties the request across services
  string customer_id = 6;
  repeated LineItem items = 7;
  int64 total_minor_units = 8;                 // money as integer minor units
  string currency = 9;
  // New fields must be optional with new tag numbers; never reuse or renumber tags.
}

message LineItem {
  string sku = 1;
  int32 quantity = 2;
  int64 unit_price_minor_units = 3;
}`,
        },
      ],
      keyPoints: [
        'Commands target one receiver; events announce facts to many.',
        'Schema registry + compatibility rules make events a safe public API.',
        'Never dual-write DB + broker; use an outbox or CDC.',
      ],
      source: 'Confluent Schema Registry docs; Alex Xu — System Design Interview Vol 2, Ch 4',
    },
    {
      heading: 'AWS messaging compared: SQS vs SNS vs EventBridge vs Kinesis',
      body: `**Intuition:** SQS is a pile of work tickets that one worker at a time takes from. SNS is a megaphone that pushes a copy to everyone subscribed. EventBridge is a mail room that opens each envelope, reads the content and routes it by rules. Kinesis is a tape recorder: one ordered tape per shard, and every reader can rewind its own playback head.

**The four models in one table** (default quotas, us-east-1, checked against the AWS quota pages in 2026; most are soft limits you can raise):

| | SQS | SNS | EventBridge (rule bus) | Kinesis Data Streams |
|---|---|---|---|---|
| Model | queue, competing consumers | pub/sub push fan-out | event bus + content-based rules | sharded, append-only stream |
| Consumers | pull (long poll ≤ 20 s), message deleted after processing | pushed to SQS, Lambda, HTTP(S), email, SMS, mobile, Firehose | ≤ 5 targets per rule, 300 rules per bus | pull per shard (GetRecords) or push via enhanced fan-out |
| Ordering | standard: best effort; FIFO: per \`MessageGroupId\` | standard: none; FIFO topic: per group (SQS subscribers only) | none | strict per shard (partition key → shard) |
| Retention / replay | 1 min–14 days (4 d default); no replay once deleted | none on standard; FIFO topics can archive and replay | archive + replay to the same bus | 24 h default, up to 365 days; replay from a sequence number or timestamp |
| Throughput | standard: nearly unlimited; FIFO 300 calls/s per action (3,000 msg/s batched), high-throughput FIFO up to 70K calls/s | 30K publishes/s per account; FIFO 300 msg/s per group | PutEvents 10K requests/s; 18,750 target invocations/s | per shard 1 MB/s or 1,000 records/s in, 2 MB/s out; on-demand scales to 10 GB/s |
| Max payload | 1 MiB | 256 KiB default, 1 MiB configurable | small JSON events (use claim-check for big data) | 10 MiB record |
| Delivery | at-least-once (FIFO dedups within 5 min) | at-least-once, retried per delivery policy, then subscription DLQ | at-least-once, retries up to 24 h / 185 attempts, then target DLQ | at-least-once; producer retries can duplicate records |

**What each one is really for:**
- **SQS** buffers work for one logical consumer: back-pressure, visibility timeout, DLQ redrive. It has no routing and no fan-out on its own.
- **SNS** copies one message to many endpoints with subscription **filter policies** (≤ 200 per topic). It stores nothing for standard topics, so a subscriber that is down needs a queue in front of it.
- **EventBridge** routes JSON events by content patterns (prefix, numeric ranges, \`anything-but\`, \`exists\`, wildcards) across accounts and from 200+ AWS and SaaS sources. Its **schema registry** discovers event shapes and generates typed bindings. It also offers **Pipes** (source → filter → enrich → target) and **Scheduler**. Latency is higher than SNS (often hundreds of ms), and there is no ordering. AWS docs now also describe a newer Custom Event Bus with subscribers and stored retention (1–365 days); in interviews, "EventBridge" still usually means the classic rules-and-targets bus.
- **Kinesis** is the closest thing to Kafka on AWS: shards ≈ partitions, partition key ≈ message key, sequence number ≈ offset, and the KCL lease table in DynamoDB ≈ a consumer group's committed offsets. Enhanced fan-out gives each registered consumer its own 2 MB/s per shard instead of sharing it.

**Typical combinations:**
1. **SNS → SQS fan-out.** Each consuming service owns its queue, so it gets its own buffer, retry pace and DLQ, and a slow consumer never delays the others. Turn on raw message delivery to skip the SNS JSON envelope.
2. **EventBridge → SQS → worker.** Rules do the routing; the queue absorbs bursts and protects a rate-limited consumer. Common for SaaS webhooks and cross-account events.
3. **Kinesis → Lambda.** The event source mapping polls each shard in batches (up to 10 concurrent batches per shard with \`ParallelizationFactor\`, while ordering is kept per partition key). Without bisect-on-error, a bounded retry count and an on-failure destination, one poison record blocks its shard until it expires.
4. **Kinesis → Firehose → S3** for the data lake; **DynamoDB Streams → Pipes → EventBridge** for change events.

**Mapping to Kafka and RabbitMQ:** SQS ≈ a RabbitMQ quorum queue without exchanges. SNS ≈ a fanout or topic exchange that stores nothing. EventBridge ≈ a managed headers/topic exchange with a schema registry. Kinesis ≈ a small-partition Kafka: 1 MB/s per shard is far below a Kafka partition, there is no log compaction, and retention stops at 365 days. If you need Kafka semantics such as compaction, transactions or Kafka Connect, use **MSK**.

**Decision table:**

| Need | Pick |
|---|---|
| Background jobs, one consumer type, retries + DLQ | SQS standard |
| Per-entity ordering, low volume, exactly-once processing window | SQS FIFO (group = entity id) |
| Same message to N internal services, each at its own pace | SNS → SQS per service |
| Route by content across accounts, SaaS sources, many rule owners | EventBridge (+ SQS in front of fragile targets) |
| High-volume ordered stream, several independent readers, replay | Kinesis (or MSK) |
| Compaction, exactly-once stream processing, Kafka ecosystem | MSK |

**In interviews say this:** "SQS is a buffer, SNS is a copier, EventBridge is a router and Kinesis is a log. I combine them by role: route or fan out first, then put a queue in front of each consumer that needs its own retries."`,
      diagram: `   producer                         producer                 producer
      |                                |                        |
      v                                v                        v
 +---------+   +-----------+     +-------------+        +-----------------+
 |  SNS    |-->| SQS email |     | EventBridge |        | Kinesis stream  |
 |  topic  |-->| SQS fraud |     |  bus        |        | shard-0 [1 2 3] |
 |         |-->| SQS search|     |  rule A ----+-> SQS  | shard-1 [1 2]   |
 +---------+   +-----------+     |  rule B ----+-> SFN  +-----------------+
  push copies   each consumer    |  rule C ----+-> API    ^ reader A @ seq 3
  (no storage)  owns buffer+DLQ  +-------------+        ^ reader B @ seq 1
                                 content-based routing   replay by position`,
      code: [
        {
          language: 'typescript',
          title: 'AWS SDK v3: SNS→SQS subscription with a filter, EventBridge event, Kinesis keyed write',
          code: `import { SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { KinesisClient, PutRecordsCommand } from '@aws-sdk/client-kinesis';

const sns = new SNSClient({});
const eb = new EventBridgeClient({});
const kinesis = new KinesisClient({});

// 1) Fan-out: the fraud queue only receives high-value orders.
//    (The queue's access policy must allow sns.amazonaws.com with aws:SourceArn = topic ARN.)
await sns.send(new SubscribeCommand({
  TopicArn: process.env.ORDERS_TOPIC_ARN,
  Protocol: 'sqs',
  Endpoint: process.env.FRAUD_QUEUE_ARN,
  Attributes: {
    RawMessageDelivery: 'true', // consumer gets the body, not the SNS JSON envelope
    FilterPolicyScope: 'MessageBody',
    FilterPolicy: JSON.stringify({ totalMinor: [{ numeric: ['>=', 5000000] }] }),
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: process.env.FRAUD_SUB_DLQ_ARN }),
  },
}));

// 2) Router: rules on the bus decide who gets it (partners, audit, workflows).
const res = await eb.send(new PutEventsCommand({
  Entries: [{
    EventBusName: 'commerce',
    Source: 'orders.service',
    DetailType: 'OrderPlaced',
    Detail: JSON.stringify({ orderId: 'o-981', market: 'IN', totalMinor: 7200000 }),
  }],
}));
if (res.FailedEntryCount) throw new Error('retry the failed entries only'); // partial failure is per entry

// 3) Log: the partition key pins every event of one order to one shard (ordering + replay).
const out = await kinesis.send(new PutRecordsCommand({
  StreamName: 'order-events',
  Records: [{ PartitionKey: 'o-981', Data: Buffer.from(JSON.stringify({ type: 'OrderPlaced', v: 1 })) }],
}));
console.log('failed records', out.FailedRecordCount); // also per record: resend only those`,
        },
      ],
      keyPoints: [
        'SQS buffers, SNS copies, EventBridge routes by content, Kinesis keeps an ordered, replayable log per shard.',
        'Put an SQS queue in front of every consumer that needs its own pace, retries and DLQ (SNS→SQS, EventBridge→SQS).',
        'Kinesis ≈ Kafka with small partitions: 1 MB/s or 1,000 records/s in per shard, retention up to 365 days, no compaction.',
        'Every option is at-least-once by default, so consumers stay idempotent; batch APIs fail per entry.',
      ],
      source: 'AWS docs: SQS message quotas, SNS quotas and FIFO topics, EventBridge quotas and archive/replay, Kinesis Data Streams quotas (2026); ByteByteGo — SQS vs SNS vs EventBridge vs Kinesis (2025)',
    },
  ],
  codeChallenges: [
    {
      id: 'mq-fundamentals-cc-1',
      title: 'Fix the order-events consumer that loses and duplicates messages',
      context: `A NestJS billing service consumes \`orders.v1\` (24 partitions) with kafkajs. Symptoms: after pod OOM kills some invoices are **never created**; after deploys some invoices are **created twice**; and during Black Friday the group went into a **rebalance loop** because some batches took minutes.`,
      task: 'Make consumption at-least-once with no silent loss, harmless duplicates, bounded processing time per poll and a clean shutdown on deploys.',
      starter: {
        language: 'typescript',
        title: 'billing.consumer.ts (buggy)',
        code: `const consumer = kafka.consumer({ groupId: 'billing' });

export async function start() {
  await consumer.connect();
  await consumer.subscribe({ topics: ['orders.v1'], fromBeginning: true });

  await consumer.run({
    // autoCommit defaults to true (every 5s / on batch resolve)
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value!.toString()); // throws on bad JSON
      // fire-and-forget so we "go faster"
      createInvoice(event).catch((e) => console.error(e));
    },
  });
}

async function createInvoice(event: any) {
  const lines = await pricing.fetchAll(event.items); // unbounded, can take minutes
  await db.query('INSERT INTO invoices (order_id, total) VALUES ($1, $2)',
    [event.orderId, lines.total]);
}`,
      },
      hints: [
        'When does the offset get committed relative to createInvoice finishing? What happens if the pod dies in between?',
        'A redelivered event will call INSERT again. What would make the second insert harmless?',
        'What happens to group membership when one call takes longer than max.poll.interval / the rebalance timeout? How do you keep heartbeats flowing and bound the work?',
      ],
      solution: {
        language: 'typescript',
        title: 'billing.consumer.ts (fixed)',
        code: `const consumer = kafka.consumer({
  groupId: 'billing',
  sessionTimeout: 45_000,
  heartbeatInterval: 3_000,
  maxBytesPerPartition: 512 * 1024,        // smaller fetches -> shorter batches
});

export async function start() {
  await consumer.connect();
  await consumer.subscribe({ topics: ['orders.v1'], fromBeginning: false });

  await consumer.run({
    autoCommit: false,
    eachBatchAutoResolve: false,
    partitionsConsumedConcurrently: 4,     // parallel across partitions, ordered within one
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale }) => {
      for (const message of batch.messages) {
        if (!isRunning() || isStale()) break;          // revoked: stop without committing
        let event: OrderPlaced;
        try {
          event = JSON.parse(message.value!.toString());
        } catch {
          await sendToDlq(batch.topic, batch.partition, message, 'bad-json'); // poison pill
          resolveOffset(message.offset);
          continue;
        }
        await createInvoice(event, AbortSignal.timeout(20_000)); // awaited + bounded
        resolveOffset(message.offset);                 // processed -> safe to commit
        await heartbeat();                             // stay in the group on long batches
      }
      await commitOffsetsIfNecessary();                // commit AFTER processing
    },
  });

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, async () => { await consumer.disconnect(); process.exit(0); }); // leave group cleanly
  }
}

async function createInvoice(event: OrderPlaced, signal: AbortSignal) {
  const lines = await pricing.fetchAll(event.items, { signal });
  // Idempotent: UNIQUE(order_id) turns redelivery into a no-op
  await db.query(
    'INSERT INTO invoices (order_id, total, source_event_id) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (order_id) DO NOTHING',
    [event.orderId, lines.total, event.eventId]);
}`,
      },
      explanation: `**Fixes**
- **Silent loss:** the handler returned immediately (fire-and-forget), so auto-commit advanced offsets for invoices still in flight. An OOM lost them forever. Now processing is **awaited** and offsets are committed **after** it completes (at-least-once).
- **Duplicates:** at-least-once plus rebalances means redelivery. \`UNIQUE(order_id)\` with \`ON CONFLICT DO NOTHING\` makes the handler idempotent, so a duplicate does no harm.
- **Rebalance loop:** unbounded pricing calls kept a batch running past the rebalance/poll deadlines, so the member was kicked, its partitions moved, and the next owner re-processed the same batch. Fixes: a per-call timeout, a heartbeat after each message, smaller fetches, and \`isStale()\` checks to stop work on revoked partitions.
- **Poison pill:** bad JSON threw inside \`eachMessage\`, and kafkajs retried the same message forever, blocking the partition. It now goes to a DLQ with context and the consumer moves on.
- **\`fromBeginning: true\`** on a new group would re-bill the whole retained history; use \`false\` and replay deliberately with offset resets.
- **Graceful shutdown:** disconnecting on SIGTERM leaves the group immediately, so the rebalance happens right away instead of after a 45 s session timeout, and no half-processed batch is committed.
- \`partitionsConsumedConcurrently\` adds throughput without breaking per-partition order.`,
      followUps: [
        {
          "q": "createInvoice also sends an email to the customer. Your DB dedupe makes the invoice idempotent; what about the email on redelivery?",
          "a": "The upsert dedupes the DB row, but the email is a separate side effect that would go out twice. Options: make the email a consequence of the invoice commit, by writing an outbox row in the same transaction as the invoice (inside the INSERT branch only, so `ON CONFLICT DO NOTHING` returns no row and skips it), with a separate relay sending emails keyed by invoice id; or pass an idempotency key (`invoice-<orderId>`) to the email provider if it supports dedupe. Never send directly inside the consumer after the DB write: a crash between the two steps gives a duplicate or lost email."
        },
        {
          "q": "How do you test the rebalance and crash behaviour of this consumer before Black Friday?",
          "a": "Integration test against a real Kafka (Testcontainers). (1) Produce 1,000 orders, kill the consumer with SIGKILL mid-batch, restart, and assert exactly 1,000 invoice rows: no loss, and duplicates absorbed by the unique key. (2) Inject a 30 s delay in pricing with Toxiproxy and assert the call aborts at 20 s, the member is not evicted, and no rebalance appears in the logs. (3) Send malformed JSON and assert it lands in the DLQ and the partition keeps moving. (4) Scale from 2 to 4 consumers during load and assert no duplicates beyond the committed window. Then run a load test at 2× expected peak, tracking lag and rebalance counts."
        }
      ],
    },
    {
      id: 'mq-fundamentals-cc-2',
      title: 'Harden a producer that publishes wallet balance events',
      context: `A wallet service publishes \`BalanceChanged\` events that downstream ledgers apply **in order per wallet**. Incidents: a ledger showed a withdrawal applied before the deposit that funded it; events vanished during a broker restart; and producer CPU plus broker request rate are very high at 20K events/s.`,
      task: 'Rewrite the producer so per-wallet order is preserved, acknowledged events survive a single broker failure, retries cannot duplicate or reorder, and throughput is efficient.',
      starter: {
        language: 'typescript',
        title: 'wallet.publisher.ts (buggy)',
        code: `const producer = kafka.producer({
  idempotent: false,
  maxInFlightRequests: 10,
  retry: { retries: 10 },
});

export async function onBalanceChanged(change: BalanceChange) {
  await db.query('UPDATE wallets SET balance = $1 WHERE id = $2',
    [change.newBalance, change.walletId]);

  // one network request per event, no key
  producer.send({
    topic: 'wallet.balance.v1',
    acks: 1,
    messages: [{ value: JSON.stringify(change) }],
  }); // not awaited: errors are unhandled rejections
}`,
      },
      hints: [
        'Without a key, where do two events for the same wallet land? What does that mean for order?',
        'What can happen with 10 in-flight requests and retries when idempotence is off? And what does acks=1 promise when a leader dies?',
        'Sending one message per request is expensive. How can the producer batch while still failing loudly? Also think about what happens if the DB commits but the publish fails.',
      ],
      solution: {
        language: 'typescript',
        title: 'wallet.publisher.ts (fixed)',
        code: `const producer = kafka.producer({
  idempotent: true,             // PID + sequence: retries can't duplicate or reorder
  maxInFlightRequests: 5,       // max allowed with idempotence while keeping order
  allowAutoTopicCreation: false,
  retry: { retries: 8, initialRetryTime: 100, maxRetryTime: 5_000 },
});
await producer.connect();

// Topic created with RF=3, min.insync.replicas=2 (see topic config section).
// The DB write and the event are tied by an outbox row in the same transaction;
// this relay publishes outbox rows in commit order.
export async function relayOutboxBatch(): Promise<number> {
  const { rows } = await db.query(
    'SELECT id, wallet_id, payload FROM outbox WHERE published_at IS NULL ' +
      'ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED');
  if (rows.length === 0) return 0;

  await producer.send({
    topic: 'wallet.balance.v1',
    acks: -1,                                   // all ISR (>= 2) before success
    compression: CompressionTypes.GZIP,
    messages: rows.map((r) => ({
      key: r.wallet_id,                         // same wallet -> same partition -> ordered
      value: r.payload,                         // includes walletVersion for consumer guards
      headers: { 'event-id': String(r.id) },    // consumers dedupe on this
    })),
  });                                           // awaited: failures throw, rows stay unpublished

  await db.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1)',
    [rows.map((r) => r.id)]);
  return rows.length;
}`,
      },
      explanation: `**Fixes**
- **Out-of-order ledger:** no key meant events for one wallet were spread across partitions with no relative order. Keying by \`walletId\` puts them all in one partition.
- **Reordering and duplicates on retry:** with idempotence off and 10 in-flight requests, a failed batch retried after a later batch had succeeded lands out of order, and a lost ack leads to a duplicate. The idempotent producer (≤5 in flight) fixes both within a producer session.
- **Lost events:** \`acks=1\` acknowledges once only the leader has the write; if that leader dies before followers copy it, the event is gone. \`acks=-1\` with RF=3 and min.insync=2 survives one broker failure.
- **Unawaited send:** errors became unhandled rejections and the event was silently dropped. Now the send is awaited and failures leave outbox rows for retry.
- **Dual write:** the DB update and the publish were not atomic. The transactional outbox (row written in the same transaction as the balance update, relayed in id order) guarantees every committed change is eventually published. Consumers dedupe by event id and apply only when \`walletVersion\` is newer.
- **Throughput:** 500-message batches with compression replace one request per event, cutting broker request rate by around 100–500× at 20K events/s.`,
      followUps: [
        {
          "q": "The relay runs as 3 replicas for availability. Does SKIP LOCKED break per-wallet ordering?",
          "a": "Yes, it can. Replica A locks rows 1–500 and replica B grabs 501–1000; if B publishes first, a wallet's later event can reach Kafka before its earlier one. Fixes: run a single active relay via leader election (an advisory lock such as `pg_try_advisory_lock`) with the others on standby, which is the simplest and fast enough for tens of thousands of rows/s with batching; or shard the relay by `hash(wallet_id) % N` so each wallet always goes through one relay; or use Debezium CDC, which reads the WAL in commit order. Consumers should still guard with `walletVersion` as defence in depth."
        },
        {
          "q": "The UPDATE marking rows published fails after producer.send succeeded. What happens, and is that acceptable?",
          "a": "The rows stay unpublished, so the next relay run sends them again: Kafka gets a second copy with the same `event-id` header. The producer's idempotence does not help, since this is a new send, not an internal retry. That is the at-least-once contract of the outbox, and it is acceptable because consumers dedupe on `event-id` and apply only when `walletVersion` is newer than the stored version. To shrink the window, keep batches small and alert on relay errors. To avoid even that, use transactions or accept the duplicates. Never mark rows as published before the send."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'mq-fundamentals-iq-01',
      difficulty: 'expert',
      question:
        'A broker hosting the leader for a busy partition dies mid-traffic. Walk me through exactly what happens to producers, consumers and data — first with acks=1, then with acks=all and min.insync.replicas=2. When can acknowledged data be lost?',
      whatInterviewerLooksFor: [
        'Accurate ISR / high-watermark reasoning',
        'Knows the controller elects a new leader from the ISR, and what unclean election means',
        'Distinguishes producer-visible errors from silent loss',
        'Mentions client metadata refresh and the retry path',
        'Knows the failure-domain (rack/AZ) placement',
      ],
      modelAnswer: `### Detection and election
- In KRaft, the active controller notices the broker's heartbeats stop (broker session timeout, ~9 s by default in KRaft) or a controlled shutdown request arrives. It picks a new leader for each affected partition **from the ISR** and publishes the metadata change.
- Producers and consumers get \`NOT_LEADER_OR_FOLLOWER\` / connection errors, refresh metadata and reconnect to the new leader. There is typically a few seconds of elevated latency; producers buffer and retry within \`delivery.timeout.ms\`.

### acks=1
- The leader acked records it had written locally. Followers might be up to \`replica.lag.time.max.ms\` behind.
- If the new leader lacks the last N records, those **acked records are lost**. The old leader truncates them when it rejoins as a follower.
- Consumers never saw them, because they were above the high watermark. The loss is silent from the consumer's view.

### acks=all, min.insync=2, RF=3
- The ack is sent only once every ISR member has the record, and the ISR has at least 2 members. The new leader comes from the ISR, so it has every acked record: **no acked loss**.
- If a second replica is also down, the ISR drops to 1 and writes get \`NotEnoughReplicas\`. The partition is unavailable for writes rather than unsafe. Reads up to the HW continue.

### When acked data can still be lost
1. \`unclean.leader.election.enable=true\` and all ISR members die, so an out-of-sync replica becomes leader.
2. min.insync=1 with acks=all: the ISR can shrink to just the leader, so "all" means one.
3. Correlated failure of every ISR replica before data reached disk, since Kafka acks from page cache. Rack/AZ-aware placement (\`broker.rack\`) makes this very unlikely.

### Operational signals
\`UnderReplicatedPartitions\`, \`UnderMinIsrPartitionCount\`, \`OfflinePartitionsCount\` (should be 0), ISR shrink/expand rates.`,
      followUps: [
        {
          q: 'Why not fsync every message to be safe?',
          a: 'It would cut throughput dramatically. Kafka relies on replication across failure domains instead; the chance that 2–3 AZs lose power before flushing is far lower than a single-disk failure. flush.messages exists but is rarely used.',
        },
        {
          q: 'What does a consumer see during the failover?',
          a: 'Fetch errors, a metadata refresh, then it resumes from its position against the new leader. It never saw records above the high watermark, so it sees no rewinds of committed data.',
        },
        {
          q: 'Why RF=3 and not 2?',
          a: 'With RF=2 and min.insync=2, any single broker failure blocks writes; with min.insync=1 you risk loss. RF=3 with min.insync=2 tolerates one failure with both safety and availability.',
        },
      ],
      pitfalls: [
        'Believing acks=all means "all replicas" rather than "all current ISR"',
        'Thinking consumers can read data that is not yet replicated',
        'Ignoring unclean leader election',
      ],
    },
    {
      id: 'mq-fundamentals-iq-02',
      difficulty: 'hard',
      question:
        'We need messaging for three things: (1) sending transactional emails and SMS, (2) an order event stream consumed by ~20 teams including analytics and search indexing, (3) routing support tickets to regional teams by product and priority. Which broker(s) would you pick and why?',
      whatInterviewerLooksFor: [
        'Matches the semantics (queue vs log vs routing) to each use case',
        'Considers operational cost and team skills',
        'Knows the concrete features: visibility timeout, DLQ, retention, exchanges',
        'Is willing to use more than one tool, or justifies consolidating',
      ],
      modelAnswer: `### (1) Emails/SMS — a work queue
- Each message is a **task** for one worker, with per-message retries, delays and a DLQ. No replay needed.
- **SQS** (on AWS): zero ops, virtually unlimited throughput, visibility timeout, \`DelaySeconds\` up to 15 min, redrive to a DLQ after \`maxReceiveCount\`. Provider rate limits (for example Twilio) are handled by capping consumer concurrency.
- On-prem: RabbitMQ quorum queue with a DLX. Kafka works but you'd hand-build retry and delay topics.

### (2) Order stream for 20 teams — a log
- Needs **fan-out to many independent consumers**, **replay** (search reindex, a new team backfilling), high throughput and per-order ordering → **Kafka** (MSK/Confluent if we don't want to run it).
- Key by \`orderId\`, RF=3, min.insync=2, retention 7–30 days (or tiered storage), Protobuf/Avro with a schema registry, one consumer group per team.
- An SNS→SQS fan-out would give 20 queues but no replay and no shared ordering.

### (3) Ticket routing — content-based routing
- **RabbitMQ topic exchange**: routing keys like \`ticket.billing.p1.eu\`, with regional queues binding \`ticket.*.*.eu\` and a pager queue binding \`ticket.*.p1.*\`. Priority queues are available if needed.
- Alternatively SNS with subscription filter policies into SQS queues.

### Consolidation trade-off
Running three systems costs on-call and expertise. A pragmatic answer: Kafka for (2), SQS for (1) and (3) with SNS filter policies, all managed. For a small team, Kafka alone with retry topics is viable but costs engineering time on retry and delay mechanics.`,
      followUps: [
        {
          q: 'Emails must never be sent twice. Which broker guarantees that?',
          a: 'None of them end to end. SQS FIFO dedupes sends within 5 minutes, but redelivery after a visibility timeout can still double-send. Use an idempotency key per notification stored before calling the provider, and pass it to the provider if supported.',
        },
        {
          q: 'Analytics wants 2 years of order events. Keep them in Kafka?',
          a: 'Use tiered storage (KIP-405, GA in 3.9) to offload old segments to S3, or sink to a lakehouse (Iceberg/Delta) and keep Kafka retention at around 7–30 days. Long history for SQL analytics belongs in the lake.',
        },
      ],
      pitfalls: [
        'Using Kafka for everything without discussing retries and delays',
        'Using SQS for fan-out plus replay',
        'Ignoring operational cost',
      ],
    },
    {
      id: 'mq-fundamentals-iq-03',
      difficulty: 'expert',
      question:
        'Your product manager read that "Kafka supports exactly-once". Explain precisely what that guarantee covers, how it works, and how you would achieve exactly-once effects for a consumer that updates Postgres and calls a payment API.',
      whatInterviewerLooksFor: [
        'Separates delivery from processing semantics',
        'Explains the idempotent producer, transactions, sendOffsetsToTransaction and read_committed',
        'Knows the boundary: Kafka to Kafka only',
        'Gives concrete patterns for DB and API sinks',
        'Mentions zombie fencing via transactional.id and epochs',
      ],
      modelAnswer: `### What Kafka EOS covers
Exactly-once **processing within Kafka**: for a read-process-write app, each input record's effect appears in the output topics exactly once, and the input offsets advance atomically with those outputs.

### How
1. **Idempotent producer:** a PID plus a per-partition sequence number lets the broker drop duplicate or out-of-order retries.
2. **Transactions:** a producer with a \`transactional.id\` starts a txn, writes to many partitions, adds the consumer offsets with \`sendOffsetsToTransaction\`, then commits. The transaction coordinator writes commit/abort **markers**.
3. **Zombie fencing:** \`initTransactions\` bumps the **epoch** for that transactional.id, so an old instance still running gets \`ProducerFenced\`.
4. **read_committed consumers** skip aborted data and read only up to the last stable offset.
Kafka Streams wraps this as \`processing.guarantee=exactly_once_v2\`.

### What it does not cover
Anything outside Kafka: Postgres writes, emails, payment APIs. If the consumer writes to Postgres and then crashes before committing the offset, Kafka redelivers and the DB write happens again.

### Exactly-once effects for Postgres
- **Store offsets in the DB** in the same transaction as the business write (a \`consumer_offsets(group, topic, partition, offset)\` table). On startup, seek to the stored offsets. The effect and the progress are atomic.
- Or **idempotent writes**: upserts keyed by event id / natural key, and \`processed_events(event_id PK)\` inserted in the same transaction.

### For the payment API
- Derive an **idempotency key** from the event (e.g., \`payment:\${orderId}\`), persist \`PENDING\` first, and call the PSP with that key. Redelivery repeats the call and the PSP returns the original result.
- Conditional state transitions (\`PENDING → SUCCEEDED\`) make webhook-and-response races harmless.

### Summary for the PM
"Messages can be delivered more than once; we make processing them more than once harmless. Kafka does that for us inside Kafka; for the DB and payments we do it with keys and constraints."`,
      followUps: [
        {
          q: 'What is the cost of Kafka transactions?',
          a: 'Extra coordinator round-trips per transaction and marker records per partition. With transactions committed every ~100 ms over many records, throughput overhead is a few percent, but end-to-end latency rises to at least the commit interval for read_committed consumers.',
        },
        {
          q: 'A producer begins a transaction and hangs. What do read_committed consumers see?',
          a: 'They stall at the last stable offset for those partitions until the transaction is committed, aborted, or times out (transaction.timeout.ms, default 60s). Lag grows even though data is flowing.',
        },
      ],
      pitfalls: [
        'Claiming Kafka EOS makes the DB write exactly-once',
        'Confusing the idempotent producer with end-to-end dedup',
        'Forgetting zombie fencing',
      ],
    },
    {
      id: 'mq-fundamentals-iq-04',
      difficulty: 'hard',
      question:
        'Design the Kafka topic layout for an e-commerce order domain: order lifecycle events, current order state for other services, and a high-volume clickstream. Cover keys, partition counts, retention, compaction and schemas.',
      whatInterviewerLooksFor: [
        'Chooses keys by ordering needs',
        'Sizes partitions with a throughput-based method and headroom',
        'Uses compaction for state and time retention for events',
        'Covers schema evolution and naming/versioning',
      ],
      modelAnswer: `### Topics
| Topic | Key | Partitions | Cleanup | Why |
|---|---|---|---|---|
| \`orders.events.v1\` (OrderPlaced, Paid, Shipped...) | orderId | 48 | delete, 14 days | per-order ordering; replay window for consumers |
| \`orders.state.v1\` (latest order snapshot) | orderId | 48 | **compact** | new services bootstrap current state without replaying history; tombstone on GDPR delete |
| \`clickstream.v1\` | sessionId (or null) | 192 | delete, 3 days, then S3 sink | high volume; ordering only per session |
| \`orders.events.dlq.v1\` | orderId | 6 | delete, 30 days | poison messages with error headers |

### Partition sizing
partitions ≥ max(target throughput ÷ per-partition producer throughput, target ÷ per-consumer throughput), times 2–3× growth headroom. Example: orders at 5K events/s peak with a consumer handling ~500/s → 10 partitions minimum; 48 gives headroom for heavier consumers and years of growth. Because **increasing partitions remaps keys**, over-provision modestly up front. But don't use 1,000 "just in case": more partitions means more open files, longer leader elections and more consumer memory.

### Settings
RF=3, min.insync=2, acks=all for orders. Clickstream may use acks=1 if some loss is tolerable, in exchange for lower latency.

### Schemas
Protobuf or Avro in a schema registry with BACKWARD compatibility. An envelope with eventId, aggregateVersion, occurredAt and correlationId. Breaking change → \`orders.events.v2\`, dual-publish during migration.

### Naming and ownership
\`<domain>.<entity/type>.<version>\`, one owning team per topic, ACLs restricting producers to the owner.

### Production concerns
The order service publishes via a **transactional outbox**. Compaction needs \`min.compaction.lag.ms\` so consumers see recent intermediate states if needed. Clickstream goes through a Kafka Connect S3 sink to the lake.`,
      followUps: [
        {
          q: 'Why not one topic per event type?',
          a: 'Per-order ordering across types (Placed before Paid) requires them in the same partition, so they must share a topic and key. Separate topics per type lose cross-type ordering; use headers or a type field and let consumers filter.',
        },
        {
          q: 'How does a compacted topic handle a deleted order?',
          a: 'Publish a tombstone (key with null value). Compaction eventually removes older values; the tombstone itself is kept for delete.retention.ms so consumers can observe the delete, then it is removed too.',
        },
      ],
      pitfalls: [
        'Keying by customerId when order-level ordering is what matters (creates hot keys too)',
        'Planning to "just add partitions later" for a keyed, order-sensitive topic',
        'Using compaction for event history (loses intermediate events)',
      ],
    },
    {
      id: 'mq-fundamentals-iq-05',
      difficulty: 'hard',
      question:
        'Your consumer group of 30 pods keeps rebalancing every few minutes. Throughput drops to near zero during each rebalance and duplicates spike. How do you diagnose and fix it?',
      whatInterviewerLooksFor: [
        'Lists the concrete triggers (heartbeats, max.poll.interval, deploys, crashes, autoscaling flaps)',
        'Uses logs and metrics to pinpoint which one',
        'Knows cooperative-sticky, static membership and KIP-848',
        'Connects rebalances to duplicates via uncommitted offsets',
      ],
      modelAnswer: `### Triggers to check
1. **max.poll.interval.ms exceeded** (default 5 min): a batch takes too long (slow downstream, large \`max.poll.records\`). Client logs show "consumer poll timeout expired" / leaving group. Most common.
2. **Missed heartbeats** (\`session.timeout.ms\` 45 s): long GC or CPU throttling (K8s CPU limits), or an event loop blocked in Node so the heartbeat can't be sent.
3. **Membership churn:** HPA flapping on CPU, crash-looping pods, rolling deploys of 30 pods each causing a join/leave.
4. **Metadata changes:** regex subscriptions picking up new topics, partition increases.

### Diagnose
- Coordinator/broker logs: which member left and why ("removed due to session timeout" vs "left group").
- Client metrics: \`rebalance-rate\`, \`last-rebalance-seconds-ago\`, poll-idle ratio, and processing time per batch.
- Correlate with deploy and HPA events and with container CPU throttling.

### Fix
- **Bound processing:** smaller \`max.poll.records\`, timeouts on downstream calls, heartbeats during batches (kafkajs \`heartbeat()\`), or hand work to an internal bounded queue while pausing the partition.
- **Cooperative-sticky assignor:** only moved partitions are revoked, not a full stop-the-world.
- **Static membership** (\`group.instance.id\` = pod name in a StatefulSet): restarts within the session timeout don't trigger rebalances.
- **KIP-848 protocol** (Kafka 4.0, \`group.protocol=consumer\`): broker-side incremental assignment.
- Stabilize HPA (scale on lag with a stabilization window), and remove CPU limits that cause throttling.
- **Commit on revoke** so moved partitions resume close to where they stopped, which shrinks duplicate windows.

### Why duplicates spike
Offsets processed since the last commit are replayed by the new owner. With 30 members and 5-second auto-commit, each rebalance can replay thousands of messages, so handlers must be idempotent regardless.`,
      followUps: [
        {
          q: 'Does adding more pods help throughput here?',
          a: 'Only up to the partition count, and each join triggers another rebalance. If the group already has as many members as partitions, extra pods just idle and add churn.',
        },
        {
          q: 'How do you process slow messages without blowing max.poll.interval?',
          a: 'Pause the partition, process asynchronously in a bounded pool while continuing to poll (which returns nothing for paused partitions but keeps membership), then resume and commit. Or move slow work to a separate queue.',
        },
      ],
      pitfalls: [
        'Only raising session.timeout.ms (slower failure detection, root cause untouched)',
        'Setting max.poll.interval.ms to hours',
        'Adding consumers beyond the partition count',
      ],
    },
    {
      id: 'mq-fundamentals-iq-06',
      difficulty: 'medium',
      question:
        'Kafka stores everything on disk, yet it handles millions of messages per second. Explain why it is fast and what you would tune if producer throughput were too low.',
      whatInterviewerLooksFor: [
        'Sequential I/O and the page cache',
        'Zero-copy and batching/compression',
        'Partition-level parallelism',
        'Concrete producer tuning knobs and their trade-offs',
      ],
      modelAnswer: `### Why it's fast
- **Append-only log:** writes are sequential appends to the active segment; reads are sequential scans from an offset. Sequential disk I/O is orders of magnitude faster than random I/O (hundreds of MB/s even on HDD, GB/s on NVMe).
- **OS page cache:** Kafka doesn't maintain its own heap cache. Recent writes stay in page cache, so tail-reading consumers are served from RAM. The JVM heap stays small (a few GB), avoiding GC pauses.
- **Zero-copy:** \`sendfile\` moves bytes from page cache to the socket without copying through user space. (TLS in the JVM breaks this, which is why TLS brokers use more CPU.)
- **Batching end to end:** producers batch per partition, the broker writes the batch as one unit, consumers fetch batches. Per-message overhead is amortized.
- **Compression:** batches compressed once by the producer (lz4/zstd), stored compressed, decompressed by the consumer, saving disk and network by 3–5× for JSON.
- **Partitioning:** load spreads across brokers and disks; consumer parallelism scales with partitions.
- **Simple broker:** no per-message acks or deletes; consumers track their own offsets.

### Tuning low producer throughput
1. **linger.ms** 5–20 ms and **batch.size** 64–256 KB: bigger batches, fewer requests.
2. **compression.type=lz4 or zstd.**
3. \`max.in.flight.requests.per.connection\` up to 5 (idempotence keeps order).
4. **Don't await each send individually** in Node; send arrays of messages or aggregate.
5. More **partitions** if a single partition is the bottleneck, and check for **key skew**.
6. Check acks=all latency (a cross-AZ RTT of 1–2 ms per batch is usually fine) and broker health (under-replication, disk).

Trade-off: higher linger means higher latency. Batching 10 ms is usually invisible to users but can double or triple throughput.`,
      followUps: [
        {
          q: 'Why does Kafka avoid a per-message index like a database?',
          a: 'It uses sparse offset and time indexes per segment, which is enough to seek to a position and then scan sequentially. That keeps index maintenance cheap and memory small.',
        },
        {
          q: 'When does the page-cache design hurt?',
          a: 'Lagging consumers reading old data evict hot pages and cause disk reads, which slows tail consumers too. Tiered storage and separating replay workloads help.',
        },
      ],
      pitfalls: [
        'Saying Kafka is fast because it is "in-memory"',
        'Recommending acks=0 as the first tuning step',
        'Ignoring key skew',
      ],
    },
    {
      id: 'mq-fundamentals-iq-07',
      difficulty: 'hard',
      question:
        'Checkout today calls order → payment → inventory → notification synchronously over REST; p99 is 2.5s and any downstream outage fails checkout. How would you move this to an event-driven design without breaking correctness?',
      whatInterviewerLooksFor: [
        'Keeps what must be synchronous on the critical path',
        'Uses events for the rest with outbox publication',
        'Addresses consistency, compensation and user-visible status',
        'Plans an incremental migration with dual running',
        'Mentions observability across async hops',
      ],
      modelAnswer: `### Decide what must stay synchronous
- The user needs to know "order accepted" and usually "payment authorized". Inventory **reservation** is often synchronous too, to avoid overselling. Notification, loyalty points, analytics and search don't block the user.

### Target design
1. **Order service** validates, writes the order (\`PENDING\`) and an **outbox** row in one transaction, then returns **202** with an order id (or waits briefly for authorization).
2. The outbox relay publishes \`OrderPlaced\` (key = orderId) to Kafka.
3. **Payment** consumes it, authorizes with an idempotency key, and publishes \`PaymentAuthorized\` or \`PaymentFailed\`.
4. **Inventory** reserves on \`OrderPlaced\` (or on PaymentAuthorized) and publishes \`StockReserved\` or \`OutOfStock\`.
5. The order service (or a saga orchestrator) consumes the results and transitions state; on failure it issues compensations (void authorization, release stock).
6. **Notification** consumes final state events.

### Correctness guards
- Idempotent consumers keyed by eventId; versioned state transitions.
- Per-order ordering via key; consumers ignore stale versions.
- Timeouts in the saga: no payment result after 10 minutes → query the PSP, then cancel.

### User experience
The client polls \`GET /orders/{id}\` or receives a WebSocket/push update; status is \`PENDING → CONFIRMED/FAILED\`.

### Migration
- Phase 1: publish events from the outbox while keeping the REST calls (shadow consumers verify parity).
- Phase 2: move non-critical calls (notification, analytics) to events.
- Phase 3: move payment/inventory to events behind a feature flag, per market.

### Results to expect
Checkout p99 falls to around 100–300 ms (DB write plus maybe a synchronous auth). A notification outage no longer fails checkout; its queue builds and drains later.

### Observability
Propagate W3C \`traceparent\` in message headers; dashboards for consumer lag and saga state age ("orders stuck in PENDING > 5 min").`,
      followUps: [
        {
          q: 'Inventory said OK but payment failed. Who releases the stock?',
          a: 'The saga: on PaymentFailed, the orchestrator (or inventory itself, reacting to the event) releases the reservation idempotently. Reservations also carry an expiry as a backstop.',
        },
        {
          q: 'Why not publish to Kafka directly from the order service after the DB commit?',
          a: 'The dual-write problem: a crash between commit and publish loses the event, and publishing before commit can emit events for orders that roll back. The outbox makes the DB transaction the single source.',
        },
      ],
      pitfalls: [
        'Making everything async, including what the user must see immediately',
        'No compensation path',
        'Dual writes to DB and Kafka',
      ],
    },
    {
      id: 'mq-fundamentals-iq-08',
      difficulty: 'expert',
      question:
        'You are all-in on AWS. Every OrderPlaced event must reach six consumers: email, search indexing, a fraud model, a data lake, three partner webhooks with different filters, and an audit account owned by another team. The fraud team needs strict per-order ordering and wants to re-run the last 7 days after shipping a model bug. Which of SQS, SNS, EventBridge and Kinesis do you use, where, and why?',
      whatInterviewerLooksFor: [
        'Assigns each service by role (buffer, copier, router, log) instead of picking one for everything',
        'Notices that only a log gives per-key ordering plus a 7-day replay',
        'Puts a queue with its own DLQ in front of fragile or slow consumers',
        'Uses real limits (shard throughput, targets per rule, retention) to size the design',
        'Keeps one source of truth for publishing (outbox) instead of dual-writing to several services',
      ],
      modelAnswer: `### Split by role
- **Ordering and replay → Kinesis Data Streams** (or MSK if the org already runs Kafka). Partition key = \`orderId\`, so all events of an order land on one shard in order. Retention is set to 7 days (it can go up to 365). The fraud consumer replays with an \`AT_TIMESTAMP\` iterator, or by resetting its KCL checkpoints, without touching anyone else.
- **Data lake → Kinesis → Firehose → S3** as a second, independent reader. It uses enhanced fan-out if read capacity gets tight, because shared consumers split 2 MB/s per shard.
- **Routing to partners and the audit account → EventBridge.** A small bridge (Pipes from the stream, or the relay itself) puts events on a \`commerce\` bus. One rule per partner holds that partner's content filter. A cross-account rule sends everything to the audit bus. Each partner rule targets **SQS → a webhook worker**, or an API destination with a DLQ. A partner that is down for 2 hours then only fills its own queue.
- **Internal fan-out → SNS → SQS** for email and search, or EventBridge rules → SQS if you prefer one routing layer. Each service owns its queue, visibility timeout and DLQ.

### Sizing
Assume 2,000 orders/s at peak with about 1 KB per event: 2 MB/s in and 2,000 records/s, so at least **2 shards**, plan 4 for headroom and hot keys, or use on-demand mode. Readers: fraud, Firehose and the bridge share 2 MB/s per shard; switch to enhanced fan-out once you pass two or three readers.

### Correctness
- Publish **once**, from the order service's **transactional outbox** to Kinesis. Everything else derives from the stream, so there is no dual write to SNS, EventBridge and Kinesis.
- Every hop is at-least-once: consumers dedupe on \`eventId\`, and the fraud model uses \`aggregateVersion\` to drop stale events.
- Kinesis → Lambda: enable bisect-on-error, cap retries, set an on-failure destination and report partial batch failures, so a poison record cannot stall a shard for its whole retention period.

### Why not one service for everything?
SNS and EventBridge can't replay per consumer and don't keep order. SQS consumption deletes the message, so a second reader never sees it. Kinesis alone has no content routing, cross-account rules or webhook retries. Each tool covers one role.`,
      followUps: [
        {
          q: 'A partner webhook starts returning 500s for 3 hours. What happens in your design, and what would happen if the EventBridge rule targeted the API destination directly?',
          a: 'With rule → SQS → worker, events pile up in that partner\'s queue (retention up to 14 days). The worker backs off, other partners are unaffected, and the backlog drains when the partner recovers. If the rule targets the API destination directly, EventBridge retries for up to 24 h by default (185 attempts) and then sends the event to the target\'s DLQ if one is configured. Without a DLQ the event is dropped. The queue also gives you rate control and visibility into the backlog.',
        },
        {
          q: 'Fraud replays 7 days. Why does that not spam email customers again?',
          a: 'The replay happens only in the fraud consumer\'s own position on the Kinesis stream (a new iterator or reset KCL checkpoints). Email reads from its own SQS queue, fed by SNS or EventBridge, and those messages were deleted long ago. That isolation is why replay belongs on a log with per-reader positions, not on a broker that pushes to everyone. Even so, fraud must write idempotently (upsert by orderId + version) so the replay converges on the same state.',
        },
        {
          q: 'One mega-merchant produces 30% of all orders. Does that break the Kinesis design?',
          a: 'Not if the key is orderId: many orders spread across shards. If someone keys by merchantId, that merchant\'s shard hits 1 MB/s or 1,000 records/s, and you see WriteProvisionedThroughputExceeded on one shard while the others idle. Keep the key at the granularity where ordering is actually needed (per order), or salt merchant keys when cross-order ordering doesn\'t matter.',
        },
      ],
      pitfalls: [
        'Picking Kinesis for everything and hand-building routing, webhooks and cross-account delivery',
        'Expecting SNS or EventBridge to preserve order or to replay for one consumer',
        'Publishing the same event separately to SNS, EventBridge and Kinesis from application code (dual or triple writes)',
        'Sending rules straight to fragile HTTP targets without a queue or DLQ',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'mq-fundamentals-boe-1',
      question:
        'Size a Kafka cluster for 200K messages/s average (peak 2×), 1 KB per message, RF=3, 7-day retention, with 3 consumer groups reading everything.',
      assumptions: [
        'Compression ratio ~3× (JSON with lz4/zstd)',
        'Broker: 12 TB usable disk at ≤70% target fill, ~300 MB/s sustainable network throughput in and out combined budget per direction',
        'Consumers read from page cache (tail reads)',
      ],
      steps: [
        { label: 'Raw ingress', calc: '200K × 1 KB = 200 MB/s avg; peak 400 MB/s' },
        { label: 'Compressed ingress', calc: '200 ÷ 3 ≈ 67 MB/s avg; peak ≈ 133 MB/s' },
        { label: 'Replication traffic', calc: '(RF − 1) × 67 = 133 MB/s extra between brokers; peak ≈ 267 MB/s' },
        { label: 'Consumer egress', calc: '3 groups × 67 = 200 MB/s avg; peak 400 MB/s' },
        { label: 'Storage per replica-set', calc: '67 MB/s × 604,800 s ≈ 40.5 TB per copy' },
        { label: 'Total storage with RF=3', calc: '40.5 × 3 ≈ 122 TB; at 70% fill → ~174 TB raw capacity' },
        { label: 'Brokers for disk', calc: '174 ÷ 12 ≈ 15 brokers' },
        { label: 'Brokers for network (peak)', calc: 'Out ≈ 400 (consumers) + 267 (replication) ≈ 667 MB/s ÷ 300 ≈ 3 brokers → disk dominates' },
      ],
      answer:
        'Roughly 15–18 brokers (disk-bound, ~122 TB of replicated data). Network needs only a handful of brokers, so retention, not throughput, drives cluster size.',
      insight:
        'Retention × RF dominates. Tiered storage (hot 1 day locally, the rest in S3) could cut local disk by ~85% and the broker count to network-driven levels (~4–6), while compression choice changes the answer 3×.',
      followUps: [
        {
          "q": "Retention must go from 7 to 30 days for audit, but the budget can't quadruple. Redo the estimate with tiered storage.",
          "a": "Without tiering: 67 MB/s × 30 days ≈ 174 TB per copy, ×3 = 520 TB, so about 60+ brokers. With tiered storage, keep 1 day locally (~5.8 TB per copy × 3 ≈ 17 TB, about 2 brokers' worth of disk), and network sets the count at about 4–6 brokers. Remote: S3 stores one logical copy (~174 TB compressed), since S3 provides its own durability, at roughly $0.023/GB-month ≈ $4K/month. Catch-up and backfill reads now come from S3 at higher latency, which is acceptable for audit consumers and keeps cold reads off broker disks."
        },
        {
          "q": "Peak traffic doubles to 800 MB/s raw for an hour. Which resource saturates first in your 15-broker design?",
          "a": "Not disk capacity: one hour adds only ~0.5 TB compressed. Network and disk write throughput are the risk. Compressed ingress becomes ~267 MB/s; with replication ×3 that is about 800 MB/s of writes across the cluster and roughly 800 MB/s of consumer egress plus 533 MB/s of replication out. Spread over 15 brokers, that is about 90 MB/s out per broker, well within the 300 MB/s budget, so the design holds. The real risk is uneven leadership: a few brokers leading the hottest partitions can saturate their NICs. Check leader balance and per-broker bytes-out, not just averages."
        }
      ],
    },
    {
      id: 'mq-fundamentals-boe-2',
      question:
        'How many partitions does a "payments.events" topic need? Target 30K events/s peak within 2 years; each consumer instance can process ~800 events/s (DB-bound); a single partition sustains ~5 MB/s in your setup; events are 2 KB.',
      assumptions: [
        'Throughput needs to be met by the slowest consumer group',
        'Keys (paymentId) are well distributed',
        'Headroom factor 1.5× for skew and catch-up after incidents',
      ],
      steps: [
        { label: 'Producer-side bound', calc: '30K × 2 KB = 60 MB/s ÷ 5 MB/s ≈ 12 partitions' },
        { label: 'Consumer-side bound', calc: '30K ÷ 800 ≈ 38 consumers → need ≥ 38 partitions' },
        { label: 'Catch-up headroom', calc: '38 × 1.5 ≈ 57' },
        { label: 'Round to a divisible number', calc: '60 (divisible by 2, 3, 4, 5, 6, 10, 12, 15, 20, 30 → even spread over many consumer counts)' },
        { label: 'Sanity check', calc: '60 partitions × RF 3 = 180 replicas — trivial for a cluster (KRaft handles 100Ks+)' },
      ],
      answer: 'About 60 partitions — driven by consumer parallelism (38+), not broker throughput (12).',
      insight:
        'Partition count is usually bounded by consumer processing speed, not Kafka. Since adding partitions later remaps keys and breaks per-key ordering, size for 2-year consumer needs now; if one consumer gets much faster, fewer instances simply own more partitions each.',
      followUps: [
        {
          "q": "Consumers get 4× faster after you batch DB writes (3,200 events/s each). Would you reduce the partition count to 15?",
          "a": "No, and you couldn't easily anyway: Kafka can't shrink partitions, and migrating topics breaks key placement. You also don't need to. With 60 partitions, just run about 10–15 consumers, each owning 4–6 partitions. Keeping 60 preserves headroom for a future regression, for incident catch-up (scale out to 60 pods to drain backlog fast) and for even spreading. The cost of extra partitions here is small: more open file handles, slightly longer rebalances and leader elections, and producer batching spread thinner. That only matters at tens of thousands of partitions per cluster."
        }
      ],
    },
    {
      id: 'mq-fundamentals-boe-3',
      question:
        'Estimate the monthly SQS request cost for 50M jobs/day on a Standard queue, with and without batching and long polling.',
      assumptions: [
        'Standard queue price ≈ $0.40 per million requests (first 1M/month free, ignored)',
        'Each job = 1 send + 1 receive + 1 delete; messages < 64 KB (1 request each)',
        'Naive: no batching, short polling with 20 workers idle-polling ~10% of the time at 10 empty receives/s each',
        'Optimized: batches of 10 for send/receive/delete, long polling 20 s',
      ],
      steps: [
        { label: 'Naive job requests', calc: '50M × 3 = 150M requests/day' },
        { label: 'Naive empty receives', calc: '20 workers × 10/s × 86,400 × 10% ≈ 1.7M/day' },
        { label: 'Naive monthly', calc: '(150M + 1.7M) × 30 ≈ 4.55B → 4,550 × $0.40 ≈ $1,820/month' },
        { label: 'Batched job requests', calc: '150M ÷ 10 = 15M requests/day' },
        { label: 'Long-poll empties', calc: '20 workers × (86,400 ÷ 20 s) × 10% ≈ 8.6K/day (negligible)' },
        { label: 'Optimized monthly', calc: '15M × 30 = 450M → 450 × $0.40 ≈ $180/month' },
      ],
      answer: 'About $1,800/month naive vs about $180/month with 10-message batches and long polling — a 10× reduction.',
      insight:
        'SQS bills per request, so batching directly divides cost and also cuts API latency overhead. Long polling removes empty-receive waste. At this volume cost is not a reason to self-host a broker; design effort goes into visibility timeouts and idempotent handlers instead.',
      followUps: [
        {
          "q": "Jobs grow to 200 KB payloads. How does that change cost and design?",
          "a": "SQS caps messages at 256 KB and bills per 64 KB chunk, so a 200 KB message costs 4 requests per send and per receive, and batching 10 of them would exceed the 256 KB batch limit. Use the claim-check pattern: write the payload to S3 and send only a pointer (about 200 bytes) through SQS. S3 PUT plus GET runs about $5.4 per million jobs, so 50M/day × 30 ≈ $8K/month, far more than the queue. If payloads are reusable, store them once and reference by content hash, and consider compressing JSON (3–5×) to fit under 64 KB so the payload can stay inline."
        }
      ],
    },
  ],
  test: [
    {
      id: 'mq-fundamentals-mcq-01',
      difficulty: 'hard',
      question:
        'Topic with RF=3 and min.insync.replicas=2. Two of the three replicas of partition 7 go down; the leader is still alive. A producer with acks=all writes to partition 7. What happens?',
      options: [
        'The write fails with NotEnoughReplicas (retried until delivery timeout); consumers can still read data up to the high watermark',
        'The write succeeds, because acks=all waits only for the replicas that are currently alive',
        'The broker automatically lowers min.insync.replicas to 1 until the replicas recover',
        'The partition goes offline for both reads and writes',
      ],
      correct: [0],
      explanation:
        'With the ISR shrunk to 1, which is below min.insync.replicas=2, acks=all writes are rejected. Kafka deliberately chooses write unavailability over acknowledging data that only one copy holds. "Waits only for live replicas" is true of acks=all but ignores the min.insync floor. Brokers never lower the setting automatically. The leader is alive, so reads continue.',
      followUps: [
        {
          "q": "The two replicas will take 30 minutes to come back, and the business says payments must keep flowing. What are your options, and what does each cost?",
          "a": "Option 1: temporarily lower `min.insync.replicas` to 1 on that topic. Writes resume, but any acknowledged write is then held by a single disk, so losing that broker loses data. Do this only with an explicit sign-off, and revert it once the ISR recovers. Option 2: let producers buffer by raising `delivery.timeout.ms`, or spill to a local outbox and keep accepting orders in the database; the outbox relay catches up later with no durability loss. Option 3: reassign partition 7's replicas to healthy brokers, which starts copying immediately but competes for network bandwidth. The outbox approach is usually the best answer because the system of record stays durable."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-02',
      difficulty: 'expert',
      question:
        'A producer uses acks=1. The leader appends offset 500 and acks it. Before any follower fetches it, the leader crashes; a follower from the ISR (with log end 499) becomes leader. unclean.leader.election is false. What is the outcome?',
      options: [
        'Offset 500 is recovered when the old leader restarts, because the new leader fetches it back',
        'The election is blocked until the old leader returns, since it holds acknowledged data',
        'Offset 500 is lost. Consumers never saw it because it was above the high watermark, and the old leader truncates it when it rejoins',
        'Consumers saw offset 500, and it is now duplicated when the producer retries',
      ],
      correct: [2],
      explanation:
        'acks=1 means only the leader had it, and the follower was still legitimately in the ISR (within replica.lag.time.max.ms), so the election was clean. The old leader truncates its log to the new leader\'s on rejoin, so the acked record is gone. The high watermark had not advanced past 499, so no consumer read it. Kafka does not block elections to protect acks=1 data, and the producer does not retry an acked send.',
      followUps: [
        {
          "q": "Same crash, but the producer used acks=all with min.insync.replicas=2. Is offset 500 safe now, and what does the producer see?",
          "a": "Yes. With acks=all the leader only acknowledges once every ISR member (at least 2) has the record, so the follower that becomes leader already holds offset 500 and the high watermark had advanced. If the leader crashed before the follower fetched it, the producer never got an ack. It gets a timeout or NOT_LEADER error and retries against the new leader. With the idempotent producer, a retry of a batch that actually did replicate is de-duplicated by sequence number. The cost is roughly one extra replication round trip per write, a few milliseconds of p99 latency inside one AZ."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-03',
      difficulty: 'expert',
      question: 'This consumer runs with default kafkajs settings. The pod is OOM-killed under load. What is the most likely effect?',
      code: {
        language: 'typescript',
        code: `await consumer.run({
  eachMessage: async ({ message }) => {
    const evt = JSON.parse(message.value!.toString());
    void processPayment(evt);   // takes ~2s, not awaited
  },
});`,
      },
      options: [
        'Duplicates only: offsets are committed after processPayment resolves',
        'No effect: kafkajs tracks pending promises and commits only when they settle',
        'The consumer is removed from the group because processPayment exceeds sessionTimeout',
        'Message loss: offsets are resolved and auto-committed as soon as eachMessage returns, so in-flight payments that die with the pod are never redelivered',
      ],
      correct: [3],
      explanation:
        'eachMessage returns immediately, so kafkajs considers the message processed and auto-commits the offset while processPayment is still running. When the pod dies, those in-flight payments are lost, because on restart consumption resumes after them. kafkajs has no visibility into un-awaited promises. Heartbeats continue normally because the handler returned quickly, so the session timeout is not the problem.',
      followUps: [
        {
          "q": "You await processPayment, but each payment takes 2 s and throughput collapses to 0.5 msg/s per partition. How do you get throughput back without reintroducing loss?",
          "a": "Parallelise without letting commits get ahead of completed work. Options: raise `partitionsConsumedConcurrently` so different partitions run in parallel; inside a partition, process messages concurrently across different keys (per-key queues) and only resolve the offset up to the lowest fully completed message, which is a commit watermark; or add partitions so more pods can own them. Also attack the 2 s itself by batching calls to the payment provider and adding connection reuse. Whatever you choose, commit only contiguous completed offsets so a crash replays work rather than skipping it."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-04',
      difficulty: 'hard',
      question:
        'A topic has 12 partitions and consumer lag is growing. The team scales the consumer group from 12 to 20 pods. What happens to throughput?',
      options: [
        'It rises about 1.67× because work is spread over 20 pods',
        'It stays roughly the same: 8 pods get no partitions, and the extra joins cause rebalances that briefly reduce throughput',
        'It doubles, because Kafka splits partitions across consumers when there are more consumers than partitions',
        'It falls permanently, because each partition is now shared by two consumers',
      ],
      correct: [1],
      explanation:
        'Within a group each partition has exactly one owner, so at most 12 consumers are active and 8 sit idle. Kafka never splits a partition between consumers of one group. Scaling requires more partitions (with key remapping implications) or faster per-partition processing, such as batching or concurrency across keys within a partition.',
      followUps: [
        {
          "q": "You add partitions (12 to 24) to scale consumers, but a few hot keys still produce most of the lag. What now?",
          "a": "Partition count can't fix skew: one hot key always maps to one partition and therefore one consumer. Measure per-partition lag and per-key rates to confirm. Fixes: make the hot path faster (batch DB writes for that key); if strict per-key ordering is not required for all events, salt the key (`merchantId#0..7`) to spread it, then re-aggregate downstream; or route the known hot tenants to a dedicated topic with its own consumer fleet. If ordering is required, the ceiling is single-consumer throughput for that key, so optimise processing or relax the ordering requirement to per-entity within the tenant."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-05',
      difficulty: 'expert',
      question: 'Events are keyed by accountId and must be applied in order per account. Select ALL changes that can break per-account ordering.',
      options: [
        'Increasing the topic from 24 to 48 partitions while producers keep running',
        'Two instances of the account service both publishing events for the same account',
        'The consumer processing a fetched batch with Promise.all over all its messages',
        'Enabling the idempotent producer with max.in.flight.requests.per.connection=5',
        'Setting partitionsConsumedConcurrently=4 in kafkajs',
      ],
      correct: [0, 1, 2],
      explanation:
        'Adding partitions changes murmur2(key) % N, so new events for an account can land in a different partition than its older, unconsumed ones. Two producers interleave by arrival time with no coordination. Promise.all processes messages of one partition, and therefore one account, concurrently. The idempotent producer preserves order with up to 5 in flight thanks to sequence numbers. partitionsConsumedConcurrently parallelizes across partitions while keeping each partition sequential.',
      followUps: [
        {
          "q": "You must go from 24 to 48 partitions anyway. How do you do it without breaking per-account ordering?",
          "a": "Option A, drain and switch: pause producers briefly (or buffer them in an outbox), wait for every consumer group to reach zero lag on the old layout, add partitions, then resume. Old and new events for an account can no longer interleave. Option B, migrate topics: create `accounts.v2` with 48 partitions, dual-publish or mirror the data, move consumers over at a clean cut point, then retire v1. Option C, make consumers tolerant: events carry a per-account version, and consumers buffer or reject out-of-order versions. Option A is cheapest when a few seconds of producer pause is acceptable."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-06',
      difficulty: 'hard',
      question:
        'A Java consumer polls 500 records; each takes ~1 s to process because of a slow API. max.poll.interval.ms is at its default. What happens repeatedly?',
      options: [
        'Heartbeats keep the member alive, so the batch finishes slowly but safely',
        'The broker throttles the producer until the consumer catches up',
        'The broker deletes the records because they were not acknowledged within the retention period',
        'After ~5 minutes without a poll the consumer leaves the group, its partitions are reassigned, and the new owner reprocesses the uncommitted batch, causing a rebalance loop with duplicates',
      ],
      correct: [3],
      explanation:
        '500 × 1 s ≈ 8 minutes exceeds max.poll.interval.ms (300 s). Heartbeats run on a background thread, but this separate liveness check fires anyway, so the member leaves and the partitions move. The uncommitted work is redone and the same stall repeats. Retention is time/size based, not acknowledgement based, and Kafka has no consumer-driven producer backpressure. Fix with a smaller max.poll.records, timeouts, or pause/resume with async processing.',
      followUps: [
        {
          "q": "The slow API sometimes takes 60 s for one record. Lowering max.poll.records to 10 is not enough. What pattern handles this?",
          "a": "Decouple processing from the poll loop with pause/resume. Poll, hand records to a bounded worker pool, then `consumer.pause(partitions)` and keep calling `poll()` (which returns nothing for paused partitions) so the member stays live within `max.poll.interval.ms`. When the workers finish, commit the completed offsets and `resume()`. Also put a timeout on the API call (for example 10 s) and route records that keep timing out to a retry topic with delay, so one slow record does not block its partition indefinitely. Then the poll deadline measures consumer health, not API latency."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-07',
      difficulty: 'medium',
      question:
        'A new fraud-detection service must, on launch, process the last 3 days of payment events, then follow new events in real time — without affecting existing consumers. Which setup fits best?',
      options: [
        'A Kafka topic with ≥3 days retention and a new consumer group starting from an offset/timestamp 3 days ago',
        'A RabbitMQ fanout exchange with a new queue bound to it',
        'An SQS standard queue that the new service drains',
        'Redis Pub/Sub with a new subscriber',
      ],
      correct: [0],
      explanation:
        'Only a retained log lets a new, independent consumer group start from a historical position without disturbing other groups. An SQS queue deletes messages when they are consumed, and it is shared by its consumers. A RabbitMQ queue bound now receives only future messages (Streams would be needed). Redis Pub/Sub has no persistence at all.',
      followUps: [
        {
          "q": "The fraud service's 3-day backfill runs at 50K msg/s and the brokers' disks start thrashing, slowing existing consumers. Why, and how do you protect them?",
          "a": "Live consumers read the tail from the page cache. A 3-day backfill reads cold segments from disk, which evicts the hot pages, so everyone falls back to disk I/O. Mitigations: throttle the backfill using client quotas (`consumer_byte_rate` for its client id) or by limiting its consumer instances; run it off-peak; and if tiered storage is enabled, historical reads come from S3 and do not touch local disks. Separately, deploy the fraud logic idempotently so the backfill can be paused and resumed from committed offsets."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-08',
      difficulty: 'expert',
      question:
        'This service reads from topic A and writes to topic B, intending exactly-once. The pod crashes right after txn.commit() and before the next auto-commit. What happens on restart?',
      code: {
        language: 'typescript',
        code: `await consumer.run({
  autoCommit: true,   // default
  eachMessage: async ({ message }) => {
    const txn = await producer.transaction();
    await txn.send({ topic: 'B', messages: [transform(message)] });
    await txn.commit();
  },
});`,
      },
      options: [
        'Nothing is reprocessed: the transaction also committed the input offset',
        'The transaction coordinator aborts the committed transaction because the consumer offset was not committed',
        'The input message is re-read and transformed again, and a second committed copy is written to B, because offsets are not part of the transaction',
        'read_committed consumers of B filter out the duplicate automatically',
      ],
      correct: [2],
      explanation:
        'Without txn.sendOffsets, consumer offsets are committed separately by auto-commit, so the output and the progress are not atomic. The crash leaves the offset behind, the message is replayed, and a second, fully committed record lands in B. read_committed hides only aborted data, not duplicate committed data. Coordinators never abort already-committed transactions.',
      followUps: [
        {
          "q": "Write the correct transactional loop. What exactly must be inside the transaction, and what consumer setting is required downstream?",
          "a": "Per batch: `txn = await producer.transaction()`; send the transformed records to B; `await txn.sendOffsets({ consumerGroupId, topics: [{ topic: 'A', partitions: [{ partition, offset: String(Number(last.offset) + 1) }] }] })`; `await txn.commit()`. On any error, call `txn.abort()` and seek back. Disable auto-commit so offsets move only through the transaction. Use a stable `transactionalId` per input partition or instance so a zombie instance gets fenced after a rebalance. Downstream consumers of B must use `isolation.level=read_committed`, or they will see aborted records."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-09',
      difficulty: 'expert',
      question:
        'Consumers use isolation.level=read_committed. Lag on several partitions climbs for ~60 s even though producers are writing normally, then suddenly recovers. The most likely cause?',
      options: [
        'A broker was garbage collecting for 60 s',
        'A transactional producer began a transaction and hung. read_committed consumers cannot read past the last stable offset until it commits, aborts, or hits transaction.timeout.ms (default 60 s)',
        'Consumer auto-commit was delayed, so lag metrics were stale',
        'Log compaction was running and locking the partitions',
      ],
      correct: [1],
      explanation:
        'The last stable offset (LSO) stops at the first open transaction on each partition, and read_committed consumers stall there even while non-transactional data piles up after it. The coordinator aborts the transaction when it times out (60 s by default), which unblocks consumers and matches the symptom. A GC pause would stop producers too. Compaction never blocks reads, and stale commit metrics would not cause a real stall followed by a recovery.',
      followUps: [
        {
          "q": "How would you detect this in production before users notice, and what would you tune?",
          "a": "Alert on the gap between the log end offset and the last stable offset per partition. A growing gap while producers are healthy means an open transaction is blocking. Also export the producer's transaction duration and the coordinator's `transaction.timeout.ms` abort count. Tuning: lower `transaction.timeout.ms` on producers that should commit quickly (for example 10 s, if batches finish in about 1 s) so hung producers are aborted faster. Keep transactions short by committing per batch rather than per minute, and make sure crashed producers restart with the same `transactional.id` so the coordinator fences and aborts their leftovers immediately."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-10',
      difficulty: 'hard',
      question:
        'SQS standard queue, visibility timeout 30 s. Jobs take 90–150 s. Select ALL statements that are true.',
      options: [
        'The same job will often be processed by two or more workers concurrently',
        'A heartbeat that calls ChangeMessageVisibility periodically (for example every 20 s) while the job runs fixes the premature reappearance',
        'Switching to a FIFO queue stops the duplicate processing, because FIFO deduplicates within 5 minutes',
        'With a redrive policy of maxReceiveCount=3, jobs that are actually succeeding may still end up in the DLQ',
        'Enabling long polling (WaitTimeSeconds=20) prevents the duplicates',
      ],
      correct: [0, 1, 3],
      explanation:
        'After 30 s the message becomes visible again and another worker receives it, and each receive increments the receive count toward the DLQ threshold. Extending visibility (or setting the timeout above p99 processing time) fixes it. FIFO deduplication applies to sends within the window, not to redelivery after visibility expiry. Long polling only reduces empty receives.',
      followUps: [
        {
          "q": "Workers can crash mid-job, so the heartbeat extension is not the whole story. How do you make the 90–150 s jobs safe under redelivery?",
          "a": "Assume every job can run twice. Give each job an id, and have the worker claim it in a DB table (`INSERT ... ON CONFLICT DO NOTHING` or a status CAS from PENDING to RUNNING with a lease expiry) before doing side effects. Make external effects idempotent with provider idempotency keys. Write results with an upsert keyed by job id. If a worker crashes, its visibility heartbeat stops, the message reappears after the timeout, and the next worker sees an expired lease and resumes or redoes the job safely. Delete the SQS message only after the result commits."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-11',
      difficulty: 'medium',
      question:
        'A RabbitMQ queue has 5 consumers with no prefetch limit (unlimited). One consumer is much slower than the others. What do you observe?',
      options: [
        'The broker pushes many messages to each consumer as they connect, so the slow one hoards a large unacked backlog while others go idle and its memory grows',
        'Messages are evenly processed, because RabbitMQ waits for acks before sending more',
        'The slow consumer is automatically disconnected after the queue TTL',
        'RabbitMQ switches the queue to pull mode for that consumer',
      ],
      correct: [0],
      explanation:
        'With unlimited prefetch RabbitMQ pushes as fast as it can, so messages already delivered to the slow consumer sit unacked there and can\'t be picked up by idle consumers until its channel closes. basic.qos (prefetch) bounds unacked messages per consumer and turns this into fair dispatch. There is no automatic TTL disconnect or pull-mode switch.',
      followUps: [
        {
          "q": "You set prefetch. How do you pick the value for consumers that take 5 ms per message versus 2 s per message?",
          "a": "Prefetch should cover the network round trip so a consumer never sits idle waiting for the next delivery: roughly round-trip time ÷ processing time, plus a small buffer. At 5 ms per message and about 1 ms RTT, a prefetch of 20–50 keeps the pipeline full with good throughput. At 2 s per message, use a prefetch of 1–2 so slow work is never hoarded and other consumers can take it; each extra unacked message is just queueing delay held by one worker. Measure the queue's unacked count per consumer and the consumer utilisation metric in the RabbitMQ management UI, then tune."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-12',
      difficulty: 'expert',
      question:
        'After every restart, this consumer processes one message it had already handled before the restart. Why?',
      code: {
        language: 'typescript',
        code: `eachMessage: async ({ topic, partition, message }) => {
  await handle(message);
  await consumer.commitOffsets([
    { topic, partition, offset: message.offset },
  ]);
},`,
      },
      options: [
        'commitOffsets is asynchronous and the last commit never reaches the broker',
        'auto.offset.reset=latest makes the consumer re-read the last message',
        'kafkajs commits offsets per topic, not per partition, so one partition is always behind',
        'The committed offset should be the NEXT offset to read (offset + 1). Committing the processed offset makes the group resume at that same message',
      ],
      correct: [3],
      explanation:
        'Kafka\'s committed offset is the position of the next record to consume, so after processing offset N you commit N+1. Committing N means a restart re-reads N, one duplicate per partition per restart. The commit is awaited, offsets are tracked per partition, and auto.offset.reset applies only when no committed offset exists.',
      followUps: [
        {
          "q": "After fixing to offset+1, the team commits after every message and broker CPU climbs at 50K msg/s. What do you change?",
          "a": "Per-message commits mean 50K offset-commit writes per second to `__consumer_offsets`. Commit periodically instead: resolve offsets per message but commit every N messages or every few seconds (kafkajs `autoCommitInterval` and `autoCommitThreshold`, or `commitOffsetsIfNecessary` at batch end). The trade-off is replay size on crash: with a 5 s interval you may reprocess up to 5 s of messages, which is fine because handlers are idempotent. Also commit synchronously on partition revoke and shutdown, so planned rebalances replay almost nothing."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-13',
      difficulty: 'medium',
      question:
        'A new service reads a compacted topic customers.state.v1 from the earliest offset. What will it see?',
      options: [
        'Only the single most recent message in the topic',
        'Every change ever made to every customer, in order',
        'At least the latest value for every key (older values may still appear in segments not yet compacted), plus tombstones for recently deleted keys',
        'Nothing, because compacted topics can only be read by Kafka Streams',
      ],
      correct: [2],
      explanation:
        'Compaction guarantees the latest value per key survives. The active and not-yet-cleaned segments may still contain older values, so consumers must handle superseded updates. Tombstones remain for delete.retention.ms so consumers learn about deletions. Full history is not retained, which is why compaction suits state topics and not event history. Any consumer can read a compacted topic.',
      followUps: [
        {
          "q": "The new service needs to know when it has finished loading all current state before it starts serving. How does it decide that?",
          "a": "At startup, fetch the current end offsets for every partition (the high watermarks), then consume from earliest until each partition's position reaches its captured end offset. At that point the snapshot is complete, so mark the service ready and keep consuming new updates. Treat tombstones (null values) as deletes, and remember later records for the same key overwrite earlier ones. Expose this as a readiness probe so Kubernetes does not route traffic to a half-loaded instance. Kafka Streams GlobalKTable and KTable restoration do exactly this."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-14',
      difficulty: 'expert',
      question: 'Select ALL statements that are true about Kafka\'s idempotent producer (enable.idempotence=true).',
      options: [
        'It prevents duplicates caused by the producer\'s internal retries after a lost ack, within one producer session',
        'It preserves per-partition ordering with up to 5 in-flight requests',
        'It dedupes messages your application re-sends after the process restarts',
        'It makes downstream consumer processing exactly-once',
        'It deduplicates messages with the same key across producers',
      ],
      correct: [0, 1],
      explanation:
        'The broker tracks the producer id and per-partition sequence numbers, rejecting duplicate or out-of-order batches from retries, so both dedup and ordering hold with ≤5 in flight. A restarted process gets a new producer id unless it uses a transactional.id, so application-level resends are new messages. Consumer-side exactly-once needs transactions or idempotent sinks. Keys play no role in idempotence.',
      followUps: [
        {
          "q": "Your app crashes after sending but before recording that it sent, then resends on restart. What actually prevents the duplicate end to end?",
          "a": "The idempotent producer can't, because the restarted process has a new producer id. Two real options. (1) Transactions with a stable `transactional.id`: on restart, `initTransactions` fences the old epoch and aborts any open transaction, and tying the send to consumer offsets or outbox state makes the operation atomic. (2) Application-level dedupe: put a deterministic event id (for example the outbox row id) in a header, and have consumers store processed ids (`UNIQUE(event_id)`) or upsert by business key. Option 2 works across any producer or broker and is what most teams rely on."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-15',
      difficulty: 'hard',
      question: 'The team runs this against a keyed topic orders.v1 (currently 12 partitions) in production. What is the consequence?',
      code: {
        language: 'bash',
        code: `kafka-topics.sh --bootstrap-server kafka-0:9092 \\
  --alter --topic orders.v1 --partitions 24`,
      },
      options: [
        'Existing data is rebalanced across 24 partitions and per-key order is preserved',
        'Existing data stays where it is; new messages for many keys go to different partitions than their earlier messages, so per-key ordering across the change can break',
        'The command fails, because partition counts can only change on empty topics',
        'Consumers must be recreated from scratch, because their offsets are invalidated',
      ],
      correct: [1],
      explanation:
        'Kafka never moves existing records between partitions; it only adds new empty ones. The key-to-partition function now uses modulo 24, so about half of all keys map elsewhere. A consumer of a new partition may process a key\'s new event before an older event is consumed from its old partition. Increases are allowed on live topics, decreases are not, and existing offsets remain valid.',
      followUps: [
        {
          "q": "The command already ran in production 10 minutes ago. What do you check and do now?",
          "a": "First, the blast radius: which consumers rely on per-key ordering, and do they guard with versions? Check the new partitions for data and lag. Order breaks only if a key's old event in its old partition is still unconsumed when its new event is processed elsewhere, so if consumer lag was near zero at change time the window was tiny. Look for anomalies such as projections with version regressions or state-machine errors, and reconcile affected keys from the source of truth. Partitions can't be reduced, so move forward: add version guards in consumers and document the change."
        }
      ],
    },
    {
      id: 'mq-fundamentals-mcq-16',
      difficulty: 'expert',
      question:
        'A Lambda consumes a 4-shard Kinesis stream (24 h retention) with the mapping below. At 10:00 a producer writes one malformed record to shard-2, and the handler throws on it every time. What do you observe over the next hours?',
      code: {
        language: 'yaml',
        title: 'template.yaml (AWS SAM) — event source mapping',
        code: `OrderEventsFn:
  Type: AWS::Serverless::Function
  Properties:
    Handler: dist/handler.main
    Events:
      Stream:
        Type: Kinesis
        Properties:
          Stream: !GetAtt OrderEvents.Arn
          StartingPosition: LATEST
          BatchSize: 100
          MaximumRetryAttempts: -1          # retry forever
          BisectBatchOnFunctionError: false
          # no DestinationConfig.OnFailure, no FunctionResponseTypes`,
      },
      options: [
        'Lambda moves the failing batch to a built-in DLQ after 3 attempts and shard-2 continues',
        'Shard-2 is stuck re-processing the same batch until the record expires about 24 h later; IteratorAge on that shard climbs while the other 3 shards stay current',
        'All four shards stop, because the event source mapping pauses the whole stream when any batch fails',
        'Kinesis skips the bad record after the visibility timeout, so only that record is lost and the shard continues',
      ],
      correct: [1],
      explanation:
        'Kinesis event source mappings keep order per shard, so a failing batch blocks only its own shard. With MaximumRetryAttempts -1 and no bisect, the same 100 records are retried until the bad record falls out of retention (24 h), and the good records in that batch are reprocessed many times. Other shards are independent and keep going. There is no built-in DLQ: you must configure an on-failure destination. Visibility timeout is an SQS concept and does not apply to Kinesis.',
      followUps: [
        {
          q: 'Fix the mapping so a poison record costs seconds, not a day, without losing it.',
          a: 'Set `BisectBatchOnFunctionError: true` so failing batches split until the bad record is isolated. Cap `MaximumRetryAttempts` (e.g. 3) and `MaximumRecordAgeInSeconds`. Add `DestinationConfig.OnFailure` pointing to an SQS queue or S3, which receives metadata about the failed batch (shard, sequence range) for later re-read. Better still, enable `FunctionResponseTypes: [ReportBatchItemFailures]` and return the failed sequence number, so Lambda checkpoints up to the record before it instead of retrying the whole batch.',
        },
        {
          q: 'The good records in the stuck batch were processed thousands of times. What breaks, and what protects you?',
          a: 'Every non-idempotent side effect repeats: emails, counters, payments, outbound API calls. Protection is an idempotency key per record (eventId, or shardId + sequenceNumber) stored with the side effect, e.g. a conditional write in DynamoDB or `INSERT … ON CONFLICT DO NOTHING`. Kinesis and Lambda are at-least-once even without failures, because retries after a timeout or a resharding can redeliver.',
        },
      ],
    },
    {
      id: 'mq-fundamentals-mcq-17',
      difficulty: 'hard',
      question:
        'Select ALL that apply. OrderPlaced is published to an SNS standard topic with three SQS subscriptions: email, fraud and search. Which statements are true?',
      options: [
        'A slow fraud consumer does not delay email: each queue has its own backlog, visibility timeout and DLQ',
        'Setting RawMessageDelivery to false makes consumers receive only the original body, without the SNS envelope',
        'All three queues receive messages in the same relative order, because one topic publishes them',
        'A new analytics service subscribing today can replay the last 3 days from the standard topic',
        'If a subscribed queue\'s access policy is broken, SNS retries delivery for a long time and then drops the message unless that subscription has a dead-letter queue',
      ],
      correct: [0, 4],
      explanation:
        'Fan-out through a queue per consumer isolates pace and failure, which is why SNS → SQS is the standard pattern. SNS keeps retrying an SQS endpoint under its delivery policy and then discards the message; a subscription-level redrive policy (DLQ) keeps it. RawMessageDelivery is the reverse of option B: true strips the envelope, false wraps the body in SNS JSON. Standard topics give no ordering guarantee across or within subscribers. Archive and replay exist only for FIFO topics, so a standard topic stores nothing to replay.',
      followUps: [
        {
          q: 'Fraud now needs per-order ordering. What is the smallest change, and what does it cost you?',
          a: 'Move to an SNS FIFO topic with SQS FIFO subscriptions and set `MessageGroupId = orderId`. Ordering then holds per order, with deduplication in a 5-minute window. Costs: FIFO topics deliver only to SQS queues, FIFO throughput is lower (300 msg/s per message group, about 3,000 msg/s per topic by default unless you set FifoThroughputScope=MessageGroup), and one slow message blocks its own group. If volumes are high or several readers need replay, Kinesis with key = orderId is the better fit.',
        },
      ],
    },
  ],
};

export default topic;
