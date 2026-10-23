import type { Topic } from '../../types';

const topic: Topic = {
  id: 'ds-consistency',
  phase: 'distributed',
  order: 1,
  title: 'CAP, PACELC & Consistency Models',
  subtitle:
    'What "consistent" really means across replicas: CAP as a partition-time choice, PACELC for the normal case, the model hierarchy from linearizable to eventual, quorums, anti-entropy, and conflict resolution with CRDTs.',
  estimatedMinutes: 85,
  sources: [
    'Martin Kleppmann — Designing Data-Intensive Applications, Ch 5 & 9',
    'DeCandia et al. — Dynamo: Amazon\'s Highly Available Key-value Store (2007)',
    'Daniel Abadi — Consistency Tradeoffs in Modern Distributed Database System Design (PACELC, 2012)',
    'Jepsen consistency models map (jepsen.io/consistency)',
  ],
  tags: ['cap', 'pacelc', 'linearizability', 'serializability', 'causal', 'eventual-consistency', 'quorum', 'crdt', 'merkle-tree', 'read-repair'],
  cheatSheet: [
    'CAP: when a network partition happens, a replicated system must either refuse some requests (C — linearizable) or answer with possibly stale data (A). No partition → no forced choice. "CA" is not an option for a distributed system.',
    'PACELC: if Partition → A or C; Else → Latency or Consistency. The Else half matters every day: synchronous cross-replica coordination costs latency (cross-region: 60–200 ms per round trip).',
    'Linearizability = single-copy recency guarantee on single objects (real-time order). Serializability = transactions appear in SOME serial order (no real-time promise). Both = strict serializability (Spanner).',
    'Hierarchy: linearizable > sequential > causal > PRAM/FIFO > eventual. Causal is the strongest model that stays available under partition.',
    'Session guarantees (per client): read-your-writes, monotonic reads, monotonic writes, writes-follow-reads — cheap fixes for most "I saw old data" bugs.',
    'Quorum: N replicas, write to W, read R; R + W > N ⇒ read set overlaps write set. Typical N=3, W=2, R=2. Not automatically linearizable (needs read repair before returning + no sloppy quorum).',
    'Sloppy quorum + hinted handoff (Dynamo/Riak): accept writes on stand-in nodes during failure → higher availability, but R + W > N no longer guarantees overlap.',
    'Anti-entropy: Merkle trees compare replicas in O(log n) exchanges; read repair fixes divergence on the read path. Cassandra: repair within gc_grace_seconds (10 days) or deletes resurrect.',
    'Conflicts: LWW silently drops concurrent writes (and trusts clocks); version vectors detect concurrency → siblings; CRDTs merge deterministically (G-/PN-counter, OR-set).',
    'Pick per feature: money & inventory decrement → strong (CP, single leader/consensus); likes, views, feeds → eventual; profile edits → read-your-writes; comments/chat → causal.',
  ],
  sections: [
    {
      heading: 'The problem: many copies, one truth?',
      body: `**Intuition:** as soon as data has more than one copy — replicas for durability, caches, regions — someone will read a copy that hasn't heard the latest news. A *consistency model* is the contract that says which "old news" a reader is allowed to see.

Why we replicate: **durability** (survive a disk/AZ loss), **availability** (keep serving when a node dies), **latency** (serve users from a nearby copy), **read throughput**. Every one of these introduces a window where copies disagree.

**Two families of questions interviewers mix up:**
- **Replica consistency** (this topic): do reads see the latest write to an object? (linearizable, causal, eventual…)
- **Transaction isolation**: do concurrent multi-object transactions interfere? (read committed, snapshot, serializable — see *db-fundamentals*). They meet in *strict serializability*.

**The spectrum** trades coordination (latency, availability) for simplicity of reasoning:

| Model | Reader guarantee | Coordination cost | Available under partition? |
|---|---|---|---|
| Linearizable | Sees the latest completed write, globally | Consensus/leader round trip per op | No (minority side must refuse) |
| Sequential | All see the same order, not necessarily real time | High | No |
| Causal | Sees effects after their causes | Metadata (dependencies), no global sync | **Yes** (sticky clients) |
| Session guarantees | Your own writes/reads are monotonic | Sticky routing or version tokens | Yes (mostly) |
| Eventual | Converges if writes stop | None | Yes |

**In interviews:** never say "we need strong consistency" for the whole system. Name the model per operation and justify it with a business invariant ("balance must never go negative" → linearizable decrement; "like count can lag 5 s" → eventual).`,
      diagram: `Client A: write x=2 ──▶ Leader ──async──▶ Replica 1 (x=1, gets 2 later)
Client B:            read x ─────────────▶ Replica 1 → returns x=1 (stale!)

Which answers are "allowed"?
  linearizable : only x=2 (write completed before read began)
  causal       : x=1 OK unless B already saw something caused by x=2
  eventual     : x=1 OK; must converge to 2 once writes stop`,
      keyPoints: [
        'Consistency models define which stale values readers may observe.',
        'Replica consistency ≠ transaction isolation; strict serializability combines both.',
        'Choose the model per operation from a business invariant.',
      ],
    },
    {
      heading: 'CAP, properly understood',
      body: `**Intuition:** two bank branches lose their phone line. A customer withdraws at branch 1. Branch 2 can either *refuse to serve* until the line is back (consistency) or *serve from its possibly outdated ledger* (availability). You don't get to pick "neither problem" — the line is down.

**Precise statement (Brewer 2000, proven by Gilbert & Lynch 2002):** in an asynchronous network where messages can be lost (a **partition**), a system cannot guarantee both:
- **C = linearizability** (every read returns the most recent completed write), and
- **A = every request to a non-failing node receives a non-error response** (no timeouts-as-answers).

**What people get wrong:**
1. **"Pick 2 of 3"** — partitions aren't optional in a distributed system; you can't choose "CA". The real choice is *what to do during a partition*: CP (refuse/timeout on the side that can't reach a majority/leader) or AP (answer and reconcile later).
2. **It's per operation, not per product.** One system can be CP for "reserve seat" and AP for "view seat map".
3. **CAP's A is very strict.** A CP system with 99.99% measured availability is still "not A" in CAP terms because the minority side refuses requests during a partition. And CAP's C is only linearizability — it says nothing about transactions.
4. **Latency is a partition.** A node that is "too slow" is indistinguishable from a partitioned one; your timeout converts slowness into a CAP decision.

**Examples:**

| System (default config) | During partition | Why |
|---|---|---|
| etcd, ZooKeeper, Consul KV | CP | Raft/ZAB majority; minority side can't commit |
| Single-leader Postgres + sync failover | CP-ish | Writes need the leader; isolated leader must be fenced |
| Cassandra / DynamoDB (eventual reads) | AP | Any replica can answer; reconcile via LWW/repair |
| Cassandra at QUORUM | CP-ish for that request | Fails if a quorum is unreachable |
| DNS, CDN caches | AP | Serve stale rather than nothing |

Brewer's own 2012 retrospective ("CAP Twelve Years Later") stresses the same: partitions are rare, so design explicit *partition mode* behaviour and *recovery* (reconciliation, compensation) rather than a static label.`,
      diagram: `            partition
  ┌──────────┐   ╳╳╳   ┌──────────┐
  │ Node A   │ ──╳╳╳── │ Node B   │
  │ x = 2    │   ╳╳╳   │ x = 1    │
  └──────────┘         └──────────┘
        ▲                    ▲
     write x=2           read x ?
                    CP: error / timeout (keep C)
                    AP: return 1, fix later (keep A)`,
      keyPoints: [
        'CAP is a choice made only during partitions: refuse (CP) or answer stale (AP).',
        'C in CAP = linearizability; A = every non-failing node responds — both stricter than everyday usage.',
        'Label operations, not products; plan partition mode and recovery.',
      ],
      source: 'Gilbert & Lynch (2002); Brewer — CAP Twelve Years Later (2012)',
    },
    {
      heading: 'PACELC: the trade-off you pay even without partitions',
      body: `**Intuition:** partitions are rare; latency is every request. PACELC (Daniel Abadi) says: **if P**artition, choose **A** or **C**; **E**lse (normal operation), choose **L**atency or **C**onsistency.

Keeping replicas strongly consistent requires waiting for other replicas (a quorum or the leader) on every write, and often every read. Within an AZ that's ~0.5–1 ms; across AZs 1–2 ms; across regions 30–200 ms (e.g. us-east-1 ↔ eu-west-1 ≈ 70–80 ms RTT, us-east ↔ ap-southeast ≈ 200+ ms). That's the "EL vs EC" cost.

| System | PACELC | Notes |
|---|---|---|
| DynamoDB (default reads), Cassandra, Riak | **PA/EL** | Fast local reads, eventual by default; tunable per request |
| DynamoDB strongly consistent read | PC/EC for that read | Leader replica, 2× RCU cost, single-region; global tables are async LWW by default (a multi-region strong mode exists as of 2025) |
| Spanner, CockroachDB | **PC/EC** | Consensus per range; Spanner waits out clock uncertainty (commit wait) |
| MongoDB (majority write + majority/linearizable read) | PC/EC | Default settings historically weaker; tunable |
| Yahoo PNUTS | PC/EL | Per-record master, async replicas — Abadi's example |
| Postgres with async replicas | PC/EL (primary is C, replica reads are L) | Replica reads are fast and stale |

**How to use it in design:**
- A multi-region write path that must be consistent pays a cross-region round trip per write (Spanner multi-region commits are typically tens of ms). If your SLO is p99 < 50 ms globally, you can't have EC for every write — so shard by *home region* (user's data mastered in their region), and only go global-consistent for rare operations.
- Tunable systems let you pay per request: Cassandra \`LOCAL_QUORUM\` (EC within a region, EL across), DynamoDB \`ConsistentRead: true\` only on the checkout read.`,
      code: [
        {
          language: 'typescript',
          title: 'Paying for consistency per request (DynamoDB & Cassandra)',
          code: `import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Client as Cassandra, types } from 'cassandra-driver';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-west-1' }));
const cass = new Cassandra({ contactPoints: ['10.0.0.1'], localDataCenter: 'eu-west', keyspace: 'shop' });

// Product page: eventual read, half the cost, lowest latency (PA/EL)
export const getProduct = (id: string) =>
  ddb.send(new GetCommand({ TableName: 'products', Key: { id } }));

// Checkout: must see the latest stock/price -> strongly consistent read (EC)
export const getProductForCheckout = (id: string) =>
  ddb.send(new GetCommand({ TableName: 'products', Key: { id }, ConsistentRead: true }));

// Cassandra: quorum inside the local DC only -> strong-ish locally,
// no cross-region round trip on the hot path
export async function getCart(userId: string) {
  return cass.execute(
    'SELECT * FROM carts WHERE user_id = ?',
    [userId],
    { prepare: true, consistency: types.consistencies.localQuorum });
}`,
        },
      ],
      keyPoints: [
        'Else-branch (no partition) costs are paid on every request: latency vs consistency.',
        'Cross-region consistency = cross-region RTT per operation (tens to hundreds of ms).',
        'Use tunable consistency per request; master data in a home region.',
      ],
      source: 'Abadi — PACELC (IEEE Computer, 2012)',
    },
    {
      heading: 'The consistency model ladder: linearizable → causal → eventual',
      body: `**Intuition:** stronger models behave more like "one copy on one machine"; weaker models allow more surprises but need less coordination.

**Linearizability (atomic consistency):** every operation appears to take effect instantaneously at some point between its invocation and response, consistent with *real time*. Once any read returns the new value, all later reads (by anyone) must too. Needed for: leader election locks, unique username claims, "withdraw only if balance ≥ X", compare-and-set. Implemented with a single leader + synchronous replication with fencing, or consensus (Raft/Paxos). Stale follower reads break it.

**Sequential consistency:** everyone sees operations in the *same total order* that respects each client's program order — but not necessarily real time (a read may lag behind a completed write, as long as everyone agrees on the order).

**Causal consistency:** operations that are causally related (A happened-before B: same client in order, or B read A's result) are seen in that order by everyone; concurrent operations can be seen in different orders. Classic bug it prevents: a reply to a comment visible before the comment; "remove boss from ACL, then post photo" appearing reversed. It is the **strongest model achievable while remaining available under partition** (with sticky clients). Implemented with dependency tracking: version vectors, hybrid logical clocks, MongoDB causally consistent sessions (\`afterClusterTime\`).

**PRAM / FIFO:** writes from one client seen in order by everyone; no cross-client guarantees.

**Eventual consistency:** if writes stop, replicas converge. Says nothing about what you see meanwhile — values can go backwards. **Strong eventual consistency** (CRDTs): replicas that received the same updates are in the same state, without coordination.

**Session guarantees** (Terry et al., Bayou) are per-client and cheap:
- **Read-your-writes:** you see your own updates (profile edit → reload).
- **Monotonic reads:** you never see time go backwards (refresh doesn't un-show a comment). Break it by load-balancing reads across replicas with different lag.
- **Monotonic writes:** your writes apply in order.
- **Writes-follow-reads:** your write is ordered after what you read (reply after the comment you saw).

Implement them by sticky routing to one replica, or by carrying a **version token** (LSN, HLC timestamp, DynamoDB/Cosmos session token) and only reading from replicas that have caught up to it.`,
      diagram: `Strongest ──────────────────────────────────────────────▶ Weakest
Strict serializable
     │
Linearizable ── Sequential ── Causal ── PRAM/FIFO ── Eventual
 (real time)   (one order)   (cause→    (per-writer   (converges
                              effect)     order)       eventually)
     ▲                          ▲
  needs majority/leader     strongest "available under partition"
  → unavailable in minority   (+ session guarantees: RYW, monotonic reads...)`,
      code: [
        {
          language: 'typescript',
          title: 'Read-your-writes + monotonic reads with an LSN session token (Postgres replicas)',
          code: `import type { Pool } from 'pg';

// Token travels with the user (cookie/header): "highest LSN this client has observed"
export interface Session { minLsn?: string }

export async function writeProfile(primary: Pool, s: Session, userId: string, bio: string) {
  const { rows } = await primary.query(
    'UPDATE profiles SET bio = $2 WHERE user_id = $1 RETURNING pg_current_wal_lsn() AS lsn',
    [userId, bio]);
  s.minLsn = rows[0].lsn; // pg_lsn text like '16/B374D848'
}

export async function readProfile(primary: Pool, replicas: Pool[], s: Session, userId: string) {
  for (const replica of shuffle(replicas)) {
    const { rows } = await replica.query(
      // Only answer if this replica has replayed at least what the client saw
      'SELECT p.*, pg_last_wal_replay_lsn()::text AS lsn FROM profiles p ' +
      'WHERE user_id = $1 AND ($2::pg_lsn IS NULL OR pg_last_wal_replay_lsn() >= $2::pg_lsn)',
      [userId, s.minLsn ?? null]);
    if (rows.length) {
      s.minLsn = rows[0].lsn; // ratchet forward => monotonic reads across replicas
      return rows[0];
    }
  }
  // No replica caught up: fall back to the primary (always fresh)
  const { rows } = await primary.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
  return rows[0];
}

const shuffle = <T>(a: T[]) => [...a].sort(() => Math.random() - 0.5);`,
        },
      ],
      keyPoints: [
        'Linearizable = real-time single-copy illusion; needs a leader or consensus.',
        'Causal is the strongest model that stays available during partitions.',
        'Session guarantees fix most user-visible anomalies cheaply via tokens or stickiness.',
      ],
    },
    {
      heading: 'Linearizability vs serializability (and strict serializability)',
      body: `**Intuition:** *linearizability* is about **recency of single objects** ("is this the latest value?"). *Serializability* is about **isolation of multi-object transactions** ("did concurrent transactions behave as if one-at-a-time?"). They answer different questions and are frequently confused in interviews.

| | Linearizability | Serializability | Strict serializability |
|---|---|---|---|
| Scope | Single operation on a single object | Transactions over many objects | Transactions over many objects |
| Promise | Real-time order: a read after a completed write sees it | Equivalent to *some* serial order | Equivalent to a serial order **consistent with real time** |
| Can reads be stale? | No | **Yes** — a serial order where your read is "earlier" is allowed | No |
| Where from | Distributed systems (Herlihy & Wing, 1990) | Databases (1970s concurrency control) | Both |
| Examples | etcd, ZooKeeper sync reads, a single Redis primary, CAS registers | Postgres SERIALIZABLE (SSI), MySQL SERIALIZABLE on one node | Spanner (external consistency), FoundationDB, CockroachDB (serializable + near-strict) |

**Traps:**
- A serializable database with **async read replicas** gives serializable-but-stale reads on replicas: the replica is a consistent snapshot of the past. A user can transfer money and then see the old balance on a replica — no isolation anomaly, yet not linearizable.
- **Snapshot isolation** (Postgres REPEATABLE READ, Oracle "serializable") is *not* serializable: write skew is possible (two doctors both go off call). Postgres SERIALIZABLE uses SSI to detect it and abort one transaction.
- Linearizability of individual keys doesn't compose into transactions: two linearizable counters updated in sequence don't give atomic multi-key updates.

**Spanner's trick** (preview of *ds-consensus*): TrueTime exposes clock uncertainty ε (typically single-digit ms); a transaction's commit timestamp is chosen and the leader **waits out ε** before making it visible, so timestamp order matches real-time order across the globe.

**In interviews:** "For the wallet, I need serializable transactions for the transfer invariant *and* linearizable reads of the balance for the user who just transferred — so balance reads go to the leader, not replicas."`,
      keyPoints: [
        'Linearizability: single-object recency. Serializability: transaction isolation, may be stale.',
        'Strict serializability = both; Spanner calls it external consistency.',
        'Serializable primary + async replicas = stale but consistent snapshots on replicas.',
      ],
    },
    {
      heading: 'Quorums: N, R, W, sloppy quorums and hinted handoff',
      body: `**Intuition:** if you write to a majority and read from a majority, the two groups must share at least one member — so at least one replica you read from has the latest write.

**Leaderless (Dynamo-style) replication:** each key has **N** replicas (preference list on the hash ring). A write succeeds when **W** replicas ack; a read queries **R** replicas and returns the value with the newest version. If **R + W > N**, read and write sets overlap.

| Config (N=3) | Behaviour |
|---|---|
| W=3, R=1 | Fast reads, writes fail if any replica is down |
| W=1, R=3 | Fast writes, reads fail if any replica down; durability risk |
| **W=2, R=2** | Balanced; tolerates 1 replica down for both reads and writes |
| W=1, R=1 | R+W ≤ N: fastest, eventual only |

Latency: a quorum op waits for the **W-th fastest** replica, so W=2 of 3 hides one slow node — a big tail-latency win over W=3.

**Why R + W > N is still not linearizable:**
1. **Concurrent writes** with LWW can make the "latest" ambiguous; clock skew picks the wrong winner.
2. **A write that failed** (acked by 1 of 3, returned error to client) may still be on one replica and be read later — or not.
3. **Read-during-write races:** reader 1 sees the new value from the one updated replica, reader 2 (later) hits two old replicas and sees the old value. Fix: **read repair before returning** (synchronously write back the newest value to a quorum) — ABD algorithm style; Cassandra's blocking read repair at QUORUM does this.
4. **Sloppy quorums** break the overlap entirely (below).

**Sloppy quorum + hinted handoff (Dynamo, Riak):** if some of the N "home" replicas are unreachable, write to the next healthy nodes on the ring instead, tagging the data with a *hint* ("this belongs to node C"). When C recovers, the stand-in hands the data back. This keeps writes *available* during failures (the shopping cart always accepts items), but a read quorum of home replicas might not include the stand-ins → stale reads despite R + W > N. **Cassandra** stores hints too, but hints do **not** count toward the consistency level (except \`ANY\`), so it doesn't use sloppy quorums in the Dynamo sense.

**Multi-DC:** \`LOCAL_QUORUM\` (majority in the local DC) avoids cross-region latency; \`EACH_QUORUM\` for writes that must be strong everywhere; cross-DC remains eventual for LOCAL_* reads in other regions.`,
      code: [
        {
          language: 'typescript',
          title: 'Quorum read with version comparison and blocking read repair',
          code: `interface Versioned { value: string | null; version: number } // version: e.g. HLC or counter
interface Replica {
  get(key: string): Promise<Versioned>;
  put(key: string, v: Versioned): Promise<void>; // replica keeps the higher version
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// Resolve as soon as R replicas answered (not all N): tail latency = R-th fastest
function firstK<T>(ps: Promise<T>[], k: number): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const ok: T[] = []; let failed = 0;
    ps.forEach((p) => p.then((v) => { ok.push(v); if (ok.length === k) resolve(ok); })
      .catch(() => { if (++failed > ps.length - k) reject(new Error('quorum unavailable')); }));
  });
}

export async function quorumRead(replicas: Replica[], key: string, R: number, W: number) {
  const answers = await firstK(replicas.map((r) => withTimeout(r.get(key), 50)
    .then((v) => ({ r, v }))), R);
  const newest = answers.reduce((a, b) => (b.v.version > a.v.version ? b : a)).v;

  // Blocking read repair: make sure a WRITE quorum holds 'newest' before returning,
  // so no later reader can observe an older value (prevents the "new then old" anomaly)
  const stale = answers.filter((a) => a.v.version < newest.version).map((a) => a.r);
  const upToDate = answers.length - stale.length;
  if (upToDate < W) {
    const others = replicas.filter((r) => !answers.some((a) => a.r === r));
    await firstK([...stale, ...others].map((r) => withTimeout(r.put(key, newest), 50)), W - upToDate);
  }
  return newest.value;
}`,
        },
      ],
      keyPoints: [
        'R + W > N guarantees overlap, not linearizability.',
        'Quorum latency = W-th / R-th fastest replica; W=2 of 3 hides one slow node.',
        'Sloppy quorums trade the overlap guarantee for write availability; hinted handoff heals later.',
      ],
      source: 'Dynamo paper (2007)',
    },
    {
      heading: 'Anti-entropy: read repair, Merkle trees, and why repairs are mandatory',
      body: `**Intuition:** replicas drift — a missed write, a crashed node, an expired hint. Anti-entropy is the background janitor that finds and fixes differences, and Merkle trees let it do so without shipping the whole dataset.

**Three healing mechanisms (Dynamo/Cassandra):**
1. **Hinted handoff** — heals short outages (Cassandra keeps hints for \`max_hint_window\`, default 3 hours).
2. **Read repair** — when a read notices replicas disagree, it writes the newest version back. Only fixes keys that are read.
3. **Anti-entropy repair** — periodic full comparison between replicas using **Merkle trees** (\`nodetool repair\`, Reaper for scheduling). Fixes everything, including cold keys.

**Merkle tree:** split the key range into buckets; each leaf holds a hash of its bucket's data; each parent holds the hash of its children. Two replicas compare root hashes: equal → done (one exchange). Different → recurse only into children whose hashes differ. With 2^20 leaves and a few diverged buckets, you exchange O(d × log n) hashes instead of the whole data.

**The tombstone trap (Cassandra):** a delete is a *tombstone* kept for \`gc_grace_seconds\` (default **10 days**). If a replica missed the delete and repair doesn't run within 10 days, the tombstone is purged elsewhere and the old value on the stale replica **resurrects** ("zombie data") during the next repair or read repair. Rule: every node must complete a repair more often than gc_grace_seconds.

**Operational numbers:** full repairs on multi-TB nodes can take hours and saturate disk/network — use *incremental* or subrange repairs and throttle.`,
      code: [
        {
          language: 'typescript',
          title: 'Merkle tree diff: find diverged buckets with O(log n) hash exchanges per difference',
          code: `import { createHash } from 'node:crypto';

const h = (s: string) => createHash('sha256').update(s).digest('hex');

// Build a complete binary tree bottom-up; leaves = hash of each bucket's (key,version) list
export function buildTree(buckets: string[][]): string[][] {
  let level = buckets.map((items) => h([...items].sort().join('|')));
  const levels = [level];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(h(level[i] + (level[i + 1] ?? '')));
    levels.unshift(next);           // levels[0] = root level
    level = next;
  }
  return levels;
}

// Walk both trees top-down, descending only where hashes differ
export function divergedBuckets(a: string[][], b: string[][]): number[] {
  const out: number[] = [];
  const walk = (depth: number, idx: number) => {
    if (a[depth][idx] === b[depth][idx]) return;  // identical subtree: skip entirely
    if (depth === a.length - 1) { out.push(idx); return; } // leaf = bucket to sync
    walk(depth + 1, idx * 2);
    if (idx * 2 + 1 < a[depth + 1].length) walk(depth + 1, idx * 2 + 1);
  };
  walk(0, 0);
  return out; // then stream just these buckets' rows and keep the newer versions
}`,
        },
      ],
      keyPoints: [
        'Hinted handoff heals short outages; read repair heals hot keys; Merkle repair heals everything.',
        'Merkle trees make replica comparison proportional to the differences, not the data size.',
        'Run repairs within gc_grace_seconds or deleted data comes back.',
      ],
    },
    {
      heading: 'Conflict resolution: LWW, version vectors and CRDTs',
      body: `**Intuition:** in an AP system two replicas can accept different writes to the same key at the same time. When they meet, *someone* must decide the outcome: throw one away (LWW), keep both and ask the app (siblings), or use a data type whose merge is always correct (CRDT).

**Last-Write-Wins (LWW):** attach a timestamp; the highest wins. Simple, used by Cassandra and DynamoDB global tables (default mode). Costs: **concurrent writes are silently lost**, and with clock skew a *causally later* write can lose to an earlier one from a node whose clock is fast. Fine for immutable or idempotent data (write-once keys, "last known location"), dangerous for counters, carts, balances.

**Version vectors (vector clocks per key):** each replica keeps a counter; a value carries a vector like \`{A:3, B:1}\`. Compare two versions: if one dominates (≥ in every entry) it supersedes; otherwise they're **concurrent** → keep both as **siblings** and let the application merge on the next read (Dynamo's shopping cart unioned siblings — which is why deleted items occasionally reappeared). Riak uses *dotted* version vectors to avoid sibling explosion. (Clock mechanics are covered in *ds-consensus*.)

**CRDTs (Conflict-free Replicated Data Types):** data structures whose merge is commutative, associative and idempotent, so replicas that saw the same updates converge regardless of order or duplication (*strong eventual consistency*).

| CRDT | Use | Idea |
|---|---|---|
| G-Counter | Views, likes (increment only) | Per-replica counters; value = sum; merge = element-wise max |
| PN-Counter | Likes with unlike, stock *estimates* | Two G-counters (P and N); value = P − N |
| LWW-Register | Profile field | Timestamped value; max timestamp wins (still LWW semantics) |
| OR-Set (observed-remove) | Cart, tags, group members | Adds get unique tags; remove deletes only observed tags → add wins over concurrent remove |
| RGA / sequence CRDTs | Collaborative text | Figma/Automerge/Yjs-style editing |

Redis Enterprise Active-Active, Riak data types, Azure Cosmos DB, Automerge and Yjs ship CRDTs. **Limit:** CRDTs can't enforce global invariants like "stock ≥ 0" or "unique username" — those need coordination (a leader, consensus, or escrow/quota splitting per replica).`,
      code: [
        {
          language: 'typescript',
          title: 'PN-Counter CRDT: merge is commutative, associative and idempotent',
          code: `type Counts = Record<string, number>; // replicaId -> count

export class PNCounter {
  constructor(
    private readonly replicaId: string,
    private p: Counts = {},   // increments seen per replica
    private n: Counts = {},   // decrements seen per replica
  ) {}

  increment(by = 1): void { this.p[this.replicaId] = (this.p[this.replicaId] ?? 0) + by; }
  decrement(by = 1): void { this.n[this.replicaId] = (this.n[this.replicaId] ?? 0) + by; }

  value(): number {
    const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);
    return sum(this.p) - sum(this.n);
  }

  // Element-wise max: applying the same state twice or in any order gives the same result
  merge(other: { p: Counts; n: Counts }): void {
    const max = (a: Counts, b: Counts) => {
      const out: Counts = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
      return out;
    };
    this.p = max(this.p, other.p);
    this.n = max(this.n, other.n);
  }

  state() { return { p: { ...this.p }, n: { ...this.n } }; } // gossip this to peers
}

// eu and us both accept likes during a partition, then exchange state:
// const eu = new PNCounter('eu'); const us = new PNCounter('us');
// eu.increment(); us.increment(); us.decrement();
// eu.merge(us.state()); us.merge(eu.state()); // both => 1, no lost updates`,
        },
      ],
      keyPoints: [
        'LWW is simple but silently drops concurrent writes and trusts clocks.',
        'Version vectors detect concurrency and surface siblings for app-level merge.',
        'CRDTs converge automatically but cannot enforce global invariants.',
      ],
      source: 'Dynamo paper (2007); Shapiro et al. — CRDTs (2011)',
    },
    {
      heading: 'Choosing consistency per feature (the interview move that scores)',
      body: `**Intuition:** consistency is a budget. Spend it only where a business invariant or a user-visible promise needs it, and buy latency/availability everywhere else.

**Decision questions for each operation:**
1. Is there an **invariant** that concurrent operations could violate? (balance ≥ 0, one seat per person, unique username) → needs coordination: linearizable/serializable on a single leader or consensus group.
2. Is it **user-facing right after the user's own write?** → session guarantees (read-your-writes, monotonic reads).
3. Does **order between related events** matter? → causal (chat, comments, notifications after the thing they notify about).
4. Otherwise → eventual, with a bounded-staleness SLO ("counts can lag ≤ 10 s").

| Feature | Model | Mechanism |
|---|---|---|
| Payment capture, wallet transfer | Serializable / strict | Single-leader SQL txn, idempotency keys; ledger reconciliation |
| Inventory decrement at checkout | Linearizable on the SKU | Conditional update \`qty = qty - 1 WHERE qty > 0\` on the leader, or reservations |
| Username / email uniqueness | Linearizable | Unique constraint on one leader, or CAS in etcd/DynamoDB conditional put |
| Seat / hotel room booking | Serializable per resource | Row lock or optimistic version check |
| Profile edit | Read-your-writes | Read from leader for the editor for N seconds or LSN token |
| Chat messages, comments | Causal + per-channel order | Single sequencer per channel/partition, client-side dependency |
| Likes, views, follower counts | Eventual | CRDT/aggregated counters, cache |
| Product catalog, search index | Eventual (seconds) | CDC → search/cache; strong read at checkout only |
| Feature flags, config | Eventual with monotonic reads | Push + versioned config |
| Leader election, locks | Linearizable | etcd/ZooKeeper + fencing tokens (see *ds-consensus*) |

**Multi-region pattern:** give each user/tenant a **home region** that masters their data (CP within the region), replicate asynchronously elsewhere for reads (EL). Global invariants (usernames) go to a small consensus-backed global service. That keeps p99 local while protecting the few invariants that matter.

**Say this in interviews:** "I'll make the money path strongly consistent on a single leader and accept higher latency there; everything that is a *view* of that data is eventually consistent with a staleness SLO, plus read-your-writes for the actor."`,
      diagram: `              need an invariant across concurrent writers?
                         │yes                 │no
                         ▼                    ▼
          linearizable / serializable   actor must see own write?
          (leader, consensus, locks)       │yes           │no
                                           ▼              ▼
                                 read-your-writes    order between related
                                 (token / sticky)    events matters?
                                                      │yes        │no
                                                      ▼           ▼
                                                   causal      eventual
                                                              (+ staleness SLO)`,
      keyPoints: [
        'Invariants need coordination; views of data rarely do.',
        'Read-your-writes for the actor fixes most "my change disappeared" complaints.',
        'Home-region mastering keeps latency local while keeping per-user data strongly consistent.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'ds-consistency-cc-1',
      title: 'Fix an active-active like counter that loses updates',
      context:
        'A social app runs two regions active-active. Each region keeps like counts in its local Redis and a sync job gossips counts between regions every second. During a regional network blip, a viral post showed 18K likes in one region and 21K in the other, and after the blip healed it settled at 21K — analytics says ~33K people liked it.',
      task: 'Explain why updates were lost and rewrite the replication/merge logic so that counts converge to the true total regardless of message order, duplication or partitions — and support unlikes.',
      starter: {
        language: 'typescript',
        title: 'like-sync.ts (starter)',
        code: `import Redis from 'ioredis';

const local = new Redis(process.env.LOCAL_REDIS!);
const REGION = process.env.REGION!; // 'eu' | 'us'

export async function like(postId: string) {
  await local.incr('likes:' + postId);
}
export async function unlike(postId: string) {
  await local.decr('likes:' + postId);
}

// Called every second with the other region's snapshot
export async function onRemoteSnapshot(
  snapshot: { postId: string; count: number; ts: number }[],
) {
  for (const s of snapshot) {
    const localTs = Number(await local.get('likes_ts:' + s.postId) ?? 0);
    if (s.ts > localTs) {               // last-writer-wins by wall clock
      await local.set('likes:' + s.postId, s.count);
      await local.set('likes_ts:' + s.postId, s.ts);
    }
  }
}

export async function snapshotFor(postId: string) {
  return { postId, count: Number(await local.get('likes:' + postId) ?? 0), ts: Date.now(), from: REGION };
}`,
      },
      hints: [
        'Two regions each counted independently during the blip. What does LWW do with two concurrent totals?',
        'What if each region only ever tracks and publishes its OWN contributions, and the value is derived from all regions\' contributions?',
        'Your merge must give the same result if a snapshot is applied twice or snapshots arrive out of order. Which operation on per-region counters has that property? How do you represent unlikes?',
      ],
      solution: {
        language: 'typescript',
        title: 'like-sync.ts (solution) — PN-Counter CRDT in Redis hashes',
        code: `import Redis from 'ioredis';

const local = new Redis(process.env.LOCAL_REDIS!);
const REGION = process.env.REGION!; // 'eu' | 'us' | ...

// Per post: hash P {region -> increments}, hash N {region -> decrements}
const pKey = (id: string) => 'likes:p:' + id;
const nKey = (id: string) => 'likes:n:' + id;

// Local ops only touch THIS region's slot -> never conflict with other regions
export const like = (id: string) => local.hincrby(pKey(id), REGION, 1);
export const unlike = (id: string) => local.hincrby(nKey(id), REGION, 1);

export async function likes(id: string): Promise<number> {
  const [p, n] = await Promise.all([local.hvals(pKey(id)), local.hvals(nKey(id))]);
  const sum = (xs: string[]) => xs.reduce((a, x) => a + Number(x), 0);
  return sum(p) - sum(n);
}

// Merge = element-wise MAX per region slot (commutative, associative, idempotent).
// Atomic in Redis via Lua so concurrent merges and local increments can't interleave badly.
const MERGE_MAX = \`
for i = 1, #ARGV, 2 do
  local cur = tonumber(redis.call('HGET', KEYS[1], ARGV[i]) or '0')
  local inc = tonumber(ARGV[i + 1])
  if inc > cur then redis.call('HSET', KEYS[1], ARGV[i], inc) end
end
return 1\`;

export async function onRemoteState(state: { postId: string; p: Record<string, number>; n: Record<string, number> }) {
  const flat = (c: Record<string, number>) => Object.entries(c).flatMap(([r, v]) => [r, String(v)]);
  await local.eval(MERGE_MAX, 1, pKey(state.postId), ...flat(state.p));
  await local.eval(MERGE_MAX, 1, nKey(state.postId), ...flat(state.n));
}

export async function stateFor(postId: string) {
  const [p, n] = await Promise.all([local.hgetall(pKey(postId)), local.hgetall(nKey(postId))]);
  const num = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v)]));
  return { postId, p: num(p), n: num(n) }; // gossip the whole vector, not a total
}`,
      },
      explanation: `**Why updates were lost:** both regions accepted likes during the blip (AP), producing two concurrent totals. Last-writer-wins by wall clock picked one total and discarded the other region's increments entirely — ~12K likes vanished. Wall-clock LWW also depends on clock sync, so a region with a fast clock wins even with stale data. Shipping *totals* makes this unfixable, because a total can't be merged.

**Fixes:**
- **PN-Counter CRDT:** each region increments only its own slot in two G-counters (P for likes, N for unlikes). The value is ΣP − ΣN.
- **Merge = element-wise max** per slot: applying the same state twice, out of order, or after a partition always converges to the same, correct result — no clocks needed.
- **Atomic merge in Lua** so a merge doesn't race with local \`HINCRBY\` on the same hash.
- Gossip **state vectors** (small: one entry per region), not totals.

**Still true:** the count is eventually consistent, and a user who unlikes twice in two regions is a product rule (dedupe on user_id+post_id in the likes table) — CRDT counters count operations, they don't enforce "one like per user".`,
      followUps: [
        {
          "q": "Regions are added dynamically and posts live forever. Each post's hash grows with every region that ever touched it. Is that a problem, and what would you do?",
          "a": "With a handful of regions it's negligible: a few dozen bytes per slot. It becomes a problem if 'replica' means something finer, like each app server or device, since vectors grow with every writer ever. Keep slot IDs at region granularity (servers in a region share the region's local atomic counter), and for decommissioned regions, fold their slot into a permanent 'retired' slot via a coordinated step once all regions have merged its final value. Don't remove slots without coordination, or max-merge will resurrect them."
        },
        {
          "q": "Analytics shows the CRDT total exceeds the number of distinct users who liked the post. Why, and how do you fix it without losing AP behaviour?",
          "a": "The PN-Counter counts operations: a user who likes in EU then retries or likes again in US is counted twice, and like/unlike/like sequences across regions add up. The source of truth for 'who liked' should be a per-user set — an OR-Set or a likes table keyed by (post_id, user_id) with LWW per user. The counter becomes a derived, approximate display value, periodically reconciled against the set's size. For huge posts, a HyperLogLog per region (mergeable) gives approximate distinct counts cheaply."
        }
      ],
    },
    {
      id: 'ds-consistency-cc-2',
      title: 'Make a leaderless KV client actually honour quorum semantics',
      context:
        'A team built a Dynamo-style store on 3 replicas (N=3) and advertises "strongly consistent reads" because they configured R=2, W=2. Users still report reading a value, refreshing, and seeing an older value, and a failed write sometimes "appears" later.',
      task: 'Find the bugs in the client that break the quorum guarantee, and rewrite it so reads return the newest acknowledged value, never go backwards across reads, respect timeouts, and don\'t mistake one-replica writes for success.',
      starter: {
        language: 'typescript',
        title: 'kv-client.ts (starter)',
        code: `interface Replica {
  get(k: string): Promise<{ value: string; ts: number }>;
  put(k: string, v: { value: string; ts: number }): Promise<void>;
}

export class KvClient {
  constructor(private replicas: Replica[], private R = 2, private W = 2) {}

  async put(key: string, value: string) {
    const v = { value, ts: Date.now() };          // client wall clock as version
    // fire at all replicas, resolve on the first success
    await Promise.any(this.replicas.map((r) => r.put(key, v)));
  }

  async get(key: string) {
    // first replica to answer wins
    const first = await Promise.any(this.replicas.map((r) => r.get(key)));
    return first.value;
  }
}`,
      },
      hints: [
        'How many acknowledgements do put() and get() actually wait for? What does that make R and W in practice?',
        'Even with 2 answers, which answer should a read return, and what must happen before returning so a later reader cannot see an older value?',
        'Two clients write concurrently using Date.now() from different machines. What decides the winner? What should the version be?',
      ],
      solution: {
        language: 'typescript',
        title: 'kv-client.ts (solution)',
        code: `interface Version { counter: number; writer: string } // total order: counter, then writer id
interface Stored { value: string | null; v: Version }
interface Replica {
  get(k: string): Promise<Stored>;
  put(k: string, s: Stored): Promise<void>; // replica stores only if s.v > current
}

const newer = (a: Version, b: Version) =>
  a.counter !== b.counter ? a.counter > b.counter : a.writer > b.writer;

const timeout = <T>(p: Promise<T>, ms: number) => Promise.race([p,
  new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// Resolve when k succeed; reject as soon as k becomes impossible
function quorum<T>(ps: Promise<T>[], k: number): Promise<T[]> {
  return new Promise((res, rej) => {
    const ok: T[] = []; let bad = 0;
    for (const p of ps) p.then((x) => { ok.push(x); if (ok.length === k) res(ok); },
      () => { if (++bad > ps.length - k) rej(new Error('quorum not reached')); });
  });
}

export class KvClient {
  constructor(private replicas: Replica[], private id: string, private R = 2, private W = 2, private ms = 100) {
    if (R + W <= replicas.length) throw new Error('R + W must exceed N for overlap');
  }

  private async readQuorum(key: string) {
    const rs = await quorum(this.replicas.map((r) => timeout(r.get(key), this.ms).then((s) => ({ r, s }))), this.R);
    return rs.reduce((a, b) => (newer(b.s.v, a.s.v) ? b : a)).s;
  }

  private async writeQuorum(key: string, s: Stored) {
    await quorum(this.replicas.map((r) => timeout(r.put(key, s), this.ms)), this.W);
  }

  async put(key: string, value: string): Promise<void> {
    // Phase 1: learn the highest version from a read quorum -> version is causally after it
    const cur = await this.readQuorum(key);
    // Phase 2: write a strictly higher version to a write quorum; throws if < W acks
    await this.writeQuorum(key, { value, v: { counter: cur.v.counter + 1, writer: this.id } });
  }

  async get(key: string): Promise<string | null> {
    const newest = await this.readQuorum(key);
    // Write-back ("read repair") to W replicas BEFORE returning: any later read quorum
    // overlaps this write quorum, so no reader can observe an older value afterwards.
    await this.writeQuorum(key, newest);
    return newest.value;
  }
}`,
      },
      explanation: `**Bugs in the starter:**
- \`Promise.any\` resolves on the **first** success, so the real W and R were **1**: R + W = 2 ≤ N = 3, no overlap at all.
- The first reply is returned regardless of version — a stale replica that answers fastest wins.
- A write acked by 1 replica is reported as success; a write that fails on 2 of 3 can later surface when that 1 replica is read ("failed write appears later").
- **Wall-clock versions** from different clients: skewed clocks make an older write win (LWW data loss).
- No timeouts: one hung replica stalls callers forever.

**Fixes:**
- A real \`quorum(k)\` helper that waits for exactly k successes and fails fast when k becomes impossible; timeouts per replica; constructor enforces R + W > N.
- **Logical versions** (counter + writer id) obtained by reading a quorum first, so a new write is ordered after everything it observed.
- **Read returns the newest version and writes it back to a write quorum before returning** (ABD-style), eliminating the "new then old" anomaly and making single-key reads/writes linearizable in the absence of sloppy quorums.
- Cost: reads are now two round trips (the price of linearizability in a leaderless system); an optimisation skips the write-back when all R answers already agree.`,
      followUps: [
        {
          "q": "Two clients call put() on the same key concurrently, both read counter 7 and both write counter 8 with different writer IDs. Is the result still linearizable?",
          "a": "Yes for the register: versions (8, 'a') and (8, 'b') are totally ordered by writer ID, so every replica keeps the same winner and later reads all agree. One write is effectively overwritten, which is fine for a last-writer-wins register since both were concurrent. It's not a compare-and-swap: if callers need 'update only if unchanged', ABD isn't enough — you need consensus (Paxos/Raft) or a conditional write at a single leader, because leaderless quorums can't decide between concurrent CAS attempts."
        },
        {
          "q": "How would you test this client against the starter's bugs?",
          "a": "Use in-memory fake replicas with controllable delays and failures. Tests: (1) a put that succeeds on only 1 of 3 replicas must throw; (2) make one replica stale and fastest — get() must still return the newest value; (3) interleave a slow write with two sequential reads and assert the second never returns an older version than the first; (4) a hung replica must cause a timeout, not a hang; (5) property-based tests with random delays checked by a linearizability checker such as Porcupine."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'ds-consistency-iq-01',
      difficulty: 'hard',
      question:
        'We run a shopping cart in two regions, active-active. The EU–US link goes down for 10 minutes. What should the cart do, and what happens when the link comes back?',
      whatInterviewerLooksFor: [
        'Frames CAP correctly as a partition-time choice and picks AP for the cart with a business reason',
        'Explains how concurrent cart edits are detected and merged (version vectors / OR-set)',
        'Knows the Dynamo cart anomaly (deleted items reappearing) and how CRDTs address it',
        'Keeps checkout itself on a strongly consistent path',
      ],
      modelAnswer: `### Choice during the partition: AP for the cart
An unavailable cart costs revenue immediately; a slightly wrong cart is fixable at checkout. So both regions keep accepting add/remove operations (this is exactly why Amazon built Dynamo). Users are usually pinned to their nearest region, so most carts are only edited on one side anyway.

### Detecting conflicts
Each cart carries a **version vector** \`{eu: n, us: m}\`. After the link heals, anti-entropy (replication stream + Merkle-tree repair) exchanges versions. If one version dominates, it replaces the other; if neither dominates, the edits were **concurrent**.

### Merging
- **Naive union of siblings** (Dynamo 2007) never loses an add, but a remove made on one side can be undone by the union → "deleted item reappears".
- Better: model the cart as an **OR-Set CRDT** (observed-remove): each add gets a unique tag; a remove deletes only the tags it has observed. Merge is deterministic, adds made concurrently with a remove survive (add-wins), and removes of observed items stick. Quantities as PN-counters per item, or LWW-register per item if "last quantity set" semantics are acceptable.
- **Avoid LWW on the whole cart** — it would drop every edit from one side.

### Checkout is different
Checkout needs a strongly consistent path: price, stock reservation and payment run in the user's **home region** on a leader/transactional store with idempotency keys. If the home region is unreachable, degrade: allow browsing and cart edits, but queue or block payment rather than risk double charges.

### Communicate
Show the merged cart with a subtle "we updated your cart" note if the merge changed it.`,
      followUps: [
        {
          q: 'Why not just use a globally consistent database like Spanner for carts?',
          a: 'Every cart write would pay a cross-region consensus round trip (tens to 100+ ms) and during a partition the minority side cannot write at all — poor trade for low-value, easily-merged data.',
        },
        {
          q: 'How do you garbage-collect OR-Set tombstones/tags?',
          a: 'Tags of removed elements can be discarded once all replicas have acknowledged the remove (causal stability); in practice carts are short-lived and deleted after checkout or TTL.',
        },
      ],
      pitfalls: [
        'Claiming you can have both C and A during the partition.',
        'Using last-write-wins on the whole cart object.',
        'Making checkout eventually consistent too.',
      ],
    },
    {
      id: 'ds-consistency-iq-02',
      difficulty: 'medium',
      question:
        'Is PostgreSQL with one primary and two async read replicas a CP or an AP system?',
      whatInterviewerLooksFor: [
        'Refuses the binary label and reasons per operation and per failure mode',
        'Uses PACELC for the normal case',
        'Explains what happens to writes and reads during a partition and a failover',
        'Knows async failover can lose acknowledged writes',
      ],
      modelAnswer: `### It depends on which operation and which failure
CAP labels apply to *behaviour during a partition*, per operation:

- **Writes** go only to the primary. If a client is partitioned from the primary, its writes fail → **CP-like** for writes (no availability on the far side).
- **Reads from the primary** are linearizable in steady state.
- **Reads from async replicas** remain available when the primary is unreachable but return stale data → **AP-like** for those reads, and they're not linearizable even without a partition.

### PACELC view (normal operation)
Primary reads/writes: consistency (EC). Replica reads: latency and offload at the cost of staleness (EL). So: PC/EL overall, if you must label it.

### Failover is where it gets subtle
With **async replication**, promoting a replica after the primary dies can **lose acknowledged writes** that hadn't replicated — a C violation from the client's point of view. And if the old primary is only partitioned, not dead, you risk **split brain** (two primaries) unless you fence it (STONITH, Patroni's DCS leader key with TTL, fencing via the load balancer).

### Making it more CP
- \`synchronous_commit = on\` with \`synchronous_standby_names = 'ANY 1 (r1, r2)'\`: a commit waits for one replica to flush WAL, so failover to that replica loses no acknowledged commit. Cost: +1 intra-region RTT per commit; if no sync replica is available, writes block (the CP choice).
- Consensus-managed failover (Patroni + etcd) to prevent split brain.

### One-liner
"A single-leader system with async replicas is CP for writes, AP-and-stale for replica reads, and can lose acknowledged writes on failover unless replication is synchronous."`,
      followUps: [
        {
          q: 'What does synchronous_commit = remote_apply add over on?',
          a: 'The commit waits until the standby has applied (replayed) the WAL, not just flushed it, so reads on that standby immediately see the commit — read-your-writes on that replica, at more latency.',
        },
        {
          q: 'How does Patroni prevent two primaries?',
          a: 'The leader holds a TTL key in etcd/Consul/ZooKeeper; a primary that cannot renew the key demotes itself, and replicas only promote after acquiring the key — consensus decides the single leader.',
        },
      ],
      pitfalls: [
        'Answering "CA" or giving one label with no qualification.',
        'Forgetting that async failover can lose acknowledged writes.',
        'Treating replica reads as strongly consistent.',
      ],
    },
    {
      id: 'ds-consistency-iq-03',
      difficulty: 'medium',
      question:
        'Users complain: "I changed my display name, the page reloaded, and it showed my old name. Then it flipped back and forth for a few seconds." What is happening and how do you fix it without routing all reads to the primary?',
      whatInterviewerLooksFor: [
        'Names the two violated guarantees: read-your-writes and monotonic reads',
        'Explains the mechanism (replicas with different lag, load-balanced reads, caches)',
        'Proposes targeted fixes: version tokens, sticky reads, primary-for-actor window, cache invalidation',
        'Keeps the cost low (no global strong consistency)',
      ],
      modelAnswer: `### Diagnosis
Two session guarantees are broken:
- **Read-your-writes:** the reload read from a replica (or cache) that hadn't applied the update.
- **Monotonic reads:** the "flip back and forth" means consecutive reads hit replicas with *different* lag (round-robin across replicas), so the user moved backward in time.
Also check caches: a CDN/Redis entry written from a stale replica read can pin the old value for the TTL.

### Fixes, cheapest effective first
1. **Version token:** after the write, return the commit LSN / HLC timestamp to the client (cookie/header). Reads carry it; a replica serves the read only if it has replayed ≥ that position, else the router tries another replica or the primary. Ratchet the token forward on each read → monotonic reads too.
2. **Actor-window routing:** for N seconds after a user writes (N > p99 lag, say 5–10 s), route *that user's* reads of *their own* data to the primary. Everyone else keeps using replicas.
3. **Sticky replica per session:** hashing the user to one replica gives monotonic reads (not read-your-writes) cheaply.
4. **Cache discipline:** on update, delete (not set) the cache key after commit; populate caches only from the primary or from reads that satisfied the token; short TTL for profile fragments.
5. **Client-side:** optimistic UI shows the new name immediately.

### Cost
Only the small fraction of reads right after a user's own write hit the primary. Global data stays eventually consistent for other viewers (a friend seeing the old name for 2 seconds is fine).

### Monitoring
Track replica lag p99 and the rate of token-fallback-to-primary; if fallbacks spike, lag is the real problem.`,
      followUps: [
        {
          q: 'The write goes to one region and the reload lands in another region. Now what?',
          a: 'Tokens still work if they are comparable across regions (HLC/commit timestamps); otherwise route the user to their home region for a window after writes, or pin sessions to a region.',
        },
        {
          q: 'How does DynamoDB or Cosmos DB expose this?',
          a: 'DynamoDB: ConsistentRead for the actor\'s reads (single region). Cosmos DB: "session" consistency level with a session token passed by the SDK — exactly read-your-writes + monotonic reads.',
        },
      ],
      pitfalls: [
        'Routing all reads to the primary.',
        'Adding sleep/retry on the client.',
        'Forgetting that the cache can reintroduce stale values.',
      ],
    },
    {
      id: 'ds-consistency-iq-04',
      difficulty: 'expert',
      question:
        'Our Cassandra cluster has RF=3 and every read and write uses QUORUM. We still see occasional stale reads and even a value that went backwards. R + W > N — how is that possible?',
      whatInterviewerLooksFor: [
        'Lists concrete mechanisms: LWW with clock skew, partially-failed writes, read-during-write races, multi-DC LOCAL vs global quorums',
        'Knows Cassandra timestamp semantics (client/coordinator timestamps, LWW per cell)',
        'Knows the tombstone/gc_grace zombie problem',
        'Proposes fixes: LWT/Paxos for CAS, idempotent design, clock discipline, repair',
      ],
      modelAnswer: `### R + W > N only guarantees overlap, not linearizability
Several real mechanisms produce stale or backwards reads:

1. **LWW + clock skew.** Cassandra resolves conflicts per cell by write timestamp (client- or coordinator-assigned). If two app servers write the same cell and one clock is 300 ms fast, its *earlier* write carries the higher timestamp and wins; the later write is silently shadowed → looks stale forever.
2. **Failed writes aren't rolled back.** A QUORUM write that reached 1 of 3 replicas returns a timeout to the client, but that replica keeps the value. A later QUORUM read that includes it returns the "failed" value; one that doesn't returns the old one → flip-flopping.
3. **Read during an in-flight write.** Reader A's quorum includes the one replica that already has the new value (newest wins → new); reader B slightly later hits two not-yet-updated replicas → old. Cassandra's blocking read repair at QUORUM mitigates this for the repaired key, but only when digests mismatch within the read's replica set.
4. **Consistency level mismatch.** Some code path uses \`LOCAL_QUORUM\` or \`ONE\` (driver default is often LOCAL_ONE), or reads in another DC with LOCAL_QUORUM while writes were LOCAL_QUORUM in the first DC — no cross-DC overlap.
5. **Zombie data.** A replica missed a delete, repair didn't run within \`gc_grace_seconds\` (10 days), tombstones got purged elsewhere, and the old value came back.

### Fixes
- Audit consistency levels in every driver config; set explicit defaults.
- **NTP/chrony discipline** and, where possible, avoid multi-writer updates to the same cell; model data as immutable inserts (event rows keyed by time/UUID) rather than overwrites.
- For true compare-and-set (unique username, state machine transitions), use **lightweight transactions** (\`IF NOT EXISTS\`, \`IF version = ?\`) which run Paxos at SERIAL/LOCAL_SERIAL — ~4 round trips, so only where needed.
- Treat write timeouts as "unknown outcome": retry idempotently with the same timestamp/value.
- Schedule repairs (Reaper) well within gc_grace_seconds.`,
      followUps: [
        {
          q: 'Would ALL for writes and ONE for reads fix it?',
          a: 'It satisfies R + W > N but makes every write fail when any replica is down, and still suffers LWW skew and failed-write residue. It trades availability for little real gain.',
        },
        {
          q: 'Why are LWTs expensive?',
          a: 'Each one runs a Paxos round (prepare/promise, read, propose/accept, commit) across replicas — roughly 4 round trips versus 1 for a normal write — and contends on hot partitions.',
        },
      ],
      pitfalls: [
        'Insisting R + W > N implies strong consistency.',
        'Ignoring client-side timestamp skew.',
        'Retrying a timed-out write with a new timestamp and a different value.',
      ],
    },
    {
      id: 'ds-consistency-iq-05',
      difficulty: 'hard',
      question:
        'Design the consistency model for an e-commerce platform: catalog, search, cart, inventory, checkout/payment, order history, reviews, and "people also bought". Justify each choice.',
      whatInterviewerLooksFor: [
        'Different model per feature, tied to invariants and user expectations',
        'Identifies inventory and payment as the coordination hot spots and how to keep them cheap',
        'Uses read-your-writes where the actor needs it',
        'Gives staleness budgets and mechanisms, not just labels',
      ],
      modelAnswer: `### Principle
Coordinate only where an invariant can be violated by concurrent actors; everything else is a view with a staleness budget.

| Feature | Model | Mechanism & reason |
|---|---|---|
| Catalog (price, description) | Eventual, ≤ 1–5 min for description; price re-checked at checkout | CDN/cache + CDC; a stale description harms nobody |
| Search | Eventual, ≤ 30 s | CDC → Elasticsearch; search is a view |
| Cart | AP, mergeable (OR-set), read-your-writes for owner | Must always accept edits; owner sees own changes via home-region routing |
| Inventory at checkout | **Linearizable per SKU** | \`UPDATE stock SET qty = qty - $n WHERE sku = $1 AND qty >= $n\` on the SKU's leader; or reservation rows with TTL; hot SKUs → bucketed stock |
| Inventory on product page | Eventual ("only 3 left" can lag) | Cached count; never used to decide the sale |
| Checkout / payment | **Serializable** + idempotency | Single-leader SQL transaction for order + reservation + payment intent; idempotency key per checkout; reconciliation with PSP |
| Order history | Read-your-writes for the buyer, eventual otherwise | Immediately after purchase read from primary/LSN token; later from replicas |
| Reviews & ratings | Eventual; average rating via CRDT/aggregation | Moderation pipeline async; author sees own review immediately |
| Recommendations | Eventual, hours | Batch/stream ML pipeline |

### Keeping the strong parts cheap
- Partition inventory and orders by SKU/order so each strongly consistent operation touches **one leader** (no distributed transaction on the hot path).
- For flash sales, pre-split a SKU's stock into N buckets or reserve via Redis Lua and persist asynchronously with reconciliation.
- Multi-region: each order is mastered in the buyer's home region; inventory for a warehouse is mastered in that warehouse's region.

### Failure behaviour
If the inventory leader is unreachable, checkout for that SKU fails fast ("try again") rather than overselling (CP); browsing and carts remain fully available (AP).`,
      followUps: [
        {
          q: 'Business says overselling by up to 0.5% is acceptable for big sales. What changes?',
          a: 'You can go AP on the decrement: per-region/per-node stock quotas (escrow), local decrements without coordination, periodic rebalancing, and compensate oversells with apologies/backorders.',
        },
        {
          q: 'Price changed between add-to-cart and checkout. What do you do?',
          a: 'Checkout re-reads price from the authoritative store (strong read), and if it differs shows the new price for confirmation; the cart\'s cached price is only a hint.',
        },
      ],
      pitfalls: [
        'Declaring the whole platform strongly consistent (or eventually consistent).',
        'Deciding stock availability from a cached count.',
        'Using a distributed transaction across services for every checkout.',
      ],
    },
    {
      id: 'ds-consistency-iq-06',
      difficulty: 'expert',
      question:
        'Our wallet service runs Postgres at SERIALIZABLE isolation. A user transferred ₹5,000 and immediately saw their old balance. The team says "impossible, we\'re serializable". Explain.',
      whatInterviewerLooksFor: [
        'Clearly separates serializability from linearizability',
        'Identifies replica reads or caches as the source',
        'Explains that serializable permits stale reads in theory, and what strict serializability adds',
        'Proposes a correct design for balance reads',
      ],
      modelAnswer: `### Serializable ≠ fresh
**Serializability** promises that concurrent transactions produce a result equivalent to *some* serial order. It says nothing about real time: a read-only transaction ordered "before" the transfer is still a valid serial history. **Linearizability** (and, for transactions, **strict serializability**) adds the real-time constraint: once the transfer committed, every later read must see it.

On a single Postgres primary, SSI in practice reads the latest committed snapshot, so the stale read almost certainly came from somewhere *outside* the primary's transaction:
1. **Async read replica.** The balance endpoint reads from a replica that is 300 ms behind. The replica shows a perfectly consistent, serializable snapshot — of the past.
2. **Cache.** Balance cached in Redis and invalidated asynchronously (or set from a replica read).
3. **Another region's copy.**
4. Less commonly, a read-only transaction that started before the transfer committed (snapshot taken earlier).

### Fix for a wallet
- **Balance reads for the account owner go to the leader** (or wait on an LSN token), not replicas — the owner's view must be linearizable after their own transfer.
- **The transfer itself** stays SERIALIZABLE (or uses \`SELECT … FOR UPDATE\` on both accounts in a consistent order) with an idempotency key.
- **Cache**: either don't cache balances, or update/invalidate synchronously in the same code path after commit, with the LSN/version to avoid older overwrites.
- **Displayed history** (list of transactions) may come from replicas with a "pending" state for just-submitted transfers.

### Architecture note (classic digital wallet design)
At scale, wallets use event sourcing: the command is validated and appended to a log, the balance is a projection. Reads from the projection are eventually consistent; for the owner you read your own position (event sequence number) — the same token idea.`,
      followUps: [
        {
          q: 'Does Postgres SERIALIZABLE on replicas help?',
          a: 'SERIALIZABLE is not allowed on hot standbys (only up to REPEATABLE READ); and even if it were, the replica would still be behind the primary.',
        },
        {
          q: 'What guarantee does Spanner give here?',
          a: 'External consistency (strict serializability): if the transfer commits before the read starts, the read sees it anywhere in the world, enforced by TrueTime commit-wait.',
        },
      ],
      pitfalls: [
        'Saying serializable implies reads always see the latest write.',
        'Blaming the isolation level and switching to a "stronger" one.',
        'Serving balances for money movement from caches or replicas.',
      ],
    },
    {
      id: 'ds-consistency-iq-07',
      difficulty: 'hard',
      question:
        'You are building a view counter for videos: 2M increments/s at peak across 3 regions, and the count shown can be a bit behind. Design the replication and conflict handling.',
      whatInterviewerLooksFor: [
        'Chooses eventual consistency with a stated staleness budget',
        'Uses aggregation + CRDT-style merge rather than per-increment coordination',
        'Handles hot keys (viral videos) and idempotency/dedup of events',
        'Estimates numbers',
      ],
      modelAnswer: `### Requirements
- 2M increments/s globally, 3 regions; displayed count stale by ≤ ~10 s; never go backwards; no double counting from retries (approximately — views are business metrics, so exactness matters for creator payouts later, handled offline).

### Design
1. **Local ingest per region.** View events go to a regional Kafka topic keyed by video_id (idempotent producer; event_id for dedup in the offline pipeline).
2. **Stream pre-aggregation.** A Flink/Kafka Streams job sums increments per video per 1-second window: 2M events/s collapse to (#active videos) updates/s — maybe 100K/s. Hot (viral) videos are no problem because the aggregator already combines them in memory; salt keys across partitions if one video exceeds a partition's throughput.
3. **Per-region G-Counter state.** Each region maintains its own slot per video: \`views[video][region]\`. It only ever increases its own slot by adding window sums.
4. **Cross-region merge.** Regions replicate their slots asynchronously (Kafka MirrorMaker or DB replication); merge = **max per region slot**, value = sum of slots. Idempotent and order-insensitive, so replays and partitions are harmless; counts only grow, so monotonic reads hold per replica.
5. **Serving.** Counts stored in a KV store (Cassandra/DynamoDB/Redis) and cached at the edge with a 5–10 s TTL.

### Why not a single global counter
2M increments/s on one row/key is impossible, and cross-region coordination per increment adds 100+ ms. LWW would lose whole regions' increments.

### Exactness
The real-time counter is approximate-but-monotonic; the authoritative number for payouts is recomputed in batch from the deduplicated event log (classic ad-click aggregation uses the same lambda/kappa reconciliation).`,
      followUps: [
        {
          q: 'How do you avoid counting a retried event twice in the real-time path?',
          a: 'Idempotent/transactional Kafka producers and exactly-once stream processing (Flink checkpoints + transactional sinks) keep the pipeline itself exact; client-level duplicates are deduped in the batch path by event_id.',
        },
        {
          q: 'A region is down for an hour and comes back. What happens to its counts?',
          a: 'Its slot simply stops growing; the others keep counting. When it returns it replays its local log and republishes its slot; max-merge integrates it without double counting.',
        },
      ],
      pitfalls: [
        'Incrementing a global row per view.',
        'Using LWW to merge region totals.',
        'Promising exact real-time counts.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'ds-consistency-boe-1',
      question:
        'Compare write availability of N=3 replicas with W=3 vs W=2 (quorum), and the latency of a quorum write when replicas span 3 AZs vs 3 regions.',
      assumptions: [
        'Each replica is independently available 99.9% of the time (p = 0.999)',
        'Intra-region cross-AZ RTT ≈ 1 ms; replicas in us-east, us-west, eu-west with RTTs from us-east of ~65 ms (us-west) and ~75 ms (eu-west)',
        'Coordinator sits in us-east alongside one replica (local write ≈ 0.5 ms)',
      ],
      steps: [
        { label: 'W=3 availability', calc: 'p³ = 0.999³ ≈ 0.997 → ~26 hours/year of failed writes' },
        { label: 'W=2 availability', calc: 'P(≥2 of 3 up) = 3p²(1−p) + p³ = 3(0.998)(0.001) + 0.997 ≈ 0.999997 → ~1.6 min/year' },
        { label: 'Quorum write latency, 3 AZs', calc: 'wait for 2nd-fastest ack: local 0.5 ms and next AZ ~1 ms → ≈ 1–2 ms' },
        { label: 'Quorum write latency, 3 regions', calc: 'local ack 0.5 ms, second ack = min(65, 75) ≈ 65 ms → ≈ 65 ms per write' },
        { label: 'W=3 across regions', calc: 'waits for the slowest: ≈ 75 ms, and fails if any region is unreachable' },
      ],
      answer:
        'W=2 of 3 raises write availability from ~99.7% to ~99.9997% and hides the slowest replica; cross-region quorums cost ~65 ms per write vs ~1–2 ms across AZs.',
      insight:
        'Majority quorums are the sweet spot for availability and tail latency. But placement decides latency: keep the consistent quorum within one region (3 AZs) and replicate cross-region asynchronously, unless the business truly needs global strong writes and can afford ~65–150 ms per write.',
      followUps: [
        {
          "q": "Replicas are only 99% available (cheap hardware, frequent deploys), not 99.9%. Redo the W=2 vs W=3 comparison.",
          "a": "W=3: 0.99³ ≈ 0.9703, about 260 hours/year of failed writes — unusable. W=2: 3p²(1−p) + p³ ≈ 0.9997, about 2.6 hours/year. Lower replica availability makes the gap between all-replica and majority writes much larger. In practice failures are correlated (deploys, shared racks), so the independence assumption flatters both; stagger deploys and spread replicas across fault domains so the math holds."
        },
        {
          "q": "Someone proposes N=5, W=3 across the same 3 AZs for 'extra availability'. Is it worth it?",
          "a": "Mathematically, with independent p = 0.999, P(≥3 of 5 up) ≈ 0.99999999 — about 0.3 seconds/year of unavailability, versus ~1.6 minutes for N=3/W=2. But with 5 replicas in 3 AZs, one AZ must hold 2 replicas; losing that AZ leaves 3, which still meets W=3, so AZ tolerance is preserved. Costs: 67% more storage and write traffic, and the quorum ack is now the 3rd fastest of 5. Worth it only if correlated node failures inside AZs are your main risk."
        }
      ],
    },
    {
      id: 'ds-consistency-boe-2',
      question:
        'A Cassandra-style node stores 1 billion keys (~1 TB). How big should the Merkle tree be, and how much data must be exchanged to repair 5,000 diverged keys, compared with shipping everything?',
      assumptions: [
        'Tree depth 20 → 2^20 ≈ 1M leaves; each hash 32 bytes (SHA-256)',
        'Keys evenly spread: ~1,000 keys (~1 MB of data) per leaf',
        'Diverged keys land in ~5,000 distinct leaves (worst case)',
        'Replicas exchange hashes level by level only for differing subtrees',
      ],
      steps: [
        { label: 'Tree size', calc: '~2 × 2^20 nodes × 32 B ≈ 64 MB per replica (built by scanning data)' },
        { label: 'Hashes exchanged per diverged leaf', calc: 'path of 20 levels × 2 children × 32 B ≈ 1.3 KB (shared upper levels make it less)' },
        { label: 'Hash exchange total', calc: '5,000 × 1.3 KB ≈ 6.4 MB (upper bound)' },
        { label: 'Data streamed for diverged leaves', calc: '5,000 leaves × ~1 MB ≈ 5 GB' },
        { label: 'Naive full comparison', calc: 'ship/compare 1 TB' },
      ],
      answer:
        '~64 MB tree; ~6 MB of hashes plus ~5 GB of leaf data to repair, versus ~1 TB naive — about 200× less.',
      insight:
        'Leaf granularity drives repair cost: with 1 MB leaves, a single diverged key costs streaming 1 MB. Deeper trees (or subrange repairs) cut overstreaming but cost more memory and build time — which is why Cassandra repairs subranges and why frequent incremental repairs are cheaper than rare full ones.',
      followUps: [
        {
          "q": "Overstreaming 1 MB per diverged key is too wasteful. What if you deepen the tree to 2^24 leaves?",
          "a": "The tree grows to ~2 × 2^24 × 32 B ≈ 1.07 GB per replica (vs 64 MB), costing memory and build time. Each leaf then covers ~60 KB of data, so 5,000 diverged keys stream ~0.3 GB instead of ~5 GB. The usual compromise is to repair smaller subranges (many smaller trees built one at a time) so memory stays bounded while each leaf covers less data, which is exactly what subrange repair in Cassandra does."
        },
        {
          "q": "Repair keeps finding the same 5,000 diverged keys every night. What does that tell you, and what do you investigate?",
          "a": "Divergence should be rare after a repair; steady divergence means writes are continuously failing to reach some replica. Check dropped mutations (`nodetool tpstats` MUTATION dropped), hint delivery failures, a node with a slow disk timing out writes at CL=QUORUM (so only 2 of 3 replicas get them), or clock-skewed writes being shadowed. Fix the root cause, and increase repair frequency in the meantime so entropy is bounded."
        }
      ],
    },
    {
      id: 'ds-consistency-boe-3',
      question:
        'A global payments company wants every balance update strongly consistent across 3 regions (US, EU, India). Estimate the latency floor and throughput of a hot account, and propose an alternative.',
      assumptions: [
        'Consensus (Raft/Paxos) leader in us-east; followers in eu-west (~75 ms RTT) and ap-south/Mumbai (~190 ms RTT)',
        'Commit needs a majority: leader + 1 follower',
        'Client in India writes to the US leader (~190 ms RTT client→leader)',
        'Operations on the same account are serialized (one in flight per account for strict ordering)',
      ],
      steps: [
        { label: 'Leader commit latency', calc: 'majority = fastest follower ack ≈ 75 ms (EU)' },
        { label: 'India client end-to-end', calc: '190 ms (to leader and back) + 75 ms commit ≈ 265 ms per write' },
        { label: 'Hot account throughput if serialized', calc: '1 ÷ 0.075 s ≈ 13 commits/s per account (pipelining/batching can raise it)' },
        { label: 'With home-region leaders', calc: 'Indian accounts led from Mumbai with 3 local AZ replicas: commit ≈ 2 ms; client RTT ≈ 20–40 ms' },
      ],
      answer:
        'A single global leader implies ~75 ms commit floor and ~265 ms for Indian users, ~13 serialized commits/s per hot account; home-region leadership cuts commits to ~2 ms.',
      insight:
        'Global strong consistency is bounded by the speed of light. Partition by account home region so each account\'s consensus group is local (CP within region), replicate asynchronously for DR, and use a cross-region protocol (saga/2PC with reconciliation) only for the rare cross-region transfer.',
      followUps: [
        {
          "q": "The hot account is a merchant receiving 2,000 payments/s, all in India. Home-region leadership gives 2 ms commits. Is that enough?",
          "a": "Serialized one-at-a-time, 2 ms commits give ~500 commits/s, below 2,000/s. Batch: group many credits into one log entry (e.g. 100 per batch → each 2 ms commit handles 100, so ~50,000/s theoretical). Or split the account into sub-ledgers (e.g. 16 shards, each a separate row/consensus group) that are summed for reads, since credits commute. Debits still need to check a total, so route them through a reservation or periodically sweep shards into the main balance."
        },
        {
          "q": "An Indian user sends money to a US user. Both accounts are home-region led. How do you transfer without a cross-region distributed transaction on the hot path?",
          "a": "Use a saga with an outbox. In India, atomically debit the sender and write a 'transfer-out' outbox record (local commit, ~2 ms). A relay delivers it to the US region, which credits the receiver idempotently keyed by transfer ID. Money in flight sits in a clearing account, so ledgers always balance. If the US credit fails permanently (account closed), a compensating credit refunds the sender. Users see 'pending' for the ~100–200 ms cross-region hop, and reconciliation checks clearing balances net to zero."
        }
      ],
    },
  ],
  test: [
    {
      id: 'ds-consistency-mcq-01',
      difficulty: 'hard',
      question:
        'A 5-node etcd cluster is split 3 | 2 by a network partition. Clients are connected to both sides. What happens?',
      options: [
        'The 3-node side can elect/keep a leader and commit writes; the 2-node side cannot commit writes and linearizable reads there fail or time out',
        'Both sides keep accepting writes and reconcile with last-write-wins after healing',
        'The whole cluster stops accepting writes until the partition heals to protect consistency',
        'The 2-node side accepts writes into a queue and replays them after healing',
      ],
      correct: [0],
      explanation:
        'etcd is CP: progress requires a majority (3 of 5). The majority side continues normally; the minority side refuses to commit and, for linearizable reads, times out — sacrificing availability there to keep consistency. It does not stop the whole cluster (that would be needlessly unavailable) and never runs dual-writer LWW or queues writes for replay.',
      followUps: [
        {
          "q": "The old leader was on the 2-node side. A client wrote to it just before the split and got no response. Was the write committed?",
          "a": "Unknown to the client. If the leader had replicated the entry to at least 2 followers on the majority side before the split, it is committed (or will be, since the new leader must contain it, by Raft's election restriction). If it only reached the minority side, it will be discarded when the old leader steps down and rejoins as a follower. The client must treat the timeout as 'outcome unknown' and retry idempotently, e.g. with a request ID or a compare-and-swap on the expected revision."
        },
        {
          "q": "Your service on the minority side only needs to read config from etcd and can tolerate slightly stale data. How do you keep it working during the partition?",
          "a": "Use serializable (non-linearizable) reads: `etcdctl get --consistency=s` or `serializable: true` in the client. These are answered from the local member's state without a quorum round trip, so they work on the minority side but may be stale by however long the partition lasts. Better still, cache config in the service via a watch and keep serving the last known value, exposing its age as a metric. Writes, leases and locks still need the majority, so anything doing leader election must fail closed."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-02',
      difficulty: 'medium',
      question:
        'An architect says: "Our system is CA — we use a single region, so partitions won\'t happen." What is the best rebuttal?',
      options: [
        'CA is fine as long as you add read replicas',
        'CA is only impossible for NoSQL databases',
        'Partitions (lost/delayed messages, switch failures, GC pauses causing timeouts) happen within a region too; a distributed system must still decide between C and A when they do',
        'CAP stops applying below 3 replicas',
      ],
      correct: [2],
      explanation:
        'Any system with more than one node communicating over a network can experience partitions — including within a datacenter — and timeouts make slow nodes look partitioned. So "CA" really means "undefined behaviour during partitions". CAP applies regardless of data model or replica count; adding replicas increases, not removes, the need to choose.',
      followUps: [
        {
          "q": "The architect replies: 'Fine, but our partitions last milliseconds.' How does PACELC reframe the conversation?",
          "a": "PACELC says that even with no partition (the 'E' branch) you choose between latency and consistency on every request. In one region a synchronous replica costs ~1 ms per write; that's the everyday cost, and it's what the team should decide on. The partition branch still matters for rare but long events: a misconfigured switch or a stuck GC can make a node unreachable for tens of seconds, and the system must have a defined behaviour (refuse writes, or accept and reconcile) for those."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-03',
      difficulty: 'expert',
      question:
        'Which histories are allowed under linearizability for a single register initially 0? Select ALL that apply.',
      code: {
        language: 'text',
        code: `Time ─────────────────────────────────────────────▶
H1: A: write(1) [t1 ──── t3]      B: read → 0 [t2 ─ t2.5]
H2: A: write(1) [t1 ─ t2]         B: read → 0 [t3 ─ t4]
H3: A: write(1) [t1 ──── t5]      B: read → 1 [t2 ─ t3]   C: read → 0 [t4 ─ t4.5]
H4: A: write(1) [t1 ──── t5]      B: read → 1 [t2 ─ t3]   C: read → 1 [t4 ─ t4.5]
(t1 < t2 < t2.5 < t3 < t4 < t4.5 < t5)`,
      },
      options: ['H1', 'H2', 'H3', 'H4'],
      correct: [0, 3],
      explanation:
        'H1: B\'s read overlaps the write, so it may linearize before it and return 0. H2 is illegal: the write completed at t2 before B\'s read started at t3, so B must see 1. H3 is illegal: once B has returned 1 (at t3), a later read by C (starting t4) cannot go back to 0 even though the write is still in flight. H4 is fine: both reads linearize after the write\'s effect point.',
      followUps: [
        {
          "q": "How would you actually test that your key-value service is linearizable, rather than reasoning about four hand-drawn histories?",
          "a": "Record real histories under fault injection and check them. Run concurrent clients doing reads, writes and CAS on a few keys while a nemesis partitions nodes, kills leaders and skews clocks; log each operation's invocation and completion time and result (timeouts as indeterminate). Feed the history to a checker such as Knossos or Porcupine (Jepsen-style), which searches for a valid linearization. Keep keys few and histories short, since the check is NP-complete in general."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-04',
      difficulty: 'medium',
      question:
        'A social app shows a reply before the comment it replies to for some users. Which consistency model, if provided, prevents exactly this class of anomaly with the least coordination?',
      options: [
        'Linearizability',
        'Eventual consistency with faster replication',
        'Monotonic reads',
        'Causal consistency',
      ],
      correct: [3],
      explanation:
        'The reply causally depends on the comment (the author read it before replying); causal consistency guarantees everyone sees causes before effects, and it can be provided without global coordination (even under partition with sticky clients). Linearizability also prevents it but requires consensus/leader round trips. Monotonic reads only stops one client going backwards; faster replication shrinks but doesn\'t eliminate the window.',
      followUps: [
        {
          "q": "Your comments are stored in a multi-region store with async replication. How do you actually deliver causal consistency for replies without a global leader?",
          "a": "Carry dependencies explicitly. When a user posts a reply, attach the comment ID (or a version vector / hybrid logical clock of what they had seen). A region only makes the reply visible once the parent is applied locally; otherwise it buffers it. The cheap version is application-level: the reply stores parent_id and the read path hides replies whose parent isn't present yet. Stores like MongoDB causal sessions or COPS-style systems do this generically with dependency metadata."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-05',
      difficulty: 'expert',
      question:
        'N = 3 replicas. Which configurations guarantee that every read quorum overlaps every write quorum? Select ALL that apply.',
      options: [
        'W = 2, R = 2 with strict quorums (only home replicas count)',
        'W = 3, R = 1',
        'W = 2, R = 2 with sloppy quorums and hinted handoff enabled',
        'W = 1, R = 3',
        'W = 1, R = 2',
      ],
      correct: [0, 1, 3],
      explanation:
        'Overlap requires R + W > N over the same fixed replica set: 2+2, 3+1 and 1+3 all exceed 3. With sloppy quorums, writes may land on stand-in nodes outside the home set, so a strict read quorum can miss them — the arithmetic no longer holds. W=1, R=2 sums to 3, which is not greater than N, so a read can miss the single written replica.',
      followUps: [
        {
          "q": "You choose W=1, R=3 to make writes as fast as possible. What happens to reads and writes when one replica is down?",
          "a": "Writes stay available (any one replica will do), but every read needs all 3 replicas, so a single down node makes reads fail — you've traded read availability for write latency. Durability also suffers: a write acknowledged by one replica is lost if that node's disk dies before replication. W=1/R=3 suits write-heavy, rarely-read data with replicas that are rarely down; for most workloads W=2/R=2 gives balanced availability and tolerates one failure on both paths."
        },
        {
          "q": "With sloppy quorums enabled, how long is the window in which a strict read can miss an acknowledged write, and what closes it?",
          "a": "From the moment the write lands on stand-in nodes until hinted handoff delivers it to the home replicas after they recover — seconds to hours. If the home replica stays down beyond the hint window (Cassandra's default `max_hint_window` is 3 hours), hints stop being stored and only anti-entropy repair closes the gap. So the window is bounded by repair frequency. If you need guaranteed overlap, disable sloppy quorums for that keyspace and accept failed writes during the outage."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-06',
      difficulty: 'hard',
      question:
        'Two app servers write the same Cassandra cell. Server X writes "shipped" at real time 10:00:00.100 with a clock that is 400 ms fast; server Y writes "delivered" at real time 10:00:00.300 with an accurate clock. What does a QUORUM read return after both succeed?',
      code: {
        language: 'text',
        code: `X: UPDATE orders SET status='shipped'   WHERE id=7;  -- writetime = 10:00:00.500 (fast clock)
Y: UPDATE orders SET status='delivered' WHERE id=7;  -- writetime = 10:00:00.300`,
      },
      options: [
        '"delivered", because it was written later in real time',
        '"shipped", because last-write-wins compares write timestamps and X\'s is higher',
        'Both values as siblings for the application to resolve',
        'An error, because QUORUM detects the conflict',
      ],
      correct: [1],
      explanation:
        'Cassandra resolves per-cell conflicts purely by write timestamp (LWW); X\'s skewed clock gives the earlier write the higher timestamp, so "delivered" is silently shadowed. Cassandra does not keep siblings (that\'s Riak/Dynamo with version vectors), and quorum reads don\'t detect conflicts. Fixes: state-machine updates via LWT (IF status = ...), immutable event rows, and clock discipline.',
      followUps: [
        {
          "q": "You can't fix every app server's clock immediately. How do you make the order status safe in Cassandra right now?",
          "a": "Stop using blind overwrites for a state machine. Use a lightweight transaction: `UPDATE orders SET status='delivered' WHERE id=7 IF status='shipped'`, which is linearizable via Paxos and rejects transitions from the wrong state regardless of timestamps. Or model status changes as immutable rows clustered by a server-assigned TIMEUUID and derive the current state by applying the state machine's rules. Also alert on NTP offset above ~50 ms per host, since writetime skew silently affects every other LWW column."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-07',
      difficulty: 'medium',
      question:
        'A user refreshes a dashboard three times and sees: 12 comments, 14 comments, 12 comments. Reads are round-robin across three async replicas. Which guarantee is violated, and what is the cheapest fix?',
      options: [
        'Linearizability; move to a consensus-based database',
        'Read-your-writes; route all reads to the primary',
        'Monotonic reads; pin the session to one replica or carry a "seen up to" version token',
        'Causal consistency; add vector clocks to comments',
      ],
      correct: [2],
      explanation:
        'Seeing newer data and then older data on successive reads is a monotonic-reads violation caused by hitting replicas with different lag. Sticky routing or a version token that only allows replicas at least as fresh as the last read fixes it cheaply. The user didn\'t write anything, so read-your-writes isn\'t the issue, and consensus or global primary reads are far more expensive than needed.',
      followUps: [
        {
          "q": "You pin sessions to one replica. That replica dies. How do you avoid the user's view jumping backwards on failover?",
          "a": "Stickiness alone loses its guarantee on failover, because the new replica may be further behind. Store a 'seen up to' position in the session (e.g. the last WAL LSN or replica timestamp returned with the read). After failover, route only to a replica whose replay position is at least that value, or wait briefly for it to catch up, or fall back to the primary. This position token is also what lets you drop stickiness entirely and load-balance freely."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-08',
      difficulty: 'expert',
      question:
        'Which statements about serializability and linearizability are correct? Select ALL that apply.',
      options: [
        'A serializable database may legally return a stale value to a read-only transaction that started after a write committed',
        'Strict serializability is serializability plus a real-time ordering constraint',
        'Snapshot isolation is serializable because every transaction reads a consistent snapshot',
        'Linearizability is a property of single-object operations and does not by itself provide multi-object transactions',
      ],
      correct: [0, 1, 3],
      explanation:
        'Serializability only requires equivalence to some serial order, which may place a later read "before" a committed write; adding real-time order gives strict serializability. Linearizability concerns individual objects and doesn\'t compose into atomic multi-object transactions. Snapshot isolation is not serializable — it permits write skew (e.g. two on-call doctors both leaving).',
      followUps: [
        {
          "q": "Your database offers only snapshot isolation. How do you prevent the on-call write skew without moving to SERIALIZABLE everywhere?",
          "a": "Materialise the conflict so both transactions write the same row. For example, `SELECT ... FROM shifts WHERE shift_id = $1 FOR UPDATE` on a per-shift row before checking how many doctors are on call, so the two transactions serialize on that lock. Alternatively add a constraint the database can enforce (a counter row with a CHECK, or an exclusion constraint). Use SERIALIZABLE only for the few transactions that encode invariants across rows, and retry on serialization failures."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-09',
      difficulty: 'hard',
      question:
        'Merging these two version vectors of a cart key from replicas A and B: V1 = {A:3, B:2}, V2 = {A:2, B:3}. What should a Dynamo-style store do?',
      options: [
        'Treat them as concurrent: keep both values as siblings (or merge via a CRDT) with vector {A:3, B:3} after resolution',
        'Keep V2, because its latest counter (B:3) is newer',
        'Keep V1, because A is the coordinator',
        'Pick whichever has the higher wall-clock timestamp',
      ],
      correct: [0],
      explanation:
        'Neither vector dominates the other (V1 is ahead on A, V2 is ahead on B), so the writes are concurrent — neither saw the other. The store must preserve both (siblings) for application or CRDT merge; the merged version then dominates both with {A:3, B:3}. Choosing by coordinator, a single counter, or wall clocks silently drops a concurrent update.',
      followUps: [
        {
          "q": "The cart accumulates siblings: a user's cart key now has 40 concurrent versions after a long partition. What do you do?",
          "a": "Merge them on read: the application unions items (or applies an OR-Set CRDT so removes are respected) and writes back a single value whose vector dominates all siblings, collapsing them. Sibling explosion usually means clients write without passing the context (vector) they read, so every write looks concurrent — fix the client to always send the causal context. Cap siblings with an alert, since unbounded growth bloats the object and slows every read."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-10',
      difficulty: 'expert',
      question:
        'This G-Counter merge is used for replicas gossiping state. What is wrong with it?',
      code: {
        language: 'typescript',
        code: `merge(other: Record<string, number>) {
  for (const [replica, count] of Object.entries(other)) {
    this.counts[replica] = (this.counts[replica] ?? 0) + count;
  }
}`,
      },
      options: [
        'Nothing; adding counts is how counters merge',
        'It needs a timestamp per slot to apply last-write-wins',
        'It should only merge the local replica\'s slot',
        'Merge must be idempotent: summing double-counts whenever the same state is received twice or gossiped back; use Math.max per replica slot',
      ],
      correct: [3],
      explanation:
        'Gossip delivers the same state repeatedly and states flow back and forth, so the merge must be idempotent, commutative and associative. Each slot is monotonically increasing and owned by one replica, so max() yields the correct value; + inflates the count every time a state is re-merged. Merging only the local slot would never learn others\' counts, and LWW would discard increments.',
      followUps: [
        {
          "q": "Max-merge works for increments. A product manager wants the counter to support decrements and a 'reset to zero' button. What changes?",
          "a": "Decrements: use a PN-Counter, two G-Counters (P and N) per replica with max-merge each, value = ΣP − ΣN. Reset is harder: it isn't commutative with concurrent increments. Options: a reset increments an epoch, and slots are stored per epoch, so the merge keeps the highest epoch and discards older slots (concurrent increments in the old epoch are lost, by design), or record the counter's value at reset as an offset to subtract. Decide explicitly what a concurrent increment and reset should mean."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-11',
      difficulty: 'hard',
      question:
        'In Cassandra, a replica was down for 14 days, while gc_grace_seconds is the default 10 days. During that time some rows were deleted. What risk arises when it rejoins?',
      options: [
        'None; hinted handoff will replay the deletes automatically',
        'Deleted rows can reappear ("zombies"): tombstones were purged on other replicas, so the returning replica\'s old data looks newer than "nothing"',
        'The node will refuse to join until a full rebuild is done',
        'Reads will return errors until repair completes',
      ],
      correct: [1],
      explanation:
        'Tombstones are kept only for gc_grace_seconds; after compaction removes them, other replicas have no record of the delete, and repair/read repair propagates the stale replica\'s live data back. Hints only cover a window (max_hint_window, default 3 hours), and Cassandra won\'t automatically block the join. The rule: a node down longer than gc_grace must be rebuilt/replaced, and repairs must run within gc_grace.',
      followUps: [
        {
          "q": "The replica has already rejoined and zombie rows are back. How do you clean up, and what process change prevents a repeat?",
          "a": "Take the node out, wipe its data and rebuild it from the others (`nodetool removenode`/replace, or rebuild), so its stale data stops spreading, then find resurrected rows by comparing against an authoritative source (event log, upstream DB) and delete them again. Prevention: monitor node downtime and refuse to start nodes down longer than gc_grace (automation checks the last-seen time), and run full or incremental repair on every table at least once per gc_grace (e.g. with Reaper)."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-12',
      difficulty: 'expert',
      question:
        'Which invariants CANNOT be guaranteed by an AP system using only CRDTs and asynchronous merging? Select ALL that apply.',
      options: [
        'Usernames are globally unique',
        'An account balance never goes below zero with concurrent withdrawals on different replicas',
        'All replicas that received the same set of updates show the same like count',
        'A set of tags contains every tag added unless an observed remove happened',
      ],
      correct: [0, 1],
      explanation:
        'Uniqueness and non-negative balances are invariants over concurrent operations: two replicas can each accept a conflicting operation before learning of the other, so preventing violation requires coordination (consensus, a single leader, or pre-allocated escrow quotas). Convergence of counters and OR-set add/remove semantics are exactly what CRDTs guarantee without coordination (strong eventual consistency).',
      followUps: [
        {
          "q": "You need non-negative balances but want region-local withdrawals during partitions. How can escrow make that possible?",
          "a": "Split the balance into per-region allowances. With ₹10,000 and 2 regions, give each ₹5,000 of withdrawal rights; each region can approve withdrawals up to its share without coordination, so the global balance can't go negative even when partitioned. When a region runs low, it requests more allowance from others via coordination, which only happens off the hot path. The trade-off: a user may be denied in one region while funds sit unused in another, so rebalance based on demand."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-13',
      difficulty: 'hard',
      question:
        'Using PACELC, which description best matches a DynamoDB table using default (eventually consistent) reads plus global tables in their default multi-region mode?',
      options: [
        'PA/EL — reads favour latency and availability, global tables replicate asynchronously and resolve conflicts with last-writer-wins',
        'PC/EC — DynamoDB uses Paxos, so every read is strongly consistent',
        'PC/EL — writes block during partitions but reads are fast',
        'PA/EC — writes are always available but reads always wait for all regions',
      ],
      correct: [0],
      explanation:
        'Default reads may be served by any replica (eventual, cheaper, faster), and global tables in the default mode replicate asynchronously across regions with last-writer-wins, keeping each region available during partitions — PA/EL. Paxos is used within a partition\'s replication group, but eventually consistent reads can still be stale; strong reads are opt-in per request and scoped to a region.',
      followUps: [
        {
          "q": "Two regions update the same DynamoDB global-table item concurrently: one sets the shipping address, the other sets a phone number. What's stored after replication?",
          "a": "Last-writer-wins applies to the whole item in default global tables: the item with the later timestamp replaces the other everywhere, so either the address or the phone change is lost even though they touched different attributes. To avoid this, route all writes for a given item to its home region, split independently updated attributes into separate items, or use conditional writes with a version attribute (which only protect within a region). DynamoDB's newer multi-region strong consistency mode is the other option, at a latency cost."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-14',
      difficulty: 'hard',
      question:
        'This router is meant to give read-your-writes after a profile update. Under what condition does it still show the old profile?',
      code: {
        language: 'typescript',
        code: `async function readProfile(userId: string, session: { lastWriteAt?: number }) {
  const recent = session.lastWriteAt && Date.now() - session.lastWriteAt < 2_000;
  const db = recent ? primary : pickReplica();
  return db.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
}`,
      },
      options: [
        'Never; 2 seconds is enough for any replica',
        'Only when the primary is down',
        'When replica lag exceeds 2 s (e.g. during a batch job) and the user reads 2+ s after writing — the window is time-based, not position-based',
        'When two users update the same profile concurrently',
      ],
      correct: [2],
      explanation:
        'A fixed time window assumes lag is always below it; during incidents lag can be minutes, so a read at 2.5 s hits a replica that still lacks the write. A position-based token (commit LSN compared with pg_last_wal_replay_lsn) is exact regardless of lag. Primary failure is a different problem, and concurrent writers relate to conflict handling, not read-your-writes for the author.',
      followUps: [
        {
          "q": "Rewrite the router with a position-based token. What does the session store, and what does the read path do if no replica is caught up?",
          "a": "After a write, return the commit LSN (`pg_current_wal_lsn()` after commit) and store it in the session cookie. On read, pick a replica whose `pg_last_wal_replay_lsn() >= token`; replicas can publish their replay LSN every ~100 ms to the router so it doesn't query them each time. If none qualifies, wait up to a small budget (e.g. 50 ms), then fall back to the primary. Track fallback rate as a metric — a rise means replicas are lagging."
        }
      ],
    },
    {
      id: 'ds-consistency-mcq-15',
      difficulty: 'expert',
      question:
        'A team claims its leaderless store is linearizable because it uses strict quorums with R + W > N and returns the highest-versioned value. Which additional mechanism is needed to rule out a later read returning an older value than an earlier read?',
      options: [
        'Hinted handoff',
        'Increasing N from 3 to 5',
        'Asynchronous background read repair after returning',
        'Writing the newest value back to a write quorum (blocking read repair) before the read returns',
      ],
      correct: [3],
      explanation:
        'Without write-back, a read can see a value present on only one replica (an in-flight write), and a later read quorum may miss that replica and return the older value. Ensuring a write quorum holds the value before returning (as in the ABD algorithm) makes every later read quorum intersect it. Async repair is too late, hinted handoff is for availability, and larger N doesn\'t remove the race.',
      followUps: [
        {
          "q": "Blocking write-back makes every read a two-round-trip operation. How do you avoid that cost most of the time?",
          "a": "Skip the write-back when all R responses carry the same version. If R ≥ W (as with N=3, R=W=2), that version is already stored on at least W replicas, which is exactly the state the write-back would have created, so any later read quorum must intersect it. Under low write contention agreement is the common case, so most reads stay one round trip. Only reads that observe disagreement, meaning an in-flight or partially applied write, pay the second round trip."
        }
      ],
    },
  ],
};

export default topic;
