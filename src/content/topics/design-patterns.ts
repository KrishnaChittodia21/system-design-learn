import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-patterns',
  phase: 'designs',
  order: 0,
  title: 'The Recurring Patterns: Recognise the Problem Shape, Pick the Solution Ladder',
  subtitle:
    'Seven problem shapes cover most design prompts. Learn the phrases that reveal each one, the ladder of solutions from simple to advanced, the numbers at which each rung breaks, and where the app already works each pattern end to end.',
  estimatedMinutes: 80,
  sources: [
    'Hello Interview — System Design in a Hurry: Delivery framework and the Patterns list (Real-time Updates, Dealing with Contention, Multi-step Processes, Scaling Reads, Scaling Writes, Handling Large Blobs, Managing Long-Running Tasks) — hellointerview.com/learn/system-design/in-a-hurry/patterns',
    'Hello Interview — pattern pages: scaling-reads, scaling-writes, long-running-tasks (framing only; all text here is original)',
    'Martin Kleppmann — Designing Data-Intensive Applications, Ch 5–7, 11',
    'AWS S3 documentation — multipart upload limits and presigned URLs',
  ],
  tags: [
    'patterns',
    'pattern-recognition',
    'real-time',
    'contention',
    'multi-step',
    'scaling-reads',
    'scaling-writes',
    'blobs',
    'long-running-tasks',
    'interview-framework',
  ],
  cheatSheet: [
    'Seven shapes: Real-time Updates · Contention · Multi-step Processes · Scaling Reads · Scaling Writes · Large Blobs · Long-Running Tasks. Most prompts are 2–3 of them; name them out loud after requirements.',
    'Real-time ladder: poll (fine to ~10K clients at 5–30 s) → long-poll → SSE (one-way, HTTP-friendly) → WebSocket (two-way) + a pub/sub backbone (Redis/Kafka) once there is more than one connection server.',
    'Contention ladder: DB transaction + row lock → optimistic version check → atomic conditional UPDATE / Redis Lua → reservation with TTL → queue/serialise per key. A single hot row tops out near 1 / lock-hold-time (2 ms ≈ 500 writes/s).',
    'Multi-step ladder: synchronous chain → persisted state machine + outbox → saga with compensations → durable workflow engine (Temporal/Step Functions) when steps span hours or humans.',
    'Scaling reads ladder: indexes → cache-aside (90% hit = 10× less DB load) → read replicas (lag!) → CDN/edge → precomputed/denormalised read models. Fix the query before adding boxes.',
    'Scaling writes ladder: batch + async (queue absorbs bursts) → vertical/partition → shard by the write key → pre-aggregate in memory/stream → LSM/log-structured stores. Replicas never add write capacity.',
    'Large blobs: bytes never transit your app servers. Presigned PUT (≤ ~100 MB) → multipart/resumable (parts ≥ 5 MiB, ≤ 10,000 parts) → object-store event → async processing → CDN for reads. Metadata row tracks state.',
    'Long-running tasks: if p99 > ~2–5 s or the LB idle timeout (ALB 60 s) is in reach, return 202 + job id, enqueue, workers with heartbeats/visibility timeout, status via poll/SSE/webhook, retries + DLQ.',
    'Recognition tells: "live/instantly" → real-time; "only one / limited / no double" → contention; "then… then… if it fails" → multi-step; "millions view" → reads; "every click/ping/event" → writes; "upload/video/file" → blobs; "generate/transcode/crawl/report" → long-running.',
    'Pattern collisions are where seniors score: hot-key contention vs write scaling (shard the counter, reconcile), real-time vs scaling writes (fan-out amplification), blobs vs long-running (upload done ≠ processing done).',
  ],
  sections: [
    {
      heading: 'Pattern recognition: why seven shapes beat fifty memorised designs',
      body: `**Intuition.** A doctor does not memorise every patient; she recognises syndromes. "Fever + rash + joint pain" points to a short list. System-design prompts work the same way: "book a seat", "claim a coupon" and "assign a driver" are the same syndrome (**contention**) wearing different clothes. If you can name the syndrome in minute 8, you already know the ladder of treatments and the numbers that decide how far up it you must climb.

**Where recognition fits in the 45-minute flow.** Requirements (5 min) → core entities (2 min) → API (5 min) → high-level design (10–15 min) → deep dives (10 min). The patterns are the **bridge from requirements to deep dives**: once the functional and non-functional requirements are written down, scan them for the tell-tale phrases below and say, "This system has three hard parts: real-time location updates, contention on drivers, and a high write rate from pings. I'll keep the high-level design simple and spend the deep dives on those."

**The seven shapes and their tells**

| Pattern | Phrases in the prompt or requirements | The core question |
|---|---|---|
| Real-time Updates | "live", "instantly", "see it as it happens", "typing indicator", "tracking" | How does the server push to clients, and how do events reach the right connection server? |
| Dealing with Contention | "only one", "limited stock", "no double booking", "first come first served", "bid" | Who wins when many actors want the same thing at the same moment? |
| Multi-step Processes | "then", "after payment", "if X fails, undo", "order lifecycle", "approval" | How do we finish or cleanly undo a process that spans services and time? |
| Scaling Reads | "millions view", "home page", "popular", "read-heavy 100:1" | How do we serve the same data many times without hitting the source each time? |
| Scaling Writes | "every click", "pings every 4 s", "events", "metrics", "logs", "likes" | How do we absorb more writes than one machine can commit? |
| Handling Large Blobs | "upload", "photo", "video", "attachment", "file sync" | How do big bytes move without crushing app servers, and how do metadata and bytes stay consistent? |
| Long-Running Tasks | "generate", "transcode", "crawl", "report", "export", "run code" | How do we accept work instantly and finish it reliably later? |

**How to use this topic.** Each pattern section gives: the problem shape, the solution ladder (simple to advanced) with the number at which each rung breaks, the key trade-offs, and **See it applied** links to sections of this app that work the pattern in a full design. This topic teaches recognition and selection; the linked sections teach mechanics. A link like "→ design-commerce §5" means topic \`design-commerce\`, section 5.

**The senior move.** Start every pattern at the lowest rung that meets the stated numbers, and say what number would make you climb. "Polling every 10 s is fine for 5K dashboard users; at 500K concurrent users with sub-second freshness I'd move to SSE with a Redis pub/sub backbone." That sentence shows judgment; jumping to Kafka plus WebSockets for a 5K-user admin panel shows the opposite.`,
      diagram: `  REQUIREMENTS --scan tells--> PATTERNS --pick rung by numbers--> DEEP DIVES
       |                          |                                  |
  "drivers ping every 4s"   Scaling Writes          shard by geo cell
  "rider sees car move"     Real-time Updates       WS gateway + pub/sub
  "one driver per trip"     Contention              conditional assign
       |                          |                                  |
       +------ 2-3 patterns per prompt; spend deep-dive time on them -+`,
      keyPoints: [
        'Name the patterns out loud right after requirements; it frames the whole deep-dive budget.',
        'Each pattern has a ladder; start at the lowest rung that meets the stated numbers.',
        'Always state the number that would make you climb the next rung.',
        'Most prompts combine 2–3 patterns; the collisions between them are where senior signal lives.',
      ],
      source: 'Hello Interview — Delivery framework and Patterns (framing); original synthesis',
    },
    {
      heading: 'Real-time Updates: from polling to push with a pub/sub backbone',
      body: `**Problem shape.** Something changes on the server (a message, a driver location, a bid, a price) and one or many clients must see it within a latency budget, usually under 1–2 s. Two sub-problems hide inside: **(a) the last mile** — how bytes get from a server to a browser or app; **(b) the routing** — how an event produced on server A reaches the connection that lives on server B.

**Tell-tale phrases:** "live", "real-time", "instantly", "see the car move", "typing…", "online now", "live comments", "notify when price drops" (this last one is often *not* real-time; a push notification within minutes is fine).

**The ladder**

| Rung | Mechanism | Works until | Breaks because |
|---|---|---|---|
| 1. Short polling | Client GETs every N s | ~10K clients at 5–30 s intervals | 1M clients at 5 s = 200K QPS of mostly empty responses; freshness = N/2 on average |
| 2. Long polling | Server holds the request until data or ~30 s timeout | Low-frequency events, legacy proxies | One request per event; reconnect storms; still stateful on the server while held |
| 3. SSE | One HTTP response streamed forever, server → client | One-way feeds: scores, prices, notifications, LLM tokens | No client → server channel (use normal POSTs); HTTP/1.1 limits ~6 per origin |
| 4. WebSocket | Full-duplex, long-lived TCP | Chat, games, collaborative editing, driver apps | Stateful servers: deploys, LB affinity, heartbeats, ~50K–1M sockets per box depending on tuning |
| 5. + Pub/sub backbone | Redis pub/sub, NATS or Kafka between producers and connection servers | Any multi-server setup | Fan-out amplification: one event to 1M subscribers is 1M writes no matter the transport |

**Key trade-offs.** Polling is stateless and trivially scalable horizontally; push is cheaper per event but makes the connection tier **stateful**. The decision that matters most is not WebSocket vs SSE but **how events find connections**: a session registry (user → gateway) for 1:1 delivery, topic pub/sub (channel per room/order/ride) for 1:N, and partitioned fan-out for very large N. For mobile apps, the OS kills background sockets, so the real answer is "socket while foregrounded, push notification (APNs/FCM) otherwise".

**Numbers to quote.** A tuned Node/Go gateway holds 50K–200K idle sockets per instance; heartbeat every 25–30 s (under typical 60 s LB idle timeouts); budget ~10–50 KB RAM per connection with buffers. Redis pub/sub on one node moves a few hundred thousand messages/s, but it is fire-and-forget: disconnected subscribers miss messages, so pair it with a durable store for catch-up ("give me events since seq 4812").

**See it applied**
- → net-realtime §2–§4 (polling, SSE, WebSocket mechanics) and §6 (scaling WebSockets with connection servers + pub/sub)
- → design-social §3 (Chat: gateways, session registry, routing and offline push)
- → design-geo §5–§6 (Nearby Friends: WebSocket servers, location cache, Redis pub/sub and its scaling)
- → design-modern §3 (live comments during an IPL toss) and §12 (Google Docs per-document ownership and presence)
- → design-platform §3 (brokerage quote fan-out and conflation)
- → design-more §14 (auction real-time bid fan-out)`,
      code: [
        {
          language: 'typescript',
          title: 'Rung 3 + 5: SSE endpoint in NestJS fed by Redis pub/sub (one channel per order)',
          code: `import { Controller, Param, Sse, MessageEvent, OnModuleDestroy } from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';

@Controller('orders')
export class OrderStatusController implements OnModuleDestroy {
  // one subscriber connection per pod; a subscribed client cannot run normal commands
  private readonly sub = new Redis(process.env.REDIS_URL!);

  @Sse(':id/events')
  stream(@Param('id') id: string): Observable<MessageEvent> {
    const channel = 'order:' + id;
    return new Observable<MessageEvent>((observer) => {
      const onMessage = (ch: string, payload: string) => {
        if (ch === channel) observer.next({ data: JSON.parse(payload) });
      };
      this.sub.subscribe(channel);
      this.sub.on('message', onMessage);
      // heartbeat keeps proxies and the LB idle timeout (often 60 s) from closing us
      const hb = setInterval(() => observer.next({ data: { type: 'hb' } }), 25_000);
      return () => {
        clearInterval(hb);
        this.sub.off('message', onMessage);
        this.sub.unsubscribe(channel); // fine for a sketch; ref-count channels in production
      };
    });
  }

  onModuleDestroy() {
    this.sub.disconnect();
  }
}
// Producer side (any pod, any service):
//   await redis.publish('order:' + id, JSON.stringify({ status: 'OUT_FOR_DELIVERY' }));
// Pub/sub is fire-and-forget: on reconnect the client first GETs current state.`,
        },
      ],
      keyPoints: [
        'Two sub-problems: last-mile transport and event-to-connection routing. Interviewers probe the second.',
        'SSE is the underrated default for one-way push; WebSocket only when the client also streams.',
        'Push makes the connection tier stateful: plan heartbeats, draining on deploy and reconnect-with-cursor.',
        'Fan-out size, not transport, sets the cost: 1 event × N subscribers is N deliveries.',
      ],
    },
    {
      heading: 'Dealing with Contention: who wins when everyone wants the same row',
      body: `**Problem shape.** Many actors compete for a scarce resource at the same instant: the last seat, the 1,000 discounted phones, one driver, the top bid. The invariant is a sentence with "never": *never sell a seat twice*, *never let stock go negative*, *never assign a driver to two trips*. Correctness is the product; a 0.01% failure rate on a flash sale is a news story.

**Tell-tale phrases:** "only one", "limited quantity", "first come first served", "no double booking", "hold for 10 minutes", "highest bid wins", "claim".

**The ladder**

| Rung | Mechanism | Works until | Breaks because |
|---|---|---|---|
| 1. DB transaction + pessimistic lock | SELECT … FOR UPDATE, then UPDATE | Low contention, one database | Lock hold time serialises a hot row: 2 ms hold ≈ 500 writes/s on that row; waits pile up and exhaust pools |
| 2. Optimistic concurrency | version column; UPDATE … WHERE version = $v | Conflicts rare (< ~5%) | High contention turns into a retry storm; most attempts fail |
| 3. Atomic conditional write | UPDATE … SET stock = stock - 1 WHERE id = $1 AND stock > 0 RETURNING; or a Redis Lua script | Thousands/s per key in Postgres, ~100K/s per Redis shard | Still one hot key; Redis needs a durable hand-off back to the DB |
| 4. Reservation with TTL | Hold the item (status HELD, expires_at) and confirm after payment | Booking flows with a slow step (payment) | Expiry sweeper and late payments need care; holds can be hoarded by bots |
| 5. Admission + serialise per key | Waiting room / token gate, then a queue partitioned by item | Flash sales with 100× more buyers than stock | Fairness, queue latency, UX of "you are in line" |

**Key trade-offs.** Pessimistic locks are simple and correct but cap throughput and invite deadlocks across rows (lock in a consistent order). Optimistic control is great when conflicts are rare and terrible when they are the norm. Atomic conditional writes push the invariant into the storage engine, which is almost always the best first answer. A distributed lock (Redis SET NX PX) is an **efficiency** tool; if correctness depends on it, you need fencing tokens or a DB constraint behind it. And the cheapest contention fix is often **splitting the resource**: 1,000 units as 10 buckets of 100 turns one hot key into ten warm keys.

**Say this in the interview:** "The invariant is no oversell. I'll enforce it with a conditional decrement in the database, so correctness does not depend on any cache or lock. For the 50K-buyers-per-second spike I'll put an admission gate in front so only roughly stock × 2 requests ever reach that row."

**See it applied**
- → ds-concurrency §3–§5 (optimistic, pessimistic, atomic CAS) and §7–§8 (Redis locks, Redlock, fencing)
- → design-commerce §3 (hotel double-booking), §5 (ticket seat holds with TTL), §6 (virtual waiting room), §8 (inventory reservation)
- → design-consumer §2–§3 (Big Billion Days flash sale: bucketed Redis gate, oversell under failover)
- → design-geo §11 (Uber dispatch without double-booking drivers)
- → design-more §13 (auction bid consistency and ordering)
- → db-connections-locks §8 (lock contention on hot rows)`,
      code: [
        {
          language: 'sql',
          title: 'Rung 3 and 4: the invariant lives in one statement',
          code: `-- Rung 3: atomic conditional decrement. Zero rows updated = sold out; no lock held across a round trip.
UPDATE sku_stock
   SET available = available - 1
 WHERE sku_id = $1
   AND available > 0
RETURNING available;

-- Rung 4: claim one specific seat with a TTL hold. The WHERE clause is the whole concurrency story:
-- only a FREE seat, or a HELD seat whose hold has expired, can be claimed.
UPDATE show_seat
   SET status = 'HELD',
       held_by = $2,
       hold_expires_at = now() + interval '10 minutes'
 WHERE show_id = $1
   AND seat_no = $3
   AND (status = 'FREE' OR (status = 'HELD' AND hold_expires_at < now()))
RETURNING seat_no;

-- Confirm after payment succeeds; it only works if we still own a live hold.
UPDATE show_seat
   SET status = 'BOOKED', booking_id = $4
 WHERE show_id = $1 AND seat_no = $3
   AND status = 'HELD' AND held_by = $2 AND hold_expires_at >= now();`,
        },
      ],
      keyPoints: [
        'Write the invariant as a "never" sentence first; it tells you what must be atomic.',
        'Push the invariant into storage (conditional UPDATE, unique constraint, Lua) before reaching for locks.',
        'A hot row is capped near 1 / lock-hold-time; split the resource or gate admission to go beyond it.',
        'Locks without fencing are efficiency hints, not correctness guarantees.',
      ],
    },
    {
      heading: 'Multi-step Processes: finishing or cleanly undoing work that spans services',
      body: `**Problem shape.** A business action is several steps across services or external parties: reserve stock → charge card → create shipment → notify. Any step can fail, time out with an **unknown outcome**, or take hours (a restaurant accepting, a human approving, a bank settling). You need the process to either complete or compensate, survive crashes mid-way, and never double-execute a side effect.

**Tell-tale phrases:** "after payment", "then", "if delivery fails, refund", "order lifecycle", "approval", "cancel within 5 minutes", "retry the payout".

**The ladder**

| Rung | Mechanism | Works until | Breaks because |
|---|---|---|---|
| 1. Synchronous chain in one request | Controller calls A, B, C in sequence | All steps are fast and in one DB transaction | A crash after B leaves partial state; external calls cannot join your transaction |
| 2. Persisted state machine + outbox | Row with status + version; each transition commits with an outbox event | Most order/payment flows | You hand-roll timers, retries and visibility; logic spreads across consumers |
| 3. Saga (choreographed or orchestrated) | Each step has a compensating action; orchestrator drives it | Cross-service flows of minutes | Compensations are business logic (refund ≠ undo), and choreography gets hard to trace past ~4 steps |
| 4. Durable workflow engine | Temporal, AWS Step Functions, Cadence: code as workflow, engine persists history | Hours/days, human steps, many timers | New infra and determinism rules for workflow code; overkill for 3 steps |

**Key trade-offs.** 2PC gives atomicity but blocks on coordinator failure and is unavailable across third parties (your PSP will not join your XA transaction), so for interviews the answer is almost always **saga + idempotency + reconciliation**. Orchestration (one coordinator owns the state) is easier to reason about and monitor; choreography (services react to events) is looser but makes "where is order 123 stuck?" hard. Every step needs an **idempotency key** so retries are safe, and every unknown outcome needs a **status query or reconciliation job** rather than a blind retry.

**The litmus test:** can you draw the state machine with every failure edge, and point to where each state is persisted? If a pod dies between "charged" and "shipment created", who notices, and how long until they do?

**See it applied**
- → ds-transactions §6–§8 (sagas, an orchestrated saga as a persisted state machine, transactional outbox + CDC)
- → design-commerce §8 (checkout saga) and §9, §11 (payment pay-in, idempotency, webhooks, reconciliation)
- → design-apps §11 (food-order lifecycle state machine and restaurant acceptance timeouts)
- → design-geo §12 (Uber trip state machine)
- → design-platform §2 (brokerage order lifecycle with outbox) and §5 (CI/CD DAG orchestrator)`,
      code: [
        {
          language: 'typescript',
          title: 'Rung 2: a guarded transition commits state and outbox event together',
          code: `import { Pool } from 'pg';

type OrderState = 'CREATED' | 'STOCK_RESERVED' | 'PAID' | 'SHIPPED' | 'CANCELLED';

// Legal edges only; anything else is a bug or a duplicate message.
const NEXT: Record<OrderState, OrderState[]> = {
  CREATED: ['STOCK_RESERVED', 'CANCELLED'],
  STOCK_RESERVED: ['PAID', 'CANCELLED'],
  PAID: ['SHIPPED', 'CANCELLED'], // CANCELLED from PAID triggers a refund compensation
  SHIPPED: [],
  CANCELLED: [],
};

export async function transition(pool: Pool, orderId: string, from: OrderState, to: OrderState, event: object) {
  if (!NEXT[from].includes(to)) throw new Error('illegal transition ' + from + ' -> ' + to);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // compare-and-set on status: a duplicate or stale message updates 0 rows and is ignored
    const res = await client.query(
      'UPDATE orders SET status = $3, updated_at = now() WHERE id = $1 AND status = $2',
      [orderId, from, to],
    );
    if (res.rowCount === 0) {
      await client.query('ROLLBACK');
      return false; // already moved on: idempotent no-op
    }
    // same transaction: the event exists if and only if the state change exists
    await client.query(
      'INSERT INTO outbox (aggregate_id, type, payload) VALUES ($1, $2, $3)',
      [orderId, 'order.' + to.toLowerCase(), JSON.stringify(event)],
    );
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}`,
        },
      ],
      keyPoints: [
        'Draw the state machine with failure edges before choosing saga vs workflow engine.',
        'Compare-and-set on status makes duplicate events harmless; outbox makes state and event atomic.',
        'Unknown outcomes (timeouts) need a status query or reconciliation, never a blind retry of a charge.',
        'Reach for Temporal/Step Functions when steps span hours, humans or many timers.',
      ],
    },
    {
      heading: 'Scaling Reads: serve the same bytes many times without touching the source',
      body: `**Problem shape.** Reads outnumber writes by 10:1 to 1000:1 and the same items are read over and over: product pages, profiles, short-URL redirects, timelines. Popularity is skewed (Zipf): the top 1% of items take a large share of traffic. The source of truth (a Postgres primary) can serve perhaps 10–30K simple indexed reads/s; your traffic is 200K/s.

**Tell-tale phrases:** "millions of users view", "read-heavy", "home page", "redirect", "feed", "catalog", "low latency globally".

**The ladder**

| Rung | Mechanism | Buys you | Breaks because |
|---|---|---|---|
| 1. Fix the query | Right index, covering index, kill N+1 | Often 10–100× on the slow path | It does not change the per-row cost at huge QPS |
| 2. Cache-aside (Redis/Memcached) | Read cache, miss → DB → fill with TTL | Hit ratio h cuts DB reads to (1 − h): 90% → 10×, 99% → 100× | Stampedes on hot-key expiry, staleness, cold start after flush |
| 3. Read replicas | Route reads to followers | Linear-ish read capacity per replica | Replication lag breaks read-your-writes; does nothing for writes |
| 4. CDN / edge cache | Cache public responses near users | Offloads 90%+ of cacheable GETs, cuts 100–200 ms RTT | Only for shareable data; invalidation via versioned URLs or surrogate keys |
| 5. Precomputed read models | Materialised views, denormalised docs, fan-out-on-write timelines | O(1) reads for expensive aggregations | Write amplification and eventual consistency; you now own a projection pipeline |

**Key trade-offs.** Every rung above 1 trades **freshness for capacity**. Say how stale each read can be: product price on the listing page (60 s fine), price at checkout (must be fresh: read from primary), "my order" right after placing it (read-your-writes: pin to primary for a few seconds). Hot keys are the classic failure: one celebrity profile at 100K reads/s melts a single Redis shard; fix with a local in-process L1 cache (1–5 s TTL), key replication across shards, or request coalescing.

**Numbers to quote.** Redis: ~100K+ simple GETs/s per shard at sub-millisecond latency; a 99% hit ratio on 200K QPS leaves 2K QPS for Postgres. Replica lag is typically milliseconds to a second, and spikes to minutes under heavy writes or long queries on the replica.

**See it applied**
- → cache-fundamentals §1, §3 and §10 (hit-ratio math, cache-aside, "the DB is slow, introduce caching")
- → cache-failures §3 and §6 (stampedes and hot keys)
- → db-replication §5–§7 (read routing, read-after-write, lag)
- → cdn-global §4–§5 (invalidation, origin shield and request collapsing)
- → design-classics §4 (URL shortener caching and 301 vs 302)
- → design-social §7–§8 (news feed fan-out and read path) and prod-scale §4 (read traffic too high)`,
      code: [
        {
          language: 'typescript',
          title: 'Rung 2 with the two guards interviewers ask about: jittered TTL and in-flight coalescing',
          code: `import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);
const inflight = new Map<string, Promise<unknown>>(); // per-pod request coalescing

export async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit) as T;

  // 1,000 concurrent misses on this pod share ONE database query
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const p = (async () => {
    try {
      const value = await load();
      // jitter spreads expiries so keys filled together do not expire together (avalanche)
      const ttl = Math.round(ttlSec * (0.9 + Math.random() * 0.2));
      await redis.set(key, JSON.stringify(value), 'EX', ttl);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// usage: const product = await cached('product:' + id, 300, () => repo.findProduct(id));`,
        },
      ],
      keyPoints: [
        'Fix the query first; caches hide bad queries until the cache is cold.',
        'DB load after caching is (1 − hit ratio) × QPS: the last few percent of hit ratio matter most.',
        'State a staleness budget per read; route the must-be-fresh reads to the primary.',
        'Hot keys need L1 caches, key replication or coalescing; more shards do not help one key.',
      ],
    },
    {
      heading: 'Scaling Writes: absorbing more writes than one machine can commit',
      body: `**Problem shape.** Every user action produces a write: GPS pings, clicks, likes, metrics, chat messages, log lines. Unlike reads, writes cannot be served from a copy; every one must land on the authoritative store, durably. A single Postgres primary on good NVMe commits roughly 5–20K small transactions/s (group commit helps); a hot path at 500K writes/s needs a different shape.

**Tell-tale phrases:** "every click", "drivers ping every 4 s", "track every view", "ingest events", "metrics from 1M hosts", "likes and view counts", "logs".

**The ladder**

| Rung | Mechanism | Buys you | Breaks because |
|---|---|---|---|
| 1. Batch and buffer | Accept, enqueue (Kafka/SQS), write in batches of 100–1,000 | 5–50× fewer commits; bursts smoothed (load levelling) | Adds latency between "accepted" and "visible"; queue must be durable |
| 2. Vertical + partition | Bigger box, faster disks, table partitioning | Cheap headroom; smaller indexes per partition | One primary is still one write path; partitions share CPU/WAL |
| 3. Shard by the write key | Hash/range shards (user, geo cell, tenant) | Near-linear write capacity | Cross-shard queries, resharding, hot shards when the key is skewed |
| 4. Pre-aggregate before storing | Count in memory/stream (Flink, Redis INCR), flush every N s | 100K likes/s on one post become 1 write/s | Loss window on crash unless the raw log is durable; approximate in flight |
| 5. Write-optimised storage | LSM stores (Cassandra, ScyllaDB, RocksDB), time-series DBs, append-only logs | Sequential I/O, high ingest | Read amplification, compaction debt, weaker transactions |

**Key trade-offs.** The first question is **can the write be lossy or late?** Location pings: keep only the latest (overwrite in Redis), drop if late. Likes: aggregate, reconcile nightly. Payments: never lossy, never aggregated, but low volume, so a sharded relational DB is fine. The second question is **what is the hot key?** Write scaling and contention collide on skewed keys: sharding by post_id puts a viral post on one shard; split the counter into N sub-keys and sum on read.

**Read replicas add zero write capacity.** Every replica replays every write. Saying "add replicas" to a write-bound system is one of the most common mid-level mistakes.

**See it applied**
- → db-sharding §3–§5 and §7 (strategies, shard key, hot shards, resharding)
- → db-replication §9 (why replicas stop helping writes)
- → design-more §7 (distributed counters: likes and views write path)
- → design-infra §5 and §8 (metrics collection with Kafka buffering; ad-click aggregation DAG)
- → design-advanced §2 (leaderboard sharding to 500M DAU)
- → mq-scenarios §3 (traffic spikes absorbed by queue buffering) and prod-scale §6–§7`,
      code: [
        {
          language: 'typescript',
          title: 'Rung 4: buffer hot counters in memory, flush aggregated deltas every second',
          code: `import { Pool } from 'pg';

// One pod sees thousands of +1s per second for a viral post; the DB sees one row per post per flush.
export class CounterBuffer {
  private deltas = new Map<string, number>();
  private timer: NodeJS.Timeout;

  constructor(private readonly pool: Pool, flushMs = 1000) {
    this.timer = setInterval(() => void this.flush(), flushMs);
  }

  incr(postId: string, by = 1) {
    this.deltas.set(postId, (this.deltas.get(postId) ?? 0) + by);
  }

  async flush() {
    if (this.deltas.size === 0) return;
    const batch = this.deltas;
    this.deltas = new Map(); // swap first so increments during the flush are not lost
    const ids = [...batch.keys()];
    const counts = ids.map((id) => batch.get(id)!);
    try {
      // one statement, many rows; additive so concurrent pods never overwrite each other
      await this.pool.query(
        'UPDATE post_stats s SET likes = s.likes + d.n FROM unnest($1::text[], $2::int[]) AS d(id, n) WHERE s.post_id = d.id',
        [ids, counts],
      );
    } catch (e) {
      for (const [id, n] of batch) this.incr(id, n); // put back; the next tick retries
    }
  }

  async close() {
    clearInterval(this.timer);
    await this.flush(); // on SIGTERM; a crash still loses <= 1 s unless the raw events are in Kafka
  }
}`,
        },
      ],
      keyPoints: [
        'Ask first: may this write be late, lossy, overwritten or aggregated?',
        'Batching and queues buy the cheapest 10×; sharding buys the expensive next 10×.',
        'Find the hot key: skew turns write scaling back into a contention problem.',
        'Replicas multiply reads, never writes.',
      ],
    },
    {
      heading: 'Handling Large Blobs: keep the bytes off your app servers',
      body: `**Problem shape.** Users upload or download things that are megabytes to gigabytes: photos, videos, PDFs, backups, datasets. If those bytes stream through your NestJS pods, each upload ties up memory, a socket and an event-loop slice for the full transfer time — a 1 GB file over a 100 Mbps mobile link takes about 80 s. The second hard part is **consistency between metadata and bytes**: a DB row that points at an object that never finished uploading, or an object nobody references.

**Tell-tale phrases:** "upload photos/videos", "attachments", "file sharing", "sync folders", "download the report", "stream the video".

**The ladder**

| Rung | Mechanism | Works until | Breaks because |
|---|---|---|---|
| 1. Upload through the app | multipart/form-data to the API, API writes to disk or S3 | Small files (< ~10 MB), low volume | App tier becomes a bandwidth tier; request timeouts; memory pressure |
| 2. Presigned single PUT | API issues a short-lived signed URL; client PUTs to object storage | Files up to ~100 MB on decent networks | One failed byte restarts the whole upload |
| 3. Multipart / resumable | Client uploads parts (≥ 5 MiB, up to 10,000 parts) in parallel, retries per part, then completes | GBs on flaky mobile networks | Abandoned multipart uploads cost money: add a lifecycle rule to abort them |
| 4. Event-driven processing | Object-created event → queue → thumbnails, transcode, virus scan | Any non-trivial post-processing | Upload-done ≠ ready: needs a status field and a UX for "processing" |
| 5. CDN for reads + tiered storage | Signed CDN URLs, lifecycle to infrequent/archive tiers | Global read scale and cost control | Invalidation, signed-URL expiry vs caching, retrieval delays on archive tiers |

**Key trade-offs.** Direct-to-storage uploads move trust to the client, so the presigned URL must pin bucket, key, content type and maximum size, and expire in minutes. Metadata state should follow an explicit lifecycle (PENDING → UPLOADED → PROCESSING → READY / FAILED) driven by storage events, not by the client saying "done" — clients lie and crash. Content-addressed keys (hash of content) give dedup and safe retries; chunk-level hashing is what lets Dropbox sync only the changed blocks.

**See it applied**
- → object-storage §6–§8 (multipart, presigned URLs, resumable uploads and dedup) and §10 (CDN in front)
- → design-storage §3–§4 (Dropbox upload/download flow, chunking, dedup and delta sync)
- → design-social §10 (YouTube upload and the transcoding DAG)
- → design-apps §2 (Instagram upload and media-processing pipeline)
- → design-classics §5 (Pastebin metadata + object storage) and §13 (file upload service)
- → prod-scale §11 (static content and uploads overloading app servers)`,
      code: [
        {
          language: 'typescript',
          title: 'Rung 2→3: API only signs; the client uploads parts straight to S3',
          code: `import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const s3 = new S3Client({ region: 'ap-south-1' });
const PART = 16 * 1024 * 1024; // 16 MiB parts: >= 5 MiB minimum, and 10,000 parts covers ~156 GiB

export async function startUpload(userId: string, sizeBytes: number, contentType: string) {
  if (sizeBytes > 20 * 1024 ** 3) throw new Error('max 20 GiB'); // enforce business limits server-side
  const key = 'uploads/' + userId + '/' + randomUUID(); // server chooses the key, never the client
  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: process.env.BUCKET!, Key: key, ContentType: contentType }),
  );
  const parts = Math.ceil(sizeBytes / PART);
  const urls = await Promise.all(
    Array.from({ length: parts }, (_, i) =>
      getSignedUrl(
        s3,
        new UploadPartCommand({ Bucket: process.env.BUCKET!, Key: key, UploadId, PartNumber: i + 1 }),
        { expiresIn: 900 }, // 15 minutes; the client asks for fresh URLs to resume later
      ),
    ),
  );
  // persist metadata as PENDING; an S3 ObjectCreated event (not the client) flips it to UPLOADED
  return { key, uploadId: UploadId, partSize: PART, urls };
}`,
        },
      ],
      keyPoints: [
        'Bytes go client ↔ object storage ↔ CDN; the app tier only signs and records metadata.',
        'Multipart: parts ≥ 5 MiB, ≤ 10,000 parts, retry per part, lifecycle rule to abort stale uploads.',
        'Drive metadata state from storage events, not from the client claiming success.',
        'Upload complete is not ready: model PROCESSING explicitly.',
      ],
    },
    {
      heading: 'Managing Long-Running Tasks: accept now, finish reliably later',
      body: `**Problem shape.** Some work takes seconds to hours: transcoding a video, generating a GST invoice batch, running a user's code submission, crawling a site, exporting 2M rows, an LLM agent run. Doing it inside the HTTP request ties up a connection, hits LB and gateway timeouts (AWS ALB idle timeout defaults to 60 s; many API gateways cap at 29–30 s), and loses the work on deploy. By Little's law, 100 req/s × 30 s each = 3,000 requests in flight just waiting.

**Tell-tale phrases:** "generate", "export", "process", "transcode", "crawl", "run the code", "build", "send to all users", "this can take a few minutes".

**The ladder**

| Rung | Mechanism | Works until | Breaks because |
|---|---|---|---|
| 1. In-request with a long timeout | Just wait | p99 under ~2–5 s | Timeouts, retries that duplicate the work, deploys kill jobs |
| 2. Fire-and-forget in process | setImmediate / background promise | Never safe for important work | Pod restart loses the job silently; no retries, no visibility |
| 3. Queue + worker pool | 202 + job id; BullMQ/SQS/RabbitMQ; workers ack on success | Most products | Need visibility timeout ≥ job time or heartbeats; poison jobs need a DLQ |
| 4. Job table + scheduler | Durable jobs row (status, attempts, lease_until), workers claim with SKIP LOCKED | Delayed/cron jobs, priority, fairness per tenant | Polling load; lease expiry tuning |
| 5. Workflow engine / DAG | Temporal, Airflow, Step Functions for multi-stage pipelines | Hours, fan-out/fan-in, human steps | Operational weight |

**Key trade-offs.** Delivery is **at-least-once** in every practical queue, so workers must be idempotent (dedupe by job id, write outputs to deterministic keys). Long jobs need **heartbeats** or lease extension, otherwise the broker redelivers to a second worker while the first is still running. Separate queues by job class (fast emails vs 20-minute transcodes) so a backlog of slow jobs cannot starve fast ones (head-of-line blocking). Scale workers on **queue depth and age of oldest message**, not CPU. Tell the client how it learns the result: poll the status endpoint (simple), SSE/WebSocket (live progress), or a webhook (B2B).

**See it applied**
- → mq-scenarios §2 (the 10-second API → 202 Accepted, polling and webhooks), §6 (consumer crash mid-processing) and §8 (retries, DLQ, poison pills)
- → design-infra §11–§12 (distributed job scheduler: claiming jobs safely, timing wheels, retries)
- → design-more §11 (online judge queueing and contest spikes)
- → design-platform §5 (CI/CD runner dispatch and warm runner pools)
- → ds-concurrency §9 (SKIP LOCKED worker queues) and prod-scale §12 (millions of background jobs)`,
      code: [
        {
          language: 'typescript',
          title: 'Rung 3: BullMQ producer returns 202; worker reports progress and is idempotent',
          code: `import { Queue, Worker, Job } from 'bullmq';

const connection = { url: process.env.REDIS_URL! };
export const exportQueue = new Queue('exports', { connection });

// Controller: POST /exports -> 202 { jobId }
export async function requestExport(tenantId: string, filters: object) {
  const job = await exportQueue.add(
    'csv',
    { tenantId, filters },
    {
      jobId: 'export:' + tenantId + ':' + JSON.stringify(filters), // same request twice = same job
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 86_400 },
    },
  );
  return { jobId: job.id, statusUrl: '/exports/' + encodeURIComponent(job.id!) };
}

new Worker(
  'exports',
  async (job: Job) => {
    const outKey = 'exports/' + job.data.tenantId + '/' + job.id + '.csv'; // deterministic: a retry overwrites
    let done = 0;
    for await (const chunk of streamRows(job.data)) {
      await appendToMultipart(outKey, chunk);
      done += chunk.length;
      await job.updateProgress(done); // also renews BullMQ's lock, so no duplicate worker takes over
    }
    return { outKey };
  },
  { connection, concurrency: 4, lockDuration: 60_000 },
);

declare function streamRows(d: unknown): AsyncIterable<string[]>;
declare function appendToMultipart(key: string, rows: string[]): Promise<void>;`,
        },
      ],
      keyPoints: [
        'If p99 approaches gateway/LB timeouts, switch to 202 + job id; do not raise the timeout.',
        'At-least-once delivery means idempotent workers with deterministic output keys.',
        'Heartbeats/leases stop a second worker grabbing a job that is still running.',
        'Separate queues by job class and autoscale on queue age, not CPU.',
      ],
    },
    {
      heading: 'Pattern collisions: where two patterns pull in opposite directions',
      body: `**Intuition.** Real prompts rarely contain one pattern, and the rungs you pick for one pattern can make another harder. Interviewers love these collisions because they cannot be answered from a memorised diagram.

| Collision | Where it shows up | What goes wrong | Senior resolution |
|---|---|---|---|
| Scaling Writes × Contention | Like counters, flash-sale stock, rate-limit counters | Sharding by item puts the viral item on one shard: a hot key | Split the logical counter into N sub-keys or stock buckets; sum on read; reconcile periodically |
| Real-time × Scaling Writes | Live location, live comments, stock ticks | Every write fans out to N watchers; 5K posts/s × 500 followers = 2.5M deliveries/s | Conflate (send latest every 1–2 s), sample for huge audiences, push only to online users |
| Real-time × Scaling Reads | Live scoreboards for 20M viewers | Push to 20M sockets is costlier than a cached GET | Edge-cached polling every 2–5 s often beats push at extreme fan-out |
| Large Blobs × Long-Running | Video upload → transcode | Client sees "upload done" and expects playback | Explicit PROCESSING state, progress via SSE, publish renditions progressively |
| Multi-step × Contention | Checkout reserving stock then paying | Holding a lock across a 30 s payment kills throughput | Reservation with TTL instead of a lock; confirm or release in the saga |
| Scaling Reads × Multi-step | Order page right after checkout | Replica or cache shows the old state | Read-your-writes: route the user's reads to the primary for N seconds, or return the new state in the write response |

**How to talk about it.** Name both patterns, name the tension, pick a resolution with a number: "Real-time and fan-out collide here: one goal in a match goes to 20M viewers. Pushing 20M messages within a second needs a few hundred gateway boxes; a CDN-cached score endpoint polled every 3 s serves the same freshness with the CDN absorbing about 6.7M req/s at the edge. I'd push only to users in the live-commentary view."

**See it applied**
- → design-advanced §14 (patterns that recur across the advanced designs)
- → design-social §7 (the celebrity hybrid: fan-out on write vs read)
- → cache-failures §6 (hot keys) and db-sharding §5 (hot shards and the celebrity problem)
- → design-modern §3 (surviving the toss: origin protection and live comments)`,
      keyPoints: [
        'The rung you choose for one pattern changes the cost of another; say the tension out loud.',
        'Hot keys are where write scaling turns into contention: split and reconcile.',
        'At extreme fan-out, cached polling can beat push; quantify before choosing.',
        'Reservations with TTL resolve multi-step × contention better than long-held locks.',
      ],
    },
    {
      heading: 'Drill: which pattern is this? 25 famous prompts mapped',
      body: `**How to drill.** Cover the right-hand columns, read the prompt, and say the 2–3 patterns plus the one-line "hard part" in under 20 seconds. Then open the linked section and check your rung against the worked design.

| # | Prompt | Primary patterns | The hard part in one line | See it applied |
|---|---|---|---|---|
| 1 | URL shortener (bit.ly) | Scaling Reads | 100:1 reads; cache redirects, unique code generation | design-classics §2–§4 |
| 2 | Ticketmaster / BookMyShow | Contention, Real-time | Seat holds with TTL; waiting room for on-sale spikes | design-commerce §5–§6 |
| 3 | Uber / Ola | Scaling Writes, Contention, Real-time | 4 s pings, one driver per trip, live tracking | design-geo §10–§12 |
| 4 | WhatsApp / chat | Real-time, Scaling Writes | Route to the right gateway, per-chat ordering, offline sync | design-social §1–§5 |
| 5 | Twitter / Instagram feed | Scaling Reads, Scaling Writes | Fan-out on write vs read; celebrity hybrid | design-social §6–§8 |
| 6 | Dropbox / Google Drive | Large Blobs, Real-time | Chunked dedup upload, change notifications to devices | design-storage §2–§5 |
| 7 | YouTube / Netflix | Large Blobs, Long-Running, Scaling Reads | Transcoding DAG, ABR via CDN | design-social §9–§12 |
| 8 | Instagram (media) | Large Blobs, Scaling Reads | Upload pipeline, renditions, feed reads | design-apps §1–§4 |
| 9 | Swiggy / Zomato | Multi-step, Real-time, Contention | Order state machine, partner dispatch, tracking | design-apps §8–§14 |
| 10 | Payment system (Razorpay) | Multi-step, Contention | Idempotent pay-in, ledger, webhooks, reconciliation | design-commerce §9–§11 |
| 11 | Flash sale (Big Billion Days) | Contention, Scaling Writes | Admission gate, bucketed stock, async orders | design-consumer §1–§3 |
| 12 | Hotel reservation (Booking) | Contention, Multi-step | Inventory per room-type-night, no double booking | design-commerce §2–§4 |
| 13 | E-commerce checkout | Multi-step, Contention | Reservation + checkout saga | design-commerce §7–§8 |
| 14 | Google Docs | Real-time, Contention | OT/CRDT merge, per-document owner | design-modern §10–§12 |
| 15 | Online auction (eBay) | Contention, Real-time | Bid ordering, anti-sniping, bid fan-out | design-more §12–§14 |
| 16 | Online judge (LeetCode) | Long-Running, Scaling Writes | Sandboxed runs, contest-spike queueing | design-more §9–§11 |
| 17 | Web crawler | Long-Running, Scaling Writes | Frontier with politeness, dedup at billions of URLs | design-more §1–§3 |
| 18 | Distributed job scheduler | Long-Running, Contention | Claim jobs exactly once-ish, cron misfires | design-infra §11–§12 |
| 19 | Metrics monitoring | Scaling Writes, Scaling Reads | Ingest millions of points/s, downsampled queries | design-infra §4–§6 |
| 20 | Ad click aggregation | Scaling Writes, Multi-step | Windowed aggregation, exactly-once-ish, reconciliation | design-infra §7–§10 |
| 21 | Gaming leaderboard | Scaling Writes, Scaling Reads | Sorted-set ranks, sharding by score range | design-advanced §1–§2 |
| 22 | Live streaming (Hotstar IPL) | Large Blobs, Scaling Reads, Real-time | Segment pipeline, CDN origin protection, live comments | design-modern §1–§3 |
| 23 | ChatGPT-style LLM service | Long-Running, Real-time | Token streaming over SSE, GPU batching, overload | design-modern §7–§9 |
| 24 | Nearby friends | Real-time, Scaling Writes | Location fan-out to friends via pub/sub | design-geo §4–§6 |
| 25 | Price tracker alerts | Long-Running, Scaling Writes | Change detection at scale, alert fan-out with throttling | design-consumer §4–§6 |
| 26 | Likes / view counters | Scaling Writes, Contention | Hot counters, buffered increments, reconciliation | design-more §7–§8 |
| 27 | CI/CD runner (GitHub Actions) | Long-Running, Multi-step | DAG orchestration, warm ephemeral runners, log streaming | design-platform §4–§6 |

**Patterns of the patterns.** Notice that almost every commerce prompt contains Contention + Multi-step; almost every social prompt contains Scaling Reads + Real-time; every media prompt contains Large Blobs + Long-Running. If a prompt is new to you (a parking-garage booking app, a vaccine slot booker), find its family and borrow the family's ladder.`,
      keyPoints: [
        'Commerce family: Contention + Multi-step. Social family: Reads + Real-time. Media family: Blobs + Long-Running.',
        'For an unfamiliar prompt, map it to a family and borrow that ladder.',
        'Drill until you can name patterns and the hard part in under 20 seconds.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'design-patterns-cc-1',
      title: 'The export endpoint that times out at 60 seconds',
      context:
        'A B2B dashboard (NestJS behind an AWS ALB with the default 60 s idle timeout) lets merchants export their orders as CSV. Small merchants are fine. Large merchants with 2M orders see 504s, click the button again, and the database CPU climbs every time a big merchant tries. This is two patterns at once: a long-running task and a large blob.',
      task: 'Rewrite the export so the HTTP request returns immediately, duplicate clicks do not start duplicate work, the job survives a pod restart, memory stays flat regardless of merchant size, and the CSV is downloaded without passing through the API pods.',
      starter: {
        language: 'typescript',
        code: `import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Pool } from 'pg';

@Controller('exports')
export class ExportController {
  constructor(private readonly pool: Pool) {}

  @Get('orders.csv')
  async exportOrders(@Query('merchantId') merchantId: string, @Res() res: Response) {
    // loads every row into memory; 2M rows x ~300 bytes is ~600 MB per request
    const { rows } = await this.pool.query(
      'SELECT id, created_at, total, status FROM orders WHERE merchant_id = $1 ORDER BY created_at',
      [merchantId],
    );
    let csv = 'id,created_at,total,status\\n';
    for (const r of rows) csv += [r.id, r.created_at.toISOString(), r.total, r.status].join(',') + '\\n';
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv); // after ~60 s the ALB has already returned 504 to the user, who clicks again
  }
}`,
      },
      hints: [
        'Which response code tells the client "accepted, not done yet", and what does the client need back to find the result later?',
        'Make the job identity a function of the request so a second click finds the first job instead of creating another.',
        'Stream rows with a server-side cursor into a multipart upload to object storage, then hand the user a short-lived signed GET URL.',
      ],
      solution: {
        language: 'typescript',
        code: `import { Controller, Get, Param, Post, Query, HttpCode } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { Pool } from 'pg';
import Cursor from 'pg-cursor';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PassThrough } from 'node:stream';

const connection = { url: process.env.REDIS_URL! };
const queue = new Queue('exports', { connection });
const s3 = new S3Client({ region: 'ap-south-1' });
const BUCKET = process.env.EXPORT_BUCKET!;

@Controller('exports')
export class ExportController {
  @Post('orders')
  @HttpCode(202)
  async start(@Query('merchantId') merchantId: string, @Query('date') date: string) {
    // one export per merchant per day-snapshot: a second click returns the same job
    const jobId = 'orders:' + merchantId + ':' + date;
    await queue.add('orders', { merchantId, date }, {
      jobId, attempts: 3, backoff: { type: 'exponential', delay: 30_000 },
    });
    return { jobId, statusUrl: '/exports/' + encodeURIComponent(jobId) };
  }

  @Get(':jobId')
  async status(@Param('jobId') jobId: string) {
    const job = await queue.getJob(jobId);
    if (!job) return { state: 'not_found' };
    const state = await job.getState();
    if (state !== 'completed') return { state, rowsWritten: job.progress };
    // short-lived download link; bytes go S3 -> browser, never through this pod
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: job.returnvalue.key }), { expiresIn: 600 });
    return { state, url };
  }
}

export function startWorker(pool: Pool) {
  return new Worker('exports', async (job: Job) => {
    const key = 'exports/' + job.id + '.csv'; // deterministic: a retry overwrites, never duplicates
    const body = new PassThrough();
    const upload = new Upload({ client: s3, params: { Bucket: BUCKET, Key: key, Body: body, ContentType: 'text/csv' } });
    const done = upload.done(); // multipart upload streams parts as they fill

    const client = await pool.connect();
    try {
      // read from a replica in production; snapshot the cut-off so retries export the same rows
      const cursor = client.query(new Cursor(
        'SELECT id, created_at, total, status FROM orders WHERE merchant_id = $1 AND created_at < $2::date + 1 ORDER BY created_at, id',
        [job.data.merchantId, job.data.date],
      ));
      body.write('id,created_at,total,status\\n');
      let n = 0;
      for (;;) {
        const rows = await cursor.read(5_000); // memory bounded by batch size, not merchant size
        if (rows.length === 0) break;
        for (const r of rows) body.write([r.id, r.created_at.toISOString(), r.total, r.status].join(',') + '\\n');
        n += rows.length;
        await job.updateProgress(n); // renews the job lock so no second worker takes it over
      }
      await cursor.close();
      body.end();
      await done;
      return { key, rows: n };
    } catch (e) {
      body.destroy(e as Error);
      throw e; // BullMQ retries with backoff; after 3 attempts the job is failed and visible
    } finally {
      client.release();
    }
  }, { connection, concurrency: 2, lockDuration: 60_000 });
}`,
      },
      explanation: `- **202 + job id + status URL** replaces a blocking request, so ALB and gateway timeouts no longer matter and the user gets progress.
- **Deterministic jobId** (merchant + snapshot date) makes duplicate clicks idempotent: BullMQ ignores an add with an existing id.
- **Durable queue + worker** survives pod restarts; failed jobs retry with exponential backoff and remain inspectable after the last attempt.
- **Server-side cursor** reads 5,000 rows at a time, so memory is flat whether the merchant has 2K or 20M orders.
- **Streaming multipart upload** to S3 keeps the bytes out of the API tier; the signed GET URL (10 min) delivers the file directly from storage.
- **Snapshot cut-off** in the query makes retries produce the same file; **updateProgress** doubles as a heartbeat that extends the lock.`,
      followUps: [
        {
          q: 'Large merchants now run 40-minute exports and hog all worker slots, so small merchants wait 30 minutes for a 2-second export. What do you change?',
          a: 'This is head-of-line blocking across job classes. Route by estimated size: a cheap COUNT or the merchant tier decides between an `exports-small` and an `exports-large` queue, each with its own worker pool and concurrency. Add per-tenant concurrency caps (at most one running large export per merchant) so one tenant cannot occupy the whole large pool. Autoscale each pool on the age of its oldest waiting job, not CPU.',
        },
        {
          q: 'The worker crashes at row 1.6M of 2M. What happens to the partial multipart upload and to the user?',
          a: 'The retry starts from row 0 and writes the same deterministic key, so the user eventually gets one complete file, never a truncated one. That works because a multipart object only becomes visible after CompleteMultipartUpload succeeds. The orphaned parts of the crashed attempt still cost storage, so add a bucket lifecycle rule `AbortIncompleteMultipartUpload` after 1 day. For very long exports, checkpoint the last exported `(created_at, id)` in job data and write numbered part files to resume instead of restarting.',
        },
      ],
    },
    {
      id: 'design-patterns-cc-2',
      title: 'The festive coupon that was redeemed 1,340 times out of 1,000',
      context:
        'A D2C brand runs a "first 1,000 orders get ₹500 off" coupon at 8 PM. Marketing promised exactly 1,000 redemptions and one per customer. The checkout service runs on 12 NestJS pods. Finance found 1,340 redemptions, 61 customers used it twice, and the coupons table showed lock waits during the spike.',
      task: 'Fix the redemption so the global cap and the one-per-customer rule can never be violated under concurrency, without holding a lock across the payment call, and so that abandoned checkouts give the coupon back.',
      starter: {
        language: 'typescript',
        code: `import { Pool } from 'pg';

export async function applyCoupon(pool: Pool, code: string, customerId: string, orderId: string) {
  const coupon = (await pool.query('SELECT id, max_uses, used FROM coupons WHERE code = $1', [code])).rows[0];
  if (!coupon) throw new Error('invalid coupon');

  // check-then-act: 12 pods all read used = 999 at the same moment
  if (coupon.used >= coupon.max_uses) throw new Error('coupon exhausted');

  const prior = await pool.query(
    'SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 AND customer_id = $2', [coupon.id, customerId],
  );
  if (prior.rowCount) throw new Error('already used'); // two tabs pass this check together

  await pool.query('UPDATE coupons SET used = $1 WHERE id = $2', [coupon.used + 1, coupon.id]); // lost update
  await pool.query(
    'INSERT INTO coupon_redemptions (coupon_id, customer_id, order_id) VALUES ($1, $2, $3)',
    [coupon.id, customerId, orderId],
  );
  // payment happens later; if it fails the coupon is never returned
}`,
      },
      hints: [
        'Both invariants are "never" sentences. Which one can a unique constraint enforce, and which one a conditional UPDATE?',
        'The two writes must commit or fail together, and the cap check must be part of the write itself.',
        'Model the redemption as a hold with an expiry that the order saga confirms or releases.',
      ],
      solution: {
        language: 'typescript',
        code: `import { Pool } from 'pg';

// Schema guarantees (run once):
//   ALTER TABLE coupon_redemptions ADD CONSTRAINT one_per_customer UNIQUE (coupon_id, customer_id);
//   ALTER TABLE coupon_redemptions ADD COLUMN status text NOT NULL DEFAULT 'HELD',
//     ADD COLUMN hold_expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes';
//   ALTER TABLE coupons ADD CONSTRAINT used_within_cap CHECK (used <= max_uses);

export async function holdCoupon(pool: Pool, code: string, customerId: string, orderId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // the cap check IS the write: zero rows means exhausted, and the row lock lasts milliseconds
    const c = await client.query(
      'UPDATE coupons SET used = used + 1 WHERE code = $1 AND used < max_uses AND now() < valid_until RETURNING id',
      [code],
    );
    if (c.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false as const, reason: 'exhausted_or_invalid' };
    }
    // the unique constraint enforces one-per-customer even across pods and tabs
    await client.query(
      'INSERT INTO coupon_redemptions (coupon_id, customer_id, order_id) VALUES ($1, $2, $3)',
      [c.rows[0].id, customerId, orderId],
    );
    await client.query('COMMIT'); // both writes or neither
    return { ok: true as const };
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return { ok: false as const, reason: 'already_used' }; // unique_violation
    throw e;
  } finally {
    client.release();
  }
}

// Called by the order saga after payment succeeds
export async function confirmCoupon(pool: Pool, orderId: string) {
  await pool.query("UPDATE coupon_redemptions SET status = 'CONFIRMED' WHERE order_id = $1 AND status = 'HELD'", [orderId]);
}

// Sweeper (every minute) or saga compensation: give back expired holds exactly once
export async function releaseExpired(pool: Pool) {
  await pool.query(
    "WITH gone AS (DELETE FROM coupon_redemptions WHERE status = 'HELD' AND hold_expires_at < now() RETURNING coupon_id) " +
      'UPDATE coupons c SET used = c.used - g.n FROM (SELECT coupon_id, count(*) AS n FROM gone GROUP BY coupon_id) g WHERE c.id = g.coupon_id',
  );
}`,
      },
      explanation: `- **Conditional increment** (WHERE used < max_uses) merges check and act into one atomic statement, so 12 pods cannot all see 999; the CHECK constraint is a second line of defence.
- **Unique (coupon_id, customer_id)** enforces one-per-customer in the storage engine; the duplicate surfaces as error 23505 and maps to a clean response.
- **One transaction** for counter + redemption row: a crash between them can no longer leak a use or leave an orphan row.
- **Hold with expiry** instead of a lock across the payment: the row lock lasts only milliseconds, and the saga confirms on payment success.
- **Sweeper with DELETE … RETURNING** releases each expired hold exactly once and returns the uses in one statement, so abandoned carts give the coupon back.
- **Additive update** (used = used + 1) removes the lost update caused by writing a value computed in application memory.`,
      followUps: [
        {
          q: 'At 8 PM, 40,000 checkout attempts per second hit this one coupons row. What is the throughput ceiling, and how do you go past it?',
          a: 'Every attempt serialises on one row lock. If the transaction holds it about 2 ms, the ceiling is near 500 successful increments/s, and the waiters exhaust connection pools long before then. Two fixes: **split the counter** into 10–20 bucket rows of 50–100 uses each, picked at random with fallback to another bucket when one is empty; and **gate admission** with a Redis DECR pre-check so only around 1.5–2× the remaining uses ever reach Postgres. Postgres stays the authority, so a Redis failover can let extra requests through to the DB but cannot oversell.',
        },
        {
          q: 'How would you prove in a test that the cap can never be exceeded?',
          a: 'Write an integration test with Testcontainers Postgres: seed a coupon with `max_uses = 50`, then fire 500 concurrent `holdCoupon` calls with `Promise.all`, using 450 distinct customers plus 50 duplicates, over a pool of 20 connections. Assert that exactly 50 succeed, `used = 50`, that the redemption count equals `used`, and that no customer has two rows. Then expire the holds with a fake clock or a direct UPDATE, run the sweeper twice, and assert `used = 0` both times. That proves the release is idempotent.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-patterns-iq-1',
      difficulty: 'expert',
      question:
        'I will give you a prompt you have probably not prepared: a national vaccination-slot booking portal where 30 million people try to book when slots for a new age group open at 4 PM. Before drawing anything, tell me which recurring patterns you see and how you will split your deep-dive time.',
      whatInterviewerLooksFor: [
        'Recognises Contention and Scaling Reads as primary, and Real-time as secondary',
        'Uses numbers to decide which rung of each ladder is needed',
        'Borrows from a known design family (ticket on-sale) instead of inventing',
        'Explicitly allocates deep-dive time and explains why',
      ],
      modelAnswer: `### Patterns I see
1. **Contention (primary).** Slots are scarce: perhaps 2M slots across 50K centres and days, against 30M people. The invariant is *never book a slot twice and never exceed a centre's capacity*. This is the ticket on-sale family.
2. **Scaling Reads (primary).** Before booking, everyone searches availability by district and pincode and refreshes. If 30M users refresh every 10 s, that is 3M read QPS, far above any database. Availability can be seconds stale as long as the booking write is authoritative.
3. **Real-time (secondary).** "Slots left" counters feel live, but a CDN-cached endpoint refreshed every 5 s is enough; pushing to 30M sockets is not justified.
4. **Long-running (minor).** Confirmation SMS and certificates go async via a queue.

### Rungs chosen
- **Reads:** availability is precomputed per (district, date) into a compact document in Redis and published through a CDN with a 5 s TTL and request collapsing. The origin sees roughly POPs × keys / TTL, not 3M QPS.
- **Contention:** each centre-day becomes N capacity rows. A booking runs \`UPDATE … SET booked = booked + 1 WHERE booked < capacity\`, plus a unique constraint on (beneficiary, dose). A virtual waiting room at the edge admits users at a rate the booking tier can absorb, about 20–50K bookings/s. Bucketed capacity rows prevent one popular centre from becoming a single hot row.
- **Fairness and bots:** captcha or OTP at admission, per-user rate limits, and a randomised queue position at the open instead of first-packet-wins.

### Time split
I would spend about 15 minutes on contention (admission plus conditional booking, failure during payment-free holds), about 8 minutes on the read path and cache invalidation after bookings, and 2 minutes noting the async notifications. Contention is where correctness and the 4 PM spike meet, so it earns the most time.`,
      followUps: [
        {
          q: 'The availability cache says 12 slots left but every booking attempt fails. Is that a bug?',
          a: 'It is the accepted staleness of a 5 s cache meeting a fast sell-out, not a correctness bug, because the booking write is authoritative. Improve the UX: return "slot just filled, here are 3 nearby alternatives" from the failed write itself, and publish a decrement event that invalidates that district key at once instead of waiting for the TTL. Track the share of failed attempts on cached-available slots as an SLI.',
        },
        {
          q: 'Product insists the first person to click must get the slot. How does that change your admission design?',
          a: 'Strict first-click fairness needs one ordered admission point, such as a sequencer or a queue partitioned by district with timestamps taken at the edge, and network jitter of ±100 ms already makes "first" arbitrary. I would push back with data: a randomised waiting-room position at T0 is fairer to people on slow networks and removes the incentive for bots to race the clock. If product still insists, order by edge-receipt time within a district partition and accept the extra queueing latency.',
        },
        {
          q: 'Which single metric would you watch at 4:00:30 PM to know the system is healthy?',
          a: 'Watch the successful bookings per second at the booking tier against the admission rate. If admission is 30K/s and successful bookings are close to the remaining-slot drain rate, with p99 booking latency under 1 s, the system is healthy. A falling success rate with a steady admission rate means contention or DB saturation, so look at lock waits and pool queue depth. A rising rate of 5xx at the edge means the waiting room itself is struggling.',
        },
      ],
      pitfalls: [
        'Diving into the database schema before naming the hard parts',
        'Proposing WebSockets to 30M users for a slots-left counter',
        'Using a Redis lock per slot as the only correctness guarantee',
        'Treating all four patterns as equally deep and running out of time',
      ],
    },
    {
      id: 'design-patterns-iq-2',
      difficulty: 'hard',
      question:
        'Product wants the order-tracking screen in our grocery app to be "live". Peak is 2 million concurrent open screens, a rider location update arrives every 4 seconds, and status changes happen about 6 times per order. Walk me up the real-time ladder and tell me exactly where you stop and why.',
      whatInterviewerLooksFor: [
        'Quantifies each rung (QPS for polling, connections for push)',
        'Separates status events (rare, must not be missed) from location (frequent, lossy)',
        'Addresses event routing across connection servers',
        'Handles mobile backgrounding and reconnect',
      ],
      modelAnswer: `### Quantify the rungs
- **Short polling every 4 s:** 2M / 4 = **500K QPS**, mostly returning the same order status. The data is per-order, so a CDN cannot absorb it. This is too expensive.
- **Polling every 15 s:** 133K QPS, and the rider dot jumps visibly. That fails the product goal.
- **SSE:** 2M long-lived streams. At about 100K streams per tuned Node instance that is about 20 instances, plus 2× headroom for failover, so about 40. Each stream gets about 1 location message per 4 s, which is about 500K messages/s across the tier. The data flows one way (server to client), so SSE is enough. WebSocket adds nothing because the client sends nothing on this screen.

**I stop at SSE plus a pub/sub backbone.**

### Routing
Rider apps send location to an ingestion service, which writes the latest position to Redis keyed by rider. The service publishes to the channel \`order:{id}\` only for orders currently being delivered. The connection servers subscribe to the channels of the streams they hold. Redis Cluster sharded pub/sub (SSUBSCRIBE) spreads channels across shards.

### Two classes of events
- **Location** is lossy and conflated. If a client misses a ping, the next one replaces it. Send at most 1 update per 4 s and smooth on the client.
- **Status changes** (packed, picked up, arriving) must not be missed. They are persisted in the order table. On every (re)connect the client first GETs the current state and then streams, and each event carries a sequence number so the client can detect a gap and refetch.

### Mobile reality
When the app goes to the background, the OS kills the stream. Status changes then go out as FCM/APNs pushes. On returning to the foreground the client resyncs and reconnects. Heartbeats every 25 s stay under the 60 s LB idle timeout. On deploy, servers drain by closing streams gradually, and the clients reconnect with jittered backoff.`,
      followUps: [
        {
          q: 'A connection server dies holding 100K streams. What happens in the next 10 seconds?',
          a: 'All 100K clients see the stream close and reconnect through the LB to the surviving servers. Without jitter they arrive together and spike the auth and state endpoints. Clients should back off with a random 0–5 s delay, and the resync GET should be cheap, ideally a cached order-state read. Spare capacity of about 2× means the other servers absorb 100K extra streams. The pub/sub subscriptions move with the streams, because each server subscribes to whatever channels its new clients need.',
        },
        {
          q: 'Product now wants customers to chat with the rider on the same screen. Does your transport change?',
          a: 'Chat is two-way and low frequency, so the cheapest change is to keep SSE for downstream and send chat messages with ordinary POSTs. These go to a chat service that persists them and publishes to the same `order:{id}` channel. Move to WebSocket only if typing indicators or very high message rates make per-message HTTP overhead matter. In either case, chat messages need durable storage and sequence numbers, unlike location pings.',
        },
      ],
      pitfalls: [
        'Choosing WebSocket by default without noting that the flow is one-way',
        'Sending every rider ping to clients without conflation',
        'Forgetting that a pub/sub message is lost if the subscriber is disconnected',
        'Ignoring app backgrounding and push notifications',
      ],
    },
    {
      id: 'design-patterns-iq-3',
      difficulty: 'hard',
      question:
        'Two teams share a contention problem at very different intensities: team A edits customer profiles (about 50 concurrent edits per second across 10M profiles, rarely the same one), team B allocates a limited pool of 5,000 free-delivery slots per hour at a lunchtime peak of 4,000 attempts per second. Should they use the same concurrency technique? Pick a rung for each and defend it.',
      whatInterviewerLooksFor: [
        'Recognises conflict probability as the deciding variable',
        'Optimistic for A, atomic conditional or bucketed counter for B',
        'Computes hot-row ceilings',
        'Mentions what each user sees on conflict',
      ],
      modelAnswer: `### The deciding variable is the conflict rate, not the request rate
- **Team A:** 50 edits/s spread over 10M profiles means two edits colliding on the same profile within a second is vanishingly rare, apart from one user with two tabs open. **Optimistic concurrency** fits: add a \`version\` column, \`UPDATE … WHERE id = $1 AND version = $2\`, and when zero rows change return 409 so the client re-reads and merges. It holds no locks, needs no retries in the common case, and its failure mode is a clear "someone else edited this" message. Pessimistic locking would add lock waits for nothing.
- **Team B:** 4,000 attempts/s all target one logical counter, the slots left this hour. With optimistic control almost every attempt conflicts. With N concurrent writers only one wins each round, so retries multiply load and throughput collapses. Pessimistic locking serialises: at a 2 ms hold, about 500/s pass, and the other 3,500/s queue and exhaust the pools.

### Rung for B
1. **Atomic conditional decrement** (\`UPDATE … SET left = left - 1 WHERE left > 0 RETURNING\`) is the minimum. It is correct, but still one hot row.
2. **Bucket the pool:** 5,000 slots become 20 rows of 250, and each request picks a random bucket and falls back to another if that one is empty. The ceiling rises about 20×.
3. **Gate admission:** a Redis DECR pre-check (about 100K ops/s) rejects requests once the pool is clearly exhausted, so Postgres sees roughly remaining × 1.5. Correctness still lives in Postgres.

### What users see
A: a merge prompt, rarely. B: an immediate "slots full for 1–2 PM, next free slot 2 PM" instead of a spinner. Fast failure is part of the design.`,
      followUps: [
        {
          q: 'With 20 buckets, a user sees "sold out" while 3 slots remain in other buckets. Is that acceptable?',
          a: 'It is acceptable only if the fallback is bounded and honest. On a zero-row update, try two more random buckets, then one sequential scan of buckets whose count is above zero (an index on `left > 0`). Near the end of the pool this keeps the false sold-out rate small. Alternatively, collapse the buckets into one row when the total remaining drops below about 5% of capacity, because contention has fallen by then. Measure the false sold-out rate and include it in the trade-off you present.',
        },
        {
          q: 'Team A later adds a "bulk import" that rewrites 200K profiles nightly while users edit. What changes?',
          a: 'Now there are real conflicts between a background writer and humans. The import should also use the version check, skip and report conflicting rows instead of overwriting them, and run in small batches of 500–1,000 rows per transaction, so locks are short and replication lag stays low. Where possible, the import should update only the fields it owns (a field-level merge), so a user changing a phone number does not conflict with the import updating the loyalty tier.',
        },
      ],
      pitfalls: [
        'Applying one technique everywhere regardless of conflict rate',
        'Saying optimistic locking scales better without noting it collapses under high contention',
        'Using Redis as the sole source of truth for the slot count',
      ],
    },
    {
      id: 'design-patterns-iq-4',
      difficulty: 'expert',
      question:
        'Design the disbursal flow for a small-business loan product: KYC verification by a vendor (seconds to 10 minutes), a bureau credit pull, a manual underwriter approval that can take 2 days, e-signing, and finally an IMPS/NEFT transfer whose bank response can be "pending" for hours. Would you hand-roll a state machine, use a saga, or adopt a workflow engine? Justify with the specifics.',
      whatInterviewerLooksFor: [
        'Identifies the Multi-step pattern with long waits, timers and human steps',
        'Picks a durable workflow engine (or explains a robust hand-rolled alternative)',
        'Handles the unknown-outcome money transfer via idempotency and status polling',
        'Defines compensations that are business actions, not rollbacks',
      ],
      modelAnswer: `### Classify the process
It has five steps, three external parties, one human step lasting days, several timers (KYC timeout, approval SLA reminders, e-sign link expiry after 72 h) and one **money movement with an unknown outcome**. That is the top of the Multi-step ladder.

### Choice: a durable workflow engine (Temporal, or Step Functions on AWS)
- A workflow \`disburseLoan(applicationId)\` written as ordinary code: \`await kyc()\`, \`await bureau()\`, \`await approval signal\` with a 48 h timer for escalation, \`await esign()\`, \`await transfer()\`.
- The engine persists every step's result in an event history. If a worker pod dies, another replays the history and continues. Timers lasting days cost nothing while they wait.
- Activities have per-step retry policies: the KYC vendor gets exponential backoff, and the transfer gets **no blind retry**.

**Why not hand-roll?** I could build it with an \`applications\` state table, an outbox and a scheduler, but I would be re-implementing durable timers, retries, visibility ("why is loan 8812 stuck?") and versioning. For a 3-step synchronous flow I would hand-roll. For this flow, the engine pays for itself.

### The money step
- Generate the transfer request with an **idempotency key** = applicationId + attempt, and persist it *before* calling the bank.
- If the bank response is a timeout or "pending", the state becomes TRANSFER_UNKNOWN, and a status-enquiry activity polls every 15 minutes with backoff for up to T+1. The flow never sends a second transfer.
- Daily **reconciliation** with the bank statement catches anything the enquiry missed.

### Compensations
- A rejection after the bureau pull leads to a rejection notice and data retention per policy.
- An e-sign expiry leads to reissuing the link once and then cancelling.
- A failed transfer after signing leads to marking the loan account inactive and notifying ops. Interest does not accrue until funds actually land.
- Compensations are new business events, not deletes.`,
      followUps: [
        {
          q: 'You must deploy a change to the workflow code while 3,000 loans are mid-flight, some waiting on approvals. How?',
          a: 'Workflow code must stay deterministic against recorded history. Version the change: in Temporal, use `getVersion`/patching so old executions follow the old branch and new ones the new branch. Alternatively, start a new workflow type for new applications and let the old type drain. Never reorder or remove activities that in-flight histories expect. Test with replay tests against production histories before the deploy.',
        },
        {
          q: 'The bank confirms the transfer 6 hours late, after ops already marked it failed manually. What now?',
          a: 'This is exactly why manual overrides must go through the workflow as signals, not as direct DB edits. The late confirmation becomes a reconciliation exception: the money landed, so the loan must become active and interest dates adjust to the value date. Ops gets an alert to reverse its manual note. Design rule: only the reconciled bank statement may move a transfer to a final state, and a human can only request changes, never set the final state directly.',
        },
      ],
      pitfalls: [
        'Proposing 2PC across the bank, vendor and internal DB',
        'Retrying the transfer on timeout',
        'Ignoring timers, human steps and in-flight versioning',
        'Treating compensation as deleting rows',
      ],
    },
    {
      id: 'design-patterns-iq-5',
      difficulty: 'hard',
      question:
        'Our product listing API serves 80K requests per second during a sale; the Postgres primary is at 75% CPU and p99 is 900 ms. A listing card shows title, image, price, rating, "only 3 left" and delivery ETA. Climb the read-scaling ladder for me, and tell me which fields can be stale and by how much.',
      whatInterviewerLooksFor: [
        'Starts with query and index fixes before infrastructure',
        'Assigns a staleness budget per field',
        'Splits slow-changing vs fast-changing fields into different caches',
        'Computes the DB load after each rung',
      ],
      modelAnswer: `### Rung 1: fix the query
Check pg_stat_statements first. Listing endpoints are often N+1 (one query for ratings per product) or missing a composite index on (category, rank). A covering index plus batching ratings can cut DB time severalfold before any cache exists.

### Staleness budget per field
| Field | Changes | Staleness OK | Where it is served from |
|---|---|---|---|
| Title, image | Rarely | Minutes to hours | CDN plus a long-TTL document cache |
| Rating | Slowly | 10–30 min | Precomputed aggregate in the product document |
| Price | Several times a day (sale) | ~60 s on the listing; **fresh at checkout** | Redis, TTL 60 s, invalidated on change |
| Stock badge ("only 3 left") | Constantly | 10–30 s, and it is a hint | A separate small key, TTL 10 s |
| Delivery ETA | Per user pincode | Per request, cheap | A pincode-to-ETA table in memory, not per product |

### Rung 2: cache-aside, split by volatility
Store a product document without volatile fields (TTL 1 h), and keep price and stock in small separate keys. A listing page is one MGET of 20 documents plus 40 small keys. At a 98% hit ratio, Postgres sees 80K × 0.02 = **1.6K QPS**, down from 80K.

### Rung 3: the edge
The anonymous listing page (category plus sort, with no personalisation) is cached at the CDN for 30 s with stale-while-revalidate, and that absorbs most of the traffic. Personalisation is fetched separately.

### Rung 4: replicas, only if needed
After rungs 1–3, a single replica for analytics-ish queries is enough. I would not add five replicas to a problem that caching already solved.

### Guardrails
Request coalescing for hot SKUs, jittered TTLs, and a price check from the primary at add-to-cart and checkout, so a stale listing price can never be charged.`,
      followUps: [
        {
          q: 'The sale starts at 12:00 and all prices change at once. What happens to your cache at 12:00:00?',
          a: 'If prices were invalidated by deleting keys, 50K SKUs miss at the same instant, a stampede on Postgres. Pre-warm instead: write the new prices into Redis at 11:58 under versioned keys (`price:v2:{sku}`), then flip a single config pointer from v1 to v2 at 12:00. Reads switch atomically and none of them miss. The CDN pages use a sale-version URL parameter or a surrogate-key purge, staggered over a few seconds with request collapsing at the shield.',
        },
        {
          q: 'A seller complains the "only 3 left" badge stayed for 2 minutes after stock hit zero. Who is right?',
          a: 'The badge is a hint by design, and checkout is the authority, so no oversell occurred. Two minutes exceeds the 10 s budget, though, which points to a bug such as a TTL refreshed on read, or a CDN caching the whole card for longer than intended. Fix the budget violation, and publish a stock-zero event that deletes the badge key immediately, because out of stock is the transition customers care about most.',
        },
      ],
      pitfalls: [
        'Jumping to read replicas first',
        'Caching the whole product including price and stock under one long TTL',
        'Never stating staleness per field',
        'Trusting a cached price at checkout',
      ],
    },
    {
      id: 'design-patterns-iq-6',
      difficulty: 'expert',
      question:
        'We are building telemetry for 2 million EV chargers in India. Each sends a 300-byte status every 10 seconds; operators want a live map of charger state, utilities want 15-minute energy totals per charger for billing, and support wants a 90-day history for any charger. Which patterns are in play and which rungs of the write ladder do you pick for each consumer?',
      whatInterviewerLooksFor: [
        'Computes ingest rate and bytes per day',
        'Separates lossy-latest, exact-aggregated and raw-history needs',
        'Uses a durable log as the buffer and fan-out point',
        'Avoids a relational primary for raw ingest',
      ],
      modelAnswer: `### Numbers
2M / 10 s = **200K writes/s**, at 300 B each = 60 MB/s, which is about 5.2 TB/day raw (before compression and replication). That is two orders of magnitude beyond a single Postgres primary. **Scaling Writes** is the primary pattern. **Real-time** (live map) and **Scaling Reads** (operator dashboards) are secondary.

### Ingest: rung 1, buffer in a durable log
Chargers connect over MQTT to a broker tier. A bridge publishes every message to Kafka, keyed by charger_id. At ~10 MB/s per partition with headroom, 64 partitions handle 60 MB/s comfortably and leave room for 3× growth. Kafka is now the single source for the three consumers, and a slow consumer does not slow ingest.

### Consumer 1: live map, lossy-latest
A consumer overwrites \`charger:{id}\` in a Redis hash, keeping only the latest state. It does not need every message: if it falls behind it skips to the newest offset. The map is grid-aggregated (counts per geohash tile, by state) and refreshed every 5 s. Operators get SSE updates per tile they view, not per charger.

### Consumer 2: billing aggregates, exact
A stream processor (Flink or Kafka Streams) computes 15-minute tumbling windows per charger keyed by event time, with a watermark of a few minutes for late arrivals. Output is 2M × 96 windows/day = **192M rows/day**, written in batches to a columnar or time-series store. Writes are idempotent upserts keyed by (charger, window_start). A nightly reconciliation against the chargers' own cumulative meter readings corrects drift.

### Consumer 3: 90-day raw history
Kafka goes to object storage as Parquet files partitioned by date and charger hash, compressed about 5–10×, so about 0.5–1 TB/day. A query engine (Athena or Trino) handles "show me charger X last Tuesday". Lifecycle rules delete files after 90 days.

### What I avoid
Writing 200K rows/s into Postgres and adding replicas. Replicas add no write capacity, and the raw data does not need relational transactions.`,
      followUps: [
        {
          q: 'A firmware bug makes 300K chargers reconnect and replay 6 hours of buffered messages at once. Which component hurts first?',
          a: 'The MQTT and bridge tier and Kafka ingress get the burst first: 300K chargers × 2,160 messages = about 650M messages. Kafka absorbs it if disk and partitions allow, which is the point of the log. The live-map consumer must ignore old timestamps and must not overwrite newer state with replayed data, so compare event time before writing. The billing windows receive very late events beyond the watermark, so route them to a late-data side output and a correction job rather than reopening closed windows inline.',
        },
        {
          q: 'Finance wants billing totals within 1 minute of the window closing, but your watermark is 5 minutes. How do you reconcile those needs?',
          a: 'Emit two results: a provisional total at window close plus about 30 s, and a final total after the watermark passes. Mark each with `is_final`. Billing reads provisional totals for dashboards but invoices only from finals, or from the reconciliation run. This is the standard early-and-late firing trade-off: you cannot have both completeness and low latency, so expose which one each number represents.',
        },
      ],
      pitfalls: [
        'Not doing the arithmetic, then choosing Postgres for raw ingest',
        'Proposing read replicas for a write problem',
        'Treating all three consumers as needing the same consistency',
        'Forgetting late and out-of-order events',
      ],
    },
    {
      id: 'design-patterns-iq-7',
      difficulty: 'hard',
      question:
        'Creators on our app upload 4K videos up to 6 GB from phones on Indian mobile networks that drop every few minutes. Today the app POSTs the file to our API, which writes it to S3. Uploads fail constantly, and API pods OOM. Redesign the path from "tap upload" to "video playable", including how you keep metadata and bytes consistent.',
      whatInterviewerLooksFor: [
        'Moves bytes off the app tier with presigned multipart',
        'Resumability per part with part-size arithmetic',
        'Event-driven state transitions rather than trusting the client',
        'Explicit processing state and garbage collection of orphans',
      ],
      modelAnswer: `### Why it fails today
A 6 GB upload over 20 Mbps takes about 40 minutes through a pod. Any network drop restarts it from zero, and buffering parts in memory OOMs the pods. **Large Blobs** is the primary pattern, with **Long-Running** (transcode) right behind it.

### New flow
1. **POST /videos** creates a metadata row: \`{id, creator, status: PENDING_UPLOAD, size, sha256?}\`. The server picks the object key, starts an S3 multipart upload and returns presigned part URLs valid for 1 hour.
2. **Part size:** 6 GB / 32 MiB is about 180 parts, well inside the 10,000-part limit. Each part takes about 13 s at 20 Mbps, so a network drop loses at most one part. The client uploads 3–4 parts in parallel, records each ETag locally, and after a reconnect asks \`GET /videos/:id/parts\`, which calls ListParts and returns the parts already uploaded.
3. **Complete:** the client sends the ETag list, and the API calls CompleteMultipartUpload. The **S3 ObjectCreated event**, not the client's word, moves the status to UPLOADED and enqueues transcoding.
4. **Processing:** a transcoding DAG (probe → split into segments → encode renditions in parallel → package HLS → thumbnails) runs on a worker fleet. Status becomes PROCESSING, then READY_LOW when 480p is ready, then READY when all renditions are done. Progress reaches the creator via push notification.
5. **Delivery:** renditions go behind a CDN with signed URLs or cookies.

### Consistency and hygiene
- A lifecycle rule aborts incomplete multipart uploads after 3 days.
- A sweeper marks PENDING_UPLOAD rows older than 3 days as ABANDONED.
- Raw originals move to an infrequent-access tier after 30 days.
- Object keys contain the video id, so a retried transcode overwrites its outputs rather than duplicating them.
- Every state change is a conditional update on the current status, so duplicate events are harmless.`,
      followUps: [
        {
          q: 'How does a creator resume an upload from a different device or after reinstalling the app?',
          a: 'Resume state must live on the server, not the device. The metadata row keeps the uploadId and expected part count. The new device calls `GET /videos/:id/parts`, the server calls ListParts, and the device uploads the missing part numbers with fresh presigned URLs. The device needs the file itself again, and if the creator re-selects a different file, a content hash taken over the first and last N MB, or a full SHA-256, detects the mismatch.',
        },
        {
          q: 'Your transcoding workers are spot instances that get reclaimed with a 2-minute warning. How do you avoid losing a 40-minute encode?',
          a: 'Split the encode into segments, for example 10 s GOP-aligned chunks, so each task takes seconds to a minute and a reclaim loses one task, not the whole video. Tasks are idempotent and write to deterministic keys (`{video}/{rendition}/{seg}.ts`). On the reclaim notice the worker stops pulling new tasks, and the visibility timeout returns the in-flight task to the queue. The DAG controller assembles the playlist only once every segment exists.',
        },
      ],
      pitfalls: [
        'Increasing pod memory or request timeouts',
        'Letting the client mark the upload complete in the DB',
        'Single PUT for multi-GB files on mobile',
        'No cleanup of orphaned multipart uploads',
      ],
    },
    {
      id: 'design-patterns-iq-8',
      difficulty: 'medium',
      question:
        'An interviewer pushes back on your queue: "It is only a 40-second PDF generation; just make the request wait." Under what conditions would you agree, and what numbers make you insist on the async pattern?',
      whatInterviewerLooksFor: [
        'Does not reflexively insist on queues',
        'Uses Little\'s law and timeout limits as the decision criteria',
        'Considers retries, deploys and user behaviour',
        'Offers a middle ground',
      ],
      modelAnswer: `### When I would agree
- **Low volume:** say 1 request per minute from internal users. Little's law gives 1/60 × 40 s ≈ 0.7 requests in flight, which costs nothing.
- **Every hop allows it:** the gateway, LB idle timeout (ALB default 60 s, adjustable), CDN, and the mobile client timeout all exceed 40 s with margin, measured at p99, not average.
- **Repeating it is harmless:** if the user retries, a duplicate PDF wastes some CPU and has no other side effect.
- **Deploys:** a graceful-shutdown drain of 60 s or more covers in-flight requests.

### What makes me insist on async
- **Volume:** at 50 requests/s, Little's law gives 2,000 concurrent requests, each holding a socket and memory. One slow dependency then exhausts the pool, and the request tier becomes a job tier without the job tier's tools.
- **Tail:** if p99 is 3 minutes rather than 40 s, we cross gateway limits (often 29–30 s on managed API gateways) and users get 504s while the work continues. They click again, and we do it twice.
- **Side effects:** if the PDF is also emailed or stored, retries duplicate them unless an idempotency key exists.
- **Product:** users close the tab. A job with a notification ("your invoice is ready") is a better experience.

### Middle ground
Do the work synchronously with a short budget, say 5 s. If it is not done by then, return 202 with a job id and continue in the background. Most requests finish inline, and the slow tail degrades gracefully instead of timing out.`,
      followUps: [
        {
          q: 'You choose the middle ground. How do you avoid the work running twice when the 5-second budget expires?',
          a: 'Start every request as a job from the beginning: insert or enqueue it with a deterministic job id, run it, and await its completion promise for up to 5 s. If it finishes, return the result. If not, return 202 with the same job id. The work runs only once, inside the job runner, and the HTTP handler only waits on it. Do not start inline work and then enqueue a second copy on timeout.',
        },
        {
          q: 'Which metric would tell you, after launch, that the synchronous decision is going wrong?',
          a: 'Watch for p99 endpoint duration approaching the smallest timeout in the chain, together with in-flight concurrency, which you can scrape as a gauge or derive with Little\'s law from QPS × latency. The two often move together. Also watch the count of 499/504 responses (client gave up, or gateway timed out). Duplicate requests from the same user within a minute are an early sign that users are clicking again.',
        },
      ],
      pitfalls: [
        'Insisting on Kafka for any task over 1 second',
        'Raising every timeout to 5 minutes as the fix',
        'Ignoring that the gateway timeout, not the server, is usually the binding limit',
      ],
    },
    {
      id: 'design-patterns-iq-9',
      difficulty: 'medium',
      question:
        'You have 45 minutes and the prompt is "Design Swiggy Instamart". After requirements you can see at least five patterns in it. How do you decide which two get real deep-dive time, and what do you say about the rest?',
      whatInterviewerLooksFor: [
        'Ranks patterns by risk to stated non-functional requirements',
        'Mentions the rest briefly with a chosen rung',
        'Invites the interviewer to steer',
        'Keeps the high-level design simple',
      ],
      modelAnswer: `### List the patterns quickly (about 30 seconds)
- **Contention:** inventory per dark store. Ten-minute delivery means the store holds small stock, so oversell is likely.
- **Multi-step:** the order lifecycle: payment, picking, rider assignment, delivery, refunds.
- **Real-time:** live order tracking.
- **Scaling Reads:** the catalog and availability per dark store, at a high browse-to-buy ratio.
- **Long-running:** notifications and invoices. These are routine.

### Rank by which pattern most threatens a stated requirement
The requirements I wrote were "10-minute delivery", "never sell what the store does not have", and "a smooth browsing experience during the 8 PM peak".
1. **Contention on dark-store inventory.** It threatens correctness and customer trust directly. It gets a deep dive: a reservation with TTL at add-to-cart or checkout, decremented atomically per (store, sku), plus reconciliation with picker scans.
2. **Scaling Reads on per-store availability.** It threatens the browse experience at peak. It gets the second deep dive: per-store availability documents in Redis, invalidated by stock events, with CDN caching for non-personalised category pages.

### For the rest, one sentence each with a rung
- "Order lifecycle: a persisted state machine with an outbox. I can go deeper if you want."
- "Tracking: SSE with a Redis pub/sub channel per order, conflated to one update every 3 s."
- "Notifications: a queue with workers, retries and a DLQ."

### Then hand the steering wheel over
"Those are my two picks. Would you rather I go into dispatch or tracking instead?" Interviewers often have a deep dive they want, and asking shows you can prioritise without being rigid.`,
      followUps: [
        {
          q: 'The interviewer says, "Skip inventory, I care about rider dispatch." Which pattern is that, and what is your first rung?',
          a: 'Dispatch is Contention (one rider per order batch) combined with Scaling Writes (rider location pings). First rung: riders\' latest locations in a Redis geo index per city. Assignment runs a conditional update on the rider\'s state (`AVAILABLE` → `ASSIGNED` with the order id), so two orders cannot claim the same rider. A batching window of a few seconds lets the matcher optimise across orders instead of greedily assigning first-come.',
        },
        {
          q: 'You find yourself 30 minutes in with only the high-level design drawn. What do you cut?',
          a: 'Cut breadth, not depth. State the remaining patterns as one-liners with a chosen rung, then spend the remaining 12–15 minutes on the single most important deep dive, here inventory contention, with the actual SQL and failure cases. Close with 2 minutes on bottlenecks. A shallow tour of five patterns scores worse than one pattern handled with real depth.',
        },
      ],
      pitfalls: [
        'Trying to deep-dive all five patterns',
        'Ranking by what you know best instead of by risk to requirements',
        'Not offering the interviewer a choice',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-patterns-boe-1',
      question:
        'An IPL final has 5 million people on the live-score card in a sports app. Compare the cost of three real-time rungs: clients polling an uncached origin every 5 s, polling a CDN-cached score endpoint every 5 s, and SSE push from your own connection servers.',
      assumptions: [
        '5M concurrent viewers, all on the same match',
        'Poll interval 5 s; score payload ~1 KB',
        'CDN with ~200 edge POPs plus an origin shield; score TTL 1 s with request collapsing',
        'A tuned SSE server holds ~100K streams; score changes ~every 20–40 s (each ball)',
      ],
      steps: [
        { label: 'Uncached polling QPS', calc: '5,000,000 ÷ 5 s = 1,000,000 req/s at the origin' },
        { label: 'Uncached bandwidth', calc: '1M req/s × 1 KB ≈ 1 GB/s ≈ 8 Gbps of mostly unchanged responses' },
        { label: 'CDN-cached polling: edge load', calc: 'Still 1M req/s, but served from ~200 POPs ≈ 5K req/s per POP' },
        { label: 'CDN-cached polling: origin load', calc: 'Shield collapses misses: ~1 fetch per TTL ≈ 1 req/s (≤ 200 req/s without a shield)' },
        { label: 'SSE server count', calc: '5M ÷ 100K per box = 50 boxes; with 2× failover headroom ≈ 100 boxes' },
        { label: 'SSE fan-out per score change', calc: '1 change × 5M streams = 5M messages, every ~30 s ≈ 170K msg/s average, 5M in a burst' },
      ],
      answer:
        'Uncached polling at 1M QPS is unaffordable. CDN-cached polling serves the same 5 s freshness with an origin load of ~1–200 req/s and no stateful tier. SSE needs ~100 servers and 5M-message bursts per ball for at most a few seconds of extra freshness.',
      insight:
        'At extreme fan-out of identical data, cached polling beats push. Reserve push for per-user or interactive data (commentary chat, bets), and conflate updates there.',
      followUps: [
        {
          q: 'Product now wants the score within 1 second of the ball, not 5. Which option changes?',
          a: 'Polling every 1 s via the CDN means 5M req/s at the edge, about 25K per POP. That is still feasible for a large CDN, but the bill scales with request count, so cost rather than technology becomes the limit. SSE cost stays about the same, because the number of messages per change does not depend on the freshness target. At 1 s targets, push from your own servers or a managed edge pub/sub service often becomes cheaper per viewer-hour than edge requests. Quote both CDN and server prices before deciding.',
        },
      ],
    },
    {
      id: 'design-patterns-boe-2',
      question:
        'A coupon has 10,000 uses and is stored in one Postgres row. At launch, 30,000 redemption attempts per second arrive, and each successful redemption transaction holds the row lock for about 3 ms. How long does it take to hand out the coupons, what happens to the waiters, and what does bucketing change?',
      assumptions: [
        'One row, one lock; the transaction holds it ~3 ms (update + insert + commit)',
        '30K attempts/s for the first minute',
        'App pools: 12 pods × 20 connections = 240 connections',
        'Option: split into 20 bucket rows of 500 uses each',
      ],
      steps: [
        { label: 'Single-row ceiling', calc: '1 ÷ 0.003 s ≈ 333 redemptions/s' },
        { label: 'Time to exhaust 10K uses', calc: '10,000 ÷ 333 ≈ 30 s' },
        { label: 'Waiter build-up', calc: 'Arrivals 30K/s − 333/s served ≈ 29.7K/s queueing; 240 connections are all blocked within ~8 ms' },
        { label: 'User-visible effect', calc: 'Every other endpoint sharing those pools stalls; p99 explodes for 30 s' },
        { label: '20 buckets ceiling', calc: '20 × 333 ≈ 6.7K/s → 10K uses gone in ≈ 1.5 s' },
        { label: 'Admission gate', calc: 'Redis DECR pre-check passes ~1.5 × 10K = 15K attempts total; the other ~1.8M in the first minute get an instant "sold out"' },
      ],
      answer:
        'One row hands out the coupons in ~30 s at ~333/s, while the waiting requests exhaust all 240 connections almost instantly. With 20 buckets the coupons are gone in ~1.5 s; with a Redis gate in front, Postgres sees only ~15K attempts in total.',
      insight:
        'Contention throughput is set by lock-hold time, not by hardware. Shorten the hold, split the resource and reject early. More pods make it worse.',
      followUps: [
        {
          q: 'If you cannot change the schema, which single change gives the most relief?',
          a: 'Shorten the critical section and shed load before it. Make the redemption a single conditional `UPDATE … WHERE used < max_uses` in autocommit, which cuts the hold time to about 0.5–1 ms and raises the ceiling to about 1–2K/s. Add a dedicated small pool, around 10 connections, for coupon calls so they cannot starve other endpoints, and fail fast when that pool is busy. Bucketing still wins, but this buys a few times more headroom without a migration.',
        },
      ],
    },
    {
      id: 'design-patterns-boe-3',
      question:
        'A GST-invoice export feature receives 2,000 export requests per hour at month-end. Jobs average 90 s, and the p99 is 6 minutes. Size the worker fleet, the job-lock settings and the expected queue wait.',
      assumptions: [
        'Month-end peak: 2,000 jobs/hour, roughly uniform over that hour',
        'Mean job time 90 s, p99 6 min',
        'Each worker pod runs 4 concurrent jobs (I/O-bound streaming)',
        'Target utilisation ~70% so queues stay short',
      ],
      steps: [
        { label: 'Arrival rate', calc: '2,000 ÷ 3,600 ≈ 0.56 jobs/s' },
        { label: "Little's law: busy slots", calc: '0.56 × 90 s ≈ 50 jobs in progress on average' },
        { label: 'Slots at 70% utilisation', calc: '50 ÷ 0.7 ≈ 72 slots' },
        { label: 'Pods', calc: '72 ÷ 4 per pod ≈ 18 pods at month-end peak (2–3 off-peak)' },
        { label: 'Lock / visibility timeout', calc: 'p99 is 360 s, so either set the lock above 360 s or renew it, e.g. a 60 s lock renewed every ≤ 20 s via progress updates' },
        { label: 'Queue wait', calc: 'At 70% utilisation with many slots, waits are mostly under a few seconds; at 95% they grow to minutes' },
      ],
      answer:
        'About 50 jobs run concurrently on average. Provision ~72 slots, which is ~18 pods of 4, at month-end. Use a renewable 60 s lock with heartbeats rather than a fixed 6-minute timeout, and autoscale on the age of the oldest waiting job.',
      insight:
        'Size workers from arrival rate × duration, not from CPU. Heartbeat-renewed locks give fast crash recovery and avoid duplicate execution of long jobs.',
      followUps: [
        {
          q: 'Month-end traffic is actually concentrated in the last 2 hours of the last day: 10,000 jobs. What breaks first?',
          a: 'The arrival rate becomes 10,000 ÷ 7,200 ≈ 1.4 jobs/s, so Little\'s law gives about 125 busy slots, or about 180 slots at 70% utilisation, which is about 45 pods. The pods can scale; the database reading the rows often cannot. 125 concurrent streaming scans can saturate the replica\'s I/O. Cap job concurrency against the database, not just the pod count, and accept a queue. Communicate the expected wait in the UI ("about 6 minutes"), or precompute month-end exports overnight.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'design-patterns-mcq-01',
      difficulty: 'medium',
      question:
        'A clinic-appointment app lets patients pick a 15-minute slot with one of ~4,000 doctors; peak is ~20 bookings per second across all doctors. Which first rung is the right one for the "no double-booked slot" requirement?',
      options: [
        'A unique constraint on (doctor_id, slot_start) and a plain INSERT; treat the unique violation as "slot taken"',
        'A Redlock distributed lock per slot across five Redis nodes before inserting',
        'A Kafka topic partitioned by doctor_id so bookings for each doctor are processed serially',
        'A virtual waiting room that admits users in batches before they can see slots',
      ],
      correct: [0],
      explanation:
        'Contention here is low: 20 bookings/s spread over thousands of doctors rarely collide on one slot, so the lowest rung is enough. A unique constraint lets the storage engine enforce the invariant atomically. Redlock adds infrastructure and is not a correctness guarantee without fencing. Kafka serialisation and a waiting room are rungs for extreme contention and flash-sale spikes; here they add latency and complexity without need.',
      followUps: [
        {
          q: 'Patients now get a 10-minute hold while they pay a consultation fee. What changes?',
          a: 'The insert becomes a hold: a row with `status = HELD` and `hold_expires_at`. The uniqueness check must ignore expired holds, so use a conditional UPDATE on a pre-created slot row (`WHERE status = FREE OR hold_expires_at < now()`), or a partial unique index over active rows plus a sweeper. Payment success confirms only if the hold is still owned and live. Late payments on expired holds are refunded automatically.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-02',
      difficulty: 'hard',
      question:
        'Reading the requirements for a quick-commerce app, which phrases point mainly to the Scaling Writes pattern rather than Scaling Reads? Select ALL that apply.',
      options: [
        'Each delivery partner app reports GPS every 5 seconds while on shift',
        'The home screen with banners and categories is opened 40M times on sale day',
        'Every product impression in the feed must be recorded for ad billing',
        'Users browse the menu of their nearest dark store before ordering',
        'The catalog of 50K SKUs is shown with prices to every user',
      ],
      correct: [0, 2],
      explanation:
        'GPS pings and per-impression ad events are high-volume writes that each must land somewhere. Those are the Scaling Writes tells: "every", "reports every N seconds", "record". The home screen, menu browsing and catalog are the same data read many times, which is the Scaling Reads shape solved with caching and CDNs. A common mistake is to see "40M" and assume writes; volume alone does not tell you the direction of the traffic.',
      followUps: [
        {
          q: 'Which of the two write streams can be lossy, and how does that change your rung?',
          a: 'GPS can be lossy and overwritten: only the latest location matters for dispatch, so write the latest value to a Redis geo index and drop late pings. Raw history can go to Kafka and then object storage asynchronously. Ad impressions cannot be lost, because they are billed. They need a durable log (Kafka with acks=all), idempotent aggregation keyed by impression id, and reconciliation. The same pattern takes different rungs depending on how much loss each stream can tolerate.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-03',
      difficulty: 'expert',
      question:
        'This SSE endpoint works perfectly in staging with 50 users. In production it must hold 200K concurrent order-tracking streams across 4 pods. What fails first?',
      code: {
        language: 'typescript',
        code: `@Sse(':id/events')
stream(@Param('id') id: string): Observable<MessageEvent> {
  return new Observable((observer) => {
    const sub = new Redis(process.env.REDIS_URL!); // one connection per stream
    sub.subscribe('order:' + id);
    sub.on('message', (_ch, msg) => observer.next({ data: JSON.parse(msg) }));
    return () => sub.disconnect();
  });
}`,
      },
      options: [
        'Redis rejects connections: 200K subscriber connections far exceed the default maxclients of 10,000, and each pod also holds 50K extra sockets to Redis',
        'The Node event loop blocks because JSON.parse runs for every message on the main thread',
        'SSE cannot exceed 6 concurrent streams per browser, so most users never connect',
        'Redis pub/sub drops messages because PUBLISH is limited to 1,000 subscribers per channel',
      ],
      correct: [0],
      explanation:
        'A dedicated Redis connection per stream multiplies connections by the number of viewers. Redis has a default maxclients of 10,000, and the pods double their file-descriptor usage. The fix is one (or a few) subscriber connections per pod, multiplexing channels locally. JSON.parse of small payloads is cheap. The 6-connection limit applies per origin per browser under HTTP/1.1, and each user has one stream. Redis has no per-channel subscriber cap of 1,000.',
      followUps: [
        {
          q: 'With one shared subscriber per pod, each pod still subscribes to 50K distinct channels. Any concern?',
          a: 'Classic Redis pub/sub broadcasts every PUBLISH to all cluster nodes, so cluster-wide bus traffic grows with message rate × nodes. Use sharded pub/sub (SSUBSCRIBE/SPUBLISH, Redis 7+) so a channel lives on one shard, and ref-count channels per pod so unsubscribing happens when the last local stream for an order closes. Alternatively, partition streams so that orders for a given hash always land on the same pod, which shrinks the channel set per pod.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-04',
      difficulty: 'medium',
      question:
        'An internal ops dashboard for 8,000 agents polls ticket counts every 30 s. The PM asks to "make it real-time". Which response shows the best judgment?',
      options: [
        'Introduce WebSockets with a Kafka backbone so every ticket change is pushed immediately',
        'Ask what freshness is actually needed; if ~5 s is enough, polling at 5 s is ~1.6K QPS of cacheable reads that one or two pods handle',
        'Switch to long polling, because it is always cheaper than short polling',
        'Keep 30 s polling, because real-time features never pay off for internal tools',
      ],
      correct: [1],
      explanation:
        'Start on the lowest rung that meets a stated number: 8,000 ÷ 5 s = 1,600 QPS of shared aggregate counts, which is trivially cacheable and stateless. Push is justified only if sub-second freshness is required or the data is per-user and frequent. Kafka plus WebSockets for this is over-engineering. Long polling is not "always cheaper": it holds connections open and reconnects after every event. Refusing outright ignores a legitimate product need.',
      followUps: [
        {
          q: 'The PM clarifies agents must see a newly assigned ticket within 1 second. What now?',
          a: 'Per-agent and sub-second needs justify push for that one event type. Open an SSE stream per agent (8,000 streams fit on one or two pods) and publish `agent:{id}` events when a ticket is assigned. Keep the aggregate counts on cheap polling or piggyback them every 10 s. Choose the rung per event type, not per screen.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-05',
      difficulty: 'expert',
      question:
        'During a flash sale for 100 units, 2,000 buyers per second hit this handler. What is the most accurate prediction?',
      code: {
        language: 'typescript',
        code: `async function buy(skuId: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { rows } = await db.query('SELECT stock, version FROM sku WHERE id = $1', [skuId]);
    if (rows[0].stock === 0) return 'SOLD_OUT';
    const r = await db.query(
      'UPDATE sku SET stock = stock - 1, version = version + 1 WHERE id = $1 AND version = $2',
      [skuId, rows[0].version],
    );
    if (r.rowCount === 1) return 'OK';
  }
  return 'TRY_AGAIN';
}`,
      },
      options: [
        'It oversells, because two buyers can read the same version and both succeed',
        'It is correct but wasteful: nearly every round has one winner and many losers, so retries multiply DB load up to 10× and many buyers get TRY_AGAIN while stock remains',
        'It deadlocks, because the SELECT takes a shared lock that the UPDATE must upgrade',
        'It performs best among the options, because optimistic locking holds no locks and scales with concurrency',
      ],
      correct: [1],
      explanation:
        'The version check makes it correct: only one UPDATE per version can match, so no oversell. Under high contention, though, each round has a single winner, so losers retry, re-read and collide again. Load grows up to 10× and buyers see TRY_AGAIN even while stock exists. A plain SELECT in Postgres takes no row lock, so there is no upgrade deadlock. Optimistic locking scales only when conflicts are rare; here they are the norm. An atomic `WHERE stock > 0` decrement needs no version or retry.',
      followUps: [
        {
          q: 'Rewrite it with one statement and explain why it removes the retry loop.',
          a: '`UPDATE sku SET stock = stock - 1 WHERE id = $1 AND stock > 0 RETURNING stock`. Postgres re-evaluates the WHERE clause against the latest row version after it acquires the row lock, so concurrent buyers queue briefly on the lock and each either decrements or sees zero. No retry is needed, because the condition is about the value rather than a specific version. Zero rows updated means sold out. Throughput is then capped by lock hold time (about 1 ms), so add buckets or an admission gate for more.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-06',
      difficulty: 'expert',
      question:
        'In a checkout saga, the call to the payment provider times out after 10 s. You do not know whether the customer was charged. Which actions are correct? Select ALL that apply.',
      options: [
        'Query the provider for the payment status using the same idempotency key or merchant order id before deciding anything',
        'Move the order to PAYMENT_UNKNOWN and let a status poller or reconciliation resolve it, keeping the stock hold alive meanwhile',
        'Immediately issue a refund to be safe, then cancel the order',
        'Retry the charge with a new idempotency key so the provider treats it as a fresh attempt',
        'Mark the order FAILED and release the stock, because timeouts mean the request did not reach the provider',
      ],
      correct: [0, 1],
      explanation:
        'A timeout is an unknown outcome, not a failure. The safe path is to ask the provider (status API keyed by your idempotency key or order id) and park the order in an explicit unknown state until a poller or reconciliation resolves it. Refunding a payment that may not exist creates a mess, and a new idempotency key risks double-charging. Assuming the request never arrived is the classic bug: the provider may have charged and simply replied late.',
      followUps: [
        {
          q: 'The stock hold expires in 10 minutes but the status remains unknown for 30 minutes. What do you do?',
          a: 'Extend the hold for orders in PAYMENT_UNKNOWN up to a bounded limit, because releasing stock that might be paid for risks an oversell. If the status is still unknown at the limit, release the stock and flag the order for manual review. If the payment later shows as captured, either fulfil from restocked inventory or refund automatically, according to policy. Track the count of unknown outcomes as an SLI per provider.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-07',
      difficulty: 'hard',
      question:
        'After moving read traffic to two replicas, primary CPU drops from 85% to 40%. Two days later support reports "I paid, but My Orders shows nothing", mostly within ~2 s of checkout. Replica lag p99 is 1.5 s. Which fix targets the cause with the least collateral cost?',
      options: [
        'Make replication synchronous so the replicas are never behind',
        'Route a user\'s reads to the primary for a few seconds after that user writes, or return the new order in the checkout response and render from it',
        'Add a Redis cache for My Orders with a 60 s TTL',
        'Move all reads back to the primary',
      ],
      correct: [1],
      explanation:
        'This is the Scaling Reads × Multi-step collision: read-your-writes is broken for a short window after a write. Pinning that user\'s reads to the primary briefly, or using the write response, fixes exactly that window and keeps 99%+ of reads on the replicas. Synchronous replication adds write latency to every transaction and couples the primary to replica health. A 60 s cache makes staleness worse. Moving all reads back throws away the capacity gain.',
      followUps: [
        {
          q: 'How would you implement "a few seconds" without sticky sessions?',
          a: 'After a write, set a short-lived marker that the client carries. One option is a signed cookie or header `x-rw-until = now + 3s`. Another is to record the commit LSN (`pg_current_wal_lsn()`) and route to a replica only if its `pg_last_wal_replay_lsn()` has passed that LSN. The LSN approach is precise and adapts to real lag. The time window is simpler but must exceed the replica-lag p99, with alerts when lag goes beyond it.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-08',
      difficulty: 'expert',
      question:
        'A write-buffering counter loses increments under load, although no errors are logged. What causes it?',
      code: {
        language: 'typescript',
        code: `class Likes {
  private deltas = new Map<string, number>();
  incr(id: string) { this.deltas.set(id, (this.deltas.get(id) ?? 0) + 1); }

  async flush() {
    for (const [id, n] of this.deltas) {
      await db.query('UPDATE posts SET likes = likes + $1 WHERE id = $2', [n, id]);
    }
    this.deltas.clear();
  }
}`,
      },
      options: [
        'The UPDATE uses likes + $1 instead of a SET to the absolute value, so concurrent pods double-count',
        'incr() calls that happen during the awaits inside flush() modify the same map, and clear() then deletes those increments (and any rows not yet flushed when a later query throws)',
        'Map iteration order is random, so some ids are skipped during the loop',
        'Postgres silently ignores UPDATEs that run within the same millisecond on the same row',
      ],
      correct: [1],
      explanation:
        'The await yields to the event loop, so increments arriving mid-flush land in the map that clear() then wipes. An increment to an id already flushed in this loop is lost outright. A throw part-way also leaves earlier rows applied while clear() never runs, which is a separate double-count risk. The fix is to swap in a new map before flushing and put the batch back on failure. The additive UPDATE is correct for multi-pod setups. JS Map iteration follows insertion order, and Postgres does not drop updates.',
      followUps: [
        {
          q: 'The pod is killed with SIGKILL between flushes. How much is lost, and how would you bound it?',
          a: 'Up to one flush interval of increments on that pod is lost, for example 1 s × its share of traffic. If that is unacceptable, write each like event to Kafka first, which is the durable raw log, and have the aggregator consume, aggregate and commit offsets only after the DB write. A crash then replays events. Make the DB write idempotent per (partition, offset-range) so a replay does not double-count. For likes, many products accept a 1 s loss window plus nightly recount reconciliation.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-09',
      difficulty: 'hard',
      question:
        'Users upload documents directly to S3 with presigned URLs, then the app calls POST /files/:id/complete, which marks the row READY. Ops finds ~0.3% of READY rows with no object in the bucket. What is the root cause and best fix?',
      options: [
        'S3 is eventually consistent for new objects; add a 5-second delay before marking READY',
        'The client is trusted to report success; drive the READY transition from the S3 ObjectCreated event (or a HEAD check of size/checksum), not from the client call',
        'Presigned URLs expire too early; extend them to 7 days',
        'The metadata DB loses writes; switch the files table to synchronous replication',
      ],
      correct: [1],
      explanation:
        'Clients crash, retry out of order, or call complete after a failed PUT, so trusting them lets metadata drift from the bytes. The storage event, or a server-side HEAD that verifies size and checksum, is the source of truth for "bytes exist". S3 has offered strong read-after-write consistency since December 2020, so a delay fixes nothing. Longer URLs increase risk without addressing the cause. The DB is not losing writes; it is recording a false claim.',
      followUps: [
        {
          q: 'The reverse also happens: objects exist with no metadata row. How do you clean those up safely?',
          a: 'Upload to a staging prefix (`incoming/`) whose objects have a lifecycle rule that deletes them after, say, 2 days. The event handler moves or copies an object to its final key only when a matching PENDING row exists, and only then flips the row to READY. Orphans are never referenced and expire on their own. Also add `AbortIncompleteMultipartUpload` for unfinished multipart uploads. A periodic inventory diff (S3 Inventory against the DB) catches anything else.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-10',
      difficulty: 'expert',
      question:
        'A video-summary job takes about 20 minutes. The worker below is deployed with 3 replicas. Which outcomes should you expect? Select ALL that apply.',
      code: {
        language: 'typescript',
        code: `new Worker('summaries', async (job) => {
  const transcript = await fetchTranscript(job.data.videoId);   // ~1 min
  const summary = await callLlmInOneShot(transcript);           // ~19 min, no progress updates
  await db.query('INSERT INTO summaries (video_id, text) VALUES ($1, $2)', [job.data.videoId, summary]);
}, { connection, lockDuration: 30_000, concurrency: 2 });`,
      },
      options: [
        'If the event loop blocks long enough to miss lock renewal, BullMQ detects the job as stalled and another replica starts it again while the first is still running',
        'Duplicate summary rows, or a unique-violation failure, when two executions both reach the INSERT',
        'A deploy that terminates a pod mid-job loses the work in progress, and the job restarts from scratch',
        'Redis runs out of memory because BullMQ keeps the 20-minute job payload in RAM per second of runtime',
        'The job can never take longer than lockDuration, so it is killed after 30 s',
      ],
      correct: [0, 1, 2],
      explanation:
        'BullMQ renews the lock automatically while the event loop is free. Any CPU-heavy step (parsing a huge transcript, say) that delays renewal past 30 s lets the stalled-job checker hand the job to another replica, producing concurrent duplicates. A non-idempotent INSERT then writes twice or fails. A pod killed mid-job loses 20 minutes of work because nothing is checkpointed. lockDuration is not a maximum runtime; renewals extend it. Payload memory does not grow with runtime.',
      followUps: [
        {
          q: 'How would you restructure the job so a crash at minute 18 costs at most a minute or two?',
          a: 'Split the work into steps with checkpoints: chunk the transcript, summarise chunks as separate idempotent child jobs (a BullMQ flow or one job per chunk, keyed by video and chunk index), store each chunk summary, then run a final reduce job. Use `INSERT … ON CONFLICT (video_id) DO UPDATE` for the final write. Keep CPU-heavy parsing in worker_threads so lock renewals are not starved. Each step is short, so a retry repeats only the step that was interrupted.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-11',
      difficulty: 'medium',
      question: 'Which new prompt belongs mainly to the Large Blobs + Long-Running Tasks family?',
      options: [
        'A podcast hosting platform where creators upload 2-hour WAV files that are normalised, transcoded and transcribed',
        'A Splitwise-style expense-sharing app',
        'A typeahead search box for a product catalog',
        'A per-API-key rate limiter for a public API',
      ],
      correct: [0],
      explanation:
        'Huge uploads plus multi-minute processing (transcode, transcription) is the media family: presigned multipart upload, storage events, a processing DAG, and status states. Splitwise is about ledger correctness (Multi-step and consistency), typeahead is a Scaling Reads problem with precomputed top-k, and a rate limiter is a counter problem combining Scaling Writes and Contention.',
      followUps: [
        {
          q: 'What status states would you show the creator, and what drives each transition?',
          a: 'Use `UPLOADING` (the client is sending parts), `UPLOADED` (set by the ObjectCreated event), `PROCESSING` (the first worker picked the job, with progress per stage), `READY` (all renditions and the transcript stored), and `FAILED` (retries exhausted, with a reason). Each transition is a conditional update from the expected prior state, driven by storage events and worker callbacks, never by the client. Partial readiness, such as playable audio before the transcript is done, can be its own state.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-12',
      difficulty: 'expert',
      question:
        'A ride-hailing app receives 300K driver location pings per second. A teammate proposes "Postgres with 5 read replicas to handle the load." What is the strongest objection and alternative?',
      options: [
        'Replicas add no write capacity, since each one replays every write; keep only the latest location per driver in a sharded in-memory geo index and send raw pings to a log',
        'Postgres cannot store latitude and longitude efficiently; use MongoDB with a 2dsphere index on the primary',
        'Five replicas are too few; with 30 replicas the read load would be fine',
        'Replicas are fine, but use synchronous replication so dispatch sees fresh data',
      ],
      correct: [0],
      explanation:
        'Pings are writes, so this is Scaling Writes, and replicas multiply only read capacity: every replica must apply all 300K writes/s too. The data is lossy-latest (only the current position matters for matching), so an overwrite into Redis or an in-memory geo index sharded by city or cell fits, with Kafka carrying the raw stream for history and ETA training. Postgres with PostGIS handles geo data fine; volume is the issue. More replicas or synchronous replication make the write problem worse.',
      followUps: [
        {
          q: 'Which shard key do you choose for the location index, and what is its failure mode?',
          a: 'Shard by geo cell, such as an H3 or geohash cell at city scale, because matching queries are "drivers near point P". The failure mode is hot cells: an airport or stadium at 11 PM concentrates drivers and queries. Mitigate by using finer cells in dense areas and spreading a hot cell\'s drivers across sub-shards that are queried together. A driver crossing a cell boundary means a delete from one shard and an add to another, so tolerate brief double presence.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-13',
      difficulty: 'hard',
      question: 'This presigned-upload endpoint passed code review. What is the most serious problem?',
      code: {
        language: 'typescript',
        code: `@Post('upload-url')
async uploadUrl(@Body() b: { key: string; contentType: string }, @Req() req: AuthedRequest) {
  const cmd = new PutObjectCommand({ Bucket: 'user-files', Key: b.key, ContentType: b.contentType });
  const url = await getSignedUrl(s3, cmd, { expiresIn: 7 * 24 * 3600 });
  await this.files.insert({ owner: req.user.id, key: b.key, status: 'PENDING' });
  return { url };
}`,
      },
      options: [
        'The URL lasts 7 days, so it may expire before slow uploads finish',
        'The client chooses the object key, so any user can obtain a URL that overwrites another user\'s file (and the long expiry widens the window)',
        'ContentType should be validated with a regex on the client before calling this endpoint',
        'getSignedUrl makes a network call to S3 per request, which will not scale',
      ],
      correct: [1],
      explanation:
        'Letting the client pick the key, for example another user\'s path, turns the signer into an overwrite primitive. The server must generate the key (owner id + random UUID) and record it. The 7-day expiry worsens the exposure: keep it to minutes and re-issue on resume. Client-side validation is not a control, though server-side limits on type and size are good additions. getSignedUrl signs locally with credentials and makes no S3 call.',
      followUps: [
        {
          q: 'How do you cap the uploaded file size when the client talks directly to S3?',
          a: 'A presigned PUT cannot enforce a maximum by itself unless you sign a fixed ContentLength. Two options: use a presigned POST with a policy condition `content-length-range` (for example 0–50 MB), or sign the PUT with an exact ContentLength the client declared and validate that declared value server-side. In either case, verify the actual size on the ObjectCreated event and reject or delete anything over the limit before marking it READY.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-14',
      difficulty: 'expert',
      question:
        'A Diwali sale shows a "stock left" bar on a deal page watched by 3M concurrent users; stock changes ~50 times per second. The team plans to push every change over WebSockets. What is the best design?',
      options: [
        'Push every change: 50 changes/s × 3M sockets is fine because WebSocket frames are small',
        'Conflate: publish at most one update every 1–2 s (latest value wins), served from a CDN-cached endpoint polled every few seconds or via SSE with conflation; checkout remains the authority',
        'Use long polling so the server only answers when stock changes',
        'Remove the bar, since real-time stock displays are impossible at this scale',
      ],
      correct: [1],
      explanation:
        'Pushing every change means 50 × 3M = 150M messages/s, which is the Real-time × Scaling Writes collision. The bar is a hint, so conflating to the latest value every 1–2 s cuts fan-out 50–100× with no visible loss, and a CDN-cached value absorbs the reads. Long polling would return almost immediately on every change, effectively becoming 150M req/s of polling. Dropping the feature ignores a solvable product need.',
      followUps: [
        {
          q: 'The bar shows 2% left but checkout says sold out for many users. How do you keep that from feeling broken?',
          a: 'Make the bar honest about being approximate. Round to buckets ("almost gone", or under 1% shown as "selling fast") instead of exact numbers, and switch to "sold out" as soon as an authoritative zero arrives via a priority event that bypasses conflation. When an add-to-cart fails, return alternatives in the same response. Measure the share of users who see stock and then hit sold out, and tighten the update interval near the end of stock, when the transitions matter most.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-15',
      difficulty: 'medium',
      question:
        'Which properties of a business process suggest a durable workflow engine (Temporal, Step Functions) rather than a hand-rolled state table? Select ALL that apply.',
      options: [
        'A human approval step that can take days, with reminder and escalation timers',
        'Dozens of timers and branches per instance, and ops needing to see where each instance is stuck',
        'Three steps that all write to the same Postgres database inside one transaction',
        'A strictly synchronous 200 ms flow that either succeeds or returns an error to the caller',
      ],
      correct: [0, 1],
      explanation:
        'Long waits, human steps, many durable timers and per-instance visibility are exactly what workflow engines provide, so hand-rolling them means rebuilding the engine. A flow that fits in one DB transaction is Rung 1 and needs nothing more. A 200 ms synchronous flow gains nothing from durable history. The engine is justified by duration and branching complexity, not by step count alone.',
      followUps: [
        {
          q: 'What is the most common production mistake teams make in their first month with Temporal?',
          a: 'Putting non-deterministic code in workflow functions: calling `Date.now()`, random numbers, HTTP requests or DB reads directly instead of inside activities. On replay the history diverges and the workflow fails with a non-determinism error. A close second is huge payloads in history (passing a 5 MB document between activities) instead of passing a storage key. Lint for both, and run replay tests in CI.',
        },
      ],
    },
    {
      id: 'design-patterns-mcq-16',
      difficulty: 'hard',
      question:
        'A cricketer\'s profile gets 150K reads/s after a viral moment. It lives on one Redis Cluster shard that tops out near 100K ops/s; the other 11 shards are idle. Which mitigation actually helps?',
      options: [
        'Add 12 more shards to the cluster to double total capacity',
        'Serve the key from a short-TTL in-process (L1) cache on each API pod, and/or replicate it under N suffixed keys spread across shards and read a random copy',
        'Increase the Redis TTL from 5 minutes to 1 hour to improve the hit ratio',
        'Move the profile to a read replica of Postgres',
      ],
      correct: [1],
      explanation:
        'A single key lives in one slot on one shard, so adding shards does nothing for it. That is the hot-key failure of Scaling Reads. A 1–5 s L1 cache on each of, say, 50 pods turns 150K Redis reads/s into about 50 refreshes per TTL window. Suffixed replicas (`profile:42#0..7`) spread the reads across shards. The hit ratio is already ~100% for this key, so a longer TTL does not help. A Postgres replica is slower than the cache it would replace.',
      followUps: [
        {
          q: 'How do you detect hot keys before they cause an incident?',
          a: 'Sample on the client side: count key accesses in a small top-k sketch per pod and export the top keys every 10 s, or run `redis-cli --hotkeys` (with an LFU maxmemory policy) or `MONITOR` sampling briefly in staging. Alert when one shard\'s ops/s exceeds about 3× the cluster median. Some teams auto-promote any key above a threshold into the L1 tier for a short period.',
        },
      ],
    },
  ],
};

export default topic;
