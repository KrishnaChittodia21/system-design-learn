import type { Topic } from '../../types';

const topic: Topic = {
  id: 'lld-cases-2',
  phase: 'lld',
  order: 6,
  title: 'LLD Case Studies II: Rate Limiter, In-memory Pub/Sub, Task Scheduler & a Game (Snake & Ladder / Chess)',
  subtitle:
    'Four machine-coding favourites done HLD → LLD: a pluggable rate-limiter library, a Kafka-lite pub/sub with consumer groups, offsets, retries and a DLQ, a heap-based task scheduler with cron, retries and misfire handling, and Snake & Ladder with the Chess pivot — plus how to time-box the 90 minutes.',
  estimatedMinutes: 150,
  sources: [
    'LeetCode Discuss — PhonePe machine coding round: Message Queuing System (custom queue, regex subscribers, dependencies, retries)',
    'LeetCode Discuss — Flipkart SDE 3 (2025): 90-minute MVP of an in-memory message streaming service (topics, partitions, ordering, thread safety)',
    'LeetCode Discuss — Razorpay SSE interview experience (2025): in-memory pub-sub with producers, consumers, subscriptions and offsets',
    'LeetCode Discuss — Uber machine coding round: in-memory task scheduler library (run-at, fixed-interval, configurable worker threads)',
    'LeetCode Discuss — Microsoft SDE2 (March 2026): task scheduling system like cron/Airflow (one-time + recurring, thread safety)',
    'LeetCode Discuss — Flipkart SDE 2 interview experience: task scheduler handing tasks to worker threads, otherwise queueing',
    'LeetCode Discuss — Machine Coding | Flipkart | Snake and Ladder; Meesho SDE-2 and Gameberry Labs (2026) Snake & Ladders machine-coding rounds',
    'LeetCode Discuss — PhonePe Backend SE (3–5 yrs): 90-minute machine coding followed by a concurrency and design-patterns review call',
    'Blind — Uber in-depth specialization coding round (rate limiter: timestamps, evicting old entries, trade-offs)',
    'Glassdoor — Atlassian code design round reviews (rate limiter judged on correctness and extensibility)',
    'workat.tech — Machine coding practice problems and "How to ace the machine coding round"',
    'Quartz Scheduler documentation — misfire instructions (FIRE_ONCE_NOW, DO_NOTHING)',
    'Apache Kafka documentation — consumer groups, committed offsets and delivery semantics',
    'Gamma, Helm, Johnson, Vlissides — Design Patterns (Strategy, Observer, Command, Flyweight, Template Method)',
  ],
  tags: ['lld', 'machine-coding', 'rate-limiter', 'pub-sub', 'message-queue', 'task-scheduler', 'cron', 'snake-and-ladder', 'chess', 'strategy-pattern', 'concurrency'],
  cheatSheet: [
    'Machine-coding clock (90 min): 10 clarify → 15 entities + interfaces → 35 happy path end-to-end with a driver → 15 edge cases + one extension → 15 demo and walkthrough. Working beats elegant-but-unfinished.',
    'Rate limiter library: algorithm = stateless Strategy shared per rule (Flyweight); per-key state is two numbers; inject a Clock; evaluate all rules first, consume only if all pass (no partial charge).',
    'Bound limiter memory: LRU cap + idle sweep. Evicting an idle token bucket is lossless (full bucket = new bucket); evicting a busy one silently resets the limit, so alert on evictions.',
    'Node atomicity rule: a critical section is safe only if there is no await between read and write. Make it async (Redis) and you need Lua/CAS; split across worker_threads and the limit multiplies.',
    'Pub/sub: topic → partitions (append-only arrays + base offset) → consumer group cursor {committed, next, inflight, acked}. Commit only the contiguous acked prefix; ack is idempotent.',
    'At-least-once = redeliver on ack timeout or nack after backoff; after maxAttempts publish to a DLQ with origin/error headers, then ack. Retrying with maxInFlight > 1 trades away per-key ordering.',
    'Backpressure as a policy: bounded partitions throw/block/drop-oldest on publish; consumers get credit via maxInFlight; retention truncates only below the slowest group\'s committed offset.',
    'Scheduler: min-heap by (runAt, seq) + one re-armable timer + ready heap by priority + bounded worker pool. Cancel = version bump (lazy deletion) + AbortController for the running attempt.',
    'Recurring jobs: anchor FixedRate to the start time (no drift), enqueue occurrence N+1 only after N settles (no overlap), runKey = taskId@scheduledAt for idempotent side effects; after restart apply a misfire policy (fire-once vs skip).',
    'Snake & Ladder: Jump base class (Snake/Ladder/new obstacles), Board validates (direction, duplicates, no chains), Dice is injectable, Rules object for overshoot/sixes, queue for turns, Observer for events, expectedTurn against double-clicks. Chess pivot: Piece.candidates() + "king not attacked after move" filter.',
  ],
  sections: [
    {
      heading: 'Time-boxing a 90-minute machine-coding round',
      body: `**Intuition:** a machine-coding round is a cooking show. The judges taste what is on the plate at the end; a beautiful half-cooked dish scores lower than a simple complete one.

**What the round is.** Flipkart, PhonePe, Swiggy, Razorpay, Meesho, Cred and Uber run a 60–120 minute round where you build a working, in-memory, runnable program (no DB, no framework, usually no internet), then walk a reviewer through it. PhonePe often does the review as a separate 30-minute call, with questions on concurrency and design patterns. Some companies (Atlassian) judge correctness and extensibility under new requirements revealed mid-round.

**The clock that works:**

| Minute | Do | Output |
|---|---|---|
| 0–10 | Clarify scope, write requirements as a checklist at the top of the file | 6–10 bullet list, explicit "out of scope" |
| 10–25 | Nouns → classes, verbs → methods; write interfaces and the driver first | Compiling skeleton + \`main()\` that calls the API |
| 25–60 | Happy path end-to-end, one class at a time | Demo that runs |
| 60–75 | Validation, edge cases, one extension point exercised (e.g. a second strategy) | Errors are typed, not \`console.log\` |
| 75–90 | Run the demo, tidy names, prepare a 3-minute walkthrough | Working program + talking points |

**Rules evaluators grade on:** (1) does it run and do the asked things; (2) separation of concerns (no I/O inside domain classes); (3) extensibility: a new strategy is a new class, not an \`if\`; (4) correct handling of the edge cases you listed; (5) concurrency awareness, at least stated; (6) readable names and small methods. Tests are a bonus; a scripted driver with a deterministic \`Dice\` or \`Clock\` is almost as good.

**Stub, do not skip:** persistence (a \`Repository\` interface with an in-memory implementation), auth, CLI parsing. Stubs show you know where things go without eating 20 minutes.

**In the review, say this:** "I kept every policy behind an interface: here is where a second algorithm would go, here is the one place that is not thread-safe and how I would fix it."`,
      diagram: `  0       10            25                       60          75        90
  |-------|-------------|------------------------|-----------|---------|
   clarify  entities +     happy path end-to-end   edge cases   demo +
   scope    interfaces +   (always runnable)       + 1 ext.     review
            driver main()
                                  ^
                     minute 50 checkpoint: if the demo does not run
                     yet, cut scope NOW (drop extras, keep the core)`,
      keyPoints: [
        'Write the driver (main) at minute 15 so the program is runnable from the start.',
        'Inject randomness and time (Dice, Clock) so the demo is deterministic.',
        'Never use console.log for control flow; throw typed errors and print only in the driver.',
        'Leave one extension point exercised (a second Strategy) to prove extensibility.',
      ],
      source: 'workat.tech — How to ace the machine coding round; LeetCode Discuss PhonePe / Flipkart experiences',
    },
    {
      heading: 'Rate limiter (1/3) — requirements and a brief HLD for a pluggable library',
      body: `**Intuition:** the HLD version of this problem (Redis, Lua, gateways) is covered in the Rate Limiting topic. Here the interviewer wants the *library*: what would \`@acme/rate-limit\` look like so that ten NestJS teams can drop it in and configure it without forking it?

**Functional requirements**
- \`check(request) → Decision { allowed, remaining, retryAfterMs }\`.
- Several **rules** per request, all must pass: e.g. 100/min per API key, 20/s per IP, 5/min per IP on \`/login\`.
- Several **algorithms**: token bucket (bursty APIs), sliding log (exact, small limits like OTP), fixed window (cheap). New ones added without editing the core.
- **Weighted cost** (an export endpoint costs 10 tokens).
- Rules come from config (JSON/YAML), optionally hot-reloaded.

**Non-functional**
- Hot path is O(1) or O(log n), allocation-free where possible: in-process checks cost about 1 µs, versus 0.3–1 ms for a Redis round trip.
- **Bounded memory** under key explosion (scanners send random API keys).
- **Deterministic tests**: no \`Date.now()\` buried in algorithms.
- **Correct under concurrency**: no double spending of a token.

**Out of scope (say it):** cross-pod accuracy. Keep a storage seam so a Redis/Lua store could replace the in-memory one later.

**HLD placement:** the library sits in each pod behind a guard/middleware. The guard maps the decision to \`429\` + \`Retry-After\` and \`RateLimit-*\` headers. The domain classes never touch HTTP.`,
      diagram: `  request
     |
     v
 +------------------+   ctx {ip, apiKey, route, weight}
 | RateLimitGuard   |------------------------------+
 | (NestJS adapter) |                              v
 +------------------+                     +-----------------+
     ^   429 + Retry-After                | RateLimiter     |
     |   RateLimit-Remaining              |  rules[] -------+--> keyOf(ctx)
     +------------------------------------|  store          |    algorithm
                Decision                  |  clock          |
                                          +-----------------+
                                          in-process, per pod`,
      keyPoints: [
        'Scope the library first; distributed limiting is a storage swap, not a redesign.',
        'Several rules per request, and all must pass, is the requirement that shapes the API.',
        'Clock and storage are injected: testability and the Redis seam come from the same decision.',
      ],
    },
    {
      heading: 'Rate limiter (2/3) — entities, class diagram and the patterns that earn their place',
      body: `**Entities.** \`RateLimiter\` (facade), \`Rule\` (id, key extractor, algorithm, cost), \`RateLimitAlgorithm<S>\` (Strategy), per-key state \`S\`, \`BoundedStore\` (keyed state with eviction), \`Clock\`, \`Decision\` (value object), \`AlgorithmRegistry\` (config name → factory), \`RateLimitGuard\` (adapter).

**Key design decision: the algorithm object is stateless, and state lives per key.** A naive design creates \`new TokenBucket(capacity, rate)\` per API key, so 2M keys mean 2M objects that each carry config. Here one \`TokenBucket\` instance per *rule* is shared by every key (Flyweight). The per-key state is \`{ tokens, last }\`: two numbers. The same split makes the state serializable, which a future Redis store needs.

**Two-phase contract: evaluate, then consume.** With several rules, "try-acquire each rule in turn" charges rule A even when rule B rejects. A client that is throttled per-IP then also burns its per-key quota. \`evaluate()\` refreshes and decides without charging; \`consume()\` runs only when every rule allowed.

| Pattern | Where | Why it is here |
|---|---|---|
| Strategy | \`RateLimitAlgorithm\` | Swap token bucket / sliding log / fixed window per rule |
| Factory / Registry | \`AlgorithmRegistry.register('gcra', params => …)\` | Config-driven creation; new algorithm = new class + one registration (open/closed) |
| Flyweight | algorithm shared, state per key | Memory: about 100–200 B per key instead of an object graph |
| Facade | \`RateLimiter.check()\` | Callers see one method, not stores and rules |
| Dependency injection | \`Clock\` | Fake time in tests; monotonic time in prod |
| Decorator | \`ShadowLimiter\`, \`MetricsLimiter\` | Dry-run new limits (log, never block) and emit metrics without touching the core |
| Adapter | \`RateLimitGuard\` | HTTP mapping stays out of the domain |

Note that \`TokenBucket.evaluate\` clamps \`elapsed\` at 0: wall clocks jump backwards under NTP, and a negative refill would *remove* tokens.`,
      diagram: `                 +----------------------+        +---------------------+
                 |     RateLimiter      |<>----->|  BoundedStore<S>    |
                 | check(req): Decision |        | getOrCreate(k, mk)  |
                 | sweepIdle(): number  |        | sweep(isIdle)       |
                 +----+------------+----+        | LRU via Map order   |
                      |<>          :             +---------------------+
                      v            :..> <<interface>> Clock
              +---------------+          ^ MonotonicClock  ^ FakeClock
              |     Rule      |
              | id            |      <<interface>> RateLimitAlgorithm<S>
              | keyOf(req)    |----> create(now): S
              | cost(req)     |      evaluate(s, now, cost): Decision
              +---------------+      consume(s, now, cost) / isIdle(s, now)
                                        ^             ^              ^
                                   TokenBucket  SlidingWindowLog  FixedWindow
  AlgorithmRegistry ..> RateLimitAlgorithm   (name -> factory(params))
  ShadowLimiter / MetricsLimiter --^ decorate RateLimiter`,
      code: [
        {
          language: 'typescript',
          title: 'Clock, the Strategy contract, token bucket and sliding log',
          code: `export interface Clock { now(): number } // milliseconds, must be monotonic
export const monotonicClock: Clock = { now: () => performance.now() };
export class FakeClock implements Clock {
  constructor(private t = 0) {}
  now(): number { return this.t; }
  advance(ms: number): void { this.t += ms; }
}

export interface Decision { allowed: boolean; remaining: number; retryAfterMs: number }

// Strategy: one class per algorithm. State is opaque to the limiter.
export interface RateLimitAlgorithm<S> {
  readonly name: string;
  create(now: number): S;
  evaluate(s: S, now: number, cost: number): Decision; // may refresh state, never consumes
  consume(s: S, now: number, cost: number): void;      // called only if every rule allowed
  isIdle(s: S, now: number): boolean;                  // true => dropping s changes nothing
}

interface Bucket { tokens: number; last: number }
export class TokenBucket implements RateLimitAlgorithm<Bucket> {
  readonly name = 'token-bucket';
  constructor(private readonly capacity: number, private readonly perSec: number) {
    if (capacity <= 0 || perSec <= 0) throw new RangeError('capacity and rate must be > 0');
  }
  create(now: number): Bucket { return { tokens: this.capacity, last: now }; }
  evaluate(b: Bucket, now: number, cost: number): Decision {
    const elapsed = Math.max(0, now - b.last);          // never refill negatively
    b.tokens = Math.min(this.capacity, b.tokens + (elapsed * this.perSec) / 1000);
    b.last = Math.max(b.last, now);
    if (cost > this.capacity) return { allowed: false, remaining: 0, retryAfterMs: Infinity };
    if (b.tokens >= cost) return { allowed: true, remaining: Math.floor(b.tokens - cost), retryAfterMs: 0 };
    const wait = Math.ceil(((cost - b.tokens) * 1000) / this.perSec);
    return { allowed: false, remaining: Math.floor(b.tokens), retryAfterMs: wait };
  }
  consume(b: Bucket, _now: number, cost: number): void { b.tokens -= cost; }
  isIdle(b: Bucket, now: number): boolean {
    return b.tokens + ((now - b.last) * this.perSec) / 1000 >= this.capacity;
  }
}

interface Log { ts: number[] }
export class SlidingWindowLog implements RateLimitAlgorithm<Log> {
  readonly name = 'sliding-log';
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  create(): Log { return { ts: [] }; }
  evaluate(l: Log, now: number, cost: number): Decision {
    let drop = 0;
    while (drop < l.ts.length && l.ts[drop] <= now - this.windowMs) drop++;
    if (drop) l.ts.splice(0, drop);                     // prune expired entries
    if (cost > this.limit) return { allowed: false, remaining: 0, retryAfterMs: Infinity };
    const free = this.limit - l.ts.length;
    if (free >= cost) return { allowed: true, remaining: free - cost, retryAfterMs: 0 };
    const unblockAt = l.ts[cost - free - 1] + this.windowMs; // when enough entries expire
    return { allowed: false, remaining: free, retryAfterMs: unblockAt - now };
  }
  consume(l: Log, now: number, cost: number): void { for (let i = 0; i < cost; i++) l.ts.push(now); }
  isIdle(l: Log, now: number): boolean {
    return l.ts.length === 0 || l.ts[l.ts.length - 1] <= now - this.windowMs;
  }
}`,
        },
      ],
      keyPoints: [
        'Stateless algorithm + per-key state = Flyweight: memory and serializability in one move.',
        'evaluate/consume split prevents partial charging across rules.',
        'Clamp negative elapsed time; prefer a monotonic clock (performance.now) for intervals.',
      ],
      source: 'Gamma et al. — Design Patterns (Strategy, Flyweight, Decorator)',
    },
    {
      heading: 'Rate limiter (3/3) — the facade, memory bounds, concurrency, extensions and the 90-minute cut',
      body: `**The facade** loops rules, builds a store key \`ruleId|key\`, evaluates every rule, and consumes only if all pass. It is deliberately **synchronous**.

**Concurrency, the Node way.** One event loop means a synchronous \`check()\` is atomic: no other request can run between \`evaluate\` and \`consume\`. The moment you insert an \`await\` (for example, an async store), two requests can both read "1 token left" and both pass. At that point, move check-and-consume into one atomic step (a Redis Lua script, or a per-key promise chain).
- **worker_threads / cluster / N pods:** each has its own Map, so the effective limit is N × limit. Fixes: route a key to one owner (consistent hash), use a \`SharedArrayBuffer\` with \`Atomics.compareExchange\` on fixed slots, or use a central store.
- **Java (what interviewers expect):** \`ConcurrentHashMap.compute(key, (k, s) -> …)\` runs atomically per key. Or keep a bucket object and guard it with \`synchronized\` / a \`ReentrantLock\`, or pack \`(tokens, last)\` into one \`AtomicLong\` and CAS. Avoid one global lock: it serializes every request in the JVM.

**Memory bounds.** \`BoundedStore\` is an LRU on top of \`Map\` insertion order (delete + re-set = touch). A periodic \`sweepIdle()\` removes states whose algorithm says they are idle. For a token bucket, idle means "it would be full by now", so dropping it is **lossless**. LRU eviction of a *busy* key is lossy: the attacker gets a fresh bucket. Count evictions and alert on them. Pre-auth rules keyed on unauthenticated input (random API keys) should key on IP or on "invalid-key" buckets, not on the attacker-chosen string.

**Extensibility follow-ups:**
- *Add GCRA / fixed window:* new class + \`registry.register\`. No core edits.
- *Per-tenant overrides:* rules carry a \`match()\` and a priority; the first matching override replaces the default rule for that dimension.
- *Shadow mode:* a decorator that evaluates but always returns \`allowed: true\` and logs would-be denials.
- *Distributed:* keep \`S\` serializable; a \`RedisStore\` runs evaluate + consume in one Lua script per rule set.

**90-minute version:** build \`TokenBucket\`, \`SlidingWindowLog\`, \`Rule\`, \`RateLimiter\`, \`FakeClock\`, plus a driver showing burst → deny → refill → allow and the multi-rule no-partial-charge case. Stub hot reload and Redis. Evaluators look for: no \`Date.now()\` inside algorithms, a correct \`retryAfter\`, no shared mutable config, and bounded memory at least discussed.`,
      code: [
        {
          language: 'typescript',
          title: 'Rules, LRU-bounded state and the synchronous facade',
          code: `export interface RequestCtx { ip: string; apiKey?: string; route: string; weight?: number }
export interface Rule {
  id: string;
  keyOf(req: RequestCtx): string | null;  // null => rule does not apply
  algorithm: RateLimitAlgorithm<any>;
  cost?(req: RequestCtx): number;
}

// LRU-bounded map: Map keeps insertion order, so re-inserting on access = "touch".
export class BoundedStore<S> {
  private readonly map = new Map<string, S>();
  evictions = 0;
  constructor(private readonly maxKeys: number) {}
  getOrCreate(key: string, make: () => S): S {
    let s = this.map.get(key);
    if (s !== undefined) { this.map.delete(key); this.map.set(key, s); return s; }
    if (this.map.size >= this.maxKeys) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
      this.evictions++;                     // alert on this: evicting busy keys = fail-open
    }
    s = make();
    this.map.set(key, s);
    return s;
  }
  sweep(isIdle: (key: string, s: S) => boolean): number {
    let n = 0;
    for (const [k, s] of this.map) if (isIdle(k, s)) { this.map.delete(k); n++; }
    return n;
  }
  get size(): number { return this.map.size; }
}

export class RateLimiter {
  private readonly store: BoundedStore<unknown>;
  private readonly byId: Map<string, Rule>;
  constructor(private readonly rules: Rule[], private readonly clock: Clock, maxKeys = 1_000_000) {
    this.store = new BoundedStore(maxKeys);
    this.byId = new Map(rules.map((r) => [r.id, r]));
  }
  // Synchronous on purpose: no await between evaluate and consume => atomic on the event loop.
  check(req: RequestCtx): Decision {
    const now = this.clock.now();
    const passed: { rule: Rule; state: unknown; cost: number; d: Decision }[] = [];
    for (const rule of this.rules) {
      const key = rule.keyOf(req);
      if (key === null) continue;
      const state = this.store.getOrCreate(rule.id + '|' + key, () => rule.algorithm.create(now));
      const cost = rule.cost?.(req) ?? 1;
      const d = rule.algorithm.evaluate(state, now, cost);
      if (!d.allowed) return d;               // nothing consumed yet: no partial charge
      passed.push({ rule, state, cost, d });
    }
    for (const p of passed) p.rule.algorithm.consume(p.state, now, p.cost);
    const remaining = passed.length ? Math.min(...passed.map((p) => p.d.remaining)) : Infinity;
    return { allowed: true, remaining, retryAfterMs: 0 };
  }
  sweepIdle(): number {
    const now = this.clock.now();
    return this.store.sweep((k, s) => this.byId.get(k.slice(0, k.indexOf('|')))!.algorithm.isIdle(s, now));
  }
}`,
        },
      ],
      keyPoints: [
        'No await between read and write = atomic in Node; add one and you need Lua or CAS.',
        'N workers with private maps = N × the limit.',
        'Idle eviction is lossless for token buckets; LRU eviction of hot keys is a silent fail-open.',
      ],
    },
    {
      heading: 'In-memory pub/sub (1/3) — requirements and HLD of a Kafka-lite',
      body: `**Intuition:** a shared notebook (the log) that producers append to. Each team (consumer group) keeps a bookmark (offset) of how far it has read, and team members split the notebook's chapters (partitions) between them.

This exact prompt appears in reports from Razorpay (pub/sub with offsets), Flipkart (90-minute message streaming MVP with partitions and ordering) and PhonePe (custom queue, regex subscribers, retries). Clarify which flavour you are building.

| Clarifying question | Why it changes the design |
|---|---|
| Fan-out to every subscriber, or work-sharing within a group? | Consumer groups do both: every group gets every message; members of one group share it |
| Ordering needed? Per key or global? | Per-key ordering → key-hash partitioning + one consumer per partition |
| Delivery guarantee? | At-least-once → ack + redelivery + idempotent consumers |
| Push or pull? | Pull gives natural backpressure; push needs credits/in-flight limits |
| Replay from an offset? | Log retention instead of delete-on-consume |
| What if consumers are slow and memory fills? | Bounded partitions + an overflow policy |

**Functional:** create topic (N partitions); \`publish(topic, {key, payload, headers})\`; subscribe a consumer to a group; \`poll\` / \`ack\` / \`nack\`; retries with backoff; a dead-letter queue (DLQ); reset a group's offset (replay).

**Non-functional:** per-partition ordering, at-least-once, bounded memory, O(1) append and read, thread-safe API, and observability (lag = end offset − committed).

**Out of scope:** durability across process restarts (stub a \`LogStore\` interface), replication, cross-process clients.`,
      diagram: `  Producer --publish--> Topic "orders" (Partitioner: hash(key) % 3)
                         +------------------------------------+
                         | P0: [0][1][2][3][4]                |
                         | P1: [0][1][2]                      |
                         | P2: [0][1][2][3]                   |
                         +-----------+-------------+----------+
                                     |             |
            group "billing"          |             |   group "audit"
       cursor per partition:         |             |   (own cursors)
       committed / next / inflight   v             v
         c1 <- P0, P2          c2 <- P1          a1 <- P0, P1, P2
                                     |
                 nack x maxAttempts  v
                         Topic "orders.dlq"`,
      keyPoints: [
        'Groups give both fan-out (across groups) and work-sharing (within a group).',
        'Per-key ordering comes from partitioning by key, not from a global lock.',
        'Lag = endOffset − committed is the one metric to expose.',
      ],
      source: 'LeetCode Discuss — Razorpay SSE, Flipkart SDE 3 and PhonePe machine-coding reports',
    },
    {
      heading: 'In-memory pub/sub (2/3) — entities, class diagram and patterns',
      body: `**Entities.** \`Topic\` (name, partitions, partitioner), \`Partition\` (append-only array + \`base\` offset so retention can drop a prefix), \`Message\` / \`Stored\` (value objects with partition + offset), \`Partitioner\` (Strategy), \`ConsumerGroup\` (members, assignment, one \`Cursor\` per partition), \`Cursor\` {\`committed\`, \`next\`, \`inflight\`, \`acked\`}, \`RetryPolicy\` (Strategy), DLQ (just another \`Topic\`), \`OverflowPolicy\` (Strategy: reject / block / drop-oldest).

**Why a log + cursors instead of a queue per subscriber?** A queue per subscriber copies each message N times and loses replay. A shared log with per-group cursors stores it once, makes replay a cursor reset, and gives lag for free. A message is freed only when *every* group has committed past it: \`Topic.compact()\` truncates below the minimum committed offset.

**Why pull, not Observer push?** A push design that calls \`subscriber.onMessage()\` inside \`publish()\` couples the producer's latency to the slowest subscriber, and a throwing subscriber can break the publisher. Pull lets each consumer ask for at most what it can handle. If the interviewer insists on push, add a per-subscriber dispatcher with a credit counter (\`maxInFlight\`); that is the same backpressure moved to the broker side.

| Pattern | Where | Why |
|---|---|---|
| Strategy | \`Partitioner\`, \`RetryPolicy\`, \`OverflowPolicy\`, assignment | Each varies independently by requirement |
| Observer (bounded) | optional push dispatcher / lag listeners | Decouple metrics and alerts from the core |
| Value object | \`Stored\` with (partition, offset) | Natural idempotency key for consumers |
| Template / state machine | an in-flight message: delivered → acked / retry-wait / dead-lettered | Makes the at-least-once rules explicit |

**The commit rule.** Acks arrive out of order (offset 7 acked before 5). Committing "the highest acked" would skip 5 if we crashed. Commit only the **contiguous prefix**: keep a set of acked offsets above \`committed\`, and advance while the next one is present.`,
      diagram: `  +-------------------+ 1   * +------------------+
  |      Topic        |<>---->|    Partition     |
  | publish(msg)      |       | append / read    |
  | compact()         |       | truncateBefore() |
  +----+---------+----+       | base, log[]      |
       |         :            +------------------+
       |<>       :..> <<interface>> Partitioner   ^ KeyHash  ^ RoundRobin
       v
  +---------------------+ 1  * +-------------------------------+
  |   ConsumerGroup     |<>--->| Cursor { committed, next,     |
  | join / leave        |      |   inflight<offset,InFlight>,  |
  | poll(c, max)        |      |   acked<offset> }             |
  | ack / nack          |      +-------------------------------+
  +----+---------+------+
       :         :..> <<interface>> RetryPolicy   ^ ExpBackoff ^ Fixed
       :..> Topic (DLQ)            InFlight: msg, attempts, dueAt, owner`,
      code: [
        {
          language: 'typescript',
          title: 'Topic, partitions with a base offset, key-hash partitioner',
          code: `export interface Clock { now(): number }

export interface Message<T> { key?: string; payload: T; headers: Record<string, string> }
export interface Stored<T> extends Message<T> { partition: number; offset: number; ts: number }

export interface Partitioner { pick(key: string | undefined, partitions: number): number }
export class KeyHashPartitioner implements Partitioner {
  private rr = 0;
  pick(key: string | undefined, n: number): number {
    if (key === undefined) return this.rr++ % n;          // no key => spread load
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return Math.abs(h) % n;                               // same key => same partition => ordered
  }
}

export class TopicFullError extends Error {}

export class Partition<T> {
  private log: Stored<T>[] = [];
  private base = 0;                                       // offset of log[0]
  constructor(readonly id: number, private readonly maxMessages: number) {}
  get startOffset(): number { return this.base; }
  get endOffset(): number { return this.base + this.log.length; }
  append(m: Message<T>, now: number): Stored<T> {
    if (this.log.length >= this.maxMessages) throw new TopicFullError('partition ' + this.id + ' full');
    const s: Stored<T> = { ...m, partition: this.id, offset: this.endOffset, ts: now };
    this.log.push(s);
    return s;
  }
  read(from: number): Stored<T> | undefined { return this.log[from - this.base]; }
  truncateBefore(offset: number): void {                  // retention: only below every group's commit
    const n = Math.min(Math.max(0, offset - this.base), this.log.length);
    this.log.splice(0, n);
    this.base += n;
  }
}

export class Topic<T> {
  readonly partitions: Partition<T>[];
  private readonly groups = new Set<{ committedOf(p: number): number }>();
  constructor(readonly name: string, n: number, private readonly partitioner: Partitioner,
              private readonly clock: Clock, maxPerPartition = 100_000) {
    this.partitions = Array.from({ length: n }, (_, i) => new Partition<T>(i, maxPerPartition));
  }
  publish(m: Message<T>): Stored<T> {                     // throws TopicFullError = backpressure
    const p = this.partitioner.pick(m.key, this.partitions.length);
    return this.partitions[p].append(m, this.clock.now());
  }
  register(g: { committedOf(p: number): number }): void { this.groups.add(g); }
  compact(): void {                                       // free what every group has committed
    for (const p of this.partitions) {
      let min = p.endOffset;
      for (const g of this.groups) min = Math.min(min, g.committedOf(p.id));
      p.truncateBefore(min);
    }
  }
}`,
        },
      ],
      keyPoints: [
        'One log, many cursors: storage once, replay = reset, lag for free.',
        'Commit the contiguous acked prefix only.',
        'Retention truncates below the slowest group, so a stuck group is a memory problem: alert on lag.',
      ],
      source: 'Apache Kafka documentation — consumer groups and offset commits',
    },
    {
      heading: 'In-memory pub/sub (3/3) — at-least-once, retries, DLQ, backpressure, concurrency',
      body: `**How a message moves.** \`poll\` first redelivers in-flight messages whose \`dueAt\` has passed (ack timeout expired, or retry backoff elapsed). It then hands out fresh messages while \`inflight.size < maxInFlightPerPartition\`. \`nack\` either schedules a retry (\`dueAt = now + backoff\`) or, at \`maxAttempts\`, publishes to the DLQ with origin, error and attempt headers and then acks. A consumer that crashes without acking is covered by the ack timeout, the same path as a retry.

**Ordering vs retries.** With \`maxInFlightPerPartition = 2\`, offset 6 can complete while 5 waits in backoff, so per-key order is broken. If the business needs strict per-key order (ledger events), set it to 1: a failing message then blocks its partition until it succeeds or is dead-lettered (head-of-line blocking, by design). The other option is to park the failed key in a retry topic and pause only that key.

**Backpressure, three layers:**
1. **Producer:** a bounded partition throws \`TopicFullError\`. An \`OverflowPolicy\` Strategy could instead block (return a promise that resolves when space frees) or drop the oldest (telemetry).
2. **Consumer:** credit via \`maxInFlight\`; pull never hands out more than the consumer can ack.
3. **Retention:** \`compact()\` frees only what every group has committed, so one dead group pins memory. Detect it (lag alert) and either evict the group or cap retention by size and let that group skip ahead.

**Concurrency.** In Node all of this is synchronous, so each method is atomic on the event loop; handlers run async *between* \`poll\` and \`ack\`, which is exactly why acks must be idempotent (a stale ack after redelivery is a no-op). In Java: one \`ReentrantLock\` per partition cursor (not one per broker), \`ConcurrentHashMap\` for topics, and \`Condition.await\` / \`BlockingQueue\` semantics for a blocking publish. **Rebalance:** when a member leaves, its in-flight messages get \`dueAt = 0\` so the new owner gets them on the next poll. That is a duplicate if the old consumer actually finished, which is acceptable under at-least-once. Consumers dedupe on \`(topic, partition, offset)\` or a business id.

**Extensibility:** regex/wildcard subscriptions (a group subscribes to a \`TopicMatcher\`), filters, delayed messages (a scheduler that publishes at \`deliverAt\`), exactly-once processing (idempotent consumer + dedupe store), and durability (a \`LogStore\` interface with an append-only file).

**90-minute version:** \`Topic\`, \`Partition\`, \`KeyHashPartitioner\`, \`ConsumerGroup\` with poll/ack/nack, \`ExpBackoff\`, DLQ, and a driver showing ordering, a poison message reaching the DLQ, and two groups reading independently. Stub rebalancing beyond round-robin, persistence and push.`,
      code: [
        {
          language: 'typescript',
          title: 'ConsumerGroup: poll / ack / nack, contiguous commits, retry and DLQ',
          code: `export interface RetryPolicy { maxAttempts: number; delayMs(attempt: number): number }
export const expBackoff = (max: number, baseMs: number, capMs: number): RetryPolicy => ({
  maxAttempts: max,
  delayMs: (a) => Math.min(capMs, baseMs * 2 ** (a - 1)),
});

interface InFlight<T> { msg: Stored<T>; attempts: number; dueAt: number; owner: string }
interface Cursor<T> { committed: number; next: number; inflight: Map<number, InFlight<T>>; acked: Set<number> }
export interface Delivery<T> { msg: Stored<T>; attempt: number }
export interface GroupOptions { ackTimeoutMs: number; maxInFlightPerPartition: number; retry: RetryPolicy }

export class ConsumerGroup<T> {
  private readonly cursors: Cursor<T>[];
  private members: string[] = [];
  constructor(readonly id: string, private readonly topic: Topic<T>, private readonly dlq: Topic<T>,
              private readonly opts: GroupOptions, private readonly clock: Clock) {
    this.cursors = topic.partitions.map((p) =>             // new group starts at 'earliest'
      ({ committed: p.startOffset, next: p.startOffset, inflight: new Map(), acked: new Set() }));
    topic.register(this);
  }
  committedOf(p: number): number { return this.cursors[p].committed; }
  join(consumerId: string): void { if (!this.members.includes(consumerId)) this.members.push(consumerId); }
  leave(consumerId: string): void {
    this.members = this.members.filter((m) => m !== consumerId);
    for (const c of this.cursors)                          // hand its unacked work to the next owner
      for (const f of c.inflight.values()) if (f.owner === consumerId) f.dueAt = 0;
  }
  private owns(consumerId: string, p: number): boolean {  // range-free round-robin assignment
    return this.members.length > 0 && this.members[p % this.members.length] === consumerId;
  }
  poll(consumerId: string, max: number): Delivery<T>[] {
    const now = this.clock.now();
    const out: Delivery<T>[] = [];
    this.cursors.forEach((c, p) => {
      if (!this.owns(consumerId, p)) return;
      for (const f of c.inflight.values()) {               // 1) redeliver: ack timeout or retry due
        if (out.length >= max) return;
        if (f.dueAt > now) continue;
        if (f.attempts >= this.opts.retry.maxAttempts) { this.deadLetter(p, f, 'ack-timeout'); continue; }
        f.attempts++; f.owner = consumerId; f.dueAt = now + this.opts.ackTimeoutMs;
        out.push({ msg: f.msg, attempt: f.attempts });
      }
      while (out.length < max && c.inflight.size < this.opts.maxInFlightPerPartition) { // 2) fresh
        const msg = this.topic.partitions[p].read(c.next);
        if (!msg) break;
        c.next++;
        c.inflight.set(msg.offset, { msg, attempts: 1, dueAt: now + this.opts.ackTimeoutMs, owner: consumerId });
        out.push({ msg, attempt: 1 });
      }
    });
    return out;
  }
  ack(p: number, offset: number): void {
    const c = this.cursors[p];
    if (!c.inflight.delete(offset)) return;               // duplicate / stale ack: idempotent no-op
    c.acked.add(offset);
    while (c.acked.delete(c.committed)) c.committed++;     // commit only the contiguous prefix
  }
  nack(p: number, offset: number, error: string): void {
    const f = this.cursors[p].inflight.get(offset);
    if (!f) return;
    if (f.attempts >= this.opts.retry.maxAttempts) this.deadLetter(p, f, error);
    else f.dueAt = this.clock.now() + this.opts.retry.delayMs(f.attempts); // redelivered by poll()
  }
  private deadLetter(p: number, f: InFlight<T>, reason: string): void {
    this.dlq.publish({ key: f.msg.key, payload: f.msg.payload, headers: { ...f.msg.headers,
      'x-origin': this.topic.name + '/' + p + '@' + f.msg.offset, 'x-error': reason,
      'x-attempts': String(f.attempts) } });
    this.ack(p, f.msg.offset);                            // the DLQ now owns it
  }
}`,
        },
      ],
      keyPoints: [
        'Ack timeout and retry backoff share one mechanism: dueAt on the in-flight record.',
        'maxInFlightPerPartition = 1 buys strict order at the cost of head-of-line blocking.',
        'Rebalance and redelivery create duplicates by design; consumers must be idempotent.',
      ],
    },
    {
      heading: 'Task scheduler (1/3) — requirements and HLD (one-off, cron, retries, restarts)',
      body: `**Intuition:** an alarm clock with a to-do list. You sort alarms by time, sleep until the earliest one, wake up, and hand the due ones to a fixed team of workers, most urgent first.

Reported versions: Uber (an in-memory library that runs a task at a time or at a fixed interval, with configurable worker threads), Flipkart (assign tasks to free worker threads, otherwise queue them), Microsoft 2026 (cron/Airflow-like with one-time and recurring tasks and thread safety). The distributed version (100M jobs/day, leader election) is the HLD case in Design Infra. Here we build the engine that runs inside one process.

**Functional**
- \`submit(spec)\` with a **schedule**: one-off at T, fixed rate every N ms, or cron (\`*/15 9-18 * * 1-5\`).
- **Priority** among tasks due at the same time; **bounded worker pool** (concurrency K).
- **Retries** with exponential backoff, per task.
- **Cancellation**: of a pending task, and cooperative cancellation of a running one.
- **Idempotency**: a resubmitted id is a no-op, and handlers get a stable \`runKey\` to dedupe side effects.
- **Missed runs after restart**: a configurable misfire policy.

**Non-functional:** about O(log n) per schedule/dispatch, one OS timer (not one per task: 1M \`setTimeout\` handles is a memory and GC hazard), no overlapping runs of the same recurring task, drift-free recurrence, and deterministic tests (inject clock and timer).

**HLD in one breath:** API → Scheduler core (due-heap + ready-heap + worker pool) → handlers. A \`TaskRepository\` persists specs and \`lastScheduledAt\` so a restart can resume. In a multi-pod deployment only a leader (or a DB row lock per job, \`SELECT … FOR UPDATE SKIP LOCKED\`) dispatches.`,
      diagram: `  submit/cancel                     +---------------------------+
  ------------->  Scheduler  ------>| due heap  (runAt, seq)    |
                     |   ^          +---------------------------+
          one timer  |   | re-arm to heap top     | tick(): pop due
          (setTimeout)   |                        v
                     v   |          +---------------------------+
                  tick() +--------->| ready heap (priority, seq)|
                                    +-------------+-------------+
                                                  | dispatch while
                                                  | active < K
                         +---------+---------+----v----+
                         | worker1 | worker2 | ...  K  |-- handler(ctx)
                         +---------+---------+---------+
                 settled -> next occurrence / retry -> back to due heap
                 TaskRepository: spec + lastScheduledAt (restart resume)`,
      keyPoints: [
        'One timer armed for the heap top, re-armed when an earlier task arrives.',
        'Two heaps: by time (when) and by priority (who goes first once due).',
        'Persist lastScheduledAt to make restarts and misfires deterministic.',
      ],
      source: 'LeetCode Discuss — Uber, Flipkart and Microsoft (2026) scheduler rounds',
    },
    {
      heading: 'Task scheduler (2/3) — entities, class diagram, patterns, the heap and schedules',
      body: `**Entities.** \`Scheduler\` (facade + loop), \`TaskSpec\` (id, schedule, handler, priority, retry, misfire), \`Task\` (runtime: \`version\`, \`cancelled\`, \`running: AbortController\`), \`Entry\` (one heap item = one occurrence or retry attempt), \`Schedule\` (Strategy: \`OneOff\`, \`FixedRate\`, \`Cron\`), \`RetryPolicy\` (Strategy), \`MinHeap<T>\`, \`Clock\` + \`Timer\` (ports for tests), \`TaskRepository\` (persistence port), \`RunCtx\` (what a handler sees).

**Why each pattern:**
- **Strategy for Schedule.** The scheduler only asks "next fire time strictly after t?". One-off, fixed rate, cron, "last business day of month" and timezone-aware cron are all new classes. The core never changes (open/closed).
- **Command for the task.** \`handler(ctx)\` is an encapsulated action plus metadata (priority, retry), so it can be queued, retried, logged and cancelled uniformly.
- **Strategy for RetryPolicy.** Exponential with jitter for HTTP calls; fixed for local work; none for non-idempotent work.
- **Observer** (\`onSettled\`) persists \`lastScheduledAt\`, emits metrics and alerts without coupling them to the loop.
- **Ports (hexagonal):** \`Clock\` and \`Timer\` make the scheduler testable in milliseconds with a fake timer; \`TaskRepository\` swaps in-memory for Postgres.

**Lazy deletion instead of heap removal.** Removing an arbitrary element from a binary heap is O(n) to find. Instead, each \`Task\` has a \`version\`; heap entries carry the version they were created with. Cancel or reschedule bumps the version, and stale entries are skipped when popped. The cost is memory held by stale entries until they surface; if cancellations are heavy, rebuild the heap when stale entries exceed 50%.

**FixedRate anchored to start.** \`next = start + (floor((t − start)/every) + 1) × every\` never drifts. "Previous run end + interval" drifts by the run duration every time.`,
      diagram: `   +-------------------------+       +----------------------+
   |       Scheduler         |<>---->| MinHeap<Entry> due   |
   | submit(spec) / cancel(id)|<>---->| MinHeap<Entry> ready |
   | tick() / dispatch()     |       +----------------------+
   +---+--------+--------+---+       Entry{runAt, priority, seq,
       |<>      :        :            taskId, version, attempt}
       v        :        :..> Clock, Timer   (ports, faked in tests)
   +--------+   :..> TaskRepository           (persistence port)
   |  Task  |-----> TaskSpec { id, handler(ctx) <<Command>>,
   | version|                  priority, misfire, lastScheduledAt }
   | running|          |              |
   +--------+          v              v
            <<interface>> Schedule   <<interface>> RetryPolicy
             ^OneOff ^FixedRate ^Cron   ^ExpBackoff ^Fixed ^None`,
      code: [
        {
          language: 'typescript',
          title: 'Generic min-heap and Schedule strategies (one-off, fixed rate, minimal UTC cron)',
          code: `export class MinHeap<T> {
  private a: T[] = [];
  constructor(private readonly less: (x: T, y: T) => boolean) {}
  get size(): number { return this.a.length; }
  peek(): T | undefined { return this.a[0]; }
  push(v: T): void {
    const a = this.a; a.push(v);
    for (let i = a.length - 1; i > 0; ) {                 // sift up
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]]; i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length && last !== undefined) {
      a[0] = last;
      for (let i = 0; ; ) {                               // sift down
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

// Strategy: "when is the next fire time strictly after t?" null => no more runs.
export interface Schedule { nextAfter(t: number): number | null }
export class OneOff implements Schedule {
  constructor(private readonly at: number) {}
  nextAfter(t: number): number | null { return t < this.at ? this.at : null; }
}
export class FixedRate implements Schedule {               // anchored to start => no drift
  constructor(private readonly start: number, private readonly everyMs: number) {}
  nextAfter(t: number): number {
    if (t < this.start) return this.start;
    return this.start + (Math.floor((t - this.start) / this.everyMs) + 1) * this.everyMs;
  }
}
// Minimal UTC cron: "min hour dom month dow", supports *, n, a,b and */n.
export class Cron implements Schedule {
  private readonly f: Set<number>[];
  constructor(expr: string) {
    const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
    const parts = expr.trim().split(/\\s+/);
    if (parts.length !== 5) throw new Error('cron needs 5 fields');
    this.f = parts.map((p, i) => Cron.field(p, ranges[i][0], ranges[i][1]));
  }
  private static field(p: string, lo: number, hi: number): Set<number> {
    const out = new Set<number>();
    for (const tok of p.split(',')) {
      const [base, step] = tok.split('/');
      const s = step ? Number(step) : 1;
      const [a, b] = base === '*' ? [lo, hi] : [Number(base), step ? hi : Number(base)];
      if (!(a >= lo && b <= hi && s > 0)) throw new Error('bad cron field ' + p);
      for (let v = a; v <= b; v += s) out.add(v);
    }
    return out;
  }
  nextAfter(t: number): number | null {
    const d = new Date(Math.floor(t / 60_000) * 60_000 + 60_000); // next whole minute
    for (let guard = 0; guard < 366 * 24 * 60; guard++) {
      const [mi, h, dom, mo, dow] = this.f;
      if (!mo.has(d.getUTCMonth() + 1) || !dom.has(d.getUTCDate()) || !dow.has(d.getUTCDay())) {
        d.setUTCHours(24, 0, 0, 0); continue;               // skip the whole day
      }
      if (!h.has(d.getUTCHours())) { d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0); continue; }
      if (mi.has(d.getUTCMinutes())) return d.getTime();
      d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
    }
    return null;
  }
}`,
        },
      ],
      keyPoints: [
        'Schedule.nextAfter(t) is the only question the core asks: every recurrence type is a new class.',
        'Lazy deletion via version numbers keeps cancel at O(1).',
        'Anchor fixed-rate schedules to the start time to avoid drift.',
      ],
      source: 'Gamma et al. — Design Patterns (Command, Strategy, Observer)',
    },
    {
      heading: 'Task scheduler (3/3) — the core loop, retries, cancellation, misfires, concurrency',
      body: `**The loop.** \`tick()\` pops every due entry. Stale ones (wrong version, cancelled) are dropped, a misfire policy is applied to late ones, and the rest are pushed to the ready heap. \`dispatch()\` starts runs while \`active < workers\`, and each settled run calls \`dispatch()\` again, so the pool never idles while work is ready.

**No overlap, by construction.** Occurrence N+1 of a recurring task is enqueued only when N settles (\`scheduleNext\` in \`finally\` paths). If a run takes 90 s on a 60 s schedule, the next one starts right after, inside the grace window, instead of running in parallel. If you *want* parallel occurrences, that is an explicit \`concurrencyPolicy: 'allow'\` (Kubernetes CronJob has the same knob: Allow / Forbid / Replace).

**Retries.** A failed attempt is re-enqueued at \`now + delay(attempt)\` with the **same \`scheduledAt\`**, so \`runKey = id@scheduledAt\` is stable across attempts. The handler can use it as an idempotency key (\`INSERT … ON CONFLICT DO NOTHING\`, or a provider idempotency header). After \`maxAttempts\` the occurrence is marked failed (\`onSettled(…, false)\` → alert / DLQ table) and the *next* occurrence is still scheduled.

**Cancellation.** Pending runs: \`version++\` makes heap entries stale. A running attempt: \`AbortController.abort()\`. That is cooperative: the handler must pass \`signal\` to \`fetch\`, \`pg\` query cancel, or check it between batches. Node cannot kill a running async function; worker_threads \`terminate()\` can kill CPU-bound work, at the cost of losing state.

**Missed runs after restart.** On boot, tasks come back from the repository with \`lastScheduledAt\`. \`nextAfter(lastScheduledAt)\` yields occurrences in the past, and the misfire policy decides: **fire-once** (coalesce all missed runs into one late run, then resume; right for "sync" jobs) or **skip** (jump to the next future slot; right for "send the 9 am digest"). A **fire-all** catch-up is rarely right; cap it if offered. These map to Quartz's \`MISFIRE_INSTRUCTION_FIRE_ONCE_NOW\` and \`DO_NOTHING\`.

**Concurrency.** In Node the core is single-threaded: heap ops and counters run between awaits, so no locks are needed. CPU-heavy handlers belong in a worker_threads pool, or they block the timer. In Java: a \`PriorityBlockingQueue\` or a \`ReentrantLock\` + \`Condition\` that a dispatcher thread waits on with \`awaitNanos(untilTopDue)\` (signalled when an earlier task is submitted), a \`ThreadPoolExecutor\` with a bounded queue for workers, and \`Future.cancel(true)\` for interruption. \`ScheduledThreadPoolExecutor\` is the library answer; say why you are not using it (priority, retries, misfire).

**90-minute version:** \`MinHeap\`, \`OneOff\` + \`FixedRate\` (cron if time permits), \`Scheduler\` with K workers, retries, cancel, and a driver with a fake clock showing priority order, retry then success, cancel, and no overlap. Stub the repository and cron parsing beyond \`*\`, numbers and \`*/n\`.`,
      code: [
        {
          language: 'typescript',
          title: 'Scheduler: one timer, two heaps, bounded workers, retries, cancel and misfire',
          code: `export interface Clock { now(): number }
export interface Timer { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }
export interface RetryPolicy { maxAttempts: number; delayMs(attempt: number): number }
export type Misfire = 'fire-once' | 'skip';
export interface RunCtx { taskId: string; runKey: string; scheduledAt: number; attempt: number; signal: AbortSignal }
export interface TaskSpec {
  id: string;                                              // idempotency key for submit()
  schedule: Schedule;
  handler: (ctx: RunCtx) => Promise<void>;
  priority?: number;                                       // lower = more urgent
  retry?: RetryPolicy;
  misfire?: Misfire;
  lastScheduledAt?: number;                                // persisted; resumes after a restart
}
interface Task { spec: TaskSpec; version: number; cancelled: boolean; running?: AbortController }
interface Entry { runAt: number; priority: number; seq: number; taskId: string; version: number;
                  scheduledAt: number; attempt: number }

export class Scheduler {
  private readonly tasks = new Map<string, Task>();
  private readonly due = new MinHeap<Entry>((a, b) => a.runAt < b.runAt || (a.runAt === b.runAt && a.seq < b.seq));
  private readonly ready = new MinHeap<Entry>((a, b) => a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq));
  private seq = 0; private active = 0; private timer: unknown; private armedFor = Infinity;
  constructor(private readonly clock: Clock, private readonly timers: Timer, private readonly workers = 4,
              private readonly misfireGraceMs = 60_000,
              private readonly onSettled?: (id: string, scheduledAt: number, ok: boolean) => void) {}

  submit(spec: TaskSpec): string {
    const prev = this.tasks.get(spec.id);
    if (prev && !prev.cancelled) return spec.id;           // idempotent submit
    // version continues from the cancelled incarnation, so its old heap entries stay stale
    const task: Task = { spec, version: (prev?.version ?? 0) + 1, cancelled: false };
    this.tasks.set(spec.id, task);
    const first = spec.schedule.nextAfter(spec.lastScheduledAt ?? this.clock.now() - 1);
    if (first !== null) this.enqueue(task, first, first, 1);
    return spec.id;
  }
  cancel(id: string): boolean {
    const t = this.tasks.get(id);
    if (!t || t.cancelled) return false;
    t.cancelled = true; t.version++;                       // heap entries become stale (lazy delete)
    t.running?.abort();                                    // cooperative: handler watches signal
    return true;
  }
  private enqueue(t: Task, runAt: number, scheduledAt: number, attempt: number): void {
    this.due.push({ runAt, priority: t.spec.priority ?? 5, seq: this.seq++, taskId: t.spec.id,
                    version: t.version, scheduledAt, attempt });
    if (runAt < this.armedFor) this.arm();                 // earlier than the armed timer => re-arm
  }
  private arm(): void {
    if (this.timer !== undefined) this.timers.clear(this.timer);
    const top = this.due.peek();
    this.armedFor = top ? top.runAt : Infinity;
    this.timer = top ? this.timers.set(() => this.tick(), Math.max(0, top.runAt - this.clock.now())) : undefined;
  }
  tick(): void {
    const now = this.clock.now();
    for (let e = this.due.peek(); e && e.runAt <= now; e = this.due.peek()) {
      this.due.pop();
      const t = this.tasks.get(e.taskId);
      if (!t || t.cancelled || e.version !== t.version) continue; // stale entry
      const late = now - e.runAt > this.misfireGraceMs;
      if (late && e.attempt === 1 && (t.spec.misfire ?? 'fire-once') === 'skip') { this.scheduleNext(t, now); continue; }
      this.ready.push(e);
    }
    this.dispatch();
    this.arm();
  }
  private dispatch(): void {
    while (this.active < this.workers && this.ready.size) {   // bounded worker pool
      const e = this.ready.pop()!;
      const t = this.tasks.get(e.taskId)!;
      if (t.cancelled || e.version !== t.version) continue;
      void this.run(t, e);
    }
  }
  private async run(t: Task, e: Entry): Promise<void> {
    this.active++;
    const ac = new AbortController(); t.running = ac;
    const runKey = t.spec.id + '@' + e.scheduledAt;        // same key across retries => dedupe downstream
    try {
      await t.spec.handler({ taskId: t.spec.id, runKey, scheduledAt: e.scheduledAt, attempt: e.attempt, signal: ac.signal });
      this.onSettled?.(t.spec.id, e.scheduledAt, true);   // persist lastScheduledAt here
      this.scheduleNext(t, e.scheduledAt);
    } catch {
      const r = t.spec.retry;
      if (!t.cancelled && r && e.attempt < r.maxAttempts) {
        this.enqueue(t, this.clock.now() + r.delayMs(e.attempt), e.scheduledAt, e.attempt + 1);
      } else { this.onSettled?.(t.spec.id, e.scheduledAt, false); this.scheduleNext(t, e.scheduledAt); }
    } finally {
      t.running = undefined; this.active--;
      this.dispatch();
    }
  }
  private scheduleNext(t: Task, after: number): void {
    if (t.cancelled) return;
    const next = t.spec.schedule.nextAfter(Math.max(after, this.clock.now() - this.misfireGraceMs));
    if (next !== null) this.enqueue(t, next, next, 1);
    else this.tasks.delete(t.spec.id);
  }
}`,
        },
      ],
      keyPoints: [
        'Same scheduledAt across retries → stable runKey → idempotent side effects.',
        'Abort is cooperative in Node: pass the signal down or it does nothing.',
        'Misfire policy is a business decision: coalesce (fire-once) vs skip.',
      ],
      source: 'Quartz Scheduler documentation — misfire instructions',
    },
    {
      heading: 'Snake & Ladder vs Chess (1/3) — which game gets asked, requirements and HLD',
      body: `**Which one to prepare.** In 2025–2026 machine-coding reports from Indian product companies (Flipkart, PhonePe, Meesho, Gameberry Labs), **Snake & Ladder** keeps coming up as the 90-minute build. Interviewers like it because it is small enough to finish, yet it exposes polymorphism (snakes, ladders, new obstacles), turn management, rule variants and testability (random dice). **Chess** appears more often as a 45-minute whiteboard OOD discussion (move generation, check validation) because a complete legal-move engine does not fit in 90 minutes. Build Snake & Ladder, and be ready for the *"now how would chess change your design?"* pivot (section 3/3).

**Functional requirements (write these at minute 2):**
- Board of N cells (default 100); snakes and ladders configured at start (input lines like \`99 10\`).
- 2+ players in fixed turn order; each turn rolls the dice (1 die by default, configurable count) and moves.
- Landing on a snake head / ladder foot moves you to its end.
- Rules (configurable): overshoot past N = stay (or bounce); a six gives an extra roll; three sixes in a row forfeit the turn and undo it.
- Game ends at the first winner, or continues until one player is left (ranks).
- Print moves: \`Alice rolled 4 and moved from 2 to 6\`.

**Non-functional:** deterministic demos and tests, validation of the board config (no snake pointing up, no two jumps on one cell, no chains or cycles), extensible obstacles and rules, and many concurrent games on one server if it goes online.

**HLD sketch (if online):** \`GameService\` holds games by id in memory (or Redis with a game-owner pod). WebSocket gateway → \`play(gameId, playerId, expectedTurn)\` → events broadcast to the room. For the machine-coding round it is a console driver.`,
      diagram: `   input/driver  ---> GameFactory (Builder: size, jumps, players, rules)
                               |
                               v
   +----------+  roll()  +------------+  jumpAt(cell)  +---------+
   |  Dice    |<---------|   Game     |--------------->|  Board  |
   | (inject) |          | queue of   |                | Map<int,|
   +----------+          | players    |                |  Jump>  |
                         | positions  |                +---------+
                         | rules      |--emit--> listeners (console,
                         +------------+           websocket, stats)`,
      keyPoints: [
        'Snake & Ladder is the 90-minute build; Chess is the follow-up discussion.',
        'Write rule variants down as configuration before coding.',
        'Validate the board at construction: fail fast, not mid-game.',
      ],
      source: 'LeetCode Discuss — Flipkart, PhonePe, Meesho and Gameberry Labs Snake & Ladder rounds',
    },
    {
      heading: 'Snake & Ladder (2/3) — entities, class diagram, polymorphism and patterns',
      body: `**Entities.** \`Game\` (turn manager + state), \`Board\` (size + jumps), \`Jump\` (abstract: \`from\`, \`to\`, \`isValid\`) with \`Snake\` and \`Ladder\`, \`Player\`, \`Dice\` (interface: \`RandomDice\`, \`ScriptedDice\`), \`Rules\` (value object of policies), \`GameEvent\` (a discriminated union), listeners.

**Why each choice:**
- **Polymorphic \`Jump\`, not \`if (cell is snake) … else if (ladder)\`.** The board stores \`Map<cell, Jump>\` and only asks for \`to\`. A new obstacle (e.g. a "crocodile" that sends you back 5, or a "mine" that skips your next turn) is a new subclass, and the board does not change. When behaviour differs beyond a destination, give \`Jump\` an \`apply(ctx)\` method; that is when Strategy and Template Method start to matter.
- **Dice as Strategy + dependency injection.** Two dice, a loaded test die and a seeded RNG are all swaps. \`ScriptedDice([4, 6, 2])\` makes the demo deterministic: the most practical thing you can do in the round.
- **Rules as configuration (Policy objects).** Overshoot and sixes vary by house rules. If rules multiply (bonus cells, power-ups), promote them to a \`MoveRule[]\` chain (Chain of Responsibility) that each transforms a \`MoveContext\`.
- **Turn order as a queue.** \`shift()\` the current player and \`push()\` it back; winners leave the queue. That beats \`index = (index + 1) % n\`, which breaks as soon as players are removed mid-game.
- **Observer for output.** \`Game\` emits events; the console printer, a WebSocket broadcaster and a stats collector subscribe. Keeping \`console.log\` out of \`Game\` is one of the first things reviewers check.
- **Builder / Factory** for setup from input lines, with validation centralized in \`Board\`.

**Board validation rules worth stating:** snakes go down and ladders go up; nothing starts on cell 1 or N; one jump per cell; no jump ends on another jump's start (prevents chains and snake/ladder cycles that could loop forever).`,
      diagram: `   +------------------+ 1    1 +-----------------------+
   |      Game        |<>------>|        Board          |
   | play(id, turn)   |         | size                  |
   | current, isOver  |         | jumpAt(cell): Jump?   |
   | on(listener)     |         +-----------+-----------+
   +--+-----+------+--+                     |<> 0..*
      |     |      :                        v
      |<>   |<>    :..> <<interface>> Dice  +-----------------+
      v     v           ^RandomDice         | <<abstract>>    |
  Player[]  Rules       ^ScriptedDice       | Jump from, to   |
  (queue)  {overshoot,                      | isValid()       |
            sixes,                          +-----------------+
            playUntil}                        ^      ^       ^
                                            Snake  Ladder  Crocodile
   listeners: ConsolePrinter, WsBroadcaster, Stats  (Observer)`,
      code: [
        {
          language: 'typescript',
          title: 'Dice strategy, polymorphic jumps and a self-validating board',
          code: `export interface Dice { roll(): number }
export class RandomDice implements Dice {
  constructor(private readonly count = 1, private readonly faces = 6, private readonly rng: () => number = Math.random) {}
  roll(): number {
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += 1 + Math.floor(this.rng() * this.faces);
    return sum;
  }
}
export class ScriptedDice implements Dice {                // deterministic demos and tests
  private i = 0;
  constructor(private readonly values: number[]) {}
  roll(): number { return this.values[this.i++ % this.values.length]; }
}

export abstract class Jump {                                // Snake, Ladder, ... share one contract
  constructor(readonly from: number, readonly to: number) {}
  abstract readonly kind: string;
  abstract isValid(): boolean;
}
export class Snake extends Jump { readonly kind = 'snake'; isValid() { return this.to < this.from; } }
export class Ladder extends Jump { readonly kind = 'ladder'; isValid() { return this.to > this.from; } }

export class Board {
  private readonly jumps = new Map<number, Jump>();
  constructor(readonly size: number, jumps: Jump[]) {
    for (const j of jumps) {
      if (!j.isValid()) throw new Error(j.kind + ' ' + j.from + '->' + j.to + ' points the wrong way');
      if (j.from <= 1 || j.from >= size || j.to < 1 || j.to > size) throw new Error('jump out of range at ' + j.from);
      if (this.jumps.has(j.from)) throw new Error('two jumps start at ' + j.from);
      this.jumps.set(j.from, j);
    }
    for (const j of jumps) if (this.jumps.has(j.to)) throw new Error('chained jump at ' + j.to); // no cycles
  }
  jumpAt(cell: number): Jump | undefined { return this.jumps.get(cell); }
}`,
        },
      ],
      keyPoints: [
        'Board only knows Jump; new obstacles are subclasses.',
        'Queue-based turns survive players leaving; modulo index does not.',
        'Inject Dice: deterministic demo, deterministic tests.',
      ],
    },
    {
      heading: 'Snake & Ladder (3/3) — game loop, online concurrency, extensions and the Chess pivot',
      body: `**Turn logic.** Validate the turn (game not over, right player, right \`expectedTurn\`), roll, track consecutive sixes (forfeit undoes the whole run back to \`turnStart\`), apply the overshoot policy, resolve the jump, emit events, record the winner, rotate unless a six earned another roll.

**Concurrency when it goes online.** Two browser tabs (or a double-click) send "roll" twice. Each game must process one action at a time, and duplicates must be harmless:
- **Single-threaded Node:** \`play()\` is synchronous, so it is atomic per process; \`expectedTurn\` turns a duplicate into a \`stale turn\` error instead of a second roll (optimistic concurrency, like an ETag).
- **Many pods:** route each game to one owner pod (consistent hash on \`gameId\`, or sticky WebSocket rooms), or store state in Redis and apply moves with a Lua/\`WATCH\` compare-and-set on \`turnNo\`.
- **Java:** one lock per game (\`ConcurrentHashMap<gameId, Game>\` + \`synchronized (game)\`) or an actor/single-thread executor per game. Never use one global lock for all games.
- **Server-side dice only:** a client-reported roll is a cheating vector.

**Extensions interviewers ask:** new obstacle types (subclass \`Jump\` or a \`CellEffect\`), multiple dice and strategies (min/max/sum), teams, undo (Command objects with \`undo()\`), save/resume (serialize positions + queue + turnNo + RNG seed), and replays (an event log is already there).

**The Chess pivot: what survives and what changes.**
- *Survives:* \`Game\` with a turn queue (2 players), Observer events, \`expectedTurn\` concurrency, Board-as-composition, and the driver.
- *Changes:* the "move" is no longer a dice outcome. Each \`Piece\` subclass generates **pseudo-legal** candidate moves (rays for rook/bishop/queen, jumps for knight); the game filters by **"own king not attacked after the move"**, which handles pins and check in one rule. Special moves (castling, en passant, promotion) are \`Move\` subclasses (Command, with \`undo\` for search and takeback). End states (checkmate, stalemate, 50-move rule, repetition) become a \`GameStatusEvaluator\`. An immutable \`Position.apply(move)\` makes legality checks and undo trivial.

**90-minute version:** \`Board\`, \`Snake\`, \`Ladder\`, \`Dice\`, \`Game\`, \`Rules\`, a console listener, and a driver that reads config, runs a scripted game and a random one. Evaluators look for: no \`console.log\` in domain classes, validation, extensibility of obstacles and dice, correct turn rotation, and a deterministic demo.`,
      code: [
        {
          language: 'typescript',
          title: 'Game: turn queue, sixes, overshoot, winners, events and stale-turn protection',
          code: `export interface Player { id: string; name: string }
export type GameEvent =
  | { type: 'rolled'; player: string; value: number }
  | { type: 'moved'; player: string; from: number; to: number; via?: string }
  | { type: 'won'; player: string; rank: number };

export interface Rules {
  overshoot: 'stay' | 'bounce';      // 98 + 5 => stay at 98, or bounce back to 97
  extraTurnOnSix: boolean;
  maxConsecutiveSixes: number;       // e.g. 3 => third six forfeits the turn
  playUntil: 'first-winner' | 'last-two';
}

export class Game {
  private readonly pos = new Map<string, number>();
  private readonly queue: Player[];
  private readonly ranks: string[] = [];
  private sixes = 0;
  private turnStart = 0;                                    // position before a run of sixes
  private turnNo = 0;
  private readonly listeners: ((e: GameEvent) => void)[] = [];
  constructor(private readonly board: Board, players: Player[], private readonly dice: Dice,
              private readonly rules: Rules) {
    if (players.length < 2) throw new Error('need at least 2 players');
    this.queue = [...players];
    players.forEach((p) => this.pos.set(p.id, 0));          // 0 = off the board
  }
  on(fn: (e: GameEvent) => void): void { this.listeners.push(fn); }
  get current(): Player { return this.queue[0]; }
  get isOver(): boolean {
    return this.rules.playUntil === 'first-winner' ? this.ranks.length > 0 : this.queue.length < 2;
  }
  // expectedTurn makes a retried/double-clicked request harmless (rejects stale turn numbers).
  play(playerId: string, expectedTurn: number): void {
    if (this.isOver) throw new Error('game over');
    if (playerId !== this.current.id) throw new Error('not your turn');
    if (expectedTurn !== this.turnNo) throw new Error('stale turn ' + expectedTurn);
    this.turnNo++;
    const p = this.current;
    const value = this.dice.roll();
    this.emit({ type: 'rolled', player: p.id, value });
    const from = this.pos.get(p.id)!;
    if (this.sixes === 0) this.turnStart = from;
    const six = value === 6 && this.rules.extraTurnOnSix;
    this.sixes = six ? this.sixes + 1 : 0;
    if (six && this.sixes >= this.rules.maxConsecutiveSixes) {   // forfeit: undo the whole run
      this.pos.set(p.id, this.turnStart);
      this.emit({ type: 'moved', player: p.id, from, to: this.turnStart, via: 'forfeit' });
      return this.rotate();
    }
    let to = from + value;
    if (to > this.board.size) to = this.rules.overshoot === 'stay' ? from : 2 * this.board.size - to;
    const jump = this.board.jumpAt(to);
    if (jump) to = jump.to;                                 // board validated: no chains
    this.pos.set(p.id, to);
    this.emit({ type: 'moved', player: p.id, from, to, via: jump?.kind });
    if (to === this.board.size) {
      this.ranks.push(p.id);
      this.emit({ type: 'won', player: p.id, rank: this.ranks.length });
      this.queue.shift(); this.sixes = 0;                   // winner leaves the rotation
      return;
    }
    if (!six) this.rotate();                                // a six keeps the same player
  }
  get turn(): number { return this.turnNo; }
  positionOf(id: string): number { return this.pos.get(id)!; }
  private rotate(): void { this.queue.push(this.queue.shift()!); this.sixes = 0; }
  private emit(e: GameEvent): void { for (const l of this.listeners) l(e); }
}`,
        },
        {
          language: 'typescript',
          title: 'Chess pivot: polymorphic pieces + king-safety filter',
          code: `type Color = 'white' | 'black';
interface Sq { r: number; c: number }
interface Move { from: Sq; to: Sq; promotion?: PieceKind }
type PieceKind = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';

interface BoardView {
  at(s: Sq): Piece | undefined;
  inside(s: Sq): boolean;
}

// Polymorphism: each piece generates pseudo-legal moves; the Game filters by king safety.
abstract class Piece {
  constructor(readonly color: Color) {}
  abstract readonly kind: PieceKind;
  abstract candidates(b: BoardView, from: Sq): Move[];
  protected slide(b: BoardView, from: Sq, dirs: number[][], maxSteps = 8): Move[] {
    const out: Move[] = [];
    for (const [dr, dc] of dirs) {
      for (let k = 1; k <= maxSteps; k++) {
        const to = { r: from.r + dr * k, c: from.c + dc * k };
        if (!b.inside(to)) break;
        const hit = b.at(to);
        if (hit && hit.color === this.color) break;        // own piece blocks
        out.push({ from, to });
        if (hit) break;                                    // capture ends the ray
      }
    }
    return out;
  }
}
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
class Rook extends Piece { readonly kind = 'R'; candidates(b: BoardView, f: Sq) { return this.slide(b, f, ORTHO); } }
class Bishop extends Piece { readonly kind = 'B'; candidates(b: BoardView, f: Sq) { return this.slide(b, f, DIAG); } }
class Queen extends Piece { readonly kind = 'Q'; candidates(b: BoardView, f: Sq) { return this.slide(b, f, [...ORTHO, ...DIAG]); } }
class King extends Piece { readonly kind = 'K'; candidates(b: BoardView, f: Sq) { return this.slide(b, f, [...ORTHO, ...DIAG], 1); } }
class Knight extends Piece {
  readonly kind = 'N';
  candidates(b: BoardView, f: Sq): Move[] {
    return [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
      .map(([dr, dc]) => ({ from: f, to: { r: f.r + dr, c: f.c + dc } }))
      .filter((m) => b.inside(m.to) && b.at(m.to)?.color !== this.color);
  }
}

// Legality = pseudo-legal AND own king not attacked afterwards (handles pins and checks).
interface Position extends BoardView { apply(m: Move): Position; kingOf(c: Color): Sq }
function legalMoves(pos: Position, from: Sq, mover: Color): Move[] {
  const p = pos.at(from);
  if (!p || p.color !== mover) return [];
  const enemy: Color = mover === 'white' ? 'black' : 'white';
  return p.candidates(pos, from).filter((m) => {
    const next = pos.apply(m);                             // immutable position => easy undo/search
    return !attacked(next, next.kingOf(mover), enemy);
  });
}
function attacked(pos: Position, target: Sq, by: Color): boolean {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = pos.at({ r, c });
    if (p?.color === by && p.candidates(pos, { r, c }).some((m) => m.to.r === target.r && m.to.c === target.c)) return true;
  }
  return false;
}
export { Rook, Bishop, Queen, King, Knight, legalMoves };`,
        },
      ],
      keyPoints: [
        'expectedTurn makes duplicate moves harmless (optimistic concurrency).',
        'One owner per game (pod, lock or actor), never a global lock.',
        'Chess = pseudo-legal moves per Piece + "king safe after move" filter + Move commands.',
      ],
    },
    {
      heading: 'Closing comparison — four case studies side by side',
      body: `**The common shape.** Every case is *policy objects around a small core data structure*, plus one concurrency hazard you must name. Recognize the shape and the 90 minutes become predictable.

| | Rate limiter | Pub/sub | Task scheduler | Snake & Ladder |
|---|---|---|---|---|
| Core data structure | Map key → small state (LRU) | Append-only arrays + cursors | Two min-heaps | Map cell → Jump, queue of players |
| Main Strategy | Algorithm (bucket/log/window) | Partitioner, RetryPolicy, Overflow | Schedule, RetryPolicy | Dice, Jump subtypes, Rules |
| Other patterns | Flyweight, Decorator, Registry | Observer (metrics), state machine | Command, Observer, ports | Observer, Builder, (Command for undo) |
| Inject for tests | Clock | Clock | Clock + Timer | Dice |
| Concurrency hazard | Check-then-consume across await / workers | Stale acks, rebalance duplicates | Overlapping runs, cancel while running | Double move, out-of-turn move |
| Fix | Sync critical section / Lua / CAS | Idempotent ack, idempotent consumers | Enqueue next after settle, AbortSignal | expectedTurn, one owner per game |
| Classic pivot | "Make it distributed" | "Keep per-key order with retries" | "Missed runs after restart" | "Now make it chess" |
| Stub in 90 min | Redis store, hot reload | Persistence, push mode | Repository, full cron | Online play, undo |

**Evaluation rubric used by most panels:** (1) working demo; (2) model quality: right nouns, no god class; (3) extensibility proven by a second implementation; (4) edge cases and validation; (5) concurrency stated correctly for the runtime; (6) code hygiene: small methods, typed errors, no I/O in the domain.

**Say this to close:** "The core is X; everything that varies by requirement is behind an interface; the one thing that would break at scale is Y, and here is how I would fix it."`,
      keyPoints: [
        'Recognize the pattern: tiny core + policy objects + one named concurrency hazard.',
        'Always inject time and randomness.',
        'Prove extensibility with a second implementation, not a comment.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'lld-cases-2-cc-1',
      title: 'Refactor a god-class rate limiter into Strategy + Registry + injected Clock',
      context:
        'A shared npm package exports this singleton limiter, used by six NestJS services. Teams keep forking it to add algorithms, its tests are flaky in CI, and last week one pod used 3 GB of heap. Someone also noticed that a user registered as "__proto__" behaves strangely.',
      task: 'Refactor into a design where a new algorithm needs no edits to the limiter, time is injectable, memory is bounded, several rules (per user, per IP on /login) can apply to one request without partial charging, and the instance comes from DI instead of a static singleton.',
      starter: {
        language: 'typescript',
        title: 'rate-limiter.ts (before)',
        code: `export class RateLimiter {
  static instance = new RateLimiter();                 // global mutable singleton
  private buckets: Record<string, any> = {};
  private config: any = require('./limits.json');     // {"type":"token","capacity":100,"perSec":10,"limit":5}

  isAllowed(userId: string, ip: string, route: string): boolean {
    const now = Date.now();                           // untestable, jumps under NTP
    const key = userId || ip;
    if (this.config.type === 'token') {
      let b = this.buckets[key];
      if (!b) b = this.buckets[key] = { tokens: this.config.capacity, last: now };
      b.tokens = Math.min(this.config.capacity, b.tokens + ((now - b.last) / 1000) * this.config.perSec);
      b.last = now;
      if (b.tokens < 1) { console.log('blocked', key); return false; }
      b.tokens -= 1;
      return true;
    } else if (this.config.type === 'window') {
      const k = key + ':' + Math.floor(now / 60000);   // a new key every minute, never deleted
      this.buckets[k] = (this.buckets[k] || 0) + 1;
      return this.buckets[k] <= this.config.limit;
    } else if (this.config.type === 'login') {
      if (route !== '/login') return true;
      const k = 'login:' + ip + ':' + Math.floor(now / 60000);
      this.buckets[k] = (this.buckets[k] || 0) + 1;
      return this.buckets[k] <= 5;
    }
    return true;                                      // unknown type silently allows everything
  }
}`,
      },
      hints: [
        'List what varies: the algorithm, the key dimension and the route filter. Each of those should be data or a class, not an else-if branch.',
        'Separate "decide" from "charge" so a denial by the login rule does not burn the user bucket.',
        'Where do minute-window keys go when the minute ends? Reuse one state object per key instead of minting a key per window. Use a Map with a size cap.',
      ],
      solution: {
        language: 'typescript',
        title: 'rate-limit/core.ts (after)',
        code: `// rate-limit/core.ts — no globals, no Date.now(), no if/else on algorithm names
export interface Clock { now(): number }
export interface Decision { allowed: boolean; retryAfterMs: number }
export interface Algorithm<S> {
  create(now: number): S;
  evaluate(s: S, now: number, cost: number): Decision; // never consumes
  consume(s: S, now: number, cost: number): void;
}

class TokenBucket implements Algorithm<{ tokens: number; last: number }> {
  constructor(private readonly capacity: number, private readonly perSec: number) {}
  create(now: number) { return { tokens: this.capacity, last: now }; }
  evaluate(b: { tokens: number; last: number }, now: number, cost: number): Decision {
    b.tokens = Math.min(this.capacity, b.tokens + (Math.max(0, now - b.last) * this.perSec) / 1000);
    b.last = Math.max(b.last, now);
    return b.tokens >= cost ? { allowed: true, retryAfterMs: 0 }
      : { allowed: false, retryAfterMs: Math.ceil(((cost - b.tokens) * 1000) / this.perSec) };
  }
  consume(b: { tokens: number }, _now: number, cost: number) { b.tokens -= cost; }
}

class FixedWindow implements Algorithm<{ window: number; count: number }> {
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  create(now: number) { return { window: Math.floor(now / this.windowMs), count: 0 }; }
  evaluate(s: { window: number; count: number }, now: number, cost: number): Decision {
    const w = Math.floor(now / this.windowMs);
    if (w !== s.window) { s.window = w; s.count = 0; }   // state is reused, never a new key per window
    return s.count + cost <= this.limit ? { allowed: true, retryAfterMs: 0 }
      : { allowed: false, retryAfterMs: (w + 1) * this.windowMs - now };
  }
  consume(s: { count: number }, _now: number, cost: number) { s.count += cost; }
}

// Factory registry: a new algorithm is one register() call, the limiter never changes.
type Factory = (params: Record<string, number>) => Algorithm<any>;
export class AlgorithmRegistry {
  private readonly factories = new Map<string, Factory>([
    ['token-bucket', (p) => new TokenBucket(p.capacity, p.perSec)],
    ['fixed-window', (p) => new FixedWindow(p.limit, p.windowMs)],
  ]);
  register(name: string, f: Factory): void { this.factories.set(name, f); }
  create(name: string, params: Record<string, number>): Algorithm<any> {
    const f = this.factories.get(name);
    if (!f) throw new Error('unknown rate-limit algorithm: ' + name);  // fail at boot, not per request
    return f(params);
  }
}

export interface Ctx { userId?: string; ip: string; route: string }
export interface RuleConfig { id: string; by: 'user' | 'ip'; route?: string; algorithm: string; params: Record<string, number> }
interface Rule { id: string; keyOf(c: Ctx): string | null; algo: Algorithm<any> }

export class RateLimiter {
  private readonly rules: Rule[];
  private readonly state = new Map<string, unknown>();          // Map: '__proto__' is just a key
  constructor(configs: RuleConfig[], registry: AlgorithmRegistry, private readonly clock: Clock,
              private readonly maxKeys = 500_000) {
    this.rules = configs.map((c) => ({
      id: c.id,
      algo: registry.create(c.algorithm, c.params),
      keyOf: (x: Ctx) => (c.route && c.route !== x.route ? null : c.by === 'user' ? x.userId ?? null : x.ip),
    }));
  }
  check(ctx: Ctx): Decision {
    const now = this.clock.now();
    const pass: [Rule, unknown][] = [];
    for (const r of this.rules) {
      const k = r.keyOf(ctx);
      if (k === null) continue;
      const sk = r.id + '|' + k;
      let s = this.state.get(sk);
      if (s === undefined) {
        if (this.state.size >= this.maxKeys) this.state.delete(this.state.keys().next().value as string);
        s = r.algo.create(now);
      } else this.state.delete(sk);                              // re-insert below = LRU touch
      this.state.set(sk, s);
      const d = r.algo.evaluate(s, now, 1);
      if (!d.allowed) return d;
      pass.push([r, s]);
    }
    for (const [r, s] of pass) r.algo.consume(s, now, 1);
    return { allowed: true, retryAfterMs: 0 };
  }
}

// NestJS wiring: one instance per app via DI, config validated at boot, fake clock in tests.
export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const rateLimiterProvider = {
  provide: RATE_LIMITER,
  useFactory: (rules: RuleConfig[]) => new RateLimiter(rules, new AlgorithmRegistry(), { now: () => performance.now() }),
  inject: ['RATE_LIMIT_RULES'],
};`,
      },
      explanation: `**What changed and why:**
- **Strategy + Registry (open/closed):** the \`if/else\` on \`config.type\` became \`Algorithm<S>\` classes created by \`AlgorithmRegistry\`. A new algorithm is one \`register()\` call. An unknown name now **fails at boot** instead of silently allowing everything.
- **Rules as data:** each rule config states its key dimension and optional route, so "per user everywhere" and "per IP on /login" coexist. The old code could only run one algorithm for the whole process.
- **Evaluate, then consume:** all rules decide first; tokens are charged only if every rule passes, so a login denial no longer burns the user's general quota.
- **Injected Clock:** tests drive time explicitly, no sleeps. \`performance.now()\` is monotonic, and negative elapsed time is clamped.
- **Bounded memory:** fixed-window state is reused per key (\`{window, count}\`) instead of minting \`key:minute\` entries that were never deleted (the 3 GB leak). The \`Map\` is capped with LRU eviction.
- **\`Map\` instead of \`Record\`:** a key of \`__proto__\` on a plain object reads/writes the prototype rather than an own property.
- **DI instead of a static singleton:** each Nest app (and each test) gets its own instance with its own rules; no hidden global state shared across test files.
- **No console.log in the domain:** decisions carry \`retryAfterMs\`; the guard logs and sets headers.`,
      followUps: [
        {
          q: 'How do you unit-test the "login denial must not burn the user token" behaviour without any sleeps?',
          a: 'Construct the limiter with `{ now: () => t }` and a user bucket of capacity 2 plus a login window of 1. Call `/login` twice: the second is denied by the login rule. Then call a non-login route twice and assert both pass, and a third fails. If the login denial had charged the bucket, the second non-login call would fail. Advance `t` by 60,000 to assert the window resets. Every test is synchronous and finishes in microseconds.',
        },
        {
          q: 'Product now wants the same limits enforced across 12 pods. What changes in your refactored design, and what stays?',
          a: 'The `Algorithm`, `Rule` and registry interfaces stay. The in-memory `Map` becomes a `StateStore` port, with a Redis implementation. Because evaluate + consume must be atomic across pods, the Redis version runs the whole rule set in one Lua script (one round trip, about 0.5 ms) keyed by `ruleId|key`, with a TTL set to the time to full refill. Keep the in-memory store as a local pre-filter or fail-open fallback when Redis is down. The check becomes async, so the guard awaits it.',
        },
      ],
    },
    {
      id: 'lld-cases-2-cc-2',
      title: 'Refactor a Snake & Ladder god-class into a testable, extensible game',
      context:
        'This was submitted in a 90-minute machine-coding round. The reviewer ran it with a config that has a ladder 5→20 and a snake 20→5 and the process hung. They then asked you to add a "crocodile" cell that sends a player back 5 squares and to make the game playable turn-by-turn from a WebSocket handler.',
      task: 'Refactor so that the board is validated, cell behaviour is polymorphic (a crocodile needs no edits to existing classes), dice are injectable, the game advances one turn per call, extra turns on six are bounded, and the domain does not print.',
      starter: {
        language: 'typescript',
        title: 'snake-ladder.ts (before)',
        code: `class SnakeLadderGame {
  board: number[] = new Array(101).fill(0);           // board[i] = destination or 0
  positions: number[] = [];
  names: string[] = [];
  turn = 0;

  constructor(snakes: number[][], ladders: number[][], names: string[]) {
    for (const [head, tail] of snakes) this.board[head] = tail;
    for (const [foot, top] of ladders) this.board[foot] = top; // silently overwrites a snake
    this.names = names;
    this.positions = names.map(() => 0);
  }

  start() {
    while (true) {
      const roll = Math.floor(Math.random() * 6) + 1;
      let p = this.positions[this.turn] + roll;
      if (p > 100) p = this.positions[this.turn];
      while (this.board[p]) p = this.board[p];        // follows chains forever on a cycle
      console.log(this.names[this.turn] + ' rolled ' + roll + ' and moved to ' + p);
      this.positions[this.turn] = p;
      if (p === 100) { console.log(this.names[this.turn] + ' wins'); return; }
      if (roll !== 6) this.turn = (this.turn + 1) % this.names.length; // unlimited sixes
    }
  }
}`,
      },
      hints: [
        'What should happen at construction time if two effects share a cell, or an effect lands on another effect?',
        'Replace the number array with an object that answers "where do I end up from here?" so a crocodile is a new class.',
        'Invert the loop: the game exposes playTurn(); a console driver or a socket handler decides when to call it.',
      ],
      solution: {
        language: 'typescript',
        title: 'snake-ladder.ts (after)',
        code: `// A cell effect decides where you end up; the board never switches on types.
export interface CellEffect { readonly at: number; destination(from: number): number; describe(): string }
export class Snake implements CellEffect {
  constructor(readonly at: number, private readonly tail: number) {
    if (tail >= at) throw new Error('snake at ' + at + ' must go down');
  }
  destination() { return this.tail; }
  describe() { return 'snake'; }
}
export class Ladder implements CellEffect {
  constructor(readonly at: number, private readonly top: number) {
    if (top <= at) throw new Error('ladder at ' + at + ' must go up');
  }
  destination() { return this.top; }
  describe() { return 'ladder'; }
}
export class Crocodile implements CellEffect {          // added later: no edits elsewhere
  constructor(readonly at: number, private readonly back = 5) {}
  destination(from: number) { return Math.max(1, from - this.back); }
  describe() { return 'crocodile'; }
}

export class Board {
  private readonly effects = new Map<number, CellEffect>();
  constructor(readonly size: number, effects: CellEffect[]) {
    for (const e of effects) {
      if (e.at <= 1 || e.at >= size) throw new Error('no effect allowed on cell ' + e.at);
      if (this.effects.has(e.at)) throw new Error('duplicate effect on cell ' + e.at);
      this.effects.set(e.at, e);
    }
    for (const e of effects) {
      const to = e.destination(e.at);
      if (to < 1 || to > size || this.effects.has(to)) throw new Error('effect at ' + e.at + ' chains or leaves board');
    }
  }
  land(cell: number): { cell: number; via?: string } {
    const e = this.effects.get(cell);
    return e ? { cell: e.destination(cell), via: e.describe() } : { cell };
  }
}

export interface Dice { roll(): number }
export type Event = { player: string; roll: number; from: number; to: number; via?: string; won: boolean };

export class Game {
  private readonly order: string[];
  private readonly pos = new Map<string, number>();
  private sixes = 0;
  winner?: string;
  constructor(private readonly board: Board, players: string[], private readonly dice: Dice,
              private readonly onEvent: (e: Event) => void = () => {}, private readonly maxSixes = 3) {
    if (players.length < 2 || new Set(players).size !== players.length) throw new Error('need 2+ unique players');
    this.order = [...players];
    players.forEach((p) => this.pos.set(p, 0));
  }
  playTurn(): Event {                                   // one roll; the driver owns the loop
    if (this.winner) throw new Error('game over');
    const player = this.order[0];
    const roll = this.dice.roll();
    const from = this.pos.get(player)!;
    this.sixes = roll === 6 ? this.sixes + 1 : 0;
    let to = from + roll > this.board.size ? from : from + roll;
    const landed = this.board.land(to);
    to = landed.cell;
    this.pos.set(player, to);
    const won = to === this.board.size;
    if (won) this.winner = player;
    if (roll !== 6 || this.sixes >= this.maxSixes) { this.order.push(this.order.shift()!); this.sixes = 0; }
    const e = { player, roll, from, to, via: landed.via, won };
    this.onEvent(e);
    return e;
  }
}

// driver: the only place that prints
export function runDemo(dice: Dice): void {
  const board = new Board(100, [new Snake(99, 10), new Ladder(4, 56), new Crocodile(40)]);
  const game = new Game(board, ['alice', 'bob'], dice, (e) =>
    console.log(e.player + ' rolled ' + e.roll + ': ' + e.from + ' -> ' + e.to + (e.via ? ' via ' + e.via : '')));
  for (let i = 0; i < 10_000 && !game.winner; i++) game.playTurn();
  console.log('winner: ' + game.winner);
}`,
      },
      explanation: `**Fixes:**
- **Validation at construction:** effects must stay inside the board, cannot sit on cell 1 or the last cell, cannot share a cell, and **cannot land on another effect**. That kills the 5→20→5 cycle, so no chain-following loop is needed at all. Direction is checked in the \`Snake\`/\`Ladder\` constructors.
- **Polymorphism:** \`CellEffect.destination(from)\` replaces the \`number[]\` lookup. \`Crocodile\` (back 5) is a new class with zero edits to \`Board\` or \`Game\`, which a plain destination array cannot express.
- **Injected \`Dice\`:** the demo and tests become deterministic.
- **One turn per call:** \`playTurn()\` returns an event. The infinite \`while (true)\` moves to the driver, so the same class works from a socket handler.
- **Bounded sixes:** after \`maxSixes\` the turn passes.
- **Observer callback** instead of \`console.log\`: only the driver prints.
- **Parallel arrays → \`Map\` + rotating queue:** no index drift if a player leaves. Duplicate names are rejected.
- **Board size is a parameter**, no hard-coded 100/101.`,
      followUps: [
        {
          q: 'Your validation forbids an effect landing on another effect. The product owner wants a "ladder into a snake" combo as a feature. How do you allow it safely?',
          a: 'Allow chains but prove termination at construction. Treat effects as edges cell → destination and run cycle detection (DFS with colours, or follow each chain while recording visited cells, O(n)). Reject only cycles. At runtime, resolve with a bounded loop (at most `effects.size` hops) and emit one event per hop so the UI can animate it. Effects that depend on `from` (a crocodile) make the graph state-dependent; either forbid them in chains or evaluate them with the actual position at each hop.',
        },
        {
          q: 'Now make it multiplayer online. Two tabs of the same user send "roll" 30 ms apart. What do you add to `playTurn`?',
          a: 'Make the call `playTurn(playerId, expectedTurn)`: reject if the player is not at the front of the queue, and reject if `expectedTurn` does not match the game\'s turn counter, then increment it. The second tab\'s request carries the same `expectedTurn`, so it gets a "stale turn" error instead of a second roll. Roll dice on the server only. Keep each game on one owner (sticky room on one pod, or a per-game lock / Redis CAS on `turnNo`), since `expectedTurn` alone is not atomic across processes.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'lld-cases-2-iq-01',
      difficulty: 'hard',
      question:
        'Design the class structure of an in-process rate-limiting library that ten NestJS teams will import. One request may be subject to a per-API-key limit, a per-IP limit and a tighter limit on /login. Walk me through the interfaces, and show how a team adds GCRA next quarter without a PR to your core.',
      whatInterviewerLooksFor: [
        'Separates stateless algorithm (Strategy) from per-key state',
        'Handles several rules per request without partial charging',
        'Uses a registry/factory driven by config for open/closed extension',
        'Injects a clock and keeps HTTP concerns in an adapter',
        'Mentions memory bounds and the atomicity assumption',
      ],
      modelAnswer: `**API first:** \`limiter.check(ctx) → { allowed, remaining, retryAfterMs }\`; a Nest guard maps it to 429 + \`Retry-After\`.

**Core types**
- \`RateLimitAlgorithm<S>\`: \`create(now)\`, \`evaluate(s, now, cost)\`, \`consume(s, now, cost)\`, \`isIdle(s, now)\`. **Stateless**; one instance per rule is shared by every key (Flyweight). The state \`S\` is tiny (\`{tokens, last}\` is 2 numbers), so 1M keys cost about 100–200 MB in V8, not gigabytes of objects.
- \`Rule\`: \`id\`, \`keyOf(ctx) → string | null\` (null = not applicable, e.g. not \`/login\`), \`algorithm\`, \`cost(ctx)\`.
- \`StateStore\`: \`getOrCreate\` with an LRU cap + idle sweep; later a Redis implementation.
- \`Clock\`: \`now()\`; monotonic in prod, fake in tests.

**Multi-rule semantics.** Evaluate every applicable rule first; if any denies, return its decision (its \`retryAfter\`) with **nothing consumed**; otherwise consume all. Without this, a per-IP denial would still burn per-key quota.

**Extension.** \`AlgorithmRegistry.register('gcra', p => new Gcra(p.rate, p.burst))\`. Config says \`{ algorithm: 'gcra', params: {...} }\`. The team ships GCRA in their own package and registers it at module init (\`RateLimitModule.forRoot({ algorithms: [...] })\`); the core never changes. Unknown names fail at boot.

**Cross-cutting via Decorators:** \`ShadowLimiter\` (log would-deny, always allow) for safely rolling out a new limit; \`MetricsLimiter\` for counters by rule.

**Concurrency assumption, stated:** \`check\` is synchronous, so evaluate + consume is atomic on the event loop. An async store breaks that, and then the store must do the whole rule set atomically (Lua).`,
      followUps: [
        {
          q: 'A rule needs the response status (only count failed logins). Your check runs before the handler. How does the design change?',
          a: 'Split the call into `reserve()` before and `settle(outcome)` after. Or, simpler for failed-login counting, check before with `evaluate` only (deny if the budget is already exhausted) and `consume` from an interceptor after the response when status is 401. The rule declares `phase: "post"` and the guard and interceptor share the store. The race (two concurrent failures both passing the pre-check) is acceptable for a brute-force limiter, since the budget overshoots by at most the concurrency.',
        },
        {
          q: 'How do you return a meaningful `RateLimit-Remaining` when three rules apply?',
          a: 'Report the most restrictive one: the minimum remaining across the applicable rules after consumption, and with it that rule\'s reset time. The IETF RateLimit headers draft allows naming the policy, so you can expose which rule is binding. On a denial, `Retry-After` comes from the denying rule. If several deny, take the maximum `retryAfter`, because retrying earlier would just be denied again by the slower one.',
        },
        {
          q: 'Why not one TokenBucket object per key, as most tutorials do?',
          a: 'Each instance repeats the config (capacity, rate) and carries object overhead, and config changes then require walking millions of objects. With shared algorithms, a config reload swaps one Strategy instance per rule and existing state keeps working. State as plain data is also serializable, which is the prerequisite for a Redis store or a snapshot on deploy. Per-key objects are fine for 1K keys; the issue shows at 1M+.',
        },
      ],
      pitfalls: [
        'Checking rules one by one and consuming as you go (partial charging).',
        'Calling Date.now() inside the algorithm and testing with setTimeout.',
        'A switch on algorithm name inside the limiter.',
        'Ignoring memory entirely ("it is just a Map").',
      ],
    },
    {
      id: 'lld-cases-2-iq-02',
      difficulty: 'expert',
      question:
        'A scanner hits your public API with millions of random API keys. Your in-process limiter keys its per-key rule on the raw header, and pods start getting OOM-killed. Redesign the limiter\'s state management so memory is bounded without giving the attacker a free pass.',
      context: 'Each pod has a 1.5 GB heap limit; normal traffic is about 200K distinct keys per pod per hour.',
      whatInterviewerLooksFor: [
        'Identifies attacker-controlled key cardinality as the root cause',
        'Distinguishes lossless idle eviction from lossy LRU eviction',
        'Orders rules: cheap pre-auth limits before per-key state creation',
        'Puts numbers on memory per key and the cap',
        'Adds observability for evictions',
      ],
      modelAnswer: `**Root cause:** the store key is attacker-chosen, so cardinality is unbounded. Each new key allocates state (Map entry + object + key string, about 150–250 B), so 10M junk keys ≈ 2 GB.

**1. Do not create state for unauthenticated identifiers.** Validate the API key format (a cheap regex or checksum) and existence (an in-memory set or bloom filter of issued keys) *before* the per-key rule. An invalid key falls into a single shared \`invalid-key\` bucket per IP. State is then created only for real keys (about 200K/h), plus one bucket per source IP.

**2. Bound what remains.** An LRU-capped store, e.g. \`maxKeys = 1M\` (about 200 MB), plus a periodic \`sweepIdle()\`. For a token bucket, *idle* means "it would be full by now". Dropping it is **lossless**, since a recreated bucket starts full, which is identical. LRU-evicting a *busy* key is **lossy**: that key gets a fresh burst. So sweep idle first and evict LRU only as a last resort, and **count evictions** (a metric plus an alert). Non-zero evictions mean the cap is too small or an attack is in progress.

**3. Rule order = cost order.** Per-IP (and per-subnet) limits run first, so a scanner from 50 IPs is throttled before it reaches the per-key layer. The per-IP map is also bounded, with the same idle logic.

**4. Algorithm choice affects memory.** A sliding log with limit 1,000 stores up to 1,000 timestamps per key (8 KB as a packed double array). Use a token bucket or sliding-window counter for large limits; keep logs for tiny limits (OTP: 5/15 min).

**5. Fail-safe:** if the store is at its cap and full of non-idle keys, treat *new* unknown keys conservatively (deny or use a shared bucket) instead of evicting legitimate busy keys.`,
      followUps: [
        {
          q: 'What sweep interval do you choose, and how do you keep the sweep from blocking the event loop?',
          a: 'Make the interval about the time to refill a bucket (capacity ÷ rate, e.g. 100 tokens at 10/s = 10 s), or 30–60 s for coarse limits. A full sweep of 1M entries takes roughly 20–50 ms, which is a visible event-loop stall. Sweep incrementally instead: keep an iterator and process 10K entries per `setImmediate` slice, or sweep only from the LRU end (the oldest entries are the likeliest to be idle) and stop at the first non-idle one.',
        },
        {
          q: 'Would a probabilistic structure such as a count-min sketch help here?',
          a: 'For detecting heavy hitters, yes: a count-min sketch of width 2^16 and depth 4 is about 1 MB at 4 bytes per counter, and it finds which keys or IPs exceed a threshold without per-key state. It overestimates, though, so use it to flag candidates and keep exact buckets only for keys above the threshold. It cannot produce an exact `remaining` or `retryAfter`, so it complements per-key buckets rather than replacing them.',
        },
      ],
      pitfalls: [
        'Just raising the heap limit.',
        'Pure LRU eviction without noticing it resets the limit for evicted busy keys.',
        'Creating state before validating the key.',
        'Keeping a sliding log for large limits.',
      ],
    },
    {
      id: 'lld-cases-2-iq-03',
      difficulty: 'medium',
      question:
        'Your limiter\'s unit tests use real timers ("send 10, sleep 1100 ms, expect allowed"), CI takes 4 minutes for this package and fails about 1 run in 30. What do you change in the design, and which test cases do you write for a token bucket?',
      whatInterviewerLooksFor: [
        'Clock injection as a design decision, not a test hack',
        'Concrete boundary cases including retryAfter exactness',
        'Clock-skew and cost > capacity edge cases',
        'Awareness that monotonic time differs from wall time',
      ],
      modelAnswer: `**Design change:** the algorithm and the facade take a \`Clock\` (\`now(): number\`). Production passes a monotonic clock (\`performance.now()\` or \`process.hrtime.bigint()\`); tests pass a \`FakeClock\` with \`advance(ms)\`. No \`Date.now()\`, \`setTimeout\` or sleeps in the domain. Tests become synchronous and take microseconds; the flakiness came from timer jitter on loaded CI runners (a 1,100 ms sleep can take 1,180 ms, or a GC pause shifts it).

**Token bucket cases (capacity 5, 1 token/s):**
1. A fresh bucket allows exactly 5 instant requests; the 6th is denied with \`retryAfterMs = 1000\`.
2. After \`advance(999)\`, still denied (\`retryAfter = 1\`); after \`advance(1)\`, allowed. This checks that rounding uses ceil, not floor.
3. Refill caps at capacity: \`advance(1h)\` then 6 requests → 5 allowed.
4. Fractional refill accumulates: 2 × \`advance(500)\` = 1 token.
5. \`cost > capacity\` → denied with \`retryAfter = Infinity\` (not a misleading wait).
6. **Clock goes backwards** (\`advance(-3000)\`): tokens never decrease and do not become NaN.
7. Multi-rule: a denial by rule B leaves rule A's tokens untouched.
8. Idle detection: \`isIdle\` is true exactly when a recreated bucket would behave identically.

**Plus one property-based test** (fast-check): for any sequence of (advance, request) pairs, the number allowed in any window W is at most capacity + rate × W.`,
      followUps: [
        {
          q: 'Why monotonic time in production, if Date.now() looks fine on your laptop?',
          a: 'Wall-clock time is adjusted by NTP. It can step backwards or jump forwards (VM resume, leap smear, manual fixes). A forward jump of 60 s refills every bucket instantly, letting a burst through; a backward jump stalls refills unless you clamp. `performance.now()` only moves forward at a steady rate. Use wall time only for values that leave the process, such as a `Reset` header expressed as an epoch.',
        },
        {
          q: 'How would you test the guard (HTTP layer) without duplicating the algorithm tests?',
          a: 'Stub the limiter with a fake returning canned decisions, and assert the mapping in a Nest e2e test with supertest: allowed → handler runs and `RateLimit-Remaining` is set; denied with `retryAfterMs: 1500` → 429 with `Retry-After: 2` (seconds, rounded up) and the handler not called. One integration test wires the real limiter with a fake clock to prove the module is assembled correctly. Algorithm edge cases stay in the unit suite.',
        },
      ],
      pitfalls: [
        'Using jest fake timers but still calling Date.now() inside the algorithm.',
        'Testing only the happy path and never the retryAfter value.',
        'Forgetting the clock-skew case.',
      ],
    },
    {
      id: 'lld-cases-2-iq-04',
      difficulty: 'hard',
      question:
        'Build an in-memory pub/sub with topics, producers, consumer groups and offsets. A consumer must be able to restart and resume, and a second team must be able to replay yesterday\'s messages. Walk me through the classes and the exact state you keep per group.',
      context:
        'Reported in Razorpay SSE design rounds (2025, LeetCode Discuss): producers, consumers, subscriptions and offset handling. A similar 90-minute version (multiple topics, ordering within partitions, thread safety) is reported for Flipkart SDE-3.',
      whatInterviewerLooksFor: [
        'Log + cursors model instead of per-subscriber queues',
        'Clear per-partition cursor state: committed, next, in-flight, acked',
        'Contiguous-prefix commit rule',
        'Retention tied to the slowest group',
        'Assignment of partitions to group members',
      ],
      modelAnswer: `**Model:** a \`Topic\` has N \`Partition\`s. Each partition is an append-only array with a \`base\` offset (so retention can drop a prefix without renumbering). A \`Partitioner\` Strategy picks the partition (key hash for per-key order, round-robin otherwise). A message is identified by (topic, partition, offset).

**ConsumerGroup** holds members and, for each partition, a **Cursor**:
- \`committed\`: everything below it is done. A restart resumes here.
- \`next\`: the next offset never handed out.
- \`inflight: Map<offset, {attempts, dueAt, owner}>\`: handed out but not acked.
- \`acked: Set<offset>\`: acked offsets above \`committed\` (out-of-order acks).

**Flow:** \`poll(consumer, max)\` → redeliver due in-flight messages, then fresh ones from \`next\`, capped by \`maxInFlightPerPartition\`. \`ack(p, off)\` removes the message from in-flight, adds it to \`acked\`, then advances \`committed\` while \`acked\` contains it. If offsets 5, 6, 7 are delivered and 7, 6 are acked, \`committed\` stays at 5 until 5 is acked. A crash then replays 5–7: duplicates, never loss.

**Replay:** another group is just another cursor set: \`createGroup('audit', { from: 'earliest' | offset | timestamp })\`. The log is shared, not copied.

**Retention:** \`compact()\` truncates each partition below \`min(committed)\` across groups, plus an optional size or time cap. Yesterday's replay works only if retention keeps a day. Say what happens when a cap forces truncation past a slow group (it skips ahead, and you emit an alert).

**Assignment:** partition p → member \`members[p % n]\`, recomputed on join/leave. On leave, the departed member's in-flight messages become due immediately.

**Thread safety:** synchronous methods in Node; in Java, one lock per cursor.`,
      followUps: [
        {
          q: 'A consumer restarts. Should committed offsets live in the broker or in the consumer?',
          a: 'In the broker (the group), as here: consumers stay stateless and any member can take over a partition. Store them in the consumer only when it commits offsets in the same transaction as its own side effects (e.g. offset + DB write in one Postgres transaction). That gives effectively-once processing; the consumer then seeks to its stored offset on start. Kafka supports both: `__consumer_offsets` or external storage plus `seek()`.',
        },
        {
          q: 'How do you expose lag, and what alert do you set?',
          a: 'Per partition, lag = `endOffset − committed`; also track time lag = now − timestamp of the oldest unacked message. Alert on time lag (e.g. > 60 s for 5 minutes), not raw count, because 10K messages may be 1 second of work for one group and an hour for another. Also alert when a group\'s committed offset has not moved for N minutes while lag > 0: a stuck poison message or dead consumer.',
        },
        {
          q: 'The interviewer adds "subscribers can subscribe with a regex on topic names". Where does that go?',
          a: 'Add a `TopicMatcher` (Strategy: exact, prefix, regex) on the subscription. When a topic is created, the broker checks existing subscriptions and attaches cursors for matching ones, so a group can span many topics with cursors keyed by (topic, partition). Compile regexes once, and guard against catastrophic backtracking (reject nested quantifiers, or use RE2) because the pattern is user-supplied.',
        },
      ],
      pitfalls: [
        'Deleting a message from a queue on delivery, which leaves no replay or redelivery.',
        'Committing the highest acked offset.',
        'Copying each message into every subscriber\'s queue.',
        'Ignoring what retention does to a slow group.',
      ],
    },
    {
      id: 'lld-cases-2-iq-05',
      difficulty: 'expert',
      question:
        'In your in-memory queue, one malformed payment event makes the consumer throw every time. Partition 3 has stopped moving, and 40K events for other merchants pile up behind it. Payments per merchant must be processed in order. Design retries and dead-lettering as classes, and explain how you avoid blocking every merchant on one bad event.',
      whatInterviewerLooksFor: [
        'RetryPolicy and DLQ as first-class objects with metadata',
        'Separates retryable from non-retryable errors',
        'Understands the ordering vs throughput trade-off of in-flight > 1',
        'Proposes per-key parking instead of per-partition blocking',
        'Plans replay from the DLQ',
      ],
      modelAnswer: `**Classes**
- \`RetryPolicy\` (Strategy): \`maxAttempts\`, \`delayMs(attempt)\` (exponential with jitter, capped), \`isRetryable(err)\`. A schema/validation error is **not** retryable: dead-letter it immediately rather than waiting through five backoffs.
- \`DeadLetterSink\`: publishes to \`payments.dlq\` with headers \`x-origin\` (topic/partition@offset), \`x-error\`, \`x-attempts\` and \`x-first-failed-at\`, then acks the original.
- \`InFlight\` record: \`attempts\`, \`dueAt\` (one mechanism for both ack timeout and backoff).

**The ordering problem.** Per-merchant order requires that event N+1 for merchant M is not applied before N. With \`maxInFlightPerPartition = 1\`, a poison event blocks the **whole partition** (every merchant hashed there) for the full retry budget: head-of-line blocking. With in-flight > 1, other events proceed but merchant M's later events can overtake the retrying one.

**Per-key parking (what I would build):**
- On a failure of event E for key M: move E to a \`RetryParking\` structure keyed by M, and mark M as **blocked**.
- Subsequent events for M that arrive while M is blocked are appended to M's parked list *in order*, not processed. Other keys continue at full speed, and the partition cursor can commit past parked events because they are now owned by the parking structure, which must itself be durable or bounded.
- When E succeeds on retry, drain M's parked list in order. When E exhausts its retries, dead-letter E **and** decide policy for the parked followers: usually dead-letter them too (applying N+1 without N is wrong for a ledger), or hold them for manual repair.
- Bound the parking: at most K keys or L events; beyond that, fall back to blocking the partition (better slow than out of order).

**Replay:** a \`DlqReplayer\` republishes DLQ messages (after a fix) to the original topic with the same key, preserving per-key order among the replayed set. Consumers stay idempotent on the event id, so replays are safe.`,
      followUps: [
        {
          q: 'A message keeps crashing the whole consumer process (OOM), so nack is never called. How does it still reach the DLQ?',
          a: 'The ack timeout is the backstop: each redelivery after a timeout increments `attempts`. In my `poll`, a due in-flight message at `maxAttempts` is dead-lettered with reason `ack-timeout` instead of being redelivered. Without counting timeouts as attempts, a process-killing message would loop forever, crash-restarting every consumer that picks up the partition. Persist the attempt count in the broker, not the consumer, for exactly this reason.',
        },
        {
          q: 'Your retry delay is exponential: 1s, 2s, 4s, 8s, 16s. Why add jitter in an in-memory system?',
          a: 'If a downstream outage fails 5,000 messages at the same moment, they all become due at exactly t+1s, t+3s, t+7s… and hit the recovering dependency in synchronized waves. Full jitter (`random(0, base × 2^n)`) spreads them out. In-memory vs distributed does not matter: the thundering herd is against the downstream, not the queue.',
        },
      ],
      pitfalls: [
        'Retrying in a tight loop inside the handler.',
        'Treating validation errors as retryable.',
        'Saying "just set in-flight to 1" without naming the head-of-line cost.',
        'Dead-lettering E but then applying its followers out of order.',
      ],
    },
    {
      id: 'lld-cases-2-iq-06',
      difficulty: 'hard',
      question:
        'Your in-memory broker runs inside a NestJS service. During a sale, producers publish 8K msgs/s, one consumer group drains at 3K/s, and the heap climbs until the pod restarts, losing everything. Design backpressure into the classes: what does publish() do when the system is full, and who decides?',
      whatInterviewerLooksFor: [
        'Makes the overflow behaviour an explicit, per-topic policy',
        'Bounds memory by bytes, not just message count',
        'Distinguishes producer-side and consumer-side backpressure',
        'Connects backpressure to the HTTP edge (429/503)',
        'Considers which data may be dropped',
      ],
      modelAnswer: `**Principle:** an unbounded in-memory queue just turns overload into an OOM crash, so every buffer gets a bound and a named policy.

**Bounds:** each partition has \`maxBytes\` (track \`Buffer.byteLength\` of the serialized payload) and \`maxMessages\`; the broker has a global byte budget (e.g. 30% of heap). The 8K − 3K = 5K msgs/s surplus at 2 KB fills 10 MB/s, so a 600 MB budget lasts about a minute. That is the decision window.

**\`OverflowPolicy\` Strategy per topic:**
- \`Reject\`: \`publish\` throws \`TopicFullError\`. The HTTP layer maps it to 503 + \`Retry-After\`, so the backpressure reaches the real client. Right for orders and payments (never silently drop).
- \`Block\`: \`publish\` returns a promise that resolves when space frees (a waiters queue, with a timeout). Right for internal producers that can slow down. Cap the number of waiters, or the waiters themselves leak memory.
- \`DropOldest\` / \`Sample\`: right for telemetry and analytics, with a dropped-messages counter.

**Consumer side:** pull with \`maxInFlight\` credit means consumers never receive more than they can handle. But here the consumer is *too slow*: add consumers (up to the partition count), batch the downstream calls, or shed lower-priority work.

**Retention interaction:** truncation is bounded by the slowest group's committed offset, so one slow group pins memory for everyone. Policy: groups declare \`critical: true/false\`; a non-critical group that falls behind the byte cap is moved forward (it loses messages, and an alert fires) instead of blocking critical producers.

**Durability:** the restart lost everything because the log is only in memory. Either accept that (document it: in-memory = best effort) or put a \`LogStore\` port behind partitions (append-only file, or Redis Streams / Kafka in production).`,
      followUps: [
        {
          q: 'With the Block policy, how do you implement "wait until space frees" in Node without polling?',
          a: 'Each partition keeps a FIFO of `{resolve, reject, bytes, timer}` waiters. `publish` returns `new Promise(...)` that is pushed into it when full. Whenever `truncateBefore` (compaction after commits) frees bytes, wake waiters in order while their bytes fit. Each waiter has a `setTimeout` that rejects with `PublishTimeoutError` and removes itself. In Java this is a `ReentrantLock` with a `notFull` `Condition` (`awaitNanos`), exactly how `ArrayBlockingQueue.put/offer(timeout)` works.',
        },
        {
          q: 'Why bound by bytes and not just message count?',
          a: 'Sizes vary by orders of magnitude: a 200 B click event and a 900 KB cart snapshot count the same. A cap of 100K messages can be 20 MB or 90 GB. V8 also stores strings and objects with overhead (roughly 2× the JSON size for parsed objects), so budget on serialized bytes × an overhead factor. Store payloads as Buffers if memory is tight.',
        },
      ],
      pitfalls: [
        'An unbounded array per topic.',
        'Dropping messages silently with no metric.',
        'Blocking without a timeout.',
        'Assuming more consumers always helps (they cannot exceed the partition count).',
      ],
    },
    {
      id: 'lld-cases-2-iq-07',
      difficulty: 'hard',
      question:
        'Build an in-process task scheduler library: submit a task to run at a time or at a fixed interval, configurable worker count, priorities, retries and cancellation. How do you avoid creating one timer per task, and how is a recurring task prevented from overlapping itself?',
      context:
        'Reported in Uber machine-coding rounds (LeetCode Discuss): an in-memory scheduler supporting run-at and fixed-interval tasks with configurable worker threads, judged on modularity and patterns.',
      whatInterviewerLooksFor: [
        'Min-heap keyed by run time with a single re-armable timer',
        'Separate ordering by priority once due',
        'Bounded worker pool',
        'Recurrence via a Schedule strategy and enqueue-after-settle',
        'Cancellation semantics for pending vs running',
      ],
      modelAnswer: `**Structures**
- **Due heap** ordered by \`(runAt, seq)\`. \`seq\` breaks ties FIFO, so equal-time tasks are stable.
- **One timer**, armed for the heap top: \`setTimeout(tick, top.runAt − now)\`. When a submit lands earlier than the armed time, clear and re-arm. With 1M pending tasks that is one timer, not 1M \`Timeout\` objects (each about 100+ B plus timer-list overhead).
- **Ready heap** ordered by \`(priority, seq)\`: once tasks are due, priority decides who runs first when workers are scarce.
- **Worker pool:** \`active < K\` gate; every completion calls \`dispatch()\` again. For CPU-heavy tasks, the workers are a worker_threads pool (Piscina-style); for I/O tasks, async slots are enough.

**Recurrence: a Strategy.** \`Schedule.nextAfter(t)\` with \`OneOff\`, \`FixedRate(start, every)\` (anchored, no drift) and \`Cron\`. The scheduler never knows the kind.

**No self-overlap:** occurrence N+1 is enqueued only when N settles. If N overruns, N+1 runs immediately after (if within a grace period) or is skipped per the misfire policy. Overlap is opt-in via \`concurrencyPolicy\`.

**Retries:** \`RetryPolicy\` Strategy; a failure re-enqueues at \`now + delay(attempt)\` with the same \`scheduledAt\`, so the handler's \`runKey\` is stable for idempotency.

**Cancellation:** pending → bump \`task.version\` (heap entries carry a version and stale ones are skipped on pop, O(1) cancel). Running → \`AbortController.abort()\`, which is cooperative: the handler must honour \`signal\`.

**Complexity:** submit O(log n), each fire O(log n), cancel O(1). Memory is about one heap entry per pending occurrence.`,
      followUps: [
        {
          q: 'setTimeout in Node has a maximum delay. What happens if the next task is 40 days away?',
          a: 'Delays above 2^31−1 ms (about 24.8 days) overflow. Node warns and fires after 1 ms, which would spin the loop. Clamp the armed delay to, say, `min(delay, 1 hour)`. When the timer fires early, `tick()` finds nothing due and simply re-arms. Clamping also limits damage from clock changes, since the scheduler re-reads the clock at least hourly.',
        },
        {
          q: 'How would this look in Java, and why not just use ScheduledThreadPoolExecutor?',
          a: 'STPE already gives a delay queue plus a pool: `schedule`, `scheduleAtFixedRate` (no overlap, the next run waits), and `Future.cancel(true)` for interruption. What it lacks: priorities among due tasks, retry with backoff, cron, misfire policies and persistence. You would wrap it or build a `DelayQueue<Entry>` dispatcher thread feeding a `ThreadPoolExecutor` whose `PriorityBlockingQueue` orders by priority. Say this explicitly; interviewers want to know you know the library.',
        },
        {
          q: 'A teammate wants task priority to also pre-empt tasks that are already running. Your view?',
          a: 'Avoid it. Pre-emption in Node means aborting a running handler (cooperative, lossy) and re-queueing it, which makes every task responsible for safe interruption and causes priority-inversion debates. Use reserved capacity instead: K workers split into lanes (e.g. 2 slots reserved for priority ≤ 1), so urgent work never waits behind a full pool of batch jobs. Lanes are simple, predictable, and easy to explain in a review.',
        },
      ],
      pitfalls: [
        'One setTimeout or setInterval per task.',
        'Scanning the whole task list every second.',
        'setInterval for recurring async tasks (overlap and drift).',
        'Claiming abort() kills a running promise.',
      ],
    },
    {
      id: 'lld-cases-2-iq-08',
      difficulty: 'expert',
      question:
        'Your scheduler pod was down from 01:50 to 02:40 during a node drain. It owns an "every 15 minutes: sync inventory to marketplace" job, a "02:00 daily: generate payout file" job and a "02:30: send good-night push" job. What should happen to each when it comes back, and what did your design need to persist for that to be possible?',
      context: 'Single scheduler instance, tasks loaded from Postgres at boot.',
      whatInterviewerLooksFor: [
        'Persisting lastScheduledAt per task, not just the spec',
        'Per-task misfire policy instead of one global rule',
        'Idempotency keys based on the scheduled time',
        'Handling a run that was mid-flight at shutdown',
        'Grace windows and catch-up caps',
      ],
      modelAnswer: `**What must be persisted:** the spec (schedule, policy) **and** per task \`lastScheduledAt\`: the scheduled time of the last occurrence that *settled*. Updated in \`onSettled\`. Also a \`runs\` table row per attempt (\`runKey = taskId@scheduledAt\`, status), so a run that was mid-flight at shutdown is visible as \`RUNNING\` with no completion.

**On boot:** for each task, \`next = schedule.nextAfter(lastScheduledAt)\`. If \`next < now − grace\`, it is a misfire, and the task's **policy** decides:
- **Inventory sync (every 15 min), fire-once / coalesce:** occurrences at 02:00, 02:15 and 02:30 were missed. Running three syncs back to back is pointless because the latest state is all that matters. Run **once now** with \`scheduledAt = 02:30\` (the latest missed slot), then resume at 02:45.
- **Payout file at 02:00, fire-once and must not duplicate:** it is business-critical, so it must run late rather than never. Before running, check the \`runs\` table for \`payout@02:00\`. If a row is \`RUNNING\` from before the crash, the job may have partially run: the handler must be idempotent on \`runKey\` (an upsert of the file record, the bank API idempotency key = runKey), and then rerunning is safe.
- **Good-night push at 02:30, skip (DO_NOTHING):** a "good night" at 02:41 is worse than none. Skip it and schedule tomorrow's.

**Design points:**
- A **misfire policy per task** (Quartz has FIRE_ONCE_NOW and DO_NOTHING), with a grace window (e.g. 60 s late still counts as on time).
- A **catch-up cap** if \`fire-all\` exists at all, e.g. at most 3 backfill runs.
- **Mid-flight runs:** at boot, mark stale \`RUNNING\` rows as \`ABANDONED\` and treat them as failed attempts (retry under the same runKey).
- **Single dispatcher:** on reboot during a rolling deploy, the old and new pods could overlap. Use leader election or \`SELECT … FOR UPDATE SKIP LOCKED\` on the runs row, and the runKey uniqueness makes double fire harmless.`,
      followUps: [
        {
          q: 'Why persist lastScheduledAt and not lastRunFinishedAt?',
          a: 'The schedule is defined in scheduled time. `nextAfter(lastScheduledAt)` gives the exact next slot regardless of how long a run took or when it finished. With finish time, a run scheduled at 02:00 that finished at 02:16 would make `nextAfter(02:16)` skip the 02:15 slot, and the runKey would no longer line up with the slot, breaking idempotency. Store finish time too, but for observability only.',
        },
        {
          q: 'The daily job is "02:00 Asia/Kolkata" and you later expand to a region with DST. What breaks?',
          a: 'On spring-forward, 02:30 local time may not exist; on fall-back, 01:30 happens twice. A UTC-only cron sidesteps this, but business wants local times. The Cron strategy needs a timezone (e.g. Luxon/Temporal) and explicit rules: a non-existent time runs at the next valid minute; for a repeated hour, run once (the first occurrence). Because runKey uses the UTC instant, the duplicate local hour produces two different keys, so dedupe on the local-date + job id for daily jobs.',
        },
      ],
      pitfalls: [
        'Persisting only the job definition, so the scheduler cannot know what was missed.',
        'Firing all missed occurrences for every job.',
        'Ignoring runs that were in flight during shutdown.',
        'One global misfire rule for all tasks.',
      ],
    },
    {
      id: 'lld-cases-2-iq-09',
      difficulty: 'medium',
      question:
        'Rapid-fire on your scheduler: a user cancels a reminder that is (a) still waiting in the heap and (b) currently executing its HTTP call. What exactly happens in each case, and what does cancel() return?',
      whatInterviewerLooksFor: [
        'Lazy deletion with versioning, with O(1) cost and its memory trade-off',
        'Cooperative cancellation via AbortSignal',
        'Clear semantics for return values and idempotency',
        'Handles cancel-then-resubmit correctly',
      ],
      modelAnswer: `**(a) Waiting in the heap.** Finding an arbitrary element in a binary heap is O(n), so do not remove it. \`cancel(id)\` sets \`task.cancelled = true\` and increments \`task.version\`. Heap entries carry the version they were created with; when one is popped, \`entry.version !== task.version\` means stale, and it is skipped. Cancel is O(1). The stale entry occupies memory until it reaches the top, so if cancellations dominate (reminders often get cancelled), rebuild the heap when stale entries exceed about 50%: an O(n) heapify. An indexed heap (position map) is the alternative and supports O(log n) removal and reschedule.

**(b) Executing.** \`cancel\` calls \`task.running.abort()\`. The handler received \`ctx.signal\` and passed it to \`fetch(url, { signal })\`, so the HTTP request is aborted and the promise rejects with \`AbortError\`. The run's catch sees \`task.cancelled\` and **does not retry or reschedule**. If the handler ignores the signal, the call completes, but no next occurrence is scheduled. Also, the remote side may already have processed it: cancel is "best effort for in-flight work", and you should say so.

**Return value:** \`true\` if this call changed state, \`false\` if the task was unknown or already cancelled (idempotent, safe to retry from an API). A richer API returns \`'cancelled-pending' | 'abort-requested' | 'not-found'\`.

**Gotcha: cancel then resubmit with the same id.** The new task must start with a version *higher* than the cancelled one, or the old heap entries (version 0) match the new task (version 0) and the cancelled reminder fires.`,
      followUps: [
        {
          q: 'What if the handler is CPU-bound (image resize) and never awaits, so the signal is never checked?',
          a: 'An AbortSignal cannot interrupt synchronous JavaScript; the event loop is busy. Run CPU-bound tasks in worker_threads: cancel then calls `worker.terminate()`, which stops it hard (any partial output must be discarded, so write to a temp location and rename on success). Or chunk the work and check `signal.aborted` between chunks. In Java the equivalent is `Future.cancel(true)`, which interrupts the thread, and the code must check `Thread.interrupted()`.',
        },
        {
          q: 'Product wants "snooze": move a pending reminder from 10:00 to 10:15. How with your structure?',
          a: 'Reschedule = bump the version and push a new entry with the new runAt; the old entry becomes stale. Same O(log n) cost as a submit, with no search. If the new time is earlier than the armed timer, re-arm. Persist the new time first, so a crash between the two does not resurrect 10:00. With an indexed heap you could decrease or increase the key in place, but versioning is simpler to get right in 90 minutes.',
        },
      ],
      pitfalls: [
        'Calling heap.remove(id) with a linear search and calling it O(log n).',
        'Believing abort() stops a running function.',
        'Letting a cancelled task\'s catch block schedule a retry.',
      ],
    },
    {
      id: 'lld-cases-2-iq-10',
      difficulty: 'hard',
      question:
        'Machine-coding round, 90 minutes: build Snake & Ladder. Any number of players, configurable board, snakes and ladders from input, and the interviewer warns that "new kinds of cells will be added later". Present your class design and explain how a reviewer verifies it works without random dice ruining the demo.',
      context:
        'Reported repeatedly in machine-coding rounds (LeetCode Discuss: Flipkart, PhonePe, Meesho SDE-2, Gameberry Labs 2026). PhonePe\'s version stressed adding new obstacles and supporting any number of players.',
      whatInterviewerLooksFor: [
        'Polymorphic cell or jump abstraction rather than type checks',
        'Board validation at construction',
        'Dice injected for determinism',
        'Turn management that survives players finishing',
        'Domain free of console I/O, with a driver',
      ],
      modelAnswer: `**Entities:** \`Game\`, \`Board\`, \`Jump\` (abstract \`from\`/\`to\`/\`isValid\`) with \`Snake\` and \`Ladder\`, \`Player\`, \`Dice\` (interface), \`Rules\` (overshoot, sixes, play-until), \`GameEvent\` + listeners.

**Extensibility for new cells.** The board stores \`Map<cell, Jump>\` and asks only "where does this take me?". A new kind is a subclass: a \`Crocodile\` (back 5) overrides the destination as a function of \`from\`. A \`Mine\` (lose the next turn) needs more than a destination, so I would generalize to \`CellEffect.apply(ctx)\`, which can move the player or set \`skipTurns\`. That is the one extension point I would name in the review.

**Validation in \`Board\`'s constructor:** snakes go down and ladders go up; nothing on cell 1 or N; one effect per cell; no effect lands on another effect's start (no chains, no cycles). The input "ladder 5→20, snake 20→5" fails at startup with a clear error instead of hanging mid-game.

**Turns:** a queue of players: current = front, rotate = shift + push, a winner is removed. Rules: a six gives an extra roll; three sixes forfeit and undo the run; overshoot means stay (configurable bounce). \`playUntil: 'first-winner' | 'last-two'\` gives ranks.

**Determinism:** \`Dice\` is injected: \`ScriptedDice([4, 6, 2, 1])\` for the demo and tests, \`RandomDice(count, faces, rng)\` for real play. The driver script shows a ladder climb, a snake bite, an extra turn on six, a three-sixes forfeit, overshoot and a win, each in a few rolls. The reviewer can read the expected output.

**Hygiene:** \`Game\` emits events; a \`ConsolePrinter\` listener prints "Alice rolled 4 and moved from 2 to 6". Errors are typed (\`InvalidBoardError\`, \`NotYourTurnError\`). Each class is under about 60 lines.

**Time plan:** entities and interfaces by minute 20, a scripted game running by minute 50, rules and validation by 70, then polish.`,
      followUps: [
        {
          q: 'Add a rule: a player must roll exactly a 6 to enter the board. Where does it go without touching existing rules?',
          a: 'Make movement a chain of `MoveRule`s, each `apply(ctx): ctx | Skip`. Add `EntryRule`: if `ctx.from === 0` and the roll is not 6, return Skip (the turn passes); on a 6, set `to = 1`, not 6, depending on the house rule. Insert it first in the chain via the rules factory. Overshoot, sixes and jumps stay unchanged. If you modelled rules as booleans on a config object, this is the moment to explain the migration to a chain.',
        },
        {
          q: 'How do you test that a random game always terminates?',
          a: 'Property test: for N seeded runs (e.g. 1,000 seeds × random valid boards from a generator), play to completion with a turn cap (say 100,000) and assert the game finishes before the cap. Validation guarantees no infinite chains, but a board with enough snakes could make games extremely long; the cap catches pathological configs. Seeded RNG makes any failure reproducible. Also assert invariants every turn: a position in [0, N], exactly one current player, and winners never re-enter the queue.',
        },
      ],
      pitfalls: [
        'An int array with if-else for snakes and ladders.',
        'Math.random() inside Game.',
        'console.log inside domain classes.',
        'index = (index + 1) % n that breaks when a player finishes.',
      ],
    },
    {
      id: 'lld-cases-2-iq-11',
      difficulty: 'expert',
      question:
        'You have finished Snake & Ladder. The interviewer says: "Same design, now it is chess." Which of your classes survive, what is new, and how do you implement move legality so that pins and check are handled without special-casing every piece?',
      whatInterviewerLooksFor: [
        'Identifies the reusable parts (game loop, turns, events, concurrency)',
        'Polymorphic piece move generation',
        'Pseudo-legal moves plus a king-safety filter',
        'Special moves modelled as Move objects (Command) with undo',
        'End-state evaluation separated from moves',
      ],
      modelAnswer: `**What survives:** \`Game\` as the turn manager (a 2-player queue), \`expectedTurn\` optimistic concurrency, Observer events, the driver, injected dependencies, and the Board-as-composition idea. What dies: \`Dice\`, \`Jump\`, and \`Rules\` as they stand.

**New model**
- \`Piece\` (abstract): \`color\`, \`kind\`, \`candidates(board, from): Move[]\`. Rook, bishop and queen share a \`slide(dirs)\` helper (rays stop at the first piece; capture if it is the enemy's). Knight and king use fixed offsets. The pawn is the awkward one: direction by colour, a double step from the start rank, diagonal captures, en passant and promotion.
- \`Move\` (Command): \`from\`, \`to\`, plus subclasses \`Castle\`, \`EnPassant\`, \`Promotion\`, each with \`apply(position)\` and \`undo\`. Undo gives takebacks and is required for any engine search.
- \`Position\`: board + side to move + castling rights + en-passant square + half-move clock. Preferably immutable: \`apply(move)\` returns a new Position, which makes legality checking trivial.

**Legality in one rule.** \`legal = piece.candidates(...)\` filtered by "after applying the move, my king is not attacked". A **pinned** bishop's move exposes the king, so it is filtered. Moves while **in check** that do not resolve it are filtered. The king walking into check is filtered. No per-piece special cases. Castling adds "not in check, and the squares passed through are not attacked", which lives in the \`Castle\` move's precondition.

**End states:** a \`GameStatusEvaluator\`: no legal moves + in check = checkmate; no legal moves + not in check = stalemate; 50-move rule; threefold repetition (hash positions with Zobrist keys).

**Cost:** the naive attack check scans all enemy pieces for each candidate (about 35 moves × 16 pieces), fine for a game server. Engines use bitboards; mention them, do not build them.`,
      followUps: [
        {
          q: 'Why make Position immutable instead of mutating the board and undoing?',
          a: 'An immutable `apply(move)` makes the legality filter side-effect free: you build the hypothetical position, ask whether the king is attacked, and throw it away. There is no risk of a forgotten undo corrupting the real board. The cost is allocation (64 squares per candidate, about 35 per turn, trivial for a server). Engines go the other way (make/unmake on mutable bitboards) for speed, but for an LLD round correctness and clarity win.',
        },
        {
          q: 'How do you add a time control (10 + 5 blitz) to the turn manager?',
          a: 'Add a `ChessClock` component: per-player remaining ms plus increment, started on a move and switched on the next move, using the injected Clock for testability. A flag-fall is detected either lazily (when the move arrives, compute elapsed; if remaining ≤ 0, the player lost on time) or by a scheduler timer for the active player (re-armed on every move) to push "flag" events. Server time is authoritative; clients render a local countdown only.',
        },
      ],
      pitfalls: [
        'Writing isPinned() and isInCheck() as separate special cases per piece.',
        'Putting all move rules in a giant switch on piece type in Game.',
        'Forgetting castling and en-passant state in the position.',
        'Keeping Dice in the design.',
      ],
    },
    {
      id: 'lld-cases-2-iq-12',
      difficulty: 'hard',
      question:
        'Your Snake & Ladder service goes live: 50K concurrent rooms across 6 Node pods, behind a WebSocket gateway. Players report double moves when they tap twice, and occasionally two players move in the same turn after a reconnect. Fix it at the design level.',
      whatInterviewerLooksFor: [
        'Single owner per game (routing or locking)',
        'Optimistic concurrency with a turn number or version',
        'Server-authoritative dice and state',
        'Reconnect handling with state resync',
        'Recognizes a Node single-thread guarantee is per process only',
      ],
      modelAnswer: `**Why it happens:** (1) a double tap sends two "roll" messages and both are applied; (2) after a reconnect, the client lands on a *different pod*, which loaded the game from Redis. Two pods now hold their own copy of the game, so two "current players" exist.

**1. One owner per game.** Route by \`gameId\`: the gateway consistent-hashes on gameId to a pod (or a sticky room). Within that pod, \`Game.play()\` is synchronous, so it is atomic on the event loop. Other pods forward commands to the owner (via Redis pub/sub or the gateway). When an owner dies, ownership moves with a lease (Redis \`SET owner:{gameId} pod NX PX 10000\`, renewed). Include a fencing check: the new owner reloads state, and writes carry the lease version.

**2. Optimistic concurrency on every command.** The client sends \`{ action: 'roll', expectedTurn: 41 }\`. The game rejects it if \`turnNo !== 41\` and then increments. The second tap carries 41 again and gets a \`stale turn\` error, which the client ignores. The persisted state uses a compare-and-set on \`turnNo\` (Lua: \`if HGET turn == ARGV then apply\`), so a stale pod cannot overwrite a newer state.

**3. Server-authoritative dice.** The server rolls (crypto RNG, or a seeded RNG with the seed committed for audit). The client never sends a dice value.

**4. Reconnect.** On reconnect the client sends \`lastSeenEventSeq\`; the owner replays events after it from the game's event log (it is already an Observer stream), or sends a full snapshot if too far behind. The UI re-renders from server state, never from its own predictions.

**Sizing:** 50K rooms × about 2 KB of state ≈ 100 MB, split across 6 pods. Memory is not the problem; ownership is.`,
      followUps: [
        {
          q: 'A player disconnects and never returns. How does the turn system cope?',
          a: 'Give each turn a deadline: when a player becomes current, the owner schedules a timeout (one timer per active game, or the scheduler from this topic with one heap for all games). If it fires before a move, the server auto-rolls or skips, and after N consecutive timeouts marks the player as abandoned and removes them from the queue. The timeout carries the `turnNo` it was armed for, so a late timer after a real move is a no-op. That is the same version trick used for cancellation.',
        },
        {
          q: 'Why not just put a Redis lock around every move instead of single ownership?',
          a: 'A lock works, but it adds about 1–2 ms and a network round trip per move, and a lock whose TTL expires mid-move can let two writers through unless every write is fenced. With an owner, moves are local function calls and Redis is only for persistence and failover. A lock per move is fine at small scale; say that it still needs the `turnNo` CAS on write, because a lock alone does not prevent a stale pod\'s late write.',
        },
      ],
      pitfalls: [
        'Relying on Node being single-threaded across 6 pods.',
        'Debouncing on the client as the only fix.',
        'Trusting the client-reported dice value.',
        'A global lock across all games.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'lld-cases-2-boe-1',
      question:
        'Your in-process limiter runs on each of 12 API pods. Each pod sees about 3M distinct keys per hour across three rules: per-API-key token bucket, per-IP token bucket and a per-IP sliding log of 100 req/min on search. Estimate the heap the limiter needs per pod, and decide whether the sliding log is affordable.',
      assumptions: [
        'Key mix per pod per hour: 1M API keys, 1M IPs (for the bucket), 1M IPs hitting search',
        'V8 cost per Map entry with a short string key (~40 chars) ≈ 120 B (entry + string header + chars)',
        'Token bucket state object {tokens, last} ≈ 40 B',
        'Sliding log: array of up to 100 doubles ≈ 16 B header + 8 B × n; busy search IPs average 60 entries',
        'Idle sweep runs every 60 s, so roughly 25% of hourly keys are live at once',
      ],
      steps: [
        { label: 'Live keys per rule', calc: '1M per hour × 25% live ≈ 250K live keys per rule' },
        { label: 'Token bucket rules', calc: '2 rules × 250K × (120 + 40) B ≈ 80 MB' },
        { label: 'Sliding log state per key', calc: '16 + 60 × 8 ≈ 500 B, plus 120 B entry ≈ 620 B' },
        { label: 'Sliding log rule', calc: '250K × 620 B ≈ 155 MB' },
        { label: 'Total per pod', calc: '80 + 155 ≈ 235 MB; worst case with no sweep (1M live per rule) ≈ 4 × 235 ≈ 940 MB' },
        { label: 'Swap log for a sliding-window counter', calc: 'state = 2 counters + window id ≈ 40 B → 250K × 160 B ≈ 40 MB instead of 155 MB' },
      ],
      answer:
        'About 235 MB per pod with the idle sweep working, and nearly 1 GB without it. The sliding log alone is two thirds of that; a sliding-window counter cuts the search rule from about 155 MB to about 40 MB at the cost of approximate counts.',
      insight:
        'Memory is dominated by per-key state × live cardinality, so the two levers are the idle sweep (lossless for buckets) and choosing an algorithm whose state is O(1) per key. Reserve sliding logs for tiny limits (OTP, login) where exactness matters and n is under about 10. Set the LRU cap from this number (e.g. 1.5M entries) and alert on evictions.',
      followUps: [
        {
          q: 'A bot farm triples distinct IPs (to 3M/hour) without raising request volume. What breaks first?',
          a: 'The per-IP rules\' live cardinality goes to about 750K each. The sliding log alone becomes 750K × 620 B ≈ 465 MB, and the total exceeds about 700 MB. On a 1.5 GB heap, GC pauses grow (major GCs scanning 2M+ objects take tens of ms), so p99 latency suffers before OOM. Mitigation: aggregate per-IP limits to /24 subnets for anonymous traffic (cardinality drops roughly 100×), and move the search rule to a counter.',
        },
        {
          q: 'Would moving all state to one Redis cluster be cheaper overall?',
          a: 'Total memory does not shrink: Redis stores roughly the same per-key state (a hash with 2 fields ≈ 100 B with listpack encoding), once instead of 12 times, since pods no longer duplicate the hot keys. So 12 × 235 MB ≈ 2.8 GB of duplicated heap becomes about 300–500 MB in Redis, and the limit becomes globally accurate. The cost is about 0.5 ms per check plus a dependency, so keep a small local pre-filter for abusive IPs.',
        },
      ],
    },
    {
      id: 'lld-cases-2-boe-2',
      question:
        'An in-memory broker inside a Node service ingests 6K msgs/s average (peak 15K/s for 10 minutes during a flash sale), 1.5 KB per message. Three consumer groups read it; the slowest (analytics) drains 5K msgs/s. Retention is "until every group commits". Will a 2 GB heap survive the peak, and what bound and policy do you set?',
      assumptions: [
        'Stored message in V8 ≈ 2× serialized size (object + string overhead) ≈ 3 KB',
        'The fast groups keep up even at peak',
        'Peak lasts 10 minutes, then traffic returns to 6K/s',
        'About 1.2 GB of the 2 GB heap can be given to the broker',
      ],
      steps: [
        { label: 'Surplus vs slowest group at peak', calc: '15K − 5K = 10K msgs/s accumulate' },
        { label: 'Backlog after 10 min', calc: '10K × 600 s = 6M messages' },
        { label: 'Memory of backlog', calc: '6M × 3 KB ≈ 18 GB' },
        { label: 'Time to exhaust the budget', calc: '1.2 GB ÷ (10K × 3 KB/s = 30 MB/s) ≈ 40 s' },
        { label: 'Drain time after peak', calc: 'analytics surplus = 5K − 6K = −1K/s, so it never catches up at 6K/s average' },
      ],
      answer:
        'No. The heap is exhausted about 40 s into the peak, and even at average load the analytics group (5K/s vs 6K/s in) falls behind forever. The bound must be about 1.2 GB by bytes, and the slowest group must not pin retention.',
      insight:
        'In-memory retention is bounded by the slowest consumer, so a non-critical group must be allowed to lose data (a moved cursor plus an alert) or be split out to a durable log. Critical topics use the Reject policy so the producer edge returns 503/429. The real fix for analytics is batching or more partitions and consumers so it drains at least 7–8K/s, or reading from Kafka instead of an in-memory broker.',
      followUps: [
        {
          q: 'Analytics is scaled to 9K msgs/s. How long does the 10-minute peak backlog take to drain, and how much memory does it hold at its maximum?',
          a: 'During the peak the backlog grows at 15K − 9K = 6K/s, so it reaches 6K × 600 = 3.6M messages × 3 KB ≈ 10.8 GB. Still far over the 1.2 GB budget, so the cap must be enforced anyway. If an overflow policy keeps it within budget, draining the capped backlog after the peak runs at 9K − 6K = 3K/s: a 400K-message (1.2 GB) backlog clears in about 133 s. The peak still needs reject or spill-to-disk for about 9 of the 10 minutes.',
        },
      ],
    },
    {
      id: 'lld-cases-2-boe-3',
      question:
        'A single-process scheduler holds reminders for an app: 4M pending one-off reminders, about 2,000 fires/s at the 9:00 am peak, each handler making an HTTP call with mean latency 250 ms (p99 1.2 s). Size the worker pool, the heap cost per operation and the memory, and say whether one Node process can do it.',
      assumptions: [
        'Heap entry (runAt, priority, seq, taskId, version, scheduledAt, attempt) ≈ 120 B; Task + spec + closure ≈ 400 B',
        'Binary heap ops ≈ log2(n) comparisons',
        'Downstream allows the needed concurrency; handlers are I/O-bound',
        'Peak burst lasts about 5 minutes',
      ],
      steps: [
        { label: 'Concurrency (Little\'s law)', calc: '2,000/s × 0.25 s = 500 in flight on average; size for p99-ish: 2,000 × 1.2 s ≈ 2,400 worst case' },
        { label: 'Heap cost', calc: 'log2(4M) ≈ 22 comparisons per push/pop; 2 heaps × 2,000/s × 22 ≈ 88K comparisons/s, which is trivial' },
        { label: 'Memory', calc: '4M × (120 + 400) B ≈ 2.1 GB' },
        { label: 'Event-loop budget for fires', calc: '2,000 fires/s × ~50 µs of JS each (heap, bookkeeping, request setup) ≈ 100 ms CPU per second, about 10% of a core' },
      ],
      answer:
        'CPU and heap operations are fine (about 10% of a core), and a pool of about 600–1,000 async slots covers the average with headroom for latency spikes. Memory (about 2.1 GB of mostly-idle reminders) is the problem: it exceeds a typical Node heap and makes every major GC slow.',
      insight:
        'Do not keep far-future work in memory. Persist reminders in Postgres (indexed by run_at) and keep only a near-term window in the heap (e.g. the next 10 minutes, about 1.2M at peak rate, or far fewer off-peak), refilled by a loader every minute. This hybrid is what turns the LLD scheduler into the HLD one, and it makes restarts cheap because the heap is just a cache.',
      followUps: [
        {
          q: 'The downstream push provider caps you at 1,000 concurrent requests. What happens at 9:00, and what do you change?',
          a: 'With 1,000 slots and a 0.25 s mean, throughput caps at 1,000 ÷ 0.25 = 4,000/s, which is enough on average. But when latency spikes to 1.2 s, capacity falls to about 830/s, below the 2,000/s arrival rate, and the ready heap grows by about 1,170/s, so reminders arrive late. Set pool size ≤ the provider cap and make lateness explicit: let the ready heap order by (priority, runAt), shed or batch low-priority reminders, and expose a "lateness p99" metric. Batch APIs (500 tokens per call) raise effective throughput most.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'lld-cases-2-mcq-01',
      difficulty: 'medium',
      question:
        'Minute 70 of a scheduler machine-coding round, and your heap, worker pool and retries work. The interviewer adds a requirement: "task B must only start after task A has succeeded." Which change best fits the remaining 20 minutes and the existing design?',
      options: [
        'Add dependsOn to the spec; hold tasks with unfinished predecessors in a waiting map with a pending count, and release them to the ready heap when the last predecessor succeeds',
        'Rewrite the scheduler as a DAG engine with topological sorting before any task is submitted, replacing the heaps',
        'Set B\'s runAt to A\'s runAt plus A\'s typical duration, so B naturally runs after A finishes',
        'Inside B\'s handler, poll every second until A is marked complete, then continue with B\'s work',
      ],
      correct: [0],
      explanation:
        'In-degree counting (Kahn-style) slots in between "due" and "ready": a due task with pending predecessors waits, and each success decrements its dependents\' counters and releases those that reach zero. The heaps, pool and retries stay untouched. A full DAG-engine rewrite at minute 70 is how rounds end with nothing running. Time-based guessing breaks as soon as A is slow or retries. Polling inside B occupies a worker slot doing nothing and can deadlock the pool when every slot holds a waiting dependent.',
      followUps: [
        {
          q: 'A fails permanently after its retries. What happens to B, and how do you detect a cycle such as A→B→A at submit time?',
          a: 'B can never be released, so mark it (and transitively all its dependents) `UPSTREAM_FAILED` and emit an event, instead of leaving it waiting forever; a manual retry of A re-arms it. For cycles, run a DFS from the new task over `dependsOn` edges when it is submitted; finding the new task again means a cycle, so reject it with an error naming the path. That costs O(V + E) per submit, which is fine at in-memory scale.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-02',
      difficulty: 'hard',
      question:
        'A request matches two rules: per-user (100/min) and per-IP on /login (5/min). After a credential-stuffing burst from one office IP, legitimate users behind that NAT report they are throttled on every endpoint, not just /login. Given this facade, what is the cause?',
      code: {
        language: 'typescript',
        code: `check(req: Ctx): boolean {
  for (const rule of this.rules) {
    const key = rule.keyOf(req);
    if (key === null) continue;
    const bucket = this.store.getOrCreate(rule.id + '|' + key, () => rule.algo.create());
    if (!rule.algo.tryAcquire(bucket, this.clock.now())) return false; // consumes on success
  }
  return true;
}`,
      },
      options: [
        'The per-IP rule is keyed on the NAT IP, so it throttles every endpoint for everyone behind it',
        'getOrCreate is not atomic, so two buckets are created per user and the limit is halved',
        'The loop returns early, so the per-user rule is never evaluated for /login requests',
        'Each attempt is charged to the user bucket before the /login IP rule denies it, so users drain their own 100/min quota',
      ],
      correct: [3],
      explanation:
        'tryAcquire consumes on success, and the user rule runs first. Every /login attempt rejected by the IP rule has already taken a token from that user\'s 100/min bucket, so users who keep retrying login exhaust their general quota and get throttled everywhere. The IP rule only applies to /login (keyOf returns null elsewhere), so it cannot throttle other endpoints. getOrCreate is synchronous here, so it is atomic. The early return happens after the user rule, not before it. Fix: evaluate every rule first, then consume only if all allow.',
      followUps: [
        {
          q: 'You cannot change the algorithm interface (third-party, only tryAcquire). How do you avoid partial charging?',
          a: 'Order rules from most to least restrictive, so the likely denier runs first, and add a compensating `refund(bucket, cost)` when a later rule denies. If the library exposes no refund, wrap each bucket in an adapter that snapshots its state before `tryAcquire` and restores it on a later denial. That is safe because the whole check is synchronous, so nothing can interleave between the charge and the restore.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-03',
      difficulty: 'expert',
      question:
        'A teammate makes the limiter store pluggable and async, to prepare for Redis, while still using the in-memory implementation. Under a load test of 200 concurrent requests for one key with capacity 10, about 60 pass. Why?',
      code: {
        language: 'typescript',
        code: `async check(key: string): Promise<boolean> {
  const s = (await this.store.get(key)) ?? { tokens: 10, last: this.clock.now() };
  refill(s, this.clock.now());
  if (s.tokens < 1) return false;
  s.tokens -= 1;
  await this.store.set(key, { ...s });   // copy, so the store owns its own object
  return true;
}`,
      },
      options: [
        'Node runs these 200 calls on multiple threads, so the token decrement is a data race',
        'The refill function adds tokens on every call, so concurrency only exposes an existing refill bug',
        'Each await yields: many requests read the same snapshot before any set, and each decrements its own copy',
        'The spread copy breaks object identity, so the store returns a stale cached version on get',
      ],
      correct: [2],
      explanation:
        'JavaScript is single-threaded, but every await is a yield point. Requests 1..N each run get, then yield, so they all read the same state with 10 tokens. Each decrements its own copy, and the last set wins. Read-modify-write across awaits is a lost-update race even with no threads. The refill is correct; the problem appears only under concurrency. The copy is not the bug, it just makes the lost update visible. Fix: keep the in-memory path synchronous, or make the store expose an atomic operation (Redis Lua, or a per-key promise chain/mutex).',
      followUps: [
        {
          q: 'How would you make the async in-memory store correct without Redis?',
          a: 'Serialize per key: keep `Map<key, Promise>` and chain each check onto the previous promise for that key (`const p = (locks.get(k) ?? Promise.resolve()).then(run); locks.set(k, p.catch(() => {}))`), deleting the entry when it settles if it is still the tail. Or add `store.update(key, fn)` that runs `fn` synchronously on the stored object, which is atomic on the event loop. The Redis equivalent is one Lua script doing refill + check + decrement.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-04',
      difficulty: 'expert',
      question:
        'Select ALL that apply: your limiter\'s Map must be bounded. Which strategies bound memory WITHOUT ever letting a client exceed its configured limit?',
      options: [
        'Periodically delete token buckets that would have refilled to full capacity by now',
        'Evict the least-recently-used key whenever the map reaches its maximum size',
        'Delete a sliding-log entry once its newest timestamp is older than the window',
        'Delete any key not seen for a fixed 5 seconds, regardless of algorithm and window size',
        'Create state only for identifiers that pass validation; route unknown ones to one shared bucket per IP',
      ],
      correct: [0, 2, 4],
      explanation:
        'A token bucket that is already full behaves exactly like a fresh one, so deleting it is lossless. A sliding log whose timestamps have all expired is equivalent to an empty log. Refusing to create per-key state for invalid identifiers bounds cardinality and still limits them, just more coarsely. LRU eviction can drop a busy key that has spent its tokens, and the client gets a fresh full bucket: a silent fail-open. A fixed 5 s idle timeout is wrong for windows longer than 5 s (for example 5/15 min on OTP), since it resets the count mid-window.',
      followUps: [
        {
          q: 'You keep LRU eviction as a last resort. What signal tells you it is hurting correctness?',
          a: 'Count evictions where `isIdle(state)` was false, i.e. busy keys evicted. Any non-zero rate means some clients got reset limits. Alert on it and raise the cap, or move abusive cardinality to coarser keys. Also track a store size near the cap together with a rising allow rate for keys that were recently denied; that combination is the fingerprint of an attacker rotating keys to force evictions.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-05',
      difficulty: 'hard',
      question:
        'Your token bucket uses Date.now() and computes tokens += (now − last) × rate without clamping. A VM pauses and NTP then steps the clock back 3 seconds. What happens to a key with capacity 20, rate 10/s, currently at 15 tokens?',
      options: [
        'The bucket loses 30 tokens (to −15), so the client is throttled for about 1.6 s even though it did nothing wrong',
        'Nothing; the next call refills normally because elapsed time is recomputed from scratch',
        'The bucket overflows past capacity, because negative elapsed time is treated as unsigned',
        'The clock step throws a RangeError inside Math.min, so every request fails until restart',
      ],
      correct: [0],
      explanation:
        'Elapsed time is −3000 ms, so the refill adds −30 tokens: 15 − 30 = −15. Math.min with the capacity does not guard the lower bound, so the client must wait (15 + 1) ÷ 10 = 1.6 s before a single request is allowed, although it had 15 tokens a moment earlier. JavaScript numbers are signed, so nothing overflows, and nothing throws. Fix: clamp elapsed at 0, never move last backwards, and prefer a monotonic clock (performance.now) for intervals.',
      followUps: [
        {
          q: 'And if the clock jumps forward 10 minutes instead?',
          a: 'Every bucket refills to capacity at once (capped by Math.min), so each client gets one full burst early. That is bounded: at most one extra capacity-worth per key, far less harmful than the backwards case. With a monotonic clock neither happens. If the limiter also emits `Reset` headers as wall-clock epochs, compute those from wall time at response time only, never from bucket state.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-06',
      difficulty: 'hard',
      question:
        'To share one limiter across 4 worker_threads, a developer keeps per-slot token counts in an Int32Array over a SharedArrayBuffer. Under load, a slot with 10 tokens sometimes admits 13 requests. Why?',
      code: {
        language: 'typescript',
        code: `// runs inside each worker; tokens is shared by all 4 workers
const tokens = new Int32Array(sharedBuffer);
export function tryTake(slot: number): boolean {
  if (tokens[slot] > 0) {        // read
    tokens[slot] = tokens[slot] - 1; // write
    return true;
  }
  return false;
}`,
      },
      options: [
        'Int32Array writes are buffered per worker and flushed lazily, so other workers see stale counts',
        'Workers share one event loop, so the read and the write interleave across awaits',
        'The check and the decrement are separate operations, so workers running in parallel can all read 1 and all decrement',
        'SharedArrayBuffer is copied when posted to a worker, so each worker decrements its own copy',
      ],
      correct: [2],
      explanation:
        'worker_threads run truly in parallel on separate cores. Two or more workers can read tokens[slot] === 1 before any of them writes, and each then admits a request: a classic check-then-act race. Shared memory is not copied (that is the point of SharedArrayBuffer), and each worker has its own event loop, so awaits are not the issue here. Atomics give the ordering guarantees that plain typed-array access lacks, but the core bug is the non-atomic read-modify-write. Fix: a compareExchange loop (read v, stop if v <= 0, retry if Atomics.compareExchange(tokens, slot, v, v - 1) !== v).',
      followUps: [
        {
          q: 'Token buckets also need refill based on elapsed time. How do you keep tokens and lastRefill consistent in shared memory?',
          a: 'Two separate slots cannot be updated atomically together. Either pack both into one 64-bit value in a BigInt64Array (e.g. tokens × 1000 in the high bits, a relative ms timestamp in the low bits) and CAS the whole word, or guard the pair with a tiny spinlock or mutex built on `Atomics.compareExchange` + `Atomics.wait`/`notify`. Simpler still: make one worker the owner of each key (hash the key to a worker) and message it, which avoids shared-memory atomics entirely.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-07',
      difficulty: 'expert',
      question:
        'An in-memory consumer group commits offsets like this. Offsets 10–14 are delivered to parallel handlers. 12, 13 and 14 are acked, 10 and 11 are still processing, and the process crashes and restarts from the committed offset. What is the outcome?',
      code: {
        language: 'typescript',
        code: `ack(partition: number, offset: number): void {
  const c = this.cursors[partition];
  c.inflight.delete(offset);
  c.committed = Math.max(c.committed, offset + 1);   // resume point after restart
}`,
      },
      options: [
        'Messages 10 and 11 are redelivered, because they were never removed from the in-flight map',
        'Messages 10–14 are all redelivered, since a crash invalidates every ack in the batch',
        'Nothing is lost or duplicated, because in-flight entries are persisted with the cursor',
        'Messages 10 and 11 are lost: the consumer resumes at 15 and never sees them again',
      ],
      correct: [3],
      explanation:
        'Committing the maximum acked offset + 1 sets committed = 15 even though 10 and 11 never finished. After restart the group resumes at 15, and 10 and 11 are silently skipped: at-most-once behaviour posing as at-least-once. The in-flight map is in memory and lost on a crash, so it cannot cause redelivery. Acks of 12–14 are not invalidated. Correct rule: commit only the contiguous acked prefix (track acked offsets above committed and advance while the next is present). Committed would stay at 10, and the restart replays 10–14 (duplicates, never loss).',
      followUps: [
        {
          q: 'With the contiguous rule, one message (offset 10) hangs forever. What happens to the committed offset and to memory?',
          a: 'Committed is stuck at 10 while acks for 11…N pile up in the `acked` set. That memory grows linearly, and a restart would replay everything since 10. Hence the ack timeout: after `ackTimeoutMs`, offset 10 is redelivered, and after `maxAttempts` it goes to the DLQ and is acked, which lets `committed` jump forward over the whole acked run. Also alert when committed has not advanced in N minutes while lag is above zero.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-08',
      difficulty: 'hard',
      question:
        'Your in-memory queue carries wallet ledger events, keyed by walletId, and they must apply in order per wallet. Consumers run with maxInFlightPerPartition = 8 and exponential-backoff retries. Auditors find "debit applied before the credit that funded it" for wallets whose credit hit a transient DB error. Which change fixes ordering with the least collateral damage?',
      options: [
        'Increase retry attempts so the failed credit eventually succeeds before the debit is processed',
        'Set maxInFlightPerPartition to 1 for the whole topic, so every partition processes strictly one at a time',
        'On failure, park that wallet\'s event and hold all later events for the same wallet until it succeeds or is dead-lettered',
        'Switch the partitioner from key hash to round-robin so retried events go to a less busy partition',
      ],
      correct: [2],
      explanation:
        'Ordering breaks because the debit, behind the credit in the same partition, was dispatched while the credit waited in backoff. Per-key parking blocks only the affected wallet and lets every other wallet in the partition proceed. In-flight = 1 also restores order, but one failing event then stalls every wallet hashed to that partition for the full backoff (head-of-line blocking), so it is correct but expensive. More retries do not change dispatch order. Round-robin destroys per-key ordering entirely.',
      followUps: [
        {
          q: 'The parked credit finally exhausts its retries and goes to the DLQ. What do you do with the wallet\'s three parked debits?',
          a: 'Do not apply them: a debit without its funding credit corrupts the ledger. Dead-letter them too, tagged with the blocking event\'s id (or hold them in a "blocked-by" state) and alert. After the credit is repaired and replayed from the DLQ, replay the followers in their original offset order. Consumers must be idempotent on event id, so a debit that partially applied before the failure does not apply twice.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-09',
      difficulty: 'hard',
      question:
        'Select ALL that apply: which mechanisms are REQUIRED for your in-memory pub/sub to honestly claim at-least-once delivery to a consumer group (while the process stays up)?',
      options: [
        'Redelivery of messages whose ack did not arrive within a timeout',
        'Committing the group offset only over the contiguous prefix of acked messages',
        'Deduplicating messages by id inside the broker before delivery',
        'Counting ack-timeout redeliveries toward max attempts so a crash-looping message eventually leaves',
        'A global lock so only one consumer in the system can poll at a time',
      ],
      correct: [0, 1, 3],
      explanation:
        'At-least-once needs every message to be retried until acknowledged (ack timeout), and the resume point must never pass an unacked message (contiguous commit). Counting timeouts as attempts is required for the guarantee to terminate: otherwise a poison message that kills the consumer cycles forever and blocks progress. Broker-side dedupe concerns duplicates (an exactly-once concern) and cannot prevent consumer-side reprocessing anyway. A global poll lock reduces throughput and contributes nothing to delivery guarantees.',
      followUps: [
        {
          q: 'Given at-least-once, where should deduplication live, and with what key?',
          a: 'In the consumer\'s side effect, ideally in the same transaction: insert the processed message id (topic, partition, offset, or a business event id) into a table with a unique constraint along with the effect, so a duplicate fails the insert and is skipped. Prefer a business id when producers can retry publishes, because a retried publish gets a new offset but keeps the same event id.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-10',
      difficulty: 'expert',
      question:
        'Your broker frees memory with compact(): it truncates each partition below the minimum committed offset across all registered groups. A "recommendations" group was registered during an experiment and its pods were deleted a week ago. What do you observe, and what is the right design fix?',
      options: [
        'Nothing; groups with no members are ignored automatically when computing the minimum',
        'Memory grows without bound, because the abandoned group pins every partition at its last committed offset; groups need liveness or an expiry/retention cap',
        'The remaining groups slow down, because they must re-read the messages that recommendations never acked',
        'compact() throws, because it cannot find members for the abandoned group\'s partitions',
      ],
      correct: [1],
      explanation:
        'The minimum includes every registered group, and a group whose consumers vanished keeps its committed offset forever, so nothing past it is ever truncated: a slow-motion OOM. Membership is not consulted in compact() (that would be the fix, not current behaviour). Other groups have their own cursors and are unaffected in throughput. Nothing throws. Fix: expire groups with no members for X hours (Kafka has offsets.retention.minutes for this), and add a hard size/time cap that moves lagging non-critical groups forward with an alert.',
      followUps: [
        {
          q: 'The abandoned group was actually critical (billing) and its pods were crash-looping. How do you avoid silently expiring it?',
          a: 'Mark groups with a criticality class at registration. Critical groups are never auto-expired or skipped ahead. Instead the broker applies backpressure to producers (Reject policy → 503 upstream) and pages on-call when lag passes a threshold. Non-critical groups get expiry and skip-ahead. The policy must be explicit per group, because "drop data" vs "stop the business" is a product decision, not a broker default.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-11',
      difficulty: 'hard',
      question:
        'A candidate implements pub/sub with a synchronous Observer. In production, an analytics subscriber starts throwing on a malformed field, and a search-indexer subscriber takes 400 ms per message. What happens to an order service that calls publish()?',
      code: {
        language: 'typescript',
        code: `publish(topic: string, msg: Message): void {
  for (const sub of this.subscribers.get(topic) ?? []) {
    sub.onMessage(msg);             // push to each subscriber in order
  }
}`,
      },
      options: [
        'publish() throws on the analytics error, so later subscribers never receive the message, and every publish waits on the indexer\'s 400 ms',
        'Only analytics is affected; the loop isolates subscribers from each other and from the publisher',
        'The throw is swallowed by the event loop, but the indexer latency makes publish() take 400 ms',
        'Nothing changes in publish(), because onMessage runs asynchronously on the microtask queue',
      ],
      correct: [0],
      explanation:
        'The loop calls each subscriber synchronously on the publisher\'s stack. An exception escapes publish(), so the order service sees a failure and the subscribers after analytics miss the message. A 400 ms subscriber makes every publish take at least 400 ms (if it is synchronous work) or blocks the loop. Nothing is swallowed and nothing is deferred to microtasks unless the code does it. Fix: decouple with a buffer per subscription (log + cursor, or a bounded queue) and deliver asynchronously with per-subscriber error handling.',
      followUps: [
        {
          q: 'If you wrap each onMessage in try/catch and call it via queueMicrotask, is the design now sound?',
          a: 'Better isolated, but still unbounded: a slow subscriber accumulates scheduled microtasks or promises with no limit (memory grows, with no backpressure). A thrown error is caught, but then the message is lost: no retry, no DLQ, no ack. You need a per-subscriber buffer with a bound, an ack/retry policy and lag metrics, which is the log-and-cursor design.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-12',
      difficulty: 'hard',
      question:
        'A recurring "settle merchant batches every 60 s" job was implemented as below. During a DB slowdown each settle takes 150 s. What happens?',
      code: {
        language: 'typescript',
        code: `schedule(task: () => Promise<void>, everyMs: number): void {
  setInterval(async () => {
    try { await task(); }
    catch (e) { this.logger.error(e); }
  }, everyMs);
}`,
      },
      options: [
        'setInterval waits for the async callback to finish, so runs are simply delayed to every 150 s',
        'Node detects the pending promise and skips ticks until it resolves, logging a warning',
        'Runs overlap: a new settle starts every 60 s while earlier ones are still running, so 2–3 run concurrently on the same batches',
        'The second tick throws "callback already running" and the interval is cleared',
      ],
      correct: [2],
      explanation:
        'setInterval knows nothing about the promise returned by an async callback. It fires every 60 s regardless, so with 150 s runs there are about 3 concurrent settles on the same data. Without idempotency that means double settlement. Nothing skips, warns or throws. Fix: enqueue the next occurrence only after the current one settles (a single-flight per task), anchor the schedule to its start time, and give each run a runKey for idempotency.',
      followUps: [
        {
          q: 'After the fix, a run takes 150 s on a 60 s schedule. Which occurrences run?',
          a: 'With "next after settle" plus a fixed-rate anchor, when the 0 s run finishes at 150 s, the slots at 60 s and 120 s are in the past. With fire-once misfire handling inside a grace window, one catch-up run starts at 150 s for the latest slot (120 s), then the schedule resumes at 180 s. With skip, it waits for 180 s. Either way there is no overlap. Choose per job: settlement wants catch-up, a heartbeat wants skip.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-13',
      difficulty: 'expert',
      question:
        'Your scheduler cancels by lazy deletion: heap entries carry the task version, and popped entries whose version differs from the task\'s are skipped. A user cancels reminder "r-9" (version 0 → 1, cancelled) and immediately re-creates it with the same id and a later time. The code creates a fresh Task object with version 0. What happens?',
      options: [
        'Only the new reminder fires, because the cancelled Task object was replaced in the map',
        'Neither fires, because the cancelled flag is copied to the new Task by id',
        'The old entry fires once with the new handler, and the new entry is skipped as a duplicate',
        'Both fire: the old heap entry (version 0) now matches the new task\'s version 0 and passes the staleness check',
      ],
      correct: [3],
      explanation:
        'Staleness compares the entry\'s version with the current task\'s version for that id. The old entry was created at version 0, and the new Task also starts at version 0, so the old entry looks current and fires at the original (cancelled) time, using the new task\'s handler. Then the new entry fires too. Replacing the object does not help, because lookup is by id. Fix: continue the version from the previous incarnation (prev.version + 1), or use a globally unique generation (a UUID or global counter) per submission.',
      followUps: [
        {
          q: 'Lazy deletion leaves stale entries in the heap. With 30% of reminders cancelled, how do you stop the heap from growing?',
          a: 'Track a `staleCount` (increment on cancel or reschedule, decrement when a stale entry is popped). When `staleCount > size / 2`, rebuild: filter the live entries and heapify in O(n), which is cheap and amortized over the many O(1) cancels. Alternatively use an indexed heap (a map from task to heap position) for O(log n) real removal, at the cost of more code. For a 90-minute round, versioning plus rebuild is easier to get right.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-14',
      difficulty: 'hard',
      question:
        'Select ALL that apply: the scheduler was down 02:00–03:10. On restart, which misfire handling is appropriate for each job?',
      options: [
        '"Refresh exchange-rate cache every 10 minutes": run once now and resume the normal schedule',
        '"Send 02:30 daily sleep-reminder push": skip it and wait for tomorrow\'s occurrence',
        '"Generate 02:00 daily GST invoice file": run it now, guarded by an idempotency key for the 02:00 slot',
        '"Refresh exchange-rate cache every 10 minutes": run all 7 missed occurrences back to back to keep history consistent',
        '"Generate 02:00 daily GST invoice file": skip it, since late regulatory files are rejected anyway',
      ],
      correct: [0, 1, 2],
      explanation:
        'A cache refresh only needs the latest state, so coalescing the missed runs into one (fire-once) is right; replaying all 7 wastes work and changes nothing. A time-sensitive notification is worse late than never, so skip it. A business-critical daily file must still be produced, and its runKey (job@02:00) makes the late run safe if a partial run happened before the crash. Skipping the invoice file trades a late file for a missing one, which is the worse outcome.',
      followUps: [
        {
          q: 'What exactly must the scheduler have persisted to make these decisions at boot?',
          a: 'Per task: the schedule and misfire policy, plus `lastScheduledAt` (the slot of the last settled occurrence). Per run: a row with `runKey`, status and timestamps. At boot, `nextAfter(lastScheduledAt)` gives the first missed slot; comparing it with `now − grace` detects the misfire. A `RUNNING` row without completion means a run was interrupted, which is the case where idempotency matters most.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-15',
      difficulty: 'expert',
      question:
        'The scheduler retries failed payout runs like this. The payout provider deduplicates on the Idempotency-Key header. After a provider timeout (the payout actually succeeded), what happens on retry?',
      code: {
        language: 'typescript',
        code: `private async run(t: Task, attempt: number): Promise<void> {
  const scheduledAt = this.clock.now();                 // stamp this attempt
  const runKey = t.spec.id + '@' + scheduledAt;
  try {
    await t.spec.handler({ runKey, attempt });          // sends Idempotency-Key: runKey
  } catch {
    if (attempt < 5) this.enqueueAt(t, this.clock.now() + 2 ** attempt * 1000, attempt + 1);
  }
}`,
      },
      options: [
        'Safe: the provider sees the same task id prefix and deduplicates the retry',
        'Double payout: each attempt stamps a new scheduledAt, so the retry carries a different Idempotency-Key',
        'Safe, but only because exponential backoff gives the provider time to finish the first request',
        'The retry is never sent, because attempt is not incremented before the handler runs',
      ],
      correct: [1],
      explanation:
        'The idempotency key must identify the logical occurrence, not the attempt. Because scheduledAt is re-stamped with now on every attempt, the retry sends a new key, the provider treats it as a new payout, and the merchant is paid twice. Providers match the full key, not a prefix. Backoff timing does not create idempotency. The attempt counter is passed correctly (attempt + 1 on re-enqueue). Fix: carry the occurrence\'s scheduledAt (its slot) unchanged through retries, so runKey = id@slot is stable.',
      followUps: [
        {
          q: 'The provider keeps idempotency keys for only 24 hours. Does your design still hold for a retry chain that spans 30 hours?',
          a: 'No: after 24 hours the key expires and a retry could pay again. Either cap the retry window under the provider\'s key TTL (the backoff cap and max attempts keep the total under, say, 6 hours), or before retrying query the provider by your reference (the GET payout by `runKey` reference id) and only re-send if it does not exist. Persist your own outcome table keyed by runKey as the source of truth.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-16',
      difficulty: 'hard',
      question:
        'The scheduler arms one setTimeout for the earliest heap entry. At 09:00 the earliest task is at 10:00, so the timer is armed for 60 minutes. At 09:05 a task due at 09:06 is submitted, and submit() only pushes to the heap. When does the 09:06 task run?',
      options: [
        'At about 10:00: the timer still sleeps until the old top, so the new earlier task waits about 54 minutes',
        'At 09:06, because the heap reorders itself and the timer reads the new top when it fires',
        'Immediately at 09:05, because pushing an earlier element triggers a heap event that runs due tasks',
        'Never, because the new entry is below the old top and tick() stops at the first future task',
      ],
      correct: [0],
      explanation:
        'The heap does put the 09:06 task on top, but nothing wakes the process until the armed timer fires at 10:00. At that point tick() pops everything due, including the 09:06 task, about 54 minutes late. Heaps do not emit events. tick() pops in runAt order, so the earlier task is not stuck behind the old top. Fix: on submit, if the new runAt is earlier than the armed time, clear and re-arm the timer. Also cap the armed delay (e.g. 1 hour) as a safety net.',
      followUps: [
        {
          q: 'Re-arming on every submit is expensive at 5K submits/s. How do you reduce timer churn?',
          a: 'Re-arm only when the new runAt is earlier than the currently armed time, which is rare for typical "in the future" submits. For bursts of near-immediate tasks, use a tick granularity: arm for `max(target, now + 10 ms)` and let tick() drain everything due within that window. A timing wheel (buckets per 10 ms or 1 s) gives O(1) insert and one periodic tick, which is the classic answer for very high timer volume, as in Kafka\'s purgatory and Netty\'s HashedWheelTimer.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-17',
      difficulty: 'medium',
      question:
        'Your Snake & Ladder board stores Map<cell, Jump> with Snake and Ladder subclasses. The interviewer adds "a Trampoline cell: move forward by the dice value again". Which change best fits the design?',
      options: [
        'Add an if (cell is trampoline) branch inside Game.play(), since it needs the dice value',
        'Add a trampolines array to Board and check it before the jumps map in jumpAt()',
        'Store trampolines as ladders whose top is computed at board construction from an average roll',
        'Generalize Jump to a CellEffect with apply(ctx) that receives the roll and position; Trampoline is a new subclass',
      ],
      correct: [3],
      explanation:
        'The new cell needs context (the roll), which a fixed destination cannot express. Widening the abstraction to apply(ctx) keeps Board and Game closed to modification, and each future cell type is a subclass. An if-branch in Game reintroduces type switching. A parallel array in Board duplicates the lookup logic for each new type. Precomputing a destination from an average roll changes the game\'s semantics.',
      followUps: [
        {
          q: 'A trampoline can land on a snake. Do you resolve chained effects now, and how do you prevent infinite loops?',
          a: 'Either validate statically (reject boards where any effect\'s possible destinations hit another effect, though trampoline destinations depend on the roll, so check all 1–6 outcomes) or resolve dynamically with a hop limit: apply effects while the landing cell has one, at most `effects.size` hops, and emit each hop. Static validation fails fast at load time, which is preferable in a machine-coding round. Say which you chose and why.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-18',
      difficulty: 'hard',
      question:
        'Given this board loading and movement code, a config with a ladder 8→30 and a snake 30→8 is accepted. What happens when a player lands on 8?',
      code: {
        language: 'typescript',
        code: `constructor(snakes: [number, number][], ladders: [number, number][]) {
  for (const [head, tail] of snakes) this.next.set(head, tail);
  for (const [foot, top] of ladders) this.next.set(foot, top);
}
resolve(cell: number): number {
  let p = cell;
  while (this.next.has(p)) p = this.next.get(p)!;   // follow chained jumps
  return p;
}`,
      },
      options: [
        'The player climbs to 30 and stays, because each cell is resolved only once per turn',
        'resolve() loops forever between 8 and 30, hanging the game (and the event loop in a server)',
        'The ladder overwrites the snake, so landing on 8 always ends on 30 and 30 is safe',
        'The Map throws on the duplicate key 30, so the constructor fails',
      ],
      correct: [1],
      explanation:
        'Cell 8 maps to 30 and cell 30 maps to 8 (different keys, so nothing is overwritten and the Map does not throw). The while loop follows 8 → 30 → 8 forever. In a Node game server that blocks the event loop for every room on the process. Fix: validate at construction (directions, one effect per cell, no effect ending on another effect\'s start), or bound the hop count.',
      followUps: [
        {
          q: 'What other validations belong in that constructor?',
          a: 'Snakes must go down and ladders up; no effect may start on cell 1 or the final cell, since a snake on 100 makes winning impossible; at most one effect per start cell (fail on duplicates instead of silently overwriting); all endpoints within [1, N]; and no effect may end on another effect\'s start. Throw a typed `InvalidBoardError` listing every violation at once, so the person fixing the config sees them all in one go.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-19',
      difficulty: 'expert',
      question:
        'Select ALL that apply: an online Snake & Ladder service (many pods, WebSockets) sees duplicate moves from double taps and occasional out-of-turn moves after reconnects. Which measures actually prevent invalid state changes?',
      options: [
        'Clients send expectedTurn; the server applies a move only if it equals the game\'s turn counter, then increments it',
        'All commands for a game are handled by one owner (routed by gameId), or persisted with a compare-and-set on the turn counter',
        'Disable the roll button for 500 ms after a tap on the client',
        'Rely on Node\'s single-threaded event loop to serialize moves across the deployment',
        'Roll dice on the server and verify the sender is the current player before applying',
      ],
      correct: [0, 1, 4],
      explanation:
        'expectedTurn turns duplicates and stale commands into rejections (optimistic concurrency). A single owner, or a CAS on persisted state, makes that check atomic across processes. Server-side dice plus a current-player check stop out-of-turn moves and forged rolls. Client debounce is a UX nicety: a retry, a second tab or a malicious client bypasses it. The event loop serializes only within one process; with several pods, two copies of a game can each accept a move.',
      followUps: [
        {
          q: 'A move was applied, but the WebSocket dropped before the client got the response. The client retries with the same expectedTurn. What should it see?',
          a: 'A "stale turn" rejection alone would confuse the client, which never learned the result. Return the current state (or the events since its last seen sequence) along with the rejection, so the client renders the move it already made. Even better, include a client command id: if the stored last command id for that player matches, respond with the original result, giving true idempotent replay instead of an error.',
        },
      ],
    },
    {
      id: 'lld-cases-2-mcq-20',
      difficulty: 'expert',
      question:
        'In a chess LLD, each Piece subclass implements candidates(board, from) for pseudo-legal moves. Where should the rule "a move may not leave your own king in check" (which also covers pinned pieces) live?',
      options: [
        'In each Piece subclass, by checking whether that piece is pinned before generating moves',
        'In the King class only, since check is a property of the king',
        'In one game-level filter: apply each candidate to a copy of the position and drop moves after which the mover\'s king is attacked',
        'In the Board class, which rejects any move that places a piece adjacent to the enemy king',
      ],
      correct: [2],
      explanation:
        'King safety is a property of the whole position after the move, not of one piece type. A single filter (apply, then test whether the king is attacked) handles pins, moving into check, and failing to resolve an existing check uniformly for every piece. Per-piece pin logic duplicates complex geometry six times and misses discovered checks. A King-only rule misses pinned pieces. Adjacency has nothing to do with check (knights, sliders).',
      followUps: [
        {
          q: 'This filter calls "is square attacked" about 35 times per turn. Is performance a concern for a game server, and what would an engine do instead?',
          a: 'For a server validating human moves, no: about 35 candidates × 16 enemy pieces × a few rays is microseconds. An engine searching millions of positions uses bitboards (64-bit masks with precomputed attack tables), computes pins and check rays once per position, and generates only legal moves, avoiding make/test/unmake per candidate. Mention it as an optimization path, and keep the simple filter in the LLD.',
        },
      ],
    },
  ],
};

export default topic;
