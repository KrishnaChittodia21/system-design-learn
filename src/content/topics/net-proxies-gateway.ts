import type { Topic } from '../../types';

const topic: Topic = {
  id: 'net-proxies-gateway',
  phase: 'networking',
  order: 3,
  title: 'Reverse Proxy, Forward Proxy, API Gateway & BFF',
  subtitle:
    'The edge of your system: what each layer does, where cross-cutting concerns belong, how BFFs aggregate, and how gateways fail.',
  estimatedMinutes: 75,
  sources: [
    'Mastering API Architecture — Ch 3 API Gateways: Ingress Traffic Management',
    'Alex Xu — System Design Interview Vol 1 (API gateway / rate limiter context)',
    'NGINX, Envoy and Kong official documentation',
  ],
  tags: ['reverse-proxy', 'forward-proxy', 'api-gateway', 'bff', 'edge', 'nginx', 'envoy', 'kong', 'north-south'],
  cheatSheet: [
    'Forward proxy protects/controls CLIENTS (egress filtering); reverse proxy protects/fronts SERVERS (TLS, caching, routing).',
    'LB = reverse proxy + many backends + health checks; API gateway = LB + API concerns (authN/Z, rate limits, transformation, composition, per-consumer telemetry).',
    'Edge stack order: DNS → CDN → L4 LB → WAF/ADC → API gateway → services. Each hop adds ~0.3–2 ms in-DC; TLS handshakes cost 1–2 RTT — terminate once, reuse upstream keepalive.',
    'BFF = one thin API per client experience (web, iOS, partner), owned by the frontend team; aggregates, trims payloads, adapts protocols. Keep business rules in domain services.',
    'Aggregation rule: fan out in parallel with per-call timeouts under a total deadline; return partial data for non-critical parts; never let one slow dependency hold the whole page.',
    'Gateway pitfalls (Mastering API Ch 3): gateway loopback (internal calls hairpin via public edge), gateway as ESB (business logic in plugins), turtles all the way down (gateway per concern), routing on payload.',
    'Gateway is on the critical path of ~100% of traffic: run N+2 across ≥3 AZs, keep it stateless (state in Redis/control plane), canary config changes, decide fail-open vs fail-closed per plugin.',
    'Trust boundaries: only trust X-Forwarded-For from known proxies (set_real_ip_from + real_ip_recursive); strip client-supplied identity headers (X-User-Id) before injecting your own.',
    'Retries at the edge: only idempotent methods or with Idempotency-Key; one retry layer, with a budget (≤10–20% extra load), per-try timeout < total timeout.',
    'Build vs buy: almost always buy/adopt (Kong, Envoy-based, AWS API GW, Apigee); TCO and opportunity cost of a homegrown gateway are chronically underestimated.',
  ],
  sections: [
    {
      heading: 'Forward proxy vs reverse proxy vs load balancer vs API gateway',
      body: `**Intuition:** a *forward proxy* is your company's receptionist making outbound calls on employees' behalf; a *reverse proxy* is the receptionist at the front desk of the building that decides which office a visitor goes to. Same mechanism (an intermediary that terminates a connection and opens another), opposite side of the trust boundary.

**Forward proxy** — sits next to clients. Clients are configured to use it (explicit proxy, \`HTTP CONNECT\` for TLS) or traffic is intercepted transparently. Uses: egress filtering/allow-listing (e.g. pods may only call \`api.stripe.com\`), audit, caching, hiding client IPs, corporate SSO. In backend systems you meet it as an **egress proxy** (Squid, Envoy egress, NAT + allow list) used to pin outbound IPs for partners who allow-list you.

**Reverse proxy** — sits next to servers; clients think it *is* the server. Uses: TLS termination, compression, static/edge caching, request buffering (protects slow app servers from slow clients — the classic nginx-in-front-of-Node reason), hiding topology.

**Load balancer** — a reverse proxy with *many* backends, health checks and a balancing algorithm. L4 (TCP/UDP, sees IP:port) or L7 (HTTP, sees path/headers).

**API gateway** — a reverse proxy/L7 LB that understands **APIs and consumers**: authentication, authorization, per-consumer rate limits/quotas, request/response transformation, API composition, retries/circuit breaking, per-route telemetry, and often API management (developer portal, API keys, monetisation). It is implemented as a **control plane** (where operators define routes and policies) and a **data plane** (where packets are routed and policies enforced).

The book's key advice: *always use the simplest solution that meets your current and known near-term requirements.* One backend, TLS only? A reverse proxy is enough. Many services, many consumers, cross-cutting security needs? That is when a gateway earns its keep.`,
      diagram: `Feature              Reverse proxy   Load balancer   API gateway
-------------------  -------------   -------------   -----------
Single backend            yes             yes            yes
TLS termination           yes             yes            yes
Multiple backends          -              yes            yes
Service discovery          -              yes            yes
API composition            -               -             yes
AuthN / AuthZ              -               -             yes
Retries / circuit brk      -               -             yes
Rate limiting / quota      -               -             yes
Per-consumer telemetry     -               -             yes
          (after Mastering API Architecture, Table 3-1)`,
      keyPoints: [
        'Forward proxy = client-side trust boundary (egress control); reverse proxy = server-side (ingress).',
        'API gateway = reverse proxy that knows about consumers, APIs and policies; control plane + data plane.',
        'Pick the simplest component that satisfies known requirements; gateways add a hop, a team and a failure mode.',
      ],
      source: 'Mastering API Architecture — Ch 3 (Tables 3-1, 3-2)',
    },
    {
      heading: 'The modern edge stack: CDN → WAF → LB → gateway',
      body: `**Intuition:** airport security has layers — the car park barrier, ticket check, security scan, gate agent. Each layer rejects a class of problems cheaply before the expensive layer sees it.

| Layer | Operates at | Job | Typical tech |
|---|---|---|---|
| DNS / GSLB | DNS | Pick region, failover, latency/geo routing | Route 53, Cloudflare, NS1 |
| CDN | L7, at PoPs | Cache static + cacheable API responses, absorb volumetric DDoS, TLS near user | CloudFront, Fastly, Akamai |
| L4 LB | TCP/UDP | Spread connections, millions of conns, very cheap per packet | AWS NLB, Maglev, IPVS |
| WAF / ADC | L7 | OWASP rules (SQLi, XSS), bot detection, geo-blocking | AWS WAF, Cloudflare WAF, ModSecurity |
| API gateway | L7 | AuthN/Z, quotas, routing, transformation, telemetry | Kong, Envoy Gateway, AWS API GW, Apigee |
| Services / BFF | App | Business logic | NestJS, Go, etc. |

**Latency budget.** Inside one region an extra proxy hop costs roughly **0.3–2 ms** at p50 (more at p99 if it buffers bodies or calls out for auth). A new TLS 1.3 handshake is 1 RTT (TLS 1.2: 2 RTT) — 50–150 ms on mobile. So: terminate TLS as close to the user as possible (CDN), keep **long-lived keepalive/HTTP2 connections** from each layer to the next, and don't re-handshake at every hop.

**Ownership matters.** Historically each layer was owned by a different team (CDN vendor team, network team, InfoSec, app team) and exposing a new API took five tickets — part of why DevOps emerged. When migrating to cloud, question whether you still need every layer: a managed ALB + WAF + a gateway often replaces hardware LB + ADC + separate WAF appliances.

**Security SPOFs can fail open.** Some WAF/auth components, when unhealthy, pass traffic straight through. That may be fine for a content site, and unacceptable for a bank. Know which behaviour each layer has.`,
      diagram: `  client
    |  DNS (geo / latency / health-based answer)
    v
 +------+   cache hit -> return at PoP (~10-30 ms from user)
 | CDN  |---------------------------------------------+
 +------+   miss / dynamic API                        |
    v                                                 |
 +--------+  TCP-level spread, conn tracking          |
 | L4 LB  |  (NLB / Maglev)                           |
 +--------+                                           |
    v                                                 |
 +--------+  OWASP rules, bot score, geo block        |
 |  WAF   |                                           |
 +--------+                                           |
    v                                                 |
 +-----------+  authN/Z, quotas, route, transform     |
 | API GW x N|  (stateless, >=3 AZs)                  |
 +-----------+                                        |
   |     |     \\                                      |
  BFF  orders  users ...  (east-west -> service mesh) |`,
      keyPoints: [
        'Reject cheap-to-detect bad traffic as early (and as far out) as possible.',
        'Terminate TLS once near the user; reuse keepalive/HTTP2 between layers.',
        'Know whether each security layer fails open or closed.',
      ],
      source: 'Mastering API Architecture — Ch 3 (Figure 3-4, “A modern edge stack”)',
    },
    {
      heading: 'Gateway responsibilities (and a production nginx config)',
      body: `**Intuition:** the gateway is where you implement "every API must do X" once, instead of in 40 services in 4 languages.

**Core responsibilities**

- **Routing** — path/host/header based, canary weights, strangler-fig migration (\`/attendees\` → new service, \`/\` → monolith). *Avoid routing on request payloads*: it couples the gateway to a schema and forces expensive body parsing.
- **Authentication offload** — validate JWT signature/expiry locally with cached JWKS (microseconds), or introspect opaque tokens (a network call — cache results). Forward a verified identity downstream (e.g. \`X-User-Id\` after stripping any client-supplied copy, or a short-lived internal token).
- **Coarse authorization** — "is this key allowed to call this API/scope?" Fine-grained "can user 42 edit order 99?" stays in the service that owns orders.
- **Rate limiting & quotas** — per API key / user / IP; local token buckets are fast but approximate across N gateway nodes; global counters in Redis are accurate but add ~0.5–1 ms.
- **Transformation** — header injection, protocol translation (REST ↔ gRPC, gRPC-Web), response trimming, versioned path rewrites.
- **Aggregation/composition** — light fan-out for a single call; heavier, client-specific composition belongs in a **BFF**.
- **Resilience** — timeouts, limited retries on idempotent requests, circuit breaking, load shedding (return 503 fast rather than queueing).
- **Observability** — request IDs / W3C \`traceparent\` injection, per-route and per-consumer RED metrics, access logs.

The nginx config below is a realistic "reverse proxy acting as a light gateway": real client IP from a trusted LB, request IDs, a per-IP limit, keepalive to upstreams, sane timeouts, and retries only where safe.`,
      code: [
        {
          language: 'nginx',
          title: 'nginx as edge reverse proxy / light gateway',
          code: `# Trust X-Forwarded-For only from our L4/L7 LB subnet
set_real_ip_from 10.0.0.0/16;
real_ip_header   X-Forwarded-For;
real_ip_recursive on;              # skip trusted hops, take the first untrusted IP

# 10 MB zone ~ 160K client states (1 MB ~ 16K 64-byte states)
limit_req_zone $binary_remote_addr zone=per_ip:10m rate=20r/s;

upstream orders_svc {
  server orders-1.internal:3000 max_fails=3 fail_timeout=10s;
  server orders-2.internal:3000 max_fails=3 fail_timeout=10s;
  keepalive 64;                    # idle upstream conns cached per worker
}

server {
  listen 443 ssl http2;
  server_name api.example.com;
  client_max_body_size 1m;         # reject huge bodies at the edge

  location /v1/orders/ {
    limit_req zone=per_ip burst=40 nodelay;
    limit_req_status 429;

    proxy_pass http://orders_svc;
    proxy_http_version 1.1;        # required for upstream keepalive
    proxy_set_header Connection "";  # drop 'close' so conns are reused
    proxy_set_header Host $host;
    proxy_set_header X-Request-Id $request_id;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-User-Id "";   # never trust client-supplied identity

    proxy_connect_timeout 1s;
    proxy_read_timeout 5s;
    # default: POST/PATCH are NOT retried once sent (nginx >= 1.9.13)
    proxy_next_upstream error timeout http_502 http_503;
    proxy_next_upstream_tries 2;
  }
}`,
        },
      ],
      keyPoints: [
        'Authentication at the edge, fine-grained authorization in the owning service.',
        'Strip-then-inject identity headers; never trust client-set X-User-Id or X-Forwarded-For.',
        'Upstream keepalive needs HTTP/1.1 and an empty Connection header in nginx.',
      ],
      source: 'Mastering API Architecture — Ch 3 (“What functionality does an API gateway provide?”)',
    },
    {
      heading: 'Envoy and Kong: declarative gateway config',
      body: `**Intuition:** modern gateways are configured like Kubernetes — you declare routes and policies as data, commit them to git, and a pipeline applies them. No clicking in admin UIs in production.

**Envoy** (the data plane under Istio, Envoy Gateway, Contour, Emissary/Ambassador, Gloo) is configured via static YAML or dynamically via **xDS** APIs from a control plane. Its route config gives you precise control of timeouts, retries and per-try timeouts — note that the **route timeout is the total budget including retries**, while \`per_try_timeout\` bounds each attempt.

**Kong** (built on OpenResty = nginx + LuaJIT) models *services*, *routes*, *consumers* and *plugins* (jwt, key-auth, rate-limiting, request-transformer, prometheus…). Its decK/declarative format fits GitOps. Rate-limiting has \`local\` (per-node, fastest, approximate), \`cluster\` (DB-backed) and \`redis\` (shared, accurate) policies.

**Kubernetes Gateway API** (\`Gateway\`, \`HTTPRoute\`) is the successor to the Ingress resource and is implemented by Envoy Gateway, Istio, Kong, NGINX Gateway Fabric, etc. — worth naming in interviews as the portable way to declare north–south routes.

**Taxonomy (book Table 3-3):**

| Type | Primary purpose | Typical owner | Watch out |
|---|---|---|---|
| Traditional enterprise gateway | Expose + manage business APIs, full lifecycle, portal, monetisation | API management team | Heavy dependencies (DBs) that also need HA/DR |
| Microservices / micro gateway | Route ingress to services, declarative, dev self-service | Service teams via GitOps | Fewer API-management features |
| Service mesh gateway | Get external traffic *into* the mesh | Platform team | Thin on auth/IdP/WAF integration; don't adopt a mesh just for this |`,
      code: [
        {
          language: 'yaml',
          title: 'Envoy route: timeouts, retries, header-based canary',
          code: `route_config:
  name: edge
  virtual_hosts:
    - name: api
      domains: ['api.example.com']
      routes:
        - match:
            prefix: '/v1/orders'
            headers:
              - name: x-canary
                string_match: { exact: 'true' }
          route: { cluster: orders_v2, timeout: 3s }
        - match: { prefix: '/v1/orders' }
          route:
            cluster: orders_v1
            timeout: 3s                 # total budget, retries included
            retry_policy:
              retry_on: 'connect-failure,refused-stream,unavailable'
              num_retries: 2
              per_try_timeout: 1s       # each attempt bounded
              retry_back_off: { base_interval: 0.05s, max_interval: 0.3s }`,
        },
        {
          language: 'yaml',
          title: 'Kong declarative config: JWT + rate limiting per consumer',
          code: `_format_version: '3.0'
services:
  - name: orders
    url: http://orders.internal:3000
    connect_timeout: 1000     # ms
    read_timeout: 5000
    retries: 1
    routes:
      - name: orders-v1
        paths: ['/v1/orders']
        strip_path: false
    plugins:
      - name: jwt              # validates signature + exp claim
      - name: rate-limiting
        config:
          minute: 600
          limit_by: consumer
          policy: local        # per-node; use redis for accurate global limits
      - name: prometheus
consumers:
  - username: mobile-app
    jwt_secrets:
      - key: mobile-issuer
        algorithm: RS256
        rsa_public_key: |
          -----BEGIN PUBLIC KEY-----
          ...
          -----END PUBLIC KEY-----`,
        },
      ],
      keyPoints: [
        'Envoy route timeout = total budget; per_try_timeout bounds each retry.',
        'Kong local rate-limit policy is per node: with 10 nodes a 600/min limit can admit up to ~6000/min worst case.',
        'Gateway API (HTTPRoute) is the portable Kubernetes north–south abstraction.',
      ],
      source: 'Mastering API Architecture — Ch 3 (taxonomy, Table 3-3); Envoy & Kong docs',
    },
    {
      heading: 'Backend for Frontend (BFF) and aggregation',
      body: `**Intuition:** a restaurant has one kitchen but different menus for dine-in, takeaway and kids. A BFF is a *menu per client* — same domain services behind it, different shape of response in front.

**Why BFF.** A mobile home screen may need user, cart, recommendations and promotions. Calling four services from a phone over a 150 ms RTT network costs four round trips, extra battery and leaks internal topology. One generic "public API" tries to serve web, iOS, Android, TV and partners and becomes bloated with flags. A BFF per experience (web, mobile, partner) — **owned by the team that builds that frontend** — does:

- fan-out + aggregation in the data centre (sub-ms RTT between services),
- payload trimming (mobile gets 3 KB, not 40 KB),
- protocol adaptation (gRPC internally → JSON/GraphQL outside),
- client-specific caching and feature flags.

**What a BFF must not do:** own business rules (pricing, eligibility) — those drift between BFFs and you get "the discount differs on iOS". Keep BFFs thin; push shared logic down into domain services.

**BFF vs gateway vs GraphQL.** The gateway handles cross-cutting concerns for *all* traffic; BFFs sit *behind* it and handle *experience* concerns. A GraphQL server (or federated supergraph) is a common way to implement a BFF: clients choose fields, resolvers fan out — but you then own query cost limits, DataLoader batching and persisted queries.

**Aggregation rules that survive production**

1. Fan out **in parallel**, each call with its own timeout, all under a **total deadline** (e.g. 300 ms for the page).
2. Classify dependencies: *critical* (user, cart → fail the request) vs *optional* (recommendations → omit and mark degraded).
3. Propagate request ID / trace context and the verified identity, not raw client headers.
4. Cap concurrency and reuse keepalive agents to downstreams.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS BFF: parallel fan-out with deadlines and graceful degradation',
          code: `import { Controller, Get, Headers, ServiceUnavailableException } from '@nestjs/common';
import { Agent, request } from 'undici';

const agent = new Agent({ keepAliveTimeout: 30_000, connections: 128 }); // pooled keepalive

async function getJson<T>(url: string, ms: number, h: Record<string, string>): Promise<T> {
  const res = await request(url, { dispatcher: agent, headers: h, signal: AbortSignal.timeout(ms) });
  if (res.statusCode >= 400) throw new Error(url + ' -> ' + res.statusCode);
  return (await res.body.json()) as T;
}

@Controller('mobile/home')
export class HomeBffController {
  @Get()
  async home(@Headers('x-user-id') userId: string, @Headers('x-request-id') reqId: string) {
    const h = { 'x-user-id': userId, 'x-request-id': reqId }; // allow-list, not passthrough
    const [user, cart, recs, promos] = await Promise.allSettled([
      getJson<{ name: string }>('http://users/v1/users/' + userId, 150, h),        // critical
      getJson<{ items: unknown[] }>('http://cart/v1/carts/' + userId, 150, h),     // critical
      getJson<{ ids: string[] }>('http://recs/v1/home?u=' + userId, 250, h),       // optional
      getJson<{ banners: unknown[] }>('http://promos/v1/active', 100, h),           // optional
    ]);

    if (user.status === 'rejected' || cart.status === 'rejected') {
      throw new ServiceUnavailableException('core dependency unavailable');
    }
    return {
      name: user.value.name,                                  // trimmed for mobile
      cartCount: cart.value.items.length,
      recommendations: recs.status === 'fulfilled' ? recs.value.ids.slice(0, 10) : [],
      banners: promos.status === 'fulfilled' ? promos.value.banners : [],
      degraded: recs.status === 'rejected' || promos.status === 'rejected',
    };
  }
}`,
        },
      ],
      keyPoints: [
        'One BFF per experience, owned by the frontend team; no business rules inside.',
        'Parallel fan-out, per-call timeouts, critical vs optional classification, degraded flag.',
        'GraphQL is a BFF implementation choice, not a replacement for the edge gateway.',
      ],
      source: 'Mastering API Architecture — Ch 3 (“Simplify consumption: aggregating/translating backend services”)',
    },
    {
      heading: 'Gateway as a single point of failure — and how to mitigate',
      body: `**Intuition:** if every visitor enters through one door, that door's hinges matter more than any office inside.

An edge gateway is on the critical path of (nearly) all user requests, and it is also **continuously reconfigured** as teams ship routes — so its most common outage cause is not hardware, it is a **bad config push** or a plugin bug. The chain of SPOFs in a web system: DNS → global/regional L4 LB → WAF → gateway → the gateway's own dependencies (Redis for rate limits, IdP/JWKS, config DB).

**Mitigations**

- **Redundancy:** N+2 stateless gateway instances across ≥3 AZs; autoscale on CPU/connection count; PodDisruptionBudget so node drains never remove too many.
- **Stateless data plane:** keep config in the control plane and state (counters) in Redis; the data plane must keep serving the **last known good config** if the control plane is down.
- **Safe config delivery:** config as code, validation in CI, canary the new config to 1–5% of gateway nodes, automatic rollback on 5xx/latency SLO burn.
- **Dependency failure policy per plugin:** rate-limit Redis down → fail-open to local limits; JWKS fetch fails → keep cached keys; token introspection down → fail-closed (security) or short grace period.
- **Blast radius:** separate gateway fleets per product/criticality (payments vs content), or **cell-based** edges so one tenant's traffic spike or config can't take everyone down.
- **Failover testing:** LB-to-gateway failover must be exercised. Common failures during failover: sticky sessions break because state wasn't migrated, users routed to a far region (EU → US-west while US-east is healthy), and cascading failure from a faulty leader-election component.
- **Ownership:** a named on-call team, SLOs, RED/USE dashboards, blameless postmortems.`,
      code: [
        {
          language: 'yaml',
          title: 'Kubernetes: keep the gateway fleet highly available',
          code: `apiVersion: apps/v1
kind: Deployment
metadata: { name: edge-gateway }
spec:
  replicas: 6
  strategy:
    rollingUpdate: { maxUnavailable: 0, maxSurge: 2 }   # never dip below capacity
  template:
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone        # spread across AZs
          whenUnsatisfiable: DoNotSchedule
          labelSelector: { matchLabels: { app: edge-gateway } }
      terminationGracePeriodSeconds: 60                  # drain in-flight requests
      containers:
        - name: envoy
          image: envoyproxy/envoy:v1.31-latest
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }      # served by Envoy health_check filter
          lifecycle:
            preStop:                                      # fail readiness, then drain
              exec: { command: ['sh', '-c', 'curl -s -X POST localhost:9901/healthcheck/fail; sleep 20'] }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: edge-gateway }
spec:
  minAvailable: 5
  selector: { matchLabels: { app: edge-gateway } }`,
        },
      ],
      keyPoints: [
        'Most gateway outages are config pushes: validate, canary and auto-rollback config like code.',
        'Data plane must run on last-known-good config if the control plane dies.',
        'Choose fail-open vs fail-closed per dependency, explicitly.',
      ],
      source: 'Mastering API Architecture — Ch 3 (“API gateway as a single point of failure”, “Mitigating risks”)',
    },
    {
      heading: 'Gateway anti-patterns: loopback, ESB, turtles, payload routing',
      body: `**Intuition:** once you own a hammer as powerful as a gateway, every cross-team problem looks like a nail.

**1. API gateway loopback.** With a handful of services you don't want a mesh, so internal calls go *out* to \`https://api.example.com/attendees\` and back in. Problems: traffic leaves the network and re-enters (latency, TLS twice, **cloud egress and cross-AZ charges**), internal APIs become publicly routable, the gateway becomes a hub-and-spoke bottleneck and true SPOF, and traces show confusing cycles. Fix: internal service discovery (Kubernetes DNS / Consul) and direct calls, or a service mesh for east–west.

**2. Gateway as an ESB.** Plugins (Lua, Wasm, Groovy in Zuul) are great for authn/z, logging, filtering. Putting **business logic** there (pricing, order orchestration, payload mapping per partner) couples the gateway release to service releases; a single plugin change ripples across the organisation and must deploy in lockstep. Keep "smart endpoints, dumb pipes".

**3. Turtles (gateways) all the way down.** A TLS gateway, then an auth gateway, then a logging gateway, then a department gateway… Each hop adds latency (and a p99 tail), and a simple upgrade needs five teams. Ask "who owns tracing?" and nobody knows. Consolidate cross-cutting concerns; allow at most *edge gateway + domain/department gateway* when there is a real governance boundary.

**4. Routing on payloads.** Deserialising bodies to route couples gateway config to the API schema and costs CPU; route on path, host, headers or query.

**5. Monolith as the router.** During strangler-fig migrations, letting the monolith proxy to extracted services couples your routing change cadence to the monolith's release train and increases its blast radius. Put routing in the gateway with developer self-service.

**Build vs buy.** Unless you are a cloud/platform vendor, a custom gateway is not a competitive advantage. Teams underestimate **TCO** (build + maintenance + operations), **opportunity cost**, and how fast the OSS/commercial landscape moves.`,
      diagram: `LOOPBACK (bad)                        DIRECT / MESH (good)

 legacy --https--> [ public edge ]      legacy ----> attendee
   ^                    |               (k8s DNS / mesh sidecar,
   |    egress $$$      v                mTLS, stays in VPC)
   +------------- attendee
 every internal call exits and re-enters the network`,
      keyPoints: [
        'Internal (east–west) calls should never hairpin through the public edge.',
        'Plugins for cross-cutting concerns only; business logic stays in services.',
        'Every gateway layer must justify its hop, its owner and its release coordination cost.',
      ],
      source: 'Mastering API Architecture — Ch 3 (“Common API gateway implementation pitfalls”, “Build versus buy”)',
    },
    {
      heading: 'Proxy mechanics that bite in production',
      body: `**Intuition:** a proxy is two TCP connections glued together; most production bugs come from forgetting that the two sides have *different* lifetimes, timeouts and headers.

**Connection reuse.** Without upstream keepalive, every request opens a new TCP (and maybe TLS) connection to the backend: extra 0.2–1 ms in-DC, CPU for handshakes, and **ephemeral port exhaustion** (~28K ports in the default Linux range 32768–60999 per destination IP:port, with TIME_WAIT of 60 s → you can't sustain more than ~470 new conns/s to a single backend IP:port). Enable keepalive pools and size them.

**Timeout alignment.** Set timeouts decreasing inward: client 10 s > CDN 8 s > gateway 5 s > service 4 s > DB 2 s. If the backend's keepalive idle timeout is *shorter* than the proxy's, the proxy may reuse a connection the backend just closed → sporadic 502s. Rule: **upstream (server) idle timeout > proxy's idle timeout** (e.g. Node \`server.keepAliveTimeout = 65s\` behind an ALB with 60 s idle timeout).

**Buffering.** Reverse proxies buffer request/response bodies by default — great for protecting app servers from slow clients, wrong for SSE/streaming (disable \`proxy_buffering\` for those routes) and for large uploads (stream to object storage with presigned URLs instead).

**WebSockets / long-lived connections.** Need \`Upgrade\`/\`Connection\` headers forwarded and long read timeouts; they pin to one backend, so deploys must drain gracefully (covered in load balancing).

**Headers and trust.** \`X-Forwarded-For\` is a client-controllable list; trust only entries appended by your own proxies. \`Forwarded\` (RFC 7239) is the standardised form. Propagate \`X-Request-Id\`/\`traceparent\` everywhere.

**Real numbers.** nginx or Envoy handle roughly 10K–50K+ simple HTTPS req/s per core-group on modern hardware depending on TLS, body sizes and filters; a JWT RS256 verification is ~20–50 µs of CPU; a remote token introspection call is 1–5 ms plus a new dependency — cache it.`,
      code: [
        {
          language: 'typescript',
          title: 'Node behind a proxy/ALB: avoid the sporadic-502 keepalive race',
          code: `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();                 // SIGTERM -> close server gracefully

  const server = app.getHttpServer();
  // ALB / nginx idle timeout is 60s. The backend must keep idle sockets open
  // LONGER than the proxy, otherwise the proxy can send a request on a socket
  // Node has just closed -> connection reset -> 502 at the edge.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;            // must exceed keepAliveTimeout
  server.requestTimeout = 30_000;            // bound slow-body attacks

  // Trust exactly one proxy hop for req.ip (Express adapter)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  await app.listen(3000);
}
bootstrap();`,
        },
      ],
      keyPoints: [
        'Backend idle keepalive timeout must exceed the proxy/LB idle timeout.',
        'Timeouts should shrink as you go deeper into the stack.',
        'Disable buffering for streaming routes; use presigned URLs for big uploads.',
      ],
    },
    {
      heading: 'How to talk about the edge in a system-design interview',
      body: `**Intuition:** interviewers don't want a box labelled "API Gateway" — they want to know *what it does for this design* and *what it costs*.

**A strong 60-second edge narrative**

1. "Clients hit **GeoDNS** → **CDN** (static assets + cacheable GETs with short TTL) → regional **L4 LB** → **WAF** → a stateless **API gateway** fleet across 3 AZs."
2. "The gateway does TLS termination (if not at CDN), **JWT validation with cached JWKS**, per-consumer **quotas** backed by Redis with local fallback, routing, request IDs and RED metrics."
3. "Behind it, a **mobile BFF** aggregates user/cart/recs in parallel under a 300 ms deadline and degrades optional sections."
4. "Service-to-service calls go **direct via service discovery / mesh**, never back through the edge."
5. "Risks: gateway config pushes (canary + rollback), Redis dependency (fail-open for rate limit), retries amplifying load (only idempotent, budgeted)."

**Decision table**

| Situation | Choose |
|---|---|
| One service, need TLS + static files | Reverse proxy (nginx/Caddy) or managed LB |
| Many services, one client type | Gateway with path routing |
| Several very different clients | Gateway + BFF per client |
| Partner/public API with keys, plans, portal | Enterprise gateway / API management |
| Rich client-driven data needs | GraphQL BFF (with cost limits) |
| East–west reliability/mTLS | Service mesh or libraries, not the edge gateway |`,
      keyPoints: [
        'Name concrete responsibilities per layer, not just boxes.',
        'Always mention the gateway’s failure mode and its dependencies.',
        'Separate north–south (gateway) from east–west (mesh/discovery).',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'net-proxies-gateway-cc-1',
      title: 'Fix the mobile BFF that takes the whole app down',
      context:
        'The mobile home screen BFF p99 is 4.8 s and error rate spikes whenever the recommendations service is slow. The BFF also leaks internal headers and occasionally lets users impersonate each other.',
      task:
        'Refactor the handler so the endpoint meets a ~300 ms deadline, survives optional-dependency failures, reuses connections, and only forwards safe, verified headers downstream.',
      starter: {
        language: 'typescript',
        code: `import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import axios from 'axios';

@Controller('mobile/home')
export class HomeController {
  @Get()
  async home(@Req() req: Request) {
    // forward everything so downstream "has context"
    const headers = { ...req.headers };
    const userId = req.headers['x-user-id'] ?? req.query.userId;

    const user = await axios.get('http://users/v1/users/' + userId, { headers });
    const cart = await axios.get('http://cart/v1/carts/' + userId, { headers });
    const recs = await axios.get('http://recs/v1/home?u=' + userId, { headers });
    const promos = await axios.get('http://promos/v1/active', { headers });

    return {
      user: user.data,          // full 40 KB user profile
      cart: cart.data,
      recs: recs.data,
      promos: promos.data,
    };
  }
}`,
      },
      hints: [
        'Four sequential awaits: what is the latency of the endpoint in terms of the four calls? And what happens when any one throws?',
        'axios has no default timeout. What does a hung recommendations call do to Node sockets and to the event of a traffic spike?',
        'Where does userId come from? Who can set x-user-id or ?userId? What else in req.headers should never be forwarded (Host, Content-Length, Authorization of the end user?)',
      ],
      solution: {
        language: 'typescript',
        code: `import { Controller, Get, Headers, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import http from 'node:http';

// One pooled client: keepalive avoids a TCP handshake per downstream call
const client = axios.create({
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 128 }),
  timeout: 250,                                   // hard ceiling per call
});

type Settled<T> = PromiseSettledResult<T>;
const ok = <T>(r: Settled<T>, fallback: T): T => (r.status === 'fulfilled' ? r.value : fallback);

@Controller('mobile/home')
export class HomeController {
  @Get()
  async home(
    @Headers('x-verified-user-id') userId: string | undefined,  // injected by gateway after JWT check
    @Headers('x-request-id') requestId: string | undefined,
  ) {
    if (!userId) throw new UnauthorizedException();
    const headers = { 'x-verified-user-id': userId, 'x-request-id': requestId ?? '' }; // allow-list
    const deadline = AbortSignal.timeout(300);   // total page budget

    const get = <T>(url: string, ms: number) =>
      client
        .get<T>(url, { headers, timeout: ms, signal: deadline })
        .then((r) => r.data);

    const [user, cart, recs, promos] = await Promise.allSettled([
      get<{ id: string; name: string; avatarUrl: string }>('http://users/v1/users/' + encodeURIComponent(userId), 150),
      get<{ items: { sku: string }[] }>('http://cart/v1/carts/' + encodeURIComponent(userId), 150),
      get<{ ids: string[] }>('http://recs/v1/home?u=' + encodeURIComponent(userId), 250),
      get<{ banners: { id: string; img: string }[] }>('http://promos/v1/active', 100),
    ]);

    if (user.status === 'rejected' || cart.status === 'rejected') {
      throw new ServiceUnavailableException('core dependency unavailable'); // 503, client may retry
    }
    const recIds = ok(recs, { ids: [] }).ids;
    const banners = ok(promos, { banners: [] }).banners;

    return {
      user: { name: user.value.name, avatarUrl: user.value.avatarUrl }, // trimmed for mobile
      cartCount: cart.value.items.length,
      recommendations: recIds.slice(0, 10),
      banners,
      degraded: recs.status === 'rejected' || promos.status === 'rejected',
    };
  }
}`,
      },
      explanation: `**Fixes**

- **Parallel fan-out** with \`Promise.allSettled\`: latency ≈ max(calls) instead of sum; one failure no longer rejects everything.
- **Per-call timeouts + total deadline** (\`AbortSignal.timeout(300)\`): a hung recs service can no longer hold sockets and requests for seconds.
- **Critical vs optional**: user/cart failures return 503; recs/promos degrade to empty with a \`degraded\` flag the client can use.
- **Identity from the gateway only**: the gateway strips client-supplied identity headers and injects \`x-verified-user-id\` after validating the JWT; \`?userId\` impersonation is gone.
- **Header allow-list**: no forwarding of Host, Content-Length, cookies or the user's bearer token to every internal service.
- **Keepalive pooled agent** avoids per-call TCP handshakes and ephemeral-port churn.
- **Payload trimming**: the mobile client gets the few fields it renders, not a 40 KB profile.`,
      followUps: [
        {
          "q": "Recs is slow for 30 minutes. Every home request still waits the full 250 ms on recs before degrading. How do you stop paying that cost?",
          "a": "Add a circuit breaker per dependency. After, say, 50% of recs calls time out within a 10 s window, open the breaker: skip the call entirely and return `degraded` with empty recs (or a cached generic 'popular items' list) immediately. Every 5–10 s, let a few probe requests through in half-open state; if they succeed, close the breaker. Home p99 then falls back to roughly max(user, cart) instead of 250 ms, and the struggling recs service gets relief from the load. Export breaker state as a metric and alert on it, so the recs team is paged about their brownout."
        },
        {
          "q": "How would you load-test this handler to prove it meets the 300 ms deadline under a dependency brownout?",
          "a": "Run the BFF against stub services (WireMock, or a small Node server) that can inject latency distributions and errors per dependency. Scenarios under k6 at peak RPS: (1) all healthy: assert p99 under 300 ms; (2) recs p99 = 8 s: assert BFF p99 stays around 260 ms, `degraded` is true, and socket counts stay bounded at maxSockets with no memory growth; (3) cart returning errors: assert 503s, no hangs; (4) users slow at 400 ms: assert a 503 by about 300 ms. Track event-loop lag and agent socket and queue metrics. Run it in CI nightly so a regression such as a removed timeout fails the build."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-cc-2',
      title: 'Harden an nginx edge config that causes duplicate orders and 502s',
      context:
        'After moving behind an AWS NLB, the team sees (1) customers occasionally charged twice, (2) rate limiting blocking entire offices, (3) sporadic 502s under low traffic, (4) high CPU from TLS to upstreams.',
      task:
        'Rewrite the config to eliminate duplicate non-idempotent retries, rate-limit on the real client IP, reuse upstream connections, and set sane timeouts and body limits.',
      starter: {
        language: 'nginx',
        code: `limit_req_zone $http_x_forwarded_for zone=api:10m rate=10r/s;

upstream payments {
  server pay-1:3000;
  server pay-2:3000;
}

server {
  listen 443 ssl;
  server_name api.example.com;

  location /v1/payments {
    limit_req zone=api;
    proxy_pass http://payments;
    proxy_set_header X-Forwarded-For $http_x_forwarded_for;
    proxy_set_header X-User-Id $http_x_user_id;
    proxy_read_timeout 300s;
    proxy_next_upstream error timeout http_500 http_502 http_503 non_idempotent;
    proxy_next_upstream_tries 5;
  }
}`,
      },
      hints: [
        'What does non_idempotent do to a POST /v1/payments that timed out after the upstream already processed it?',
        'The limit key is a raw client-controlled header. What value does a whole office behind one NAT, or an attacker rotating the header, produce?',
        'nginx talks HTTP/1.0 to upstreams by default. What does that mean for connection reuse?',
      ],
      solution: {
        language: 'nginx',
        code: `# Derive the real client IP only from hops we trust (NLB/VPC range)
set_real_ip_from 10.0.0.0/16;
real_ip_header   X-Forwarded-For;
real_ip_recursive on;

# Key on the resolved client address (binary form = 4 or 16 bytes)
limit_req_zone $binary_remote_addr zone=pay_ip:10m rate=10r/s;

upstream payments {
  server pay-1:3000 max_fails=3 fail_timeout=10s;
  server pay-2:3000 max_fails=3 fail_timeout=10s;
  keepalive 32;                               # pooled idle connections
  keepalive_timeout 55s;                      # < Node keepAliveTimeout (65s)
}

server {
  listen 443 ssl http2;
  server_name api.example.com;
  client_max_body_size 64k;                   # payments bodies are tiny

  location /v1/payments {
    limit_req zone=pay_ip burst=20 nodelay;
    limit_req_status 429;

    proxy_pass http://payments;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Request-Id $request_id;
    proxy_set_header X-User-Id "";            # identity is injected by auth layer only

    proxy_connect_timeout 500ms;
    proxy_send_timeout 5s;
    proxy_read_timeout 10s;                   # PSP calls have their own timeouts inside

    # Retry only when the request never reached/was refused by the upstream.
    # POST is not retried after being sent (no non_idempotent); clients retry
    # with an Idempotency-Key that the payments service deduplicates.
    proxy_next_upstream error timeout;
    proxy_next_upstream_tries 2;
    proxy_next_upstream_timeout 2s;
  }
}`,
      },
      explanation: `**Fixes**

- **Duplicate charges**: \`non_idempotent\` + retrying on \`timeout\`/\`http_500\` re-sent POSTs that may already have succeeded. Removed; safe retries rely on an **Idempotency-Key** handled by the service.
- **Retry amplification**: 5 tries × 2 servers during an incident multiplies load; capped at 2 with a 2 s retry window.
- **Rate-limit key**: \`$http_x_forwarded_for\` is attacker-controlled and, behind NAT, groups whole offices or is trivially rotated. Using \`real_ip\` from trusted hops + \`$binary_remote_addr\` keys on the actual client.
- **Header spoofing**: forwarding \`$http_x_user_id\` let clients impersonate users; now cleared. XFF is appended, not replaced.
- **Connection reuse**: HTTP/1.1 + empty Connection + \`keepalive\` stops per-request handshakes; proxy idle timeout (55 s) is lower than the backend's (65 s) to avoid the reuse-after-close 502 race.
- **Timeouts/body limits**: 300 s read timeout let slow upstreams pin workers; small body limit blocks abuse at the edge.`,
      followUps: [
        {
          "q": "Your rate limit is per real client IP at 10 r/s. A large corporate office behind one NAT IP still gets throttled at lunchtime. What do you change without opening the door to abuse?",
          "a": "IP is the wrong identity for authenticated payment traffic. Key the payment limit on the authenticated user or account (from the auth layer, through a trusted internal header or JWT claim, for example `limit_req_zone $jwt_sub`, or rate-limit in the auth or gateway layer), so each employee gets their own budget. Keep a looser per-IP limit (say 200 r/s) as a coarse abuse ceiling, and allow-list known enterprise NAT ranges with higher limits if necessary. For unauthenticated endpoints, combine IP with device fingerprint or require a CAPTCHA under suspicion rather than a hard block."
        },
        {
          "q": "How would you roll this nginx config change out safely, given the previous config caused double charges?",
          "a": "Treat config as code. Run `nginx -t` in CI, plus integration tests in a container against a mock upstream: assert a POST that times out is not retried (the mock counts requests per Idempotency-Key), spoofed X-Forwarded-For and X-User-Id don't reach the upstream, keepalive reuse is visible in mock connection counts, and oversized bodies get 413. Deploy as a canary to one nginx node (or a 5% weighted target), compare 5xx, 429 and duplicate-payment metrics against the baseline for 30 minutes, then roll out progressively. Keep the previous config one command away for instant rollback."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'net-proxies-gateway-iq-01',
      difficulty: 'hard',
      question:
        'Design the edge for a food-delivery platform with web, iOS/Android and restaurant-partner APIs. Walk me from DNS to the first microservice and justify every layer.',
      context: '30M MAU, peak 60K RPS at dinner time, partners integrate via API keys, mobile networks are slow.',
      whatInterviewerLooksFor: [
        'Layered edge with a clear job per layer (DNS, CDN, LB, WAF, gateway, BFF)',
        'Separation of partner (API management, keys, quotas) vs first-party traffic',
        'Latency awareness for mobile (TLS near user, aggregation in DC)',
        'Failure modes and HA of the gateway itself',
        'Does not push business logic into the gateway',
      ],
      modelAnswer: `### Layers
1. **GeoDNS / GSLB** — routes users to the nearest healthy region (health-checked, TTL 30–60 s).
2. **CDN** — static assets, menu images, and cacheable GETs (restaurant menus with 30–60 s TTL + stale-while-revalidate). Terminates TLS near the user: saves 1–2 RTT (~100–300 ms on 4G).
3. **Regional L4 LB** (NLB) — spreads millions of connections cheaply; preserves client IP.
4. **WAF** — OWASP rules, bot scoring for the promo endpoints, geo-blocking.
5. **API gateway fleet** (Envoy/Kong), stateless, ≥3 AZs, N+2 capacity: JWT validation with cached JWKS, per-consumer quotas (Redis-backed, local fallback), routing, request IDs, RED metrics.
6. **BFFs** — *mobile BFF* and *web BFF* owned by the respective frontend teams; they aggregate restaurant, ETA, cart, promos in parallel with a 300 ms deadline and trim payloads.
7. **Partner API** — a separate route set (or separate enterprise gateway product) with API keys, plans, developer portal, stricter quotas and versioned contracts. Separate so a partner storm cannot starve consumers.

### Capacity
60K RPS at peak; an Envoy node doing auth + routing handles ~5–10K RPS comfortably → 8–12 nodes, run 15–18 for AZ loss and headroom.

### Failure design
- Gateway config via GitOps, canaried to 5% of nodes, auto-rollback.
- Rate-limit Redis down → fail-open to local token buckets; JWKS unreachable → keep cached keys.
- Retries only for idempotent GETs, one layer, budgeted.
- East–west calls use service discovery/mesh, never the public edge (avoid loopback).

### What I keep out of the edge
Pricing, order orchestration, partner-specific payload mapping — those live in services or the partner BFF.`,
      followUps: [
        { q: 'Would you put the BFF logic into the gateway using plugins instead?', a: 'No — that is the “gateway as ESB” pitfall: plugin releases couple to service releases, and a bug affects all traffic. BFFs are ordinary services the frontend team deploys independently.' },
        { q: 'A partner hammers you at 20x their quota during dinner peak. What protects consumers?', a: 'Per-consumer quotas at the gateway returning 429 with Retry-After, separate partner route pool/fleet (bulkhead), and priority load shedding that drops partner traffic before consumer checkout.' },
        { q: 'Where do you terminate TLS and do you re-encrypt?', a: 'Terminate at CDN/LB for latency, re-encrypt to the gateway and use mTLS (mesh) internally for zero-trust; keep long-lived connections so re-encryption cost is amortised.' },
      ],
      pitfalls: [
        'Drawing a single “API Gateway” box without saying what it does',
        'Treating the gateway as a place for business orchestration',
        'Ignoring gateway HA and config-push risk',
        'Routing internal service calls back through the public gateway',
      ],
    },
    {
      id: 'net-proxies-gateway-iq-02',
      difficulty: 'expert',
      question:
        'After enabling an auth plugin on the gateway, p99 went from 40 ms to 900 ms and the IdP team is paging you. What happened and how do you fix it?',
      context: 'The plugin validates opaque access tokens via the IdP introspection endpoint on every request. 25K RPS.',
      whatInterviewerLooksFor: [
        'Recognises a synchronous remote dependency on the hot path',
        'Knows JWT local validation vs opaque token introspection trade-off',
        'Caching with bounded TTL and revocation considerations',
        'Protecting the dependency (timeouts, circuit breaker, fail-closed policy)',
      ],
      modelAnswer: `### Diagnosis
Every request now makes a **synchronous introspection call**: 25K RPS of extra load on the IdP. As the IdP saturates, its latency grows, the gateway's worker/connection pool fills, and queueing inflates p99 for *all* routes — a classic dependency-induced tail. Check: gateway upstream latency histogram for the IdP cluster, IdP CPU, gateway connection pool saturation.

### Fixes, in order
1. **Cache introspection results** keyed by token hash for min(token exp, 30–60 s). With ~200K active users and each making many calls, hit ratio > 95% → IdP load drops from 25K to ~1K RPS.
2. **Switch to JWT access tokens** (short-lived, 5–15 min) validated locally with **cached JWKS**: RS256/ES256 verify is ~20–50 µs of CPU and has no network hop. Refresh JWKS in the background; handle key rotation via \`kid\`.
3. **Revocation**: short token lifetime + a small deny-list (Redis/pub-sub pushed to gateways) for logout/compromise, instead of per-request introspection.
4. **Protect the IdP**: dedicated connection pool, 100–200 ms timeout, circuit breaker; decide policy explicitly — for auth, **fail closed** (401/503) for sensitive routes, perhaps a short grace window for cached-valid tokens.
5. **Roll out safely**: canary plugin changes to a slice of gateway nodes with SLO-based rollback — this should never have hit 100% at once.

### Result
p99 back to ~40–45 ms; IdP sees only cache misses and JWKS refreshes.`,
      followUps: [
        { q: 'Security asks for immediate revocation when an employee is fired. JWTs are valid for 10 more minutes.', a: 'Push revocation events to gateways (deny-list of jti or subject with TTL = token lifetime) and/or shorten token lifetime for high-risk scopes; admin routes can still introspect.' },
        { q: 'Where would you cache introspection: per gateway node or shared Redis?', a: 'Per-node LRU first (zero network, but N× IdP misses), optionally shared Redis as L2; per-node is usually enough since misses are cheap once load is spread.' },
      ],
      pitfalls: [
        'Scaling the IdP horizontally as the only fix',
        'Caching tokens beyond their expiry',
        'Fail-open on auth without discussing the security implication',
      ],
    },
    {
      id: 'net-proxies-gateway-iq-03',
      difficulty: 'hard',
      question:
        'Your web, iOS and partner teams all complain about the single public REST API. Would you introduce BFFs, a GraphQL layer, or just version the API? How do you decide?',
      whatInterviewerLooksFor: [
        'Understands BFF ownership model and coupling trade-offs',
        'Knows GraphQL costs (query cost limits, N+1, caching)',
        'Considers team topology and number of client types',
        'Keeps business logic out of the experience layer',
      ],
      modelAnswer: `### Symptoms first
- Mobile over-fetches (40 KB payloads), needs 5 calls per screen.
- Web wants richer data and fast iteration.
- Partners need **stable, versioned contracts** and don't care about screens.

### Options
| Option | Good for | Costs |
|---|---|---|
| **BFF per experience** | Few, very different clients; frontend teams can own a service | Duplication across BFFs; must keep logic thin |
| **GraphQL (single graph / federation)** | Many clients with overlapping data, fast UI iteration | Query cost limiting, DataLoader batching, HTTP caching harder, schema governance |
| **Versioned generic REST** | Partners / public API | Doesn't fix per-screen aggregation |

### My decision
- **Partners** keep a versioned REST API behind the gateway with API management (keys, quotas, deprecation policy).
- **First-party** clients: if the org has a web and mobile team who can own services, start with **two BFFs** (mobile, web) — cheap, explicit, easy to reason about latency. If we have 5+ client surfaces and many teams contributing data, a **federated GraphQL** supergraph acts as a shared BFF with per-client persisted queries.
- Either way, **business rules live in domain services**. BFFs do aggregation, trimming, protocol translation, client-specific caching.

### Guardrails
Per-call timeouts and total deadlines in BFFs, partial responses for optional data, persisted queries + depth/cost limits for GraphQL, contract tests between BFFs and domain services.`,
      followUps: [
        { q: 'Two BFFs now compute delivery fee differently. How did that happen and how do you prevent it?', a: 'Business logic leaked into BFFs. Move the fee calculation to the pricing service, BFFs just render its output; add contract tests and a code-owner rule for pricing logic.' },
        { q: 'How do you cache GraphQL responses at the CDN?', a: 'Use persisted queries sent as GET with a hash so URLs are cacheable, set Cache-Control per operation, or cache at resolver/data-source level instead.' },
      ],
      pitfalls: [
        'Choosing GraphQL just because it is trendy, ignoring cost controls',
        'A single “universal BFF” — which is just the generic API again',
        'Letting the backend team own every BFF, removing the autonomy benefit',
      ],
    },
    {
      id: 'net-proxies-gateway-iq-04',
      difficulty: 'expert',
      question:
        'Last Friday a gateway config change caused a 22-minute full outage. As the new principal engineer, how do you make the gateway stop being a single point of failure?',
      whatInterviewerLooksFor: [
        'Identifies config change as the primary risk, not hardware',
        'Progressive delivery for config, validation, auto-rollback',
        'Blast-radius reduction (fleets, cells, per-route isolation)',
        'Data plane independence from control plane',
        'Ownership, SLOs, and incident process',
      ],
      modelAnswer: `### What really failed
Gateways rarely die from hardware — they die from **global, instant config pushes**. The fix is about change safety and blast radius as much as replica counts.

### 1. Change safety
- Config as code (decK / Gateway API YAML) with **schema validation, lint and integration tests** in CI (spin up the gateway in a container, replay a golden request set).
- **Progressive rollout**: 1 node → 5% → 25% → 100% with automated checks on 5xx rate, p99 and route-match failures; auto-rollback within ~1–2 minutes.
- Keep **last known good** config; the data plane must continue serving if the control plane or config DB is down.

### 2. Redundancy
- Stateless instances, N+2, spread across ≥3 AZs with topology spread and a PDB; multi-region with GSLB health checks.
- Remove hidden SPOFs: the config database, Redis for rate limits (fail-open to local), JWKS (cached).

### 3. Blast radius
- Split fleets by criticality (checkout/payments vs content vs partner) — one bad route config for partners can't break checkout.
- Consider **cell-based** edges: each cell serves a shard of users; config rolls cell-by-cell.

### 4. Detection & ownership
- A named owning team with on-call, SLO (e.g. 99.99% gateway availability, i.e. ~4.3 min/month), dashboards on RED/USE, synthetic probes per critical route.
- Blameless postmortem, publish learnings, game days that deliberately push bad config to a staging cell.

### Outcome
MTTR target < 5 min via auto-rollback; blast radius of a bad change limited to one canary slice.`,
      followUps: [
        { q: 'Isn’t running separate gateway fleets the “turtles all the way down” anti-pattern?', a: 'No — turtles is stacking gateways in series per concern. Parallel fleets (same config model, different traffic) reduce blast radius without extra hops.' },
        { q: 'The control plane is down during an incident and you need to block an abusive IP now.', a: 'Break-glass path: WAF/CDN rules or LB security groups at an outer layer, plus a documented emergency static config override.' },
      ],
      pitfalls: [
        'Only saying “add more replicas”',
        'Ignoring gateway dependencies like Redis or IdP',
        'No mention of rollback automation',
      ],
    },
    {
      id: 'net-proxies-gateway-iq-05',
      difficulty: 'hard',
      question:
        'We are extracting services from a monolith. The team proposes that the monolith keeps routing and simply proxies /attendees to the new service. Good idea?',
      whatInterviewerLooksFor: [
        'Knows strangler-fig pattern with gateway routing',
        'Explains coupling to monolith release cadence and blast radius',
        'Handles internal calls from monolith to new service without loopback',
        'Migration safety: shadow traffic, canary, rollback',
      ],
      modelAnswer: `### Short answer
It works for the first service, but it doesn't scale and I'd move routing to the gateway early.

### Why not the monolith as router
- **Coupling**: every routing change waits for the monolith's release train (often weekly); a failed monolith deploy blocks all migration work.
- **Blast radius and load**: all traffic still flows through the monolith, so its outages take down extracted services too, and it carries extra proxying load.
- **Cross-cutting duplication**: auth, rate limiting and telemetry get reimplemented in both the monolith and the new services.

### Proposed approach (strangler fig)
1. Put an API gateway in front with a catch-all route \`/ → monolith\`.
2. Add \`/attendees → attendee-service\` (with path rewrite) when ready; teams manage their own route configs via GitOps.
3. **Shadow** traffic first (mirror requests, compare responses), then canary by weight or header (1% → 10% → 100%), keep instant rollback to the monolith route.
4. **Internal calls**: when the monolith needs attendee data it calls \`attendee.internal\` via service discovery or a mesh — **not** \`https://api.example.com/attendees\` (gateway loopback costs egress, latency and exposes internals).
5. Data migration handled separately (dual-write with CDC or backfill + cutover); routing is only half of the problem.

### Endgame
The monolith becomes a small shell with few routes; each extracted service owns its mapping.`,
      followUps: [
        { q: 'How do you compare old vs new responses safely during shadowing?', a: 'Mirror only idempotent reads (or sandbox writes), diff normalized responses offline, track mismatch rate per endpoint before switching traffic.' },
        { q: 'Sessions are stored in the monolith’s memory. What breaks?', a: 'The new service cannot see them; move to stateless tokens (JWT) validated at the gateway or a shared session store before routing traffic away.' },
      ],
      pitfalls: [
        'Ignoring internal monolith → service calls (causing loopback)',
        'Big-bang cutover without shadow/canary',
        'Forgetting the data ownership migration',
      ],
    },
    {
      id: 'net-proxies-gateway-iq-06',
      difficulty: 'medium',
      question:
        'Our Kubernetes pods must call three external partners who allow-list our source IPs. How do you design egress, and is this a forward-proxy problem?',
      whatInterviewerLooksFor: [
        'Recognises forward/egress proxy use case',
        'Stable egress IPs via NAT gateway or egress gateway',
        'Egress policy (allow-list domains), observability and secret handling',
        'Availability of the egress path',
      ],
      modelAnswer: `### Yes — this is the forward-proxy side of the boundary
Pods have ephemeral IPs and nodes come and go, so partners can't allow-list them. We need **controlled, stable egress**.

### Options
| Option | How | Pros | Cons |
|---|---|---|---|
| Cloud NAT gateway per AZ with Elastic IPs | Private subnets route 0.0.0.0/0 via NAT | Simple, managed, 3 stable IPs | No L7 policy, all traffic shares IPs |
| **Egress proxy / mesh egress gateway** (Envoy/Squid) | Pods use HTTP CONNECT or mesh routes egress via dedicated nodes | Domain allow-list, per-service policy, logs, mTLS origination | Another HA component to run |
| Dedicated partner nodes | Node pool with fixed IPs | Isolation | Scheduling complexity |

### My design
- Egress gateway (Envoy) deployed on a small node pool in 3 AZs, behind NAT gateways with **one Elastic IP per AZ** → give partners 3 IPs.
- **Default deny** egress via NetworkPolicy; only the egress gateway can reach the internet; the gateway allow-lists \`api.partner-a.com\` etc. per calling service.
- Per-partner timeouts, circuit breakers, and metrics so a slow partner is visible.
- Watch **NAT port limits**: AWS NAT GW supports ~55K simultaneous connections per unique destination (IP:port) per EIP — high-volume partners need connection pooling/keepalive or multiple EIPs.

### Availability
Losing an AZ loses one IP; partners have all three allow-listed. Test by draining one AZ's egress.`,
      followUps: [
        { q: 'A partner can only allow-list ONE IP.', a: 'Route that partner through a single NAT EIP in one AZ with a warm standby that can be re-associated; accept reduced availability or negotiate a range.' },
        { q: 'How does this help with security incidents?', a: 'Default-deny egress blocks data exfiltration and C2 callbacks from compromised pods, and egress logs give an audit trail.' },
      ],
      pitfalls: [
        'Suggesting partners allow-list node IPs',
        'Forgetting NAT connection/port limits',
        'Single egress instance with no AZ redundancy',
      ],
    },
    {
      id: 'net-proxies-gateway-iq-07',
      difficulty: 'expert',
      question:
        'Behind our ALB, Node services show a steady trickle of 502s (about 0.05%) even at low traffic, with no errors in app logs. How do you debug it?',
      whatInterviewerLooksFor: [
        'Understands two-connection nature of proxies',
        'Knows the keepalive idle-timeout race',
        'Uses LB/access-log fields to localise the failure',
        'Also considers deploy-time draining and header timeouts',
      ],
      modelAnswer: `### Hypothesis ranking
502 = the proxy got an **invalid/closed response from upstream**. No app error logs means the request likely never reached the handler.

1. **Keepalive race** (most common): Node's default \`server.keepAliveTimeout\` is **5 s**; ALB idle timeout is **60 s**. Node closes an idle socket at 5 s; the ALB, believing it is still open, sends the next request on it → TCP RST → 502. Low traffic makes it *worse* because more sockets sit idle.
2. **Deploy/scale-in without draining**: pods killed before the LB stops routing (no preStop delay, SIGTERM closes immediately).
3. **headersTimeout < keepAliveTimeout** misconfiguration in Node causing sockets to be destroyed mid-request.
4. Upstream crashes/OOM (would show restarts).

### How to confirm
- ALB access logs: \`target_status_code\` "-" with \`elb_status_code\` 502 and very small \`target_processing_time\` → connection-level failure, not app.
- Correlate timestamps with deploys and HPA scale-in events.
- tcpdump on one pod: RST right after FIN on reused sockets.

### Fix
- \`server.keepAliveTimeout = 65000\` and \`server.headersTimeout = 66000\` (backend idle > LB idle).
- Graceful shutdown: readiness fails first, **preStop sleep ~10–20 s**, deregistration delay aligned, then close server.
- For nginx/Envoy in between: set their upstream idle timeouts below the app's.

### Verify
502 rate should drop to ~0 outside real failures; add an alert on 502 ratio per target group.`,
      followUps: [
        { q: 'Why does the problem get worse at low traffic?', a: 'At high traffic sockets are rarely idle long enough to hit Node’s 5 s timeout; at low traffic many sit idle and get closed just as the LB reuses them.' },
        { q: 'Would retrying 502 at the LB hide this?', a: 'It masks it for idempotent requests but risks duplicates for POSTs and hides a real bug; fix the timeout ordering.' },
      ],
      pitfalls: [
        'Blaming the application code without evidence',
        'Increasing timeouts everywhere randomly',
        'Enabling blanket retries of POST at the LB',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'net-proxies-gateway-boe-1',
      question: 'Size an Envoy-based API gateway fleet for 200K peak RPS with JWT validation, routing and access logging.',
      assumptions: [
        'Average request 2 KB in, 8 KB out; TLS terminated at the gateway (HTTP/2 from CDN, long-lived)',
        'One Envoy worker core handles ~2,500 RPS with JWT verify + logging (conservative)',
        'Target ≤ 60% CPU at peak; must survive loss of one of 3 AZs',
        'Nodes with 8 vCPU (7 usable for Envoy workers)',
      ],
      steps: [
        { label: 'Cores needed at 100%', calc: '200,000 ÷ 2,500 ≈ 80 cores' },
        { label: 'Headroom to 60% CPU', calc: '80 ÷ 0.6 ≈ 134 cores' },
        { label: 'Nodes', calc: '134 ÷ 7 ≈ 19 nodes' },
        { label: 'Survive 1 of 3 AZs', calc: 'remaining 2/3 must carry all: 19 × 3/2 ≈ 29 nodes (~10 per AZ)' },
        { label: 'Bandwidth', calc: '200K × 10 KB = 2 GB/s ≈ 16 Gbps total → ~0.6 Gbps per node, fine for 10 Gbps NICs' },
        { label: 'JWT CPU share', calc: '200K × ~40 µs ≈ 8 core-seconds/s ≈ 8 cores (10% of compute)' },
      ],
      answer: '≈ 30 gateway nodes of 8 vCPU (~10 per AZ); network is not the bottleneck, CPU for TLS/JWT/logging is.',
      insight:
        'AZ-failure headroom (×1.5) dominates the sizing. Offloading TLS to the CDN/LB and sampling access logs are the biggest levers; JWT local verify is cheap compared with remote introspection, which would add a 200K RPS dependency.',
      followUps: [
        {
          "q": "Security wants 100% of access logs kept (no sampling) and the IdP wants remote token introspection on every request. Redo the sizing.",
          "a": "Full logging adds roughly 10–20% CPU (formatting, plus writing about 200K lines/s or roughly 100 MB/s of logs), so use async gRPC access-log sinks rather than file I/O. Remote introspection is the big one: it adds a 200K RPS dependency and about 1–3 ms per request, and gateway workers hold requests open longer, so memory and connection needs grow. Cores rise to maybe 110–120 at 100%, about 40 nodes with AZ headroom, and the IdP itself needs scaling for 200K RPS. Push back: cache introspection results per token for 30–60 s (cutting calls by over 95%), or use local JWT verification plus a revocation list."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-boe-2',
      question: 'A mobile screen needs data from 5 services. Estimate end-to-end latency with client-side fan-out vs a BFF.',
      assumptions: [
        '4G RTT client ↔ region = 80 ms; in-DC RTT = 0.5 ms',
        'Each service responds in 30 ms p50, 120 ms p99',
        'Client connection already warm (TLS done); browsers/apps allow ~6 parallel HTTP/1.1 connections, or multiplex on HTTP/2',
        'BFF adds 5 ms processing',
      ],
      steps: [
        { label: 'Client fan-out, parallel on HTTP/2 (p50)', calc: '80 ms RTT + 30 ms ≈ 110 ms, but dependent calls (e.g. need userId → cart) add another 110 ms → ~220 ms' },
        { label: 'Client fan-out p99', calc: 'max of 5 calls: P(all < p99) = 0.99^5 ≈ 95% → page p99 ≈ service p99.9-ish; ~80 + 120 + 80 + 120 ≈ 400 ms with a dependent hop' },
        { label: 'BFF p50', calc: '80 ms RTT + 5 ms + max(parallel 30 ms, dependent 2 × 30.5 ms) ≈ 146 ms' },
        { label: 'BFF p99 with 200 ms per-call timeout + degradation', calc: '80 + 5 + ~2 × 120 ≈ 325 ms worst; optional calls cut at timeout' },
        { label: 'Payload', calc: '5 responses × 20 KB = 100 KB vs trimmed BFF 8 KB → 12× less over mobile network' },
      ],
      answer: 'BFF ≈ 150 ms p50 / ~325 ms p99 vs client fan-out ≈ 220 ms p50 / ~400 ms p99, with ~12× smaller payload.',
      insight:
        'The win comes from moving dependent round trips from an 80 ms network into a 0.5 ms one, plus payload trimming. Fan-out also amplifies tail latency (1 − 0.99^N), so BFFs must use per-call timeouts and degrade optional sections.',
      followUps: [
        {
          "q": "The 5 calls include 2 that depend on each other (userId, then cart). Could GraphQL or a single aggregated endpoint on the client side give the same win without a BFF?",
          "a": "A GraphQL server in the region is effectively a BFF: the dependent hop still happens in-DC at 0.5 ms, so you get the same latency win, plus field selection for payload trimming. What doesn't work is a client-side chain: the dependent call still crosses the 80 ms network twice. The trade-off is ownership. A per-client BFF lets each team optimise its screen; a shared GraphQL layer centralises schema governance but risks becoming a bottleneck team. Either way you need per-resolver timeouts, DataLoader-style batching to avoid N+1 calls, and query cost limits."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-boe-3',
      question: 'Your WebSocket gateway must hold 2M concurrent connections. Estimate memory and node count, and what limits you hit first.',
      assumptions: [
        'Per-connection cost in the proxy ≈ 20 KB (TLS state + buffers + kernel socket buffers, tuned)',
        '1 heartbeat per connection per 30 s, 1 message/min average',
        'Nodes: 16 GB RAM, target 60% memory use; max 1M file descriptors per process after tuning',
      ],
      steps: [
        { label: 'Total memory', calc: '2,000,000 × 20 KB = 40 GB' },
        { label: 'Per node usable', calc: '16 GB × 0.6 ≈ 9.6 GB → ~480K conns per node by memory' },
        { label: 'Nodes by memory', calc: '2M ÷ 480K ≈ 4.2 → 5 nodes' },
        { label: 'Message rate', calc: 'heartbeats 2M ÷ 30 ≈ 67K msg/s + 2M ÷ 60 ≈ 33K msg/s = ~100K msg/s total, ~20K per node — easy' },
        { label: 'Failure/redeploy headroom', calc: 'lose 1 node → its ~400K clients reconnect onto 4 nodes; plan N+2 = 7 nodes (~285K each)' },
        { label: 'Reconnect storm', calc: '400K reconnects with TLS handshakes (~1–2 ms CPU each) ≈ 400–800 CPU-seconds → jittered backoff over 30–60 s required' },
      ],
      answer: '~7 nodes (N+2), ~40 GB total connection memory; memory and reconnect storms, not throughput, are the constraints.',
      insight:
        'Long-lived connections make the edge stateful: plan for connection draining on deploy, client reconnect jitter, and per-node connection caps. L4 balancing by connection count matters more than request round robin.',
      followUps: [
        {
          "q": "A deploy rolls all 7 gateway nodes one at a time. How long should the rollout take so reconnects never overwhelm the remaining nodes?",
          "a": "Each node holds about 285K connections. Draining it means sending close frames that ask clients to reconnect with jitter over, say, 60 s, which is about 4.75K reconnects/s, each costing 1–2 ms of TLS CPU, so roughly 5–10 cores spread across 6 nodes. That's fine. Wait until the drained node's connections fall near zero and the others are stable (CPU and connection count) before the next node, roughly 2–3 minutes per node and about 20 minutes total. Don't drain faster than the TLS-handshake budget allows. Using TLS session resumption cuts the reconnect CPU several-fold."
        }
      ],
    },
  ],
  test: [
    {
      id: 'net-proxies-gateway-mcq-01',
      difficulty: 'medium',
      question:
        'Your company needs every pod call to third-party APIs to be logged and restricted to an allow-list of domains. Which component fits best?',
      options: [
        'An egress/forward proxy that all outbound traffic must traverse',
        'The public API gateway, configured with outbound routes for each partner',
        'A reverse proxy placed in front of each partner integration service',
        'An L4 network load balancer with security-group rules per partner',
      ],
      correct: [0],
      explanation:
        'Controlling and auditing outbound client traffic is the forward (egress) proxy role. Reusing the public API gateway for outbound calls mixes trust boundaries and creates loopback-style coupling. A reverse proxy protects servers, not outbound clients, and an L4 LB with security groups can restrict IPs but cannot filter by domain or log HTTP-level details.',
      followUps: [
        {
          "q": "Most partner calls are HTTPS. How does the egress proxy enforce a domain allow-list without decrypting the traffic, and when would you decrypt?",
          "a": "For HTTPS, clients send `CONNECT api.partner.com:443` to the proxy (or, with a transparent proxy, the proxy reads the SNI from the TLS ClientHello). The proxy checks the hostname against the allow-list, resolves it itself so clients can't connect to an arbitrary IP while claiming an allowed name, and logs the destination, bytes and duration, then tunnels the encrypted stream. That covers allow-listing and auditing without TLS interception. Decrypt (MITM with an internal CA trusted by pods) only if you must inspect paths or payloads, for example for data-loss prevention, and accept the cost: CA distribution, broken certificate pinning and higher CPU."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-02',
      difficulty: 'hard',
      question: 'This nginx location occasionally causes customers to be charged twice. Why?',
      code: {
        language: 'nginx',
        code: `location /v1/charges {
  proxy_pass http://payments;
  proxy_read_timeout 3s;
  proxy_next_upstream error timeout non_idempotent;
  proxy_next_upstream_tries 3;
}`,
      },
      options: [
        'proxy_read_timeout is too low, so nginx drops the response and the client retries',
        'non_idempotent lets nginx resend a POST a slow upstream already processed',
        'Without keepalive, nginx opens a new connection per request, which duplicates the body',
        'proxy_next_upstream_tries 3 forces nginx to send each request to three upstreams in parallel',
      ],
      correct: [1],
      explanation:
        'By default nginx does not pass a non-idempotent request to the next upstream once it has been sent; non_idempotent overrides that, so a slow-but-successful charge that hits the 3 s read timeout is replayed on another server. The low timeout contributes, but the duplicate is created by nginx, not the client. Keepalive has nothing to do with duplication, and tries are sequential, not parallel.',
      followUps: [
        {
          "q": "Removing non_idempotent stops nginx replays, but the mobile client itself retries on timeout. How do you make the charge endpoint safe end to end?",
          "a": "Require an `Idempotency-Key` header, generated once per checkout attempt on the client and reused across retries. The payments service stores (key, request hash, status, response) in a table with a unique key. The first request inserts IN_PROGRESS and calls the PSP with the same key (Stripe and similar providers support this). Retries with the same key either wait or get the stored response; a different body under the same key returns 422. Keep keys for 24–72 hours. Then any layer (client, nginx or a load balancer) can retry safely, and a 3 s read timeout no longer risks a double charge."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-03',
      difficulty: 'expert',
      question:
        'Legacy monolith code calls https://api.example.com/sessions (the public gateway) to reach a new internal Session service in the same VPC. Select ALL real consequences.',
      options: [
        'Internal traffic pays edge costs: extra TLS, WAF/gateway latency and potentially cloud egress/NAT charges',
        'The internal Session API must be publicly routable, widening the attack surface',
        'The gateway becomes a hub-and-spoke bottleneck on the critical path of east–west traffic',
        'Service mesh mTLS is automatically applied end to end, improving security',
        'HTTP/2 multiplexing becomes impossible for the monolith',
      ],
      correct: [0, 1, 2],
      explanation:
        'This is the gateway loopback anti-pattern: traffic leaves and re-enters, adding cost and latency, internal APIs get exposed publicly, and the gateway turns into a hub and a single point of failure for east–west calls. No mesh mTLS applies because the traffic goes out through the public edge instead. HTTP/2 still works fine through most gateways, so that option is not a real consequence.',
      followUps: [
        {
          "q": "Hundreds of call sites in the monolith use the public URL. How do you migrate them to internal routing without touching every one at once?",
          "a": "Change resolution, not the code. Option 1: split-horizon DNS: inside the VPC, `api.example.com` resolves to an internal load balancer that routes `/sessions` directly to the Session service, while external clients still hit the public edge. Option 2: point the monolith's HTTP client at an internal base URL with a single config change, routed by an internal gateway or service mesh. Either way, enforce it: block the Session service from the public route (gateway rule or WAF) once internal routing works, and track public-edge requests that originate from VPC NAT IPs as a migration metric that should reach zero."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-04',
      difficulty: 'hard',
      question:
        'Kong runs 10 nodes behind an L4 LB with rate-limiting policy "local" at 600 requests/minute per consumer. A consumer spreads traffic evenly. Roughly how many requests per minute can they get through?',
      options: [
        '600 — Kong syncs local counters between nodes every second',
        '60 — the limit is divided across nodes automatically',
        '600, but only if sticky sessions are enabled on the LB',
        'About 6,000 — each node enforces 600 independently',
      ],
      correct: [3],
      explanation:
        'The local policy keeps counters in each node’s memory with no coordination, so the effective limit is about the per-node limit times the number of nodes the traffic reaches. Kong does not sync local counters or divide limits automatically. Sticky sessions would pin a consumer to one node and roughly restore 600, but that is a side effect of routing and still makes the limit depend on node count and failover.',
      followUps: [
        {
          "q": "You switch to the 'redis' policy. What new latency and failure costs did you just add per request, and how do you keep them small?",
          "a": "Each request now makes a Redis round trip (INCR plus EXPIRE, or a Lua script), typically 0.3–1 ms in the same AZ. At 50K RPS that's 50K ops/s on Redis, and Redis becomes a dependency in the critical path. Keep it cheap: co-locate Redis in each AZ, use a Lua token bucket in a single round trip, and pipeline. Or use hybrid local-plus-sync limiting: each node takes small allowances from Redis in batches (for example 50 tokens at a time), so most requests are checked locally and accuracy degrades only slightly. Define the Redis-down behaviour: fall back to local limits of about global ÷ nodes."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-05',
      difficulty: 'expert',
      question: 'A BFF handler is deployed with this code. Under a recommendations-service brownout (p99 8 s), what happens?',
      code: {
        language: 'typescript',
        code: `const [user, recs] = await Promise.all([
  fetch('http://users/v1/me', { headers }),
  fetch('http://recs/v1/home', { headers }),
]);
return { user: await user.json(), recs: await recs.json() };`,
      },
      options: [
        'Home requests fail fast because Promise.all rejects as soon as recs is slow',
        'Home requests take up to ~8 s and in-flight requests and sockets pile up, possibly exhausting the BFF',
        'Only the recs field is empty; Promise.all returns partial results on timeout',
        'fetch applies a 5 s default timeout, so home requests cap at 5 s',
      ],
      correct: [1],
      explanation:
        'Promise.all only rejects on a rejection, not on slowness, and fetch in Node has no short default timeout, so every home request waits for the slow recs call. Concurrency then piles up (Little’s law), which can exhaust sockets and memory. Promise.all never returns partial results; you need allSettled plus AbortSignal.timeout and a fallback for optional data.',
      followUps: [
        {
          "q": "You add per-call timeouts. How do you choose the recs timeout, and how would you know if you chose it badly?",
          "a": "Base it on data and the page budget. If the page SLO is 300 ms and core calls take about 150 ms, recs can get roughly 200–250 ms. Set it slightly above recs' healthy p99 (say p99 = 180 ms, timeout = 220 ms) so normally under 1% of calls time out. Measure the timeout rate and `degraded=true` responses per dependency. If the timeout rate exceeds a few percent when recs is healthy, the timeout is too tight and you're shedding value. Also track business impact, such as click-through on the home page with and without recs, to justify the trade-off."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-06',
      difficulty: 'hard',
      question:
        'Rate limiting keyed by client IP at your gateway suddenly blocks an entire corporate customer, while an attacker bypasses it easily. The gateway sits behind an NLB and the key is $http_x_forwarded_for. Best fix?',
      options: [
        'Switch the key to $remote_addr so the attacker can no longer spoof it',
        'Increase the burst size so the corporate NAT stops being blocked',
        'Resolve IP via trusted hops only; key on API key/user, IP as fallback',
        'Move rate limiting into each microservice, out of the gateway',
      ],
      correct: [2],
      explanation:
        'The raw XFF header is client-controlled, so attackers rotate it, and NAT users share one IP. Deriving the IP from trusted proxies fixes spoofing, and keying on the authenticated identity avoids punishing shared-NAT customers. $remote_addr behind a proxy would be the proxy’s IP (or the NLB’s, depending on setup), throttling everyone together. Raising the burst hides the problem, and per-service limits duplicate the logic without fixing the key.',
      followUps: [
        {
          "q": "A partner uses one API key from hundreds of servers, and an attacker steals a key. How do you rate-limit so both cases behave sensibly?",
          "a": "Use layered keys. The primary limit is per API key, sized to the contract (the partner's hundreds of servers share it, which is correct). Add a secondary per-IP or per-(key, IP) limit to catch a stolen key being used from unusual networks, plus anomaly detection on sudden geographic or ASN changes for that key. Run a global per-IP limit for unauthenticated endpoints such as login and signup. When a key is abused, revocation and rotation must take effect at the gateway within seconds (cache key status for 30–60 s at most)."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-07',
      difficulty: 'expert',
      question:
        'Which of these belong in an edge API gateway rather than in a domain service? Select ALL that apply.',
      options: [
        'JWT signature and expiry validation using cached JWKS',
        'Checking that user 42 may cancel order 991 based on order state',
        'Per-API-key quotas and 429 responses with Retry-After',
        'Injecting W3C traceparent and a request ID when absent',
        'Calculating the delivery fee from distance and surge multiplier',
      ],
      correct: [0, 2, 3],
      explanation:
        'Token validation, consumer quotas and trace or request ID injection are cross-cutting and consumer-facing, so they fit the gateway. Deciding whether a user can cancel a given order needs domain state and belongs in the orders service. Putting fee calculation in the gateway is the “gateway as ESB” pitfall: business logic in plugins couples releases and spreads the blast radius.',
      followUps: [
        {
          "q": "The gateway validates the JWT. Should the orders service trust the gateway blindly, or re-validate? Defend your choice.",
          "a": "Don't trust a plain header blindly unless the network guarantees that only the gateway can reach the service. Options: (1) mTLS between gateway and service, with the service accepting identity headers only from the gateway's certificate; (2) forward the original JWT and have services verify it locally with cached JWKS, which costs about 40 µs of CPU and gives defence in depth; (3) the gateway mints a short-lived internal token. Option 2 or 3 matters most in zero-trust setups, because a compromised internal pod could otherwise forge `X-User-Id`. The orders service still does the authorization: can this user cancel this order."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-08',
      difficulty: 'hard',
      question:
        'An Envoy route has timeout: 2s, num_retries: 3, per_try_timeout: 1s. The upstream is hung. How long does the client wait, and how many attempts are made at most?',
      options: [
        '2 s — the route timeout caps the total, so about two attempts',
        '4 s — four attempts (one plus three retries) of 1 s each',
        '1 s — per_try_timeout overrides the overall route timeout',
        '8 s — each of four attempts gets the full 2 s route timeout',
      ],
      correct: [0],
      explanation:
        'In Envoy the route timeout is the global budget that includes all retries, and per_try_timeout bounds each attempt. With a 2 s budget and 1 s per try, the request is cut off at about 2 s after roughly two attempts (backoff eats some of that time). Four 1 s attempts would need a 4 s budget, per_try_timeout does not override the route timeout, and 8 s misreads the route timeout as a per-attempt limit.',
      followUps: [
        {
          "q": "The upstream isn't hung but returns 503 instantly during an overload. With this config, how many attempts land on it per client request, and is that good?",
          "a": "If retries are on `5xx` (or `retriable-status-codes: 503`), fast 503s let all 1 + 3 = 4 attempts fit within the 2 s budget, so each client request becomes up to 4 upstream requests, quadrupling load on an already overloaded service. That's a retry storm. Mitigate with Envoy's retry budget (`retry_budget: budget_percent 20%`), so retries never exceed 20% of active requests; exponential backoff with jitter; and `retry_host_predicate: previous_hosts`, so retries go to other hosts. Also honour `x-envoy-overloaded` or `Retry-After`, where a 503 should mean back off rather than try again now."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-09',
      difficulty: 'medium',
      question:
        'A startup with one monolith and one SPA needs HTTPS, gzip and static file serving. The CTO wants to deploy a full API management platform "for the future". What is the best advice?',
      options: [
        'Deploy the API management platform now to avoid a later migration',
        'Build a custom gateway in Node so it can grow with the product',
        'Skip any proxy and terminate TLS in the Node process for lower latency',
        'Use a reverse proxy/managed LB now; add a gateway when needs appear',
      ],
      correct: [3],
      explanation:
        'The book recommends the simplest solution that meets current and known near-term requirements; a gateway adds a hop, operations work and a failure mode that nothing here needs yet. Building a custom gateway ignores TCO and opportunity cost. Terminating TLS in Node gives up buffering against slow clients and makes certificate management harder, with no real latency gain.',
      followUps: [
        {
          "q": "A year later you have 6 services, a partner API and mobile apps. Which concrete signals tell you it's now time to introduce a gateway?",
          "a": "Look for repeated cross-cutting work and consumer-facing needs. Signals: the same JWT validation, CORS and rate-limit code duplicated across 3 or more services; external partners needing API keys, quotas, usage analytics or a developer portal; route changes needing coordinated deploys of several services; inconsistent auth bugs between services; or a need for edge features like canary routing per route. When two or three of these exist, a managed gateway (AWS API Gateway, Kong or Envoy-based) earns its extra hop. Introduce it as a thin routing and auth layer, not a business-logic hub."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-10',
      difficulty: 'expert',
      question:
        'After migrating Node services behind an ALB (idle timeout 60 s), you see sporadic 502s, mostly at night. Which Node settings fix the most likely cause?',
      code: {
        language: 'typescript',
        code: `const server = app.getHttpServer();
// current settings (defaults)
// server.keepAliveTimeout = 5000
// server.headersTimeout   = 60000`,
      },
      options: [
        'keepAliveTimeout = 65000 and headersTimeout = 66000',
        'keepAliveTimeout = 0 to disable keepalive entirely',
        'keepAliveTimeout = 30000 and headersTimeout = 30000',
        'Raise the ALB idle timeout to 300 s and keep Node defaults',
      ],
      correct: [0],
      explanation:
        'The backend must keep idle sockets longer than the LB does, or the LB reuses a socket Node just closed and gets a reset, which surfaces as a 502. headersTimeout should exceed keepAliveTimeout. Disabling keepalive removes the race but forces a new connection per request. 30 s is still below 60 s, and raising the ALB timeout makes the mismatch worse.',
      followUps: [
        {
          "q": "Fixing Node's timeouts solved the nightly 502s. During deploys you still see bursts. Which part of the connection lifecycle is responsible now?",
          "a": "Shutdown, not idle reuse. When a task gets SIGTERM, the ALB keeps routing to it until deregistration completes, and keep-alive sockets stay open. If Node exits or closes its server immediately, in-flight and next requests get resets, which become 502s. Fix: on SIGTERM, keep serving while the target deregisters (wait about the deregistration delay or health-check failure time), send `Connection: close` on responses, call `server.close()` to finish in-flight requests, `closeIdleConnections()`, and use a hard exit after a cap. Set ECS `stopTimeout` or Kubernetes `terminationGracePeriodSeconds` long enough for the whole sequence."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-11',
      difficulty: 'hard',
      question:
        'Your org has a TLS gateway, then an auth gateway, then a department gateway, then a logging gateway before any service. What problems does this “turtles all the way down” setup typically cause? Select ALL that apply.',
      options: [
        'Added latency per hop, especially in tail percentiles',
        'Upgrades need coordination across many gateway-owning teams',
        'Unclear ownership of cross-cutting concerns such as tracing',
        'Automatic elimination of single points of failure through layering',
      ],
      correct: [0, 1, 2],
      explanation:
        'Stacked gateways add a network hop and queueing at each layer, raise the cost of change because many teams must coordinate, and blur ownership of concerns like tracing. Layers in series do not remove single points of failure. They add more of them, because any one layer failing breaks the path.',
      followUps: [
        {
          "q": "You must collapse the four gateways, but each owning team has real requirements. How do you consolidate without a political standoff?",
          "a": "Make one edge platform with pluggable, per-route policy owned by the respective teams. A platform team runs a single gateway fleet (TLS, routing, observability). The auth team owns the auth plugin or ext_authz service and its config; departments own their route configs in a GitOps repo with CODEOWNERS; logging becomes a standard filter emitting to the shared pipeline. Migrate one department at a time behind feature-flagged routes, measuring p99 before and after (each removed hop typically saves 1–5 ms p50 and more at the tail). Publish an SLO for the platform so teams trust it."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-12',
      difficulty: 'expert',
      question:
        'The rate-limit Redis cluster used by your gateway becomes unreachable at peak. Which policy is usually best for a consumer e-commerce API?',
      options: [
        'Fail closed: reject all requests with 503 until Redis recovers, to protect backends',
        'Fail open completely, with no limits at all, since rate limiting is non-critical',
        'Queue requests in the gateway until Redis returns, then apply the limits',
        'Fall back to per-node local buckets with conservative limits, and alert',
      ],
      correct: [3],
      explanation:
        'Rate limiting protects capacity, but a dependency outage should not become a full site outage, so degrading to local approximate limits keeps both availability and some protection. Failing closed turns a Redis outage into total downtime. Removing all limits exposes backends during peak. Queuing in the gateway ties up memory and connections and makes latency far worse.',
      followUps: [
        {
          "q": "With local fallback limits on 20 gateway nodes, what limit do you set per node, and what goes wrong if the LB isn't spreading traffic evenly?",
          "a": "The baseline is global ÷ node count: for 1,000 rps per consumer across 20 nodes, that's 50 rps per node, perhaps 60 to allow for imbalance. With L4 balancing of long-lived connections, a consumer may land on only 2–3 nodes, so it gets just 100–180 rps, an unfair throttle during the fallback. Conversely, if traffic is sticky to one node and you set a generous per-node limit, the consumer may get more than intended. Use moderate fallback limits, keep the fallback period short (alert immediately and fix Redis), and prefer identity-hashing consumers to a few nodes."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-13',
      difficulty: 'expert',
      question: 'This header handling runs at the edge before requests reach services that trust X-User-Id. What is the flaw?',
      code: {
        language: 'nginx',
        code: `location /api/ {
  auth_request /_validate;                 # sets $auth_user on success
  auth_request_set $auth_user $upstream_http_x_user;
  proxy_set_header X-User-Id $auth_user;
  proxy_pass http://services;
}
location /internal/ {
  proxy_pass http://services;              # for ops tools
}`,
      },
      options: [
        'auth_request cannot set variables, so X-User-Id is always empty',
        'proxy_set_header in /api/ appends a second X-User-Id instead of replacing it',
        '/internal/ is unauthenticated and passes client-set X-User-Id through',
        'auth_request adds too much latency; validate tokens client-side instead',
      ],
      correct: [2],
      explanation:
        'The /internal/ location is publicly reachable with no auth and does not clear X-User-Id, so anyone can impersonate a user against services that trust that header. auth_request_set is exactly how you capture auth results, so it does work. proxy_set_header replaces the header rather than appending. Validation must never move to the client.',
      followUps: [
        {
          "q": "Beyond fixing /internal/, how do you guarantee no future location block reintroduces this impersonation bug?",
          "a": "Make it structural rather than per location. Clear identity headers at the server level (`proxy_set_header X-User-Id \"\";` in the `server` or `http` block, inherited unless overridden) and set them only from `auth_request_set`. Better, have services require a signed identity (a gateway-minted JWT, or mTLS plus header) rather than a plain header. Add CI tests on the config: spin up nginx in a container and send `X-User-Id: 1` to every route, asserting it never reaches a backend echo server. Keep internal routes off the public listener entirely, using a separate server block bound to the internal interface."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-14',
      difficulty: 'medium',
      question:
        'A team wants to route /orders requests to different backends based on the "tier" field inside the JSON body. What is the strongest objection?',
      options: [
        'Gateways are unable to read request bodies at all, by design',
        'It couples gateway config to the schema and parses every body; use a header',
        'JSON bodies are still TLS-encrypted at the gateway, so it cannot see them',
        'Body-based routing breaks HTTP/2 multiplexing between client and gateway',
      ],
      correct: [1],
      explanation:
        'Many gateways can route on body content, but it leaks domain schema into infrastructure config and costs CPU and buffering for every request, so the book advises against it. TLS is terminated at the gateway, so the body is readable there. Routing on the body has nothing to do with HTTP/2 multiplexing.',
      followUps: [
        {
          "q": "The client team says they can't add a header because old app versions are in the field. How do you route by tier anyway?",
          "a": "Derive tier from something the gateway already knows. Usually tier belongs to the customer, not the request, so after JWT validation look up the tier from a claim, or from a cached account-to-tier map in the gateway, and set an internal `X-Tier` header for routing. The body is never parsed and old clients need no change. If tier truly varies per request, route all /orders to an orders service that reads the body and dispatches internally. Domain logic stays in the domain service, and the gateway config stays schema-free."
        }
      ],
    },
    {
      id: 'net-proxies-gateway-mcq-15',
      difficulty: 'expert',
      question:
        'A mobile BFF aggregates 6 downstream calls in parallel; each has p99 = 100 ms and is independent. Roughly what fraction of BFF requests will include at least one call slower than 100 ms, and what is the right mitigation? Select ALL that apply.',
      options: [
        'About 6% of requests (1 − 0.99^6 ≈ 5.9%)',
        'About 1%, since the calls run in parallel',
        'Mitigate with per-call timeouts and degraded responses for optional calls',
        'Mitigate by making the calls sequential so tails do not overlap',
        'Consider hedged requests for idempotent critical reads',
      ],
      correct: [0, 2, 4],
      explanation:
        'Fan-out amplifies tail latency: the chance that all 6 calls finish under their p99 is 0.99^6 ≈ 94%, so about 6% of requests see at least one slow call. Parallelism does not stop tail amplification, and sequential calls make total latency far worse. Timeouts with graceful degradation, plus hedging for idempotent critical reads, are the standard mitigations.',
      followUps: [
        {
          "q": "You add hedged requests: if a call hasn't answered by its p95, send a duplicate to another replica. What extra load does that create, and what are the risks?",
          "a": "By definition about 5% of calls exceed p95, so hedging adds about 5% more downstream requests, a modest cost for cutting the tail. Risks: during a broad slowdown many calls pass p95 at once, hedges multiply load exactly when the service is struggling, and a brownout becomes an outage. Mitigate with a hedge budget (for example no more than 5–10% extra, enforced by a token bucket), hedge only idempotent reads, cancel the loser when the first response arrives, and send the hedge to a different replica or AZ. Measure the p99 improvement against the added load."
        }
      ],
    },
  ],
};

export default topic;
