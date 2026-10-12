import type { Topic } from '../../types';

const topic: Topic = {
  id: 'cache-fundamentals',
  phase: 'caching',
  order: 1,
  title: 'Caching Patterns, Eviction & Redis/Memcached',
  subtitle:
    'Why and where to cache, read/write patterns, eviction policies (with an LRU implementation), Redis data structures, persistence and Cluster, Memcached, and multi-level caches.',
  estimatedMinutes: 85,
  sources: [
    'Alex Xu — System Design Interview Vol 1 (caching tier) and Vol 2 Ch 10 Gaming Leaderboard (Redis sorted sets)',
    'Redis documentation (data types, persistence, cluster spec, eviction)',
    'Memcached documentation',
  ],
  tags: ['cache', 'redis', 'memcached', 'cache-aside', 'write-through', 'write-back', 'lru', 'lfu', 'redis-cluster', 'multi-level-cache'],
  cheatSheet: [
    'Latency ladder: RAM ~100 ns, in-process cache ~0.1–1 µs, Redis in-DC ~0.2–1 ms RTT, indexed Postgres read ~1–5 ms, cross-region ~70–150 ms.',
    'DB load = (1 − hit ratio) × QPS: going from 90% to 99% hit ratio cuts DB reads 10×. Effective latency ≈ t_cache + miss_ratio × t_db.',
    'Cache-aside (lazy): read cache → miss → read DB → set with TTL; on write update DB then DELETE key. Default choice.',
    'Write-through = write cache+DB synchronously (fresh reads, slower writes); write-back = write cache, flush async (fast, risk of loss); write-around = write DB only (avoid polluting cache with write-once data).',
    'Eviction: LRU (recency), LFU (frequency, resists scans), TTL (freshness), W-TinyLFU (Caffeine) best general hit ratio. Redis LRU/LFU are sampled approximations.',
    'Redis: single-threaded command execution (~100K+ ops/s/instance, ~1M with pipelining), rich types: string, hash, list, set, zset, stream, bitmap, HyperLogLog, geo.',
    'Persistence: RDB = periodic fork snapshots (compact, lose minutes); AOF everysec = lose ≤ ~1 s; both = fast restart + durability. A pure cache often needs neither.',
    'Redis Cluster: 16,384 hash slots (CRC16 mod 16384), multi-key ops only within one slot → use hash tags {user:42}; clients follow MOVED/ASK.',
    'Memcached: multi-threaded, slab allocator, strings only, no persistence/replication, 1 MB default item limit — simple, very fast KV cache.',
    'L1 (in-process, µs, per-instance, small) + L2 (Redis, shared, ms) cuts Redis load and latency; don’t cache per-user data with low reuse, secrets, or data needing strict consistency.',
  ],
  sections: [
    {
      heading: 'Why cache: latency, load and the hit-ratio math',
      body: `**Intuition:** a cache is the notepad on your desk. Walking to the filing room (the database) every time is slow and wears the filing clerk out; jotting the most-asked answers on the notepad makes most lookups instant — as long as you remember the notepad can be out of date.

**Two reasons to cache**

1. **Latency** — serve from memory instead of disk/network/compute.
2. **Load shedding** — protect an expensive or fragile backend (DB, third-party API, ML model) so it serves only misses.

**Latency ladder (ballpark)**

| Operation | Time |
|---|---|
| L1 CPU cache / RAM access | ~1 ns / ~100 ns |
| In-process LRU lookup (Node Map) | ~0.1–1 µs |
| Redis GET, same AZ | ~0.2–0.5 ms RTT (p99 ~1–2 ms) |
| Redis GET, cross-AZ | ~0.5–1.5 ms |
| Indexed Postgres read (hot pages) | ~1–5 ms |
| Complex query / aggregation | 20 ms – seconds |
| Cross-region round trip | ~70–150 ms |

**Hit-ratio math**

- DB QPS = total QPS × (1 − h). At 50K QPS: h = 90% → 5K DB QPS; h = 99% → 500. **Each "nine" is 10× less load.**
- Effective latency ≈ t_cache + (1 − h) × t_db (a miss pays both). With t_cache 0.5 ms, t_db 10 ms: h 90% → 1.5 ms, h 99% → 0.6 ms.
- The **miss path defines your capacity**: if the cache is cold or down, the DB must survive (1 − 0) × QPS — plan for it (warming, fallback, load shedding — see cache-failures).

**What makes data cacheable:** read ≫ write, tolerance for some staleness, expensive to compute, and high reuse (many reads per key within the TTL). Popularity is usually Zipfian: a few percent of keys get most reads, so a cache holding 5–20% of the data can often achieve 80–95%+ hits.`,
      code: [
        {
          language: 'typescript',
          title: 'Quick model: what hit ratio do I need?',
          code: `interface Load { qps: number; dbCapacityQps: number; tCacheMs: number; tDbMs: number }

// Minimum hit ratio so the DB serves only what it can handle (with 30% headroom)
export function requiredHitRatio({ qps, dbCapacityQps }: Load, headroom = 0.7): number {
  const allowedMisses = dbCapacityQps * headroom;
  return Math.max(0, 1 - allowedMisses / qps);
}

export function effectiveLatencyMs({ tCacheMs, tDbMs }: Load, hitRatio: number): number {
  return tCacheMs + (1 - hitRatio) * tDbMs;        // a miss pays cache check + DB
}

const load: Load = { qps: 60_000, dbCapacityQps: 8_000, tCacheMs: 0.5, tDbMs: 12 };
console.log(requiredHitRatio(load).toFixed(3));   // 0.907 -> need >= ~91% hits
console.log(effectiveLatencyMs(load, 0.95));      // 1.1 ms average`,
        },
      ],
      keyPoints: [
        'Each additional nine of hit ratio cuts backend load by 10×.',
        'Size the DB for the miss path, including cold-cache scenarios.',
        'Cache what is read-heavy, reused, expensive and staleness-tolerant.',
      ],
    },
    {
      heading: 'Where to cache: the layers',
      body: `**Intuition:** caching is like keeping water — a glass in your hand (client), a jug on the table (CDN/edge), a fridge (app memory), a water tank on the roof (Redis) and the reservoir (database buffer pool). Closer is faster but smaller and harder to keep fresh.

| Layer | Examples | Latency | Scope | Invalidation difficulty |
|---|---|---|---|---|
| Client / browser | HTTP Cache-Control, ETag, service worker | 0 (no request) | Per user | Hard (you don't control clients) |
| CDN / edge | CloudFront, Fastly, Cloudflare | 10–30 ms from user | Per PoP | Purge APIs, surrogate keys |
| API gateway / reverse proxy | nginx proxy_cache, Varnish | sub-ms in DC | Per node | Medium |
| **In-process (L1)** | lru-cache in Node, Caffeine in Java | ~µs | Per instance | Hard across N instances |
| **Distributed (L2)** | Redis, Memcached, ElastiCache | ~0.3–1 ms | Shared | Single place to delete |
| Database | Postgres shared_buffers, MySQL buffer pool, materialized views | ms | DB | Automatic (pages) / refresh |

**Rules of thumb**

- Cache **as close to the consumer as the freshness requirement allows**. Public, identical-for-everyone data (product images, catalog pages) → CDN. Per-user but shared across instances → Redis. Tiny, hot, rarely-changing (config, feature flags, exchange rates) → in-process.
- Every layer adds a **staleness window** and an **invalidation path**. Stacking a 60 s CDN TTL on a 60 s Redis TTL on a 30 s L1 TTL can serve data up to ~150 s old.
- Don't forget the database already caches pages: if your working set fits in shared_buffers and queries are indexed, the "slow DB" may be a query/index problem, not a caching problem.
- CDN and HTTP caching are covered in *cdn-global*; this topic focuses on application caches.`,
      keyPoints: [
        'Closer caches are faster but harder to invalidate.',
        'Staleness adds up across stacked layers.',
        'Check indexes and query plans before adding a cache.',
      ],
    },
    {
      heading: 'Read patterns: cache-aside and read-through',
      body: `**Intuition:** cache-aside is you checking the notepad and, if the answer isn't there, going to the filing room yourself and writing it down. Read-through is having an assistant who does the filing-room trip for you whenever the notepad is blank.

**Cache-aside (lazy loading)** — the application owns the logic:

1. \`GET key\` from cache → hit: return.
2. Miss: read from DB → \`SET key value EX ttl\` → return.
3. On write: update DB, then **delete** the key (not update it — deleting avoids racing writers leaving an old value; details in *cache-failures*).

Pros: only requested data is cached; cache failure ≠ outage (fall back to DB); works with any datastore. Cons: first request per key is slow (miss penalty); code duplicated across services unless wrapped; stale until TTL/delete.

**Read-through** — the cache (or a library in front of it) loads missing entries via a loader function: Caffeine/Guava \`LoadingCache\`, NCache, DAX for DynamoDB, or your own wrapper. Pros: one place for loading logic, easy to add **request coalescing** (single-flight). Cons: the cache layer needs to know how to read the DB; less flexible per call site.

**Key design**

- Namespace + version + identifier: \`catalog:v3:product:42\`. Bumping \`v3\` → \`v4\` on a schema change invalidates everything logically without \`FLUSHALL\`.
- Include every input that changes the output: locale, currency, tenant, feature flag, user role.
- Keep keys short but readable; avoid unbounded user input in keys (hash it).

**TTL** — always set one (even hours), as a safety net for missed invalidations; add **jitter** (±10–20%) so keys written together don't expire together.`,
      code: [
        {
          language: 'typescript',
          title: 'Cache-aside with ioredis: TTL + jitter, negative-safe, Redis failure falls back to DB',
          code: `import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis({ host: 'cache.internal', maxRetriesPerRequest: 1, commandTimeout: 50 });
const pg = new Pool({ max: 20 });

interface Product { id: string; name: string; priceCents: number; updatedAt: string }

const key = (id: string) => 'catalog:v3:product:' + id;
const ttlWithJitter = (base: number) => Math.round(base * (0.9 + Math.random() * 0.2));

export async function getProduct(id: string): Promise<Product | null> {
  try {
    const cached = await redis.get(key(id));
    if (cached !== null) return JSON.parse(cached) as Product;   // hit
  } catch {
    // Redis slow/down: fall through to DB (protect DB separately with limits)
  }

  const { rows } = await pg.query<Product>(
    'SELECT id, name, price_cents AS "priceCents", updated_at AS "updatedAt" FROM products WHERE id = $1',
    [id],
  );
  const product = rows[0] ?? null;

  if (product) {
    redis.set(key(id), JSON.stringify(product), 'EX', ttlWithJitter(600)).catch(() => {}); // best effort
  }
  return product;
}

export async function updatePrice(id: string, priceCents: number): Promise<void> {
  await pg.query('UPDATE products SET price_cents = $2, updated_at = now() WHERE id = $1', [id, priceCents]);
  await redis.del(key(id)).catch(() => {});   // delete, don't set: next read repopulates
}`,
        },
      ],
      keyPoints: [
        'Cache-aside: app loads on miss, deletes on write; cache outage degrades to DB.',
        'Read-through centralises loading and makes single-flight easy.',
        'Versioned, fully-qualified keys and jittered TTLs are non-negotiable.',
      ],
    },
    {
      heading: 'Write patterns: write-through, write-back, write-around',
      body: `**Intuition:** when you change an answer — do you update the notepad and the filing room together (write-through), update the notepad now and file it later (write-back), or file it and leave the notepad alone (write-around)?

| Pattern | Write path | Read freshness | Write latency | Risk | Good for |
|---|---|---|---|---|---|
| **Cache-aside + delete** | DB, then delete key | Fresh after next miss | DB latency | Small race windows | Default for most CRUD |
| **Write-through** | Cache and DB synchronously (via cache layer or app) | Fresh immediately | DB + cache | Partial failure between the two; caches data never read | Read-after-write heavy data (profiles, carts) |
| **Write-back / write-behind** | Cache now, DB asynchronously in batches | Cache is source of truth until flush | Very low | **Data loss** if cache dies before flush; ordering; DB lags | Counters, likes, view counts, telemetry, rate-limit windows |
| **Write-around** | DB only, cache untouched | Stale until TTL/miss | DB latency | Recently written data misses | Write-once/read-rarely data (logs, bulk imports) |
| **Refresh-ahead** | Background refresh before TTL expiry | Fresh for hot keys | n/a | Wasted refreshes on cold keys | Hot, predictable keys (home page, config) |

**Write-back in practice.** Buffer increments in Redis (\`INCRBY\` / \`HINCRBY\`), flush every N seconds or M ops to the DB with a single batched \`UPDATE … FROM (VALUES …)\`. You trade durability (lose up to one flush interval + Redis persistence window) for 100–1000× fewer DB writes. Make flushes idempotent (e.g. \`GETDEL\`/\`RENAME\` the buffer key atomically before flushing) so a crashed flusher doesn't double-count.

**Write-through gotcha.** "Write to cache and DB" in app code is **not atomic**: if the DB write fails after the cache write, the cache holds data that doesn't exist; if the cache write fails, readers see stale data until TTL. Order it DB-first, then cache (or delete), and keep TTLs as the safety net.`,
      code: [
        {
          language: 'typescript',
          title: 'Write-behind counters: buffer in Redis, flush in batches safely',
          code: `import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis();
const pg = new Pool();

// Hot path: O(1) Redis op instead of a DB row update per view
export async function recordView(postId: string): Promise<void> {
  await redis.hincrby('views:buffer', postId, 1);
}

// Runs every 5s on one worker (e.g. with a Redis lock or a single cron pod)
export async function flushViews(): Promise<void> {
  const batchKey = 'views:flushing:' + Date.now();
  // Atomically move the buffer aside so new increments go to a fresh hash
  const moved = await redis.renamenx('views:buffer', batchKey).catch(() => 0);
  if (!moved) return;                                        // nothing buffered

  const counts = await redis.hgetall(batchKey);
  const ids = Object.keys(counts);
  if (ids.length > 0) {
    // One statement for the whole batch
    await pg.query(
      'UPDATE posts p SET views = p.views + v.n FROM unnest($1::text[], $2::int[]) AS v(id, n) WHERE p.id = v.id',
      [ids, ids.map((id) => Number(counts[id]))],
    );
  }
  await redis.del(batchKey);   // on crash before this, a recovery job re-flushes leftover views:flushing:* keys
}`,
        },
      ],
      keyPoints: [
        'Cache-aside + delete is the default; write-through for read-after-write freshness.',
        'Write-back trades durability for massive write reduction — only for loss-tolerant data.',
        'App-level “write both” is never atomic: order DB first, keep TTL safety net.',
      ],
    },
    {
      heading: 'Eviction policies and an O(1) LRU implementation',
      body: `**Intuition:** your notepad has 20 lines. When it's full you must erase something — the thing you haven't looked at for longest (LRU), the thing you look at least often (LFU), or the thing that's gone stale (TTL).

| Policy | Evicts | Strength | Weakness |
|---|---|---|---|
| **LRU** | Least recently used | Simple, good for recency-skewed workloads | A one-off scan (batch job, crawler) flushes the hot set |
| **LFU** | Least frequently used (with decay) | Resists scans, keeps long-term popular items | Slow to adapt to new hot items without decay |
| **FIFO** | Oldest inserted | Trivial | Ignores popularity |
| **Random** | Random key | Zero bookkeeping | Unpredictable |
| **TTL-based** | Expired / soonest-expiring | Freshness guarantee | Not a capacity policy by itself |
| **W-TinyLFU** (Caffeine) | Admission filter (frequency sketch) + LRU windows | Near-optimal hit ratio across workloads | More complex |
| **ARC / 2Q** | Balances recency and frequency lists | Scan-resistant | Complexity, patents (ARC) |

**Redis specifics.** \`maxmemory\` + \`maxmemory-policy\`: \`noeviction\` (default — writes fail with OOM errors when full), \`allkeys-lru\`, \`allkeys-lfu\`, \`volatile-lru\`/\`volatile-lfu\`/\`volatile-ttl\`/\`volatile-random\` (only keys with a TTL), \`allkeys-random\`. Redis LRU/LFU are **approximate**: it samples \`maxmemory-samples\` keys (default 5) and evicts the best candidate. For a pure cache use \`allkeys-lru\` or \`allkeys-lfu\`.

**Implementing LRU in O(1).** Classic: hash map + doubly linked list. In JavaScript, \`Map\` preserves insertion order, so "move to most-recent" = delete + re-insert, and "least recent" = the first key.`,
      code: [
        {
          language: 'typescript',
          title: 'O(1) LRU cache with TTL and max entries using Map insertion order',
          code: `export class LruCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {
    if (maxEntries <= 0) throw new Error('maxEntries must be > 0');
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {          // lazy expiry on read
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);                         // move to most-recent position
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    if (this.map.has(key)) this.map.delete(key);  // refresh position
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string; // first = least recent
      this.map.delete(oldest);
    }
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

// const l1 = new LruCache<Product>(10_000, 30_000);  // 10K entries, 30s TTL`,
        },
      ],
      keyPoints: [
        'LRU for recency, LFU for long-term popularity and scan resistance.',
        'Redis default maxmemory-policy is noeviction — set allkeys-lru/lfu for caches.',
        'JS Map insertion order gives an O(1) LRU in a few lines.',
      ],
    },
    {
      heading: 'Redis: data structures, threading and persistence',
      body: `**Intuition:** Redis isn't just a key→string dictionary; it's a toolbox of in-memory data structures with atomic operations, so you can push logic (counting, ranking, dedup) to the data instead of fetching and rewriting blobs.

**Data structures and cache-relevant uses**

| Type | Typical use | Key commands |
|---|---|---|
| String | Serialized objects, counters, locks | GET/SET EX NX, INCRBY, MGET |
| Hash | Object with fields (partial updates) | HGET/HSET, HINCRBY, HGETALL |
| List | Recent items, simple queues | LPUSH, LTRIM, LRANGE |
| Set | Membership, tags, dedup | SADD, SISMEMBER, SINTER |
| Sorted set | Leaderboards, time-ordered feeds, rate windows | ZADD, ZINCRBY, ZREVRANGE, ZRANGEBYSCORE |
| Stream | Event log with consumer groups | XADD, XREADGROUP, XACK |
| Bitmap / HyperLogLog | Daily active flags; approximate unique counts (~0.81% error, 12 KB) | SETBIT/BITCOUNT, PFADD/PFCOUNT |
| Geo | Nearby search | GEOADD, GEOSEARCH |

**Threading and throughput.** Commands execute on a **single thread** (atomic, no locks), so one slow command (\`KEYS *\`, \`HGETALL\` on a 1M-field hash, big \`SMEMBERS\`, Lua loops) blocks everyone. Redis 6+ can use I/O threads for socket reads/writes. Ballpark: ~100K–200K simple ops/s per instance; ~1M/s with pipelining. Scale throughput by sharding (Cluster), reads by replicas.

**Persistence**

| Mode | How | Data loss on crash | Cost |
|---|---|---|---|
| None | Pure memory | Everything | Fastest; restart = cold cache |
| **RDB** | Periodic \`fork()\` snapshot (copy-on-write) | Since last snapshot (minutes) | Fork pause grows with memory size; CoW can use up to 2× memory under heavy writes |
| **AOF** | Append every write; \`appendfsync everysec\` | ≤ ~1 s (everysec) | Bigger files, rewrite compaction |
| RDB + AOF | AOF for durability, RDB-preamble for fast load | ≤ ~1 s | Most robust |

For a **pure cache**, persistence mostly buys faster warm restarts; many teams disable AOF and keep RDB (or nothing). For Redis as a **primary store** (sessions, rate limits, queues), use AOF everysec + replicas — and remember replication is **asynchronous**: a failover can lose recent acknowledged writes.`,
      code: [
        {
          language: 'text',
          title: 'redis.conf essentials for a cache node',
          code: `# Memory: leave ~25-30% headroom for fragmentation, replication buffers, fork CoW
maxmemory 12gb
maxmemory-policy allkeys-lfu      # pure cache: evict anything; LFU resists scans
maxmemory-samples 10              # better approximation, tiny CPU cost

# Persistence: cache only -> snapshots for warm restart, no AOF
save 3600 1                       # snapshot hourly if >= 1 change
appendonly no

# Protect the single thread
slowlog-log-slower-than 10000     # log commands slower than 10 ms
rename-command KEYS ""            # disable KEYS in prod; use SCAN
lazyfree-lazy-eviction yes        # free big evicted values in background thread
lazyfree-lazy-expire yes

# Clients
timeout 300
tcp-keepalive 60`,
        },
      ],
      keyPoints: [
        'Pick the data structure that makes the operation atomic server-side.',
        'Single-threaded execution: one O(N) command stalls everyone.',
        'Persistence choice depends on whether Redis is a cache or a source of truth.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 10 (Redis sorted sets for leaderboards)',
    },
    {
      heading: 'Redis Cluster, replication and hash tags',
      body: `**Intuition:** one notepad can't hold everything, so you split it across several notepads by the first letter of the topic — except Redis uses 16,384 "letters" (slots), so you can move a few at a time between notepads.

**Topologies**

- **Single primary + replicas + Sentinel** — Sentinel monitors and promotes a replica on failure; clients ask Sentinel for the current primary. Scales reads, not writes/memory.
- **Redis Cluster** — data sharded across primaries by **hash slot**: \`slot = CRC16(key) mod 16384\`. Each primary owns a range of slots and has replicas; failover is built in (majority of primaries must agree). Clients cache the slot map and follow **MOVED** (slot permanently moved) and **ASK** (slot migrating) redirects.
- Managed: ElastiCache/MemoryDB, Upstash, Redis Cloud.

**Multi-key operations** (MGET, transactions, Lua scripts touching several keys) only work if all keys are in the **same slot**. Force co-location with **hash tags**: only the substring inside \`{...}\` is hashed, so \`cart:{u42}:items\` and \`cart:{u42}:meta\` land together. Beware: a hash tag that's too coarse (\`{tenant}\` for a giant tenant) creates a hot shard.

**Resharding** moves slots between nodes online (\`redis-cli --cluster reshard\`), key by key with MIGRATE. Large keys (10+ MB) make migration slow and block.

**Replication is async.** A primary acks a write before replicas have it; on failover, the last few ms–s of writes can vanish. \`WAIT numreplicas timeout\` reduces (not eliminates) the risk.

**Sizing rules of thumb:** keep each shard ≤ ~25 GB (faster failover, fork, resync); keep ~25–30% memory headroom; per-key overhead ~50–100 bytes, so 100M tiny keys cost ~5–10 GB just in overhead — use hashes to pack small fields.`,
      code: [
        {
          language: 'typescript',
          title: 'ioredis Cluster with hash tags for atomic multi-key ops',
          code: `import { Cluster } from 'ioredis';

const cluster = new Cluster(
  [{ host: 'redis-0.cache', port: 6379 }, { host: 'redis-1.cache', port: 6379 }],
  {
    scaleReads: 'slave',                    // spread reads to replicas (may be slightly stale)
    redisOptions: { commandTimeout: 100, maxRetriesPerRequest: 2 },
    slotsRefreshTimeout: 2000,
  },
);

// Both keys hash only "u42" -> same slot -> MULTI/EXEC and Lua are allowed
const itemsKey = (userId: string) => 'cart:{' + userId + '}:items';
const metaKey = (userId: string) => 'cart:{' + userId + '}:meta';

export async function addToCart(userId: string, sku: string, qty: number): Promise<void> {
  await cluster
    .multi()
    .hincrby(itemsKey(userId), sku, qty)
    .hset(metaKey(userId), 'updatedAt', Date.now().toString())
    .expire(itemsKey(userId), 7 * 24 * 3600)
    .expire(metaKey(userId), 7 * 24 * 3600)
    .exec();                                // CROSSSLOT error without the {tag}
}`,
        },
      ],
      keyPoints: [
        '16,384 slots via CRC16; clients follow MOVED/ASK.',
        'Hash tags co-locate keys for multi-key atomic ops — but can create hot shards.',
        'Async replication: failover may lose recent writes.',
      ],
    },
    {
      heading: 'Redis vs Memcached',
      body: `**Intuition:** Memcached is a very fast, very simple locker room — put a box in, take a box out. Redis is a workshop — lockers plus tools to modify what's inside without taking it out.

| | Redis | Memcached |
|---|---|---|
| Data model | Rich types (hash, zset, stream, …) | Opaque strings/bytes |
| Threading | Single-threaded execution (+ I/O threads) | Multi-threaded, scales with cores on one box |
| Max value | 512 MB (keep ≪ 1 MB in practice) | 1 MB default (configurable) |
| Memory mgmt | jemalloc; fragmentation to watch | Slab allocator: predictable, but slab calcification can waste memory |
| Eviction | Configurable policies (LRU/LFU/TTL/random) | LRU per slab class (segmented LRU) |
| Persistence | RDB/AOF | None |
| Replication / HA | Replicas, Sentinel, Cluster | None built-in (client-side sharding, consistent hashing) |
| Atomic ops | INCR, Lua, MULTI, WATCH | incr/decr, CAS |
| Pub/Sub, streams | Yes | No |
| Typical use | Cache + sessions + counters + leaderboards + rate limits + queues | Pure look-aside cache of serialized objects/HTML |

**Choose Memcached** when you need a pure, huge, multi-threaded look-aside cache of blobs and operational simplicity (Facebook's classic deployment). **Choose Redis** (the default today) when you want data structures, persistence/HA, or one system for cache + sessions + counters. Losing a Memcached node just means misses for its keys (with consistent hashing, only ~1/N).`,
      keyPoints: [
        'Memcached: multi-threaded, simple blobs, no persistence/replication.',
        'Redis: data structures, HA, persistence, Lua — the default choice.',
        'Either way, the DB must survive the misses when a node disappears.',
      ],
    },
    {
      heading: 'Local vs distributed vs multi-level (L1/L2) caches and serialization cost',
      body: `**Intuition:** keeping a copy of the most-used answers in your own head (L1) beats even the notepad on your desk (L2) — but every colleague has their own head, and they won't all update at the same time.

| | In-process (L1) | Distributed (L2: Redis) |
|---|---|---|
| Latency | ~µs, no network, no serialization | ~0.3–1 ms + (de)serialization |
| Capacity | Limited by heap; each instance duplicates data | Tens–hundreds of GB shared |
| Consistency | N independent copies, invalidation is hard | One copy to delete |
| Failure impact | Restart = cold L1 per pod | Outage affects all instances |
| GC impact | Large heaps → GC pauses (Node/JVM) | None on the app |

**Multi-level pattern:** L1 small (1K–100K entries, 5–60 s TTL) for the hottest keys → L2 Redis (minutes–hours TTL) → DB. L1 absorbs hot keys (protects Redis shards), shaves ~1 ms, and survives brief Redis blips. Invalidate L1 via short TTLs or pub/sub broadcast (see *cache-failures*).

**Serialization is not free**

- \`JSON.parse\` of a 100 KB object costs roughly ~0.5–1 ms of CPU in Node — on the event loop. At 5K RPS that's 2.5–5 cores just parsing.
- Big values also cost network: 200 KB × 20K QPS = 4 GB/s ≈ 32 Gbps — beyond one Redis node's NIC.
- Mitigations: cache **only the fields you need**, split large objects (hash fields), compress (gzip/zstd/lz4 for > ~1 KB of text), use MessagePack/protobuf for speed and size, and keep values ideally < 100 KB.

**What NOT to cache**

- Data needing strict read-your-write or linearizable reads (balances, inventory at checkout) — or cache with explicit versioning and bypass on critical paths.
- Rarely re-read data (one-off reports, per-request unique results) — pure overhead and eviction pressure.
- Secrets/PII without encryption and access control; highly personalised pages with low reuse.
- Things cheaper to compute than to fetch (a 20 µs computation vs a 500 µs Redis round trip).
- Errors and timeouts (unless deliberately as short negative cache entries).`,
      code: [
        {
          language: 'typescript',
          title: 'Two-level cache: in-process L1 in front of Redis L2',
          code: `import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';

const redis = new Redis({ commandTimeout: 50, maxRetriesPerRequest: 1 });
const l1 = new LRUCache<string, object>({ max: 20_000, ttl: 15_000 }); // 15s: bounded staleness

export async function getCached<T extends object>(
  key: string,
  load: () => Promise<T | null>,
  l2TtlSec = 600,
): Promise<T | null> {
  const local = l1.get(key);
  if (local) return local as T;                      // ~µs, no network, no parse

  try {
    const raw = await redis.get(key);
    if (raw !== null) {
      const value = JSON.parse(raw) as T;            // parse once, then reuse object from L1
      l1.set(key, value);
      return value;
    }
  } catch {
    /* Redis unavailable: continue to loader */
  }

  const fresh = await load();
  if (fresh) {
    l1.set(key, fresh);
    redis.set(key, JSON.stringify(fresh), 'EX', l2TtlSec).catch(() => {});
  }
  return fresh;
}
// Note: objects in L1 are shared references — treat them as immutable.`,
        },
      ],
      keyPoints: [
        'L1 for tiny hot data with short TTL; L2 for shared, larger data.',
        'Serialization and value size can dominate cost; cache only needed fields.',
        'Don’t cache low-reuse, strictly consistent, or secret data.',
      ],
    },
    {
      heading: 'Scenario: “The database is getting slow — introduce caching”',
      body: `**Intuition:** before buying a bigger notepad, check whether you're asking the filing clerk the same question 10,000 times, or asking an impossible question once.

**Step 1 — Measure before caching.** \`pg_stat_statements\`: top queries by total time and calls. Check query plans (missing index? sequential scans? N+1 from the ORM?), connection pool saturation, lock waits, replication lag. Often the fix is an index or batching, not a cache.

**Step 2 — Find cacheable hot paths.** Look for read-heavy queries with high repetition and tolerance for staleness: product/catalog reads, user profiles, config, permission lookups, aggregated counts. Estimate reuse: calls per distinct key per TTL window. A query called 20K times/min over 2K distinct keys with 60 s TTL → ~10 reads per key per fill → ~90% hit ratio.

**Step 3 — Choose the pattern.** Cache-aside with delete-on-write for entities; TTL-only for aggregates that can be a minute stale; write-back only for loss-tolerant counters. Consider read replicas for queries that must be fresh-ish but not cached.

**Step 4 — Design keys, TTLs and invalidation.** Versioned keys, TTL with jitter, delete on write in the same code path as the DB update (or via CDC — see *cache-failures*).

**Step 5 — Protect the miss path.** Single-flight per key, timeouts on Redis (50–100 ms), fallback to DB with a concurrency limit, circuit breaker if Redis is down.

**Step 6 — Roll out safely.** Feature-flag per endpoint; shadow-read (compare cached vs DB for a sample) to catch invalidation bugs; warm the hottest keys before switching on.

**Step 7 — Observe.** Hit ratio per key prefix, Redis latency p99, memory and evictions, DB QPS before/after, stale-read incidents. Target: DB CPU down, p99 down, no correctness regressions.

**Say in interviews:** "Caching is a trade of freshness and complexity for latency and load. I'd first confirm the bottleneck, then cache the highest-reuse reads with cache-aside, protect the miss path, and measure hit ratio and staleness."`,
      code: [
        {
          language: 'sql',
          title: 'Find what to fix or cache first (Postgres)',
          code: `-- Top statements by total time: candidates for indexing or caching
SELECT
  left(query, 80)                         AS query,
  calls,
  round(total_exec_time::numeric, 0)      AS total_ms,
  round(mean_exec_time::numeric, 2)       AS mean_ms,
  round(100 * total_exec_time / sum(total_exec_time) OVER (), 1) AS pct_time,
  rows / NULLIF(calls, 0)                 AS rows_per_call
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 15;

-- High calls + low mean_ms + identical parameters => caching candidate
-- High mean_ms + few calls                     => fix plan / index first
-- Check buffer cache hit ratio (should be > ~99% for OLTP)
SELECT sum(blks_hit) * 100.0 / NULLIF(sum(blks_hit) + sum(blks_read), 0) AS buffer_hit_pct
FROM pg_stat_database;`,
        },
      ],
      keyPoints: [
        'Diagnose first: indexes, N+1 and pool saturation are common real causes.',
        'Cache high-reuse, staleness-tolerant reads; protect the miss path.',
        'Roll out behind flags with hit-ratio and staleness metrics.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'cache-fundamentals-cc-1',
      title: 'Production-proof a naive cache-aside helper',
      context:
        'A NestJS service added this helper to cache user profiles. Since then: memory grows until pods OOM, some users see "undefined" profiles, a Redis blip caused a full outage, a price field shows as a string, and an admin "clear cache" endpoint froze Redis for 8 seconds.',
      task:
        'Rewrite the helper and invalidation so the cache is bounded, correct for missing rows, resilient to Redis failures, safe to invalidate, and has sane expiry.',
      starter: {
        language: 'typescript',
        code: `import Redis from 'ioredis';

const redis = new Redis();
const local: Record<string, any> = {};           // "extra speed"

export async function cached(key: string, load: () => Promise<any>) {
  if (local[key]) return local[key];

  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);

  const value = await load();                     // may return null for unknown ids
  await redis.set(key, JSON.stringify(value));    // no TTL: "we invalidate on write"
  local[key] = value;
  return value;
}

export async function clearUserCache() {
  const keys = await redis.keys('user:*');         // millions of keys
  if (keys.length) await redis.del(...keys);
}

// usage: cached('user:' + id, () => repo.findOne(id))`,
      },
      hints: [
        'What bounds the size of local, and what makes its entries ever go stale or go away?',
        'What does JSON.stringify(undefined) return, and what gets stored for a missing user? What does if (hit) do for an empty string or "0"?',
        'KEYS is O(N) on a single-threaded server. How can you invalidate a whole class of keys without touching each one?',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';

const redis = new Redis({ commandTimeout: 50, maxRetriesPerRequest: 1 });
const l1 = new LRUCache<string, { v: unknown }>({ max: 10_000, ttl: 10_000 }); // bounded, 10s
const NULL_SENTINEL = '__null__';

const jitter = (sec: number) => Math.round(sec * (0.9 + Math.random() * 0.2));

let userNs = 'v1';                                  // namespace version for bulk invalidation
export async function refreshNamespace() {
  userNs = (await redis.get('ns:user').catch(() => null)) ?? userNs;
}

export function userKey(id: string) {
  return 'user:' + userNs + ':' + id;
}

export async function cached<T>(
  key: string,
  load: () => Promise<T | null>,
  ttlSec = 900,
  reviver?: (raw: unknown) => T,                  // e.g. rebuild Date / numeric types
): Promise<T | null> {
  const local = l1.get(key);
  if (local) return local.v as T | null;

  try {
    const hit = await redis.get(key);
    if (hit !== null) {                           // '' and '0' are valid hits
      const value = hit === NULL_SENTINEL ? null : (reviver ? reviver(JSON.parse(hit)) : (JSON.parse(hit) as T));
      l1.set(key, { v: value });
      return value;
    }
  } catch {
    // Redis down/slow -> degrade to loader instead of failing the request
  }

  const value = await load();
  const payload = value === null || value === undefined ? NULL_SENTINEL : JSON.stringify(value);
  const ttl = value == null ? 60 : jitter(ttlSec);  // short negative TTL
  redis.set(key, payload, 'EX', ttl).catch(() => {});
  l1.set(key, { v: value ?? null });
  return value ?? null;
}

// Bulk invalidation in O(1): bump the namespace; old keys age out via TTL
export async function clearUserCache(): Promise<void> {
  const next = 'v' + Date.now();
  await redis.set('ns:user', next);
  userNs = next;                                  // other pods pick it up via refreshNamespace()
}`,
      },
      explanation: `**Fixes**

- **Unbounded local map**: \`local\` grew forever, which caused the OOMs, and it never expired, so stale data lived until restart. Replaced with a bounded LRU (10K entries, 10 s TTL).
- **Missing rows**: \`JSON.stringify(undefined)\` returns undefined, so ioredis stores the string "undefined" and later \`JSON.parse('undefined')\` throws. Missing users now get an explicit sentinel with a short TTL (negative caching), and \`hit !== null\` treats '' and '0' as real hits.
- **No TTL**: any missed invalidation meant stale data forever. Now every key has a jittered TTL.
- **Redis outage → full outage**: every Redis error was thrown to users. Now a 50 ms command timeout and a try/catch degrade to the loader. The DB still needs its own concurrency limits, covered in cache-failures.
- **Type drift**: JSON loses Dates, and numeric fields stored as strings upstream stay strings. An optional reviver restores types, or you can use a schema (zod) or MessagePack.
- **KEYS + giant DEL**: an O(N) scan on the single thread blocked Redis for seconds. Namespace versioning invalidates everything in O(1), and old keys expire through their TTL. If you really must delete, use SCAN with UNLINK in batches.`,
      followUps: [
        {
          "q": "Each pod reads the namespace version only through refreshNamespace(). How do other pods learn about a bump, and what's the staleness?",
          "a": "Call refreshNamespace() on a timer, say every 5 s, and also subscribe to a pub/sub channel the admin endpoint publishes to for near-instant pickup. Worst case after a bump, a pod keeps using the old namespace until its next poll, so 5 s, plus its L1 TTL of 10 s. To bound it tighter, include the namespace in the L1 key (so a bump also misses L1) and let pub/sub trigger an immediate refresh, keeping polling as a fallback for lost messages."
        },
        {
          "q": "How would you unit-test this helper without a real Redis?",
          "a": "Inject the Redis client rather than constructing it at module level, then use ioredis-mock or a hand-written fake implementing get, set and eval. Test cases: a missing row stores the NULL sentinel with a 60 s TTL and returns null on the next call without invoking the loader; '0' and '' are returned as hits; a get that throws still returns the loader's value; the TTL lies within ±10% of 900; clearUserCache changes the key prefix so the next read calls the loader. Use fake timers for L1 expiry."
        }
      ],
    },
    {
      id: 'cache-fundamentals-cc-2',
      title: 'Fix a slow, subtly wrong LRU cache',
      context:
        'A pricing service uses this in-process LRU for exchange rates and tax rules. Under load, CPU is high, the hit ratio is poor, and occasionally an expired rate is served for hours.',
      task:
        'Make get/set O(1), make recency updates correct, enforce TTL correctly, and evict the right entry.',
      starter: {
        language: 'typescript',
        code: `export class Lru<V> {
  private keys: string[] = [];
  private values = new Map<string, { v: V; exp: number }>();

  constructor(private max: number, private ttlMs: number) {}

  get(key: string): V | undefined {
    const e = this.values.get(key);
    return e?.v;                          // recency not updated, expiry not checked
  }

  set(key: string, v: V) {
    this.values.set(key, { v, exp: Date.now() + this.ttlMs });
    this.keys.push(key);                  // duplicates on update
    if (this.keys.length > this.max) {
      const victim = this.keys.pop()!;    // evicts the NEWEST
      this.values.delete(victim);
    }
  }

  has(key: string) {
    return this.keys.indexOf(key) !== -1; // O(n)
  }
}`,
      },
      hints: [
        'Which end of the keys array holds the least recently used entry, and what does pop() remove?',
        'When a key is updated twice, how many times is it in keys[]? What happens to size accounting?',
        'JavaScript Map iterates in insertion order. How can you use that to get "least recent" in O(1)?',
      ],
      solution: {
        language: 'typescript',
        code: `export class Lru<V> {
  private readonly map = new Map<string, { v: V; exp: number }>();

  constructor(private readonly max: number, private readonly ttlMs: number) {
    if (max < 1) throw new Error('max must be >= 1');
  }

  private live(key: string): { v: V; exp: number } | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp <= Date.now()) {            // enforce TTL on every access
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  get(key: string): V | undefined {
    const e = this.live(key);
    if (!e) return undefined;
    this.map.delete(key);                 // move to most-recent (end of Map)
    this.map.set(key, e);
    return e.v;
  }

  set(key: string, v: V, ttlMs = this.ttlMs): void {
    this.map.delete(key);                 // no duplicates; refresh recency
    this.map.set(key, { v, exp: Date.now() + ttlMs });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string; // least recently used
      this.map.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.live(key) !== undefined;  // O(1), respects TTL, doesn't bump recency
  }

  // Optional: periodic sweep so expired-but-unread entries don't hold memory
  sweep(limit = 1000): void {
    const now = Date.now();
    let n = 0;
    for (const [k, e] of this.map) {
      if (e.exp <= now) this.map.delete(k);
      if (++n >= limit) break;
    }
  }
}`,
      },
      explanation: `**Fixes**

- **Wrong victim**: \`pop()\` removed the newest key, so every insert past capacity evicted the value just written. That explains the poor hit ratio. Now the first key in Map order, the least recently used, is evicted.
- **No recency update on get**: hot keys were evicted as if they were cold. \`get\` now deletes and re-inserts the key, moving it to the most-recent end.
- **TTL never enforced**: expired exchange rates were served for as long as they stayed resident. Expiry is now checked on every access, and \`sweep\` frees expired entries nobody reads.
- **Duplicate keys and O(n) scans**: updates pushed duplicate keys, which broke the size limit and forced \`indexOf\` scans. A single Map now provides O(1) get/set/has/evict.
- **For heavier needs**, use lru-cache (Node) or Caffeine/W-TinyLFU (JVM) instead of hand-rolled code.`,
      followUps: [
        {
          "q": "Twelve worker threads in a Java version of this service share the cache. What breaks, and what would you use?",
          "a": "LinkedHashMap in access-order mode mutates its internal list on every get, so concurrent gets corrupt it, not just concurrent sets. Wrapping it with Collections.synchronizedMap works but serialises every read through one lock, which becomes contention at high QPS. Use Caffeine instead: it buffers recency updates in striped ring buffers and applies them asynchronously, gives W-TinyLFU admission, per-entry TTL and loading caches with single-flight via computeIfAbsent semantics."
        },
        {
          "q": "Exchange rates change at known times. How would you make the cache refresh them ahead of expiry rather than serving a miss?",
          "a": "Add refresh-ahead: store a soft expiry before the hard TTL (say 80%), and when get sees a value past soft expiry, return it immediately and trigger one background reload guarded by an inflight flag for that key. For scheduled updates, a timer that reloads all rates just after the source publishes is even simpler. Keep the hard TTL as the correctness limit so a failed reload can't serve a rate for hours, and emit a metric when a value is served past soft expiry."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'cache-fundamentals-iq-01',
      difficulty: 'hard',
      question:
        'Our Postgres primary is at 85% CPU and p99 API latency doubled over three months of growth. The team wants to “add Redis”. Walk me through how you’d approach it.',
      context: 'E-commerce API, 40K RPS peak, 80% reads. Product pages, user profiles, cart, order history.',
      whatInterviewerLooksFor: [
        'Diagnoses before prescribing (pg_stat_statements, plans, pool, N+1)',
        'Selects cacheable data by reuse/staleness tolerance; excludes cart/orders correctness paths',
        'Chooses patterns, keys, TTLs, invalidation',
        'Protects the miss path and rolls out with metrics',
      ],
      modelAnswer: `### 1. Diagnose
- \`pg_stat_statements\` top by total time: are a few queries dominating? Check plans for seq scans, missing composite indexes, N+1 patterns from the ORM (thousands of \`SELECT … WHERE id = $1\` per page).
- Pool saturation, lock waits, autovacuum lag, replication lag, buffer hit ratio.
- Often 30–50% of the win is indexes and batching. Do those first — they're cheap and have no staleness.

### 2. Pick what to cache (by reuse × staleness tolerance)
| Data | Cache? | Pattern/TTL |
|---|---|---|
| Product details, categories | Yes, very high reuse | Cache-aside, 10–30 min TTL + delete on update; CDN for anonymous pages |
| User profile | Yes | Cache-aside, 15 min, delete on write |
| Cart | Maybe as primary in Redis (hash per user) or no cache | Needs read-your-writes |
| Order history | Mostly no (low reuse per user) | Read replica instead |
| Inventory at checkout | No (correctness) | Read from DB/reservation service |

### 3. Numbers
32K read RPS; if product/profile are 70% of reads and hit 95%, DB reads drop from 32K to ~32K × (0.3 + 0.7 × 0.05) ≈ 10.7K → roughly **−65% read load**.

### 4. Design
Versioned keys (\`catalog:v3:product:42\`), jittered TTLs, delete-on-write next to the DB update (later CDC). Redis: primary + replica, \`allkeys-lfu\`, ~25% memory headroom.

### 5. Protect the miss path
Redis timeouts (50 ms), fallback to DB with a concurrency limit, single-flight on hot keys, warm top-N products at deploy.

### 6. Roll out
Feature-flag per endpoint; shadow-compare a sample of cached vs DB results to catch invalidation bugs; watch hit ratio per prefix, DB CPU, p99, staleness complaints.`,
      followUps: [
        { q: 'Why delete the key on write instead of updating it?', a: 'Concurrent writers can apply cache sets out of order and leave an older value; deleting forces the next read to load the committed state (with a smaller residual race covered by TTL).' },
        { q: 'Would you use read replicas instead?', a: 'For fresher-than-cache needs like order history, yes — replicas scale reads without app-level invalidation but still have replication lag and cost more than cache hits.' },
      ],
      pitfalls: [
        'Adding Redis before checking indexes/N+1',
        'Caching correctness-critical data like inventory at checkout',
        'No plan for Redis failure or cold start',
      ],
    },
    {
      id: 'cache-fundamentals-iq-02',
      difficulty: 'medium',
      question:
        'You need a cache for rendered HTML fragments, user sessions, and a real-time game leaderboard. Redis, Memcached, or both? Justify per use case.',
      whatInterviewerLooksFor: [
        'Matches data structure needs (sorted sets for leaderboard)',
        'Durability/HA needs for sessions',
        'Operational simplicity and cost trade-offs',
      ],
      modelAnswer: `### HTML fragments
Opaque blobs, loss-tolerant, possibly large and very read-heavy. **Memcached** fits well (multi-threaded, simple, slab allocator), and so does Redis. If Redis is already in the stack I'd keep one technology. Compress fragments over ~1 KB and keep values ≤ 100 KB.

### Sessions
These need **availability** (losing them logs users out) and per-key TTL. **Redis** with a replica and failover (Sentinel/Cluster or managed), optionally AOF everysec. Store as a hash so fields can be updated independently, sliding expiry with \`EXPIRE\` on access. Memcached has no replication, so a node loss logs out ~1/N of users.

### Leaderboard
Needs ordered data with atomic increments: **Redis sorted set** — \`ZINCRBY lb:season5 10 user42\`, \`ZREVRANGE lb 0 99 WITHSCORES\`, \`ZREVRANK\` for "my rank". All are O(log N). 10M players × ~100 bytes ≈ 1 GB, which fits on one shard. Memcached can't do this at all (Alex Xu Vol 2, Ch 10 uses exactly this design). Persist scores in a DB asynchronously for recovery.

### Decision
**Redis for all three** unless fragment volume is huge and cheap multi-threaded blob caching matters. Then add Memcached for fragments only. Use separate Redis instances/clusters per use case so that fragment evictions (\`allkeys-lru\`) never evict sessions or leaderboards (\`noeviction\` + alerts).`,
      followUps: [
        { q: 'Why separate Redis instances rather than one with different key prefixes?', a: 'maxmemory-policy is per instance: a cache needs eviction, while sessions and leaderboards must never be evicted; separate instances also isolate load and failures.' },
        { q: 'How do you show a player’s rank among 50M players quickly?', a: 'ZREVRANK on the sorted set is O(log N); for sharded boards, keep per-shard counts or approximate rank via score buckets.' },
      ],
      pitfalls: [
        'Putting sessions in an evicting cache',
        'Using Memcached for data needing ordering',
        'One Redis for everything with a single eviction policy',
      ],
    },
    {
      id: 'cache-fundamentals-iq-03',
      difficulty: 'hard',
      question:
        'Our posts table gets 50K “view count +1” updates per second and the DB is dying on row locks. Design a write-back cache for counters. What can go wrong?',
      whatInterviewerLooksFor: [
        'Buffers increments in Redis, batches flushes',
        'Atomic buffer swap / idempotent flush',
        'Durability window and acceptable loss',
        'Hot-key and read-path considerations',
      ],
      modelAnswer: `### Design
- Hot path: \`HINCRBY views:buffer <postId> 1\`. That's O(1) with no DB touch; one Redis shard handles ~100K+ ops/s, or shard by post ID.
- Flusher every 5 s: atomically **rename** \`views:buffer\` to \`views:flushing:<ts>\` (new increments go to a fresh hash), \`HGETALL\` it, then run one batched \`UPDATE posts SET views = views + v.n FROM unnest(...)\` and delete the flushing key.
- Reads: displayed count = DB count + pending buffer value (or accept ~5 s lag).

### Effect
50K updates/s become one batched statement every 5 s over maybe ~20K distinct posts. Row-lock contention disappears, and so does most WAL churn.

### What can go wrong
1. **Loss**: if Redis dies before the flush you lose up to 5 s (plus the persistence window). That's fine for views, not for money. Mitigate with AOF everysec and replicas.
2. **Double counting**: if the flusher crashes after the DB update but before deleting the flushing key, a retry re-applies it. Make it idempotent: record the batch ID in the DB in the same transaction (\`INSERT INTO flushed_batches(id)\` with a unique constraint).
3. **Multiple flushers**: two workers flushing concurrently. Use a single leader (Redis lock with TTL, or a k8s CronJob with concurrencyPolicy Forbid).
4. **Hot posts**: a viral post is one hot field on one shard. Split its counter across N sub-keys (\`views:buffer:{shard}\`) and sum them at flush.
5. **Big batches**: \`HGETALL\` on a 1M-field hash blocks Redis. Shard the buffer (\`views:buffer:0..63\`) and flush shards independently.

### Alternative
Emit view events to Kafka and aggregate with a stream processor into the DB each minute. That's more durable and replayable, at the cost of more infrastructure.`,
      followUps: [
        { q: 'How would you handle likes (which users can undo) instead of views?', a: 'Likes need per-user dedup: SADD likes:{post} user, count via SCARD; persist the set membership durably — write-back is riskier, prefer DB writes with a cached count.' },
        { q: 'What if the product team wants an exactly-accurate count?', a: 'Then write-back is the wrong tool; use the DB (or Kafka with exactly-once aggregation) and cache the read side with short TTL.' },
      ],
      pitfalls: [
        'Read-modify-write (GET then SET) instead of atomic INCR',
        'No idempotency on flush',
        'Ignoring the data-loss window',
      ],
    },
    {
      id: 'cache-fundamentals-iq-04',
      difficulty: 'expert',
      question:
        'We’re moving from a single Redis to Redis Cluster. Our cart service uses MULTI/EXEC across cart:items:<user> and cart:meta:<user>, and a Lua script that touches a global promo:stock key. What breaks and how do you redesign?',
      whatInterviewerLooksFor: [
        'CROSSSLOT errors for multi-key ops across slots',
        'Hash tags and their hot-shard risk',
        'Global keys as bottlenecks; redesign options',
        'Client/cluster behaviours (MOVED/ASK, resharding)',
      ],
      modelAnswer: `### What breaks
Redis Cluster shards by \`CRC16(key) mod 16384\`. \`cart:items:42\` and \`cart:meta:42\` will almost surely land in **different slots**, so MULTI/EXEC and Lua touching both fail with **CROSSSLOT**. The Lua script touching \`promo:stock\` plus a user's cart key also spans slots.

### Redesign
1. **Hash tags for per-user data**: \`cart:{42}:items\`, \`cart:{42}:meta\`. Only "42" is hashed, so both keys share a slot and transactions and Lua work. Users are numerous, so load spreads evenly.
2. **Or collapse into one key**: a single hash \`cart:{42}\` with fields for items and meta. That's simpler, and an atomic HSET/HINCRBY needs no MULTI.
3. **Global promo stock**: one key = one shard = a hot spot, and it can't join per-user transactions. Options:
   - Split stock into N buckets (\`promo:{p1}:stock:0..15\`). Decrement a random bucket and fall through to others when it's empty.
   - Make stock reservation its own step: \`DECR\` the promo key atomically (or a Lua script on that single key), then update the cart. If the cart update fails, compensate with \`INCR\`. That's a mini saga.
   - Move authoritative stock to the DB or inventory service and cache only a display value.
4. **Client**: use a cluster-aware client (ioredis Cluster) that caches the slot map and follows MOVED/ASK. Watch big keys during resharding, because MIGRATE of a 50 MB key blocks.

### Migration
Dual-write old and new key formats behind a flag, read new with fallback to old, backfill, then cut over. Carts have TTLs, so the old keys age out naturally.`,
      followUps: [
        { q: 'Why not hash-tag everything with {cart} so it all sits together?', a: 'Then every cart lives on one shard — you have rebuilt a single Redis with extra steps and a hot node.' },
        { q: 'What happens to in-flight commands during resharding?', a: 'Keys in a migrating slot return ASK redirects; the client retries on the target node with ASKING; multi-key ops on keys split mid-migration may fail with TRYAGAIN.' },
      ],
      pitfalls: [
        'Not knowing about CROSSSLOT',
        'Over-coarse hash tags creating hot shards',
        'Keeping a single global counter in a sharded system',
      ],
    },
    {
      id: 'cache-fundamentals-iq-05',
      difficulty: 'hard',
      question:
        'Our product catalog (200K items, ~2 KB each) is read 30K times per second across 60 pods. Would you use an in-process cache, Redis, or both? How do you keep them consistent?',
      whatInterviewerLooksFor: [
        'Size math for in-process feasibility',
        'L1/L2 layering and TTL trade-off',
        'Invalidation strategy across instances',
        'GC/memory and cold-start considerations',
      ],
      modelAnswer: `### Size math
200K × 2 KB = **400 MB** of raw data; as JS objects, often 2–3× → ~1 GB per pod. Caching *everything* in process on 60 pods is wasteful and GC-heavy. But popularity is Zipfian: the top 10–20K items probably take 80–90% of reads, and 20K × ~5 KB ≈ **100 MB** per pod is fine.

### Design: two levels
- **L1** (lru-cache): 20K entries, TTL **30 s**. Serves most reads in µs with no network and no JSON parsing. It also absorbs hot items, so Redis doesn't get a hot key.
- **L2** Redis: the whole catalog, TTL 1 h + jitter, delete-on-update.
- The DB sees only L2 misses.

### Numbers
30K RPS: with an 85% L1 hit ratio, Redis sees 4.5K RPS (trivial); with 99% L2 hits, the DB sees ~45 RPS.

### Consistency
- A catalog update goes to the DB, then \`DEL\` in Redis, then a **pub/sub broadcast** \`catalog:invalidate {id}\` so each pod drops that key from L1.
- Pub/sub is fire-and-forget: a pod that's reconnecting misses messages. The **30 s L1 TTL bounds staleness** as a safety net, and on reconnect the pod clears L1.
- For price changes that must be exact at checkout, **bypass caches** and read the pricing service or DB at checkout time.

### Operational
Warm L1 on startup (preload the top N IDs) so a deploy doesn't send 60 cold pods to Redis at once. Track L1/L2 hit ratios and invalidation lag.`,
      followUps: [
        { q: 'Why not make the L1 TTL 5 minutes for a better hit ratio?', a: 'Staleness bound grows to 5 min for any missed invalidation; choose TTL from the business staleness tolerance, not hit ratio alone.' },
        { q: 'How would you do this in a JVM service?', a: 'Caffeine (W-TinyLFU) for L1 with expireAfterWrite, same Redis L2 and pub/sub invalidation.' },
      ],
      pitfalls: [
        'Caching the whole dataset per pod without size math',
        'Relying only on pub/sub without a TTL safety net',
        'Using cached prices for checkout totals',
      ],
    },
    {
      id: 'cache-fundamentals-iq-06',
      difficulty: 'expert',
      question:
        'A 60 GB Redis node used as a cache shows latency spikes of 300–800 ms every hour, and occasionally runs out of memory during those spikes. What’s going on?',
      whatInterviewerLooksFor: [
        'Connects hourly spikes to RDB fork/BGSAVE',
        'Copy-on-write memory growth under writes',
        'Transparent huge pages, fork latency on VMs',
        'Remedies: shard smaller, disable/relocate persistence, tune',
      ],
      modelAnswer: `### Likely cause: RDB snapshots
\`save 3600 1\` (or similar) triggers **BGSAVE** hourly. Redis calls \`fork()\`:
- **Fork latency**: the kernel copies page tables for 60 GB. That's tens of ms per GB on some virtualised hosts, so hundreds of ms are possible, and the main thread is blocked during fork. That's the latency spike.
- **Copy-on-write**: while the child writes the snapshot, every page the parent modifies gets duplicated. With a busy write load, memory can grow by tens of GB, which explains hitting the memory limit. With **Transparent Huge Pages** on, each modified 4 KB write copies a 2 MB page, which is far worse (Redis warns about THP at startup).

### Confirm
\`INFO persistence\` (rdb_last_bgsave_time_sec, latest_fork_usec), \`LATENCY LATEST\`, and correlate the spike timestamps with BGSAVE. Check THP status and memory fragmentation (\`mem_fragmentation_ratio\`).

### Fixes
1. **It's a cache**: disable RDB on the primary (\`save ""\`), or run snapshots only on a replica.
2. **Disable THP** (\`echo never > /sys/kernel/mm/transparent_hugepage/enabled\`).
3. **Shard smaller**: 4–6 shards of ~10–15 GB each. Fork time, CoW growth, failover and full resync all shrink proportionally.
4. **Memory headroom**: \`maxmemory\` about 70–75% of RAM, allowing for fragmentation, replication buffers and CoW.
5. Set \`vm.overcommit_memory = 1\` so fork doesn't fail under memory pressure.

### Also check
Hourly jobs such as a cron running \`KEYS\`, large \`DEL\` calls (use UNLINK/lazyfree), or mass TTL expiry at the top of the hour (add jitter).`,
      followUps: [
        { q: 'Why does a replica full resync hurt a big node too?', a: 'The primary forks to create an RDB for the replica — same fork/CoW cost — and ships 60 GB over the network; smaller shards and a large replication backlog avoid full resyncs.' },
        { q: 'Would AOF instead of RDB fix it?', a: 'AOF rewrite also forks; everysec fsync adds disk dependency. For a pure cache, no persistence or replica-only persistence is best.' },
      ],
      pitfalls: [
        'Blaming the network or clients without checking persistence',
        'Adding RAM without addressing fork/CoW behaviour',
        'Not knowing about THP',
      ],
    },
    {
      id: 'cache-fundamentals-iq-07',
      difficulty: 'hard',
      question:
        'A nightly analytics job reads every product once, and every morning the product-page cache hit ratio drops from 97% to 60% for an hour. Why, and how do you fix it?',
      whatInterviewerLooksFor: [
        'Recognises scan pollution of LRU',
        'Proposes LFU / W-TinyLFU / segmented LRU / bypass',
        'Isolating batch workloads from serving caches',
        'Measurement',
      ],
      modelAnswer: `### Why: scan pollution
Under **LRU**, every item the job reads becomes "most recently used", so the scan pushes the genuinely hot items out of a capacity-bound cache. In the morning, real traffic misses on the hot set and has to refill it from the DB, which is why the hit ratio sits at 60% for an hour.

### Fixes (combine)
1. **Don't let batch jobs use the serving cache.** Have them read from a replica or warehouse, or pass a \`bypassCache\` flag that skips population. This is the simplest and best fix.
2. **Scan-resistant eviction**:
   - Redis \`allkeys-lfu\` with decay (\`lfu-decay-time\`): one-time accesses don't outrank items accessed thousands of times.
   - In-process: **W-TinyLFU** (Caffeine), where the admission filter rejects one-hit wonders, or segmented LRU / 2Q, where new items must be accessed twice to reach the protected segment.
3. **Separate caches or namespaces** per workload with their own memory limits.
4. **Warm-up after known pollution** by preloading the top-N hottest keys from yesterday's access stats.

### Measure
Hit ratio by key prefix and by client, eviction rate, and the \`OBJECT FREQ\` distribution. After the change, the morning dip should be gone and DB load should stay flat.`,
      followUps: [
        { q: 'When is LRU better than LFU?', a: 'When popularity shifts quickly (news, trending) — LFU may keep yesterday’s heroes; LFU with decay or W-TinyLFU balances both.' },
        { q: 'How does W-TinyLFU decide admission?', a: 'A compact frequency sketch (count-min) estimates access frequency; a new item replaces the eviction candidate only if it is estimated to be more frequent.' },
      ],
      pitfalls: [
        'Only suggesting a bigger cache',
        'Not isolating batch from serving workloads',
        'Thinking TTL changes fix scan pollution',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'cache-fundamentals-boe-1',
      question: 'Estimate the Redis memory and cluster size for caching 80M user profiles.',
      assumptions: [
        '80M users, 30% are “active” and worth caching (24M)',
        'Serialized profile ≈ 600 bytes (MessagePack); key ≈ 30 bytes',
        'Redis per-key overhead ≈ 70 bytes (dict entry, robj, SDS headers, expire)',
        'Fragmentation + headroom: use 70% of RAM for data; 1 replica per shard; target ≤ 15 GB data per shard',
      ],
      steps: [
        { label: 'Bytes per entry', calc: '600 + 30 + 70 ≈ 700 bytes' },
        { label: 'Raw data', calc: '24M × 700 B ≈ 16.8 GB' },
        { label: 'With fragmentation (×1.2)', calc: '16.8 × 1.2 ≈ 20 GB' },
        { label: 'Shards', calc: '20 GB ÷ 15 GB ≈ 1.3 → 2 shards (3 for growth)' },
        { label: 'RAM per node', calc: '10 GB data ÷ 0.7 ≈ 14 GB → 16 GB nodes' },
        { label: 'Total nodes', calc: '3 primaries + 3 replicas = 6 × 16 GB' },
      ],
      answer: '~20 GB of data → a 3-shard Redis Cluster with replicas (6 × 16 GB nodes), leaving room for growth.',
      insight:
        'Per-key overhead and fragmentation add ~15–30% on top of payload; caching only the active set (not all 80M) is the biggest lever. Compact serialization (MessagePack, dropping unused fields) directly cuts node count.',
      followUps: [
        {
          "q": "Product decides to cache all 80M users, not just the active 24M. Redo the sizing; what would you push back with?",
          "a": "80M × 700 B = 56 GB, × 1.2 fragmentation ≈ 67 GB, so about 5 shards at 15 GB (6 for growth) and 12 × 16 GB nodes with replicas, roughly 3.3× the cost. The extra 56M users are inactive, so their keys would mostly be read once and evicted or expire, giving near-zero hit-ratio gain. Push back with the measured hit-ratio curve: if caching active users already gives 98% hits, the other 70% of keys buys perhaps 1%. Fill inactive users lazily on read instead."
        }
      ],
    },
    {
      id: 'cache-fundamentals-boe-2',
      question: 'A read API serves 120K QPS; the DB can sustain 10K QPS. What hit ratio do you need, and what happens during a cold start?',
      assumptions: [
        'Keep the DB at ≤ 70% of capacity in steady state (7K QPS)',
        'Cold cache after full Redis restart: 0% hits initially',
        'Working set 5M keys; each miss populates its key',
      ],
      steps: [
        { label: 'Allowed misses', calc: '7,000 ÷ 120,000 ≈ 5.8% → hit ratio ≥ 94.2%' },
        { label: 'At 99% hit ratio', calc: 'DB = 1.2K QPS (comfortable)' },
        { label: 'Cold start DB demand', calc: '120K QPS of misses = 12× DB capacity → immediate overload' },
        { label: 'Time to warm naturally (if DB could keep up)', calc: '5M keys ÷ 10K QPS ≈ 500 s ≈ 8 min at max DB capacity' },
        { label: 'Needed protection', calc: 'shed/queue 110K QPS: serve stale/degraded, rate-limit loaders, pre-warm top keys' },
      ],
      answer: 'You need ≥ ~94% hits in steady state (99% gives big headroom); a cold cache demands 12× DB capacity, so warming and load shedding are mandatory.',
      insight:
        'Once the cache carries 90%+ of reads it is load-bearing infrastructure: design HA (replicas), persistence or pre-warming for restarts, and miss-path protection (single-flight, concurrency limits) as part of the cache design.',
      followUps: [
        {
          "q": "You pre-warm the top 500K keys before taking traffic. What hit ratio do you start at, and how long does the warm-up take?",
          "a": "With Zipf-like access, the top 10% of keys (500K of 5M) often carry 80-90% of reads, so you start around 85% hits: 120K × 15% = 18K QPS of misses, still above the 10K DB limit but far from 120K. Loading 500K keys at a throttled 5K DB reads per second takes about 100 s, or much less if you dump hot keys from a replica RDB or a snapshot instead of the DB. Combine pre-warm with a concurrency cap on the miss path to cover the remaining gap."
        }
      ],
    },
    {
      id: 'cache-fundamentals-boe-3',
      question: 'A “home feed” object cached in Redis is 180 KB JSON and read 25K times per second. Estimate the network and CPU cost, and propose a fix.',
      assumptions: [
        'Redis node NIC: 10 Gbps (~1.25 GB/s)',
        'JSON.parse cost ≈ 1 ms per 100 KB in Node',
        'zstd/gzip compresses this JSON ~5×; MessagePack is ~30% smaller than JSON',
      ],
      steps: [
        { label: 'Bandwidth', calc: '25,000 × 180 KB = 4.5 GB/s ≈ 36 Gbps → 3.6× one Redis NIC' },
        { label: 'Parse CPU', calc: '25,000 × 1.8 ms = 45 core-seconds/s ≈ 45 cores on app side' },
        { label: 'With compression (5×)', calc: '0.9 GB/s ≈ 7.2 Gbps; still ~72% of one NIC' },
        { label: 'With L1 in-process (90% hits, parsed object reused)', calc: 'Redis traffic 2.5K × 36 KB ≈ 90 MB/s; parse ~4.5 cores' },
        { label: 'Split object', calc: 'cache feed as list of 50 IDs (~2 KB) + item cache; typical page needs first 10 items' },
      ],
      answer: '~36 Gbps and ~45 cores of parse CPU as-is; compression + L1 + splitting drops it to under 1 Gbps and a few cores.',
      insight:
        'Value size multiplies every cost (network, CPU, eviction churn, hot-key pressure). Cache small, composable pieces (IDs + entities), compress larger text, and keep hot objects parsed in L1.',
      followUps: [
        {
          "q": "You split the feed into 50 IDs plus an item cache. Each page now does 1 + 10 lookups. What happens to Redis ops and latency?",
          "a": "Ops rise from 25K to about 25K × 11 = 275K per second if done naively, but MGET of the 10 items makes it 2 round trips per request, 50K commands/s, well within a small cluster. Latency is two sequential round trips (around 1 ms in-region) instead of one huge transfer. Bandwidth falls to roughly 25K × (2 KB + 10 × 2 KB) ≈ 550 MB/s, then much lower with L1 for hot items. In Redis Cluster, MGET must be split per slot, so the client fans out in parallel."
        }
      ],
    },
  ],
  test: [
    {
      id: 'cache-fundamentals-mcq-01',
      difficulty: 'medium',
      question:
        'A service at 40K QPS has a 95% cache hit ratio. The team improves it to 99%. What happens to DB read load?',
      options: [
        'It drops by about 4%, from 2,000 to 1,920 QPS',
        'It drops by 80%, from 2,000 to 400 QPS',
        'It drops by 50%, from 2,000 to 1,000 QPS',
        'It stays the same; hit ratio only affects latency',
      ],
      correct: [1],
      explanation:
        'DB load equals QPS × miss ratio: 40K × 5% = 2,000 QPS before and 40K × 1% = 400 QPS after, an 80% reduction. Small gains in hit ratio are large relative reductions in misses. The 4% option applies the change to the hit ratio instead of the miss ratio, and hit ratio definitely affects backend load, not only latency.',
      followUps: [
        {
          "q": "You get to 99%, then someone proposes 99.9%. What does it cost in cache memory, and is it worth it for the DB?",
          "a": "DB load would fall from 400 to 40 QPS, another 10× cut. But with a typical Zipf-like access pattern the last fraction of a percent lives in the long tail: reaching it may need several times more memory because you must hold rarely-read keys. Plot hit ratio against cache size (Redis keyspace sampling or a simulated miss-ratio curve from access logs) and stop where marginal hits per GB flatten. If 400 QPS is comfortably within DB capacity, the money is better spent on miss-path protection than on chasing 99.9%."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-02',
      difficulty: 'hard',
      question: 'Which statements about this cache-aside read are true? Select ALL that apply.',
      code: {
        language: 'typescript',
        code: `const raw = await redis.get(key);
if (raw) return JSON.parse(raw);
const row = await db.findUser(id);          // null when not found
await redis.set(key, JSON.stringify(row), 'EX', 300);
return row;`,
      },
      options: [
        'A missing user is cached as the string "null" for 5 min and served as a hit',
        'A cached "0" or empty-string value is treated as a miss on every read',
        'JSON.stringify(null) throws, crashing the endpoint for unknown IDs',
        'The DB query still runs on cache hits because set is awaited',
      ],
      correct: [0, 1],
      explanation:
        'JSON.stringify(null) returns the string "null", which is truthy, so missing users are negative-cached for the full 5 minutes by accident. A newly created user can then appear missing. Values like "0" or "" are falsy, so if (raw) treats them as misses and re-queries every time. Check raw !== null and use an explicit sentinel with a short TTL. JSON.stringify(null) does not throw, and a hit returns before the DB call.',
      followUps: [
        {
          "q": "You fix it with a NULL sentinel and a 60 s negative TTL. A user signs up and immediately loads their profile, getting 'not found'. How do you fix that without dropping negative caching?",
          "a": "On user creation, explicitly delete (or overwrite) the user's cache key after the insert commits, the same way you invalidate on update. That removes any negative entry cached by an earlier lookup, for example a uniqueness check during signup. Keep the negative TTL short (30-60 s) as the safety net if the delete fails. For flows where the signup path reads its own write, read-your-writes from the primary or return the created object directly instead of re-reading through the cache."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-03',
      difficulty: 'hard',
      question:
        'You store view counters with write-back: increments in Redis, flushed to Postgres every 10 s. Which risks must you design for? Select ALL that apply.',
      options: [
        'Losing up to ~10 s of increments (plus the persistence window) if Redis fails before a flush',
        'Double counting if a flush retries after the DB update succeeded but before the buffer was cleared',
        'Readers seeing counts that lag the true value by up to one flush interval',
        'Postgres deadlocks caused by Redis INCR commands',
      ],
      correct: [0, 1, 2],
      explanation:
        'Write-back makes the cache the temporary source of truth, which brings a loss window, a need for idempotent flushes, and reads that lag behind. Redis INCR commands never touch Postgres locks. Batched flushes actually reduce lock contention compared with row-by-row updates.',
      followUps: [
        {
          "q": "Design the flush so a retry after a crash can't double count. Concretely, what do you store and where?",
          "a": "Use a two-phase drain per key: atomically move the pending count with a Lua script (GETDEL counter into a batch hash keyed by a batch ID), then write to Postgres with the batch ID in a processed_batches table in the same transaction, using INSERT ... ON CONFLICT DO NOTHING. If the batch ID already exists, the flush was applied and you only clear the batch in Redis. A crash at any point leaves either the batch in Redis (retry) or the batch ID in Postgres (skip), so each increment is applied exactly once."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-04',
      difficulty: 'expert',
      question:
        'A Redis node configured as a cache hits maxmemory, and writes start failing with "OOM command not allowed when used memory > maxmemory". What is the most likely configuration issue?',
      options: [
        'maxmemory-policy is still the default noeviction',
        'maxmemory-policy is allkeys-lru, which cannot evict keys that have no TTL',
        'maxmemory-samples is too low, so eviction cannot find candidates',
        'AOF is enabled, which prevents eviction during rewrites',
      ],
      correct: [0],
      explanation:
        'The default policy is noeviction, under which Redis rejects writes once it is full. A cache should use allkeys-lru or allkeys-lfu. allkeys-lru evicts any key whether or not it has a TTL; the volatile-* policies are the ones that need TTLs, and with them you would see this error if no keys had one. A low sample count reduces eviction accuracy but doesn’t stop eviction, and AOF doesn’t block it.',
      followUps: [
        {
          "q": "You switch to allkeys-lru. Hit ratio drops from 96% to 80% overnight as evictions climb. How do you decide between more memory and a different policy?",
          "a": "Check what is being evicted and why. If evicted_keys tracks a growing working set (keyspace and traffic both grew), add memory or shard; LRU is doing its job. If a batch job or scan touches many keys once, switch to allkeys-lfu so one-hit keys don't push out the hot set. Use OBJECT FREQ sampling or redis-cli --hotkeys (under LFU) to see the distribution, and look at value sizes: a few big values often waste more memory than the policy choice."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-05',
      difficulty: 'hard',
      question: 'In Redis Cluster, this transaction fails with CROSSSLOT. What is the best fix?',
      code: {
        language: 'typescript',
        code: `await cluster.multi()
  .hset('order:991:header', 'status', 'PAID')
  .rpush('order:991:events', 'paid')
  .exec();`,
      },
      options: [
        'Switch to pipelining instead of MULTI so each command routes independently',
        'Rename keys to order:{991}:header and order:{991}:events so they share a slot',
        'Use WATCH on both keys before MULTI',
        'Enable cluster-allow-reads-when-down',
      ],
      correct: [1],
      explanation:
        'Commands in a MULTI/EXEC must all target the same slot. A hash tag makes only "991" count toward the slot, so both keys co-locate. Pipelining would route each command separately but gives up atomicity, WATCH has the same same-slot restriction, and cluster-allow-reads-when-down concerns availability, not slots.',
      followUps: [
        {
          "q": "Your hash tag is the order ID. One B2B customer creates an 'order' that receives 40K events per second. What happens to the cluster?",
          "a": "All keys for that order sit in one slot on one shard, so 40K writes per second plus the growing events list land on a single node, a hot key and possibly a big key. Other slots on that shard suffer too. Hash tags trade distribution for atomicity, so only co-locate what truly needs a transaction: keep the header and the latest status together, but write the event stream to sharded keys (order:991:events:<bucket>) or to Kafka, and drop the cross-key MULTI for the events."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-06',
      difficulty: 'expert',
      question:
        'Which statements about Redis persistence for a pure cache (data rebuildable from Postgres) are correct? Select ALL that apply.',
      options: [
        'RDB snapshots fork the process; on large instances this can cause latency spikes and copy-on-write memory growth',
        'AOF with appendfsync always gives zero data loss and has negligible cost',
        'Disabling persistence means a restart starts cold, so the DB must survive the warm-up',
        'Taking snapshots on a replica instead of the primary avoids fork impact on the serving primary',
        'Replication is synchronous, so a failover never loses acknowledged writes',
      ],
      correct: [0, 2, 3],
      explanation:
        'Fork and copy-on-write costs are real on big nodes. Without persistence a restart comes up cold, and taking snapshots on a replica keeps the fork off the primary. appendfsync always fsyncs on every write, which is expensive, and it still can’t cover replication gaps. Redis replication is asynchronous, so a failover can lose recent writes.',
      followUps: [
        {
          "q": "Persistence is off. The Redis primary restarts and its replica resyncs from it immediately. What happens to the data?",
          "a": "This is the classic trap: a primary restarting with persistence off comes back empty, and if Sentinel doesn't fail over first, the replica performs a full resync from the empty primary and wipes its own copy. You lose the whole dataset on both nodes. Either make sure a restarted primary can't rejoin as primary (let Sentinel promote the replica and disable auto-restart), or enable at least RDB snapshots on the replica so a cold node can reload from disk."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-07',
      difficulty: 'hard',
      question:
        'Your LRU cache’s hit ratio collapses every night when a batch export reads every row once. What is the most effective fix?',
      options: [
        'Double the cache size',
        'Lower the TTL so exported rows expire quickly',
        'Have the export bypass the cache (or use a scan-resistant policy like LFU/W-TinyLFU)',
        'Switch from LRU to FIFO eviction',
      ],
      correct: [2],
      explanation:
        'A one-pass scan pushes the hot set out of an LRU cache. Keeping batch reads away from the serving cache, or using a frequency-aware policy, stops the pollution. Doubling the size only helps if the whole dataset fits. A shorter TTL also expires hot keys, and FIFO is just as vulnerable to scans.',
      followUps: [
        {
          "q": "The batch export can't be changed to bypass the cache because it uses the same shared repository code. How do you protect the hot set?",
          "a": "Use a scan-resistant policy that requires frequency before admission: allkeys-lfu in Redis, or W-TinyLFU (Caffeine, lru-cache doesn't have it) in-process. One-time keys from the export score a frequency of 1 and lose to the hot keys at eviction. Alternatively, route the batch's connection to a separate Redis logical cache by a context flag set at the job entry point, or let it read with a 'no-populate' option so misses aren't written back. Measure by watching hit ratio at 7 am the next day."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-08',
      difficulty: 'expert',
      question: 'This in-process cache is used in a NestJS service with 30 pods. What problems will it cause? Select ALL that apply.',
      code: {
        language: 'typescript',
        code: `const cache = new Map<string, Product>();
export async function getProduct(id: string) {
  if (!cache.has(id)) cache.set(id, await db.product(id));
  return cache.get(id)!;
}`,
      },
      options: [
        'Unbounded growth until the pod runs out of memory',
        'Updates are never seen, since there is no TTL or invalidation, and each pod may hold a different version',
        'Concurrent misses for the same id each hit the DB, since there is no single-flight',
        'Map lookups are O(n), so latency grows with size',
      ],
      correct: [0, 1, 2],
      explanation:
        'The Map is never bounded, has no TTL, and 30 pods each hold independently stale copies. Concurrent misses for the same id also stampede the DB. Map get and has are O(1) on average, so lookup cost is not the problem.',
      followUps: [
        {
          "q": "After bounding it with an LRU and a 30 s TTL, the product team wants price changes visible on all 30 pods within 2 s. What do you add?",
          "a": "Broadcast invalidations: on each price write, publish the product ID to a Redis pub/sub channel (or Streams/Kafka for durability), and every pod deletes it from its L1. Delivery is typically under 100 ms. Pub/sub is lossy, so keep the 30 s TTL as a backstop, and clear the whole L1 when a pod's subscription reconnects. Alternatively drop the L1 TTL to 2 s, which is simpler but raises Redis reads 15× compared with 30 s."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-09',
      difficulty: 'medium',
      question:
        'Which data is the WORST candidate for caching with a 10-minute TTL?',
      options: [
        'Product category tree shown on every page',
        'Country and currency reference data',
        'Rendered “top 10 articles” widget',
        'A user’s remaining wallet balance used to authorize payments',
      ],
      correct: [3],
      explanation:
        'Authorizing a payment on a balance that may be 10 minutes stale can lead to overspending or double-spending, so correctness-critical data must be read from the source of truth. Category trees, reference data and popular-content widgets are read-heavy, widely reused and tolerate some staleness, which makes them ideal cache candidates.',
      followUps: [
        {
          "q": "The wallet balance endpoint is still read 20K times per second, mostly by the UI. Can you cache any of it safely?",
          "a": "Yes, split the two uses. The UI display can read a cached balance with a short TTL (a few seconds) or one updated on each transaction, labelled as approximate if needed. The payment authorisation must never use it: it does an atomic conditional update on the source of truth, for example UPDATE wallets SET balance = balance - $1 WHERE id = $2 AND balance >= $1, and checks the row count. That makes correctness independent of any cache, so display caching only risks a briefly outdated number on screen."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-10',
      difficulty: 'expert',
      question:
        'Redis latency spikes to 2 s whenever an admin clicks “clear product cache”. The handler is below. Best replacement?',
      code: {
        language: 'typescript',
        code: `const keys = await redis.keys('product:*');   // ~4M keys
await redis.del(...keys);`,
      },
      options: [
        'Replace KEYS with SCAN, then call DEL with all 4M keys in one command',
        'Version the namespace (product:v7:*) so clearing is one SET; TTL cleans up',
        'Run the same code on a replica so the primary is unaffected',
        'Use FLUSHALL ASYNC, which only removes the product keys',
      ],
      correct: [1],
      explanation:
        'KEYS is O(N) and blocks Redis’s single thread, and a DEL with 4M arguments is also a huge blocking command. Namespace versioning makes invalidation O(1). If you must delete keys physically, do it gradually with SCAN and UNLINK in small batches. SCAN followed by one giant DEL still blocks. Replicas are read-only and deletions have to happen on the primary, and FLUSHALL wipes everything, not only product keys.',
      followUps: [
        {
          "q": "With namespace versioning, what happens to the 4M old keys, and what would make memory blow up?",
          "a": "Old keys are never read again and age out by their TTL; until then they occupy memory alongside the newly filling v8 keys, so peak memory can briefly approach double. If the old keys have no TTL, they stay forever (or until LRU evicts them, displacing useful data). So every versioned key needs a TTL, and frequent namespace bumps (say every minute) multiply the dead keys. If bumps are frequent, prefer a background SCAN plus UNLINK of the old prefix in batches of a few hundred keys."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-11',
      difficulty: 'hard',
      question:
        'When is Memcached a better fit than Redis? Select ALL that apply.',
      options: [
        'A pure look-aside cache of serialized objects needing multi-threaded throughput on large boxes',
        'A leaderboard requiring rank queries',
        'Operational simplicity is valued and losing a node’s keys is acceptable',
        'Sessions that must survive node failures',
      ],
      correct: [0, 2],
      explanation:
        'Memcached shines as a simple, multi-threaded blob cache where losing a node only costs misses. Leaderboards need sorted sets, which Memcached doesn’t have. Sessions that must survive node loss need replication, which Memcached also lacks.',
      followUps: [
        {
          "q": "You choose Memcached with 20 nodes and client-side consistent hashing. One node dies. What happens to the DB, and how bad is it?",
          "a": "About 1/20, 5% of keys, become misses at once, and with consistent hashing only that node's keys move, so the other 95% stay hits. If you were at 98% hits with 100K QPS, DB load goes from 2K to about 7K QPS until the replacement node warms. If the DB can't absorb that, use more, smaller nodes (losing 1 of 50 hurts less), keep a gutter pool for failed-node keys (Facebook's approach), and bound the miss path. Modulo hashing would have remapped nearly every key."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-12',
      difficulty: 'expert',
      question:
        'Which LRU implementation detail is correct for an O(1) cache built on a JavaScript Map?',
      code: {
        language: 'typescript',
        code: `get(k) { const e = this.m.get(k); if (!e) return;
  /* (A) */ return e.v; }
set(k, v) { this.m.set(k, { v }); if (this.m.size > this.max) {
  /* (B) */ } }`,
      },
      options: [
        'A: nothing needed; B: delete the last key from [...this.m.keys()]',
        'A: this.m.delete(k); this.m.set(k, e); B: delete this.m.keys().next().value',
        'A: this.m.set(k, e); B: delete this.m.keys().next().value',
        'A: this.m.delete(k); this.m.set(k, e); B: delete the last inserted key',
      ],
      correct: [1],
      explanation:
        'A Map iterates in insertion order, and setting an existing key does not move it. To mark an entry as recently used on get you must delete and re-insert it. The first key is then the least recently used and is the one to evict. The last key is the most recent, and spreading the keys into an array is O(n).',
      followUps: [
        {
          "q": "Now make this LRU safe when two async callers miss the same key at once. What changes?",
          "a": "Node is single-threaded, so get and set on the Map can't race; the problem is two callers both missing and both calling the loader. Store the in-flight promise: on miss, check an inflight Map; if a promise exists return it, else create it, store it, and delete it in finally. Optionally cache the promise itself in the LRU so later callers await the same load. In Java you would use ConcurrentHashMap.computeIfAbsent or Caffeine's AsyncLoadingCache, because there the Map operations themselves need thread safety."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-13',
      difficulty: 'hard',
      question:
        'Profiles are cached in Redis as 150 KB JSON blobs. p99 latency of the profile API is 40 ms even with 99% hits, and app CPU is high. Most likely cause?',
      options: [
        'Transfer + JSON.parse of big values dominate; cache fewer fields or compress',
        'Redis is single-threaded, so every GET waits in a long queue',
        'The hit ratio is too low; increase the TTL',
        'Redis replicas are serving stale data, forcing retries',
      ],
      correct: [0],
      explanation:
        'Large values cost transfer time and, above all, CPU on the event loop to parse, which inflates tail latency and app CPU even when nearly every request is a hit. Redis’s single thread is rarely the bottleneck for simple GETs. A 99% hit ratio is already good, and nothing here suggests stale replicas or retries.',
      followUps: [
        {
          "q": "You switch to gzip-compressed values. Bandwidth falls, but p99 barely improves. Why, and what would you do instead?",
          "a": "Compression moves the cost from network to CPU: gunzip plus JSON.parse of the 150 KB result still runs on the event loop for every request, so the tail is dominated by CPU. Fix the shape instead: cache only the fields the endpoint needs (often 2-5 KB), split rarely-used sections into separate keys loaded on demand, or keep the parsed object in an in-process L1 so the parse happens once per TTL rather than per request. Measure with event-loop lag and a CPU profile before and after."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-14',
      difficulty: 'medium',
      question:
        'Which write strategy best fits an append-only audit log that is written constantly and rarely read back?',
      options: [
        'Write-through, so every entry is immediately cached',
        'Write-back, to batch entries in cache and flush later',
        'Write-around: write to the store and do not populate the cache',
        'Refresh-ahead, to keep entries warm',
      ],
      correct: [2],
      explanation:
        'Data that is written once and rarely read would only pollute the cache and evict useful entries, so write-around is the right choice. Write-through fills the cache with entries nobody reads. Write-back risks losing audit data, which is unacceptable, and refresh-ahead is meant for hot read keys.',
      followUps: [
        {
          "q": "Compliance asks for the last 50 audit entries for any account to load in under 50 ms on the dashboard. Does your answer change?",
          "a": "Partially. The full log stays write-around in the durable store. For the dashboard, maintain a capped per-account list in Redis (LPUSH then LTRIM 0 49) written after the durable insert, so it's a small bounded structure that serves the hot read path. If Redis loses it, rebuild it from the store with an indexed query (account_id, created_at DESC LIMIT 50). It's a derived view, not the record of truth, so losing it only costs latency."
        }
      ],
    },
    {
      id: 'cache-fundamentals-mcq-15',
      difficulty: 'expert',
      question:
        'You add a 15 s in-process L1 cache in front of Redis (L2, TTL 10 min, delete-on-write). A product manager asks for the worst-case staleness after a price update. What is it, and why?',
      options: [
        '0 s, because delete-on-write clears Redis immediately',
        '10 min, because L1 entries inherit the Redis TTL',
        '25 min, because staleness is the sum of both layers’ TTLs',
        '~15 s via stale L1 copies; up to 10 min if the Redis delete fails',
      ],
      correct: [3],
      explanation:
        'Deleting from Redis doesn’t touch the L1 on each pod, so every pod can serve the old value until its own 15 s TTL expires, unless you broadcast invalidations. If the Redis delete itself fails, staleness is bounded only by the Redis TTL. L1 entries don’t inherit the L2 TTL, and staleness across layers is capped by how each layer refreshes, not by adding TTLs together.',
      followUps: [
        {
          "q": "The PM says 15 s is unacceptable for prices at checkout but fine on listing pages. How do you serve both without two codebases?",
          "a": "Make the read path take a consistency hint. Listing pages use L1 then L2 as now. Checkout bypasses L1 and reads L2 (or the primary DB for the final charge) so worst-case staleness is the invalidation delay, normally milliseconds. Also, the final order should re-price from the source of truth anyway and show 'price changed' if it differs. This keeps one cache layer with per-call freshness requirements, instead of shortening L1 for everyone and losing its hit ratio."
        }
      ],
    },
  ],
};

export default topic;
