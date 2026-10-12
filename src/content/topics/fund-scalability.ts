import type { Topic } from '../../types';

const topic: Topic = {
  id: 'fund-scalability',
  phase: 'fundamentals',
  order: 3,
  title: 'Scalability, Availability, Reliability, Latency & Throughput',
  subtitle:
    'The vocabulary of scale: how systems grow, how they fail, how to do availability math, and why p99 (not the average) decides your architecture.',
  estimatedMinutes: 75,
  sources: [
    'Alex Xu — System Design Interview Vol 1, Ch 1 Scale from Zero to Millions of Users',
    'Alex Xu — System Design Interview Vol 2 (NFR framing used across all chapters)',
    'Dean & Barroso — The Tail at Scale (CACM 2013)',
    'Neil Gunther — Universal Scalability Law',
    'Google SRE Book — Ch 3 Embracing Risk, Ch 4 Service Level Objectives',
  ],
  tags: [
    'scalability',
    'availability',
    'reliability',
    'latency',
    'throughput',
    'littles-law',
    'tail-latency',
    'spof',
    'amdahl',
    'usl',
    'stateless',
  ],
  cheatSheet: [
    'Vertical = bigger box (simple, hard ceiling, SPOF); horizontal = more boxes (needs statelessness, LB, and data partitioning) — scale app tier horizontally first, the DB tier is where it gets hard.',
    'Stateless service = any instance can serve any request: move sessions, rate-limit counters, uploads and caches-that-must-be-shared to Redis / DB / object storage; sticky sessions are a crutch, not a design.',
    'Serial availability multiplies (3 × 99.9% ≈ 99.7%); parallel redundancy is 1 − Π(1 − Aᵢ) (2 × 99% ≈ 99.99%) — but only if failures are independent and failover is automatic.',
    'Nines budget: 99.9% ≈ 43 min/month, 99.95% ≈ 22 min/month, 99.99% ≈ 4.3 min/month, 99.999% ≈ 26 s/month — above 99.99% humans cannot be in the recovery loop.',
    'Availability = MTBF / (MTBF + MTTR); cutting MTTR (fast detection, rollback, automated failover) is usually cheaper than raising MTBF.',
    'Reliability = correct results over time; availability = responds at all; durability = data not lost. A system returning fast 500s or stale wrong data is "up" but not reliable.',
    'Little\'s Law: concurrency L = λ × W. 2,000 RPS × 50 ms = 100 in-flight requests → size pools, threads and connection limits from this.',
    'Queueing: latency ≈ S / (1 − ρ); at 80% utilization wait ≈ 5× service time, at 90% ≈ 10× — plan capacity for ~60–70% peak utilization.',
    'Tail amplification: fan-out to N backends, each with 1% slow → P(slow) = 1 − 0.99ᴺ (N=100 → 63%). Fix with hedging, timeouts/deadlines, partial results, fewer hops.',
    'Amdahl: speedup ≤ 1 / (1 − p) (95% parallel → max 20×). USL adds coherence cost β: throughput peaks at N* = √((1 − α)/β) and then DECLINES — more nodes can make it slower.',
  ],
  sections: [
    {
      heading: 'Scalability: vertical vs horizontal, and what "scalable" actually means',
      body: `**Intuition:** a restaurant gets busier. You can buy a bigger stove (vertical) or open more kitchens (horizontal). A bigger stove is easy but there is a largest stove on the market; more kitchens need a host at the door (load balancer) and a shared recipe book (shared state).

**Precise definition:** a system is scalable if adding resources yields a *proportional* increase in capacity **while keeping latency within its SLO** and without a redesign. "It handles 10K RPS" is not scalability; "throughput grows ~linearly from 3 to 30 nodes with p99 < 150 ms" is.

| Dimension | Vertical (scale up) | Horizontal (scale out) |
|---|---|---|
| How | More vCPU/RAM/IOPS on one node | More nodes behind a LB / partitioned |
| Ceiling | Hard (largest instance, e.g. ~192 vCPU / 24 TB RAM classes on cloud) | Soft (coordination cost, see USL) |
| Failure | Single node = SPOF | Survives node loss if N+1 |
| Cost curve | Super-linear at the top end | Roughly linear, commodity boxes |
| Complexity | None in code | Statelessness, LB, partitioning, consistency |
| Best for | Primary DBs early on, in-memory stores, quick wins | Stateless API tiers, workers, caches, shards |

**Scaling axes (AKF Scale Cube)** — useful vocabulary in interviews:
- **X-axis**: clone identical stateless instances behind a LB.
- **Y-axis**: split by function (microservices: orders, payments, search).
- **Z-axis**: split by data (sharding by userId / tenantId / region).

**Trade-offs:** vertical scaling is underrated — a single Postgres on a large NVMe instance handles tens of thousands of simple TPS and removes an entire class of distributed-systems bugs. Horizontal scaling is mandatory once you need fault tolerance or exceed one box, but every stateful component you scale out forces a decision on consistency.

**Interview line:** *"I'll scale the stateless API tier horizontally behind an L7 LB with autoscaling on CPU and in-flight requests. The DB I'll scale vertically plus read replicas until writes exceed ~one primary's capacity, then shard by the access key. Each step is driven by a measured bottleneck, not by default."*`,
      diagram: `            AKF scale cube (where does the next 10x come from?)

   Z-axis: split by DATA (shard by user/tenant/region)
     ^
     |      +-----------------------------+
     |     /                             /|
     |    /     "one monolith,          / |
     |   /       one DB, one box"      /  |
     |  +-----------------------------+   |
     |  |                             |   +---> Y-axis: split by FUNCTION
     |  |  start here (origin)        |  /       (orders, payments, search)
     |  |                             | /
     |  +-----------------------------+/
     |
     +---------> X-axis: CLONE stateless instances behind a load balancer`,
      keyPoints: [
        'Scalability = capacity grows ~proportionally with resources while latency stays within SLO.',
        'Scale the stateless tier out first; state is what makes scaling hard.',
        'Name the axis: clone (X), functional split (Y), data partition (Z).',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 1',
    },
    {
      heading: 'Stateless vs stateful services and session externalization',
      body: `**Intuition:** a stateless server is a bank teller who looks everything up in the central ledger — any teller can serve you. A stateful server is a teller who keeps your file in their own drawer — you must queue for *that* teller, and if they go home, your file is gone.

**What counts as state on an app server** (common in NestJS apps without anyone noticing):
- In-memory sessions (express-session's default MemoryStore — which even warns it is not for production).
- In-process rate-limit counters, dedupe/idempotency maps, WebSocket subscription maps.
- Files written to local disk (uploads, generated reports).
- In-process caches that must be consistent across instances (feature flags, permissions).
- Scheduled cron jobs that assume a single instance (they run N times after scale-out).

**Externalize it:**
| State | Where it goes |
|---|---|
| Sessions | Redis (TTL) or a signed stateless token (JWT) + server-side revocation list |
| Rate-limit counters | Redis (INCR + EXPIRE, or Lua sliding window) |
| Uploads | Object storage (S3) via pre-signed URLs |
| Idempotency keys | Redis SET NX with TTL or a DB unique constraint |
| Cron / singletons | Distributed lock, leader election, or a job queue (BullMQ) |

**Sticky sessions** (LB affinity by cookie/IP) make stateful servers "work" but: uneven load (hot users pin to one node), losing a node logs out its users, deploys drain slowly, and autoscaling in is painful. Use stickiness only as a *performance* optimization (e.g. local cache warmth, WebSocket connection affinity), never as the correctness mechanism.

**JWT vs server-side session:** JWT removes the session lookup (one less Redis hop, ~0.2–1 ms) but revocation becomes hard — you need short expiry (5–15 min) plus refresh tokens or a deny-list, which is state again. Redis sessions are simple and revocable; a Redis cluster handles 100K+ ops/sec per shard easily.

**Interview line:** *"All app instances are stateless — sessions in Redis with a 30-minute sliding TTL, uploads direct to S3 — so the LB can use least-outstanding-requests and any pod can be killed at any time."*`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS (Express) — externalize sessions to Redis so any pod can serve any request',
          code: `import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import Redis from 'ioredis';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,      // fail fast instead of hanging requests
    enableOfflineQueue: false,    // don't buffer commands while disconnected
  });

  app.use(
    session({
      store: new RedisStore({ client: redis, prefix: 'sess:' }),
      secret: process.env.SESSION_SECRET!,
      resave: false,              // don't rewrite unchanged sessions (saves Redis writes)
      saveUninitialized: false,   // don't create sessions for anonymous traffic
      rolling: true,              // sliding expiry on activity
      cookie: { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 60 * 1000 },
    }),
  );

  app.enableShutdownHooks();      // drain in-flight requests on SIGTERM during scale-in
  await app.listen(3000);
}
bootstrap();`,
        },
      ],
      keyPoints: [
        'Hidden state: memory sessions, local counters, local files, singleton crons.',
        'Sticky sessions are a performance hint, not a correctness mechanism.',
        'Stateless tier + externalized state = safe autoscaling and zero-downtime deploys.',
      ],
    },
    {
      heading: 'Finding single points of failure (SPOFs)',
      body: `**Intuition:** walk the request path with a marker and circle every box that, if unplugged, takes the whole product down. Each circle is a SPOF.

**Obvious SPOFs:** a single LB, a single DB primary with manual failover, a single NAT gateway, one AZ, one region.

**Non-obvious SPOFs (the ones interviewers want):**
- **DNS provider** — one managed DNS provider outage takes you offline even if every server is fine.
- **Config / secrets / feature-flag service** — if pods fetch config at startup, a config outage blocks every deploy and autoscale event.
- **Auth / identity provider** — every request depends on it; cache JWKS keys, degrade gracefully.
- **Shared Redis** used by 12 services — one cluster, correlated blast radius.
- **Certificate expiry** and **a single on-call human** — process SPOFs.
- **Control plane** (Kubernetes API, service discovery) — data plane should keep working if the control plane is down (static stability).
- **Shared fate:** two replicas on the same host/rack/AZ are not independent.

**Removing a SPOF is not just "add a second one":**
1. Redundancy (N+1 or N+2 capacity so losing one still meets peak).
2. **Failure detection** (health checks, heartbeats — seconds, not minutes).
3. **Automatic failover** (LB ejection, DB promotion via Patroni/RDS Multi-AZ).
4. Independence (spread across AZs; avoid shared dependencies).
5. **Test it** (chaos / game days) — untested failover is a hypothesis.

**N+1 math:** if peak needs 6 pods and you run 6, losing one overloads the other five by 20% and can cascade. Run 7 (N+1), or with 3 AZs run enough that losing a whole AZ (one-third of capacity) still covers peak: need ≥ 6 / (2/3) = 9 pods, 3 per AZ.`,
      diagram: `   Client
     |
   [DNS] ...................... SPOF? single provider -> add secondary DNS
     |
   [CDN / WAF]
     |
   [L7 LB] ×2 (managed, multi-AZ) ..... OK
     |
   +------+------+------+
   |API-a |API-b |API-c |   stateless, 3 AZs, N+1 ... OK
   +--+---+--+---+--+---+
      |      |      |
      +------+------+----------> [Auth/IdP] .... SPOF? cache JWKS, grace
      |                  \\
   [Redis] single node     [Config svc] ...... SPOF at startup!
     ^ SPOF: sessions die     -> bake last-known-good config into pod
      |
   [Postgres primary] --async--> [replica]
     ^ SPOF unless automatic promotion (Patroni / Multi-AZ)`,
      keyPoints: [
        'Redundancy without detection + automatic failover is not high availability.',
        'Look for shared dependencies: DNS, IdP, config, shared Redis, control plane.',
        'Size for N+1 at peak, or for loss of a full AZ in multi-AZ designs.',
      ],
    },
    {
      heading: 'Availability math: nines, serial and parallel composition',
      body: `**Intuition:** a chain is as weak as all its links combined — every link you add *multiplies* the chance something breaks. Spare tyres (redundancy) multiply the chance *all* of them fail, which is tiny.

**Nines table (downtime budget):**
| Availability | Per year | Per 30-day month | Per week |
|---|---|---|---|
| 99% | 3.65 days | 7.2 h | 1.68 h |
| 99.9% | 8.76 h | 43.2 min | 10.1 min |
| 99.95% | 4.38 h | 21.6 min | 5.04 min |
| 99.99% | 52.6 min | 4.32 min | 1.01 min |
| 99.999% | 5.26 min | 25.9 s | 6.05 s |

**Serial (all must work):** A = A₁ × A₂ × … × Aₙ. A request path through LB (99.99%) → API (99.95%) → DB (99.95%) → payment provider (99.9%) ≈ 0.9999 × 0.9995 × 0.9995 × 0.999 ≈ **99.79%**. Your SLA cannot exceed the product of your hard dependencies.

**Parallel (any one suffices):** A = 1 − Π(1 − Aᵢ). Two independent 99% replicas → 1 − 0.01² = **99.99%**. Three → 99.9999%.

**Why real numbers are worse than the formula:**
- **Correlated failures** — same AZ, same bad deploy, same config push, same kernel bug. A bad deploy to all replicas makes parallel redundancy worth nothing.
- **Failover is not instant** — detection + promotion (e.g. 30–60 s for a DB) is downtime that counts.
- **Failover component itself** is in series (the LB or the promotion controller).

**Levers to improve composite availability:**
- Make dependencies **soft**: if recommendations are down, render the page without them (degrade, don't fail).
- Async the non-critical path (queue emails/analytics).
- Cache/serve stale on dependency failure.
- Reduce the number of hard hops in the critical path.
- Cells/shards: an outage hits 1/N of users instead of all (reduces blast radius, not raw availability).

**Interview line:** *"Our critical path has four hard dependencies, so 99.95% end-to-end requires each to be ~99.99%. Instead I'll make recommendations and reviews soft dependencies with timeouts and fallbacks, leaving only LB, API and DB in series."*`,
      code: [
        {
          language: 'typescript',
          title: 'Composite availability calculator (serial, parallel, and downtime budget)',
          code: `type Node =
  | { kind: 'leaf'; name: string; availability: number }
  | { kind: 'serial'; children: Node[] }     // all must be up
  | { kind: 'parallel'; children: Node[] };  // any one suffices (independent failures!)

export function availability(n: Node): number {
  switch (n.kind) {
    case 'leaf':
      return n.availability;
    case 'serial':
      return n.children.reduce((acc, c) => acc * availability(c), 1);
    case 'parallel':
      // P(all down) = product of unavailabilities
      return 1 - n.children.reduce((acc, c) => acc * (1 - availability(c)), 1);
  }
}

export function monthlyDowntimeMinutes(a: number): number {
  return (1 - a) * 30 * 24 * 60;
}

const system: Node = {
  kind: 'serial',
  children: [
    { kind: 'leaf', name: 'lb', availability: 0.9999 },
    { kind: 'parallel', children: [
      { kind: 'leaf', name: 'api-az1', availability: 0.999 },
      { kind: 'leaf', name: 'api-az2', availability: 0.999 },
    ] },
    { kind: 'leaf', name: 'postgres-multi-az', availability: 0.9995 },
  ],
};

const a = availability(system);
console.log((a * 100).toFixed(4) + '%', monthlyDowntimeMinutes(a).toFixed(1) + ' min/month');
// ~99.94% -> ~26 min/month: the DB and LB dominate; more API replicas barely help`,
        },
      ],
      keyPoints: [
        'Serial multiplies availabilities; parallel multiplies unavailabilities.',
        'The formulas assume independence — correlated failures (deploys, AZs) break them.',
        'Turn hard dependencies into soft ones to escape the serial product.',
      ],
      source: 'Google SRE Book — Ch 3 Embracing Risk',
    },
    {
      heading: 'Reliability vs availability vs durability; MTBF and MTTR',
      body: `**Intuition:** *available* = the shop is open. *Reliable* = the shop gives you the right change every time. *Durable* = the shop never loses the money you deposited. You can be open and give wrong change.

| Property | Question it answers | Typical measure |
|---|---|---|
| Availability | Can I get a (successful) response right now? | Uptime %, or good requests / total requests |
| Reliability | Does it do the right thing, consistently, over time? | Error rate, correctness, MTBF |
| Durability | Once acknowledged, is my data still there? | S3 advertises 11 nines of durability (99.999999999%) |
| Resilience | How well does it absorb and recover from faults? | MTTR, blast radius, graceful degradation |

**Formula:** Availability = MTBF / (MTBF + MTTR).
- MTBF 30 days, MTTR 1 h → 720 / 721 = 99.86%.
- Same MTBF, MTTR 5 min → 720 / 720.083 ≈ **99.99%** (99.988%).
MTTR is the cheaper lever: faster detection (good alerts on SLO burn rate), one-click rollback, automated failover, feature-flag kill switches.

**Request-based availability** (what SRE teams actually use): SLI = good requests / valid requests, where "good" means non-5xx **and** under the latency threshold. A service answering in 8 s is effectively unavailable to a user whose client times out at 3 s.

**SLI → SLO → SLA:**
- SLI: the measurement (p99 latency, success ratio).
- SLO: the internal target (99.95% of requests succeed in < 300 ms over 28 days).
- SLA: the contract with money attached, set looser than the SLO (e.g. 99.9%).
- **Error budget** = 1 − SLO; spend it on releases, freeze when burned.

**Durability vs availability trade-off:** synchronous replication to a second AZ increases durability (no acknowledged write lost if one AZ dies) but adds ~1–2 ms write latency and can *reduce* write availability if the synchronous replica is down (unless you fall back to async — which reintroduces loss risk).`,
      keyPoints: [
        'Availability ≠ reliability ≠ durability — name which one the requirement is about.',
        'Cut MTTR: detection, rollback, automated failover beat heroic MTBF improvements.',
        'Define "good request" to include latency, not just status code.',
      ],
      source: 'Google SRE Book — Ch 4 Service Level Objectives',
    },
    {
      heading: 'Latency vs throughput and Little\'s Law',
      body: `**Intuition:** latency is how long one car takes to cross the bridge; throughput is how many cars cross per minute. Widening the bridge (more lanes) raises throughput without making any single car faster. Little's Law tells you how many cars are *on* the bridge at once.

**Definitions:**
- **Latency**: time for one request (report percentiles: p50, p95, p99, p99.9 — never only the mean).
- **Throughput**: completed requests per unit time (RPS, msgs/sec, MB/s).
- **Concurrency**: requests in flight at a moment.

**Little's Law:** L = λ × W (in-flight = arrival rate × time in system). It holds for any stable system regardless of distribution.

**Uses you will actually need:**
- **DB pool sizing:** 400 RPS per pod, each request holds a DB connection for 25 ms → 400 × 0.025 = 10 connections busy on average. Pool of 10 has zero headroom; bursts queue. Use ~15–20, and check the DB's global max_connections across all pods.
- **Worker count:** Kafka consumer processing 5,000 msgs/s at 20 ms each → 100 concurrent handlers needed.
- **Diagnosing:** if throughput is flat while in-flight count climbs, W is increasing — you're queueing on a bottleneck.
- **Load test sanity:** a closed-loop load tester with 50 virtual users and 100 ms latency can *never* exceed 500 RPS — it's measuring itself.

**Latency and throughput interact through utilization.** For a simple M/M/1 queue, time in system W = S / (1 − ρ), where S is service time and ρ is utilization:
| Utilization ρ | W as multiple of S |
|---|---|
| 50% | 2× |
| 70% | 3.3× |
| 80% | 5× |
| 90% | 10× |
| 95% | 20× |
This is why "the CPU is only at 85%" can coincide with terrible p99, and why capacity plans target 60–70% at peak.

**Batching** raises throughput (fewer syscalls/round-trips, e.g. Kafka linger.ms, DB multi-row inserts) at the cost of latency. **Pipelining/concurrency** raises throughput while holding per-request latency.`,
      code: [
        {
          language: 'typescript',
          title: 'Sizing a pg pool and a concurrency limit from Little\'s Law',
          code: `import { Pool } from 'pg';

// Measured in production (not guessed):
const peakRpsPerPod = 400;       // λ at peak for one pod
const dbHoldTimeSec = 0.025;     // W: time a request holds a connection (p95, not mean)
const headroom = 1.5;            // bursts + variance
const pods = 40;
const dbMaxConnections = 1000;   // Postgres max_connections minus admin/replication slots

const needed = Math.ceil(peakRpsPerPod * dbHoldTimeSec * headroom); // 400*0.025*1.5 = 15
const perPodCap = Math.floor((dbMaxConnections * 0.8) / pods);       // 800/40 = 20

export const pool = new Pool({
  max: Math.min(needed, perPodCap),   // 15: enough for Little's Law, within global budget
  connectionTimeoutMillis: 200,       // fail fast when the pool is exhausted (don't queue forever)
  idleTimeoutMillis: 30_000,
  statement_timeout: 2_000,           // server-side guard against runaway queries
});

// If needed > perPodCap: add PgBouncer (transaction pooling) or cut hold time
// (no network calls while holding a connection) instead of raising max_connections.`,
        },
      ],
      keyPoints: [
        'L = λ × W: concurrency is derived, not configured by gut feeling.',
        'Latency explodes non-linearly with utilization; target 60–70% at peak.',
        'Batching trades latency for throughput; concurrency raises throughput at fixed latency.',
      ],
    },
    {
      heading: 'Tail latency and fan-out amplification',
      body: `**Intuition:** if you wait for 100 friends before leaving for dinner, you leave when the *slowest* friend arrives. The more friends, the more certain it is someone is late.

**The math:** if each backend is slow (above its p99) 1% of the time and a request fans out to N backends and waits for all:
- P(at least one slow) = 1 − 0.99ᴺ
- N = 1 → 1%; N = 10 → 9.6%; N = 50 → 39.5%; N = 100 → **63.4%**.
So the *user-facing* median can be the *backend* p99. This is Dean & Barroso's "The Tail at Scale".

**Serial hops add, too:** a request through 6 microservices, each with p99 = 50 ms, can have an end-to-end p99 well above 50 ms; worst-case aligned tails approach the sum. Deep call chains are a latency liability.

**Causes of tail latency:** GC pauses (Node's major GC, JVM stop-the-world), noisy neighbours, TCP retransmits (a lost SYN adds ~1 s initial RTO), cache misses, lock contention, queueing at high utilization, cold starts, compaction in LSM stores, head-of-line blocking.

**Mitigations:**
| Technique | How it works | Cost / caveat |
|---|---|---|
| Timeouts + deadlines | Propagate a remaining-budget deadline; drop work that can't finish | Needs partial-result semantics |
| Hedged requests | Send a second copy after p95 elapses; take the first response | ~5% extra load; only for idempotent reads |
| Tied requests | Send to 2 replicas, the one that starts first cancels the other | Needs cancellation plumbing |
| Partial results | Return 98 of 100 shards' results (search, feeds) | Product must accept "good enough" |
| Reduce fan-out | Pre-aggregate, denormalize, co-locate data | Write amplification |
| Load-aware LB | Least-outstanding-requests / P2C instead of round-robin | Slight LB complexity |
| Isolation | Separate pools for batch vs interactive | Lower utilization |

**Interview line:** *"Averages hide the problem. With a 40-shard fan-out, a 1% slow shard puts ~33% of queries in the tail, so I'll set a 120 ms per-shard deadline, hedge after the p95 (~30 ms), and return partial results with a flag."*`,
      code: [
        {
          language: 'typescript',
          title: 'Hedged read with deadline and cancellation (idempotent GETs only)',
          code: `// Send primary; if no answer by hedgeAfterMs, send a hedge to another replica.
// Take whichever finishes first, abort the loser, and never exceed the deadline.
export async function hedgedGet<T>(
  replicas: string[],
  path: string,
  opts: { hedgeAfterMs: number; deadlineMs: number },
): Promise<T> {
  const controllers: AbortController[] = [];
  const deadline = AbortSignal.timeout(opts.deadlineMs);

  const attempt = (baseUrl: string): Promise<T> => {
    const ac = new AbortController();
    controllers.push(ac);
    const signal = AbortSignal.any([ac.signal, deadline]); // Node 20.3+
    return fetch(baseUrl + path, { signal }).then(async (r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return (await r.json()) as T;
    });
  };

  const primary = attempt(replicas[0]);
  const hedge = new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => attempt(replicas[1]).then(resolve, reject), opts.hedgeAfterMs);
    primary.finally(() => clearTimeout(t)).catch(() => {}); // no hedge if primary already done
  });

  try {
    return await Promise.any([primary, hedge]);   // first success wins
  } finally {
    controllers.forEach((c) => c.abort());        // cancel the slower in-flight request
  }
}`,
        },
      ],
      keyPoints: [
        'Fan-out converts backend p99 into user-facing p50: 1 − 0.99ᴺ.',
        'Hedge only idempotent reads, and only after ~p95, to cap extra load around 5%.',
        'Deadline propagation beats per-hop fixed timeouts in deep call chains.',
      ],
      source: 'Dean & Barroso — The Tail at Scale (CACM 2013)',
    },
    {
      heading: 'Bottleneck identification: find the constraint before scaling anything',
      body: `**Intuition:** a highway's throughput is set by its narrowest lane. Adding lanes anywhere else just moves the traffic jam.

**Method (say it in this order):**
1. **Define the symptom with numbers:** "p99 went from 90 ms to 1.4 s at 3× traffic; throughput plateaued at 6K RPS."
2. **USE method per resource** (Brendan Gregg): **U**tilization, **S**aturation (queue length/wait), **E**rrors — for CPU, memory, disk, network, *and* software resources (DB connections, thread/event-loop, locks, file descriptors).
3. **RED per service:** **R**ate, **E**rrors, **D**uration — find which hop's duration grew.
4. **Distributed trace** of slow requests: where is time spent — waiting for a pool, in the DB, in GC?
5. **Change one thing, measure again.**

**Common bottlenecks in Node/NestJS services:**
| Symptom | Likely constraint | Signal |
|---|---|---|
| Throughput flat, CPU at 100% on one core | Event loop blocked (JSON.stringify of huge payloads, sync crypto, regex) | Event-loop lag > 50 ms |
| Latency high, CPU low | Waiting on a pool / downstream | pg pool waitingCount > 0, connection acquire time |
| Latency climbs with traffic, DB CPU high | Missing index / hot rows | pg_stat_statements, lock waits |
| Periodic spikes | GC, cron jobs, cache expiry waves | GC pause metrics, synchronized TTLs |
| Errors at a round number of connections | FD limit, max_connections, ephemeral ports | EMFILE, "too many clients" |

**Scaling the wrong tier** is the classic mistake: adding 20 more API pods when the DB is the constraint *adds* 20 × pool-size connections, increasing DB contention and making latency worse.

**Interview line:** *"Before adding capacity I'd confirm which resource is saturated. If API pods are waiting on the pg pool while Postgres CPU is at 90%, more pods will make it worse; the fix is in the DB tier — query/index, read replicas, or caching."*`,
      code: [
        {
          language: 'typescript',
          title: 'Expose the saturation signals that locate a Node bottleneck',
          code: `import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Gauge, collectDefaultMetrics } from 'prom-client';
import { pool } from './db';

collectDefaultMetrics(); // includes GC and heap metrics

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

new Gauge({
  name: 'event_loop_lag_p99_ms',
  help: 'p99 event-loop delay; >50ms means CPU-bound work is blocking requests',
  collect() { this.set(loop.percentile(99) / 1e6); loop.reset(); },
});

new Gauge({
  name: 'pg_pool_waiting',
  help: 'requests queued for a DB connection (saturation, not utilization)',
  collect() { this.set(pool.waitingCount); },
});

new Gauge({
  name: 'pg_pool_in_use',
  help: 'connections checked out (utilization)',
  collect() { this.set(pool.totalCount - pool.idleCount); },
});`,
        },
      ],
      keyPoints: [
        'Measure saturation (queues/waits), not just utilization.',
        'USE for resources, RED for services, traces for the slow path.',
        'Scaling a non-bottleneck tier can worsen the real bottleneck.',
      ],
    },
    {
      heading: 'Amdahl\'s Law and the Universal Scalability Law (USL)',
      body: `**Intuition:** ten chefs can chop ten times faster, but if every dish must pass through one head chef for plating, the head chef caps the kitchen (Amdahl). Worse, if every chef must also check with every other chef before cooking, adding chefs eventually makes the kitchen *slower* (USL coherence).

**Amdahl's Law:** speedup S(N) = 1 / ((1 − p) + p / N), where p is the parallelizable fraction.
- p = 0.95 → max speedup 1 / 0.05 = **20×**, no matter how many nodes. At N = 32, S ≈ 12.5×.
- p = 0.99 → max 100×.
The serial fraction in real systems: a single DB primary for writes, a global lock, a leader, a single Kafka partition for ordered events, a central sequence generator.

**Universal Scalability Law (Gunther):** C(N) = N / (1 + α(N − 1) + βN(N − 1)).
- **α (contention)**: queueing on shared resources — the Amdahl term.
- **β (coherence/crosstalk)**: cost of keeping nodes consistent with each other — cache invalidation broadcasts, distributed locks, gossip, 2PC, all-to-all chatter. Grows ~N².
- With β > 0, throughput **peaks** at N* = √((1 − α) / β) and then *declines* — retrograde scaling.
- Example: α = 0.03, β = 0.0005 → N* = √(0.97 / 0.0005) ≈ **44 nodes**; beyond that, adding nodes reduces throughput.

**How to use it in design:**
- Shrink α: partition so nodes don't share a hot resource (shard by key, per-partition leaders, lock-free per-key ordering).
- Shrink β: avoid all-to-all coordination; use local caches with TTLs instead of broadcast invalidation; prefer shared-nothing; keep consensus groups small (3–5 nodes) and scale by adding *more groups*, not bigger ones.
- Fit USL to load-test data (throughput at N = 1, 2, 4, 8, 16) to predict where scaling will stop *before* production finds out.

**Interview line:** *"Linear scale-out requires shared-nothing. Our design has a global inventory lock — that's a serial fraction; per-SKU partitioning turns it into many independent queues so α approaches zero for different SKUs."*`,
      code: [
        {
          language: 'typescript',
          title: 'Amdahl and USL — predict where adding nodes stops helping',
          code: `export const amdahl = (p: number, n: number) => 1 / ((1 - p) + p / n);

// Relative capacity vs a single node (Gunther's USL)
export const usl = (n: number, alpha: number, beta: number) =>
  n / (1 + alpha * (n - 1) + beta * n * (n - 1));

export const uslPeak = (alpha: number, beta: number) => Math.sqrt((1 - alpha) / beta);

const alpha = 0.03;   // contention: 3% of work serialized on a shared resource
const beta = 0.0005;  // coherence: pairwise cross-node coordination cost

for (const n of [1, 8, 16, 32, 44, 64, 128]) {
  console.log(n, 'nodes -> x' + usl(n, alpha, beta).toFixed(1));
}
// 1 -> x1.0, 8 -> x6.5, 16 -> x10.2, 32 -> x13.2, 44 -> x13.6 (peak), 64 -> x13.1, 128 -> x9.9
console.log('peak at ~' + uslPeak(alpha, beta).toFixed(0) + ' nodes');
console.log('Amdahl p=0.95, 32 nodes -> x' + amdahl(0.95, 32).toFixed(1)); // x12.5`,
        },
      ],
      keyPoints: [
        'Amdahl caps speedup at 1 / serial fraction.',
        'USL coherence (β) makes throughput fall after a peak — retrograde scaling.',
        'Shared-nothing partitioning drives α and β toward zero; scale by adding groups, not growing one.',
      ],
      source: 'Neil Gunther — Guerrilla Capacity Planning (USL)',
    },
  ],
  codeChallenges: [
    {
      id: 'fund-scalability-cc-1',
      title: 'Make a stateful NestJS service safe to scale horizontally',
      context:
        'A checkout API ran fine on one pod. After moving to 6 pods behind a round-robin LB with HPA, users report random "session expired" errors, some customers get 6× the allowed login attempts, and the nightly abandoned-cart email is sent 6 times. Scale-in events occasionally drop in-flight requests.',
      task: 'Refactor the service so any pod can serve any request, rate limiting is global, the nightly job runs exactly once per night across the fleet, and scale-in does not drop requests. Keep it NestJS + ioredis.',
      starter: {
        language: 'typescript',
        title: 'checkout.service.ts (starter)',
        code: `import { Injectable, UnauthorizedException, HttpException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';

const sessions = new Map<string, { userId: string; cart: string[] }>(); // per-process!
const loginAttempts = new Map<string, number>();                          // per-process!

@Injectable()
export class CheckoutService {
  login(email: string, ok: boolean): string {
    const n = (loginAttempts.get(email) ?? 0) + 1;
    loginAttempts.set(email, n);                 // never expires, never shared
    if (n > 5) throw new HttpException('Too many attempts', 429);
    if (!ok) throw new UnauthorizedException();
    const sid = randomUUID();
    sessions.set(sid, { userId: email, cart: [] });
    return sid;
  }

  addToCart(sid: string, sku: string) {
    const s = sessions.get(sid);                 // missing on 5 of 6 pods
    if (!s) throw new UnauthorizedException('session expired');
    s.cart.push(sku);
  }

  @Cron('0 2 * * *')
  async sendAbandonedCartEmails() {
    for (const s of sessions.values()) {         // runs on every pod, sees 1/6 of carts
      if (s.cart.length) await this.email(s.userId);
    }
  }

  private async email(userId: string) { /* ... */ }
}`,
      },
      hints: [
        'List every piece of state held in process memory and decide where each belongs so that it survives a pod being killed.',
        'Rate-limit counters need an atomic increment with an expiry that is shared by all pods.',
        'A cron decorator runs on every replica; you need either a lock with a TTL or to move the job to a queue/scheduler.',
      ],
      solution: {
        language: 'typescript',
        title: 'checkout.service.ts (stateless, horizontally scalable)',
        code: `import { Injectable, UnauthorizedException, HttpException, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

const SESSION_TTL_S = 1800;
const ATTEMPT_WINDOW_S = 900;

@Injectable()
export class CheckoutService implements OnApplicationShutdown {
  constructor(private readonly redis: Redis, private readonly carts: CartRepository) {}

  async login(email: string, ok: boolean): Promise<string> {
    const key = 'login:attempts:' + email.toLowerCase();
    // Atomic, fleet-wide counter; the window starts on the first attempt.
    const [[, n]] = (await this.redis.multi().incr(key).expire(key, ATTEMPT_WINDOW_S, 'NX').exec()) as [[null, number]];
    if (n > 5) throw new HttpException('Too many attempts', 429);
    if (!ok) throw new UnauthorizedException();
    await this.redis.del(key);
    const sid = randomUUID();
    await this.redis.set('sess:' + sid, JSON.stringify({ userId: email }), 'EX', SESSION_TTL_S);
    return sid;
  }

  async addToCart(sid: string, sku: string) {
    const raw = await this.redis.getex('sess:' + sid, 'EX', SESSION_TTL_S); // sliding expiry
    if (!raw) throw new UnauthorizedException('session expired');
    const { userId } = JSON.parse(raw) as { userId: string };
    await this.carts.addItem(userId, sku);       // carts are business data: durable DB, not session
  }

  @Cron('0 2 * * *')
  async sendAbandonedCartEmails() {
    const lockKey = 'lock:abandoned-cart:' + new Date().toISOString().slice(0, 10);
    // Only one pod per day acquires the lock; TTL covers crashes mid-run.
    const got = await this.redis.set(lockKey, process.env.HOSTNAME ?? 'pod', 'EX', 6 * 3600, 'NX');
    if (got !== 'OK') return;
    for await (const batch of this.carts.abandonedSince(24 * 3600)) {
      await Promise.all(batch.map((c) => this.email(c.userId, c.id))); // email() dedupes by cart id
    }
  }

  async onApplicationShutdown() {
    await this.redis.quit();                     // app.enableShutdownHooks() drains HTTP first
  }

  private async email(userId: string, cartId: string) { /* idempotent send keyed by cartId */ }
}

interface CartRepository {
  addItem(userId: string, sku: string): Promise<void>;
  abandonedSince(seconds: number): AsyncIterable<{ id: string; userId: string }[]>;
}`,
      },
      explanation: `**Fixes, one per bug:**
- **Sessions → Redis with TTL** (sliding via GETEX). Any pod can serve any request, so the LB can use round-robin or least-outstanding-requests and pods can be killed freely. No sticky sessions needed.
- **Cart moved to a durable repository.** A cart is business data that should survive session expiry and Redis eviction; the session holds only identity.
- **Global rate limit:** INCR + EXPIRE NX in a MULTI is atomic and shared across the fleet, and the window actually expires (the starter's Map grew forever — a memory leak and a permanent lockout).
- **Cron runs once:** the per-day SET NX EX lock means exactly one pod wins; the TTL releases it if that pod dies. The job now scans the *durable* store rather than one pod's 1/6 slice of memory. Emails are idempotent by cart id so a retry after a crash does not double-send. (For heavier jobs, use a queue such as BullMQ repeatable jobs or a k8s CronJob.)
- **Graceful shutdown:** enableShutdownHooks + onApplicationShutdown lets Kubernetes send SIGTERM, the LB stop routing, and in-flight requests finish before the pod exits.

The general rule: **the app tier holds no state that matters after the response is sent.**`,
      followUps: [
        {
          "q": "Scale-in kills the pod running the abandoned-cart job at 02:30, halfway through. What happens with this code, and how do you fix it?",
          "a": "The lock is still held until its 6-hour TTL, and `@Cron` won't fire again until tomorrow, so half the emails are silently never sent. Make the job resumable: enqueue it to a durable queue (BullMQ repeatable job or a k8s CronJob with retries), process carts in batches with a checkpoint (last cart ID), and record sent emails by cart ID so a restart skips them. Alert if the job hasn't recorded completion by, say, 04:00."
        },
        {
          "q": "The login limiter is keyed by email. What abuse does that allow, and what would you add?",
          "a": "An attacker can lock out any victim by sending 6 bad passwords for their email (denial of service), and credential stuffing that tries one password per email across millions of emails is never limited. Add a per-IP and per-subnet limit, a global failed-login rate alarm, and replace hard lockouts with progressive delays or a CAPTCHA after N failures, so the real user can still log in. Keys should be normalised (lowercase, trimmed) so variants don't bypass the counter."
        }
      ],
    },
    {
      id: 'fund-scalability-cc-2',
      title: 'Tame tail latency in a fan-out product-page aggregator',
      context:
        'A GraphQL/BFF resolver builds the product page from 5 downstream services. Each downstream has p50 ≈ 20 ms and p99 ≈ 300 ms. Page p50 is 180 ms and p99 is 4 s; when the reviews service degraded last week, the whole product page returned 500s for 40 minutes and the BFF pods ran out of memory from piled-up requests.',
      task: 'Rewrite the aggregator so the page p99 is bounded (target < 400 ms), non-critical dependencies cannot take the page down, and a slow dependency cannot exhaust BFF resources. Price and inventory are critical; reviews, recommendations and badges are optional.',
      starter: {
        language: 'typescript',
        title: 'product-page.aggregator.ts (starter)',
        code: `import axios from 'axios';

export async function getProductPage(productId: string) {
  // Sequential awaits: latencies ADD (5 x p50 = ~100ms best case)
  const price = (await axios.get('http://pricing/prices/' + productId)).data;
  const stock = (await axios.get('http://inventory/stock/' + productId)).data;
  const reviews = (await axios.get('http://reviews/products/' + productId)).data;
  const recs = (await axios.get('http://recs/similar/' + productId)).data;
  const badges = (await axios.get('http://badges/' + productId)).data;

  // No timeouts: axios default timeout is 0 (wait forever).
  // Any failure (even badges) throws -> whole page is a 500.
  return { productId, price, stock, reviews, recs, badges };
}`,
      },
      hints: [
        'Which of these calls depend on each other? Latency of independent calls should be max(), not sum().',
        'Give the whole page a deadline and derive each call\'s timeout from what remains; treat optional data differently from critical data.',
        'Timeouts alone do not stop a flood of retries/pile-ups against a sick dependency — think about failing fast and hedging only where safe.',
      ],
      solution: {
        language: 'typescript',
        title: 'product-page.aggregator.ts (bounded tail, graceful degradation)',
        code: `import CircuitBreaker from 'opossum';

const PAGE_DEADLINE_MS = 350;

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return (await r.json()) as T;
}

// One breaker per optional dependency: after 50% failures in the window it opens
// and fails instantly for 10s, so a sick service can't pile up requests in the BFF.
const breaker = (name: string) =>
  new CircuitBreaker((url: string, signal: AbortSignal) => getJson(url, signal), {
    name, errorThresholdPercentage: 50, resetTimeout: 10_000, volumeThreshold: 20,
  });
const reviewsCb = breaker('reviews');
const recsCb = breaker('recs');
const badgesCb = breaker('badges');

// Optional data: bounded by its own budget, falls back to null (UI hides the widget).
async function optional<T>(cb: CircuitBreaker, url: string, budgetMs: number): Promise<T | null> {
  try {
    return (await cb.fire(url, AbortSignal.timeout(budgetMs))) as T;
  } catch {
    return null;
  }
}

export async function getProductPage(productId: string) {
  const deadline = AbortSignal.timeout(PAGE_DEADLINE_MS);   // whole-page budget

  // All five start concurrently: page latency ~ max(), not sum().
  const [price, stock, reviews, recs, badges] = await Promise.all([
    getJson('http://pricing/prices/' + productId, deadline),  // critical: failure -> error
    getJson('http://inventory/stock/' + productId, deadline), // critical: failure -> error
    optional(reviewsCb, 'http://reviews/products/' + productId, 150),
    optional(recsCb, 'http://recs/similar/' + productId, 120),
    optional(badgesCb, 'http://badges/' + productId, 80),
  ]);

  const degraded = [reviews, recs, badges].some((x) => x === null);
  return { productId, price, stock, reviews, recs, badges, degraded };
}`,
      },
      explanation: `**What changed and why:**
- **Parallel instead of sequential:** independent calls now overlap, so the page costs max(latencies) instead of their sum — the p50 drops from ~180 ms to roughly the slowest single call (~25–40 ms).
- **Deadlines everywhere:** axios defaults to no timeout; a hung downstream held sockets and memory until the BFF OOM'd. A 350 ms page deadline caps the critical calls; optional calls get smaller budgets tuned just above their p95–p99.
- **Soft dependencies:** reviews/recs/badges return null on failure, and the response carries a degraded flag so the UI hides those widgets. The reviews outage would now cost a widget, not the page — this is the "turn serial dependencies into soft ones" availability lever.
- **Circuit breakers:** when a dependency is failing, the breaker opens and fails in microseconds instead of burning a 150 ms budget and a socket per request; this protects both the BFF and the struggling service (no retry storm).
- **Tail math:** with 5 calls each 1% slow, ~4.9% of pages previously hit some p99; now each optional call is truncated at its budget, so page p99 is bounded by the deadline rather than by the worst dependency.
- **Optional extra:** for idempotent critical reads (pricing), add a hedged request after ~p95 to shave the remaining tail; don't hedge writes.`,
      followUps: [
        {
          "q": "Pricing has p99 ≈ 300 ms and the page deadline is 350 ms. With two critical calls, how often does the page fail, and what do you do about it?",
          "a": "Each critical call at a 300 ms p99 exceeds ~350 ms somewhat less than 1% of the time, so with two of them roughly 1–2% of pages could fail on the deadline — far too many errors. Hedge both idempotent reads at their p95 so a second replica races the slow one, and keep a short-lived fallback such as a last-known price from a local cache with a 'price confirmed at checkout' rule. Critical doesn't have to mean must be fresh on every render."
        },
        {
          "q": "How would you test and observe that a degraded reviews service really costs only a widget?",
          "a": "Fault-inject in staging and in production game days: use Toxiproxy or a service mesh to add 2 s of latency and 50% errors to reviews, then assert the page p99 stays under 400 ms, `degraded: true` appears, and BFF memory stays flat. Emit metrics per dependency: timeout rate, breaker state, fallback count. Alert on breaker-open duration, and track the share of pages served degraded as an SLI, so a permanently degraded widget doesn't go unnoticed."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'fund-scalability-iq-01',
      difficulty: 'hard',
      question:
        'Product wants a 99.99% availability SLA for checkout. The checkout call path touches the API gateway, checkout service, inventory, pricing, a Postgres primary, and a third-party payment provider that publishes a 99.9% SLA. Is 99.99% achievable? What would you change?',
      whatInterviewerLooksFor: [
        'Does the serial availability math correctly and shows the product caps the SLA',
        'Recognises the third-party 99.9% as a hard ceiling for synchronous paths',
        'Proposes architectural levers: soft dependencies, async capture, multi-provider, redundancy',
        'Talks about correlated failures and MTTR, not just replicas',
        'Distinguishes SLA (contract) from SLO (internal target) and how "available" is measured',
      ],
      modelAnswer: `### 1. Do the math first
Serial path: gateway 99.99% × checkout 99.99% × inventory 99.99% × pricing 99.99% × Postgres 99.95% × payment 99.9% ≈ **99.81%** ≈ 82 min/month of downtime. 99.99% allows **4.3 min/month**. With a synchronous 99.9% dependency, 99.99% is mathematically impossible as designed.

### 2. Remove the payment provider from the serial path
- **Multi-provider with failover** (e.g. Stripe + Adyen): if failures are independent, 1 − 0.001² = 99.9999% for that stage. Requires tokenization that works for both and a routing layer with health checks.
- **Async authorization** where the business allows it: accept the order ("order received"), authorize in the background with retries and idempotency keys, email on failure. The user-facing SLI then depends only on our own stack.

### 3. Shrink the rest of the chain
- **Pricing** → cache prices with a short TTL and serve stale on failure (soft dependency).
- **Inventory** → reserve optimistically; reconcile asynchronously for low-risk SKUs.
- **Postgres** → Multi-AZ with automatic failover (~30–60 s) — that alone can consume a quarter of the monthly budget, so rehearse it and keep connection retry logic tight.

### 4. Attack MTTR and correlation
At 4 minutes a month, humans cannot be in the loop: automated rollback on SLO burn, canaries, cell-based deployment so one bad deploy hits one cell, and multi-AZ spreading.

### 5. Negotiate the number
Propose an **SLO of 99.95% on our side**, an SLA of 99.9% with credits, and define the SLI as "successful checkout submissions in < 2 s", excluding client errors. Quote the cost: 99.99% roughly means multi-provider payments, active-active or fast-failover DB, and automated remediation — a quarter of engineering work, not a config change.`,
      followUps: [
        {
          q: 'The second payment provider fails at the same time as the first 20% of the time. What does that do to your math?',
          a: 'Independence breaks. With a 20% correlation (e.g. shared card network or issuer outage), the combined unavailability is roughly 0.2 × 0.001 + 0.8 × 0.001² ≈ 0.0002, i.e. ~99.98%, not 99.9999%. Redundancy only helps as much as failures are independent; you still need the async fallback.',
        },
        {
          q: 'How would you measure the SLI so the number is honest?',
          a: 'Request-based at the edge: good = 2xx/expected 4xx within the latency threshold, over valid requests, measured at the load balancer or synthetic probes from outside, over a rolling 28–30 days. Server-side-only uptime checks miss DNS, LB, and client-visible latency failures.',
        },
        {
          q: 'Is Postgres failover compatible with 99.99%?',
          a: 'Only if it is rare and fast. One 60 s failover per month uses ~23% of the 4.3-minute budget; add connection storms and retries and it can be several minutes. You would need fast failover (Patroni/RDS Multi-AZ tuned), clients that reconnect quickly, and planned failovers only during low traffic.',
        },
      ],
      pitfalls: [
        'Saying "just add more replicas" without noticing the 99.9% dependency caps the chain',
        'Multiplying availabilities but assuming redundant components fail independently',
        'Ignoring failover time and deploy-induced outages, which dominate real downtime',
        'Committing to 99.99% without stating the cost and the SLI definition',
      ],
    },
    {
      id: 'fund-scalability-iq-02',
      difficulty: 'expert',
      question:
        'After a marketing campaign doubled traffic, your NestJS API\'s p99 went from 80 ms to 2 s. The on-call engineer tripled the pod count from 20 to 60 and p99 got worse — now 3.5 s with some 503s. Walk me through what is probably happening and how you would fix it.',
      whatInterviewerLooksFor: [
        'Recognises that scaling a non-bottleneck tier can worsen the real bottleneck',
        'Uses connection math (pods × pool size) and queueing intuition',
        'Structured diagnosis: USE/RED, traces, pool wait metrics, DB stats',
        'Short-term mitigation vs long-term fix separated',
        'Mentions load shedding / backpressure',
      ],
      modelAnswer: `### Hypothesis: the bottleneck is downstream, most likely Postgres
If API pods were CPU-bound, 3× pods would have helped. It got worse, so the constraint is shared. Each pod has a pg pool of, say, 20 → connections went from **400 to 1,200**. Postgres uses a process per connection; beyond a few hundred active connections, context switching, lock contention and memory per backend increase, and each query gets *slower*. Slower queries hold connections longer (Little's Law: L = λW), pools queue, request timeouts fire, and retries add more load — a positive feedback loop.

### Confirm in 5 minutes
- API: pg pool waitingCount and connection-acquire time up; event-loop lag normal; CPU low → waiting, not computing.
- DB: CPU/IO near saturation, active connections near max_connections, pg_stat_statements showing one or two queries dominating total time, lock waits.
- Traces: the slow span is the DB call or pool acquire.

### Immediate mitigation
1. **Scale pods back down** (or cut pool max per pod) so total connections are ~2–4× DB cores.
2. Put **PgBouncer in transaction mode** in front of Postgres so 60 pods multiplex onto ~100 server connections.
3. **Load-shed**: fail fast on pool-acquire timeout (e.g. 200 ms) with 503 + Retry-After instead of queueing; disable client retries without jitter.
4. Cache the hottest read (campaign landing product) in Redis with a short TTL.

### Durable fix
- Fix the top query (index, remove N+1, avoid SELECT *).
- Read replicas for read-heavy endpoints; keep the primary for writes.
- Autoscale on a signal that reflects the true bottleneck (in-flight requests, pool saturation), and cap maxReplicas based on the DB's connection budget.
- Load-test at 3× forecast before the next campaign.`,
      followUps: [
        {
          q: 'How would you pick the right number of DB connections?',
          a: 'Start from the DB side: a common heuristic is ~(2 × cores) + effective spindles for active connections, e.g. ~20–50 on a 16-core box doing OLTP. Then Little\'s Law on the app side: peak QPS × hold time tells you needed concurrency. If the app needs more than the DB can run efficiently, queue in the pooler, not in Postgres.',
        },
        {
          q: 'Why did 503s appear only after scaling up?',
          a: 'More in-flight work per unit time pushed DB latency past the request timeout; timed-out requests had often already consumed DB capacity (wasted work), and retries multiplied the offered load. Timeouts without load shedding convert overload into both errors and extra load.',
        },
        {
          q: 'What autoscaling signal would you use instead of CPU?',
          a: 'Concurrency/in-flight requests per pod or RPS per pod against a measured capacity, with a ceiling derived from downstream limits. CPU is fine for CPU-bound tiers but misleading for I/O-bound Node services that sit idle while waiting on a saturated dependency.',
        },
      ],
      pitfalls: [
        'Assuming more pods always means more capacity',
        'Blaming Node\'s single thread without evidence (event-loop lag was fine)',
        'Raising max_connections on Postgres as the fix',
        'Not separating the tonight fix from the next-sprint fix',
      ],
    },
    {
      id: 'fund-scalability-iq-03',
      difficulty: 'hard',
      question:
        'You inherit a 6-year-old Node monolith that runs as 2 VMs with sticky sessions on the load balancer. Sessions, uploaded files and a few in-memory caches live on each VM. You need to move to Kubernetes with autoscaling from 3 to 50 pods — without logging anyone out. How do you do it?',
      whatInterviewerLooksFor: [
        'Inventories all hidden state, including crons, local files and in-memory caches',
        'Zero-downtime migration plan (dual-read / dual-write sessions)',
        'Understands the trade-offs of Redis sessions vs JWT',
        'Handles singleton jobs and graceful shutdown',
        'Explains why sticky sessions are not a scaling strategy',
      ],
      modelAnswer: `### Step 0 — Inventory state
Grep and runtime-audit for: session store (likely MemoryStore or file store), uploads written to local disk, in-memory caches (config, permissions, rate limits), cron jobs, WebSocket subscriptions, and anything keyed by hostname. Each gets a home.

### Step 1 — Sessions without logouts
- Stand up Redis (managed, Multi-AZ; a small cluster handles 100K+ ops/s).
- Deploy a **dual-read session store**: read from Redis, fall back to the local store; on a local hit, **write it through to Redis**. Writes go to both.
- Keep sticky sessions on during this phase. After one max-session-TTL (e.g. 30 min–24 h), every active session is in Redis.
- Switch to Redis-only reads, then turn off stickiness.

### Step 2 — Files
Move uploads to S3: new uploads via pre-signed URLs direct from the browser; background-copy the historic files; serve through a CDN. The app stores only object keys.

### Step 3 — Caches and singletons
- Caches that tolerate staleness stay local with short TTLs (per-pod is fine). Caches that must be consistent (permissions after revocation) move to Redis or use pub/sub invalidation.
- Cron jobs: move to a k8s CronJob or queue-based repeatable jobs, or guard with a Redis lock with TTL; make handlers idempotent.

### Step 4 — Make pods disposable
Readiness/liveness probes, SIGTERM handling (stop accepting, drain in-flight requests within terminationGracePeriodSeconds), preStop hook to let the LB deregister, 12-factor config from env/secrets.

### Why not keep stickiness?
Hot users pin to a pod (uneven load), scale-in logs users out, deploys must drain for the TTL duration, and a pod crash loses state. Stickiness can remain as a cache-locality optimization later, but correctness must not depend on it.

### JWT alternative
Stateless tokens remove the Redis hop but make revocation (logout, password reset) hard; I'd keep server-side sessions for a legacy app and consider short-lived JWTs only for service-to-service.`,
      followUps: [
        {
          q: 'Redis becomes the new SPOF for login. How do you mitigate?',
          a: 'Managed Redis with replica + automatic failover across AZs, client timeouts and fast reconnect, and a degradation policy: for read-only anonymous pages don\'t touch sessions at all. Sessions are recoverable (users can log in again), so AOF persistence every second is enough; don\'t over-engineer durability.',
        },
        {
          q: 'How large is the Redis footprint for 2M active sessions at 1 KB each?',
          a: 'About 2 GB raw, ~3 GB with Redis overhead per key; with a replica ~6 GB total. Small — one modest node pair, no sharding needed.',
        },
      ],
      pitfalls: [
        'Big-bang cutover that logs everyone out',
        'Forgetting cron jobs, which then run 50 times',
        'Keeping uploads on a shared NFS volume as a "quick fix" that becomes a new SPOF',
        'Ignoring graceful shutdown, so autoscale-in drops requests',
      ],
    },
    {
      id: 'fund-scalability-iq-04',
      difficulty: 'expert',
      question:
        'Our search service fans out every query to 50 index shards and merges results. Each shard has p50 = 8 ms and p99 = 120 ms, yet the search API\'s p50 is 90 ms and p99 is over 400 ms. Explain the numbers and design a fix.',
      context: 'Shards are replicated 2× and queries are read-only.',
      whatInterviewerLooksFor: [
        'Computes the tail amplification (1 − 0.99^50) and connects backend p99 to user p50',
        'Knows hedged/tied requests and their load cost',
        'Proposes partial results with a deadline and product agreement',
        'Addresses root causes of shard tail (GC, compaction, hot shards)',
        'Considers reducing fan-out structurally',
      ],
      modelAnswer: `### Why the median looks like a shard p99
The aggregator waits for the slowest of 50 shards. P(at least one shard above its p99) = 1 − 0.99⁵⁰ ≈ **39.5%**. The probability that at least one shard exceeds its p95 is 1 − 0.95⁵⁰ ≈ **92%**. So the *typical* query is gated by a shard's p95–p99, which explains p50 ≈ 90 ms; the query p99 is gated by shard p99.9-ish events (GC pauses, merges) — hence 400 ms+.

### Fixes, in order of leverage
1. **Hedged requests**: after ~p95 of shard latency (say 25 ms) send the same sub-query to the other replica, take the first answer, cancel the loser. Since only ~5% of sub-requests hedge, extra load is ~5%. Safe because queries are idempotent reads.
2. **Per-shard deadline + partial results**: overall budget 150 ms; if 1–2 shards miss, return results from the 48–49 that answered, flagged as partial. For relevance-ranked search that is almost always acceptable; agree with product.
3. **Load-aware routing**: pick replicas by least-outstanding-requests / power-of-two-choices so a GC-pausing replica stops receiving work.
4. **Fix shard tails at the source**: tune GC/heap, throttle background segment merges, avoid hot shards (rebalance), keep indexes in page cache.
5. **Reduce fan-out**: route by a partition key when the query allows (tenant, region), or use a two-tier index so most queries touch a few shards. Going from 50 to 10 shards per query drops P(tail hit) at p99 from 39.5% to 9.6%.

### Expected outcome
With hedging at p95, the effective per-shard latency distribution tail collapses (a sub-request is slow only if *both* replicas are slow), so the query p50 approaches ~20–30 ms and p99 is capped by the deadline.`,
      followUps: [
        {
          q: 'Why not hedge immediately — send every sub-query to both replicas?',
          a: 'That doubles load on the entire fleet, raising utilization and therefore queueing latency for everyone; in the worst case you create the tail you were trying to hide. Hedging after p95 gets most of the benefit for ~5% extra load.',
        },
        {
          q: 'How do hedged requests interact with overload?',
          a: 'Under overload every replica is slow, hedges fire constantly and add load. Cap the hedge rate (e.g. hedges ≤ 5–10% of requests via a token bucket) and disable hedging when the error budget or queue depth indicates overload.',
        },
      ],
      pitfalls: [
        'Reporting average latency and concluding everything is fine',
        'Hedging non-idempotent operations',
        'Suggesting more shards to "spread load", which increases fan-out and tail risk',
      ],
    },
    {
      id: 'fund-scalability-iq-05',
      difficulty: 'hard',
      question:
        'A pricing service must handle 12,000 RPS at peak. Load tests show one pod does 1,000 RPS at 100% CPU with a mean service time of 4 ms, but p99 becomes unacceptable above ~800 RPS. How many pods do you run and how do you configure autoscaling?',
      whatInterviewerLooksFor: [
        'Explains the utilization-latency curve (queueing) behind the 800 RPS knee',
        'Uses a target utilization with headroom and N+1 / AZ-loss math',
        'Considers scale-up lag and burst handling',
        'Chooses an autoscaling signal and bounds',
      ],
      modelAnswer: `### Why p99 degrades before 100%
Queueing: time in system ≈ S / (1 − ρ). At 80% utilization, W ≈ 5 × 4 ms = 20 ms average, and the tail is far worse because variance in arrivals and service times compounds (plus GC pauses in Node). The knee at ~800 RPS/pod is exactly where queueing takes over. So plan for **~65% of max = 650 RPS per pod** at steady peak.

### Pod count
- Base: 12,000 / 650 ≈ **19 pods**.
- **Survive an AZ loss** (3 AZs): remaining two-thirds must carry peak at ≤ 80% (the knee) → need 12,000 / 800 = 15 pods in 2 AZs → 7.5 per AZ → **8 per AZ = 24 pods**.
- Result: run **24 at peak**; utilization during normal operation ≈ 12,000 / 24 = 500 RPS/pod (50%), rising to ~750 (75%) if an AZ disappears — still under the knee.

### Autoscaling
- HPA target: ~60% CPU, or better, RPS/in-flight per pod via custom metrics at ~600 RPS.
- minReplicas: the AZ-safe floor for normal off-peak traffic (e.g. 9 = 3 per AZ), spread with topology constraints.
- Scale-up lag: metrics scrape + HPA sync + pod start + readiness ≈ 60–120 s. For predictable peaks (campaigns, 9 am), **schedule** pre-scaling; for bursts, the 50% headroom absorbs the first 2 minutes.
- Scale-down slowly (stabilization window 5–10 min) to avoid flapping.

### Also
Rate-limit or shed load above a per-pod concurrency limit (Little's Law: 650 RPS × 4 ms ≈ 3 in-flight on average; cap at, say, 30) so overload produces fast 503s rather than a latency collapse.`,
      followUps: [
        {
          q: 'Would you choose fewer, bigger pods?',
          a: 'For Node, one process uses one core for JS execution, so bigger pods need multiple processes (cluster/workers) anyway. More small pods give finer-grained scaling and smaller blast radius per pod failure; fewer big ones reduce per-pod overhead (sidecars, connection pools to DB). Typical sweet spot: 1–2 vCPU per Node pod.',
        },
        {
          q: 'Traffic doubles in 30 seconds during a flash sale. What happens?',
          a: 'Autoscaling cannot react in 30 s. Headroom absorbs up to ~1.5× (500 → 750 RPS/pod); beyond that, the concurrency limiter sheds load with 503/Retry-After, and edge caching of prices (even 1–5 s TTL) cuts origin traffic. Pre-scale for known events.',
        },
      ],
      pitfalls: [
        'Dividing peak by max throughput (12 pods) and running at 100%',
        'Ignoring AZ failure and scale-up lag',
        'Autoscaling on CPU for an I/O-bound service without checking',
      ],
    },
    {
      id: 'fund-scalability-iq-06',
      difficulty: 'medium',
      question:
        'Your status dashboard has shown 99.99% uptime for the quarter, but support tickets about "the app is broken" doubled. How can both be true, and how would you redefine what you measure?',
      whatInterviewerLooksFor: [
        'Distinguishes availability, reliability/correctness and latency',
        'Knows the difference between probe-based uptime and request-based SLIs',
        'Mentions partial outages, dependency failures, and client-visible latency',
        'Proposes concrete SLIs/SLOs and alerting on burn rate',
      ],
      modelAnswer: `### How both can be true
- **Probe-based uptime** hits /health every 60 s. Health returns 200 even when the DB is slow or a critical dependency is broken (shallow health check). A 90-second outage between probes may never register.
- **Partial outages**: one shard/region/tenant broken = 5% of users down, 0% on the dashboard.
- **Slow is the new down**: responses in 8 s count as "up" but mobile clients time out at 5 s.
- **Correctness failures**: the service returns 200 with stale prices, empty lists, or wrong balances — available but not **reliable**.
- **Client-side failures**: bad app release, CDN/DNS issues, TLS cert problems on one edge — the server never sees the request.

### What I'd measure instead
Request-based SLIs per critical user journey (login, search, checkout):
- **Availability SLI** = good / valid requests at the load balancer, where good = non-5xx **and** latency < threshold.
- **Latency SLI** = % of requests < 300 ms (p99-driven threshold) — separately for reads and writes.
- **Correctness SLI** where it matters: e.g. reconciliation mismatch rate, % of search results with stale inventory, measured by a sampled checker.
- **Synthetic end-to-end probes** from multiple regions executing real journeys.
- **Client RUM** (real user monitoring) error and latency from the mobile/web apps.

### Operating it
SLO e.g. 99.9% of checkout requests good over 28 days → 0.1% error budget. Alert on **multi-window burn rate** (e.g. 14.4× over 1 h and 5 min) instead of static thresholds, and slice the SLI by region/tenant to catch partial outages.`,
      followUps: [
        {
          q: 'Should /health check the database?',
          a: 'Separate liveness from readiness. Liveness should be shallow (process alive) so a DB blip doesn\'t make Kubernetes restart every pod. Readiness can check critical dependencies with a short timeout and cached result, but beware of all pods going unready at once — that turns a degraded DB into a total outage.',
        },
        {
          q: 'What error budget does 99.9% over 28 days give at 50M requests/day?',
          a: '50M × 28 = 1.4B requests; 0.1% = 1.4M bad requests allowed, or about 40 minutes of total outage.',
        },
      ],
      pitfalls: [
        'Insisting the dashboard proves users are wrong',
        'Treating uptime as the only reliability metric',
        'Averaging over all users and hiding a broken segment',
      ],
    },
    {
      id: 'fund-scalability-iq-07',
      difficulty: 'expert',
      question:
        'We grew our distributed session-lock cluster from 8 to 24 nodes to handle more traffic and throughput dropped by 30%. Engineering leadership thinks it is a bug. Could it be expected? How would you prove it and what would you change?',
      whatInterviewerLooksFor: [
        'Knows retrograde scaling from the Universal Scalability Law (coherence cost)',
        'Identifies sources of cross-node coordination (broadcasts, quorum, gossip, lock traffic)',
        'Proposes measuring and fitting USL to load-test data',
        'Redesigns toward shared-nothing: partitioning, smaller consensus groups',
      ],
      modelAnswer: `### Yes — this is retrograde scaling
Amdahl's Law explains diminishing returns; it cannot explain throughput *going down*. The **Universal Scalability Law** can: C(N) = N / (1 + α(N − 1) + βN(N − 1)). The β term (coherence) is the cost of nodes keeping each other consistent and grows with N². Past the peak N* = √((1 − α)/β), each added node costs more in coordination than it contributes.

### Where β comes from in a lock cluster
- Every lock acquire needs a **quorum**: bigger membership = bigger quorums = more round trips and a slowest-of-many wait (tail amplification).
- **Broadcast invalidation** or membership **gossip** — messages per event grow with N, total traffic with N².
- A single leader handling all writes: more followers to replicate to, same leader CPU (α).
- Cross-node lock handoff for hot keys.

### Prove it
Load-test at N = 1, 2, 4, 8, 12, 16, 24 with fixed workload shape, record throughput, and fit α and β (a regression on the linearized USL form). If β is significant, the model predicts the peak — e.g. α = 0.05, β = 0.002 gives N* ≈ 22 and a declining curve after that. Corroborate with per-node metrics: messages/sec per node and RTTs rising with N.

### Fix
- **Partition instead of growing one group**: split the lock keyspace (hash by session/tenant) into many independent 3- or 5-node consensus groups. Each group has constant coordination cost; total capacity scales with the number of groups (α and β per request ~ constant).
- **Avoid global operations** (all-node broadcasts); use leases with TTLs so most operations are local.
- Reconsider need: many "locks" can become per-key ordering via a partitioned queue or optimistic concurrency (version checks) in the DB.`,
      followUps: [
        {
          q: 'Why do consensus systems like etcd or ZooKeeper recommend 3 or 5 nodes?',
          a: 'Quorum writes must reach a majority; more voters add latency and leader fan-out without adding write throughput. 5 nodes tolerate 2 failures, which is usually enough; scale reads with learners/observers and scale writes by sharding into more groups.',
        },
        {
          q: 'How is this different from a stateless API tier?',
          a: 'Stateless pods share nothing, so β ≈ 0 and α is small; they scale near-linearly until a shared downstream (DB, cache) becomes the serial fraction.',
        },
      ],
      pitfalls: [
        'Assuming more nodes can only help or stay flat',
        'Quoting Amdahl, which cannot produce a decline',
        'Growing a single consensus group instead of partitioning',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'fund-scalability-boe-1',
      question:
        'An order API peaks at 24,000 RPS across 40 pods. End-to-end p95 latency is 60 ms, of which 15 ms is spent holding a Postgres connection. How many requests are in flight, how many DB connections do you really need, and can each pod keep a pool of 50?',
      assumptions: [
        'Load is evenly balanced across 40 pods',
        'Use p95 times (not means) for sizing, plus 1.5× headroom for bursts',
        'Postgres primary: 32 vCPU; efficient active connections ≈ 2–4 × cores (~64–128)',
        'max_connections = 500, with ~20 reserved for admin/replication',
      ],
      steps: [
        { label: 'In-flight requests (Little\'s Law)', calc: 'L = λ × W = 24,000 × 0.060 s = 1,440 concurrent requests (36 per pod)' },
        { label: 'Busy DB connections', calc: '24,000 × 0.015 s = 360 connections busy on average; × 1.5 headroom ≈ 540' },
        { label: 'Per-pod pool need', calc: '540 / 40 ≈ 13–14 connections per pod' },
        { label: 'Pool of 50 per pod', calc: '50 × 40 = 2,000 connections > max_connections 500 → connection errors at scale-out' },
        { label: 'DB-side efficiency limit', calc: '360 active vs ~64–128 efficient on 32 cores → DB would be over-subscribed ~3–5×' },
      ],
      answer:
        '~1,440 requests in flight; ~360 DB connections busy on average (~540 with headroom), i.e. ~14 per pod. A pool of 50 per pod (2,000 total) is impossible and harmful.',
      insight:
        'Even correctly sized pools exceed what one Postgres runs efficiently, so the design needs PgBouncer in transaction mode (multiplexing ~540 client connections onto ~100 server connections), a shorter connection hold time (no remote calls inside transactions), and read replicas or caching for read traffic. Autoscaling maxReplicas must be capped by the DB connection budget.',
      followUps: [
        {
          "q": "The DB slows down and the connection hold time goes from 15 ms to 60 ms at the same 24K RPS. What happens to the fleet?",
          "a": "Busy connections become 24,000 × 0.060 = 1,440, four times the ~360 baseline and far beyond a ~100-connection PgBouncer server pool, so requests queue in the pooler and pods. Each queued request also holds pod memory, and end-to-end latency rises, so clients retry and add load. Without limits this is a death spiral. Fail fast on pool acquire (~100 ms), shed load with 503s, apply a concurrency limit per pod, and use a circuit breaker so the database can recover."
        },
        {
          "q": "Traffic doubles to 48K RPS and the team scales to 80 pods. Is the database plan still viable?",
          "a": "Busy connections double to 48,000 × 0.015 = 720, or ~1,080 with headroom, against ~64–128 efficient active connections on 32 cores. One primary can't run that, whatever the pooler does. Read traffic should move to replicas or a cache, so ask what share of the 15 ms is reads. Then cut the hold time (a smaller transaction or fewer round trips), and if writes alone exceed one primary, scale vertically or partition. Pods are cheap; the database is the scaling constraint."
        }
      ],
    },
    {
      id: 'fund-scalability-boe-2',
      question:
        'A home-feed endpoint calls 8 backend services in parallel and waits for all of them. Each backend has p99 = 200 ms (p95 = 60 ms). What fraction of feed requests will exceed 200 ms, and what does hedging after p95 buy you and cost you?',
      assumptions: [
        'Backend latencies are independent across services and across replicas',
        'Each backend has a second replica able to serve a hedged request',
        'Hedge fires at 60 ms (backend p95); the hedged copy has the same latency distribution',
        'A hedged call exceeds 200 ms only if the primary is slower than 200 ms AND the hedge (started at 60 ms) takes more than 140 ms (≈ its p98, so ~2%)',
      ],
      steps: [
        { label: 'Without hedging', calc: 'P(page > 200 ms) = 1 − 0.99⁸ ≈ 7.7% of feed loads' },
        { label: 'Per-call slow probability with hedging', calc: '≈ 0.01 × 0.02 = 0.0002 (both copies slow)' },
        { label: 'Page with hedging', calc: '1 − (1 − 0.0002)⁸ ≈ 0.16% of feed loads' },
        { label: 'Extra backend load', calc: 'hedges fire for ~5% of calls → ~5% more backend requests' },
        { label: 'Traffic view at 20K feed RPS', calc: '20,000 × 8 = 160K backend RPS → +8K RPS of hedges' },
      ],
      answer:
        '~7.7% of feed loads exceed 200 ms without hedging; with p95 hedging it drops to roughly 0.16% (~50× better) for ~5% extra backend load.',
      insight:
        'Fan-out turns a 1% backend tail into a user-visible ~8% problem. Hedging is cheap for idempotent reads, but the independence assumption breaks under overload, so cap hedges with a token bucket (e.g. ≤ 10% of requests) and pair it with a page deadline and partial rendering for optional services.',
      followUps: [
        {
          "q": "The feed grows to call 30 backend services in parallel. Redo the tail math with and without hedging.",
          "a": "Without hedging: 1 − 0.99³⁰ ≈ 26% of feed loads exceed 200 ms — a quarter of users see the slow path. With p95 hedging at ~0.0002 per call: 1 − (1 − 0.0002)³⁰ ≈ 0.6%. Hedge cost also grows to ~5% of 30 calls per page. At this fan-out, also question the architecture: precompute or cache optional sections (badges, counts) and fetch them lazily, so the critical path waits on fewer services."
        },
        {
          "q": "Two of the 8 services share a Cassandra cluster whose compactions cause both to be slow together. How does that change the estimate?",
          "a": "Correlated tails break the independence assumption both ways. Without hedging, the page is slow slightly less often than 7.7% (the two services' slowness overlaps), but when it happens both are slow. With hedging, a hedge to another replica on the same overloaded cluster is likely also slow, so the 0.0002 per-call figure is optimistic for those two. Fix the shared cause (throttle compaction, separate clusters) and measure joint tail probability from traces."
        }
      ],
    },
    {
      id: 'fund-scalability-boe-3',
      question:
        'Estimate the real annual availability of a single-region service: managed LB (99.99%), stateless pods across 3 AZs, and Postgres Multi-AZ that fails over about 4 times a year taking 90 s each. The team also ships roughly 2 bad deploys a year that take 20 minutes each to detect and roll back. Where should you invest to reach 99.99%?',
      assumptions: [
        'Pods across 3 AZs with N+1: pod/AZ failures are absorbed (≈ 0 downtime)',
        'LB downtime at its SLA: 0.01% of a year',
        'Each DB failover causes ~90 s of write errors plus ~30 s of reconnect churn',
        'Bad deploys cause full outage of the affected journey for their duration',
        '1 year ≈ 525,600 minutes',
      ],
      steps: [
        { label: 'LB', calc: '0.0001 × 525,600 ≈ 52.6 min/year' },
        { label: 'DB failovers', calc: '4 × (90 s + 30 s) = 480 s = 8 min/year' },
        { label: 'Bad deploys', calc: '2 × 20 min = 40 min/year' },
        { label: 'Total', calc: '52.6 + 8 + 40 ≈ 100.6 min/year' },
        { label: 'Availability', calc: '1 − 100.6 / 525,600 ≈ 99.981% (vs 99.99% budget = 52.6 min/year)' },
      ],
      answer:
        '~99.98% (about 100 minutes of downtime per year). The LB alone consumes the entire 99.99% budget, and deploys are the largest self-inflicted item.',
      insight:
        'Adding pods or DB replicas buys almost nothing here. Reaching 99.99% requires removing single-provider hard dependencies from the critical path (multi-region or multi-LB with DNS failover) and cutting deploy MTTR from 20 min to ~2 min via canaries with automatic rollback on SLO burn — MTTR, not MTBF, is the lever.',
      followUps: [
        {
          "q": "You add a second LB provider with DNS failover and cut deploy rollback to 2 minutes. Recompute the yearly downtime.",
          "a": "LB downtime no longer counts in full; each LB incident costs roughly the DNS failover time. Assuming a few incidents a year at ~5 minutes each (TTL plus client caching), call it ~20 minutes. Deploys: 2 × 2 min = 4 minutes. DB failovers stay at 8. Total ≈ 32 min/year ≈ 99.994%, inside the 52.6-minute 99.99% budget, with some margin. The DNS failover itself needs regular testing, or its first real use will fail."
        },
        {
          "q": "The team doubles and bad deploys go from 2 per year to 2 per month at 20 minutes each. What's the availability?",
          "a": "Deploys become 24 × 20 = 480 min/year, plus 52.6 for the LB and 8 for the DB ≈ 541 min ≈ 99.897% — under 99.9%. Deploy safety now dominates everything else. Automated canary analysis with rollback on SLO burn cuts each one to ~2 minutes: 48 + 52.6 + 8 ≈ 109 min ≈ 99.98%. Progressive delivery (1% → 10% → 100%) also shrinks blast radius, so a bad deploy costs a fraction of the traffic, not a full outage."
        }
      ],
    },
    {
      id: 'fund-scalability-boe-4',
      question:
        'A nightly reconciliation job takes 10 hours on one worker. Profiling shows 95% of the work is parallelizable per account; 5% is a final serial merge. Leadership wants it done in 1 hour, and later in 30 minutes. How many workers do you need and is 30 minutes possible?',
      assumptions: [
        'Parallel part scales perfectly across workers (no coherence cost)',
        'Serial part: 5% of 10 h = 30 min and cannot be parallelized as written',
      ],
      steps: [
        { label: 'Required speedup for 1 h', calc: '10 h / 1 h = 10×' },
        { label: 'Amdahl', calc: '1 / (0.05 + 0.95/N) = 10 → 0.05 + 0.95/N = 0.1 → N = 0.95 / 0.05 = 19 workers' },
        { label: 'Maximum possible speedup', calc: '1 / 0.05 = 20× → 10 h / 20 = 30 min with infinite workers' },
        { label: '30-minute target', calc: 'serial merge alone = 30 min → unattainable by adding workers' },
        { label: 'If the merge is made hierarchical (serial → 1%)', calc: '1 / (0.01 + 0.99/N) = 20 → 0.01 + 0.99/N = 0.05 → N = 0.99 / 0.04 ≈ 25 workers (10 h / 20 = 30 min)' },
      ],
      answer:
        '~19 workers for 1 hour. 30 minutes is impossible without changing the algorithm because the serial merge alone takes 30 minutes; shrinking the serial fraction to 1% (tree-merge per shard) makes 30 minutes reachable with ~25 workers.',
      insight:
        'Throwing machines at a job is bounded by its serial fraction. The engineering work is to shrink the serial part (hierarchical/partitioned merges, per-account commits, streaming reconciliation) — that raises the ceiling from 20× to 100×.',
      followUps: [
        {
          "q": "Next year the account count triples, and the merge cost scales with accounts too. With the tree-merge (1% serial), how many workers for 1 hour?",
          "a": "Single-worker time becomes 30 h: serial is 1% = 0.3 h, parallel 29.7 h. For 1 hour: 0.3 + 29.7 ÷ N ≤ 1 → N ≥ 29.7 ÷ 0.7 ≈ 42.4, so ~43 workers. Without the tree-merge (5% serial = 1.5 h) the 1-hour target is impossible at any worker count. So this design change is what keeps the job scalable as the data grows; re-measure the serial fraction each year, since it often creeps up."
        },
        {
          "q": "A worker dies 40 minutes in, and another is a straggler running 3× slower. How do you keep the 1-hour target?",
          "a": "Split work into many more chunks than workers (e.g. 500 account ranges for 19 workers) pulled from a queue, so a dead worker's in-progress chunk is retried by others and a slow worker simply takes fewer chunks. Checkpoint per chunk by writing results idempotently keyed by chunk ID, so retries don't double-apply. For stragglers, speculatively re-run the last few unfinished chunks on idle workers and take whichever finishes first (MapReduce-style backup tasks)."
        }
      ],
    },
  ],
  test: [
    {
      id: 'fund-scalability-mcq-01',
      difficulty: 'medium',
      question:
        'This NestJS app is deployed as 3 pods behind a round-robin load balancer with no session affinity. What will users experience after logging in?',
      code: {
        language: 'typescript',
        code: `app.use(session({
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  // no "store" option -> express-session's default MemoryStore
}));

@Get('me')
me(@Req() req: Request) {
  if (!req.session.userId) throw new UnauthorizedException();
  return { userId: req.session.userId };
}`,
      },
      options: [
        'Roughly two out of three requests return 401, because the session exists only in the memory of the pod that handled login',
        'Everything works because the session cookie is signed and carries the userId to every pod',
        'Sessions are replicated between pods lazily, so only the first request after login fails',
        'Login works but sessions leak memory only; users see no errors until a pod restarts',
      ],
      correct: [0],
      explanation: `The cookie carries only the session ID; the data lives in the MemoryStore of the pod that created it, so requests routed to the other two pods find no session (~2/3 of requests with round-robin). The signature only prevents tampering, it does not carry data. There is no built-in replication between Node processes. The memory leak is also true (MemoryStore is not for production), but it is not the user-visible symptom here. Fix: external store (Redis) — not sticky sessions.`,
      followUps: [
        {
          "q": "Someone 'fixes' it by enabling sticky sessions on the load balancer. What breaks next?",
          "a": "It hides the bug until a pod disappears: on every deploy, scale-in or crash, the users pinned to that pod lose their sessions and are logged out. Load also becomes uneven, because long-lived heavy users stay pinned to one pod while new pods get only new users, so autoscaling helps less. MemoryStore still leaks memory forever. The robust fix is an external session store such as Redis with a TTL, or stateless signed tokens (JWT) for identity, keeping only small session data server-side."
        },
        {
          "q": "You move sessions to Redis. How do you migrate without logging out the users who currently have in-memory sessions?",
          "a": "Deploy a read-through shim first: on each request, look up the session in Redis; if it's missing, fall back to the local MemoryStore and, if found there, copy it into Redis. Keep sticky sessions on during the transition so each user keeps hitting the pod that has their old session. After one session TTL (or the 'remember me' window), nearly every active session lives in Redis; then remove the fallback and stickiness. Users whose sessions expired naturally just log in again."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-02',
      difficulty: 'hard',
      question:
        'A request path is: API gateway (99.99%) → order service running as 2 independent replicas each 99.9% with automatic LB ejection → Postgres (99.95%) → a third-party tax API (99.9%) called synchronously. What is the approximate end-to-end availability?',
      options: [
        '≈ 99.95%, because the weakest in-house component (Postgres) sets the limit',
        '≈ 99.84% (~69 min/month): the replicated service is ~99.9999%, but the gateway, DB and tax API multiply in series',
        '≈ 99.74%, because the two order-service replicas multiply to 99.8%',
        '≈ 99.9%, because the availability of a chain equals its least available link',
      ],
      correct: [1],
      explanation: `Serial components multiply: 0.9999 × (1 − 0.001²) × 0.9995 × 0.999 ≈ 0.9984. Redundant replicas combine as 1 − product of unavailabilities, so the two 99.9% replicas are ~99.9999% — multiplying them (option 3) confuses parallel with serial. The chain is always worse than its weakest link, not equal to it, so options 1 and 4 are wrong. The design fix is to make the tax API a soft dependency (cache rates, compute async) because it dominates the budget.`,
      followUps: [
        {
          "q": "You make the tax API a soft dependency by caching rates locally. What's the new availability, and what's the next biggest contributor?",
          "a": "Without the tax API in series: 0.9999 × ~0.999999 × 0.9995 ≈ 99.94%, about 26 minutes per month instead of ~69. Now Postgres at 99.95% dominates, contributing ~22 of those minutes. Next levers: shorten its failover (faster detection, connection retries with backoff in the app), or serve reads from a cache/replica during failover so only writes fail. The cached tax rates also need a staleness limit and an alert, since rates change by jurisdiction."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-03',
      difficulty: 'expert',
      question:
        'You run two replicas of a service and your capacity plan assumes 1 − (1 − A)² availability. Select ALL situations that make that formula overly optimistic.',
      options: [
        'Both replicas receive the same release from one CI pipeline at the same time',
        'Both replicas read their feature flags from a single config service at request time',
        'Both replicas are scheduled on the same Kubernetes node because no anti-affinity is set',
        'Replicas run in different AZs, are deployed one at a time with canary analysis, and have no shared runtime dependency',
      ],
      correct: [0, 1, 2],
      explanation: `The parallel formula assumes independent failures. A simultaneous deploy (shared bad code), a shared runtime dependency (config service is in series with both), and shared hardware (same node) all correlate failures, so the real availability is much closer to a single replica. Option 4 is the textbook way to approach independence — separate failure domains, staggered changes, no shared dependency — so the formula is a reasonable approximation there.`,
      followUps: [
        {
          "q": "How would you actually measure whether your two replicas fail independently?",
          "a": "Look at incident history and metrics, not the formula: for every incident in the last few quarters, record whether one or both replicas were affected. If a large share of single-replica-impacting events also hit the other, the failures are correlated. Run game days: kill an AZ, a node, or the config service and watch whether both replicas degrade. Track per-replica error rates and compute the observed joint failure time directly; that empirical number replaces 1 − (1 − A)² in the capacity plan."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-04',
      difficulty: 'hard',
      question:
        'Each pod receives 400 RPS at peak, and every request holds a DB connection for ~50 ms. What happens with this pool configuration during peak?',
      code: {
        language: 'typescript',
        code: `export const pool = new Pool({
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});`,
      },
      options: [
        'Nothing notable: 10 connections can each run 20 queries per second, which covers 400 RPS',
        'Postgres rejects the extra connections with "too many clients", returning immediate errors',
        'Required concurrency is 400 × 0.05 = 20 > 10, so requests queue inside the pool; latency grows until requests wait up to 5 s and then fail',
        'The pool automatically grows past max during bursts and shrinks after idleTimeoutMillis',
      ],
      correct: [2],
      explanation: `By Little's Law the pod needs ~20 connections busy on average; with 10, the pool can serve only 10 / 0.05 = 200 RPS, so arrivals beyond that queue client-side. Option 1 does exactly that arithmetic incorrectly (10 × 20 = 200, not 400). Postgres never sees more than 10 connections from this pod, so there is no "too many clients" error. node-postgres never exceeds max. The long 5 s connectionTimeout makes it worse — fail fast (~100–300 ms) and size the pool properly.`,
      followUps: [
        {
          "q": "You raise max to 25 per pod. The service runs 30 pods and HPA can go to 60. What's the new problem?",
          "a": "Postgres now faces 30 × 25 = 750 connections, and 1,500 when HPA scales out — above typical max_connections and far beyond the cores × 2–4 a database runs efficiently. Scaling out under load makes the DB slower, which raises hold time, which demands more connections. Cap HPA max replicas by the connection budget, put PgBouncer in transaction mode in front, and shorten the 50 ms hold time (no remote calls inside transactions), which is the real multiplier."
        },
        {
          "q": "What connectionTimeoutMillis would you set instead of 5 s, and what should happen when it fires?",
          "a": "Set it near the request's latency budget, typically 100–300 ms. Waiting 5 s for a connection means the client has probably already given up, so the work is wasted and memory fills with queued requests. When it fires, return 503 with Retry-After (shedding load) and increment a 'pool acquire timeout' metric. Alert on pool wait time and the ratio of waiting to active clients — they reveal saturation minutes before error rates rise."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-05',
      difficulty: 'expert',
      question:
        'A load test uses 50 virtual users in a closed loop (each sends a request, waits for the response, then immediately sends the next). Measured throughput plateaus at ~500 RPS with ~100 ms latency, and server CPU is at 35%. The team concludes "the service maxes out at 500 RPS." What is the best interpretation?',
      options: [
        'Correct: the throughput plateau proves the service is saturated',
        'The load generator is the limit: by Little\'s Law 50 in-flight / 0.1 s = 500 RPS; increase virtual users or use an open-model (arrival-rate) test',
        'The server has a thread-pool bottleneck, because CPU at 35% means work is queued elsewhere',
        'Network bandwidth is saturated, since latency stays constant while throughput does not grow',
      ],
      correct: [1],
      explanation: `A closed-loop test with fixed concurrency L can never exceed L / W: 50 / 0.1 = 500 RPS, regardless of server capacity. Low CPU and constant latency indicate the server is not saturated — a saturated server shows rising latency. Option 3 is a plausible hypothesis only if latency were growing. Open-model tests (constant arrival rate, e.g. k6 constant-arrival-rate) also reveal queueing behaviour that closed loops hide (coordinated omission).`,
      followUps: [
        {
          "q": "You switch to an open-model test. At 1,400 RPS p99 jumps from 120 ms to 900 ms while CPU is 70%. What capacity do you publish?",
          "a": "Publish the highest arrival rate at which the SLO still holds, not the point where throughput stops growing. If p99 must stay under ~200 ms and it breaks at ~1,400 RPS, the usable capacity is something like 1,100–1,200 RPS per instance, and autoscaling targets should sit below that. The knee at 70% CPU suggests queueing in something besides CPU (event loop, a pool, a lock, GC), so profile at that load before trusting CPU-based autoscaling."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-06',
      difficulty: 'expert',
      question:
        'A BFF fans out every request to 20 microservices in parallel and waits for all. Each service independently exceeds its own p99 on 1% of calls. Roughly what fraction of BFF requests experience at least one backend p99-tail response?',
      options: ['≈ 1%', '≈ 18%', '≈ 20%', '≈ 63%'],
      correct: [1],
      explanation: `P(at least one slow) = 1 − 0.99²⁰ ≈ 18.2%. Option 1 assumes tails do not compound across fan-out. Option 3 adds probabilities linearly (20 × 1%), which overcounts overlap and fails badly at large N. Option 4 is the figure for a 100-way fan-out. The takeaway: at the BFF, the backend p99 becomes roughly the p82 — mitigate with deadlines, hedged reads and soft dependencies.`,
      followUps: [
        {
          "q": "15 of the 20 services are optional with fallbacks and a deadline; 5 are critical. What fraction of requests now wait on a backend tail, and how do you shrink it further?",
          "a": "Only the 5 critical calls can delay the response beyond the deadline: 1 − 0.99⁵ ≈ 4.9% of requests hit at least one critical p99. Optional calls are cut at their budget, so they cost a missing widget rather than latency. Hedging the 5 idempotent critical reads at their p95 brings each one's slow probability to roughly 0.0002, so the page-level figure falls to about 0.1%, for ~5% extra load on those services."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-07',
      difficulty: 'hard',
      question:
        'A teammate wraps all outbound calls in this helper to cut tail latency. What is the most serious problem?',
      code: {
        language: 'typescript',
        code: `async function hedged(url: string, init: RequestInit) {
  const first = fetch(url, init);
  const second = new Promise<Response>((res) =>
    setTimeout(() => res(fetch(url, init)), 50));
  return Promise.race([first, second]);
}

// used by: await hedged('http://payments/charges', { method: 'POST', body })`,
      },
      options: [
        'Promise.race rejects if the first call fails, so a transient error is never retried',
        'The 50 ms delay is too short; hedges should wait for the p99 rather than the p95',
        'Non-idempotent POSTs get sent twice whenever the first takes over 50 ms, causing duplicate charges; and the losing request is never aborted',
        'setTimeout inside a Promise blocks the event loop for 50 ms per request',
      ],
      correct: [2],
      explanation: `Hedging duplicates work by design, so it is only safe for idempotent operations (or with idempotency keys the server enforces). Here every slow payment request is sent twice, and because there is no AbortController the loser still completes — a duplicate charge. Option 1 is a real but secondary flaw (race settles on the first rejection too). Hedging at p99 would trigger too rarely to help; ~p95 is the usual choice. setTimeout does not block the event loop.`,
      followUps: [
        {
          "q": "You add an `Idempotency-Key` header to hedged POSTs. Both copies arrive at different payment pods within 1 ms. How must the server implement the key so only one charge happens?",
          "a": "The check must be atomic, not 'SELECT then INSERT'. Insert the key into a table with a unique constraint (or Redis SET NX) in state `in_progress` before calling the card network; the losing copy hits the conflict and waits on or polls the stored result, then returns the same response. Store the final response with the key for 24 h or more. Also bind the key to a hash of the request body so a reused key with different parameters is rejected."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-08',
      difficulty: 'expert',
      question:
        'FinOps proposes consolidating a latency-sensitive service from 20 pods at ~45% CPU to 10 pods at ~90% CPU. Treating each pod as a simple M/M/1-style queue, what happens to average time in system?',
      options: [
        'It roughly doubles, since each pod does twice the work',
        'It stays about the same until CPU hits 100%, because the pods still have headroom',
        'It rises about 5.5× (from ~1.8× to ~10× the service time), and the tail rises even more',
        'It drops, because fewer pods mean better cache locality and fewer connections',
      ],
      correct: [2],
      explanation: `W ≈ S / (1 − ρ): at ρ = 0.45 W ≈ 1.82 S; at ρ = 0.9 W ≈ 10 S — about a 5.5× increase in mean latency, with p99 amplifying further because queueing variance grows. Doubling (option 1) assumes linear behaviour; "fine until 100%" is the classic misconception. Cache locality effects are real but small compared to queueing at 90%. Target ~60–70% at peak for latency-sensitive tiers.`,
      followUps: [
        {
          "q": "Find a compromise: how many pods give a ~65% utilization target, and what does mean latency look like there?",
          "a": "Total work is 20 × 0.45 = 9 pod-equivalents. At ρ = 0.65 you need 9 ÷ 0.65 ≈ 13.8 → 14 pods, ~30% fewer than 20. With 14 pods ρ ≈ 0.64, so W ≈ S ÷ 0.36 ≈ 2.8 S versus 1.8 S today — roughly 55% higher mean latency, versus 5.5× at 90%. Validate with a canary at the new density, watching p99 rather than the mean, and keep autoscaling so peak traffic doesn't push utilization towards 90%."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-09',
      difficulty: 'medium',
      question:
        'A service fails on average every 10 days (MTBF = 240 h) and takes 2 hours to recover each time. You can fund one project this quarter. Which one improves availability the most?',
      options: [
        'Hardening work that doubles MTBF to 20 days',
        'Automated detection plus one-click rollback that cuts MTTR to 15 minutes',
        'Moving to larger instances so each node handles 2× traffic',
        'Adding a second on-call engineer so incidents get two people',
      ],
      correct: [1],
      explanation: `Availability = MTBF / (MTBF + MTTR). Today 240 / 242 ≈ 99.17%. Doubling MTBF gives 480 / 482 ≈ 99.59%; cutting MTTR to 0.25 h gives 240 / 240.25 ≈ 99.90%, far better. Bigger instances address capacity, not failure frequency or recovery. A second on-call person may help a little with diagnosis but does not remove the 2-hour manual recovery path the way automation does.`,
      followUps: [
        {
          "q": "The SLO is 99.9% per 30 days. With MTTR at 15 minutes and failures every 10 days, are you within the error budget?",
          "a": "99.9% of 30 days is a budget of 43.2 minutes. Three incidents a month × 15 minutes = 45 minutes — just over budget, so the SLO is still missed. You need both levers: also double MTBF (1.5 incidents/month ≈ 22.5 minutes), or shrink MTTR further with automatic rollback triggered by SLO burn-rate alerts, so detection takes ~2 minutes instead of a human noticing. Combined, MTBF 20 days and MTTR 15 minutes gives ~99.95%."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-10',
      difficulty: 'expert',
      question:
        'A coordination-heavy cluster was load-tested and fitted to the Universal Scalability Law as below. It currently runs 90 nodes and throughput is short of target. What should you expect from adding 20 more nodes?',
      code: {
        language: 'typescript',
        code: `const usl = (n: number, alpha: number, beta: number) =>
  n / (1 + alpha * (n - 1) + beta * n * (n - 1));

const alpha = 0.02;   // contention
const beta = 0.0002;  // coherence (cross-node coordination)`,
      },
      options: [
        'A small but positive gain, since USL like Amdahl only shows diminishing returns',
        'A roughly linear gain of ~20%, because α is small',
        'Lower throughput: the peak is at √((1 − 0.02) / 0.0002) = 70 nodes, so the cluster is already past it and more nodes make it worse',
        'No change, because throughput flattens at an asymptote of 1/α = 50×',
      ],
      correct: [2],
      explanation: `With β > 0 the USL curve has a maximum at N* = √((1 − α)/β) = √4,900 = 70 and declines after that (retrograde scaling) because coherence cost grows with N². Options 1 and 4 describe Amdahl-style behaviour (β = 0), which cannot decline. Option 2 ignores the β term. The fix is to reduce coordination (partition into independent groups) or even remove nodes.`,
      followUps: [
        {
          "q": "You split the 90-node cluster into two independent groups of 45–55 nodes with no cross-group coordination. What does the USL predict?",
          "a": "Each group of 55 gives usl(55) ≈ 20.6, so two independent groups yield ~41 units versus ~20.5 for one 90-node cluster — roughly double the throughput with less hardware than adding 20 nodes. Three groups of ~37 give ~56. This only holds if requests can be routed to one group, e.g. partitioning locks or keys by hash, so the coherence term stays within each group. Re-fit α and β after the change, since the partitioning layer adds its own cost."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-11',
      difficulty: 'hard',
      question:
        'You are preparing a NestJS service to autoscale from 3 to 40 pods behind a least-connections LB. Select ALL items that will cause incorrect behaviour after scale-out.',
      options: [
        'A rate limiter storing per-user counters in an in-process Map',
        'A @Cron() job that sends a daily digest email to every user',
        'A per-pod LRU cache (60 s TTL) of immutable product image metadata',
        'JWT verification using a per-pod cached copy of the IdP\'s JWKS keys, refreshed hourly',
        'multer diskStorage saving uploads to the pod\'s local /tmp for later processing by a worker',
      ],
      correct: [0, 1, 4],
      explanation: `In-process counters make the effective limit 40× the intended one; @Cron runs on every pod, sending 40 digests; local-disk uploads are invisible to other pods and lost on pod termination. A per-pod cache of immutable data is fine — duplication costs memory, not correctness. Per-pod JWKS caching is the recommended pattern (keys rotate with overlap), so it does not break correctness.`,
      followUps: [
        {
          "q": "You move the rate limiter to Redis. At 40 pods × 2K RPS it adds one Redis round trip per request. How do you keep it cheap?",
          "a": "80K INCRs/s is fine for a small Redis cluster, but it adds ~0.5–1 ms per request and makes Redis a hard dependency. Options: sliding-window or token-bucket logic in a Lua script (one round trip, atomic), local token buckets per pod that take limit ÷ N with periodic sync to Redis for approximate global limits, and fail-open (allow) with a local fallback limit if Redis is unreachable — rate limiting shouldn't take down the API."
        },
        {
          "q": "How do you fix the multer /tmp uploads so any pod can serve them and nothing is lost on scale-in?",
          "a": "Have clients upload directly to object storage using pre-signed URLs issued by the API, so bytes never touch the pod. When the upload completes (S3 event or client callback), enqueue a job with the object key on a durable queue; any worker processes it. If uploads must pass through the API, stream them straight to S3 rather than local disk. On SIGTERM, Kubernetes waits for terminationGracePeriod, but in-flight multi-GB uploads will still be cut off, which pre-signed uploads avoid."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-12',
      difficulty: 'expert',
      question:
        'A write-heavy Postgres primary on 16 vCPU runs at 70% CPU at peak, with traffic growing ~2× per year. The API tier is stateless and healthy. What is the most sensible next step?',
      options: [
        'Add three read replicas to spread the load',
        'Shard across 8 nodes now, so you never have to revisit it',
        'Scale vertically to a 64 vCPU instance to buy ~2 years, while fixing top queries and designing a partitioning key for the long term',
        'Double the API pods so each request finishes faster and holds DB locks for less time',
      ],
      correct: [2],
      explanation: `The load is write-heavy, so read replicas (option 1) won't relieve the primary. Sharding now brings cross-shard queries, rebalancing and operational cost before it is needed. Vertical scaling is cheap, fast and roughly 4× headroom — about two doublings of traffic — which buys time to do the partitioning design properly. More API pods add connections and contention to the actual bottleneck.`,
      followUps: [
        {
          "q": "Profiling shows the primary is bottlenecked on WAL writes and fsync, not CPU. Does the 64 vCPU upgrade still help?",
          "a": "Mostly no — more cores won't make fsync faster. Instead look at the IO path: faster disks (higher provisioned IOPS, local NVMe), group commit (`commit_delay`), batching small transactions, and reducing write amplification. Drop unused indexes (each one adds WAL per write), enable HOT updates by leaving fillfactor room and not updating indexed columns, and avoid frequent full-row rewrites. For async-tolerant writes, `synchronous_commit = off` for that session trades a few ms of possible loss for throughput."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-13',
      difficulty: 'medium',
      question:
        'During a Postgres outage, the product catalog keeps serving responses from a Redis cache whose entries are up to 10 minutes old. Which statement best describes the trade-off?',
      options: [
        'Availability is preserved at the cost of freshness: responses may be stale, so the maximum acceptable staleness must be agreed and bounded',
        'Durability is reduced, because cached data can be lost when Redis evicts it',
        'Reliability is unaffected, because the cache returns 200 responses with valid JSON',
        'Consistency is unaffected, because the cache was populated from the database of record',
      ],
      correct: [0],
      explanation: `Serving stale data keeps the service available but may return outdated prices or stock — a correctness/freshness cost that must be bounded and possibly surfaced. Durability concerns acknowledged writes being kept, which is not what is happening in a read cache. A 200 with wrong data is available but not reliable. The data came from the DB but may no longer match it, so it is not consistent.`,
      followUps: [
        {
          "q": "During the outage a product's price drops 20% in the DB but the cache still shows the old price. A user checks out. What should happen?",
          "a": "Checkout must not trust the cache: pricing is re-validated at order time against the source of truth. If Postgres is down, you can't place the order, so you either fail closed ('checkout temporarily unavailable') or accept the order with the displayed price and reconcile later within a bounded discount risk. Most shops fail closed for payment. Browsing remains available from the cache, which is the trade-off you wanted: read paths degrade gracefully, money paths stay consistent."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-14',
      difficulty: 'expert',
      question:
        'A Node service shows a p99 spike exactly every 60 seconds while average CPU stays around 30%. Select ALL plausible causes worth investigating first.',
      options: [
        'All cache entries were written in the same second at startup with a fixed 60 s TTL, so they expire together and miss at once',
        'A setInterval job every 60 s synchronously JSON-serializes a large in-memory object, blocking the event loop',
        'The load balancer uses round-robin instead of least-connections',
        'The service has too many pods, so each pod idles between requests',
      ],
      correct: [0, 1],
      explanation: `Periodic tail spikes with low average CPU point to periodic events: synchronized TTL expiry (fix with jittered TTLs / request coalescing) and periodic event-loop blocking (visible as event-loop lag; fix by chunking or moving work to a worker thread). Round-robin can cause imbalance but not a precise 60 s periodicity. Idle pods don't create latency spikes.`,
      followUps: [
        {
          "q": "How do you tell which of the two causes it is, using production telemetry?",
          "a": "Correlate the spike with two metrics: event-loop delay (Node's `perf_hooks.monitorEventLoopDelay`, exported as p99 lag) and the cache hit ratio over time. If loop lag jumps to hundreds of ms every 60 s, the setInterval job is blocking; a CPU profile captured during a spike will show `JSON.stringify` on top. If loop lag is flat but the miss rate and downstream calls spike every 60 s, it's synchronized TTL expiry. Both can coexist, so check both."
        },
        {
          "q": "It's synchronized TTLs. Besides jitter, how do you prevent a stampede on a single very hot key?",
          "a": "Jitter (TTL × random 0.9–1.1) desynchronizes many keys, but a single hot key still expires at once for everyone. Use single-flight: the first miss takes a short lock (Redis SET NX with a few seconds TTL) and refreshes the value while other requests serve the stale value or wait briefly. Or refresh ahead: when a read sees the entry within the last ~10% of its TTL, it triggers an async refresh, probabilistically so only a few requests do it. Hot keys then never actually expire."
        }
      ],
    },
    {
      id: 'fund-scalability-mcq-15',
      difficulty: 'hard',
      question:
        'A batch job has 10% inherently serial work. Using the helper below, what speedup do you get on 16 workers, and what is the ceiling?',
      code: {
        language: 'typescript',
        code: `const amdahl = (p: number, n: number) => 1 / ((1 - p) + p / n);

console.log(amdahl(0.9, 16));   // ?
console.log(1 / (1 - 0.9));      // ceiling`,
      },
      options: [
        '≈ 14.4× on 16 workers, ceiling 16×',
        '≈ 6.4× on 16 workers, ceiling 10×',
        '≈ 10× on 16 workers, ceiling 10×',
        '≈ 16× on 16 workers, ceiling unbounded',
      ],
      correct: [1],
      explanation: `1 / (0.1 + 0.9 / 16) = 1 / 0.15625 = 6.4×, and as N → ∞ the speedup approaches 1 / 0.1 = 10×. Option 1 multiplies 16 × 0.9, a common mistake. Option 3 assumes the ceiling is reached at 16 workers. Option 4 ignores the serial fraction entirely. Past ~16 workers, each extra worker adds little — shrink the serial part instead.`,
      followUps: [
        {
          "q": "You pay per worker-hour. Compare 16 workers with 64 workers on cost efficiency.",
          "a": "At 16 workers the speedup is 6.4×, so efficiency is 6.4 ÷ 16 = 40%: you pay for 16 workers' time but get 6.4 workers' worth of work. At 64 workers the speedup is only ~8.8×, efficiency ~14%: 4× the hardware for ~37% more speed. Cost per job grows roughly in line with worker count once you're near the ceiling. Past ~16 workers, the money is better spent shrinking the 10% serial part, which raises the ceiling itself."
        }
      ],
    },
  ],
};

export default topic;
