import type { Topic } from '../../types';

const topic: Topic = {
  id: 'cache-failures',
  phase: 'caching',
  order: 2,
  title: 'Cache Invalidation, Consistency & Failure Modes',
  subtitle:
    'Invalidation strategies and races, stampede, penetration, avalanche, hot keys, warming, Redis down or full, stale local caches, fast-changing data, and debugging a hit-ratio drop.',
  estimatedMinutes: 90,
  sources: [
    'Nishtala et al. — Scaling Memcache at Facebook (NSDI 2013): leases, invalidation via mcsqueal',
    'Vattani, Chierichetti, Lowenstein — Optimal Probabilistic Cache Stampede Prevention (VLDB 2015, XFetch)',
    'Redis documentation (eviction, client-side caching, memory), Debezium docs',
  ],
  tags: ['cache-invalidation', 'stampede', 'penetration', 'avalanche', 'hot-keys', 'bloom-filter', 'cdc', 'redis', 'consistency'],
  cheatSheet: [
    'Invalidation options: TTL (bounded staleness), delete-on-write (after commit), versioned keys (O(1) bulk), CDC-driven (Debezium → Kafka → invalidator; catches every writer).',
    'Cache-aside race: a slow reader loads v1, the writer commits v2 and deletes, then the reader SETs v1 → stale until TTL. Fixes: version-guarded set (Lua), leases, delayed double delete, short TTL.',
    'Stampede (dogpile): hot key expires → N concurrent misses recompute. Fixes: single-flight, distributed lock (SET NX PX), XFetch early refresh, stale-while-revalidate.',
    'Penetration: lookups for keys that don’t exist anywhere always miss. Fixes: negative caching (short TTL), Bloom filter (~10 bits/key for 1% FP), input validation, rate limits.',
    'Avalanche: many keys expire together or the cache tier dies. Fixes: TTL jitter, HA replicas, L1 + L2, circuit breaker + DB concurrency limits, warming.',
    'Hot key: one key above one shard’s capacity (~100K ops/s). Fixes: L1 in-process cache, key replicas key#0..N (random read, fan-out write), read replicas; shard hot counters.',
    'Redis down: short timeouts (≤50–100 ms), circuit breaker, serve stale L1, bulkhead the DB fallback, shed low-priority traffic. Never let every request fall through to the DB at full rate.',
    'Redis full: noeviction → write errors; volatile-* with no TTLs → errors; allkeys-* may evict sessions/locks sharing the instance. Separate instances by eviction needs; watch big keys and fragmentation.',
    'Stale L1 across pods: pub/sub broadcast invalidation + short TTL safety net; or Redis client-side caching (CLIENT TRACKING). Clear L1 on reconnect.',
    'Hit ratio drop playbook: deploys (key format, serializer, TTL), evictions/memory, node failover/reshard, new traffic (bots/scans), namespace bumps, time-based keys.',
  ],
  sections: [
    {
      heading: 'Invalidation strategies',
      body: `**Intuition:** "There are only two hard things in computer science: cache invalidation and naming things." Invalidation is hard because the cache and the database are two copies updated by *different* operations with no shared transaction.

| Strategy | How | Staleness | Pros | Cons |
|---|---|---|---|---|
| **TTL only** | Entries expire after N s | ≤ TTL | Simplest, self-healing | Stale up to TTL; short TTL = low hit ratio |
| **Delete-on-write** | After DB commit, \`DEL key\` | ~0 (+ races) | Fresh, cheap | Every writer must remember; races; failures leave stale |
| **Update-on-write (write-through)** | After commit, \`SET key newValue\` | ~0 | Next read is a hit | Concurrent writers can SET out of order |
| **Versioned keys** | Key includes a version: \`product:42:v17\` or namespace \`catalog:v9:*\` | 0 for new reads | O(1) bulk invalidation; no deletes | Old versions linger until TTL; need a version lookup |
| **CDC-driven** | DB change stream (Debezium/binlog/WAL) → Kafka → invalidator deletes keys | ~100 ms–s lag | Catches *every* writer (scripts, other services, migrations); retriable; ordered per key | Extra infrastructure; lag |
| **Event-driven (app events)** | Service publishes "ProductUpdated" → consumers invalidate | ~ms–s | Decoupled across services | Misses writes that bypass the service |

**Principles that hold in production**

1. **Always keep a TTL** as the safety net, even with explicit invalidation — invalidation *will* be missed sometimes.
2. **Invalidate after commit**, never before or inside the transaction; otherwise a concurrent reader re-caches the old row before your commit is visible.
3. **Prefer delete over set** on writes (a delete is idempotent and order-insensitive).
4. **For multi-writer systems use CDC**: Facebook's memcache paper describes *mcsqueal* tailing the MySQL commit log to broadcast deletes — same idea as Debezium today.
5. Make invalidation **retriable**: a failed \`DEL\` should go to a retry queue (Kafka consumer retry, outbox) rather than being silently swallowed.`,
      code: [
        {
          language: 'typescript',
          title: 'CDC-driven invalidation: Debezium change events from Kafka → Redis delete',
          code: `import { Kafka } from 'kafkajs';
import Redis from 'ioredis';

const redis = new Redis();
const kafka = new Kafka({ clientId: 'cache-invalidator', brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'cache-invalidator' });

// Debezium topic per table: <server>.<schema>.<table>, key = primary key
export async function run(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topics: ['shop.public.products'] });

  await consumer.run({
    // Per-partition ordering = per-product ordering (Debezium keys by PK)
    eachMessage: async ({ message }) => {
      if (!message.value) return;                            // tombstone after delete
      const evt = JSON.parse(message.value.toString());
      const row = evt.payload?.after ?? evt.payload?.before; // after=null on DELETE
      if (!row?.id) return;

      // Throwing here makes kafkajs retry the message -> invalidation is not lost
      await redis.unlink('catalog:v3:product:' + row.id, 'catalog:v3:product-card:' + row.id);
    },
  });
}`,
        },
      ],
      keyPoints: [
        'TTL is the safety net for every other strategy.',
        'Invalidate after commit; prefer delete over set.',
        'CDC catches writes from every path and makes invalidation retriable.',
      ],
      source: 'Scaling Memcache at Facebook (NSDI 2013) — mcsqueal commit-log invalidation',
    },
    {
      heading: 'The cache-aside race and how to close it',
      body: `**Intuition:** two people update a whiteboard from a filing cabinet. Alice reads the old file, gets distracted; Bob updates the file and wipes the whiteboard; Alice comes back and writes her *old* copy on the whiteboard. Everyone now reads stale data until someone wipes it again.

**The race (cache-aside + delete-on-write):**

1. Reader R misses, reads row **v1** from the DB (or a lagging replica).
2. Writer W commits **v2**, then \`DEL key\`.
3. R (slow — GC pause, network) now \`SET key v1\`.
4. Cache holds v1 until TTL. Replica lag makes this far more likely: reads from a replica 500 ms behind will happily re-cache old data right after a delete.

**Mitigations (strongest last)**

- **Short TTL** bounds the damage (always do this).
- **Delayed double delete**: delete after commit, then delete again after ~(replica lag + typical read time), e.g. 500 ms–1 s via a delay queue. Cheap, reduces but doesn't eliminate the window.
- **Read from the primary on miss** for keys recently written (or for all fills), so fills never use lagging replicas.
- **Leases (Facebook memcache)**: on a miss the cache hands out a lease token; a later \`DEL\` invalidates outstanding leases, so the stale reader's SET is rejected. Leases also rate-limit fills (stampede control).
- **Version-guarded set**: rows carry a monotonically increasing \`version\` (or \`updated_at\` + id). The writer, instead of plain delete, writes a **tombstone with the new version**; a reader's SET succeeds only if its version ≥ the stored version. Implemented atomically with Lua.

**Never do** "update cache then update DB" or "delete cache then update DB": the first leaves phantom data if the DB write fails; the second lets a reader re-cache the old row before your commit.`,
      diagram: `time --->
Reader R:  MISS --- read DB (v1) ................ SET v1  <- stale!
Writer W:            UPDATE -> COMMIT v2 -> DEL key
Cache:     empty                             empty    v1 (until TTL)

With version guard:
Writer W:  COMMIT v2 -> SET tombstone{v:2}
Reader R:  SET_IF_NEWER(v1) -> rejected (1 < 2); next read loads v2`,
      code: [
        {
          language: 'lua',
          title: 'Version-guarded cache set (Redis Lua): reject stale fills',
          code: `-- KEYS[1] = cache key (a hash with fields v = version, d = data)
-- ARGV[1] = version of the data being written
-- ARGV[2] = serialized data ('' for a tombstone written by the writer)
-- ARGV[3] = TTL seconds
local current = redis.call('HGET', KEYS[1], 'v')
local incoming = tonumber(ARGV[1])

if current and tonumber(current) > incoming then
  return 0                                   -- stale fill: a newer version exists
end
if current and tonumber(current) == incoming and ARGV[2] == '' then
  return 0                                   -- don't overwrite data with same-version tombstone
end

redis.call('HSET', KEYS[1], 'v', ARGV[1], 'd', ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1

-- Writer after COMMIT:  EVALSHA sha 1 product:42 <newVersion> '' 60
-- Reader after DB read: EVALSHA sha 1 product:42 <rowVersion> <json> 600
-- Reader treats d == '' as a miss and loads from the primary.`,
        },
      ],
      keyPoints: [
        'Stale-fill race: slow reader re-caches old data after the writer’s delete.',
        'Replica lag makes the race frequent — fill from primary or use version guards.',
        'Leases or version-guarded sets close the race; TTL bounds whatever remains.',
      ],
      source: 'Scaling Memcache at Facebook (NSDI 2013) — leases',
    },
    {
      heading: 'Cache stampede (dogpile / thundering herd)',
      body: `**Intuition:** the office coffee pot runs out, and 40 people all start brewing a new pot at the same time.

**What happens.** A hot key (home page, trending product, config) expires. In the milliseconds before someone refills it, every concurrent request misses and runs the expensive query. At 20K RPS on that key and a 200 ms recompute, **~4,000 identical DB queries** start before the first one finishes — enough to tip the DB over, which makes recomputes slower, which makes the pile-up bigger.

**Fixes (layer them)**

1. **Single-flight (in-process request coalescing)**: one in-flight promise per key per process; others await it. Cuts duplicates to one per pod (60 pods → 60 queries instead of 4,000).
2. **Distributed mutex**: \`SET lock:key token NX PX 5000\`; the winner recomputes; losers wait briefly and re-read, or serve stale. Cuts to one per cluster. Release with a compare-and-delete Lua script so you never delete someone else's lock.
3. **Stale-while-revalidate (soft TTL)**: store \`{ data, softExpiresAt }\` with a *hard* TTL much longer than the soft one. After soft expiry, serve the stale value immediately and trigger **one** background refresh (guarded by the lock). Users never wait.
4. **Probabilistic early expiration (XFetch)**: each reader refreshes early with a probability that rises as expiry approaches: refresh if \`now − Δ·β·ln(rand()) ≥ expiry\`, where Δ = recompute time and β ≈ 1 (higher = earlier). No locks, no coordination; provably near-optimal (Vattani et al., VLDB 2015).
5. **Refresh-ahead / never expire hot keys**: a background job refreshes known-hot keys on a schedule.
6. Plus **TTL jitter** so related keys don't expire together.`,
      code: [
        {
          language: 'typescript',
          title: 'Single-flight + XFetch early refresh + distributed lock with stale fallback',
          code: `import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const redis = new Redis({ commandTimeout: 100 });
const inflight = new Map<string, Promise<unknown>>();       // per-process single-flight
const RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

interface Entry<T> { data: T; expiresAt: number; deltaMs: number }

function shouldRefreshEarly(e: Entry<unknown>, beta = 1): boolean {
  // XFetch: -delta * beta * ln(U) is a positive random "head start"
  return Date.now() - e.deltaMs * beta * Math.log(Math.random()) >= e.expiresAt;
}

export async function getHot<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const raw = await redis.get(key);
  const entry = raw ? (JSON.parse(raw) as Entry<T>) : null;
  if (entry && !shouldRefreshEarly(entry)) return entry.data;   // fresh enough

  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return entry ? entry.data : running;             // coalesce within pod

  const p = (async () => {
    const token = randomUUID();
    const locked = await redis.set('lock:' + key, token, 'PX', 5000, 'NX');
    if (!locked) {                                              // another pod is refreshing
      if (entry) return entry.data;                             // serve stale
      await new Promise((r) => setTimeout(r, 50));
      const again = await redis.get(key);
      if (again) return (JSON.parse(again) as Entry<T>).data;
    }
    try {
      const start = Date.now();
      const data = await compute();
      const e: Entry<T> = { data, deltaMs: Date.now() - start, expiresAt: Date.now() + ttlMs };
      await redis.set(key, JSON.stringify(e), 'PX', ttlMs * 3); // hard TTL > soft TTL
      return data;
    } finally {
      if (locked) await redis.eval(RELEASE, 1, 'lock:' + key, token);
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return entry ? entry.data : p;                                // stale-while-revalidate
}`,
        },
      ],
      keyPoints: [
        'Stampede cost ≈ key RPS × recompute time duplicate queries.',
        'Single-flight per pod, lock per cluster, stale-while-revalidate for zero waiting.',
        'XFetch refreshes early probabilistically without coordination.',
      ],
      source: 'Vattani et al. — Optimal Probabilistic Cache Stampede Prevention (VLDB 2015)',
    },
    {
      heading: 'Cache penetration: Bloom filters and negative caching',
      body: `**Intuition:** someone keeps asking the librarian for books that don't exist. The notepad never has them (you only write down books you found), so every request goes to the archive — and a malicious person can do this 50,000 times a second.

**Penetration** = requests for keys that exist neither in the cache nor in the DB (random IDs, deleted items, enumeration attacks, buggy clients). Cache-aside never caches "not found", so 100% of these hit the DB.

**Fixes**

1. **Validate input early**: reject malformed IDs (wrong UUID format, out-of-range, bad checksum) at the edge/API layer.
2. **Negative caching**: cache "not found" with a sentinel and a **short TTL** (30–120 s) so creation of the item becomes visible quickly. Downside: many distinct random keys → memory churn; combine with a size cap.
3. **Bloom filter** of all valid IDs in front of the cache: "definitely not present" → return 404 without touching cache or DB; "maybe present" → normal path. No false negatives; false-positive rate *p* is tunable.
   - Size: **m = −n·ln(p) / (ln 2)²** bits, **k = (m/n)·ln 2** hash functions.
   - 10M IDs at 1% FP → ~9.6 bits/ID ≈ **12 MB**, k ≈ 7. At 0.1% → ~14.4 bits/ID ≈ 18 MB, k ≈ 10.
   - Standard Bloom filters can't delete: deleted IDs remain "maybe" (harmless — they fall through to the DB and get negative-cached). Rebuild periodically, or use a **Cuckoo filter**/counting Bloom filter to support deletes.
   - RedisBloom (\`BF.ADD\`, \`BF.EXISTS\`) or an in-process filter rebuilt from the DB.
4. **Rate-limit** per client/IP on 404-heavy patterns; alert on sudden 404 spikes.`,
      code: [
        {
          language: 'typescript',
          title: 'Bloom filter gate + negative caching (RedisBloom)',
          code: `import Redis from 'ioredis';

const redis = new Redis({ commandTimeout: 50 });
const NOT_FOUND = '__nf__';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// One-time setup: BF.RESERVE products:bf 0.001 50000000  (0.1% FP, 50M capacity)
// On product create: BF.ADD products:bf <id>

export async function findProduct(id: string, loadFromDb: (id: string) => Promise<string | null>) {
  if (!UUID_RE.test(id)) return null;                            // 1. cheap validation

  const maybe = await redis.call('BF.EXISTS', 'products:bf', id).catch(() => 1); // fail open
  if (maybe === 0) return null;                                  // 2. definitely absent

  const key = 'product:' + id;
  const cached = await redis.get(key);
  if (cached === NOT_FOUND) return null;                         // 3. negative cache hit
  if (cached !== null) return cached;

  const row = await loadFromDb(id);
  if (row === null) {
    await redis.set(key, NOT_FOUND, 'EX', 60);                   // short negative TTL
    return null;
  }
  await redis.set(key, row, 'EX', 600 + Math.floor(Math.random() * 120));
  return row;
}`,
        },
      ],
      keyPoints: [
        'Penetration = non-existent keys bypass the cache every time.',
        'Validate inputs, negative-cache with short TTL, gate with a Bloom filter.',
        'Bloom sizing: ~10 bits/key for 1% FP, ~14.4 bits/key for 0.1%.',
      ],
    },
    {
      heading: 'Cache avalanche: correlated expiry and cache-tier failure',
      body: `**Intuition:** a stampede is one coffee pot running dry. An avalanche is every coffee pot in the building running dry at the same moment — or the kitchen burning down.

**Two flavours**

1. **Synchronized expiry**: a deploy, a warm-up job or a migration writes 2M keys with the same TTL (1 h). Exactly one hour later they all expire within seconds → a miss storm across *many* keys (not one hot key — so single-flight per key doesn't help much).
2. **Cache tier failure**: a Redis primary dies, a cluster loses quorum, a network partition, or a mass eviction. Suddenly 95% hit ratio → 0% and the DB receives 20× its normal load.

**Fixes**

- **TTL jitter**: TTL = base × (0.9–1.1) or base + random(0, 20%). Spreads 2M expiries over ~12 minutes instead of 1 second.
- **HA for the cache**: replicas with automatic failover (Sentinel/Cluster/managed), multi-AZ; avoid one giant node.
- **Multi-level caching**: L1 in-process copies keep serving hot keys during an L2 outage.
- **Protect the DB**: circuit breaker around the cache, **bounded concurrency** for the DB fallback (bulkhead), request coalescing, shed non-critical traffic, serve stale.
- **Staggered warm-up** after recovery rather than letting live traffic refill everything at once.
- **Capacity plan the miss path**: know how much miss traffic the DB can take (e.g. 3× normal) and what gets shed beyond that.`,
      code: [
        {
          language: 'typescript',
          title: 'Avoid synchronized expiry when bulk-loading keys',
          code: `import Redis from 'ioredis';

const redis = new Redis();

// BAD: every key expires at exactly the same second
// for (const p of products) pipe.set(key(p), json(p), 'EX', 3600);

export async function warmProducts(products: { id: string }[], baseTtlSec = 3600): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < products.length; i += BATCH) {
    const pipe = redis.pipeline();
    for (const p of products.slice(i, i + BATCH)) {
      // +/-10% jitter: 2M keys spread over ~12 minutes instead of one instant
      const ttl = Math.round(baseTtlSec * (0.9 + Math.random() * 0.2));
      pipe.set('catalog:v3:product:' + p.id, JSON.stringify(p), 'EX', ttl);
    }
    await pipe.exec();
    await new Promise((r) => setTimeout(r, 20)); // don't saturate Redis during warm-up
  }
}`,
        },
      ],
      keyPoints: [
        'Avalanche = many keys or the whole tier missing at once.',
        'Jitter TTLs; HA replicas; L1 fallback; bounded DB fallback.',
        'Plan the miss-path capacity explicitly.',
      ],
    },
    {
      heading: 'Hot keys: detection and mitigation',
      body: `**Intuition:** one celebrity's autograph table gets a line around the block while all other tables are empty. Adding more tables (shards) doesn't help — everyone wants *that* person.

**Why it hurts.** Consistent hashing / Redis Cluster puts a key on exactly one shard. A single Redis shard handles ~100K–200K simple ops/s; one viral key at 300K reads/s saturates that shard's CPU or NIC, raising latency for *every other key* on it. Large hot values (100 KB × 50K RPS = 5 GB/s) saturate the network long before CPU.

**Detect**

- \`redis-cli --hotkeys\` (requires an LFU maxmemory policy) or sampling \`MONITOR\` briefly (expensive — seconds only).
- Client-side sampling: count key accesses in the app (top-K / count-min sketch) and export metrics.
- Per-shard CPU/ops imbalance in cluster metrics; proxy stats (Envoy/Twemproxy).

**Mitigate (read-hot)**

1. **L1 in-process cache** with a short TTL (1–5 s): 60 pods × 1 fetch per 2 s = 30 Redis reads/s instead of 300K. Best first move.
2. **Key replication with suffixes**: store copies \`hot:product:42#0 … #7\` (spread across slots); readers pick a random suffix; writers update/delete all copies.
3. **Read replicas** for the shard (\`scaleReads\`), accepting replica staleness.
4. **Shrink the value**: cache only needed fields, compress.

**Mitigate (write-hot)** — a global counter (likes on a viral post, flash-sale stock):

- **Shard the counter**: \`likes:{post}:0..15\`, INCR a random shard, sum on read (or cache the sum for 1 s).
- Buffer increments in-process and flush every 100 ms (write-back).

**Pre-empt** known hot events (flash sales, celebrity launches): pre-warm, pre-replicate, and raise L1 TTL for the event.`,
      code: [
        {
          language: 'typescript',
          title: 'Hot-key replication with random suffix reads and fan-out invalidation',
          code: `import { Cluster } from 'ioredis';

const cluster = new Cluster([{ host: 'redis-0', port: 6379 }]);
const REPLICAS = 8;                               // copies spread across different slots

// No hash tag -> each suffix hashes to a (likely) different slot/shard
const replicaKey = (key: string, i: number) => key + '#' + i;

export async function getHot(key: string): Promise<string | null> {
  const i = Math.floor(Math.random() * REPLICAS); // spread reads over 8 shards
  return cluster.get(replicaKey(key, i));
}

export async function setHot(key: string, value: string, ttlSec: number): Promise<void> {
  // Writes fan out to every copy; different slots -> separate commands, not MULTI
  await Promise.all(
    Array.from({ length: REPLICAS }, (_, i) =>
      cluster.set(replicaKey(key, i), value, 'EX', ttlSec + Math.floor(Math.random() * 10)),
    ),
  );
}

export async function invalidateHot(key: string): Promise<void> {
  await Promise.all(Array.from({ length: REPLICAS }, (_, i) => cluster.unlink(replicaKey(key, i))));
}
// Combine with an L1 (1-5s TTL) in each pod for the hottest handful of keys.`,
        },
      ],
      keyPoints: [
        'More shards don’t fix a single hot key; replicate or cache it locally.',
        'L1 with seconds-level TTL is the cheapest, most effective mitigation.',
        'Write-hot counters: shard the counter or buffer increments.',
      ],
    },
    {
      heading: 'Cache warming after deploys, restarts and migrations',
      body: `**Intuition:** opening a restaurant with an empty kitchen at the dinner rush — every order has to be prepped from scratch. Prep before opening.

**When caches go cold**

- **In-process L1** is empty on every pod start — a rolling deploy of 60 pods cold-starts 60 L1s; an autoscale event adds cold pods at the worst moment (peak).
- **Redis restart without persistence**, failover to an empty replica after a full resync failure, or a **new cluster** (migration, resharding into a new cluster, key-format change / namespace bump).

**Techniques**

1. **Pre-warm before readiness**: on startup, load the top-N hot keys (from yesterday's access logs or a "hot keys" sorted set) into L1 before the readiness probe passes. Bound it (e.g. 5–15 s) so deploys don't stall.
2. **Gradual traffic shift**: slow start at the LB, canary pods first, \`maxSurge\` small — cold pods take a small share while warming.
3. **Dual-read migration** for a new cluster or key format: read new → on miss read old → write to new. Writes/invalidations go to both. After a TTL period, remove the old path.
4. **Snapshot restore**: for Redis, keep RDB snapshots (possibly from a replica) so a restart loads a warm dataset.
5. **Namespace bumps** (\`catalog:v3 → v4\`) are cold starts too — do them off-peak, or pre-populate v4 before switching.
6. **Don't warm everything**: warming 50M keys competes with live traffic; warm the head of the distribution and let the tail fill naturally.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS: warm L1 from a hot-keys set before reporting ready',
          code: `import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';

@Injectable()
export class CacheWarmer implements OnApplicationBootstrap {
  private readonly log = new Logger(CacheWarmer.name);
  ready = false;                                        // readiness probe checks this

  constructor(private readonly redis: Redis, private readonly l1: LRUCache<string, string>) {}

  async onApplicationBootstrap(): Promise<void> {
    const deadline = Date.now() + 10_000;               // never block startup > 10s
    try {
      // Maintained elsewhere: ZINCRBY hot:keys 1 <key> on access (sampled)
      const hot = await this.redis.zrevrange('hot:keys', 0, 1999);
      for (let i = 0; i < hot.length && Date.now() < deadline; i += 200) {
        const batch = hot.slice(i, i + 200);
        const values = await this.redis.mget(...batch);
        batch.forEach((k, j) => { const v = values[j]; if (v !== null) this.l1.set(k, v); });
      }
      this.log.log('warmed ' + this.l1.size + ' keys');
    } catch (e) {
      this.log.warn('warm-up skipped: ' + (e as Error).message); // degrade, don't crash
    } finally {
      this.ready = true;
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Every deploy, restart, autoscale and namespace bump is a cold start.',
        'Warm the hot head before readiness, bounded in time.',
        'Dual-read for cluster or key-format migrations.',
      ],
    },
    {
      heading: 'Redis is down: fallback, circuit breaker, load shedding',
      body: `**Intuition:** when the notepad disappears, you can't send every question to the filing clerk at full speed — you'd bury them. Answer what you can from memory, queue or refuse the rest, and keep checking whether the notepad is back.

**Failure shapes**: hard down (connection refused — fast failures), **slow** (timeouts — the dangerous one: each request waits and holds resources), partial (one shard down in a cluster), failover in progress (5–30 s of errors).

**Defences**

1. **Aggressive timeouts**: Redis ops normally take < 1 ms; set command timeouts of **50–100 ms** and few retries (\`maxRetriesPerRequest: 1\`), and disable unbounded offline queues (ioredis \`enableOfflineQueue: false\`, or bounded) so requests don't pile up in memory.
2. **Circuit breaker**: after N failures in a window, open the circuit → skip Redis entirely for 5–30 s, then half-open probes. Saves latency and prevents connection storms against a recovering Redis.
3. **Serve stale from L1**: extend L1 TTL while the circuit is open ("stale-if-error").
4. **Bulkhead the DB fallback**: allow at most K concurrent DB fallback queries (e.g. 50 per pod); excess requests get **degraded responses** (defaults, partial page) or **503 with Retry-After**. Prioritise: checkout > browse > recommendations.
5. **Load shedding at the edge**: drop low-priority traffic (bots, prefetch, analytics beacons) when the DB approaches saturation.
6. **Alert and recover**: after Redis returns, ramp traffic back (half-open) to avoid a stampede on a cold cache.

**Anti-pattern**: \`try { redis.get } catch { return db.query }\` with no limit — converts a cache outage into a DB outage within seconds (the avalanche).`,
      code: [
        {
          language: 'typescript',
          title: 'Circuit breaker around Redis + bounded DB fallback',
          code: `import Redis from 'ioredis';

const redis = new Redis({ commandTimeout: 50, maxRetriesPerRequest: 1, enableOfflineQueue: false });

class Breaker {
  private failures = 0;
  private openUntil = 0;
  constructor(private readonly threshold = 20, private readonly coolDownMs = 10_000) {}
  canTry() { return Date.now() >= this.openUntil; }          // half-open after cool-down
  success() { this.failures = 0; }
  failure() {
    if (++this.failures >= this.threshold) { this.openUntil = Date.now() + this.coolDownMs; this.failures = 0; }
  }
}

class Semaphore {
  private active = 0;
  constructor(private readonly max: number) {}
  tryAcquire() { if (this.active >= this.max) return false; this.active++; return true; }
  release() { this.active--; }
}

const breaker = new Breaker();
const dbFallback = new Semaphore(40);                         // per pod, sized from DB capacity

export class DegradedError extends Error {}

export async function readThrough<T>(key: string, load: () => Promise<T>, stale?: () => T | undefined): Promise<T> {
  if (breaker.canTry()) {
    try {
      const v = await redis.get(key);
      breaker.success();
      if (v !== null) return JSON.parse(v) as T;
    } catch {
      breaker.failure();
    }
  }
  const s = stale?.();                                        // L1 stale-if-error
  if (s !== undefined && !breaker.canTry()) return s;

  if (!dbFallback.tryAcquire()) {
    if (s !== undefined) return s;
    throw new DegradedError('shedding: DB fallback saturated'); // map to 503 + Retry-After
  }
  try { return await load(); } finally { dbFallback.release(); }
}`,
        },
      ],
      keyPoints: [
        'Slow Redis is worse than dead Redis: tight timeouts, no unbounded queues.',
        'Circuit breaker + stale L1 + bounded DB fallback + shedding.',
        'Ramp back gradually after recovery.',
      ],
    },
    {
      heading: 'Redis memory full: policies and eviction surprises',
      body: `**Intuition:** when the notepad is full, the rules for what to erase matter — and if the notepad is shared with your to-do list, the rule might erase your to-dos.

**Policies recap** (\`maxmemory-policy\`): \`noeviction\` (default), \`allkeys-lru\`, \`allkeys-lfu\`, \`allkeys-random\`, \`volatile-lru\`, \`volatile-lfu\`, \`volatile-random\`, \`volatile-ttl\`.

**Surprises seen in production**

| Symptom | Cause |
|---|---|
| \`OOM command not allowed\` on writes | \`noeviction\` default, or \`volatile-*\` policy but most keys have no TTL (nothing evictable) |
| Users randomly logged out; locks lost; rate limits reset | Sessions/locks/rate-limit counters share an instance with the cache under \`allkeys-*\` and get evicted |
| Memory "full" but dataset looks small | Fragmentation (\`mem_fragmentation_ratio\` > 1.5), client output buffers (slow pub/sub subscribers, big MONITOR), replication backlog, Lua caches |
| Latency spikes when near limit | Eviction runs inline in the command path; evicting big keys blocks (enable \`lazyfree-lazy-eviction\`) |
| Hit ratio falls, evictions/s climbs | Working set grew beyond memory, big new values, TTLs removed by a deploy, or a key explosion (unbounded key cardinality, e.g. keys with timestamps) |
| Replica OOM / resync loops | Replica with less memory than primary; CoW during RDB for resync |

**Diagnose**: \`INFO memory\` (used_memory, used_memory_rss, fragmentation ratio, maxmemory), \`INFO stats\` (evicted_keys, expired_keys, keyspace_hits/misses), \`MEMORY DOCTOR\`, \`redis-cli --bigkeys\` / \`--memkeys\`, \`MEMORY USAGE key\`, \`CLIENT LIST\` (omem for output buffers).

**Fix**: separate instances by eviction semantics (cache = \`allkeys-lfu\`; sessions/locks = \`noeviction\` + alerts at 80%); TTLs on everything cacheable; bound key cardinality; compress/split big values; \`activedefrag yes\`; set \`client-output-buffer-limit\` for pubsub; scale out (more shards) rather than up.`,
      code: [
        {
          language: 'bash',
          title: 'Memory triage on a struggling Redis',
          code: `# How full, how fragmented, how much is evicted?
redis-cli INFO memory | egrep 'used_memory_human|used_memory_rss_human|maxmemory_human|maxmemory_policy|mem_fragmentation_ratio'
redis-cli INFO stats  | egrep 'evicted_keys|expired_keys|keyspace_hits|keyspace_misses'

# Which keys are big? (SCAN-based, safe-ish on production; run on a replica if possible)
redis-cli --bigkeys
redis-cli --memkeys --memkeys-samples 100

# Who is holding output buffers (slow subscribers, MONITOR)?
redis-cli CLIENT LIST | awk '{for(i=1;i<=NF;i++) if($i ~ /^(omem|cmd|name)=/) printf $i" "; print ""}' | sort -t= -k2 -nr | head

# Built-in advice
redis-cli MEMORY DOCTOR

# How many keys lack a TTL? (sample 10k keys via SCAN)
redis-cli --scan --count 1000 | head -10000 | while read k; do redis-cli TTL "$k"; done | grep -c '^-1$'`,
        },
      ],
      keyPoints: [
        'Default noeviction makes a full cache reject writes.',
        'Never share an evicting instance with sessions, locks or rate limits.',
        'Fragmentation and output buffers can “fill” memory without data growth.',
      ],
    },
    {
      heading: 'Stale local (L1) caches across instances',
      body: `**Intuition:** 60 employees each keep a sticky note of today's price. When the price changes, you have to tell all 60 — and one of them is at lunch.

**Problem.** Deleting from Redis doesn't touch the in-process caches on N pods. Different pods serve different versions ("the price flips when I refresh") until each L1 entry expires.

**Options**

1. **Short L1 TTL** (1–30 s) — simplest; staleness bounded by TTL. Fine for most read-mostly data.
2. **Pub/sub broadcast**: on write, publish \`invalidate <key>\` on a Redis channel; every pod subscribes and deletes locally. Redis pub/sub is **at-most-once**: a pod that's disconnected misses messages → keep the TTL safety net and **clear L1 on reconnect**.
3. **Durable fan-out**: Kafka topic of invalidations; each pod consumes (own consumer group or assigned partitions from latest) — survives brief disconnects, more infrastructure.
4. **Redis client-side caching (Redis 6+)**: \`CLIENT TRACKING on\`; Redis remembers which keys each connection read and pushes invalidation messages when they change (default mode tracks keys per client; BCAST mode by prefix). Libraries: node-redis v5 client-side cache, Lettuce, redis-py. Memory for tracking tables lives on the server.
5. **Version check**: store a tiny version counter in Redis (\`product:42:ver\`); L1 entries record the version; on read, a cheap \`GET ver\` (or batched every second) validates. Trades one small round-trip for correctness.

**Rule of thumb**: L1 only for data where brief inconsistency is acceptable; critical flows (checkout price, permissions revocation) read from the authoritative store or validate the version.`,
      code: [
        {
          language: 'typescript',
          title: 'Pub/sub L1 invalidation with reconnect safety',
          code: `import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';

export const l1 = new LRUCache<string, object>({ max: 50_000, ttl: 20_000 }); // TTL = safety net
const pub = new Redis();
const sub = new Redis();                         // subscriber connection is dedicated
const CHANNEL = 'cache:invalidate';

sub.subscribe(CHANNEL).catch(() => {});
sub.on('message', (_channel, key: string) => {
  if (key === '*') l1.clear();
  else l1.delete(key);
});

// Pub/sub is at-most-once: anything published while we were disconnected is lost
sub.on('ready', () => l1.clear());               // fires on initial connect and every reconnect

export async function invalidate(key: string): Promise<void> {
  await pub.unlink(key);                         // L2 first
  await pub.publish(CHANNEL, key);               // then every pod's L1 (including ours)
}

// Writer flow: COMMIT in DB -> invalidate('catalog:v3:product:42')`,
        },
      ],
      keyPoints: [
        'Redis delete doesn’t reach per-pod L1 caches.',
        'Broadcast invalidation + TTL safety net + clear on reconnect.',
        'Redis client-side caching (CLIENT TRACKING) automates invalidation pushes.',
      ],
    },
    {
      heading: 'Frequently changing data: cache it, restructure it, or don’t',
      body: `**Intuition:** writing a live football score on a notepad that you re-copy every second is more work than just looking at the scoreboard.

**Symptoms of caching the wrong thing:** invalidation rate ≈ read rate, hit ratio < 50%, CPU spent serializing values nobody reads twice, stale-data bugs.

**Ask: reads per write per key.** If a key is read fewer than ~2–3 times between writes, caching it by entity rarely pays.

**Strategies**

1. **Don't cache — make the source fast**: an indexed primary-key read on Postgres is 1–2 ms; Redis as the *primary store* for the fast-changing value (e.g. live counters, presence, stock in a flash sale) with persistence/replication.
2. **Split volatile from stable**: cache the product description (changes monthly) separately from stock and price (change every second). Compose at read time: \`card = cachedStatic + liveStock\`.
3. **Cache at a coarser grain with short TTL**: "top 100 trending" recomputed every 5 s is one hot key with 5 s staleness, instead of invalidating on every like.
4. **Write-through / update-in-place with atomic ops**: \`HINCRBY stock:{sku} available -1\` keeps the cache as the fast source; reconcile with the DB asynchronously.
5. **Micro-caching**: 1–2 s TTL on extremely hot, rapidly changing endpoints (e.g. a live scoreboard API) collapses thousands of requests per second into ~1 origin request per second per node while staying "live enough".
6. **Push instead of pull**: for live UIs, stream changes (WebSocket/SSE) rather than caching and polling.

**Correctness first**: stock at checkout, account balances, auth revocations → read the source of truth (or a strongly consistent store), even if the display path uses a cache.`,
      code: [
        {
          language: 'nginx',
          title: 'Micro-caching a rapidly changing public endpoint (1 s TTL + collapse)',
          code: `proxy_cache_path /var/cache/nginx/micro levels=1:2 keys_zone=micro:50m max_size=1g inactive=10s;

server {
  location /api/live-scores {
    proxy_pass http://scores_backend;
    proxy_cache micro;
    proxy_cache_key $request_uri;
    proxy_cache_valid 200 1s;              # "live enough": at most 1s stale
    proxy_cache_lock on;                   # only one request per key goes to origin
    proxy_cache_lock_timeout 500ms;
    proxy_cache_use_stale updating error timeout http_502 http_503;
    proxy_cache_background_update on;      # refresh in background, serve stale meanwhile
    add_header X-Cache-Status $upstream_cache_status;
  }
}`,
        },
      ],
      keyPoints: [
        'Measure reads per write per key before caching.',
        'Split volatile fields from stable ones; compose at read time.',
        'Micro-caching (1 s + request collapsing) tames hot, fast-changing endpoints.',
      ],
    },
    {
      heading: 'Debugging a sudden hit-ratio drop',
      body: `**Intuition:** if the notepad suddenly stops having answers, either someone erased it, you started writing answers under different headings, or people started asking new questions.

**Playbook (fast to slow)**

1. **What changed?** Correlate the drop timestamp with deploys, config changes, feature flags, cache node failovers/reshards, marketing campaigns, bot traffic.
2. **Key format / serializer changed?** A deploy that changed the key (added a field, new version prefix, different locale casing, JSON key order used in a hash) means every read misses the old keys → looks like a cold cache that never warms if the key contains **per-request data** (timestamps, request IDs, unsorted query params).
3. **Evictions?** \`INFO stats\` evicted_keys rising → memory pressure: bigger values after a deploy, a key-cardinality explosion, TTLs dropped, another tenant sharing the instance.
4. **Expirations?** expired_keys spike → someone shortened the TTL, or synchronized expiry (avalanche).
5. **Topology?** Failover to an empty replica, resharding, or client using a stale slot map (MOVED storms), a new node added with modulo hashing.
6. **Traffic mix?** New endpoint/scraper/bot reading the long tail (penetration or scan), a new region or client version with different parameters.
7. **Client bugs?** Errors or timeouts counted as misses (Redis slow → timeouts → "miss" → DB), connection pool exhaustion.

**Instrument so this is quick next time**: hit/miss/error counters **per key prefix**, per pod and per version; a sampled log of missed keys; eviction and expiry rates; Redis latency p99; deploy markers on dashboards.`,
      code: [
        {
          language: 'typescript',
          title: 'Per-prefix hit/miss/error metrics (Prometheus) to localise drops quickly',
          code: `import { Counter } from 'prom-client';
import Redis from 'ioredis';

const redis = new Redis({ commandTimeout: 50 });
const cacheOps = new Counter({
  name: 'cache_requests_total',
  help: 'Cache lookups by prefix and outcome',
  labelNames: ['prefix', 'outcome', 'app_version'] as const,   // outcome: hit|miss|error
});
const VERSION = process.env.APP_VERSION ?? 'dev';

// 'catalog:v3:product:42' -> 'catalog:v3:product' (bounded label cardinality)
const prefixOf = (key: string) => key.split(':').slice(0, 3).join(':');

export async function instrumentedGet(key: string): Promise<string | null> {
  const prefix = prefixOf(key);
  try {
    const v = await redis.get(key);
    cacheOps.inc({ prefix, outcome: v === null ? 'miss' : 'hit', app_version: VERSION });
    if (v === null && Math.random() < 0.001) console.info('cache_miss_sample', { key }); // sampled
    return v;
  } catch (e) {
    cacheOps.inc({ prefix, outcome: 'error', app_version: VERSION }); // timeouts are not "misses"
    throw e;
  }
}
// PromQL: sum by (prefix, app_version) (rate(cache_requests_total{outcome="hit"}[5m]))
//       / sum by (prefix, app_version) (rate(cache_requests_total[5m]))`,
        },
      ],
      keyPoints: [
        'Correlate with deploys first: key format and serializer changes are the top cause.',
        'Separate evictions, expirations, errors and topology changes.',
        'Per-prefix, per-version hit metrics make root-causing a minutes-long task.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'cache-failures-cc-1',
      title: 'Stop the flash-sale stampede',
      context:
        'The "deal of the day" endpoint reads a 150 ms aggregate query (price, stock, reviews summary). It gets 15K RPS across 40 pods. Every 60 s, when the key expires, Postgres CPU spikes to 100% and p99 hits 6 s. When Redis blipped last week, the DB went down entirely.',
      task:
        'Rewrite the loader so expiry never causes a thundering herd, users don’t wait on recomputes, and a Redis outage can’t flood the database.',
      starter: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis();
const pg = new Pool({ max: 30 });

export async function getDeal(dealId: string) {
  const key = 'deal:' + dealId;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const { rows } = await pg.query('SELECT * FROM deal_summary($1)', [dealId]); // ~150 ms
  await redis.set(key, JSON.stringify(rows[0]), 'EX', 60);
  return rows[0];
}`,
      },
      hints: [
        'How many concurrent requests arrive during a 150 ms recompute at 15K RPS? How many of them run the query?',
        'Can you keep serving the old value while exactly one worker refreshes it? What do you need to store alongside the value?',
        'If redis.get throws or hangs, where does every request go, and what limits it?',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const redis = new Redis({ commandTimeout: 50, maxRetriesPerRequest: 1, enableOfflineQueue: false });
const pg = new Pool({ max: 30 });
const inflight = new Map<string, Promise<Deal>>();
let dbSlots = 5;                                          // per-pod cap on fallback recomputes
const RELEASE = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0";

interface Deal { id: string; price: number; stock: number; rating: number }
interface Envelope { deal: Deal; softExpiry: number }

async function compute(dealId: string): Promise<Deal> {
  const { rows } = await pg.query<Deal>('SELECT * FROM deal_summary($1)', [dealId]);
  return rows[0];
}

async function refresh(key: string, dealId: string): Promise<Deal> {
  const running = inflight.get(key);
  if (running) return running;                            // single-flight per pod
  const p = (async () => {
    const token = randomUUID();
    const got = await redis.set('lock:' + key, token, 'PX', 3000, 'NX').catch(() => null);
    if (!got) throw new Error('refresh owned elsewhere');
    try {
      const deal = await compute(dealId);
      const env: Envelope = { deal, softExpiry: Date.now() + 60_000 };
      await redis.set(key, JSON.stringify(env), 'EX', 600);   // hard TTL 10x soft
      return deal;
    } finally {
      await redis.eval(RELEASE, 1, 'lock:' + key, token).catch(() => {});
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function getDeal(dealId: string): Promise<Deal> {
  const key = 'deal:v2:' + dealId;
  let env: Envelope | null = null;
  try {
    const raw = await redis.get(key);
    env = raw ? (JSON.parse(raw) as Envelope) : null;
  } catch { /* Redis down: fall through to bounded path */ }

  if (env) {
    if (Date.now() > env.softExpiry) void refresh(key, dealId).catch(() => {}); // background
    return env.deal;                                      // stale-while-revalidate
  }
  // True miss (cold or Redis down): bounded, coalesced recompute
  const running = inflight.get(key);
  if (running) return running;
  if (dbSlots <= 0) throw new Error('503: deal temporarily unavailable'); // shed, don't flood DB
  dbSlots--;
  try {
    return await refresh(key, dealId).catch(() => compute(dealId));
  } finally {
    dbSlots++;
  }
}`,
      },
      explanation: `**Fixes**

- **Herd at expiry**: at 15K RPS and a 150 ms query, about 2,250 requests missed together and each ran the query. Now the value has a *soft* expiry and a 10× longer *hard* TTL. After soft expiry, users get the stale value immediately and exactly one refresh runs.
- **Single refresher**: in-process single-flight (one refresh per pod) plus a Redis lock (\`SET NX PX\`, released with compare-and-delete) means one recompute per cluster.
- **Cold or true miss**: concurrent misses on a pod share one promise, and a per-pod cap (5 slots × 40 pods ≤ 200 concurrent queries worst case, usually 1) sheds the excess with a fast 503 instead of queueing on the DB pool.
- **Redis outage**: a 50 ms timeout with no offline queue makes Redis failures fast. Requests fall into the bounded path instead of an unbounded DB stampede.
- **Key versioning** (\`deal:v2\`) lets you change the envelope format without parsing errors on old values.`,
      followUps: [
        {
          "q": "How would you load-test that this loader really prevents the expiry spike?",
          "a": "Run k6 or Gatling at 15K RPS against one deal ID for at least 5 minutes, forcing soft expiry to 10 s so you see many cycles. Assert three things: DB query count for deal_summary per expiry is about 1 (pg_stat_statements calls delta or an app counter), p99 latency shows no sawtooth at expiry boundaries, and stale-served counts spike briefly then drop. Then inject faults: kill Redis (or add 800 ms latency with toxiproxy) and verify the DB stays within 200 concurrent queries and excess requests get fast 503s rather than timeouts."
        },
        {
          "q": "Now there are 5,000 different deals, each moderately hot, instead of one. What changes in the design?",
          "a": "The per-key lock and soft TTL still work, but refreshes now total about 5,000 per minute, around 83 per second, which the DB handles only if spread out. Add TTL jitter so soft expiries don't align, and cap concurrent background refreshes per pod (a small queue) so a cold start doesn't launch 5,000 refreshes at once. The inflight map grows to 5,000 entries at most, fine. The dbSlots cap matters more because many distinct cold keys can't be coalesced; on cold start, warm the top deals gradually instead."
        }
      ],
    },
    {
      id: 'cache-failures-cc-2',
      title: 'Fix the stale-price invalidation bug',
      context:
        'Customers occasionally see an old price for up to an hour after a merchant updates it. Reads use a read replica with ~300–800 ms lag. The team says "but we update the cache on every write".',
      task:
        'Rewrite the read and write paths so a concurrent reader (or replica lag) can never overwrite a newer price in the cache, and so failed invalidations are retried.',
      starter: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis();
const primary = new Pool({ host: 'pg-primary' });
const replica = new Pool({ host: 'pg-replica' });

export async function getPrice(sku: string) {
  const c = await redis.get('price:' + sku);
  if (c) return Number(c);
  const { rows } = await replica.query('SELECT price FROM prices WHERE sku = $1', [sku]);
  await redis.set('price:' + sku, String(rows[0].price), 'EX', 3600);
  return rows[0].price;
}

export async function setPrice(sku: string, price: number) {
  const client = await primary.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE prices SET price = $2 WHERE sku = $1', [sku, price]);
    await redis.set('price:' + sku, String(price), 'EX', 3600);   // "update cache on write"
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}`,
      },
      hints: [
        'The cache is written before COMMIT. What if COMMIT fails, or a reader queries between the SET and the COMMIT?',
        'A reader started a replica query 500 ms ago and gets the old price. It SETs after the writer. What survives in the cache, and for how long?',
        'If each row had a monotonically increasing version, how could Redis refuse an older write atomically?',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis({ commandTimeout: 50 });
const primary = new Pool({ host: 'pg-primary' });
const replica = new Pool({ host: 'pg-replica' });

// Version-guarded set: only accept data at least as new as what's stored
const SET_IF_NEWER = [
  "local cur = redis.call('HGET', KEYS[1], 'v')",
  "if cur and tonumber(cur) > tonumber(ARGV[1]) then return 0 end",
  "if cur and tonumber(cur) == tonumber(ARGV[1]) and ARGV[2] == '' then return 0 end",
  "redis.call('HSET', KEYS[1], 'v', ARGV[1], 'd', ARGV[2])",
  "redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))",
  'return 1',
].join('\\n');

const key = (sku: string) => 'price:v2:' + sku;

export async function getPrice(sku: string): Promise<number | null> {
  const [v, d] = (await redis.hmget(key(sku), 'v', 'd').catch(() => [null, null])) as (string | null)[];
  if (v !== null && d) return Number(d);                   // tombstone (d === '') => miss

  // Fill from the primary for correctness-sensitive data (or replica + version guard)
  const { rows } = await primary.query<{ price: string; version: string }>(
    'SELECT price, version FROM prices WHERE sku = $1', [sku]);
  if (!rows[0]) return null;
  await redis
    .eval(SET_IF_NEWER, 1, key(sku), rows[0].version, rows[0].price, 3600 + Math.floor(Math.random() * 300))
    .catch(() => {});
  return Number(rows[0].price);
}

export async function setPrice(sku: string, price: number): Promise<void> {
  const client = await primary.connect();
  let version: string;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ version: string }>(
      'UPDATE prices SET price = $2, version = version + 1 WHERE sku = $1 RETURNING version', [sku, price]);
    // Transactional outbox: invalidation survives crashes and Redis outages
    await client.query('INSERT INTO cache_outbox(cache_key, version) VALUES ($1, $2)', [key(sku), rows[0].version]);
    await client.query('COMMIT');
    version = rows[0].version;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  // Fast path after COMMIT: tombstone with the new version (older fills now rejected)
  await redis.eval(SET_IF_NEWER, 1, key(sku), version, '', 120).catch(() => {});
  // An outbox relay (or Debezium CDC) re-applies the tombstone and deletes outbox rows.
}`,
      },
      explanation: `**Fixes**

- **Cache written inside the transaction**: SET happened before COMMIT, so a rollback left a price that never existed, and a reader could see the new cached price while the DB still had the old one. The cache is now touched only **after COMMIT**.
- **Stale fill from replica lag**: a reader that queried the lagging replica could SET the old price *after* the writer, and it stayed for an hour. Now every row has a monotonically increasing \`version\`, and a Lua script rejects any cache write older than what is stored. The writer's post-commit **tombstone** carries the new version, so late stale fills are refused.
- **Fill source**: price is correctness-sensitive, so fills read the primary. With the version guard, replica fills would also be safe (they'd just miss more often).
- **Lost invalidations**: a Redis blip after commit used to leave stale data. The transactional **outbox** row, written in the same transaction and relayed or consumed via CDC, guarantees the invalidation is eventually applied.
- **Jittered TTL** remains as the final safety net and avoids synchronized expiry.`,
      followUps: [
        {
          "q": "The outbox relay is down for 20 minutes during an incident. What do customers see, and how do you make the system tolerate it?",
          "a": "The post-commit fast-path tombstone usually already invalidated the key, so most customers see the new price. Only writes where both the fast path and the relay failed (Redis blip plus relay down) show stale prices, bounded by the 120 s tombstone TTL or the 1 h value TTL. The outbox rows queue up safely in Postgres; when the relay recovers it replays them in order, and the version guard makes replays idempotent. Alert on oldest unprocessed outbox row age, for example page at 2 minutes."
        },
        {
          "q": "The interviewer says filling every price from the primary will overload it at 50K reads/s of misses. How do you use the replica safely?",
          "a": "Read from the replica and keep the version guard: a lagging replica returns version N-1, the tombstone already holds N, and Lua rejects the fill. The reader then serves the replica value for that one request but doesn't cache it, or retries against the primary only in that rejected case, which is rare. That keeps primary load proportional to recent writes rather than to misses. Alternatively compare the replica's replay LSN to the write LSN stored with the tombstone and only cache if the replica has caught up."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'cache-failures-iq-01',
      difficulty: 'expert',
      question:
        'A celebrity is launching a product in 10 minutes. You expect 400K RPS on one product page and one product ID. Your Redis cluster has 12 shards. What will break and what do you do right now?',
      whatInterviewerLooksFor: [
        'Identifies hot-key shard saturation and stampede at expiry',
        'Immediate mitigations: L1, key replication, pre-warm, no expiry during event',
        'Write-hot handling for stock/likes',
        'Protecting the DB and degrading gracefully',
      ],
      modelAnswer: `### What breaks
- **Hot key**: product:777 lives on **one** shard. At ~100–200K ops/s per shard, 400K RPS saturates that shard's CPU/NIC. Latency rises for every other key on it too, so it's a partial cluster outage.
- **Value size**: a 20 KB page payload × 400K = 8 GB/s, far beyond one node's NIC.
- **Stampede**: when the key expires, hundreds of concurrent misses recompute and hammer the DB.
- **Write-hot**: stock decrements and like counters on a single key.

### Next 10 minutes
1. **L1 in-process cache** for this key: 2 s TTL. With 200 pods, Redis sees about 100 reads/s instead of 400K. This is the biggest lever, deployable as a feature flag.
2. **Pre-warm** L1 and L2 before launch. **Disable expiry** for the event (or give it a long hard TTL) and refresh it from one background job every few seconds (refresh-ahead), so there is no stampede.
3. **Key replicas**: \`product:777#0..15\` across shards, random read, fan-out write, in case L1 misses are still heavy.
4. **CDN micro-cache** for the anonymous page (1–5 s TTL with request collapsing). Most traffic never reaches origin.
5. **Stock**: don't read stock from the page cache. Keep it in a separate small key and reserve with an atomic \`DECR\` (or a Lua check-and-decrement). If it's too hot, split it into N stock buckets. The DB reservation is the source of truth, reconciled asynchronously.
6. **Protect the DB**: single-flight plus a bounded fallback. Shed recommendations and reviews first (serve without them).
7. **Watch**: per-shard ops/CPU, L1 hit ratio, 5xx, DB connections. Have kill switches ready.

### After the event
Build hot-key detection (client-side top-K sampling) and automatic L1 promotion for keys above a threshold.`,
      followUps: [
        { q: 'Why not just add more Redis shards?', a: 'A single key maps to one slot on one shard; adding shards doesn’t split a key. You must replicate the key or cache it closer to the app.' },
        { q: 'How stale can the product page be with a 2 s L1 TTL and a background refresh?', a: 'About refresh interval + L1 TTL (e.g. 5 s + 2 s); acceptable for descriptions, not for stock — hence stock is served separately.' },
      ],
      pitfalls: [
        'Thinking consistent hashing spreads one key',
        'Leaving a normal TTL on the hot key during the event',
        'Serving stock from the same cached blob',
      ],
    },
    {
      id: 'cache-failures-iq-02',
      difficulty: 'hard',
      question:
        'Five services write to the products table (admin UI, pricing engine, inventory sync, a nightly importer, ad-hoc scripts). Cached product data keeps going stale. How do you design invalidation that’s correct for all writers?',
      whatInterviewerLooksFor: [
        'Recognises app-level invalidation misses writers',
        'Proposes CDC (Debezium) or outbox-based invalidation',
        'Ordering, retries, lag and idempotency',
        'Safety nets: TTL, versioning; race handling',
      ],
      modelAnswer: `### Why it's stale
Each writer must remember to invalidate. The importer and ad-hoc scripts don't, and some invalidations fail silently. App-level invalidation doesn't scale to many writers.

### Design: invalidate from the database's change log
1. **CDC**: Debezium reads the Postgres WAL (logical replication slot) and emits a change event per row to Kafka topic \`shop.public.products\`, keyed by primary key, so it's ordered per product.
2. **Invalidator service** (consumer group): for each event, \`UNLINK\` every derived key for that product (product, product-card, category listings containing it, or bump a category version). Commit the offset only after Redis succeeds, which gives at-least-once delivery. Deletes are idempotent, so duplicates are harmless.
3. **Every writer is covered**, including scripts and migrations, because they all write through the DB.

### Details that matter
- **Lag**: CDC adds ~100 ms–1 s. For read-your-writes in the admin UI, the writer also deletes synchronously after commit (fast path), and CDC is the guarantee.
- **Stale-fill race**: a reader that loaded the old row before the delete can re-cache it. Use version-guarded sets (row \`version\` column) or a delayed second delete from the invalidator (e.g. +1 s).
- **Derived and aggregate caches**: maintain a mapping from entity to dependent keys, or use versioned namespaces for lists (\`category:12:v{n}\`) and bump n.
- **Replication slot health**: monitor slot lag. A stuck consumer makes Postgres retain WAL and fills the disk.
- **TTL safety net** on everything (e.g. 1 h + jitter).

### Alternative
A transactional outbox per writing service has the same guarantees without WAL access, but it requires every writer to adopt the outbox, which reintroduces the "every writer must remember" problem.`,
      followUps: [
        { q: 'What happens if the invalidator is down for 10 minutes?', a: 'Kafka retains events; on recovery it replays in order and deletes. Meanwhile staleness is bounded by TTL; alert on consumer lag.' },
        { q: 'How do you invalidate a “products in category X” list when one product changes?', a: 'Version the list key per category and bump the version on relevant change events, or keep a reverse index product → list keys.' },
      ],
      pitfalls: [
        'Relying on every writer to call invalidate',
        'Ignoring replication-slot lag risk',
        'No handling of the stale-fill race',
      ],
    },
    {
      id: 'cache-failures-iq-03',
      difficulty: 'expert',
      question:
        'Your Redis cluster became unreachable at 8 pm peak for 4 minutes. The database fell over within 30 seconds and the site was down for 25 minutes. Walk me through why, and redesign so a cache outage is a degradation, not an outage.',
      whatInterviewerLooksFor: [
        'Explains cache avalanche and miss-path capacity',
        'Timeouts, circuit breaker, bounded fallback, stale serving, shedding',
        'Recovery dynamics (cold cache after restore, reconnect storms)',
        'HA and testing',
      ],
      modelAnswer: `### Why it cascaded
- Hit ratio was ~97% at 60K RPS, so the DB normally saw ~1.8K QPS against a capacity of maybe 8K.
- With Redis gone, **every** request fell through to the DB: 60K QPS, about 7× capacity. Connection pools maxed out, queries queued, latency went to seconds, and the app's own threads and event loop backed up.
- Redis **timeouts were long** (default connect/command timeouts, offline queue enabled), so each request first waited on Redis and then hit the DB, holding memory the whole time.
- When Redis came back, it was **empty** (no persistence, or a failover to an empty node). The DB was still overloaded refilling the cache, which is why the outage lasted 25 minutes, not 4.

### Redesign
1. **HA**: replicas with automatic failover across AZs, multiple smaller shards, and chaos tests. An outage should affect one shard, not all.
2. **Fail fast**: 50 ms command timeout, \`enableOfflineQueue: false\`, one retry, and a **circuit breaker** that skips Redis for 10 s after repeated failures.
3. **L1 with stale-if-error**: pods keep serving hot keys from memory and extend TTLs while the breaker is open.
4. **Bounded DB fallback**: a per-pod semaphore sized so all pods together stay under ~70% of DB capacity. Excess requests get degraded responses (no recommendations, cached defaults) or a 503 with Retry-After at the edge.
5. **Priority shedding**: checkout and login first, browse next, then everything else. Bots and prefetch get shed first.
6. **Recovery**: half-open the breaker gradually, pre-warm hot keys from a snapshot or hot-key list, and use single-flight on fills. Keep RDB snapshots on replicas for a warm restart.
7. **Game days**: kill Redis in staging and in production canaries on purpose. The success criterion is "p99 up, errors < 1%, no DB saturation".

### Target outcome
A 4-minute Redis outage gives degraded pages for 4 minutes and a warm recovery within about a minute.`,
      followUps: [
        { q: 'How do you size the per-pod DB fallback limit?', a: 'DB safe QPS ÷ pods ÷ (1/avg query time) — e.g. 5.6K QPS safe, 100 pods, 10 ms queries → ~0.56 concurrent per pod; round to a small integer and rely on coalescing for hot keys.' },
        { q: 'Why is a slow Redis worse than a dead one?', a: 'Dead fails fast; slow holds every request for the timeout, consuming concurrency and memory, and often triggers retries that amplify load.' },
      ],
      pitfalls: [
        'Only saying “make Redis highly available”',
        'Unbounded fallback to the DB',
        'Ignoring the cold-cache recovery phase',
      ],
    },
    {
      id: 'cache-failures-iq-04',
      difficulty: 'hard',
      question:
        'Security reports that a bot is requesting /api/users/<random-uuid> at 30K RPS. Cache hit ratio is near zero for those requests and the DB is suffering. How do you defend?',
      whatInterviewerLooksFor: [
        'Names cache penetration',
        'Layered defence: rate limit, validation, negative cache, Bloom filter',
        'Bloom filter sizing and update/deletion handling',
        'Avoiding memory blowup from negative caching random keys',
      ],
      modelAnswer: `### Diagnosis: cache penetration
The keys don't exist, so cache-aside never stores anything and every request reaches the DB. Random UUIDs mean negative caching alone won't help much: each ID is requested once, so a negative entry is never reused. It would also fill Redis with junk.

### Layered defence
1. **Edge**: per-IP/ASN/API-key rate limits, bot detection at the WAF, and a 404-ratio anomaly detector that throttles clients whose 404 rate exceeds e.g. 50%.
2. **Validation**: reject malformed IDs early. If IDs are UUIDv4, check the format. If they are internal, consider signed or opaque IDs so random guessing is detectable.
3. **Bloom filter of existing user IDs** in front of cache and DB:
   - 50M users at 0.1% false positives: m = −n·ln p/(ln 2)² ≈ 50M × 14.4 bits ≈ **90 MB**, k ≈ 10.
   - "Definitely absent" returns 404 immediately (µs, no Redis or DB). Only ~0.1% of random requests (30 RPS) pass through.
   - Keep it current with BF.ADD on user creation (RedisBloom), or rebuild periodically from the DB. Deletions stay as "maybe", which is harmless because they fall through and get negative-cached.
   - Fail open (skip the filter) if it's unavailable, with rate limits still in place.
4. **Negative caching** for the remaining misses (e.g. recently deleted users), with a short TTL (60 s) and a separate, size-capped key space or an L1 LRU so junk can't evict real data.
5. **DB protection**: bounded concurrency on the lookup path, so penetration can't exhaust the pool.

### Monitor
404 rate per client, Bloom "definitely absent" rate, negative-cache size and hit ratio.`,
      followUps: [
        { q: 'What if an attacker enumerates valid IDs instead?', a: 'That’s an authorization/enumeration issue: require auth, rate-limit per identity, use non-guessable IDs, and return identical responses for unauthorized vs missing.' },
        { q: 'Counting Bloom vs Cuckoo filter?', a: 'Both support deletes; Cuckoo filters are more space-efficient at low FP rates and support deletion, at the cost of insertion failures near capacity.' },
      ],
      pitfalls: [
        'Only adding negative caching for random keys',
        'Forgetting Bloom filters have false positives, not negatives',
        'No rate limiting at the edge',
      ],
    },
    {
      id: 'cache-failures-iq-05',
      difficulty: 'hard',
      question:
        'Right after this morning’s deploy, cache hit ratio dropped from 95% to 62% and DB CPU doubled. Nothing is down. How do you debug it?',
      whatInterviewerLooksFor: [
        'Correlates with deploy; checks key format/serializer/TTL changes',
        'Separates evictions vs expirations vs misses vs errors',
        'Uses per-prefix metrics and sampled miss logs',
        'Fast mitigation (rollback/flag) before root cause',
      ],
      modelAnswer: `### 0. Mitigate first
If the drop lines up exactly with the deploy and the DB is at risk, **roll back** (or turn off the flag) and debug from there. Protecting the DB comes before root-causing.

### 1. Localise
- **Per-prefix hit ratio** (\`cache_requests_total\` by prefix and app_version): is it one prefix or all? Old version vs new version pods?
- If only new-version pods miss, it's a code change. If every pod misses, it's infrastructure or traffic.

### 2. Code-change suspects (most common)
- **Key format changed**: a new field in the key (locale, currency, feature flag), different casing, a changed prefix/version, or **query params not normalised** (order-sensitive). Look at sampled missed keys: do they include timestamps, request IDs, user agents? A key with per-request data never gets a hit.
- **Serializer change**: new code can't parse old values (errors counted as misses), or writes a different format so old and new pods thrash each other's entries.
- **TTL change**: \`EX 3600\` became \`PX 3600\`, i.e. 3.6 seconds. \`INFO stats\` expired_keys would spike.
- **Cache bypass**: a new code path skips the cache, or a new endpoint doesn't use it.

### 3. Infra and traffic suspects
- **Evictions**: evicted_keys rising → new, larger values or a key explosion (\`--bigkeys\`, keyspace count growth).
- **Topology**: failover to an empty replica or a reshard during the deploy window.
- **Errors/timeouts** counted as misses: Redis p99, client pool exhaustion.
- **Traffic mix**: a marketing campaign or crawler hitting the long tail.

### 4. Fix and prevent
Normalise keys in one shared helper, add contract tests for key and serialization format, alert on per-prefix hit-ratio drops by version, and canary deploys with hit-ratio comparison as a rollback signal.`,
      followUps: [
        { q: 'Old and new pods run side by side during a rolling deploy with different serializers. What happens?', a: 'Each overwrites the other’s format; each fails to parse the other’s values → thrash. Version the key namespace when changing formats so they don’t collide.' },
        { q: 'How can a TTL change cause an avalanche later rather than immediately?', a: 'If the deploy re-sets many keys with the same new TTL, they all expire together later — add jitter.' },
      ],
      pitfalls: [
        'Assuming Redis is at fault without checking the deploy diff',
        'Not separating errors from genuine misses',
        'Debugging for an hour instead of rolling back first',
      ],
    },
    {
      id: 'cache-failures-iq-06',
      difficulty: 'medium',
      question:
        'After a merchant changes a price, some customers see the new price and others see the old one for up to a minute, depending on which pod they hit. Why, and how do you fix it without killing performance?',
      whatInterviewerLooksFor: [
        'Identifies per-pod L1 caches not invalidated',
        'Pub/sub broadcast + TTL safety net + clear on reconnect',
        'Alternatives: client-side caching, version checks',
        'Keeps critical flows authoritative',
      ],
      modelAnswer: `### Why
The service has an **in-process L1** (e.g. 60 s TTL) in front of Redis. The write path deletes the Redis key, but each pod's L1 still holds the old price until its own TTL expires. Pods that loaded the value at different times expire at different times, so the price appears to flip between refreshes.

### Fix options
1. **Broadcast invalidation**: after commit, delete in Redis and \`PUBLISH cache:invalidate price:sku123\`. Every pod subscribes and drops the key from L1. Latency is about 1–10 ms.
   - Redis pub/sub is **at-most-once**, so a pod that's reconnecting misses messages. **Clear L1 on reconnect** and keep a TTL safety net (drop from 60 s to 10–15 s).
2. **Redis client-side caching** (CLIENT TRACKING): Redis pushes invalidations for keys each client has read, which is less custom code.
3. **Version check**: keep \`price:sku123:ver\` in Redis. L1 entries remember the version, and a pod validates with a cheap MGET of versions (batched per request, or refreshed every second).
4. **Shorter L1 TTL only**: simplest, but the bound is still the TTL.

### Correctness boundary
The display price can be eventually consistent within seconds. The **checkout price** must come from the pricing service or DB (or be validated by version), and the order should record the price and version the customer agreed to.

### Performance
Pub/sub costs one message per write, and price updates are rare compared with reads. The L1 hit ratio barely changes.`,
      followUps: [
        { q: 'What if there are 2,000 pods — is pub/sub fan-out a problem?', a: 'Each message goes to 2,000 subscribers; fine for low write rates. For high rates, batch invalidations or use Kafka with per-pod consumption, or shard channels by key prefix.' },
        { q: 'Could you just disable L1?', a: 'Yes if Redis latency is acceptable; L1 exists to cut ~1 ms and protect hot keys — keep it only where brief inconsistency is acceptable.' },
      ],
      pitfalls: [
        'Believing a Redis delete clears every pod’s memory',
        'Relying on pub/sub without a TTL or reconnect handling',
        'Using cached prices to charge customers',
      ],
    },
    {
      id: 'cache-failures-iq-07',
      difficulty: 'expert',
      question:
        'Users are being randomly logged out, distributed locks occasionally don’t hold, and Redis INFO shows evicted_keys climbing. The instance is shared by cache, sessions and a lock manager. Explain and fix.',
      whatInterviewerLooksFor: [
        'Eviction policy semantics across mixed workloads',
        'Memory accounting (fragmentation, buffers, big keys)',
        'Separation of instances by durability needs',
        'Lock correctness implications (fencing tokens)',
      ],
      modelAnswer: `### Why
The instance runs \`allkeys-lru\` (or \`volatile-lru\` where sessions and locks carry TTLs). When the cache working set grows, Redis evicts by sampled LRU **regardless of workload**. Sessions and lock keys that haven't been touched recently look "cold" and get evicted. The result is random logouts, and locks that vanish before their TTL, letting two workers enter the critical section.

### Confirm
- \`INFO memory\`: used_memory near maxmemory, fragmentation ratio, and \`mem_clients_normal\` (output buffers).
- \`INFO stats\`: evicted_keys rate lines up with the logout reports.
- \`--bigkeys\`/\`--memkeys\`: did a new cache prefix with large values or a key explosion appear?

### Fix
1. **Separate instances by semantics**:
   - Cache: \`allkeys-lfu\`, sized for hit ratio, eviction expected.
   - Sessions: \`noeviction\`, replicas, AOF everysec, alerts at 75–80% memory. Scale before it fills.
   - Locks: a separate small instance with \`noeviction\`. Better still, rethink it: Redis locks are best-effort, so for correctness use **fencing tokens** (a monotonically increasing token checked by the resource) or a consensus-backed store (etcd/ZooKeeper) for critical sections.
2. **Reduce cache memory**: TTLs on all cache keys, bounded key cardinality, compressed or split large values.
3. **Memory hygiene**: \`activedefrag yes\` for fragmentation, \`client-output-buffer-limit pubsub\` for slow subscribers, and \`lazyfree-lazy-eviction yes\` to avoid latency spikes.
4. **Migration**: dual-write sessions to the new instance, read new-then-old until the session TTL passes, then remove the old path.

### Lesson
Eviction policy is an **instance-wide contract**. Never mix evictable and non-evictable data in the same instance.`,
      followUps: [
        { q: 'Why aren’t Redis locks enough even without eviction?', a: 'Failover with async replication can lose the lock key, and GC pauses can outlive the TTL; only fencing tokens make the protected resource reject stale holders.' },
        { q: 'What if the session instance hits maxmemory with noeviction?', a: 'Writes fail (new logins fail) but existing sessions survive — alert early, scale out, and shorten idle session TTLs.' },
      ],
      pitfalls: [
        'Raising maxmemory without separating workloads',
        'Assuming volatile-lru protects keys with TTLs',
        'Treating Redis locks as strongly consistent',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'cache-failures-boe-1',
      question: 'Estimate the DB load from a stampede on one hot key, with no protection, with single-flight per pod, and with a distributed lock.',
      assumptions: [
        'Hot key receives 20K RPS spread over 50 pods (400 RPS per pod)',
        'Recompute (DB query) takes 250 ms; DB can run ~200 of these concurrently before degrading',
        'Key expires once per minute',
      ],
      steps: [
        { label: 'Requests arriving during one recompute', calc: '20,000 RPS × 0.25 s = 5,000 requests' },
        { label: 'No protection', calc: 'all 5,000 miss → 5,000 concurrent heavy queries = 25× DB safe concurrency → recompute slows further (feedback loop)' },
        { label: 'Single-flight per pod', calc: '1 query per pod = 50 concurrent queries → within capacity, but 50× duplicate work every minute' },
        { label: 'Distributed lock + stale-while-revalidate', calc: '1 query per expiry; 4,999 requests served stale instantly; 1 query/min total' },
        { label: 'XFetch (β=1)', calc: 'refresh starts probabilistically in the last ~Δ-scale window; expected ~1–few refreshes, no lock needed' },
      ],
      answer: '5,000 concurrent queries unprotected, 50 with per-pod single-flight, 1 with a lock and stale-while-revalidate.',
      insight:
        'Stampede size is RPS × recompute time, so the hottest and most expensive keys need cluster-level coordination (lock or early probabilistic refresh) and a soft/hard TTL so no user ever waits on the recompute.',
      followUps: [
        {
          "q": "The recompute time grows from 250 ms to 2 s because the DB is already loaded. Redo the unprotected number and explain the feedback loop.",
          "a": "20,000 RPS × 2 s = 40,000 requests arrive during one recompute, all missing, so 40,000 concurrent heavy queries against a DB comfortable with 200. Every additional query slows the others, increasing recompute time, which lets even more requests pile up, so the system never recovers on its own until load drops. This is why the unprotected case is not just '25× worse' but unstable. With lock plus stale-while-revalidate the number stays at 1 query regardless of recompute time; only staleness grows, to about 2 s."
        }
      ],
    },
    {
      id: 'cache-failures-boe-2',
      question: 'Size a Bloom filter to block penetration for 200M valid order IDs, and estimate how much DB traffic it saves under a 50K RPS random-ID attack.',
      assumptions: [
        'Target false-positive rate p = 0.1%',
        'm = −n·ln(p)/(ln 2)², k = (m/n)·ln 2',
        'Attack requests are for non-existent IDs',
      ],
      steps: [
        { label: 'Bits per element', calc: '−ln(0.001)/(ln 2)² = 6.908 / 0.4805 ≈ 14.4 bits' },
        { label: 'Total bits', calc: '200M × 14.4 ≈ 2.88 × 10^9 bits' },
        { label: 'Memory', calc: '2.88e9 ÷ 8 ≈ 360 MB' },
        { label: 'Hash functions', calc: 'k = 14.4 × 0.693 ≈ 10' },
        { label: 'Attack traffic reaching DB', calc: '50,000 × 0.001 = 50 RPS (vs 50,000 without the filter)' },
        { label: 'At p = 1% instead', calc: '9.6 bits/elem → 240 MB, k ≈ 7, 500 RPS leak' },
      ],
      answer: '~360 MB with ~10 hash functions; the attack’s DB load drops from 50K RPS to ~50 RPS.',
      insight:
        'Bloom filters trade a few hundred MB for a 1000× reduction in penetration load. Choose p from how much leak the DB can absorb; host it in RedisBloom (shared) or in-process (µs, but N copies to update).',
      followUps: [
        {
          "q": "The ID set grows from 200M to 1B over two years. What happens to the false-positive rate if you keep the same 360 MB filter?",
          "a": "With m fixed at about 2.88e9 bits and n growing to 1e9, bits per element falls from 14.4 to 2.9. With k = 10 still, FP ≈ (1 − e^(−10/2.9))^10 ≈ (1 − 0.032)^10 ≈ 0.72, so roughly 70% of attack requests leak through, which is almost useless (and k is now far from optimal). You need to rebuild at the new size: 1B × 14.4 bits = 1.8 GB for 0.1%. Plan for it with scalable Bloom filters (RedisBloom adds sub-filters as capacity is reached) or capacity-based rebuild alerts."
        }
      ],
    },
    {
      id: 'cache-failures-boe-3',
      question: 'One product key receives 350K reads/s during a flash sale. How many Redis copies or what L1 TTL do you need to keep each shard under 50K ops/s?',
      assumptions: [
        'Single Redis shard comfortable limit: 50K ops/s for this value size (5 KB)',
        '250 app pods share the traffic evenly',
        'Option A: key replication with random suffix; Option B: in-process L1 with TTL T',
      ],
      steps: [
        { label: 'Without mitigation', calc: '350K ops/s on one shard = 7× its budget; NIC: 350K × 5 KB = 1.75 GB/s (> 10 Gbps)' },
        { label: 'Option A: copies needed', calc: '350K ÷ 50K = 7 → use 8 copies on 8 different shards (~44K ops/s each)' },
        { label: 'Option B: L1 fetch rate', calc: 'each pod fetches once per T; with T = 2 s → 250 ÷ 2 = 125 Redis reads/s' },
        { label: 'Option B staleness', calc: '≤ 2 s (+ Redis staleness)' },
        { label: 'Write cost Option A', calc: 'each update → 8 SETs/DELs; fine for rare product updates' },
      ],
      answer: 'Either 8 key copies across shards (~44K ops/s each) or a 2 s L1 TTL that cuts Redis load to ~125 ops/s; L1 is far cheaper.',
      insight:
        'For read-hot keys, an in-process cache with a seconds-level TTL reduces load by orders of magnitude at negligible staleness cost; key replication is the fallback when L1 isn’t possible (e.g. many different hot keys or strict memory limits).',
      followUps: [
        {
          "q": "Peak becomes 3.5M reads/s, 10× more. Which option breaks first, and does the L1 answer change?",
          "a": "Option A needs 3.5M / 50K = 70 copies; you probably don't have 70 shards, and every update becomes 70 writes, so it stops being practical. Bandwidth is also 3.5M × 5 KB = 17.5 GB/s spread across shards. Option B is unaffected on the Redis side: 250 pods with a 2 s TTL still fetch about 125 times per second. The limit moves to the pods themselves (14K RPS per pod, serving 5 KB from memory is fine) and to the CDN or load balancer in front. L1 scales with pod count, not with traffic."
        }
      ],
    },
  ],
  test: [
    {
      id: 'cache-failures-mcq-01',
      difficulty: 'hard',
      question: 'With this write path, what can a concurrent reader do?',
      code: {
        language: 'typescript',
        code: `await db.query('BEGIN');
await db.query('UPDATE users SET name=$2 WHERE id=$1', [id, name]);
await redis.del('user:' + id);
await db.query('COMMIT');`,
      },
      options: [
        'Nothing harmful; deleting inside the transaction is the safest ordering',
        'Miss after the DEL, read the old row (not yet committed), and re-cache the old name until TTL',
        'Deadlock with the writer because Redis participates in the transaction',
        'Read a partially committed row because DEL releases the row lock',
      ],
      correct: [1],
      explanation:
        'Before COMMIT, other transactions still see the old row. A reader that misses after the DEL loads the old value and caches it, so the invalidation is wasted. Delete after commit, or use version guards. Redis is not part of the DB transaction, so it can’t deadlock with it, and DEL has no effect on row locks.',
      followUps: [
        {
          "q": "You move the DEL after COMMIT. The process crashes between COMMIT and DEL. What does the user see, and how do you close that gap?",
          "a": "The row is committed but the old value stays cached until its TTL expires, which could be an hour. Moving the DEL later only shrinks the race; it doesn't make invalidation durable. Close it by writing an outbox row in the same transaction (or tailing the WAL with Debezium) and having a relay perform the DEL with retries until it succeeds. Keep a modest TTL as the last safety net, and alert on outbox lag so a stuck relay is noticed in minutes, not when customers complain."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-02',
      difficulty: 'expert',
      question:
        'Reads fill the cache from a replica with ~500 ms lag. Writers delete the key right after commit. Which mitigations actually reduce stale-fill incidents? Select ALL that apply.',
      options: [
        'Fill the cache from the primary (or only after checking the row version)',
        'Delayed second delete ~1 s after the write',
        'Version-guarded set in Lua using a monotonically increasing row version plus a tombstone',
        'Increase the TTL so stale values are replaced less often',
        'Delete the key before starting the DB transaction instead of after',
      ],
      correct: [0, 1, 2],
      explanation:
        'Filling from the primary, a delayed double delete and a version-guarded set each close or shrink the window in which a lagging read re-caches old data. A longer TTL makes a stale entry live longer. Deleting before the transaction lets readers re-cache the old row before the commit, which makes the problem worse.',
      followUps: [
        {
          "q": "Replica lag spikes from 500 ms to 30 s during a vacuum storm. Which of the three mitigations still holds, and which quietly stops working?",
          "a": "The delayed double delete fires at about 1 s, so a reader that hits the replica 20 s behind re-caches the old row after the second delete and it survives until TTL. Filling from the primary is unaffected by lag. The version-guarded set also still holds: the writer's tombstone carries version N, so a fill with version N-1 from the lagging replica is rejected regardless of how late it arrives. That is why version guards are preferred over timing-based fixes; any fixed delay is a guess about lag."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-03',
      difficulty: 'hard',
      question:
        'A hot key expires every 60 s and causes a DB spike. You already have per-pod single-flight across 80 pods. What additional change gives the biggest reduction in DB load and user latency at expiry?',
      options: [
        'Reduce the TTL to 10 s so each recompute is smaller',
        'Increase the DB connection pool so recomputes finish in parallel',
        'Soft TTL with stale-while-revalidate and a cluster-wide refresh lock',
        'Switch the eviction policy from LRU to LFU',
      ],
      correct: [2],
      explanation:
        'Single-flight still leaves up to 80 recomputes per expiry, one per pod. A cluster-wide lock cuts that to one, and serving the stale value during the refresh means no user waits. A shorter TTL produces more spikes. A bigger pool increases DB concurrency, which is the opposite of what you want, and the eviction policy has nothing to do with expiry.',
      followUps: [
        {
          "q": "The Redis node holding the refresh lock fails over mid-refresh and the replica didn't get the lock key. What happens, and is it a problem here?",
          "a": "A second worker can acquire the lock on the new primary, so two refreshes run at once. For stampede protection that is acceptable: the lock is an efficiency optimisation, not a correctness guarantee, and two recomputes instead of one is harmless as long as both write the same value (or use a version-guarded set). Don't reach for Redlock here. Only if the recompute had side effects (charging, emailing) would you need a real fencing token or a consensus-backed lock."
        },
        {
          "q": "How would you verify in production that the cluster-wide lock actually reduced recomputes to one per expiry?",
          "a": "Emit a counter on every recompute tagged by key prefix, plus a counter for lock-acquire failures and for stale-served responses. After rollout, recomputes per minute for the hot key should drop from about 80 (one per pod) to about 1, and stale-served should spike briefly at each soft expiry. Also watch DB query rate for that statement in pg_stat_statements and the p99 at expiry boundaries; the 60-second sawtooth in both should flatten."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-04',
      difficulty: 'expert',
      question: 'What does this XFetch check do as the entry approaches expiry (delta = recompute time, beta = 1)?',
      code: {
        language: 'typescript',
        code: `const early = Date.now() - e.deltaMs * beta * Math.log(Math.random()) >= e.expiresAt;
if (early) refreshInBackground();`,
      },
      options: [
        'Always refreshes exactly delta ms before expiry on every request',
        'Never refreshes early, because Math.log(Math.random()) is always positive',
        'Refreshes only after expiry, but with random jitter up to delta',
        'Adds a random positive head start, so the refresh probability rises sharply near expiry',
      ],
      correct: [3],
      explanation:
        'Math.log of a value in (0,1) is negative, so subtracting delta × beta × log(U) adds a random positive amount, usually around delta and occasionally more. Early refresh is rare far from expiry and increasingly likely close to it, so typically one request refreshes ahead of time with no locks. It is probabilistic rather than a fixed offset, and it acts before expiry, not after.',
      followUps: [
        {
          "q": "Your recompute time (delta) varies from 50 ms normally to 2 s under DB load. How should you measure delta, and what happens if you hard-code 50 ms?",
          "a": "Store the measured recompute duration alongside the value each time it is refreshed, so delta adapts automatically. If you hard-code 50 ms while real recomputes take 2 s, the early-refresh window is 40 times too narrow: refresh starts only a few tens of ms before expiry, the value expires while the refresh is still running, and you are back to a stampede exactly when the DB is already slow. Raising beta above 1 widens the window further for keys where a miss is very expensive."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-05',
      difficulty: 'medium',
      question:
        'An attacker requests random non-existent product IDs at high rate. Which defence stops them before they touch cache or DB, with no false negatives for real products?',
      options: [
        'A Bloom filter of existing product IDs checked first',
        'Negative caching of "not found" results with a 10-minute TTL',
        'An LFU eviction policy so random keys are evicted first',
        'Longer TTLs on valid products',
      ],
      correct: [0],
      explanation:
        'A Bloom filter answers "definitely not present" without false negatives, so real products are never blocked and most fake IDs are rejected immediately. Negative caching doesn’t help when every ID is new, and it fills memory with junk. Eviction policy and TTL length don’t affect lookups for keys that were never cached.',
      followUps: [
        {
          "q": "New products are created 500 times a minute and some are deleted. How do you keep the Bloom filter correct?",
          "a": "Add every new ID to the filter in the same flow that creates the product, ideally before the create response returns (or via CDC with the read path tolerating a few seconds of lag by falling back to the DB on 'not present' for very recent IDs). A standard Bloom filter cannot remove items, so deletions just leave harmless false positives, which a negative cache absorbs. Rebuild the filter periodically from the DB (for example nightly) to shed deleted IDs and keep the false-positive rate near target, swapping atomically to the new filter."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-06',
      difficulty: 'medium',
      question:
        'At 09:00 a warm-up job SETs 3M keys, all with EX 3600. What should you expect, and what is the fix? Select ALL that apply.',
      options: [
        'A synchronized miss storm near 10:00 as keys expire together (cache avalanche)',
        'Add ±10–20% random jitter to TTLs when bulk-loading',
        'Redis will automatically spread expirations, so no action is needed',
        'Throttle the warm-up job (pipelined batches with pauses) to avoid saturating Redis now',
      ],
      correct: [0, 1, 3],
      explanation:
        'Keys written together with the same TTL all expire together an hour later, so jitter spreads the misses out, and throttling protects Redis during the load itself. Redis expires keys lazily and in sampled cycles, but a key past its TTL still counts as expired, so the misses stay synchronized.',
      followUps: [
        {
          "q": "You add ±15% jitter, but the warm-up job also runs every hour, rewriting all 3M keys. Does jitter still help?",
          "a": "Not much. Each hourly run resets every key's TTL at the same moment, so the expiry spread is only ±9 minutes around the next run, and the job's own write burst becomes the spike. Better: run warm-up only on cold start, let normal traffic refresh keys individually, and for keys that must stay warm use soft TTLs with background refresh. If an hourly job is unavoidable, make TTLs longer than the job interval so keys are refreshed before they ever expire, and rate-limit the job's writes."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-07',
      difficulty: 'expert',
      question:
        'A viral post’s like counter (a single Redis key) receives 250K INCR/s and its shard is saturated. Best approach?',
      options: [
        'Move the key to its own Redis Cluster slot with CLUSTER SETSLOT',
        'Add read replicas to the shard and point INCR at them',
        'Use a hash tag so the counter spreads across shards',
        'Split it into N sub-counters (likes:{p}:0..N-1), INCR a random one, sum on read (cached briefly)',
      ],
      correct: [3],
      explanation:
        'A write-hot key has to be split, because one key maps to one shard. Sub-counters spread the writes, and a briefly cached sum keeps reads cheap. Giving the key its own slot still leaves it on a single node, replicas are read-only and can’t take INCR, and hash tags put keys together rather than spreading them.',
      followUps: [
        {
          "q": "Product now wants the like count shown exactly, and the post owner sees 'you just got liked' instantly. How does that change your choice of N and the read cache?",
          "a": "The sub-counter design is still right for writes; exactness on read just means summing all N keys without a cached total. With N = 8, an MGET of 8 keys on the read path costs a few hundred microseconds, fine unless reads are also extreme. The usual compromise is: display counts from a 1-2 s cached sum (no one can tell 1,204,551 from 1,204,560), and give the owner's own view a direct MGET. Pick N from write rate divided by the per-shard budget, for example 250K / 50K means at least 5, round to 8 for headroom."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-08',
      difficulty: 'hard',
      question: 'Redis becomes slow (p99 800 ms) rather than down. With this client config, what happens to your NestJS API?',
      code: {
        language: 'typescript',
        code: `const redis = new Redis({
  // defaults: no commandTimeout, maxRetriesPerRequest: 20, enableOfflineQueue: true
});
const v = await redis.get(key);    // on every request`,
      },
      options: [
        'Requests fail fast and fall back to the DB, so users barely notice',
        'Every request waits for slow Redis; in-flight requests pile up, memory grows, p99 explodes',
        'ioredis automatically switches to a replica after 100 ms',
        'Node’s event loop blocks on redis.get, freezing the process until Redis answers',
      ],
      correct: [1],
      explanation:
        'Without a command timeout, requests wait as long as Redis takes. Under constant load, concurrency grows with latency (Little’s law), so memory and tail latency blow up, and the offline queue with many retries adds more waiting. Nothing fails fast, and ioredis has no automatic replica switch on latency. The event loop is not blocked because the call is async, but the requests still pile up.',
      followUps: [
        {
          "q": "You set commandTimeout to 50 ms. Redis stays slow at 800 ms for 10 minutes. Now what happens to the DB, and what else do you need?",
          "a": "Every Redis call times out at 50 ms and falls through to the DB, so the full read traffic hits Postgres, turning a slow cache into a DB overload. Add a circuit breaker: after, say, 50% of calls time out in a 10 s window, stop calling Redis entirely for a cool-down period and serve from an in-process L1 plus a bounded DB fallback (a semaphore sized under DB capacity, shedding the rest). The timeout makes failure fast; the breaker and bulkhead make it safe."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-09',
      difficulty: 'expert',
      question:
        'A Redis instance with maxmemory-policy volatile-lru starts rejecting writes with OOM errors even though evictions are enabled. Most likely cause?',
      options: [
        'Most keys have no TTL, so volatile-lru has few or no eviction candidates',
        'volatile-lru only evicts keys that have already expired',
        'LRU sampling (maxmemory-samples) is set too high',
        'AOF rewrite is holding a lock on the keyspace',
      ],
      correct: [0],
      explanation:
        'The volatile-* policies only evict keys that have a TTL. If most memory is taken by keys without TTLs, Redis cannot free enough and rejects writes as if it were set to noeviction. volatile-lru evicts least recently used keys among those with a TTL, not only expired ones. A higher sample count only improves accuracy, and AOF rewrites don’t lock the keyspace.',
      followUps: [
        {
          "q": "You can't add TTLs to the existing keys quickly because a legacy service writes them. What do you do in the next hour, and what's the real fix?",
          "a": "Short term: raise maxmemory if the host has headroom, or switch the policy to allkeys-lru if every key on the instance is truly cache data (confirm with a key-pattern scan via SCAN plus MEMORY USAGE sampling). If some TTL-less keys are not reconstructible, don't switch; instead scale up memory. The real fix is to separate data classes: cache keys always written with a TTL (enforce it in a shared client wrapper), and anything that must not be evicted moved to its own noeviction instance with memory alerts at 70-80%."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-10',
      difficulty: 'hard',
      question:
        'Pods keep an L1 cache invalidated via Redis pub/sub. After a brief network blip, some pods serve stale data for their full L1 TTL. Why, and what fixes it? Select ALL that apply.',
      options: [
        'Redis pub/sub is at-most-once; messages sent while a subscriber was disconnected are lost',
        'Clear L1 (or bump a local generation) on every subscriber reconnect',
        'Keep a short L1 TTL as a safety net',
        'Use PUBLISH with the persistence flag so Redis stores messages for offline subscribers',
      ],
      correct: [0, 1, 2],
      explanation:
        'Redis pub/sub does not buffer messages for disconnected subscribers, so invalidations published during the blip are lost. Clearing L1 on reconnect and keeping a TTL as the safety net bound the staleness. PUBLISH has no persistence flag. For durable fan-out, use Streams or Kafka.',
      followUps: [
        {
          "q": "You replace pub/sub with Redis Streams for invalidation. A pod restarts after 5 minutes down. How does it catch up, and what do you do if the stream was trimmed?",
          "a": "A restarted pod has an empty L1, so there is nothing stale to invalidate; it simply starts reading from the stream's current tail ($). The catch-up problem is for a pod that stayed up but lost its connection: it resumes from its last-seen stream ID with XREAD. If that ID is older than the trimmed tail (MAXLEN cut it off), it cannot know what it missed, so it must clear its whole L1. Size MAXLEN to cover a realistic disconnect (rate × max outage) and treat 'ID older than first entry' as a full flush."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-11',
      difficulty: 'medium',
      question:
        'Live match scores update every second and the /live-scores endpoint gets 40K RPS. What is the most effective caching approach?',
      options: [
        'Cache each score in Redis with a 1 h TTL and delete-on-write',
        'Micro-cache the response for ~1 s at the edge/proxy with request collapsing',
        'Don’t cache; scale the database horizontally to absorb 40K RPS',
        'Write-back the scores to Redis and flush them to the DB every minute',
      ],
      correct: [1],
      explanation:
        'Micro-caching with request collapsing turns 40K RPS into roughly one origin request per second per proxy, while the data stays at most about a second old. A 1 h TTL with invalidations on every write churns constantly for little benefit. Scaling the DB to 40K reads is wasteful, and write-back is a write-side pattern that doesn’t address this read load.',
      followUps: [
        {
          "q": "You have 300 edge POPs, each micro-caching for 1 s. What origin load do you actually see, and how do you reduce it further?",
          "a": "Each POP independently fetches about once per second, so origin sees around 300 RPS, not 1, plus extra when a POP has multiple cache servers without request collapsing between them. To cut it, enable a tiered or shield cache: POPs fetch from a few regional shield nodes, which fetch from origin, so origin sees a handful of requests per second. Alternatively publish the scores to a pub/sub or SSE fan-out layer so clients get pushes instead of polling."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-12',
      difficulty: 'expert',
      question: 'This lock release is used for the stampede-protection lock. What is the risk?',
      code: {
        language: 'typescript',
        code: `const ok = await redis.set('lock:' + key, '1', 'PX', 2000, 'NX');
if (ok) {
  try { await recompute(); }          // sometimes takes 3s under load
  finally { await redis.del('lock:' + key); }
}`,
      },
      options: [
        'SET with NX and PX is not atomic, so two workers can both get the lock',
        'PX 2000 is too short to be valid; Redis requires at least 5 s',
        'If recompute exceeds 2 s, another worker takes the lock and this DEL deletes their lock',
        'redis.del inside finally runs before the recompute promise settles',
      ],
      correct: [2],
      explanation:
        'Once the TTL expires, a second worker can acquire the lock, and the first worker’s unconditional DEL then removes the second worker’s lock, letting a third one in. Store a unique token and release with a compare-and-delete Lua script, and size the TTL above the worst-case recompute time or extend it. SET with NX and PX is atomic, Redis has no minimum PX, and finally runs only after the awaited recompute settles.',
      followUps: [
        {
          "q": "You switch to a token with compare-and-delete. Recompute still sometimes takes longer than the TTL. Two workers write the cache. When is that actually harmful?",
          "a": "For a pure cache fill it's mostly harmless, just wasted work, unless the slower worker read older data and overwrites a newer value written by the faster one. That's the real risk: a late write of stale data. Guard the SET with a version or a fencing token (the lock's monotonic counter), so Redis rejects writes older than what it holds. Also extend the lock with a watchdog (renew at TTL/3 while the recompute is running), and alert when recompute time exceeds the lock TTL."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-13',
      difficulty: 'hard',
      question:
        'After a deploy, the hit ratio for prefix "search:" fell from 90% to 3%, while other prefixes are unchanged. Which causes are most plausible? Select ALL that apply.',
      options: [
        'The search key now includes unsorted query params or a request timestamp',
        'The serializer changed, so new pods fail to parse old values and count them as misses',
        'The Redis cluster lost a shard (other prefixes would drop too)',
        'The TTL for search keys was accidentally set in ms instead of seconds',
      ],
      correct: [0, 1, 3],
      explanation:
        'A drop limited to one prefix that starts with a deploy points to that prefix’s code: key construction, serialization or TTL units. Losing a shard would lower hit ratios across all prefixes on that shard, not just search.',
      followUps: [
        {
          "q": "Which three metrics or checks would you look at first to distinguish the key-format cause from the serializer cause within five minutes?",
          "a": "First, sample live keys with SCAN MATCH 'search:*' and compare them with keys generated before the deploy: different parameter order, a timestamp or a new field in the key points to key construction. Second, check the deserialisation error counter or logs: a serializer change shows parse failures on GETs that returned data. Third, look at Redis key count and memory for the prefix: a key-format bug makes the keyspace grow fast with new unique keys, while a serializer bug keeps the count flat but the hits fail."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-14',
      difficulty: 'expert',
      question:
        'Redis is down. Your fallback is try { cache } catch { return db.query() }. DB capacity is 6K QPS; normal miss traffic is 1.5K QPS; total traffic is 45K QPS. What is the best fallback design?',
      options: [
        'Keep the fallback; DB connection pools will naturally limit the load',
        'Fail every request with 503 until Redis recovers',
        'Bounded concurrency to the DB (bulkhead) sized under capacity, serve stale L1, shed the rest by priority',
        'Retry Redis up to 20 times per request before falling back',
      ],
      correct: [2],
      explanation:
        'An unbounded fallback sends 45K QPS to a DB that handles 6K, so pools saturate, requests queue and the DB collapses. A bulkhead keeps the DB within capacity, stale L1 data covers hot keys, and priority shedding protects critical flows. Failing everything throws away the capacity you do have, and retrying Redis 20 times multiplies latency and load.',
      followUps: [
        {
          "q": "Size the bulkhead. You have 60 pods and the DB handles 6K QPS with an average query time of 10 ms. How many concurrent DB slots per pod?",
          "a": "6K QPS at 10 ms each means about 60 concurrent queries keep the DB at capacity (Little's law: 6,000 × 0.01). Leave headroom for normal miss traffic and writes, say target 40 concurrent fallback queries cluster-wide, so 40 / 60 pods is under 1 per pod. Round to 1 slot per pod, which yields at most 60 concurrent, too close to the limit, so either use a cluster-wide token bucket (via a separate small Redis or the DB itself) or accept 1 per pod only on a subset of pods. Shed the rest fast with 503 or stale L1."
        }
      ],
    },
    {
      id: 'cache-failures-mcq-15',
      difficulty: 'expert',
      question:
        'Sessions, a distributed-lock manager and a product cache share one Redis instance with allkeys-lru. Traffic grows and users are randomly logged out. What is the correct long-term fix?',
      options: [
        'Switch the policy to allkeys-lfu so sessions are evicted less often',
        'Separate instances: the cache on allkeys-lfu; sessions and locks on noeviction with alerts and headroom',
        'Give session keys longer TTLs so LRU considers them newer',
        'Enable AOF so evicted sessions can be recovered from disk',
      ],
      correct: [1],
      explanation:
        'Eviction policy applies to the whole instance, so data that must not be evicted cannot share it with an evicting cache. Separating the instances is the only reliable fix. LFU still evicts sessions, just in a different order. LRU looks at access time, not TTL, and AOF does not bring evicted keys back.',
      followUps: [
        {
          "q": "Splitting instances takes two sprints. What can you change today to stop the logouts without touching application code?",
          "a": "Switch the shared instance to volatile-lru (or volatile-lfu) and make sure every cache key has a TTL while session and lock keys don't. Then Redis only evicts TTL-bearing cache keys. Check first with sampling that sessions really lack TTLs; if they have TTLs, that won't work and you need more memory instead. Also raise maxmemory if the host allows, and alert on evicted_keys and used_memory at 80%. This is a stopgap: if cache keys alone can't free enough, writes start failing with OOM."
        }
      ],
    },
  ],
};

export default topic;
