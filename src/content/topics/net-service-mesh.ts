import type { Topic } from '../../types';

const topic: Topic = {
  id: 'net-service-mesh',
  phase: 'networking',
  order: 4,
  title: 'Service Mesh: Service-to-Service Traffic',
  subtitle:
    'Sidecars, control vs data plane, mTLS identity, retries and circuit breaking in the mesh, traffic splitting, ambient/sidecarless — and when not to adopt one.',
  estimatedMinutes: 75,
  sources: [
    'Mastering API Architecture — Ch 4 Service Mesh: Service-to-Service Traffic Management',
    'Istio, Linkerd and Consul official documentation',
  ],
  tags: ['service-mesh', 'istio', 'linkerd', 'envoy', 'mtls', 'sidecar', 'ambient', 'ebpf', 'east-west'],
  cheatSheet: [
    'Mesh = pattern for east–west (service-to-service) traffic: routing, resilience, observability, security — without app code changes.',
    'Data plane = proxies on the request path (Envoy / linkerd2-proxy / ztunnel); control plane = config + identity + discovery (istiod), pushes via xDS. Data plane keeps working on last-known config if control plane dies.',
    'mTLS gives every workload a SPIFFE identity (spiffe://cluster.local/ns/X/sa/Y), certs rotated ~24h; AuthorizationPolicy then allows by identity, not IP.',
    'Retries multiply per layer: 3 layers × 3 attempts = 27× load on the leaf in a brownout. Retry in ONE layer, idempotent only, with perTryTimeout and a budget.',
    'Circuit breaking in Istio = connectionPool limits (fail fast on pending) + outlierDetection (eject bad hosts; cap maxEjectionPercent).',
    'Traffic splitting (weights), header routing and mirroring enable canaries decoupled from deploys — pair with automated analysis (Flagger/Argo Rollouts).',
    'Mesh gives L7 golden metrics for free, but distributed traces still need the app to forward trace headers (traceparent / b3).',
    'Sidecar cost scales with pods; ambient (ztunnel per node + optional waypoint per namespace), Cilium eBPF, and proxyless gRPC cut it.',
    'Classic sidecar failure modes: app starts before proxy, proxy exits before app drains, Jobs never complete, config push memory blow-up, PERMISSIVE→STRICT breaks non-mesh clients.',
    'Don’t adopt for < ~10 services or a single language with good libraries; anti-patterns: mesh as ESB, mesh as API gateway, too many networking layers.',
  ],
  sections: [
    {
      heading: 'What a service mesh is (and why it exists)',
      body: `**Intuition:** an API gateway is the security desk at the building entrance; a service mesh is a personal assistant sitting next to *every* employee, handling their internal phone calls: finding the right extension, retrying if busy, encrypting, and keeping a call log.

A **service mesh** is a *pattern* for managing all service-to-service (east–west) communication. It overlaps with gateways, with two key differences: it is optimised for internal traffic inside a cluster/DC, and the caller is a (somewhat) **known internal service**, not an anonymous user device. The term was coined by Buoyant (Linkerd) in 2016; Istio (Google/IBM/Lyft, built on Envoy) popularised it.

**What it gives you** (without touching app code):

- **Routing** — service-name resolution across environments, L7 load balancing (critical for gRPC/HTTP2 where L4 balancing pins a long-lived connection to one pod), traffic splitting, mirroring.
- **Reliability** — timeouts, retries, circuit breaking, outlier ejection, consistently across languages.
- **Security** — mTLS everywhere, workload identity, service-level authorization (“only attendee may call sessions”).
- **Observability** — request rate, success rate, latency per caller/callee pair, topology graphs.

**Evolution** (book Ch 4): *libraries* (Twitter Finagle, Netflix Ribbon/Hystrix/Eureka) → *sidecars* (Airbnb SmartStack Synapse/Nerve, Netflix Prana, Linkerd, Envoy) → *control-plane-managed sidecar meshes* (Istio, Linkerd2, Consul) → *proxyless* (gRPC xDS) and *sidecarless* (eBPF/Cilium, Istio ambient). Libraries force you to re-implement and upgrade in lockstep per language — the “price of polyglot”. Sidecars are “infrastructure dependency injection”.

**North–south vs east–west** (book Table 4-3):

| | Ingress (N/S) | Service-to-service (E/W) |
|---|---|---|
| Source | External users, partners | Internal, inside trust boundary |
| AuthN | User focused | Service (machine) identity + user |
| TLS | One-way | Mutual (can be strict mTLS) |
| Implementation | API gateway, reverse proxy | Mesh, libraries |
| Owner | Gateway / edge team | Platform team |`,
      keyPoints: [
        'Mesh = east–west; gateway = north–south. They complement, not replace, each other.',
        'The value is consistency across many services and languages without code changes.',
        'L7 balancing of HTTP/2 and gRPC is a real, often overlooked benefit.',
      ],
      source: 'Mastering API Architecture — Ch 4 (“What is service mesh?”, Table 4-3)',
    },
    {
      heading: 'Control plane vs data plane (how a request actually flows)',
      body: `**Intuition:** the control plane is air-traffic control (plans, rules, identities); the data plane is the planes actually flying. If ATC goes quiet, planes already in the air keep flying their last instructions — but no new flight plans get filed.

**Data plane** — proxies that sit on every request: Envoy sidecars (Istio, Consul), linkerd2-proxy (Rust, Linkerd), or ztunnel/waypoints (Istio ambient). They are *full proxies*: they terminate the client connection and originate a new one, so they can observe and manipulate both sides — at the cost of CPU, memory and some latency.

**Control plane** — istiod (historically Pilot = discovery/config, Citadel = certificates, Galley = config validation, merged into one binary in Istio 1.5). It watches Kubernetes (Services, Endpoints, your CRDs), computes proxy config and streams it via **xDS** (LDS listeners, RDS routes, CDS clusters, EDS endpoints, SDS secrets).

**Request path in sidecar mode (A → B):**

1. App A calls \`http://sessions:8080\`. An init container (or Istio CNI) has installed **iptables** rules redirecting outbound traffic to the local Envoy (port 15001) and inbound to 15006.
2. A's Envoy matches the route (VirtualService), picks an endpoint of the subset (EDS + LB algorithm), applies timeout/retry policy.
3. It opens (or reuses) an **mTLS** connection to B's pod, presenting A's SPIFFE cert.
4. B's Envoy terminates mTLS, verifies A's identity, evaluates **AuthorizationPolicy**, emits metrics, and forwards to B on localhost.

So each hop crosses **two proxies**. Typical overhead is well under a millisecond at p50 and ~1–3 ms at p99 per hop under load, depending on filters and CPU limits — multiply by call-graph depth.

**Book's key point:** the most vulnerable component is the **control plane**. Run it HA, secure it (it issues identities!), monitor push latency and errors. If it's down, existing proxies keep serving with last-known config and existing certs — but new pods won't get config/certs and endpoint changes stop propagating.`,
      diagram: `              +------------------ control plane ------------------+
              |  istiod: discovery + config (xDS) + CA (certs)    |
              +---------------------+-----------------------------+
                  xDS / SDS         |           xDS / SDS
        +---------------------------+---------------------------+
        v                                                       v
 +---------------- pod A ----+                 +---------------- pod B ----+
 | app A --iptables--> Envoy |==== mTLS =====> | Envoy --localhost--> app B|
 |  (plain HTTP)    outbound |  (SPIFFE certs) | inbound: authz, metrics   |
 +---------------------------+                 +---------------------------+
          data plane: every request crosses TWO proxies per hop`,
      keyPoints: [
        'xDS streams listeners/routes/clusters/endpoints/secrets to proxies.',
        'Two proxies per hop; latency and CPU overhead multiply with call-graph depth.',
        'Control plane down = no new config/certs, but existing traffic keeps flowing.',
      ],
      source: 'Mastering API Architecture — Ch 4 (Figure 4-2, “Service mesh sidecars and proxies”)',
    },
    {
      heading: 'mTLS and workload identity',
      body: `**Intuition:** instead of trusting anyone inside the office building (network perimeter), every employee wears an ID badge that is checked at every door — and badges expire daily.

**Why it matters.** Perimeter security assumes the internal network is safe; one compromised pod can then call anything. With a mesh, each workload gets a cryptographic identity tied to its **Kubernetes service account**, encoded as a SPIFFE ID in an X.509 cert: \`spiffe://cluster.local/ns/conf/sa/attendee\`. Proxies do **mutual TLS**, so both sides authenticate, traffic is encrypted, and authorization can be expressed by *identity*, not IP (IPs are ephemeral in Kubernetes).

**Certificate lifecycle.** istiod acts as a CA (or delegates to an external CA/Vault/cert-manager). Workload certs are short-lived (Istio default 24 h) and rotated automatically via SDS — no app restarts, no cert files in images. Watch the **root CA** expiry: an expired root is a mesh-wide outage.

**Rollout mode.** Istio \`PeerAuthentication\` supports PERMISSIVE (accept mTLS and plaintext) and STRICT (mTLS only). Migrate: PERMISSIVE everywhere → verify via telemetry that all callers use mTLS → STRICT per namespace. Flipping to STRICT early breaks non-mesh callers (legacy VMs, Prometheus scraping, jobs without sidecars).

**Authorization.** Default-deny, then allow specific identities — the same idea as Consul **intentions** (source, destination, allow/deny) from the book. You can go further to L7 (methods, paths), but keep domain rules (“user owns order”) in the app.

**Don't double-encrypt.** If the app itself speaks HTTPS to another in-mesh service, the sidecar sees opaque TCP: no L7 routing, retries or per-route metrics. Let the app speak plain HTTP to localhost and let the proxy originate mTLS.`,
      code: [
        {
          language: 'yaml',
          title: 'Istio: strict mTLS + identity-based authorization (default deny)',
          code: `apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata: { name: default, namespace: conf }
spec:
  mtls: { mode: STRICT }              # after PERMISSIVE soak shows 100% mTLS
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: deny-all, namespace: conf }
spec: {}                               # empty spec = deny all in namespace
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: sessions-allow, namespace: conf }
spec:
  selector:
    matchLabels: { app: sessions }
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - cluster.local/ns/conf/sa/attendee     # SPIFFE identity
              - cluster.local/ns/legacy/sa/conference-app
      to:
        - operation:
            methods: ['GET', 'POST']
            paths: ['/v1/sessions*']`,
        },
      ],
      keyPoints: [
        'Identity = service account → SPIFFE ID in a short-lived cert, rotated automatically.',
        'Migrate PERMISSIVE → STRICT only after telemetry proves all callers use mTLS.',
        'Let the proxy originate TLS; app-level TLS blinds the mesh to L7.',
      ],
      source: 'Mastering API Architecture — Ch 4 (“Enforce security”, “Network segmentation with Consul”)',
    },
    {
      heading: 'Timeouts, retries and circuit breaking in the mesh',
      body: `**Intuition:** retries are like redialling a busy number. One person redialling is fine; everyone in a call centre redialling three times at once is how you melt the phone exchange.

**Istio resources.** A **VirtualService** defines routing rules applied when a host is addressed (timeouts, retries, splits, matching). A **DestinationRule** defines policies *after* routing: subsets (versions), load-balancing algorithm, connection pool sizes, outlier detection.

**Timeouts.** Set a route \`timeout\` (total) and \`perTryTimeout\` (each attempt). Budgets must shrink along the call chain; a caller's timeout should exceed callee timeout × attempts, or the caller gives up while retries still run (wasted work).

**Retries.** Istio has a **default of 2 retries** (on connect-failure, refused-stream, unavailable, cancelled, retriable-status-codes) unless you override it. The danger is **multiplicative retries**: app retries 3× × mesh 3× × gateway 3× = **27×** traffic to a struggling leaf. Rules:

- Retry in exactly one layer (usually the mesh, closest to the failure).
- Only idempotent operations (GET, PUT with idempotency, or POST + Idempotency-Key).
- Retry on connection-level failures and 503s, not on every 5xx (a 500 from a bug fails again).
- Keep a retry budget (Linkerd has retry budgets natively, e.g. ≤20% extra load).

**Circuit breaking** in Istio = two mechanisms:

- \`connectionPool\` — cap connections/pending requests/in-flight requests per upstream; excess fails fast with 503 (UO flag) instead of queueing (bulkhead).
- \`outlierDetection\` — eject a host after N consecutive 5xx/gateway errors for \`baseEjectionTime\` (grows with repeated ejections); \`maxEjectionPercent\` caps how many hosts can be ejected so you never eject the whole pool.

**Book example:** thousands of attendees open their schedule after the keynote → Session service degrades → the mesh breaker fails calls fast → the mobile app falls back to the generic conference schedule. The *fallback* is still app logic — the mesh only fails fast.`,
      code: [
        {
          language: 'yaml',
          title: 'VirtualService + DestinationRule: bounded retries, fail-fast pools, outlier ejection',
          code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata: { name: sessions }
spec:
  hosts: [sessions]
  http:
    - route:
        - destination: { host: sessions, subset: v1 }
      timeout: 1.5s                      # total budget incl. retries
      retries:
        attempts: 2
        perTryTimeout: 500ms
        retryOn: connect-failure,refused-stream,unavailable,503
---
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata: { name: sessions }
spec:
  host: sessions
  trafficPolicy:
    loadBalancer: { simple: LEAST_REQUEST }
    connectionPool:
      tcp: { maxConnections: 200, connectTimeout: 200ms }
      http:
        http1MaxPendingRequests: 50      # queue beyond this -> fast 503
        http2MaxRequests: 500            # max in-flight requests to the service
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 10s
      baseEjectionTime: 30s
      maxEjectionPercent: 50             # never eject the whole pool
  subsets:
    - name: v1
      labels: { version: v1 }
    - name: v2
      labels: { version: v2 }`,
        },
      ],
      keyPoints: [
        'Total retry amplification = product of attempts at every layer.',
        'connectionPool = bulkhead/fail-fast; outlierDetection = per-host ejection.',
        'Fallbacks are app logic; the mesh only makes failure fast and visible.',
      ],
      source: 'Mastering API Architecture — Ch 4 (“Reliability”, “Routing with Istio”)',
    },
    {
      heading: 'Traffic splitting, header routing and mirroring',
      body: `**Intuition:** instead of flipping a light switch (deploy = release), you use a dimmer (release gradually), and you can test a new bulb in a mirror before anyone sees it.

**Decouple deploy from release.** Deploy v2 pods (receiving 0% traffic), then shift weight 1% → 5% → 25% → 100% while watching success rate and latency *of v2 specifically*. Roll back by setting v2's weight to 0 — seconds, no redeploy.

**Header-based routing** — route \`x-canary: true\` or internal employees to v2 (dogfooding) before any customer sees it. Needs the header to be **propagated** through the call chain for multi-service canaries.

**Mirroring (shadowing)** — send a copy of live traffic to v2, discard its responses. Perfect for read paths and performance testing; dangerous for writes (v2 would double-charge or double-email) unless v2 writes to a sandbox.

**Traffic policing/shaping** — the mesh can also enforce local rate limits per service so a misbehaving internal service can't DoS a fragile dependency (e.g. a database-backed legacy service).

**Automate the analysis.** Weighted routing by hand is error-prone; use **Flagger** or **Argo Rollouts** to step weights and auto-rollback on Prometheus queries (e.g. v2 success rate < 99.5% or p99 > 300 ms).

**Gotchas**

- Weights apply **per request** at the caller's proxy; long-lived gRPC streams still get balanced per request by Envoy, but raw TCP connections are split per connection.
- Sticky user experience (same user always sees v2) needs header/cookie-based matching or consistent-hash LB, not weights.
- Small traffic → noisy metrics: 1% of 50 RPS is one request every two seconds; wait long enough for statistical confidence.`,
      code: [
        {
          language: 'yaml',
          title: 'Canary by header + weight, plus mirroring to v3',
          code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata: { name: attendees }
spec:
  hosts: [attendees]
  http:
    - match:
        - headers:
            x-canary: { exact: 'true' }      # employees / testers first
      route:
        - destination: { host: attendees, subset: v2 }
    - route:
        - destination: { host: attendees, subset: v1 }
          weight: 95
        - destination: { host: attendees, subset: v2 }
          weight: 5
      mirror: { host: attendees, subset: v3 }  # shadow copy, responses dropped
      mirrorPercentage: { value: 10.0 }        # mirror only reads-heavy route!
      timeout: 2s`,
        },
      ],
      keyPoints: [
        'Weights for gradual release, headers for targeted release, mirroring for zero-risk read testing.',
        'Never mirror non-idempotent writes to a version that talks to real side-effect systems.',
        'Automate steps and rollback on SLO metrics.',
      ],
      source: 'Mastering API Architecture — Ch 4 (“Advanced traffic routing: shaping, policing, splitting, and mirroring”)',
    },
    {
      heading: 'Observability: what the mesh gives you and what it can’t',
      body: `**Intuition:** the mesh is a CCTV camera on every corridor — it sees who walked where and how long it took, but it can't see what happened inside the rooms, and it can't tie together one visitor's journey unless the visitor carries the same ticket everywhere.

**Free with the mesh** (Linkerd viz, Istio + Prometheus/Grafana/Kiali):

- Golden metrics per workload and per caller/callee edge: **request rate, success rate, latency distribution** (p50/p95/p99) for HTTP, HTTP/2, gRPC; bytes in/out for raw TCP.
- Topology graphs, live request sampling (\`linkerd viz tap\`), access logs.
- Consistent labels (source workload, destination workload, response code) across all languages.

**Not free:**

- **Distributed tracing**: proxies generate spans, but they can't correlate an inbound request with the outbound calls the app makes. The application must **forward trace headers** (\`traceparent\`/\`tracestate\` for W3C, or \`x-b3-*\`, plus \`x-request-id\`) from inbound to outbound requests. OpenTelemetry auto-instrumentation does this for you.
- **Business metrics** (orders placed, payment failures by PSP) — instrument in code.
- **Inside-the-process** latency (event-loop lag, DB pool wait) — app metrics.

**Cardinality.** Per-edge metrics across 500 services × versions × response codes can explode Prometheus series; drop unused labels/metrics in the telemetry config.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS: propagate trace context so mesh spans join into one trace',
          code: `import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';

// Headers the mesh / tracing backend needs to stitch spans together
const PROPAGATE = [
  'traceparent', 'tracestate',                       // W3C Trace Context
  'x-request-id',                                    // Envoy request id
  'x-b3-traceid', 'x-b3-spanid', 'x-b3-parentspanid', 'x-b3-sampled', 'b3',
  'x-canary',                                        // keep canary routing sticky downstream
];

@Injectable({ scope: Scope.REQUEST })
export class DownstreamClient {
  constructor(@Inject(REQUEST) private readonly req: Request) {}

  private headers(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const h of PROPAGATE) {
      const v = this.req.headers[h];
      if (typeof v === 'string') out[h] = v;
    }
    return out;
  }

  async getSessions(attendeeId: string) {
    // plain HTTP to the service name: the sidecar originates mTLS and applies retries
    const res = await fetch('http://sessions:8080/v1/sessions?attendee=' + encodeURIComponent(attendeeId), {
      headers: this.headers(),
      signal: AbortSignal.timeout(1500),              // align with mesh route timeout
    });
    if (!res.ok) throw new Error('sessions ' + res.status);
    return res.json();
  }
}`,
        },
      ],
      keyPoints: [
        'Golden metrics per edge come free and consistent across languages.',
        'Traces require app-level header propagation (or OpenTelemetry auto-instrumentation).',
        'Watch metric cardinality at scale.',
      ],
      source: 'Mastering API Architecture — Ch 4 (“Provide transparent observability”, “Observing traffic with Linkerd”)',
    },
    {
      heading: 'Sidecar vs sidecarless: ambient, eBPF and proxyless gRPC',
      body: `**Intuition:** sidecars are a bodyguard per person — thorough but expensive. Sidecarless is a security team per floor (node) plus a specialist you call only when needed.

**The sidecar tax.** Every pod gets a proxy: 20 services × 5 pods = 100 proxies. Memory per proxy grows with the size of the mesh config it receives; the book cites an Istio tuning story going from ~1 GB to ~60–70 MB per proxy by scoping config — still ~2 GB/node for 100 proxies on 3 nodes. Scope config with Istio's \`Sidecar\` resource (only the hosts a workload actually calls).

**Options**

| Model | How | Pros | Cons |
|---|---|---|---|
| **Library / proxyless** (gRPC xDS) | Mesh logic in the client library, config via xDS | No extra hop, lowest latency | Single language/protocol (gRPC); upgrade = redeploy app |
| **Sidecar proxy** (Istio classic, Linkerd, Consul) | Proxy per pod, iptables redirect | Language-agnostic, mature, full L7 | CPU/memory per pod, lifecycle ordering issues, upgrades need pod restarts |
| **Istio ambient** (GA in 1.24) | **ztunnel** per node for L4 + mTLS; optional **waypoint** proxy (Envoy) per namespace/service for L7 | No sidecar injection/restarts, much lower resource use, pay for L7 only where needed | Newer; L7 policy only where a waypoint exists; node-level shared component |
| **eBPF / Cilium** | Kernel programs for L3/L4 + per-node Envoy for L7 | Low overhead, hard to bypass (kernel) | Kernel version dependence; L7 still via proxy |

**Trade-off from the book (Table 4-4):** library meshes give the deepest insight but need per-language upgrades; proxy meshes are language-agnostic and upgrade independently; kernel meshes are OS-level with strong enforcement but require kernel program updates.

**Interview line:** "Default to sidecar Linkerd/Istio for maturity at tens to low hundreds of services; evaluate ambient when sidecar cost or restart-on-upgrade pain dominates; proxyless gRPC for latency-critical gRPC-only paths."`,
      diagram: `SIDECAR                              AMBIENT (Istio)
+--pod--------+ +--pod--------+       node 1                   node 2
| app | envoy | | app | envoy |      +--------------------+   +--------------+
+-------------+ +-------------+      | app  app  app      |   | app  app     |
 N pods => N proxies                 |   \\   |   /        |   |   \\  /       |
                                     |   ztunnel (L4,mTLS)|==>|  ztunnel     |
                                     +--------------------+   +--------------+
                                         optional waypoint (Envoy) for L7 policy`,
      keyPoints: [
        'Sidecar cost ∝ pods; ambient cost ∝ nodes (+ waypoints where L7 is needed).',
        'Scope proxy config (Sidecar resource) or memory grows with mesh size.',
        'Proxyless gRPC removes hops but ties you to a language/protocol.',
      ],
      source: 'Mastering API Architecture — Ch 4 (“Evolution of service mesh”, Table 4-4)',
    },
    {
      heading: 'Mesh failure modes you will meet in production',
      body: `**Intuition:** adding a proxy to every pod adds a second process with its own lifecycle, config and failure modes — most mesh incidents are about *ordering* and *scope*, not the proxy crashing.

| Symptom | Cause | Fix |
|---|---|---|
| App crashes on startup: "connection refused" to DB/config | App starts before sidecar is ready; outbound traffic is redirected to a proxy that isn't listening | \`holdApplicationUntilProxyStarts: true\`, or Kubernetes **native sidecars** (init container with restartPolicy: Always, beta/on by default since 1.29) |
| 503s / resets during deploys | Sidecar receives SIGTERM and exits before the app finishes in-flight requests | Proxy drain duration, preStop hooks, native sidecars (terminated after main containers) |
| Kubernetes Jobs never complete | Main container exits, sidecar keeps the pod running | Native sidecars, or call the proxy's quit endpoint at job end |
| Proxies OOM / slow config pushes after the mesh grows | Every proxy gets config for every service | \`Sidecar\` resource to scope egress hosts; watch istiod push time |
| Sudden 503s after enabling STRICT mTLS | Non-mesh callers (VMs, Prometheus, pods without injection) send plaintext | PERMISSIVE soak, telemetry check, exceptions per port |
| Weird L7 behaviour/no metrics on a port | Protocol misdetected (port not named \`http-*\`/\`grpc-*\` or \`appProtocol\` missing) | Declare \`appProtocol\` on Service ports |
| All traffic to a service fails fast | outlierDetection ejecting too many hosts, or connectionPool too small | Cap \`maxEjectionPercent\`, size pools from load tests |
| Mesh-wide TLS failures | Root/intermediate CA expired | Monitor cert expiry; rotate CA with overlap |
| New pods get no config | istiod down or overloaded | HA control plane (≥2–3 replicas, PDB, HPA), alert on push errors |

**Mesh as SPOF.** Like a gateway, the mesh is on the hot path of nearly everything and constantly reconfigured, so apply the same discipline: config as code, validation (\`istioctl analyze\`), canary control-plane upgrades with **revisions** (run two istiod versions side by side, migrate namespaces gradually), and clear ownership.`,
      code: [
        {
          language: 'yaml',
          title: 'Pod-level fixes for sidecar lifecycle issues (Istio)',
          code: `apiVersion: apps/v1
kind: Deployment
metadata: { name: attendee }
spec:
  template:
    metadata:
      labels: { app: attendee, version: v1 }
      annotations:
        # Start app only after Envoy is ready; drain Envoy slowly on shutdown
        proxy.istio.io/config: |
          holdApplicationUntilProxyStarts: true
          terminationDrainDuration: 20s
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: app
          image: registry.example.com/attendee:1.8.2
          ports:
            - containerPort: 3000
          lifecycle:
            preStop:
              exec: { command: ['sleep', '10'] }   # let endpoints update first
---
apiVersion: v1
kind: Service
metadata: { name: attendee }
spec:
  selector: { app: attendee }
  ports:
    - name: http
      port: 8080
      targetPort: 3000
      appProtocol: http        # explicit protocol, no sniffing surprises
---
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata: { name: attendee, namespace: conf }
spec:
  workloadSelector: { labels: { app: attendee } }
  egress:
    - hosts: ['./sessions.conf.svc.cluster.local', 'istio-system/*']  # scope config`,
        },
      ],
      keyPoints: [
        'Startup/shutdown ordering is the #1 sidecar gotcha; native sidecars fix most of it.',
        'Scope proxy config; unscoped meshes scale memory with O(services).',
        'Upgrade the control plane with revisions/canaries, not in place.',
      ],
      source: 'Mastering API Architecture — Ch 4 (“Service mesh as a single point of failure”)',
    },
    {
      heading: 'When NOT to adopt a mesh, anti-patterns, and choosing one',
      body: `**Intuition:** a mesh is like installing a building-wide HVAC system — brilliant for a skyscraper, absurd for a two-room office.

**Signals you don't need one (yet)**

- Fewer than ~10–20 services, one or two languages with solid libraries (e.g. NestJS + a shared HTTP client with timeouts, retries, OpenTelemetry).
- No requirement for mTLS / zero-trust between services, or it's met by the cloud (VPC + security groups + IAM auth).
- No platform team to own it: a mesh is a **Type 1 (hard-to-reverse) decision** with ongoing upgrade and on-call cost.

**Anti-patterns (book Ch 4)**

1. **Mesh as ESB** — Wasm/Lua filters doing payload transformation and business rules. Same problem as gateway-as-ESB: coupling and lockstep releases.
2. **Mesh as gateway** — adopting a mesh only for its ingress gateway. Mesh gateways lack rich API-management features (IdP integration, WAF, portals) and you pay the whole mesh's operational cost for a gateway.
3. **Too many networking layers** — mesh on top of CNI policies, library circuit breakers, and an internal gateway: incompatibilities (headers stripped), extra hops, and features implemented twice (circuit breaking in mesh *and* in the client library).

**Comparison**

| | Istio | Linkerd | Consul |
|---|---|---|---|
| Data plane | Envoy (sidecar) or ztunnel + waypoints (ambient) | linkerd2-proxy (Rust, sidecar) | Envoy |
| Strength | Richest traffic mgmt & policy, ambient mode, big ecosystem | Simplicity, low overhead, mTLS on by default, retry budgets | Multi-platform (VMs + K8s), service discovery, intentions |
| Cost | Most complex to operate | Fewer knobs | Needs Consul servers (Raft) |

**Selection checklist (book Table 4-5):** prioritised requirements; existing mesh-like solutions (shared libraries, internal gateways); team skills and constraints; roadmap; honest build-vs-buy TCO; consult dev teams, QA, architecture review, platform, InfoSec. And: *standardise on one* open-source/commercial mesh — never build your own.`,
      keyPoints: [
        'A mesh is a Type 1 decision: requires an owning platform team.',
        'Avoid ESB behaviour, mesh-as-gateway and duplicated networking layers.',
        'Linkerd for simplicity, Istio for breadth, Consul for hybrid VM + K8s estates.',
      ],
      source: 'Mastering API Architecture — Ch 4 (“Common service mesh implementation challenges”, “Selecting a service mesh”)',
    },
  ],
  codeChallenges: [
    {
      id: 'net-service-mesh-cc-1',
      title: 'Stop the mesh config from amplifying a brownout',
      context:
        'During a partial outage of the inventory service (30% of pods slow), the whole checkout path collapsed. Inventory saw ~20x its normal RPS. The team’s mesh config is below; the checkout app also retries 3 times in code.',
      task:
        'Rewrite the VirtualService/DestinationRule so failures are contained: bounded total latency, no retry storms, no retries of non-idempotent calls, and no ejection of the entire pool.',
      starter: {
        language: 'yaml',
        code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata: { name: inventory }
spec:
  hosts: [inventory]
  http:
    - route:
        - destination: { host: inventory }
      retries:
        attempts: 5
        retryOn: 5xx,reset,connect-failure
      # no timeout: use defaults
---
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata: { name: inventory }
spec:
  host: inventory
  trafficPolicy:
    connectionPool:
      http:
        http1MaxPendingRequests: 100000
    outlierDetection:
      consecutive5xxErrors: 1
      interval: 1s
      baseEjectionTime: 5m
      maxEjectionPercent: 100`,
      },
      hints: [
        'Multiply: app attempts × mesh attempts. What does that do to a service that is already slow? What bounds each attempt?',
        'POST /reservations goes through the same route. What does retryOn: 5xx mean for it?',
        'With consecutive5xxErrors: 1 and maxEjectionPercent: 100, what happens when a transient blip hits every pod?',
      ],
      solution: {
        language: 'yaml',
        code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata: { name: inventory }
spec:
  hosts: [inventory]
  http:
    # Reads: safe to retry, bounded per attempt and in total
    - match:
        - method: { exact: GET }
      route:
        - destination: { host: inventory }
      timeout: 800ms                    # total, including retries
      retries:
        attempts: 2
        perTryTimeout: 300ms
        retryOn: connect-failure,refused-stream,unavailable,503
    # Writes (reservations): no mesh retries; client retries with Idempotency-Key
    - route:
        - destination: { host: inventory }
      timeout: 1s
      retries:
        attempts: 0
---
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata: { name: inventory }
spec:
  host: inventory
  trafficPolicy:
    loadBalancer: { simple: LEAST_REQUEST }   # steer away from slow pods
    connectionPool:
      tcp: { maxConnections: 300, connectTimeout: 200ms }
      http:
        http1MaxPendingRequests: 64    # fail fast instead of queueing forever
        http2MaxRequests: 600          # sized from load test (~2x peak in-flight)
    outlierDetection:
      consecutive5xxErrors: 5
      consecutiveGatewayErrors: 3
      interval: 10s
      baseEjectionTime: 30s            # grows with repeated ejections
      maxEjectionPercent: 50           # keep at least half the pool
      minHealthPercent: 30`,
      },
      explanation: `**Fixes**

- **Retry amplification**: app 3 attempts × mesh 6 attempts (1 + 5 retries) = up to 18× load, which matches the ~20× the team saw. Now the mesh makes at most 3 attempts on reads, and the **app's retries must be removed** (retry in one layer only).
- **Bounded latency**: \`timeout\` sets the total budget and \`perTryTimeout\` bounds each attempt. Before, each attempt could hang until the default route timeout.
- **Safe retry conditions**: only connection-level failures and 503. \`5xx\` would retry deterministic 500s and non-idempotent writes.
- **Writes are split out** with \`attempts: 0\`. Duplicate reservations are prevented by client-side retries that carry an Idempotency-Key the service deduplicates.
- **Fail fast (bulkhead)**: 100K pending requests meant unbounded queueing and memory growth. A small pending queue returns fast 503s the caller can degrade on.
- **Outlier detection**: ejecting on a single 5xx for 5 minutes, up to 100% of hosts, could remove the whole pool after a blip. Thresholds are now realistic, ejection is capped at 50%, and \`minHealthPercent\` turns ejection off when too few hosts are healthy.
- **LEAST_REQUEST** moves load away from the 30% of slow pods, where round robin would keep sending them a full share.`,
      followUps: [
        {
          "q": "How would you prove this config actually contains a brownout before the next real incident?",
          "a": "Run a chaos test in staging under production-like load: use Istio fault injection (`fault.delay` of 2 s on 30% of requests to inventory, or `abort` with 503), or slow 30% of the pods with a sidecar delay. Assert on metrics: inventory RPS stays ≤ about 1.2× the baseline (no amplification), checkout p99 stays bounded near the 800 ms route timeout, and outlier ejections never exceed 50% of hosts. Also check that POST /reservations sees zero mesh retries. Automate it as a game-day script so regressions in YAML get caught."
        },
        {
          "q": "Traffic grows 10× and inventory autoscales from 10 to 100 pods. Which numbers in your DestinationRule are now wrong?",
          "a": "The connection pool limits are per client proxy per destination cluster, so they don't grow with pod count. `http2MaxRequests: 600` was sized for about 2× the old peak in-flight per caller; at 10× load each checkout proxy may need about 6,000, or it will shed healthy traffic with UO (upstream overflow) 503s. Re-derive with Little's law: in-flight = RPS per caller proxy × latency. `maxConnections: 300` is similar. The outlier detection percentages scale fine. Keep these values in a templated chart driven by load-test numbers, not hand-tuned constants."
        }
      ],
    },
    {
      id: 'net-service-mesh-cc-2',
      title: 'Make a NestJS client mesh-friendly',
      context:
        'The team just moved to Istio but traces are broken (every service shows a separate trace), canary headers are lost after the first hop, the mesh shows only TCP metrics for calls to pricing, and retries still multiply.',
      task:
        'Refactor the client so the mesh can apply L7 policy and telemetry, trace/canary context flows end to end, and retry behaviour is not duplicated.',
      starter: {
        language: 'typescript',
        code: `import { Injectable } from '@nestjs/common';
import https from 'node:https';
import axios from 'axios';
import { readFileSync } from 'node:fs';

@Injectable()
export class PricingClient {
  private agent = new https.Agent({
    cert: readFileSync('/certs/client.crt'),   // hand-rolled mTLS
    key: readFileSync('/certs/client.key'),
    ca: readFileSync('/certs/ca.crt'),
  });

  async quote(sku: string, qty: number) {
    for (let i = 0; i < 5; i++) {
      try {
        const res = await axios.post('https://pricing.shop.svc:8443/v1/quote', { sku, qty }, {
          httpsAgent: this.agent,
        });
        return res.data;
      } catch (e) {
        // retry everything immediately
      }
    }
    throw new Error('pricing unavailable');
  }
}`,
      },
      hints: [
        'What can the sidecar see when the app itself speaks TLS? Which features depend on seeing HTTP?',
        'How would the next service know which trace or canary this request belongs to?',
        'Who else is already retrying this call, and is POST /quote safe to retry?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import axios, { AxiosError } from 'axios';
import http from 'node:http';

const PROPAGATE = ['traceparent', 'tracestate', 'x-request-id', 'b3', 'x-b3-traceid',
  'x-b3-spanid', 'x-b3-parentspanid', 'x-b3-sampled', 'x-canary'];

// Plain HTTP to the service name: the sidecar does mTLS (SPIFFE identity, rotation),
// L7 routing, metrics and the single retry policy.
const client = axios.create({
  baseURL: 'http://pricing.shop.svc.cluster.local:8080',
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 100 }),
  timeout: 1200,                        // slightly above mesh route timeout (1s)
});

@Injectable({ scope: Scope.REQUEST })
export class PricingClient {
  constructor(@Inject(REQUEST) private readonly req: Request) {}

  private ctxHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    for (const k of PROPAGATE) {
      const v = this.req.headers[k];
      if (typeof v === 'string') h[k] = v;
    }
    return h;
  }

  async quote(sku: string, qty: number, idempotencyKey: string) {
    try {
      const res = await client.post('/v1/quote', { sku, qty }, {
        headers: { ...this.ctxHeaders(), 'idempotency-key': idempotencyKey },
      });
      return res.data;
    } catch (e) {
      const err = e as AxiosError;
      // No app-level retry loop: the mesh retries connect failures/503 once, within budget.
      // Surface a typed error so the caller can degrade (e.g. show cached price).
      throw new Error('pricing failed: ' + (err.response?.status ?? err.code));
    }
  }
}`,
      },
      explanation: `**Fixes**

- **App-level TLS removed**: with HTTPS in the app, the sidecar only sees opaque TCP, so there are no HTTP metrics, retries or header routing, and you manage cert files by hand. Plain HTTP to localhost lets the proxy originate mTLS using rotated SPIFFE certs.
- **Context propagation**: forwarding \`traceparent\`/b3/\`x-request-id\` stitches the spans into one trace. Forwarding \`x-canary\` keeps a canary request on canary versions downstream.
- **One retry layer**: the immediate 5× loop, with no backoff, on top of Istio's default 2 retries meant up to 15 attempts per call. The retry policy now lives only in the mesh.
- **Idempotency**: POST /quote carries an Idempotency-Key, so the mesh's connection-failure retries can't cause duplicate side effects.
- **Timeouts and keepalive**: the axios timeout is aligned just above the mesh route timeout, and a pooled keepalive agent avoids per-call connection setup through the sidecar.`,
      followUps: [
        {
          "q": "Part of the codebase uses gRPC, and some async work happens on a Kafka consumer. How do you keep trace and canary context flowing there?",
          "a": "For gRPC, OTel's gRPC instrumentation copies `traceparent` into metadata, and the mesh routes on gRPC metadata like any header, so `x-canary` works when it is forwarded as metadata. Kafka bypasses the mesh's L7 entirely: inject `traceparent` and `x-canary` into the record headers at produce time and extract them in the consumer, which starts a span linked to the producer span. Canary routing for messages has to be done by the app, for example canary consumers that filter on the header or read a separate topic, because no proxy sits in that path."
        },
        {
          "q": "How do you unit-test that this client never retries on its own and always forwards the context headers?",
          "a": "Mock the HTTP layer with `nock` (or msw) on `pricing.shop.svc.cluster.local:8080`. Test 1: build the client with a fake request containing `traceparent`, `x-canary` and `x-request-id`, and assert the intercepted request carries them plus an `idempotency-key`. Test 2: make the mock reply 503 once and assert `quote()` rejects with 'pricing failed: 503' and that exactly one request was made (`scope.isDone()` and no pending mocks). Test 3: a request without context headers sends none and does not crash. Add a lint rule that bans retry loops in client modules."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'net-service-mesh-iq-01',
      difficulty: 'hard',
      question:
        'We have 35 microservices in Node, Go and Python on Kubernetes. The CTO wants Istio “for security and observability”. Would you adopt a service mesh? Convince me either way.',
      whatInterviewerLooksFor: [
        'Requirement-driven decision, not hype',
        'Knows costs: resources, latency, operational ownership, upgrades',
        'Considers alternatives (libraries, OpenTelemetry, cloud IAM, NetworkPolicy)',
        'Proposes incremental adoption and success metrics',
      ],
      modelAnswer: `### Start from requirements
- **Security**: do we need mTLS/zero-trust (compliance like PCI, SOC 2 with encryption in transit, multi-tenant clusters)? Or do NetworkPolicies + TLS at the edge suffice?
- **Observability**: do we lack per-edge golden metrics today? Are traces broken?
- **Traffic management**: do we need canaries, gRPC L7 balancing, consistent timeouts/retries across 3 languages?

### Why a mesh is plausible here
35 services in **3 languages** is where the "price of polyglot" bites: implementing retries, timeouts, mTLS and metrics consistently in Node, Go and Python libraries means three codebases to keep in lockstep. A mesh gives:
- mTLS + identity-based authz without code changes,
- consistent RED metrics per edge,
- canary/traffic splitting decoupled from deploys,
- L7 balancing for gRPC.

### Costs I'd be explicit about
- **Resources**: ~0.1–0.5 vCPU and 50–150 MB per sidecar under load → with 35 services × 4 pods = 140 sidecars ≈ 14–70 vCPU and 7–20 GB.
- **Latency**: two proxies per hop, sub-ms p50, 1–3 ms p99 per hop; a 5-hop path adds several ms p99.
- **Operations**: control plane upgrades, CRD sprawl, sidecar lifecycle bugs, an owning platform team with on-call. It's a **Type 1 decision**.

### My recommendation
Adopt, but incrementally and with the simplest viable mesh:
1. Pilot **Linkerd** (or Istio ambient to avoid sidecars) on 2–3 non-critical namespaces.
2. Enable mTLS PERMISSIVE → STRICT after telemetry shows 100% mTLS.
3. Move retries/timeouts from libraries to the mesh — remove duplicates.
4. Success metrics: time to diagnose incidents, % traffic mTLS, p99 overhead < 3 ms, zero app code changes.

If we only had 8 services in one language, I'd say no: a shared client library + OpenTelemetry + NetworkPolicies would do.`,
      followUps: [
        { q: 'Why Linkerd over Istio for the pilot?', a: 'Fewer knobs, mTLS on by default, lightweight Rust proxy, lower operational burden; move to Istio only if we need its richer traffic policy or ambient mode.' },
        { q: 'How would you measure the mesh latency overhead?', a: 'A/B the same service with and without injection under the same load; compare p50/p99 client-side, and look at proxy-reported vs app-reported latency.' },
        { q: 'Which library features would you delete after adoption?', a: 'Client-side retries and circuit breakers that duplicate the mesh, and custom mTLS code — keep app-level fallbacks and business metrics.' },
      ],
      pitfalls: [
        'Adopting a mesh because big companies do it',
        'Ignoring resource and latency overhead',
        'Keeping both library and mesh retries',
        'No owning team for the control plane',
      ],
    },
    {
      id: 'net-service-mesh-iq-02',
      difficulty: 'expert',
      question:
        'Walk me through exactly what happens, packet by packet, when the attendee pod calls http://sessions:8080/v1/sessions in an Istio sidecar mesh with STRICT mTLS.',
      whatInterviewerLooksFor: [
        'iptables redirection and outbound/inbound listeners',
        'Role of xDS (routes, clusters, endpoints) and where LB decisions happen',
        'mTLS handshake with SPIFFE identities and authorization on the server side',
        'Where timeouts/retries/metrics apply',
      ],
      modelAnswer: `### 1. Name resolution
The app resolves \`sessions\` via cluster DNS to the Service's ClusterIP and opens a TCP connection to ClusterIP:8080 — it has no idea a proxy exists.

### 2. Outbound interception
iptables rules (installed by istio-init or Istio CNI) in the pod's network namespace redirect the connection to Envoy's outbound listener (**15001**). Envoy recovers the original destination.

### 3. Routing decision (client-side Envoy)
- The listener/route config (from **LDS/RDS**, derived from the VirtualService) matches host \`sessions\` and path.
- It applies route **timeout, retries**, header matches, weights → chooses a **cluster/subset** (from DestinationRule, via **CDS**).
- It picks a concrete **pod IP** from **EDS** endpoints using the LB algorithm (e.g. LEAST_REQUEST). ClusterIP/kube-proxy is bypassed.
- Connection pool limits and outlier detection apply here.

### 4. mTLS
Envoy reuses or opens a connection to the chosen pod IP on 8080 and does a TLS handshake presenting attendee's cert (\`spiffe://cluster.local/ns/conf/sa/attendee\`), delivered via **SDS** from istiod's CA; it verifies the server's SPIFFE ID too. HTTP/2 is typically used between proxies.

### 5. Inbound (server-side Envoy)
iptables redirect inbound traffic to the inbound listener (**15006**). Envoy terminates mTLS, checks **PeerAuthentication** (STRICT rejects plaintext), evaluates **AuthorizationPolicy** against the peer principal/method/path, records metrics and spans, then forwards to the app over **localhost** plaintext.

### 6. Response
It flows back the same way; both proxies emit telemetry (source/destination workload labels, response code, latency). If the app forwards \`traceparent\`, spans join one trace.

### Failure points
Proxy not ready (startup race), AuthorizationPolicy denial (403 RBAC), no healthy endpoints (503 UH), overflowed pool (503 UO), cert issues (TLS handshake failures).`,
      followUps: [
        { q: 'Does kube-proxy load balancing still matter?', a: 'Not for meshed HTTP traffic — Envoy picks the pod IP directly from EDS; kube-proxy only matters for unmeshed traffic.' },
        { q: 'What do the 503 response flags UH and UO mean?', a: 'UH = no healthy upstream hosts (all ejected/none ready); UO = upstream overflow, the circuit breaker (connectionPool) rejected the request.' },
      ],
      pitfalls: [
        'Thinking the app does TLS itself',
        'Assuming the ClusterIP / kube-proxy chooses the pod',
        'Forgetting authorization happens on the server-side proxy',
      ],
    },
    {
      id: 'net-service-mesh-iq-03',
      difficulty: 'hard',
      question:
        'Security wants STRICT mTLS across 300 services in 40 namespaces by the end of the quarter, with zero customer impact. What is your rollout plan?',
      whatInterviewerLooksFor: [
        'PERMISSIVE-first migration with telemetry evidence',
        'Identifies non-mesh clients (jobs, VMs, monitoring, health checks)',
        'Namespace-by-namespace, reversible rollout',
        'CA/cert lifecycle and authorization policy next steps',
      ],
      modelAnswer: `### Phase 0 — Inventory
- Which workloads have sidecars? Which callers are outside the mesh: VMs, managed services (Lambda), CronJobs without injection, Prometheus scraping, kubelet probes (Istio rewrites probes), external load balancers hitting pods directly.
- Confirm CA setup (istiod CA or external via cert-manager/Vault), root expiry, rotation plan.

### Phase 1 — PERMISSIVE everywhere (weeks 1–3)
- Inject sidecars namespace by namespace (restart pods), PeerAuthentication PERMISSIVE mesh-wide.
- Use telemetry (\`connection_security_policy\` label in Istio metrics) to find remaining plaintext traffic per destination.

### Phase 2 — Fix stragglers (weeks 3–6)
- Inject or onboard VMs (Istio WorkloadEntry), move Prometheus to scrape via Istio's merged metrics or give it a sidecar, exempt specific ports with port-level PeerAuthentication where unavoidable.

### Phase 3 — STRICT per namespace (weeks 6–10)
- Start with low-risk namespaces; flip to STRICT; watch 503/connection-reset rates for 24–48 h; rollback = one YAML revert.
- Critical namespaces (payments, auth) last, in low-traffic windows.

### Phase 4 — Mesh-wide STRICT + authorization
- Mesh-wide STRICT in the root namespace.
- Then default-deny AuthorizationPolicy with explicit allows by service account — this is where the real zero-trust value is. Generate initial policies from observed traffic.

### Guardrails
Dashboards of plaintext vs mTLS traffic, alerts on handshake failures, cert-expiry monitoring, a documented break-glass (namespace back to PERMISSIVE).`,
      followUps: [
        { q: 'A legacy VM service can’t run a sidecar. Options?', a: 'Onboard it as a mesh workload (Istio VM support with WorkloadEntry), front it with an egress/ingress gateway that does mTLS on its behalf, or keep a port-level PERMISSIVE exception with NetworkPolicy restrictions.' },
        { q: 'How do you avoid breaking kubelet health checks?', a: 'Istio rewrites HTTP probes to go via the sidecar agent by default; verify that, or expose probes on a port excluded from mTLS.' },
      ],
      pitfalls: [
        'Flipping STRICT mesh-wide on day one',
        'Forgetting non-mesh callers like monitoring or CronJobs',
        'Stopping at encryption and never adding authorization',
      ],
    },
    {
      id: 'net-service-mesh-iq-04',
      difficulty: 'hard',
      question:
        'Design a safe canary release for a new version of the pricing service using the mesh. How do you decide to promote or roll back automatically?',
      whatInterviewerLooksFor: [
        'Weighted routing via subsets, header routing for internal users',
        'Metric-driven analysis with statistical awareness',
        'Handling of stateful/sticky users and downstream propagation',
        'Rollback speed and database compatibility',
      ],
      modelAnswer: `### Setup
- DestinationRule subsets \`v1\` and \`v2\` by \`version\` label; deploy v2 with 0% weight.
- Pre-stage: route \`x-canary: true\` (employees, synthetic tests) to v2; propagate the header downstream.
- Optional: **mirror** 10% of read-only quote traffic to v2 and diff responses offline.

### Progressive weights
1% → 5% → 25% → 50% → 100%, each step held until enough samples. At 2,000 RPS, 1% = 20 RPS → 72K requests/hour; enough to detect a 0.5% error-rate regression within ~10–15 minutes.

### Automated analysis (Flagger / Argo Rollouts)
Per step, compare **v2 vs v1** (not v2 vs an absolute threshold only):
- success rate ≥ 99.9% and not worse than v1 by > 0.1 pp,
- p99 latency ≤ 1.1× v1,
- business guardrail: quote-to-checkout conversion or price mismatch counter.
Fail any check twice → set v2 weight to 0 (seconds, no redeploy) and alert.

### Gotchas
- **Stickiness**: a user flipping between v1 and v2 prices is bad UX; use consistent-hash on user ID or a cookie-based match for the canary cohort instead of pure weights.
- **Schema compatibility**: v1 and v2 run simultaneously, so DB migrations must be expand/contract.
- **Mirroring writes** is forbidden unless v2 writes to a sandbox.
- **Downstream effects**: v2 might call a new dependency — ensure its AuthorizationPolicy exists before the canary.`,
      followUps: [
        { q: 'Why compare v2 against v1 rather than a fixed threshold?', a: 'Baseline noise (a downstream incident) affects both; relative comparison isolates the change and avoids false rollbacks.' },
        { q: 'The canary looks healthy but a slow memory leak appears after 6 hours at 100%. How do you catch it?', a: 'Longer bake at 50%, saturation metrics (RSS growth rate) in analysis, and keep v1 pods warm for fast rollback during the bake period.' },
      ],
      pitfalls: [
        'Promoting on a fixed timer with no metrics',
        'Ignoring small-sample statistical noise at 1%',
        'Mirroring non-idempotent write traffic',
      ],
    },
    {
      id: 'net-service-mesh-iq-05',
      difficulty: 'expert',
      question:
        'Since enabling sidecar injection: pods occasionally crash-loop on startup, deploys show 503 spikes, and nightly batch Jobs never finish. Diagnose and fix all three.',
      whatInterviewerLooksFor: [
        'Understands sidecar/app lifecycle ordering',
        'Knows holdApplicationUntilProxyStarts, drain settings, native sidecars',
        'Handles Jobs with sidecars',
        'Verifies fixes with evidence',
      ],
      modelAnswer: `### 1. Startup crash loop
**Cause:** the app container starts before Envoy is ready; its outbound calls (DB, config service) are redirected by iptables to a proxy that isn't listening yet → connection refused → app exits.
**Evidence:** app logs show failures in the first 1–2 s; Envoy logs show it became ready after.
**Fix:** \`holdApplicationUntilProxyStarts: true\` (mesh-wide or per pod), or migrate to **Kubernetes native sidecars** (sidecar as an init container with \`restartPolicy: Always\`, beta/default-on since 1.29) so the proxy is guaranteed up before app containers start. Also make the app retry its initial connections with backoff.

### 2. 503s during deploys
**Cause:** on pod termination both containers receive SIGTERM; Envoy stops accepting/proxying while the app is still finishing in-flight requests or while other pods' proxies still route to it (endpoint updates are eventually consistent, ~1–5 s).
**Fix:** preStop \`sleep 10\` on the app so endpoints are removed first; Istio \`terminationDrainDuration\` (e.g. 20 s) so Envoy drains; \`terminationGracePeriodSeconds\` > preStop + drain; native sidecars terminate *after* app containers. Callers: retry connect-failure/refused-stream once (idempotent).

### 3. Jobs never finish
**Cause:** the Job's main container exits, but the Envoy sidecar keeps running, so the Pod never completes.
**Fix:** native sidecars (the kubelet terminates them when main containers finish), or have the job call the proxy's quit endpoint (\`POST localhost:15020/quitquitquit\`) at the end, or exclude batch namespaces from injection if they don't need mesh features.

### Verify
Rolling restart under load test with 0 non-2xx; crash-loop count 0 over a week; Job completion metrics.`,
      followUps: [
        { q: 'Why doesn’t readiness probe alone fix the deploy 503s?', a: 'Readiness failing removes the pod from endpoints, but propagation to all callers’ proxies takes seconds; without a preStop delay the pod stops serving before callers stop sending.' },
        { q: 'Would ambient mode remove these problems?', a: 'Mostly — there is no per-pod proxy lifecycle. Graceful shutdown of the app itself and endpoint propagation delay still matter.' },
      ],
      pitfalls: [
        'Blaming the app code or increasing restart backoff',
        'Disabling the mesh for the whole namespace as the “fix”',
        'Not aligning grace period with drain durations',
      ],
    },
    {
      id: 'net-service-mesh-iq-06',
      difficulty: 'expert',
      question:
        'istiod was down for 40 minutes last night. Some things kept working and some broke. Explain exactly what, and how you’d make the control plane stop being a single point of failure.',
      whatInterviewerLooksFor: [
        'Understands data plane runs on last-known config',
        'Knows what depends on the control plane (new pods, endpoint updates, cert rotation)',
        'HA and upgrade strategy (revisions, canary)',
        'Monitoring of control-plane health and push latency',
      ],
      modelAnswer: `### What kept working
- **Existing pods and connections**: Envoys keep their last-known listeners, routes, clusters and endpoints and continue proxying with existing certs. Most steady-state traffic flowed.

### What broke or degraded
- **New pods** (scale-ups, restarts, deploys): the sidecar can't fetch config or a workload cert → pod not ready. With HPA scaling up during peak, capacity couldn't grow.
- **Endpoint changes** weren't pushed: pods that died stayed in other proxies' endpoint lists (outlier detection helps a bit); new pods weren't discovered → load concentrated on old pods.
- **Config changes** (VirtualService edits, rollbacks) had no effect.
- **Cert rotation**: certs are 24 h by default; a 40-minute outage is fine, but a multi-hour outage near expiry would start breaking mTLS handshakes.
- **Sidecar injection webhook** (if served by istiod) failing → pod creation errors or pods created without sidecars (depends on failurePolicy), which then fail STRICT mTLS.

### Making it resilient
- **HA**: ≥3 istiod replicas across zones, PDB, HPA on CPU/push load, adequate memory (istiod memory grows with mesh size).
- **Scope config** (Sidecar resources, discovery selectors) to reduce push size and time.
- **Upgrades via revisions** (canary istiod, move namespaces gradually with revision tags) instead of in-place upgrades — a common cause of outages.
- **Monitoring**: pilot push errors, xDS push latency p99, connected proxies, webhook errors, cert expiry.
- **Multi-cluster**: per-cluster control planes (primary-primary) so a control plane failure is limited to one cluster.
- **Runbooks**: freeze deploys/autoscaling behaviours during control-plane incidents; pre-scale critical services.`,
      followUps: [
        { q: 'Would you set the injection webhook failurePolicy to Ignore or Fail?', a: 'Fail for STRICT-mTLS namespaces (a pod without a sidecar would be broken anyway); an explicit error is better than silently unmeshed pods.' },
        { q: 'How big a risk is the root CA?', a: 'Very — an expired or compromised root breaks or endangers the entire mesh. Use an external CA with intermediate per cluster, monitor expiry, and rehearse rotation.' },
      ],
      pitfalls: [
        'Assuming all traffic stops when the control plane is down',
        'Ignoring new-pod and autoscaling impact',
        'In-place control plane upgrades with no canary',
      ],
    },
    {
      id: 'net-service-mesh-iq-07',
      difficulty: 'hard',
      question:
        'We run 2,500 pods and sidecars are eating 15% of cluster memory. Compare Istio ambient, Cilium, proxyless gRPC and simply tuning sidecars. What would you do?',
      whatInterviewerLooksFor: [
        'Quantifies sidecar cost and what drives it (config scope)',
        'Understands ambient ztunnel/waypoint split and eBPF model',
        'Knows proxyless gRPC constraints',
        'Pragmatic migration path',
      ],
      modelAnswer: `### Quantify first
2,500 sidecars × ~100–150 MB ≈ **250–375 GB** of RAM, plus CPU requests (often 100 m each → 250 vCPU *reserved*). Why so high? Usually because every proxy receives config for **every service** in the mesh.

### Option 1 — Tune sidecars (cheap, do first)
- \`Sidecar\` resources / discovery selectors so each proxy only knows its dependencies → memory commonly drops 3–10× (the book cites ~1 GB → 60–70 MB).
- Right-size requests from real usage; drop unused telemetry.
Maybe enough on its own.

### Option 2 — Istio ambient
- **ztunnel** per node (Rust) does L4, mTLS, identity, L4 authz; **waypoint** Envoy proxies per namespace/service only where L7 features (retries, header routing, L7 authz) are needed.
- Cost scales with nodes + waypoints, not pods; no sidecar injection, no pod restarts for mesh upgrades, no startup/Job lifecycle issues.
- Trade-offs: L7 hop via waypoint may add a network hop; newer (GA since 1.24); node-shared component widens blast radius per node.

### Option 3 — Cilium (eBPF)
- L3/L4 policy and some observability in-kernel with very low overhead; L7 via a per-node Envoy. Great if Cilium is already the CNI. Kernel version requirements; L7 features less rich than Istio.

### Option 4 — Proxyless gRPC
- gRPC libraries speak xDS directly — no proxy, lowest latency. Only works for gRPC services in supported languages; REST traffic still needs a proxy. Library upgrades become app redeploys.

### Recommendation
1. Scope sidecar config now (weeks, big win).
2. Pilot ambient on namespaces that only need mTLS + L4 policy (typically the majority), add waypoints only where L7 is required.
3. Consider proxyless for a few latency-critical gRPC paths.
Measure memory, p99 per hop and incident rate before/after.`,
      followUps: [
        { q: 'Is the node-level ztunnel a security regression?', a: 'It holds identities for all pods on the node, so a compromised ztunnel is worse than a compromised sidecar; mitigated by being minimal, Rust-based, and not running app code — but it is a real threat-model change.' },
        { q: 'How do you migrate without downtime?', a: 'Ambient and sidecar workloads interoperate; label one namespace for ambient, remove sidecar injection, rolling restart, verify mTLS and policies, repeat.' },
      ],
      pitfalls: [
        'Jumping to a new mesh model before scoping config',
        'Assuming proxyless covers REST traffic',
        'Ignoring the threat-model change of node-shared proxies',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'net-service-mesh-boe-1',
      question: 'Estimate the resource cost of sidecars for 1,200 pods, and compare with an ambient (per-node) model.',
      assumptions: [
        '1,200 pods on 100 nodes (12 pods/node)',
        'Sidecar: 0.1 vCPU request, 80 MB memory after config scoping; ~0.35 vCPU per 1,000 RPS of proxied traffic',
        'Mesh traffic: 60K RPS total, each request crosses 2 proxies',
        'Ambient: ztunnel ~0.2 vCPU + 60 MB per node; 20 waypoint proxies of 0.5 vCPU + 200 MB for L7 namespaces',
      ],
      steps: [
        { label: 'Sidecar reserved CPU', calc: '1,200 × 0.1 vCPU = 120 vCPU reserved' },
        { label: 'Sidecar memory', calc: '1,200 × 80 MB = 96 GB' },
        { label: 'Sidecar CPU for traffic', calc: '60K RPS × 2 proxies = 120K proxy-RPS × 0.35/1,000 ≈ 42 vCPU actually used' },
        { label: 'Ambient ztunnel', calc: '100 nodes × 0.2 vCPU = 20 vCPU; 100 × 60 MB = 6 GB' },
        { label: 'Ambient waypoints', calc: '20 × 0.5 = 10 vCPU; 20 × 200 MB = 4 GB' },
        { label: 'Total comparison', calc: 'sidecar ≈ 120 vCPU reserved / 96 GB vs ambient ≈ 30 vCPU / 10 GB (L7 CPU still spent in waypoints)' },
      ],
      answer: 'Sidecars ≈ 120 vCPU reserved and ~96 GB RAM; ambient ≈ 30 vCPU and ~10 GB — roughly 4× CPU and 10× memory savings, mostly from not paying per pod.',
      insight:
        'Sidecar cost is dominated by per-pod fixed overhead (requests + config memory), not by traffic. Scoping config and right-sizing requests is the first lever; per-node models win when pod density is high and most services need only L4 mTLS.',
      followUps: [
        {
          "q": "Pod density doubles to 2,400 pods on the same 100 nodes. How do the two totals move?",
          "a": "Sidecar cost scales with pods: 2,400 × 0.1 vCPU = 240 vCPU reserved and 2,400 × 80 MB = 192 GB. Ambient's fixed cost scales with nodes and waypoints, which didn't change: still about 20 + 10 = 30 vCPU and 6 + 4 = 10 GB. Traffic-driven proxy CPU only grows if RPS grows. The gap widens from roughly 4× to 8× on CPU and from about 10× to about 19× on memory. That is the general rule: high pod density (many small pods per node) is where per-node data planes win most."
        },
        {
          "q": "Ambient isn't approved yet. Finance wants sidecar overhead halved. Which assumptions do you attack?",
          "a": "The reserved CPU is the padding: 42 vCPU of real use spread across 1,200 sidecars is about 0.035 vCPU each, against a 0.1 request. Lower requests to 0.05 vCPU per pod (60 vCPU, half of 120), keeping limits or VPA recommendations for hot pods such as gateways. For memory, scope config further with Sidecar resources: going from 80 MB to 40 MB per proxy gives 48 GB instead of 96 GB. Finally, remove sidecars from workloads that need no mesh features (batch, internal crons). Every pod you drop saves 0.1 vCPU and 80 MB."
        }
      ],
    },
    {
      id: 'net-service-mesh-boe-2',
      question: 'A leaf service is in brownout. Estimate load amplification if the edge gateway, the BFF app code and the mesh each retry, and design a retry budget.',
      assumptions: [
        'Normal load on leaf: 5,000 RPS',
        'Gateway: 1 retry (2 attempts); BFF code: 3 attempts; mesh: Istio default 2 retries (3 attempts)',
        'In brownout, ~100% of attempts to the leaf time out or return 503',
        'Leaf capacity: 7,500 RPS',
      ],
      steps: [
        { label: 'Attempts per user request', calc: '2 × 3 × 3 = 18 attempts' },
        { label: 'Leaf load in brownout', calc: '5,000 × 18 = 90,000 RPS = 12× its capacity (7,500)' },
        { label: 'Single-layer retry (mesh, 2 attempts)', calc: '5,000 × 2 = 10,000 RPS — still over capacity during full outage' },
        { label: 'With 20% retry budget', calc: 'retries ≤ 0.2 × 5,000 = 1,000 → max 6,000 RPS < 7,500 capacity' },
        { label: 'Recovery', calc: 'with budget, leaf stays under capacity so it can recover instead of being held down' },
      ],
      answer: '18× amplification (90K RPS) with retries at 3 layers; with one layer plus a 20% retry budget the leaf peaks at ~6K RPS.',
      insight:
        'Retry policy must be designed system-wide: exactly one layer retries, retries are budgeted as a fraction of normal traffic (Linkerd retry budgets, or Envoy retry budget/circuit breakers), and timeouts shrink downstream. Otherwise the resilience feature is the outage.',
      followUps: [
        {
          "q": "During the brownout half the leaf's pods are slow, so effective capacity is only 4,000 RPS. Does the 20% budget still save it?",
          "a": "No. Even with zero retries the leaf receives 5,000 RPS, which is 125% of its 4,000 capacity, and with a full 20% budget it gets 6,000 (150%). Retry budgets prevent amplification; they don't create capacity. You also need load shedding: a circuit breaker or `http2MaxRequests` cap at the caller, sized around 4,000 in-flight-equivalent, so excess requests fail fast at the caller, plus leaf-side admission control (reject early with 503 when queue time exceeds a threshold). The product fallback, such as a cached result, absorbs the remaining 1,000 RPS."
        },
        {
          "q": "How would you detect, from metrics alone, that retry amplification is happening in production?",
          "a": "Compare request rates across hops: the leaf's inbound `istio_requests_total` against the edge's request rate for the same user action. Normally the ratio is near 1; anything above about 1.3 during an incident means retries are stacking. Envoy also exposes `envoy_cluster_upstream_rq_retry` and `upstream_rq_retry_overflow` (the budget is exhausted), and access logs carry the `URX` response flag when retries ran out. Put an alert on the ratio and a dashboard panel on retries/sec per layer; that tells you which layer to switch off first."
        }
      ],
    },
    {
      id: 'net-service-mesh-boe-3',
      question: 'A checkout request fans through a call graph 6 services deep. Estimate the latency the mesh adds, and when it matters.',
      assumptions: [
        'Each hop crosses 2 sidecar proxies',
        'Per-proxy overhead: 0.15 ms p50, 0.8 ms p99 (L7, mTLS on reused connections)',
        'Checkout SLO: p99 < 400 ms; current p99 without mesh 280 ms',
        'Tail overheads don’t add perfectly; approximate p99 sum with ~60% of naive sum',
      ],
      steps: [
        { label: 'Proxies on critical path', calc: '6 hops × 2 = 12 proxies' },
        { label: 'p50 overhead', calc: '12 × 0.15 ms ≈ 1.8 ms' },
        { label: 'Naive p99 overhead', calc: '12 × 0.8 ms ≈ 9.6 ms' },
        { label: 'Realistic p99 overhead', calc: '≈ 0.6 × 9.6 ≈ 6 ms → 280 + 6 ≈ 286 ms, well within 400 ms' },
        { label: 'When it matters', calc: 'if a hop is a 30-call fan-out of 1 ms cache reads: 30 × 2 × 0.15 ms ≈ 9 ms p50 added to a 30 ms operation (30%)' },
      ],
      answer: '≈ 2 ms p50 and ~6 ms p99 added across 6 hops — negligible for checkout; significant only for chatty, sub-ms internal calls.',
      insight:
        'Mesh overhead is per hop, so it matters for deep or chatty call graphs, not for typical request/response APIs. Fix chattiness (batching, DataLoader), or use proxyless gRPC for hot paths, instead of rejecting the mesh wholesale.',
      followUps: [
        {
          "q": "The 30 cache reads are now made in parallel instead of sequentially. What happens to the mesh overhead at p50 and p99?",
          "a": "At p50 parallel calls overlap, so the added latency is roughly one call's overhead, about 2 × 0.15 = 0.3 ms instead of 9 ms. Tail latency gets worse, though: the hop has to wait for the slowest of 30 calls. If each proxy pair has a 1% chance of hitting its p99, then 1 − 0.99^30 ≈ 26% of requests contain at least one tail-delayed call. So the per-proxy p99 becomes roughly your p75. Fan-out turns component tails into common latency. Mitigations: batch into one multi-get, or hedge requests."
        },
        {
          "q": "How would you measure the real proxy overhead in your cluster rather than trusting the 0.15 ms assumption?",
          "a": "Compare the two views Envoy already gives you. On the destination sidecar, `istio_request_duration_milliseconds` (reporter=destination) includes the app's time, and the app's own OTel server span is the same request without the proxy. The difference is inbound proxy overhead. Do the same on the source side: the client span minus the reporter=source duration. Validate with an A/B load test (fortio, same RPS) on two identical deployments, one with injection disabled. Measure at your real RPS and payload size, since overhead grows with mTLS handshakes and large headers."
        }
      ],
    },
  ],
  test: [
    {
      id: 'net-service-mesh-mcq-01',
      difficulty: 'hard',
      question:
        'istiod (the Istio control plane) crashes and stays down for 20 minutes. Which statement best describes the impact?',
      options: [
        'Existing traffic flows on cached config; new pods and endpoint changes are stuck',
        'All meshed traffic stops immediately because proxies need istiod on every request',
        'Traffic continues but mTLS is disabled until istiod returns, falling back to plaintext',
        'Only metrics collection stops; routing and discovery continue fully unaffected',
      ],
      correct: [0],
      explanation:
        'Envoy proxies cache their xDS config and certificates, so steady-state traffic keeps flowing without the control plane. Anything that needs new config breaks: new pods can’t get config or certs, and endpoint and routing changes stop propagating. Proxies never call istiod per request, they never silently fall back to plaintext, and discovery updates stop along with the rest.',
      followUps: [
        {
          "q": "During those 20 minutes the HPA scales checkout from 10 to 25 pods. What do the 15 new pods experience, and how would you have caught it in monitoring?",
          "a": "The new pods get injected sidecars, but the proxy cannot fetch its bootstrap xDS config or a workload certificate from istiod, so it never becomes ready. Readiness fails, the pods never join the Service endpoints, and the scale-up silently delivers zero extra capacity while the existing 10 pods saturate. Worse, other proxies also never learn about them. Alert on `pilot_xds_pushes` dropping to zero, istiod pod availability, and sidecar readiness failures (`istio-proxy` not ready) rather than waiting for request errors, which only show up once the old pods overload."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-02',
      difficulty: 'expert',
      question: 'The app retries this call 3 times in code. What is the maximum number of attempts that reach inventory for one user action?',
      code: {
        language: 'yaml',
        code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata: { name: inventory }
spec:
  hosts: [inventory]
  http:
    - route:
        - destination: { host: inventory }
      retries:
        attempts: 3
        perTryTimeout: 200ms`,
      },
      options: ['3', '6', '9', '12'],
      correct: [3],
      explanation:
        'In Istio, attempts is the number of retries, so each app call becomes up to 4 attempts (1 original + 3 retries). Three app-level tries × 4 = 12. Answering 9 treats attempts as the total number of tries, and 3 or 6 ignore how retries multiply across layers.',
      followUps: [
        {
          "q": "You can't change the app code this sprint. How do you cap the attempts at inventory using only mesh config, and what number do you reach?",
          "a": "Set the inventory route to `retries.attempts: 0` (or remove the retry block) so each app call is exactly one mesh attempt; the app's 3 tries then bound load at 3 attempts per user action, down from 12. If you must keep a mesh retry for connection failures, use `attempts: 1` with `retryOn: connect-failure,refused-stream` only, giving at most 3 × 2 = 6, and add a `perTryTimeout` so slow attempts don't stack. Then file the app change: retry in one layer only, ideally the mesh, since it is configurable without deploys."
        },
        {
          "q": "Inventory is called through a second service, reservations, which also has a mesh retry of 2 attempts on its outbound hop. What is the worst case now?",
          "a": "Retries multiply per layer along the path. App 3 tries × checkout-sidecar 4 attempts = 12 requests reaching reservations; each of those triggers reservations' own outbound policy of 3 attempts (1 + 2 retries) toward inventory, so inventory can see 12 × 3 = 36 attempts for one user click. Deep call graphs make this exponential, which is why the convention is: retry only at the edge-most mesh hop (or only the hop adjacent to the failing service) and set `attempts: 0` on intermediate hops, combined with a retry budget."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-03',
      difficulty: 'hard',
      question:
        'After enabling Istio, the mesh dashboards show only TCP byte counts (no HTTP status or latency) for calls from checkout to pricing. What is the most likely cause?',
      options: [
        'Pricing has no DestinationRule, so Istio can’t decode the HTTP layer',
        'Prometheus is scraping too slowly to capture HTTP-level metrics in time',
        'Pricing’s AuthorizationPolicy blocks the L7 telemetry on that connection',
        'Checkout speaks HTTPS itself, so the sidecar sees only an opaque TLS stream',
      ],
      correct: [3],
      explanation:
        'When the application itself originates TLS, the client sidecar can’t read HTTP, so it treats the connection as TCP and emits only L4 metrics. The fix is plain HTTP from the app and mTLS originated by the proxy. A missing DestinationRule doesn’t stop HTTP parsing, scrape interval doesn’t change which metric types exist, and authorization doesn’t remove telemetry. A misnamed port or missing appProtocol can cause similar symptoms and is also worth checking.',
      followUps: [
        {
          "q": "Checkout must call pricing over HTTPS because a compliance team insists on 'app-level encryption'. How do you still get L7 metrics and routing?",
          "a": "Show that mesh mTLS already encrypts the hop between pods with workload identity, so app TLS only adds a second layer. If the auditors still insist, let the sidecar do TLS origination: the app calls `http://pricing`, and a DestinationRule with `tls.mode: ISTIO_MUTUAL` (or `SIMPLE` toward a non-mesh endpoint) encrypts the traffic on the wire. The proxy sees plaintext HTTP inside the pod, so it can emit status codes and latency. Where encryption inside the pod network namespace really is required, you have to accept TCP-only telemetry and put OpenTelemetry HTTP metrics in the app."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-04',
      difficulty: 'medium',
      question:
        'You flip PeerAuthentication to STRICT in the payments namespace and immediately see failures. Which callers are most likely broken? Select ALL that apply.',
      options: [
        'A nightly CronJob in a namespace without sidecar injection',
        'A legacy VM service outside the mesh calling payments directly',
        'Meshed checkout pods with sidecars calling payments',
        'Prometheus scraping payments pods on the app port without a sidecar',
      ],
      correct: [0, 1, 3],
      explanation:
        'STRICT mode only accepts mTLS, so any caller without a mesh identity that sends plaintext is rejected: unmeshed jobs, VMs outside the mesh, and a monitoring scraper without a sidecar. Meshed checkout pods already use mTLS through their sidecars and keep working.',
      followUps: [
        {
          "q": "How do you switch payments to STRICT without breaking Prometheus scraping, which must keep working?",
          "a": "Istio's default sidecar injection rewrites scrape annotations so Prometheus hits the proxy's merged metrics port (15020), which is exempt from mTLS. If scraping goes straight to the app port, either enable that metrics merging, or set a port-level exception in PeerAuthentication (`portLevelMtls: { 9090: { mode: PERMISSIVE } }`) for the metrics port only. The cleaner option is to give Prometheus a sidecar with certificates. Before flipping, check `istio_requests_total` grouped by `connection_security_policy=\"none\"` to list every remaining plaintext caller."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-05',
      difficulty: 'expert',
      question:
        'With this DestinationRule, a 2-second network blip makes every inventory pod return a few 503s. What happens next?',
      code: {
        language: 'yaml',
        code: `trafficPolicy:
  outlierDetection:
    consecutive5xxErrors: 1
    interval: 1s
    baseEjectionTime: 3m
    maxEjectionPercent: 100`,
      },
      options: [
        'Nothing notable; outlier detection only applies to latency, not errors',
        'Potentially all pods are ejected for ~3 minutes: an outage outlasting the blip',
        'Pods are ejected for 1 s each, then immediately re-added',
        'Callers route to the ingress gateway as a fallback while pods are ejected',
      ],
      correct: [1],
      explanation:
        'Ejecting after a single 5xx with maxEjectionPercent 100 lets the whole pool be ejected, and each host stays out for at least baseEjectionTime, which also grows with repeated ejections. A short blip becomes a multi-minute outage. Outlier detection acts on errors, not only latency. interval is how often hosts are analysed, not how long they stay ejected. There is no automatic gateway fallback.',
      followUps: [
        {
          "q": "Inventory has only 3 pods. What maxEjectionPercent and minHealthPercent would you choose, and why do small pools need special care?",
          "a": "With 3 pods, ejection works in whole hosts: 34% rounds to ejecting at least one pod, and 50% still allows only one, so each ejection removes a third of capacity and pushes the remaining two toward overload. Use `maxEjectionPercent: 34` (at most one host), `consecutive5xxErrors: 5`, and `minHealthPercent: 50` so outlier detection switches off entirely if fewer than half look healthy, which usually means the fault is shared rather than in one bad host. Better still, run more replicas: outlier detection is a statistical tool and works poorly at N=3."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-06',
      difficulty: 'hard',
      question:
        'After sidecar injection, Kubernetes Jobs run their work but the Pods never reach Completed. Best long-term fix?',
      options: [
        'Increase activeDeadlineSeconds so the Job controller kills them eventually',
        'Set restartPolicy: Never on the Job’s main container spec',
        'Run the proxy as a native sidecar so it stops when the main container exits',
        'Disable mTLS for the Job’s namespace so the proxy exits cleanly',
      ],
      correct: [2],
      explanation:
        'The Pod stays Running because the sidecar container never exits after the main container finishes. Native sidecars, which are init containers with restartPolicy Always, are terminated by the kubelet once the main containers complete. A deadline marks the Job as failed instead of completed. restartPolicy Never is already standard for Jobs and doesn’t stop the sidecar, and mTLS settings have nothing to do with the proxy’s lifecycle.',
      followUps: [
        {
          "q": "Your cluster is on Kubernetes 1.26 without native sidecars. How do you make the Jobs complete today?",
          "a": "Have the job's entrypoint shut the proxy down when the work finishes: a wrapper runs the main command, then calls `curl -sf -XPOST http://localhost:15020/quitquitquit` and exits with the original status code. Combine it with `holdApplicationUntilProxyStarts` so the job doesn't start before Envoy is ready. Alternatives: if the job doesn't need mesh features, opt it out with `sidecar.istio.io/inject: \"false\"` and use a PERMISSIVE exception, or move batch work to ambient mode, where there is no per-pod proxy. Track upgrading to 1.29+ native sidecars as the real fix."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-07',
      difficulty: 'expert',
      question: 'Where should each concern live in a mesh-based architecture? Select ALL correct pairings.',
      options: [
        'Encrypting service-to-service traffic → mesh (mTLS)',
        'Falling back to a generic schedule when sessions is unavailable → application code',
        'Checking that the caller is the attendee service account → mesh AuthorizationPolicy',
        'Mapping partner payload formats between services → a mesh Wasm filter',
        'Checking that user 7 owns booking 42 → mesh AuthorizationPolicy',
      ],
      correct: [0, 1, 2],
      explanation:
        'Transport encryption and service-identity authorization are exactly the cross-cutting concerns a mesh handles well. A fallback is a product decision that belongs in the app, since the mesh can only fail fast. Payload transformation in Wasm filters is the mesh-as-ESB anti-pattern, and checking record ownership needs domain data that only the service has.',
      followUps: [
        {
          "q": "Product now wants 'only premium users can call the recommendations v2 endpoint'. Mesh or app, and what would you push back on?",
          "a": "If premium tier is a signed JWT claim (`tier: premium`), the mesh can enforce it: RequestAuthentication validates the token, and an AuthorizationPolicy matches `request.auth.claims[tier]`. That is cheap and uniform. If 'premium' depends on live data (a subscription that lapsed an hour ago, a trial), it belongs in the app or an entitlement service, because the mesh can't look up state. Push back on putting entitlement logic in mesh YAML owned by the platform team: product rules then change through infra PRs, and the 403 path can't give users a useful upgrade message."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-08',
      difficulty: 'hard',
      question:
        'Traces in Jaeger show each service as a separate one-span trace, even though every pod has an Istio sidecar. Why?',
      code: {
        language: 'typescript',
        code: `@Get('home')
async home(@Headers('x-user-id') uid: string) {
  const recs = await fetch('http://recs:8080/v1/for/' + uid);
  const cart = await fetch('http://cart:8080/v1/' + uid);
  return { recs: await recs.json(), cart: await cart.json() };
}`,
      },
      options: [
        'The handler never copies traceparent/b3 headers onto its outbound calls',
        'The sidecars need tracing explicitly enabled on every VirtualService',
        'fetch bypasses the sidecar because it uses HTTP/1.1 instead of HTTP/2',
        'Jaeger cannot join spans that cross Kubernetes namespace boundaries',
      ],
      correct: [0],
      explanation:
        'A proxy can’t tell which outbound call belongs to which inbound request inside the app process. The app has to copy the trace headers across, either by hand or through OpenTelemetry instrumentation. Tracing is configured mesh-wide, not per VirtualService. iptables redirects fetch traffic regardless of HTTP version, and Jaeger does join spans across namespaces when the trace context is propagated.',
      followUps: [
        {
          "q": "Fixing propagation by hand in 40 services is too slow. What is the lowest-effort way, and how do you verify it actually works?",
          "a": "Add OpenTelemetry auto-instrumentation: the Node SDK patches `http`, `fetch`/undici and gRPC so context propagates through AsyncLocalStorage, configured once in a shared bootstrap package (or injected by the OTel Operator through an annotation). Use the W3C `traceparent` propagator, plus B3 if older Envoy configs still use it. Verify with a synthetic request carrying a known trace ID through checkout, then assert in Jaeger that the trace has the expected span count and depth. Track 'traces with one service' as a percentage metric, which should fall toward zero."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-09',
      difficulty: 'medium',
      question:
        'A 9-service, TypeScript-only startup with no platform team asks whether to adopt Istio now for “future-proofing”. Best advice?',
      options: [
        'Yes — adopting a mesh early is far cheaper than retrofitting it later',
        'Yes, but adopt only Istio’s ingress gateway and leave the mesh disabled',
        'Not yet — a shared client library, OpenTelemetry and NetworkPolicies suffice',
        'Build a lightweight in-house sidecar in Node that fits their stack exactly',
      ],
      correct: [2],
      explanation:
        'With few services, one language and nobody to own it, a mesh costs more to run than it gives back. A shared library in a single language avoids the “price of polyglot”. Using only the mesh gateway is the mesh-as-gateway anti-pattern, and building a custom sidecar ignores TCO and opportunity cost.',
      followUps: [
        {
          "q": "Eighteen months later they have 60 services, a Go team and a SOC 2 audit requiring encryption in transit. Has the answer changed?",
          "a": "Probably yes. The triggers are now present: more than one language, so the shared library has to be maintained twice; an audit requirement that mTLS with automatic rotation meets uniformly; and enough services that per-team TLS setup drifts. Re-evaluate with a lightweight option first, such as Linkerd or Istio ambient (L4 mTLS through ztunnel, no sidecars), and adopt in stages: mTLS PERMISSIVE then STRICT, then L7 features only where needed. Also staff it: 0.5–1 engineer owning upgrades. Without an owner, even a light mesh becomes an outage risk."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-10',
      difficulty: 'expert',
      question:
        'In Istio ambient mode, which statements are true? Select ALL that apply.',
      options: [
        'ztunnel runs per node and provides L4 features like mTLS and L4 authorization',
        'Waypoint proxies are deployed only where L7 features (HTTP routing, retries, L7 authz) are needed',
        'Every pod still gets an Envoy sidecar, but with a smaller memory footprint',
        'Upgrading the data plane no longer requires restarting application pods to update sidecars',
      ],
      correct: [0, 1, 3],
      explanation:
        'Ambient splits the data plane into a per-node L4 ztunnel and optional per-namespace or per-service waypoint Envoys for L7, so there are no sidecars. Because of that, data-plane upgrades don’t require rolling application pods. The option saying every pod still gets a sidecar describes the classic model, not ambient.',
      followUps: [
        {
          "q": "You move a namespace to ambient and add a waypoint. A team's HTTP retry policy that worked under sidecars silently stops applying. Why?",
          "a": "In ambient mode, L7 policy runs in the waypoint, and the waypoint is attached to the destination (service or namespace), not to the caller. Client-side settings that sidecars applied on the caller's outbound path, like a VirtualService scoped to the caller or retries meant for a destination that has no waypoint, have nowhere to run: ztunnel only does L4. Check that the destination service is enrolled with `istio.io/use-waypoint`, and that the policy targets the waypoint (in newer APIs, `targetRefs` to the Service). Test migrations with `istioctl x describe`/proxy-config per service."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-11',
      difficulty: 'hard',
      question:
        'You ship this canary route, and support reports users seeing prices flip between refreshes. What is the best fix?',
      code: {
        language: 'yaml',
        code: `http:
  - route:
      - destination: { host: pricing, subset: v1 }
        weight: 95
      - destination: { host: pricing, subset: v2 }
        weight: 5`,
      },
      options: [
        'Pick a stable cohort by user header/cookie or consistent hash on user ID',
        'Lower the weight to 1% so fewer users notice the flipping',
        'Enable mirroring so v2 only receives shadow traffic from now on',
        'Add outlier detection so v2 pods are ejected whenever prices differ',
      ],
      correct: [0],
      explanation:
        'Weighted splitting is decided per request, so the same user bounces between v1 and v2. Assigning a stable cohort by header, cookie or a consistent hash on user ID gives each user a single version. A lower weight only makes the problem rarer. Mirroring stops the real canary release altogether, and outlier detection reacts to errors, not to business differences between versions.',
      followUps: [
        {
          "q": "Most users are anonymous, with no login cookie. How do you keep stickiness, and what happens when you later move the canary from 10% to 50%?",
          "a": "Issue a random cohort cookie at the edge (`cohort=0..99`) on first visit and route `cohort < 10` to v2 with a header or cookie match. With consistent hashing (`consistentHash.httpCookie`), the ring changes as v2 gains endpoints, so some users move. Explicit cohort buckets are more predictable: widening to `cohort < 50` keeps the original 10% on v2 and only adds users, so nobody flips back from v2 to v1. Users without cookies, such as API clients, are pinned by API key or client ID instead."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-12',
      difficulty: 'expert',
      question:
        'Pods crash on startup with “ECONNREFUSED 10.0.3.7:5432” only after sidecar injection, and succeed on restart. What is happening and what fixes it? Select ALL that apply.',
      options: [
        'The app starts before Envoy is ready while iptables already redirects its outbound traffic',
        'Set holdApplicationUntilProxyStarts or use native sidecars so the proxy starts first',
        'Postgres rejects mTLS from sidecars and must be excluded from the mesh',
        'Add connection retry with backoff at app startup as defence in depth',
        'Increase the Postgres max_connections setting to accommodate the sidecars',
      ],
      correct: [0, 1, 3],
      explanation:
        'This is the classic startup race: iptables sends outbound traffic to a proxy that isn’t listening yet. Starting the proxy first fixes it, and retrying connections at app startup adds resilience. The fact that a restart succeeds rules out Postgres rejecting mTLS, which would fail every time, and max_connections has nothing to do with a refused connection at startup.',
      followUps: [
        {
          "q": "The same race shows up at shutdown: during deploys, in-flight DB writes fail with connection resets. What is happening and how do you fix it?",
          "a": "On SIGTERM both containers get the signal at once. Envoy begins draining and exits after its drain period, while the app may still be finishing requests or flushing writes, so outbound connections break mid-transaction. Fixes: native sidecars (the kubelet stops the sidecar only after the main container has exited); or set `EXIT_ON_ZERO_ACTIVE_CONNECTIONS` with a `terminationDrainDuration` longer than the app's shutdown time; and have the app handle SIGTERM itself by stopping new work and finishing transactions within `terminationGracePeriodSeconds`. Test it by running a load test while rolling the deployment and asserting zero 5xx."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-13',
      difficulty: 'hard',
      question:
        'After the mesh grew from 80 to 900 services, sidecar memory tripled and istiod pushes take 30 s. What is the most effective first step?',
      options: [
        'Give every sidecar a higher memory limit and double the istiod replicas',
        'Switch the load balancer from ROUND_ROBIN to LEAST_REQUEST mesh-wide',
        'Scope each proxy’s config (Sidecar resource) to the hosts it really calls',
        'Disable mTLS to shrink the certificate payload in each config push',
      ],
      correct: [2],
      explanation:
        'By default every proxy receives config for every service, so memory and push size grow with the size of the mesh. Scoping each proxy to its real dependencies cuts both sharply. Raising limits and adding replicas treats the symptom, the LB algorithm doesn’t affect config size, and certificates are a tiny part of the push.',
      followUps: [
        {
          "q": "Writing Sidecar resources for 900 services by hand isn't realistic. How do you generate and keep them correct?",
          "a": "Start with a namespace-wide default `Sidecar` with egress `./*` plus `istio-system/*`, which already cuts config sharply when namespaces map to teams. Then generate per-workload egress lists from observed traffic: query `istio_requests_total` grouped by source and destination over 30 days and emit the YAML in CI. Keep it safe with a canary: a missing host fails with 502 NR (no route), so alert on response flag `NR` after each change. Also set `PILOT_FILTER_GATEWAY_CLUSTER_CONFIG` and use discovery selectors so istiod ignores namespaces outside the mesh."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-14',
      difficulty: 'medium',
      question:
        'A team wants to mirror 100% of POST /orders traffic to the v2 orders service, which writes to the production database and calls the payment provider. What is the problem?',
      options: [
        'Mirroring is only supported for gRPC traffic, not for HTTP requests',
        'Mirrored responses would be returned to users twice in the same session',
        'Mirroring doubles latency because the proxy waits for both versions to respond',
        'v2 would execute real side effects: duplicate orders and duplicate charges',
      ],
      correct: [3],
      explanation:
        'Envoy discards the mirrored responses, but v2 still does the work, so real orders and real charges happen twice. Only mirror idempotent reads, or point v2 at sandboxed dependencies. Mirroring works for HTTP, the shadow request is fire-and-forget so the user’s latency isn’t affected, and users never see mirrored responses.',
      followUps: [
        {
          "q": "The team still wants to validate v2 against real write traffic before the cutover. How can they do it safely?",
          "a": "Mirror to a v2 deployment wired to sandboxed side effects: a shadow database (snapshot or separate schema), and the payment provider's test mode or a stub that records calls. Tag mirrored requests (Envoy appends `-shadow` to the Host header) so v2 can recognise shadow traffic and refuse external calls as a second safeguard. Compare outputs offline: log v1 and v2 responses by request ID and diff them (Diffy-style), ignoring known-noisy fields like timestamps. Mirror a percentage (`mirrorPercentage: 10`) so the sandbox isn't overwhelmed."
        }
      ],
    },
    {
      id: 'net-service-mesh-mcq-15',
      difficulty: 'expert',
      question:
        'Your gRPC clients (long-lived HTTP/2 connections) overload 2 of 10 server pods after a scale-up, even though kube-proxy is in place. How does adding a mesh change this?',
      options: [
        'It doesn’t; gRPC balancing across pods always requires client-side libraries',
        'kube-proxy already balances each gRPC request, so the servers are at fault',
        'The proxy balances each request (L7), so new pods get traffic without reconnects',
        'The mesh terminates HTTP/2 and downgrades it to HTTP/1.1, which forces new connections',
      ],
      correct: [2],
      explanation:
        'kube-proxy balances at the connection level (L4), so each long-lived HTTP/2 connection stays pinned to the pod it first reached. Pods added by a scale-up get nothing until clients reconnect. Envoy understands HTTP/2 streams and spreads requests across current endpoints. Client-side gRPC balancing is an alternative but not the only option, kube-proxy does not balance per request, and the mesh does not downgrade HTTP/2.',
      followUps: [
        {
          "q": "Now 2,000 client pods each hold connections to 10 servers through sidecars. Is anything still unbalanced, and what new cost appears?",
          "a": "Per-request balancing is fine, but the connection count grows: each client sidecar keeps HTTP/2 connections to each server endpoint, about 2,000 × 10 = 20,000 connections, plus mTLS handshakes during churn. LEAST_REQUEST also only sees its own in-flight counts, so 2,000 independent balancers can still herd onto a pod that just looked idle. Envoy's power-of-two-choices helps. Set `maxRequestsPerConnection` or connection age limits so connections rotate during scale events, and watch per-pod RPS skew (max/mean) as a dashboard signal."
        }
      ],
    },
  ],
};

export default topic;
