import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-advanced',
  phase: 'designs',
  order: 7,
  title: 'Advanced: Leaderboard, Stock Exchange, Distributed Cache, Global Rate Limiter, Search Engine/Typeahead, Ad Serving, Recommendation System & Multi-tenant SaaS',
  subtitle:
    'Eight senior/staff-level case studies, each crisp but deep: Redis sorted-set leaderboards, a microsecond matching engine, a sharded cache tier, rate limiting across regions, typeahead and web search, real-time ad auctions, multi-stage recommenders, and tenant isolation in SaaS.',
  estimatedMinutes: 170,
  sources: [
    'Alex Xu & Sahn Lam — System Design Interview Vol 2, Ch 10 Real-time Gaming Leaderboard',
    'Alex Xu & Sahn Lam — System Design Interview Vol 2, Ch 13 Stock Exchange',
    'Alex Xu — System Design Interview Vol 1, Ch 4 Rate Limiter, Ch 13 Search Autocomplete',
    'Nishtala et al. — Scaling Memcache at Facebook (NSDI 2013)',
    'Covington et al. — Deep Neural Networks for YouTube Recommendations (RecSys 2016)',
    'AWS SaaS Lens / SaaS Tenant Isolation Strategies whitepaper',
    'LMAX Disruptor technical paper',
  ],
  tags: ['leaderboard', 'redis-zset', 'stock-exchange', 'matching-engine', 'distributed-cache', 'rate-limiter', 'typeahead', 'search-engine', 'ad-serving', 'recommendation', 'multi-tenant', 'saas'],
  cheatSheet: [
    'Leaderboard: Redis ZSET (skip list + hash) gives ZINCRBY / ZREVRANK / ZREVRANGE in O(log n); 25M users ≈ 650 MB in one monthly key. Break ties by encoding score*2^k + (MAX_TS - ts).',
    'Leaderboard at 500M DAU: fixed score-range shards give global rank = local rank + count in higher shards; hash shards need scatter-gather top-K and cannot give exact rank cheaply.',
    'Exchange: gateway → order manager (risk, balance) → sequencer (stamps ids, total order) → single-threaded matching engine per symbol → market data + reporter. Everything is event-sourced from the sequenced log.',
    'Order book: map price → level (FIFO doubly linked list), map orderId → node for O(1) cancel, best bid/ask pointers; price-time priority. Low latency = one box, pinned threads, mmap ring buffers, no locks, no GC on the hot path.',
    'Distributed cache: consistent hashing with ~100–200 vnodes/node (client-side) or Redis Cluster 16,384 slots (MOVED/ASK). Hot keys: L1 in-process cache + key replication (key#1..#N); memcache leases stop herds and stale sets.',
    'Global rate limiter: a strict global counter costs a cross-region RTT per request; instead run local token buckets that lease quota in batches from a regional/global store and sync asynchronously, accepting ~1–5% overshoot.',
    'Typeahead: trie with top-k cached at each node → O(prefix length) lookups; rebuild offline from aggregated query logs (weekly + trending stream), shard by prefix, cache aggressively in browser/CDN.',
    'Web search: crawler (URL frontier, politeness, dedup) → indexer (inverted index, posting lists) → doc-partitioned shards → scatter-gather with tiered indexes; rank = BM25 relevance + PageRank/quality + learned re-ranking.',
    'Ad serving in <100 ms: targeting index retrieval → pCTR model → auction on eCPM = bid × pCTR (GSP / second price) → budget pacing → impression/click logging with dedup and fraud filtering.',
    'Recommender: candidate generation (two-tower embeddings + ANN, co-visitation) → ranking (feature store, GBDT/DNN) → re-rank (diversity, freshness, business rules). Multi-tenant SaaS: silo vs pool vs bridge; enforce tenant_id everywhere (RLS), fight noisy neighbours with quotas and cells.',
  ],
  sections: [
    {
      heading: 'Real-time gaming leaderboard (1/2): requirements, estimation and Redis sorted sets',
      body: `**Scope (Ch 10):** a mobile game's monthly tournament. Show the **top 10** players, show a user's own **rank**, and optionally the players ranked ±4 around them. The score updates in real time when a match is won, and the leaderboard resets monthly.

**Estimation (Ch 10):** 5M DAU, 25M MAU. If each player plays 10 matches/day: score updates ≈ 5M × 10 ÷ 10^5 ≈ **500 QPS**, and peak at 5× ≈ **2,500 QPS**. Top-10 fetches happen about once per user session, ≈ 50 QPS.

**Why not SQL?** \`SELECT … ORDER BY score DESC LIMIT 10\` is fine with an index, but **"what is my rank?"** needs \`SELECT COUNT(*) WHERE score > my_score\`, which is an O(n) scan over millions of rows per request. Recomputing ranks on each update doesn't work either.

**Redis sorted set (ZSET):** internally a **hash table** (member → score) plus a **skip list** ordered by score with span counts. That gives:

| Command | Purpose | Cost |
|---|---|---|
| ZINCRBY lb:2026-09 1 user42 | a win adds 1 point | O(log n) |
| ZREVRANGE lb:2026-09 0 9 WITHSCORES | top 10 | O(log n + 10) |
| ZREVRANK lb:2026-09 user42 | my rank (0-based) | O(log n) |
| ZREVRANGE lb:2026-09 r-4 r+4 | neighbours | O(log n + 9) |

**Memory:** 25M entries × (~24-byte id + 8-byte score + skip-list/hash overhead) ≈ 25M × ~100 B ≈ **2.5 GB** realistically. The book's lower bound of 26 bytes per entry gives ~650 MB. Either way it fits on one Redis node, and 2,500 writes/s is trivial next to Redis's ~100K ops/s.

**Durability:** Redis is not the source of truth for match results. Persist every score event in MySQL/DynamoDB (\`point(user_id, match_id, ts)\`) so the ZSET can be rebuilt after a failure, and use a Redis replica with AOF for fast recovery. User profiles (name, avatar) for the top 10 come from a user DB or cache.`,
      code: [
        {
          language: 'typescript',
          title: 'Leaderboard service with ioredis',
          code: `import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL!);

const key = (d = new Date()) => 'lb:' + d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');

// Called by the game service AFTER the match result is validated server-side
// and persisted, so clients can never set their own score.
export async function recordWin(userId: string, matchId: string): Promise<void> {
  // Idempotency: a retried "match finished" event must not add points twice
  const fresh = await redis.set('match:' + matchId + ':' + userId, '1', 'EX', 86400 * 40, 'NX');
  if (!fresh) return;
  await redis.zincrby(key(), 1, userId);
}

export async function top10() {
  const flat = await redis.zrevrange(key(), 0, 9, 'WITHSCORES');
  const out: { userId: string; score: number; rank: number }[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ userId: flat[i], score: Number(flat[i + 1]), rank: i / 2 + 1 });
  return out;
}

export async function myRankWithNeighbours(userId: string) {
  const r = await redis.zrevrank(key(), userId);
  if (r === null) return null;                          // hasn't played this month
  const from = Math.max(0, r - 4);
  const around = await redis.zrevrange(key(), from, r + 4, 'WITHSCORES');
  return { rank: r + 1, around };
}`,
        },
      ],
      keyPoints: [
        '2,500 peak updates/s and ~25M members fits one Redis node.',
        'ZSET = hash + skip list: rank queries in O(log n); SQL rank is O(n).',
        'Monthly key per tournament; old keys archived, then expired.',
        'Persist score events elsewhere; Redis is a rebuildable index.',
      ],
      source: 'Alex Xu Vol 2 — Ch 10 Real-time Gaming Leaderboard',
    },
    {
      heading: 'Real-time gaming leaderboard (2/2): ties, sharding to 500M DAU and alternatives',
      body: `**Ties.** Redis orders equal scores lexicographically by member, which isn't fair. To rank "who reached the score first" higher, encode a composite score. A double has 53 bits of exact integer precision, so use \`score * 2^32 + (2^32 - 1 - secondsSinceMonthStart)\`. Higher points win, and among equal points the earlier achiever wins. That supports up to 2^21 ≈ 2M points, which is plenty for match wins.

**Scaling to 500M DAU (100× more): about 250K updates/s and ~2.5B members (~100–250 GB).** One node can't hold that. Two sharding options (Ch 10):

| | Fixed partition by score range | Hash partition (Redis Cluster) |
|---|---|---|
| Layout | shard 1: scores 1–100, shard 2: 101–200… | hash(user) → one of 16,384 slots |
| Top 10 | read the highest shard only | **scatter-gather**: top 10 from every shard, merge |
| My rank | local rank + sum(ZCARD of all higher shards) | no cheap exact answer (needs a count on every shard) |
| Score update | may **move** a user between shards (remove + add); keep a user→shard map | stays on one shard |
| Balance | uneven, so size ranges from the score distribution and rebalance | even |

Ch 10 prefers **fixed score ranges** because rank queries are the product. For "top K across shards" with hash sharding, fetch the top K from each of N shards and merge. Latency is bounded by the slowest shard, and deep pagination gets expensive.

**Approximate rank at huge scale:** "You're in the top 3%" can come from a **score histogram** (percentiles) rather than an exact rank, which is often all the product needs.

**NoSQL alternative (DynamoDB):** partition key = \`game#month#shard\`, sort key = score. Write-shard the hot month partition into N suffixes, then query each suffix's top 10 and merge. That's the same scatter-gather idea. Exact rank is again hard.

**Other variants interviewers ask for:** per-region and friends-only boards (friends: fetch the friend list's scores via ZMSCORE and sort client-side, since friend lists are small), and daily/weekly boards (one key per window, or ZUNIONSTORE of daily keys).`,
      code: [
        {
          language: 'lua',
          title: 'Tie-breaking composite score (earlier achiever ranks higher)',
          code: `-- KEYS[1] = leaderboard key, ARGV[1] = userId, ARGV[2] = points to add
-- ARGV[3] = seconds since tournament start (server-provided)
-- composite = points * 2^32 + (2^32 - 1 - t). 53-bit double precision => points < 2^21
local SHIFT = 4294967296
local cur = tonumber(redis.call('ZSCORE', KEYS[1], ARGV[1]) or '0')
local points = math.floor(cur / SHIFT) + tonumber(ARGV[2])
local t = tonumber(ARGV[3])
local composite = points * SHIFT + (SHIFT - 1 - t)
redis.call('ZADD', KEYS[1], composite, ARGV[1])
return points`,
        },
      ],
      keyPoints: [
        'Composite scores break ties deterministically within 53-bit precision.',
        'Score-range shards make rank cheap; hash shards make top-K scatter-gather.',
        'Percentile ranks from histograms when exact rank isn\'t needed.',
        'Friends leaderboard: small set, compute on read.',
      ],
      source: 'Alex Xu Vol 2 — Ch 10 (scaling Redis, alternative NoSQL solution)',
    },
    {
      heading: 'Stock exchange (1/3): requirements, estimation and the sequenced architecture',
      body: `**Scope (Ch 13):** an exchange (not a broker) for **100 symbols** with **1 billion orders/day**, trading 9:30–16:00 (6.5 h). It supports limit orders, cancellation, real-time market data (order book depth and candlesticks), risk checks (e.g. max 1M shares/day per user), and wallet checks (sufficient funds). Non-functional: **99.99% availability**, **ms-level (ideally µs) latency with a tight p99**, fairness and determinism.

**Estimation:** 1B ÷ 23,400 s ≈ **43,000 orders/s**, and peak at 5× ≈ **215,000 orders/s**, concentrated at the open and close.

**Architecture: three flows**
1. **Trading flow (critical path):** broker → **client gateway** (auth, validation, rate limit) → **order manager** (risk check, wallet funds hold, order state) → **sequencer** (stamps a monotonically increasing sequence id on every inbound order) → **matching engine** (per symbol, deterministic) → sequencer (stamps outbound executions) → order manager → gateway → broker.
2. **Market data flow:** executions and book changes → **market data publisher** → candlesticks and L1/L2 depth → data service → brokers.
3. **Reporting flow (off the critical path):** reporter → trade and settlement DB, regulatory reports.

**Why a sequencer?** It gives every event a **total order**. Then (a) the matching engine is a deterministic state machine over a sequenced input, (b) any replica or restarted engine replays the same sequence to reach the same state, and (c) gaps in sequence ids are detectable. It's the event log at the heart of **event sourcing** here.

**Determinism is the design principle:** the same input sequence must produce the same output sequence, which enables hot-warm failover, audit and replay.`,
      diagram: `Brokers (FIX)
   │
   ▼
Client gateway ── auth, validate, rate limit, (colo: µs)
   │
   ▼
Order manager ── risk checks, wallet hold, order state
   │
   ▼
Sequencer (in) ── seq id, total order, event log (mmap)
   │
   ▼
Matching engine (per symbol, single thread, order book)
   │ executions / book deltas
   ▼
Sequencer (out) ──► Order manager ──► gateway ──► broker
   │
   ├──► Market data publisher ──► L1/L2/candles ──► brokers
   └──► Reporter ──► trade DB, settlement, regulators (async)`,
      keyPoints: [
        '1B orders/day → ~43K/s average, ~215K/s peak.',
        'The critical path is gateway → order manager → sequencer → matching engine.',
        'The sequencer makes inputs totally ordered, so matching is a replayable state machine.',
        'Market data and reporting are off the critical path.',
      ],
      source: 'Alex Xu Vol 2 — Ch 13 Stock Exchange',
    },
    {
      heading: 'Stock exchange (2/3): the order book and price-time matching',
      body: `**Intuition:** for each symbol there are two queues of waiting orders. Buyers are sorted by highest price first, and sellers by lowest price first. At each price, orders wait in arrival order. A new order that crosses the spread trades against the best opposite orders until it's filled or no price matches. Whatever remains rests in the book.

**Data structure (Ch 13):**
- For each side, a sorted map **price → PriceLevel** (a tree map, or an array indexed by tick when the price range is bounded).
- **PriceLevel** = a **doubly linked list** of orders (FIFO) plus total volume.
- **orderId → node** hash map, so **cancel is O(1)**: unlink the node without scanning the level.
- Cached **best bid / best ask** pointers so the top of book is O(1).

Operation costs: add at an existing level is O(1). Add at a new level is O(log P) with a tree, or O(1) with a tick-indexed array. Cancel is O(1). Match is O(1) per fill.

**Price-time priority (FIFO):** among orders at the best price, the earliest (lowest sequence id) fills first. Other algorithms exist (pro-rata in some futures markets), but FIFO is the interview default.

**Market data levels:** L1 = best bid/ask and last trade. L2 = aggregated volume per price level (depth). L3 = every individual order. Candlesticks (OHLCV per interval) are computed by the market data publisher from executions.

**Correctness details interviewers probe:** use integer prices (ticks) and quantities, never floats. Self-trade prevention. A partial fill keeps the remainder's time priority. Reducing an order's quantity keeps its priority, while increasing it or changing its price loses priority (it's cancel/replace).`,
      code: [
        {
          language: 'typescript',
          title: 'Price-time priority order book (one side shown in full)',
          code: `type Side = 'BUY' | 'SELL';
interface Order { id: string; side: Side; price: number; qty: number; seq: number; prev?: Order; next?: Order; level?: Level }
interface Level { price: number; head?: Order; tail?: Order; volume: number }
interface Fill { makerId: string; takerId: string; price: number; qty: number }

export class OrderBook {
  private bids = new Map<number, Level>();     // in production: tick-indexed array or red-black tree
  private asks = new Map<number, Level>();
  private byId = new Map<string, Order>();     // O(1) cancel

  private best(side: Side): Level | undefined {
    const book = side === 'BUY' ? this.bids : this.asks;
    let bestLvl: Level | undefined;
    for (const l of book.values()) if (l.volume > 0 && (!bestLvl || (side === 'BUY' ? l.price > bestLvl.price : l.price < bestLvl.price))) bestLvl = l;
    return bestLvl;                            // O(P) here for brevity; cache best pointers in production
  }

  submit(o: Order): Fill[] {
    const fills: Fill[] = [];
    const opp: Side = o.side === 'BUY' ? 'SELL' : 'BUY';
    let lvl = this.best(opp);
    // Match while the incoming order crosses the best opposite price
    while (o.qty > 0 && lvl && (o.side === 'BUY' ? o.price >= lvl.price : o.price <= lvl.price)) {
      const maker = lvl.head!;                 // earliest order at the best price (time priority)
      const q = Math.min(o.qty, maker.qty);
      fills.push({ makerId: maker.id, takerId: o.id, price: lvl.price, qty: q });  // trade at maker's price
      o.qty -= q; maker.qty -= q; lvl.volume -= q;
      if (maker.qty === 0) this.unlink(maker);
      if (lvl.volume === 0) lvl = this.best(opp);
    }
    if (o.qty > 0) this.rest(o);               // remainder rests, keeping its sequence priority
    return fills;
  }

  cancel(id: string): boolean {
    const o = this.byId.get(id);
    if (!o) return false;
    o.level!.volume -= o.qty;
    this.unlink(o);
    return true;
  }

  private rest(o: Order) {
    const book = o.side === 'BUY' ? this.bids : this.asks;
    const lvl = book.get(o.price) ?? { price: o.price, volume: 0 };
    book.set(o.price, lvl);
    o.prev = lvl.tail; if (lvl.tail) lvl.tail.next = o; else lvl.head = o;
    lvl.tail = o; lvl.volume += o.qty; o.level = lvl;
    this.byId.set(o.id, o);
  }

  private unlink(o: Order) {
    const l = o.level!;
    if (o.prev) o.prev.next = o.next; else l.head = o.next;
    if (o.next) o.next.prev = o.prev; else l.tail = o.prev;
    this.byId.delete(o.id);
    if (!l.head) (o.side === 'BUY' ? this.bids : this.asks).delete(l.price);
  }
}`,
        },
      ],
      keyPoints: [
        'Price levels as FIFO doubly linked lists; orderId → node map for O(1) cancel.',
        'Trade at the resting (maker) order\'s price.',
        'Integer ticks, not floats; partial fills keep priority.',
        'L1/L2/L3 market data and candlesticks come from executions.',
      ],
      source: 'Alex Xu Vol 2 — Ch 13 (order book, matching algorithms)',
    },
    {
      heading: 'Stock exchange (3/3): microsecond latency, event sourcing and failover',
      body: `**Latency budget.** Across a network hop in a data centre, one round-trip costs ~50–500 µs. Traditional exchange designs spent milliseconds hopping through gateway, order manager, sequencer and matching engine on different servers. Ch 13's modern design puts the **critical path on one server**:

- Components are **application loops**, each pinned to a dedicated CPU core, busy-spinning with no context switches or locks.
- They communicate through **mmap'd files in /dev/shm** used as ring buffers, the **event store**. Writing an event is a memory write (sub-microsecond). This is the LMAX Disruptor idea: single writer, sequence counters, no locks.
- **No GC or allocation on the hot path:** pre-allocated object pools, primitive arrays, off-heap memory (Java) or C++/Rust.
- The kernel network stack is bypassed at the edge (Solarflare/OpenOnload, DPDK), and gateways use FIX over TCP or binary protocols.

**Event sourcing.** The sequenced event log (NewOrder, OrderCancelled, OrderFilled…) *is* the source of truth. The order book and order-manager state are rebuilt by replaying it, and the reporter consumes the same log.

**High availability.**
- **Hot-warm matching engine** on the same or a peer server. Both consume the same sequenced events and compute identical state, but only the **hot** instance publishes. On failure, the warm one takes over at the next sequence number, in milliseconds.
- **Across servers:** replicate the event store with **Raft** (a 5-node cluster in Ch 13). The leader handles traffic, and followers replay. Failover time depends on election timeouts, so tune heartbeats aggressively.
- Detect gaps in sequence ids, and let consumers request retransmission.

**Fairness:** a single sequencer order is the definition of "who came first". Colocation services give all members equal cable lengths. Market data is published via multicast (UDP) so every subscriber receives it at the same time. Rate limits apply per member.

**Numbers to quote:** modern exchange matching latency is tens of µs at the median, and round-trip gateway-to-gateway is ~50–100 µs at leading venues. A single-threaded matching engine per symbol handles millions of events/s, so throughput is not the problem; **tail latency and determinism** are.`,
      diagram: `┌───────────────────── one server (critical path) ─────────────────┐
│ core1: gateway loop ─► ring buf ─► core2: order mgr loop          │
│                                        │ mmap event store (/dev/shm)
│                                        ▼                          │
│                      core3: sequencer ─► core4: matching engine   │
│                                               (hot)               │
└───────────────────────────────┬──────────────────────────────────┘
                                │ replicate event log (Raft)
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
        warm engine        follower 2         follower 3 …
        (replays, silent;  (replay)           (replay)
         takes over at next seq)`,
      keyPoints: [
        'Put the critical path on one box; each loop pinned to a core; mmap ring buffers.',
        'No locks, no allocation/GC, kernel bypass at the edge.',
        'The event log is the truth; state is replayed; hot-warm engines for fast failover.',
        'Raft across servers for durability; the sequencer order defines fairness.',
      ],
      source: 'Alex Xu Vol 2 — Ch 13 (performance, event sourcing, high availability)',
    },
    {
      heading: 'Distributed cache (1/2): partitioning, routing and replication',
      body: `**Requirements (typical prompt):** a Memcached/Redis tier serving **10M reads/s** and 1M writes/s for **~50 TB** of hot data, with p99 < 1–2 ms, horizontal scaling without mass cache misses, and tolerance of node failures. Keys and values are opaque, with TTLs and LRU/LFU eviction.

**Partitioning options:**

| Approach | How routing works | Pros | Cons |
|---|---|---|---|
| **Client-side consistent hashing** (Memcached + ketama) | the client library hashes the key onto a ring of virtual nodes | no extra hop; simple servers | every client needs the same membership view; a library in every language |
| **Proxy tier** (twemproxy, mcrouter, Envoy) | clients talk to a local or sidecar proxy that routes | central config, pooling, replication and failover policies | an extra hop (~100–200 µs); the proxy fleet must scale |
| **Server-side cluster** (Redis Cluster) | 16,384 hash slots mapped to masters; a smart client caches the map; **MOVED** (slot relocated) / **ASK** (mid-migration) redirects | online resharding by slot, automatic failover | multi-key ops only within a slot (hash tags); gossip-based membership |

**Consistent hashing:** adding the (n+1)-th node moves only ~1/(n+1) of the keys, versus ~all keys with \`hash % n\`. Use **~100–200 virtual nodes per physical node** to smooth the load (the standard deviation of load drops roughly with 1/√vnodes).

**Replication and failover:** a primary plus 1–2 replicas per shard (asynchronous, so the last writes can be lost on failover, which is acceptable for a cache). Replicas can serve reads for hot shards, which may be slightly stale. Facebook runs **regional pools** plus a small **gutter pool**: when a server fails, clients send its traffic to gutter servers with short TTLs instead of rehashing onto healthy servers, which would cascade.

**Sizing:** 50 TB ÷ ~64 GB usable per node (leave headroom for fragmentation and replication buffers) ≈ 800 primaries. At 10M QPS that's ~12.5K QPS per node, well under Redis's ~100K simple ops/s. So memory drives the node count, not QPS (unless values are large, when the network becomes the limit).`,
      code: [
        {
          language: 'typescript',
          title: 'Consistent hash ring with virtual nodes',
          code: `import { createHash } from 'node:crypto';

const h32 = (s: string) => createHash('md5').update(s).digest().readUInt32BE(0);

export class HashRing {
  private ring: { point: number; node: string }[] = [];

  constructor(nodes: string[], private readonly vnodes = 160) {
    for (const n of nodes) this.add(n);
  }

  add(node: string) {
    for (let i = 0; i < this.vnodes; i++) this.ring.push({ point: h32(node + '#' + i), node });
    this.ring.sort((a, b) => a.point - b.point);
  }

  remove(node: string) {
    this.ring = this.ring.filter((e) => e.node !== node);   // only this node's arcs move
  }

  // First vnode clockwise from the key's hash (binary search)
  get(key: string): string {
    const p = h32(key);
    let lo = 0, hi = this.ring.length - 1;
    if (p > this.ring[hi].point) return this.ring[0].node;   // wrap around
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid].point < p) lo = mid + 1; else hi = mid;
    }
    return this.ring[lo].node;
  }

  // N distinct physical nodes for replication
  getN(key: string, n: number): string[] {
    const out = new Set<string>();
    let i = this.ring.findIndex((e) => e.point >= h32(key));
    if (i < 0) i = 0;
    while (out.size < n && out.size < new Set(this.ring.map((e) => e.node)).size) {
      out.add(this.ring[i % this.ring.length].node); i++;
    }
    return [...out];
  }
}`,
        },
      ],
      keyPoints: [
        'Client-side hashing vs proxy vs Redis Cluster slots: know the MOVED/ASK redirects.',
        '~100–200 vnodes per node; adding a node moves ~1/(n+1) of keys.',
        'A gutter pool absorbs a dead node\'s traffic instead of cascading.',
        'Memory usually drives node count; check the network for large values.',
      ],
      source: 'Scaling Memcache at Facebook (NSDI 2013); Redis Cluster specification',
    },
    {
      heading: 'Distributed cache (2/2): hot keys, big keys, leases and cross-region invalidation',
      body: `**Hot keys.** A celebrity profile or a flash-sale product key can receive 500K QPS, which exceeds one shard no matter how good the hashing is. Detect them with client-side sampling, Redis \`--hotkeys\` (LFU policy) or proxy stats. Mitigate with:
1. An **L1 in-process cache** (a few seconds TTL) in every app server. This absorbs most of the traffic, at the cost of a few seconds of staleness.
2. **Key replication:** write \`product:42#0..#15\`, and have readers pick a random suffix, which spreads the load over 16 shards. Writes and invalidations must touch all copies.
3. **Read from replicas** for that shard.

**Big keys** (a 50 MB value, or a hash with 10M fields) block Redis's single thread on read, delete and migration. Split them into chunks or buckets. Use UNLINK (asynchronous free) instead of DEL, and cap value size in the client.

**Memcache leases (Facebook):** on a miss, the server hands out a **lease token** to one client, and only that client may SET the value (validated by token). Other clients that miss within ~10 s wait briefly or read a slightly stale value. This fixes both **thundering herds** and **stale sets** (a slow client writing an old value after a newer delete). Redis can emulate it with SET NX lock keys plus a version check.

**Cross-region consistency:** Facebook's **mcsqueal** tails the MySQL commit log in each region and broadcasts invalidations (deletes) to the local cache clusters. Deletes are idempotent and safe to replay, so caches converge after writes replicate. A replica region may briefly serve stale data after a write in the primary region. For the user who wrote, **remote markers** redirect their reads to the primary region until replication catches up (read-your-writes).

**Eviction:** Redis uses approximated LRU/LFU by sampling (maxmemory-samples, default 5), not an exact list. Pick allkeys-lfu for skewed workloads and volatile-ttl when only TTL'd keys are disposable. Monitor the eviction rate and hit ratio together. A falling hit ratio with rising evictions means you're under-provisioned.

*(Cache patterns and failure modes such as stampede, penetration and avalanche are covered in depth in the cache-fundamentals and cache-failures topics. Here the focus is the cluster design.)*`,
      keyPoints: [
        'Hot keys: L1 cache + key replication (#0..#N) + replica reads.',
        'Big keys: split, UNLINK, cap sizes.',
        'Leases fix thundering herds and stale sets.',
        'Cross-region: commit-log-driven invalidation plus remote markers.',
      ],
      source: 'Scaling Memcache at Facebook (NSDI 2013)',
    },
    {
      heading: 'Global rate limiter: enforcing one limit across regions',
      body: `**Prompt:** "Merchant X may make 1,000 requests/s to our API **globally**, and we serve from 5 regions." A single-region limiter (a Redis token bucket at the gateway) is covered in the rate-limiting topic. The new problem is that **the counter is distributed across regions ~70–150 ms apart**.

**Options:**

| Design | Accuracy | Added latency | Failure behaviour |
|---|---|---|---|
| **Central global counter** (one Redis in us-east) | exact | one cross-region RTT on every request (~100 ms) | if that region is down, every region is blind |
| **Static split** (limit ÷ regions = 200/s each) | under-uses capacity when traffic is skewed (e.g. 90% in one region) | none | fully local |
| **Sticky routing** (route each API key to a home region) | exact | extra latency for far clients | the home region is a SPOF for that key |
| **Local buckets + async sync (quota leasing)** | approximate (~1–5% overshoot) | none on the hot path | degrades to the last-known share |

**Recommended: quota leasing with adaptive shares.**
1. Each region keeps a **local token bucket per key** (in-process, or the regional Redis). Most checks are a local operation of about 50 µs.
2. The regional limiter **leases tokens in batches** from a global coordinator, e.g. "give me 100 tokens for key X". The coordinator's share per region adapts to recent demand, reported every 100–500 ms.
3. When the lease runs out, the region asks for more. If the coordinator is unreachable, it keeps using the last-known share (fail-open within bounds) or falls back to the static split (fail-conservative for costly APIs).

Error comes from lease granularity and sync interval. With 5 regions each holding up to 1 batch unused, overshoot is at most 5 × batch, so size batches at ~1–2% of the limit.

**Alternatives worth naming:** gossip or CRDT counters (G-Counter per region, merged asynchronously), used by Envoy's global rate limit service with local caching and by several CDNs. Or a sliding-window counter per region plus periodic reconciliation.

**What to return:** HTTP 429 with \`Retry-After\` and \`RateLimit-*\` headers. Distinguish limit dimensions (per key, per IP, per endpoint cost), and weight expensive endpoints more.

**In interviews say this:** "Strict global accuracy costs a cross-region round-trip on every request. For API quotas, a bounded few-percent overshoot is the right trade, so I'd use local buckets with leased quota. For hard money or abuse limits, I'd route the key to a single home region."`,
      code: [
        {
          language: 'lua',
          title: 'Regional token bucket that also accounts leased global quota (Redis Lua)',
          code: `-- KEYS[1] = bucket hash for (key, region); ARGV: now_ms, refill_per_sec (this region's share),
-- capacity, cost. The share is updated asynchronously by the global coordinator.
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local now, rate, cap, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local tokens = tonumber(b[1]) or cap
local ts = tonumber(b[2]) or now
-- refill based on elapsed time (server time passed in, so replicas agree)
tokens = math.min(cap, tokens + (now - ts) / 1000 * rate)
local allowed = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / math.max(rate, 1) * 1000) + 1000)
-- consumed counter, reported to the coordinator to recompute regional shares
redis.call('HINCRBY', KEYS[1], 'used', allowed * cost)
return { allowed, math.floor(tokens) }`,
        },
      ],
      keyPoints: [
        'An exact global counter costs a cross-region RTT per request.',
        'Local buckets with leased, demand-weighted quota: no hot-path latency, bounded overshoot.',
        'Define failure behaviour explicitly: fail-open within bounds vs conservative split.',
        'Sticky home-region routing when exactness matters.',
      ],
      source: 'Alex Xu Vol 1 — Ch 4 Rate Limiter (extended to multi-region)',
    },
    {
      heading: 'Search autocomplete / typeahead: trie with cached top-k',
      body: `**Requirements:** return the **top 5 suggestions** for a prefix in **< 100 ms** end to end (each keystroke), ranked by popularity (optionally personalised), for 10M DAU. Estimation (Vol 1 Ch 13): 10M × 10 searches/day × ~20 characters (one request per keystroke) ÷ 86,400 ≈ **24K QPS**, peak ≈ 48K. New query data adds ~0.4 GB/day.

**Data structure:** a **trie** where each node caches its **top-k completions** (with frequencies). A lookup is O(length of prefix) to reach the node, plus O(1) to read the cached list. Without caching, you'd traverse the whole subtree. Limit the prefix length (e.g. 50 characters) and k (e.g. 10 cached, 5 shown). Space trade: each node stores k references, which is acceptable because the trie is built offline.

**Two-path architecture:**
- **Data gathering (offline):** query logs → aggregation (e.g. weekly counts, or a streaming job for trending terms with time decay) → **trie builder** → serialized trie snapshots in object storage and a KV store (prefix → top-k). Filter out offensive and illegal terms at build time.
- **Query service (online):** it loads trie shards in memory, or reads prefix → top-k from Redis. Responses carry \`Cache-Control: max-age=3600\` for **browser caching**, and short prefixes (1–2 characters) are served from a CDN.

**Sharding:** by first character is uneven ("s" is far larger than "x"). Shard by **prefix ranges sized from historical distributions** (e.g. "a–ab", "ac–az"…), with a shard map service.

**Freshness:** weekly rebuilds for the long tail, plus a **real-time trending layer**: a streaming top-k (Count-Min Sketch + heap per prefix window) merged at query time with a boost.

**Client tricks:** debounce input by ~100–150 ms, cancel in-flight requests on the next keystroke (AbortController), and prefetch the next likely prefix.

**Personalisation:** merge global top-k with the user's recent searches (kept client-side or in a small per-user store). Don't personalise the cached global trie.`,
      code: [
        {
          language: 'typescript',
          title: 'Trie with top-k cached per node (built offline)',
          code: `interface Node { children: Map<string, Node>; top: { q: string; f: number }[] }
const K = 10;
const newNode = (): Node => ({ children: new Map(), top: [] });

export function buildTrie(freq: Map<string, number>): Node {
  const root = newNode();
  for (const [q, f] of freq) {
    let n = root;
    const path: Node[] = [root];
    for (const ch of q.slice(0, 50)) {                 // cap prefix depth
      if (!n.children.has(ch)) n.children.set(ch, newNode());
      n = n.children.get(ch)!;
      path.push(n);
    }
    // Maintain top-K on every node along the path (offline cost, O(len × K))
    for (const node of path) {
      node.top.push({ q, f });
      node.top.sort((a, b) => b.f - a.f || a.q.localeCompare(b.q));
      if (node.top.length > K) node.top.pop();
    }
  }
  return root;
}

export function suggest(root: Node, prefix: string, limit = 5): string[] {
  let n: Node | undefined = root;
  for (const ch of prefix.toLowerCase()) {           // O(|prefix|) walk, then O(1) read
    n = n.children.get(ch);
    if (!n) return [];
  }
  return n.top.slice(0, limit).map((x) => x.q);
}`,
        },
      ],
      keyPoints: [
        'Top-k cached per trie node: O(prefix) lookup.',
        'Build offline from aggregated logs; add a streaming trending layer.',
        'Shard by distribution-aware prefix ranges; browser and CDN caching.',
        'Client debounce and cancellation cut QPS a lot.',
      ],
      source: 'Alex Xu Vol 1 — Ch 13 Design a Search Autocomplete System',
    },
    {
      heading: 'Web search engine: crawl, index, serve',
      body: `**Scope at a whiteboard level:** crawl billions of pages, build an inverted index, and answer keyword queries in < 200 ms with relevant ranking.

**1. Crawler:** a **URL frontier** with per-host queues gives **politeness** (robots.txt, crawl-delay, one connection per host) and **priority** (PageRank, change frequency). Fetchers use asynchronous I/O with DNS caching. Dedup URLs (normalise, then a Bloom filter or a seen set in a KV store) and dedup content (SimHash to catch near-duplicates). Raw pages are stored in object storage. Recrawl hot pages (news) in minutes and the long tail in weeks. *(A full crawler design lives in design-infra; this is the search-specific slice.)*

**2. Indexer:** parse and tokenize (language detection, stemming, stop words), then build **posting lists**: term → [(docId, term frequency, positions)], sorted by docId and compressed with delta + variable-byte or PForDelta encoding. Build in batches with MapReduce/Spark-style jobs into immutable segments, plus a small real-time index for fresh content (the Lucene-style segment + merge model).

**3. Index partitioning:**

| | Document-partitioned (each shard = a subset of docs, all terms) | Term-partitioned (each shard = subset of terms) |
|---|---|---|
| Query | scatter to all shards, each returns its top-k, merge | only the shards holding the query terms |
| Pros | even load, easy to add docs, one shard failure only loses some results | fewer shards per query |
| Cons | fan-out to every shard, so tail latency matters | hot terms create hot shards; multi-term intersection crosses the network |

Web search engines use **document partitioning** with replicas, plus **tiering**: a small high-quality tier is queried first, and deeper tiers only when too few results come back.

**4. Ranking:** a cheap first-pass score on each shard (BM25 text relevance + static quality signals such as PageRank, spam score and freshness) → top ~1,000 → a **learned re-ranker** (gradient-boosted trees or neural models using click signals) on the aggregator → top 10. Snippets are generated from stored document text.

**5. Serving:** query → spell-correct and expand → cache (roughly 30–50% of queries are repeats, and the head is heavily cached) → scatter-gather across thousands of index shards with **hedged requests** to cut tail latency → merge and re-rank → render.`,
      diagram: `Seed URLs ─► URL frontier (priority + per-host politeness queues)
                 │
                 ▼
            Fetchers ─► robots/DNS cache ─► raw pages (object store)
                 │                             │ dedup (SimHash)
                 ▼                             ▼
            Link extractor ───► frontier   Indexer (tokenize, posting lists)
                                               │ segments
                                               ▼
Query ─► front end ─► result cache ─► aggregator ═╦═► index shard 1..N
                                          ▲      ║   (doc-partitioned,
                                          │      ║    replicas, tiers)
                             re-rank top 1000 ◄══╝
                             (learned model) ─► top 10 + snippets`,
      keyPoints: [
        'Frontier gives priority + politeness; dedup URLs and near-duplicate content.',
        'Inverted index: compressed posting lists in immutable segments.',
        'Document-partitioned shards with scatter-gather, replicas and tiers.',
        'Cheap per-shard scoring, then learned re-ranking of the top-k.',
      ],
    },
    {
      heading: 'Ad serving: retrieval, auction, pacing and counting',
      body: `**Requirements:** for each page view or app open, return the best ad within **~50–100 ms** (the publisher's SDK times out otherwise), at **~1M ad requests/s** globally. Respect targeting, advertiser budgets and frequency caps, bill accurately for impressions and clicks, and filter fraud.

**Serving pipeline:**
1. **Request enrichment:** user features from a low-latency store (segments, recent interests), plus context (page, geo, device).
2. **Candidate retrieval:** a **targeting index**, an inverted index from targeting attributes (geo=IN, age=25–34, interest=cricket) to ad groups, intersected and filtered by active status, budget remaining and frequency caps. Keep it to a few hundred to a few thousand candidates. Embedding-based retrieval is increasingly used too.
3. **Scoring:** predict **pCTR** (and pCVR) with a model (logistic regression or GBDT at the low end, DNNs at the high end) using features from the feature store. Compute **eCPM = bid × pCTR × 1000** (for CPC bids).
4. **Auction:** rank by eCPM (plus a quality score). **GSP (generalized second price)**: the winner pays the minimum needed to keep their position, i.e. next eCPM ÷ own pCTR, plus a small increment. Many programmatic exchanges moved from second-price to **first-price** auctions around 2019, where bidders shade their own bids.
5. **Pacing:** spread the daily budget over the day. Throttle-based pacing takes part in only a fraction p of eligible auctions, adjusted by a PID-like controller per campaign every minute. Bid shading lowers bids instead.
6. **Response + logging:** log the ad decision, return the creative URL with signed tracking beacons.

**Counting and billing:** impression and click beacons → edge collectors → Kafka → **dedup** (by impression id, within a time window) → stream aggregation (Flink) → billing store. Budget spend is fed back to the servers within seconds (a near-real-time budget cache), with small overspend tolerated and reconciled. *(Ad-click aggregation internals are a separate classic; the serving side is what's unique here.)*

**Fraud:** click-farm and bot detection (IP/device reputation, click timing, a click without a rendered impression), invalid traffic filtered before billing, and advertiser refunds for invalid traffic found after the fact.`,
      code: [
        {
          language: 'typescript',
          title: 'GSP auction on eCPM with reserve price',
          code: `interface Candidate { adId: string; bidCpc: number; pCtr: number; quality: number }
interface Win { adId: string; position: number; priceCpc: number }

// Rank by eCPM x quality; each winner pays just enough to beat the next ad (GSP)
export function runGspAuction(cands: Candidate[], slots: number, reserveEcpm: number): Win[] {
  const scored = cands
    .map((c) => ({ ...c, score: c.bidCpc * c.pCtr * 1000 * c.quality }))
    .filter((c) => c.score >= reserveEcpm)            // floor protects publisher yield
    .sort((a, b) => b.score - a.score);

  const wins: Win[] = [];
  for (let i = 0; i < Math.min(slots, scored.length); i++) {
    const me = scored[i];
    const nextScore = i + 1 < scored.length ? scored[i + 1].score : reserveEcpm;
    // Price per click so that my score would equal the next one: next / (pCtr x 1000 x quality)
    const price = nextScore / (me.pCtr * 1000 * me.quality) + 0.01;
    wins.push({ adId: me.adId, position: i + 1, priceCpc: Math.min(me.bidCpc, Number(price.toFixed(4))) });
  }
  return wins;                                       // charged only when a click is recorded
}`,
        },
      ],
      keyPoints: [
        'Retrieval (targeting index) → pCTR scoring → auction → pacing, all in <100 ms.',
        'eCPM = bid × pCTR × 1000; GSP winners pay next score ÷ own pCTR.',
        'Budget pacing via throttling or bid shading, controlled every minute.',
        'Dedup impressions and clicks by id; filter fraud before billing.',
      ],
    },
    {
      heading: 'Recommendation system: candidates → ranking → re-ranking',
      body: `**Intuition:** you can't run an expensive model over 100M items for every user in 100 ms. So a funnel is used: cheap methods narrow **millions → thousands**, a better model scores **thousands → hundreds**, and business logic picks the final **tens** (YouTube's 2016 paper made this two-stage design famous).

**1. Candidate generation (recall):** several retrievers run in parallel, and their results are merged:
- a **two-tower model**, in which the user tower and item tower produce embeddings. Item embeddings are indexed in an **ANN index** (HNSW or IVF-PQ via FAISS/ScaNN), and the user embedding queries the top ~500 in a few ms;
- **item-to-item co-visitation** ("people who watched X watched Y"), precomputed;
- follows/subscriptions, trending in the region, and fresh content (to avoid a feedback loop).

**2. Ranking (precision):** a heavier model (GBDT or a multi-task DNN predicting click, watch time, like, hide) over ~1,000 candidates with rich features: user history aggregates, item stats, and user × item cross features. Features come from a **feature store** with an **offline store** (for training, point-in-time correct) and an **online store** (Redis/Cassandra, < 10 ms). The same feature definitions serve both, which avoids **training/serving skew**.

**3. Re-ranking / policy:** diversity (don't show 10 videos from one creator; MMR-style penalties), freshness boosts, dedupe against items already seen, ads and sponsored slots, and safety filters.

**Feedback loop:** impressions and engagement logs → Kafka → a training data pipeline (join labels with the features *as they were at serving time*) → daily or continuous retraining → offline evaluation (AUC, NDCG, recall@k) → **online A/B test** on the business metric (watch time, retention) → rollout.

**Cold start:** new users get popularity by geo and onboarding interests, with explore/exploit (bandits). New items get content-based embeddings (text, image) and a guaranteed exploration traffic slice.

**Latency budget (~150 ms p99):** feature fetch 10–20 ms, retrieval 10–20 ms, ranking of 1,000 items on CPU/GPU 30–50 ms, re-rank 5 ms. Precompute candidates in batch for inactive surfaces (email digests).`,
      diagram: `User request
    │
    ▼
┌──────────────── Candidate generation (≈ 1–2K) ─────────────┐
│ two-tower + ANN │ co-visitation │ follows │ trending/fresh │
└───────────────────────────┬────────────────────────────────┘
                            ▼
Feature store (online) ─► Ranking model (multi-task DNN/GBDT) ─► top ~200
                            ▼
          Re-rank: diversity, freshness, dedupe, policy ─► top 20
                            │
                            ▼  impressions / clicks / watch time
Kafka ─► training pipeline (point-in-time features) ─► models ─► A/B`,
      keyPoints: [
        'Funnel: recall (ANN + heuristics) → ranking → re-ranking.',
        'The feature store unifies offline/online features to avoid skew.',
        'Log features at serving time for correct training joins.',
        'Cold start: popularity, content embeddings, exploration.',
      ],
      source: 'Covington et al. — Deep Neural Networks for YouTube Recommendations (2016)',
    },
    {
      heading: 'Multi-tenant SaaS: isolation models, tenant routing and noisy neighbours',
      body: `**Intuition:** an apartment building. **Silo** gives every tenant their own house (strong isolation, expensive). **Pool** has everyone share the building, separated by locked doors, i.e. tenant_id checks (cheap, but neighbours can be noisy). **Bridge/hybrid** mixes them: a shared building for small tenants, and a private house for the enterprise ones.

| Model | Isolation | Cost / ops | Typical use |
|---|---|---|---|
| **Silo** (stack or DB per tenant) | strongest; per-tenant keys, backups, upgrades | high; thousands of stacks to operate | regulated enterprise, data residency |
| **Pool** (shared tables with tenant_id) | logical (RLS, app checks) | lowest; one schema to migrate | SMB long tail |
| **Bridge** (schema per tenant, or pooled compute with siloed DB) | medium | medium | mixed customer base |
| **Cell-based** (N identical cells, each hosting a set of tenants) | failure isolation per cell | moderate | at scale (Slack, Atlassian, AWS) |

**Tenant context propagation:** resolve the tenant at the edge (subdomain, JWT claim, API key), put it in the request context (AsyncLocalStorage in Node), carry it through queues and events (a message header), and **enforce it in the data layer**, not just in controllers.

**Enforcement with Postgres RLS:** a policy compares \`tenant_id\` to a session setting that is set per transaction. Even a forgotten WHERE clause can't leak data across tenants. The app must not connect as a superuser or table owner, which bypass RLS unless FORCE is used.

**Tenant routing and sharding:** a **tenant directory** maps tenant → cell/shard/DB. Small tenants are packed together, and big tenants get dedicated shards. **Moving a tenant:** copy, then stream changes (CDC), briefly freeze writes, flip the directory, and resume. Plan this from day one.

**Noisy neighbours:** per-tenant **rate limits and quotas** (API, storage, background jobs); **fair-share scheduling** of async work (per-tenant queues, or weighted round-robin instead of one FIFO where a single tenant's 1M-job import starves everyone); per-tenant connection limits; statement timeouts; and moving whales to their own cell.

**Also expected:** per-tenant encryption keys (BYOK for enterprise), per-tenant metrics and cost attribution (tag every metric and log with tenant_id, capping cardinality), tenant-aware backups and restore (restoring one tenant from a pooled DB is hard, so design for it), and data residency (cells per region).`,
      code: [
        {
          language: 'sql',
          title: 'Postgres row-level security for a pooled model',
          code: `ALTER TABLE issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue FORCE ROW LEVEL SECURITY;           -- applies even to the table owner

CREATE POLICY tenant_isolation ON issue
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Composite PK / indexes lead with tenant_id: tenant-local queries and future sharding
CREATE UNIQUE INDEX issue_tenant_key ON issue (tenant_id, project_id, issue_number);

-- Per request (inside the pooled connection's transaction):
BEGIN;
SELECT set_config('app.tenant_id', '6f1c…-tenant-uuid', true);  -- true => local to this txn
SELECT * FROM issue WHERE project_id = 42;                      -- RLS adds the tenant filter
COMMIT;`,
        },
        {
          language: 'typescript',
          title: 'Tenant context propagation + per-tenant transaction (Node/pg)',
          code: `import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient } from 'pg';

export const tenantCtx = new AsyncLocalStorage<{ tenantId: string }>();
const pool = new Pool({ max: 30 });

// Express/Nest middleware: tenant comes from a verified JWT claim, never from the body
export function tenantMiddleware(req: any, _res: any, next: () => void) {
  tenantCtx.run({ tenantId: req.user.tenantId }, next);
}

export async function withTenantTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const ctx = tenantCtx.getStore();
  if (!ctx) throw new Error('No tenant in context');          // fail closed
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
    await c.query("SET LOCAL statement_timeout = '2s'");        // one tenant can't hog a connection
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}`,
        },
      ],
      keyPoints: [
        'Silo vs pool vs bridge vs cells: isolation against cost and ops.',
        'Resolve tenant at the edge, propagate it everywhere, enforce it in the DB (RLS, FORCE).',
        'A tenant directory enables sharding and moving whales.',
        'Noisy neighbours: quotas, fair-share queues, timeouts, dedicated cells.',
      ],
      source: 'AWS SaaS Tenant Isolation Strategies whitepaper',
    },
    {
      heading: 'Wrap-up: patterns that recur across the advanced designs',
      body: `| Design | Core data structure | Key scaling move | Consistency stance | Signature trade-off |
|---|---|---|---|---|
| Leaderboard | skip list (Redis ZSET) | score-range sharding | rebuildable index over a durable score log | exact rank vs sharding simplicity |
| Stock exchange | price-level FIFO lists + id map | per-symbol single-threaded engine on one box | total order via sequencer; event-sourced | latency vs distribution |
| Distributed cache | hash ring / slots | consistent hashing, L1, key replication | eventual; leases against stale sets | hit ratio vs staleness |
| Global rate limiter | token bucket | local buckets + leased quota | approximate | accuracy vs cross-region latency |
| Typeahead / search | trie with top-k; inverted index | prefix / doc partitioning, tiering, caching | offline-built snapshots + fresh layer | freshness vs cost |
| Ad serving | targeting inverted index | retrieval funnel, pacing controllers | near-real-time budgets, reconciled | revenue vs latency vs overspend |
| Recommender | embeddings + ANN | multi-stage funnel, feature store | offline/online parity | model quality vs latency |
| Multi-tenant SaaS | tenant directory | cells, whale isolation | strict tenant isolation | cost vs isolation |

**Meta-lessons to say out loud:**
- **Funnels beat brute force:** retrieval then ranking (ads, recs, search), local check then global sync (rate limiter), L1 then L2 cache.
- **Single-writer designs are fast and correct:** matching engine per symbol, Raft leader, Redis single thread. Scale by partitioning, not by adding locks.
- **Precompute what's read on every request:** top-k per trie node, ZSET ranks, candidate lists, tenant routing.
- **State the accuracy you're buying:** exact rank vs percentile, strict vs ~2% overshoot, fresh vs hourly.`,
      keyPoints: [
        'Funnels, single writers, precomputation and explicit accuracy trade-offs recur.',
        'Name the core data structure early; it anchors the whole design.',
      ],
    },
    {
      heading: 'Level bar: what mid, senior and staff answers include',
      body: `**Intuition:** the same prompt is graded on three different bars. **Mid** (≈80% breadth / 20% depth) must produce a working design while the interviewer steers. **Senior** (≈60/40) moves through the HLD fast, picks the deep dives without being asked and names trade-offs. **Staff** (≈40/60) runs the session: the interviewer only points, and the candidate raises ops, cost and migration without being prompted.

**Leaderboard**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | top-N + my rank | exact vs percentile rank, tie rule, seasons | which boards really need exact rank |
| High-level design | ZSET behind a score API | durable score log + rebuildable ZSET | log-first; every board a derived index |
| Deep dives expected | ZADD / ZREVRANK | composite tie score; 500M sharding | score-range shards, rank = prefix counts |
| Trade-offs & failure handling | add a replica | rebuild after loss; cache top-N | exactness priced in RAM and ops |
| Ops/cost/evolution | none | ~100 B per member sizing | season rollover, cheat review |

*Down-levelled by:* ORDER BY over 500M rows; no tie rule; Redis treated as the only copy of the scores.

**Stock exchange**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | place/cancel, price-time | latency budget, fairness, determinism | audit, replay, regulatory RTO |
| High-level design | gateway → engine → feed | sequencer + one engine per symbol | event-sourced journal + hot standby |
| Deep dives expected | order book shape | level FIFO + id map, O(1) cancel | no GC or allocation on the hot path |
| Trade-offs & failure handling | DB with locks | why one book stays on one box | deterministic replay as failover; gapless feed |
| Ops/cost/evolution | none | rebalancing symbols | auctions, kill switches, replay drills |

*Down-levelled by:* row lock per order; multi-threaded matching on one book; feed without sequence numbers.

**Distributed cache**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | get/set/TTL | hit-ratio target, staleness bound | which callers tolerate stale |
| High-level design | hash keys to nodes | slots + client routing + L1 | L1/L2 tiers, slot-map ownership |
| Deep dives expected | LRU eviction | hot and big keys | leases vs stampede; cross-region invalidation |
| Trade-offs & failure handling | add nodes | replica staleness, rebalance cost | invalidation-bus failure plan |
| Ops/cost/evolution | none | eviction and hot-key metrics | RAM cost vs hit-ratio curve |

*Down-levelled by:* invalidation without ordering; no answer for one key at 1M req/s.

**Global rate limiter**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | N per minute per key | overshoot tolerance, fail-open vs closed | billing limits vs protective limits |
| High-level design | Redis INCR | Lua token bucket + local cache | local buckets + leased quota |
| Deep dives expected | fixed window | sliding window, race-free Lua | quota rebalancing under skew |
| Trade-offs & failure handling | none | accuracy vs latency | limiter as SPOF, partition behaviour |
| Ops/cost/evolution | none | hot keys | shadow mode before enforcing |

*Down-levelled by:* a synchronous global call per request.

**Typeahead**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | top-5 per prefix | p99 < 100 ms per keystroke, freshness | safety filtering, personalisation |
| High-level design | trie service | top-k per node, offline build | base snapshot + fresh layer + CDN |
| Deep dives expected | lookup | prefix sharding | skew on short prefixes; read-time merge |
| Trade-offs & failure handling | none | freshness vs build cost | bad-snapshot rollback |
| Ops/cost/evolution | none | debounce cuts QPS 3–5× | poisoned-query defence |

*Down-levelled by:* mutating the trie online under locks.

**Web search**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | crawl, index, query | index size, freshness tiers | quality metrics, spam |
| High-level design | one inverted index | doc-sharded scatter-gather | tiered index, replicas per shard |
| Deep dives expected | postings lists | top-k merge, tail latency | early termination, hedging |
| Trade-offs & failure handling | add shards | partial results | term vs doc partitioning argued |
| Ops/cost/evolution | none | cost per query | rebuild cadence vs freshness |

*Down-levelled by:* waiting for all 1,000 shards.

**Ad serving**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | pick an ad | ~100 ms budget, overspend bound | billing trust, fraud |
| High-level design | filter by targeting | retrieval → auction → pacing | + deduped counting ledger |
| Deep dives expected | targeting index | GSP auction, pacing | overspend under lag, click dedupe |
| Trade-offs & failure handling | none | revenue vs latency | refunds and reconciliation |
| Ops/cost/evolution | none | none | revenue per ms of latency, experiments |

*Down-levelled by:* a synchronous budget write per impression.

**Recommender**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | recommend items | latency, signal freshness, cold start | objective and guardrails |
| High-level design | model scores items | ANN candidates → rank → re-rank | feature store with online/offline parity |
| Deep dives expected | none | two-tower + ANN | training/serving skew, exploration |
| Trade-offs & failure handling | none | quality vs latency | feedback loops |
| Ops/cost/evolution | none | none | GPU/CPU cost, A/B infrastructure |

*Down-levelled by:* scoring every item per request.

**Multi-tenant SaaS**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | tenant_id column | isolation per plan | residency, whales |
| High-level design | shared DB | pool / bridge / silo + router | cells + tenant directory |
| Deep dives expected | row-level security | noisy-neighbour quotas | online tenant moves between cells |
| Trade-offs & failure handling | none | cost vs isolation | blast radius per cell |
| Ops/cost/evolution | none | per-tenant metrics | cost per tenant drives pricing |

*Down-levelled by:* isolation by convention only.`,
      keyPoints: [
        'Mid ≈ 80/20 breadth/depth and is steered; senior ≈ 60/40 and picks the dives; staff ≈ 40/60 and drives.',
        'Staff answers price exactness, latency and isolation in money and operational load.',
        'Down-levelling comes from naive hot paths and from missing a source of truth, not from missing boxes.',
      ],
      source: 'Hello Interview — problem breakdowns, "What is expected at each level"',
    },
    {
      heading: 'Deep-dive ladders: bad → good → great',
      body: `**Intuition:** interviewers grade a deep dive by how far up the ladder you climb unprompted. A "bad" answer works on the whiteboard and fails in production. A "good" answer works but has a known cost. A "great" answer names that cost and removes it, or bounds it.

**Leaderboard — "my rank" among 500M players**
- **Bad:** COUNT(*) WHERE score > mine. That is an index range scan of up to 500M entries on every request, so it takes seconds and pins the DB.
- **Good:** a single Redis ZSET with ZREVRANK in O(log n). But 500M × ~100 B ≈ 50 GB on one node, a ~100K ops/s single-thread ceiling, and a failover that can lose recent ZADDs.
- **Great:** score-range shards, each with a cached member count. Rank = the counts of the higher shards + the local ZREVRANK. A durable score log rebuilds any shard. Users outside the top ~1M get a percentile, which drops the cost of exactness where nobody looks.

**Stock exchange — keeping one symbol available**
- **Bad:** two active engines on the same book. Inputs interleave differently, so you get double fills and diverging books.
- **Good:** one engine journals to disk and restarts by replaying it. That is correct, but you lose minutes of trading per crash.
- **Great:** a sequencer totally orders the inputs, and the primary and a hot standby consume the same stream deterministically. Promotion takes milliseconds with fencing, and market-data gaps are refilled through a retransmit service keyed by sequence number.

**Distributed cache — a celebrity key at 1M req/s**
- **Bad:** one node owns the key. It saturates its NIC, and on expiry 10K concurrent misses stampede the DB.
- **Good:** an in-process L1 with a 1–5 s TTL plus per-process request coalescing. DB load drops to about one fetch per pod per TTL.
- **Great:** detect hot keys (sampled top-k) and replicate them under N suffixes. Add memcache-style leases so only one caller refills and the rest get stale-while-revalidate. Staleness is bounded by the L1 TTL, so say so.

**Global rate limiter — one limit across 3 regions**
- **Bad:** a synchronous call to one global Redis on every request. It adds 80–150 ms cross-region and becomes a global SPOF.
- **Good:** a static split (limit ÷ regions). It is cheap, but wrong under skew: a user homed in one region gets a third of their quota.
- **Great:** local buckets that lease quota in chunks from a coordinator, rebalanced by observed demand every ~100 ms. Overshoot ≤ leased-but-unspent tokens. Fail open for protective limits and fail closed for billing limits.

**Typeahead — a query trending within minutes**
- **Bad:** mutating the shared trie's top-k under locks on the hot path.
- **Good:** an hourly or daily offline snapshot, swapped atomically. It is fast, but blind to breaking news.
- **Great:** the base snapshot plus a small streaming fresh layer (count-min + heap over the last hour), merged at read time and filtered by a blocklist, with short prefixes cached at the CDN.

**Web search — scatter-gather over 1,000 shards**
- **Bad:** wait for every shard, so p99 equals the slowest shard of 1,000.
- **Good:** replicas plus per-shard timeouts that return partial results.
- **Great:** hedged requests after p95, a small hot tier that answers most queries, and early termination over impact-ordered postings.

**Ad serving — budget overspend**
- **Bad:** a synchronous DB decrement per impression, which turns the advertiser's row into a write hotspot.
- **Good:** async counting with a cached spend check. Lag lets big campaigns overspend for minutes.
- **Great:** a pacing controller hands each server a budget slice and throttles probabilistically. Billing comes from a deduped log with reconciliation, so overspend is bounded and credited.

**Recommender — candidates in 50 ms**
- **Bad:** a heavy model scores all 10M items. **Good:** two-tower + HNSW retrieves about 1K items to rank. **Great:** several candidate sources (ANN, co-visitation, trending) feed a light pre-ranker, then a heavy ranker on ~200 items and a diversity re-rank. Features are logged at serve time, so training never skews.

**Multi-tenant SaaS — the whale tenant**
- **Bad:** a shared pool with no limits, where one export saturates the DB. **Good:** per-tenant quotas, statement timeouts and connection caps. **Great:** cells plus a tenant directory. The whale moves to its own cell by logical replication with a per-tenant cutover, and per-tenant cost metrics justify the price tier.`,
      keyPoints: [
        'Bad works on the whiteboard and fails in production; good works with a known cost; great bounds or removes that cost.',
        'Most "great" answers add a source of truth, a bounded staleness or overshoot, and a failure plan.',
        'Climb the ladder unprompted: that is the senior and staff signal.',
      ],
      source: 'Hello Interview — problem breakdowns (Bad / Good / Great deep dives)',
    },
  ],
  codeChallenges: [
    {
      id: 'design-advanced-cc-1',
      title: 'Rescue a leaderboard that is slow, cheatable and unfair on ties',
      context:
        'A mobile game shows "Top 10" and "Your rank". The current implementation queries MySQL on every request. Rank pages take 4 s at 20M players, some players have impossible scores, and equal scores rank in random order, which generates support tickets.',
      task:
        'Rewrite the leaderboard so top-10 and rank are O(log n), scores can only change through server-validated match results (no double counting on retries), and ties are broken by who reached the score first. Keep MySQL as the durable source of truth.',
      starter: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
const db = new Pool();

// Called directly by the game client when a match ends
export async function submitScore(userId: string, score: number) {
  const { rows } = await db.query('SELECT score FROM leaderboard WHERE user_id = $1', [userId]);
  const current = rows[0]?.score ?? 0;
  await db.query('INSERT INTO leaderboard (user_id, score) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET score = $2',
    [userId, current + score]);
}

export async function getRank(userId: string) {
  const { rows } = await db.query(
    'SELECT COUNT(*) + 1 AS rank FROM leaderboard WHERE score > (SELECT score FROM leaderboard WHERE user_id = $1)', [userId]);
  return Number(rows[0].rank);
}

export async function top10() {
  return (await db.query('SELECT user_id, score FROM leaderboard ORDER BY score DESC LIMIT 10')).rows;
}`,
      },
      hints: [
        'The client supplies the score. Who should decide how many points a match is worth, and how do you make a retried match-result event harmless?',
        'COUNT(*) WHERE score > x is a range scan proportional to rank. Which data structure answers rank in O(log n)?',
        'A double score has 53 bits of integer precision. How could you pack "earlier is better" into the score itself?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
import Redis from 'ioredis';

const db = new Pool({ max: 20 });
const redis = new Redis(process.env.REDIS_URL!);
const SHIFT = 2 ** 32;                                   // points < 2^21 keeps us within 53 bits
const monthKey = (d: Date) => 'lb:' + d.toISOString().slice(0, 7);
const monthStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

// Called by the MATCH SERVICE after it validated the result, never by the client
export async function recordMatchResult(userId: string, matchId: string, points: number, at: Date) {
  if (!Number.isInteger(points) || points < 0 || points > 10) throw new Error('invalid points');
  // 1) Durable + idempotent: (match_id, user_id) PK => a retried event inserts nothing
  const ins = await db.query(
    'INSERT INTO score_event (match_id, user_id, points, at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [matchId, userId, points, at]);
  if (ins.rowCount === 0) return;
  // 2) Update the Redis index with a tie-break: earlier achievement => larger fractional part
  const t = Math.floor((at.getTime() - monthStart(at)) / 1000);
  await redis.eval(
    "local c = tonumber(redis.call('ZSCORE', KEYS[1], ARGV[1]) or '0') " +
    "local p = math.floor(c / tonumber(ARGV[4])) + tonumber(ARGV[2]) " +
    "redis.call('ZADD', KEYS[1], p * tonumber(ARGV[4]) + (tonumber(ARGV[4]) - 1 - tonumber(ARGV[3])), ARGV[1]) " +
    'return p',
    1, monthKey(at), userId, points, t, SHIFT);
}

export async function getRank(userId: string, now = new Date()) {
  const r = await redis.zrevrank(monthKey(now), userId);   // O(log n)
  return r === null ? null : r + 1;
}

export async function top10(now = new Date()) {
  const flat = await redis.zrevrange(monthKey(now), 0, 9, 'WITHSCORES');
  const out: { userId: string; points: number }[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ userId: flat[i], points: Math.floor(Number(flat[i + 1]) / SHIFT) });
  return out;
}

// Recovery: rebuild the month's ZSET from the durable event log (e.g. after Redis loss)
export async function rebuild(month: Date) {
  const { rows } = await db.query(
    'SELECT user_id, SUM(points)::int AS pts, MAX(at) AS last_at FROM score_event WHERE at >= $1 AND at < $1::timestamptz + interval \\'1 month\\' GROUP BY user_id',
    [new Date(monthStart(month))]);
  const pipe = redis.pipeline();
  for (const r of rows) {
    const t = Math.floor((new Date(r.last_at).getTime() - monthStart(month)) / 1000);
    pipe.zadd(monthKey(month), r.pts * SHIFT + (SHIFT - 1 - t), r.user_id);
  }
  await pipe.exec();
}`,
      },
      explanation: `**Fixes:**
1. **Cheating:** the client no longer submits scores. The match service validates results and awards points, with a bounded points range.
2. **Lost updates and double counting:** read-then-write in SQL raced (two matches finishing together lost one update), and client retries double-counted. Now each (match, user) is a unique durable event (\`ON CONFLICT DO NOTHING\`), so a retry is a no-op.
3. **Performance:** rank came from \`COUNT(*) WHERE score > x\`, which scans the whole range. A Redis ZSET (skip list with spans) gives ZREVRANK and ZREVRANGE in O(log n), under 1 ms at 20M members.
4. **Fair ties:** points and "time reached" are packed into one double. Equal points order by earlier achievement, deterministically. The Lua script makes the read-modify-write on the member atomic.
5. **Durability:** Redis is a rebuildable index over \`score_event\`. rebuild() reconstructs a month after data loss (the timestamp used is the last score time, which matches the tie-break semantics).
6. **Monthly tournaments** use one key per month, so resets are free.`,
      followUps: [
        {
          "q": "The Postgres insert succeeds but the Redis eval fails (Redis timeout). The leaderboard is now missing those points. How do you make the two stores converge?",
          "a": "Use an outbox: in the same transaction as the `score_event` insert, also write an outbox row (or rely on logical decoding of `score_event` with Debezium). A separate relay reads new events in order and applies them to Redis, recording the last applied event id. If Redis fails, the relay retries, and since the events are durable nothing is lost. Because the ZSET update is additive, the relay must be idempotent: store applied event ids in a Redis set with TTL, or check the stored offset inside the same Lua script before adding points."
        },
        {
          "q": "How would you test the tie-break and idempotency logic before shipping?",
          "a": "Unit-test the score encoding: two users with equal points where the earlier timestamp ranks higher, the end of the month (largest timestamp), and the maximum points value, asserting that encode/decode round-trips exactly within 53 bits. For idempotency, call `recordMatchResult` twice with the same matchId concurrently (Promise.all) against a real Postgres and Redis in Docker, and assert the score increased once. Then run a property test: random event sequences with duplicates, comparing the Redis ranking with a reference built from the DB using `rebuild()`. They must match exactly."
        }
      ],
    },
    {
      id: 'design-advanced-cc-2',
      title: 'Fix a "global" rate limiter that is both inaccurate and slow',
      context:
        'Your API runs in 4 regions. Each merchant has a global limit. The current limiter calls a single Redis in us-east-1 from every region, so p99 latency in ap-south-1 went from 40 ms to 260 ms. During Redis failovers merchants got unlimited traffic, and at window boundaries merchants burst to 2× their limit.',
      task:
        'Redesign the limiter so the hot path is region-local, bursts at window edges are smoothed, the global limit is honoured within a few percent, and a coordinator outage has explicit, bounded behaviour.',
      starter: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
const globalRedis = new Redis('redis://us-east-1.cache.internal:6379');

export async function allow(merchantId: string, limitPerSec: number): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000);
  const key = 'rl:' + merchantId + ':' + window;
  try {
    const n = await globalRedis.incr(key);          // cross-region round trip on EVERY request
    if (n === 1) await globalRedis.expire(key, 2);
    return n <= limitPerSec;
  } catch {
    return true;                                     // Redis down => allow everything
  }
}`,
      },
      hints: [
        'A fixed one-second window lets limit requests at 0.999 s and another limit at 1.001 s through. Which algorithm smooths this?',
        'Can a region decide most requests locally if it has been granted a share of tokens in advance?',
        'When the coordinator is unreachable, what is a safe budget to keep allowing, and for how long?',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';

// Region-local Redis for per-instance-agnostic buckets; a coordinator service owns global shares
const local = new Redis(process.env.REGIONAL_REDIS_URL!);
const REGION = process.env.REGION!;
const REGIONS = 4;

const BUCKET_LUA = \`
local b = redis.call('HMGET', KEYS[1], 't', 'ts')
local now, rate, cap = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local t = tonumber(b[1]) or cap
local ts = tonumber(b[2]) or now
t = math.min(cap, t + (now - ts) / 1000 * rate)
local ok = 0
if t >= 1 then t = t - 1; ok = 1 end
redis.call('HSET', KEYS[1], 't', t, 'ts', now)
redis.call('HINCRBY', KEYS[1], 'used', ok)
redis.call('PEXPIRE', KEYS[1], 60000)
return ok\`;
local.defineCommand('takeToken', { numberOfKeys: 1, lua: BUCKET_LUA });

// share = this region's slice of the global rate, refreshed by syncShares()
const shares = new Map<string, { rate: number; fetchedAt: number }>();

export async function allow(merchantId: string, globalLimit: number): Promise<{ ok: boolean; retryAfterMs?: number }> {
  const s = shares.get(merchantId);
  const stale = !s || Date.now() - s.fetchedAt > 30_000;
  // Unknown or stale share => conservative static split (bounded, never unlimited)
  const rate = stale ? globalLimit / REGIONS : s!.rate;
  const ok = (await (local as any).takeToken('rl:{' + merchantId + '}:' + REGION, Date.now(), rate, Math.max(1, rate))) === 1;
  return ok ? { ok } : { ok, retryAfterMs: Math.ceil(1000 / Math.max(rate, 1)) };
}

// Runs every 500 ms: report local usage, receive demand-weighted shares (sum of shares = global limit)
export async function syncShares(coordinator: { exchange(region: string, usage: Record<string, number>): Promise<Record<string, number>> }, merchants: string[]) {
  const usage: Record<string, number> = {};
  for (const m of merchants) usage[m] = Number(await local.hget('rl:{' + m + '}:' + REGION, 'used')) || 0;
  try {
    const newShares = await coordinator.exchange(REGION, usage);
    for (const [m, rate] of Object.entries(newShares)) shares.set(m, { rate, fetchedAt: Date.now() });
  } catch {
    // keep last-known shares; allow() falls back to the static split after 30 s
  }
}`,
      },
      explanation: `**Fixes:**
1. **Latency:** every request used to cross regions to us-east-1. Now the hot path is one Lua call against the **regional** Redis (~0.3 ms). Global coordination happens off the hot path every 500 ms.
2. **Boundary bursts:** a fixed window allowed ~2× the limit across a boundary. A **token bucket** refills continuously, and capacity = rate caps bursts at about 1 s worth.
3. **Global accuracy:** a coordinator hands out **demand-weighted shares** that sum to the global limit. If a merchant's traffic is 80% in ap-south-1, that region gets ~80% of the rate. The error is bounded by the sync interval (a few percent).
4. **Failure mode:** the old code failed **open** to unlimited. Now it keeps the last-known shares, and after 30 s of staleness falls back to a static \`limit ÷ regions\` split. That is bounded and predictable.
5. **Atomicity:** refill, check and decrement happen in one script, so concurrent requests can't both take the last token. Hash tags keep keys cluster-safe, and TTLs clean up idle merchants.
6. **Client guidance:** return Retry-After (sent as a 429 with a Retry-After header upstream).`,
      followUps: [
        {
          "q": "A merchant uses all 4 regions and you suspect the global limit is overshot. How would you measure the actual error?",
          "a": "Each region already records allowed requests in the `used` field. Export allowed count per merchant per region per second to a metrics pipeline and compute the global sum per second offline. Compare it with the limit: the overshoot distribution (p50, p99, max) is your accuracy SLO, e.g. 'within 3% at p99'. Run a load test that shifts traffic between regions every few seconds, since sudden shifts produce the largest error. If error is too high, shorten the sync interval for that merchant or reduce the burst capacity, and check that the improvement shows up in the measured overshoot."
        },
        {
          "q": "Now support 50,000 merchants. `syncShares` calls `hget` for each merchant every 500 ms. What breaks, and how do you fix it?",
          "a": "That is 50K sequential round trips per region every 500 ms, about 100K calls/s, and the loop won't finish in time, so shares go stale and the fallback triggers. Fix: pipeline or batch reads (HMGET via a pipeline, or keep per-merchant usage in one hash per region and read it with HSCAN), and only sync active merchants, i.e. those with traffic since the last sync tracked in a set. Send deltas to the coordinator, not full state. Most merchants are far below their limit, so give them static shares and coordinate only those using, say, more than 50% of their limit."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-advanced-iq-1',
      difficulty: 'hard',
      question:
        'Design the leaderboard for a game with 500M daily players where everyone can see the global top 100 and their own exact rank, updated in real time.',
      whatInterviewerLooksFor: [
        'Starts with numbers: update QPS and memory for billions of members',
        'Knows ZSET complexity and why SQL rank is O(n)',
        'Chooses a sharding scheme that keeps exact rank cheap (score ranges) and explains rebalancing',
        'Durable score log + rebuildability; idempotent score events',
        'Tie-breaking and anti-cheat',
      ],
      modelAnswer: `### Numbers
500M DAU × 10 matches ÷ 86,400 ≈ **58K updates/s**, peak ~250K/s. Monthly members ≈ 2.5B × ~100 B ≈ **250 GB** in ZSETs, so it needs multiple Redis nodes.

### Source of truth
The match service validates results and writes \`score_event(match_id, user_id, points)\` (unique, so it's idempotent) to Kafka and a durable store (Cassandra/DynamoDB). Consumers update Redis. If Redis is lost, it's rebuilt from events.

### Sharding for exact rank: fixed score ranges
- Partition by score band: shard k holds users with total points in [a_k, b_k). Bands are sized from the score distribution (many low scores, few high), so low bands are narrow and high bands wide, and each shard gets a similar member count.
- **Top 100:** read the top shard(s) only.
- **My rank** = ZREVRANK within my shard + Σ ZCARD(all higher shards). There are about 20 higher shards, and their ZCARDs are cached (refreshed every second), so it's O(log n) plus a cheap sum.
- **Update:** when a user's score crosses a band boundary, ZREM from the old shard and ZADD to the new one, tracked in a user → shard map. Do it atomically per user (by serialising a user's events through one Kafka partition keyed by user_id).
- Rebalance bands monthly or when shard sizes drift.

### Alternative
Hash sharding via Redis Cluster makes updates trivial but rank expensive (every shard counts members above a score: ZCOUNT per shard, then sum). That's acceptable if exact rank is only for the top users, and others get a percentile from a histogram.

### Details
Ties use a composite score (points × 2^32 + reversed timestamp). Anti-cheat means scores come only from the match service, with anomaly detection on score velocity. Profiles for the top 100 come from a cache.

### Latency
A rank lookup is ~2 Redis calls (<2 ms). The update pipeline runs ~1 s end to end, which counts as "real time" for players.`,
      followUps: [
        {
          q: 'How do you show friends-only leaderboards?',
          a: 'Fetch the friend ids (usually < 500), ZMSCORE them across the relevant shards, and sort in the service. There\'s no precomputation, because friend graphs differ per user.',
        },
        {
          q: 'A shard holding the 0–10 points band is huge at the start of the month. Fix?',
          a: 'Split the low bands finer (0–1, 1–2…), or hash-subshard within a band (rank within the band = sum of ZCOUNT across its subshards).',
        },
        {
          q: 'What if Redis loses the last second of writes on failover?',
          a: 'Replay events from Kafka offsets committed after the last Redis snapshot. Updates are idempotent per match via a composite recompute, or a dedupe set.',
        },
      ],
      pitfalls: [
        'SQL COUNT(*) for rank',
        'Hash sharding while claiming exact rank is cheap',
        'Letting clients submit scores',
        'No rebuild path for Redis',
      ],
    },
    {
      id: 'design-advanced-iq-2',
      difficulty: 'expert',
      question:
        'Design the core of a stock exchange: order entry, matching and market data. Our target is 200K orders/s at peak with p99 under 1 ms inside the exchange. Walk me through the critical path and failover.',
      whatInterviewerLooksFor: [
        'Sequencer for total ordering and determinism',
        'Order book data structure with complexity',
        'Single-threaded per-symbol engine; low-latency techniques (pinned threads, ring buffers, no GC)',
        'Event sourcing; hot-warm failover; Raft for durability',
        'Market data dissemination and fairness',
      ],
      modelAnswer: `### Critical path
Broker → **gateway** (FIX, auth, validation, per-member throttles) → **order manager** (risk: position limits, fat-finger checks; wallet: reserve cash/shares) → **sequencer** (monotonic seq id and append to the event log) → **matching engine** → outbound sequencer → execution reports to the order manager and gateway.

### Matching engine
- One **single-threaded** engine per symbol (or symbol group), so no locks are needed and results are deterministic.
- Order book: price → level (FIFO doubly linked list) for each side, orderId → node for O(1) cancel, cached best bid/ask. Add at an existing level is O(1). A tick-indexed array gives O(1) new levels too.
- Price-time priority; trades at the maker's price; integer ticks.

### Hitting < 1 ms p99
- All critical components run **on one server** as busy-spin loops on **pinned cores**, communicating through **mmap ring buffers** (Disruptor style), so there are no network hops.
- Pre-allocated pools, so no GC pauses. Avoid syscalls on the hot path, and use kernel-bypass NICs at the gateway.
- Expected numbers: matching in single-digit µs, and internal end-to-end tens of µs. 200K orders/s is modest for a single core per symbol group.

### Durability and failover
- The sequenced **event log is the source of truth** (event sourcing). Book state is derived by replay, with periodic snapshots.
- A **hot-warm** engine pair consumes the identical log. On a hot failure, the warm engine starts publishing at the next seq id.
- Replicate the log to other servers with **Raft** (5 nodes). Only committed entries are acted on externally. A leader election takes 100s of ms, so tune timeouts.

### Market data
The publisher builds L1/L2 and candlesticks from executions and **multicasts** them to colocated members for equal-time delivery. Sequence numbers let subscribers detect gaps and request retransmission.

### Fairness
The sequencer order defines priority. Colocation uses equal cable lengths. Throttles are per member.`,
      followUps: [
        {
          q: 'Why not run matching on a distributed cluster with a database?',
          a: 'Network hops and DB commits add 100s of µs to ms each, and parallel matching on one symbol breaks price-time priority. The state is small enough for memory, and durability comes from the replicated log.',
        },
        {
          q: 'How do you recover after the whole primary site fails?',
          a: 'A DR site replicates the event log (synchronously within a metro area for zero RPO). It replays to the last committed seq and resumes after a controlled halt: exchanges prefer a brief halt over inconsistent books.',
        },
        {
          q: 'How do you prevent a runaway algorithm from flooding the book?',
          a: 'Gateway throttles, order-to-trade ratio limits, price bands and circuit breakers per symbol, and kill switches per member.',
        },
      ],
      pitfalls: [
        'Multi-threaded matching per symbol with locks',
        'A database write per order in the critical path',
        'Floats for prices',
        'No mention of deterministic replay',
      ],
    },
    {
      id: 'design-advanced-iq-3',
      difficulty: 'hard',
      question:
        'We sell API access with per-customer limits (e.g. 5,000 req/s) and serve from 6 regions. Customers complain that they get throttled below their limit, and finance complains that some customers exceed it. Design a global rate limiter.',
      whatInterviewerLooksFor: [
        'Explains why a static split under-serves skewed traffic and a central counter adds latency',
        'Local buckets + demand-weighted quota leasing',
        'Bounded error and explicit failure modes',
        'Algorithm choice (token bucket vs sliding window) and headers',
        'Multi-dimensional limits (endpoint cost, burst)',
      ],
      modelAnswer: `### Diagnosis
Throttling below the limit usually means a **static split**: 5,000 ÷ 6 ≈ 833/s per region, while the customer's traffic is 70% in one region. Exceeding the limit usually means per-instance or fixed-window counters (bursts at window edges, or each pod counting separately).

### Design
1. **Per-region token bucket per customer** in the regional Redis (a Lua script), shared by all gateways in that region. Check cost ~0.3 ms.
2. A **global quota coordinator**: every ~500 ms each region reports consumption and demand (including rejected requests). The coordinator reallocates the global rate proportionally to demand, with a floor per active region (e.g. 5%) so a quiet region can wake up. The shares sum to the limit.
3. The **error bound** comes from the sync interval: traffic shifts between syncs can overshoot by roughly (shift rate × 0.5 s), typically < 2–3%. Contractual hard caps get an extra safety factor, or they're enforced by billing (count exactly offline, and charge overage).
4. **Failure modes:** coordinator down → keep the last shares for N seconds, then fall back to the static split (bounded). Regional Redis down → per-gateway in-memory buckets with limit ÷ gateway count (conservative).
5. **Algorithm:** a token bucket (burst capacity = 1–2 s of rate) or a sliding-window counter. Avoid fixed windows. Weight endpoints by cost (a search call might cost 5 tokens).
6. **Responses:** 429 with Retry-After and RateLimit-Limit/Remaining/Reset headers, plus a dashboard per customer showing throttles by region.

### Alternatives
**Sticky home region** for customers who need strict limits, at the cost of extra latency for their remote traffic. **CRDT counters** (G-Counters merged by gossip) work for sliding windows but converge more slowly.

### Observability
Track allowed/throttled counts per customer per region and compare them with the sum of shares. Alert when global usage exceeds 105% of the limit.`,
      followUps: [
        {
          q: 'How do you handle a customer with 10,000 API keys sharing one limit?',
          a: 'Limit at the account level (one bucket keyed by account id), with an optional per-key sub-limit. Key → account resolution is cached at the gateway.',
        },
        {
          q: 'Why not just use one Redis Cluster spanning regions?',
          a: 'Redis Cluster isn\'t built for cross-region latency. Every check would pay the RTT, and failover across regions is slow and risky.',
        },
      ],
      pitfalls: [
        'Central Redis in one region for every request',
        'Fail-open to unlimited on errors',
        'Fixed window counters',
      ],
    },
    {
      id: 'design-advanced-iq-4',
      difficulty: 'medium',
      question:
        'Design search autocomplete for an e-commerce site with 50M DAU. Suggestions must appear within 100 ms of each keystroke and reflect trending products within minutes.',
      whatInterviewerLooksFor: [
        'QPS estimate including per-keystroke requests and client-side reductions',
        'Trie with cached top-k (or prefix → top-k KV)',
        'Offline build + streaming trending layer',
        'Sharding and caching strategy',
        'Filtering and personalisation boundaries',
      ],
      modelAnswer: `### Numbers
50M DAU × 6 searches × ~8 keystrokes ÷ 86,400 ≈ **28K QPS**, peak ~90K. A 150 ms debounce and browser caching cut that by ~50%.

### Data model
- **Global suggestions:** a trie over normalised queries (lowercased, accents stripped) with the **top 10 cached per node**, keyed by a score = decayed query frequency × conversion rate (e-commerce cares about searches that lead to purchases).
- Materialised as a **prefix → top-10 list** KV (Redis or in-memory on the query nodes). About 30M distinct prefixes × ~500 B ≈ 15 GB, which fits in memory on each replica or can be sharded by prefix range.

### Pipelines
- **Batch (daily):** search logs + orders → aggregate over 30 days with decay → build the trie → snapshot to S3 → query nodes hot-swap (blue/green).
- **Streaming (minutes):** Kafka search events → Flink with a Count-Min Sketch per prefix per 5-minute window → a "trending" top-k per prefix in Redis with a TTL.
- **Query time:** merge global top-k with trending (boost), dedupe, and apply business filters (out-of-stock categories, blocked terms).

### Serving
Query nodes sit behind the LB. Prefixes of length 1–2 are served from CDN edge caches (few distinct values, very hot). Responses carry Cache-Control of a few minutes. p99 is under 20 ms server-side, leaving budget for the network.

### Personalisation
The client merges the user's recent searches (local storage) on top. Server-side, re-rank by the user's category affinity, but keep the cached global lists unpersonalised.

### Trade-offs
Freshness vs cost (streaming layer) and memory vs latency (precomputed top-k per node).`,
      followUps: [
        {
          q: 'How do you handle typos ("iphnoe")?',
          a: 'Fuzzy matching with an edit-distance automaton over the trie, or a SymSpell-style deletion index, used only when the exact prefix returns too few results, since it costs more.',
        },
        {
          q: 'How do you support multiple languages and scripts?',
          a: 'Build a trie per locale, normalise Unicode (NFKC), and add transliteration keys (e.g. Hinglish to Devanagari) that map to the same entries.',
        },
      ],
      pitfalls: [
        'Traversing the subtree on every request',
        'Hitting the database per keystroke',
        'Personalising the shared cache',
      ],
    },
    {
      id: 'design-advanced-iq-5',
      difficulty: 'expert',
      question:
        'Design an ad serving system that picks and prices an ad for 1M requests/s within 80 ms, while making sure advertisers never overspend their daily budgets by more than 1%.',
      whatInterviewerLooksFor: [
        'Funnel: targeting retrieval → pCTR scoring → auction',
        'Auction mechanics (eCPM, GSP/first-price, reserve)',
        'Budget pacing and near-real-time spend feedback with bounded overspend',
        'Event logging, dedup, fraud filtering, reconciliation',
        'Latency budget per stage',
      ],
      modelAnswer: `### Latency budget (80 ms)
Network/SDK ~20 ms, user features 5 ms, retrieval 10 ms, scoring 20 ms, auction and pacing 2 ms, response 5 ms, with headroom.

### Pipeline
1. **Retrieval:** an in-memory **targeting inverted index** replicated on every ad server (attribute → ad groups), refreshed every few seconds from the campaign DB via CDC. Intersect with request attributes, filter by frequency caps (a per-user counter in Redis) and by budget status, giving ~1,000 candidates.
2. **Scoring:** a pCTR/pCVR model on CPU (GBDT or a small DNN) using the feature store's online values.
3. **Auction:** eCPM = bid × pCTR × 1000 × quality, with a reserve price, then GSP (pay the next score ÷ own pCTR) or first-price with bid shading, depending on the marketplace.

### Budget control with ≤1% overspend
- A **spend service** aggregates impression and click costs from Kafka in near real time (Flink, 1–2 s latency) and publishes remaining budget per campaign.
- Ad servers hold a **local budget allowance** leased from the spend service in small chunks (e.g. 0.1% of the daily budget). A server can't spend beyond its lease, so worst-case overspend ≈ in-flight leases + events in the pipeline. Size leases so that sum ≤ 1%.
- **Pacing:** a per-campaign throttle probability p is updated every minute by a controller that tracks spend against the target curve (the traffic shape across the day). That avoids spending the budget by 10 AM.
- Near the end of the budget, shrink the lease size so the approach is precise.

### Counting
Beacons carry signed impression ids. Collectors write to Kafka, a dedup stage (keyed state with a 1-hour TTL) removes duplicates, and a fraud filter (IVT) runs before billing. Hourly **reconciliation** of spend vs billing adjusts invoices, and any overspend beyond the contract is credited back.

### Scale
1M QPS ÷ ~2K QPS per server ≈ 500 ad servers per region. Stateless except the in-memory index.`,
      followUps: [
        {
          q: 'Why not decrement budgets synchronously in a central DB per impression?',
          a: 'A central DB at 1M writes/s would be a hotspot per big campaign and add latency. Leasing gives bounded error without a synchronous dependency.',
        },
        {
          q: 'GSP vs first-price: which would you pick for a new marketplace?',
          a: 'First-price is simpler and transparent for programmatic bidders, and the industry largely shifted to it in 2019. GSP is still common in search and owned-and-operated ads. Mention bid-shading dynamics either way.',
        },
      ],
      pitfalls: [
        'Running a heavy model on all ads in the inventory',
        'Counting clicks without dedup and fraud filtering',
        'No pacing, so the budget is exhausted early in the day',
      ],
    },
    {
      id: 'design-advanced-iq-6',
      difficulty: 'hard',
      question:
        'Design the home-feed recommendation system for a video app with 200M DAU and a 100M-item catalogue. How do you serve it in under 200 ms and keep it improving?',
      whatInterviewerLooksFor: [
        'Multi-stage funnel with sizes at each stage',
        'Embeddings + ANN for retrieval; multiple candidate sources',
        'Feature store and training/serving skew',
        'Logging and training loop; offline/online evaluation',
        'Cold start and diversity',
      ],
      modelAnswer: `### Funnel
- **Candidate generation (100M → ~2K):**
  - A two-tower model: item embeddings are computed offline and indexed in ANN (HNSW, sharded), and the user embedding is computed online from recent watches. That returns the top 800.
  - Co-visitation lists for the last 20 watched items (precomputed), ~600.
  - Subscriptions and new uploads from followed creators, ~300.
  - Trending by region and language, plus a fresh-content exploration pool, ~300.
- **Ranking (~2K → ~200):** a multi-task DNN predicting click, expected watch time, like, share and "not interested", combined into one utility score with tuned weights. Features: user aggregates, item aggregates, user×item crosses, and context.
- **Re-rank (→ 30):** diversity (creator and topic caps, MMR), dedupe of items already seen (via a Bloom filter per user of recent impressions), freshness boosts, and policy/safety filters.

### Serving (200 ms p99)
Feature fetch runs in parallel from the online store (Redis/Cassandra), ~15 ms. ANN takes ~10 ms. Ranking 2K items on GPUs (batched) or CPU with a distilled model takes ~40 ms. Cache the first page per user for a few minutes and precompute for users about to open the app (push-triggered).

### Learning loop
Log impressions **with the feature values used at serving time** → Kafka → training examples joined with labels (watch time arrives later, so use a delayed-join window) → daily full retrain plus hourly incremental → offline eval (AUC and NDCG, per segment) → a shadow run → an **A/B test** on watch time and 7-day retention → ramp up.

### Cold start
New users: onboarding topics plus popularity by geo and language, with bandits for exploration. New items: content embeddings (title, thumbnail, audio) and a guaranteed exploration slice with fast feedback.

### Pitfalls to avoid
Feedback loops (popularity bias, so keep exploration traffic), label leakage, and training/serving skew (a single feature-definition registry).`,
      followUps: [
        {
          q: 'How do you update item embeddings for millions of new uploads per day?',
          a: 'Compute content-based embeddings at upload time and insert them into the ANN index incrementally (HNSW supports inserts). Rebuild or retrain the collaborative embeddings daily, and swap indexes blue/green.',
        },
        {
          q: 'Offline AUC improved but the A/B test shows lower retention. Why?',
          a: 'The model may over-optimise clicks (clickbait), there may be distribution shift or skew between offline features and serving, or the metric may be misaligned. Check the per-objective metrics and add long-term engagement to the utility.',
        },
      ],
      pitfalls: [
        'Scoring the full catalogue per request',
        'Single retrieval source (no exploration, no freshness)',
        'Training on features recomputed later instead of logged at serve time',
      ],
    },
    {
      id: 'design-advanced-iq-7',
      difficulty: 'expert',
      question:
        'You are building a multi-tenant project-management SaaS (think Jira). One enterprise tenant with 80K users is causing slowdowns for thousands of small tenants on the same database, and a bank prospect demands data isolation. How do you architect tenancy?',
      context: 'Atlassian/Salesforce-style question; the interviewer wants concrete isolation mechanics.',
      whatInterviewerLooksFor: [
        'Articulates silo/pool/bridge/cell options with trade-offs',
        'Tenant directory and tenant migration strategy',
        'Enforcement of tenant isolation in the data layer (RLS, keys)',
        'Noisy-neighbour controls at API, queue and DB level',
        'Compliance features: residency, BYOK, per-tenant backup/restore',
      ],
      modelAnswer: `### Tenancy model: tiered bridge + cells
- **Pool** for the long tail: shared Postgres clusters with tenant_id on every row and in every index prefix, **RLS policies with FORCE**, and the tenant set per transaction. That's cheap, with one schema to migrate.
- **Cells:** N identical stacks (app + DB + cache + queues), each hosting a set of tenants. A bad deploy or noisy tenant affects one cell, not everyone.
- **Silo tier** for regulated or enterprise tenants: a dedicated DB (or a dedicated cell) with per-tenant KMS keys (BYOK) and a chosen region for residency. It's priced accordingly.

### Tenant directory
A \`tenant → {cell, db shard, region, tier}\` map, cached at the edge. Routing happens at the gateway via subdomain or JWT claim.

### Moving the 80K-user tenant out
Provision a dedicated cell, copy the tenant's rows (filtered by tenant_id), stream ongoing changes via CDC (logical replication filtered by tenant), verify counts and checksums, freeze writes for that tenant for seconds, flip the directory, and drain. Rehearse it, and make it a routine tool.

### Noisy-neighbour controls
- **API:** per-tenant rate limits and concurrency caps at the gateway, weighted by plan.
- **Async work:** per-tenant queues or fair-share scheduling, so one tenant's bulk import can't starve others. Cap workers per tenant.
- **DB:** statement timeouts, per-tenant connection budgets, query-cost guards (e.g. JQL complexity limits), and read replicas for reporting.
- **Cache:** namespace keys by tenant and cap per-tenant memory.

### Isolation assurance
The tenant context propagates via AsyncLocalStorage and message headers, and the system fails closed without a tenant. Automated tests try cross-tenant access. Every log and metric is tagged with the tenant for audits and cost attribution.

### Operations
Schema migrations roll out cell by cell (a canary cell first). Per-tenant backup and restore is supported by logical export per tenant in pooled DBs.`,
      followUps: [
        {
          q: 'Schema-per-tenant in Postgres: good idea at 50K tenants?',
          a: 'Usually not. Catalog bloat (50K × tables), slow migrations and connection-pool fragmentation. It\'s fine for hundreds of tenants, while pooled with RLS or DB-per-tenant for enterprises scales better.',
        },
        {
          q: 'How do you restore a single tenant\'s accidentally deleted project in a pooled DB?',
          a: 'Use PITR into a scratch instance, extract that tenant\'s rows by tenant_id and project, and re-import with conflict checks. Soft deletes with a retention period make most cases trivial.',
        },
      ],
      pitfalls: [
        'Relying only on application WHERE clauses for isolation',
        'No way to migrate tenants between shards',
        'Single global queue for all tenants\' background jobs',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-advanced-boe-1',
      question:
        'Estimate the Redis memory and write throughput for a real-time leaderboard with 300M monthly players across daily, weekly and monthly boards, and how many shards you need.',
      assumptions: [
        '300M members on the monthly board; daily board holds ~60M (DAU), weekly ~150M',
        'ZSET cost ≈ 100 bytes per member (member string ~20 B + skip list + dict overhead)',
        '60M DAU × 10 matches/day; each match updates 3 boards',
        'Usable memory per Redis node 50 GB; target ≤ 50K writes/s per node',
      ],
      steps: [
        { label: 'Members across boards', calc: '300M + 150M + 60M = 510M entries' },
        { label: 'Memory', calc: '510M × 100 B ≈ 51 GB (+ replicas ×2 = 102 GB)' },
        { label: 'Write QPS', calc: '60M × 10 × 3 ÷ 86,400 ≈ 20.8K/s avg; peak ×5 ≈ 104K/s' },
        { label: 'Shards by memory', calc: '51 GB ÷ 50 GB → 2 primaries minimum; add headroom → 4' },
        { label: 'Shards by writes', calc: '104K ÷ 50K ≈ 3 primaries → 4 primaries + 4 replicas' },
      ],
      answer:
        'About 51 GB of sorted-set data and ~100K writes/s at peak: 4 primaries (one per board type plus headroom, or score-range shards for the monthly board) with 1 replica each.',
      insight:
        'Even at 300M players the leaderboard is small. Sharding is driven by peak write rate and failover blast radius, not memory. Putting each board type on its own shard keeps each board\'s rank queries single-shard and avoids scatter-gather entirely.',
      followUps: [
        {
          "q": "A tournament weekend drives peak writes to 10× average instead of 5×. What breaks first, and what is the cheapest fix?",
          "a": "Writes go from ~104K/s to ~208K/s. At 50K writes/s per node that needs about 4.2 nodes' worth of write capacity, and if each board lives on its own shard, the monthly board alone takes a third of all writes and is the first to saturate. The cheapest fix is to stop writing each match three times synchronously: send score events to a queue and have a consumer coalesce updates per user over 100–500 ms, then pipeline ZINCRBY in batches. That cuts the ops count sharply for active players, at the cost of sub-second freshness."
        },
        {
          "q": "The monthly board's primary fails over and the replica is 1 second behind. How many score updates could be lost, and how do you recover them?",
          "a": "At ~104K writes/s peak across three boards, the monthly board takes roughly a third, so about 35K updates could be missing for up to a second. Since Redis is an index, not the source of truth, recover from the durable event log: each event has an offset, the consumer stores the last applied offset alongside the data, and after failover it replays from a safe point a few seconds earlier. ZINCRBY replay would double-count, so replays must be idempotent: either recompute scores with ZADD from the DB totals, or track applied event ids."
        }
      ],
    },
    {
      id: 'design-advanced-boe-2',
      question:
        'An exchange processes 1B orders/day (Ch 13). Estimate peak event rate, event-log size per day, and whether one matching thread per symbol is enough.',
      assumptions: [
        '1B orders over 6.5 trading hours; peak = 5× average',
        'Each order produces ~2.5 events on average (new, partial/full fills, cancels)',
        'Event size ≈ 100 bytes (binary encoding)',
        '100 symbols; the busiest symbol takes 8% of traffic',
        'A single-threaded matching loop handles ~1–5M events/s',
      ],
      steps: [
        { label: 'Average order rate', calc: '1B ÷ 23,400 s ≈ 42.7K orders/s' },
        { label: 'Peak order rate', calc: '42.7K × 5 ≈ 214K orders/s' },
        { label: 'Peak events', calc: '214K × 2.5 ≈ 534K events/s' },
        { label: 'Busiest symbol', calc: '534K × 8% ≈ 43K events/s' },
        { label: 'Log size', calc: '1B × 2.5 × 100 B = 250 GB/day (+ replicas via Raft ×5 ≈ 1.25 TB/day)' },
      ],
      answer:
        'About 214K orders/s and ~530K events/s at peak. The busiest symbol needs only ~43K events/s, 20–100× below a single thread\'s capacity. The event log is ~250 GB/day per copy.',
      insight:
        'Throughput is not the constraint, so a single-threaded, lock-free engine per symbol is safe and deterministic. The engineering budget goes into tail latency (no GC, no hops) and replication. 250 GB/day fits on local NVMe, so the log can stay on the hot box with daily archiving.',
      followUps: [
        {
          "q": "A volatile open pushes peak to 10× average and the busiest symbol to 8%. Does one thread per symbol still hold?",
          "a": "Peak orders double to about 427K/s, events to about 1.07M/s, and the busiest symbol to about 85K events/s. A single-threaded matching loop handles 1–5M events/s, so the busiest symbol is still 10–60× under capacity. What breaks first is everything around the engine: the sequencer, which must handle all 1.07M events/s on one total order, and market-data fan-out to thousands of subscribers. So the answer is to partition sequencers by symbol group and use multicast for market data, not to multithread matching."
        },
        {
          "q": "A teammate proposes JSON events at ~500 bytes for easier debugging. What does that cost?",
          "a": "Log volume grows from 250 GB/day to 1 × 10^9 × 2.5 × 500 B = 1.25 TB per copy per day, and to over 6 TB/day with five Raft replicas. It also slows the hot path: JSON serialisation costs microseconds and allocates, which feeds the GC problem you were removing. Keep a fixed-layout binary encoding (SBE-style) on the hot path and build debugging tooling that decodes it, plus an offline converter to JSON for analytics. Debuggability belongs in tooling, not in the wire format."
        }
      ],
    },
    {
      id: 'design-advanced-boe-3',
      question:
        'Size a distributed cache tier for a social app: 8M reads/s, 95% hit ratio target, 40 TB working set, 1 KB average value. How many nodes, and what is the load on the database behind it?',
      assumptions: [
        'Redis/Memcached node: 64 GB RAM, ~48 GB usable for data; ~150K ops/s per node comfortably; 25 Gbps NIC',
        'Per-item overhead ≈ 80 B on top of the 1 KB value',
        '1 replica per shard for availability',
        'DB can serve ~50K QPS per replica',
      ],
      steps: [
        { label: 'Items', calc: '40 TB ÷ 1 KB ≈ 40B items; with overhead ≈ 43 TB' },
        { label: 'Nodes by memory', calc: '43 TB ÷ 48 GB ≈ 900 primaries' },
        { label: 'Nodes by QPS', calc: '8M ÷ 150K ≈ 54 → memory dominates' },
        { label: 'Network per node', calc: '8M × 1 KB ÷ 900 ≈ 8.9 MB/s per node (~71 Mbps) → trivial' },
        { label: 'Total with replicas', calc: '900 × 2 = 1,800 nodes' },
        { label: 'DB load on misses', calc: '8M × 5% = 400K QPS → ~8 DB replicas; at 90% hit it doubles to 800K' },
      ],
      answer:
        '~900 primaries (1,800 with replicas), sized by memory. The database behind it still sees ~400K QPS at a 95% hit ratio.',
      insight:
        'Each point of hit ratio is worth ~80K DB QPS here, so hit-ratio SLOs, hot-key handling and gutter pools during node failures are what protect the database. Because memory drives node count, compressing values (e.g. 1 KB → 400 B) would cut the fleet by more than half.',
      followUps: [
        {
          "q": "Finance wants the cache bill halved. Which assumption do you attack first, and what does the fleet become?",
          "a": "Attack the value size, because memory sets the node count. Compressing 1 KB values to about 400 B (LZ4/Zstd on JSON usually gets 2–3×) gives 40B × 480 B ≈ 19.2 TB, or about 400 primaries instead of 900, which is more than a 50% cut. The next lever is the working set: if 40 TB includes long-tail items read once a month, an LFU policy at 20 TB might still hold 90%+ of hits. Before changing anything, check the hit-ratio curve, since each point of hit ratio costs about 80K DB QPS."
        },
        {
          "q": "One availability zone holding a third of the cache nodes goes down. What does the database see?",
          "a": "If replicas are in other zones, failover promotes them and the effect is small. If primary and replica were in the same zone, a third of the keyspace misses: 8M × 1/3 × 95% ≈ 2.5M additional DB reads/s on top of the normal 400K, which is about 7× normal DB load and will take it down. Prevent it by placing replicas in a different zone than their primary, using a gutter pool that absorbs misses for failed nodes, and having the DB layer shed or queue requests beyond capacity so it degrades instead of collapsing."
        }
      ],
    },
  ],
  test: [
    {
      id: 'design-advanced-mcq-01',
      difficulty: 'hard',
      question:
        'A leaderboard stores monthly points in a Redis ZSET. Two players both have 1,200 points. With the code below, who ranks higher, and why might support complain?',
      code: {
        language: 'typescript',
        code: `await redis.zincrby('lb:2026-09', 10, 'user:zed');     // reached 1200 on Sep 3
await redis.zincrby('lb:2026-09', 10, 'user:amy');     // reached 1200 on Sep 20
const top = await redis.zrevrange('lb:2026-09', 0, 1);`,
      },
      options: [
        'user:zed ranks higher, because ZREVRANGE orders equal scores by reverse lexicographic member name, not by who got there first; with other names the order could flip',
        'user:zed ranks higher, because Redis keeps insertion order for equal scores',
        'user:amy ranks higher, because the most recent update wins ties',
        'The order is random and can change on every call',
      ],
      correct: [0],
      explanation:
        'Redis orders equal scores lexicographically by member. ZREVRANGE reverses that, so "user:zed" > "user:amy" puts zed first here, but only by accident of naming. It is deterministic, not random, and it ignores time. To rank the earlier achiever higher, encode time into the score (composite score). Redis does not keep insertion order, and it does not favour recent updates.',
      followUps: [
        {
          "q": "You encode time into the score as `points × 2^32 + (2^32 − 1 − secondsSinceMonthStart)`. Why must the time part be inverted, and what is the precision limit?",
          "a": "ZREVRANGE returns the highest score first, so the earlier achiever needs the larger fractional part; inverting the elapsed seconds does that. A double holds integers exactly up to 2^53, so with 32 bits reserved for time you have 21 bits (~2M) left for points. If points can exceed that, shrink the time field (minutes instead of seconds needs only ~16 bits for a month) or keep ties in a secondary structure. Always validate the bound in the write path, because silent rounding reorders players without any error."
        },
        {
          "q": "Product now wants ties broken by fewest matches played instead of time. Can the same ZSET still do it?",
          "a": "Yes, as long as the tie-break is a bounded integer you can pack: score = points × K + (K − 1 − matchesPlayed), with K above the maximum matches in a month (say 2^16). The catch is that matchesPlayed changes on every match even when points do not, so every match result rewrites the score, which you already do. If the business wants a multi-level tie-break (points, then matches, then time), the bit budget runs out quickly; then you rank by points in Redis and resolve ties within the equal-points band in the application, since tie groups are small."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-02',
      difficulty: 'expert',
      question:
        'You shard a 2B-member leaderboard. Select ALL statements that are correct.',
      options: [
        'With fixed score-range shards, global rank = local ZREVRANK + the sum of ZCARD of all higher-range shards',
        'With hash sharding, the global top 10 needs the top 10 from every shard, merged',
        'With hash sharding, exact global rank is a single O(log n) ZREVRANK on the user\'s shard',
        'With score-range shards, a score update may require moving the user between shards',
        'Score-range shards are automatically balanced because scores are uniformly distributed',
      ],
      correct: [0, 1, 3],
      explanation:
        'Score ranges make rank computable from the local rank plus the sizes of higher shards, but updates can cross band boundaries (remove + add). Hash sharding needs scatter-gather for the top K, and for exact rank it must count members above the score on every shard, so a local ZREVRANK alone is wrong. Real score distributions are heavily skewed toward low scores, so ranges must be sized from data and rebalanced.',
      followUps: [
        {
          "q": "You chose score-range shards. A user's update crosses a band boundary, and the process crashes between ZREM on the old shard and ZADD on the new one. What happens and how do you make it safe?",
          "a": "The user vanishes from the leaderboard until something repairs it, and every rank below them is off by one. Make the move idempotent and replayable: the durable score event (in the DB or Kafka) is the source of truth, and the updater applies ZADD to the new shard first, then ZREM from the old one, keyed by the event offset. A crash between the two leaves a brief duplicate, which is less harmful than a missing user, and replaying the event finishes the move. A periodic reconciler that compares ZCARD sums with the DB user count catches drift."
        },
        {
          "q": "With hash sharding across 16 shards, how would you answer \"what is my exact global rank\" without a full scan?",
          "a": "Get the user's score, then send `ZCOUNT key (score +inf` to every shard in parallel and sum the results. ZCOUNT is O(log n) on a skip list, so the cost is 16 parallel O(log n) calls, about one network round trip. For very high read rates, approximate ranks outside the top bands are usually acceptable: keep a histogram of score buckets updated asynchronously and show \"top 3.2%\" instead of an exact number, which turns the scatter-gather into one local lookup."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-03',
      difficulty: 'medium',
      question:
        'A resting SELL order for 500 shares at ₹101 is in the book (arrived first), followed by another SELL for 300 at ₹101. A BUY limit order for 600 at ₹102 arrives. What executions occur under price-time priority?',
      options: [
        '600 at ₹102 against the first sell, because the aggressor\'s price sets the trade price',
        '300 at ₹101 against the second sell and 300 against the first, filled pro-rata',
        '500 at ₹101 against the first sell, then 100 at ₹101 against the second sell; the second sell keeps 200 resting',
        '500 at ₹101.5 (midpoint), then 100 at ₹101.5',
      ],
      correct: [2],
      explanation:
        'The incoming buy crosses the best ask (₹101). Trades execute at the resting (maker) price. At the same price level, orders fill in time priority: the first 500 fully, then 100 of the 300, leaving 200. The aggressor\'s limit (₹102) is only a cap. Pro-rata allocation is a different algorithm used by some futures markets. Midpoint pricing is not how continuous limit order books match.',
      followUps: [
        {
          "q": "Same book, but the incoming BUY for 600 at ₹102 is an IOC (immediate-or-cancel) and only 500 shares are available at ₹101. What happens to the rest, and what market-data messages go out?",
          "a": "With only 500 available, the order fills 500 at ₹101 against the first sell, and the unfilled 100 is cancelled instead of resting at ₹102. Market data publishes a trade print (500 @ ₹101), a book update that removes the ₹101 level (or reduces it to zero), and the order owner gets a fill execution report plus a cancel for the remaining 100. The key point is that IOC orders never touch the resting book, so they cannot leave a stale ₹102 bid that others would see."
        },
        {
          "q": "The first seller amends their resting order from 500 to 700 shares at ₹101. Do they keep their time priority?",
          "a": "No. Most exchanges treat a quantity increase or a price change as a cancel plus new order, so the order loses its place and goes behind the 300-share sell. A quantity decrease keeps priority, because it does not harm anyone queued behind. Otherwise a trader could hold the front of the queue with a small order and enlarge it once they see flow coming. The engine implements this by unlinking the order from the price-level FIFO and appending it at the tail with a new sequence number."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-04',
      difficulty: 'hard',
      question:
        'Why does a stock exchange put a sequencer in front of the matching engine rather than letting gateways send orders to the engine directly?',
      options: [
        'To batch orders so the engine runs fewer, larger matches',
        'To encrypt orders before they reach the engine',
        'To distribute orders across multiple matching threads for the same symbol',
        'To impose a single total order on all inbound events, making the engine a deterministic state machine whose state any replica can rebuild by replaying the sequenced log',
      ],
      correct: [3],
      explanation:
        'The sequencer stamps monotonic ids, which defines fairness (who came first), enables gap detection, and makes the engine\'s output a pure function of the input sequence, so hot-warm replicas and replays match exactly. Batching is not its purpose and would add latency. Encryption is a transport concern. Multiple threads per symbol would break determinism and price-time priority.',
      followUps: [
        {
          "q": "The sequencer itself is now a single point of failure. How do you fail it over without breaking the total order?",
          "a": "Run the sequencer as a primary with hot standbys that receive every stamped event before it is released to the engine (or replicate via Raft with a quorum write). The standby knows the last committed sequence number, so on takeover it continues at N+1 with no gaps or duplicates. Gateways resend any order without an acknowledgement, tagged with a client order id, and the new sequencer de-duplicates by that id. Fencing with an epoch number stops a zombie old primary from stamping events, because downstream consumers reject lower epochs."
        },
        {
          "q": "How would you prove in production that the hot-warm replica's book is identical to the primary's?",
          "a": "Because the engine is deterministic, both replicas should emit identical outputs for each input sequence number. Have each publish a rolling checksum (e.g. a hash chain over output events, or a hash of book state every 10K events) and compare them continuously. Any mismatch means non-determinism, such as wall-clock reads, hash-map iteration order or uninitialised memory, and it pages immediately. Replaying the day's sequenced log in a test environment and diffing the output against production is the offline version of the same check."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-05',
      difficulty: 'expert',
      question:
        'The matching engine is a Java service. p50 matching latency is 8 µs, but p99.9 spikes to 40 ms a few times per minute. Select ALL changes likely to fix the tail.',
      options: [
        'Pre-allocate order objects in pools and avoid allocation on the hot path, so GC pauses disappear',
        'Pin the matching thread to an isolated CPU core and busy-spin instead of blocking on a queue',
        'Move the order book into a PostgreSQL table so memory pressure is lower',
        'Replace locks and blocking queues between components with single-writer ring buffers (Disruptor-style)',
        'Add more matching threads per symbol with a lock around the book',
      ],
      correct: [0, 1, 3],
      explanation:
        'Millisecond tail spikes on a µs path are typically GC pauses, OS scheduling/context switches, or lock contention. Object pooling, core pinning with busy-spin, and lock-free ring buffers address those. A database would add network and disk latency to every order. More threads with a lock increase contention and break price-time determinism.',
      followUps: [
        {
          "q": "After pooling objects and pinning cores, p99.9 is 30 µs but you still see a 2 ms spike roughly once an hour. Where do you look next?",
          "a": "Once-per-hour suggests something periodic outside your code: a cron job, log rotation, a kernel task or a JVM safepoint (e.g. a periodic code deoptimisation or biased-lock revocation). Turn on safepoint logging to see time-to-safepoint, check `/proc/interrupts` to confirm the isolated core takes no IRQs, and look for transparent huge page compaction or NUMA page migration. Correlate spike timestamps with system events. Typical fixes are disabling THP, moving IRQs off isolated cores with `isolcpus`/`nohz_full`, and setting `-XX:+UseCountedLoopSafepoints` or removing the periodic tasks."
        },
        {
          "q": "How do you measure a p99.9 of a few microseconds without the measurement itself distorting it?",
          "a": "Take timestamps with a cheap monotonic clock (`System.nanoTime` or rdtsc) at ingress and egress and write them into a pre-allocated ring buffer, never allocate or log on the hot path. A separate thread drains the buffer into an HdrHistogram, which records values in fixed memory with bounded error. Better still, measure on the wire: tap the network with a switch that timestamps packets in hardware, so you see true end-to-end latency, including the NIC and kernel bypass stack, with no instrumentation inside the engine."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-06',
      difficulty: 'hard',
      question:
        'You add a 21st node to a cache cluster of 20 nodes. Compare the fraction of keys that move to a different node with modulo hashing versus consistent hashing with virtual nodes.',
      code: {
        language: 'typescript',
        code: `const nodeModulo = (k: string) => nodes[hash(k) % nodes.length];
const nodeRing   = (k: string) => ring.get(k);   // 160 vnodes per node`,
      },
      options: [
        'Modulo ~1/21 (≈5%); ring ~1/21 (≈5%). They are equivalent',
        'Modulo ~20/21 (≈95%); ring ~1/21 (≈5%)',
        'Modulo ~50%; ring ~1/160 of keys',
        'Modulo ~95%; ring 0%, because virtual nodes absorb new members',
      ],
      correct: [1],
      explanation:
        'With hash % n, changing n from 20 to 21 remaps almost every key (a key stays only if hash mod 20 equals hash mod 21), about 1/21 stay, so ~95% move, a near-total cache flush. With consistent hashing, the new node takes over ~1/21 of the ring, so only those keys move. Virtual nodes smooth the distribution, but the new node must still take its share. The vnode count does not set the moved fraction.',
      followUps: [
        {
          "q": "With consistent hashing, the new 21st node joins cold. What does the database see, and how would you avoid a spike?",
          "a": "About 1/21 of keys (≈4.8%) now map to an empty node, so for a moment those reads all miss, and at 95% hit ratio that can be several times the normal miss rate on that slice. Warm the node before routing to it: copy its key ranges from the previous owners, or route reads to the new node with fallback to the old owner on a miss (dual-read) for a few minutes. Alternatively, add vnodes gradually, e.g. 20 at a time instead of all 160, so the moved fraction grows slowly and the DB absorbs it."
        },
        {
          "q": "Why 160 virtual nodes per node? What goes wrong with 1, and what does a very large number cost?",
          "a": "With one point per node, arc lengths vary wildly, so one node can own 2–3× the average key share, and when a node dies its whole range lands on a single neighbour. With ~100–200 vnodes the standard deviation of load drops to a few percent and a failed node's keys spread across all the others. The costs are the ring size in memory (20 × 160 = 3,200 entries, trivial) and lookup time, which is a binary search, so O(log 3,200). Very large counts mostly increase rebalancing metadata and gossip size."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-07',
      difficulty: 'expert',
      question:
        'A product key receives 400K reads/s during a flash sale. It lives on one Redis Cluster shard that tops out around 120K ops/s. Select ALL effective mitigations.',
      options: [
        'An in-process L1 cache with a 1–2 s TTL on every app server',
        'Replicate the value under N keys (product:42#0..#7) spread across slots, and read a random copy',
        'Resharding the cluster to add more nodes, which spreads a single key\'s traffic automatically',
        'Serve reads for that shard from its replicas (READONLY on replica connections)',
        'Increase maxmemory on the hot node',
      ],
      correct: [0, 1, 3],
      explanation:
        'A single key maps to one slot on one primary, so adding nodes does not split its traffic. The L1 cache absorbs most reads locally, key replication spreads copies across shards, and replica reads add capacity for that shard (with slight staleness). The problem is ops/s, not memory, so maxmemory is irrelevant.',
      followUps: [
        {
          "q": "You add the 1–2 s in-process L1 cache. The price of product 42 changes mid-sale. How stale can a user's view be, and how would you tighten it if finance objects?",
          "a": "Up to the L1 TTL (2 s) plus the time for Redis to update, and different app servers can disagree during that window, so a user refreshing across servers may see the price flip. To tighten it, publish an invalidation on a pub/sub channel when the price changes and have every app server evict the key from L1, which brings staleness down to milliseconds. The real fix for money is that checkout must re-read the authoritative price (or a price version) and reject a mismatch, so the cache only affects display, never what is charged."
        },
        {
          "q": "How would you detect a hot key like this automatically before it saturates the shard?",
          "a": "Sample: each app server counts key accesses in a small count-min sketch or top-k heap over a 1–5 s window and reports the heaviest keys to a central aggregator. Redis also offers `--hotkeys` with LFU eviction and per-command latency stats, but client-side sampling sees traffic before it reaches the server. When a key crosses a threshold (say 20K reads/s), the client library automatically switches it to L1 caching or key replication, and an alert records which key it was, so the mitigation does not depend on a human during the flash sale."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-08',
      difficulty: 'medium',
      question:
        'Facebook\'s memcache uses "leases" on cache misses. Which problem does this primarily solve?',
      options: [
        'Evicting cold keys faster to free memory',
        'Replicating cache contents across regions',
        'Thundering herds and stale sets: only the lease holder may repopulate a missed key, and its SET is rejected if the key was invalidated after the lease was issued',
        'Encrypting values at rest in the cache',
      ],
      correct: [2],
      explanation:
        'A lease token is issued to one client on a miss. Other clients back off briefly or accept stale data, which prevents a herd of DB queries. If a delete arrives before the holder\'s SET, the token is invalidated, so a slow client cannot write an outdated value (a stale set). Eviction, cross-region replication (handled by mcsqueal invalidations) and encryption are unrelated.',
      followUps: [
        {
          "q": "The lease holder crashes after getting the token and never sets the value. What do the other waiting clients do?",
          "a": "Leases carry a short expiry, around 10 seconds in Facebook's design, and the server rate-limits new lease issuance per key (one every few seconds). Other clients get a \"hot miss\" response and retry after a short sleep. Once the lease times out, the next requester gets a new token and goes to the database. So a crashed holder costs a few seconds of delay for that key, not a herd. Clients that can tolerate staleness can also accept the recently deleted value that memcache keeps briefly, so they do not wait at all."
        },
        {
          "q": "You're on Redis, not memcache. How would you implement the same stale-set protection?",
          "a": "Store a version with the value and make the repopulating write conditional. On a miss, the client does `SET lease:k <token> NX PX 5000`; only the winner reads the DB. On writes, the invalidation path deletes `k` and also deletes `lease:k`. The winner then runs a Lua script that sets `k` only if `lease:k` still equals its token, so if an invalidation ran in between, the stale value is discarded. Losers poll `k` with short backoff. This is the same mechanism as leases, built from SET NX plus a compare-and-set script."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-09',
      difficulty: 'expert',
      question:
        'A merchant has a global limit of 1,000 req/s, split statically as 250/s across 4 regions. Its real traffic is 850/s in ap-south-1 and 50/s in each other region. What happens, and what fixes it?',
      options: [
        'ap-south-1 throttles ~600/s while the other regions leave ~600/s of quota unused; demand-weighted shares from a coordinator fix it within the sync interval',
        'Nothing is throttled, because the total (1,000/s) equals the limit',
        'All regions throttle proportionally, which is correct behaviour',
        'The fix is a single central Redis counter, which has no downsides',
      ],
      correct: [0],
      explanation:
        'A static split ignores skew. ap-south-1 allows 250 of its 850 (throttling 600), while the other regions use only 50 of 250 each. Reallocating shares by recent demand (e.g. ~850/50/50/50) honours the global limit without throttling a merchant who is within it. A central counter is exact but adds a cross-region RTT to every request and becomes a global single point of failure.',
      followUps: [
        {
          "q": "With demand-weighted shares synced every 500 ms, the merchant's traffic suddenly shifts from ap-south-1 to eu-west-1 within one second. What does the merchant experience?",
          "a": "eu-west-1 still holds its small share (around 50/s) until the next sync, so it throttles heavily for one or two intervals, while ap-south-1's large share goes unused. That is up to about a second of false throttling. Mitigations: let each region borrow a small burst buffer above its share (e.g. 10% of the global limit) and settle the debt next interval; shorten the sync for merchants whose demand is volatile; or give every region a minimum floor share. The bounded overshoot is the price of local decisions, and you should state it in the SLA."
        },
        {
          "q": "The coordinator is down for 10 minutes. What should each region do with this merchant?",
          "a": "Keep the last-known shares (~850/50/50/50) for a short grace period, because traffic patterns rarely change in seconds. After that, fall back to a conservative static split (250 each). That may throttle ap-south-1, but it can never let the merchant exceed 1,000/s globally. Failing open to unlimited is the dangerous choice if limits protect downstream capacity or are billed. Emit a metric for 'running on stale shares' and alert on it, so a long outage is visible and not just a quiet increase in 429s."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-10',
      difficulty: 'hard',
      question:
        'Forty API pods share this per-minute limiter in one Redis. NTP monitoring shows pod clocks disagree by up to 3 s. Near each minute boundary, some clients get more than their quota through. Why, and what is the best fix?',
      code: {
        language: 'typescript',
        code: `// runs on every API pod
const bucket = Math.floor(Date.now() / 60_000); // pod-local clock
const k = 'quota:' + apiKey + ':' + bucket;
const used = await redis.incr(k);
if (used === 1) await redis.pexpire(k, 120_000);
return used <= LIMIT;`,
      },
      options: [
        'Redis INCR is not atomic across pods, so concurrent increments are lost; wrap the calls in MULTI/EXEC',
        'During the skew interval, pods with fast and slow clocks write to different bucket keys, so a client spread across pods draws on two quotas at once; compute the bucket from Redis TIME inside a Lua script',
        'The 120 s PEXPIRE keeps the previous bucket alive, so its count is added to the new one; set the TTL to exactly 60 s',
        'The pods need a shared lock around INCR so that only one pod updates a key at a time',
      ],
      correct: [1],
      explanation:
        'The window id comes from each pod\'s own clock. For up to 3 s around every boundary, pods disagree on which minute it is, so the same client increments two different keys, each with a full quota. Taking the time from a single source (Redis TIME inside a Lua script, which also makes INCR plus expiry atomic) removes that. INCR is already atomic in Redis, so MULTI/EXEC and a lock fix nothing. The longer TTL only affects cleanup, because each minute uses its own key.',
      followUps: [
        {
          "q": "You move to Redis TIME inside Lua. Now the Redis primary fails over to a replica whose clock is 2 s behind. What happens to the windows?",
          "a": "The new primary's clock defines the bucket, so for 2 seconds it computes the previous minute's bucket id and increments a key that may already hold a full count (requests get rejected) or that has expired (requests get a fresh quota). Either way the error is bounded by the skew and happens once per failover, unlike the old design where it happened every minute. Running chrony on the Redis hosts keeps skew in milliseconds, and switching to a sliding-window or token-bucket algorithm that stores the last timestamp makes small backward jumps harmless (clamp `now` to never go below the stored value)."
        },
        {
          "q": "Even with a single clock, a fixed per-minute window lets a client send 2× LIMIT across a boundary. What would you change if that matters?",
          "a": "Use a sliding-window counter: keep the current and previous minute's counts and estimate usage as `current + previous × (1 − elapsedFraction)`. It costs two keys per client and smooths the boundary burst to within a few percent. If you need exact limits, a sliding log (a ZSET of timestamps) is precise but costs memory per request, which is too much at high volume. A token bucket with capacity equal to the allowed burst is the usual production choice, because burst size becomes an explicit setting instead of an accident."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-11',
      difficulty: 'expert',
      question:
        'Your typeahead trie caches the top 10 completions at each node. Select ALL consequences of this design.',
      options: [
        'Lookup cost becomes O(prefix length) instead of traversing the whole subtree',
        'Updating a query\'s frequency may require updating the cached lists on every ancestor node, so updates are usually batched offline',
        'The trie no longer needs sharding, because each node is small',
        'Memory grows by roughly k references per node, which is acceptable when the trie is built offline',
        'Personalised suggestions can be stored in the same shared nodes without cache pollution',
      ],
      correct: [0, 1, 3],
      explanation:
        'Caching top-k per node trades memory and update cost for O(prefix) reads, so the trie is typically rebuilt offline (plus a streaming trending layer). Sharding is still needed at scale, because the total size grows with the number of nodes, not per-node size. Personalisation in shared nodes would pollute the global cache. It is merged at query time instead.',
      followUps: [
        {
          "q": "The top-10 lists come from an offline rebuild every 6 hours, but a product goes viral within 20 minutes. How do you surface it without rebuilding the whole trie?",
          "a": "Add a small trending layer next to the static trie. A streaming job (Flink or Kafka Streams) counts queries over a sliding window of, say, 15 minutes with exponential decay, and keeps a top-k per short prefix (1–3 characters) in a fast store. At query time the service merges the static top-10 with the trending top-k for that prefix, using a score that blends long-term and short-term frequency. The trending layer is tiny, so it can update every few seconds, while the expensive trie rebuild stays offline."
        },
        {
          "q": "Legal asks you to remove an offensive completion from suggestions within 5 minutes. How do you do that with offline-built cached lists?",
          "a": "Keep a blocklist that is applied as a filter at query time, after reading the cached top-k and before returning results. Because some cached lists will lose an entry, store top-15 or top-20 per node, so you can drop a few and still return 10. The blocklist is small and pushed to all servers through config or pub/sub in seconds. The next offline rebuild then removes the phrase properly. Filtering at read time works for any data source and does not depend on the build pipeline's schedule."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-12',
      difficulty: 'hard',
      question:
        'A web search index is document-partitioned across 2,000 shards. p50 latency is 60 ms but p99 is 900 ms. What is the most effective fix?',
      options: [
        'Switch to term partitioning so each query touches fewer shards',
        'Every query waits for the slowest of 2,000 shards; use hedged/backup requests to replicas after ~p95 latency, and return partial results past a deadline',
        'Increase the result cache TTL, which fixes tail latency for all queries',
        'Reduce the shard count to 20 so fewer shards are involved',
      ],
      correct: [1],
      explanation:
        'With fan-out to N shards, the query latency is roughly the max of N samples, so the tail is dominated by stragglers. Hedged requests (the "tail at scale" technique) and deadline-bounded partial results cut p99 sharply at small extra cost. Term partitioning creates hot shards and cross-network intersections. The cache helps only repeat queries. 20 huge shards would make every shard slower.',
      followUps: [
        {
          "q": "Hedged requests double some load. How much extra traffic does hedging at p95 add, and when could it make things worse?",
          "a": "If you send the backup only when the primary has not responded by the p95 latency, about 5% of shard requests get a second copy, so load rises around 5%, not 2×. It goes wrong when the slowness is caused by overload: if the whole cluster is slow, more requests pass the p95 threshold, hedging adds load just when capacity is short, and that can cause a spiral. Guard it with a hedging budget (cap backups at, say, 5% of traffic) and cancel the losing request when the first response arrives."
        },
        {
          "q": "You return partial results after a deadline. How does the client know, and how do you keep quality from silently decaying?",
          "a": "The response carries a coverage field, e.g. `shardsAnswered: 1987/2000`, and the ranker treats it as a signal. Partial results are acceptable for web search, because a missing shard rarely holds the top result. Track coverage as an SLO: if the fraction of queries with less than 99.5% coverage rises, that points to specific slow shards or replicas. Persistently missing shards are hot or failing hardware and should be re-replicated, instead of being hidden by the deadline."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-13',
      difficulty: 'expert',
      question:
        'In a GSP auction for one slot: ad A bids ₹20/click with pCTR 2%; ad B bids ₹50/click with pCTR 0.5%. Quality = 1, reserve ignored. Who wins, and what does the winner pay per click?',
      code: {
        language: 'text',
        code: `eCPM = bid × pCTR × 1000
price_winner = eCPM_runner_up / (pCTR_winner × 1000)   (+ ₹0.01)`,
      },
      options: [
        'A wins (eCPM ₹400 vs ₹250) and pays ₹250 ÷ (0.02 × 1000) + 0.01 = ₹12.51 per click',
        'B wins (higher bid) and pays ₹20.01',
        'A wins and pays its full bid of ₹20',
        'B wins (eCPM ₹250 vs ₹400 favours the lower number) and pays ₹40',
      ],
      correct: [0],
      explanation:
        'A has eCPM 20 × 0.02 × 1000 = 400, and B has 50 × 0.005 × 1000 = 250, so A wins on expected revenue per thousand impressions. Under GSP, A pays the minimum CPC that keeps its eCPM at or above B\'s: 250 ÷ 20 = ₹12.50, plus an increment. Ranking by raw bid ignores click probability. Paying the full bid describes first-price auctions.',
      followUps: [
        {
          "q": "Advertiser B raises its bid to ₹100/click with the same 0.5% pCTR. Who wins now, and what does the winner pay?",
          "a": "B's eCPM becomes 100 × 0.005 × 1000 = ₹500, which beats A's ₹400, so B wins. Under GSP, B pays the minimum CPC that keeps its eCPM at or above A's: 400 ÷ (0.005 × 1000) = ₹80, plus ₹0.01. Even though B bid ₹100, it pays ₹80.01. The platform's expected revenue per thousand impressions is ₹400 either way here, set by the runner-up. That is why GSP revenue depends so heavily on how competitive the second bid is, and why reserve prices matter in thin auctions."
        },
        {
          "q": "The pCTR model is overconfident for new ads and gives them 3% when the true rate is 1%. What does that do to the auction and to revenue?",
          "a": "New ads win slots they should lose, because their inflated eCPM outranks better established ads. They also pay less per click than they should, since the GSP price divides the runner-up's eCPM by the winner's pCTR, so a high pCTR lowers the CPC. The platform shows ads that are clicked a third as often as predicted, so actual revenue per impression falls. Fixes: calibrate the model (e.g. isotonic regression checked against observed CTR), shrink new-ad predictions toward a prior, and monitor the calibration ratio of predicted to actual CTR per segment."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-14',
      difficulty: 'medium',
      question:
        'A recommendation model shows +3% AUC offline, but in production engagement drops. Investigation shows the "user_last_7d_watch_minutes" feature is computed by a batch job for training but by a different streaming job online. What is this issue called, and what is the standard fix?',
      options: [
        'Cold start; add popularity-based candidates',
        'Overfitting; add dropout',
        'Training/serving skew; define features once in a feature store and log the online feature values at serving time for training',
        'Position bias; shuffle the results',
      ],
      correct: [2],
      explanation:
        'Different code paths for the same feature produce different values offline and online, so the model learns relationships it never sees in production. A feature store with shared definitions, point-in-time correct offline joins, and logging of served features into training data prevents this. Cold start, overfitting and position bias are real issues, but they do not match the evidence of two divergent pipelines.',
      followUps: [
        {
          "q": "You can't rebuild the pipeline this quarter. How would you detect and quantify the skew on this feature right now?",
          "a": "Log the feature value that the online service actually used for each request, joined by request id. Then recompute the same feature offline with the batch job for the same users and timestamps and compare the two distributions: the mean difference, the fraction of rows where they differ by more than 10%, and population stability index. If the streaming job lags (e.g. 2 hours behind) or uses a different window boundary (UTC vs local time), it will show up immediately. Then, as a stopgap, retrain the model on the logged online values so it learns from what serving really sees."
        },
        {
          "q": "Even with a feature store, the training join must be \"point-in-time correct\". What bug does that prevent here?",
          "a": "Label leakage. If training joins each impression with the current value of `user_last_7d_watch_minutes` instead of its value as of the impression's timestamp, the feature includes watching that happened after (and partly because of) the recommendation. The model learns that this feature predicts engagement strongly, but online it never has that future information, so offline AUC is inflated and the online result is worse. Point-in-time joins look up the latest feature row with a timestamp at or before the event time."
        }
      ],
    },
    {
      id: 'design-advanced-mcq-15',
      difficulty: 'expert',
      question:
        'A pooled multi-tenant app uses Postgres RLS. A tester still reads another tenant\'s rows through a reporting endpoint. Given this setup, what is the most likely cause?',
      code: {
        language: 'sql',
        code: `ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
CREATE POLICY t ON invoice USING (tenant_id = current_setting('app.tenant_id')::uuid);
-- app connects as role 'app_owner', which created the invoice table
-- pgbouncer in transaction pooling mode
-- per request: SET app.tenant_id = '<tenant>';   (session-level SET, outside a txn)`,
      },
      options: [
        'RLS does not support uuid comparisons',
        'current_setting() is evaluated once at policy creation, so all requests see the first tenant',
        'The reporting endpoint uses a read replica, and RLS policies do not replicate',
        'Two problems: the table owner bypasses RLS unless FORCE ROW LEVEL SECURITY is set, and a session-level SET under transaction pooling can leak to another client\'s transaction on the same server connection. Use FORCE, a non-owner role, and set_config(..., true) inside each transaction',
      ],
      correct: [3],
      explanation:
        'Table owners and superusers bypass RLS by default. FORCE ROW LEVEL SECURITY (or connecting as a non-owner role) is required. With pgbouncer transaction pooling, a session-level SET stays on a server connection that the next transaction may reuse for another tenant, so the setting must be transaction-local. uuid comparisons work. current_setting is evaluated per query. Policies are schema objects, so they replicate with physical replication.',
      followUps: [
        {
          "q": "You fix it with FORCE RLS and transaction-local `set_config`. How would you test that the isolation actually holds and stays holding?",
          "a": "Write an integration test that creates two tenants, inserts rows for each, and then calls every endpoint as tenant A, asserting that no tenant B id ever appears. Run it under pgbouncer in transaction mode with concurrent requests, because the leak only shows up when connections are reused. Add a CI check that every table with a `tenant_id` column has RLS enabled and forced (query `pg_class.relrowsecurity` and `relforcerowsecurity`). In production, a canary tenant with synthetic data that alerts if it is ever returned to another tenant gives you continuous evidence."
        },
        {
          "q": "The reporting endpoint runs heavy aggregation queries. With RLS, they got 4× slower. Why, and how do you fix it without dropping isolation?",
          "a": "The policy adds `tenant_id = current_setting(...)` to every query. If indexes don't lead with `tenant_id`, the planner may scan large ranges and filter afterwards, and `current_setting` calls in a non-leakproof context can block some optimisations. Put `tenant_id` first in composite indexes, partition large tables by tenant hash, and mark the setting lookup as a stable function. For heavy reporting, move to per-tenant pre-aggregated tables or a separate analytics store where isolation is enforced by the ETL, so OLTP RLS isn't on the reporting path."
        }
      ],
    },
  ],
};

export default topic;
