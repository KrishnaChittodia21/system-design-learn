import type { Topic } from '../../types';

const topic: Topic = {
  id: 'db-connections-locks',
  phase: 'databases',
  order: 3,
  title: 'Connection Pooling, Lock Contention & Deadlocks',
  subtitle:
    'Why DB connections are expensive, sizing pools with Little\'s Law, the pods × pool explosion, PgBouncer modes, leaks and timeouts, backpressure, row/table locks, SKIP LOCKED, deadlocks and hot-row contention — plus the "connections exhausted" incident in depth.',
  estimatedMinutes: 105,
  sources: [
    'Alex Xu — System Design Interview Vol 2, Ch 7 Hotel Reservation (concurrency, locking)',
    'Alex Xu — System Design Interview Vol 2, Ch 12 Digital Wallet (hot accounts)',
    'PostgreSQL 16 docs — 13.3 Explicit Locking, 20.3 Connections, 20.11 Client Connection Defaults',
    'HikariCP wiki — About Pool Sizing; PgBouncer docs',
  ],
  tags: ['connection-pool', 'pgbouncer', 'littles-law', 'timeouts', 'locks', 'deadlock', 'skip-locked', 'backpressure', 'postgres'],
  cheatSheet: [
    'Postgres forks one OS process per connection (~several MB each + work_mem per sort/hash); throughput peaks at a few × cores active connections and degrades beyond — idle connections still cost memory and snapshot overhead.',
    'Pool size ≈ (cores × 2) + effective_spindle_count (HikariCP starting point) for the DB-side active set; per app instance use Little\'s Law: connections = throughput × time-each-connection-is-held.',
    'Total = pods × pool max × services. 60 pods × 20 = 1,200 connections — way past a DB that performs best at ~50–100 active. Put PgBouncer / RDS Proxy in between.',
    'PgBouncer transaction mode multiplexes thousands of clients onto tens of server connections; breaks session state: SET, session advisory locks, LISTEN/NOTIFY, temp tables, and protocol prepared statements (unless PgBouncer ≥ 1.21 with max_prepared_statements).',
    'Leak = connection acquired but never released (missing finally, early return, transaction left open). Symptom: pool "waiting" grows while DB shows many idle / idle-in-transaction sessions.',
    'Timeouts in layers: pool acquire timeout (fail fast ~1–2 s) < request timeout; statement_timeout; idle_in_transaction_session_timeout; lock_timeout for DDL.',
    'Row locks: FOR UPDATE (exclusive), FOR NO KEY UPDATE, FOR SHARE, FOR KEY SHARE; NOWAIT errors immediately, SKIP LOCKED skips locked rows — perfect for job queues.',
    'DDL needs ACCESS EXCLUSIVE; a waiting ALTER TABLE blocks every later reader in the lock queue → always SET lock_timeout before migrations.',
    'Deadlock: Postgres checks after deadlock_timeout (1 s) and aborts one victim (SQLSTATE 40P01). Prevent with consistent lock ordering (sort ids), short transactions, fewer locks; retry the victim.',
    'Hot-row ceiling ≈ 1 / lock-hold-time: 2 ms hold → ~500 updates/s max on that row. Fix with atomic updates, sharded counters, batching, or moving the counter out of the row.',
  ],
  sections: [
    {
      heading: 'Why database connections are expensive',
      body: `**Intuition:** a Postgres connection is not a cheap socket — it is a dedicated operating-system process on the database server. Opening one is like hiring a new worker; keeping 5,000 of them "on standby" crowds the kitchen even if they do nothing.

**PostgreSQL's process-per-connection model**
- The postmaster **forks a backend process** per connection. Connection setup (TCP + TLS + auth + fork + catalog cache warm-up) costs ~5–50 ms — far more than a simple query (~0.1–1 ms).
- Each backend uses private memory: a baseline of a few MB, growing with catalog/relation caches, plus up to \`work_mem\` **per sort/hash node** of a running query (e.g. 64 MB × several nodes).
- Many connections increase contention on shared structures (lock manager, buffer mapping, and — before PG14 — snapshot computation scaling with connection count; PG14 made GetSnapshotData much cheaper).
- \`max_connections\` defaults to **100**. Managed Postgres (RDS) derives it from instance memory (e.g. LEAST(DBInstanceClassMemory/9531392, 5000)).

**Throughput vs active connections**
Only as many queries can make progress as there are CPU cores (and I/O channels). Beyond that, extra active connections just add context switching and lock contention: throughput plateaus, then latency climbs roughly linearly with queue length. Benchmarks commonly show peak TPS around **2–4× core count** active connections.

**MySQL** uses a thread per connection (cheaper than a process, but the same concurrency argument applies; thread pool plugins exist). Either way: **few busy connections beat many idle ones.**`,
      diagram: `  TPS
   ^            ___________
   |          /             \\___
   |         /                  \\____        more connections =
   |        /                        \\___    context switches,
   |       /                             \\   lock contention,
   |      /                                  memory pressure
   +-----+-----+-----+-----+-----+-----+----> active connections
        16    32    64   128   256   512      (16-core DB)
           peak ~ 2-4x cores`,
      keyPoints: [
        'Postgres: one process per connection; connection setup costs 5–50 ms.',
        'Throughput peaks near a few × cores active connections.',
        'Idle connections still cost memory and shared-structure overhead.',
      ],
    },
    {
      heading: 'Sizing a pool: the HikariCP formula and Little\'s Law',
      body: `**Intuition:** a pool is a fixed set of reusable connections. Too small and requests queue in the app; too big and requests queue inside the database, where it is more expensive.

**DB-side sizing (how many connections should be active on the server)**
HikariCP's well-known starting point:
\`connections = (core_count × 2) + effective_spindle_count\`
- core_count = physical cores of the DB server (not hyperthreads); spindle count ≈ 0 when the working set is cached, ~1+ for SSD-backed I/O waits.
- A 16-core DB → ~32–40 active connections total across **all** clients. Tune from there with load tests.

**App-side sizing (how many connections a service instance needs)** — Little's Law:
\`L = λ × W\` → connections in use = request rate × time each request holds a connection.
- Service instance does 400 req/s; each request holds a connection for 5 ms (2 queries + round trips) → 400 × 0.005 = **2 connections** on average. A pool of 5–10 gives headroom for bursts and variance.
- If the same request holds the connection across an HTTP call to another service (80 ms) → 400 × 0.085 = **34 connections**. Holding time, not query time, dominates.

**Defaults to know**
| Client | Default max |
|---|---|
| node-postgres \`Pool\` | 10 |
| TypeORM (pg driver) | 10 (via \`extra.max\` / \`poolSize\`) |
| Prisma | \`num_physical_cpus × 2 + 1\` per client instance (\`connection_limit\` URL param) |
| HikariCP | 10 |

**The counter-intuitive fix:** when latency rises under load, *shrinking* pools (and queueing in the app with a timeout) often improves throughput and p99, because the DB stops thrashing.`,
      code: [
        {
          language: 'typescript',
          title: 'node-postgres pool with explicit limits, timeouts and metrics',
          code: `import { Pool } from 'pg';
import { Gauge } from 'prom-client';

export const pool = new Pool({
  host: process.env.PGHOST,
  max: 10,                              // per pod; total = pods x 10 must fit the DB/bouncer budget
  min: 0,
  idleTimeoutMillis: 30_000,            // release idle connections
  connectionTimeoutMillis: 1_000,       // acquire timeout: fail fast instead of queueing forever
  statement_timeout: 3_000,             // server-side cap per statement
  idle_in_transaction_session_timeout: 10_000, // kill sessions that hold a tx open doing nothing
  application_name: 'orders-api',       // visible in pg_stat_activity
});

const total = new Gauge({ name: 'db_pool_total', help: 'connections open' });
const idle = new Gauge({ name: 'db_pool_idle', help: 'connections idle' });
const waiting = new Gauge({ name: 'db_pool_waiting', help: 'requests waiting for a connection' });

setInterval(() => {
  total.set(pool.totalCount);
  idle.set(pool.idleCount);
  waiting.set(pool.waitingCount);       // > 0 sustained = pool too small OR connections held too long
}, 5_000).unref();

pool.on('error', (err) => {
  // errors on idle clients (e.g. DB restart) must not crash the process
  console.error('idle client error', err.message);
});`,
        },
      ],
      keyPoints: [
        'DB-wide active connections ≈ 2 × cores + spindles as a starting point.',
        'Per instance: connections = λ × hold time; hold time includes anything done while holding the connection.',
        'Never hold a connection across network calls to other services.',
      ],
      source: 'HikariCP wiki — About Pool Sizing',
    },
    {
      heading: 'The pods × pools explosion and connection poolers',
      body: `**Intuition:** each pod brings its own pool. Autoscaling multiplies them. Ten services × 30 pods × 20 connections is 6,000 connections pointed at a database that works best with ~50 active.

**The math that bites in Kubernetes**
- \`total_connections = Σ services (pods × pool_max)\` + cron jobs + migrations + admin tools.
- HPA scales pods on CPU during a traffic spike → new pods open new pools exactly when the DB is busiest → \`FATAL: sorry, too many clients already\` / \`remaining connection slots are reserved\`.
- Serverless (Lambda) is worse: each concurrent invocation may hold its own connection.

**Poolers (server-side multiplexing)**
| Option | Notes |
|---|---|
| **PgBouncer** | Lightweight, single-threaded per process (run several or use \`so_reuseport\`), handles 10K+ client connections onto tens of server connections |
| **RDS Proxy / Cloud SQL Auth Proxy + managed pooling** | Managed; RDS Proxy pins sessions when it sees session state |
| **Pgcat / Odyssey / Supavisor** | Multi-threaded, sharding/load-balancing features |
| **ProxySQL** | MySQL equivalent (plus query routing) |

**PgBouncer pool modes**
| Mode | Server connection returned to pool | Works with | Breaks |
|---|---|---|---|
| session | When client disconnects | Everything | Little multiplexing — only helps with connection churn |
| **transaction** | At COMMIT/ROLLBACK | Most OLTP apps | \`SET\` (use \`SET LOCAL\`), session advisory locks, LISTEN/NOTIFY, WITH HOLD cursors, temp tables across tx; protocol prepared statements unless PgBouncer ≥ 1.21 with \`max_prepared_statements\` |
| statement | After each statement | Autocommit-only workloads | Multi-statement transactions |

**Design rule:** size the bouncer's \`default_pool_size\` to the DB's healthy active set (e.g. 40 for a 16-core primary), let app pools be modest, and let clients queue at the bouncer (\`query_wait_timeout\`) instead of inside Postgres.`,
      code: [
        {
          language: 'text',
          title: 'pgbouncer.ini for a 16-core primary serving ~3,000 app connections',
          code: `[databases]
orders = host=orders-primary.internal port=5432 dbname=orders

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt

pool_mode = transaction          ; server conn returned at COMMIT/ROLLBACK
max_client_conn = 5000           ; app side: pods x pool size can be large
default_pool_size = 40           ; server side per (db,user): ~2-3x DB cores
reserve_pool_size = 10           ; burst allowance...
reserve_pool_timeout = 2         ; ...after clients wait 2 s
max_db_connections = 60          ; hard cap to Postgres for this db

query_wait_timeout = 5           ; client waits max 5 s for a server conn, then error
server_idle_timeout = 60
server_lifetime = 3600           ; recycle to rebalance after failover
max_prepared_statements = 200    ; PgBouncer >= 1.21: prepared stmts in transaction mode

; Postgres side: max_connections = 100 leaves room for admin, replication, migrations`,
        },
      ],
      keyPoints: [
        'Total connections = Σ pods × pool max — autoscaling multiplies it.',
        'Transaction pooling gives real multiplexing but forbids session state.',
        'Queue at the pooler with a timeout, not inside Postgres.',
      ],
    },
    {
      heading: 'Connection leaks: how they happen and how to find them',
      body: `**Intuition:** a leak is a borrowed library book that is never returned. The library does not run out of books all at once — it slowly drains until one busy afternoon nobody can borrow anything.

**Classic leak patterns in Node.js**
1. \`pool.connect()\` without \`release()\` in a \`finally\` — an exception between BEGIN and COMMIT leaves the client checked out forever.
2. Early \`return\` paths that skip release.
3. Transactions left open: the client is released but a \`BEGIN\` was never closed → connection returns to the pool **idle in transaction**, holding locks and an MVCC snapshot.
4. Streams/cursors not closed on client disconnect.
5. ORM QueryRunners (TypeORM \`createQueryRunner()\`) not released.
6. Releasing a broken client back to the pool (should be \`release(err)\` to destroy it).

**How to detect**
- App metrics: \`waitingCount\` > 0 and \`idleCount\` = 0 while request rate is normal.
- DB: \`pg_stat_activity\` grouped by \`application_name, state\` — lots of \`idle in transaction\` or \`idle\` sessions with old \`state_change\`.
- Enable leak detection: log a stack trace when a client is held longer than N seconds (HikariCP has \`leakDetectionThreshold\`; in Node, wrap acquire/release).

**Best defence:** never call \`connect()\` directly in business code; expose a \`withTransaction(fn)\` helper that always commits/rolls back and releases.`,
      code: [
        {
          language: 'typescript',
          title: 'Leak-proof transaction helper with hold-time leak detection',
          code: `import { Pool, type PoolClient } from 'pg';

const pool = new Pool({ max: 10, connectionTimeoutMillis: 1000 });
const LEAK_MS = 5_000;

export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const acquiredAt = Date.now();
  const stack = new Error('connection acquired here').stack;
  const leakTimer = setTimeout(() => {
    console.warn('possible connection leak, held > ' + LEAK_MS + ' ms', stack);
  }, LEAK_MS);

  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      broken = rollbackErr as Error;     // connection unusable: destroy, don't reuse
    }
    throw err;
  } finally {
    clearTimeout(leakTimer);
    client.release(broken);              // release(err) removes the client from the pool
    const heldMs = Date.now() - acquiredAt;
    if (heldMs > 1000) console.warn('long connection hold', { heldMs });
  }
}`,
        },
        {
          language: 'sql',
          title: 'Who is holding connections right now?',
          code: `SELECT application_name, state, count(*) AS conns,
       max(now() - state_change) AS longest_in_state,
       max(now() - xact_start)   AS oldest_tx
  FROM pg_stat_activity
 WHERE backend_type = 'client backend'
 GROUP BY application_name, state
 ORDER BY conns DESC;

-- application_name | state               | conns | longest_in_state | oldest_tx
-- orders-api       | idle in transaction |   184 | 00:41:12         | 00:41:12   <- leak
-- orders-api       | active              |    22 | 00:00:01         | 00:00:01
-- billing-worker   | idle                |    60 | 00:10:02         |`,
        },
      ],
      keyPoints: [
        'Always release in finally; destroy broken clients with release(err).',
        'Idle-in-transaction sessions are leaks that also hold locks and snapshots.',
        'Instrument hold time; log the acquiring stack when it exceeds a threshold.',
      ],
    },
    {
      heading: 'Long-running queries, layered timeouts and backpressure',
      body: `**Intuition:** timeouts are fuses. Without them, one slow query holds a connection; a thousand slow queries hold the whole pool, and the service is down even though the database is "up".

**The layers (each shorter than the one above it)**
| Layer | Setting | Typical OLTP value |
|---|---|---|
| Client request / API gateway | request timeout | 5–10 s |
| Pool acquire | \`connectionTimeoutMillis\` (pg), \`pool_timeout\` (Prisma), \`connectionTimeout\` (Hikari) | 0.5–2 s |
| Statement | \`statement_timeout\` (role or \`SET LOCAL\`) | 1–5 s for APIs, longer for batch roles |
| Lock wait | \`lock_timeout\` | 1–3 s (esp. migrations) |
| Idle in transaction | \`idle_in_transaction_session_timeout\` | 10–60 s |
| Pooler wait | PgBouncer \`query_wait_timeout\` | 5 s |
| TCP | keepalives (\`tcp_keepalives_idle\`) | detect dead peers in < 1–2 min |

**Why the acquire timeout matters most during incidents:** when the DB slows down, requests pile up waiting for connections. An infinite acquire wait means every request eventually times out at the gateway after consuming memory and threads. A short acquire timeout **fails fast**, returns 503 with Retry-After, and keeps the service responsive for requests that can succeed.

**Backpressure patterns**
- Bounded in-app queue (the pool's wait queue) + fail fast when full.
- **Concurrency limiters** per endpoint (e.g. max 20 concurrent report queries) so one heavy endpoint cannot starve the pool — bulkheads.
- Separate pools (or PgBouncer users) for OLTP vs batch/reporting.
- Load shedding at the edge when \`db_pool_waiting\` or DB CPU crosses thresholds.
- Move long queries to a read replica or OLAP store.

**Cancel work nobody is waiting for:** if the HTTP client disconnected, cancel the query (\`pg_cancel_backend\` or driver-level cancel); otherwise the DB keeps working for nobody.`,
      code: [
        {
          language: 'typescript',
          title: 'Bulkhead + fail-fast wrapper around DB work (NestJS service)',
          code: `import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { pool } from './pool';

class Semaphore {
  private inFlight = 0;
  constructor(private readonly limit: number) {}
  tryAcquire(): boolean {
    if (this.inFlight >= this.limit) return false;
    this.inFlight++;
    return true;
  }
  release(): void { this.inFlight--; }
}

@Injectable()
export class ReportService {
  // At most 3 concurrent report queries per pod: reports can never take the whole pool
  private readonly bulkhead = new Semaphore(3);

  async monthlyReport(tenantId: string) {
    if (!this.bulkhead.tryAcquire()) {
      throw new ServiceUnavailableException('report capacity exhausted, retry later');
    }
    const client = await pool.connect();       // acquire timeout configured on the pool
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '15s'"); // reports get a longer, bounded budget
      const { rows } = await client.query(
        'SELECT date_trunc(\\'day\\', created_at) AS d, sum(total) FROM orders ' +
          'WHERE tenant_id = $1 AND created_at >= now() - interval \\'30 days\\' GROUP BY 1 ORDER BY 1',
        [tenantId],
      );
      await client.query('COMMIT');
      return rows;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
      this.bulkhead.release();
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Timeouts nest: gateway > acquire + statement; acquire timeout fails fast.',
        'Bulkheads (per-endpoint concurrency limits, separate pools) stop one query class starving others.',
        'Cancel queries whose callers have gone away.',
      ],
    },
    {
      heading: 'Lock types: row locks, table locks and the DDL lock queue',
      body: `**Intuition:** locks are "occupied" signs. Row locks say "this row is being changed"; table locks say "the table's structure is being used or changed". Most OLTP pain comes from row-lock queues on hot rows and from DDL waiting in the lock queue.

**Row-level locks (Postgres)**
| Lock | Taken by | Blocks |
|---|---|---|
| FOR UPDATE | \`SELECT ... FOR UPDATE\`, DELETE, UPDATE of key columns | All other row locks on that row |
| FOR NO KEY UPDATE | Ordinary UPDATE (non-key columns) | FOR UPDATE, NO KEY UPDATE, FOR SHARE |
| FOR SHARE | \`SELECT ... FOR SHARE\` | Writers |
| FOR KEY SHARE | FK checks on child insert | Only FOR UPDATE (key changes/deletes) |
Plain SELECTs take **no row locks** (MVCC). Row locks are held until the transaction ends.

**Modifiers**
- \`NOWAIT\` → error immediately (SQLSTATE 55P03) if locked — for "try-lock" semantics.
- \`SKIP LOCKED\` → silently skip locked rows — perfect for **job queues** and seat/ticket allocation where any free row will do.

**Table-level lock modes (selected)**
| Mode | Taken by | Conflicts with |
|---|---|---|
| ACCESS SHARE | SELECT | ACCESS EXCLUSIVE |
| ROW EXCLUSIVE | INSERT/UPDATE/DELETE | SHARE, EXCLUSIVE modes, ACCESS EXCLUSIVE |
| SHARE UPDATE EXCLUSIVE | VACUUM, CREATE INDEX CONCURRENTLY | Itself and stronger |
| SHARE | CREATE INDEX (non-concurrent) | Writers |
| ACCESS EXCLUSIVE | Most ALTER TABLE, DROP, TRUNCATE, VACUUM FULL | **Everything**, including SELECT |

**The DDL lock-queue trap**
1. A long-running SELECT holds ACCESS SHARE on \`orders\`.
2. \`ALTER TABLE orders ADD COLUMN ...\` requests ACCESS EXCLUSIVE and **waits**.
3. Every new query on \`orders\` queues **behind** the ALTER (lock requests are FIFO-ish) → the whole table is effectively down, and pools exhaust within seconds.
Fix: \`SET lock_timeout = '2s'\` in migrations and retry with backoff; run DDL off-peak; kill the blocking long query first.

**Advisory locks:** \`pg_advisory_xact_lock(key)\` — application-defined mutex, auto-released at transaction end. Session-level variants (\`pg_advisory_lock\`) break under PgBouncer transaction pooling.`,
      code: [
        {
          language: 'sql',
          title: 'Job queue with SKIP LOCKED and a safe migration pattern',
          code: `-- Many workers, no double-processing, no waiting on each other
WITH next AS (
  SELECT id FROM job
   WHERE status = 'queued' AND run_at <= now()
   ORDER BY run_at
   LIMIT 10
   FOR UPDATE SKIP LOCKED          -- rows locked by other workers are skipped
)
UPDATE job j
   SET status = 'running', locked_at = now(), attempts = attempts + 1
  FROM next
 WHERE j.id = next.id
RETURNING j.id, j.payload;

-- Safe DDL: never wait behind long queries while blocking everyone else
SET lock_timeout = '2s';
SET statement_timeout = '30s';
ALTER TABLE orders ADD COLUMN gift_note text;      -- metadata-only in PG 11+ (no default rewrite)
-- If it fails with "canceling statement due to lock timeout": retry later with backoff

-- Who blocks whom?
SELECT a.pid, a.state, left(a.query, 60) AS query,
       pg_blocking_pids(a.pid) AS blocked_by, now() - a.query_start AS running_for
  FROM pg_stat_activity a
 WHERE cardinality(pg_blocking_pids(a.pid)) > 0;`,
        },
      ],
      keyPoints: [
        'Plain SELECT takes no row locks; FOR UPDATE/UPDATE lock rows until commit.',
        'SKIP LOCKED for queues; NOWAIT for try-lock.',
        'A waiting ACCESS EXCLUSIVE blocks everything behind it — use lock_timeout.',
      ],
    },
    {
      heading: 'Deadlocks: detection, prevention and retries',
      body: `**Intuition:** two cars at a one-lane bridge, each waiting for the other to reverse. Neither will move until someone forces one of them back.

**How it happens:** T1 locks row A then wants B; T2 locks B then wants A. Both wait forever.

**Detection in Postgres:** a backend waiting on a lock for longer than \`deadlock_timeout\` (default **1 s**) runs the deadlock detector. If a cycle exists, one transaction is aborted with \`ERROR: deadlock detected\` (SQLSTATE **40P01**); the log shows both queries. InnoDB detects immediately (wait-for graph) and rolls back the smaller transaction (\`innodb_deadlock_detect\`); with detection off it relies on \`innodb_lock_wait_timeout\` (default 50 s).

**Prevention**
1. **Consistent lock ordering:** always lock rows in a deterministic order (sort ids ascending). Transfers between accounts A→B and B→A both lock min(A,B) first.
2. **Lock everything up front** in one statement: \`SELECT ... WHERE id = ANY($1) ORDER BY id FOR UPDATE\`.
3. **Short transactions:** fewer, briefer locks → fewer cycles.
4. **Avoid lock upgrades:** FOR SHARE then UPDATE in two transactions on the same row is a classic deadlock; take FOR UPDATE directly.
5. **Index foreign keys** and be aware of implicit locks (FK checks take FOR KEY SHARE on parents; InnoDB gap locks on range scans).
6. Batch updates in a consistent order (\`UPDATE ... FROM (VALUES ...) ORDER BY id\` via a CTE locking in order).

**Handling:** deadlocks are expected under concurrency; the victim must **retry the whole transaction** with jittered backoff. Alert on rate (\`pg_stat_database.deadlocks\`), not on existence.`,
      code: [
        {
          language: 'typescript',
          title: 'Deadlock-free money transfer: ordered locking + retry on 40P01/40001',
          code: `import { withTransaction } from './tx';

const RETRYABLE = new Set(['40P01', '40001']); // deadlock, serialization failure

export async function transfer(fromId: string, toId: string, cents: number, attempt = 1): Promise<void> {
  if (fromId === toId || cents <= 0) throw new Error('invalid transfer');
  try {
    await withTransaction(async (c) => {
      // Lock BOTH rows in a deterministic order (by id), in ONE statement
      const { rows } = await c.query(
        'SELECT id, balance FROM account WHERE id = ANY($1) ORDER BY id FOR UPDATE',
        [[fromId, toId]],
      );
      const from = rows.find((r) => r.id === fromId);
      if (!from || rows.length !== 2) throw new Error('account not found');
      if (Number(from.balance) < cents) throw new Error('insufficient funds');

      await c.query('UPDATE account SET balance = balance - $1 WHERE id = $2', [cents, fromId]);
      await c.query('UPDATE account SET balance = balance + $1 WHERE id = $2', [cents, toId]);
    });
  } catch (err: any) {
    if (RETRYABLE.has(err.code) && attempt < 4) {
      const backoff = 10 * 2 ** attempt + Math.random() * 10; // jitter breaks lockstep retries
      await new Promise((r) => setTimeout(r, backoff));
      return transfer(fromId, toId, cents, attempt + 1);
    }
    throw err;
  }
}`,
        },
      ],
      diagram: `   Without ordering                       With ordering (lock min id first)
 T1: lock A ---- wants B ---+          T1: lock A -> lock B -> commit
                            | cycle    T2:  wait A ............-> lock A -> lock B
 T2: lock B ---- wants A ---+          (T2 waits, no cycle possible)
      -> after 1 s: one aborted (40P01)`,
      keyPoints: [
        'Postgres detects deadlocks after deadlock_timeout (1 s) and aborts a victim with 40P01.',
        'Consistent ordering (sorted ids, one locking statement) prevents cycles.',
        'Retry the whole transaction with jitter; monitor deadlock rate.',
      ],
    },
    {
      heading: 'Lock contention on hot rows',
      body: `**Intuition:** if every request must update the same row, they form a single-file queue no matter how many cores you have. Throughput ≈ 1 / (time each transaction holds the lock).

**Where hot rows appear:** global counters (\`views\`), inventory for a flash-sale SKU, a merchant's balance receiving thousands of payments/s (a digital wallet), rate-limit rows, "last id" sequence tables, a tenant's settings row updated on every request.

**Math:** lock held from the UPDATE until COMMIT. If the transaction does the UPDATE first and then 3 more statements at ~0.7 ms each + commit ~1 ms, hold ≈ 3 ms → max **~330 tx/s** on that row. Queueing theory: as utilisation approaches 100%, wait time explodes, so trouble starts at ~70–80% of that.

**Fixes (cheapest first)**
1. **Shorten the hold:** do the hot UPDATE **last** in the transaction, single statement, no round trips after it; move external calls out.
2. **Atomic single statement** instead of SELECT FOR UPDATE + UPDATE (\`SET stock = stock - 1 WHERE stock > 0\`).
3. **Sharded counters:** N rows per counter (\`counter_id, shard\`); increment a random shard; read = SUM. Contention ÷ N.
4. **Batch/aggregate:** accumulate increments in memory or Redis and flush every second (views, likes) — trading durability/freshness for throughput.
5. **Async ledger:** append-only entries (no contention on inserts) + periodic balance materialisation — standard for merchant accounts.
6. **Move out of the DB:** Redis \`INCR\`/Lua for rate limits and counters (~100K ops/s per shard), with the DB as periodic source of truth.

**Diagnose:** \`pg_locks\` + \`pg_stat_activity\` show many sessions waiting on the same \`transactionid\`/tuple; wait events \`Lock:transactionid\` / \`Lock:tuple\` dominate in Performance Insights.`,
      code: [
        {
          language: 'sql',
          title: 'Sharded counter: spreading one hot row across 16',
          code: `CREATE TABLE post_like_counter (
  post_id bigint NOT NULL,
  shard   smallint NOT NULL,         -- 0..15
  likes   bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, shard)
);

-- Write: pick a random shard -> 16 independent row locks instead of 1
INSERT INTO post_like_counter (post_id, shard, likes)
VALUES ($1, floor(random() * 16)::int, 1)
ON CONFLICT (post_id, shard) DO UPDATE SET likes = post_like_counter.likes + 1;

-- Read: sum 16 rows via the primary key (cache the result for a few seconds)
SELECT sum(likes) AS likes FROM post_like_counter WHERE post_id = $1;

-- Diagnose hot-row waits: sessions waiting on locks, grouped by what they wait for
SELECT wait_event_type, wait_event, count(*)
  FROM pg_stat_activity
 WHERE state = 'active' AND wait_event_type = 'Lock'
 GROUP BY 1, 2 ORDER BY 3 DESC;`,
        },
      ],
      keyPoints: [
        'Hot-row throughput ≈ 1 / lock-hold time — cores do not help.',
        'Take the hot lock last and hold it briefly; prefer single atomic statements.',
        'Shard, batch or move counters to Redis; use append-only ledgers for balances.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 12 Digital Wallet',
    },
    {
      heading: 'Scenario deep dive: "remaining connection slots are reserved" — connections exhausted',
      body: `**The page:** 14:02 — API error rate 38%. Logs: \`FATAL: remaining connection slots are reserved for non-replication superuser connections\` and \`timeout exceeded when trying to connect\`. p99 at 10 s.

**Step 1 — Stabilise (first 5 minutes)**
- Do **not** scale out the app: more pods = more pools = worse.
- Shed load: enable edge rate limits / feature flags for expensive endpoints; pause batch jobs and cron workers.
- If one application holds most connections in \`idle in transaction\` (leak), terminate those sessions: \`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction' AND now() - state_change > interval '1 minute'\`.
- If a blocking lock is the root (a migration or long query), kill the blocker (\`pg_blocking_pids\`).

**Step 2 — Find which of four root causes it is**
| Evidence in pg_stat_activity / metrics | Root cause |
|---|---|
| Many \`idle in transaction\`, old \`state_change\`, one app | **Leak / open transactions** (missing release, tx across HTTP call) |
| Many \`active\` sessions waiting on \`Lock\` wait events, one blocker | **Lock contention / DDL queue** |
| Many \`active\` running normal queries slowly, DB CPU/IO at 100% | **DB saturation** — slow query regression, missing index, N+1 after deploy, cache failure sending traffic to DB |
| Connection count jumped with pod count, most \`idle\` | **Pool explosion** — autoscale × pool max, new service, no pooler |

**Step 3 — Fix the root cause**
- Leak: deploy the \`finally\` fix; add \`idle_in_transaction_session_timeout\`.
- Locks: \`lock_timeout\` on migrations, reorder/shorten transactions.
- Saturation: fix the query (index, rollback deploy), restore cache, move reports to replica.
- Explosion: put PgBouncer/RDS Proxy in transaction mode; set pool max so \`pods_max × pool_max ≤ bouncer max_client_conn\` and bouncer \`default_pool_size\` ≈ DB active budget.

**Step 4 — Prevent**
- Connection budget per service, reviewed like a quota: \`Σ (maxReplicas × pool_max)\`.
- Alerts: DB connections > 80% of max, \`db_pool_waiting\` > 0 for 1 min, idle-in-transaction count > N, oldest transaction age.
- Reserve slots: \`superuser_reserved_connections\` (default 3) keeps a door open for operators.
- Fail fast: acquire timeout 1 s, statement_timeout, bulkheads for heavy endpoints.
- Load test with the **max** replica count, not the average.`,
      code: [
        {
          language: 'sql',
          title: 'Incident triage queries',
          code: `-- 1) How close are we to max_connections, and who holds them?
SELECT (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn,
       count(*) AS used,
       count(*) FILTER (WHERE state = 'active')              AS active,
       count(*) FILTER (WHERE state = 'idle')                AS idle,
       count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx
  FROM pg_stat_activity WHERE backend_type = 'client backend';

-- 2) What are active sessions waiting on?
SELECT wait_event_type, wait_event, count(*)
  FROM pg_stat_activity WHERE state = 'active'
 GROUP BY 1, 2 ORDER BY 3 DESC;

-- 3) Root blockers (sessions blocking others but not blocked themselves)
SELECT pid, application_name, state, now() - xact_start AS tx_age, left(query, 80) AS query
  FROM pg_stat_activity
 WHERE pid IN (SELECT unnest(pg_blocking_pids(pid)) FROM pg_stat_activity)
   AND cardinality(pg_blocking_pids(pid)) = 0;

-- 4) Emergency: kill leaked transactions older than 60 s (after confirming the app)
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE state = 'idle in transaction' AND now() - state_change > interval '60 seconds'
   AND application_name = 'orders-api';`,
        },
      ],
      keyPoints: [
        'Never answer connection exhaustion by scaling out pods.',
        'Classify: leak, lock queue, DB saturation, or pool explosion — each has a distinct pg_stat_activity signature.',
        'Budget connections per service using max replicas; alert on waiting and idle-in-transaction.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'db-connections-locks-cc-1',
      title: 'Fix the checkout handler that exhausts the pool every sale',
      context:
        'During sales the orders API (40 pods, pool max 25 each) starts returning "timeout exceeded when trying to connect". pg_stat_activity shows hundreds of orders-api sessions "idle in transaction" and lock waits on the inventory table. Payment provider latency is 300–2,000 ms during sales.',
      task: 'Rewrite the handler so connections are held only for database work, never leak on errors, fail fast under pressure, and do not hold row locks while waiting on the payment provider.',
      starter: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
import { chargeCard } from './payments';
const pool = new Pool({ max: 25 });

export async function checkout(userId: string, sku: string, qty: number, card: string) {
  const client = await pool.connect();
  await client.query('BEGIN');
  const { rows } = await client.query(
    'SELECT stock, price FROM inventory WHERE sku = $1 FOR UPDATE', [sku]);
  if (rows[0].stock < qty) {
    return { ok: false, reason: 'out of stock' };
  }
  // charge while holding the row lock "so nobody else takes the stock"
  const charge = await chargeCard(card, rows[0].price * qty);
  await client.query('UPDATE inventory SET stock = stock - $1 WHERE sku = $2', [qty, sku]);
  await client.query(
    'INSERT INTO orders (user_id, sku, qty, charge_id) VALUES ($1, $2, $3, $4)',
    [userId, sku, qty, charge.id]);
  await client.query('COMMIT');
  client.release();
  return { ok: true };
}`,
      },
      hints: [
        'Trace every exit path: which ones release the client, and which leave a BEGIN open?',
        'How long is the inventory row lock held, and what does Little\'s Law say about connections needed when each request holds one for ~1 s?',
        'Reserve first (short transaction), charge outside any transaction, then confirm or release — with idempotency.',
      ],
      solution: {
        language: 'typescript',
        code: `import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { chargeCard, refund } from './payments';

const pool = new Pool({
  max: 10,                                  // 40 pods x 10 = 400 client conns -> PgBouncer -> ~40 server conns
  connectionTimeoutMillis: 1000,            // fail fast: 503 instead of piling up
  statement_timeout: 2000,
  idle_in_transaction_session_timeout: 5000,
});

async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function checkout(userId: string, sku: string, qty: number, card: string, idemKey: string) {
  const orderId = randomUUID();
  // 1) Reserve stock: one atomic statement, lock held for ~1 ms, no external calls
  const reserved = await tx(async (c) => {
    const upd = await c.query(
      'UPDATE inventory SET stock = stock - $1 WHERE sku = $2 AND stock >= $1 RETURNING price',
      [qty, sku]);
    if (upd.rowCount !== 1) return null;
    await c.query(
      "INSERT INTO orders (id, user_id, sku, qty, status, idempotency_key) VALUES ($1,$2,$3,$4,'reserved',$5)",
      [orderId, userId, sku, qty, idemKey]);  // UNIQUE(idempotency_key) blocks double submits
    return { price: Number(upd.rows[0].price) };
  });
  if (!reserved) return { ok: false, reason: 'out of stock' };

  // 2) Charge with NO connection held and NO locks held
  let chargeId: string;
  try {
    chargeId = (await chargeCard(card, reserved.price * qty, { idempotencyKey: idemKey })).id;
  } catch (e) {
    await tx((c) => c.query(                      // compensate: give stock back
      "UPDATE inventory SET stock = stock + $1 WHERE sku = $2", [qty, sku]).then(() =>
      c.query("UPDATE orders SET status = 'failed' WHERE id = $1", [orderId])));
    return { ok: false, reason: 'payment failed' };
  }

  // 3) Confirm (short transaction). If this fails, a reconciler finds 'reserved' orders
  //    with a charge and completes or refunds them.
  try {
    await tx((c) => c.query(
      "UPDATE orders SET status = 'paid', charge_id = $1 WHERE id = $2", [chargeId, orderId]));
  } catch (e) {
    await refund(chargeId).catch(() => undefined); // best effort; reconciler is the backstop
    throw e;
  }
  return { ok: true, orderId };
}`,
      },
      explanation: `**Fixes**
- **Leaks:** the out-of-stock early \`return\` and any thrown error left the client checked out with an open \`BEGIN\` → "idle in transaction" sessions holding locks. All DB work now goes through a helper that always commits/rolls back and releases.
- **Lock held across a network call:** the row lock on a hot SKU was held for the full payment latency (0.3–2 s), serialising all buyers of that SKU and pinning a connection per request. By Little's Law, 2,000 req/s × 1 s hold = 2,000 connections needed — impossible. Now the lock is held ~1 ms.
- **Reserve → charge → confirm:** a conditional atomic UPDATE reserves stock (no oversell), payment happens outside any transaction, a compensating update releases stock on failure, and a reconciler covers crashes between steps.
- **Idempotency:** a UNIQUE idempotency key on orders and the provider's idempotency key prevent double charges on retries.
- **Fail fast & budget:** acquire timeout 1 s, statement and idle-in-transaction timeouts, and a smaller per-pod pool fronted by PgBouncer so 40 pods cannot open 1,000 server connections.
- **Null safety:** the starter crashed on \`rows[0]\` for unknown SKUs (leaking the client); the conditional UPDATE handles it.`,
      followUps: [
        {
          "q": "The pod crashes after `chargeCard` succeeds but before the confirm transaction. Walk me through how the system ends up consistent.",
          "a": "The order stays in `reserved` with stock decremented and no charge_id. A reconciler runs every minute and selects orders that have stayed `reserved` for more than 5 minutes. For each it queries the payment provider by the idempotency key. If a charge exists, it sets `status = 'paid', charge_id = ...`. If not, it releases the stock and marks the order `expired`. The provider's idempotency key ensures that a client retry with the same key returns the original charge instead of charging twice. Alert on the count of reserved orders older than 15 minutes."
        },
        {
          "q": "How would you load-test this to show the pool no longer collapses when the payment provider is slow?",
          "a": "Replace the payment provider with a stub whose latency you control (for example 2 s p50 with occasional 5 s). Drive 2,000 req/s on a single SKU with k6. Measure pool waitingCount, acquire time, the number of `idle in transaction` sessions in pg_stat_activity (should be about 0) and lock waits on inventory. Pass criteria: DB connections stay near the Little's Law value for 1–2 ms holds, stock never goes negative (`SELECT min(stock)`), and the count of paid orders equals the stock decrement. Repeat with the provider returning 50% errors to exercise compensation."
        }
      ],
    },
    {
      id: 'db-connections-locks-cc-2',
      title: 'Stop the batch job from deadlocking with the API',
      context:
        'A nightly job applies price updates from a partner file (up to 50K SKUs) while the API keeps selling. The log shows dozens of "deadlock detected" errors per night; the job aborts halfway and the API sees 1–2 s latency spikes on product updates.',
      task: 'Rewrite the job so it cannot deadlock with itself or with API transactions that update products in id order, keeps each transaction short, and resumes safely after failures.',
      starter: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
const pool = new Pool({ max: 20 });

type PriceUpdate = { sku: string; price: number };

export async function applyPrices(updates: PriceUpdate[]) {
  // run 20 chunks in parallel to go fast
  const chunks: PriceUpdate[][] = [];
  for (let i = 0; i < updates.length; i += 2500) chunks.push(updates.slice(i, i + 2500));

  await Promise.all(chunks.map(async (chunk) => {
    const client = await pool.connect();
    await client.query('BEGIN');
    for (const u of chunk) {  // file order is arbitrary; SKUs can repeat across chunks
      await client.query('UPDATE product SET price = $1, updated_at = now() WHERE sku = $2',
        [u.price, u.sku]);
    }
    await client.query('COMMIT');
    client.release();
  }));
}`,
      },
      hints: [
        'Two chunks containing the same SKUs in different orders — what cycle can form? And the API locks products in id order.',
        'How long does a 2,500-row transaction with 2,500 round trips hold its locks?',
        'Deduplicate, sort, and apply in small batches with a single set-based statement per batch.',
      ],
      solution: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
const pool = new Pool({ max: 4, connectionTimeoutMillis: 2000 });

type PriceUpdate = { sku: string; price: number };
const BATCH = 500;

export async function applyPrices(updates: PriceUpdate[], concurrency = 2) {
  // 1) Deduplicate (last write wins) so no two batches touch the same SKU
  const latest = new Map<string, number>();
  for (const u of updates) latest.set(u.sku, u.price);
  const skus = [...latest.keys()];

  // 2) Resolve ids and sort by id: same global order the API uses when locking
  const { rows } = await pool.query(
    'SELECT id, sku FROM product WHERE sku = ANY($1) ORDER BY id', [skus]);
  const ordered = rows.map((r) => ({ id: r.id as string, price: latest.get(r.sku)! }));

  // 3) Disjoint, id-ordered batches; each is ONE short transaction and ONE statement
  const batches: typeof ordered[] = [];
  for (let i = 0; i < ordered.length; i += BATCH) batches.push(ordered.slice(i, i + BATCH));

  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next++];
      await runBatch(b, 1);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker)); // low, bounded parallelism
}

async function runBatch(b: { id: string; price: number }[], attempt: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'");  // never wait long behind API txs
    // Lock rows in id order first, then update set-based (1 round trip each)
    await client.query('SELECT 1 FROM product WHERE id = ANY($1) ORDER BY id FOR UPDATE',
      [b.map((x) => x.id)]);
    await client.query(
      'UPDATE product p SET price = v.price, updated_at = now() ' +
      'FROM unnest($1::bigint[], $2::numeric[]) AS v(id, price) WHERE p.id = v.id',
      [b.map((x) => x.id), b.map((x) => x.price)]);
    await client.query('COMMIT');
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (['40P01', '55P03'].includes(e.code) && attempt < 5) {   // deadlock / lock timeout
      await new Promise((r) => setTimeout(r, 100 * attempt + Math.random() * 100));
      return runBatch(b, attempt + 1);                         // idempotent: same prices again
    }
    throw e;
  } finally {
    client.release();
  }
}`,
      },
      explanation: `**Why it deadlocked**
- Parallel chunks updated overlapping SKUs in arbitrary file order → chunk A locks X then wants Y while chunk B locks Y then wants X. The API locks products in id order, which the job violated too.
- Each 2,500-row transaction made 2,500 sequential round trips (~1–3 s), holding thousands of row locks the whole time → large windows for cycles and API latency spikes.

**Fixes**
- **Deduplicate** SKUs so batches are disjoint.
- **Global lock order:** resolve ids and process in ascending id, locking with \`ORDER BY id FOR UPDATE\` — the same order the API uses, so no cycle can form.
- **Small set-based batches:** 500 rows per transaction, one \`UPDATE ... FROM unnest(...)\` statement → milliseconds of lock hold.
- **Bounded concurrency** (2 workers, pool of 4) so the job cannot starve the API of DB capacity.
- **lock_timeout + retry:** the job yields to API transactions instead of queueing behind them, and retries idempotently on 40P01/55P03.
- **Resumable:** each batch is idempotent (sets absolute prices), so a restarted job can simply reapply.`,
      followUps: [
        {
          "q": "The partner file grows to 5M SKUs and must finish within a 30-minute window. Does your design still work?",
          "a": "At 500 rows per batch that's 10K batches. If each takes about 50 ms, 2 workers finish in ~250 s, so it fits, but the upfront `SELECT ... WHERE sku = ANY($1)` with 5M values is too big for one query. Stream instead: COPY the file into a staging table, deduplicate there, join with `product` to get ids, then process staging in id-range batches (`WHERE id BETWEEN $lo AND $hi`) with the same lock-in-order UPDATE. Keep a progress table recording the last committed id range, so a restart resumes mid-file instead of reapplying everything."
        },
        {
          "q": "How do you prove in a test that the job can no longer deadlock with the API?",
          "a": "Write a concurrency test against a real Postgres (Testcontainers). Seed 10K products, then run the job with a shuffled file containing duplicate SKUs while N parallel API simulators update random product sets in id order inside transactions, with small random sleeps between statements to widen windows. Assert zero 40P01 errors in Postgres logs (`log_lock_waits = on`, scan for 'deadlock detected'), that final prices equal the deduplicated file, and that API p99 stays below a threshold. Run it repeatedly in CI; for contrast, the old code fails within a few runs."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'db-connections-locks-iq-01',
      difficulty: 'hard',
      question:
        'It is Black Friday. Your API starts failing with "too many connections" to Postgres. The on-call engineer wants to double the pod count. What do you do instead, step by step?',
      whatInterviewerLooksFor: [
        'Explains why scaling pods worsens connection exhaustion',
        'Triages with pg_stat_activity: leak vs lock queue vs saturation vs pool explosion',
        'Takes immediate stabilising actions (shed load, kill leaked sessions, pause batch)',
        'Proposes durable fixes: pooler, budgets, timeouts, alerts',
      ],
      modelAnswer: `### Why not double pods
Each pod brings a pool. 60 pods × 20 = 1,200 → 120 pods × 20 = 2,400 connection attempts against a \`max_connections\` of maybe 500. The DB is already the bottleneck; more pods add connection storms (each new connection forks a backend, 5–50 ms of DB work) and more concurrent queries competing for the same cores.

### Stabilise (minutes)
1. **Shed load** at the gateway: rate-limit non-critical endpoints, disable expensive features (recommendations, reports) via flags, pause cron/batch workers.
2. **Look at pg_stat_activity grouped by application_name and state.**
   - Hundreds of \`idle in transaction\` from one service → leak; \`pg_terminate_backend\` sessions idle in tx > 60 s; roll back the offending deploy.
   - Many active sessions waiting on \`Lock\` → find the root blocker with \`pg_blocking_pids\` and kill it (often a migration or a long batch transaction).
   - All active, CPU at 100% → query regression or cache failure; roll back, restore cache, move reports to replicas.
   - Mostly \`idle\` connections and count tracks pod count → pool explosion.
3. Protect the operators: \`superuser_reserved_connections\` should let you in; if not, connect via the pooler admin console.

### Durable fixes
- **PgBouncer/RDS Proxy in transaction mode**: thousands of client connections, ~2–3× cores server connections.
- **Connection budget** per service: \`maxReplicas × pool_max\` reviewed against the pooler limits.
- **Timeouts:** acquire 1 s (fail fast with 503), \`statement_timeout\`, \`idle_in_transaction_session_timeout\`.
- **Bulkheads** for heavy endpoints; separate pools for batch.
- **Alerts:** connections > 80%, pool waiting > 0 for 1 min, oldest transaction age.
- Load-test at max replica count before the next sale.`,
      followUps: [
        {
          q: 'After adding PgBouncer in transaction mode, some requests fail with "prepared statement does not exist". Why?',
          a: 'Protocol-level prepared statements are per server connection; in transaction mode the next transaction may run on a different server connection. Upgrade to PgBouncer ≥ 1.21 and set max_prepared_statements, or disable server-side prepared statements in the driver.',
        },
        {
          q: 'Why raise statement_timeout for batch roles but not API roles?',
          a: 'API requests have user-facing deadlines — a query running longer than the request timeout is pure waste. Batch jobs legitimately run long, but they get their own role, pool and limits so they cannot starve OLTP.',
        },
      ],
      pitfalls: [
        'Scaling out pods or raising max_connections to 5,000',
        'Restarting the database without knowing the cause',
        'Ignoring idle-in-transaction sessions as "harmless idle"',
      ],
    },
    {
      id: 'db-connections-locks-iq-02',
      difficulty: 'medium',
      question:
        'How would you size the connection pool for a NestJS service running 30 pods that handles 6,000 requests/s against a 32-core Postgres primary?',
      whatInterviewerLooksFor: [
        'Uses Little\'s Law with connection hold time, not query time alone',
        'Applies a DB-side budget (≈ 2 × cores + spindles)',
        'Accounts for pods × pools and other services',
        'Proposes a pooler and validation with load tests/metrics',
      ],
      modelAnswer: `### Measure hold time
Suppose each request runs 3 queries of ~1 ms including network, inside one short transaction: hold ≈ 3–4 ms.

### Little's Law per service
\`L = λ × W = 6,000 req/s × 0.004 s = 24\` connections busy on average across the fleet. With variance and bursts (×2–3), ~50–70 concurrently needed at peak.

### Per pod
6,000 / 30 = 200 req/s per pod × 0.004 = 0.8 busy connections on average. A pool of **5** per pod gives ample headroom → 30 × 5 = 150 client connections.

### DB-side budget
32 cores → (32 × 2) + ~1 ≈ **65 active** connections is a sensible ceiling for the whole database — all services combined. Our 50–70 peak already uses most of it, so other services and batch jobs must share. That argues for:
- **PgBouncer** in transaction mode with \`default_pool_size ≈ 60\` and \`max_client_conn\` in the thousands, so autoscaling to 60 pods (300 client conns) is harmless.
- Separate, smaller pool (or bouncer user) for batch jobs.

### Validate
- Load test at max replicas; watch DB CPU, TPS, p99, \`db_pool_waiting\`.
- If p99 rises while CPU is saturated, **reduce** server-side pool size — queueing in the pooler is cheaper than in Postgres.
- Revisit if hold time changes (e.g. someone adds an HTTP call inside a transaction: hold 4 ms → 100 ms means 25× the connections).`,
      followUps: [
        {
          q: 'Why not just set pool max to 50 per pod to be safe?',
          a: 'Under a DB slowdown each pod would open up to 50 connections → 1,500 total, overwhelming Postgres exactly when it is weakest. Large pools convert a slowdown into an outage; small pools with fail-fast acquire timeouts contain it.',
        },
        {
          q: 'What does a non-zero pool waiting count with low DB CPU tell you?',
          a: 'Connections are held but not doing DB work: leaks, idle-in-transaction during external calls, or lock waits. Look at hold time and pg_stat_activity states rather than enlarging the pool.',
        },
      ],
      pitfalls: [
        'Sizing by "number of concurrent users"',
        'Forgetting that the budget is shared by every service and pod',
        'Assuming bigger pools always increase throughput',
      ],
    },
    {
      id: 'db-connections-locks-iq-03',
      difficulty: 'expert',
      question:
        'You are putting PgBouncer in transaction mode in front of a Postgres cluster used by 15 services. What breaks, and how do you migrate safely?',
      whatInterviewerLooksFor: [
        'Lists session-state features that break in transaction pooling',
        'Knows driver-level issues (prepared statements, SET, search_path)',
        'Plans a gradual migration with audits and fallbacks',
        'Considers HA of PgBouncer itself and observability',
      ],
      modelAnswer: `### What breaks in transaction mode
A client gets a server connection only for the duration of a transaction; the next transaction may run on a different backend. Anything tied to the **session** breaks:
- \`SET\` outside a transaction (search_path, timezone, statement_timeout) → leaks to other clients or disappears. Use \`SET LOCAL\` inside transactions or role-level defaults (\`ALTER ROLE ... SET\`).
- **Session advisory locks** (\`pg_advisory_lock\`) → may be held on a backend another client then uses; unlock may run elsewhere. Use \`pg_advisory_xact_lock\`.
- **LISTEN/NOTIFY** → listener must be on a dedicated session-mode connection.
- **Temp tables**, \`WITH HOLD\` cursors, \`PREPARE\` across transactions.
- **Protocol prepared statements** (many drivers use them automatically) → fixed in PgBouncer 1.21+ with \`max_prepared_statements\`; otherwise disable in the driver.
- Anything using \`pg_backend_pid()\` for identity.

### Migration plan
1. **Audit** each service: grep for SET, advisory locks, LISTEN, temp tables; check driver prepared-statement behaviour (node-postgres uses unnamed statements unless you pass a \`name\`; Prisma and some ORMs use named ones).
2. Deploy PgBouncer as a highly available tier (2+ instances behind an internal LB or as a sidecar/daemonset; multiple processes with \`so_reuseport\` since each is single-threaded).
3. Start with **session mode** for all services (no behaviour change, just connection churn relief) — verify.
4. Move services one at a time to **transaction mode** via a separate PgBouncer database entry/port; canary a few pods; watch errors like "prepared statement does not exist", unexpected search_path.
5. Keep a session-mode pool for services that need LISTEN/NOTIFY or long-lived sessions, and for migrations (DDL tools often rely on session settings and advisory locks — e.g. many migration tools take a session advisory lock).
6. Set limits: \`default_pool_size\` per (db,user), \`max_db_connections\`, \`query_wait_timeout\`.

### Observability
\`SHOW POOLS\` / \`SHOW STATS\` (cl_waiting, maxwait, avg query time), exported to Prometheus; alert on \`cl_waiting\` and \`maxwait\`.`,
      followUps: [
        {
          q: 'Where should PgBouncer run: next to the app or next to the database?',
          a: 'Central (near the DB) gives global multiplexing and a single enforcement point but is a shared dependency to make HA; sidecars reduce hops and blast radius but multiply server connections (pods × sidecar pool). Many teams use a central tier, or both: a small sidecar pool plus a central cap.',
        },
        {
          q: 'How do schema migrations run if the migrator uses session advisory locks?',
          a: 'Point the migration tool directly at Postgres (or at a session-mode pool), with lock_timeout set, rather than through the transaction-mode pool.',
        },
      ],
      pitfalls: [
        'Assuming PgBouncer is a transparent drop-in',
        'Running a single PgBouncer instance as a new single point of failure',
        'Running migrations through the transaction-mode pool',
      ],
    },
    {
      id: 'db-connections-locks-iq-04',
      difficulty: 'hard',
      question:
        'A developer ran ALTER TABLE orders ADD COLUMN public_id uuid DEFAULT gen_random_uuid() during business hours, and the whole checkout flow stopped for four minutes, though the statement itself should take milliseconds. Explain what happened and how you prevent it.',
      whatInterviewerLooksFor: [
        'Explains ACCESS EXCLUSIVE and the lock queue behind a waiting DDL',
        'Knows which ALTERs rewrite tables (volatile default) vs metadata-only',
        'Uses lock_timeout + retry and migration discipline',
        'Mentions detection queries and tooling',
      ],
      modelAnswer: `### What happened
1. A long-running transaction (a report, or an idle-in-transaction session) held ACCESS SHARE on \`orders\`.
2. ALTER TABLE needs **ACCESS EXCLUSIVE**. It queued behind that transaction.
3. Every subsequent query on \`orders\` — even plain SELECTs — conflicted with the *waiting* ACCESS EXCLUSIVE request and queued **behind the ALTER**. Checkout stalled; app pools filled with waiting sessions; connection timeouts cascaded.
4. Additionally, \`gen_random_uuid()\` is **volatile**: since PG 11, adding a column with a *non-volatile* default (a constant, or a stable expression like \`now()\`, evaluated once) is metadata-only, but a volatile default must be computed per row, forcing a **full table rewrite** under ACCESS EXCLUSIVE — minutes on a large table.

### Prevention
- **lock_timeout** in every migration session (\`SET lock_timeout = '2s'\`), with retries and backoff: failing fast is harmless; waiting is an outage.
- **statement_timeout** for migrations too.
- Write migrations that avoid rewrites: add the column nullable (or with a constant default), backfill in small batches, then set default/NOT NULL (use a \`CHECK ... NOT VALID\` + \`VALIDATE CONSTRAINT\` to avoid long exclusive locks).
- \`CREATE INDEX CONCURRENTLY\`, \`ADD CONSTRAINT ... NOT VALID\` then \`VALIDATE\` (only SHARE UPDATE EXCLUSIVE).
- Kill or avoid long transactions before DDL; \`idle_in_transaction_session_timeout\` globally.
- Migration linting in CI (e.g. squawk, strong_migrations-style rules) and a runbook that checks \`pg_stat_activity\` for old transactions first.

### Detection during the incident
\`pg_blocking_pids\` shows the ALTER blocked by the old transaction and hundreds of sessions blocked by the ALTER; cancelling the ALTER immediately unblocks traffic.`,
      followUps: [
        {
          q: 'Which is safer to kill first during the incident: the ALTER or the long transaction?',
          a: 'Cancel the ALTER — it is the thing everyone is queued behind, and it can be retried later with lock_timeout. Killing the long transaction lets the ALTER proceed, which may then take the table exclusively for a rewrite.',
        },
        {
          q: 'How does MySQL handle the same scenario?',
          a: 'MySQL has metadata locks (MDL): a waiting ALTER blocks subsequent queries on the table similarly ("Waiting for table metadata lock"). Use lock_wait_timeout, online DDL (ALGORITHM=INSTANT/INPLACE) and tools like gh-ost/pt-online-schema-change.',
        },
      ],
      pitfalls: [
        'Blaming the ALTER\'s own execution time only',
        'Not knowing that a waiting lock blocks later compatible requests',
        'Running DDL without lock_timeout',
      ],
    },
    {
      id: 'db-connections-locks-iq-05',
      difficulty: 'expert',
      question:
        'Design a job queue on Postgres that supports 50 worker pods, at-least-once processing, retries with backoff, and no job processed by two workers at the same time. Where does it stop scaling?',
      whatInterviewerLooksFor: [
        'Uses FOR UPDATE SKIP LOCKED with a partial index',
        'Handles crashes: visibility timeout / lease, not a long-held lock across processing',
        'Makes handlers idempotent',
        'Knows the scaling limits (update churn, vacuum, connections) and when to move to a broker',
      ],
      modelAnswer: `### Schema
\`job(id bigserial, queue text, status text, run_at timestamptz, attempts int, locked_until timestamptz, payload jsonb, ...)\` with a **partial index** \`(queue, run_at) WHERE status = 'queued'\`.

### Claiming (lease, not a lock held during work)
- \`WITH next AS (SELECT id FROM job WHERE queue = $1 AND status = 'queued' AND run_at <= now() ORDER BY run_at LIMIT 10 FOR UPDATE SKIP LOCKED) UPDATE job SET status = 'running', locked_until = now() + interval '5 minutes', attempts = attempts + 1 FROM next WHERE job.id = next.id RETURNING ...\`
- SKIP LOCKED means workers never wait on each other; the transaction commits immediately, so the row lock is held for ~1 ms, **not** during processing (holding a transaction open for minutes would pin connections, block vacuum and lose work on crash anyway).

### Completion & failure
- Success: \`UPDATE job SET status = 'done' WHERE id = $1 AND status = 'running'\`.
- Failure: \`status = 'queued', run_at = now() + backoff(attempts)\`; after N attempts → \`dead\`.
- **Crashed worker:** a reaper re-queues \`running\` jobs whose \`locked_until < now()\` → at-least-once. Handlers must be **idempotent** (idempotency keys, upserts).
- Long jobs heartbeat by extending \`locked_until\`.

### Connections
50 pods × 1–2 connections each for polling; use LISTEN/NOTIFY (on a session-mode connection) or adaptive polling intervals to avoid hammering the DB when idle.

### Where it stops scaling
- Each job = insert + 2–3 updates → dead tuples and WAL; beyond roughly a few thousand jobs/s per table, vacuum and index bloat on the hot partial index become the bottleneck (tune autovacuum aggressively, partition by time, delete/archive done jobs).
- Polling from hundreds of workers adds constant load.
- No fan-out/pub-sub semantics or replay.
At tens of thousands of jobs/s, or when you need streaming/replay, move to a broker (SQS, RabbitMQ, Kafka) — keeping the **transactional outbox** in Postgres so enqueue is atomic with business writes.`,
      followUps: [
        {
          q: 'Why is transactional enqueue the main reason to keep a queue in Postgres?',
          a: 'The job insert commits atomically with the business change, so you never have "order saved but email job lost" or the reverse — the dual-write problem disappears without an outbox relay.',
        },
        {
          q: 'What happens with FOR UPDATE SKIP LOCKED and LIMIT under REPEATABLE READ?',
          a: 'If a selected row was concurrently updated, REPEATABLE READ raises a serialization error instead of re-checking; queue claims should run at READ COMMITTED.',
        },
      ],
      pitfalls: [
        'Holding the row lock / transaction open for the whole job processing',
        'Forgetting crash recovery (lease expiry) and idempotency',
        'Polling with SELECT then UPDATE without SKIP LOCKED (races or waits)',
      ],
    },
    {
      id: 'db-connections-locks-iq-06',
      difficulty: 'hard',
      question:
        'After a new feature launch, the logs show about 200 "deadlock detected" errors per hour on the orders and order_items tables. How do you investigate and fix it?',
      whatInterviewerLooksFor: [
        'Uses deadlock log details to identify the two statements and lock order',
        'Checks implicit locks (FK checks, triggers, unique checks) and batch operations',
        'Fixes with consistent ordering, shorter transactions, and retries',
        'Treats a low steady rate with retries as acceptable but investigates the pattern',
      ],
      modelAnswer: `### Investigate
1. Postgres logs the deadlock with both processes' statements and the lock types (\`ShareLock on transaction X\`, \`tuple\`). Enable \`log_lock_waits = on\` (logs waits longer than \`deadlock_timeout\`) to see near-misses.
2. Map the statements to code paths. Typical findings after a feature launch:
   - **Opposite ordering:** the new feature updates \`order_items\` then \`orders\` (e.g. recalculating totals), while checkout updates \`orders\` then inserts \`order_items\`.
   - **Unordered multi-row updates:** \`UPDATE order_items SET ... WHERE order_id = ANY($1)\` from two sessions with overlapping sets locks rows in scan order, which can differ.
   - **Implicit locks:** inserting \`order_items\` takes FOR KEY SHARE on the parent \`orders\` row (FK check); another tx doing \`SELECT ... FOR UPDATE\` on that order after locking items creates a cycle. Triggers updating parent totals add hidden locks.
3. Check \`pg_stat_database.deadlocks\` trend to confirm correlation with the launch.

### Fix
- Establish a **global lock order**: parent before child, ascending ids within a table. Lock the parent explicitly first (\`SELECT ... FROM orders WHERE id = $1 FOR UPDATE\`) in every path that modifies its children.
- For multi-row updates, lock in order first: \`SELECT id FROM order_items WHERE id = ANY($1) ORDER BY id FOR UPDATE\`.
- Shorten transactions; move recalculation to an async job or compute totals in one statement.
- Remove hidden lock sources (replace per-row triggers updating the parent with a single update).
- Keep a **retry wrapper** for 40P01 with jitter — deadlocks are never fully impossible under concurrency, but a well-ordered system should have a rate near zero.`,
      followUps: [
        {
          q: 'Would lowering deadlock_timeout help?',
          a: 'It detects deadlocks sooner (less time blocked) but costs more detector runs for ordinary lock waits; it does not reduce the number of deadlocks. Fix the ordering; tune the timeout only if waits are long and deadlocks frequent.',
        },
        {
          q: 'Why can two UPDATE ... WHERE id IN (...) statements deadlock without any explicit locking?',
          a: 'Each UPDATE locks rows as it visits them; if the two statements visit overlapping rows in different orders (different plans or input orders), they can each hold a row the other needs.',
        },
      ],
      pitfalls: [
        'Only increasing retries without fixing lock order',
        'Ignoring implicit FK and trigger locks',
        'Proposing SERIALIZABLE as a deadlock fix (it adds serialization failures instead)',
      ],
    },
    {
      id: 'db-connections-locks-iq-07',
      difficulty: 'expert',
      question:
        'A payments platform has one merchant receiving 3,000 payments per second, and every payment updates the merchant\'s balance row. p99 is 4 s and rising. Redesign the write path.',
      whatInterviewerLooksFor: [
        'Computes the hot-row ceiling from lock hold time',
        'Proposes append-only ledger entries + asynchronous or sharded balance aggregation',
        'Preserves correctness: double-entry, idempotency, no negative balance for debits',
        'Discusses read path for balance and reconciliation',
      ],
      modelAnswer: `### Why it fails
Each payment transaction: insert payment, update merchant balance, insert ledger lines, commit. The merchant row lock is held from the balance UPDATE until commit, ~2–3 ms with round trips and fsync → ceiling **~330–500 updates/s** on that row. At 3,000/s the lock queue grows without bound → seconds of latency, pool exhaustion.

### Redesign
1. **Append-only ledger as the source of truth:** each payment inserts double-entry lines (\`debit customer, credit merchant\`) — inserts do not contend on a shared row. Idempotency key UNIQUE per payment.
2. **Balance as a derived value**, updated off the hot path:
   - **Sharded sub-accounts:** merchant balance split into N = 32 rows; each payment credits a random shard → ~100 updates/s per row, well below the ceiling. Balance = SUM of 32 rows.
   - Or **batched aggregation:** a worker consumes ledger entries (via CDC/Kafka or polling by id) and applies one \`UPDATE ... SET balance = balance + $sum\` per merchant per 100 ms → ~10 updates/s.
3. **Credits vs debits:** credits (incoming payments) can be applied asynchronously — nobody is harmed by a balance slightly behind. Debits (payouts, refunds) must check sufficient funds: run them against the authoritative sum (ledger total or all shards locked in order) with a single serialising path per merchant, which is low-volume.
4. **Reads:** "available balance" = materialised balance + unapplied ledger entries since the last watermark, or accept seconds of staleness in the dashboard.
5. **Reconciliation:** periodic job verifies Σ ledger = materialised balances; alerts on drift.

### Result
Payment insert path has no shared-row contention → p99 back to tens of ms at 3,000/s; the balance update path runs at a controlled rate. This mirrors the event-sourcing approach of the classic digital wallet design.`,
      followUps: [
        {
          q: 'Why not just use Redis INCRBY for the balance?',
          a: 'It removes contention but moves the source of truth for money into a store with weaker durability guarantees (async replication, possible loss on failover). It can serve as a fast cache of the balance, with the durable ledger in Postgres as truth.',
        },
        {
          q: 'How do you choose the number of shards?',
          a: 'shards ≥ peak writes/s × lock hold time ÷ target utilisation, e.g. 3,000 × 0.003 ÷ 0.5 ≈ 18 → round to 32 for growth; reads sum all shards, so keep N small enough for cheap reads.',
        },
      ],
      pitfalls: [
        'Adding a bigger DB instance (more cores do not help a single row)',
        'A distributed lock around the balance',
        'Applying debits asynchronously without a funds check',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'db-connections-locks-boe-1',
      question:
        'Eight microservices share one Postgres primary (max_connections = 500, 16 cores). Each runs between 5 and 40 pods (HPA) with a pool max of 20. How many connections can they open at peak, and what should the pooler be configured to?',
      assumptions: [
        'Average max replicas across services ≈ 25 → 8 × 25 = 200 pods at peak',
        'Each pod: pool max 20; plus 2 cron jobs × 10 connections, migrations 5, monitoring 5',
        'Healthy active set for 16 cores ≈ 2 × 16 + 1 ≈ 33; allow up to ~50 with I/O waits',
        'Measured hold time 5 ms; total peak traffic 8,000 req/s',
      ],
      steps: [
        { label: 'Worst-case client connections', calc: '200 pods × 20 = 4,000 + 20 + 5 + 5 ≈ 4,030' },
        { label: 'vs max_connections', calc: '4,030 ≫ 500 → "too many clients" under scale-out' },
        { label: 'Actually needed (Little)', calc: '8,000 req/s × 0.005 s = 40 busy; with burst factor 1.5 ≈ 60' },
        { label: 'Pooler server side', calc: 'default_pool_size ≈ 40–50, max_db_connections ≈ 60, leave ~440 for admin/replication/headroom' },
        { label: 'Pooler client side', calc: 'max_client_conn ≥ 4,030 → set 5,000; app pools can even shrink to 5 per pod (1,000 total)' },
      ],
      answer:
        'Up to ~4,000 client connections at peak — 8× max_connections — while only ~40–60 are ever busy. Put PgBouncer in transaction mode with ~50 server connections and max_client_conn ≈ 5,000, and shrink app pools to ~5.',
      insight:
        'The gap between connections opened (thousands) and connections doing work (tens) is the whole argument for a pooler. Budget connections by max replicas, not average.',
      followUps: [
        {
          "q": "One of the 8 services has a runaway query pattern and saturates its pool. With one shared PgBouncer pool, what happens to the other 7, and how do you isolate them?",
          "a": "If all services share one database/user pool of about 50 server connections, the noisy service takes them all and the others queue in `cl_waiting`, so one bad service becomes a cluster-wide outage. Give each service its own role and PgBouncer pool entry with `pool_size` sized from its Little's Law demand (for example 5–10 each), keep the sum at or below `max_db_connections`, and use a `reserve_pool_size` for bursts. Add per-role `statement_timeout`. Then a misbehaving service fills only its own pool."
        }
      ],
    },
    {
      id: 'db-connections-locks-boe-2',
      question:
        'A service holds a DB connection during a call to a fraud-check API (p50 60 ms, p99 800 ms). At 1,500 req/s, how many connections does it need at p50 and when the fraud API degrades to p99 latency, versus moving the call outside the transaction?',
      assumptions: [
        'DB work per request ≈ 4 ms',
        'Fraud call made while holding the connection (inside the transaction)',
        '20 pods, pool max 20 each (400 total)',
      ],
      steps: [
        { label: 'Hold time at p50', calc: '4 ms + 60 ms = 64 ms → 1,500 × 0.064 = 96 connections' },
        { label: 'Hold time when fraud API is slow', calc: '4 ms + 800 ms = 804 ms → 1,500 × 0.804 ≈ 1,206 connections' },
        { label: 'vs pool capacity', calc: '1,206 needed vs 400 available → requests queue; waiting grows without bound; timeouts' },
        { label: 'Call moved outside transaction', calc: 'hold = 4 ms → 1,500 × 0.004 = 6 connections, regardless of fraud latency' },
      ],
      answer:
        '~96 connections normally, ~1,200 when the fraud API slows — 3× the pool, causing an outage — versus ~6 connections if the external call is made outside the transaction.',
      insight:
        'Connection demand scales with hold time. A dependency\'s latency spike becomes a DB outage when calls are made while holding a connection; always do external I/O outside transactions (reserve → call → confirm).',
      followUps: [
        {
          "q": "You can't move the fraud call out of the transaction this quarter. What limits would you put in place so a fraud-API slowdown can't take down the DB?",
          "a": "Cap the hold time. Use a fraud-call timeout of about 150 ms with fail-open or fail-to-review semantics, so hold time ≤ 154 ms and demand ≤ 1,500 × 0.154 ≈ 230 connections, within the 400 pool. Add a circuit breaker that skips the call (and routes orders to manual review) when error rate or latency spikes. Use a bulkhead: limit concurrent in-flight fraud calls per pod (for example 8) so excess requests fail fast before taking a connection. Set `idle_in_transaction_session_timeout` as a last-resort backstop."
        }
      ],
    },
    {
      id: 'db-connections-locks-boe-3',
      question:
        'A flash-sale SKU row is updated by every order. Each order transaction: UPDATE inventory (lock), INSERT order, INSERT payment_intent, COMMIT. Estimate max orders/s on that SKU, and after restructuring.',
      assumptions: [
        'App↔DB RTT 0.5 ms; each statement ~0.2 ms execution',
        'COMMIT with fsync ~0.6 ms + RTT',
        'Row lock held from the UPDATE until COMMIT completes',
        'Target utilisation ≤ 70% to keep queueing delays small',
      ],
      steps: [
        { label: 'Hold time (UPDATE first)', calc: 'UPDATE 0.7 + INSERT 0.7 + INSERT 0.7 + COMMIT 1.1 ≈ 3.2 ms' },
        { label: 'Ceiling', calc: '1 ÷ 3.2 ms ≈ 310/s; at 70% ≈ 220 orders/s' },
        { label: 'Reorder: UPDATE last', calc: 'INSERTs first (no shared lock), then UPDATE 0.7 + COMMIT 1.1 ≈ 1.8 ms → ~550/s; 70% ≈ 390/s' },
        { label: 'Single statement via CTE', calc: 'WITH upd AS (UPDATE ... RETURNING) INSERT ...: one round trip + commit ≈ 1.3 ms → ~770/s' },
        { label: 'Sharded stock (10 buckets)', calc: '~10 × 770 ≈ 7,700/s theoretical' },
      ],
      answer:
        'About 220–310 orders/s as written; ~400–550/s by taking the lock last; ~770/s with a single-statement CTE; several thousand/s with 10 stock buckets.',
      insight:
        'Hot-row throughput is set by lock hold time, which is dominated by round trips and commit latency, not CPU. Restructure transactions before buying hardware; shard the row when demand exceeds ~1/hold.',
      followUps: [
        {
          "q": "The DB moves to a synchronous replica in another AZ, adding 2 ms to every COMMIT. Redo the single-statement CTE ceiling.",
          "a": "The hold time goes from about 1.3 ms to about 3.3 ms (the lock is held until the commit is acknowledged by the sync standby), so the ceiling drops from ~770/s to ~300/s, and to ~210/s at 70% utilisation. Durability costs the hot row directly. Options: keep the 10 buckets, which become essential (about 3,000/s); use `synchronous_commit = local` for the inventory transaction only if losing a reservation on failover is acceptable and reconciled; or batch several orders into one transaction per commit (group commit at the app level)."
        }
      ],
    },
  ],
  test: [
    {
      id: 'db-connections-locks-mcq-01',
      difficulty: 'medium',
      question:
        'A service does 500 req/s per pod, and each request holds a DB connection for 12 ms on average. What is the minimum average number of busy connections per pod, and what pool size is reasonable?',
      options: [
        '500 busy; pool of 500',
        '6 busy; pool of ~10–15 for burst headroom',
        '12 busy; pool of 12',
        '42 busy; pool of 50',
      ],
      correct: [1],
      explanation:
        'Little\'s Law: L = λ × W = 500/s × 0.012 s = 6 connections busy on average. Bursts and variance justify roughly 1.5–2.5× headroom, so ~10–15. 500 confuses requests per second with concurrency. 12 is the hold time in ms, not a concurrency. 42 comes from dividing instead of multiplying.',
      followUps: [
        {
          "q": "A downstream index regression pushes the average hold time from 12 ms to 60 ms at the same 500 req/s. What happens to your pool of 15?",
          "a": "Little's Law now gives 500 × 0.06 = 30 busy connections per pod, double the pool. Requests queue for a connection. Queueing time adds to latency, and with an acquire timeout of around 1 s they start failing. The pool is behaving correctly here: it protects the database from a 5× concurrency spike that would make the slow queries even slower. The right reaction is to fix the query, not to raise the pool to 30 across every pod. Alert on pool waitingCount and acquire-time p99, since that is the first visible signal."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-02',
      difficulty: 'hard',
      question:
        'What happens in production with this code when the "user not found" branch is hit frequently?',
      code: {
        language: 'typescript',
        code: `async function getProfile(id: string) {
  const client = await pool.connect();
  const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [id]);
  if (rows.length === 0) throw new NotFoundException();
  client.release();
  return rows[0];
}`,
      },
      options: [
        'Nothing; the pool reclaims clients automatically when the function throws',
        'Each not-found request leaks a connection; once max is reached, every request waits for connectionTimeoutMillis (or forever) and fails',
        'The query fails because SELECT * is not allowed with parameters',
        'The connection is released after idleTimeoutMillis, so the leak self-heals',
      ],
      correct: [1],
      explanation:
        'The throw skips release(), so the client stays checked out forever — node-postgres does not reclaim it on exceptions. After enough 404s the pool is exhausted and all requests time out waiting for a connection. idleTimeoutMillis applies only to idle clients in the pool, not to checked-out ones. Use try/finally or pool.query() for single statements.',
      followUps: [
        {
          "q": "After the fix, how would you catch the next leak of this kind before it reaches production?",
          "a": "Use three layers. Statically, add a lint rule or code review policy that bans raw `pool.connect()` outside a `withClient`/`tx` helper that releases in `finally`. In tests, assert after each test or suite that `pool.totalCount - pool.idleCount === 0`, which catches leaks on error paths when tests cover the 404 branch. At runtime, export `pool.waitingCount`, checked-out count and acquire latency, and log a stack trace for any client checked out longer than N seconds (a wrapper that records the stack at acquire). In Postgres, `idle_in_transaction_session_timeout` limits the damage when the leak holds a transaction open."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-03',
      difficulty: 'expert',
      question:
        'You switch PgBouncer from session to transaction pooling. Which application behaviours can now break? Select ALL that apply.',
      options: [
        'Running SET search_path = tenant_42 once after connecting, then issuing queries in later transactions',
        'Using pg_advisory_lock() to hold a lock across several transactions in the same session',
        'Running BEGIN; UPDATE ...; UPDATE ...; COMMIT as a transaction',
        'LISTEN on a channel to receive NOTIFY messages',
        'Using SET LOCAL statement_timeout inside a transaction',
      ],
      correct: [0, 1, 3],
      explanation:
        'In transaction mode the server connection is returned to the pool after each transaction, so session-level SET values leak to other clients or vanish, session advisory locks are held on a backend another client may reuse, and LISTEN registrations do not persist on your client\'s next transaction. Multi-statement transactions work fine (that is the unit of pooling), and SET LOCAL is scoped to the transaction, so it is the recommended pattern.',
      followUps: [
        {
          "q": "The tenant-per-schema app relies on `SET search_path` at connect time. How do you keep tenant isolation with transaction pooling without rewriting every query?",
          "a": "Move the setting into each transaction: the request-scoped helper runs `BEGIN; SET LOCAL search_path = tenant_42, public; ...; COMMIT`, so it can't leak to the next client using that backend. Validate the tenant id against an allow-list, because it is interpolated into SQL. Alternatively, use `set_config('search_path', $1, true)` with a bind parameter. Don't rely on PgBouncer's `server_reset_query`, which isn't run in transaction mode. Add a test that interleaves two tenants on a single server connection and asserts there is no cross-read."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-04',
      difficulty: 'hard',
      question:
        'A migration runs ALTER TABLE orders ADD COLUMN note text; it normally takes 5 ms. Today checkout requests pile up and time out right after the migration starts. pg_stat_activity shows the ALTER "waiting" and 300 SELECTs on orders also waiting. What is the cause?',
      options: [
        'Adding a nullable column rewrites the whole table',
        'The ALTER is waiting for ACCESS EXCLUSIVE behind a long-running transaction; new queries queue behind the waiting ALTER',
        'The SELECTs are holding row locks that block the ALTER',
        'PgBouncer blocks all queries during DDL',
      ],
      correct: [1],
      explanation:
        'ALTER TABLE needs ACCESS EXCLUSIVE, which conflicts with the ACCESS SHARE held by some older long transaction, so it waits. Later SELECTs request ACCESS SHARE, which conflicts with the queued ACCESS EXCLUSIVE request, so they queue behind it — the table is effectively offline. Adding a nullable column without a default is metadata-only. Plain SELECTs take no row locks. PgBouncer does not block DDL. Use lock_timeout and retry.',
      followUps: [
        {
          "q": "You add `SET lock_timeout = '3s'` to the migration. It now fails 4 times out of 5 during the day. What next?",
          "a": "Failure is the intended behaviour, since the migration protects checkout. The cause is a long-running transaction holding ACCESS SHARE, so find it in pg_stat_activity (oldest `xact_start`) and fix the source: an analytics query on the primary, a leaked idle-in-transaction session, or a long report. Meanwhile, retry with jittered backoff in a loop and a shorter timeout (around 1 s), which usually finds a gap between transactions. Schedule the remaining retries for a low-traffic window, and set `idle_in_transaction_session_timeout` so leaked sessions can't block future DDL."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-05',
      difficulty: 'expert',
      question:
        'Two workers run this concurrently on a jobs table with 10,000 queued jobs. What is the behaviour?',
      code: {
        language: 'sql',
        code: `BEGIN;
SELECT id, payload FROM jobs
 WHERE status = 'queued'
 ORDER BY created_at
 LIMIT 1
 FOR UPDATE;
-- process the job in application code (~2 s)
UPDATE jobs SET status = 'done' WHERE id = $1;
COMMIT;`,
      },
      options: [
        'Both workers claim different jobs in parallel',
        'Both workers process the same job twice',
        'The second worker blocks on the first worker\'s locked row until it commits, then re-checks it (now done) and returns zero rows or waits again — workers are effectively serialised; SKIP LOCKED and a short claim transaction fix it',
        'The second worker immediately gets an error because the row is locked',
      ],
      correct: [2],
      explanation:
        'Without SKIP LOCKED, the second worker tries to lock the same first row and waits for the first transaction to finish. At READ COMMITTED it then re-evaluates the WHERE on the updated row; it no longer matches, and with LIMIT 1 the query may return no rows even though thousands remain queued — so throughput is serialised and workers see spurious empty polls. The row lock prevents double processing. An immediate error requires NOWAIT. Fix with FOR UPDATE SKIP LOCKED and by committing the claim before processing.',
      followUps: [
        {
          "q": "You switch to SKIP LOCKED with a short claim transaction. A worker claims a job, then the pod is OOM-killed mid-processing. What happens to the job?",
          "a": "The claim committed `status = 'running'`, so the row lock is gone and nobody else will pick it up. The job is stuck. Add a lease: set `locked_until = now() + interval '5 minutes'` (longer than the job's expected runtime) when claiming, and include `OR (status = 'running' AND locked_until < now())` in the claim query so another worker reclaims it after expiry. Long jobs extend the lease with a heartbeat. Processing must be idempotent, because the job can run twice if the original worker was only slow, not dead."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-06',
      difficulty: 'medium',
      question:
        'Two transactions run concurrently. T1: UPDATE account SET ... WHERE id = 1; then UPDATE ... WHERE id = 2. T2: UPDATE ... WHERE id = 2; then UPDATE ... WHERE id = 1. What does Postgres do?',
      options: [
        'Both wait forever until statement_timeout fires',
        'Postgres serialises them automatically so both commit',
        'MVCC lets both proceed because writers do not block writers',
        'After about deadlock_timeout (1 s), the detector finds the cycle and aborts one transaction with SQLSTATE 40P01; the other proceeds',
      ],
      correct: [3],
      explanation:
        'Each holds one row lock and waits for the other: a deadlock. When a lock wait exceeds deadlock_timeout (default 1 s), Postgres checks for cycles and aborts one victim with 40P01, letting the other continue. They do not wait forever (unless the detector somehow did not run, statement_timeout is irrelevant). MVCC removes reader/writer blocking, but writers still block writers on the same row. Postgres does not reorder transactions automatically.',
      followUps: [
        {
          "q": "The two transactions come from a transfer endpoint, `transfer(from, to)`. How do you make this deadlock impossible instead of just retried?",
          "a": "Lock in a canonical order. Before updating, run `SELECT ... FROM account WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`, or update the lower id first, so every transfer acquires locks in ascending id order and no wait cycle can form. Another option is a single statement, `UPDATE account SET balance = balance + CASE ... END WHERE id IN (a, b)`, though Postgres doesn't guarantee the scan order, so the explicit ORDER BY lock is clearer. Keep a 40P01 retry as a safety net, and alert if the deadlock rate is above zero."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-07',
      difficulty: 'expert',
      question:
        'Your DB CPU is only 25%, but API p99 is 6 s and the pool waitingCount is in the hundreds. Which are plausible root causes? Select ALL that apply.',
      options: [
        'Transactions hold connections while awaiting slow external HTTP calls',
        'Many sessions waiting on a lock held by a long transaction or a blocked DDL',
        'A missing index causing CPU-heavy sequential scans',
        'A connection leak on an error path, leaving clients checked out forever',
        'The pool max is set too high, so too many idle connections sit unused in each pod',
      ],
      correct: [0, 1, 3],
      explanation:
        'Low DB CPU with a saturated pool means connections are held but not computing: waiting on external calls made inside transactions, waiting on locks, or leaked and never returned all fit. A missing index causing sequential scans would show up as high DB CPU or I/O, contradicting the 25% CPU. An oversized pool produces idle connections, not hundreds of waiters — waiters mean every pooled connection is checked out.',
      followUps: [
        {
          "q": "Which single query against Postgres would you run first to tell these three causes apart?",
          "a": "Run `SELECT state, wait_event_type, wait_event, count(*), max(now() - xact_start) FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1, 2, 3`. Many `idle in transaction` sessions with old xact_start point to external calls inside transactions or a leak (a leak shows sessions idle for minutes, external calls show sub-second churn). Many `active` sessions with `wait_event_type = 'Lock'` point to a lock queue. Follow up with `pg_blocking_pids(pid)` to find the root blocker."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-08',
      difficulty: 'hard',
      question:
        'Kubernetes HPA scales a service from 10 to 50 pods during a spike. Each pod has a pool with min = 10 (eagerly opened) and max = 30. The DB has max_connections = 800 and 4 other services using 300. What happens?',
      options: [
        'New pods open 500 connections at startup and can grow to 1,500, exceeding the remaining ~500 slots; connection storms and "too many clients" errors follow during the spike',
        'Nothing; pools only open connections when needed, so the DB is never overwhelmed',
        'Kubernetes limits total connections per namespace automatically',
        'Postgres queues extra connection attempts until slots free up',
      ],
      correct: [0],
      explanation:
        '50 pods × min 10 = 500 connections opened eagerly, and up to 50 × 30 = 1,500 under load, against ~500 remaining slots (800 − 300). The spike, when the DB is busiest, becomes a storm of forks and FATAL "too many clients" errors. A min setting opens connections eagerly, so they are not "only when needed". Kubernetes has no connection-aware limits, and Postgres rejects rather than queues connections beyond max_connections.',
      followUps: [
        {
          "q": "You can't deploy PgBouncer this week. What config changes on the app side alone prevent the storm?",
          "a": "Set pool min to 0 so connections open lazily. Cap max per pod so that max HPA replicas × max ≤ the remaining slots, about 500 / 50 = 10, minus headroom, so roughly 8. Set `idleTimeoutMillis` around 10–30 s so idle connections close after the spike. Add `connectionTimeoutMillis` so requests fail fast instead of piling up. Cap HPA maxReplicas at a value the database budget supports, because scaling pods past the DB's capacity adds queueing, not throughput. Then reserve slots per service using `ALTER ROLE ... CONNECTION LIMIT` so one service can't starve the others."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-09',
      difficulty: 'expert',
      question:
        'This code implements a distributed "only one instance runs the scheduler" lock through PgBouncer in transaction mode. What is wrong?',
      code: {
        language: 'typescript',
        code: `const { rows } = await pool.query('SELECT pg_try_advisory_lock(42) AS ok');
if (rows[0].ok) {
  setInterval(runScheduler, 10_000); // leader: keep running
}
// on shutdown:
// await pool.query('SELECT pg_advisory_unlock(42)');`,
      },
      options: [
        'Advisory lock ids must be strings, not integers',
        'Nothing; pg_try_advisory_lock is safe with any pooler',
        'pg_try_advisory_lock blocks forever if another instance holds it',
        'The session lock is taken on whichever server connection ran the query; it stays on that backend (which other clients reuse), the unlock may run on a different backend, and if that backend is recycled leadership is silently lost',
      ],
      correct: [3],
      explanation:
        'Session-level advisory locks belong to a backend session. With transaction pooling, your next statement may use another backend, other clients inherit the lock-holding backend, the unlock may fail silently on a different backend, and a server-connection recycle releases the lock with no signal to the "leader". Use a dedicated direct/session-mode connection held for leadership, or a lease-based lock. The id is a bigint, and the try variant returns false immediately rather than blocking.',
      followUps: [
        {
          "q": "You move leader election to a dedicated session connection. The network between leader and DB partitions for 30 s. What can go wrong?",
          "a": "Postgres eventually notices the dead TCP connection (through tcp_keepalives or a terminated backend) and releases the lock. A second instance acquires it and starts scheduling, but the old leader may not notice the partition yet and keeps running jobs, giving two leaders. Mitigations: have the leader check its connection (`SELECT 1` on the lock connection) before each tick and stop when it fails; set short TCP keepalives on both sides; and make scheduled work idempotent or fenced, for example with a generation number written alongside job claims so stale leaders' writes are rejected."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-10',
      difficulty: 'hard',
      question:
        'Which ordering of statements minimises lock contention on the hot "inventory" row, while keeping the transaction correct?',
      code: {
        language: 'sql',
        code: `-- A
BEGIN; UPDATE inventory SET stock = stock - 1 WHERE sku = $1 AND stock > 0;
       INSERT INTO orders ...; INSERT INTO audit_log ...; COMMIT;
-- B
BEGIN; INSERT INTO orders ...; INSERT INTO audit_log ...;
       UPDATE inventory SET stock = stock - 1 WHERE sku = $1 AND stock > 0; COMMIT;
       -- (roll back if UPDATE affected 0 rows)`,
      },
      options: [
        'B — the hot row lock is acquired last, so it is held only for the UPDATE and COMMIT',
        'A — acquiring the hot lock first prevents deadlocks',
        'They are identical because locks are only taken at COMMIT',
        'Neither is correct without SERIALIZABLE isolation',
      ],
      correct: [0],
      explanation:
        'Row locks are held from acquisition to transaction end, so taking the contended lock as late as possible shortens its hold time and raises the throughput ceiling. The conditional UPDATE keeps correctness at READ COMMITTED; if it affects 0 rows the app rolls back the inserts. Locks are taken when statements execute, not at commit. Deadlock avoidance is about consistent ordering across transactions, not about hot-first ordering.',
      followUps: [
        {
          "q": "Order B is still capped at roughly 500 orders/s on one SKU. Marketing expects 5,000/s in a flash sale. What do you change?",
          "a": "Split the hot row. Spread stock across N bucket rows (sku, bucket, stock). Each order picks a random bucket and decrements with `stock > 0`, retrying another bucket if empty, which multiplies throughput by about N. An alternative is to take stock reservation out of Postgres: an atomic Redis `DECR` admits up to the available stock and the database records orders asynchronously, with reconciliation. Put admission control in front so only buyers who could still get stock reach the DB at all, since 5,000/s for 200 units is mostly rejections."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-11',
      difficulty: 'expert',
      question:
        'Which settings bound the damage a single bad session can do to a shared Postgres? Select ALL that apply.',
      options: [
        'idle_in_transaction_session_timeout — terminates sessions that sit in an open transaction doing nothing',
        'statement_timeout set per role — cancels runaway statements',
        'lock_timeout for migration roles — aborts DDL that would wait behind long transactions',
        'max_connections = 10000 — ensures a bad session never blocks anyone from connecting',
        'shared_buffers = 90% of RAM — prevents slow queries',
      ],
      correct: [0, 1, 2],
      explanation:
        'Idle-in-transaction timeouts release leaked transactions (and their locks and snapshots), statement_timeout caps runaway queries, and lock_timeout prevents a DDL from creating a lock queue that blocks everyone. Raising max_connections to 10,000 increases memory and contention risks rather than bounding damage. shared_buffers at 90% of RAM starves the OS cache and work_mem; it is not a safety limit.',
      followUps: [
        {
          "q": "You set `statement_timeout = 5s` globally. The nightly reporting job and the migration tool start failing. How do you scope these timeouts correctly?",
          "a": "Set them per role, not globally. Run `ALTER ROLE api SET statement_timeout = '2s'`, `ALTER ROLE reporting SET statement_timeout = '30min'`, and give the migrator a short `lock_timeout` but no statement timeout, or raise it with `SET LOCAL` for known long backfills. Each service connects as its own role, so limits match the workload. With PgBouncer in transaction mode, role-level settings still apply because they come from the server login role, whereas session `SET` would leak. Document the limits and expose them in dashboards."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-12',
      difficulty: 'medium',
      question:
        'Why does PgBouncer help even though it does not make any individual query faster?',
      options: [
        'It caches query results in memory',
        'It compiles SQL into faster execution plans',
        'It multiplexes many client connections onto a small number of server connections, keeping Postgres near its efficient active-connection count and avoiding per-connection fork and memory costs',
        'It replicates writes to multiple databases',
      ],
      correct: [2],
      explanation:
        'Postgres performs best with a limited number of active backends; PgBouncer lets thousands of app connections share tens of server connections and eliminates connection churn (forking a backend per connection). It does not cache results, plan queries or replicate data — those are the jobs of other components.',
      followUps: [
        {
          "q": "PgBouncer is single-threaded. At 60K queries/s it pins one core at 100%. How do you scale it?",
          "a": "Run several PgBouncer processes. Since 1.12, `so_reuseport` lets multiple instances listen on the same port on one host, and the kernel load-balances connections across them. Alternatively, run PgBouncer as a sidecar per app pod (each handles a small share), but then the server-connection total is pods × pool size, so the DB-side cap is lost. A centralised pool (several instances behind a load balancer, each with a slice of `max_db_connections`) keeps the cap. PgCat and Odyssey are multi-threaded alternatives."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-13',
      difficulty: 'expert',
      question:
        'This retry logic runs after a deadlock error in a NestJS service. What is the problem?',
      code: {
        language: 'typescript',
        code: `async function updateBoth(a: string, b: string) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('UPDATE acct SET v = v + 1 WHERE id = $1', [a]);
    try {
      await c.query('UPDATE acct SET v = v - 1 WHERE id = $1', [b]);
    } catch (e: any) {
      if (e.code === '40P01') {
        await c.query('UPDATE acct SET v = v - 1 WHERE id = $1', [b]); // retry
      }
    }
    await c.query('COMMIT');
  } finally { c.release(); }
}`,
      },
      options: [
        'It is correct; retrying the failed statement resolves the deadlock',
        'It should wait deadlock_timeout before retrying the statement',
        'The deadlock aborted the whole transaction: the retry fails with "current transaction is aborted", COMMIT turns into a rollback silently, and the first update is lost — the entire transaction must be rolled back and re-run (and rows locked in a consistent order)',
        'The retry succeeds but leaves a row lock held after COMMIT',
      ],
      correct: [2],
      explanation:
        'In Postgres, an error aborts the entire transaction; subsequent statements fail with 25P02 until ROLLBACK, and COMMIT on an aborted transaction performs a rollback. Retries must restart from BEGIN. Also sort (a, b) so both updaters lock in the same order to prevent the deadlock. Waiting does not help an aborted transaction, and locks are always released at transaction end.',
      followUps: [
        {
          "q": "Write the shape of a correct retry wrapper. What should it retry, and what must it never retry?",
          "a": "Wrap the whole transaction: `for attempt in 1..5: BEGIN; await fn(client); COMMIT; return` with `catch: ROLLBACK; if code in {40P01, 40001} and attempt < 5 sleep(jitter(attempt)) else throw`. Retry only deadlock (40P01) and serialization failure (40001), plus 55P03 lock timeout if you choose. Never retry constraint violations (23xxx), since they're deterministic. Never retry when the transaction made side effects outside the DB (HTTP calls, emails), because the retry repeats them. `fn` must be re-runnable and should re-read state inside the transaction rather than reuse values from the failed attempt."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-14',
      difficulty: 'hard',
      question:
        'You need to assign one of 200 remaining seats for a concert to each of 10,000 concurrent buyers, without double-assigning and without making buyers wait on each other. Which query pattern fits best?',
      options: [
        'SELECT a free seat, then UPDATE it in a separate transaction',
        'SELECT ... FOR UPDATE on the first free seat ordered by seat number',
        'LOCK TABLE seats IN EXCLUSIVE MODE, then pick a seat',
        'UPDATE seats SET buyer = $1 WHERE id = (SELECT id FROM seats WHERE buyer IS NULL LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id',
      ],
      correct: [3],
      explanation:
        'SKIP LOCKED lets each buyer grab a different free seat without queueing behind others, and the update happens atomically in the same statement. Select-then-update in separate transactions double-assigns. FOR UPDATE without SKIP LOCKED makes every buyer queue on the same first seat. A table lock serialises everyone. (Admission control, e.g. a Redis counter, can additionally stop the other 9,800 buyers from hitting the DB at all.)',
      followUps: [
        {
          "q": "Buyers must choose a specific seat (seat 14C) rather than any free seat. Does SKIP LOCKED still fit?",
          "a": "No. Skipping would silently give the buyer nothing or the wrong seat. Use a conditional update: `UPDATE seats SET buyer = $1, held_until = now() + interval '10 min' WHERE id = '14C' AND (buyer IS NULL OR held_until < now()) RETURNING id`. Zero rows means taken, so tell the user immediately. Use NOWAIT or a short lock_timeout so concurrent clickers on the same seat fail fast instead of queueing. The temporary hold with expiry covers the payment window, and a confirm step converts the hold into a sale."
        }
      ],
    },
    {
      id: 'db-connections-locks-mcq-15',
      difficulty: 'expert',
      question:
        'During an incident, pg_stat_activity shows: 12 active sessions, 390 idle sessions from "orders-api" with state_change 20+ minutes ago, and the app reports pool waiting = 0 but new pods fail to connect with "too many clients". What is the most likely situation?',
      options: [
        'A connection leak — the app holds 390 checked-out connections',
        'A lock queue behind a blocked DDL',
        'Pool explosion — many pods each keep idle pooled connections open (min/idle settings), consuming slots while doing no work; a pooler or smaller per-pod pools/idle timeouts fix it',
        'The database is CPU-saturated',
      ],
      correct: [2],
      explanation:
        'Idle (not idle-in-transaction) sessions with pool waiting = 0 mean existing pods have plenty of free pooled connections — they are simply holding many idle ones. New pods cannot get slots. That is pool sprawl, not a leak (a leak shows waiting > 0 and connections checked out, often idle in transaction). A lock queue would show active sessions waiting on locks. Only 12 active sessions rules out CPU saturation.',
      followUps: [
        {
          "q": "You add PgBouncer but the 390 idle sessions now show up as idle client connections to PgBouncer. Is that still a problem?",
          "a": "Mostly not. Idle client connections to PgBouncer cost a few KB each and use no Postgres backend. Only server connections (`default_pool_size`, capped by `max_db_connections`) count against max_connections. Check that `max_client_conn` exceeds pods × per-pod pool, and that file-descriptor limits (`ulimit -n`) on the PgBouncer host fit. Use `SHOW POOLS` to confirm `sv_active` stays small and `cl_waiting` near zero. App-side pools can still shrink, which reduces PgBouncer load and failover reconnect storms."
        }
      ],
    },
  ],
};

export default topic;
