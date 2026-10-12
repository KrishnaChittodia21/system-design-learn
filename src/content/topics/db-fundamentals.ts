import type { Topic } from '../../types';

const topic: Topic = {
  id: 'db-fundamentals',
  phase: 'databases',
  order: 1,
  title: 'SQL vs NoSQL, Data Models, ACID & Isolation',
  subtitle:
    'Relational, document, key-value, wide-column, graph and time-series models; normalization trade-offs; transactions, ACID vs BASE; isolation levels, anomalies and MVCC; choosing a database.',
  estimatedMinutes: 110,
  sources: [
    'Alex Xu — System Design Interview Vol 2, Ch 7 Hotel Reservation System (schema, concurrency)',
    'Alex Xu — System Design Interview Vol 2, Ch 5 Metrics Monitoring (time-series data model)',
    'Martin Kleppmann — Designing Data-Intensive Applications, Ch 2 & 7',
    'PostgreSQL 16 docs — Transaction Isolation (13.2) and MVCC',
  ],
  tags: ['sql', 'nosql', 'data-modeling', 'acid', 'base', 'isolation', 'mvcc', 'cassandra', 'dynamodb', 'mongodb', 'postgres'],
  cheatSheet: [
    'Pick the model from the access pattern: relational for ad-hoc queries + invariants, document for aggregate-shaped reads, KV for lookups by key, wide-column for massive write-heavy partitioned queries, graph for multi-hop traversal, time-series for append-only metrics.',
    'Wide-column/DynamoDB rule: design tables per query — partition key spreads load and must be in every query; clustering/sort key orders rows within a partition; keep partitions < ~100 MB (Cassandra guidance) and avoid hot keys.',
    'Normalize for write correctness (one fact in one place); denormalize for read speed — and then own the fan-out/consistency of every copy.',
    'ACID: Atomicity = all-or-nothing (undo/WAL), Consistency = app invariants hold (your constraints), Isolation = concurrency control, Durability = fsynced WAL. BASE = basically available, soft state, eventually consistent.',
    'Anomalies ladder: dirty read → non-repeatable read → phantom → lost update / write skew. Postgres Read Committed (default) allows non-repeatable reads, phantoms, lost updates and write skew.',
    'Postgres REPEATABLE READ = snapshot isolation: no phantoms, lost updates abort with serialization error, but write skew still possible. Only SERIALIZABLE (SSI) prevents write skew — and requires retry on SQLSTATE 40001.',
    'MySQL InnoDB default is REPEATABLE READ; plain SELECTs read a snapshot, but UPDATE/locking reads see the latest committed row — so read-modify-write in app code can still lose updates.',
    'Fix lost updates with atomic UPDATE ... SET x = x + 1, SELECT ... FOR UPDATE, optimistic version columns, or SERIALIZABLE + retry.',
    'MVCC: readers never block writers; each row version has xmin/xmax; old versions are cleaned by VACUUM — long transactions block cleanup and cause bloat.',
    'Typical single-node numbers: Postgres 10K–50K simple writes/s, Redis 100K+ ops/s per core, Cassandra ~10K+ writes/s per node linearly scalable, DynamoDB effectively unbounded with good key design.',
  ],
  sections: [
    {
      heading: 'The data model decides your future: start from access patterns',
      body: `**Intuition:** a database is a bet on how you will read and write data. Relational databases bet you do not know your queries yet; NoSQL stores bet you do, and reward you with scale for knowing.

**The six families**
| Model | Shape | Great at | Weak at | Examples |
|---|---|---|---|---|
| Relational | Tables, rows, foreign keys | Ad-hoc queries, joins, constraints, multi-row transactions | Horizontal write scaling (without sharding), schema-flexible data | PostgreSQL, MySQL, Aurora, Spanner, CockroachDB |
| Document | JSON trees per record | Aggregate-shaped reads (order + items in one doc), evolving schemas | Many-to-many joins, cross-document invariants | MongoDB, Couchbase, Firestore |
| Key-value | key → opaque blob | O(1) lookups at huge scale, caches, sessions | Queries by anything but key | Redis, DynamoDB (also document-ish), Memcached, etcd |
| Wide-column | Partition → sorted rows of columns | Massive write throughput, time-ordered queries per partition | Ad-hoc queries, joins, secondary access paths | Cassandra, ScyllaDB, HBase, Bigtable |
| Graph | Nodes + edges | Multi-hop traversals (friends-of-friends, fraud rings) | Bulk aggregation, horizontal partitioning | Neo4j, Neptune, JanusGraph |
| Time-series | (series, timestamp) → value | Append-heavy metrics, downsampling, range scans by time | Updates, random access by non-time keys | TimescaleDB, InfluxDB, Prometheus TSDB, ClickHouse (OLAP) |

**The interview method**
1. List the **top 3–5 queries** with QPS and latency targets.
2. List the **invariants** (no double booking, balance ≥ 0) and whether they span rows.
3. Estimate volume and growth (GB/day) and read/write ratio.
4. Choose the simplest model that satisfies all three; add specialised stores (search, cache, OLAP) as derived views.

**Say this:** "I default to Postgres until a requirement forces me off it — usually write throughput beyond a single primary, a multi-region write requirement, or a data shape like graphs or time-series. Polyglot persistence is fine, but every extra store is another thing to keep consistent."`,
      keyPoints: [
        'Access patterns + invariants + volume → model.',
        'Relational is the default because it tolerates unknown future queries.',
        'Specialised stores are usually derived views fed by CDC, not the source of truth.',
      ],
    },
    {
      heading: 'Relational model and why normalization exists',
      body: `**Intuition:** normalization means "store each fact exactly once". If a customer's email lives in one row, changing it is one write and can never be half-updated.

**Normal forms in practice**
- **1NF:** atomic columns, no repeating groups (no \`item1, item2, item3\` columns).
- **2NF/3NF:** every non-key column depends on the key, the whole key, and nothing but the key — e.g. \`order.customer_email\` violates 3NF because it depends on \`customer_id\`.
- Most OLTP schemas target 3NF, then denormalize deliberately.

**Denormalization is a read optimisation with a write cost**
| | Normalized | Denormalized |
|---|---|---|
| Writes | One place, trivially consistent | Fan-out to every copy; risk of drift |
| Reads | Joins (cheap when indexed, expensive at scale/distributed) | Single lookup |
| Storage | Minimal | Duplicated |
| Typical use | OLTP source of truth | Read models, feeds, search docs, NoSQL tables, reporting |

**Good denormalizations:** snapshotting values that *should not change* (price at purchase time in \`order_items\`), counters (\`post.like_count\`) maintained atomically, read models built from events.
**Bad denormalizations:** copying mutable user profile fields into 10 tables without a propagation mechanism.

**Constraints are your cheapest correctness tool:** \`UNIQUE\`, \`CHECK\`, \`FOREIGN KEY\`, and exclusion constraints enforce invariants under any concurrency level, because the database checks them atomically.`,
      code: [
        {
          language: 'sql',
          title: 'Hotel booking schema: 3NF with deliberate snapshots and DB-enforced invariants',
          code: `CREATE TABLE hotel (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL
);

CREATE TABLE room_type_inventory (
  hotel_id      bigint NOT NULL REFERENCES hotel(id),
  room_type_id  bigint NOT NULL,
  date          date   NOT NULL,
  total         int    NOT NULL,
  reserved      int    NOT NULL DEFAULT 0,
  PRIMARY KEY (hotel_id, room_type_id, date),
  CHECK (reserved >= 0 AND reserved <= total)   -- invariant: never overbook
);

CREATE TABLE reservation (
  id              uuid PRIMARY KEY,               -- client-generated: idempotency key
  hotel_id        bigint NOT NULL REFERENCES hotel(id),
  room_type_id    bigint NOT NULL,
  guest_id        bigint NOT NULL,
  check_in        date NOT NULL,
  check_out       date NOT NULL,
  price_per_night numeric(12,2) NOT NULL,         -- snapshot: price must not change later
  status          text NOT NULL CHECK (status IN ('pending','paid','cancelled')),
  CHECK (check_out > check_in)
);

-- Reserve atomically: the CHECK constraint rejects overbooking even under races
UPDATE room_type_inventory
   SET reserved = reserved + 1
 WHERE hotel_id = $1 AND room_type_id = $2
   AND date >= $3 AND date < $4;`,
        },
      ],
      keyPoints: [
        '3NF for the source of truth; denormalize only with a propagation plan.',
        'Snapshot values that must not change retroactively (price at purchase).',
        'CHECK/UNIQUE/FK constraints hold regardless of isolation level.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 7 Hotel Reservation System',
    },
    {
      heading: 'Document databases: model the aggregate',
      body: `**Intuition:** a document is the object you load on one screen — an order with its line items and shipping address. If you always read it together, store it together.

**When documents shine**
- One-to-many relationships that are **owned** and **bounded**: order → items, blog post → sections, product → variants.
- Heterogeneous attributes (a TV and a T-shirt have different spec fields).
- Read = single document fetch by id, ~1–2 ms.

**When they hurt**
- **Unbounded arrays:** embedding all comments in a post doc hits MongoDB's 16 MB document limit and makes every update rewrite a huge doc. Use a separate collection keyed by \`post_id\` (the "bucket" or "reference" pattern).
- **Many-to-many:** authors ↔ books with independent lifecycles → references + \`$lookup\`, which is a join without the optimiser maturity of SQL.
- **Cross-document invariants:** MongoDB has multi-document ACID transactions since 4.0 (replica sets) / 4.2 (sharded), but they are slower and have a default 60 s lifetime limit — design so most writes touch one document (single-document writes are atomic).

**Embed vs reference rule of thumb**
| Embed when | Reference when |
|---|---|
| Child is read with parent almost always | Child is read independently |
| Bounded count (tens to low hundreds) | Unbounded growth |
| Child has no independent lifecycle | Shared across parents (many-to-many) |
| Updated together | Updated at very different rates |

**Postgres JSONB** gives you document flexibility inside a relational DB, with GIN indexing — often the pragmatic answer for "some fields are dynamic".`,
      code: [
        {
          language: 'typescript',
          title: 'MongoDB order aggregate: embed bounded items, reference the customer, atomic single-doc update',
          code: `import { MongoClient, ObjectId } from 'mongodb';

interface OrderItem { sku: string; qty: number; unitPrice: number }
interface Order {
  _id: ObjectId;
  customerId: ObjectId;              // reference: customer has its own lifecycle
  status: 'created' | 'paid' | 'shipped';
  items: OrderItem[];                // embedded: bounded, always read together
  shipping: { city: string; pin: string };
  total: number;
  version: number;                   // optimistic concurrency
}

const client = new MongoClient(process.env.MONGO_URL!);
const orders = client.db('shop').collection<Order>('orders');

export async function addItem(orderId: ObjectId, item: OrderItem, expectedVersion: number) {
  // Single-document update is atomic: items and total change together
  const res = await orders.updateOne(
    { _id: orderId, status: 'created', version: expectedVersion },
    {
      $push: { items: item },
      $inc: { total: item.qty * item.unitPrice, version: 1 },
    },
  );
  if (res.matchedCount === 0) throw new Error('conflict: order changed or already paid');
}`,
        },
      ],
      keyPoints: [
        'Embed bounded, owned, co-read children; reference unbounded or shared ones.',
        'Single-document writes are atomic — design so invariants live inside one document.',
        'Postgres JSONB covers many "we need flexible schema" cases without a new database.',
      ],
    },
    {
      heading: 'Key-value and wide-column: model by query',
      body: `**Intuition:** in Cassandra or DynamoDB you do not design tables around entities — you design a table per question you will ask. Joins do not exist, so you pre-join at write time.

**Cassandra primary key anatomy**
\`PRIMARY KEY ((partition_key_cols), clustering_col1, clustering_col2)\`
- **Partition key** → hashed to a token → decides which nodes own the data. Every query must specify it fully (equality).
- **Clustering columns** → sort order *within* the partition; allow range queries (\`ts > ?\`) and \`ORDER BY\` only in clustering order.
- Keep partitions bounded: a common guideline is < ~100 MB and < ~100K rows. Use **time bucketing** (e.g. \`(sensor_id, day)\`) to bound growth.

**Writes are cheap, reads must be designed:** Cassandra writes go to commit log + memtable (LSM), ~sub-ms at the node; a single node sustains ~10K+ writes/s and clusters scale linearly. A query without the partition key needs \`ALLOW FILTERING\` — a cluster-wide scan and an interview red flag.

**DynamoDB equivalent:** partition key + sort key; single-table design with overloaded keys (\`PK=USER#42\`, \`SK=ORDER#2026-09-01#9f3\`); GSIs for alternative access paths (eventually consistent, billed separately). Each partition supports up to ~3,000 RCU / 1,000 WCU, so hot keys throttle even when table capacity is plenty.

**Chat example (Discord-style) — "fetch the latest 50 messages in a channel"**
- Partition \`(channel_id, bucket)\` where bucket = 10-day window; clustering \`message_id DESC\` (time-ordered Snowflake id).
- Latest page = one partition read, sequential on disk.
- "Messages by user" is a *different query* → a different table written at the same time (or a search index).`,
      code: [
        {
          language: 'sql',
          title: 'CQL: one table per query, bucketed partitions, clustering order',
          code: `-- Q1: latest messages in a channel (hot path, ~100K reads/s)
CREATE TABLE messages_by_channel (
  channel_id  bigint,
  bucket      int,            -- floor(epoch_days / 10): bounds partition size
  message_id  bigint,         -- Snowflake: time-ordered, unique
  author_id   bigint,
  body        text,
  PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC)
  AND compaction = {'class': 'TimeWindowCompactionStrategy',
                    'compaction_window_unit': 'DAYS', 'compaction_window_size': 1};

SELECT message_id, author_id, body
  FROM messages_by_channel
 WHERE channel_id = 42 AND bucket = 2051
 LIMIT 50;                                   -- single-partition, pre-sorted read

-- Q2: a user's recent messages (moderation) -> separate, denormalized table
CREATE TABLE messages_by_author (
  author_id   bigint,
  month       int,
  message_id  bigint,
  channel_id  bigint,
  PRIMARY KEY ((author_id, month), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);

-- Anti-pattern: full cluster scan
-- SELECT * FROM messages_by_channel WHERE author_id = 7 ALLOW FILTERING;`,
        },
      ],
      keyPoints: [
        'Partition key = distribution + mandatory equality filter; clustering key = sort + range.',
        'Bucket by time to bound partitions; one table per query; write to all of them.',
        'DynamoDB per-partition limits (~3K RCU / 1K WCU) make key design a throughput decision.',
      ],
    },
    {
      heading: 'Graph and time-series models',
      body: `**Graph — intuition:** when the question is about *paths* ("friends of friends who like X", "accounts sharing a device with a known fraudster within 3 hops"), a graph database follows pointers instead of doing repeated self-joins.

- Relational: each hop is a join; a 3-hop traversal on a social graph with average degree 200 touches 200³ = 8M rows — recursive CTEs work for small graphs but degrade quickly.
- Native graph stores (index-free adjacency) make each hop proportional to the edges actually visited.
- Weaknesses: hard to partition (edges cross partitions), weaker for bulk aggregation. At Facebook scale, the social graph lives in **TAO** (a graph API over sharded MySQL + cache), not a general graph DB.
- Use graph DBs for fraud, recommendations, knowledge graphs, access-control graphs (e.g. Zanzibar-style relationship checks have their own specialised stores).

**Time-series — intuition:** metrics are append-only, time-ordered, queried by time range, and lose value with age.
- Model: series identity = metric name + tag set (\`cpu{host=a,region=in}\`), points = (ts, value).
- Storage tricks: columnar layout, delta-of-delta timestamps + XOR float compression (Gorilla) → ~1.37 bytes/point in Facebook's paper vs 16 bytes raw.
- Retention + **downsampling**: raw 10 s data for 7 days, 1-min rollups for 30 days, 1-h rollups for a year.
- **Cardinality** is the killer: tagging by \`user_id\` creates millions of series and blows up memory in Prometheus/InfluxDB.
- TimescaleDB = Postgres with hypertables (time partitioning) — SQL plus time-series performance.`,
      code: [
        {
          language: 'sql',
          title: 'TimescaleDB: hypertable, continuous aggregate rollup and retention',
          code: `CREATE TABLE cpu_metrics (
  ts      timestamptz NOT NULL,
  host    text        NOT NULL,
  region  text        NOT NULL,
  usage   double precision NOT NULL
);
-- Partition into 1-day chunks automatically
SELECT create_hypertable('cpu_metrics', 'ts', chunk_time_interval => interval '1 day');

-- 1-minute rollup maintained incrementally
CREATE MATERIALIZED VIEW cpu_1m
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 minute', ts) AS bucket, host, region,
       avg(usage) AS avg_usage, max(usage) AS max_usage
  FROM cpu_metrics
 GROUP BY bucket, host, region;

-- Raw data kept 7 days; rollups kept longer
SELECT add_retention_policy('cpu_metrics', INTERVAL '7 days');
SELECT add_continuous_aggregate_policy('cpu_1m',
  start_offset => INTERVAL '1 hour', end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');

-- Dropping a whole chunk is O(1) metadata work, unlike DELETE of millions of rows`,
        },
      ],
      keyPoints: [
        'Graph DBs win at multi-hop traversal; they lose at partitioning and bulk aggregation.',
        'Time-series = append-only + compression + retention + downsampling; watch tag cardinality.',
        'Time partitioning makes retention a cheap chunk drop instead of a massive DELETE.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 5 Metrics Monitoring and Alerting System',
    },
    {
      heading: 'Transactions, ACID and BASE',
      body: `**Intuition:** a transaction is a promise that a group of changes happens entirely or not at all, and that concurrent users do not see each other's half-finished work.

**ACID, precisely**
- **Atomicity:** all-or-nothing on failure (rollback via WAL/undo). It is about *aborts*, not concurrency.
- **Consistency:** the application's invariants hold before and after — enforced by *your* constraints and code. The database only helps via constraints; the "C" is largely the app's responsibility.
- **Isolation:** concurrent transactions behave as if run in some order — to a degree set by the isolation level.
- **Durability:** once committed, it survives crashes — WAL fsynced to disk (and, in replicated setups, to replicas depending on \`synchronous_commit\`). An fsync on NVMe costs ~0.1–1 ms; group commit batches many transactions per fsync.

**BASE (typical of Dynamo-style NoSQL)**
- **Basically Available:** accept reads/writes even during partitions.
- **Soft state:** replicas may disagree temporarily.
- **Eventually consistent:** replicas converge when writes stop (via anti-entropy, read repair, hinted handoff).
- Tunable in practice: Cassandra \`QUORUM\` reads + writes (R + W > N) give read-your-latest-write for a single key; DynamoDB offers strongly consistent reads per request.

**It is no longer SQL = ACID vs NoSQL = BASE**
| System | Transactions |
|---|---|
| PostgreSQL / MySQL | Full multi-row ACID on a single node |
| MongoDB 4.2+ | Multi-document ACID (slower; keep short) |
| DynamoDB | TransactWriteItems — up to 100 items, ~2× cost |
| Cassandra | Lightweight transactions (Paxos) for compare-and-set on one partition, ~4 round trips |
| Spanner / CockroachDB | Distributed ACID with serializable isolation |

(Distributed transactions across services — 2PC, sagas — are covered in **ds-transactions**.)`,
      code: [
        {
          language: 'typescript',
          title: 'node-postgres transaction with guaranteed rollback and client release',
          code: `import { Pool, type PoolClient } from 'pg';

const pool = new Pool({ max: 20, statement_timeout: 5000 });

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');           // durability point: WAL flushed
    return result;
  } catch (err) {
    await client.query('ROLLBACK');         // atomicity: undo everything
    throw err;
  } finally {
    client.release();                       // never leak the connection
  }
}

// Transfer money: both rows change or neither does
export function transfer(from: string, to: string, cents: number) {
  return withTx(async (c) => {
    const debit = await c.query(
      'UPDATE account SET balance = balance - $1 WHERE id = $2 AND balance >= $1',
      [cents, from],
    );
    if (debit.rowCount !== 1) throw new Error('insufficient funds');
    await c.query('UPDATE account SET balance = balance + $1 WHERE id = $2', [cents, to]);
  });
}`,
        },
      ],
      keyPoints: [
        'Atomicity = abort safety; Isolation = concurrency safety — they are different guarantees.',
        'The "C" in ACID is mostly your constraints and code.',
        'Modern NoSQL often offers limited transactions; know their limits (items, partitions, latency).',
      ],
    },
    {
      heading: 'Isolation levels and the anomalies they allow',
      body: `**Intuition:** isolation levels are a menu of "how much can concurrent transactions step on each other". Weaker levels are faster and block less; stronger ones prevent more bugs but abort or wait more.

**The anomalies**
| Anomaly | What happens | Example |
|---|---|---|
| Dirty read | Read another tx's uncommitted write | See a balance that later rolls back |
| Non-repeatable read | Same row read twice returns different values | Report reads balance twice mid-transfer |
| Phantom | Same predicate query returns new/missing rows | \`COUNT(*) WHERE room=101 AND date=...\` changes |
| Lost update | Two read-modify-write cycles; one overwrites the other | Two likes both read 10, both write 11 |
| Write skew | Two txs read overlapping data, write *different* rows, jointly violating an invariant | Two doctors both go off-call; zero on call |

**What each level prevents (PostgreSQL behaviour)**
| Level | Dirty | Non-repeatable | Phantom | Lost update | Write skew |
|---|---|---|---|---|---|
| Read Uncommitted (= RC in PG) | prevented | possible | possible | possible | possible |
| Read Committed (**PG default**) | prevented | possible | possible | possible | possible |
| Repeatable Read (snapshot isolation) | prevented | prevented | prevented (PG) | prevented (aborts with 40001) | **possible** |
| Serializable (SSI) | prevented | prevented | prevented | prevented | prevented |

**Engine differences that bite**
- **MySQL InnoDB** defaults to REPEATABLE READ. Plain SELECTs read a consistent snapshot, but \`UPDATE\`, \`DELETE\` and \`SELECT ... FOR UPDATE\` operate on the *latest committed* rows and take next-key (gap) locks. InnoDB does **not** abort on concurrent update in RR, so an app-level read-then-write can still lose updates.
- **Oracle** "SERIALIZABLE" is actually snapshot isolation (write skew possible).
- **SQL Server** defaults to Read Committed with locking (readers can block writers) unless READ_COMMITTED_SNAPSHOT is enabled.

**Cost of SERIALIZABLE in Postgres:** SSI tracks read/write dependencies (predicate locks) and aborts one transaction in a dangerous cycle with SQLSTATE 40001. Throughput cost is often modest (low double-digit %) for short transactions, but you **must** implement retries.`,
      code: [
        {
          language: 'sql',
          title: 'Reproducing lost update (Read Committed) and write skew (Repeatable Read)',
          code: `-- LOST UPDATE at READ COMMITTED (two sessions, interleaved)
-- S1: BEGIN; SELECT likes FROM post WHERE id = 1;        -- 10
-- S2: BEGIN; SELECT likes FROM post WHERE id = 1;        -- 10
-- S1: UPDATE post SET likes = 11 WHERE id = 1; COMMIT;
-- S2: UPDATE post SET likes = 11 WHERE id = 1; COMMIT;   -- final 11, should be 12
-- Fix: UPDATE post SET likes = likes + 1 WHERE id = 1;   (atomic read-modify-write)

-- WRITE SKEW at REPEATABLE READ: invariant "at least one doctor on call"
-- S1: BEGIN ISOLATION LEVEL REPEATABLE READ;
-- S1: SELECT count(*) FROM doctor WHERE on_call AND shift_id = 7;   -- 2
-- S2: BEGIN ISOLATION LEVEL REPEATABLE READ;
-- S2: SELECT count(*) FROM doctor WHERE on_call AND shift_id = 7;   -- 2
-- S1: UPDATE doctor SET on_call = false WHERE id = 'alice'; COMMIT; -- ok
-- S2: UPDATE doctor SET on_call = false WHERE id = 'bob';   COMMIT; -- ok (!)
-- Result: 0 doctors on call. Different rows were written, so no write conflict.

-- Fix A: SERIALIZABLE -> one commit fails with SQLSTATE 40001; app retries
-- Fix B: materialize the conflict: lock the rows the decision depends on
BEGIN;
SELECT id FROM doctor WHERE on_call AND shift_id = 7 FOR UPDATE;  -- both sessions queue here
UPDATE doctor SET on_call = false WHERE id = 'alice';
COMMIT;`,
        },
      ],
      keyPoints: [
        'Postgres RC (default) allows lost updates and write skew.',
        'Snapshot isolation (PG RR, Oracle "serializable") still allows write skew.',
        'SERIALIZABLE requires retry loops on 40001; FOR UPDATE materialises the conflict instead.',
      ],
      source: 'PostgreSQL docs 13.2 Transaction Isolation; Kleppmann DDIA Ch 7',
    },
    {
      heading: 'MVCC: how readers and writers avoid blocking each other',
      body: `**Intuition:** instead of overwriting a row, the database writes a new version and keeps the old one around for anyone who started reading earlier. Each transaction sees the versions that were committed when its snapshot was taken.

**PostgreSQL mechanics**
- Each tuple has \`xmin\` (creating tx id) and \`xmax\` (deleting/updating tx id). An UPDATE = mark old tuple \`xmax\` + insert a new tuple.
- A snapshot = (xmin, xmax, in-progress list). Visibility check: version visible if created by a committed tx before my snapshot and not deleted by one.
- **Read Committed** takes a new snapshot per statement; **Repeatable Read/Serializable** take one snapshot per transaction.
- Readers never block writers and writers never block readers; **writers block writers** on the same row (row lock until commit).
- Old versions are removed by **VACUUM** (autovacuum). A transaction open for hours pins the oldest visible snapshot → dead tuples cannot be removed → table/index **bloat**, slower scans. Also watch transaction-id wraparound (32-bit xids, ~2 billion) — autovacuum freezing prevents it.
- HOT updates (heap-only tuples) avoid index updates when no indexed column changes and the page has free space — tune \`fillfactor\` for update-heavy tables.

**MySQL InnoDB** stores the latest version in place and old versions in **undo logs**; long transactions grow the history list (\`SHOW ENGINE INNODB STATUS\` → "History list length").

**Operational rules**
- Keep transactions short; never hold a transaction open across a network call or user think-time.
- Set \`idle_in_transaction_session_timeout\` (e.g. 60 s).
- Monitor \`pg_stat_activity\` for old \`xact_start\` and \`n_dead_tup\` in \`pg_stat_user_tables\`.`,
      diagram: `  Row "account 42" over time (PostgreSQL heap)

  tuple v1: balance=100  xmin=500 xmax=812   <- visible to snapshots < 812
  tuple v2: balance=70   xmin=812 xmax=0     <- visible to snapshots after 812

  Tx 810 (RR, started before 812 committed) reads v1 -> 100
  Tx 815 (new snapshot)                     reads v2 ->  70
  VACUUM can delete v1 only when no snapshot older than 812 remains`,
      code: [
        {
          language: 'sql',
          title: 'Finding MVCC trouble: long transactions and dead tuples',
          code: `-- Transactions open for more than 5 minutes (they pin old row versions)
SELECT pid, usename, state, now() - xact_start AS xact_age, left(query, 80) AS query
  FROM pg_stat_activity
 WHERE xact_start < now() - interval '5 minutes'
 ORDER BY xact_start;

-- Tables with the most dead tuples and when autovacuum last ran
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / greatest(n_live_tup, 1), 1) AS dead_pct,
       last_autovacuum
  FROM pg_stat_user_tables
 ORDER BY n_dead_tup DESC
 LIMIT 10;

-- Guardrail: kill sessions that sit idle inside a transaction
ALTER DATABASE app SET idle_in_transaction_session_timeout = '60s';`,
        },
      ],
      keyPoints: [
        'MVCC: UPDATE = new version; snapshots decide visibility.',
        'RC = snapshot per statement; RR/Serializable = snapshot per transaction.',
        'Long transactions block VACUUM → bloat; keep transactions short and time them out.',
      ],
    },
    {
      heading: 'Preventing lost updates in application code',
      body: `**Intuition:** the ORM pattern "load entity, change field, save" is a read-modify-write race waiting for traffic. Pick one of four defences.

| Technique | How | Best when | Cost |
|---|---|---|---|
| Atomic update | \`UPDATE ... SET qty = qty - 1 WHERE qty >= 1\` | Logic expressible in SQL | Cheapest; one round trip |
| Pessimistic lock | \`SELECT ... FOR UPDATE\` then update | High contention, complex logic | Holds row lock; serialises writers |
| Optimistic lock | \`version\` column; \`UPDATE ... WHERE version = $v\` | Low contention, user edits | Retry on conflict |
| Serializable | \`ISOLATION LEVEL SERIALIZABLE\` + retry | Invariants spanning many rows | Aborts under contention |

**Interview heuristic:** "If I can express it as a single conditional UPDATE, I do. If conflicts are rare, optimistic versioning. If contention is high on a few rows, pessimistic lock with a short transaction. For multi-row invariants like write skew, SERIALIZABLE or materialised locks." (Lock mechanics and deadlocks are in **db-connections-locks**.)`,
      code: [
        {
          language: 'typescript',
          title: 'TypeORM: optimistic versioning vs atomic update',
          code: `import { Entity, PrimaryColumn, Column, VersionColumn, DataSource } from 'typeorm';

@Entity()
export class Product {
  @PrimaryColumn() id!: string;
  @Column('int') stock!: number;
  @Column('text') description!: string;
  @VersionColumn() version!: number;          // incremented on every save
}

export class ProductService {
  constructor(private readonly ds: DataSource) {}

  // Counters: never load-modify-save. One atomic, conditional statement.
  async reserve(id: string, qty: number): Promise<boolean> {
    const res = await this.ds.createQueryBuilder()
      .update(Product)
      .set({ stock: () => 'stock - :qty', version: () => 'version + 1' })
      .where('id = :id AND stock >= :qty', { id, qty })
      .execute();
    return res.affected === 1;               // false => sold out, no oversell
  }

  // Human edits: optimistic check against the version the user loaded
  async editDescription(id: string, text: string, loadedVersion: number): Promise<void> {
    const res = await this.ds.createQueryBuilder()
      .update(Product)
      .set({ description: text, version: () => 'version + 1' })
      .where('id = :id AND version = :v', { id, v: loadedVersion })
      .execute();
    if (res.affected !== 1) throw new Error('409: product was modified by someone else');
  }
}`,
        },
      ],
      keyPoints: [
        'Load-modify-save in an ORM = lost update under concurrency.',
        'Conditional atomic UPDATE is the cheapest correct fix for counters/stock.',
        'Optimistic versions for human edits; return 409 and let the user merge.',
      ],
    },
    {
      heading: 'Choosing a database: decision table and worked examples',
      body: `**Intuition:** choose by the hardest requirement, not the most fashionable technology.

| Requirement | Lean towards | Why |
|---|---|---|
| Money, inventory, bookings, strong invariants | PostgreSQL/MySQL (+ sharding later), Spanner/CockroachDB for global | Multi-row ACID, constraints |
| Unknown future queries, reporting on OLTP | PostgreSQL | Joins, planner, extensions |
| 1M+ writes/s, append-mostly, known queries | Cassandra/ScyllaDB, Bigtable, DynamoDB | Linear write scaling, LSM |
| Serverless, spiky, key-based access | DynamoDB | Pay-per-request, no ops |
| Aggregate-shaped, evolving schema | MongoDB or Postgres JSONB | Document fits the screen |
| Sub-ms lookups, sessions, counters, leaderboards | Redis | In-memory, rich data structures |
| Multi-hop relationship queries | Neo4j/Neptune | Traversal performance |
| Metrics, IoT | TimescaleDB, InfluxDB, Prometheus + long-term store | Compression, retention |
| Analytics over billions of rows | ClickHouse, BigQuery, Snowflake, Druid | Columnar OLAP |
| Full-text / relevance | Elasticsearch/OpenSearch (derived from source of truth) | Inverted index |

**Worked examples**
- **Payment ledger:** Postgres, double-entry rows, SERIALIZABLE or conditional updates, idempotency keys with UNIQUE constraints. NoSQL is a poor fit because invariants span rows.
- **Chat messages (Discord/WhatsApp-scale):** Cassandra/ScyllaDB partitioned by \`(channel_id, bucket)\`; user/channel metadata in Postgres.
- **Product catalog:** Postgres (source of truth, JSONB for attributes) → Elasticsearch for search → Redis/CDN for hot reads.
- **Ride location pings:** Redis GEO for current positions (ephemeral), Kafka → Cassandra/S3 for history.
- **Leaderboard:** Redis sorted sets, Postgres/DynamoDB for durable scores (Alex Xu Vol 2 Ch 10).

**Say this in interviews:** "Source of truth in a store that enforces my invariants; derived, denormalised views in stores optimised for each read pattern, fed by CDC so they cannot drift silently."`,
      keyPoints: [
        'Choose by the hardest requirement (invariants, write scale, query shape).',
        'Source of truth + derived views via CDC is the standard polyglot pattern.',
        'Mention concrete numbers when defending a choice.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 7, 10, 11',
    },
  ],
  codeChallenges: [
    {
      id: 'db-fundamentals-cc-1',
      title: 'Fix the on-call scheduler that lets everyone go off duty',
      context:
        'A NestJS service lets doctors request leave from a shift. The invariant is "at least one doctor stays on call per shift". The team runs Postgres with REPEATABLE READ "to be safe". Last weekend, two doctors requested leave at the same second and the shift ended up with nobody on call.',
      task: 'Make the invariant hold under concurrent requests without serialising the whole table, and handle any errors your fix introduces.',
      starter: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
const pool = new Pool();

export async function requestLeave(doctorId: string, shiftId: number) {
  const client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM doctor WHERE shift_id = $1 AND on_call',
    [shiftId],
  );
  if (rows[0].n < 2) {
    await client.query('ROLLBACK');
    throw new Error('cannot leave: you are the last doctor on call');
  }
  await client.query('UPDATE doctor SET on_call = false WHERE id = $1', [doctorId]);
  await client.query('COMMIT');
  client.release();
}`,
      },
      hints: [
        'Both transactions read the same snapshot and write different rows. Which anomaly is that, and does snapshot isolation detect it?',
        'You can either let the database detect the dangerous pattern or turn the read into a lock both transactions must contend on.',
        'Whatever you choose, look at what happens to the connection if a query throws.',
      ],
      solution: {
        language: 'typescript',
        code: `import { Pool, type PoolClient } from 'pg';
const pool = new Pool({ statement_timeout: 3000 });

const SERIALIZATION_FAILURE = '40001';
const DEADLOCK = '40P01';

async function once(client: PoolClient, doctorId: string, shiftId: number) {
  await client.query('BEGIN'); // READ COMMITTED is enough once we lock the rows
  try {
    // Materialise the conflict: lock every on-call row for this shift.
    // A concurrent request for the same shift blocks here until we commit.
    const { rows } = await client.query(
      'SELECT id FROM doctor WHERE shift_id = $1 AND on_call ORDER BY id FOR UPDATE',
      [shiftId],
    );
    if (!rows.some((r) => r.id === doctorId)) throw new Error('not on call for this shift');
    if (rows.length < 2) throw new Error('cannot leave: you are the last doctor on call');
    await client.query('UPDATE doctor SET on_call = false WHERE id = $1', [doctorId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

export async function requestLeave(doctorId: string, shiftId: number, attempts = 3) {
  const client = await pool.connect();
  try {
    for (let i = 1; ; i++) {
      try {
        return await once(client, doctorId, shiftId);
      } catch (err: any) {
        const retryable = err.code === SERIALIZATION_FAILURE || err.code === DEADLOCK;
        if (!retryable || i >= attempts) throw err;
        await new Promise((r) => setTimeout(r, 20 * 2 ** i + Math.random() * 20)); // jittered backoff
      }
    }
  } finally {
    client.release(); // always returned to the pool, even on error
  }
}`,
      },
      explanation: `**Fixes**
- **Write skew:** under REPEATABLE READ (snapshot isolation) both transactions saw \`n = 2\`, then updated *different* rows, so no write-write conflict was detected. Postgres RR does not prevent write skew.
- **Materialised conflict:** \`SELECT ... FOR UPDATE\` over the rows the decision depends on forces the second transaction to wait; after the first commits, the second re-reads under READ COMMITTED semantics, sees only one on-call row and refuses. \`ORDER BY id\` gives a consistent lock order to avoid deadlocks.
- **Alternative:** \`BEGIN ISOLATION LEVEL SERIALIZABLE\` with the original logic — SSI aborts one transaction with 40001; the retry loop handles it.
- **Connection leak:** the starter never released the client on the error path (thrown error after ROLLBACK, or any failing query) — pool exhaustion under errors. Now \`finally\` releases it.
- **Timeouts & retries:** statement timeout bounds lock waits; retries only for retryable SQLSTATEs with jittered backoff.
- **Validation:** checks the doctor is actually on call for that shift.`,
      followUps: [
        {
          "q": "A shift has 40 doctors and leave requests spike at month-end. Is locking all on-call rows of the shift still acceptable?",
          "a": "It's acceptable for correctness, but every leave request for that shift now serialises, and each request locks up to 40 rows. That's fine at a few requests per second, wasteful at hundreds. An alternative is to materialise the invariant in one row: a `shift` row with `on_call_count`, then run `UPDATE shift SET on_call_count = on_call_count - 1 WHERE id = $1 AND on_call_count > 1` in the same transaction as the doctor update. That's one row lock per request, a short hold, and the conditional update enforces the invariant. Keep the counter in sync through the same code path, or add a reconciliation check."
        },
        {
          "q": "How would you write a test that reliably reproduces the original write-skew bug and proves the fix?",
          "a": "Use a real Postgres (Testcontainers). Seed a shift with exactly 2 on-call doctors, then open two connections and control the interleaving explicitly: both run BEGIN and the count SELECT, then both run their UPDATE and COMMIT. Against the starter at RR, both commits succeed and the count is 0, so the bug reproduces. Against the fix, the second SELECT ... FOR UPDATE blocks. Release it by committing the first, then assert the second throws 'last doctor' and the final count is 1. Add a randomised stress test (100 iterations of concurrent requests) asserting the count never drops below 1."
        }
      ],
    },
    {
      id: 'db-fundamentals-cc-2',
      title: 'Redesign a Cassandra table that times out on the hot path',
      context:
        'An IoT platform stores readings from 2M devices, each reporting every 10 seconds. The dashboard shows "last 24 h of readings for device X" and "latest reading per device for a customer". Queries time out and nodes show multi-GB partitions and tombstone warnings.',
      task: 'Redesign the schema so both queries are single-partition (or bounded) reads, partitions stay bounded, and data expires after 30 days without tombstone storms.',
      starter: {
        language: 'sql',
        code: `CREATE TABLE readings (
  customer_id  uuid,
  device_id    uuid,
  ts           timestamp,
  temperature  double,
  humidity     double,
  PRIMARY KEY (customer_id, device_id, ts)
);

-- Dashboard query 1
SELECT * FROM readings
 WHERE customer_id = ? AND device_id = ? AND ts > ?;

-- Dashboard query 2: latest per device
SELECT device_id, max(ts) FROM readings
 WHERE customer_id = ? GROUP BY device_id;

-- Nightly cleanup job
DELETE FROM readings WHERE customer_id = ? AND device_id = ? AND ts < ?;`,
      },
      hints: [
        'What is the partition key in the starter table, and how many rows does a large customer accumulate in a single partition?',
        'Each dashboard query deserves its own table shaped for it.',
        'Explicit DELETEs create tombstones; which Cassandra feature expires data per write, and which compaction strategy suits time-ordered TTL data?',
      ],
      solution: {
        language: 'sql',
        code: `-- Q1: last 24 h for one device. Partition = (device, day) -> bounded size:
-- 8,640 rows/day x ~50 bytes ~= 430 KB per partition.
CREATE TABLE readings_by_device_day (
  device_id    uuid,
  day          date,
  ts           timestamp,
  temperature  double,
  humidity     double,
  PRIMARY KEY ((device_id, day), ts)
) WITH CLUSTERING ORDER BY (ts DESC)
  AND default_time_to_live = 2592000          -- 30 days, no DELETE job needed
  AND compaction = {'class': 'TimeWindowCompactionStrategy',
                    'compaction_window_unit': 'DAYS', 'compaction_window_size': 1}
  AND gc_grace_seconds = 86400;               -- data is TTL-only, not deleted explicitly

-- App reads today + yesterday partitions (2 single-partition queries, run in parallel)
SELECT ts, temperature, humidity FROM readings_by_device_day
 WHERE device_id = ? AND day = ? AND ts > ?;

-- Q2: latest reading per device for a customer: an upsert-only table,
-- one row per device (overwritten in place, no growth).
CREATE TABLE latest_by_customer (
  customer_id  uuid,
  device_id    uuid,
  ts           timestamp,
  temperature  double,
  humidity     double,
  PRIMARY KEY ((customer_id), device_id)
);
-- Writer does both inserts per reading (logged batch not needed: idempotent upserts)
-- INSERT INTO readings_by_device_day (...) VALUES (...);
-- INSERT INTO latest_by_customer (...) VALUES (...) USING TIMESTAMP <reading ts in micros>;`,
      },
      explanation: `**Problems in the starter**
- Partition key \`customer_id\` alone: a customer with 50K devices accumulates 50K × 8,640 rows/day = 432M rows/day in **one partition** → huge partitions, hot nodes, timeouts.
- Query 2 needs aggregation across the partition — Cassandra must read everything.
- Nightly DELETEs generate millions of **tombstones**, which reads must skip until compaction (tombstone warnings, then failures at 100K tombstones by default).

**Fixes**
- **Q1 table** partitioned by \`(device_id, day)\`: ~430 KB partitions, reads are single-partition and pre-sorted by \`ts DESC\`.
- **Q2 table**: one row per device per customer, overwritten on every reading; \`USING TIMESTAMP\` with the reading's time ensures a late, older reading cannot overwrite a newer one (last-write-wins by write timestamp). A 50K-device customer's partition is 50K small rows — acceptable; bucket further if customers can reach millions of devices.
- **TTL + TWCS:** expiry at write time; TimeWindowCompactionStrategy drops whole expired SSTables instead of compacting tombstones row by row.
- Writes: 2M devices / 10 s = 200K readings/s × 2 tables = 400K writes/s — well within a modest Cassandra/Scylla cluster.`,
      followUps: [
        {
          "q": "A device goes offline for 6 hours and then uploads its buffered readings. What happens in both tables, and is anything wrong?",
          "a": "In `readings_by_device_day`, the backfilled readings land in the right `(device, day)` partitions by their own ts, and TTL counts from write time, so they live 30 days from upload, slightly longer than intended (`USING TTL` computed from the reading time fixes that). TWCS buckets by write time, so the old-timestamped data mixes into today's window, which is harmless at this scale. In `latest_by_customer`, `USING TIMESTAMP` set to the reading time means old buffered readings can't overwrite a newer one, so 'latest' stays correct."
        },
        {
          "q": "The product team adds 'average temperature per device per hour for the last 90 days'. Do you query the raw table?",
          "a": "No. That would read 90 partitions of 8,640 rows each per device, and the raw TTL is only 30 days. Add a rollup table `hourly_by_device ((device_id, month), hour)` holding count, sum, min and max, with a 1-year TTL. Populate it from a stream processor (Flink/Kafka Streams aggregating readings per device-hour) or from the writer updating an in-memory hourly accumulator and flushing it. Store sums and counts, not averages, so late data and re-aggregation stay correct. A 90-day query is then 3 partitions and about 2,160 rows."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'db-fundamentals-iq-01',
      difficulty: 'hard',
      question:
        'You are designing the data layer for a ride-hailing platform: riders, drivers, trips, payments, live driver locations and trip history. Which databases would you use for which data, and why?',
      whatInterviewerLooksFor: [
        'Decomposes data by access pattern, consistency need and volume rather than picking one DB',
        'Keeps money and trip state in an ACID store with constraints',
        'Uses ephemeral in-memory storage for high-churn location data',
        'Explains how derived stores are fed (CDC/events) and kept consistent',
        'Gives rough numbers to justify choices',
      ],
      modelAnswer: `### Classify the data
| Data | Access pattern | Volume | Consistency | Store |
|---|---|---|---|---|
| Riders, drivers, vehicles | By id, admin queries | Tens of millions of rows | Strong | PostgreSQL |
| Trip state machine | By trip id, transitions must not race | ~20M trips/day ≈ 230/s avg, ~1K/s peak | Strong, invariants | PostgreSQL (sharded by city or trip id later) |
| Payments / ledger | Append-only, double entry | Same as trips × 2–4 entries | Strongest, audit | PostgreSQL, SERIALIZABLE or conditional updates |
| Live driver locations | Write every 4 s, nearby search | 1M active drivers ÷ 4 s = 250K writes/s | Ephemeral, last-write-wins | Redis GEO (sharded by geo cell) |
| Location history | Append, read per trip | 250K/s × ~100 B ≈ 2 TB/day | Eventual | Kafka → Cassandra (partition by trip/day) or S3 + Parquet |
| Trip history for rider app | "My last 20 trips" | Read-heavy | Eventual OK | Postgres read replica or denormalised Cassandra/DynamoDB table |
| Analytics, surge modelling | Aggregations | Billions of rows | Eventual | Kafka → ClickHouse/BigQuery |

### Why this split
- Trip transitions (requested → accepted → started → completed) must not double-assign a driver: \`UPDATE trip SET driver_id = $1, status = 'accepted' WHERE id = $2 AND status = 'requested'\` — a conditional atomic update in Postgres is the simplest correct mechanism.
- 250K location writes/s would crush a relational primary (and generate massive WAL/MVCC churn for data that is worthless after 30 s). Redis handles ~100K+ ops/s per shard in memory.
- History and analytics are derived views: Kafka topics from the location service and CDC (Debezium) from Postgres feed them, so the source of truth stays small and hot.

### Trade-offs to state
- More stores = more ops and more consistency boundaries; I keep the number of **sources of truth** to one per entity.
- If we go multi-region with strong consistency for trips, I would evaluate Spanner/CockroachDB instead of hand-sharding Postgres.`,
      followUps: [
        {
          q: 'Why not store live locations in Cassandra since it handles high write throughput?',
          a: 'Cassandra can absorb 250K writes/s, but the query is "nearby drivers now", which needs a geo index over the latest position only. Every update would create a new version/tombstone churn, and the data is useless after seconds. Redis GEO (or an in-memory geo-index service) keeps only the latest point and answers radius queries in ~1 ms.',
        },
        {
          q: 'How do you keep the rider trip-history table consistent with Postgres?',
          a: 'CDC from the trips table via Debezium into Kafka, and an idempotent consumer upserting into the history store keyed by trip id with the source LSN/version to ignore out-of-order events. It is eventually consistent (typically sub-second), which is fine for history.',
        },
        {
          q: 'When would you move trips off a single Postgres primary?',
          a: 'When sustained write load, storage or connection count approaches single-node limits (e.g. >10–20K write tx/s, multi-TB hot data) or when a multi-region write requirement appears. Then shard by city/region (natural locality) or move to a distributed SQL database.',
        },
      ],
      pitfalls: [
        'Choosing MongoDB or Cassandra for everything "because it scales"',
        'Putting high-frequency location pings into the relational primary',
        'Not explaining how derived stores stay in sync',
      ],
    },
    {
      id: 'db-fundamentals-iq-02',
      difficulty: 'expert',
      question:
        'Explain the difference between REPEATABLE READ in PostgreSQL and in MySQL, and give a concrete bug that behaves differently on the two.',
      whatInterviewerLooksFor: [
        'Knows PG RR is snapshot isolation that aborts on concurrent update (first-updater-wins)',
        'Knows InnoDB RR uses consistent snapshots for plain reads but current reads + next-key locks for writes/locking reads',
        'Can construct a lost-update example that is caught in PG and silently happens in MySQL',
        'Mentions write skew is possible in both',
      ],
      modelAnswer: `### PostgreSQL REPEATABLE READ
- One snapshot for the whole transaction (snapshot isolation).
- If you UPDATE a row that another transaction modified and committed after your snapshot, Postgres raises **ERROR: could not serialize access due to concurrent update** (SQLSTATE 40001). This is "first-updater-wins" — lost updates are prevented, you must retry.
- Phantoms are not visible (snapshot), but **write skew** is possible.

### MySQL InnoDB REPEATABLE READ (the default)
- Plain \`SELECT\` reads a consistent snapshot established at the first read.
- \`UPDATE\`, \`DELETE\`, \`SELECT ... FOR UPDATE / FOR SHARE\` are **current reads**: they see the latest committed version and take next-key locks (record + gap), which block concurrent inserts into ranges and prevent phantoms for locking reads.
- No first-updater-wins abort: the UPDATE simply waits for the lock and then applies to the latest version.

### The bug
Application code does read-modify-write on a wallet:
1. T1 and T2 both \`BEGIN\` and \`SELECT balance FROM wallet WHERE id = 1\` → 100.
2. T1: \`UPDATE wallet SET balance = 70 WHERE id = 1\`; COMMIT.
3. T2: \`UPDATE wallet SET balance = 50 WHERE id = 1\`.
- **Postgres RR:** T2's UPDATE fails with 40001 → retry reads 70 → writes 20. Correct.
- **MySQL RR:** T2's UPDATE waits, then overwrites with 50 → T1's debit is **lost**. Also odd: after the update, T2's own SELECT now shows 50, though a moment ago its snapshot said 100.

### Fixes that work on both
- Atomic \`UPDATE wallet SET balance = balance - 50 WHERE id = 1 AND balance >= 50\`.
- \`SELECT ... FOR UPDATE\` before computing.
- Optimistic version column.
- SERIALIZABLE (PG SSI; MySQL SERIALIZABLE turns plain SELECTs into locking reads — heavy contention).

### Common to both
Write skew (two transactions read an overlapping set, write different rows) is possible under RR in both engines unless you lock or use SERIALIZABLE.`,
      followUps: [
        {
          q: 'Why might a team see more deadlocks after migrating from Postgres to MySQL with the same code?',
          a: 'InnoDB RR takes next-key/gap locks on locking reads and on UPDATE/DELETE range scans; two transactions inserting into overlapping gaps or scanning ranges in different orders can deadlock, whereas Postgres locks only the rows it actually touches.',
        },
        {
          q: 'Does READ COMMITTED on MySQL remove gap locks?',
          a: 'Mostly yes — InnoDB at READ COMMITTED uses gap locking only for foreign-key and duplicate-key checks, which reduces deadlocks but allows phantoms for locking reads. Row-based binlog replication is then required.',
        },
      ],
      pitfalls: [
        'Saying the two are identical because the SQL standard names match',
        'Believing REPEATABLE READ prevents all anomalies',
        'Forgetting that Postgres RR needs retry logic',
      ],
    },
    {
      id: 'db-fundamentals-iq-03',
      difficulty: 'hard',
      question:
        'A flash sale sold 1,300 units of a product that had only 1,000 in stock. The code runs inside a transaction. What went wrong and how would you fix it at 5K orders per second on one hot SKU?',
      context: 'NestJS + TypeORM + Postgres. The handler loads the product entity, checks stock > 0, decrements stock in memory and calls save(), all inside a transaction.',
      whatInterviewerLooksFor: [
        'Identifies lost update under READ COMMITTED; "inside a transaction" is not enough',
        'Proposes a conditional atomic update as the base fix',
        'Recognises the hot-row contention problem at 5K/s and proposes a scaling approach',
        'Keeps idempotency and oversell prevention distinct',
      ],
      modelAnswer: `### Root cause
Postgres defaults to READ COMMITTED. Hundreds of concurrent transactions read \`stock = 1\` (or the same value), each decides it can sell, and each writes \`stock - 1\` computed in memory. Transactions provide atomicity, not protection against read-modify-write races. The later writes overwrite earlier ones → lost updates → oversell. (If save() writes stock = computed value, you can even see stock go back up.)

### Correctness fix
One statement, with the check inside:
\`UPDATE product SET stock = stock - $qty WHERE id = $id AND stock >= $qty RETURNING stock\`
- The row lock serialises concurrent updaters; each re-evaluates the WHERE on the latest version.
- rowCount 0 → sold out. Add \`CHECK (stock >= 0)\` as a belt-and-braces constraint.
- Add an idempotency key (UNIQUE on \`order_request_id\`) so client retries do not double-order.

### Throughput at 5K/s on one row
Every order serialises on one row lock. Each update holds the lock ~0.5–2 ms (plus commit fsync), so one row tops out around ~1–3K updates/s, and lock queues spike latency.
Options:
1. **Stock sharding (bucketing):** split 1,000 units into 20 rows of 50; each order picks a random bucket with stock (\`UPDATE ... WHERE sku = $1 AND bucket = $2 AND stock >= 1\`), falling back to others. Contention drops ~20×.
2. **Redis pre-decrement gate:** \`DECRBY\` in Redis (single-threaded, ~100K ops/s) admits only 1,000 winners; winners then write orders to Postgres asynchronously via a queue. Reconcile Redis vs DB after the sale.
3. **Queue the orders:** serialise through a Kafka partition per SKU; a single consumer decrements in-memory and batch-commits.

### What I would do
Conditional update for correctness everywhere, plus a Redis gate for flash-sale SKUs to shed losers in ~1 ms without touching Postgres.`,
      followUps: [
        {
          q: 'Would SERIALIZABLE isolation fix it?',
          a: 'Yes for correctness — concurrent read-modify-write would abort with 40001 — but at 5K/s on one row the abort/retry rate would be enormous and latency terrible. It fixes the anomaly, not the contention.',
        },
        {
          q: 'How do you ensure the Redis gate and the database never disagree permanently?',
          a: 'Redis is an admission filter, not the source of truth: winners carry a reservation id, the DB insert is idempotent, reservations not confirmed within N minutes are released back to Redis, and a reconciliation job compares DB orders with Redis counters after the sale.',
        },
      ],
      pitfalls: [
        'Saying "it was in a transaction, so it should be safe"',
        'Adding a distributed lock around the whole handler, serialising every request through a slow critical section',
        'Ignoring the hot-row throughput ceiling',
      ],
    },
    {
      id: 'db-fundamentals-iq-04',
      difficulty: 'expert',
      question:
        'Model a Twitter-like "home timeline" and "user profile timeline" in Cassandra or DynamoDB. Walk me through partition keys, sort keys, write path and the failure modes of your model.',
      whatInterviewerLooksFor: [
        'Designs one table per query with explicit partition/clustering keys',
        'Bounds partition growth (bucketing, trimming)',
        'Discusses fan-out on write vs read and celebrity hot partitions',
        'Mentions idempotency and ordering (time-ordered ids)',
      ],
      modelAnswer: `### Queries
- Q1: user profile timeline — tweets by author, newest first, paginated.
- Q2: home timeline — newest tweets from people I follow.

### Tables
**tweets_by_author** — partition \`(author_id, month)\`, clustering \`tweet_id DESC\` (Snowflake id, time-ordered). A prolific user posting 100/day → 3K rows/month, tiny partitions. Pagination = "tweet_id < last_seen" within the partition, then move to the previous month.

**home_timeline** — partition \`(user_id)\`, clustering \`tweet_id DESC\`, storing only \`(tweet_id, author_id)\`. Trim to the latest ~800 entries (as Twitter did) so partitions stay bounded; older history is rebuilt on demand from tweets_by_author.

**tweets** — partition \`tweet_id\` → full body, media refs, counts (counts in a separate counter table or aggregated elsewhere).

### Write path (fan-out on write)
1. Insert into tweets and tweets_by_author (idempotent: same tweet_id).
2. Enqueue fan-out job to Kafka; workers read follower lists in pages and insert into each follower's home_timeline. Average 200 followers × 5K tweets/s = 1M timeline inserts/s — fine for a Cassandra cluster of a few dozen nodes.

### Failure modes
- **Celebrities:** 100M followers → 100M inserts per tweet, minutes of lag. Hybrid: skip fan-out for accounts above ~1M followers; merge their recent tweets at read time from tweets_by_author (a handful of partitions).
- **Hot partitions on read:** a celebrity's tweets_by_author partition gets massive read QPS → cache it (Redis/CDN) — Cassandra partitions live on RF replicas only.
- **Deletes:** deleting a tweet leaves tombstones across millions of timelines; instead filter at read time via the tweets table and let TTL/trim expire entries.
- **Ordering:** Snowflake ids give k-sorted order across servers; clock skew only causes millisecond-level misordering.

### Why not relational?
The home timeline is a precomputed, per-user denormalised list — relational joins across follows × tweets at read time for 300M users is far more expensive than a single-partition read.`,
      followUps: [
        {
          q: 'A user unfollows someone. What happens to their home timeline?',
          a: 'Either a background job deletes that author\'s entries from the partition (tombstones, bounded by 800 rows) or, more cheaply, the read path filters entries whose author is no longer followed, and they age out via trimming.',
        },
        {
          q: 'How would this look in DynamoDB?',
          a: 'PK = USER#id, SK = TWEET#<snowflake> for the timeline; a Query with ScanIndexForward=false and Limit. Watch the ~1,000 WCU per partition limit for the fan-out on very active followers and the 400 KB item limit; timelines stay as many small items, not one big list item.',
        },
      ],
      pitfalls: [
        'A single partition per user for all history (unbounded growth)',
        'Using ALLOW FILTERING or scans to build timelines',
        'Ignoring the celebrity fan-out problem',
      ],
    },
    {
      id: 'db-fundamentals-iq-05',
      difficulty: 'hard',
      question:
        'Your Postgres database has grown from 200 GB to 900 GB in three months, but row counts only grew 20%. Queries on the orders table are slower. What is going on and how do you fix it?',
      whatInterviewerLooksFor: [
        'Suspects MVCC bloat and knows the causes (long transactions, replication slots, autovacuum lag)',
        'Knows how to measure: pg_stat_user_tables, pgstattuple, pg_stat_activity',
        'Knows remediation: fix the blocker, tune autovacuum, pg_repack vs VACUUM FULL',
        'Mentions prevention with timeouts and monitoring',
      ],
      modelAnswer: `### Hypothesis: MVCC bloat
Every UPDATE in Postgres writes a new tuple; old ones are reclaimed by VACUUM only when no snapshot can still see them. Storage grew 4.5× while rows grew 20% → dead tuples are not being cleaned.

### Diagnose
1. **Dead tuples:** \`pg_stat_user_tables\` → \`n_dead_tup\`, \`last_autovacuum\` for orders. \`pgstattuple\` gives exact dead/free space percentages.
2. **What pins the horizon?**
   - Long-running or **idle-in-transaction** sessions in \`pg_stat_activity\` (a forgotten psql session, an app that opens a transaction and waits on an HTTP call).
   - **Abandoned replication slots** (\`pg_replication_slots\` with inactive slots) — they also retain WAL.
   - Replicas with \`hot_standby_feedback = on\` running long analytics queries.
   - Prepared transactions left open (\`pg_prepared_xacts\`).
3. **Autovacuum too slow:** default \`autovacuum_vacuum_scale_factor = 0.2\` means a 500M-row table waits for 100M dead tuples before vacuuming; cost limits throttle it.

### Fix
- Kill/fix the horizon blocker first — otherwise VACUUM cannot help.
- Per-table autovacuum tuning for hot tables: \`scale_factor = 0.01\`, higher \`autovacuum_vacuum_cost_limit\`, more workers.
- Reclaim space: plain VACUUM makes space reusable but rarely shrinks files; **pg_repack** rebuilds the table online (brief lock at the end). VACUUM FULL takes an ACCESS EXCLUSIVE lock — only in a maintenance window.
- Reindex bloated indexes concurrently (\`REINDEX INDEX CONCURRENTLY\`).

### Prevent
- \`idle_in_transaction_session_timeout = 60s\`, \`statement_timeout\` per role.
- Alert on oldest \`xact_start\`, inactive slots, dead-tuple ratio, and xid age (\`age(datfrozenxid)\`) to stay far from wraparound.
- Update-heavy tables: lower \`fillfactor\` (e.g. 80–90) to enable HOT updates.`,
      followUps: [
        {
          q: 'Why do long transactions hurt even if they only read?',
          a: 'Under MVCC, any open snapshot (even read-only, at REPEATABLE READ or a long statement at READ COMMITTED) keeps the xmin horizon back, so VACUUM cannot remove tuples deleted after that snapshot began, across all tables in the database.',
        },
        {
          q: 'What is transaction ID wraparound and why is it scary?',
          a: 'Postgres xids are 32-bit; after ~2 billion transactions old xids would appear to be in the future. Autovacuum "freezes" old tuples to prevent this; if it cannot (blocked horizon), Postgres eventually refuses writes to protect data — a full outage requiring emergency vacuum.',
        },
      ],
      pitfalls: [
        'Running VACUUM FULL on production at peak time',
        'Blaming "more data" without checking dead tuples',
        'Tuning autovacuum without removing the long transaction pinning the horizon',
      ],
    },
    {
      id: 'db-fundamentals-iq-06',
      difficulty: 'medium',
      question:
        'A product manager wants "flexible attributes" for products — each category has different fields, and new fields are added weekly. The team proposes moving from Postgres to MongoDB. How do you evaluate that?',
      whatInterviewerLooksFor: [
        'Considers Postgres JSONB and EAV and their trade-offs',
        'Evaluates what else the data needs: transactions, joins, reporting',
        'Considers migration cost and operational burden of a second database',
        'Mentions indexing flexible fields and schema validation',
      ],
      modelAnswer: `### Clarify the real need
- Which queries use the flexible attributes? Display only, filter/facet, or sort?
- Do products participate in transactions with orders, inventory, pricing (relational data)?
- Volume: a catalog of 10M products is small for either database.

### Options
| Option | Pros | Cons |
|---|---|---|
| Postgres **JSONB** column for attributes | Keeps joins/transactions with orders & inventory; GIN index supports containment queries (\`attrs @> '{"color":"red"}'\`); expression indexes for hot fields | Less ergonomic partial updates for deep docs; no per-field stats unless extracted |
| EAV table (entity, attribute, value) | Fully dynamic | Terrible query performance, no types, pivot joins — avoid |
| MongoDB | Natural document model, flexible schema, good dev ergonomics | Second database to run; cross-collection transactions weaker/slower; joins with orders via \`$lookup\` or duplication; migration project |
| Search engine for facets | Best faceting/filtering UX | Derived store, not source of truth |

### Recommendation
Keep Postgres as the source of truth: core, stable columns (id, sku, price, category, status) as typed columns with constraints; category-specific attributes in \`attrs jsonb\` with a GIN index and JSON-schema validation per category in the application (or a CHECK with \`jsonb_typeof\`). Facet search → Elasticsearch/OpenSearch fed by CDC. Hot filter fields get promoted to generated columns or expression indexes.

### When MongoDB would win
If the whole domain is document-shaped (content management, product authoring with deep nested variants), there are no cross-entity transactions, and the team already operates Mongo. "Flexible schema" alone is not a reason to switch databases.`,
      followUps: [
        {
          q: 'How do you index a JSONB field that is filtered by range, like screen_size > 50?',
          a: 'GIN (jsonb_path_ops) supports containment/equality, not ranges. Use an expression B-tree index: CREATE INDEX ON product (((attrs->>\'screen_size\')::numeric)) WHERE category = \'tv\', or promote it to a generated column.',
        },
        {
          q: 'How do you avoid garbage in schemaless attributes?',
          a: 'Validate against a per-category JSON schema in the write path (or a DB trigger/CHECK), version attribute definitions, and backfill on schema changes.',
        },
      ],
      pitfalls: [
        'Proposing EAV as the flexible-schema solution',
        'Switching databases for a single feature without migration cost analysis',
        'Assuming schemaless means no schema management',
      ],
    },
    {
      id: 'db-fundamentals-iq-07',
      difficulty: 'expert',
      question:
        'Your team switched a booking service to SERIALIZABLE isolation to fix a double-booking bug. Now p99 latency tripled and 8% of requests fail with "could not serialize access". What would you do?',
      whatInterviewerLooksFor: [
        'Understands SSI aborts and the need for retries',
        'Reduces conflict footprint: shorter transactions, fewer reads, proper indexes (predicate lock granularity)',
        'Considers alternatives: constraints (exclusion constraint), targeted FOR UPDATE, conditional updates',
        'Weighs correctness vs throughput and chooses per-operation isolation',
      ],
      modelAnswer: `### Why it hurts
Postgres SSI tracks read-write dependencies with predicate (SIRead) locks and aborts one transaction when it detects a dangerous structure. Aborts grow with: transaction length, how much each transaction reads, and whether reads are via index (fine-grained, page/tuple-level) or sequential scans (relation-level locks → everything conflicts). No retry logic means those aborts surface as user errors.

### Step 1: stop the bleeding
Add a retry wrapper for SQLSTATE 40001 (and 40P01) with jittered backoff, 3–5 attempts. Retries must re-run the **whole** transaction, including reads. Most 8% failures become successes at a latency cost.

### Step 2: shrink the conflict surface
- Make transactions short: no external calls (payment, email) inside; do them before/after with idempotency keys.
- Ensure the availability query uses an index (\`(room_id, date)\`), so predicate locks are tuple/page-level rather than a whole-table lock from a seq scan.
- Use \`SET TRANSACTION READ ONLY\` for read-only transactions (and \`DEFERRABLE\` for long reports) so they do not cause aborts.
- Only run the booking transaction at SERIALIZABLE; everything else stays at READ COMMITTED.

### Step 3: consider a cheaper correct mechanism
- **Exclusion constraint** for interval bookings: \`EXCLUDE USING gist (room_id WITH =, daterange(check_in, check_out) WITH &&)\` (needs btree_gist) — the database rejects overlaps under any isolation level.
- **Inventory counters** (Alex Xu's hotel design): \`UPDATE room_type_inventory SET reserved = reserved + 1 WHERE ... AND reserved < total\` — conditional atomic update, contention only per (hotel, room type, date).
- Targeted \`SELECT ... FOR UPDATE\` on the inventory rows.

### Outcome
With a constraint or conditional update, the booking path returns to READ COMMITTED, abort rate drops to ~0, and correctness is enforced by the database rather than by the isolation level.`,
      followUps: [
        {
          q: 'Is it safe to retry the transaction automatically?',
          a: 'Yes if the transaction has no external side effects before commit and the whole unit is re-executed from the start. External effects must be idempotent or performed after commit (outbox pattern).',
        },
        {
          q: 'Could you have used REPEATABLE READ instead?',
          a: 'Not for double booking via "check availability then insert": two transactions insert different rows after reading the same empty set — write skew/phantom-insert, which snapshot isolation does not prevent. You would still need a constraint or explicit locking.',
        },
      ],
      pitfalls: [
        'Reverting to READ COMMITTED and reintroducing the bug',
        'Retrying only the failing statement instead of the whole transaction',
        'Not knowing that sequential scans make SSI conflicts coarse-grained',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'db-fundamentals-boe-1',
      question:
        'A messaging app stores 5B messages/day. Estimate storage per year and the number of Cassandra nodes needed, and decide on a partition scheme.',
      assumptions: [
        'Average message row ≈ 200 bytes (ids, timestamps, 100-byte body, overhead)',
        'LZ4 compression ≈ 2× on disk; replication factor 3',
        'Keep data 1 year hot; target ≤ 2 TB of data per node (leaves room for compaction on 4 TB disks)',
        'Peak write rate = 3× average; one node sustains ~20K writes/s comfortably',
      ],
      steps: [
        { label: 'Write rate', calc: '5B ÷ 86,400 ≈ 58K msg/s avg; peak ×3 ≈ 175K/s' },
        { label: 'Raw per day', calc: '5B × 200 B = 1 TB/day' },
        { label: 'Per year on disk', calc: '1 TB × 365 ÷ 2 (compression) × 3 (RF) ≈ 550 TB' },
        { label: 'Nodes for storage', calc: '550 TB ÷ 2 TB/node ≈ 275 nodes' },
        { label: 'Nodes for writes', calc: '175K/s × 3 replicas = 525K replica-writes/s ÷ 20K ≈ 27 nodes' },
        { label: 'Partition size check', calc: 'Busy channel: 1M msgs/day × 200 B = 200 MB/day → bucket per hour (~8 MB) for hot channels, per 10 days for normal ones' },
      ],
      answer:
        '~1 TB/day raw, ~550 TB/year on disk with RF 3 → ~275 nodes, driven by storage, not throughput (~27 nodes would handle the writes). Partition by (channel_id, time_bucket) with an adaptive bucket size.',
      insight:
        'Storage, not QPS, sizes the cluster. That makes tiering (hot 90 days in Cassandra, older in S3/Parquet) the biggest cost lever — it would cut the cluster by ~75%.',
      followUps: [
        {
          "q": "Finance wants the cluster cost cut by 70%. Which assumption do you attack, and what is the new node count?",
          "a": "Attack the 1-year hot retention. Keep 60–90 days in Cassandra and move older messages to S3/Parquet with an archive read path. At 90 days the on-disk size is 1 TB × 90 ÷ 2 × 3 ≈ 135 TB, about 68 nodes instead of 275, a 75% cut. Writes still need about 27 nodes, so storage still dominates. Older history costs about $23/TB-month on S3 for roughly 365 TB/year compressed, before replication, which S3 handles internally. Old-history reads become slower (hundreds of ms), which usually matches how rarely they happen."
        },
        {
          "q": "One celebrity channel produces 50K messages per second during a live event. Does the hourly bucket still work?",
          "a": "No. 50K/s × 3,600 s × 200 B ≈ 36 GB per hour bucket, far above the roughly 100 MB partition guideline. All writes also go to the same 3 replicas, about 50K writes/s each, beyond a node's ~20K. Use finer time buckets for that channel (per minute ≈ 600 MB, still large) plus a write-shard suffix, `(channel_id, minute, shard 0..15)`, so writes spread across 16 partitions on different nodes. Readers fan out across shards and merge. Rate-limit or sample delivery too, since nobody reads 50K messages/s."
        }
      ],
    },
    {
      id: 'db-fundamentals-boe-2',
      question:
        'How much extra storage and write amplification does denormalizing a user\'s display name and avatar into every comment row cost, versus a join? 2B comments, 50M users.',
      assumptions: [
        'Display name ~20 bytes, avatar URL ~80 bytes → ~100 bytes duplicated per comment',
        'Users change their name/avatar on average once per year',
        'Average user has 40 comments; power users up to 500K',
        'Comments table rows are ~400 bytes today',
      ],
      steps: [
        { label: 'Extra storage', calc: '2B × 100 B = 200 GB (+25% on a ~800 GB table), plus index/replica copies' },
        { label: 'Profile changes/day', calc: '50M ÷ 365 ≈ 137K changes/day ≈ 1.6/s' },
        { label: 'Fan-out rows rewritten/day', calc: '137K × 40 avg ≈ 5.5M comment rewrites/day ≈ 63 rows/s avg' },
        { label: 'Worst case', calc: 'A power user rename → 500K row updates (MVCC: 500K new tuples + index entries) in one burst' },
        { label: 'Join alternative', calc: 'Page of 50 comments → 1 extra indexed lookup of ≤50 users (or cache hit) ≈ 1–2 ms' },
      ],
      answer:
        'Denormalizing costs ~200 GB and ~5.5M row rewrites/day with bursts of 500K updates per power-user rename; the join costs ~1–2 ms per page (less with a user cache).',
      insight:
        'For mutable data, denormalization shifts cost from reads to unpredictable write bursts and drift risk. Keep the user id in comments and resolve names via a cached batch lookup (DataLoader) — denormalize only immutable snapshots.',
      followUps: [
        {
          "q": "Comments move to a sharded store across 64 shards by post_id. How does that change the cost of updating a power user's name?",
          "a": "The user's 500K comments are spread across all 64 shards, so a rename becomes a distributed fan-out: find every comment by that user (which needs a user_id → comment index on every shard, or a separate lookup table), then update in batches on each shard. There's no transaction across shards, so some pages show the old name for minutes. That pushes harder toward resolving names at read time: comments store only user_id, and the API batch-fetches users from a cached user service. Per page that's one multi-get of at most 50 ids, usually a cache hit."
        }
      ],
    },
    {
      id: 'db-fundamentals-boe-3',
      question:
        'A single Postgres primary handles a wallet service. Each payment is a transaction with 4 statements and one commit. Estimate max transactions/s on one hot account vs across accounts.',
      assumptions: [
        'Each statement ~0.2 ms server time; app↔DB RTT 0.5 ms (same AZ)',
        'Commit fsync with group commit ~0.5 ms on NVMe',
        'Row lock on the account is held from its UPDATE until commit',
        '64-core server; realistic throughput ~20K simple write tx/s overall',
      ],
      steps: [
        { label: 'Tx wall time', calc: '4 statements × (0.2 + 0.5 RTT) + commit (0.5 + 0.5 RTT) ≈ 2.8 + 1.0 = 3.8 ms' },
        { label: 'Lock hold on hot row', calc: 'If the account UPDATE is first: ~3 statements + commit ≈ 3.1 ms held' },
        { label: 'Hot account ceiling', calc: '1 ÷ 3.1 ms ≈ 320 tx/s — regardless of cores' },
        { label: 'Move UPDATE to last statement', calc: 'Lock held ≈ 0.7 + 1.0 = 1.7 ms → ~590 tx/s' },
        { label: 'Single conditional statement + commit', calc: '~1.2 ms lock hold → ~800 tx/s' },
        { label: 'Across many accounts', calc: 'Not lock bound → CPU/WAL bound ≈ 10–20K tx/s' },
      ],
      answer:
        'A hot account caps out at ~300–800 tx/s depending on how long the row lock is held, while the database overall can do ~10–20K tx/s spread across accounts.',
      insight:
        'Hot-row throughput is 1 / lock-hold time, dominated by round trips. Take the contended lock last, use single-statement conditional updates or stored procedures, and for merchant-style hot accounts split balances into sub-accounts or batch updates.',
      followUps: [
        {
          "q": "The DB moves to another AZ from the app, so RTT rises from 0.5 ms to 2 ms. Redo the hot-account ceiling for the original statement order.",
          "a": "Each statement now costs 0.2 + 2 = 2.2 ms. With the account UPDATE first, the lock spans the remaining 3 statements plus commit: 3 × 2.2 + (0.5 + 2) ≈ 9.1 ms, so the ceiling is about 110 tx/s, down from ~320. Moving the UPDATE last gives ≈ 2.2 + 2.5 = 4.7 ms, about 210/s. A single statement or stored procedure gives one round trip plus commit, ≈ 0.2 + 0.5 + 2 ≈ 2.7 ms, about 370/s. Network latency multiplies directly into hot-row ceilings, which is why same-AZ placement and fewer round trips matter."
        }
      ],
    },
  ],
  test: [
    {
      id: 'db-fundamentals-mcq-01',
      difficulty: 'hard',
      question:
        'Two sessions run the following on PostgreSQL at the default isolation level, interleaved as shown. What is the final value of stock?',
      code: {
        language: 'sql',
        code: `-- initial: stock = 5
-- S1: BEGIN;
-- S1: SELECT stock FROM product WHERE id = 1;          -- 5
-- S2: BEGIN;
-- S2: UPDATE product SET stock = stock - 2 WHERE id = 1;
-- S1: UPDATE product SET stock = stock - 1 WHERE id = 1;  -- blocks
-- S2: COMMIT;
-- S1: COMMIT;`,
      },
      options: ['4', '3', '2', 'S1 fails with a serialization error'],
      correct: [2],
      explanation:
        'At READ COMMITTED, S1\'s UPDATE waits for S2\'s row lock, then re-evaluates on the newly committed version (stock = 3) and applies stock - 1 → 2. The earlier SELECT value (5) is irrelevant because the UPDATE is expressed relative to the current value. 4 would be a lost update, which only happens if the app writes a computed absolute value. Serialization errors occur at REPEATABLE READ or SERIALIZABLE, not READ COMMITTED.',
      followUps: [
        {
          "q": "The app instead computes the value in code: S1 runs `UPDATE product SET stock = 4 WHERE id = 1` using the 5 it read. What is the final value, and what are the two cheapest fixes?",
          "a": "The final value is 4, a lost update. S1 waits for S2's lock, then overwrites S2's committed 3 with its stale absolute value, so S2's decrement disappears. Fix 1: express the write relative to the current row and guard it, `SET stock = stock - 1 WHERE id = 1 AND stock >= 1`, then check the affected row count. Fix 2: optimistic concurrency with a version column, `... SET stock = 4, version = version + 1 WHERE id = 1 AND version = $read`, where 0 rows means re-read and retry. `SELECT ... FOR UPDATE` before the read also works, but it holds the lock longer."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-02',
      difficulty: 'expert',
      question:
        'The same interleaving as a lost-update race is run at PostgreSQL REPEATABLE READ. What happens?',
      code: {
        language: 'sql',
        code: `-- S1: BEGIN ISOLATION LEVEL REPEATABLE READ;
-- S1: SELECT balance FROM wallet WHERE id = 1;       -- 100
-- S2: BEGIN ISOLATION LEVEL REPEATABLE READ;
-- S2: UPDATE wallet SET balance = 70 WHERE id = 1; COMMIT;
-- S1: UPDATE wallet SET balance = 50 WHERE id = 1;   -- app computed 100 - 50`,
      },
      options: [
        'S1\'s UPDATE succeeds and the final balance is 50',
        'S1\'s UPDATE fails with "could not serialize access due to concurrent update"',
        'S1\'s UPDATE blocks forever because S2 holds the row lock',
        'S1\'s UPDATE succeeds and the final balance is 20',
      ],
      correct: [1],
      explanation:
        'Postgres REPEATABLE READ is snapshot isolation with first-updater-wins: S1 tries to modify a row changed by a transaction that committed after S1\'s snapshot, so it errors with SQLSTATE 40001 and must retry. Silently writing 50 is what MySQL InnoDB RR would do. S2 already committed, so there is no lock to wait on. 20 would require S1 to re-read, which only happens after a retry.',
      followUps: [
        {
          "q": "You move this code to MySQL InnoDB at REPEATABLE READ unchanged. What happens, and how would you make it safe there?",
          "a": "InnoDB RR doesn't apply first-updater-wins. S1's UPDATE waits for S2's lock (already released), then writes 50 over S2's committed 70, so the lost update happens silently with no error. Reads inside the transaction come from the old snapshot, but writes operate on the latest committed row. Make it safe with `SELECT balance ... FOR UPDATE` (a locking read sees the latest version and blocks concurrent writers), or by writing `balance = balance - 50 WHERE balance >= 50`. Code that relied on Postgres's 40001 error to detect the conflict needs one of these changes before it can move to MySQL."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-03',
      difficulty: 'expert',
      question:
        'Which anomalies can still occur under PostgreSQL REPEATABLE READ? Select ALL that apply.',
      options: [
        'Write skew between two transactions that read overlapping rows and update different rows',
        'Two transactions both inserting a booking for the same room and date after each checked that none existed (no unique constraint)',
        'Dirty reads of uncommitted data',
        'Non-repeatable reads of a row read twice in the same transaction',
        'Read-only transaction anomalies where a report sees a state that never existed in any serial order',
      ],
      correct: [0, 1, 4],
      explanation:
        'Snapshot isolation allows write skew, including the "check then insert" phantom-style variant where both transactions insert different new rows, and the read-only transaction anomaly described by Fekete et al. — all prevented only by SERIALIZABLE (SSI) or explicit constraints/locks. Dirty reads never happen in Postgres at any level, and a single snapshot for the whole transaction prevents non-repeatable reads.',
      followUps: [
        {
          "q": "The double-booking variant (option 1) is in production. You can't switch the whole app to SERIALIZABLE. What is the narrowest fix?",
          "a": "Let the database enforce the invariant directly. For single-night bookings add `UNIQUE (room_id, date)`. For date ranges add an exclusion constraint with `btree_gist`: `EXCLUDE USING gist (room_id WITH =, daterange(check_in, check_out) WITH &&)`. The second insert then fails with 23P01 regardless of isolation level, and the API maps it to a 409. If the rule can't be expressed as a constraint, run only that one transaction at SERIALIZABLE (it's set per transaction) with a retry loop, or lock the parent room row with `FOR UPDATE` before the check."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-04',
      difficulty: 'hard',
      question:
        'A Cassandra table is defined below. Which query will Cassandra execute efficiently without ALLOW FILTERING?',
      code: {
        language: 'sql',
        code: `CREATE TABLE orders_by_customer (
  customer_id uuid,
  year        int,
  order_ts    timestamp,
  order_id    uuid,
  status      text,
  PRIMARY KEY ((customer_id, year), order_ts, order_id)
) WITH CLUSTERING ORDER BY (order_ts DESC, order_id ASC);`,
      },
      options: [
        'SELECT * FROM orders_by_customer WHERE customer_id = ? AND order_ts > ?',
        'SELECT * FROM orders_by_customer WHERE customer_id = ? AND year = ? AND status = \'SHIPPED\'',
        'SELECT * FROM orders_by_customer WHERE customer_id = ? AND year = ? AND order_ts > ? LIMIT 20',
        'SELECT * FROM orders_by_customer WHERE year = ? AND order_ts > ?',
      ],
      correct: [2],
      explanation:
        'The full partition key (customer_id, year) must be specified with equality, then a range on the first clustering column is allowed — a single-partition, pre-sorted slice. Omitting year means the partition cannot be located. Filtering on a non-key column (status) requires ALLOW FILTERING or a secondary index. Omitting customer_id requires a full cluster scan.',
      followUps: [
        {
          "q": "Product now needs 'all SHIPPED orders for a customer across all years'. How would you serve that without ALLOW FILTERING?",
          "a": "Add a second query-shaped table, for example `orders_by_customer_status` with `PRIMARY KEY ((customer_id, status), order_ts, order_id)`, written alongside the main table on every order write. A status change becomes a delete from the old status partition and an insert into the new one, so use a logged batch to keep both together. Customers with huge histories may need a year bucket in this key too. Cassandra secondary indexes or SAI could work at low cardinality per partition, but a dedicated table keeps the read single-partition and predictable."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-05',
      difficulty: 'medium',
      question:
        'An e-commerce order screen shows the order, its 1–30 line items and the shipping address. Items are never shared between orders. In MongoDB, how should you model it?',
      options: [
        'Embed items and the shipping address snapshot in the order document; reference the customer by id',
        'Separate collections for orders, items and addresses joined with $lookup',
        'Embed every order inside the customer document',
        'Store each line item as its own document with an array of order ids',
      ],
      correct: [0],
      explanation:
        'Items are bounded, owned by the order and always read with it, and the address should be a point-in-time snapshot — classic embedding; the customer has an independent lifecycle, so it is referenced. $lookup for every order view adds joins without benefit. Embedding all orders in the customer creates unbounded documents that approach the 16 MB limit. An array of order ids per item models a many-to-many that does not exist.',
      followUps: [
        {
          "q": "Requirements change: line items must be individually updatable for fulfilment status by a warehouse service at 2K updates/s, and an order can now have up to 5,000 items for B2B. Does embedding still hold?",
          "a": "Not fully. With 5,000 items the order document approaches megabytes, each status change rewrites a growing document, and concurrent updates to different items contend on the same document. Switch to a hybrid. Keep the order header with a summary (counts, totals, the first N items for display) and put items in their own collection keyed by `{orderId, lineNo}`, indexed on orderId. The warehouse service updates items independently, and the order view reads the header plus a paged item query. Small B2C orders can keep embedding, chosen by a size threshold."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-06',
      difficulty: 'expert',
      question:
        'A reporting job opens a REPEATABLE READ transaction and runs queries for 6 hours on the primary. Which effects should you expect? Select ALL that apply.',
      options: [
        'Autovacuum cannot remove dead tuples created after the job started, causing bloat across heavily updated tables',
        'Writers to the tables the job reads are blocked for 6 hours',
        'Index scans on hot tables slow down as they visit more dead tuple versions',
        'The job sees data committed by other transactions during those 6 hours',
        'Transaction ID age keeps growing because freezing cannot advance past the job\'s snapshot',
      ],
      correct: [0, 2, 4],
      explanation:
        'An old snapshot holds back the xmin horizon, so VACUUM cannot clean dead versions or freeze tuples past it; bloat and slower scans follow, and xid age grows toward wraparound risk. MVCC means readers do not block writers, so writes proceed. A REPEATABLE READ snapshot does not see later commits. Run such jobs on a replica or a snapshot export instead.',
      followUps: [
        {
          "q": "The report must be a consistent snapshot across 6 hours of queries, and the replica also falls behind with long queries. How do you get consistency without hurting the primary?",
          "a": "On a hot standby, long queries either get cancelled by replication conflicts or, with `hot_standby_feedback = on`, hold back vacuum on the primary, which recreates the original problem. Better options: export a snapshot with `pg_export_snapshot()` and run parallel workers that import it on a dedicated replica with feedback off and a large `max_standby_streaming_delay`, since that replica's lag doesn't matter. Or take a point-in-time clone (a cloud snapshot/restore) for reporting. Or move reporting to the warehouse via CDC, which is the long-term answer."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-07',
      difficulty: 'hard',
      question:
        'What bug does this NestJS/TypeORM code have under concurrent requests?',
      code: {
        language: 'typescript',
        code: `async redeemCoupon(userId: string, code: string) {
  return this.ds.transaction(async (m) => {
    const coupon = await m.findOneByOrFail(Coupon, { code });
    if (coupon.usedCount >= coupon.maxUses) throw new ConflictException('exhausted');
    coupon.usedCount += 1;
    await m.save(coupon);
    await m.insert(Redemption, { userId, couponId: coupon.id });
  });
}`,
      },
      options: [
        'None — the transaction makes the check-and-increment atomic',
        'A deadlock always occurs because save() and insert() lock rows in different orders',
        'Concurrent redemptions read the same usedCount and each writes usedCount + 1, allowing more redemptions than maxUses',
        'findOneByOrFail reads uncommitted data from other transactions',
      ],
      correct: [2],
      explanation:
        'At the default READ COMMITTED level, the transaction guarantees atomicity but not isolation from concurrent read-modify-write: two requests both read usedCount = 9 with maxUses = 10, both pass, both save 10 — lost update and over-redemption. Fix with a conditional UPDATE ... SET used_count = used_count + 1 WHERE id = $1 AND used_count < max_uses, or a pessimistic lock. Deadlocks are not inherent here, and Postgres never reads uncommitted data.',
      followUps: [
        {
          "q": "You fix it with `UPDATE coupon SET used_count = used_count + 1 WHERE id = $1 AND used_count < max_uses`. Now a popular coupon gets 3,000 redemptions/s. What breaks?",
          "a": "Every redemption serialises on that one coupon row, and throughput is limited to 1 / lock-hold time, a few hundred to under a thousand per second. Requests queue, pool connections fill and p99 explodes. Options: split the counter into N slot rows (sum of maxUses split across slots, each request picks a random slot with the same conditional update); take the gate out of Postgres with a Redis `DECR` on a pre-loaded remaining count, then insert redemptions asynchronously and reconcile; or pre-generate single-use codes so each redemption touches a different row."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-08',
      difficulty: 'expert',
      question:
        'A hotel system must prevent overlapping reservations of the same physical room. Which approaches are correct even at READ COMMITTED? Select ALL that apply.',
      options: [
        'An exclusion constraint: EXCLUDE USING gist (room_id WITH =, daterange(check_in, check_out) WITH &&)',
        'SELECT for overlapping rows; if none, INSERT — inside a transaction',
        'Per-night inventory rows with UPDATE ... SET reserved = reserved + 1 WHERE ... AND reserved < total, checking the affected row count',
        'A UNIQUE index on (room_id, check_in)',
        'Locking the room row with SELECT ... FOR UPDATE before checking for overlaps and inserting',
      ],
      correct: [0, 2, 4],
      explanation:
        'The exclusion constraint rejects overlaps atomically in the database. Conditional per-night counter updates serialize on the inventory rows and re-check the predicate. Locking the parent room row forces concurrent bookers of the same room to serialize before checking. Check-then-insert without a lock is the classic phantom/write-skew bug. UNIQUE (room_id, check_in) only catches identical start dates, not overlaps like 1–5 and 3–7.',
      followUps: [
        {
          "q": "The hotel adds 'room types': guests book any free Deluxe room, assigned at check-in. Which of the approaches still works?",
          "a": "The exclusion constraint on a physical room no longer applies, because the booking has no room_id yet. Per-night inventory rows fit naturally: `(hotel, room_type, night, total, reserved)`, with each booking running `UPDATE ... SET reserved = reserved + 1 WHERE ... AND reserved < total` for every night in the stay, in date order to avoid deadlocks, and rolling back if any night returns 0 rows. Overbooking policies just set `total` above physical rooms. At check-in, assign a physical room using the room-level exclusion constraint."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-09',
      difficulty: 'hard',
      question:
        'A DynamoDB table uses partition key = "status" (values: PENDING, SHIPPED, DELIVERED) to support "list pending orders". At 8K writes/s the table throttles, although provisioned capacity is 40K WCU. Why?',
      options: [
        'DynamoDB limits tables to 3 partition key values',
        'Provisioned capacity takes 24 hours to take effect',
        'GSIs are required for any write above 5K WCU',
        'Only three partition key values means writes concentrate on very few partitions; each partition supports about 1,000 WCU, so hot keys throttle regardless of table capacity',
      ],
      correct: [3],
      explanation:
        'Throughput is enforced per partition (~1,000 WCU / 3,000 RCU each). A low-cardinality partition key funnels most writes into one or two partitions, so adaptive capacity cannot spread them and requests throttle even with plenty of table-level capacity. Fix with a high-cardinality key (order id) and a sharded GSI for status (e.g. status#shard 0–N). There is no 3-key limit, GSIs are not required for writes, and capacity changes apply within minutes.',
      followUps: [
        {
          "q": "You add a GSI keyed by `status#shard` with 10 shards. How does the 'list pending orders' page query it now, and what does that cost?",
          "a": "The reader fans out 10 parallel Query calls (`status#shard = PENDING#0` … `PENDING#9`), each sorted by the GSI sort key (for example created_at), and merges the results client-side. Pagination needs a cursor holding each shard's LastEvaluatedKey. Cost: 10 queries instead of 1 (more RCUs and latency set by the slowest shard). The benefit is that writes spread across 10 GSI partitions, about 10K WCU of headroom. Choose the shard count from peak writes per status ÷ ~1,000 WCU with headroom. A GSI that throttles also throttles writes to the base table."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-10',
      difficulty: 'medium',
      question:
        'Which statement about the "C" in ACID is accurate?',
      options: [
        'It means all replicas return the same value, as in the CAP theorem',
        'It means the database guarantees your business invariants automatically',
        'It means transactions move the database between states that satisfy the invariants you define — through constraints the DB enforces and logic your application must get right',
        'It means reads always see the latest committed write',
      ],
      correct: [2],
      explanation:
        'ACID consistency is about application-defined invariants; the database helps only via declared constraints (CHECK, UNIQUE, FK), and the rest depends on correct transaction logic. CAP consistency (linearizability) is a different concept about replicas. The DB cannot know undeclared business rules. "Latest committed write" is a recency/isolation property, not the C.',
      followUps: [
        {
          "q": "Name one business invariant in a wallet system that Postgres can enforce declaratively and one it cannot. How do you protect the second?",
          "a": "Declarative: `CHECK (balance >= 0)` on the wallet row, or `UNIQUE (idempotency_key)` on transfers. A buggy concurrent path still can't violate these. Not declarative: 'sum of all ledger entries for a transfer equals zero' or 'balance equals the sum of the account's ledger entries', which span rows. Protect those by doing all related writes in one transaction through a single code path (a stored procedure or one service method), making the balance a derived value updated in the same transaction, and running a periodic reconciliation query that alerts on any drift."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-11',
      difficulty: 'expert',
      question:
        'This retry wrapper is used with SERIALIZABLE transactions in Postgres. What is wrong with it?',
      code: {
        language: 'typescript',
        code: `async function withSerializable(client: PoolClient, fn: () => Promise<void>) {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  for (let i = 0; i < 3; i++) {
    try {
      await fn();
      await client.query('COMMIT');
      return;
    } catch (e: any) {
      if (e.code !== '40001') throw e;
      // retry the work
    }
  }
  throw new Error('too many conflicts');
}`,
      },
      options: [
        'Nothing; retrying fn() three times is the recommended pattern',
        'It should retry on 23505 (unique violation) instead of 40001',
        'It retries inside the same aborted transaction: after 40001 it must ROLLBACK and start a new BEGIN before re-running fn()',
        'SERIALIZABLE transactions cannot be retried; the user must resubmit',
      ],
      correct: [2],
      explanation:
        'After a serialization failure the transaction is aborted; any further statement returns "current transaction is aborted". Correct retries ROLLBACK, BEGIN a fresh transaction (new snapshot) and re-run all reads and writes, ideally with jittered backoff. The error can also appear at COMMIT, which this loop handles incorrectly for the same reason. Unique violations are usually not retryable, and retrying serializable transactions is exactly the documented approach.',
      followUps: [
        {
          "q": "After fixing the loop, 8% of transactions still hit 40001 under load. How do you reduce the conflict rate rather than retry more?",
          "a": "SSI aborts when it detects rw-dependencies, often from coarse predicate locks. Make sure the queries use indexes, because sequential scans take relation-level SIRead locks that conflict with everything. Keep transactions short and touch fewer rows. Mark read-only transactions `READ ONLY` (and `DEFERRABLE` for long reports) so they can't be victims. Split hot logic so unrelated transactions don't read overlapping ranges. If one invariant drives the conflicts, enforce it with a constraint or a row lock at READ COMMITTED instead and leave SERIALIZABLE for the rest."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-12',
      difficulty: 'hard',
      question:
        'A team stores metrics in Prometheus with labels {service, endpoint, status, user_id}. Memory usage explodes and queries time out. What is the root cause?',
      options: [
        'user_id makes every user a distinct series, so series cardinality grows to millions and each series costs memory in the head block and index',
        'Prometheus cannot store more than four labels per metric',
        'The scrape interval is too short, creating too many points per series',
        'Status codes should be stored as numbers rather than labels',
      ],
      correct: [0],
      explanation:
        'In time-series databases, each unique label combination is a separate series with its own in-memory structures and index entries; an unbounded label like user_id multiplies series by the user count. Per-user analysis belongs in logs or an OLAP store. There is no four-label limit, scrape interval affects points per series (compressed to ~1–2 bytes each) far less than cardinality, and status as a label is fine because it has few values.',
      followUps: [
        {
          "q": "Support still needs 'error rate for user 12345 over the last hour'. Where does that query go, and how do you keep its cost bounded?",
          "a": "Send it to logs or traces with user_id as a field: structured logs in Loki/Elasticsearch or wide events in ClickHouse, where high cardinality is cheap because data is stored per event and queried by filter, not held as in-memory series. Bound cost with retention (for example 7 days of detail), sampling of successful requests while keeping all errors, and a columnar store with user_id in the sort key. Prometheus keeps low-cardinality aggregates (per service, endpoint, status) for alerting. Exemplars can link a metric spike to example trace IDs."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-13',
      difficulty: 'expert',
      question:
        'You need a feature: "show accounts within 3 hops of a known fraudulent account that share a device or card". Which statements are accurate? Select ALL that apply.',
      options: [
        'In a relational database this requires recursive joins whose intermediate result can grow roughly as degree^hops',
        'A graph database traverses adjacency directly, so cost is proportional to the edges visited rather than table size',
        'Graph databases partition trivially across hundreds of nodes because edges are local',
        'Precomputing connected components offline (e.g. Spark GraphFrames) can answer "same ring" queries quickly at the cost of freshness',
      ],
      correct: [0, 1, 3],
      explanation:
        'Multi-hop relational queries expand like degree^hops (200³ = 8M rows at 3 hops), while native graph traversal follows adjacency pointers so work is proportional to edges visited. Offline component computation trades freshness for fast lookups and is a common production pattern for fraud rings. Graph partitioning is notoriously hard because edges cross partitions, making distributed traversal expensive.',
      followUps: [
        {
          "q": "You precompute connected components nightly. A fraudster creates a new account at 10 AM using a known-bad card. How do you catch it the same day?",
          "a": "Add a real-time check on the write path. On signup or card add, look up the card fingerprint and device id in a key-value index (Redis or DynamoDB) mapping identifier to component_id and risk flag, which the nightly job writes. A hit on a known-bad component flags the account immediately, a single key lookup in milliseconds. For edges between two new entities, keep a streaming union-find or update the index incrementally as new links arrive, and let the nightly full recompute correct any drift."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-14',
      difficulty: 'medium',
      question:
        'You run SELECT count(*) FROM orders WHERE status = \'pending\' twice inside one READ COMMITTED transaction on Postgres. Between the two statements, another transaction inserts and commits a pending order. What do you observe, and what is it called?',
      options: [
        'The same count both times, because a transaction uses one snapshot',
        'An error, because the predicate changed during the transaction',
        'A higher count the second time — a dirty read',
        'A higher count the second time — a phantom, because READ COMMITTED takes a new snapshot per statement',
      ],
      correct: [3],
      explanation:
        'READ COMMITTED in Postgres takes a fresh snapshot for each statement, so newly committed rows matching the predicate appear — a phantom. A dirty read would involve uncommitted data, which Postgres never shows. One snapshot per transaction applies to REPEATABLE READ and SERIALIZABLE. No error is raised at READ COMMITTED.',
      followUps: [
        {
          "q": "The two counts feed a report that must be internally consistent. What do you change, and what does it cost?",
          "a": "Run the report in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction, so every statement uses the same snapshot and no phantoms appear between them. In Postgres the cost is small for short reports: there are no extra locks, and read-only transactions at RR can't get serialization failures. The real cost appears when the report runs long, because the old snapshot holds back vacuum. For long reports use `SERIALIZABLE READ ONLY DEFERRABLE` (which waits for a safe snapshot) or run it on a replica."
        }
      ],
    },
    {
      id: 'db-fundamentals-mcq-15',
      difficulty: 'expert',
      question:
        'A Cassandra table for user sessions uses default settings. The app deletes each session on logout (DELETE by partition key), about 50M deletes/day. Reads start failing with TombstoneOverwhelmingException on some queries. Which changes address this? Select ALL that apply.',
      options: [
        'Insert sessions with USING TTL so they expire without explicit deletes, and avoid range scans across expired data',
        'Increase replication factor to spread tombstones across more nodes',
        'Model queries so they never scan ranges containing many deleted rows (e.g. avoid "list all sessions for a user" over a huge partition)',
        'Lower gc_grace_seconds only if repairs reliably run more often than the new value, so tombstones can be purged sooner',
        'Switch to ALLOW FILTERING to skip tombstones',
      ],
      correct: [0, 2, 3],
      explanation:
        'TTLs avoid explicit delete traffic and pair well with time-ordered compaction; modeling reads to avoid scanning deleted ranges prevents the read path from accumulating tombstones; and gc_grace_seconds controls when tombstones become purgeable, but lowering it below your repair interval risks resurrecting deleted data. More replicas just replicate tombstones, and ALLOW FILTERING increases scanning, making the problem worse.',
      followUps: [
        {
          "q": "You switch to TTL with TWCS, but one service still issues explicit DELETEs on logout for security. Does that reintroduce the problem?",
          "a": "Partly. Each delete writes a tombstone that lives at least `gc_grace_seconds`, and TWCS can only drop an SSTable when everything in it has expired, so mixing deletes into TTL windows can keep old SSTables alive and leave tombstones in read paths. Better: make logout an overwrite of a small row with a short TTL (for example `revoked = true USING TTL 3600`), or keep revocations in a separate table that's read alongside the session. Keep reads key-based (single session id) rather than scanning ranges so tombstones aren't accumulated during reads."
        }
      ],
    },
  ],
};

export default topic;
