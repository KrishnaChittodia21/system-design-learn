import type { Topic } from '../../types';

const topic: Topic = {
  id: 'ds-theory',
  phase: 'distributed',
  order: 5,
  title: 'Data Systems Theory: System Models, Ordering, Encoding & Derived Data',
  subtitle:
    'The theory senior interviews probe without naming it: system models and fault types, safety vs liveness, the two generals and FLP results, state machine replication and why total order broadcast is consensus, Avro schema resolution and rolling upgrades, stream-table duality, the three kinds of stream join, "unbundling the database" with CDC and a log, the end-to-end argument for exactly-once, when Byzantine fault tolerance is worth it, and what the 2nd edition of DDIA adds.',
  estimatedMinutes: 110,
  sources: [
    'Martin Kleppmann — Designing Data-Intensive Applications, 1st ed. (O\'Reilly, 2017): Ch 4 Encoding and Evolution, Ch 8 The Trouble with Distributed Systems, Ch 9 Consistency and Consensus, Ch 11 Stream Processing, Ch 12 The Future of Data Systems',
    'Martin Kleppmann & Chris Riccomini — Designing Data-Intensive Applications, 2nd ed. (O\'Reilly, March 2026): https://martin.kleppmann.com/2026/03/24/designing-data-intensive-applications-2e.html',
    'Martin Kleppmann — "Turning the database inside out with Apache Samza" (2015): https://martin.kleppmann.com/2015/03/04/turning-the-database-inside-out.html',
    'Martin Kleppmann — Concurrent and Distributed Systems, University of Cambridge (2021–22) lecture notes: https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/',
    'Fischer, Lynch & Paterson — Impossibility of Distributed Consensus with One Faulty Process (JACM, 1985); Dwork, Lynch & Stockmeyer — Consensus in the Presence of Partial Synchrony (JACM, 1988)',
    'Saltzer, Reed & Clark — End-to-End Arguments in System Design (ACM TOCS, 1984)',
    'Lamport, Shostak & Pease — The Byzantine Generals Problem (1982); Castro & Liskov — Practical Byzantine Fault Tolerance (OSDI 1999)',
    'Apache Avro specification — Schema Resolution; Confluent Schema Registry docs — compatibility types and wire format',
    'Apache Kafka Streams docs (KTable, versioned state stores, KIP-889/KIP-914); Apache Flink docs — interval joins and temporal joins',
    'Elasticsearch docs — external versioning (version_type=external)',
  ],
  tags: ['system-models', 'safety-liveness', 'flp', 'two-generals', 'state-machine-replication', 'total-order-broadcast', 'avro', 'schema-registry', 'schema-evolution', 'stream-table-duality', 'stream-joins', 'derived-data', 'cdc', 'end-to-end-argument', 'byzantine', 'ddia'],
  cheatSheet: [
    'System model = timing (synchronous / partially synchronous / asynchronous) × node faults (crash-stop / crash-recovery / Byzantine) × links (reliable / fair-loss / arbitrary). Real backends: partially synchronous + crash-recovery + fair-loss links fixed by retries and dedup.',
    'Safety = "nothing bad ever happens" (a violation is visible in a finite prefix and cannot be undone: two leaders, a lost committed write). Liveness = "something good eventually happens" (a leader is elected, a request is answered). Under asynchrony keep safety and give up liveness.',
    'Two generals: over a lossy link no finite protocol creates certainty that both sides agree. Practical answer: no certainty, so use idempotent retries plus reconciliation. FLP: in an asynchronous model with one crash, no deterministic protocol always terminates. Timeouts (partial synchrony) and randomisation get around it.',
    'State machine replication: deterministic replicas + the same inputs in the same order = the same state. Total order broadcast (every node delivers the same messages in the same order) is equivalent to consensus. A Raft log or a Kafka partition is a total order broadcast.',
    'Causal order is partial (concurrent events are not ordered). Lamport timestamps give a total order that is consistent with causality, but they cannot decide "first claim wins" online, because you would have to hear from every node. Total order broadcast decides it as messages are delivered.',
    'Avro has no field tags. The decoder needs the WRITER\'s schema (from the registry, via a 5-byte header: magic 0 + 4-byte schema id) and resolves it against the READER\'s schema by field name: writer-only fields are skipped, reader-only fields take their default, and int→long→float→double widen.',
    'BACKWARD (the Confluent default) = the new schema can read the old data, so upgrade consumers first. FORWARD = the old schema can read the new data, so upgrade producers first. FULL = both. Add *_TRANSITIVE to check against every version, not only the last.',
    'Data outlives code: rows written in 2019 are read by code from 2026. Rolling upgrades mean old and new code read each other\'s data. Old code that does read-modify-write must carry unknown fields through, or it silently deletes the new ones.',
    'Stream = changelog of a table, table = state of a stream (compacted topic → KTable). Joins: stream-stream (windowed, buffers both sides), stream-table (enrichment against the table as of now, or as of event time), table-table (a materialised join that updates when either side changes).',
    'System of record vs derived data. Unbundle the database: one ordered log (CDC or events) feeds search, cache and analytics views that can be rebuilt by replay. Exactly-once needs an end-to-end request id checked at the final write. Byzantine fault tolerance (3f+1) only pays off when participants do not trust each other.',
  ],
  sections: [
    {
      heading: 'System models: timing, node faults and links',
      body: `**Intuition:** every distributed algorithm carries a contract that says "I work as long as the world is no worse than X". A **system model** is that X. If you choose the wrong X, a proof of correctness tells you nothing about production.

A model is three choices, in the standard formulation:

| Dimension | Options | What it means |
|---|---|---|
| **Network timing** | synchronous / **partially synchronous** / asynchronous | Synchronous: delay and clock drift have known upper bounds. Asynchronous: no bounds at all, so a message may take any finite time and there are no useful clocks. Partially synchronous: the system behaves synchronously *most of the time*, but can stay asynchronous for unbounded stretches (GC pauses, congestion, VM steal). |
| **Node faults** | crash-stop / **crash-recovery** / Byzantine | Crash-stop: a node halts forever. Crash-recovery: a node can restart; it loses in-memory state and keeps what it fsynced. Byzantine: a node may do *anything*, including lying, equivocating (telling different peers different things) and running buggy or malicious code. |
| **Links** | reliable / **fair-loss** / arbitrary | Fair-loss: messages can be dropped, duplicated or reordered, but if you keep retrying one eventually gets through. Retries plus dedup turn fair-loss into reliable. Arbitrary: an active adversary can also forge or alter messages, and TLS turns this back into fair-loss. |

**The realistic default for your backends** is partially synchronous timing, crash-recovery nodes and fair-loss links. Raft, Paxos, ZooKeeper's ZAB and Kafka's KRaft are all designed for exactly that model.

**Why crash-recovery changes code:** a node that *replied* before it *persisted* can come back and contradict itself. A Raft node that votes for A, crashes before fsyncing \`votedFor\`, restarts and votes for B has produced two leaders in one term. The rule "persist, then reply" exists because of the model, not for performance.

**Why "synchronous" is a trap:** a design that assumes "a request never takes more than 2 s" is assuming a synchronous model. A 30 s stop-the-world pause, an EBS stall or a cross-AZ blip breaks the assumption. A lease-based lock without fencing is the classic case. Choose algorithms whose **safety** survives asynchrony and whose **liveness** needs only partial synchrony.

**Say this in interviews:** "I assume partial synchrony, crash-recovery and fair-loss links. Timeouts are only a failure *suspicion*. Nothing that affects correctness depends on a timeout being accurate."`,
      diagram: `             synchronous      partially synchronous       asynchronous
 delay bound:   known           exists, but unknown /         none
                                violated for periods
 good for:      hard-RT buses   Raft, Paxos, ZAB, KRaft       impossibility

 node faults:   crash-stop  ⊂  crash-recovery  ⊂  Byzantine
                (halts)        (restarts; keeps   (arbitrary, even
                                only what it       malicious behaviour)
                                fsynced)
 links:         reliable  ⇐ retries+dedup ⇐  fair-loss  ⇐ TLS ⇐  arbitrary`,
      code: [
        {
          language: 'typescript',
          title: 'Crash-recovery model in code: persist before you reply (vote handler)',
          code: `import { open } from 'node:fs/promises';

interface VoteState { term: number; votedFor: string | null }

export class DurableVoter {
  private state: VoteState = { term: 0, votedFor: null };
  private readonly path: string;
  constructor(path: string) { this.path = path; }

  async requestVote(term: number, candidate: string): Promise<boolean> {
    if (term < this.state.term) return false;
    if (term > this.state.term) this.state = { term, votedFor: null };
    if (this.state.votedFor !== null && this.state.votedFor !== candidate) return false;

    const next = { term, votedFor: candidate };
    // Crash-recovery model: after a restart only fsynced bytes survive.
    // Replying BEFORE fsync would let a restarted node vote twice in one term.
    const fh = await open(this.path, 'w');
    try {
      await fh.writeFile(JSON.stringify(next));
      await fh.sync();          // fsync: about 0.1-2 ms on NVMe, 5-10 ms on network disks
    } finally {
      await fh.close();
    }
    this.state = next;          // only now is the vote a fact
    return true;
  }
}`,
        },
      ],
      keyPoints: [
        'Name the model: partially synchronous + crash-recovery + fair-loss links is the realistic default.',
        'Crash-recovery means persist-then-reply. Anything acknowledged must survive a restart.',
        'A timeout is a failure suspicion, never proof. Correctness must not depend on it.',
      ],
      source: 'Kleppmann — Cambridge Concurrent & Distributed Systems, lecture 2 (system models); DDIA Ch 8',
    },
    {
      heading: 'Safety vs liveness: the two kinds of correctness property',
      body: `**Intuition:** safety is the guard rail ("never drive off the cliff"), liveness is the engine ("eventually reach the destination"). You can satisfy safety by standing still. Every real trade-off is about how much liveness to give up to keep safety.

**Precise definitions (Alpern & Schneider):**
- **Safety:** "nothing bad happens". If it is violated, you can point to the exact moment it happened, and no future event undoes it. Examples: two Raft leaders in one term, a committed Kafka record that disappears, two users holding the same username, a balance going below zero.
- **Liveness:** "something good eventually happens". A violation is never final, because it might still happen later. Examples: a leader is eventually elected, every request eventually gets a response, a consumer group eventually rebalances, replicas eventually converge.

**Mapping familiar knobs:**

| System / knob | Safety side | Liveness side |
|---|---|---|
| Kafka \`unclean.leader.election.enable\` | \`false\` (the default): an out-of-sync replica never becomes leader, so committed data is never lost | \`true\`: the partition comes back sooner, but acknowledged records can be lost |
| Kafka \`acks=all\` + \`min.insync.replicas=2\` | writes are rejected when fewer than 2 replicas are in sync | \`acks=1\` keeps accepting writes and risks loss on leader failover |
| Raft | at most one leader per term, committed entries never lost | a leader is elected *if* a majority can talk long enough |
| Postgres sync replication | commit waits for the standby | if the standby is down, commits hang (unless you fall back to async, which trades safety for liveness) |
| Circuit breaker / rate limiter | protects the downstream | sheds load, so some requests never succeed |

**The consensus bargain:** consensus protocols keep safety under *any* timing, in the asynchronous model, and promise liveness only during periods of partial synchrony. If someone proposes "if the leader doesn't answer in 5 s, any node may take over", ask which property survives a 6 s pause. Usually it is liveness, and safety has quietly gone.

**Interview move:** classify every requirement. "No double booking" is safety: it must hold even during partitions. "p99 under 200 ms" is liveness plus performance: you degrade it under failure. That classification tells you where you need consensus or unique constraints and where retries and timeouts are enough.`,
      code: [
        {
          language: 'text',
          title: 'Kafka broker/topic settings annotated as safety vs liveness',
          code: `# --- SAFETY: committed data never lost, never served from a stale leader ---
unclean.leader.election.enable=false   # default; an out-of-sync replica is never elected
min.insync.replicas=2                  # with RF=3: acks=all needs leader + 1 follower
default.replication.factor=3

# Producer side (application config)
# acks=all                 -> ack only when every in-sync replica has the record (safety)
# enable.idempotence=true  -> broker drops duplicate retries per (producerId, seq) (safety)

# --- LIVENESS: how fast we notice failure and move on ---
replica.lag.time.max.ms=30000          # follower dropped from the ISR after 30 s behind
# controller.quorum.election.timeout.ms (KRaft) -> faster controller failover
#
# Trade-off: with RF=3 and min.insync=2, losing 2 brokers makes the partition
# REJECT writes (NotEnoughReplicas). That is safety winning over liveness, by design.`,
        },
      ],
      keyPoints: [
        'A safety violation is permanent and visible at a point in time. A liveness violation is "not yet".',
        'Consensus keeps safety under asynchrony and promises liveness only under partial synchrony.',
        'Classify each requirement. Safety needs unique constraints or consensus; liveness needs retries, timeouts and capacity.',
      ],
      source: 'Kleppmann — DDIA Ch 8 "Safety and liveness"; Alpern & Schneider, Defining Liveness (1985)',
    },
    {
      heading: 'The two generals problem and FLP: what is impossible, and what still works',
      body: `**Two generals, intuition:** two armies must attack together, and the only way to coordinate is a messenger who may be captured. General A sends "attack at dawn". To know it arrived, A needs an ack. To know the ack arrived, B needs an ack of the ack. However many rounds you add, the sender of the *last* message cannot tell whether it arrived. **No finite protocol over a lossy link gives both sides certainty.**

**What it means for your code:** your NestJS service calls Razorpay or a bank API and the request times out. You *cannot* know whether the charge happened. More messages will not fix that, so stop looking for a protocol that gives certainty and design for uncertainty:
- make the operation **idempotent** (a key carried on every retry),
- **query** the status of the operation instead of guessing,
- **reconcile** later against the provider's settlement file.

Two generals does *not* forbid agreement that is eventually reached with high probability. It forbids *certainty within a bounded number of messages*.

**FLP (Fischer, Lynch, Paterson 1985), intuition:** in a fully **asynchronous** system where even **one** process may **crash**, no **deterministic** algorithm can guarantee that consensus always **terminates**. The reason is that a slow process and a crashed one look the same. There is always some schedule of message delays that keeps the protocol undecided forever.

**What FLP does not forbid. Read each word of its premise:**

| FLP premise | Escape hatch used in practice |
|---|---|
| fully asynchronous | **partial synchrony** (Dwork–Lynch–Stockmeyer 1988): stay safe always and decide once the network is timely. This is Raft and Paxos with timeouts. |
| deterministic | **randomisation** (Ben-Or 1983): terminate with probability 1. Raft's randomised election timeouts help in the same spirit. |
| no failure oracle | **failure detectors** (Chandra–Toueg's ◇S): an "eventually accurate" detector is enough. |
| *guarantee* termination | real systems simply accept that, in theory, they can stall during a bad network period. |

**FLP is about liveness, not safety.** Raft never violates agreement. Under pathological timing it may fail to elect a leader for a while. That is why etcd can be unavailable during a storm of elections but never splits brain.

**Common misreadings to avoid:** "FLP means consensus is impossible" (false: it means guaranteed termination is impossible under asynchrony); "Two generals is why TCP is unreliable" (TCP gives in-order delivery *while the connection lives*, but it cannot tell you whether the peer *processed* your last bytes before the connection broke).`,
      diagram: `Two generals: the last message is always uncertain

  A ── "attack 06:00" ─────────────▶ B      A unsure B got it
  A ◀──────────────── "ack" ──────── B      B unsure A got the ack
  A ── "ack of ack" ───────────X           A unsure again ... forever

Production translation (payment call timed out):
  you ── charge(key=K) ──▶ PSP   ...timeout...
  you ── GET /payments?key=K ──▶ PSP  → status known, or retry charge(key=K)
  nightly: reconcile your ledger against the PSP settlement file`,
      keyPoints: [
        'Two generals: no bounded protocol gives certainty over a lossy link, so design for "unknown outcome".',
        'FLP rules out guaranteed termination for deterministic consensus under full asynchrony with one crash. Safety is still achievable.',
        'Escape hatches: partial synchrony (timeouts), randomisation, eventually-accurate failure detectors.',
      ],
      source: 'Kleppmann — Cambridge ConcDisSys lectures 2 & 6; Fischer, Lynch & Paterson (1985); Dwork, Lynch & Stockmeyer (1988)',
    },
    {
      heading: 'State machine replication and total order broadcast (≡ consensus)',
      body: `**Intuition:** if every replica starts from the same state, applies the same commands in the same order, and the commands are deterministic, then every replica ends in the same state. Replication becomes "agree on the order of the log".

**The broadcast ladder** (Cambridge notes, lecture 4). Each level adds an ordering guarantee:

| Broadcast | Guarantee | Typical implementation |
|---|---|---|
| best-effort | delivered if the sender does not crash | UDP multicast |
| reliable | if one correct node delivers, all correct nodes deliver | gossip / eager re-broadcast |
| FIFO | messages from the **same sender** in send order | sequence numbers per sender |
| causal | if m1 happened-before m2, m1 is delivered first everywhere | vector clocks |
| **total order** | **all nodes deliver all messages in the same order** | single leader + consensus (Raft, ZAB) |

**Total order broadcast ≡ consensus.** The two can be built from each other:
- *TOB → consensus:* every node broadcasts its proposal, and every node decides the **first** proposal it delivers. All nodes see the same first message, so they agree.
- *Consensus → TOB:* run consensus repeatedly, each instance deciding "the next batch of messages for slot k". That is exactly a Raft log, where each index is one decision.

So the FLP result applies to TOB as well: a fault-tolerant totally ordered log needs consensus somewhere.

**How the systems you use map onto this:**
- **Raft log** = total order broadcast. etcd and the Kubernetes API server are state machines replicated over it.
- **Kafka partition** = total order, but *only within the partition*. The partition leader assigns offsets. Leader changes and ISR membership are decided by the controller quorum (KRaft, a Raft variant). There is **no** order across partitions or topics.
- **Postgres streaming replication** = one leader ships its WAL. Followers are deterministic state machines applying it, and failover needs an external consensus system (Patroni + etcd).

**Determinism is the hidden requirement.** \`NOW()\`, \`random()\`, iteration order of a hash map, or calling an external API inside the state machine all make replicas diverge. Resolve them *before* the command enters the log: the leader stamps the timestamp, and the external call becomes its own logged event.

**Where linearizability and causality fit** (details in the CAP & consistency topic):

| Guarantee | Scope | Can it enforce "first claim wins" (unique username)? |
|---|---|---|
| Causal order | partial order: concurrent ops unordered | No. Two concurrent claims are both "fine". |
| Lamport timestamps | total order consistent with causality | Only after hearing from *every* node, so not online and not fault-tolerant |
| Total order broadcast | same delivery order everywhere | Yes, as messages are delivered. Reads may lag, though. |
| Linearizability | single-copy, real-time order for reads and writes | Yes. Build it from TOB by also sequencing reads through the log (or ReadIndex). |`,
      code: [
        {
          language: 'typescript',
          title: 'Linearizable "claim username" on top of a totally ordered log',
          code: `// Any total order broadcast works: one Kafka partition, a Raft log (etcd), etc.
interface OrderedLog<T> {
  append(msg: T): Promise<number>;                  // returns the assigned offset
  read(fromOffset: number): AsyncIterable<{ offset: number; msg: T }>;
}
interface Claim { username: string; userId: string; requestId: string }

export class UsernameRegistry {
  private owners = new Map<string, string>();       // the state machine: username -> userId
  private applied = -1;
  private readonly log: OrderedLog<Claim>;
  constructor(log: OrderedLog<Claim>) { this.log = log; }

  // Apply in log order. Deterministic: first claim for a name wins on EVERY replica.
  private apply(offset: number, c: Claim): void {
    if (!this.owners.has(c.username)) this.owners.set(c.username, c.userId);
    this.applied = offset;
  }

  async claim(username: string, userId: string): Promise<boolean> {
    const requestId = crypto.randomUUID();
    const myOffset = await this.log.append({ username, userId, requestId });
    // Do NOT answer from local state: read the log until we pass our own message,
    // so every earlier claim (from any node) has been applied before we decide.
    for await (const { offset, msg } of this.log.read(this.applied + 1)) {
      this.apply(offset, msg);
      if (offset >= myOffset) break;
    }
    return this.owners.get(username) === userId;
  }
}`,
        },
      ],
      keyPoints: [
        'SMR = deterministic replicas + identical ordered input. Make non-determinism explicit before it enters the log.',
        'TOB and consensus can be built from each other, so a fault-tolerant ordered log needs consensus somewhere.',
        'A Kafka partition is a total order; a topic with many partitions is not.',
      ],
      source: 'Kleppmann — DDIA Ch 9 "Total Order Broadcast"; Cambridge ConcDisSys lectures 4–6',
    },
    {
      heading: 'Encoding and evolution: Avro writer and reader schemas, and schema registries',
      body: `**Intuition:** Protobuf puts a little label (the field tag) on every value, so a reader can skip what it does not recognise. Avro puts **no labels** on the bytes at all, just the values in schema order. That makes it compact, but you can only decode the bytes if you know **exactly which schema wrote them**.

**Writer's schema vs reader's schema.** The decoder holds two schemas:
- the **writer's schema**, the one the producer used (fetched by id), and
- the **reader's schema**, the one your code was compiled against.

Avro **resolves** them *by field name* (and reader-side aliases), not by position:

| Situation | Resolution rule (Avro spec) |
|---|---|
| field in writer, not in reader | ignored, skipped while decoding |
| field in reader, not in writer | reader's **default** is used; no default means a resolution error |
| types differ | allowed only for promotions: int→long/float/double, long→float/double, float→double, string↔bytes |
| enum symbol unknown to reader | the reader enum's default symbol if declared, otherwise an error |
| union in writer | the branch that was written is resolved against the reader's type |

**So the evolution rules are:** add or remove fields **only if they have defaults**; never change a type except along a promotion; rename via an alias on the reader side; and never reuse a name with a new meaning.

**How the reader learns the writer's schema:**
- *Large file* (Avro object container, Parquet-like): schema in the file header, once.
- *Database rows*: a schema version number per row.
- *Kafka*: the **Confluent wire format** puts a magic byte \`0\` and a **4-byte schema id** in front of each message. The consumer fetches the schema from the **schema registry** once and caches it.

**Registry compatibility modes** (Confluent; the default is \`BACKWARD\`):

| Mode | Guarantee | Who upgrades first |
|---|---|---|
| BACKWARD | new schema can read data written by the previous schema | **consumers** |
| FORWARD | previous schema can read data written by the new schema | **producers** |
| FULL | both directions | either |
| *_TRANSITIVE | checked against *all* earlier versions, not only the latest | needed when topics keep old data (long retention, compaction, replay) |
| NONE | no checks | never, on shared topics |

**Why Avro and not Protobuf?** Protobuf (see the API versioning topic) is better for RPC with hand-written schemas. Avro is better for **schemas generated from data**, such as a database table turned into a schema by Debezium. A dropped column just disappears from the writer's schema without anyone having to manage tag numbers. Both need a registry for Kafka.`,
      code: [
        {
          language: 'json',
          title: 'order.avsc v1 → v2: a BACKWARD- and FORWARD-compatible change',
          code: `{
  "type": "record",
  "name": "OrderPlaced",
  "namespace": "in.shop.orders",
  "fields": [
    { "name": "orderId",     "type": "string" },
    { "name": "amountPaise", "type": "long", "aliases": ["amount"] },
    { "name": "currency",    "type": "string", "default": "INR" },
    { "name": "couponCode",  "type": ["null", "string"], "default": null },
    { "name": "status",
      "type": { "type": "enum", "name": "Status",
                "symbols": ["PLACED", "PAID", "CANCELLED"], "default": "PLACED" } }
  ]
}`,
        },
        {
          language: 'bash',
          title: 'Gate schema changes in CI against the registry before deploying',
          code: `# Pin the subject to FULL_TRANSITIVE: topic retention is 30 days and we replay
curl -s -X PUT -H 'Content-Type: application/vnd.schemaregistry.v1+json' \\
  --data '{"compatibility": "FULL_TRANSITIVE"}' \\
  http://schema-registry:8081/config/orders.placed-value

# Test the candidate schema against every registered version; fail the build if incompatible
SCHEMA=$(jq -c . order.avsc | jq -Rs .)
curl -s -X POST -H 'Content-Type: application/vnd.schemaregistry.v1+json' \\
  --data "{\\"schema\\": $SCHEMA}" \\
  'http://schema-registry:8081/compatibility/subjects/orders.placed-value/versions?verbose=true' \\
  | tee result.json | jq -e '.is_compatible == true'`,
        },
      ],
      keyPoints: [
        'Avro bytes carry no tags. Decoding needs the writer\'s schema, resolved by name against the reader\'s.',
        'Defaults make adding and removing fields safe. Renames work via reader aliases.',
        'BACKWARD → upgrade consumers first; FORWARD → producers first; use TRANSITIVE when old data is replayed.',
      ],
      source: 'Kleppmann — DDIA Ch 4 "Avro"; Apache Avro spec — Schema Resolution; Confluent Schema Registry docs',
    },
    {
      heading: 'Rolling upgrades, "data outlives code" and the three modes of dataflow',
      body: `**Intuition:** you never upgrade everything at once. During a rolling deploy, v41 and v42 pods run side by side for minutes. A mobile app can run for *years* without an update. A row written in 2019 is read by code written in 2026. So every encoding decision has to work in both directions in time.

**Definitions you must not mix up:**
- **Backward compatibility:** *newer* code can read data written by *older* code. This is usually easy, because you know the old format.
- **Forward compatibility:** *older* code can read data written by *newer* code. This is harder, because the old code has to tolerate things it has never seen: unknown fields, new enum values, longer strings.

**"Data outlives code."** You deploy new application code in minutes, but the data in your database, your Kafka topics, your S3 lake and your backups stays in the old format until something rewrites it. A schema migration that rewrites a 2 TB table is expensive, so most databases let old rows keep the old encoding (Postgres \`ADD COLUMN\` with a default is metadata-only since PG 11). Your code is effectively reading **every version that has ever been written**.

**The three modes of dataflow** and what each one demands:

| Mode | Who writes, who reads | Compatibility you need | Typical trap |
|---|---|---|---|
| **Through the database** | the process that writes now, read by a later (or older) process | **both** directions, because during a rollout v41 reads rows written by v42 | old code does read-modify-write and **drops the new field** |
| **Through services (REST / gRPC)** | client → server request, server → client response | assume servers deploy first: requests need backward compatibility, responses need forward compatibility | removing a response field that an old mobile app still parses |
| **Through async messages (Kafka, SQS)** | producer → broker → consumers, possibly much later | depends on deploy order; replay makes it **transitive** | a consumer replaying 30 days of data hits a schema version it never knew |

**The read-modify-write trap.** v42 adds \`preferredLanguage\` to a JSONB \`profile\` column. A v41 pod loads the profile into a class with fixed properties, changes the phone number and writes back the *whole* object. The new field is gone, nothing raises an error, and nobody notices for a week. Defences:
- write only the fields you changed (\`jsonb_set\`, or column-level \`UPDATE ... SET phone = $1\`),
- or carry unknown fields through (Protobuf keeps unknown fields in proto3 since 3.5; for JSON keep a catch-all bag),
- and do the **expand → migrate → contract** sequence (see the zero-downtime migration material) so no single deploy breaks either direction.`,
      code: [
        {
          language: 'typescript',
          title: 'Forward-compatible read-modify-write: never drop fields you do not understand',
          code: `import type { Pool } from 'pg';

// v41 knows only these fields; v42 may have added more (e.g. preferredLanguage)
interface ProfileV41 { name: string; phone: string }
type StoredProfile = ProfileV41 & Record<string, unknown>; // keep unknown keys

export async function updatePhone(db: Pool, userId: string, phone: string): Promise<void> {
  // BAD (drops unknown fields):
  //   const p: ProfileV41 = pick(row.profile, ['name', 'phone']);
  //   p.phone = phone;
  //   UPDATE users SET profile = $1        <- v42's preferredLanguage is lost

  // GOOD option 1: change only the key you own, server-side, atomically
  await db.query(
    "UPDATE users SET profile = jsonb_set(profile, '{phone}', to_jsonb($2::text)) WHERE id = $1",
    [userId, phone],
  );
}

// GOOD option 2: if you must rewrite the whole document, spread the original first
export function withPhone(stored: StoredProfile, phone: string): StoredProfile {
  return { ...stored, phone };      // unknown keys from newer writers survive
}

// Also forward-compat on read: unknown enum values must not crash old code
export function parseTier(raw: string): 'GOLD' | 'SILVER' | 'BASIC' | 'UNKNOWN' {
  return raw === 'GOLD' || raw === 'SILVER' || raw === 'BASIC' ? raw : 'UNKNOWN';
}`,
        },
      ],
      keyPoints: [
        'Backward = new reads old; forward = old reads new. Rolling upgrades need both.',
        'Data outlives code: a database holds every encoding ever written.',
        'Old code doing read-modify-write is the most common silent data-loss bug in rollouts.',
      ],
      source: 'Kleppmann — DDIA Ch 4 "Modes of Dataflow"',
    },
    {
      heading: 'Stream–table duality, changelog streams and materialised views',
      body: `**Intuition:** a bank statement and a bank balance are the same information. The balance is what you get by adding up the statement, and the statement is the list of changes to the balance. **A table is the integral of a stream, and a stream is the derivative of a table.**

**Precisely:**
- A **changelog stream** is a sequence of \`(key, newValue)\` records, with \`newValue = null\` meaning delete (a *tombstone*). Replaying it from the beginning rebuilds the table exactly.
- A **compacted Kafka topic** keeps at least the latest record per key, so it is a changelog with bounded size. Tombstones are themselves removed after \`delete.retention.ms\` (24 h by default), so consumers must read the deletion before then.
- A **materialised view** is a table *derived* from one or more streams by a deterministic function, kept up to date incrementally instead of recomputed per query.

**Where you already use this without calling it duality:**
- Postgres **WAL** → replicas (the replica is a materialised view of the WAL).
- **Debezium CDC** → \`orders\` topic → Elasticsearch index (a view of the orders table).
- Kafka Streams **KTable** / ksqlDB \`TABLE\`: the state is in RocksDB and backed by a changelog topic. That changelog is what lets a crashed instance restore its state.
- **Redis leaderboard** fed from score events.

**Why this matters in design interviews:**
1. **Rebuildability.** If the view is a pure function of the log, a corrupted Elasticsearch index or a bad view-code release is fixed by replaying into a fresh index and switching an alias. You can only do this while the log still covers the history: use compaction or long retention, plus a snapshot ("log compaction" + "initial snapshot" in CDC terms).
2. **Incremental maintenance.** \`SUM\`/\`COUNT\` update in O(1) per event. \`MAX\` is not invertible: if the max row is deleted you need the other values, so the operator keeps more state.
3. **Retractions.** When an input row changes, an aggregate must *subtract* the old contribution and add the new one. Kafka Streams sends old+new values internally, and Flink emits \`-U/+U\` changelog rows. A sink that cannot apply updates (append-only files) will double count.`,
      code: [
        {
          language: 'sql',
          title: 'ksqlDB: stream → table (aggregation) → table (changelog) duality',
          code: `-- A stream: every order event, append-only
CREATE STREAM orders (
  order_id VARCHAR KEY, customer_id VARCHAR, city VARCHAR, amount_paise BIGINT
) WITH (KAFKA_TOPIC = 'orders.placed', VALUE_FORMAT = 'AVRO');

-- A table derived from the stream: state per key, backed by a compacted changelog
CREATE TABLE revenue_by_city AS
  SELECT city, SUM(amount_paise) AS revenue_paise, COUNT(*) AS orders
  FROM orders
  GROUP BY city
  EMIT CHANGES;

-- The table is itself a stream of updates: every change re-emits (city, newValue)
SELECT * FROM revenue_by_city EMIT CHANGES;

-- Pull query: point-in-time read of the materialised state (served from RocksDB)
SELECT revenue_paise FROM revenue_by_city WHERE city = 'Bengaluru';`,
        },
      ],
      keyPoints: [
        'Table = fold(changelog); changelog = diffs(table). A tombstone (null value) is a delete.',
        'Compacted topics keep the latest value per key, and tombstones expire after delete.retention.ms.',
        'Views that are pure functions of a retained log can be rebuilt by replay and swapped in.',
      ],
      source: 'Kleppmann — DDIA Ch 11 "Databases and Streams"; Kafka Streams docs (KTable, changelog topics)',
    },
    {
      heading: 'Stream joins: stream-stream, stream-table, table-table, and why joins depend on time',
      body: `**Intuition:** joining two database tables is easy because both are sitting still. Joining streams means at least one side is *still arriving*, so you have to decide **how long to wait** and **which version of the other side counts**.

**The three joins:**

| Join | Example | State kept | Output |
|---|---|---|---|
| **Stream-stream (window)** | ad impressions ⋈ clicks within 30 min, to compute CTR | both sides, buffered for the window | one row per match. Outer joins also emit "no match" once the window closes. |
| **Stream-table (enrichment)** | each order event + the customer's current tier and city | the table (from its changelog) | one enriched event per stream event |
| **Table-table (materialised join)** | user timeline cache = tweets ⋈ follows | both tables | an updated joined row whenever *either* side changes |

**Time-dependence is the subtle part.** In a stream-table join, the answer depends on *when* you look up the table:
- **Processing-time lookup** ("the table as it is right now"). This is simple and what a naive KStream-KTable join does. But **replaying the same input gives a different output**, because the table has moved on. An audit that recomputes last month's GST invoices with *today's* customer state gets different numbers.
- **Event-time (temporal / as-of) lookup** ("the version valid at the event's timestamp"). This is deterministic on replay. It needs a **versioned table**: a history of values per key with validity timestamps, kept for a retention period. Flink: \`FOR SYSTEM_TIME AS OF o.order_time\`. Kafka Streams 3.5+ has versioned state stores (KIP-889), and stream-table joins against them look up by timestamp (KIP-914).
- Data warehouses call this a **slowly changing dimension (Type 2)**: give every version an id and validity range, and have the fact row reference the version id. The join is then deterministic forever.

**Late and out-of-order updates.** If the table update for 10:00 arrives after the order at 10:01 has already been enriched, you have three options: (a) wait, by holding stream events until the table side's watermark passes their timestamp (adds latency); (b) emit now and later emit a **correction**/retraction (the sink must accept upserts); (c) accept the error and count it in a metric. Pick per use case: fraud scoring takes (c), billing takes (a) or (b).

**Stream-stream state math:** state ≈ rate × window × record size, per side. 100K impressions/s × 1,800 s × 200 B ≈ 36 GB, which is why such joins live in RocksDB with incremental checkpoints and why the window must be bounded.`,
      code: [
        {
          language: 'sql',
          title: 'Flink SQL: interval (stream-stream) join and temporal (as-of) stream-table join',
          code: `-- Stream-stream: a click counts only within 30 min after its impression.
-- Flink can drop state older than the interval once the watermark passes it.
SELECT i.imp_id, i.campaign_id, c.click_time
FROM impressions i
JOIN clicks c
  ON c.imp_id = i.imp_id
 AND c.click_time BETWEEN i.imp_time AND i.imp_time + INTERVAL '30' MINUTE;

-- Versioned table: needs a PRIMARY KEY and an event-time attribute with a watermark
CREATE TABLE merchant_risk (
  merchant_id STRING,
  risk_tier   STRING,
  updated_at  TIMESTAMP(3),
  WATERMARK FOR updated_at AS updated_at - INTERVAL '5' SECOND,
  PRIMARY KEY (merchant_id) NOT ENFORCED
) WITH ('connector' = 'upsert-kafka', 'topic' = 'merchant.risk',
        'key.format' = 'raw', 'value.format' = 'avro-confluent',
        'value.avro-confluent.url' = 'http://schema-registry:8081');

-- Temporal join: the risk tier valid AT payment time, deterministic on replay
SELECT p.payment_id, p.amount, r.risk_tier
FROM payments AS p
JOIN merchant_risk FOR SYSTEM_TIME AS OF p.paid_at AS r
  ON p.merchant_id = r.merchant_id;`,
        },
      ],
      keyPoints: [
        'Stream-stream joins need a bounded window. Stream-table joins enrich. Table-table joins maintain a joined view.',
        'A processing-time table lookup is non-deterministic on replay. Use temporal (as-of) joins on versioned tables for audits.',
        'Late table updates: wait (latency), emit corrections (upsert sink), or accept and measure.',
      ],
      source: 'Kleppmann — DDIA Ch 11 "Stream Joins" & "Time-dependence of joins"; Flink docs (interval & temporal joins); KIP-889 / KIP-914',
    },
    {
      heading: 'Derived data and "unbundling the database"',
      body: `**Intuition:** inside one database, the secondary index, the materialised view and the replica are all *derived* from the table and kept in sync automatically. The well-known 2015 idea "turning the database inside out" asks: what if we pulled those pieces out, made the **replication log** a first-class, public thing, and built every index, cache and view as an independent consumer of it?

**System of record vs derived data:**
- **System of record (source of truth):** where a fact is written first and authoritatively, e.g. the Postgres \`orders\` table or an event log. If it disagrees with anything, it wins.
- **Derived data:** anything you can recompute from it, e.g. the Elasticsearch index, the Redis cache, the ClickHouse rollups, the recommendation features. If you lose it, rebuild it. If it is wrong, recompute it.

The talk shows that databases already contain four kinds of derived data: **replication, secondary indexes, caches and materialised views**. Application-managed caches are the messy one (invalidation races, cold starts) because they are maintained *outside* the ordered change stream.

**The unbundled architecture:**
1. Writes go to the system of record. Either the application appends events, or Postgres is captured with **CDC** (Debezium reading the WAL via logical decoding, using the outbox pattern for domain events).
2. The **log** (Kafka) gives a durable, ordered (per key) stream of changes.
3. Each derived view is a **consumer** that applies changes idempotently and deterministically.
4. Reads go to the view best suited for them.

**Why it beats dual writes:** with \`db.save(); es.index(); redis.del();\` in application code, two concurrent requests can apply in different orders to different stores, and a crash in the middle leaves them permanently inconsistent. With a single ordered log, **every view sees the same order**. So views converge, and a crash only delays them.

**What you pay for:**
- **Asynchrony.** Views lag (typically 50 ms to a few seconds). Read-your-writes needs a trick: read the system of record for the writer's own data, or wait until the view's applied position (LSN or offset) is ≥ the position of the write.
- **Ordering only per partition.** Two entities on different partitions have no relative order, so key by the entity whose invariants matter.
- **Constraints.** Uniqueness and other cross-entity invariants must be checked *before* the write enters the log (in the system of record or via a single-partition validator), not in the views.
- **Operational weight.** Kafka, Connect, a schema registry and stream processors are a platform. For a 3-person team, \`LISTEN/NOTIFY\` plus a polling outbox may be the honest answer.

**Evolution superpower:** to change a view's shape, build **v2 next to v1** by replaying the log from the start, compare them, then switch reads. That is a schema migration without a stop-the-world \`ALTER\`.`,
      diagram: `             writes                              reads
  NestJS API ───────▶ Postgres (system of record)
                         │ WAL (logical decoding)
                         ▼
                     Debezium ──▶ Kafka topic orders (keyed by order_id,
                                  compacted + snapshot = full history)
            ┌────────────────┬───────┴─────────┬─────────────────┐
            ▼                ▼                 ▼                 ▼
     search-indexer    cache-updater     revenue rollup     ML features
     Elasticsearch     Redis             ClickHouse         feature store
     (version=LSN)     (SET if newer)    (idempotent MV)    (replayable)
            ▲                ▲                 ▲
            └────── derived: rebuild any of these by replaying the log ──────┘`,
      code: [
        {
          language: 'typescript',
          title: 'Idempotent, order-safe view builder: Elasticsearch external versioning with the source LSN',
          code: `import { Client, errors } from '@elastic/elasticsearch';
import { Kafka } from 'kafkajs';

const es = new Client({ node: 'http://es:9200' });
const consumer = new Kafka({ brokers: ['kafka:9092'] }).consumer({ groupId: 'orders-search-v2' });

// Debezium envelope (simplified): op c/u/d, after = row image, source.lsn = WAL position
interface Change { op: 'c' | 'u' | 'd' | 'r'; after: Record<string, unknown> | null; source: { lsn: number } }

export async function run(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: 'pg.public.orders', fromBeginning: true }); // replayable view
  await consumer.run({
    eachMessage: async ({ message }) => {
      const id = message.key!.toString();
      if (!message.value) return;                 // Kafka tombstone after a delete: nothing to do
      const ch = JSON.parse(message.value.toString()) as Change;
      const version = ch.source.lsn;              // monotonic per row; survives topic re-creation
      try {
        if (ch.op === 'd') {
          await es.delete({ index: 'orders', id, version, version_type: 'external' });
        } else {
          await es.index({ index: 'orders', id, version, version_type: 'external', document: ch.after });
        }
      } catch (e) {
        // 409 = we already hold a NEWER version (a redelivery or a replay): safe to skip
        if (e instanceof errors.ResponseError && e.statusCode === 409) return;
        if (e instanceof errors.ResponseError && e.statusCode === 404 && ch.op === 'd') return;
        throw e;                                  // anything else: do not commit the offset; retry
      }
    },
  });
}`,
        },
      ],
      keyPoints: [
        'System of record wins disagreements. Derived views are disposable and rebuildable.',
        'One ordered log feeding all views replaces racy dual writes; views converge, they do not diverge.',
        'Pay for it with lag (read-your-writes tricks), per-partition order only, and checking invariants before the log.',
      ],
      source: 'Kleppmann — "Turning the database inside out" (2015); DDIA Ch 11 "Change Data Capture" & Ch 12 "Unbundling Databases"',
    },
    {
      heading: 'The end-to-end argument applied to exactly-once and deduplication',
      body: `**Intuition:** a courier company that guarantees each *leg* of the journey (truck, warehouse, van) still cannot promise you got the parcel. Only *you* signing for it at the door proves it. Saltzer, Reed and Clark (1984) said this about systems: **a function can be implemented completely and correctly only with the knowledge of the application at the endpoints.** Lower layers can help with *performance*, but cannot provide the *guarantee*.

**Apply it to "exactly-once":**
- **TCP** de-duplicates packets *within one connection*. If the connection dies after the server processed the request and before the response arrived, the client retries on a new connection, and TCP cannot know it is a duplicate.
- **Kafka EOS** (idempotent producer + transactions + \`read_committed\`) makes a *read-process-write cycle inside Kafka* atomic. It does not cover the user's double-tap on "Pay", the HTTP retry from the mobile app, or the side effect your consumer performs on an external API.
- **Database transactions** make a single DB write atomic, but cannot tell that two transactions represent the same user intent.

**The end-to-end fix ("operation identifiers"):** generate a **unique request id at the very start** (the client, when the user taps the button), carry it through every hop (HTTP header → Kafka message → consumer), and enforce uniqueness **at the final point of effect**, in the same transaction as the effect. Every intermediate layer can then retry freely.

**Same argument, other properties:**
- **Integrity:** TCP checksums and disk ECC miss bugs in your own code. End-to-end checksums (an S3 \`Content-MD5\`/CRC header computed by the client) detect corruption anywhere on the path.
- **Encryption:** TLS per hop still exposes data at every proxy, so end-to-end encryption is needed if intermediaries are untrusted.
- **Auditing over trusting:** "Trust, but verify" means continuously re-checking derived data against the system of record (reconciliation jobs), because each layer's guarantee is weaker than the whole.

**Interview phrasing:** "Kafka exactly-once is necessary for my stream job, not sufficient for the business. The business guarantee is a unique constraint on \`request_id\` at the ledger, checked in the same transaction as the debit."`,
      code: [
        {
          language: 'sql',
          title: 'Point-of-effect dedup: request id from the client, enforced with the debit',
          code: `-- request_id is generated by the app when the user taps "Pay" and is resent on every retry
CREATE TABLE transfer_requests (
  request_id  uuid PRIMARY KEY,           -- the end-to-end operation id
  from_acct   bigint NOT NULL,
  to_acct     bigint NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Consumer of the transfers topic (at-least-once delivery), one transaction per message
BEGIN;
WITH ins AS (
  INSERT INTO transfer_requests (request_id, from_acct, to_acct, amount)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (request_id) DO NOTHING         -- duplicate from ANY layer: no-op
  RETURNING request_id, from_acct, to_acct, amount
)
INSERT INTO ledger_entries (request_id, account_id, delta)
SELECT request_id, from_acct, -amount FROM ins
UNION ALL
SELECT request_id, to_acct, amount FROM ins;  -- zero rows if the request was a duplicate
COMMIT;
-- Only after COMMIT: commit the Kafka offset. A crash in between just replays -> no-op.`,
        },
      ],
      keyPoints: [
        'The guarantee lives at the endpoints. Lower-layer exactly-once and checksums only help performance and coverage.',
        'Generate the operation id where the intent is born, carry it everywhere, enforce it at the point of effect.',
        'Kafka EOS is per read-process-write inside Kafka. It is not end-to-end.',
      ],
      source: 'Saltzer, Reed & Clark — End-to-End Arguments in System Design (1984); Kleppmann — DDIA Ch 12 "The end-to-end argument for databases"',
    },
    {
      heading: 'Byzantine fault tolerance: when it actually matters',
      body: `**Intuition:** crash-fault protocols assume a node is either correct or silent. Byzantine fault tolerance assumes some nodes may **lie**: sign contradictory messages, report fake votes, or tell half the cluster one thing and the other half another (*equivocation*).

**The price:**
- **3f + 1 nodes** to tolerate **f** Byzantine nodes, versus 2f + 1 for crash faults (Lamport, Shostak & Pease). So 4 nodes tolerate 1 traitor and 7 tolerate 2.
- **Quorums of 2f + 1**, so any two quorums overlap in at least one *honest* node.
- **More messages:** PBFT (Castro & Liskov 1999) has all-to-all phases, O(n²) messages per decision, plus signatures on everything. HotStuff-style protocols reduce that to linear communication with a rotating leader.

**When it is worth it:**

| Setting | Why BFT |
|---|---|
| **Public blockchains / cryptocurrencies** | participants are anonymous and financially motivated to cheat (proof-of-work or proof-of-stake with BFT finality) |
| **Permissioned consortia** (several banks or companies sharing a ledger) | members are known but do not fully trust each other (Tendermint/CometBFT, HotStuff-family) |
| **Aerospace / safety-critical control** | radiation bit-flips and faulty sensors can make hardware send wrong values |

**When it is not (most of what you build):** all nodes run *your* code, in *your* VPC, deployed by *your* pipeline. If one node is compromised, the attacker usually has the deploy key for all of them, so BFT does not help. A bug in your code is also present on every replica, and BFT assumes failures are independent. Use Raft/etcd and spend the budget elsewhere.

**What you do need instead, the "weak Byzantine" defences:**
- **Untrusted clients are Byzantine.** Validate every input on the server, never trust a client-computed price, and verify signatures (webhook HMACs, JWT).
- **Corruption:** checksums on disk and network payloads (Kafka record CRCs, S3 checksums), and Postgres \`data_checksums\`.
- **Tamper evidence without consensus:** a hash-chained or Merkle-tree audit log (as in Certificate Transparency). An insider can still delete it, but cannot *silently* rewrite history once a digest is published externally.

**Interview trap:** "We'll use a blockchain for our internal audit log." Ask who the mutually distrusting parties are. If the answer is "none", an append-only table with a hash chain and an externally anchored digest gives the same tamper evidence, with millisecond latency.`,
      code: [
        {
          language: 'typescript',
          title: 'Tamper-evident audit log: a hash chain instead of a blockchain',
          code: `import { createHash } from 'node:crypto';

interface AuditEntry { seq: number; at: string; actor: string; action: string; prevHash: string; hash: string }

const digest = (e: Omit<AuditEntry, 'hash'>): string =>
  createHash('sha256').update(JSON.stringify([e.seq, e.at, e.actor, e.action, e.prevHash])).digest('hex');

export function append(log: AuditEntry[], actor: string, action: string, now: Date): AuditEntry {
  const prev = log.at(-1);
  const base = { seq: (prev?.seq ?? 0) + 1, at: now.toISOString(), actor, action, prevHash: prev?.hash ?? 'GENESIS' };
  const entry = { ...base, hash: digest(base) };
  log.push(entry);                 // in production: INSERT in the same txn as the audited change
  return entry;
}

// Anyone holding a published head hash (e.g. emailed daily to compliance)
// can detect a rewrite of ANY earlier entry.
export function verify(log: AuditEntry[], publishedHead: string): boolean {
  let prev = 'GENESIS';
  for (const e of log) {
    if (e.prevHash !== prev || digest(e) !== e.hash) return false;
    prev = e.hash;
  }
  return prev === publishedHead;
}`,
        },
      ],
      keyPoints: [
        'BFT: 3f+1 nodes, 2f+1 quorums, signatures, O(n²) messages in PBFT. Worth it only among mutually distrusting parties.',
        'Inside one organisation, correlated bugs and shared credentials defeat BFT. Use crash-fault consensus.',
        'Treat clients as Byzantine (validate, sign, check), and use checksums and hash chains for corruption and tamper evidence.',
      ],
      source: 'Kleppmann — DDIA Ch 8 "Byzantine Faults"; Lamport, Shostak & Pease (1982); Castro & Liskov — PBFT (1999)',
    },
    {
      heading: 'What DDIA 2nd edition (2026) adds that is worth knowing',
      body: `**Context:** the second edition of *Designing Data-Intensive Applications* (O'Reilly, March 2026) keeps the first edition's goals and scope but is revised throughout. These are the changes that can be verified from the authors' announcement, the preface and published chapter outlines. This is not a full diff.

| Change | Why it matters for your interviews |
|---|---|
| **New Ch 1: "Trade-offs in Data Systems Architecture"** | Frames design as trade-offs: operational vs analytical systems, **cloud services vs self-hosting**, and single-node vs distributed systems. Interviewers now expect "managed service or self-run, and why" as an explicit decision. |
| **Ch 2: "Defining Nonfunctional Requirements"** | Reliability, scalability and maintainability are recast as requirements you define and measure (percentiles, load parameters), which is how a design round starts. |
| **Cloud-native data architecture** | The authors name the shift to cloud services as the biggest change since 2017. **Object storage** (S3 and similar) is a first-class building block: databases separate storage and compute, keep data in object storage and use local disks as a cache. |
| **Vector indexes** in the storage/indexing chapter (e.g. **HNSW**) | Semantic search and embeddings are part of mainstream indexing now, so know the ANN trade-off (recall vs latency vs memory). |
| **AI-era batch and data processing** | DataFrames and batch systems for preparing training data are covered alongside classic batch processing. |
| **"Partitioning" is now "Sharding"** (Ch 7 in the new numbering) | Matches industry vocabulary. Same ideas: key-range vs hash, rebalancing, secondary indexes. |
| **Local-first software and sync engines** | Multi-device sync, CRDTs and offline-first apps are treated as a replication topic. |
| **Expanded consistency and consensus material**, plus workflow engines, formal methods and GraphQL among the additions named in the preface | Durable execution (Temporal-style workflows) and model checking now sit next to sagas and Raft in the canon. |
| **Final chapters on derived state, law and society** | The "unbundling" ideas continue, alongside privacy, regulation and the social consequences of data systems. |

**How to use this in an interview:** don't cite the book. Use its *framing*. For example: "This is a system of record, the search index is derived, and I'd use the managed Postgres service rather than self-hosting because our team is small. Storage is in object storage, so compute can scale independently."`,
      keyPoints: [
        'DDIA 2e (2026): a new trade-offs chapter, cloud and object-storage-first architecture, vector indexes, local-first/sync.',
        '"Sharding" replaces "Partitioning" as the chapter name. The ideas are unchanged.',
        'Use the framing (system of record vs derived, cloud vs self-host), not the citation.',
      ],
      source: 'Kleppmann — DDIA 2e announcement (martin.kleppmann.com, 24 Mar 2026); DDIA 2e preface; ScyllaDB-hosted 2e sample chapters',
    },
  ],
  codeChallenges: [
    {
      id: 'ds-theory-cc-1',
      title: 'Fix a Kafka consumer that decodes Avro by position and corrupts amounts after a schema change',
      context:
        'The payments-reporting service consumes orders.placed (Avro, Confluent wire format). Last week the checkout team added an optional couponCode field in the middle of the record, and the registry accepted it as BACKWARD-compatible. Since then the reporting dashboard shows amounts like "DIWALI50", and a burst of 5,000 msg/s sends the schema registry to 100% CPU. The decoder below was written by hand because "Avro is just values in order". (In this exercise the Avro binary body is stood in for by a JSON array of values in writer-field order.)',
      task:
        'Rewrite the decoder so that it resolves the writer\'s schema (from the 5-byte header) against the service\'s reader schema according to Avro\'s schema resolution rules: match by name (with reader aliases), use defaults for reader-only fields, skip writer-only fields, allow only legal type promotions and handle unknown enum symbols. Incompatibilities must be detected once per schema id, not per message, and the registry must not be called per message.',
      starter: {
        language: 'typescript',
        title: 'order-decoder.ts (starter)',
        code: `interface Field { name: string; type: unknown; default?: unknown }
interface RecordSchema { name: string; fields: Field[] }
interface Registry { getById(id: number): Promise<RecordSchema> }

export class OrderDecoder {
  private readonly registry: Registry;
  private readonly reader: RecordSchema;   // the schema this service was compiled with
  constructor(registry: Registry, reader: RecordSchema) {
    this.registry = registry;
    this.reader = reader;
  }

  async decode(buf: Buffer): Promise<Record<string, unknown>> {
    const schemaId = buf.readUInt32BE(1);
    // Fetch the writer schema "to be safe"... on every single message
    const writer = await this.registry.getById(schemaId);
    if (writer.fields.length !== this.reader.fields.length) {
      console.warn('schema mismatch for id ' + schemaId);   // log and carry on
    }
    const values = JSON.parse(buf.subarray(5).toString('utf8')) as unknown[]; // stand-in for Avro binary
    const out: Record<string, unknown> = {};
    // Avro has no tags, so walk the fields in order
    this.reader.fields.forEach((f, i) => {
      out[f.name] = values[i];                                // position i in the READER schema
    });
    return out;
  }
}`,
      },
      hints: [
        'Avro bytes have no field tags, so position i in the reader schema means nothing. What tells you which value is which?',
        'Resolution depends only on the (writer schema, reader schema) pair. Compile it into a plan once and cache the plan per schema id. Cache the promise, not the result, so concurrent messages share one registry call.',
        'Reader field missing in the writer → default or error. Writer field missing in the reader → skip. int→long→float→double and string↔bytes are the only legal type changes.',
      ],
      solution: {
        language: 'typescript',
        title: 'schema-resolver.ts (solution)',
        code: `type Primitive = 'int' | 'long' | 'float' | 'double' | 'string' | 'bytes' | 'boolean';
type FieldType = Primitive | { type: 'enum'; symbols: string[]; default?: string } | ['null', Primitive];
interface Field { name: string; type: FieldType; default?: unknown; aliases?: string[] }
interface RecordSchema { name: string; fields: Field[] }
interface Registry { getById(id: number): Promise<RecordSchema> }

// Avro spec promotions: the reader may widen what the writer wrote
const PROMOTE: Record<Primitive, Primitive[]> = {
  int: ['int', 'long', 'float', 'double'],
  long: ['long', 'float', 'double'],
  float: ['float', 'double'],
  double: ['double'],
  string: ['string', 'bytes'],
  bytes: ['bytes', 'string'],
  boolean: ['boolean'],
};

type Step = (writerValues: unknown[]) => unknown;

export class SchemaResolver {
  private plans = new Map<number, Promise<(v: unknown[]) => Record<string, unknown>>>();

  private readonly registry: Registry;
  private readonly reader: RecordSchema;
  constructor(registry: Registry, reader: RecordSchema) {
    this.registry = registry;
    this.reader = reader;
  }

  // Confluent wire format: byte 0 = magic 0, bytes 1..4 = big-endian schema id
  async decode(buf: Buffer): Promise<Record<string, unknown>> {
    if (buf[0] !== 0) throw new Error('unknown magic byte');
    const schemaId = buf.readUInt32BE(1);
    const values = JSON.parse(buf.subarray(5).toString('utf8')) as unknown[]; // stand-in for Avro binary
    let plan = this.plans.get(schemaId);
    if (!plan) {
      // cache the promise, so 500 concurrent messages trigger ONE registry call
      plan = this.registry.getById(schemaId).then((w) => this.compile(w));
      plan.catch(() => this.plans.delete(schemaId)); // do not cache failures forever
      this.plans.set(schemaId, plan);
    }
    return (await plan)(values);
  }

  // Resolution happens once per (writer, reader) pair; per-message work is array lookups.
  private compile(writer: RecordSchema): (v: unknown[]) => Record<string, unknown> {
    const steps: [string, Step][] = this.reader.fields.map((rf) => {
      const names = [rf.name, ...(rf.aliases ?? [])];
      const wi = writer.fields.findIndex((wf) => names.includes(wf.name)); // match by NAME
      if (wi === -1) {
        if (!('default' in rf)) throw new Error('reader field ' + rf.name + ' missing in writer and has no default');
        return [rf.name, () => rf.default];
      }
      return [rf.name, this.convert(writer.fields[wi].type, rf, wi)];
    });
    // writer-only fields are simply never read: that is what makes adding fields safe
    return (values) => Object.fromEntries(steps.map(([n, s]) => [n, s(values)]));
  }

  private convert(wt: FieldType, rf: Field, i: number): Step {
    const rt = rf.type;
    if (typeof rt === 'object' && !Array.isArray(rt)) {
      if (typeof wt !== 'object' || Array.isArray(wt)) throw new Error(rf.name + ': enum vs non-enum');
      return (v) => {
        const s = v[i] as string;
        if (rt.symbols.includes(s)) return s;
        if (rt.default !== undefined) return rt.default; // unknown symbol from a newer writer
        throw new Error(rf.name + ': unknown enum symbol ' + s);
      };
    }
    const rBase = Array.isArray(rt) ? rt[1] : rt;
    const wBase = Array.isArray(wt) ? wt[1] : (wt as Primitive);
    if (!PROMOTE[wBase].includes(rBase)) throw new Error(rf.name + ': cannot read ' + wBase + ' as ' + rBase);
    if (Array.isArray(wt) && !Array.isArray(rt)) {
      // writer may send null but reader cannot hold it: fail on the value, not at compile time
      return (v) => { if (v[i] === null) throw new Error(rf.name + ': null for non-null'); return v[i]; };
    }
    return (v) => v[i];
  }
}`,
      },
      explanation: `**What was wrong and how it is fixed:**

1. **Positional decoding against the reader schema.** Avro values are in *writer* order. Inserting \`couponCode\` shifted every later value, so \`amount\` received the coupon string. The fix matches fields **by name** (and by reader \`aliases\`), which is exactly the Avro resolution algorithm.
2. **Ignored mismatches.** The starter logged a warning and returned garbage. The fix fails at **plan compile time** with a precise error ("reader field tip missing in writer and has no default"). A poison schema is then rejected loudly and once, and can go to a DLQ with the schema id.
3. **Defaults and skipped fields.** Reader-only fields take their declared default (\`currency\` → "INR"). Writer-only fields are never read, and that is what makes adding a field safe.
4. **Type changes.** Only the spec's promotions are allowed (int→long/float/double, long→float/double, float→double, string↔bytes). A nullable writer field read into a non-null reader field fails on the null *value*, not on the schema.
5. **Enums from newer writers.** An unknown symbol (REFUNDED) maps to the reader enum's default (Avro 1.9+) instead of crashing old consumers. That is forward compatibility.
6. **Registry storm.** Plans are cached per schema id as **promises**, so 500 concurrent messages with a new id cause one registry call, and failures are evicted so they can be retried. Per-message work becomes array lookups: about 1 µs instead of a network call of 1–5 ms.
7. **Magic byte check.** A non-zero first byte means the message is not in the Confluent wire format (e.g. plain JSON from a misconfigured producer), so reject it instead of misreading 4 bytes as a schema id.`,
      followUps: [
        {
          q: 'The checkout team now wants to change amount from int (rupees) to long (paise). The registry says it is compatible. Is it safe?',
          a: 'It is compatible in *type* (int→long is a legal promotion), but not in *meaning*: old records hold rupees and new ones paise, and the resolver would happily read 49 as 49 paise. A unit change is a semantic break that no schema check can see. Add a new field \`amountPaise\` with a default, dual-write both for a deprecation window, migrate consumers, then drop \`amount\`. Never reuse a field name with a new meaning.',
        },
        {
          q: 'How would you test this resolver so a future schema change cannot regress it?',
          a: 'Keep every registered version of the subject as a fixture (pull them from the registry in CI). For each (writer version, current reader) pair, encode a sample record with the real Avro library and assert that the decoded result matches the expected object, including defaults and alias renames. Add property tests: random records under writer v1 decoded with reader vN must never throw for compatible pairs. Run the registry\'s own compatibility endpoint with FULL_TRANSITIVE in the same pipeline, so a schema the resolver cannot read never reaches the topic.',
        },
      ],
    },
    {
      id: 'ds-theory-cc-2',
      title: 'Make an order-enrichment stream-table join correct on replay, deletes and late updates',
      context:
        'A fraud and billing service enriches every order event with the customer\'s tier and city, taken from a compacted customers changelog topic (Debezium CDC from Postgres). Billing applies tier discounts, and finance re-runs last month\'s orders through the same code for GST audits. Three incidents: (1) right after a deploy the first few thousand orders are enriched with customer = null; (2) deleted (GDPR-erased) customers are still being enriched with their old data; (3) the audit replay produced different discounts from the original run.',
      task:
        'Rewrite the join so that each order is enriched with the customer version that was valid at the order\'s event time, tombstones are honoured as deletes, orders are not emitted before the table side has caught up to their timestamp (up to a configured allowed lateness), out-of-order table updates are placed correctly, late table updates are counted, and memory is bounded by a retention horizon.',
      starter: {
        language: 'typescript',
        title: 'order-enrichment.ts (starter)',
        code: `interface Customer { tier: 'GOLD' | 'SILVER' | 'BASIC'; city: string }
interface OrderEvent { orderId: string; customerId: string; ts: number; amount: number }
interface Enriched extends OrderEvent { customer: Customer | null }

export class EnrichmentJoin {
  private customers = new Map<string, Customer>();
  private readonly emit: (e: Enriched) => void;
  constructor(emit: (e: Enriched) => void) { this.emit = emit; }

  // consumer of the compacted customers changelog topic
  onTableUpdate(customerId: string, value: Customer | null, _ts: number): void {
    if (!value) return;                       // skip bad records
    this.customers.set(customerId, value);
  }

  // consumer of the orders topic (runs in parallel with the one above)
  onOrder(e: OrderEvent): void {
    this.emit({ ...e, customer: this.customers.get(e.customerId) ?? null });
  }
}`,
      },
      hints: [
        'A Map of "latest value" answers "what is the customer now?", but the question is "what was the customer at order time?". What structure answers as-of queries?',
        'A null value on a compacted topic is a tombstone, a real delete, not a bad record. Store it as a version so lookups after it return null.',
        'You cannot know the table is complete up to time T unless you track a watermark for the table side. Hold orders until the watermark passes them, then prune history older than watermark − retention, but keep the newest version before the horizon.',
      ],
      solution: {
        language: 'typescript',
        title: 'temporal-enrichment-join.ts (solution)',
        code: `interface Customer { tier: 'GOLD' | 'SILVER' | 'BASIC'; city: string }
interface OrderEvent { orderId: string; customerId: string; ts: number; amount: number }
interface Enriched extends OrderEvent { customer: Customer | null }
interface Version { ts: number; value: Customer | null } // value null = tombstone (deleted)

export class TemporalEnrichmentJoin {
  private history = new Map<string, Version[]>(); // per key, sorted by ts
  private pending: OrderEvent[] = [];             // orders waiting for the table to catch up
  private tableWatermark = -Infinity;             // "no table update older than this will still arrive"
  lateTableUpdates = 0;
  private readonly lateness: number;
  private readonly retention: number;
  private readonly emit: (e: Enriched) => void;

  constructor(opts: { allowedLatenessMs: number; retentionMs: number; emit: (e: Enriched) => void }) {
    this.lateness = opts.allowedLatenessMs;
    this.retention = opts.retentionMs;
    this.emit = opts.emit;
  }

  onTableUpdate(customerId: string, value: Customer | null, ts: number): void {
    if (ts <= this.tableWatermark) this.lateTableUpdates++; // too late: orders before ts were already emitted
    const versions = this.history.get(customerId) ?? [];
    let i = versions.length;
    while (i > 0 && versions[i - 1].ts > ts) i--;           // insert in ts order (updates can be out of order)
    if (versions[i - 1]?.ts === ts) versions[i - 1] = { ts, value }; // idempotent replay of the same version
    else versions.splice(i, 0, { ts, value });
    this.history.set(customerId, versions);
    this.tableWatermark = Math.max(this.tableWatermark, ts - this.lateness);
    this.flush();
  }

  onOrder(e: OrderEvent): void {
    this.pending.push(e);
    this.flush();
  }

  // The version valid at event time: last version with ts <= e.ts (binary search)
  private asOf(customerId: string, ts: number): Customer | null {
    const v = this.history.get(customerId);
    if (!v) return null;
    let lo = 0, hi = v.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (v[mid].ts <= ts) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans === -1 ? null : v[ans].value;
  }

  private flush(): void {
    const ready = this.pending.filter((e) => e.ts <= this.tableWatermark);
    this.pending = this.pending.filter((e) => e.ts > this.tableWatermark);
    for (const e of ready.sort((a, b) => a.ts - b.ts)) {
      this.emit({ ...e, customer: this.asOf(e.customerId, e.ts) });
    }
    this.prune();
  }

  // Keep the newest version older than the horizon (it is still "current" for later orders)
  private prune(): void {
    const horizon = this.tableWatermark - this.retention;
    for (const [k, v] of this.history) {
      let cut = 0;
      while (cut + 1 < v.length && v[cut + 1].ts <= horizon) cut++;
      if (cut > 0) v.splice(0, cut);
      if (v.length === 1 && v[0].value === null && v[0].ts <= horizon) this.history.delete(k);
    }
  }
}`,
      },
      explanation: `**Fixes, mapped to the incidents:**

1. **Nulls after deploy (bootstrap race).** The starter emitted orders immediately while the table consumer was still replaying the changelog. The fix keeps a **table-side watermark** (max table timestamp − allowed lateness) and holds orders in \`pending\` until \`order.ts <= watermark\`. This is the same idea as Kafka Streams bootstrapping a GlobalKTable, or Flink waiting on the versioned table's watermark.
2. **Deleted customers still enriched.** \`if (!value) return\` treated tombstones as junk. The fix stores \`{ ts, value: null }\` as a version, so any order after the deletion gets \`customer: null\`, and erased data is not copied into new events. History is pruned, so it does not linger beyond retention either.
3. **Replay gave different results.** A latest-value lookup depends on *processing* time. The fix keeps a per-key **version history** sorted by timestamp and answers with a binary search for the last version with \`ts <= order.ts\`. The same input always gives the same output: a temporal / as-of join, like Flink's \`FOR SYSTEM_TIME AS OF\` or Kafka Streams versioned stores.
4. **Out-of-order table updates** are inserted in timestamp order, and replaying the same version is idempotent (same ts overwrites).
5. **Late table updates** (older than the watermark) cannot change already-emitted orders. They are counted in \`lateTableUpdates\` so you can alert, and you can raise \`allowedLatenessMs\` (more latency) or emit corrections to an upsert sink.
6. **Bounded memory.** \`prune\` drops versions older than \`watermark − retention\`, but keeps the newest one before the horizon, because it is still the current value for later orders. Fully deleted keys beyond the horizon are removed. Memory ≈ keys × versions-in-retention.

The solution is single-threaded per partition: run one instance per co-partitioned (orders, customers) partition pair, both keyed by customerId.`,
      followUps: [
        {
          q: 'The customers topic goes quiet at night: no updates for 3 hours. What happens to orders, and how do you fix it?',
          a: 'The table watermark only advances on table updates, so every order after the last update stays in \`pending\`. Latency grows to hours and memory grows with it. That is the classic idle-source problem. Fixes: (1) an idleness timeout, so that if the table has been silent for X seconds, advance its watermark with processing time (Flink \`withIdleness\`); (2) have the CDC source emit heartbeat records (Debezium \`heartbeat.interval.ms\`) so the watermark keeps moving; (3) cap the wait per order and emit with a "possibly stale" flag. Option 2 is the cleanest, because the source really knows it has nothing older to send.',
        },
        {
          q: 'Orders are keyed by orderId on 48 partitions and customers by customerId on 12. Can you run this join as is?',
          a: 'No. The join needs an order and its customer\'s history in the same task, which means **co-partitioning**: same key, same partition count, same partitioner. Either repartition orders by customerId into a 12-partition intermediate topic (Kafka Streams does this automatically with \`selectKey\`, at the cost of an extra topic hop of about 5–20 ms), or replicate the whole customers table to every instance (a GlobalKTable or broadcast state). That works if it fits in memory or RocksDB, e.g. 5M customers × 200 B ≈ 1 GB per instance, but global tables are not time-synchronised with the stream, so you lose the temporal guarantee.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'ds-theory-iq-01',
      difficulty: 'expert',
      question:
        'A vendor pitches a replicated database: "strongly consistent, never loses an acknowledged write, and always answers within 50 ms, even during network partitions and node crashes." Using system models and impossibility results, take that claim apart, then say what a credible guarantee would sound like.',
      whatInterviewerLooksFor: [
        'Names the system model (timing, faults, links) before arguing',
        'Uses FLP and CAP correctly, as limits on liveness/availability, not "consensus is impossible"',
        'Separates safety claims from liveness and latency claims',
        'Proposes a precise, testable alternative guarantee (e.g. a Jepsen-style claim)',
      ],
      modelAnswer: `### 1. Pin down the model
"Always within 50 ms" assumes a **synchronous** network, with a known bound on delay. Real datacenters are **partially synchronous**: GC pauses, EBS stalls and cross-AZ congestion produce unbounded delays for unbounded periods. Nodes are **crash-recovery** and links are **fair-loss**.

### 2. Strong consistency + always answers + partitions
- **CAP:** a linearizable register cannot stay available on both sides of a partition. A minority-side replica must either refuse (violating "always answers") or answer from possibly stale state (violating linearizability).
- **FLP:** even without a partition, in an asynchronous model with one crash, no deterministic protocol *guarantees* that a decision terminates. Raft/Paxos keep **safety** always, and only get **liveness** when the network is timely enough.

### 3. Never loses an acknowledged write
This is a **safety** claim, and achievable: ack after a majority fsync (2f+1 nodes tolerate f crashes). But it costs latency: a cross-AZ quorum write is about 2–5 ms of RTT plus fsync, and a cross-region one is 60–150 ms. That conflicts with a 50 ms bound for multi-region deployments.

### 4. A credible guarantee
> "Linearizable reads and writes on a 3- or 5-node Raft group. Acknowledged writes survive any f = 1 (or 2) simultaneous crash-recovery failures, provided fsync is honest. During a partition, the side with a majority keeps serving. The minority side returns errors after about 1 s of election timeout. p99 write latency is 8 ms in-region under normal conditions. Leader failover takes 1–3 s, during which writes fail."

### 5. How I'd verify
- Ask for **Jepsen** results or run my own: partition, kill -9, clock skew and pause injection, then check histories with a linearizability checker (e.g. Knossos/Elle).
- Ask what happens when fsync lies (consumer SSDs without power-loss protection).
- Ask for p99.9 during leader changes, not averages.`,
      followUps: [
        {
          q: 'They reply: "We use synchronised atomic clocks, like Spanner, so the network is effectively synchronous." Does that rescue the claim?',
          a: 'No. TrueTime bounds *clock uncertainty* (ε of a few ms), which lets Spanner order commits by timestamp with commit-wait. It does not bound *message delay* or prevent partitions. Spanner still uses Paxos per split, still blocks on a majority, and still becomes unavailable on the minority side of a partition. Clocks improve read performance for consistent snapshots; they do not repeal CAP or FLP.',
        },
        {
          q: 'Which single fault-injection test would you run first in a proof of concept, and what result would disqualify them?',
          a: 'Partition the current leader away from the majority while clients keep writing to it, with a client-side history recorded. If any write acknowledged by the isolated old leader is missing after healing, or if a linearizability checker finds a stale read served by the old leader, the claim is false. That exact bug (a stale leader serving reads without a lease or ReadIndex) has appeared in several real databases.',
        },
        {
          q: 'Where would you accept their 50 ms promise as reasonable?',
          a: 'As a **latency SLO** under normal operation, e.g. p99 < 50 ms in-region while a majority is healthy and connected, explicitly excluding leader elections and partitions, and measured over a window. Phrased as a percentile over healthy periods, it is a liveness/performance target you can test. Phrased as "always", it is an impossibility.',
        },
      ],
      pitfalls: [
        'Saying "FLP proves consensus is impossible", which ignores that Raft and Paxos work under partial synchrony',
        'Treating "never lose acknowledged writes" and "always respond" as the same kind of property',
        'Accepting atomic clocks as a fix for partitions',
      ],
    },
    {
      id: 'ds-theory-iq-02',
      difficulty: 'hard',
      question:
        'You are building a ticket-booking backend where the only shared infrastructure allowed is a Kafka cluster (no relational database for the seat inventory). How do you guarantee that a seat is sold at most once, and how does a client learn whether its booking succeeded?',
      context:
        'Event: 40,000 seats, sale opens at 10:00 IST, about 300,000 booking attempts in the first 2 minutes. Seat-holding service written in NestJS.',
      whatInterviewerLooksFor: [
        'Recognises "at most once per seat" as a consensus / total order problem',
        'Uses a single partition per seat (or seat block) as the total order and a deterministic state machine',
        'Explains read-your-own-append to learn the outcome, not a local cache',
        'Handles throughput, duplicates and the partition-count trade-off',
      ],
      modelAnswer: `### Insight: uniqueness needs a total order
"First claim wins" needs every replica to agree which claim was first. That is **total order broadcast**, which is equivalent to consensus. A Kafka **partition** gives exactly that (its leader assigns offsets, and leadership is decided by the KRaft quorum). A topic as a whole does not.

### Design
1. Topic \`seat-claims\`, keyed by \`seatBlockId\` (e.g. 40,000 seats in 400 blocks of 100), with 48 partitions. All claims for one seat land in **one partition**, so they are totally ordered.
2. Producer: \`acks=all\`, \`enable.idempotence=true\`, RF=3, \`min.insync.replicas=2\`. A claim record is \`{ seatId, userId, requestId }\`.
3. **Seat state machine**, one consumer per partition: for each claim, in offset order, if \`seatId\` is free, assign it to \`userId\`, else reject. This is deterministic, so any replica or re-run reaches the same answer. Write the decision to \`seat-decisions\` (same key) in a **Kafka transaction** with the consumer offset (EOS for read-process-write).
4. **Client outcome:** the API appends the claim, gets its offset, then waits on the \`seat-decisions\` stream (or a per-request reply topic correlated by \`requestId\`) until the decision for that request arrives. Never answer from a cache that may lag behind the log.

### Numbers
300K attempts in 120 s ≈ 2,500/s on average, with a spike of maybe 20K/s in the first seconds. One partition handles 10K+ small records/s, so 48 partitions are plenty. The real limit is hot seats: the front rows all map to a few blocks. Smaller blocks spread the load. The state per seat is tiny (40K entries).

### Edge cases
- **Duplicates:** the same \`requestId\` arriving twice gives the same decision (idempotent).
- **Holds and expiry:** model "release" as another log event (\`release(seatId, holdId)\` at expiry). The state machine applies it in order.
- **Payment:** the seat goes PAYMENT_PENDING, and a timeout event releases it. Payment uses an idempotency key from the client.
- **Rebalances:** the state is rebuilt from the decisions topic (compacted) or a changelog. Because it is deterministic, re-applying claims gives the same result.`,
      followUps: [
        {
          q: 'An engineer suggests: "Just let every API pod keep an in-memory set of sold seats fed by the topic, and reject a claim if the seat is in the set." What breaks?',
          a: 'Each pod\'s set lags the log by its consumer delay (tens to hundreds of ms). Two pods can both see the seat as free and both accept, so the check is done on a **stale replica**, outside the total order. The decision must be made by the single partition-ordered state machine (or by appending first and then reading up to your own offset). A local set is fine as a *fast-path rejection* for seats already known to be sold, never as the authority.',
        },
        {
          q: 'A user books two seats in different blocks, and they want both or neither. How?',
          a: 'The blocks may be on different partitions, which have no common order, so this is now an atomic commit across shards. Options: put a whole row or section in one block (so a group booking is a single-partition decision; many systems restrict group bookings to adjacent seats for this reason); or run a saga: claim A, claim B, and if B is rejected, append \`release(A)\`. The user may briefly hold one seat. Kafka transactions make the *writes* atomic, but they cannot make the two independent decisions conditional on each other.',
        },
      ],
      pitfalls: [
        'Assuming Kafka topics are globally ordered',
        'Deciding based on a consumer-side cache that lags the log',
        'Claiming Kafka exactly-once alone prevents double sale',
      ],
    },
    {
      id: 'ds-theory-iq-03',
      difficulty: 'hard',
      question:
        'Thirty teams publish and consume about 200 Avro event types on a shared Kafka platform. A schema change took down three consumers last quarter. Design the schema-evolution policy: compatibility modes, deploy order, how a genuinely breaking change ships, and what CI enforces.',
      whatInterviewerLooksFor: [
        'Explains writer vs reader schema resolution and what BACKWARD/FORWARD/FULL actually test',
        'Chooses transitive modes because of retention and replay',
        'Ties compatibility mode to deploy order',
        'Has a concrete process for breaking changes (new topic, bridge, deprecation)',
      ],
      modelAnswer: `### Mechanics first
Avro consumers decode with the **writer's schema** (looked up by the 4-byte id in each message) resolved against their **reader's schema**, by field name. Compatibility is therefore about pairs: can this reader read that writer?

### Policy
| Rule | Choice | Why |
|---|---|---|
| Default mode | **FULL_TRANSITIVE** for shared topics | Retention is 7–30 days and teams replay, so a new consumer must read *every* version, and old consumers must read new data while producers roll out. |
| Allowed changes | add/remove fields **with defaults**, add enum symbols only if the enum has a default, promotions int→long etc. | These are exactly what Avro resolution handles. |
| Forbidden | renames without an alias, type changes outside promotions, reusing a field name with new semantics (units!) | Semantic breaks pass any registry check. |
| Team-private topics | BACKWARD_TRANSITIVE is acceptable | The owner controls both sides: upgrade consumers, then producers. |

### Deploy order by mode
- BACKWARD → **consumers first**, because the new reader must read old data.
- FORWARD → **producers first**, because old readers must read new data.
- FULL → any order, which is why it is the default for 30 teams who do not coordinate deploys.

### CI and runtime enforcement
- Schemas live in the producer's repo. CI calls the registry's \`/compatibility\` endpoint (with verbose output). A failure blocks the merge.
- \`auto.register.schemas=false\` in production producers. Schemas are registered by the pipeline only, so a laptop cannot register v17.
- Consumers use the registry's \`latest\` for nothing. They decode with the **writer id from the message** and keep their compiled reader schema.
- Lint for semantics: required docs and units on numeric fields, and an owner annotation.

### Shipping a genuinely breaking change
1. New topic \`orders.placed.v2\` with the new schema.
2. The producer **dual-publishes** (or a bridge stream job maps v1→v2).
3. Consumers migrate on their own schedule. Track consumer-group lag on v1 to see who is left.
4. Announce the sunset, stop v1 after the last consumer leaves, and keep v1 data until its retention ends.

### Expected outcome
Breaking incidents drop to near zero. The remaining risk is semantic changes, which are caught by review and contract tests on sample payloads.`,
      followUps: [
        {
          q: 'Why is non-transitive FULL not enough if the topic is compacted?',
          a: 'Non-transitive checks only compare against the *latest* registered version. With v1→v2→v3, each step can be compatible with its neighbour, yet v3 may be unable to read v1. For example, v2 removes \`discount: int\`, then v3 adds \`discount: string\` with a default. Each step is compatible with its neighbour, but v3 reading a v1 record finds an int where it expects a string. A compacted topic keeps the latest record per key **forever**, so a v1 record written two years ago will be read by v3 code. Transitive checking compares against every version still present.',
        },
        {
          q: 'A team insists on Protobuf instead. What changes in the policy?',
          a: 'Protobuf resolves by **field tag number**, not name, and the writer\'s schema is not needed to parse (unknown tags are skipped and retained). The rules become: never change or reuse a tag, mark removed fields \`reserved\`, and no required fields. The registry still adds value (compatibility checks, discoverability), and Confluent supports Protobuf with the same modes. Renames become safe for the wire but break JSON-mapped consumers, so they are still discouraged.',
        },
      ],
      pitfalls: [
        'Saying BACKWARD means "old consumers can read new data" (that is FORWARD)',
        'Relying on non-transitive checks with long retention',
        'Letting producers auto-register schemas in production',
      ],
    },
    {
      id: 'ds-theory-iq-04',
      difficulty: 'hard',
      question:
        'After a routine rolling deploy, support reports that some users\' notification preferences "reset" over the following days, but only for users who edited their phone number. Nothing failed in logs. Walk me through your diagnosis and the systemic fix.',
      context:
        'NestJS monolith with 24 pods; user profiles are stored as a JSONB column. The release added a notificationPrefs object to the profile. Rollout took 20 minutes and was later rolled back for an unrelated bug, then re-deployed two days later.',
      whatInterviewerLooksFor: [
        'Identifies forward-compatibility failure: old code doing read-modify-write drops unknown fields',
        'Explains why the rollback made it worse (data outlives code)',
        'Proposes both a data repair and a structural prevention',
        'Mentions testing the old-reads-new direction explicitly',
      ],
      modelAnswer: `### Hypothesis
The symptom is tied to one write path (phone edits) and to the time when old and new code coexisted. That points to **old code doing read-modify-write on the JSONB document**:
1. A v42 pod writes \`profile = { name, phone, notificationPrefs }\`.
2. A v41 pod (during the 20-minute rollout, and for **two days after the rollback**) handles a phone edit. It loads the profile into a DTO with only \`name\` and \`phone\` (class-transformer \`excludeExtraneousValues\`, or a typed mapper), sets the phone and writes back the whole object.
3. \`notificationPrefs\` disappears. No error, because v41 is doing what it was written to do.

### Confirm
- Query the audit trail and logical replication for updates where \`profile ? 'notificationPrefs'\` went from true to false, and correlate them with the pod version from request logs.
- Reproduce in staging: write with v42, edit the phone with v41.

### Repair
- If an audit/CDC history exists (Debezium topic, \`pg_audit\`, history table), take the **last value** of \`notificationPrefs\` before it disappeared and patch it back with \`jsonb_set\`, only where the current value is missing. That makes the repair idempotent.
- Otherwise fall back to the defaults and notify the affected users.

### Systemic fix (data outlives code)
- **Partial updates:** update only the key you own (\`jsonb_set(profile, '{phone}', ...)\`) or use real columns. Never write back a whole document that you parsed with a narrower type.
- If documents must be rewritten, **preserve unknown keys** (spread the original, or keep a catch-all bag). Protobuf does this natively for unknown fields.
- **Expand/contract releases:** ship a release that tolerates and preserves the new field *before* any release writes it. Rollback is then safe, because the rollback target already preserves it.
- **A test that matters:** in CI, run the previous release's code against data written by the candidate (old-reads-new) and assert round-trip equality of unknown fields.`,
      followUps: [
        {
          q: 'Why did the rollback make the damage much larger than the 20-minute rollout window?',
          a: 'During rollout only a fraction of the 24 pods ran v41 for at most 20 minutes. After the rollback, **every** pod ran v41 for two days, while v42-written profiles (with notificationPrefs) were still in the database. Every phone edit in those two days destroyed the field. Code was rolled back; data was not. The rule is that a rollback target must be forward compatible with any data the newer version may have written.',
        },
        {
          q: 'Would putting notificationPrefs in its own column have avoided this?',
          a: 'Mostly yes. v41\'s ORM would issue \`UPDATE users SET phone = $1\` and never touch a column it does not know, provided the ORM only writes dirty columns (TypeORM \`save\` on a loaded entity does). It would still break if v41 used a raw \`INSERT ... ON CONFLICT DO UPDATE\` that sets every known column, or recreated the row. Column-level writes narrow the blast radius. Preserving unknown data is still the principle.',
        },
      ],
      pitfalls: [
        'Blaming a cache or race condition without checking the version-coexistence window',
        'Fixing only the code, not repairing the data',
        'Assuming a rollback is always safe',
      ],
    },
    {
      id: 'ds-theory-iq-05',
      difficulty: 'expert',
      question:
        'Our product search (Elasticsearch), the product-detail cache (Redis) and the analytics warehouse all drift out of sync with the Postgres catalogue, and every team writes to them from the API in its own way. Propose an architecture where they stay consistent, and explain exactly what "consistent" means in your design.',
      context:
        'Catalogue of 20M SKUs, about 400 writes/s at peak (price and stock updates), 30K reads/s on search and detail pages. Sellers expect to see their own price change on the product page "immediately".',
      whatInterviewerLooksFor: [
        'Separates system of record from derived views',
        'Replaces dual writes with CDC + log, explains why ordering makes views converge',
        'Handles bootstrap/snapshot, idempotency and out-of-order application',
        'Defines the consistency guarantee precisely (eventual convergence plus read-your-writes for sellers)',
      ],
      modelAnswer: `### Diagnosis
Today the API does \`db.update(); es.index(); redis.del(); warehouse.insert()\`. That is **dual writing**. Two concurrent price updates can reach Elasticsearch in the opposite order from Postgres, and a crash between steps leaves a store permanently stale. No amount of retries fixes the ordering race.

### Architecture (unbundled database)
1. **System of record:** Postgres \`products\`. All writes go only here.
2. **CDC:** Debezium reads the WAL through a logical replication slot and produces to \`catalog.products\`, keyed by \`sku\`. All changes to a SKU are in one partition, in commit order. The initial **snapshot** plus the stream equals the full history.
3. **Derived views as idempotent consumers:**
   - **Search indexer:** \`index(id=sku, version=lsn, version_type=external)\`. Stale or duplicate events get a 409 and are skipped.
   - **Cache updater:** sets \`product:{sku}\` only if the incoming LSN is greater than the stored one (a small Lua compare-and-set) instead of deleting, so there is no stampede.
   - **Warehouse:** micro-batch MERGE on (sku, lsn).
4. Each view records its **applied LSN**.

### What "consistent" means here
- **Convergence:** every view eventually reflects the same Postgres state, because every view applies the same per-key order and every apply is idempotent.
- **Bounded staleness:** monitor lag. Target p99 under 2 s from commit to search, alert above 30 s.
- **Read-your-writes for sellers:** after a price update the API returns the commit LSN (\`pg_current_wal_lsn()\` after commit). The seller's product page reads Redis, and if the cached LSN is older than the seller's token, it falls back to Postgres for that one read. Shoppers accept a lag of about 1 s.
- **Not** linearizable across views. Search may briefly show an old price, so checkout always re-prices from Postgres.

### Operations
- Replication slot retention: alert on retained WAL > 20 GB, because a stalled connector fills the primary's disk.
- **Rebuilds:** a new index \`products_v2\` replays snapshot + topic. When it is caught up, switch the alias. Zero downtime, and the same procedure handles mapping changes.
- 400 writes/s is small for Kafka. The limiting factor is Elasticsearch refresh and bulk sizing (1–5 MB bulks).`,
      followUps: [
        {
          q: 'Why use the Postgres LSN as the version rather than the Kafka offset?',
          a: 'Both are monotonic per SKU in normal operation, but the offset belongs to *a topic*. If you re-snapshot into a new topic, re-create the topic, or migrate clusters, offsets restart, and every new event looks older than what Elasticsearch already holds, so it is rejected (409) forever. The LSN is the *source\'s* commit position, so it survives any re-plumbing of the pipeline. One caveat: snapshot rows need a version too, so use the snapshot\'s LSN, and any change captured afterwards will have a higher LSN.',
        },
        {
          q: 'A seller bulk-updates 2M prices in one transaction. What happens downstream?',
          a: 'Debezium emits 2M change events, all with the same commit LSN, after the commit. That is a burst of maybe 1–2 GB into Kafka. Indexers fall minutes behind, and other sellers\' updates queue behind it on shared partitions. Mitigations: ask for chunked transactions (e.g. 5K rows), give indexers bulk-mode and autoscale on lag, and because the version is the same LSN for every row in the batch, make sure equal versions are accepted idempotently (Elasticsearch \`external_gte\`) so a retry of the same event is not rejected.',
        },
        {
          q: 'Where would this architecture be overkill?',
          a: 'With a single Postgres and a cache, at a few hundred writes/s and one team, a **transactional outbox** polled by one worker (or even \`LISTEN/NOTIFY\` plus a reconciliation job) gives the same ordering and convergence without Kafka Connect, a schema registry and connector operations. Unbundling pays off when there are many derived views owned by different teams, or when replay and rebuilds are frequent.',
        },
      ],
      pitfalls: [
        'Keeping dual writes and adding retries',
        'Promising strong consistency across search, cache and DB',
        'Forgetting the initial snapshot or replication slot disk growth',
      ],
    },
    {
      id: 'ds-theory-iq-06',
      difficulty: 'expert',
      question:
        'Finance re-ran last quarter\'s merchant fee calculation from the raw payment events and got numbers 0.7% different from what was invoiced. The streaming job enriches each payment with the merchant\'s pricing plan from a CDC topic. Why do the runs differ, and how would you redesign the join so a replay is reproducible?',
      whatInterviewerLooksFor: [
        'Identifies processing-time lookup in the stream-table join as the source of non-determinism',
        'Proposes an event-time temporal join against a versioned table (or SCD Type 2 ids)',
        'Discusses late table updates, retention and watermarks',
        'Also mentions persisting the version used for auditability',
      ],
      modelAnswer: `### Why the runs differ
The job is a stream-table join that looks up the **current** pricing plan when each payment is *processed*:
- In the original run, a payment at 10:00 was joined with whatever plan the table held when it was processed (usually the plan valid at 10:00, but sometimes a newer plan if CDC was ahead, or an older one if CDC lagged).
- In the replay, all payments were processed **after** every plan change, so each one got the **latest** plan. Merchants who changed plans mid-quarter account for the 0.7%.

The join's output depends on processing order, so it is **non-deterministic**: This is called the time-dependence of joins.

### Redesign: a temporal (as-of) join
1. Keep the pricing plans as a **versioned table**: per merchant, \`(valid_from, plan)\` versions with event-time timestamps taken from the source commit time.
2. Join each payment with the version where \`valid_from <= payment.paid_at\` (Flink \`FOR SYSTEM_TIME AS OF p.paid_at\`, or Kafka Streams 3.5+ versioned stores).
3. **Watermarks:** emit a payment only once the table side's watermark is past \`paid_at\` (with an allowed lateness, e.g. 5 min, and source heartbeats so idle periods do not stall).
4. **Retention:** the history must cover the replay horizon. For a quarterly audit, keep versions for at least 100 days, or keep the plan history in the warehouse as an **SCD Type 2** table.

### Better still: record the decision
Store \`plan_version_id\` on every fee row. Audits then join on an *id*, not on time, so they are deterministic forever, even if someone later corrects history.

### Late plan changes
A plan update backdated to before payments that were already invoiced cannot be fixed silently. Detect it (\`late_updates\` metric), and either emit a correction/credit note (the sink must support adjustments) or reject backdating at the source. That is a business rule, not just a streaming setting.`,
      followUps: [
        {
          q: 'The plans topic is compacted. Does that break the versioned table?',
          a: 'Yes, for replays. Compaction keeps only the latest value per merchant, so after compaction the topic no longer contains the history needed to rebuild "the plan as of March 3". A live job holding versions in its state store is fine until it restarts from scratch. Fix: keep a separate non-compacted history topic (retention ≥ the audit horizon), or source the history from the warehouse SCD table, or store plan_version_id on each output so you never need to reconstruct it.',
        },
        {
          q: 'Product asks for "always use the latest plan, even retroactively". Is that a stream-table join at all?',
          a: 'It is really a **table-table join**: fees = payments ⋈ current plans, recomputed whenever a plan changes. Every plan change must re-emit updated fees for that merchant\'s payments in the period. The state is large (all payments in the billing period keyed by merchant), and the sink must accept upserts and retractions. That is fine for a running monthly estimate, but invoices that have already been issued must be immutable, so they need a cut-off.',
        },
      ],
      pitfalls: [
        'Blaming floating-point rounding or duplicate events without checking join semantics',
        'Proposing "just reprocess faster"',
        'Using a compacted topic as the source of history',
      ],
    },
    {
      id: 'ds-theory-iq-07',
      difficulty: 'hard',
      question:
        'Our wallet top-up pipeline is API → Kafka → consumer → ledger DB, and Kafka exactly-once semantics are enabled end to end. We still see about 30 duplicate top-ups a day. Explain where they come from and design the fix using the end-to-end argument.',
      context:
        'Mobile app on flaky 4G networks in tier-2 cities; the API has a 10 s timeout; users often tap "Add money" again when the spinner hangs.',
      whatInterviewerLooksFor: [
        'Explains what Kafka EOS does and does not cover',
        'Applies the end-to-end argument: dedup at the point of effect with an id born at the client',
        'Shows the transactional pattern for dedup + effect',
        'Considers the PSP/UPI side as another endpoint with its own idempotency',
      ],
      modelAnswer: `### Where duplicates come from
Kafka EOS (idempotent producer + transactions + \`read_committed\`) guarantees that **one produce call** is not duplicated by *producer retries*, and that a consume-transform-produce cycle inside Kafka commits atomically. It does not know that two *different* produce calls carry the same intent:
1. **User double-tap:** the spinner hangs and the user taps again, so there are two HTTP requests and two separate Kafka records.
2. **Client/HTTP retry:** the API produced the record, the response was lost on 4G, and the app or gateway retried.
3. **Consumer side effect outside Kafka:** the consumer writes to the ledger DB and *then* commits its offset. A crash in between redelivers the message, and the DB write is not part of the Kafka transaction.

### End-to-end fix
**The guarantee has to come from the endpoints.** Generate a \`topupId\` (UUIDv7) on the device **when the user confirms** the amount, before the first network call. Persist it locally, and disable the button until a final status arrives.
- API: \`Idempotency-Key: topupId\`. Produce with key = \`walletId\`, header \`topupId\`.
- Consumer: in **one DB transaction**, \`INSERT INTO topups(topup_id, ...) ON CONFLICT DO NOTHING\`, and only if a row was inserted, insert the ledger entries. Commit the DB transaction, then commit the offset. A redelivery hits the conflict and becomes a no-op.
- **PSP/UPI leg:** pass the same \`topupId\` as the merchant transaction reference, so the provider dedups on its side as well. On timeout, query the provider's status API before retrying.

### Why not rely on the API layer alone?
An API idempotency table only covers duplicate HTTP requests. The **ledger** is where money changes hands, so the unique constraint must live there, in the same transaction as the effect. Every layer above can then retry blindly.

### Verify
A daily reconciliation compares \`topups\` with PSP settlement by \`topupId\`. Expect zero duplicates. Mismatches should only be in-flight timing differences.`,
      followUps: [
        {
          q: 'The app generates topupId but users sometimes reinstall the app mid-payment. What then?',
          a: 'The locally stored id is lost, so a new attempt gets a new id and both may succeed. Mitigations: create the top-up *intent* server-side first (POST /topup-intents returns the id, tied to user + amount + a 10-minute window), and on app start fetch "pending intents" for the user and resume them instead of creating new ones. Also add a soft business rule: a second identical amount within 2 minutes asks for confirmation. The end-to-end id is only as durable as the place it is stored.',
        },
        {
          q: 'Would switching to Kafka transactions that include the DB write fix the consumer-side duplicate?',
          a: 'Kafka transactions cannot enlist Postgres. There is no XA between them in kafkajs/Kafka. You can store the consumed **offset in the same DB transaction** as the effect and seek to it on startup (Kafka\'s "store offsets externally" pattern). That gives exactly-once *effect* for redeliveries, but still does nothing for the double-tap. You still need the topupId unique constraint, so do that first.',
        },
      ],
      pitfalls: [
        'Saying "enable EOS" or "use acks=all" as the fix',
        'Deduplicating in Redis with a TTL but outside the ledger transaction',
        'Generating the idempotency key on the server per request',
      ],
    },
    {
      id: 'ds-theory-iq-08',
      difficulty: 'medium',
      question:
        'A product manager wants to put the company\'s internal admin audit log "on a blockchain" so it is tamper-proof for SOC 2 auditors. How do you respond, and what would you build instead?',
      whatInterviewerLooksFor: [
        'Knows what Byzantine fault tolerance buys and costs (3f+1, mutually distrusting parties)',
        'Separates tamper-evidence from tamper-proofing',
        'Proposes a hash chain / Merkle log with externally anchored digests and WORM storage',
        'Keeps it pragmatic: cost, latency, operability',
      ],
      modelAnswer: `### What a blockchain buys
Byzantine fault-tolerant consensus lets **mutually distrusting parties** agree on one history even if up to f of 3f+1 participants lie. Its value comes from *independent* operators. If every node runs in our AWS account, deployed by our CI with our credentials, a malicious insider controls all of them, and BFT adds nothing. We would pay O(n²) messaging, seconds of latency and a new technology stack for zero additional trust.

### What the auditor actually needs
**Tamper evidence:** proof that entries were not altered or deleted after the fact, plus access control and retention. Nobody can make data *impossible* to delete for someone with root on the storage. You can make deletion *detectable* and make storage immutable for its retention period.

### What I would build
1. **Append-only table** \`audit_log(seq, at, actor, action, payload, prev_hash, hash)\`, written in the same transaction as the audited change. \`hash = SHA-256(seq ‖ at ‖ actor ‖ action ‖ payload ‖ prev_hash)\`.
2. **Database permissions:** the application role can only \`INSERT\`, with no \`UPDATE\`/\`DELETE\` grants. A trigger rejects updates.
3. **External anchoring:** every hour, publish the head hash to a place insiders cannot rewrite: S3 Object Lock in compliance mode (WORM), an email to the auditors, or a third-party timestamping service. Any rewrite of earlier entries changes the chain and no longer matches the anchored head.
4. **Export:** daily batches to S3 Object Lock with 7-year retention.
5. **Verification job:** recompute the chain nightly, alert on mismatch, and give auditors the verifier script.

### When I would reconsider
If several *companies* (for example, partner banks) must share one ledger and none will let another operate it, a permissioned BFT ledger (CometBFT, a HotStuff-family protocol) becomes reasonable.`,
      followUps: [
        {
          q: 'With a hash chain, can a DBA with full access still rewrite history undetected?',
          a: 'They can rewrite the table *and* recompute every later hash, so the chain is internally valid again. What they cannot do is change the head hash that was already anchored externally (in WORM storage, an auditor\'s inbox or a public timestamp). The verifier compares the recomputed head at each anchor point with the published anchors, so a rewrite is detected, at a granularity equal to the anchoring interval. Hourly anchoring means at most an hour of entries is exposed.',
        },
        {
          q: 'How do you make verification cheap when the log has 2 billion entries?',
          a: 'Replace the linear chain with a **Merkle tree** over batches (as Certificate Transparency does): anchor the root per hour, and prove any single entry with an O(log n) inclusion proof (about 31 hashes for 2^31 entries). Consistency proofs show that a later tree extends an earlier one without rewriting it. Verification of one entry costs microseconds, and full audits can check per-hour roots in parallel.',
        },
      ],
      pitfalls: [
        'Agreeing to a blockchain without asking who the distrusting parties are',
        'Claiming anything is "tamper-proof" rather than tamper-evident',
        'Forgetting that the anchor must live outside the attacker\'s control',
      ],
    },
    {
      id: 'ds-theory-iq-09',
      difficulty: 'hard',
      question:
        'The "orders by customer" read model is a Kafka Streams KTable materialised into a Postgres table. You now need to change its shape (add an aggregate and a new grouping key) with zero downtime and the ability to compare old and new before switching. Walk me through the migration, using stream-table duality.',
      context: 'Source topic orders: 18 months retention, about 1.2B events, 24 partitions. Read API serves 8K QPS from the read model.',
      whatInterviewerLooksFor: [
        'Treats the read model as derived and rebuildable from the log',
        'Runs v2 side by side with its own consumer group and output',
        'Plans replay throughput, catch-up, comparison and cutover',
        'Considers retention, determinism and cleanup of v1',
      ],
      modelAnswer: `### Principle
The read model is a **table derived from a stream**. If the log still holds the full history (18 months here, which is enough if the model only needs that window), you never migrate the table in place. You **derive a new one** and switch reads to it.

### Steps
1. **Deploy app v2 of the stream job** with a new \`application.id\` (so a new consumer group, new internal changelog/repartition topics and new RocksDB stores) and a new output table \`orders_by_customer_v2\`. It starts from the earliest offset. v1 keeps serving.
2. **Replay:** 1.2B events at about 50K events/s per instance across 24 partitions with 12 instances is about 600K/s, so roughly 35 minutes of raw consumption. In practice the sink limits it: Postgres upserts at perhaps 30–50K rows/s with batching, so plan for 4–8 hours. Speed it up by writing to an unlogged/bulk staging table, or let Kafka Streams aggregate first and emit only the final values (\`suppress\` or a large cache size).
3. **Catch-up:** v2 reaches the head and follows live traffic. Lag stays under 1 s.
4. **Compare:** a shadow-read job samples 1% of API requests, reads both v1 and v2, and diffs the fields that should agree. Investigate differences: non-determinism (processing-time lookups, wall-clock use) shows up here.
5. **Cut over:** a feature flag switches reads to v2 per customer cohort (1% → 10% → 100%). Rollback is just flipping the flag back, since v1 is still running.
6. **Clean up:** after a week, stop v1, then delete its group, internal topics and table.

### Gotchas
- **Determinism:** the new topology must not depend on processing time, or v1 and v2 will differ for reasons unrelated to the change.
- **Retention is a design constraint.** If the model needs data older than retention, you need a snapshot (a compacted topic, or an export of the v1 table) to seed v2.
- **Cost:** the replay doubles broker read throughput for hours. Use quotas so live consumers are not starved.`,
      followUps: [
        {
          q: 'The source topic only has 7 days of retention. What changes?',
          a: 'A replay can only rebuild the last 7 days. Bootstrap v2 from a **snapshot**: export the v1 table (or the system of record) as of a known position, load it into v2\'s state, then consume from the offsets matching that snapshot. With a Kafka Streams state store you would produce the snapshot into v2\'s input as a compacted "seed" topic. This is the same "snapshot + log" pattern CDC uses. Longer term, enable tiered storage or a compacted per-customer topic so rebuilds stay possible.',
        },
        {
          q: 'Could you instead just ALTER the v1 table and patch the job in place?',
          a: 'You could, but you would lose the side-by-side comparison and the instant rollback. A new aggregate also needs historical values, so you would still have to backfill by replaying, *while* the live job writes to the same table, which invites races and double counting. Rebuilding separately keeps the derived data reproducible. In-place is fine only for additive columns that can be lazily filled and are not compared.',
        },
      ],
      pitfalls: [
        'Reusing the same application.id and resetting offsets in place, which causes downtime and corrupts state',
        'Not estimating replay time against sink throughput',
        'Forgetting retention limits for rebuilds',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'ds-theory-boe-1',
      question:
        'You want to rebuild a derived Elasticsearch view by replaying a CDC topic instead of running a migration. Estimate the replay time, the Kafka storage needed to keep the topic replayable, and whether to compact.',
      assumptions: [
        'Catalogue table: 50M rows, average change event (Avro with key and envelope) 1.2 KB',
        'Change rate: 300 updates/s on average, so 26M events/day',
        'Replay consumer: 24 partitions, ES bulk indexing sustains 40K docs/s for the cluster',
        'Kafka replication factor 3',
      ],
      steps: [
        { label: 'Daily change volume', calc: '300/s × 86,400 ≈ 26M events/day × 1.2 KB ≈ 31 GB/day (×3 RF ≈ 93 GB/day on disk)' },
        { label: 'Full history for 1 year (no compaction)', calc: '31 GB × 365 ≈ 11.3 TB logical, ×3 ≈ 34 TB on brokers' },
        { label: 'Compacted size (latest value per key)', calc: '50M keys × 1.2 KB ≈ 60 GB logical, ×3 ≈ 180 GB' },
        { label: 'Replay of compacted topic', calc: '50M docs ÷ 40K docs/s ≈ 1,250 s ≈ 21 min (plus the dirty, not-yet-compacted segment tail)' },
        { label: 'Replay of 1-year full history', calc: '(50M + 26M × 365 ≈ 9.5B) events ÷ 40K/s ≈ 237,500 s ≈ 2.7 days' },
      ],
      answer:
        'Compact the topic: about 180 GB on disk (RF 3) and about 21 minutes to rebuild the index, versus about 34 TB and 2.7 days for an uncompacted year of history.',
      insight:
        'For a *current-state* view, a compacted changelog plus Debezium\'s initial snapshot is the right backbone: it keeps rebuilds to minutes and storage proportional to the number of keys, not to time. Keep a separate uncompacted (or tiered-storage) history only for views that need history, such as audits or temporal joins. Size the ES bulk throughput, not Kafka, because Kafka can deliver 50M events in a few minutes.',
      followUps: [
        {
          q: 'Rebuilds must finish in under 5 minutes. What do you change?',
          a: 'ES is the bottleneck (40K docs/s). Options: build a fresh index with \`refresh_interval: -1\` and \`number_of_replicas: 0\` during the load (often 2–3× faster), then restore replicas and switch the alias; scale the indexing tier temporarily; or rebuild *in parallel* into per-partition shards. 50M ÷ 300 s ≈ 167K docs/s, which needs roughly 4× the cluster indexing capacity for the duration, or a pre-built snapshot restore instead of a replay.',
        },
        {
          q: 'Deletes are 5% of changes. How do tombstones affect compaction and the rebuild?',
          a: 'A delete is the event plus a tombstone (null value). Compaction keeps the tombstone for \`delete.retention.ms\` (24 h by default), then removes it, so the key vanishes entirely. A rebuild started from the compacted topic after that never sees the delete, and that is fine, because a fresh index simply never contains the document. The risk is a *lagging* consumer that is more than 24 h behind: it can miss the tombstone and keep a deleted document. Alert if consumer lag exceeds delete.retention.ms.',
        },
      ],
    },
    {
      id: 'ds-theory-boe-2',
      question:
        'Estimate the state size of a stream-stream join between ad impressions and clicks with a 30-minute window, and compare it with a temporal stream-table join against an advertiser-budget table.',
      assumptions: [
        'Impressions: 120K/s at peak, 250 B each in state (key + needed fields)',
        'Clicks: 2.4K/s (2% CTR), 200 B each',
        'Join window: a click must arrive within 30 min of its impression; allowed lateness 5 min',
        'Budget table: 2M advertisers, 300 B per version, 6 updates per advertiser per day, history retained 24 h',
        'RocksDB overhead ≈ 1.5× raw',
      ],
      steps: [
        { label: 'Impression side buffered', calc: '120K/s × (30 + 5) min × 60 = 252M rows × 250 B ≈ 63 GB raw' },
        { label: 'Click side buffered', calc: '2.4K/s × 2,100 s ≈ 5M rows × 200 B ≈ 1 GB raw' },
        { label: 'Total with RocksDB overhead', calc: '(63 + 1) GB × 1.5 ≈ 96 GB; across 48 task slots ≈ 2 GB each' },
        { label: 'Temporal table state', calc: '2M advertisers × (1 current + 6 versions/day) × 300 B ≈ 4.2 GB raw ≈ 6.3 GB with overhead' },
        { label: 'Checkpoint cost', calc: 'new state ≈ 120K/s × 250 B ≈ 30 MB/s, so a 60 s incremental checkpoint uploads about 1.8 GB of new SST data, not the full 96 GB' },
      ],
      answer:
        'About 96 GB of join state for the stream-stream join, dominated by buffered impressions, versus about 6 GB for the versioned budget table.',
      insight:
        'Stream-stream join state grows with **rate × window**, so shrinking the window or buffering only the needed fields of the high-cardinality side is the main lever. The state of a stream-table join grows with **keys × versions retained**, independent of event rate. If the business rule allows it (e.g. "attribute a click to the impression id carried in the click URL"), turn the stream-stream join into a lookup: make impressions a table keyed by impression id with a 35-minute TTL. The state stays roughly the same size, but you have a single source of truth for attribution.',
      followUps: [
        {
          q: 'Marketing wants a 24-hour attribution window instead of 30 minutes. What breaks first?',
          a: 'The impression state scales linearly with the window: 120K/s × 86,400 s × 250 B ≈ 2.6 TB raw, about 3.9 TB in RocksDB. Checkpoint and restore times explode: restoring 80 GB per slot at 200 MB/s takes about 7 minutes per failure. Instead, write impressions to a KV store or a ClickHouse table with a TTL and do click-time lookups (a stream-table join against an external store), or attribute in batch hourly. Treat 24-hour windows as a batch problem with a streaming estimate.',
        },
        {
          q: 'Impressions spike 5× during an IPL final. What happens to the join?',
          a: 'Impression state grows to about 5 × 63 GB ≈ 315 GB raw over the window, while clicks also rise. RocksDB compaction and checkpoint uploads compete for disk I/O, checkpoint duration exceeds the interval, and backpressure propagates to the sources, so lag grows. Pre-scale task slots before the match (state is redistributed by key group at restart), enable unaligned checkpoints, and consider sampling or pre-aggregating impressions per (campaign, minute) when only CTR, not per-impression attribution, is needed.',
        },
      ],
    },
    {
      id: 'ds-theory-boe-3',
      question:
        'Your platform team proposes moving 40 event types from JSON to Avro with a schema registry. Estimate the bandwidth and storage savings, and the registry load, to decide whether it is worth it.',
      assumptions: [
        'Throughput: 80K events/s at peak, 30K/s on average',
        'Average JSON event 700 B (field names repeated in every message); the equivalent Avro body is 230 B plus the 5-byte header',
        'Producers use zstd batch compression; compression ratio is 3.5× for JSON and 1.6× for Avro',
        'RF 3, 7-day retention; cross-AZ traffic is billed at about $0.01/GB each way',
        '600 consumer and producer instances, schemas cached per id after the first lookup',
      ],
      steps: [
        { label: 'Compressed size per event', calc: 'JSON 700 ÷ 3.5 = 200 B; Avro 235 ÷ 1.6 ≈ 147 B, so about 27% smaller on the wire' },
        { label: 'Daily volume (average rate)', calc: '30K/s × 86,400 = 2.6B events/day; JSON 2.6B × 200 B ≈ 518 GB/day, Avro ≈ 381 GB/day' },
        { label: 'Retained storage (RF 3, 7 days)', calc: 'JSON 518 × 3 × 7 ≈ 10.9 TB; Avro 381 × 3 × 7 ≈ 8.0 TB, saving about 2.9 TB' },
        { label: 'Cross-AZ replication + consumer traffic', calc: '(518 − 381) GB/day × about 4 cross-AZ copies ≈ 550 GB/day × $0.02 ≈ $11/day ≈ $4K/year' },
        { label: 'Registry load', calc: '600 instances × 40 schemas = 24K lookups at cold start, then about 0/s; a deploy wave of 100 pods ≈ 4K requests in seconds' },
      ],
      answer:
        'The saving is about 27% on the wire after compression and about 2.9 TB of retained storage. The cost saving is modest (low thousands of dollars per year). Registry load is negligible as long as clients cache schemas.',
      insight:
        'Batch compression erodes most of the size advantage of a binary format, because it removes the repeated field names that make JSON large. The real reasons to adopt Avro with a registry are **enforced compatibility** (CI rejects breaking changes) and typed contracts, not bytes. Justify the migration with incident reduction. Make the registry highly available and keep client-side caching, because consumers cannot decode anything they cannot resolve.',
      followUps: [
        {
          q: 'The registry is down for 10 minutes. Which services fail?',
          a: 'Services that already cached the schema ids they see keep working, since the Confluent serdes cache by id. What fails: producers that need to register or look up a *new* schema (a fresh deploy with \`auto.register.schemas=false\` still looks up the id for its schema), and consumers that meet an id they have never seen, such as new pods after a scale-up or a new producer version. So the blast radius is deploys and autoscaling. Run the registry with 3+ instances behind a load balancer (its storage is the Kafka \`_schemas\` topic), and alert on lookup errors.',
        },
        {
          q: 'Events are tiny, around 60 B of JSON (IoT pings). Does the answer change?',
          a: 'Yes, in Avro\'s favour per event but not overall. The 5-byte header becomes about 8–15% of each message, while JSON field names are now most of the payload, so binary encoding saves more *before* compression. Batch compression of many similar small JSON messages is very effective, though (often 5–8×). Measure on a real sample batch with your linger.ms and batch.size. For tiny events, batching and compression settings usually matter more than the encoding.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'ds-theory-mcq-01',
      difficulty: 'hard',
      question:
        'Classify these production requirements. Select ALL that are safety properties (a violation is permanent and can be pinned to a moment in time).',
      options: [
        'No two users ever hold the same seat for the same show',
        'Every payment webhook is eventually processed',
        'A record acknowledged with acks=all is never lost after a single broker failure',
        'A partitioned Raft follower eventually rejoins and catches up',
        'An account balance never goes below zero',
      ],
      correct: [0, 2, 4],
      explanation:
        'Double-sold seats, losing an acknowledged record and a negative balance are safety properties: once they happen, no future event undoes them, and you can point to the exact bad step. "Eventually processed" and "eventually rejoins" are liveness properties: at any finite moment they might still happen later, so no single moment shows the violation. This matters because consensus protocols protect safety under any timing, but only promise liveness under partial synchrony.',
      followUps: [
        {
          q: 'Your webhook processor misses an SLA of "processed within 5 minutes". Is that SLA safety or liveness?',
          a: 'Strictly, a *bounded* response time is a safety property: once 5 minutes have passed without processing, the violation is fixed in a finite prefix of the execution. That is why hard real-time bounds need a synchronous model. In practice we treat SLAs as performance targets measured as percentiles, and accept that under partitions or overload they will be violated while the real safety properties (no duplicate effects, no lost events) must still hold.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-02',
      difficulty: 'medium',
      question:
        'Your service calls a bank\'s fund-transfer API and the TCP connection resets after the request was fully sent but before any response arrived. An engineer proposes a "three-way confirmation" protocol with the bank to get certainty before returning to the user. What is the best response?',
      options: [
        'Adopt it; one more round of acknowledgements removes the uncertainty for the last message',
        'Reject it; by the two generals argument no bounded protocol gives certainty, so use an idempotency key, a status query and reconciliation instead',
        'Reject it; switch the call to UDP with retransmissions, which avoids connection resets entirely',
        'Adopt it, but only with TLS 1.3, because authenticated channels prevent lost acknowledgements',
      ],
      correct: [1],
      explanation:
        'Adding acknowledgement rounds only moves the uncertainty to whoever sends the last message, which is the two generals problem. The practical fix is to make the transfer idempotent (a key on every retry), query its status, and reconcile against the bank\'s statement. UDP does not change the fact that messages can be lost. TLS authenticates and encrypts, but cannot stop a packet or a connection from being lost.',
      followUps: [
        {
          q: 'The bank API has no status endpoint and no idempotency keys. What do you do?',
          a: 'Never auto-retry a non-idempotent money movement after an unknown outcome. Mark the transfer UNKNOWN, show the user "processing", and resolve it from the bank\'s end-of-day statement or webhook by matching your reference number (most bank APIs accept a client reference). Put UNKNOWN transfers into a manual-review queue with a time limit. Push the provider for idempotency support, because this is the gap that creates double payouts.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-03',
      difficulty: 'expert',
      question:
        'Which statements about the FLP impossibility result are correct? Select ALL that apply.',
      options: [
        'It shows no deterministic protocol can guarantee consensus terminates in an asynchronous system if even one process may crash',
        'It implies Raft can elect two leaders in the same term when the network is asynchronous',
        'Randomised protocols can terminate with probability 1 despite FLP',
        'It still applies if processes have accurate, perfectly synchronised clocks but message delays are unbounded',
        'It is the reason etcd sets an election timeout that must be much larger than the network RTT',
      ],
      correct: [0, 2, 3],
      explanation:
        'FLP is about *termination* (liveness) of deterministic consensus under asynchrony with one crash failure. Randomisation (Ben-Or) escapes it with probability-1 termination. Clocks do not help if message delays are unbounded, because a slow message still cannot be told apart from a crash. FLP does not imply safety violations: Raft never elects two leaders in a term, it may merely fail to elect any leader. The election timeout being much larger than the RTT is a liveness tuning choice that avoids needless elections, not a consequence of FLP.',
      followUps: [
        {
          q: 'If FLP applies, why does Raft terminate in practice almost always?',
          a: 'Real networks are partially synchronous: delays are usually far below the election timeout (RTT under 1 ms in-DC versus a 1 s etcd timeout). Randomised timeouts make repeated split votes exponentially unlikely, so in practice an election finishes within one or two timeouts. FLP only guarantees that *some* adversarial schedule exists, and real schedules rarely look like that for long. When they do (packet-loss storms), etcd shows exactly the predicted symptom: repeated elections and unavailability, without split brain.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-04',
      difficulty: 'hard',
      question:
        'A team\'s homegrown consensus module handles votes like this. Under which failure model does it break safety?',
      code: {
        language: 'typescript',
        code: `async onRequestVote(req: { term: number; candidateId: string }) {
  if (req.term > this.term) { this.term = req.term; this.votedFor = null; }
  if (req.term === this.term && (this.votedFor === null || this.votedFor === req.candidateId)) {
    this.votedFor = req.candidateId;
    this.reply({ term: this.term, granted: true });   // answer first, low latency
    await this.disk.save({ term: this.term, votedFor: this.votedFor }); // then persist
    return;
  }
  this.reply({ term: this.term, granted: false });
}`,
      },
      options: [
        'Crash-stop: a node that halts forever after replying can make the election inconclusive',
        'Crash-recovery: a node that crashes after replying but before saving can restart and vote for a different candidate in the same term',
        'Byzantine only: an honest node running this code can never double-vote',
        'Fair-loss links: a dropped reply makes the candidate count a vote that was never granted',
      ],
      correct: [1],
      explanation:
        'In the crash-recovery model, only persisted state survives a restart. This code acknowledges the vote before saving it, so a crash in between loses votedFor. After a restart the node can grant a second vote in the same term, and two candidates can each reach a majority. Under crash-stop the node never comes back, so it cannot double-vote, and the election is merely affected in liveness. A lost reply means the vote is *not* counted, which can delay the election but cannot cause two leaders. The bug needs no malicious behaviour.',
      followUps: [
        {
          q: 'Persisting first adds about 5 ms of fsync to every vote on network disks. Is there a cheaper safe option?',
          a: 'Votes happen only during elections, so 5 ms per vote is irrelevant to throughput. The hot path is AppendEntries, where Raft implementations batch many log entries into one fsync (group commit) and pipeline replication. Never skip fsync for term and vote. If disks are slow, put the WAL on a dedicated low-latency volume (etcd recommends one for exactly this reason) and monitor \`wal_fsync_duration\`.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-05',
      difficulty: 'expert',
      question:
        'A nightly job must run on exactly one of 6 pods. The team uses a Redis key with a 30 s TTL as a lease, and the holder writes results directly to S3 without any token check. During a 45 s GC pause on the holder, another pod acquires the lease. Which property did the design lose, and why?',
      options: [
        'Liveness only: the job ran late, but correctness is unaffected because S3 writes are atomic',
        'Safety: the design silently assumed a synchronous model (pauses < TTL); under partial synchrony two holders write concurrently',
        'Neither: Redis TTL expiry is linearizable, so only one pod can believe it holds the lease',
        'Safety, but only because Redis replication is asynchronous; with a single Redis node the pause would be harmless',
      ],
      correct: [1],
      explanation:
        'A lease without fencing is correct only if no holder ever pauses longer than the TTL. That is a synchronous-model assumption about process timing. With a 45 s pause, the old holder wakes up still believing it holds the lease and writes alongside the new one, which is a safety violation. Atomicity of each S3 PUT does not stop two writers interleaving. A single Redis node does not help either, because the problem is the paused client, not replication. The fix is a fencing token checked by the resource, or idempotent, versioned outputs.',
      followUps: [
        {
          q: 'S3 cannot check a fencing token. How do you make the output safe anyway?',
          a: 'Make the output idempotent and versioned instead of fenced: each run writes to a run-scoped prefix (\`results/2026-10-12/run-<leaseEpoch>/\`), then publishes by a conditional pointer update. S3 conditional writes (\`If-Match\` on the ETag, or \`If-None-Match: *\`) or a DynamoDB conditional put on "current run = epoch N only if the stored epoch < N" make that update safe. A stale holder\'s pointer update fails the condition, and its orphaned prefix is garbage-collected.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-06',
      difficulty: 'expert',
      question:
        'This coupon-redemption service uses a single Kafka partition as its totally ordered log. Under load, a coupon limited to one use is occasionally redeemed twice. What is the bug?',
      code: {
        language: 'typescript',
        code: `// consumer loop (same pod) keeps this map up to date from the 'redemptions' partition
const redeemed = new Map<string, string>(); // couponId -> userId

async function redeem(couponId: string, userId: string): Promise<boolean> {
  if (redeemed.has(couponId)) return false;            // already used
  await producer.send({ topic: 'redemptions', messages: [{ key: couponId, value: userId }] });
  return true;                                         // tell the user it worked
}`,
      },
      options: [
        'The producer must use acks=all; with acks=1 the second redemption overwrote the first',
        'It decides on a lagging local view before appending; it must append, then read the log up to its own offset and apply first-claim-wins',
        'One partition cannot provide total order under concurrent producers; use a transactional producer',
        'The Map should be replaced by Redis SETNX, which is linearizable and makes the log unnecessary',
      ],
      correct: [1],
      explanation:
        'Two pods (or two concurrent calls) can both check the map before either redemption has been consumed back, so both append and both return true. The log totally orders the claims, but the decision ignores that order. The correct total-order-broadcast pattern is: append, then consume up to your own offset, then apply "first claim wins" deterministically. A single partition *does* totally order concurrent producers. acks only affects durability. Redis SETNX could work as a separate design, but swapping the authority is a different system and not the bug in this one.',
      followUps: [
        {
          q: 'Reading up to your own offset adds latency. What does it cost here, and how do you keep it low?',
          a: 'The append (acks=all) takes about 2–5 ms in-region, plus consumer fetch latency until your record is visible. With \`fetch.max.wait.ms\` around 10 ms and a hot consumer, total p99 is about 15–30 ms. Keep one long-lived consumer per partition per pod that tails the log, and have \`redeem\` wait on a promise keyed by offset (or by request id) that resolves when the tailer applies that record. Never start a consumer per request.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-07',
      difficulty: 'hard',
      question:
        'A search-index view consumes two topics: products (keyed by productId) and price-changes (keyed by productId, separate topic). After incidents, some documents show a price that was already superseded. Which explanation is most fundamental?',
      options: [
        'Kafka does not guarantee order within a partition when producers retry',
        'There is no total order across the two topics, so the view can apply a later product snapshot with an embedded old price after a newer price change',
        'Elasticsearch refresh interval of 1 s causes stale reads that look like out-of-order writes',
        'Consumer groups rebalance and reprocess messages, which always resets documents to older versions',
      ],
      correct: [1],
      explanation:
        'Total order exists only within a single partition. Two topics give two independent orders, so the view interleaves them arbitrarily, and a product snapshot carrying an old price can land after a newer price change. The fix is to put all changes for an entity on one partition of one topic (or derive both from one CDC stream), or to version the price field and apply only newer versions. With an idempotent producer, retries do not reorder within a partition. Refresh lag delays visibility but does not leave a superseded price permanently. Reprocessing alone does not regress state if writes are versioned.',
      followUps: [
        {
          q: 'You cannot merge the topics: they are owned by different teams. What do you do?',
          a: 'Make each field carry its own source version and merge **per field** in the view: store \`price\` with \`priceVersion\` (the LSN or event time from the pricing system) and accept a price update only if its version is newer. Ignore embedded prices in product snapshots, or treat them with their own version. Elasticsearch scripted updates or a small stateful processor (Kafka Streams, joining the two by key) can do the compare. This turns an ordering problem into a commutative, last-writer-by-version merge.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-08',
      difficulty: 'hard',
      question:
        'A consumer with reader schema v3 is about to deploy. The subject is in BACKWARD mode and v1/v2 data is still in the topic (30-day retention). Which outcome is correct?',
      code: {
        language: 'json',
        code: `// writer v2 (latest registered)
{ "type": "record", "name": "Payment", "fields": [
  { "name": "id", "type": "string" },
  { "name": "amount", "type": "int" },
  { "name": "method", "type": "string" } ] }

// reader v3 (candidate)
{ "type": "record", "name": "Payment", "fields": [
  { "name": "id", "type": "string" },
  { "name": "amount", "type": "long" },
  { "name": "upiVpa", "type": "string" } ] }`,
      },
      options: [
        'Compatible: int→long is a promotion and method is simply ignored; upiVpa will be an empty string for old records',
        'Rejected: upiVpa exists only in the reader and has no default, so v3 cannot read v2 data',
        'Compatible under BACKWARD but not under FORWARD, so deploy consumers first',
        'Rejected: removing method breaks BACKWARD because old consumers still expect it',
      ],
      correct: [1],
      explanation:
        'BACKWARD asks whether the new schema can read data written with the previous one. Reading v2 data with v3: id matches, int→long is a legal promotion, and method is a writer-only field that gets skipped. But upiVpa is a reader-only field with **no default**, which is a resolution error, so the registry rejects v3. Avro never invents an empty string. Removing method is fine for BACKWARD, which is about the new reader, not old consumers. Fix: give upiVpa a default (e.g. a ["null","string"] union with default null).',
      followUps: [
        {
          q: 'After adding the default, the subject switches to FORWARD. Is v3 still acceptable?',
          a: 'FORWARD asks whether the *previous* schema (v2) can read v3-written data. v2 expects \`amount: int\`, but v3 writes long, and long→int is not a promotion, so it is rejected. v2 also expects \`method\`, which v3 no longer writes, and v2 has no default for it, so that is rejected too. To be FULL-compatible, keep amount as int (or add a new long field), and give method a default before removing it. Under FORWARD you deploy producers first, so old consumers must survive the new data.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-09',
      difficulty: 'expert',
      question:
        'You need to rename the Avro field custName to customerName on a topic consumed by 12 teams, with FULL_TRANSITIVE compatibility. Select ALL statements that are true.',
      options: [
        'Adding aliases: ["custName"] to the new reader field lets new readers resolve old data written with custName',
        'Aliases on the reader side make old readers able to decode data written with customerName',
        'A safe path is: add customerName with a default, dual-write both fields, migrate readers, then remove custName (which has a default)',
        'Protobuf would make the rename free on the wire, because fields are identified by tag numbers, not names',
        'Since Avro resolves by position, a rename that keeps the field in the same position is always compatible',
      ],
      correct: [0, 2, 3],
      explanation:
        'Reader-side aliases let a *new* reader match the writer\'s old name, so they help backward reading only. Old readers have never heard of customerName, so forward compatibility needs a staged change: add with a default, dual-write, migrate, then remove. Protobuf encodes the tag, not the name, so a rename does not change the bytes (JSON mappings can still break). Avro resolves by **name**, not position. Field order in the writer\'s schema only determines how the bytes are laid out.',
      followUps: [
        {
          q: 'During dual-writing, a producer bug sets the two fields to different values. Which one wins for each consumer?',
          a: 'Each reader decodes only the field name it asks for (or its alias). Old readers read custName, and new readers with customerName plus alias custName take **customerName** when the writer has it, because an exact name match takes precedence over an alias. So different teams see different names for the same customer. Add a producer-side invariant check (both values equal), plus a data-quality consumer that samples and alerts on mismatches during the migration window.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-10',
      difficulty: 'hard',
      question:
        'During a rolling deploy, v12 (which writes a new "gstin" key into the JSONB settings column) runs alongside v11. What does v11\'s handler do to merchants edited by v11 pods?',
      code: {
        language: 'typescript',
        code: `// v11 — settings DTO compiled before 'gstin' existed
class MerchantSettings {
  @Expose() displayName!: string;
  @Expose() payoutDay!: number;
}

async updatePayoutDay(id: string, day: number) {
  const row = await this.repo.findOneByOrFail({ id });
  const s = plainToInstance(MerchantSettings, row.settings, { excludeExtraneousValues: true });
  s.payoutDay = day;
  await this.repo.update(id, { settings: instanceToPlain(s) });
}`,
      },
      options: [
        'Nothing harmful: JSONB merges the new object with the existing one on UPDATE',
        'It removes gstin, because the DTO drops unknown keys and the whole settings document is written back',
        'It throws a validation error, because the stored JSON has an unexpected key',
        'It keeps gstin only if v12 also deployed a database migration that added a column',
      ],
      correct: [1],
      explanation:
        '\`excludeExtraneousValues: true\` keeps only @Expose()d properties, so gstin is discarded on read. The UPDATE then replaces the whole JSONB value. Postgres does not merge JSONB on assignment. This is the forward-compatibility failure of old code doing read-modify-write. It is silent, because nothing validates against unknown keys. A column migration is irrelevant: the data lives inside the JSONB document. The fix is a partial update (jsonb_set or the || operator with only the changed key) or preserving unknown keys.',
      followUps: [
        {
          q: 'Would changing the UPDATE to settings = settings || $1::jsonb fix it completely?',
          a: 'It fixes the dropped key, because \`||\` merges top-level keys and keeps gstin. But it is still a read-modify-write of the fields v11 knows: if v12 *changed* displayName concurrently, v11 writes back the stale displayName it read. Write only the field being changed: \`jsonb_set(settings, \'{payoutDay}\', to_jsonb($2))\`, or \`settings || jsonb_build_object(\'payoutDay\', $2)\`. Also note that \`||\` is shallow, so nested objects are replaced wholesale.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-11',
      difficulty: 'medium',
      question:
        'An order service publishes events to a topic with 7-day retention. A new analytics consumer will replay from the beginning on first start. The platform team asks which compatibility mode to set on the subject so this consumer can always read everything retained. Which is the minimum that guarantees it?',
      options: [
        'BACKWARD',
        'BACKWARD_TRANSITIVE',
        'FORWARD',
        'NONE, with the consumer pinning the latest schema',
      ],
      correct: [1],
      explanation:
        'A replaying consumer built against the latest schema must read data written with *every* earlier version still in retention. BACKWARD_TRANSITIVE checks the new schema against all previous versions. Plain BACKWARD checks only against the immediately previous version, so a v5 reader may fail on v2 data. FORWARD is about old readers reading new data. NONE gives no guarantee, and the consumer decodes with the writer id in each message regardless.',
      followUps: [
        {
          q: 'The topic is compacted rather than time-retained. Does the answer change?',
          a: 'It gets stricter in practice, not different in kind: a compacted topic can hold a record written by v1 *years* ago for a key that never changed, so transitive checking must cover every version ever registered. Teams sometimes use periodic "rewrite" jobs that re-publish every key with the current schema, so old versions can eventually be removed from the compatibility set and deleted from the registry.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-12',
      difficulty: 'expert',
      question:
        'A Kafka Streams app joins a payments KStream with a merchants KTable (non-versioned) to attach a fee tier. Reprocessing last month from offset 0 yields different tiers for about 3% of payments. What is the root cause and the most appropriate fix?',
      options: [
        'Exactly-once is disabled; enabling processing.guarantee=exactly_once_v2 makes the output reproducible',
        'The join uses the table state at processing time; switch to a versioned table (timestamped lookup) or record the tier version on each payment',
        'Co-partitioning is broken; the merchants topic must have more partitions than payments',
        'RocksDB caching reorders updates; set cache.max.bytes.buffering=0 to restore determinism',
      ],
      correct: [1],
      explanation:
        'A non-versioned KStream-KTable join looks up whatever the table holds when each stream record is processed. During reprocessing the table is already at its latest state (or at a different point relative to the stream), so payments made before a tier change get the new tier. A versioned store with timestamp-based lookups (KIP-889/KIP-914) or SCD-style version ids make the result depend on event time only. EOS prevents duplicates, not time-dependence. Co-partitioning needs *equal* partition counts. Caching affects emission frequency, not which table version is joined.',
      followUps: [
        {
          q: 'With a versioned store, what new failure mode must you monitor?',
          a: 'Updates older than the store\'s **history retention** cannot be looked up: a stream record with a timestamp before the retained history finds no version, and an out-of-order table update older than the grace period is dropped. Size history retention to cover your maximum stream lateness and replay horizon, and alert on dropped late records (Streams exposes dropped-records metrics). A full-month replay needs a month of history, or version ids stored on the events.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-13',
      difficulty: 'hard',
      question:
        'An ad platform runs a stream-stream LEFT join of impressions with clicks, using a 30-minute window and a 5-minute grace period, to produce "impression, clicked yes/no". When is a "not clicked" result emitted for an impression at 10:00:00 (event time)?',
      options: [
        'Immediately at 10:00:00, then updated if a click arrives later',
        'Only once the watermark passes 10:35:00 (window end plus grace), because only then can no matching click still arrive',
        'At 10:30:00 processing time, regardless of the watermark',
        'Never; left joins in streaming emit only matched pairs',
      ],
      correct: [1],
      explanation:
        'A non-match is a statement about the *absence* of a click, so it can be finalised only when no matching click can still arrive: the 30-minute window plus the 5-minute grace, as measured by the event-time watermark. Emitting immediately and updating later is possible only with a retracting changelog output, which is not what this pipeline produces. Processing time is irrelevant to event-time windows. Left joins do emit unmatched rows, which is their point.',
      followUps: [
        {
          q: 'The click topic\'s producer goes down for 20 minutes. What happens to the "not clicked" outputs?',
          a: 'It depends on how the watermark is computed. If the join operator\'s watermark is the minimum over its inputs, the stalled click input holds it back, and non-match emission pauses. That is correct but delayed. If the idle-source handling marks the click input idle, the watermark advances on impressions alone, and the job emits "not clicked" for impressions whose clicks are simply delayed, which is wrong. Those clicks arrive after the grace period and are dropped. For attribution, prefer pausing (no idleness on that input) and alert on watermark lag.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-14',
      difficulty: 'expert',
      question:
        'After writing a profile update to Postgres (the system of record), a NestJS API immediately reads the user\'s profile from an Elasticsearch view fed by Debezium, and users sometimes see their old bio. Select ALL designs that provide read-your-writes without making every read go to Postgres.',
      options: [
        'Return the commit LSN to the client as a session token; on read, if the view\'s applied LSN is below the token, serve from Postgres (or wait briefly)',
        'Call Elasticsearch _refresh after every Debezium event so the index is always current',
        'For a short window after the write (e.g. 10 s), route only that user\'s own-profile reads to Postgres; everyone else reads the view',
        'Dual-write the bio to Elasticsearch synchronously in the request, in addition to CDC, with an external version equal to the LSN',
        'Increase the Debezium poll interval so changes are batched and applied atomically',
      ],
      correct: [0, 2, 3],
      explanation:
        'An LSN session token compared against the view\'s applied position gives precise read-your-writes. Routing the writer\'s own reads to the system of record for a short window is a cheap approximation. Writing the document synchronously with external version = LSN is safe *because* of the version: CDC delivering the same LSN later is rejected or ignored (use external_gte to accept equal versions), and an older LSN can never overwrite it. Refreshing after every event only removes the ~1 s refresh delay, not CDC lag, and it hurts indexing throughput. A longer poll interval *adds* lag.',
      followUps: [
        {
          q: 'Where does the view\'s "applied LSN" come from, and how fresh must it be?',
          a: 'The indexer records the highest LSN it has applied (per partition, or the minimum across partitions for a global position) in Redis or a small table after each bulk request succeeds. The API reads it, possibly cached for about 100 ms. A slightly stale "applied" value only causes extra fallbacks to Postgres, never a stale read, so it is safe to cache. Under per-key routing you can also check the document\'s own \`_version\` (= LSN) directly: if it is ≥ the token, the doc is fresh.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-15',
      difficulty: 'expert',
      question:
        'This indexer uses the Kafka offset as the Elasticsearch external version. The team re-snapshots the source table into a NEW topic (pg2.public.orders) and points the indexer at it. What happens?',
      code: {
        language: 'typescript',
        code: `await consumer.run({
  eachMessage: async ({ message }) => {
    const doc = JSON.parse(message.value!.toString()).after;
    try {
      await es.index({
        index: 'orders', id: message.key!.toString(), document: doc,
        version: Number(message.offset), version_type: 'external',
      });
    } catch (e: any) {
      if (e.meta?.statusCode === 409) return;   // stale event, ignore
      throw e;
    }
  },
});`,
      },
      options: [
        'The index converges normally, because offsets in the new topic increase monotonically',
        'Most updates are silently ignored, because new offsets start near 0 and are lower than versions already stored, so ES returns 409 and the code skips them',
        'ES rejects the requests with 400, because external versions must be timestamps',
        'Documents are duplicated, because ES treats a new topic as a new index namespace',
      ],
      correct: [1],
      explanation:
        'External versioning accepts a write only if its version is greater than the stored one. The old topic left documents with versions up to, say, 40M. The new topic\'s offsets start at 0, so nearly every update is rejected with 409, and this code treats 409 as "stale, ignore", so the index silently freezes. Offsets are monotonic only within one partition of one topic. Use a source-derived version (the Postgres LSN, or a row version column), which survives re-plumbing. External versions can be any positive long, not only timestamps, and the index name is unaffected by topic names.',
      followUps: [
        {
          q: 'Even within one topic, is the offset a safe version if the topic has 12 partitions?',
          a: 'Per document, yes, *if* every update for a document id goes to the same partition (keyed by id) and the partition count never changes. Offsets in different partitions are unrelated, but each doc only ever sees one partition. Increasing partitions remaps keys: a doc\'s new partition may have a lower offset than its old one, and updates get rejected. Use the LSN. And whatever the version is, alert on the 409 rate: a sustained 409 rate means the view is stuck.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-16',
      difficulty: 'medium',
      question:
        'A consumer reads payment-intents (Kafka, EOS enabled for the read-process-write to a payouts topic) and then calls the bank payout API from another consumer of payouts. Duplicate payouts still occur after rebalances. Select ALL changes that address the root cause per the end-to-end argument.',
      options: [
        'Carry the original intent id end to end and send it to the bank as the idempotency/reference key',
        'Raise transaction.timeout.ms so Kafka transactions never abort during rebalances',
        'Record payout attempts in a DB table with a unique intent id, checked in the same transaction that marks the payout as sent',
        'Switch the payout consumer to read_uncommitted to see records sooner',
        'Query the bank by reference before retrying a payout whose outcome is unknown',
      ],
      correct: [0, 2, 4],
      explanation:
        'Kafka EOS covers the read-process-write *within Kafka*. The bank call is an external side effect that gets repeated when a payout record is redelivered after a rebalance. The end-to-end fix is an operation id born with the intent, enforced at the points of effect: the bank (idempotency key or reference), your own payouts table (unique id), and a status check before any retry. Transaction timeouts do not stop redelivery to the side-effecting consumer, and read_uncommitted would expose aborted records, which adds duplicates.',
      followUps: [
        {
          q: 'The bank ignores your reference and has no status API. What is the least-bad design?',
          a: 'Make the payout effectively at-most-once on your side: insert \`payout(intent_id, status=SENDING)\` *before* the call (unique). On redelivery with status SENDING you do not resend; you mark it UNKNOWN and reconcile against the bank statement (usually T+0 or T+1 via a file or webhook). Some payouts are delayed for manual resolution, but none are doubled. Paying twice is usually much worse than paying late. Also escalate to the bank, because this is a contract issue.',
        },
      ],
    },
    {
      id: 'ds-theory-mcq-17',
      difficulty: 'hard',
      question:
        'Four fintechs want a shared ledger for interbank settlements, and none will let another operate it. A 3-node Raft cluster run by one of them is proposed. What is the main objection, and what changes in a Byzantine-tolerant design?',
      options: [
        'Raft cannot run across companies because it needs a shared VPC; a VPN fixes it without changing the protocol',
        'Raft assumes honest nodes; the operator could rewrite or reorder the log. BFT needs 3f+1 nodes (4 tolerate 1 liar) with signed messages and 2f+1 quorums',
        'Raft tolerates only crash faults of a minority; adding 2 more nodes (5 total) makes it Byzantine-tolerant',
        'Raft is fine if every message is TLS-encrypted, because TLS prevents a node from lying',
      ],
      correct: [1],
      explanation:
        'Raft and other crash-fault protocols trust that every node follows the protocol. A single operator controlling the leader can reorder, omit or rewrite entries, and the other nodes accept them. Among mutually distrusting parties you need BFT: 3f+1 nodes (each company runs one, so f = 1), signed messages, and quorums of 2f+1 so any two quorums share an honest node. More Raft nodes add crash tolerance, not lie tolerance. TLS authenticates the channel, but cannot stop an authenticated node from sending false content.',
      followUps: [
        {
          q: 'One fintech goes offline for maintenance. Can the other three keep settling?',
          a: 'With n = 4 and f = 1, the quorum is 2f+1 = 3. Three honest, online nodes can keep committing, so yes, but there is now **no margin**: if another node misbehaves or goes down, progress stops (safety holds, liveness is lost). To tolerate one Byzantine node *and* one planned outage you need n = 3f+1 with f = 2, i.e. 7 nodes, or you schedule maintenance with all others healthy. Members usually also want each node\'s keys in HSMs so that an outage cannot become a compromise.',
        },
      ],
    },
  ],
};

export default topic;
