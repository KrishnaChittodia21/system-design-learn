import type { Topic } from '../../types';

const topic: Topic = {
  id: 'rate-limiting',
  phase: 'reliability',
  order: 3,
  title: 'Rate Limiting & Throttling',
  subtitle:
    'Fixed window, sliding log, sliding window counter, token bucket and leaky bucket — implemented, compared and distributed across a fleet, with the headers, placement and fail-open/fail-closed decisions interviewers probe.',
  estimatedMinutes: 85,
  sources: [
    'Alex Xu — System Design Interview Vol 1, Ch 4 Design a Rate Limiter (referenced by Vol 2)',
    'Stripe Engineering — Scaling your API with rate limiters',
    'Cloudflare Blog — How we built rate limiting capable of scaling to millions of domains',
    'IETF draft-ietf-httpapi-ratelimit-headers; RFC 6585 (429); RFC 9110 (Retry-After)',
    'Envoy / lyft ratelimit service documentation',
  ],
  tags: ['rate-limiting', 'token-bucket', 'leaky-bucket', 'sliding-window', 'redis-lua', 'throttling', '429', 'ddos', 'multi-tenant'],
  cheatSheet: [
    'Fixed window: INCR per (key, window) — cheapest, but allows up to 2× the limit around a boundary.',
    'Sliding log: sorted set of timestamps — exact, but memory O(limit) per key; fine for small limits (login attempts), wasteful for 10K/min.',
    'Sliding window counter: curr + prev × (1 − elapsed/window) — two counters, ~exact (Cloudflare measured ~0.003% of requests mis-classified).',
    'Token bucket: capacity B (burst) + refill rate R; state = (tokens, last_ts); lazily refill on each request. Default choice for APIs (AWS, Stripe).',
    'Leaky bucket: requests drain at a constant rate — as a queue it smooths traffic (adds latency); as a meter (GCRA) it is equivalent to a token bucket.',
    'Distributed: do check-and-update atomically (Redis Lua / single command) — GET-then-SET races let N concurrent requests all pass.',
    'Local-only limits (limit ÷ N nodes) drift with uneven load balancing; hybrid = local buckets that lease token batches from a central store.',
    'Respond 429 + Retry-After (seconds); advertise quota via RateLimit/RateLimit-Policy (IETF draft) or X-RateLimit-Limit/Remaining/Reset.',
    'Layer it: edge/WAF (IP, DDoS) → gateway (API key, plan) → service (tenant, cost, business rules). Rate limiting ≠ load shedding.',
    'Limiter down: fail-open (with local fallback) for normal APIs, fail-closed for security-sensitive endpoints (login, OTP, payments abuse).',
  ],
  sections: [
    {
      heading: '1. What rate limiting is for, and what to key it on',
      body: `**Intuition:** a bouncer who lets each guest order at most five drinks an hour — not because the bar is full (that's load shedding), but because that's the house rule for each guest.

**Why:** protect shared capacity from one client (fairness), enforce commercial plans (free tier 100 req/min, pro 10K), stop abuse (scraping, brute force, card testing), and control cost (expensive downstream APIs, LLM tokens, SMS).

**Rate limiting vs neighbours**

| Mechanism | Question it answers | Keyed by |
|---|---|---|
| Rate limit | "Is *this client* over *its* allowed rate?" | user, API key, IP, tenant, endpoint |
| Quota | "Has this client used its monthly allowance?" | account, billing period |
| Load shedding | "Is *the server* over capacity right now?" | none — global server health |
| Concurrency limit | "How many in-flight requests may this client have?" | client, endpoint |

**Choosing the key (dimension)**

- **Per user / API key** — the standard for authenticated APIs; fair and stable.
- **Per IP** — for unauthenticated endpoints and DDoS; beware NAT/CGNAT (thousands of mobile users behind one IP) and IPv6 (limit by /64 prefix, since one host can own billions of addresses).
- **Per tenant** — B2B SaaS: an enterprise tenant with 5,000 users shares one bucket so it can't starve other tenants.
- **Per endpoint / cost** — \`POST /exports\` costs 100 tokens, \`GET /items\` costs 1.
- **Global** — protect a fragile downstream (e.g. "our SMS provider allows 500/s total").

Real systems combine them: request passes only if **every** applicable bucket allows it (per-IP ∧ per-key ∧ per-tenant ∧ global).

**Never trust the client-supplied key blindly:** \`X-Forwarded-For\` can be forged; take the IP from the trusted proxy hop (the address your edge appended), and derive user/tenant from the verified token, not from a header.`,
      keyPoints: [
        'Rate limit = per-client rule; load shedding = server protection. You need both.',
        'Combine dimensions: IP, API key/user, tenant, endpoint cost, global.',
        'Derive keys from trusted data (edge-appended IP, verified token).',
      ],
      source: 'Stripe Engineering — Scaling your API with rate limiters',
    },
    {
      heading: '2. Fixed window counter',
      body: `**Intuition:** a turnstile counter that resets every minute on the minute.

**Mechanics:** key = \`rl:{client}:{floor(now / window)}\`. \`INCR\` it; on the first increment set a TTL of one window; reject if the counter > limit.

**Pros:** one key, one or two O(1) Redis ops, tiny memory, trivially shardable.

**Cons — the boundary burst:** limit 100/min. A client sends 100 requests at 12:00:59 and 100 at 12:01:00 — both windows allow them: **200 requests in ~1 second**, 2× the intended rate. Also, all clients' windows reset at the same instant, which can synchronise bursts.

**The classic bug:** running \`INCR\` and \`EXPIRE\` as two separate calls. If the process dies (or the call times out) between them, the key never expires and the client is blocked forever (or counts accumulate across windows). Use a Lua script, \`MULTI\`, or \`SET key 0 EX 60 NX\` followed by \`INCR\`.

**When it's fine:** coarse limits where a 2× burst is harmless (daily quotas, abuse thresholds), or as a very cheap first layer.`,
      code: [
        {
          language: 'lua',
          title: 'Atomic fixed window (EVAL with KEYS[1] = rl:{client}:{window})',
          code: `-- ARGV[1] = limit, ARGV[2] = window_ms
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  -- first hit in this window: set TTL atomically with the increment
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
local ttl = redis.call('PTTL', KEYS[1])
if count > tonumber(ARGV[1]) then
  return {0, 0, ttl}                       -- rejected, remaining 0, retry after ttl ms
end
return {1, tonumber(ARGV[1]) - count, ttl} -- allowed, remaining, reset in ttl ms`,
        },
      ],
      keyPoints: [
        'Cheapest algorithm; one counter per window.',
        'Boundary burst can reach 2× the limit.',
        'INCR + EXPIRE must be atomic or keys can live forever.',
      ],
    },
    {
      heading: '3. Sliding window log',
      body: `**Intuition:** keep a diary of every visit; on each new visit, cross out entries older than one window and count what's left.

**Mechanics (Redis sorted set):** member = unique request ID, score = timestamp.
1. \`ZREMRANGEBYSCORE key 0 (now − window)\` — drop old entries.
2. \`ZCARD key\` — count.
3. If count < limit: \`ZADD key now id\`; set TTL = window.

**Pros:** exact — no boundary effect; precise \`Retry-After\` (oldest entry + window − now).

**Cons:** memory is **O(limit) per key** — at 10,000 req/min allowed per key, each key can hold 10K entries (~ hundreds of KB). With a million keys that's unaffordable. Also each request is O(log n) plus removal work.

**Subtle bugs**
- Using the timestamp as the member: two requests in the same millisecond collapse into one entry and undercount. Use \`now + ':' + random\`.
- Adding rejected requests to the log (some implementations do deliberately, to punish hammering clients — then a client that keeps retrying is locked out until it stops completely). Decide consciously.

**Good fit:** small limits where exactness matters — login attempts (5 per 15 min), OTP sends, password resets.`,
      code: [
        {
          language: 'lua',
          title: 'Sliding log in one atomic script',
          code: `-- KEYS[1] = rl:log:{client}; ARGV: window_ms, limit, request_id
local t = redis.call('TIME')                        -- use Redis clock: no app clock skew
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], now, now .. ':' .. ARGV[3])   -- unique member per request
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local retry = tonumber(oldest[2]) + window - now          -- ms until a slot frees up
return {0, 0, retry}`,
        },
      ],
      keyPoints: [
        'Exact, precise Retry-After.',
        'Memory O(limit) per key — only for small limits.',
        'Members must be unique; decide whether rejected hits are logged.',
      ],
    },
    {
      heading: '4. Sliding window counter (weighted)',
      body: `**Intuition:** you only remember how many visits happened last minute and this minute so far, and you estimate the last 60 seconds by assuming last minute's visits were spread evenly.

**Formula:** with window W, current window count C, previous window count P, and elapsed fraction e of the current window:

\`estimated = C + P × (1 − e)\`

Example: limit 100/min, P = 80, C = 30, 15s into the current minute (e = 0.25) → 30 + 80 × 0.75 = **90** → allowed.

**Pros:** two counters per key (same memory as fixed window), smooths the boundary burst, very cheap. Cloudflare reported that across 400M requests only **0.003%** were wrongly allowed or rate-limited versus an exact log — and the error tends to be small in magnitude.

**Cons:** approximate; assumes uniform distribution in the previous window (a burst at the end of the previous window is underweighted as the window slides).

**This is the default "sliding window" in most production gateways** (e.g. Cloudflare, Kong's sliding strategy, many Redis-based libraries).`,
      code: [
        {
          language: 'lua',
          title: 'Sliding window counter — two keys, one script',
          code: `-- KEYS[1] = rl:{client}  (hash tag keeps both windows on one Cluster slot)
-- ARGV: limit, window_ms
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local curStart = now - (now % window)
local curKey = KEYS[1] .. ':' .. curStart
local prevKey = KEYS[1] .. ':' .. (curStart - window)

local cur = tonumber(redis.call('GET', curKey) or '0')
local prev = tonumber(redis.call('GET', prevKey) or '0')
local elapsed = (now - curStart) / window
local estimated = cur + prev * (1 - elapsed)

if estimated + 1 > limit then
  return {0, 0}
end
redis.call('INCR', curKey)
redis.call('PEXPIRE', curKey, window * 2)   -- must survive to act as "previous"
return {1, math.floor(limit - estimated - 1)}`,
        },
      ],
      keyPoints: [
        'estimated = current + previous × (1 − elapsed fraction).',
        'Two counters per key, ~0.003% error at Cloudflare scale.',
        'Keys need a TTL of 2 windows. Deriving key names inside a script works on standalone Redis; for Redis Cluster, compute both keys client-side and pass them as KEYS (same hash tag).',
      ],
      source: 'Cloudflare Blog — How we built rate limiting capable of scaling to millions of domains',
    },
    {
      heading: '5. Token bucket (with Redis Lua)',
      body: `**Intuition:** a jar that holds at most B tokens, refilled at R tokens per second. Each request takes a token (or several, for expensive calls). Empty jar → wait or get rejected. A full jar allows a burst of B at once.

**Two parameters, two different promises**
- **R (refill rate)** — the long-term sustained rate (e.g. 100 req/s).
- **B (capacity / burst)** — how much short-term burst you tolerate (e.g. 200). Setting B = R allows one second's worth of burst.

**Lazy refill:** you don't need a timer per bucket. Store \`(tokens, last_refill_ts)\`; on each request compute \`tokens = min(B, tokens + (now − last) × R)\`, then try to subtract the cost.

**Pros:** O(1) memory (two fields), allows controlled bursts (good for real clients that are bursty), supports **weighted costs**, and gives an exact \`Retry-After = (cost − tokens) / R\`. Used by AWS API Gateway (rate + burst), Stripe, and most cloud provider APIs.

**Cons:** two parameters to tune; a full bucket lets an idle client burst B immediately (which is usually intended).

**Implementation notes**
- Do the read-modify-write **atomically in Redis Lua** — scripts run single-threaded.
- Use Redis' \`TIME\` (allowed in scripts since Redis 5 with effect replication, the default in 7) so app-server clock skew doesn't mint tokens.
- Redis converts Lua numbers to integers in replies — floor/format explicitly.
- In Redis Cluster, all keys touched by a script must be in the same slot (hash tags \`{tenant-42}\`).`,
      code: [
        {
          language: 'lua',
          title: 'token_bucket.lua — atomic refill + consume',
          code: `-- KEYS[1] = tb:{client}
-- ARGV[1] = capacity (B), ARGV[2] = refill tokens per second (R), ARGV[3] = cost
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000) -- ms

local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity       -- new client starts full
local ts = tonumber(state[2]) or now

-- lazy refill for the time elapsed since last request
tokens = math.min(capacity, tokens + (math.max(0, now - ts) / 1000) * rate)

local allowed, retryMs = 0, 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryMs = math.ceil((cost - tokens) / rate * 1000)
end

redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', now)
-- expire idle buckets once they would be full again anyway
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) + 1000)
return {allowed, math.floor(tokens), retryMs}`,
        },
        {
          language: 'typescript',
          title: 'Calling it from Node (ioredis defineCommand → EVALSHA)',
          code: `import Redis from 'ioredis';
import { readFileSync } from 'node:fs';

const redis = new Redis({ host: 'ratelimit-redis', commandTimeout: 20, maxRetriesPerRequest: 0,
  enableOfflineQueue: false });

redis.defineCommand('tokenBucket', { numberOfKeys: 1, lua: readFileSync('token_bucket.lua', 'utf8') });

declare module 'ioredis' {
  interface RedisCommander<Context> {
    tokenBucket(key: string, capacity: number, rate: number, cost: number): Result<[number, number, number], Context>;
  }
}

export async function take(clientId: string, capacity: number, ratePerSec: number, cost = 1) {
  // {..} hash tag keeps any future per-client keys on the same Cluster slot
  const [allowed, remaining, retryMs] = await redis.tokenBucket('tb:{' + clientId + '}', capacity, ratePerSec, cost);
  return { allowed: allowed === 1, remaining, retryAfterSec: Math.ceil(retryMs / 1000) };
}`,
        },
      ],
      keyPoints: [
        'R = sustained rate, B = burst; lazy refill from (tokens, ts).',
        'Weighted cost per request; exact Retry-After.',
        'Atomic Lua, Redis TIME, integer replies, hash tags in Cluster.',
      ],
      source: 'Stripe Engineering — Scaling your API with rate limiters',
    },
    {
      heading: '6. Leaky bucket (queue and meter) and GCRA',
      body: `**Intuition:** a bucket with a small hole at the bottom. Water (requests) pours in at any rate, but leaks out at a constant rate. If it overflows, the excess spills (is rejected).

**Two variants people confuse**

1. **Leaky bucket as a queue** — requests are enqueued (bounded size) and a worker processes them at a fixed rate. Output is perfectly smooth. Used to protect a downstream with a hard rate (e.g. a partner API allowing 50 req/s, SMS provider). Cost: **added latency** (queue wait) and state in the queue; not great for interactive APIs.
2. **Leaky bucket as a meter** — no queue; just decide conform/non-conform. Mathematically equivalent to a token bucket with the same rate and capacity. The elegant implementation is **GCRA** (Generic Cell Rate Algorithm, from ATM networks): store a single value, the **theoretical arrival time (TAT)**. A request at time t is allowed if \`t ≥ TAT − burst_tolerance\`; then \`TAT = max(TAT, t) + emission_interval\`. One number per key, O(1). Used by \`redis-cell\` (\`CL.THROTTLE\`) and several gateways.

**Token bucket vs leaky bucket (queue)**

| | Token bucket | Leaky bucket (queue) |
|---|---|---|
| Output | Bursty up to B | Constant rate |
| Latency | None — immediate allow/deny | Queueing delay |
| Best for | API clients, user-facing limits | Protecting rate-fixed downstreams, traffic shaping |`,
      code: [
        {
          language: 'typescript',
          title: 'Leaky bucket as a bounded queue, draining at a fixed rate (outbound to a partner API)',
          code: `export class LeakyBucketQueue<T> {
  private queue: Array<{ job: () => Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }> = [];

  constructor(private ratePerSec: number, private maxQueue: number) {
    const intervalMs = 1000 / ratePerSec;          // e.g. 50/s -> one job every 20ms
    setInterval(() => this.leak(), intervalMs).unref();
  }

  submit(job: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new Error('bucket overflow')); // excess spills: caller gets 429/503
    }
    return new Promise<T>((resolve, reject) => this.queue.push({ job, resolve, reject }));
  }

  private leak() {
    const item = this.queue.shift();                // exactly one job per tick: constant output
    if (!item) return;
    item.job().then(item.resolve, item.reject);
  }
}

// Partner allows 50 req/s; tolerate at most 2s of queueing (100 jobs) before shedding.
export const partnerQueue = new LeakyBucketQueue<unknown>(50, 100);`,
        },
      ],
      keyPoints: [
        'Leaky bucket queue = smooth constant output, costs latency.',
        'Leaky bucket meter ≡ token bucket; GCRA stores a single TAT per key.',
        'Use queues to protect fixed-rate downstreams; token buckets for clients.',
      ],
    },
    {
      heading: '7. Algorithm comparison',
      body: `| Algorithm | State per key | Accuracy | Bursts | Typical use |
|---|---|---|---|---|
| Fixed window | 1 counter | Boundary allows up to 2× | Uncontrolled at boundaries | Daily quotas, cheap coarse limits |
| Sliding log | O(limit) timestamps | Exact | None beyond limit | Login/OTP (small limits) |
| Sliding window counter | 2 counters | ~Exact (approx.) | Smoothed | General API limits at scale |
| Token bucket | tokens + timestamp | Exact for its model | Controlled by B | Public APIs, per-key/tenant plans, weighted costs |
| Leaky bucket (queue) | queue | Exact output rate | Smoothed to constant | Outbound to rate-fixed partners |
| GCRA | 1 timestamp (TAT) | Exact (≡ token bucket) | Controlled by tolerance | High-scale gateways, redis-cell |

**How to choose in an interview**
1. Do legitimate clients burst? → token bucket (or GCRA).
2. Is the limit tiny and exactness important? → sliding log.
3. Huge key cardinality, need cheap and "good enough"? → sliding window counter.
4. Need smooth output to a downstream? → leaky bucket queue.

**Say this:** "I'd use a token bucket per API key — rate from the plan, burst about 2× the per-second rate — implemented as an atomic Lua script in Redis, with a sliding-log limiter for login attempts."`,
      keyPoints: [
        'Token bucket for most APIs; sliding log for small exact limits.',
        'Sliding window counter for huge cardinality at low cost.',
        'Leaky queue to shape outbound traffic.',
      ],
    },
    {
      heading: '8. Distributed rate limiting: centralized vs local, and race conditions',
      body: `**Intuition:** 100 cashiers selling tickets for one concert must share one seat count; if each keeps its own notebook, they oversell.

**Race condition (the #1 interview bug).** Non-atomic check-then-act:
\`count = GET key; if count < limit: SET key count+1\` — 50 concurrent requests all read 99 and all pass. Fixes: a single atomic op (\`INCR\` and compare the returned value), or a **Lua script** for multi-step logic (scripts execute atomically), or \`WATCH/MULTI\` optimistic transactions (retry-heavy under contention — avoid).

**Option A — Centralized store (Redis)**
- Every request makes one round trip (~0.2–1 ms in-region). A Redis shard handles on the order of 100K+ simple ops/s; Lua scripts are somewhat slower (tens of thousands to ~100K/s depending on script size).
- **Hot keys:** one tenant at 50K RPS hits one key → one shard. Mitigate with local pre-aggregation or key splitting (N sub-buckets each with limit/N, pick one at random).
- Exact (up to Redis' own replication — a failover can lose recent increments, usually acceptable).

**Option B — Local only**
- Each of N nodes enforces \`limit / N\` in memory. Zero network cost, no dependency.
- **Breaks with uneven distribution:** sticky sessions, few long-lived HTTP/2 connections, or autoscaling changing N. A client whose traffic lands on 5 of 100 nodes gets only 5% of its limit.

**Option C — Hybrid (local buckets + central sync)**
- **Token leasing:** each node reserves a batch of tokens (e.g. 50) from the central bucket and spends them locally; refills when low. Redis calls drop by the batch factor; over-admission is bounded by batch × nodes.
- **Periodic sync:** nodes count locally and push deltas every 100–500 ms; the central view is slightly stale — allows a small overshoot. Envoy's local rate limit + global rate limit service combination follows this layered idea.

**Multi-region:** usually enforce per region (limit split by traffic share) or accept eventual global counts; a synchronous cross-region counter adds 60–150 ms per request.`,
      code: [
        {
          language: 'typescript',
          title: 'Race condition vs atomic fix',
          code: `// BROKEN: two round trips, concurrent requests all read the same value
export async function allowBroken(redis: import('ioredis').Redis, key: string, limit: number) {
  const count = Number(await redis.get(key)) || 0;
  if (count >= limit) return false;
  await redis.set(key, count + 1, 'EX', 60); // also RESETS the TTL on every request
  return true;
}

// FIXED: INCR is atomic; its return value is this request's position in the window
export async function allowFixedWindow(redis: import('ioredis').Redis, key: string, limit: number) {
  const [[, count]] = (await redis
    .multi()
    .incr(key)
    .expire(key, 60, 'NX')      // Redis 7: set TTL only if none exists
    .exec()) as [[Error | null, number]];
  return count <= limit;
}`,
        },
        {
          language: 'typescript',
          title: 'Hybrid: local spending of token batches leased from the central bucket',
          code: `import { take } from './token-bucket'; // the Lua token bucket from section 5

const BATCH = 50;
const local = new Map<string, { tokens: number; refilling?: Promise<void> }>();

export async function allowHybrid(tenant: string, capacity: number, rate: number): Promise<boolean> {
  const s = local.get(tenant) ?? { tokens: 0 };
  local.set(tenant, s);
  if (s.tokens > 0) { s.tokens--; return true; }      // fast path: no network call

  // Lease a batch (cost = BATCH) from Redis; concurrent callers share one lease request
  s.refilling ??= take(tenant, capacity, rate, BATCH)
    .then((r) => { if (r.allowed) s.tokens += BATCH; })
    .finally(() => { s.refilling = undefined; });
  await s.refilling;
  if (s.tokens > 0) { s.tokens--; return true; }
  return false; // central bucket empty: tenant is over its global limit
}
// Over-admission bound: at most BATCH unused tokens stranded per node per tenant.`,
        },
      ],
      keyPoints: [
        'Check-and-update must be atomic (INCR result, Lua).',
        'Central Redis = exact but a network hop and hot-key risk.',
        'Local-only drifts with uneven LB; hybrid leasing trades small overshoot for far fewer calls.',
      ],
    },
    {
      heading: '9. Response contract: 429, Retry-After and RateLimit headers',
      body: `**Intuition:** a good bouncer doesn't just say "no" — he says "come back in 20 minutes".

**Status code:** **429 Too Many Requests** (RFC 6585) for client-over-limit. Use **503** for server overload/shedding. Don't return 403 (implies permission) or 400.

**Headers**
- \`Retry-After\` (RFC 9110): seconds (\`Retry-After: 30\`) or an HTTP date. Well-behaved clients and SDKs honour it.
- Quota visibility — two families in the wild:
  - Legacy/de facto: \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\` (GitHub uses a Unix epoch for reset; others use seconds-until-reset — document which).
  - IETF \`draft-ietf-httpapi-ratelimit-headers\`: earlier drafts defined \`RateLimit-Limit\`, \`RateLimit-Remaining\`, \`RateLimit-Reset\` (delta seconds); newer drafts consolidate into \`RateLimit-Policy: "default";q=100;w=60\` and \`RateLimit: "default";r=42;t=18\` (quota, window, remaining, seconds to reset). Pick one, document it, be consistent.
- Send quota headers on **successful** responses too, so clients can self-throttle before hitting 429.

**Body:** a problem+json error (\`type\`, \`title\`, \`detail\`, \`retryAfter\`), identifying which limit was hit (per-key vs per-IP vs tenant) — invaluable for support.

**Client side:** exponential backoff with jitter honouring Retry-After; never tight-loop on 429 (which turns a rate limit into a DDoS on your own limiter).

**Security nuance:** for login and anti-abuse limits, you may deliberately *not* reveal remaining counts, and keep the response indistinguishable from a normal failure.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS guard: token bucket per API key with standard headers',
          code: `import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { take } from './token-bucket';

const PLANS: Record<string, { rate: number; burst: number }> = {
  free: { rate: 2, burst: 10 },        // 2 req/s sustained (~120/min), bursts of 10
  pro: { rate: 50, burst: 100 },
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { apiKey?: { id: string; plan: string } }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.apiKey!;                          // set by the auth guard from a verified key
    const plan = PLANS[key.plan] ?? PLANS.free;
    const cost = req.method === 'POST' && req.path.startsWith('/exports') ? 20 : 1;

    const r = await take('key:' + key.id, plan.burst, plan.rate, cost);
    res.setHeader('RateLimit-Policy', '"burst";q=' + plan.burst + ';w=' + Math.ceil(plan.burst / plan.rate));
    res.setHeader('RateLimit', '"burst";r=' + r.remaining + ';t=' + r.retryAfterSec);

    if (!r.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, r.retryAfterSec)));
      throw new HttpException(
        { type: 'https://api.example.com/problems/rate-limited', title: 'Too Many Requests',
          status: 429, detail: 'API key rate limit exceeded', limit: 'api-key' },
        HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}`,
        },
      ],
      keyPoints: [
        '429 for client-over-limit, 503 for server overload.',
        'Always send Retry-After on 429; expose quota headers on successes too.',
        'Say which limit was hit; hide details for security-sensitive limits.',
      ],
    },
    {
      heading: '10. Where to enforce: edge, gateway, service',
      body: `**Intuition:** airport security has layers — the car park barrier, the ticket check, the gate. Each layer stops a different kind of problem, as early and cheaply as possible.

| Layer | What it limits well | Tools | Blind spots |
|---|---|---|---|
| **Edge / CDN / WAF** | IP- and pattern-based floods, L7 DDoS, bots, geo rules; absorbs traffic before your origin | Cloudflare, AWS WAF rate-based rules, Akamai, Fastly | Doesn't know tenants, plans, or business cost |
| **API gateway / mesh** | Per API key / plan, per route, global limits for a backend | Kong, Envoy global rate limit service, AWS API Gateway usage plans, Apigee | Coarse cost model; needs identity extracted early |
| **Service** | Business-aware: per tenant, per resource, cost-weighted, "5 exports/hour per workspace" | Library + Redis (as above) | Traffic already consumed network + auth work |
| **Downstream protection** | Outbound limits to partners/DBs | Leaky bucket queues, concurrency limits | — |

**Principles**
- **Reject as early as possible** where you have enough information to decide.
- **Consistency:** define limits in one config source (policy as code), rendered into edge, gateway and service configs.
- **Internal traffic:** service-to-service calls often need limits too (a batch job hammering the user service) — per-caller identity via mTLS/SPIFFE ID in the mesh.
- **Envoy pattern:** local rate limit filter (token bucket per instance, protects the instance) + global rate limit service (descriptors like \`{tenant, route}\` checked against a Redis-backed service) — two layers with different purposes.`,
      code: [
        {
          language: 'yaml',
          title: 'Envoy global rate limit service (lyft/ratelimit) descriptor config',
          code: `domain: public-api
descriptors:
  # Per API key: default 100 req/s
  - key: api_key
    rate_limit:
      unit: second
      requests_per_unit: 100
    descriptors:
      # Tighter limit for an expensive route under the same key
      - key: route
        value: /v1/exports
        rate_limit:
          unit: minute
          requests_per_unit: 10
  # Per client IP for unauthenticated traffic (login page, signup)
  - key: remote_address
    rate_limit:
      unit: minute
      requests_per_unit: 300
  # Global protection of a fragile backend
  - key: backend
    value: sms-provider
    rate_limit:
      unit: second
      requests_per_unit: 500`,
        },
      ],
      keyPoints: [
        'Edge for IP/volumetric, gateway for key/plan, service for business-aware limits.',
        'Reject as early as you can decide; keep limits in one policy source.',
        'Local per-instance + global limits serve different purposes.',
      ],
    },
    {
      heading: '11. When the limiter itself fails: fail-open vs fail-closed',
      body: `**Intuition:** if the bouncer faints, do you lock the doors (safe but no business) or let everyone in (business continues, some risk)?

**The limiter must never be a bigger outage risk than the abuse it prevents.** A Redis-backed limiter on every request is now a hard dependency in the hot path.

**Decision per limit**

| Limit type | On limiter failure | Why |
|---|---|---|
| General API fairness / plan limits | **Fail-open**, with a local in-memory fallback limiter (e.g. per-pod token bucket at limit / pods × 1.5) | Brief over-admission is cheaper than a full outage |
| Login, OTP/SMS send, password reset, card testing | **Fail-closed** or strict local limit | Security/cost risk of unlimited attempts is high |
| Protecting a fragile downstream (global) | Local conservative limit | Better to under-admit than to kill the downstream |

**Engineering the fallback**
- Tight timeout on the limiter call (5–20 ms); if it's slower than that, treat it as down.
- Circuit breaker around the limiter; don't pay the timeout on every request while Redis is down.
- Local fallback limiter already warm in memory (not created on failure).
- Metrics + alerts: "limiter degraded mode" is an incident, even if users don't notice.
- Deploy the limiter Redis separately from the cache Redis (different failure and eviction characteristics — a cache with \`allkeys-lru\` may evict limiter keys, silently resetting limits).`,
      code: [
        {
          language: 'typescript',
          title: 'Fail-open with local fallback, fail-closed for sensitive routes',
          code: `import CircuitBreaker from 'opossum';
import { take } from './token-bucket';

// Local, per-pod fallback bucket (in-memory, no dependencies)
class LocalBucket {
  private tokens: number; private ts = Date.now();
  constructor(private cap: number, private rate: number) { this.tokens = cap; }
  take(cost = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.cap, this.tokens + ((now - this.ts) / 1000) * this.rate);
    this.ts = now;
    if (this.tokens >= cost) { this.tokens -= cost; return true; }
    return false;
  }
}

const PODS = Number(process.env.EXPECTED_PODS ?? 20);
const fallback = new Map<string, LocalBucket>();
const remote = new CircuitBreaker(take, { timeout: 15, errorThresholdPercentage: 50, volumeThreshold: 50, resetTimeout: 5000 });

export async function allow(key: string, cap: number, rate: number, sensitive: boolean): Promise<boolean> {
  try {
    return (await remote.fire(key, cap, rate, 1)).allowed;
  } catch {
    if (sensitive) return false;                     // fail-closed: login, OTP, password reset
    let b = fallback.get(key);                       // fail-open, but still bounded per pod
    if (!b) { b = new LocalBucket(Math.ceil(cap / PODS) * 2, (rate / PODS) * 1.5); fallback.set(key, b); }
    return b.take();
  }
}`,
        },
      ],
      keyPoints: [
        'Fail-open (with local fallback) for fairness limits; fail-closed for security/cost limits.',
        'Tight timeout + breaker on the limiter call.',
        'Separate limiter Redis from cache Redis (eviction policy!).',
      ],
    },
    {
      heading: '12. Scenario playbook',
      body: `| Scenario | What's happening | Response |
|---|---|---|
| **One customer suddenly sends 10K RPS** (plan 1K) | Integration bug (retry loop) or real growth | Per-key token bucket rejects 9K RPS cheaply at the gateway with 429 + Retry-After; per-tenant concurrency cap; alert account team; if their client ignores 429s, escalate to edge block for that key; offer higher plan if legitimate |
| **DDoS-like traffic** (millions of IPs, L7) | Volumetric/botnet | App-level limiter cannot absorb this — rely on edge (CDN/WAF, anycast scrubbing), IP reputation, challenges (JS/CAPTCHA), per-/64 IPv6 limits, cache aggressively, shed at gateway; keep origin IPs hidden |
| **Login brute force / credential stuffing** | Many passwords on one account, or one password on many accounts from many IPs | Layered limits: per account (e.g. 5 failures / 15 min, exponential backoff), per IP, per IP+account; sliding log; breached-password checks, CAPTCHA/step-up after N failures, MFA; avoid permanent lockout (it's a DoS on the victim) |
| **Noisy tenant** in multi-tenant SaaS | One tenant's heavy usage raises latency for all | Per-tenant token bucket + per-tenant concurrency limit + weighted fair queuing in workers; move whales to a dedicated cell; cost-based limits for heavy endpoints |
| **Limiter across 100 servers** | Need a shared view | Central Redis with atomic Lua (hash-tagged keys, sharded), or hybrid token leasing to cut Redis calls; local-only limits break with uneven LB |
| **Redis limiter unavailable** | Hot-path dependency failed | Fail-open with warm local fallback for normal APIs, fail-closed for sensitive ones; breaker + 10–20 ms timeout; alert |

**Interview framing for "10K RPS customer":** "The limiter's job is to make the rejection cheap and informative. A rejected request should cost microseconds at the gateway, never reach the service, and tell the client exactly when to retry."`,
      keyPoints: [
        'Make rejections cheap, early and informative.',
        'DDoS is an edge problem; app limiters handle fairness and abuse.',
        'Brute force needs per-account + per-IP + combined limits without permanent lockout.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'rate-limiting-cc-1',
      title: 'The rate limiter that lets bursts through and blocks users forever',
      context:
        'This Express middleware protects a public API (plan: 100 requests/minute per API key) running on 40 pods behind a load balancer. Customers report both that limits "don\'t work" during bursts and that some keys stay blocked for hours. During a Redis failover the entire API returned 500s.',
      task:
        'Rewrite the middleware so the limit holds under concurrency across all pods, keys can never get stuck, clients get correct 429 semantics, the key cannot be spoofed, and a Redis outage does not take the API down.',
      starter: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import type { Request, Response, NextFunction } from 'express';

const redis = new Redis(process.env.REDIS_URL!);

export async function rateLimit(req: Request, res: Response, next: NextFunction) {
  // identify the caller
  const id = (req.headers['x-api-key'] as string) ?? (req.headers['x-forwarded-for'] as string);
  const key = 'rl:' + id;

  const count = Number(await redis.get(key)) || 0;
  if (count >= 100) {
    return res.status(403).send('rate limited');
  }
  await redis.incr(key);
  if (count === 0) await redis.expire(key, 60);
  next();
}`,
      },
      hints: [
        'Fifty concurrent requests all execute GET before any INCR. What do they read?',
        'What happens to the key if the process crashes (or the EXPIRE call times out) right after INCR? What if the API key header is missing and XFF is attacker-controlled?',
        'What status and headers tell a client when to retry? What should happen to requests when Redis is unreachable?',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import type { Request, Response, NextFunction } from 'express';

const redis = new Redis(process.env.REDIS_URL!, {
  commandTimeout: 15, maxRetriesPerRequest: 0, enableOfflineQueue: false,
});
redis.on('error', () => {});

// Token bucket: 100/min sustained, burst 20; atomic in Redis, Redis clock
const LUA = [
  "local cap, rate, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])",
  "local t = redis.call('TIME'); local now = t[1] * 1000 + math.floor(t[2] / 1000)",
  "local s = redis.call('HMGET', KEYS[1], 'tk', 'ts')",
  "local tk = tonumber(s[1]) or cap; local ts = tonumber(s[2]) or now",
  "tk = math.min(cap, tk + (now - ts) / 1000 * rate)",
  "local ok, retry = 0, 0",
  "if tk >= cost then tk = tk - cost; ok = 1 else retry = math.ceil((cost - tk) / rate * 1000) end",
  "redis.call('HSET', KEYS[1], 'tk', tostring(tk), 'ts', now)",
  "redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 1000) + 1000)",
  "return {ok, math.floor(tk), retry}",
].join(' ');

const CAP = 20, RATE = 100 / 60; // tokens, tokens per second
const local = new Map<string, { tk: number; ts: number }>(); // fallback when Redis is down
const PODS = 40;

function localTake(key: string): boolean {
  const now = Date.now();
  const b = local.get(key) ?? { tk: CAP / PODS * 2, ts: now };
  b.tk = Math.min(CAP / PODS * 2, b.tk + ((now - b.ts) / 1000) * (RATE / PODS) * 1.5);
  b.ts = now; local.set(key, b);
  if (b.tk >= 1) { b.tk -= 1; return true; }
  return false;
}

export async function rateLimit(req: Request & { apiKeyId?: string }, res: Response, next: NextFunction) {
  // Identity comes from the auth middleware (verified key), IP from Express' trusted-proxy logic
  const id = req.apiKeyId ? 'key:' + req.apiKeyId : 'ip:' + req.ip; // app.set('trust proxy', 1)
  const key = 'tb:{' + id + '}';
  try {
    const [ok, remaining, retryMs] = (await redis.eval(LUA, 1, key, CAP, RATE, 1)) as number[];
    res.setHeader('RateLimit-Policy', '"default";q=100;w=60');
    res.setHeader('RateLimit', '"default";r=' + remaining + ';t=' + Math.ceil(retryMs / 1000));
    if (ok === 1) return next();
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryMs / 1000))));
    return res.status(429).json({ type: 'about:blank', title: 'Too Many Requests', status: 429 });
  } catch {
    // Fail-open, but bounded: per-pod local bucket (~1.5x the fair share)
    return localTake(key) ? next() : res.status(429).setHeader('Retry-After', '1').end();
  }
}`,
      },
      explanation: `**Bugs fixed:**

1. **Race condition (GET then INCR).** Concurrent requests all read the same count and all pass — bursts of hundreds got through. The Lua script reads, refills, decides and writes atomically inside Redis.
2. **Stuck keys.** \`INCR\` followed by a separate \`EXPIRE\` only when \`count === 0\`: a crash/timeout between them, or two concurrent "first" requests where the one that set the TTL isn't the one that incremented, left keys with **no TTL**, blocking users indefinitely. The script always sets a TTL.
3. **Fixed-window boundary burst.** Replaced with a token bucket (100/min sustained, burst 20) — no 2× boundary effect.
4. **Spoofable identity.** Fallback to \`X-Forwarded-For\` let attackers rotate the header to bypass limits (or put other users' IPs into it). Identity now comes from the verified API key or Express' \`req.ip\` computed from trusted proxy hops.
5. **Wrong status, no guidance.** 403 means "forbidden"; now 429 with \`Retry-After\`, plus quota headers on every response.
6. **Redis outage = API outage.** Default ioredis queued/retried commands; errors bubbled as 500. Now a 15 ms timeout with no offline queue, and **fail-open to a per-pod local bucket** so the API stays up with bounded over-admission.
7. **Clock skew.** Uses Redis \`TIME\` so 40 pods with drifting clocks can't mint tokens.`,
      followUps: [
        {
          "q": "Plans change: free is 100/min, pro 1,000/min, enterprise is custom per key. How do you extend the middleware without a Redis call to look up the plan?",
          "a": "Resolve the plan in the auth step: the verified API key maps to `{ keyId, tenantId, plan, overrides }`, cached in-process with a short TTL (e.g. 60 s) and invalidated via pub/sub on plan change. Pass `CAP` and `RATE` per request into the same Lua script as ARGV, since the script is already parameterised. Include the policy in `RateLimit-Policy` so clients see their actual quota. Changing a plan then never requires a deploy, and a stale cache only means up to 60 s of the old limit."
        },
        {
          "q": "How do you test the fail-open path and prove the local fallback bounds over-admission?",
          "a": "Make the Redis client injectable and add a test client whose `eval` rejects with a timeout. Drive N requests per second for one key through the middleware and assert that accepted ≤ the expected local rate (`RATE / PODS × 1.5` per second plus the initial bucket) and that responses are 429 with `Retry-After` beyond that. Use fake timers so refill is deterministic. Separately, run an integration test with Toxiproxy adding 50 ms latency and assert the 15 ms `commandTimeout` trips and p99 stays under ~20 ms rather than queuing."
        }
      ],
    },
    {
      id: 'rate-limiting-cc-2',
      title: 'Login protection that stops nobody (and locks out the CEO)',
      context:
        'A login endpoint is protected by "max 5 attempts per IP per 15 minutes" and "lock the account permanently after 10 failures". Security found a credential-stuffing campaign from 40,000 residential IPs, 2 attempts each, that went unnoticed; meanwhile an attacker locked the CEO\'s account by deliberately failing 10 times.',
      task:
        'Redesign the limiter to stop distributed credential stuffing and targeted brute force without enabling account-lockout denial of service, and without leaking which accounts exist.',
      starter: {
        language: 'typescript',
        code: `export async function login(ip: string, email: string, password: string) {
  const ipKey = 'login:ip:' + ip;
  const attempts = await redis.incr(ipKey);
  await redis.expire(ipKey, 900);
  if (attempts > 5) throw new HttpError(429, 'Too many attempts from your IP');

  const user = await users.findByEmail(email);
  if (!user) throw new HttpError(404, 'No such user');
  if (user.locked) throw new HttpError(423, 'Account locked');

  if (!(await verifyPassword(user, password))) {
    user.failedCount++;
    if (user.failedCount >= 10) user.locked = true;   // permanent
    await users.save(user);
    throw new HttpError(401, 'Wrong password');
  }
  user.failedCount = 0;
  await users.save(user);
  return issueSession(user);
}`,
      },
      hints: [
        'Credential stuffing spreads attempts across many IPs — which dimension do all those attempts share?',
        'What does a permanent lock give an attacker who knows the victim\'s email? What could slow them down instead?',
        'What do "404 No such user" vs "401 Wrong password" tell an attacker? Should successful logins count against the IP?',
      ],
      solution: {
        language: 'typescript',
        code: `// Sliding-log counters of FAILURES (Lua script from the sliding-log section)
const failures = (key: string, windowMs: number) => redis.eval(SLIDING_COUNT_LUA, 1, key, windowMs) as Promise<number>;
const recordFailure = (key: string, windowMs: number) =>
  redis.eval(SLIDING_ADD_LUA, 1, key, windowMs, crypto.randomUUID());

const GENERIC = new HttpError(401, 'Invalid email or password');

export async function login(ip: string, email: string, password: string, captchaOk: boolean) {
  const acct = 'login:acct:{' + email.toLowerCase() + '}';
  const ipK = 'login:ip:{' + ipPrefix(ip) + '}';          // /64 for IPv6
  const pair = 'login:pair:{' + email.toLowerCase() + '}:' + ipPrefix(ip);

  const [acctFails, ipFails, pairFails] = await Promise.all([
    failures(acct, 3_600_000), failures(ipK, 900_000), failures(pair, 900_000),
  ]);

  // Per IP / per (IP, account): hard limits, attackers from one source get stopped
  if (ipFails >= 50 || pairFails >= 5) throw new HttpError(429, 'Too many attempts, try later');

  // Per account: never permanent lock — require a challenge and add progressive delay
  if (acctFails >= 5 && !captchaOk) throw new HttpError(401, 'Challenge required', { challenge: 'captcha' });
  if (acctFails >= 5) await sleep(Math.min(8000, 250 * 2 ** (acctFails - 5)));

  const user = await users.findByEmail(email);
  // Same work and same answer whether or not the user exists (no enumeration, no timing oracle)
  const ok = await verifyPassword(user ?? DUMMY_USER, password);
  if (!user || !ok) {
    await Promise.all([recordFailure(acct, 3_600_000), recordFailure(ipK, 900_000), recordFailure(pair, 900_000)]);
    if (acctFails + 1 >= 20) await notifyOwnerSuspiciousActivity(email); // + security signal
    throw GENERIC;
  }
  if (await isBreachedPassword(password)) return requirePasswordReset(user);
  return user.mfaEnabled ? startMfa(user) : issueSession(user);
}`,
      },
      explanation: `**What changed:**

- **Per-account limit catches distributed stuffing against one account**, and a **per-IP failure limit with a higher threshold** (50/15 min, IPv6 by /64) plus a **per (IP, account) limit** stops single-source brute force. The 40,000-IP campaign that tries *many different accounts* once each is primarily caught by global anomaly signals (failure-rate spikes, breached-password checks, bot detection at the edge) — rate limits are one layer, not the whole defence.
- **Count failures, not attempts:** legitimate users behind a shared NAT who log in successfully don't burn the IP budget.
- **Sliding log** for these small, security-sensitive limits (exact, precise windows).
- **No permanent lockout.** After 5 account failures the user must pass a CAPTCHA/step-up and faces **exponential delays** capped at 8s. An attacker can't lock the CEO out; they only make their own attempts slower.
- **No user enumeration.** Same 401 message and same password-hash work (\`DUMMY_USER\`) whether or not the account exists; the 404/423 responses leaked valid emails.
- **Defence in depth:** breached-password check, MFA, owner notification on repeated failures.
- **Fail-closed** is appropriate here if the limiter store is down (or fall back to strict local limits) — unlimited login attempts are a security incident.
- Also fixed: \`INCR\` + separate \`EXPIRE\` refreshed the TTL on every attempt (a sliding punishment that never expires for a persistent attacker, and a lockout for honest users on shared IPs).`,
      followUps: [
        {
          "q": "Attackers now aim for lockout DoS a different way: they trigger the CAPTCHA requirement on every executive's account so they have to solve one each login. Is that acceptable, and can you do better?",
          "a": "A CAPTCHA is much milder than a lock, but it's still friction the attacker controls. Improve it by scoping the challenge per device: trusted devices (a signed long-lived device cookie set after a successful MFA login) skip the account-failure challenge, since failures from unknown devices shouldn't affect known ones. Count account failures separately for 'known device' and 'unknown device' and apply the challenge only to the unknown-device bucket. Executives logging in from their usual laptop see nothing."
        },
        {
          "q": "`DUMMY_USER` makes verification take the same time. What other timing or side channels can still reveal whether an email exists?",
          "a": "Several: `findByEmail` may be faster on a miss (index lookup without a row fetch), which is small but measurable over many samples; MFA or breached-password branches run only for real users with correct passwords; and `notifyOwnerSuspiciousActivity` or extra writes only happen for existing accounts if implemented that way. Other endpoints often leak too: signup ('email already registered') and password reset ('we sent you an email' vs 'no such user'). Use identical responses there and send the 'you already have an account' message by email instead of in the response."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'rate-limiting-iq-01',
      difficulty: 'hard',
      question:
        'Design the rate limiting for a public REST API with free, pro and enterprise plans, ~200K RPS peak across 3 regions. Walk me through algorithm, keys, storage, headers and failure behaviour.',
      whatInterviewerLooksFor: [
        'Justified algorithm choice (token bucket with burst) and cost-weighting',
        'Multiple dimensions and layering (edge, gateway, service)',
        'Atomic distributed implementation with Redis and awareness of hot keys',
        'Client contract (429, Retry-After, quota headers)',
        'Failure mode decisions and multi-region handling',
      ],
      modelAnswer: `### Requirements
- Per API key plan limits (free 10 req/s burst 20; pro 200 req/s burst 400; enterprise custom), weighted costs for heavy endpoints, per-IP limits for unauthenticated routes, global protection for fragile backends.
- Added latency < 2 ms p99; limiter must not reduce API availability.

### Algorithm
- **Token bucket** per API key: rate from plan, burst ≈ 2× per-second rate — real clients are bursty. Cost per request (1 for reads, 10–50 for exports/search).
- **Sliding log** for small exact limits (signup, password reset).

### Layering
1. **Edge/WAF:** per-IP floods, bot rules, geo — before traffic reaches origin.
2. **Gateway (Envoy + rate limit service):** per key / per route descriptors — rejection costs microseconds and never touches services.
3. **Service:** business limits (per workspace exports/hour) needing domain data.

### Storage
- **Redis Cluster per region**, Lua script (atomic refill+consume), Redis \`TIME\`, hash-tagged keys. 200K RPS ÷ ~50K scripts/s per shard with headroom → ~6–8 primaries per region if load were in one region (fewer per region when split across 3).
- Hot keys (an enterprise key at 30K RPS): **token leasing** — gateway instances lease 100-token batches, cutting Redis calls ~100×.
- Separate from cache Redis; \`noeviction\` policy.

### Multi-region
- Split each key's limit by region traffic share (e.g. 50/30/20) or enforce per-region limit = global limit with a small documented overshoot. Synchronous global counters would add 60–150 ms.

### Contract
- 429 + \`Retry-After\`, quota headers (\`RateLimit\`/\`RateLimit-Policy\` or \`X-RateLimit-*\`) on all responses, problem+json body naming the limit hit. SDKs implement backoff with jitter.

### Failure behaviour
- 10–20 ms timeout + circuit breaker to Redis; **fail-open** to local per-instance buckets for plan limits; **fail-closed** for auth-related limits; alert on degraded mode.

### Observability
Per-key rejection rates, top offenders, limiter latency, degraded-mode flag; customer-facing usage dashboard.`,
      followUps: [
        {
          q: 'Why not sliding window counter instead of token bucket?',
          a: 'It works and is cheap, but token bucket expresses "sustained rate + allowed burst" directly, supports weighted costs naturally and gives exact Retry-After. Either is defensible; justify with client behaviour.',
        },
        {
          q: 'An enterprise customer wants 50K RPS. Anything special?',
          a: 'Dedicated limits via leasing to avoid a hot Redis key, possibly a dedicated cell/backend capacity, and a concurrency limit in addition to the rate limit.',
        },
      ],
      pitfalls: [
        'A single global counter in one Redis for all regions',
        'Non-atomic GET/SET implementations',
        'Returning 403/500 instead of 429 with Retry-After',
        'No plan for the limiter being down',
      ],
    },
    {
      id: 'rate-limiting-iq-02',
      difficulty: 'hard',
      question:
        'At 3 p.m. one enterprise tenant starts sending 10K RPS against a contract of 1K RPS; latency rises for every other tenant. What happens in a well-designed system, and what do you do now and afterwards?',
      whatInterviewerLooksFor: [
        'Knows that rejection must be cheap and early to protect others',
        'Combines rate limits with concurrency limits and fair queuing',
        'Customer-facing handling (communication, not just blocking)',
        'Long-term isolation (cells, dedicated capacity)',
      ],
      modelAnswer: `### In a well-designed system
- The gateway's per-tenant token bucket admits ~1K RPS (+burst) and rejects ~9K RPS with 429 + Retry-After. A rejection costs microseconds and a Redis call (or none with leasing) — the backend never sees the excess.
- Other tenants shouldn't notice. If they do, something upstream of the limiter is saturated: TLS termination, the gateway itself, the limiter's Redis hot key, or the limiter sits *behind* expensive middleware (auth, body parsing).

### Why others still suffered here (common causes)
- Limit is per API key but the tenant uses 30 keys → per-tenant limit missing.
- Limit enforced in the service after DB-backed auth, so rejected requests still cost a DB lookup.
- Rate is within limits but requests are **expensive** (bulk exports) → need cost-weighted tokens and a per-tenant **concurrency** cap.
- Shared worker queue: the tenant's async jobs flood it → per-tenant fair queuing.

### Now
1. Confirm limiter is rejecting; if the tenant ignores 429s and retries tightly, block at the edge temporarily for their keys/IPs.
2. Contact the customer (often a retry-loop bug in their integration).
3. Protect others: lower that tenant's limit temporarily, add concurrency cap.

### Afterwards
- Per-tenant (not only per-key) buckets, cost-based tokens, concurrency limits, weighted fair queues in async workers.
- Move large tenants into dedicated cells/capacity.
- Tenant usage dashboards and alerts at 80% of contract so account teams talk to them before they hit limits.`,
      followUps: [
        {
          q: 'Their traffic is legitimate and they want to pay for 10K. Can you just raise the limit?',
          a: 'Only after capacity planning: check backend headroom, DB load per request type, and whether they should be moved to a dedicated cell. Raise gradually and monitor.',
        },
        {
          q: 'How do you rate limit by cost if you don\'t know the cost before executing?',
          a: 'Estimate up front (endpoint class, page size, query complexity), then debit the actual cost after completion (post-hoc adjustment), letting the bucket go negative so future requests wait.',
        },
      ],
      pitfalls: [
        'Assuming rate limits alone guarantee isolation',
        'Enforcing limits after expensive work',
        'Only per-key limits in a multi-key tenant',
      ],
    },
    {
      id: 'rate-limiting-iq-03',
      difficulty: 'expert',
      question:
        'You need a per-tenant limit of 1,000 RPS enforced across 100 API servers. Compare the options and tell me which you would build, with numbers.',
      whatInterviewerLooksFor: [
        'Understands local limit ÷ N failure modes',
        'Quantifies central Redis cost and hot-key pressure',
        'Proposes hybrid leasing or sync with bounded error',
        'Mentions atomicity and clock issues',
      ],
      modelAnswer: `### Option 1: local only (10 RPS per server)
- Zero latency, no dependency.
- Fails when traffic isn't evenly spread: HTTP/2 connection reuse and keep-alive often pin a tenant's traffic to a few servers. If the tenant's traffic lands on 5 servers, they get **50 RPS** instead of 1,000. Autoscaling (N changes) also changes the effective limit unless you propagate N.

### Option 2: central Redis on every request
- Exact. Latency +0.3–1 ms per request.
- If total platform traffic is 200K RPS → 200K Lua calls/s → ~4–6 Redis shards with headroom.
- A single tenant at 1K RPS is fine, but a whale at 50K RPS is one hot key on one shard (a single shard handles roughly 50–100K script calls/s) — risky.

### Option 3: hybrid token leasing (my choice)
- Each server leases batches (e.g. 20 tokens) from the tenant's Redis token bucket and spends locally.
- Redis calls: 1,000 RPS ÷ 20 = **50 calls/s per tenant** instead of 1,000 (20× reduction).
- Maximum over-admission: stranded tokens ≤ batch × active servers = 20 × 100 = 2,000 tokens in the worst case — but only servers actually receiving that tenant's traffic lease, and leases can expire (e.g. 1s TTL) to bound it. Adapt batch size to observed per-server rate (small tenants: batch 1–2).
- Keeps working briefly when Redis is down (spend remaining lease, then local fallback).

### Option 4: periodic gossip/sync of counts
- Each server counts locally, pushes deltas every 200 ms, pulls the global total. Error ≈ rate × sync interval × servers skew; simple, used when approximate is fine.

### Correctness details
- Atomic Lua; Redis \`TIME\`; hash tags; separate limiter Redis with \`noeviction\`; fail-open to local limits on Redis failure.`,
      followUps: [
        {
          q: 'How would you make local-only limits work better?',
          a: 'Consistent-hash tenants to a subset of servers at the load balancer (so each tenant\'s limit is split across a known small set), or propagate the live server count to adjust per-server limits.',
        },
        {
          q: 'Does Redis replication affect limiter accuracy?',
          a: 'Async replication can lose recent increments on failover, briefly allowing extra requests — acceptable for rate limits; don\'t use WAIT on the hot path.',
        },
      ],
      pitfalls: [
        'Dividing the limit by N without considering uneven distribution',
        'Ignoring hot keys for whale tenants',
        'Claiming exactness with an eventually consistent design',
      ],
    },
    {
      id: 'rate-limiting-iq-04',
      difficulty: 'medium',
      question:
        'Your Redis-backed rate limiter cluster goes down during peak. Should the API fail open or fail closed? Defend your answer and describe the implementation.',
      whatInterviewerLooksFor: [
        'Answer depends on the limit\'s purpose',
        'Bounded fail-open with local fallback rather than unbounded',
        'Timeout and breaker so the limiter doesn\'t add latency when down',
        'Observability and incident handling',
      ],
      modelAnswer: `### It depends on what the limit protects
- **Fairness / plan enforcement:** fail-**open**. A few minutes of customers exceeding their plan costs little; rejecting all traffic is a self-inflicted outage.
- **Security / abuse:** login, OTP/SMS, password reset, card testing, free-trial signup → fail-**closed** or a strict local limit. Unlimited login attempts or SMS pumping fraud (toll fraud) can cost real money within minutes.
- **Protecting a fragile downstream:** local conservative limit — under-admit rather than kill the downstream.

### Implementation
- Limiter call with a **10–20 ms timeout**, no retries, no offline queue.
- **Circuit breaker** around it so, once Redis is known down, requests skip the call entirely (no added latency).
- **Warm local fallback:** per-instance token buckets using limit ÷ expected instances × ~1.5 (bounded over-admission). Instances know the fleet size from config/service discovery.
- Per-route policy flag: \`onLimiterFailure: open | closed | local\`.

### Operations
- Metric \`ratelimiter_degraded{mode}\` and page on it — the platform is running unprotected.
- Limiter Redis separate from cache Redis; Multi-AZ with replicas; \`noeviction\` so keys aren't silently evicted.
- Test it: chaos experiment that blocks the limiter's Redis.`,
      followUps: [
        {
          q: 'What if the limiter is slow rather than down?',
          a: 'The timeout converts slowness into failure; the breaker opens on timeouts, and the fallback kicks in. Without a tight timeout, a slow limiter adds latency to every request.',
        },
        {
          q: 'Could you avoid the dependency entirely?',
          a: 'Mostly local limiting (Envoy local rate limit) with a periodic global sync; accept approximate limits in exchange for no hot-path network dependency.',
        },
      ],
      pitfalls: [
        'One blanket answer for all limits',
        'Fail-open without any bound',
        'No timeout on the limiter call',
      ],
    },
    {
      id: 'rate-limiting-iq-05',
      difficulty: 'hard',
      question:
        'Security reports a credential-stuffing attack: 2 million login attempts in an hour from 60,000 IPs, each trying different accounts. Your per-IP limit of 20/min never fired. How do you respond and redesign?',
      whatInterviewerLooksFor: [
        'Recognises per-IP limits are insufficient against distributed attacks',
        'Proposes multi-dimensional limits and global anomaly detection',
        'Avoids account-lockout DoS and user enumeration',
        'Includes non-rate-limit defences (MFA, breached passwords, bot detection)',
      ],
      modelAnswer: `### Why per-IP didn't fire
2M attempts ÷ 60K IPs ≈ 33 attempts per IP per hour ≈ 0.55/min — far under 20/min. Residential proxy networks make each IP look like a normal user.

### Immediate response
- Edge: enable bot management / JS challenge on \`/login\`, block known proxy ASNs and bad-reputation IPs, and raise challenge rates when the **global failure rate** spikes (e.g. login failure ratio jumps from 10% to 80%).
- Force CAPTCHA/step-up for logins from new devices; notify affected users; reset passwords for accounts that were successfully logged into during the attack window.

### Redesign: layered limits
- **Per account** failures (sliding log, e.g. 5 per 15 min → challenge + progressive delay; no permanent lock).
- **Per IP / per /64** failures with higher thresholds (shared NATs).
- **Per (IP, account)** tight limit.
- **Global** login-failure-rate circuit: when overall failures exceed a baseline by X×, require challenges for everyone without an existing trusted-device cookie.
- Device fingerprint / trusted-device tokens reduce friction for real users.

### Non-rate-limit defences
- **Breached-password checks** (k-anonymity lookup, e.g. HIBP range API) at login and signup.
- **MFA/passkeys** — stuffing becomes useless.
- Uniform responses and timing (no enumeration).

### Measurement
Login success rate by cohort, challenge solve rates, account-takeover reports; alert on failure-ratio anomalies, not only on per-IP counts.`,
      followUps: [
        {
          q: 'Why not lock accounts after 10 failures?',
          a: 'Attackers can then lock out any known email — a targeted DoS on executives or all users. Use challenges and exponential delays instead, plus owner notification.',
        },
        {
          q: 'Where should the login limiter run?',
          a: 'At the edge for IP/bot signals and in the auth service for per-account logic (it knows the account), backed by a store that fails closed or falls back to strict local limits.',
        },
      ],
      pitfalls: [
        'Only lowering the per-IP limit (hurts NAT users, doesn\'t stop the attack)',
        'Permanent account lockouts',
        'Different error messages for unknown users',
      ],
    },
    {
      id: 'rate-limiting-iq-06',
      difficulty: 'medium',
      question:
        'Marketing launches a campaign and traffic triples, and at the same time you see what looks like a DDoS on the product search endpoint. How does rate limiting fit into your response, and what can\'t it do?',
      whatInterviewerLooksFor: [
        'Separates volumetric DDoS (edge problem) from application-level limits',
        'Distinguishes legitimate spikes from attack traffic',
        'Uses caching and load shedding alongside limits',
        'Knows the limits of IP-based limiting (NAT, IPv6, botnets)',
      ],
      modelAnswer: `### Separate the problems
- **Legitimate spike** (campaign): many distinct users, normal per-user rates, normal request mix → you need capacity, caching and load shedding, not stricter limits.
- **Attack**: skewed signals — unusual user agents/ASNs, no cookies/sessions, identical query patterns, high per-IP or per-/24 rates, cache-busting query strings.

### What rate limiting can do
- Per-IP (and per-/64 for IPv6) limits at the **edge/WAF** stop naive floods before origin.
- Per-session/API-key limits for authenticated traffic.
- Rate-based rules targeting the attacked route with challenges instead of hard blocks (JS challenge/CAPTCHA) to avoid hurting real users.

### What it can't do
- It cannot absorb **volumetric** L3/L4 floods — that's the CDN/scrubbing provider's anycast capacity (Tbps scale).
- It struggles with **large botnets** at low per-IP rates (each IP looks normal) — needs bot detection and fingerprinting.
- Limits on the origin still cost TLS handshakes and connection handling; enforce at the edge.

### Complementary measures
- **Cache search results** at the CDN for popular queries (normalise query strings to prevent cache-busting).
- **Load shedding** with priority: shed anonymous search before checkout.
- Autoscale the search tier; protect the search cluster with a concurrency limit.

### Say this
"Rate limiting is about fairness per client. DDoS defence is about capacity and filtering at the edge. I use both, and I keep the origin hidden behind the CDN so attackers can't bypass it."`,
      followUps: [
        {
          q: 'How do you avoid rate limiting real users behind a carrier NAT?',
          a: 'Use higher per-IP thresholds, prefer session/device or account keys once available, and use challenges rather than blocks for IP-only signals.',
        },
        {
          q: 'Attackers add random query params to bypass the CDN cache. Fix?',
          a: 'Normalise the cache key (allow-list known params, sort them), and rate-limit cache misses per client at the edge.',
        },
      ],
      pitfalls: [
        'Believing an app-level Redis limiter can stop a DDoS',
        'Blocking by IP without considering NAT/IPv6',
        'Tightening limits during a legitimate campaign',
      ],
    },
    {
      id: 'rate-limiting-iq-07',
      difficulty: 'expert',
      question:
        'Compare token bucket, leaky bucket and sliding window counter for three cases: (a) a public API whose clients burst, (b) calling a partner API that bans you above 50 req/s, (c) 50 million anonymous device IDs each limited to 60 events/min. Which would you pick for each, and why?',
      whatInterviewerLooksFor: [
        'Matches algorithm properties to requirements',
        'Knows leaky bucket queue vs meter distinction',
        'Considers memory at scale',
        'Mentions GCRA and burst tolerance',
      ],
      modelAnswer: `### (a) Public API with bursty clients → **token bucket** (or GCRA)
- Rate R = plan sustained rate, capacity B = allowed burst. Mobile apps open and fire 15 requests at once — a strict sliding window would reject legitimate bursts.
- Weighted costs and exact Retry-After come naturally.
- GCRA gives the same semantics with one stored timestamp per key.

### (b) Outbound to a partner with a hard 50 req/s → **leaky bucket as a queue**
- You need a *smooth* output: never exceed 50 in any second, including across your own fleet. A token bucket with burst could send 100 in one instant and get you banned.
- Implement as a single distributed queue or a central "dispatcher" (or per-pod share of 50 with a small safety margin, e.g. 45 total). Queue bounded to a latency budget (e.g. 2s = 100 jobs); overflow → fail fast or defer to async retry.

### (c) 50M device IDs × 60/min → **sliding window counter** (or fixed window)
- Memory: 2 small counters per active key. A sliding log would store up to 60 timestamps per key: 50M × 60 × ~50–100 bytes in a sorted set ≈ 150–300 GB — unaffordable. Counters: 50M × 2 × ~50–80 bytes ≈ 5–8 GB, and only active keys exist due to TTL.
- ~Exact at this granularity; boundary effects smoothed.
- Could also sample or use a count-min sketch at the edge if approximate is acceptable.

### General rule
Bursts allowed → token bucket; smooth output required → leaky queue; massive cardinality → counters; small exact limits → sliding log.`,
      followUps: [
        {
          q: 'Is a leaky bucket meter different from a token bucket?',
          a: 'No — as meters they are equivalent with matching parameters (the "bucket" level of one mirrors the "tokens" of the other). The meaningful difference is leaky bucket as a queue, which shapes traffic.',
        },
        {
          q: 'In (b) you run 30 pods. How do you guarantee ≤ 50 req/s globally?',
          a: 'Either route partner calls through a small dispatcher service with a single queue, or use a central token bucket with capacity ~1 (no burst) in Redis, or give each pod floor(45/30) = 1.5 req/s with GCRA — each has trade-offs in latency and utilisation.',
        },
      ],
      pitfalls: [
        'Using a sliding log for tens of millions of keys',
        'Token bucket with large burst for a strict partner limit',
        'Claiming leaky and token buckets are fundamentally different as meters',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'rate-limiting-boe-1',
      question:
        'Estimate the Redis memory needed to rate-limit 20 million active API users with (a) a token bucket and (b) a sliding log allowing 100 requests per minute.',
      assumptions: [
        'Token bucket: small hash with 2 fields ≈ 100 bytes including key and Redis overhead',
        'Sliding log: sorted-set entry ≈ 60–80 bytes each (member string + score + skiplist/hashtable overhead)',
        'Heavy users fill their log; assume average 40 entries per active key',
      ],
      steps: [
        { label: 'Token bucket memory', calc: '20M × 100 B = 2 GB' },
        { label: 'Sliding log entries', calc: '20M × 40 entries = 800M entries' },
        { label: 'Sliding log memory', calc: '800M × ~70 B ≈ 56 GB (+ per-key overhead ≈ 2 GB)' },
        { label: 'Ratio', calc: '~58 GB ÷ 2 GB ≈ 29× more memory for the log' },
      ],
      answer:
        'Roughly 2 GB for token buckets (fits a single small shard, replicated) versus ~55–60 GB for sliding logs (a multi-shard cluster).',
      insight:
        'Algorithm choice is a memory decision at scale: keep sliding logs for small limits (login attempts), and use token buckets or window counters for high-cardinality API limits.',
      followUps: [
        {
          "q": "Product raises the limit to 1,000 requests/minute and heavy users fill their logs. Redo the sliding-log estimate assuming 400 entries on average.",
          "a": "20M × 400 = 8 billion entries × ~70 B ≈ 560 GB, plus key overhead. That needs dozens of large Redis shards just for rate limiting, about 280× the token-bucket figure, which stays at 2 GB because its size doesn't depend on the limit. This is why sliding logs don't scale with the limit: memory is O(limit) per key. At 1,000/min, use a sliding window counter: two integer keys of ~60 B each, so 20M × 120 B ≈ 2.4 GB."
        },
        {
          "q": "Active users grow 5× to 100M. Which design still fits on a single primary, and what else do you worry about?",
          "a": "Token buckets: 100M × 100 B = 10 GB, which still fits in one primary's memory, but at that scale ops/s becomes the limit before memory (100M users at even one request per 10 s is 10M ops/s), so you shard for throughput anyway. Also: a full resync of a 10 GB replica takes minutes and spikes network, and a fork for RDB snapshots doubles memory pressure under write load. Plan for a cluster with ~10 GB per shard."
        }
      ],
    },
    {
      id: 'rate-limiting-boe-2',
      question:
        'The API serves 400K RPS at peak and every request runs one Lua token-bucket script in Redis. How many Redis primaries do you need, and how does token leasing change it?',
      assumptions: [
        'One Redis primary sustains ~80K small Lua script calls/s; plan for 50% headroom → 40K/s usable',
        'Leasing batch of 25 tokens for large tenants covering 80% of traffic',
        'Remaining 20% of traffic still calls Redis per request',
      ],
      steps: [
        { label: 'Per-request scripts', calc: '400K ÷ 40K usable per shard = 10 primaries (+ replicas = 20 nodes)' },
        { label: 'Leased traffic calls', calc: '0.8 × 400K ÷ 25 = 12.8K calls/s' },
        { label: 'Non-leased traffic calls', calc: '0.2 × 400K = 80K calls/s' },
        { label: 'Total with leasing', calc: '12.8K + 80K ≈ 93K/s → ~3 primaries' },
        { label: 'Latency', calc: 'Leased requests avoid the ~0.5 ms round trip ~96% of the time (24 of 25)' },
      ],
      answer:
        'About 10 primaries (20 nodes with replicas) for per-request checks, dropping to ~3 primaries with leasing for the heavy tenants.',
      insight:
        'Most limiter load comes from a few heavy keys, which are also the hot-key risk. Leasing for heavy keys cuts both cost and hot-shard risk while keeping exact checks for the long tail.',
      followUps: [
        {
          "q": "Traffic doubles to 800K RPS with the same 80/20 split. How many primaries with leasing?",
          "a": "Leased: 0.8 × 800K ÷ 25 = 25,600 calls/s. Non-leased: 0.2 × 800K = 160,000 calls/s. Total ≈ 185,600 calls/s ÷ 40K usable per shard ≈ 4.6, so 5 primaries (10 nodes with replicas). The long tail now dominates: 160K of the 186K calls come from small keys. Bigger lease batches barely help (with batches of 100 at 400K: 3,200 + 80,000 ≈ 83K, still 3 primaries). The next lever is in-process caching of denials, or a cheap local pre-limit for the long tail."
        },
        {
          "q": "A pod crashes holding leased tokens. How much can the tenant over- or under-shoot, and is that acceptable?",
          "a": "Each pod holds at most one batch (25 tokens). If it crashes, those unused tokens are lost, so the tenant is under-served by up to 25 tokens per crash, which is noise against hundreds of RPS. Over-admission is bounded too: at most pods × batch outstanding tokens; with 100 pods that's 2,500 tokens, about 2.5 s of a 1,000 RPS limit in the worst case. Shrink the batch for small tenants, or size it dynamically (e.g. 1–2% of the tenant's per-second rate)."
        }
      ],
    },
    {
      id: 'rate-limiting-boe-3',
      question:
        'A tenant with a 1,000 RPS limit is served by 100 pods, but its traffic arrives over 8 long-lived HTTP/2 connections, each pinned to one pod. What effective limit does it get with pure local limiting, and how would you fix it?',
      assumptions: [
        'Local limit = 1,000 ÷ 100 = 10 RPS per pod per tenant',
        'Each HTTP/2 connection stays pinned to one pod (L4 balancing)',
        'Tenant\'s traffic is spread evenly across its 8 connections',
      ],
      steps: [
        { label: 'Pods receiving tenant traffic', calc: '8 pods (one per connection)' },
        { label: 'Effective limit', calc: '8 pods × 10 RPS = 80 RPS (8% of the contract)' },
        { label: 'Rejection rate at 1,000 RPS offered', calc: '1 − 80/1,000 = 92% of requests get 429' },
        { label: 'Central/leasing fix', calc: 'Central bucket 1,000 RPS; each of 8 pods leases batches of ~10 → ~100 Redis calls/s' },
      ],
      answer:
        'Only ~80 RPS gets through (92% wrongly rejected). A central token bucket with batch leasing (~100 Redis calls/s for this tenant) restores the full 1,000 RPS.',
      insight:
        'Local-only limits assume uniform distribution, which connection reuse (HTTP/2, gRPC, keep-alive) breaks. Use L7 balancing per request and a shared or leased bucket for accurate per-tenant limits.',
      followUps: [
        {
          "q": "You switch to L7 per-request balancing so the tenant spreads over all 100 pods, still with a local 10 RPS each. Is the effective limit now exactly 1,000?",
          "a": "No, because arrivals per pod are random. With 1,000 RPS spread evenly, each pod sees on average 10/s but follows roughly a Poisson distribution (standard deviation ≈ 3.2). With a strict 10 tokens per second and no burst capacity, the expected rejected fraction is about 12.5%, all legitimate in-contract requests. Adding burst capacity (e.g. 20–30 tokens per pod) absorbs most of the variance, at the cost of allowing larger short bursts. Local limiting is always approximate."
        },
        {
          "q": "Someone suggests raising the per-pod local limit to 125 RPS so 8 connections give exactly 1,000. Why is that dangerous?",
          "a": "It only works while the tenant uses exactly 8 connections. If they open 100 connections (or a new SDK version does), every pod allows 125 RPS, so the effective limit becomes 100 × 125 = 12,500 RPS, 12.5× the contract. The limit would track client connection behaviour, which you don't control. Accurate per-tenant limits need a shared state (a central bucket or leases) or per-request L7 balancing, not tuning around one customer's current setup."
        }
      ],
    },
  ],
  test: [
    {
      id: 'rate-limiting-mcq-01',
      difficulty: 'hard',
      question:
        'A fixed-window limiter allows 100 requests per minute per key. What is the maximum number of requests a client can get accepted within any 2-second span?',
      options: ['100', '101', '200', '150'],
      correct: [2],
      explanation:
        'A client can send 100 requests at the end of one window (e.g. 12:00:59) and 100 at the start of the next (12:01:00), both allowed — 200 within about a second. That boundary burst is the main weakness of fixed windows; sliding windows or token buckets smooth it.',
      followUps: [
        {
          "q": "A customer complains: 'I sent 100 requests at 12:00:59 and 1 more at 12:01:30 and it was accepted, but your docs say 100 per minute.' Is that a bug, and how would you answer them?",
          "a": "It's how a fixed window works: the 12:01 window had only one request in it, so it passed. Whether it's a bug depends on what you promised. If the contract says 'per rolling 60 seconds', you need a sliding window counter or a token bucket. Either way, document the exact semantics ('100 per calendar minute, resets at :00') and return `RateLimit` headers with `r` (remaining) and `t` (seconds to reset) so clients can see the window rather than guess. Ambiguous docs generate support tickets more than the algorithm does."
        },
        {
          "q": "Your backend can take 150 requests/s per client at most. Is fixed-window 100/min ever dangerous for it?",
          "a": "Not from one client: the worst case is ~200 requests across a boundary, which takes 2 s at 100 RPS. The danger is fleet-wide synchronization. Every client's window resets at the same wall-clock second, so well-behaved clients that wait for the reset all fire at :00 and produce a thundering herd each minute. Mitigate by offsetting each key's window by a hash of the key (`windowStart = floor((now + hash(key) % 60s) / 60s)`), or by switching to a token bucket, which has no shared reset instant."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-02',
      difficulty: 'expert',
      question: 'What is wrong with this limiter under load? Select ALL that apply.',
      code: {
        language: 'typescript',
        code: `async function allow(key: string, limit: number) {
  const n = Number(await redis.get(key)) || 0;
  if (n >= limit) return false;
  await redis.set(key, n + 1, 'EX', 60);
  return true;
}`,
      },
      options: [
        'Concurrent requests can read the same n and all pass, exceeding the limit',
        'Every accepted request resets the TTL, so a steady client never gets a fresh window',
        'Concurrent increments can overwrite each other (lost updates), undercounting',
        'redis.get returns a number, so Number() throws on large counts',
        'It is fine as long as the Redis instance is single-threaded',
      ],
      correct: [0, 1, 2],
      explanation:
        'GET-then-SET is a check-then-act race: many requests read the same value (all pass) and their SETs overwrite each other (lost updates). SET with EX on every request also slides the expiry forward, so the window never resets for an active client. Redis being single-threaded makes each command atomic, not the sequence of two commands; GET returns a string, and Number() doesn\'t throw.',
      followUps: [
        {
          "q": "A teammate fixes it with `INCR` then `EXPIRE key 60` on every request. What's still wrong?",
          "a": "`INCR` is atomic, so the race and lost updates are gone. But calling `EXPIRE` on every request keeps pushing the expiry forward, so an active client's counter never resets and they stay blocked until they go quiet for a full minute. Two separate commands also leave a gap: a crash between them leaves a key with no TTL, blocked forever. Fix with `SET key 0 EX 60 NX` and then `INCR`, `EXPIRE key 60 NX` (Redis 7), or one Lua script that sets the TTL only when `INCR` returns 1."
        },
        {
          "q": "How would you write a test that proves the original code over-admits?",
          "a": "Run it against a real Redis in a container, fire 500 concurrent calls with `Promise.all` for the same key with limit 100, and count accepted requests. The buggy version typically admits far more than 100 because many requests read the same value before any write lands. Assert `accepted === 100` for the fixed version and repeat the test about 50 times, since races are probabilistic. Also assert the TTL with `PTTL key > 0` after the burst, which catches the 'never expires' bug."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-03',
      difficulty: 'hard',
      question:
        'A token bucket has capacity 50 and refills at 10 tokens/s. A client has been idle for a minute, then sends 80 requests instantly, then 1 request every 50 ms. Which description is correct?',
      options: [
        'The first 50 are allowed, the next 30 rejected; afterwards about 1 of every 2 requests is allowed (10/s refill vs 20/s offered)',
        'All 80 are allowed because the bucket accumulated 600 tokens during the idle minute',
        'Only 10 are allowed per second from the start, so 70 of the first 80 are rejected',
        'The first 50 are allowed, then all further requests are rejected until the bucket refills completely',
      ],
      correct: [0],
      explanation:
        'Tokens are capped at capacity (50), so idle time can\'t bank 600. The burst drains the bucket (50 allowed, 30 rejected); afterwards 20 req/s are offered against 10 tokens/s, so roughly half are allowed. Allowing only 10 from the start ignores burst capacity; requests don\'t wait for a full refill, one token suffices.',
      followUps: [
        {
          "q": "This client is a nightly batch sync that sends 80 requests at once and then trickles. Should it get 429s, or would you shape it differently?",
          "a": "For a known batch client, rejecting 30 requests and making it retry wastes work on both sides. Options: give it a plan with capacity ≥ 80 if the backend can absorb that burst; or queue its excess server-side (a leaky-bucket queue with a short maximum wait, e.g. 3 s at 10/s holds 30 requests) so it gets slower responses instead of errors; or have the client pace itself to 10/s using the `RateLimit` headers. Rejection suits interactive clients, where a fast 429 is better than a slow success."
        },
        {
          "q": "You need this bucket to be accurate across 3 regions without a cross-region Redis call per request. How?",
          "a": "Split the rate: give each region a share (for example in proportion to that region's recent traffic: 5/3/2 tokens/s with capacities scaled the same way) and enforce locally in each region's Redis. Rebalance the shares every few seconds via a lightweight control loop that exchanges usage counts asynchronously. The global limit can be briefly exceeded or under-used while shares adjust; in exchange you avoid adding ~70–150 ms of cross-region latency to every request. For strict limits (billing-critical), route the tenant to a home region instead."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-04',
      difficulty: 'expert',
      question:
        'A sliding window counter uses limit 100/min. The previous minute had 90 requests; the current minute has 20 so far and we are 40 s into it. Does the next request pass?',
      options: [
        'Yes — only 20 requests are in the current window',
        'No — the estimate is 90 + 20 × (40/60) ≈ 103, over the limit',
        'No — 90 + 20 = 110 exceeds the limit',
        'Yes — the estimate is 20 + 90 × (1 − 40/60) = 50, under 100',
      ],
      correct: [3],
      explanation:
        'The weight for the previous window is the fraction of it still inside the sliding window: 1 − 40/60 = 1/3, so the estimate is 20 + 30 = 50 → allowed. Swapping which window gets weighted (90 + 20 × 40/60) misapplies the formula, adding both windows ignores the sliding, and counting only the current window is just a fixed window.',
      followUps: [
        {
          "q": "How much error can the sliding window counter have compared with an exact sliding log, and when does it matter?",
          "a": "It assumes the previous window's requests were spread evenly. If all 90 came in the last second of the previous minute, they are still really inside the sliding window, but the estimate counts only a third of them (30), so it under-counts by 60 and can admit up to ~60 extra requests (60% of the limit) in that moment. Cloudflare measured about 0.003% of requests wrongly decided on real traffic, because real traffic is rarely that skewed. It matters for small, security-sensitive limits (5 login attempts), where you should use an exact sliding log."
        },
        {
          "q": "Implement it in Redis: which keys and commands, and how many round trips per request?",
          "a": "Two counters per client: `rl:{id}:<windowIndex>` for the current and previous minute. One Lua script (so it's atomic and needs one round trip): `GET` the previous count, `GET` the current count, compute `cur + prev × (1 − elapsed/60)`, and if under the limit `INCR` the current key and set `EXPIRE` to 120 s, so it outlives the window where it's used as 'previous'. Use a hash tag `{id}` so both keys share a slot in Redis Cluster, and use Redis `TIME` so pods with skewed clocks agree on the window index."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-05',
      difficulty: 'hard',
      question: 'This sliding-log script undercounts during bursts. Why?',
      code: {
        language: 'lua',
        code: `local now = tonumber(ARGV[1])      -- ms timestamp from the app server
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - 60000)
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], now, now)   -- member = timestamp
  redis.call('PEXPIRE', KEYS[1], 60000)
  return 1
end
return 0`,
      },
      options: [
        'ZREMRANGEBYSCORE is not allowed in Lua scripts',
        'PEXPIRE resets the counts every request',
        'Requests in the same millisecond share the same member, so ZADD updates one entry instead of adding several',
        'ZCARD is O(n) and times out',
      ],
      correct: [2],
      explanation:
        'Sorted-set members are unique; using the timestamp as the member means N requests in the same ms collapse into one entry, so the log undercounts and extra requests pass. Use a unique member (timestamp + random/request ID). Also consider Redis TIME to avoid app clock skew. The commands are allowed in scripts, PEXPIRE doesn\'t delete entries, and ZCARD is O(1).',
      followUps: [
        {
          "q": "You switch to `timestamp-requestId` members. Now one client sends 10,000 req/min on a 100/min limit. What happens to memory and CPU?",
          "a": "If you add members even for rejected requests, the set grows to ~10,000 entries per minute for that key (~70 B each, so ~700 KB) and ZREMRANGEBYSCORE does more work each call, so an abusive client makes itself expensive to limit. Only `ZADD` when the request is allowed; then the set never exceeds the limit (100 entries). Rejections cost one `ZREMRANGEBYSCORE` + `ZCARD`. For really abusive keys, put a cheap fixed-window pre-check or an edge block in front so they rarely reach the sorted set."
        },
        {
          "q": "Would you use the sliding log for a 10,000 requests/hour API limit? Why or why not?",
          "a": "No. Each key could hold up to 10,000 entries (~700 KB), and across a million active keys that's terabytes in the worst case. Sliding logs make sense when the limit is small and exactness matters (login attempts, OTP sends, password resets: limits of 3–10). For large limits, a sliding window counter (two integers per key) or token bucket (two fields) gives near-identical behaviour in ~100 bytes per key."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-06',
      difficulty: 'expert',
      question:
        'Your limiter runs on the same Redis cluster as your page cache, configured with maxmemory-policy allkeys-lru. During a traffic spike the cache fills memory. What happens to rate limiting?',
      options: [
        'Limiter keys may be evicted, silently resetting clients\' counters and letting abusive clients through',
        'Redis rejects writes with OOM errors, so the limiter fails closed',
        'Nothing — LRU only evicts cache keys because they are larger',
        'Redis automatically moves limiter keys to disk',
      ],
      correct: [0],
      explanation:
        'allkeys-lru can evict any key, including limiter state; an evicted bucket looks like a fresh (full) bucket, so limits silently reset exactly when load is highest. OOM errors happen with noeviction, not allkeys-lru. Redis has no automatic tiering to disk. Run the limiter on a separate instance with noeviction.',
      followUps: [
        {
          "q": "You move the limiter to its own Redis with `noeviction`. A bot then creates millions of unique keys (random API keys or IPs). What fails, and how do you defend?",
          "a": "Memory fills with keys for clients that send one request each; with `noeviction`, writes then fail with OOM and the limiter starts erroring for everyone. Defences: rate-limit only after cheap validation (reject unknown API keys before creating limiter state, using a cached set of valid keys); give keys short TTLs equal to the window; key anonymous traffic by IP prefix (/24, /64) rather than full address; and alert on key count and memory growth. Size memory for the expected active-key cardinality with 2× headroom."
        },
        {
          "q": "How do you detect in production that limiter keys were evicted?",
          "a": "Watch `evicted_keys` in Redis `INFO stats`; on a limiter instance it should always be 0. Alert on any increase. On the application side, track the ratio of 'new bucket created' to requests per key class: a spike in fresh buckets for known heavy clients means their state vanished. You can also run a canary key with a long TTL and a known value, and alert if a periodic check finds it missing."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-07',
      difficulty: 'medium',
      question: 'Which response is most appropriate when an API client exceeds its plan limit?',
      options: [
        '403 Forbidden with a message "rate limited"',
        '503 Service Unavailable with Retry-After',
        '400 Bad Request with an error code',
        '429 Too Many Requests with Retry-After and quota headers',
      ],
      correct: [3],
      explanation:
        '429 signals that this client sent too many requests, and Retry-After plus quota headers tell it when to retry. 503 signals server-side unavailability/overload (appropriate for load shedding, not per-client quotas). 403 implies an authorisation problem that retrying won\'t fix, and 400 means the request itself is malformed.',
      followUps: [
        {
          "q": "A customer's SDK treats every 4xx as a permanent failure and drops the request. You can't change their SDK. What do you do?",
          "a": "Return 429 anyway, since it's the correct contract and other clients rely on it, but reduce how often this customer hits it: give them the `RateLimit` headers so their team can pace, offer server-side queuing (a short delay instead of rejection) for their key, or temporarily raise their burst capacity while they fix the client. Track 429s per client and contact top offenders. Mangling status codes for one SDK breaks the semantics for everyone else."
        },
        {
          "q": "When would you return 503 with Retry-After instead of 429 to a client that's within its quota?",
          "a": "When the server, not the client, is the problem: during load shedding because a dependency is degraded or capacity is saturated, you reject some in-quota traffic to protect the rest. A 503 tells the client it isn't their fault and that retrying later may work; Retry-After (e.g. 5–30 s with jitter) spreads the retries. Keep the two separate in metrics: a rising 429 rate is a client-behaviour signal, while a rising 503 rate is an incident."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-08',
      difficulty: 'expert',
      question:
        'You enforce 1,000 RPS per tenant by giving each of 50 pods a local limit of 20 RPS. Select ALL situations that make the effective limit diverge from 1,000 RPS.',
      options: [
        'The tenant uses a few long-lived HTTP/2 connections balanced at L4',
        'The HPA scales the deployment from 50 to 120 pods without updating the per-pod limit',
        'The load balancer distributes requests round-robin per request across all pods',
        'A rolling deployment temporarily runs 60 pods (50 old + 10 new)',
      ],
      correct: [0, 1, 3],
      explanation:
        'Pinned connections concentrate traffic on few pods (effective limit shrinks), and any change in pod count (autoscaling, rolling deploy surge) changes the sum of per-pod limits (grows here). Per-request round-robin across all pods is the one case where local ÷ N works reasonably well.',
      followUps: [
        {
          "q": "You keep local limits but want them to adapt to pod count automatically. How?",
          "a": "Compute the per-pod limit dynamically as `globalLimit / currentPodCount`, where the pod count comes from the Kubernetes Endpoints API (watched, not polled per request) or from a gossip membership list. Recompute on every membership change. It's still approximate: during rollouts the count is briefly wrong, and it doesn't fix skew from pinned connections. That's acceptable for coarse protection (stopping a 10× runaway client), but not for contractual limits you bill on."
        },
        {
          "q": "The HPA goes from 50 to 120 pods, so the tenant's effective limit jumps to 2,400 RPS. Which downstream system notices first?",
          "a": "Whatever the limit was protecting: usually the shared database or a downstream service sized for 1,000 RPS from this tenant. The effect compounds, because the HPA scaled out because of load, and scaling out raised the limit that was supposed to cap that load. Watch DB CPU and connection counts per tenant as the signal. This is exactly the case where a central (or leased) bucket matters, since the limit must be independent of fleet size."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-09',
      difficulty: 'hard',
      question:
        'An attacker tries one common password against 500,000 different accounts from 50,000 residential IPs over an hour. Which control is most effective?',
      options: [
        'Lower the per-IP limit from 20/min to 5/min',
        'Breached-password checks plus bot/challenge defences triggered by a global login-failure-rate anomaly',
        'Lock each account permanently after 3 failed attempts',
        'Per-account limit of 5 failures per 15 minutes',
      ],
      correct: [1],
      explanation:
        'Each IP makes ~10 attempts per hour and each account sees one attempt, so per-IP and per-account limits never trigger. A global failure-rate signal that enables challenges, plus rejecting breached/common passwords, targets the attack pattern. Permanent lockout doesn\'t trigger either (one attempt per account) and would enable DoS if it did.',
      followUps: [
        {
          "q": "The attacker switches to 500 different common passwords, each tried once per account across the whole campaign. Does the breached-password check still help?",
          "a": "Yes, if users can't have those passwords in the first place. Checking passwords at signup and reset against a breached/common corpus (HaveIBeenPwned k-anonymity API, or a local bloom filter of ~1 billion hashes) means the 500 most common passwords match almost no accounts, so the spray finds nothing. At login, a correct password that's on the breached list should still trigger step-up or a forced reset. Combine with MFA so a correct password alone isn't enough."
        },
        {
          "q": "How would you build the 'global login-failure-rate anomaly' signal without alerting every Monday morning?",
          "a": "Compare the failure ratio, not the raw count: failures ÷ attempts per minute, against a baseline for the same hour-of-week (e.g. the median of the last 4 weeks). Monday logins raise both numerator and denominator, so the ratio stays stable, while a spray drives it from ~5% to 60%+. Add secondary signals: share of attempts for non-existent accounts, and the number of distinct accounts per ASN. When the anomaly fires, enable challenges for new or unrecognized devices only, so returning users keep logging in smoothly."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-10',
      difficulty: 'hard',
      question:
        'You must call a partner API that permanently bans your key if you exceed 50 requests in any 1-second window. Which approach best fits?',
      options: [
        'Token bucket with rate 50/s and capacity 200 to absorb bursts',
        'Retry with exponential backoff whenever the partner returns 429',
        'Fixed window of 50 per second per pod',
        'A leaky-bucket queue draining at a steady rate below the cap (e.g. 45/s), bounded by a latency budget',
      ],
      correct: [3],
      explanation:
        'A strict "never exceed" limit requires smooth, shaped output across the whole fleet, which a leaky-bucket queue provides, with a safety margin. A token bucket with capacity 200 allows 200 in one instant; per-pod fixed windows multiply by pod count and allow boundary bursts; reacting to 429 is too late when a violation means a ban.',
      followUps: [
        {
          "q": "Your partner-calling service runs on 12 pods. Where does the leaky-bucket queue live so the whole fleet stays under 45/s?",
          "a": "Either centralise sending (all partner calls go through a single egress worker, or one active consumer per partition of a queue, which drains at 45/s) or use a shared Redis bucket that each pod checks before sending. The single-drainer design is simplest to reason about and guarantees smoothness; give it a hot standby with leader election so a crash doesn't stop all partner traffic. A per-pod 45/12 ≈ 3.75/s split breaks as soon as pods scale or one pod gets more work."
        },
        {
          "q": "The queue grows faster than 45/s can drain: 60 calls/s arrive for an hour. What do you do?",
          "a": "The backlog grows by 15/s, which is 54,000 calls after an hour, so latency grows without bound. Set a latency budget and enforce it: reject or defer calls that would wait longer than, say, 30 s (with a clear error to the caller), prioritise by value (payments before analytics), coalesce or deduplicate calls (send one status refresh per order, not 10), and batch if the partner offers a bulk endpoint. The structural fix is a higher quota from the partner; a strict upstream cap can't be engineered away."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-11',
      difficulty: 'expert',
      question: 'Which statements about this token-bucket script are true? Select ALL that apply.',
      code: {
        language: 'lua',
        code: `local now = tonumber(ARGV[4])          -- Date.now() from the calling pod
local s = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(s[1]) or tonumber(ARGV[1])
local ts = tonumber(s[2]) or now
tokens = math.min(tonumber(ARGV[1]), tokens + (now - ts) / 1000 * tonumber(ARGV[2]))
if tokens < 1 then return {0, tokens} end
redis.call('HSET', KEYS[1], 'tokens', tokens - 1, 'ts', now)
return {1, tokens - 1}`,
      },
      options: [
        'A pod with a clock running 5 s fast can mint up to 5 s worth of extra tokens',
        'A pod with a slow clock produces a negative elapsed time, reducing tokens',
        'The fractional token count in the reply is returned to the client as a float',
        'The key never expires, so idle buckets accumulate in memory forever',
        'The script is not atomic because it calls HMGET and HSET separately',
      ],
      correct: [0, 1, 3],
      explanation:
        'Using caller-supplied time lets clock skew add tokens (fast clock) or subtract them (slow clock → negative elapsed, since there is no max(0, …)); use Redis TIME and clamp. There is no PEXPIRE, so idle keys never expire. Redis truncates Lua numbers to integers in replies, so no float is returned. Scripts execute atomically regardless of how many commands they run.',
      followUps: [
        {
          "q": "You switch to Redis `TIME` inside the script. In Redis Cluster after a failover, the new primary's clock is 2 s behind the old one. What happens?",
          "a": "Buckets last updated by the old primary have `ts` up to 2 s in the future relative to the new clock, so `now - ts` is negative. Without a clamp, tokens are subtracted and clients get a burst of wrong 429s. Clamp with `elapsed = math.max(0, now - ts)`. Then, for up to 2 s, those buckets simply don't refill, which is a small, safe error. NTP keeps primaries within milliseconds normally, but the clamp is what makes a clock step harmless."
        },
        {
          "q": "How would you choose the PEXPIRE value for this bucket?",
          "a": "Use the time for an empty bucket to refill completely: `capacity / rate`, plus a small margin. After that, a missing key and a full bucket mean the same thing, so deleting it loses nothing. For capacity 50 at 10 tokens/s that's 5 s, so `PEXPIRE` ≈ 6,000 ms. A longer TTL wastes memory on idle keys; a shorter one lets a client that just emptied its bucket come back to a full one after the key expires, which is a free burst."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-12',
      difficulty: 'medium',
      question:
        'The rate-limit Redis cluster is unreachable. For which endpoint is failing CLOSED (or strictly local) the better default?',
      options: [
        'POST /auth/otp/send (sends an SMS to a phone number)',
        'GET /products (catalog browsing)',
        'GET /orders/{id} for an authenticated user',
        'GET /health',
      ],
      correct: [0],
      explanation:
        'Unlimited OTP sends enable SMS pumping (toll fraud) and harassment, costing real money in minutes — fail closed or use a strict local limit. Browsing and reading one\'s own orders should fail open with a bounded local fallback, since over-admission is cheap. Health checks shouldn\'t be rate limited by a shared store at all.',
      followUps: [
        {
          "q": "You fail closed on OTP sends when Redis is down. Now Redis is down for 20 minutes and nobody can log in with OTP. How do you soften that without opening SMS pumping?",
          "a": "Fall back to a strict local limiter per pod (e.g. 1 OTP per phone number per 60 s and a per-pod global cap of a few per second), sized so the total across the fleet stays under what the business tolerates in SMS spend. Also block high-risk destinations during the outage (premium-rate prefixes and countries with no users), and offer alternative factors (email OTP, authenticator app). Alert finance-visible SMS spend per minute as an independent backstop."
        },
        {
          "q": "How do you test that each endpoint actually fails the way you intended when Redis is unreachable?",
          "a": "Write a fault-injection test per endpoint class: point the limiter at a blackholed address (or use Toxiproxy to add latency beyond the command timeout), then assert that `/products` returns 200 with the local bucket enforcing a bound, that `/auth/otp/send` returns 429/503 or is held to the strict local limit, and that p99 latency stays under budget (no hanging on a 30 s connect). Run the same scenario as a game day in staging, and make each endpoint's fail mode explicit config that a test enumerates."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-13',
      difficulty: 'expert',
      question:
        'In Redis Cluster, a sliding-window-counter script builds two key names (current and previous window) from KEYS[1] inside the script. Select ALL correct statements.',
      options: [
        'If the derived keys hash to different slots, the script can fail with a cross-slot error',
        'Using a hash tag like rl:{tenant-42} makes both derived keys land in the same slot',
        'Redis Cluster automatically forwards commands for other slots from inside a script',
        'Best practice is to compute both keys client-side and pass them as KEYS so the cluster can validate slots',
      ],
      correct: [0, 1, 3],
      explanation:
        'All keys a script touches must be in the same slot; hash tags force that because only the part inside {} is hashed. Declaring keys via KEYS lets clients route correctly and the server validate them. Scripts can\'t reach keys in other slots — there is no forwarding from inside a script.',
      followUps: [
        {
          "q": "Every tenant's keys now share a hash tag. One huge tenant sends 40% of traffic. What happens in the cluster?",
          "a": "All of that tenant's limiter keys map to one slot, so one shard handles 40% of all limiter calls: a hot shard. The other shards idle while that one saturates CPU, and the tenant's limiter latency rises. Fixes: token leasing for that tenant (pods take batches of e.g. 50 tokens, cutting calls 50×); or split its bucket into N sub-buckets with different hash tags (`{tenant-42:3}`), each holding 1/N of the rate, with requests picking one at random."
        },
        {
          "q": "How would you detect that a single slot has become hot?",
          "a": "Per-shard metrics: commands/s and CPU per Redis primary; one node at 90% while others sit at 20% points to a hot slot. Then use `redis-cli --hotkeys` (needs an LFU eviction policy) or sample with `MONITOR` briefly on a replica, or better, count limiter calls per key client-side and export the top-K. Alert when one shard's ops/s exceeds about 2× the cluster median for 5 minutes."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-14',
      difficulty: 'hard',
      question:
        'A client SDK handles 429 as shown. What is the main systemic effect when a large customer hits their limit?',
      code: {
        language: 'typescript',
        code: `async function send(req: Request): Promise<Response> {
  for (;;) {
    const res = await fetch(req.clone());
    if (res.status !== 429) return res;
    // rate limited: try again right away
  }
}`,
      },
      options: [
        'No effect, because rejected requests are free',
        'The client\'s bucket refills faster because it is polled more often',
        'The limiter and gateway receive a flood of rejected requests, potentially many times the original rate, consuming shared capacity',
        'The server automatically raises the client\'s limit',
      ],
      correct: [2],
      explanation:
        'Rejections are cheap but not free: tight retry loops multiply requests to the gateway and limiter store (TLS, parsing, a Redis call each), turning a quota event into a self-DDoS. Polling doesn\'t change refill rate, and limits don\'t auto-raise. SDKs must honour Retry-After with jittered backoff, and the edge may need to block clients that ignore it.',
      followUps: [
        {
          "q": "You can't force customers to upgrade the SDK. How do you protect the gateway from clients that ignore Retry-After?",
          "a": "Escalate at the edge for clients in violation: after N 429s within a short window that arrive before their Retry-After expires, put the key or IP in a 'penalty box' at the CDN/WAF for the Retry-After duration, where rejection costs almost nothing (no TLS to origin, no Redis call). Cache the 429 decision in-process on each pod for the Retry-After period so repeated rejections skip Redis. Release a fixed SDK with jittered exponential backoff and contact the top offenders directly."
        },
        {
          "q": "What should the SDK's backoff actually look like?",
          "a": "Honour `Retry-After` when present; otherwise use exponential backoff with full jitter: `sleep = random(0, min(cap, base × 2^attempt))`, e.g. base 500 ms, cap 30 s, at most 5–6 attempts. Read the `RateLimit` remaining header to slow down before hitting 429. Add a client-side retry budget (retries ≤ 10% of requests over a minute) so a broad outage doesn't make retries multiply load. Retry only idempotent requests, or ones with an idempotency key."
        }
      ],
    },
    {
      id: 'rate-limiting-mcq-15',
      difficulty: 'hard',
      question:
        'You rate-limit unauthenticated signups at 10 per hour per IPv6 address. Attackers still create thousands of accounts per hour from a single host. Most likely reason and fix?',
      options: [
        'IPv6 addresses change every request due to NAT; switch to per-country limits',
        'Redis keys are case-sensitive, so uppercase IPv6 bypasses; lowercase them',
        'The limiter can\'t parse IPv6; convert addresses to IPv4',
        'A single host can use many addresses within its /64 (or larger) allocation; key limits on the /64 (or /56) prefix',
      ],
      correct: [3],
      explanation:
        'End sites typically receive at least a /64 (often a /56 or /48), so one host can rotate through billions of addresses; limiting per full /128 is trivial to evade. Key on the prefix instead, alongside other signals. IPv6 generally doesn\'t use NAT, and per-country limits would be far too coarse. (Normalising address format is good hygiene but not the main hole.)',
      followUps: [
        {
          "q": "Keying on /64 means a whole office behind one /64 shares the limit. How do you avoid punishing legitimate users?",
          "a": "Apply limits in layers: a moderate limit per /64 (e.g. 50 signups/hour), a tighter one per /56 or /48 for rotation across subnets, and a device signal (a signed cookie or fingerprint) for per-device fairness inside a /64. On hitting the prefix limit, challenge (CAPTCHA, email verification) rather than reject, so the office still signs up while a script stalls. Raise limits for known-good ASNs and enterprise customers that register their ranges."
        },
        {
          "q": "The attacker moves to a botnet of residential IPv4 and IPv6 addresses, 1–2 signups each. What do you do now?",
          "a": "IP-based limits stop working, so add cost and signals elsewhere: require email or phone verification before the account is usable (and rate-limit verification sends per destination); check disposable email domains; apply proof-of-work or CAPTCHA based on risk; and measure global signup rate against baseline, tightening challenges when it spikes. Put new accounts in a probation tier with low quotas so mass-created accounts are worth little until they show normal behaviour."
        }
      ],
    },
  ],
};

export default topic;
