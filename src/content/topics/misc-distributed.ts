import type { Topic } from '../../types';

const topic: Topic = {
  id: 'misc-distributed',
  phase: 'miscellaneous',
  order: 5,
  title: 'Consistency, Consensus, Locks, Sagas & Event-driven Patterns',
  subtitle:
    'Question bank: consistency models, CAP, quorums, leader election, Raft, distributed locks, fencing tokens, idempotency, sagas, CQRS and event sourcing. New angles on concepts the deep-dive topics already teach.',
  estimatedMinutes: 120,
  sources: [
    'Martin Kleppmann — Designing Data-Intensive Applications, Ch 5, 7, 8, 9, 11',
    'Martin Kleppmann — "How to do distributed locking" (2016); Salvatore Sanfilippo — "Is Redlock safe?" (2016)',
    'Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (2014); Ongaro PhD thesis (PreVote, membership changes)',
    'Howard, Malkhi & Spiegelman — Flexible Paxos: Quorum intersection revisited (2016)',
    'Terry et al. — Session Guarantees for Weakly Consistent Replicated Data (1994)',
    'Garcia-Molina & Salem — Sagas (1987); Chris Richardson — Microservices Patterns, Ch 4, 6, 7',
    'IETF draft-ietf-httpapi-idempotency-key-header (409 for in-flight duplicates, 422 for payload mismatch)',
    'Kubernetes client-go leaderelection docs; etcd, ZooKeeper, Cassandra, Azure Cosmos DB and Temporal documentation',
    'Hello Interview — CAP theorem core concept and "Multi-step processes" pattern (2025)',
    'Algoroq — Distributed Systems Interview Questions for Senior Engineers (2026); PracHub — Distributed lock interview questions (2025)',
    'System Design Handbook — CAP theorem interview questions (2026); DEV Community — Design a distributed lock service (2025)',
  ],
  tags: [
    'consistency',
    'cap',
    'quorum',
    'leader-election',
    'raft',
    'distributed-lock',
    'fencing-token',
    'idempotency',
    'saga',
    'cqrs',
    'event-sourcing',
    'question-bank',
  ],
  cheatSheet: [
    'Consistency ladder (strong → weak): strict serializable > linearizable > sequential > causal > session guarantees (RYW, monotonic reads/writes, writes-follow-reads) > consistent prefix > eventual. Name the weakest one the feature can live with.',
    'CAP only bites during a partition, and it is chosen per operation, not per product: seat booking refuses writes (CP), event browsing serves stale (AP). PACELC adds the everyday trade: latency vs consistency.',
    'A timeout is not a failure — it is "unknown". Every CP write that times out may still commit; the client needs an idempotent retry to find out.',
    'Quorum overlap needs R + W > N; LOCAL_QUORUM with RF=3 per DC is 2 local acks, plain QUORUM across 3 DCs × RF 3 is 5 of 9 and crosses an ocean. Flexible Paxos: only election and replication quorums must intersect.',
    'Leader election gives you "at most one leader most of the time", never "exactly one". client-go explicitly does not fence: defaults 15 s lease, 10 s renew deadline, 2 s retry.',
    'Raft commit latency = RTT to the fastest majority, not the slowest node. Add nodes as non-voting learners first; PreVote + CheckQuorum stop a flapping node from deposing a healthy leader.',
    'Raft apply must be deterministic and side-effect free — it runs on every replica and again on every replay. External effects go through the leader with an idempotency key.',
    'Before a distributed lock, try a unique constraint, a conditional UPDATE or a single-partition queue. Locks for efficiency may be sloppy; locks for correctness need fencing.',
    'Fencing token = monotonic number issued with the lock (etcd revision, ZooKeeper zxid, DB epoch). The resource rejects token < highest seen, in ONE atomic conditional write. Allow equal tokens for the same holder.',
    'Idempotency-Key semantics: same key + in-flight → 409; same key + different payload → 422; scope keys per tenant; TTL must exceed the longest client retry window.',
    'Saga ordering: compensable steps → pivot (point of no return) → retriable steps. Sagas lack isolation — use semantic locks, commutative updates and rereads.',
    'CQRS read models are caches you can rebuild; never validate commands against them. Event sourcing: append with expected version, upcast old events on read, treat snapshots as disposable.',
  ],
  sections: [
    {
      heading: 'Consistency models — naming exactly the guarantee a feature needs',
      body: `**What it is:** a consistency model is a contract about which values a read may return given the writes that happened before it. "Strong" and "eventual" are the two ends; interviews are won in the middle.

**The ladder (strong → weak):**

| Model | Promise | Typical provider |
|---|---|---|
| Linearizable | Every read sees the latest acknowledged write, as if one copy | etcd default reads, Spanner |
| Sequential | One global order all clients agree on, not tied to real time | ZooKeeper reads (its writes are linearizable) |
| Causal | Cause is seen before effect by everyone | MongoDB causal sessions |
| Session (RYW, monotonic reads, monotonic writes, writes-follow-reads) | Guarantees for one client's view | Cosmos DB "session" (its default) |
| Consistent prefix | You never see writes out of order, but may lag | Cosmos DB "consistent prefix" |
| Eventual | Replicas converge if writes stop | Cassandra CL=ONE, DynamoDB default reads |

**Mechanism:** weaker models are cheaper because a replica can answer alone. Session guarantees are usually built by the client carrying a token (LSN, version, timestamp) and a replica serving only once it has caught up to it.

**The #1 trap:** mixing up *isolation* (serializable — transactions interleave safely) with *consistency* (linearizable — reads are fresh). A serializable database with async replicas can still show a stale read.`,
      keyPoints: [
        'Pick the weakest model that keeps the product correct, per feature.',
        'Session guarantees = client-carried tokens; causal = dependency tracking.',
        'Isolation (serializable) and recency (linearizable) are separate axes.',
      ],
      source: 'Kleppmann — DDIA Ch 5 & 9; Terry et al. 1994; Azure Cosmos DB consistency levels docs',
    },
    {
      heading: 'CAP — a per-operation choice you make during a partition',
      body: `**What it is:** when the network splits replicas, an operation either waits or fails (consistency) or answers with possibly stale or divergent data (availability). Partitions are not optional, so "CA" is not a real option for a distributed system.

**How to use it in an interview:** in non-functional requirements, ask per operation: "does this read *have* to see the latest write?" A classic example is Ticketmaster: booking a seat must be consistent (never double-book), browsing event details can be stale. The same product has both CP and AP paths.

**What CAP does not tell you:**
- It says nothing about latency when there is no partition — that is **PACELC** (else: latency vs consistency).
- Real partitions are often *partial*: A sees B, B sees C, A does not see C, or a link drops 40% of packets. Failure detectors flap, and failover automation can cause more harm than the partition.
- "Available" in the CAP proof means every non-failed node answers — stronger than your 99.9% SLO.

**The #1 trap:** treating a timeout as a failed write. On the CP side a write that times out may still commit. The client must retry idempotently or read back.`,
      diagram: `  Mumbai (primary)   ~~x~~  Singapore (replica)
        |                           |
   CP choice: minority side     AP choice: both sides
   rejects writes / reads       accept writes, reconcile
   -> errors, no divergence     later -> conflicts to merge`,
      keyPoints: [
        'CAP is per operation and only during partitions; PACELC covers the normal case.',
        'Partial and gray partitions are the common real case.',
        'Timeouts are indeterminate outcomes, not failures.',
      ],
      source: 'Brewer (2000, 2012); Gilbert & Lynch (2002); Abadi — PACELC (2012); Hello Interview — CAP theorem',
    },
    {
      heading: 'Quorum — overlap math, and where it quietly breaks',
      body: `**What it is:** with N replicas, a write waits for W acks and a read asks R replicas. If **R + W > N**, every read set overlaps every write set, so at least one replica in the read has the latest acknowledged write.

**Mechanism in practice:**
- N=3, W=2, R=2 tolerates one node down for both reads and writes.
- N=5, W=3, R=3 tolerates two. W=1/R=N makes writes cheap but a single dead node blocks reads.
- **Multi-DC Cassandra:** QUORUM counts replicas in *all* DCs (3 DCs × RF 3 = 9, so 5 acks, crossing regions). LOCAL_QUORUM waits for 2 of 3 in the local DC; EACH_QUORUM waits for a quorum in every DC.
- **Consensus quorums:** Raft and Paxos use majorities. *Flexible Paxos* shows only the leader-election quorum and the replication quorum need to intersect (Q1 + Q2 > N), so you can shrink one by growing the other.

**Where overlap is not enough:** sloppy quorums with hinted handoff (writes land on non-home nodes), last-write-wins with skewed clocks, and failed writes that partially landed on some replicas. None of these give linearizability without read repair before returning.

**The #1 trap:** saying "QUORUM = strong consistency". It gives overlap, not recency ordering.`,
      keyPoints: [
        'R + W > N gives overlap; it does not give linearizability.',
        'QUORUM vs LOCAL_QUORUM decides whether every write crosses a region.',
        'Flexible Paxos: only Q1 and Q2 must intersect.',
      ],
      source: 'DDIA Ch 5; Cassandra consistency-level docs; Howard et al. — Flexible Paxos (2016)',
    },
    {
      heading: 'Leader election — at most one leader, most of the time',
      body: `**What it is:** picking one node to do singleton work (scheduler, shard owner, primary). The honest guarantee is *at most one leader most of the time*. There are always short windows where an old leader has not yet noticed it lost.

**Mechanisms:**
- **Lease on a linearizable store** (etcd lease, ZooKeeper ephemeral node, Kubernetes Lease object, a DB row with expires_at). The leader renews; others take over after expiry.
- **Consensus-internal** (Raft terms): the leader is whoever won the latest term's majority vote.

**Kubernetes client-go knobs** (kube-controller-manager defaults): leaseDuration 15 s (how long candidates wait before taking over), renewDeadline 10 s (how long the leader keeps retrying renewal before it gives up leadership), retryPeriod 2 s. The client-go docs say plainly that this does **not** guarantee a single active leader: there is no fencing.

**Safety rule for your own code:** the leader must stop working *before* the lease can expire for others. Measure from when the renew request was **sent**, use a monotonic clock, and leave a margin for clock-rate drift.

**The #1 trap:** believing a shorter TTL or faster heartbeat removes split brain. It only shrinks the window. Fencing at the resource closes it.`,
      code: [
        {
          language: 'typescript',
          title: 'Leader self-check measured from request send time (monotonic)',
          code: `import { performance } from 'node:perf_hooks';

const LEASE_MS = 15_000;
const SAFETY_MS = 3_000; // margin for clock-rate drift + scheduling delay
let validUntil = 0;       // monotonic ms

async function renewLoop(store: { renew(ttlMs: number): Promise<boolean> }) {
  for (;;) {
    const sentAt = performance.now(); // start the clock BEFORE the RPC
    const ok = await store.renew(LEASE_MS).catch(() => false);
    if (ok) validUntil = sentAt + LEASE_MS - SAFETY_MS;
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

export function amLeader(): boolean {
  return performance.now() < validUntil; // check before every unit of work
}`,
        },
      ],
      keyPoints: [
        'Leases give a bounded overlap window, never zero.',
        'Start the validity clock when the renewal is sent, not when it returns.',
        'Pair election with fencing for anything that must be correct.',
      ],
      source: 'Kubernetes client-go leaderelection package docs; DDIA Ch 8',
    },
    {
      heading: 'Raft — terms, majorities, and the operational details that bite',
      body: `**What it is:** a consensus protocol that keeps a replicated log identical on a majority. It uses a strong leader, randomised election timeouts, and terms. It is used by etcd, Consul, CockroachDB, TiKV and Kafka KRaft (Kafka 4.0, released 2025, removed ZooKeeper).

**Mechanism in one breath:** a follower that hears nothing within its election timeout becomes a candidate, increments the term and asks for votes. Voters only accept candidates whose logs are at least as up to date. The leader appends entries and replicates them. An entry from the current term is committed once a majority stores it, and every node then applies committed entries in order to its state machine.

**Operational facts interviewers probe:**
- **Commit latency = RTT to the fastest majority.** In a 5-node cluster the two slowest nodes do not matter.
- **Membership changes:** add a node as a non-voting **learner** (etcd 3.4+) until it catches up, then promote it. Change one voter at a time or use joint consensus.
- **PreVote + CheckQuorum:** a node rejoining after a partition asks "would you vote for me?" before bumping the term, and a leader that cannot hear a majority steps down.
- **Snapshots:** a follower too far behind is sent a snapshot (InstallSnapshot) instead of old log entries.

**The #1 trap:** side effects in apply(). Apply runs on every replica and again on every restart or replay.`,
      keyPoints: [
        'Majority of 2f+1 tolerates f failures; latency tracks the fastest majority.',
        'Learners first, one voter change at a time.',
        'Apply must be deterministic; effects go outside the state machine.',
      ],
      source: 'Ongaro & Ousterhout (2014); Ongaro thesis §4, §9.6; etcd learner design docs',
    },
    {
      heading: 'Distributed locks — efficiency locks vs correctness locks',
      body: `**What it is:** mutual exclusion across processes or machines, usually a key with a TTL in Redis, etcd, ZooKeeper or Postgres. The key distinction:
- **Efficiency lock:** stops duplicated work (two pods rebuilding the same cache entry). An occasional double run costs money, not correctness. A single Redis SET NX PX is fine.
- **Correctness lock:** protects an invariant (ledger, file, inventory). A pause or failover *will* eventually let two holders overlap, so you need fencing or a design that needs no lock.

**Try these first:** a UNIQUE constraint, a conditional UPDATE ... WHERE version = $v, SELECT ... FOR UPDATE inside one transaction, or sending all work for a key to one Kafka partition so a single consumer serialises it.

**Implementation details that matter:**
- Lock value = random owner id; release and renew must check the owner atomically (Lua or CAS).
- Watchdog renewal (Redisson renews every 10 s with a 30 s default lease) must stop when the process is unhealthy, or a stuck process holds the lock forever.
- **Postgres advisory locks** are cheap and die with the session. But session-level ones break behind PgBouncer transaction pooling, because the next statement may run on a different server connection.

**The #1 trap:** using Redlock or a longer TTL as a substitute for fencing on a correctness lock.`,
      keyPoints: [
        'Classify the lock: efficiency (sloppy OK) or correctness (fence it).',
        'Owner-checked release/renew; watchdogs tied to health.',
        'Session advisory locks + transaction pooling do not work together.',
      ],
      source: 'Kleppmann — How to do distributed locking (2016); PgBouncer feature matrix; Redisson docs',
    },
    {
      heading: 'Fencing tokens — why a lock alone is not enough',
      body: `**What it is:** a number that only goes up, issued every time the lock or lease is granted. The holder sends it with every write, and the **resource** rejects any token lower than the highest one it has already seen. A paused ex-holder that wakes up carries an old token and is refused.

**Where tokens come from:**
- etcd: the lock key's create revision (or mod revision), which is cluster-wide and monotonic.
- ZooKeeper: the zxid, or the sequence number of the ephemeral sequential node.
- A database: an epoch column incremented in the same UPDATE that grants the lease.
- *Not* a Redis INCR on an asynchronously replicated primary: an acknowledged increment can be lost in a failover, so a token can repeat.

**Where it must be checked:** in one atomic step at the resource. For example: UPDATE ... SET data = $d, fence = $t WHERE id = $id AND fence <= $t. Reading the stored fence and then writing in a second step reopens the race. Use <= rather than < so the current holder can make several writes with the same token.

**When the resource cannot check:** move the check to something that can. Use conditional writes (S3 If-Match / If-None-Match, GCS generation preconditions), put the epoch in the object key or idempotency key, or route writes through a proxy or DB row that enforces it.`,
      diagram: `client A  lock(tok=33) ...... GC pause 40s ...... write(tok=33) -> REJECT
lock svc          expires ──> client B lock(tok=34)
client B                       write(tok=34) -> OK (store max=34)`,
      keyPoints: [
        'The resource enforces the token, not the client.',
        'Tokens must survive lock-service failover without going backwards.',
        'Check and write in one conditional statement; allow equal tokens.',
      ],
      source: 'Kleppmann (2016); Google Chubby paper — sequencers (2006); etcd concurrency API docs',
    },
    {
      heading: 'Idempotency — making retries safe end to end',
      body: `**What it is:** doing an operation twice has the same effect as doing it once. Networks turn every "maybe" into a retry, so every side-effecting path needs an answer for duplicates.

**Tools, in order of preference:**
1. **Natural idempotency:** absolute writes (SET status = 'PAID' WHERE status = 'PENDING') instead of relative ones (balance = balance + 100).
2. **Idempotency keys** on APIs. Store key → (request fingerprint, status, response). The IETF Idempotency-Key draft says: a duplicate while the first is in flight → **409**; the same key with a different payload → **422**. Scope keys per tenant or merchant, and keep them longer than the longest client retry window (Stripe keeps them at least 24 h).
3. **Dedupe by position** for streams: store the last applied offset or per-producer sequence number with the state change, instead of an ever-growing set of event ids.

**"Exactly-once" in practice** means at-least-once delivery plus idempotent effects. Kafka's exactly-once covers read-process-write inside Kafka. It does not cover the HTTP call or email in the middle.

**The #1 trap:** a check-then-act dedupe (SELECT key, then INSERT) without a unique constraint. Two concurrent retries both pass the check.`,
      keyPoints: [
        'Prefer absolute/conditional writes; add keys where effects are relative.',
        '409 in-flight, 422 payload mismatch, per-tenant scope.',
        'Stream dedupe by offset/sequence, stored atomically with the effect.',
      ],
      source: 'IETF draft-ietf-httpapi-idempotency-key-header; Stripe API docs (idempotent requests, webhooks)',
    },
    {
      heading: 'Distributed transactions / Saga — compensate instead of locking',
      body: `**What it is:** a saga (Garcia-Molina & Salem, 1987) splits a cross-service business transaction into local transactions. If a later step fails, it runs **compensating** transactions for the earlier steps. You give up atomic isolation and gain availability and loose coupling. 2PC is the alternative: atomic, but it blocks when the coordinator fails and holds locks across services.

**Designing the step order (Richardson):**
- **Compensable** steps come first (reserve seat, hold funds).
- The **pivot** is the go/no-go step (capture payment). Once it succeeds, the saga must run to completion.
- **Retriable** steps come after the pivot and must eventually succeed (send ticket email, notify partner). Put effects that cannot be undone, like emails, here.

**Coordination:** choreography (services react to each other's events) suits 2–4 steps. Orchestration (a central state machine) suits longer flows and audits. Durable-execution engines (Temporal, AWS Step Functions) persist the orchestrator's progress so a crash resumes mid-saga.

**The #1 trap:** forgetting that sagas lack isolation. Other transactions see intermediate states. Countermeasures: semantic locks (status = PENDING_CANCEL), commutative updates, rereading before overwriting, and ordering steps so the riskiest step comes first.`,
      diagram: `reserveSeat ─> holdFunds ─> [PIVOT capturePayment] ─> issueTicket ─> email
    ^ undo        ^ undo            | after this: only forward,
    cancelSeat    releaseFunds      | retry until success`,
      keyPoints: [
        'Compensable → pivot → retriable.',
        'Persist saga state per step; every step and compensation idempotent.',
        'No isolation: design semantic locks and commutative updates.',
      ],
      source: 'Garcia-Molina & Salem (1987); Richardson — Microservices Patterns Ch 4; Hello Interview — Multi-step processes',
    },
    {
      heading: 'CQRS — separate write and read models, and live with the lag',
      body: `**What it is:** Command Query Responsibility Segregation uses one model to change data (commands, which enforce invariants) and one or more models to read it (projections shaped for each screen or query). Projections are fed by events or CDC, so reads are eventually consistent with writes.

**When it pays off:**
- Read and write shapes differ a lot (normalised order tables vs a search document per order).
- Read and write loads differ by 10–100× and need to scale separately.
- The same data is needed in several forms: Elasticsearch for search, Redis for counters, a warehouse for analytics.

**When it is overkill:** CRUD screens, a small team, or a product where "I saved it but cannot see it" is unacceptable and you cannot afford read-your-writes workarounds.

**Mechanics that matter:**
- Every projection records the **position** (offset, global sequence) it has applied, in the same transaction as the read-model update. That makes replays idempotent.
- Rebuilds are routine. Build a new projection side by side, catch it up, then switch an alias.
- Read-your-writes: return the new version from the command, and have the UI wait until the projection reaches it, or read that one item from the write side.

**The #1 trap:** validating commands (uniqueness, balance) against the read model. It is stale by design.`,
      keyPoints: [
        'Commands enforce invariants on the write model only.',
        'Projection position stored atomically with the projection.',
        'Plan rebuilds and read-your-writes from day one.',
      ],
      source: 'Richardson — Microservices Patterns Ch 7; Greg Young — CQRS documents',
    },
    {
      heading: 'Event sourcing — the log is the database',
      body: `**What it is:** instead of storing current state, you store the immutable sequence of domain events (FundsDeposited, FundsWithdrawn) per aggregate. Current state is a fold over those events. You get a complete audit trail and time travel for free. You pay with schema evolution, replay cost and a harder query story (which is why it is almost always paired with CQRS).

**Mechanics:**
- **Append with optimistic concurrency:** "append event 58 to stream account-42, expecting version 57". A UNIQUE (stream_id, version) constraint or the event store's expected-version check makes one of two concurrent writers fail and retry.
- **Snapshots** every N events (often 100–1,000) bound replay time. They are caches: version them and throw them away when the aggregate code changes.
- **Schema evolution:** never edit stored events. Upcast old versions to the new shape when reading, or run a copy-and-transform migration into a new stream.
- **Stores:** KurrentDB (formerly EventStoreDB), Postgres tables, DynamoDB with conditional puts. Kafka alone lacks per-key expected-version appends, so it works as a transport, not as the source-of-truth event store.

**Distinguish:** event sourcing (events are the state) vs event-driven architecture (events notify other services) vs CDC (events derived from row changes).

**The #1 trap:** putting integration events and internal domain events in the same schema, which couples every consumer to your aggregate internals.`,
      code: [
        {
          language: 'sql',
          title: 'Postgres event store with per-stream optimistic concurrency',
          code: `CREATE TABLE events (
  global_seq  BIGSERIAL PRIMARY KEY,           -- total order for projections
  stream_id   TEXT        NOT NULL,            -- e.g. 'account-42'
  version     INT         NOT NULL,            -- per-stream position
  type        TEXT        NOT NULL,
  schema_ver  SMALLINT    NOT NULL DEFAULT 1,  -- enables upcasting
  payload     JSONB       NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stream_id, version)                  -- concurrent append -> 23505
);

-- Append expecting the stream to be at version 57
INSERT INTO events (stream_id, version, type, payload)
VALUES ('account-42', 58, 'FundsWithdrawn', '{"amountPaise": 50000}');`,
        },
      ],
      keyPoints: [
        'Expected-version append is the concurrency control.',
        'Snapshots are disposable; events are forever — upcast, never edit.',
        'Event sourcing ≠ event-driven ≠ CDC.',
      ],
      source: 'Richardson — Microservices Patterns Ch 6; Kurrent docs; DDIA Ch 11',
    },
  ],
  codeChallenges: [
    {
      id: 'misc-distributed-cc-1',
      title: 'Make the "only one pod runs compaction" job actually safe',
      context:
        'A NestJS service runs on 6 pods. Every 5 minutes a cron job recomputes wallet snapshot balances from the ledger and clears a dirty flag. The team added a Redis lock so only one pod runs it. Last month two pods ran concurrently after a long GC pause, and some snapshots ended up with an older balance than the ledger. Separately, a few wallets stayed stale forever.',
      task: 'Find every correctness bug in the locking and in the write path, then rewrite the job so an overlapping ex-holder can never overwrite newer work and no dirty mark is ever lost. You may use the Postgres the service already has.',
      starter: {
        language: 'typescript',
        title: 'ledger-compaction.job.ts (buggy)',
        code: `import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { Pool } from 'pg';

@Injectable()
export class LedgerCompactionJob {
  constructor(private readonly redis: Redis, private readonly pg: Pool) {}

  @Cron('*/5 * * * *')
  async run() {
    // same value on every pod; TTL 60 s but a full run takes 3-6 minutes
    const got = await this.redis.set('lock:compaction', '1', 'EX', 60, 'NX');
    if (!got) return;
    try {
      const { rows } = await this.pg.query(
        'SELECT id FROM wallet_snapshots WHERE dirty = true LIMIT 5000',
      );
      for (const r of rows) {
        const total = await this.computeBalance(r.id); // sums ledger rows, ~50 ms
        await this.pg.query(
          'UPDATE wallet_snapshots SET balance = $1, dirty = false WHERE id = $2',
          [total, r.id],
        );
      }
    } finally {
      await this.redis.del('lock:compaction'); // may delete another pod's lock
    }
  }

  private async computeBalance(id: string): Promise<number> {
    const { rows } = await this.pg.query(
      'SELECT COALESCE(SUM(amount_paise), 0) AS s FROM ledger WHERE wallet_id = $1',
      [id],
    );
    return Number(rows[0].s);
  }
}`,
      },
      hints: [
        'List what happens at minute 1 of a 5-minute run, and what a pod that wakes up from a 90-second pause does next.',
        'A lock holder needs a number that grows with every grant, and the row being written needs to remember the highest number that wrote it.',
        'The dirty flag has its own race: a ledger insert can set dirty = true between your SUM and your UPDATE.',
      ],
      solution: {
        language: 'typescript',
        title: 'ledger-compaction.job.ts (lease with epoch + fenced, version-checked writes)',
        code: `import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// leases(name PK, holder TEXT, epoch BIGINT, expires_at TIMESTAMPTZ)
// wallet_snapshots(+ fence BIGINT DEFAULT 0, dirty_seq BIGINT) - ledger inserts bump dirty_seq
const LEASE_S = 30;
@Injectable()
export class LedgerCompactionJob {
  private readonly log = new Logger(LedgerCompactionJob.name);
  private readonly me = randomUUID(); // unique owner id per process
  constructor(private readonly pg: Pool) {}

  private async grant(renewEpoch?: number): Promise<number | null> {
    const sentAt = performance.now();
    const { rows } = await this.pg.query(
      \`INSERT INTO leases (name, holder, epoch, expires_at)
       VALUES ('compaction', $1, 1, now() + make_interval(secs => $2))
       ON CONFLICT (name) DO UPDATE SET
         holder = EXCLUDED.holder,
         epoch = CASE WHEN leases.holder = $1 AND leases.epoch = $3
                      THEN leases.epoch ELSE leases.epoch + 1 END, -- new grant => new token
         expires_at = EXCLUDED.expires_at
       WHERE leases.expires_at < now() OR (leases.holder = $1 AND leases.epoch = $3)
       RETURNING epoch\`,
      [this.me, LEASE_S, renewEpoch ?? -1],
    );
    if (!rows.length) return null;
    this.validUntil = sentAt + (LEASE_S - 5) * 1000; // stop 5 s before others may take over
    return Number(rows[0].epoch);
  }
  private validUntil = 0;

  @Cron('*/5 * * * *')
  async run() {
    const epoch = await this.grant();
    if (epoch === null) return;
    let lastRenew = performance.now();
    const { rows } = await this.pg.query(
      'SELECT id, dirty_seq FROM wallet_snapshots WHERE dirty = true LIMIT 5000',
    );
    for (const r of rows) {
      if (performance.now() - lastRenew > 10_000) {
        if ((await this.grant(epoch)) !== epoch) return this.log.warn('lease lost, stopping');
        lastRenew = performance.now();
      }
      if (performance.now() >= this.validUntil) return this.log.warn('lease may have expired');
      const total = await this.computeBalance(r.id);
      // Fenced + version-checked write: rejects older epochs and keeps newer dirty marks
      await this.pg.query(
        \`UPDATE wallet_snapshots
            SET balance = $1, fence = $3,
                dirty = (dirty_seq <> $4)          -- stay dirty if a ledger write raced us
          WHERE id = $2 AND fence <= $3\`,
        [total, r.id, epoch, r.dirty_seq],
      );
    }
    // no DEL: the lease simply expires; a crash can never delete someone else's lease
  }

  private async computeBalance(id: string): Promise<number> {
    const { rows } = await this.pg.query(
      'SELECT COALESCE(SUM(amount_paise), 0) AS s FROM ledger WHERE wallet_id = $1',
      [id],
    );
    return Number(rows[0].s);
  }
}`,
      },
      explanation: `**Bugs in the starter**
- **Constant lock value + unconditional DEL:** after the 60 s TTL expires, pod B takes the lock, and pod A's finally block deletes *B's* lock, so a third pod can start too.
- **TTL shorter than the job, with no renewal:** every run longer than 60 s overlaps the next holder.
- **No fencing:** a pod that paused (GC, CPU throttling) keeps writing balances it computed from an older ledger view, overwriting fresher results.
- **Lost dirty marks:** a ledger insert that sets dirty = true between the SUM and the UPDATE is wiped by dirty = false, so that wallet stays stale forever. That is the "stale forever" symptom.

**Fixes**
- The lease lives in the **same Postgres** as the data. Each new grant increments **epoch**, which is the fencing token. Renewal keeps the same epoch only for the same holder.
- Every write is **fenced**: WHERE fence <= $epoch. Once a newer holder has written a row, an older holder's write to it is a no-op. Equal tokens are allowed so the current holder can write many rows.
- The holder checks a **monotonic** deadline (measured from when the grant was sent, minus a 5 s margin) before each unit of work, and renews every 10 s.
- **dirty_seq** is a version counter. The UPDATE only clears dirty if no ledger write happened since we read the row.
- No release/DEL: letting the lease expire is simpler and cannot delete another holder's lease. For faster handover, release conditionally (WHERE holder = me AND epoch = mine).

Fencing does not stop an old holder from writing a row the new holder has not touched yet. Here that is harmless, because the value is recomputed from the ledger and dirty_seq keeps the flag honest. For non-recomputable writes you would also check that the lease is still valid inside the same statement.`,
      followUps: [
        {
          "q": "The compaction job now needs to run across 10M dirty wallets in under 5 minutes, more than one pod can do. How do you parallelise it safely?",
          "a": "Shard the work rather than the lock. Split wallets into, say, 64 buckets by `hash(id) % 64`, with one lease row per bucket (`compaction:<n>`) carrying its own epoch. Each pod tries to acquire several bucket leases and processes only those wallets, fencing writes with that bucket's epoch. Pods that die lose their buckets after lease expiry and others pick them up. Alternatively, use `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 500` batches from the dirty set, so pods claim disjoint rows. dirty_seq still protects against races with ledger writes, and parallelism comes from disjoint ownership."
        },
        {
          "q": "How would you test that an ex-holder after a GC pause can't overwrite newer work?",
          "a": "Simulate the pause deterministically. In an integration test with real Postgres: pod A acquires epoch 5, reads a wallet's dirty_seq, then the test suspends A (await a controlled promise). Advance time past the lease (shorten LEASE_S to 1 s for tests); pod B acquires epoch 6, computes and writes the wallet. Resume A, which attempts its write with epoch 5. Assert rowCount 0 and the balance unchanged. Add a case where a ledger insert bumps dirty_seq between A's read and write, and assert dirty stays true. Run it in CI, because these races are invisible in normal load tests."
        }
      ],
    },
    {
      id: 'misc-distributed-cc-2',
      title: 'Turn an in-memory booking saga into a durable, correctly ordered one',
      context:
        'A cinema booking service orchestrates Seats, Payments, Tickets and Mail services from a NestJS provider. Incidents: users got "seats reserved" emails for bookings that later failed; after a deploy some bookings were charged but never got tickets; and one refund was issued twice.',
      task: 'Redesign the orchestrator so it survives pod restarts, orders steps correctly around the pivot, compensates correctly, and never double-charges or double-refunds when anything is retried.',
      starter: {
        language: 'typescript',
        title: 'booking.saga.ts (buggy)',
        code: `import { Injectable } from '@nestjs/common';

@Injectable()
export class BookingSaga {
  private running = new Map<string, string[]>(); // bookingId -> completed steps

  constructor(
    private readonly seats: SeatsClient,
    private readonly pay: PaymentsClient,
    private readonly tickets: TicketsClient,
    private readonly mail: MailClient,
  ) {}

  async start(b: Booking) {
    const done: string[] = [];
    this.running.set(b.id, done);
    try {
      await this.seats.reserve(b.showId, b.seatIds); done.push('seats');
      await this.mail.send(b.email, 'Your seats are reserved!'); done.push('mail');
      await this.pay.capture(b.userId, b.amountPaise); done.push('pay');
      await this.tickets.issue(b.id); done.push('tickets');
    } catch (e) {
      for (const step of done) { // compensate
        if (step === 'seats') await this.seats.release(b.showId, b.seatIds);
        if (step === 'pay') await this.pay.refund(b.userId, b.amountPaise);
      }
      throw e;
    } finally {
      this.running.delete(b.id);
    }
  }
}`,
      },
      hints: [
        'Which of these steps can be undone, which one is the point of no return, and which must simply be retried until they succeed?',
        'Where does the saga\'s progress live if the pod is killed between capture and issue?',
        'What does PaymentsClient see if capture is retried after a timeout, and how does it know it is the same capture?',
      ],
      solution: {
        language: 'typescript',
        title: 'booking.saga.ts (persisted state, pivot ordering, idempotent steps)',
        code: `import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

type State = 'STARTED' | 'SEATS_HELD' | 'PAID' | 'TICKETED' | 'DONE' | 'COMPENSATING' | 'CANCELLED';

@Injectable()
export class BookingSaga {
  private readonly log = new Logger(BookingSaga.name);
  constructor(private readonly pg: Pool, private readonly seats: SeatsClient,
    private readonly pay: PaymentsClient, private readonly tickets: TicketsClient,
    private readonly mail: MailClient) {}

  private async move(id: string, from: State, to: State): Promise<boolean> {
    const r = await this.pg.query( // CAS transition: a second worker cannot run the same step
      'UPDATE booking_sagas SET state = $3, updated_at = now() WHERE id = $1 AND state = $2',
      [id, from, to]);
    return r.rowCount === 1;
  }

  // Called on create AND by a sweeper for sagas not updated in 60 s (crash recovery)
  async advance(b: Booking): Promise<void> {
    const { rows } = await this.pg.query('SELECT state FROM booking_sagas WHERE id = $1', [b.id]);
    const key = (step: string) => b.id + ':' + step; // same key on every retry
    switch (rows[0].state as State) {
      case 'STARTED': // compensable
        try { await this.seats.reserve(b.showId, b.seatIds, key('seats')); }
        catch { await this.move(b.id, 'STARTED', 'COMPENSATING'); return this.advance(b); }
        if (await this.move(b.id, 'STARTED', 'SEATS_HELD')) return this.advance(b);
        return;
      case 'SEATS_HELD': { // pivot: definitive decline => compensate, unknown => retry later
        const res = await this.pay.capture(b.userId, b.amountPaise, key('pay')); // 'ok'|'declined'|throws
        const next: State = res === 'ok' ? 'PAID' : 'COMPENSATING';
        if (await this.move(b.id, 'SEATS_HELD', next)) return this.advance(b);
        return;
      }
      case 'PAID': // retriable from here on: never compensate, retry until success
        await this.tickets.issue(b.id, key('tickets'));
        if (await this.move(b.id, 'PAID', 'TICKETED')) return this.advance(b);
        return;
      case 'TICKETED':
        await this.mail.send(b.email, 'Your tickets', key('mail')); // provider dedupes on key
        await this.move(b.id, 'TICKETED', 'DONE');
        return;
      case 'COMPENSATING': // reverse order; only seats were held before the pivot
        await this.seats.release(b.showId, b.seatIds, key('seats-release'));
        await this.move(b.id, 'COMPENSATING', 'CANCELLED');
        return;
      default:
        return; // DONE / CANCELLED: nothing to do (idempotent re-entry)
    }
  }
}`,
      },
      explanation: `**Bugs in the starter**
- **State only in memory:** a pod killed after capture and before issue loses the saga. The customer is charged with no ticket and nothing ever resumes it.
- **Email before the pivot:** "seats reserved" is an effect you cannot undo, sent before payment succeeded.
- **Compensation in forward order and fragile:** it releases seats before refunding, a failing release aborts the loop so the refund never happens, and there is no retry or record.
- **Wrong reaction after the pivot:** a failure in tickets.issue refunds a successful payment instead of retrying a step that must eventually succeed.
- **No idempotency keys:** a retried capture or refund (client timeout, redelivery) can charge or refund twice. That is the double refund.
- **Ambiguous capture treated as failure:** a timeout is "unknown", not "declined".

**Fixes**
- Saga state in a **booking_sagas** table. Every transition is a **compare-and-set** (WHERE state = $from), so concurrent workers or the recovery sweeper cannot run the same step twice.
- Order: **reserve seats (compensable) → capture (pivot) → issue tickets → email (retriable)**. After PAID, the saga only moves forward.
- Every remote call carries a deterministic key **bookingId:step**, so retries are deduped downstream.
- An unknown capture outcome throws. The saga stays in SEATS_HELD, and the sweeper retries with the same key, which returns the original result.
- A sweeper re-drives sagas stuck longer than 60 s. With 4+ steps or long waits, a durable-execution engine (Temporal, Step Functions) gives you this persistence and retry for free.`,
      followUps: [
        {
          "q": "The payment provider is down for an hour. With this design, what happens to bookings in SEATS_HELD, and to the held seats?",
          "a": "Capture throws (unknown outcome), so sagas stay in SEATS_HELD and the sweeper retries with the same key every minute or so. Meanwhile those seats are held, blocking other customers for popular shows. Add a business deadline: if a saga stays in SEATS_HELD longer than the seat-hold limit (say 10 minutes), first query the provider by idempotency key to learn the real outcome when it's reachable. If you can't confirm, move to a 'PAYMENT_UNKNOWN' state that releases seats only after confirming the charge didn't happen, or keeps the hold and escalates. Show users 'payment pending' rather than a failure."
        },
        {
          "q": "Would you replace this with Temporal? Which parts of the code disappear and which remain your responsibility?",
          "a": "With Temporal, the state table, CAS transitions and sweeper disappear: the workflow function is ordinary sequential code (reserve, capture, issue, mail) and Temporal durably records each step's result and resumes after crashes. Retry policies with backoff are declarative per activity. Still your responsibility: idempotency keys on every activity (Temporal guarantees at-least-once activity execution), the pivot logic and compensations, distinguishing declined from unknown outcomes, timeouts per activity, and operational cost (running the Temporal cluster or paying for cloud). It's worth it once you have several sagas with multiple steps."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'misc-distributed-iq-01',
      difficulty: 'medium',
      question:
        'Rapid-fire: rank the consistency models you know from strongest to weakest, and for each one name a real datastore setting that gives it to you.',
      whatInterviewerLooksFor: [
        'Correct ordering, including the session guarantees in the middle',
        'Concrete settings rather than vague "strong vs eventual"',
        'Keeps isolation (serializable) separate from recency (linearizable)',
      ],
      modelAnswer: `**Strongest to weakest, with a setting for each:**

1. **Strict serializable** (serializable transactions + real-time order): Spanner, CockroachDB (serializable, with a small clock-uncertainty caveat).
2. **Linearizable** (single-object recency): etcd default reads, MongoDB readConcern "linearizable" with writeConcern "majority".
3. **Sequential**: ZooKeeper reads. Every client sees the same order, but a read may lag unless you call sync first.
4. **Causal**: MongoDB causally consistent sessions. A reply is never visible before the comment it answers.
5. **Session guarantees** (read-your-writes, monotonic reads, monotonic writes, writes-follow-reads): Cosmos DB "session" (its default), or routing a user to a replica whose LSN is at least their last write.
6. **Consistent prefix**: Cosmos DB "consistent prefix". Reads can be stale but never show writes out of order.
7. **Eventual**: Cassandra CL=ONE, DynamoDB default reads.

**One-liner to finish:** stronger models need coordination (a majority round-trip, a leader check or a commit wait), so the cost is latency and availability during partitions. I pick the weakest model each feature can tolerate, and I keep "serializable" (isolation) separate from "linearizable" (freshness).`,
      followUps: [
        { q: 'Where does "bounded staleness" fit?', a: 'Between linearizable and session. Reads lag by at most K versions or T seconds (Cosmos DB offers it). It is useful for dashboards that need a hard freshness SLA without paying for strong reads.' },
        { q: 'Is Postgres SERIALIZABLE with async replicas linearizable?', a: 'Not for reads served by replicas. Serializable describes how transactions interleave on the primary. A replica read can still return an old committed state.' },
      ],
      pitfalls: [
        'Listing only "strong, eventual" and nothing between them',
        'Calling serializable and linearizable the same thing',
        'Claiming Cassandra QUORUM is linearizable',
      ],
    },
    {
      id: 'misc-distributed-iq-02',
      difficulty: 'hard',
      question:
        'During an incident, on-call turned a kill-switch flag OFF to disable a broken payment path, then a teammate turned ON a dependent flag that is only safe once the kill-switch is off. Your flag service replicates to 3 regions asynchronously. For about 20 seconds, some pods saw the second change but not the first, and they re-enabled the broken path. Which guarantee was missing, and how would you fix it cheaply?',
      whatInterviewerLooksFor: [
        'Identifies an ordering (causal / consistent-prefix) violation, not a freshness one',
        'Prefers ordered snapshots over paying for linearizable reads everywhere',
        'Handles the client side too: pods must never apply an older version',
        'Gives numbers for propagation and a safe default',
      ],
      modelAnswer: `**Diagnosis:** this is not staleness. Being 20 s behind would have been fine if the updates arrived in order. The second write *causally depended* on the first (the teammate turned it on because the kill-switch was already off), and some replicas applied them in a different order. The missing guarantee is **causal consistency**, or at least **consistent prefix**. Each flag was replicated as an independent key, probably through per-key streams or parallel workers, so there was no order between keys.

**Cheap fix: replicate snapshots, not keys.**
- Every flag write goes to one primary, which assigns a **global monotonic version** (a single-partition log or a DB sequence).
- Regions and pods consume a **totally ordered log** (one Kafka partition is enough: flag changes are only tens per minute) and apply changes strictly in version order. A pod exposes "config version v", never a mix of versions.
- Pods ignore any snapshot older than the one they hold (monotonic reads). A pod that reconnects to a lagging region cannot go backwards.

**Make dependencies explicit:** give the dependent flag a guard. Evaluate "dependent ON" only if "kill-switch OFF" is true *in the same snapshot*. Even a correctly ordered system can be misused by humans, so the flag UI should refuse to enable the dependent flag while the prerequisite is still on.

**Latency budget:** single log → cross-region replication ≈ 100–250 ms, plus a pod poll or stream push ≈ 1–5 s. Kill-switches should use push (SSE/gRPC stream) with polling as a fallback.

**Why not linearizable reads?** Every flag evaluation (thousands per second per pod) would need a cross-region round trip. We only need order, not recency.`,
      followUps: [
        { q: 'Two admins in different regions edit flags at the same time. Now what?', a: 'Keep a single writer (primary region) for flag writes. They are rare and can afford 150 ms. Multi-writer would need conflict resolution, which is the wrong trade for safety switches.' },
        { q: 'What if the log is unavailable?', a: 'Pods keep serving the last full snapshot (fail static). Kill-switches default to the safe value if a pod has no snapshot at all at boot.' },
        { q: 'How do you verify ordering in production?', a: 'Each pod reports its config version as a metric. Alert if any pod is more than N versions or T seconds behind, or if the reported version ever decreases.' },
      ],
      pitfalls: [
        'Calling it "eventual consistency, just wait" — the order was wrong, not just late',
        'Proposing strongly consistent reads per flag evaluation',
        'Ignoring the pod side, where a reconnect to a lagging replica can move the version backwards',
      ],
    },
    {
      id: 'misc-distributed-iq-03',
      difficulty: 'medium',
      question:
        'Rapid-fire: in the first five minutes of a design round, how do you actually use CAP? Show me with a product where different operations make different choices.',
      whatInterviewerLooksFor: [
        'Uses CAP to set non-functional requirements per operation',
        'Knows partitions are not optional, so the real choice is C vs A during one',
        'Mentions PACELC for the no-partition case',
      ],
      modelAnswer: `**How I use it:** while writing non-functional requirements, I ask one question per operation: *"If replicas disagree, must this read see the latest write, or is a stale answer better than an error?"* The answer then drives the datastore, the replication mode and the error UX.

**Example: ticketing.**
- **Seat hold / purchase — consistency.** Two users must never get the same seat. During a partition, the side that cannot reach the seat's primary or quorum returns "try again". I'd use a single-leader or consensus-backed store, with a conditional write on the seat row.
- **Event page, artist bio, seat map (display only) — availability.** Serve from cache or replicas even if they are a minute stale, and show "availability may change".
- **Search — availability.** Elasticsearch fed by CDC, seconds behind.

**Then PACELC:** even without a partition, the consistent path pays for it. A synchronous or quorum write adds ~1–2 ms across AZs, ~100 ms+ across regions. So I keep the consistent path small (one row per seat) and let everything else be fast and eventually consistent.

CAP frames requirements; it is not a design by itself.`,
      followUps: [
        { q: 'Is a single-node Postgres "CA"?', a: 'It is not distributed, so CAP does not apply. Once clients reach it over a network, a partition between client and DB means that client simply sees it as unavailable.' },
        { q: 'What does the user see on the CP path during a partition?', a: 'A fast, explicit error with a safe retry ("seat could not be confirmed, you have not been charged"). Never a spinner that times out and leaves the outcome unknown.' },
      ],
      pitfalls: [
        'Labelling the whole system "AP" or "CP"',
        'Describing CAP as "pick any two of three"',
        'Skipping the latency cost of consistency when there is no partition',
      ],
    },
    {
      id: 'misc-distributed-iq-04',
      difficulty: 'expert',
      question:
        'Your lending app runs Postgres primary in Mumbai with a synchronous standby in Singapore and automated failover. Last night the inter-region link did not go down; it dropped ~40% of packets for 3 minutes. Failover triggered twice, back and forth, and some loan disbursements were recorded on both sides. Explain what happened in CAP terms and redesign it.',
      whatInterviewerLooksFor: [
        'Recognises a partial / gray partition and failure-detector flapping',
        'Explains how two primaries accepted writes (no quorum or fencing on promotion)',
        'Redesigns with a third-site witness/consensus and fencing of the old primary',
        'Addresses reconciliation of the duplicated disbursements',
      ],
      modelAnswer: `**What happened:** a *gray* partition. Heartbeats sometimes got through and sometimes did not. With only two sites, each side's failure detector decided on its own view. Singapore concluded "primary dead" and promoted itself, while Mumbai was still alive and serving local app pods. That is **split brain**. With 40% loss, the detectors flipped again and triggered a second failover. Two nodes accepted writes, so the system picked **availability on both sides** without meaning to. The duplicated disbursements are exactly the divergent writes CAP predicts.

A synchronous standby does not help here. Once the primary can't reach the standby, it either blocks (CP) or, with typical "fall back to async" tooling, keeps going (AP). And a promoted standby does not know the old primary is still alive.

**Redesign:**
1. **Quorum-based failover with a third site.** Run Patroni (or similar) with a 3-member etcd/consensus group across Mumbai, Singapore and a witness in a third region (e.g. Hyderabad). Promotion requires a majority, so only one side can hold the leader key.
2. **The old primary demotes itself** when it loses its leader lease (Patroni does this), so it stops accepting writes within the lease TTL.
3. **Fence at the application boundary:** disbursement writes carry the leader epoch, and the payout service rejects writes from an older epoch. Payouts to the bank use idempotency keys, so a duplicate request is rejected downstream.
4. **Dampen the detector:** require N consecutive failed checks over ~30 s and a minimum time between failovers. Flapping costs more than 30 s of unavailability.
5. **Choose explicitly:** for money movement, the minority side refuses writes (CP). The UI queues "disbursement pending" rather than acting.

**Cleanup:** diff both timelines from the fork point, reconcile against bank settlement files, and reverse or recover duplicates. That needs a ledger, not UPDATEs.`,
      followUps: [
        { q: 'Why not just add a second standby in Singapore?', a: 'Two nodes at one site plus one at the other means losing the two-node site takes the majority with it. The tie-breaker must be in an independent failure domain.' },
        { q: 'How long is the write outage with the new design?', a: 'Roughly lease TTL + detection: ~30–45 s for the minority side to demote and the majority to promote. For disbursements that is acceptable. Double payouts are not.' },
      ],
      pitfalls: [
        'Assuming partitions are binary (link up or down)',
        'Believing synchronous replication alone prevents split brain',
        'Proposing a shorter heartbeat timeout, which makes flapping worse',
      ],
    },
    {
      id: 'misc-distributed-iq-05',
      difficulty: 'medium',
      question:
        'Rapid-fire: you have five replicas. Pick R and W for a read-heavy product catalogue and for a write-heavy device-telemetry store, and tell me exactly how many node failures each tolerates for reads and for writes.',
      whatInterviewerLooksFor: [
        'Correct arithmetic for each configuration',
        'Links the choice to the workload and to whether overlap is required',
        'Notes that overlap ≠ linearizability',
      ],
      modelAnswer: `**Rule:** reads tolerate N − R failures, writes tolerate N − W, and R + W > N guarantees overlap.

**Catalogue (read-heavy, price changes must show up):**
- **W = 4, R = 2** → 6 > 5, overlap guaranteed. Reads need 2 nodes, so they survive 3 failures and are fast (the two fastest of five). Writes need 4, so they survive only 1 failure. Price edits are rare, so that is acceptable.
- Alternatively W = 3, R = 3 is balanced: 2 failures either way.

**Telemetry (write-heavy, a few lost or stale points are OK):**
- **W = 1 or 2, R = 1**, with no overlap. Writes survive 3–4 failures and have the lowest latency. Reads may be stale or miss the latest sample. Anti-entropy (read repair, Merkle-tree repair) converges replicas later. If dashboards need the latest point, raise R to 4 for those queries (1 + 4 > 5).

**Caveats I'd mention:**
- Overlap only helps if the reader picks the newest version correctly (versions or timestamps; LWW with clock skew can pick wrong).
- Sloppy quorum / hinted handoff breaks overlap during failures.
- Larger quorums wait for slower replicas.`,
      followUps: [
        { q: 'Why not W = 5 for the catalogue for maximum safety?', a: 'Any single node down blocks all price edits, and every write pays the slowest replica\'s latency. W = 4 already guarantees overlap with R = 2.' },
        { q: 'Does R = 2 read both values or one?', a: 'It asks two replicas (often one full read plus a digest read) and returns the newest version. On a mismatch it can repair the stale replica.' },
      ],
      pitfalls: [
        'Computing tolerance as N − R − W or similar wrong formulas',
        'Claiming R + W > N makes reads linearizable',
        'Ignoring that a larger quorum waits for a slower node',
      ],
    },
    {
      id: 'misc-distributed-iq-06',
      difficulty: 'hard',
      question:
        'Your Cassandra cluster spans Mumbai, Singapore and Frankfurt with RF=3 in each DC. The service uses consistency level QUORUM for everything, and p99 write latency is ~180 ms even though every client is in Mumbai. Explain the number, and what you gain and lose by switching to LOCAL_QUORUM or EACH_QUORUM.',
      whatInterviewerLooksFor: [
        'Computes QUORUM over all replicas: 5 of 9',
        'Maps latency to the inter-region RTTs involved',
        'Explains the consistency implications of LOCAL_QUORUM for cross-DC readers',
        'Considers what happens when a DC is lost',
      ],
      modelAnswer: `**The arithmetic:** QUORUM counts replicas across *all* DCs: 3 DCs × RF 3 = 9 replicas, so floor(9/2) + 1 = **5 acks**. Mumbai can give only 3, so every write also needs 2 acks from another DC. Mumbai→Singapore RTT is ~55–65 ms, so the median is ~65 ms. At p99, the coordinator often waits for a slow Singapore replica or for Frankfurt (~110–130 ms RTT), plus GC and queueing, which gets you to ~180 ms.

**LOCAL_QUORUM (2 of the 3 Mumbai replicas):**
- Writes and reads drop to ~2–5 ms p50 and stay available if Singapore and Frankfurt are both unreachable.
- **Loss:** a reader in Singapore doing LOCAL_QUORUM does not overlap a Mumbai LOCAL_QUORUM write, so it can read stale data until async cross-DC replication catches up (normally sub-second, much longer during a partition). Read-your-writes only holds if the user stays pinned to one DC.
- If Mumbai is lost, acknowledged writes not yet shipped abroad can be lost (a small window).

**EACH_QUORUM (2 of 3 in every DC) for writes:**
- The strongest cross-DC guarantee: a LOCAL_QUORUM read in any DC overlaps it. Latency is the slowest DC (~120–200 ms), and a write fails if *any* DC is down. Usually only worth it for rare, critical writes.

**What I'd do:** home each user or tenant to one DC and use LOCAL_QUORUM for their data. Use EACH_QUORUM or a consensus-backed store (LWT/Paxos, or a separate linearizable service) only for the few invariants that must hold globally. Also note that Cassandra LWTs cost ~4 round trips, so keep them off hot paths.`,
      followUps: [
        { q: 'Could we get cheap global reads with EACH_QUORUM writes?', a: 'Yes: EACH_QUORUM writes plus LOCAL_QUORUM reads overlap in every DC. You pay on the write, which works if reads dominate and writes are rare.' },
        { q: 'What about LOCAL_ONE for reads?', a: 'It is fast but can be stale even within the DC, because it does not overlap a LOCAL_QUORUM write. Fine for caches of non-critical data.' },
      ],
      pitfalls: [
        'Thinking QUORUM means "quorum within my DC"',
        'Switching to LOCAL_QUORUM without discussing cross-DC read staleness',
        'Ignoring that EACH_QUORUM reduces availability to the weakest DC',
      ],
    },
    {
      id: 'misc-distributed-iq-07',
      difficulty: 'medium',
      question:
        'Rapid-fire: explain what leaseDuration, renewDeadline and retryPeriod mean in Kubernetes client-go leader election, and what goes wrong if renewDeadline is set equal to leaseDuration.',
      whatInterviewerLooksFor: [
        'Correct semantics of each knob and the defaults (15 s / 10 s / 2 s)',
        'Understands renewDeadline < leaseDuration is the safety margin',
        'Knows client-go does not fence',
      ],
      modelAnswer: `**The knobs (kube-controller-manager defaults):**
- **leaseDuration = 15 s:** how long non-leaders wait after the last observed renewal before trying to take the Lease. It also caps how long a crashed leader blocks failover.
- **renewDeadline = 10 s:** how long the current leader keeps retrying renewal before giving up leadership and stopping its work (OnStoppedLeading, usually a process exit).
- **retryPeriod = 2 s:** the interval between acquire and renew attempts.

**Why renewDeadline < leaseDuration:** the gap (5 s by default) is the safety margin. The leader stops acting *before* others are allowed to take over, which absorbs slow API-server calls, clock-rate differences and scheduling delay. If renewDeadline equals leaseDuration, the old leader can still be working at the moment a new one acquires, so you get a window with two active leaders. Making renewDeadline greater than leaseDuration makes that window guaranteed.

**What client-go does not promise:** its docs say it does not guarantee a single active leader, because there is no fencing. A leader that pauses for 20 s (GC, CPU throttling) resumes believing it still leads. Anything that must be correct needs a fencing check at the resource, such as the Lease's resourceVersion or an epoch column.`,
      followUps: [
        { q: 'How fast is failover if the leader pod is SIGKILLed?', a: 'Up to leaseDuration + retryPeriod ≈ 17 s. With a graceful shutdown and ReleaseOnCancel, the Lease is released and a candidate takes it within ~2 s.' },
        { q: 'Why do API-server slowdowns cause mass leader loss?', a: 'Every controller\'s renewals time out together. If they exceed renewDeadline, all leaders step down at once and restart, a thundering herd of re-elections.' },
      ],
      pitfalls: [
        'Swapping the meaning of leaseDuration and renewDeadline',
        'Claiming the Lease object guarantees exactly one leader',
        'Tuning all three to 1–2 s "for faster failover" without considering API-server load',
      ],
    },
    {
      id: 'misc-distributed-iq-08',
      difficulty: 'expert',
      question:
        'You run a per-tenant event sequencer: 256 shards, 12 pods, and each shard must have exactly one active owner that assigns sequence numbers. A single global leader handing out shards is proposed. Design shard ownership instead, including rolling deploys and pod pauses.',
      whatInterviewerLooksFor: [
        'Per-shard leases vs one global leader: blast radius and handover time',
        'Balanced assignment and graceful handoff during deploys',
        'Fencing of sequence assignment so an old owner cannot issue duplicates',
        'Numbers: lease counts, renewal load, handover latency',
      ],
      modelAnswer: `**Why not one global leader:** it becomes a single hot spot and a single point of failover. When it moves, every shard's assignment is in doubt for ~15 s. Per-shard ownership limits a failure to the shards of one pod.

**Design:**
- **Per-shard lease** in etcd: key /seq/shards/{n} attached to the pod's single etcd lease (TTL 10 s). One keepalive per pod renews all its shards, so the load is 12 keepalives every ~3 s, not 256.
- **Assignment:** each pod targets ceil(256/12) ≈ 22 shards. It acquires free shards with a transaction (create only if the key does not exist) until it reaches its target. Overloaded pods release shards voluntarily. A rendezvous-hash preference keeps the assignment stable across restarts.
- **Fencing the sequencer:** the owner's etcd create revision for the shard key is its **epoch**. Sequence numbers are persisted as (shard, epoch, seq), and the store accepts a batch only WHERE stored_epoch <= epoch. On takeover, the new owner reads the last persisted seq and continues from there. A paused ex-owner's writes carry an old epoch and are rejected, so no duplicate numbers are issued.
- **Batching:** reserve sequence numbers in blocks (e.g. 1,000) with one fenced write, so storage writes are ~1/1000 of assignments.

**Rolling deploy:** on SIGTERM, a pod stops accepting new work for its shards, flushes its last block, deletes its shard keys (graceful release) and then exits. Peers pick the shards up in ~100–500 ms rather than waiting 10 s for the TTL. Use maxUnavailable 1 so at most ~22 shards move at a time.

**Pod pause (GC, CPU throttling):** its etcd lease expires after 10 s and the shards move. When it wakes, its local validity timer (measured from when keepalives were sent) has expired, so it stops. Any write it still attempts fails the epoch check.

**Numbers:** worst-case handover for a crashed pod ≈ TTL 10 s + acquire ~50 ms. It only affects ~9% of shards.`,
      followUps: [
        { q: 'Why not Kafka consumer-group partition assignment instead?', a: 'It is a good fit if the sequencer consumes from Kafka. Group generation plus transactional producers give you fencing, and the cooperative-sticky assignor limits churn. Build it yourself only when the work is not Kafka-driven.' },
        { q: 'How do you avoid all shards moving when pod 13 is added?', a: 'Target-count balancing with slow voluntary release (a few shards per minute), or rendezvous hashing where only ~1/13 of shards change preference.' },
      ],
      pitfalls: [
        'A per-shard keepalive, producing 256 renewals every few seconds for no benefit',
        'No fencing, so an old owner re-issues sequence numbers after a pause',
        'Relying on TTL expiry during deploys, causing 10 s stalls on every restart',
      ],
    },
    {
      id: 'misc-distributed-iq-09',
      difficulty: 'medium',
      question:
        'Rapid-fire: why do most new systems choose Raft over Paxos, and is there anything Raft cannot do that a Paxos variant can?',
      whatInterviewerLooksFor: [
        'Knows Multi-Paxos and Raft are equivalent in fault tolerance',
        'Names Raft\'s concrete design choices (strong leader, log matching, election restriction)',
        'Mentions Paxos-family flexibility (leaderless EPaxos, flexible quorums)',
      ],
      modelAnswer: `**Same guarantees, different packaging.** Multi-Paxos with a stable leader and Raft both tolerate f failures with 2f + 1 nodes and have the same steady-state cost: one round trip to a majority per commit.

**Why Raft wins adoption:**
- **Specified end to end:** leader election, log replication, membership changes, snapshots and client interaction are all in the paper and thesis. Classic Paxos specifies single-value agreement, and every Multi-Paxos implementation filled the gaps differently.
- **Strong leader + log matching:** entries only flow leader → followers, and logs never have holes. That makes reasoning and debugging simpler.
- **Election restriction:** only a candidate with an up-to-date log can win, so a new leader never needs to fetch missing committed entries.
- **Ecosystem:** mature libraries (etcd/raft, hashicorp/raft) used by etcd, Consul, CockroachDB, TiKV and Kafka KRaft.

**What the Paxos family does that plain Raft does not:**
- **Leaderless or multi-leader variants** (EPaxos) commit non-conflicting commands from any replica in one round trip, which helps geo-distributed writes.
- **Flexible quorums** (FPaxos): shrink the replication quorum if election quorums are larger.

For most teams the right answer is neither: use etcd or a Raft-based database rather than writing consensus yourself.`,
      followUps: [
        { q: 'Is ZooKeeper Raft?', a: 'No. It uses ZAB, a primary-backup atomic broadcast protocol in the same family. The guarantees are similar, but ZAB is not Raft.' },
        { q: 'Does Raft handle Byzantine nodes?', a: 'No. Raft assumes crash-stop failures and honest nodes. Byzantine tolerance needs 3f + 1 nodes and protocols like PBFT or HotStuff.' },
      ],
      pitfalls: [
        'Claiming Raft is faster or more fault tolerant than Multi-Paxos',
        'Saying Paxos "has no leader" as a blanket statement',
        'Suggesting writing your own Raft for an application feature',
      ],
    },
    {
      id: 'misc-distributed-iq-10',
      difficulty: 'expert',
      question:
        'You need to move a 3-node etcd cluster to 5 nodes spread over a new AZ, then retire one old node, with no downtime for Kubernetes. Walk me through the exact sequence and what can go wrong at each step.',
      whatInterviewerLooksFor: [
        'Adds members as learners, then promotes them, one voting change at a time',
        'Reasons about quorum size at every intermediate step',
        'Handles removing the leader and disruptive rejoin (PreVote)',
        'Mentions snapshots/defrag, backups and health checks',
      ],
      modelAnswer: `**Principle:** one voting change at a time, and never let the cluster sit in a state where a single failure loses quorum while it is catching up.

**Sequence:**
0. **Snapshot backup** (etcdctl snapshot save) and check that every member is healthy, with DB size well under quota (default 2 GB).
1. **Add node D as a learner** (member add --learner, etcd 3.4+). Learners receive the log but do not vote, so the quorum stays 2 of 3. D catches up via a snapshot and then the log. With a ~1 GB keyspace on a 1 Gbps link, that takes ~10–30 s.
2. **Promote D** once it is in sync. The cluster is now 4 voters with a quorum of 3. It still tolerates only 1 failure, but because D is caught up this state is brief and safe.
3. **Add E as a learner, then promote it** → 5 voters, quorum 3, tolerates 2 failures.
4. **Retire old node C:** if C is the leader, transfer leadership first (move-leader) to avoid an election. Then member remove C → 4 voters, quorum 3. Stop C only *after* the removal is committed.
5. Update client endpoint lists and the API server's --etcd-servers.

**What can go wrong:**
- **Adding a voter directly (no learner):** a 3 → 4 cluster needs 3 votes, and the new node cannot contribute until it catches up. One more failure then stalls writes.
- **Two changes at once:** overlapping configs can yield two disjoint majorities. That is why Raft uses single-server changes or joint consensus.
- **A removed node that is not stopped:** it times out, bumps its term and disrupts the leader with RequestVotes. PreVote and CheckQuorum (enable them) stop this.
- **Cross-AZ latency:** if the new AZ is slower, commit latency follows the fastest majority, so put 3 of 5 members in low-latency AZs.
- **Large snapshot transfers** can saturate the leader's disk or network. Watch apply duration and heartbeat delays during steps 1 and 3.`,
      followUps: [
        { q: 'Why not go straight from 3 to 5 with two adds?', a: 'Each add is a separate config change. Adding two voters back to back without learners means an intermediate 4-node config with an unsynced voter. Do it one at a time as learners.' },
        { q: 'How would you do this for a Raft-based database with thousands of ranges?', a: 'The database rebalances replicas per range automatically (CockroachDB and TiKV use learner-style snapshots too). You add nodes and let the rebalancer move ranges gradually, with throttled snapshot bandwidth.' },
      ],
      pitfalls: [
        'Adding a voting member that has not caught up',
        'Stopping a member before removing it from the configuration',
        'Forgetting the leader might be the node being removed',
      ],
    },
    {
      id: 'misc-distributed-iq-11',
      difficulty: 'medium',
      question:
        'Rapid-fire: a teammate wants a Redis distributed lock around "create subscription for user". What do you ask first, and what would you try before a lock?',
      whatInterviewerLooksFor: [
        'Distinguishes efficiency locks from correctness locks',
        'Reaches for database constraints and conditional writes first',
        'Knows what a lock does not protect (the effect after a pause)',
      ],
      modelAnswer: `**First question:** *what happens if two holders overlap?* If it is just wasted work (an efficiency lock), a single Redis SET NX PX with an owner token is fine. If it is a duplicate subscription and a double charge (a correctness lock), a Redis lock alone is not enough. A GC pause or Redis failover *will* eventually let two requests through.

**What I'd try first, since the invariant lives in the database:**
- **Unique constraint:** UNIQUE (user_id) WHERE status IN ('ACTIVE','PENDING'), a partial index in Postgres. The second INSERT fails with 23505 and we return the existing subscription.
- **Idempotency key** on the API, so client retries replay the stored response instead of re-running the flow.
- **Conditional update** for state transitions: UPDATE ... SET status = 'ACTIVE' WHERE id = $1 AND status = 'PENDING'.
- **Serialise per key:** route "subscription commands" for a user to one Kafka partition so one consumer handles them in order.

**If a lock is still needed** (e.g. it guards an external API with no idempotency): owner-checked release via Lua, TTL much longer than p99 of the critical section, and a fencing token or idempotency key checked by whatever performs the effect.`,
      followUps: [
        { q: 'When is a lock genuinely the best tool?', a: 'When the protected thing is expensive to duplicate and not a database row, e.g. one pod regenerating a 2 GB report or warming a cache key, and an occasional duplicate is acceptable.' },
        { q: 'What about SELECT ... FOR UPDATE on the user row?', a: 'That works if the whole check-and-insert happens in one DB transaction, with no slow external calls inside it that hold the row lock.' },
      ],
      pitfalls: [
        'Reaching for Redlock as the default answer',
        'Not asking whether a double execution is merely wasteful or actually incorrect',
        'Holding a lock around a slow third-party call with a short TTL',
      ],
    },
    {
      id: 'misc-distributed-iq-12',
      difficulty: 'hard',
      question:
        'An ML platform schedules GPU training jobs that run 2–12 hours. Exactly one worker should own a job at a time. Workers can hit 60–90 s pauses (checkpoint flushes, node drains), and a crashed worker\'s job must be picked up within ~5 minutes. Design the ownership mechanism.',
      whatInterviewerLooksFor: [
        'Rejects a single long TTL and uses renewable leases instead',
        'Chooses TTL from pause and recovery requirements with explicit numbers',
        'Fences the effects (checkpoint writes, result publication)',
        'Handles graceful drain and resuming from checkpoints',
      ],
      modelAnswer: `**Why not a 12-hour lock:** a crashed worker would block its job for up to 12 h. A short TTL with no renewal expires mid-job. The answer is a **renewable lease** plus **fencing on every durable effect**.

**Lease store:** the jobs table in Postgres (or etcd). Per job: owner, epoch, lease_expires_at. Workers claim with UPDATE jobs SET owner = $me, epoch = epoch + 1, lease_expires_at = now() + interval '3 minutes' WHERE id = $1 AND (owner IS NULL OR lease_expires_at < now()) RETURNING epoch.

**Choosing TTL = 3 minutes:**
- It must exceed the longest expected pause (90 s) plus a renewal interval (30 s) plus margin. So 3 min tolerates a 90 s pause without losing ownership.
- Recovery: a crash is detected after at most TTL (3 min), plus a scheduler scan every 30 s, then resume. That is ~3.5 min, within the 5-minute goal.
- A heartbeat every 30 s from 5,000 concurrent jobs is ~170 writes/s. Postgres handles that easily.

**Fencing:** the epoch is the fencing token.
- Checkpoints are written to s3://ckpt/{job}/{epoch}/step-{n}. The "latest checkpoint" pointer is updated with a conditional write (UPDATE job_ckpt SET path = $p WHERE job = $j AND epoch <= $e).
- Final model publication and billing events carry the epoch and are rejected if it is stale.
- A worker whose local monotonic deadline has passed stops launching new steps. If it was only paused, its next checkpoint pointer update fails, and it kills its own training process.

**Graceful drain:** on a node drain (SIGTERM, ~10 min grace), the worker checkpoints, releases the lease (owner = NULL, keep the epoch) and exits. Another worker claims it within ~30 s and resumes from the checkpoint. Lost work ≤ one checkpoint interval (e.g. 10–15 min of GPU time).

**Why not Redis:** hours-long ownership needs durability across Redis failover. An acknowledged lease lost in an async failover would create a second owner.`,
      followUps: [
        { q: 'What if the pause is 10 minutes (a stuck NFS mount)?', a: 'Ownership moves after 3 min. The old worker wakes up, fails its epoch check on the next pointer update and exits. Duplicated GPU time is wasted, but the results stay correct.' },
        { q: 'Could you use Kubernetes Jobs instead?', a: 'Kubernetes restarts pods, but during a node partition it can run two pods (the old one still running on the unreachable node). You still need epoch fencing on outputs.' },
      ],
      pitfalls: [
        'Picking a TTL without relating it to pause length and recovery SLO',
        'Relying on the lease without fencing the checkpoint and publish writes',
        'Forgetting the graceful-drain path and paying a full TTL on every drain',
      ],
    },
    {
      id: 'misc-distributed-iq-13',
      difficulty: 'medium',
      question:
        'Rapid-fire: concretely, where does a fencing token come from if your lock service is etcd, ZooKeeper, or just Postgres? And who checks it?',
      whatInterviewerLooksFor: [
        'Names real monotonic values in each system',
        'States that the resource must check it atomically',
        'Knows Redis INCR on async replication is not safe as a token source',
      ],
      modelAnswer: `**The requirement:** a value that increases with every grant, never goes backwards, even across lock-service failover, and is returned together with the grant.

- **etcd:** every write gets a cluster-wide **revision** (a Raft-ordered int64). The lock key's create revision (which etcd's concurrency lock uses internally) is a perfect token. A later acquisition always has a higher revision.
- **ZooKeeper:** the **zxid** of the transaction that created your lock znode, or the sequence suffix of the ephemeral sequential node (lock-0000000042). Both are ordered by ZAB.
- **Postgres:** an epoch column bumped in the same UPDATE that grants the lease (SET owner = $me, epoch = epoch + 1 ... RETURNING epoch), or a sequence value taken in that transaction. It is durable with the grant.
- **Not safe:** Redis INCR on a primary with async replicas. A failover can lose acknowledged increments, so two holders can get the same number.

**Who checks:** the **protected resource**, in the same atomic operation as the write. For example, UPDATE doc SET body = $b, fence = $t WHERE id = $id AND fence <= $t, or a storage API conditional header. If the client checks its own token before writing, nothing is fenced.`,
      followUps: [
        { q: 'Why fence <= t and not fence < t?', a: 'The current holder usually does several writes with the same token. Strictly-less would reject its second write. Only strictly older tokens must be refused.' },
        { q: 'Can a timestamp be a fencing token?', a: 'Only if it is issued by a single linearizable source and is monotonic (HLC or TrueTime-style). Wall-clock time from the client is not, because clocks jump and skew.' },
      ],
      pitfalls: [
        'Saying the client checks the token before it writes',
        'Using a UUID lock value as a "token" (it is not ordered)',
        'Using Redis INCR without discussing failover',
      ],
    },
    {
      id: 'misc-distributed-iq-14',
      difficulty: 'expert',
      question:
        'Fencing tokens assume the resource can check them. Your lock protects writes to an S3 object and calls to a third-party KYC provider, and neither knows anything about your tokens. How do you still stop a paused ex-holder from causing damage?',
      whatInterviewerLooksFor: [
        'Moves the token check to something that can enforce it (conditional writes, a proxy, a DB row)',
        'Knows S3/GCS conditional-write capabilities',
        'Uses idempotency keys and deduplication for external APIs',
        'Accepts residual risk explicitly where no enforcement point exists',
      ],
      modelAnswer: `**Principle:** if the resource cannot check the token, find the nearest thing that *can* perform a compare-and-set, and make the effect go through it.

**S3 object:**
- **Conditional writes:** S3 supports If-None-Match (create only if absent, since Aug 2024) and If-Match on an ETag (overwrite only if unchanged, since late 2024). GCS has ifGenerationMatch. Read the current ETag and your token's view, and write with If-Match. A stale holder's ETag no longer matches, so the write fails with 412. This is optimistic concurrency, which is itself a form of fencing.
- **Epoch in the key:** write to reports/{id}/epoch-{token}.json, then move a pointer (a DB row) with a fenced conditional UPDATE. Old epochs produce orphan objects that lifecycle rules delete. The pointer is what readers trust.

**Third-party KYC API:**
- **Idempotency key derived from the business operation**, not the lock (kyc:{userId}:{docVersion}). If the provider supports keys, a duplicate call is deduped at their end.
- **Record intent before calling:** INSERT kyc_requests (user, doc_version, epoch) with a unique key, fenced on epoch. The paused ex-holder's insert fails, so it never makes the call.
- **Callbacks** from the provider are applied with a fenced or conditional update keyed on request id.

**Residual risk:** if the provider has no idempotency and there is no enforcement point, a pause between "check" and "call" can still cause a duplicate call. Keep that window tiny (check immediately before the call, with a short client timeout), and design reconciliation that detects and voids duplicates. Say this out loud: it is the honest answer.`,
      followUps: [
        { q: 'Does a shorter TTL fix it instead?', a: 'No. A pause can be longer than any TTL. A shorter TTL just makes lease loss more frequent.' },
        { q: 'Why not wrap S3 behind a small service that checks tokens?', a: 'That is valid. The service becomes the resource that enforces fencing (a token column per object). It adds a hop and a component to run, which is worth it when many writers share objects.' },
      ],
      pitfalls: [
        'Claiming fencing is impossible here and giving up',
        'Using a longer lock TTL as the fix',
        'Not mentioning idempotency keys for the third-party call',
      ],
    },
    {
      id: 'misc-distributed-iq-15',
      difficulty: 'medium',
      question:
        'Rapid-fire: your public API accepts an Idempotency-Key header. What exactly do you return when (a) the same key arrives while the first request is still running, (b) the same key arrives with a different body, and (c) the key arrives after your retention window?',
      whatInterviewerLooksFor: [
        'Knows the IETF draft semantics (409 in-flight, 422 mismatch)',
        'Stores a request fingerprint to detect mismatches',
        'Understands expiry means the request is treated as new, so retention must exceed retry windows',
      ],
      modelAnswer: `**Storage:** key (scoped per tenant) → request fingerprint (hash of method + path + canonical body), status (IN_PROGRESS / COMPLETED), and the stored response. The IN_PROGRESS row is inserted under a unique constraint *before* doing the work.

**(a) Same key, first request still running:** return **409 Conflict** ("request with this key is in progress"), per the IETF Idempotency-Key draft. Do not start a second execution and do not block indefinitely. The client retries after a short delay. Optionally hold the connection for a few seconds waiting for completion to smooth UX.

**(b) Same key, different body (fingerprint mismatch):** return **422 Unprocessable Content**. That is a client bug. Silently replaying the first response would hide it, and executing it would break the key's meaning.

**(c) Key older than retention:** the record is gone, so the request executes as new. That is why retention must exceed the longest realistic retry window (mobile offline queues, batch retries). Stripe keeps keys at least 24 hours. For payouts I'd keep 7 days, or keep business-level uniqueness (unique payout per invoice) as a second line of defence.

**Also:** a completed request replays the *same* status and body, including 4xx results.`,
      followUps: [
        { q: 'What if the pod crashes while the row is IN_PROGRESS?', a: 'Give IN_PROGRESS a lease (locked_until). After it expires, a retry may take over, but only if the side effect is itself idempotent downstream (e.g. the PSP call reuses the same key).' },
        { q: 'Where do you check the key — gateway or service?', a: 'In the service, in the same database as the effect, so the key record and the business write commit together. A gateway cache alone cannot make that atomic.' },
      ],
      pitfalls: [
        'Returning the first response for a different body',
        'Running the duplicate in parallel because the first has not finished',
        'Keys scoped globally rather than per tenant',
      ],
    },
    {
      id: 'misc-distributed-iq-16',
      difficulty: 'hard',
      question:
        'Product says: "Merchants must receive every webhook exactly once." You own the webhook delivery platform (~30M events/day to ~200K merchant endpoints). What do you commit to, and how do you build it?',
      whatInterviewerLooksFor: [
        'Explains why exactly-once delivery over HTTP is impossible, and reframes as at-least-once + dedupe',
        'Designs the durable outbox → dispatcher → retry pipeline',
        'Provides stable event ids, ordering hints and signatures for receivers',
        'Handles slow or broken endpoints without harming others',
      ],
      modelAnswer: `**What I commit to:** at-least-once delivery with a **stable event id** and an ordering hint, so receivers can make processing exactly-once. Delivery exactly once over HTTP is impossible. If the merchant processed the event and our connection dropped before the 200 arrived, we cannot tell that apart from "never received", so we must resend.

**Pipeline:**
1. **Transactional outbox:** the business write and the webhook_events row commit together, so no event is lost and none is created for rolled-back work.
2. **Relay → Kafka**, partitioned by merchant_id (per-merchant ordering, isolation). 30M/day ≈ 350/s average, ~2K/s at peak, which is a small cluster.
3. **Dispatchers** POST with headers: event id (unique, stable across retries), created_at, a per-object sequence/version, and an HMAC signature with a timestamp (replay protection within ~5 min).
4. **Retries** with exponential backoff and jitter for up to ~3 days (Stripe's live-mode window), then mark failed. The merchant can replay from a dashboard or an "events since cursor" API.
5. **Isolation:** per-endpoint concurrency limits and circuit breakers. Failing endpoints move to a slow retry lane so one merchant's 30 s timeouts don't consume shared workers. Use a short timeout (e.g. 10 s).

**Receiver contract (documented):**
- Dedupe on event id (a unique constraint), return 2xx quickly and process asynchronously.
- Don't rely on arrival order. Use the object version, or fetch the latest object state from our API.

**Measure:** delivery latency p99, retry rate per endpoint, duplicate rate (retries after timeouts), and dead-letter volume.`,
      followUps: [
        { q: 'Why not guarantee order per merchant?', a: 'Strict ordering means one failing event blocks all later ones (head-of-line blocking) for up to days. Per-object versions give receivers what they need without that.' },
        { q: 'A merchant says they got duplicates. Is that a bug?', a: 'Not if they share an event id. That is the contract. Show them the retry log (a timeout at 10 s), and point to event-id dedupe.' },
      ],
      pitfalls: [
        'Promising exactly-once delivery',
        'Generating a new id per delivery attempt',
        'One shared retry queue where a dead endpoint stalls everyone',
      ],
    },
    {
      id: 'misc-distributed-iq-17',
      difficulty: 'medium',
      question:
        'Rapid-fire: in a travel booking saga (flight, hotel, card charge, confirmation email, loyalty points), which step is the pivot, and how does that decide the order of all the others?',
      whatInterviewerLooksFor: [
        'Defines compensable, pivot and retriable transactions',
        'Puts irreversible or risky steps in the right place',
        'Reasons about which step is most likely to fail',
      ],
      modelAnswer: `**Three kinds of steps (Richardson):**
- **Compensable:** can be undone by a later transaction (hold a flight seat, hold a hotel room, authorise a card).
- **Pivot:** the go/no-go point. If it succeeds, the saga *must* complete. If it fails, everything before it is compensated.
- **Retriable:** after the pivot. It must eventually succeed, so it is idempotent and retried (email, loyalty points, calendar invite).

**Ordering for this saga:**
1. **Hold flight** (compensable: release hold). The most likely to fail, since fares and seats change fast, so it goes first to fail cheaply.
2. **Hold hotel room** (compensable: cancel hold).
3. **Card: authorise, then capture = pivot.** Once money is captured and holds exist, we confirm and only move forward. If capture is declined, release both holds.
4. **Ticket flight / confirm hotel** (retriable against the held inventory; the holds guarantee availability).
5. **Confirmation email + loyalty points** (retriable, idempotent, keyed by bookingId).

**Why:** the email and points cannot be meaningfully undone ("sorry, ignore that email"), so they go after the pivot. Riskiest steps go first.

If ticketing after the pivot fails permanently (airline rejects), that is a business exception: a refund workflow with human review, not an automatic saga rollback.`,
      followUps: [
        { q: 'Why authorise before capture?', a: 'An authorisation is compensable (void, usually free). A capture needs a refund, which has fees and delay. Authorising early and capturing at the pivot keeps money movement reversible for as long as possible.' },
        { q: 'What if the flight hold expires before capture?', a: 'Holds have TTLs. The saga must finish faster than the shortest TTL, or re-validate the hold right before the pivot and compensate if it is gone.' },
      ],
      pitfalls: [
        'Sending the confirmation email early',
        'Treating post-pivot failures as rollbacks',
        'Not using authorise/capture to delay the irreversible part',
      ],
    },
    {
      id: 'misc-distributed-iq-18',
      difficulty: 'expert',
      question:
        'Two sagas interleave: an order-cancellation saga refunds a purchase and then claws back the loyalty points it earned, while the customer concurrently spends those same points on another order. Balances go negative. Explain the anomaly and fix it without introducing distributed locks.',
      whatInterviewerLooksFor: [
        'Names the lack of isolation in sagas (a lost update / dirty read of an uncommitted outcome)',
        'Uses Richardson\'s countermeasures: semantic locks, commutative updates, pessimistic view, reread',
        'Makes a business decision on negative balances',
        'Keeps steps idempotent',
      ],
      modelAnswer: `**The anomaly:** sagas have ACD, but not I. The points credited by the original purchase were visible and spendable, but the cancellation saga treats them as "still reversible". The spend saga read a balance that included points whose earning was about to be compensated, which is effectively a *dirty read* of a not-yet-final outcome. Then the claw-back subtracts from a balance that is already spent, so it goes negative.

**Countermeasures (no distributed locks):**
1. **Semantic lock / pending state:** points from an order start as PENDING, not spendable, until the return window closes (e.g. 7 days). They become AVAILABLE by a scheduled transition. The cancellation saga then only has to delete PENDING points, which is always possible.
2. **Commutative updates as a ledger:** model points as a ledger of +earn and −spend entries, not a mutable balance. Compensation is a new −clawback entry. Order no longer matters for correctness, and the balance is a sum.
3. **Reread before acting / pessimistic view:** the claw-back step rereads the available balance. If it is insufficient, it runs a business rule (claw back what exists, and deduct the remainder from the refund amount or record a debt), instead of blindly going negative.
4. **Reorder the cancellation saga:** claw back points *first* (compensable, and it tells you the shortfall), then refund the card with the adjusted amount (the pivot).

**The business decision:** "can a points balance go negative?" is a product question. Many programs allow a negative balance that future earnings pay off. Make it explicit rather than an accident.

**Implementation details:** each ledger entry is keyed by (sagaId, step) with a unique constraint, so retries are idempotent. Balance checks use a conditional insert (INSERT ... SELECT ... WHERE available >= $n) within the points service's own DB.`,
      followUps: [
        { q: 'Would 2PC between Orders and Loyalty solve it?', a: 'It provides isolation for one atomic step, but the problem spans days (return window). You would hold locks for days, which is not viable. Semantic states solve it at the business level.' },
        { q: 'How do you detect this class of bug in production?', a: 'Invariant monitors: nightly queries for negative balances, points spent before they became AVAILABLE, and refunds without matching claw-backs. Alert on any row.' },
      ],
      pitfalls: [
        'Proposing a global lock on the customer across services',
        'Ignoring that compensation can be impossible if the resource is already consumed',
        'No explicit business rule for the shortfall',
      ],
    },
    {
      id: 'misc-distributed-iq-19',
      difficulty: 'hard',
      question:
        'Your team has built three hand-rolled saga orchestrators (status columns, cron sweepers, retry tables). A staff engineer proposes Temporal. Make the case for and against, and tell me what durable execution actually gives you.',
      whatInterviewerLooksFor: [
        'Explains durable execution: persisted event history, deterministic replay',
        'Weighs operational cost and constraints (determinism, versioning, history limits)',
        'Knows when a status column plus outbox is enough',
        'Concrete migration approach',
      ],
      modelAnswer: `**What durable execution is:** you write the saga as ordinary code (await reserve(); await capture(); ...). The engine records every step's result in an **event history**. If the worker dies, another worker **replays** the function from that history. Completed activities are not re-executed; their recorded results are fed back, so the code continues exactly where it stopped. Timers ("wait 3 days for the return window"), retries with backoff, timeouts and signals are all built in.

**For:**
- It removes the bespoke plumbing that is the source of most bugs: state machines, sweepers, retry tables, "stuck in PAID" dashboards.
- Visibility: every workflow's history is inspectable, which answers "where is order X stuck?".
- Long waits are cheap (a workflow sleeping for 30 days costs a row, not a thread).
- Compensation is natural: try/catch with a stack of undo functions.

**Against / costs:**
- **Determinism constraints:** workflow code must not call Date.now(), random or I/O directly. Those go through the SDK or into activities. Changing workflow code needs versioning or patching, or in-flight workflows break on replay.
- **Operational weight:** a Temporal cluster (frontend, history and matching services plus Cassandra/Postgres) or a paid Temporal Cloud. It is another critical dependency on the hot path.
- **History limits:** roughly 50K events / 50 MB per execution, so very long-lived workflows must use continue-as-new.
- Activities still need **idempotency**. Durable execution gives at-least-once activity execution, not exactly-once side effects.

**My call:** for 3+ multi-step flows with waits and compensation, adopt it. Migrate one new flow first, keep existing orchestrators until they are replaced naturally, and set up workflow versioning rules and a replay test in CI. For a 2-step flow, a status column plus outbox remains simpler.`,
      followUps: [
        { q: 'Step Functions vs Temporal?', a: 'Step Functions is fully managed with a JSON/ASL state machine, and fits AWS-native teams well with pay-per-transition pricing. Temporal lets you write code in your language, is portable, and handles complex logic more comfortably, but you run it or pay for Cloud.' },
        { q: 'How do you test replay safety?', a: 'Record production histories and run a replayer against the new workflow code in CI. Any non-determinism error fails the build.' },
      ],
      pitfalls: [
        'Believing durable execution makes activities exactly-once',
        'Ignoring workflow versioning for in-flight executions',
        'Adopting it for trivial two-step flows',
      ],
    },
    {
      id: 'misc-distributed-iq-20',
      difficulty: 'medium',
      question:
        'Rapid-fire: when is CQRS overkill, and which signals would make you introduce it into an existing NestJS service?',
      whatInterviewerLooksFor: [
        'Understands CQRS costs: eventual consistency, projection plumbing, rebuilds',
        'Clear, measurable signals for adopting it',
        'Knows CQRS does not require event sourcing',
      ],
      modelAnswer: `**Overkill when:**
- Screens map closely to tables (CRUD admin panels) and a few indexes solve read performance.
- The team is small, and "I saved but can't see it" would be a product bug you cannot afford to work around.
- Read and write load are similar and fit one Postgres with a couple of replicas.

**Signals that justify it:**
1. **Shape mismatch:** reads need joins across 6+ tables or aggregates (order list with payment, shipping and returns status), and query p99 is growing with data.
2. **Different stores are needed:** full-text search, geo, or counters that Postgres serves poorly.
3. **Load asymmetry:** reads are 50–100× writes and need to scale independently.
4. **Several services' data in one view,** where API composition is too slow or fragile.

**How I'd introduce it:** keep the write model as it is. Publish domain events via an outbox (or use CDC), and build *one* projection for the painful query (e.g. an order_summaries table or an Elasticsearch index). Store the projection position with each update, and add read-your-writes handling for the user who made the change. CQRS does **not** require event sourcing. Most successful CQRS setups are "normal tables + events → read model".`,
      followUps: [
        { q: 'Isn\'t a read replica already CQRS?', a: 'It separates read and write load, but the model is the same. CQRS is about a different shape per read use case. A replica is a useful first step before it.' },
        { q: 'What is the smallest CQRS you can do?', a: 'A materialised view (Postgres REFRESH MATERIALIZED VIEW CONCURRENTLY) or a denormalised table maintained in the same transaction, with no async lag at all.' },
      ],
      pitfalls: [
        'Equating CQRS with event sourcing',
        'Introducing it everywhere at once',
        'No plan for read-your-writes or rebuilds',
      ],
    },
    {
      id: 'misc-distributed-iq-21',
      difficulty: 'hard',
      question:
        'Your CQRS order-search projection in Elasticsearch must be rebuilt because of a mapping change (keyword → text with a new analyzer). The event log has 800M events and the search must stay up with live updates. Walk me through the rebuild.',
      whatInterviewerLooksFor: [
        'Blue/green projection with an alias swap',
        'Catch-up via checkpoints so live events are not missed',
        'Throughput estimate and bulk-indexing tuning',
        'Validation before switching, and rollback',
      ],
      modelAnswer: `**Approach: build a second projection side by side, then switch an alias.**

1. **Create orders_v2** with the new mapping. For the bulk phase, set refresh_interval = -1 and number_of_replicas = 0.
2. **Start a new projector group** (projector-v2) that reads the event log from position 0 and writes only to orders_v2. The live v1 projector keeps serving orders (alias orders_read → orders_v1).
3. **Throughput:** 800M events, but only ~100M orders (documents). Projecting in memory per partition and bulk-indexing the *final* document per order, instead of indexing every event, cuts ES writes by about 8×. At ~50K events/s across 16 partitions, replay takes ~800M / 50K ≈ 4.4 h.
4. **Catch up:** v2 keeps consuming, and once caught up it processes live events (lag < 5 s). Both projections now receive live updates.
5. **Finalise the index:** set replicas = 1, refresh_interval = 1s, and wait for green.
6. **Validate:** compare document counts per day bucket, sample 10K random order ids for field-level equality, and run the top 100 production queries against both, comparing hit counts.
7. **Atomic alias swap:** a single _aliases request that removes orders_v1 and adds orders_v2 under orders_read. Keep v1 and its projector running for 24–48 h as a rollback, then delete.

**Correctness details:**
- Idempotent writes: use the order id as document id and the order's last event version as an external version (version_type = external), so ES rejects older updates when events replay or arrive out of order.
- The projector checkpoint (offset per partition) is committed only after the bulk response succeeds for that batch.

**If the log does not retain 800M events** (Kafka retention), rebuild from the event store/DB or a compacted snapshot topic. That is why the source of truth must be replayable.`,
      followUps: [
        { q: 'What if the rebuild must finish in under an hour?', a: 'Scale partitions and bulk workers (ES bulk ingest of ~100K docs/s is feasible on a decent cluster), or seed from a snapshot of current state instead of replaying all events.' },
        { q: 'How do you avoid double load on the source DB during rebuild?', a: 'Replay from the log (Kafka / event store), not by querying the DB. Throttle the projector if ES indexing latency rises.' },
      ],
      pitfalls: [
        'Reindexing in place and taking search down',
        'Missing events that arrive between the snapshot and the switch',
        'Indexing every event individually with refresh on',
      ],
    },
    {
      id: 'misc-distributed-iq-22',
      difficulty: 'medium',
      question:
        'Rapid-fire: people use "event sourcing", "event-driven architecture" and "CDC" interchangeably. Distinguish them, and say when you would combine two of them.',
      whatInterviewerLooksFor: [
        'Crisp definitions tied to where the source of truth lives',
        'Understands domain events vs integration events',
        'A realistic combination example',
      ],
      modelAnswer: `**Event sourcing:** a *persistence* pattern inside one service. The event stream **is** the source of truth for an aggregate. Current state is derived by folding events. It is typically invisible to other services.

**Event-driven architecture:** an *integration* style between services. Services publish events ("OrderPlaced") that others react to asynchronously. The publisher's source of truth can be ordinary tables. Events are notifications or state transfer, not the database.

**CDC (change data capture):** a *mechanism* that turns committed row changes in a database's log (Postgres WAL, MySQL binlog) into a stream, e.g. Debezium → Kafka. The events are technical ("row updated"), not domain intent, unless you combine CDC with an outbox table.

**Combinations that make sense:**
- **Tables + outbox + CDC → EDA:** the most common setup. The service writes rows and an outbox row in one transaction. Debezium publishes the outbox as integration events. No event sourcing needed.
- **Event sourcing + EDA:** an event-sourced wallet publishes *curated integration events* (TransferCompleted) derived from its internal events. It does not expose raw internal events, which would couple consumers to its aggregate design.
**One-liner:** event sourcing = how I store; EDA = how we talk; CDC = how I extract changes from a database.`,
      followUps: [
        { q: 'Why not publish raw event-sourced events to other teams?', a: 'They are your internal schema. Every refactor of the aggregate becomes a breaking change for consumers. Publish a stable, versioned integration contract instead.' },
        { q: 'Is Kafka with log compaction an event store?', a: 'It is a great transport and can be a changelog, but it lacks per-aggregate expected-version appends, so it cannot enforce aggregate invariants on its own.' },
      ],
      pitfalls: [
        'Thinking any system that publishes events is event-sourced',
        'Treating CDC row events as domain events',
        'Exposing internal event-sourced events as the public contract',
      ],
    },
    {
      id: 'misc-distributed-iq-23',
      difficulty: 'expert',
      question:
        'Your event-sourced billing service has four years of events. InvoiceIssued v1 stored the amount as a float in rupees; v3 needs integer paise plus a currency code and tax breakdown. Events are immutable. How do you evolve the schema, and what breaks if you get it wrong?',
      whatInterviewerLooksFor: [
        'Upcasting on read vs copy-and-transform migration, with trade-offs',
        'Handles float → integer conversion and missing data explicitly',
        'Protects projections, snapshots and external consumers',
        'Testing strategy (replay all history in CI)',
      ],
      modelAnswer: `**Rule:** never edit stored events. They are the audit trail. Evolve the way they are *interpreted*.

**Option 1 — upcasters (default):** events carry schema_ver. On read, a chain v1 → v2 → v3 transforms old payloads into the current shape before the aggregate or projector sees them:
- amountPaise = Math.round(amountRupees × 100). Rounding is explicit and tested against known historical invoice totals, since floats such as 0.1 + 0.2 produce off-by-one-paise errors.
- currency = 'INR' (the only currency before v3). Tax breakdown = a single line "legacy_unsplit" rather than inventing numbers you never recorded.
- Pro: no data migration, and history stays byte-for-byte original. Con: upcasters live forever and add read cost. Chains get long.

**Option 2 — copy-and-transform:** stream all events into a new store or stream with v3 shape, verify, and switch. Pro: clean code afterwards. Con: a big operation (billions of rows), the audit trail must link old and new, and live writes must be dual-written or cut over at a point.

**Usually:** upcast now. When chains exceed ~3 versions, do a one-time copy-transform during a quiet period.

**What breaks if you get it wrong:**
- **Projections** rebuilt later produce different totals from the ones customers were shown, which is a finance incident.
- **Snapshots** serialised with the old aggregate shape fail to load. Version them and discard stale ones (rebuild from events).
- **External consumers** of integration events. Keep integration contracts separate and versioned, and add fields rather than changing their meaning.

**Testing:** a CI job replays a production-sized anonymised sample (or all streams nightly) through the upcasters and asserts invariants (invoice total = sum of lines, no NaN, same balances as last night's projection).`,
      followUps: [
        { q: 'What about a GDPR request on those events?', a: 'Crypto-shredding: personal data is encrypted with a per-customer key that you delete. The events stay, but the personal fields become unreadable. Amounts can remain for legal retention.' },
        { q: 'Weak schema (tolerant reader) instead of upcasters?', a: 'For additive changes, ignoring unknown fields and defaulting missing ones is enough. A change in a field\'s meaning or unit (rupees → paise) needs an explicit upcaster.' },
      ],
      pitfalls: [
        'UPDATE-ing old events in place',
        'Silent float rounding without verification against historical totals',
        'Forgetting that snapshots carry the old shape too',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'misc-distributed-boe-1',
      question:
        'A team wants a distributed lock around every "apply promo code" request: 20K lock acquisitions/s at peak, each held ~50 ms. Compare the Redis load and latency of a single-instance lock vs Redlock over 5 masters, and say whether etcd would be a better home.',
      assumptions: [
        'Each critical section = 1 acquire (SET NX PX) + 1 release (Lua compare-and-delete)',
        'One Redis instance does ~100K–150K simple ops/s on its single command thread',
        'Same-AZ RTT ~0.3 ms; cross-AZ ~1 ms',
        'etcd on good SSDs sustains roughly 10K–30K small linearizable writes/s per cluster, since each write is a Raft commit + fsync',
      ],
      steps: [
        { label: 'Single-instance Redis ops', calc: '20K × 2 = 40K ops/s → ~30–40% of one instance; fine, with headroom for retries' },
        { label: 'Concurrent locks held', calc: '20K/s × 0.05 s = 1,000 keys at any moment → < 1 MB memory' },
        { label: 'Redlock ops', calc: '5 masters × 40K = 200K ops/s cluster-wide (40K per master); every request fans out to 5 nodes' },
        { label: 'Redlock latency', calc: 'Wait for 3rd-fastest of 5 acks ≈ 1–2 ms cross-AZ vs ~0.3 ms single; plus retries with random backoff on contention' },
        { label: 'etcd', calc: '40K writes/s (acquire + release) ≥ etcd\'s practical write ceiling; each write ~2–10 ms (Raft + fsync)' },
      ],
      answer:
        'A single Redis handles it at ~40K ops/s but gives only an efficiency lock. Redlock costs 5× the operations and 3–6× the latency, and still provides no fencing. etcd would be saturated by 40K writes/s.',
      insight:
        '20K locks/s is a design smell, not a sizing problem. Promo redemption is a per-code invariant, so enforce it with a conditional write (UPDATE promo SET used = used + 1 WHERE code = $1 AND used < max_uses) or a unique (code, user) constraint. Keep locks for coarse, low-rate coordination.',
      followUps: [
        {
          "q": "You replace locks with the conditional UPDATE. 5,000 of those 20K/s are for a single viral promo code. What happens to Postgres?",
          "a": "All 5K/s hit the same row, so they serialise on its row lock: each UPDATE holds the lock for its duration, roughly 0.2–1 ms including WAL, giving a ceiling of about 1–5K updates/s on one row, and lock queues grow. Fix by splitting the counter: pre-allocate the code's quota across N sub-rows (`promo_slots(code, shard, remaining)`), and have each request pick a random shard with remaining capacity. Or reserve redemptions in Redis atomically with `DECR` (single-threaded, ~100K/s), then persist asynchronously with reconciliation. Also add a unique (code, user) constraint so each user redeems once."
        }
      ],
    },
    {
      id: 'misc-distributed-boe-2',
      question:
        'A movie-ticket platform runs 3M bookings/day through a 5-step orchestrated saga (peak hour = 12% of daily traffic). Estimate the orchestrator\'s persistence write rate and storage for a hand-rolled Postgres state table vs Temporal event histories.',
      assumptions: [
        'Hand-rolled: per step, 1 state UPDATE + 1 step-log INSERT; saga row ~500 B, each step-log row ~300 B',
        'Temporal: ~6 history events per activity (scheduled/started/completed plus workflow-task events) + ~5 for start/finish; ~800 B per event with small payloads (ids only)',
        'Retention: 90 days in Postgres; 7 days for completed Temporal workflows (namespace retention)',
      ],
      steps: [
        { label: 'Peak bookings/s', calc: '3M × 0.12 ÷ 3,600 ≈ 100 bookings/s (avg 3M ÷ 86,400 ≈ 35/s)' },
        { label: 'Hand-rolled writes', calc: '5 steps × 2 writes = 10 writes/booking → ~1,000 writes/s peak' },
        { label: 'Hand-rolled storage', calc: '500 B + 5 × 300 B = 2 KB/booking × 3M = 6 GB/day × 90 days ≈ 540 GB (+ indexes ~1.5×)' },
        { label: 'Temporal events', calc: '5 × 6 + 5 ≈ 35 events/booking → 35 × 100 = 3,500 history writes/s at peak' },
        { label: 'Temporal storage', calc: '35 × 800 B ≈ 28 KB/booking × 3M ≈ 84 GB/day × 7 days ≈ 590 GB' },
      ],
      answer:
        'Hand-rolled: ~1K writes/s peak and ~0.5 TB for 90 days. Temporal: ~3.5K persistence writes/s and ~0.6 TB for 7 days of history. Both fit one well-sized database or cluster, but Temporal writes about 3.5× more per booking.',
      insight:
        'Durable execution trades persistence volume for removing bespoke code. Keep activity payloads to ids (a 10 KB payload makes storage 10× larger), set short history retention, and export audit data to your own store if you need 90 days. The per-booking write count, not bookings/s, decides the database size.',
      followUps: [
        {
          "q": "A product manager wants activity payloads to include the full booking object (~10 KB) for debugging. Re-estimate Temporal storage.",
          "a": "Payloads appear in scheduled and completed events for each activity, so roughly 2 × 5 activities × 10 KB = 100 KB extra per booking, on top of about 28 KB: around 128 KB per booking. At 3M bookings/day that's about 384 GB/day, roughly 2.7 TB over 7 days of retention, about 4.5× the previous estimate, and history writes become bandwidth-heavy. Push back: pass ids only, log the booking object to your own log store with the workflow id for debugging, or use a payload codec that offloads large blobs to S3 and stores only references in history."
        }
      ],
    },
    {
      id: 'misc-distributed-boe-3',
      question:
        'An event-sourced ledger holds 50M accounts. Most have < 200 events, but ~2,000 merchant accounts have 5M+ events each. Estimate aggregate load time with and without snapshots, and pick a snapshot interval.',
      assumptions: [
        'Events ~400 B each; event store reads stream ~100 MB/s per aggregate load (sequential, index on stream_id, version)',
        'Folding an event in Node ~1 µs',
        'Command latency budget p99 < 50 ms',
        'Snapshot ~2 KB',
      ],
      steps: [
        { label: 'Typical account, no snapshot', calc: '200 × 400 B = 80 KB → < 1 ms read + 0.2 ms fold; fine' },
        { label: 'Merchant, no snapshot', calc: '5M × 400 B = 2 GB → 2 GB ÷ 100 MB/s ≈ 20 s + 5 s fold → impossible per command' },
        { label: 'Snapshot every 1,000 events', calc: 'Load ≤ 1,000 × 400 B = 400 KB ≈ 4 ms + 1 ms fold + snapshot read → ~5–8 ms' },
        { label: 'Snapshot write overhead', calc: '2 KB per 1,000 events (400 KB) ≈ 0.5% extra storage and writes' },
        { label: 'Merchant write rate check', calc: '5M events/year ≈ 14K/day → a snapshot every ~1.7 h per merchant; trivial' },
      ],
      answer:
        'Without snapshots, hot merchant accounts take ~25 s to load. With a snapshot every 1,000 events, the worst-case load is ~5–8 ms, at ~0.5% storage overhead. Typical accounts do not need snapshots at all.',
      insight:
        'Snapshot by event count (only streams that cross the threshold get one), not on a timer for all 50M accounts. Keep hot merchant aggregates cached in memory on a single owner (partitioned by account) so most commands skip loading. Version snapshots so a code change can discard them safely.',
      followUps: [
        {
          "q": "One merchant account receives 200 events/s during a sale. Does the snapshot-every-1,000 policy still hold up?",
          "a": "At 200 events/s, the account crosses 1,000 events every 5 s, so a snapshot every 5 s (2 KB), which is trivial. Load time stays bounded at about 5–8 ms. The real issue is concurrency: 200 commands/s on one stream with optimistic appends would conflict constantly. Use a single owner for that account (commands partitioned by account id to one consumer) that keeps the aggregate in memory, so it loads once and then applies events incrementally. Snapshots then matter only for failover, when the new owner loads the latest snapshot plus at most 1,000 events."
        }
      ],
    },
    {
      id: 'misc-distributed-boe-4',
      question:
        'A Kafka consumer group processes 50K events/s and must not apply duplicates. A teammate proposes a Redis SET of processed event ids kept for the topic retention (7 days). Size it, and compare with deduping by partition offset or producer sequence.',
      assumptions: [
        'Event id = UUID; Redis cost per set member ~70–90 B with overhead (36-byte string + dict entry)',
        'Topic has 64 partitions; retention 7 days',
        'Duplicates come from consumer redelivery after a crash (window = uncommitted offsets, seconds) and from producer retries (window = seconds to minutes)',
      ],
      steps: [
        { label: 'Ids over 7 days', calc: '50K × 86,400 × 7 ≈ 3.0 × 10^10 ids' },
        { label: 'Redis memory', calc: '3 × 10^10 × ~80 B ≈ 2.4 TB → a large Redis cluster just for dedupe' },
        { label: 'Bounded 15-minute window', calc: '50K × 900 s = 45M ids × 80 B ≈ 3.6 GB; fits one node, but misses replays older than 15 min' },
        { label: 'Offset-based dedupe', calc: 'Store last applied offset per partition with the state change: 64 × ~16 B ≈ 1 KB total' },
        { label: 'Per-entity version', calc: 'Store last applied version per aggregate row (8 B column) → skip if event.version ≤ stored' },
      ],
      answer:
        'A 7-day id set needs ~2.4 TB of Redis. A 15-minute window needs ~3.6 GB. Offset or version-based dedupe, stored in the same transaction as the effect, needs about 1 KB, or one column per row.',
      insight:
        'Dedupe by position, not membership. Commit the consumed offset (or the entity\'s last applied version) atomically with the side effect in the same database. Use a small time-bounded id set only for duplicates the producer created with new offsets, and prevent those at the source with Kafka\'s idempotent producer or a business-key unique constraint.',
      followUps: [
        {
          "q": "The consumer's side effect is an HTTP call to a partner, not a DB write, so you can't commit the offset atomically with it. What now?",
          "a": "Then position-based dedupe can't be atomic with the effect. Make the partner call idempotent instead: send an idempotency key derived from the event (`eventId` or `topic:partition:offset`), and the partner dedupes for its retention window. If the partner doesn't support keys, keep your own record: write `(event_id, status)` to a DB before calling (claim), call, then mark done. On redelivery, skip done ones, and for claimed-but-not-done ones query the partner's state before retrying. The id store only needs to cover the redelivery window, a few minutes, so a small table or Redis set with TTL is enough."
        }
      ],
    },
  ],
  test: [
    {
      id: 'misc-distributed-mcq-01',
      difficulty: 'expert',
      question:
        'A live cricket scoreboard document is read worldwide via Azure Cosmos DB configured for "consistent prefix". The writer updates it after every ball: 120/3 → 124/3 → 124/4. A viewer in another region refreshes repeatedly without any session token. What can the viewer observe?',
      options: [
        'Refreshes are monotonic, never going backwards, but may skip intermediate scores',
        'Every refresh is at most a fixed number of updates behind the writer',
        'Every refresh shows a score the writer actually produced, but a later refresh may show an older score than an earlier one',
        'Every refresh shows 124/4 once the writer\'s update has been acknowledged',
      ],
      correct: [2],
      explanation:
        'Consistent prefix guarantees that each read returns some prefix of the write sequence, with no gaps and no reordering. It says nothing about successive reads, which may hit replicas with different prefixes and so appear to go backwards. Monotonic reads is a session-consistency guarantee (it needs the session token). A fixed maximum lag is bounded staleness. Always seeing the latest write is strong consistency.',
      followUps: [
        {
          "q": "Product says the score must never appear to go backwards for a viewer. What's the cheapest consistency change, and what does it cost?",
          "a": "Switch the viewer's reads to session consistency and carry the session token: Cosmos then serves reads only from replicas that have caught up to at least the token's position, which gives monotonic reads per viewer. It's cheaper than bounded staleness or strong, adds no cross-region round trips in the normal case, and costs the same RU per read. The app must store and pass the token, for example in the client SDK instance or a cookie. Alternatively, do it client-side: include a version number in the document and have the client ignore any response older than the last version it displayed."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-02',
      difficulty: 'hard',
      question:
        'This read-your-writes router works in testing, but after months in production some users see their old profile right after saving it. What is the cause?',
      code: {
        language: 'typescript',
        code: `// after a successful write on the primary:
const w = await primary.query('SELECT pg_current_wal_lsn()::text AS lsn');
session.minLsn = w.rows[0].lsn;                 // e.g. '0/100000A8'

async function readProfile(userId: string, session: Session) {
  const replica = pickReplica();
  const r = await replica.query('SELECT pg_last_wal_replay_lsn()::text AS lsn');
  if (r.rows[0].lsn >= session.minLsn) {         // replica caught up?
    return replica.query('SELECT * FROM profiles WHERE id = $1', [userId]);
  }
  return primary.query('SELECT * FROM profiles WHERE id = $1', [userId]);
}`,
      },
      options: [
        'The replica can fall behind again between the LSN check and the profile query',
        'LSNs are compared as strings, so a lagging replica at "0/FFFFF20" sorts after "0/100000A8" and is treated as caught up',
        'pg_last_wal_replay_lsn() reports WAL received, not WAL replayed, so the replica may not have applied it yet',
        'pg_current_wal_lsn() is read before the write commits, so minLsn is too low',
      ],
      correct: [1],
      explanation:
        'LSNs are hex positions. Compared as strings, "0/FFFFF20" > "0/100000A8" because "F" > "1", even though it is numerically smaller. That only shows up once the WAL position gains a digit, which is why it appeared after months. Compare in SQL with the pg_lsn type (SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn) or as BigInt. Replicas only move forward, so they cannot fall behind again. pg_last_wal_replay_lsn is the replayed position (receive is pg_last_wal_receive_lsn). The LSN is read after the write committed.',
      followUps: [
        {
          "q": "After fixing the comparison, how long should a request wait for a replica to catch up before falling back to the primary, and what protects the primary from the fallback?",
          "a": "Wait only a small slice of the request budget: for example poll `pg_last_wal_replay_lsn()` (or use a single query with a short `pg_sleep` loop) for up to 50–100 ms, since replica lag is usually milliseconds. If not caught up, go to the primary. Protect the primary: only users with a recent write (LSN in the session younger than, say, 5 s) take this path at all, and primary fallback reads go through a small dedicated pool with a concurrency cap. If the cap is reached, serve the replica result with a 'just saved, may take a moment' hint instead of overloading the primary."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-03',
      difficulty: 'expert',
      question:
        'A client writes a key to the etcd leader. The leader commits the entry on a majority, but the client\'s network drops before the response arrives, and the client reports a timeout. After the network heals the new value is present. A teammate files a bug: "our CP store applied a write it reported as failed." Which assessment is correct?',
      options: [
        'It is a linearizability violation; etcd should roll back entries whose client did not receive an acknowledgement',
        'It shows etcd chose availability over consistency while the network was degraded',
        'A long enough client timeout would always make the outcome known, so the fix is raising it from 5 s to 60 s',
        'A timeout is an indeterminate outcome; the write may take effect at any point before a response, so the client must retry idempotently or read back',
      ],
      correct: [3],
      explanation:
        'Linearizability says an operation takes effect atomically at some point between invocation and response. If no response ever arrives, the operation may or may not have happened, and both are legal. Committed Raft entries are never rolled back. Nothing here traded consistency for availability: the write went through a majority. No timeout length can resolve it, because the partition could last longer than any timeout. Hence idempotent retries (a request id or a compare-and-set on the revision) or reading back.',
      followUps: [
        {
          "q": "Make the client safe. The write is 'set config key X to value V'. How do you retry without risk?",
          "a": "For an absolute put, retrying the same value is already idempotent, but it can overwrite a newer write by someone else that landed in between. Use etcd's transactions with compare-and-set on the revision: read X's `mod_revision` before writing, then `Txn(If(ModRevision(X) == r), Then(Put(X, V)))`. On timeout, read X back: if it holds V with a `mod_revision` greater than r, your write landed; if it still has revision r, retry the transaction; if a different value with a higher revision appears, someone else won and you surface a conflict. That resolves the indeterminate outcome without blind overwrites."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-04',
      difficulty: 'hard',
      question:
        'During a network partition, which of these configurations keep answering on the minority / isolated side with possibly stale or divergent data (the "A" choice)? Select ALL that apply.',
      options: [
        'Cassandra reads and writes at consistency level ONE',
        'An etcd follower isolated from the leader, serving a get with serializable consistency (--consistency=s)',
        'An etcd follower isolated from the leader, serving a default (linearizable) get',
        'A Postgres async streaming replica on the far side of the partition, continuing to serve read-only queries',
        'MongoDB writes with writeConcern "majority" issued on the minority side',
      ],
      correct: [0, 1, 3],
      explanation:
        'CL=ONE answers from any single live replica, which is an availability choice. etcd serializable reads are served from the member\'s local state without contacting the leader, so they stay up but may be stale. A detached Postgres replica keeps serving its last replayed state. A default etcd get needs a ReadIndex confirmation from the leader and a quorum, so it fails on the isolated side. Majority writes cannot be acknowledged without a majority, so they block or time out: the CP choice.',
      followUps: [
        {
          "q": "For your service's config reads, would you use etcd's serializable or linearizable reads? Justify with the failure case.",
          "a": "Depends on what a stale read can do. For config polled every few seconds where acting on a value a few hundred milliseconds old is harmless (feature flags, timeouts), serializable reads are fine: they're cheaper (no leader round trip) and keep working on an isolated member. For anything used to make an exclusive decision (leader election checks, lock ownership, 'is this tenant migrated?'), use linearizable reads; a partitioned follower serving an old value could let two nodes both believe they own something. Mixed is common: watch-based caches for config, linearizable for coordination."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-05',
      difficulty: 'hard',
      question:
        'A team configures N=3, W=1, R=3 to get "cheap writes and strong reads" in a Dynamo-style store with sloppy quorums and hinted handoff enabled. Select ALL statements that are true.',
      options: [
        'If any one home replica is down, reads at R=3 fail (or must fall back to a weaker level)',
        'When all home replicas are healthy, every read set overlaps every write set because 1 + 3 > 3',
        'A write accepted by a fallback node (hinted handoff) can be missed by a later R=3 read of the three home replicas',
        'An acknowledged write survives the permanent loss of any single node',
        'The configuration tolerates one node failure for both reads and writes',
      ],
      correct: [0, 1, 2],
      explanation:
        'R=3 needs every replica, so one failure blocks strict reads. With healthy home replicas, R + W > N gives overlap. A sloppy quorum stores the write on a non-home node, so the home replicas a later read contacts may not have it. That is how sloppy quorums break the overlap guarantee. W=1 means the ack comes after a single copy, so losing that node before replication loses the write. Writes tolerate two failures, but reads tolerate none, so the "both" claim is false.',
      followUps: [
        {
          "q": "What R and W would you pick for N=3 to tolerate one failure for both reads and writes, and what does sloppy quorum still break?",
          "a": "W=2, R=2: R + W = 4 > 3, so read and write sets overlap among the home replicas, and either operation survives one node down. Writes now need two copies before ack, so a single node loss can't lose an acknowledged write. Sloppy quorums still weaken it: if two home replicas are unreachable, a write may be stored on fallback nodes (hinted handoff), and a later R=2 read of reachable home replicas can miss it until the hints are delivered. If you need the guarantee, disable sloppy quorum for that data (in Cassandra terms, use QUORUM, not ANY), accepting failed writes instead."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-06',
      difficulty: 'expert',
      question:
        'A 6-node replicated log uses Flexible Paxos. To cut write latency, the replication (phase-2) quorum is set to 2 nodes. What is the smallest leader-election (phase-1) quorum that keeps it safe, and what is the consequence?',
      options: [
        '4 (a simple majority of 6); elections tolerate 2 failures as usual',
        '5; elections need 5 of 6 nodes, so a leader cannot be elected if 2 nodes are down, even though replication tolerates 4 down',
        '3, because Q1 and Q2 only need to add up to at least N/2 + 1',
        '6; every node must vote so no committed entry can be missed',
      ],
      correct: [1],
      explanation:
        'Flexible Paxos only requires every election quorum to intersect every replication quorum: Q1 + Q2 > N, so Q1 > 4, giving Q1 = 5. The trade-off is that steady-state writes are fast and survive many failures, but a leader change needs 5 live nodes. A simple majority of 4 does not intersect a 2-node replication quorum (4 + 2 = 6, not > 6). 6 is safe but not the minimum. The N/2 + 1 rule is invented.',
      followUps: [
        {
          "q": "Two nodes are down and you can't elect a leader, but the current leader is alive. Is the log still writable?",
          "a": "Yes. With Q2 = 2, the existing leader can keep committing as long as it plus one follower are up, so steady-state writes continue even with 4 nodes down. The risk is a leader failure in that state: no new leader can be elected until 5 nodes are reachable, so the system becomes unavailable for writes, possibly for a long time. Operationally, alert as soon as fewer than Q1 nodes are healthy, because you're one failure away from an outage. That's the explicit trade-off: fast, failure-tolerant replication in exchange for fragile elections."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-07',
      difficulty: 'expert',
      question:
        'This leader self-check runs in a NestJS scheduler that holds an etcd lease with a 10 s TTL. What is the most serious flaw?',
      code: {
        language: 'typescript',
        code: `let lastRenewOk = 0;

async function renewLoop() {
  for (;;) {
    try {
      await lease.keepaliveOnce();       // server extends TTL to 10 s from when it processes this
      lastRenewOk = Date.now();          // record success
    } catch { /* retry next tick */ }
    await sleep(3_000);
  }
}

export function amLeader(): boolean {
  return Date.now() - lastRenewOk < 10_000;
}`,
      },
      options: [
        'Renewing every 3 s against a 10 s TTL will overload etcd with keepalive traffic',
        'The empty catch will crash the loop on the first network error',
        'The TTL should be raised to 60 s so the lease cannot expire during normal operation',
        'Validity is measured from when the response arrived, using wall-clock time and the full TTL, so the pod can believe it leads after etcd has already expired the lease',
      ],
      correct: [3],
      explanation:
        'etcd starts the new TTL when it processes the keepalive. The client starts its window later, when the reply arrives, and uses the full 10 s with no margin. A slow reply or a forward NTP step makes it overestimate. Start the window before sending (performance.now()), subtract a safety margin, and fence writes anyway. A keepalive every 3 s is normal (about TTL/3). The catch swallows errors, so it does not crash. A longer TTL only slows failover.',
      followUps: [
        {
          "q": "Fix the self-check. Show the timing logic you'd use, with numbers.",
          "a": "Record `t0 = performance.now()` before sending the keepalive. On success, the lease is valid until at most `t0 + TTL`, since etcd started the TTL after receiving it. Subtract a margin for clock drift and processing, say 20% or 2 s: `validUntil = t0 + 10_000 - 2_000`. Before any leader-only action, check `performance.now() < validUntil`; otherwise stop acting and try to renew. Renew every 3 s, so normally there's 5+ s of slack. `performance.now()` is monotonic, so NTP steps can't extend the window. Even with this, include the lease's revision as a fencing token on writes."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-08',
      difficulty: 'hard',
      question:
        'During failovers, two scheduler pods can both believe they are leader for up to ~5 seconds. Which designs make that overlap harmless rather than just shorter? Select ALL that apply.',
      options: [
        'Every write to the jobs table carries the leader epoch and is rejected if it is lower than the epoch stored on the row',
        'Reduce the lease TTL from 15 s to 3 s so the overlap window shrinks',
        'Make dispatched work idempotent by job id, so a double dispatch executes once downstream',
        'Run chrony/NTP on every node so both pods agree on lease expiry',
        'Dispatch with UPDATE jobs SET state = \'DISPATCHED\' WHERE id = $1 AND state = \'READY\', and only proceed if one row changed',
      ],
      correct: [0, 2, 4],
      explanation:
        'Epoch fencing rejects the stale leader\'s writes. Idempotent downstream work makes duplicates collapse. A compare-and-set on job state guarantees only one dispatcher wins per job. A shorter TTL shrinks the window but a pause can exceed any TTL, and it increases false failovers. Synchronised clocks do not stop a paused process from acting on a lease it no longer holds.',
      followUps: [
        {
          "q": "Where does the leader epoch come from, and how does it reach the jobs table writes?",
          "a": "Use a monotonically increasing number issued by the coordination system at election time: etcd's `create_revision` of the election key, a Kubernetes Lease's `leaseTransitions` count, or a Postgres `UPDATE leader SET epoch = epoch + 1 ... RETURNING epoch` in the same DB as the jobs. The leader keeps it in memory and passes it to every write: `UPDATE jobs SET ..., leader_epoch = $e WHERE id = $id AND leader_epoch <= $e`. A deposed leader's writes then match zero rows. Best is the same database as the jobs, so the token's durability and the check share one failure domain."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-09',
      difficulty: 'hard',
      question:
        'In a 5-node etcd cluster, member E has a flaky NIC. Every few minutes it is cut off for ~3 s, times out, and increments its term. When it reconnects, the healthy leader sees the higher term and steps down, causing a 1–2 s write stall. E\'s log is behind, so it never wins. What addresses the root cause?',
      options: [
        'Increase the heartbeat interval so E times out less often',
        'Reduce the election timeout so each disruptive election resolves faster',
        'Enable PreVote (with CheckQuorum), so E must first learn whether a majority would vote for it before bumping its term',
        'Give E a lower election priority so the others always win',
      ],
      correct: [2],
      explanation:
        'With PreVote, a node runs a trial election that does not change terms. Peers that still hear from a healthy leader refuse, so E never raises the term and never deposes the leader. CheckQuorum makes a leader that has lost its majority step down, which complements it. A longer heartbeat interval makes timeouts more likely. A faster election still disrupts. Standard Raft (and etcd) has no election-priority setting.',
      followUps: [
        {
          "q": "PreVote is enabled. E still has the flaky NIC. What other effects might its flaps cause, and how do you deal with them?",
          "a": "Even without term bumps, E falls behind during each flap and needs to catch up (log entries or a snapshot transfer if it's far behind), adding leader bandwidth and disk load. If E is the leader when it flaps, CheckQuorum makes it step down and a real election happens, a 1–2 s write stall each time. Clients connected to E see timeouts and reconnect. Fix the hardware or move the member: `etcdctl member remove` E and add a healthy replacement, one at a time so quorum holds. Alert on per-member peer round-trip time and leader changes."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-10',
      difficulty: 'expert',
      question:
        'This state machine runs on each of the 3 replicas of a Raft-replicated order service. What happens in production?',
      code: {
        language: 'typescript',
        code: `apply(entry: LogEntry): void {
  const cmd = JSON.parse(entry.data);
  if (cmd.type === 'ORDER_PAID') {
    const o = this.orders.get(cmd.orderId);
    this.orders.set(cmd.orderId, { ...o, status: 'PAID' });
    void this.mailer.send(cmd.email, 'Payment received'); // notify customer
  }
  this.lastApplied = entry.index;
}`,
      },
      options: [
        'Exactly one email per order, because only the leader applies committed entries',
        'Some emails are lost, because followers apply entries before they are committed',
        'It is correct as long as mailer.send is awaited instead of fire-and-forget',
        'Each replica sends the email, and replicas send it again whenever they replay the log after a restart or snapshot restore',
      ],
      correct: [3],
      explanation:
        'Every replica applies every committed entry, so the customer gets three emails. Any node rebuilding state by replaying entries after its last snapshot sends them again. Apply must be deterministic and free of side effects. Record "email pending" in state, and let a single leader-side dispatcher send it with an idempotency key (for example orderId:paid). Followers do apply entries, but only after commit. Awaiting the send does not change who runs it.',
      followUps: [
        {
          "q": "Design the 'single leader-side dispatcher' for emails. What happens across a leader change?",
          "a": "The applied state records `emailsPending: [{orderId, kind}]` deterministically. The current leader runs a dispatcher that reads pending items, sends with idempotency key `orderId:paid`, then proposes a `EmailSent{orderId}` entry through Raft, which removes it from pending when applied. On leader change, the new leader sees the item still pending if `EmailSent` wasn't committed yet, and resends with the same key. The provider dedupes, or worst case a rare duplicate is sent. No replica sends during apply, and replay after restart re-creates pending entries only for items not marked sent."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-11',
      difficulty: 'medium',
      question:
        'A 5-node Raft group has the leader and one follower in Mumbai, two followers in Singapore and one in Frankfurt. RTTs from the leader: Mumbai 1 ms, Singapore 60 ms, Frankfurt 120 ms. Ignoring fsync, what is the steady-state commit latency, and what happens when one Singapore node dies?',
      options: [
        '~60 ms; it stays ~60 ms, because the leader, the Mumbai follower and the remaining Singapore node still form a majority',
        '~120 ms, because the leader waits for every follower; unchanged after the failure',
        '~1 ms, because the leader and a Mumbai peer are enough; it rises to ~60 ms after the failure',
        '~60 ms; it rises to ~120 ms, because Frankfurt is now needed for a majority',
      ],
      correct: [0],
      explanation:
        'A commit needs 3 of 5: the leader, the Mumbai follower (1 ms) and the fastest Singapore follower (60 ms), so about 60 ms. Losing one Singapore node still leaves the other at 60 ms, so latency is unchanged. Frankfurt is only needed if both Singapore nodes fail. Two Mumbai nodes are not a majority of 5. Raft never waits for all followers.',
      followUps: [
        {
          "q": "The business wants ~1 ms commits for Mumbai users but must survive a full Mumbai outage. Can Raft give both? What would you do?",
          "a": "Not with one group. Surviving Mumbai's loss means a majority must exist outside Mumbai, so every commit must reach a non-Mumbai node: at least 60 ms. Options: accept 60 ms for the critical, must-survive data; or split data: keep latency-critical but rebuildable state (sessions, carts) in a Mumbai-local group with async replication to another region, accepting a small loss window on regional disaster. A third option is to stage writes locally and acknowledge as 'pending' while the durable commit happens in the background, which is effectively a product decision about what 'committed' means."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-12',
      difficulty: 'expert',
      question:
        'This helper is meant to run a job on only one pod at a time. The pg Pool points at PgBouncer in pool_mode = transaction. What actually happens?',
      code: {
        language: 'typescript',
        code: `async function runExclusive(jobId: number, work: () => Promise<void>) {
  const { rows } = await pool.query('SELECT pg_try_advisory_lock($1) AS ok', [jobId]);
  if (!rows[0].ok) return;              // someone else is running it
  try {
    await work();
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [jobId]);
  }
}`,
      },
      options: [
        'pg_try_advisory_lock blocks until the lock is free, exhausting the pool under contention',
        'The session-level lock sticks to whichever server connection ran the first statement; unlock runs elsewhere and fails, so the lock leaks, and other clients later multiplexed onto that connection re-acquire it successfully',
        'Advisory locks are replicated to standbys, so after a failover the lock is still held by the old pod',
        'It works, because PgBouncer pins the client to one server connection for as long as it holds an advisory lock',
      ],
      correct: [1],
      explanation:
        'Session advisory locks belong to a server backend. In transaction pooling, each statement can run on a different backend, so the unlock hits a backend that does not hold the lock (it returns false). The lock stays held on the original backend, and any other client later multiplexed onto it gets true, because advisory locks are re-entrant per session. So exclusion breaks both ways. Even without PgBouncer, node-pg\'s pool.query can use different connections for each call. Fix: check out one client and use pg_advisory_xact_lock inside a single transaction, or use a dedicated session connection. The try variant never blocks, advisory locks are not replicated, and PgBouncer does not pin connections for them.',
      followUps: [
        {
          "q": "Write the correct version with transaction-level advisory locks. What's the limit of this approach for a 10-minute job?",
          "a": "Check out one client: `BEGIN; SELECT pg_try_advisory_xact_lock(hashtext('job')); ... COMMIT;`. The lock is released automatically at commit or rollback, even through PgBouncer transaction mode, since the whole transaction stays on one server connection. The limit: the transaction must stay open for the whole 10-minute job, holding a connection and pinning the xmin horizon, which blocks vacuum and causes bloat on busy tables. For long jobs, prefer a lease row (`UPDATE leases SET holder=$me, epoch=epoch+1, expires_at=now()+interval '60s' WHERE expires_at < now()`), renewed periodically, with the epoch as a fencing token."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-13',
      difficulty: 'hard',
      question:
        'A lock is acquired with SET key <random token> NX PX 30000, and this watchdog keeps it alive while a long job runs. What is the real problem?',
      code: {
        language: 'typescript',
        code: `const timer = setInterval(() => {
  void redis.pexpire('lock:' + key, 30_000);   // keep our lock alive
}, 10_000);

try {
  await longJob();
} finally {
  clearInterval(timer);
  await releaseIfOwner(key, token);          // Lua compare-and-delete
}`,
      },
      options: [
        'PEXPIRE does not check ownership: after this process loses the lock, the watchdog keeps extending the new holder\'s lock, and a wedged longJob with a live event loop holds it forever',
        'setInterval drifts under event-loop load, so renewals can arrive a few milliseconds late',
        'PEXPIRE overwrites the key\'s value, destroying the owner token',
        'Renewing every 10 s against a 30 s TTL creates excessive Redis load',
      ],
      correct: [0],
      explanation:
        'Renewal must be a compare-and-extend (a Lua script: if GET == token then PEXPIRE). The watchdog must stop when renewal fails or the job is unhealthy (heartbeat from inside the job loop, not a timer). Otherwise it extends someone else\'s lock after a pause, or keeps a stuck job\'s lock alive indefinitely. Small setInterval drift is harmless against a 20 s margin. PEXPIRE does not touch the value. Renewing at TTL/3 is the standard (Redisson uses 10 s of 30 s).',
      followUps: [
        {
          "q": "Write the correct renewal and say when the watchdog should stop renewing.",
          "a": "Renew with Lua: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`. If it returns 0, the lock is lost: signal the job to abort (AbortController) and stop the interval. Drive renewal from job progress, not only a timer: the job loop calls `heartbeat()` after each unit of work, and the watchdog renews only if a heartbeat arrived in the last interval. A wedged job then stops heartbeating and the lock expires naturally. Also cap total hold time, say 10× expected duration, after which the job aborts."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-14',
      difficulty: 'medium',
      question:
        'In which cases is a single-instance Redis lock (SET NX PX with an owner token, no fencing) an acceptable choice? Select ALL that apply.',
      options: [
        'Letting only one pod rebuild an expensive cache entry after it expires',
        'Stopping two pods from both sending the same daily digest email, where a rare duplicate is tolerable',
        'Guarding a wallet debit that must never overdraw the balance in Postgres',
        'Avoiding two copies of a nightly analytics export, where the output file is overwritten idempotently anyway',
        'Ensuring a single writer appends to an object-storage file that is corrupted by interleaved writes',
      ],
      correct: [0, 1, 3],
      explanation:
        'These are efficiency locks: an occasional overlap after a pause or failover wastes work or sends a duplicate but breaks no invariant. The wallet debit and the file append are correctness cases. The first should use a conditional UPDATE or row lock in the same database. The second needs fencing or a conditional write at the storage layer, because a Redis lock alone will eventually admit two holders.',
      followUps: [
        {
          "q": "For the wallet debit you said 'conditional UPDATE in the same DB'. Show it, and explain why no lock service is needed.",
          "a": "`UPDATE wallets SET balance = balance - $amt WHERE id = $id AND balance >= $amt RETURNING balance;` If rowCount is 0, reject. Postgres takes a row lock for the UPDATE, so concurrent debits on the same wallet serialise; each re-checks `balance >= $amt` against the latest committed value under READ COMMITTED. The invariant lives in the same place as the data, in one atomic statement, so there's no window between 'acquire lock' and 'write' that a pause or failover could break. Add a ledger insert with a unique idempotency key in the same transaction to make retries safe."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-15',
      difficulty: 'hard',
      question:
        'The old lock holder (token 33) and the new holder (token 34) call this function for the same document at nearly the same time, under READ COMMITTED. What can happen?',
      code: {
        language: 'typescript',
        code: `async function fencedWrite(docId: string, token: number, body: string) {
  const { rows } = await pg.query('SELECT fence FROM docs WHERE id = $1', [docId]);
  if (token < rows[0].fence) throw new Error('stale token');
  await pg.query(
    'UPDATE docs SET body = $1, fence = $2 WHERE id = $3',
    [body, token, docId],
  );
}`,
      },
      options: [
        'Nothing bad: Postgres row locks serialise the two UPDATEs, so the check stays valid',
        'Both pass the SELECT before either UPDATE; if 33\'s UPDATE lands last, the stale body wins and the fence moves back to 33',
        'It is safe under READ COMMITTED, but it would fail under SERIALIZABLE',
        'The only bug is that the comparison should be <= so equal tokens are also rejected',
      ],
      correct: [1],
      explanation:
        'The check and the write are separate statements, a classic TOCTOU race. Row locks order the two UPDATEs but do not re-run the application-level check. Put the check in the write: UPDATE docs SET body = $1, fence = $2 WHERE id = $3 AND fence <= $2, and treat rowCount = 0 as stale. SERIALIZABLE would actually detect this with a serialization failure, so the isolation claim is backwards. Rejecting equal tokens would break the current holder\'s repeated writes.',
      followUps: [
        {
          "q": "Your storage is S3, not Postgres, so there's no WHERE clause. How do you apply the same fencing check?",
          "a": "Use S3 conditional writes. Store the fence in the object (or its metadata), read the object's ETag along with its stored fence, verify `storedFence <= myToken`, then `PutObject` with `If-Match: <etag>`. If another writer changed the object since your read, S3 returns 412 and you re-read and re-check. That turns read-check-write into compare-and-swap. For new objects use `If-None-Match: *`. Where conditional writes aren't available, route writes through a small service backed by a database that does the fenced write and then uploads to an immutable, versioned key."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-16',
      difficulty: 'expert',
      question:
        'The lock service grants locks with SET NX on a Redis primary and issues fencing tokens with INCR lock:fence on the same primary. The primary has one async replica and automatic failover. Storage checks tokens correctly. What failure can still let two holders\' writes both be accepted?',
      options: [
        'INCR is not atomic under concurrent clients, so two clients can receive the same number',
        'Tokens overflow after 2^31 grants and wrap to negative values',
        'A gets token 101 and the lock, the primary crashes before replicating either, the promoted replica still has the counter at 100 and no lock key, and B acquires and also gets 101',
        'None, because once storage enforces tokens, the lock service\'s durability does not matter',
      ],
      correct: [2],
      explanation:
        'Fencing needs tokens that are monotonic across the lock service\'s own failures. With async replication, an acknowledged INCR (and lock) can vanish in a failover, so a token is issued twice and storage accepts both, since 101 <= 101. Use a token source with consensus-backed durability (etcd revision, ZooKeeper zxid, or a DB sequence in the same database). INCR is atomic, and Redis integers are 64-bit. Storage-side checks only work if tokens are unique and increasing.',
      followUps: [
        {
          "q": "You move token issuance to etcd. Where exactly does the token come from, and must the lock and token come from the same system?",
          "a": "Acquire the lock as an etcd key created with a lease in a transaction (`If(CreateRevision(key) == 0) Then(Put(key, me, lease))`). The returned `header.revision`, or the key's `create_revision`, is the token: cluster-wide monotonic and Raft-durable, so it survives failovers. Yes, lock and token should come from the same system in one atomic step; issuing them separately (lock in Redis, token from etcd) recreates the race, since the two systems can disagree after failures about who holds the lock when that token was issued."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-17',
      difficulty: 'medium',
      question:
        'Storage enforces fencing with UPDATE ... WHERE id = $id AND fence < $token (strictly less). After rollout, lock holders report that their second write to the same record always fails as "stale". What is going on?',
      options: [
        'This is intended; tokens are single-use and a holder must re-acquire the lock for every write',
        'Strict comparison is required for safety because an equal token means a duplicate holder',
        'The lock service is issuing tokens out of order and must be replaced',
        'After the first write the stored fence equals the holder\'s token, so strict < rejects it; only strictly older tokens should be rejected (fence <= token)',
      ],
      correct: [3],
      explanation:
        'A token identifies one lock grant, and the holder legitimately performs many writes with it. Once the first write stores fence = token, a strictly-less check rejects all later writes from the same holder. Tokens are unique per grant, so an equal token can only come from the current holder, and <= is safe. Re-acquiring per write adds a lock round trip to every operation for no benefit.',
      followUps: [
        {
          "q": "With <= allowed, two different holders could share the same token if the lock service ever reissues one. How would you detect that in production?",
          "a": "Record the holder alongside the fence: storage writes `(fence, holder_id)`, and the check becomes `fence < token OR (fence = token AND holder = me)`. A write with an equal token but a different holder is rejected and logged as a 'duplicate token' alarm. That should never happen with a consensus-backed token source, so it is a high-severity alert indicating the lock service lost durability. Also emit metrics on fenced rejections; a steady trickle shows stale holders after pauses, which is the system working, while a spike after a failover points at configuration problems."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-18',
      difficulty: 'hard',
      question:
        'Which operations leave the system in the same state no matter how many times they are retried? Select ALL that apply.',
      options: [
        'UPDATE orders SET status = \'SHIPPED\' WHERE id = 42 AND status = \'PACKED\'',
        'UPDATE wallets SET balance = balance - 500 WHERE id = 7',
        'PUT /users/42 with the full user representation',
        'UPDATE orders SET status = \'SHIPPED\', shipped_at = now() WHERE id = 42',
        'INSERT INTO ledger (entry_id, amount) VALUES (\'tx-9:debit\', -500) ON CONFLICT (entry_id) DO NOTHING',
      ],
      correct: [0, 2, 4],
      explanation:
        'A conditional state transition applies once: after the first run the WHERE no longer matches. A full-representation PUT sets absolute state. An insert keyed by a deterministic business id with ON CONFLICT DO NOTHING dedupes itself. A relative decrement subtracts again on every retry. The unconditional shipped_at = now() looks idempotent but moves the timestamp on every retry, which corrupts SLA reporting and triggers "updated" events.',
      followUps: [
        {
          "q": "Make the wallet decrement idempotent without changing it to an absolute value.",
          "a": "Key it by a deterministic operation id and record it in the same transaction: `INSERT INTO wallet_ops (op_id, wallet_id, amount) VALUES ('order-991:debit', 7, -500) ON CONFLICT (op_id) DO NOTHING RETURNING op_id`. Only if a row was inserted, run `UPDATE wallets SET balance = balance - 500 WHERE id = 7 AND balance >= 500`, then commit. A retry inserts nothing and skips the decrement. The op table doubles as an audit ledger, and the balance can be recomputed from it. The op id must come from the caller's business identity (order, payment), not be generated per attempt."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-19',
      difficulty: 'expert',
      question:
        'This multi-tenant payouts endpoint claims to support idempotency keys. Select ALL real defects.',
      code: {
        language: 'typescript',
        code: `@Post('payouts')
async create(
  @Headers('idempotency-key') key: string,
  @Req() req: AuthedRequest,
  @Body() dto: PayoutDto,
) {
  const hit = await this.redis.get('idem:' + key);
  if (hit) return JSON.parse(hit);                       // replay
  const result = await this.payouts.create(req.merchantId, dto);
  await this.redis.set('idem:' + key, JSON.stringify(result), 'EX', 86_400);
  return result;
}`,
      },
      options: [
        'Keys are not scoped per merchant: merchant B sending key "order-1001" can receive merchant A\'s payout response, and B\'s payout is silently never created',
        'Two concurrent retries can both miss the GET and both create a payout',
        'A retry with the same key but a different amount replays the old response instead of returning 422',
        'A 24-hour TTL violates the IETF draft, which requires keys never to expire',
        'Redis GET adds more latency than creating the payout, so the check should be removed',
      ],
      correct: [0, 1, 2],
      explanation:
        'The key namespace must include the tenant (idem:{merchantId}:{key}). Otherwise clients with the same key format collide, which is both a data leak and a lost operation. GET-then-SET is check-then-act: claim the key atomically first (SET NX with an IN_PROGRESS marker, or a unique row in the payouts DB), then return 409 to concurrent duplicates. Store a request fingerprint and return 422 on a mismatch. The draft allows expiry; retention just needs to cover retry windows. Latency is not the issue.',
      followUps: [
        {
          "q": "A client's first request is still IN_PROGRESS when the retry arrives 2 s later. What should the server return, and what if the first request's pod crashed?",
          "a": "Return `409 Conflict` (the IETF draft suggests 409 for a concurrent request with the same key) with a `Retry-After`, telling the client to try again shortly; don't start a second payout. If the original pod crashed, the IN_PROGRESS marker would block forever, so give it a lease: store `started_at` with a short expiry (for example 30 s, above the operation's p99). After expiry, a retry can take over, but it must check the downstream state first (query the payout provider by the same idempotency key) to learn whether the original went through before re-executing."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-20',
      difficulty: 'medium',
      question:
        'An order saga runs: reserve inventory → send "order confirmed" SMS → charge card → create shipment. Cards are declined ~2% of the time, and customers complain about "confirmed" SMS for orders that were then cancelled. What is the simplest correct fix?',
      options: [
        'Add a compensating "sorry, your order was cancelled" SMS after a decline',
        'Move the SMS after the card charge (the pivot) and make it an idempotent, retried step',
        'Wrap the SMS and charge steps in a two-phase commit',
        'Retry the card charge up to 5 times before compensating',
      ],
      correct: [1],
      explanation:
        'A sent SMS cannot be undone, so it belongs among the retriable steps after the pivot, where the saga only moves forward. A "sorry" SMS is a semantic compensation that works but is a worse experience and doubles SMS cost. An SMS gateway cannot take part in 2PC. Declines are definitive business outcomes, so retrying them is pointless and can trigger fraud rules.',
      followUps: [
        {
          "q": "Charge succeeds but create-shipment fails for 3 hours because the shipping service is down. What does the saga do, and what does the customer see?",
          "a": "After the pivot, the saga only moves forward: it retries shipment creation with backoff and the same idempotency key until it succeeds, and does not refund. The order sits in a `PAID_AWAITING_SHIPMENT` state, which the UI shows as 'confirmed, preparing shipment'. Alert on sagas stuck past an SLA (say 30 minutes) so ops can intervene. If the business decides it can never be fulfilled, that's a new, explicit cancellation flow (refund plus inventory release), triggered by a human or policy, not an automatic compensation."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-21',
      difficulty: 'expert',
      question:
        'This trip-booking saga step reserves a hotel and a flight in parallel. The flight service rejects in 80 ms, while the hotel reservation takes 900 ms to complete. What happens?',
      code: {
        language: 'typescript',
        code: `try {
  await Promise.all([
    hotels.reserve(tripId, hotelReq),
    flights.reserve(tripId, flightReq),
  ]);
} catch (e) {
  // compensate everything
  await Promise.allSettled([hotels.cancel(tripId), flights.cancel(tripId)]);
  throw e;
}`,
      },
      options: [
        'Promise.all waits for both promises to settle before rejecting, so compensation runs after the hotel reservation completes',
        'Using allSettled for the compensations hides cancel failures, which is the main defect',
        'Promise.all rejects at 80 ms, so hotels.cancel runs while the reservation is still in flight; it finds nothing to cancel, then the reservation lands and the hold is orphaned',
        'hotels.cancel throws because the hotel reservation does not exist yet, which crashes the saga',
      ],
      correct: [2],
      explanation:
        'Promise.all rejects as soon as any input rejects, while the other call keeps running. The cancel overtakes the reserve. Fixes: wait for every forward call with allSettled, then compensate those that succeeded or are unknown. Make participants record a cancel tombstone for tripId so a late reserve is refused (the same idea as TCC\'s "cancel before try"). Swallowing cancel errors is a real smell, but it is not what orphans the hold. Whether cancel throws depends on the service, and here it silently no-ops.',
      followUps: [
        {
          "q": "Implement the 'cancel tombstone' on the hotel service side. What does reserve do when it arrives after cancel?",
          "a": "Cancel for tripId writes `reservations(trip_id, status='CANCELLED')` even if nothing exists yet: an upsert that creates a tombstone. Reserve does `INSERT INTO reservations (trip_id, status) VALUES ($1, 'HELD') ON CONFLICT (trip_id) DO NOTHING` and checks the result: if a row already existed with status CANCELLED, it refuses (returns 'cancelled') and holds no room. Ordering no longer matters, because whichever arrives first, the end state is cancelled. Tombstones expire after a window longer than any possible late request (say 24 hours)."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-22',
      difficulty: 'hard',
      question:
        'A RegisterUser command handler rejects duplicates by running SELECT 1 FROM users_view WHERE email = $1 against the CQRS read model (projection lag p99 ≈ 800 ms), then appends UserRegistered. Two sign-ups with the same email arrive 200 ms apart. What happens, and what is the right fix?',
      options: [
        'The second is rejected, because the projection is updated synchronously before the command returns',
        'Both succeed; the projection will dedupe the two users later, so no fix is needed',
        'Both likely succeed; retry the read-model check after 1 s before appending',
        'Both likely succeed; enforce uniqueness on the write side (a unique email-reservation row or aggregate) instead of the read model',
      ],
      correct: [3],
      explanation:
        'The read model is eventually consistent by design, so it cannot be the source of an invariant. The second command checks before the first event is projected. Uniqueness must be enforced where writes are serialised: a UNIQUE constraint on an email_reservations table written in the command\'s transaction, or an email-keyed aggregate appended with an expected version. Waiting 1 s only narrows the race. A projection "deduping" leaves two accounts in the source of truth.',
      followUps: [
        {
          "q": "The user changes their email later. How does the email_reservations approach handle changes and avoid stale reservations?",
          "a": "Treat it as a transfer in the write-side transaction: insert a reservation for the new email (unique constraint rejects it if taken), update the user's email, and delete the old reservation, all atomically. If email changes go through a verification step, hold the new address as 'pending' with an expiry, releasing it if not verified in, say, 24 hours. Normalise emails (lowercase, trim; decide on Gmail dots policy) before reserving, so 'A@x.com' and 'a@x.com' conflict. The read model updates eventually, but correctness never depends on it."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-23',
      difficulty: 'hard',
      question:
        'After a consumer crash and rebalance, some cart summaries show more items and a higher total than the cart actually has. The projector below uses kafkajs with default auto-commit. What is the cause and the fix?',
      code: {
        language: 'typescript',
        code: `await consumer.run({
  eachMessage: async ({ message }) => {
    const e = JSON.parse(message.value!.toString());
    if (e.type === 'ItemAddedToCart') {
      await pg.query(
        'UPDATE cart_summary SET item_count = item_count + 1, ' +
        'total_paise = total_paise + $2 WHERE cart_id = $1',
        [e.cartId, e.pricePaise],
      );
    }
  },
});`,
      },
      options: [
        'Messages after the last committed offset were redelivered and the relative increments applied twice; store the last applied event version per cart in the same UPDATE and skip events at or below it',
        'Kafka reordered messages across partitions, so the fix is a single-partition topic',
        'The UPDATE is not wrapped in a transaction, so it can partially apply one of its two columns',
        'The publishing service should enable the idempotent producer, which removes all duplicates end to end',
      ],
      correct: [0],
      explanation:
        'Auto-commit makes this at-least-once. Anything processed after the last committed offset is replayed after a crash, and relative increments are not idempotent. Add WHERE cart_id = $1 AND last_version < $3 with SET last_version = $3 (events carry a per-cart version), or recompute absolute values. A single UPDATE statement is already atomic. Ordering across partitions is irrelevant, since each cart is keyed to one partition. The idempotent producer only removes producer-retry duplicates, not consumer redelivery.',
      followUps: [
        {
          "q": "Events for a cart don't carry a version. You can't change the producer. How do you make the projector idempotent?",
          "a": "Use the Kafka coordinates as the version: within a partition offsets are strictly increasing, and all of a cart's events are in one partition (keyed by cartId). Store `last_offset` per cart (or per partition) and apply only if the event's offset is greater: `UPDATE cart_summary SET items = items + $1, total = total + $2, last_offset = $3 WHERE cart_id = $4 AND last_offset < $3`. Caveat: if the topic is ever re-partitioned or replayed into a new topic, offsets change meaning, so reset the stored offsets when you rebuild the projection."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-24',
      difficulty: 'hard',
      question:
        'The events table has UNIQUE (stream_id, version). Two ₹800 withdrawals run this handler concurrently on an account whose balance is ₹1,000. What is the outcome?',
      code: {
        language: 'typescript',
        code: `async function withdraw(accountId: string, amountPaise: number) {
  const events = await loadEvents('account-' + accountId);   // ordered by version
  const state = events.reduce(applyEvent, { balancePaise: 0 });
  if (state.balancePaise < amountPaise) throw new Error('insufficient funds');
  await pg.query(
    'INSERT INTO events (stream_id, version, type, payload) VALUES ($1, $2, $3, $4)',
    ['account-' + accountId, events.length + 1, 'FundsWithdrawn', { amountPaise }],
  );
}`,
      },
      options: [
        'Both inserts succeed and the balance becomes −₹600, because inserts never conflict',
        'Both compute the same next version; one insert fails with a unique violation (23505), and on reload-and-retry it sees ₹200 and rejects, so no overdraft',
        'Both transactions block each other until one is aborted by deadlock detection',
        'The second insert overwrites the first event at the same version',
      ],
      correct: [1],
      explanation:
        'The unique (stream_id, version) constraint is the optimistic-concurrency check: the expected-version append. The loser gets 23505, and the handler must catch it, reload the stream and re-run the decision. With the new balance of ₹200, the retry rejects. There is no overdraft, no deadlock (a unique-index conflict makes one insert wait for the other and then fail) and no overwrite.',
      followUps: [
        {
          "q": "One merchant account gets 500 concurrent withdrawals a second. Optimistic concurrency now fails most attempts. What do you change?",
          "a": "High contention on one stream turns optimistic retries into wasted work. Options: route all commands for that account to a single in-process owner (partition commands by account id through a queue), which applies them sequentially with the aggregate cached in memory, so there are no conflicts and no reloads; batch several withdrawals into one append; or redesign the aggregate, for example reserving funds from sub-accounts or buckets that are separate streams, rebalanced periodically. Measure the conflict rate per stream and apply single-writer routing only to the hot ones."
        }
      ],
    },
    {
      id: 'misc-distributed-mcq-25',
      difficulty: 'expert',
      question:
        'A wallet aggregate is snapshotted as serialised JSON every 500 events. A refactor renames balance to availablePaise and adds heldPaise. After deploy, long-lived active wallets show wrong balances, while wallets created after the deploy are correct. What is the best fix?',
      options: [
        'Version snapshots with the aggregate\'s schema version, and ignore snapshots from other versions so those wallets rebuild from events (then re-snapshot)',
        'Rewrite the stored events in place so they use the new field names',
        'Snapshot every 50 events instead, so stale snapshots are replaced faster',
        'Disable snapshots permanently to avoid the problem',
      ],
      correct: [0],
      explanation:
        'Old snapshots have the old shape, so the new code loads them with availablePaise undefined and heldPaise missing, then folds newer events on top. New wallets have no stale snapshot. Snapshots are a disposable cache: tag them with a version, and discard or lazily rebuild mismatched ones from events (optionally with a background re-snapshot job). Editing immutable events is wrong, and the events are not the problem. More frequent snapshots still start from a bad one. Disabling snapshots makes hot wallets with millions of events slow to load.',
      followUps: [
        {
          "q": "Some wallets have 5M events, so ignoring old snapshots makes their first load take 25 s. How do you roll out the schema change without that hit?",
          "a": "Upcast the snapshot instead of discarding it: write a snapshot migration function from v1 to v2 (`availablePaise = balance`, `heldPaise = 0` or derived) and apply it when loading a v1 snapshot. Then old snapshots stay usable immediately. Also run a background job before the deploy that rebuilds or upgrades snapshots for the largest streams, so the hot accounts have v2 snapshots ready. Version every snapshot from now on and add a test that loads real v1 snapshots from production samples through the new code."
        }
      ],
    },
  ],
};

export default topic;
