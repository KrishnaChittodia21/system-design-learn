import type { Topic } from '../../types';

const topic: Topic = {
  id: 'misc-traffic-edge',
  phase: 'miscellaneous',
  order: 2,
  title: 'Load Balancing, Gateways, Rate Limits, CDN & Multi-tenancy',
  subtitle:
    'A question bank on the traffic edge: balancing algorithms, L4 vs L7, draining, consistent hashing, gateways, rate limits, CDN caching, multi-tenancy and noisy neighbours — fresh angles, real reported questions, sharp distractors.',
  estimatedMinutes: 75,
  sources: [
    'Hello Interview — community questions (Design a Load Balancer, asked at Amazon; Noisy Neighbor Mitigation, asked at Databricks; Design a Rate Limiter)',
    'Glassdoor — Stripe interview reports ("Implement a rate limiter")',
    'Algoroq — Load Balancing and Multi-Tenancy interview questions for senior engineers (2026)',
    'DesignGurus — Load balancing concepts; How do you isolate noisy neighbors in multi-tenant systems?',
    'Microsoft Azure Architecture Center — Noisy Neighbor antipattern',
    'AWS Builders Library — Workload isolation using shuffle-sharding; AWS SaaS Lens (silo / pool / bridge)',
    'Stripe Engineering — Scaling your API with rate limiters (concurrency limiter and load shedders)',
    'Google Research — Consistent Hashing with Bounded Loads (Mirrokni, Thorup, Zadimoghaddam); Lamping & Veach — Jump Consistent Hash',
    'Envoy documentation — panic threshold, zone-aware routing, draining, GOAWAY',
    'RFC 9111 (HTTP Caching) §3.5 Authorization; RFC 5861 (stale-while-revalidate, stale-if-error)',
    'Omer Gil / PortSwigger Research — Web Cache Deception',
    'GitHub and Shopify GraphQL API docs — query cost / point-based rate limits',
    'Node.js docs — http.Server.close(), closeIdleConnections(), keepAliveTimeout',
  ],
  tags: [
    'load-balancing',
    'l4-l7',
    'connection-draining',
    'consistent-hashing',
    'api-gateway',
    'rate-limiting',
    'cdn',
    'multi-tenancy',
    'noisy-neighbor',
    'interview-bank',
  ],
  cheatSheet: [
    'Load balancing: P2C (pick 2 random, take the less loaded) beats global least-conn for distributed proxies; Envoy panic mode (default 50% healthy) sprays traffic to ALL hosts, sick ones too.',
    'L4 sees 5-tuple bytes (fast, protocol-agnostic, keeps source IP only via PROXY protocol or preserve-IP); L7 terminates HTTP (routing, retries, per-request balancing of HTTP/2, but pays TLS + parsing CPU).',
    'Draining order: fail readiness -> LB stops new work -> finish in-flight (bounded) -> close idle keep-alives / send GOAWAY -> exit. Drain time ≈ p99.9 request duration, not the 300 s default.',
    'Long-lived connections (WebSocket, gRPC streams) never "drain" by waiting — you tell clients to reconnect, with jitter, or you stampede the survivors.',
    'Consistent hashing moves ~1/N keys on membership change but does NOT fix hot keys; bounded-load variant caps each node at (1+ε)× average; jump hash has no weights and only removes the last bucket.',
    'API gateway = north-south policy (authn, quotas, routing, API keys, transformation); a mesh = east-west. Keep business logic and fan-out orchestration out of the gateway.',
    'Order gateway filters: cheap reject first (IP/WAF limit) -> authenticate -> per-key/plan quota -> route. Rate-limit by key before auth and your attackers burn your IdP budget.',
    'Rate limit counts requests; a concurrency limit counts in-flight work. Variable-cost APIs (GraphQL, exports) need cost-based budgets (GitHub: points per hour) or concurrency caps.',
    'CDN: a shared cache must not store a response to a request with Authorization unless the response says public / s-maxage / must-revalidate (RFC 9111 §3.5). Set-Cookie on a cacheable page is a data leak waiting to happen.',
    'Web cache deception: /account/profile.css gets cached because the CDN keys on extension while the origin ignores the suffix. Fix: cache by Cache-Control from origin, not by file extension.',
    'Multi-tenancy models: silo (per-tenant stack), pool (shared everything + tenant_id), bridge (mix per layer). Tenant identity comes from the verified token, never from a client header.',
    'Noisy neighbour defences stack: per-tenant quotas at edge, per-tenant concurrency/bulkheads in services, fair queuing in workers, shuffle sharding or cells for blast radius, per-tenant metrics to see it.',
  ],
  sections: [
    {
      heading: 'Load Balancing — algorithms and the failure modes interviewers probe',
      body: `**What it is:** spreading requests across replicas so no single one saturates, and routing around the dead. The algorithm matters less than the *information* each balancer has.

**Mechanism:** round robin assumes identical requests and servers. Least-connections/least-request uses local counts — accurate on one proxy, misleading across 30 proxies that each see a sliver. **Power of two choices (P2C)** picks two random backends and takes the less loaded: near-optimal, no herding, O(1). Latency-aware variants (EWMA, used by Finagle and Linkerd) weigh recent response times. Zone-aware routing keeps traffic in the caller's AZ to save cross-AZ cost and latency, spilling over only when the local zone is short.

**The #1 trap:** a "fast-failing" backend. A pod returning 500s in 1 ms looks *least loaded* to least-request and sucks in traffic. You need outlier detection (eject after N consecutive 5xx).

**Second trap — panic mode:** Envoy's healthy panic threshold (default 50%) means if fewer than half the hosts are healthy, it ignores health and balances across *all* hosts. That protects the survivors from a stampede but sends some traffic to broken hosts on purpose.

**Say in interviews:** "I choose P2C least-request with outlier detection and slow start, zone-aware with spillover, and I know my panic threshold."`,
      keyPoints: [
        'P2C avoids herding when many independent balancers each have partial state.',
        'Outlier detection is mandatory with load-aware algorithms: fast errors look like spare capacity.',
        'Panic threshold trades correctness for survival when most hosts look unhealthy.',
      ],
      source: 'Envoy docs — load balancing, outlier detection, panic threshold',
    },
    {
      heading: 'L4 vs L7 — what each layer can and cannot see',
      body: `**What it is:** an L4 balancer forwards TCP/UDP flows by the 5-tuple; an L7 balancer terminates the connection, parses HTTP (or gRPC) and makes a decision per request.

| | L4 (AWS NLB, Maglev, IPVS) | L7 (ALB, Envoy, nginx) |
|---|---|---|
| Unit of balancing | connection / flow | request (incl. each HTTP/2 stream) |
| Sees | IPs, ports | path, headers, cookies, body |
| TLS | passthrough possible (end-to-end mTLS) | terminates (or re-encrypts) |
| Client IP | preserved, or PROXY protocol v2 | X-Forwarded-For (trust only your own hop) |
| Cost | millions of pps per core, µs added | TLS + parsing, ~0.5–2 ms added |
| Extras | static IPs, any protocol | retries, canary by header, auth, WAF |

**The #1 trap:** "L4 is always faster, so use it." For HTTP/2 or gRPC, an L4 balancer pins a whole multiplexed connection to one backend, so a handful of clients can overload one pod while new pods sit idle. L7 balances each stream.

**Second trap:** L7 retries. An L7 proxy that retries a POST on upstream reset can double-execute non-idempotent work; L4 cannot retry at all.

**Common production shape:** L4 at the very edge (static anycast IPs, DDoS absorption) in front of an L7 tier that does the smart routing.`,
      diagram: `client --TCP--> [ L4: NLB / Maglev ]  hash(5-tuple) -> pick an L7 node
                        |
                        v
               [ L7: Envoy / ALB ]  TLS off, parse HTTP, route /orders
                 |        |       per-request, per-HTTP/2-stream
                 v        v
             orders-v1  orders-v2 (canary: header x-canary=1)`,
      source: 'Google — Maglev paper; AWS ELB docs',
    },
    {
      heading: 'Connection draining — getting replicas out without dropping requests',
      body: `**What it is:** removing a backend from rotation so it stops getting *new* work while it finishes *in-flight* work, then exits. AWS calls it the deregistration delay (default 300 s); Envoy calls it draining; Kubernetes gives you \`terminationGracePeriodSeconds\` (default 30 s).

**Mechanism (Kubernetes + LB):**
1. Pod gets SIGTERM *at the same time* as it is removed from Endpoints — those propagate asynchronously, so for a few seconds LBs still send traffic. Fix: a \`preStop\` sleep of 5–15 s, or fail readiness first.
2. Stop accepting new connections; let in-flight requests finish with a hard cap.
3. Close idle keep-alive sockets (Node: \`server.closeIdleConnections()\`; since Node 19 \`server.close()\` does it) and answer active ones with \`Connection: close\`; HTTP/2 servers send **GOAWAY**.
4. Exit before the grace period, or SIGKILL does it for you.

**The #1 trap:** treating long-lived connections like requests. A WebSocket or gRPC stream never finishes, so a 300 s drain just delays the inevitable, then drops everyone at once. Instead, ask clients to reconnect with jittered backoff and spread it over the window.

**Tune the number:** drain ≈ p99.9 request time + propagation delay. A 300 s default on a service whose p99.9 is 2 s makes every rolling deploy ~10× slower for nothing.`,
      source: 'AWS ELB deregistration delay docs; Kubernetes pod termination lifecycle; Node.js http docs',
    },
    {
      heading: 'Consistent hashing — beyond the ring diagram',
      body: `**What it is:** mapping keys to nodes so that adding or removing one of N nodes moves only ~1/N of the keys, instead of nearly all of them with \`hash % N\`.

**Variants seniors should name:**
- **Ring + virtual nodes** — each node owns many points; vnode count doubles as a weight. Replicas = the next R *distinct physical* nodes clockwise.
- **Rendezvous (HRW)** — for each key, score every node with hash(key, node) and take the max; no ring, trivially weighted, O(N) per lookup.
- **Jump consistent hash** — O(ln N), no memory, perfect balance, but buckets are numbered 0..N-1: you can only add or remove the *last* one, so it fits sharded storage, not a fleet where random nodes die.
- **Maglev** — a precomputed lookup table (prime size, e.g. 65,537) for fast L4 flow hashing with minimal disruption.
- **Bounded loads** — cap each node at ⌈(1+ε)·average⌉; overflow walks to the next node. Vimeo used it in HAProxy to cut cache-tier bandwidth imbalance.

**The #1 trap:** believing consistent hashing fixes hot keys. It balances *key counts*, not *traffic*. One celebrity key still lands on one node — you need replication of hot keys, key splitting or a local cache in front.

**Second trap:** clients with different membership views route the same key to different nodes. Membership must come from one source (a config store or gossip with convergence), or you get split-brain caching.`,
      source: 'Karger et al. 1997; Lamping & Veach 2014; Google Research 2016 (bounded loads)',
    },
    {
      heading: 'API Gateway — the policy layer, not the business layer',
      body: `**What it is:** a reverse proxy for north-south traffic that applies cross-cutting policy — authentication, API keys, quotas, routing and versioning, request size limits, CORS, transformation — before requests reach services. Kong, Envoy Gateway, AWS API Gateway, Apigee; for GraphQL, the Apollo Router or a federation gateway plays the same role.

**Mechanism:** a filter chain per route. Order matters: cheap rejections first (WAF, IP limits, body size), then authentication (JWT verified locally with a cached JWKS), then per-consumer quota, then routing with timeouts and at most one retry for idempotent methods.

**Gateway vs load balancer vs mesh:** the LB spreads load; the gateway decides *whether* and *where* a request may go based on identity and product rules; a mesh handles east-west service-to-service mTLS, retries and telemetry. Small systems legitimately merge gateway and LB into one box.

**The #1 trap:** the gateway grows into a monolith — per-endpoint business rules, response stitching, database calls. It then becomes a shared deploy bottleneck and a single blast radius. Keep aggregation in BFFs or GraphQL resolvers owned by product teams.

**Other traps interviewers like:** buffering breaks streaming (SSE or large uploads need buffering off, or pre-signed URLs straight to object storage); a gateway-wide timeout shorter than a legitimately slow endpoint; trusting identity headers that clients can also set.`,
      source: 'Mastering API Architecture — Ch 3 (API gateways); Hello Interview — API Gateway deep dive',
    },
    {
      heading: 'Rate Limiting — rates, concurrency and cost',
      body: `**What it is:** capping how much work one caller may ask for in a window, so shared capacity and commercial plans are protected. Token bucket and sliding window are the usual algorithms; the harder questions are about *what* you count.

**Three different limits:**
- **Rate** (requests per second/minute) — right for cheap, uniform calls.
- **Concurrency** (in-flight requests per caller) — right when cost is duration-bound; Stripe runs a concurrent-request limiter next to its rate limiter for exactly this reason.
- **Cost** (points per window) — right when one request can be 1,000× another. GitHub's GraphQL API budgets points per hour; Shopify's GraphQL Admin API uses a leaky bucket of calculated query cost.

**Rollout mechanics:** ship new limits in shadow mode (log would-be 429s per key for a week), then enforce, starting with the most permissive tier. Return 429 with Retry-After and the IETF RateLimit headers so well-behaved clients self-pace.

**The #1 trap:** a request-count limit on a GraphQL endpoint. One query that fetches 100 repos × 100 issues × 100 comments counts as "1 request" while costing a million node loads. Estimate cost statically before execution (depth × breadth with list-size arguments), reject over-budget queries, and charge the actual cost afterwards.

**Rate limiting is not load shedding:** limits are per caller and contractual; load shedding is global and protects the server when everyone is within quota but the total is still too much.`,
      source: 'Stripe Engineering — Scaling your API with rate limiters; GitHub GraphQL rate limit docs',
    },
    {
      heading: 'CDN — caching correctness at the edge',
      body: `**What it is:** a network of edge caches (PoPs) that serve content close to users and shield the origin. Correctness is decided by the **cache key** and by **Cache-Control**.

**Mechanism:** the edge builds a key (host + path + selected query params/headers), checks freshness (\`s-maxage\` beats \`max-age\` for shared caches), and on a miss fetches from origin — ideally via a shield tier with request collapsing so 200 PoPs don't all miss at once. \`stale-while-revalidate\` serves the old copy while refetching; \`stale-if-error\` serves it when origin is down.

**Correctness rules seniors should know:**
- A shared cache must not reuse a response to a request with an **Authorization** header unless the response explicitly allows it (\`public\`, \`s-maxage\` or \`must-revalidate\`) — RFC 9111 §3.5.
- A cacheable response that carries **Set-Cookie** can hand one user's session to the next; most CDNs refuse to cache it, and some config overrides "force cache" anyway.
- **Negative caching:** a 404 or 500 cached for your default TTL turns a 10-second blip into a 10-minute outage. Give errors seconds-long TTLs.

**The #1 trap — web cache deception:** an attacker sends a victim to /account/settings/x.css. The origin ignores the suffix and returns the private settings page; the CDN caches it because the path "looks static". The attacker then fetches the same URL. Fix: cache only what the origin marks cacheable, and make the origin 404 unknown path suffixes.`,
      source: 'RFC 9111; RFC 5861; PortSwigger Research — Web Cache Deception',
    },
    {
      heading: 'Multi-tenancy — silo, pool, bridge and how requests find their tenant',
      body: `**What it is:** one system serving many customer organisations (tenants) with isolation of data, performance and configuration, at a cost per tenant far below one deployment each.

**Models (AWS SaaS Lens vocabulary):**
- **Silo** — dedicated stack or database per tenant. Strong isolation, easy per-tenant restore and residency, but N deployments to migrate and pay for.
- **Pool** — shared everything, every row carries tenant_id, enforced by RLS or a data-access layer. Cheapest and simplest to operate; isolation depends on discipline.
- **Bridge / tiered** — pool for the long tail, silo for enterprise; often via **cells** (each cell is a pool of a few hundred tenants) plus a tenant directory that routes tenant → cell.

**Mechanism in a Node stack:** the edge resolves the tenant (subdomain or token claim), looks up the cell in a cached directory, and forwards. In the service, a request-scoped context (AsyncLocalStorage or a NestJS request-scoped provider) carries tenant_id to every query, cache key, log line and metric.

**The #1 trap:** taking tenant identity from a client-controlled header or path while authorisation reads a different source — the classic cross-tenant IDOR. Tenant comes from the verified token; any path tenant must equal it.

**Second trap — schema-per-tenant with PgBouncer in transaction mode:** \`SET search_path\` is session state, so the next transaction on that server connection may run in another tenant's schema. Use \`SET LOCAL\` inside the transaction, or fully qualified names.`,
      source: 'AWS SaaS Lens — Well-Architected Framework; AWS — Cell-based architecture',
    },
    {
      heading: 'Noisy neighbor — detecting and containing one tenant hurting the rest',
      body: `**What it is:** one tenant's workload consumes a shared resource — CPU, DB connections, cache memory, queue throughput, IOPS — and every other tenant's latency degrades. Microsoft documents it as an antipattern; Databricks has asked candidates to design around it.

**Mechanism — defend every shared resource separately:**
- **Edge:** per-tenant rate and cost quotas.
- **Services:** per-tenant concurrency caps (bulkheads) so one tenant can hold at most k of the worker slots or pool connections.
- **Queues and workers:** fair scheduling — per-tenant sub-queues served round-robin or with deficit round robin (DRR), instead of one FIFO where a 2M-job import blocks everyone.
- **Datastores:** per-tenant statement timeouts, separate pools for heavy tiers, Kafka client quotas (byte-rate per client/user), per-tenant key prefixes with memory accounting in shared Redis.
- **Blast radius:** cells or **shuffle sharding** — each tenant gets a random subset of k workers out of n, so the chance two tenants share *all* their workers is 1 / C(n, k).

**The #1 trap:** "we'll just autoscale." Autoscaling adds capacity for the noisy tenant too; you pay to amplify the problem, and it does nothing for a saturated shared database. Isolation needs *per-tenant* limits.

**Detection comes first:** per-tenant RED metrics (rate, errors, duration) and resource attribution. Top-k tenants by DB time, not unbounded tenant labels on every Prometheus series.`,
      diagram: `FIFO queue:   [A A A A A A A A A A B C D]  -> B, C, D wait behind A's import

Fair (DRR):   A: [A A A A A A A A A A]
              B: [B]      worker takes 1 from each non-empty
              C: [C]      tenant per round -> B, C, D finish now
              D: [D]`,
      source: 'Azure Architecture Center — Noisy Neighbor antipattern; AWS Builders Library — shuffle sharding',
    },
  ],
  codeChallenges: [
    {
      id: 'misc-traffic-edge-cc-1',
      title: 'Graceful shutdown that actually drains',
      context:
        'A Node order API runs on Kubernetes behind an AWS ALB (idle timeout 60 s). Every rolling deploy produces a burst of 502/504s and a few orders are half-written. terminationGracePeriodSeconds is 30. The p99.9 request time is 4 s, but a CSV export endpoint can take up to 20 s.',
      task: 'Rewrite the startup/shutdown code so a deploy drops zero requests: traffic must stop arriving before the server stops accepting, in-flight requests must finish within a bounded time, idle keep-alive sockets must not be reset mid-reuse, and the process must exit before SIGKILL.',
      starter: {
        language: 'typescript',
        title: 'server.ts (naive)',
        code: `import http from 'node:http';
import { app } from './app';
import { pool } from './db';

const server = http.createServer(app);
server.listen(3000);

// readiness probe
app.get('/ready', (_req, res) => res.status(200).send('ok'));

process.on('SIGTERM', async () => {
  console.log('shutting down');
  server.close();          // stop accepting
  await pool.end();        // close DB pool right away
  process.exit(0);         // done
});`,
      },
      hints: [
        'When SIGTERM arrives, the pod is removed from Endpoints at the same moment — asynchronously. Who is still sending you traffic for the next few seconds?',
        'server.close() waits for connections to end, but process.exit(0) does not wait for server.close(). What happens to the requests that are still running, and to the DB queries they are making?',
        'Node keepAliveTimeout defaults to 5 s while the ALB reuses idle connections for up to 60 s. Which side should close idle sockets first?',
      ],
      solution: {
        language: 'typescript',
        title: 'server.ts (drains correctly)',
        code: `import http from 'node:http';
import { once } from 'node:events';
import { app } from './app';
import { pool } from './db';

const server = http.createServer(app);
// The ALB must close idle sockets first; otherwise Node closes one the ALB is reusing -> 502.
server.keepAliveTimeout = 65_000;       // > ALB idle timeout (60 s)
server.headersTimeout = 66_000;         // must exceed keepAliveTimeout
server.requestTimeout = 30_000;         // max time to RECEIVE a request (slow-loris guard), not handler time
server.listen(3000);

let draining = false;
app.get('/ready', (_req, res) => res.status(draining ? 503 : 200).send(draining ? 'draining' : 'ok'));

// Ask keep-alive clients to reconnect elsewhere once draining starts.
app.use((_req, res, next) => {
  if (draining) res.setHeader('Connection', 'close');
  next();
});

const PROPAGATION_MS = 10_000;          // endpoints + ALB target deregistration catch-up
const IN_FLIGHT_BUDGET_MS = 15_000;     // 10 + 15 = 25 s < 30 s grace period

process.once('SIGTERM', async () => {
  draining = true;                                     // readiness now fails
  await new Promise((r) => setTimeout(r, PROPAGATION_MS)); // keep serving while LBs catch up

  const hardStop = setTimeout(() => {
    console.error('drain budget exceeded, forcing exit');
    server.closeAllConnections();                      // Node >= 18.2
    process.exit(1);
  }, IN_FLIGHT_BUDGET_MS);
  hardStop.unref();

  server.close();                                      // stop accepting new connections
  server.closeIdleConnections();                       // idle keep-alives go now, not in 65 s
  await once(server, 'close');                         // resolves when in-flight requests finished
  await pool.end();                                    // only now is the DB no longer needed
  clearTimeout(hardStop);
  process.exit(0);
});`,
      },
      explanation: `**Fixes, in order of impact:**

- **Traffic arrives after SIGTERM.** Endpoint removal and SIGTERM race; kube-proxy, the ALB controller and the ALB target group take seconds to catch up. The solution keeps serving for a propagation window while readiness returns 503 (a \`preStop\` sleep is the equivalent without code). The starter closed the listener immediately, so the ALB's next request got a connection refused → 502.
- **process.exit(0) killed in-flight requests.** \`server.close()\` is asynchronous — it only stops accepting. The starter exited in the same tick, cutting off running requests, and \`pool.end()\` ran *before* those requests finished, so their queries failed mid-transaction (the half-written orders). Now the DB closes only after the server's \`close\` event.
- **Keep-alive mismatch.** With Node's default 5 s keepAliveTimeout behind a 60 s ALB idle timeout, Node closes sockets the ALB believes are reusable — the classic sporadic 502. Setting keepAliveTimeout above the ALB timeout (and headersTimeout above that) makes the ALB the side that closes idle connections.
- **Idle sockets delay shutdown.** \`closeIdleConnections()\` drops idle keep-alives at once (Node 19+ does this inside \`close()\`), and \`Connection: close\` on draining responses stops clients reusing active ones.
- **Bounded drain.** A hard-stop timer guarantees exit before the 30 s SIGKILL, with an explicit budget: 10 s propagation + 15 s in-flight < 30 s. Note that \`requestTimeout\` only bounds how long the client takes to *send* the request; it does not cap handler time. The 20 s export fits inside 10 + 15 s only if it starts before the drain — long exports belong in an async job, or the grace period must grow.
- **process.once** avoids running the handler twice on a repeated signal.`,
      followUps: [
        {
          "q": "The service also consumes from Kafka in the same process. How does that change the shutdown sequence?",
          "a": "Add the consumer to the drain. On SIGTERM, after readiness fails: stop fetching new messages (`consumer.pause()` or stop the run loop), let in-flight message handlers finish within the budget, commit their offsets, then `consumer.disconnect()`, which leaves the group immediately so partitions are reassigned without waiting for a session timeout. Order: HTTP drain and consumer drain can run in parallel, but the DB pool closes only after both finish. Include the consumer's longest handler in the 15 s budget; with long handlers, shorten them or rely on idempotency so a cut-off message is safely reprocessed by the next owner."
        },
        {
          "q": "How do you prove in CI or staging that a deploy drops zero requests?",
          "a": "Run a continuous load generator (k6 at production-like RPS, including keep-alive connections and some 15–20 s export requests) against the service behind a real ALB in staging, then trigger a rolling deploy. Assert zero non-2xx responses and zero connection errors in the k6 results and ALB access logs (no 502 or 504 with `target_status_code = -`), every export completes, and no pod is SIGKILLed (check events for `Killing` after the grace period and exit codes 137). Make it a pipeline gate for infrastructure changes such as Node upgrades, ALB settings or grace periods, since those silently break draining."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-cc-2',
      title: 'Per-tenant concurrency limiter for a shared API',
      context:
        'A multi-tenant reporting API (NestJS on Express) has 40 pods, each with a pg pool of 20 connections. When one tenant runs 300 dashboards at once, every other tenant times out. A teammate added the middleware below. It made things worse: small tenants now get 429s during the big tenant\'s spike, and after a day the limiter rejects nearly everything.',
      task: 'Fix the middleware so that one tenant can hold at most a bounded share of each pod\'s capacity, small tenants are never starved by a large one, slots are never leaked, the tenant cannot be spoofed, and rejected clients know when to retry.',
      starter: {
        language: 'typescript',
        title: 'tenant-limit.middleware.ts (naive)',
        code: `import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

const MAX_IN_FLIGHT = 20;          // matches pool size
let inFlight = 0;                  // shared by all tenants

@Injectable()
export class TenantLimitMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const tenant = req.header('x-tenant-id') ?? 'anonymous';
    if (inFlight >= MAX_IN_FLIGHT) {
      res.status(429).json({ error: 'busy', tenant });
      return;
    }
    inFlight++;
    res.on('finish', () => {       // release when the response is sent
      inFlight--;
    });
    next();
  }
}`,
      },
      hints: [
        'Who is counted against the limit today — the tenant, or everybody? What does that do to a small tenant arriving during the spike?',
        'finish is not emitted when the client disconnects before the response is written. What happens to the counter then?',
        'Where does the tenant id come from, and what stops a caller from claiming to be a different tenant on every request?',
      ],
      solution: {
        language: 'typescript',
        title: 'tenant-limit.middleware.ts (fair, leak-free)',
        code: `import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

const POD_CAPACITY = 20;             // = pg pool size on this pod
const PER_TENANT_MAX = 6;            // one tenant may hold at most 30% of the pod
const RESERVED_FOR_OTHERS = 4;       // never let the busiest tenant take the last slots

const inFlight = new Map<string, number>();
let total = 0;

@Injectable()
export class TenantLimitMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Set by the auth guard from the verified JWT claim, never from a client header.
    const tenant = (req as Request & { auth?: { tenantId: string } }).auth?.tenantId;
    if (!tenant) {
      res.status(401).end();
      return;
    }

    const mine = inFlight.get(tenant) ?? 0;
    const isHeavy = mine >= PER_TENANT_MAX - 2; // close to its own cap
    const podFull = total >= POD_CAPACITY;
    const reserveHit = isHeavy && total >= POD_CAPACITY - RESERVED_FOR_OTHERS;
    if (mine >= PER_TENANT_MAX || podFull || reserveHit) {
      res.setHeader('Retry-After', '1');
      res.status(429).json({ error: 'tenant_concurrency_exceeded' }); // no tenant echoed back
      return;
    }

    inFlight.set(tenant, mine + 1);
    total++;
    let released = false;
    const release = () => {
      if (released) return;               // finish and close can both fire
      released = true;
      total--;
      const n = (inFlight.get(tenant) ?? 1) - 1;
      if (n <= 0) inFlight.delete(tenant); // keep the map bounded by active tenants
      else inFlight.set(tenant, n);
    };
    res.once('finish', release);           // normal completion
    res.once('close', release);            // client aborted / socket destroyed
    next();
  }
}`,
      },
      explanation: `**What was wrong and how it is fixed:**

- **A global counter is not tenant isolation.** The starter shared one counter across tenants, so the noisy tenant filled all 20 slots and small tenants got the 429s — the opposite of the goal. The fix tracks in-flight work per tenant with a per-tenant cap (6 of 20), plus a reserve so a tenant near its cap cannot take the last 4 slots. Small tenants always find a slot unless the whole pod is genuinely full.
- **Leaked slots.** \`finish\` does not fire when the client disconnects early (timeouts, mobile drop-offs), so the counter drifted up until the limiter rejected everything. Releasing on \`close\` as well, guarded by a \`released\` flag so it runs exactly once, makes release reliable.
- **Spoofable tenant.** \`x-tenant-id\` is client-controlled: a noisy tenant could rotate fake ids to dodge its cap, or impersonate a victim to use up the victim's cap. The tenant now comes from the verified token set by the auth guard; missing identity is a 401 rather than a shared "anonymous" bucket.
- **Retry guidance.** 429 with \`Retry-After\` lets well-behaved clients back off instead of hammering. The body no longer echoes internal identifiers.
- **Bounded memory.** Entries are deleted at zero, so the map holds only currently active tenants.

**Why concurrency, not rate:** dashboard queries vary from 20 ms to 8 s; a requests-per-second limit would let a tenant hold every connection with a few slow queries. Capping in-flight work caps pool-connection share directly. Across 40 pods, this gives a tenant at most 6 × 40 = 240 concurrent queries — pair it with a gateway-level quota and a per-tenant statement timeout for the fleet-wide bound.`,
      followUps: [
        {
          "q": "A tenant legitimately needs more capacity: an enterprise tenant paying for 3× throughput. How do you extend the limiter?",
          "a": "Make limits per tenant tier, not constants: load `PER_TENANT_MAX` from the tenant's plan (free 2, pro 6, enterprise 12) via a cached config lookup keyed by tenant id. Use weighted fair sharing: when the pod is contended, divide capacity in proportion to tier weights, so an enterprise tenant gets a bigger share without starving others. Keep the reserve for others. Enterprise tenants with very large needs are better served by a dedicated cell or pod pool, which is the cleanest isolation and is often in the contract. Track per-tenant 429 rates so sales and support see when a tenant consistently hits its cap."
        },
        {
          "q": "How do you test that slots never leak under client aborts and errors?",
          "a": "Write an integration test with supertest or a raw HTTP client: send 1,000 requests from several tenants where a third abort mid-request (destroy the socket after 50 ms), a third trigger handler errors (500), and a third succeed, with random delays. After everything settles, assert `total === 0` and `inFlight.size === 0`. Export these as metrics in production too: a gauge for total and per-tenant in-flight, with an alert if total is above 0 while the request rate is 0 for 5 minutes, which is the exact signature of the leak that made the original limiter reject everything."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'misc-traffic-edge-iq-01',
      difficulty: 'medium',
      question:
        'Forty Envoy sidecars call 12 replicas of a search service. Some queries take 5 ms, some 250 ms. Which balancing algorithm do you configure, and why not plain round robin or least-connections?',
      whatInterviewerLooksFor: [
        'Knows round robin assumes uniform request cost',
        'Recognises that each sidecar only sees its own slice of in-flight requests',
        'Names power of two choices (P2C) and why it avoids herding',
        'Adds outlier detection and slow start without being prompted',
      ],
      modelAnswer: `**Pick: least-request with power of two choices (P2C)** — Envoy's LEAST_REQUEST default samples 2 random hosts and sends to the one with fewer active requests.

**Why not round robin:** with a 50× spread in request cost, RR hands the same count to every replica, so the unlucky replica that drew several 250 ms queries builds a queue while others idle. Tail latency follows the worst queue.

**Why not full least-connections:** each of the 40 sidecars only knows the requests *it* sent — about 1/40 of each backend's real load. If every sidecar picks the global minimum from its own stale view, they all pile onto the same "idle" replica at once (herding), then all leave it. P2C adds randomness: two random samples are enough to cut the maximum load from O(log n / log log n) to O(log log n) while never synchronising the proxies.

**What I add around it:**
- **Outlier detection** — eject after 5 consecutive 5xx; a replica failing fast would otherwise look least loaded.
- **Slow start** — ramp new replicas over 30–60 s so cold caches and JIT don't take a full share.
- **Latency-aware option** — if replicas are heterogeneous (mixed instance types), EWMA-of-latency (Linkerd, Finagle) reacts to slowness, not just queue length.`,
      followUps: [
        {
          q: 'What if there is only one client proxy instead of 40?',
          a: 'Then its view of in-flight requests is complete, and exact least-request is fine — herding is a multi-balancer problem. P2C still works nearly as well, so it is a safe default either way.',
        },
        {
          q: 'Some replicas run on 2× larger nodes. How does that change things?',
          a: 'Use weights (Envoy scales active-request counts by weight) or a latency-aware algorithm. Equal-weight least-request would under-use the big nodes only slightly, but RR would overload the small ones.',
        },
      ],
      pitfalls: [
        'Saying "least-connections" for HTTP/2 or gRPC, where one connection carries many requests — the right unit is active requests.',
        'Ignoring that fast-failing hosts attract traffic under load-aware algorithms.',
        'Treating the choice as purely theoretical without mentioning slow start for new pods.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-02',
      difficulty: 'expert',
      question:
        'Design a regional Layer-4 load-balancer service similar to AWS Network Load Balancer: millions of flows per second, static IPs, no single box that can take down traffic, and backends that come and go.',
      context:
        'Reported as a system design question asked at Amazon ("Design a Load Balancer" — a service like AWS NLB). Focus on the data plane and control plane of the load balancer itself, not on the app behind it.',
      whatInterviewerLooksFor: [
        'Separates data plane (packet forwarding) from control plane (config, health, membership)',
        'Uses ECMP or anycast to spread flows across many LB nodes, removing the single box',
        'Keeps a flow pinned to one backend even when LB nodes change (consistent hashing plus connection tracking)',
        'Explains health checking, draining and how configuration propagates safely',
        'Gives throughput numbers and failure behaviour',
      ],
      modelAnswer: `**Shape**

- **Front:** each static IP is announced by BGP from many LB nodes; routers spread flows across them with **ECMP** (hash of the 5-tuple). No active/passive pair, so no single box.
- **Data plane per node:** a userspace packet processor (DPDK/XDP) looks up the flow's backend and forwards it — with encapsulation (GRE/GUE) or NAT. Tens of Gbps and several million pps per node, a few µs added.
- **Control plane:** a config service holds listeners, target groups and weights; a health-check fleet probes targets; both push versioned snapshots to every node.

**Flow stickiness — the hard part**

When ECMP membership changes (an LB node added or failed), routers rehash and some flows land on a *different* LB node. That node must pick the **same backend**, or the TCP connection breaks. Two mechanisms together:
1. **Consistent hashing on the 5-tuple** (a Maglev-style lookup table, e.g. 65,537 entries) so every node computes the same backend from the same backend set.
2. **Local connection tracking** so existing flows stay on their backend even when the backend set changes; new flows use the new table.

**Health and draining**

Health checks from several vantage points; a target leaves the table only on a quorum, which avoids flapping. Deregistration marks the target "draining": no new flows, and existing flows are tracked until they close or the delay (default 300 s) ends.

**Safety**

Config pushes are staged by cell/AZ with automatic rollback on error-rate regression. Nodes keep the last good snapshot if the control plane is down — **static stability**: the data plane keeps forwarding without the control plane.

**Client IP:** forwarding (not proxying) preserves the source IP; when proxying is needed, PROXY protocol v2 carries it.

**Numbers:** 5M new flows/s at ~3M pps per node → about 10 nodes per AZ for the average plus 2× headroom for the region, and an AZ loss tolerated by cross-zone spill.`,
      followUps: [
        {
          q: 'Why not just a pair of big boxes with a floating IP (VRRP)?',
          a: 'Vertical limits (one box caps throughput), a failover gap that breaks every connection, and half the capacity idle. ECMP scale-out tolerates node loss with only a fraction of flows rehashed — and consistent hashing keeps even those alive.',
        },
        {
          q: 'How do you support UDP, which has no connection close?',
          a: 'Track flows with idle timeouts (tens of seconds for DNS-like traffic, longer for QUIC), and for QUIC hash on the connection ID rather than the 5-tuple so client IP changes do not move the flow.',
        },
        {
          q: 'What happens if the health-check fleet itself partitions from the backends?',
          a: 'Require a quorum of checkers before removing a target and fail open (keep routing to all) if too many targets look down at once — the same idea as a panic threshold.',
        },
      ],
      pitfalls: [
        'Designing an L7 proxy (parsing HTTP) when the question is L4.',
        'Forgetting what happens to existing connections when LB nodes are added or removed.',
        'Making the data plane depend on a live control plane for every packet.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-03',
      difficulty: 'medium',
      question:
        'Your default is an L7 load balancer for HTTP services. Name the situations where you would deliberately put an L4 balancer in front of an HTTP API instead, and what you give up.',
      whatInterviewerLooksFor: [
        'Concrete reasons: TLS passthrough / end-to-end mTLS, static IPs, raw throughput or DDoS absorption, non-HTTP protocols on the same port',
        'Knows how client IP survives an L4 hop (preserve IP or PROXY protocol)',
        'States what is lost: per-request routing, HTTP/2 stream balancing, retries, header-based canaries',
      ],
      modelAnswer: `**Pick L4 when:**
- **The TLS must not be terminated by the balancer** — regulated partners that require end-to-end mTLS to the workload, or client-certificate pinning. L4 passes the TLS stream through untouched.
- **Clients need static IPs to allow-list** — AWS NLB gives one Elastic IP per AZ; an ALB's IPs change.
- **Very high connection rates or volumetric protection** — L4 forwards millions of packets per second per node with microseconds added and no TLS CPU.
- **Mixed protocols** — MQTT, raw TCP or custom binary protocols next to HTTP.

**What I give up:**
- Path/header routing, canary by header, auth and WAF at the balancer.
- Per-request balancing: an HTTP/2 or gRPC connection is pinned to one backend for its lifetime, so long-lived multiplexed clients can skew load.
- Retries and HTTP-aware health checks (TCP connect can succeed on a deadlocked app).

**Client IP:** preserved when the LB forwards rather than proxies, otherwise sent via PROXY protocol v2, which the backend must be configured to parse.

**Usual compromise:** L4 at the edge for static IPs and passthrough, then an L7 tier (Envoy/nginx) that the team controls, terminating TLS inside the trusted boundary.`,
      followUps: [
        {
          q: 'An L4 health check passes but users get errors. How?',
          a: 'A TCP connect check only proves the port is open. A wedged event loop, a failed DB pool or a broken dependency still accepts connections. Use an HTTP health check against a real readiness endpoint, even behind L4.',
        },
        {
          q: 'How do you fix gRPC load skew behind L4 without switching to L7?',
          a: 'Client-side balancing (gRPC with DNS or xDS resolving all pod IPs), or cap connection age on the server (MAX_CONNECTION_AGE) so clients periodically reconnect and rebalance.',
        },
      ],
      pitfalls: [
        'Claiming L4 is "more secure" by itself.',
        'Assuming the app sees the client IP behind any LB without PROXY protocol or header config.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-04',
      difficulty: 'hard',
      question:
        'A banking partner requires mutual TLS terminating on your workload, not on a shared cloud balancer. Product also wants path-based routing to three services and per-partner rate limits. L4 or L7 — and how do you satisfy both requirements?',
      whatInterviewerLooksFor: [
        'Clarifies what "terminating on your workload" means for compliance',
        'Designs L4 passthrough to a self-managed L7 tier the company controls',
        'Maps partner identity from the client certificate to rate-limit keys',
        'Handles certificate lifecycle and client-IP preservation',
      ],
      modelAnswer: `**Clarify first:** the partner usually objects to a *third party* (the cloud's managed L7) seeing plaintext, not to a proxy we run inside our boundary. Confirm that "our workload" can be our own ingress tier with keys in our KMS/HSM.

**Design: L4 passthrough → our own L7 (Envoy) → services**

- **Edge: NLB in TCP/TLS-passthrough mode** on 443 with static IPs the partner allow-lists. It never sees plaintext and preserves the source IP.
- **Ingress tier: Envoy on dedicated nodes** terminates mTLS with our server cert, validates the partner's client cert against a pinned partner CA, and checks revocation (OCSP stapling or a short-lived cert policy).
- **Identity:** extract the partner ID from the cert's SAN (for example \`spiffe://partners/acme\`) and put it into a header that Envoy **strips from inbound requests first**, so it cannot be forged.
- **Routing:** path-based routes to the three services, with re-encrypted mTLS inside the mesh.
- **Rate limits:** Envoy's global rate-limit filter keyed by partner ID from the cert, not by IP (partners egress through NAT pools that change).

**Operational concerns**
- **Cert rotation:** partners' certificates expire on their schedule — alert 30 days ahead, and support two trusted client CAs during overlap.
- **Scaling the TLS tier:** mTLS handshakes cost ~1–2 ms CPU each with RSA-2048 (ECDSA is cheaper); keep-alive plus session resumption keeps the handshake rate low.
- **Blast radius:** a dedicated partner ingress, separate from the consumer edge, so a consumer traffic spike or misconfig does not affect bank traffic.

**Why not pure L4:** no path routing, no per-partner limits. **Why not managed L7:** violates the termination requirement.`,
      followUps: [
        {
          q: 'Can an L4 balancer route by hostname without terminating TLS?',
          a: 'Yes, by reading the SNI in the ClientHello (Envoy tls_inspector, nginx ssl_preread). That allows host-based but not path-based routing, and it does not work if the client uses Encrypted Client Hello.',
        },
        {
          q: 'How does the backend service know which partner called it?',
          a: 'From the header the ingress sets after cert validation, or better from the mesh identity plus a signed internal token minted by the ingress. Services must never accept that header from outside the mesh.',
        },
      ],
      pitfalls: [
        'Terminating on the managed ALB and re-encrypting, which breaks the stated requirement.',
        'Rate-limiting partners by IP.',
        'Passing identity in a header without stripping client-supplied copies.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-05',
      difficulty: 'medium',
      question:
        'What is connection draining, and how would you choose the deregistration delay for a service whose p99.9 latency is 3 seconds?',
      whatInterviewerLooksFor: [
        'Defines draining as stop-new, finish-in-flight, then remove',
        'Sizes the delay from request duration plus propagation, not the default',
        'Knows the app must cooperate (readiness, keep-alive handling)',
        'Mentions the deploy-speed cost of an oversized delay',
      ],
      modelAnswer: `**Definition:** when a target leaves a load balancer (deploy, scale-in, maintenance), the LB stops sending it *new* requests but lets *existing* ones finish, up to a timeout. After the timeout, remaining connections are cut.

**Sizing:** delay ≈ worst legitimate request + propagation slack.
- p99.9 is 3 s, and the absolute timeout on the route is, say, 10 s → drain window **~15–20 s**.
- The AWS default is **300 s**. With 60 pods and 25% max surge, a rolling deploy runs about 4 waves; at 300 s each that is ~20 minutes of waiting versus ~1–2 minutes at 20 s.

**The app has to cooperate:**
- Fail readiness (or preStop sleep ~10 s) before stopping the listener, because LB deregistration and SIGTERM race.
- Close idle keep-alive connections and send \`Connection: close\` (HTTP/2: GOAWAY) so clients move.
- Keep terminationGracePeriodSeconds larger than the preStop sleep plus the drain window, or Kubernetes SIGKILLs mid-drain.

**Exception:** long-lived connections (WebSockets, streaming) are not drained by waiting; they need an explicit reconnect signal.`,
      followUps: [
        {
          q: 'What happens if the drain window is shorter than your slowest request?',
          a: 'Those requests are cut: the client sees a reset or a 502/504, and if the handler was halfway through a non-idempotent write, you get partial work. Either extend the window or move long work to async jobs.',
        },
        {
          q: 'Does draining help with a crashed pod?',
          a: 'No. Draining is for planned removal. A crash is handled by health checks and passive outlier detection, and in-flight requests on it are lost — client retries on idempotent calls cover it.',
        },
      ],
      pitfalls: [
        'Leaving the 300 s default and wondering why deploys are slow.',
        'Assuming the LB alone guarantees zero errors without app-side graceful shutdown.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-06',
      difficulty: 'expert',
      question:
        'A notification service holds 2M WebSocket connections on 50 pods. Every rolling deploy, the auth service gets a reconnect storm, p99 on login climbs to 6 s and some clients give up. The team already set a 300 s deregistration delay. Redesign how this fleet drains.',
      whatInterviewerLooksFor: [
        'Explains why waiting does not drain long-lived connections',
        'Quantifies the reconnect rate per wave and its effect on auth',
        'Uses server-initiated, jittered reconnects spread over a window',
        'Makes reconnects cheap (resumption tokens) and protects auth with capacity or limits',
        'Changes the deploy shape (smaller waves, surge capacity)',
      ],
      modelAnswer: `**Why the 300 s delay does not help:** a WebSocket does not "finish". The drain simply waits 300 s and then cuts all ~40K connections on the pod at once. Those clients reconnect in the same second.

**Size the storm:** 2M / 50 pods = 40K connections per pod. Rolling with maxUnavailable 5 pods → 200K clients reconnect within a few seconds. If each reconnect does a full login (JWT refresh + session lookup at ~5 ms of auth CPU), that is 1,000 CPU-seconds in a burst — far past the auth fleet's headroom, hence the 6 s p99 and client give-ups.

**Redesign**

1. **Server-initiated, spread-out close.** On SIGTERM the pod fails readiness, then sends each client a "reconnect" control frame over a window (for example 120 s), picking a random delay per connection. 40K over 120 s ≈ 330 reconnects/s per pod instead of 40K at once.
2. **Client jitter and backoff.** Clients wait random(0, 5 s) before reconnecting after a close frame, and use exponential backoff with full jitter on failures, so retries do not synchronise.
3. **Cheap reconnect.** Hand out a short-lived signed **resume token** (for example 10 minutes) that the gateway verifies locally without the auth service. It carries user ID, device and last delivered message offset, so the new pod resumes delivery without a login round-trip and without losing messages.
4. **Deploy shape.** Surge instead of unavailability (maxSurge 10%, maxUnavailable 0), so new pods have capacity before old ones close; fewer pods per wave.
5. **Protect auth anyway.** A concurrency limit on the login path with 503 + Retry-After, so overload degrades into short delays instead of timeouts.
6. **Watch it:** reconnects/s, time-to-resume, messages redelivered, auth p99 — an SLO for "deploy impact".

**Result:** reconnect rate becomes 200K spread over ~2 minutes ≈ 1.7K/s fleet-wide, mostly token verifications at microseconds each — auth sees nearly nothing.`,
      followUps: [
        {
          q: 'How do you avoid losing notifications sent while a client is reconnecting?',
          a: 'Per-user sequence numbers and a short buffer (Redis stream or Kafka offset per user) — the client sends its last seen sequence on resume, and the new pod replays anything newer.',
        },
        {
          q: 'What if a node crashes rather than being deployed?',
          a: 'No graceful spread is possible, so the client-side jitter and cheap token resume carry the load. That is why the client behaviour matters even more than the server drain.',
        },
      ],
      pitfalls: [
        'Increasing the deregistration delay further.',
        'Adding client retries without jitter, which synchronises the herd.',
        'Forgetting that every reconnect is also an auth and state-rebuild event.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-07',
      difficulty: 'medium',
      question:
        'Ring with virtual nodes, rendezvous hashing, or jump consistent hash: which would you use for (a) a Redis-like cache fleet where random nodes fail, and (b) a sharded counter store that only ever grows by adding shards? Justify.',
      whatInterviewerLooksFor: [
        'Knows jump hash only supports adding/removing the highest-numbered bucket',
        'Knows rendezvous gives minimal movement and easy weights at O(N) per lookup',
        'Knows vnodes reduce variance and act as weights',
        'Ties the choice to how membership changes in each system',
      ],
      modelAnswer: `**(a) Cache fleet with random failures → ring with vnodes, or rendezvous.**
- Nodes disappear from the *middle* of the set. Both a vnode ring and rendezvous move only the dead node's keys (≈1/N), spread across the survivors.
- **Ring + ~100–200 vnodes per node:** O(log V) lookup via binary search, standard vnode count gives ±10% balance, vnode count doubles as weight.
- **Rendezvous (highest random weight):** for each key, hash(key, node) for every node and take the max — no ring to maintain, naturally weighted, simple to reason about. At 20–50 nodes the O(N) cost is negligible; at thousands of nodes use the ring.

**(b) Growing sharded store → jump consistent hash.**
- Jump hash maps a key to bucket 0..N−1 in O(ln N) time, zero memory, and near-perfect balance. Growing N → N+1 moves exactly the ~1/(N+1) of keys that belong to the new shard.
- Its limit — you can only remove the *last* bucket — does not matter here, because shards are logical and are replicated for failure handling rather than removed.

**Common trap:** using jump hash for a cache fleet. When node 7 of 20 dies you cannot renumber without shifting almost everything after it; you would need an extra indirection layer.`,
      followUps: [
        {
          q: 'How do you add weights to jump hash?',
          a: 'Not natively. You map several buckets to a bigger machine (logical shards), which is the same trick as vnodes.',
        },
        {
          q: 'Which hash function?',
          a: 'A fast, well-mixed non-crypto hash (xxHash, MurmurHash3). Avoid language default hashCode functions that are weak or randomised per process, because every client must agree.',
        },
      ],
      pitfalls: [
        'Answering "consistent hashing" as if it were a single algorithm.',
        'Missing jump hash\'s last-bucket-only constraint.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-08',
      difficulty: 'hard',
      question:
        'Your 16-node cache tier uses a consistent hash ring with 256 vnodes per node. Key counts per node differ by under 5%, yet one node runs at 90% CPU and 3× the network of the others during peak. What is going on and what are your options?',
      whatInterviewerLooksFor: [
        'Separates balance of keys from balance of traffic',
        'Diagnoses hot keys with evidence (per-key sampling, hot-key detection)',
        'Offers several fixes with trade-offs: local near-cache, key replication/splitting, bounded-load hashing',
        'Considers consistency and invalidation of replicated hot keys',
      ],
      modelAnswer: `**Diagnosis:** consistent hashing balances *how many keys* each node owns, not *how often* they are read. A skewed access pattern (Zipf — a trending product, a config blob every request reads, a celebrity's profile) puts a few very hot keys on one node. Confirm with per-key sampling: \`redis-cli --hotkeys\` (LFU policy), proxy-side top-k, or sampled access logs. Expect a handful of keys at 50–100K ops/s.

**Options, cheapest first**

1. **In-process near-cache for the hottest keys** — a 1–5 s TTL LRU in each app pod. 500 pods × 1 fetch per 2 s = 250 req/s to the cache instead of 100K. Cost: up to TTL of staleness, so it suits read-mostly data.
2. **Replicate hot keys** — write the key as key#1..key#k on k different nodes and read a random copy. Spreads read load k ways; writes and invalidation now touch k keys.
3. **Split large values** — a 2 MB hot blob costs network more than CPU; break it into fields or compress so each read moves less.
4. **Bounded-load consistent hashing** — cap each node at (1+ε)× average *load*; overflow goes to the next node on the ring. Good when load is request-routed (proxies, sticky workloads). Less useful for a cache, because a key served from its non-home node is a miss there.
5. **Read replicas per shard** — Redis Cluster replicas can serve reads (READONLY), doubling read capacity of that shard with async-replication staleness.

**What I would do:** near-cache for the known hot set (top 100 keys by sampled rate), automatic hot-key detection that promotes keys above a threshold, and alerting on per-node ops imbalance, not just memory.`,
      followUps: [
        {
          q: 'Why not just add more nodes?',
          a: 'A single key lives on one node regardless of cluster size, so more nodes do nothing for the hot key; it only dilutes the rest.',
        },
        {
          q: 'How do you invalidate a near-cached key quickly when it changes?',
          a: 'Pub/sub invalidation (Redis client-side caching with tracking, or a channel the pods subscribe to), with the short TTL as a backstop if a message is lost.',
        },
      ],
      pitfalls: [
        'Increasing the vnode count, which only fixes key-count imbalance.',
        'Resharding without first identifying the hot keys.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-09',
      difficulty: 'medium',
      question:
        'In a design interview you drew a load balancer, an API gateway and a service mesh. The interviewer asks: justify each box — what does each do that the others should not, and when would you collapse them?',
      whatInterviewerLooksFor: [
        'LB = distribute and health-check; gateway = north-south policy by identity/product; mesh = east-west mTLS, retries, telemetry',
        'Knows when one box suffices (small system, managed gateway with built-in LB)',
        'Avoids duplicating retries/timeouts at every layer',
      ],
      modelAnswer: `**Load balancer:** spreads connections/requests over healthy instances, terminates TLS at scale, gives static entry points. It does not know who the caller is or what product rules apply.

**API gateway (north-south):** decides *whether and where* an external request may go: authentication (JWT/API key), per-consumer quotas and plans, routing and versioning, request size limits, CORS, sometimes request/response transformation. It is the public API's contract enforcer.

**Service mesh (east-west):** service-to-service mTLS identities, retries with budgets, timeouts, circuit breaking and uniform telemetry — the traffic *between* services that never touches the edge.

**Collapse when:**
- A small system with one or two services: one managed gateway (or an ALB with auth rules) is both LB and gateway. The usual advice is to draw one box unless the design needs more.
- No east-west complexity (few services, one language) → no mesh; use a shared HTTP client library with timeouts.

**Keep separate when:** public APIs with plans and partners (gateway), dozens of services with zero-trust requirements (mesh), and very high edge traffic where an L4/L7 LB fleet fronts the gateway fleet.

**Rule:** one layer owns retries per hop, so the gateway and mesh do not multiply them.`,
      followUps: [
        {
          q: 'Can the mesh ingress replace the API gateway?',
          a: 'Partly — Istio/Envoy ingress can route and validate JWTs. What it usually lacks is API product management: developer keys, plans, quota billing, a portal. Many teams run a gateway on top of mesh ingress for that.',
        },
        {
          q: 'Where do you validate JWTs — gateway or service?',
          a: 'Both, cheaply: the gateway rejects bad tokens early, and services validate again (local JWKS) for defence in depth. Authorization on resources stays in the service.',
        },
      ],
      pitfalls: [
        'Treating gateway and load balancer as synonyms.',
        'Putting business rules or data aggregation in the gateway.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-10',
      difficulty: 'hard',
      question:
        'You are moving from REST to a federated GraphQL supergraph: an Apollo-style router at the edge, eight subgraphs owned by different teams. Where do authentication, authorization, rate limiting and timeouts live now, and what changes compared with a REST gateway?',
      whatInterviewerLooksFor: [
        'Authentication at the router, authorization at the subgraph/field level',
        'Rate limiting by operation cost rather than request count',
        'Persisted queries / operation allow-lists for public clients',
        'Per-subgraph timeouts and partial results instead of one gateway timeout',
        'Awareness that the router is a single shared blast radius',
      ],
      modelAnswer: `**What changes:** with REST, the gateway sees one path per resource, so policy per route is natural. With GraphQL, every request is \`POST /graphql\` and one operation can touch eight subgraphs. Route-level policy stops meaning anything.

**Authentication — router.** Validate the JWT once (local JWKS), then pass verified claims to subgraphs in a signed internal header or context. Strip any client-supplied copies.

**Authorization — subgraph, at field/entity level.** Only the owning team knows that \`Order.refundAmount\` needs the finance role. Directive-based checks (for example an \`@requiresScopes\` style directive) can be enforced by the router for coarse scopes, but row-level decisions ("is this your order?") stay in the subgraph resolvers.

**Rate limiting — by cost.** Compute a static cost before execution (fields × list-size arguments, depth), reject above a per-operation max (for example 5,000 points), and debit a per-client budget in Redis (for example 100K points/hour). Record actual cost afterwards for tuning. Also cap depth and aliases, because aliasing multiplies the same field.

**Persisted queries for first-party apps.** Clients send an operation hash; the router only executes registered operations. That removes arbitrary query abuse, makes CDN caching of GET-persisted queries possible, and gives stable operation names for per-operation metrics and limits.

**Timeouts — per subgraph.** A 300 ms budget to reviews, 800 ms to inventory; on timeout, return partial data with errors for that field, instead of one 30 s gateway timeout failing the whole screen.

**Blast radius:** the router is now shared by every team. Schema composition checks in CI, canary router deploys and a query-plan cache keep one team's bad schema from breaking all clients.`,
      followUps: [
        {
          q: 'How do you rate-limit a partner who uses the public schema with ad-hoc queries?',
          a: 'Cost-based budgets plus a lower max cost per operation for untrusted clients, and expose the remaining budget in the response (GitHub returns a rateLimit object with cost and remaining points).',
        },
        {
          q: 'Should the router cache responses?',
          a: 'Only whole-response caching of public persisted queries (via GET + CDN) or entity caching with explicit per-type TTLs. Per-user data needs private scope keys or no caching.',
        },
      ],
      pitfalls: [
        'Keeping a request-count limit on POST /graphql as the main protection.',
        'Doing all authorization at the router with no subgraph checks.',
        'One global timeout for the whole operation.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-11',
      difficulty: 'medium',
      question:
        'You have implemented a token-bucket rate limiter. The interviewer asks: when is a per-client rate limit the wrong tool, and what would you use instead — a concurrency limiter or a load shedder?',
      context:
        'Stripe candidates frequently report being asked to implement a rate limiter (candidate reports). This follow-up probes the difference between the limiters Stripe describes in its engineering blog.',
      whatInterviewerLooksFor: [
        'Rate limit counts arrivals; concurrency limit counts in-flight work',
        'Load shedding is global and priority-based, independent of per-client quotas',
        'Can give an example where each is needed',
      ],
      modelAnswer: `**Rate limiter (requests per window, per client):** protects fairness and commercial plans. It assumes requests cost roughly the same.

**Where it is the wrong tool:**
- **Variable-duration work.** A client within 100 req/s can still hold 100 × 10 s = 1,000 concurrent slow requests (reports, searches), exhausting threads or DB connections. → **Concurrency limiter**: at most N in-flight per client (Stripe describes a concurrent-requests limiter for exactly this reason — a small number of expensive requests was hurting the fleet).
- **Everyone is within quota but the total is too much** — a regional failover, a marketing spike. Per-client limits do not fire. → **Load shedder**: global, based on server health (CPU, queue depth, in-flight), which drops *low-priority* traffic first (for example analytics or non-critical GETs before charges). Stripe's variants: a fleet-usage shedder reserving capacity for critical requests, and a worker-utilization shedder that sheds by priority tier.
- **Unknown safe capacity** — use an **adaptive concurrency limit** (Netflix concurrency-limits, Envoy adaptive concurrency) that follows latency, like TCP congestion control.

**Answer shape:** rate limits at the gateway per API key, concurrency limits per client on expensive endpoints, and a global load shedder with priorities as the last line of defence.`,
      followUps: [
        {
          q: 'Which status codes?',
          a: '429 with Retry-After for per-client limits (the client did something it can fix); 503 with Retry-After for load shedding (the server is overloaded, not the client\'s fault).',
        },
        {
          q: 'How do you roll out a new limit safely?',
          a: 'Shadow mode: evaluate and log would-be rejections per key for a week, contact the affected customers, then enforce gradually per tier.',
        },
      ],
      pitfalls: [
        'Treating rate limiting and load shedding as the same mechanism.',
        'Returning 429 for server overload, which makes clients think their own behaviour is at fault.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-12',
      difficulty: 'expert',
      question:
        'Your public GraphQL API has a 1,000 requests/hour limit per token. A single integration keeps the database at 80% CPU while staying well under that limit. Design a cost-based rate limiting system that fixes this without breaking existing integrations.',
      whatInterviewerLooksFor: [
        'Static cost analysis before execution using list-size arguments and depth',
        'Budget storage and atomic debit, with reconciliation of actual cost',
        'Client-visible cost and remaining budget, plus a migration path',
        'Handles aliases, fragments, unbounded lists and introspection',
      ],
      modelAnswer: `**Why request counting fails:** one query like repositories(first:100){issues(first:100){comments(first:100)}} is "1 request" but up to 1M node loads. Query cost varies by 4–6 orders of magnitude.

**1. Static cost before execution**
- Parse and validate, then walk the AST: each object field costs 1; a connection multiplies its children by its \`first/last\` argument; scalars are free.
- **Require** a page size on every list and cap it (for example 100), otherwise the cost is unbounded.
- Expand fragments and count **aliases** — ten aliases of the same expensive field are ten times the cost.
- Enforce a max per operation (for example 5,000 points) and max depth (for example 10). Reject over-limit queries with a clear error before any resolver runs.

**2. Budget per token**
- Leaky or token bucket of points: for example 50,000 points/hour with refill proportional to time (Shopify uses a bucket of calculated cost that restores at a fixed points/second rate).
- Debit the *estimated* cost atomically in Redis (Lua script: refill, check, debit) before execution.
- After execution, compute the **actual cost** (lists often return fewer items than requested) and refund the difference — clients are not punished for asking for 100 when 3 exist.

**3. Visibility**
- Return cost in the response extensions: requested cost, actual cost, remaining, reset time (GitHub exposes a rateLimit object). Clients can then self-pace.

**4. Migration without breakage**
- Shadow mode for 2–4 weeks: compute costs, log per-token peak usage, set budgets so 99% of current tokens fit.
- Contact the top offenders, offer bulk export or webhooks for their use case.
- Enforce per tier, first on new tokens, then everyone.

**5. Beyond the limiter**
- Resolver-level concurrency limits and DataLoader batching to keep actual cost close to estimate.
- Per-token DB statement timeouts so one expensive query cannot run for minutes.`,
      followUps: [
        {
          q: 'What about mutations that trigger heavy background work?',
          a: 'Give them explicit fixed costs (for example 10 points) plus separate per-mutation rate limits, because their real cost is in the async work, not the resolver.',
        },
        {
          q: 'How do persisted queries change this?',
          a: 'Cost can be computed once per registered operation at registration time, and the registry can reject operations above the limit before they ever ship.',
        },
      ],
      pitfalls: [
        'Counting only depth, which ignores list multiplication.',
        'Charging estimated cost without refunding, which penalises well-behaved clients.',
        'Enforcing overnight without shadow data.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-13',
      difficulty: 'medium',
      question:
        'Your CDN caches HTML pages for anonymous users. A developer asks which responses must never end up in the shared edge cache. List them and tell me how you would enforce this structurally rather than by code review.',
      whatInterviewerLooksFor: [
        'Responses to requests with Authorization or session cookies, anything with Set-Cookie',
        'Per-user and personalised pages, error responses with long TTLs',
        'Enforcement by default-deny caching and origin-set Cache-Control, not CDN path rules',
      ],
      modelAnswer: `**Never cache in a shared cache:**
- **Responses to authenticated requests** — any request carrying Authorization or a session cookie. RFC 9111 §3.5 already forbids reuse of responses to requests with Authorization unless the response says public, s-maxage or must-revalidate — a developer adding s-maxage can accidentally opt in.
- **Responses that set cookies** — a cached Set-Cookie hands the next visitor the previous visitor's session.
- **Personalised content** — carts, account pages, "Hello, Priya", prices by customer group.
- **Errors with normal TTLs** — 5xx should not be cached, or only for a few seconds; 404 briefly.

**Structural enforcement**
- **Default deny:** the CDN honours origin Cache-Control only; the origin framework defaults every response to \`private, no-store\` and only specific public routes opt in with \`public, s-maxage=…\`.
- **Middleware guard at the origin:** if the response has Set-Cookie or the request had a session, force \`private\` regardless of what the handler set.
- **CDN rule:** bypass cache when the request has a session cookie or Authorization header.
- **Separate hostnames:** \`www.\` (cacheable) vs \`app.\` / \`api.\` (no caching) so config mistakes are contained.
- **Tests:** a synthetic probe logs in, fetches pages, and asserts Cache-Control and CDN status headers (for example cf-cache-status: BYPASS).`,
      followUps: [
        {
          q: 'How do you cache a page that is 95% the same for everyone but shows a username?',
          a: 'Cache the public shell and fetch the personalised fragment client-side (or with ESI/edge includes); the shell has no cookies and no user data.',
        },
        {
          q: 'Is Vary: Cookie a good fix?',
          a: 'Usually not: every distinct cookie value becomes its own cache entry, so the hit ratio collapses, and analytics cookies make even anonymous users unique.',
        },
      ],
      pitfalls: [
        'Relying on URL patterns at the CDN to decide what is private.',
        'Forgetting that Set-Cookie on an otherwise public page is the dangerous case.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-14',
      difficulty: 'expert',
      question:
        'A bug-bounty report shows an attacker retrieving other users\' account pages — names, emails, masked card numbers — from your CDN by sending victims links like /account/settings/avatar.png. Nothing in your origin logs looks like a breach. Walk me through the investigation and the fix.',
      whatInterviewerLooksFor: [
        'Recognises web cache deception and the mismatch between CDN and origin path handling',
        'Verifies with cache status headers and reproduces safely',
        'Immediate containment (purge, rule change) and structural fixes on both sides',
        'Scope of impact analysis and disclosure',
      ],
      modelAnswer: `**What it is:** *web cache deception*. The CDN decides cacheability by **file extension** ("*.png is static, cache 1 day"). The origin router **ignores the extra path segment** — /account/settings/avatar.png matches the /account/settings route (or a framework's loose path matching) and returns the victim's private page with their session. The CDN caches it under that URL. The attacker requests the same URL and gets the cached copy. The origin only saw the victim's own logged-in request, which is why its logs look normal.

**Investigation**
1. Reproduce with a test account: request the URL logged in, then again with no cookies; check \`Age\` and the CDN status header (HIT on the second request confirms it).
2. Review CDN rules: "cache by extension" or "cache everything" overrides, and whether origin Cache-Control is ignored.
3. Check origin routing: suffix-tolerant matching, path parameters, encoded delimiters (\`%2F\`, \`;\`, \`%23\`) — PortSwigger's 2024 research showed delimiter and normalisation differences between CDNs and frameworks widen this attack.
4. Scope: CDN logs of HITs on private route prefixes with static-looking suffixes; count distinct URLs and time range.

**Containment (hours)**
- Purge private path prefixes; add a CDN rule to **bypass cache** for /account/*, /api/* and any request with a session cookie.

**Structural fixes**
- The CDN **honours origin Cache-Control only**; no extension-based caching overrides on dynamic hosts.
- The origin sends \`Cache-Control: private, no-store\` on every authenticated response (middleware, not per handler).
- Strict routing at the origin: unknown path suffixes return 404; do not normalise differently from the CDN.
- Serve static assets from a separate hostname (static.example.com) that has no cookies.

**Aftermath:** treat exposed data as a breach for disclosure purposes, and add a regression test that requests private routes with static suffixes and asserts no HIT.`,
      followUps: [
        {
          q: 'How is this different from cache poisoning?',
          a: 'Poisoning makes the cache store a *malicious* response that is served to victims (for example via an unkeyed header). Deception makes the cache store a *victim\'s private* response that is served to the attacker.',
        },
        {
          q: 'Would SameSite cookies prevent it?',
          a: 'Only partly. A top-level navigation from a link still sends Lax cookies, which is exactly how the victim\'s request gets authenticated. The fix is in cache rules and routing.',
        },
      ],
      pitfalls: [
        'Looking for a breach in the database or origin logs first.',
        'Fixing only the CDN rule for one path instead of switching to origin-driven caching.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-15',
      difficulty: 'medium',
      question:
        'Your B2B SaaS has 5,000 small tenants and 20 enterprise tenants who pay 60% of revenue; two of them demand data residency and their own encryption keys. Silo, pool or bridge — and at which layers?',
      whatInterviewerLooksFor: [
        'Chooses per layer, not one model for the whole stack',
        'Pool for the long tail with strong enforcement (RLS, tenant context)',
        'Silo or dedicated cells for tenants with contractual needs',
        'Understands operational cost of silos: migrations, deploys, monitoring',
      ],
      modelAnswer: `**Answer: bridge — pool by default, silo where a contract requires it, decided per layer.**

**Long tail (5,000 SMBs) — pool:**
- Shared app pods, shared Postgres with tenant_id on every row, RLS as a second line after the data-access layer, per-tenant cache key prefixes.
- Cost per tenant stays in rupees per month; one deploy and one migration cover everyone.

**Enterprise (20):**
- **Compute:** shared stateless services are usually fine — isolation is achieved with per-tenant quotas and concurrency caps.
- **Data:** dedicated databases (silo at the data layer) for the residency/BYOK tenants, in the required region, encrypted with their own KMS key. Others may stay pooled but on a separate "enterprise" cell for performance isolation.
- **Queues/workers:** a dedicated worker pool or priority lane for heavy tenants.

**Glue:**
- A **tenant directory** maps tenant → cell/database/region; the edge and the data layer both consult it.
- The same code runs everywhere; a silo is just a cell with one tenant. Avoid per-tenant code forks.

**Costs to call out:** each silo is another migration target, another backup, another monitoring surface. Automate provisioning (infrastructure as code per cell) or silos rot.`,
      followUps: [
        {
          q: 'How do you move a pooled tenant into its own silo later?',
          a: 'Copy with a change-data-capture stream filtered by tenant_id, verify counts/checksums, briefly make the tenant read-only, flip the directory entry, and keep the old rows until the rollback window passes.',
        },
        {
          q: 'Does BYOK require a separate database?',
          a: 'Not necessarily — envelope encryption with per-tenant data keys wrapped by the tenant\'s KMS key works in a pool. Residency usually is what forces separate physical storage.',
        },
      ],
      pitfalls: [
        'Choosing silo for everyone "for safety" and drowning in 5,000 migrations.',
        'Pooling everything and ignoring contractual residency.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-16',
      difficulty: 'hard',
      question:
        'Design the tenant routing layer for a cell-based SaaS: a request to acme.yourapp.com or an API call with Acme\'s token must reach Acme\'s cell among 40 cells in 3 regions, and you must be able to move Acme to another cell with under a minute of write downtime.',
      whatInterviewerLooksFor: [
        'A tenant directory with caching, versioning and a safe failure mode',
        'Routing from both hostname and token, reconciled',
        'A live migration protocol: copy, catch up, freeze, flip, drain',
        'Handling of stale routes during the flip',
      ],
      modelAnswer: `**Components**
- **Tenant directory:** tenant_id → {cell, region, state, version}. Source of truth in a small, strongly consistent store (Postgres or DynamoDB with a global table); read path is served from a replicated cache.
- **Cell router** at the edge (Envoy/Workers + a thin routing service): resolves the tenant from the **subdomain** for browser traffic or from the **verified token claim** for API traffic, then forwards to the cell's ingress. If both exist, they must match — otherwise 403.
- Every router keeps the directory in memory (about 50K tenants × 100 bytes ≈ 5 MB), refreshed by a change stream plus a 30 s full resync. If the directory is unreachable, routers keep the **last known map** (static stability).

**Migration of Acme from cell 7 to cell 12**
1. **Copy:** snapshot Acme's rows into cell 12, then stream changes via CDC filtered by tenant_id until lag < 1 s.
2. **Freeze:** mark Acme \`migrating\` (version++). Cell 7 rejects Acme **writes** with 503 + Retry-After: 5; reads continue.
3. **Catch up:** wait for CDC lag to reach zero and verify row counts/checksums.
4. **Flip:** set cell = 12, state = active, version++. The routers pick it up within seconds.
5. **Stale routers:** cell 7 knows Acme left; for any request that still arrives, it returns a redirect-style error with the new cell (or proxies once), so staleness costs a hop, not correctness.
6. **Cleanup** after the rollback window (for example 7 days).

Write downtime ≈ catch-up + propagation, typically 10–30 s. Clients retry on 503 automatically.

**Other concerns:** background jobs and queues must also resolve the cell through the directory, not cache it forever; DNS for acme.yourapp.com stays pointed at the global edge, so no DNS TTL is involved in the move.`,
      followUps: [
        {
          q: 'Why not put the cell in the DNS name (acme.cell7.yourapp.com)?',
          a: 'It leaks topology into clients and bookmarks, and every migration then depends on DNS TTLs and client caches. An edge router lets you move tenants without clients noticing.',
        },
        {
          q: 'How do you prevent the directory from becoming a single point of failure?',
          a: 'Keep it off the hot path: routers serve from an in-memory copy, updates are rare, and the store is multi-AZ. Directory outage then only blocks migrations and new tenants.',
        },
      ],
      pitfalls: [
        'Looking up the directory synchronously on every request with no local cache.',
        'Migrating without a write freeze and ending up with split writes in two cells.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-17',
      difficulty: 'medium',
      question:
        'Explain shuffle sharding and when you would prefer it to plain cells for containing a noisy or poison-pill tenant. Give the math.',
      whatInterviewerLooksFor: [
        'Each tenant gets a random subset of k of n workers; overlap probability is small',
        'Correct combinatorics: C(n, k) distinct shards, full-overlap chance 1 / C(n, k)',
        'Requires clients or routers that retry on another member of the shard',
        'Contrast with cells: cells share a fate among all tenants of the cell',
      ],
      modelAnswer: `**Idea:** instead of splitting n workers into fixed groups (cells), give every tenant its own random combination of k workers. Two tenants usually overlap on some workers, but rarely on **all** of them.

**Math with n = 100 workers, k = 5 per tenant:**
- Distinct shards: C(100, 5) = 75,287,520.
- Probability that a given other tenant has exactly the same 5 workers: 1 / 75.3M.
- If a poison-pill tenant crashes its 5 workers, another tenant loses *all* capacity only if it has identical workers. Most tenants share 0 or 1 workers with it, and a retry to another worker in their own shard succeeds.
- Compare fixed cells of 5: 20 cells, and every tenant in the bad tenant's cell (1/20 = 5% of tenants) goes down completely.

**When to prefer it:**
- Stateless or easily routed work (API workers, queue consumers, DNS resolvers — AWS uses it for Route 53).
- Unknown, per-tenant failure modes: poison requests, abusive traffic.

**When cells are better:** stateful data (a tenant's data lives in one database), or when you need a hard blast-radius boundary for deploys and config — shuffle shards still share the whole fleet's deploy.

**Requirement:** the router must know each tenant's shard (deterministic, e.g. seeded by tenant_id) and retry on another shard member when one fails.`,
      followUps: [
        {
          q: 'What happens as the number of tenants grows to millions?',
          a: 'Overlaps become common on partial subsets, but full overlap stays rare as long as C(n, k) is much larger than the tenant count. Choose k large enough to also absorb normal load.',
        },
        {
          q: 'Can you combine it with cells?',
          a: 'Yes — shuffle-shard within a cell. Cells bound the deploy blast radius, shuffle shards bound the tenant-induced blast radius inside each cell.',
        },
      ],
      pitfalls: [
        'Saying shuffle sharding eliminates overlap rather than eliminating full overlap.',
        'Forgetting that clients must retry on the other shard members.',
      ],
    },
    {
      id: 'misc-traffic-edge-iq-18',
      difficulty: 'expert',
      question:
        'Design resource management for a shared compute platform where many customers run jobs on the same pool of VMs, so that one customer\'s heavy workload cannot degrade others. Cover isolation, scheduling, quotas and detection.',
      context:
        'Reported as asked at Databricks ("Design a solution for the noisy neighbor problem": a cloud resource management system that isolates tenants sharing VMs and infrastructure).',
      whatInterviewerLooksFor: [
        'Isolation per resource: CPU, memory, disk IO, network, shared services',
        'Admission control and quotas before scheduling, fair-share scheduling across tenants',
        'Enforcement mechanisms (cgroups, dedicated nodes, preemption) and their costs',
        'Per-tenant attribution metrics and automated responses',
        'Tiered isolation by price (shared vs dedicated)',
      ],
      modelAnswer: `**1. Isolation per resource on a shared VM**
- **CPU:** cgroup CPU shares/weights for proportional sharing; hard quotas (CFS quota) for capped tiers — beware quotas cause throttling spikes in latency-sensitive jobs, so give those guaranteed cores (CPU pinning).
- **Memory:** hard cgroup limits; a tenant exceeding them is OOM-killed inside its own container, not the node.
- **Disk and network:** IO weights/limits (cgroup v2 io.max), per-container bandwidth shaping; local SSD per job for shuffle-heavy work.
- **Shared services** (metadata store, object storage gateway, scheduler API): per-tenant rate and concurrency limits — the noisiest neighbour is often a control-plane API, not a VM.

**2. Admission and quotas**
- Each tenant has a quota (cores, memory, concurrent jobs) per tier. Requests beyond quota queue rather than fail.
- **Fair-share scheduling:** when the pool is contended, allocate by weighted fairness across tenants (Dominant Resource Fairness handles multi-resource jobs), not FIFO by submission.
- **Preemption:** low-priority/spot jobs are preempted (with checkpointing) to make room for guaranteed ones.

**3. Placement**
- Spread a tenant's workers across nodes (anti-affinity) to bound its per-node share, and bin-pack by complementary profiles (CPU-heavy next to IO-heavy).
- **Tiers:** shared pool for standard customers; dedicated nodes or node pools for premium/regulated ones — isolation becomes a price point.

**4. Detection and response**
- Per-tenant attribution: CPU throttled time, memory pressure (PSI), IO wait, network bytes per container, exported with tenant labels aggregated at the tenant (not job) level.
- Signals of interference: other tenants' latency or throttling rising on the same node while one container's usage spikes.
- Automated responses: throttle, migrate the job to a less loaded node, or move the tenant to a dedicated pool; surface a "your job was throttled" message rather than silent slowness.

**5. Trade-off to state:** stronger isolation (dedicated VMs) costs utilisation — shared pools run at 60–70% utilisation, dedicated ones often at 20–30%. The design lets customers pay for the isolation level they need.`,
      followUps: [
        {
          q: 'Why is CPU throttling from CFS quotas a problem for latency-sensitive jobs?',
          a: 'A quota is enforced per period (default 100 ms). A multi-threaded job can burn its quota early in the period and then be paused for the rest of it, adding tens of milliseconds of latency even at low average CPU.',
        },
        {
          q: 'How do you handle noisy neighbours on hardware you do not control (cache, memory bandwidth)?',
          a: 'Detect via performance counters or rising CPI, and mitigate by placement (spread or isolate the aggressor) or dedicated hosts; Intel RDT cache allocation can partition last-level cache where available.',
        },
      ],
      pitfalls: [
        'Only limiting CPU and memory while ignoring IO, network and shared control-plane services.',
        'Relying on autoscaling alone, which buys capacity for the noisy tenant too.',
        'No per-tenant attribution, so interference is invisible until customers complain.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'misc-traffic-edge-boe-1',
      question:
        'A 60-pod API behind an ALB takes 25 minutes to roll out, and engineers batch changes to avoid deploying. Estimate how much of that is drain waiting, and what the rollout would take with a right-sized deregistration delay.',
      assumptions: [
        'Rolling update with maxSurge 25% and maxUnavailable 0 → 15 new pods per wave',
        'New pod: image pulled and cached, ~30 s to start plus ~20 s for readiness and target registration',
        'ALB deregistration delay at the default 300 s; old pods leave only after draining',
        'p99.9 request latency 2 s; longest legitimate request 10 s',
      ],
      steps: [
        { label: 'Waves', calc: '60 pods ÷ 15 per wave = 4 waves' },
        { label: 'Per wave today', calc: '30 s start + 20 s ready + 300 s drain ≈ 350 s ≈ 5.8 min' },
        { label: 'Total today', calc: '4 × 5.8 min ≈ 23 min (+ canary checks ≈ 25 min)' },
        { label: 'Share spent draining', calc: '4 × 300 s = 1,200 s = 20 min → ~85% of the rollout' },
        { label: 'Right-sized drain', calc: 'longest request 10 s + 10 s propagation slack ≈ 20 s' },
        { label: 'Per wave after', calc: '30 + 20 + 20 = 70 s; 4 waves ≈ 4.7 min' },
      ],
      answer:
        'About 20 of the 25 minutes are the 300 s default drain doing nothing useful; with a 20 s delay the rollout drops to roughly 5 minutes.',
      insight:
        'Drain time should come from the latency distribution, not the default. Fast rollouts change engineering behaviour (smaller, safer deploys). If a few requests genuinely take minutes, move them to async jobs rather than holding every deploy hostage to them.',
      followUps: [
        {
          "q": "A handful of requests really do take 3 minutes (large exports). With a 20 s drain, what happens to them, and what's the fix?",
          "a": "With a 20 s deregistration delay and a correspondingly short grace period, an export in progress when its pod drains is cut off, so the user sees a failed download. Fix by design: make exports async (POST creates a job, a worker writes the file to S3, the client downloads via a pre-signed URL), so no API request lasts more than a few seconds. If you can't yet, route exports to a separate Deployment and target group with a long drain (5 minutes) and a matching grace period. Only that small service pays for long rollouts, and the main API deploys in about 5 minutes."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-boe-2',
      question:
        'A queue-consumer fleet of 16 workers serves 3,000 tenants. A tenant\'s poison message crashes any worker that processes it. Compare the blast radius of 4 fixed cells of 4 workers with shuffle sharding at 4 workers per tenant.',
      assumptions: [
        'The poison tenant crashes every worker it is assigned to',
        'Fixed cells: tenants spread evenly across 4 cells of 4 workers',
        'Shuffle sharding: each tenant is assigned a random 4-worker combination, and consumers retry on any healthy worker in their shard',
      ],
      steps: [
        { label: 'Cells: tenants sharing the cell', calc: '3,000 ÷ 4 cells = 750 tenants fully down (25%)' },
        { label: 'Shuffle: distinct shards', calc: 'C(16, 4) = 16·15·14·13 ÷ 24 = 1,820 combinations' },
        { label: 'Shuffle: full-overlap tenants', calc: '2,999 other tenants ÷ 1,820 ≈ 1.6 tenants expected with the identical shard' },
        { label: 'Shuffle: partial overlap', calc: 'P(share ≥1 worker) = 1 − C(12,4)/C(16,4) = 1 − 495/1,820 ≈ 73% — degraded but alive' },
        { label: 'Blast radius ratio', calc: '750 down vs ~2 down → ~400× smaller full-outage radius' },
      ],
      answer:
        'Fixed cells take down about 750 tenants (25%); shuffle sharding fully takes down only about 2, while roughly 73% of tenants lose some capacity but keep working through retries.',
      insight:
        'Shuffle sharding turns an outage for a quarter of customers into a partial degradation for many and a full outage for almost none — but only if consumers retry on another shard member and you still quarantine the poison message (dead-letter it after N crashes).',
      followUps: [
        {
          "q": "Shuffle sharding assumes consumers retry on another worker in their shard. What does that retry do to the poison message itself?",
          "a": "The poison message also retries on the next worker in its tenant's shard, and crashes that one too. Without a limit, it crashes all 4 of its workers in sequence, degrading the roughly 73% of tenants that overlap with them. So pair shuffle sharding with poison detection: count deliveries per message (or crashes associated with a message id, recorded before processing) and dead-letter after 2 attempts. Optionally quarantine the tenant: route its messages to an isolated worker until fixed. Shuffle sharding limits the blast radius of the bad tenant; quarantining stops it from causing repeated crashes."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-boe-3',
      question:
        'A reporting API runs 40 pods, each with a 20-connection Postgres pool. Normally tenants average 120 ms per query. One tenant opens 300 dashboards at once, each firing queries that take 4 s under load. Use Little\'s law to find what that tenant consumes and a safe per-tenant concurrency cap.',
      assumptions: [
        'Total DB connections = 40 × 20 = 800',
        'Normal fleet load: 3,000 queries/s at 120 ms',
        'Spike: the tenant sends 300 queries/s at 4 s each',
        'Goal: no tenant may hold more than ~15% of connections',
      ],
      steps: [
        { label: 'Normal concurrency', calc: 'L = λW = 3,000/s × 0.12 s = 360 connections (45% of 800)' },
        { label: 'Tenant spike concurrency', calc: '300/s × 4 s = 1,200 connections demanded → more than the whole pool' },
        { label: 'Effect', calc: '800 − 360 = 440 free; tenant takes all 440 and queues the rest; others wait on pool acquisition → timeouts' },
        { label: 'Fleet cap', calc: '15% × 800 = 120 connections for one tenant' },
        { label: 'Per-pod cap', calc: '120 ÷ 40 pods = 3 in-flight queries per tenant per pod' },
        { label: 'Tenant throughput at the cap', calc: '120 ÷ 4 s = 30 queries/s — the rest wait or get 429' },
      ],
      answer:
        'The tenant would demand about 1,200 concurrent connections — more than the fleet\'s 800 — so everyone else starves. A cap of about 3 in-flight per tenant per pod (120 fleet-wide) bounds it to 15% of the pool at ~30 slow queries/s.',
      insight:
        'Noisy-neighbour sizing is a concurrency problem, not a request-rate problem: 300 req/s is harmless at 120 ms and fatal at 4 s. Cap in-flight work per tenant, and pair it with a per-tenant statement timeout so a single query cannot hold a slot for minutes.',
      followUps: [
        {
          "q": "Your cap is per pod. The load balancer isn't sticky, so a tenant's requests spread across all 40 pods. Is 120 fleet-wide really the bound, and what if pods scale to 80?",
          "a": "With even spreading, the tenant can hold at most 3 per pod × 40 pods = 120. At 80 pods (autoscaled because of this tenant's load, perhaps), the cap becomes 240, and the DB connection count also doubles to 1,600, but the DB's real capacity didn't. Per-pod caps scale with pod count, not with DB capacity. Fix: derive the per-pod cap from a fleet-wide budget (`ceil(120 / currentPods)`, updated from the pod count), or enforce the fleet-wide cap centrally (a Redis-based distributed semaphore per tenant, or PgBouncer per-user pool limits that bind directly to DB connections)."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-boe-4',
      question:
        'After a regional failover, 8M mobile clients reconnect to your L7 edge within about 2 minutes. How many cores does TLS handshaking need with RSA-2048 certificates vs ECDSA P-256, and how much does session resumption help?',
      assumptions: [
        'Illustrative CPU per full TLS 1.3 handshake on a modern core: ~1 ms with RSA-2048, ~0.2 ms with ECDSA P-256 (ECDHE included)',
        'Resumed handshake (PSK) ≈ 0.05 ms',
        'Reconnects spread over 120 s; plan for 2× peak inside that window',
        'Resumption is not possible across regions (different ticket keys) — so the first wave is full handshakes',
      ],
      steps: [
        { label: 'Average handshake rate', calc: '8M ÷ 120 s ≈ 67K/s; peak ×2 ≈ 133K/s' },
        { label: 'RSA-2048 cores', calc: '133K/s × 1 ms = 133 core-seconds per second ≈ 133 cores' },
        { label: 'ECDSA P-256 cores', calc: '133K/s × 0.2 ms ≈ 27 cores' },
        { label: 'If ticket keys were shared across regions', calc: '133K/s × 0.05 ms ≈ 7 cores' },
        { label: 'Normal steady state', calc: 'e.g. 5K new conns/s × 0.2 ms ≈ 1 core — failover is a 25–130× spike' },
      ],
      answer:
        'Roughly 130 cores just for handshakes with RSA-2048, about 27 with ECDSA, and single digits if clients could resume sessions — versus about one core in steady state.',
      insight:
        'The edge must be sized for reconnect storms, not steady state. Serve ECDSA certificates (with RSA fallback for old clients), share session-ticket keys across regions where policy allows, and make clients reconnect with jitter so the 2-minute window stretches rather than compresses.',
      followUps: [
        {
          "q": "You can't change the certificate type this quarter. How else can you survive the reconnect storm?",
          "a": "Spread and absorb the load. Make clients reconnect with exponential backoff and jitter (0–60 s randomised), stretching the 2-minute window into 5–10 minutes, which roughly divides the peak by 3–5. Pre-scale the DR edge for the storm (autoscaling is too slow): keep enough cores reserved in the standby region, or run TLS termination on a managed edge or CDN with massive shared capacity. Use admission control: when CPU is high, reject new TLS connections quickly with a TCP RST rather than accepting and timing out, so clients back off. Share ticket keys across regions where policy allows, so most reconnects resume."
        }
      ],
    },
  ],
  test: [
    {
      id: 'misc-traffic-edge-mcq-01',
      difficulty: 'hard',
      question:
        'An Envoy cluster has 10 hosts with default settings (healthy panic threshold 50%). A bad config push makes 6 hosts fail active health checks while their processes keep accepting connections. What does Envoy do with traffic?',
      options: [
        'Sends everything to the 4 healthy hosts, which then overload at 2.5× their normal share',
        'Returns 503 "no healthy upstream" for every request until at least 5 hosts pass health checks',
        'Fails over to the priority-1 cluster in another zone, as it would for any host failure',
        'Enters panic mode and balances across all 10 hosts, so roughly 60% of requests reach failing hosts',
      ],
      correct: [3],
      explanation:
        'Below the panic threshold, Envoy assumes the health signal is less trustworthy than the risk of crushing the survivors, and ignores health status — traffic goes to all hosts. So about 6 in 10 requests hit broken hosts. Concentrating everything on 4 hosts is exactly what panic mode avoids. Envoy does not return 503 across the board here, and priority failover only happens if you configured priority levels; it is not the default response to unhealthy hosts.',
      followUps: [
        {
          "q": "The 6 hosts really are broken, not just failing the health check. Is panic mode still the right behaviour, and what else should protect you?",
          "a": "Panic mode bets that health checks are wrong; when hosts are truly broken, 60% of requests fail instead of 4 hosts being overloaded. That's still often better than 100% failure from overloaded survivors, but it shouldn't be your only defence. Add passive outlier detection (consecutive 5xx ejection, with a max ejection percentage), retries on another host for idempotent requests, and most importantly prevention: stage config pushes so a bad config reaches 1 host, then 10%, with automatic rollback when health drops. Alert on panic mode entry (`upstream_rq_panic` stat), since it means something cluster-wide is wrong."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-02',
      difficulty: 'expert',
      question:
        'An L4 balancer has cross-zone load balancing disabled. DNS returns one IP per zone, so clients split traffic 50/50 between zone A and zone B. After a scale-in, zone A has 2 targets and zone B has 8. What share of total traffic does each zone-A target receive?',
      options: [
        '10% — the balancer spreads load evenly across all 10 registered targets',
        '6.25% — zone A gets proportionally less traffic because it has fewer targets',
        '25% — each zone node only forwards to its own zone, so 50% is split over 2 targets',
        '50% — flows are hashed to one target per zone and never rebalanced',
      ],
      correct: [2],
      explanation:
        'With cross-zone disabled, each zone node balances only across targets in its own zone. Zone A still receives half the traffic from DNS, split over 2 targets: 25% each, versus 6.25% for each zone-B target — a 4× imbalance. 10% would be true with cross-zone enabled. DNS weights do not follow target counts automatically, so 6.25% for zone-A targets is wrong. Keep zones balanced (topology spread constraints) or enable cross-zone, accepting cross-AZ data charges.',
      followUps: [
        {
          "q": "Enabling cross-zone fixes the imbalance but adds data charges. Which would you choose for an internal service doing 5 Gbps, and how do you avoid needing either?",
          "a": "5 Gbps with cross-zone means about half the bytes cross AZs: roughly 2.5 Gbps × $0.02/GB, about $16K/month. Prefer keeping zones balanced so cross-zone isn't needed: `topologySpreadConstraints` with `maxSkew: 1` across zones for the Deployment, and make HPA and cluster-autoscaler scale-ins zone-aware so a scale-in doesn't empty one zone. Then each zone's LB node gets traffic proportional to its targets. Keep cross-zone as a fallback only when a zone loses capacity, and alert on per-target request share skew."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-03',
      difficulty: 'hard',
      question:
        'This client-side P2C balancer ran fine for weeks. After backend-3 had a 2-minute outage this morning, it has received almost no traffic all day although it is healthy again. Why?',
      code: {
        language: 'typescript',
        code: `const backends = urls.map((url) => ({ url, inflight: 0 }));

function pick() {
  const a = backends[Math.floor(Math.random() * backends.length)];
  const b = backends[Math.floor(Math.random() * backends.length)];
  return a.inflight <= b.inflight ? a : b;
}

export async function call(path: string) {
  const be = pick();
  be.inflight++;
  const res = await fetch(be.url + path, { signal: AbortSignal.timeout(2000) });
  be.inflight--;
  return res;
}`,
      },
      options: [
        'Two random picks can be the same backend, which biases selection away from backend-3',
        'Math.random() is not uniform enough for load balancing; use crypto.randomInt()',
        'fetch rejects on timeout or connection error, so inflight-- is skipped; backend-3 kept its inflated count permanently',
        'AbortSignal.timeout keeps the socket open for 2 s after success, which inflates inflight during recovery',
      ],
      correct: [2],
      explanation:
        'During the outage each request threw (timeout or ECONNREFUSED), so the decrement after the await never ran. Backend-3 now has a permanently high inflight count and loses every comparison. The fix is try/finally around the call. Picking the same backend twice happens occasionally but is unbiased. Math.random is fine for balancing, and AbortSignal.timeout does not hold sockets open after the response.',
      followUps: [
        {
          "q": "You fix it with try/finally. How would you have detected the drift earlier, and what else could make counters wrong?",
          "a": "Export each backend's in-flight count as a gauge per client pod. A healthy fleet shows small, fluctuating values that return to near zero when traffic drops; a stuck counter shows a flat, high line that never decreases, which is easy to alert on (in-flight above 0 with zero request rate for 5 minutes). Other sources of drift: requests abandoned when the caller's own promise is cancelled without signalling the balancer, retries counted twice, and backends removed from discovery while counts are non-zero. Periodically reset counts for backends with no traffic, or use EWMA latency, which self-heals."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-04',
      difficulty: 'hard',
      question:
        'You replace an L7 proxy with an L4 proxy in TCP proxy mode (it opens its own connection to the backend) and TLS passthrough. Your fraud service now logs the proxy\'s private IP as the client IP for every request. Which fix works?',
      options: [
        'Enable X-Forwarded-For insertion on the L4 proxy so it adds the client IP header',
        'Read the client IP from the TLS ClientHello SNI extension on the backend',
        'Enable PROXY protocol v2 on the proxy and make the backend listener parse it before the TLS handshake',
        'Switch the backend to HTTP/2 so the client IP travels in the :authority pseudo-header',
      ],
      correct: [2],
      explanation:
        'A proxying L4 balancer opens a new TCP connection, so the backend sees the proxy IP. PROXY protocol prepends a small header with the original source address before the TLS bytes, and the backend (nginx, Envoy, HAProxy) must be configured to expect it. An L4 proxy cannot insert HTTP headers into an encrypted stream it does not decrypt. SNI carries the requested hostname, not the client IP, and :authority is also the host.',
      followUps: [
        {
          "q": "Some health checkers and old internal clients connect to the same listener without the PROXY header. What happens, and how do you configure around it?",
          "a": "A listener expecting PROXY protocol rejects connections that don't start with the PROXY signature, so those clients fail (or worse, a misconfigured backend parses their first bytes as a header). Fixes: run separate listeners or ports, one with PROXY protocol for traffic via the L4 proxy and one without for health checks and internal callers; or configure the proxy's health checks to send PROXY headers too (NLB does when PROXY v2 is enabled on the target group). Never accept PROXY headers from untrusted sources, since they could spoof client IPs; restrict that listener to the proxy's IP range."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-05',
      difficulty: 'expert',
      question:
        'Which of these require the balancer to terminate TLS and parse HTTP, i.e. cannot be done by a pure L4 passthrough balancer? Select ALL that apply.',
      options: [
        'Routing /v2/* to a different backend pool than /v1/*',
        'Routing api.example.com and admin.example.com to different pools on the same IP',
        'Balancing individual HTTP/2 streams of one client connection across several backends',
        'Preserving the client source IP for the backend',
        'Retrying a request on a different backend after the first backend reset the stream',
      ],
      correct: [0, 2, 4],
      explanation:
        'Path routing, per-stream HTTP/2 balancing and request-level retries all need to see HTTP requests, which are inside the TLS stream. Hostname routing is possible at L4 by reading the SNI in the unencrypted ClientHello (Envoy tls_inspector, nginx ssl_preread), unless Encrypted Client Hello is in use. Client IP preservation is actually easier at L4 (forwarding mode or PROXY protocol).',
      followUps: [
        {
          "q": "Encrypted Client Hello hides the SNI. What happens to your L4 hostname routing, and what can you do?",
          "a": "With ECH, the outer ClientHello carries only a public 'client-facing' name, and the real hostname is encrypted. An L4 router reading SNI sees the same outer name for every site, so per-host routing breaks. Options: terminate TLS (ECH is decrypted by whoever holds the ECH key, typically your edge), then route at L7; give each service its own IP or port so routing doesn't need SNI; or operate the ECH client-facing server yourself, so you can decrypt the inner ClientHello at the edge and route on the real name. For your own domains you control whether ECH is published, so plan before enabling it."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-06',
      difficulty: 'expert',
      question:
        'This Envoy route fronts POST /payments. During a node failure, finance finds ~40 duplicate charges. What is the most precise fix at the proxy layer?',
      code: {
        language: 'yaml',
        code: `routes:
  - match: { prefix: /payments }
    route:
      cluster: payments
      timeout: 5s
      retry_policy:
        retry_on: 5xx,reset,connect-failure
        num_retries: 2
        per_try_timeout: 2s`,
      },
      options: [
        'Raise per_try_timeout to 5s so slow requests are not retried while still running',
        'For non-idempotent routes, retry only on connect-failure and refused-stream, and require idempotency keys before enabling broader retries',
        'Replace retries with hedged requests so the first response wins and the other is cancelled',
        'Move retries to the mobile client, which knows whether the payment completed',
      ],
      correct: [1],
      explanation:
        'reset, 5xx and per-try timeouts all fire after the upstream may already have processed the charge, so a retry executes it again. connect-failure and refused-stream mean the request never reached the application, so they are safe to retry. Longer per-try timeouts reduce but do not remove the window. Hedging sends duplicates on purpose — worse for payments. Client retries have the same problem unless the client sends an idempotency key, which is the real long-term fix.',
      followUps: [
        {
          "q": "The payment service adds idempotency keys. Which Envoy retry conditions would you then enable, and what else stops a retry storm?",
          "a": "With keys enforced server-side (a retry with the same key returns the original result), you can safely add `5xx`, `reset` and per-try timeout retries, because a duplicate executes once. Keep `num_retries` small (1–2), use `retry_host_predicate: previous_hosts` to try another host, and a retry budget (`retry_budget: budget_percent 20`) so retries never exceed 20% of active requests during an outage. Ensure the key is forwarded unchanged on retries. Also check that the per-try timeout plus retries fits the client's overall deadline."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-07',
      difficulty: 'hard',
      question:
        'On Node 18, this shutdown handler logs "stopping" but the "closed" line rarely appears before Kubernetes SIGKILLs the pod 30 s later, even when there are no active requests. Why?',
      code: {
        language: 'typescript',
        code: `const server = app.listen(3000);
server.keepAliveTimeout = 65_000; // above the ALB idle timeout

process.on('SIGTERM', () => {
  console.log('stopping');
  server.close(() => {
    console.log('closed');
    process.exit(0);
  });
});`,
      },
      options: [
        'server.close() only stops accepting; on Node 18 it waits for idle keep-alive sockets, which the ALB holds open for up to 65 s',
        'process.exit(0) inside the callback deadlocks the event loop, so the log is never flushed',
        'SIGTERM is not delivered to Node when it runs as PID 1 in a container',
        'app.listen() returns a promise in Express 5, so server.close is undefined and the error is swallowed',
      ],
      correct: [0],
      explanation:
        'close() fires its callback only when every connection has ended. Idle keep-alive sockets count, and with a 65 s keepAliveTimeout and an ALB that reuses them they outlive the 30 s grace period. On Node 18.2+ call server.closeIdleConnections() after close() (Node 19+ does this automatically). The PID 1 issue affects default signal handlers, not an explicit process.on handler — and the "stopping" log proves the handler ran. process.exit in a callback does not deadlock, and app.listen returns an http.Server.',
      followUps: [
        {
          "q": "On Node 20, close() closes idle connections automatically. Is the shutdown problem fully solved there?",
          "a": "Not completely. Idle sockets are closed, but active keep-alive connections that the ALB keeps sending requests on stay open as long as requests arrive, so close() still waits. And if Node closes an idle socket the ALB just picked for a new request, that request gets a reset and a 502. That's why the full sequence matters: fail readiness and keep serving until the ALB deregisters the target (so no new requests arrive), send `Connection: close` on responses during draining, then close(). Add a hard-stop timer below the grace period with `closeAllConnections()` as the last resort."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-08',
      difficulty: 'medium',
      question:
        'A pod has terminationGracePeriodSeconds: 30, a preStop hook of sleep 20 (to let the LB catch up), and an app that needs up to 15 s to finish in-flight requests after SIGTERM. What happens on scale-in?',
      options: [
        'Everything drains: the grace period starts after the preStop hook, giving the app 30 s',
        'The app gets SIGTERM at t=20 s and is SIGKILLed at t=30 s, so requests needing more than ~10 s are cut',
        'Kubernetes extends the grace period automatically because the preStop hook is still running',
        'The preStop hook is skipped because its duration is close to the grace period',
      ],
      correct: [1],
      explanation:
        'The grace period counts from the start of termination and includes the preStop hook. SIGTERM arrives only after preStop finishes (t=20 s), leaving 10 s before SIGKILL at t=30 s. Kubernetes does not extend the period for a running hook (it grants at most a one-off 2 s extra if the hook is still running at the deadline), and hooks are not skipped. Set the grace period to at least preStop + drain + margin, e.g. 45 s.',
      followUps: [
        {
          "q": "You raise the grace period to 45 s. What else in the cluster or LB configuration must agree with that number?",
          "a": "Several timeouts must line up: ALB target group deregistration delay should be at least preStop + longest request (about 35 s), or the ALB keeps sending or cuts connections early. Cluster autoscaler and node drain (`kubectl drain --timeout`, Karpenter's `terminationGracePeriod`) must allow at least 45 s per pod, or nodes are killed underneath. PodDisruptionBudgets plus the 45 s mean slower rollouts and node rotations, so check rollout duration. Spot instance interruption gives 2 minutes, which is fine. Document the budget: preStop 20 s + drain 15 s + 10 s margin."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-09',
      difficulty: 'expert',
      question:
        'An HTTP/2 server is being drained and uses GOAWAY. Which statements are correct? Select ALL that apply.',
      options: [
        'GOAWAY carries the last stream ID the server will process; the client can safely retry streams with higher IDs on a new connection',
        'A graceful shutdown can first send GOAWAY with the maximum stream ID, then a second GOAWAY with the real last ID after about one RTT, to avoid racing streams already in flight',
        'After GOAWAY, streams with IDs up to the last stream ID are allowed to complete on the existing connection',
        'GOAWAY immediately resets all open streams, so in-flight requests must be retried',
        'Clients must reconnect to the same server after GOAWAY to keep stream ordering',
      ],
      correct: [0, 1, 2],
      explanation:
        'GOAWAY stops new streams while letting streams up to the last stream ID finish — that is what makes it a drain signal. Streams above that ID were not processed, so they are safe to retry even when not idempotent. The two-phase GOAWAY (max ID, then the real one) is described in RFC 9113 for graceful shutdown. It does not reset open streams, and clients should open a new connection, typically to another backend.',
      followUps: [
        {
          "q": "A client sent a non-idempotent POST on a stream with an ID above the GOAWAY's last stream ID. Should it retry, and on which connection?",
          "a": "Yes, safely. The server's GOAWAY declares that it did not and will not process streams above that ID, so the POST was never executed. The client should open a new connection (DNS or balancer may route it to another backend) and resend. For streams at or below the last ID, the server may still complete them. If the connection then dies before a response, the outcome is unknown, and a non-idempotent request must not be blindly retried without an idempotency key. Most HTTP/2 client libraries do this classification automatically, but verify yours does."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-10',
      difficulty: 'expert',
      question:
        'This ring uses 200 vnodes per physical node and picks 3 replicas per key. After one node dies, some keys become unavailable even though the system is supposed to tolerate one failure. Why?',
      code: {
        language: 'typescript',
        code: `// ring: sorted array of { hash: number, node: string } (200 points per node)
function replicasFor(key: string, n = 3): string[] {
  const h = murmur32(key);
  let i = ring.findIndex((p) => p.hash >= h);
  if (i === -1) i = 0;
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    out.push(ring[(i + k) % ring.length].node); // next n points clockwise
  }
  return out;
}`,
      },
      options: [
        'findIndex is O(n); under load the lookup times out and the key is reported unavailable',
        'murmur32 produces collisions between vnodes, so two nodes claim the same key range',
        'The modulo wrap-around sends keys near the top of the ring to index 0 twice',
        'Consecutive ring points can belong to the same physical node, so some keys have fewer than 3 distinct replicas',
      ],
      correct: [3],
      explanation:
        'With many vnodes, adjacent points often map to the same node. Taking the next 3 points rather than the next 3 distinct nodes gives some keys two or even three copies on one machine; when it dies, those keys are gone. Walk the ring clockwise and skip nodes already chosen (and ideally skip same-rack/AZ nodes). findIndex is slow (binary search is better) but slowness does not cause data loss. Collisions are negligible, and the wrap-around logic is correct.',
      followUps: [
        {
          "q": "You walk the ring for distinct nodes. Two of the 3 replicas still land in the same AZ for many keys. How do you make replica placement AZ-aware?",
          "a": "Tag each node with its AZ (and rack). When walking clockwise, skip a node if its AZ already holds a replica for this key, until you have one replica per AZ (with 3 AZs and RF=3). If an AZ has no live nodes, fall back to the next distinct node so availability is preserved. Cassandra's NetworkTopologyStrategy does exactly this. Also keep AZs balanced in node count and vnode weight, otherwise the AZ-aware walk concentrates load on the smaller AZ's nodes, since every key needs a replica there."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-11',
      difficulty: 'hard',
      question:
        'A cache fleet of 10 nodes uses jump consistent hash (buckets 0–9). Node 3 dies, and the team removes it from the list so nodes 4–9 shift down to buckets 3–8. Roughly what fraction of keys now map to a different physical node?',
      options: [
        '~10% — only the dead node\'s keys move, as with any consistent hash',
        '~20% — the dead node\'s keys plus the last bucket\'s keys',
        '~70% — keys in buckets 3–9 all end up on a different machine',
        '~90% — jump hash degenerates to modulo hashing when N changes',
      ],
      correct: [2],
      explanation:
        'Jump hash keeps a key\'s bucket stable when going from 10 to 9 buckets unless it was in bucket 9 — but renumbering means bucket 3 now points at old node 4, bucket 4 at old node 5, and so on. Keys in old buckets 3–8 (60%) move to a different machine, and bucket 9\'s keys (10%) are redistributed: about 70%. Only removing the last bucket gives ~10% movement. It does not degenerate to modulo, but it cannot remove arbitrary buckets — use a ring or rendezvous hashing for fleets where random nodes fail.',
      followUps: [
        {
          "q": "How should you handle a dead node with jump hash if you must keep it, and when is jump hash still the best choice?",
          "a": "Keep the bucket list fixed and map dead buckets elsewhere without renumbering: when a key's bucket is dead, rehash it (for example `jump(hash(key + attempt), N)`) until a live bucket is found, so only the dead node's keys move. Better still, replace the node in the same bucket slot quickly (a new machine takes bucket 3's identity). Jump hash shines for storage shards that are numbered, replicated and only grow at the end, such as sharded databases where each shard is a replicated group that never 'disappears'. It's fast, uses no memory and distributes perfectly evenly."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-12',
      difficulty: 'expert',
      question:
        'Proxies route to 8 cache nodes using consistent hashing with bounded loads, ε = 0.25, with 800 requests in flight. A viral key suddenly accounts for 300 concurrent requests. What happens?',
      options: [
        'All 300 go to the key\'s home node; bounded loads only limits the number of keys per node',
        'The home node is capped at 125 in flight; excess requests walk clockwise to the next nodes, which miss and then cache the key — effectively replicating it across ~3 nodes',
        'The proxies reject requests above 125 with 429 until the home node catches up',
        'The ring rebalances by moving vnodes away from the home node, which invalidates about 1/8 of all keys',
      ],
      correct: [1],
      explanation:
        'Capacity is ceil((1 + 0.25) × 800 / 8) = 125 per node. Requests beyond a full node\'s cap go to the next node on the ring with spare capacity, so the viral key is served by its home node plus about two more — each of those takes an initial miss to fill. Bounded loads caps load, not key count. It does not reject traffic, and it does not move vnodes; the assignment adapts per request.',
      followUps: [
        {
          "q": "The viral key fades. Do the copies on the overflow nodes cause problems later?",
          "a": "The copies on the two overflow nodes remain until their TTL or eviction. Since requests return to the home node once its load drops, the copies just age out. Risks: if the key is updated, the overflow copies are stale unless invalidations go to all nodes that might hold it (or the TTL is short), so readers routed to an overflow node during the next spike might see old data. Mitigate with a short TTL for keys cached via overflow, or broadcast invalidations for hot keys. Memory waste is small: a few extra copies of a single hot key."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-13',
      difficulty: 'hard',
      question:
        'A Server-Sent Events endpoint works locally, but through the nginx gateway clients receive events in bursts every few seconds, and idle streams die after exactly 60 s. Which change fixes both?',
      code: {
        language: 'nginx',
        code: `location /events {
    proxy_pass http://notifications;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
}`,
      },
      options: [
        'Set proxy_buffering off (or send X-Accel-Buffering: no from upstream) and raise proxy_read_timeout above the heartbeat interval, with a heartbeat every ~15 s',
        'Add gzip on; so small events are flushed immediately as compressed frames',
        'Switch to proxy_http_version 2.0 so nginx multiplexes events without buffering',
        'Set keepalive_timeout 3600; on the server block so the client connection is not closed',
      ],
      correct: [0],
      explanation:
        'nginx buffers upstream responses by default, so events sit in the buffer until it fills or the response ends — bursts. proxy_read_timeout defaults to 60 s between reads from upstream, so a quiet stream is cut; raise it and send periodic comment heartbeats. gzip adds more buffering. nginx does not proxy to upstreams over HTTP/2 with proxy_pass. keepalive_timeout governs idle client keep-alive between requests, not an active streaming response.',
      followUps: [
        {
          "q": "The SSE stream also passes through an AWS ALB and a CDN. What else must be configured end to end?",
          "a": "Every hop must allow long-lived, unbuffered responses. ALB idle timeout (default 60 s) must exceed the heartbeat interval; with 15 s heartbeats that's fine, or raise it to say 120 s. The CDN must not cache or buffer the stream: set `Cache-Control: no-cache` (or no-store), make sure the route bypasses caching, and check the CDN supports streaming responses (many do for `text/event-stream`, some time out after a maximum response duration, e.g. 60–180 s, which forces clients to reconnect). Clients should reconnect automatically using `Last-Event-ID` so no events are lost across cutoffs."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-14',
      difficulty: 'expert',
      question:
        'A gateway runs its filters in this order: route → validate token via IdP introspection → per-API-key rate limit → per-IP rate limit. Attackers send 50K req/s with random fake bearer tokens. Select ALL problems this ordering causes.',
      options: [
        'Every fake token triggers an introspection call before any limit applies, so the IdP absorbs the attack',
        'The per-key limit is keyed on attacker-chosen tokens, so each random token gets a fresh bucket',
        'The per-IP limit runs last, after all the expensive work it was supposed to prevent',
        'Routing first means attackers can reach internal services without any token',
        'Rate limiting after authentication makes the 429 responses leak which tokens are valid',
      ],
      correct: [0, 1, 2],
      explanation:
        'Order filters from cheapest rejection to most expensive: WAF/IP limits, then local JWT verification (or cached introspection), then per-identity quotas keyed on verified identity. Here the IdP takes the full 50K req/s, random tokens bypass per-key buckets, and the IP limiter protects nothing. Routing decides the destination but the request still has to pass authentication before forwarding, so it does not open internal services. 429s after authentication do not reveal token validity beyond what the 401 already does.',
      followUps: [
        {
          "q": "You must keep introspection because tokens are opaque. How do you stop the IdP from absorbing the attack?",
          "a": "Put cheap rejections first and cache. Order: WAF and per-IP limits (catch most volumetric abuse); a negative cache for invalid tokens (`invalid:<hash>` for 60 s) and a positive cache for valid ones (until token expiry or 60 s), so repeated tokens never reach the IdP; a format check, since real opaque tokens have a known prefix, length or checksum, so random strings fail locally. Put a concurrency limit and circuit breaker on introspection calls themselves. Longer term, issue self-contained signed tokens (JWT) verified locally with cached keys, so the IdP is off the request path."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-15',
      difficulty: 'medium',
      question:
        'Users upload videos of up to 4 GB. The API gateway has a 10 MB body limit and a 30 s timeout, and gateway pods OOM when limits are raised. What is the best design?',
      options: [
        'Raise the body limit to 5 GB and the timeout to 1 hour on the upload route only',
        'Split files into 9 MB chunks sent through the gateway and reassemble them in a service',
        'Move uploads behind an L4 balancer so the gateway does not buffer them',
        'Have the API issue a pre-signed (multipart) upload URL so the client uploads straight to object storage, then notify the API on completion',
      ],
      correct: [3],
      explanation:
        'Pre-signed multipart uploads take the bytes off your compute path entirely: storage handles parallel parts, retries per part, and scale, while the gateway only sees small control calls. Raising limits keeps multi-GB streams on gateway pods (the OOMs you already see). Chunking through the gateway works but multiplies gateway traffic and reinvents multipart upload. An L4 hop loses auth and routing, and something still has to receive the bytes.',
      followUps: [
        {
          "q": "With pre-signed uploads, how do you prevent abuse: huge files, wrong content types, or uploads that never get confirmed?",
          "a": "Constrain the URL: issue it with a short expiry (15 minutes), a fixed object key per upload id, and for POST policies a `content-length-range` (max 4 GB) and allowed `Content-Type`. Multipart uploads: the API creates the upload and signs each part, so you can cap the part count. On completion, the client calls the API; the API verifies the object exists via `HeadObject` (size, type), then triggers processing such as a virus scan and transcode from an S3 event, never trusting the client. A lifecycle rule aborts incomplete multipart uploads after 1 day and deletes unconfirmed objects after a few days, so abandoned uploads don't accumulate cost."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-16',
      difficulty: 'hard',
      question:
        'Your GraphQL limiter charges 1 point per distinct field name in the selection set, plus list multipliers. Roughly how much work does this query cause relative to what it is charged?',
      code: {
        language: 'graphql',
        code: `query {
  a: search(term: "a", first: 100) { id title price }
  b: search(term: "b", first: 100) { id title price }
  c: search(term: "c", first: 100) { id title price }
  # ... 50 aliases in total, all calling search(first: 100)
}`,
      },
      options: [
        'The same: aliases resolve to one cached search call, so it costs one search',
        'About 100× more: only the first: 100 multiplier is ignored',
        'Less than charged: GraphQL deduplicates identical field names before execution',
        'About 50× more: every alias runs its own search, but the limiter counts the field name search once',
      ],
      correct: [3],
      explanation:
        'Each alias is a separate field in the response and a separate resolver invocation with its own arguments, so 50 aliases trigger 50 searches of up to 100 items. A limiter keyed on distinct field names charges it as one. Cost analysis must walk every field node including aliases (and cap alias count). GraphQL merges identical fields only when name and arguments match exactly; different arguments are separate executions, and DataLoader would not dedupe different search terms.',
      followUps: [
        {
          "q": "Design a cost analysis that charges this query fairly. What's the cost formula, and where does it run?",
          "a": "Before execution, walk the parsed operation's full AST including aliases and fragments: each field costs a base weight (1, or more for known expensive resolvers like `search`, say 10), multiplied by its list multiplier (`first: 100` means children are charged ×100), with the parent's multiplier propagating down. Here: 50 aliases × (10 + 100 × child fields). Reject queries above a maximum cost per request (400 with the computed cost), and deduct the cost from the client's points budget. Also cap alias count and depth. Run it in the router or gateway, before any subgraph call."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-17',
      difficulty: 'expert',
      question:
        'A /reports endpoint allows 10 requests/s per client. Each report query takes 8 s. Each of 20 pods has a 20-connection DB pool. One client sends exactly 10 req/s, sustained. What happens?',
      options: [
        'The client holds ~80 connections (10/s × 8 s), 20% of all 400, and still within its rate limit; a few such clients exhaust the pools',
        'Nothing: 10 req/s is within the limit, so the client uses 10 connections',
        'The rate limiter blocks the client after 1 s because 10 requests are still in flight',
        'The client holds 8 connections, one per second of query duration',
      ],
      correct: [0],
      explanation:
        'Little\'s law: in-flight = arrival rate × duration = 10 × 8 = 80 concurrent queries, spread over 400 connections — five such clients take everything, all while obeying the rate limit. A rate limiter only counts arrivals, not in-flight work, so it never fires. The fix is a per-client concurrency limit (for example 5 in flight) or an async job model for reports.',
      followUps: [
        {
          "q": "You add a per-client concurrency limit of 5. The client's dashboards now get 429s constantly. Is that the right product experience?",
          "a": "The limit is right, but synchronous 8-second reports are the wrong model. Move reports to an async job API: `POST /reports` returns 202 with a job id, a worker pool with per-tenant concurrency limits computes it, and the client polls or receives a webhook or SSE when done. Cache results for identical report parameters so 300 dashboards asking for the same report compute it once. For interactive dashboards, precompute aggregates (materialised views refreshed every few minutes) so queries take milliseconds. Then concurrency limits rarely trigger, and when they do, the client waits rather than fails."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-18',
      difficulty: 'medium',
      question:
        'You will lower the free tier from 1,000 to 300 requests/min per key. Offline analysis suggests 3% of keys exceed 300. What is the safest rollout?',
      options: [
        'Enforce immediately; the 3% are abusing the free tier by definition',
        'Enforce for new keys only and grandfather existing keys forever',
        'Run the new limit in shadow mode, logging would-be 429s per key, notify affected customers, then enforce gradually with RateLimit headers already exposed',
        'Enforce at 300 but make it fail open, so errors are silently ignored if the limiter is wrong',
      ],
      correct: [2],
      explanation:
        'Shadow mode measures real impact on current traffic (offline analysis often misses bursts and batch jobs), lets you contact the affected customers, and exposing the headers first lets clients self-pace before enforcement. Immediate enforcement risks breaking paying-intent integrations. Permanent grandfathering never fixes the capacity problem. Fail-open is about limiter outages, not about rolling out a new policy.',
      followUps: [
        {
          "q": "Which headers do you expose before enforcement, and how should clients use them?",
          "a": "Expose the IETF RateLimit fields: `RateLimit-Policy: 300;w=60` describing the quota, and `RateLimit: limit=300, remaining=42, reset=17` on each response (older APIs use `X-RateLimit-Limit/Remaining/Reset`). On 429, include `Retry-After`. Clients should pace themselves: when `remaining` gets low, slow down so it lasts until `reset`, and honour `Retry-After` exactly with jitter. During shadow mode, add `remaining` computed against the future 300 limit (or a separate warning header) so clients see where they'd be throttled, and email owners of keys that would have been limited."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-19',
      difficulty: 'expert',
      question:
        'This handler sits behind a CDN whose cache key is method + host + path. Clients send a bearer token. What happens?',
      code: {
        language: 'typescript',
        code: `app.get('/api/me', requireAuth, async (req, res) => {
  const profile = await users.findById(req.user.id);
  // "profile rarely changes; let the CDN absorb traffic"
  res.set('Cache-Control', 'public, s-maxage=300');
  res.json(profile);
});`,
      },
      options: [
        'Nothing bad: shared caches never store responses to requests with an Authorization header',
        'The CDN caches one copy per token because the Authorization header is always part of the cache key',
        'Browsers cache the response, but the CDN ignores s-maxage for JSON responses',
        'The CDN stores the first user\'s profile and serves it to every user who calls /api/me for 5 minutes',
      ],
      correct: [3],
      explanation:
        'RFC 9111 §3.5 lets a shared cache reuse a response to an Authorization-bearing request if the response explicitly allows it with public, s-maxage or must-revalidate — this one does. The cache key does not include the token, so user A\'s profile is served to user B. Authorization is not in the key by default on major CDNs, and s-maxage applies to any content type. Use Cache-Control: private (or no-store) for per-user responses.',
      followUps: [
        {
          "q": "The response has been cached for 3 minutes already. What do you do right now, in order?",
          "a": "1. Deploy or hotfix the header to `Cache-Control: private, no-store` on `/api/me`. 2. Purge `/api/me` on the CDN (path purge across all PoPs) immediately after, so no new cached copies remain; purge again after the fix is fully deployed to catch any copy cached in between. 3. Add a CDN rule to never cache `/api/*` responses for requests with an Authorization header, as defence in depth. 4. Assess exposure: CDN logs show which users received cache hits for that path during the window, and treat it as a data-exposure incident with your privacy or security process, which may include notification. 5. Add a test asserting per-user endpoints return `private`."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-20',
      difficulty: 'hard',
      question:
        'A bad deploy made the origin return 404 for /product/123 for 15 seconds. A global middleware sets Cache-Control: public, max-age=3600 on every response. Rollback finished long ago, yet some regions still show "Product not found" 40 minutes later. What explains this, and what is the durable fix?',
      options: [
        'The CDN cached the 404 for an hour at every PoP that fetched during the window; purge now, and give error responses short TTLs separate from success TTLs',
        'Browsers cached the 404 because they ignore s-maxage; tell users to hard-refresh',
        'DNS still points some regions at the old deployment; lower the DNS TTL',
        'The origin shield is serving stale-if-error content; disable stale-if-error',
      ],
      correct: [0],
      explanation:
        'The middleware marked the 404 cacheable for 3,600 s, so each PoP (or the shield) that fetched during those 15 s keeps it for an hour — regional because only some PoPs missed during the window. Purge the path and set error TTLs in seconds (many CDNs allow per-status TTLs). Browsers may also cache it, but not a whole region consistently. DNS is unrelated after a rollback of the same origin. stale-if-error serves old success responses when origin errors — it would have helped, not hurt.',
      followUps: [
        {
          "q": "Set per-status TTLs. What values do you choose for 200, 301, 404, 500 and 503, and why?",
          "a": "200 for product pages: the business TTL, say 5–60 minutes with stale-while-revalidate. 301 permanent redirects: long (hours to a day) since they rarely change. 404: short, say 30–60 s, which absorbs bot floods for missing ids without stranding real products for long after a publishing glitch. 500: don't cache (0), and serve stale-if-error from the previous 200 instead. 503 with `Retry-After`: cache a few seconds at most, or not at all, so recovery is visible instantly. Apply them at the CDN as overrides, so a misbehaving origin middleware can't set an hour-long TTL on errors again."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-21',
      difficulty: 'expert',
      question:
        'A product listing page has a 55% CDN hit ratio. Which cache-key changes raise the hit ratio without ever serving the wrong content? Select ALL that apply.',
      options: [
        'Exclude utm_source, utm_campaign, gclid and fbclid from the cache key (the origin ignores them)',
        'Sort query parameters so ?page=2&sort=price and ?sort=price&page=2 share an entry',
        'Ignore the whole query string, since most traffic is to the first page',
        'Add the full User-Agent to the key so mobile and desktop get the right layout',
        'Normalise Accept-Encoding into a few buckets (br, gzip, identity) before keying',
      ],
      correct: [0, 1, 4],
      explanation:
        'Removing parameters the origin ignores, sorting parameters and normalising Accept-Encoding all collapse equivalent requests into one entry without changing the response. Ignoring the whole query string would serve page 1 for ?page=2 — wrong content. Keying on the full User-Agent fragments the cache into thousands of variants and lowers the hit ratio; use a normalised device-class header instead.',
      followUps: [
        {
          "q": "Mobile and desktop really do need different HTML. How do you vary the cache without keying on the full User-Agent?",
          "a": "Normalise at the edge: a CDN edge function or rule classifies the User-Agent into a small set (`mobile`, `tablet`, `desktop`), sets a request header such as `X-Device-Class`, and includes only that header in the cache key. The origin returns `Vary: X-Device-Class` for correctness with other caches. That's 3 variants instead of thousands. Better long term: one responsive HTML for all devices, so no variation is needed at all. Client Hints (`Sec-CH-UA-Mobile`) can replace UA sniffing in browsers that send them."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-22',
      difficulty: 'expert',
      question:
        'Each tenant has its own Postgres schema. The app connects through PgBouncer in transaction pooling mode. Under load, tenant B sometimes sees tenant A\'s data. Why?',
      code: {
        language: 'typescript',
        code: `export async function withTenant<T>(tenant: string, fn: (c: PoolClient) => Promise<T>) {
  const client = await pool.connect();          // pg Pool -> PgBouncer (pool_mode=transaction)
  try {
    await client.query('SET search_path TO ' + pg.escapeIdentifier(tenant));
    return await fn(client);                    // fn runs several queries, some outside BEGIN
  } finally {
    client.release();
  }
}`,
      },
      options: [
        'escapeIdentifier fails for schema names with hyphens, so the SET falls back to the public schema',
        'pg Pool reuses client objects, and release() does not reset search_path on the client side',
        'Postgres caches query plans per schema and reuses tenant A\'s plan for tenant B',
        'SET search_path is session state; in transaction mode each statement outside a transaction may run on a different server connection, which still has another tenant\'s search_path',
      ],
      correct: [3],
      explanation:
        'In transaction pooling, PgBouncer assigns a server connection per transaction; a bare SET is its own transaction, so it changes some server connection, and the next query may run on a different one — whose search_path another tenant set. Use SET LOCAL inside an explicit BEGIN/COMMIT with all tenant queries, or fully qualified table names. escapeIdentifier quotes hyphens correctly. The client-side Pool is not where the session state lives; the server connection is. Plans reference resolved tables, so plan caching does not cross schemas this way.',
      followUps: [
        {
          "q": "Rewrite the data access so tenant isolation holds even if someone forgets the transaction wrapper.",
          "a": "Defence in depth: use a per-request transaction helper that always runs `BEGIN; SET LOCAL search_path = tenant_x; ...; COMMIT` on one client, and make it the only exported way to query. Add Postgres row-level security as a backstop where data is shared-schema (`SET LOCAL app.tenant_id` with RLS policies checking it). For schema-per-tenant, use fully qualified table names generated from the verified tenant (`\"tenant_x\".orders`), so the query never relies on session state at all. Test: run concurrent requests for two tenants through PgBouncer and assert no row from tenant A ever appears for B."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-23',
      difficulty: 'hard',
      question:
        'This NestJS app passes all single-user tests, but under concurrent load audit logs occasionally record the wrong tenant for a request. What is the root cause?',
      code: {
        language: 'typescript',
        code: `let currentTenant: string | undefined;          // module scope

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    currentTenant = (req as any).auth.tenantId;   // set from verified JWT
    next();
  }
}

export async function audit(action: string) {
  await auditRepo.insert({ tenant: currentTenant, action, at: new Date() });
}`,
      },
      options: [
        'The JWT claim is read before the auth guard runs, so it is sometimes undefined',
        'A module-level variable is shared by all in-flight requests; another request overwrites it while this one is awaiting I/O',
        'NestJS middleware runs in a worker thread, so the variable is copied rather than shared',
        'auditRepo.insert batches rows and reorders them, attaching tenants to the wrong actions',
      ],
      correct: [1],
      explanation:
        'Node serves many requests concurrently on one thread; between awaits, another request\'s middleware reassigns currentTenant, so audit() reads whichever tenant was set last. Use AsyncLocalStorage (als.run(ctx, next)) or a request-scoped provider so the context follows each async chain. The value is set from req.auth, so ordering would produce undefined, not another tenant. Middleware does not run in worker threads, and the repository does not reorder fields within a row.',
      followUps: [
        {
          "q": "You move to AsyncLocalStorage. Where can the context still get lost, and how do you test for it?",
          "a": "Context is lost when work escapes the async chain that started inside `als.run()`: callbacks from libraries that use their own pooled resources without `AsyncResource` binding (some older DB drivers, event emitters registered at startup), work queued and executed later by a shared worker (BullMQ jobs, setInterval batches), and messages consumed from a queue, where you must restore context from the message headers. Test with a concurrency test: fire 1,000 interleaved requests for 50 tenants with random delays, and assert every audit row's tenant matches its request. Run it in CI."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-24',
      difficulty: 'hard',
      question:
        'A shared Redis (maxmemory 32 GB, allkeys-lru) caches data for all tenants. One tenant\'s nightly job warms 20 GB of its own keys. Next morning, other tenants\' cache hit ratio drops from 95% to 60% and DB load triples. What is the best structural fix?',
      options: [
        'Switch to allkeys-lfu so frequently used keys of other tenants survive',
        'Increase maxmemory to 64 GB so everyone fits',
        'Give heavy tenants (or bulk workloads) a separate cache instance or a per-tenant memory budget, and have the job write with short TTLs or skip the shared cache',
        'Add a random TTL jitter to all keys so evictions spread out over time',
      ],
      correct: [2],
      explanation:
        'Shared LRU has no notion of tenants: a big sequential warm-up is "recent" and pushes out everyone else\'s hot keys. Isolation needs a budget per tenant or workload — a separate instance, or keeping bulk-job data out of the shared cache. LFU helps against one-off scans, but a 20 GB warm-up that is read once or twice can still displace a lot, and it does not bound any tenant. Doubling memory postpones the problem until the job grows. TTL jitter prevents synchronized expiry, not eviction by volume.',
      followUps: [
        {
          "q": "You can't afford a separate instance per tenant. How would you enforce per-tenant memory budgets in one Redis?",
          "a": "Redis has no native per-tenant memory limits, so enforce them in the application. Options: track approximate bytes per tenant (sum of value sizes at write time in a counter `mem:<tenant>`, decremented on delete or expiry, or periodically estimated with sampled `MEMORY USAGE`) and refuse to cache new entries for tenants over budget, which then just read through to the DB; give bulk or low-priority data short TTLs so it can't accumulate; and key bulk-job data under a prefix stored in a separate, smaller logical cache. For the biggest tenants, a dedicated instance is often worth it."
        }
      ],
    },
    {
      id: 'misc-traffic-edge-mcq-25',
      difficulty: 'expert',
      question:
        'All tenants\' jobs go through one Kafka topic keyed by tenant_id (24 partitions, 24 consumers). One tenant enqueues a 2M-job import, and small tenants whose IDs hash to the same partition wait hours. Select ALL changes that restore fairness.',
      options: [
        'Consumers pull into per-tenant in-memory sub-queues and serve them round-robin (deficit round robin), with bounded buffering',
        'Route bulk imports to a separate "bulk" topic with its own consumer group, so interactive jobs never queue behind them',
        'Add 24 more consumers to the same group so the backlog drains twice as fast',
        'Apply a Kafka producer quota (byte-rate) to the import client, so its backlog builds at the producer instead of in the shared partition',
        'Increase the partition count to 48; the large tenant then spreads across twice as many partitions',
      ],
      correct: [0, 1, 3],
      explanation:
        'Per-tenant sub-queues with round-robin give small tenants a turn even when they share a partition with the whale; a separate bulk lane isolates the workload class; and producer quotas slow the aggressor at the source. Consumers beyond the partition count sit idle, so 24 more add nothing. More partitions do not spread one key — the tenant_id key still maps the whole tenant to one partition; it only shrinks the set of unlucky neighbours (and remaps keys, breaking ordering during the change).',
      followUps: [
        {
          "q": "Implement deficit round robin in the consumer. What happens to offset commits when tenants are served out of order?",
          "a": "Messages from one partition are consumed in offset order but processed out of order across tenant sub-queues, so you can't commit 'up to offset N' just because a later message finished. Track completion per offset and commit only the highest contiguous completed offset (a watermark). If the whale's backlog sits in its sub-queue, the watermark stalls at the whale's oldest unprocessed message, so a crash replays everything after it; handlers must be idempotent. Bound buffering: pause the partition when total buffered messages or any single tenant's sub-queue exceeds a cap, otherwise the whale's 2M jobs fill memory."
        }
      ],
    },
  ],
};

export default topic;
