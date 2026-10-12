import type { Topic, Section, CodeChallenge, InterviewQuestion, EnvelopeQuestion, MCQ } from '../../types';

// ---------------------------------------------------------------------------
// Incidents I: Slowness & Data-Layer Pain
// Every section follows the war-room format:
// Symptoms -> First 5 minutes -> Root causes -> Fix now -> Fix permanently -> Interview line
// ---------------------------------------------------------------------------

const sections: Section[] = [
  {
    heading: 'Incident 0 — "The whole system is slow": the 5-minute triage protocol',
    body: `**Intuition:** treat it like an emergency room. First *stabilise* (stop the bleeding), then *localise* (which organ), and only then *diagnose* (why). Engineers who jump straight to "let me read the code" lose the first 20 minutes of an incident.

### Symptoms
- p99 latency up on many routes at once (e.g. 120 ms → 3 s), gateway 504s, client retries rising.
- Usually one shared, saturated resource underneath: a database, a cache, a connection pool, an event loop, or a dependency.

### First 5 minutes — a fixed checklist
1. **What changed?** Deploys, config/flag flips, infra changes, cron/batch start, traffic shape (marketing push, bot), upstream provider status page. About 70% of incidents correlate with a change.
2. **Scope it.** All routes or one? All pods or one? One AZ? One tenant? Reads or writes? A problem on *every* route points at something *shared*; a problem on *one* route points at that route's code or its dependency.
3. **RED per service** (Rate, Errors, Duration) to find the first service in the call chain whose own latency jumped — not the ones that are slow only because they wait on it.
4. **USE per resource** (Utilisation, Saturation, Errors) on the suspect: CPU, memory, pool wait time, queue depth, event-loop lag, DB active sessions.
5. **Follow the saturation.** Latency builds up *upstream* of the saturated component. The component with a growing queue is the culprit; everything above it just looks slow.

### Root causes, ranked by how often they bite
| Where | Typical cause |
|---|---|
| Database | new query without index, plan flip, lock contention, long transaction |
| Pools | DB/HTTP pool exhausted — requests queue *inside* your app |
| Cache | hit ratio collapse, stampede, hot key, Redis down |
| Runtime | Node event loop blocked, GC pauses, CPU throttling |
| Dependencies | slow third party with no timeout |

### Fix now vs fix permanently
- **Now:** roll back the change, turn off the flag, shed non-critical traffic, scale the *bottleneck* (not the pods in front of it).
- **Permanently:** SLO-based alerts on p99 and saturation, one dashboard per shared dependency, explicit timeouts everywhere, load tests that reach the real bottleneck.

### What to say in the interview
"I don't guess. I check what changed, scope the blast radius, use RED to find the first slow service and USE to find its saturated resource. I mitigate first — rollback or shed — and root-cause after the graphs are green."`,
    diagram: `  client -> gateway -> api pods -> [ pg pool ] -> Postgres
                           |             ^ queue grows HERE
                           +-> [ redis ] -> Redis
                           +-> [ http agent ] -> payments API

  Latency is visible everywhere to the LEFT of the saturated box.
  Measure: gateway p99 | app p99 per route | pool wait | DB active
  sessions | Redis latency | dependency p99 -> first box whose OWN
  time grew is the culprit.`,
    code: [
      {
        language: 'text',
        title: 'PromQL — the first four queries to run',
        code: `# 1. p99 per route (is it everything or one route?)
histogram_quantile(0.99,
  sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))

# 2. Error ratio per service
sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))
  / sum by (service) (rate(http_requests_total[5m]))

# 3. Is one pod the outlier? (topk of per-pod p99)
topk(5, histogram_quantile(0.99,
  sum by (le, pod) (rate(http_request_duration_seconds_bucket[5m]))))

# 4. Node event-loop lag (prom-client default metric)
max by (pod) (nodejs_eventloop_lag_p99_seconds)`,
      },
      {
        language: 'bash',
        title: 'Kubernetes: what changed and who is hot',
        code: `# Recent rollouts and events (deploys, OOMKills, evictions)
kubectl rollout history deploy/orders-api -n prod
kubectl get events -n prod --sort-by=.lastTimestamp | tail -30

# Hot pods and throttling
kubectl top pods -n prod --sort-by=cpu | head
kubectl describe pod orders-api-7d9f -n prod | grep -iA3 'last state'

# Quick undo if the timeline matches a deploy
kubectl rollout undo deploy/orders-api -n prod`,
      },
    ],
    keyPoints: [
      'Order: what changed → scope → RED to find the first slow service → USE to find the saturated resource.',
      'Latency is visible upstream of the bottleneck; the component with a growing queue is the culprit.',
      'Mitigate first (rollback, flag off, shed), then root-cause.',
      'Scaling the pods in front of a saturated DB makes it worse.',
    ],
  },
  {
    heading: 'Incident 1 — Database slow / DB CPU pegged at 95%',
    body: `**Intuition:** the database is a shared kitchen. One chef making a 40-minute dish on every burner (a sequential scan run 500 times a second) slows every other order.

### Symptoms
- DB CPU 90–100%, read IOPS up, p99 up on every DB-backed route, app pool wait time up.
- Often **nothing was deployed** — the data grew past a threshold, or the planner changed its mind.

### First 5 minutes
1. **What is running right now?** Look at \`pg_stat_activity\`: active queries sorted by duration, plus their \`wait_event_type\` (CPU = null wait, \`Lock\`, \`IO\`, \`LWLock\`).
2. **What consumes the CPU overall?** \`pg_stat_statements\` ordered by \`total_exec_time\` — the top 5 queries are usually 80% of the load. Compare \`mean_exec_time\` to your baseline: one query jumping from 2 ms to 400 ms with the same \`calls\` is a **plan flip**.
3. **Seq scans:** \`pg_stat_user_tables.seq_tup_read\` rising fast on a large table means a missing or unused index.
4. **EXPLAIN (ANALYZE, BUFFERS)** the top offender on a replica — look for Seq Scan, row estimate vs actual off by 100×, nested loops over big sets.

### Root causes
- New query or filter without an index (shipped days ago, but the table only just got big).
- **Plan flip:** stale statistics after a bulk load, or data skew — the planner picks a nested loop or seq scan.
- Analytics/report query on the primary; a batch job started.
- Lock contention: many sessions waiting on one hot row (\`wait_event_type = 'Lock'\`).
- Autovacuum falling behind → table bloat → more pages scanned per query.

### Fix now
- \`pg_cancel_backend(pid)\` the runaway queries (terminate only if cancel fails).
- \`ANALYZE the_table;\` if estimates are wildly wrong — often fixes a plan flip in seconds.
- \`CREATE INDEX CONCURRENTLY\` (does not block writes; takes longer, cannot run inside a transaction).
- Kill-switch the feature/batch; move reads to a replica.

### Fix permanently
- \`statement_timeout\` per role (e.g. 2 s for the API role, 5 min for the reporting role).
- \`auto_explain\` with \`log_min_duration\` to capture plans of slow queries automatically.
- Weekly \`pg_stat_statements\` review; alert on mean-time regression per query id.
- Separate OLTP from analytics (replica or warehouse); tune autovacuum per hot table.

### What to say in the interview
"DB CPU is a symptom. I find the top queries by total time in pg_stat_statements, compare mean time to baseline to spot a plan flip, EXPLAIN it, then cancel, ANALYZE or add an index concurrently. Permanent fix: statement timeouts per role and regression alerts per query fingerprint."`,
    code: [
      {
        language: 'sql',
        title: 'Postgres triage queries',
        code: `-- 1. Active queries, longest first, with what they wait on
SELECT pid, now() - query_start AS runtime, state,
       wait_event_type, wait_event, left(query, 120) AS query
FROM pg_stat_activity
WHERE state <> 'idle' AND pid <> pg_backend_pid()
ORDER BY runtime DESC
LIMIT 20;

-- 2. Top CPU consumers overall (needs pg_stat_statements, PG13+ columns)
SELECT queryid, calls,
       round(total_exec_time::numeric, 0) AS total_ms,
       round(mean_exec_time::numeric, 2)  AS mean_ms,
       rows, left(query, 100) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- 3. Tables being sequentially scanned the most
SELECT relname, seq_scan, seq_tup_read, idx_scan, n_live_tup
FROM pg_stat_user_tables
ORDER BY seq_tup_read DESC
LIMIT 10;

-- 4. Who blocks whom
SELECT pid, pg_blocking_pids(pid) AS blocked_by, left(query, 80)
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;

-- Fix-now tools
SELECT pg_cancel_backend(12345);           -- polite: cancel the query
ANALYZE orders;                             -- refresh planner statistics
CREATE INDEX CONCURRENTLY idx_orders_cust_created
  ON orders (customer_id, created_at DESC); -- no write lock`,
      },
    ],
    keyPoints: [
      'pg_stat_statements by total_exec_time finds the load; mean_exec_time vs baseline finds plan flips.',
      'Same calls, 100× mean time, nothing deployed → stale stats / plan flip → ANALYZE.',
      'CREATE INDEX CONCURRENTLY avoids blocking writes but cannot run in a transaction block.',
      'statement_timeout per role is the cheapest permanent guardrail.',
    ],
    source: 'PostgreSQL docs — pg_stat_statements, Monitoring Database Activity',
  },
  {
    heading: 'Incident 2 — DB connections exhausted ("too many clients already")',
    body: `**Intuition:** Postgres gives each connection its own process (several MB of RAM each). It is a restaurant with a fixed number of tables — when they are full, new guests are turned away at the door, even if most seated guests are just reading the menu.

### Symptoms
- App logs: \`FATAL: sorry, too many clients already\` or \`remaining connection slots are reserved for non-replication superuser connections\`.
- Often starts **right after an HPA scale-out** or a DB failover (every pod reconnects at once).
- DB CPU may be *low* — the limit is slots, not work.

### First 5 minutes
1. Count connections by \`application_name\`, \`client_addr\` and \`state\`. Three patterns:
   - Many **idle** → pools are oversized (pods × pool max > max_connections).
   - Many **idle in transaction** → the app opened a transaction and is doing something slow (HTTP call, await on a queue) before committing. Those also hold locks.
   - Many **active** → real load; the DB is slow and connections pile up (go to Incident 1).
2. Check pod count history: 40 pods × pool 20 = 800 > \`max_connections\` 500.

### Root causes
- Connection budget never computed; HPA max × pool size exceeds the DB limit.
- Leaked clients (checked out, never released) — see Incident 3.
- Long-lived "idle in transaction" sessions.
- Reconnect storm after failover with no jittered backoff.
- Serverless functions each opening their own connection.

### Fix now
- Terminate \`idle in transaction\` sessions older than N seconds.
- Set \`idle_in_transaction_session_timeout\` (e.g. 30 s) on the app role.
- Lower pool max via config and restart gradually; cap HPA max temporarily.

### Fix permanently
- **Budget:** \`pods_max × pool_max × services ≤ max_connections − reserved\`. Size pools by Little's law, not by guess (Incident 3).
- **PgBouncer** in *transaction* mode (or RDS Proxy): thousands of client connections multiplexed onto ~50–100 server connections.

| PgBouncer mode | Server conn released | Breaks |
|---|---|---|
| session | when client disconnects | nothing — but little multiplexing |
| transaction | at COMMIT/ROLLBACK | session SET, session advisory locks, LISTEN/NOTIFY, WITH HOLD cursors; protocol prepared statements need PgBouncer 1.21+ with max_prepared_statements |
| statement | after each statement | multi-statement transactions |

### What to say in the interview
"Connections are a budget, not a knob. I compute pods × pool against max_connections, kill idle-in-transaction sessions now, and put PgBouncer in transaction mode so the database sees ~100 connections no matter how far we scale the app."`,
    code: [
      {
        language: 'sql',
        title: 'Who holds the connections?',
        code: `-- Connection census
SELECT application_name, client_addr, state, count(*)
FROM pg_stat_activity
GROUP BY 1, 2, 3
ORDER BY count(*) DESC;

SHOW max_connections;

-- Kill sessions stuck idle in a transaction for > 60s (they also hold locks)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '60 seconds';

-- Guardrails on the application role
ALTER ROLE orders_api SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE orders_api SET statement_timeout = '2s';`,
      },
      {
        language: 'text',
        title: 'pgbouncer.ini — transaction pooling',
        code: `[databases]
orders = host=pg-primary.internal port=5432 dbname=orders

[pgbouncer]
listen_port = 6432
pool_mode = transaction
; thousands of app connections...
max_client_conn = 5000
; ...multiplexed onto this many real Postgres connections per db/user
default_pool_size = 60
reserve_pool_size = 10
reserve_pool_timeout = 3
; allow protocol-level prepared statements in transaction mode (1.21+)
max_prepared_statements = 200
server_idle_timeout = 60`,
      },
    ],
    keyPoints: [
      'Idle = oversized pools; idle in transaction = app bug holding tx + locks; active = the DB is slow.',
      'Budget: max pods × pool max ≤ max_connections minus reserved slots.',
      'PgBouncer transaction mode breaks session state (SET, advisory locks, LISTEN).',
      'Reconnect storms after failover need jittered backoff.',
    ],
  },
  {
    heading: 'Incident 3 — Application connection pool exhausted (DB looks fine)',
    body: `**Intuition:** the database has free tables, but your app's own "waiting room" is full. Requests queue *inside the pod* for a pool slot, so your latency explodes while the DB graphs look calm.

### Symptoms
- node-postgres: \`Error: timeout exceeded when trying to connect\` (only if \`connectionTimeoutMillis\` is set — the default \`0\` waits **forever**, so you just see hanging requests).
- TypeORM/Prisma: "timed out fetching a new connection from the pool".
- DB CPU 20–30%, but app p99 = pool wait time + query time.

### First 5 minutes
1. Pool metrics per pod: \`totalCount\`, \`idleCount\`, \`waitingCount\` (pg Pool exposes all three). \`waitingCount > 0\` persistently = exhaustion.
2. Is it every pod (sizing) or a growing number over time on some pods (a **leak**)?
3. In the DB: are this service's connections \`idle in transaction\` (held during an HTTP call) or \`active\` (slow queries)?

### Little's law — size the pool, don't guess
Connections needed = **throughput × hold time**. 500 req/s per pod × 3 queries × 4 ms = **6 connections busy on average**. A pool of 10 has room; if one query degrades to 200 ms, you need 300 — that is why slow queries *look like* pool exhaustion.

### Root causes
- **Leak:** \`pool.connect()\` without \`release()\` on the error path.
- **Long hold:** an external HTTP call or a message publish inside a transaction.
- Slow queries (hold time up) — root cause is really Incident 1.
- One heavy endpoint starving the rest (no bulkhead).

### Fix now
- Rolling-restart leaking pods (buys hours, not a fix).
- If the DB truly has headroom, raise pool max modestly — never when the DB is the bottleneck.

### Fix permanently
- \`pool.query()\` for single statements (auto-release), \`try/finally\` around manual clients.
- Never hold a transaction across network I/O; use the outbox pattern.
- \`connectionTimeoutMillis\` (fail fast, e.g. 2 s) + \`statement_timeout\`.
- Separate pools (bulkheads) for reporting vs the hot path; export pool gauges to Prometheus and alert on waiting > 0 for 1 min.

### What to say in the interview
"If DB CPU is low but the app is slow, I look at pool wait time. Little's law tells me the pool should be tiny; a pool that is full means hold time exploded — a leak, a transaction wrapping an HTTP call, or a slow query."`,
    code: [
      {
        language: 'typescript',
        title: 'NestJS: fail-fast pg pool + Prometheus gauges',
        code: `import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { Gauge, register } from 'prom-client';

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,                        // sized by Little's law, not "just in case"
    connectionTimeoutMillis: 2000,  // default 0 = wait forever -> hanging requests
    idleTimeoutMillis: 30000,
    statement_timeout: 2000,        // server-side kill for runaway queries
    application_name: 'orders-api', // shows up in pg_stat_activity
  });

  constructor() {
    const pool = this.pool;
    new Gauge({
      name: 'db_pool_waiting', help: 'Requests waiting for a connection',
      registers: [register],
      collect() { this.set(pool.waitingCount); },
    });
    new Gauge({
      name: 'db_pool_in_use', help: 'Checked-out connections',
      registers: [register],
      collect() { this.set(pool.totalCount - pool.idleCount); },
    });
  }

  async withTx<T>(fn: (q: (sql: string, p?: unknown[]) => Promise<any>) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn((sql, p) => client.query(sql, p));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release(); // ALWAYS returns the slot, even on error
    }
  }

  onModuleDestroy() { return this.pool.end(); }
}`,
      },
    ],
    keyPoints: [
      'DB calm + app slow + pool waiting > 0 = client-side pool exhaustion.',
      'pg Pool connectionTimeoutMillis defaults to 0 (wait forever) — set it.',
      'Little\'s law: connections = throughput × hold time; slow queries inflate hold time.',
      'Never hold a transaction (and its connection) across an HTTP call.',
    ],
  },
  {
    heading: 'Incident 4 — Too many DB queries: the N+1 problem',
    body: `**Intuition:** asking the librarian for 100 books one trip at a time instead of handing over a list. Each trip is fast; 100 trips are not.

### Symptoms
- Latency grows **linearly with page size** (20 items = 80 ms, 100 items = 400 ms).
- DB QPS jumps without a traffic increase; \`pg_stat_statements\` shows a trivial query (\`SELECT ... WHERE id = $1\`) with enormous \`calls\` and ~0.1 ms mean.
- Traces show a "staircase" or "comb" of hundreds of identical child spans.

### First 5 minutes
1. Traces: open a slow request and count DB spans. 1 request → 201 queries is the diagnosis.
2. \`pg_stat_statements\` sorted by \`calls\`: high calls, tiny mean, high total.
3. Check recent changes: new GraphQL field resolver, a lazy ORM relation, a \`for ... await\` loop.

### Root causes
- GraphQL field resolvers resolving each parent's child independently (\`Order.customer\` × 100 orders).
- ORM lazy loading (TypeORM lazy relations, Sequelize getters) inside loops.
- \`await\` inside a \`for\` loop calling a repository or a microservice.

### Fix now
- Feature-flag off the new field/include; cap page size.

### Fix permanently
- **DataLoader** per request: collects keys during one tick and issues one \`WHERE id = ANY($1)\`.
- JOIN / eager loading when the relation is always needed; \`IN\`-batching for services.
- Guard in CI: fail tests when a request exceeds a query budget (count queries in an integration test).
- Metric: queries per request (histogram) — alert when p95 jumps.

### What to say in the interview
"N+1 shows up as a high-calls, low-mean query and a comb of identical spans. I batch with a per-request DataLoader — never a global one, because it caches across users — and add a query-count budget test so it cannot regress."`,
    code: [
      {
        language: 'typescript',
        title: 'Per-request DataLoader in NestJS GraphQL',
        code: `import { Injectable, Scope } from '@nestjs/common';
import DataLoader from 'dataloader';
import { DbService } from './db.service';

// REQUEST scope: one loader per HTTP request.
// A singleton loader would cache rows across users (stale + data leak).
@Injectable({ scope: Scope.REQUEST })
export class CustomerLoader {
  constructor(private readonly db: DbService) {}

  readonly byId = new DataLoader<string, Customer | null>(async (ids) => {
    // ONE query for all ids collected in this tick
    const { rows } = await this.db.pool.query(
      'SELECT id, name, tier FROM customers WHERE id = ANY($1::uuid[])',
      [ids as string[]],
    );
    const map = new Map(rows.map((r: Customer) => [r.id, r]));
    // DataLoader contract: same length and order as the input keys
    return ids.map((id) => map.get(id) ?? null);
  }, { maxBatchSize: 500 });
}

// Resolver: 100 orders -> 1 customer query instead of 100
// @ResolveField(() => Customer)
// customer(@Parent() order: Order) {
//   return this.customerLoader.byId.load(order.customerId);
// }

interface Customer { id: string; name: string; tier: string }`,
      },
    ],
    keyPoints: [
      'Signature: latency ∝ page size, high calls + tiny mean in pg_stat_statements, comb-shaped traces.',
      'DataLoader must be request-scoped and return results in key order.',
      'Add a queries-per-request budget test in CI.',
    ],
  },
  {
    heading: 'Incident 5 — Cache missing (hit ratio collapse) and cache stale',
    body: `**Intuition:** a cache is a promise the DB will only see a small fraction of reads. At a 99% hit ratio the DB sees 1%; at 95% it sees **5× more**. Small drops in hit ratio are huge jumps in DB load.

### Part A — Cache missing: symptoms
- DB read QPS and CPU jump; Redis \`keyspace_misses\` rate climbs; latency up on read paths.

### First 5 minutes
- \`INFO stats\`: \`keyspace_hits\`, \`keyspace_misses\`, \`evicted_keys\`, \`expired_keys\`. \`INFO memory\`: \`used_memory\` vs \`maxmemory\`.
- Did a deploy change the **key format** (new prefix/version, serializer change) — a silent cold cache?
- Did Redis restart/fail over without persistence (cold replica)?
- Is key cardinality exploding (keys that include timestamps, full query strings, user ids for shared data)?

### Root causes
- Key schema change → 100% misses on rollout.
- \`evicted_keys\` rising → memory full; policy evicting hot data (\`allkeys-lru\` fine; \`volatile-*\` with no TTLs = OOM errors instead).
- TTLs too short or synchronised; cold start after flush.

### Fix now
- Roll back the key change or dual-read old + new keys; pre-warm top-N keys; scale Redis memory.

### Part B — Cache stale: symptoms
- Users see old prices/profile after an update; "works after a few minutes" = TTL is masking an invalidation bug.

### Root causes of staleness
- **Write path race:** reader misses, reads old row, writer updates DB + deletes key, reader then SETs the old value.
- **Updating the cache instead of deleting it** — two concurrent writers can leave the older value last.
- Writes from another service / batch job / manual SQL that bypass invalidation.
- **Repopulating from a lagging read replica** right after a write.

### Fix permanently
- Delete (not set) **after** the DB commit; TTL as a safety net, never the mechanism.
- Versioned values (\`SET key value\` only if version is newer — Lua compare) or short "delayed double delete".
- CDC-driven invalidation (Debezium → Kafka → invalidator) catches writes from every source.
- Read-your-writes: after a write, read from primary (or skip cache) for that user for a few seconds.

### What to say in the interview
"Hit ratio is a load multiplier on the DB — going from 99 to 95 is 5× the reads. For staleness I delete after commit, never set on write, and use CDC so invalidation doesn't depend on every writer remembering to do it."`,
    code: [
      {
        language: 'bash',
        title: 'Redis: is it missing, evicting, or cold?',
        code: `redis-cli -h cache.internal INFO stats | egrep 'keyspace_(hits|misses)|evicted_keys|expired_keys'
redis-cli -h cache.internal INFO memory | egrep 'used_memory_human|maxmemory_human|maxmemory_policy'
redis-cli -h cache.internal INFO keyspace        # key counts per db
redis-cli -h cache.internal --bigkeys           # largest keys per type (SCAN-based, safe-ish)
redis-cli -h cache.internal SLOWLOG GET 10      # slow commands (KEYS *, big HGETALL, ...)

# Hit ratio = hits / (hits + misses); compute from the rates, not lifetime counters:
# PromQL (redis_exporter):
# rate(redis_keyspace_hits_total[5m])
#   / (rate(redis_keyspace_hits_total[5m]) + rate(redis_keyspace_misses_total[5m]))`,
      },
      {
        language: 'typescript',
        title: 'Invalidate after commit (delete, never set)',
        code: `async function updatePrice(productId: string, price: number) {
  await db.withTx(async (q) => {
    await q('UPDATE products SET price = $1, version = version + 1 WHERE id = $2',
      [price, productId]);
  });
  // AFTER commit: delete, so the next reader repopulates from the truth.
  // Setting the new value here races with concurrent writers.
  await redis.del('product:v3:' + productId);
  // Optional delayed second delete covers the "reader repopulated with the
  // old row during our write" race window (and replica lag).
  setTimeout(() => { redis.del('product:v3:' + productId).catch(() => undefined); }, 1000);
}

declare const db: { withTx<T>(fn: (q: (s: string, p?: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> };
declare const redis: { del(k: string): Promise<number> };`,
      },
    ],
    keyPoints: [
      'DB read load = total reads × (1 − hit ratio): 99%→95% is 5× the DB reads.',
      'Watch evicted_keys and maxmemory; a key-format deploy = instant cold cache.',
      'Delete after commit; never update the cache on write.',
      'CDC invalidation covers writers that forget; TTL is only a safety net.',
    ],
  },
  {
    heading: 'Incident 6 — Cache stampede and the hot key',
    body: `**Intuition:** a stampede is a thousand people rushing through one door the moment it opens — the popular key expires and every request recomputes it at once. A hot key is one door everyone uses all the time — a single Redis shard serving one celebrity key.

### Part A — Stampede (thundering herd): symptoms
- Periodic DB spikes aligned with TTL boundaries (every 60 s, on the minute); spikes right after a deploy or cache flush.
- Traces show dozens of identical expensive queries starting within the same 100 ms.

### Math that convinces people
Key serves 20K req/s, recompute takes 200 ms → during that window **20,000 × 0.2 = 4,000** requests miss and all hit the DB with the same query.

### Fixes (they combine)
| Technique | What it does | Cost |
|---|---|---|
| In-process singleflight | one recompute per pod, others await the same promise | caps at N pods concurrent |
| Distributed lock (SET NX PX) | one recompute cluster-wide; others serve stale or wait | lock TTL tuning |
| Stale-while-revalidate | keep a soft TTL; serve stale while one worker refreshes | briefly stale data |
| Probabilistic early refresh (XFetch) | refresh before expiry with rising probability | small extra load |
| TTL jitter | ±10–20% random TTL so keys don't expire together | none |

Shortening TTLs or buying a bigger Redis does **not** fix a stampede — the DB is what melts.

### Part B — Hot key: symptoms
- One Redis Cluster node at 100% CPU while others idle; latency up only for commands on that slot.
- A flash-sale product, a viral post, a global config key.

### First 5 minutes
- Per-node CPU and ops/s in the Redis dashboard; \`redis-cli --hotkeys\` (requires an LFU \`maxmemory-policy\`) or \`MONITOR\` sampled for a few seconds (expensive — very short bursts only).
- Big values make it worse: a 500 KB value at 20K req/s is ~10 GB/s of network.

### Fixes
- **L1 in-process cache** (1–5 s TTL) on every pod: 200K req/s over 50 pods becomes ~50 Redis reads/s per refresh period.
- **Key replication:** write \`hot:key#0..#N\`, read a random suffix — spreads across slots.
- Read from replicas (with \`READONLY\` in cluster mode) for tolerant reads.
- Shrink the value (store IDs, compress, split).

Adding shards does **not** help: one key maps to one slot on one node.

### What to say in the interview
"Stampede is a concurrency problem at expiry — I coalesce with singleflight plus a lock and serve stale while one worker refreshes. A hot key is a placement problem — one slot, one node — so I add an L1 cache and replicate the key under suffixes."`,
    diagram: `  STAMPEDE (key expires)          WITH singleflight + lock + SWR
  req1 --miss--> DB                req1 --miss--> lock OK --> DB (1x)
  req2 --miss--> DB                req2 --miss--> lock busy -> stale
  ...                              ...
  req4000 -miss-> DB  (4000x)      req4000 ------> stale value (fast)

  HOT KEY: slot(product:42) -> node C only
  node A [10%]  node B [12%]  node C [100%]  <- adding node D won't help
  fix: L1 cache per pod + product:42#0..7 spread over slots`,
    code: [
      {
        language: 'typescript',
        title: 'Singleflight + distributed lock + stale-while-revalidate (ioredis)',
        code: `import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!, { commandTimeout: 100 });
const inflight = new Map<string, Promise<unknown>>(); // per-pod singleflight

interface Entry<T> { v: T; softExp: number }

export async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const raw = await redis.get(key).catch(() => null);        // fail open on Redis errors
  const entry = raw ? (JSON.parse(raw) as Entry<T>) : null;
  if (entry && Date.now() < entry.softExp) return entry.v;    // fresh hit

  if (entry) {                                                // stale: serve it, refresh in bg
    void refresh(key, ttlSec, load).catch(() => undefined);
    return entry.v;
  }
  return refresh(key, ttlSec, load);                          // cold miss: must wait
}

function refresh<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;                // coalesce within the pod

  const p = (async () => {
    // Cluster-wide: only one pod recomputes; lock auto-expires if we crash
    const got = await redis.set('lock:' + key, '1', 'PX', 5000, 'NX').catch(() => 'OK');
    if (got !== 'OK') {
      await new Promise((r) => setTimeout(r, 50));
      const again = await redis.get(key).catch(() => null);
      if (again) return (JSON.parse(again) as Entry<T>).v;
    }
    const v = await load();
    const jitter = 1 + (Math.random() * 0.2 - 0.1);           // +/-10% TTL jitter
    const soft = Math.round(ttlSec * jitter * 1000);
    // hard TTL = 2x soft TTL so stale copies exist to serve during refresh
    await redis.set(key, JSON.stringify({ v, softExp: Date.now() + soft }), 'PX', soft * 2)
      .catch(() => undefined);
    return v;
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}`,
      },
    ],
    keyPoints: [
      'Stampede load ≈ request rate × recompute time (20K/s × 0.2 s = 4,000 duplicate queries).',
      'Coalesce (singleflight + lock) and serve stale while one worker refreshes; jitter TTLs.',
      'Hot key = one slot on one node; more shards do nothing.',
      'L1 in-process cache with a 1–5 s TTL absorbs hot keys cheaply.',
    ],
  },
  {
    heading: 'Incident 7 — Redis is down',
    body: `**Intuition:** if the cache is an optimisation, losing it should make you slower, not dead. If the whole site goes down when Redis does, Redis was secretly your database.

### Symptoms
- \`ECONNREFUSED\` / \`ETIMEDOUT\` / \`MaxRetriesPerRequestError\` in logs; latency spikes of several seconds before errors.
- Then a **second wave**: every read falls through to the DB → DB CPU 100% → the outage spreads.
- Anything using Redis as state (sessions, rate limiter, locks, queues like BullMQ) hard-fails.

### First 5 minutes
1. Is it the server (failover in progress, OOM, \`maxclients\`), the network (security group, DNS after failover), or the client (connection limit, TLS)?
2. Managed Redis: check the failover event — replica promotion usually takes 10–60 s; clients must reconnect to the new primary (DNS or Sentinel/Cluster topology refresh).
3. Look at the DB immediately — the second wave is the real danger.

### The client-side trap (ioredis defaults)
- \`enableOfflineQueue: true\` — commands issued while disconnected are **queued in memory**, not failed.
- \`maxRetriesPerRequest: 20\` — each queued command waits through up to 20 reconnect attempts (default backoff grows 50 ms, 100 ms, …) — roughly **ten seconds of hanging** per request before an error.
- Result: requests hang, in-flight concurrency and memory grow, health checks time out.

### Fix now
- Fail fast: short \`commandTimeout\`, \`maxRetriesPerRequest: 1\`, offline queue off for cache clients.
- **Fail open** for cache reads (go to the DB) **but protect the DB**: concurrency limit / load shedding on the fallback path, serve from L1 in-process cache.
- Rate limiter: decide fail-open (availability) vs fail-closed (abuse protection) per endpoint.

### Fix permanently
- Redis with replicas across AZs + automatic failover (Sentinel, Cluster, ElastiCache Multi-AZ).
- Circuit breaker around Redis: after N failures skip it for 5–10 s instead of paying a timeout per request.
- Separate clusters for cache vs durable-ish data (sessions, queues), with different eviction and persistence settings.
- Game-day: kill Redis in staging and verify the DB survives the fallthrough.

### What to say in the interview
"A cache outage must degrade, not cascade. Cache clients fail fast with ~50–100 ms timeouts and no offline queue, a breaker skips Redis while it's down, and the DB fallback path is concurrency-limited so the cache outage doesn't become a database outage."`,
    code: [
      {
        language: 'typescript',
        title: 'Cache client that fails fast + breaker + guarded DB fallback',
        code: `import Redis from 'ioredis';
import pLimit from 'p-limit';

export const cacheRedis = new Redis(process.env.REDIS_URL!, {
  enableOfflineQueue: false,   // disconnected? reject immediately instead of queueing
  maxRetriesPerRequest: 1,     // default 20 -> ~10s of hanging per command
  commandTimeout: 80,          // a cache slower than this is worse than no cache
  connectTimeout: 1000,
  retryStrategy: (times) => Math.min(times * 200, 2000), // keep reconnecting in bg
});

let openUntil = 0;              // simple breaker: skip Redis while it is failing
let failures = 0;
const dbFallback = pLimit(20);  // cap concurrent DB fallbacks per pod

export async function getProduct(id: string): Promise<unknown> {
  if (Date.now() > openUntil) {
    try {
      const hit = await cacheRedis.get('product:v3:' + id);
      failures = 0;
      if (hit) return JSON.parse(hit);
    } catch {
      if (++failures >= 5) openUntil = Date.now() + 10_000; // open for 10s
    }
  }
  // Fallthrough is concurrency-limited so a cache outage can't melt the DB.
  if (dbFallback.pendingCount > 200) throw new Error('shed: cache down, DB protected');
  return dbFallback(() => loadProductFromDb(id));
}

declare function loadProductFromDb(id: string): Promise<unknown>;`,
      },
    ],
    keyPoints: [
      'ioredis defaults (offline queue + 20 retries) turn a Redis outage into multi-second hangs.',
      'Fail open for cache reads, but concurrency-limit the DB fallback.',
      'The dangerous phase is the second wave: all reads fall through to the DB.',
      'Keep cache and stateful Redis uses (sessions, locks, queues) on separate clusters.',
    ],
  },
  {
    heading: 'Incident 8 — One API is extremely slow (everything else is fine)',
    body: `**Intuition:** when one route is sick, the problem lives in that route's own path — its query, its payload, its fan-out, or its dependency. Trace one slow request end to end before theorising.

### Symptoms
- \`GET /orders/export\` or \`/search\` p99 = 8 s; other routes normal. Often only **some tenants** or **some pages** are slow.

### First 5 minutes
1. Pull a slow trace (tail-sampled) and read the span waterfall: which span holds the time — DB, an HTTP dependency, or a gap with **no spans** (= CPU work on the event loop: serialization, regex, crypto).
2. Slice p99 by tenant, page number, payload size. "Only big customers" → O(n) behaviour; "only deep pages" → OFFSET pagination.
3. Check the dependency's own latency and whether you set a timeout on it.

### Root causes
- **OFFSET pagination:** \`OFFSET 200000 LIMIT 50\` makes Postgres read and discard 200,050 rows.
- Unbounded result sets / huge JSON responses (10 MB serialisation blocks the event loop ~100 ms+).
- **Fan-out tail latency:** calling 20 shards in parallel where each has a 1% chance of a slow response → 1 − 0.99²⁰ ≈ **18%** of requests hit at least one slow shard.
- A synchronous third-party call with no timeout; sequential awaits that could be parallel.
- Missing composite index for this route's specific filter + sort.

### Fix now
- Cap page size / result size; add a timeout to the dependency; turn off the expensive include.

### Fix permanently
- Keyset (cursor) pagination; streaming responses for exports or async export jobs (S3 link).
- Parallelise independent calls (\`Promise.all\` with a timeout budget); hedged requests for fan-out tail.
- Per-route SLOs and dashboards so one route's regression isn't hidden in the global average.

### What to say in the interview
"I pull a slow trace and look at the waterfall. A long DB span on deep pages is OFFSET — switch to keyset; a gap with no spans is CPU on the event loop; a long dependency span without a timeout gets a timeout and a fallback."`,
    code: [
      {
        language: 'sql',
        title: 'OFFSET vs keyset pagination',
        code: `-- Slow on deep pages: reads & discards 200,000 rows every time
SELECT id, created_at, total
FROM orders
WHERE tenant_id = $1
ORDER BY created_at DESC, id DESC
OFFSET 200000 LIMIT 50;

-- Keyset: seeks straight to the cursor via the index, O(limit) per page
CREATE INDEX CONCURRENTLY idx_orders_tenant_created_id
  ON orders (tenant_id, created_at DESC, id DESC);

SELECT id, created_at, total
FROM orders
WHERE tenant_id = $1
  AND (created_at, id) < ($2, $3)      -- cursor = last row of previous page
ORDER BY created_at DESC, id DESC
LIMIT 50;`,
      },
    ],
    keyPoints: [
      'Trace one slow request: long DB span, long dependency span, or a gap (CPU on the event loop).',
      'Slice by tenant / page / payload size to expose O(n) behaviour.',
      'Fan-out amplifies tail latency: 1 − 0.99^20 ≈ 18%.',
      'Keyset pagination replaces deep OFFSETs.',
    ],
  },
  {
    heading: 'Incident 9 — Event loop blocked / thread pool exhausted (Node.js)',
    body: `**Intuition:** Node has one cashier (the event loop) and a small back office of 4 helpers (the libuv thread pool). If the cashier stops to count coins for 200 ms, the whole queue waits — including the health check.

### Symptoms
- **Every** endpoint on a pod slows at once, including \`/health\`; liveness probes fail → pods restart under load → the remaining pods get more load (restart spiral).
- CPU stuck at ~1 core (on a 2-vCPU limit that shows as ~50% — "CPU isn't high" is a trap).
- \`nodejs_eventloop_lag_p99_seconds\` in hundreds of ms or seconds.

### First 5 minutes
1. Event-loop lag and ELU (event loop utilisation) per pod; correlate with a route or payload.
2. CPU profile a live pod: \`node --cpu-prof\`, \`kill -USR1\` + inspector, or clinic/0x in staging with a replayed request.
3. Check thread-pool work: bcrypt/scrypt/pbkdf2, \`zlib\`, \`fs\`, \`dns.lookup\` all share **4 threads by default** (\`UV_THREADPOOL_SIZE\`).

### Root causes
- Synchronous CPU work on the main thread: \`JSON.stringify\`/\`parse\` of multi-MB payloads, \`bcrypt.hashSync\`, \`crypto.pbkdf2Sync\`, catastrophic-backtracking regex (ReDoS), \`zlib.gzipSync\`, big sort/loops.
- Thread-pool saturation: 100 concurrent password hashes queue behind 4 threads; DNS lookups (via \`dns.lookup\`) stall behind them, so *outbound HTTP* gets slow too.
- Huge GC pauses from memory pressure near the heap limit.

### Fix now
- Roll back the offending change; cap payload sizes; raise replicas to spread CPU; relax liveness probe (timeout/failureThreshold) to stop the restart spiral — readiness should fail, liveness should not.

### Fix permanently
- Move CPU work to \`worker_threads\` (e.g. Piscina pool) or a separate service.
- Stream/paginate large responses; set body-size limits.
- Tune \`UV_THREADPOOL_SIZE\` (e.g. 16) for crypto/fs-heavy services — must be set before the pool is first used (env var at process start).
- Cache DNS or use keep-alive agents; lint against \`*Sync\` APIs in request paths; safe-regex checks.
- Alert on event-loop lag p99 > 100 ms.

The same shape exists elsewhere: a Tomcat/Spring app with 200 worker threads all blocked on a slow dependency shows "thread pool exhausted" — fix with timeouts, bulkheads, and async I/O.

### What to say in the interview
"If every route including health slows on a pod and CPU sits at one core, it's the event loop. I profile, move CPU work to worker threads, and make liveness tolerant so a busy pod gets drained by readiness instead of killed into a restart spiral."`,
    code: [
      {
        language: 'typescript',
        title: 'Measure event-loop lag + offload CPU work to a worker pool',
        code: `import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import Piscina from 'piscina';
import { Gauge } from 'prom-client';

// 1. Measure: histogram of loop delay, sampled every 20ms
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
let lastElu = performance.eventLoopUtilization();

new Gauge({
  name: 'app_eventloop_delay_p99_ms', help: 'Event loop delay p99 (ms)',
  collect() { this.set(h.percentile(99) / 1e6); h.reset(); }, // ns -> ms
});
new Gauge({
  name: 'app_eventloop_utilization', help: 'Fraction of time the loop was busy',
  collect() {
    const now = performance.eventLoopUtilization();
    this.set(performance.eventLoopUtilization(now, lastElu).utilization);
    lastElu = now;
  },
});

// 2. Offload: CPU-heavy work runs on worker threads, not the main loop
const pool = new Piscina({
  filename: new URL('./render-report.worker.js', import.meta.url).href,
  maxThreads: 4,          // ~ number of vCPUs available to the pod
  maxQueue: 100,          // bounded: reject instead of queueing forever
});

export async function renderReport(rows: unknown[]): Promise<Buffer> {
  // Main thread stays free to serve other requests and health checks
  return pool.run({ rows });
}`,
      },
      {
        language: 'yaml',
        title: 'Stop the restart spiral: liveness lenient, readiness strict',
        code: `livenessProbe:            # "is the process wedged?" -> restart
  httpGet: { path: /livez, port: 3000 }
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 6      # ~60s of failure before a kill
readinessProbe:           # "should I get traffic right now?" -> drain
  httpGet: { path: /readyz, port: 3000 }
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2
env:
  - name: UV_THREADPOOL_SIZE   # default 4; read when the pool is first used
    value: "16"`,
      },
    ],
    keyPoints: [
      'All routes + health slow on one pod, CPU ≈ 1 core → event loop blocked.',
      'libuv pool (default 4) serves fs, dns.lookup, crypto pbkdf2/scrypt, zlib — saturation slows outbound HTTP too.',
      'Offload CPU work to worker_threads with a bounded queue.',
      'Liveness lenient, readiness strict — avoid the restart spiral.',
    ],
  },
];

const cheatSheet: string[] = [
  'Triage order: what changed → scope (route/pod/AZ/tenant) → RED to find the first slow service → USE to find its saturated resource → mitigate before root-causing.',
  'DB CPU high: pg_stat_statements by total_exec_time; same calls + 100× mean_exec_time + no deploy = plan flip → ANALYZE / EXPLAIN (ANALYZE, BUFFERS).',
  'Fix-now DB tools: pg_cancel_backend, ANALYZE, CREATE INDEX CONCURRENTLY (no write lock, not in a tx), per-role statement_timeout.',
  'Connections are a budget: max pods × pool max ≤ max_connections − reserved; PgBouncer transaction mode multiplexes thousands onto ~100 (breaks SET, advisory locks, LISTEN).',
  'Pool sizing = Little\'s law: throughput × hold time. DB calm + pool waiting > 0 = leak or tx held across network I/O; pg Pool connectionTimeoutMillis defaults to 0 (forever).',
  'N+1 signature: latency ∝ page size, high calls + tiny mean, comb traces → request-scoped DataLoader / JOIN / IN, plus a query-budget test.',
  'Hit ratio is a DB multiplier: misses = reads × (1 − hit); 99%→95% = 5× DB reads. Watch evicted_keys, key-format deploys, cold failovers.',
  'Stale cache: delete after commit (never set on write), CDC invalidation, versioned values, read-your-writes from primary; TTL is only a safety net.',
  'Stampede ≈ QPS × recompute time duplicate loads → singleflight + SET NX PX lock + stale-while-revalidate + TTL jitter. Hot key = one slot/node → L1 cache + key#N replication.',
  'Redis down: ioredis defaults (offline queue + 20 retries) hang ~10 s → enableOfflineQueue:false, maxRetriesPerRequest:1, commandTimeout ~50–100 ms, breaker, concurrency-limited DB fallback. Node event loop: lag p99 > 100 ms alert, 4-thread libuv pool, worker_threads for CPU.',
];

const codeChallenges: CodeChallenge[] = [
  {
    id: 'prod-performance-cc-1',
    title: 'The product cache that took the database down twice',
    context: `This NestJS service caches product details in Redis. Last week a flash sale expired the top product key and Postgres hit 100% CPU; yesterday a Redis failover made every request hang for ~10 s and then the DB fell over again. The product page does ~20K req/s across 40 pods.`,
    task: 'Rewrite getProduct so that (1) an expiring hot key triggers at most one recompute cluster-wide while users are still served quickly, (2) a Redis outage degrades to slower responses rather than hangs, and (3) the DB is protected when the cache is unavailable.',
    starter: {
      language: 'typescript',
      title: 'product.service.ts (starter)',
      code: `import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis(process.env.REDIS_URL!); // all defaults
const pool = new Pool({ max: 20 });

export async function getProduct(id: string) {
  const key = 'product:' + id;
  const hit = await redis.get(key);              // throws / hangs when Redis is down
  if (hit) return JSON.parse(hit);

  // every concurrent miss runs this expensive query
  const { rows } = await pool.query(
    'SELECT p.*, json_agg(v.*) AS variants FROM products p ' +
    'JOIN variants v ON v.product_id = p.id WHERE p.id = $1 GROUP BY p.id', [id]);

  await redis.set(key, JSON.stringify(rows[0]), 'EX', 60); // every key expires on the same 60s
  return rows[0];
}`,
    },
    hints: [
      'How many concurrent misses happen during a 200 ms recompute at 20K req/s? What stops duplicates inside one pod and across pods?',
      'Look at ioredis enableOfflineQueue, maxRetriesPerRequest and commandTimeout defaults.',
      'If Redis is gone, every request becomes a DB request — how many can the DB take, and what do the rest get?',
    ],
    solution: {
      language: 'typescript',
      title: 'product.service.ts (solution)',
      code: `import Redis from 'ioredis';
import { Pool } from 'pg';
import pLimit from 'p-limit';

const redis = new Redis(process.env.REDIS_URL!, {
  enableOfflineQueue: false, maxRetriesPerRequest: 1, commandTimeout: 80,
});
const pool = new Pool({ max: 10, connectionTimeoutMillis: 2000, statement_timeout: 2000 });
const inflight = new Map<string, Promise<any>>();   // per-pod singleflight
const dbGate = pLimit(10);                          // per-pod DB concurrency cap
const SOFT_TTL_MS = 60_000;

async function safeGet(key: string): Promise<string | null> {
  try { return await redis.get(key); } catch { return null; }   // fail open
}

async function load(id: string) {
  if (dbGate.pendingCount > 100) throw new Error('shed: product DB saturated');
  return dbGate(async () => {
    const { rows } = await pool.query(
      'SELECT p.*, json_agg(v.*) AS variants FROM products p ' +
      'JOIN variants v ON v.product_id = p.id WHERE p.id = $1 GROUP BY p.id', [id]);
    return rows[0] ?? null;
  });
}

function refresh(key: string, id: string): Promise<any> {
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const lock = await redis.set('lock:' + key, '1', 'PX', 5000, 'NX').catch(() => 'OK');
    if (lock !== 'OK') {                       // another pod is recomputing
      await new Promise((r) => setTimeout(r, 50));
      const raw = await safeGet(key);
      if (raw) return JSON.parse(raw).v;
    }
    const v = await load(id);
    const soft = Math.round(SOFT_TTL_MS * (0.9 + Math.random() * 0.2)); // jitter
    await redis.set(key, JSON.stringify({ v, softExp: Date.now() + soft }), 'PX', soft * 2)
      .catch(() => undefined);
    return v;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function getProduct(id: string) {
  const key = 'product:v2:' + id;
  const raw = await safeGet(key);
  if (raw) {
    const e = JSON.parse(raw);
    if (Date.now() >= e.softExp) void refresh(key, id).catch(() => undefined); // SWR
    return e.v;                                   // fresh or stale: answer now
  }
  return refresh(key, id);                        // cold miss: coalesced
}`,
    },
    explanation: `**Fixes:**
- **Stampede:** in-process singleflight (one promise per key per pod) + \`SET NX PX\` lock (one pod cluster-wide) + stale-while-revalidate (hard TTL = 2× soft TTL, so a stale copy exists during refresh). 4,000 duplicate queries become ~1.
- **TTL jitter** (±10%) stops keys written together from expiring together.
- **Redis outage:** \`enableOfflineQueue: false\`, \`maxRetriesPerRequest: 1\`, \`commandTimeout: 80\` → a dead Redis costs ≤ 80 ms, not ~10 s; \`safeGet\` fails open.
- **DB protection:** \`p-limit\` caps per-pod DB concurrency and sheds when the queue is deep, so the cache outage doesn't become a DB outage; pool has \`connectionTimeoutMillis\` and \`statement_timeout\`.
- **Key versioning** (\`v2\`) makes a serializer change a deliberate, visible cold start.`,
    followUps: [
      {
        "q": "The `inflight` Map and `dbGate` are per pod. With 40 pods and Redis down, how many DB queries can a single hot product generate, and is that acceptable?",
        "a": "With Redis down, the `SET NX` lock call fails and the `.catch(() => 'OK')` treats it as acquired, so each pod rebuilds independently. Singleflight still ensures at most 1 in-flight query per key per pod, so a hot product costs at most 40 concurrent queries, one per pod, repeating whenever each pod's request finishes. That's acceptable, and `dbGate` caps total per-pod DB work at 10, shedding the rest. To do better while Redis is down, add a small in-process LRU (1–5 s TTL) so each pod doesn't re-query the same product on every request."
      },
      {
        "q": "How would you test the stampede protection to show one recompute per expiry cluster-wide?",
        "a": "Run an integration test with real Redis and Postgres (Testcontainers), and wrap `pool.query` with a counter. Seed a key that is already stale, then fire 5,000 concurrent `getProduct` calls across, say, 4 simulated \"pods\" (separate module instances with their own `inflight` maps). Assert the DB was queried once, or at most once per pod if the lock is disabled, and that all callers got a value with p99 well under the query time. Add a second test with Redis stopped, asserting every call finishes within commandTimeout plus the query time and that shedding happens past 100 queued."
      }
    ],
  },
  {
    id: 'prod-performance-cc-2',
    title: 'Checkout handler that exhausts the pool while the DB idles',
    context: `During peak, checkout p99 goes from 150 ms to 30 s and pods log nothing — requests just hang. Postgres CPU is 25%, but pg_stat_activity shows ~150 sessions from this service in state "idle in transaction". The payment provider's p99 is 1.5 s.`,
    task: 'Find every reason this handler exhausts connections and hangs, and rewrite it so that it holds connections only for DB work, fails fast, and cannot leak.',
    starter: {
      language: 'typescript',
      title: 'checkout.service.ts (starter)',
      code: `import { Pool } from 'pg';
import axios from 'axios';

const pool = new Pool({ max: 20 }); // connectionTimeoutMillis default 0

export async function checkout(orderId: string, userId: string) {
  const client = await pool.connect();
  await client.query('BEGIN');
  const { rows } = await client.query(
    'SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [orderId, userId]);
  if (!rows.length) {
    return { error: 'not found' };             // client never released, tx never closed
  }
  // external call while holding a row lock AND a pooled connection
  const charge = await axios.post('https://payments.example.com/charge', {
    orderId, amount: rows[0].total,
  });                                           // no timeout
  await client.query('UPDATE orders SET status = $1, charge_id = $2 WHERE id = $3',
    ['PAID', charge.data.id, orderId]);
  await client.query('COMMIT');
  client.release();
  return { ok: true };
}`,
    },
    hints: [
      'Trace every exit path (early return, thrown error from axios) — is the client released and the transaction closed?',
      'How long is the connection held per request? Apply Little\'s law with the provider\'s 1.5 s p99.',
      'What should happen if the pool is full — wait forever, or fail? Where should the payment call live relative to the transaction?',
    ],
    solution: {
      language: 'typescript',
      title: 'checkout.service.ts (solution)',
      code: `import { Pool, PoolClient } from 'pg';
import axios from 'axios';

const pool = new Pool({
  max: 10,
  connectionTimeoutMillis: 2000,          // fail fast instead of hanging forever
  statement_timeout: 3000,
  idle_in_transaction_session_timeout: 10000, // server kills forgotten txs
});
const payments = axios.create({ baseURL: 'https://payments.example.com', timeout: 3000 });

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
    c.release();                          // every path returns the connection
  }
}

export async function checkout(orderId: string, userId: string) {
  // Tx 1 (ms): claim the order; the status transition is the concurrency guard
  const claimed = await tx(async (c) => {
    const { rows } = await c.query(
      "UPDATE orders SET status = 'PAYING' WHERE id = $1 AND user_id = $2 " +
      "AND status = 'PENDING' RETURNING total", [orderId, userId]);
    return rows[0] as { total: number } | undefined;
  });
  if (!claimed) return { error: 'not found or already processing' };

  // No connection held during the slow network call; idempotency key = orderId
  const charge = await payments.post('/charge', { orderId, amount: claimed.total },
    { headers: { 'Idempotency-Key': 'order-' + orderId } });

  // Tx 2 (ms): record the result
  await tx((c) => c.query(
    "UPDATE orders SET status = 'PAID', charge_id = $1 WHERE id = $2 AND status = 'PAYING'",
    [charge.data.id, orderId]));
  return { ok: true };
}`,
    },
    explanation: `**Fixes:**
- **Leak:** the early \`return\` and any axios exception skipped \`release()\` and left the transaction open ("idle in transaction", row lock held). A \`tx()\` helper with \`try/catch/finally\` always rolls back and releases.
- **Hold time:** the connection and the \`FOR UPDATE\` lock were held for the whole payment call (p99 1.5 s, unbounded without a timeout). By Little's law, 100 checkouts/s × 1.5 s = 150 connections — exactly what pg_stat_activity showed. Now each transaction holds a connection for a few ms.
- **Concurrency:** the \`PENDING → PAYING\` conditional update replaces the long lock; the idempotency key makes a retried charge safe.
- **Fail fast:** \`connectionTimeoutMillis\`, axios \`timeout\`, \`statement_timeout\`, and \`idle_in_transaction_session_timeout\` as a server-side backstop.
- A crash between charge and Tx 2 leaves the order in \`PAYING\`; a reconciler job queries the provider by idempotency key and completes it.`,
    followUps: [
      {
        "q": "Two users double-click checkout: both requests race to the PENDING→PAYING update. Walk through what happens with the new code.",
        "a": "Both run `UPDATE … WHERE status = 'PENDING'`. Postgres row-locks the order: the first update wins and returns the total, then the second re-evaluates the WHERE clause after the first commits, sees `PAYING`, matches 0 rows and returns undefined, so it gets \"not found or already processing\" without ever calling the provider. Only one charge is attempted. If the client retries after a crash, though, the order is stuck in `PAYING`. That case is handled by the reconciler, or by allowing a retry with the same idempotency key, which returns the original charge."
      },
      {
        "q": "With connections held only for milliseconds, what pool size does checkout need now at 100 checkouts/s?",
        "a": "Each checkout runs two short transactions, say 5 ms each, so 10 ms of connection time. Little's law: 100/s × 0.01 s = 1 connection busy on average, versus 150 before. A pool of 10 per pod gives about 10× headroom for bursts and slow queries. The payment call's 1.5 s p99 no longer touches the DB pool at all; it only holds a socket and a pending promise. That's why the idle-in-transaction count should drop to near zero, which is the metric to watch after deploying."
      }
    ],
  },
];

const interviewQuestions: InterviewQuestion[] = [
  {
    id: 'prod-performance-iq-01',
    difficulty: 'hard',
    question: 'It\'s 2 a.m. and you\'re paged: p99 across the whole API went from 120 ms to 3 s about ten minutes ago. Error rate is 4% and climbing. Nobody on the channel knows why. Walk me through your first ten minutes.',
    context: 'Microservices on Kubernetes, Postgres primary + 2 replicas, Redis cache, one external payments provider.',
    whatInterviewerLooksFor: [
      'A structured protocol (change → scope → RED → USE) rather than guessing',
      'Mitigation before root cause; knows when to roll back',
      'Understands that latency appears upstream of the saturated component',
      'Communication: incident roles, status updates',
    ],
    modelAnswer: `### Minute 0–2: stabilise the process
- Declare an incident, take the **incident commander** role or assign one, open a channel, post a first status. Someone else handles comms.

### Minute 2–4: what changed?
- Deploy history across services (\`kubectl rollout history\`, CD tool), feature-flag audit log, config changes, cron/batch schedules, traffic graph (10× from a bot or a campaign?), provider status pages.
- If a deploy lines up with the start time, **roll back first** — it's cheap and reversible — and keep investigating in parallel.

### Minute 4–7: scope and localise
- p99 **by route**: all routes → something shared (DB, Redis, pool, network, node pressure); one route → that route's code/dependency.
- p99 **by pod / AZ**: one bad node or AZ → cordon/drain.
- **RED per service** along the call graph: find the first service whose *own* latency rose (traces make this fast); services above it only look slow.

### Minute 7–10: find the saturated resource (USE)
- DB: active sessions, CPU, top \`pg_stat_statements\` by total time, lock waits.
- App: pool waiting count, event-loop lag, CPU throttling (\`container_cpu_cfs_throttled_periods_total\`).
- Redis: latency, hit ratio, per-node CPU.
- Dependency: payments p99 and whether we time out.

### Mitigate by class
- Bad deploy → rollback. Runaway query → cancel + flag off. DB overloaded → shed non-critical traffic (reports, recommendations), serve stale cache. Dependency slow → tighten timeout, open breaker, degrade.
- **Don't** scale the API pods if the DB is the bottleneck: more pods = more connections = more contention.

### After
- Keep monitoring until p99 is back under SLO for 15+ minutes, then a blameless postmortem with a timeline and action items (alert that fires on saturation, not just latency).`,
    followUps: [
      { q: 'No deploy happened anywhere. Now what?', a: 'Look at traffic mix and data: a tenant import, a bot, a table that just crossed a size where the plan flipped, autovacuum, a cache that got flushed, a certificate/DNS change, or node-level issues (noisy neighbour, throttling). pg_stat_statements mean-time regression is the fastest DB check.' },
      { q: 'Traces show every service slow. How do you find the real culprit?', a: 'Compare each span\'s self-time, not total time. The deepest span whose self-time grew is the bottleneck; the rest is waiting. Queue metrics (pool waiting, consumer lag) tell you where work is piling up.' },
      { q: 'Your CTO asks for an ETA after 5 minutes. What do you say?', a: 'Give facts and the next checkpoint, not a guess: "Impact is X% of requests; we suspect the DB; mitigation (rollback/shedding) in progress; next update in 10 minutes."' },
    ],
    pitfalls: [
      'Opening the code or logs of a random service before scoping the blast radius',
      'Scaling out the API tier when the database is the saturated component',
      'Root-causing for 30 minutes while a rollback would have fixed it in 3',
      'Looking only at averages instead of p99 per route/pod',
    ],
  },
  {
    id: 'prod-performance-iq-02',
    difficulty: 'expert',
    question: 'Postgres primary CPU is at 95% and has been climbing for an hour. Nothing was deployed in two days, traffic is flat. What is going on and what do you do?',
    whatInterviewerLooksFor: [
      'Knows pg_stat_statements / pg_stat_activity and what to look for',
      'Recognises plan flips from stale statistics or data growth',
      'Safe fix-now actions (cancel, ANALYZE, CREATE INDEX CONCURRENTLY)',
      'Permanent guardrails (statement_timeout, auto_explain, regression alerts)',
    ],
    modelAnswer: `### Hypotheses when traffic and code are flat
1. **Plan flip** — the table grew or data skewed; statistics are stale; the planner switched from an index scan to a seq scan or a bad nested loop.
2. **New workload** — a batch/report job, a tenant import, an analyst on the primary.
3. **Bloat / autovacuum lag** — dead tuples force more pages per query.
4. **Lock contention** — sessions spinning on a hot row (shows as \`Lock\`/\`LWLock\` waits, not pure CPU).

### Evidence (5 minutes)
- \`pg_stat_activity\`: active queries by runtime and \`wait_event\`. Null wait + active = on CPU.
- \`pg_stat_statements\` ordered by \`total_exec_time\`: compare against yesterday's snapshot. A query with the **same calls** whose \`mean_exec_time\` went from 2 ms to 300 ms is a plan regression.
- \`pg_stat_user_tables\`: \`seq_tup_read\` exploding on a big table; \`n_dead_tup\` and \`last_autoanalyze\`.
- \`EXPLAIN (ANALYZE, BUFFERS)\` on a replica: estimated rows 50 vs actual 2M = statistics problem.

### Fix now
- \`pg_cancel_backend\` the pile-up so the DB recovers headroom.
- \`ANALYZE orders;\` — often resolves the flip instantly. Raise the column's statistics target if skew is the cause.
- If an index is missing: \`CREATE INDEX CONCURRENTLY\` (doesn't block writes; takes longer).
- Kill-switch the batch job or move it to a replica.

### Fix permanently
- \`statement_timeout\` per role so one pathological query can't consume the box.
- \`auto_explain.log_min_duration = 500ms\` to capture plans automatically.
- Snapshot pg_stat_statements hourly; alert on per-queryid mean regressions.
- Tune autovacuum/autoanalyze per hot table (\`autovacuum_analyze_scale_factor\` lower for big tables — the default 10% means a 100M-row table re-analyses only after 10M changes).
- Keep analytics off the primary.

I would **not** vertical-scale as a first step — a 2× bigger box buys minutes against a 100× plan regression.`,
    followUps: [
      { q: 'ANALYZE didn\'t fix it. The plan is still bad.', a: 'Check for correlated columns (create extended statistics with CREATE STATISTICS), parameter-sensitive plans with prepared statements (after 5 executions Postgres may switch to a generic plan — try plan_cache_mode = force_custom_plan for that role), or rewrite the query/add a composite index matching filter + sort.' },
      { q: 'The top query is a tiny SELECT by primary key with 50M calls/hour.', a: 'That\'s not a slow query, it\'s an N+1 or a missing cache. Fix in the application: batch with DataLoader/IN, or cache it; the DB is being used as a key-value store at high QPS.' },
      { q: 'CPU is high but pg_stat_activity shows most sessions waiting on LWLock.', a: 'Contention inside Postgres (e.g. buffer mapping, WAL insert, lock manager with many partitions). Often too many active connections for the core count — reduce concurrency with PgBouncer; more connections make it worse.' },
    ],
    pitfalls: [
      'Immediately scaling up the instance or adding replicas without identifying the query',
      'Running VACUUM FULL on a production table (takes an ACCESS EXCLUSIVE lock)',
      'Creating an index without CONCURRENTLY on a hot table and blocking writes',
      'Not comparing to a baseline — "this query looks slow" without knowing it used to be fast',
    ],
  },
  {
    id: 'prod-performance-iq-03',
    difficulty: 'hard',
    question: 'Pods are logging "timeout exceeded when trying to connect" from node-postgres, checkout p99 is 20 s, but database CPU is only 25%. The on-call wants to double the pool size. Do you approve?',
    whatInterviewerLooksFor: [
      'Distinguishes client-side pool exhaustion from DB overload',
      'Applies Little\'s law to reason about pool size',
      'Checks for leaks and idle-in-transaction holds',
      'Considers max_connections budget before raising pools',
    ],
    modelAnswer: `### Not yet — first find out *why* connections are held
A pool is exhausted when **throughput × hold time > pool size**. If the DB is at 25% CPU, queries aren't slow; connections are being **held without doing DB work**.

### What I check
1. \`pg_stat_activity\` filtered by \`application_name\`: are this service's sessions **idle in transaction**? That means code opened a transaction and is awaiting something else — classic culprit: an HTTP call to payments inside the transaction.
2. Pool gauges per pod over time: if \`totalCount − idleCount\` ratchets up and never comes down, it's a **leak** (no \`release()\` on an error path).
3. Traces of a slow request: long gap between BEGIN and COMMIT spans.

### The math
100 checkouts/s per pod, connection held during a 1.5 s payment call → **150 connections needed**; pool is 20. Doubling to 40 still fails, and 30 pods × 40 = 1,200 connections blows past \`max_connections\`. If the DB-only hold time is 5 ms, the same traffic needs **0.5 connections**.

### Fix now
- Terminate old idle-in-transaction sessions; set \`idle_in_transaction_session_timeout\`.
- Rolling restart if it's a leak; if the payments dependency is slow, tighten its timeout.

### Fix permanently
- Move the external call **out of the transaction** (two short transactions + idempotency key, or outbox).
- \`try/finally\` release everywhere, or \`pool.query\` for single statements.
- \`connectionTimeoutMillis\` ~2 s so we fail fast instead of hanging (default is 0 = forever).
- Pool metrics exported and alerted (\`waiting > 0\` for 1 min).
- Only after that, size pools by Little's law and keep \`pods × pool ≤ max_connections\`, with PgBouncer if the app tier scales widely.

Raising the pool is correct **only** when hold time is legitimately DB work and the DB has headroom.`,
    followUps: [
      { q: 'It\'s definitely a leak but you can\'t find it in the code quickly. Stop-gap?', a: 'Rolling restarts on a schedule buy time; set idle_in_transaction_session_timeout so the server reclaims them; wrap pool.connect in a helper that logs a stack trace if a client is held > 5 s to locate the leak.' },
      { q: 'How do you size the pool properly?', a: 'Measure per-pod throughput and DB hold time: connections ≈ QPS × queries/request × avg query time, plus 2× headroom for bursts. Validate against the DB: total active connections ideally near a small multiple of DB cores for OLTP.' },
    ],
    pitfalls: [
      'Approving a bigger pool without checking hold time or max_connections',
      'Assuming "DB is slow" when DB metrics are healthy',
      'Not knowing that pg Pool waits forever by default',
    ],
  },
  {
    id: 'prod-performance-iq-04',
    difficulty: 'expert',
    question: 'Our Redis primary failed over. For 45 seconds the API error rate was 40% and then Postgres fell over for another 20 minutes. Explain what happened and redesign it so a cache failure is a non-event.',
    whatInterviewerLooksFor: [
      'Understands client-side queueing/retry behaviour during Redis outages',
      'Identifies the second-wave DB overload from cache fallthrough',
      'Fail-open vs fail-closed per use case',
      'Concrete config: timeouts, breaker, bounded fallback, replicas/AZs',
    ],
    modelAnswer: `### What happened — two waves
1. **Wave 1 (Redis failover, ~45 s):** the client library kept queueing commands (ioredis \`enableOfflineQueue\` is on by default) and retrying up to 20 times per request. Requests hung for seconds, in-flight concurrency exploded, event loops filled, health checks timed out, some pods were restarted.
2. **Wave 2 (DB meltdown):** once commands started failing, code fell back to Postgres for *every* read. Hit ratio went from 98% to 0% — **50× the DB read load** in an instant. Connections exhausted, queries slow, the DB stayed pinned even after Redis recovered because the new Redis primary was cold (or keys were lost) and a stampede refilled it.

### Redesign
**Client:**
- Cache client: \`enableOfflineQueue: false\`, \`maxRetriesPerRequest: 1\`, \`commandTimeout\` 50–100 ms. A dead cache costs 100 ms, not 10 s.
- **Circuit breaker**: after 5 failures, skip Redis for 10 s — no timeout tax per request.

**Fallback path:**
- **Fail open** for pure cache reads, but through a **concurrency limiter** (e.g. 10 DB fallbacks per pod) with load shedding and a small in-process **L1 cache** (seconds of TTL) for the hottest keys.
- Serve **degraded responses** for non-critical data (recommendations off, counts approximate).

**Recovery:**
- Stampede protection (singleflight + lock + SWR) so the cold cache refills with one query per key, not thousands.
- Pre-warm top-N keys after failover.

**Infrastructure:**
- Replicas in another AZ with automatic failover; clients that refresh topology quickly.
- Separate Redis for *state* (sessions, rate limits, locks, BullMQ) from pure cache — different durability, eviction and failure semantics.
  - Rate limiter: fail-open on public read APIs, fail-closed on login/OTP.
  - Sessions: signed JWT or DB fallback so auth doesn't die with the cache.

**Prove it:** chaos test — kill Redis in staging under production-like load and assert the DB stays under 70% CPU.`,
    followUps: [
      { q: 'Why not just have the app wait for Redis to come back?', a: 'Waiting holds requests, sockets and memory; clients retry on top, so load multiplies. Fast failure plus degradation keeps capacity for the requests you can serve.' },
      { q: 'How big should the L1 cache be and what about consistency?', a: 'Only hot keys, small (thousands of entries, LRU), TTL of 1–5 s. The staleness bound equals the TTL; that\'s acceptable for catalog data, not for balances.' },
      { q: 'The DB could only survive 30% of normal read traffic without cache. What does that imply?', a: 'The cache is a capacity dependency, not an optimisation, so it needs cache-level HA (replicas, multi-AZ) and the fallback must shed ~70% of traffic by priority. Also add read replicas so the DB tier can absorb more.' },
    ],
    pitfalls: [
      'Saying "fall back to the database" without protecting the database',
      'Ignoring client library defaults (offline queue, retries)',
      'Treating sessions/locks/rate limits in Redis the same as cache entries',
    ],
  },
  {
    id: 'prod-performance-iq-05',
    difficulty: 'expert',
    question: 'A flash sale starts. One product key gets ~200K reads/s. One Redis Cluster node goes to 100% CPU while the other eleven are at 15%, and every request touching that node slows down. The team proposes adding six more shards. Your call?',
    whatInterviewerLooksFor: [
      'Knows a key maps to one hash slot on one node — resharding cannot split it',
      'Proposes L1 caching and key replication with concrete numbers',
      'Considers value size and network bandwidth',
      'Thinks about stampede on that key too',
    ],
    modelAnswer: `### No — more shards won't help
In Redis Cluster a key hashes (CRC16 mod 16384) to **one slot owned by one primary**. Adding shards moves *other* slots away but the hot key stays on one node, which executes commands on a single main thread (~100K–200K simple ops/s depending on value size). The node is saturated by **one key**.

### Immediate mitigation
1. **L1 in-process cache** on every API pod with a 1–2 s TTL for this key. 200K req/s across 100 pods = 2K req/s per pod, but Redis now sees ~100 pods × 1 refresh/s = **~100 reads/s**. Staleness bound: 2 s — fine for product details, not for stock count.
2. Guard the L1 refresh with singleflight so each pod only issues one Redis GET per expiry.

### Structural fixes
- **Key replication:** write \`product:42#0 … #15\` (each suffix lands in a different slot), readers pick a random suffix. Writes fan out to 16 keys; reads spread over up to 16 nodes.
- **Read from replicas** (\`READONLY\` + replica reads in the client) for tolerant data.
- **Shrink the value:** a 100 KB product blob at 200K req/s is **20 GB/s** — network, not CPU, is the limit. Cache a compact projection; move images to the CDN.
- **Separate volatile fields:** stock count changes constantly; keep it in its own key (or a counter with local reservation batches) so product details can be cached aggressively.
- Put cacheable responses **at the CDN** for anonymous traffic — the best request never reaches Redis.

### Detection for next time
- Per-node Redis CPU/ops alerts (cluster averages hide it), \`redis-cli --hotkeys\` with an LFU policy, client-side key sampling metrics.
- Pre-warm and pre-replicate known hot items before a planned sale.`,
    followUps: [
      { q: 'The hot data is the stock counter, which must be accurate. L1 caching is unsafe. Now what?', a: 'Split the counter: allocate stock in batches to N sub-counters (stock:42#i) and decrement a random one, falling back to others when empty; or reserve via a queue/partitioned inventory service. Reads of "in stock?" can be approximate; the decrement is the accurate part.' },
      { q: 'How would you find hot keys if you didn\'t know which one it was?', a: 'redis-cli --hotkeys (needs maxmemory-policy allkeys-lfu/volatile-lfu), a short MONITOR sample on a replica, per-slot stats, or client-side instrumentation that samples keys per command.' },
    ],
    pitfalls: [
      'Believing resharding or bigger clusters fix a single hot key',
      'Ignoring value size / network bandwidth',
      'Using MONITOR on the saturated primary for minutes',
    ],
  },
  {
    id: 'prod-performance-iq-06',
    difficulty: 'hard',
    question: 'One GraphQL query — the "orders dashboard" — has p99 of 8 s. Every other operation is fine. DB CPU is moderately elevated. The frontend team says "it\'s just 50 orders". Diagnose it.',
    whatInterviewerLooksFor: [
      'Suspects N+1 from resolver structure and verifies with traces/pg_stat_statements',
      'Knows DataLoader mechanics and request scoping',
      'Considers query complexity limits and other per-route causes',
      'Prevents regression (query budget tests)',
    ],
    modelAnswer: `### Hypothesis: resolver N+1 fan-out
"50 orders" in GraphQL can mean: 1 query for orders, then per order \`customer\` (50), \`items\` (50), per item \`product\` (50 × 8 = 400), per product \`inventory\` (400)… **~900 queries** for one request. Each is 1–3 ms, but they're sequentialised by resolver depth and compete for a pool of 10 connections → seconds.

### Verify in 5 minutes
- Trace one slow request: count DB spans (hundreds of identical \`SELECT ... WHERE id = $1\`), look at the "comb" shape.
- \`pg_stat_statements\` sorted by \`calls\`: tiny mean, enormous call count, fingerprints matching the resolvers.
- Pool wait time spikes when this operation runs — it also starves other operations on the same pod.

### Fix
- **DataLoader per request** for every relation: \`Order.customer\`, \`OrderItem.product\`, \`Product.inventory\`. Each level becomes one \`WHERE id = ANY($1)\` → ~5 queries total. Request-scoped, because a singleton loader caches across users (stale data, and a tenant-isolation bug).
- For always-needed relations, JOIN in the parent resolver.
- If some fields call other services, batch them too (a \`/products:batchGet\` endpoint).

### Guardrails
- **Query complexity / depth limits** so a client can't ask for 50 orders × 100 items × deep nesting.
- **Query-count budget** in integration tests: "dashboard query must issue ≤ 10 SQL statements".
- Metric: SQL statements per GraphQL operation name (histogram), alert on regressions.
- Persisted queries so the expensive shapes are known and reviewed.

### Other things I'd rule out
Deep OFFSET pagination, a missing index for the dashboard's filter+sort, and large response serialization on the event loop (a gap with no spans in the trace).`,
    followUps: [
      { q: 'You added DataLoader but still see 50 queries. Why?', a: 'The loads are not in the same tick: something awaits between them (e.g. a resolver awaits an auth check per item before calling load), or a new DataLoader instance is created per resolver call instead of per request.' },
      { q: 'What does DataLoader\'s per-request cache give you beyond batching?', a: 'Deduplication: the same customer referenced by 30 orders is fetched once. It\'s scoped to the request so it never serves stale data across requests.' },
    ],
    pitfalls: [
      'Adding a Redis cache over each resolver instead of batching',
      'Global/singleton DataLoader',
      'Blaming the DB and scaling it',
    ],
  },
  {
    id: 'prod-performance-iq-07',
    difficulty: 'expert',
    question: 'Under peak load our NestJS pods start failing liveness probes and get restarted, which makes the remaining pods fail faster. CPU per pod shows ~55% of its 2-vCPU limit, memory is fine. What\'s happening and how do you stop the spiral?',
    whatInterviewerLooksFor: [
      'Recognises Node single-threaded saturation (one core = 50% of 2 vCPU)',
      'Knows event-loop lag / ELU metrics and profiling approaches',
      'Knows libuv thread-pool contention causes',
      'Correct probe design and CPU offloading',
    ],
    modelAnswer: `### Diagnosis: the event loop is saturated
Node runs JavaScript on **one thread**. On a 2-vCPU limit, a fully busy main thread shows as **~50%** CPU (the rest is GC and libuv threads). So "55%" means the loop is pegged. Every request — including \`/health\` — waits in line, the liveness probe times out, kubelet restarts the pod, its traffic moves to the others, they saturate too: a **restart spiral**.

### Confirm
- \`nodejs_eventloop_lag_p99_seconds\` / ELU near 1.0 on affected pods.
- CPU profile (\`--cpu-prof\`, inspector on one pod, or clinic flame in staging with replayed traffic). Usual suspects:
  - \`JSON.stringify\`/\`parse\` of multi-MB payloads, class-transformer on huge arrays.
  - \`bcrypt\`/\`pbkdf2\` — sync variants block the loop; async variants use the **4-thread libuv pool**, which also serves \`dns.lookup\`, \`fs\` and \`zlib\`, so heavy hashing slows outbound HTTP (DNS stuck behind hashes).
  - Regex with catastrophic backtracking on user input.

### Stop the spiral now
- Make **liveness lenient** (timeout 5 s, failureThreshold 6) and **readiness strict**: a busy pod should be taken out of rotation and recover, not be killed.
- Scale out replicas (per-pod load drops), cap payload sizes, turn off the expensive feature.

### Fix permanently
- Move CPU-bound work to **worker_threads** (Piscina) with a bounded queue, or to a separate service; size workers ≈ vCPUs.
- Stream big responses; paginate; set body limits.
- \`UV_THREADPOOL_SIZE\` (e.g. 16) for crypto/fs-heavy services; cache DNS / keep-alive agents.
- Run 1 Node process per ~1 vCPU (e.g. 1-vCPU pods ×2 replicas instead of one 2-vCPU pod) since a single process can't use the second core for JS.
- Alert on event-loop lag p99 > 100 ms; HPA on a metric that reflects saturation (ELU or in-flight requests) rather than CPU %, which under-reports here.`,
    followUps: [
      { q: 'Why didn\'t HPA on 70% CPU scale us out?', a: 'Because the main thread saturates at ~50% of a 2-vCPU limit; the metric never reaches the target. Either use 1-vCPU pods or scale on ELU / request concurrency via custom metrics.' },
      { q: 'Should liveness check the database?', a: 'No. Liveness should only detect a wedged process; dependency checks belong in readiness (and even there carefully, or a DB blip removes every pod at once).' },
      { q: 'Could it be GC instead?', a: 'Check GC pause metrics (nodejs_gc_duration_seconds) and heap usage vs limit. Long major GCs near the heap limit look similar; fix with memory limits, --max-old-space-size aligned to the container, and reducing allocation.' },
    ],
    pitfalls: [
      'Concluding "CPU is only 55%, so it\'s not CPU"',
      'Increasing liveness strictness or adding DB checks to liveness',
      'Throwing more RAM at it',
    ],
  },
];

const envelopeQuestions: EnvelopeQuestion[] = [
  {
    id: 'prod-performance-boe-1',
    question: 'Postgres runs on a 64 GB instance with a gp3 volume provisioned at 12,000 IOPS. The hot working set of the orders tables grew from 40 GB to 90 GB, and the buffer cache hit ratio dropped from 99.9% to 95%. At 30,000 index lookups per second, each touching about 4 pages, can the disk keep up, and what happens to query latency at a 50,000/s peak?',
    assumptions: [
      'Usable cache ≈ 50 GB (shared_buffers 16 GB + OS page cache ~34 GB), so a 90 GB working set no longer fits',
      'Each lookup touches ~4 pages (index leaf, heap page, occasional internal page), each a random 8 KB read on a miss',
      'Background writes (WAL, checkpoints, autovacuum) use ~3,000 IOPS',
      'gp3 random read ≈ 1 ms when lightly loaded; queueing roughly scales wait time by 1 ÷ (1 − utilisation)',
    ],
    steps: [
      { label: 'Page accesses', calc: '30,000 lookups/s × 4 pages = 120,000 page reads/s' },
      { label: 'Disk reads before', calc: '120,000 × 0.1% miss = 120 IOPS — the disk is idle' },
      { label: 'Disk reads now', calc: '120,000 × 5% miss = 6,000 IOPS (50× more) + 3,000 background = 9,000 of 12,000 → 75% utilised' },
      { label: 'Latency at normal load', calc: '1 − 0.95⁴ ≈ 18.5% of lookups need at least one disk read; at 75% utilisation each read waits ≈ 1 ms × 1 ÷ 0.25 ≈ 4 ms, so those lookups go from ~0.3 ms to ~4–8 ms' },
      { label: 'At the 50,000/s peak', calc: '50,000 × 4 × 5% = 10,000 IOPS + 3,000 = 13,000 > 12,000 → 108% utilised; the queue grows without bound, reads wait tens of ms, queries hold connections longer and the app pool exhausts' },
      { label: 'Option A: 128 GB RAM', calc: 'working set fits again, miss ≈ 0.1% → 50,000 × 4 × 0.1% = 200 IOPS + 3,000 = 3,200 IOPS (27%)' },
      { label: 'Option B: more IOPS', calc: 'need ≥ 13,000 ÷ 0.6 ≈ 22,000 IOPS to stay near 60% at peak, and each miss still costs ~1 ms' },
    ],
    answer: 'At 30,000/s the disk runs at ~75% (9,000 IOPS) and about 1 in 5 lookups gets several ms slower. At the 50,000/s peak it needs ~13,000 IOPS against 12,000 provisioned, so it saturates and latency collapses. Adding RAM so the working set fits (≈3,200 IOPS) is the better fix; buying ~22,000 IOPS only moves the cliff.',
    insight: 'A hit ratio that "only" fell from 99.9% to 95% means 50× more disk reads, because the miss rate is what the disk sees. Track the working set against RAM (blks_read, cache hit ratio per table) as data grows, and shrink it where you can: partition or archive old orders, drop unused indexes. The cliff arrives when the working set outgrows cache, not when CPU looks busy.',
    followUps: [
      {
        "q": "The working set keeps growing and the hit ratio falls to 90%. Redo the IOPS check at 30,000/s and at the 50,000/s peak.",
        "a": "At 30,000/s: 120,000 page reads × 10% = 12,000 IOPS, plus 3,000 background = 15,000, which exceeds the 12,000 provisioned even at normal load. Saturated all day. At peak: 200,000 × 10% = 20,000 + 3,000 = 23,000 IOPS, above even the 22,000 of Option B. Each step down in hit ratio adds misses linearly, but the miss rate is what the disk sees, so buying IOPS just chases the curve. Only shrinking the working set (archiving old orders, partition pruning, dropping unused indexes) or adding RAM changes the slope."
      },
      {
        "q": "You can't get a bigger instance this quarter. How would you cut the working set from 90 GB back under the ~50 GB cache?",
        "a": "Find which relations make up the hot set: `pg_statio_user_tables` and `pg_statio_user_indexes` (blks_read versus blks_hit) and `pg_buffercache`. Typical wins: partition orders by month so recent partitions stay hot and old ones are rarely touched; drop unused or duplicate indexes (`pg_stat_user_indexes.idx_scan = 0`), since every index competes for cache; use covering or partial indexes (e.g. `WHERE status = 'open'`) so lookups avoid heap pages; and remove table and index bloat with `pg_repack`. Re-measure the hit ratio after each change."
      }
    ],
  },
  {
    id: 'prod-performance-boe-2',
    question: 'The homepage "trending" key is read 20,000 times per second and expires every 60 s. Rebuilding it takes a 250 ms aggregate query. How much DB load does each expiry create, and what does coalescing buy you?',
    assumptions: [
      '40 API pods, traffic spread evenly',
      'No stampede protection: every miss during the rebuild window runs the query',
      'DB can run ~100 of these aggregates concurrently before saturating',
    ],
    steps: [
      { label: 'Misses during one rebuild window', calc: '20,000 req/s × 0.25 s = 5,000 concurrent identical queries' },
      { label: 'Compare to DB capacity', calc: '5,000 ÷ 100 = 50× over capacity → queries queue, the window stretches to seconds, more misses pile up (positive feedback)' },
      { label: 'Per-pod singleflight only', calc: '1 query per pod × 40 pods = 40 concurrent → within capacity' },
      { label: 'Singleflight + distributed lock + SWR', calc: '1 query per expiry cluster-wide; users served stale value, 0 misses visible' },
      { label: 'Steady-state rebuild load', calc: '1 query / 60 s ≈ 0.017 queries/s — negligible' },
    ],
    answer: 'Each expiry fires ~5,000 duplicate aggregates, 50× what the DB can take. Per-pod coalescing drops it to 40; adding a lock with stale-while-revalidate drops it to 1 per minute.',
    insight: 'Stampede load scales with read QPS × rebuild time, so the hottest, most expensive keys are exactly the ones that need coalescing and soft TTLs. TTL jitter alone does not help a single hot key.',
    followUps: [
      {
        "q": "On Black Friday, reads hit 60,000/s and the aggregate slows to 2 s. Without protection, how bad is an expiry, and what must change in your lock setup?",
        "a": "Concurrent misses = 60,000 × 2 s = 120,000 identical queries, about 1,200× the DB's ~100 capacity, so it's dead instantly. Per-pod singleflight still caps it at 40 concurrent queries, which is OK, but each takes 2 s. The cluster-wide `SET NX PX` lock must have a TTL above the rebuild time, so raise it from, say, 1 s to 5 s, or the lock expires mid-rebuild and a second pod starts. Stale-while-revalidate means users don't wait those 2 s at all. Also consider precomputing the aggregate on a schedule, so it's never computed on the read path."
      },
      {
        "q": "Would TTL jitter help this single trending key? When does jitter matter?",
        "a": "No. Jitter spreads expiries across many keys written at the same moment (e.g. 10,000 product keys loaded by a warm-up job all expiring together). This is one key, so jittering its TTL only moves the single expiry around; the 5,000-query stampede still happens whenever it expires. For a single hot key the tools are coalescing, a rebuild lock, stale-while-revalidate, or proactive refresh before expiry (XFetch, or a background refresher). Use jitter as a complement for bulk-written key families."
      }
    ],
  },
  {
    id: 'prod-performance-boe-3',
    question: 'A deploy changed cache key serialization for 10% of product keys. Overall hit ratio dropped from 99% to 96%. Product reads are 50,000 req/s. What happened to the database?',
    assumptions: [
      'Every miss becomes one DB read (plus a cache set)',
      'Primary + 2 replicas serve reads; each replica is comfortable up to ~1,500 of these reads/s',
    ],
    steps: [
      { label: 'Misses before', calc: '50,000 × (1 − 0.99) = 500 DB reads/s' },
      { label: 'Misses after', calc: '50,000 × (1 − 0.96) = 2,000 DB reads/s → 4× the DB read load' },
      { label: 'Capacity check', calc: '2 replicas × 1,500 = 3,000 reads/s → survives, at ~67% utilisation (was ~17%)' },
      { label: 'If the change hit all keys (cold cache)', calc: '50,000 × 1.0 = 50,000 reads/s ≈ 17× replica capacity → outage' },
    ],
    answer: 'DB reads went from 500/s to 2,000/s — a 3-point hit-ratio drop quadrupled the DB load. The replicas survived only because 10% of keys changed; a full key-format change would have been a 100× jump.',
    insight: 'Alert on hit ratio with tight thresholds (a 1-point drop is significant) and roll out key-format changes gradually or with dual reads. Plan DB capacity for the realistic worst-case hit ratio, not the average.',
    followUps: [
      {
        "q": "During the incident one of the two replicas fails. What happens at 2,000 DB reads/s?",
        "a": "All 2,000 reads/s land on the remaining replica, rated for about 1,500/s, so it runs at about 133% of capacity. Queues grow, latency climbs, and the app's connection pools fill and time out. If the app then falls back to the primary, writes suffer too. With the old 99% hit ratio (500/s) one replica would have been at 33%, so it was the combination of the cache regression and the replica loss that broke it. Capacity plans must survive the worst plausible hit ratio with N−1 replicas."
      },
      {
        "q": "How would you roll out a key-format change for 100% of keys without the cold-cache cliff?",
        "a": "Use dual reads: read the new key (`product:v2:id`), and on a miss read the old v1 key, and if it's found, translate it and write v2 asynchronously. The DB sees no extra load; Redis sees one extra GET per v2 miss, trivial at these rates. Alternatively, pre-warm v2 from a background job before switching reads, or roll out by percentage of keys (hash-based, 10% → 25% → 100%) while watching the hit ratio and DB reads. After v1 traffic drops to zero, delete v1 or let it expire."
      }
    ],
  },
  {
    id: 'prod-performance-boe-4',
    question: 'A report endpoint spends 25 ms of synchronous CPU per request (JSON transform) on the Node main thread. Traffic is 300 req/s spread over 6 pods. Will it hold, and what happens to other endpoints on those pods?',
    assumptions: [
      'One Node process per pod (one event loop)',
      'Other endpoints need ~1 ms CPU each at 500 req/s per pod',
    ],
    steps: [
      { label: 'Report load per pod', calc: '300 ÷ 6 = 50 req/s × 25 ms = 1,250 ms CPU per second → 125% of one loop' },
      { label: 'Plus other endpoints', calc: '500 × 1 ms = 500 ms → total 175% of a single thread' },
      { label: 'Utilisation > 1', calc: 'Queue grows without bound → event-loop lag climbs by ~0.75 s every second until timeouts/probes fail' },
      { label: 'Offload the transform to worker threads', calc: 'Main loop: 500 ms/s = 50% busy (healthy). Workers need 1.25 cores of CPU per pod → ~2 workers on 3-vCPU pods, or keep 2-vCPU pods and scale to ~12 pods (25 req/s × 25 ms = 0.625 core of worker time each)' },
    ],
    answer: 'It cannot hold: each event loop is asked for 1.75 s of CPU per second, so latency grows without bound for every endpoint on the pod. Offload the transform to worker threads and provision the extra ~1.25 cores per pod it needs (bigger pods, or roughly twice as many).',
    insight: 'For Node, capacity per pod is about one core of JavaScript time. Any endpoint with meaningful per-request CPU must be isolated (workers, a separate deployment) or it degrades every other route on the same process.',
    followUps: [
      {
        "q": "Why not just double to 12 pods and skip worker threads?",
        "a": "Per pod at 12 pods: reports 25 req/s × 25 ms = 625 ms, plus the other endpoints (3,000 ÷ 12 = 250 req/s × 1 ms) = 250 ms, for 875 ms of CPU per second, 87.5% of one loop. It technically holds, but queueing time is about 1 ÷ (1 − 0.875) = 8× service time, and every 1 ms request can sit behind a 25 ms transform. So p99 for cheap endpoints jumps to tens of ms, and any traffic spike tips the loop into unbounded lag. Workers isolate the slow CPU work so the main loop stays at about 25–50% busy."
      },
      {
        "q": "You move the transform to a worker pool of 2 threads per pod. How do you keep the pool from becoming the new unbounded queue?",
        "a": "Each pod needs 50 × 25 ms = 1.25 s of worker CPU per second, so 2 workers run at about 62.5% utilisation, which is fine at steady state. Bound the work: use a pool library (e.g. Piscina) with `maxQueue` set, and when the queue is full, reject with 503 or fall back to an async \"report will be emailed\" path instead of queueing forever. Track queue depth and wait time per pod and scale on them. Also keep the transferred data small (or pass a `SharedArrayBuffer`), because serialising a large object to a worker can itself cost milliseconds on the main thread."
      }
    ],
  },
];

const test: MCQ[] = [
  {
    id: 'prod-performance-mcq-01',
    difficulty: 'medium',
    question: 'A product cache serves 40,000 reads/s. After a config change the hit ratio falls from 99% to 97%. Roughly what happens to the read load reaching Postgres?',
    options: [
      'It rises about 2% — the hit ratio only moved two points',
      'It triples, from about 400 to about 1,200 reads/s',
      'It doubles, because misses also trigger a cache write',
      'It is unchanged if the replicas absorb the extra reads',
    ],
    correct: [1],
    explanation: 'DB reads = total × (1 − hit ratio): 40,000 × 0.01 = 400 before, 40,000 × 0.03 = 1,200 after — 3×. "2%" confuses the hit ratio with the miss volume; cache writes go to Redis, not Postgres; replicas still receive the load, they just spread it.',
    followUps: [
      {
        "q": "Postgres can comfortably serve 1,500 of these reads/s. What hit ratio is your real alert threshold at 40,000 reads/s?",
        "a": "The DB can take 1,500 ÷ 40,000 = 3.75% misses, so 96.25% is the breaking point. You want to page well before that, e.g. warn below 98.5% (600 DB reads/s) and page below 97.5% (1,000/s). Better still, alert on the derived quantity itself: DB reads/s caused by cache misses, or `(1 - hit_ratio) × request_rate`. That stays meaningful when traffic grows: at 80,000 reads/s, even a 98% hit ratio sends 1,600/s, which is already over capacity."
      },
      {
        "q": "How would you find which change caused the drop from 99% to 97% without reading the whole diff?",
        "a": "Break the hit ratio down by key prefix or namespace. Emit hit and miss counters labelled with the key family (a bounded set, never the full key). The family that dropped points at the change: a new key format, a shorter TTL, or a new query parameter in the key. Also check Redis-side `evicted_keys` and `used_memory`. Rising evictions mean memory pressure (a config change reduced `maxmemory`, or values grew), not a key change. `MONITOR` sampled briefly or `redis-cli --hotkeys` can confirm."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-02',
    difficulty: 'hard',
    question: 'This handler runs at ~50 req/s per pod. About 2% of calls hit the "not found" branch. What do you observe after a few seconds of traffic?',
    code: {
      language: 'typescript',
      code: `const pool = new Pool({ max: 10 }); // connectionTimeoutMillis: default

app.get('/orders/:id', async (req, res) => {
  const client = await pool.connect();
  const { rows } = await client.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).end();
  client.release();
  res.json(rows[0]);
});`,
    },
    options: [
      'Nothing — the pg Pool reclaims idle clients after idleTimeoutMillis',
      'The 404 requests fail with a connection error but other requests work',
      'After ~10 not-found requests the pool is empty and all requests on the pod hang indefinitely',
      'Postgres rejects new connections with "too many clients already"',
    ],
    correct: [2],
    explanation: 'Every 404 leaks a checked-out client. At 1 leak/s the 10 slots are gone in ~10 s; with the default connectionTimeoutMillis of 0, pool.connect() waits forever, so every request hangs. idleTimeoutMillis only applies to clients that were released back to the pool. Postgres never sees more than 10 connections from this pod, so it does not return "too many clients".',
    followUps: [
      {
        "q": "You fix the leak with try/finally. How do you make sure a future leak can't hang the pod forever again?",
        "a": "Set `connectionTimeoutMillis` (e.g. 2,000 ms) so `pool.connect()` rejects instead of waiting forever. A leak then turns into visible errors instead of a silent hang. Export pool gauges (`pool.totalCount`, `idleCount`, `waitingCount`) and alert when `waitingCount` stays above 0. Prefer `pool.query()` for single statements (it releases automatically) and a `withTransaction` helper for multi-statement work, and ban raw `pool.connect()` in lint rules. A load test that exercises the 404 path in CI catches it before production."
      },
      {
        "q": "In production, how do you prove that connections are leaking (rather than just slow queries) when pods start hanging?",
        "a": "Compare the pool's view with Postgres's. If `pg_stat_activity` shows this pod's 10 connections in state `idle` (not in a transaction, no query running) while the pod's `waitingCount` grows, the connections are checked out but unused: a leak. Slow queries would show `active` with long `query_start` ages. A heap snapshot also shows checked-out `Client` objects that are still referenced. Logging a stack trace on acquire, enabled briefly, pinpoints which code path never releases."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-03',
    difficulty: 'expert',
    question: 'Two admins update the same product price at nearly the same time using this code. Users sometimes see the old price for the full TTL. What is the most robust fix?',
    code: {
      language: 'typescript',
      code: `async function setPrice(id: string, price: number) {
  await db.query('UPDATE products SET price = $1 WHERE id = $2', [price, id]);
  const row = await db.query('SELECT * FROM products WHERE id = $1', [id]);
  await redis.set('product:' + id, JSON.stringify(row.rows[0]), 'EX', 3600);
}`,
    },
    options: [
      'Reverse the order: write Redis first, then Postgres',
      'Delete the key after the commit instead of setting it, and let the next read repopulate',
      'Wrap the UPDATE and SELECT in one transaction so the SET always has the latest row',
      'Lower the TTL from 3,600 s to 60 s',
    ],
    correct: [1],
    explanation: 'The SETs from the two writers can arrive in either order, so the earlier price can land last and stick for an hour. Deleting after the commit removes the ordering problem: the next reader loads the current row. A transaction does not order the two Redis SETs. Writing Redis first makes it worse, because a failed DB write leaves a price that was never stored. A shorter TTL only shortens how long the bug is visible.',
    followUps: [
      {
        "q": "With delete-after-commit, a reader can still cache a stale value. Describe the race and how to close it.",
        "a": "Reader R misses and reads the old price from the DB. Writer W commits the new price and deletes the key. Then R, which was slow, SETs the old price, and it stays for the full TTL. Mitigations: delete twice (immediately, and again after a short delay such as 500 ms, the \"delayed double delete\"); or version the value, where R writes with `SET` only if its version is not older than the DB row version (check it in a Lua script); or have readers use a lease token (as Memcache leases do) that a delete invalidates, so R's later SET is rejected."
      },
      {
        "q": "There are 20 services that write prices. How do you make invalidation reliable without each one remembering to delete the key?",
        "a": "Drive invalidation from the database's change stream. CDC (Debezium on the Postgres WAL) emits every committed price change to Kafka, and a single invalidator consumes it and deletes the cache key. Every writer is covered, ordering matches commit order, and a crashed invalidator resumes from its offset instead of losing deletes. Keep a TTL as a safety net. Monitor the invalidator's lag, since lag equals the maximum staleness window."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-04',
    difficulty: 'expert',
    question: 'A Node service does heavy password hashing with the async crypto.pbkdf2 API. Under load, its outbound HTTP calls to other services also get slow even though those services are healthy. Which operations compete for the same libuv thread pool (default size 4)? Select ALL that apply.',
    options: [
      'fs.readFile of templates',
      'crypto.pbkdf2 (async) hashing',
      'dns.lookup performed by http.request when resolving a hostname',
      'Reading bytes from an already-open TCP socket to Postgres',
      'JSON.parse of the HTTP response body',
    ],
    correct: [0, 1, 2],
    explanation: 'Async fs operations, the crypto KDFs (pbkdf2, scrypt) and dns.lookup (getaddrinfo, used by default for outbound HTTP) all run on the libuv thread pool, so hashing can delay DNS resolution and make outbound calls slow. Socket I/O uses the OS event mechanism (epoll/kqueue), not the pool. JSON.parse runs on the main JavaScript thread, so it blocks the event loop, not the thread pool.',
    followUps: [
      {
        "q": "Would raising UV_THREADPOOL_SIZE to 64 fix it? What are the risks?",
        "a": "It helps by giving DNS and fs work free threads even while hashing runs, but pbkdf2 is CPU-bound. On a 2-vCPU pod, 64 threads all hashing still compete for 2 cores, so hashing doesn't get faster and the main JS thread also gets less CPU, raising event-loop lag. It must be set before the pool is first used (an env var at startup). Better fixes: cap concurrent hashing with a semaphore sized near the core count, move hashing to a dedicated worker or service, and avoid `dns.lookup` contention with keep-alive agents or a DNS cache."
      },
      {
        "q": "How would you prove in production that the thread pool, not the network, is what's slowing outbound calls?",
        "a": "Time the phases of outbound requests. With `diagnostics_channel` or undici/http timing hooks, record DNS lookup, connect and TTFB separately. If DNS lookup time spikes (tens to hundreds of ms) exactly when hashing load rises, while connect and TTFB stay flat, the thread pool is the culprit. You can also measure queueing directly by timing a trivial `fs.stat` or `dns.lookup('localhost')`. A flamegraph won't show it well, because the waiting is idle time, not CPU."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-05',
    difficulty: 'expert',
    question: 'A NestJS API\'s p99 creeps from 90 ms to 900 ms over about 18 hours after every deploy, and a restart resets it. Heap used grows about 60 MB per hour, GC traces show mark-sweep pauses getting longer, and CPU rises although traffic is flat. Which code patterns could cause this? Select ALL that apply.',
    options: [
      'A module-level Map used as a per-user memo cache, with no size bound or TTL',
      'A request handler that calls configEmitter.on(\'change\', …) on a singleton emitter and never removes the listener',
      'AsyncLocalStorage used to carry the request ID through each request',
      'JSON.parse of a 5 MB upstream response on every request',
      'A prom-client histogram labelled with the raw URL path, e.g. /orders/8f3a…',
    ],
    correct: [0, 1, 4],
    explanation: 'Monotonic heap growth that a restart clears is a leak: something long-lived keeps references. An unbounded module-level Map, listeners piling up on a singleton emitter (each closure pins its request objects; Node warns with MaxListenersExceededWarning), and a metric label with unbounded cardinality (a new time series per order ID, held in memory until the process dies) all grow forever, and the larger old-space makes every mark-sweep slower. AsyncLocalStorage stores are released when the request\'s async context ends. A big JSON.parse creates garbage and GC churn, but it is freed, so it raises CPU per request without a steady climb over hours. Confirm by diffing two heap snapshots taken an hour apart.',
    followUps: [
      {
        "q": "Walk through how you'd find the leak with heap snapshots without taking the production service down.",
        "a": "Take two heap snapshots about an hour apart from one pod, after removing it from the load balancer or picking a canary, since a snapshot pauses the process for seconds and roughly doubles memory briefly. Load both into Chrome DevTools and use the Comparison view sorted by `# Delta` or retained size. A growing count of closures, Map entries, or prom-client `Histogram` children identifies the type. The retainers panel shows the chain, e.g. `configEmitter._events.change[4,213]` points directly at the listener leak. Alternatively, use `--heapsnapshot-near-heap-limit` to capture one automatically."
      },
      {
        "q": "You find the metrics label leak (raw URL paths). How do you fix it and stop it recurring across 30 services?",
        "a": "Label with the route template, not the path: use `req.route.path`, i.e. `/orders/:id`, or the NestJS handler name, and map unmatched routes to `unknown`. Also cap cardinality in code: a shared metrics wrapper that rejects label values outside an allow-list, or warns once a metric exceeds N series. On the platform side, alert on Prometheus `scrape_series_added` and per-job series counts, and enforce `sample_limit` in scrape configs so a single bad deploy can't blow up Prometheus either."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-06',
    difficulty: 'hard',
    question: 'During a flash sale one Redis Cluster primary hits 100% CPU while the other 11 idle. Profiling shows 90% of its commands are GET on a single key. What is the most effective immediate mitigation?',
    options: [
      'Add 6 more shards and rebalance slots across the cluster',
      'Raise the Redis io-threads setting to use more cores',
      'Switch maxmemory-policy to allkeys-lfu so the key stays resident',
      'Add a short-TTL in-process cache for that key on every API pod',
    ],
    correct: [3],
    explanation: 'The key hashes to one slot on one node, so resharding cannot split it. A 1–2 s local cache cuts reads to about one per pod per TTL. The eviction policy is irrelevant, because the key is not being evicted. io-threads help with socket I/O, but commands still execute on one main thread, so a single hot key stays limited by that thread.',
    followUps: [
      {
        "q": "The local cache has a 1 s TTL on 200 pods. The product's price changes during the sale. What's the worst-case staleness, and is it acceptable?",
        "a": "Worst-case staleness is the local TTL plus Redis staleness: about 1 s after Redis is updated. Each pod refreshes independently, so different pods may show different prices for up to 1 s. Redis load becomes about 200 reads/s for that key instead of tens of thousands. For display that's fine. For checkout, re-read the authoritative price (DB or Redis) at the moment of purchase. If even 1 s is too long, publish an invalidation on Redis pub/sub so pods drop the local copy immediately, keeping the TTL as a fallback."
      },
      {
        "q": "Hot keys aren't known in advance. How do you detect and handle them automatically?",
        "a": "Detect at the client: sample keys per pod (e.g. a count-min sketch or top-K over the last 10 s) and mark any key exceeding a threshold, such as 1,000 reads/s, as hot. Hot keys get the in-process cache automatically, with a short TTL. On the server side, `redis-cli --hotkeys` (with an LFU policy) or per-slot command stats help in an investigation. For known events (flash sales), pre-warm the local caches. If a hot key is also written heavily, split it into N replicated copies (`key#0..N`) with readers picking one at random."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-07',
    difficulty: 'expert',
    question: 'Redis becomes unreachable for 30 s. The service uses this client for cache reads, with a DB fallback in a catch block. What do users experience during the outage?',
    code: {
      language: 'typescript',
      code: `const redis = new Redis(process.env.REDIS_URL); // ioredis defaults

async function getUser(id: string) {
  try {
    const hit = await redis.get('user:' + id);
    if (hit) return JSON.parse(hit);
  } catch { /* fall through to DB */ }
  return db.users.findById(id);
}`,
    },
    options: [
      'A clean fallback: redis.get rejects immediately and every request goes to the DB',
      'Instant 500s, because ioredis throws synchronously when disconnected',
      'Requests stall for seconds while commands sit in the offline queue and are retried, then fall through to the DB in a burst',
      'Requests get the last cached value, because ioredis keeps a local replica of recent keys',
    ],
    correct: [2],
    explanation: 'With enableOfflineQueue true and maxRetriesPerRequest 20 (the defaults), commands are queued while disconnected and rejected only after many reconnect attempts, which takes seconds. Requests hang, in-flight concurrency grows, and then they reach the DB together. Nothing is thrown synchronously, and ioredis keeps no local copy of values. Set enableOfflineQueue false, maxRetriesPerRequest 1, and a commandTimeout.',
    followUps: [
      {
        "q": "You set enableOfflineQueue false and commandTimeout 80 ms. Now Redis is down for 30 s at 20k req/s. What does the DB see, and what else is needed?",
        "a": "Every request fails Redis in ≤ 80 ms and falls through, so the DB receives the full 20k req/s instead of the usual few hundred misses: a 40–100× jump that will kill it. Fail-fast Redis alone just moves the outage. You also need DB protection: a concurrency cap per pod with load shedding (serve a degraded response or 503 for some requests), request coalescing per key so 20k requests for 2k distinct products become about 2k DB reads, and a small in-process LRU of recent values to keep serving popular items while Redis is down."
      },
      {
        "q": "How would you test this failure mode before the next real Redis failover?",
        "a": "Run a game day in staging under production-like load: block Redis traffic with a network policy or `iptables` drop (a black hole, not a refused connection, since a black hole is the worse case), and separately trigger a real failover. Measure p99, error rate, DB CPU and connections, and how fast the system recovers when Redis returns, including a stampede against a cold cache. Pass criteria: no request slower than about commandTimeout plus DB time, and DB CPU stays under its limit thanks to shedding. Automate it as a recurring chaos test."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-08',
    difficulty: 'hard',
    question: 'DB CPU climbed from 40% to 95% overnight with no deploy and flat traffic. pg_stat_statements shows one query\'s calls unchanged but mean_exec_time up from 3 ms to 450 ms. What is the best first action?',
    options: [
      'EXPLAIN (ANALYZE) it, and if row estimates are far off, ANALYZE the table',
      'Run VACUUM FULL on the table to remove bloat',
      'Raise max_connections so queued queries can run in parallel',
      'Add a read replica and route that query to it',
    ],
    correct: [0],
    explanation: 'Unchanged calls with a 150× jump in mean time and no code change points to a plan regression, usually stale statistics after data growth. EXPLAIN confirms it and ANALYZE often fixes it within seconds. More connections add contention on a CPU-bound box. VACUUM FULL takes an ACCESS EXCLUSIVE lock and rewrites the table. A replica would run the same bad plan.',
    followUps: [
      {
        "q": "ANALYZE fixes it for now. A month later it regresses again. How do you stop the plan from flipping?",
        "a": "Find out why the statistics go stale. Large tables with the default `autovacuum_analyze_scale_factor` (10%) re-analyse rarely, so lower it per table (e.g. 0.01) or set an `autovacuum_analyze_threshold`. If the planner misestimates because of correlated columns, add extended statistics (`CREATE STATISTICS … (dependencies, ndistinct)`). If skew is the problem, raise the column's statistics target. As guardrails, track per-query mean time from `pg_stat_statements` with alerting, and enable `auto_explain` for slow queries so you capture the bad plan when it happens."
      },
      {
        "q": "EXPLAIN shows the plan is fine and the estimates are accurate, yet the query is still 450 ms. What do you check next?",
        "a": "Check whether the data changed rather than the plan: table or index bloat (`pgstattuple`, dead tuples after a failed autovacuum), so the same plan reads many more pages; or the working set no longer fits in cache, so `EXPLAIN (ANALYZE, BUFFERS)` shows many `read` versus `hit` buffers. Also check lock waits (`wait_event` in `pg_stat_activity`) and whether a long-running transaction is blocking vacuum, so dead rows pile up. Compare BUFFERS output between a good and a bad execution to see which it is."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-09',
    difficulty: 'expert',
    question: 'Postgres (16 vCPU) is at 100% CPU with heavy row-lock waits on a hot inventory row. The on-call raises each of 30 pods\' pool size from 10 to 30. What most likely happens?',
    options: [
      'Throughput stays flat or drops and latency rises, from more contention on the same cores and locks',
      'Throughput rises roughly 3×, because more queries can run in parallel',
      'Nothing changes, because Postgres caps active queries at the core count',
      'Lock waits go away, because each transaction now gets its own connection',
    ],
    correct: [0],
    explanation: 'The DB is already CPU- and lock-saturated. Allowing 900 instead of 300 concurrent sessions adds context switching, lock-manager work and longer queues for the same hot row, so throughput stays flat or falls and latency rises. Postgres has no built-in cap on active queries tied to core count. Lock waits come from the data access pattern, not the number of connections.',
    followUps: [
      {
        "q": "What pool size would you actually target for a 16 vCPU Postgres, and how do you enforce it across 30 pods?",
        "a": "A common starting point for active connections is about (cores × 2) + effective spindles, so around 32–40 for 16 vCPU, then tune with load tests. Since 30 pods × 10 = 300 connections far exceeds that, put PgBouncer in transaction mode in front of Postgres with `default_pool_size` ≈ 40. App pods can keep their own pools of 10, but only about 40 queries run at once and the rest wait cheaply in PgBouncer. Watch out: transaction mode breaks session features such as prepared statements (older versions) and `SET` without `LOCAL`."
      },
      {
        "q": "The real bottleneck is the hot inventory row. How do you increase checkout throughput on that one item?",
        "a": "Shorten and reduce lock hold time: do a single conditional `UPDATE inventory SET qty = qty - 1 WHERE sku = $1 AND qty > 0` with no surrounding long transaction and no network calls while the lock is held. If that's still not enough, split stock into N bucket rows (`sku, bucket`) and decrement a random bucket with stock, retrying another when one is empty. Or move the hot counter to Redis with an atomic `DECR` or a Lua check-and-decrement, then persist asynchronously with reconciliation. The aim is less time spent holding the one lock, not more connections waiting for it."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-10',
    difficulty: 'medium',
    question: 'You need the p99 latency per route over the last 5 minutes from a Prometheus histogram. Which query is correct?',
    code: {
      language: 'text',
      code: `A: avg by (route) (histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])))
B: histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))
C: histogram_quantile(0.99, sum by (route) (rate(http_request_duration_seconds_bucket[5m])))
D: quantile by (route) (0.99, rate(http_request_duration_seconds_sum[5m]))`,
    },
    options: ['A', 'B', 'C', 'D'],
    correct: [1],
    explanation: 'B sums bucket rates across pods while keeping the le label, which histogram_quantile needs, then computes the quantile per route. A averages per-pod quantiles, which is not a valid way to combine percentiles. C drops le, so the function has no buckets to work with. D takes a quantile of per-series sum rates across series, which is not a latency percentile.',
    followUps: [
      {
        "q": "Your histogram buckets are 0.1, 0.5, 1, 5 s. The query reports p99 = 0.95 s. How much do you trust that number?",
        "a": "Not much. `histogram_quantile` interpolates linearly inside the bucket, so 0.95 s only means \"somewhere between 0.5 s and 1 s\", with roughly equal probability anywhere in that range. If your SLO threshold is 300 ms there isn't even a bucket boundary near it. Fix the buckets to bracket what you care about (e.g. 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2), or use native/exponential histograms, which give fine resolution automatically. For an SLO, a precise \"fraction under 300 ms\" from the `le=\"0.3\"` bucket beats an interpolated percentile."
      },
      {
        "q": "You want a fleet-wide p99 SLO alert across 3 clusters with separate Prometheus servers. How do you compute it correctly?",
        "a": "Don't average the three p99s, for the same reason you can't average per-pod quantiles. Aggregate buckets first: either federate or remote-write the `_bucket` rates into a global store (Thanos, Mimir) and run `histogram_quantile(0.99, sum by (le) (rate(..._bucket[5m])))` there, or alert on a ratio that composes cleanly, such as good requests ÷ total, with each cluster exporting recording rules for `sum(rate(bucket{le=\"0.3\"}))` and `sum(rate(count))`. Ratios and bucket counts add up across clusters; percentiles don't."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-11',
    difficulty: 'hard',
    question: 'A 5-minute-TTL key for an expensive dashboard aggregate is read 15K times/s, and every expiry spikes DB CPU. Which changes actually reduce the number of concurrent recomputations? Select ALL that apply.',
    options: [
      'Shorten the TTL to 30 s so each rebuild handles less stale data',
      'Coalesce misses per pod so concurrent callers share one in-flight promise',
      'Take a SET NX PX lock so one worker rebuilds while others serve the previous value',
      'Move Redis to a bigger instance type with more memory',
      'Refresh probabilistically before expiry, with the chance rising as expiry approaches',
    ],
    correct: [1, 2, 4],
    explanation: 'Coalescing, a rebuild lock with stale serving, and early probabilistic refresh (XFetch) all cut how many callers recompute at the same time. A shorter TTL makes stampedes ten times more frequent. A bigger Redis instance does nothing, because the bottleneck is the database doing the recompute.',
    followUps: [
      {
        "q": "You implement the SET NX lock with stale serving. The pod holding the lock crashes mid-rebuild. What happens?",
        "a": "The lock expires after its PX TTL (e.g. 5–10 s; set it a bit above the worst-case rebuild time). Meanwhile, readers keep getting the stale value, because the hard TTL is longer than the soft TTL, so users see nothing wrong. After expiry, the next request that notices staleness takes the lock and rebuilds. If the rebuild sometimes takes longer than the lock TTL, two pods may rebuild at once. That's harmless here, just wasted work, so don't over-engineer. Do alert if the value's age keeps exceeding the soft TTL by a lot, since rebuilds may be failing."
      },
      {
        "q": "Explain the XFetch condition and how it behaves for a 250 ms recompute and a 5-minute TTL at 15k reads/s.",
        "a": "XFetch refreshes early if `now - delta × beta × ln(rand()) ≥ expiry`, where delta is the measured recompute time (0.25 s) and beta ≈ 1. With t seconds left, a single read triggers with probability e^(−t/(delta×beta)). At 2 s left that is e^−8 ≈ 0.03% per read, but 15k reads/s turns it into about 5 triggers per second. So the refresh typically starts 2–3 s before expiry, and several pods can trigger in the same second. Combine XFetch with singleflight or the lock so those triggers collapse into one rebuild. A higher beta refreshes even earlier."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-12',
    difficulty: 'expert',
    question: 'A NestJS pod with a 2-vCPU limit shows 52% CPU utilisation, event-loop lag p99 of 1.8 s, and failing liveness probes. The HPA targets 70% CPU and has not scaled. What is the most accurate reading?',
    options: [
      'The single JavaScript thread is saturated (one core ≈ 50% of 2 vCPU), so the HPA metric under-reports load',
      'The pod has CPU headroom, so the lag must come from slow downstream I/O',
      'CFS throttling is holding the pod at 52%, so raising the CPU limit fixes it',
      'The libuv thread pool is full, which shows up as low CPU and high lag',
    ],
    correct: [0],
    explanation: 'Node runs JavaScript on one thread. A pegged event loop on a 2-vCPU pod reads as about 50% utilisation, so a 70% target is never reached. Slow downstream I/O does not add event-loop lag, because awaiting I/O does not block the loop. Throttling would appear at the limit, not at half of it. A full thread pool slows fs, DNS and crypto callbacks but does not by itself produce seconds of loop lag.',
    followUps: [
      {
        "q": "What metric should the HPA scale on instead, and how do you wire it?",
        "a": "Scale on event-loop saturation or work in flight, not pod CPU. Export `nodejs_eventloop_lag_p99_seconds` (prom-client `monitorEventLoopDelay`) or in-flight requests per pod, expose it through prometheus-adapter or KEDA as a custom metric, and target e.g. lag p99 < 100 ms or in-flight per pod < 50. Alternatively, set the CPU request to 1 core per Node process so 70% of the request means 70% of the event loop. Then HPA CPU utilisation is meaningful, and the second vCPU is used only for GC and libuv."
      },
      {
        "q": "Should you run 2 Node processes per pod (cluster mode) to use both vCPUs, or 1 process with smaller pods?",
        "a": "Usually prefer one process per pod with about 1 vCPU each, plus more pods. Kubernetes handles balancing, health checks and restarts per process, metrics stay simple, and a crash affects one loop. Cluster mode inside a pod hides individual worker health from probes, needs process supervision, and makes per-process metrics aggregate badly. Cluster mode makes sense when per-pod overhead (sidecars, memory for large shared caches) dominates. Either way, size the work per event loop, and keep about 0.5 vCPU of headroom for GC and the thread pool."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-13',
    difficulty: 'medium',
    question: 'pg_stat_activity shows 180 sessions from checkout-service in state "idle in transaction", many for 2–5 s. Postgres CPU is 20%. What is the most likely cause?',
    options: [
      'Autovacuum is holding those sessions open while it cleans the orders table',
      'The queries are waiting on disk I/O',
      'PgBouncer session mode leaves sessions idle between requests',
      'The service opens a transaction and awaits a slow network call before committing',
    ],
    correct: [3],
    explanation: '"Idle in transaction" means a transaction is open but the client has sent no statement, so the application is busy elsewhere, typically on an HTTP call or queue publish inside the transaction. Autovacuum runs as its own background worker. A pooled session idle between requests shows as "idle", not "idle in transaction". Sessions waiting on I/O show as "active" with an IO wait event.',
    followUps: [
      {
        "q": "Postgres is at 20% CPU, so why does it matter that 180 sessions sit idle in transaction for 2–5 s?",
        "a": "Several problems follow. Each one holds a pooled connection, so the app pool exhausts and requests queue while the DB idles. Any row locks taken (`FOR UPDATE`, updates) are held for seconds, blocking other writers to those rows. Their snapshot prevents vacuum from removing dead tuples in the meantime, so with constant traffic, bloat builds up. Behind PgBouncer they also pin server connections, so the pooler can't multiplex. The fix is to move the network call out of the transaction and add `idle_in_transaction_session_timeout` as a backstop."
      },
      {
        "q": "How do you find exactly which code path opens these transactions?",
        "a": "Look at the `query` column of `pg_stat_activity` for those sessions: it shows the last statement executed before going idle, often a distinctive `SELECT … FOR UPDATE` or `UPDATE`. Set `application_name` per service and per route, or add a SQL comment with the route and trace ID (sqlcommenter), so the session points back to the code. Correlate with traces: a DB span followed by an HTTP span inside the same transaction span shows the culprit. Log when a transaction stays open longer than N ms in your transaction helper."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-14',
    difficulty: 'expert',
    question: 'After this change, N+1 queries dropped sharply, but a week later support reports users occasionally seeing another tenant\'s customer name. Why?',
    code: {
      language: 'typescript',
      code: `// customer.loader.ts
const loader = new DataLoader<string, Customer>(async (ids) => {
  const rows = await repo.findByIds(ids as string[]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!);
});

@Injectable() // default singleton scope
export class CustomerLoader {
  load(id: string) { return loader.load(id); }
}`,
    },
    options: [
      'The batch function returns results in a different order from the keys',
      'The loader is module-level and singleton, so its memo cache persists across requests and tenants',
      'DataLoader batches keys from concurrent requests into one query, which breaks row-level security',
      'The non-null assertion on byId.get(id) returns undefined for missing ids',
    ],
    correct: [1],
    explanation: 'DataLoader memoises every key for the lifetime of the instance. A module-level singleton lives for the life of the process, so cached rows are served to later requests (stale data), and if tenant context should shape the result, across tenants. The ordering is correct because the code maps over ids. Batching across concurrent requests only happens because the instance is shared, which is the same root cause. Missing ids give undefined, not another tenant\'s data. Fix it with a request-scoped loader.',
    followUps: [
      {
        "q": "You make the loader request-scoped. In NestJS, how do you do that without making every provider request-scoped (which hurts performance)?",
        "a": "Don't mark the whole service `Scope.REQUEST`, because that cascades and re-instantiates the dependency chain per request. Instead create loaders in the request context: build a `loaders` object in GraphQL's context factory (`context: ({ req }) => ({ loaders: createLoaders(req.tenantId) })`), or store them in AsyncLocalStorage at request start. Resolvers read `ctx.loaders.customer.load(id)`. Singleton services stay singletons, and the loaders, together with their caches, are collected when the request ends."
      },
      {
        "q": "After the fix, the dashboard issues one batched query per field per request. Each request loads 50 orders with customers and products. How many queries now, and how do you verify it stays that way?",
        "a": "Ideally 3 queries: orders, then one batched `WHERE id = ANY($1)` for customers and one for products, instead of 1 + 50 + 50 = 101. Verify with a test that counts queries per GraphQL operation, e.g. wrap the pg client in tests and assert at most N queries for the dashboard query. In production, add per-request query count and DB time as span attributes and alert if a route's queries per request jumps. Without that guard, a new nested resolver silently reintroduces N+1."
      }
    ],
  },
  {
    id: 'prod-performance-mcq-15',
    difficulty: 'hard',
    question: 'An endpoint fans out in parallel to 20 search shards and waits for all of them. Each shard answers within 50 ms 99% of the time but occasionally takes 1 s. What fraction of endpoint requests will hit at least one slow shard?',
    options: [
      'About 1%, since each shard is slow only 1% of the time',
      'About 5%, because the slow calls overlap across shards',
      'About 18%, since 1 − 0.99^20 ≈ 0.18',
      'About 20%, since it is 20 shards × 1%',
    ],
    correct: [2],
    explanation: 'The request is slow if any of the 20 independent calls is slow: 1 − 0.99^20 ≈ 18.2%, so the shard p99 becomes roughly the endpoint p82. 1% ignores the fan-out. 20% is a linear approximation that overcounts cases where several shards are slow at once. Fixes include hedged requests, per-shard timeouts with partial results, and fewer shards per query.',
    followUps: [
      {
        "q": "Product wants the endpoint's p99 under 50 ms with 20 shards. What per-shard tail does that require?",
        "a": "The endpoint is slow if any shard is slow, so you need `1 − p^20 ≤ 1%`, i.e. `p ≥ 0.99^(1/20) ≈ 0.9995`. Each shard must answer within 50 ms 99.95% of the time: its p99.95 must be at most 50 ms. Check: 1 − 0.9995^20 ≈ 1.0%. Achieving that from the shards directly is hard, which is why fan-out systems use hedging or partial results instead of demanding a better shard tail."
      },
      {
        "q": "You add hedged requests: after 50 ms with no answer, send a second request to a replica of that shard. What does it cost and what does it buy?",
        "a": "Hedges fire only for the ~1% of shard calls slower than 50 ms, so extra shard load is about 1%. If the slow and fast replicas are independent, a call is now slow only if both are slow, about 0.01 × 0.01 = 0.0001. Then 1 − 0.9999^20 ≈ 0.2% of endpoint requests are slow, down from about 18%. Caveats: if slowness is correlated (an overloaded cluster, a heavy query), the hedge is slow too and only adds load, so cap hedges with a budget (e.g. ≤ 5%) and cancel the losing request."
      }
    ],
  },
];

const topic: Topic = {
  id: 'prod-performance',
  phase: 'production',
  order: 1,
  title: 'Incidents I: Slowness & Data-Layer Pain',
  subtitle: 'War-room playbooks for slow systems: databases, connection pools, N+1, caches, Redis outages and a blocked Node event loop — symptoms, first 5 minutes, fixes, and the interview answer.',
  estimatedMinutes: 110,
  sources: [
    'PostgreSQL documentation — Monitoring Database Activity, pg_stat_statements, auto_explain',
    'PgBouncer documentation — pooling modes and feature matrix',
    'Redis documentation — INFO, latency and hot keys, Redis Cluster specification',
    'ioredis README — offline queue, retry strategy, timeouts',
    'Node.js documentation — perf_hooks, worker_threads, libuv thread pool',
    'Google SRE Book — Monitoring distributed systems (golden signals)',
  ],
  tags: ['incident-response', 'postgres', 'connection-pool', 'pgbouncer', 'n+1', 'dataloader', 'redis', 'cache-stampede', 'hot-key', 'event-loop', 'nodejs', 'promql'],
  cheatSheet,
  sections,
  codeChallenges,
  interviewQuestions,
  envelopeQuestions,
  test,
};

export default topic;
