import type { Topic } from '../../types';

const topic: Topic = {
  id: 'db-replication',
  phase: 'databases',
  order: 4,
  title: 'Replication, Read Replicas & Replication Lag',
  subtitle:
    'Single-leader, multi-leader and leaderless replication; sync vs async vs semi-sync; WAL streaming vs logical replication; read replicas and routing; read-your-writes and monotonic reads; failover, split brain; lag causes and fixes; why replicas do not scale writes.',
  estimatedMinutes: 105,
  sources: [
    'Martin Kleppmann — Designing Data-Intensive Applications, Ch 5 Replication',
    'PostgreSQL 16 docs — Ch 27 High Availability, Load Balancing, and Replication; Ch 31 Logical Replication',
  ],
  tags: ['replication', 'read-replicas', 'replication-lag', 'read-your-writes', 'failover', 'split-brain', 'wal', 'logical-replication', 'quorum', 'postgres'],
  cheatSheet: [
    'Single-leader: all writes to one primary, replicas replay its log (WAL/binlog) — simple, no write conflicts, but writes do not scale and failover is the hard part.',
    'Multi-leader: writes in several regions/DCs, async exchange → write conflicts (LWW, CRDTs, app merge). Leaderless (Dynamo/Cassandra): client writes to N replicas, quorum W + R > N for overlap.',
    'Async = fast, RPO > 0 (lose last ~ms–s of commits on failover). Sync = RPO 0 for acknowledged commits but commit latency += replica RTT, and a dead sync standby blocks writes unless you use ANY k of N.',
    'Postgres synchronous_commit: off < local < remote_write < on (remote flush) < remote_apply (visible on standby — enables read-your-writes from that replica).',
    'Physical streaming = byte-level WAL, whole cluster, same major version, read-only standbys. Logical = row changes per table via publication/subscription — cross-version upgrades, CDC, partial replication; no DDL/sequences replicated.',
    'Read-your-writes: route the user to primary for N seconds after a write, or carry a causal token (commit LSN) and read only from replicas where pg_last_wal_replay_lsn() >= token.',
    'Monotonic reads: pin a user/session to one replica (hash user id) so they never see time go backwards across requests.',
    'Lag causes: write bursts / bulk jobs, long queries on replica (recovery conflicts or hot_standby_feedback), under-provisioned replica I/O, network, single-threaded replay, and huge transactions.',
    'Monitor lag in bytes (pg_wal_lsn_diff) and time (replay_lag in pg_stat_replication); alert on inactive replication slots — they retain WAL until the disk fills.',
    'Failover = detect, pick most up-to-date replica, promote, fence the old primary (STONITH), repoint clients. Without fencing you get split brain — two primaries accepting writes.',
  ],
  sections: [
    {
      heading: 'Why replicate, and the single-leader model',
      body: `**Intuition:** replication means keeping copies of the same data on multiple machines — like having photocopies of a ledger in different offices. Copies give you **availability** (one office burns down, another has the book), **read scale** (more people can read at once) and **locality** (a copy near each user).

**Single-leader (primary/replica, formerly master/slave)**
1. All writes go to the **primary**.
2. The primary writes changes to its log — Postgres **WAL**, MySQL **binlog**.
3. Replicas stream that log and **replay** it, producing identical data.
4. Clients can read from replicas (possibly stale) or the primary (fresh).

**What it gives you**
| Goal | Delivered? |
|---|---|
| High availability | Yes — with a failover mechanism (the hard part) |
| Read scaling | Yes — add replicas; each serves reads |
| Write scaling | **No** — every replica still replays every write |
| Geographic reads | Yes — cross-region replicas (async) |
| Backups without load on primary | Yes — base backups / snapshots from a replica |

**Numbers to anchor on**
- In-AZ async lag is typically **< 10–100 ms** under normal load; cross-region (e.g. Mumbai → Virginia, ~200 ms RTT) adds at least one-way network delay plus replay.
- A single Postgres primary on large hardware sustains roughly 10K–50K write transactions/s for simple OLTP; replicas can each serve a similar read load.
- Aurora/Neon-style architectures replicate storage instead of WAL replay on each node (Aurora replicas typically lag < 100 ms, often ~10–20 ms).

**Interview line:** "Replicas buy me read capacity and availability, not write capacity — and they introduce a new consistency problem, replication lag, that the application must handle."`,
      diagram: `           writes + fresh reads
  App ------------------------------> +-----------+
   |                                   |  PRIMARY  |  WAL
   |  stale-tolerant reads             +-----+-----+
   |                                         | stream WAL (async/sync)
   |                       +-----------------+-----------------+
   v                       v                 v                 v
 +-----------+       +-----------+     +-----------+     +-----------+
 | replica 1 |       | replica 2 |     | replica 3 |     | DR replica|
 |  (AZ-a)   |       |  (AZ-b)   |     |  (AZ-c)   |     | (region 2)|
 +-----------+       +-----------+     +-----------+     +-----------+
   lag ~ms              lag ~ms           lag ~ms          lag ~100ms+`,
      keyPoints: [
        'Single-leader: one writer, many log-replaying readers.',
        'Replicas scale reads and availability, never writes.',
        'Replication lag is the price: design reads around it.',
      ],
    },
    {
      heading: 'Topologies: single-leader vs multi-leader vs leaderless',
      body: `**Intuition:** who is allowed to accept a write? One node (single-leader), one node per site (multi-leader), or any node (leaderless).

| Aspect | Single-leader | Multi-leader | Leaderless |
|---|---|---|---|
| Who accepts writes | One primary | One leader per region/DC | Any replica (client or coordinator writes to N) |
| Write conflicts | None (one order) | **Yes** — concurrent writes to the same key in two regions | Yes — resolved by versions/timestamps |
| Conflict handling | n/a | LWW, CRDTs, custom merge, avoid via "home region" per record | LWW (Cassandra), vector clocks / siblings (Riak, original Dynamo) |
| Consistency | Strong on primary, eventual on replicas | Eventual across leaders | Tunable via quorums |
| Failover | Promote a replica | Regions keep writing independently | No failover needed — nodes just miss writes |
| Examples | Postgres, MySQL, MongoDB replica set, Redis replication | MySQL/MariaDB multi-source, BDR/pgEdge, CouchDB, Active-Active Redis (CRDT) | Cassandra, ScyllaDB, DynamoDB internals, Riak |

**Leaderless quorums**
- N replicas per key; write succeeds after **W** acks; read queries **R** replicas and takes the newest version.
- **W + R > N** ⇒ read and write sets overlap ⇒ you read at least one replica with the latest acknowledged write (e.g. N=3, W=2, R=2 — Cassandra QUORUM/QUORUM).
- Caveats: concurrent writes + LWW with clock skew can lose writes; **sloppy quorums** with hinted handoff (writes to a stand-in node during partitions) break the overlap guarantee; a write that failed quorum may still be present on some replicas (no rollback).
- Repair mechanisms: **read repair**, **hinted handoff**, **anti-entropy** (Merkle-tree repair).

**When to use multi-leader:** multi-region write availability where each region must accept writes during a partition, or offline-first clients (each device is a leader). Avoid conflicts structurally by giving each record a **home region** (a user's data is written only in their region) — then it behaves like single-leader per record.`,
      keyPoints: [
        'Only single-leader avoids write conflicts by construction.',
        'Leaderless: W + R > N gives overlap, not linearizability (sloppy quorum, LWW caveats).',
        'Multi-leader works best when conflicts are avoided via home-region ownership.',
      ],
    },
    {
      heading: 'Synchronous, asynchronous and semi-synchronous replication',
      body: `**Intuition:** does the primary wait for a replica to confirm before telling the client "committed"? Waiting makes commits slower but guarantees a copy exists elsewhere.

| Mode | Commit returns when | Latency | Data loss on primary crash (RPO) | Availability risk |
|---|---|---|---|---|
| Async | Primary flushed its own WAL | Lowest | Up to the lag (ms–s, more under load) | None from replicas |
| Semi-sync (MySQL) | At least one replica **received** the event (AFTER_SYNC = lossless variant) | + ~1 RTT | ~0 if the ack'ing replica survives | Falls back to async after \`rpl_semi_sync_source_timeout\` (default 10 s) |
| Sync | Replica flushed (or applied) | + RTT + replica fsync | 0 for acknowledged commits | Writes **block** if the sync standby is unavailable |

**PostgreSQL knobs**
- \`synchronous_standby_names = 'ANY 1 (replica_a, replica_b, replica_c)'\` — quorum commit: any one of three must confirm; losing one replica does not block writes. \`FIRST 1 (...)\` = priority-based.
- \`synchronous_commit\` levels (can be set **per transaction**):
  - \`off\` — do not wait even for local flush (may lose last ~3× wal_writer_delay of commits on crash, no corruption).
  - \`local\` — local flush only.
  - \`remote_write\` — standby received and wrote to OS (not fsynced).
  - \`on\` — standby **flushed** to disk (default when sync standbys configured).
  - \`remote_apply\` — standby **applied** it, so it is visible to queries there.
- Per-transaction tuning: \`SET LOCAL synchronous_commit = 'off'\` for analytics events, \`remote_apply\` for a write that must be immediately readable from replicas.

**Cross-region:** sync replication to a region 200 ms away adds ≥200 ms to every commit — usually unacceptable. Common pattern: **sync to a replica in another AZ of the same region** (~1 ms), **async to the DR region**. Managed services mirror this: RDS Multi-AZ (sync standby), Aurora (storage quorum 4/6 across 3 AZs).

**Kafka analogy:** \`acks=all\` + \`min.insync.replicas=2\` is sync-ish replication; \`acks=1\` is async.`,
      code: [
        {
          language: 'sql',
          title: 'Quorum sync replication and per-transaction durability',
          code: `-- postgresql.conf on the primary
-- synchronous_standby_names = 'ANY 1 (pg_az_b, pg_az_c)'   -- 1 of 2 same-region standbys
-- synchronous_commit = on                                  -- wait for remote flush by default
-- (the DR replica in another region is async: not listed above)

-- Money movement: default (remote flush) is fine
BEGIN;
UPDATE account SET balance = balance - 500 WHERE id = 1;
UPDATE account SET balance = balance + 500 WHERE id = 2;
COMMIT;

-- Clickstream insert: trade durability for latency on this transaction only
BEGIN;
SET LOCAL synchronous_commit = 'off';
INSERT INTO page_view (user_id, url, ts) VALUES (42, '/home', now());
COMMIT;

-- A write that the next request will read from a replica
BEGIN;
SET LOCAL synchronous_commit = 'remote_apply';   -- commit returns when visible on sync standby
UPDATE profile SET display_name = 'Priya' WHERE user_id = 42;
COMMIT;`,
        },
      ],
      keyPoints: [
        'Async: fast, RPO > 0. Sync: RPO 0, slower, availability depends on standbys.',
        'Use ANY k of N quorum so one replica failure does not block writes.',
        'synchronous_commit is per transaction — tune durability per write class.',
      ],
      source: 'PostgreSQL 16 docs — 27.2.8 Synchronous Replication',
    },
    {
      heading: 'How changes flow: WAL streaming vs logical replication',
      body: `**Intuition:** physical replication copies the database's disk changes byte for byte ("page 812, offset 40, write these bytes"). Logical replication sends meaning ("row 42 in table orders changed status to paid").

| Aspect | Physical (streaming WAL) | Logical (publication/subscription, decoding) |
|---|---|---|
| Unit | WAL records for the whole cluster | Row-level INSERT/UPDATE/DELETE per table |
| Replica | Exact binary copy, read-only hot standby | Independent, writable database |
| Versions | Same major version, same architecture | Across major versions (zero-downtime upgrades) |
| Scope | Everything (all DBs, indexes, DDL) | Selected tables (row filters/column lists in PG15+) |
| DDL, sequences | Replicated | **Not** replicated — apply DDL yourself |
| Uses | HA standbys, read replicas, PITR | Upgrades, CDC (Debezium), consolidation, partial replicas |
| Failover target | Yes | Possible but awkward (slots/sequences) |

**Replication slots** (both kinds) make the primary retain WAL until the consumer confirms it. Great for not losing data — dangerous when a consumer disappears: an **inactive slot retains WAL forever** and fills the primary's disk. Set \`max_slot_wal_keep_size\` (PG13+) and alert on \`pg_replication_slots.active = false\` and retained bytes.

**MySQL equivalents:** binlog in ROW format (logical by nature, used for both replication and CDC); GTIDs make failover and replica repointing sane. Parallel apply via \`replica_parallel_workers\` (default 4 since 8.0.27).

**CDC connection:** Debezium reads the logical decoding stream (\`pgoutput\`) from a slot and publishes changes to Kafka — this is how search indexes, caches and warehouses stay in sync (covered in **data-pipelines**).`,
      code: [
        {
          language: 'sql',
          title: 'Logical replication for a zero-downtime major-version upgrade (PG14 → PG16)',
          code: `-- On the OLD primary (PG14): publish all tables
ALTER SYSTEM SET wal_level = 'logical';            -- requires restart
CREATE PUBLICATION upgrade_pub FOR ALL TABLES;

-- On the NEW cluster (PG16): schema first (pg_dump --schema-only), then subscribe
CREATE SUBSCRIPTION upgrade_sub
  CONNECTION 'host=old-primary dbname=app user=replicator password=***'
  PUBLICATION upgrade_pub
  WITH (copy_data = true);                          -- initial table sync, then streaming

-- Watch it catch up
SELECT subname, received_lsn, latest_end_lsn, last_msg_receipt_time
  FROM pg_stat_subscription;

-- Cutover: stop writes on old, wait for lag = 0, fix sequences (NOT replicated!)
SELECT setval('orders_id_seq', (SELECT max(id) FROM orders) + 1000);
-- Point the app at the new cluster, then drop the subscription and the old slot
DROP SUBSCRIPTION upgrade_sub;

-- Safety on every primary with slots: cap retained WAL
ALTER SYSTEM SET max_slot_wal_keep_size = '100GB';`,
        },
      ],
      keyPoints: [
        'Physical = exact copy for HA/read replicas; logical = row changes for upgrades, CDC, partial replication.',
        'Logical does not replicate DDL or sequence values.',
        'Inactive slots retain WAL until disk fills — cap with max_slot_wal_keep_size and alert.',
      ],
    },
    {
      heading: 'Read replicas and query routing in the application',
      body: `**Intuition:** send questions that tolerate slightly old answers to replicas, and everything else to the primary. The hard part is deciding which is which — per query, per user, per moment.

**Routing options**
| Where | How | Notes |
|---|---|---|
| App/ORM | Two data sources (writer, reader); TypeORM \`replication\`, Prisma read-replicas extension, Sequelize \`replication\` | Most control; per-query decisions |
| Proxy | Pgpool-II, ProxySQL (MySQL), RDS Proxy reader endpoints, Aurora reader endpoint | Transparent but blind to app semantics |
| DNS / LB | Reader endpoint load-balancing across replicas | Simple; no lag awareness |

**Rules that hold in production**
- **Transactions always on the primary** (a transaction mixing reads from a replica and writes to the primary is not a transaction).
- **Reads that feed a write** (check-then-act, balance before debit) → primary.
- **Reads immediately after the user's own write** → primary or lag-aware (next section).
- Everything else (feeds, search pages, reports, product pages) → replicas.
- **Lag-aware load balancing:** health-check replicas on replay lag; eject a replica whose lag exceeds a threshold (e.g. 5 s) and fall back to the primary for critical reads — but watch that the fallback does not overload the primary.
- Heavy analytics → a dedicated replica (with its own settings), so it cannot hurt OLTP read replicas.

**Capacity:** with a 90/10 read/write ratio, 4 replicas can take ~5× the read capacity of the primary alone — but every replica still applies 100% of the write volume, so replica hardware must keep up with the primary's write rate.`,
      code: [
        {
          language: 'typescript',
          title: 'TypeORM (NestJS) with primary + replicas and explicit routing',
          code: `import { DataSource } from 'typeorm';

export const dataSource = new DataSource({
  type: 'postgres',
  replication: {
    master: { host: 'pg-primary.internal', port: 5432, username: 'app', password: process.env.PGPASS, database: 'shop' },
    slaves: [
      { host: 'pg-replica-a.internal', port: 5432, username: 'app_ro', password: process.env.PGPASS_RO, database: 'shop' },
      { host: 'pg-replica-b.internal', port: 5432, username: 'app_ro', password: process.env.PGPASS_RO, database: 'shop' },
    ],
  },
  extra: { max: 10, statement_timeout: 3000 },
  entities: [__dirname + '/**/*.entity.{ts,js}'],
});

// TypeORM rule: find()/query builder SELECTs outside a transaction -> a replica;
// writes and anything in a transaction -> master.

export async function getOrderForPayment(orderId: string) {
  // Read that feeds a write decision: force the primary
  const qr = dataSource.createQueryRunner('master');
  try {
    return await qr.manager.findOneByOrFail('Order', { id: orderId });
  } finally {
    await qr.release();
  }
}

export async function listProducts(categoryId: string) {
  // Stale-tolerant: default routing sends this to a replica
  return dataSource.getRepository('Product').find({ where: { categoryId }, take: 50 });
}`,
        },
      ],
      keyPoints: [
        'Transactions and read-before-write go to the primary.',
        'Lag-aware routing ejects slow replicas; guard the primary against fallback floods.',
        'Replicas must keep up with 100% of write volume.',
      ],
    },
    {
      heading: 'Read-after-write, monotonic reads and consistent prefix',
      body: `**Intuition:** a user updates their profile, refreshes, and sees the old name — because the refresh was served by a replica 300 ms behind. To them, the save "didn't work". These guarantees fix what a *single user* sees, without making the whole system strongly consistent.

**1. Read-your-writes (read-after-write)**
| Technique | How | Trade-off |
|---|---|---|
| Read own data from primary | "Profile of the logged-in user" always from primary | Simple; primary load for own-data reads |
| Primary for N seconds after a write | Store \`last_write_at\` in session/cookie/Redis; route that user to primary while now − last_write_at < N (N ≈ p99 lag, e.g. 2–5 s) | Easy; N must exceed worst-case lag |
| **Causal token (LSN)** | After commit, return the primary's WAL LSN; on reads, choose a replica with \`pg_last_wal_replay_lsn() >= token\`, else wait briefly or go to primary | Precise, minimal primary load; more plumbing |
| \`synchronous_commit = remote_apply\` | Commit returns only after sync standby applied it | Slower commits; only helps reads on that standby |

The same idea exists in MongoDB (causal consistency sessions with \`afterClusterTime\`) and MySQL (\`WAIT_FOR_EXECUTED_GTID_SET\`).

**2. Monotonic reads:** a user reads from replica A (fresh), then replica B (stale), and a comment "disappears". Fix: **pin** each user/session to one replica (hash user id → replica), or carry the highest LSN seen and never read from a replica behind it.

**3. Consistent prefix reads:** the answer should never appear before the question. Matters in partitioned/leaderless systems where causally related writes land on different partitions; fixes include writing causally related data to the same partition or tracking causal dependencies.

**Cross-device:** "primary for N seconds" stored in a cookie does not help the user's *other* device — store the marker server-side (Redis keyed by user id) if that matters.`,
      code: [
        {
          language: 'typescript',
          title: 'LSN causal tokens: read-your-writes from replicas',
          code: `import { Pool } from 'pg';

const primary = new Pool({ host: 'pg-primary', max: 10 });
const replicas = [new Pool({ host: 'pg-replica-a', max: 10 }), new Pool({ host: 'pg-replica-b', max: 10 })];

// Write path: return the commit LSN as a causal token (e.g. header X-Read-After)
export async function updateName(userId: string, name: string): Promise<string> {
  const c = await primary.connect();
  try {
    await c.query('BEGIN');
    await c.query('UPDATE profile SET name = $1 WHERE user_id = $2', [name, userId]);
    await c.query('COMMIT');
    const { rows } = await c.query('SELECT pg_current_wal_lsn()::text AS lsn');
    return rows[0].lsn;                                     // e.g. '3/A1B2C3D4'
  } finally {
    c.release();
  }
}

// Read path: use a replica only if it has replayed at least up to the token
export async function readProfile(userId: string, token?: string) {
  const start = userId.length % replicas.length;            // sticky start => monotonic reads
  for (let i = 0; i < replicas.length; i++) {
    const pool = replicas[(start + i) % replicas.length];
    if (token) {
      const { rows } = await pool.query(
        'SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn AS caught_up', [token]);
      if (!rows[0].caught_up) continue;                    // too stale for this user
    }
    return (await pool.query('SELECT * FROM profile WHERE user_id = $1', [userId])).rows[0];
  }
  // No replica caught up: fall back to primary (bounded by rate limits in practice)
  return (await primary.query('SELECT * FROM profile WHERE user_id = $1', [userId])).rows[0];
}`,
        },
      ],
      keyPoints: [
        'Read-your-writes: primary for N s after writes, or LSN causal tokens.',
        'Monotonic reads: sticky replica per user or "highest LSN seen" tracking.',
        'Store markers server-side if the guarantee must hold across devices.',
      ],
    },
    {
      heading: 'Replication lag: causes, measurement and fixes',
      body: `**Intuition:** a replica is a second worker copying the primary's journal. It falls behind when the primary writes faster than the replica can copy, or when the replica is told to pause because someone is reading pages it needs to change.

**Measure it (Postgres)**
- On the primary: \`pg_stat_replication\` → \`write_lag\`, \`flush_lag\`, \`replay_lag\` (time) and \`pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)\` (bytes).
- On the replica: \`now() - pg_last_xact_replay_timestamp()\` — beware, it grows when the primary is idle, so combine with byte lag.
- MySQL: \`SHOW REPLICA STATUS\` → \`Seconds_Behind_Source\` (coarse; prefer heartbeat tables like pt-heartbeat).

**Causes and fixes**
| Cause | Signal | Fix |
|---|---|---|
| Write bursts: bulk imports, backfills, big UPDATE/DELETE | Byte lag spikes with primary WAL rate | Batch in small chunks with pauses; throttle backfills on replica lag; schedule off-peak |
| Huge single transactions | Lag jumps at commit | Split into smaller transactions |
| Long queries on replica conflicting with replay (vacuum cleanup of rows the query needs) | "canceling statement due to conflict with recovery" or replay paused up to \`max_standby_streaming_delay\` (default 30 s) | Move analytics to a dedicated replica with a larger delay; or \`hot_standby_feedback = on\` (prevents cancels but causes **bloat on the primary**) |
| Replica under-provisioned (I/O, CPU) | Replay I/O saturated | Same class as primary or better; fast storage; tune \`shared_buffers\` |
| Single-threaded replay (Postgres startup process) | One core at 100% on replica | Reduce WAL volume (fewer indexes, avoid full-page-write storms by longer checkpoints, \`wal_compression\`); MySQL: parallel workers |
| Network bandwidth / cross-region | Write lag ≈ flush lag high | Compression, bigger links, regional topology |
| Replica is also a cascade source or backup source | Extra I/O | Dedicated backup replica |

**Application-level defence**
- Treat replica data as stale by design; never read-then-write from replicas.
- Lag-aware routing with a threshold; circuit-break to primary *only* for critical reads.
- Throttle bulk jobs on \`replay_lag\` — "backpressure from replicas".`,
      code: [
        {
          language: 'sql',
          title: 'Lag dashboard queries (primary and replica)',
          code: `-- On the PRIMARY: per-replica lag in bytes and time
SELECT application_name, client_addr, state, sync_state,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn))   AS send_lag,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS replay_lag_bytes,
       write_lag, flush_lag, replay_lag
  FROM pg_stat_replication;

-- On the PRIMARY: slots retaining WAL (inactive slot = disk-filling time bomb)
SELECT slot_name, slot_type, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
  FROM pg_replication_slots;

-- On a REPLICA: how far behind in time (only meaningful while primary is writing)
SELECT now() - pg_last_xact_replay_timestamp() AS replay_delay,
       pg_is_in_recovery() AS is_replica;

-- On a REPLICA: queries cancelled by recovery conflicts since stats reset
SELECT datname, confl_snapshot, confl_lock, confl_bufferpin, confl_deadlock
  FROM pg_stat_database_conflicts WHERE datname = current_database();`,
        },
        {
          language: 'typescript',
          title: 'Backfill that throttles itself on replica lag',
          code: `import { Pool } from 'pg';
const primary = new Pool({ host: 'pg-primary', max: 2 });

const MAX_LAG_BYTES = 64 * 1024 * 1024;   // 64 MB of un-replayed WAL
const BATCH = 2_000;

async function maxReplicaLagBytes(): Promise<number> {
  const { rows } = await primary.query(
    'SELECT coalesce(max(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)), 0)::bigint AS lag FROM pg_stat_replication');
  return Number(rows[0].lag);
}

export async function backfillNormalizedEmail(): Promise<void> {
  let lastId = 0;
  for (;;) {
    while ((await maxReplicaLagBytes()) > MAX_LAG_BYTES) {
      await new Promise((r) => setTimeout(r, 1_000));   // let replicas catch up
    }
    const { rows } = await primary.query(
      'UPDATE users SET email_norm = lower(email) WHERE id IN (' +
        'SELECT id FROM users WHERE id > $1 AND email_norm IS NULL ORDER BY id LIMIT $2) ' +
        'RETURNING id', [lastId, BATCH]);
    if (rows.length === 0) break;
    lastId = Math.max(...rows.map((r) => Number(r.id)));  // keyset progress, resumable
    await new Promise((r) => setTimeout(r, 50));          // small pause between batches
  }
}`,
        },
      ],
      keyPoints: [
        'Measure lag in bytes and time; replay timestamp alone lies when the primary is idle.',
        'Replica queries vs replay: cancellations (max_standby_streaming_delay) or primary bloat (hot_standby_feedback).',
        'Throttle bulk writes on replica lag.',
      ],
    },
    {
      heading: 'Failover, promotion and split brain',
      body: `**Intuition:** when the primary dies, someone must decide it is really dead, pick the best replica, crown it, and make sure the old king cannot come back and issue orders. Each step has a way to go wrong.

**The failover sequence**
1. **Detect:** health checks / consensus-based leader lease (Patroni with etcd/Consul/ZooKeeper, Orchestrator for MySQL, managed RDS/Aurora). Timeouts trade false positives (network blip → needless failover) for detection speed; typical 10–30 s.
2. **Choose:** the replica with the **most advanced LSN** (least data loss); for sync setups, a sync standby (RPO 0).
3. **Promote:** \`pg_promote()\` — replica exits recovery and starts a new timeline.
4. **Fence the old primary:** make sure it cannot accept writes (STONITH: power off, revoke its IP/DNS, Patroni demotes itself when it loses the DCS leader key, storage fencing).
5. **Repoint clients:** DNS/VIP/proxy update, connection pools re-established; other replicas follow the new primary (\`pg_rewind\` the old primary to rejoin as a replica).

**What can go wrong**
- **Data loss (async):** commits acknowledged by the old primary but not yet replicated are lost; if the old primary later rejoins, those transactions must be discarded (\`pg_rewind\`) — and anything downstream (emails sent, Kafka events) already acted on them. GitHub's 2012 and 2018 incidents are classic examples of failover-related inconsistency.
- **Split brain:** the old primary was only partitioned, not dead; clients on its side keep writing → two diverging primaries. Prevented by **fencing** and by requiring a **majority/lease** from a consensus store before accepting writes (details of consensus in **ds-consensus**).
- **Flapping:** aggressive detection causes repeated failovers; use hysteresis and manual approval for cross-region failover.
- **Stale reads after failover:** caches and replicas may contain data from the lost timeline.
- **Auto-increment/sequence reuse** after data loss → ids reused for different records (keys in caches/other systems collide).

**Managed numbers:** RDS Multi-AZ failover typically ~60–120 s; Aurora ~30 s or less (faster with RDS Proxy / smart drivers); Patroni can be tuned to ~10–30 s.`,
      code: [
        {
          language: 'yaml',
          title: 'Patroni excerpt: leader lease in etcd, bounded data loss on failover',
          code: `scope: orders-cluster
name: pg-node-2
restapi:
  listen: 0.0.0.0:8008
etcd3:
  hosts: etcd-1:2379,etcd-2:2379,etcd-3:2379    # consensus store holds the leader key
bootstrap:
  dcs:
    ttl: 30                    # leader key lease; primary must renew or step down
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576   # never promote a replica > 1 MB behind
    synchronous_mode: true             # keep a sync standby; promote only it => RPO 0
    synchronous_mode_strict: false     # if no sync standby, allow async (availability)
    postgresql:
      use_pg_rewind: true              # old primary rejoins as replica after divergence
      parameters:
        wal_level: replica
        hot_standby: 'on'
        max_wal_senders: 10
        max_replication_slots: 10
        wal_log_hints: 'on'            # required by pg_rewind (unless data checksums)
postgresql:
  listen: 0.0.0.0:5432
  data_dir: /var/lib/postgresql/data
# A primary that cannot reach etcd demotes itself before the TTL expires:
# no lease => no writes, which is the fencing that prevents split brain.`,
        },
      ],
      keyPoints: [
        'Failover = detect → choose most up-to-date → promote → fence → repoint.',
        'Async failover loses the replication gap — and downstream side effects of it.',
        'Split brain is prevented by fencing + a consensus-backed leader lease.',
      ],
    },
    {
      heading: 'Write scaling limits: when replicas stop helping',
      body: `**Intuition:** adding readers to a library does not help if the problem is that one librarian must write every new book by hand. Replicas multiply read capacity; the write path is still one machine.

**Why replicas cannot scale writes**
- Every replica replays **100%** of the primary's writes; adding replicas adds WAL senders and network fan-out on the primary.
- The primary's limits: CPU for write transactions, WAL fsync throughput, checkpoint I/O, vacuum, and lock contention on hot rows.
- Postgres replay is single-threaded per replica, so replicas can fall behind a heavily parallel primary even on identical hardware.

**Signs you are hitting the write ceiling**
- Primary CPU/WAL I/O saturated while replicas idle on reads.
- Replication lag grows during peak writes on all replicas simultaneously.
- Commit latency climbs (WAL fsync queueing).

**Options, in rough order**
1. **Reduce write volume:** fewer indexes, avoid write-amplifying patterns (updating \`last_seen\` on every request), batch inserts, move ephemeral data (sessions, counters, presence) to Redis, events to Kafka.
2. **Vertical scale** the primary (more cores, faster NVMe) — often buys 2–4× cheaply.
3. **Functional partitioning:** split databases by service/bounded context (orders DB, users DB).
4. **Sharding** (horizontal partitioning by key) — see **db-sharding**.
5. **Distributed SQL / leaderless stores** (Spanner, CockroachDB, Yugabyte; Cassandra/DynamoDB) when the data model fits.
6. **Multi-leader by home region** for geo-distributed writes.

**Interview line:** "Read replicas are my first scaling step for read-heavy workloads — typically 80–95% reads. Once the primary's write path saturates, replicas do nothing for me; the next steps are reducing writes, splitting by domain, then sharding."`,
      keyPoints: [
        'Replicas replay all writes — they cannot add write capacity.',
        'Write ceiling signals: primary WAL/CPU saturated, lag rising everywhere at peak.',
        'Reduce writes → vertical → split by domain → shard/distributed SQL.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'db-replication-cc-1',
      title: 'Fix the wallet service that reads from replicas at the wrong moments',
      context:
        'A NestJS wallet service routes all SELECTs to a read replica "to offload the primary". Users report that after topping up, their balance shows the old value, and finance found two withdrawals that overdrew accounts during a period when replica lag spiked to 8 seconds.',
      task: 'Rework the data access so decisions are never made on stale data, users always see their own writes, and the replica still absorbs the bulk of read traffic.',
      starter: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
const primary = new Pool({ host: 'pg-primary' });
const replica = new Pool({ host: 'pg-replica' });

export async function topUp(userId: string, cents: number) {
  await primary.query('UPDATE wallet SET balance = balance + $1 WHERE user_id = $2', [cents, userId]);
  return getBalance(userId);             // show the new balance
}

export async function getBalance(userId: string) {
  const { rows } = await replica.query('SELECT balance FROM wallet WHERE user_id = $1', [userId]);
  return Number(rows[0].balance);
}

export async function withdraw(userId: string, cents: number) {
  const balance = await getBalance(userId);   // check funds
  if (balance < cents) throw new Error('insufficient funds');
  await primary.query('UPDATE wallet SET balance = balance - $1 WHERE user_id = $2', [cents, userId]);
}

export async function transactionHistory(userId: string) {
  const { rows } = await replica.query(
    'SELECT * FROM wallet_tx WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId]);
  return rows;
}`,
      },
      hints: [
        'Which read here feeds a write decision, and where must that decision be enforced?',
        'After topUp, how old can the replica\'s view be? What could you hand back to the caller so later reads know how fresh they must be?',
        'Which reads are genuinely fine to serve stale?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
const primary = new Pool({ host: 'pg-primary', max: 10, statement_timeout: 2000 });
const replica = new Pool({ host: 'pg-replica', max: 20, statement_timeout: 2000 });

// Write returns the new balance from the primary AND a causal token (commit LSN)
export async function topUp(userId: string, cents: number) {
  const c = await primary.connect();
  try {
    const { rows } = await c.query(
      'UPDATE wallet SET balance = balance + $1 WHERE user_id = $2 RETURNING balance', [cents, userId]);
    const lsn = await c.query('SELECT pg_current_wal_lsn()::text AS lsn');
    return { balance: Number(rows[0].balance), readAfter: lsn.rows[0].lsn as string };
  } finally {
    c.release();
  }
}

// Funds check and debit are ONE atomic statement on the primary: no stale read possible
export async function withdraw(userId: string, cents: number) {
  const { rowCount, rows } = await primary.query(
    'UPDATE wallet SET balance = balance - $1 WHERE user_id = $2 AND balance >= $1 RETURNING balance',
    [cents, userId]);
  if (rowCount !== 1) throw new Error('insufficient funds');
  return Number(rows[0].balance);
}

// Displays: replica if it has replayed the caller's last write, else primary
async function freshEnough(token?: string): Promise<boolean> {
  if (!token) return true;
  const { rows } = await replica.query('SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn AS ok', [token]);
  return rows[0].ok === true;
}

export async function getBalance(userId: string, readAfter?: string) {
  const pool = (await freshEnough(readAfter)) ? replica : primary;
  const { rows } = await pool.query('SELECT balance FROM wallet WHERE user_id = $1', [userId]);
  return rows.length ? Number(rows[0].balance) : 0;
}

export async function transactionHistory(userId: string, readAfter?: string) {
  const pool = (await freshEnough(readAfter)) ? replica : primary;
  const { rows } = await pool.query(
    'SELECT id, amount, kind, created_at FROM wallet_tx WHERE user_id = $1 ' +
    'ORDER BY created_at DESC, id DESC LIMIT 50', [userId]);
  return rows;
}
// The API returns readAfter to the client (header/cookie) or stores it in Redis per user
// for a few minutes, so every device of that user reads fresh-enough data.`,
      },
      explanation: `**Fixes**
- **Overdraft bug:** \`withdraw\` checked funds on a replica 8 s behind, then debited on the primary — a check-then-act across two databases. Now the check and debit are a single conditional \`UPDATE ... WHERE balance >= $1\` on the primary, which is correct even under concurrency (the row lock serialises debits).
- **Stale balance after top-up:** \`topUp\` read back from the replica immediately. It now uses \`RETURNING\` on the primary and hands the caller a **causal token** (commit LSN).
- **Read-your-writes everywhere else:** display reads use the replica only if \`pg_last_wal_replay_lsn() >= token\`; otherwise they fall back to the primary. Most reads carry no recent token and still hit the replica.
- **Robustness:** timeouts on both pools, a missing wallet row no longer throws on \`rows[0]\`, and history has a deterministic order with an explicit column list.`,
      followUps: [
        {
          "q": "Product adds a monthly withdrawal limit (sum of withdrawals this month ≤ ₹50,000). Can you keep the single-statement atomic approach?",
          "a": "Not with a single conditional UPDATE on wallet, since the check now spans wallet_tx rows. Options: (1) In one primary transaction, `SELECT ... FROM wallet WHERE user_id = $1 FOR UPDATE` to serialize this user's debits, then sum this month's withdrawals and insert plus update. Correct, but the lock is held for the sum query. (2) Better: keep a denormalized `month_withdrawn` column with `month_key` on wallet and do one `UPDATE ... SET balance = balance - $1, month_withdrawn = CASE ... END WHERE balance >= $1 AND month_withdrawn + $1 <= 5000000 RETURNING ...`. That's still atomic and lock-short. Never compute the limit from a replica."
        },
        {
          "q": "How would you test that withdraw can never overdraw, even under concurrency and replica lag?",
          "a": "Integration test against real Postgres with a replica (Testcontainers, or a replica simulated by pausing replay with `pg_wal_replay_pause()`). Seed a balance of 100, then fire 50 concurrent withdraws of 10 with `Promise.all`. Assert exactly 10 succeed, 40 throw 'insufficient funds', and the final balance is 0, never negative. Pause replay on the replica while doing it to prove withdraw doesn't depend on it. Add a DB-level `CHECK (balance >= 0)` as a backstop so any future regression fails loudly. For topUp, assert `getBalance(user, token)` returns the new value while replay is paused, which means it fell back to the primary."
        }
      ],
    },
    {
      id: 'db-replication-cc-2',
      title: 'Harden a lag-aware read router that took down the primary',
      context:
        'To avoid stale reads, a team wrote a router that checks replica lag before each query and falls back to the primary if lag > 1 s. At 3 a.m. traffic was low, all three replicas were reported as lagging, and the next morning\'s traffic surge hit the primary 100% and it fell over. Replica queries also hang for 2 minutes when a replica host dies.',
      task: 'Rewrite the router so lag is measured correctly, checks do not add a round trip per query, dead replicas are ejected quickly, and fallback to the primary is bounded.',
      starter: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
const primary = new Pool({ host: 'pg-primary' });
const replicas = ['pg-r1', 'pg-r2', 'pg-r3'].map((host) => new Pool({ host }));

export async function readQuery(sql: string, params: unknown[]) {
  for (const r of replicas) {
    const { rows } = await r.query(
      'SELECT extract(epoch FROM now() - pg_last_xact_replay_timestamp()) AS lag');
    if (Number(rows[0].lag) < 1) {
      return (await r.query(sql, params)).rows;
    }
  }
  return (await primary.query(sql, params)).rows; // everything lagging -> primary
}`,
      },
      hints: [
        'What does now() - pg_last_xact_replay_timestamp() report when the primary has not committed anything for 10 minutes?',
        'How many extra round trips does each read make, and what happens when a replica host is unreachable without timeouts?',
        'If every replica is ejected, should 100% of reads go to the primary?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Pool } from 'pg';

const opts = { max: 20, connectionTimeoutMillis: 500, statement_timeout: 2000, query_timeout: 2500 };
const primary = new Pool({ host: 'pg-primary', ...opts });
const replicas = ['pg-r1', 'pg-r2', 'pg-r3'].map((host) => ({ host, pool: new Pool({ host, ...opts }), healthy: false }));

const MAX_LAG_BYTES = 16 * 1024 * 1024; // ~16 MB of WAL not yet replayed
const FALLBACK_BUDGET_PER_SEC = 200;     // primary absorbs at most this many fallback reads/s
let fallbackTokens = FALLBACK_BUDGET_PER_SEC;
setInterval(() => { fallbackTokens = FALLBACK_BUDGET_PER_SEC; }, 1000).unref();

// Background health loop: lag measured in BYTES on the primary, independent of idle periods
async function refreshHealth(): Promise<void> {
  try {
    const { rows } = await primary.query(
      'SELECT client_addr::text AS addr, application_name AS name, ' +
      'pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)::bigint AS lag_bytes FROM pg_stat_replication');
    const lagByName = new Map(rows.map((r) => [r.name as string, Number(r.lag_bytes)]));
    for (const r of replicas) {
      const lag = lagByName.get(r.host);                  // application_name = host in primary_conninfo
      r.healthy = lag !== undefined && lag < MAX_LAG_BYTES; // not streaming at all => unhealthy
    }
  } catch {
    // primary unreachable: keep last known state rather than flapping everything
  }
}
setInterval(() => void refreshHealth(), 1000).unref();
void refreshHealth();

let rr = 0;
export async function readQuery(sql: string, params: unknown[]) {
  const healthy = replicas.filter((r) => r.healthy);
  for (let i = 0; i < healthy.length; i++) {
    const r = healthy[(rr++ + i) % healthy.length];
    try {
      return (await r.pool.query(sql, params)).rows;      // no extra round trip per query
    } catch (e: any) {
      if (e.code === undefined) r.healthy = false;       // network/timeout error: eject now
      else throw e;                                      // SQL error: surface it
    }
  }
  // All replicas unhealthy: bounded fallback, then shed load instead of killing the primary
  if (fallbackTokens-- > 0) return (await primary.query(sql, params)).rows;
  const err = new Error('read capacity degraded, retry later') as Error & { status?: number };
  err.status = 503;
  throw err;
}`,
      },
      explanation: `**Fixes**
- **Wrong lag metric:** \`now() - pg_last_xact_replay_timestamp()\` measures time since the last *replayed commit*. When the primary is idle at 3 a.m., it grows forever even though replicas are fully caught up — so every replica was ejected. Lag is now measured in **bytes of un-replayed WAL** from \`pg_stat_replication\`, which is zero when caught up.
- **Round trip per query:** each read made up to 3 lag checks before the real query. Health is now refreshed once per second in the background.
- **Dead replicas:** no connection or query timeouts meant a dead host hung each read for TCP timeout (~minutes). Now 500 ms connect / 2.5 s query timeouts, and network errors eject the replica immediately. A replica that is not streaming at all is treated as unhealthy.
- **Unbounded fallback:** "everything lagging → primary" converted a replica problem into a primary outage. Fallback now has a token budget; beyond it the router sheds load with a 503 so the primary survives.
- **Load spreading:** round-robin across healthy replicas instead of always hammering the first one.`,
      followUps: [
        {
          "q": "The router runs in 40 pods, each polling pg_stat_replication every second and each with its own fallback budget of 200/s. What's wrong at fleet level?",
          "a": "The budget is per pod, so the primary can actually receive 40 × 200 = 8,000 fallback reads/s, which may be enough to take it down again. Health polling also adds 40 queries/s to the primary, small but redundant, and pods can disagree about health. Fixes: size the per-pod budget as the global budget divided by pod count (recomputed on scale), or use a shared limiter (a Redis token bucket, accepting the extra hop), or enforce the cap at PgBouncer with a separate small pool for fallback reads. Centralize health in one sidecar or service that publishes replica state, or have pods read it from the proxy (HAProxy/pgcat health checks)."
        },
        {
          "q": "How would you verify this router's behaviour before the next 3 a.m. incident rather than during it?",
          "a": "Run game days and fault-injection tests in staging. (1) Idle primary: stop all writes for 15 min and assert replicas stay healthy (byte lag 0). (2) Lag: `pg_wal_replay_pause()` on one replica and confirm it's ejected within about 2 s and re-added after resume. (3) Dead host: blackhole a replica with iptables DROP and assert reads fail over within the 500 ms connect timeout and p99 stays bounded. (4) All replicas down: assert the primary gets at most the budgeted QPS and the rest get 503s. Export metrics (healthy replica count, fallback rate, ejections) and alert on them."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'db-replication-iq-01',
      difficulty: 'hard',
      question:
        'Users edit their profile, get a success message, refresh, and see the old data about 5% of the time. Reads go to read replicas. How do you fix it without sending all reads to the primary?',
      whatInterviewerLooksFor: [
        'Identifies replication lag and the read-your-writes guarantee',
        'Offers multiple techniques with trade-offs (primary for N seconds, LSN tokens, remote_apply)',
        'Handles cross-device and monotonic reads',
        'Quantifies primary load impact',
      ],
      modelAnswer: `### Diagnosis
Async replicas lag the primary by tens to hundreds of ms normally, more during write bursts. The refresh hits a replica that has not replayed the update yet. This is a **read-your-writes** violation — only the writing user cares; others can see it a bit later.

### Options
1. **Own data from the primary:** queries like "my profile", "my settings" go to the primary. Simple; primary load = own-data reads (often a small fraction of all reads).
2. **Primary for N seconds after a write:** on any write, set \`last_write_at\` (cookie or Redis by user id). Router sends that user's reads to the primary while \`now - last_write_at < N\`, with N ≥ p99 lag (e.g. 3 s). If 2% of users write per minute, primary read share rises only slightly.
3. **Causal token:** return the commit LSN (\`pg_current_wal_lsn()\` after commit) to the client; subsequent reads include it; the router picks a replica with \`pg_last_wal_replay_lsn() >= token\`, else waits up to ~100 ms or falls back to primary. Precise: the primary only sees reads that genuinely cannot be served.
4. **remote_apply** for this write: commit waits until the sync standby applied it — reads from *that* standby are then fresh; costs commit latency.

### Recommendation
Option 3 for the general mechanism (works for any entity) with option 1 for obviously personal pages. Store the token server-side (Redis, keyed by user) if the user switches devices; carry it in a header for API clients.

### Also fix monotonic reads
Different refreshes hitting different replicas can make data flicker (new → old). Pin a user to one replica by hashing the user id, or keep the highest LSN the user has seen as a floor.

### Measure
Track the share of reads falling back to primary and replica lag p99; alert if lag exceeds N so option 2 does not silently break.`,
      followUps: [
        {
          q: 'How do you get the commit LSN in a NestJS/TypeORM app without an extra round trip?',
          a: 'Run SELECT pg_current_wal_lsn() on the same connection right after COMMIT (one cheap round trip), or in the same transaction just before commit using pg_current_wal_insert_lsn() — slightly earlier than the commit record, so compare with a small margin or prefer the post-commit read.',
        },
        {
          q: 'What if replicas are behind a proxy you cannot query individually?',
          a: 'Fall back to time-based routing (primary for N seconds) or use a proxy/driver that supports causal consistency; alternatively expose per-replica endpoints for the router.',
        },
      ],
      pitfalls: [
        'Routing all reads to the primary',
        'Adding a sleep after writes',
        'Ignoring that the other devices of the same user may also need the guarantee',
      ],
    },
    {
      id: 'db-replication-iq-02',
      difficulty: 'expert',
      question:
        'Your Postgres primary crashed. The replica was promoted automatically in 20 seconds. Next day finance finds 37 orders that customers were charged for but that do not exist in the database. Explain what happened and how you would prevent it.',
      whatInterviewerLooksFor: [
        'Explains async replication RPO and lost acknowledged commits',
        'Traces downstream side effects that escaped (payments, events)',
        'Proposes sync/quorum replication for critical data and appropriate failover policy',
        'Proposes reconciliation and idempotent recovery flows',
      ],
      modelAnswer: `### What happened
- Replication was **asynchronous**. The old primary acknowledged commits for those 37 orders, the app proceeded to charge cards (or had charged first and then recorded), but the WAL for those commits had not reached the replica when the primary crashed.
- Failover promoted the replica — its timeline simply does not contain those transactions. When the old primary is rewound (\`pg_rewind\`) to rejoin, its extra transactions are discarded.
- Downstream side effects (payment captures, confirmation emails, Kafka events) happened based on commits that no longer exist → inconsistency.

### Prevention
1. **Synchronous (quorum) replication for critical writes:** \`synchronous_standby_names = 'ANY 1 (az_b, az_c)'\` within the region; a commit is acknowledged only when at least one standby flushed it (~1 ms extra in-region). Failover promotes only a sync standby (Patroni \`synchronous_mode\`). RPO for acknowledged commits → 0.
2. **Failover guard:** \`maximum_lag_on_failover\` — do not auto-promote a replica too far behind; page a human instead.
3. **Ordering of side effects:** charge only after the order is durably committed (with sync replication), via a **transactional outbox** — the "charge" command is written in the same transaction and relayed afterwards. If the commit is lost, so is the outbox row; nothing escapes.
4. **Idempotency keys** with the payment provider tied to the order id, so re-creating the order and retrying does not double-charge.
5. **Reconciliation:** daily (or streaming) job comparing provider captures vs orders; auto-refund or recreate orphans.

### Recovery for the 37
Extract the lost transactions from the old primary's WAL/data before rewinding (or from the provider's records + application logs), recreate or refund them, notify customers.`,
      followUps: [
        {
          q: 'Doesn\'t synchronous replication hurt availability?',
          a: 'With a single sync standby, yes: if it dies, commits block. ANY 1 of 2+ standbys, or Patroni synchronous_mode_strict = false (degrade to async when no standby is available), limits that risk — at the cost of possible data loss during the degraded window, which should page someone.',
        },
        {
          q: 'Why not always do cross-region synchronous replication?',
          a: 'Every commit would pay the inter-region RTT (e.g. +70–200 ms), crushing throughput for hot rows and user latency. Typical design: sync in-region across AZs, async cross-region with a documented RPO for regional disasters.',
        },
      ],
      pitfalls: [
        'Saying "replicas are copies so no data can be lost"',
        'Blaming the payment provider',
        'Fixing only the database and ignoring side-effect ordering',
      ],
    },
    {
      id: 'db-replication-iq-03',
      difficulty: 'hard',
      question:
        'Replication lag on our analytics replica regularly hits 20 minutes during the day, and some dashboard queries fail with "canceling statement due to conflict with recovery". What is going on and what are your options?',
      whatInterviewerLooksFor: [
        'Explains recovery conflicts between replay and long-running replica queries',
        'Knows max_standby_streaming_delay and hot_standby_feedback trade-offs',
        'Separates analytics from OLTP replicas',
        'Suggests moving analytics to a proper OLAP path',
      ],
      modelAnswer: `### Mechanism
On a hot standby, WAL replay sometimes needs to remove row versions (vacuum cleanup records from the primary) or take locks that a running replica query still depends on. Postgres then has two choices:
- **Pause replay** up to \`max_standby_streaming_delay\` (default **30 s**) waiting for the query — lag grows.
- After the delay, **cancel the query** ("conflict with recovery").
With long dashboard queries running back to back, replay keeps pausing (lag accumulates to 20 min) and queries still get cancelled.

### Options
| Option | Effect | Cost |
|---|---|---|
| \`hot_standby_feedback = on\` | Replica tells primary its oldest snapshot; primary's vacuum does not remove rows it needs → far fewer conflicts | **Bloat on the primary** — long analytics queries now hold back vacuum for OLTP tables |
| Raise \`max_standby_streaming_delay\` (e.g. -1 = wait forever) on a **dedicated analytics replica** | Queries never cancelled | That replica can be hours behind — fine if dashboards tolerate it; it must never be used for OLTP reads or failover |
| Keep OLTP replicas at low delay | OLTP replicas stay fresh | Analytics must go elsewhere |
| Move analytics to a warehouse (CDC → ClickHouse/BigQuery/Snowflake) or a logical-replication subscriber | No interference with replay at all | Extra pipeline |
| Shorter queries (pre-aggregations, materialised rollups) | Fewer conflicts | Engineering effort |

### Recommendation
1. Split roles: OLTP read replicas (default delays, feedback off) and a **dedicated analytics replica** with a long delay and a documented staleness SLA.
2. Longer term, move heavy analytics to an OLAP store fed by CDC.
3. Monitor \`pg_stat_database_conflicts\`, replay lag per replica, and primary dead-tuple growth if feedback is enabled.`,
      followUps: [
        {
          q: 'Why is the analytics replica unsuitable as a failover target?',
          a: 'It may be far behind (large RPO if promoted) and its configuration (delays, sizing) is tuned for reads, not for taking over write load; exclude it from failover candidates (e.g. Patroni nofailover tag).',
        },
        {
          q: 'Would logical replication avoid recovery conflicts?',
          a: 'Yes — a logical subscriber is an independent database applying row changes with its own MVCC and vacuum, so long queries do not conflict with replay (though they still bloat the subscriber and apply can slow if it blocks on locks there).',
        },
      ],
      pitfalls: [
        'Turning on hot_standby_feedback without noting primary bloat',
        'Letting analytics share replicas with latency-critical OLTP reads',
        'Blaming network bandwidth for lag caused by replay pauses',
      ],
    },
    {
      id: 'db-replication-iq-04',
      difficulty: 'expert',
      question:
        'Compare single-leader with async cross-region replicas, multi-leader, and leaderless replication for a global e-commerce cart and checkout. Which would you choose for each part?',
      whatInterviewerLooksFor: [
        'Matches consistency needs per data type (cart vs inventory vs payment)',
        'Understands conflict resolution in multi-leader/leaderless (LWW, CRDT merges)',
        'Uses home-region ownership to avoid conflicts',
        'Discusses latency and failure behaviour concretely',
      ],
      modelAnswer: `### Data and needs
- **Cart:** high write rate, per-user, must be available; merge conflicts tolerable (union of items).
- **Inventory / checkout / payments:** strong invariants (no oversell, no double charge).
- **Catalog:** read-heavy, globally read, rarely written.

### Options
| Model | Latency | Conflicts | Failure behaviour |
|---|---|---|---|
| Single-leader + async regional replicas | Writes pay RTT to leader region (e.g. 200 ms from India to US) | None | Leader region outage → failover with RPO > 0 |
| Multi-leader (per region) | Local writes | Concurrent edits to same key in two regions | Regions keep writing during partitions |
| Leaderless (Dynamo-style) | Local quorum writes | Version conflicts → LWW or sibling merge | Tolerates node failures without failover |

### Choice
- **Cart:** leaderless or multi-leader with **CRDT-style merge** — the original Amazon Dynamo paper's example: concurrent cart versions are merged (add-wins); a deleted item might reappear, which is acceptable. Or simpler: home-region per user in DynamoDB Global Tables (LWW) + the user is almost always served in one region, so conflicts are rare.
- **Inventory + orders + payments:** **single-leader per record** — either one primary region, or partition by **home region** (inventory for an Indian warehouse is owned by the India region). Conditional updates enforce invariants; sync replication within the region's AZs, async to DR. If a truly global strongly consistent store is needed, Spanner/CockroachDB (consensus-based; commits pay quorum RTT).
- **Catalog:** single-leader writes, async replicas + CDN everywhere; staleness of seconds is fine.

### Key argument
"Multi-leader or leaderless is for data whose conflicts I can merge automatically. Money and stock are not mergeable — two regions each selling the last unit cannot be 'merged' — so those stay single-writer per record."`,
      followUps: [
        {
          q: 'What is wrong with last-write-wins for inventory counts?',
          a: 'Two regions each decrement 5 → 4 concurrently; LWW keeps one write, so the result is 4 instead of 3: a lost update that causes overselling. Counters need commutative merges (PN-counters) and even those cannot enforce a lower bound of zero without coordination.',
        },
        {
          q: 'How does DynamoDB Global Tables resolve conflicts?',
          a: 'Asynchronously replicated, multi-active; conflicting concurrent writes are resolved by last writer wins based on timestamps, so apps should avoid concurrent writes to the same item from multiple regions (home-region routing) or use conditional writes within one region.',
        },
      ],
      pitfalls: [
        'Choosing one replication model for all data',
        'Using LWW for money or stock',
        'Ignoring cross-region write latency for single-leader',
      ],
    },
    {
      id: 'db-replication-iq-05',
      difficulty: 'hard',
      question:
        'During a network partition between availability zones, your monitoring shows two Postgres nodes both reporting as primary for about 90 seconds. How could that happen, what is the damage, and how do you design it out?',
      whatInterviewerLooksFor: [
        'Explains split brain from failover without fencing',
        'Describes divergent timelines and data reconciliation',
        'Proposes consensus-based leader leases, fencing (STONITH), and client-side routing via DCS',
        'Mentions quorum placement (odd number of voters across 3 AZs)',
      ],
      modelAnswer: `### How it happens
- The failover manager on the replica's side lost contact with the primary and promoted the replica.
- The old primary was **alive** on the other side of the partition and still reachable by some app pods, so it kept accepting writes.
- No **fencing**: nothing forced the old primary to stop. Possibly a custom health-check script or a manager with no quorum (two-node setup where each side thinks the other is dead).

### Damage
Two timelines diverged for 90 s: orders, payments, id sequences allocated on both sides (duplicate ids for different rows), downstream events from both. After healing, one side's writes must be extracted and reconciled manually (or lost when the old primary is rewound).

### Design it out
1. **Consensus-backed leader lease:** Patroni/Stolon with etcd/Consul/ZooKeeper deployed as 3 or 5 members across **3 AZs**. Only the holder of the leader key may be primary; the key has a TTL (e.g. 30 s). A primary that cannot renew the key (it is on the minority side) **demotes itself** before the TTL expires — the lease is the fence.
2. **Promotion only with quorum:** the replica can take the key only if the majority of the DCS agrees; the minority side can never elect.
3. **STONITH / infrastructure fencing** as a second layer: revoke the old primary's VIP, detach its storage, or kill the instance.
4. **Client routing through the DCS view** (HAProxy with Patroni REST health checks: only the node returning 200 on \`/primary\` receives writes), not static IPs.
5. \`synchronous_mode\` so an isolated primary cannot commit without a standby's ack — writes on the minority side block instead of diverging.
6. Test it: game days with partitions (e.g. iptables drops) between AZs.`,
      followUps: [
        {
          q: 'Why an odd number of consensus nodes across three AZs?',
          a: 'A majority must survive any single-AZ failure: with 3 members in 3 AZs, losing one AZ leaves 2 of 3 — still a quorum. With 2 AZs, losing the one holding the majority stops all elections.',
        },
        {
          q: 'Can a lease alone guarantee no overlap?',
          a: 'Only if the old primary stops writing before the lease expires on its own clock, which assumes bounded clock drift and process pauses. That is why fencing tokens / storage-level fencing or synchronous replication are added as extra protection.',
        },
      ],
      pitfalls: [
        'Two-node failover with no witness',
        'Relying on DNS changes alone to stop writes to the old primary',
        'Not planning reconciliation for divergent writes',
      ],
    },
    {
      id: 'db-replication-iq-06',
      difficulty: 'medium',
      question:
        'Our Postgres primary is at 85% CPU. A teammate suggests adding three more read replicas. When is that the right move and when is it not?',
      whatInterviewerLooksFor: [
        'Asks what the CPU is spent on: reads vs writes',
        'Explains replicas do not offload writes and add replay load',
        'Mentions app changes needed for read routing and lag tolerance',
        'Suggests alternatives: query optimisation, caching, vertical scaling, partitioning',
      ],
      modelAnswer: `### First, what is the CPU doing?
Use pg_stat_statements: split total time into reads (SELECT) vs writes (INSERT/UPDATE/DELETE, commit, vacuum, index maintenance).

### When replicas help
- Reads dominate (say 80% of CPU is SELECT) **and** those reads tolerate some staleness (catalog, feeds, search pages, reports).
- The app can route them (ORM replication config or reader endpoint) and handle read-your-writes where needed.
- Expected gain: moving 70% of load to replicas drops primary CPU from 85% to ~30–40%.

### When they do not
- CPU is dominated by writes, vacuum or lock contention — replicas replay the same writes and do nothing for the primary (they even add a little WAL sender overhead).
- Most reads need fresh data (read-before-write, balances) — they must stay on the primary.
- The "read load" is a handful of terrible queries — fix them (index, rewrite) and you may drop 50% CPU for free.
- Hot read keys that a cache (Redis, CDN) can absorb more cheaply than replicas.

### Order of operations I would propose
1. Top queries by total time → optimise the top 3–5.
2. Cache hot, stale-tolerant reads.
3. Add 1–2 replicas for remaining stale-tolerant reads, with lag monitoring and routing rules.
4. If writes dominate: reduce write amplification, scale vertically, split by domain, then shard.`,
      followUps: [
        {
          q: 'How many replicas can one primary support?',
          a: 'Technically dozens (max_wal_senders), but each adds WAL send bandwidth on the primary; beyond ~5–10 use cascading replication (replicas feeding replicas) to offload the primary.',
        },
        {
          q: 'What changes in the app are needed?',
          a: 'Two connection pools or ORM replication config, explicit routing of transactional/read-before-write paths to the primary, read-your-writes handling, and lag-aware health checks.',
        },
      ],
      pitfalls: [
        'Assuming replicas reduce write load',
        'Routing all reads to replicas without consistency analysis',
        'Skipping query optimisation',
      ],
    },
    {
      id: 'db-replication-iq-07',
      difficulty: 'expert',
      question:
        'You run Cassandra with RF=3 across three racks and use QUORUM for both reads and writes. A developer says this guarantees strong consistency. Do you agree? Walk through the edge cases.',
      whatInterviewerLooksFor: [
        'Explains W + R > N overlap and what it does guarantee',
        'Knows LWW + clock skew, failed writes left partially applied, concurrent writes',
        'Knows lightweight transactions (Paxos) for compare-and-set',
        'Distinguishes linearizability from quorum overlap',
      ],
      modelAnswer: `### What QUORUM/QUORUM gives
N = 3, W = 2, R = 2 → W + R = 4 > 3, so every read quorum overlaps every successful write quorum. A read after a **successful** write (acknowledged to the client) will see that write or a newer one. That is strong-ish read-after-write for single keys under normal operation.

### Where it is not strong (not linearizable)
1. **Failed/timeout writes are not rolled back.** A write reaches 1 replica, then times out (client sees an error). Later reads may or may not return it depending on which replicas they hit; read repair can then propagate it everywhere. The write "may have happened" — clients must treat timeouts as unknown.
2. **Concurrent writes + last-write-wins:** conflicts are resolved by cell timestamp (client or coordinator clock). Clock skew of 50 ms can make an earlier write win; concurrent read-modify-write cycles lose updates.
3. **Non-atomic reads during in-flight writes:** reader A sees the new value (from the one replica that has it plus read repair) while reader B, a moment later, sees the old one if repair has not finished (blocking read repair mitigates for QUORUM reads, but linearizability still is not guaranteed across concurrent operations).
4. **Multi-DC:** QUORUM counts replicas across all DCs (cross-DC latency); LOCAL_QUORUM is per-DC and does not overlap with writes made in another DC.
5. **Hinted handoff / node replacement:** a node that missed writes and comes back before repair can serve stale data in a quorum with another stale node if repairs are not run within gc_grace_seconds (and deleted data can resurrect).

### When you truly need compare-and-set
**Lightweight transactions** (\`INSERT ... IF NOT EXISTS\`, \`UPDATE ... IF balance = ?\`) use Paxos with SERIAL consistency: linearizable for that partition, at ~4 round trips and much lower throughput. Use for uniqueness (usernames) or state transitions, not for every write.

### Verdict
"Quorum overlap gives read-your-acknowledged-writes for single keys, not linearizability or transactions. For invariants, use LWT or a single-leader ACID store."`,
      followUps: [
        {
          q: 'How would you avoid clock-skew issues with LWW?',
          a: 'Use server-side timestamps with NTP/chrony tightly synced, avoid concurrent writers to the same cell (model writes as appends with unique clustering keys instead of overwrites), or use LWT for contested updates.',
        },
        {
          q: 'Does W=3, R=1 give the same guarantee?',
          a: 'Overlap still holds (3 + 1 > 3), with faster reads, but any single replica being down makes writes fail — availability for writes drops. QUORUM/QUORUM balances both.',
        },
      ],
      pitfalls: [
        'Equating quorum overlap with ACID or linearizability',
        'Ignoring timed-out writes that partially succeeded',
        'Forgetting LOCAL_QUORUM semantics in multi-DC',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'db-replication-boe-1',
      question:
        'A primary generates WAL at 40 MB/s at peak. How much data could you lose on an async failover, how much bandwidth does each replica need, and how long until an inactive replication slot fills a 2 TB disk?',
      assumptions: [
        'Peak WAL 40 MB/s, daily average 12 MB/s',
        'Typical in-region replay lag 200 ms; during bursts up to 5 s',
        '3 physical replicas + 1 CDC logical slot',
        '2 TB free disk on primary for pg_wal',
      ],
      steps: [
        { label: 'RPO at typical lag', calc: '40 MB/s × 0.2 s = 8 MB of WAL ≈ a few thousand small transactions' },
        { label: 'RPO during a burst', calc: '40 MB/s × 5 s = 200 MB of WAL' },
        { label: 'Bandwidth per replica', calc: '40 MB/s × 8 = 320 Mbit/s peak; 3 replicas + CDC ≈ 1.3 Gbit/s egress from primary' },
        { label: 'Slot retention per day', calc: '12 MB/s × 86,400 ≈ 1.04 TB/day' },
        { label: 'Time to fill 2 TB', calc: '2 TB ÷ 1.04 TB/day ≈ 1.9 days (≈ 14 h if sustained at peak: 2 TB ÷ 40 MB/s ≈ 50,000 s)' },
      ],
      answer:
        'Async failover loses ~8 MB of WAL normally and ~200 MB in bursts; the primary sends ~1.3 Gbit/s at peak to its consumers; an abandoned slot fills 2 TB in ~14 hours at peak or ~2 days on average.',
      insight:
        'Size the network for replication fan-out (or cascade replicas), use sync/quorum replication where losing seconds of commits is unacceptable, and always cap slot retention (max_slot_wal_keep_size) with alerts — an idle CDC connector can take down the primary in under a day.',
      followUps: [
        {
          "q": "The business sets RPO at 1 MB of WAL during bursts. Does async replication meet it, and what would you change?",
          "a": "No. At 40 MB/s, 1 MB is 25 ms of lag; in-region async typically runs about 200 ms and up to 5 s in bursts (8–200 MB at risk). To meet it, run quorum sync to an in-AZ or cross-AZ standby (`ANY 1 (s1, s2)`), giving RPO 0 for single-node or AZ loss at about +1–2 ms per commit. Keep cross-region DR async with a separately stated RPO. Also cut burst WAL with wal_compression and batch loads, which shrinks the at-risk window for the async replicas."
        },
        {
          "q": "Egress from the primary is 1.3 Gbit/s at peak and its NIC is shared with client traffic. How do you cut the fan-out?",
          "a": "Use cascading replication: the primary streams to one or two replicas, and the others stream from those (`primary_conninfo` pointing at a replica). Primary egress falls from 4×320 Mbit/s to 1–2×320 Mbit/s. The cost is extra lag on downstream replicas (one more hop, ~ms in region) and a dependency: if the intermediate replica dies, its children must be repointed. Put the CDC slot on a dedicated replica if your PG version supports logical decoding on standbys (PG16+). Enable wal_compression to shrink every stream."
        }
      ],
    },
    {
      id: 'db-replication-boe-2',
      question:
        'A read-heavy API does 60K reads/s and 3K writes/s. One Postgres node handles ~20K reads/s of this query mix. How many replicas do you need, and what happens if 10% of reads must be read-your-writes?',
      assumptions: [
        'Primary spends ~40% of capacity on writes (3K/s) and can serve ~12K reads/s on top',
        'Replicas: ~20K reads/s each, target 60% utilisation (12K/s) for headroom and failover',
        'Read-your-writes reads go to primary unless a replica is caught up (LSN check); with ~200 ms lag, ~70% of them can still use replicas',
      ],
      steps: [
        { label: 'Reads on replicas (no RYW)', calc: '60K reads/s ÷ 12K per replica = 5 replicas' },
        { label: 'N+1 for replica failure', calc: '5 + 1 = 6 replicas' },
        { label: 'RYW reads (naive: all to primary)', calc: '10% × 60K = 6K/s on primary → fits within its ~12K spare' },
        { label: 'RYW with LSN tokens', calc: '30% of 6K = 1.8K/s on primary; 4.2K/s stay on replicas' },
        { label: 'Replica write load', calc: 'Each replica replays 3K writes/s — must have primary-class I/O' },
      ],
      answer:
        '~5 replicas for load, 6 with N+1. Sending all RYW reads to the primary (6K/s) fits but consumes half its spare capacity; LSN-based routing cuts that to ~1.8K/s.',
      insight:
        'Consistency rules change capacity: every read forced to the primary eats capacity that cannot be scaled horizontally. Causal tokens keep the primary for writes and the reads that truly need it.',
      followUps: [
        {
          "q": "Traffic triples to 180K reads/s and 9K writes/s. Does the replica plan still work?",
          "a": "Reads: 180K ÷ 12K ≈ 15 replicas, 16–17 with N+1. Writes break first: 9K writes/s is about 3× the primary's write load, so it no longer has ~40% headroom for its own reads and may be saturated by writes alone. Every one of the 15 replicas must also replay 9K writes/s, so replay throughput (single-threaded) and primary egress (15 WAL streams, use cascading) become problems. RYW reads to the primary (30% × 18K = 5.4K/s) won't fit. This is the point to cache hot reads (Redis cuts replica count a lot) and shard writes by key."
        }
      ],
    },
    {
      id: 'db-replication-boe-3',
      question:
        'What does synchronous replication cost in commit latency and hot-row throughput for (a) a standby in another AZ and (b) a standby in another region?',
      assumptions: [
        'Local commit (WAL fsync on NVMe) ≈ 0.5 ms',
        'Inter-AZ RTT ≈ 1 ms; standby fsync ≈ 0.5 ms',
        'Mumbai ↔ Singapore RTT ≈ 60 ms; standby fsync ≈ 0.5 ms',
        'Hot row: lock held until commit returns; other work in tx ≈ 1 ms',
      ],
      steps: [
        { label: 'Async commit latency', calc: '≈ 0.5 ms' },
        { label: '(a) Sync cross-AZ', calc: '0.5 + 1 (RTT) + 0.5 (remote fsync) ≈ 2 ms (local and remote flush overlap partly, so ~1.5–2 ms)' },
        { label: '(b) Sync cross-region', calc: '0.5 + 60 + 0.5 ≈ 61 ms' },
        { label: 'Hot-row ceiling async', calc: '1 ÷ (1 + 0.5) ms ≈ 670 tx/s' },
        { label: 'Hot-row ceiling (a)', calc: '1 ÷ (1 + 2) ms ≈ 330 tx/s' },
        { label: 'Hot-row ceiling (b)', calc: '1 ÷ (1 + 61) ms ≈ 16 tx/s' },
      ],
      answer:
        'Cross-AZ sync adds ~1–1.5 ms per commit (hot-row ceiling ~670 → ~330 tx/s); cross-region sync adds ~60 ms (ceiling ~16 tx/s on a hot row).',
      insight:
        'Sync replication within a region is affordable and gives RPO 0 for AZ failures; cross-region sync is only viable for low-contention, latency-tolerant writes — which is why regional DR is usually async with a stated RPO.',
      followUps: [
        {
          "q": "The hot row is a global sequence counter for invoice numbers, hit by every checkout. With cross-AZ sync you're capped at ~330 tx/s. How do you raise the ceiling without giving up sync?",
          "a": "Keep the counter's lock out of the slow commit path. Use a Postgres `SEQUENCE`: `nextval` isn't transactional and doesn't hold a row lock until commit, so throughput is limited only by sequence WAL logging, at thousands per second. If invoice numbers must be gapless (a legal requirement in some countries), assign them asynchronously in a single batch worker that numbers N invoices per transaction, giving ~330 batches/s × 100 = 33K/s. Otherwise allocate number ranges per shard or pod (blocks of 1,000). The sync commit cost stays, but the serialized part shrinks to one commit per batch."
        }
      ],
    },
  ],
  test: [
    {
      id: 'db-replication-mcq-01',
      difficulty: 'medium',
      question:
        'A team adds four read replicas to a Postgres primary whose CPU is 90% busy, almost entirely from INSERT/UPDATE traffic and autovacuum. What happens to primary CPU?',
      options: [
        'It drops to ~20% because load spreads across five nodes',
        'It stays roughly the same (or rises slightly), because replicas replay writes but cannot accept them',
        'It drops by half because replicas perform vacuum for the primary',
        'The replicas absorb writes after they are promoted to multi-primary mode',
      ],
      correct: [1],
      explanation:
        'Single-leader replication sends every write to the primary; replicas replay the same changes and can only serve reads. Vacuum still runs on the primary (replicas replay its effects). Streaming replicas cannot become write nodes without failover. Offloading writes needs write reduction, vertical scaling, or partitioning.',
      followUps: [
        {
          "q": "Adding replicas is off the table. The primary is at 90% CPU from writes and autovacuum. What are your first three concrete moves, in order?",
          "a": "1) Find the write hogs in `pg_stat_statements` (total time on INSERT/UPDATE) and `pg_stat_user_tables` (n_tup_upd, n_tup_hot_upd): drop unused indexes (`idx_scan = 0`) and restore HOT updates — often a 20–40% CPU win. 2) Reduce write volume at the source: batch inserts, stop rewriting unchanged rows (`UPDATE ... WHERE col IS DISTINCT FROM $1`), move counters or last-seen fields to Redis. 3) Tune autovacuum per table so it runs small and often instead of huge passes. If that buys only months, plan vertical scaling, then partitioning or sharding by tenant."
        }
      ],
    },
    {
      id: 'db-replication-mcq-02',
      difficulty: 'hard',
      question:
        'With the configuration below, one of the two listed standbys crashes. What happens to commits on the primary?',
      code: {
        language: 'text',
        code: `synchronous_standby_names = 'ANY 1 (pg_b, pg_c)'
synchronous_commit = on`,
      },
      options: [
        'All commits block until both standbys are back',
        'The primary shuts down to protect consistency',
        'Commits become asynchronous for all standbys automatically',
        'Commits continue; each waits for the surviving standby to flush the WAL',
      ],
      correct: [3],
      explanation:
        'ANY 1 means a quorum of one from the listed standbys must confirm; the surviving standby satisfies it, so commits proceed with the same guarantee. Blocking would happen only if no listed standby were available. Postgres does not silently downgrade to async (Patroni can, if configured). It never shuts down for this.',
      followUps: [
        {
          "q": "Now pg_c dies too, leaving no listed standby. Commits hang. How do you restore writes during the incident, and what have you given up?",
          "a": "Commits wait forever for a standby flush, so clients time out while holding locks. Options: set `synchronous_standby_names = ''` and `SELECT pg_reload_conf()` (writes resume as async), or bring up a fresh standby and add it to the list. Removing sync means any primary failure before a standby catches up loses acknowledged commits, so RPO is no longer zero; record the window. Patroni's `synchronous_mode` can do this switch automatically, but with `synchronous_mode_strict` it refuses and keeps blocking. Choose based on whether durability or availability matters more for this database, and alert on the downgrade."
        }
      ],
    },
    {
      id: 'db-replication-mcq-03',
      difficulty: 'expert',
      question:
        'A user updates their email (commit on primary at LSN 5/1A00) and immediately reloads. Which routing strategies guarantee they see the new email? Select ALL that apply.',
      options: [
        'Read from any replica where pg_last_wal_replay_lsn() >= \'5/1A00\', otherwise from the primary',
        'Read from a random replica — lag is usually under 100 ms',
        'Read from the primary for this user for 30 s after any write (with 30 s well above observed max lag), falling back to an LSN check if lag exceeds it',
        'Commit with synchronous_commit = remote_write and read from that sync standby',
        'Commit with synchronous_commit = remote_apply and read from that sync standby',
      ],
      correct: [0, 2, 4],
      explanation:
        'An LSN check proves the replica has replayed the commit. Primary-for-N-seconds works as long as N exceeds actual lag, and adding an LSN fallback covers outliers. remote_apply returns only after the standby has applied the commit, so reads there see it. A random replica is only probably fresh. remote_write means the standby has received/written WAL but not necessarily applied it, so a read there can still be stale.',
      followUps: [
        {
          "q": "The user has the app open on their laptop and their phone. The LSN token is stored in the laptop's cookie. Does read-your-writes still hold on the phone, and how would you fix it?",
          "a": "No. The phone carries no token, so it may read a stale replica and the user won't see their own edit. Read-your-writes is per user, not per device, so the token has to live server-side: store `last_write_lsn:{userId}` in Redis with a TTL of a few minutes (longer than the worst replica lag) on every write. Every read for that user looks it up and routes to a replica only if its replay LSN is at or past the stored value. That costs one Redis GET per read; skip the lookup for anonymous or read-only users."
        }
      ],
    },
    {
      id: 'db-replication-mcq-04',
      difficulty: 'hard',
      question:
        'A CDC connector (Debezium) using a logical replication slot was shut down during a migration and forgotten. What happens over the next days?',
      options: [
        'Postgres drops the slot automatically after 24 hours',
        'Nothing; logical slots only hold metadata',
        'The slot keeps its restart_lsn, so the primary retains all WAL since then; pg_wal grows until the disk fills and the primary stops accepting writes (unless max_slot_wal_keep_size invalidates the slot)',
        'Replicas start lagging because the slot throttles WAL senders',
      ],
      correct: [2],
      explanation:
        'Replication slots guarantee WAL retention for their consumer, active or not. An abandoned slot therefore grows pg_wal indefinitely, and a full WAL disk crashes the primary. max_slot_wal_keep_size (PG13+) caps retention by invalidating the slot. Postgres does not expire slots by age, slots do retain WAL (not just metadata), and they do not throttle other WAL senders.',
      followUps: [
        {
          "q": "You set max_slot_wal_keep_size = 200GB to protect the primary. Debezium comes back after the slot was invalidated. What does it do, and how do you recover without losing events?",
          "a": "The slot is invalidated (`wal_status = 'lost'` in `pg_replication_slots`), so the connector cannot resume from its stored offset because that WAL is gone. Debezium errors out. Recover by dropping the slot, creating a new one and running a fresh snapshot (`snapshot.mode = initial` or an incremental snapshot via signal table) so downstream gets current state. Consumers must be idempotent (upserts keyed by primary key) because the snapshot replays rows they already have. Prevent recurrence with alerts on `pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)` and on `active = false` for longer than ~15 minutes."
        }
      ],
    },
    {
      id: 'db-replication-mcq-05',
      difficulty: 'expert',
      question:
        'What is wrong with this lag check used to decide whether a replica is healthy?',
      code: {
        language: 'sql',
        code: `-- run on the replica every 5 s; eject if > 10 s
SELECT extract(epoch FROM now() - pg_last_xact_replay_timestamp()) AS lag_seconds;`,
      },
      options: [
        'pg_last_xact_replay_timestamp() only exists on the primary',
        'The value is in milliseconds, not seconds',
        'It measures time since the last replayed commit, so it grows when the primary is idle, falsely ejecting fully caught-up replicas; combine with byte lag (receive vs replay LSN) or a heartbeat table',
        'It includes network latency twice, overestimating lag by 2×',
      ],
      correct: [2],
      explanation:
        'The function returns the commit timestamp of the last transaction replayed. If the primary commits nothing for 10 minutes, the value is 10 minutes old even though the replica is up to date. Robust monitoring uses byte lag from pg_stat_replication, receive vs replay LSN on the replica, or a heartbeat row updated every second. The function exists on standbys, returns a timestamptz, and is unrelated to network round trips.',
      followUps: [
        {
          "q": "You switch to a heartbeat table updated every second on the primary. What does the lag check look like, and what can still fool it?",
          "a": "A job on the primary runs `UPDATE heartbeat SET ts = now()` every second. On the replica, lag = `now() - (SELECT ts FROM heartbeat)`, which is about 1 s even when the primary is idle, because there's always a fresh write to replay. What can still fool it: clock skew between primary and replica hosts adds directly to the number (keep NTP/chrony tight), a dead heartbeat job looks like growing lag (alert on that separately), and the 1 s granularity can't see lag below the update interval. Pair it with byte lag from `pg_stat_replication` to tell 'nothing to replay' apart from 'stuck'."
        }
      ],
    },
    {
      id: 'db-replication-mcq-06',
      difficulty: 'hard',
      question:
        'Leaderless store: N = 5, W = 3, R = 2. A client reads immediately after another client\'s successful write. What is guaranteed?',
      options: [
        'The read always returns the new value because W > N/2',
        'Nothing about overlap — W + R = 5 is not greater than N, so the read may hit two replicas that both missed the write',
        'The read returns the new value only if read repair is enabled',
        'The read fails because R must be at least W',
      ],
      correct: [1],
      explanation:
        'Overlap requires W + R > N; here 3 + 2 = 5 equals N, so the 2 replicas read may both be among the 2 that did not receive the write. W > N/2 prevents two conflicting writes from both reaching a majority but says nothing about reads. Read repair fixes replicas after a read that sees divergence, but cannot find a value neither queried replica has. R need not be ≥ W.',
      followUps: [
        {
          "q": "You change to W = 3, R = 3 (W + R > N). During a partition only 3 of 5 nodes are reachable and the write coordinator stores two of its copies on fallback nodes (sloppy quorum). Is the read still guaranteed to see the write?",
          "a": "No. With sloppy quorum and hinted handoff, a write can be acknowledged by 3 nodes that aren't all among the key's 5 home replicas. A read of 3 home replicas may then miss it until the hints are handed off after the partition heals. W + R > N only guarantees overlap when both quorums are drawn from the same N nodes. Riak and Dynamo-style systems trade this away for write availability. Cassandra doesn't count hints toward consistency levels (except ANY), so QUORUM there means real replicas, and writes fail instead when too few are reachable."
        }
      ],
    },
    {
      id: 'db-replication-mcq-07',
      difficulty: 'expert',
      question:
        'Your NestJS service uses TypeORM replication (master + 2 slaves). Which of these code paths can read stale data from a replica? Select ALL that apply.',
      code: {
        language: 'typescript',
        code: `// A
await ds.transaction(async (m) => { const o = await m.findOneBy(Order, { id }); /* ... */ });
// B
const o = await ds.getRepository(Order).findOneBy({ id });   // right after a save()
// C
const qr = ds.createQueryRunner('master'); const o = await qr.manager.findOneBy(Order, { id });
// D
const o2 = await ds.createQueryBuilder(Order, 'o').where('o.id = :id', { id }).getOne();
// E
await ds.getRepository(Order).save(order);`,
      },
      options: ['A', 'B', 'C', 'D', 'E'],
      correct: [1, 3],
      explanation:
        'With replication configured, TypeORM runs SELECT query builders outside a transaction (repository find methods use them internally) on a slave-mode query runner, so B and D can be stale — B is the classic read-after-write bug. Transactions (A) run on master, an explicit master query runner (C) uses the primary, and save (E) is a write that always goes to master. (Raw DataSource.query() defaults to master, a detail worth verifying in your TypeORM version.)',
      followUps: [
        {
          "q": "You fix B by wrapping the read in a transaction. Six months later CPU on the primary has doubled. What happened, and what is a more targeted fix?",
          "a": "Developers copied the pattern: wrapping reads in transactions became the house way to avoid staleness, so most reads silently moved to the master and the replicas sit idle. Be targeted instead: send only the read-after-write paths to master (for example an explicit `createQueryRunner('master')` helper called `readOwnWrites()`), or use an LSN token so replicas serve fresh-enough reads. Make it observable by tagging queries (`application_name` or SQL comments) and comparing per-pool QPS on dashboards, with an alert when the master's read share goes above a budget such as 20%."
        }
      ],
    },
    {
      id: 'db-replication-mcq-08',
      difficulty: 'hard',
      question:
        'An analytics query on a hot standby keeps failing after ~30 s with "canceling statement due to conflict with recovery". Which change stops the cancellations with the least impact on the OLTP primary?',
      options: [
        'Move analytics to a dedicated standby with max_standby_streaming_delay = -1 (accepting that it may lag far behind), and keep it out of failover and OLTP read pools',
        'Increase max_connections on the standby',
        'Enable hot_standby_feedback on the standby',
        'Set synchronous_commit = remote_apply on the primary',
      ],
      correct: [0],
      explanation:
        'A dedicated analytics standby that waits indefinitely for queries before replaying conflicting WAL avoids cancellations without affecting the primary; it will lag, so it must not serve fresh reads or be a failover candidate. hot_standby_feedback also stops most cancellations, but holds back vacuum on the primary, causing bloat on OLTP tables. Connections and synchronous_commit have nothing to do with recovery conflicts.',
      followUps: [
        {
          "q": "The analytics standby with infinite delay now lags 6 hours after a heavy report day. Analysts complain the dashboards are stale. What are your options?",
          "a": "Unbounded delay means one long query can stop replay for its whole duration, so lag adds up. Options: cap query runtime (`statement_timeout` of about 30 min for analysts) so replay gets windows to catch up; set a finite `max_standby_streaming_delay` such as 15 min as a compromise; schedule heavy reports off-peak; or move analytics off physical replication completely, using logical replication or CDC into a warehouse (ClickHouse, BigQuery) where long scans never block apply. Show the freshness on the dashboard ('data as of 14:02') so people know how old it is."
        }
      ],
    },
    {
      id: 'db-replication-mcq-09',
      difficulty: 'expert',
      question:
        'During a network partition, a two-node Postgres setup with a custom failover script promotes the replica while the old primary keeps serving some clients. Which mechanisms would have prevented split brain? Select ALL that apply.',
      options: [
        'A consensus store (etcd, 3 members across 3 AZs) holding a leader lease that the primary must renew, with self-demotion when it cannot',
        'Lowering the DNS TTL of the primary endpoint to 5 s',
        'Fencing the old primary (STONITH: revoke VIP, stop instance) before or as part of promotion',
        'Requiring a synchronous standby ack for commits, so an isolated primary cannot commit',
        'Increasing the failover detection timeout from 10 s to 60 s',
      ],
      correct: [0, 2, 3],
      explanation:
        'A majority-backed lease ensures only one node believes it may be primary and the isolated one steps down; fencing forcibly stops the old primary; synchronous commit prevents an isolated primary from acknowledging writes because it cannot reach a standby. A shorter DNS TTL does not stop clients already connected (or ignoring TTL). A longer timeout only reduces false positives — a real partition still leaves two primaries.',
      followUps: [
        {
          "q": "With the etcd lease in place, the old primary is partitioned but its lease has 8 seconds left. Can it still accept writes during those 8 s, and how do you close that gap?",
          "a": "Yes. Until its lease expires the isolated primary believes it's leader, and a GC pause or clock drift can stretch that further. Close the gap so the two windows never overlap: the new leader waits longer than the full lease TTL plus a skew margin before promoting (Patroni waits out `ttl`), the old primary demotes itself as soon as a renewal fails rather than waiting for expiry, and a synchronous standby means it can't acknowledge commits anyway. Add fencing tokens (a monotonically increasing epoch checked by downstream systems) and a watchdog that hard-resets a node that misses its own deadline."
        }
      ],
    },
    {
      id: 'db-replication-mcq-10',
      difficulty: 'medium',
      question:
        'You need to upgrade Postgres 13 → 16 with under a minute of write downtime on a 3 TB database. Which approach fits?',
      options: [
        'Add a PG16 physical streaming replica and promote it',
        'pg_dump and pg_restore during a maintenance window',
        'Logical replication from PG13 to a PG16 cluster, catch up, fix sequences, then switch writes',
        'Run pg_upgrade on a running primary without stopping it',
      ],
      correct: [2],
      explanation:
        'Logical replication works across major versions: the new cluster is initially synced and then streams row changes, so cutover is a brief write freeze plus sequence fixes (sequences and DDL are not replicated). Physical streaming requires the same major version. pg_dump/restore of 3 TB takes hours. pg_upgrade requires the cluster to be stopped (fast with --link, but not zero-downtime for writes).',
      followUps: [
        {
          "q": "Walk through the actual cutover minute for the logical-replication upgrade. What can go wrong, and how do you roll back?",
          "a": "Steps: set the old primary read-only (`default_transaction_read_only = on` plus terminating sessions, or block at PgBouncer by pausing), wait until the subscription's `received_lsn` matches the source's current LSN, then sync sequences with `setval` set to source value + margin. Repoint PgBouncer or DNS to PG16 and resume. Pitfalls: tables without a primary key or replica identity don't replicate UPDATE/DELETE, DDL isn't replicated, and large objects aren't either. Rollback: set up reverse logical replication from PG16 to PG13 before opening writes, so you can switch back without losing post-cutover writes."
        }
      ],
    },
    {
      id: 'db-replication-mcq-11',
      difficulty: 'expert',
      question:
        'A bulk job runs a single DELETE removing 400M old rows on the primary. Which effects on replication should you expect? Select ALL that apply.',
      options: [
        'A large burst of WAL (tuple deletions and full-page images) that replicas must replay, causing replication lag to spike',
        'Replicas skip the DELETE because they only replicate INSERTs',
        'The replicas show the deleted rows as gone only after the transaction commits, so lag appears as a sudden jump at commit time as well as during replay',
        'Subsequent vacuum on the primary generates further WAL that replicas must also replay',
        'Logical replication subscribers receive one message for the whole DELETE regardless of row count',
      ],
      correct: [0, 2, 3],
      explanation:
        'Deleting 400M rows writes WAL for every tuple (plus full-page writes), which replicas replay single-threaded, so lag spikes; visibility changes only at commit; and the subsequent VACUUM produces more WAL. Replicas replay all changes, not just inserts. Logical decoding emits one change per row, so subscribers receive 400M delete events. Better: delete in small batches, or partition by time and DROP PARTITION.',
      followUps: [
        {
          "q": "Rewrite the purge so replicas and CDC consumers stay healthy. What batch size would you pick and how would you pace it?",
          "a": "Delete in key-ordered batches, `DELETE FROM t WHERE id IN (SELECT id FROM t WHERE created_at < $cut ORDER BY id LIMIT 5000)`, each in its own transaction. Pace it on feedback: after each batch check replica byte lag and CDC slot lag, sleep while either is over a threshold (say 64 MB), and stop at business peak. Tune the batch so each takes about 100–500 ms. Let autovacuum (or an explicit VACUUM) run during the purge so bloat doesn't build up. The long-term fix is time partitioning, where `DROP PARTITION` produces almost no WAL and no per-row CDC events."
        }
      ],
    },
    {
      id: 'db-replication-mcq-12',
      difficulty: 'hard',
      question:
        'A user sees a new comment on refresh, then refreshes again and the comment is gone, then it reappears. Reads are load-balanced randomly across three async replicas. Which guarantee is being violated and what is the simplest fix?',
      options: [
        'Linearizability; move to synchronous replication for all replicas',
        'Read-your-writes; route the commenter to the primary',
        'Consistent prefix; write comments and posts to the same partition',
        'Monotonic reads; pin each user\'s reads to the same replica (e.g. hash of user id), or track the highest LSN seen',
      ],
      correct: [3],
      explanation:
        'Seeing newer data and then older data across successive reads violates monotonic reads — the user hit a fresher replica and then a laggier one. Pinning a user to one replica, or keeping a per-user LSN floor, fixes it. The viewer did not write the comment, so read-your-writes is not the issue. Consistent prefix concerns causally related writes appearing out of order. Full sync replication is overkill.',
      followUps: [
        {
          "q": "You pin users to replicas by hash of user id. One replica dies. What happens to monotonic reads for its users, and how do you keep the guarantee?",
          "a": "Its users get rehashed onto other replicas, which may be further behind than the dead one was, so they can see time go backwards once during failover. Plain hashing also moves users between healthy replicas whenever the pool changes; consistent hashing limits that churn. For a real guarantee, keep a per-session high-water mark: return the replica's replay LSN with each response (cookie or header), and on later reads only use a replica whose `pg_last_wal_replay_lsn()` is at or past it, otherwise wait briefly or go to the primary. Pinning then just improves cache locality, and the LSN floor is what keeps reads monotonic."
        }
      ],
    },
    {
      id: 'db-replication-mcq-13',
      difficulty: 'expert',
      question:
        'What does this function return, and when is it safe to use?',
      code: {
        language: 'typescript',
        code: `async function readAfter(replica: Pool, token: string, sql: string, p: unknown[]) {
  const deadline = Date.now() + 200;
  while (Date.now() < deadline) {
    const { rows } = await replica.query(
      'SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn AS ok', [token]);
    if (rows[0].ok) return (await replica.query(sql, p)).rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null; // caller falls back to the primary
}`,
      },
      options: [
        'Results from the replica only once it has replayed at least up to the token LSN (waiting up to 200 ms), else null so the caller can use the primary — safe for read-your-writes if the token is the commit LSN from the primary',
        'Always the latest data, because pg_last_wal_replay_lsn() forces the replica to catch up',
        'It returns results from the primary when the replica is behind',
        'It is unsafe because LSNs cannot be compared across primary and replica',
      ],
      correct: [0],
      explanation:
        'The loop polls until the replica\'s replay position reaches the token, then runs the query there; after 200 ms it gives up and lets the caller use the primary, bounding latency. LSNs are positions in the same WAL stream, so they are comparable between a primary and its physical replicas (not after a failover to a new timeline without care). The function does not force catch-up, and it never queries the primary itself.',
      followUps: [
        {
          "q": "This function runs for every read after a write at 5,000 req/s. What does it cost, and how would you make it cheaper?",
          "a": "Each call makes at least two replica round trips (the LSN check plus the query), and when the replica is behind it polls every 20 ms for up to 200 ms, holding a pooled connection and adding up to 200 ms latency. At 5K req/s that's 5K+ extra queries/s. Cheaper: check `pg_last_wal_replay_lsn()` and run the query in one statement or round trip; or have a background loop cache each replica's replay LSN every ~10 ms in memory and compare locally (no round trip, with slightly conservative routing). Use one connection for check and query so they hit the same server."
        },
        {
          "q": "The primary fails over to a replica on a new timeline. Clients still hold tokens from the old primary. What can go wrong with this comparison?",
          "a": "The old primary may have written WAL past the point where the new primary's timeline forked. A token like 5/1A00 from the old primary may refer to a commit that was never replicated and is now lost, yet the new timeline will pass that LSN with different data. So `replay_lsn >= token` returns true and claims freshness for a write that no longer exists. Mitigate by putting the timeline ID or a cluster epoch in the token and treating tokens from an old epoch as 'route to primary' (or discard them). Also alert on lost commits, because read-your-writes can't bring back data the failover dropped."
        }
      ],
    },
    {
      id: 'db-replication-mcq-14',
      difficulty: 'medium',
      question:
        'A company replicates asynchronously from Mumbai (primary) to Singapore for DR. Mumbai goes down. What does promoting Singapore imply?',
      options: [
        'Zero data loss, because replication is continuous',
        'Loss of any commits not yet replicated at the moment of failure (the RPO equals the lag), plus the need to repoint clients and later reconcile or discard Mumbai\'s unreplicated writes',
        'Singapore cannot be promoted until Mumbai comes back to confirm its last LSN',
        'All replicas must be rebuilt from backups before accepting writes',
      ],
      correct: [1],
      explanation:
        'With async replication, commits acknowledged in Mumbai but not yet shipped are lost on promotion; RPO equals the lag at failure. When Mumbai returns, its divergent writes must be rewound (pg_rewind) and reconciled if needed. Continuous async replication is not zero loss, promotion does not require the old primary, and other replicas can be repointed to follow the new primary rather than rebuilt.',
      followUps: [
        {
          "q": "Mumbai comes back an hour later with 4,000 commits that never reached Singapore, and Singapore has taken 1 hour of new writes. How do you handle the divergent data?",
          "a": "First, keep Mumbai from serving traffic (fence it). Before running `pg_rewind`, extract its divergent transactions: use `pg_waldump` on the WAL after the fork LSN, or logically decode from a copy, to export changed rows. Then rewind Mumbai to follow Singapore. Reconcile per domain: replay idempotent inserts (orders with unique external ids) when they don't conflict; send payments and inventory changes to manual or finance review; let the payment provider's records be the source of truth for charges. Document the RPO incident and contact the affected customers."
        }
      ],
    },
    {
      id: 'db-replication-mcq-15',
      difficulty: 'hard',
      question:
        'Why might a Postgres physical replica on identical hardware fall further and further behind a primary running a highly concurrent write workload?',
      options: [
        'Replicas apply WAL with a single startup process, while the primary generates it from many concurrent backends; replay throughput can be lower than generation during heavy write bursts',
        'Replicas must re-execute every SQL statement and re-plan queries',
        'Replicas apply WAL only once per checkpoint interval',
        'The replica needs to vacuum every table before applying changes',
      ],
      correct: [0],
      explanation:
        'Postgres WAL replay is performed by a single startup process (with prefetching since PG15), so a primary with dozens of concurrent writers can outpace it, especially with random I/O. Physical replicas replay WAL records, not SQL; they apply continuously, not per checkpoint; and vacuum is replayed from the primary\'s WAL rather than run independently. Mitigations: reduce WAL volume, faster storage, or MySQL-style parallel apply where available.',
      followUps: [
        {
          "q": "Lag keeps growing during the nightly ETL even after faster disks. You can't change the ETL logic. What else could reduce replay pressure?",
          "a": "Reduce WAL volume or make replay cheaper: enable `wal_compression` (lz4/zstd) to shrink full-page images; lengthen `checkpoint_timeout` or raise `max_wal_size` so fewer full-page writes follow each checkpoint; load ETL staging data into UNLOGGED tables, which produce no WAL (they're empty after a crash, acceptable for staging); drop indexes on the staging target during the load. On the replica, PG15+ `recovery_prefetch` speeds up random-I/O replay. Measure with `pg_stat_wal` (bytes, FPI count) before and after, and watch replay lag in bytes."
        }
      ],
    },
  ],
};

export default topic;
