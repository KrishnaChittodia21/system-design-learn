import type { Topic } from '../../types';

const topic: Topic = {
  id: 'rel-patterns',
  phase: 'reliability',
  order: 1,
  title: 'Timeouts, Retries, Circuit Breakers & Bulkheads',
  subtitle:
    'How slow dependencies take down healthy services, and the resilience toolkit (deadlines, jittered retries, retry budgets, breakers, bulkheads, load shedding, hedging) that stops it.',
  estimatedMinutes: 95,
  sources: [
    'Michael Nygard — Release It! (2nd ed), Stability Patterns',
    'Google SRE Book — Ch 21 Handling Overload, Ch 22 Addressing Cascading Failures',
    'AWS Architecture Blog — Exponential Backoff and Jitter (Marc Brooker)',
    'Dean & Barroso — The Tail at Scale (CACM 2013)',
    'Mastering API Architecture — Ch 1 (east-west traffic compounding)',
  ],
  tags: ['timeouts', 'retries', 'jitter', 'circuit-breaker', 'bulkhead', 'load-shedding', 'cascading-failure', 'hedging', 'health-checks'],
  cheatSheet: [
    'Slow is worse than down: a dependency that errors in 5ms frees resources; one that hangs for 30s holds a socket, a pool slot and memory per request (Little: in-flight = RPS × latency).',
    'Every network call needs a connect timeout (100ms–1s) AND a request timeout (≈ dependency p99.9 × 1.5, never "default = infinite"); propagate an absolute deadline downstream and stop work when it passes.',
    'Retry only transient failures (connect errors, 503, 429 with Retry-After, gRPC UNAVAILABLE) and only idempotent operations or those with idempotency keys — never 400/401/404/409.',
    'Backoff: full jitter sleep = random(0, min(cap, base × 2^n)); decorrelated jitter sleep = min(cap, random(base, prev × 3)). Without jitter, retries re-synchronise into waves.',
    'Retry amplification is multiplicative: 3 retries (4 attempts) at each of 5 layers = 4^5 ≈ 1,024 calls to the bottom. Retry at ONE layer, cap with a budget (retries ≤ 10–20% of requests).',
    'Circuit breaker: CLOSED → (error% over rolling window with min volume) → OPEN (fail fast) → after resetTimeout → HALF-OPEN (few probes) → CLOSED or back to OPEN.',
    'Bulkhead: give each dependency its own bounded pool/semaphore + bounded queue so one slow dependency can exhaust only its own compartment.',
    'Load shedding: reject early and cheaply (503 + Retry-After) when in-flight, queue time or event-loop lag exceeds a limit; shed low-priority traffic first; a fast "no" beats a slow timeout.',
    'Liveness = "is this process wedged?" (never check dependencies); readiness = "should I get traffic?" (can check critical local state). Deep liveness checks turn a DB blip into a fleet-wide restart storm.',
    'Hedged requests: send a second copy after the p95 latency, take the first reply, cancel the other — costs ~5% extra load, cuts p99.9 dramatically; only for idempotent reads.',
  ],
  sections: [
    {
      heading: '1. The failure model: slow is worse than down',
      body: `**Intuition:** a shop with one broken till is fine — customers go to another. A shop with one till that works *extremely slowly* is a disaster: the queue backs up out the door and blocks the entrance for everyone.

In a microservice system, a dependency can fail in three very different ways:

| Failure mode | What the caller sees | Resource cost on the caller | Danger |
|---|---|---|---|
| **Fail fast** (connection refused, 503 in 2ms) | Immediate error | Near zero | Low — easy to detect and route around |
| **Fail slow** (GC pauses, lock contention, overloaded DB) | Latency climbs from 40ms to 5–30s | One socket + pool slot + request context held per call for the whole duration | **High** — silently exhausts upstream pools |
| **Gray failure** (5% of requests hang, health check still green) | p99 explodes, p50 looks fine | Partial exhaustion, hard to see | **Very high** — dashboards say "healthy" |

The core arithmetic is **Little's Law**: \`in-flight requests = arrival rate × latency\`. At 500 RPS and 50ms, a caller holds ~25 concurrent calls. If the downstream slows to 5s, the *same* traffic requires 2,500 concurrent calls. Nothing about the caller changed — yet its connection pool (say 50), its memory, and its event loop are now overwhelmed. That is how one slow service becomes an outage of every service that calls it.

**The resilience toolkit** maps to this model:

- **Timeouts / deadlines** convert fail-slow into fail-fast.
- **Retries with backoff + jitter** absorb transient blips.
- **Retry budgets** stop retries from becoming the outage.
- **Circuit breakers** stop calling something that is clearly broken.
- **Bulkheads** confine the damage of one dependency to one compartment.
- **Load shedding** protects a service from its own callers.
- **Fallbacks / graceful degradation** keep the product useful while parts are broken.
- **Hedging** attacks tail latency when everything is "healthy but spiky".

**In interviews say this:** "My default assumption is that every remote call can hang forever. I design so a hanging dependency costs me a bounded amount of resources for a bounded amount of time."`,
      diagram: `  Healthy: 500 rps x 50ms  = 25 in-flight   (pool of 50: fine)

  client --> [API pod | pool 50] --> [Pricing svc]  50ms
                 ||||                     |
  Degraded: 500 rps x 5s = 2,500 in-flight (pool of 50: exhausted)

  client --> [API pod | pool 50 FULL | 2,450 queued] --> [Pricing] 5s
                  ^ every other endpoint on this pod now waits too`,
      keyPoints: [
        'Little\'s Law: concurrency = throughput × latency — latency spikes are concurrency spikes.',
        'Fail-slow and gray failures are more dangerous than hard failures.',
        'Every pattern in this topic is a way to bound time, concurrency, or attempts.',
      ],
      source: 'Michael Nygard — Release It!, Ch 4–5 Stability Antipatterns/Patterns',
    },
    {
      heading: '2. Timeouts, timeout budgets & deadline propagation',
      body: `**Intuition:** a timeout is a promise to yourself: "I will not wait longer than X for this, no matter what." A *deadline* is the same promise passed down the chain: "the user gives up at 12:00:01.000 — don't bother working after that."

**Two timeouts on every call**

- **Connect timeout** — TCP/TLS handshake. Inside a region this takes < 1–3ms; set 100ms–1s. A long connect timeout hides dead hosts.
- **Request (read) timeout** — total time to get the response. Start from the dependency's measured **p99.9** and add headroom (×1.5–2). A 40ms-p99.9 service gets ~100ms, not the library default of "infinite" (Node's \`fetch\` has no default total timeout; many HTTP clients default to 0 = none, or to 30–120s).

**Timeout budgets.** If the edge SLA is 1s and the call graph is \`gateway → orders → pricing → tax\`, each hop cannot independently use 1s. Allocate a budget, e.g. gateway 1000ms total, orders gets 800ms, pricing 300ms, tax 100ms — and the budget shrinks as time is spent.

**Deadline propagation.** Rather than static per-hop numbers, pass an **absolute deadline** (or remaining time) in a header. Each service computes \`remaining = deadline − now − safety margin\`; if remaining ≤ 0 it fails immediately instead of doing work nobody will read. gRPC does this natively: the client's deadline becomes the \`grpc-timeout\` header, and servers can propagate it to child calls. For HTTP you roll your own header (e.g. \`x-request-deadline\` as epoch ms, or relative ms to avoid clock skew).

**Pitfalls**

- Timeouts shorter than the downstream's own retries: caller gives up at 200ms while the callee is still retrying for 900ms — wasted work.
- Timeout on the client but not the server: the server keeps computing (and holding DB locks) after the client left. Propagate cancellation (\`AbortSignal\`, gRPC cancellation, \`statement_timeout\` in Postgres).
- Timeouts on reads but not on **pool acquisition**: waiting 30s for a free DB connection is still a hang.

**In production:** set timeouts from measured percentiles, alert when the timeout rate exceeds ~0.1%, and revisit them when the dependency's latency profile changes.`,
      code: [
        {
          language: 'typescript',
          title: 'Deadline propagation with AbortSignal (Node 20+, NestJS-style)',
          code: `// Incoming: read absolute deadline (epoch ms) set by the edge; default 1s budget.
const DEADLINE_HEADER = 'x-request-deadline';
const SAFETY_MS = 10; // time we keep for our own serialization/response

export function deadlineFrom(req: { headers: Record<string, string | undefined> }): number {
  const h = Number(req.headers[DEADLINE_HEADER]);
  return Number.isFinite(h) && h > 0 ? h : Date.now() + 1000;
}

export class DeadlineExceededError extends Error {}

// Outgoing: every child call gets min(per-call cap, remaining budget).
export async function callWithDeadline(
  url: string,
  deadline: number,
  perCallCapMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const remaining = deadline - Date.now() - SAFETY_MS;
  if (remaining <= 0) throw new DeadlineExceededError('budget exhausted before call');

  const timeoutMs = Math.min(perCallCapMs, remaining);
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (init.signal) signals.push(init.signal); // also abort if our own caller disconnects

  return fetch(url, {
    ...init,
    signal: AbortSignal.any(signals),
    headers: { ...(init.headers as Record<string, string>), [DEADLINE_HEADER]: String(deadline) },
  });
}

// Usage inside a handler: pricing gets at most 300ms, never more than what is left.
// const res = await callWithDeadline('http://pricing/quote', deadlineFrom(req), 300);`,
        },
        {
          language: 'sql',
          title: 'Server-side timeouts so abandoned work stops (Postgres)',
          code: `-- Per-role defaults: queries and idle transactions cannot hold resources forever
ALTER ROLE orders_api SET statement_timeout = '800ms';
ALTER ROLE orders_api SET lock_timeout = '200ms';          -- don't queue behind a long lock
ALTER ROLE orders_api SET idle_in_transaction_session_timeout = '5s';`,
        },
      ],
      keyPoints: [
        'Connect timeout 100ms–1s; request timeout ≈ p99.9 × 1.5–2.',
        'Propagate an absolute deadline; fail immediately when it has passed.',
        'Bound pool-acquire time and server-side work too, not just the socket read.',
      ],
      source: 'Google SRE Book — Ch 22 Addressing Cascading Failures (deadline propagation)',
    },
    {
      heading: '3. Cascading failure in depth: how a slow downstream exhausts upstream pools',
      body: `**Intuition:** a traffic jam on one exit ramp backs up onto the highway until cars that never wanted that exit are stuck too.

**The step-by-step mechanics** (the answer interviewers want in detail):

1. **Trigger.** \`pricing\` slows from 50ms to 5s (DB index dropped, GC storm, noisy neighbour).
2. **Concurrency explodes upstream.** \`orders\` still receives 500 RPS. In-flight calls to pricing go from 25 to 2,500 (Little's Law).
3. **Shared pool exhaustion.** \`orders\` uses one HTTP agent with \`maxSockets = 50\` shared by *all* outbound calls. 50 sockets are pinned by slow pricing calls; calls to \`inventory\` and \`users\` — which are perfectly healthy — now wait in the agent's queue.
4. **Queueing and memory.** Each waiting request holds its request body, closures, and a pending promise. In Node, memory climbs; in thread-per-request servers (Spring/Tomcat with 200 threads), all threads block and new connections sit in the accept queue.
5. **Upstream timeouts fire.** The gateway times out \`orders\` at 2s, returns 504 — but \`orders\` keeps working on the abandoned requests (no cancellation), so the backlog never drains.
6. **Retries pour fuel.** Gateway retries 2× and mobile clients retry 3×: offered load on \`orders\` triples while its capacity has collapsed.
7. **Health checks fail.** \`/healthz\` shares the same saturated event loop, times out, Kubernetes kills the pod. Remaining pods receive its share of traffic, saturate faster, and die in turn — a **death spiral**. New pods start cold (empty caches, JIT warm-up) and fall over immediately.
8. **Blast radius.** Every service that calls \`orders\` now experiences the same slow dependency: the failure has climbed the call graph.

**Where to cut the chain**

| Step | Defence |
|---|---|
| 2 | Tight timeout on pricing (e.g. 300ms) bounds in-flight to 500 × 0.3 = 150 |
| 3 | **Bulkhead**: separate agent/semaphore per dependency (pricing max 40 concurrent) |
| 4 | Bounded queues; reject when full instead of growing memory |
| 5 | Deadline propagation + cancellation so abandoned work stops |
| 6 | Retry budget, retry at one layer only, circuit breaker opens on pricing |
| 7 | Liveness check independent of dependencies; readiness sheds traffic instead of killing |
| 8 | Fallback (cached price / "price unavailable") so orders still serves |

**In interviews say this:** "The root cause is unbounded concurrency on a shared resource. I bound it three ways — time (timeouts), count (bulkheads), and attempts (retry budget + breaker) — and I make sure the failure of an optional dependency degrades a feature rather than the service."`,
      diagram: `            500 rps
  gateway ----------> orders (1 shared agent, maxSockets=50)
   retry x2              |        |          |
                         v        v          v
                     pricing   inventory   users
                      5s !!     10ms ok    8ms ok
                         |
   50 sockets pinned by pricing -> inventory/users calls QUEUE
   -> orders p99 = 5s for EVERY endpoint -> gateway 504 + retries
   -> /healthz times out -> k8s restarts pods -> remaining pods overload

  Fix: per-dependency bulkheads
  orders: [pricing pool 40][inventory pool 40][users pool 40]
          pricing full -> fast reject/fallback; others unaffected`,
      code: [
        {
          language: 'typescript',
          title: 'Per-dependency HTTP pools (undici) instead of one shared agent',
          code: `import { Agent, request } from 'undici';

// One bounded pool per downstream: a slow pricing service can pin at most
// 40 sockets and can never starve inventory or users.
const pools = {
  pricing: new Agent({ connections: 40, connectTimeout: 300, headersTimeout: 300, bodyTimeout: 300 }),
  inventory: new Agent({ connections: 40, connectTimeout: 300, headersTimeout: 200, bodyTimeout: 200 }),
  users: new Agent({ connections: 20, connectTimeout: 300, headersTimeout: 150, bodyTimeout: 150 }),
} as const;

type Dep = keyof typeof pools;

export async function callDep(dep: Dep, url: string, signal?: AbortSignal) {
  const res = await request(url, { dispatcher: pools[dep], signal });
  if (res.statusCode >= 500) {
    await res.body.dump(); // release the socket back to the pool
    throw new Error(dep + ' returned ' + res.statusCode);
  }
  return res.body.json();
}`,
        },
      ],
      keyPoints: [
        'Root cause of cascades: unbounded concurrency on shared resources.',
        'Health checks sharing a saturated event loop cause restart death spirals.',
        'Cut the chain at every step: timeout, bulkhead, bounded queue, cancellation, retry budget, fallback.',
      ],
      source: 'Google SRE Book — Ch 22 Addressing Cascading Failures',
    },
    {
      heading: '4. Retries with exponential backoff and jitter',
      body: `**Intuition:** if a door is jammed, pushing again immediately rarely helps; waiting a bit, and not all pushing at the same moment, does.

**What is retryable**

| Retry | Don't retry |
|---|---|
| Connection refused/reset, DNS blip | 400, 401, 403, 404, 409, 422 — they will fail again |
| 503, 502, 504 from a proxy (with care) | 500 on a **non-idempotent** POST without an idempotency key |
| 429 — honour \`Retry-After\` | Timeouts on non-idempotent writes (you don't know if it committed) |
| gRPC \`UNAVAILABLE\`, \`RESOURCE_EXHAUSTED\` (with backoff) | gRPC \`INVALID_ARGUMENT\`, \`PERMISSION_DENIED\`, \`FAILED_PRECONDITION\` |

**Idempotency is the prerequisite.** GET/PUT/DELETE are idempotent by HTTP semantics; POST needs an \`Idempotency-Key\` stored server-side with the result (see api-design).

**Backoff formulas** (Marc Brooker, AWS Architecture Blog):

- **Exponential (no jitter):** \`sleep = min(cap, base × 2^attempt)\`. Every client that failed at the same instant retries at the same instant — synchronized waves hit the recovering server.
- **Full jitter:** \`sleep = random(0, min(cap, base × 2^attempt))\`. Spreads retries uniformly; in AWS's simulation it had the lowest total work and near-lowest completion time.
- **Equal jitter:** \`t = min(cap, base × 2^attempt); sleep = t/2 + random(0, t/2)\` — guarantees some minimum wait.
- **Decorrelated jitter:** \`sleep = min(cap, random(base, prevSleep × 3))\` — grows with randomness, no attempt counter needed.

**Always:** cap the number of attempts (typically 3 total), cap the sleep (e.g. 2–5s for interactive, longer for async jobs), respect the overall **deadline** (don't sleep past it), and add retries to metrics (\`retries_total\` by dependency and reason).

**In production:** client SDKs of AWS, GCP and gRPC implement this; your job is to configure it and ensure only one layer retries.`,
      code: [
        {
          language: 'typescript',
          title: 'Deadline-aware retry with full or decorrelated jitter',
          code: `type Jitter = 'full' | 'decorrelated';

interface RetryOpts {
  maxAttempts: number;   // total attempts including the first, e.g. 3
  baseMs: number;        // e.g. 50
  capMs: number;         // e.g. 2000
  jitter: Jitter;
  deadline: number;      // absolute epoch ms — never sleep past it
  isRetryable: (err: unknown) => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOpts): Promise<T> {
  let prevSleep = o.baseMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      const last = attempt + 1 >= o.maxAttempts;
      if (last || !o.isRetryable(err)) throw err;

      let delay: number;
      if (o.jitter === 'full') {
        delay = rand(0, Math.min(o.capMs, o.baseMs * 2 ** attempt));
      } else {
        delay = Math.min(o.capMs, rand(o.baseMs, prevSleep * 3));
        prevSleep = delay;
      }
      // Honour server hints (429/503 Retry-After seconds) when present
      const hinted = (err as { retryAfterMs?: number }).retryAfterMs;
      if (hinted) delay = Math.max(delay, hinted);

      if (Date.now() + delay >= o.deadline) throw err; // no time left for another try
      await sleep(delay);
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Retry only transient errors on idempotent operations (or with idempotency keys).',
        'Full jitter: random(0, min(cap, base·2^n)); decorrelated: min(cap, random(base, prev·3)).',
        'Cap attempts, cap sleep, never sleep past the deadline.',
      ],
      source: 'AWS Architecture Blog — Exponential Backoff and Jitter',
    },
    {
      heading: '5. Retry storms, amplification math & retry budgets',
      body: `**Intuition:** retries are a loan against future capacity. When the system is healthy the loan is tiny; when it is overloaded, everyone takes out the loan at once and the bank collapses.

**Amplification across layers.** Suppose 5 layers (\`client → gateway → BFF → orders → pricing → DB\`) and each makes up to 3 retries (4 attempts). If the DB is failing, one user request can produce **4^5 = 1,024** DB calls. Even 2 retries per layer across 4 layers gives 3^4 = 81×. The overloaded component receives the *most* amplified traffic exactly when it can least handle it.

**Retry storm dynamics.** A 10-second DB hiccup at 10K RPS: without retries, 100K requests fail. With 3 retries and no jitter, the DB sees up to 40K RPS in synchronized waves the moment it recovers, which knocks it straight back over — a *metastable failure*: the trigger is gone, but the retry load keeps the system down.

**Defences**

1. **Retry at one layer only** — usually the layer closest to the failure that knows whether the operation is idempotent. Everyone else fails fast and propagates the error (or a "don't retry" signal).
2. **Retry budget** — retries may be at most X% of recent requests (Finagle default ~20%; Google SRE suggests a per-client limit of ~10% retry ratio). When the downstream is healthy, the budget is barely used; when it is broken, retries are capped at +10% load instead of +300%.
3. **gRPC retry throttling** — built-in token bucket: each failure costs 1 token, each success adds \`tokenRatio\` (e.g. 0.1); retries stop when tokens fall below half of \`maxTokens\`.
4. **Server pushback** — overloaded servers return 503/429 with \`Retry-After\` or a "no-retry" hint; clients honour it.
5. **Circuit breaker** in front of the retry loop: once open, there is nothing to retry.

**In interviews say this:** "Retries multiply across layers, so I pick one layer to retry, give it a budget of about 10% of traffic, and everything above it fails fast."`,
      diagram: `  attempts per layer = 1 + retries = 4

  client(4) -> gateway(4) -> BFF(4) -> orders(4) -> pricing(4) -> DB
    1 user request => 4 x 4 x 4 x 4 x 4 = 1,024 DB attempts

  With retry at ONE layer (pricing->DB) + 10% budget:
    1 user request => at most ~1.1 DB attempts on average`,
      code: [
        {
          language: 'typescript',
          title: 'Sliding retry budget: retries ≤ 10% of requests (min 10/s floor)',
          code: `// Tracks requests and retries in 1-second buckets over a 10s window.
export class RetryBudget {
  private reqs = new Array<number>(10).fill(0);
  private retries = new Array<number>(10).fill(0);
  private lastSec = Math.floor(Date.now() / 1000);

  constructor(private ratio = 0.1, private minRetriesPerSec = 10) {}

  private rotate() {
    const now = Math.floor(Date.now() / 1000);
    for (let s = this.lastSec + 1; s <= now && s - this.lastSec <= 10; s++) {
      this.reqs[s % 10] = 0;       // clear buckets that fell out of the window
      this.retries[s % 10] = 0;
    }
    this.lastSec = now;
  }

  recordRequest() { this.rotate(); this.reqs[this.lastSec % 10]++; }

  /** Returns true and consumes budget if a retry is allowed right now. */
  tryAcquireRetry(): boolean {
    this.rotate();
    const totalReqs = this.reqs.reduce((a, b) => a + b, 0);
    const totalRetries = this.retries.reduce((a, b) => a + b, 0);
    const allowed = Math.max(this.minRetriesPerSec * 10, totalReqs * this.ratio);
    if (totalRetries >= allowed) return false; // budget exhausted: fail fast
    this.retries[this.lastSec % 10]++;
    return true;
  }
}`,
        },
      ],
      keyPoints: [
        'Amplification = (attempts per layer)^(layers); 4^5 ≈ 1,024.',
        'Metastable failure: retry load keeps a system down after the trigger is gone.',
        'Retry at one layer; bound with a ~10% retry budget; honour Retry-After.',
      ],
      source: 'Google SRE Book — Ch 22 (retry budgets); Finagle RetryBudget',
    },
    {
      heading: '6. Circuit breakers',
      body: `**Intuition:** like the breaker in your house: when a circuit keeps faulting, it trips and stops sending current, then someone tries it again carefully after a while.

**States**

- **CLOSED** — calls pass through; the breaker records success/failure (and timeouts) in a rolling window (e.g. 10s in 10 buckets).
- **OPEN** — when the error percentage exceeds a threshold (e.g. 50%) **and** the window has at least \`volumeThreshold\` calls (e.g. 20 — otherwise 1 failure out of 1 trips it), the breaker opens. Calls fail immediately (or go to the fallback) for \`resetTimeout\` (e.g. 10–30s). This gives the downstream room to recover and frees the caller's resources.
- **HALF-OPEN** — after the reset timeout, a limited number of trial calls go through. Success → CLOSED; failure → OPEN again.

**Design decisions that matter**

- **What counts as failure:** timeouts and 5xx yes; 4xx no (a 404 is the client's fault, not the dependency's). Use \`errorFilter\`.
- **Granularity:** per downstream *endpoint* or *host*, not a single global breaker per service — one bad replica or one bad endpoint shouldn't block the others. Service meshes (Envoy **outlier detection**) eject individual hosts.
- **Fleet effect:** with 200 caller pods, each has its own breaker state; half-open probes from 200 pods = up to 200 concurrent probes. That is usually acceptable; if not, limit half-open probes to 1 per pod and jitter resetTimeout.
- **Pair with a fallback**, otherwise open breaker = error page.
- **Observe it:** emit metrics and alerts on state transitions — an open breaker is an incident signal.

**Circuit breaker vs retry:** retry assumes the failure is *transient*; the breaker detects that it is *not*. Place the breaker **outside** the retry loop so an open breaker short-circuits all attempts.`,
      diagram: `              error% > 50% AND calls >= volumeThreshold
      +--------+ ------------------------------> +--------+
      | CLOSED |                                  |  OPEN  | fail fast /
      +--------+ <---+                            +--------+ fallback
          ^          | probe succeeds                 |
          |          |                                | resetTimeout (e.g. 10s)
          |      +-----------+                        v
          +------| HALF-OPEN | <----------------------+
                 +-----------+ --- probe fails ---> OPEN`,
      code: [
        {
          language: 'typescript',
          title: 'opossum breaker with timeout, error filter, fallback and metrics',
          code: `import CircuitBreaker from 'opossum';
import { request } from 'undici';

class HttpError extends Error {
  constructor(public status: number) { super('HTTP ' + status); }
}

async function getRecommendations(userId: string): Promise<string[]> {
  const res = await request('http://reco/v1/users/' + userId + '/items', {
    headersTimeout: 250, bodyTimeout: 250,
  });
  if (res.statusCode >= 400) { await res.body.dump(); throw new HttpError(res.statusCode); }
  return (await res.body.json()) as string[];
}

const breaker = new CircuitBreaker(getRecommendations, {
  timeout: 300,                   // opossum-level timeout counts as a failure
  errorThresholdPercentage: 50,   // open when >= 50% of calls fail...
  volumeThreshold: 20,            // ...but only once 20 calls were seen in the window
  rollingCountTimeout: 10_000,    // 10s rolling window
  rollingCountBuckets: 10,
  resetTimeout: 15_000,           // stay OPEN 15s, then allow a HALF-OPEN probe
  // 4xx are caller errors: returning true means "do not count as a failure"
  errorFilter: (err: unknown) => err instanceof HttpError && err.status < 500,
});

// Degrade instead of failing: popular items from a local cache
breaker.fallback(() => ['bestseller-1', 'bestseller-2', 'bestseller-3']);

breaker.on('open', () => console.warn('reco breaker OPEN'));
breaker.on('halfOpen', () => console.info('reco breaker HALF-OPEN'));
breaker.on('close', () => console.info('reco breaker CLOSED'));

export const recommendationsFor = (userId: string) => breaker.fire(userId);`,
        },
      ],
      keyPoints: [
        'Trip on error% over a rolling window with a minimum volume.',
        'Count timeouts and 5xx; ignore 4xx.',
        'Breaker outside the retry loop; always pair with a fallback and alert on OPEN.',
      ],
      source: 'Michael Nygard — Release It!, Circuit Breaker pattern',
    },
    {
      heading: '7. Bulkheads: isolating resource pools',
      body: `**Intuition:** ships are split into watertight compartments so one breach floods one compartment, not the whole hull.

**Forms of bulkhead, from finest to coarsest**

| Level | Mechanism | Example |
|---|---|---|
| Per dependency in-process | Separate connection pool / semaphore / thread pool per downstream | pricing max 40 concurrent, users max 20 |
| Per request class | Separate pools for interactive vs batch, or per tenant tier | reports endpoint can't exhaust the checkout DB pool |
| Per deployment | Separate deployments for the same code serving different callers | \`orders-api-web\` vs \`orders-api-internal-batch\` |
| Per cell / shard | Customers partitioned into independent stacks | see rel-dr (cell-based architecture) |

**Sizing an in-process bulkhead.** Use Little's Law on the *healthy* profile with headroom: pricing at 400 RPS × 50ms = 20 concurrent → allow 40. If pricing slows down, at most 40 calls are ever waiting on it; call #41 is rejected immediately (or queued with a *short* bounded queue, e.g. 10 entries with 50ms max wait) and goes to the fallback.

**Why Node needs this too.** "Node is single-threaded, so there are no thread pools to exhaust" is wrong: sockets, the HTTP agent, the DB pool (\`pg.Pool\` default max 10), memory for pending promises and the libuv threadpool (default 4 threads for DNS \`lookup\`, fs, crypto, zlib) are all shared, finite resources.

**Trade-off:** bulkheads waste some capacity (idle reserved slots) and add tuning. Size from data, and review after load tests.`,
      code: [
        {
          language: 'typescript',
          title: 'Semaphore bulkhead with bounded queue and max wait',
          code: `export class BulkheadFullError extends Error {}

export class Bulkhead {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number, private maxQueue: number, private maxWaitMs: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueue) throw new BulkheadFullError('bulkhead full');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.queue = this.queue.filter((w) => w !== wake); // give up our queue slot
          reject(new BulkheadFullError('bulkhead wait timeout'));
        }, this.maxWaitMs);
        const wake = () => { clearTimeout(timer); resolve(); };
        this.queue.push(wake);
      });
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.(); // hand the slot to the next waiter
    }
  }
}

// One compartment per dependency
export const pricingBulkhead = new Bulkhead(40, 10, 50);
// await pricingBulkhead.run(() => callDep('pricing', url, signal));`,
        },
      ],
      keyPoints: [
        'One bounded pool per dependency or traffic class.',
        'Size with Little\'s Law on healthy latency plus headroom.',
        'Reject quickly when full — the rejection feeds the fallback.',
      ],
      source: 'Michael Nygard — Release It!, Bulkheads',
    },
    {
      heading: '8. Load shedding & admission control',
      body: `**Intuition:** a nightclub at capacity turns people away at the door. That's better than letting everyone in until nobody can move or breathe.

A service's throughput collapses when overloaded: beyond saturation, queues grow, latency exceeds client timeouts, and the service spends all its CPU on requests whose callers already left (**goodput → 0**). Load shedding keeps the service at max *useful* throughput by rejecting the excess early and cheaply.

**Signals to shed on**

- **In-flight requests** above a limit (static, or adaptive — Netflix \`concurrency-limits\` uses a TCP-Vegas/gradient-style algorithm that lowers the limit when latency rises above the no-load baseline).
- **Queue time** — if a request waited in the queue longer than its caller's timeout, drop it without processing (CoDel-style: shed when the *minimum* queue delay over an interval stays above target).
- **Event-loop lag** (Node) — lag > 100–200ms means you're CPU-saturated.
- **CPU utilisation** — coarse but simple.

**Priority shedding.** Tag requests by criticality (\`critical\` checkout, \`default\`, \`sheddable\` analytics/prefetch). Shed sheddable at 80% of the limit, default at 100%, critical last. Google SRE describes exactly this criticality propagation across RPCs.

**Where:** as early as possible — load balancer / gateway (cheapest), then service ingress middleware. Rejection must be cheap: no DB lookup, no auth call, just a 503 with \`Retry-After\`.

**Load shedding vs rate limiting:** rate limiting enforces a *per-client contract* ("tenant A gets 1K RPS"); load shedding protects the *server's capacity* regardless of who is sending. You need both.`,
      code: [
        {
          language: 'typescript',
          title: 'Express/NestJS middleware: shed by in-flight count, priority and event-loop lag',
          code: `import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

const MAX_IN_FLIGHT = 200;              // from load tests: throughput knee per pod
const MAX_LOOP_LAG_MS = 150;
const SHED_AT: Record<string, number> = { sheddable: 0.7, default: 0.9, critical: 1.0 };
let inFlight = 0;

setInterval(() => loopDelay.reset(), 1000).unref(); // measure lag per second

export function loadShedder(req: Request, res: Response, next: NextFunction) {
  const prio = (req.header('x-criticality') ?? 'default').toLowerCase();
  const limit = MAX_IN_FLIGHT * (SHED_AT[prio] ?? SHED_AT.default);
  const lagMs = loopDelay.mean / 1e6; // histogram is in nanoseconds

  if (inFlight >= limit || (prio !== 'critical' && lagMs > MAX_LOOP_LAG_MS)) {
    res.setHeader('Retry-After', '1');
    res.status(503).json({ type: 'about:blank', title: 'Overloaded', status: 503 });
    return; // cheap rejection: no auth, no DB, no downstream calls
  }

  inFlight++;
  let done = false;
  const release = () => { if (!done) { done = true; inFlight--; } };
  res.on('finish', release);
  res.on('close', release); // client disconnected
  next();
}`,
        },
      ],
      keyPoints: [
        'Overload collapses goodput; shedding keeps throughput at the knee.',
        'Shed on in-flight, queue time, event-loop lag; lowest priority first.',
        'Shed early (edge) and cheaply (no auth/DB); return 503 + Retry-After.',
      ],
      source: 'Google SRE Book — Ch 21 Handling Overload',
    },
    {
      heading: '9. Graceful degradation & fallbacks',
      body: `**Intuition:** when the espresso machine breaks, a good café still sells drip coffee and pastries — it doesn't close.

**Classify every dependency** of a request as *critical* (checkout can't proceed without payment auth) or *optional* (recommendations, reviews, personalised banners). Optional dependencies must never fail the request.

**Fallback hierarchy (best to worst)**

| Fallback | Example | Caveat |
|---|---|---|
| Stale cache | Last known price/profile from Redis/local LRU with a 24h "stale-if-error" TTL | Must be safe for the domain (stale price shown ≠ stale price charged) |
| Static/default | Bestseller list instead of personalised recommendations | Needs to be precomputed and local |
| Reduced functionality | Search without spelling correction; feed without ranking | Tell the UI via a \`degraded: true\` flag |
| Queue for later | Accept order, "confirmation email will follow" | Requires async pipeline + idempotency |
| Fail with clear error | "Payments temporarily unavailable" fast | Better than a 30s spinner |

**Fallback anti-patterns**

- A fallback that calls **another remote service** on the same failing infrastructure (fallback to the replica of the DB that's down) — it will fail too, and slowly.
- A fallback path that is **never exercised** until the incident — it's broken when you need it. Test with fault injection.
- Silent degradation with no metric — you run degraded for weeks without knowing.

**Static stability** (AWS term): design so that when a dependency (especially a control plane) fails, the data plane keeps doing what it was doing with the last known good config, rather than needing to call anything new.

**Feature flags / kill switches** let operators turn off expensive optional features (e.g. "disable related products") in seconds during an incident — a manual form of degradation.`,
      keyPoints: [
        'Label dependencies critical vs optional; optional never fails the request.',
        'Prefer local fallbacks (stale cache, static defaults) over remote ones.',
        'Exercise and measure fallbacks; keep kill switches for expensive features.',
      ],
      source: 'AWS Builders\' Library — Static stability; Release It!',
    },
    {
      heading: '10. Health checks vs heartbeats',
      body: `**Intuition:** a health check is a doctor asking "are you OK?" (pull); a heartbeat is you phoning the doctor every 5 seconds to say "still alive" (push).

**Health checks (pull)** — the load balancer or kubelet polls an endpoint.

| Probe | Question | What to check | On failure |
|---|---|---|---|
| **Liveness** | Is this process wedged beyond self-repair? | Process responds; event loop not deadlocked. **No dependency checks.** | Container restarted |
| **Readiness** | Should this instance get traffic right now? | Warm-up done, local resources OK, not shedding; optionally critical deps | Removed from Service endpoints (no restart) |
| **Startup** | Has slow initialisation finished? | App booted | Liveness/readiness paused until it passes |

**The classic incident:** liveness probe does \`SELECT 1\` on Postgres. Postgres fails over (30s). Every pod fails liveness, Kubernetes restarts the entire fleet simultaneously, pods come back cold, stampede the cache and DB — a 30s DB blip becomes a 15-minute outage. **Rule:** liveness never depends on anything external. Even readiness depending on a *shared* dependency is dangerous — if all pods go unready at once, the Service has zero endpoints (some LBs then "fail open" and send to all anyway). Prefer to stay ready and serve degraded responses.

**Heartbeats (push)** — members of a cluster send periodic "I'm alive" messages (Kafka consumers to the group coordinator via \`heartbeat.interval.ms\` / \`session.timeout.ms\`; ZooKeeper/etcd sessions/leases; Cassandra gossip). The receiver declares a member dead after N missed beats. Used for **membership and leader leases**, where the cluster itself needs to know who is alive. Accrual failure detectors (phi accrual, used by Cassandra and Akka) output a suspicion level based on inter-arrival history instead of a fixed timeout.

**Trade-off for both:** short intervals detect failure fast but cause false positives under GC pauses or network jitter (flapping); long intervals mean slower failover. Typical: probe every 5–10s, fail after 3 consecutive misses.`,
      code: [
        {
          language: 'yaml',
          title: 'Kubernetes probes: shallow liveness, meaningful readiness, startup grace',
          code: `containers:
  - name: orders-api
    image: orders-api:1.42.0
    ports: [{ containerPort: 3000 }]
    startupProbe:              # up to 30 x 2s = 60s to boot before liveness applies
      httpGet: { path: /healthz, port: 3000 }
      periodSeconds: 2
      failureThreshold: 30
    livenessProbe:             # process-only: never touches DB/Redis/downstreams
      httpGet: { path: /healthz, port: 3000 }
      periodSeconds: 10
      timeoutSeconds: 2
      failureThreshold: 3      # ~30s of consecutive failure before restart
    readinessProbe:            # warm caches loaded, not draining, not overloaded
      httpGet: { path: /ready, port: 3000 }
      periodSeconds: 5
      timeoutSeconds: 1
      failureThreshold: 2
    lifecycle:
      preStop:                 # let endpoints update before SIGTERM closes the server
        exec: { command: ['sleep', '10'] }`,
        },
      ],
      keyPoints: [
        'Liveness: process only. Readiness: traffic eligibility. Startup: boot grace.',
        'Dependency checks in liveness = fleet-wide restart storms.',
        'Heartbeats drive membership/leases; tune interval vs false-positive trade-off.',
      ],
    },
    {
      heading: '11. Hedged requests & tail latency',
      body: `**Intuition:** you call two taxi companies and take whichever cab arrives first — but you only call the second if the first hasn't shown up within a few minutes.

**Why tails matter at fan-out.** If one backend has p99 = 50ms and a request fans out to 100 shards and waits for all, the chance that *at least one* shard is slower than its p99 is \`1 − 0.99^100 ≈ 63%\`. The "rare" tail becomes the common case (Dean & Barroso, *The Tail at Scale*).

**Hedged request:** send the request to one replica; if no response within ~the **p95** latency, send a second copy to another replica; use whichever returns first and cancel the other. Because only ~5% of requests trigger a hedge, extra load is ~5%, but p99.9 drops sharply. Google reported (BigTable benchmark) that hedging after 10ms reduced p99.9 from 1,800ms to 74ms with ~2% extra requests.

**Tied requests:** send to two servers at once, each knowing about the other; whichever starts executing first tells the other to cancel — reduces queueing delay with little duplicated work.

**Rules**

- **Idempotent reads only** (or writes with idempotency keys).
- Hedge against a *different* replica/AZ, otherwise you duplicate onto the same slow host.
- Cap the hedge rate (e.g. ≤ 5–10% of requests) — if the whole backend is slow, hedging doubles its load. Disable hedging when the error/latency is systemic (breaker open or budget exhausted).
- Cancel the loser to reclaim resources.

**Interview framing:** "Retries handle failures; hedging handles slowness. Both need a budget."`,
      code: [
        {
          language: 'typescript',
          title: 'Hedged GET with cancellation of the loser and a hedge budget',
          code: `import { RetryBudget } from './retry-budget';

const hedgeBudget = new RetryBudget(0.05, 5); // at most ~5% extra requests

export async function hedgedGet(replicas: string[], path: string, hedgeAfterMs: number, deadlineMs: number) {
  const controllers: AbortController[] = [];
  const attempt = (base: string) => {
    const c = new AbortController();
    controllers.push(c);
    return fetch(base + path, { signal: AbortSignal.any([c.signal, AbortSignal.timeout(deadlineMs)]) })
      .then((r) => { if (!r.ok) throw new Error('status ' + r.status); return r.json(); });
  };

  hedgeBudget.recordRequest();
  const primary = attempt(replicas[0]);

  let hedgeStarted = false;
  const hedge = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      // Only hedge if another replica exists and the budget allows it
      if (replicas.length < 2 || !hedgeBudget.tryAcquireRetry()) return reject(new Error('no hedge'));
      hedgeStarted = true;
      attempt(replicas[1]).then(resolve, reject);
    }, hedgeAfterMs);
    // Primary settled before the hedge fired: settle the hedge too, or Promise.any could hang
    primary.catch(() => {}).finally(() => {
      if (!hedgeStarted) { clearTimeout(t); reject(new Error('primary settled first')); }
    });
  });

  try {
    return await Promise.any([primary, hedge]); // first success wins
  } finally {
    controllers.forEach((c) => c.abort());       // cancel whoever is still running
  }
}`,
        },
      ],
      keyPoints: [
        'Fan-out turns per-shard p99 into the common case: 1 − 0.99^100 ≈ 63%.',
        'Hedge after ~p95 to a different replica; ~5% extra load; cancel the loser.',
        'Idempotent reads only; budget-limit hedging so it can\'t double load in an outage.',
      ],
      source: 'Dean & Barroso — The Tail at Scale (CACM 2013)',
    },
    {
      heading: '12. Scenario playbook: slow, down, erroring, storms, cascades',
      body: `Use this as the "what do you do when…" cheat table in interviews and on-call.

| Scenario | Symptoms | Immediate mitigation | Structural fix |
|---|---|---|---|
| **One microservice is slow** | Callers' p99 and in-flight rise, pools saturate, CPU of callers often *low* (they're waiting) | Lower caller timeouts, open breaker/kill switch for optional calls, scale the slow service if it's CPU-bound | Per-dependency bulkheads, deadlines, fallbacks, hedging for tails |
| **Service is down (hard fail)** | Connection refused / 503 instantly | Breaker opens, fallbacks serve; ensure callers don't retry-storm | Redundancy across AZs, health-based LB ejection, static stability |
| **Downstream slow vs erroring** | Slow: pools exhausted, latency spikes. Erroring: error rate spikes, latency may *drop* | Slow → timeouts + bulkhead (breaker must count timeouts). Erroring → breaker + fallback; check if errors are retryable | Treat timeout as failure in breakers; alert on both latency and error SLOs |
| **Retry storm** | Downstream load 3–10× normal while user traffic is flat; metastable after trigger clears | Disable retries via config/flag, shed load at edge, scale out, drain queues | One retry layer, retry budget, jitter, Retry-After, gRPC retry throttling |
| **Cascading failure** | Multiple services degrade in call-graph order; pods restart in waves | Shed load at the edge (reduce traffic to a level the system can survive), stop auto-restarts caused by deep health checks, bring back capacity gradually | Everything in this topic + load tests that inject latency (not just errors) |

**Diagnosis tip:** compare the *latency* and *error* dashboards of caller vs callee. If the caller's p99 is 5s but the callee's server-side p99 is 50ms, the time is being spent **queueing in the caller** (pool/agent/event loop) — a bulkhead or pool-sizing problem, not a callee problem.`,
      keyPoints: [
        'Slow dependencies need timeouts + bulkheads; erroring ones need breakers + fallbacks.',
        'Caller-side vs callee-side latency gap = queueing in the caller.',
        'In a cascade: shed load first, recover gradually, then fix structurally.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'rel-patterns-cc-1',
      title: 'The HTTP client that turns a blip into an outage',
      context:
        'This shared client wrapper is used by 30 services to call internal APIs. During last month\'s incident the inventory service had a 20-second hiccup; afterwards its request rate stayed at 6× normal for 12 minutes and it could not recover until the client fleet was redeployed.',
      task:
        'Rewrite callService so it cannot hang, cannot create synchronized retry waves, never retries unsafe requests or permanent errors, respects server hints, and cannot amplify load during an outage.',
      starter: {
        language: 'typescript',
        code: `export async function callService(url: string, init: RequestInit = {}): Promise<any> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, init);          // no timeout at all
      if (!res.ok) throw new Error('status ' + res.status);
      return await res.json();
    } catch (err) {
      attempt++;
      if (attempt > 5) throw err;
      // "exponential backoff"
      await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
}

// Used like this, in handlers that are themselves retried by the gateway:
// await callService('http://inventory/reserve', { method: 'POST', body });
// await callService('http://users/42');`,
      },
      hints: [
        'What stops fetch from waiting forever? What happens to a POST /reserve that timed out after it committed?',
        'If 10,000 clients fail at the same millisecond, when do their retries land?',
        'Which status codes will never succeed on retry, and what should a 429 with Retry-After do? How do you stop retries when the downstream is clearly broken?',
      ],
      solution: {
        language: 'typescript',
        code: `import { RetryBudget } from './retry-budget';

const budgets = new Map<string, RetryBudget>(); // one budget per downstream host
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

export class HttpError extends Error {
  constructor(public status: number, public retryAfterMs?: number) { super('HTTP ' + status); }
}

export async function callService<T>(
  url: string,
  init: RequestInit & { idempotencyKey?: string } = {},
  opts = { timeoutMs: 300, maxAttempts: 3, baseMs: 50, capMs: 1000, deadline: Date.now() + 1000 },
): Promise<T> {
  const host = new URL(url).host;
  const budget = budgets.get(host) ?? new RetryBudget(0.1, 5);
  budgets.set(host, budget);

  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);
  const canRetry = SAFE_METHODS.has(method) || Boolean(init.idempotencyKey);

  for (let attempt = 0; ; attempt++) {
    budget.recordRequest();
    const remaining = opts.deadline - Date.now();
    if (remaining <= 0) throw new Error('deadline exceeded');
    try {
      const res = await fetch(url, {
        ...init, headers,
        signal: AbortSignal.timeout(Math.min(opts.timeoutMs, remaining)),
      });
      if (res.ok) return (await res.json()) as T;
      const ra = Number(res.headers.get('retry-after'));
      await res.body?.cancel(); // free the socket
      throw new HttpError(res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : undefined;
      const transient = status === undefined || RETRYABLE_STATUS.has(status); // network/timeout or 429/5xx-gw
      const last = attempt + 1 >= opts.maxAttempts;
      if (!canRetry || !transient || last || !budget.tryAcquireRetry()) throw err;

      const backoff = Math.random() * Math.min(opts.capMs, opts.baseMs * 2 ** attempt); // full jitter
      const delay = Math.max(backoff, err instanceof HttpError ? err.retryAfterMs ?? 0 : 0);
      if (Date.now() + delay >= opts.deadline) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}`,
      },
      explanation: `**Fixes, one per bug:**

- **No timeout → per-attempt timeout bounded by the overall deadline.** \`AbortSignal.timeout(min(timeoutMs, remaining))\` means a hung dependency costs at most 300ms per attempt and never more than the caller's budget.
- **Retrying non-idempotent POSTs → only safe/idempotent methods, or requests carrying an \`Idempotency-Key\`.** A timed-out \`POST /reserve\` may have committed; retrying it without a key double-reserves stock.
- **Retrying everything → only transient failures.** Network errors, timeouts, 429, 502/503/504 are retried; 400/401/404/409/500-on-business-logic are thrown immediately.
- **No jitter → full jitter.** \`random(0, min(cap, base·2^n))\` spreads retries so recovering servers don't get synchronized waves.
- **6 attempts, 100ms→3.2s sleeps (6.2s total) → 3 attempts inside a 1s deadline.** The old worst-case single call took > 6s plus 6× timeouts that didn't exist.
- **Unbounded amplification → per-host retry budget (10%).** During the 20s hiccup the budget empties quickly and callers fail fast, so inventory sees ~+10% load rather than 6×. That is what removes the metastable 12-minute tail.
- **Ignored server hints → honours \`Retry-After\`.**
- **Socket leak → \`res.body.cancel()\`** on non-2xx so the connection returns to the pool.
- **Layering:** the comment shows the gateway also retries these handlers; the fix at the organisational level is to retry in exactly one layer — this client — and have the gateway not retry.`,
      followUps: [
        {
          "q": "Show how `RetryBudget(0.1, 5)` works internally and why it has a minimum of 5 retries per second.",
          "a": "It keeps two sliding-window counters (e.g. 10 one-second buckets): requests and retries. `tryAcquireRetry()` allows a retry only if `retries < max(minPerSec × window, ratio × requests)`, then increments retries. The 10% ratio bounds amplification to 1.1× under heavy load. The floor of 5/s exists because low-traffic callers (say 2 RPS) would otherwise get 0.2 retries per second, effectively never retrying a single transient blip. Finagle and gRPC's retry throttling use the same idea; gRPC uses a token bucket that gains 0.1 tokens per success and loses 1 per failure."
        },
        {
          "q": "How would you roll this new client out to the 30 services without causing a different incident?",
          "a": "Ship it as a library version with behaviour behind config: first deploy with old-compatible settings (longer timeout, metrics only) to collect baselines per downstream — p99.9 latency, error mix, retry counts. Then set per-host timeouts from those baselines, not one global 300ms, since some endpoints legitimately take longer. Roll out service by service via canary, watching for a jump in timeout errors, which means the timeout is too tight. Coordinate with the gateway team to disable gateway retries at the same time, otherwise you get two retry layers."
        }
      ],
    },
    {
      id: 'rel-patterns-cc-2',
      title: 'Product page taken down by the recommendation widget',
      context:
        'A NestJS product-page BFF aggregates product details (critical), price (critical) and recommendations + reviews (optional). When the recommendation service slowed to 8s p99 last Friday, the entire product page returned 504s and the BFF pods were restarted repeatedly by Kubernetes.',
      task:
        'Refactor getProductPage so that optional dependencies can never fail or slow the page beyond its budget, critical failures fail fast with a clear error, and one slow dependency cannot starve the others. Also fix the health endpoint.',
      starter: {
        language: 'typescript',
        code: `import { Controller, Get, Param } from '@nestjs/common';
import axios from 'axios';

const http = axios.create(); // shared instance, no timeout, default agent

@Controller()
export class ProductPageController {
  @Get('/product/:id')
  async getProductPage(@Param('id') id: string) {
    const [product, price, recos, reviews] = await Promise.all([
      http.get('http://catalog/products/' + id),
      http.get('http://pricing/prices/' + id),
      http.get('http://reco/for-product/' + id),
      http.get('http://reviews/products/' + id + '/summary'),
    ]);
    return { product: product.data, price: price.data, recos: recos.data, reviews: reviews.data };
  }

  @Get('/healthz') // used as livenessProbe
  async health() {
    await Promise.all([
      http.get('http://catalog/healthz'),
      http.get('http://pricing/healthz'),
      http.get('http://reco/healthz'),
    ]);
    return 'ok';
  }
}`,
      },
      hints: [
        'Promise.all rejects if any promise rejects — and waits as long as the slowest one. Which calls should be allowed to fail?',
        'All four calls share one agent and no timeout. What bounds the time and the concurrency spent on reco?',
        'What does Kubernetes do when a liveness probe that depends on reco fails on every pod at once?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Controller, Get, Param, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import http from 'node:http';
import CircuitBreaker from 'opossum';

// Bulkheads: one bounded keep-alive agent + timeout per dependency
const client = (baseURL: string, timeout: number, maxSockets: number): AxiosInstance =>
  axios.create({ baseURL, timeout, httpAgent: new http.Agent({ keepAlive: true, maxSockets }) });

const catalog = client('http://catalog', 250, 50);
const pricing = client('http://pricing', 200, 50);
const reco = client('http://reco', 150, 20);
const reviews = client('http://reviews', 150, 20);

const breaker = (fn: (id: string) => Promise<unknown>, fallback: unknown) => {
  const b = new CircuitBreaker(fn, { errorThresholdPercentage: 50, volumeThreshold: 20, resetTimeout: 10_000 });
  b.fallback(() => fallback); // used when the call fails, times out, or the breaker is OPEN
  return b;
};

const recoBreaker = breaker(async (id) => (await reco.get('/for-product/' + id)).data, { items: [], degraded: true });
const reviewsBreaker = breaker(async (id) => (await reviews.get('/products/' + id + '/summary')).data, null);
const pricingBreaker = new CircuitBreaker(async (id: string) => (await pricing.get('/prices/' + id)).data,
  { errorThresholdPercentage: 50, volumeThreshold: 20, resetTimeout: 10_000 });

@Controller()
export class ProductPageController {
  @Get('/product/:id')
  async getProductPage(@Param('id') id: string) {
    // Optional calls start in parallel and ALWAYS resolve (fallback on any failure)
    const recosP = recoBreaker.fire(id);
    const reviewsP = reviewsBreaker.fire(id);
    try {
      const [product, price] = await Promise.all([
        catalog.get('/products/' + id).then((r) => r.data),
        pricingBreaker.fire(id), // critical: no fallback, fail fast when OPEN
      ]);
      const [recos, reviewSummary] = await Promise.all([recosP, reviewsP]);
      return { product, price, recos, reviews: reviewSummary };
    } catch {
      // Critical dependency failed: clear, fast 503 instead of a 30s hang
      throw new ServiceUnavailableException('Product temporarily unavailable');
    }
  }

  @Get('/healthz') // liveness: process only, never dependencies
  health() {
    return 'ok';
  }
}`,
      },
      explanation: `**What changed and why:**

- **Critical vs optional split.** Only catalog and pricing can fail the page. Reco and reviews go through breakers with fallbacks, so any error, timeout or OPEN state resolves to a degraded value (\`{ items: [], degraded: true }\`) instead of rejecting \`Promise.all\`.
- **Timeouts per dependency.** Page worst case ≈ max(250, 200) for critical + optional already running in parallel with 150ms caps → the page is bounded at ~250ms of dependency time instead of "as slow as the slowest service" (8s).
- **Bulkheads.** Each dependency has its own \`http.Agent\` with \`maxSockets\`. A slow reco can pin at most 20 sockets; catalog and pricing keep their 50 each. Previously every call went through Node's shared global agent (\`maxSockets: Infinity\`), so a slow reco could open unbounded sockets and pile up unbounded pending requests and memory.
- **Circuit breakers.** When reco is clearly broken, the breaker opens after 20+ calls at ≥ 50% failures and stops sending traffic for 10s — reco gets room to recover and the BFF stops paying even the 150ms timeout on every request.
- **Critical fail-fast.** Pricing has a breaker without fallback: when OPEN it rejects in microseconds and the page returns a clean 503 (we must not show a made-up price).
- **Liveness fixed.** The old probe called three services; when reco slowed, every BFF pod failed liveness and got restarted — a self-inflicted outage. Liveness now only proves the process can respond. (If desired, a separate readiness endpoint can check local warm-up state, not shared dependencies.)`,
      followUps: [
        {
          "q": "Recommendations are fine for 99% of requests but the page budget is 300 ms and reco's p99 is 140 ms. Instead of waiting the full 150 ms timeout, can you return the page sooner?",
          "a": "Yes — race the optional calls against the critical path instead of a fixed timeout. Once product and price resolve (say at 60ms), give optional calls a short grace period (e.g. `min(30ms, deadline − now)`) via `Promise.race([recosP, delay(30).then(() => fallback)])`. Most reco responses land within the grace and are included; stragglers are dropped from this response and the client lazy-loads them in a follow-up fetch. Page latency becomes max(critical) + 30ms instead of max(critical, 150ms)."
        },
        {
          "q": "How would you write an integration test proving that an 8 s reco response can no longer slow the page?",
          "a": "Spin up the controller with `@nestjs/testing` and point the reco client at a stub (nock or a local server) that delays 8s. Call `GET /product/1` and assert: status 200, `recos.degraded === true`, and response time < 300ms (with real timers, or fake timers advanced by 200ms). Add a second test firing 50 concurrent requests and assert the reco agent never exceeds its 20 sockets and catalog/pricing stubs still respond normally. A third test sets catalog to return 500 and expects a 503 within ~250ms."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'rel-patterns-iq-01',
      difficulty: 'expert',
      question:
        'Your checkout API\'s p99 jumped from 80ms to 6s and error rates on unrelated endpoints (profile, order history) are climbing. The only change: the fraud-scoring service it calls started taking 4–5s. Walk me through exactly why unrelated endpoints are failing, and what you do now and next week.',
      context: 'NestJS service on Kubernetes, 30 pods, ~3K RPS total, of which ~600 RPS call fraud-scoring.',
      whatInterviewerLooksFor: [
        'Explains cascading failure mechanically with Little\'s Law, not hand-waving',
        'Identifies the shared resource (HTTP agent, DB pool, event loop, memory) being exhausted',
        'Separates immediate mitigation from structural fixes',
        'Knows the difference between slow and failing dependencies for breakers',
        'Considers business semantics of a fraud-check fallback',
      ],
      modelAnswer: `### Why unrelated endpoints fail
- **Little's Law:** fraud calls = 600 RPS × 4.5s ≈ **2,700 in-flight** across 30 pods ≈ 90 per pod, versus ~3 per pod when healthy (600 × 0.15s / 30).
- Those calls hold **shared resources**: the single outbound HTTP agent (say \`maxSockets\` 50 per pod), memory for pending requests, and often a DB connection if the handler opened a transaction before calling fraud. Profile and order-history requests queue behind them for sockets/DB connections — their latency is now "waiting time", not work.
- Gateway times out at 2s and **retries**, adding load; liveness probes on the saturated event loop may fail, pods restart, survivors take more load → death spiral.

### Immediate mitigation (minutes)
1. **Stop the bleeding at the dependency:** drop the fraud-call timeout to ~300ms via config and/or flip a **kill switch** to the fallback policy.
2. Disable gateway retries for checkout temporarily.
3. If pods are restart-looping due to liveness, relax liveness thresholds.
4. Engage the fraud team — their service is the trigger.

### Fraud fallback is a business decision
- Low-value orders (< $50) from trusted accounts: **accept and score asynchronously**, cancel before shipping if fraud flags.
- High-value: fail with "payment verification delayed, retry shortly" or queue for manual review. Never silently skip fraud for all orders.

### Structural fixes (next week)
- **Bulkhead** fraud calls: dedicated agent/semaphore, ~2× healthy concurrency (≈ 10/pod) with a tiny queue.
- **Circuit breaker** that **counts timeouts as failures** (a slow service returns no 5xx — an error-only breaker never trips).
- **Deadline propagation**; never hold a DB transaction across a remote call.
- Liveness process-only; readiness not tied to fraud.
- **Latency-injection** chaos tests, not just error injection.`,
      followUps: [
        {
          q: 'Your breaker was configured but never opened. Why?',
          a: 'Most likely it only counted errors (5xx) and the calls were slow successes, or the per-call timeout was longer than the breaker timeout window, or volumeThreshold was per-pod and too high. Count timeouts as failures and set a call timeout below the pain threshold.',
        },
        {
          q: 'How would you size the fraud bulkhead?',
          a: 'Healthy concurrency per pod = (600/30) × 0.15s = 3. Allow ~2–3× headroom: 8–10 concurrent, queue of a few with 20–50ms max wait. Anything beyond goes to fallback immediately.',
        },
        {
          q: 'Could autoscaling have saved you?',
          a: 'Not really. CPU on checkout pods was low (they were waiting), so an HPA on CPU wouldn\'t fire; scaling out on in-flight would add more callers to an already slow fraud service and deepen its overload. Scaling fraud-scoring itself may help if it is CPU-bound.',
        },
      ],
      pitfalls: [
        'Saying "add more pods to checkout" without noticing it increases load on the slow dependency',
        'Adding retries to the fraud call',
        'Skipping fraud checks for everyone as a fallback without business sign-off',
        'Not mentioning that shared pools/agents are the coupling point',
      ],
    },
    {
      id: 'rel-patterns-iq-02',
      difficulty: 'hard',
      question:
        'Design the retry policy for a request path mobile app → API gateway → BFF → order-service → payment-service → PSP. Every team currently retries 3 times "to be safe". What\'s wrong, and what policy would you standardise?',
      whatInterviewerLooksFor: [
        'Computes amplification multiplicatively',
        'Chooses a single retry layer with reasoning',
        'Addresses idempotency for payments explicitly',
        'Mentions jitter, budgets, deadlines, and server pushback',
      ],
      modelAnswer: `### What's wrong
- 5 hops × 4 attempts each = **4^5 = 1,024** PSP calls per user tap in the worst case. When the PSP is degraded, retries multiply load on exactly the component that is struggling.
- Retrying non-idempotent payment calls risks **double charges**.
- Nested retries also blow the latency budget: the app times out at 10s while inner layers are still retrying.

### Standard policy
1. **One retry layer per failure domain.** The layer closest to the dependency, which knows idempotency semantics, retries: order-service → payment-service and payment-service → PSP. Gateway and BFF do **not** retry (except a single retry on connection-establishment failures, which are safe because the request never reached the server).
2. **Idempotency keys end-to-end.** The app generates an \`Idempotency-Key\` per checkout attempt; payment-service stores (key → result) and passes the key to the PSP (Stripe/Adyen support this natively). Retries become safe.
3. **Attempts and backoff:** max 3 attempts, full jitter, base 50–100ms, cap 1s for interactive paths.
4. **Deadlines:** the gateway sets an absolute deadline (e.g. 3s); each layer passes it on and nobody retries if the remaining budget can't fit another attempt.
5. **Retry budget:** retries ≤ 10% of requests per client per downstream; beyond that fail fast.
6. **Pushback:** honour 429/503 \`Retry-After\`; servers under overload return a "don't retry" error code so upper layers propagate rather than retry.
7. **Mobile client:** retries only on network loss, with jitter and the same idempotency key, and a user-visible "still processing" state.

### Result
Worst case per tap ≈ 3 attempts at one layer, and ~1.1× average load during an outage instead of 1,000×.`,
      followUps: [
        {
          q: 'The PSP times out. Did the charge happen?',
          a: 'Unknown. Retry with the same idempotency key — the PSP returns the original result if it succeeded. If still unknown, mark payment PENDING and reconcile via PSP webhook or status query; never create a new charge with a new key.',
        },
        {
          q: 'Why is retrying a connection-refused error safe at any layer?',
          a: 'No bytes of the request reached the application, so no side effect occurred. It is still subject to the budget to avoid storms.',
        },
        {
          q: 'How do you enforce this across 40 teams?',
          a: 'Ship a shared client library or mesh config (Envoy retry policy with retry budgets) as the default, lint/alert on retry ratio per service, and make retries visible in tracing.',
        },
      ],
      pitfalls: [
        'Adding retries at every layer with "only 2 retries" — still multiplicative',
        'Ignoring idempotency for payments',
        'Exponential backoff without jitter',
        'Not tying retries to the overall deadline',
      ],
    },
    {
      id: 'rel-patterns-iq-03',
      difficulty: 'hard',
      question:
        'You\'re adding circuit breakers to 200 pods calling an inventory service. How do you choose the thresholds, what is the granularity, and what happens during half-open with 200 independent breakers?',
      whatInterviewerLooksFor: [
        'Knows the state machine and its parameters (window, volume threshold, error %, reset timeout)',
        'Chooses per-host/per-endpoint granularity and mentions outlier detection',
        'Reasons about fleet-level dynamics of independent breakers',
        'Ties breaker config to SLOs and observability',
      ],
      modelAnswer: `### Parameters
- **Rolling window:** 10s in 1s buckets — long enough to be statistically meaningful at your RPS, short enough to react.
- **Volume threshold:** per pod, inventory calls ≈ 5K RPS / 200 = 25 RPS → 250 calls per window; require ≥ 20 calls so a single failure at low traffic doesn't trip.
- **Error threshold:** start at 50%; lower (20–30%) if the dependency normally has ~0% errors and failures are expensive. Count **timeouts and 5xx**, not 4xx.
- **Call timeout:** ~p99.9 × 1.5 of inventory (e.g. 150ms), so slowness registers as failure.
- **Reset timeout:** 5–30s, **jittered per pod** (e.g. 10s ± 3s) so the fleet doesn't probe in lockstep.

### Granularity
- **Per endpoint** at least: \`GET /stock\` failing shouldn't block \`POST /reserve\` if they use different backends.
- **Per host** is better handled by the LB/mesh: Envoy **outlier detection** ejects a single bad replica after N consecutive 5xx; the app-level breaker then only trips when the service as a whole is unhealthy.

### Half-open with 200 breakers
- Each pod independently allows a few probes after its reset timeout. Worst case ~200–600 probe requests land over a few seconds — that's ~0.1s of normal traffic, usually fine. With jittered reset timeouts they spread out.
- Pods recover independently, so traffic ramps back gradually — an accidental **slow start**, which is good for a recovering service.
- If the dependency is fragile (e.g. cold caches), allow only 1 probe per pod and let success ramp a percentage (some libs support gradual close).

### Operations
- Emit metrics on state transitions; alert when > X% of pods have a breaker open.
- Expose a **manual override** (force open/closed) for incidents.
- Load test with injected latency to validate thresholds.`,
      followUps: [
        {
          q: 'Why not one centralized breaker state in Redis?',
          a: 'It adds a network dependency to every call and a new single point of failure; local breakers converge quickly because every pod sees the same failing dependency. Centralize only the manual override flag.',
        },
        {
          q: 'Inventory fails only for one tenant\'s large SKUs. Breaker behaviour?',
          a: 'A service-level breaker may trip and hurt all tenants. Either key breakers by a meaningful dimension (endpoint/tenant tier) or keep the error from counting (e.g. classify as a client-specific 4xx-like failure).',
        },
      ],
      pitfalls: [
        'No minimum volume, so breakers flap at low traffic',
        'Counting 404/400 as failures',
        'Error-only breaker that never trips on slowness',
        'Not considering what the caller does when the breaker is open',
      ],
    },
    {
      id: 'rel-patterns-iq-04',
      difficulty: 'hard',
      question:
        'Your edge SLA is 1 second for GET /itinerary, which calls trips → (flights ∥ hotels) → pricing. Each team set its own 1s timeout. Users see 504s but backends show lots of wasted work. How do you set timeouts properly?',
      whatInterviewerLooksFor: [
        'Understands that independent timeouts do not compose',
        'Proposes budgets from percentiles and deadline propagation',
        'Handles cancellation of abandoned work',
        'Accounts for retries within the budget',
      ],
      modelAnswer: `### Why the current setup fails
- The edge times out at 1s, but trips waits up to 1s for flights, which waits up to 1s for pricing: a request can take ~2–3s internally; the user already has a 504, yet all layers keep working → **wasted work** and extra load during incidents.

### Budgeting
- Measure p99/p99.9 per hop. Example: trips own logic 30ms, flights p99.9 250ms, hotels p99.9 300ms (parallel), pricing p99.9 120ms.
- Edge 1000ms → trips gets ~950ms; flights/hotels each get ≤ 400ms (includes their pricing call ≤ 150ms); leave room for **one** retry only where it fits (e.g. pricing retry once if > 150ms remain).

### Deadline propagation
- Edge stamps \`x-request-deadline\` (absolute epoch ms, or remaining ms to avoid clock skew). Every service computes \`remaining = deadline − now − margin\` and uses \`min(perCallCap, remaining)\` for children. With gRPC this is built in (\`grpc-timeout\`).
- If remaining ≤ 0 on entry → reject immediately (don't even start).

### Cancellation
- Wire \`AbortSignal\` from the incoming request (\`req.on('close')\`) through all outgoing calls; set Postgres \`statement_timeout\` so abandoned queries stop.

### Validation
- Track "work after deadline" metric (requests completed after their deadline) — it should be near zero.
- Alert on timeout rate per edge > 0.1%.`,
      followUps: [
        {
          q: 'Clock skew breaks absolute deadlines. Alternative?',
          a: 'Propagate relative remaining time (like gRPC\'s grpc-timeout) and convert to a local absolute deadline on receipt; network transit is small compared to skew risk, and you subtract a margin.',
        },
        {
          q: 'Hotels is sometimes 900ms because a partner API is slow. Now what?',
          a: 'Return itinerary without hotel section (degraded flag) after its budget expires, cache partner results, or make hotel availability async and stream it to the client later.',
        },
      ],
      pitfalls: [
        'Setting every timeout equal to the SLA',
        'Forgetting that retries consume the same budget',
        'No cancellation, so timed-out work continues',
      ],
    },
    {
      id: 'rel-patterns-iq-05',
      difficulty: 'expert',
      question:
        'On Black Friday you expect 3× normal traffic but can only get 2× capacity in time. How do you keep checkout working when overload hits?',
      whatInterviewerLooksFor: [
        'Understands goodput collapse under overload',
        'Designs priority-based load shedding with cheap rejection',
        'Distinguishes load shedding from rate limiting',
        'Plans graceful degradation of non-critical features',
        'Thinks about retries and client behaviour during shedding',
      ],
      modelAnswer: `### Principle
Beyond saturation, a service that accepts everything serves **nobody** in time: queues grow, latency exceeds client timeouts, CPU is wasted on requests that are then abandoned (goodput → 0). The goal is to stay at the throughput "knee" and choose *which* requests to drop.

### 1. Classify traffic by criticality
- **Critical:** add-to-cart, checkout, payment.
- **Default:** product pages, search.
- **Sheddable:** recommendations, reviews, analytics beacons, prefetch.
- Propagate an \`x-criticality\` header from the edge through all RPCs.

### 2. Shed early and cheaply
- **Edge/gateway:** per-route concurrency limits; waiting room/queue page for browsing traffic if needed.
- **Service middleware:** reject when in-flight > limit (from load tests) or event-loop lag > 150ms; sheddable at 70% of limit, default at 90%, critical at 100%. Rejection = 503 + \`Retry-After\`, no auth/DB work.
- **Queue-time shedding:** drop any request that waited longer than its deadline.
- **Adaptive limits** (gradient/Vegas-style concurrency limiter) so the limit follows real latency.

### 3. Degrade features proactively
- Kill switches: turn off recommendations, personalised ranking, live inventory counts ("in stock" from cache).
- Serve product pages from CDN/stale cache.

### 4. Control retries
- Clients honour Retry-After with jitter; retry budgets stop amplification when shedding starts.

### 5. Prepare
- Load test to 3× to find the knee per service; pre-scale to 2×; warm caches; freeze deploys.

**Expected outcome:** at 3× demand, browsing sees some 503s/degraded pages, but checkout runs near 100% success because capacity was reserved for it.`,
      followUps: [
        {
          q: 'How is this different from rate limiting?',
          a: 'Rate limiting enforces per-client quotas regardless of server health; load shedding protects server capacity regardless of client. A legitimate user within quota can still be shed during overload.',
        },
        {
          q: 'What limit value do you use for in-flight?',
          a: 'From load tests: the concurrency where throughput stops increasing and latency starts rising (e.g. 200/pod). Or use an adaptive limiter that probes around that knee.',
        },
      ],
      pitfalls: [
        'Relying solely on autoscaling (too slow, capped here)',
        'Shedding after doing expensive work (auth, DB lookup)',
        'Dropping requests randomly instead of by priority',
      ],
    },
    {
      id: 'rel-patterns-iq-06',
      difficulty: 'medium',
      question:
        'During a 40-second Postgres failover, Kubernetes restarted every pod of your API and the outage lasted 12 minutes. Explain what happened and how you would design health checks.',
      whatInterviewerLooksFor: [
        'Recognises dependency checks in liveness probes as the root cause',
        'Knows liveness vs readiness vs startup semantics',
        'Explains cold-start stampede after mass restart',
        'Mentions heartbeats vs health checks where relevant',
      ],
      modelAnswer: `### What happened
1. Liveness probe ran \`SELECT 1\`. During failover every pod failed it for ~40s → \`failureThreshold\` 3 × \`periodSeconds\` 10 → all pods restarted around the same time.
2. Pods came back **cold**: empty in-process caches, JIT not warm, connection pools reconnecting simultaneously. The new primary got a **connection storm** (hundreds of pods × pool size) plus a cache-miss stampede.
3. Pods were slow to become ready; some failed liveness again under load → restart loop. The 40s DB blip turned into 12 minutes.

### Health-check design
- **Liveness:** process-only. "Can I respond on the HTTP port / is the event loop not deadlocked?" No DB, Redis, or downstream checks. Generous threshold (e.g. 3 × 10s).
- **Readiness:** "Should I get traffic?" — boot/warm-up finished, not draining during shutdown, local overload. Avoid making readiness depend on a *shared* dependency; if all pods go unready together, the Service has zero endpoints and you convert a partial degradation into a total outage. Better to stay ready and return fast 503s/degraded responses for DB-dependent endpoints.
- **Startup probe:** protects slow boots from liveness kills.
- **Graceful shutdown:** preStop sleep + drain in-flight on SIGTERM.

### DB-side resilience
- Pool with bounded size, acquisition timeout, jittered reconnect backoff; PgBouncer to absorb connection storms.
- Circuit breaker on DB-dependent endpoints; cached reads served during failover.

### Heartbeats vs health checks
Heartbeats are pushed by members (Kafka consumers, leases in etcd) to maintain *membership*; health checks are pulled by LBs/orchestrators to route traffic. Both need thresholds tolerant of GC pauses to avoid flapping.`,
      followUps: [
        {
          q: 'When is a dependency check in readiness reasonable?',
          a: 'When the dependency is per-instance (a local sidecar, a pod-local cache that must be loaded) or when only some pods lose it (e.g. zonal connectivity), so traffic shifts to healthy pods rather than all going unready.',
        },
        {
          q: 'How do you stop the reconnect storm on the new primary?',
          a: 'Jittered exponential backoff on reconnect, smaller per-pod pools, a pooler like PgBouncer/RDS Proxy in front, and staggered rollout/restart.',
        },
      ],
      pitfalls: [
        'Putting DB checks in liveness "to be thorough"',
        'Assuming readiness failures are harmless',
        'Ignoring cold-start and reconnect stampedes',
      ],
    },
    {
      id: 'rel-patterns-iq-07',
      difficulty: 'expert',
      question:
        'A search service fans out each query to 100 index shards and waits for all. Each shard\'s p99 is 40ms but the service p99 is 400ms. Explain why and how you would fix the tail without doubling cost.',
      whatInterviewerLooksFor: [
        'Computes the probability of hitting at least one tail',
        'Proposes hedged/tied requests with a budget',
        'Mentions partial results and replica selection',
        'Understands cost/benefit and when hedging hurts',
      ],
      modelAnswer: `### Why
- The query is as slow as its **slowest** shard. P(at least one of 100 shards exceeds its p99) = 1 − 0.99^100 ≈ **63%**. So the service's *median* is already around a shard's p99, and its p99 corresponds to roughly a shard's p99.99 — GC pauses, compaction, noisy neighbours.

### Fixes
1. **Hedged requests:** each shard has ≥ 2 replicas. Send to one; if no reply after the shard's **p95** (~15–20ms), send to another replica (different host/AZ), take the first, cancel the loser. Extra load ≈ 5% of shard requests; tail drops dramatically (Google's BigTable example: p99.9 1,800ms → 74ms with ~2% more requests).
2. **Tied requests:** enqueue on two replicas with cross-cancellation when one starts executing — removes queueing delay variance.
3. **Budget the hedges:** cap at ~5–10% extra; disable when the whole tier is slow (hedging then doubles load on an overloaded system).
4. **Partial results:** for search, returning results from 98/100 shards after a deadline (e.g. 100ms) is often acceptable — mark response \`partial: true\`.
5. **Reduce variance at the source:** latency-aware replica selection (least outstanding requests / EWMA), background work throttling (compactions), request micro-partitioning so slow shards can be rebalanced.

### Cost check
Hedging at p95 → ≤ 5% more shard queries, vs 100% for "always send two". Measure p99 and total QPS on shards before and after.`,
      followUps: [
        {
          q: 'Why hedge at p95 and not p50?',
          a: 'Hedging at p50 duplicates ~50% of requests (almost doubling cost). At p95 only 5% are duplicated while still cutting off the long tail.',
        },
        {
          q: 'Could you hedge writes?',
          a: 'Only if they are idempotent or carry idempotency keys and the storage handles concurrent duplicate application; generally hedging is for reads.',
        },
      ],
      pitfalls: [
        'Saying "add more shards" (makes the fan-out tail worse)',
        'Hedging every request immediately',
        'Hedging to the same replica/host',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'rel-patterns-boe-1',
      question:
        'An orders service (20 pods) calls pricing at 2,000 RPS. Pricing normally responds in 40ms but degrades to 3s. Each pod has one shared outbound pool of 100 sockets. What happens, and what timeout/bulkhead values keep orders healthy?',
      assumptions: [
        '2,000 RPS evenly spread → 100 RPS per pod to pricing',
        'Other dependencies of orders need ~30 sockets per pod in steady state',
        'Pricing p99.9 when healthy ≈ 120ms',
      ],
      steps: [
        { label: 'Healthy concurrency per pod', calc: '100 RPS × 0.04s = 4 in-flight pricing calls' },
        { label: 'Degraded concurrency per pod', calc: '100 RPS × 3s = 300 in-flight → exceeds pool of 100' },
        { label: 'Effect on other deps', calc: 'Pool full of pricing calls → other 30 needed sockets queue → all endpoints slow' },
        { label: 'Timeout choice', calc: 'p99.9 120ms × ~1.7 ≈ 200ms → degraded concurrency = 100 × 0.2 = 20 per pod' },
        { label: 'Bulkhead choice', calc: 'Healthy 4 × ~5 headroom ≈ 20–25 sockets reserved for pricing; others keep ≥ 75' },
      ],
      answer:
        'Without limits, pricing needs ~300 concurrent calls per pod and starves every other dependency. A 200ms timeout caps it at ~20 in-flight per pod, and a 25-socket pricing bulkhead guarantees the other ~75 sockets stay available.',
      insight:
        'Timeouts bound latency, which bounds concurrency (Little\'s Law); bulkheads bound concurrency directly. You need both, and you size them from healthy percentiles, not from what the dependency does when broken.',
      followUps: [
        {
          "q": "Pricing's legitimate p99.9 is actually 1.5 s for some large carts, so you can't set the timeout below 2 s. With pricing degraded to 3 s, what share of pricing calls now get served versus rejected by a 25-socket bulkhead?",
          "a": "With a 2s timeout each pricing call holds a socket for 2s, so per-pod in-flight demand is 100 RPS × 2s = 200, but the bulkhead allows 25. Throughput through the bulkhead = 25 / 2s = 12.5 RPS, so 87.5 of 100 RPS (87.5%) are rejected immediately. That protects orders' other dependencies, but pricing is critical, so 87.5% of orders fail. The fix is a circuit breaker so failures are instant, plus splitting large-cart pricing into its own route/bulkhead with the longer timeout, keeping the common path at 200ms."
        },
        {
          "q": "Traffic grows 10× to 20,000 RPS but you keep 20 pods. Redo the healthy concurrency and say what breaks first.",
          "a": "Per pod: 1,000 RPS to pricing → healthy in-flight 1,000 × 0.04 = 40, already above the 25-socket bulkhead, so it rejects healthy traffic. Other dependencies need ~10 × 30 = 300 sockets, three times the whole pool of 100. The shared pool breaks first, even with a healthy pricing service. Either scale pods ~10× (back to the original numbers per pod) or resize per pod: pricing bulkhead ≈ 40 × 2.5 ≈ 100, other deps ≈ 300 + headroom, and check the CPU/event loop can handle 1,000 RPS per pod at all."
        }
      ],
    },
    {
      id: 'rel-patterns-boe-2',
      question:
        'User traffic is 10,000 RPS. The path has 4 layers, each doing up to 3 retries (4 attempts). The bottom DB can serve 15,000 QPS. Estimate the DB load (a) when the DB is hard-down, (b) with a 50% independent transient error rate and retries at only the bottom layer, and (c) with a single-layer 10% retry budget.',
      assumptions: [
        'Hard-down: every attempt fails, so every layer exhausts its attempts',
        'Transient case: each DB attempt fails independently with p = 0.5',
        'Expected attempts with up to 3 retries = 1 + p + p² + p³',
      ],
      steps: [
        { label: '(a) Hard-down amplification', calc: '4 attempts ^ 4 layers = 256 DB attempts per user request' },
        { label: '(a) Offered DB load', calc: '10,000 × 256 ≈ 2.56M QPS offered (bounded only by timeouts/pools) vs 15K capacity' },
        { label: '(b) Expected attempts, bottom-layer retries', calc: '1 + 0.5 + 0.25 + 0.125 = 1.875 → 10,000 × 1.875 ≈ 18,750 QPS' },
        { label: '(b) Consequence', calc: '18,750 > 15,000 → DB saturates → error rate rises above 50% → attempts climb toward 4× = 40K QPS' },
        { label: '(c) 10% retry budget', calc: '10,000 × 1.10 = 11,000 QPS ≤ 15,000 → DB keeps headroom to recover' },
      ],
      answer:
        'Hard-down with nested retries offers ~2.5M QPS (256×) to a 15K-QPS DB; even single-layer retries at 50% errors push ~19K QPS, which tips it into overload and a feedback loop. A 10% budget caps it at ~11K QPS.',
      insight:
        'Per-request caps ("max 3 retries") say nothing about aggregate load, and failures under overload are correlated, so the realistic case trends toward the hard-down math. Only a ratio budget plus a single retry layer bounds total load.',
      followUps: [
        {
          "q": "Instead of one layer, each of the 4 layers adopts its own 10% retry budget. What is the worst-case DB load now?",
          "a": "Budgets multiply like retries: 1.1^4 ≈ 1.464, so 10,000 × 1.464 ≈ 14,641 QPS — just under the 15,000 QPS capacity, with only ~2% headroom. Any extra load (a traffic bump, a slow query) tips it into overload. That is why the budget should apply in one layer only (typically the one closest to the failing resource), or upper layers should propagate \"don't retry\" signals. Per-layer budgets are far better than 4^4 = 256×, but they still compound."
        },
        {
          "q": "The DB is hard-down with the single-layer 10% budget in place. What does the DB see, and what does the user see?",
          "a": "The DB receives about 11,000 QPS of connection attempts that all fail. If clients have a fast connect timeout and a circuit breaker, that falls to near zero once breakers open (a few probes per pod per resetTimeout). Users see fast errors or fallbacks instead of timeouts: failures cost ~1 attempt plus a 10% retry, so latency stays near the connect timeout. When the DB recovers it faces ~11K QPS (73% of capacity) instead of a 2.56M-QPS wall, so it comes back without a metastable tail."
        }
      ],
    },
    {
      id: 'rel-patterns-boe-3',
      question:
        'A query fans out to 50 shards (each 2 replicas). Shard latency: p50 5ms, p95 20ms, p99 60ms. Estimate the fraction of queries hitting at least one ≥ p95 shard, and the extra load if you hedge at p95.',
      assumptions: [
        'Shard latencies independent',
        'Hedge sent to the second replica only when the first exceeds p95',
        '20,000 queries/s → 1M shard requests/s',
      ],
      steps: [
        { label: 'P(no shard > p95)', calc: '0.95^50 ≈ e^(50 × ln 0.95) = e^(−2.56) ≈ 0.077' },
        { label: 'Queries with ≥1 slow shard', calc: '1 − 0.077 ≈ 92% of queries wait on a p95+ shard' },
        { label: 'P(no shard > p99)', calc: '0.99^50 ≈ 0.605 → ~40% of queries see a p99 (60ms) shard' },
        { label: 'Hedge load', calc: '5% of 1M shard req/s = 50K extra req/s (+5%)' },
        { label: 'Post-hedge per-shard tail', calc: 'Slow only if both replicas are slow: ≈ 0.05 × 0.05 = 0.25% → P(query clean at ~40ms) ≈ 0.9975^50 ≈ 88%' },
      ],
      answer:
        'Without hedging ~92% of queries wait on a p95+ shard and ~40% on a p99 (60ms) shard. Hedging at p95 costs about 5% more shard load and brings roughly 88% of queries to finish within ~p95 + hedge latency (~40ms).',
      insight:
        'At high fan-out, tail latency is the typical latency. Cheap, budgeted hedging beats raw capacity because it attacks variance, not the mean.',
      followUps: [
        {
          "q": "The index grows and fan-out goes from 50 to 200 shards with the same per-shard latencies. What fraction of queries finish cleanly with p95 hedging now, and what do you change?",
          "a": "Post-hedge per-shard slow probability stays ≈ 0.25%, so P(clean) = 0.9975^200 ≈ 61%, down from 88%. Without hedging it is 0.95^200 ≈ 0.004% — virtually every query waits on a slow shard. Hedging alone no longer suffices. Levers: allow partial results (return when ≥ 99.5% of shards answer, flag coverage) because search ranking tolerates a missing shard; reduce fan-out with bigger shards or a two-level tree; and attack variance at the source (GC tuning, isolating compaction). Each additional lever multiplies the gain."
        },
        {
          "q": "Replicas are in different AZs with 1 ms extra RTT, and hedges cross AZ. Does that change the p95 hedge decision or its cost?",
          "a": "Latency-wise barely: the hedge adds ~1ms to a 20ms+ tail request, so the post-hedge tail is ≈ p95 + hedge time + 1ms. Cost-wise, cross-AZ traffic is billed (around $0.01/GB each way on AWS). At 50K hedges/s with ~2KB responses, that is ~100MB/s ≈ 8.6TB/day — roughly $170/day — worth tracking but small versus adding capacity. Prefer same-AZ replicas for the primary request and hedge cross-AZ only, so the extra charge applies only to the 5%."
        }
      ],
    },
  ],
  test: [
    {
      id: 'rel-patterns-mcq-01',
      difficulty: 'hard',
      question:
        'Service A calls B at 800 RPS. B\'s latency goes from 25ms to 4s with no errors. A\'s CPU drops from 60% to 15% while A\'s p99 on ALL endpoints rises to 4s. What is the most likely mechanism?',
      options: [
        'Requests to B hold A\'s shared connection pool slots, so calls to other dependencies queue behind them',
        'A\'s event loop is blocked by CPU-heavy JSON parsing of B\'s responses',
        'B is returning larger payloads, saturating A\'s network interface',
        'Kubernetes throttled A\'s CPU quota because B was slow',
      ],
      correct: [0],
      explanation:
        'In-flight calls to B jump from 800 × 0.025 = 20 to 800 × 4 = 3,200; they pin the shared pool/agent, and other endpoints wait for sockets — time spent queueing, not computing, hence low CPU. A blocked event loop would show high CPU. Payload size and CPU throttling don\'t explain low CPU with uniform latency.',
      followUps: [
        {
          "q": "You can't deploy code to A for 30 minutes. What can you change at the infrastructure level right now to stop the 3,200 in-flight calls to B from starving the other endpoints?",
          "a": "Put the limit outside the process. In a mesh, set an Envoy/Istio `DestinationRule` on B with `connectionPool.http.http1MaxPendingRequests` and `maxRequestsPerConnection` caps plus an outlier/timeout of a few hundred ms via a `VirtualService` timeout — excess calls to B now fail in microseconds at the sidecar instead of holding A's sockets. Without a mesh, you can scale B down to fail fast (counter-intuitive but effective) or feature-flag the B-dependent route off at the gateway. Then follow up in code with a per-dependency agent (`maxSockets`) and a timeout derived from B's healthy p99.9."
        },
        {
          "q": "Which two metrics on A's dashboards would have told you this within a minute, before anyone looked at B?",
          "a": "First, outbound in-flight requests (or pool `pending` / socket-acquire wait time) per downstream host: it would jump from ~20 to thousands for B while staying flat for others. Second, request latency broken down by phase — time-to-acquire-socket vs time-on-wire. A rising acquire wait on endpoints that never call B, together with falling CPU, points directly at a shared pool. Event-loop lag would stay flat, ruling out CPU-bound causes. Alert on in-flight per dependency exceeding ~3× its Little's-Law baseline (RPS × healthy latency)."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-02',
      difficulty: 'expert',
      question:
        'A circuit breaker on a downstream call has errorThresholdPercentage 50 and volumeThreshold 20. During an incident the downstream becomes extremely slow but never returns errors, and the breaker stays CLOSED. Which configuration explains this?',
      code: {
        language: 'typescript',
        code: `const breaker = new CircuitBreaker(callDownstream, {
  timeout: false,                // opossum: disable its own timeout
  errorThresholdPercentage: 50,
  volumeThreshold: 20,
  resetTimeout: 10_000,
});
// callDownstream uses fetch() with no AbortSignal`,
      },
      options: [
        'volumeThreshold is too high, so the breaker never gets enough samples',
        'resetTimeout of 10s is too short, so the breaker closes immediately after opening',
        'errorThresholdPercentage should be 100 for slow dependencies',
        'Nothing converts slowness into failure: the breaker timeout is disabled and fetch has no timeout, so calls simply don\'t complete',
      ],
      correct: [3],
      explanation:
        'A breaker only counts completed outcomes. With timeout disabled and no fetch timeout, slow calls hang and are never recorded as failures, so the error rate stays 0%. Volume 20 is easily reached at normal RPS; resetTimeout only matters once it opens; raising the threshold makes it even less likely to trip.',
      followUps: [
        {
          "q": "You add a 500ms timeout so slow calls now count as failures. The downstream sits at 450ms latency — just under the timeout — and your callers are still suffering. What does the breaker need now?",
          "a": "A slow-call criterion, not just a failure criterion. Resilience4j has `slowCallDurationThreshold` (e.g. 200ms) and `slowCallRateThreshold` (e.g. 50%): the breaker opens when half of recent calls are slower than the threshold even though they succeed. With opossum you can emulate it by tracking latency percentiles in the rolling window and calling `breaker.open()` yourself. Set the slow threshold from the healthy p99 (say 3× it), so a dependency drifting from 40ms to 450ms trips the breaker long before your pool fills."
        },
        {
          "q": "With 200 pods each running this breaker at volumeThreshold 20, the downstream takes 10 s to recover. What does the first half-open probe wave look like, and how would you soften it?",
          "a": "With identical resetTimeout of 10s, all 200 breakers opened within the same few seconds and will go half-open together, so ~200 trial requests (or more, if half-open admits several) arrive at once on a just-recovered service. If any fail, everyone re-opens and the cycle repeats. Soften it with a jittered resetTimeout (e.g. 10s ± 30%), admitting only one probe per pod in half-open, and requiring several consecutive successes before fully closing. Ramping traffic gradually after close (e.g. 10% → 50% → 100% over 30s) prevents the full 800-RPS-per-pod herd from hitting cold caches."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-03',
      difficulty: 'hard',
      question:
        'A request flows gateway → A → B → C → D. The gateway, A, B and C each call the next hop with maxAttempts = 3 (2 retries) on any failure. D is hard-down. How many attempts does D receive per user request?',
      options: ['12', '81', '64', '9'],
      correct: [1],
      explanation:
        'Attempts multiply: each of the 4 layers makes 3 attempts of the layer below, so 3^4 = 81 calls reach the bottom. 12 (3 × 4) assumes additive retries; 64 would be 4^3 (confusing attempts and layers); 9 counts only two layers.',
      followUps: [
        {
          "q": "Management won't let you remove retries from the gateway and from A. You can change only B and C. How do you cut the 81× amplification?",
          "a": "Make B and C stop retrying, and have them return a signal that tells upstream layers not to retry either. If B and C use maxAttempts = 1, amplification drops to 3 × 3 × 1 × 1 = 9 attempts at D. Better, when C sees D is down (breaker open), it returns a non-retryable status such as 503 with a header like `x-no-retry: true` or a gRPC `RESOURCE_EXHAUSTED` with retry-pushback. Upstream clients that honour it collapse to 1 attempt each. Even if they don't, an open breaker in C means each of those 9 attempts costs D nothing."
        },
        {
          "q": "Each layer's per-attempt timeout is 1 s and backoff is negligible. How long does the user wait before the gateway finally gives up when D is down?",
          "a": "If every layer waits for the full nested chain, latency multiplies too. C's call to D takes 3 × 1s = 3s; but B's per-attempt timeout to C is 1s, so B times out each attempt at 1s while C keeps working (orphaned). B then takes 3s, A 3s, gateway 3s total. So the user waits ~3s, but the orphaned work below keeps running up to 3s per orphaned attempt — D still gets close to 81 attempts across overlapping retries. This is why per-hop timeouts without deadline propagation hide amplification: the user sees 3s, the backend sees an 81× storm."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-04',
      difficulty: 'expert',
      question: 'Which statements about this backoff implementation are true? Select ALL that apply.',
      code: {
        language: 'typescript',
        code: `for (let attempt = 0; attempt < 5; attempt++) {
  try { return await call(); } catch (e) {
    const delay = Math.min(2000, 100 * 2 ** attempt);
    await sleep(delay / 2 + Math.random() * (delay / 2));
  }
}`,
      },
      options: [
        'It is "equal jitter": always waits at least half the exponential delay',
        'It is "full jitter": waits uniformly between 0 and the exponential delay',
        'It retries regardless of whether the error is retryable',
        'The final failure after 5 attempts is swallowed and the function resolves undefined',
        'Clients that fail simultaneously will retry at exactly the same moment',
      ],
      correct: [0, 2, 3],
      explanation:
        'delay/2 + random(0, delay/2) is equal jitter, not full jitter (which is random(0, delay)). There is no error classification, so 400s are retried too. After the loop exits no error is rethrown, so the caller gets undefined — a silent failure. The random component de-synchronizes clients, so option 5 is false.',
      followUps: [
        {
          "q": "You switch to full jitter. Why does full jitter finish the backlog faster than equal jitter after a mass failure, even though some clients retry almost immediately?",
          "a": "AWS's backoff simulations showed full jitter `random(0, delay)` produces the fewest total calls and the shortest completion time for N contending clients: it spreads the retries across the whole window, so arrivals per instant are lowest. Equal jitter keeps everyone out of the first half of the window, then packs them into the second half — twice the arrival density. Some clients retrying at ~0ms is fine because they are a small, uniformly spread fraction. The real risk is a server that is still down; that is controlled by a retry budget, not by the jitter shape."
        },
        {
          "q": "How would you write a unit test that proves this function no longer swallows the final error and doesn't retry a 400 — without the test taking 30 seconds?",
          "a": "Inject the clock and randomness. Make `sleep` and `random` parameters (or use Jest/Vitest fake timers with `vi.advanceTimersByTimeAsync`). Test 1: a stub that always throws a retryable error; assert it is called exactly maxAttempts times and the returned promise rejects with the last error (`await expect(p).rejects.toThrow()`). Test 2: a stub that throws `HttpError(400)`; assert one call and immediate rejection. Test 3: seed random to 0 and 1 to assert delays stay within [0, min(cap, base·2^n)]. With fake timers the suite runs in milliseconds."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-05',
      difficulty: 'medium',
      question:
        'Checkout calls the recommendations API with the Node http client below and retries twice on error. Recommendations is in a GC storm: it sends headers after 100 ms, then one small chunk every 1.5 s for about 40 s. Checkout requests now take up to two minutes despite the "2 s timeout". Why does the timeout not fire?',
      code: {
        language: 'typescript',
        code: `import http from 'node:http';

function getRecs(userId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      \`http://recs.internal/users/\${userId}/recs\`,
      { timeout: 2000 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
// caller: retry(getRecs, { attempts: 3 })`,
      },
      options: [
        'The timeout option only covers the TCP connect phase; once the socket is connected no timer is running.',
        'The timeout option is a socket inactivity timer that resets whenever bytes arrive, so a response trickling a chunk every 1.5 s never goes 2 s idle; use one overall deadline such as AbortSignal.timeout(2000) covering the body too.',
        'The "timeout" event fires, but Node never aborts the request, so the call keeps running until the server finishes.',
        'The keep-alive agent reuses a socket whose timer belonged to an earlier request, so the new request\'s 2 s timer is never armed.',
      ],
      correct: [1],
      explanation:
        'Node\'s timeout option calls socket.setTimeout, which fires only after 2 s with no activity; each 1.5 s chunk resets it, so one attempt lasts ~40 s and three attempts ~2 minutes. It is not limited to connect — a slow first byte would trip it, but a slow drip does not. The "timeout" event really does not abort by itself, but this code handles that with req.destroy(). Agent sockets get a fresh timer per request. The fix is a total deadline for the whole attempt (and a total budget across retries), e.g. fetch with AbortSignal.timeout.',
      followUps: [
        {
          "q": "You switch to `fetch` with `AbortSignal.timeout(2000)`. The call has 2 retries. What overall worst case does checkout now see, and how do you bound it to checkout's own 1.5 s budget?",
          "a": "Each attempt is capped at 2s, so three attempts plus backoff is ~6s+ — still way over budget. Pass a deadline down: compute `remaining = deadline − now` before each attempt and use `AbortSignal.timeout(Math.min(perAttempt, remaining))`; skip a retry if the backoff would exceed the deadline. For a 1.5s page budget with recommendations being optional, a realistic setting is one attempt at ~300ms, no retry, and a fallback of empty recommendations. `AbortSignal.any([callerSignal, AbortSignal.timeout(ms)])` also cancels the call if the upstream client disconnects."
        },
        {
          "q": "How would you reproduce this slow-drip behaviour in a test environment so the fix is verified, not assumed?",
          "a": "Use a fault-injecting stub server: a tiny Node server that writes headers, then `res.write('x')` every 1.5s for 40s. Toxiproxy's `slicer` + `latency` toxics or Envoy's fault filter can do the same in front of the real service. Assert that the client call rejects with an AbortError in ~2s (±100ms) and that the socket is destroyed (agent's `sockets` count returns to baseline). Add it to the contract test suite for every shared HTTP client so a future refactor back to `timeout:` is caught."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-06',
      difficulty: 'expert',
      question:
        'After a 15-second DB outage ends, the DB stays pegged at 100% CPU for 20 minutes, even though user traffic is normal. Clients retry 3× with exponential backoff (no jitter). Which is the best explanation and fix?',
      options: [
        'Buffer pool is cold; wait it out or pre-warm with pg_prewarm',
        'Replication lag on replicas; route reads to the primary',
        'Metastable failure driven by synchronized retry load; add jitter and a retry budget, and shed load until it drains',
        'Connection pool too small on clients; increase it so requests finish faster',
      ],
      correct: [2],
      explanation:
        'Load that persists after the trigger is gone, with flat user traffic, is the signature of a retry-sustained metastable state; un-jittered retries arrive in waves that keep the DB saturated. Cold caches recover in minutes and would not show retry amplification. Growing client pools increases concurrency on an already saturated DB.',
      followUps: [
        {
          "q": "You add jitter and a retry budget, but the DB is still at 100% right now and the incident is live. What do you do in the next five minutes?",
          "a": "Break the feedback loop by removing load, since the system will not self-heal. Options in order of speed: flip a feature flag or config to set retries to 0 fleet-wide; shed at the edge (rate-limit to ~70% of DB capacity, return 503 + Retry-After); temporarily scale the API down or block non-critical endpoints. Once the DB drops below ~70% CPU and queues drain, ramp traffic back in steps (25% → 50% → 100%) while watching p99 and connection count. Kill long-running queries that queued during the storm (`pg_cancel_backend`) to free capacity faster."
        },
        {
          "q": "How would you prove in a postmortem that retries — not user traffic — kept the DB pegged for 20 minutes?",
          "a": "Compare three series on one graph: user-facing requests at the edge (flat), requests arriving at the API layer (including retries), and DB queries per second. If DB QPS ÷ edge RPS rises from ~1× to 3–4× after the outage, that ratio is retry amplification. Retry counters (`client_retries_total` by attempt number) or an `x-retry-attempt` header in access logs make it explicit. A histogram of arrival times showing spikes at 100ms, 200ms, 400ms after each failure wave proves the synchronization caused by un-jittered backoff."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-07',
      difficulty: 'hard',
      question:
        'Given this probe configuration, what is the most likely outcome of a 45-second Postgres primary failover?',
      code: {
        language: 'yaml',
        code: `livenessProbe:
  exec:
    command: ['sh', '-c', 'psql "$DATABASE_URL" -c "select 1"']
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3`,
      },
      options: [
        'All pods are restarted around the same time, then come back cold and stampede the new primary',
        'Nothing — probe failures are ignored while the pod serves traffic',
        'Pods are marked unready and removed from the Service, then re-added when the DB recovers',
        'Only pods on the failed DB node\'s AZ are restarted',
      ],
      correct: [0],
      explanation:
        'Liveness failure triggers container restart, and since every pod depends on the same DB, all fail ~30s into the outage and restart together — causing cold caches and a reconnect storm. Removal from endpoints is readiness behaviour; probe failures are not ignored; the DB is shared so AZ doesn\'t limit it.',
      followUps: [
        {
          "q": "You move the DB check from liveness to readiness. During the next 45 s failover every pod goes NotReady at once. What do users see now, and is that better?",
          "a": "The Service has zero ready endpoints, so the ingress returns 503 immediately for every route — including ones that don't need the DB (static config, health, cached reads). It's better than a restart storm (no cold start, recovery is instant when the DB returns), but still a total outage. The improvement is to make readiness depend only on local state and let request handlers degrade: DB-backed routes fail fast with 503 via a breaker, cache-backed routes keep serving. Shared-dependency checks in readiness turn one dependency blip into a fleet-wide removal."
        },
        {
          "q": "What liveness probe configuration would you actually ship for this Node API, with numbers?",
          "a": "Liveness checks only that the process can serve: an HTTP handler that returns 200 without I/O, ideally also failing if event-loop lag exceeds, say, 5s (a truly wedged process). Settings: `periodSeconds: 10`, `timeoutSeconds: 2`, `failureThreshold: 6` → a restart only after ~60s of a genuinely stuck process, longer than any normal GC pause or failover. Add a `startupProbe` (e.g. 30 × 2s) so slow boots aren't killed. Readiness: `periodSeconds: 5`, `failureThreshold: 2`, checking warm-up and draining state, not the DB."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-08',
      difficulty: 'expert',
      question:
        'Your API runs 50 pods, each opening a pg.Pool with max 8 against a Postgres allowing 500 connections. A downstream HTTP call is made while holding a DB transaction. The downstream slows to 5s. Select ALL outcomes you should expect.',
      options: [
        'Pool connections are held for the full 5s, so pool acquisition waits spike even for queries unrelated to the downstream',
        'Postgres hits max_connections because pools grow beyond max under pressure',
        'Row locks taken in those transactions are held for 5s, increasing lock waits for other writers',
        'Idle-in-transaction sessions accumulate on the DB side',
        'Postgres automatically aborts the transactions after 1s by default',
      ],
      correct: [0, 2, 3],
      explanation:
        'Holding a transaction across a remote call pins the connection and its locks for the call\'s duration and shows as idle-in-transaction in Postgres. pg.Pool never grows past max, and 50 × 8 = 400 < 500, so max_connections is not the failure — waiting for a free pooled connection is. Postgres has no default transaction timeout; idle_in_transaction_session_timeout defaults to 0 (disabled).',
      followUps: [
        {
          "q": "Refactor the handler: the downstream call's result must be written in the same transaction as an order row. How do you keep consistency without holding the transaction across the 5 s call?",
          "a": "Split it into two short transactions with an explicit state machine. Tx1: insert the order as `PENDING` and commit (milliseconds). Then make the remote call outside any transaction, with an idempotency key equal to the order id. Tx2: update the order to `CONFIRMED` with the result, using a conditional `WHERE status = 'PENDING'`. If the process dies between steps, a reconciler sweeps `PENDING` orders older than N seconds and retries the call with the same key. Alternatively write an outbox row in Tx1 and let a worker do the call. Connections are held for ms instead of 5s."
        },
        {
          "q": "As a database-side safety net, which Postgres settings would you set so a future regression like this can't pin connections indefinitely?",
          "a": "Set `idle_in_transaction_session_timeout` (e.g. 10s) so sessions sitting idle inside a transaction are terminated and their locks released; `statement_timeout` per role (e.g. 5s for the API role) to stop runaway queries; and `lock_timeout` (e.g. 2s) so writers fail fast instead of queueing behind a held row lock. Postgres 17 also adds `transaction_timeout`. Monitor `pg_stat_activity` for `state = 'idle in transaction'` count and age and alert when it exceeds a handful. These protect the DB, but the client still needs a pool acquire timeout."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-09',
      difficulty: 'hard',
      question:
        'Hedged requests are configured to fire after 5ms for a service whose p50 is 8ms and p95 is 30ms. What is the main problem?',
      options: [
        'Hedges will always go to the same replica due to connection reuse',
        'Hedged requests must be sent at the same time as the primary to be effective',
        'Hedging is only valid for write requests with idempotency keys',
        'Hedging after 5ms duplicates more than half of all requests, nearly doubling backend load',
      ],
      correct: [3],
      explanation:
        'Since p50 is 8ms, more than 50% of requests are still pending at 5ms, so over half are duplicated — close to 2× load, which can itself create the latency you are trying to avoid. The usual trigger is around p95 (≈5% extra). Simultaneous sending is a different technique (tied requests); hedging is for idempotent reads; replica selection is configurable.',
      followUps: [
        {
          "q": "You move the hedge trigger to p95 (30 ms). Six months later the service's p95 drifts to 90 ms but the config still says 30 ms. What happens, and how do you prevent it?",
          "a": "A static 30ms threshold is now around the p70 of the new distribution, so ~30% of requests are hedged, adding ~30% load to a service that is already slower — possibly the reason it got slower. Make the threshold adaptive: compute the running p95 per backend from a sliding histogram (e.g. HdrHistogram over the last 1–5 min) and hedge at that value. Also add a hedge budget (e.g. at most 5% of requests per second) so even a wrong threshold can't exceed bounded extra load. Export `hedges_sent / requests` and alert above ~7%."
        },
        {
          "q": "The hedge is sent; the primary then returns first. What must the client do with the hedge, and what does the server need to support it?",
          "a": "Cancel the loser immediately: abort the fetch (AbortController) so the socket is freed, and ideally propagate the cancellation (HTTP/2 RST_STREAM, gRPC cancellation) so the server stops work. The server must check cancellation — e.g. Go's `ctx.Done()`, or in Node the `req.on('close')` / `signal.aborted` checks before expensive steps — otherwise the hedge consumes full backend capacity anyway. Without server-side cancellation, a 5% hedge rate truly costs 5%; with it, cancelled hedges often cost much less because many are killed in the queue before execution."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-10',
      difficulty: 'expert',
      question:
        'Which bulkhead behaviours below are correct design choices for protecting a service from a slow optional dependency? Select ALL that apply.',
      options: [
        'Size the dependency\'s concurrency limit from its healthy latency × traffic, plus headroom',
        'Use an unbounded wait queue so no request is ever rejected',
        'Reject immediately (or after a short max wait) when full and serve a fallback',
        'Share the bulkhead across all dependencies to maximise utilisation',
        'Emit metrics for rejections so you can tell bulkhead saturation from dependency errors',
      ],
      correct: [0, 2, 4],
      explanation:
        'Bulkheads are sized from healthy concurrency (Little\'s Law) with headroom, must reject quickly with a fallback, and need rejection metrics. An unbounded queue just moves the pile-up into memory and latency; a shared bulkhead is exactly the shared resource that causes cascading failure.',
      followUps: [
        {
          "q": "The optional dependency serves 300 RPS per pod with healthy p99 of 50 ms. Size the bulkhead, and say what fraction of calls get rejected if it degrades to 1 s.",
          "a": "Healthy concurrency by Little's Law: 300 × 0.05 = 15 in-flight. With ~2× headroom, a bulkhead of 30. When latency becomes 1s, the bulkhead can only complete 30 / 1s = 30 RPS, so 270 of 300 RPS (90%) are rejected instantly and served the fallback. That's the intended outcome: 90% of users see a degraded widget in microseconds instead of 100% waiting a second, and the pod's other dependencies keep their sockets. A 1s → 300ms timeout would raise admitted throughput to 100 RPS (67% rejected)."
        },
        {
          "q": "Your service runs on Node's single event loop. Is a bulkhead still meaningful when there are no threads to isolate?",
          "a": "Yes — the scarce resources are sockets, memory for pending promises, and downstream concurrency, not threads. Without a cap, a slow dependency accumulates thousands of pending promises, each holding request buffers and closures; heap grows, GC pauses lengthen, and every route slows. A semaphore (e.g. `p-limit` or a counter) per dependency plus a dedicated `http.Agent` with `maxSockets` bounds both. Java's thread-pool bulkhead (Hystrix style) isolates thread time; in Node the equivalent is a concurrency limiter that rejects when full."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-11',
      difficulty: 'medium',
      question:
        'During a traffic spike, a service rejects excess requests with 503 + Retry-After at its ingress, before authentication. A colleague argues it should authenticate first "to only shed anonymous traffic". What is the best response?',
      options: [
        'Agree — shedding authenticated users is never acceptable',
        'Disagree — shedding must be cheap; use a criticality/priority signal the edge can read without expensive work, and do auth only for admitted requests',
        'Agree — auth is cheap because JWT verification is always sub-microsecond',
        'Disagree — load shedding should happen only in the database layer',
      ],
      correct: [1],
      explanation:
        'Load shedding works only if rejection costs far less than serving; putting auth (possibly a remote call or crypto) before the decision burns capacity under overload. Priority can be carried in a cheap header/route classification. JWT verification is not free at scale (RSA verification ~tens of µs plus key fetch), and DB-layer shedding is far too late.',
      followUps: [
        {
          "q": "The edge sheds by a priority header that clients set. What stops a misbehaving client from sending `priority: critical` on everything?",
          "a": "Don't trust the client for priority — derive it at the edge from cheap, server-controlled signals: the route (`/checkout/*` = critical, `/recommendations` = sheddable), the API key or client id mapped in a local table, or a signed token claim already verified for admitted traffic. If clients may set priority, cap it per tenant: each tenant gets a quota of critical requests, and anything above is downgraded. Internally, services propagate a criticality header that only the gateway may set; sidecars strip it from external traffic."
        },
        {
          "q": "Shedding returns 503 + Retry-After: 2. 100,000 mobile clients all honour it exactly. What happens at T+2 s?",
          "a": "They all come back at once — Retry-After becomes a synchronization point and recreates the spike. Return a randomized Retry-After (e.g. 1–5s spread per response) and have the client SDK add its own jitter on top. Also tie the shed rate to measured capacity (e.g. CoDel/queue-delay or CPU target) rather than a fixed threshold, so as the herd returns the edge sheds proportionally and admits only what fits. Mobile clients should also back off exponentially on repeated 503s, not just honour the single header."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-12',
      difficulty: 'hard',
      question: 'What does this code do when the primary request fails quickly (in 2ms) and hedging is configured at 50ms?',
      code: {
        language: 'typescript',
        code: `const primary = fetchJson(replicaA);
const hedge = new Promise((resolve, reject) => {
  const t = setTimeout(() => fetchJson(replicaB).then(resolve, reject), 50);
  primary.finally(() => clearTimeout(t)).catch(() => {});
});
return Promise.any([primary, hedge]);`,
      },
      options: [
        'Rejects after 2ms with the primary\'s error',
        'Resolves with the hedge\'s result after about 50ms',
        'Throws synchronously because Promise.any requires resolved promises',
        'Hangs forever: primary rejected, the timer was cleared, and the hedge promise never settles',
      ],
      correct: [3],
      explanation:
        'Promise.any settles when one input fulfils or all reject. The primary rejects, its finally clears the timer, so the hedge promise is never resolved nor rejected — Promise.any waits forever (a leaked request/handler). The fix is to reject (or fire) the hedge when the primary settles before the timer.',
      followUps: [
        {
          "q": "Write the corrected control flow in words: what should happen to the hedge in each of the three cases — primary succeeds first, primary fails before the timer, primary fails after the hedge fired?",
          "a": "(1) Primary succeeds before the timer: clear the timer, never send the hedge, resolve. If the hedge is already in flight, abort it. (2) Primary fails before the timer: fire the hedge immediately (it acts as a fast retry, subject to the retry budget) or reject the hedge promise so `Promise.any` rejects with an `AggregateError`. Never leave a promise that can't settle. (3) Primary fails after the hedge fired: wait for the hedge; if it succeeds resolve, otherwise reject with both errors. In all cases an overall deadline should reject the outer promise."
        },
        {
          "q": "How would you catch this \"promise never settles\" class of bug in CI rather than in production?",
          "a": "Add a test where the primary stub rejects in 2ms and assert the call settles within, say, 100ms using fake timers (`vi.advanceTimersByTimeAsync(200)` then check the promise state). More generally, wrap every outbound helper in a test harness that fails if a returned promise is still pending after the configured deadline. In production, a gauge of in-flight hedged calls that only grows, or pending-request count rising without traffic increase, is the symptom; Node's `--trace-uncaught` won't help because nothing throws."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-13',
      difficulty: 'expert',
      question:
        'A gateway has a 1s timeout, service A a 1s timeout to B, and B a 1s timeout to C, with no deadline propagation. C becomes slow (3s). Select ALL that apply.',
      options: [
        'Users receive 504s after ~1s',
        'A and B keep working on requests after the user has already received an error',
        'Setting all timeouts to 3s would fix the user-facing errors without side effects',
        'Propagating a deadline lets B skip calling C when the remaining budget is already exhausted',
      ],
      correct: [0, 1, 3],
      explanation:
        'The gateway gives up at 1s, but A and B each wait up to their own 1s timers without knowing the user is gone — wasted work that adds load. A propagated deadline lets downstream hops fail fast. Raising timeouts to 3s increases in-flight concurrency 3× and violates the SLA — a clear side effect.',
      followUps: [
        {
          "q": "Implement deadline propagation over HTTP between gateway → A → B → C. What is sent, and how does each hop use it, including clock skew?",
          "a": "The gateway sets an absolute or relative deadline header, e.g. `x-request-timeout-ms: 950` (relative avoids clock skew; gRPC uses `grpc-timeout`). Each hop records arrival time, computes `remaining = header − elapsed − safety margin (≈10–20ms)`, uses `AbortSignal.timeout(remaining)` for its downstream call, and forwards the new remaining value. If remaining ≤ the minimum useful time (say C's p50), it fails fast with 504 without calling. Absolute timestamps need synchronized clocks; relative budgets only accumulate network transit time, which the margin absorbs."
        },
        {
          "q": "Even with deadlines, B sometimes finishes writing to C after A has given up. Which operations make that harmful, and what protects you?",
          "a": "Reads are harmless (wasted work only), but writes cause \"did it happen?\" ambiguity: A returns an error, the user retries, and C applies the write twice. Protect writes with idempotency keys generated at the edge and passed through every hop, so a retried write returns the stored result. For multi-step writes, use a state machine/outbox so a half-finished operation is reconciled rather than duplicated. Deadlines reduce orphaned work but can never eliminate it, because cancellation races the commit."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-14',
      difficulty: 'hard',
      question:
        'Which pairing of "failure mode → primary defence" is most accurate?',
      options: [
        'Downstream slow → tight timeouts + bulkhead; downstream erroring fast → circuit breaker + fallback',
        'Downstream erroring fast → larger timeouts; downstream slow → more retries',
        'Downstream slow → circuit breaker counting 5xx only; downstream erroring → hedged requests',
        'Both cases → increase connection pool size so more requests get through',
      ],
      correct: [0],
      explanation:
        'Slowness is dangerous because it pins resources, so you bound time and concurrency; fast errors are cheap per request, so you stop calling (breaker) and serve alternatives. Retries on slowness add load; a 5xx-only breaker misses slowness; hedging duplicates failing calls; bigger pools only increase concurrency against a struggling dependency.',
      followUps: [
        {
          "q": "A dependency fails in a mixed way: 30% of calls time out at 2 s and the rest succeed in 20 ms. Which defences apply, and in what order do they act on a single request?",
          "a": "Both sets apply. Order on a request: (1) the bulkhead check — reject immediately if the dependency's concurrency slot pool is full; (2) breaker state — if OPEN, go straight to fallback; (3) the call with a tight per-attempt timeout (e.g. 200ms from healthy p99), converting the 2s hangs into fast failures that the breaker counts; (4) at most one retry within the remaining deadline and retry budget, since 70% success means a retry likely succeeds; (5) fallback on final failure. With a 30% failure rate and a 50% threshold the breaker stays closed, which is correct — retries plus timeouts handle it."
        },
        {
          "q": "How would you verify in a game day that each defence actually engages for each failure mode?",
          "a": "Use fault injection per mode: Envoy fault filter or Toxiproxy to add 3s latency to 100% of calls (expect timeouts → breaker opens → fallback, socket count capped at the bulkhead size), then return HTTP 500 instantly for 100% (expect breaker opens within the volume threshold, no latency increase). Watch per-dependency dashboards: breaker state, bulkhead rejections, timeout counts, fallback rate, and caller p99 on unrelated endpoints. Success criteria are written beforehand, e.g. \"unrelated endpoints' p99 stays < 1.2× baseline\"."
        }
      ],
    },
    {
      id: 'rel-patterns-mcq-15',
      difficulty: 'medium',
      question:
        'A team adds "fallback: read from the replica DB" when the primary DB-backed profile service call fails. During the next incident the whole region\'s DB cluster is overloaded. What is the likely effect?',
      options: [
        'The fallback succeeds because replicas are always less loaded than primaries',
        'The circuit breaker prevents the fallback from being invoked',
        'The fallback also fails (slowly), doubling the latency and load on the same overloaded infrastructure',
        'The fallback triggers automatic promotion of the replica',
      ],
      correct: [2],
      explanation:
        'A fallback that depends on the same failing infrastructure shares its fate — it adds more load to the struggling cluster and more latency to each request. Good fallbacks are local (stale cache, static defaults). Breakers invoke fallbacks when open rather than preventing them, and reads don\'t trigger promotion.',
      followUps: [
        {
          "q": "Product insists profile data can't be static. What fallback would you design that doesn't share fate with the DB cluster?",
          "a": "Serve last-known-good data from a store that is independent of the DB: an in-process LRU of recently served profiles (hit rate is often 60–80% for active users) backed by a regional Redis/edge cache populated on every successful read with a long TTL (hours) and a `stale-if-error` policy. Mark responses `degraded: true` so the UI can hide editable fields. For users not in cache, return a minimal profile from the auth token claims (name, id). None of these paths touches the overloaded cluster, so the fallback reduces load instead of adding it."
        },
        {
          "q": "How would you detect, before an incident, that a fallback shares fate with the primary?",
          "a": "Map dependencies explicitly: for every fallback, list its transitive dependencies (DB cluster, network, DNS, auth) and flag overlaps — a simple dependency graph check in design review. Then test it: in a game day, fail the shared component (block the DB cluster's security group) and verify the fallback path still returns within its latency budget. Fallbacks that are never exercised rot, so also run them continuously in production for a small percentage of traffic (e.g. 0.1% served from cache) and alert on fallback error rate."
        }
      ],
    },
  ],
};

export default topic;
