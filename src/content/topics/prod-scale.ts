import type { Topic } from '../../types';

const topic: Topic = {
  id: 'prod-scale',
  phase: 'production',
  order: 2,
  title: 'Incidents II: Scale & Growth',
  subtitle:
    'Traffic 10× and 100×, hot servers and hot shards, read/write saturation, replication lag, sharding and zero-downtime migrations, global latency, static content, big uploads and millions of jobs',
  estimatedMinutes: 110,
  sources: [
    'Designing Data-Intensive Applications — Ch 5 Replication & Ch 6 Partitioning',
    'Production war stories and SRE practice (Google SRE Book — Handling Overload)',
  ],
  tags: ['incident', 'scaling', 'sharding', 'replication-lag', 'hot-shard', 'migration', 'cdn', 'multi-region', 'background-jobs', 'war-room'],
  cheatSheet: [
    'Incident rhythm: Symptoms → first 5 minutes (dashboards, saturation, what changed) → mitigate (shed, scale, flag off) → root cause → permanent fix. Mitigate before you understand.',
    'At 10× the stateless tier scales out; the stateful tier (DB connections, primary CPU/IOPS, hot cache keys) is what actually breaks. At 100× limits you never knew existed break: NAT/SNAT ports, fds, per-account API quotas, LB LCUs, log pipelines.',
    'Hot server with normal peers → balancing problem (sticky sessions, long-lived connections, bad hash) or per-request work skew (hot tenant/key). Compare per-instance RPS vs CPU first.',
    'Read scaling ladder: fix queries/indexes → cache (hit ratio ≥ 90–95%) → read replicas (mind lag) → CQRS/read models → shard. Write scaling ladder: batch → async/queue → reduce write amplification (indexes) → partition/shard.',
    'Replication lag: check replay_lag in pg_stat_replication or now() − pg_last_xact_replay_timestamp() on the replica. Causes: long queries on replica (conflicts), write bursts/bulk jobs, network, under-sized replica. Fix read-your-writes with LSN/timestamp stickiness.',
    'Shard key = the query you run most + even distribution + no hot spots over time. user_id good; created_at bad (all writes hit the newest shard); country bad (skew). Celebrity/whale tenants need special handling.',
    'Zero-downtime migration: dual-write (prefer CDC) → backfill → verify (checksums, shadow reads) → switch reads (flag) → switch writes → keep reverse sync for rollback → decommission.',
    'Global latency is physics: ~100 km ≈ 1 ms RTT in fibre ×2 real-world; Sydney↔Virginia ≈ 200 ms RTT. Terminate TLS at the edge, cache at CDN, serve reads regionally, avoid sequential cross-ocean calls.',
    'Static assets and large uploads should never touch app servers: CDN with long cache TTL + content-hashed filenames; uploads via presigned URLs straight to object storage.',
    'Millions of jobs: bulk enqueue, idempotent handlers (jobId dedup), bounded concurrency sized to the DB, per-tenant fairness, jittered schedules (no "everything at 00:00"), autoscale on queue depth/age.',
  ],
  sections: [
    {
      heading: '1. Incident: traffic is 10× and still climbing',
      body: `**Intuition:** a 10× surge is a stress test you didn't schedule. The stateless tier is a rubber band; the database is a glass of water — it doesn't stretch, it overflows.

**Symptoms:** p99 rising across all endpoints, 5xx/timeouts climbing, HPA at or near \`maxReplicas\`, DB CPU > 80%, connection pool wait time rising, queue depth growing.

**First 5 minutes:**
1. **Is it real traffic?** Split RPS by route, client, ASN, user-agent. A marketing push, a viral post, a retry storm, or a bot/scraper look the same on a total-RPS graph.
2. **Which tier saturates first?** USE method (Utilisation, Saturation, Errors) top-down: edge/LB → app pods (CPU, event-loop lag) → pools (wait time) → DB (CPU, IOPS, locks) → cache (CPU, network, evictions) → third parties (429s).
3. **What changed?** Deploys, flags, config, cron jobs in the last hour.

**Root causes to expect:** DB connection exhaustion as pods scale out; primary CPU from a few heavy queries whose cost grows linearly; cache hit ratio dropping because working set exceeds memory; downstream rate limits; autoscaling slower than the ramp.

**Fix now (in order of speed):**
- Shed or degrade: kill-switch expensive features (recommendations, search-as-you-type), serve stale cache, return 429/503 with \`Retry-After\` for low-priority clients.
- Scale manually beyond HPA limits *if the bottleneck is the app tier*; if it's the DB, adding pods makes it worse.
- Rate limit or block abusive sources at the edge (WAF).
- Increase cache TTLs for hot read paths.

**Fix permanently:** capacity model with load tests at 3× forecast peak; per-tier headroom targets; pre-scaling for known events; priority-based load shedding; connection pooler in front of the DB; read replicas/caching for the top read endpoints.

**What to say in the interview:** "I first confirm the traffic is legitimate and find the first saturated resource — usually the DB, not the pods. I mitigate with load shedding and feature degradation before scaling, because scaling the wrong tier amplifies the failure."`,
      code: [
        {
          language: 'text',
          title: 'PromQL — first-5-minutes triage queries',
          code: `# 1. Who is the traffic? top routes / clients by RPS
topk(10, sum by (route) (rate(http_requests_total[1m])))
topk(10, sum by (client_id) (rate(http_requests_total[1m])))

# 2. Error ratio and p99 by route
sum by (route) (rate(http_requests_total{code=~"5.."}[1m]))
  / sum by (route) (rate(http_requests_total[1m]))
histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))

# 3. Saturation: HPA headroom, event-loop lag, pool wait, DB CPU
kube_horizontalpodautoscaler_status_current_replicas
  / kube_horizontalpodautoscaler_spec_max_replicas
max by (pod) (nodejs_eventloop_lag_p99_seconds)
histogram_quantile(0.99, sum by (le) (rate(db_pool_acquire_seconds_bucket[5m])))
rate(node_cpu_seconds_total{instance=~"pg-primary.*",mode!="idle"}[1m])

# 4. Cache effectiveness
sum(rate(redis_keyspace_hits_total[1m]))
  / (sum(rate(redis_keyspace_hits_total[1m])) + sum(rate(redis_keyspace_misses_total[1m])))`,
        },
      ],
      keyPoints: [
        'Legitimacy first: segment traffic before scaling anything.',
        'Find the first saturated resource; scaling another tier can amplify the failure.',
        'Shed and degrade before scaling — it works in seconds.',
      ],
    },
    {
      heading: '2. Incident: planning for 100× — what breaks, in order',
      body: `**Intuition:** at 10× you hit the walls you know; at 100× you hit walls you didn't know were there — quotas, kernel limits and the laws of physics.

**Symptoms (if it happens unplanned):** things that "never fail" fail: DNS timeouts, NAT gateway errors, "too many open files", third-party 429s, the log pipeline falling hours behind, the monitoring system itself going dark.

**What typically breaks, roughly in order (from 1k → 100k RPS):**

| # | Breaks | Why | Early signal |
|---|---|---|---|
| 1 | DB connections | pods × pool size > max_connections | pool acquire wait, "too many clients" |
| 2 | DB primary CPU/IOPS | writes and uncached reads scale linearly | CPU > 70%, IO wait, lock waits |
| 3 | Hot cache keys / cache NIC | one key at 100k+ reads/s saturates a single Redis shard (~100k–200k ops/s, or NIC bandwidth for large values) | one shard's CPU/network maxed |
| 4 | Outbound limits | NAT gateway / SNAT port exhaustion (~64k ports per destination IP:port per source IP), third-party API quotas | connection timeouts to externals |
| 5 | Kernel & runtime limits | file descriptors, ephemeral ports, conntrack table full, event-loop saturation | EMFILE, "nf_conntrack: table full" |
| 6 | Load balancer & ingress | LB capacity units, ingress controller CPU, TLS handshakes/s | LB 5xx, surge queue |
| 7 | Async backbone | Kafka partitions cap consumer parallelism; queue backlogs | consumer lag rising |
| 8 | Observability & cost | logs/traces volume ×100; cardinality explosion | ingestion lag, bill |
| 9 | Humans & process | on-call, deploy pipeline, manual ops per tenant | toil |

**Fix permanently (the 100× architecture):** stateless everything with autoscaling; DB behind a pooler, reads on replicas and caches, writes partitioned (sharding or per-domain databases); hot-key protection (local in-process cache, key replication); async processing for everything not on the critical path; CDN and edge; connection reuse (keep-alive, HTTP/2) to externals; sampling for traces and logs; cell-based architecture to cap blast radius.

**What to say in the interview:** "I'd walk the request path and ask at each hop what the per-instance ceiling is and how it scales — connections, CPU, IOPS, bandwidth, quotas. The first thing to break is almost always shared state: connections to the primary and hot keys, then the invisible limits like NAT ports and third-party quotas."`,
      diagram: `  100x traffic -> where it hits a ceiling first

  CDN/edge ── LB ── ingress ── app pods ──┬── pooler ── PG primary  <- 1,2
   (scales)  (LCU)  (CPU/TLS)  (scales)   ├── Redis shard (hot key) <- 3
                                          ├── NAT gw ── 3rd-party   <- 4
                                          └── Kafka (partitions)    <- 7
  every hop: fds, conntrack, ephemeral ports                          <- 5`,
      keyPoints: [
        'Shared state breaks first: DB connections, primary, hot keys.',
        'Invisible ceilings at 100×: NAT ports, conntrack, quotas, LB units, logging.',
        'Cells limit blast radius when a single shared component can no longer scale.',
      ],
    },
    {
      heading: '3. Incident: one server is overloaded while its peers are idle',
      body: `**Intuition:** if one checkout lane has 30 people and the others have 2, the problem is the queueing rule, not the number of cashiers.

**Symptoms:** one instance at 90–100% CPU / high latency; its peers at 20%; errors correlated to that instance; autoscaling adds instances but the hot one stays hot.

**First 5 minutes:**
- Compare **per-instance RPS vs CPU**. High RPS on the hot node → *distribution* problem. Same RPS, much higher CPU → *work* problem.
- Check LB algorithm and session affinity settings; connection counts per backend.
- Look for a hot key/tenant (top-N request keys on that instance), a stuck loop, GC thrashing (memory near limit), a noisy neighbour on the host (steal time).

**Root causes:**
- **Sticky sessions / IP hash** — a large corporate NAT or a mobile carrier's CGNAT puts thousands of users behind one IP.
- **Long-lived connections** (HTTP/2, gRPC, WebSockets) opened before scale-out stay pinned.
- **Round-robin with heterogeneous requests** — one node gets several expensive requests at once. Least-outstanding-requests or power-of-two-choices balances better.
- **Consistent hashing without virtual nodes** — uneven ring segments.
- **Slow-start missing** — a freshly added instance gets full share while its caches/JIT are cold (or conversely, least-connections floods a new node).

**Fix now:** drain/restart the hot instance (buys time only if it's a balancing issue), disable stickiness, apply per-key rate limits for the hot tenant.

**Fix permanently:** stateless servers (session in Redis/JWT), least-request or P2C balancing, L7 balancing for HTTP/2 (mesh or client-side), \`maxConnectionAge\`, virtual nodes (100–200 per server) in consistent hashing, LB slow-start windows, hot-key caching.

**What to say in the interview:** "One hot node among cold peers is a symptom of either distribution or work skew — per-node RPS tells me which in 30 seconds. Adding capacity doesn't help either case."`,
      code: [
        {
          language: 'nginx',
          title: 'nginx upstream: least_conn instead of ip_hash, with passive health checks',
          code: `upstream api_backend {
    # ip_hash;                  # removed: CGNAT/corporate NAT pins thousands of users to one node
    least_conn;                 # route to the backend with fewest active connections
    server 10.0.1.11:3000 max_fails=3 fail_timeout=10s;
    server 10.0.1.12:3000 max_fails=3 fail_timeout=10s;
    server 10.0.1.13:3000 max_fails=3 fail_timeout=10s;
    keepalive 64;               # reuse upstream connections (avoid ephemeral port churn)
}

server {
    listen 443 ssl http2;
    location /api/ {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";          # required for upstream keepalive
        proxy_next_upstream error timeout;       # retry only on connect errors/timeouts
        proxy_next_upstream_tries 2;
        proxy_connect_timeout 1s;
        proxy_read_timeout 10s;
    }
}`,
        },
      ],
      keyPoints: [
        'Per-instance RPS vs CPU separates distribution skew from work skew.',
        'IP hash + NAT and long-lived connections are the classic culprits.',
        'Least-request / power-of-two-choices beats round-robin for uneven requests.',
      ],
    },
    {
      heading: '4. Incident: read traffic is too high for the database',
      body: `**Intuition:** most systems are read-heavy (10:1 to 100:1). Every read that reaches the primary is a read you could have answered cheaper somewhere else.

**Symptoms:** primary CPU high while write rate is flat; \`pg_stat_statements\` dominated by a few SELECTs; buffer cache hit ratio dropping (< 99% on OLTP); replica CPU idle because nothing reads from it.

**First 5 minutes:**
- Top queries by **total time** (not mean): \`pg_stat_statements\` ordered by \`total_exec_time\`.
- Check \`EXPLAIN (ANALYZE, BUFFERS)\` for the top 3: seq scans, missing index, sorting on disk.
- Cache hit ratio at the app cache; which endpoints miss.

**Root causes:** missing/wrong indexes, a new feature doing N reads per request, cache TTLs too short or cache evicting under memory pressure, all reads pinned to primary "for safety", analytics/report queries running against the OLTP primary.

**Fix now:** add the missing index \`CONCURRENTLY\`; raise cache TTLs; route clearly stale-tolerant endpoints (catalog, profiles of others, counts) to replicas; move reports to a replica or kill them.

**Fix permanently — the read-scaling ladder:**
1. Query and index hygiene (often 10–100× cheaper per query).
2. Application cache (cache-aside, hit ratio ≥ 90–95%), request coalescing for hot keys.
3. Read replicas with lag-aware routing (next section).
4. Materialised read models / CQRS (denormalised views, Elasticsearch for search, precomputed feeds).
5. Edge/CDN caching for public GET responses.
6. Only then: shard — sharding for reads alone is usually premature.

**What to say in the interview:** "Before adding replicas I'd make each read cheaper and cache the hot ones; replicas multiply capacity linearly but also introduce lag semantics the product must accept."`,
      code: [
        {
          language: 'sql',
          title: 'Postgres: find the reads that are burning the primary',
          code: `-- Top statements by total time (needs pg_stat_statements)
SELECT round(total_exec_time)            AS total_ms,
       calls,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       rows / GREATEST(calls, 1)         AS rows_per_call,
       round(100 * shared_blks_hit::numeric
             / NULLIF(shared_blks_hit + shared_blks_read, 0), 2) AS hit_pct,
       left(query, 80)                   AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- Tables being sequentially scanned a lot (missing index candidates)
SELECT relname, seq_scan, seq_tup_read, idx_scan,
       seq_tup_read / GREATEST(seq_scan, 1) AS avg_rows_per_seq_scan
FROM pg_stat_user_tables
ORDER BY seq_tup_read DESC
LIMIT 10;

-- Who is reading right now, and for how long
SELECT pid, now() - query_start AS runtime, state, wait_event_type, left(query, 60)
FROM pg_stat_activity
WHERE state <> 'idle' AND backend_type = 'client backend'
ORDER BY runtime DESC
LIMIT 10;`,
        },
      ],
      keyPoints: [
        'Order by total_exec_time — a 2 ms query called 50k/s beats a 5 s report.',
        'Cheaper reads and caching come before replicas; replicas before sharding.',
        'Move analytics off the OLTP primary.',
      ],
    },
    {
      heading: '5. Incident: replication lag — "my update disappeared"',
      body: `**Intuition:** a replica is a stenographer typing up the primary's speech; if the speaker talks faster than she types, anyone reading her notes is behind.

**Symptoms:** users update their profile, refresh, see the old value; "order not found" right after checkout; lag alerts; replicas occasionally cancel queries with "canceling statement due to conflict with recovery".

**First 5 minutes:**
- On the primary: \`SELECT application_name, state, write_lag, flush_lag, replay_lag FROM pg_stat_replication;\`
- On the replica: \`SELECT now() - pg_last_xact_replay_timestamp();\` (note: this grows when the primary is idle, so compare with write activity) and byte lag via \`pg_wal_lsn_diff\`.
- What's writing? Bulk backfills, batch jobs, a big \`UPDATE\`/\`DELETE\`, index builds, vacuum of a large table.
- Is the replica busy? Long queries on the replica with \`hot_standby_feedback\` / \`max_standby_streaming_delay\` settings can pause replay.

**Root causes:** write bursts exceeding single-threaded replay (Postgres replays WAL in one process per replica), under-provisioned replica (IO), long-running replica queries blocking replay, network saturation cross-region, large transactions (one 10 GB transaction is applied only when it commits).

**Fix now:** pause/throttle the batch job; route read-after-write paths to the primary; take the lagging replica out of the read pool (lag-aware LB health check).

**Fix permanently:**
- **Read-your-writes**: after a write, pin that user's reads to the primary for N seconds, or record the commit LSN and only read from a replica whose \`pg_last_wal_replay_lsn()\` ≥ that LSN.
- **Monotonic reads**: stick a user to one replica so they never go back in time.
- Batch jobs throttle themselves on replication lag.
- Right-size replicas like the primary; separate replicas for analytics with different conflict settings.
- Product: show optimistic UI ("saved") using the client's local state.

**What to say in the interview:** "Lag is normal; the bug is routing a read that needs its own write to a replica. I fix it with session consistency — LSN tokens or time-based stickiness — and make lag a routing input, not just an alert."`,
      code: [
        {
          language: 'typescript',
          title: 'LSN-based read-your-writes routing (pg)',
          code: `import { Pool } from 'pg';

const primary = new Pool({ host: 'pg-primary', max: 20 });
const replicas = [new Pool({ host: 'pg-replica-1', max: 20 }), new Pool({ host: 'pg-replica-2', max: 20 })];

// After a write, capture the WAL position and return it to the client (cookie/header/session)
export async function writeAndGetLsn(sql: string, params: unknown[]): Promise<string> {
  const client = await primary.connect();
  try {
    await client.query(sql, params);
    const { rows } = await client.query('SELECT pg_current_wal_lsn()::text AS lsn');
    return rows[0].lsn; // e.g. '3/1A2B3C40'
  } finally {
    client.release();
  }
}

// For reads, use a replica only if it has replayed at least the client's last write
export async function readConsistent(sql: string, params: unknown[], minLsn?: string) {
  if (!minLsn) return replicas[Math.floor(Math.random() * replicas.length)].query(sql, params);
  for (const replica of replicas) {
    const { rows } = await replica.query(
      'SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn AS caught_up', [minLsn],
    );
    if (rows[0].caught_up) return replica.query(sql, params);
  }
  return primary.query(sql, params); // no replica caught up yet: fall back to primary
}`,
        },
      ],
      keyPoints: [
        'Measure lag on both sides; beware idle-primary false positives.',
        'Postgres replays WAL single-threaded per replica — big write bursts lag.',
        'Read-your-writes via LSN tokens or short primary stickiness.',
      ],
    },
    {
      heading: '6. Incident: write traffic is too high for the primary',
      body: `**Intuition:** reads can be copied; writes can't. Every write has exactly one home, so the only ways out are: write less, write smarter, or split the home.

**Symptoms:** primary CPU/IO saturated with high \`INSERT/UPDATE\` rates; WAL generation 100s of MB/s; commit latency rising (fsync); lock waits on hot rows; replicas lagging; checkpoints spiking IO.

**First 5 minutes:**
- Writes/s by table (\`pg_stat_user_tables.n_tup_ins/upd/del\` deltas) and top write statements.
- Hot-row contention: \`pg_locks\` waits, same row updated by many sessions (counters, inventory, "last_seen_at").
- Index count on the hot table — each index multiplies write cost (write amplification).
- Checkpoint and WAL metrics; disk IOPS vs provisioned.

**Root causes:** per-event single-row writes (no batching), a counter row updated by every request, "last_seen_at" updates on every API call, too many secondary indexes, synchronous audit logging to the same DB, a new feature writing per page view.

**Fix now:** disable/sample non-essential writes (analytics events, last_seen), turn on batching in the offending worker, raise IOPS if on cloud storage (quick but costly).

**Fix permanently — the write-scaling ladder:**
1. **Write less**: debounce (update \`last_seen_at\` at most once per 5 min), drop unused indexes, avoid updating unchanged rows.
2. **Batch**: multi-row \`INSERT\`, \`COPY\`; one commit per 1,000 rows instead of 1,000 commits (fsync per commit dominates).
3. **Absorb bursts asynchronously**: write to Kafka/queue, consumers write in batches; the API returns 202.
4. **Contention**: sharded counters (N sub-rows summed on read), Redis \`INCR\` with periodic flush, append-only ledger instead of in-place updates.
5. **Move workloads**: time-series/event data to a write-optimised store (Cassandra, ClickHouse, Timescale); audit logs to their own store.
6. **Partition/shard** the remaining hot tables (next section).

**What to say in the interview:** "Writes have one home, so I first remove unnecessary writes and batch the rest — batching alone often gives 10×. Queues smooth bursts. Only when the steady-state write rate exceeds one node do I shard."`,
      code: [
        {
          language: 'typescript',
          title: 'Batching writer: coalesce events into multi-row inserts',
          code: `import { Pool } from 'pg';

const pool = new Pool({ max: 5 });
type PageView = { userId: string; path: string; at: Date };

const buffer: PageView[] = [];
const MAX_BATCH = 1000;
const MAX_WAIT_MS = 200;
let timer: NodeJS.Timeout | null = null;

export function recordPageView(e: PageView) {
  buffer.push(e);
  if (buffer.length >= MAX_BATCH) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), MAX_WAIT_MS);
}

async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  const batch = buffer.splice(0, MAX_BATCH);
  if (!batch.length) return;
  // one statement, one commit, one fsync for up to 1000 rows (vs 1000 commits)
  await pool.query(
    'INSERT INTO page_views (user_id, path, at) SELECT * FROM unnest($1::uuid[], $2::text[], $3::timestamptz[])',
    [batch.map((b) => b.userId), batch.map((b) => b.path), batch.map((b) => b.at)],
  );
}
// NOTE: in-memory buffers lose data on crash; for must-not-lose events,
// write to Kafka first and batch in the consumer.`,
        },
      ],
      keyPoints: [
        'Write less (debounce, fewer indexes) before writing faster.',
        'Batching amortises commit/fsync cost — often an order of magnitude.',
        'Hot rows need sharded counters or append-only designs, not bigger machines.',
      ],
    },
    {
      heading: '7. Incident: the database needs horizontal scaling — do we shard, and how?',
      body: `**Intuition:** sharding is cutting a cake so several people can eat at once. It works beautifully — until someone wants a bite that spans three slices.

**Symptoms that justify sharding (after the ladders above):** steady-state write rate or dataset size exceeds what one primary can hold with headroom (e.g. sustained > 60–70% of a well-tuned node's write capacity, multi-TB tables where vacuum/index builds take many hours, backup/restore time beyond the RTO), and the biggest instance class is already in use.

**First 5 minutes of the decision (not the incident):**
- Which tables are big/hot? Often 2–3 tables are 90% of load — shard those, keep the rest unsharded ("functional partitioning" first: split by domain into separate databases).
- What is the dominant access pattern? That becomes the **shard key**.
- Which queries cross shards (joins, global uniqueness, admin reports)?

**Options:**

| Approach | How | Pros | Cons |
|---|---|---|---|
| Vertical split by domain | orders DB, users DB, payments DB | simple, team-aligned | no help for one huge table |
| Postgres native partitioning | one node, many partitions | pruning, cheap drops of old data | still one node's CPU/IO |
| App-level sharding | router maps key → shard | full control | you own resharding, cross-shard queries |
| Distributed SQL (Citus, Vitess, CockroachDB, Spanner, Yugabyte) | DB routes and rebalances | transparent-ish, online rebalancing | cost, latency of distributed txns, new failure modes |

**Routing schemes:** hash(key) mod N (simple, painful to reshard — nearly all keys move), **consistent hashing** / many logical shards mapped onto fewer physical nodes (e.g. 4,096 logical shards on 8 nodes; move logical shards when adding nodes), **directory/lookup** (tenant → shard table, enables moving individual whales).

**What to say in the interview:** "Sharding is the last rung. I'd split by domain first, then shard the few hot tables by the key that most queries filter on, using many logical shards over fewer physical nodes so resharding is moving buckets, not rehashing everything."`,
      code: [
        {
          language: 'typescript',
          title: 'Logical-shard router: 4096 buckets mapped to physical clusters',
          code: `import { createHash } from 'node:crypto';
import { Pool } from 'pg';

const LOGICAL_SHARDS = 4096; // fixed forever; physical mapping changes

// Loaded from config/etcd; moving a bucket = copy data, then flip this mapping
const bucketToCluster: string[] = Array.from({ length: LOGICAL_SHARDS }, (_, b) =>
  b < 2048 ? 'pg-cluster-a' : 'pg-cluster-b',
);
const pools: Record<string, Pool> = {
  'pg-cluster-a': new Pool({ host: 'pg-a', max: 20 }),
  'pg-cluster-b': new Pool({ host: 'pg-b', max: 20 }),
};

export function bucketFor(tenantId: string): number {
  // stable hash; never use a language's non-stable hashCode
  const h = createHash('md5').update(tenantId).digest();
  return h.readUInt32BE(0) % LOGICAL_SHARDS;
}

export function poolFor(tenantId: string): Pool {
  return pools[bucketToCluster[bucketFor(tenantId)]];
}

// Every query in the orders domain must carry the shard key
export async function getOrders(tenantId: string, limit = 50) {
  return poolFor(tenantId).query(
    'SELECT * FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2',
    [tenantId, limit],
  );
}`,
        },
      ],
      keyPoints: [
        'Exhaust caching, replicas, batching and domain splits first.',
        'Shard only the few tables that need it, by the dominant query key.',
        'Many logical shards → few physical nodes makes resharding a bucket move.',
      ],
    },
    {
      heading: '8. Incident: one shard is overloaded (bad shard key / hot tenant)',
      body: `**Intuition:** you divided the city into postal zones by first letter of the street name — and discovered half the streets start with "M".

**Symptoms:** one shard at 95% CPU, others at 20–30%; latency high only for a subset of customers; that shard's disk growing much faster; replication lag only on that shard.

**First 5 minutes:**
- Per-shard QPS, CPU, storage — confirm it's skew, not a failing node.
- Top shard keys on the hot shard by request count and by rows touched (logs, \`pg_stat_statements\` with tenant in a comment, sampling).
- Is it **one key** (a celebrity, a whale tenant, a viral product) or **a range** (time-based key where all new writes land on the latest shard)?

**Root causes:**
- **Monotonic keys with range sharding** (\`created_at\`, auto-increment IDs): every insert hits the last shard.
- **Low-cardinality keys** (\`country\`, \`plan\`): India shard holds 40% of users.
- **Whale tenants**: B2B where one customer is 30% of traffic.
- **Celebrity / viral keys**: one product or user read by millions.
- \`mod N\` with a poor hash or unlucky key distribution.

**Fix now:** cache the hot reads (even 1–5 s TTL collapses a celebrity key); rate-limit the whale's heaviest endpoints; scale up the hot shard vertically; add replicas to that shard for reads.

**Fix permanently:**
- Re-key: hash of a high-cardinality key; composite key \`(tenant_id, hash(entity_id))\` for large tenants.
- Dedicated shard(s) for whales via a directory mapping; split a logical shard.
- **Key salting** for hot write keys: \`key#0..key#15\` spread across shards, aggregate on read.
- Time-series: hash + time bucketing instead of pure time ranges.
- Continuous skew monitoring per shard with alerts on the max/median ratio.

**What to say in the interview:** "A shard key must match access patterns *and* distribute load over time. When one shard is hot I determine whether it's one key or a range; one key gets caching or salting, a whale gets its own shard via a directory, a range needs re-keying."`,
      code: [
        {
          language: 'sql',
          title: 'Find the hot keys on the hot shard (sampled request log in Postgres/ClickHouse)',
          code: `-- Requests per tenant in the last 10 minutes on shard 7
SELECT tenant_id,
       count(*)                                   AS requests,
       round(100.0 * count(*) / sum(count(*)) OVER (), 2) AS pct_of_shard,
       sum(rows_touched)                          AS rows_touched
FROM request_log
WHERE shard_id = 7
  AND ts > now() - interval '10 minutes'
GROUP BY tenant_id
ORDER BY requests DESC
LIMIT 20;

-- Skew across shards: max / median QPS
SELECT max(qps) / percentile_cont(0.5) WITHIN GROUP (ORDER BY qps) AS skew_ratio
FROM (
  SELECT shard_id, count(*) / 600.0 AS qps
  FROM request_log
  WHERE ts > now() - interval '10 minutes'
  GROUP BY shard_id
) s;`,
        },
      ],
      keyPoints: [
        'Distinguish one hot key from a hot range — the fixes differ.',
        'Monotonic and low-cardinality keys are the usual bad shard keys.',
        'Whales need directory-based placement; celebrities need caching/salting.',
      ],
    },
    {
      heading: '9. Incident: migrating data (resharding, new DB) with zero downtime',
      body: `**Intuition:** moving house while still living in it — you set up the new place, forward the mail to both addresses, move the boxes, check nothing is missing, then hand back the keys to the old place (but keep a spare for a while).

**Symptoms that trigger it:** single DB at its limit, resharding needed, moving MySQL → Postgres or on-prem → cloud, splitting a monolith DB per service.

**The playbook:**
1. **Dual-write path.** Prefer **CDC** (Debezium reading the WAL/binlog → Kafka → writer into the new store) over app-level dual writes — app dual writes without a transaction across both stores silently diverge on partial failure.
2. **Backfill** historical data with a snapshot + CDC offset so no change is lost between snapshot and stream (Debezium's initial snapshot handles this; manual backfills must be idempotent upserts keyed by PK with version/updated_at checks).
3. **Verify**: row counts and per-range checksums; **shadow reads** — read from both, compare, log mismatches, serve the old result.
4. **Switch reads** gradually behind a flag (1% → 100%), watching mismatch rate and latency.
5. **Switch writes**: the new store becomes source of truth; **reverse CDC** (new → old) keeps the old store current for rollback.
6. **Decommission** after a bake period (weeks), when rollback is no longer needed.

**Pitfalls:** ordering (CDC per-key ordering via Kafka partition key = primary key), sequence/ID generation conflicts (use UUIDs/ULIDs or offset sequences), timezone/collation/precision differences between engines, triggers and constraints that exist only in one store, and the cutover moment for writes (a brief write freeze of seconds per shard is often acceptable and far simpler than perfect live cutover).

**What to say in the interview:** "I make the migration reversible at every step: CDC for dual writes, verification with checksums and shadow reads, flag-controlled read switch, and reverse replication after the write switch so rollback is a flag flip."`,
      diagram: `  phase 1-3                         phase 4-5
  app ──writes──► OLD DB            app ──writes──► NEW DB (source of truth)
   │               │ WAL/binlog      │               │ reverse CDC
   │            Debezium ► Kafka     │            Debezium ► Kafka
   │                        │        │                        │
   │                   NEW DB ◄──────┘ reads (flag %)     OLD DB (rollback)
   └─ reads: OLD (+ shadow-read NEW, compare, log diffs)`,
      code: [
        {
          language: 'typescript',
          title: 'Shadow-read comparator during migration',
          code: `import { Logger } from '@nestjs/common';

const log = new Logger('shadow-read');

interface OrderRepo { findById(id: string): Promise<Record<string, unknown> | null>; }

export class MigratingOrderRepo implements OrderRepo {
  constructor(
    private readonly oldRepo: OrderRepo,
    private readonly newRepo: OrderRepo,
    private readonly readFromNewPct: () => number,    // flag: 0..100
    private readonly shadowPct = 10,                  // compare 10% of reads
  ) {}

  async findById(id: string) {
    const useNew = Math.random() * 100 < this.readFromNewPct();
    const primary = useNew ? this.newRepo : this.oldRepo;
    const result = await primary.findById(id);

    if (Math.random() * 100 < this.shadowPct) {
      const other = useNew ? this.oldRepo : this.newRepo;
      // fire-and-forget: never add shadow latency or errors to the user path
      other.findById(id).then((shadow) => {
        if (JSON.stringify(normalize(shadow)) !== JSON.stringify(normalize(result))) {
          log.warn({ msg: 'mismatch', id, servedFrom: useNew ? 'new' : 'old' });
        }
      }).catch((err) => log.warn({ msg: 'shadow read failed', id, err: String(err) }));
    }
    return result;
  }
}

// normalise engine differences (timestamp precision, key order, numeric types)
function normalize(row: Record<string, unknown> | null) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 23) : v]));
}`,
        },
      ],
      keyPoints: [
        'CDC beats app-level dual writes for consistency.',
        'Verify with checksums and shadow reads before switching.',
        'Reverse replication after cutover keeps rollback cheap.',
      ],
    },
    {
      heading: '10. Incident: global users see high latency',
      body: `**Intuition:** light in fibre travels ~200,000 km/s — about 1 ms of round trip per 100 km in the ideal case. No code optimisation beats geography.

**Symptoms:** p75/p99 page load or API latency 3–5× higher for APAC/LatAm users than US users (from RUM/CDN logs), mobile users timing out, TTFB dominated by connection setup.

**First 5 minutes:**
- Latency by **client region** (RUM, CDN logs), broken into DNS, TCP connect, TLS, TTFB, download.
- How many **sequential round trips** does the page/app make to origin? (N API calls in series × 200 ms RTT.)
- Are static assets cached at the edge (CDN hit ratio per region)?

**Root causes:** single-region origin; TLS terminated at origin (TCP + TLS 1.3 = 2 RTTs, TLS 1.2 = 3 RTTs before the first byte); chatty API (waterfall of dependent calls); no CDN or low hit ratio; cross-region calls inside the backend (service in us-east calling a DB in eu-west).

**Fix now:** put a CDN in front of static and cacheable API responses; enable edge TLS termination with persistent, pooled connections from edge to origin; turn on HTTP/2/3 and keep-alive; raise cache TTLs; batch/aggregate API calls (BFF or GraphQL) to cut round trips.

**Fix permanently:**
- **Regional read path**: deploy stateless app + read replicas/caches in the users' regions; writes go to the home region (acceptable for most apps where writes are rarer).
- **Data residency by user**: home each user's data in their nearest region (geo-partitioning), route by user.
- **Active-active multi-region** only where needed — conflict resolution and write latency are hard.
- GeoDNS/anycast to route users to the nearest healthy region.
- Keep cross-region hops off the synchronous path.

**What to say in the interview:** "First I quantify round trips × RTT — Sydney to Virginia is ~200 ms RTT, so four sequential calls plus handshakes are over a second before any server work. Edge TLS and CDN caching cut handshakes, API aggregation cuts round trips, and regional read stacks remove the ocean from the read path."`,
      code: [
        {
          language: 'bash',
          title: 'Measure where the time goes from a remote region',
          code: `# Break a request into DNS, TCP, TLS, TTFB and total (run from an APAC host)
curl -o /dev/null -s -w '
dns:     %{time_namelookup}s
connect: %{time_connect}s
tls:     %{time_appconnect}s
ttfb:    %{time_starttransfer}s
total:   %{time_total}s
' https://api.example.com/v1/feed

# Direct to origin vs via CDN edge (compare connect/tls: edge should be ~10-30 ms)
curl -o /dev/null -s -w 'origin tls=%{time_appconnect}s ttfb=%{time_starttransfer}s\\n' \\
  --resolve api.example.com:443:203.0.113.10 https://api.example.com/v1/feed

# Is the CDN caching it? look for HIT/MISS and Age
curl -sI https://cdn.example.com/static/app.3f9a1c.js | grep -iE 'x-cache|age|cache-control'`,
        },
      ],
      keyPoints: [
        'Count sequential round trips × RTT before optimising code.',
        'Edge TLS termination saves 2–3 long-haul RTTs per new connection.',
        'Regional read stacks; writes to a home region; active-active only when required.',
      ],
    },
    {
      heading: '11. Incident: static content and large uploads overload the app servers',
      body: `**Intuition:** your chefs are carrying furniture. App servers exist to run business logic; bytes-in-bytes-out work belongs to CDNs and object storage.

**Symptoms (static):** app pods' network egress saturated, event loop busy with file streaming, high CPU on gzip, memory spikes; latency for API calls rises when a new app bundle is released or an image goes viral.

**Symptoms (uploads):** requests hanging for minutes, memory spikes (whole files buffered in RAM), 413/504 at the proxy, pods OOMKilled during uploads, uploads failing at 90% on mobile networks and restarting from zero.

**First 5 minutes:**
- Egress bytes per pod and per route (static paths vs API); CDN hit ratio.
- Proxy limits: \`client_max_body_size\`, request timeouts, LB idle timeout.
- Memory profile during uploads: is the handler buffering (\`multer\` memoryStorage, \`body-parser\` limits)?

**Root causes:** assets served by Express \`static\` from the pods; no CDN or \`Cache-Control: no-cache\` everywhere; cache-busting by query string disabled at the CDN; uploads proxied through the API instead of direct-to-storage; no chunking/resume.

**Fix now:** put the CDN in front of \`/static\` with long TTLs; block huge uploads at the edge; stream uploads to disk/object storage rather than memory.

**Fix permanently:**
- **Static**: content-hashed filenames (\`app.3f9a1c.js\`) with \`Cache-Control: public, max-age=31536000, immutable\`; HTML with short TTL; origin = object storage bucket, not app pods.
- **Uploads**: client requests a **presigned URL** (or multipart upload with part URLs) from the API, uploads directly to S3/GCS; the storage emits an event → processing worker (virus scan, thumbnails). Multipart parts of 8–100 MB allow parallelism and resume from the last completed part. (Deep dive: object-storage topic.)
- Images: on-the-fly resizing at the edge/CDN image service with cached variants.

**What to say in the interview:** "Static bytes and large uploads should bypass my compute entirely: CDN with immutable hashed assets for downloads, presigned multipart uploads direct to object storage for uploads, and an event-driven pipeline for post-processing."`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS: issue a presigned PUT instead of proxying the bytes',
          code: `import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const s3 = new S3Client({ region: 'ap-south-1' });
const MAX_BYTES = 100 * 1024 * 1024; // single PUT up to 100 MB; bigger -> multipart

@Controller('uploads')
export class UploadsController {
  @Post('presign')
  async presign(@Body() dto: { contentType: string; size: number }) {
    if (!/^image\\/(png|jpeg|webp)$/.test(dto.contentType)) throw new BadRequestException('type');
    if (dto.size > MAX_BYTES) throw new BadRequestException('use multipart');
    const key = 'uploads/' + randomUUID();
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: 'user-media',
        Key: key,
        ContentType: dto.contentType,      // client must send the same header
        ContentLength: dto.size,           // signed: cannot upload a larger body
      }),
      { expiresIn: 300 },                  // 5 minutes
    );
    return { key, url };                   // bytes go client -> S3, never through us
  }
}`,
        },
      ],
      keyPoints: [
        'Hashed filenames + immutable caching = near-100% CDN hit ratio for assets.',
        'Presigned (multipart) uploads keep bytes off the app tier and allow resume.',
        'Post-process asynchronously from storage events.',
      ],
    },
    {
      heading: '12. Incident: millions of background jobs',
      body: `**Intuition:** a job queue is a kitchen ticket rail. Adding tickets is free; the kitchen (DB, third parties) is not. Most job incidents are the rail overwhelming the kitchen, or one table's order blocking everyone else's.

**Symptoms:** queue depth and **age of oldest job** rising; Redis memory climbing (BullMQ/Sidekiq store jobs in Redis); workers at full concurrency but DB CPU pegged; the same job processed twice; nightly "00:00 spike" of every tenant's scheduled job; a single tenant's bulk import delaying everyone's password-reset emails.

**First 5 minutes:**
- Depth, enqueue rate vs completion rate, oldest-job age, failure/retry rate — per queue and per tenant.
- Worker saturation vs downstream saturation: if the DB is the bottleneck, more workers make it worse.
- Redis memory and eviction policy (\`noeviction\` is required for queues — evicting job keys loses jobs).

**Root causes:** fan-out jobs enqueued one-by-one (millions of round trips), no per-queue priorities (bulk shares with critical), cron schedules aligned to the same second, non-idempotent handlers + retries/visibility timeouts causing duplicates, completed jobs never removed (Redis memory leak), unbounded retries on permanent failures.

**Fix now:** pause the bulk queue; move critical jobs to a separate queue/worker pool; lower worker concurrency to protect the DB; purge completed-job history; dead-letter permanently failing jobs.

**Fix permanently:**
- **Separate queues by priority/SLA** with dedicated workers (critical, default, bulk).
- **Fairness**: per-tenant queues or group rate limits so one tenant can't monopolise workers.
- **Bulk enqueue** (\`addBulk\`, pipelining) and hierarchical fan-out (one job per 1,000 items, not per item).
- **Idempotency**: deterministic \`jobId\` for dedup, idempotent handlers (upserts, processed-keys table).
- **Jitter** schedules (\`hash(tenant) % 3600\` seconds offset).
- **Autoscale workers on queue age/depth** (KEDA), bounded by the downstream's capacity.
- Retention: \`removeOnComplete\`/\`removeOnFail\` with counts or ages.
- Beyond ~10–50k jobs/s or when replay/audit matter, move to Kafka/SQS-style durable logs.

**What to say in the interview:** "I size worker concurrency to the downstream, not to the queue depth. I isolate queues by priority and tenant, make handlers idempotent with deterministic job IDs, and autoscale on the age of the oldest job because that's what the user experiences."`,
      code: [
        {
          language: 'typescript',
          title: 'BullMQ: bulk enqueue with dedup IDs, priorities, rate limit and retention',
          code: `import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({ host: 'redis-jobs', maxRetriesPerRequest: null });
const bulk = new Queue('invoice-bulk', { connection });

// Enqueue 1M invoices as 1,000 chunk jobs, in batches, with deterministic IDs (dedup on re-run)
export async function enqueueMonthlyInvoices(tenantIds: string[], month: string) {
  const CHUNK = 1000;
  for (let i = 0; i < tenantIds.length; i += CHUNK * 50) {
    const jobs = [];
    for (let j = i; j < Math.min(i + CHUNK * 50, tenantIds.length); j += CHUNK) {
      jobs.push({
        name: 'chunk',
        data: { month, tenantIds: tenantIds.slice(j, j + CHUNK) },
        opts: {
          jobId: 'inv-' + month + '-' + j,               // same run twice = no duplicates
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          delay: Math.floor(Math.random() * 600_000),    // jitter over 10 min: no 00:00 spike
          removeOnComplete: { age: 3600, count: 1000 },  // bound Redis memory
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      });
    }
    await bulk.addBulk(jobs);                            // one round trip per 50 chunks
  }
}

// Concurrency sized for the DB (e.g. 8 workers x 5 = 40 concurrent), plus a global rate limit
new Worker('invoice-bulk', async (job) => {
  for (const tenantId of job.data.tenantIds) {
    await generateInvoiceIdempotent(tenantId, job.data.month); // upsert on (tenant, month)
  }
}, { connection, concurrency: 5, limiter: { max: 200, duration: 1000 } });

declare function generateInvoiceIdempotent(tenantId: string, month: string): Promise<void>;`,
        },
      ],
      keyPoints: [
        'Worker concurrency is bounded by the downstream, not the backlog.',
        'Isolate queues by priority and tenant; jitter schedules.',
        'Deterministic job IDs + idempotent handlers make retries and re-runs safe.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'prod-scale-cc-1',
      title: 'Fix the replica router that makes users\' updates vanish',
      context:
        'To relieve the primary, a teammate routed every SELECT to read replicas. Since then support tickets say "I changed my address, refreshed, and it reverted" and "order not found" right after checkout. Replica lag is usually 50–300 ms but spikes to 20 s during the nightly import. One replica sometimes lags for minutes.',
      task: 'Rewrite the data-access layer so reads that depend on the caller\'s own recent writes are always consistent, stale-tolerant reads still use replicas, and badly lagging replicas are taken out of rotation automatically.',
      starter: {
        language: 'typescript',
        title: 'db.ts (starter)',
        code: `import { Pool } from 'pg';

const primary = new Pool({ host: 'pg-primary' });
const replicas = [new Pool({ host: 'pg-replica-1' }), new Pool({ host: 'pg-replica-2' })];
let rr = 0;

// every read goes to a replica, round-robin
export function query(sql: string, params: unknown[] = []) {
  if (/^\\s*select/i.test(sql)) {
    rr = (rr + 1) % replicas.length;
    return replicas[rr].query(sql, params);
  }
  return primary.query(sql, params);
}

// usage in a controller:
//   await query('UPDATE users SET address = $1 WHERE id = $2', [addr, id]);
//   return query('SELECT * FROM users WHERE id = $1', [id]);   // may be stale!`,
      },
      hints: [
        'Routing by SQL verb ignores who is reading and what they just wrote. What per-session information would tell you a replica is "fresh enough"?',
        'Postgres exposes pg_current_wal_lsn() on the primary and pg_last_wal_replay_lsn() on replicas.',
        'A replica that lags 2 minutes should not receive traffic at all — how would you track lag continuously instead of per query?',
      ],
      solution: {
        language: 'typescript',
        title: 'db.ts (solution)',
        code: `import { Pool } from 'pg';

const primary = new Pool({ host: 'pg-primary', max: 20, connectionTimeoutMillis: 2000 });
const replicas = ['pg-replica-1', 'pg-replica-2'].map((host) => ({
  host,
  pool: new Pool({ host, max: 20, connectionTimeoutMillis: 2000 }),
  replayLsn: '0/0',
  lagSeconds: Infinity,
}));
const MAX_LAG_S = 5;

// Background lag tracker: one cheap query per replica per second, not per request
setInterval(async () => {
  for (const r of replicas) {
    try {
      const { rows } = await r.pool.query(
        "SELECT pg_last_wal_replay_lsn()::text AS lsn, " +
        "COALESCE(EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp()), 0) AS lag",
      );
      r.replayLsn = rows[0].lsn;
      r.lagSeconds = Number(rows[0].lag);
    } catch {
      r.lagSeconds = Infinity;                      // unreachable -> out of rotation
    }
  }
}, 1000).unref();

// Compare LSNs like '3/1A2B3C40' numerically (hi/lo 32-bit halves)
function lsnGte(a: string, b: string) {
  const [ah, al] = a.split('/').map((x) => parseInt(x, 16));
  const [bh, bl] = b.split('/').map((x) => parseInt(x, 16));
  return ah !== bh ? ah > bh : al >= bl;
}

export async function write(sql: string, params: unknown[]): Promise<{ lsn: string }> {
  const c = await primary.connect();
  try {
    await c.query(sql, params);
    const { rows } = await c.query('SELECT pg_current_wal_lsn()::text AS lsn');
    return { lsn: rows[0].lsn };                     // caller stores it in the session/cookie
  } finally {
    c.release();
  }
}

// consistency: 'strong' -> primary; 'session' -> replica that has replayed minLsn; 'stale-ok' -> any healthy replica
export function read(sql: string, params: unknown[], opts: { consistency: 'strong' | 'session' | 'stale-ok'; minLsn?: string }) {
  if (opts.consistency === 'strong') return primary.query(sql, params);
  const healthy = replicas.filter((r) => r.lagSeconds < MAX_LAG_S);
  const eligible = opts.consistency === 'session' && opts.minLsn
    ? healthy.filter((r) => lsnGte(r.replayLsn, opts.minLsn!))
    : healthy;
  if (!eligible.length) return primary.query(sql, params);   // degrade to primary, never stale
  return eligible[Math.floor(Math.random() * eligible.length)].pool.query(sql, params);
}`,
      },
      explanation: `**What changed and why:**
- **Explicit consistency per call** instead of regex routing on "SELECT". Checkout confirmation and "my profile" use \`session\`; catalog and other people's profiles use \`stale-ok\`; money movements use \`strong\`. (\`SELECT ... FOR UPDATE\` in the starter would also have been sent to a replica and failed.)
- **Read-your-writes via LSN tokens**: every write returns the primary's WAL LSN; the session carries it; reads use only replicas that have replayed at least that LSN. No arbitrary sleeps or "pin to primary for 10 s" guesswork (though that is an acceptable simpler fallback).
- **Continuous lag tracking** (1 query/s/replica) removes replicas lagging > 5 s or unreachable from rotation automatically — the nightly import can no longer serve 20-second-old data. The tracker's own staleness (≤ 1 s) is conservative for session reads because the replay LSN only moves forward.
- **Safe fallback**: no eligible replica → primary. Watch primary load during import spikes; that is the trade-off.
- **Timeouts** on pool acquisition so a dead replica fails fast instead of hanging requests.`,
      followUps: [
        {
          "q": "Your router now sends session reads to the primary whenever no replica is fresh enough. During the nightly import every replica lags 20 s. What happens to the primary, and how do you protect it?",
          "a": "Every session read for a user who wrote recently falls back to the primary, and that's on top of the import's write load. If many users are active, primary read QPS can jump several-fold right when it's busiest. Protections: give the fallback its own small primary pool (e.g. max 10 connections) so it queues instead of exhausting the main pool; prefer waiting briefly (up to ~200 ms) for a replica to reach `minLsn` before falling back; and throttle the import itself on lag so replicas stay within the 5 s window."
        },
        {
          "q": "How do you unit-test `read()` and the LSN comparison without real replicas?",
          "a": "Make the replica list and lag state injectable, so a test can construct replicas with fake pools and set `replayLsn`/`lagSeconds` directly. Test cases: `lsnGte` across the hi/lo boundary ('1/FFFFFFFF' vs '2/0'), equal LSNs, and different-length hex; `session` with minLsn ahead of all replicas → primary; one replica fresh and one lagging → always the fresh one; `lagSeconds = Infinity` (unreachable) → never chosen; `strong` → primary. Add one integration test in docker-compose with a real streaming replica and `pg_wal_replay_pause()` to confirm a stale replica is skipped."
        }
      ],
    },
    {
      id: 'prod-scale-cc-2',
      title: 'Make the backfill job safe to run against a live 400M-row table',
      context:
        'We are migrating orders to a new sharded cluster. The backfill script below copied 30M rows on the first night, then the primary\'s CPU hit 100%, replicas lagged 15 minutes, checkout timed out, and the job crashed at row 31M — restarting it began from zero and created duplicates in the target.',
      task: 'Rewrite the backfill so it has constant per-batch cost, is resumable, is idempotent in the target, throttles itself on replication lag and primary load, and never holds long locks or long transactions.',
      starter: {
        language: 'typescript',
        title: 'backfill.ts (starter)',
        code: `import { Pool } from 'pg';
const source = new Pool({ host: 'pg-primary' });
const target = new Pool({ host: 'new-cluster-router' });

async function main() {
  const { rows: [{ count }] } = await source.query('SELECT count(*) FROM orders');
  const PAGE = 50_000;
  for (let offset = 0; offset < Number(count); offset += PAGE) {
    const { rows } = await source.query(
      'SELECT * FROM orders ORDER BY created_at LIMIT $1 OFFSET $2', [PAGE, offset]);
    for (const r of rows) {
      await target.query(
        'INSERT INTO orders (id, tenant_id, total, status, created_at) VALUES ($1,$2,$3,$4,$5)',
        [r.id, r.tenant_id, r.total, r.status, r.created_at]);
    }
    console.log('copied', offset + rows.length);
  }
}
main();`,
      },
      hints: [
        'What does OFFSET 30,000,000 cost the database on every page? What happens to rows inserted or updated while the job runs?',
        'How would the job know where to resume, and what makes re-inserting the same row harmless?',
        'Which signals should make the job slow down automatically — and which DB should it read from?',
      ],
      solution: {
        language: 'typescript',
        title: 'backfill.ts (solution)',
        code: `import { Pool } from 'pg';

const source = new Pool({ host: 'pg-replica-backfill', max: 2 });  // dedicated replica
const primary = new Pool({ host: 'pg-primary', max: 1 });           // only for lag checks
const target = new Pool({ host: 'new-cluster-router', max: 4 });
const BATCH = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lagSeconds(): Promise<number> {
  const { rows } = await primary.query(
    'SELECT COALESCE(max(EXTRACT(EPOCH FROM replay_lag)), 0) AS lag FROM pg_stat_replication');
  return Number(rows[0].lag);
}

async function main() {
  // resumable checkpoint (keyset cursor), stored durably in the target
  const { rows: cp } = await target.query("SELECT last_id FROM backfill_checkpoint WHERE job = 'orders'");
  let lastId: string = cp[0]?.last_id ?? '00000000-0000-0000-0000-000000000000';

  for (;;) {
    // keyset pagination on the PK: O(batch) per page, independent of progress
    const { rows } = await source.query(
      'SELECT id, tenant_id, total, status, created_at, updated_at FROM orders WHERE id > $1 ORDER BY id LIMIT $2',
      [lastId, BATCH]);
    if (!rows.length) break;

    // one multi-row idempotent upsert per batch; newer data (from CDC) always wins
    await target.query(
      'INSERT INTO orders (id, tenant_id, total, status, created_at, updated_at) ' +
      'SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::numeric[], $4::text[], $5::timestamptz[], $6::timestamptz[]) ' +
      'ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, total = EXCLUDED.total, ' +
      'status = EXCLUDED.status, updated_at = EXCLUDED.updated_at ' +
      'WHERE orders.updated_at < EXCLUDED.updated_at',
      [rows.map((r) => r.id), rows.map((r) => r.tenant_id), rows.map((r) => r.total),
       rows.map((r) => r.status), rows.map((r) => r.created_at), rows.map((r) => r.updated_at)]);

    lastId = rows[rows.length - 1].id;
    await target.query(
      "INSERT INTO backfill_checkpoint (job, last_id) VALUES ('orders', $1) " +
      'ON CONFLICT (job) DO UPDATE SET last_id = EXCLUDED.last_id', [lastId]);

    // adaptive throttle: back off hard when replicas fall behind
    const lag = await lagSeconds();
    await sleep(lag > 10 ? 30_000 : lag > 2 ? 2_000 : 50);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });`,
      },
      explanation: `**Fixes:**
- **OFFSET → keyset pagination** on the primary key: \`OFFSET 30M\` made Postgres walk and discard 30M rows per page (quadratic total cost); \`WHERE id > $last ORDER BY id\` is an index range scan with constant cost per batch. Ordering by non-unique \`created_at\` with OFFSET also skipped/duplicated rows when data changed mid-run.
- **Reads from a dedicated replica**, not the primary; the primary is only touched for a cheap lag query.
- **Batched multi-row upsert** (1 round trip per 2,000 rows instead of 2,000) and **idempotent** \`ON CONFLICT ... WHERE updated_at <\` so re-runs never duplicate and never overwrite fresher rows written by the live CDC stream.
- **Durable checkpoint** after every batch → a crash resumes from the last batch, not zero.
- **Adaptive throttling** on replication lag protects checkout; small batches mean short transactions and no long locks.
- The backfill covers history only; **CDC** (Debezium) keeps rows changed during the run in sync — backfill plus CDC together give a complete copy.`,
      followUps: [
        {
          "q": "The keyset cursor is on `id`, a UUIDv4. Is there a problem with ordering by a random UUID?",
          "a": "Correctness is fine: `id > $last ORDER BY id` visits every row exactly once by PK order, and rows inserted later with a lower UUID are covered by CDC rather than the backfill. Performance is worse: random UUIDs mean each batch reads index-ordered rows scattered across heap pages, so 2,000 rows can cost ~2,000 random page reads with poor cache locality. On a replica that's usually tolerable. Alternatives: walk by `ctid` page ranges (sequential heap access), or by a time-ordered key such as UUIDv7 if available."
        },
        {
          "q": "Now make the backfill run in parallel with 8 workers without overlapping or losing rows.",
          "a": "Pre-split the key space into disjoint ranges: for UUIDs, 256 ranges by first byte ('00…' to 'ff…'); for ints, from `min`/`max` IDs. Store each range in a `backfill_ranges` table with `(range_id, lo, hi, last_id, status)`. Workers claim a range with `SELECT … FOR UPDATE SKIP LOCKED`, page within it by keyset, checkpoint `last_id` per range, and mark it done. A crashed worker's range is reclaimed after a lease timeout. Keep the global lag throttle shared, so 8 workers back off together rather than multiplying load 8×."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'prod-scale-iq-01',
      difficulty: 'hard',
      question:
        'It\'s 8:05 pm on sale day. Traffic is 10× normal and still rising, p99 is 4 s, and the HPA is at max replicas. You\'re incident commander. What do you do in the next 15 minutes?',
      context: 'E-commerce platform: NestJS services on Kubernetes, Postgres primary with 2 replicas, Redis cache, Kafka for order events.',
      whatInterviewerLooksFor: [
        'Command structure and communication, not just technical steps',
        'Identifies the first saturated resource before acting',
        'Mitigation via load shedding and degradation before scaling',
        'Avoids actions that amplify load on the bottleneck (more pods → more DB connections)',
        'Clear follow-up plan and postmortem items',
      ],
      modelAnswer: `### Minute 0–2: organise
- Declare a SEV-1, assign roles (IC = me, ops lead, comms, scribe). Status page update: "degraded checkout performance".
- Freeze deploys and config changes.

### Minute 2–7: find the first bottleneck (USE, top-down)
- **Traffic legitimacy**: RPS by route and client — is it shoppers, a bot, or our own retry storm? Retries often double effective load.
- **App pods**: CPU, event-loop lag. At max replicas — but is the app the bottleneck or waiting?
- **Pools**: DB pool acquire time. If high while pod CPU is low → the DB is the bottleneck, and adding pods makes it worse.
- **DB**: primary CPU, active connections vs max, lock waits, top statements in \`pg_stat_statements\`.
- **Redis**: hit ratio, per-shard CPU (hot key on the sale product?).

### Minute 7–15: mitigate in order of speed and safety
1. **Degrade**: kill-switch flags for recommendations, "people also bought", live inventory counts → serve cached/approximate values.
2. **Protect the critical path**: priority load shedding at the gateway — checkout and payment first, browse second, everything else gets 503 + \`Retry-After\`.
3. **Cut retries**: ensure clients/SDKs back off; disable automatic retries at the ingress for non-idempotent routes.
4. **Relieve the DB**: raise cache TTLs on product pages to 30–60 s, route catalog reads to replicas, pause batch jobs and analytics.
5. **Hot key**: local in-process caching of the sale SKU for 1–2 s.
6. Only if the app tier *is* the bottleneck: raise maxReplicas and check PgBouncer headroom first.

### Close out
- Watch recovery for 15–30 min before reverting degradations one by one.
- Postmortem: capacity model and load test at 3× forecast, pre-scaling, queue-based checkout (virtual waiting room) for future sales, per-endpoint shedding priorities codified.`,
      followUps: [
        {
          q: 'The DB is at 100% CPU from one query on the product page. Can you fix it live?',
          a: 'Mitigate first by caching that endpoint (even 5–10 s TTL collapses the load) or serving it from a replica. If an index is missing, CREATE INDEX CONCURRENTLY is possible live but takes time and extra IO — do it after the cache has relieved load, with lock_timeout set. Kill runaway instances with pg_cancel_backend.',
        },
        {
          q: 'How would a virtual waiting room change this incident?',
          a: 'It admits users at the rate the backend is known to sustain (token-based admission at the edge), so overload becomes a queue page instead of timeouts for everyone. Users get a fair, visible wait; the system stays within its tested capacity.',
        },
      ],
      pitfalls: [
        'Scaling pods first without checking whether the DB is the bottleneck.',
        'No communication or role assignment — everyone debugging the same graph.',
        'Rolling back or deploying fixes during peak without evidence.',
        'Forgetting retries as a load multiplier.',
      ],
    },
    {
      id: 'prod-scale-iq-02',
      difficulty: 'expert',
      question:
        'The CEO says we\'ve signed a partner that will bring 100× our current traffic in six months. Currently 2k RPS peak on 20 pods, one Postgres primary, one Redis. Walk me through what breaks and in what order, and your plan.',
      whatInterviewerLooksFor: [
        'Systematic per-tier ceiling analysis with numbers',
        'Identifies non-obvious limits (NAT, quotas, connections, observability)',
        'Prioritised roadmap rather than a big-bang rewrite',
        'Load testing and capacity modelling as validation',
        'Considers cells/blast radius and cost',
      ],
      modelAnswer: `### Frame it: 2k → 200k RPS peak
Profile the traffic first: read/write ratio (say 90/10 → 180k reads, 20k writes/s), the partner's access pattern (API-to-API bursts?), payload sizes.

### What breaks, in order
1. **DB connections**: 20 pods × 20 = 400 today; at ~2,000 pods, 40,000 → impossible. **PgBouncer** now.
2. **Postgres primary**: 20k writes/s of small transactions is within reach of a big tuned node only with batching; 180k reads/s is not — needs cache + replicas.
3. **Redis**: a single node does ~100k–200k simple ops/s; 180k reads + overhead exceeds it, and a hot key concentrates on one shard → **Redis Cluster** + in-process L1 cache for hot keys.
4. **Egress & quotas**: NAT gateway ports/bandwidth for calls to payment/SMS providers; third-party rate limits (negotiate, or batch).
5. **Kernel/runtime**: conntrack, ephemeral ports (enable keep-alive everywhere), fds.
6. **Kafka**: partitions cap consumer parallelism — plan partition counts now (hard to change later without reordering).
7. **Observability**: 100× logs = 100× bill; sampling, drop debug logs, metric cardinality control.
8. **Humans**: on-call load, manual partner onboarding.

### Plan (6 months)
- **Month 1**: capacity model per service; load-test harness (k6) replaying production shape; PgBouncer; keep-alive + connection reuse; SLOs.
- **Month 2–3**: caching tier + replicas for top read endpoints; batch writes; move analytics to a warehouse via CDC; Redis Cluster.
- **Month 3–5**: shard or split the 2–3 hottest tables (partner's tenant may deserve its own **cell**); async ingestion via Kafka for partner writes (202 Accepted).
- **Month 5–6**: load test to 150% of target (300k RPS), game days, cost review.

### Principles
Don't rewrite everything — find the next bottleneck, fix, re-test. A **cell-based** design (partner in its own cell) caps blast radius and makes 100× a "10 cells of 10×" problem.`,
      followUps: [
        {
          q: 'Why put the partner in its own cell rather than scaling the shared platform?',
          a: 'A single partner at 100× current traffic would dominate shared resources; a noisy partner outage or bug would affect all customers. A cell (dedicated stack and data partition) isolates blast radius, allows independent scaling and deploys, and turns one huge scaling problem into repeated known-size units.',
        },
        {
          q: 'How do you know your load test is realistic?',
          a: 'Replay a production traffic shape: endpoint mix, payload sizes, cache key distribution (Zipfian, not uniform — uniform keys make caches look worse and hot keys invisible), think time and concurrency, plus background jobs running. Validate by comparing per-tier metrics at 1× against production.',
        },
        {
          q: 'What would you not do?',
          a: 'Migrate to microservices or a new database as the first move; scale everything uniformly; skip load testing because "Kubernetes autoscales"; shard before exhausting caching and read offloading.',
        },
      ],
      pitfalls: [
        'Saying "just add more pods and autoscaling".',
        'No numbers per tier.',
        'Missing connection counts, NAT/quotas and hot keys.',
        'Proposing a full rewrite instead of iterative bottleneck removal.',
      ],
    },
    {
      id: 'prod-scale-iq-03',
      difficulty: 'hard',
      question:
        'Shard 7 of 16 is at 95% CPU and its customers see 3 s latency; the other shards sit at 25%. We shard by `tenant_id % 16`. What\'s going on and what do you do today and this quarter?',
      whatInterviewerLooksFor: [
        'Confirms skew versus a failing node',
        'Distinguishes a whale tenant from a hash/range problem',
        'Immediate mitigations that do not require resharding',
        'Long-term: logical shards, directory mapping, dedicated shards',
      ],
      modelAnswer: `### Confirm
- Is the shard's hardware healthy (disk latency, replication, noisy neighbour)? A degraded node looks like skew.
- Per-tenant request and row counts on shard 7 (request logs or query tags). With modulo on a well-distributed ID, key skew is unlikely; **a whale tenant** is the usual culprit — one customer at 40% of the shard.

### Today (mitigate)
- **Cache** the whale's hottest read endpoints (short TTL) and serve reads from a shard-7 replica.
- **Rate-limit** the whale's heaviest non-critical endpoints (exports, bulk APIs), after talking to their account manager.
- **Scale shard 7 vertically** (bigger instance) if the platform allows a quick failover-based resize.
- Pause background jobs targeting shard 7's tenants.

### This quarter (fix)
- Move from \`tenant_id % 16\` to **logical shards + directory**: e.g. 4,096 buckets mapped to physical clusters in a config table. \`% 16\` means changing the shard count moves ~all tenants; with buckets we move only the buckets we choose.
- **Whale placement**: the directory lets us pin a big tenant to a dedicated cluster — or split a whale by a second-level key \`(tenant_id, hash(entity_id))\` across several shards if one node can't hold it.
- **Online move** of a tenant: CDC/logical replication of that tenant's rows → verify → brief per-tenant write freeze (seconds) → flip directory → clean up.
- **Skew monitoring**: per-shard and per-tenant load, alerts on max/median > 2.

### Say this
"Modulo sharding distributes *keys* evenly, not *load*. B2B load follows a power law, so I need the ability to place tenants individually — a directory — and I monitor load, not key counts."`,
      followUps: [
        {
          q: 'Why not just go to 32 shards with modulo?',
          a: 'Changing from %16 to %32 relocates about half of all tenants (and a naive rehash changes nearly all mappings for arbitrary N), requiring a massive migration — and the whale still lands on a single shard. It treats the symptom and pays the maximum migration cost.',
        },
        {
          q: 'How does consistent hashing help here?',
          a: 'Adding a node only moves ~1/N of keys, and virtual nodes smooth distribution. But it still cannot split a single hot key; whales still need explicit placement or a secondary partition key.',
        },
      ],
      pitfalls: [
        'Assuming a hash-based scheme guarantees even load.',
        'Jumping to full resharding as the first move.',
        'Ignoring the possibility of a failing node.',
      ],
    },
    {
      id: 'prod-scale-iq-04',
      difficulty: 'medium',
      question:
        'Support reports that users edit their profile, refresh, and see the old data — about 1 in 50 edits. Nothing is being lost in the database. Diagnose and fix.',
      whatInterviewerLooksFor: [
        'Recognises read-after-write against lagging replicas or stale cache',
        'Checks lag metrics and routing',
        'Offers several consistency techniques with trade-offs',
        'Considers cache invalidation as an alternative cause',
      ],
      modelAnswer: `### Hypotheses
1. **Replica lag**: the write went to the primary; the refresh read hit a replica still behind. "1 in 50" fits occasional lag spikes or one slow replica.
2. **Stale cache**: cache-aside with write-then-invalidate racing a concurrent read (read old value from DB → write stale value to cache after invalidation), or a CDN caching the profile API.
3. Client-side caching (HTTP cache headers on GET /me).

### Check
- \`pg_stat_replication.replay_lag\` per replica over time; correlate with ticket timestamps.
- Tracing: which backend served the stale read (replica host tag)?
- Cache: hit on the stale read? TTL? invalidation ordering?
- Response headers: \`Cache-Control\` on /me.

### Fix (replica lag)
- **Read-your-writes**: after a write, carry the commit LSN (or a timestamp) in the session; reads route to a replica that has replayed it, else the primary. Simpler: pin a user's reads to the primary for ~5 s after they write.
- **Monotonic reads**: stickiness to one replica per session.
- Lag-aware replica pool (evict replicas lagging > N seconds).
- Profile endpoints (\`/me\`) are low volume — just read them from the primary.

### Fix (cache)
- Delete-after-write with short TTLs, or versioned keys; for the race, delayed double-delete or write-through with version checks.
- \`Cache-Control: private, no-store\` for personalised API responses.

### Product
Optimistic UI: show the submitted values immediately from client state.`,
      followUps: [
        {
          q: 'Is pinning to primary for 5 seconds after any write safe?',
          a: 'Mostly, but lag can exceed 5 s during bulk jobs, and it breaks if the user writes on one device and reads on another. LSN tokens are exact; time-based pinning is a cheap approximation. Combine with lag-aware eviction of replicas.',
        },
        {
          q: 'What about synchronous replication?',
          a: 'synchronous_commit = remote_apply guarantees a replica has applied the commit before acknowledging, fixing staleness on that replica, at the cost of higher write latency and write availability depending on replica health. Usually reserved for specific replicas or transactions, not global.',
        },
      ],
      pitfalls: [
        'Claiming data is being lost or blaming the ORM.',
        'Suggesting "make replication faster" as the fix.',
        'Ignoring cache and HTTP caching as causes.',
      ],
    },
    {
      id: 'prod-scale-iq-05',
      difficulty: 'expert',
      question:
        'We need to move the 2 TB orders table from our single Postgres to a new sharded cluster while taking 3k writes/s, with no downtime and the ability to roll back at any point. How exactly do you do it?',
      whatInterviewerLooksFor: [
        'CDC-based dual writes rather than naive app dual writes',
        'Backfill consistent with the change stream',
        'Verification (checksums, shadow reads) before switching',
        'Phased read then write cutover with reverse replication',
        'Specific failure modes: ordering, IDs, partial failures',
      ],
      modelAnswer: `### Phase 0 — prepare
- Target schema with the shard key (\`tenant_id\`) on every table and in every query; audit queries that don't include it (cross-shard queries need a new path: search index or warehouse).
- IDs: UUIDv7/ULID or preallocated ranges so no sequence collisions.

### Phase 1 — change stream
- Debezium reads the WAL via a logical replication slot → Kafka topic keyed by primary key (per-row ordering preserved) → sink writer upserts into the right shard with \`updated_at\`/LSN version checks.
- Monitor the replication slot — an unconsumed slot retains WAL and can fill the primary's disk.

### Phase 2 — backfill
- Debezium initial snapshot or a keyset-paginated, throttled backfill from a replica, idempotent upserts that never overwrite newer CDC data. 2 TB at ~50 MB/s effective ≈ 11 h; throttle on lag.

### Phase 3 — verify
- Per-tenant row counts and hash checksums over PK ranges, repeated until stable.
- **Shadow reads**: 5–10% of reads also go to the new cluster asynchronously; compare, log diffs. Target: zero unexplained diffs for a week.

### Phase 4 — switch reads
- Flag-controlled, per tenant: internal → 1% → 100%. Rollback = flag.

### Phase 5 — switch writes
- Per shard or per tenant: brief write freeze (seconds), wait for CDC to drain to zero lag, flip the write flag, start **reverse CDC** (new → old). Old DB stays current for rollback.

### Phase 6 — decommission
- After weeks with no rollback need, stop reverse CDC, archive the old table.

### Why not app-level dual writes?
Without a distributed transaction, a crash between the two writes diverges the stores silently; CDC derives the second write from the committed log, so it's complete and ordered.`,
      followUps: [
        {
          q: 'The CDC consumer falls 2 hours behind during the backfill. What\'s the risk?',
          a: 'The replication slot retains WAL on the primary until consumed — disk can fill and take the primary down. Alert on slot lag/retained bytes, throttle the backfill, scale the consumer (more partitions) and set max_slot_wal_keep_size as a safety valve (at the cost of having to re-snapshot).',
        },
        {
          q: 'How do you handle a transaction that updates rows belonging to two tenants on different target shards?',
          a: 'Find them during query audit. Either redesign so transactions stay within a tenant (usually true for orders), or accept eventual consistency via sagas/outbox for the rare cross-tenant workflow. The CDC sink applies per-row changes, so cross-shard atomicity is not preserved during migration — verify no invariants depend on it.',
        },
      ],
      pitfalls: [
        'Naive dual writes from the application without handling partial failure.',
        'Cutting reads and writes over at the same time.',
        'No rollback path after the write switch.',
        'Forgetting WAL retention from replication slots.',
      ],
    },
    {
      id: 'prod-scale-iq-06',
      difficulty: 'hard',
      question:
        'Our app is hosted in us-east-1. Users in Sydney and Mumbai report 3–4 s load times for the home screen versus 600 ms in New York. You have one sprint. What do you do, and what do you do next quarter?',
      whatInterviewerLooksFor: [
        'Quantifies RTT and number of sequential round trips',
        'Quick wins: CDN, edge TLS, fewer calls, compression',
        'Longer-term regional read stacks and data placement',
        'Trade-offs of multi-region writes',
      ],
      modelAnswer: `### Quantify
- Sydney ↔ Virginia ≈ 200 ms RTT; Mumbai ≈ 180–200 ms. A cold connection costs DNS + TCP (1 RTT) + TLS 1.3 (1 RTT) ≈ 400 ms before the first request. If the home screen makes 5 **sequential** API calls: 5 × 200 = 1 s plus server time, plus assets from origin. That easily explains 3–4 s.
- Confirm with RUM timings split by DNS/connect/TLS/TTFB and a waterfall of API calls.

### This sprint
1. **CDN in front of everything**, including API: edge terminates TLS ~10–30 ms from the user and keeps warm, pooled connections to origin → saves ~2 long RTTs per new connection.
2. **Static assets**: hashed filenames, immutable caching, served from edge (≈ 100% hit ratio).
3. **Cut round trips**: a home-screen aggregation endpoint (BFF/GraphQL query) returning everything in one call; parallelise the rest.
4. **Cache public API responses at the edge** (\`s-maxage\` + \`stale-while-revalidate\`) for non-personalised content.
5. HTTP/2 or HTTP/3, Brotli compression, smaller payloads.
Expected: from 3–4 s to ~1 s.

### Next quarter
- **Regional read stacks** in ap-southeast-2 and ap-south-1: stateless services + read replicas (cross-region async replication, ~1 s lag) + regional Redis. Writes go to us-east-1 (one ~200 ms RTT, acceptable for infrequent writes), with read-your-writes handling.
- GeoDNS/latency-based routing with health checks for failover.
- If writes are frequent/latency sensitive or residency laws apply: **home users' data in their region** (geo-partitioning) — a bigger change.
- Avoid active-active multi-master unless required; conflict resolution is expensive.`,
      followUps: [
        {
          q: 'Why does edge TLS termination help even if the API response is not cacheable?',
          a: 'The expensive handshakes happen over a ~20 ms hop to the edge instead of 200 ms to origin, and the edge reuses long-lived, already-warm connections to origin (often over optimised backbone routes), so each request pays only one long-haul RTT instead of three.',
        },
        {
          q: 'A read replica in Sydney lags 1 s. Which screens can use it?',
          a: 'Feeds, catalog, other users\' profiles, search — anything stale-tolerant. The user\'s own just-written data, balances and checkout confirmation go to the primary or use LSN-aware routing.',
        },
      ],
      pitfalls: [
        'Proposing multi-master active-active as the first step.',
        'Optimising server code when the time is in network round trips.',
        'Forgetting TLS handshake cost.',
      ],
    },
    {
      id: 'prod-scale-iq-07',
      difficulty: 'hard',
      question:
        'Every night at 00:00 UTC our job system enqueues 5M jobs (invoices, reports, emails). For the past week the primary DB hits 100% CPU at 00:02, password-reset emails are delayed 40 minutes, and Redis memory is at 92%. Fix it.',
      whatInterviewerLooksFor: [
        'Separates the three symptoms and their causes',
        'Worker concurrency bounded by downstream capacity',
        'Queue isolation by priority/tenant; jittered scheduling',
        'Redis job retention and eviction policy awareness',
        'Idempotency for retries and re-runs',
      ],
      modelAnswer: `### Three symptoms, three causes
1. **DB at 100% at 00:02**: all 5M jobs become runnable at once; workers autoscale on queue depth to max concurrency and hammer the DB. Queue depth is not a capacity signal for the DB.
2. **Password resets delayed 40 min**: critical jobs share a FIFO queue with bulk jobs → head-of-line blocking.
3. **Redis at 92%**: completed/failed jobs retained forever, large payloads stored in jobs, 5M jobs enqueued at once.

### Fix now
- Move password reset/OTP/transactional emails to a **separate queue with dedicated workers** (hours of work → minutes).
- Cap bulk worker concurrency to what the DB sustains (e.g. 40 concurrent DB-bound jobs).
- Purge completed jobs; set \`removeOnComplete\`/\`removeOnFail\` limits. Confirm Redis \`maxmemory-policy noeviction\` — with LRU, Redis could silently evict job data.

### Fix permanently
- **Jitter**: spread tenants across the night (\`hash(tenant) % 7200\` seconds) or by tenant time zone.
- **Hierarchical fan-out**: 5,000 chunk jobs of 1,000 items instead of 5M jobs; \`addBulk\` for enqueueing.
- **Payloads by reference**: store IDs, not documents, in jobs.
- **Fairness**: per-tenant rate limits/group concurrency so one tenant's 1M-row report can't starve others.
- **Idempotency**: deterministic job IDs per (tenant, month, type) so re-running the scheduler doesn't duplicate; handlers upsert.
- **Autoscale on oldest-job age**, bounded above by downstream capacity; alert on age per queue against its SLA (reset emails: < 30 s).
- Heavy bulk (reports) can read from a replica.

### Say this
"Bulk work should fill capacity the system has spare, not compete with interactive traffic. Isolate by priority, bound by downstream capacity, spread over time."`,
      followUps: [
        {
          q: 'Should we move from Redis/BullMQ to Kafka?',
          a: 'Not for this problem — it is scheduling and isolation, not throughput. Kafka helps when you need very high throughput, replay or long retention; it lacks per-job delays, priorities and per-message retries natively. SQS or a Postgres-backed queue are alternatives if durability of Redis is a concern.',
        },
        {
          q: 'How do you size the bulk worker concurrency?',
          a: 'Measure DB cost per job (e.g. 20 ms of DB time with 5 queries) and allocate a budget (say 30% of DB capacity at night ≈ N concurrent connections via Little\'s law: concurrency = throughput × latency). Enforce it with worker concurrency and a queue-level rate limiter, then tune from DB CPU.',
        },
      ],
      pitfalls: [
        'Adding more workers.',
        'Keeping critical and bulk jobs in one queue with priorities only (priority inside a saturated pool still waits for running jobs).',
        'Ignoring Redis eviction policy for a queue.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'prod-scale-boe-1',
      question:
        'Traffic will go from 2k to 200k RPS. Estimate what breaks at the cache: a flash-sale product page reads one 20 KB Redis key on 60% of requests.',
      assumptions: [
        'Single Redis shard handles ~150k simple GETs/s; NIC 10 Gbps (~1.25 GB/s) per cache node',
        'Hot key lives on exactly one shard in Redis Cluster',
        'Each app pod could keep an in-process L1 copy with a 1 s TTL; 400 pods at 100×',
      ],
      steps: [
        { label: 'Hot key reads/s', calc: '200,000 × 0.6 = 120,000 GETs/s on one key → one shard' },
        { label: 'Bandwidth for that key', calc: '120,000 × 20 KB = 2.4 GB/s ≈ 19 Gbps' },
        { label: 'Compare to shard limits', calc: 'ops: 120k of ~150k (80%, before other keys); network: 19 Gbps > 10 Gbps NIC → saturated' },
        { label: 'With L1 in-process cache (1 s TTL)', calc: '400 pods × 1 refresh/s = 400 GETs/s → 8 MB/s' },
        { label: 'Reduction', calc: '120,000 ÷ 400 = 300× fewer requests to Redis' },
      ],
      answer:
        'The single shard holding the hot key would need ~19 Gbps — about twice a 10 Gbps NIC — so it fails on bandwidth before CPU. A 1-second in-process cache drops load to ~400 GETs/s.',
      insight:
        'At 100× the limit is often network bandwidth of a single node for one hot key, and Redis Cluster cannot spread a single key. Hot keys need L1 caching, key replication (key#1..#N) or edge caching; large values make it worse.',
      followUps: [
        {
          "q": "Product says the price on the flash-sale page must be at most 100 ms stale, so a 1 s L1 TTL is not allowed. Redo the estimate.",
          "a": "With a 100 ms TTL, each of 400 pods refreshes 10 times per second: 400 × 10 = 4,000 GETs/s × 20 KB = 80 MB/s (~0.64 Gbps). That's still ~30× fewer requests than 120k/s and well within one shard's NIC. Better still, split the key: keep the 20 KB product body under a long TTL and put the price in a tiny separate key (~100 bytes) refreshed often, or push price changes to pods via pub/sub so freshness doesn't depend on polling."
        },
        {
          "q": "You can't add an in-process cache this week. How far does replicating the hot key across 8 shards get you?",
          "a": "Write the value to `product:42#1..#8` (on 8 different slots/shards) and have readers pick a random suffix. Per shard: 120,000 ÷ 8 = 15,000 GETs/s and 15,000 × 20 KB = 300 MB/s ≈ 2.4 Gbps, comfortably under a 10 Gbps NIC. The costs: 8 writes per update (fine for a rarely-changing page), a brief window where copies differ, and code to know which keys are hot. Compressing the 20 KB value (often 4–5× for JSON/HTML) cuts the bandwidth further."
        }
      ],
    },
    {
      id: 'prod-scale-boe-2',
      question:
        'How many shards do we need for an orders store with 20 TB of data growing 1 TB/month and 60k writes/s peak in 18 months, if one node comfortably handles 5k writes/s and 2 TB?',
      assumptions: [
        'Plan for 18 months ahead; keep each node ≤ 60% of write capacity and ≤ 70% disk',
        'Writes evenly distributed after using hashed tenant buckets',
        'Each shard has 1 primary + 2 replicas',
      ],
      steps: [
        { label: 'Data in 18 months', calc: '20 TB + 18 × 1 TB = 38 TB' },
        { label: 'Shards by storage', calc: '38 TB ÷ (2 TB × 0.7) = 38 ÷ 1.4 ≈ 27 shards' },
        { label: 'Shards by writes', calc: '60,000 ÷ (5,000 × 0.6) = 60,000 ÷ 3,000 = 20 shards' },
        { label: 'Binding constraint', calc: 'max(27, 20) = 27 → round to 32 for power-of-two bucket mapping' },
        { label: 'Total nodes', calc: '32 × 3 = 96 database nodes' },
        { label: 'Logical buckets', calc: '4,096 buckets ÷ 32 = 128 buckets per shard → moving 1 bucket ≈ 38 TB ÷ 4,096 ≈ 9 GB' },
      ],
      answer:
        'About 27 shards are needed (storage is the binding constraint, not writes); provision 32 physical shards (96 nodes with replicas) behind 4,096 logical buckets.',
      insight:
        'Storage growth, not write rate, drives shard count here — so archiving/tiering old orders (partition by month, move > 2 years to object storage) could halve the fleet. Logical buckets keep each future move small (~9 GB).',
      followUps: [
        {
          "q": "The partner deal changes the forecast: peak writes in 18 months are 150k/s, not 60k/s. What's the binding constraint now?",
          "a": "Writes: 150,000 ÷ (5,000 × 0.6) = 150,000 ÷ 3,000 = 50 shards, now above the 27 needed for storage. Round up to 64 for clean power-of-two bucket mapping (4,096 ÷ 64 = 64 buckets per shard), so 64 × 3 = 192 nodes. Before buying that, attack write cost per node: batch writes, drop unneeded indexes and use faster NVMe, so each node sustains more than 5k/s. Raising per-node capacity to 7.5k/s brings the count back to ~34 shards."
        },
        {
          "q": "Six months in, you need to grow from 32 to 48 shards. How much data moves, and how long does it take if you throttle copying to 200 MB/s total?",
          "a": "With logical buckets, you move only enough buckets to balance: each new shard takes 4,096 ÷ 48 ≈ 85 buckets, so about a third of all buckets move. At 38 TB that's 38 × 16/48 ≈ 12.7 TB (less if you rebalance before reaching full size). At 200 MB/s: 12.7e12 ÷ 2e8 ≈ 63,000 s ≈ 17.6 hours of copying, spread over days at night-time throttle. Each bucket (~9.3 GB) moves independently, so the job can pause, resume and roll back per bucket."
        }
      ],
    },
    {
      id: 'prod-scale-boe-3',
      question:
        'Estimate home-screen latency for a Sydney user against a us-east-1 origin, before and after edge TLS termination plus an aggregated endpoint.',
      assumptions: [
        'Sydney↔Virginia RTT 200 ms; user↔Sydney edge RTT 15 ms',
        'Cold start: DNS 50 ms, TCP 1 RTT, TLS 1.3 1 RTT',
        'Home screen: 4 sequential API calls, each 80 ms server time',
        'Edge keeps warm connections to origin; aggregated endpoint does the 4 calls in parallel server-side (≈ 120 ms total)',
      ],
      steps: [
        { label: 'Before: connection setup', calc: '50 + 200 (TCP) + 200 (TLS) = 450 ms' },
        { label: 'Before: API calls', calc: '4 × (200 RTT + 80) = 1,120 ms' },
        { label: 'Before: total', calc: '450 + 1,120 ≈ 1.57 s (+ assets from origin ≈ 3 s on mobile)' },
        { label: 'After: setup at edge', calc: '50 + 15 + 15 = 80 ms' },
        { label: 'After: one aggregated call', calc: '15 (to edge) + 200 (edge→origin, warm) + 120 = 335 ms' },
        { label: 'After: total', calc: '80 + 335 ≈ 415 ms (assets from edge cache)' },
      ],
      answer: 'Roughly 1.6 s (more with assets) down to ~0.4 s — a ~4× improvement without moving any data.',
      insight:
        'Round-trip count × RTT dominates global latency. Edge termination and call aggregation remove most of it cheaply; regional data stacks are the next step only if the remaining single origin RTT (~200 ms) still matters.',
      followUps: [
        {
          "q": "Some clients still negotiate TLS 1.2 (2 RTTs). How does that change the before and after numbers?",
          "a": "Before: setup = 50 (DNS) + 200 (TCP) + 400 (TLS 1.2, 2 × 200) = 650 ms, plus 1,120 ms of calls ≈ 1.77 s. After: setup at the edge = 50 + 15 + 30 = 95 ms, plus 335 ms ≈ 430 ms. The old TLS version adds 200 ms to the 'before' path but only 15 ms to the 'after' path. Edge termination makes handshake cost nearly irrelevant, which is why it's the first lever for far-away users."
        },
        {
          "q": "It turns out the 4 home-screen calls are dependent: each needs the previous one's output. Does the aggregated endpoint still help?",
          "a": "Yes, because the dependency chain now runs inside the data center, where RTT is ~1 ms instead of 200 ms. Server side: 4 × 80 ms + ~3 ms of hops ≈ 323 ms, so the call is 15 + 200 + 323 ≈ 538 ms, and the total is 80 + 538 ≈ 620 ms, versus ~1.57 s before (about 2.5× better). To get further, reduce the chain: denormalize so one query returns what calls 1–2 need, or start independent parts speculatively in parallel."
        }
      ],
    },
  ],
  test: [
    {
      id: 'prod-scale-mcq-01',
      difficulty: 'hard',
      question:
        'During a 10× traffic surge, app pods are at 45% CPU, the HPA is adding pods, and p99 keeps rising. DB pool acquire time p99 is 2 s and Postgres active connections are at max_connections. What should you do first?',
      options: [
        'Raise the HPA maxReplicas so more pods can absorb the traffic.',
        'Increase each pod\'s pool size from 10 to 50 to reduce acquire wait.',
        'Restart the Postgres primary to clear stuck connections.',
        'Stop adding pods, shed/degrade low-priority traffic and cache hot reads — the DB is the bottleneck and more pods add connections and load.',
      ],
      correct: [3],
      explanation:
        'Low app CPU with long pool waits and maxed DB connections means the app is waiting on the database; more pods or bigger pools only add connections and contention to the saturated resource. Reducing work that reaches the DB (shedding, degrading, caching) is the fastest relief. Restarting the primary causes a full outage and cold caches.',
      followUps: [
        {
          "q": "You shed low-priority traffic and the DB recovers. Product asks to bring it back gradually. How do you re-admit traffic without tipping Postgres over again?",
          "a": "Ramp admission in steps (e.g. 10% of the shed class every 2 minutes) gated on DB signals, not app CPU: pool acquire p99 under ~50 ms, active connections below ~80% of `max_connections`, and replica lag flat. If any signal regresses, step back one level automatically. Before ramping, put PgBouncer in transaction mode in front of Postgres so pod count no longer multiplies server connections, and cap total pool size across pods to what the DB can actually run concurrently (roughly 2–4× cores)."
        },
        {
          "q": "How would you have caught this before users did? Name the alert you'd add.",
          "a": "Alert on pool saturation, not CPU: `db_pool_acquire_seconds` p99 > 100 ms for 2 minutes, plus `pg_stat_activity` count / `max_connections` > 85%. Add a dashboard panel that plots HPA replica count against DB connections so the 'more pods, more connections' feedback loop is visible. Also make the HPA scale on a signal that reflects the real bottleneck (request queue time or concurrency) and set a ceiling derived from DB capacity: maxReplicas × pool size must stay under the DB's connection budget."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-02',
      difficulty: 'expert',
      question:
        'Select ALL that apply: at 100× traffic, which of these limits commonly break even though "everything autoscales"?',
      options: [
        'SNAT/NAT gateway port exhaustion for outbound calls to a single third-party endpoint.',
        'The Linux conntrack table on nodes handling many short-lived connections.',
        'Third-party API rate limits and per-account cloud quotas.',
        'The maximum number of Kubernetes Deployments per namespace.',
        'Kafka consumer parallelism capped by partition count.',
      ],
      correct: [0, 1, 2, 4],
      explanation:
        'NAT port exhaustion, conntrack table overflow, external quotas and partition-bounded consumer parallelism are classic hidden ceilings that appear at large multiples of traffic. The number of Deployments per namespace is not a traffic-related limit and does not change with RPS.',
      followUps: [
        {
          "q": "Outbound calls to one payment provider start failing with connect timeouts at 100× while the provider's status page is green. How do you confirm NAT port exhaustion and fix it?",
          "a": "A NAT gateway has ~64k source ports per (public IP, destination IP:port) tuple. Check the gateway's `ErrorPortAllocation` / dropped-packets metric and count connections in `TIME_WAIT` on pods. Fixes, in order: reuse connections with an HTTP keep-alive agent and a bounded pool (biggest win; churn is usually the cause), attach more elastic IPs to the NAT gateway to multiply the port space, and use a private endpoint/peering if the provider offers one so traffic bypasses NAT entirely."
        },
        {
          "q": "Consumers lag on a 12-partition Kafka topic and you cannot repartition this week. How do you get more parallelism?",
          "a": "Decouple fetch from processing: each consumer reads its partitions but hands records to an in-process worker pool keyed by message key, so records for the same key stay ordered while different keys run in parallel (Confluent's parallel-consumer does this). Commit offsets only up to the lowest fully processed record. This lifts throughput from 12 serial lanes to hundreds of keyed lanes. The cost is more complex offset tracking and more duplicates on rebalance, so handlers must be idempotent."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-03',
      difficulty: 'hard',
      question:
        'After moving to a corporate B2B customer base, one of 6 API nodes behind nginx runs at 90% CPU while others idle at 15%. Per-node RPS is also skewed 5:1. Which config is the most likely culprit?',
      code: {
        language: 'nginx',
        code: `upstream api {
    ip_hash;
    server 10.0.0.1:3000;
    server 10.0.0.2:3000;
    server 10.0.0.3:3000;
    server 10.0.0.4:3000;
    server 10.0.0.5:3000;
    server 10.0.0.6:3000;
}`,
      },
      options: [
        'Missing keepalive in the upstream block causes connection churn on one node.',
        'ip_hash pins each client IP to one backend; a large customer\'s thousands of employees egress through a single corporate NAT IP and all land on one node.',
        'nginx round-robins by default, which cannot balance CPU-heavy requests.',
        'The upstream lacks max_fails, so nginx keeps sending traffic to a failed node.',
      ],
      correct: [1],
      explanation:
        'With ip_hash, all traffic from one source IP goes to the same backend. B2B customers often egress through a handful of NAT IPs, concentrating thousands of users on one node — exactly the 5:1 RPS skew. Missing keepalive affects all nodes equally; ip_hash is configured so it is not round-robin; max_fails concerns failed nodes, but this node is up and overloaded.',
      followUps: [
        {
          "q": "You switch from `ip_hash` to round-robin, but the app keeps per-user session state in memory, so users get logged out. What do you do?",
          "a": "Move session state out of the process into Redis (or a signed, encrypted cookie for small sessions) so any node can serve any request. If you must keep affinity short-term, use cookie-based stickiness (`sticky cookie` in nginx Plus, or hash on a session cookie with `hash $cookie_sid consistent`), which keys on the user rather than the NAT IP, so one corporate gateway spreads across all nodes. Long-term, stateless nodes are the goal, because affinity also breaks during deploys and scale-in."
        },
        {
          "q": "Even with round-robin, one node still runs hotter because some requests are 50× more expensive than others. What balancing algorithm helps?",
          "a": "Round-robin balances request counts, not work. Use `least_conn` (or Envoy's least-request with power-of-two-choices): pick two random backends and send to the one with fewer in-flight requests. That reacts to slow requests naturally, because a node busy with heavy reports has more in-flight work and receives fewer new ones. For very heavy endpoints (exports, reports), route them to a separate pool or an async job queue so they never share capacity with latency-sensitive traffic."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-04',
      difficulty: 'medium',
      question:
        'Primary DB CPU is 85% with a flat write rate. pg_stat_statements shows one query called 40k times/s at 1.5 ms mean, and a nightly report running 20 min at 2 AM. Which is the highest-leverage fix for daytime CPU?',
      options: [
        'Cache or optimise the 40k/s query (index, cache-aside with a short TTL) — it consumes ~60 CPU-seconds per second.',
        'Move the nightly report to a replica.',
        'Add two read replicas and route the report there.',
        'Increase shared_buffers to make the report faster.',
      ],
      correct: [0],
      explanation:
        '40,000 × 1.5 ms = 60 s of execution per second — around 60 cores\' worth of time — which dominates daytime load. The report runs at 2 AM and does not explain daytime CPU; moving it is good hygiene but low leverage for this symptom. shared_buffers tuning does not address the call volume.',
      followUps: [
        {
          "q": "You add a 30 s cache-aside for that query, and at every TTL expiry the DB CPU spikes. What's happening and how do you fix it?",
          "a": "Cache stampede: when a hot key expires, every concurrent request misses at once and all run the query. At 40k/s even a 50 ms miss window sends ~2,000 identical queries. Fix with request coalescing (single-flight per key: one request recomputes, the rest wait on the same promise), probabilistic early refresh (refresh slightly before expiry with a probability that rises near the TTL), or serve-stale-while-revalidate. Also add jitter to TTLs so many keys don't expire together."
        },
        {
          "q": "The query turns out to be `SELECT * FROM settings WHERE tenant_id = $1`, called once per request. Is a cache still the right answer?",
          "a": "Look at the call pattern first. 40k/s for per-tenant settings means it is fetched on every request, often several times. Load it once per request (memoize in the request context) and keep a small in-process LRU with a short TTL or invalidation via pub/sub on change. Tenant settings rarely change, so an in-process copy removes the DB call and the network hop to Redis. Also check the plan: 1.5 ms for a PK lookup suggests a missing index or `SELECT *` pulling a wide JSON column."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-05',
      difficulty: 'hard',
      question:
        'A replica shows `now() - pg_last_xact_replay_timestamp()` = 45 minutes at 4 AM, but pg_stat_replication on the primary shows replay_lag near zero and no writes have happened since 3:15 AM. What is going on?',
      code: {
        language: 'sql',
        code: `-- on the replica, 04:00
SELECT now() - pg_last_xact_replay_timestamp() AS lag;       -- 00:45:02
-- on the primary
SELECT application_name, replay_lag FROM pg_stat_replication; -- replica-1 | 00:00:00.002`,
      },
      options: [
        'The replica is broken and must be rebuilt from a base backup.',
        'hot_standby_feedback is off, so the replica stopped replaying.',
        'The metric measures time since the last replayed transaction; with no writes on the primary it grows even though the replica is fully caught up.',
        'The replica clock is 45 minutes behind; NTP must be fixed.',
      ],
      correct: [2],
      explanation:
        'pg_last_xact_replay_timestamp() is the commit time of the last replayed transaction; on an idle primary no new transactions exist, so the difference keeps growing despite zero real lag. Compare LSNs (pg_wal_lsn_diff) or check replay_lag on the primary instead. hot_standby_feedback affects vacuum conflicts, not whether replay happens; clock skew would not explain lag growing exactly since the last write.',
      followUps: [
        {
          "q": "Your replica-lag alert uses this metric and pages on-call every quiet night. How do you rewrite the alert so it pages only for real lag?",
          "a": "Measure bytes behind, not time since the last transaction: on the primary, `pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)` from `pg_stat_replication`, alerting when it exceeds e.g. 256 MB for 5 minutes. Alternatively write a heartbeat row on the primary every few seconds (as pt-heartbeat does) and measure `now() - heartbeat_ts` on the replica; heartbeats guarantee a fresh transaction, so the time-based metric becomes accurate even when the system is idle."
        },
        {
          "q": "The primary dies at 4 AM. How do you decide which of two replicas to promote?",
          "a": "Promote the replica with the highest received/replayed LSN (`pg_last_wal_receive_lsn()`), because it has the least data loss. Then fence the old primary (STONITH or revoke its VIP) so it cannot accept writes if it comes back, and repoint the other replica to follow the new primary (pg_rewind if it diverged). Tools like Patroni do this using a DCS lock. Timestamps are useless for this decision for the same reason they misled the lag alert."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-06',
      difficulty: 'expert',
      question:
        'What problem does this read-after-write strategy still have?',
      code: {
        language: 'typescript',
        code: `// after any write, pin this user's reads to the primary for 3 seconds
async function afterWrite(userId: string) {
  await redis.set('pin:' + userId, '1', 'EX', 3);
}
async function readPool(userId: string) {
  return (await redis.exists('pin:' + userId)) ? primary : randomReplica();
}`,
      },
      options: [
        'Redis EXISTS is O(N) and will overload Redis at scale.',
        'Pinning to the primary breaks monotonic reads because the primary can be behind replicas.',
        'The pin key must be set before the write, otherwise the write is invisible to the primary.',
        'When replica lag exceeds 3 s (e.g. during a bulk import), reads after the pin expires still return stale data; lag-aware replica selection or LSN tokens are needed.',
      ],
      correct: [3],
      explanation:
        'Time-based pinning assumes lag is always below the window; during write bursts lag can be tens of seconds, so reads after 3 s can still be stale. LSN tokens or excluding lagging replicas fix it. EXISTS is O(1); the primary is never behind its replicas; and the write is visible on the primary immediately regardless of the pin.',
      followUps: [
        {
          "q": "You replace the pin with LSN tokens, but the user switches from the mobile app to the web app right after editing. The token was in the mobile session. What now?",
          "a": "Store the last-write LSN server-side, keyed by user ID (e.g. Redis `user:{id}:lsn` with a TTL of a few minutes), instead of only in a client cookie. Any device or session then looks up the user's latest LSN and routes to a replica that has replayed it, or to the primary. The Redis lookup costs ~0.2 ms, and you only need it for user-scoped reads. If Redis is down, fall back to the primary for that user, never to an unchecked replica."
        },
        {
          "q": "How would you test that read-after-write actually holds under lag spikes?",
          "a": "Inject lag deliberately: in staging, pause replay on one replica with `pg_wal_replay_pause()` (or add network delay with `tc netem`), then run a test that writes, immediately reads through the router, and asserts the new value — thousands of times with randomized delays. Also run it in production as a synthetic canary: a probe user edits a field every minute and reads it back, and you alert on any stale read. Count `stale_read_detected` with a version column so real occurrences are measurable."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-07',
      difficulty: 'hard',
      question:
        'Select ALL that apply: a table receives 25k single-row INSERTs/s and commit latency is rising. Which changes reduce primary load substantially?',
      options: [
        'Batch inserts into multi-row statements/COPY with one commit per batch.',
        'Drop unused secondary indexes on the table.',
        'Add read replicas.',
        'Buffer events in Kafka and write them in batches from consumers.',
        'Increase max_connections so more inserts run concurrently.',
      ],
      correct: [0, 1, 3],
      explanation:
        'Batching amortises per-statement and per-commit (fsync/WAL flush) overhead; each index adds write amplification per row; a queue smooths bursts and enables batch writes. Replicas scale reads, not writes — they must replay every write too. More concurrent connections increase contention and do not reduce the work.',
      followUps: [
        {
          "q": "You batch inserts 500 rows per commit. The app pod crashes with a half-filled buffer. What's lost and how do you prevent it?",
          "a": "Everything buffered in memory but not committed is lost: up to 500 rows, or more if the flush stalled. Either make the producer durable before acking (write to Kafka with `acks=all` first and let consumers batch-insert, committing offsets only after the DB commit), or flush on a short timer (e.g. 50 ms or 500 rows, whichever comes first) and acknowledge clients only after the flush commits. With Kafka in front, a crash just means re-reading from the last committed offset, so inserts must be idempotent (`ON CONFLICT DO NOTHING` on an event ID)."
        },
        {
          "q": "Which secondary index would you still keep even though it costs writes, and how do you find the unused ones?",
          "a": "Keep indexes that back unique constraints, foreign-key lookups (deletes on the parent scan the child without one) and the hot read paths. Find unused ones with `pg_stat_user_indexes` where `idx_scan = 0` over a full business cycle (include month-end jobs), checked on every replica, because replicas have their own stats. Drop with `DROP INDEX CONCURRENTLY` after first marking them invalid or keeping the DDL ready to recreate. Each removed index saves a WAL record and a random page write per insert."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-08',
      difficulty: 'medium',
      question:
        'An events table is range-partitioned across shards by `created_at` month. Writes are slow and one shard is at 100% while the others are idle. Why?',
      options: [
        'Range sharding on time sends all new writes to the latest range — a hot shard by construction.',
        'Monthly ranges are too large; weekly ranges would spread writes evenly.',
        'Older shards are compacting, which blocks writes cluster-wide.',
        'The shard router caches shard maps and routes everything to the first shard.',
      ],
      correct: [0],
      explanation:
        'With a monotonically increasing key and range partitioning, "now" lives on one shard, so it takes 100% of writes. Smaller ranges only change how often the hot spot moves. Fix with hashing (e.g. hash(device_id) plus a time bucket). Compaction on old shards and router bugs would not produce this systematic pattern.',
      followUps: [
        {
          "q": "You switch to `hash(device_id)` sharding. Now the dashboard query 'all events in the last hour' is slow. Why, and how do you fix it?",
          "a": "A time-range query no longer maps to one shard; it scatters to every shard and the router merges results, so latency is set by the slowest shard. Within each shard, add local time partitioning (hash shard, then monthly partitions with an index on `created_at`) so each shard scans only the last hour. For dashboards, maintain pre-aggregated rollups (per-minute counts written by a stream processor) rather than scanning raw events. Ingest locality and query locality pull in opposite directions; serve each with its own structure."
        },
        {
          "q": "One device sends 30% of all events after a firmware bug. Hash sharding puts it on one shard. What do you do?",
          "a": "Rate-limit or sample that device at ingest first, since it is a bug and not real demand. Structurally, salt hot keys: write to `hash(device_id, n)` where `n = seq % K` for devices on a hot-key list, spreading one device over K shards, and fan in on read. Detect hot keys automatically from per-key counters (a top-K sketch at the ingest tier). Salting only the known-hot keys keeps reads for normal devices on a single shard."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-09',
      difficulty: 'expert',
      question:
        'You migrate from `tenant_id % 16` to `tenant_id % 32` physical shards. Roughly what fraction of tenants must move, and what is the better design?',
      options: [
        '~1/32 of tenants; modulo already behaves like consistent hashing.',
        '~50% of tenants (every key where t mod 32 ≥ 16); map many fixed logical buckets to physical shards so growth moves only chosen buckets.',
        '~100% of tenants; use a bigger modulus like % 1024 next time.',
        '~25% of tenants; use range sharding on tenant_id instead.',
      ],
      correct: [1],
      explanation:
        'For doubling from 16 to 32, t mod 32 equals t mod 16 exactly when t mod 32 < 16, so half the keys stay and half move. (Arbitrary changes such as 16 → 17 move ~94%.) Fixed logical buckets with a mutable bucket→shard map (or consistent hashing) let you move only selected buckets. Range sharding on tenant_id reintroduces hotspots for new tenants.',
      followUps: [
        {
          "q": "You move to 4,096 logical buckets. Describe how you actually move one bucket from shard A to shard B with writes ongoing.",
          "a": "1) Copy the bucket's rows from A to B while A keeps serving (snapshot + CDC filtered by bucket). 2) When CDC lag for that bucket is near zero, briefly block writes for that bucket only (a few hundred ms, using a per-bucket write lock or by rejecting with retry). 3) Drain remaining CDC events, verify row counts and checksums. 4) Flip the bucket→shard map entry to B and bump its version. 5) Unblock; routers with the old map version get a 'wrong shard' error and refresh. 6) Delete the bucket's data from A later. Only one bucket (~1/4,096 of the data) is ever in flight."
        },
        {
          "q": "Routers cache the bucket map. How do you stop a router with a stale map from writing to the old shard after the flip?",
          "a": "Don't rely on routers refreshing in time; enforce on the shard. Each shard stores which buckets it owns plus an epoch, and every write carries the bucket ID and the router's map epoch. The old shard rejects writes for buckets it no longer owns (`WRONG_SHARD, epoch=N+1`), and the router reloads the map and retries. Vitess and MongoDB use this pattern (shard-side ownership checks). Routers can also subscribe to map changes for fast propagation, but correctness comes from the shard-side check."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-10',
      difficulty: 'expert',
      question:
        'Select ALL that apply: you are migrating a table to a new database. Why is CDC (e.g. Debezium on the WAL) usually preferred over application-level dual writes?',
      options: [
        'App dual writes without a cross-store transaction can silently diverge when one write succeeds and the other fails or the process crashes between them.',
        'CDC captures writes from every writer (cron jobs, admin scripts, other services), not just the code paths you modified.',
        'CDC preserves per-row commit order when keyed by primary key, avoiding out-of-order overwrites.',
        'CDC removes the need for a backfill of historical data.',
      ],
      correct: [0, 1, 2],
      explanation:
        'CDC derives changes from the committed log, so it cannot miss a committed write or record one that rolled back, it covers all writers, and keyed partitions preserve per-row ordering. It does not remove backfill: historical rows still need a snapshot (Debezium performs an initial snapshot precisely for that).',
      followUps: [
        {
          "q": "Debezium falls 2 hours behind during the migration and the Postgres primary's disk starts filling. Why, and what do you do?",
          "a": "The replication slot holds WAL until Debezium confirms it, so a slow or stuck consumer makes the primary retain every WAL segment and the disk fills. Immediate action: alert on `pg_replication_slots` retained bytes, speed up the consumer (more Kafka Connect tasks, or check sink backpressure), and set `max_slot_wal_keep_size` (PG13+) so Postgres invalidates the slot rather than taking the primary down. That forces a re-snapshot, which is cheaper than an outage. Never leave an abandoned slot behind after the migration."
        },
        {
          "q": "How do you prove the new database matches the old one before cutting reads over?",
          "a": "Run a continuous verifier: for each logical bucket or ID range, compute a checksum (e.g. `md5(string_agg(row::text ORDER BY id))`) on both sides at the same CDC position, and re-check mismatched ranges after a short delay to filter in-flight changes. Add shadow reads: serve from old, also read from new asynchronously, compare and log diffs by field. Cut over per tenant or bucket once the diff rate stays at zero for days, and keep reverse CDC (new→old) running so rollback stays possible."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-11',
      difficulty: 'hard',
      question:
        'Sydney users see 2.5 s TTFB on a personalised, uncacheable API hosted in Virginia (RTT ~200 ms). Server time is 60 ms. Traces show each request opens a new TLS connection. What single change helps most?',
      options: [
        'Add a Redis cache in front of the API in Virginia.',
        'Increase server instances in Virginia to reduce server time.',
        'Terminate TLS at a nearby CDN/edge PoP that keeps warm, reused connections to the origin, and enable keep-alive on clients.',
        'Move from JSON to protobuf to shrink payload size.',
      ],
      correct: [2],
      explanation:
        'The time is dominated by long-haul handshakes (TCP + TLS each cost a 200 ms RTT, more with TLS 1.2, retransmits and mobile networks). Edge termination makes handshakes local and reuses warm origin connections, leaving ~1 long RTT. Caching does not apply to uncacheable responses, server time is only 60 ms, and payload size is not the bottleneck.',
      followUps: [
        {
          "q": "After edge termination, Sydney TTFB is still ~400 ms because each request needs one 200 ms round trip to Virginia. What's next if product needs < 150 ms?",
          "a": "The remaining cost is physics, so you need data in or near the region. Options in order of cost: cache per-user data at the edge with short TTLs or stale-while-revalidate where freshness allows; deploy read replicas plus stateless app pods in ap-southeast-2 so reads stay local (~15–30 ms) while writes still go to Virginia; or fully partition users by home region so each user's reads and writes are local. Go for regional reads first; multi-region writes bring conflict and residency complexity."
        },
        {
          "q": "You can't change the mobile client and it opens a new connection per request. What can you do server-side?",
          "a": "Make each new connection cheap: terminate at a nearby edge so the handshakes are 15 ms local RTTs instead of 200 ms; enable TLS 1.3 (1-RTT) and session resumption/0-RTT for idempotent GETs; serve HTTP/3/QUIC from the edge so the transport and TLS handshake combine. Raise the server-side keep-alive timeout in case the client would reuse connections that are currently being closed. All of this happens at the CDN/edge config level without a client release."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-12',
      difficulty: 'hard',
      question:
        'After each frontend release, API p99 spikes for ~10 minutes and pod egress is saturated. The bundle is served from the pods with `Cache-Control: no-cache` and a fixed name `app.js`. What is the right fix?',
      options: [
        'Set Cache-Control max-age=31536000 on app.js so browsers keep it for a year.',
        'Scale the pods up during releases to absorb the download spike.',
        'Gzip app.js on the fly in Node to reduce bytes.',
        'Build content-hashed filenames (app.3f9a1c.js) served from object storage via CDN with `max-age=31536000, immutable`, and keep index.html on a short TTL.',
      ],
      correct: [3],
      explanation:
        'Hashed filenames make each version a new immutable URL, so it can be cached forever at the CDN and browser while index.html (short TTL) points to the latest; the pods never serve bytes. A year-long TTL on a fixed name means users would not get updates. Scaling pods and on-the-fly gzip treat symptoms and cost CPU.',
      followUps: [
        {
          "q": "With hashed assets on the CDN, a user loaded an old index.html just before deploy and now requests `app.3f9a1c.js`, which you deleted. What happens and how do you prevent it?",
          "a": "They get a 404 for the old chunk and the app breaks (common with lazy-loaded chunks in long-lived tabs). Keep old hashed assets in object storage for several releases (e.g. 30 days, via a lifecycle rule rather than deleting on deploy), since they're tiny and immutable. Add a client handler: on chunk-load failure, reload index.html once. Upload new assets before switching index.html, never after, so new HTML never points at missing files."
        },
        {
          "q": "How would you verify after the change that pods no longer serve static bytes during a release?",
          "a": "Compare pod egress and request counts by path before and after a release: the `/static/*` request rate at the ingress should be ~0, and pod egress during a release should match normal traffic. On the CDN, check the cache hit ratio for asset paths (should be > 99% shortly after release) and origin fetches, which should only come from object storage. A synthetic check can also curl a new asset through the CDN and assert the `Cache-Control: immutable` header and `x-cache: HIT` on the second fetch."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-13',
      difficulty: 'expert',
      question:
        'What will happen when this runs for a 2M-tenant nightly job?',
      code: {
        language: 'typescript',
        code: `const tenants = await db.query('SELECT id FROM tenants');
for (const t of tenants.rows) {
  await queue.add('nightly-report', { tenantId: t.id }); // BullMQ, default opts
}
// workers: concurrency 50, 40 replicas, autoscaled on queue depth`,
      },
      options: [
        'Enqueueing takes ~2M sequential round trips; completed jobs accumulate in Redis (no removeOnComplete); 2,000 concurrent workers hit the DB at once; and re-running the scheduler duplicates every job (no jobId).',
        'It works fine; BullMQ batches adds internally and default options clean up jobs.',
        'Only the enqueue loop is a problem; everything else is bounded by BullMQ defaults.',
        'The workers will starve because BullMQ processes one job per queue at a time by default.',
      ],
      correct: [0],
      explanation:
        'Each add is a round trip (~0.5–1 ms → roughly 20–30 minutes for 2M); by default BullMQ keeps completed and failed jobs, so Redis memory grows every night; 40 × 50 = 2,000 concurrent jobs is sized to the queue rather than to the DB; and without deterministic job IDs a retried scheduler enqueues duplicates. Fix with addBulk and chunking, retention options, DB-bounded concurrency, jitter and idempotent job IDs. BullMQ concurrency is per worker, not one job per queue.',
      followUps: [
        {
          "q": "You fix the enqueue loop with addBulk. Now how do you size worker concurrency for the 2M jobs so the DB survives?",
          "a": "Start from the DB budget, not the queue size. If each job does ~5 queries at ~2 ms and the DB can spare ~20 cores at night, that's ~10,000 queries/s, so ~2,000 jobs/s. Pick concurrency from Little's law: total concurrency ≈ throughput × job duration. At 2,000 jobs/s and 50 ms each that's about 100 concurrent jobs, not 2,000. Enforce it globally with BullMQ's rate limiter (`limiter: { max, duration }`) so adding worker pods can't exceed it. 2M jobs at 2,000/s finishes in ~17 minutes."
        },
        {
          "q": "The scheduler pod crashes after enqueueing 1.2M of 2M jobs and restarts. With jobId = `invoice:{tenant}:{date}`, what happens, and is that enough?",
          "a": "BullMQ ignores adds whose jobId already exists, so re-running the scheduler re-enqueues only the missing 800k jobs without duplicating anything. That makes the enqueue idempotent. It is not enough on its own, though: jobs can still run twice, for example when a worker dies after sending an invoice but before marking the job complete, or when retention removed the job ID. The job itself must be idempotent too (check `invoices` for (tenant, date) with a unique constraint before sending). Dedup at the queue and at the side effect."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-14',
      difficulty: 'expert',
      question:
        'Select ALL that apply: a whale tenant generates 35% of load on shard 3 of 12. Which are sound mitigations or long-term fixes?',
      options: [
        'Short-TTL caching and a shard-3 read replica for the whale\'s hottest reads.',
        'Move to a directory (tenant→shard) mapping and place the whale on a dedicated shard.',
        'Split the whale across shards with a secondary key such as (tenant_id, hash(project_id)) when one node cannot hold it.',
        'Increase the modulus to % 13 so tenants redistribute more evenly.',
      ],
      correct: [0, 1, 2],
      explanation:
        'Caching/replicas relieve reads now; a directory enables explicit placement of big tenants; a composite key splits a tenant too large for a node. Changing to % 13 remaps ~92% of tenants and still keeps the whale on one shard, so it pays a huge migration cost without fixing the skew.',
      followUps: [
        {
          "q": "You decide to move the whale to a dedicated shard. How do you do it without a maintenance window for that customer?",
          "a": "With the directory in place: create the new shard, copy the whale's data via snapshot plus CDC filtered on tenant_id, and verify with checksums. Then pause the whale's writes briefly (seconds), drain CDC, flip `tenant→shard` in the directory, bump the epoch, and resume. Old-shard writes for that tenant are rejected by an ownership check. Do it at the tenant's quietest hour and announce a short 'read-only for a few seconds' window. Keep the old copy for a few days for rollback."
        },
        {
          "q": "A year later the whale is bigger than any single node can hold. What does splitting by (tenant_id, hash(project_id)) break?",
          "a": "Any query spanning the whole tenant (cross-project reports, tenant-wide search, uniqueness constraints like 'email unique per tenant') now scatters across shards, and transactions spanning two projects become distributed. Mitigate by keeping tenant-global data (users, settings) on a home shard, building reporting from a CDC-fed warehouse instead of live scatter queries, and enforcing tenant-wide uniqueness via a dedicated lookup table. Check that most requests are project-scoped before choosing project as the split key."
        }
      ],
    },
    {
      id: 'prod-scale-mcq-15',
      difficulty: 'medium',
      question:
        'A Redis instance backing BullMQ is at 95% memory with `maxmemory-policy allkeys-lru`. What is the most serious risk?',
      options: [
        'Redis will reject new job adds with OOM errors.',
        'LRU eviction slows Redis to disk-speed operations.',
        'Redis may silently evict job keys, losing queued or in-progress jobs and corrupting queue state.',
        'BullMQ automatically switches to a secondary Redis, causing duplicate processing.',
      ],
      correct: [2],
      explanation:
        'With allkeys-lru, Redis evicts keys to make room — including job hashes and queue structures — which loses jobs without any error. Queues require noeviction so writes fail loudly (OOM errors are the behaviour with noeviction, not LRU). Eviction does not use disk, and BullMQ does not fail over to another Redis on its own.',
      followUps: [
        {
          "q": "You set `noeviction` and now job adds fail with OOM at peak. How do you keep the queue healthy?",
          "a": "Find what's using the memory: usually completed and failed jobs kept forever. Set `removeOnComplete: { age: 3600, count: 1000 }` and `removeOnFail: { age: 7 * 86400 }`, and keep large payloads out of jobs (store an S3 key or DB ID instead of a 200 KB JSON blob). Alert at 70–80% `used_memory/maxmemory` so you act before OOM. Producers should treat OOM as backpressure: retry with backoff or spill to a durable fallback, never drop silently. Run cache workloads on a separate Redis with LRU."
        },
        {
          "q": "The Redis node behind BullMQ fails over to its replica. What can go wrong with in-flight jobs?",
          "a": "Redis replication is asynchronous, so writes acknowledged just before the failover (new adds, or a job moved to 'completed') may be missing on the promoted replica. Jobs can be lost (adds vanish) or run twice (a completion record vanishes, then the stalled-job checker re-queues a job that already ran). Use AOF with `appendfsync everysec` and `WAIT 1` for critical adds if needed, make job handlers idempotent, and reconcile critical work (e.g. invoices) against the database rather than trusting queue state alone."
        }
      ],
    },
  ],
};

export default topic;
