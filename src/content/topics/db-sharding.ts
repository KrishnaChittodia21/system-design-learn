import type { Topic } from '../../types';

const topic: Topic = {
  id: 'db-sharding',
  phase: 'databases',
  order: 5,
  title: 'Partitioning, Sharding & Zero-Downtime Migration',
  subtitle:
    'Split data without splitting your team: shard keys, hot shards, cross-shard queries, resharding with logical shards, and moving a live table with no downtime.',
  estimatedMinutes: 95,
  sources: [
    'Alex Xu — System Design Interview Vol 2 (Ch 1 Proximity, Ch 6 Ad Click, Ch 10 Leaderboard)',
    'Martin Kleppmann — Designing Data-Intensive Applications, Ch 6 Partitioning',
    'PostgreSQL docs — Table Partitioning',
    'Vitess & Citus documentation',
  ],
  tags: ['sharding', 'partitioning', 'postgres', 'vitess', 'citus', 'consistent-hashing', 'migration', 'cdc', 'snowflake'],
  cheatSheet: [
    'Order of escalation: index/query fix → vertical scale → read replicas → cache → native partitioning → federation → sharding. Sharding is the last resort because it costs you joins, transactions and ops simplicity.',
    'Partitioning = split a table inside ONE database (Postgres range/list/hash partitions, pruning, cheap DETACH for retention). Sharding = split data across MANY database servers.',
    'Shard key checklist: high cardinality, even write distribution, present in ~all hot queries, immutable, keeps a transaction on one shard (tenant_id, user_id). Never a monotonic key with range sharding.',
    'Hash sharding = even load, no range scans. Range = efficient scans, hotspot at the tail. Directory = flexible moves, extra lookup + SPOF. Geo = latency/residency, uneven sizes.',
    'Never do hash(key) % N on physical nodes: going N→N+1 moves ~N/(N+1) of keys. Hash into many fixed logical shards (1024–16384) and map logical→physical; resharding moves whole logical shards.',
    'Hot key (celebrity): salt the key into K sub-keys for writes and scatter-read K; or give the whale its own shard; cache reads in front. Hot shard (many keys): split/move logical shards.',
    'Cross-shard: scatter-gather costs max(shard latency) and fan-out; avoid via denormalization, reference (broadcast) tables, co-location by the same key, or a global secondary index (async, eventually consistent).',
    'Zero-downtime migration: (1) CDC/dual-write to new store, (2) backfill with snapshot + replay, (3) shadow reads + diff, (4) flip reads gradually, (5) flip writes, (6) keep reverse replication for rollback, (7) decommission.',
    'Snowflake ID = 1 sign + 41-bit ms timestamp (~69 yrs) + 10-bit worker + 12-bit sequence → 4,096 IDs/ms/worker, k-sorted, no coordination. Guard clock rollback.',
    'Vitess (MySQL): VTGate routes via vindexes, Reshard/MoveTables workflows via VReplication. Citus (Postgres): distributed + reference tables, co-location on the distribution column.',
  ],
  sections: [
    {
      heading: 'Why split data at all — and why sharding comes last',
      body: `**Intuition:** one library building eventually runs out of shelves. You can buy a bigger building (vertical scaling), open reading rooms that hold copies (read replicas), or split the collection across several buildings (sharding). Only the last one is permanent surgery.

A single well-tuned Postgres or MySQL primary goes a *long* way: on a modern 64 vCPU / 512 GB RAM / NVMe box, **10–50K simple writes/s** and **100K+ indexed point reads/s** are realistic, and multi-TB datasets are fine if the working set fits in RAM. Split when one of these hard limits bites:

| Limit | Symptom | First (cheaper) fix |
|---|---|---|
| Write throughput | Primary CPU/WAL/fsync saturated, replicas can't keep up | Batch writes, drop unused indexes, bigger box |
| Data size | Table > ~1–2 TB, vacuum/backup/index builds take hours | Partitioning + archival/TTL |
| Working set | Buffer cache hit ratio < 99%, IO-bound reads | More RAM, caching, covering indexes |
| Blast radius | One DB outage takes down every customer | Federation / cell architecture |
| Data residency | EU data must stay in EU | Geo-sharding |

**Vertical partitioning** splits *columns* (move the 20 KB \`bio\` and \`settings_json\` columns out of the hot \`users\` table) or whole tables into another database by feature (**federation** — see later). **Horizontal partitioning** splits *rows*: same schema, different subsets of rows. When those row subsets live on different servers, it is called **sharding**.

**What sharding costs you:** cross-shard joins, cross-shard transactions (now a distributed transaction — see *ds-transactions*), global unique constraints, auto-increment IDs, simple backups/restore points, and every ad-hoc analytics query. In an interview, always say what you tried first.`,
      diagram: `            VERTICAL (columns / features)          HORIZONTAL (rows)
 users(id,name,email,bio,avatar,settings)     users (id 1..N)
            |                                      |
   +--------+---------+                 +----------+----------+
   |                  |                 |          |          |
 users_core      users_profile       shard 0    shard 1    shard 2
 (id,name,email) (id,bio,avatar,     id%3=0     id%3=1     id%3=2
                  settings)          same schema, disjoint rows`,
      keyPoints: [
        'Exhaust indexes, query fixes, vertical scaling, replicas and caching before sharding.',
        'Vertical partitioning splits columns/tables; horizontal splits rows; sharding = horizontal across servers.',
        'Sharding trades away joins, ACID across keys, global constraints and operational simplicity.',
      ],
    },
    {
      heading: 'Native table partitioning in PostgreSQL (the step before sharding)',
      body: `**Intuition:** keep one database, but store a giant table as many smaller physical tables behind one logical name. The planner only touches the pieces a query needs.

PostgreSQL declarative partitioning (PG 10+, hash partitioning and default partitions since PG 11) supports **RANGE** (time-series, events, orders by month), **LIST** (region, tenant tier) and **HASH** (spread evenly by id). Benefits:

- **Partition pruning** — \`WHERE created_at >= '2026-09-01'\` scans only September's partition, at plan time or at execution time for prepared statements.
- **Cheap retention** — \`DETACH PARTITION ... CONCURRENTLY\` (PG 14+) then \`DROP TABLE\` deletes a month of data in milliseconds instead of a multi-hour \`DELETE\` that bloats the table and floods WAL.
- **Smaller indexes and faster vacuum** per partition; old partitions become effectively read-only.

**Gotchas interviewers probe:**
- A **primary key / unique constraint must include the partition key** — there are no global indexes in Postgres. \`UNIQUE(order_id)\` alone on a table partitioned by \`created_at\` is impossible.
- Queries that *don't* filter by the partition key scan every partition (N index lookups). With thousands of partitions, planning time itself becomes the bottleneck — keep it to hundreds, not tens of thousands.
- Rows that change the partition key are moved (delete + insert) — avoid mutable partition keys.
- Automate partition creation ahead of time (\`pg_partman\` or a cron job). A missing future partition with no default partition means **inserts fail**.

Partitioning buys you data-size and retention scalability, *not* write-throughput scalability — it's still one primary.`,
      code: [
        {
          language: 'sql',
          title: 'Monthly range partitions with a hash sub-strategy and fast retention',
          code: `-- Parent table: no data lives here, only routing rules
CREATE TABLE orders (
  order_id     bigint       NOT NULL,
  customer_id  bigint       NOT NULL,
  status       text         NOT NULL,
  total_cents  bigint       NOT NULL,
  created_at   timestamptz  NOT NULL,
  -- PK must contain the partition key (no global indexes in Postgres)
  PRIMARY KEY (order_id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2026_09 PARTITION OF orders
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE orders_2026_10 PARTITION OF orders
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- Catch-all so a missing partition doesn't break inserts at midnight
CREATE TABLE orders_default PARTITION OF orders DEFAULT;

-- Index on the parent is created on every partition automatically
CREATE INDEX ON orders (customer_id, created_at DESC);

-- Verify pruning: only orders_2026_09 should appear in the plan
EXPLAIN SELECT * FROM orders
WHERE created_at >= '2026-09-10' AND created_at < '2026-09-11';

-- Retention: milliseconds, no bloat, no WAL storm (PG 14+)
ALTER TABLE orders DETACH PARTITION orders_2025_09 CONCURRENTLY;
DROP TABLE orders_2025_09;`,
        },
      ],
      keyPoints: [
        'Range for time-series, list for categorical, hash for even spread.',
        'Unique constraints must include the partition key — plan IDs accordingly.',
        'Partitioning solves size/retention, not write throughput of a single primary.',
      ],
      source: 'PostgreSQL docs — Table Partitioning',
    },
    {
      heading: 'Sharding strategies: hash, range, directory, geo',
      body: `**Intuition:** you need a rule that, given a row's key, tells you which server holds it. The rule you pick decides which queries are cheap and where hotspots form.

| Strategy | Routing rule | Great for | Bad at | Real systems |
|---|---|---|---|---|
| **Hash** | shard = H(key) → slot | Even writes, point lookups | Range scans (scatter), resharding if naive modulo | Cassandra, DynamoDB, Redis Cluster, Vitess hash vindex |
| **Range** | key in [a, b) → shard | Range scans, time windows, ordered pagination | Monotonic keys: all inserts hit the last range | HBase, Bigtable, CockroachDB, TiDB, MongoDB ranged |
| **Directory / lookup** | lookup table key → shard | Moving individual tenants, uneven tenant sizes | Extra hop, the directory is a hot SPOF (cache it) | Multi-tenant SaaS, Vitess lookup vindex, Slack/Notion style tenant maps |
| **Geo** | region(key) → regional cluster | Latency, GDPR/data residency | Uneven sizes, users who travel/move | Uber cities, Tinder, Alex Xu's proximity service |

**Range sharding with auto-split** (Bigtable, CockroachDB ~512 MB ranges, TiDB ~96–256 MB regions depending on version) avoids manual rebalancing: ranges split when they grow and move to less loaded nodes. The classic failure is a **monotonic key** (timestamp, auto-increment): every insert goes to the last range → one hot node. Fix with hash-prefixed keys or UUIDv4/random-prefix for write-heavy tables — at the cost of range scans.

**Hash sharding** destroys ordering: "latest 20 orders across all users" becomes scatter-gather. But "latest 20 orders *for user X*" stays single-shard if X is the shard key and \`created_at\` is a clustering/sort key inside the shard. Cassandra formalises exactly this: *partition key* decides the node, *clustering columns* order rows inside it.

**Hybrid is normal:** shard by hash(tenant_id) across servers, then range-partition by month inside each shard.`,
      diagram: `HASH                         RANGE                      DIRECTORY
key ──H()──▶ slot 0..4095    key ─┬─ [a..h) ─▶ S1       key ─▶ ┌──────────┐
  slot ─map─▶ S1|S2|S3            ├─ [h..p) ─▶ S2              │ tenant→S │─▶ S7
                                  └─ [p..z] ─▶ S3              └──────────┘
even load, no range scans    scans cheap, tail hotspot   flexible, extra hop`,
      keyPoints: [
        'Hash = balance; range = scans; directory = flexibility; geo = latency and residency.',
        'Monotonic keys + range sharding = a single hot shard.',
        'Combine: hash across servers, range-partition within a server.',
      ],
    },
    {
      heading: 'Choosing the shard key — the decision you cannot cheaply undo',
      body: `**Intuition:** choose the key so that the things that are read and written together live together, and everything else is spread evenly.

Score candidate keys against five criteria:

1. **Cardinality** — far more distinct values than shards, ideally millions. \`country\` (≈200 values, India alone could be 30% of traffic) is a terrible key; \`user_id\` is good.
2. **Even frequency** — no value holds a disproportionate share of rows *or* traffic. Beware tenants, celebrity users, and "system" accounts.
3. **Query alignment** — the key appears in the \`WHERE\` clause of your top queries by QPS, so they route to one shard. List your top 10 queries before choosing.
4. **Transaction locality** — all rows touched by one business transaction share the key (an order and its line items and payments all keyed by \`customer_id\` or \`order_id\`).
5. **Immutability** — changing a shard key value means moving the row between servers. Email, username, region: all mutable. Surrogate IDs: stable.

**Common good choices:** \`tenant_id\` for B2B SaaS (natural isolation, but plan for whales), \`user_id\` for consumer apps, \`channel_id + time bucket\` for chat (Discord partitions messages by channel and a ~10-day bucket so one busy channel doesn't grow an unbounded partition), \`device_id\` for IoT, \`geohash prefix\` for location (Alex Xu Ch 1).

**The conflict you will always hit:** the same table needs two access paths. Orders are read by customer ("my orders") and by merchant ("orders for my store"). Pick the key for the dominant *OLTP* path and serve the other with a denormalized copy keyed differently, a global secondary index, or ship the data via CDC into an OLAP/search store.

Encode the routing in one place (a shard router/library or proxy like Vitess VTGate, Citus coordinator, ProxySQL) — never let services compute shards ad-hoc.`,
      code: [
        {
          language: 'typescript',
          title: 'A shard router with logical shards and a versioned shard map',
          code: `import { createHash } from 'node:crypto';
import { Pool } from 'pg';

const LOGICAL_SHARDS = 4096; // fixed forever; physical count can change

// Stable across languages/runtimes (unlike String.hashCode or JS object order)
export function logicalShardOf(key: string): number {
  const digest = createHash('md5').update(key).digest();
  return digest.readUInt32BE(0) % LOGICAL_SHARDS;
}

interface ShardMap {
  version: number;                    // bump on every move; clients refresh
  ranges: { from: number; to: number; dsn: string }[]; // inclusive slot ranges
}

export class ShardRouter {
  private pools = new Map<string, Pool>();
  constructor(private map: ShardMap) {}

  updateMap(next: ShardMap): void {
    if (next.version > this.map.version) this.map = next; // ignore stale pushes
  }

  poolFor(shardKey: string): Pool {
    const slot = logicalShardOf(shardKey);
    const range = this.map.ranges.find((r) => slot >= r.from && slot <= r.to);
    if (!range) throw new Error('no physical shard for slot ' + slot);
    let pool = this.pools.get(range.dsn);
    if (!pool) {
      pool = new Pool({ connectionString: range.dsn, max: 10 });
      this.pools.set(range.dsn, pool);
    }
    return pool;
  }
}

// Usage: every query that has the shard key routes to exactly one shard
// const rows = await router.poolFor(tenantId).query(
//   'SELECT * FROM invoices WHERE tenant_id = $1 AND id = $2', [tenantId, id]);`,
        },
      ],
      keyPoints: [
        'Cardinality, even frequency, query alignment, transaction locality, immutability.',
        'List top queries by QPS before choosing; serve secondary access paths with copies/indexes.',
        'Centralise routing in a library or proxy with a versioned shard map.',
      ],
    },
    {
      heading: 'Hot shards and the celebrity problem',
      body: `**Intuition:** hashing spreads *keys* evenly, not *traffic*. If one key is a celebrity, the shard that owns it melts no matter how good your hash is.

Distinguish two failure shapes:

- **Hot key** — one key gets huge traffic (a celebrity's follower counter, a flash-sale SKU, a viral post's like count). Splitting shards does nothing; the key is atomic.
- **Hot shard** — many moderately busy keys happen to share one shard (a whale tenant, a bad range boundary, an unlucky slot mapping). Moving or splitting logical shards fixes it.

**Fixes for a hot key, cheapest first:**
1. **Cache reads** in Redis/in-process with a short TTL; a celebrity profile read 500K times/s should never hit the DB.
2. **Write sharding / key salting** — split \`post:42:likes\` into K sub-counters \`post:42:likes:#0..#K-1\`; writes pick a random suffix, reads sum all K (or a background job rolls them up). K=16 turns 50K writes/s on one row into ~3K/s per sub-key.
3. **Buffer & batch** — aggregate increments in memory or a stream (Kafka) and flush every second: 50K increments become 1 UPDATE/s.
4. **Isolate the whale** — directory-based override: tenant \`acme\` → dedicated shard. Many SaaS platforms keep a "big tenant" pool.

**Fixes for a hot shard:** split the logical-shard range and move half to a new node; rebalance by *load*, not by row count; for range sharding, split at the hot boundary and add a hash prefix to monotonic keys.

**Detect it:** per-shard QPS/CPU/p99 dashboards and a top-K key tracker (sample queries, count-min sketch) — averages across shards hide a single hot one. Alex Xu's leaderboard (Ch 10) and ad-click aggregation (Ch 6) both use key salting/partial aggregation for exactly this reason.`,
      code: [
        {
          language: 'typescript',
          title: 'Salted counter: spread a hot key across K sub-keys',
          code: `import Redis from 'ioredis';

const redis = new Redis();
const SALT_BUCKETS = 16; // tune: writes per sub-key = total / 16

// Write path: O(1), hits one random sub-key -> spreads across cluster slots
export async function incrementLikes(postId: string): Promise<void> {
  const bucket = Math.floor(Math.random() * SALT_BUCKETS);
  // no hash tag {}: we WANT different sub-keys on different Redis nodes
  await redis.incr('likes:' + postId + ':' + bucket);
}

// Read path: fan out to K sub-keys; cache the sum briefly for hot posts
export async function getLikes(postId: string): Promise<number> {
  const cacheKey = 'likes:' + postId + ':total';
  const cached = await redis.get(cacheKey);
  if (cached !== null) return Number(cached);

  const pipeline = redis.pipeline();
  for (let b = 0; b < SALT_BUCKETS; b++) pipeline.get('likes:' + postId + ':' + b);
  const results = await pipeline.exec();
  const total = (results ?? []).reduce(
    (sum, [, v]) => sum + Number(v ?? 0), 0);

  await redis.set(cacheKey, total, 'EX', 2); // 2s staleness is fine for likes
  return total;
}
// NB: with ioredis Cluster a cross-slot pipeline is split per node automatically.`,
        },
      ],
      keyPoints: [
        'Hot key ≠ hot shard: splitting shards does not fix a single hot key.',
        'Hot key: cache, salt into K sub-keys, batch increments, isolate the whale.',
        'Monitor per-shard and per-key, never only cluster-wide averages.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 6 & Ch 10',
    },
    {
      heading: 'Cross-shard queries, joins and global secondary indexes',
      body: `**Intuition:** once data lives on many servers, any question that isn't about one shard key becomes "ask everyone and merge the answers" — which is as slow as the slowest shard and as fragile as the weakest.

**Scatter-gather** (fan-out) latency ≈ max over shards, not the average: with 64 shards each at p99 = 20 ms, the probability *at least one* exceeds its p99 on a single query is 1 − 0.99^64 ≈ 47%. Fan-out queries multiply load too: 1K QPS × 64 shards = 64K shard queries/s. Paginating "top 20 by date" across shards needs each shard to return 20 and a merge-sort — deep pages (offset 10,000) are ruinous; use keyset/cursor pagination.

**Ways to avoid cross-shard work:**

| Technique | How | Trade-off |
|---|---|---|
| **Co-location** | Shard related tables on the same key (orders, order_items, payments by customer_id). Citus calls it *co-located distributed tables* | Only works for one key per table family |
| **Reference / broadcast tables** | Small, rarely-changing tables (countries, plans, currencies) replicated to every shard | Writes go to all shards (2PC in Citus) |
| **Denormalization** | Store merchant_name on the order row; duplicate the order into a merchant-keyed table | Write amplification, keep copies in sync (CDC) |
| **Global secondary index** | Separate index table sharded by the secondary key → primary key | Async ⇒ eventually consistent; synchronous ⇒ distributed txn |
| **Offload** | CDC into Elasticsearch/ClickHouse/warehouse for search & analytics | Seconds of lag, another system |

**Local vs global secondary index:** a *local* (document-partitioned) index lives on each shard and indexes only that shard's rows — writes are cheap, reads by the secondary key must scatter. A *global* (term-partitioned) index is itself sharded by the indexed value — reads hit one index shard, but each write touches the base shard *and* an index shard on another machine. DynamoDB GSIs are global and **eventually consistent** (updated asynchronously); LSIs are local and share the partition key. Vitess *lookup vindexes* are global index tables kept in sync with the base table.

**Cross-shard joins:** do them in the application (fetch IDs from shard A, batch-fetch by ID from shards B), push them to an analytics store, or redesign so they aren't needed. Cross-shard *writes* need sagas or 2PC — covered in *ds-transactions*.`,
      code: [
        {
          language: 'typescript',
          title: 'Bounded scatter-gather with per-shard timeout and keyset merge',
          code: `import type { Pool } from 'pg';

interface Order { id: string; merchant_id: string; created_at: Date }

// "Latest N orders for a merchant" when orders are sharded by customer_id.
export async function latestOrdersForMerchant(
  shards: Pool[], merchantId: string, limit = 20, before?: Date,
): Promise<{ orders: Order[]; partial: boolean }> {
  const cursor = before ?? new Date('9999-12-31');
  const perShard = shards.map(async (pool) => {
    const client = await pool.connect();
    try {
      // cap the slowest shard so one bad node can't hang the request
      await client.query("SET statement_timeout = '300ms'");
      const { rows } = await client.query<Order>(
        'SELECT id, merchant_id, created_at FROM orders ' +
        'WHERE merchant_id = $1 AND created_at < $2 ' +   // keyset, not OFFSET
        'ORDER BY created_at DESC LIMIT $3',
        [merchantId, cursor, limit]);
      return rows;
    } finally {
      client.release();
    }
  });

  const settled = await Promise.allSettled(perShard);
  const partial = settled.some((s) => s.status === 'rejected');
  const merged = settled
    .flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, limit); // each shard returned <= limit, so top-N is exact
  return { orders: merged, partial }; // surface partial results explicitly
}`,
        },
      ],
      keyPoints: [
        'Fan-out latency tracks the slowest shard; load multiplies by shard count.',
        'Co-locate, broadcast small tables, denormalize, or build a global index.',
        'Global secondary indexes are usually async and eventually consistent.',
      ],
    },
    {
      heading: 'Resharding: consistent hashing, logical shards, Vitess and Citus',
      body: `**Intuition:** the naive rule \`hash(key) % N\` is like numbering seats by "row mod number-of-rows" — add one row and almost everyone must move. Good designs make the number of *buckets* fixed and only move buckets.

**Why modulo breaks:** going from N to N+1 servers, a key stays put only if \`h mod N = h mod (N+1)\`, which is true for ~1/(N+1) of keys. From 4→5 servers, **80% of data moves**; from 10→11, ~91%.

**Consistent hashing** places servers and keys on a ring; a key belongs to the next server clockwise. Adding a node moves only ~1/N of keys (from its neighbours). With **virtual nodes** (100–256 tokens per server) load evens out and a new node steals small slices from *every* server instead of one neighbour. Used by Dynamo, Cassandra (vnodes, now fewer tokens by default), Riak, Discord's early routing.

**Pre-splitting into logical shards** is what most SQL shops actually do: hash into a large fixed number of logical shards (Redis Cluster: 16,384 slots; Instagram: several thousand logical Postgres schemas on a handful of servers), and keep a small map *logical → physical*. Resharding = move whole logical shards (a schema, a slot range) to a new server with replication, then flip the map. No rehashing of keys ever. Pick the logical count ≥ 10–100× your max foreseeable physical count.

**Moving a logical shard online (generic recipe):** snapshot copy → stream changes (binlog/WAL/CDC) until lag ≈ 0 → briefly block writes for that shard (or fence via the router) → verify checksums/row counts → flip the map version → unblock → keep old copy read-only for rollback, then drop.

**Vitess (MySQL, YouTube/Slack/GitHub):** VTGate is the query router, VTTablet sidecars run on each MySQL. *Vindexes* map a column to a keyspace ID; shards own keyspace-ID ranges (\`-80\`, \`80-\`). The **Reshard** workflow uses VReplication to copy and stream into new shards (\`-40\`, \`40-80\`), then *SwitchTraffic* flips reads then writes with a few seconds of write buffering; *ReverseTraffic* is the rollback. **MoveTables** migrates tables between keyspaces (e.g. unsharded → sharded).

**Citus (Postgres extension):** \`create_distributed_table('orders', 'customer_id')\` hash-distributes into 32 shards by default (configurable), co-locates tables with the same distribution column, \`create_reference_table\` broadcasts small tables, and the rebalancer moves shards between workers using logical replication with minimal write blocking.`,
      diagram: `CONSISTENT HASHING RING (vnodes)
            A1
       C2 .----. B1          key k -> next vnode clockwise (C1 -> node C)
         /      \\
      A3|  key k |B2         add node D: it takes over ~1/N of the keys,
         \\   |  /           a small slice from every existing node
       B3 '----' C1
            A2

LOGICAL SHARDS (pre-split)
 slot:    0 ... 1023 | 1024 ... 2047 | ... | 4095
 map v7:     PG-1    |     PG-1      | ... | PG-4
 reshard: move slots 1024-2047   PG-1 --replicate--> PG-5
 map v8:     PG-1    |     PG-5      | ... | PG-4
 keys never rehash; only the slot -> server map changes`,
      code: [
        {
          language: 'sql',
          title: 'Citus: distributed, co-located and reference tables',
          code: `-- On the coordinator node
CREATE EXTENSION IF NOT EXISTS citus;

-- Hash-distribute by tenant; 32 shards by default (citus.shard_count)
SELECT create_distributed_table('accounts', 'tenant_id');

-- Same distribution column + colocate_with => joins/txns stay on one worker
SELECT create_distributed_table('invoices', 'tenant_id', colocate_with => 'accounts');

-- Small lookup tables copied to every worker (joins with them are local)
SELECT create_reference_table('currencies');

-- Single-shard, fully ACID: routed to one worker because tenant_id is fixed
BEGIN;
UPDATE accounts SET balance = balance - 500 WHERE tenant_id = 42 AND id = 7;
INSERT INTO invoices (tenant_id, account_id, amount) VALUES (42, 7, 500);
COMMIT;

-- Add a worker, then move shards online
SELECT citus_add_node('worker-5.internal', 5432);
SELECT citus_rebalance_start();   -- background shard moves (Citus 11.1+)`,
        },
      ],
      keyPoints: [
        'hash % N moves ~N/(N+1) of keys on resize — never use it on physical nodes.',
        'Consistent hashing moves ~1/N; vnodes smooth the load.',
        'Logical shards + a versioned map make resharding a copy-and-flip of whole buckets.',
      ],
    },
    {
      heading: 'Federation (functional partitioning) and cells',
      body: `**Intuition:** before splitting one table across servers, split *different tables* across servers by business domain — users DB, orders DB, catalog DB. Each is smaller, has its own scaling knob and its own failure domain.

**Federation** aligns naturally with microservices ("database per service"): the Orders service owns the orders DB, the Catalog service owns catalog. Benefits: each DB's write load drops, caches are more effective, schema changes are isolated, teams deploy independently. Costs: no SQL joins across domains (compose via APIs, GraphQL federation, or CDC-fed read models), and cross-domain invariants need sagas/outbox.

**Cells (bulkheads for data):** a *cell* is a full copy of the stack (app + DBs) serving a subset of tenants — e.g. 50K tenants per cell. A bad deploy or a runaway query affects one cell. Slack, Atlassian, and AWS itself use cell-based architectures. A thin routing layer (directory: tenant → cell) sits in front — which is directory sharding at the whole-stack level.

| | Federation | Sharding | Cells |
|---|---|---|---|
| Split by | Domain/table | Row key | Tenant, whole stack |
| Joins lost | Cross-domain | Cross-key | Cross-tenant |
| Solves | Write load per domain, ownership | Single-table size/throughput | Blast radius, noisy neighbours |

**In interviews:** say "I'd federate by domain first — it usually buys 3–5× headroom per DB — and only shard the one or two domains whose single table outgrows a primary (usually events, messages, orders)."`,
      diagram: `             ┌──────── API / GraphQL gateway ─────────┐
             │                                         │
      users-svc        orders-svc        catalog-svc   search (read model)
          │                │                  │              ▲
      [users DB]     [orders DB]  ──CDC──▶ Kafka ──────────────┘
                     (sharded by
                      customer_id)      [catalog DB]`,
      keyPoints: [
        'Federate by domain first; shard only the domain that still outgrows one primary.',
        'Cross-domain joins become API composition or CDC-fed read models.',
        'Cells limit blast radius; routing tenant → cell is directory sharding.',
      ],
    },
    {
      heading: 'Zero-downtime data migration: dual writes vs CDC, shadow reads, cutover',
      body: `**Intuition:** moving a live table is like changing the tyres of a moving car — you build the new wheel alongside, keep it spinning in sync, test it under load, and only then shift weight onto it, with a way back.

**The phased playbook (expand → migrate → contract):**

1. **Prepare** — new schema/shards live, router supports "old", "new" and "shadow" modes behind a feature flag. Make writes **idempotent** (upserts keyed by primary key + version/updated_at) so replays are safe.
2. **Start change capture first**, *then* backfill. Either:
   - **Dual writes** from the application: write old (source of truth) then new; failures on new are logged and repaired async. Simple but **not atomic** — a crash between the two writes, or two concurrent writers applying in different orders, silently diverges data.
   - **CDC (preferred):** Debezium / DMS / Vitess VReplication tails the WAL/binlog of the old DB and applies to new. Ordered per key, captures writes from *every* writer (cron jobs, admin scripts, other services), and no app change. Needs logical replication slots (watch WAL retention on the source).
3. **Backfill** — copy historical rows in PK-ordered chunks (e.g. 5–10K rows), throttled by source replica lag. Conflict rule: CDC/newer \`updated_at\` wins, so backfill never overwrites a fresher streamed change. Debezium's incremental snapshots interleave chunks with the stream using watermarks for exactly this.
4. **Verify** — row counts and per-chunk checksums (\`md5(string_agg(...))\` by PK range), plus **shadow reads**: serve from old, asynchronously read new, diff and log mismatches. Target 0 mismatches over days, not minutes.
5. **Cut over reads** gradually: 1% → 10% → 50% → 100% by tenant or request, watching error rate and p99.
6. **Cut over writes** — the only risky moment. Brief write freeze (seconds) or router fencing: stop writes to old, wait until CDC lag = 0, flip the map, resume. Then **reverse replication** new → old so rollback stays possible.
7. **Contract** — after a bake period (1–4 weeks), stop reverse replication, remove old code paths, drop old tables.

**Why "backfill first, then capture" is wrong:** any write that lands during the backfill is missed. Always start capturing (or dual-writing) before the snapshot position.`,
      diagram: `Phase     Writes                 Reads
1 capture OLD --CDC--> NEW       OLD
2 backfill OLD --CDC--> NEW      OLD
3 shadow  OLD --CDC--> NEW       OLD (+ async NEW read, diffed)
4 reads   OLD --CDC--> NEW       NEW for 1% -> 100%
5 writes  NEW --reverse--> OLD   NEW
6 contract NEW only             NEW

Rollback: trivial in 1-4 (flip reads back), via reverse replication in 5,
none after 6`,
      code: [
        {
          language: 'typescript',
          title: 'Shadow read with diffing behind a percentage flag',
          code: `import type { Pool } from 'pg';

interface Deps {
  oldDb: Pool;
  newDb: Pool;
  flags: { readFromNewPct(): number; shadowPct(): number };
  metrics: { increment(name: string, tags?: Record<string, string>): void };
}

export async function getOrder(d: Deps, orderId: string) {
  const bucket = hashToPercent(orderId); // sticky per key, not random per call
  if (bucket < d.flags.readFromNewPct()) {
    return (await d.newDb.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
  }
  const primary = (await d.oldDb.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];

  if (bucket < d.flags.shadowPct()) {
    // fire-and-forget: never add latency or errors to the user path
    void d.newDb
      .query('SELECT * FROM orders WHERE id = $1', [orderId])
      .then(({ rows }) => {
        const same = JSON.stringify(normalize(rows[0])) === JSON.stringify(normalize(primary));
        d.metrics.increment(same ? 'migration.shadow.match' : 'migration.shadow.mismatch');
      })
      .catch(() => d.metrics.increment('migration.shadow.error'));
  }
  return primary;
}

function normalize(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  const { updated_at, ...rest } = row; // ignore columns expected to differ
  return rest;
}

function hashToPercent(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 100;
}`,
        },
      ],
      keyPoints: [
        'Start CDC/dual writes before the backfill snapshot, never after.',
        'CDC beats dual writes: ordered, captures every writer, no partial-failure divergence.',
        'Shadow reads + checksums prove correctness; reverse replication preserves rollback.',
      ],
    },
    {
      heading: 'Generating IDs across shards: Snowflake and friends',
      body: `**Intuition:** auto-increment needs one counter, and one counter means one server. Instead, give every generator its own slice of the ID space and use the clock for ordering.

| Scheme | Size | Sortable | Coordination | Notes |
|---|---|---|---|---|
| DB auto-increment | 64-bit | Yes | Single primary | Breaks with sharding; leaks business volume |
| Auto-increment with offset/step | 64-bit | Roughly | Config per shard | Shard k uses k, k+N, … — resharding is painful |
| UUIDv4 | 128-bit | **No** | None | Random inserts fragment B-tree indexes, poor cache locality |
| UUIDv7 (RFC 9562, 2024) | 128-bit | Yes (ms) | None | 48-bit ms timestamp + random; good default for new systems |
| Snowflake | 64-bit | Yes (k-sorted) | Worker-ID assignment | Fits in bigint, ~4M IDs/s per worker |
| Ticket server (Flickr) | 64-bit | Yes | Central DB(s) | Two servers with odd/even; SPOF-ish |

**Snowflake layout (Twitter, 2010):** 1 unused sign bit | **41 bits** ms since a custom epoch (2^41 ms ≈ **69.7 years**) | **10 bits** worker ID (1,024 workers, often 5 DC + 5 machine) | **12 bits** sequence (**4,096 IDs per ms per worker** ≈ 4.1M/s). IDs are *k-sorted*: roughly time-ordered across workers, strictly ordered within one worker.

**Instagram's variant** embeds the **logical shard ID** (13 bits) instead of a worker ID, generated inside Postgres by a PL/pgSQL function — so any ID tells you where its row lives. That's a powerful trick: the shard key is recoverable from the ID alone.

**Production pitfalls:**
- **Clock rollback** (NTP step, VM migration) → duplicate IDs. Refuse to generate (or wait) if \`now < lastTimestamp\`; run NTP in slew mode.
- **Worker ID uniqueness** — assign via ZooKeeper/etcd lease, k8s StatefulSet ordinal, or a DB row lease; two pods with the same ID generate duplicates.
- Sequence exhaustion within a millisecond → spin until the next ms.
- JavaScript numbers are 53-bit safe: **use BigInt in Node and send IDs to browsers as strings** (Twitter added \`id_str\` for exactly this).`,
      code: [
        {
          language: 'typescript',
          title: 'Snowflake ID generator with clock-rollback protection (BigInt)',
          code: `const EPOCH = 1704067200000n;          // 2024-01-01T00:00:00Z custom epoch
const WORKER_BITS = 10n;
const SEQ_BITS = 12n;
const MAX_WORKER = (1n << WORKER_BITS) - 1n; // 1023
const MAX_SEQ = (1n << SEQ_BITS) - 1n;       // 4095

export class Snowflake {
  private lastMs = -1n;
  private seq = 0n;
  private readonly worker: bigint;

  constructor(workerId: number) {
    this.worker = BigInt(workerId);
    if (this.worker < 0n || this.worker > MAX_WORKER) throw new Error('bad worker id');
  }

  next(): string {
    let now = BigInt(Date.now());
    if (now < this.lastMs) {
      // clock moved backwards: generating now could duplicate IDs
      throw new Error('clock moved back ' + (this.lastMs - now) + 'ms; refusing');
    }
    if (now === this.lastMs) {
      this.seq = (this.seq + 1n) & MAX_SEQ;
      if (this.seq === 0n) {
        while (now <= this.lastMs) now = BigInt(Date.now()); // 4096 used: wait 1ms
      }
    } else {
      this.seq = 0n;
    }
    this.lastMs = now;
    const id = ((now - EPOCH) << (WORKER_BITS + SEQ_BITS)) | (this.worker << SEQ_BITS) | this.seq;
    return id.toString(); // string: JS numbers lose precision above 2^53
  }
}

// Decode the timestamp back out (handy for debugging and range queries)
export const snowflakeTime = (id: string) =>
  new Date(Number((BigInt(id) >> (WORKER_BITS + SEQ_BITS)) + EPOCH));`,
        },
      ],
      keyPoints: [
        '41-bit ms + 10-bit worker + 12-bit sequence = 4,096 IDs/ms/worker for ~69 years.',
        'Protect against clock rollback and duplicate worker IDs.',
        'Embed the logical shard ID in the ID (Instagram) to route by ID alone.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 7 (Unique ID generator); Instagram Engineering blog',
    },
  ],
  codeChallenges: [
    {
      id: 'db-sharding-cc-1',
      title: 'Fix a modulo shard router that cannot grow',
      context:
        'A consumer app shards the `profiles` table over 4 Postgres servers. Product wants to add 2 more servers next quarter. The router below was written in a hurry two years ago and is used by six services (two in Node, others in Go).',
      task: 'Identify why adding servers will be an outage, why routing may already be inconsistent across services, and rewrite the router so that capacity can be added by moving data in small units with no key rehashing, and so that a config change can never silently misroute.',
      starter: {
        language: 'typescript',
        title: 'shard-router.ts (starter)',
        code: `import { Pool } from 'pg';

const SERVERS = (process.env.SHARD_DSNS ?? '').split(','); // "dsn0,dsn1,dsn2,dsn3"
const pools = SERVERS.map((dsn) => new Pool({ connectionString: dsn }));

// Java-style String.hashCode
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h; // can be negative!
}

export function poolFor(userId: string): Pool {
  return pools[hash(userId) % pools.length];
}

export async function getProfile(userId: string) {
  const { rows } = await poolFor(userId).query(
    'SELECT * FROM profiles WHERE user_id = $1', [userId]);
  return rows[0];
}

export async function findByEmail(email: string) {
  // email is not the shard key, so ask everyone
  for (const pool of pools) {
    const { rows } = await pool.query('SELECT * FROM profiles WHERE email = $1', [email]);
    if (rows[0]) return rows[0];
  }
  return null;
}`,
      },
      hints: [
        'What does `hash(x) % pools.length` return for a negative hash, and what happens to ~N/(N+1) of keys when `pools.length` changes from 4 to 6?',
        'Separate "which bucket does this key belong to" (fixed forever) from "which server hosts this bucket" (changes during resharding). Where should that mapping live, and how do clients know it changed?',
        'The email lookup is sequential scatter with no timeout. What structure would make it a single-shard lookup?',
      ],
      solution: {
        language: 'typescript',
        title: 'shard-router.ts (solution)',
        code: `import { createHash } from 'node:crypto';
import { Pool } from 'pg';

export const LOGICAL_SHARDS = 4096; // never changes; >> max physical servers

// Portable, non-negative, identical in every language (md5 -> first 4 bytes BE)
export function slotOf(key: string): number {
  return createHash('md5').update(key).digest().readUInt32BE(0) % LOGICAL_SHARDS;
}

export interface ShardMap {
  version: number;
  // slot ranges -> physical DSN; loaded from etcd/Consul/config service
  ranges: { from: number; to: number; dsn: string; readOnly?: boolean }[];
}

export class ShardRouter {
  private pools = new Map<string, Pool>();
  constructor(private map: ShardMap) { validate(map); }

  apply(next: ShardMap): void {
    validate(next);
    if (next.version <= this.map.version) return; // stale or replayed config
    this.map = next;
  }

  route(key: string, forWrite: boolean): Pool {
    const slot = slotOf(key);
    const r = this.map.ranges.find((x) => slot >= x.from && slot <= x.to)!;
    if (forWrite && r.readOnly) throw new Error('slot ' + slot + ' is moving; retry'); // fenced during cutover
    let pool = this.pools.get(r.dsn);
    if (!pool) {
      pool = new Pool({ connectionString: r.dsn, max: 10, statement_timeout: 2000 });
      this.pools.set(r.dsn, pool);
    }
    return pool;
  }
}

// Every slot 0..4095 must be covered exactly once, else refuse the config
function validate(m: ShardMap): void {
  const sorted = [...m.ranges].sort((a, b) => a.from - b.from);
  let expect = 0;
  for (const r of sorted) {
    if (r.from !== expect || r.to < r.from) throw new Error('gap/overlap at slot ' + expect);
    expect = r.to + 1;
  }
  if (expect !== LOGICAL_SHARDS) throw new Error('slots not fully covered');
}

// Global secondary index: email -> user_id, itself sharded by email.
export async function findByEmail(router: ShardRouter, email: string) {
  const norm = email.trim().toLowerCase();
  const idx = await router.route('email:' + norm, false).query(
    'SELECT user_id FROM profile_email_idx WHERE email = $1', [norm]);
  if (!idx.rows[0]) return null;
  const { user_id } = idx.rows[0];
  const { rows } = await router.route(user_id, false).query(
    'SELECT * FROM profiles WHERE user_id = $1 AND email = $2', [user_id, norm]); // re-check: index is async
  return rows[0] ?? null;
}`,
      },
      explanation: `**Fixes:**
- **Negative modulo bug:** the Java-style hash overflows to negative numbers, and in JS \`-7 % 4 === -3\`, so \`pools[-3]\` is \`undefined\` — some users already crash. The md5-based slot is non-negative and **portable**, so Go and Node services route identically (String.hashCode semantics differ across languages).
- **Modulo on physical servers:** 4→6 servers would move ~2/3 of keys at once. Now keys hash into **4,096 fixed logical slots**; adding servers means moving slot ranges with replication, never rehashing.
- **Versioned, validated shard map:** loaded from a config service; stale versions are ignored and a map with gaps/overlaps is rejected instead of silently misrouting.
- **Write fencing during moves:** \`readOnly\` ranges make the cutover of a slot range safe (brief retriable errors instead of writes landing on the old copy).
- **Timeouts and bounded pools** per physical server.
- **Global secondary index for email** turns a sequential N-shard scan into two single-shard lookups; the result is re-checked against the base row because the index is maintained asynchronously (CDC) and can be briefly stale.`,
      followUps: [
        {
          "q": "How do you test that moving slot range 1024–2047 from server A to server C loses no writes?",
          "a": "Use an integration test with two Postgres containers. Run a writer that continuously upserts keys hashing into that range with an increasing counter. Start the move: copy plus logical replication into C, publish a map with the range `readOnly`, wait for replication lag 0, publish the next version pointing to C. The writer retries on the readOnly error. At the end, assert every key's final counter on C equals the writer's last acknowledged value, and that A received no writes after the fence (via a trigger that logs and rejects them)."
        },
        {
          "q": "Some pods haven't received map version N+1 yet and still write to the old server after the move. How do you make that impossible rather than unlikely?",
          "a": "Fence at the data layer, not only in clients: after cutover, make the old server reject writes for that slot range, either by revoking write privileges on its copy, adding a trigger that raises for slots in the moved range, or dropping the data after the bake. Also include the map version in each request and have each server store the version that owns the slot; a write carrying a stale version is rejected with a 'stale map' error, and the client refreshes. Clients are never the only guard."
        }
      ],
    },
    {
      id: 'db-sharding-cc-2',
      title: 'Harden a dual-write migration that silently loses data',
      context:
        'The team is migrating `orders` from a monolith MySQL to a new sharded Postgres cluster. They shipped the dual-write code below, ran a one-off backfill script last night, and plan to flip reads to the new cluster tomorrow. A spot check found ~0.3% of orders differ.',
      task: 'Find every way this migration can diverge or lose data, and redesign the write path and cutover so the new store is provably identical before reads flip, with a rollback path after writes flip.',
      starter: {
        language: 'typescript',
        title: 'orders-repo.ts (starter)',
        code: `export class OrdersRepo {
  constructor(private oldDb: any, private newDb: any, private flags: any) {}

  async updateStatus(orderId: string, status: string) {
    await this.oldDb.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
    try {
      await this.newDb.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
    } catch (e) {
      console.warn('new db write failed', e); // we'll fix it with the backfill
    }
  }

  async create(order: { id: string; customerId: string; total: number }) {
    await this.newDb.query(
      'INSERT INTO orders (id, customer_id, total, status) VALUES ($1,$2,$3,$4)',
      [order.id, order.customerId, order.total, 'NEW']);
    await this.oldDb.query(
      'INSERT INTO orders (id, customer_id, total, status) VALUES (?,?,?,?)',
      [order.id, order.customerId, order.total, 'NEW']);
  }

  async get(orderId: string) {
    const db = this.flags.readFromNew ? this.newDb : this.oldDb;
    return db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
  }
}
// backfill.ts (ran once, before dual writes were deployed):
//   SELECT * FROM old.orders -> INSERT INTO new.orders ... ON CONFLICT DO NOTHING`,
      },
      hints: [
        'Which writes to `orders` do not go through this repository at all (cron jobs, admin tools, other services)?',
        'Two concurrent `updateStatus` calls for the same order: can they apply in a different order on the two databases? What about an UPDATE on new for a row the backfill has not copied yet?',
        'Which store is the source of truth in `create`, and what happens if the second insert fails? How would you prove equality before the read flip, and what makes rollback possible after the write flip?',
      ],
      solution: {
        language: 'typescript',
        title: 'CDC-based migration: idempotent applier + verification + fenced cutover',
        code: `// Writes go ONLY to the source of truth (old MySQL) until cutover.
// Debezium streams binlog -> Kafka topic 'mysql.shop.orders' (keyed by id).
import { Kafka } from 'kafkajs';
import { Pool } from 'pg';

const newDb = new Pool({ connectionString: process.env.NEW_DSN, max: 20 });
const kafka = new Kafka({ brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'orders-migration-applier' });

export async function runApplier(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: 'mysql.shop.orders', fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const evt = JSON.parse(message.value!.toString()).payload;
      const row = evt.op === 'd' ? evt.before : evt.after;
      // binlog position gives a total order per row -> monotonic version
      const version = BigInt(evt.source.pos) + (BigInt(evt.source.file.split('.')[1]) << 40n);
      if (evt.op === 'd') {
        await newDb.query(
          'UPDATE orders SET deleted = true, src_version = $2 WHERE id = $1 AND src_version < $2',
          [row.id, version.toString()]);
        return;
      }
      // Idempotent upsert; an older event (or backfill row) never overwrites a newer one
      await newDb.query(
        'INSERT INTO orders (id, customer_id, total, status, src_version) ' +
        'VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET ' +
        'customer_id = EXCLUDED.customer_id, total = EXCLUDED.total, ' +
        'status = EXCLUDED.status, src_version = EXCLUDED.src_version ' +
        'WHERE orders.src_version < EXCLUDED.src_version',
        [row.id, row.customer_id, row.total, row.status, version.toString()]);
    },
  });
}

// Cutover (per shard-map range), run by an operator tool:
//  1. Debezium snapshot/incremental snapshot started AFTER streaming began
//  2. checksum every PK chunk old vs new until 0 diffs for N days; shadow reads 0 mismatches
//  3. reads -> new: 1% -> 100% (sticky by customer)
//  4. set old orders table read-only (fence), wait until applier lag == 0
//  5. flip writes to new; start reverse CDC new -> old for rollback
//  6. after bake period: stop reverse CDC, drop old table`,
      },
      explanation: `**What was wrong:**
- **Backfill ran before dual writes were deployed** → every write between the backfill snapshot and the deploy was lost, and \`ON CONFLICT DO NOTHING\` ignored rows that had since changed.
- **Swallowed failures** on the new DB with no repair queue → permanent divergence.
- **Updates to not-yet-copied rows** match 0 rows on new and silently do nothing.
- **Reordering:** two concurrent status updates can commit A→B on old and B→A on new; last-writer differs.
- **Inconsistent source of truth:** \`create\` writes new first; if the old insert fails the order exists only in the store nobody reads.
- **Bypass writers** (cron jobs, admin scripts, other services) never dual-write.
- **Abrupt flag flip** with no verification and no rollback path; also a MySQL \`?\` query against Postgres in \`get\`.

**Redesign:** a single source of truth plus **CDC from the binlog**, which captures every writer in commit order per key. The applier is **idempotent and version-guarded** (\`src_version\`), so replays, retries and backfill rows interleave safely. Correctness is proven with chunk checksums and shadow reads before a gradual read flip, and writes flip only after fencing the old table and draining lag to zero, with **reverse replication** for rollback.`,
      followUps: [
        {
          "q": "The applier falls 2 hours behind during a traffic spike. What does that mean for cutover, and how do you speed it up?",
          "a": "Cutover waits for lag zero, so you simply don't flip; the risk is the source's binlog retention and Kafka retention running out before the applier catches up. Scale it: the topic is keyed by order id, so add partitions and consumers (ordering is preserved per key), and batch upserts with multi-row `INSERT ... ON CONFLICT` per poll (~500 rows). Check whether the target is the bottleneck (index count, synchronous_commit), and make sure Kafka retention exceeds the worst expected lag by a wide margin."
        },
        {
          "q": "After the write flip, a bug shows the new cluster computes totals differently. You roll back to MySQL. What do you need to have in place for that to be clean?",
          "a": "Reverse CDC from Postgres to MySQL must have been running since the flip, with the same version-guarded, idempotent applier, so every write on the new cluster, including the buggy totals, is already on MySQL. Rollback is: fence the new cluster, drain reverse lag to zero, flip writes back. Then find and fix the affected rows with a query over the window since the flip, because rollback restores availability, not correctness. Keep the old table writable-ready and the reverse stream until the bake period ends."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'db-sharding-iq-01',
      difficulty: 'hard',
      question:
        'You are building a B2B SaaS (think Jira) on Postgres. 40,000 tenants; the largest 20 tenants hold 35% of the data and one of them is 8% alone. Design the sharding scheme.',
      whatInterviewerLooksFor: [
        'Chooses tenant_id as shard key and justifies it with query and transaction locality',
        'Recognises the whale problem and proposes directory overrides / dedicated shards',
        'Uses logical shards or a tenant directory so tenants can be moved online',
        'Handles cross-tenant features (admin, analytics, search) off the OLTP path',
        'Mentions noisy-neighbour isolation and blast radius (cells)',
      ],
      modelAnswer: `### Shard key: tenant_id
Nearly every query in a Jira-like product is scoped to one tenant (\`WHERE tenant_id = ?\`), and every transaction (create issue + update board + audit log) stays inside one tenant. So tenant_id gives single-shard queries and local ACID transactions. Every table carries tenant_id and every PK/unique index is prefixed with it.

### Routing: hybrid hash + directory
- Default: \`slot = hash(tenant_id) % 4096\`, slot ranges mapped to physical Postgres clusters (primary + 2 replicas each). Start with e.g. 8 clusters.
- **Directory overrides** for whales: a small \`tenant_placement\` table (cached in every service, pushed via etcd/Redis pub-sub with a version) says tenant 17 → dedicated cluster. The 8% tenant gets its own cluster; the next ~20 share a "large tenant" pool.
- Could use **Citus** (distribute by tenant_id, co-locate all tables, \`isolate_tenant_to_new_shard\` for whales) to avoid writing this myself.

### Moving tenants
A tenant move = logical replication of that tenant's rows to the target, lag → 0, brief per-tenant write fence (seconds), flip the directory entry, keep the old copy for rollback. Because the unit is one tenant, moves are small and schedulable off-peak.

### Cross-tenant needs
Internal admin, billing and analytics read from a warehouse fed by CDC (Debezium → Kafka → Snowflake/ClickHouse); search from Elasticsearch fed the same way. Never scatter-gather 40K tenants on OLTP.

### Isolation
Per-tenant rate limits and statement timeouts, connection pooling per cluster (PgBouncer), and eventually **cells** (a full stack per ~5K tenants) so a runaway tenant or bad migration hurts one cell. Schema migrations roll out cell by cell.

### Growth math
If data is 20 TB growing 60%/yr and I target ≤ 2 TB per cluster, I need ~10 clusters now and ~16 next year — 4,096 slots is plenty of granularity.`,
      followUps: [
        {
          q: 'The whale tenant alone outgrows a single cluster. Now what?',
          a: 'Shard inside the tenant by a second-level key (project_id or a hash of issue_id), with a tenant-specific router config. Accept that a few tenant-wide queries in that tenant become scatter-gather or move to the search/analytics stores.',
        },
        {
          q: 'How do you run a schema migration across 12 clusters?',
          a: 'Expand/contract migrations that are backward compatible, applied cluster by cluster (or cell by cell) with a canary first, tracked in a migration ledger per shard; application code tolerates both schema versions during rollout.',
        },
        {
          q: 'Why not schema-per-tenant or database-per-tenant?',
          a: '40K schemas bloat the catalog, slow pg_dump and migrations, and explode connection pools; it only works for hundreds of tenants. It is fine for the handful of enterprise tenants that contractually need isolation.',
        },
      ],
      pitfalls: [
        'Sharding by a hash of issue_id, breaking tenant-scoped queries and transactions.',
        'Ignoring the whale and assuming hashing balances load.',
        'Using shared-table multitenancy without tenant_id in every index, causing cross-tenant scans.',
        'Running cross-tenant analytics against the OLTP shards.',
      ],
    },
    {
      id: 'db-sharding-iq-02',
      difficulty: 'hard',
      question:
        'Orders are sharded by customer_id across 32 MySQL shards. The merchant team now needs a dashboard: "orders for my store, filter by status and date, paginated". p99 target 200 ms. How do you build it?',
      whatInterviewerLooksFor: [
        'Recognises this is a second access path that scatter-gather serves poorly',
        'Quantifies scatter-gather cost (fan-out, tail latency)',
        'Proposes a merchant-keyed read model via CDC, and discusses its consistency',
        'Handles pagination correctly (keyset, not OFFSET)',
      ],
      modelAnswer: `### Why not scatter-gather
Each dashboard request would fan out to 32 shards. At 500 dashboard QPS that's 16K shard queries/s, and latency is the max of 32 — if each shard's p99 is 30 ms, ~28% of requests (1 − 0.99^32) hit at least one p99-tail shard; one slow shard stalls everyone. OFFSET pagination makes it worse: page 50 × 20 rows means every shard sorts and returns 1,000 rows.

### Build a merchant-keyed read model
- **CDC** (Debezium on the binlog) → Kafka topic \`orders\` keyed by order_id → a projector writes into an \`orders_by_merchant\` store **sharded by merchant_id**, with an index on (merchant_id, status, created_at DESC, order_id).
- Store can be a separate MySQL/Postgres cluster (point + range queries by merchant) or Elasticsearch if merchants need free-text search and facets.
- Projector upserts are **idempotent and version-guarded** (order.updated_at or binlog position) so replays and out-of-order events can't regress state.

### Query
Single-shard, keyset-paginated: \`WHERE merchant_id = ? AND status = ? AND (created_at, order_id) < (?, ?) ORDER BY created_at DESC, order_id DESC LIMIT 20\`. Easily < 20 ms.

### Consistency
The dashboard is eventually consistent (typically < 1–2 s lag). Show "updated a few seconds ago"; for the one screen where a merchant just changed an order, read that order from the source shard by order_id (read-your-writes for the actor).

### Whale merchants
A marketplace giant could make one merchant shard hot; sub-partition that merchant's rows by month or hash bucket and let the query router know.

### Alternative
If the dashboard is analytical (counts, revenue by day), push the same CDC stream into ClickHouse/Pinot instead — OLAP beats OLTP for aggregates.`,
      followUps: [
        {
          q: 'How do you backfill the read model for 3 years of historical orders?',
          a: 'Start the CDC stream first, then run a Debezium incremental snapshot (or chunked export) into the same projector; the version guard makes stream and snapshot rows commute.',
        },
        {
          q: 'How do you detect the read model drifting from the source?',
          a: 'Periodic reconciliation: per merchant per day, compare counts and a hash of (order_id, status, version) between source shards and read model; alert on diffs and replay the affected keys.',
        },
        {
          q: 'Could you use a global secondary index on merchant_id instead?',
          a: 'Yes (a Vitess lookup vindex or a DynamoDB-style GSI) — it gives order IDs per merchant, but you still batch-fetch rows from many shards for each page; a denormalized read model returns the page from one place.',
        },
      ],
      pitfalls: [
        'Re-sharding orders by merchant_id and breaking the customer path.',
        'Synchronous dual writes to the second store from the order service.',
        'OFFSET pagination across shards.',
        'Claiming the read model is strongly consistent.',
      ],
    },
    {
      id: 'db-sharding-iq-03',
      difficulty: 'expert',
      question:
        'Walk me through migrating a 3 TB, 6K writes/s `payments` table from a single Postgres primary to a 16-shard cluster with zero downtime and zero data loss. What exactly happens at cutover?',
      whatInterviewerLooksFor: [
        'Starts change capture before the backfill and explains why',
        'Uses CDC over app dual writes, and makes the applier idempotent/ordered',
        'Has a verification strategy (checksums, shadow reads) with exit criteria',
        'Describes a precise, fenced write cutover and a rollback path',
        'Mentions operational risks: WAL retention, replica lag, throttling',
      ],
      modelAnswer: `### 0. Prep
New shards provisioned; router supports modes \`old\`, \`shadow\`, \`new\` per logical-shard range; all payment writes are idempotent upserts keyed by payment_id with a version column.

### 1. Capture first
Create a **logical replication slot** (pgoutput) and start Debezium streaming into Kafka keyed by payment_id. The slot pins WAL, so alert on slot lag and disk — 6K writes/s × ~1 KB WAL ≈ 6 MB/s ≈ 21 GB/hour if the consumer stalls.

### 2. Backfill
Incremental snapshot in PK chunks of 10K rows, throttled to keep source replica lag < 1 s. At ~30K rows/s with 4 workers, ~3B rows take ~28 hours. The applier routes each row to its shard and does \`INSERT … ON CONFLICT DO UPDATE … WHERE version < EXCLUDED.version\`, so snapshot and stream interleave safely.

### 3. Verify
- Per-chunk checksums: \`md5(string_agg(id || status || amount || version, ',' ORDER BY id))\` over PK ranges on both sides.
- **Shadow reads** for 1–2 weeks: serve from old, read new async, diff. Exit criteria: 0 unexplained mismatches over 7 days and applier lag p99 < 1 s.

### 4. Reads to new
Gradually by logical-shard range: 1% → 10% → 50% → 100%. Payments that were just written are still consistent because lag is sub-second, but the write path (still on old) does its own reads from old.

### 5. Write cutover (per range, seconds)
1. Router sets range to **fenced**: new writes get a retriable 503 (clients retry with the same idempotency key) — or hold them in a short queue.
2. Wait until CDC has applied up to the source LSN taken after the fence (lag = 0).
3. Flip the shard map version: range → new, writes go to new shards.
4. Start **reverse replication** new → old.
5. Unfence. Total write pause: typically 2–10 seconds per range.

### 6. Rollback & contract
If error rates rise, fence again, drain reverse replication, flip back. After 2–4 weeks, stop reverse CDC, drop the slot and old table.

### Why not dual writes
Non-atomic: a crash between writes, or two concurrent writers committing in different orders, diverges data, and batch jobs bypass the app. For money, that's unacceptable.`,
      followUps: [
        {
          q: 'Sequences: payment_id was a bigserial. What changes?',
          a: 'Switch to Snowflake/UUIDv7 IDs before migration (generated app-side), or at least set the new cluster to allocate from ranges far above the old max; never let two stores allocate from the same sequence space.',
        },
        {
          q: 'What if a foreign key references payments from another table?',
          a: 'Migrate co-located tables together (same shard key) or drop the FK and enforce integrity in the app plus reconciliation; cross-shard FKs do not exist.',
        },
        {
          q: 'The replication slot fills the disk during the backfill — what now?',
          a: 'Alert well before: max_slot_wal_keep_size (PG 13+) caps retention at the cost of invalidating the slot, which forces a re-snapshot; better to scale the applier and throttle the backfill.',
        },
      ],
      pitfalls: [
        'Backfilling first and starting dual writes afterwards.',
        'Flipping reads and writes together in one big bang with no rollback.',
        'No quantitative verification — "we spot-checked some rows".',
        'Forgetting writers outside the main service.',
      ],
    },
    {
      id: 'db-sharding-iq-04',
      difficulty: 'hard',
      question:
        'A celebrity with 90M followers posts, and the shard holding their row goes to 100% CPU for 20 minutes. Engagement writes (likes, replies count) and profile reads are the culprits. What do you do now, and what do you change so it never happens again?',
      whatInterviewerLooksFor: [
        'Distinguishes hot key from hot shard; knows resharding does not help a single key',
        'Immediate mitigation (cache, shed, rate-limit writes)',
        'Structural fixes: counter sharding, async aggregation, read caching',
        'Detection: per-key heavy-hitter tracking',
      ],
      modelAnswer: `### Diagnose
One shard hot, others idle → skew. \`pg_stat_statements\` / slow-log shows the same row: \`UPDATE posts SET like_count = like_count + 1 WHERE id = ?\` serialised on a **row lock**, plus millions of \`SELECT … FROM users WHERE id = celeb\`. This is a **hot key**, not a hot shard: splitting shards won't help because one row can live in only one place.

### Mitigate now (minutes)
- Put the celebrity profile and post in a read cache (Redis, plus a 1–5 s in-process cache on API pods) — 500K reads/s become a handful per second to the DB.
- Temporarily move like increments to an async path (feature flag): write a like event to Kafka, return 200. Rate-limit the fan-in if needed; nobody notices a like count lagging by seconds.

### Fix structurally
1. **Likes as events, counts as aggregates.** Store the like itself (post_id, user_id) sharded by *user_id* or by post-bucket so writes spread; maintain counts via a stream aggregator that flushes \`like_count += N\` once per second per post — 50K increments/s become ~1 UPDATE/s.
2. **Salted counters** where synchronous counts are needed: K = 16–64 sub-counters, summed on read and cached.
3. **Read path:** celebrity content served from cache/CDN with request coalescing (single-flight) so cache misses don't stampede.
4. **Heavy-hitter detection:** sample queries per key (count-min sketch / top-K in the router), auto-promote keys above a threshold to "hot" handling.
5. Fan-out for the timeline itself uses pull-for-celebrities (covered in design-social).

### Result
Load on the celebrity's shard becomes proportional to *flush frequency*, not follower count.`,
      followUps: [
        {
          q: 'How do you give users read-your-own-like while counts are async?',
          a: 'The client optimistically increments; the server records the like row synchronously (idempotent on post_id+user_id) so "did I like it" is exact, while the aggregate count is eventually consistent.',
        },
        {
          q: 'How would you pick K for salted counters?',
          a: 'K ≈ peak writes per key ÷ safe writes per row per second (e.g. 50K ÷ 2K ≈ 25 → 32), balanced against read fan-out cost; make K dynamic for detected hot keys only.',
        },
      ],
      pitfalls: [
        'Proposing to add more shards or reshard to fix a single hot row.',
        'Using SELECT … FOR UPDATE / stronger locking on the counter.',
        'Caching without stampede protection when the key expires.',
      ],
    },
    {
      id: 'db-sharding-iq-05',
      difficulty: 'expert',
      question:
        'Two years ago someone sharded users with `user_id % 8` across 8 MySQL servers. You need 12 servers within a month. Walk me through resharding without downtime.',
      whatInterviewerLooksFor: [
        'Quantifies how much data modulo resharding moves',
        'Introduces logical shards as a one-time migration and explains why',
        'Uses replication-based moves with fenced cutover, not export/import',
        'Considers tooling (Vitess) and the routing layer rollout',
      ],
      modelAnswer: `### The problem
Going \`% 8\` → \`% 12\`, a key stays put only if \`id mod 8 = id mod 12\`, i.e. id mod 24 ∈ {0..7}: **1/3 stays, 2/3 moves**. Moving 2/3 of all data in one coordinated flip is the outage I want to avoid — and doing it again at 16 would repeat the pain.

### Plan: introduce logical shards once
1. Define \`slot = hash(user_id) % 4096\` (or keep compatibility by choosing slots so that each old shard's keys map to a contiguous set — e.g. \`slot = user_id % 4096\`, since 4096 is a multiple of 8, every slot lives entirely on exactly one old shard: slot s is on server s % 8). That makes the **initial map exactly equal to today's layout** — zero data movement to adopt it.
2. Deploy the new router (reads the versioned slot map from etcd) everywhere; verify it routes identically to the old code via shadow routing in logs.

### Move to 12 servers
Each old server owns 512 slots; target 4096/12 ≈ 341 per server. Move ~171 slots from each old server to the 4 new ones (1/3 of data moves — the minimum possible).

Per batch of slots:
1. Replicate the rows for those slots to the target (Vitess VReplication, or a filtered binlog stream / gh-ost-style copy + binlog tail).
2. Verify checksums per slot.
3. Fence writes for those slots at the router (seconds), wait for lag = 0, bump the map version, unfence.
4. Keep the source copy for rollback, then delete rows in throttled batches.

### Tooling
This is precisely what **Vitess** automates: define a hash vindex on user_id, run \`Reshard\` from \`-\` ranges to new ranges, \`SwitchTraffic\` for replicas then primaries, \`ReverseTraffic\` if needed. Adopting Vitess itself is a MoveTables migration.

### Next time
Adding servers is just moving slot ranges; no rehash ever again.`,
      followUps: [
        {
          q: 'Why did you choose 4096 and not 12 or 24?',
          a: 'It must be a multiple of the current count (8) for a zero-move adoption, and much larger than any future physical count so moves stay fine-grained and balanced; power of two makes range splits clean.',
        },
        {
          q: 'How do in-flight transactions behave at the fence?',
          a: 'Transactions on fenced slots get a retriable error; clients retry with idempotency keys after the flip. Long-running transactions are waited out or killed before the lag check.',
        },
      ],
      pitfalls: [
        'Stopping the world to export/import 2/3 of the data.',
        'Jumping to consistent hashing without addressing migration from the existing layout.',
        'Forgetting that every service must adopt the new router before any move.',
      ],
    },
    {
      id: 'db-sharding-iq-06',
      difficulty: 'medium',
      question:
        'Design ID generation for a system writing 200K rows/s across 64 shards. IDs must be 64-bit, unique, roughly time-ordered, and must not require a network call per ID.',
      whatInterviewerLooksFor: [
        'Knows the Snowflake bit layout and its capacity',
        'Handles worker-ID assignment and clock rollback',
        'Discusses index locality and JS precision',
        'Can mention embedding the shard in the ID',
      ],
      modelAnswer: `### Snowflake-style layout (64 bits)
| bits | field | capacity |
|---|---|---|
| 1 | sign (0) | keeps IDs positive in signed bigint |
| 41 | ms since custom epoch | 2^41 ms ≈ 69.7 years |
| 10 | worker ID | 1,024 generators |
| 12 | sequence | 4,096 per ms per worker |

Capacity: 4,096 × 1,000 = **~4.1M IDs/s per worker**; 200K/s across, say, 100 app pods is ~2K/s each — nowhere near the limit.

### Worker ID assignment
Must be unique among live generators. Options: k8s StatefulSet ordinal; a lease in etcd/ZooKeeper (\`/idgen/workers/37\`, TTL 30 s, renewed) — a pod that loses its lease stops generating; or a DB table with leases. Never derive from IP/hostname hash (collisions).

### Clock safety
If \`now < lastTimestamp\` (NTP step, VM pause), refuse or wait until the clock catches up; small skews (<5 ms) can wait, bigger ones fail health checks. Run chrony in slew mode.

### Properties
k-sorted IDs keep B-tree inserts at the right edge (much better page locality than UUIDv4), allow time-range queries on the ID itself, and decode to a creation timestamp for debugging.

### Variant: embed the shard
Instagram-style: replace some worker bits with a **logical shard ID** (13 bits = 8,192 slots) and generate the ID for the shard the row goes to, so any ID can be routed without a lookup.

### Gotchas
- Send IDs as **strings** to JavaScript clients (2^53 limit); use BigInt in Node.
- IDs leak creation time and rough volume — use opaque public IDs if that matters.
- Alternative if 128-bit is acceptable: UUIDv7 needs no worker assignment at all.`,
      followUps: [
        {
          q: 'Is Snowflake ordering good enough to order messages in a chat?',
          a: 'Only roughly: across workers, clock skew of a few ms can reorder IDs. For strict per-channel order, assign a per-channel sequence at a single writer (partition leader) instead.',
        },
        {
          q: 'What happens after 69 years or if you choose a bad epoch?',
          a: 'Choose a recent custom epoch to maximise lifetime; overflow flips the sign bit. It is a known, far-future migration.',
        },
      ],
      pitfalls: [
        'Central ticket DB call per ID at 200K/s.',
        'UUIDv4 primary keys on a write-heavy B-tree without discussing fragmentation.',
        'Ignoring clock rollback or duplicate worker IDs.',
      ],
    },
    {
      id: 'db-sharding-iq-07',
      difficulty: 'medium',
      question:
        'Your team lead proposes sharding your 400 GB Postgres database because "the API is getting slow". What do you ask and what do you recommend?',
      context: 'Primary: 16 vCPU, 64 GB RAM, one read replica mostly idle. p99 went from 90 ms to 700 ms over six months.',
      whatInterviewerLooksFor: [
        'Pushes back with data before re-architecting',
        'Knows what a single Postgres node can handle',
        'Lists cheaper steps in order and when sharding is justified',
        'Considers partitioning and federation as intermediate steps',
      ],
      modelAnswer: `### Questions first
- What is slow — which endpoints and queries? (\`pg_stat_statements\` by total_exec_time, APM traces.)
- Is the DB CPU-, IO-, lock- or connection-bound? Buffer cache hit ratio? Write QPS vs read QPS?
- What's the growth rate of data and write load?

### Likely reality
400 GB on a 64 GB box means the working set may not fit in RAM; slow p99 is usually a few queries doing seq scans, missing composite indexes, N+1s, or lock contention — not a capacity ceiling. A single Postgres primary handles 10K+ writes/s and multi-TB data on bigger hardware.

### Recommendation, cheapest first
1. **Fix the top 10 queries** by total time: add/adjust indexes, remove N+1, keyset pagination. Often 5–10× improvement in a week.
2. **Connection pooling** (PgBouncer transaction mode) if connections are the issue.
3. **Use the idle replica** for read-heavy endpoints that tolerate a little lag; add caching for hot reads.
4. **Scale up**: 64 → 256 GB RAM so the working set fits; this is a config change, not a project.
5. **Partition** the few huge append-mostly tables (events, audit logs) by month; archive old partitions.
6. **Federate** a noisy domain (e.g. analytics/events) into its own DB.
7. **Shard** only when write throughput or dataset size is projected to exceed what the largest instance can do within ~12–18 months — and then pick the key from the top queries.

### Why be conservative
Sharding is a multi-quarter project that permanently costs joins, transactions, constraints and operational simplicity; it doesn't fix bad queries — it distributes them.`,
      followUps: [
        {
          q: 'What evidence would change your mind and make you shard now?',
          a: 'Write QPS or WAL volume approaching the ceiling of the largest instance, replicas unable to keep up, data growth projecting past ~5–10 TB soon, or a need for tenant/geo isolation.',
        },
        {
          q: 'How would you prove the working set does not fit in memory?',
          a: 'Low buffer cache hit ratio (blks_hit / (blks_hit + blks_read) < 0.99), high read IOPS, pg_statio per table/index, and latency correlating with disk reads.',
        },
      ],
      pitfalls: [
        'Agreeing to shard without looking at query plans.',
        'Assuming 400 GB is "big data".',
        'Sharding before trying read replicas and partitioning.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'db-sharding-boe-1',
      question:
        'A chat product stores 400M messages/day, kept for 3 years. How many Postgres shards do you need, and is write throughput or storage the binding constraint?',
      assumptions: [
        'Average message row ≈ 400 bytes including indexes overhead ×2 → ~800 bytes on disk',
        'Target ≤ 2 TB of data per shard primary (keeps backups, restores and index rebuilds to a few hours)',
        'Peak write rate = 3× average',
        'A comfortable sustained insert rate per shard primary ≈ 5K rows/s (leaves headroom for reads, vacuum, replication)',
        'Each shard = 1 primary + 2 replicas',
      ],
      steps: [
        { label: 'Average write QPS', calc: '400M ÷ 86,400 s ≈ 4,630 writes/s' },
        { label: 'Peak write QPS', calc: '4,630 × 3 ≈ 13.9K writes/s' },
        { label: 'Shards needed for writes', calc: '13.9K ÷ 5K ≈ 2.8 → 3 shards' },
        { label: 'Data per day', calc: '400M × 800 B = 320 GB/day' },
        { label: 'Total over 3 years', calc: '320 GB × 365 × 3 ≈ 350 TB' },
        { label: 'Shards needed for storage', calc: '350 TB ÷ 2 TB ≈ 175 shards' },
        { label: 'Total machines', calc: '175 × 3 (primary + 2 replicas) = 525 DB servers' },
      ],
      answer:
        '~175 shards (≈525 servers with replicas) — storage, not write throughput, is the binding constraint by ~60×.',
      insight:
        'When storage dominates, don\'t buy write capacity you don\'t need: tier the data. Keep the last ~90 days (~29 TB → ~15 shards) hot in Postgres partitioned by time, and move older messages to a cheaper wide-column store (Cassandra/ScyllaDB — Discord\'s choice) or compressed object storage. Shard key: channel_id + time bucket so one channel never becomes an unbounded partition.',
      followUps: [
        {
          "q": "Product changes retention from 3 years to forever. How does your design change?",
          "a": "Storage grows ~117 TB/year with no ceiling, so Postgres sharding by storage (60+ new shards a year) becomes the wrong tool. Tier it: keep 90 days hot in Postgres (~29 TB, ~15 shards), and move older messages to a wide-column store (Cassandra or Scylla, key `(channel_id, bucket)`) or to compressed Parquet in object storage. At ~5–10× compression on S3 that is roughly 12–25 TB/year at $0.023/GB-month. Old-message reads are rare and can tolerate 100–300 ms."
        },
        {
          "q": "Average message size doubles because of rich embeds (link previews, reactions). What breaks first?",
          "a": "Storage again: 800 B → 1.6 KB per row, so ~700 TB over 3 years and ~350 shards at 2 TB each; writes are unaffected (still ~14K/s peak). Before buying servers, separate the bulk: store embeds and attachments in object storage referenced by URL, keep the message row lean, and TOAST compression handles the rest. Reactions belong in their own table keyed by message id, since they're updated frequently and would rewrite the whole message row with each change under MVCC."
        }
      ],
    },
    {
      id: 'db-sharding-boe-2',
      question:
        'You are choosing the number of logical shards for a user store that starts on 4 physical Postgres clusters and may reach 200 clusters in 5 years. How many logical shards, and what does one logical-shard move cost?',
      assumptions: [
        'Today: 2 TB total data, growing 80%/year',
        'Want ≥ 10 logical shards per physical cluster at max scale for balance',
        'Logical shard count must be a power of two for clean range splits',
        'Replication copy speed for a move ≈ 100 MB/s',
      ],
      steps: [
        { label: 'Minimum logical shards at max scale', calc: '200 clusters × 10 = 2,000 → round up to 2^11 = 2,048; choose 4,096 for margin' },
        { label: 'Data in 5 years', calc: '2 TB × 1.8^5 ≈ 2 × 18.9 ≈ 38 TB' },
        { label: 'Size of one logical shard (5 yrs)', calc: '38 TB ÷ 4,096 ≈ 9.3 GB' },
        { label: 'Size of one logical shard (today)', calc: '2 TB ÷ 4,096 ≈ 490 MB' },
        { label: 'Copy time for one logical shard (5 yrs)', calc: '9.3 GB ÷ 100 MB/s ≈ 93 s (+ catch-up)' },
        { label: 'Slots per cluster today', calc: '4,096 ÷ 4 = 1,024 logical shards each' },
      ],
      answer:
        '4,096 logical shards: ~490 MB each today, ~9 GB each at 5 years — each move is a ~1.5-minute copy plus seconds of fenced cutover.',
      insight:
        'Logical shards small enough to move in minutes make rebalancing a routine background job rather than a project. Too few (e.g. 16) and each move is a TB-scale event; too many (e.g. 1M schemas) and catalog/metadata overhead explodes — so use slot ranges in a map, not one schema per slot.',
      followUps: [
        {
          "q": "Growth is 150%/year instead of 80%. Do 4,096 logical shards still hold up at 5 years?",
          "a": "Data = 2 TB × 2.5^5 ≈ 2 × 97.7 ≈ 195 TB, so each logical shard is ~48 GB, and one move is ~8 minutes of copy at 100 MB/s plus catch-up: still fine. The more likely limit is physical: at 2 TB per cluster that's ~100 clusters, within the 200 planned. The cliff comes when one logical shard approaches a whole cluster's capacity, which is far away here. The bigger risk is a single tenant or key outgrowing its logical shard, which no slot count fixes."
        },
        {
          "q": "Copying at 100 MB/s hurts the source cluster's p99 during moves. How do you budget rebalancing?",
          "a": "Throttle moves to a fraction of spare IO: e.g. 30 MB/s, so a 9 GB slot copies in ~5 minutes, and run one or two moves per cluster at a time. Gate on source p99 and replica lag, pausing when either exceeds its SLO. Rebalancing 1,024 slots across new clusters at 30 MB/s takes ~3 days of background work, acceptable because it starts weeks before capacity is critical. That's why you add capacity at ~60% utilisation, not 90%."
        }
      ],
    },
    {
      id: 'db-sharding-boe-3',
      question:
        'Estimate how long a zero-downtime backfill takes when migrating a 1.5B-row, 900 GB orders table, and how much WAL the source must retain if the CDC consumer falls behind.',
      assumptions: [
        'Backfill chunk = 10K rows; each chunk read + upsert ≈ 400 ms per worker',
        '6 parallel workers, throttled to keep source replica lag < 1 s',
        'Source write load during migration: 3K writes/s, ~1.5 KB WAL per write (row + index updates + full-page writes)',
        'CDC consumer could stall for up to 12 hours before someone notices on a weekend',
      ],
      steps: [
        { label: 'Throughput per worker', calc: '10K rows ÷ 0.4 s = 25K rows/s' },
        { label: 'Total backfill throughput', calc: '25K × 6 = 150K rows/s (throttling realistically halves it → ~75K rows/s)' },
        { label: 'Backfill duration', calc: '1.5B ÷ 75K ≈ 20,000 s ≈ 5.6 hours' },
        { label: 'WAL rate', calc: '3K writes/s × 1.5 KB ≈ 4.5 MB/s' },
        { label: 'WAL retained in 12 h stall', calc: '4.5 MB/s × 43,200 s ≈ 194 GB' },
      ],
      answer:
        'Backfill ≈ 5–6 hours; a 12-hour CDC stall pins ~200 GB of WAL on the source.',
      insight:
        'The backfill is the easy part; the dangerous part is a stuck replication slot silently filling the primary\'s disk. Size free disk for the worst stall, set max_slot_wal_keep_size, and page on slot lag in bytes and seconds before starting.',
      followUps: [
        {
          "q": "Throttling cuts the backfill to 25K rows/s and source writes double to 6K/s. Recompute the duration and WAL volume generated during it.",
          "a": "Duration: 1.5B ÷ 25K = 60,000 s ≈ 16.7 hours. WAL from user writes: 6K × 1.5 KB = 9 MB/s × 60,000 s ≈ 540 GB generated during the backfill, all of which the CDC stream must carry to the target. If the applier processes at least 6K events/s it stays current, so retained WAL stays small. But a 12-hour stall now pins ~390 GB, so plan disk or `max_slot_wal_keep_size` around that."
        },
        {
          "q": "How do you prove after the backfill that 1.5B rows on the target match the source without reading both tables twice in full?",
          "a": "Chunked checksums: split the PK space into ranges of ~100K ids and compute `count(*)` and a hash aggregate per chunk (e.g. `md5(string_agg(id || status || total, ',' ORDER BY id))`) on both sides in parallel workers, then re-copy only mismatched chunks. That's 15K chunk comparisons, parallelisable and throttled like the backfill. Because rows keep changing, compare with a lag allowance and re-check mismatches a few minutes later; persistent mismatches are real bugs. Tools: pt-table-checksum, Vitess VDiff, or a custom job."
        }
      ],
    },
  ],
  test: [
    {
      id: 'db-sharding-mcq-01',
      difficulty: 'medium',
      question:
        'An events table in Postgres is 3 TB and growing 150 GB/month. Deleting data older than 13 months takes 9 hours nightly and causes replica lag. Writes are only 2K/s. What is the best next step?',
      options: [
        'Range-partition by month and drop expired partitions via DETACH ... CONCURRENTLY + DROP TABLE',
        'Shard the table across 4 servers by hash(event_id) so each nightly DELETE is 4× smaller',
        'Move the DELETE to a replica so the primary is not affected',
        'Add an index on created_at so the DELETE finds rows faster',
      ],
      correct: [0],
      explanation:
        'The problem is retention on one primary with modest write load — native range partitioning turns a 9-hour DELETE into a metadata operation with no bloat or WAL storm. Sharding adds huge complexity and still runs DELETEs on every shard. Deletes cannot run on a read-only replica, and an index speeds up finding rows but not the row-by-row deletion, vacuum and WAL generation that cause the lag.',
      followUps: [
        {
          "q": "The table isn't partitioned today. How do you get 3 TB of existing data into monthly partitions without a long outage?",
          "a": "Don't rewrite history in place. Create a new partitioned parent `events_p` with monthly partitions, and either attach the old table as one big historical partition (`ATTACH PARTITION ... FOR VALUES FROM (minvalue) TO ('2026-10-01')`, after adding a matching CHECK constraint `NOT VALID` then `VALIDATE`, so the attach skips the scan), or rename tables in one short transaction so new writes go to the parent. New months land in proper partitions. The old blob ages out: once all of it is past 13 months, drop it in one statement."
        },
        {
          "q": "Queries filter by `user_id` and a date range, not just date. What happens to them after monthly partitioning, and what do you watch for?",
          "a": "With a `created_at` predicate, the planner prunes to the matching months, so a 7-day query touches 1–2 partitions and their local `(user_id, created_at)` indexes: fast. Queries without a date filter (\"all events for user X\") now probe the index of every partition, 13+ index lookups instead of one, so p99 can rise. Check `EXPLAIN` for `Subplans Removed`, push the UI to always send a date range, and keep the partition count modest (monthly, not daily) so planning time stays low."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-02',
      difficulty: 'hard',
      question:
        'This partitioned table fails to create. Why?',
      code: {
        language: 'sql',
        code: `CREATE TABLE payments (
  payment_id  bigint PRIMARY KEY,
  merchant_id bigint NOT NULL,
  amount      bigint NOT NULL,
  created_at  timestamptz NOT NULL
) PARTITION BY RANGE (created_at);`,
      },
      options: [
        'RANGE partitioning requires a DEFAULT partition to be declared in the same statement',
        'timestamptz cannot be used as a range partition key; you must use date',
        'The primary key must include all partition key columns because Postgres has no global indexes',
        'bigint primary keys are not allowed on partitioned tables; use a sequence per partition',
      ],
      correct: [2],
      explanation:
        'Unique constraints on a partitioned table are enforced per partition, so they must contain the partition key — PRIMARY KEY (payment_id, created_at) works. Default partitions are optional and created separately; timestamptz is a very common range key; bigint keys are fine. The consequence: global uniqueness of payment_id alone must come from the ID generator (e.g. Snowflake), not a constraint.',
      followUps: [
        {
          "q": "You change the PK to `(payment_id, created_at)`. A refund service looks payments up by `payment_id` only. What does that query cost now, and how do you make it fast?",
          "a": "Without `created_at`, the planner can't prune, so it probes the PK index of every partition: 36 monthly partitions means 36 index lookups per refund. Two fixes: encode time in the ID (a Snowflake-style id lets the service derive the creation timestamp and add `created_at BETWEEN t AND t + 1s`), or keep a small unpartitioned lookup table `payment_id → created_at`. The first is free and also guarantees uniqueness from the generator."
        },
        {
          "q": "A bug in a client retries and inserts the same payment_id with a different created_at. What stops the duplicate now?",
          "a": "Nothing at the database: the unique constraint is `(payment_id, created_at)`, so two rows with the same id and different timestamps are both legal, possibly in different partitions. Protect it elsewhere: an idempotency key table (unpartitioned, `UNIQUE(idempotency_key)`) written in the same transaction, or a `payment_ids` table with `payment_id` as PK acting as a global uniqueness registry. Also have the server, not the client, assign `created_at`, so a retry can't change it."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-03',
      difficulty: 'expert',
      question:
        'A cluster uses shard = hash(key) % N with N = 10 physical nodes. You add one node. Roughly what fraction of keys must move, and what fraction would move with consistent hashing (many vnodes)?',
      options: [
        '~10% with modulo; ~10% with consistent hashing',
        '~91% with modulo; ~50% with consistent hashing',
        '~50% with modulo; ~9% with consistent hashing',
        '~91% with modulo; ~9% with consistent hashing',
      ],
      correct: [3],
      explanation:
        'With modulo, a key stays only if h mod 10 = h mod 11, which holds for about 1/11 of keys, so ~10/11 ≈ 91% move. Consistent hashing moves only the keys the new node takes over, ≈ 1/(N+1) ≈ 9%. The 10%/10% option confuses the ideal outcome with modulo behaviour, and 50% is a common guess from thinking of a "split in half".',
      followUps: [
        {
          "q": "With consistent hashing, the new node takes ~9% of keys. Which nodes give them up, and why do you need many vnodes for that to be fair?",
          "a": "With one token per node, the new node takes a single arc from exactly one neighbour, so that neighbour loses up to half its keys while the other 9 nodes are untouched, and arc sizes vary widely (some nodes own 2–3× the average). With ~100–256 vnodes per node, the new node's tokens are scattered around the ring, so it takes ~1/11 of each existing node's data. Load stays within a few percent of even, and the copy work is spread across all nodes instead of hammering one."
        },
        {
          "q": "You're running modulo and must add the 11th node next week anyway. How do you limit the damage without moving 91% of data?",
          "a": "Don't change N in the hash. Introduce a fixed layer of logical buckets: keep `bucket = hash(key) % 1024` (or similar) and a bucket→node map. Initially map buckets so that routing is identical to today's modulo assignment (e.g. bucket b goes to node b % 10). Adding node 11 then means reassigning ~93 buckets (1024/11) to it and copying only those, about 9% of data, each bucket moved with copy-then-fence. One migration to logical buckets, and every later expansion is cheap."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-04',
      difficulty: 'hard',
      question:
        'An IoT platform range-shards readings by (reading_id) where reading_id is an auto-increment bigint, using CockroachDB-style automatic range splits. Ingest is 200K rows/s. Which symptom do you expect?',
      options: [
        'Even load, because ranges auto-split as they grow',
        'All inserts land on the range holding the highest IDs, making one node hot despite splits',
        'Frequent cross-range transactions because each insert touches two ranges',
        'Reads become slow but writes are unaffected',
      ],
      correct: [1],
      explanation:
        'Monotonic keys under range partitioning always append to the last range; auto-splitting just creates a new "last range" that is again the only one receiving writes. Fixes are hash-sharded indexes, a hash prefix, or keying by (device_id, ts). Auto-split balances storage, not a write hotspot at the tail; single-row inserts don\'t span ranges.',
      followUps: [
        {
          "q": "You switch to a hash-sharded primary key. Writes are now even, but the dashboard query \"readings for device D in the last hour\" got slow. Why, and what's the fix?",
          "a": "Hashing the reading_id scatters a device's readings across all ranges, so a per-device time query becomes a scan of every range plus a filter. Key the table by what you query: primary key `(device_id, ts)`, optionally with a hash bucket prefix on `device_id`. Writes spread across devices (200K/s over many devices), and one device's last hour is a single contiguous range scan. If one device is extremely chatty, add a time bucket to its key so its own range doesn't become the hotspot."
        },
        {
          "q": "How would you detect this tail hotspot from metrics before ingest latency complains?",
          "a": "Look at per-range or per-node write QPS, not cluster averages: in CockroachDB the Hot Ranges page or `crdb_internal.hot_ranges` shows one range taking most QPS, and per-node CPU shows one node at 90% while others idle. A tell-tale sign is that the hottest range ID keeps changing after each split while the share stays near 100%. Alert on max/avg node write QPS > 2× and on ingest latency p99 per node. Also run a load test with production-shaped keys before launch."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-05',
      difficulty: 'expert',
      question:
        'Orders are sharded by customer_id. Which requirements can be served as single-shard operations? Select ALL that apply.',
      options: [
        'List a customer\'s last 20 orders, newest first',
        'Atomically create an order and its line items (line items sharded by customer_id, co-located)',
        'Enforce that coupon_code is globally unique across all orders',
        'Show a merchant all orders for their store today',
        'Cancel an order and write its refund row, both keyed by the same customer_id',
      ],
      correct: [0, 1, 4],
      explanation:
        'Anything scoped to one customer_id with co-located tables routes to one shard, including multi-row ACID transactions. Global uniqueness across shards needs a separate uniqueness table/index sharded by coupon_code (or a distributed transaction), and merchant queries need scatter-gather or a merchant-keyed read model. These are exactly the "second access path" costs of the chosen shard key.',
      followUps: [
        {
          "q": "Marketing now wants \"top 10 customers by spend this month\" refreshed every 5 minutes. How do you serve it without hitting all shards each time?",
          "a": "Don't scatter-gather on demand. Each shard can answer its local top 10 cheaply, and a global top 10 is the top 10 of those merged lists, so a job every 5 minutes runs 64 small queries in parallel and merges ~640 rows. Better: stream order events via CDC into a per-month spend aggregate (Flink, or a Redis sorted set with `ZINCRBY customer:spend:2026-10`) and read `ZREVRANGE 0 9`. Either way the OLTP shards see constant, small work regardless of how often marketing refreshes."
        },
        {
          "q": "A customer can now share a cart with a friend and check out together, touching two customer_ids on different shards. How do you keep it atomic?",
          "a": "It's no longer single-shard, so choose: a saga or outbox, where you create the order on the payer's shard, emit an event and have the other side apply idempotently, with compensation (cancel) if it fails. Or use two-phase commit across both shards (Postgres `PREPARE TRANSACTION`), which is atomic but blocks if the coordinator dies mid-way and needs a recovery process. Usually the cleanest answer is to reshape the model: the order belongs to the payer's customer_id, and the friend's shard only gets an async reference."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-06',
      difficulty: 'hard',
      question:
        'This router has been in production for a year on 4 shards. What is the most serious latent bug?',
      code: {
        language: 'typescript',
        code: `function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h | 0;
}
export const shardFor = (userId: string) => shards[hash(userId) % shards.length];`,
      },
      options: [
        'The hash is too slow for hot paths; md5 would be faster',
        'String hashing is non-deterministic across Node restarts',
        'For negative hashes, % returns a negative index, so some users get undefined and their requests fail',
        'charCodeAt breaks for emoji, so those users go to the wrong shard',
      ],
      correct: [2],
      explanation:
        'The 32-bit hash is frequently negative and JavaScript\'s % keeps the sign of the dividend, so shards[-3] is undefined — a subset of users always fails (and a Go service using a different modulo semantics would route them elsewhere). This hash is deterministic across restarts, fast, and handles UTF-16 code units consistently; the deeper design issue is also modulo over physical shards.',
      followUps: [
        {
          "q": "You fix it with `Math.abs(hash) % n`. Is that fully correct, and will existing users still land on the same shard?",
          "a": "Not fully: `Math.abs(-2147483648)` is 2147483648, which `| 0` turns back into a negative, so one hash value still breaks (use `(h >>> 0) % n` for an unsigned 32-bit value). Routing changes only for keys with a negative hash. Those users always hit `undefined` and failed, so they have no data on any shard and nothing needs moving. A negative hash with remainder 0 is `-0`, which indexes as `shards[0]`, and `abs` keeps it at 0. Positive-hash users are unchanged. Prove it with a dry-run diff over all existing user ids before deploying."
        },
        {
          "q": "The Go services compute the shard with their own hash function. How do you prove both languages route identically, and keep it that way?",
          "a": "Create a shared golden test vector: a file of ~10K keys (ASCII, emoji, empty string, long strings, keys with negative hashes) with expected slot numbers, generated once from a spec. Every implementation's CI runs it and fails on any mismatch. Prefer a hash that is defined over bytes (md5, xxHash64, murmur3 on UTF-8), not language string semantics like UTF-16 `charCodeAt` versus Go's byte-wise iteration. In production, log a sampled checksum of routing decisions per service and alert on disagreement."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-07',
      difficulty: 'expert',
      question:
        'A post goes viral: 60K like-increments/s all hit `UPDATE posts SET likes = likes + 1 WHERE id = 42` on one shard. Which changes actually reduce the load on that shard? Select ALL that apply.',
      options: [
        'Split the shard holding post 42 into two shards',
        'Buffer increments in a stream processor and flush likes = likes + N once per second',
        'Split the counter into 32 salted sub-counters summed on read',
        'Switch the counter update to SELECT ... FOR UPDATE then UPDATE to avoid lost updates',
        'Increase the connection pool size on the API pods',
      ],
      correct: [1, 2],
      explanation:
        'A single hot row lives in exactly one place, so splitting the shard doesn\'t divide its load. Batching collapses 60K updates/s into ~1/s, and salting spreads writes across 32 rows (which can be placed on different shards). FOR UPDATE adds locking overhead — the atomic increment is already safe — and more connections increase lock contention on the same row rather than relieving it.',
      followUps: [
        {
          "q": "You batch increments in a stream processor and flush once per second. The processor crashes after flushing but before committing its Kafka offset. What happens to the count?",
          "a": "On restart it re-reads the uncommitted events and flushes them again, so the counter double-counts that batch (up to ~60K likes). Make the flush idempotent: write `likes = likes + N` and a `last_applied_offset` for that partition in the same DB transaction, and skip batches whose offset is ≤ the stored one. Alternatively, use Kafka transactions or Flink's exactly-once sink, which commit output and offsets atomically. Like counts can tolerate small error; money counters cannot."
        },
        {
          "q": "Users expect the like count to update instantly on screen. How do you square that with a 1 s batched counter?",
          "a": "The client updates optimistically: it shows count + 1 and a filled heart immediately after the API accepts the like. Other viewers see a count up to ~1–2 s stale, which nobody notices on a viral post showing \"1.2M\". The API acknowledges the like only after it is durably enqueued (Kafka acks=all), so it isn't lost, and the per-user \"liked\" state is a separate row keyed by (user, post) on the user's shard, so their own view stays consistent."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-08',
      difficulty: 'hard',
      question:
        'A "top 20 newest orders across all merchants" query scatters to 64 shards; each shard has p99 = 25 ms. What best describes the request p99?',
      options: [
        'Well above 25 ms: nearly half of requests include at least one shard in its p99 tail, so request p99 tracks the shards\' p99.9+',
        'About 25 ms × 64 = 1.6 s, because results must be merged',
        'About 25 ms, because the shards are queried in parallel',
        'Lower than 25 ms, because each shard returns only 20 rows',
      ],
      correct: [0],
      explanation:
        'A fan-out request is as slow as its slowest leg. The chance at least one of 64 legs exceeds its p99 is 1 − 0.99^64 ≈ 47%, so the request\'s p99 is governed by the shards\' extreme tail (p99.9+). Parallelism prevents the ×64 sum, but not the tail amplification; returning few rows doesn\'t change leg latency. Mitigations: hedged requests, per-shard timeouts with partial results, or avoiding fan-out.',
      followUps: [
        {
          "q": "Product insists the query must return in < 100 ms at p99 across 64 shards. What do you change?",
          "a": "Avoid the fan-out for a global \"newest\" view: maintain a small global feed table or Redis sorted set of the latest ~1,000 order ids (written via CDC or the outbox), so the query becomes one read of ~1 ms. If fan-out must stay, set a per-shard timeout (~60 ms) and return partial results from shards that answered, hedge slow legs by sending a duplicate to a replica after the p95 (~20 ms), and cap concurrency so one request doesn't queue behind itself."
        },
        {
          "q": "With hedged requests to replicas, what new problem do you create, and how do you bound it?",
          "a": "Extra load and possible staleness. If you hedge at the p95, about 5% of legs are duplicated, so 64 legs per request add ~3 extra queries, fine. But during a real slowdown every leg crosses the hedge threshold and load doubles exactly when the cluster is struggling. Cap hedges with a token bucket (e.g. hedges ≤ 5% of primary requests) and disable them when error rates rise. Replica answers may also lag by seconds, acceptable for \"newest orders\" but not for read-your-writes paths."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-09',
      difficulty: 'expert',
      question:
        'During a migration, the team starts a full backfill at 01:00 (snapshot read), then enables CDC streaming at 03:00 from the current binlog position. Backfill finishes at 05:00. What is the consequence?',
      options: [
        'None, as long as the backfill uses ON CONFLICT DO UPDATE',
        'CDC will replay the entire table from the beginning, doubling the data',
        'Duplicate rows appear in the new store for every write made during the backfill',
        'Writes committed between the snapshot point (01:00) and 03:00 that touched already-copied rows are never applied to the new store',
      ],
      correct: [3],
      explanation:
        'Rows copied early reflect their 01:00 state; changes made to them before streaming began at 03:00 are neither in the snapshot nor in the stream, so they are lost. Upserts make replays safe but cannot recover changes that were never captured. Primary-key upserts prevent duplicates, and CDC starting from a current position does not replay history. Always start capture before (or atomically with) the snapshot position.',
      followUps: [
        {
          "q": "Spell out the correct order of operations for snapshot + CDC, and how the new store converges.",
          "a": "1) Create the replication slot or record the binlog position first (with Postgres logical replication, `CREATE_REPLICATION_SLOT ... EXPORT_SNAPSHOT` gives a slot and a snapshot at the same LSN). 2) Copy the table from that snapshot. 3) Stream changes from that LSN onward through a version-guarded upsert. Every change after the snapshot is captured, and changes applied twice converge because the applier is idempotent and ordered per key. Debezium's incremental snapshots achieve this by interleaving chunk reads with the stream using watermarks."
        },
        {
          "q": "The migration already happened the wrong way. How do you find and repair the rows that were lost between 01:00 and 03:00?",
          "a": "You know the window, so diff it: find rows on the source with `updated_at BETWEEN '01:00' AND '03:00'` (if that column is trustworthy) and re-copy them with a version-guarded upsert. Since `updated_at` can't capture deletes, also run a full chunked checksum comparison: hash `(id, status, total, ...)` per 10K-id range on both sides, re-copy only mismatched ranges, and repeat until zero diffs. Deleted rows show up as present-on-target only; delete or tombstone them."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-10',
      difficulty: 'medium',
      question:
        'An e-commerce team moves catalog, users and orders into three separate databases owned by three services. Which statement is most accurate?',
      options: [
        'This is horizontal sharding; each DB holds a subset of rows',
        'This is federation; it reduces per-DB load but cross-domain joins must become API composition or read models',
        'This is vertical scaling; it only helps if the new DBs have bigger instances',
        'This is a cell architecture; each DB serves a subset of tenants',
      ],
      correct: [1],
      explanation:
        'Splitting by domain/table is federation (functional partitioning). It cuts load per database and aligns with service ownership, but SQL joins across domains disappear. Sharding splits rows of the same table; vertical scaling means a bigger machine; cells split tenants across whole copies of the stack.',
      followUps: [
        {
          "q": "The checkout page used to join users, catalog and orders in one SQL query. What does it look like after federation, and what's the latency cost?",
          "a": "It becomes API composition: the checkout service calls the users service and catalog service (in parallel) and its own orders DB, then merges. Latency is the slowest call plus a network hop, so a 5 ms join becomes ~15–30 ms with p99 driven by the slowest dependency. For hot paths, keep a local read model: the orders service stores a denormalised copy of product name and price at order time (which you want anyway, since prices change), fed by catalog events."
        },
        {
          "q": "Now you need \"place order and decrement stock\" atomically, but stock lives in the catalog DB. What do you do?",
          "a": "The DB transaction can't span both. Use a reservation saga: the orders service creates a PENDING order and emits an event via the transactional outbox; the catalog service reserves stock with a conditional update (`qty >= n`) and replies; the order is confirmed or cancelled. Reservations expire after N minutes if payment never arrives. Alternatively, move stock ownership next to orders if they always change together; federation boundaries should follow transaction boundaries."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-11',
      difficulty: 'expert',
      question:
        'Two pods run this generator and both happened to receive worker ID 7 due to a config bug. What happens?',
      code: {
        language: 'typescript',
        code: `const id = ((BigInt(Date.now()) - EPOCH) << 22n) | (WORKER << 12n) | seq;
// seq resets to 0 each new millisecond, increments within the same ms`,
      },
      options: [
        'IDs collide whenever both pods generate in the same millisecond with the same sequence number — frequent under load',
        'Nothing: Date.now() differs between pods so collisions are impossible',
        'Only the sign bit is affected, so IDs become negative',
        'Collisions happen only after the 41-bit timestamp wraps around in ~69 years',
      ],
      correct: [0],
      explanation:
        'Uniqueness rests on (timestamp, worker, sequence). With identical worker IDs, any two IDs minted in the same millisecond with the same sequence — very likely for seq = 0 under load — are identical, causing PK violations or silent overwrites. Pods share wall-clock milliseconds; the sign bit and timestamp wrap are unrelated. Assign worker IDs with leases or StatefulSet ordinals.',
      followUps: [
        {
          "q": "How would you assign worker IDs in Kubernetes so this can't happen again, even during rolling deploys?",
          "a": "Use a lease: on startup, each pod claims a free ID from 0–1023 in etcd, Consul or a DB table with a TTL (say 30 s), renewing every 10 s, and refuses to generate IDs unless it holds the lease. During a rolling deploy the new pod gets a different free ID, while the old pod still holds its own until it exits. StatefulSet ordinals also work, but only if the ordinal is unique across all clusters and regions using the same ID space, so prefix with a region or cluster bits."
        },
        {
          "q": "The node's clock jumps back 2 seconds after an NTP correction. What does your generator do?",
          "a": "Naively, it reissues timestamps it already used, and with the same worker ID and sequence that creates duplicate IDs. Track `lastTimestamp`: if `now < lastTimestamp`, either wait until the clock catches up (fine for small skews of a few ms) or refuse and fail loudly for large jumps. A 2 s wait is a stall. Alternatively, keep using `lastTimestamp` and borrow from the sequence until real time passes it. Run NTP with slewing (chrony) so steps backwards are rare, and alert on detected regressions."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-12',
      difficulty: 'hard',
      question:
        'You add a global secondary index on email (index table sharded by email) that is updated asynchronously via CDC. Which behaviours must the application tolerate? Select ALL that apply.',
      options: [
        'A user who just changed their email may not be found by the new email for a short time',
        'The index can briefly return a user_id whose row no longer has that email',
        'Writes to the base table become distributed transactions and slower',
        'Two users could briefly both appear to own the same email if uniqueness is only checked via the index',
      ],
      correct: [0, 1, 3],
      explanation:
        'An async global index lags the base table, so lookups can miss new values, return stale mappings (re-check against the base row), and cannot enforce uniqueness by itself — use a synchronous reservation row keyed by email for that. Making writes distributed transactions is the cost of a *synchronous* global index, which is exactly what the async design avoids.',
      followUps: [
        {
          "q": "You add a synchronous email reservation table to enforce uniqueness. A user changes their email from a@x to b@x. Walk through the writes and what happens if the process dies mid-way.",
          "a": "Steps: 1) insert reservation `b@x → user` (fails if taken), 2) update the user row's email on the user's shard, 3) delete reservation `a@x`. These are on different shards, so no single transaction. Crash after 1: b@x is reserved but unused, so a cleanup job removes reservations whose user row doesn't point back after a grace period. Crash after 2: a@x stays reserved, so nobody can take the old email until cleanup. Order matters: reserve first and release last, so you never have zero owners or two owners."
        },
        {
          "q": "How do you measure how stale the async index is, and what lag would you alert on?",
          "a": "Measure CDC consumer lag: the timestamp of the last applied source change versus now, plus Kafka consumer-group lag in messages. Better, write a heartbeat row on each base shard every second and track when it appears in the index table; that end-to-end latency is what users experience. Typical healthy lag is under 1 s; alert at 30 s and page at a few minutes. Track the re-check miss rate too (index hit but base row disagreed), which shows how often staleness actually bites."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-13',
      difficulty: 'medium',
      question:
        'A multi-tenant SaaS uses hash(tenant_id) over 4,096 slots mapped to 10 clusters. One enterprise tenant generates 25% of all writes. What is the most effective remedy?',
      options: [
        'Increase logical slots to 65,536 so the tenant spreads out',
        'Change the hash function to xxHash for better distribution',
        'Add a directory override placing that tenant on a dedicated cluster (and sub-shard it internally if it outgrows one)',
        'Add read replicas to the tenant\'s current cluster',
      ],
      correct: [2],
      explanation:
        'All rows of one tenant share one tenant_id, so they hash to the same slot no matter how many slots or which hash function — the skew is in the data, not the hash. Replicas help reads, not a write hotspot. A directory override isolates the whale (and its noisy-neighbour effect); if needed, shard within the tenant by a second-level key.',
      followUps: [
        {
          "q": "You move the whale to its own cluster with a directory override. How do the routers learn about the override, and what happens to in-flight writes during the move?",
          "a": "The override is a versioned entry in the shard map (`tenant 812 → cluster-W`) stored in etcd or the config service, and every router watches it and applies newer versions only. The move itself: copy the tenant's rows via CDC to cluster-W, wait for lag ≈ 0, mark the tenant read-only (writes get a retriable error for a few seconds), drain lag to zero, publish map version N+1, then unfence. Routers that are still on version N and send writes to the old cluster are rejected by the fence, retry and pick up the new map."
        },
        {
          "q": "Two more customers are growing toward whale size. How do you detect that before they hurt their neighbours?",
          "a": "Track per-tenant resource usage, not just per-cluster: rows written per minute, query time from `pg_stat_statements` with a tenant tag (via `application_name` or SQL comments), and storage per tenant. Alert when any tenant exceeds ~10% of its cluster's write load or storage, or grows > 10%/week. Combined with rebalancing tools, that lets you move them proactively during quiet hours instead of in an incident. Rate limits per tenant at the API also cap sudden bursts."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-14',
      difficulty: 'expert',
      question:
        'This applier consumes CDC events (possibly redelivered, possibly after a backfill has inserted a newer version). What is wrong?',
      code: {
        language: 'sql',
        code: `INSERT INTO orders (id, status, version)
VALUES ($1, $2, $3)
ON CONFLICT (id) DO UPDATE
SET status = EXCLUDED.status, version = EXCLUDED.version;`,
      },
      options: [
        'Nothing; ON CONFLICT makes it idempotent and therefore correct',
        'It should use INSERT ... ON CONFLICT DO NOTHING so the first write wins',
        'ON CONFLICT cannot be used on sharded tables',
        'A redelivered or older event overwrites a newer row; it needs WHERE orders.version < EXCLUDED.version',
      ],
      correct: [3],
      explanation:
        'Idempotent (same event twice = same result) is not the same as order-safe: replaying an old event after a newer one regresses the row. A version guard in the DO UPDATE WHERE clause makes the upsert monotonic, so snapshot rows and stream events commute. DO NOTHING would freeze stale backfill data and drop real updates; ON CONFLICT works fine per shard.',
      followUps: [
        {
          "q": "Where does `version` come from, and why can't it be the source row's `updated_at`?",
          "a": "It must be monotonic per row in commit order: a binlog position or Postgres LSN of the change, or a version column incremented in the same UPDATE (`version = version + 1`). `updated_at` comes from the app server's clock: two writes in the same millisecond tie, clocks on different app servers skew, and a transaction can set `updated_at` before a concurrent one but commit after it. The guard then keeps the wrong row. Log position is defined by the database, so it can't disagree with the commit order."
        },
        {
          "q": "A CDC delete event arrives, and then a delayed backfill row for the same id arrives with an older version. What does your applier do?",
          "a": "If the delete physically removes the row, the stale backfill insert finds no conflict and resurrects the order, a classic bug. Keep a tombstone instead: `UPDATE ... SET deleted = true, version = $v`, so the later backfill row conflicts and loses the `WHERE orders.version < EXCLUDED.version` check. Purge tombstones only after the backfill is finished and the stream has passed a safe point. Readers filter `deleted = false` meanwhile."
        }
      ],
    },
    {
      id: 'db-sharding-mcq-15',
      difficulty: 'expert',
      question:
        'A Vitess keyspace is being resharded from shard "-80" into "-40" and "40-80". Which statements about the Reshard workflow are true? Select ALL that apply.',
      options: [
        'VReplication copies existing rows and then streams binlog changes into the target shards',
        'Traffic is switched with SwitchTraffic, typically replicas/rdonly first, then primaries',
        'All application servers must be redeployed with the new shard list before cutover',
        'The workflow can be rolled back with ReverseTraffic, which relies on reverse replication set up at switch time',
      ],
      correct: [0, 1, 3],
      explanation:
        'Vitess reshards via VReplication (copy phase then binlog streaming), switches read then write traffic, and sets up reverse replication so ReverseTraffic can roll back. Applications talk to VTGate, which routes via the topology service and vindexes, so no application redeploy is needed — that transparency is a major reason to use a proxy-based sharding layer.',
      followUps: [
        {
          "q": "Mid-way through the copy phase, the target shard's primary fails. What does VReplication do, and do you start over?",
          "a": "VReplication keeps its progress (the copy cursor of the last copied PK per table, and the binlog position) in the `_vt.vreplication` table on the target. After a failover to the target's replica, which has that table replicated, the workflow resumes from the stored position rather than restarting. You may see a pause and need to restart the workflow with `vtctldclient Workflow start`. Before SwitchTraffic, run `VDiff` to confirm source and target match after any incident."
        },
        {
          "q": "After SwitchTraffic on primaries, error rates rise on the new shards. How fast can you roll back, and what data is at risk?",
          "a": "ReverseTraffic flips writes back to the old shard, typically in seconds, because reverse VReplication has been streaming every write made on the new shards back to `-80` since the switch. No data is lost as long as reverse replication was keeping up, so check its lag first. Writes in flight during the switch get brief errors and retry through VTGate. Keep the old shard and reverse stream until a bake period passes, and only then run `Complete` to clean up."
        }
      ],
    },
  ],
};

export default topic;
