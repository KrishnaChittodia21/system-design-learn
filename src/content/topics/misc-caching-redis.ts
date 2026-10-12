import type { Topic } from '../../types';

const topic: Topic = {
  id: 'misc-caching-redis',
  phase: 'miscellaneous',
  order: 3,
  title: 'Caching, Redis & Cache Failure Modes',
  subtitle:
    'Question bank: caching trade-offs, Redis internals, Redis Cluster vs Sentinel failover mechanics, stampede, penetration, avalanche, hot keys, warming and stale-while-revalidate — fresh angles for 2026 loops.',
  estimatedMinutes: 120,
  sources: [
    'Redis docs — Cluster specification (hash slots, MOVED/ASK, failover, replica election)',
    'Redis docs — High availability with Redis Sentinel (SDOWN/ODOWN, quorum, min-replicas-to-write)',
    'ioredis README — Cluster and Sentinel options (scaleReads, retryDelayOnTryAgain, reconnectOnError)',
    'Valkey blog / Linux Foundation — Valkey 8.0 (I/O threads, CLUSTER SLOT-STATS) and 9.0 (atomic slot migration, multi-DB cluster mode, Oct 2025)',
    'Uber Engineering — How Uber serves over 40 million reads per second using an integrated cache (CacheFront, 2024)',
    'Nishtala et al. — Scaling Memcache at Facebook (NSDI 2013): leases',
    'RFC 5861 — HTTP Cache-Control extensions for stale content (stale-while-revalidate, stale-if-error)',
    'Hello Interview — Redis deep dive (hot keys, replicas, async replication)',
    'Interview write-ups on DEV Community ("Redis for SDE interviews", "Redis & Kafka questions I got asked 23 times"), usegreenroom.app caching question list, LeetCode Discuss cache-concurrency threads',
  ],
  tags: ['redis', 'redis-cluster', 'redis-sentinel', 'valkey', 'stampede', 'penetration', 'avalanche', 'hot-keys', 'cache-warming', 'stale-while-revalidate'],
  cheatSheet: [
    'Cache only when reuse is high and staleness is tolerable; the miss path still sets p99 — a 95% hit ratio does not move p99 if more than 1% of requests miss.',
    'Redis executes commands on one thread; Redis 6+ and Valkey 8 thread only socket I/O. One O(N) command (KEYS, HGETALL on a 1M-field hash, a long Lua loop) stalls every client.',
    'Plain SET wipes an existing TTL (use KEEPTTL or SET … EX); INCR/HSET keep it. "Keys that never expire" is often this bug.',
    'Redis Cluster: 16,384 slots, slot = CRC16(key) mod 16384; hash tag = text between the first { and the next } (must be non-empty). Multi-key ops, MULTI and Lua need one slot.',
    'MOVED = permanent, refresh the slot map; ASK = one-shot during migration, send ASKING then the command, do not update the map. TRYAGAIN = multi-key op on a slot mid-migration.',
    'Cluster failover ≈ cluster-node-timeout (15 s default) + election delay (500 ms + 0–500 ms random + rank × 1 s). Minority-side primary stops taking writes after node-timeout, which bounds the loss window.',
    'cluster-require-full-coverage yes (default) makes the WHOLE cluster return CLUSTERDOWN if any slot loses all its nodes; set it to no for caches.',
    'Sentinel: SDOWN (one sentinel) → ODOWN (quorum agree) → leader elected by a MAJORITY of all sentinels → promote the replica with best priority/offset. Use at least 3 sentinels on independent failure domains.',
    'Async replication means both Sentinel and Cluster can lose acknowledged writes; min-replicas-to-write N + min-replicas-max-lag S only bounds the window. WAIT does not make Redis CP.',
    'Stampede = one hot key recomputed N times; penetration = keys that do not exist anywhere; avalanche = many keys or a whole tier missing at once. Fixes differ: single-flight / negative cache + Bloom / jitter + DB admission control.',
    'Hot key detection: redis-cli --hotkeys (needs an LFU maxmemory-policy), Valkey 8 CLUSTER SLOT-STATS, client-side sampling. Hot READ → L1 or key copies; hot WRITE → change the data model.',
    'SWR: soft TTL (serve and refresh in background, once) + hard TTL (must refetch). HTTP: max-age=60, stale-while-revalidate=30, stale-if-error=86400. Never SWR balances, stock-at-checkout or auth decisions.',
  ],
  sections: [
    {
      heading: 'Caching — when it pays, and when it makes things worse',
      body: `**What it is:** keeping a copy of expensive-to-produce data closer to the reader so most requests skip the slow path.

**Mechanism:** effective latency = hit% × hit cost + miss% × (hit cost + origin cost). DB load = miss% × total QPS, so going from 95% to 99% hit cuts DB reads by 5×.

**When a cache hurts:**

- **Low reuse** — personalised or high-cardinality keys (search queries, per-user feeds) give low hit ratios while costing memory and a network hop on every miss.
- **Write-heavy data** — invalidation traffic exceeds read savings.
- **Strong-consistency reads** — balances, stock at checkout, permission checks.
- **The origin is already fast** — a 1 ms indexed PK lookup behind a 0.5 ms Redis hop saves almost nothing and adds a new failure mode.

**#1 interview trap:** claiming a cache "fixes latency". It fixes **p50 and DB load**; p99 is still the miss path whenever miss rate > 1%. Cache keys are also a correctness surface: forget the tenant, locale or auth scope in the key and you leak data between users.`,
      keyPoints: [
        'DB load = miss ratio × QPS; the hit-ratio gains that matter most are the last few percent.',
        'Key = every input that changes the output (tenant, locale, role, API version).',
      ],
    },
    {
      heading: 'Redis — single-threaded execution, TTL semantics and durability limits',
      body: `**What it is:** an in-memory data-structure server. One node does roughly 100K–200K simple ops/s at sub-millisecond latency.

**Mechanism:** commands run one at a time on the main thread. That is why each command is atomic and why a single slow command blocks everyone. Redis 6+ (and Valkey 8, with a much faster I/O-thread design) moves socket reads and writes to I/O threads, but command execution stays single-threaded. Durability options: RDB snapshots (fork plus copy-on-write) and AOF with appendfsync everysec (up to ~1 s of acknowledged writes lost). Replication is **asynchronous**.

**Licensing context (2026):** in March 2024 Redis moved to RSALv2/SSPLv1, and the Linux Foundation forked Redis 7.2.4 as **Valkey** (BSD-3). Redis 8 (2025) added AGPLv3 as an option. Valkey 9.0 (Oct 2025) shipped atomic slot migration and numbered databases in cluster mode. Managed clouds (ElastiCache, Memorystore) now offer Valkey.

**#1 interview trap:** saying "Redis is durable because AOF". Async replication plus failover can drop acknowledged writes no matter how you fsync. Second trap: plain \`SET\` **removes** an existing TTL.`,
      code: [
        {
          language: 'typescript',
          title: 'TTL semantics that bite in production (ioredis)',
          code: `import Redis from 'ioredis';
const redis = new Redis();

await redis.set('session:9', 'v1', 'EX', 1800); // TTL 1800
await redis.set('session:9', 'v2');            // TTL is now -1 (removed!)
await redis.set('session:9', 'v3', 'KEEPTTL');  // Redis 6+: keeps the current TTL

await redis.set('views:9', 0, 'EX', 60);
await redis.incr('views:9');                   // INCR keeps the TTL
await redis.hset('cart:9', 'sku1', 2);         // new hash: no TTL unless you EXPIRE
await redis.expire('cart:9', 3600, 'NX');      // Redis 7: set a TTL only if none exists`,
        },
      ],
    },
    {
      heading: 'Redis Cluster — slots, redirects, hash tags and failover',
      body: `**What it is:** Redis's built-in sharding. There are 16,384 hash slots spread over primaries (each with replicas), and nodes gossip over a cluster bus (port + 10000).

**Mechanism:**

- **Routing.** slot = CRC16(key) mod 16384. Smart clients cache the slot map (CLUSTER SHARDS / CLUSTER SLOTS). A wrong node replies **MOVED slot host:port**, and the client updates its map. During resharding the source replies **ASK**; the client sends ASKING to the target for that one command and does **not** update its map. Multi-key commands on a slot that is mid-migration can get **TRYAGAIN**.
- **Hash tags.** If the key contains {…} with a non-empty body, only that body is hashed, so {user:42}:cart and {user:42}:meta share a slot. MULTI/EXEC, Lua and MGET need all keys in one slot (otherwise CROSSSLOT).
- **Failover.** A node unreachable for cluster-node-timeout is PFAIL. When a majority of primaries report it, it becomes FAIL. Replicas then wait 500 ms + random 0–500 ms + rank × 1 s (rank 0 = most up-to-date offset) and ask primaries for votes. A majority of primaries must vote.
- **Partitions.** A primary on the minority side stops accepting writes after node-timeout, which caps the split-brain write-loss window.

**#1 interview trap:** forgetting that the default cluster-require-full-coverage yes makes the entire cluster answer CLUSTERDOWN when one shard loses both primary and replicas.`,
      diagram: `client --GET {u42}:cart--> node A (slot 9001 moved to B)
   <-- MOVED 9001 10.0.0.2:6379 ----------   (update slot map, retry at B)

during migration of slot 9001 A -> B:
client --GET k--> A : key already migrated
   <-- ASK 9001 10.0.0.2:6379              (ASKING + GET at B, map unchanged)`,
    },
    {
      heading: 'Redis Sentinel — HA for one primary, not sharding',
      body: `**What it is:** a set of separate sentinel processes that monitor one primary and its replicas, run automatic failover, and act as the service-discovery point for clients.

**Mechanism:**

1. A sentinel marks the primary **SDOWN** after down-after-milliseconds with no valid reply (30 s in the sample config; production often uses 5 s).
2. When **quorum** sentinels agree, the state becomes **ODOWN**.
3. A sentinel leader must be elected by a **majority of all sentinels** (not just quorum).
4. The leader promotes the best replica (lowest replica-priority, then largest replication offset, then smallest run ID), repoints the others, and publishes +switch-master.
5. Clients ask SENTINEL get-master-addr-by-name, or subscribe to that event, and reconnect.

**Split brain:** an isolated old primary keeps accepting writes from clients on its side. Those writes are discarded when it rejoins as a replica. min-replicas-to-write 1 with min-replicas-max-lag 10 makes it refuse writes once it cannot see a fresh replica, which limits the loss to roughly 10 s.

**#1 interview trap:** running 2 sentinels, or placing sentinels on the same hosts as the primary so one failure takes out the majority. Also: Sentinel gives you no more write throughput. For that you need Cluster.`,
      code: [
        {
          language: 'text',
          title: 'sentinel.conf and redis.conf essentials',
          code: `# sentinel.conf (3 sentinels in 3 AZs)
sentinel monitor orders-cache 10.0.1.10 6379 2
sentinel down-after-milliseconds orders-cache 5000
sentinel failover-timeout orders-cache 60000
sentinel parallel-syncs orders-cache 1
sentinel announce-ip 10.0.1.21   # required behind NAT / containers

# redis.conf on the primary: bound the split-brain loss window
min-replicas-to-write 1
min-replicas-max-lag 10`,
        },
      ],
    },
    {
      heading: 'Cache stampede — what the waiters do matters as much as the lock',
      body: `**What it is:** a hot key goes missing (expiry, eviction, deploy, flush) and many concurrent requests recompute the same value at the same moment.

**Mechanism of the defences:**

- **In-process single-flight:** one promise per key per pod, so the fan-in drops from N requests to one per pod.
- **Distributed lock / lease:** one recompute per key cluster-wide. Facebook's memcache leases also stop stale sets.
- **Early refresh** (XFetch or a soft TTL): refresh before expiry, so nobody ever sees a miss.

**The part weak answers skip — the losers:** if 5,000 waiters poll every 50 ms, Redis absorbs 100K extra GETs per second and every waiter pays up to one poll interval. Better options:

- serve the **stale** value while one request refreshes;
- have waiters await an in-process promise;
- use a bounded wait (for example 200 ms), then fall back or degrade.

The lock TTL must exceed the p99 recompute time, and release must be compare-and-delete.

**#1 interview trap:** a single-flight map that caches a **rejected** promise, so one DB timeout becomes a permanent error for that key until the pod restarts.`,
    },
    {
      heading: 'Cache penetration — misses the cache can never absorb',
      body: `**What it is:** requests for keys that do not exist in the cache *or* the database, so every request goes through to the origin. It may be malicious (random IDs) or accidental (a client bug that loops on a deleted ID).

**Mechanism of the defences:**

- **Negative caching:** store a sentinel "NOT_FOUND" value with a short TTL (30–120 s). It is cheap, but costs memory per bogus key and makes a newly created item look missing until the TTL expires. Invalidate the negative entry on create.
- **Bloom filter** of all valid IDs: about 9.6 bits per key for 1% false positives, with no false negatives *as long as every create is added*. A standard filter cannot delete, and its FP rate climbs once you exceed capacity (rebuild it, or use scalable, counting or cuckoo filters).
- **Validate early:** ID format, checksum, signed IDs, per-client rate limits.

**Where Bloom filters do not help:** open-ended inputs such as search queries or GraphQL arguments. There you need canonicalised keys, cost limits and per-client quotas.

**#1 interview trap:** building the Bloom filter from a nightly snapshot. Items created today become *false negatives*, and real users get 404s.`,
    },
    {
      heading: 'Cache avalanche — many keys, or the whole tier, at once',
      body: `**What it is:** a large fraction of the cache disappears at the same time. It comes in two flavours:

1. **Synchronised expiry** — a bulk load or warm-up wrote keys with identical TTLs.
2. **Tier loss** — node crash, restart without persistence, region failover to a cold cache, or a key-namespace bump on deploy.

**Mechanism of the defences:**

- **TTL jitter** (±10–20% of TTL) spreads out expiry, but does nothing for tier loss.
- **HA replicas and multi-AZ** placement.
- **L1 in-process caches** that keep serving hot data.
- **DB admission control:** a concurrency limit on the fallback path, priority-based shedding, and a circuit breaker that serves stale data or degrades.
- **Controlled warm-up** after recovery.
- **Shard the cache on a different key than the DB.** Uber's CacheFront shards Redis by a partition key that differs from Docstore's sharding, so losing one Redis cluster spreads misses across every DB shard instead of concentrating them on one.

**#1 interview trap:** treating "Redis has replicas" as the whole answer. A full restart, a deploy that changes key formats, or a cold standby region all produce an avalanche with perfectly healthy nodes.`,
      code: [
        {
          language: 'typescript',
          title: 'Proportional jitter instead of a fixed offset',
          code: `// Fixed +0..60 s on a 1 h TTL spreads 3M keys over only 60 s (50K expiries/s).
// Proportional jitter spreads the same keys over 12 minutes (~4K expiries/s).
export function jitteredTtl(baseSec: number, spread = 0.2): number {
  const delta = baseSec * spread;
  return Math.round(baseSec - delta / 2 + Math.random() * delta);
}`,
        },
      ],
    },
    {
      heading: 'Hot keys — detect first, then pick a read or a write fix',
      body: `**What it is:** a single key whose traffic exceeds what one shard (one thread) can serve, typically ~100K ops/s for small values and far less for large ones. Adding shards does not help, because the key still lives in one slot.

**Detection:**

- redis-cli --hotkeys (it samples OBJECT FREQ, so it **requires an LFU maxmemory-policy**);
- **CLUSTER SLOT-STATS** in Valkey 8+ (per-slot key-count, cpu-usec, network bytes);
- per-shard CPU skew on dashboards;
- client-side sampling of keys (top-K / count-min sketch in the SDK).

Avoid MONITOR in production: it can halve throughput.

**Hot reads:**

- an L1 in-process cache with a 1–5 s TTL;
- N key copies (key#0..key#N-1 hashed to different slots, read a random one, write all of them);
- replica reads (needs READONLY on cluster replicas and tolerance for lag).

**Hot writes:** replicas and L1 are useless here. Split into sub-keys and aggregate when the operation is mergeable (counters, max). Otherwise batch writes in a single owner process, or move the contended state out of Redis.

**#1 interview trap:** proposing a hash tag or "more shards" for a single key.`,
    },
    {
      heading: 'Cache warming — pre-fill deliberately, without becoming the incident',
      body: `**What it is:** populating a cache *before* traffic needs it: new cluster, new region, deploy with a new key format, post-outage recovery, or a scheduled event such as a sale launch.

**Techniques:**

- **Replay the hot set** from access logs or LFU sampling. The top 1–5% of keys usually carry 80%+ of traffic.
- **Lazy double-read** during migration: read the new cache, fall back to the old cache (not the DB) on a miss, then populate the new one.
- **Replicate writes** to the remote region's cache. Uber's CacheFront tails the Redis write stream and issues *reads* in the remote region, so values come from that region's DB.
- **Ramp traffic** gradually (weighted routing) instead of warming everything.

**Guardrails:**

- rate-limit the warmer (it is a DB client like any other) and read from replicas;
- jitter the TTLs;
- stop when marginal hit-ratio gains flatten.

**#1 interview trap:** warming "everything". It takes hours, evicts the actually hot keys, synchronises expiry, and can saturate the database the warmer was meant to protect.`,
    },
    {
      heading: 'Stale-while-revalidate — soft TTL, hard TTL, one refresher',
      body: `**What it is:** serve a slightly stale value immediately and refresh it in the background, so users never wait on a recompute for data that tolerates bounded staleness.

**HTTP (RFC 5861):** Cache-Control: max-age=60, stale-while-revalidate=30, stale-if-error=86400. The response is fresh for 60 s. Between 60 and 90 s the cache serves stale and revalidates asynchronously. After 90 s it must revalidate before responding. If the origin is erroring, stale content can be served for up to a day.

**Application level:** store the value together with a *softExpiry*; set the Redis TTL to the *hard* limit.

- On read past the soft expiry: return the value and trigger a **deduplicated** refresh (a SET NX refresh lock), with jitter.
- On a failed refresh: keep serving until the hard TTL, and alert on staleness age.
- Past the hard TTL: synchronous load, protected by single-flight.

**When not to use it:** data where staleness is a correctness bug — balances, inventory at checkout, permission revocations, feature kill switches.

**#1 interview trap:** "SWR means there is never a miss". Cold keys and keys past the hard TTL still miss, and without refresh dedupe every stale read fires its own background refresh.`,
      diagram: `age:  0 ---------- 60s ------------- 90s ----------->
      [   fresh    ][ stale: serve + ][ must revalidate
                    [ async refresh  ][ (blocking)
stale-if-error: serve stale on 5xx up to 86400s`,
    },
  ],
  codeChallenges: [
    {
      id: 'misc-caching-redis-cc-1',
      title: 'Make the cart repository safe on Redis Cluster',
      context:
        'The cart service moved from a single Redis 7 node to a 6-primary Redis Cluster (ElastiCache Valkey, cluster mode). The code below "works" in staging with one shard but in production you see CROSSSLOT errors on checkout, carts that reappear after being cleared, an admin purge job that removes only a fraction of abandoned carts, and users who add an item and then see an empty cart.',
      task: 'Rewrite the repository so every operation is correct on Redis Cluster: atomic multi-key updates, read-your-writes after add, a purge that covers every shard without blocking, and sensible client behaviour during resharding and failover. Keep the public method signatures.',
      starter: {
        language: 'typescript',
        title: 'cart.repository.ts (buggy)',
        code: `import { Cluster } from 'ioredis';

const redis = new Cluster([{ host: 'cache.internal', port: 6379 }], {
  scaleReads: 'slave', // "offload reads to replicas"
});

export class CartRepository {
  async addItem(userId: string, sku: string, qty: number) {
    await redis
      .multi()
      .hincrby(\`cart:items:\${userId}\`, sku, qty)
      .hset(\`cart:meta:\${userId}\`, 'updatedAt', Date.now())
      .exec();
  }

  async getCart(userId: string) {
    const items = await redis.hgetall(\`cart:items:\${userId}\`);
    const meta = await redis.hgetall(\`cart:meta:\${userId}\`);
    return { items, meta };
  }

  async clear(userId: string) {
    await redis.del(\`cart:items:\${userId}\`, \`cart:meta:\${userId}\`);
  }

  // nightly: purge carts idle for 30 days
  async purgeAbandoned(cutoffMs: number) {
    const keys = await redis.keys('cart:meta:*');
    for (const k of keys) {
      const updatedAt = Number(await redis.hget(k, 'updatedAt'));
      if (updatedAt < cutoffMs) await redis.del(k, k.replace('meta', 'items'));
    }
  }
}`,
      },
      hints: [
        'Which part of each key is hashed today, and what would it take for items and meta of one user to land in the same slot?',
        'Where do KEYS and SCAN run when you call them on a cluster client, and what does the cluster client do with a multi-key DEL across slots?',
        'Which reads must see the write that just happened, and which client option decides whether they can go to a replica?',
      ],
      solution: {
        language: 'typescript',
        title: 'cart.repository.ts (cluster-safe)',
        code: `import { Cluster } from 'ioredis';

const redis = new Cluster([{ host: 'cache.internal', port: 6379 }], {
  scaleReads: 'master',          // carts need read-your-writes; replicas lag
  maxRedirections: 16,
  retryDelayOnTryAgain: 100,     // multi-key op on a slot mid-migration
  retryDelayOnClusterDown: 200,
  slotsRefreshTimeout: 2000,
  redisOptions: { commandTimeout: 200 },
});

// Hash tag: only "user:<id>" is hashed, so both keys share one slot.
const itemsKey = (u: string) => \`{user:\${u}}:cart:items\`;
const metaKey = (u: string) => \`{user:\${u}}:cart:meta\`;
const CART_TTL = 30 * 24 * 3600; // idle carts expire on their own

export class CartRepository {
  async addItem(userId: string, sku: string, qty: number) {
    const res = await redis
      .multi() // same slot => valid MULTI on one primary
      .hincrby(itemsKey(userId), sku, qty)
      .hset(metaKey(userId), 'updatedAt', Date.now())
      .expire(itemsKey(userId), CART_TTL)
      .expire(metaKey(userId), CART_TTL)
      .exec();
    if (!res || res.some(([err]) => err)) throw new Error('cart write failed');
  }

  async getCart(userId: string) {
    const [[e1, items], [e2, meta]] = (await redis
      .pipeline() // same slot => one round trip to one node
      .hgetall(itemsKey(userId))
      .hgetall(metaKey(userId))
      .exec()) as [Error | null, Record<string, string>][];
    if (e1 || e2) throw e1 ?? e2;
    return { items, meta };
  }

  async clear(userId: string) {
    await redis.unlink(itemsKey(userId), metaKey(userId)); // same slot, non-blocking free
  }

  // Safety net only: TTL does the real work. SCAN each primary incrementally.
  async purgeAbandoned(cutoffMs: number) {
    for (const node of redis.nodes('master')) {
      let cursor = '0';
      do {
        const [next, keys] = await node.scan(cursor, 'MATCH', '{user:*}:cart:meta', 'COUNT', 500);
        cursor = next;
        for (const k of keys) {
          const updatedAt = Number(await node.hget(k, 'updatedAt'));
          if (updatedAt < cutoffMs) await node.unlink(k, k.replace(':meta', ':items'));
        }
      } while (cursor !== '0');
    }
  }
}`,
      },
      explanation: `**Fixes**

1. **Hash tags.** \`{user:<id>}\` makes items and meta hash to the same slot, so MULTI/EXEC, the pipeline and the two-key UNLINK are legal. Before, they were on different slots, which caused CROSSSLOT on MULTI; a multi-key DEL across slots also fails.
2. **Read-your-writes.** \`scaleReads: 'slave'\` sent HGETALL to asynchronously replicated replicas, so a user saw an empty cart right after adding. Carts read from primaries; reserve replica reads for data that tolerates lag.
3. **Purge.** \`KEYS\` on a cluster client runs on one node only (so only about one-sixth of carts were seen), and it is O(N) and blocking. The fix runs incremental \`SCAN\` per primary via \`redis.nodes('master')\`. Better still, a TTL refreshed on every write makes the purge a safety net rather than the mechanism.
4. **Resharding and failover.** Explicit \`retryDelayOnTryAgain\` / \`retryDelayOnClusterDown\`, a bounded \`maxRedirections\` and a command timeout mean migrations (ASK/TRYAGAIN) and failovers become short retries, not hung requests.
5. **Error handling.** \`exec()\` returns per-command errors instead of throwing, so check them. \`UNLINK\` frees memory off the main thread.
6. **Trade-off to mention.** A hash tag per user spreads well. A hash tag like \`{cart}\` would put every cart in one slot, creating a self-inflicted hot shard.`,
      followUps: [
        {
          "q": "purgeAbandoned issues one HGET per key: millions of round trips. How do you make it efficient while still not blocking Redis?",
          "a": "Batch per SCAN page: collect the meta keys from each page (about 500), pipeline `HGET updatedAt` for all of them in one round trip to that node, then pipeline `UNLINK` for the stale ones. That's 2 round trips per page instead of about 1,000. Run nodes in parallel with bounded concurrency and throttle (sleep between pages) to keep latency flat. Better yet, since one global index would be a hot key, maintain per-shard `cart:idx:<shard>` ZSETs scored by updatedAt and use `ZRANGEBYSCORE` to find stale carts directly. Mostly, rely on TTL so the purge rarely finds anything."
        },
        {
          "q": "How do you test this repository against real Cluster behaviour, including resharding, before production?",
          "a": "Use a local 6-node cluster in Docker (Testcontainers or `redis-cli --cluster create`). Tests: add-then-get returns the item (read-your-writes) under load; MULTI on the tagged keys never errors with CROSSSLOT; purge removes stale carts spread across all primaries (seed 10K carts and assert all stale ones are gone). Resharding: during a load test, move slots with `redis-cli --cluster reshard` and assert no request errors beyond brief retries (ASK and TRYAGAIN handled). Failover: kill a primary and assert writes recover within node-timeout plus retry delay. A single-node staging setup hid all of these bugs, so the cluster topology must match production."
        }
      ],
    },
    {
      id: 'misc-caching-redis-cc-2',
      title: 'Turn a naive loader into stale-while-revalidate with stampede and penetration guards',
      context:
        'A NestJS pricing service caches computed price quotes per product (compute is ~300 ms of DB work). Traffic is 40K RPS across 50 pods; the top 2K products carry 70% of traffic. Every 10 minutes the DB spikes, random product IDs from a scraper hammer the DB, and when the pricing DB had a 2-minute blip the whole storefront showed errors even though the cache held perfectly usable prices.',
      task: 'Rewrite getQuote so that: users almost never wait for a recompute on popular products; at most one refresh per key runs cluster-wide; a failing DB degrades to serving stale data for a bounded time; non-existent products do not reach the DB repeatedly; and expiry is not synchronised. Keep it small enough to live in one file.',
      starter: {
        language: 'typescript',
        title: 'quote.cache.ts (naive)',
        code: `import Redis from 'ioredis';
import { computeQuote, Quote } from './pricing';

const redis = new Redis();
const TTL = 600;

export async function getQuote(productId: string): Promise<Quote | null> {
  const key = 'quote:' + productId;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const quote = await computeQuote(productId); // ~300 ms, null if unknown product
  if (quote) await redis.set(key, JSON.stringify(quote), 'EX', TTL);
  return quote;
}`,
      },
      hints: [
        'Store more than the value: when should a reader start refreshing, and when is the data too old to serve at all?',
        'Two different mechanisms dedupe work: one inside a pod, one across pods. What does each protect against?',
        'What should be cached when computeQuote returns null, and for how long?',
      ],
      solution: {
        language: 'typescript',
        title: 'quote.cache.ts (SWR + single-flight + negative cache)',
        code: `import Redis from 'ioredis';
import { computeQuote, Quote } from './pricing';

const redis = new Redis({ commandTimeout: 50 });
const SOFT = 300, HARD = 1800, NEG = 60;          // seconds
type Entry = { v: Quote | null; soft: number };   // soft = epoch ms after which refresh
const inflight = new Map<string, Promise<Quote | null>>();

const jitter = (s: number) => Math.round(s * (0.9 + Math.random() * 0.2));

async function load(productId: string, key: string): Promise<Quote | null> {
  const v = await computeQuote(productId);
  const entry: Entry = { v, soft: Date.now() + jitter(v ? SOFT : NEG) * 1000 };
  await redis.set(key, JSON.stringify(entry), 'EX', v ? jitter(HARD) : NEG);
  return v;
}

function singleFlight(key: string, fn: () => Promise<Quote | null>) {
  let p = inflight.get(key);
  if (!p) {
    p = fn().finally(() => inflight.delete(key)); // never cache a rejection
    inflight.set(key, p);
  }
  return p;
}

export async function getQuote(productId: string): Promise<Quote | null> {
  const key = 'quote:' + productId;
  let raw: string | null = null;
  try { raw = await redis.get(key); } catch { /* Redis slow/down: treat as miss */ }

  if (raw) {
    const e: Entry = JSON.parse(raw);
    if (Date.now() > e.soft) {
      // stale: refresh once cluster-wide, in the background; failures keep the old entry
      redis.set('refresh:' + key, '1', 'EX', 10, 'NX')
        .then((ok) => ok && singleFlight(key, () => load(productId, key)))
        .catch(() => { /* keep serving stale until HARD; alert on age */ });
    }
    return e.v; // may be null => cached "not found"
  }
  // hard miss: one load per pod; DB errors propagate (nothing stale to serve)
  return singleFlight(key, () => load(productId, key));
}`,
      },
      explanation: `**Fixes**

1. **Soft vs hard TTL (SWR).** Popular products refresh after ~5 minutes while readers keep getting the cached value, so nobody waits 300 ms. The Redis TTL is the 30-minute hard limit.
2. **Cluster-wide refresh dedupe.** \`SET refresh:<key> NX EX 10\` lets one pod out of 50 refresh a stale key; the rest keep serving stale. Without it, every stale read fires a refresh.
3. **In-pod single-flight** for hard misses and refreshes. The \`finally\` removes the promise on both success and failure, so a DB timeout is not cached forever.
4. **Stale-if-error.** A failed background refresh leaves the old entry in place, so a DB blip no longer means storefront errors for up to the hard TTL. Alert on staleness age rather than hiding it.
5. **Negative caching.** Unknown products store \`{ v: null }\` for 60 s, so a scraper looping over the same bogus IDs hits Redis, not the DB. For random-ID floods, add a Bloom filter or ID validation in front.
6. **Jitter** on the soft TTL, hard TTL and negative TTL removes the 10-minute synchronised spike.
7. **Redis failure is treated as a miss** with a 50 ms timeout. In production, add a circuit breaker and a DB concurrency limit so a Redis outage does not become 40K RPS of recomputes.`,
      followUps: [
        {
          "q": "Redis itself goes down for 2 minutes. With this code, what happens to the pricing DB at 40K RPS, and how do you protect it?",
          "a": "Every GET fails, so every request becomes a hard miss. In-pod single-flight collapses concurrent misses per product per pod, but with 50 pods and thousands of distinct products that's still tens of thousands of 300 ms recomputes per second, far over the DB's budget, and the DB falls over. Protect it: a circuit breaker on Redis so failures are instant; a per-pod in-memory L1 (LRU of the top 2K products, which carry 70% of traffic) serving stale values during the outage; a hard concurrency limit on `computeQuote` (for example 20 per pod), returning 'price unavailable' beyond it. Degraded pages beat a dead database."
        },
        {
          "q": "How would you observe this cache in production to know SWR is working and data isn't silently too stale?",
          "a": "Emit metrics per request: outcome (fresh hit, stale hit, hard miss, negative hit), and the age of the served value (`now - (soft - SOFT)`). Dashboards: stale-hit ratio (should be small for hot keys), p99 served age (alert if above SOFT plus 2 minutes, meaning refreshes are failing), refresh attempts vs lock-acquired vs refresh errors, hard-miss rate and recompute latency, and the negative-cache hit rate (a spike means a scraper). Log refresh errors with the product id. A synthetic check that changes a test product's price and verifies it propagates within the soft TTL closes the loop."
        }
      ],
    },
  ],
  interviewQuestions: [
    // ---------- Caching ----------
    {
      id: 'misc-caching-redis-iq-01',
      difficulty: 'medium',
      question: 'When would you NOT add a cache? Give me concrete cases where a cache makes the system slower, more expensive or less correct.',
      context: 'Rapid-fire opener; a variant ("When would you not use Redis?") is repeatedly reported in 2025 senior backend interview write-ups.',
      whatInterviewerLooksFor: [
        'Reasons in terms of reuse, write rate and consistency, not "caching is always good"',
        'Knows the miss path adds a hop and a failure mode',
        'Names data that must never be served stale',
        'Mentions measuring before adding the cache',
      ],
      modelAnswer: `**Skip the cache when the maths or the semantics are wrong:**

- **Low reuse.** Per-user search results, long-tail product pages or unique report parameters get 10–30% hit ratios. You pay memory, serialisation and an extra 0.3–1 ms hop on *every* miss for little DB relief.
- **Write-heavy keys.** If a value changes more often than it is read, invalidation traffic and race windows cost more than the reads you save.
- **Correctness-critical reads.** Balances, stock at checkout, permission and revocation checks, idempotency decisions. A stale answer is a bug, not a slow page.
- **The origin is already cheap.** A 1 ms PK lookup on a healthy Postgres gains little from a 0.5 ms Redis hop and adds a dependency that can page you at 3 a.m.
- **You can fix the source instead.** A missing index, an N+1 or a bad query plan should be fixed, not hidden. A cache in front of a broken query hides it until the cache misses.

**How I decide:** measure the key distribution (top-K share), the read/write ratio and the tolerance for staleness, then estimate DB load = miss% × QPS before and after. If a 90% hit ratio does not move a real bottleneck, the cache is complexity without payoff.`,
      followUps: [
        { q: 'The DB is at 85% CPU from one expensive aggregate query. Cache it or not?', a: 'Usually yes, if its output is shared and tolerates seconds of staleness — but first check whether a materialised view or an index makes it cheap enough that no cache is needed.' },
        { q: 'What metric tells you a cache is not earning its keep?', a: 'Hit ratio per key prefix together with memory per prefix and DB QPS saved. A prefix with 20% hits using 40% of memory is a candidate for removal or a shorter TTL.' },
      ],
      pitfalls: [
        'Saying a cache always reduces latency, without separating p50 from p99',
        'Caching authorisation or balance data "with a short TTL"',
        'Ignoring that the cache becomes a new availability dependency',
      ],
    },
    {
      id: 'misc-caching-redis-iq-02',
      difficulty: 'hard',
      question:
        'Our NestJS GraphQL gateway wants to cache resolver results in Redis. Some fields depend on the viewer (price tier, entitlements), others are public. Where do you cache — whole query responses, per field, or per entity — and how do you avoid leaking one user\'s data to another?',
      whatInterviewerLooksFor: [
        'Explains why whole-response caching fails for GraphQL (query shape explosion, viewer-dependent fields)',
        'Entity-level caching with DataLoader and explicit cache scopes',
        'Cache key includes every input that changes output (tenant, role, locale, schema version)',
        'Invalidation strategy tied to entity IDs',
        'Mentions a test or guardrail against cross-user leakage',
      ],
      modelAnswer: `**Where to cache**

- **Whole-response caching** keyed by a hash of query + variables gives terrible hit ratios, because every client sends a different selection set. It is also dangerous as soon as one field is viewer-specific. It is only reasonable for persisted, public queries (for example an anonymous home page) at the CDN or edge.
- **Entity-level caching** is the default: cache \`Product:42\` or \`Author:7\` as normalised records beneath the resolvers, batched with DataLoader. Every query shape reuses the same entries, and invalidation is by entity ID — a CDC or domain event deletes \`product:42\`.
- **Field-level caching** only for expensive computed fields (for example a recommendation list), with an explicit **scope**: PUBLIC or PRIVATE(viewerId / tier).

**Preventing leaks**

1. Split the entity into a **public part** (name, images) and a **viewer-dependent part** (tier price, entitlements). Cache the public part globally. The viewer part is either not cached or cached under \`price:{tier}:{productId}\` — keyed by tier, not by user, so hit ratios stay high.
2. The key builder is one function that *requires* tenant, locale and scope parameters, so a developer cannot forget them. Include a schema or serializer version so a deploy does not read old shapes.
3. DataLoader caches are **per request**, never module singletons. A singleton DataLoader across requests is a classic leak.
4. Add a contract test that resolves the same query as two users with different tiers and asserts the responses differ.

**Numbers:** entity caching on a catalogue typically gets 90%+ hits even with thousands of query shapes. Response caching on the same traffic often sits under 30%.

**Consistency:** entity TTL of 5–10 minutes as a safety net, plus event-driven deletes. Viewer-scoped entries get shorter TTLs because entitlements change on purchase.`,
      followUps: [
        { q: 'How do you cache at the CDN for GraphQL at all?', a: 'Persisted queries sent as GET with a query hash, a Cache-Control computed as the minimum across resolved fields (the Apollo cache-control approach), and private/no-store whenever any field is viewer-scoped.' },
        { q: 'A price change must show within 5 seconds. What changes?', a: 'Keep the public entity cached, but serve price from a tier-keyed entry that is deleted on the price-change event (outbox → Kafka → invalidator), with a short TTL as a backstop.' },
      ],
      pitfalls: [
        'Caching the full JSON response keyed by user ID (hit ratio collapses and memory explodes)',
        'A module-level DataLoader or memoiser shared across requests',
        'Forgetting tenant or locale in the key',
      ],
    },
    // ---------- Redis ----------
    {
      id: 'misc-caching-redis-iq-03',
      difficulty: 'medium',
      question:
        'Redis runs commands on a single thread, yet it does 100K+ ops/s. Explain why, what exactly Redis 6+ and Valkey 8 made multi-threaded, and what that means when someone runs a slow command.',
      context: 'Research-derived: "Why is Redis so fast if it is single-threaded?" is one of the most-reported Redis questions in 2025 backend interview write-ups.',
      whatInterviewerLooksFor: [
        'In-memory data structures, no locks, event loop with I/O multiplexing',
        'I/O threads handle socket read/write and parsing; execution stays serial',
        'Understands that one O(N) command blocks everyone',
        'Knows the operational tools: SLOWLOG, UNLINK, SCAN',
      ],
      modelAnswer: `**Why it is fast**

- All data is in RAM, with purpose-built structures (listpacks, skiplists, hash tables). A typical command is a few microseconds of CPU.
- One thread means no locks, no context switches between workers, and no contention. An epoll event loop multiplexes thousands of connections.
- The real bottleneck is usually the network and syscalls. That is why pipelining multiplies throughput by 5–10×.

**What is threaded**

- **Redis 6+** added optional \`io-threads\`: reading from sockets, parsing and writing replies. Command *execution* is still serial.
- **Valkey 8** redesigned I/O threading (the main thread hands off work, plus prefetching), roughly doubling or tripling throughput on big boxes — around 1M+ RPS in its benchmarks. Execution is still single-threaded.
- Background threads handle lazy freeing (UNLINK), AOF fsync and closing files.

**Consequence**

A single \`KEYS *\`, an \`HGETALL\` on a 2M-field hash, \`DEL\` on a huge set, or a Lua loop over 100K elements holds the thread for tens to hundreds of milliseconds, and **every client's latency spikes**. So:

- use SCAN / HSCAN;
- use UNLINK;
- keep values small (<100 KB);
- watch \`SLOWLOG\` and \`latency doctor\`;
- scale by sharding, not by bigger cores.`,
      followUps: [
        { q: 'Does enabling io-threads make Lua scripts faster?', a: 'No. Scripts run on the main thread; I/O threads only help when the time is spent in networking and parsing.' },
        { q: 'Why does a large RDB snapshot cause latency even though it is forked?', a: 'fork() must copy page tables (tens of ms for large heaps, worse with transparent huge pages), and copy-on-write duplicates pages under a heavy write load.' },
      ],
      pitfalls: [
        'Saying Redis 6 is "multi-threaded" so slow commands are fine',
        'Attributing speed only to "it is in memory"',
        'Not knowing a single command can block all clients',
      ],
    },
    {
      id: 'misc-caching-redis-iq-04',
      difficulty: 'expert',
      question:
        'A teammate proposes storing wallet balances only in Redis with AOF appendfsync always and one replica, arguing "fsync on every write means no data loss". Review the proposal: when exactly can an acknowledged debit disappear, and what would you do instead?',
      context: 'Research-derived: "A primary fails after acknowledging a write — what happens?" appears in multiple 2025 Redis interview guides; sharpened here into a design review.',
      whatInterviewerLooksFor: [
        'Separates local durability (fsync) from replicated durability (async replication plus failover)',
        'Walks through a failover that loses an acknowledged write',
        'Knows what WAIT and WAITAOF do and do not guarantee',
        'Proposes the right system of record plus a sensible Redis role',
      ],
      modelAnswer: `**What appendfsync always buys:** if the *same node* crashes and restarts, every acknowledged write is on its disk. The cost is throughput — every write waits on disk fsync, so single-digit thousands of writes per second instead of 100K.

**How an acknowledged debit still disappears**

1. The client runs DECRBY wallet:42 500. The primary fsyncs and replies OK.
2. Replication is **asynchronous**, and the replica has not received the write yet.
3. The primary's host dies or is partitioned. Sentinel or Cluster promotes the replica, which never saw the debit.
4. The old primary rejoins as a replica and **resyncs from the new primary**, discarding its own on-disk write. Fsync made no difference.

A network partition makes it worse. An isolated primary keeps acknowledging writes for up to down-after-milliseconds (Sentinel) or cluster-node-timeout (Cluster) unless min-replicas-to-write is set. Those writes are lost when it rejoins.

**Mitigations inside Redis (and their limits)**

- **WAIT 1 100** blocks until one replica acknowledges. It reduces loss but is not a consensus protocol: failover can still promote a replica that missed the write, and a WAIT timeout leaves the write applied on the primary anyway.
- **WAITAOF** (Redis 7.2+) waits for fsync locally and/or on replicas, which is stronger but still not linearizable across failover.
- **min-replicas-to-write 1** bounds split-brain loss to about min-replicas-max-lag seconds.

**What I would do**

- Make Postgres (or another consensus-replicated store) the **ledger**: an append-only entries table, balance = SUM, or a guarded update in a transaction, with idempotency keys.
- Use Redis for what it is good at: caching the computed balance for display (invalidated on commit), rate limits, and holds with TTLs that are reconciled against the ledger.
- If sub-millisecond balance checks are truly required, look at systems that offer strong consistency by design (for example Raft-based stores, or MemoryDB's multi-AZ transaction log) — and state the latency cost.`,
      followUps: [
        { q: 'Does Redis Cluster behave differently from Sentinel here?', a: 'Same class of risk: async replication plus failover by election. The minority-side primary stops writes after cluster-node-timeout, which bounds but does not remove the loss window.' },
        { q: 'How would you detect that a loss happened?', a: 'Reconcile Redis-derived balances against the ledger continuously, alert on drift, and log replication offsets at failover.' },
      ],
      pitfalls: [
        'Equating fsync with replicated durability',
        'Claiming WAIT makes Redis strongly consistent',
        'Rejecting Redis entirely instead of giving it a safe role',
      ],
    },
    {
      id: 'misc-caching-redis-iq-05',
      difficulty: 'medium',
      question:
        'Our self-hosted Redis 7.2 fleet needs an upgrade path for 2026. Leadership asks: Redis 8 or Valkey? What do you actually evaluate before choosing?',
      whatInterviewerLooksFor: [
        'Accurate licensing history (RSAL/SSPL March 2024, Valkey fork of 7.2.4, AGPLv3 option in Redis 8)',
        'Separates licence, feature, client-compatibility and managed-service concerns',
        'Mentions protocol and command compatibility and where they diverge',
        'Has a migration and rollback plan',
      ],
      modelAnswer: `**Context:** Redis 7.4+ moved to RSALv2/SSPLv1 in March 2024. The Linux Foundation forked 7.2.4 as **Valkey** under BSD-3, backed by AWS, Google, Oracle and others. Redis 8 (2025) added **AGPLv3** as an option and folded the former Stack modules (JSON, search, time series, probabilistic) into the core distribution.

**What I evaluate**

1. **Licence exposure.** Self-hosting internally is fine under any of these. Offering Redis as a service to third parties, or distributing it in a product, is where SSPL/AGPL obligations matter — involve legal.
2. **Features we use.** If we depend on RedisJSON or RediSearch, Redis 8 has them built in; Valkey has its own modules (for example valkey-json, valkey-bloom, valkey-search) with varying maturity. For plain caching, sessions and queues, both are equivalent.
3. **Divergence after 7.2.** Valkey 8 brought faster I/O threading and CLUSTER SLOT-STATS; Valkey 9 brought atomic slot migration and multiple DBs in cluster mode. Redis 8 has its own new commands and data types. Check the exact commands our clients call.
4. **Managed options and cost.** ElastiCache and Memorystore offer Valkey, typically at a lower price than their Redis OSS engine.
5. **Clients.** ioredis and node-redis speak RESP2/3 to both; test the cluster-mode and Sentinel paths specifically.

**Plan:** stand up the target engine as a replica of a 7.2 primary (the replication protocol is compatible from 7.2), shadow traffic, compare latency and memory, fail over one non-critical shard, and keep the old nodes for rollback.`,
      followUps: [
        { q: 'Can you replicate from Redis 8 back to Valkey for rollback?', a: 'Not reliably — newer RDB versions and commands may be unreadable by the other engine. Rollback means keeping the 7.2-compatible fleet until you are confident, or rebuilding a pure cache from the source of truth.' },
        { q: 'Does any of this matter for a pure cache?', a: 'Much less: a cache can be rebuilt, so the migration can be a cold cutover with warming. The licence and feature questions still apply.' },
      ],
      pitfalls: [
        'Stating that Redis became closed source, or that Valkey is abandoned (both wrong)',
        'Ignoring module dependencies',
        'Assuming RDB files are forward- and backward-compatible across engines',
      ],
    },
    // ---------- Redis Cluster ----------
    {
      id: 'misc-caching-redis-iq-06',
      difficulty: 'medium',
      question:
        'Walk me through how a cluster-aware client routes a GET in Redis Cluster, and the difference between MOVED, ASK and TRYAGAIN. Which one should make the client refresh its slot map?',
      context: 'Research-derived: "How does a key find its node in a cluster?" is a staple in 2025 Redis interview guides.',
      whatInterviewerLooksFor: [
        'CRC16 mod 16384 and client-side slot map',
        'MOVED updates the map; ASK is one-shot with ASKING',
        'TRYAGAIN during migration of multi-key ops',
        'Knows the no-proxy design means one hop in the steady state',
      ],
      modelAnswer: `**Routing**

1. On connect, the client fetches the slot → node map with \`CLUSTER SHARDS\` (7.0+) or \`CLUSTER SLOTS\`.
2. For each command it computes slot = CRC16(key or hash tag) mod 16384 and sends it straight to the owning primary (or to a replica, if reads are allowed and \`READONLY\` was sent). There is no proxy, so the steady state is one network hop.

**Redirections**

- **MOVED 9001 10.0.0.5:6379.** The slot permanently lives elsewhere (after a completed reshard or failover). The client retries there **and refreshes its map**. A good client refreshes the whole map on MOVED, because one move usually implies others.
- **ASK 9001 10.0.0.5:6379.** Slot 9001 is being migrated and this particular key has already moved. The client sends \`ASKING\` then the command to the target, **once**, and does **not** update the map. Other keys in the slot may still be on the source.
- **TRYAGAIN.** A multi-key command touches a migrating slot whose keys are split between source and target. The client should back off briefly (ioredis defaults to 100 ms) and retry.
- **CLUSTERDOWN.** The slot is not served (no primary, or full coverage lost). Back off and retry, or fail fast.

**Interview signal:** a stream of MOVED responses in steady state means the client is not caching the map — a misconfigured non-cluster client or a proxy in between — and every request pays two hops.`,
      followUps: [
        { q: 'What happens with a non-cluster client pointed at one node?', a: 'Commands for keys on other nodes return MOVED errors to the application; about (N-1)/N of commands fail.' },
        { q: 'How many redirections before giving up?', a: 'Clients cap it (ioredis maxRedirections = 16) to avoid loops during topology churn.' },
      ],
      pitfalls: [
        'Saying ASK should update the slot map',
        'Believing Redis Cluster uses consistent hashing on a ring',
        'Thinking nodes proxy requests to each other',
      ],
    },
    {
      id: 'misc-caching-redis-iq-07',
      difficulty: 'expert',
      question:
        'We are growing a Redis Cluster from 6 to 10 primaries during business hours. Last time, resharding caused p99 spikes, TRYAGAIN errors on MGET and a Lua script, and one migration stalled on a big key. Explain the slot migration mechanics and how you would run this one safely.',
      whatInterviewerLooksFor: [
        'Knows the MIGRATING/IMPORTING states and key-by-key MIGRATE',
        'Explains why big keys and multi-key ops suffer',
        'Concrete runbook: pacing, big-key audit, off-peak, monitoring',
        'Mentions Valkey 9 atomic slot migration as the modern alternative',
      ],
      modelAnswer: `**Mechanics (Redis OSS / Valkey up to 8)**

1. On the target, \`CLUSTER SETSLOT <slot> IMPORTING <src>\`; on the source, \`SETSLOT <slot> MIGRATING <dst>\`.
2. The tool loops \`CLUSTER GETKEYSINSLOT\` and \`MIGRATE ... KEYS k1 k2 ...\`. MIGRATE serialises each key (DUMP), sends it and deletes it on the source — **synchronously, blocking both nodes** for the duration of that key.
3. While the slot is migrating, a missing key on the source gets **ASK** to the target. Multi-key commands (MGET, MULTI, Lua) whose keys are split get **TRYAGAIN**.
4. Finally \`SETSLOT <slot> NODE <dst>\` on both nodes; clients now get MOVED and refresh.

**Why it hurt last time**

- A 500 MB sorted set in one MIGRATE blocked the source for seconds, causing p99 spikes and possibly a MIGRATE timeout that leaves the slot stuck in MIGRATING.
- Hash-tagged key groups (\`{user:42}:*\`) are split mid-migration, so every multi-key op on those users got TRYAGAIN until the slot finished.
- Moving roughly 40% of 16,384 slots at full speed also doubles bandwidth and CPU on the source nodes.

**Runbook**

- Audit big keys first (\`redis-cli --bigkeys\` / \`--memkeys\`). Split or TTL anything over ~10 MB before migrating.
- Add the 4 new primaries (with replicas) empty, then rebalance **gradually**: small pipeline sizes, a few slots at a time, pausing when p99 or CPU crosses thresholds. Do it off-peak even if "online".
- Clients: bounded retries on TRYAGAIN/ASK (ioredis \`retryDelayOnTryAgain\`), command timeouts, and a slot-map refresh on MOVED.
- Monitor \`CLUSTER INFO\` (cluster_state, slots_ok), migration progress, and command latency per node. Fix a stuck slot with \`CLUSTER SETSLOT <slot> STABLE\` or by finishing the move.
- Cache vs system of record: for a pure cache, simply **dropping** keys in the slot is acceptable if the DB can absorb the misses.

**Modern alternative:** **Valkey 9.0** (Oct 2025) migrates a whole slot atomically using an AOF-style stream to the target and then flips ownership. There are no per-key ASK/TRYAGAIN windows and big keys do not block the same way. Managed services (ElastiCache online resharding) wrap this for you.`,
      followUps: [
        { q: 'Why not just add nodes and let Redis rebalance automatically?', a: 'Redis Cluster does not auto-rebalance; an operator or tool (redis-cli --cluster rebalance, or a managed service) must move slots.' },
        { q: 'Could you avoid TRYAGAIN for the Lua script?', a: 'Only by keeping its keys out of migrating slots or retrying; multi-key atomicity cannot span source and target.' },
      ],
      pitfalls: [
        'Thinking slot migration is instantaneous or copies whole slots in OSS Redis',
        'Not auditing big keys',
        'Forgetting that clients need retry behaviour for ASK/TRYAGAIN',
      ],
    },
    {
      id: 'misc-caching-redis-iq-08',
      difficulty: 'expert',
      question:
        'A network partition isolates one Redis Cluster primary together with 20% of our API pods for 40 seconds. cluster-node-timeout is 15 s. Walk me through, second by second, what happens to writes on both sides, what data is lost when it heals, and what knobs change the outcome.',
      whatInterviewerLooksFor: [
        'PFAIL → FAIL by majority, replica election timing',
        'Minority primary stops writes after node-timeout',
        'Precise loss window and why async replication causes it',
        'Knobs: node-timeout, min-replicas-to-write, full coverage, client timeouts',
      ],
      modelAnswer: `**Setup:** primary P (slots 0–2730) is isolated with 20% of pods. Its replica R and the other primaries are on the majority side.

**Timeline**

- **t = 0–15 s.** On the minority side, P keeps accepting writes from its 20% of pods. On the majority side, other nodes cannot reach P; after 15 s they mark it **PFAIL**. The 80% of pods cannot reach P either, so their writes to slots 0–2730 time out.
- **t ≈ 15 s.** On the minority side, P notices it cannot reach a majority of primaries for node-timeout and **stops accepting writes** (and reads, unless cluster-allow-reads-when-down is set). On the majority side, gossip reaches a majority of primaries agreeing on PFAIL, and P becomes **FAIL**.
- **t ≈ 15.5–17 s.** R waits 500 ms + random(0–500 ms) + rank × 1 s, then requests votes, gets a majority of primaries and is **promoted**. Majority-side clients get MOVED or refresh their map and write to R.
- **t = 40 s — heal.** P sees a higher config epoch for its slots, **demotes itself** to a replica of R and resyncs. Every write P accepted that had not replicated to R before the partition — up to ~15 s of writes from the minority pods — is **discarded**.

**Loss window:** about node-timeout (15 s) × the write rate from minority clients. At 3K writes/s that is roughly 45K acknowledged writes gone.

**Knobs**

- **Lower cluster-node-timeout** (for example 5 s) shrinks both unavailability and the loss window, at the risk of false failovers from GC-like stalls or network jitter.
- **min-replicas-to-write 1** + **min-replicas-max-lag** makes P refuse writes as soon as it loses its replica, often well before node-timeout.
- **Client timeouts and circuit breakers** so the 80% of pods fail fast rather than queueing for 15 s.
- **cluster-require-full-coverage no** so, if a shard loses all its nodes, the *other* slots keep serving.
- **Treat Redis as rebuildable:** idempotent writes and a source of truth elsewhere for anything that matters.`,
      followUps: [
        { q: 'What if P had two replicas, one on each side?', a: 'The majority-side replica gets promoted; the minority-side replica follows P and will also be resynced from the new primary. The loss window is unchanged, but min-replicas-to-write 1 would NOT stop P because it can still see its local replica.' },
        { q: 'Why is a majority of primaries needed to vote?', a: 'So that only one side of a partition can elect a new owner of the slots in a given epoch, preventing two primaries for the same slots from being legitimately elected.' },
      ],
      pitfalls: [
        'Saying Redis Cluster never loses acknowledged writes',
        'Claiming the minority primary keeps writing for the whole 40 s',
        'Forgetting that an election needs a majority of primaries, not replicas',
      ],
    },
    // ---------- Redis Sentinel ----------
    {
      id: 'misc-caching-redis-iq-09',
      difficulty: 'medium',
      question:
        'Sentinel vs Cluster: when do you pick each, and walk me through a Sentinel failover from the moment the primary dies to the moment clients write to the new one. Why is two sentinels a bad idea?',
      context: 'Research-derived: "When would you use Sentinel versus Cluster?" is listed in several 2025–26 Redis interview guides.',
      whatInterviewerLooksFor: [
        'Sentinel = HA for one dataset; Cluster = sharding plus HA',
        'SDOWN → ODOWN → leader election by majority → promotion',
        'Client discovery through sentinels, not a hardcoded IP',
        'Majority arithmetic: 2 sentinels cannot survive losing one',
      ],
      modelAnswer: `**Choice**

- **Sentinel** when the data fits on one primary (tens of GB, under ~100K writes/s) and you need automatic failover while keeping *all* commands and multi-key ops, Lua and MULTI working unchanged.
- **Cluster** when you need more memory or write throughput than one node offers. The cost is hash-tag discipline and cluster-aware clients.

**Failover walk-through**

1. The primary dies. Each sentinel marks it **SDOWN** after down-after-milliseconds (say 5 s).
2. Sentinels ask each other; once **quorum** (say 2 of 3) agree, it becomes **ODOWN**.
3. One sentinel requests leadership for the new epoch and needs votes from a **majority of all sentinels** (2 of 3).
4. The leader picks a replica (replica-priority, then replication offset, then run ID), sends REPLICAOF NO ONE, repoints the other replicas, and broadcasts +switch-master.
5. Clients configured with the sentinel list (ioredis \`sentinels\` + \`name\`) ask \`SENTINEL get-master-addr-by-name\` on reconnect and connect to the new primary.

Total time is typically down-after + 1–3 s.

**Two sentinels:** the majority of 2 is 2. If the box running one sentinel dies — often the same box as the primary — the survivor can never be elected, so there is **no failover** exactly when you need it. Use 3 or 5, in separate failure domains.`,
      followUps: [
        { q: 'Does Sentinel proxy traffic?', a: 'No. It is a discovery and control plane; clients connect directly to Redis after asking sentinels where the primary is.' },
        { q: 'Can you scale reads with Sentinel?', a: 'Yes, by sending reads to replicas (discovered via sentinels) if you tolerate replication lag.' },
      ],
      pitfalls: [
        'Confusing quorum (to detect) with majority (to authorise)',
        'Hardcoding the primary IP in the application',
        'Choosing Cluster for HA alone when the data fits on one node',
      ],
    },
    {
      id: 'misc-caching-redis-iq-10',
      difficulty: 'expert',
      question:
        'After a Sentinel failover last night, two things happened: some pods kept getting "READONLY You can\'t write against a read only replica" for 20 minutes, and about 30 seconds of session writes vanished. Explain both and harden the setup.',
      whatInterviewerLooksFor: [
        'READONLY: pods with persistent connections to the demoted primary (or DNS/VIP pointing at it)',
        'Client-side fix: reconnectOnError and sentinel-based discovery',
        'Lost writes: split brain / async replication while the old primary was isolated',
        'Server-side fix: min-replicas-to-write, sentinel placement, announce-ip',
      ],
      modelAnswer: `**Symptom 1 — READONLY for 20 minutes**

The old primary came back and Sentinel reconfigured it as a **replica**. Pods that connected via a hardcoded IP, a DNS name or a Kubernetes Service pointing at "redis-0" still had open TCP connections to that node. Nothing forced them to reconnect, so every write got READONLY. Twenty minutes is probably how long those connections or pods lived.

**Fix:**

- Connect through Sentinel: ioredis with \`sentinels: [...]\` and \`name\`, so every reconnect asks for the current primary.
- Add \`reconnectOnError: (err) => err.message.startsWith('READONLY') ? 2 : false\`, which reconnects (rediscovering the primary) and resends the command.
- Some teams also subscribe to +switch-master to proactively drop connections.

**Symptom 2 — 30 s of writes lost**

The old primary was **partitioned rather than dead**. Clients on its side kept writing to it, and it acknowledged them. The majority side promoted a replica after down-after-milliseconds (plus election). When the partition healed, the old primary was demoted and **fully resynced** from the new one, throwing away its divergent writes. Replication is async, so Redis offers no merge.

**Fix:**

- \`min-replicas-to-write 1\` and \`min-replicas-max-lag 10\` on every node (they apply whenever the node is primary). The isolated primary stops acknowledging writes once it cannot see a replica with fresh acks, which bounds the loss to ~10 s rather than the whole partition.
- **Sentinel placement:** 3 sentinels in 3 AZs, not co-located on the Redis hosts only, so the side holding the majority matches where most clients live.
- **announce-ip / replica-announce-ip** behind NAT or in containers, so sentinels publish reachable addresses (another cause of clients connecting to the wrong node).
- **Sessions:** accept that Redis may lose seconds of writes. Re-issue sessions on miss (users re-login in the worst case), or keep the authoritative session in the DB with Redis as a cache.`,
      followUps: [
        { q: 'Would a Kubernetes Service with a readiness probe on role:master fix symptom 1?', a: 'It helps new connections, but existing TCP connections are not moved when endpoints change; you still need client-side reconnect-on-READONLY.' },
        { q: 'Why not set min-replicas-to-write 2?', a: 'With one replica it would make the primary refuse all writes whenever that replica restarts, trading lost writes for write unavailability.' },
      ],
      pitfalls: [
        'Blaming Sentinel for being slow instead of client connection handling',
        'Expecting the old primary\'s writes to be merged back',
        'Placing all three sentinels on the Redis hosts in a single AZ',
      ],
    },
    // ---------- Cache stampede ----------
    {
      id: 'misc-caching-redis-iq-11',
      difficulty: 'medium',
      question:
        'Everyone says "stampede happens when a hot key expires". Name other triggers you have seen or would expect, and for each, which defence actually helps.',
      whatInterviewerLooksFor: [
        'Triggers beyond TTL: flush, deploy key change, eviction, failover to a cold replica, new pods with empty L1',
        'Matches defence to trigger (early refresh does not help a flush)',
        'Mentions single-flight as the universal baseline',
        'Mentions monitoring for recomputes per key',
      ],
      modelAnswer: `**Triggers and matching defences**

| Trigger | Why it stampedes | Defence that helps |
|---|---|---|
| TTL expiry of a hot key | every reader misses at once | early refresh / soft TTL, lock or lease |
| Eviction under memory pressure | the hot key is evicted (for example allkeys-lru with a batch job) | right-size memory, LFU policy, separate instances |
| Admin "clear cache" / FLUSHDB | every key missing | never flush; namespace-version bump plus gradual TTL, or warm first |
| Deploy changes key format or serializer | new code misses everything | read-old-write-new, pre-warm under the new keys |
| Failover to a replica that was resyncing | replica is empty or partial | wait for sync before promotion; DB concurrency limit |
| Scale-out: 50 new pods with an empty L1 | every pod refetches its hot set | L1 single-flight; L2 absorbs it if healthy |
| Upstream write burst invalidating a hot key repeatedly | constant delete → refill | coalesce invalidations, or update-in-place for hot keys |

**Baseline everywhere:** in-process single-flight, so at most one load per key per pod, plus a DB-side concurrency limit so no trigger can exceed DB capacity. Track "loads per key per minute" to see stampedes directly.`,
      followUps: [
        { q: 'Which of these does a distributed lock not fix?', a: 'Mass triggers such as a flush or a key-format change — the lock serialises per key, but 100K different keys still miss at once. That is an avalanche.' },
        { q: 'How do you pick lock TTL?', a: 'Above the p99 recompute time (for example 3× p99), and pair it with a fencing or compare-and-delete release.' },
      ],
      pitfalls: [
        'Only mentioning TTL expiry',
        'Proposing a distributed lock for every key on every read',
        'Not distinguishing a stampede (one key) from an avalanche (many keys)',
      ],
    },
    {
      id: 'misc-caching-redis-iq-12',
      difficulty: 'hard',
      question:
        'We added a Redis lock so only one pod recomputes a hot dashboard key (2 s recompute). DB spikes are gone, but now p99 is 2.5 s at every expiry and Redis CPU doubles for those seconds. What is going on with the waiters, and how would you redesign the waiting strategy?',
      whatInterviewerLooksFor: [
        'Identifies polling waiters: GET storm plus added latency',
        'Serve stale instead of wait; or promise-based waiting in-process',
        'Combines in-process single-flight with a distributed lock',
        'Bounded wait with a fallback; lease tokens (Facebook memcache)',
      ],
      modelAnswer: `**Diagnosis**

The key is read 20K times/s. At expiry, one pod wins the lock and the others enter \`while (!value) { sleep(50); GET }\`.

- For 2 s, about 40K waiting requests each poll 20 times per second, roughly **800K extra GETs** hitting Redis. That explains the CPU doubling.
- Every waiter pays the full recompute (2 s) plus up to one poll interval plus queueing, so p99 is 2.5 s. We traded a DB spike for a latency spike.

**Redesign**

1. **Never let the value disappear.** Store it with a soft expiry (for example 60 s before the hard TTL). The first reader past the soft expiry takes the lock (SET NX PX 10000) and refreshes in the background. **Everyone else returns the stale value immediately.** Nobody waits, and p99 stays at the cache-hit latency.
2. **Collapse waiters in-process.** For true hard misses (cold start), each pod keeps a Map<key, Promise>. Concurrent requests in the pod await one promise, so one GET or load per pod instead of one per request: 50 pods rather than 40K waiters.
3. **Cross-pod waiting without polling.** Non-winning pods can \`SUBSCRIBE refresh:<key>\` (or do one short blocking read), with a bounded wait of ~300 ms. After that, serve a degraded response (last-known value from L1, or "data updating").
4. **Leases** (Facebook memcache): the miss response carries a token, only the token holder may SET, and others retry after ~10 ms — rate-limited by the server.
5. **Make recompute cheaper or asynchronous.** A 2 s dashboard aggregate should probably be precomputed by a scheduled job every N seconds and written to Redis. Then readers never trigger compute.

**Result:** expiry becomes invisible — p99 ≈ 2 ms. Redis sees one lock SET per refresh, and the DB sees one recompute per interval.`,
      followUps: [
        { q: 'What if the lock holder crashes mid-recompute?', a: 'The lock TTL (10 s) expires and the next stale reader takes over; meanwhile readers keep getting the stale value, so users see nothing.' },
        { q: 'When is waiting (not serving stale) required?', a: 'When stale data is incorrect — for example a permission change. Then use a short bounded wait and fail closed.' },
      ],
      pitfalls: [
        'Tuning the poll interval instead of removing polling',
        'Letting the lock TTL be shorter than the recompute time',
        'Ignoring the in-pod fan-in',
      ],
    },
    // ---------- Cache penetration ----------
    {
      id: 'misc-caching-redis-iq-13',
      difficulty: 'medium',
      question:
        'Negative caching or a Bloom filter to stop lookups of IDs that do not exist — which do you choose, and what goes wrong with each when new items are created?',
      context: 'Research-derived: the penetration / breakdown / avalanche trio is reported as a very common 2025 senior backend question; this sharpens the penetration part.',
      whatInterviewerLooksFor: [
        'Negative cache: cheap, per-key memory, read-after-create staleness',
        'Bloom filter: fixed memory, false positives OK, false negatives fatal',
        'Keeping the filter in sync with creates (and deletes)',
        'Chooses by attack shape: repeated IDs vs random IDs',
      ],
      modelAnswer: `**Negative caching** — store NOT_FOUND with a 30–120 s TTL.

- Good when the *same* missing IDs repeat (a client retry bug, deleted items still linked).
- Useless against **random** IDs: each one is new, so you just fill Redis with junk.
- **Create problem:** a user creates item 123 moments after someone looked it up. Reads return "not found" until the TTL expires. Fix by deleting the negative entry in the create path (after commit) and keeping its TTL short.

**Bloom filter** of all valid IDs — about 9.6 bits per ID for 1% false positives, so 200M IDs ≈ 240 MB.

- Good against random-ID floods: 99% of bogus lookups stop at the filter.
- A false positive costs one DB read (fine). A **false negative** turns a real item into a 404, which is unacceptable.
- **Create problem:** if the filter is rebuilt nightly, items created today are false negatives. Every create must \`BF.ADD\` (after commit, retried via outbox). Across regions, the filter must replicate as fast as the data. Standard filters cannot delete, so deleted IDs stay "maybe" (harmless) and the FP rate grows past capacity; rebuild periodically or use a scalable or cuckoo filter.

**My default:** validation plus rate limiting first, a short negative cache for repeated misses, and a Bloom filter only when random-ID abuse is real.`,
      followUps: [
        { q: 'Bloom check fails during a Redis outage — what do you do?', a: 'Fail open to the DB path with the normal DB concurrency limit; a filter outage must not turn into 404s for real items.' },
        { q: 'Can you avoid the filter with better IDs?', a: 'Yes — signed or checksummed IDs (for example an HMAC suffix) can be rejected statelessly before any lookup.' },
      ],
      pitfalls: [
        'Believing a Bloom filter has false negatives by design',
        'Negative caching with a TTL of hours',
        'Rebuilding the filter from a snapshot without adding live creates',
      ],
    },
    {
      id: 'misc-caching-redis-iq-14',
      difficulty: 'hard',
      question:
        'Our product search endpoint is cached by query string. A scraper sends 15K RPS of unique, plausible-looking search queries (random word pairs, random filters). Hit ratio for search fell to 4% and Elasticsearch is at 95% CPU. A Bloom filter will not help here. What do you do?',
      whatInterviewerLooksFor: [
        'Recognises open-ended key space: penetration without "non-existent IDs"',
        'Key canonicalisation and bucketing to raise the hit ratio for real users',
        'Per-client admission control and cost-based limits',
        'Protects the backend with concurrency limits and degradation',
        'Bot detection at the edge',
      ],
      modelAnswer: `**Why it is penetration:** every request is a miss that the cache can never absorb, and the key space is unbounded, so neither negative caching (each query is unique) nor a Bloom filter (no finite valid set) helps.

**1. Stop the bleeding at the edge (minutes)**

- WAF/bot rules: known ASNs, missing or forged headers, JA4 TLS fingerprints, and a request rate far above human search behaviour.
- **Per-client quotas on cache misses,** not total requests. A human does perhaps 1 search/s; cap uncached searches per IP, session or API key at ~2/s, and serve 429 or a challenge above that.

**2. Protect Elasticsearch (minutes)**

- Put a **concurrency limit (bulkhead)** on the search backend, for example 200 in flight. Beyond that, degrade: return popular results, or results with filters dropped. Search timeouts ~300 ms with partial results allowed.
- Give logged-in and checkout-adjacent traffic priority over anonymous traffic.

**3. Raise the hit ratio for real users (days)**

- **Canonicalise keys:** lowercase, trim, sort filter params, collapse whitespace, strip tracking params, round price ranges into buckets. Real traffic often jumps from ~40% to 60%+ hit ratio.
- Cache **filtered result IDs** separately from hydrated documents, so different pages and sorts share work.
- Cache at the CDN for anonymous traffic with a short TTL.

**4. Make each miss cheaper**

- Cap result windows (no deep pagination), limit filter combinations, and apply cost-based limits (wildcards, huge terms aggregations).
- Precompute results for the top 10K queries, which usually cover most human traffic.

**Measure:** hit ratio split into human and bot traffic, ES CPU, and misses per client. Success is ES back under 60% with real-user p99 unchanged.`,
      followUps: [
        { q: 'The scraper rotates through 50K residential IPs. Now what?', a: 'Per-IP quotas weaken; lean on behavioural and fingerprint signals, require a session token (issued after a lightweight challenge) for uncached queries, and keep the backend bulkhead so the worst case is degraded search, not an outage.' },
        { q: 'Would caching every query forever help?', a: 'No — unbounded unique keys just evict the useful ones; admit to cache only queries seen at least twice (a TinyLFU-style admission policy).' },
      ],
      pitfalls: [
        'Proposing a Bloom filter or negative caching for free-text queries',
        'Only scaling Elasticsearch',
        'Rate limiting all traffic equally, including cache hits',
      ],
    },
    // ---------- Cache avalanche ----------
    {
      id: 'misc-caching-redis-iq-15',
      difficulty: 'medium',
      question:
        'Your team added ±10% TTL jitter "to prevent cache avalanche". Then a Redis maintenance restart brought the node back empty and the DB fell over anyway. Why did jitter not help, and what actually protects you in that case?',
      whatInterviewerLooksFor: [
        'Separates synchronised expiry from tier loss',
        'Cold restart: every key misses at once regardless of TTL',
        'Replicas / persistence / controlled warm-up / DB admission control',
        'Mentions maintenance procedure (fail over to warm replica, not restart primary)',
      ],
      modelAnswer: `**Why jitter did nothing:** jitter only spreads *expiry times* of keys that exist. A restart without persistence (or with a replica that had to full-resync) empties the cache, so **every** key is a miss at t = 0. That is the "tier loss" flavour of avalanche, and jitter has nothing to spread.

**What protects you**

1. **Maintenance procedure.** Fail over to a warm replica first (\`CLUSTER FAILOVER\` or \`SENTINEL FAILOVER\`), then restart the old primary as a replica. Clients see a sub-second blip and a warm cache.
2. **Persistence for large caches.** An RDB snapshot lets a restarted node load a slightly stale but mostly valid dataset in seconds to minutes. For caches, that trade (disk plus fork cost) is often worth it.
3. **L1 in-process caches** for the hottest few thousand keys, which keep the most expensive traffic off the DB for their TTL.
4. **DB admission control.** A concurrency limit on the miss path (for example 200 in-flight queries per service), queue timeout ~100 ms, and serve degraded or stale beyond that. The DB runs at capacity instead of past it.
5. **Controlled warm-up** after any cold start: warm the top keys by access frequency at a rate the DB tolerates, or ramp traffic weights.

Jitter is still worth keeping for bulk-loaded keys; it is just the answer to a different failure.`,
      followUps: [
        { q: 'Does a replica always come back warm?', a: 'Only if it kept its dataset; a replica that fell out of the backlog does a full resync (RDB transfer) and is unavailable or empty until it finishes.' },
        { q: 'How big should the DB concurrency limit be?', a: 'Around the DB\'s saturation point — cores × a small factor for I/O waits — measured by load test, not guessed.' },
      ],
      pitfalls: [
        'Treating jitter as a complete avalanche defence',
        'Restarting a primary in place for maintenance',
        'A fallback that sends every miss to the DB at full rate',
      ],
    },
    {
      id: 'misc-caching-redis-iq-16',
      difficulty: 'expert',
      question:
        'Our cache and database are both sharded 16 ways on customer_id with the same hash function, so cache shard 7 fronts DB shard 7. It seemed elegant. When cache shard 7 died, DB shard 7 melted while the other 15 were idle. Why, and would you deliberately misalign the sharding?',
      context: 'Inspired by Uber\'s CacheFront engineering blog (2024), which shards Redis on a different key than the database precisely to spread miss load after a cache-cluster loss.',
      whatInterviewerLooksFor: [
        'Correlated failure: aligned sharding concentrates misses on one DB shard',
        'Quantifies the load multiplier',
        'Weighs the cost: locality, multi-key ops, rebalancing',
        'Adds per-shard DB admission control and cache HA',
      ],
      modelAnswer: `**Why shard 7 melted**

With aligned sharding, every key that lived on cache shard 7 belongs to DB shard 7. At a 98% hit ratio, DB shard 7 normally sees 2% of its read traffic. When the cache shard dies, it sees **100% — a 50× jump on one shard**, while the other 15 are unaffected. A cache failure turns straight into a single-shard DB outage. The customers on that shard are down, and retries make it worse.

**Misaligned sharding**

If the cache shards on a different key or hash (for example hash(entity_id) with a different seed, or simply a different shard count), cache shard 7's keys are spread across **all 16 DB shards**. Losing it raises each DB shard's load from 2% to about 2% + 98%/16 ≈ 8% of its traffic, roughly 4× — survivable at normal headroom. Uber's CacheFront describes exactly this reasoning: their Redis is partitioned independently of Docstore's sharding, so a Redis cluster loss spreads across DB shards.

**Costs of misaligning**

- You lose "one customer's data is in one cache shard" locality. Multi-key atomic ops across a customer's entities need hash tags anyway, so use hash tags on entity-level keys, not on customer.
- Two independent topologies to reason about during resharding — acceptable for a cache.

**Other layers I would add regardless**

- Replicas per cache shard with fast failover (so shard loss is seconds, not minutes).
- **Per-DB-shard concurrency limits** on the miss path, with stale-if-error from L1.
- Load tests that kill one cache shard and watch the worst DB shard, not the average.

**Answer:** yes, I would misalign — correlated failure domains are worse than the minor locality benefit.`,
      followUps: [
        { q: 'Is there a case where aligned sharding is right?', a: 'When the cache is a write-behind buffer or co-located on the DB host for locality and you accept correlated failure; for a pure read cache, rarely.' },
        { q: 'How do you validate it in staging?', a: 'Chaos test: kill one cache shard under production-like load and assert that max per-DB-shard CPU stays below a threshold.' },
      ],
      pitfalls: [
        'Only saying "add replicas" without seeing the correlated-failure design flaw',
        'Averaging DB load across shards',
        'Arguing alignment is needed for correctness in a pure cache',
      ],
    },
    // ---------- Hot keys ----------
    {
      id: 'misc-caching-redis-iq-17',
      difficulty: 'medium',
      question: 'How do you find hot keys in a production Redis Cluster before one melts a shard — and which tools are dangerous to run at peak?',
      whatInterviewerLooksFor: [
        'Per-node CPU and ops skew as the first signal',
        'redis-cli --hotkeys requires an LFU policy',
        'Valkey 8 CLUSTER SLOT-STATS, or client-side sampling',
        'Knows MONITOR and KEYS are dangerous',
      ],
      modelAnswer: `**Signals, cheapest first**

1. **Skew dashboards.** Per-node CPU, \`instantaneous_ops_per_sec\` and network out. One node at 3× the median is the tell. A hot key cannot be seen in cluster-wide averages.
2. **Per-slot stats.** Valkey 8+ has \`CLUSTER SLOT-STATS ORDERBY cpu-usec LIMIT 10\`, which gives per-slot CPU, key count and network bytes. That narrows it to a slot, then to its keys.
3. **redis-cli --hotkeys** samples \`OBJECT FREQ\` over a SCAN. It **only works with an LFU maxmemory-policy** (allkeys-lfu or volatile-lfu); otherwise it errors. It walks the keyspace, so run it against a replica.
4. **Client-side sampling.** The SDK or a proxy (Envoy/twemproxy stats) samples 1% of commands into a top-K / count-min sketch and exports "top keys per service". This is the best signal because it includes *which caller* is hot.
5. **--bigkeys / --memkeys** for the related problem: large keys whose every access is expensive.

**Dangerous at peak**

- **MONITOR** streams every command and can cut throughput by half or more.
- **KEYS \\***: an O(N) single-threaded scan.
- **DEBUG OBJECT** and large-key commands on the hot node itself.

Put alerts on per-node skew so you hear about it before customers do.`,
      followUps: [
        { q: 'Why does hotkeys need LFU?', a: 'It reads the per-key LFU access counter (OBJECT FREQ), which is only maintained under an LFU policy; under LRU the object stores idle time instead.' },
        { q: 'Can you switch the policy on a live node?', a: 'Yes with CONFIG SET maxmemory-policy, but counters start from scratch, and eviction behaviour changes — do it deliberately.' },
      ],
      pitfalls: [
        'Running MONITOR on the hot primary',
        'Looking only at cluster-average metrics',
        'Not knowing about the LFU requirement',
      ],
    },
    {
      id: 'misc-caching-redis-iq-18',
      difficulty: 'expert',
      question:
        'A live auction for a celebrity item: the "current highest bid" key receives 80K writes/s of bid attempts plus 300K reads/s in the final minute. Reads we can handle with L1. But key copies and replicas do not help writes. How do you design the write path?',
      whatInterviewerLooksFor: [
        'Recognises the write is a conditional max, not a blind increment',
        'Mergeable sharding (per-shard max) vs single-owner serialisation',
        'Batching and early rejection to shrink contended writes',
        'Correctness: ordering, ties, and the final result from a durable log',
      ],
      modelAnswer: `**What the operation is:** accept a bid only if amount > current max (plus increment rules), then publish the new max. That is a compare-and-set on one value, so 80K CAS/s on a single key saturates one Redis thread. Lua can do ~50–100K simple scripts/s at best, with no headroom.

**Step 1 — shrink the contended stream**

Most attempts are already losing bids. Every API pod keeps the last-known max (pushed via pub/sub, ~50 ms stale) and **rejects bids ≤ max locally**. Near the close, the vast majority of 80K/s are stale or low, so perhaps 5–10K/s reach the authority.

**Step 2 — choose an authority model**

- **Option A — sharded max (mergeable).** "Max" is associative, so split into auction:{id}:max#0..15 on different slots. Each bid goes to a random shard doing a Lua "set if greater"; the true max = MAX over 16 shards, recomputed every 50 ms. The problem: a bid accepted on shard 3 might be lower than a concurrent winner on shard 9. That is fine if "accepted" means "recorded" and the winner is decided later. It is not fine if users expect "you are the highest bidder" instantly.
- **Option B — single-owner sequencer (my choice).** Route all bids for the auction (Kafka partition keyed by auction ID, or a consistent-hash actor) to **one process** holding the max in memory. It processes bids serially — millions per second in memory — **batching** writes: every 10 ms it persists accepted bids to a durable log/DB and SETs the max in Redis once. Redis now sees ~100 writes/s, not 80K.

**Step 3 — correctness**

- The durable bid log (Kafka plus a DB) is the source of truth; Redis holds only the display value.
- Ties are broken by sequencer order (the earliest accepted wins). Idempotency keys handle client retries.
- Anti-sniping (extend the close by 30 s on late bids) removes the incentive for last-second floods.
- The sequencer fails over via partition reassignment, rebuilding state from the log.

**Reads:** L1 per pod with a 100–250 ms TTL, or push the max via WebSocket fan-out.`,
      followUps: [
        { q: 'Why not Redis Cluster with the key replicated?', a: 'Copies are for reads; writes would need to update all copies atomically, multiplying the write load instead of splitting it.' },
        { q: 'What is the latency cost of the sequencer?', a: 'Kafka produce plus consume adds ~5–20 ms, and batching adds up to 10 ms — acceptable for bids, and it buys ordering.' },
      ],
      pitfalls: [
        'Proposing key copies or read replicas for a write-hot key',
        'Sharding a CAS operation without addressing global ordering',
        'Using Redis as the only record of accepted bids',
      ],
    },
    // ---------- Cache warming ----------
    {
      id: 'misc-caching-redis-iq-19',
      difficulty: 'medium',
      question: 'Before a big sale starts at 20:00, the team wants to "warm the cache". What exactly do you warm, when, and how do you make sure the warm-up itself does not cause the incident?',
      whatInterviewerLooksFor: [
        'Warm the hot set (the sale SKUs and the top-N by access), not everything',
        'Timing vs TTL: warm close to the event, with jitter and TTLs longer than the event peak',
        'Rate-limited, read-from-replica warmers',
        'Verification: hit ratio on warmed prefixes',
      ],
      modelAnswer: `**What:** the known sale SKUs (product, price tier and stock-display entries), category and landing pages, plus the top ~50K keys from last week's access sampling. That is usually a small fraction of the keyspace carrying most of the peak traffic. Also warm **L1** in pods (a startup hook, or a preload triggered at 19:55), because a Redis hit still costs a hop at 300K RPS.

**When and how long:** 10–30 minutes before 20:00, with TTLs that comfortably outlast the peak (for example 2 h ± 20% jitter) and SWR soft TTLs so refreshes happen in the background. Warming at 18:00 with a 1 h TTL means everything expires right as the sale opens.

**Guardrails**

- The warmer reads from **DB replicas**, with a concurrency or QPS cap (for example 2K keys/s), and uses pipelines toward Redis.
- It is idempotent and resumable, and it stops at 19:58 whatever happens.
- It does not overwrite keys that are already fresh — use SET NX, or skip if the TTL is above a threshold.
- Watch memory headroom: warming must not push the node into eviction of other hot data.

**Verify:** hit ratio on the sale prefix ≥ 99% at 19:59, and a dry run in the previous week's load test.`,
      followUps: [
        { q: 'Prices change at 20:00 exactly. Can you warm them?', a: 'Warm them under a versioned key (price:v20:<sku>) and flip a single version pointer at 20:00, so the switch is atomic and already warm.' },
        { q: 'What about stock counts?', a: 'Do not rely on warmed stock for correctness; the checkout decrements authoritative stock, and the cache only displays it.' },
      ],
      pitfalls: [
        'Warming the entire catalogue with identical TTLs',
        'Warming directly against the primary DB at full speed',
        'Forgetting in-process L1 caches',
      ],
    },
    {
      id: 'misc-caching-redis-iq-20',
      difficulty: 'hard',
      question:
        'We are migrating our 120 GB cache from a self-managed Redis Cluster to a managed Valkey cluster in the same region. Leadership wants no visible hit-ratio drop and no DB spike. You cannot use REPLICAOF from the old cluster into the managed one. Plan the cutover.',
      whatInterviewerLooksFor: [
        'Lazy double-read (new → old → DB) with write-through to the new cluster',
        'Invalidations applied to both clusters during migration',
        'Hot-set seeding plus a traffic ramp',
        'Clear exit criteria and rollback',
      ],
      modelAnswer: `**Principle:** let the new cluster fill itself from the **old cache, not the DB**, while keeping invalidations correct on both.

**Phase 0 — prep:** size the new cluster (120 GB × ~1.3 overhead, plus replicas), apply the same maxmemory-policy and key formats, and set client timeouts. Add a feature flag that controls the read path per service.

**Phase 1 — dual invalidation (day 1).** Every delete or update from the write path and the CDC invalidator is sent to **both** clusters. Without this, the new cluster fills with values that the old path already invalidated.

**Phase 2 — seed the hot set.** Sample the top ~2M keys by frequency (LFU/hotkeys, or access logs). A throttled job copies them old → new using DUMP/RESTORE, or GET plus SET with the **remaining TTL** (PTTL) preserved, at a capped rate such as 20K keys/s with pipelines. That is roughly 2 minutes.

**Phase 3 — lazy double-read, ramped.** For 5% → 25% → 100% of pods: read new; on a miss read old; on an old hit, write to new (keeping the TTL) and return it; on an old miss go to the DB and write to new only. The DB sees only true misses, the same as before.

**Phase 4 — exit.** When the old-cluster fallback hit rate drops below ~1% (typically after one TTL period, since everything is naturally rewritten), remove the fallback read, then stop dual invalidation and decommission.

**Guardrails:** the extra hop on new-cluster misses adds ~1 ms to perhaps 5% of requests during the ramp. Roll back by flipping the flag, and the old cluster stays correct thanks to dual invalidation. Watch the new cluster's hit ratio, the old-fallback rate, DB QPS and the memory curve.

**Alternative:** if keys are short-TTL (< 10 min), simply dual-write and ramp reads after one TTL — no copy needed.`,
      followUps: [
        { q: 'Why not use a replication tool like RIOT or an online migration feature?', a: 'Good option if supported (some managed services offer online migration from a source Redis); the double-read plan is engine-agnostic and gives per-service rollback.' },
        { q: 'What breaks if you forget dual invalidation?', a: 'The new cluster, filled from the old one or the DB, keeps values the write path deleted only in the old cluster, causing stale reads until TTL — a silent correctness bug.' },
      ],
      pitfalls: [
        'Cold cutover and hoping the DB copes',
        'Copying keys without preserving TTLs (keys never expire)',
        'Forgetting that invalidations must reach both clusters',
      ],
    },
    // ---------- Stale-while-revalidate ----------
    {
      id: 'misc-caching-redis-iq-21',
      difficulty: 'medium',
      question:
        'Explain Cache-Control: max-age=60, stale-while-revalidate=30, stale-if-error=86400 as if I am a frontend engineer, then tell me which of our API responses should never carry stale-while-revalidate.',
      whatInterviewerLooksFor: [
        'Timeline: fresh 0–60 s, stale-served-plus-background-revalidate 60–90 s, blocking after 90 s',
        'stale-if-error semantics',
        'Who implements it (browsers, CDNs, service workers, app caches)',
        'Correctness-sensitive exclusions',
      ],
      modelAnswer: `**Timeline for one cached response**

- **Age 0–60 s:** fresh; served from cache with no origin contact.
- **Age 60–90 s:** stale, but within the SWR window. The cache returns the stale copy **immediately** and revalidates in the background (a conditional request with ETag or If-Modified-Since), so the next user gets a fresh copy.
- **Age > 90 s:** the cache must revalidate before responding; the user waits for the origin.
- **stale-if-error=86400:** if revalidation fails (5xx, timeout, origin unreachable), the cache may serve the stale copy for up to a day instead of an error — graceful degradation for free.

These are RFC 5861 extensions, honoured by modern browsers and most CDNs. Libraries such as SWR/React Query and Next.js ISR apply the same idea in the app.

**Never SWR these:**

- account balances, order status right after payment, stock at checkout;
- auth-dependent responses: entitlements, permissions, anything behind \`Authorization\` in a shared cache (use private, no-store);
- feature kill switches and compliance flags;
- responses to non-idempotent requests.

Rule of thumb: SWR is for data where "30 seconds old" is a product decision, not a bug.`,
      followUps: [
        { q: 'Does SWR reduce origin load?', a: 'Not much in steady state (one revalidation per window), but it removes user-visible latency at expiry and collapses the herd at CDNs that coalesce revalidations.' },
        { q: 'What about stale-if-error for prices?', a: 'Dangerous at checkout but often fine on listing pages; separate the endpoints so policies can differ.' },
      ],
      pitfalls: [
        'Thinking the stale window extends forever',
        'Putting SWR on authenticated responses in a shared cache',
        'Confusing SWR with max-age',
      ],
    },
    {
      id: 'misc-caching-redis-iq-22',
      difficulty: 'hard',
      question:
        'You implemented stale-while-revalidate in Redis for exchange-rate snapshots used on product pages (soft TTL 60 s, hard TTL 30 min). Three weeks later someone notices product pages showed 25-minute-old rates during a provider outage and nobody was alerted. Also, Redis CPU spikes every minute. Review the design and fix both issues.',
      whatInterviewerLooksFor: [
        'Staleness must be observable: age metric and alerting',
        'Decides per consumer what staleness is acceptable (hard TTL as a business decision)',
        'Refresh dedupe and jitter to kill the per-minute spike',
        'Refresh failures need backoff and a circuit breaker',
      ],
      modelAnswer: `**Issue 1 — silent 25-minute staleness**

SWR did its job (stale-if-error), but staleness was invisible.

- **Emit data age** (now − fetchedAt) as a metric on every read. Alert when p50 age > 3× the soft TTL for 5 minutes, or on refresh failure rate > 50%.
- **Make the hard TTL a business decision.** For display-only rates, 30 minutes might be fine *with* a UI hint ("rates as of 14:02"). For anything that sets a charged price, the checkout path must bypass SWR and fetch or verify a fresh rate — or refuse.
- **Add backoff on refresh failures.** A failing provider currently gets a refresh attempt from the first stale reader every few seconds. Use a circuit breaker, so the provider is probed every 10–30 s rather than hammered.

**Issue 2 — CPU spike every minute**

Probable causes, all visible in code review:

- **No refresh dedupe.** Every pod (or every request) that sees soft-expiry triggers a refresh, so 50 pods × N requests fire refreshes at the same second. Fix: \`SET refresh:<key> 1 NX EX 10\` so one refresher runs cluster-wide, and in-pod single-flight.
- **Aligned soft expiries.** All currency pairs were fetched together, so all soft-expire together. Add ±15% jitter to softExpiry.
- **Large values rewritten wholesale.** One 300 KB snapshot of all rates is rewritten and parsed by every reader. Split per currency, or keep the blob but serve it from L1 for 1–5 s to cut Redis GETs by pod count.

**Resulting design**

- Entry = {value, fetchedAt, softExpiry}, with Redis TTL = hard TTL.
- One deduped, jittered, circuit-broken refresher.
- L1 in front; age metrics and alerts.
- Better still for a small global dataset: a scheduled job refreshes rates every 30 s and readers never trigger fetches. SWR then remains only as a fallback.`,
      followUps: [
        { q: 'Should the soft TTL shrink when the value changes often?', a: 'Adaptive refresh is possible (shorter soft TTL for volatile pairs), but first ask whether consumers need it — each halving doubles provider calls.' },
        { q: 'How do you test stale-if-error?', a: 'Fault injection against the provider client in staging, asserting that pages keep rendering, age metrics climb and alerts fire.' },
      ],
      pitfalls: [
        'Treating stale-if-error as success without alerting',
        'Letting every stale read trigger a refresh',
        'Using SWR data for charged prices',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'misc-caching-redis-boe-1',
      question:
        'A partition isolates one Redis Cluster primary. How many acknowledged writes can be lost for its slots with cluster-node-timeout 15 s vs 5 s, and with min-replicas-to-write enabled?',
      assumptions: [
        'That shard takes 24K writes/s overall; 30% of clients end up on the minority side with the isolated primary',
        'Replication lag is normally < 5 ms; the isolated primary loses its replica at the moment of the partition',
        'min-replicas-max-lag = 10 s when enabled (replica pings the primary every 1 s)',
      ],
      steps: [
        { label: 'Minority-side write rate', calc: '24K/s × 30% ≈ 7.2K writes/s still reaching the isolated primary' },
        { label: 'Loss window, node-timeout 15 s', calc: 'primary stops writes after ~15 s → 7.2K × 15 ≈ 108K acknowledged writes discarded on heal' },
        { label: 'Loss window, node-timeout 5 s', calc: '7.2K × 5 ≈ 36K writes (and the majority side fails over ~10 s sooner)' },
        { label: 'With min-replicas-to-write 1, max-lag 10', calc: 'primary refuses writes once the replica ack is > 10 s old → ≤ 10 s window; in practice min(node-timeout, max-lag) ≈ 5–10 s → 36K–72K' },
        { label: 'Majority-side impact', calc: '70% of clients × 24K = 16.8K writes/s fail or queue for node-timeout + ~1–2 s election ≈ 6–17 s' },
      ],
      answer:
        'Roughly 100K acknowledged writes can vanish with default settings; 5 s node-timeout or min-replicas-to-write cuts this to a few tens of thousands — never to zero.',
      insight:
        'The loss window is set by timeouts, not by fsync, so Redis is fine for rebuildable data (caches, sessions with re-login) but not as the only store for money or orders. Lowering node-timeout trades loss for false-failover risk on GC or network jitter.',
      followUps: [
        {
          "q": "Leadership asks whether WAIT 1 100 after each write would make the data safe. What does it cost and what does it still not guarantee?",
          "a": "`WAIT 1 100` blocks the client until at least one replica acknowledges the write, up to 100 ms. Cost: each write gains a replica round trip (about 0.5–1 ms in-AZ, more cross-AZ), so 24K writes/s needs many more concurrent connections, and during replica trouble writes slow to the 100 ms timeout. Guarantees still missing: WAIT returning 0 replicas after the timeout doesn't roll back the write, failover can still promote a replica that missed it, and replicas acknowledge receipt, not fsync. It shrinks the loss window but doesn't make Redis a consensus store. Use a real database for money."
        }
      ],
    },
    {
      id: 'misc-caching-redis-boe-2',
      question:
        'Estimate the background refresh load on the pricing DB for 2M cached quotes with a plain 10-minute TTL vs stale-while-revalidate (soft TTL 5 min, hard 30 min), given skewed access.',
      assumptions: [
        '2M distinct keys; the top 100K keys get 80% of 40K RPS; the remaining 1.9M keys are read on average once per 20 minutes',
        'One recompute ≈ 300 ms of DB time; DB budget for cache refills ≈ 1,500 recomputes/s',
        'Hard-TTL expiry for plain TTL is uniform thanks to jitter',
      ],
      steps: [
        { label: 'Plain TTL: hot keys', calc: '100K keys re-miss every 600 s → 167 recomputes/s (each blocks a user request)' },
        { label: 'Plain TTL: long tail', calc: 'long-tail key read every 20 min > 10 min TTL → almost every read misses: 1.9M ÷ 1,200 s ≈ 1,580 recomputes/s' },
        { label: 'Plain TTL total', calc: '≈ 1,750 recomputes/s > 1,500 budget → DB saturated at steady state' },
        { label: 'SWR: hot keys', calc: 'refresh once per soft TTL: 100K ÷ 300 s ≈ 333 background refreshes/s (users never wait)' },
        { label: 'SWR: long tail', calc: 'hard TTL 30 min > 20 min read interval → most reads hit (stale OK) and trigger one refresh: ≈ 1.9M ÷ 1,200 s ≈ 1,580/s — unchanged unless refresh is skipped for cold keys' },
        { label: 'SWR + refresh only if read count ≥ 2 per soft window', calc: 'long tail refreshes drop to ~0; misses only after 30 min: 1.9M ÷ 1,800 s ≈ 1,050/s at worst; total ≈ 1,400/s' },
      ],
      answer:
        'Plain TTL needs ~1,750 recomputes/s (over budget). SWR alone moves hot-key latency off the user path but not the long-tail load; SWR plus "refresh only popular keys, let cold keys hard-expire" brings it to ~1,400/s, within budget.',
      insight:
        'SWR is a latency tool for hot keys; for the long tail, what drives DB load is the ratio of TTL to read interval. Tune TTLs per popularity tier (or admit only keys read more than once) instead of a single global TTL.',
      followUps: [
        {
          "q": "Traffic doubles to 80K RPS but the key distribution stays the same. Which recompute numbers change, and do you stay within budget?",
          "a": "Hot-key SWR refreshes stay at about 333/s: they're bounded by key count ÷ soft TTL, independent of read rate, which is the beauty of SWR. The long tail changes: each cold key is now read about every 10 minutes instead of 20, so with a 30-minute hard TTL more of them stay cached; hard-expiry misses become about 1.9M ÷ 1,800 s ≈ 1,050/s at most, and the 'popular enough to refresh' threshold admits more keys. Total stays around 1,400–1,600/s, near the 1,500 budget. Doubling traffic barely moves DB load; key count and TTLs dominate."
        }
      ],
    },
    {
      id: 'misc-caching-redis-boe-3',
      question:
        'How long does it take to warm a new cache cluster from the database for a 50M-key catalogue, and how much does warming only the hot set change that?',
      assumptions: [
        '50M keys, 2 KB average value; the DB can spare 5K reads/s for warming without hurting production',
        'Access is Zipf-like: the top 2.5M keys (5%) serve 85% of reads',
        'Warmer pipelines Redis writes, so Redis is not the bottleneck (~100K SET/s per shard)',
      ],
      steps: [
        { label: 'Full warm from DB', calc: '50M ÷ 5K/s = 10,000 s ≈ 2.8 h' },
        { label: 'Memory for full warm', calc: '50M × (2 KB + ~100 B overhead) ≈ 105 GB → ~8 shards of 16 GB usable' },
        { label: 'Hot-set warm', calc: '2.5M ÷ 5K/s = 500 s ≈ 8 min' },
        { label: 'Hit ratio right after hot-set warm', calc: '≈ 85% (rest fills lazily); misses = 15% × 40K RPS = 6K/s → need DB capacity for 6K/s for the first TTL period' },
        { label: 'Copy from old cache instead of DB', calc: 'DUMP/RESTORE at ~50K keys/s → full 50M in ~1,000 s ≈ 17 min, zero DB load' },
      ],
      answer:
        'A full DB-driven warm takes ~3 hours; warming the top 5% takes ~8 minutes and gets ~85% hit ratio; copying from an existing cache takes ~17 minutes with no DB cost.',
      insight:
        'Warm by popularity, not by completeness, and warm from another cache whenever one exists. The DB spare capacity, not Redis, bounds how fast you can warm — size it explicitly in the migration plan.',
      followUps: [
        {
          "q": "The DB can spare only 1K reads/s, and the old cluster is already gone. What's your plan to get to an acceptable hit ratio before peak?",
          "a": "At 1K reads/s, the top 2.5M keys take about 42 minutes, so warm only the top ~600K keys first (10 minutes, maybe 60–65% of reads with Zipf skew), then continue down the list. Use read replicas if any exist, since each adds spare capacity. Shift traffic gradually so lazy fills (with single-flight) add organically. During the warm window, protect the DB with a miss-path concurrency limit and serve degraded responses beyond it. For next time, keep periodic RDB snapshots of the cache in S3, so a restore takes minutes without touching the DB."
        }
      ],
    },
    {
      id: 'misc-caching-redis-boe-4',
      question:
        'With Sentinel managing a session store, estimate the failed requests per unplanned failover and how many failovers per month fit a 99.95% availability SLO for the session-dependent API.',
      assumptions: [
        'down-after-milliseconds = 5,000; election + promotion + reconfig ≈ 2 s; client rediscovery + reconnect ≈ 1 s',
        'API at 12K RPS; every request reads the session; client command timeout 100 ms, no retry during the gap',
        '30-day month',
      ],
      steps: [
        { label: 'Unavailability per failover', calc: '5 s detect + 2 s promote + 1 s reconnect ≈ 8 s' },
        { label: 'Failed requests per failover', calc: '12K RPS × 8 s ≈ 96K failed requests' },
        { label: 'Monthly error budget at 99.95%', calc: '0.05% × 30 × 86,400 s ≈ 1,296 s ≈ 21.6 min' },
        { label: 'Failovers affordable', calc: '1,296 s ÷ 8 s ≈ 162 failovers — Sentinel is not the budget risk' },
        { label: 'With default down-after 30 s', calc: '30 + 2 + 1 = 33 s → 396K failed requests per event; still ~39 events/month' },
        { label: 'The real risk', calc: 'a flapping or split-brain event that also drops sessions → mass re-login; and clients stuck on READONLY for minutes' },
      ],
      answer:
        '~8 s and ~96K failed requests per failover with tuned timeouts; the SLO tolerates well over 100 such events, so the priority is client reconnection behaviour and session loss, not failover speed.',
      insight:
        'Failover time is dominated by detection (down-after), which you tune against false positives. The bigger availability lever is the client: rediscover via sentinels, reconnect on READONLY, and fall back to re-issuing sessions rather than failing requests.',
      followUps: [
        {
          "q": "False failovers from GC pauses or network jitter happen twice a day at down-after 5 s. What's the cost, and how would you tune it?",
          "a": "Each false failover costs about 8 s of errors (96K failed requests) plus possible lost writes from the demoted primary and a burst of reconnects. Twice a day is about 60 per month, roughly 480 s of the 1,296 s budget, which is a large chunk for no real failure. Tune: find the cause (latency monitor, slowlog, host steal time), fix the pauses, and raise down-after to 10–15 s, trading slower real failovers for far fewer false ones. Also add client-side retry with a short timeout for idempotent session reads, so a few seconds of failover is invisible."
        }
      ],
    },
  ],
  test: [
    // ---------- Caching ----------
    {
      id: 'misc-caching-redis-mcq-01',
      difficulty: 'hard',
      question:
        'An API has a cache hit latency of 1 ms and a miss latency of 40 ms. After adding Redis, the hit ratio is 95%. p50 dropped from 40 ms to 1 ms, but p99 is still ~40 ms. The team is confused. What is the best explanation?',
      options: [
        'With 5% misses, the 99th percentile request is a miss, so p99 equals the miss-path latency until the miss rate is below 1%.',
        'Redis adds tail latency from its single-threaded event loop, so p99 cannot go below the DB latency.',
        'The p99 is dominated by serialization of cached values, which scales with value size rather than hit ratio.',
        'Averages hide improvements; p99 always lags p50 improvements by one TTL period.',
      ],
      correct: [0],
      explanation:
        'Percentiles rank requests: if 5% are misses at 40 ms, everything above the 95th percentile is a miss, so p99 ≈ 40 ms. Only when misses fall below 1% (or the miss path gets faster) does p99 move. Redis single-threading adds microseconds, not 40 ms; serialization could matter for huge values but does not explain a p99 exactly equal to the miss path; there is no "TTL lag" effect on percentiles.',
      followUps: [
        {
          "q": "Product wants p99 under 10 ms for this endpoint. Raising the hit ratio to 99.5% is unrealistic. What other levers move p99?",
          "a": "Make the miss path faster or take it off the request path. Options: stale-while-revalidate, so expired-but-present entries return in 1 ms while refreshing in the background, which turns most 'misses' into hits; refresh-ahead for hot keys before they expire; precompute or denormalise the miss query so it costs 5–10 ms instead of 40 ms; serve a cheaper partial response on miss and fill the rest asynchronously. Also check what the 5% misses are: if many are cold one-off keys (the long tail), they may never benefit from caching, and only a faster miss path helps."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-02',
      difficulty: 'expert',
      question: 'This cache-key builder is used for a product-listing endpoint. Select ALL problems it causes.',
      code: {
        language: 'typescript',
        code: `function cacheKey(req: { tenantId: string; locale: string; query: Record<string, unknown> }) {
  // query comes straight from the URL: ?sort=price&page=1&utm_source=ad&color=red
  return 'listing:' + JSON.stringify(req.query);
}`,
      },
      options: [
        'Different tenants and locales share entries, so users can see another tenant\'s or language\'s listing.',
        'Semantically identical queries with parameters in a different order produce different keys and lower the hit ratio.',
        'Tracking parameters like utm_source fragment the cache into near-duplicate entries.',
        'JSON.stringify output is non-deterministic across Node processes for the same object, so pods cannot share entries.',
        'Keys longer than 64 bytes are rejected by Redis, so long queries fail to cache.',
      ],
      correct: [0, 1, 2],
      explanation:
        'The key omits tenantId and locale (a data-leak bug), preserves insertion order so ?a=1&b=2 and ?b=2&a=1 differ, and includes irrelevant tracking params. Canonicalise: include tenant and locale, whitelist and sort params. JSON.stringify is deterministic for the same insertion order — the problem is order differences between requests, not processes; Redis keys can be up to 512 MB, although short keys are better for memory.',
      followUps: [
        {
          "q": "Write the canonical key builder. How do you keep the parameter whitelist from silently going out of date when the endpoint adds a new filter?",
          "a": "Build the key as `v3:listing:{tenant}:{locale}:` plus a sorted, whitelisted, normalised query (lowercase enums, trimmed strings, default values filled in), hashed with SHA-1 if long. Declare the whitelist next to the endpoint's DTO, ideally derived from the same validation schema (class-validator or zod), so adding a filter to the schema adds it to the key automatically. Add a test that sends two requests differing only in each declared parameter and asserts the keys differ, plus one with `utm_*` that asserts the key is unchanged. Bump the version prefix when the key format changes."
        }
      ],
    },
    // ---------- Redis ----------
    {
      id: 'misc-caching-redis-mcq-03',
      difficulty: 'hard',
      question:
        'Session keys were created with a 30-minute TTL, yet memory keeps growing and many sessions show TTL -1. Given this code, which line is responsible?',
      code: {
        language: 'typescript',
        code: `async function login(id: string, data: Session) {
  await redis.set(\`sess:\${id}\`, JSON.stringify(data), 'EX', 1800); // (A)
}
async function touch(id: string) {
  await redis.expire(\`sess:\${id}\`, 1800);                          // (B)
}
async function updateCart(id: string, data: Session) {
  await redis.set(\`sess:\${id}\`, JSON.stringify(data));             // (C)
}
async function countView(id: string) {
  await redis.incr(\`views:\${id}\`);                                   // (D)
}`,
      },
      options: [
        '(A), because EX is overridden by the default maxmemory-policy.',
        '(B), because EXPIRE on an existing key resets the TTL to -1 if the key was modified.',
        '(C), because a plain SET replaces the value and discards the existing TTL.',
        '(D), because INCR on a session-adjacent key clears TTLs on keys with the same prefix.',
      ],
      correct: [2],
      explanation:
        'SET without EX/PX/KEEPTTL overwrites the key and removes its TTL, so every session that had its cart updated becomes immortal. Fix with SET ... KEEPTTL (Redis 6+) or SET ... EX 1800. EXPIRE sets a new TTL, it does not clear one; maxmemory-policy has no effect on EX; INCR preserves the TTL of its own key and never touches other keys (views:* without a TTL is a separate issue).',
      followUps: [
        {
          "q": "Thousands of immortal session keys already exist. How do you clean them up safely in production?",
          "a": "Run a background script that iterates with `SCAN 0 MATCH sess:* COUNT 1000` (per primary in a cluster), checks `TTL` in a pipeline, and for keys returning -1 sets `EXPIRE key 1800` (or a remaining-lifetime estimate from a stored `lastSeen` field). Avoid `KEYS`, which blocks. Throttle it (a few thousand keys per second) to keep latency flat. Deploy the KEEPTTL fix first, so no new immortal keys appear during cleanup. Afterwards, alert on the count of keys without TTL using a periodic sampled scan, and consider `volatile-lru` eviction for the session database so memory pressure can't evict TTL-less critical keys unexpectedly."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-04',
      difficulty: 'expert',
      question:
        'A Lua script that recalculates a leaderboard loops over 400K ZSET members. While it runs, all clients get "BUSY Redis is busy running a script". An engineer runs SCRIPT KILL and it fails with UNKILLABLE. What happened, and what is the right recovery and fix?',
      options: [
        'The script already performed a write, so SCRIPT KILL cannot roll it back; the only recovery is SHUTDOWN NOSAVE (losing data since the last persistence point). Fix: move the loop out of Lua into batched, incremental commands.',
        'SCRIPT KILL needs the script SHA; pass the SHA and it will stop. Fix: raise busy-reply-threshold so clients wait instead of erroring.',
        'Scripts are killable only on replicas; fail over and kill it there. Fix: run heavy scripts on replicas with READONLY.',
        'The script is blocked on network I/O to another shard, which SCRIPT KILL cannot interrupt. Fix: use hash tags so all keys are local.',
      ],
      correct: [0],
      explanation:
        'Redis scripts are atomic; once a script has written, killing it would leave partial effects, so Redis refuses (UNKILLABLE) and only SHUTDOWN NOSAVE is left. Long loops belong in client-side incremental work (ZSCAN, batches) or a background job. SCRIPT KILL takes no SHA; raising busy-reply-threshold only delays the BUSY error; replicas do not run write scripts; and scripts cannot make network calls to other shards.',
      followUps: [
        {
          "q": "Rewrite the leaderboard recalculation so it can't block Redis. What does the new design look like?",
          "a": "Move the computation out of Lua. A worker reads members incrementally with `ZSCAN` (or `ZRANGE` by index in pages of 1,000), computes new scores in the application, and writes them in pipelined `ZADD` batches to a new key `leaderboard:v2:tmp`. When done, it `RENAME`s that atomically over the live key. Each batch takes microseconds of Redis time, so other clients interleave freely, and readers see either the old or the new board, never a half-built one. Even better, update scores incrementally on each event with `ZINCRBY` so no full recalculation is needed. Set `busy-reply-threshold` alerts and code-review Lua for unbounded loops."
        }
      ],
    },
    // ---------- Redis Cluster ----------
    {
      id: 'misc-caching-redis-mcq-05',
      difficulty: 'expert',
      question: 'In Redis Cluster, which of these keys are guaranteed to hash to the SAME slot as the key {user:42}:cart? Select ALL that apply.',
      code: {
        language: 'text',
        code: `(1) {user:42}:profile
(2) user:{42}:cart
(3) {user:42}{orders}
(4) {}user:42:cart
(5) orders:{user:42}`,
      },
      options: [
        '(1) {user:42}:profile',
        '(2) user:{42}:cart',
        '(3) {user:42}{orders}',
        '(4) {}user:42:cart',
        '(5) orders:{user:42}',
      ],
      correct: [0, 2, 4],
      explanation:
        'The hashed part is the substring between the first { and the next }, provided it is non-empty. (1), (3) and (5) all hash "user:42" — only the first tag counts in (3), and position in the key does not matter in (5). (2) hashes "42", a different string. (4) has empty braces {}, so the WHOLE key is hashed. Teams mixing {user:42} and user:{42} conventions get CROSSSLOT errors in MULTI and Lua.',
      followUps: [
        {
          "q": "A user with 10M followers makes {user:42} a huge, hot slot. How do you keep co-location for multi-key operations without a hot shard?",
          "a": "Co-locate only what must be atomic together, not everything about the user. Keep the cart and profile under `{user:42}`, but shard the follower set itself across many keys (`followers:42:{0..63}`, each with its own hash tag or none), so it spreads over all primaries. Fan-out reads aggregate across shards. For hot reads, add an L1 cache or replica reads. Monitor slot memory and ops with `CLUSTER SLOT-STATS` (Valkey 8) or `CLUSTER COUNTKEYSINSLOT` to spot big slots early. Whatever the tagging scheme, a slot can't be split across nodes, so a single tag must never cover unbounded data."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-06',
      difficulty: 'hard',
      question:
        'To "avoid CROSSSLOT errors forever", a developer prefixes every key in the rate-limiter service with the hash tag {rl}. What happens as traffic grows on a 12-primary cluster?',
      options: [
        'All rate-limiter keys map to one slot on one primary, which becomes a hot shard capped at single-node throughput while the other 11 idle.',
        'Redis rebalances the {rl} slot across primaries automatically once it exceeds a size threshold.',
        'Nothing changes; hash tags only affect multi-key commands, and single-key commands are still distributed.',
        'Writes are fine but reads fail with MOVED, because tagged keys can only be read from replicas.',
      ],
      correct: [0],
      explanation:
        'A hash tag makes every key hash to CRC16("rl") mod 16384 — one slot, on one primary. That node carries all the load and memory. Redis never splits a slot across nodes. Hash tags affect routing for every command, not only multi-key ones, and have nothing to do with replica reads. Tag at the entity level ({user:42}) instead.',
      followUps: [
        {
          "q": "The rate limiter needs atomic multi-key updates (per-user and per-tenant counters together). How do you design keys without the {rl} hot shard?",
          "a": "Tag by the entity that needs atomicity: `{u:123}:rl:min` and `{u:123}:rl:hour` in one slot, so the Lua script can update both atomically per user. For the per-tenant counter, either accept a second round trip (check the user limit atomically, then the tenant limit atomically in its own `{t:9}` slot), or use a local approximate tenant limit with periodic sync. Users spread across all 16,384 slots evenly. Avoid a single global counter; if you need a global cap, shard it into N sub-counters and sum them periodically."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-07',
      difficulty: 'expert',
      question:
        'A 6-shard Redis Cluster serves as a cache with default settings. Shard 4\'s primary and its only replica are both lost in the same AZ outage. What happens, and what setting would have limited the blast radius?',
      options: [
        'The whole cluster returns CLUSTERDOWN for every key, because cluster-require-full-coverage defaults to yes; setting it to no keeps the other ~83% of slots serving.',
        'Only keys in shard 4\'s slots fail; the rest continue, because Redis Cluster isolates failures per shard by default.',
        'The other primaries automatically take over shard 4\'s slots with empty data after cluster-node-timeout.',
        'The cluster stays up but becomes read-only until an operator runs CLUSTER FAILOVER FORCE on any replica.',
      ],
      correct: [0],
      explanation:
        'With cluster-require-full-coverage yes (the default), a node stops accepting queries if any slot is uncovered, so a single shard loss becomes a total outage. For a cache, set it to no (and consider cluster-allow-reads-when-down) so only 1/6 of keys miss. Slots are never auto-reassigned to other primaries without an operator, and a forced failover needs a replica of that shard, which no longer exists.',
      followUps: [
        {
          "q": "With full-coverage off, shard 4's keys now miss and hit the DB. Is a sixth of traffic missing a problem, and how would you contain it?",
          "a": "Possibly. If the cache serves 120K reads/s at 95% hits, losing a sixth adds about 20K reads/s to the DB, which may exceed its spare capacity. Contain it: put a concurrency limit or token bucket on the miss path per pod, so excess misses get degraded responses instead of DB queries; use single-flight to collapse duplicate misses; and add a per-pod L1 cache for hot keys. Restore capacity quickly: replace the shard with a new primary and replica (an empty cache) and let it warm. Spread replicas across AZs, so one AZ outage can't take both copies of a shard."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-08',
      difficulty: 'hard',
      question:
        'Your ioredis Cluster client uses scaleReads: "slave" to offload reads. Which issues should you expect? Select ALL that apply.',
      options: [
        'Read-your-writes violations: a user updates a profile and immediately reads the old value from a lagging replica.',
        'After a replica is promoted during failover, the client must refresh its slot map, briefly sending some reads to the wrong node (MOVED).',
        'Replicas reject reads unless the connection has sent READONLY, which the cluster client handles for you.',
        'Writes are also routed to replicas and fail with READONLY errors.',
        'Replica reads bypass the key-slot mechanism, so hash tags stop working.',
      ],
      correct: [0, 1, 2],
      explanation:
        'Replication is async, so replica reads can be stale (a read-your-writes problem); failovers change roles and trigger map refreshes and redirects; and a cluster replica only serves reads on connections in READONLY mode, which ioredis sets when scaleReads is not "master". Writes still go to primaries, and replicas serve the same slots, so hash tags are unaffected.',
      followUps: [
        {
          "q": "You want replica reads for scale but read-your-writes for the user who just wrote. How do you get both?",
          "a": "Route by recency of the user's write. After a user writes, record a marker (cookie or session field `lastWriteAt`, or the primary's replication offset). For the next few seconds (longer than typical replica lag, say 2 s), route that user's reads to the primary; everyone else reads from replicas. More precisely, Redis's `WAIT numreplicas timeout` after a write makes it synchronous enough that a replica read will see it, at the cost of write latency. Monitor `master_repl_offset` minus replica offset to know actual lag, and stop replica reads if lag spikes."
        }
      ],
    },
    // ---------- Redis Sentinel ----------
    {
      id: 'misc-caching-redis-mcq-09',
      difficulty: 'expert',
      question:
        'You run 5 sentinels with quorum 2. A partition leaves 2 sentinels able to see the primary as down, and 3 sentinels on the other side that still see it as healthy. What happens?',
      options: [
        'The 2 sentinels mark the primary ODOWN (quorum reached) but cannot win a leader election, which needs 3 of 5 votes, so no failover happens.',
        'The 2 sentinels reach quorum and immediately promote a replica, creating two primaries.',
        'Nothing happens, because ODOWN requires a majority of sentinels (3), not the quorum value.',
        'The 3 healthy sentinels veto the ODOWN state and reset the primary to SDOWN for failover-timeout.',
      ],
      correct: [0],
      explanation:
        'Quorum only controls reaching ODOWN; performing the failover requires a leader authorised by a majority of all sentinels (3 of 5). So the 2 sentinels agree the primary is down but cannot act — this is what prevents minority-side failovers. ODOWN itself needs only quorum agreement, and there is no veto mechanism.',
      followUps: [
        {
          "q": "Where would you physically place the 5 sentinels across 3 AZs, and why not quorum 2 with 3 sentinels?",
          "a": "Place them 2-2-1 across three AZs, ideally not on the same hosts as Redis nodes, so losing any one AZ leaves at least 3 of 5 for a majority leader election. With 3 sentinels (1 per AZ) you also tolerate one AZ loss, but a single additional sentinel failure blocks failover. Quorum 2 with 3 sentinels is fine for detection; the majority rule (2 of 3) still governs authorisation. The worst layout is all sentinels on the app or primary side of a likely partition: then a minority side can't fail over, but neither can the majority if it lacks sentinels."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-10',
      difficulty: 'hard',
      question:
        'After a Sentinel failover, some NestJS pods get "READONLY You can\'t write against a read only replica" for many minutes. The client is configured as below. What is the best fix?',
      code: {
        language: 'typescript',
        code: `const redis = new Redis({
  host: 'redis-0.redis.svc.cluster.local', // was the primary at deploy time
  port: 6379,
  maxRetriesPerRequest: 2,
});`,
      },
      options: [
        'Configure ioredis with sentinels and the master group name so it discovers the primary, and add reconnectOnError that returns 2 on READONLY errors.',
        'Increase maxRetriesPerRequest to 20 so writes eventually succeed after the failover completes.',
        'Lower down-after-milliseconds so failovers finish faster and the READONLY window shrinks.',
        'Point the client at a Kubernetes Service for all Redis pods so connections are load-balanced across them.',
      ],
      correct: [0],
      explanation:
        'The pods hold long-lived connections to the demoted node, which now rejects writes. Sentinel-aware configuration rediscovers the current primary on every reconnect, and reconnectOnError returning 2 reconnects and resends the failed command. Retrying against the same replica never succeeds; faster failover does not move existing connections; load-balancing across primary and replicas makes write failures random rather than fixing them.',
      followUps: [
        {
          "q": "How would you verify in staging that this client config survives a failover without minutes of READONLY errors?",
          "a": "Run a write load (for example 2K SET/s from several pods) and trigger `SENTINEL FAILOVER mymaster`, then also kill the primary with `docker kill` or a network partition. Measure: error count and its duration (it should be roughly down-after plus promotion time, a few seconds), confirm no READONLY errors persist after the new primary is announced, and check that connections moved (`CLIENT LIST` on the old primary shows the app pods gone). Repeat with the old primary coming back as a replica. Automate it as a nightly chaos test; client library upgrades often regress this behaviour."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-11',
      difficulty: 'expert',
      question:
        'A Sentinel-managed primary with one replica has min-replicas-to-write 1 and min-replicas-max-lag 10. The primary is partitioned with a few clients; the majority side promotes the replica 7 s later. Select ALL correct statements.',
      options: [
        'The isolated primary keeps accepting writes until it has no replica ack newer than ~10 s, then rejects writes with NOREPLICAS.',
        'Writes accepted by the isolated primary during that window are discarded when it rejoins as a replica.',
        'min-replicas-to-write makes each write synchronous, so accepted writes are always on the replica.',
        'If the replica is merely restarting (no partition), writes are also rejected once its ack is older than 10 s.',
        'The setting guarantees that the old and new primaries never both accept writes.',
      ],
      correct: [0, 1, 3],
      explanation:
        'The primary checks how many replicas have acknowledged within max-lag seconds; once the count drops below 1, it refuses writes (NOREPLICAS). Writes in the window before that are lost on rejoin, and the same rule hits planned replica restarts — a trade-off. It does not make replication synchronous, and for a few seconds both primaries may accept writes; it only bounds the window.',
      followUps: [
        {
          "q": "The session store can lose a few seconds of writes in a partition. What does that mean for users, and how do you design around it?",
          "a": "Lost writes mean a few users lose a recent session change: a just-created session disappears (they log in again) or a session update reverts (cart change, preference). That's tolerable for sessions if the app handles a missing session gracefully by re-authenticating, not with a 500. For anything that must not be lost, such as orders or payment state, write to the database and treat Redis only as a cache of it. Signed, stateless tokens (JWT with refresh in the DB) reduce dependence on Redis for login state altogether."
        }
      ],
    },
    // ---------- Cache stampede ----------
    {
      id: 'misc-caching-redis-mcq-12',
      difficulty: 'hard',
      question:
        'This per-pod single-flight wrapper is used for a hot configuration key. After a 2-second DB blip, that key returns errors on this pod until the pod restarts. Why?',
      code: {
        language: 'typescript',
        code: `const inflight = new Map<string, Promise<Config>>();

export function getConfig(key: string): Promise<Config> {
  if (!inflight.has(key)) {
    const p = loadFromCacheOrDb(key).then((v) => {
      inflight.delete(key);
      return v;
    });
    inflight.set(key, p);
  }
  return inflight.get(key)!;
}`,
      },
      options: [
        'The rejected promise is never removed from the map because delete only runs on success, so every later call returns the same rejection.',
        'Map lookups are not atomic in Node, so two concurrent callers corrupt the entry during the blip.',
        'The promise resolves to a stale config forever because delete runs before the value is returned.',
        'Unhandled rejections crash the event loop, and the pod keeps a broken Map after the crash.',
      ],
      correct: [0],
      explanation:
        'On failure the .then callback does not run, so the rejected promise stays in the map and every caller receives it. Use .finally(() => inflight.delete(key)) so the entry is cleared on both outcomes. Node is single-threaded, so the Map is not corrupted by concurrency; delete before return is harmless; and a crash would restart the process, clearing the Map.',
      followUps: [
        {
          "q": "With .finally fixed, the DB is down for 30 s. Every request on the pod now creates a new failing load. How do you avoid hammering the DB while it recovers?",
          "a": "Add short-lived failure memory. Cache the error briefly: on rejection, keep a 'failed until t+1 s' marker for that key so callers in the next second get the error (or the last good value) without a new DB call, then let one caller try again. Serve the last known good config from memory if available, since config rarely changes, so a DB outage becomes a stale config rather than errors. Combine with a circuit breaker on the DB client and exponential backoff on retries. The goal: at most about one probe per key per pod per second during an outage."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-13',
      difficulty: 'expert',
      question:
        'A stampede lock uses SET lock:k NX PX 3000. The recompute takes 2 s at p50 and 6 s at p99 under load, and release is a plain DEL. Select ALL outcomes you should expect under load.',
      options: [
        'For slow recomputes, the lock expires mid-work and a second pod starts the same recompute, so the DB sees duplicate expensive queries.',
        'The first pod\'s DEL can delete the second pod\'s lock, letting a third pod start — the herd grows during exactly the slow periods.',
        'Waiters polling for the value keep missing until the slowest recompute finishes, lengthening tail latency.',
        'Redis serialises SET NX so strictly that only one recompute can ever run, whatever the TTL.',
      ],
      correct: [0, 1, 2],
      explanation:
        'A TTL below the p99 recompute time lets the lock lapse, so duplicate work begins exactly when the DB is slowest. A plain DEL removes whoever holds the lock now (use a token and compare-and-delete in Lua), and waiters keep waiting or polling. SET NX is atomic, but it guarantees mutual exclusion only while the key exists — expiry breaks it.',
      followUps: [
        {
          "q": "Fix the lock correctly. What TTL do you choose, and what if a recompute legitimately takes longer than any reasonable TTL?",
          "a": "Use a random token: `SET lock:k <token> NX PX 10000`, and release with Lua that deletes only if the value equals the token. Set the TTL above p99.9 recompute time (6 s p99, so 10 s). For longer or unpredictable work, renew the lease: a watchdog extends the TTL every TTL/3 while work progresses (again only if the token matches). If renewal fails, abort and don't write the result. Even then, treat it as an efficiency lock, not a correctness lock: duplicate recomputes must be harmless, so writes should be idempotent or version-checked."
        }
      ],
    },
    // ---------- Cache penetration ----------
    {
      id: 'misc-caching-redis-mcq-14',
      difficulty: 'medium',
      question:
        'To fight penetration, "not found" results are cached for 1 hour. Sellers now complain that newly listed products show "not found" for a long time after creation. What is the best fix?',
      options: [
        'Shorten the negative TTL to ~60 s and delete the negative entry in the product-create path after commit.',
        'Remove negative caching and rely on the DB, because negative caching is incompatible with inserts.',
        'Keep the 1-hour TTL but add a Bloom filter in front, so new products bypass the negative cache.',
        'Switch the eviction policy to volatile-lru so negative entries are evicted first.',
      ],
      correct: [0],
      explanation:
        'Negative entries must be short-lived and invalidated when the thing they deny starts to exist. Deleting on create (after commit, retried via outbox or CDC) fixes read-after-create; a short TTL bounds any missed invalidation. Removing negative caching reopens penetration; a Bloom filter says "maybe exists" for new items, but the stale negative entry would still be read first unless the order is changed; the eviction policy does not target specific entries.',
      followUps: [
        {
          "q": "The create-path invalidation sometimes fails because Redis is briefly unreachable. How do you make it reliable?",
          "a": "Don't do it inline as best effort. Write an outbox row in the product-create transaction (or rely on CDC from the products table) and have a worker delete `neg:product:<id>` with retries until it succeeds. The 60 s negative TTL bounds the damage if even that fails. Alternatively, don't negative-cache specific ids at all for recently created ranges: if product ids are monotonic, skip negative caching for ids above the latest known max id. Add a monitoring check: create a canary product every few minutes and assert it's readable within seconds."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-15',
      difficulty: 'hard',
      question:
        'A RedisBloom filter of valid order IDs was created with BF.RESERVE orders 0.01 100000000 (100M capacity, 1% FP) two years ago. There are now 260M orders, and every create does BF.ADD. Select ALL that are true.',
      options: [
        'By default, RedisBloom has stacked additional sub-filters as capacity was exceeded, so memory grew beyond the original allocation.',
        'A BF.EXISTS may now have to check several sub-filters, so lookups cost more than when the filter was created.',
        'Real orders can now be reported as "definitely not present" because the filter is over capacity.',
        'Re-creating the filter with capacity sized for growth (for example 400M) restores single-layer lookups and predictable memory.',
        'BF.DEL can be used to remove cancelled orders to bring the count back under capacity.',
      ],
      correct: [0, 1, 3],
      explanation:
        'RedisBloom filters scale by default (EXPANSION 2 unless NONSCALING): exceeding capacity adds sub-filters (each with a tighter error rate), which grows memory and means a lookup may probe every layer. False negatives still do not happen for added items. Rebuilding with a capacity sized for growth returns to one layer. Standard Bloom filters, including BF.*, have no delete (use a cuckoo filter, CF.DEL, if you need removals).',
      followUps: [
        {
          "q": "Rebuilding a 400M-capacity filter takes time while traffic flows. How do you swap it without a window of false negatives?",
          "a": "Build the new filter under a new key (`orders:bf:v2`) with `BF.RESERVE` at the larger capacity. Dual-write: every create does `BF.ADD` to both the old and new filters from now on. A backfill job streams all existing order ids from the DB (or a replica) into v2 with pipelined `BF.MADD`. When the backfill reaches the point where dual-writing began, v2 contains everything; switch reads to v2 via a config flag and drop v1. Size memory first: 400M items at 1% is about 480 MB. Run the backfill on a replica-fed path to avoid primary DB load."
        }
      ],
    },
    // ---------- Cache avalanche ----------
    {
      id: 'misc-caching-redis-mcq-16',
      difficulty: 'hard',
      question:
        'A nightly import SETs 3M product keys between 02:00 and 02:05 with this TTL function. At 03:00 the DB spikes badly. What is the most accurate diagnosis?',
      code: {
        language: 'typescript',
        code: `const ttl = () => 3600 + Math.floor(Math.random() * 30); // "jitter"`,
      },
      options: [
        'The jitter is a fixed 30 s on a 1 h TTL, so 3M keys still expire within ~5.5 minutes (~9K/s); jitter should be proportional (for example ±10–20% of TTL).',
        'Math.random is seeded identically on every pod, so all keys get the same TTL.',
        'Redis ignores TTLs below 1 hour for keys written in a pipeline, so they expire together.',
        'The issue is Redis active expiry running once per hour, which removes all expired keys at 03:00.',
      ],
      correct: [0],
      explanation:
        'Keys were written over 5 minutes, and 0–30 s of jitter barely widens that window, so ~3M expiries land between 03:00 and 03:05:30. Proportional jitter of ±10% spreads them over ~12 minutes, and SWR or refresh-ahead removes the user-visible misses. V8 seeds Math.random per process; Redis honours any TTL; and active expiry runs about 10 times per second, not hourly.',
      followUps: [
        {
          "q": "Proportional jitter spreads expiries over 12 minutes, but these are 3M keys all refreshed nightly anyway. Is TTL even the right mechanism here?",
          "a": "Probably not. If the import refreshes every key every night, expiry-based refill is redundant: the DB spike comes from readers reloading keys that the import would have rewritten anyway. Better: give keys a TTL longer than the import period (say 26 hours) so they never expire between imports, and have the import overwrite values directly, a write-through refresh. Use expiry only as a safety net for products removed from the catalog. Then no DB spike happens at all, and values change exactly when the source data changes."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-17',
      difficulty: 'expert',
      question:
        'You fail traffic over from region A to region B, whose Redis cache has been serving only 10% of traffic and is mostly cold for A\'s users. Which measures reduce the resulting avalanche? Select ALL that apply.',
      options: [
        'Continuously warm B by replaying A\'s cache write keys as reads in B (so values come from B\'s own DB), as Uber CacheFront does.',
        'Shift traffic in steps (10% → 30% → 60% → 100%) while watching B\'s DB, rather than flipping all at once.',
        'Put a concurrency limit on B\'s cache-miss path and serve degraded responses beyond it.',
        'Copy A\'s RDB snapshot into B at failover time and load it, since A\'s values are always valid in B.',
        'Double every TTL in B at failover time so keys stay longer.',
      ],
      correct: [0, 1, 2],
      explanation:
        'Keeping B warm ahead of time, ramping traffic and bounding the DB miss load all address a cold-cache avalanche. Loading A\'s snapshot at failover is slow for large datasets, may be impossible if A is impaired, and can hold values inconsistent with B\'s replica of the DB. Longer TTLs do nothing for keys that are not in the cache yet.',
      followUps: [
        {
          "q": "How do you know region B's cache is warm enough to take 100% of traffic? What metric gates each ramp step?",
          "a": "Gate on B's measured state, not time. Before each step, check B's cache hit ratio on A-like traffic (with continuous warming it should be within a few points of A's), B's DB CPU and connection headroom against the projected miss rate at the next step (miss rate × projected RPS must be under DB capacity with margin), and B's p99 latency and error rate at the current step for 5–10 minutes. Automate it: the traffic controller only advances from 30% to 60% if hits are at least 90% and DB CPU is under 60%. Keep the ramp reversible."
        }
      ],
    },
    // ---------- Hot keys ----------
    {
      id: 'misc-caching-redis-mcq-18',
      difficulty: 'medium',
      question:
        'An on-call engineer runs redis-cli --hotkeys against a production cluster node and gets an error. The node uses maxmemory-policy allkeys-lru. What is the reason?',
      options: [
        '--hotkeys relies on per-key LFU access counters (OBJECT FREQ), which exist only with an LFU maxmemory-policy.',
        '--hotkeys only works on replicas, never on primaries.',
        '--hotkeys requires MONITOR permissions, which are disabled in cluster mode.',
        '--hotkeys needs the node to have no TTLs set, because it uses the expires dictionary.',
      ],
      correct: [0],
      explanation:
        'The hotkeys scan reads OBJECT FREQ, which is only available under allkeys-lfu or volatile-lfu; under LRU policies the object stores idle time, and the command errors. Alternatives: switch the policy deliberately, use Valkey 8 CLUSTER SLOT-STATS, or sample in the client. It can run on any node (preferably a replica), does not use MONITOR, and has nothing to do with TTLs.',
      followUps: [
        {
          "q": "You can't change the eviction policy in production just to find hot keys. What else do you use?",
          "a": "Options that don't need LFU: Valkey 8+ `CLUSTER SLOT-STATS` shows per-slot CPU, key count and network bytes, which narrows a hot spot to a slot. `redis-cli --bigkeys` and `--memkeys` find large keys (often correlated with heat). Client-side sampling: instrument the Redis client to log or sample 1% of commands with key names and aggregate top-N in your metrics system, which costs nothing on Redis. Short `MONITOR` sessions on a replica (seconds only, as it's expensive) or a packet-capture tool like redis-faina give exact counts. Combine slot stats to find the shard with client sampling to name the key."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-19',
      difficulty: 'hard',
      question:
        'A hot product key gets 240K reads/s from 300 pods. You add a per-pod L1 cache with a 2 s TTL and in-pod single-flight. Roughly what read rate reaches Redis for that key, and what is the trade-off?',
      options: [
        '~150 reads/s (300 pods ÷ 2 s); users may see data up to ~2 s staler than Redis, and invalidations do not reach L1.',
        '~120K reads/s, since L1 only halves traffic when the TTL is 2 s.',
        '~300 reads/s, one per pod per second regardless of TTL; there is no staleness because L1 is refreshed synchronously.',
        '~2.4K reads/s (1% of traffic); the trade-off is higher memory on Redis.',
      ],
      correct: [0],
      explanation:
        'With single-flight, each pod fetches the key once per TTL: 300 pods / 2 s = 150 reads/s. That is independent of the request rate. The cost is up to ~2 s of extra staleness per pod (plus inconsistency between pods), and L1 is not reached by Redis deletes unless you add broadcast invalidation or CLIENT TRACKING. The other options misapply the TTL or confuse the load reduction with a hit percentage.',
      followUps: [
        {
          "q": "The product's price changes and must be visible within 1 s, not 2 s. Can you keep L1 and still meet that?",
          "a": "Yes, with push invalidation. Use Redis client-side caching (`CLIENT TRACKING` in broadcast mode with a prefix like `product:`): when the key changes, Redis sends invalidation messages to every subscribed pod, which evicts its L1 entry. Or publish an invalidation on a pub/sub channel after each write. Keep the 2 s TTL as a safety net if a message is lost, for example on reconnect (flush L1 on reconnect). Staleness then drops to roughly network delay, tens of milliseconds, in the normal case, while Redis read load stays around 150/s plus one refill per change per pod."
        }
      ],
    },
    // ---------- Cache warming ----------
    {
      id: 'misc-caching-redis-mcq-20',
      difficulty: 'hard',
      question:
        'During a cache migration, you use this lazy double-read to warm the new cluster. Select ALL bugs it introduces.',
      code: {
        language: 'typescript',
        code: `async function get(key: string) {
  const v = await newCache.get(key);
  if (v) return v;
  const old = await oldCache.get(key);
  if (old) {
    await newCache.set(key, old);        // copy into the new cluster
    return old;
  }
  const fresh = await db.load(key);
  await newCache.set(key, fresh, 'EX', 600);
  return fresh;
}
// write path elsewhere: await oldCache.del(key) after each DB commit`,
      },
      options: [
        'Keys copied from the old cache have no TTL in the new cluster, so they never expire and can stay stale forever.',
        'Invalidations only hit the old cache, so a value copied into the new cluster survives updates to the DB.',
        'A DB load returning null is cached as the string "null" or throws, depending on client serialisation, because there is no not-found handling.',
        'Reading the old cache on every new-cache miss doubles the DB load during migration.',
      ],
      correct: [0, 1, 2],
      explanation:
        'Copying without the remaining TTL (PTTL) makes keys immortal; invalidating only the old cluster leaves the new one stale after updates; and there is no handling for not-found results. The old-cache read hits Redis, not the DB — it reduces DB load compared with a cold cutover.',
      followUps: [
        {
          "q": "Fix the double-read. What does the corrected migration flow look like end to end?",
          "a": "Read new; on miss, read old with `PTTL`; if found, `SET` in new with `PX` equal to the remaining TTL. If not found, load from the DB with not-found handling (negative cache with a short TTL), and write to new. During migration, invalidations must hit both clusters: delete in both on every write, via the same outbox worker. Track the fraction of reads served by fallback to the old cluster. When it drops near zero (or after the longest TTL has passed), stop reading old, then decommission it. Optionally run a background DUMP/RESTORE copy of hot keys to speed it up."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-21',
      difficulty: 'medium',
      question:
        'After a full cache outage, a recovery job warms the top 1M keys by querying the primary Postgres as fast as possible with 64 parallel workers. What is the most likely side effect, and the right adjustment?',
      options: [
        'The warmer competes with recovering production traffic and can overload the DB; cap its rate, read from a replica and prioritise the hottest keys first.',
        'Redis rejects writes faster than about 1K SET/s from one client, so the warmer mainly stalls; use more workers.',
        'The warmed keys all get LRU-evicted immediately because they have not been read yet; warm with allkeys-random instead.',
        'Postgres caches the queries, so the second half of the warm is free; no adjustment is needed.',
      ],
      correct: [0],
      explanation:
        'A warmer is just another DB client. Running it unthrottled on the primary during recovery can cause the very overload it was meant to prevent. Throttle it, use replicas, and warm in popularity order. Redis easily absorbs 100K+ SET/s with pipelining; fresh keys are not evicted first under LRU (their access time is recent); and Postgres has no query-result cache.',
      followUps: [
        {
          "q": "How do you decide which 1M keys are 'the hottest' after a full outage when the cache is empty and has no stats?",
          "a": "Use access data that lives outside the cache. Sources: a periodic snapshot of hot keys exported before the outage (for example hourly top-N from LFU counters or client sampling written to S3); CDN or API access logs from the last day aggregated by resource id; or business signals such as today's best sellers, active campaigns and logged-in users' recent items. Warm in that order, rate-limited. Keep the hot-key export as a scheduled job precisely so recovery has a list ready. Everything else fills lazily from real traffic with single-flight."
        }
      ],
    },
    // ---------- Stale-while-revalidate ----------
    {
      id: 'misc-caching-redis-mcq-22',
      difficulty: 'medium',
      question:
        'A CDN caches a response with Cache-Control: max-age=60, stale-while-revalidate=30. The origin is healthy. The next request arrives at age 75 s, and another at age 100 s with no refresh in between. What does each user experience?',
      options: [
        'At 75 s the user gets the stale copy immediately while the CDN revalidates in the background; at 100 s the user waits for a synchronous revalidation.',
        'Both users get the stale copy immediately, because stale-while-revalidate extends freshness indefinitely while the origin is healthy.',
        'Both users wait for the origin, because a response older than max-age is never served.',
        'At 75 s the user waits for revalidation; at 100 s the stale copy is served under stale-if-error.',
      ],
      correct: [0],
      explanation:
        'Between max-age and max-age + SWR (60–90 s), a stale copy is served and refreshed asynchronously. Beyond 90 s the cache must revalidate before responding. In the question no refresh happened, so at 100 s the user waits. SWR does not extend freshness indefinitely, stale copies are allowed within the window, and stale-if-error applies only when the origin errors, which is not the case here.',
      followUps: [
        {
          "q": "The origin goes down at age 100 s and the response has stale-if-error=86400. What does the user see now, and what can go wrong?",
          "a": "The CDN tries to revalidate, the origin errors (5xx or connection failure), and because the age is within the stale-if-error window, the CDN serves the stale copy with no error to the user. Risks: users may see day-old data without knowing, which is fine for a catalog but bad for prices or stock; and some CDNs only apply stale-if-error to specific error codes or need it enabled in config, so verify the behaviour. Also, if the cached object was evicted for space, there is nothing to serve. Monitor the stale-served rate as an incident signal."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-23',
      difficulty: 'expert',
      question:
        'This application-level SWR runs on 60 pods for a key read 10K times/s. Every minute, the upstream API sees ~several thousand refresh calls in one second. Select ALL changes that fix it.',
      code: {
        language: 'typescript',
        code: `async function read(key: string) {
  const e = JSON.parse((await redis.get(key))!);   // { v, softExpiry }
  if (Date.now() > e.softExpiry) {
    void refresh(key);                            // fire-and-forget
  }
  return e.v;
}`,
      },
      options: [
        'Take a short cluster-wide refresh lock (SET refresh:key 1 NX EX 10) before calling refresh, so one pod refreshes.',
        'Add in-pod single-flight around refresh so concurrent requests on the same pod share one refresh.',
        'Replace "void refresh(key)" with "await refresh(key)" so that refreshes happen synchronously and in order.',
        'Add jitter to softExpiry when writing, so keys that were refreshed together do not become stale together.',
        'Lower the soft TTL so each refresh has less to do.',
      ],
      correct: [0, 1, 3],
      explanation:
        'Every read after the soft expiry fires a refresh — thousands in the first second — so dedupe across pods (NX lock) and within a pod (single-flight), and jitter soft expiries so multiple keys do not align. Awaiting the refresh makes every stale reader wait, which removes the point of SWR and still does not dedupe. A lower soft TTL increases refresh frequency.',
      followUps: [
        {
          "q": "The refresh lock is held by a pod that crashes mid-refresh. What happens to the key, and is that acceptable?",
          "a": "The `refresh:key` lock expires after its 10 s EX. Until then other pods see the lock and keep serving the stale value without refreshing, so the key stays stale for up to 10 s longer than planned, then the next reader takes the lock and refreshes. Since the value is still within its hard TTL, users see slightly older data, which SWR explicitly tolerates. Keep the lock TTL a bit above the refresh's p99 duration. If the refresh repeatedly fails, the key ages toward the hard TTL, so alert on value age above the soft TTL plus a margin."
        }
      ],
    },
    {
      id: 'misc-caching-redis-mcq-24',
      difficulty: 'hard',
      question:
        'Which of these data would you put behind application-level stale-while-revalidate with a 5-minute soft TTL? Select ALL that apply.',
      options: [
        'Product review summaries shown on product pages.',
        'Currency exchange rates displayed on listing pages (checkout re-fetches the rate).',
        'A user\'s remaining API quota used to decide whether to accept a request.',
        'Permission grants checked before allowing an admin to delete data.',
        'A trending-hashtags list refreshed from an analytics job.',
      ],
      correct: [0, 1, 4],
      explanation:
        'Review summaries, display-only exchange rates (with checkout verifying freshly) and trending lists tolerate minutes of staleness, and benefit from never blocking on recompute. Quotas and permission grants are decision data: serving a 5-minute-old value lets users exceed limits or keep access after revocation, so they need a fresh or strongly consistent read.',
      followUps: [
        {
          "q": "Permission grants are read on every request and the DB can't take that load. How do you cache them without the 5-minute revocation hole?",
          "a": "Cache with explicit invalidation plus a short bound. Store grants in Redis or L1 with a TTL of, say, 30–60 s, and on every grant change publish an invalidation (outbox to pub/sub, or bump a per-user `permVersion` that's checked cheaply). Or embed a version in the session or token and compare it with a small, frequently read `perm_version:<user>` key. For high-risk actions (delete data, transfer money), re-check against the source of truth regardless of cache. The cache absorbs routine reads, and revocation becomes effective within milliseconds in the normal case."
        }
      ],
    },
  ],
};

export default topic;
