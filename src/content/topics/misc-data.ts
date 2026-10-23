import type { Topic } from '../../types';

const topic: Topic = {
  id: 'misc-data',
  phase: 'miscellaneous',
  order: 4,
  title: 'Indexes, Pools, Replication, Sharding, Transactions & Migrations',
  subtitle:
    'Question bank: fresh angles on indexing, connection pooling, replication, read replicas, sharding, partitioning, transactions, isolation levels, schema evolution and zero-downtime migrations — with Postgres vs MySQL differences called out.',
  estimatedMinutes: 120,
  sources: [
    'PostgreSQL 18 release notes (skip scan, uuidv7(), NOT NULL NOT VALID) — postgresql.org',
    'PostgreSQL docs — Ch 13 Concurrency Control, Ch 26 High Availability, Ch 5.12 Table Partitioning, ALTER TABLE',
    'MySQL 8.0 Reference Manual — InnoDB Locking, Transaction Isolation Levels, Replication Formats, Online DDL, Partitioning Limitations',
    'PgBouncer changelog / pganalyze — prepared statements in transaction mode (1.21+)',
    'Martin Kleppmann — Designing Data-Intensive Applications, Ch 5–7',
    'LeetCode Discuss — Salesforce LMTS India interview experience (Sept 2025)',
    'DesignGurus — Dream11 and Paytm interview process guides',
    'DEV Community — "The replication lag question that shows up in most senior interviews"',
    'Expand/contract migration write-ups (DEV Community, Substack) — "add a NOT NULL column to a 500M-row table", "rename a column read on every request"',
    'GitHub gh-ost and Percona pt-online-schema-change documentation',
  ],
  tags: [
    'indexing',
    'connection-pooling',
    'replication',
    'read-replicas',
    'sharding',
    'partitioning',
    'transactions',
    'isolation-levels',
    'schema-evolution',
    'migrations',
    'postgres',
    'mysql',
  ],
  cheatSheet: [
    'Index choice starts from the query, not the column: equality columns first, then range/sort. Postgres 18 skip scan can use (a, b) for WHERE b = … when a has few distinct values, but it is a fallback, not a design strategy.',
    'Random UUIDv4 keys scatter B-tree inserts → cache misses, page splits and extra full-page WAL writes after each checkpoint; bigint or time-ordered UUIDv7 (uuidv7() in PG 18) keep inserts at the right edge.',
    'InnoDB tables ARE the primary-key B-tree and every secondary index stores the PK, so a wide or random PK costs you in every index. Postgres heaps are unordered; indexes point at ctid.',
    'node-postgres Pool defaults: max 10, idleTimeoutMillis 10 s, connectionTimeoutMillis 0 = wait forever. Always set an acquire timeout, and never take a second connection while holding one (pool deadlock).',
    'After a failover, pools hold sockets to the demoted node: set a max connection lifetime, evict on read-only errors, and connect with target_session_attrs=read-write (libpq) / targetServerType=primary (pgJDBC).',
    'MySQL statement-based binlog: NOW() is safe (timestamp is logged); UUID(), SYSDATE() and UPDATE/DELETE … LIMIT without ORDER BY are not. ROW has been the default since 5.7.7.',
    'Postgres synchronous_commit: remote_write < on (standby flushed) < remote_apply (visible on standby) — only remote_apply gives read-your-writes on that standby.',
    'Replicas replicate your mistakes instantly; a delayed standby (recovery_min_apply_delay) or PITR from archived WAL is what saves a DROP TABLE.',
    'Sharding breaks global uniqueness, cross-shard joins and connection math (pods × shards × pool). Enforce unique email with a lookup table sharded by email; co-locate tables that join on the same distribution key.',
    'Partitioning ≠ sharding: one server, pruning only when the partition key is in the WHERE clause; Postgres has no global indexes, so PK/UNIQUE must include the partition key (MySQL: every unique key must include all partition columns; no FKs).',
    'Postgres aborts the whole transaction after any error (25P02) — use SAVEPOINTs; MySQL rolls back only the failed statement (except deadlocks). A lost COMMIT reply means "unknown outcome" — reconcile by idempotency key.',
    'Zero-downtime DDL = expand → dual-write/backfill in batches → switch reads → contract, each step with lock_timeout; NOT NULL via CHECK … NOT VALID + VALIDATE (PG 12+), FKs via NOT VALID + VALIDATE; run migrations once, not from every pod.',
  ],
  sections: [
    {
      heading: 'Database Indexing — design from the query, and know what the key costs you',
      body: `**What it is:** a sorted secondary structure (usually a B-tree) mapping key → row location, trading write cost and space for fast lookups and ordered scans.

**Mechanism.** A composite index (a, b, c) is sorted by a, then b, then c. It serves equality on a leading prefix, then one range or ORDER BY. **Postgres 18 added B-tree skip scan**: for \`WHERE b = 42\` on (a, b) it can probe each distinct value of a — cheap when a has 5 values, useless when a has 5 million.

**Key choice matters as much as index choice.**
- **InnoDB** stores the table *inside* the PK B-tree (clustered); each secondary index entry carries the PK, so a 36-byte string PK inflates every index.
- **Postgres** heaps are unordered, but random UUIDv4 keys still scatter index inserts across every leaf page: more cache misses, more page splits, and after each checkpoint the first touch of a page writes a full 8 KB image to WAL.
- Time-ordered keys (bigint identity, UUIDv7 — native \`uuidv7()\` in PG 18) append at the right edge.

**#1 trap:** answering "add an index" without naming the exact query, its selectivity, and the write/WAL cost on a write-heavy table.`,
      code: [
        {
          language: 'sql',
          title: 'Postgres 18: skip scan and time-ordered keys',
          code: `-- 6 regions, 400M rows
CREATE INDEX orders_region_created ON orders (region, created_at);

-- PG <= 17: cannot use the index efficiently (no region predicate)
-- PG 18: skip scan probes each of the 6 regions, then ranges on created_at
EXPLAIN SELECT id FROM orders
WHERE created_at >= now() - interval '1 hour';

-- New tables: time-ordered keys keep B-tree inserts on the right edge
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),   -- PG 18 built-in
  payload jsonb NOT NULL
);`,
        },
      ],
      source: 'PostgreSQL 18 release notes; MySQL 8.0 Manual — Clustered and Secondary Indexes',
    },
    {
      heading: 'Connection Pooling — a queue in front of a scarce resource',
      body: `**What it is:** a bounded set of open DB connections reused across requests, because each Postgres connection is a full OS process (several MB of RAM, ~1–3 ms plus TLS to open) and \`max_connections\` is usually a few hundred.

**Mechanism.** A request *acquires* a connection, runs, and *releases* it; when all are busy, callers queue. Size by Little's law: busy connections = throughput × hold time (2,000 q/s × 5 ms = 10). Beyond ~2–4× DB cores, more connections only add contention.

**Where pools bite in production**
- **Acquire timeout:** node-postgres defaults \`connectionTimeoutMillis\` to 0 — callers wait forever and requests pile up silently.
- **Nested acquisition:** code that holds a client and then calls \`pool.query()\` can deadlock the whole pool at saturation.
- **Failover:** pooled sockets still point at the old primary (now read-only) until they are recycled.
- **Serverless:** 1,000 Lambda instances × pool of 10 = 10,000 connections → one connection per instance plus RDS Proxy/PgBouncer.
- **PgBouncer transaction mode** multiplexes clients over few server connections; protocol-level prepared statements work only from 1.21 with \`max_prepared_statements\` > 0.

**#1 trap:** treating the pool as a performance knob ("raise max to 100") rather than a concurrency limit that protects the database.`,
      code: [
        {
          language: 'typescript',
          title: 'A pool with guard rails (node-postgres)',
          code: `import { Pool } from 'pg';

export const pool = new Pool({
  host: process.env.DB_HOST,
  max: 10,                        // per process; total = pods x processes x max
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000, // default 0 = wait forever
  maxLifetimeSeconds: 900,        // recycle so sockets follow DNS after failover
  statement_timeout: 5_000,       // server-side guard per statement
  idle_in_transaction_session_timeout: 10_000,
});

pool.on('error', (err) => {
  // idle client died (e.g. primary failover) — log; pool discards it
  console.error('idle pg client error', err.message);
});`,
        },
      ],
    },
    {
      heading: 'Replication — copying the change stream, including your mistakes',
      body: `**What it is:** the primary ships a log of changes (Postgres WAL, MySQL binlog) to other nodes that replay it, giving redundancy and read capacity.

**Mechanism and knobs**
- **Physical (Postgres streaming):** byte-for-byte page changes; the replica is an identical, read-only copy of the whole cluster and must run the same major version.
- **Logical (Postgres publications, MySQL row binlog):** row-level changes per table; subscribers can have extra indexes or be a different major version, but DDL is not replicated.
- **MySQL formats:** STATEMENT replays SQL text (non-deterministic functions such as UUID() or DELETE … LIMIT without ORDER BY diverge), ROW ships row images (default since 5.7.7), MIXED switches per statement.
- **Durability:** Postgres \`synchronous_commit\` = remote_write (standby received), on (standby flushed), remote_apply (standby replayed and visible). MySQL semi-sync with AFTER_SYNC waits for a replica ack before the commit becomes visible.

**Replication is not backup.** A \`DELETE\` without a WHERE reaches every replica within milliseconds. Keep a **delayed standby** (\`recovery_min_apply_delay = '1h'\`) and archived WAL for point-in-time recovery.

**#1 trap:** saying "we have three replicas, so we are safe from data loss" — safe from a lost *disk*, not from a bad *query*.`,
      diagram: `  primary --WAL--> sync standby (AZ-b)   RPO 0 if synchronous
     |------WAL--> async replica (AZ-c)  reads, lag ms..s
     '------WAL--> delayed standby (1h)  undo fat-finger DDL/DML
     '--archive--> object storage         PITR to any second`,
    },
    {
      heading: 'Read Replicas — read capacity with a consistency bill attached',
      body: `**What it is:** replicas that serve SELECT traffic so the primary spends its CPU on writes.

**Mechanism.** The app (or a proxy such as ProxySQL, pgpool, RDS/Aurora reader endpoints) routes reads to replicas. Async lag is usually milliseconds (Aurora typically under 100 ms) but spikes to minutes during bulk writes, vacuum, or long queries on the replica.

**What you must design for**
- **Staleness:** read-your-writes and monotonic reads need routing rules (pin recent writers to primary, LSN/GTID tokens, sticky replica per session).
- **Capacity N+1:** three replicas at 70% CPU become two at 105% when one fails. Plan for losing one.
- **Fallback storms:** a lag-aware router that sends *all* reads to the primary when replicas lag turns a lag event into a primary outage. Degrade instead: tolerate staleness for most endpoints, shed load.
- **Physical replicas cannot have their own indexes;** a reporting replica that needs different indexes must be a logical subscriber.
- **Writes and transactions:** anything inside a transaction that also writes must stay on the primary.

**#1 trap:** adding replicas for a write-bound or lock-bound primary. Replicas replay every write too, so they relieve read CPU only.`,
    },
    {
      heading: 'Sharding — splitting data across independent databases',
      body: `**What it is:** horizontal partitioning across *separate servers*, each owning a subset of keys, so writes and storage scale beyond one machine.

**Mechanism.** A shard key (tenant_id, user_id) maps through a function or directory to a logical shard, and logical shards map to physical clusters (Notion described 480 logical shards over 32 hosts; Instagram encoded the logical shard in each ID). Moving a logical shard is a copy + CDC catch-up + cutover.

**What sharding takes away**
- **Global constraints:** \`UNIQUE(email)\` only holds per shard. Use a lookup table sharded *by email* with insert-first reservation.
- **Joins and transactions** across shards: co-locate related tables on the same key (Citus "colocation", Vitess keyspace ids) so joins stay local.
- **Connection math:** each pod needs a pool per shard → pods × shards × pool size.
- **Operations multiply:** every migration, backup and upgrade runs N times and can half-succeed.

**Options in 2026:** app-level sharding on Postgres/MySQL; middleware (Vitess, Citus); or distributed SQL (CockroachDB, YugabyteDB, Spanner) that shards ranges automatically in exchange for higher per-write latency (consensus round trips).

**#1 trap:** picking a shard key that serves today's main query but makes the second most common query a 64-way scatter-gather.`,
    },
    {
      heading: 'Partitioning — one table, many physical pieces, one server',
      body: `**What it is:** splitting a large table into child tables by range, list or hash inside the *same* database, so maintenance and some queries touch only the relevant pieces.

**Mechanism (Postgres declarative partitioning).**
- The planner **prunes** partitions only when the partition key appears in the WHERE clause (at plan time, or at execution time for parameters).
- **No global indexes:** a PK or UNIQUE constraint must include the partition key, so \`order_id\` alone cannot be globally unique on a table partitioned by \`created_at\`.
- Retention becomes \`DETACH PARTITION … CONCURRENTLY\` (PG 14+) + \`DROP\` — instant, no bloat, no WAL storm — versus a 9-hour DELETE.
- A **DEFAULT partition** catches strays but makes every new partition creation scan it (and fail if it holds matching rows).
- Thousands of partitions increase planning time and lock overhead; aim for tens to low hundreds.

**MySQL differs:** every unique key must include *all* columns of the partitioning expression, and partitioned InnoDB tables cannot have foreign keys.

**#1 trap:** "partitioning will make queries faster". It helps queries that filter on the partition key and hurts those that don't (N index probes instead of one). Its main win is lifecycle management.`,
      code: [
        {
          language: 'sql',
          title: 'Monthly partitions with fast retention',
          code: `CREATE TABLE payments (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  created_at  timestamptz NOT NULL,
  merchant_id bigint NOT NULL,
  amount      numeric(12,2) NOT NULL,
  PRIMARY KEY (id, created_at)          -- must include the partition key
) PARTITION BY RANGE (created_at);

CREATE TABLE payments_2026_09 PARTITION OF payments
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

-- retention: seconds, not hours
ALTER TABLE payments DETACH PARTITION payments_2025_08 CONCURRENTLY;
DROP TABLE payments_2025_08;`,
        },
      ],
    },
    {
      heading: 'Transactions — one connection, one outcome, and the cases where you do not know it',
      body: `**What it is:** a group of statements that commit or roll back together (atomicity), with isolation from concurrent work and durability after COMMIT returns.

**Mechanism details interviewers probe**
- A transaction lives on **one connection**. \`pool.query('BEGIN')\` followed by \`pool.query(...)\` can run on different connections — you get autocommit plus a stray open transaction.
- **Postgres** marks the whole transaction failed after any error ("current transaction is aborted…", SQLSTATE 25P02) until ROLLBACK or ROLLBACK TO SAVEPOINT. **MySQL** rolls back only the failed statement and keeps going, except for deadlocks, which roll back the transaction.
- **DDL:** Postgres DDL is transactional (a failed migration rolls back cleanly); MySQL DDL causes an implicit commit.
- **Ambiguous commit:** if the connection drops after COMMIT is sent, the outcome is unknown. Retrying blindly can double-apply, so design writes with idempotency keys and check before retrying.
- **Keep them short:** never hold a transaction across HTTP calls. It holds row locks, pins the pool connection, and in Postgres holds back vacuum (xmin horizon). ORMs enforce limits (Prisma interactive transactions: \`maxWait\` 2 s, \`timeout\` 5 s by default).

**#1 trap:** assuming "it's in a transaction" means it is safe from concurrency bugs. That depends on the isolation level and the locks taken.`,
    },
    {
      heading: 'Isolation Levels — same names, different engines, different anomalies',
      body: `**What it is:** how much concurrent transactions can see of each other. The SQL standard defines levels by the anomalies they forbid; engines implement them differently.

**Postgres (MVCC snapshots)**
- READ UNCOMMITTED behaves as READ COMMITTED (the default): each *statement* sees a fresh snapshot.
- REPEATABLE READ = snapshot isolation. Updating a row that changed since your snapshot fails with a serialization error (40001). No phantoms, but write skew is possible.
- SERIALIZABLE = SSI. It aborts dangerous read/write patterns and needs retries. It is **not available on hot standbys** ("cannot use serializable mode in a hot standby").

**MySQL InnoDB (default REPEATABLE READ)**
- A plain SELECT reads a snapshot taken at the **first read**, not at BEGIN.
- UPDATE, DELETE and \`SELECT … FOR UPDATE\` read the **latest committed** row. A transaction can "see" 100, update against 70, then see its own 40.
- Locking reads take **next-key and gap locks** to block phantoms. Two sessions locking the same missing key and then inserting deadlock. READ COMMITTED mostly disables gap locking.

**Choosing:** READ COMMITTED + explicit row locks or conditional updates for most OLTP; SERIALIZABLE for complex invariants when the contention is low and you have a retry loop.

**#1 trap:** reciting the ANSI table without saying which engine. "REPEATABLE READ prevents lost updates" is true in Postgres (it errors), not for MySQL's read-then-write pattern.`,
      code: [
        {
          language: 'sql',
          title: 'MySQL RR: snapshot reads vs current reads',
          code: `-- T1 (REPEATABLE READ)             -- T2
START TRANSACTION;
SELECT balance FROM acct WHERE id=1;  -- 100 (snapshot taken here)
                                      UPDATE acct SET balance=70 WHERE id=1; COMMIT;
SELECT balance FROM acct WHERE id=1;  -- still 100 (snapshot)
UPDATE acct SET balance = balance - 30 WHERE id=1;  -- reads latest: 70 -> 40
SELECT balance FROM acct WHERE id=1;  -- 40 (own change on latest row)
COMMIT;
-- Postgres RR: the UPDATE fails with 40001 instead`,
        },
      ],
    },
    {
      heading: 'Schema evolution — the schema must serve two app versions at once',
      body: `**What it is:** changing the database schema while old code, new code, CDC pipelines and analytics consumers keep reading and writing it.

**Mechanism.** During a rolling deploy, v1 and v2 pods run at the same time, and a rollback brings v1 back. So every schema state must be compatible with **both the current and the previous** app version.
- **Additive changes are safe:** a nullable column or one with a default, a new table, a new index.
- **Destructive or renaming changes are not:** drop or rename a column, tighten a type, add NOT NULL without a default, change enum semantics. Split them across releases.
- **Hidden coupling:** ORMs that list every mapped column (or \`SELECT *\` in a prepared statement) break when a column disappears. Postgres raises "cached plan must not change result type" for a prepared \`SELECT *\` after a column change.
- **Downstream consumers:** Debezium/CDC topics, the warehouse and search indexers see your column rename as "drop one column, add another". Treat the table as a published contract with a schema registry and compatibility rules.
- **Enums:** in Postgres, \`ALTER TYPE … ADD VALUE\` can run in a transaction (PG 12+) but the new value cannot be used until that transaction commits.

**#1 trap:** designing a migration that is correct only when the deploy is instant and never rolled back.`,
    },
    {
      heading: 'Zero-downtime migrations — expand, migrate, contract, with a lock budget',
      body: `**What it is:** changing the structure or content of a live table without blocking traffic or requiring synchronized deploys.

**Mechanism.** The steps are **expand** (add the new shape), **dual-write** (the app writes both shapes), **backfill** (in small keyset batches, throttled on replica lag), **switch reads**, **verify**, then **contract** (drop the old shape) one release later.

**Postgres specifics**
- Every DDL statement queues for a lock and blocks everyone behind it, so set \`lock_timeout\` (e.g. 3 s) and retry.
- **NOT NULL on a big table:** add \`CHECK (col IS NOT NULL) NOT VALID\` (instant), \`VALIDATE CONSTRAINT\` (scans under SHARE UPDATE EXCLUSIVE, so writes continue), then \`SET NOT NULL\`, which skips the scan in PG 12+. PG 18 also supports NOT NULL … NOT VALID directly.
- **Foreign keys:** add them NOT VALID, then VALIDATE. Indexes: \`CREATE INDEX CONCURRENTLY\` outside a transaction.
- **int → bigint:** add a new column, sync it with a trigger, backfill, build a unique index concurrently, then swap in a short transaction.

**MySQL specifics:** \`ALGORITHM=INSTANT\` adds columns (8.0.12+, any position and DROP COLUMN from 8.0.29). Otherwise use gh-ost (triggerless, tails the row binlog, controllable cut-over) or pt-online-schema-change (trigger-based).

**Operational rule:** run migrations **once**, as a pipeline step or Kubernetes Job, not from every pod's startup hook.

**#1 trap:** one migration file that renames a column and changes the code in the same deploy.`,
      code: [
        {
          language: 'sql',
          title: 'NOT NULL without a long ACCESS EXCLUSIVE lock (PG 12+)',
          code: `SET lock_timeout = '3s';
ALTER TABLE users ADD COLUMN country_code text;            -- instant
-- app dual-writes; backfill in batches of ~5k rows (keyset on id)

ALTER TABLE users
  ADD CONSTRAINT users_country_nn CHECK (country_code IS NOT NULL) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_country_nn;   -- scan, writes allowed
ALTER TABLE users ALTER COLUMN country_code SET NOT NULL; -- uses the check, no scan
ALTER TABLE users DROP CONSTRAINT users_country_nn;`,
        },
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'misc-data-cc-1',
      title: 'A transaction helper that survives production',
      context:
        'A NestJS service uses this helper for every multi-statement write (orders, wallet debits). Under load you see stray "idle in transaction" sessions, occasional partial writes, pool exhaustion, and 40001/40P01 errors surfacing to users.',
      task: 'Rewrite withTransaction so that all statements run on one connection, failures roll back and release correctly (including broken connections), serialization failures and deadlocks are retried safely, and a single transaction cannot hold locks or the connection for long.',
      starter: {
        language: 'typescript',
        title: 'db/with-transaction.ts (naive)',
        code: `import { Pool } from 'pg';

const pool = new Pool({ max: 10 }); // connectionTimeoutMillis defaults to 0

export async function withTransaction<T>(fn: (q: typeof pool.query) => Promise<T>): Promise<T> {
  await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    const result = await fn(pool.query.bind(pool)); // callers run queries via the pool
    await pool.query('COMMIT');
    return result;
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err; // 40001 / 40P01 bubble up to the user as 500s
  }
}

// usage
await withTransaction(async (q) => {
  const { rows } = await q('SELECT balance FROM wallets WHERE id = $1', [id]);
  if (rows[0].balance < amount) throw new Error('insufficient');
  await fetch(riskApiUrl, { method: 'POST', body: JSON.stringify({ id, amount }) }); // HTTP inside txn
  await q('UPDATE wallets SET balance = balance - $1 WHERE id = $2', [amount, id]);
});`,
      },
      hints: [
        'Where does each pool.query run? A transaction is a property of one connection.',
        'Which errors are safe to retry, and what must be true about fn for a retry to be safe?',
        'What happens to the connection if ROLLBACK itself fails because the socket died? And what should never happen between BEGIN and COMMIT?',
      ],
      solution: {
        language: 'typescript',
        title: 'db/with-transaction.ts (production)',
        code: `import { Pool, PoolClient } from 'pg';

export const pool = new Pool({
  max: 10,
  connectionTimeoutMillis: 2_000,            // fail fast instead of hanging
  idle_in_transaction_session_timeout: 10_000, // server kills forgotten txns
});

const RETRYABLE = new Set(['40001', '40P01']); // serialization failure, deadlock
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>, // fn must be DB-only and idempotent to retry
  { isolation = 'READ COMMITTED', maxAttempts = 3, timeoutMs = 3_000 } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();      // ONE connection for the whole txn
    let broken: Error | undefined;
    try {
      await client.query(\`BEGIN ISOLATION LEVEL \${isolation}\`);
      await client.query(\`SET LOCAL statement_timeout = \${timeoutMs}\`);
      await client.query("SET LOCAL lock_timeout = '1s'");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr: any) {
        broken = rbErr;                        // socket is dead: do not reuse it
      }
      const retry = RETRYABLE.has(err?.code) && attempt < maxAttempts;
      if (!retry) throw err;
      await sleep(2 ** attempt * 20 + Math.random() * 50); // jittered backoff
    } finally {
      client.release(broken);                  // passing an error destroys the client
    }
  }
}

// usage: external call BEFORE the txn; atomic conditional update inside
const risk = await riskClient.check({ id, amount }); // has its own timeout
if (!risk.ok) throw new ForbiddenException();
const debited = await withTransaction(async (c) => {
  const { rowCount } = await c.query(
    'UPDATE wallets SET balance = balance - $1 WHERE id = $2 AND balance >= $1',
    [amount, id],
  );
  if (rowCount === 0) throw new UnprocessableEntityException('insufficient funds');
  await c.query('INSERT INTO ledger (wallet_id, amount, idem_key) VALUES ($1, $2, $3)', [id, -amount, idemKey]);
  return true;
});`,
      },
      explanation: `**Fixes**
1. **One connection per transaction:** the starter ran BEGIN, the queries and COMMIT via \`pool.query\`, each possibly on a different connection. The effect was autocommit writes plus stray open transactions ("idle in transaction") that held locks and pool slots.
2. **Release correctly:** \`client.release(err)\` destroys a connection whose ROLLBACK failed, so a broken or mid-transaction socket never goes back into the pool.
3. **Bounded waiting:** \`connectionTimeoutMillis\` fails fast; \`SET LOCAL statement_timeout\` and \`lock_timeout\` cap time spent holding locks; \`idle_in_transaction_session_timeout\` is the server-side backstop.
4. **Safe retries:** only 40001/40P01 are retried, with jittered backoff and a cap, and the callback does DB work only, so re-running it is safe.
5. **No I/O inside the transaction:** the risk API call moved before BEGIN. Holding row locks during a 200 ms–2 s HTTP call serialises all debits of that wallet and pins connections.
6. **No read-then-write race:** the conditional \`UPDATE … WHERE balance >= $1\` replaces SELECT-then-UPDATE, so READ COMMITTED is enough. The ledger row carries an idempotency key (UNIQUE) so client retries cannot double-debit.`,
      followUps: [
        {
          "q": "The callback fn sometimes calls an external service by mistake. How do you stop developers from doing I/O inside the transaction?",
          "a": "Make the transaction budget enforce it. `SET LOCAL statement_timeout` doesn't catch time spent in Node between queries, so also measure total transaction duration in the wrapper and log or alert when it exceeds, say, 500 ms with the caller's stack. Postgres's `idle_in_transaction_session_timeout` (set to about 5 s) kills transactions that sit idle while awaiting HTTP. Code-level: pass the callback a narrow `TxClient` interface exposing only `query`, and review any `await` of non-DB functions inside. A test harness can stub outbound HTTP to throw if called inside a transaction context (AsyncLocalStorage flag)."
        },
        {
          "q": "How do you test that the retry logic actually works for 40001 and 40P01, and doesn't retry what it shouldn't?",
          "a": "Integration tests against real Postgres in Testcontainers. Serialization failure: run two SERIALIZABLE transactions that read and write overlapping rows in an interleaved order (coordinated with promises), and assert one retries and both eventually commit with correct final state. Deadlock: two transactions update rows A then B, and B then A, with a barrier; assert one gets 40P01, retries and succeeds. Negative cases: a unique violation (23505) and a check violation are thrown immediately with no retry. Broken connection: kill the backend with `pg_terminate_backend` mid-transaction and assert the client is destroyed, not returned to the pool."
        }
      ],
    },
    {
      id: 'misc-data-cc-2',
      title: 'From a "big bang" migration to expand/contract',
      context:
        'This migration runs from the app’s startup hook on each of 30 pods during a rolling deploy of the same release that switches the code to full_name. The users table has 120M rows and 3K writes/s.',
      task: 'Rewrite the change as a safe, zero-downtime sequence: identify every statement that blocks or breaks old pods, and produce a migration runner that runs once, respects a lock budget, and backfills without hurting replicas.',
      starter: {
        language: 'typescript',
        title: 'migrations/1720_full_name.ts (naive)',
        code: `import { Pool } from 'pg';

// called from main.ts on every pod start
export async function up(pool: Pool) {
  await pool.query('ALTER TABLE users RENAME COLUMN name TO full_name');
  await pool.query('ALTER TABLE users ADD COLUMN locale text NOT NULL DEFAULT gen_locale()'); // volatile fn
  await pool.query(\`UPDATE users SET locale = 'en-IN' WHERE locale IS NULL OR locale = ''\`); // 120M rows
  await pool.query('ALTER TABLE users ADD CONSTRAINT users_org_fk FOREIGN KEY (org_id) REFERENCES orgs(id)');
  await pool.query('CREATE INDEX users_locale_idx ON users (locale)');
}`,
      },
      hints: [
        'Which statements break v-previous pods still reading "name"? Which rewrite the table or hold ACCESS EXCLUSIVE / SHARE locks for minutes?',
        'What happens when 30 pods run this at the same time?',
        'Look for NOT VALID, CONCURRENTLY, lock_timeout and keyset batches.',
      ],
      solution: {
        language: 'typescript',
        title: 'migrations/runner.ts + phased steps (production)',
        code: `import { Pool, PoolClient } from 'pg';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Run as a single Kubernetes Job / CI step, never from pod startup.
export async function runOnce(pool: Pool, name: string, steps: string[]) {
  const c = await pool.connect();
  try {
    const { rows } = await c.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [name]);
    if (!rows[0].ok) return console.log(\`\${name}: another runner holds the lock\`);
    for (const sql of steps) await ddlWithRetry(c, sql);
  } finally {
    await c.query('SELECT pg_advisory_unlock(hashtext($1))', [name]).catch(() => {});
    c.release();
  }
}

async function ddlWithRetry(c: PoolClient, sql: string, attempts = 10) {
  for (let i = 1; ; i++) {
    try {
      await c.query("SET lock_timeout = '2s'");    // never queue behind a long query
      return await c.query(sql);
    } catch (e: any) {
      if (e.code !== '55P03' || i === attempts) throw e; // 55P03 = lock_not_available
      await sleep(1_000 * i);
    }
  }
}

// Release N (expand) — old pods keep working
export const expand = [
  'ALTER TABLE users ADD COLUMN full_name text',                      // instant
  'ALTER TABLE users ADD COLUMN locale text',                         // instant, nullable
  'ALTER TABLE users ADD CONSTRAINT users_org_fk FOREIGN KEY (org_id) REFERENCES orgs(id) NOT VALID',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS users_locale_idx ON users (locale)', // outside txn
];
// app N writes name AND full_name, and always sets locale

// Backfill job (throttled, resumable)
export async function backfill(pool: Pool, replica: Pool) {
  let lastId = 0n;
  for (;;) {
    const { rows } = await pool.query(
      \`WITH b AS (SELECT id FROM users WHERE id > $1 ORDER BY id LIMIT 5000)
       UPDATE users u SET full_name = coalesce(u.full_name, u.name),
                          locale = coalesce(nullif(u.locale, ''), 'en-IN')
       FROM b WHERE u.id = b.id RETURNING u.id\`, [lastId.toString()]);
    if (rows.length === 0) break;
    lastId = rows.reduce((m, r) => (BigInt(r.id) > m ? BigInt(r.id) : m), lastId);
    const lag = await replica.query('SELECT coalesce(extract(epoch FROM now() - pg_last_xact_replay_timestamp()), 0) AS s');
    await sleep(Number(lag.rows[0].s) > 5 ? 2_000 : 20); // back off when replicas fall behind
  }
}

// Release N+1 (after backfill): constrain without long locks
export const constrain = [
  'ALTER TABLE users VALIDATE CONSTRAINT users_org_fk',
  'ALTER TABLE users ADD CONSTRAINT users_locale_nn CHECK (locale IS NOT NULL) NOT VALID',
  'ALTER TABLE users VALIDATE CONSTRAINT users_locale_nn',
  'ALTER TABLE users ALTER COLUMN locale SET NOT NULL', // PG 12+: uses the CHECK, no scan
  'ALTER TABLE users DROP CONSTRAINT users_locale_nn',
];
// app N+1 reads full_name only; N+2 stops writing name; then: ALTER TABLE users DROP COLUMN name`,
      },
      explanation: `**What was wrong and how it is fixed**
1. **RENAME in the same release** broke every pod still running the previous version (it selects \`name\`), and a rollback would break too. Now: add \`full_name\`, dual-write, backfill, switch reads, then drop \`name\` two releases later.
2. **ADD COLUMN … DEFAULT volatile_fn()** rewrites all 120M rows under ACCESS EXCLUSIVE; only constant defaults are metadata-only (PG 11+). Now: add it nullable and backfill in batches.
3. **Single 120M-row UPDATE**: one huge transaction, massive WAL and replica lag, bloat, and long row locks. Now: 5,000-row keyset batches that back off on replica lag and can resume from the last id.
4. **FK without NOT VALID** scans the whole table while holding a SHARE ROW EXCLUSIVE lock that blocks writes. Now: NOT VALID (instant), then VALIDATE (weaker lock, writes continue).
5. **CREATE INDEX without CONCURRENTLY** blocks writes for the whole build. Now: CONCURRENTLY with IF NOT EXISTS (check for a leftover INVALID index after failures).
6. **Every pod ran the migration** concurrently. Now: a single Job guarded by an advisory lock. Every DDL uses \`lock_timeout\` with retries, so it never sits in the lock queue blocking traffic.
7. **NOT NULL** is added via a validated CHECK, so \`SET NOT NULL\` holds its lock for milliseconds.`,
      followUps: [
        {
          "q": "CREATE INDEX CONCURRENTLY fails halfway due to a deadlock. What state is the table in, and how does your runner recover?",
          "a": "A failed concurrent build leaves an INVALID index: it's maintained on every write (costing write performance) but never used by queries. `IF NOT EXISTS` would then skip re-creation, leaving it invalid forever, which is a trap. The runner should check `pg_index.indisvalid` for that index name before creating: if it exists and is invalid, `DROP INDEX CONCURRENTLY` it, then rebuild. Wrap that logic in the step. Also, CONCURRENTLY can't run inside a transaction block, so make sure the runner doesn't wrap steps in BEGIN. Alert on any invalid indexes in production as a routine check."
        },
        {
          "q": "The backfill is halfway done (60M of 120M rows) when it crashes. What happens on restart, and is your design safe?",
          "a": "As written, `lastId` lives only in memory, so a restart begins from 0 and re-updates the first 60M rows. The `coalesce` makes that idempotent (same values), but it wastes hours and generates about 60M rows of extra WAL and dead tuples. Fix: persist progress in a `backfill_progress(name, last_id)` table updated after each batch, or resume from `SELECT min(id) FROM users WHERE full_name IS NULL` (cheap with a partial index on `full_name IS NULL`). Also, skip rows already done by adding `AND (u.full_name IS NULL OR u.locale IS NULL)` to the batch."
        }
      ],
    },
  ],
  interviewQuestions: [
    // ---------- Database Indexing ----------
    {
      id: 'misc-data-iq-01',
      difficulty: 'medium',
      question:
        'You have an index on (region, created_at) and a query that filters only on created_at. Walk me through whether the index helps on Postgres 17, on Postgres 18, and on MySQL 8, and what you would actually do.',
      whatInterviewerLooksFor: [
        'Knows the leftmost-prefix rule and why it exists (sort order)',
        'Knows skip scan exists (PG 18, MySQL 8.0.13+ range access) and that it depends on leading-column cardinality',
        'Checks with EXPLAIN rather than guessing',
        'Weighs a new index against write cost',
      ],
      modelAnswer: `### Why the order matters
The index is sorted by region first, then created_at within each region. A predicate on created_at alone has no contiguous range to seek to, so classically the index is unusable for a range seek.

### Engine by engine
- **Postgres ≤ 17:** a plain B-tree range seek is impossible. The planner may still do a full index scan if it is much smaller than the heap, but usually picks a sequential scan.
- **Postgres 18:** **skip scan** probes each distinct region and range-scans created_at inside it. With 6 regions that is 6 small seeks — excellent. With 2M distinct leading values it degrades into scanning the whole index.
- **MySQL 8.0.13+:** has a similar *skip scan range access* (\`Using index for skip scan\` in EXPLAIN), with restrictions: single table, no GROUP BY/DISTINCT, and the index must cover the query.

### What I would do
1. \`EXPLAIN (ANALYZE, BUFFERS)\` on production-like data to see which plan runs.
2. If this is a hot query and the leading column has high cardinality, add a dedicated index on (created_at) or reorder if (region, created_at) is not needed elsewhere.
3. If writes are heavy, prefer relying on skip scan (PG 18) or BRIN on created_at for append-only data (tiny, cheap to maintain) over another B-tree.`,
      followUps: [
        {
          q: 'When would BRIN on created_at beat a B-tree?',
          a: 'Append-only tables where created_at correlates with physical order: BRIN is kilobytes instead of gigabytes and almost free to maintain, good for time-range scans returning many rows; bad for point lookups or randomly ordered data.',
        },
        {
          q: 'Would you reorder the index to (created_at, region)?',
          a: 'Only if no query needs region equality plus a created_at range/sort. (created_at, region) serves time ranges but makes "region = X order by created_at" scan all regions in the time window.',
        },
      ],
      pitfalls: [
        'Saying the index is "never" usable without mentioning skip scan or full index scans',
        'Adding an index without checking write amplification on a hot table',
        'Not verifying with EXPLAIN on realistic data',
      ],
    },
    {
      id: 'misc-data-iq-02',
      difficulty: 'hard',
      question:
        'A team switched primary keys from bigint identity to random UUIDv4 on a 40K inserts/s events table. Insert p99 tripled and WAL volume doubled, on both the Postgres and a MySQL service. Explain the mechanics in each engine and what you would change.',
      whatInterviewerLooksFor: [
        'Explains B-tree locality: right-edge appends vs random leaf inserts',
        'Knows full-page writes after checkpoints (Postgres) and clustered PK/page splits (InnoDB)',
        'Offers UUIDv7 / bigint with an external public ID, with numbers',
        'Mentions secondary-index bloat in InnoDB from a wide PK',
      ],
      modelAnswer: `### Why sequential keys are cheap
A B-tree insert with an increasing key always lands on the rightmost leaf, which stays hot in memory. Random keys land on any of millions of leaf pages.

### Postgres
- The table heap is unordered, so only the **indexes** suffer — but every insert touches a random leaf of the PK index. The working set becomes the whole index (e.g. 2B rows × ~40 B ≈ 80 GB), so cache misses turn inserts into random reads.
- **Full-page writes:** the first modification of a page after each checkpoint writes the whole 8 KB page to WAL. Sequential keys dirty a few pages per checkpoint; random keys dirty thousands of distinct pages, so WAL volume explodes, and replicas and backups pay too.
- Page splits leave leaves around 50–70% full, so the index is bigger.

### MySQL InnoDB
- The **table is the PK B-tree** (clustered). Random PKs split *data* pages, fragment the table and scatter the buffer pool.
- Every secondary index stores the PK, so a 16-byte binary UUID (or a 36-char string!) inflates all of them.

### Fix
- **UUIDv7** (time-ordered, RFC 9562; \`uuidv7()\` built into PG 18, or generated in the app) keeps inserts near the right edge while staying globally unique and client-generatable.
- Or keep **bigint identity internally** and expose an opaque public ID (UUID or encoded) in a separate unique column, if enumeration matters.
- In MySQL store UUIDs as BINARY(16) (\`UUID_TO_BIN(uuid, 1)\` swaps time bits for v1).
- Expect WAL to drop back toward the baseline and insert p99 to recover. Verify with \`pg_stat_wal\` (wal_fpi) before and after.`,
      followUps: [
        {
          q: 'Does UUIDv7 leak information?',
          a: 'Yes, the creation timestamp (millisecond precision). For public IDs where creation time is sensitive, expose a separate random ID or encrypt/encode the internal one.',
        },
        {
          q: 'Could you reduce full-page write cost without changing keys?',
          a: 'Longer checkpoint intervals (max_wal_size, checkpoint_timeout) reduce FPIs per page, and wal_compression helps; turning full_page_writes off is unsafe unless the storage guarantees atomic 8 KB writes.',
        },
      ],
      pitfalls: [
        'Blaming "UUIDs are 16 bytes" alone — size matters far less than randomness',
        'Not distinguishing clustered (InnoDB) from heap (Postgres) storage',
        'Proposing to drop the unique constraint to speed up inserts',
      ],
    },
    // ---------- Connection Pooling ----------
    {
      id: 'misc-data-iq-03',
      difficulty: 'hard',
      question:
        'Implement (in pseudocode or TypeScript) a database connection pool that hands out up to N connections to many concurrent callers. How do you handle waiting, timeouts, broken connections and callers who never return a connection?',
      context:
        'Reported in a Salesforce LMTS (India) interview experience on LeetCode Discuss (Sept 2025): the candidate was asked to build a pool of 1,000–2,000 connections that developers can request, with the interviewer focused on concurrency when requests exceed available connections.',
      whatInterviewerLooksFor: [
        'Bounded resource + FIFO wait queue with timeout (no busy-waiting)',
        'Validation and eviction of broken connections, max lifetime',
        'Leak detection for unreturned connections',
        'Correct concurrency primitives for the runtime (blocking queue/semaphore in Java; promise queue in Node)',
        'Metrics: in-use, idle, waiting, acquire latency',
      ],
      modelAnswer: `### Core structure
- \`idle\`: stack of ready connections (LIFO keeps a few hot and lets extras idle out).
- \`total\`: count of open + opening connections, never above \`max\`.
- \`waiters\`: FIFO queue of pending acquires, each with a deadline.

### acquire(timeoutMs)
1. Pop an idle connection. If it has exceeded max lifetime or failed a cheap validity check, destroy it and loop.
2. Else if \`total < max\`: increment \`total\` *before* the async connect (reserves the slot), connect, return. On failure, decrement and reject.
3. Else enqueue a waiter with a timer. On timeout, remove it from the queue and reject with \`PoolTimeoutError\` — fail fast rather than pile up.

In Java this is a \`Semaphore(max)\` plus a \`BlockingQueue\` with \`poll(timeout)\`. In Node there are no threads, so it is a promise queue; the "race" is between async callbacks, so reserve-before-await matters.

### release(conn, err?)
- If \`err\` indicates a broken socket, or the connection is still in a transaction/dirty session state, **destroy** it and decrement \`total\`, then create a replacement if there are waiters.
- Otherwise hand it directly to the oldest waiter (avoids a thundering herd), or push it to idle.

### Leaks
Track the checkout time and stack per connection. If a connection is held longer than \`leakThreshold\` (e.g. 30 s), log the stack. Optionally force-reclaim, which is dangerous mid-transaction.

### Housekeeping
- Idle eviction timer down to \`min\` connections, and jitter on max lifetime so all connections do not recycle at once.
- Emit gauges (in-use, idle, waiting) and an acquire-latency histogram. Waiting > 0 for long periods means the pool is the bottleneck — or the DB is.

### Sizing 1,000–2,000
I'd challenge that: one Postgres server rarely benefits from more than 2–4× its cores in active connections. Thousands of clients should share a small server-side pool (PgBouncer).`,
      followUps: [
        {
          q: 'Why hand a released connection directly to a waiter instead of pushing to idle?',
          a: 'Pushing to idle and then waking every waiter creates a race where a new caller can grab it first (unfair) and wakes many waiters for one connection (thundering herd). Direct hand-off keeps FIFO fairness.',
        },
        {
          q: 'How do you validate cheaply?',
          a: 'Skip a network ping on every checkout. Validate if idle longer than a threshold, rely on socket error events, and destroy on any connection-level error at release.',
        },
        {
          q: 'What if the caller forgets to release on an exception path?',
          a: 'Offer a scoped API (withConnection(fn) using try/finally) as the only public way to get a connection; leak detection catches the rest.',
        },
      ],
      pitfalls: [
        'Busy-wait loops or sleeping retries instead of a wait queue',
        'Incrementing the count after the async connect (over-allocates under concurrency)',
        'No acquire timeout — callers hang forever',
        'Returning a connection that is mid-transaction to the idle set',
      ],
    },
    {
      id: 'misc-data-iq-04',
      difficulty: 'medium',
      question:
        'Your NestJS service on node-postgres starts hanging under load: requests never error, they just time out at the load balancer after 60 s, while Postgres shows only 10 active connections from the service and low CPU. What is your first hypothesis?',
      whatInterviewerLooksFor: [
        'Recognises pool exhaustion with an infinite acquire timeout (connectionTimeoutMillis = 0 default)',
        'Suspects leaked clients or nested acquisition',
        'Knows how to prove it (pool.waitingCount, totalCount, idleCount)',
        'Proposes fail-fast config plus code fix',
      ],
      modelAnswer: `### Hypothesis: the pool is exhausted and callers wait forever
- 10 connections = node-postgres default \`max: 10\`. Low DB CPU means the DB is not the bottleneck; the connections are **held but not working**.
- The default \`connectionTimeoutMillis\` is **0 = wait indefinitely**, so requests queue silently until the LB gives up.

### Why connections are held
1. **Leak:** \`pool.connect()\` without \`client.release()\` on an error path.
2. **Nested acquisition:** a handler holds a client for a transaction and calls a helper that does \`pool.query()\`. With 10 concurrent requests, all 10 connections are held and each waits for an 11th — a pool deadlock.
3. **Work while holding:** an HTTP call or \`await\` of something slow inside the transaction.

### Prove it
- Log \`pool.totalCount\`, \`idleCount\`, \`waitingCount\` — expect 10 / 0 / hundreds.
- In \`pg_stat_activity\`, look for state = \`idle in transaction\` sessions and the last query they ran.

### Fix
- Set \`connectionTimeoutMillis\` (1–2 s) so the service fails fast with a clear error, and \`idle_in_transaction_session_timeout\` on the server.
- Pass the transaction client explicitly (or use AsyncLocalStorage) so helpers reuse it; always release in \`finally\`.
- Only then consider sizing; raising \`max\` just delays the deadlock.`,
      followUps: [
        {
          q: 'Why does raising max to 50 appear to fix it?',
          a: 'It raises the concurrency level at which the nested-acquire deadlock or leak exhausts the pool; the bug returns at the next traffic peak and now also opens 5× more DB connections per pod.',
        },
        {
          q: 'How would you catch this in CI?',
          a: 'Run integration tests with pool max = 1: any code path that needs two connections at once deadlocks immediately and the acquire timeout fails the test.',
        },
      ],
      pitfalls: [
        'Blaming the database because requests are slow',
        'Raising pool size as the first move',
        'Not knowing the driver default acquire timeout',
      ],
    },
    // ---------- Replication ----------
    {
      id: 'misc-data-iq-05',
      difficulty: 'medium',
      question:
        'Statement-based vs row-based replication in MySQL: which statements break under statement-based, why is NOW() fine but SYSDATE() not, and what does row-based cost you?',
      whatInterviewerLooksFor: [
        'Knows determinism is the dividing line',
        'Knows MySQL logs the timestamp so NOW() replays identically',
        'Lists concrete unsafe cases (UUID(), SYSDATE(), LIMIT without ORDER BY, some triggers/UDFs)',
        'Knows ROW is the default (5.7.7+) and its binlog size trade-off',
      ],
      modelAnswer: `### Statement-based (SBR)
The replica **re-executes the SQL text**. That is only correct if the statement is deterministic given the same data.
- **Safe:** \`UPDATE t SET x = x + 1 WHERE id = 5\`; \`NOW()\` / \`CURRENT_TIMESTAMP\`. MySQL writes a \`SET TIMESTAMP\` into the binlog so the replica evaluates NOW() to the primary's value. \`RAND()\` is also handled by logging the seed.
- **Unsafe:** \`UUID()\`; \`SYSDATE()\` (wall clock at execution time, not statement start); \`UPDATE/DELETE … LIMIT n\` without ORDER BY (which n rows depends on physical order); \`INSERT … SELECT\` without deterministic ordering on auto-increment tables; non-deterministic UDFs. MySQL logs a warning; in MIXED mode it switches those statements to row format.

### Row-based (RBR) — default since 5.7.7
- The binlog contains **before/after row images**. Replay is deterministic.
- **Cost:** a \`DELETE FROM audit WHERE created_at < …\` touching 10M rows logs 10M row events instead of one statement, so the binlog is bigger and replicas apply row by row (a table without a PK makes each row event a full scan on the replica!).
- \`binlog_row_image=MINIMAL\` reduces size by logging only the PK and changed columns.

### In interviews say
"Row-based for correctness; watch big batch DML and tables without primary keys." Same idea as Postgres logical decoding, which is always row-level.`,
      followUps: [
        {
          q: 'Why is a table without a primary key painful for row-based replication?',
          a: 'The replica must locate each row image; without a PK or unique key it may scan the table for every row event, so a 1M-row delete can take hours to apply and replication lag explodes.',
        },
        {
          q: 'What is the Postgres analogue?',
          a: 'Physical WAL is page-level and deterministic by construction; logical replication needs a REPLICA IDENTITY (PK by default, or FULL) to identify rows for UPDATE/DELETE.',
        },
      ],
      pitfalls: [
        'Claiming NOW() breaks statement-based replication',
        'Saying row-based is free',
        'Confusing replication format with sync/async mode',
      ],
    },
    {
      id: 'misc-data-iq-06',
      difficulty: 'expert',
      question:
        'At 14:02 someone ran DELETE FROM subscriptions without a WHERE clause on the Postgres primary. You have two streaming replicas, nightly base backups and WAL archiving. It is 14:07. What do you do, and what would you have built in advance?',
      whatInterviewerLooksFor: [
        'Immediately recognises replicas already applied the delete',
        'Stops the bleeding first (app writes, pause jobs)',
        'Knows PITR mechanics: base backup + WAL replay to recovery_target_time/xid on a separate instance',
        'Merges recovered rows back selectively rather than restoring the whole cluster',
        'Proposes a delayed standby and guard rails',
      ],
      modelAnswer: `### 0–5 minutes: contain
- The streaming replicas replayed the delete within milliseconds — **they are not a backup**. Do not fail over.
- Put affected features in maintenance mode or block writes to the table so new rows do not interleave with the recovery. Pause billing jobs that would cancel "missing" subscriptions.
- Find the exact moment: search the logs (\`log_statement\`/pgaudit) for the statement, or use \`pg_waldump\` on archived WAL to find the transaction id of the big DELETE.

### Recover without rolling back everyone else
- Restore the latest base backup to a **new instance**. Replay archived WAL with \`recovery_target_xid\` (with \`recovery_target_inclusive = false\`) or \`recovery_target_time = '14:01:59'\`, and \`recovery_target_action = 'pause'\`.
- Replay time: backup restore (~1 TB at 500 MB/s ≈ 35 min) plus WAL since midnight. This is why RTO for PITR is often hours.
- From the recovered instance, export \`subscriptions\` and \`INSERT … ON CONFLICT DO NOTHING\` into the primary. Reconcile rows that legitimately changed after 14:02 (new sign-ups, since-updated rows) using updated_at.
- Do **not** restore the whole cluster to 14:01 — that discards 5 minutes of every other table's writes.

### What I would have built
- A **delayed standby**: \`recovery_min_apply_delay = '1h'\`. At 14:07 you run \`SELECT pg_wal_replay_pause()\` and \`pg_dump -t subscriptions\` straight from it. Recovery in minutes, not hours.
- Guard rails: no human write access to prod without a break-glass flow; \`safe-update\`-style checks in tooling (MySQL has \`sql_safe_updates\`); soft-delete for critical entities; regularly tested restores with measured RTO.`,
      followUps: [
        {
          q: 'What is the cost of a delayed standby?',
          a: 'One more replica’s hardware and WAL retention for the delay window; it is useless for failover or reads (always an hour stale), so it is purely a safety net.',
        },
        {
          q: 'How would this differ on MySQL?',
          a: 'Same shape: restore a backup, replay binlogs with mysqlbinlog --stop-position before the bad event (or skip it via GTID); MySQL also supports delayed replicas with SOURCE_DELAY.',
        },
      ],
      pitfalls: [
        'Failing over to a replica, expecting it to still have the rows',
        'Restoring the entire database to 14:01 and losing everyone else’s writes',
        'Not having tested restore time, so RTO is unknown',
      ],
    },
    // ---------- Read Replicas ----------
    {
      id: 'misc-data-iq-07',
      difficulty: 'medium',
      question:
        'You have just added a read replica and pointed the ORM’s read traffic at it. Besides stale reads after a write, list everything else that can now break.',
      context:
        'Frequently described as a staple of senior backend interviews ("you’ve added a read replica, what breaks?").',
      whatInterviewerLooksFor: [
        'Goes beyond read-your-writes: transactions, capacity, query cancellation, write attempts',
        'Mentions monotonic reads across multiple replicas',
        'Mentions monitoring lag and failure handling',
        'Knows physical replica limitations (read-only, no temp writes, same indexes)',
      ],
      modelAnswer: `### Correctness
- **Read-then-write logic:** code that reads a row from the replica and then writes based on it (check stock, then decrement) decides on stale data. Such reads belong on the primary, inside the transaction.
- **Transactions:** an ORM that routes by statement type can send the SELECT in a BEGIN…COMMIT block to the replica. Everything inside a transaction must stay on one connection to the primary.
- **Monotonic reads:** with two or more replicas at different lag, pagination or refreshes can go back in time. Pin a session to one replica.
- **Uniqueness checks** ("is this username free?") against a replica race with concurrent sign-ups.

### Operational
- **Write attempts** on a hot standby fail (\`cannot execute INSERT in a read-only transaction\`), including hidden ones: temp tables, \`SELECT … FOR UPDATE\`, functions that write, sequence nextval.
- **Query cancellation:** long reports on a Postgres standby get cancelled on conflict with recovery unless you tune \`max_standby_streaming_delay\` / \`hot_standby_feedback\` (and the latter bloats the primary).
- **Capacity:** if the replica dies, is the fallback the primary, and can it take 100% of reads? Plan N+1.
- **Connections:** a second pool per pod doubles connection counts.
- **Monitoring:** alert on replay lag (\`pg_stat_replication.replay_lag\`, \`Seconds_Behind_Source\`), not just "replica up".

### Close with the cheapest guard rail
A routing rule: primary for anything in a transaction, anything after a user's recent write (short TTL), and anything that decides a write. Replica for the rest.`,
      followUps: [
        {
          q: 'Does SERIALIZABLE on the replica solve read-then-write?',
          a: 'No — Postgres refuses SERIALIZABLE on a hot standby, and in any case the replica cannot see the primary’s in-flight writes; the decision must run on the primary.',
        },
        {
          q: 'How do you find hidden writes before switching?',
          a: 'Run the read path against the replica in staging, or shadow-route a sample in prod and log read-only errors; grep for FOR UPDATE, nextval and temp tables in read services.',
        },
      ],
      pitfalls: [
        'Only mentioning replication lag',
        'Routing SELECTs inside transactions to the replica',
        'Forgetting what happens when the replica fails',
      ],
    },
    {
      id: 'misc-data-iq-08',
      difficulty: 'hard',
      question:
        'Your read router sends reads to three Postgres replicas and falls back to the primary when a replica’s lag exceeds 2 s. At 02:00 a batch job made every replica lag by 90 s, all reads failed over to the primary, and the primary fell over, taking writes down with it. Redesign the policy.',
      whatInterviewerLooksFor: [
        'Identifies the fallback as a load amplifier (correlated replica lag)',
        'Classifies reads by staleness tolerance instead of one threshold',
        'Caps primary read capacity (separate pool / concurrency limit / load shedding)',
        'Fixes the batch job cause: throttled batches, lag-aware backfill',
      ],
      modelAnswer: `### What went wrong
Replica lag is **correlated**: one heavy writer lags every replica at once. So "fall back to the primary" moves 100% of read traffic (e.g. 30K reads/s) onto a node sized for writes plus a slice of reads. That is a load-amplifying failover.

### New policy
1. **Classify reads by staleness budget**
   - *Must-be-fresh* (right after the user's own write, payment status, pre-write checks): primary, always — a small, known volume.
   - *Tolerant* (feeds, catalog, dashboards): serve from replicas even at 90 s lag. Maybe show "updated a minute ago", or serve from cache.
   - *Session-consistent:* use an LSN token. If no replica has caught up to the user's LSN within ~200 ms, go to primary — only for that user.
2. **Bound the primary's read share:** a separate, small read pool on the primary (e.g. 20 connections per region) with a concurrency limit. When it is full, reject or degrade *reads* so writes keep their capacity.
3. **Hysteresis:** use lag thresholds with separate enter and exit levels, per-replica circuit breakers, and never flip all traffic at once.

### Fix the cause
- The batch job should write in keyset batches of a few thousand rows, sleeping when \`replay_lag\` > 5 s, and run with lower priority. Or move it to a logical subscriber.
- Alert on WAL generation rate spikes, not just lag.

### Result
A lag event now means some pages are a minute stale and a few users hit the primary. Writes are never at risk.`,
      followUps: [
        {
          q: 'How do you implement the LSN token in Node?',
          a: 'After the write, read pg_current_wal_lsn() and put it in the session/cookie; before a read, pick a replica with pg_last_wal_replay_lsn() >= token (cached per replica every 100–200 ms) or fall back to primary for that request only.',
        },
        {
          q: 'Would synchronous replication have prevented this?',
          a: 'It would slow the batch job to replica speed (backpressure) but add commit latency to every write and couple primary availability to standbys; throttling the job is cheaper.',
        },
      ],
      pitfalls: [
        'Only lowering or raising the lag threshold',
        'Adding more replicas (they lag together)',
        'Treating all reads as needing the same freshness',
      ],
    },
    // ---------- Sharding ----------
    {
      id: 'misc-data-iq-09',
      difficulty: 'medium',
      question:
        'Users are sharded by user_id across 16 Postgres clusters. Product needs email addresses to be globally unique and "log in with email" to be a single-shard lookup. How do you do it?',
      whatInterviewerLooksFor: [
        'Knows per-shard UNIQUE constraints do not give global uniqueness',
        'Proposes a lookup (index) table sharded by email',
        'Handles the two-write race and orphaned reservations',
        'Handles email change and case normalisation',
      ],
      modelAnswer: `### The problem
\`UNIQUE(email)\` on each shard only guarantees uniqueness **within** a shard. Two sign-ups with the same email but different user_ids can land on different shards.

### Design: a lookup table sharded by email
- \`email_index(email_normalized PRIMARY KEY, user_id, status)\`, placed by \`hash(email_normalized)\`. The PK on that shard *is* the global uniqueness guarantee.
- Normalise first: lower-case, trim, and decide on Gmail dots/plus. Store the original separately.

### Sign-up flow (reserve first)
1. \`INSERT INTO email_index … status = 'reserved'\` on the email shard. A duplicate key means "email taken" — return immediately.
2. Create the user row on the user shard.
3. Mark the reservation \`active\`.
- If step 2 fails, a janitor deletes reservations still 'reserved' after N minutes (or the client retries with the same idempotency key and reuses them).

### Login
Hash the email, look up user_id on one shard, then go to the user's shard. That is two point reads, ~1–2 ms each.

### Email change
Reserve the new email → update the user row → delete the old lookup row. The same saga shape, idempotent at each step.

### Alternatives
- Derive the user's shard from the email: breaks when emails change.
- A distributed SQL database with global unique indexes (CockroachDB, Spanner): works, but each insert pays a cross-node transaction.`,
      followUps: [
        {
          q: 'What if the lookup shard is down?',
          a: 'Sign-up and email login for that hash range fail; replicate it like any shard. Existing sessions keyed by user_id are unaffected.',
        },
        {
          q: 'Why reserve first instead of creating the user first?',
          a: 'The uniqueness check is the step most likely to fail; doing it first avoids creating users you must then delete, and the reservation doubles as a lock against concurrent sign-ups.',
        },
      ],
      pitfalls: [
        'Assuming per-shard unique constraints are enough',
        'Scatter-gathering all 16 shards on every sign-up (and still racing)',
        'Forgetting normalisation, so Foo@x.com and foo@x.com both register',
      ],
    },
    {
      id: 'misc-data-iq-10',
      difficulty: 'expert',
      question:
        'Greenfield 2026: a ledger-style service expects 50K writes/s within two years, strong consistency per account, and occasional cross-account transfers. Would you build app-level sharding on Postgres, use Vitess or Citus, or pick distributed SQL (CockroachDB, YugabyteDB, Spanner)? Defend the choice.',
      whatInterviewerLooksFor: [
        'Frames the decision on write latency, cross-shard transactions, operations burden and team skills',
        'Quantifies: single-node Postgres limits, consensus latency cost',
        'Recognises cross-account transfers are the crux',
        'Gives a staged plan rather than a dogma',
      ],
      modelAnswer: `### Clarify the numbers
- 50K writes/s, maybe 10–20K transactions/s with several rows each. One well-tuned Postgres primary handles roughly 10–30K simple write transactions/s, so we exceed one node within two years but not on day one.
- What fraction of transfers cross accounts? If 30% are random pairs, most will cross shards.

### Options
| | App sharding on Postgres | Vitess / Citus | Distributed SQL |
|---|---|---|---|
| Single-account write latency | ~1–3 ms | ~1–3 ms | ~5–15 ms (Raft quorum, same region) |
| Cross-shard transfer | You build a saga/2PC | Limited (Citus 2PC; Vitess atomic mode is weaker) | Native serializable transactions |
| Resharding | You build it | Built in | Automatic range splits |
| Ops and ecosystem | Plain Postgres | Extra control plane | New operational model, per-core licensing for some |

### My choice
For a **ledger with cross-account transfers**, correctness of multi-row transactions dominates:
- **Distributed SQL** if transfers commonly cross accounts and the team can accept ~10 ms writes. You get serializable cross-shard transactions without writing 2PC yourself, and 50K writes/s is a few dozen nodes.
- **Postgres + Citus** (or app sharding) if most writes are single-account and transfers can be modelled as two ledger entries linked by a transfer saga with idempotent steps and reconciliation. That is cheaper, faster per write, and the tooling is familiar.

### Staged plan
Start on a single Postgres with account_id-leading keys, time-ordered IDs, and every table carrying account_id (shard-ready). Model transfers as double-entry rows with an outbox. Decide at ~40% of single-node capacity based on the measured cross-account ratio.`,
      followUps: [
        {
          q: 'How does distributed SQL keep transactions serializable across nodes?',
          a: 'Each range is a Raft group; a transaction writes intents to every range it touches and commits through a transaction record, using hybrid-logical or TrueTime clocks to order commits — so a cross-range commit costs extra consensus round trips.',
        },
        {
          q: 'What breaks first with app-level sharding here?',
          a: 'Cross-shard transfers: you need a coordinator, idempotent steps, compensations, and reconciliation, and reporting needs a separate aggregated store.',
        },
      ],
      pitfalls: [
        'Choosing by hype ("Spanner scales") without the latency cost',
        'Ignoring cross-account transactions, the hard part',
        'Sharding on day one for a load one node can serve',
      ],
    },
    // ---------- Partitioning ----------
    {
      id: 'misc-data-iq-11',
      difficulty: 'medium',
      question:
        'When would you partition a table but not shard the database? Name two problems partitioning solves and two it does not.',
      context: 'A commonly reported interview question: partitioning vs sharding.',
      whatInterviewerLooksFor: [
        'Precise distinction: same server vs many servers',
        'Knows the real wins: retention, vacuum/index size per partition, pruning',
        'Knows what it does not fix: write throughput ceiling, CPU, connections',
        'Mentions constraint and index limitations',
      ],
      modelAnswer: `### The distinction
- **Partitioning:** one database server; a table is split into child tables by range, list or hash. The app still sees one table, and transactions and joins work normally.
- **Sharding:** data split across **independent servers**; the app or middleware routes queries, and cross-shard work is expensive.

### Partition, don't shard, when
- One node still handles the **throughput** (e.g. 3 TB, 2K writes/s), but table **size** hurts: retention deletes take hours, vacuum takes forever, indexes do not fit in memory.

### What partitioning solves
1. **Data lifecycle:** drop a month by \`DETACH … CONCURRENTLY\` + \`DROP\` in seconds instead of a DELETE that bloats the table and floods WAL.
2. **Per-partition maintenance and locality:** vacuum, reindex and analyze run on smaller pieces, and hot recent partitions keep their indexes cached. Queries that filter on the key prune to a few partitions.

### What it does not solve
1. **Write or CPU ceiling:** all partitions share one primary's CPU, WAL and disk. 50K writes/s is still 50K writes/s.
2. **Queries without the partition key:** \`WHERE order_id = ?\` on a table partitioned by month probes every partition's index.
3. **Connection limits and single-node failure domain.**

### Gotchas
In Postgres, PK/UNIQUE must include the partition key and there are no global indexes. In MySQL, every unique key must include all partition columns, and there are no foreign keys on partitioned InnoDB tables.`,
      followUps: [
        {
          q: 'How many partitions is too many?',
          a: 'Planning time and lock counts grow with partitions touched; Postgres handles thousands but queries that cannot prune pay heavily. Tens to low hundreds is comfortable; daily partitions for 10 years is not.',
        },
        {
          q: 'Is hash partitioning ever useful on one server?',
          a: 'Yes — to split a huge, uniformly accessed table so vacuum and index maintenance work on smaller units and to prepare for later sharding along the same key.',
        },
      ],
      pitfalls: [
        'Claiming partitioning increases write throughput',
        'Using the words interchangeably',
        'Ignoring the unique-constraint limitation',
      ],
    },
    {
      id: 'misc-data-iq-12',
      difficulty: 'hard',
      question:
        'Your orders table was partitioned monthly by created_at last quarter. Since then, GET /orders/:id got 20× slower, the team discovered order_id is no longer enforced unique, and a new partition creation job failed at midnight. Explain all three and fix them.',
      whatInterviewerLooksFor: [
        'Pruning requires the partition key; point lookups by id hit every partition',
        'Unique constraints must include the partition key (no global index)',
        'Default partition scan/violation on new partition creation',
        'Practical fixes: encode time in the id, lookup table, pg_partman premake',
      ],
      modelAnswer: `### 1. GET /orders/:id got slower
\`WHERE id = $1\` has no created_at predicate, so nothing is pruned. With 36 monthly partitions the planner probes 36 indexes (36 × 3–4 page reads) and plans a 36-way Append.

**Fixes (pick one)**
- Make the key time-ordered (Snowflake or UUIDv7) and derive the created_at range from the id: \`WHERE id = $1 AND created_at BETWEEN ts(id) - 1s AND ts(id) + 1s\`. That prunes to one partition.
- Or keep a small \`order_locator(id PRIMARY KEY, created_at)\` table and look it up first.
- Change API links to carry the month (\`/orders/2026-09/123\`), where acceptable.

### 2. Uniqueness lost
Postgres requires PRIMARY KEY/UNIQUE on a partitioned table to include the partition key, so the migration made the PK \`(id, created_at)\`. That only guarantees the pair is unique. Identity/sequence IDs are still unique in practice, but imported or client-supplied IDs are no longer protected.
**Fix:** make IDs generated only by the database sequence or a time-ordered generator. If external IDs exist, enforce uniqueness via the \`order_locator\` PK.

### 3. Midnight job failed
There is a **DEFAULT partition**. Rows with a created_at beyond the last partition (clock skew, or a batch import with future dates) landed in it. \`CREATE TABLE … PARTITION OF … FOR VALUES FROM ('2026-10-01')\` must scan the default partition and **errors** if it contains matching rows ("updated partition constraint for default partition would be violated"). It also takes locks that block traffic while it scans.
**Fix:** pre-create partitions months ahead (pg_partman \`premake\`), alert when the default partition is non-empty, and move stray rows out before attaching. Better still, drop the default partition and reject bad dates at the application.`,
      followUps: [
        {
          q: 'Why not just add a global index on id?',
          a: 'Postgres does not support global indexes on partitioned tables; each partition has its own index. You emulate one with a separate table or move to a system that has them.',
        },
        {
          q: 'Could you have avoided the rewrite by partitioning on id instead?',
          a: 'Range-partitioning on a time-ordered id gives both pruning for point lookups and time-based retention, as long as the id is monotonic in time.',
        },
      ],
      pitfalls: [
        'Blaming missing indexes for the slow lookup',
        'Believing a unique index on id alone is allowed',
        'Not knowing why the default partition matters',
      ],
    },
    // ---------- Transactions ----------
    {
      id: 'misc-data-iq-13',
      difficulty: 'medium',
      question:
        'Inside a transaction, one INSERT hits a duplicate-key error, your code catches it and carries on with the next statements. What happens on Postgres, what happens on MySQL, and how do you write it correctly?',
      whatInterviewerLooksFor: [
        'Knows Postgres aborts the whole transaction (25P02) after any error',
        'Knows MySQL rolls back only the statement (deadlocks roll back the transaction)',
        'Uses SAVEPOINT or ON CONFLICT instead of catching and continuing',
        'Mentions ORM behaviour (nested transactions map to savepoints)',
      ],
      modelAnswer: `### Postgres
After any error the transaction enters the **aborted** state. Every following statement fails with \`current transaction is aborted, commands ignored until end of transaction block\` (SQLSTATE 25P02), and COMMIT is turned into a ROLLBACK. Catching the error in JavaScript does not help; the server has already given up on the transaction.

### MySQL InnoDB
Most errors (duplicate key, constraint violation) roll back **only that statement**. The transaction continues and COMMIT persists the other statements. Exceptions: a **deadlock** rolls back the whole transaction. A lock wait timeout rolls back only the statement by default (\`innodb_rollback_on_timeout=OFF\`). Code that "worked" on MySQL breaks when ported to Postgres.

### Correct patterns
- **Avoid the error:** \`INSERT … ON CONFLICT DO NOTHING / DO UPDATE\` (Postgres) or \`INSERT … ON DUPLICATE KEY UPDATE\` (MySQL).
- **Expect an error:** wrap the risky statement in \`SAVEPOINT s1\` … \`ROLLBACK TO SAVEPOINT s1\` on failure, then continue.
- In ORMs, a nested \`transaction()\` call usually maps to a savepoint (TypeORM, Prisma nested writes, Sequelize).
- Savepoints cost a subtransaction. Thousands per transaction in Postgres can overflow the per-backend subxid cache (64) and hurt performance — use ON CONFLICT in loops.`,
      followUps: [
        {
          q: 'Why might a MySQL "partial success" be dangerous?',
          a: 'Business logic may assume all-or-nothing; if the error is swallowed, COMMIT persists a half-applied change (order without its line item) silently.',
        },
        {
          q: 'What goes wrong with many savepoints in Postgres?',
          a: 'Each creates a subtransaction; beyond 64 per backend the subxid cache overflows and visibility checks consult pg_subtrans, which has caused severe slowdowns on busy primaries and replicas.',
        },
      ],
      pitfalls: [
        'Assuming both engines behave the same',
        'Believing a JS try/catch restores the transaction',
        'Using savepoints in a hot loop instead of ON CONFLICT',
      ],
    },
    {
      id: 'misc-data-iq-14',
      difficulty: 'expert',
      question:
        'Your payment service sends COMMIT and the TCP connection resets before the reply arrives. The driver throws "Connection terminated unexpectedly". Did the payment commit? What should the code do, and how do you design so the question has an answer?',
      whatInterviewerLooksFor: [
        'States the outcome is unknown (commit may have happened)',
        'Rejects blind retry of the whole transaction for non-idempotent writes',
        'Designs idempotency keys / natural unique constraints to make retries safe',
        'Knows how to check: query by key; Postgres txid_status for known xid',
        'Relates to external side effects and reconciliation',
      ],
      modelAnswer: `### The honest answer: unknown
COMMIT may have reached the server and been made durable, with only the reply lost. Or the connection died before the server saw it and the transaction rolled back. The client cannot tell. This is the **ambiguous commit** problem, and failovers, proxies (PgBouncer, RDS Proxy) and network blips all produce it.

### What not to do
- Treat it as a failure and retry the whole transaction → a possible **double charge**.
- Treat it as a success → a possible **phantom success**.

### Make the outcome queryable
- Every write carries a client-generated **idempotency key** with a UNIQUE constraint, inserted in the same transaction: \`payments(idempotency_key UNIQUE, …)\`.
- On an ambiguous error, **reconnect and look up** the key. Found → committed, return the stored result. Not found → it did not commit, so retry safely. A concurrent retry that loses the race hits the unique constraint.
- In Postgres you can also record \`txid_current()\` (or \`pg_current_xact_id()\`) early in the transaction and later ask \`pg_xact_status(xid)\` → committed / aborted / in progress, if the xid is still in the retained commit-log range.

### External side effects
If the transaction also represents a charge at a PSP, the PSP call must be idempotent too (same key), and an outbox row committed with the payment drives the call. Nightly reconciliation catches anything that slipped.

### Where this shows up in interviews
Distributed SQL documents it explicitly. CockroachDB returns an "ambiguous result" error, a good signal that you know this is a real failure mode and not a textbook one.`,
      followUps: [
        {
          q: 'Does synchronous replication remove the ambiguity?',
          a: 'No; it changes durability after failover, but the client can still lose the reply. It does mean a commit acknowledged on the primary exists on the standby.',
        },
        {
          q: 'How long must idempotency keys live?',
          a: 'At least as long as any client or queue might retry — commonly 24 hours to 7 days — with the stored response so a retry returns the same result.',
        },
      ],
      pitfalls: [
        'Saying "the transaction rolled back because the connection dropped"',
        'Retrying non-idempotent writes automatically in a generic DB wrapper',
        'Relying on the ORM to know the outcome',
      ],
    },
    // ---------- Isolation Levels ----------
    {
      id: 'misc-data-iq-15',
      difficulty: 'medium',
      question:
        'Walk me through InnoDB’s four isolation levels as InnoDB actually implements them, and tell me when you’d pick optimistic versus pessimistic locking for a user-profile edit versus a seat booking.',
      context:
        'Per DesignGurus’ Dream11 interview guide, the database/project round follows up with MySQL isolation levels, pessimistic vs optimistic locking and indexing.',
      whatInterviewerLooksFor: [
        'Engine-specific detail: snapshot at first read, current reads, gap/next-key locks',
        'SERIALIZABLE converts plain SELECTs to locking reads (when autocommit is off)',
        'Clear criterion for optimistic vs pessimistic: contention and cost of retry',
        'Concrete SQL for both patterns',
      ],
      modelAnswer: `### InnoDB levels
- **READ UNCOMMITTED:** plain SELECTs can see uncommitted rows (dirty reads). Almost never used.
- **READ COMMITTED:** each consistent read takes a fresh snapshot. Gap locking is mostly disabled (kept for FK and duplicate-key checks), which means fewer deadlocks. Popular for high-concurrency OLTP.
- **REPEATABLE READ (default):** the snapshot is created at the **first read** in the transaction (or at \`START TRANSACTION WITH CONSISTENT SNAPSHOT\`). But UPDATE/DELETE/\`FOR UPDATE\` are **current reads** of the latest committed row, and locking reads take **next-key locks** (row + gap) to block phantom inserts.
- **SERIALIZABLE:** like RR, but plain SELECTs become \`SELECT … FOR SHARE\` when autocommit is off, so readers block writers. Heavy.

### Optimistic vs pessimistic
**Profile edit** — low contention, human think-time between read and write. Use **optimistic** locking: \`UPDATE users SET … , version = version + 1 WHERE id = ? AND version = ?\`. 0 rows affected → a conflict; return 409 and let the user reload. No locks are held across the user's think time.

**Seat booking** — high contention on a small set of rows, and the write must not be lost. Use **pessimistic** locking or an atomic conditional update inside a short transaction:
- \`UPDATE seats SET holder = ? WHERE seat_id = ? AND holder IS NULL\` → 1 row = won. The simplest and fastest.
- Or \`SELECT … FOR UPDATE SKIP LOCKED\` (MySQL 8.0+) to grab any free seat without queueing.

**Rule of thumb:** optimistic when conflicts are rare and retries are cheap; pessimistic or conditional when conflicts are frequent, since optimistic retries would thrash.`,
      followUps: [
        {
          q: 'Why do deadlocks drop when moving InnoDB from RR to RC?',
          a: 'Gap and next-key locks on range scans and missing keys largely disappear at RC, so concurrent inserters stop blocking each other’s insert-intention locks.',
        },
        {
          q: 'What is the risk of RC for a report?',
          a: 'Each statement sees a different snapshot, so totals across statements can be inconsistent; run the report in one statement or at RR / on a replica snapshot.',
        },
      ],
      pitfalls: [
        'Reciting the ANSI table without InnoDB specifics',
        'Holding a pessimistic lock across a user’s edit screen',
        'Optimistic locking on a hot row with hundreds of writers per second',
      ],
    },
    {
      id: 'misc-data-iq-16',
      difficulty: 'expert',
      question:
        'A wallet service is being ported from MySQL to Postgres. Under MySQL REPEATABLE READ, a "debit if balance is sufficient" flow never double-spent in two years. On Postgres REPEATABLE READ the same code starts throwing errors at peak, and one teammate proposes dropping to READ COMMITTED to "fix" it. Explain both behaviours and what you would ship.',
      context:
        'Per DesignGurus’ Paytm interview guide, interviewers dig into idempotency, locking and transaction isolation because they are daily problems at a payments company.',
      whatInterviewerLooksFor: [
        'Explains why MySQL code was safe (or not) — current reads and locks, not the snapshot',
        'Knows Postgres RR raises 40001 on concurrent update (first-updater-wins)',
        'Shows that READ COMMITTED with read-then-write would reintroduce lost updates',
        'Ships an atomic conditional update or FOR UPDATE with retries and idempotency',
      ],
      modelAnswer: `### The code
\`SELECT balance … ; if (balance >= amt) UPDATE wallets SET balance = balance - amt WHERE id = ?\`

### Why MySQL "worked"
The plain SELECT reads an old snapshot, but \`UPDATE … SET balance = balance - amt\` is a **current read** that locks the row and applies to the latest committed value. Two concurrent debits of 80 on a balance of 100 both pass the check (each sees 100) and both apply: the balance goes to -60. It "never double-spent" only because the real code probably used \`SELECT … FOR UPDATE\`, a CHECK constraint, or contention was low. Verify that before celebrating.

### Why Postgres errors
At REPEATABLE READ (snapshot isolation) Postgres uses **first-updater-wins**. If another transaction updated the row after your snapshot, your UPDATE fails with \`could not serialize access due to concurrent update\` (40001). That is Postgres *preventing* the lost update. The fix is not to suppress it.

### Why READ COMMITTED is the wrong fix
At RC the UPDATE waits for the other transaction, then re-evaluates on the new row version and proceeds. With read-then-write logic in the app, both debits apply and the balance goes negative. The errors disappear and the bug appears.

### What to ship
1. **One atomic conditional statement** at READ COMMITTED: \`UPDATE wallets SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance\`. 0 rows → insufficient funds. No read-then-write gap.
2. Or \`SELECT … FOR UPDATE\` then UPDATE in a short transaction, if more logic is needed.
3. Keep \`CHECK (balance >= 0)\` as a last line of defence.
4. **Idempotency key** per debit (unique), plus a retry loop with jitter for 40001/40P01 wherever RR/SERIALIZABLE remains.
5. For hot wallets (merchant accounts), move to an append-only ledger with periodic balance snapshots to avoid single-row contention.`,
      followUps: [
        {
          q: 'Would SERIALIZABLE be better?',
          a: 'It would catch more complex invariants (write skew across rows) but adds more aborts; for a single-row debit the conditional UPDATE is simpler and faster.',
        },
        {
          q: 'How do you prove the MySQL code was actually safe?',
          a: 'Replay a concurrency test: two sessions interleaving SELECT then UPDATE at RR on a test DB; check the binlog/audit for negative balances; grep code for FOR UPDATE.',
        },
      ],
      pitfalls: [
        'Lowering isolation to make errors disappear',
        'Assuming MySQL RR prevents lost updates for read-modify-write',
        'Retrying without idempotency',
      ],
    },
    // ---------- Schema evolution ----------
    {
      id: 'misc-data-iq-17',
      difficulty: 'medium',
      question:
        'During a rolling deploy, v41 and v42 of your service run against the same database for about 15 minutes, and rollback to v41 must stay possible for a day. Which schema changes can ship in the same release as the code that uses them, and which must be split?',
      context: 'A common senior backend interview prompt on schema compatibility during rolling deploys.',
      whatInterviewerLooksFor: [
        'States the rule: every schema state must support current and previous app version',
        'Classifies changes correctly (additive vs destructive/renaming/tightening)',
        'Knows ORMs and SELECT * make drops dangerous even for "unused" columns',
        'Describes the multi-release sequence',
      ],
      modelAnswer: `### The rule
The schema after migration N must work with app versions N-1 **and** N. Because rollback must be possible, destructive changes wait at least one release after the code stops using the old shape.

### Safe to ship with the code (migrate before deploy)
- Add a nullable column, or one with a constant default. v41 ignores it — as long as v41 does not use positional \`INSERT … VALUES\` without a column list.
- Add a table, an index (CONCURRENTLY), a view.
- Widen a type safely (varchar(50) → varchar(100)) or relax a constraint.
- Add an enum value that v41 never receives. Careful: if v42 writes it and v41 reads it during rollback, v41 must tolerate unknown values.

### Must be split across releases
- **Drop a column:** release A stops reading and writing it (and removes it from the ORM entity), release B drops it. Otherwise v41's ORM, which lists every mapped column, fails.
- **Rename:** add new → dual-write → backfill → read new → stop writing old → drop old. That is 3–4 releases.
- **Add NOT NULL / tighten a type / add a CHECK:** v41 may still write rows that violate it. Ship the code that always writes the value first, backfill, then add the constraint.
- **Change meaning** of an existing column (cents → rupees): never in place. Use a new column.

### Process
Separate *expand* migrations (run before deploy) from *contract* migrations (run after, gated on "no old version running" and the rollback window elapsed). Lint migrations in CI for drops, renames and NOT NULL without a default.`,
      followUps: [
        {
          q: 'Why migrate before deploying the new code rather than after?',
          a: 'Expand migrations are backward compatible, so old code tolerates them; new code needs them present at start-up. Contract migrations run after, once no old code remains.',
        },
        {
          q: 'How do blue/green deploys change this?',
          a: 'Not much — both colours share the database, so compatibility rules are the same; the window may be longer because blue stays warm for rollback.',
        },
      ],
      pitfalls: [
        'Dropping a column in the same release that stops using it',
        'Forgetting rollback compatibility',
        'Treating "nobody reads it" as proof — ORMs and SELECT * do',
      ],
    },
    {
      id: 'misc-data-iq-18',
      difficulty: 'hard',
      question:
        'You need to rename orders.amount (integer paise) to orders.amount_minor and add a currency column. The table also streams through Debezium into Kafka, a Snowflake warehouse and an Elasticsearch indexer owned by other teams. Plan the evolution so no consumer breaks.',
      whatInterviewerLooksFor: [
        'Treats the table as a published contract (CDC makes schema a public API)',
        'Knows a rename appears to CDC consumers as drop + add',
        'Uses schema registry compatibility modes and a deprecation window',
        'Sequences app and consumer changes; considers backfill events flooding the topic',
      ],
      modelAnswer: `### Why this is harder than an app-only rename
With CDC, the table schema **is** the event schema. Debezium publishes the row with Avro/JSON schemas to a registry. A rename shows up as "field amount removed, field amount_minor added". That is a breaking change under BACKWARD compatibility for any consumer reading \`amount\`.

### Plan
1. **Announce and inventory consumers** (registry subject, consumer groups, warehouse models, indexer mapping). Agree on a deprecation window, e.g. 4 weeks.
2. **Expand:** add \`amount_minor bigint NULL\` and \`currency char(3) NULL DEFAULT 'INR'\`. Adding optional fields with defaults is BACKWARD-compatible in the registry, so consumers keep working.
3. **Dual-write** in the app (both columns), or keep them in sync with a trigger during the transition.
4. **Backfill** in keyset batches. Each updated row emits a CDC event, so 500M rows = 500M events. Throttle, warn the consumers, or backfill with a replication role marked to skip CDC and publish a snapshot separately.
5. **Consumers migrate:** the warehouse model reads \`coalesce(amount_minor, amount)\`, and the indexer maps the new field.
6. **Contract:** once lag dashboards show every consumer on the new fields, stop writing \`amount\`, then drop it. Registry compatibility may need an explicit, approved exception for the removal.

### Guard rails
- Prefer publishing a **curated outbox event** over raw table CDC for external teams. The DB schema can then evolve behind a stable event contract.
- Run a CI check that diffs the Debezium schema against the registry's compatibility setting.`,
      followUps: [
        {
          q: 'Why is raw CDC risky as a cross-team contract?',
          a: 'It couples every consumer to internal table design; routine refactors (splits, renames, type changes) become cross-team breaking changes. An outbox event is an intentional API.',
        },
        {
          q: 'Could you add a generated column instead of dual-writing?',
          a: 'A stored generated column (amount_minor GENERATED ALWAYS AS (amount) STORED) keeps them in sync for the transition, but adding a stored one rewrites the table; a PG 18 virtual generated column avoids the rewrite but is computed on read and cannot be published through logical replication, so CDC consumers would not see it.',
        },
      ],
      pitfalls: [
        'Running ALTER TABLE … RENAME COLUMN and hoping consumers adapt',
        'Ignoring the CDC event volume from the backfill',
        'Forgetting consumers you do not own',
      ],
    },
    // ---------- Zero-downtime migrations ----------
    {
      id: 'misc-data-iq-19',
      difficulty: 'medium',
      question:
        'Add a NOT NULL column with no sensible default to a 500M-row Postgres table that takes 5K writes/s, without downtime. Give me the exact sequence.',
      context:
        'Widely reported as a senior backend interview prompt ("add a NOT NULL column to a 500-million-row table without downtime").',
      whatInterviewerLooksFor: [
        'Adds the column nullable first (instant)',
        'Batched, throttled backfill with keyset pagination',
        'CHECK NOT VALID + VALIDATE + SET NOT NULL (PG 12+), or PG 18 NOT NULL NOT VALID',
        'lock_timeout and retries on every DDL',
      ],
      modelAnswer: `### Sequence
1. **Expand (instant):** \`SET lock_timeout = '3s'; ALTER TABLE t ADD COLUMN c text;\` A nullable column with no default is metadata-only. Retry if the lock times out behind a long query.
2. **Code release:** the app writes \`c\` on every insert and update. From now on, new rows are never null.
3. **Backfill:** keyset batches (\`WHERE id > $last ORDER BY id LIMIT 5000\`), each its own short transaction.
   - 500M / 5K = 100K batches. At ~50 ms each plus a 20 ms pause, that is about 2 hours.
   - Throttle on replica \`replay_lag\` and primary load, make it resumable (persist the last id), and run it off-peak.
4. **Constrain without a long lock**
   - \`ALTER TABLE t ADD CONSTRAINT t_c_nn CHECK (c IS NOT NULL) NOT VALID;\` — instant.
   - \`ALTER TABLE t VALIDATE CONSTRAINT t_c_nn;\` — full scan, but only SHARE UPDATE EXCLUSIVE, so reads and writes continue.
   - \`ALTER TABLE t ALTER COLUMN c SET NOT NULL;\` — **PG 12+ skips the scan** because the valid CHECK proves it. The ACCESS EXCLUSIVE lock is held only for milliseconds.
   - \`ALTER TABLE t DROP CONSTRAINT t_c_nn;\`
   - On PG 18 you can instead add the NOT NULL constraint itself as NOT VALID and validate it.
5. **Verify** with \`SELECT count(*) WHERE c IS NULL\` (on a replica) before step 4.

### Why not the naive version?
\`ADD COLUMN c text NOT NULL DEFAULT 'x'\` is instant in PG 11+ but invents a fake value. \`UPDATE t SET c = …\` in one statement rewrites 500M rows in a single transaction: huge WAL, replica lag, bloat, and lock escalation risk. \`SET NOT NULL\` without the CHECK scans the whole table under ACCESS EXCLUSIVE.`,
      followUps: [
        {
          q: 'What does the same look like on MySQL 8?',
          a: 'ADD COLUMN … ALGORITHM=INSTANT for the nullable column, batched backfill, then changing to NOT NULL needs a table rebuild — done online (ALGORITHM=INPLACE) or with gh-ost to control load and cut-over.',
        },
        {
          q: 'Why use a trigger instead of the code release in step 2?',
          a: 'When many services write the table or code release timing is uncertain, a trigger guarantees new rows get c; remove it after the constraint is in place.',
        },
      ],
      pitfalls: [
        'One giant UPDATE for the backfill',
        'SET NOT NULL directly on a 500M-row table',
        'No lock_timeout, so the DDL queues and blocks traffic',
      ],
    },
    {
      id: 'misc-data-iq-20',
      difficulty: 'expert',
      question:
        'orders.id is a Postgres integer (int4) at 1.95 billion with ~1,500 inserts/s, and 12 tables reference it by foreign key. Plan the migration to bigint with no downtime, and tell me how long you have.',
      whatInterviewerLooksFor: [
        'Computes the deadline: 2,147,483,647 − 1.95B ≈ 197M ids ≈ 36 hours at 1.5K/s',
        'Immediate stopgap (e.g. negative ids / sequence restart plan) vs full migration',
        'Knows ALTER COLUMN TYPE rewrites and locks the table',
        'New column + trigger + backfill + concurrent unique index + swap, and FKs handled NOT VALID',
      ],
      modelAnswer: `### Deadline first
2,147,483,647 − 1,950,000,000 ≈ **197M ids**. At 1,500/s that is ~131K s ≈ **36 hours** (less at peak, or if the sequence has gaps from rollbacks). This is an incident, not a project.

### Stopgap if the full plan cannot finish in time
- Restart the sequence at −2,147,483,648 counting upward (\`ALTER SEQUENCE … MINVALUE -2147483648 RESTART WITH -2147483648\`). That buys roughly 2 billion ids, *if* no code assumes ids are positive or ordered by time. Check URL parsers, sorting, and "id > last_seen" pagination.

### Why not ALTER COLUMN TYPE bigint?
It rewrites the table and every index under ACCESS EXCLUSIVE — hours of downtime on a large table, and each FK column needs the same treatment.

### Online plan
1. \`ALTER TABLE orders ADD COLUMN id_new bigint;\` (instant). A trigger sets \`id_new = id\` on INSERT/UPDATE.
2. Backfill \`id_new\` in keyset batches, throttled on replica lag.
3. \`CREATE UNIQUE INDEX CONCURRENTLY orders_id_new_uq ON orders(id_new);\`, then \`CHECK (id_new IS NOT NULL) NOT VALID\` + VALIDATE.
4. Child tables: add \`order_id_new bigint\` columns with the same trigger + backfill, plus indexes CONCURRENTLY.
5. **Swap** in one short transaction with \`lock_timeout\`: drop the old PK/FKs, rename columns, \`ALTER SEQUENCE … AS bigint\` and set it as the new column's default, \`SET NOT NULL\` (instant thanks to the validated CHECK), add the PK \`USING INDEX orders_id_new_uq\`. Re-add FKs as **NOT VALID**, then VALIDATE later (no long locks).
6. Drop the trigger and the old columns in a later release.

### Also
- Update the app and ORM types (JS numbers are safe to 2^53; GraphQL \`Int\` is 32-bit — switch to \`ID\` or a custom scalar).
- Audit other int4 sequences: \`SELECT … FROM pg_sequences\` against type limits. Alert at 70%.`,
      followUps: [
        {
          q: 'Why does GraphQL matter here?',
          a: 'GraphQL Int is a signed 32-bit integer by spec; ids above 2^31−1 fail serialisation. Most APIs expose ids as ID (string) — check before the swap.',
        },
        {
          q: 'How long would the backfill take?',
          a: 'About 2B rows at ~20K rows/s of throttled batches ≈ 28 hours — which is why the negative-sequence stopgap may be necessary first.',
        },
      ],
      pitfalls: [
        'ALTER COLUMN TYPE bigint on a hot table',
        'Not computing the time left',
        'Forgetting FK columns in child tables and client-side types',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'misc-data-boe-1',
      question:
        'A notifications table uses an int4 identity key. It holds 1.2B rows today and grows 900 inserts/s on average with a 3× evening peak for 4 hours a day. When does the key overflow, and how much lead time does a bigint migration need?',
      assumptions: [
        'int4 max = 2,147,483,647; sequence gaps from rollbacks ~2%',
        'Average rate already includes the peaks',
        'Online migration: trigger + throttled backfill at ~15K rows/s, plus 2 weeks of engineering, review and a staged rollout',
      ],
      steps: [
        { label: 'Remaining ids', calc: '2.147B − 1.2B ≈ 0.947B; minus 2% gaps ≈ 0.93B usable' },
        { label: 'Ids per day', calc: '900/s × 86,400 ≈ 77.8M/day' },
        { label: 'Time to overflow', calc: '0.93B ÷ 77.8M ≈ 12 days' },
        { label: 'Backfill duration', calc: '1.2B rows (≈1.3B by then) ÷ 15K rows/s ≈ 86,700 s ≈ 24 h of backfill' },
        { label: 'Total lead time needed', calc: '2 weeks engineering + 1 day backfill + swap/verify ≈ 16 days > 12 days available' },
      ],
      answer:
        'About 12 days to overflow, but a careful online migration needs ~16 days, so you are already late. Apply a stopgap (restart the sequence at −2^31 if no code assumes positive ids) while running the bigint migration.',
      insight:
        'Alert on sequence usage at 50–70% of the type maximum, and default new tables to bigint (or UUIDv7). The cost is 4 extra bytes per row and index entry, far cheaper than an emergency migration.',
      followUps: [
        {
          "q": "You restart the sequence at −2^31 as a stopgap. What breaks, and how much time does it buy?",
          "a": "It doubles the space: about 2.1B more ids at 77.8M/day buys roughly 27 days. What breaks: anything assuming positive ids (URL patterns with `\\d+`, client validation, `id > 0` checks, signed vs unsigned handling in other languages, and ORDER BY id for 'newest first', since new rows now sort before old ones). Audit consumers first. Pagination by id must switch to created_at, or use `ORDER BY id` with care. It's a bridge, not a fix: the bigint migration continues in parallel."
        }
      ],
    },
    {
      id: 'misc-data-boe-2',
      question:
        'An orders service runs 60 pods, each with one Node process, and talks to 16 Postgres shards with a pool of max 8 per shard per pod. Traffic is 12K requests/s, 1.5 queries per request at 3 ms each, spread evenly across shards. How many connections can open, how many are actually needed, and what should you change?',
      assumptions: [
        'Each shard has max_connections = 500 and 16 vCPU',
        'Queries are evenly distributed; peak = 2× average',
        'PgBouncer in transaction mode is an option',
      ],
      steps: [
        { label: 'Potential connections per shard', calc: '60 pods × 8 = 480 per shard (96% of max_connections); cluster-wide 480 × 16 = 7,680' },
        { label: 'Queries per shard', calc: '12K × 1.5 ÷ 16 ≈ 1,125 q/s average; peak ≈ 2,250 q/s' },
        { label: 'Busy connections per shard (Little’s law)', calc: '2,250 q/s × 0.003 s ≈ 6.75 → ~7 busy connections at peak' },
        { label: 'Per pod per shard', calc: '7 ÷ 60 pods ≈ 0.1 busy connections — a pool of 8 is ~80× oversized' },
        { label: 'With PgBouncer per shard', calc: 'server pool ≈ 2–3× busy ≈ 20 connections per shard; clients can still hold 480 cheap client slots' },
      ],
      answer:
        'Up to 480 connections per shard (7,680 total) can open, while only ~7 per shard are busy at peak. Cut the per-shard pool to 2 per pod (120 per shard) or put PgBouncer in front of each shard with ~20 server connections.',
      insight:
        'Sharding multiplies connection counts: pods × shards × pool. Size pools from Little’s law per shard, not per service, and pool server-side once pods × shards grows. Otherwise an HPA scale-out exhausts every shard at once.',
      followUps: [
        {
          "q": "During a promo the HPA scales from 60 to 200 pods. With your recommended pool of 2 per shard, are you still safe?",
          "a": "Potential connections per shard become 200 × 2 = 400, which is under 500 but at 80%, leaving little room for admin and replication connections, and any later pool increase breaks it. Busy connections stay tied to query rate, not pod count: at 2× traffic about 14 busy per shard. So the extra 386 slots are idle overhead, each costing Postgres backend memory (several MB). PgBouncer per shard is the robust answer: clients can scale to thousands while server connections stay around 20–40. Alternatively, set pool min 0 and short idle timeouts so idle pods release connections."
        }
      ],
    },
    {
      id: 'misc-data-boe-3',
      question:
        'An events table receives 2.5B rows/year (~220 bytes per row including index overhead) with 90-day retention. Compare monthly vs daily range partitions and the cost of DELETE-based retention.',
      assumptions: [
        'Rows arrive evenly; queries mostly filter the last 1–7 days',
        'DELETE throughput on this box ≈ 50K rows/s while serving traffic, each deleted row later vacuumed',
        'Planning overhead grows noticeably above a few hundred partitions touched',
      ],
      steps: [
        { label: 'Rows per day', calc: '2.5B ÷ 365 ≈ 6.85M rows/day' },
        { label: 'Data kept', calc: '6.85M × 90 ≈ 616M rows × 220 B ≈ 136 GB' },
        { label: 'Daily partitions', calc: '~92 partitions of ~1.5 GB each; "last 7 days" prunes to 8 partitions' },
        { label: 'Monthly partitions', calc: '~4 partitions of ~45 GB each; 90-day retention granularity is a month, so up to ~120 days kept (≈180 GB)' },
        { label: 'DELETE-based retention', calc: '6.85M rows/day ÷ 50K/s ≈ 137 s of deleting daily, plus the vacuum of 6.85M dead tuples and ~1.5 GB of WAL/day' },
      ],
      answer:
        'Daily partitions (~92 × 1.5 GB) give exact 90-day retention, good pruning and a DETACH+DROP that takes seconds. Monthly keeps ~30% extra data. DELETE works at this size but adds daily WAL, vacuum and bloat.',
      insight:
        'Choose partition granularity from the retention unit and the query window. Tens to low hundreds of partitions is the sweet spot. Pre-create them ahead (pg_partman) and keep the DEFAULT partition empty.',
      followUps: [
        {
          "q": "Retention changes to 'delete a single user's events on request' (GDPR) on top of the 90-day window. Does daily partitioning help?",
          "a": "Not directly: one user's events are spread across all 92 partitions, so deletion is a DELETE across every partition, which is fine if there's an index on user_id in each partition (92 index lookups). At, say, 1,000 erasure requests per day with about 5K rows each, that's 5M deleted rows per day, similar to the daily volume, adding vacuum work. Batch erasures nightly. Daily partitions still make the bulk retention free. Alternatively, encrypt event payloads with per-user keys and delete the key (crypto-shredding), leaving rows to age out with their partition."
        }
      ],
    },
    {
      id: 'misc-data-boe-4',
      question:
        'You must backfill a new column on a 400M-row Postgres table without letting async replica lag exceed 10 seconds. Replicas replay ~40 MB/s of WAL, normal traffic uses 10 MB/s, and each updated row generates ~350 bytes of WAL (new tuple + index entries). How long will the backfill take?',
      assumptions: [
        'Replica replay capacity is the binding constraint, not primary CPU',
        'Keep a 50% safety margin on spare replay capacity',
        'Batches of 5,000 rows; full-page images add ~30% WAL after checkpoints',
      ],
      steps: [
        { label: 'Spare replay capacity', calc: '40 − 10 = 30 MB/s; with 50% margin → 15 MB/s for the backfill' },
        { label: 'WAL per row incl. FPIs', calc: '350 B × 1.3 ≈ 455 B/row' },
        { label: 'Sustainable row rate', calc: '15 MB/s ÷ 455 B ≈ 33K rows/s → ~6–7 batches of 5K per second' },
        { label: 'Duration', calc: '400M ÷ 33K ≈ 12,100 s ≈ 3.4 hours' },
        { label: 'Total WAL generated', calc: '400M × 455 B ≈ 182 GB — archive storage, backups and CDC must absorb it' },
      ],
      answer:
        'Roughly 3.5 hours at ~33K rows/s, generating ~180 GB of WAL. Throttle on measured replay_lag rather than a fixed rate, because traffic peaks shrink the spare capacity.',
      insight:
        'Backfill speed is capped by the slowest WAL consumer (replicas, CDC slots, archive), not by the primary. Throttle on lag feedback and schedule off-peak. Every backfilled row is also a CDC event downstream.',
      followUps: [
        {
          "q": "There's also a logical replication slot feeding Debezium, which can only process 8 MB/s. Redo the estimate.",
          "a": "Now the slowest WAL consumer is Debezium at 8 MB/s, and normal traffic already uses 10 MB/s of WAL. That means Debezium can't keep up even without the backfill, unless the CDC publication only includes some tables. Suppose the publication covers this table and others, and Debezium decodes about 8 MB/s of relevant change data. Then the spare capacity may be near zero, and the slot will retain WAL on the primary (disk risk) during the backfill. Options: keep the backfill out of CDC (a row filter on the publication, or tag backfill transactions with `pg_logical_emit_message` so Debezium consumers skip them cheaply), run the backfill much slower (about 3–5K rows/s, so 22–37 hours), or scale Debezium. Monitor `pg_replication_slots` retained WAL."
        }
      ],
    },
  ],
  test: [
    // ---------- Database Indexing ----------
    {
      id: 'misc-data-mcq-01',
      difficulty: 'expert',
      question:
        'The same query and index run on Postgres 17 and Postgres 18 with identical data (400M rows, region has 6 distinct values). What is the most likely difference in plans?',
      code: {
        language: 'sql',
        code: `CREATE INDEX orders_region_created ON orders (region, created_at);

SELECT id, total FROM orders
WHERE created_at >= now() - interval '15 minutes';   -- ~40K rows`,
      },
      options: [
        'Both use an Index Scan with a normal range seek on created_at, because Postgres always reorders composite index columns to fit the predicate',
        'PG 17 likely falls back to a sequential or full index scan; PG 18 can use a skip scan that probes each of the 6 regions and range-scans created_at within each',
        'Both use a skip scan; Postgres has supported skip scans on multicolumn B-trees since version 12',
        'PG 18 builds a temporary single-column index on created_at at execution time because the leading column is missing',
      ],
      correct: [1],
      explanation:
        'B-tree skip scan arrived in Postgres 18. It repeatedly seeks to each distinct value of the omitted leading column, which is efficient when that column has few distinct values (6 here). Earlier versions cannot seek on a non-leading column, so they pick a sequential scan or read the whole index. Postgres never reorders index columns, did not have skip scan in v12, and never builds indexes on the fly.',
      followUps: [
        {
          "q": "region gains 5,000 distinct values after an expansion. Does the PG 18 skip scan still help, and what would you do instead?",
          "a": "Skip scan cost grows with the number of distinct leading values: 5,000 regions means 5,000 descents into the index, each followed by a range scan on created_at. The planner may then prefer a sequential scan, or the skip scan becomes slower than a dedicated index. If created_at-only queries are frequent, add an index on (created_at) or (created_at, region), or a BRIN index on created_at if the data is inserted in time order (tiny and cheap for range filters). Check with `EXPLAIN (ANALYZE, BUFFERS)` and compare buffer reads, not just estimated cost."
        }
      ],
    },
    {
      id: 'misc-data-mcq-02',
      difficulty: 'hard',
      question:
        'After switching a 30K inserts/s Postgres table from bigint identity to random UUIDv4 primary keys, WAL volume roughly doubled though row size grew only 8 bytes. What best explains the WAL growth?',
      options: [
        'UUID columns are TOASTed and each insert writes a separate TOAST row to WAL',
        'Random keys touch many distinct index leaf pages between checkpoints, and the first change to each page after a checkpoint writes a full 8 KB page image to WAL',
        'Postgres logs the full 36-character text form of each UUID in WAL because uuid has no binary representation',
        'Random keys disable HOT updates, so every insert also writes a dead tuple',
      ],
      correct: [1],
      explanation:
        'With full_page_writes on, the first modification of any page after a checkpoint logs the whole page. Sequential keys keep modifying the same rightmost leaf, while random keys dirty thousands of distinct leaves per checkpoint interval, so full-page images multiply. uuid is a 16-byte binary type and is not TOASTed; HOT concerns updates, not inserts.',
      followUps: [
        {
          "q": "You can't change the key type back this quarter. How do you reduce the WAL and index cost of the random UUIDs?",
          "a": "Options without a schema change: increase `checkpoint_timeout` and `max_wal_size` (for example 15–30 minutes), so each leaf page gets its full-page image once per longer interval, which cuts FPIs substantially at the cost of longer crash recovery. Enable `wal_compression` (lz4 or zstd in PG 15+), which compresses FPIs 2–4×. Give the index a lower fillfactor to reduce page splits. Medium term, generate UUIDv7 in the application for new rows: same column type, time-ordered values, so inserts go back to the right edge of the B-tree, while existing v4 values remain valid."
        }
      ],
    },
    {
      id: 'misc-data-mcq-03',
      difficulty: 'hard',
      question:
        'A MySQL InnoDB table uses a VARCHAR(36) UUID string as its primary key and has 6 secondary indexes. Which statements are accurate? Select ALL that apply.',
      options: [
        'Every secondary index entry stores the 36-byte primary key value, so the wide PK inflates all six indexes',
        'Random PK values cause page splits in the clustered index, which is the table data itself',
        'A secondary index lookup that needs non-indexed columns does a second B-tree lookup by primary key',
        'InnoDB secondary indexes store a physical row pointer (like Postgres ctid), so PK width does not matter for them',
        'Switching the PK to BINARY(16) of a time-ordered UUID reduces both index size and insert page splits',
      ],
      correct: [0, 1, 2, 4],
      explanation:
        'InnoDB clusters rows in the PK B-tree, and secondary indexes store the PK as the row locator. So PK width multiplies across indexes, and a secondary lookup needing other columns does a second lookup in the clustered index. Random keys split data pages. Postgres, not InnoDB, uses physical tuple pointers. Binary, time-ordered UUIDs shrink the key and keep inserts near the right edge.',
      followUps: [
        {
          "q": "Changing the 2 TB table's PK from VARCHAR(36) to BINARY(16) means rebuilding it. How do you do that online, and what about every table holding foreign keys to it?",
          "a": "Do it in stages. Add a `id_bin BINARY(16)` column, populated by the app for new rows and backfilled with `UNHEX(REPLACE(id,'-',''))` in throttled batches. Then rebuild the table with gh-ost (or pt-osc) to make `id_bin` the PK and keep the old string as a unique secondary key during transition. Referencing tables need the same treatment: add binary FK columns, backfill, switch joins, then drop the string columns. gh-ost doesn't support foreign keys, so either drop the FK constraints (enforce in the app) during migration or use pt-osc with `--alter-foreign-keys-method`. Plan disk space for a full copy of each table."
        }
      ],
    },
    // ---------- Connection Pooling ----------
    {
      id: 'misc-data-mcq-04',
      difficulty: 'expert',
      question:
        'This code runs in a Node service with pool max = 10 and default connectionTimeoutMillis. It works in testing. At 40 concurrent requests in production, what happens?',
      code: {
        language: 'typescript',
        code: `async function placeOrder(userId: string, items: Item[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderId = await insertOrder(client, userId, items);
    await audit.log(userId, 'order_placed', orderId); // audit.log uses pool.query(...)
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}`,
      },
      options: [
        'The audit insert joins the open transaction automatically because both use the same pool',
        'Requests become slower but complete, since the pool grows past max when callers are waiting',
        'All 10 connections get held by requests that are each waiting for an 11th for audit.log; with no acquire timeout they wait forever and the service hangs',
        'Postgres detects the deadlock and aborts one of the transactions with 40P01 after deadlock_timeout',
      ],
      correct: [2],
      explanation:
        'Each request holds one client and then asks the pool for another. Once 10 requests hold all connections, every one waits for a connection that will only be released after the wait finishes: a pool-level deadlock. node-postgres waits forever by default (connectionTimeoutMillis = 0). Postgres cannot see it because no database lock is involved, pools never exceed max, and a separate pool.query does not join the transaction.',
      followUps: [
        {
          "q": "Besides fixing the code, how would you detect this kind of pool deadlock quickly in production next time?",
          "a": "Set `connectionTimeoutMillis` (say 2 s), so a starved acquire throws a clear 'timeout exceeded when trying to connect' error instead of hanging. Export pool metrics every few seconds: `pool.totalCount`, `idleCount` and `waitingCount`. The signature is total = max, idle = 0, waiting climbing, while Postgres itself is idle (low active sessions in `pg_stat_activity`). Alert on waitingCount above 0 for more than 10 s. Code-level prevention: a lint rule or wrapper that forbids `pool.query` or `pool.connect` while a client is checked out in the same request, by passing the transaction client explicitly."
        }
      ],
    },
    {
      id: 'misc-data-mcq-05',
      difficulty: 'medium',
      question:
        'An API moves to AWS Lambda. During a promotion it scales to 1,200 concurrent executions, each creating a pg Pool with max 10 at cold start. The RDS Postgres instance has max_connections = 1,000. What is the right fix?',
      options: [
        'Raise max_connections to 12,000 so every Lambda can open its full pool',
        'Use a pool of 1 per execution environment and put RDS Proxy (or PgBouncer) in front so thousands of short-lived clients share a small set of server connections',
        'Create the pool inside the handler so it is closed after every invocation',
        'Switch to REPEATABLE READ so fewer connections are needed per request',
      ],
      correct: [1],
      explanation:
        'Each Lambda environment handles one request at a time, so a pool of 10 only wastes connections; 1,200 × 10 far exceeds the limit. A proxy multiplexes many client connections onto few server connections. Raising max_connections to 12K costs memory and hurts throughput, per-invocation pools add connection setup to every request, and isolation level has nothing to do with connection count.',
      followUps: [
        {
          "q": "RDS Proxy runs in transaction-pooling style. Which application features can break or 'pin' connections, and why does that matter?",
          "a": "Anything relying on session state pins a client to one server connection for the session's life: session-level `SET` statements, temporary tables, advisory locks held across transactions, `LISTEN/NOTIFY`, and with some proxies named prepared statements. RDS Proxy then can't multiplex that client, so you're back to one server connection per Lambda, and the 1,000-connection limit can be exceeded again. Keep Lambda code stateless per transaction: use `SET LOCAL` inside transactions, avoid temp tables, and check the `DatabaseConnectionsCurrentlySessionPinned` metric. PgBouncer 1.21+ supports protocol-level prepared statements in transaction mode."
        }
      ],
    },
    {
      id: 'misc-data-mcq-06',
      difficulty: 'hard',
      question:
        'After a managed Postgres failover (the DNS name now points to the new primary), a service keeps failing some writes with "cannot execute INSERT in a read-only transaction" for 20 minutes, while other pods recovered. Which changes address this? Select ALL that apply.',
      options: [
        'Set a maximum connection lifetime so pooled sockets are periodically re-established and re-resolve DNS',
        'On read-only errors (SQLSTATE 25006), destroy the connection instead of returning it to the pool',
        'Connect with target_session_attrs=read-write (libpq) / targetServerType=primary (pgJDBC) so a connection to a standby is rejected',
        'Increase the pool size so new connections are opened to the new primary more often',
        'Raise statement_timeout so writes have longer to succeed on the old primary',
      ],
      correct: [0, 1, 2],
      explanation:
        'The pool kept long-lived sockets to the old primary, which rejoined as a read-only standby. Recycling connections by lifetime, evicting on read-only errors, and making the driver refuse non-primary sessions all fix that. A bigger pool keeps the stale connections too, and a longer statement_timeout does not make a standby writable.',
      followUps: [
        {
          "q": "You set a max connection lifetime of 5 minutes on 200 pods with 10 connections each. What new risk appears, and how do you mitigate it?",
          "a": "If all pods start at the same time (deploy), their connections hit the 5-minute lifetime together, so about 2,000 reconnects happen in a burst every 5 minutes, each costing a TLS handshake plus Postgres backend fork (a few milliseconds of CPU each). That causes periodic latency spikes. Mitigate with jitter on lifetime (5 minutes ±20%, which pg-pool's `maxLifetimeSeconds` lacks, so add a randomised value per pool or retire connections gradually), and keep a server-side pooler such as PgBouncer, which makes client reconnects cheap. Recycle idle connections first rather than in-use ones."
        }
      ],
    },
    // ---------- Replication ----------
    {
      id: 'misc-data-mcq-07',
      difficulty: 'expert',
      question:
        'A legacy MySQL cluster still uses binlog_format = STATEMENT. Which of these statements can leave the replica with different data from the source? Select ALL that apply.',
      code: {
        language: 'sql',
        code: `-- A
INSERT INTO sessions (id, created_at) VALUES (UUID(), NOW());
-- B
UPDATE counters SET hits = hits + 1 WHERE page_id = 42;
-- C
DELETE FROM job_queue WHERE status = 'done' LIMIT 1000;
-- D
INSERT INTO audit (at) VALUES (SYSDATE());
-- E
INSERT INTO audit (at) VALUES (NOW());`,
      },
      options: ['A', 'B', 'C', 'D', 'E'],
      correct: [0, 2, 3],
      explanation:
        'UUID() generates a different value on the replica (A). DELETE … LIMIT without ORDER BY may pick different rows depending on physical order (C). SYSDATE() returns wall-clock time at execution rather than the logged statement timestamp (D). NOW() is safe because the binlog carries the source timestamp (SET TIMESTAMP), and B is deterministic. Row-based logging (the default since 5.7.7) avoids all of this.',
      followUps: [
        {
          "q": "You switch the cluster to ROW format. What operational costs come with it, and what's the safe way to flip it on a live source with replicas?",
          "a": "Costs: bigger binlogs for multi-row updates (an UPDATE touching 1M rows logs 1M row images rather than one statement), so plan disk and replication bandwidth, and consider `binlog_row_image=MINIMAL` to log only changed columns plus keys. Flipping: `binlog_format` can be changed dynamically, but existing sessions keep their old format, and replicas must handle row events (they do). Set it globally, then cycle application connections so all sessions use ROW. Verify with `SHOW BINLOG EVENTS`. Run pt-table-checksum afterwards to find replicas that already drifted under STATEMENT and fix them with pt-table-sync."
        }
      ],
    },
    {
      id: 'misc-data-mcq-08',
      difficulty: 'expert',
      question:
        'You have one synchronous standby and route "read your own write" requests to it. Users still occasionally miss their just-committed change there. Which synchronous_commit setting makes a commit wait until the change is visible to queries on that standby?',
      options: [
        'remote_write — the standby has received the WAL and written it to the OS',
        'on — the standby has flushed the WAL to durable storage',
        'remote_apply — the standby has replayed the WAL, so new snapshots there include the change',
        'local — the primary has flushed locally; the standby is updated synchronously in the background',
      ],
      correct: [2],
      explanation:
        'Only remote_apply waits for the standby to replay the commit, which makes it visible to new queries there. on and remote_write guarantee durability or receipt on the standby, but replay can still lag, so reads there can be stale. local does not wait for the standby at all. The cost of remote_apply is higher commit latency, including the replay time.',
      followUps: [
        {
          "q": "remote_apply adds commit latency. How would you get read-your-writes for those users without paying it on every commit?",
          "a": "Make it per-request instead of global. `synchronous_commit` can be set per transaction (`SET LOCAL synchronous_commit = remote_apply`), so only writes whose authors will immediately read on the standby pay the cost. Alternatively, have the app capture the commit LSN after writing (`pg_current_wal_lsn()`), store it in the user's session, and before reading on a replica check `pg_last_wal_replay_lsn() >= stored_lsn`; if the replica isn't there yet, wait briefly or read from the primary. That gives read-your-writes with no extra commit latency for everyone else."
        }
      ],
    },
    {
      id: 'misc-data-mcq-09',
      difficulty: 'hard',
      question:
        'At 14:02 someone ran DROP TABLE invoices on the Postgres primary. You have two streaming replicas and one standby with recovery_min_apply_delay = \'1h\'. It is 14:10. What is the fastest safe recovery?',
      options: [
        'Promote one of the streaming replicas; replicas do not apply DDL immediately',
        'Pause WAL replay on the delayed standby (pg_wal_replay_pause()), dump the invoices table from it, and restore it into the primary, then reconcile rows written after 14:02',
        'Promote the delayed standby immediately and point all traffic at it',
        'Restore last night’s base backup over the primary and replay WAL to 14:01',
      ],
      correct: [1],
      explanation:
        'Streaming replicas replayed the DROP within milliseconds. The delayed standby is an hour behind, so pausing replay freezes it before the DROP, and the table can be dumped from it while it serves read-only queries. Promoting it would discard an hour of everyone’s writes, and restoring the whole primary from backup is slower and also throws away other tables’ writes after 14:01.',
      followUps: [
        {
          "q": "It's now 14:58. Replay on the delayed standby will reach the DROP at 15:02. What exactly do you do in the next 4 minutes, and what could go wrong?",
          "a": "Immediately run `SELECT pg_wal_replay_pause();` on the delayed standby and verify with `pg_is_wal_replay_paused()` and `pg_last_xact_replay_timestamp()` (it should be before 14:02). Paused, it stays frozen indefinitely, so the urgency is gone. Then `pg_dump -t invoices` from it and restore into the primary under a new name, then reconcile and rename. Risks: the paused standby retains WAL from the primary, so if it's a slot-based replica the primary's disk fills over hours; plan cleanup. Also writes that went to the dropped table between 14:02 and the restore failed, so check application errors for lost requests."
        }
      ],
    },
    // ---------- Read Replicas ----------
    {
      id: 'misc-data-mcq-10',
      difficulty: 'hard',
      question:
        'The reporting team wants six extra indexes that help only their dashboards, without adding write cost to the OLTP primary. Where can those indexes live?',
      options: [
        'On a physical streaming replica; replicas can create their own indexes because they are read-only',
        'On a logical-replication subscriber (or CDC-fed store), which is a separate database that can have its own indexes',
        'On the primary as partial indexes, which are not maintained on writes',
        'On a physical replica, as long as hot_standby_feedback is enabled',
      ],
      correct: [1],
      explanation:
        'A physical replica is a byte-identical copy of the primary’s cluster: you cannot create objects on it, and every index it has comes from the primary. A logical subscriber applies row changes into its own tables, so it can carry extra indexes (and different retention). Partial indexes are still maintained for rows matching their predicate, and hot_standby_feedback only affects vacuum and query cancellation.',
      followUps: [
        {
          "q": "The logical subscriber lags during the nightly batch and the dashboards show yesterday's numbers. How do you make reports trustworthy about freshness?",
          "a": "Expose freshness explicitly. On the subscriber, record the last applied commit time (from `pg_stat_subscription.latest_end_time`, or a heartbeat table the primary updates every few seconds and that replicates through), and show 'data as of 03:12' on every dashboard. Alert when lag exceeds the reporting SLO. Speed up apply: PG 16+ supports parallel apply for large transactions (`streaming = parallel`), and splitting the batch into smaller transactions avoids one giant transaction holding everything back. Report queries should never silently mix fresh and stale data."
        }
      ],
    },
    {
      id: 'misc-data-mcq-11',
      difficulty: 'expert',
      question:
        'A lag-aware router sends reads to 3 replicas and falls back to the primary when replica lag > 2 s. A nightly bulk update lags all replicas by 60 s and the primary collapses under the redirected reads. Which changes prevent a repeat? Select ALL that apply.',
      options: [
        'Classify endpoints by staleness tolerance and keep tolerant reads on replicas even when they lag',
        'Cap primary read concurrency with a small dedicated pool and shed or degrade reads when it is full',
        'Throttle the bulk job in batches based on measured replay lag',
        'Add two more replicas so the average lag is lower',
        'Lower the lag threshold to 500 ms so the fallback triggers earlier and more gradually',
      ],
      correct: [0, 1, 2],
      explanation:
        'All replicas lag together when one heavy writer floods WAL, so more replicas lag too. A lower threshold only fails over sooner. The fix is to not route everything to the primary: tolerate staleness where the product allows, bound the primary’s read share so writes stay healthy, and stop the batch job from generating lag in the first place.',
      followUps: [
        {
          "q": "Design the throttle for the nightly bulk job. What signal does it read, and how does it adapt?",
          "a": "Read the actual replay lag from the replicas, not a guess: `now() - pg_last_xact_replay_timestamp()` on each replica (or `replay_lag` in `pg_stat_replication` on the primary), taking the maximum across replicas and CDC slots. Control loop: process batches of N rows (for example 5,000); if max lag is under 1 s, shrink the sleep or grow N; if it's over 3 s, pause until it drops under 1 s, and halve N. Make the job resumable by keyset (last processed id) so pausing for minutes costs nothing. Also bound it to off-peak hours."
        }
      ],
    },
    {
      id: 'misc-data-mcq-12',
      difficulty: 'medium',
      question:
        'Three read replicas each run at 70% CPU at peak. One replica’s host fails during peak. What should you expect if nothing else changes?',
      options: [
        'Nothing noticeable: replicas share a buffer cache, so the other two absorb the load easily',
        'The remaining two go to ~105% of capacity, queue and time out, and health checks may eject them in turn — a cascading failure',
        'The primary automatically takes over one-third of reads without affecting writes',
        'Load drops because clients connected to the failed replica stop sending traffic',
      ],
      correct: [1],
      explanation:
        'Three replicas at 70% is 210% of one replica’s capacity. Two replicas now need to carry 105% each, so they saturate, latency climbs, and ejections can cascade. Replica fleets need N+1 headroom (e.g. ≤ 60% on three). Replicas do not share caches, clients retry rather than disappear, and redirecting to the primary is a policy choice that can hurt writes.',
      followUps: [
        {
          "q": "You add a fourth replica for N+1. A month later traffic has grown 30%. How do you keep the headroom guarantee from silently eroding?",
          "a": "Turn the guarantee into an alert. With 4 replicas, each must stay at or below 75% × 3/4 ≈ 56% CPU at peak so that losing one keeps the others under 75%. Alert when the peak load summed across replicas exceeds (N−1) × safe threshold. Track it weekly in capacity reviews with growth forecasts. Also apply load shedding or degradation on the read path, so a breach causes graceful slowdowns rather than a cascade. Health-check ejection should have a cap (never eject below 2 replicas), so a saturated fleet isn't emptied by its own checks."
        }
      ],
    },
    // ---------- Sharding ----------
    {
      id: 'misc-data-mcq-13',
      difficulty: 'hard',
      question:
        'Users are sharded by user_id across 16 Postgres clusters, each with UNIQUE(email) on its users table. Two people sign up with the same email at the same moment. What is true?',
      options: [
        'The second insert fails because Postgres unique constraints are enforced across all clusters connected by logical replication',
        'Both can succeed if their user_ids hash to different shards; global uniqueness needs something like a lookup table keyed and sharded by normalised email, written first',
        'Both succeed but a nightly VACUUM detects and removes the duplicate',
        'The router serialises sign-ups globally, so the race cannot happen',
      ],
      correct: [1],
      explanation:
        'Each shard’s constraint sees only its own rows, so duplicates across shards are allowed. A common fix is an email → user_id table sharded by email: inserting there first makes that shard’s primary key the global uniqueness check. Postgres constraints never span clusters, VACUUM does not deduplicate, and a typical router does not serialise writes.',
      followUps: [
        {
          "q": "The email lookup insert succeeds, then the user insert on the user shard fails. Now the email is 'taken' by nobody. How do you handle that?",
          "a": "Treat the lookup row as a reservation with a state. Insert `(email, user_id, status='PENDING', created_at)` first; then create the user on its shard; then mark the reservation ACTIVE. If the user insert fails, delete the reservation (best effort). A sweeper removes PENDING reservations older than, say, 10 minutes whose user row doesn't exist. Signups for the same email during that window see 'taken' briefly, which is acceptable. Use a deterministic user_id (generated before both steps) so retries are idempotent across both inserts."
        }
      ],
    },
    {
      id: 'misc-data-mcq-14',
      difficulty: 'expert',
      question:
        'Tenant 881 is moved from shard 3 to shard 9: copy, CDC catch-up, brief write freeze, flip the directory entry. Minutes after the move, some writes for tenant 881 appear on shard 3 again. What is the root cause in this router?',
      code: {
        language: 'typescript',
        code: `const cache = new Map<string, { shard: number; at: number }>();

async function shardFor(tenantId: string): Promise<number> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.shard; // 5 min TTL
  const shard = await directory.lookup(tenantId);
  cache.set(tenantId, { shard, at: Date.now() });
  return shard;
}

async function write(tenantId: string, sql: string, params: unknown[]) {
  const shard = await shardFor(tenantId);
  return pools[shard].query(sql, params);
}`,
      },
      options: [
        'The directory lookup is not wrapped in a transaction, so it can return a half-committed value',
        'Pods keep a stale cached mapping for up to 5 minutes and the old shard still accepts writes; the move needs fencing (make tenant read-only on the source, or a version/epoch check) and cache invalidation',
        'Map is not thread-safe in Node, so concurrent requests corrupt the cache entry',
        'pools[shard] reuses connections that were opened before the move, and those connections are pinned to shard 3',
      ],
      correct: [1],
      explanation:
        'Each pod trusts its cached mapping for 5 minutes, and nothing stops shard 3 from accepting writes for a tenant it no longer owns, so writes split between shards. Safe moves fence the source (revoke writes for that tenant, or check a mapping version in each write) and push invalidations to routers. Node runs this on one thread, the directory value is committed, and pools are per shard, not per tenant.',
      followUps: [
        {
          "q": "Write-side fencing: how would each write prove it's going to the current owner of tenant 881?",
          "a": "Store an ownership epoch. The directory holds (tenant, shard, epoch), and each shard holds a small `tenant_ownership(tenant, epoch, writable)` table. During a move: set `writable=false` for 881 on shard 3 (this blocks writes there), copy the final changes, set shard 9 to `epoch=N+1, writable=true`, then update the directory. Every write transaction includes a guard: `UPDATE ... WHERE EXISTS (SELECT 1 FROM tenant_ownership WHERE tenant=$1 AND writable AND epoch=$2)`, or a check at transaction start. A router with a stale cache hits shard 3, gets a 'moved' error, refreshes its directory and retries on shard 9. No split writes are possible."
        }
      ],
    },
    {
      id: 'misc-data-mcq-15',
      difficulty: 'medium',
      question:
        'On Citus, orders is distributed by customer_id but order_items is distributed by its own id. The "order with its items" query became slow and generates network traffic between workers. What is the idiomatic fix?',
      options: [
        'Make order_items a reference table so it is copied to every node',
        'Distribute order_items by customer_id too (adding the column) and colocate it with orders, so the join runs locally on each shard',
        'Add a B-tree index on order_items.order_id on every worker',
        'Increase citus.max_adaptive_executor_pool_size so the repartition join runs faster',
      ],
      correct: [1],
      explanation:
        'Joins stay shard-local only when both tables are distributed on the same key and colocated. Carrying customer_id in child tables is the standard multi-tenant pattern. Reference tables suit small, rarely changed dimensions, not a large, fast-growing items table. An index does not remove the cross-node shuffle, and more executor connections only speed up the wrong plan.',
      followUps: [
        {
          "q": "Adding customer_id to order_items means changing a 2B-row distributed table. How do you migrate without downtime?",
          "a": "Create a new distributed table `order_items_v2`, distributed by customer_id and colocated with orders (`colocate_with => 'orders'`). Dual-write from the app (or a trigger) to both tables. Backfill v2 in batches by joining order_items to orders to get customer_id, throttled per worker. Verify counts and checksums per customer, switch reads to v2 behind a flag, stop writing the old table, and drop it. The primary key becomes (customer_id, id), since unique constraints in Citus must include the distribution column; update any code that looks up items by id alone to include customer_id."
        }
      ],
    },
    // ---------- Partitioning ----------
    {
      id: 'misc-data-mcq-16',
      difficulty: 'hard',
      question:
        'orders is range-partitioned by month on created_at (36 partitions, each with an index on id). GET /orders/:id runs the query below and got ~20× slower after partitioning. Which change restores single-partition lookups?',
      code: {
        language: 'sql',
        code: `-- id is a Snowflake-style id whose top bits encode the creation time (ms)
SELECT * FROM orders WHERE id = $1;`,
      },
      options: [
        'Add a single global B-tree index on orders(id) across all partitions',
        'Derive the creation-time window from the id in the app and add AND created_at BETWEEN $2 AND $3, so the planner prunes to one partition',
        'Run ANALYZE on the parent table so the planner learns which partition holds each id',
        'Switch to plan_cache_mode = force_generic_plan so the plan is reused',
      ],
      correct: [1],
      explanation:
        'Pruning requires a predicate on the partition key; without created_at, every partition’s index is probed. Because the id encodes the time, the app can compute a narrow created_at window and prune to one partition. Postgres has no global indexes on partitioned tables, statistics do not map ids to partitions, and a generic plan does not add pruning information.',
      followUps: [
        {
          "q": "Some old ids were generated before you switched to time-ordered ids, so you can't derive created_at from them. How do you keep fast lookups by id?",
          "a": "Maintain a lookup table `order_locator(id PRIMARY KEY, created_at)`, which is small (about 30 bytes per row) and unpartitioned or hash-partitioned by id. GET /orders/:id first looks up created_at, then queries the partitioned table with the partition key, which prunes to one partition. That's two index lookups instead of 36. Populate it on insert in the same transaction, and backfill once for old rows. Alternatively, hash-partition by id instead of range by time, but that loses cheap DROP-partition retention, so the locator table is usually the better trade-off."
        }
      ],
    },
    {
      id: 'misc-data-mcq-17',
      difficulty: 'expert',
      question:
        'Which statements about Postgres declarative partitioning are accurate? Select ALL that apply.',
      options: [
        'Creating a new partition requires scanning the DEFAULT partition, and fails if the default holds rows that belong in the new range',
        'DETACH PARTITION … CONCURRENTLY (PG 14+) avoids an ACCESS EXCLUSIVE lock on the parent for the whole detach, but cannot run inside a transaction block',
        'A UNIQUE constraint on the parent must include all partition key columns',
        'A query with WHERE created_at > now() - interval \'1 day\' cannot prune at all because now() is not a constant',
        'Postgres automatically creates next month’s partition when the first row for it arrives',
      ],
      correct: [0, 1, 2],
      explanation:
        'The default partition must be checked for rows that would now belong to the new partition. CONCURRENTLY detach uses a two-step process with weaker locks and is disallowed in a transaction block. Unique constraints must include the partition key because indexes are per partition. Stable expressions like now() are pruned at execution time (runtime pruning), and Postgres never creates partitions automatically — use pg_partman or a cron job.',
      followUps: [
        {
          "q": "The pre-creation cron failed silently last month and rows landed in the DEFAULT partition. Now creating the missing partition fails. How do you recover?",
          "a": "Create a standalone table for the month (`orders_2026_09`) with the right structure and indexes. In a transaction, under a short lock: move the matching rows from the default partition into it (`WITH moved AS (DELETE FROM orders_default WHERE created_at >= ... AND created_at < ... RETURNING *) INSERT INTO orders_2026_09 SELECT * FROM moved`), then `ALTER TABLE orders ATTACH PARTITION orders_2026_09 FOR VALUES FROM (...) TO (...)`. Add a CHECK constraint matching the range beforehand so ATTACH skips its validation scan. For large volumes, move in batches first. Then alert whenever the default partition holds any rows, and alert on future partitions not existing at least 7 days ahead."
        }
      ],
    },
    {
      id: 'misc-data-mcq-18',
      difficulty: 'hard',
      question:
        'A MySQL 8 migration tries to partition an InnoDB orders table by RANGE (YEAR(created_at)). The table has PRIMARY KEY (id), UNIQUE (order_number) and a FOREIGN KEY to customers. What happens?',
      options: [
        'It succeeds; MySQL automatically extends the unique keys with created_at',
        'It fails: every unique key (including the PK) must include all columns used in the partitioning expression, and partitioned InnoDB tables do not support foreign keys',
        'It succeeds, but the foreign key is silently converted into a trigger',
        'It fails only because YEAR() is not allowed in partitioning expressions',
      ],
      correct: [1],
      explanation:
        'MySQL requires every unique key to use every column in the partitioning expression, so both the PK and UNIQUE(order_number) would need created_at. InnoDB partitioned tables also cannot have or be referenced by foreign keys. YEAR() is an allowed partitioning function, and MySQL never rewrites keys or converts FKs into triggers.',
      followUps: [
        {
          "q": "Partitioning is blocked by the FK and unique key. What other way can you get cheap retention and smaller hot data for this MySQL table?",
          "a": "Archive instead of partitioning. Move old orders to an `orders_archive` table (or cold storage) with pt-archiver in small, throttled batches during off-peak hours, keeping the hot table small so indexes stay in the buffer pool. Or restructure: drop the FK (enforce it in the app), make the PK `(id, created_at)`, and replace the global `UNIQUE(order_number)` with a separate lookup table that enforces uniqueness. Then partitioning becomes possible, and old partitions are dropped in seconds. Choose based on whether order_number uniqueness can move to its own table."
        }
      ],
    },
    // ---------- Transactions ----------
    {
      id: 'misc-data-mcq-19',
      difficulty: 'hard',
      question: 'A developer writes a "transaction" with node-postgres like this. What actually happens under concurrent traffic?',
      code: {
        language: 'typescript',
        code: `await pool.query('BEGIN');
await pool.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amt, from]);
await pool.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amt, to]);
await pool.query('COMMIT');`,
      },
      options: [
        'It works as intended; node-postgres pins a connection between BEGIN and COMMIT automatically',
        'Each pool.query may run on a different connection: the UPDATEs can autocommit independently, and BEGIN can leave a pooled connection idle in a transaction for some later request',
        'The pool detects BEGIN and throws an error, because transactions require pool.connect()',
        'The UPDATEs run in the same transaction but COMMIT may go to another connection, which Postgres merges at commit time',
      ],
      correct: [1],
      explanation:
        'pool.query checks out any idle client for each call and releases it right after. BEGIN, the two UPDATEs and COMMIT can land on up to four connections. A debit may commit without its credit, and a connection left after BEGIN becomes a stray open transaction that the next borrower inherits. The driver does not detect this, and Postgres cannot merge transactions across sessions. Use pool.connect() and one client.',
      followUps: [
        {
          "q": "How would you catch this bug class in code review or CI before it reaches production?",
          "a": "Make the right path the only path. Provide a `withTransaction(fn)` helper that hands `fn` a client, and forbid raw `BEGIN` strings: a lint rule (ESLint `no-restricted-syntax` matching `pool.query('BEGIN'`) or a wrapper type that exposes `query` only through the client. Add an integration test against real Postgres that runs the transfer concurrently and asserts balances sum correctly after injecting a failure between the two UPDATEs. In production, alert on sessions in 'idle in transaction' longer than a few seconds (`pg_stat_activity`) and set `idle_in_transaction_session_timeout` as a backstop."
        }
      ],
    },
    {
      id: 'misc-data-mcq-20',
      difficulty: 'expert',
      question:
        'This import loop runs inside one transaction and hits a duplicate on row 500 of 1,000. How does it behave on Postgres vs MySQL InnoDB?',
      code: {
        language: 'typescript',
        code: `await client.query('BEGIN');
for (const r of rows) {
  try {
    await client.query('INSERT INTO products (sku, name) VALUES ($1, $2)', [r.sku, r.name]);
  } catch (e: any) {
    if (e.code !== '23505' /* unique_violation */) throw e; // skip duplicates
  }
}
await client.query('COMMIT');`,
      },
      options: [
        'Both engines skip the duplicate and commit 999 rows',
        'Postgres: every statement after the error fails with "current transaction is aborted" and COMMIT rolls everything back; MySQL: only the failing INSERT is rolled back and the other rows commit',
        'Postgres: the duplicate is skipped and 999 rows commit; MySQL: the whole transaction rolls back on any error',
        'Both engines roll back the entire transaction at the first error',
      ],
      correct: [1],
      explanation:
        'In Postgres any error puts the transaction into the aborted state (25P02) until ROLLBACK, and COMMIT then reports ROLLBACK, so nothing is saved. InnoDB rolls back only the failed statement for errors like duplicate key, so the other rows commit. Fix it portably with INSERT … ON CONFLICT DO NOTHING (Postgres) / INSERT IGNORE or ON DUPLICATE KEY (MySQL), or a savepoint around each risky statement.',
      followUps: [
        {
          "q": "Some of the 1,000 rows fail for other reasons too (check constraint, FK). You need the import to save the good rows and report the bad ones on Postgres. How?",
          "a": "Wrap each row in a savepoint: `SAVEPOINT r; INSERT ...; RELEASE SAVEPOINT r;` and on error `ROLLBACK TO SAVEPOINT r`, recording the row and error. That keeps the transaction usable. Savepoints cost something (subtransactions; more than 64 in flight per backend causes subxact cache overflow and slows the system), so release each one immediately. A faster pattern: `COPY` into an unconstrained staging table, then validate with SQL in bulk (`INSERT ... SELECT ... WHERE <valid> ON CONFLICT DO NOTHING`) and select the rejected rows with an anti-join for the error report."
        }
      ],
    },
    {
      id: 'misc-data-mcq-21',
      difficulty: 'hard',
      question:
        'A transfer service sends COMMIT and the connection resets before any reply. The generic retry wrapper re-runs the whole transaction. Which statement is correct?',
      options: [
        'Safe: a transaction whose client disconnects before the reply is always rolled back by Postgres',
        'Unsafe unless the transaction is idempotent: the first COMMIT may have succeeded, so the retry can apply the transfer twice; check an idempotency key before retrying',
        'Safe, because Postgres deduplicates identical transactions within a few seconds',
        'Unsafe only under SERIALIZABLE; at READ COMMITTED the retry is harmless',
      ],
      correct: [1],
      explanation:
        'Once COMMIT is sent, the server may have durably committed and lost only the reply, so the outcome is ambiguous. Blind retries of non-idempotent writes risk double application. Store a unique idempotency key in the same transaction and look it up after reconnecting. Postgres does not deduplicate transactions, and the isolation level is irrelevant to this failure.',
      followUps: [
        {
          "q": "After reconnecting you look up the idempotency key and find nothing. Is it now safe to retry, or could the original still commit later?",
          "a": "Once the connection reset, the server-side backend either committed before the reset or will abort when it notices the dead client; a transaction can't commit after its session is gone without the client. But there's a subtle window: the backend may still be running the COMMIT (for example waiting on synchronous replication) when you check from a new connection. Check with a query that waits, or first confirm the old backend is gone (`pg_stat_activity` by the old PID, or `pg_terminate_backend` it). If the key is absent and the old session is dead, retry with the same idempotency key, and the unique constraint protects against the rare race."
        }
      ],
    },
    {
      id: 'misc-data-mcq-22',
      difficulty: 'medium',
      question:
        'A Prisma interactive transaction ($transaction(async (tx) => …)) calls an external KYC API that takes 3–8 s, then writes two rows. In production it intermittently fails with "Transaction already closed". Why, and what is the fix?',
      options: [
        'Prisma does not support writes in interactive transactions; use raw SQL',
        'The default interactive transaction timeout is 5 s; move the KYC call outside the transaction (raising the timeout would hold a connection and locks for seconds)',
        'The database killed the session because of statement_timeout on the SELECT',
        'Prisma closes transactions whenever an await occurs; remove all awaits from the callback',
      ],
      correct: [1],
      explanation:
        'Prisma interactive transactions default to timeout: 5000 ms (and maxWait: 2000 ms), so a 3–8 s external call sometimes exceeds the window. The right fix is to do slow I/O before the transaction and keep it DB-only and short. Raising the timeout hides the problem and holds a connection and row locks. Writes and awaits are fine inside the callback, and the error comes from Prisma, not a server-side timeout.',
      followUps: [
        {
          "q": "The KYC result must be consistent with the rows you write: if KYC passed but the write fails, you must not lose the KYC check. How do you structure it?",
          "a": "Persist the external result as its own step. Call KYC first, then store the result in its own short transaction (`kyc_checks(request_id UNIQUE, result, checked_at)`). Then run the business transaction, which reads the stored check by request_id and writes the two rows. If the business write fails, a retry reuses the stored KYC result instead of calling the provider again (and paying twice). Pass an idempotency key to the KYC provider too, if supported. Each transaction stays short and DB-only, and the workflow is recoverable at every step."
        }
      ],
    },
    // ---------- Isolation Levels ----------
    {
      id: 'misc-data-mcq-23',
      difficulty: 'expert',
      question:
        'T1 runs at MySQL InnoDB REPEATABLE READ. T2 commits its change where shown. What do T1’s two SELECTs return, and what would happen on Postgres REPEATABLE READ?',
      code: {
        language: 'sql',
        code: `-- balance starts at 100
T1: START TRANSACTION;
T1: SELECT balance FROM acct WHERE id = 1;           -- (a)
T2: UPDATE acct SET balance = 70 WHERE id = 1; COMMIT;
T1: UPDATE acct SET balance = balance - 30 WHERE id = 1;
T1: SELECT balance FROM acct WHERE id = 1;           -- (b)
T1: COMMIT;`,
      },
      options: [
        'MySQL: (a) 100, (b) 70 — the snapshot hides T2 and the UPDATE is ignored; Postgres: same',
        'MySQL: (a) 100, (b) 40 — the UPDATE is a current read on the committed 70 and T1 then sees its own row version; Postgres: the UPDATE fails with a serialization error (40001)',
        'MySQL: (a) 100, (b) 70 — T1’s UPDATE is applied to its snapshot value 100, giving 70; Postgres: (b) 40',
        'MySQL: the UPDATE blocks until T1 commits; Postgres: (b) 40',
      ],
      correct: [1],
      explanation:
        'InnoDB plain SELECTs read the snapshot from the first read (100), but UPDATE reads and locks the latest committed row (70) and writes 40. T1’s later SELECT sees its own modification, which sits on top of T2’s change. Postgres REPEATABLE READ uses first-updater-wins: updating a row changed after the snapshot raises "could not serialize access due to concurrent update". Knowing this difference matters when porting code.',
      followUps: [
        {
          "q": "You're porting this debit code to Postgres REPEATABLE READ, where it now fails with 40001. What's the better fix than adding retries everywhere?",
          "a": "Use an atomic conditional statement at READ COMMITTED: `UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance`. The row lock serialises concurrent debits, each sees the latest committed balance, and rowCount 0 means insufficient funds. No snapshot conflicts, no retries needed for this path. Keep REPEATABLE READ or SERIALIZABLE (with retries) for multi-row invariants that a single UPDATE can't express. That's simpler and faster than retrying whole transactions, and it behaves the same on MySQL and Postgres."
        }
      ],
    },
    {
      id: 'misc-data-mcq-24',
      difficulty: 'hard',
      question:
        'A finance report wants a consistent snapshot without hurting the primary, so the team runs it at SERIALIZABLE on a Postgres hot standby. It fails immediately. Which option gives a consistent read-only snapshot for the report?',
      options: [
        'Run it at REPEATABLE READ on the standby — a single snapshot for the whole transaction, which is what a read-only report needs',
        'Set default_transaction_isolation = serializable on the standby and restart it',
        'Enable hot_standby_feedback, which makes SERIALIZABLE available on standbys',
        'Run it at READ COMMITTED on the standby; each statement sees the same snapshot anyway',
      ],
      correct: [0],
      explanation:
        'Postgres refuses SERIALIZABLE on a hot standby ("cannot use serializable mode in a hot standby") and suggests REPEATABLE READ, which gives one snapshot for the whole transaction. No configuration enables SSI on standbys, and hot_standby_feedback only affects vacuum conflicts. READ COMMITTED takes a new snapshot per statement, so totals across statements can disagree.',
      followUps: [
        {
          "q": "The 40-minute report on the standby gets canceled with 'canceling statement due to conflict with recovery'. What are your options?",
          "a": "The standby's replay wanted to remove row versions (vacuum on the primary) that the long query still needs. Options: raise `max_standby_streaming_delay` on a dedicated reporting standby (for example to 60 minutes), letting replay pause while queries run; this makes that standby lag, which is fine for reports but not for user reads. Or enable `hot_standby_feedback=on`, so the primary holds back vacuum for rows the standby needs; there are no cancellations, but the primary accumulates bloat during long reports. Best: use a separate replica for reports, and break huge reports into smaller time-bounded queries."
        }
      ],
    },
    {
      id: 'misc-data-mcq-25',
      difficulty: 'expert',
      question:
        'On MySQL InnoDB at REPEATABLE READ, two requests run "SELECT … FROM carts WHERE user_id = 7 FOR UPDATE; if none, INSERT the cart" for a user with no cart. They deadlock regularly. Which changes remove or handle the problem? Select ALL that apply.',
      options: [
        'Replace the check-then-insert with a single INSERT … ON DUPLICATE KEY UPDATE against a unique key on user_id',
        'Run the transaction at READ COMMITTED, where InnoDB mostly stops taking gap locks for such searches, and rely on the unique key to reject the second insert',
        'Keep the logic but retry the whole transaction on deadlock (error 1213) with backoff',
        'Switch to SERIALIZABLE so the SELECT takes stronger locks and the deadlock disappears',
        'Remove the unique key on user_id so the second insert cannot conflict',
      ],
      correct: [0, 1, 2],
      explanation:
        'At RR, both locking reads on a missing key take compatible gap locks. Each INSERT then needs an insert-intention lock blocked by the other’s gap lock, so they deadlock. An atomic upsert avoids the pattern, READ COMMITTED largely drops the gap locks (leaving the unique key as the arbiter), and retrying on 1213 is a valid safety net. SERIALIZABLE adds more locking, and removing the unique key allows duplicate carts.',
      followUps: [
        {
          "q": "You chose the upsert. Under very high concurrency on the same user, what locking still happens, and is it acceptable?",
          "a": "`INSERT ... ON DUPLICATE KEY UPDATE` takes an exclusive lock on the unique index record (and briefly next-key locks at REPEATABLE READ). Concurrent upserts on the same user_id serialise on that lock, each waiting a few hundred microseconds, but they can't deadlock among themselves on this single statement. Deadlocks can still appear if the same transaction also locks other rows in different orders. That's acceptable: one user rarely creates many carts concurrently. Keep the transaction short and lock rows in a consistent order, and keep the 1213 retry as a safety net."
        }
      ],
    },
    // ---------- Schema evolution ----------
    {
      id: 'misc-data-mcq-26',
      difficulty: 'hard',
      question:
        'During a rolling deploy, v41 and v42 pods share one Postgres database, and rollback to v41 must remain possible. Which migrations can safely run before v42 rolls out? Select ALL that apply.',
      options: [
        'ADD COLUMN discount_code text (nullable, no default)',
        'CREATE INDEX CONCURRENTLY on orders(customer_id, created_at)',
        'ALTER TABLE orders RENAME COLUMN total TO total_minor',
        'ALTER TABLE orders DROP COLUMN legacy_status (v42 no longer uses it; v41 still maps it in its ORM entity)',
        'CREATE TABLE order_notes (…) used only by v42',
      ],
      correct: [0, 1, 4],
      explanation:
        'Adding a nullable column, an index built concurrently, or a new table is invisible to v41. A rename breaks v41 immediately, since it still reads total. Dropping a column that v41’s ORM still maps breaks its inserts and selects, and would break a rollback. Destructive changes wait until no running or rollback-target version depends on the old shape.',
      followUps: [
        {
          "q": "When can you finally drop legacy_status, and how do you make sure nothing still uses it?",
          "a": "Only after every running and rollback-target version stops referencing it. Sequence: v42 stops writing and reading it; v43 removes it from the ORM entity (so inserts don't include it), and you declare v41 and v42 no longer valid rollback targets; then drop it in a later migration. Verify before dropping: grep the codebase and other services, check `pg_stat_statements` for queries mentioning the column over a full business cycle (including monthly jobs), and optionally revoke SELECT on that column for a week (column-level privileges) to surface hidden readers as errors before the irreversible drop."
        }
      ],
    },
    {
      id: 'misc-data-mcq-27',
      difficulty: 'expert',
      question:
        'Right after a migration that added a column to the users table, a service using server-side prepared statements for SELECT * FROM users WHERE id = $1 logs "cached plan must not change result type" on some connections for a while. What is going on?',
      options: [
        'The new column has an incompatible collation, so the planner refuses to reuse the index',
        'The prepared statement’s result row shape was fixed when it was prepared; after the table gained a column, re-executing that prepared SELECT * on existing sessions errors until the statement is re-prepared',
        'Autovacuum invalidated the visibility map, so cached plans must be rebuilt',
        'PgBouncer rewrote the prepared statement into a simple query with a different result type',
      ],
      correct: [1],
      explanation:
        'A prepared SELECT * has a fixed result descriptor. When the table’s columns change, Postgres can replan, but it refuses to return a different row type on the same prepared statement and raises this error, until the client deallocates and re-prepares. List columns explicitly and let drivers or ORMs re-prepare on this error. Collation, vacuum and PgBouncer rewriting are not the cause.',
      followUps: [
        {
          "q": "You run PgBouncer in transaction mode with prepared statements enabled (1.21+). Does this problem get better or worse, and what's your mitigation?",
          "a": "It can get more confusing: PgBouncer prepares statements on each server connection lazily and tracks them per client, so after a schema change, server connections that had the statement prepared raise the error until it's re-prepared, and different clients hit it at different times. Mitigation: avoid `SELECT *` in prepared statements (explicit column lists don't change result type when columns are added); after deploys with schema changes, run `RECONNECT` or `RELOAD` on PgBouncer to cycle server connections, or `DISCARD ALL` and `DEALLOCATE ALL`; and make the app retry once on this SQLSTATE (0A000) after re-preparing."
        }
      ],
    },
    {
      id: 'misc-data-mcq-28',
      difficulty: 'medium',
      question:
        'A Postgres 16 migration does, in one transaction: ALTER TYPE order_status ADD VALUE \'on_hold\'; then UPDATE orders SET status = \'on_hold\' WHERE …; It fails. Why?',
      options: [
        'ALTER TYPE … ADD VALUE can never run inside a transaction block',
        'Since PG 12, ADD VALUE is allowed in a transaction, but the new enum value cannot be used until that transaction commits ("unsafe use of new value")',
        'Enum values must be added in alphabetical order unless BEFORE/AFTER is specified',
        'UPDATE cannot change enum columns without first casting them to text',
      ],
      correct: [1],
      explanation:
        'Postgres 12 relaxed the rule so ADD VALUE can run in a transaction block, but using the new label in the same transaction is rejected as "unsafe use of new value". Split it into two migrations: add the value and commit, then use it. There is no alphabetical rule (new values go at the end unless positioned), and enum columns accept string literals of valid labels.',
      followUps: [
        {
          "q": "Enum changes keep causing deployment pain. When would you replace the Postgres enum with something else, and what?",
          "a": "Enums are fine for stable sets. They hurt when values change often, when you need to remove or rename a value (ADD is easy; removal requires recreating the type and rewriting dependent columns), or when several services must coordinate on values. Alternatives: a `text` column with a CHECK constraint (changing the allowed list is a quick `NOT VALID` plus `VALIDATE`), or a small lookup table with a FK (values are data, managed with INSERTs, and can carry metadata like display names). Apps must already tolerate unknown values for rolling deploys either way."
        }
      ],
    },
    // ---------- Zero-downtime migrations ----------
    {
      id: 'misc-data-mcq-29',
      difficulty: 'expert',
      question:
        'On Postgres 16, after a backfill ensured no NULLs, this sequence runs on a 500M-row table under full traffic. Which statement is accurate about locks and scans?',
      code: {
        language: 'sql',
        code: `SET lock_timeout = '3s';
ALTER TABLE users ADD CONSTRAINT users_cc_nn CHECK (country_code IS NOT NULL) NOT VALID; -- 1
ALTER TABLE users VALIDATE CONSTRAINT users_cc_nn;                                      -- 2
ALTER TABLE users ALTER COLUMN country_code SET NOT NULL;                               -- 3
ALTER TABLE users DROP CONSTRAINT users_cc_nn;                                          -- 4`,
      },
      options: [
        'Step 2 scans the table under ACCESS EXCLUSIVE, so it blocks traffic for the whole scan; step 3 is instant',
        'Step 2 scans the table under SHARE UPDATE EXCLUSIVE (reads and writes continue); step 3 needs ACCESS EXCLUSIVE only briefly, because the valid CHECK lets it skip the full scan',
        'Steps 1 and 3 both scan the full table; only step 2 is instant',
        'Step 3 still scans all 500M rows because SET NOT NULL ignores CHECK constraints',
      ],
      correct: [1],
      explanation:
        'NOT VALID skips checking existing rows, so step 1 is instant. VALIDATE scans with a lock that does not block DML. Since Postgres 12, SET NOT NULL skips its own verification scan when a valid CHECK (col IS NOT NULL) exists, so its ACCESS EXCLUSIVE lock lasts milliseconds. lock_timeout keeps each step from waiting in the lock queue behind long queries and blocking traffic.',
      followUps: [
        {
          "q": "Between the backfill finishing and step 1, the old app version inserts a few rows with NULL. What happens to steps 2 and 3?",
          "a": "Step 1 (`NOT VALID`) prevents new NULLs from the moment it's added, but existing rows aren't checked, so the NULLs inserted after the backfill but before step 1 remain. Step 2 (`VALIDATE`) scans the table, finds them and fails, and the constraint stays NOT VALID. Recovery: run the backfill again for the stragglers (`UPDATE ... WHERE col IS NULL`), then re-run VALIDATE. To avoid the race, deploy the app version that always writes the column before the final backfill, or add the NOT VALID constraint first, then backfill, then validate."
        }
      ],
    },
    {
      id: 'misc-data-mcq-30',
      difficulty: 'hard',
      question:
        'You must change a 2 TB MySQL 8.0 table: add an index and change a column type (a table rebuild), with controllable load and the ability to pause and choose when to cut over. Which statements about gh-ost and pt-online-schema-change are accurate? Select ALL that apply.',
      options: [
        'gh-ost is triggerless: it copies rows into a shadow table and applies ongoing changes by tailing the binary log, which must be in ROW format',
        'pt-online-schema-change keeps the shadow table in sync with triggers on the original table, which add write overhead to every DML',
        'gh-ost can postpone the cut-over until an operator signals it, then swaps tables with an atomic rename',
        'Both tools perform the change in place without extra disk space',
        'Both tools work on tables with foreign keys without any special handling',
      ],
      correct: [0, 1, 2],
      explanation:
        'gh-ost reads row-based binlog events instead of using triggers, supports throttling and a postponed cut-over flag, and finishes with a rename swap. pt-osc uses AFTER INSERT/UPDATE/DELETE triggers, which cost extra on each write. Both build a full copy, so you need roughly the table’s size in free disk. Foreign keys are a known pain point: gh-ost does not support them, and pt-osc needs special alter-foreign-keys handling.',
      followUps: [
        {
          "q": "gh-ost is running the 2 TB copy and the replicas start lagging 30 s. What controls do you have, and what does gh-ost do on its own?",
          "a": "gh-ost throttles itself based on `--max-lag-millis` (for example 1500), measuring lag on the replicas you list with `--throttle-control-replicas`; when exceeded, it pauses row copying (while still applying binlog changes). Also `--max-load=Threads_running=50` and `--critical-load` (which aborts). You can adjust them live through its socket (`echo throttle | nc -U /tmp/gh-ost.sock`, or change `max-lag-millis`), or pause entirely with a throttle flag file. Lower `--chunk-size` reduces the size of each batch. The copy takes longer, but production stays healthy, and cut-over waits for your signal anyway."
        }
      ],
    },
  ],
};

export default topic;
