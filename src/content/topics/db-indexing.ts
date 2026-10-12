import type { Topic } from '../../types';

const topic: Topic = {
  id: 'db-indexing',
  phase: 'databases',
  order: 2,
  title: 'Indexing & Query Optimization',
  subtitle:
    'B-tree vs LSM vs hash vs GIN/GiST/BRIN, composite indexes and the leftmost-prefix rule, covering and partial indexes, reading EXPLAIN ANALYZE, finding slow queries, N+1 and DataLoader, keyset pagination, write amplification and timeouts.',
  estimatedMinutes: 110,
  sources: [
    'Alex Xu — System Design Interview Vol 2, Ch 1 Proximity Service (geospatial indexing)',
    'PostgreSQL 16 docs — Ch 11 Indexes, Ch 14 Performance Tips (EXPLAIN)',
    'Markus Winand — Use The Index, Luke',
    'Mastering API Architecture — Ch 2 (API performance, pagination)',
  ],
  tags: ['indexing', 'b-tree', 'lsm', 'gin', 'explain', 'query-optimization', 'n+1', 'dataloader', 'pagination', 'postgres'],
  cheatSheet: [
    'B-tree: sorted, fanout ~hundreds per 8 KB page → depth 3–4 for a billion rows; supports =, <, >, BETWEEN, ORDER BY, prefix LIKE \'abc%\'. Default for OLTP.',
    'LSM (RocksDB, Cassandra): writes sequential to memtable + WAL, flushed to SSTables and compacted — great write throughput, reads may touch several levels (Bloom filters help).',
    'Composite index (a, b, c) serves filters on a, (a,b), (a,b,c) — leftmost prefix. Put equality columns first, then the range/sort column; a range on b stops c from narrowing the scan.',
    'Covering index (INCLUDE columns) → Index Only Scan with no heap fetches — if the visibility map is fresh (VACUUM).',
    'Selectivity matters: an index on a boolean or a status with 3 values rarely helps unless the queried value is rare → use a partial index (WHERE status = \'pending\').',
    'EXPLAIN (ANALYZE, BUFFERS): compare estimated vs actual rows (10× off = stale stats or correlated columns), look for Seq Scan on big tables, Rows Removed by Filter, Sort Method: external merge, and loops × time.',
    'Find what to fix with pg_stat_statements ordered by total_exec_time, not by the single slowest query.',
    'N+1: one query per parent row; in GraphQL fix with DataLoader (per-request batching + cache) → 1 + 1 queries using WHERE id = ANY($1).',
    'OFFSET 100000 reads and discards 100K rows; keyset pagination (WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 20) is O(page).',
    'Each index adds write cost (every INSERT updates every index; UPDATE of an indexed column defeats HOT) — drop unused indexes (pg_stat_user_indexes.idx_scan = 0); always set statement_timeout.',
  ],
  sections: [
    {
      heading: 'What an index really is (and what it costs)',
      body: `**Intuition:** an index is a sorted copy of some columns with pointers back to the rows — like the index at the back of a book. Finding a word goes from reading every page to jumping to the right page.

**The mechanics in PostgreSQL**
- Tables are **heaps**: rows in no particular order, stored in 8 KB pages, addressed by \`ctid\` (page, offset).
- A B-tree index stores (key → ctid) sorted, in 8 KB pages. With ~16-byte keys, a page holds a few hundred entries, so **fanout ≈ 200–400**:
  - depth 2 → ~100K keys, depth 3 → ~30M, depth 4 → ~10B.
- A point lookup = 3–4 index page reads + 1 heap page read. Root and inner pages are almost always cached, so it is typically **1–2 real I/Os** (~0.1 ms each on NVMe, ~microseconds if in shared_buffers).
- A full scan of a 50 GB table at ~1 GB/s sequential is ~50 s.

**MySQL InnoDB differs:** the table *is* a B-tree clustered by primary key; secondary indexes store the **primary key** (not a physical pointer), so a secondary lookup is two B-tree descents. That is why a random UUIDv4 primary key hurts InnoDB (page splits, poor locality) and why UUIDv7/ULID or bigint keys are preferred.

**Costs of every index**
- Write amplification: each INSERT/DELETE touches every index; an UPDATE touching an indexed column writes new entries in each index.
- Storage and cache pressure: indexes compete with data for RAM.
- Planner time and maintenance (vacuum, bloat).

**Rule of thumb:** index for your top queries by total time, not "every column in a WHERE clause".`,
      diagram: `             B-tree on orders(customer_id)         (fanout ~300)

                       [ root: 1..|4000|8000.. ]           level 0 (cached)
                      /            |            \\
          [ 1..|1300|2600.. ]  [ 4000..|5300.. ]  ...      level 1 (cached)
              /      \\
   [ 1301:(p12,3) (p98,1) 1302:(p7,5) ... ]                 leaf (ordered keys
              |           |                                  -> heap ctids)
        heap page 12   heap page 98       <- random heap reads = the real cost`,
      keyPoints: [
        'Fanout ~hundreds → depth 3–4 even for billions of rows.',
        'Postgres: heap + separate indexes (ctid). InnoDB: clustered PK; secondaries store PK.',
        'Every index taxes every write — index deliberately.',
      ],
    },
    {
      heading: 'Index structures: B-tree vs LSM vs hash vs GIN/GiST/BRIN',
      body: `**Intuition:** different questions need different lookup structures. Sorted trees answer ranges; hash tables answer exact matches; inverted indexes answer "which rows contain this word"; spatial trees answer "what is near this point".

| Structure | Good for | Not for | Where |
|---|---|---|---|
| **B-tree / B+tree** | =, ranges, ORDER BY, prefix LIKE, uniqueness | Full-text, "contains", suffix LIKE | Default in Postgres, MySQL, Oracle |
| **LSM tree** | Very high write throughput (sequential writes), compression | Read-latency-sensitive range queries under heavy compaction | RocksDB, Cassandra, ScyllaDB, LevelDB, MyRocks |
| **Hash** | Exact equality only, O(1) | Ranges, sorting | Postgres hash index (WAL-logged since v10), in-memory stores |
| **GIN** (inverted) | Arrays, JSONB containment (\`@>\`), full-text (tsvector), trigram (\`pg_trgm\`) for \`ILIKE '%abc%'\` | Range queries; heavy-write tables (slower updates, uses pending list) | Postgres |
| **GiST / SP-GiST** | Geometric/range types, nearest neighbour (KNN \`<->\`), exclusion constraints, PostGIS | Simple equality | Postgres, PostGIS |
| **BRIN** | Huge append-only tables where values correlate with physical order (timestamps) — tiny index | Randomly ordered data | Postgres |
| **Bitmap** | Low-cardinality columns in analytics | OLTP with frequent writes | Oracle, column stores |

**LSM in one paragraph:** writes go to an in-memory memtable (plus WAL), are flushed as immutable sorted SSTables, and background compaction merges them. Writes are fast; a read may check the memtable and several SSTables (Bloom filters skip most). Trade-offs: **write amplification** from compaction (10–30× in leveled compaction), **read amplification**, and **space amplification** during compaction. B-trees update in place: better read predictability, worse random-write throughput.

**Geo indexing** (Alex Xu Vol 2, Ch 1): geohash/S2/H3 cell ids in a B-tree turn "nearby" into a prefix/range scan; PostGIS uses GiST (R-tree-like); quadtrees are often in-memory structures.`,
      code: [
        {
          language: 'sql',
          title: 'Choosing the right Postgres index type per query',
          code: `-- Equality + range + sort on a timestamp: B-tree
CREATE INDEX idx_orders_customer_created ON orders (customer_id, created_at DESC);

-- JSONB containment: WHERE attrs @> '{"color":"red"}'
CREATE INDEX idx_product_attrs ON product USING gin (attrs jsonb_path_ops);

-- Substring search: WHERE name ILIKE '%phone%'  (B-tree cannot help)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_product_name_trgm ON product USING gin (name gin_trgm_ops);

-- Full-text search
CREATE INDEX idx_article_fts ON article USING gin (to_tsvector('english', body));

-- Nearest drivers: ORDER BY location <-> ST_MakePoint($1, $2) LIMIT 10
CREATE INDEX idx_driver_location ON driver USING gist (location);

-- 2 TB append-only events table ordered by time: BRIN is ~1000x smaller than B-tree
CREATE INDEX idx_events_ts_brin ON events USING brin (occurred_at) WITH (pages_per_range = 64);

-- Always build on live tables without blocking writes
CREATE INDEX CONCURRENTLY idx_orders_status_pending ON orders (created_at)
  WHERE status = 'pending';`,
        },
      ],
      keyPoints: [
        'B-tree for ranges/sort; GIN for "contains"; GiST for geo/KNN/ranges; BRIN for huge time-ordered tables.',
        'LSM trades read and compaction amplification for write throughput.',
        'CREATE INDEX CONCURRENTLY on production tables (slower, no write lock; can leave an INVALID index on failure).',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 1 Proximity Service',
    },
    {
      heading: 'Composite indexes and the leftmost-prefix rule',
      body: `**Intuition:** a composite index on (last_name, first_name) is a phone book. You can find all "Sharma"s, or "Sharma, Priya" — but not all "Priya"s, because the book is not sorted by first name.

**Rules**
1. An index on \`(a, b, c)\` can be used for predicates on \`a\`, \`a AND b\`, \`a AND b AND c\` — the **leftmost prefix**.
2. Filtering on \`b\` alone generally cannot use a B-tree scan efficiently (Postgres may do a full index scan if it is smaller than the table; Postgres 18 adds skip scan for some cases; MySQL 8.0.13+ has skip scan for low-cardinality leading columns).
3. **Equality columns first, then the range or sort column.** In \`WHERE a = ? AND b > ? AND c = ?\`, the range on b means c can only be applied as a filter on index entries, not to narrow the scan.
4. The index can satisfy \`ORDER BY\` if the sort matches the index order after the equality prefix: index \`(customer_id, created_at DESC)\` serves \`WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20\` with no sort node — the top-N query reads 20 entries and stops.
5. Column order vs selectivity: "most selective first" is a myth when all columns use equality — order by **which prefixes your queries need**. Selectivity matters when choosing *which* columns to index.

**Worked example — multi-tenant SaaS:** queries always include \`tenant_id\`. Index \`(tenant_id, status, created_at)\` serves:
- \`tenant_id = ? AND status = ? ORDER BY created_at DESC\` — perfect.
- \`tenant_id = ? ORDER BY created_at\` — uses the index for tenant_id but must sort (status sits between). Add \`(tenant_id, created_at)\` if this is hot.`,
      code: [
        {
          language: 'sql',
          title: 'Which queries can use idx (tenant_id, status, created_at)?',
          code: `CREATE INDEX idx_ticket_t_s_c ON ticket (tenant_id, status, created_at DESC);

-- 1) Full use: equality, equality, then ordered range -> Index Scan, no Sort, stops at 50
SELECT id FROM ticket
 WHERE tenant_id = 7 AND status = 'open'
 ORDER BY created_at DESC LIMIT 50;

-- 2) Prefix only (tenant_id): index narrows to the tenant, then a Sort node is needed
SELECT id FROM ticket WHERE tenant_id = 7 ORDER BY created_at DESC LIMIT 50;

-- 3) Range on status (IN is fine; each value is a separate descent)
SELECT id FROM ticket
 WHERE tenant_id = 7 AND status IN ('open','pending') AND created_at > now() - interval '7 days';

-- 4) Cannot use it efficiently: leading column missing
SELECT id FROM ticket WHERE status = 'open';

-- 5) Function on the column defeats the index -> rewrite as a range
-- BAD:  WHERE tenant_id = 7 AND date(created_at) = '2026-09-01'
SELECT id FROM ticket
 WHERE tenant_id = 7 AND status = 'open'
   AND created_at >= '2026-09-01' AND created_at < '2026-09-02';`,
        },
      ],
      keyPoints: [
        'Leftmost prefix: (a,b,c) serves a, ab, abc.',
        'Equality first, then range/sort; a range stops later columns from narrowing the scan.',
        'Index order can eliminate Sort + enable early LIMIT termination.',
        'Functions/casts on indexed columns disable the index unless you build an expression index.',
      ],
    },
    {
      heading: 'Covering indexes and index-only scans',
      body: `**Intuition:** if the index already contains every column the query needs, the database never has to open the table — like answering from the book's index without turning to the page.

**Mechanics**
- Postgres: \`CREATE INDEX ... (customer_id, created_at) INCLUDE (total, status)\` — INCLUDE columns are stored in leaf pages but are not part of the search key (no ordering, no uniqueness).
- Plan shows **Index Only Scan**; \`Heap Fetches: N\` tells you how many rows still needed a heap visit because their page is not marked all-visible in the **visibility map**. Frequently updated tables have many heap fetches until VACUUM runs — autovacuum tuning matters for index-only scans.
- MySQL InnoDB: every secondary index implicitly contains the PK, so a query selecting only indexed columns + PK is covered ("Using index" in EXPLAIN).

**When to use:** hot, narrow read queries (list endpoints, counts, existence checks) where heap fetches dominate — e.g. a list API returning (id, created_at, total) for a customer's orders. Gains of 2–10× are common when rows are scattered across heap pages.

**When not to:** wide INCLUDE lists bloat the index, reduce fanout, and make every write heavier. Do not include large text/JSON columns.`,
      code: [
        {
          language: 'sql',
          title: 'Before/after a covering index (EXPLAIN ANALYZE, BUFFERS)',
          code: `-- Query behind GET /customers/:id/orders?limit=20
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at, total, status
  FROM orders
 WHERE customer_id = 4242
 ORDER BY created_at DESC LIMIT 20;

-- BEFORE: index (customer_id, created_at DESC) -> heap visit per row
-- Limit  (cost=0.57..81.33 rows=20 width=30) (actual time=0.041..3.912 rows=20 loops=1)
--   Buffers: shared hit=6 read=18
--   ->  Index Scan using idx_orders_cust_created on orders
--         (actual time=0.040..3.905 rows=20 loops=1)
--         Index Cond: (customer_id = 4242)
-- Execution Time: 3.951 ms          <- 18 random heap page reads from disk

CREATE INDEX CONCURRENTLY idx_orders_cust_created_cov
  ON orders (customer_id, created_at DESC) INCLUDE (total, status, id);

-- AFTER (table recently vacuumed):
-- Limit  (actual time=0.028..0.046 rows=20 loops=1)
--   Buffers: shared hit=4
--   ->  Index Only Scan using idx_orders_cust_created_cov on orders
--         Index Cond: (customer_id = 4242)
--         Heap Fetches: 0
-- Execution Time: 0.071 ms`,
        },
      ],
      keyPoints: [
        'INCLUDE adds payload columns to leaves without affecting ordering.',
        'Index Only Scan still visits the heap for pages not all-visible → Heap Fetches.',
        'Keep covering indexes narrow; they tax every write.',
      ],
    },
    {
      heading: 'Selectivity, cardinality, statistics, partial and expression indexes',
      body: `**Intuition:** an index helps when it lets you skip most of the table. If the query matches 40% of rows, reading the whole table sequentially is cheaper than millions of random jumps.

**Selectivity** = fraction of rows matching a predicate. The planner estimates it from **statistics** (\`ANALYZE\`: most-common values, histograms, n_distinct).
- Postgres typically switches from index scan → bitmap heap scan → sequential scan as selectivity grows. For random heap access the crossover is often around **5–15%** of rows (depends on correlation, \`random_page_cost\` — default 4.0; set ~1.1 on SSDs).
- **Cardinality** of a column (number of distinct values) bounds selectivity: \`is_deleted\` (2 values) is a poor index — unless you query the rare value.

**Partial indexes:** index only the rows you query.
- \`CREATE INDEX ON orders (created_at) WHERE status = 'pending'\` — if 0.5% of 200M rows are pending, the index is 200× smaller and always hot in cache.
- Great for queues, soft deletes (\`WHERE deleted_at IS NULL\`), and "unique among active rows": \`CREATE UNIQUE INDEX ON users (email) WHERE deleted_at IS NULL\`.
- The query predicate must imply the index predicate (literal match, not a parameter the planner cannot see at plan time for generic plans).

**Expression indexes:** \`CREATE INDEX ON users (lower(email))\` serves \`WHERE lower(email) = $1\`.

**When the planner guesses wrong**
- Stale stats after bulk loads → run \`ANALYZE\`.
- **Correlated columns** (city = 'Mumbai' AND state = 'MH'): planner multiplies selectivities and underestimates → \`CREATE STATISTICS (dependencies) ON city, state FROM address\`.
- Skewed values: raise per-column statistics target (\`ALTER TABLE ... ALTER COLUMN ... SET STATISTICS 1000\`).
- Parameterised generic plans chosen for skewed values (e.g. a giant tenant) → \`plan_cache_mode\`, or avoid prepared generic plans for that query.`,
      code: [
        {
          language: 'sql',
          title: 'Partial, expression and extended-statistics fixes',
          code: `-- Job queue: only ~0.3% of rows are runnable; partial index stays tiny and hot
CREATE INDEX CONCURRENTLY idx_jobs_runnable
  ON jobs (priority DESC, run_at)
  WHERE status = 'queued';

SELECT id FROM jobs
 WHERE status = 'queued' AND run_at <= now()
 ORDER BY priority DESC, run_at
 LIMIT 10 FOR UPDATE SKIP LOCKED;

-- Case-insensitive login lookup
CREATE UNIQUE INDEX CONCURRENTLY idx_users_email_lower
  ON users (lower(email)) WHERE deleted_at IS NULL;
SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL;

-- Correlated columns: planner estimated 12 rows, actual 48,000
CREATE STATISTICS st_address_city_state (dependencies, ndistinct)
  ON city, state FROM address;
ANALYZE address;

-- Check how selective a value is before indexing it
SELECT most_common_vals, most_common_freqs
  FROM pg_stats WHERE tablename = 'orders' AND attname = 'status';`,
        },
      ],
      keyPoints: [
        'Index helps when it skips most of the table; above ~5–15% match, seq scans often win.',
        'Partial indexes: tiny, hot, perfect for queues/soft deletes/active-unique.',
        'Estimate vs actual row mismatch → ANALYZE, extended statistics, statistics target.',
      ],
    },
    {
      heading: 'Reading EXPLAIN ANALYZE like a senior engineer',
      body: `**Intuition:** a query plan is a tree of operators; data flows from leaves to the root. Find the node where the time goes and ask "why did the planner think this was cheap?"

**Checklist**
1. Always use \`EXPLAIN (ANALYZE, BUFFERS)\` (ANALYZE executes the query — wrap writes in BEGIN/ROLLBACK).
2. **Actual time** is \`start..end\` in ms *per loop*; multiply by \`loops\`. A 0.05 ms inner Index Scan with loops=200,000 is 10 s.
3. **Estimated vs actual rows:** \`rows=12\` vs \`actual rows=48000\` → bad statistics → wrong join strategy (nested loop chosen where hash join was needed).
4. **Rows Removed by Filter:** large numbers mean the index narrowed poorly or was not used.
5. **Buffers:** \`shared hit\` = cache, \`read\` = from OS/disk, \`temp read/written\` = spilled to disk.
6. **Sort Method: external merge Disk: 512MB** → \`work_mem\` too small or a missing index to provide order.
7. **Join types:** Nested Loop (great for small outer + indexed inner), Hash Join (large unsorted inputs, needs memory), Merge Join (both sides sorted).
8. **Seq Scan** on a large table in an OLTP query is usually the smoking gun — but on small tables it is correct.

**Common root causes → fixes**
| Symptom | Likely cause | Fix |
|---|---|---|
| Seq Scan + Filter on big table | Missing/unusable index (function, type cast, leading column missing) | Add/rewrite index or predicate |
| Nested Loop with huge loops | Underestimated outer rows | ANALYZE, extended stats, rewrite |
| Sort spilling to disk | ORDER BY not served by index; low work_mem | Index matching sort order; raise work_mem per session |
| Index Scan but slow, many heap reads | Poor correlation, wide rows | Covering index, CLUSTER/pg_repack by key |
| Bitmap Heap Scan with lossy blocks | work_mem too small for bitmap | Raise work_mem, more selective index |`,
      code: [
        {
          language: 'sql',
          title: 'A bad plan, diagnosed and fixed',
          code: `EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, o.total, c.email
  FROM orders o JOIN customer c ON c.id = o.customer_id
 WHERE o.created_at >= now() - interval '1 day' AND o.status = 'paid';

-- Hash Join  (cost=48211.00..512877.12 rows=1200 width=40)
--            (actual time=412.3..6120.9 rows=183422 loops=1)
--   Hash Cond: (o.customer_id = c.id)
--   Buffers: shared hit=2311 read=402118, temp read=10240 written=10240
--   ->  Seq Scan on orders o  (cost=0.00..455120.00 rows=1200 width=24)
--                             (actual time=0.03..5210.4 rows=183422 loops=1)
--         Filter: ((status = 'paid') AND (created_at >= (now() - '1 day'::interval)))
--         Rows Removed by Filter: 39816578          <- read 40M rows to keep 183K
--   ->  Hash  (actual time=410.1..410.1 rows=2000000 loops=1)
--         ->  Seq Scan on customer c ...
-- Execution Time: 6154.2 ms

-- Diagnosis: no index on created_at; estimate 1,200 vs actual 183K (stale stats)
ANALYZE orders;
CREATE INDEX CONCURRENTLY idx_orders_paid_created ON orders (created_at) WHERE status = 'paid';

-- After: Nested Loop -> Index Scan on idx_orders_paid_created (rows=183422)
--        -> Index Scan using customer_pkey (loops=183422, 0.004 ms each)
-- Execution Time: 740 ms   (and a Hash Join may be chosen again if it is cheaper)`,
        },
      ],
      keyPoints: [
        'Time per node × loops; find the dominant node.',
        'Estimate vs actual mismatch is the #1 cause of bad join choices.',
        'BUFFERS read vs hit tells you whether it is I/O or CPU.',
      ],
      source: 'PostgreSQL 16 docs — Ch 14.1 Using EXPLAIN',
    },
    {
      heading: 'Finding the queries worth fixing: pg_stat_statements, slow logs, auto_explain',
      body: `**Intuition:** the query that hurts most is rarely the slowest one — it is the one with the largest **total** time (calls × mean). A 2 ms query called 50K times/s costs more than a 30 s report run hourly.

**Tools**
- **pg_stat_statements:** normalised query fingerprints with calls, total/mean/stddev exec time, rows, shared blocks hit/read, temp blocks. Order by \`total_exec_time\` for load, by \`mean_exec_time\` for latency, by \`shared_blks_read\` for I/O.
- **log_min_duration_statement = 250ms** (Postgres) or MySQL **slow_query_log** with \`long_query_time\`; MySQL \`performance_schema.events_statements_summary_by_digest\` is the pg_stat_statements equivalent.
- **auto_explain** logs plans of slow queries automatically (\`auto_explain.log_min_duration\`, \`log_analyze\` — the latter has overhead; sample it).
- APM/tracing (OpenTelemetry DB spans) ties SQL to endpoints — essential for spotting N+1 (hundreds of identical spans per request).
- Managed: AWS RDS Performance Insights, Cloud SQL Query Insights.

**Workflow**
1. Top 10 by total time → pick the biggest.
2. Get a representative parameter set (pg_stat_statements hides parameters; use logs/auto_explain).
3. EXPLAIN (ANALYZE, BUFFERS) on a production-like replica.
4. Fix (index, rewrite, caching, batching) → verify in pg_stat_statements after reset (\`pg_stat_statements_reset()\`).
5. Guard with a regression check (plan tests, query count assertions in integration tests).`,
      code: [
        {
          language: 'sql',
          title: 'Top offenders by total time, with cache-hit ratio',
          code: `-- postgresql.conf: shared_preload_libraries = 'pg_stat_statements'
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT left(query, 90)                                 AS query,
       calls,
       round(total_exec_time::numeric / 1000, 1)       AS total_s,
       round(mean_exec_time::numeric, 2)               AS mean_ms,
       round((100 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 1) AS pct_load,
       rows / greatest(calls, 1)                       AS rows_per_call,
       round(100.0 * shared_blks_hit
             / greatest(shared_blks_hit + shared_blks_read, 1), 1) AS cache_hit_pct
  FROM pg_stat_statements
 ORDER BY total_exec_time DESC
 LIMIT 10;

-- Typical finding:
-- SELECT * FROM order_item WHERE order_id = $1 | calls 91,204,331 | mean 0.41 ms | pct_load 38.2
--   -> not slow, but called ~50x per GraphQL request: an N+1, fix in the app layer

-- Log plans for slow statements (sampled)
-- auto_explain.log_min_duration = '500ms'
-- auto_explain.sample_rate = 0.05`,
        },
      ],
      keyPoints: [
        'Prioritise by total time (calls × mean), not max latency.',
        'pg_stat_statements for fingerprints; auto_explain/logs for plans with real parameters.',
        'Traces reveal N+1 as repeated identical spans per request.',
      ],
    },
    {
      heading: 'N+1 queries in ORMs and GraphQL, and the DataLoader fix',
      body: `**Intuition:** asking the database "give me order 1's items", "order 2's items", ... 50 times instead of "give me items for these 50 orders" turns one round trip into 51. Each round trip is ~0.3–1 ms in the same AZ, so N+1 turns 5 ms into 50–100 ms and multiplies DB load.

**Where it comes from**
- ORM lazy relations accessed in a loop (TypeORM lazy relations, Prisma nested calls per row, Sequelize getters).
- **GraphQL resolvers:** each field resolver runs per parent object. \`orders { customer { name } }\` with 50 orders → 50 customer lookups.

**Fixes**
1. **Eager loading / joins** in REST or known-shape queries (\`relations\`, \`include\`, \`leftJoinAndSelect\`) — careful with row explosion when joining multiple one-to-many relations (cartesian product).
2. **Batch loading:** \`WHERE id = ANY($1)\` / \`IN (...)\` — Prisma does this for \`include\` (separate queries per relation).
3. **DataLoader** for GraphQL: collects all \`.load(id)\` calls in one tick of the event loop, issues one batched query, returns results **in the same order as keys** (missing keys → null/Error), and caches per request.
   - Create loaders **per request** (in GraphQL context) — a global DataLoader leaks data across users and never invalidates.
   - Cap batch size (\`maxBatchSize\`) for huge lists.
4. **Detect in CI:** assert query count per request in integration tests; APM alerts on span count per trace.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS GraphQL: N+1 resolver vs per-request DataLoader',
          code: `import DataLoader from 'dataloader';
import { Resolver, ResolveField, Parent, Context } from '@nestjs/graphql';
import { In, type Repository } from 'typeorm';

// BEFORE: one SELECT per order -> 1 + N queries
// @ResolveField() customer(@Parent() o: Order) {
//   return this.customers.findOneBy({ id: o.customerId });
// }

export function createLoaders(customers: Repository<Customer>) {
  return {
    customerById: new DataLoader<string, Customer | null>(
      async (ids) => {
        // ONE query for the whole batch: SELECT ... WHERE id IN (...)
        const rows = await customers.findBy({ id: In([...ids]) });
        const byId = new Map(rows.map((c) => [c.id, c]));
        return ids.map((id) => byId.get(id) ?? null); // same order & length as keys
      },
      { maxBatchSize: 500 },
    ),
  };
}

// GraphQLModule.forRoot({ context: ({ req }) => ({ req, loaders: createLoaders(repo) }) })
// -> new loaders per request: cache never leaks between users

@Resolver(() => Order)
export class OrderResolver {
  @ResolveField(() => Customer, { nullable: true })
  customer(@Parent() o: Order, @Context() ctx: { loaders: ReturnType<typeof createLoaders> }) {
    return ctx.loaders.customerById.load(o.customerId); // batched + de-duplicated
  }
}

interface Order { id: string; customerId: string }
interface Customer { id: string; name: string }`,
        },
      ],
      keyPoints: [
        'N+1 multiplies round trips; each costs ~0.3–1 ms plus DB CPU.',
        'DataLoader: batch per tick, preserve key order, per-request cache.',
        'Joins for known shapes; batch IN/ANY queries for graphs of resolvers.',
      ],
    },
    {
      heading: 'Pagination: OFFSET vs keyset (seek) pagination',
      body: `**Intuition:** OFFSET 100000 tells the database "walk past 100,000 rows, then give me 20". Keyset says "give me 20 rows after this bookmark" — the index jumps straight to the bookmark.

| Aspect | OFFSET/LIMIT | Keyset (cursor) |
|---|---|---|
| Cost of page N | O(offset + limit) — rows are read and discarded | O(limit) via index seek |
| Page 5,000 of 20 | reads 100,020 rows | reads 20 rows |
| Stability under inserts | Rows shift → duplicates/skips | Stable: bookmark is a value |
| Jump to arbitrary page | Yes | No (only next/prev) — fine for feeds and APIs |
| Requirements | Any ORDER BY | Unique, indexed sort key (add id as tiebreaker) |

**Keyset details**
- Sort by \`(created_at DESC, id DESC)\` and use a row-value comparison: \`WHERE (created_at, id) < ($1, $2)\` — Postgres can use a composite index \`(created_at DESC, id DESC)\` for it (in MySQL row-value comparisons historically optimised poorly; expand to \`created_at < $1 OR (created_at = $1 AND id < $2)\`).
- Encode the cursor opaquely (base64 of the last row's sort values) — matches GraphQL Relay connection spec (\`after\`, \`first\`, \`pageInfo.endCursor\`).
- Total counts: \`COUNT(*)\` over millions of rows is expensive; show "10,000+" or use estimates (\`pg_class.reltuples\`) unless exact counts are required.`,
      code: [
        {
          language: 'typescript',
          title: 'Keyset pagination with an opaque cursor (pg)',
          code: `import { Pool } from 'pg';
const pool = new Pool();

interface Cursor { createdAt: string; id: string }
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
const decode = (s: string): Cursor => JSON.parse(Buffer.from(s, 'base64url').toString());

// Requires: CREATE INDEX ON orders (customer_id, created_at DESC, id DESC);
export async function listOrders(customerId: string, first = 20, after?: string) {
  const limit = Math.min(first, 100);                 // cap page size
  const params: unknown[] = [customerId, limit + 1];  // fetch one extra to know hasNextPage
  let seek = '';
  if (after) {
    const c = decode(after);
    params.push(c.createdAt, c.id);
    seek = 'AND (created_at, id) < ($3::timestamptz, $4::uuid)';
  }
  const { rows } = await pool.query(
    'SELECT id, created_at, total FROM orders WHERE customer_id = $1 ' + seek +
      ' ORDER BY created_at DESC, id DESC LIMIT $2',
    params,
  );
  const hasNextPage = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    edges: page,
    pageInfo: {
      hasNextPage,
      endCursor: last ? encode({ createdAt: last.created_at.toISOString(), id: last.id }) : null,
    },
  };
}`,
        },
      ],
      keyPoints: [
        'OFFSET cost grows linearly with page depth; keyset is constant.',
        'Keyset needs a unique, indexed ordering — add id as a tiebreaker.',
        'Fetch limit + 1 to compute hasNextPage without COUNT(*).',
      ],
      source: 'Mastering API Architecture — Ch 2 (API design: pagination)',
    },
    {
      heading: 'Write amplification, index hygiene and query timeouts',
      body: `**Intuition:** every index is a promise to update a second (third, tenth) data structure on every write. Ten indexes on a hot table can make each INSERT ~10 random page writes plus WAL.

**Write-side costs**
- INSERT: one entry per index. UPDATE: Postgres writes a new heap tuple; if **no indexed column changed** and the page has space, it is a **HOT update** (no index writes). Changing any indexed column → new entries in *every* index. Adding an index on a frequently updated column (\`last_seen_at\`) can silently kill HOT updates for the whole table.
- WAL volume grows with index writes → replication lag and backup size.
- LSM engines: compaction rewrites data 10–30× (leveled) — the analogous write amplification.

**Hygiene**
- Find unused indexes: \`pg_stat_user_indexes\` where \`idx_scan = 0\` (check on all replicas — reads may use them there — and since the stats reset).
- Find duplicates: \`(a)\` is redundant if \`(a, b)\` exists (unless uniqueness or size matters).
- Bloated indexes: \`REINDEX INDEX CONCURRENTLY\`.
- Foreign keys: index the referencing column, or \`DELETE\` on the parent triggers a seq scan of the child per row.
- Migrations: \`CREATE INDEX CONCURRENTLY\` (cannot run in a transaction; check for INVALID indexes after failure); in MySQL use online DDL (\`ALGORITHM=INPLACE, LOCK=NONE\`) or gh-ost/pt-online-schema-change.

**Timeouts — the safety net**
- \`statement_timeout\` per role/service (e.g. 2–5 s for OLTP APIs, longer for batch roles). A runaway query otherwise holds a connection, CPU and snapshot indefinitely.
- \`lock_timeout\` (e.g. 2 s) for migrations so DDL waiting on a lock does not block all traffic behind it.
- App-side: client query timeout slightly above statement_timeout, and **cancel** on client disconnect.
- MySQL: \`max_execution_time\` (SELECT only) / optimizer hint \`MAX_EXECUTION_TIME(2000)\`.`,
      code: [
        {
          language: 'sql',
          title: 'Index audit and timeout guardrails',
          code: `-- Unused, non-unique indexes with their size (run on primary AND replicas)
SELECT s.relname AS table_name, s.indexrelname AS index_name,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size, s.idx_scan
  FROM pg_stat_user_indexes s
  JOIN pg_index i ON i.indexrelid = s.indexrelid
 WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
 ORDER BY pg_relation_size(s.indexrelid) DESC;

-- HOT update ratio: low ratio on an update-heavy table = indexed column churn
SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / greatest(n_tup_upd, 1), 1) AS hot_pct
  FROM pg_stat_user_tables ORDER BY n_tup_upd DESC LIMIT 10;

-- Leftover INVALID indexes from failed CONCURRENTLY builds
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;

-- Guardrails per role
ALTER ROLE api_service SET statement_timeout = '3s';
ALTER ROLE api_service SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE migrator    SET lock_timeout = '2s';`,
        },
      ],
      keyPoints: [
        'Indexed-column updates defeat HOT and write to every index.',
        'Audit unused/duplicate indexes on all nodes; index FK columns.',
        'statement_timeout and lock_timeout are non-negotiable guardrails.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'db-indexing-cc-1',
      title: 'Rescue the orders list endpoint that melts the database',
      context:
        'GET /admin/orders powers an internal dashboard and a partner export. The orders table has 180M rows. Page 1 takes 900 ms; partners paging deep into results trigger 40 s queries that pile up and exhaust the connection pool. The only index is the primary key and one on customer_id.',
      task: 'Make every page constant-cost, make the day filter and status filter index-friendly, stop the expensive count on every request, and make sure a pathological request cannot run forever.',
      starter: {
        language: 'typescript',
        code: `import { Controller, Get, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly ds: DataSource) {}

  @Get()
  async list(@Query('page') page = '1', @Query('size') size = '50',
             @Query('day') day?: string, @Query('status') status?: string) {
    const offset = (Number(page) - 1) * Number(size);
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (day) { params.push(day); where.push('DATE(created_at) = $' + params.length); }
    if (status) { params.push(status); where.push('LOWER(status) = LOWER($' + params.length + ')'); }

    const [{ count }] = await this.ds.query(
      'SELECT COUNT(*) FROM orders WHERE ' + where.join(' AND '), params);
    const rows = await this.ds.query(
      'SELECT * FROM orders WHERE ' + where.join(' AND ') +
      ' ORDER BY created_at DESC LIMIT ' + size + ' OFFSET ' + offset, params);
    return { total: Number(count), page: Number(page), rows };
  }
}`,
      },
      hints: [
        'What does the database physically do for OFFSET 5,000,000? And what happens to a B-tree on created_at when the predicate is DATE(created_at)?',
        'Think about the column order of an index that serves "status = ? ... ORDER BY created_at DESC, id DESC".',
        'Is an exact COUNT(*) over millions of rows needed on every page? Also look at how size is put into the SQL string.',
      ],
      solution: {
        language: 'typescript',
        code: `import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Migrations (run CONCURRENTLY):
//   CREATE INDEX idx_orders_created_id    ON orders (created_at DESC, id DESC);
//   CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC, id DESC);
//   (status values normalised to lowercase at write time + CHECK constraint)

const COLUMNS = 'id, customer_id, status, total, created_at'; // no SELECT *

@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly ds: DataSource) {}

  @Get()
  async list(@Query('size') sizeQ = '50', @Query('after') after?: string,
             @Query('day') day?: string, @Query('status') status?: string) {
    const size = Math.min(Math.max(Number(sizeQ) || 50, 1), 200); // validated, bounded
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', '$' + params.length)); };

    if (day) {
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) throw new BadRequestException('day');
      add('created_at >= ?::date', day);                       // sargable range
      add('created_at < (?::date + 1)', day);
    }
    if (status) add('status = ?', status.toLowerCase());       // no function on column
    if (after) {
      const [ts, id] = JSON.parse(Buffer.from(after, 'base64url').toString());
      params.push(ts, id);
      where.push('(created_at, id) < ($' + (params.length - 1) + '::timestamptz, $' + params.length + '::bigint)');
    }
    params.push(size + 1);
    const sql = 'SELECT ' + COLUMNS + ' FROM orders' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY created_at DESC, id DESC LIMIT $' + params.length;

    const rows = await this.ds.transaction(async (m) => {
      await m.query("SET LOCAL statement_timeout = '2s'");      // hard ceiling per request
      return m.query(sql, params);
    });
    const hasNext = rows.length > size;
    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor: hasNext && last
        ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString('base64url') : null,
      // exact totals moved to an async export job; UI shows "more results" instead
    };
  }
}`,
      },
      explanation: `**Fixes**
- **OFFSET → keyset:** deep pages no longer read and discard millions of rows; each page is an index seek on \`(created_at, id)\` returning \`size + 1\` rows. \`id\` breaks ties so no row is skipped or duplicated.
- **Sargable predicates:** \`DATE(created_at) = $1\` and \`LOWER(status)\` wrapped columns in functions, so no B-tree could be used. Now a half-open range on \`created_at\` and a normalised lowercase status (enforced at write time).
- **Right indexes:** \`(status, created_at DESC, id DESC)\` serves the filtered view with equality first then the sort; \`(created_at DESC, id DESC)\` serves the unfiltered and day views.
- **No COUNT(*) per page:** counting 180M rows per request was a full scan by itself. Totals come from an async export or \`pg_class.reltuples\` estimates.
- **Bounded & safe inputs:** \`size\` was interpolated into SQL (injection + unbounded pages); it is now validated and parameterised.
- **Timeout:** \`SET LOCAL statement_timeout\` caps any single request at 2 s, protecting the pool.
- **Narrow projection:** explicit columns instead of \`SELECT *\` (less I/O, enables covering indexes later).`,
      followUps: [
        {
          "q": "Admins still insist on seeing \"Showing 1–50 of 12,345,678\". How do you provide a total without the per-request COUNT(*)?",
          "a": "Use estimates where exactness doesn't matter: for the unfiltered view, `pg_class.reltuples`; for filtered views, run `EXPLAIN (FORMAT JSON)` and read the planner's row estimate, displayed as \"about 12.3M\". For exact filtered counts, maintain a counter table `orders_count(status, day, n)` updated by triggers or a CDC consumer, so a total is a single-row read. Or compute counts asynchronously and cache for a minute in Redis. Exact COUNT(*) over 180M rows takes seconds even with an index-only scan, so it must never be on the hot path."
        },
        {
          "q": "How would you test that the new endpoint never skips or duplicates rows while orders are being inserted concurrently?",
          "a": "Write a property-style integration test against a real Postgres (Testcontainers): seed ~10K orders with many duplicate created_at values, then crawl page by page while a background task inserts new orders with current timestamps. Assert that the set of ids returned contains every seeded id exactly once and that ordering is strictly decreasing on `(created_at, id)`. Also test page boundaries landing in the middle of a tie group, size bounds (0, 201, NaN), a tampered cursor (expect 400), and an `EXPLAIN` assertion that the plan uses `idx_orders_status_created` with no Sort node."
        }
      ],
    },
    {
      id: 'db-indexing-cc-2',
      title: 'Fix the DataLoader that leaks data and returns the wrong customers',
      context:
        'A NestJS GraphQL API added DataLoader to fix an N+1 on Order.customer. Latency improved, but support tickets report users occasionally seeing another tenant\'s customer names, some orders show the wrong customer, and a 5,000-order admin query timed out.',
      task: 'Find and fix every bug in this DataLoader setup and make the batched query index-friendly.',
      starter: {
        language: 'typescript',
        code: `import DataLoader from 'dataloader';
import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class CustomerLoader {
  constructor(private readonly pool: Pool) {}

  // one loader for the whole app, created at startup
  readonly byId = new DataLoader<string, Customer>(async (ids) => {
    const { rows } = await this.pool.query(
      'SELECT * FROM customer WHERE id::text IN (' +
        ids.map((id) => "'" + id + "'").join(',') + ')',
    );
    return rows; // DB returns them in whatever order it likes
  });
}

// resolver
// @ResolveField() customer(@Parent() o: Order) { return this.loader.byId.load(o.customerId); }

interface Customer { id: string; tenant_id: string; name: string }
interface Order { id: string; customerId: string }`,
      },
      hints: [
        'DataLoader requires the batch function to return an array with a specific length and order. What does the DB return when an id does not exist?',
        'Where does a DataLoader cache live, and who shares it if the loader is a singleton provider?',
        'Look at id::text and the way ids reach SQL. What does a cast on the indexed column do, and what happens with 5,000 ids?',
      ],
      solution: {
        language: 'typescript',
        code: `import DataLoader from 'dataloader';
import { Injectable, Scope, Inject } from '@nestjs/common';
import { CONTEXT } from '@nestjs/graphql';
import { Pool } from 'pg';

// REQUEST-scoped: a fresh loader (and cache) per GraphQL request
@Injectable({ scope: Scope.REQUEST })
export class CustomerLoader {
  constructor(
    private readonly pool: Pool,
    @Inject(CONTEXT) private readonly ctx: { tenantId: string },
  ) {}

  readonly byId = new DataLoader<string, Customer | null>(
    async (ids) => {
      const { rows } = await this.pool.query<Customer>(
        // parameterised array, no cast on the indexed column, tenant-scoped
        'SELECT id, tenant_id, name FROM customer WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [this.ctx.tenantId, ids],
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id) ?? null); // same length and order as keys
    },
    { maxBatchSize: 1000 }, // 5,000 ids -> 5 queries, each a fast index lookup
  );
}

// Index: PRIMARY KEY (id) already serves id = ANY(...);
// for tenant-first access patterns: CREATE INDEX ON customer (tenant_id, id);

interface Customer { id: string; tenant_id: string; name: string }`,
      },
      explanation: `**Bugs fixed**
- **Wrong customers:** DataLoader maps results to keys **by position**. The DB returned rows in arbitrary order and omitted missing ids, so results shifted onto the wrong orders. Now results are re-ordered by key, with \`null\` for missing ids.
- **Cross-tenant leak:** a singleton loader has an app-wide cache that never expires: customer data loaded for tenant A is served to tenant B's request, and updates are never seen. Loaders must be per request (\`Scope.REQUEST\` or created in the GraphQL context), and the query is tenant-scoped as defence in depth.
- **SQL injection:** ids were concatenated into SQL. Now passed as a parameterised \`uuid[]\` with \`= ANY($2)\`.
- **Index defeated:** \`id::text IN (...)\` casts the indexed column, forcing a sequential scan; comparing \`id\` to a typed array uses the primary key index.
- **Huge batches:** 5,000 ids produced a giant statement; \`maxBatchSize\` splits it into bounded, fast queries.
- **SELECT \\*:** narrowed to needed columns.`,
      followUps: [
        {
          "q": "Scope.REQUEST makes every provider depending on CustomerLoader request-scoped too, and latency goes up. How else can you get per-request loaders in NestJS?",
          "a": "Request scope bubbles up the injection chain, so Nest instantiates resolvers and services per request, which costs CPU and GC at high RPS. The common alternative: keep services singleton and build loaders in the GraphQL context factory — `context: ({ req }) => ({ loaders: createLoaders(pool, req.tenantId) })` — then resolvers read `ctx.loaders.customerById`. A singleton `LoaderFactory` service can create them so dependencies stay injectable. The loader lives exactly as long as the request, tenant id comes from the authenticated request, and nothing else becomes request-scoped."
        },
        {
          "q": "A customer's name is updated by a mutation, then the same request's response resolves that customer. Which value is returned, and how do you fix it?",
          "a": "If the customer was loaded earlier in the request, DataLoader's per-request cache returns the stale pre-update object, so the mutation response shows the old name. Fix: after the write, call `loader.clear(id)` (or `loader.prime(id, updatedRow)` with the RETURNING row) so subsequent loads see fresh data. GraphQL executes mutation root fields serially but nested resolvers can still hit the cached value. Add a test: load customer, mutate name, resolve customer in the same operation, and assert the new name."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'db-indexing-iq-01',
      difficulty: 'hard',
      question:
        'An endpoint\'s p99 went from 80 ms to 2.5 s after a deploy that did not change any SQL. How do you find out what happened in the database?',
      whatInterviewerLooksFor: [
        'Systematic approach: correlate with deploy, then pg_stat_statements / traces',
        'Considers plan changes (stats, parameter sniffing/generic plans), not just missing indexes',
        'Considers query-count changes (N+1 introduced by an ORM change) even when SQL text is unchanged',
        'Knows how to compare plans and pin the fix',
      ],
      modelAnswer: `### 1. Confirm where the time goes
Distributed trace for slow requests: is it one slow DB span or 200 fast ones? A "no SQL changed" deploy frequently changes **how many times** SQL runs — an ORM relation switched to lazy, a new GraphQL field resolved per item → N+1.

### 2. Compare pg_stat_statements before/after
Snapshot (or use Performance Insights) and diff by query id: calls/request, mean time, rows, shared_blks_read.
- **Calls exploded** → N+1 or retry loop in the app.
- **Mean time exploded for the same query** → plan change or data change.

### 3. If a single query got slower
- Get the plan with realistic parameters (auto_explain log or reproduce) using \`EXPLAIN (ANALYZE, BUFFERS)\`.
- Common causes with unchanged SQL:
  - **Statistics drift / autoanalyze** ran and flipped the plan (estimate vs actual rows off by 100×).
  - **Generic plan for prepared statements:** after 5 executions Postgres may switch to a generic plan that is terrible for a skewed parameter (a huge tenant). The deploy may have changed driver settings (e.g. enabling prepared statements).
  - A new migration **added an index** the planner now prefers wrongly, or dropped/invalidated one (failed CONCURRENTLY build leaves INVALID).
  - Different parameter types from the new code (text vs uuid causing a cast on the column).
  - Data growth crossing a threshold (a table now exceeds cache → reads from disk).

### 4. Fix and guard
- Stats: ANALYZE, extended statistics, higher statistics target.
- Generic-plan issue: \`plan_cache_mode = force_custom_plan\` for that role/query.
- Index/rewrite as appropriate; verify with EXPLAIN and pg_stat_statements.
- Add a query-count assertion test and alert on plan regressions (mean_exec_time per query id).`,
      followUps: [
        {
          q: 'How would you roll back quickly while investigating?',
          a: 'Roll back the deploy if the change was app-side (N+1, driver settings). If it is a plan flip, ANALYZE or a targeted index/plan setting is usually faster than a rollback; as a stopgap, raise capacity or cache the endpoint.',
        },
        {
          q: 'Why can a newly added index make things slower?',
          a: 'The planner may choose it based on misestimated selectivity (e.g. choosing an index on created_at for ORDER BY ... LIMIT while the filter is highly selective on another column), leading to scanning many index entries and heap rows before finding matches.',
        },
      ],
      pitfalls: [
        'Immediately adding indexes without looking at the plan or query counts',
        'Ignoring app-side query multiplication',
        'Not knowing prepared statement generic plans can differ from ad-hoc plans',
      ],
    },
    {
      id: 'db-indexing-iq-02',
      difficulty: 'expert',
      question:
        'Design indexes for a multi-tenant ticketing system. Hot queries: (1) open tickets for a tenant sorted by priority then age, (2) a tenant\'s tickets assigned to an agent, newest first, (3) search tickets by subject substring, (4) count open tickets per tenant for a dashboard. 500M tickets, 20K tenants, one huge tenant with 30% of rows.',
      whatInterviewerLooksFor: [
        'Designs composite indexes with equality-first, sort-last ordering per query',
        'Uses partial indexes for "open" if open is a small fraction',
        'Picks trigram GIN or a search engine for substring search',
        'Addresses the skewed tenant (plan stability, possibly separate partition)',
        'Considers write amplification and total index count',
      ],
      modelAnswer: `### Q1: open tickets by priority, then age
\`CREATE INDEX ON ticket (tenant_id, priority DESC, created_at) WHERE status = 'open';\`
- Equality on tenant, then the exact sort order → index scan with LIMIT, no sort.
- Partial: if ~5% of tickets are open, the index is ~20× smaller and stays in RAM.

### Q2: agent's tickets newest first
\`CREATE INDEX ON ticket (tenant_id, assignee_id, created_at DESC, id DESC);\`
- Keyset pagination on (created_at, id). Include small display columns (subject, status) with INCLUDE if the list endpoint is hot and heap fetches dominate.

### Q3: substring search on subject
- B-tree cannot do \`ILIKE '%refund%'\`. Options: \`pg_trgm\` GIN index on subject (fine up to tens of millions of rows per tenant, handles typos with similarity), or a search engine (OpenSearch) fed by CDC for relevance, stemming and facets. At 500M rows I would put search in OpenSearch, routed by tenant_id.

### Q4: open counts per tenant
- \`COUNT(*)\` on the partial index is an index-only scan — fine for small tenants, but 30% of 5% of 500M = 7.5M entries for the huge tenant each dashboard load. Maintain a **counter table** (tenant_id, status, count) updated transactionally or via CDC; accept eventual consistency for dashboards.

### The skewed tenant
- Plans that work for small tenants (nested loops) fail for the giant one. Watch for generic prepared plans; consider \`plan_cache_mode = force_custom_plan\`.
- Consider **list partitioning** by tenant: the giant tenant gets its own partition (its own statistics and indexes), everyone else shares hash partitions.

### Write budget
Total: PK + 3 B-trees (one partial) + maybe trigram — each ticket update touching status/assignee rewrites entries in several indexes. Keep \`updated_at\` out of indexes so frequent touches stay HOT.`,
      followUps: [
        {
          q: 'Why not a single index (tenant_id, status, assignee_id, priority, created_at) for everything?',
          a: 'Leftmost prefix: Q2 would skip status (not in its predicate) and Q1 would skip assignee_id, so neither gets the sort order from the index. Wide multi-purpose indexes serve none of the queries well and are bigger.',
        },
        {
          q: 'How do you add these indexes on a 500M-row live table?',
          a: 'CREATE INDEX CONCURRENTLY one at a time off-peak, monitoring I/O and replication lag; check for INVALID indexes on failure; with partitioning, build per partition and attach.',
        },
      ],
      pitfalls: [
        'Putting the range/sort column before equality columns',
        'Proposing a B-tree for substring search',
        'Ignoring skew and write amplification',
      ],
    },
    {
      id: 'db-indexing-iq-03',
      difficulty: 'hard',
      question:
        'A GraphQL query for a feed of 50 posts with author, comments and likes issues 350 SQL queries. Walk me through fixing it in a NestJS stack, and how you would stop it from coming back.',
      whatInterviewerLooksFor: [
        'Recognises N+1 per resolver field and nested N+1',
        'Uses per-request DataLoaders, preserving key order and handling missing keys',
        'Considers batch queries for one-to-many (comments per post with limit)',
        'Adds guardrails: query complexity limits, query-count tests, tracing',
      ],
      modelAnswer: `### Why 350
1 (posts) + 50 (author per post) + 50 (comments per post) + ~200 (comment authors) + 50 (like counts) ≈ 350 round trips. At ~0.5 ms each plus DB CPU that is 150–300 ms and heavy pool usage.

### Fix
1. **Per-request DataLoaders** created in the GraphQL context:
   - \`userById\`: \`WHERE id = ANY($1)\` → authors of posts and comments in 1–2 queries, de-duplicated (the same author appearing 20 times is fetched once).
   - \`commentsByPostId\`: one-to-many; batch as \`WHERE post_id = ANY($1)\` then group in memory. If only the latest 3 comments per post are needed, use a lateral join: \`SELECT ... FROM unnest($1::bigint[]) p(id) CROSS JOIN LATERAL (SELECT ... FROM comment WHERE post_id = p.id ORDER BY created_at DESC LIMIT 3) c\` — one query, uses index \`(post_id, created_at DESC)\`.
   - \`likeCountByPostId\`: \`SELECT post_id, count(*) ... GROUP BY post_id\` or, better, a denormalised \`like_count\` column maintained atomically.
2. Result: ~4–5 queries per request, independent of page size.

### DataLoader correctness
- Return values in **key order**, same length, \`null\`/Error for missing.
- Per-request scope → no cross-user cache leaks.
- \`maxBatchSize\` for giant lists.

### Keep it from coming back
- Integration tests asserting query count per operation (a Postgres query counter in the test harness).
- OpenTelemetry DB spans; alert when spans per request exceed a threshold.
- **Query complexity / depth limits** on the GraphQL server to stop clients requesting deeply nested lists.
- Persisted queries for public clients.`,
      followUps: [
        {
          q: 'Why not just use JOINs in the root resolver?',
          a: 'GraphQL clients choose fields dynamically; joining everything up front over-fetches for queries that do not ask for comments, and multiple one-to-many joins create cartesian row explosions. DataLoader lets each field batch only what was requested. Look-ahead (parsing the selection set) can add targeted joins for hot shapes.',
        },
        {
          q: 'DataLoader caches per request — is it a replacement for Redis caching?',
          a: 'No. Its cache is request-scoped de-duplication. Cross-request caching needs Redis or an HTTP/CDN cache with invalidation; DataLoader can sit in front of it (loadMany from Redis first, DB for misses).',
        },
      ],
      pitfalls: [
        'A global DataLoader singleton',
        'Returning rows in DB order from the batch function',
        'Fixing only the first level and ignoring nested N+1',
      ],
    },
    {
      id: 'db-indexing-iq-04',
      difficulty: 'medium',
      question:
        'Our public API uses ?page=N&limit=50. Partners crawling all 40M products report timeouts after page ~10,000 and missing/duplicated items. What is happening and what would you change?',
      whatInterviewerLooksFor: [
        'Explains OFFSET cost is linear in depth',
        'Explains instability of offset under concurrent inserts/deletes',
        'Proposes keyset/cursor pagination with a unique tiebreaker',
        'Handles API evolution: keep old param with limits, add cursor, bulk export alternative',
      ],
      modelAnswer: `### What is happening
- \`OFFSET 500000 LIMIT 50\` makes the database produce 500,050 rows in sort order and discard 500,000. Even with an index on the sort key, that is ~500K index entries plus heap visits per page → seconds per request, growing linearly. Crawling 40M items = 800K pages → O(n²) total work.
- While crawling, products are inserted/deleted: every insert before the current offset shifts rows down → the partner sees duplicates; deletes shift rows up → items are skipped.

### Change
1. **Cursor (keyset) pagination:** \`ORDER BY updated_at, id\` (or just id for a full crawl); \`WHERE (updated_at, id) > ($cursor_ts, $cursor_id) LIMIT 50\`. Each page is an index seek, ~1 ms regardless of depth, and stable under concurrent writes.
2. **Opaque cursor** (base64 of sort values) so we can change internals; return \`next_cursor\`.
3. **Incremental sync:** partners pass \`updated_since\` with a cursor on \`(updated_at, id)\` so they fetch only changes instead of recrawling 40M items. Deletions need tombstones (a \`deleted_at\` or change feed).
4. **Bulk export** for full dumps: nightly snapshot to S3 (Parquet/NDJSON) — far cheaper than 800K API calls.
5. **Evolution:** keep \`page\` for backwards compatibility but cap it (e.g. max offset 10,000, return 400 beyond) and document migration; add rate limits.`,
      followUps: [
        {
          q: 'How do you support "jump to page 50" in an admin UI?',
          a: 'Offset is acceptable for shallow pages with a max depth; or precompute bookmark cursors for page boundaries. Most UIs do not truly need deep random access — search and filters replace it.',
        },
        {
          q: 'What if the sort key is not unique, like price?',
          a: 'Append the primary key as a tiebreaker: ORDER BY price, id and cursor (price, id), with an index on (price, id).',
        },
      ],
      pitfalls: [
        'Adding more indexes and keeping OFFSET',
        'Using a non-unique cursor column without a tiebreaker',
        'Forgetting deletes in incremental sync',
      ],
    },
    {
      id: 'db-indexing-iq-05',
      difficulty: 'expert',
      question:
        'A write-heavy events table (40K inserts/s) has 11 indexes. Insert latency and replication lag are climbing, and WAL volume doubled. What would you do?',
      whatInterviewerLooksFor: [
        'Quantifies write amplification from indexes',
        'Audits index usage and consolidates',
        'Considers table design: partitioning, BRIN, append-only patterns, HOT',
        'Considers moving analytics queries to a different store',
      ],
      modelAnswer: `### Quantify
Each insert = 1 heap tuple + 11 index insertions. Random B-tree inserts touch leaf pages all over the index; with full-page writes after each checkpoint, the first modification of each page writes the full 8 KB page image to WAL. 40K/s × 12 structures ≈ 480K page modifications/s → WAL doubling and replicas replaying slower than the primary writes (replay is largely single-threaded).

### Audit
- \`pg_stat_user_indexes.idx_scan\` on primary **and replicas**: drop unused ones.
- Redundant prefixes: \`(user_id)\` is redundant with \`(user_id, created_at)\`.
- Indexes that exist only for rare analytics queries → those queries move elsewhere.

### Redesign
1. **Time-partition** the table (daily/weekly). Indexes per partition are small and hot; old partitions become read-only; retention = DROP PARTITION.
2. **BRIN** on \`occurred_at\` instead of B-tree — correlation with insert order is ~1, index is kilobytes, insert cost near zero.
3. Keep only the 2–3 B-trees serving OLTP lookups (e.g. \`(entity_id, occurred_at)\`).
4. Use **sequential keys** (bigserial, UUIDv7) rather than random UUIDv4 so the PK index appends to the rightmost page.
5. **Batch inserts** (multi-row INSERT or COPY, 500–5,000 rows) to cut per-statement overhead and WAL records.
6. Move analytics (group-bys across months) to ClickHouse/BigQuery via CDC or Kafka; this removes most of the secondary indexes.
7. Tune checkpoints (\`max_wal_size\`) to reduce full-page-write overhead; enable \`wal_compression\`.

### Expected impact
Going from 11 to 3 indexes cuts index writes ~70%; BRIN + partitioning keeps working sets in memory; insert p99 and replica lag typically drop several-fold.`,
      followUps: [
        {
          q: 'Why does a random UUIDv4 primary key hurt write throughput?',
          a: 'Inserts land on random leaf pages across the whole index, so the working set is the entire index (cache misses, page splits, many full-page WAL images). Time-ordered keys append to the rightmost leaf, keeping a tiny hot set.',
        },
        {
          q: 'Would an LSM-based store be a better fit?',
          a: 'For append-heavy events with key-based reads, yes — Cassandra/ScyllaDB or RocksDB-based engines turn random index updates into sequential writes, at the cost of compaction and weaker ad-hoc querying.',
        },
      ],
      pitfalls: [
        'Adding hardware without addressing index count',
        'Dropping indexes based only on primary stats (replicas may use them)',
        'Ignoring WAL/replication effects of index writes',
      ],
    },
    {
      id: 'db-indexing-iq-06',
      difficulty: 'hard',
      question:
        'Here is a query with an index on (status) that the planner ignores, choosing a sequential scan. The developer wants to force the index. What would you say?',
      context: 'SELECT * FROM orders WHERE status = \'completed\' AND created_at > now() - interval \'30 days\'; — 200M rows, 92% are completed.',
      whatInterviewerLooksFor: [
        'Explains selectivity: 92% of rows match status, so the index is useless for that predicate',
        'Identifies the actually selective predicate (created_at) and proposes an index for it',
        'Explains random vs sequential I/O cost and random_page_cost',
        'Discourages forcing plans; suggests correct index/rewrite instead',
      ],
      modelAnswer: `### The planner is right
\`status = 'completed'\` matches 92% of 200M rows. Using an index would mean ~184M random heap fetches — far slower than a sequential scan at ~1 GB/s. Indexes help when they let you **skip** most rows; a low-selectivity predicate does not.

### What is actually selective?
The last 30 days are maybe 3–5% of rows (~8M). That is the predicate to index:
- \`CREATE INDEX CONCURRENTLY ON orders (created_at);\` → range scan over 30 days, then filter status (92% pass, so little waste).
- If queries are always "completed in a date range", \`(status, created_at)\` also works (equality then range), or a partial index \`(created_at) WHERE status = 'completed'\` to save space — though at 92% the partial index saves little.
- If the query returns ~8M rows with \`SELECT *\`, the real question is **why** — pagination or aggregation (\`SELECT count(*), sum(total)\`) might be what the caller needs; for aggregates a BRIN on created_at plus parallel seq scan or a rollup table is better.

### On forcing
Postgres has no hints (pg_hint_plan extension exists) and \`enable_seqscan = off\` is a debugging tool, not a fix. Forced plans rot as data changes. Fix the inputs to the planner instead: the right index, fresh statistics, realistic \`random_page_cost\` (~1.1 on SSD instead of the default 4.0), and \`effective_cache_size\`.`,
      followUps: [
        {
          q: 'When would an index on a low-cardinality column make sense?',
          a: 'When you query the rare value (status = \'failed\' at 0.1%) — best as a partial index — or as the leading equality column of a composite index that then provides a selective range or sort.',
        },
        {
          q: 'What does lowering random_page_cost do?',
          a: 'It tells the planner random reads are cheaper relative to sequential ones (true on SSDs and when data is cached), making index scans more attractive for moderately selective queries. Set it globally for the hardware, not per query.',
        },
      ],
      pitfalls: [
        'Forcing index usage via enable_seqscan = off in production',
        'Believing any indexed column in WHERE should use the index',
        'Not asking whether returning millions of rows is the real problem',
      ],
    },
    {
      id: 'db-indexing-iq-07',
      difficulty: 'expert',
      question:
        'Compare B-tree and LSM-tree storage engines for a system that ingests 500K writes/s of user activity and serves "last 100 events for user X" in under 10 ms p99. Which would you choose and what would you tune?',
      whatInterviewerLooksFor: [
        'Explains write, read and space amplification for both',
        'Understands memtable/SSTable/compaction and Bloom filters',
        'Chooses based on workload and designs the key for the read query',
        'Discusses compaction strategy and its impact on p99',
      ],
      modelAnswer: `### B-tree (Postgres/InnoDB)
- Update-in-place pages; each insert modifies a leaf page (random I/O when the key is random) + WAL.
- Reads: predictable, 3–4 page lookups, great for ranges.
- At 500K writes/s: random page writes and WAL volume exceed a single node; you would need heavy sharding, and index maintenance per insert dominates.

### LSM (Cassandra/ScyllaDB/RocksDB)
- Writes: append to commit log + memtable (memory) → flush to immutable sorted SSTables → background compaction. Writes are sequential and cheap; a ScyllaDB/Cassandra cluster of a few dozen nodes handles 500K writes/s × RF 3.
- Reads: check memtable + possibly several SSTables; **Bloom filters** skip SSTables without the key (~1% false positive), and partition indexes locate data.
- Amplification: write amp from compaction (leveled ~10–30×, size-tiered lower), read amp (more SSTables per read with size-tiered), space amp (size-tiered needs up to ~2× free space during compaction).

### Choice and design
LSM, with the data model built for the read:
- Partition key \`(user_id, month)\`, clustering \`event_time DESC\` (timeuuid). "Last 100 events" = one partition, first 100 rows, sequential read.
- Compaction: **TimeWindowCompactionStrategy** for time-series with TTL (SSTables grouped by time window, expired windows dropped whole) or **leveled** if reads mix old and new data and must touch few SSTables. Avoid size-tiered for latency-critical reads.
- Keep partitions bounded (monthly buckets; hyperactive users → daily buckets).
- p99: provision compaction throughput headroom (compaction backlog raises read amp and p99), use speculative retry, token-aware drivers, and LOCAL_QUORUM or LOCAL_ONE depending on consistency needs.

### Say the trade-off
"LSM wins writes by deferring work to compaction; you pay it back as background I/O and read variability. I size the cluster for compaction, not just ingest."`,
      followUps: [
        {
          q: 'What happens to read latency if compaction falls behind?',
          a: 'SSTable count per partition grows, so reads merge more files (more disk seeks, more Bloom filter checks), and tombstones linger — p99 rises sharply. Monitor pending compactions and SSTables-per-read histograms.',
        },
        {
          q: 'Could Postgres work with batching and partitioning?',
          a: 'Up to a point: COPY batches, time partitioning, few indexes, and sharding (Citus) can reach high ingest, but at 500K/s you would operate many shards and fight WAL/vacuum; an LSM store is the more natural fit.',
        },
      ],
      pitfalls: [
        'Claiming LSM reads are always slow or B-tree writes always slow without context',
        'Ignoring compaction strategy and its effect on p99',
        'Modeling without bounding partition size',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'db-indexing-boe-1',
      question:
        'Estimate the size and depth of a B-tree index on orders(customer_id, created_at) for 2B rows, and whether it fits in RAM on a 256 GB server.',
      assumptions: [
        'customer_id bigint (8 B) + created_at timestamptz (8 B) = 16 B key',
        'Postgres index tuple overhead ~8 B header + 6 B ctid → ~32 B per entry after alignment',
        '8 KB pages, ~90% fill for append-mostly (lower, ~70%, for random inserts)',
        'shared_buffers + OS page cache ≈ 200 GB usable',
      ],
      steps: [
        { label: 'Entries per leaf page', calc: '8,192 × 0.7 ÷ 32 ≈ 180 entries (random inserts by customer)' },
        { label: 'Leaf pages', calc: '2B ÷ 180 ≈ 11M pages × 8 KB ≈ 89 GB' },
        { label: 'Inner levels', calc: 'Fanout ~180 → 11M ÷ 180 ≈ 62K pages (≈0.5 GB) → 344 pages → 2 pages → root' },
        { label: 'Depth', calc: 'root → 2 inner levels → level above leaves → leaf ≈ 4–5 levels' },
        { label: 'Inner pages in RAM', calc: '~0.5 GB — trivially cached, so a lookup costs ~1 leaf read + 1 heap read' },
        { label: 'Whole index vs RAM', calc: '89 GB index vs ~200 GB cache: fits, but competes with the table (~2B × 120 B ≈ 240 GB heap)' },
      ],
      answer:
        '~90 GB, depth ~4–5 levels. Inner levels (~0.5 GB) always stay cached, so a point lookup is ~1–2 physical reads; the full index fits in RAM but not together with the heap.',
      insight:
        'Depth barely grows with size; what matters is whether leaf pages and heap pages stay hot. Partitioning by time or a partial index for recent data keeps the working set in memory; covering indexes remove the heap read.',
      followUps: [
        {
          "q": "The table grows to 10B rows and customer_id becomes a UUID (16 B). Redo the size estimate — what breaks first?",
          "a": "Key grows to 24 B, so with tuple overhead an entry is ~40 B; at 70% fill that's ~143 entries per page. 10B ÷ 143 ≈ 70M leaf pages × 8 KB ≈ 560 GB, depth still ~5. The index alone no longer fits in the ~200 GB cache, so lookups for cold customers hit disk on the leaf (~0.1–0.2 ms on NVMe) plus heap. Random UUIDv4 also spreads inserts across all leaves, causing page splits and a cache-hostile write pattern. Mitigations: time-ordered UUIDv7, partition by time, or shard by customer_id."
        }
      ],
    },
    {
      id: 'db-indexing-boe-2',
      question:
        'A GraphQL feed resolver has an N+1: 1 query for 50 posts + 50 author queries. At 2,000 feed requests/s, what does this cost the database and connection pool, and what does DataLoader save?',
      assumptions: [
        'Each simple indexed lookup: ~0.1 ms DB execution + ~0.4 ms network round trip',
        'Queries per request run sequentially holding one pooled connection',
        'Postgres capacity for simple PK lookups ~50K queries/s on this instance',
        '20 pods, each with a pool of 10 connections',
      ],
      steps: [
        { label: 'Queries/s with N+1', calc: '2,000 × 51 = 102,000 queries/s' },
        { label: 'DB capacity check', calc: '102K vs ~50K q/s capacity → overloaded ~2×' },
        { label: 'Connection hold time', calc: '51 × 0.5 ms ≈ 25.5 ms per request' },
        { label: 'Connections needed (Little\'s Law)', calc: '2,000 req/s × 0.0255 s ≈ 51 busy connections (of 200) — fine only while the DB keeps up; once latency doubles, 102' },
        { label: 'With DataLoader', calc: '2 queries/request → 4,000 q/s; hold time ~1–1.5 ms (IN list of 50 is slightly slower) → ~3 busy connections' },
        { label: 'Savings', calc: 'Queries ÷ 25; connection time ÷ ~17; latency −24 ms' },
      ],
      answer:
        'N+1 generates ~102K queries/s (about 2× what the DB can do) and ~25 ms of connection hold time per request; DataLoader cuts it to ~4K queries/s and ~1.5 ms.',
      insight:
        'N+1 bugs are capacity bugs, not just latency bugs: the extra round trips multiply DB QPS and pool occupancy, and they cascade when DB latency rises. Batch loading is often worth more than any index.',
      followUps: [
        {
          "q": "Traffic grows 5× to 10,000 feed requests/s even with DataLoader. Where is the next bottleneck?",
          "a": "With 2 queries/request that's ~20K q/s, within the ~50K capacity, and busy connections ≈ 10,000 × 1.5 ms ≈ 15 of 200 — still fine. The next limits are elsewhere: each IN-list of 50 authors reads ~50 index entries, so ~1M row lookups/s, which stresses buffer cache and CPU; plus serialization in Node. The cheap win is caching author profiles (Redis or in-process LRU, TTL ~60 s) since authors repeat heavily across feeds — a 90% hit rate drops the author query to ~1K q/s. Then add read replicas for the feed query."
        },
        {
          "q": "DB latency doubles during a vacuum storm. Recompute connection occupancy for the N+1 version — why does it fail catastrophically rather than gracefully?",
          "a": "Because the DB is already ~2× overloaded, latency climbs non-linearly once anything slows it. At 1 ms per query, hold time is 51 ms per request; Little's Law gives 2,000 × 0.051 ≈ 102 busy connections, at 2 ms it's 204 — exceeding the 200-connection pool. Requests then queue for connections, client timeouts fire, retries add load, and throughput collapses. The N+1's 51× multiplier turns a small DB slowdown into pool exhaustion; DataLoader's ~3 connections leaves huge headroom."
        }
      ],
    },
    {
      id: 'db-indexing-boe-3',
      question:
        'Compare the cost of fetching page 20,000 of a product listing (20 per page) with OFFSET vs keyset pagination, and the total cost of a full crawl of 4M products.',
      assumptions: [
        'Index on (created_at, id); each index entry scan + heap visit ≈ 2 µs when cached, more on disk',
        'Page size 20 → 200,000 pages for 4M products',
        'Keyset page = one index descent (~20 µs) + 20 rows (~40 µs)',
      ],
      steps: [
        { label: 'OFFSET page 20,000', calc: 'offset = 399,980 rows → ~400K × 2 µs ≈ 0.8 s per page' },
        { label: 'Keyset page 20,000', calc: '~20 µs + 20 × 2 µs ≈ 60 µs' },
        { label: 'Full crawl with OFFSET', calc: 'Σ offset ≈ n²/2 ÷ page = (4M)² ÷ (2 × 20) = 4 × 10^11 row visits × 2 µs ≈ 8 × 10^5 s ≈ 9 days of DB time' },
        { label: 'Full crawl with keyset', calc: '200,000 pages × 60 µs ≈ 12 s of DB time' },
      ],
      answer:
        'Page 20,000 costs ~0.8 s with OFFSET vs ~60 µs with keyset; a full crawl is ~9 DB-days vs ~12 DB-seconds.',
      insight:
        'OFFSET makes crawls quadratic. Any API that partners can iterate must use cursors (and ideally offer incremental sync or bulk export).',
      followUps: [
        {
          "q": "Partners must crawl 4M products daily, but only ~1% change per day. How do you cut the crawl cost further?",
          "a": "Offer incremental sync: index `(updated_at, id)` and a cursor `WHERE (updated_at, id) > ($1, $2) ORDER BY updated_at, id`. Daily changes are ~40K rows = 2,000 pages × 60 µs ≈ 0.1 s of DB time, vs 12 s for a full keyset crawl. Deletes need tombstones (soft-delete flag or a changes table), otherwise partners never learn about removals. Watch for clock skew and long transactions committing rows with an older updated_at than a cursor already passed — lag the cursor by a safety window (e.g. 5 min) or use a monotonically increasing change sequence instead."
        }
      ],
    },
  ],
  test: [
    {
      id: 'db-indexing-mcq-01',
      difficulty: 'medium',
      question:
        'Given an index on (country, city, created_at), which query can use the index to both filter and avoid a sort?',
      code: {
        language: 'sql',
        code: `CREATE INDEX idx_u ON users (country, city, created_at);`,
      },
      options: [
        'WHERE city = \'Pune\' ORDER BY created_at',
        'WHERE country = \'IN\' AND city = \'Pune\' ORDER BY created_at LIMIT 20',
        'WHERE country = \'IN\' ORDER BY created_at LIMIT 20',
        'WHERE country = \'IN\' AND created_at > now() - interval \'1 day\' ORDER BY city',
      ],
      correct: [1],
      explanation:
        'Equality on the first two columns leaves created_at as the next ordered column, so the index provides both the filter and the sort, and LIMIT stops after 20 entries. Filtering on city alone skips the leading column. With only country fixed, rows are ordered by city first, so created_at order requires a sort. The last query filters by created_at but sorts by city — the range on created_at cannot narrow the scan because city sits between.',
      followUps: [
        {
          "q": "Product now also needs `WHERE country = 'IN' ORDER BY created_at DESC LIMIT 20` across all cities. Would you add a second index or change this one, and what does it cost?",
          "a": "The existing index cannot serve it without a sort because, within a country, rows are ordered by city first. Options: add `(country, created_at DESC)` — cheap reads, but another index on every insert (more WAL, buffer pressure, fewer HOT updates). Reordering to `(country, created_at, city)` breaks the city-filtered query, which then needs a range scan over the whole country. If the country-wide feed is rare, accept a top-N heapsort over that country's rows; if it is hot, the extra index pays for itself. Check `pg_stat_user_indexes.idx_scan` later to confirm both indexes are actually used."
        },
        {
          "q": "Would `WHERE country = 'IN' AND city IN ('Pune','Mumbai') ORDER BY created_at LIMIT 20` still avoid the sort?",
          "a": "Not with a plain index scan. Each city gives its own created_at-ordered run, but the union of two runs is not globally ordered, so Postgres must either sort all matching rows or merge. Postgres (before skip-scan improvements) typically scans both ranges and does a top-N heapsort, which is fine if each city has few rows but bad for big cities. A workaround is `UNION ALL` of two `LIMIT 20` subqueries, each ordered by created_at, then an outer `ORDER BY ... LIMIT 20`: at most 40 index entries read regardless of city size."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-02',
      difficulty: 'hard',
      question:
        'What is the most important problem in this plan?',
      code: {
        language: 'text',
        code: `Nested Loop  (cost=0.99..1640.22 rows=14 width=48)
             (actual time=0.09..18422.7 rows=412883 loops=1)
  ->  Index Scan using idx_orders_created on orders o
        (cost=0.56..412.10 rows=14 width=24) (actual time=0.05..602.1 rows=412883 loops=1)
        Index Cond: (created_at > '2026-09-01')
  ->  Index Scan using customer_pkey on customer c
        (cost=0.43..8.45 rows=1 width=24) (actual time=0.041..0.042 rows=1 loops=412883)
        Index Cond: (id = o.customer_id)
Execution Time: 18561.4 ms`,
      },
      options: [
        'customer_pkey should be a hash index for faster equality lookups',
        'The execution is slow because the query lacks a LIMIT',
        'The Index Scan on orders should be a Seq Scan because Index Scans are always slower',
        'The planner estimated 14 rows but got 412,883, so it chose a nested loop that ran the inner index scan 412K times; stale statistics or correlated predicates are likely',
      ],
      correct: [3],
      explanation:
        'The 30,000× misestimate (14 vs 412,883) drove the choice of a nested loop; 412,883 loops × ~0.042 ms ≈ 17 s is the bulk of the runtime. With correct estimates the planner would likely choose a hash join. Fix statistics (ANALYZE, extended stats, histogram target). A hash index would not change the loop count. Index scans are not inherently slower. LIMIT might hide the issue but is not the root cause.',
      followUps: [
        {
          "q": "You run ANALYZE and the estimate is still 14 rows. The date literal is in the future relative to the last stats run on a constantly growing table. What is going on and how do you fix it?",
          "a": "The histogram's upper bound is the max created_at seen at ANALYZE time; for predicates beyond it, the planner assumes almost no rows (Postgres does peek at the index for the actual max on some versions, but not always effectively). On an append-heavy table with `created_at > recent`, every new row lands past the histogram. Fixes: make autovacuum analyze this table more often (`autovacuum_analyze_scale_factor = 0.005` or a fixed threshold), run ANALYZE after bulk loads, or partition by time so each partition's stats are small and fresh. Verify with `EXPLAIN (ANALYZE, BUFFERS)` that estimated and actual rows are within ~10×."
        },
        {
          "q": "This query runs in a 2 a.m. report and you can't change the SQL (generated by a BI tool). How do you stop the nested loop tonight?",
          "a": "Use session-level knobs on the BI tool's role: `ALTER ROLE bi_reader SET enable_nestloop = off` steers it toward a hash join without touching other workloads, though it is a blunt instrument for every query that role runs. Better targeted: `pg_hint_plan` with a stored hint for that query id, or raise `default_statistics_target` on `orders.created_at` and add extended statistics if correlated predicates exist. Also set a `statement_timeout` on the role so a bad plan fails fast instead of holding locks and connections for 18 s."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-03',
      difficulty: 'expert',
      question:
        'Which of these predicates prevent a plain B-tree index on the column from being used for an index range scan in PostgreSQL? Select ALL that apply.',
      options: [
        'WHERE date(created_at) = \'2026-09-01\' (index on created_at)',
        'WHERE email ILIKE \'%@acme.com\' (index on email)',
        'WHERE created_at >= \'2026-09-01\' AND created_at < \'2026-09-02\' (index on created_at)',
        'WHERE id::text = \'42\' (index on id bigint)',
        'WHERE name LIKE \'Sha%\' with a C-collation or text_pattern_ops index on name',
      ],
      correct: [0, 1, 3],
      explanation:
        'Wrapping the column in a function (date()) or a cast (id::text) makes the expression different from the indexed value, so the index cannot be searched unless an expression index exists. A leading wildcard has no sortable prefix; it needs a trigram GIN index. A half-open range on the raw column is ideal for a B-tree, and a prefix LIKE works when the index uses C collation or text_pattern_ops.',
      followUps: [
        {
          "q": "The team can't change the ORM-generated `WHERE date(created_at) = $1`. How do you make it fast anyway, and what is the catch?",
          "a": "Create an expression index: `CREATE INDEX CONCURRENTLY ON orders ((date(created_at)))` — only valid if `created_at` is `timestamp` (without tz), because `date(timestamptz)` depends on the session TimeZone and is not IMMUTABLE, so Postgres refuses it. For timestamptz you'd index `((created_at AT TIME ZONE 'UTC')::date)` and the query must use exactly that expression. The catch: a second index on the same data adds write cost, and the planner only matches the expression textually, so any variation in the generated SQL silently falls back to a seq scan."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-04',
      difficulty: 'hard',
      question:
        'You create a covering index and EXPLAIN shows "Index Only Scan" but "Heap Fetches: 18342" for 20,000 rows, and it is barely faster. Why?',
      options: [
        'Most table pages are not marked all-visible in the visibility map (recent updates, VACUUM not run), so Postgres must check the heap for visibility',
        'INCLUDE columns are not actually stored in the index',
        'Index Only Scans always fetch the heap for rows with NULL values',
        'The index is corrupted and should be rebuilt',
      ],
      correct: [0],
      explanation:
        'Postgres indexes do not store visibility information; an index-only scan skips the heap only for pages marked all-visible in the visibility map, which VACUUM maintains. On a frequently updated table, many pages are not all-visible, so heap fetches remain. Run/tune autovacuum. INCLUDE columns are stored in leaf entries; NULLs have nothing to do with it; corruption is not indicated.',
      followUps: [
        {
          "q": "The table receives 5,000 updates/s and autovacuum never catches up on the visibility map. How would you tune it, and how do you confirm it worked?",
          "a": "Per-table settings: `autovacuum_vacuum_scale_factor = 0.01` (or a fixed `autovacuum_vacuum_threshold`), raise `autovacuum_vacuum_cost_limit` so workers aren't throttled, and on PG13+ set `autovacuum_vacuum_insert_scale_factor` so insert-only pages also get marked all-visible. Long-running transactions or stale replication slots block cleanup regardless, so check `pg_stat_activity` for old `backend_xmin`. Confirm via `pg_visibility` (`pg_visibility_map_summary`) or simply rerun `EXPLAIN (ANALYZE, BUFFERS)`: Heap Fetches should drop toward zero for the hot range, and `pg_stat_user_tables.last_autovacuum` should be recent."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-05',
      difficulty: 'expert',
      question:
        'This DataLoader batch function is used in a GraphQL API. What will users observe?',
      code: {
        language: 'typescript',
        code: `const userLoader = new DataLoader(async (ids: readonly string[]) => {
  const rows = await db.query('SELECT id, name FROM users WHERE id = ANY($1)', [ids]);
  return rows.rows; // e.g. ids [u3, u1, u9] -> rows [u1, u3] (u9 deleted)
});`,
      },
      options: [
        'Correct results; DataLoader matches rows to keys by the id property',
        'DataLoader rejects the whole batch because the result length (2) does not match the key length (3), so all three loads fail',
        'u9 resolves to undefined but u1 and u3 are correct',
        'DataLoader retries the missing key individually',
      ],
      correct: [1],
      explanation:
        'DataLoader requires the batch function to return an array of the same length as the keys, in the same order; it matches positionally, not by id. A length mismatch causes DataLoader to reject every load in the batch with an error. Even with equal lengths, DB ordering would assign wrong users to keys. The fix is mapping rows by id and returning ids.map(id => byId.get(id) ?? null). DataLoader never retries keys itself.',
      followUps: [
        {
          "q": "You fix the ordering. Now the same user id is requested 30 times in one GraphQL request, and one load fails with a DB timeout. What does DataLoader do with duplicates and failures?",
          "a": "DataLoader de-duplicates keys within a batch via its per-loader cache, so the 30 loads become one key in the batch and all 30 promises share the result. If the batch function throws, every promise in that batch rejects; and by default the rejected promise stays cached, so later loads in the same request also fail. To isolate errors per key, return an `Error` instance at that key's position instead of throwing; to allow retries, call `loader.clear(key)` on failure. Since loaders are per request, the cached failure never outlives the request."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-06',
      difficulty: 'hard',
      question:
        'A job queue table has 300M rows; 99.8% have status = \'done\'. Workers poll: WHERE status = \'queued\' ORDER BY run_at LIMIT 10 FOR UPDATE SKIP LOCKED. Which index is best?',
      options: [
        'CREATE INDEX ON jobs (status)',
        'CREATE INDEX ON jobs (run_at)',
        'CREATE INDEX ON jobs (run_at) WHERE status = \'queued\'',
        'CREATE INDEX ON jobs USING hash (status)',
      ],
      correct: [2],
      explanation:
        'A partial index containing only queued rows (~600K of 300M) is tiny, stays in memory, and is already ordered by run_at, so the poll reads 10 entries. An index on status alone still requires sorting the queued rows by run_at. An index on run_at alone walks mostly done rows in run_at order before finding queued ones. A hash index supports only equality and cannot provide order.',
      followUps: [
        {
          "q": "Workers process 2,000 jobs/s and set status = 'done'. What happens to the partial index over time, and what keeps it small?",
          "a": "Every queued → done update removes the row from the partial index's predicate, but B-tree entries are only physically removed by VACUUM (or opportunistic bottom-up deletion in PG14+). At 2,000/s, dead entries pile up at the low run_at end exactly where workers scan, so each poll walks thousands of dead entries and latency creeps up. Keep autovacuum aggressive on `jobs`, avoid long transactions that pin xmin, and consider moving finished jobs to a separate archive table or time-partitioning so the hot table stays tiny. Watch `n_dead_tup` and poll latency."
        },
        {
          "q": "Twenty workers poll the same index concurrently with SKIP LOCKED. Why don't they all fight over the same 10 rows?",
          "a": "Each worker walks the index in run_at order and tries a row lock; with `SKIP LOCKED`, rows already locked by another worker are skipped instead of waited on, so worker 2 takes rows 11–20, worker 3 rows 21–30, and so on. They still all read the first locked entries, so with many workers the skipped prefix grows and cost rises roughly linearly with worker count. Keep batches small, commit quickly (lock held only while claiming, e.g. set status = 'running'), and cap workers per queue, or shard queues by key to reduce contention."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-07',
      difficulty: 'expert',
      question:
        'After adding an index on users(last_seen_at), write throughput on the users table dropped ~35% and the table started bloating, though inserts are rare. The app updates last_seen_at on every request. Why?',
      options: [
        'Indexes on timestamp columns are stored uncompressed',
        'Postgres rebuilds the index after every update',
        'The index causes table-level locks on every update',
        'Updates to last_seen_at now modify an indexed column, so they can no longer be HOT updates; every update inserts new entries in all indexes on the table',
      ],
      correct: [3],
      explanation:
        'HOT (heap-only tuple) updates skip index maintenance only when no indexed column changes and the new version fits on the same page. Indexing a constantly updated column turns each update into new entries in every index plus more dead tuples, increasing WAL, bloat and vacuum work. Row-level locks are unaffected, and indexes are maintained incrementally, not rebuilt. Consider tracking last_seen in Redis or a separate narrow table.',
      followUps: [
        {
          "q": "Product still needs \"users seen in the last 5 minutes\" quickly. How do you serve it without indexing the hot column on users?",
          "a": "Move the hot write off the wide table. Option 1: a Redis sorted set `ZADD online <ts> <user>`, query with `ZRANGEBYSCORE now-300 +inf`, trim old members periodically — O(log n) writes, no WAL. Option 2: a narrow `user_presence(user_id PK, last_seen_at)` table with its own index and a low fillfactor, so updates stay cheap and don't bloat `users`. Also throttle writes: only update when the stored value is older than 60 s, which cuts writes ~10–100× for active users. Persist to Postgres in batches if you need durability."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-08',
      difficulty: 'hard',
      question:
        'pg_stat_statements shows these entries. Which should you optimise first to reduce database load?',
      code: {
        language: 'text',
        code: `query                                       calls        mean_ms  total_s
A: SELECT ... FROM report WHERE ...         24           41,200   989
B: SELECT * FROM cart_item WHERE cart_id=$1 88,400,000   0.21     18,564
C: UPDATE session SET last_seen=$1 ...      9,100,000    0.9      8,190
D: SELECT ... FROM product WHERE sku=$1     3,200,000    0.05     160`,
      },
      options: [
        'A — it is the slowest query at 41 seconds per call',
        'C — writes are always more expensive than reads',
        'B — it has by far the largest total time, likely from being called in a loop (N+1) or uncached',
        'D — it is called often, so an index would help most',
      ],
      correct: [2],
      explanation:
        'Load is total time: B consumes ~18,564 s, over half of the total and ~19× A. Its tiny mean with enormous call count suggests an N+1 or missing cache — fix in the app layer (batching) as well as the query. A matters for its users\' latency but contributes little load. C is significant but half of B. D is already fast and small in total.',
      followUps: [
        {
          "q": "You fix B's N+1 and its calls drop to 900K/day. How do you verify the database load actually dropped and nothing regressed elsewhere?",
          "a": "Snapshot `pg_stat_statements` before and after (or `pg_stat_statements_reset()` at deploy time) and compare total_exec_time per queryid over equal windows. Expect B's total to fall from ~18,500 s to under 1,000 s, and look for the new batched query (`cart_id = ANY($1)`) appearing with fewer calls and a higher mean. Cross-check DB CPU, active connections and pool wait time in metrics, and the endpoint's p99 in APM. Watch for a regression where the IN-list query plans badly for very large carts — check its max_exec_time."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-09',
      difficulty: 'expert',
      question:
        'Which statements about LSM-tree storage engines are accurate? Select ALL that apply.',
      options: [
        'Writes are appended to a commit log and an in-memory memtable, then flushed as immutable sorted files',
        'Bloom filters let a point read skip SSTables that definitely do not contain the key',
        'Because data is immutable, LSM engines have no write amplification',
        'Size-tiered compaction generally has lower write amplification but higher read and space amplification than leveled compaction',
        'Range scans are impossible in LSM engines',
      ],
      correct: [0, 1, 3],
      explanation:
        'Writes go to a WAL and memtable, then to immutable SSTables. Bloom filters avoid disk reads for SSTables that cannot contain the key. Size-tiered compaction rewrites data fewer times than leveled but leaves more overlapping files (read amp) and needs more temporary space. Compaction repeatedly rewrites data, so write amplification is real (often 10–30× in leveled). SSTables are sorted, so range scans work (merging across files).',
      followUps: [
        {
          "q": "Your RocksDB-backed store shows p99 read latency spiking during heavy write bursts. Which LSM mechanics explain it and what do you tune?",
          "a": "During bursts, memtables flush faster than compaction can merge L0 files, so L0 file count grows; each point read must check every overlapping L0 file (bloom filters help but cost CPU and some false positives), and range reads merge many files. When L0 hits `level0_slowdown_writes_trigger`, writes are throttled, then stalled. Tune: more compaction threads (`max_background_jobs`), larger memtables to absorb bursts, partitioned/cached bloom filters and index blocks, rate-limit compaction I/O to protect reads, and monitor pending compaction bytes and L0 file count as leading indicators."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-10',
      difficulty: 'hard',
      question:
        'What is wrong with this keyset pagination query for a feed sorted by created_at (not unique)?',
      code: {
        language: 'sql',
        code: `SELECT id, created_at, body FROM post
 WHERE created_at < $1              -- $1 = created_at of last row on previous page
 ORDER BY created_at DESC
 LIMIT 20;`,
      },
      options: [
        'Nothing; keyset pagination only needs the sort column',
        'It should use OFFSET instead to avoid skipping rows',
        'The < should be <= to include the last row again',
        'Rows sharing the boundary timestamp can be skipped; it needs a unique tiebreaker: WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC',
      ],
      correct: [3],
      explanation:
        'If several posts share the last row\'s created_at and not all fit on the page, the strict < skips the rest; <= would instead return duplicates. Adding the primary key as a tiebreaker in both ORDER BY and the row-value comparison gives a total order, with an index on (created_at DESC, id DESC). OFFSET reintroduces linear cost and instability.',
      followUps: [
        {
          "q": "The feed now supports \"newest first\" and \"oldest first\". Can one index on (created_at DESC, id DESC) serve both, and how does the cursor change?",
          "a": "Yes. A B-tree can be scanned backward, so `(created_at DESC, id DESC)` also serves `ORDER BY created_at ASC, id ASC` — what matters is that both columns flip direction together. Mixed directions (`created_at DESC, id ASC`) would need a matching index. The cursor must encode the direction: for oldest-first, the predicate becomes `(created_at, id) > ($1, $2)`. Make the cursor opaque (base64 of direction + last key) so clients can't mix a cursor from one ordering with the other, and reject mismatches with a 400."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-11',
      difficulty: 'expert',
      question:
        'A migration runs CREATE INDEX CONCURRENTLY on a busy 800 GB table and fails halfway due to a deadlock with another session. What is the state afterwards, and what should you do? Select ALL that apply.',
      options: [
        'An INVALID index remains; it is not used for reads but is still maintained on writes, adding overhead',
        'The table is locked for writes until the index is dropped',
        'You should DROP INDEX CONCURRENTLY the invalid index and retry',
        'Postgres automatically rolls back the partial index, so nothing needs to be done',
        'You can find it via pg_index where indisvalid = false',
      ],
      correct: [0, 2, 4],
      explanation:
        'A failed concurrent build leaves an INVALID index that the planner ignores but writes still maintain, so it costs write throughput. Find it in pg_index (indisvalid = false), drop it concurrently and rebuild (or REINDEX CONCURRENTLY). Concurrent builds do not hold a write-blocking lock after failure, and there is no automatic cleanup — that is exactly why invalid indexes accumulate unnoticed.',
      followUps: [
        {
          "q": "Why did CREATE INDEX CONCURRENTLY take 6 hours on this table when a plain CREATE INDEX would take 1, and how do you make the retry succeed?",
          "a": "CIC scans the table twice and, between phases, must wait for every transaction that could see the old snapshot to finish — so one long-running report or idle-in-transaction session stalls it, and it is also more prone to deadlocks. For the retry: run it in a session with no `statement_timeout` but set `lock_timeout` low, schedule it off-peak, kill or time out long transactions first (`idle_in_transaction_session_timeout`), and raise `maintenance_work_mem` to speed the sort. Watch progress in `pg_stat_progress_create_index` so you can see which phase is waiting."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-12',
      difficulty: 'medium',
      question:
        'A search box needs WHERE name ILIKE \'%wireless%\' on a 20M-row products table in Postgres, with sub-100 ms latency. Which is the most appropriate index?',
      options: [
        'A B-tree on name',
        'A B-tree on lower(name)',
        'A GIN index using pg_trgm (gin_trgm_ops) on name',
        'A BRIN index on name',
      ],
      correct: [2],
      explanation:
        'Trigram GIN indexes break strings into 3-character grams and support ILIKE with leading wildcards and similarity search. B-trees (with or without lower()) only help anchored prefixes. BRIN depends on physical correlation and is useless for text search. For relevance ranking, stemming and facets, a dedicated search engine is the next step.',
      followUps: [
        {
          "q": "Users search for two-letter terms like 'tv'. What happens to the trigram index, and what would you do?",
          "a": "pg_trgm needs at least one full trigram to narrow candidates; a two-character search (`%tv%`) produces no usable trigram, so the GIN index cannot filter and Postgres falls back to scanning nearly all 20M rows. Options: enforce a minimum of 3 characters in the UI/API, route short terms to a prefix/word search (e.g. full-text `to_tsvector` with prefix matching on words), or keep a small dictionary of common short tokens. For a growing search feature with typos and ranking, this is the point to move to Elasticsearch/OpenSearch fed by CDC."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-13',
      difficulty: 'expert',
      question:
        'An API query suddenly takes 4 s for tenant 1 (40% of rows) but 3 ms for others after the driver was changed to use prepared statements. Same SQL. What is the likely mechanism?',
      code: {
        language: 'sql',
        code: `PREPARE q(int) AS
  SELECT * FROM invoice WHERE tenant_id = $1 AND status = 'open'
  ORDER BY due_date LIMIT 50;
-- executions 1-5: custom plans; afterwards Postgres may switch to a generic plan`,
      },
      options: [
        'After several executions, Postgres may adopt a generic plan optimised for an "average" tenant, which is catastrophic for the skewed tenant; plan_cache_mode = force_custom_plan (or avoiding generic plans) fixes it',
        'Prepared statements disable index usage in Postgres',
        'The prepared statement is cached with stale data, so it rescans the table',
        'Parameter $1 is sent as text, forcing a sequential scan for all tenants',
      ],
      correct: [0],
      explanation:
        'Postgres plans the first five executions with actual parameter values, then compares against a generic plan and may switch if the generic plan seems no more expensive on average. For heavily skewed values, the generic plan can be wrong for the giant tenant (e.g. a nested loop over an index expecting few rows). Setting plan_cache_mode = force_custom_plan for that role or query restores per-value planning. Prepared statements use indexes normally; they cache plans, not data; a text parameter would affect all tenants.',
      followUps: [
        {
          "q": "You can't change server settings globally, and the app uses a pooler (PgBouncer, transaction mode). How do you apply the fix and observe it?",
          "a": "Scope it: `ALTER ROLE api_user SET plan_cache_mode = force_custom_plan` (applies at session start, which PgBouncer reuses, so it sticks for that role), or set it only for the skewed query with `SET LOCAL` inside its transaction. Alternatively make the driver use unnamed statements for this query. To observe: `auto_explain` with `log_min_duration` and `log_analyze` catches slow executions with their actual plan, and `pg_stat_statements` shows calls and mean per queryid. A generic plan shows `$1` in conditions instead of the literal tenant id."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-14',
      difficulty: 'medium',
      question:
        'Your NestJS service calls this repository method for a page of 100 orders. How many queries run, and why?',
      code: {
        language: 'typescript',
        code: `const orders = await prisma.order.findMany({ take: 100, where: { status: 'PAID' } });
const result = [];
for (const o of orders) {
  const items = await prisma.orderItem.findMany({ where: { orderId: o.id } });
  result.push({ ...o, items });
}`,
      },
      options: [
        '1 — Prisma automatically batches queries inside a loop into one query',
        '2 — Prisma merges the loop into one IN query',
        '101 — one for orders plus one per order in the loop; use include: { items: true } or a single findMany with orderId in [...ids]',
        '100 — the first query is cached',
      ],
      correct: [2],
      explanation:
        'Each awaited call inside the loop is a separate round trip — a classic N+1 with 1 + 100 queries executed sequentially. Prisma\'s dataloader-style batching applies to findUnique calls issued in the same tick, not to sequentially awaited findMany calls. Using include lets Prisma fetch items with one extra query using an IN list, or you can batch manually and group in memory.',
      followUps: [
        {
          "q": "You switch to `include: { items: true }`. A heavy page now loads 100 orders with 2,000 items each. What new problems appear?",
          "a": "Prisma issues `SELECT ... FROM order_item WHERE order_id IN (...100 ids)`, returning 200K rows. That is a large result set transferred and hydrated into JS objects in the Node event loop — hundreds of MB of memory and seconds of CPU, blocking other requests. Fixes: select only needed columns, cap items per order (return a count plus the first N), paginate items lazily, or aggregate in SQL. Ensure `order_item(order_id)` is indexed, otherwise the IN query becomes a seq scan. Measure with Prisma query logging plus heap/event-loop-lag metrics."
        }
      ],
    },
    {
      id: 'db-indexing-mcq-15',
      difficulty: 'expert',
      question:
        'A dashboard query against a 3B-row, append-only events table filters by occurred_at over the last hour. Which choices reduce cost with minimal write overhead? Select ALL that apply.',
      options: [
        'A BRIN index on occurred_at, since insertion order correlates with time',
        'Range-partitioning the table by day so the planner prunes old partitions',
        'A B-tree index on every column used in any dashboard filter',
        'A GIN index on occurred_at',
        'A rollup table (per minute) maintained incrementally for common aggregates',
      ],
      correct: [0, 1, 4],
      explanation:
        'BRIN stores min/max per block range, making it tiny and nearly free to maintain for naturally time-ordered data. Partition pruning skips irrelevant days entirely. Pre-aggregated rollups answer common dashboards without scanning raw events. Indexing every filter column multiplies write amplification on a high-ingest table, and GIN is meant for multi-valued data like arrays/JSONB/text, not scalar timestamps.',
      followUps: [
        {
          "q": "A late-arriving data backfill inserts 50M rows with occurred_at from last year into today's physical pages. What happens to the BRIN index?",
          "a": "BRIN only stores min/max per block range (default 128 pages). Backfilled rows written into recent blocks widen those ranges to span a year, so queries for the last hour now match those block ranges too and scan them — the index loses selectivity for the affected region. With daily partitioning, routing rows to the correct historical partition avoids this entirely, which is a strong argument for partitioning. Otherwise run `brin_summarize_new_values`/re-summarize and consider `CLUSTER` or a rewrite of affected partitions; monitor via `EXPLAIN (ANALYZE, BUFFERS)` 'Rows Removed by Index Recheck'."
        }
      ],
    },
  ],
};

export default topic;
