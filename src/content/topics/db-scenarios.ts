import type { Topic } from '../../types';

const topic: Topic = {
  id: 'db-scenarios',
  phase: 'databases',
  order: 6,
  title: 'Database Firefighting: Six Production Scenarios',
  subtitle:
    'An on-call playbook: symptoms → diagnosis (real Postgres/MySQL queries and metrics) → fixes in order of cost, for the six database incidents interviewers love to ask about.',
  estimatedMinutes: 90,
  sources: [
    'PostgreSQL docs — Monitoring Database Activity, pg_stat_statements, Hot Standby',
    'MySQL 8.0 Reference Manual — Performance Schema, sys schema, Replication',
    'Alex Xu — System Design Interview Vol 2 (Ch 5 Metrics Monitoring)',
    'Brendan Gregg — USE Method',
  ],
  tags: ['incident-response', 'postgres', 'mysql', 'pg_stat_statements', 'connections', 'replication-lag', 'performance', 'on-call'],
  cheatSheet: [
    'Triage order: stop the bleeding (shed load, kill runaway query, roll back deploy) → diagnose → fix. Mitigation before root cause.',
    'First 5 minutes: what changed (deploy, traffic, data volume, plan, cron)? USE per resource: CPU, IO, memory, connections, locks, replication.',
    'pg_stat_statements ordered by total_exec_time finds what is costing the DB; mean_exec_time finds what is slow per call. Different lists — check both.',
    'pg_stat_activity + wait_event_type tells you WHY sessions wait: CPU (null), IO, Lock, LWLock, Client, IdleInTransaction.',
    'Fix cost ladder: query/index fix → config (work_mem, pool) → caching → read replicas → partitioning/archival → vertical scale → sharding.',
    'Connections: Postgres backend = a process (~5–10 MB+). Pool at the app (small), multiplex with PgBouncer transaction mode, set idle_in_transaction_session_timeout.',
    '500M+ rows: keyset not OFFSET, reltuples not count(*), partial/covering/BRIN indexes, partition by time, archive cold rows, pre-aggregate.',
    'One shard hot: hot key (one row — cache/salt/batch) vs hot shard (many keys — move logical shards, isolate tenant). Compare per-shard and top-key metrics.',
    'Replica lag: bytes (pg_wal_lsn_diff) and time (replay_lag). Causes: write bursts, single-threaded apply, replica IO, query conflicts, long transactions. Throttle batch jobs on lag.',
    'Always leave a guardrail after the incident: statement_timeout, alert, lint rule, load test, runbook entry.',
  ],
  sections: [
    {
      heading: 'The triage loop: how senior engineers approach any DB incident',
      body: `**Intuition:** a doctor in the ER stabilises the patient before running the full diagnostic panel. On-call is the same — mitigate first, then find root cause, then prevent recurrence.

**Step 0 — Stop the bleeding (minutes):** roll back the last deploy/migration, disable the feature flag, shed non-critical traffic (batch jobs, analytics, crawlers), kill the obvious runaway query, fail reads over to replicas or cache. Communicate in the incident channel.

**Step 1 — What changed?** Most incidents are caused by a change: deploy, schema migration, new index/dropped index, traffic spike (marketing push, bot), data crossing a threshold (a table that no longer fits in RAM), a cron job, autovacuum/ANALYZE flipping a plan, a cloud maintenance event.

**Step 2 — USE method per resource** (Utilisation, Saturation, Errors):

| Resource | Utilisation | Saturation | Errors |
|---|---|---|---|
| CPU | % busy | run-queue / load avg > cores | — |
| Disk IO | IOPS / throughput vs limit | queue depth, await ms, cloud burst balance | IO errors |
| Memory | buffer cache hit ratio | swap, OOM kills | OOM |
| Connections | active / max_connections | clients waiting for pool | "too many connections" |
| Locks | lock waits | blocked session chains | deadlocks, lock timeouts |
| Replication | lag bytes / seconds | WAL retained by slots | replication broken |

**Step 3 — Find the queries.** \`pg_stat_statements\` / MySQL \`performance_schema\` digests show which *normalised* statements cost the most. \`pg_stat_activity\` / \`SHOW PROCESSLIST\` show what is running *right now* and what it waits on.

**Step 4 — Fix in order of cost** (the ladder in the diagram), then **prevent**: timeouts, alerts, CI checks on query plans, load tests, a runbook entry. In interviews, narrating this loop in order *is* the answer interviewers score.`,
      diagram: `SYMPTOM (p99 up, errors, CPU, lag)
   │
   ▼
MITIGATE ── rollback / flag off / shed load / kill query / failover reads
   │
   ▼
WHAT CHANGED? ── deploy · migration · traffic · data size · plan · cron
   │
   ▼
USE per resource ── CPU · IO · memory · connections · locks · replication
   │
   ▼
TOP QUERIES ── pg_stat_statements · pg_stat_activity · perf_schema
   │
   ▼
FIX (cheapest first)
  query/index → config → cache → replicas → partition/archive → scale up → shard
   │
   ▼
PREVENT ── timeouts · alerts · plan checks in CI · runbook · postmortem`,
      code: [
        {
          language: 'sql',
          title: 'Postgres: the "first look" query — what is running and what is it waiting on?',
          code: `-- Active sessions grouped by state and wait type (run this first)
SELECT state,
       wait_event_type,
       wait_event,
       count(*)                                 AS sessions,
       max(now() - query_start)                 AS longest_running,
       max(now() - xact_start)                  AS longest_txn
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY 1, 2, 3
ORDER BY sessions DESC;

-- wait_event_type NULL + state 'active'  => on CPU
-- 'IO'           => reading from disk (working set > RAM, seq scans)
-- 'Lock'         => blocked on row/table locks (see pg_blocking_pids)
-- 'LWLock'       => internal contention (buffer mapping, WAL insert)
-- 'Client'       => waiting on the app (ClientRead) - app is the bottleneck
-- state 'idle in transaction' => app holding a txn open: locks + vacuum blocked`,
        },
      ],
      keyPoints: [
        'Mitigate before diagnosing; most incidents follow a change.',
        'USE method across CPU, IO, memory, connections, locks and replication.',
        'Narrate the loop in interviews: mitigate → what changed → measure → fix cheapest first → prevent.',
      ],
      source: 'Brendan Gregg — USE Method; PostgreSQL docs — pg_stat_activity',
    },
    {
      heading: 'Scenario 1 — "The database is suddenly slow"',
      body: `**Symptoms:** API p99 jumps from 80 ms to 2 s; DB CPU or IO up; timeouts in app logs; maybe nothing obvious changed.

**Diagnosis, in order:**
1. **Monitoring** — correlate the start time with deploys, traffic, and DB metrics (CPU, read IOPS, buffer hit ratio, connections, lock waits). Is it every query (resource saturation) or specific endpoints (a bad query)?
2. **Slow queries** — \`pg_stat_statements\` ordered by \`total_exec_time\` (reset stats or diff two snapshots to see *now*, not since last month); MySQL \`events_statements_summary_by_digest\` or the slow query log (\`long_query_time = 0.5\`).
3. **Plans** — \`EXPLAIN (ANALYZE, BUFFERS)\` on the worst query. Look for Seq Scan on big tables, estimated vs actual row mismatch (stale stats → run \`ANALYZE\`), Nested Loop over millions of rows, sorts spilling to disk (\`Sort Method: external merge\`).
4. **Locks** — blocked chains from a migration or a long transaction (\`pg_blocking_pids\`).

**Fixes, cheapest first:**
1. **Indexes** — composite index matching WHERE + ORDER BY (\`CREATE INDEX CONCURRENTLY\` — never lock a hot table in production).
2. **Query optimisation** — remove N+1 (batch with \`WHERE id = ANY($1)\`), select only needed columns, keyset pagination, avoid functions on indexed columns (\`WHERE lower(email) = ...\` needs an expression index).
3. **Caching** — cache hot, read-mostly results (Redis, TTL + invalidation) so repeated reads never hit the DB.
4. **Read replicas** — route read-heavy, lag-tolerant endpoints to replicas.
5. **Scale up / partition / shard** — only if the workload genuinely exceeds one node after 1–4.

**Classic root causes:** a new endpoint without an index; a table crossing the RAM boundary (hit ratio drops from 99.9% to 95% → 50× more disk reads); a plan flip after ANALYZE; a migration holding an ACCESS EXCLUSIVE lock; an ORM change that introduced N+1.`,
      code: [
        {
          language: 'sql',
          title: 'Postgres: top queries by total time, with cache hit ratio per query',
          code: `-- Requires: shared_preload_libraries = 'pg_stat_statements'; CREATE EXTENSION pg_stat_statements;
-- Column names are PG 13+ (total_exec_time / mean_exec_time)
SELECT left(query, 80)                                   AS query,
       calls,
       round(total_exec_time::numeric / 1000, 1)         AS total_s,
       round(mean_exec_time::numeric, 2)                 AS mean_ms,
       round(100.0 * total_exec_time
             / sum(total_exec_time) OVER (), 1)          AS pct_of_db_time,
       rows / NULLIF(calls, 0)                           AS rows_per_call,
       round(100.0 * shared_blks_hit
             / NULLIF(shared_blks_hit + shared_blks_read, 0), 2) AS cache_hit_pct
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 15;

-- To see what is expensive NOW: SELECT pg_stat_statements_reset(); wait 5 min; rerun.

-- Then, for the top offender:
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20;

-- Fix without blocking writes:
CREATE INDEX CONCURRENTLY idx_orders_customer_created
  ON orders (customer_id, created_at DESC);`,
        },
        {
          language: 'sql',
          title: 'MySQL 8: top statement digests and full-table-scan offenders',
          code: `-- Timers are in picoseconds: divide by 1e12 for seconds
SELECT LEFT(DIGEST_TEXT, 80)                 AS query,
       COUNT_STAR                            AS calls,
       ROUND(SUM_TIMER_WAIT / 1e12, 1)       AS total_s,
       ROUND(AVG_TIMER_WAIT / 1e9, 2)        AS avg_ms,
       SUM_ROWS_EXAMINED / COUNT_STAR        AS rows_examined_per_call,
       SUM_NO_INDEX_USED                     AS no_index_used
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 15;

-- Statements doing full scans (sys schema ships with MySQL 5.7+)
SELECT query, exec_count, no_index_used_count, rows_examined_avg
FROM sys.statements_with_full_table_scans
ORDER BY no_index_used_count DESC LIMIT 10;

-- Plan with real timings (MySQL 8.0.18+)
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20;`,
        },
      ],
      keyPoints: [
        'Correlate with changes, then find top statements by total time, then read the plan.',
        'Estimated vs actual rows mismatch in EXPLAIN ANALYZE = stale statistics → ANALYZE.',
        'Ladder: index → query rewrite → cache → replicas → partition/scale → shard.',
      ],
    },
    {
      heading: 'Scenario 2 — "DB CPU is pinned at 90–100%"',
      body: `**Intuition:** high CPU on a database almost always means it is doing too much work per query (scanning, sorting, hashing) or too many queries — rarely "the box is too small".

**Symptoms:** CPU 90–100%, run queue > vCPU count, latency up across *all* queries (everything waits for CPU), connection count climbing because queries take longer.

**Diagnosis:**
1. **Profile by statement** — \`pg_stat_statements\` by \`total_exec_time\`: usually 1–3 statements account for > 50% of DB time. Check \`rows_per_call\` and \`shared_blks_hit\` per call: a query touching 50K buffers per call is scanning in memory — CPU-bound, not IO-bound (cache hit ratio can be 100% and CPU still pinned!).
2. **Read/write ratio** — compare \`xact_commit\`, \`tup_returned\` vs \`tup_fetched\` vs \`tup_inserted/updated\` in \`pg_stat_database\`. \`tup_returned\` ≫ \`tup_fetched\` means lots of rows scanned vs fetched via index → sequential scans. Read-heavy CPU → indexes, caching, replicas. Write-heavy CPU → index count per table, trigger cost, batching.
3. **Sequential scans** — \`pg_stat_user_tables\` where \`seq_scan\` and \`seq_tup_read\` are huge on a big table.
4. **Query rate change** — did \`calls\` for a statement jump 10×? That's an app-side problem (retry storm, missing cache, N+1 loop, cache stampede after a Redis flush).
5. **Non-query CPU** — autovacuum workers, many connections doing auth/SSL handshakes (connection churn without pooling), \`LWLock\` contention.

**Fixes, cheapest first:**
- Kill or cancel the runaway query (\`pg_cancel_backend(pid)\`; \`pg_terminate_backend\` if cancel fails).
- Add the missing index; rewrite the query (the plan for one bad query often costs 90% of CPU).
- Fix app-side amplification: N+1s, retry storms (add jittered backoff), stampedes (single-flight).
- Set \`statement_timeout\` per role so one bad query can't monopolise CPU again.
- Move analytic/reporting queries to a replica or warehouse.
- Only then: scale up vCPUs or add replicas.`,
      code: [
        {
          language: 'sql',
          title: 'Postgres: read/write profile and sequential scan hunters',
          code: `-- Read vs write profile for the database (compare two snapshots a minute apart)
SELECT datname,
       xact_commit, xact_rollback,
       tup_returned,   -- rows read by scans (seq + index)
       tup_fetched,    -- rows fetched via index scans
       tup_inserted, tup_updated, tup_deleted,
       round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_pct
FROM pg_stat_database
WHERE datname = current_database();

-- Tables being sequentially scanned a lot (candidates for indexes)
SELECT relname,
       seq_scan, seq_tup_read,
       idx_scan,
       seq_tup_read / NULLIF(seq_scan, 0) AS avg_rows_per_seq_scan,
       n_live_tup
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC
LIMIT 10;

-- Currently running queries sorted by runtime; cancel the worst
SELECT pid, now() - query_start AS runtime, usename, left(query, 100) AS query
FROM pg_stat_activity
WHERE state = 'active' AND backend_type = 'client backend'
ORDER BY runtime DESC
LIMIT 10;
-- SELECT pg_cancel_backend(12345);      -- polite: cancels the query
-- SELECT pg_terminate_backend(12345);   -- kills the backend (rolls back its txn)

-- Guardrail so it can't happen again for the API role
ALTER ROLE api_user SET statement_timeout = '3s';`,
        },
      ],
      keyPoints: [
        'High CPU with 100% cache hit ratio = in-memory scans; indexes, not RAM, fix it.',
        'Check if calls per statement jumped: app-side amplification (N+1, retries, stampede).',
        'Cancel runaway queries, add statement_timeout per role, move analytics off the primary.',
      ],
    },
    {
      heading: 'Scenario 3 — "Connections exhausted"',
      body: `**Symptoms:** Postgres \`FATAL: sorry, too many clients already\` or \`remaining connection slots are reserved for non-replication superuser connections\`; MySQL \`ERROR 1040: Too many connections\`; app logs show pool acquire timeouts ("timeout exceeded when trying to connect"); often right after scaling out pods or during a latency spike.

**Why it happens:** Postgres forks **one OS process per connection** (default \`max_connections = 100\`); each costs several MB (more with large \`work_mem\` sorts), and thousands of mostly idle connections hurt snapshot/transaction bookkeeping. MySQL uses a thread per connection (default \`max_connections = 151\`). Common causes:
1. **Multiplication:** 60 pods × 4 Node workers × pool max 20 = 4,800 potential connections.
2. **Slow queries hold connections longer** (Little's law: connections in use = QPS × query time). 2K QPS × 5 ms = 10 connections; the same traffic at 500 ms = 1,000.
3. **Leaks:** \`pool.connect()\` without \`release()\` on the error path; transactions left open (**idle in transaction**).
4. **Connection churn:** serverless/lambdas opening a connection per invocation.

**Diagnosis:** count connections by state, application and client address; find idle-in-transaction sessions and their age; check app pool metrics (in-use, waiting, acquire time).

**Fixes, cheapest first:**
- Kill idle-in-transaction sessions; set \`idle_in_transaction_session_timeout\` (e.g. 30 s) and \`idle_session_timeout\` for stray clients.
- Fix leaks (always release in \`finally\`), add pool \`connectionTimeoutMillis\` and query timeouts.
- **Right-size app pools** — small per pod (5–10). The DB can only execute ≈ cores × 2–4 queries concurrently anyway.
- **PgBouncer / RDS Proxy in transaction mode**: thousands of client connections multiplexed onto ~50–200 server connections. Caveat: session state (session-level \`SET\`, advisory locks, \`LISTEN\`, and — for older PgBouncer versions — named prepared statements; PgBouncer 1.21+ supports protocol-level prepared statements) doesn't survive across transactions.
- Raise \`max_connections\` only modestly and only with memory headroom — it is rarely the fix.`,
      code: [
        {
          language: 'sql',
          title: 'Who holds the connections? (Postgres + MySQL)',
          code: `-- Postgres: connections by application, state and client
SELECT application_name, client_addr, state, count(*) AS conns,
       max(now() - state_change) AS longest_in_state
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY 1, 2, 3
ORDER BY conns DESC;

SHOW max_connections;
SELECT count(*) FROM pg_stat_activity;   -- compare with max_connections

-- Idle-in-transaction sessions: hold locks and block vacuum
SELECT pid, usename, application_name, now() - xact_start AS txn_age, left(query, 80) AS last_query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
ORDER BY txn_age DESC;

-- Terminate those older than 5 minutes (mitigation), then set a guardrail
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE state = 'idle in transaction' AND now() - xact_start > interval '5 minutes';
ALTER SYSTEM SET idle_in_transaction_session_timeout = '30s';
SELECT pg_reload_conf();

-- MySQL equivalents
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Max_used_connections';
SELECT user, host, command, COUNT(*) AS conns, MAX(time) AS max_secs
FROM information_schema.processlist GROUP BY user, host, command ORDER BY conns DESC;`,
        },
        {
          language: 'text',
          title: 'pgbouncer.ini — transaction pooling in front of Postgres',
          code: `[databases]
app = host=10.0.1.10 port=5432 dbname=app

[pgbouncer]
listen_port = 6432
pool_mode = transaction        ; server conn returned after each COMMIT/ROLLBACK
max_client_conn = 5000         ; app pods can open many cheap client conns
default_pool_size = 60         ; real Postgres backends per db/user pair
reserve_pool_size = 10         ; burst headroom
reserve_pool_timeout = 2       ; seconds a client waits before reserve is used
server_idle_timeout = 60
query_wait_timeout = 10        ; fail fast instead of queueing forever
max_prepared_statements = 200  ; PgBouncer 1.21+: protocol-level prepared stmts`,
        },
      ],
      keyPoints: [
        'Connections in use = QPS × latency: slow queries exhaust pools before traffic does.',
        'Pods × workers × pool max must stay well below max_connections; use PgBouncer for multiplexing.',
        'idle in transaction is a bug: kill, then enforce idle_in_transaction_session_timeout.',
      ],
    },
    {
      heading: 'Scenario 4 — "A table has 500M+ rows and everything on it is slow"',
      body: `**Intuition:** at half a billion rows, anything that touches "all rows" is a disaster, and even indexes get big enough to fall out of memory. The job is to make every query touch a tiny slice.

**Symptoms:** list endpoints and admin pages time out; \`SELECT count(*)\` takes minutes; deep pagination (\`OFFSET 100000\`) is slow; index builds and VACUUM take hours; the table's indexes no longer fit in RAM.

**Diagnosis:**
- Table and index sizes (\`pg_total_relation_size\`, \`pg_indexes_size\`) vs RAM. A 500M-row table at 200 B/row ≈ 100 GB heap; each bigint B-tree index ≈ 10–15 GB.
- Unused and duplicate indexes (\`pg_stat_user_indexes.idx_scan = 0\`) — they cost write throughput and RAM.
- Bloat / dead tuples (\`n_dead_tup\`, last autovacuum) — frequent updates on a huge table can leave autovacuum hopelessly behind with default settings (\`autovacuum_vacuum_scale_factor = 0.2\` means 100M dead rows before a vacuum triggers!).
- Query shapes: OFFSET pagination, count(*), unbounded date ranges, ORDER BY a non-indexed column.

**Fixes, cheapest first:**
1. **Keyset pagination**: \`WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 50\` — constant cost per page regardless of depth.
2. **Approximate counts**: \`reltuples\` from \`pg_class\` (updated by VACUUM/ANALYZE), or a maintained counter table; show "10,000+" in the UI.
3. **Right indexes**: composite matching filter + sort, **partial** indexes for hot subsets (\`WHERE status = 'PENDING'\` — maybe 0.1% of rows), **covering** indexes (\`INCLUDE\`) for index-only scans, **BRIN** for append-only time columns (kilobytes instead of GBs). Drop unused ones.
4. **Per-table autovacuum tuning**: \`autovacuum_vacuum_scale_factor = 0.01\` or a fixed threshold for the big table.
5. **Pre-aggregate**: summary tables or materialized views (refreshed \`CONCURRENTLY\`) for dashboards; push analytics to ClickHouse/warehouse via CDC.
6. **Partition by time** and **archive** cold data (e.g. keep 90 days hot; older to S3/Parquet or a cheaper table).
7. **Shard** only if write throughput or size still exceeds one node (see *db-sharding*).`,
      code: [
        {
          language: 'sql',
          title: 'Postgres: size, unused indexes, approximate count, keyset page, BRIN',
          code: `-- How big is it really?
SELECT pg_size_pretty(pg_relation_size('events'))       AS heap,
       pg_size_pretty(pg_indexes_size('events'))        AS indexes,
       pg_size_pretty(pg_total_relation_size('events')) AS total;

-- Indexes never used since stats reset (check replicas too before dropping!)
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size, idx_scan
FROM pg_stat_user_indexes
WHERE relname = 'events' AND idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;

-- Instant approximate row count instead of a multi-minute count(*)
SELECT reltuples::bigint AS approx_rows FROM pg_class WHERE oid = 'events'::regclass;

-- Keyset pagination: cost is the same for page 1 and page 10,000
SELECT id, created_at, type
FROM events
WHERE account_id = $1 AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 50;
-- supported by: CREATE INDEX CONCURRENTLY ON events (account_id, created_at DESC, id DESC);

-- Partial index: only the 0.1% of rows the worker polls
CREATE INDEX CONCURRENTLY idx_events_pending ON events (created_at) WHERE status = 'PENDING';

-- BRIN for append-only time column: tiny, great for time-range scans
CREATE INDEX CONCURRENTLY idx_events_created_brin ON events USING brin (created_at);

-- Vacuum this table far more eagerly than the global default (0.2)
ALTER TABLE events SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_cost_limit = 2000);`,
        },
      ],
      keyPoints: [
        'Make each query touch a tiny slice: keyset pagination, partial/covering/BRIN indexes.',
        'Replace count(*) with reltuples or counters; replace ad-hoc aggregation with summary tables.',
        'Tune autovacuum per big table; partition by time and archive cold rows.',
      ],
    },
    {
      heading: 'Scenario 5 — "One shard is overloaded"',
      body: `**Symptoms:** shard 7 of 32 at 95% CPU and p99 10× the others; errors only for a subset of users/tenants; cluster-wide averages look fine (which is why per-shard dashboards matter).

**Diagnosis — hot key or hot shard?**
1. **Per-shard metrics** — QPS, CPU, p99, rows written, storage per shard. Is shard 7 bigger (data skew) or just busier (traffic skew)?
2. **Top statements on that shard** — \`pg_stat_statements\` on shard 7 vs a healthy shard. Same statements but 10× the calls → traffic skew. A statement that exists only on shard 7 → one tenant's workload (a new integration, a bulk import, a scraper).
3. **Top keys** — group recent queries/log lines by shard key (tenant_id, user_id). If one key is > 20–30% of the shard's load it is a **hot key**; if load is spread across many keys that happen to share the shard, it's a **hot shard**.
4. **Row-lock contention** — many sessions in \`wait_event_type = 'Lock'\` on the same row (counters, inventory for a flash-sale SKU) = hot key.

**Mitigation (minutes):** rate-limit or queue the offending tenant/key at the API gateway; move its read traffic to replicas or cache; pause its batch jobs.

**Fixes:**
| Cause | Fix |
|---|---|
| Hot key: read-heavy | Cache with single-flight; replica reads |
| Hot key: write-heavy counter | Salted sub-counters, batch/stream aggregation |
| Hot key: inventory contention | Pre-allocate stock into buckets, reserve via Redis/Lua, queue orders |
| Whale tenant | Directory override → dedicated shard; per-tenant quotas |
| Hot shard (many keys) | Move some logical shards to a new/idle node; rebalance by load, not by row count |
| Range sharding tail hotspot | Split the hot range; hash-prefix monotonic keys |

**Prevent:** per-shard SLO alerts (\`max by shard\` not \`avg\`), per-tenant rate limits, top-K key tracking in the router, and a practiced "move logical shard" runbook.`,
      code: [
        {
          language: 'sql',
          title: 'Find the hot key on the overloaded shard',
          code: `-- 1) Rows locked-waited on the same object/row: hot-row contention
SELECT a.pid,
       pg_blocking_pids(a.pid)            AS blocked_by,
       now() - a.query_start              AS waiting_for,
       left(a.query, 80)                  AS query
FROM pg_stat_activity a
WHERE a.wait_event_type = 'Lock'
ORDER BY waiting_for DESC
LIMIT 20;

-- 2) Which tenants wrote the most in the last 10 minutes on this shard?
--    (requires updated_at; use the audit/outbox table if you have one)
SELECT tenant_id, count(*) AS writes_10m
FROM orders
WHERE updated_at > now() - interval '10 minutes'
GROUP BY tenant_id
ORDER BY writes_10m DESC
LIMIT 10;

-- 3) Per-table write activity on this shard vs a healthy shard
SELECT relname, n_tup_ins, n_tup_upd, n_tup_hot_upd, n_tup_del
FROM pg_stat_user_tables
ORDER BY n_tup_upd + n_tup_ins DESC
LIMIT 10;`,
        },
        {
          language: 'typescript',
          title: 'Emergency per-tenant throttle in the NestJS API (Redis fixed window)',
          code: `import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import Redis from 'ioredis';

// Flip a tenant into "throttled" without a deploy: SET throttle:tenant:<id> <limit_per_sec>
@Injectable()
export class TenantThrottleGuard implements CanActivate {
  constructor(private readonly redis: Redis) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const tenantId: string | undefined = req.user?.tenantId;
    if (!tenantId) return true;

    const limit = await this.redis.get('throttle:tenant:' + tenantId);
    if (!limit) return true; // not throttled: zero extra cost beyond one GET

    const windowKey = 'rl:' + tenantId + ':' + Math.floor(Date.now() / 1000);
    const [[, count]] = (await this.redis.multi().incr(windowKey).expire(windowKey, 2).exec()) as [[null, number]];
    if (count > Number(limit)) {
      // 429 + Retry-After: well-behaved clients back off instead of retrying hot
      throw new HttpException({ message: 'tenant throttled', retryAfter: 1 }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}`,
        },
      ],
      keyPoints: [
        'Always alert on max per shard, not the cluster average.',
        'Hot key → cache/salt/batch/queue; hot shard → move logical shards or isolate the tenant.',
        'Mitigate first by throttling the offending tenant/key at the edge.',
      ],
    },
    {
      heading: 'Scenario 6 — "Replication lag keeps increasing"',
      body: `**Intuition:** a replica replays the primary's change log. If the primary produces changes faster than the replica can apply them — or the replica is told to pause — the gap grows. Users then read stale data ("I paid but my order says unpaid").

**Symptoms:** \`replay_lag\` / \`Seconds_Behind_Source\` growing linearly; read-after-write bugs; stale dashboards; in Postgres, primary disk filling with retained WAL if a slot is behind.

**Diagnosis:**
1. **Measure in bytes and seconds** on the primary: \`pg_stat_replication\` (\`write_lag\`, \`flush_lag\`, \`replay_lag\`, LSN diff). Which stage lags? *sent* behind → network/primary; *flush* behind → replica disk; *replay* behind → apply is slow or paused.
2. **Write burst on the primary?** WAL generation rate (\`pg_current_wal_lsn()\` delta per minute). A backfill, bulk UPDATE, index build, or a large migration can generate 10–50× normal WAL.
3. **Replica apply conflicts (Postgres):** a long-running query on the replica conflicts with vacuum cleanup; with \`max_standby_streaming_delay = 30s\` (default) replay *pauses* up to 30 s before cancelling the query; setting it to \`-1\` means replay can pause indefinitely. \`pg_stat_database_conflicts\` shows cancellations.
4. **Single-threaded apply (MySQL):** a huge single transaction (e.g. \`DELETE\` of 50M rows) replays serially as one event after it commits on the source; enable parallel apply (\`replica_parallel_workers\`, \`replica_parallel_type = LOGICAL_CLOCK\`, writeset-based dependency tracking).
5. **Replica resources:** smaller instance than primary, IO throttled (cloud burst credits exhausted), noisy analytics queries.
6. **Logical replication slots / CDC consumers** stalled → WAL piles up on the primary (\`pg_replication_slots\`).

**Fixes, cheapest first:**
- Pause/throttle the batch job; rewrite it as small batches that **wait on replica lag** (see code challenge).
- Kill long-running replica queries; move analytics to a dedicated replica with \`hot_standby_feedback = on\` (costs bloat on primary) or to a warehouse.
- Size replicas like the primary (IO especially); enable MySQL parallel replication.
- Make the app lag-aware: read-your-writes by routing a user's reads to the primary for N seconds after a write, or wait until the replica's replay LSN ≥ the write's LSN.
- Alert on lag bytes and seconds; alert on inactive slots and \`max_slot_wal_keep_size\`.`,
      code: [
        {
          language: 'sql',
          title: 'Postgres + MySQL: measure replication lag and its cause',
          code: `-- PRIMARY: per-replica lag in bytes and time, split by stage
SELECT application_name, client_addr, state,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn))   AS send_lag,
       pg_size_pretty(pg_wal_lsn_diff(sent_lsn, flush_lsn))             AS flush_lag_bytes,
       pg_size_pretty(pg_wal_lsn_diff(flush_lsn, replay_lsn))           AS replay_lag_bytes,
       write_lag, flush_lag, replay_lag
FROM pg_stat_replication;

-- PRIMARY: slots retaining WAL (stalled CDC consumer = disk filling)
SELECT slot_name, slot_type, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots ORDER BY pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) DESC;

-- REPLICA: time since last replayed transaction (misleading if the primary is idle)
SELECT now() - pg_last_xact_replay_timestamp() AS replay_delay,
       pg_is_wal_replay_paused()                AS paused;

-- REPLICA: queries cancelled due to recovery conflicts
SELECT datname, confl_snapshot, confl_lock, confl_bufferpin FROM pg_stat_database_conflicts;

-- MySQL REPLICA (8.0.22+ naming)
SHOW REPLICA STATUS\\G   -- Seconds_Behind_Source, Replica_SQL_Running_State
SELECT @@replica_parallel_workers, @@replica_parallel_type;`,
        },
      ],
      keyPoints: [
        'Split lag into send / flush / replay to locate the bottleneck.',
        'Batch jobs must be throttled on replica lag; one giant transaction lags every replica.',
        'Design reads to be lag-aware (read-your-writes routing), and alert on lag and retained WAL.',
      ],
    },
    {
      heading: 'After the fire: guardrails and the postmortem',
      body: `**Intuition:** an incident you fix once is an incident; an incident that happens again is a process failure. Senior engineers leave a guardrail behind every fix.

**Guardrails by scenario:**

| Scenario | Guardrail |
|---|---|
| Suddenly slow | \`auto_explain\` for queries > 500 ms, plan checks in CI for top queries, index review in migrations, slow-query alert |
| CPU pinned | \`statement_timeout\` per role (API 2–5 s, reports 60 s), query budget per endpoint, stampede protection |
| Connections exhausted | Pool-size budget per service (pods × pool ≤ 70% of pooler capacity), \`idle_in_transaction_session_timeout\`, lint rule "release in finally" |
| 500M rows | Mandatory keyset pagination in API guidelines, retention policy per table at design time, partitioning for append-only tables > 100M rows |
| One shard hot | Alert on max-per-shard, per-tenant quotas, top-K key dashboard, rehearsed shard-move runbook |
| Replication lag | Batch-job framework that throttles on lag, alert on lag + retained WAL, lag-aware read routing |

**Safe migration rules** (the #1 self-inflicted outage): \`CREATE INDEX CONCURRENTLY\`; set \`lock_timeout = '5s'\` before \`ALTER TABLE\` so a DDL waiting on a lock doesn't queue every other query behind it; add columns without volatile defaults on old versions; backfill in batches; use expand/contract for renames; use \`gh-ost\`/\`pt-online-schema-change\` for large MySQL ALTERs.

**Blameless postmortem structure:** timeline (detect → mitigate → resolve with timestamps), impact (users, revenue, SLO budget burned), root cause *and* contributing factors (why detection took 20 min), what went well, action items with owners and dates. Interviewers ask "what did you change afterwards?" — have an answer.`,
      code: [
        {
          language: 'sql',
          title: 'Postgres guardrails worth setting on day one',
          code: `-- Log plans of slow queries automatically (needs auto_explain in session_preload_libraries)
ALTER SYSTEM SET auto_explain.log_min_duration = '500ms';
ALTER SYSTEM SET auto_explain.log_analyze = on;          -- adds overhead; sample in prod
ALTER SYSTEM SET auto_explain.sample_rate = 0.1;

-- Log lock waits longer than deadlock_timeout (1s default)
ALTER SYSTEM SET log_lock_waits = on;

-- Per-role timeouts: interactive API vs reporting
ALTER ROLE api_user    SET statement_timeout = '3s';
ALTER ROLE api_user    SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE report_user SET statement_timeout = '120s';

-- Cap WAL a stalled slot can retain (PG 13+) - slot is invalidated beyond this
ALTER SYSTEM SET max_slot_wal_keep_size = '100GB';
SELECT pg_reload_conf();

-- In every migration script: never wait forever for a lock
SET lock_timeout = '5s';
ALTER TABLE orders ADD COLUMN refunded_at timestamptz;   -- fails fast if blocked; retry later`,
        },
      ],
      keyPoints: [
        'Every fix ships with a guardrail: timeout, alert, CI check, or runbook.',
        'lock_timeout on DDL prevents a migration from queueing all traffic behind it.',
        'Postmortems cover detection time and contributing factors, not just root cause.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'db-scenarios-cc-1',
      title: 'Stop a NestJS service from exhausting Postgres connections',
      context:
        'After scaling the orders service from 10 to 40 pods for a sale, Postgres started rejecting connections ("sorry, too many clients already") and the service entered a crash loop. The repository below is what runs in every pod.',
      task: 'Find every reason this code leaks or over-consumes connections and can hold transactions open, then rewrite it so that connection usage is bounded, failures release resources, slow queries cannot pin the pool, and the pool exposes metrics for alerting.',
      starter: {
        language: 'typescript',
        title: 'orders.repository.ts (starter)',
        code: `import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class OrdersRepository {
  async placeOrder(customerId: string, items: { sku: string; qty: number }[]) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 50 });
    const client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO orders (customer_id, status) VALUES ($1, $2) RETURNING id',
      [customerId, 'NEW']);
    for (const item of items) {
      // call the pricing service for each item while the transaction is open
      const price = await fetch('http://pricing/price/' + item.sku).then((r) => r.json());
      await client.query(
        'INSERT INTO order_items (order_id, sku, qty, price) VALUES ($1,$2,$3,$4)',
        [rows[0].id, item.sku, item.qty, price.amount]);
    }
    await client.query('COMMIT');
    client.release();
    return rows[0].id;
  }
}`,
      },
      hints: [
        'How many pools does each pod create, and how many connections can 40 pods open in the worst case?',
        'What happens to the connection and the open transaction if the pricing call throws or hangs for 30 seconds?',
        'Which work can be moved outside the transaction, and which timeouts (pool acquire, statement, idle-in-transaction) are missing?',
      ],
      solution: {
        language: 'typescript',
        title: 'orders.repository.ts (solution)',
        code: `import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

// ONE pool per process, sized from a budget: 40 pods x 8 = 320 client conns -> PgBouncer (tx mode)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // points at PgBouncer :6432
  max: 8,
  connectionTimeoutMillis: 2_000,   // fail fast instead of queueing forever
  idleTimeoutMillis: 30_000,
  statement_timeout: 3_000,         // server-side per-statement cap
  idle_in_transaction_session_timeout: 10_000,
});

@Injectable()
export class OrdersRepository implements OnModuleDestroy {
  constructor(private readonly pricing: { priceMany(skus: string[]): Promise<Map<string, number>> }) {}

  async placeOrder(customerId: string, items: { sku: string; qty: number }[]): Promise<string> {
    // 1) Slow network I/O happens BEFORE taking a connection / opening a txn
    const prices = await this.pricing.priceMany(items.map((i) => i.sku)); // batched, has its own timeout

    return this.withTransaction(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'INSERT INTO orders (customer_id, status) VALUES ($1, $2) RETURNING id', [customerId, 'NEW']);
      const orderId = rows[0].id;
      // 2) one multi-row insert instead of N round trips
      await c.query(
        'INSERT INTO order_items (order_id, sku, qty, price) ' +
        'SELECT $1, * FROM unnest($2::text[], $3::int[], $4::bigint[])',
        [orderId, items.map((i) => i.sku), items.map((i) => i.qty), items.map((i) => prices.get(i.sku))]);
      return orderId;
    });
  }

  private async withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release(); // ALWAYS returned, even on error
    }
  }

  poolStats() { // export to Prometheus: alert when waitingCount > 0 for 1 min
    return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
  }

  async onModuleDestroy() { await pool.end(); } // graceful shutdown on SIGTERM
}`,
      },
      explanation: `**Fixes:**
- **Pool per request → one pool per process.** The starter created a new pool (up to 50 conns) on every call and never closed it: unbounded connections per pod, multiplied by 40 pods.
- **Budgeted pool size** (8 per pod) behind **PgBouncer** in transaction mode, so 320 client connections map to ~60 real backends.
- **Release in finally + ROLLBACK on error.** The starter leaked the client and left the transaction *idle in transaction* (holding row locks, blocking vacuum) whenever anything threw.
- **No network calls inside a transaction.** Pricing calls moved before BEGIN and batched; the transaction is now milliseconds long, so connections are held briefly (Little's law).
- **Timeouts at every layer:** pool acquire (2 s), statement (3 s), idle-in-transaction (10 s).
- **Single multi-row insert** via \`unnest\` replaces N round trips.
- **Pool metrics** (waiting count) and graceful shutdown so rolling deploys don't strand connections.`,
      followUps: [
        {
          "q": "The pricing service is down entirely. What does your solution do, and is that the right behaviour for checkout?",
          "a": "`priceMany` throws (or hits its timeout) before any connection is taken, so no DB resources are held and the request fails fast with a 5xx or 503. Good for the database. For checkout, add a circuit breaker so failing pricing calls short-circuit in milliseconds instead of waiting for a timeout per request. Optionally use a cached last-known price with a short validity, if the business accepts it, so orders can be placed with the price signed and checked later. Never open the transaction and then wait on pricing."
        },
        {
          "q": "Two retries of the same client request arrive (the client timed out after we committed). How do you stop duplicate orders?",
          "a": "Require an `Idempotency-Key` header and add `idempotency_key text UNIQUE` on orders (scoped per customer). Inside the transaction, `INSERT ... ON CONFLICT (customer_id, idempotency_key) DO NOTHING RETURNING id`. If no row is returned, select the existing order id and return it with the original response. The unique index makes it race-safe under concurrent retries: the second insert waits on the first's row lock, then sees the conflict. Expire keys after ~24 h."
        }
      ],
    },
    {
      id: 'db-scenarios-cc-2',
      title: 'Rewrite a backfill that caused 40 minutes of replica lag',
      context:
        'A developer added `orders.region` and ran the backfill below against a 600M-row table at 2 pm. Replica lag went to 40 minutes, customers saw stale order status, and the primary\'s autovacuum fell far behind. The job must be re-run safely.',
      task: 'Rewrite the backfill so it can run during business hours without replica lag above a few seconds, without long-held locks, and so it can be stopped and resumed at any point.',
      starter: {
        language: 'typescript',
        title: 'backfill-region.ts (starter)',
        code: `import { Pool } from 'pg';

const db = new Pool({ connectionString: process.env.PRIMARY_URL });

async function main() {
  console.log('backfilling region...');
  await db.query(\`
    UPDATE orders o
    SET region = c.region
    FROM customers c
    WHERE c.id = o.customer_id
  \`);
  console.log('done');
}

main();`,
      },
      hints: [
        'One statement = one transaction: what does a 600M-row UPDATE do to WAL volume, row locks and dead tuples before it commits?',
        'How can you split the work into small, independent, resumable chunks using the primary key?',
        'What signal should the job watch between chunks to avoid outrunning the replicas?',
      ],
      solution: {
        language: 'typescript',
        title: 'backfill-region.ts (solution)',
        code: `import { Pool } from 'pg';

const primary = new Pool({ connectionString: process.env.PRIMARY_URL, max: 2 });
const BATCH = 5_000;              // small txns: short locks, bounded WAL per commit
const MAX_LAG_BYTES = 64 * 1024 * 1024; // 64 MB of replay lag = back off
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function replicaLagBytes(): Promise<number> {
  const { rows } = await primary.query(
    'SELECT COALESCE(max(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)), 0)::bigint AS lag ' +
    'FROM pg_stat_replication');
  return Number(rows[0].lag);
}

async function main(): Promise<void> {
  // resumable: checkpoint stored in a table, not in memory
  await primary.query('CREATE TABLE IF NOT EXISTS backfill_progress (job text PRIMARY KEY, last_id bigint NOT NULL)');
  await primary.query("INSERT INTO backfill_progress VALUES ('orders_region', 0) ON CONFLICT DO NOTHING");
  let { rows: [{ last_id: lastId }] } = await primary.query(
    "SELECT last_id FROM backfill_progress WHERE job = 'orders_region'");
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });

  while (!stopping) {
    while ((await replicaLagBytes()) > MAX_LAG_BYTES) await sleep(2_000); // throttle on lag

    const started = Date.now();
    const { rows } = await primary.query(
      'WITH batch AS (' +
      '  SELECT id FROM orders WHERE id > $1 ORDER BY id LIMIT $2' +   // PK range scan
      '), upd AS (' +
      '  UPDATE orders o SET region = c.region FROM batch b, customers c ' +
      '  WHERE o.id = b.id AND c.id = o.customer_id AND o.region IS DISTINCT FROM c.region' + // idempotent, skips done rows
      ') SELECT max(id) AS max_id FROM batch',
      [lastId, BATCH]);
    const maxId = rows[0].max_id;
    if (maxId === null) break; // reached the end

    lastId = maxId;
    await primary.query("UPDATE backfill_progress SET last_id = $1 WHERE job = 'orders_region'", [lastId]);
    const tookMs = Date.now() - started;
    await sleep(Math.max(50, tookMs)); // duty cycle ~50%: leave room for real traffic + vacuum
  }
  await primary.end();
}

main().catch((e) => { console.error(e); process.exit(1); });`,
      },
      explanation: `**What went wrong:** a single 600M-row UPDATE is one transaction: it writes a new tuple version for every row (600M dead tuples for vacuum), generates hundreds of GB of WAL that replicas must replay, holds row locks on every updated row until commit (blocking concurrent order updates), and if it's cancelled at 90% everything rolls back.

**Fixes:**
- **Keyset-batched by primary key** (5K rows per transaction): short locks, bounded WAL per commit, vacuum can reclaim between batches.
- **Throttles on replica lag in bytes** from \`pg_stat_replication\`, plus a ~50% duty cycle so production traffic keeps headroom.
- **Idempotent and resumable:** \`IS DISTINCT FROM\` skips rows already correct, and the checkpoint lives in a table, so the job can be killed (SIGTERM honoured) and restarted anywhere.
- **Tiny pool** (2 connections) so the job can't compete for connections.
- Optionally run it against PgBouncer with a dedicated low-priority user and \`statement_timeout\` per batch.`,
      followUps: [
        {
          "q": "Two copies of the backfill are accidentally started. What happens with your solution, and how do you make it single-instance?",
          "a": "Both read the same `last_id` and update the same batches. `IS DISTINCT FROM` keeps results correct, but rows are locked twice and progress writes interleave, so the work and WAL double. Take a session advisory lock at startup: `SELECT pg_try_advisory_lock(hashtext('orders_region'))`, and exit if it returns false. Use a direct connection (session pooling), because the lock is tied to the session. Or lock the progress row with `SELECT ... FOR UPDATE NOWAIT` in each batch's transaction."
        },
        {
          "q": "How would you verify the backfill is complete and correct before adding `NOT NULL` to region?",
          "a": "Run a verification in chunks, not one big scan: `SELECT count(*) FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.region IS DISTINCT FROM c.region AND o.id BETWEEN $a AND $b`, which should return zero across all ranges. New orders must also get region at write time (app change or a trigger) before you start, or the gap reopens. Then add `CHECK (region IS NOT NULL) NOT VALID`, `VALIDATE` it, and on PG12+ `SET NOT NULL` uses the validated check and skips the full scan."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'db-scenarios-iq-01',
      difficulty: 'hard',
      question:
        'It is 10:05. Checkout p99 went from 80 ms to 2.5 s at 09:50. There was no deploy today. You are on call. Walk me through your first 15 minutes.',
      whatInterviewerLooksFor: [
        'Mitigates before root-causing and communicates',
        'Systematically checks what changed beyond deploys (traffic, data, cron, plans, infra)',
        'Uses concrete tools: pg_stat_activity wait events, pg_stat_statements, EXPLAIN ANALYZE',
        'Distinguishes global saturation from a single bad query',
        'Ends with a guardrail/prevention step',
      ],
      modelAnswer: `### Minutes 0–3: scope and communicate
Declare an incident, one-line status in the channel. Check the dashboards: is it only checkout or every endpoint? Only the DB-backed parts? Error rate vs latency? This tells me if it's a resource saturation (everything slow) or one query (specific endpoints).

### Minutes 3–7: what changed (no deploy ≠ no change)
- Traffic: a marketing email at 09:45? bot traffic? (request rate per endpoint)
- Cron / batch jobs starting at 09:45–09:50 (reports, backfills, a vacuum/reindex).
- Config/infra: a feature flag flipped, cache cluster restart (cold cache → DB stampede), cloud maintenance, storage burst credits exhausted.
- Data/plan: a table crossed a size threshold, autovacuum/auto-analyze ran and flipped a plan.

### Minutes 7–12: look inside the DB
1. \`pg_stat_activity\` grouped by \`state, wait_event_type\`: mostly *Lock* → find the blocker via \`pg_blocking_pids\` (often a migration or long transaction); mostly *IO* → working set/scan problem; *CPU (null)* → expensive query; many *idle in transaction* → app bug.
2. \`pg_stat_statements\` diffed over the last 5 minutes: top statements by total time and whether \`calls\` jumped (amplification) or \`mean_exec_time\` jumped (plan change).
3. \`EXPLAIN (ANALYZE, BUFFERS)\` on the top offender: Seq Scan where there used to be an Index Scan? estimates way off?

### Mitigate as soon as the cause is plausible
- Kill the blocking/runaway query; pause the cron job; turn off the feature flag; re-warm or protect the cache.
- Plan flip → \`ANALYZE table\` or a targeted index; in emergencies, disable the offending code path.
- If saturation from genuine traffic: shed low-priority traffic, route reads to replicas.

### Minutes 12–15 and after
Confirm p99 recovered, keep watching. Then root cause and guardrails: \`statement_timeout\`, an alert on the metric that would have caught it earlier, scheduling batch jobs off-peak with lag/CPU throttles, postmortem with action items.`,
      followUps: [
        {
          q: 'pg_stat_activity shows 300 sessions waiting on Lock, all blocked by one pid that is "idle in transaction". What now?',
          a: 'Terminate that backend (its transaction rolls back), watch the queue drain, then find the code path via application_name/client_addr and fix it; set idle_in_transaction_session_timeout.',
        },
        {
          q: 'You find the plan switched from an index scan to a seq scan after auto-analyze. How do you fix it durably?',
          a: 'Check statistics (n_distinct, correlation, skewed values); raise the column statistics target and ANALYZE, add extended statistics for correlated columns, or add a better composite/partial index. Avoid plan hints as a long-term fix.',
        },
        {
          q: 'Everything looks normal in the DB. Where do you look next?',
          a: 'Between app and DB: pool acquire waits in the app, PgBouncer queue (cl_waiting), network, DNS, TLS handshakes, a downstream dependency called inside a transaction.',
        },
      ],
      pitfalls: [
        'Jumping to "add a read replica" or "scale up" before looking at the queries.',
        'Assuming no deploy means nothing changed.',
        'Spending 15 minutes diagnosing while customers are down instead of mitigating.',
      ],
    },
    {
      id: 'db-scenarios-iq-02',
      difficulty: 'hard',
      question:
        'The primary Postgres is at 98% CPU. Cache hit ratio is 99.9%, IO is idle. The team wants to double the instance size. What do you do instead?',
      whatInterviewerLooksFor: [
        'Understands high hit ratio + high CPU = in-memory scanning, not a hardware limit',
        'Profiles by statement and checks rows/buffers per call',
        'Checks for query-rate amplification from the app',
        'Short-term mitigation and long-term guardrails',
      ],
      modelAnswer: `### Interpretation
99.9% hit ratio with idle IO means the DB isn't waiting on disk — it's burning CPU reading pages that are already in memory. That's the signature of **too much work per query** (sequential or wide index scans, big sorts/hash joins) or **too many queries**. Doubling vCPUs buys maybe a few weeks and costs 2× forever.

### Profile
- \`pg_stat_statements\` ordered by \`total_exec_time\`: typically one to three statements are > 50% of DB time.
- For each: \`calls\`, \`mean_exec_time\`, \`rows / calls\`, and \`shared_blks_hit / calls\`. A query that returns 20 rows but touches 80,000 buffers per call is scanning ~625 MB of pages in memory each time.
- \`pg_stat_user_tables\`: which tables have huge \`seq_tup_read\`.
- Compare \`calls\` with last week: a 10× jump points to app amplification — an N+1 introduced by an ORM change, a retry storm, or a cache that stopped working.

### Mitigate
- Cancel long runners; add \`statement_timeout\` for the API role.
- If amplification: fix/rollback the caller, add single-flight caching.

### Fix
- Composite/partial/covering index for the top query (\`CREATE INDEX CONCURRENTLY\`), verify with \`EXPLAIN (ANALYZE, BUFFERS)\` that buffers per call dropped by orders of magnitude.
- Rewrite: remove \`SELECT *\`, push filters into indexes, avoid functions on indexed columns, replace OFFSET with keyset.
- Move reporting queries to a replica or warehouse.

### When scaling up is right
Only after the top statements are efficient and CPU is still high because of genuine throughput growth — then scale up or add replicas for reads, with a capacity model.`,
      followUps: [
        {
          q: 'After adding the index, CPU drops to 40% but writes got 10% slower. Acceptable?',
          a: 'Usually yes — each index adds write cost; check you dropped unused/duplicate indexes to compensate and that HOT updates are still possible for frequently updated columns.',
        },
        {
          q: 'CPU is high but pg_stat_statements shows nothing dominant. What else burns CPU?',
          a: 'Connection churn (fork + auth + TLS per connection), autovacuum on huge tables, LWLock contention, triggers, and many tiny queries — check backend counts, connection rate, and wait events.',
        },
      ],
      pitfalls: [
        'Blaming hardware when the hit ratio says memory is fine.',
        'Looking only at mean latency, missing a cheap query called 50K times/s.',
        'Creating indexes without CONCURRENTLY on the hot table during the incident.',
      ],
    },
    {
      id: 'db-scenarios-iq-03',
      difficulty: 'medium',
      question:
        'After scaling the API from 20 to 60 pods for a sale, Postgres returns "remaining connection slots are reserved for non-replication superuser connections" and pods start failing health checks. Fix it now, and fix it properly.',
      whatInterviewerLooksFor: [
        'Does the pods × pool arithmetic',
        'Knows why Postgres connections are expensive (process per connection)',
        'Short-term vs long-term fixes (PgBouncer/RDS Proxy)',
        'Uses Little\'s law to right-size pools',
        'Mentions leaks / idle in transaction',
      ],
      modelAnswer: `### Arithmetic first
Each pod runs a pool with max 20: 20 pods × 20 = 400 fit under \`max_connections = 500\`; 60 pods × 20 = 1,200 don't. The error means only the \`superuser_reserved_connections\` slots are left.

### Now (minutes)
- Reduce the per-pod pool max via config (20 → 6) and roll the pods — 60 × 6 = 360.
- Kill idle and idle-in-transaction sessions older than a few minutes.
- Make health checks not open DB connections (liveness should never depend on the DB, or every DB blip restarts every pod).

### Why a smaller pool doesn't hurt
Little's law: in-use connections = QPS × query time. 12K QPS × 3 ms = 36 connections cluster-wide — 6 per pod is plenty. The DB can only run ~cores × 2–4 queries in parallel anyway; more connections just add context switching and memory (Postgres forks a process per connection, several MB each).

### Properly
- **PgBouncer (or RDS Proxy) in transaction mode**: 60 pods × 10 client connections = 600 client conns → ~60–100 server conns. Watch session-state caveats (session \`SET\`, advisory locks, LISTEN/NOTIFY; prepared statements need PgBouncer 1.21+).
- **Connection budget per service** in the platform: pods × pool × replicas-at-max-HPA must stay ≤ ~70% of pooler/server capacity. Enforce in Helm values review.
- **Timeouts**: pool acquire timeout (fail fast), \`statement_timeout\`, \`idle_in_transaction_session_timeout\`.
- **Leak-proof code**: transaction helper that always releases in \`finally\`; no network calls inside transactions.
- Alert on connections > 80% of max and on pool wait counts.`,
      followUps: [
        {
          q: 'Why not just set max_connections = 5000?',
          a: 'Each backend costs memory (plus work_mem per sort per query) and process overhead; thousands of mostly idle backends hurt snapshot acquisition and can OOM the box under load. It trades a clean error for a worse outage.',
        },
        {
          q: 'What breaks when you move from session to transaction pooling?',
          a: 'Anything relying on session state across transactions: SET without LOCAL, temp tables, advisory locks held across statements, LISTEN/NOTIFY, and (on old PgBouncer) named prepared statements.',
        },
      ],
      pitfalls: [
        'Raising max_connections as the fix.',
        'Increasing pool size because requests wait on the pool (makes it worse).',
        'DB-dependent liveness probes causing cascading restarts.',
      ],
    },
    {
      id: 'db-scenarios-iq-04',
      difficulty: 'hard',
      question:
        'An `events` table has 800M rows (~220 GB). The admin "all events" page with filters and page numbers takes 40 s, the total count at the top takes 3 minutes, and vacuum runs for 6 hours. How do you fix it without sharding?',
      whatInterviewerLooksFor: [
        'Identifies OFFSET pagination and exact counts as the root causes of the UI slowness',
        'Uses appropriate index types (composite, partial, BRIN) and verifies with EXPLAIN',
        'Tunes autovacuum per table and understands the default scale factor problem',
        'Proposes partitioning + retention and pre-aggregation',
      ],
      modelAnswer: `### Why it's slow
- **Page numbers = OFFSET.** \`OFFSET 200000 LIMIT 50\` reads and discards 200K rows every time.
- **Exact count(*)** has to visit every visible row (MVCC — Postgres has no stored row count), i.e. scan 220 GB or a large index.
- **Vacuum**: default \`autovacuum_vacuum_scale_factor = 0.2\` waits for 160M dead tuples, then has to scan the whole table.

### UI/API changes (biggest win, cheapest)
- **Keyset pagination**: "Next/Previous" with a cursor \`(created_at, id)\`; each page is an index range scan of 50 rows — milliseconds at any depth.
- **Approximate count**: \`pg_class.reltuples\` or \`EXPLAIN\` row estimate for filtered counts; show "about 812M" or "10,000+". Exact counts only for small filtered sets (cap with \`LIMIT 10001\` inside a subquery).

### Indexes
- Composite index matching common filter + sort: \`(account_id, created_at DESC, id DESC)\`.
- **Partial** index for the operational subset (\`WHERE status = 'FAILED'\`).
- **BRIN** on \`created_at\` for time-range scans (append-only table → excellent correlation, index is a few MB).
- Drop unused indexes (\`idx_scan = 0\` on primary *and* replicas) — they slow writes and vacuum.

### Maintenance
Per-table \`autovacuum_vacuum_scale_factor = 0.01\` (or threshold-based), higher cost limit; monitor \`n_dead_tup\`.

### Structural (still no sharding)
- **Partition by month** (\`PARTITION BY RANGE (created_at)\`): queries with time filters prune to 1–2 partitions; vacuum works per partition; old partitions are frozen once.
- **Retention**: keep 90 days hot, detach older partitions and export to Parquet/S3 for audits.
- **Pre-aggregate** dashboard numbers into a summary table updated incrementally, or ship events via CDC to ClickHouse for ad-hoc analytics.

Expected result: page loads < 50 ms, counts instant, vacuum per partition in minutes.`,
      followUps: [
        {
          q: 'Product insists on "jump to page 500". Options?',
          a: 'Precompute page boundaries (cursor per 1,000th row) periodically, or serve that view from a search engine/OLAP store; never OFFSET deep on the OLTP primary.',
        },
        {
          q: 'How do you convert the existing 800M-row table to partitioned without downtime?',
          a: 'Create the partitioned table, dual-write or trigger-copy new rows, backfill old rows in batches into partitions, verify, then swap names in a short transaction (or attach the old table as a historical partition with a CHECK constraint to skip validation scans).',
        },
      ],
      pitfalls: [
        'Adding more RAM and calling it done.',
        'Suggesting sharding for a read/UI problem.',
        'Running VACUUM FULL on the live table (takes an ACCESS EXCLUSIVE lock for hours).',
      ],
    },
    {
      id: 'db-scenarios-iq-05',
      difficulty: 'expert',
      question:
        'Your orders DB has 32 shards. Shard 7 is at 95% CPU with p99 1.8 s; the other 31 are at ~30%. The cluster-average dashboard looked green, so this was reported by customers. Diagnose and fix.',
      whatInterviewerLooksFor: [
        'Separates hot key from hot shard with evidence',
        'Immediate mitigation targeted at the offender, not the whole cluster',
        'Correct fix per cause (throttle/isolate tenant, salt counters, move logical shards)',
        'Fixes the observability gap (max-per-shard alerts)',
      ],
      modelAnswer: `### Evidence gathering
1. **Compare shard 7 with a healthy shard** using \`pg_stat_statements\`: same statement mix with 3× calls → traffic skew; a statement that only appears on shard 7 → one tenant/feature.
2. **Top shard keys on shard 7**: group the last 10 minutes of writes/queries by \`tenant_id\` (audit table, query logs, or router metrics). If one tenant is 60% of shard 7's load → **whale/hot key**. If load is spread over thousands of tenants → **hot shard** (bad slot mapping or growth).
3. **Lock waits**: many sessions in \`wait_event_type = 'Lock'\` on the same row → hot row (e.g. a merchant-level counter or inventory row).

### Mitigate (minutes)
- Throttle the offending tenant at the gateway (429 + Retry-After), pause its bulk jobs/imports, route its reads to shard 7's replicas or cache.
- Communicate with that customer's account team if it's a legitimate integration.

### Fix by cause
- **Whale tenant**: directory override → move the tenant to a dedicated shard (logical replication of its rows, fence, flip), plus per-tenant quotas going forward.
- **Hot row (counter/inventory)**: move increments to batched/stream aggregation or salted sub-counters; for inventory, split stock into buckets or reserve via Redis Lua and write asynchronously.
- **Hot shard with many keys**: move a few logical shards (slot ranges) off shard 7 to under-utilised nodes; rebalance on CPU/QPS, not row count.

### Fix the detection gap
Averages hide skew: alert on **max(CPU) by shard** and per-shard p99; add a top-K tenant/key panel from the router; SLOs per shard. Also consider **cells** so one whale can't affect other tenants' latency.`,
      followUps: [
        {
          q: 'The whale is 40% of shard 7 but also growing 10%/week. Dedicated shard is enough?',
          a: 'Short term yes; plan to sub-shard that tenant by a second-level key (project/store id) before it outgrows one node, and give it its own capacity plan and quota.',
        },
        {
          q: 'How do you move the tenant without downtime?',
          a: 'Replicate its rows (logical replication filtered by tenant or tool like Vitess MoveTables/Citus isolate), catch up, fence writes for that tenant for seconds, verify counts/checksums, flip the directory entry, keep the old copy for rollback.',
        },
      ],
      pitfalls: [
        'Adding shards cluster-wide when one tenant is the problem.',
        'Scaling shard 7 vertically without understanding the skew.',
        'Leaving the average-only dashboards unchanged.',
      ],
    },
    {
      id: 'db-scenarios-iq-06',
      difficulty: 'hard',
      question:
        'Every night at 01:00, replica lag climbs from 0 to 25 minutes and recovers by 04:00. Last night a user in APAC paid, then saw their order as "unpaid" for 20 minutes and paid again. Investigate and fix.',
      whatInterviewerLooksFor: [
        'Correlates lag with a nightly job and measures lag by stage',
        'Knows the common causes (bulk write bursts, single big transaction, replica conflicts, IO)',
        'Fixes the job (batching, lag-throttling) and the reads (read-your-writes, primary for critical paths)',
        'Notes the double payment requires idempotency, not just less lag',
      ],
      modelAnswer: `### Investigate
- \`pg_stat_replication\` during the window: is \`replay_lag\` growing while \`sent/flush\` are fine? → replay-bound (apply slow or paused). Is \`sent\` lagging? → network/WAL generation.
- WAL generation rate at 01:00: typically a nightly job — a bulk \`UPDATE\`/\`DELETE\` of millions of rows, a \`REINDEX\`, a materialized-view refresh, or an archive/purge — producing 10–50× normal WAL.
- On the replica: long analytics/report queries running at night. With \`max_standby_streaming_delay\` at 30 s (or -1) replay pauses for conflicting queries; check \`pg_stat_database_conflicts\`.
- MySQL variant: one huge transaction replays as a single unit on the replica after it commits on the source; with single-threaded apply everything behind it waits.

### Fix the job
- Break it into small batches (1–10K rows per transaction) keyed by PK, **throttled on replica lag** (pause when lag > N MB or > 5 s), resumable.
- Purges → partitioning with \`DETACH/DROP\` instead of \`DELETE\` (near-zero WAL).
- Move heavy reporting to a dedicated replica (or warehouse) not used by user-facing reads.
- MySQL: enable parallel replication (\`replica_parallel_workers\`, \`LOGICAL_CLOCK\`, writeset dependency tracking).

### Fix the read path
- **Payment/order status after a write must be read-your-writes**: route the user's reads to the primary for a window after they write (session flag/cookie with the commit time), or wait for the replica LSN to pass the write's LSN; or read critical status from the primary always.
- Replicas for lag-tolerant views only (history, recommendations).

### Fix the double payment
Lag exposed it, but the root cause is the payment flow allowing a second charge: the checkout must use an **idempotency key per order** and the payment service must refuse to charge an already-paid order (see *ds-transactions*). Also refund the duplicate and add a reconciliation alert.`,
      followUps: [
        {
          q: 'How do you implement "wait for replica to catch up" in Postgres?',
          a: 'After commit, capture pg_current_wal_lsn() (or the commit LSN); before reading on a replica, check pg_last_wal_replay_lsn() >= that LSN, else wait briefly or fall back to the primary.',
        },
        {
          q: 'Is hot_standby_feedback = on a good fix for replica query cancellations?',
          a: 'It prevents cancellations by telling the primary not to vacuum rows the replica still needs, but long replica queries then cause bloat on the primary. Use it on a dedicated reporting replica with query timeouts.',
        },
      ],
      pitfalls: [
        'Only saying "add more replicas" (every replica has the same lag).',
        'Fixing lag but not the non-idempotent payment path.',
        'Using a lagging replica for post-write reads of money-related state.',
      ],
    },
    {
      id: 'db-scenarios-iq-07',
      difficulty: 'expert',
      question:
        'A query that ran in 4 ms for a year now takes 3 s. Same code, same parameters, no schema change. What happened, and how do you prove it?',
      context: 'Postgres 15, table `shipments` 120M rows, query filters by carrier_id and status and orders by created_at.',
      whatInterviewerLooksFor: [
        'Suspects a plan regression and knows how to capture before/after plans',
        'Understands statistics, skew, correlated columns and generic vs custom plans',
        'Considers data-distribution changes and bloat',
        'Fixes durably (stats, indexes) rather than with hacks',
      ],
      modelAnswer: `### Hypothesis: plan regression
Same SQL, different speed → the planner chose a different plan because its **estimates changed** (auto-analyze ran with a new sample, data distribution shifted) or the **prepared statement switched to a generic plan**.

### Prove it
- \`auto_explain\` logs (if enabled) or pg_stat_statements' mean_exec_time jump date; compare old plan (from logs/staging) with \`EXPLAIN (ANALYZE, BUFFERS)\` now.
- Typical new plan: planner walks the \`created_at\` index in order hoping to find matching carrier+status rows quickly (LIMIT optimisation), but for this carrier matching rows are rare/old, so it scans millions of index entries. Estimated rows 5,000 vs actual 12 is the smoking gun.

### Common root causes
1. **Skew / new distribution**: a new carrier with few rows; the most-common-values list doesn't include it; estimates use averages.
2. **Correlated columns**: planner multiplies selectivities of carrier_id and status as if independent.
3. **Generic plan**: after 5 executions a prepared statement may switch to a generic plan that ignores parameter values; for skewed columns that's bad (\`plan_cache_mode = force_custom_plan\` per role/statement is a fix).
4. **Bloat / stale visibility map**: index-only scans turn into heap fetches if vacuum is behind.

### Fix durably
- \`ALTER TABLE shipments ALTER COLUMN carrier_id SET STATISTICS 1000; ANALYZE shipments;\`
- Extended statistics: \`CREATE STATISTICS s_carrier_status (dependencies, mcv) ON carrier_id, status FROM shipments;\`
- The right index: \`(carrier_id, status, created_at DESC)\` makes the good plan the obvious one regardless of estimates.
- Vacuum tuning if bloat.
- Prevent: plan regression checks in CI for top queries, and alerts on per-statement mean time changes.`,
      followUps: [
        {
          q: 'Could you just use pg_hint_plan to force the old plan?',
          a: 'As an emergency lever, yes, but hints rot as data changes; fix the estimates or provide an index that makes the right plan dominant.',
        },
        {
          q: 'How would you catch this before customers do?',
          a: 'Track mean/p95 exec time per queryid from pg_stat_statements as time series and alert on step changes; enable auto_explain with sampling for slow queries.',
        },
      ],
      pitfalls: [
        'Restarting the database or "clearing caches" as the fix.',
        'Blaming network or app without comparing plans.',
        'Running ANALYZE once and not addressing why estimates were wrong.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'db-scenarios-boe-1',
      question:
        'The payments API will autoscale to 80 pods for a sale. Each pod runs 2 Node processes with a pg pool of max 10. Peak traffic is 16K QPS with 1.5 DB queries per request at 4 ms each. How many connections will be opened, how many are actually needed, and how do you size PgBouncer?',
      assumptions: [
        'Postgres primary: 32 vCPU, max_connections = 400',
        'Pools fill up to max under load (they will, during latency spikes)',
        'Target PgBouncer server pool with headroom of 2× the steady-state need',
        'Latency spike scenario: query time degrades to 40 ms',
      ],
      steps: [
        { label: 'Potential client connections', calc: '80 pods × 2 processes × 10 = 1,600 connections (4× max_connections)' },
        { label: 'DB query rate', calc: '16K req/s × 1.5 = 24K queries/s' },
        { label: 'Connections actually busy (Little\'s law)', calc: '24K/s × 0.004 s = 96 concurrent' },
        { label: 'During a latency spike', calc: '24K/s × 0.040 s = 960 concurrent — the DB would be thrashing long before this' },
        { label: 'Useful parallelism on the DB', calc: '32 vCPU × ~3 ≈ 96–128 active queries' },
        { label: 'PgBouncer server pool', calc: '≈ 2 × 96 ≈ 200 server connections (< 400 max_connections, leaves room for admin/replication)' },
        { label: 'Client side', calc: 'max_client_conn ≥ 1,600 (+ headroom → 2,500); per-pod pool can stay 10' },
      ],
      answer:
        'Pods could open ~1,600 connections but only ~96 are busy at steady state; front Postgres with PgBouncer (transaction mode, ~200 server connections, ~2,500 client connections).',
      insight:
        'Connections needed is a function of QPS × latency, not pod count. Direct connections scale with pods and explode during latency spikes — a pooler decouples the two, and a query/pool timeout keeps a slow DB from converting into 1,000 queued connections.',
      followUps: [
        {
          "q": "Product says the sale peak is 3× the forecast: 48K QPS. Recompute and say what breaks first.",
          "a": "Queries: 48K × 1.5 = 72K/s, so busy connections = 72K × 0.004 = 288, above the useful parallelism of ~96–128 on 32 vCPU. The DB CPU saturates first; query time rises, which by Little's law raises concurrency further, and the 200-connection PgBouncer pool fills while clients queue. Fixes, in order: cache the hottest reads (often 50%+ of the 1.5 queries), move read-only queries to replicas, and shed or queue non-critical writes. A bigger primary (64 vCPU) buys about 2× and is a last resort for a single sale."
        },
        {
          "q": "PgBouncer itself is single-threaded. Does one instance handle 24K queries/s, and how would you deploy it?",
          "a": "A single PgBouncer process uses one core and tops out around 20–50K simple queries/s depending on TLS and query size, so 24K is near its limit with no headroom for 3×. Run several: either multiple PgBouncer processes on the DB host with `so_reuseport` sharing the port, or a PgBouncer sidecar or DaemonSet per node. Remember each instance has its own server pool: 4 instances × 50 = 200 server connections total. Monitor per-process CPU and `SHOW POOLS` `cl_waiting`."
        }
      ],
    },
    {
      id: 'db-scenarios-boe-2',
      question:
        'A nightly job updates 40M rows. The primary generates WAL at 60 MB/s while it runs; the replica can replay at most 35 MB/s; normal daytime WAL is 8 MB/s. The job takes 90 minutes. How far behind will the replica get, and when will it catch up?',
      assumptions: [
        'Replay throughput is constant at 35 MB/s',
        'After the job, the primary returns to 8 MB/s',
        'Lag in seconds ≈ backlog bytes ÷ net catch-up rate (rough, for user-facing staleness)',
      ],
      steps: [
        { label: 'Backlog growth rate during job', calc: '60 − 35 = 25 MB/s' },
        { label: 'Backlog at job end', calc: '25 MB/s × 5,400 s = 135,000 MB ≈ 135 GB' },
        { label: 'Net catch-up rate after job', calc: '35 − 8 = 27 MB/s' },
        { label: 'Catch-up time', calc: '135,000 MB ÷ 27 MB/s ≈ 5,000 s ≈ 83 minutes' },
        { label: 'Worst staleness', calc: 'replica is replaying WAL produced ~135 GB ÷ 60 MB/s ≈ 37 min earlier at the end of the job' },
      ],
      answer:
        'Backlog ≈ 135 GB (reads up to ~35–40 minutes stale), taking another ~80 minutes to recover — about 3 hours of degraded replica freshness in total.',
      insight:
        'A batch job must be throttled below the replica\'s apply rate minus normal load (here < 27 MB/s of extra WAL), i.e. run ~2.5× longer but with near-zero lag. Also: ensure disk and wal_keep/slot limits can hold 135 GB, or replicas may need a full re-sync.',
      followUps: [
        {
          "q": "Replicas must stay under 10 s of lag during the job. How long does the job take now, and what do you throttle on?",
          "a": "Spare replay capacity is 35 − 8 = 27 MB/s, so the job's extra WAL must stay below that; say 25 MB/s for margin. The job produces 52 MB/s extra today (60 − 8) for 5,400 s, about 281 GB, so at 25 MB/s it takes ~11,200 s, roughly 3.1 hours. Throttle on measured lag, not on a fixed rate: between batches, read `pg_wal_lsn_diff(sent_lsn, replay_lsn)` from `pg_stat_replication` and pause when it exceeds ~250 MB (≈ 10 s of replay at 27 MB/s)."
        },
        {
          "q": "Halfway through, the replica is promoted after the primary fails. What did the backlog cost you?",
          "a": "Halfway, the backlog is ~67 GB, and the replica must replay what it has received before it can be promoted: 67 GB at 35 MB/s is ~30 minutes of write downtime. Any WAL the primary generated but hadn't shipped is lost with async replication. That's why batch throttling is a durability and RTO issue, not just read freshness. Alert on replay lag in bytes and pause batch jobs automatically when it exceeds the RTO budget."
        }
      ],
    },
    {
      id: 'db-scenarios-boe-3',
      question:
        'An `events` table has 600M rows of ~180 bytes each. Estimate heap and index sizes, whether the hot data fits in a 128 GB RAM instance, and how long a full sequential scan takes.',
      assumptions: [
        'Postgres per-row overhead ≈ 24 B tuple header + 4 B line pointer; pages ~90% full',
        'B-tree index on bigint ≈ 8 B key + 8 B index tuple header/TID + 4 B pointer ≈ 20 B/entry at ~90% fill (plus internal pages)',
        '3 indexes: PK (bigint), (account_id, created_at), (status)',
        'Sequential read throughput ≈ 500 MB/s (cloud SSD volume)',
        'Hot set = last 30 days ≈ 10% of rows',
      ],
      steps: [
        { label: 'Row on disk', calc: '180 + 28 ≈ 208 B; ÷ 0.9 fill ≈ 230 B' },
        { label: 'Heap size', calc: '600M × 230 B ≈ 138 GB' },
        { label: 'PK index', calc: '600M × 20 B ÷ 0.9 ≈ 13 GB' },
        { label: 'Composite (8 + 8 B keys) index', calc: '600M × 28 B ÷ 0.9 ≈ 19 GB' },
        { label: 'Status index (dedup helps in PG13+)', calc: '≈ 5–10 GB' },
        { label: 'Total', calc: '138 + 13 + 19 + ~8 ≈ 178 GB > 128 GB RAM' },
        { label: 'Hot set', calc: '10% of heap ≈ 14 GB + hot index pages ≈ 20–25 GB → fits in shared_buffers + OS cache' },
        { label: 'Full seq scan', calc: '138 GB ÷ 0.5 GB/s ≈ 276 s ≈ 4.6 minutes' },
      ],
      answer:
        'About 180 GB total; the whole table does not fit in 128 GB, but the recent ~25 GB hot set does. A full scan is ~4–5 minutes.',
      insight:
        'Queries touching only recent data stay fast; anything that scans (count(*), OFFSET, unindexed filters, analytics) takes minutes and evicts the hot set from cache for everyone. Partition by time so old data lives in separate relations, and keep scans off the primary.',
      followUps: [
        {
          "q": "The table grows 20M rows/month and retention is 3 years. What breaks first as it grows, and how does partitioning change the picture?",
          "a": "At 230 B/row, 20M rows/month adds ~4.6 GB heap plus ~1.5 GB index monthly, so the 30-day hot set stays ~6–7 GB and keeps fitting in RAM. What breaks is everything that touches the whole relation: autovacuum and ANALYZE over 600M+ rows, index rebuilds, and retention deletes of 20M rows/month generating WAL and dead tuples. With monthly partitions, time-filtered queries prune to 1–2 partitions, vacuum works per partition, and retention becomes `DROP TABLE events_2023_10`, an instant metadata operation."
        },
        {
          "q": "Someone runs `SELECT count(*) FROM events` from an admin page every minute. What does it cost, and what do you replace it with?",
          "a": "An index-only scan of the smallest index (~8 GB status index) still reads gigabytes, or the full 138 GB heap if the visibility map is stale, so roughly 15 s to 4.6 minutes each time. Run every minute, it reads GBs continuously and evicts the hot set from shared_buffers. Replace it with an estimate (`reltuples` from pg_class, accurate to a few percent after ANALYZE), or a counter table maintained per day by the ingest path and summed, cached for 5 minutes."
        }
      ],
    },
  ],
  test: [
    {
      id: 'db-scenarios-mcq-01',
      difficulty: 'hard',
      question:
        'During an incident you run the grouping query on pg_stat_activity and see this. What is the most likely cause and first action?',
      code: {
        language: 'text',
        code: ` state               | wait_event_type | wait_event    | sessions | longest_txn
---------------------+-----------------+---------------+----------+-------------
 active              | Lock            | relation      |      312 | 00:04:10
 idle in transaction |                 |               |        1 | 00:04:12
 active              |                 |               |        6 | 00:00:01`,
      },
      options: [
        'A session that started a transaction ~4 minutes ago (likely a migration or app bug) holds a lock everyone else waits on; identify it with pg_blocking_pids and terminate it',
        'CPU saturation; scale up the instance',
        'Disk IO saturation; move reads to replicas',
        'Too many connections; increase max_connections',
      ],
      correct: [0],
      explanation:
        '312 sessions waiting on a relation lock plus one idle-in-transaction session whose transaction started just before them is a classic blocking chain — often a DDL waiting behind or holding a lock, or an app that opened a transaction and never committed. Only 6 sessions are on CPU and none on IO, so scaling or replicas won\'t help; the connection count is a symptom of blocked queries piling up.',
      followUps: [
        {
          "q": "You terminate the idle-in-transaction pid and the 312 waiters drain. Ten minutes later the same pattern reappears. What do you change so it can't happen again tonight?",
          "a": "It is a recurring app bug, so find the source: `pg_stat_activity.query` shows the last statement the session ran and `application_name`/`client_addr` points to the service. Meanwhile, set a guardrail: `ALTER ROLE app SET idle_in_transaction_session_timeout = '30s'` so Postgres kills such sessions automatically, and `lock_timeout` on migration roles. Then fix the code path (missing try/finally around BEGIN, or an HTTP call made inside the transaction) and alert on `max(now() - xact_start)` for idle-in-transaction sessions above ~60 s."
        },
        {
          "q": "Instead of an idle session, the head of the chain is an active `ALTER TABLE` that is itself waiting. Is killing it still the right move?",
          "a": "Usually yes, but understand the shape first: the ALTER is waiting for ACCESS EXCLUSIVE behind some older holder (often a long SELECT), and everyone else queues behind the ALTER. `pg_blocking_pids(alter_pid)` shows who it waits on. Cancelling the ALTER (`pg_cancel_backend`) releases the queue instantly without touching user work; the long reader can finish. Then rerun the migration with `SET lock_timeout = '3s'` and retries so it gives up instead of forming a convoy."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-02',
      difficulty: 'medium',
      question:
        'pg_stat_statements lists query A: 12 calls/day, mean 9 s; and query B: 40M calls/day, mean 1.2 ms. The primary is CPU-bound. Where do you start?',
      options: [
        'Query A, because its mean latency is 7,500× higher',
        'Neither; CPU-bound means you need a bigger instance',
        'Query B: 40M × 1.2 ms ≈ 48,000 s/day of DB time vs ~108 s for A',
        'Query A, because slow queries hold locks that slow everything',
      ],
      correct: [2],
      explanation:
        'Total time is what consumes CPU: B costs ~13 hours of DB time per day, A under 2 minutes. Shaving B from 1.2 ms to 0.3 ms (or caching it) frees far more capacity. A matters for its own users\' latency, and could hold locks, but it cannot explain a CPU-bound primary. Scaling first skips the cheapest fix.',
      followUps: [
        {
          "q": "Query B is `SELECT * FROM products WHERE id = $1` and already uses the PK index at 1.2 ms. How do you shave it further, or remove it?",
          "a": "1.2 ms for a PK lookup is mostly overhead, not the index: round trips, parse/plan, `SELECT *` pulling wide TOASTed columns. Use prepared statements, select only needed columns, and batch lookups (`WHERE id = ANY($1)`) to kill N+1 patterns, which is often where 40M calls/day come from. Better still, products are read-mostly: a Redis or in-process cache with a 60 s TTL and 95% hit rate removes ~38M of those calls, cutting ~48,000 s/day of DB time to ~2,400 s."
        },
        {
          "q": "How would you prove after the fix that CPU dropped because of B and not because traffic dipped?",
          "a": "Snapshot `pg_stat_statements` (total_exec_time, calls) before and after, normalised per request: DB-ms per API request is traffic-independent. Compare B's share of total_exec_time (it should fall from ~99% to a small slice) and plot CPU against QPS; the CPU-per-1K-QPS slope should drop. Call `pg_stat_statements_reset()` at the change point, or diff two snapshots taken at the same hour on comparable days, so the comparison is like for like."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-03',
      difficulty: 'expert',
      question:
        'A Postgres primary is at 95% CPU with a 99.95% buffer cache hit ratio and near-zero read IOPS. Which are plausible causes? Select ALL that apply.',
      options: [
        'A hot query doing sequential scans over tables that are fully cached in memory',
        'The working set no longer fits in RAM',
        'A cache stampede in the app multiplying calls of a moderately expensive query',
        'Heavy connection churn from clients opening a new connection per request',
        'Storage volume burst credits exhausted',
      ],
      correct: [0, 2, 3],
      explanation:
        'A high hit ratio with idle IO rules out disk-related causes (working set exceeding RAM, burst credits) — those show IO waits and low hit ratio. In-memory scans burn CPU, call amplification from a stampede multiplies work, and per-request connections cost a process fork plus auth/TLS each time. All three are CPU consumers invisible to IO metrics.',
      followUps: [
        {
          "q": "How do you tell, from the database side alone, which of the three CPU causes you actually have?",
          "a": "Sort `pg_stat_statements` by total_exec_time: a seq-scan culprit shows high `shared_blks_hit` per call (millions of buffers touched from cache). A stampede shows a moderately expensive query whose `calls` jumped versus yesterday's snapshot at the same hour. Connection churn shows in `pg_stat_database` (sessions counter in PG14+) or log_connections volume, plus many short-lived backends in `pg_stat_activity` and high system CPU from forking. `perf top` on the host separates executor work from fork/auth/TLS overhead."
        },
        {
          "q": "It turns out to be connection churn: a Lambda-style worker opens a new connection per request at 2K req/s. You can't change its code this week. What do you do?",
          "a": "Put a pooler in front without touching the code: point its connection string at PgBouncer (or RDS Proxy) instead of Postgres. The client still connects 2K times/s, but PgBouncer's connects are cheap (no backend fork, no catalog cache warm-up) and it reuses ~20–50 server backends. If TLS handshakes are the cost, terminate TLS at PgBouncer close to the workers. That removes the fork and auth cost per request, often dropping primary CPU by tens of percent."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-04',
      difficulty: 'hard',
      question:
        'What connection behaviour does this handler produce under errors?',
      code: {
        language: 'typescript',
        code: `app.post('/transfer', async (req, res) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [req.body.amt, req.body.from]);
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [req.body.amt, req.body.to]);
  await client.query('COMMIT');
  client.release();
  res.sendStatus(204);
});`,
      },
      options: [
        'If the second UPDATE throws, Postgres automatically rolls back and pg returns the client to the pool',
        'Only the COMMIT failing would leak the client',
        'The handler is safe because Express catches async errors and releases the client',
        'If any query throws, the client is never released and its transaction stays open (idle in transaction, holding the row lock on the "from" account) until the pool or server times it out',
      ],
      correct: [3],
      explanation:
        'Without try/finally, an exception skips both ROLLBACK and release(): the connection stays checked out and the transaction remains open, holding the lock taken by the first UPDATE, so later transfers from the same account block. Postgres does not roll back until the session ends or times out, node-postgres doesn\'t auto-release, and Express 4 doesn\'t even catch rejected async handlers. Enough errors exhaust the pool.',
      followUps: [
        {
          "q": "You add try/finally with ROLLBACK and release. How would you write a test proving the leak is gone?",
          "a": "Use an integration test against a real Postgres (Testcontainers) with a small pool (`max: 2`). Make the second UPDATE fail (an invalid account id that violates a CHECK, or a stubbed `client.query` that throws on the second call), call the handler 10 times, then assert `pool.totalCount - pool.idleCount === 0` and `pool.waitingCount === 0`. Also query `pg_stat_activity` for `state = 'idle in transaction'` and assert zero, and check the source balance didn't change, which proves ROLLBACK ran."
        },
        {
          "q": "Two transfers run concurrently: A→B and B→A. What can go wrong with this handler even after the leak is fixed?",
          "a": "Deadlock: transaction 1 locks A then waits for B, while transaction 2 locks B then waits for A. Postgres detects it after `deadlock_timeout` (1 s) and aborts one with error 40P01, so both see a 1 s stall and one fails. Fix it by locking rows in a consistent order, for example updating the lower id first or `SELECT ... FOR UPDATE WHERE id IN ($1,$2) ORDER BY id` up front. Also retry 40P01/40001 errors a few times with jitter."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-05',
      difficulty: 'expert',
      question:
        'You move a NestJS app from direct Postgres connections to PgBouncer in transaction pooling mode. Which features can break? Select ALL that apply.',
      options: [
        'SET search_path (session-level, without LOCAL) issued once at connection start',
        'Advisory locks acquired with pg_advisory_lock and released in a later transaction',
        'Plain BEGIN ... COMMIT transactions with parameterised queries',
        'LISTEN/NOTIFY used for cache invalidation',
        'SELECT ... FOR UPDATE inside a single transaction',
      ],
      correct: [0, 1, 3],
      explanation:
        'Transaction pooling hands a different server connection to the client after each transaction, so any session-scoped state is lost or leaks to other clients: session SETs, session advisory locks, and LISTEN registrations. Ordinary transactions — including row locks taken with FOR UPDATE inside them — are fully supported because the server connection is pinned for the transaction\'s duration.',
      followUps: [
        {
          "q": "The app relies on session-level `SET search_path` for multi-tenancy (schema per tenant). How do you keep that working behind transaction pooling?",
          "a": "Move the setting into each transaction: `BEGIN; SET LOCAL search_path = tenant_42; ...; COMMIT;`. `SET LOCAL` lasts only for the transaction, which is exactly the unit PgBouncer pins, so it can't leak to another client. Alternatively, schema-qualify every table, or use one PgBouncer database entry per tenant with `search_path` set in the connection options, which only works for a small tenant count. Add a test that runs two tenants interleaved through PgBouncer and asserts there is no cross-tenant read."
        },
        {
          "q": "Which of your features still need a direct (session) connection, and how do you route them?",
          "a": "LISTEN/NOTIFY listeners, session advisory locks held across transactions, long cursors (`WITH HOLD`) and migrations that rely on session settings. Give them a separate, tiny pool: either a second PgBouncer pool in `pool_mode=session` or a direct DSN to Postgres with `max: 1–2` per pod. The main request path stays in transaction mode. Count those direct connections in the max_connections budget: 60 pods × 1 listener = 60 backends, so a single dedicated listener service fanning out over Redis is often better."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-06',
      difficulty: 'hard',
      question:
        'An API has 60 pods, each with a pool max of 15. Traffic is 9K QPS, one query per request, average query time 5 ms. How many server connections does the workload actually need at steady state?',
      options: [
        '900, because pods × pool size must all be available',
        'About 45, by Little\'s law (9,000/s × 0.005 s)',
        '9,000, one per concurrent request',
        'About 150, the number of CPU cores × 2 on a large instance',
      ],
      correct: [1],
      explanation:
        'Little\'s law: in-flight = arrival rate × time in system = 9,000 × 0.005 = 45 connections busy on average (add headroom for bursts). The 900 figure is the worst-case potential, which is exactly why a pooler is needed; 9,000 confuses QPS with concurrency; the core-count heuristic bounds useful DB parallelism but isn\'t the workload need.',
      followUps: [
        {
          "q": "A downstream dependency makes the average query time 50 ms for ten minutes. Recompute, and say what you'd configure so the DB survives it.",
          "a": "In-flight = 9,000 × 0.05 = 450 connections, within the 900 that can exist, but 450 active queries on a ~32-core box mostly thrash, which makes latency worse (a positive feedback loop). Cap server-side concurrency: PgBouncer `default_pool_size` around 100, so excess work waits in a cheap queue. Set `connectionTimeoutMillis` (~1 s) and `statement_timeout` so callers fail fast, and shed load (429) at the API when the pool's waiting count stays above zero, rather than letting hundreds of connections pile on."
        },
        {
          "q": "The pool is sized right, yet p99 has spikes where `pool.waitingCount` jumps. Average busy connections is 45. Why?",
          "a": "Little's law gives the mean, and arrivals are bursty. With 60 pods × 15 the total is fine, but each pod's pool is separate: a pod receiving a burst of 40 concurrent requests waits even while other pods sit idle, because load balancing isn't perfectly even and the event loop releases requests in batches after GC pauses. Look at per-pod waiting time, use least-connections balancing, and size per-pod pools to the p99 concurrency per pod, not the fleet average divided by 60."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-07',
      difficulty: 'medium',
      question:
        'An admin grid over a 700M-row table uses `ORDER BY created_at DESC OFFSET $page*50 LIMIT 50`. Page 1 takes 3 ms, page 4,000 takes 9 s, even with an index on created_at. Why, and what is the fix?',
      options: [
        'The index becomes fragmented at deep pages; REINDEX weekly',
        'Postgres stops using the index after page 1,000; add a hint',
        'OFFSET must walk and discard 200,000 index entries/rows before returning 50; switch to keyset pagination using (created_at, id) cursors',
        'The sort spills to disk; increase work_mem',
      ],
      correct: [2],
      explanation:
        'OFFSET N is O(N): the executor still produces and throws away N rows, so cost grows linearly with page depth. A keyset predicate (created_at, id) < (last_seen) jumps directly into the index and costs the same at any depth. There is no sort spill here because the index supplies order, and fragmentation or index abandonment are not the mechanism.',
      followUps: [
        {
          "q": "The grid also lets admins sort by `amount` or `customer_name`. How does keyset pagination work then?",
          "a": "The cursor must be the sort key plus a unique tiebreaker: `ORDER BY amount DESC, id DESC` with `WHERE (amount, id) < ($lastAmount, $lastId)`, backed by an index on `(amount DESC, id DESC)`. Each supported sort order needs its own composite index, so restrict sortable columns to a few. Encode the cursor as an opaque base64 of `{sort, amount, id}` and reject it if the sort changes. Ad-hoc sorts on unindexed columns belong in a search engine or warehouse, not on the 700M-row primary."
        },
        {
          "q": "Rows are inserted and deleted while an admin pages through. What does each approach show them?",
          "a": "With OFFSET, an insert at the top shifts everything down, so the admin sees a duplicate row on the next page; a delete makes them silently skip one. Keyset is anchored to the last seen key, so new rows above the cursor aren't shown on later pages, deleted rows simply vanish, and nothing is duplicated or skipped. If they need a frozen view (an export, an audit), page within a fixed upper bound such as `created_at <= $snapshotTime` captured on the first page."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-08',
      difficulty: 'expert',
      question:
        'A 2B-row orders table receives 20M updates/day. n_dead_tup keeps growing and autovacuum rarely runs on it. What explains this and what is the targeted fix?',
      code: {
        language: 'sql',
        code: `SHOW autovacuum_vacuum_scale_factor;  -- 0.2
SHOW autovacuum_vacuum_threshold;     -- 50
SELECT n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables WHERE relname = 'orders';
--  n_live_tup  | n_dead_tup | last_autovacuum
--  2000000000  | 310000000  | 2026-09-11 03:12`,
      },
      options: [
        'The trigger is 50 + 0.2 × 2B ≈ 400M dead tuples, so vacuum waits weeks; set a per-table scale factor (e.g. 0.005) or a fixed threshold and raise the cost limit',
        'Autovacuum is disabled cluster-wide; enable it',
        'Dead tuples are expected with MVCC and never need cleaning on large tables',
        'Run VACUUM FULL nightly to shrink the table',
      ],
      correct: [0],
      explanation:
        'Autovacuum triggers at threshold + scale_factor × live rows; for 2B rows that is ~400M dead tuples (≈ 20 days of updates here), so bloat grows and each eventual vacuum is enormous. Per-table storage parameters make vacuum run often and cheaply. It clearly is enabled (it ran on 09-11). VACUUM FULL rewrites the table under an ACCESS EXCLUSIVE lock, i.e. an outage, and dead tuples absolutely must be reclaimed.',
      followUps: [
        {
          "q": "You set `autovacuum_vacuum_scale_factor = 0.005` on orders. The first vacuum still has 310M dead tuples to clean. How do you get through it without hurting production?",
          "a": "Run a manual `VACUUM (VERBOSE) orders` in a low-traffic window rather than waiting. Raise `maintenance_work_mem` (up to 1 GB is used for dead-tuple TIDs before PG17), so it does fewer index passes; each pass scans every index, so this matters at 310M. Keep the cost delay modest so IO stays bounded, and watch `pg_stat_progress_vacuum`. Plain VACUUM takes no blocking lock. After that, 0.005 × 2B ≈ 10M dead tuples triggers vacuum about every 12 hours, each run small."
        },
        {
          "q": "Dead tuples are cleaned regularly now, but the table file is still 2× its live size. Does that matter, and how do you shrink it online?",
          "a": "Plain vacuum makes the space reusable but rarely returns it to the OS, so the free space gets reused by future updates and growth stops. That is often fine. It matters if scans, backups and cache efficiency suffer from half-empty pages. VACUUM FULL takes ACCESS EXCLUSIVE, so use `pg_repack` (or pg_squeeze), which builds a compact copy online using a trigger-captured change log and needs only brief locks at the start and the swap. It needs free disk about equal to the table's live size."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-09',
      difficulty: 'hard',
      question:
        'On one of 24 shards CPU is 3× the others. pg_stat_statements on that shard shows the same statements as other shards, but UPDATE inventory SET qty = qty - 1 WHERE sku_id = $1 has 40× the calls and heavy Lock waits. What is the right fix?',
      options: [
        'Split the shard into two by moving half its logical shards',
        'Increase the connection pool so more updates run in parallel',
        'Add a read replica to the hot shard',
        'Treat it as a hot key: e.g. split that SKU\'s stock into N buckets (or reserve in Redis with atomic Lua and persist asynchronously) and queue orders',
      ],
      correct: [3],
      explanation:
        'Many calls on one statement with row-lock waits point to a single hot row (a flash-sale SKU), which lives in one place regardless of shard splits. Replicas don\'t absorb writes, and more connections just add waiters on the same row lock. Bucketing stock or reserving in memory spreads/serialises contention cheaply.',
      followUps: [
        {
          "q": "You split the SKU's stock into 10 bucket rows. How does a decrement pick a bucket, and what happens when stock runs low?",
          "a": "Pick a random bucket and `UPDATE ... SET qty = qty - 1 WHERE sku_id = $1 AND bucket = $b AND qty > 0 RETURNING qty`. If zero rows come back, try the other buckets (or `ORDER BY random()` with `FOR UPDATE SKIP LOCKED`). Contention drops ~10×. Near zero, most buckets are empty, so callers probe several and contention returns; that's acceptable because the sale is ending. Total stock is `SUM(qty)`, and a periodic job rebalances buckets so one doesn't empty early while others hold units."
        },
        {
          "q": "You move reservations into Redis with a Lua decrement. Redis fails over and loses the last second of writes. What's the damage, and how do you bound it?",
          "a": "With async replication, decrements acknowledged in that second can be lost, so the replica's counter is higher than reality and you oversell by up to that many units. Bound it by writing each successful reservation as a durable record (Postgres insert or Kafka event keyed by order id) before confirming to the user. Reconcile the Redis counter from the durable log after failover, and keep a small safety buffer (sell 98% of stock). `WAIT 1 0` after the Lua call narrows the window at some latency cost."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-10',
      difficulty: 'expert',
      question:
        'The primary\'s disk grows 40 GB/hour and will be full in 3 hours. User traffic is normal and physical replicas show near-zero lag. What does this output indicate?',
      code: {
        language: 'text',
        code: `SELECT slot_name, slot_type, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots;

 slot_name        | slot_type | active | retained
------------------+-----------+--------+----------
 replica_1        | physical  | t      | 48 MB
 debezium_orders  | logical   | f      | 612 GB`,
      },
      options: [
        'A physical replica is lagging; restart replica_1',
        'An inactive logical slot (stalled/dead CDC consumer) is pinning WAL; restart the consumer or, if unrecoverable, drop the slot (then re-snapshot the CDC pipeline) and set max_slot_wal_keep_size',
        'Checkpoints are failing; increase max_wal_size',
        'Autovacuum is generating the WAL; disable it temporarily',
      ],
      correct: [1],
      explanation:
        'A replication slot guarantees WAL is kept until its consumer confirms it; an inactive logical slot with 612 GB retained is the culprit, while the physical replica is fine at 48 MB. Fix the consumer or drop the slot to free WAL (accepting a CDC re-snapshot), and cap future damage with max_slot_wal_keep_size. max_wal_size and autovacuum don\'t explain WAL that is retained rather than generated.',
      followUps: [
        {
          "q": "You can't drop the slot: the CDC feed drives billing. Disk will be full in 3 hours. What do you do in order?",
          "a": "First buy time: grow the volume online (EBS/PD resize takes minutes) or move other data off the WAL disk. Then fix the consumer: check Debezium connector status and logs. Typical causes are a crashed task, a poison message, or a lost Kafka destination. Restart it so it advances `confirmed_flush_lsn`, then watch `retained` shrink. Only if it can't recover before the disk fills do you drop the slot, a smaller evil than the primary halting writes, and plan a re-snapshot. Afterwards, alert on retained bytes > 10 GB."
        },
        {
          "q": "You set `max_slot_wal_keep_size = 100GB`. What happens to Debezium when it is exceeded, and is that what billing wants?",
          "a": "Postgres invalidates the slot (`wal_status = 'lost'`) and removes the WAL, which protects the primary. Debezium then can't resume from its offset, because the changes are gone, and must re-snapshot, during which billing misses or double-processes events unless consumers are idempotent. So set the limit from disk headroom and alert well before it (at 30–50% of the cap), giving humans hours to react. Billing needs idempotent consumers keyed by primary key + LSN and a reconciliation job for snapshot gaps."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-11',
      difficulty: 'hard',
      question:
        'Reports on a Postgres hot-standby replica keep failing with "canceling statement due to conflict with recovery". Which statements are correct? Select ALL that apply.',
      options: [
        'Vacuum on the primary removed row versions the replica query still needed; the replica cancels the query after max_standby_streaming_delay',
        'Setting hot_standby_feedback = on avoids these cancellations but can cause bloat on the primary',
        'Raising max_standby_streaming_delay lets queries finish but lets replay fall further behind',
        'The fix is to run the report with SERIALIZABLE isolation on the replica',
      ],
      correct: [0, 1, 2],
      explanation:
        'Recovery conflicts arise when replayed changes (typically vacuum cleanup) would remove rows a replica snapshot needs. You trade off: cancel queries (default), delay replay (more lag), or feed back the replica\'s xmin to the primary (bloat). SERIALIZABLE isn\'t even allowed on a hot standby and wouldn\'t address the conflict. A dedicated reporting replica or warehouse avoids the trade-off for user-facing replicas.',
      followUps: [
        {
          "q": "Product wants a 40-minute finance report on the same replica that serves user reads with < 1 s lag. Can one replica satisfy both?",
          "a": "Not well. Letting the 40-minute query finish needs either `max_standby_streaming_delay` ≥ 40 min (users then see up to 40 minutes of lag) or `hot_standby_feedback` (40 minutes of vacuum held back on the primary, bloating hot tables). Split the roles: user-facing replicas keep short delays and cancel conflicts, and a dedicated reporting replica gets `max_standby_streaming_delay = -1` (or a long value) because its readers tolerate lag. Better long-term: ship data to a warehouse via CDC so reports never touch OLTP replicas."
        },
        {
          "q": "How would you monitor recovery conflicts so you notice before analysts complain?",
          "a": "`pg_stat_database_conflicts` on each replica counts cancellations by cause: `confl_snapshot` (vacuum cleanup), `confl_lock`, `confl_bufferpin`, `confl_deadlock`. Scrape it with postgres_exporter, alert on rate > 0 on user-facing replicas, and dashboard snapshot conflicts against replay lag. Also log `log_recovery_conflict_waits` (PG14+). Correlate spikes with vacuum runs on the primary's hot tables (`pg_stat_user_tables.last_autovacuum`), which tells you which table's cleanup is killing queries."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-12',
      difficulty: 'expert',
      question:
        'A MySQL replica shows Seconds_Behind_Source jumping from 0 to 1,800 right after a nightly job, then dropping back to 0 all at once. The job is a single statement: DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL 90 DAY (30M rows). What is going on?',
      options: [
        'The replica cannot start applying the delete until the whole transaction arrives, then applies it as one big serial event; everything behind it waits. Chunk the delete (or drop partitions) instead',
        'The network link saturates; compress the binlog',
        'Seconds_Behind_Source is unreliable; ignore it',
        'The replica is missing an index on created_at; add it on the replica only',
      ],
      correct: [0],
      explanation:
        'A 30M-row delete is one transaction; it is written to the binlog at commit and replayed as a unit, so lag balloons for its whole apply time and snaps back when it commits on the replica. Parallel replication can\'t split a single transaction. Small chunked deletes or range partitioning with DROP PARTITION removes the spike. Replicas apply row events by primary key under row-based replication, so a created_at index on the replica isn\'t the lever.',
      followUps: [
        {
          "q": "You switch to chunked deletes of 10K rows. Lag is gone, but the 30M-row purge now takes 6 hours and overlaps morning traffic. Better option?",
          "a": "Range-partition `audit_log` by day or month. Retention then becomes `ALTER TABLE audit_log DROP PARTITION p2026_06`, a metadata operation that replicates as one tiny DDL event: no row events, no lag, no undo/purge work, and the space is freed instantly. Migrating an existing table to partitioned needs a rebuild (gh-ost or pt-online-schema-change, or create the new table and dual-write). Until then, run chunks with a sleep proportional to replica lag so the job self-throttles."
        },
        {
          "q": "Seconds_Behind_Source showed 0 before the jump. Why isn't it a trustworthy lag signal, and what would you use instead?",
          "a": "It compares the timestamp of the event being applied with the replica's clock, so it reads 0 when the SQL thread is idle even if the IO thread is behind (network lag). It jumps when a large transaction starts applying, and it ignores the time an event spent waiting. Use a heartbeat instead: pt-heartbeat writes a timestamp row on the primary every second, and the replica reads `now() - ts`. That measures true end-to-end staleness, works with multi-threaded replication, and reflects what users actually see."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-13',
      difficulty: 'hard',
      question:
        'Which approaches correctly give a user read-your-writes consistency when reads normally go to async replicas? Select ALL that apply.',
      code: {
        language: 'typescript',
        code: `// after a successful write on the primary:
const { rows } = await primary.query('SELECT pg_current_wal_lsn() AS lsn');
session.lastWriteLsn = rows[0].lsn;
session.lastWriteAt = Date.now();`,
      },
      options: [
        'Before reading on a replica, check pg_last_wal_replay_lsn() >= session.lastWriteLsn; otherwise read from the primary',
        'Route that user\'s reads to the primary for a window (e.g. 5–10 s, longer than typical lag) after lastWriteAt',
        'Retry the replica read once after 100 ms if the row looks stale',
        'Read from the primary only for the object just written and replicas for everything else, with the rest of the page tolerating lag',
      ],
      correct: [0, 1, 3],
      explanation:
        'LSN comparison is exact; a time window works when chosen larger than realistic lag (with LSN as a safety net); and scoping primary reads to just-written objects is a common, cheap pattern. "Retry once after 100 ms" has no guarantee — you often can\'t even tell the row is stale, and lag can be minutes during incidents.',
      followUps: [
        {
          "q": "The LSN is stored in the user's session. They write on the mobile app and then open the web app. What breaks, and how do you fix it?",
          "a": "The web session has no `lastWriteLsn`, so it reads a lagging replica and the user misses their own change across devices. Store the token per user, not per session: a Redis key `user:{id}:lsn` with a TTL of ~1 minute, written after commit and read by any client. Checking it costs one Redis GET per request, cheap compared with routing everything to the primary. For writes affecting other users (a comment on someone's post), decide whether they need the guarantee at all; usually they don't."
        },
        {
          "q": "Replica lag hits 15 minutes during an incident, and the time-window rule (10 s) keeps sending reads to replicas after 10 s. What happens, and how do you make the routing self-protecting?",
          "a": "After 10 s the user's reads go back to a replica that's 15 minutes behind, so their order looks unpaid again, exactly the bug the window was meant to stop. Make routing lag-aware: each app instance polls the replica's `pg_last_xact_replay_timestamp()` lag every second and removes replicas above a threshold (e.g. 5 s) from rotation. If all replicas are lagging, send critical reads to the primary with a concurrency cap and serve non-critical pages with a stale banner."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-14',
      difficulty: 'expert',
      question:
        'During a busy hour a developer runs this migration on a hot 50M-row table. Within seconds every API request touching orders hangs. Why?',
      code: {
        language: 'sql',
        code: `-- no lock_timeout set
ALTER TABLE orders ADD COLUMN notes text;
-- (a long-running analytics SELECT on orders has been open for 20 minutes)`,
      },
      options: [
        'Adding a column rewrites the entire table, taking minutes',
        'The new column invalidates all indexes, forcing seq scans',
        'ALTER TABLE needs an ACCESS EXCLUSIVE lock; it queues behind the 20-minute SELECT, and every new query on orders queues behind the pending ALTER',
        'text columns require a TOAST table rebuild under lock',
      ],
      correct: [2],
      explanation:
        'Adding a nullable column without a default is metadata-only, but it still needs a brief ACCESS EXCLUSIVE lock. Lock requests are queued FIFO: the ALTER waits for the long SELECT, and all later readers/writers wait behind the ALTER — a full outage from a "fast" DDL. Always SET lock_timeout (e.g. 5 s) and retry. No rewrite, index invalidation or TOAST rebuild happens here.',
      followUps: [
        {
          "q": "You add `SET lock_timeout = '5s'` to the migration. On a busy table it now fails every time. How do you get it through?",
          "a": "Retry in a loop with a short timeout and backoff: `lock_timeout = '2s'`, up to 20–50 attempts with jitter. Each failure costs other queries at most 2 s of queueing, not an outage. If it still fails, something keeps an old transaction open: kill or reschedule long analytics queries on the primary (set `statement_timeout` for that role, move it to a replica). Tools like pg-osc or strong_migrations' retry helpers wrap this pattern; run during the lowest-traffic hour."
        },
        {
          "q": "The next migration is `ALTER TABLE orders ADD COLUMN source text NOT NULL DEFAULT 'web'` plus a CHECK constraint. Is that safe on PG 14?",
          "a": "The column part is safe: since PG11, a constant default is stored in the catalog without a table rewrite, so it only needs the brief lock (still with lock_timeout). The CHECK is the trap: `ADD CONSTRAINT ... CHECK (...)` scans all 50M rows while holding ACCESS EXCLUSIVE. Do it in two steps: `ADD CONSTRAINT c CHECK (...) NOT VALID` (instant), then `VALIDATE CONSTRAINT c`, which scans under SHARE UPDATE EXCLUSIVE and doesn't block reads or writes."
        }
      ],
    },
    {
      id: 'db-scenarios-mcq-15',
      difficulty: 'medium',
      question:
        'Order the fixes for "the database is suddenly slow and it is a read-heavy product listing query" from cheapest to most expensive.',
      options: [
        'Shard → read replicas → cache → index',
        'Vertical scale → cache → index → shard',
        'Read replicas → index → shard → cache',
        'Index/query rewrite → cache the listing → read replicas → vertical scale/partition → shard',
      ],
      correct: [3],
      explanation:
        'Start with the change that removes work (a missing index or a query rewrite, often a 100× win in hours), then avoid work (cache hot, read-mostly listings), then add read capacity (replicas), then bigger hardware or partitioning, and only then sharding, which is a months-long, permanent complexity. The other orderings spend the most money or effort first.',
      followUps: [
        {
          "q": "You added the index and a cache, but the listing is still slow on page loads right after deploys. What's happening?",
          "a": "Each deploy starts pods with empty in-process caches (or a key prefix change empties Redis), so the first minutes are a cold-cache stampede: hundreds of concurrent misses run the listing query at once. Fix with a shared cache (Redis) that survives deploys, single-flight request coalescing so one miss per key queries the DB, and pre-warming the top N category pages during the readiness probe. Also check that the index is used under real parameters: `EXPLAIN (ANALYZE, BUFFERS)` with production values, not only the test case."
        },
        {
          "q": "The listing is 'products in category X sorted by popularity' and popularity changes every minute. Does caching still rank second?",
          "a": "Yes, with the right TTL. Users can't tell a 30–60 s-stale ranking from a live one, so a 60 s TTL at 1,000 req/s per category turns 60,000 queries a minute into 1 per category. If popularity must feel live, precompute: a job every minute writes the top 500 per category into a Redis sorted set (`ZADD`), and the API reads `ZREVRANGE`. The primary sees one aggregation per minute instead of one per request."
        }
      ],
    },
  ],
};

export default topic;
