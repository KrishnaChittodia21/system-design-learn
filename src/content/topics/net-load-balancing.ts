import type { Topic } from '../../types';

const topic: Topic = {
  id: 'net-load-balancing',
  phase: 'networking',
  order: 5,
  title: 'Load Balancing: L4/L7, Algorithms, Consistent Hashing',
  subtitle:
    'How traffic is spread, why algorithms fail in surprising ways, consistent hashing with virtual nodes, health checks, LB tiers, long-lived connections and draining.',
  estimatedMinutes: 80,
  sources: [
    'Mastering API Architecture — Ch 3 (load balancers in the edge stack, failover pitfalls)',
    'Google Maglev paper (NSDI 2016); Mitzenmacher — The Power of Two Choices',
  ],
  tags: ['load-balancing', 'l4', 'l7', 'consistent-hashing', 'health-checks', 'sticky-sessions', 'anycast', 'grpc', 'draining'],
  cheatSheet: [
    'L4 = per-connection decisions on IP:port (cheap, millions of conns, TLS passthrough); L7 = per-request decisions on HTTP (path/header routing, retries, HTTP/2 stream balancing).',
    'Round robin assumes equal servers and equal requests; least-connections adapts to slow requests; P2C (pick 2 random, choose less loaded) gets near-optimal balance without global state or herding.',
    'Consistent hashing: adding/removing 1 of N nodes moves ~1/N of keys (vs ~all with hash mod N). Use 100–200 virtual nodes per server → load std-dev ~10%→5%.',
    'Sticky sessions trade balance and failover for convenience: sessions die with the node, NAT/IP-hash skews load. Prefer stateless servers + external session store.',
    'Health checks: active (probe) + passive (outlier on real traffic). Readiness ≠ liveness. Shallow checks for liveness; never let a shared dependency blip fail every node at once.',
    'Slow start / warm-up: ramp new instances’ weight over 30–120 s (JIT, caches, pools) or least-conn floods them.',
    'LB tiers: DNS/GSLB → anycast + ECMP → L4 (Maglev/NLB, consistent hashing for conn stickiness) → L7 (Envoy/ALB). No single LB box.',
    'Long-lived conns (gRPC/HTTP2/WebSocket) pin to one backend: use L7 per-request balancing, client-side LB, MAX_CONNECTION_AGE, and jittered reconnects.',
    'Connection draining: fail readiness → wait for deregistration (10–30 s) → finish in-flight → close. Deregistration delay must exceed longest normal request.',
    'Watch hidden limits: conntrack table size, SNAT/ephemeral ports (~28K per dest IP:port in default Linux range), LB pre-warming for sudden 10× spikes.',
  ],
  sections: [
    {
      heading: 'What a load balancer does: L4 vs L7',
      body: `**Intuition:** a load balancer is the host at a busy restaurant seating guests so no waiter is overwhelmed. An L4 host seats *parties* (connections) without knowing what they'll order; an L7 host reads each *order* (request) and can send desserts to the pastry chef.

**Jobs:** spread load, hide failures (health checks), enable horizontal scaling and zero-downtime deploys, and give one stable address for many servers.

| | L4 (transport) | L7 (application) |
|---|---|---|
| Sees | IP, port, TCP/UDP | HTTP method, path, headers, cookies, gRPC method |
| Decision granularity | Per connection (or flow) | Per request / per HTTP2 stream |
| TLS | Passthrough or terminate | Terminates (needs certs) |
| Features | Very fast, huge conn counts, preserves client IP, UDP | Path/host routing, retries, header rewrite, auth, compression, canary |
| Cost | Cheap per packet; can do DSR | More CPU and memory per request |
| Examples | AWS NLB, Google Maglev, IPVS, HAProxy (mode tcp) | AWS ALB, Envoy, nginx, HAProxy (mode http) |

**Proxying modes at L4:** *full proxy/NAT* (LB terminates TCP, opens a new conn — sees both sides), *DNAT* (rewrites destination; return traffic must come back through LB), *DSR — direct server return* (LB only handles inbound; servers reply directly to clients; great for download-heavy traffic because responses are much larger than requests).

**Why L7 matters for modern protocols:** with HTTP/2 and gRPC, a client multiplexes thousands of requests over **one** long-lived connection. An L4 LB balances that connection once — every request lands on the same backend. An L7 LB balances each stream.

**In interviews say:** "L4 at the front for raw scale and DDoS absorption, L7 behind it for request-aware routing. For gRPC internally, L7 (mesh/Envoy) or client-side balancing, because L4 pins HTTP/2 connections."`,
      keyPoints: [
        'L4 balances connections; L7 balances requests/streams.',
        'HTTP/2 and gRPC need L7 or client-side balancing to spread requests.',
        'DSR offloads response bandwidth from the LB.',
      ],
    },
    {
      heading: 'Balancing algorithms and where each breaks',
      body: `**Intuition:** choosing a checkout lane. Round robin = go to the next lane in order; least connections = pick the shortest queue; power of two choices = glance at two random lanes and take the shorter — surprisingly almost as good as checking every lane.

| Algorithm | How | Great when | Breaks when |
|---|---|---|---|
| **Round robin** | Next server in order | Homogeneous servers, uniform request cost | Heterogeneous hardware; mixed cheap/expensive requests |
| **Weighted RR** | Proportional to weight (smooth WRR interleaves) | Mixed instance sizes, canaries | Weights are static — don't react to slowness |
| **Least connections** | Fewest active connections/requests | Variable request duration, long requests | New/slow-start nodes get flooded; many LBs with stale views herd onto the same node |
| **Least response time / EWMA** | Lowest latency × load (e.g. Linkerd/Finagle peak-EWMA) | Latency-sensitive; slow nodes avoided quickly | Fast-failing node looks "fast" and attracts traffic (black hole) unless errors are penalised |
| **Random** | Uniform random | Many LBs, stateless | Variance with small numbers of requests |
| **Power of two choices (P2C)** | Pick 2 at random, choose less loaded | Many independent LBs, large fleets | Needs a load signal (in-flight requests) |
| **IP hash / header hash** | hash(client IP or key) → server | Affinity without cookies | NAT/proxies group users; resizes remap everyone (unless consistent) |
| **Consistent hash / Maglev / ring hash** | Hash key onto ring/table | Cache affinity, sharded state, L4 conn stickiness across LB fleet | Hot keys; needs bounded-load variant for skew |

**Why P2C matters.** With *N* independent LBs each doing "least connections" on slightly stale data, they all pick the *same* least-loaded server at once → it spikes → they all move away (herding / thundering herd). Randomly sampling two breaks the synchrony. Theory: the max load drops from ~log n / log log n (random) to ~log log n (two choices) — an exponential improvement. Envoy's \`LEAST_REQUEST\` uses P2C by default.

**Fast-failure black holes.** A server returning instant 500s has zero in-flight requests and the lowest latency — least-conn and latency-based balancers send it *more* traffic. Pair them with outlier detection/error-aware scoring.`,
      code: [
        {
          language: 'typescript',
          title: 'Power of two choices + smooth weighted round robin (nginx algorithm)',
          code: `interface Backend { id: string; inFlight: number; weight: number; current: number; healthy: boolean }

// P2C: sample two distinct healthy backends, pick the one with fewer in-flight requests
export function pickP2C(backends: Backend[]): Backend {
  const pool = backends.filter((b) => b.healthy);
  if (pool.length === 0) throw new Error('no healthy backends');
  if (pool.length === 1) return pool[0];
  const i = Math.floor(Math.random() * pool.length);
  let j = Math.floor(Math.random() * (pool.length - 1));
  if (j >= i) j++;                                   // ensure distinct
  return pool[i].inFlight <= pool[j].inFlight ? pool[i] : pool[j];
}

// Smooth WRR: weights 5,1,1 -> a a b a c a a (interleaved, not aaaaabc)
export function pickSmoothWRR(backends: Backend[]): Backend {
  const pool = backends.filter((b) => b.healthy);
  let total = 0;
  let best: Backend | undefined;
  for (const b of pool) {
    b.current += b.weight;                             // everyone earns credit
    total += b.weight;
    if (!best || b.current > best.current) best = b;
  }
  if (!best) throw new Error('no healthy backends');
  best.current -= total;                               // winner pays total
  return best;
}

// Usage: wrap each request so inFlight reflects real concurrency
export async function withBackend<T>(b: Backend, fn: () => Promise<T>): Promise<T> {
  b.inFlight++;
  try { return await fn(); } finally { b.inFlight--; }
}`,
        },
      ],
      keyPoints: [
        'Round robin is only fair when both servers and requests are uniform.',
        'P2C avoids herding across many LBs and is Envoy’s LEAST_REQUEST default.',
        'Latency/least-conn balancers must penalise errors or they route into black holes.',
      ],
      source: 'Mitzenmacher — The Power of Two Choices in Randomized Load Balancing',
    },
    {
      heading: 'Consistent hashing with virtual nodes',
      body: `**Intuition:** picture servers sitting around a clock face. Each key is hashed to a time and walks clockwise to the first server. Add a server at 3 o'clock and only the keys between the previous server and 3 o'clock move — everyone else stays put.

**Why not \`hash(key) % N\`?** Going from N=10 to N=11 remaps ~10/11 ≈ **91% of keys** — for a cache, that's a near-total miss storm on your database. With consistent hashing only ~**1/N** of keys move (~9% when adding the 11th node).

**Virtual nodes.** With one point per server the arcs are wildly uneven (some servers get 2–3× the average). Place each server at *v* points (e.g. \`nodeA#0 … nodeA#199\`). Rule of thumb: **100 vnodes → ~10% standard deviation of load, 200 → ~5%**. Vnodes also let you weight servers (a 2× bigger box gets 2× vnodes) and spread a failed node's keys across *many* survivors instead of dumping them on one neighbour.

**Variants you should name**

- **Ring hash** (Ketama for memcached, Envoy RING_HASH) — the classic.
- **Rendezvous / HRW hashing** — for each key, score every node with hash(key, node), pick the max; no ring, O(N) per lookup, perfect minimal disruption.
- **Jump consistent hash** (Google) — tiny, fast, O(1) memory, but only supports adding/removing at the end (numbered shards).
- **Maglev hashing** — fixed-size lookup table (e.g. 65,537 entries) giving near-perfect balance and minimal disruption; used by Google's L4 LB so every LB instance maps a connection to the same backend without shared state.
- **Consistent hashing with bounded loads** — cap each node at (1+ε)× average; overflow walks to the next node. Mitigates hot keys (used by Vimeo/HAProxy \`hash-balance-factor\`).

**Uses:** cache clusters (client-side sharding of memcached), sharded stateful services, L4 LB connection affinity, Cassandra/Dynamo token rings, sticky routing of a user's WebSocket to the same gateway.`,
      code: [
        {
          language: 'typescript',
          title: 'Consistent hash ring with virtual nodes and binary search',
          code: `import { createHash } from 'node:crypto';

// 32-bit position on the ring from md5 (fast enough; use xxhash/murmur in hot paths)
function hash32(s: string): number {
  return createHash('md5').update(s).digest().readUInt32BE(0);
}

export class HashRing {
  private ring: { pos: number; node: string }[] = [];

  constructor(nodes: string[], private readonly vnodes = 160) {
    for (const n of nodes) this.add(n);
  }

  add(node: string, weight = 1): void {
    const count = Math.round(this.vnodes * weight);    // weight bigger boxes
    for (let i = 0; i < count; i++) this.ring.push({ pos: hash32(node + '#' + i), node });
    this.ring.sort((a, b) => a.pos - b.pos);
  }

  remove(node: string): void {
    this.ring = this.ring.filter((p) => p.node !== node); // only its arcs move
  }

  get(key: string): string {
    if (this.ring.length === 0) throw new Error('empty ring');
    const h = hash32(key);
    let lo = 0;
    let hi = this.ring.length - 1;
    if (h > this.ring[hi].pos) return this.ring[0].node; // wrap around
    while (lo < hi) {                                     // first pos >= h
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid].pos < h) lo = mid + 1; else hi = mid;
    }
    return this.ring[lo].node;
  }
}

// const ring = new HashRing(['cache-a', 'cache-b', 'cache-c']);
// ring.get('user:42') -> 'cache-b'; adding 'cache-d' moves ~1/4 of keys`,
        },
      ],
      diagram: `            0 / 2^32
         A#7 .  . B#2            key k1 -> walk clockwise -> B#2 (node B)
       .            .            key k2 -> ... -> C#5 (node C)
  C#1 .    RING      . A#3       add node D: only keys between D's vnodes
       .            .            and their predecessors move (~1/N total)
         B#9 .  . C#5            remove A: A's arcs spread over B and C
                                 (many vnodes => spread evenly)`,
      keyPoints: [
        'hash mod N remaps ~all keys on resize; consistent hashing moves ~1/N.',
        '100–200 vnodes per node give ~10–5% load std-dev and even failover spread.',
        'Bounded-load variants and key replication handle hot keys.',
      ],
      source: 'Google Maglev (NSDI 2016)',
    },
    {
      heading: 'Sticky sessions (session affinity): convenience vs balance',
      body: `**Intuition:** always seating a regular at the same waiter's table is nice for the regular — until that waiter goes home sick and the regular's order is lost, or one waiter ends up with all the regulars.

**Mechanisms**

- **LB-generated cookie** (ALB \`AWSALB\`, nginx sticky cookie, Envoy cookie hash) — most precise.
- **Application cookie** — LB hashes your session ID.
- **Source-IP hash** — no cookies needed but everyone behind a corporate NAT or mobile carrier-grade NAT lands on one server; IPs change on mobile networks.
- **Consistent hashing on a header/user ID** — affinity that survives LB restarts and scales smoothly.

**Costs**

- **Uneven load**: heavy users or NAT'd offices overload one node; autoscaling new nodes receive only *new* sessions, so they sit idle while old nodes burn.
- **Failover loses state**: in-memory sessions die with the node; users are logged out or lose carts. (Book, Ch 3: failed sticky sessions because backend state wasn't migrated are a common failover problem.)
- **Deploys get slow**: draining a node means waiting for its sessions to expire or accepting session loss.

**When affinity is legitimately good**

- **Cache locality**: routing a user/tenant to the node holding their warm in-process cache (use consistent hashing, not cookies, and treat it as an optimisation, not a requirement).
- **Stateful protocols**: WebSocket servers, game servers, collaborative editing sessions — the connection itself is sticky; design for reconnect + state recovery.

**Default recommendation:** stateless app servers; sessions in Redis or as signed JWTs; use affinity only as a performance hint that can be broken at any time.`,
      code: [
        {
          language: 'nginx',
          title: 'nginx: consistent-hash affinity on a user header vs plain round robin',
          code: `upstream api_stateless {
  least_conn;                                   # default choice: no affinity
  server 10.0.1.10:3000;
  server 10.0.1.11:3000;
  server 10.0.1.12:3000;
}

upstream tenant_cache_affinity {
  # Affinity as an optimisation: same tenant -> same node (warm local cache).
  # 'consistent' = ketama ring: adding a node remaps only ~1/N of tenants.
  hash $http_x_tenant_id consistent;
  server 10.0.2.10:3000;
  server 10.0.2.11:3000;
  server 10.0.2.12:3000;
}

server {
  listen 80;
  location /api/   { proxy_pass http://api_stateless; }
  location /reports/ { proxy_pass http://tenant_cache_affinity; }
}`,
        },
      ],
      keyPoints: [
        'IP-hash affinity is skewed by NAT and breaks on mobile IP changes.',
        'Affinity must be an optimisation, never the only copy of state.',
        'New autoscaled nodes stay idle under cookie stickiness.',
      ],
      source: 'Mastering API Architecture — Ch 3 (“Mitigating risks”: failover and sticky sessions)',
    },
    {
      heading: 'Health checks, outlier detection and slow start',
      body: `**Intuition:** active health checks are the manager calling each waiter every 5 s asking "are you OK?"; passive checks are noticing that a waiter's customers keep complaining. You want both — and you don't want the manager to fire *every* waiter because the kitchen ran out of bread.

**Active checks** — LB probes \`/healthz\` every *interval* (e.g. 5–10 s); mark unhealthy after *unhealthy threshold* failures (2–3), healthy after *healthy threshold* successes (2–5). Detection time ≈ interval × threshold (10 s × 3 = 30 s).

**Passive checks / outlier detection** — watch real traffic: N consecutive 5xx/timeouts → eject for a period. Reacts in seconds and catches failures probes miss (e.g. one bad route). Cap the ejection percentage.

**Liveness vs readiness (Kubernetes)**

- **Liveness**: "is the process hopelessly stuck?" → restart. Must be **shallow** (event loop responsive). Never check the DB here: a DB blip would restart every pod simultaneously.
- **Readiness**: "should I receive traffic now?" → remove from endpoints. Can check *local* prerequisites (warm-up done, not shutting down, connection pool usable) with short timeouts and cached results.
- **Startup probe**: long-booting apps, prevents liveness killing them during start.

**Deep health checks are dangerous.** If every instance's readiness depends on a shared dependency (DB, Redis, downstream API), that dependency's blip marks **all** instances unhealthy at once → the LB has no healthy targets → total outage for requests that didn't even need that dependency. Many LBs "fail open" when all targets are unhealthy (ALB routes to all; Envoy's panic threshold, default 50%, balances across all hosts) — know your LB's behaviour.

**Slow start.** New instances have cold JIT, empty caches and unfilled pools. Least-connections sends them a flood because they have zero connections. Use slow-start ramps (ALB slow start 30–900 s, Envoy \`slow_start_config\`, HAProxy \`slowstart\`) and pre-warm (e.g. pool connections before readiness=true).`,
      code: [
        {
          language: 'yaml',
          title: 'Envoy cluster: active + passive health checks, panic threshold, slow start',
          code: `clusters:
  - name: orders
    type: STRICT_DNS
    lb_policy: LEAST_REQUEST          # P2C on in-flight requests
    least_request_lb_config:
      choice_count: 2
      slow_start_config:
        slow_start_window: 60s        # ramp traffic to new hosts over 60s
        aggression: { default_value: 1.0, runtime_key: orders_ss_aggr }
    common_lb_config:
      healthy_panic_threshold: { value: 50 }  # <50% healthy -> balance across all
    health_checks:
      - timeout: 1s
        interval: 5s
        unhealthy_threshold: 3        # ~15s to mark down
        healthy_threshold: 2
        http_health_check: { path: /readyz }
    outlier_detection:
      consecutive_5xx: 5
      interval: 10s
      base_ejection_time: 30s
      max_ejection_percent: 30
    load_assignment:
      cluster_name: orders
      endpoints:
        - lb_endpoints:
            - endpoint: { address: { socket_address: { address: orders.internal, port_value: 3000 } } }`,
        },
      ],
      keyPoints: [
        'Detection time = interval × threshold; passive checks react faster.',
        'Liveness shallow; readiness local; never make every node depend on one shared check.',
        'Slow start prevents least-conn from flooding cold instances.',
      ],
    },
    {
      heading: 'LB tiers, failover and not being the bottleneck',
      body: `**Intuition:** you can't have one bouncer for a stadium. You have gates (DNS/anycast), turnstile banks (L4), and ushers per section (L7) — each tier scales horizontally and no single person is critical.

**Tier 1 — DNS / GSLB.** Route 53, NS1, Cloudflare return different IPs per region/health/latency. Limits: TTLs (30–60 s) are not always respected by resolvers/clients, so failover takes minutes for some users; DNS balances *resolvers*, not users, so it's coarse.

**Tier 2 — Anycast + ECMP.** The same IP is announced via BGP from many locations; the network routes each user to the nearest. Inside a site, routers spread flows across many L4 LB machines with **ECMP** (equal-cost multipath, hashing the 5-tuple). Cloudflare, Google and Fastly front everything this way.

**Tier 3 — L4 LB fleet** (Maglev, Katran, NLB). Stateless-ish: each machine uses **consistent hashing** (Maglev table) on the 5-tuple so any LB instance maps a connection to the same backend — critical because ECMP may shift a flow to a different LB when the LB set changes. Maglev: ~10 Gbps / millions of packets per second per machine.

**Tier 4 — L7 proxies** (Envoy, ALB, nginx) doing TLS, routing, retries.

**Classic on-prem HA pair.** Active/passive LBs sharing a virtual IP via **VRRP** (keepalived); failover in ~1–3 s; connection state lost unless synced (conntrackd).

**Hidden bottlenecks**

- **conntrack table** on Linux LBs/NAT nodes (\`nf_conntrack_max\`) fills → new connections silently dropped.
- **SNAT/ephemeral ports**: an L7 LB with one source IP talking to one backend IP:port has at most ~28K ports in the default Linux range (32768–60999); TIME_WAIT (60 s) caps the new-connection rate at ~470/s per pair → use keepalive, more source IPs, or more backend IPs.
- **Cloud LB scaling**: managed LBs scale gradually; a sudden 10× flash crowd may need pre-warming (a support ticket or load ramp) — or use NLB/anycast CDN in front.
- **Failover correctness** (book Ch 3): lost sticky state, users routed to a far region while a nearer one is healthy, and cascading failures from faulty leader election. Test failover regularly.`,
      diagram: `   users
     |  GeoDNS: region A (healthy, nearest)
     v
  anycast VIP 203.0.113.10 (BGP from many PoPs)
     |
  [router] --ECMP 5-tuple hash-->  L4 LB x N (Maglev table: same flow
     |                              -> same backend on every LB)
     v
  L7 proxies x M  (TLS, HTTP routing, retries, per-request balancing)
     |
  services (autoscaled, health-checked, drained on deploy)`,
      keyPoints: [
        'Scale the LB layer horizontally: DNS → anycast/ECMP → L4 → L7.',
        'L4 fleets use consistent hashing so any LB routes a flow identically.',
        'Watch conntrack, SNAT ports and cloud LB warm-up.',
      ],
      source: 'Google Maglev (NSDI 2016); Mastering API Architecture — Ch 3 (failover pitfalls)',
    },
    {
      heading: 'Long-lived connections: gRPC, HTTP/2 and WebSockets',
      body: `**Intuition:** load balancers distribute *arrivals*. If guests arrive once and then stay all night, whichever tables were open when they arrived stay crowded, and a newly opened table stays empty.

**The problem.** gRPC/HTTP2 clients open one connection and multiplex everything over it; WebSocket clients hold a connection for hours. After a deploy or scale-out:

- the first pods to become ready collect most connections (rolling deploy leaves the last pod nearly empty),
- new autoscaled pods get **no** traffic until clients reconnect,
- L4 LBs and kube-proxy (ClusterIP) balance per connection, so request-level balance never happens.

**Fixes for gRPC/HTTP2 (request-oriented)**

1. **L7 balancing** — Envoy/mesh/ALB (gRPC support) balances individual streams.
2. **Client-side LB** — gRPC \`round_robin\` policy over a headless Service (DNS returns all pod IPs), or xDS-based proxyless gRPC.
3. **Server-side MAX_CONNECTION_AGE** — the server sends GOAWAY after e.g. 5 min (+ grace), forcing clients to reconnect and rebalance. Jitter it so all clients don't reconnect together.

**Fixes for WebSockets (connection-oriented)**

1. Balance on **least connections** at L4/L7 (not RR).
2. Cap connections per node; readiness=false when full.
3. On deploy, **drain gradually**: stop accepting new sockets, then close existing ones in batches with a "reconnect" message; clients reconnect with **exponential backoff + jitter** to other nodes.
4. Periodic rebalancing: if a node is > 1.2× average connections, ask a fraction of clients to reconnect.
5. Budget the reconnect storm: 1M clients reconnecting in 10 s = 100K TLS handshakes/s.`,
      code: [
        {
          language: 'typescript',
          title: 'gRPC server (grpc-js): force periodic reconnects so connections rebalance',
          code: `import * as grpc from '@grpc/grpc-js';

// Clients multiplex all RPCs on one HTTP/2 connection. Without an age limit,
// pods added by autoscaling receive nothing until clients happen to reconnect.
const jitterMs = Math.floor(Math.random() * 60_000);   // spread GOAWAYs across pods/clients

const server = new grpc.Server({
  'grpc.max_connection_age_ms': 5 * 60_000 + jitterMs,  // send GOAWAY after ~5-6 min
  'grpc.max_connection_age_grace_ms': 30_000,           // let in-flight RPCs finish
  'grpc.keepalive_time_ms': 30_000,                     // detect dead peers behind NAT
  'grpc.keepalive_timeout_ms': 10_000,
});

// Client side: resolve ALL pod IPs (headless Service) and round-robin per RPC
export const channelOptions: grpc.ChannelOptions = {
  'grpc.service_config': JSON.stringify({
    loadBalancingConfig: [{ round_robin: {} }],
  }),
};
// new MyServiceClient('dns:///orders-headless.shop.svc.cluster.local:50051',
//   grpc.credentials.createInsecure(), channelOptions);

export default server;`,
        },
      ],
      keyPoints: [
        'Per-connection balancing + long-lived connections = persistent skew.',
        'gRPC: L7/mesh, client-side round_robin over headless DNS, or MAX_CONNECTION_AGE.',
        'WebSockets: least-conn, per-node caps, gradual drain, jittered reconnects.',
      ],
    },
    {
      heading: 'Connection draining and zero-downtime deploys',
      body: `**Intuition:** closing a checkout lane politely — put up the "lane closed" sign, finish serving the people already in line, then switch off the till. Switching it off mid-scan is the 502 you see during deploys.

**The race.** When a pod/instance is terminated, the LB (or kube-proxy/mesh endpoints) learns about it *asynchronously* — typically 1–10 s later. If the process exits immediately on SIGTERM, requests routed in that window get connection refused/reset → 502/503.

**Correct shutdown sequence**

1. Receive SIGTERM (or preStop hook fires).
2. **Fail readiness** / deregister from the LB; keep serving.
3. **Wait** for endpoint propagation (preStop sleep 5–15 s; ALB deregistration delay default 300 s — tune to your longest normal request, e.g. 30 s).
4. Stop accepting new connections; send \`Connection: close\` on keepalive responses / HTTP2 GOAWAY so clients move.
5. Finish in-flight requests (bounded by a timeout).
6. Close DB pools, flush telemetry, exit — all within \`terminationGracePeriodSeconds\`.

**Rolling deploy knobs:** \`maxUnavailable: 0\`, \`maxSurge: 25%\`, readiness gating (don't be ready until warmed), \`minReadySeconds\` so a pod must stay ready for a while before the rollout continues.

**Long-lived connections** complicate draining: WebSocket nodes can't wait hours; they close sockets in batches with reconnect hints after the deregistration delay.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS graceful shutdown: fail readiness, wait, drain, exit',
          code: `import { BeforeApplicationShutdown, Controller, Get, Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class Lifecycle implements BeforeApplicationShutdown {
  shuttingDown = false;
  async beforeApplicationShutdown(signal?: string) {
    // Runs on SIGTERM (enableShutdownHooks) BEFORE Nest closes the HTTP server
    this.shuttingDown = true;                              // 1. readiness -> 503
    await new Promise((r) => setTimeout(r, 10_000));       // 2. wait for LB/endpoints to notice
    // 3. After this resolves Nest closes the HTTP server (stops accepting, lets
    //    in-flight requests finish), then runs onApplicationShutdown hooks
    console.log('readiness failed, closing server after', signal);
  }
}

@Controller()
export class HealthController {
  constructor(private readonly life: Lifecycle) {}

  @Get('livez')                                           // shallow: process alive
  live() { return { ok: true }; }

  @Get('readyz')                                          // traffic gate
  ready() {
    if (this.life.shuttingDown) throw new ServiceUnavailableException('draining');
    return { ok: true };
  }
}

// main.ts:
//   app.enableShutdownHooks();
//   const server = app.getHttpServer();
//   server.keepAliveTimeout = 65_000;  // > LB idle timeout (see proxies topic)
// k8s: terminationGracePeriodSeconds: 45 (> 10s wait + longest request)`,
        },
      ],
      keyPoints: [
        'Deregistration is asynchronous: keep serving for seconds after SIGTERM.',
        'Deregistration delay ≥ longest normal request; grace period ≥ wait + drain.',
        'maxUnavailable 0 + readiness gating + minReadySeconds for safe rollouts.',
      ],
    },
    {
      heading: 'Load balancing in interviews: what to say and numbers to know',
      body: `**Intuition:** interviewers rarely want you to pick "round robin". They want you to spot *why* balance breaks — state, long connections, heterogeneity, failures — and to know which layer solves it.

**Checklist for any design**

1. **Where are the LBs?** Edge (DNS/anycast → L4 → L7), internal (mesh/client-side), data tier (proxy like PgBouncer / Redis Cluster client routing).
2. **What is the unit of balancing?** Connection vs request vs key (consistent hashing for caches/shards).
3. **Is there state?** If yes: affinity via consistent hashing + replication, or externalise it.
4. **Failure handling:** active + passive health checks, ejection caps, panic mode, slow start, draining.
5. **Is the LB itself a bottleneck/SPOF?** Horizontal tiers, anycast, VRRP pairs, managed LB limits.

**Numbers**

| Component | Ballpark |
|---|---|
| L4 LB (Maglev/Katran-class) per machine | ~10+ Gbps, millions of packets/s |
| Envoy/nginx L7 per core | ~5–20K HTTP req/s (TLS, filters reduce) |
| New TLS handshake CPU (RSA-2048 server side) | ~1–2 ms CPU; ECDSA P-256 cheaper |
| Health-check detection | interval × threshold, e.g. 5 s × 3 = 15 s |
| DNS failover | TTL (30–60 s) + resolver caching → minutes for tail |
| Keys moved on adding 1 of N nodes (consistent hashing) | ~1/(N+1) |
| Virtual nodes | 100–200 per node → ~10–5% load std-dev |`,
      keyPoints: [
        'Identify the balancing unit: connection, request, or key.',
        'State and long-lived connections are where balancing breaks.',
        'The LB tier must itself be horizontally scalable and failure-tested.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'net-load-balancing-cc-1',
      title: 'Replace modulo sharding in a cache client',
      context:
        'A product-catalog service shards cache keys across Redis nodes on the client side. When ops added a 4th node the DB hit 12× normal QPS for 20 minutes, and when one node died the on-call removed it from the list and the DB fell over again. Some keys also end up on "undefined" nodes.',
      task:
        'Rewrite the node-selection logic so resizing and node failures move only a small fraction of keys, load stays even across nodes, and key hashing is correct for long keys.',
      starter: {
        language: 'typescript',
        code: `import Redis from 'ioredis';

let hosts = ['cache-a:6379', 'cache-b:6379', 'cache-c:6379'];
let clients = hosts.map((h) => new Redis('redis://' + h));

function hashKey(key: string): number {
  let h = 0;
  for (const ch of key) h = h * 31 + ch.charCodeAt(0); // Java-style hash
  return h;
}

export function clientFor(key: string): Redis {
  return clients[hashKey(key) % clients.length];
}

// called by on-call runbook when a node dies
export function removeNode(host: string) {
  const i = hosts.indexOf(host);
  hosts.splice(i, 1);
  clients.splice(i, 1);
}

export async function getProduct(id: string) {
  return clientFor('product:' + id).get('product:' + id);
}`,
      },
      hints: [
        'What fraction of keys change owner when clients.length goes from 3 to 4 with modulo? From 3 to 2?',
        'In JavaScript, what happens to h = h * 31 + c after ~11 characters? Is that still an integer, and what does % return for Infinity?',
        'How can a server own many small arcs of the keyspace instead of one big one?',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { createHash } from 'node:crypto';

function hash32(s: string): number {
  // Well-distributed, fixed 32-bit output (no float overflow)
  return createHash('md5').update(s).digest().readUInt32BE(0);
}

class Ring {
  private points: { pos: number; host: string }[] = [];
  private readonly down = new Set<string>();

  constructor(hosts: string[], private readonly vnodes = 160) {
    for (const h of hosts) this.add(h);
  }
  add(host: string) {
    for (let i = 0; i < this.vnodes; i++) this.points.push({ pos: hash32(host + '#' + i), host });
    this.points.sort((a, b) => a.pos - b.pos);
  }
  markDown(host: string) { this.down.add(host); }   // keep points: other keys don't move
  markUp(host: string) { this.down.delete(host); }

  owner(key: string): string {
    const h = hash32(key);
    let lo = 0;
    let hi = this.points.length;
    while (lo < hi) {                                // first point with pos >= h
      const mid = (lo + hi) >>> 1;
      if (this.points[mid].pos < h) lo = mid + 1; else hi = mid;
    }
    // walk clockwise, skipping down hosts: only the dead node's keys move
    for (let n = 0; n < this.points.length; n++) {
      const p = this.points[(lo + n) % this.points.length];
      if (!this.down.has(p.host)) return p.host;
    }
    throw new Error('all cache nodes down');
  }
}

const hosts = ['cache-a:6379', 'cache-b:6379', 'cache-c:6379'];
const clients = new Map(hosts.map((h) => [h, new Redis('redis://' + h, { maxRetriesPerRequest: 1 })]));
export const ring = new Ring(hosts);

export function addNode(host: string) {
  clients.set(host, new Redis('redis://' + host, { maxRetriesPerRequest: 1 }));
  ring.add(host);                                    // ~1/(N+1) of keys move
}

export async function getProduct(id: string): Promise<string | null> {
  const key = 'product:' + id;
  const host = ring.owner(key);
  try {
    return await clients.get(host)!.get(key);
  } catch {
    ring.markDown(host);                             // health checker calls markUp later
    return null;                                     // caller falls back to DB (with single-flight)
  }
}`,
      },
      explanation: `**Fixes**

- **Modulo resharding**: with \`hash % N\`, going from 3 to 4 nodes remaps about 75% of keys (3 → 2 remaps about 67%). That is the miss storm that hit the DB. A consistent-hash ring moves only about 1/(N+1) of keys when a node is added.
- **Failure handling**: splicing the array shifted every index and remapped almost everything. Now a dead node is marked down and its keys walk clockwise to the next live owner, so only that node's keys move and they spread across several survivors thanks to vnodes.
- **Virtual nodes (160 per host)**: keeps per-node load within roughly 5–10% of the mean and spreads the keys of a failed node evenly.
- **Hash correctness**: \`h * 31 + c\` grows past 2^53 after about 11 characters and loses precision, then reaches Infinity for long keys, and \`Infinity % n\` is \`NaN\`, which gives \`clients[NaN]\` = undefined. A fixed 32-bit md5 prefix is uniform and always an integer.
- **Client resilience**: \`maxRetriesPerRequest: 1\` stops ioredis from queueing commands for a dead node. The caller falls back to the DB, which should itself be protected with single-flight.`,
      followUps: [
        {
          "q": "The service runs on 40 pods, each with its own Ring. Pod A marks cache-b down after a timeout, while pod B still thinks it's up. What problems does that cause?",
          "a": "Views of the ring diverge: for cache-b's keys, A reads and writes on the successor while B uses cache-b. Writes on one side and reads on the other give misses or stale data. When cache-b recovers, A marks it up and starts reading values that may be stale, because updates went to the successor. Mitigations: base markDown on a shared health signal (a central checker publishing membership, or Redis Sentinel or Cluster) instead of a single local timeout; delete or version keys on write rather than only setting them; use short TTLs on moved data; and require several failures within a window before marking down to avoid flapping."
        },
        {
          "q": "Why not just use Redis Cluster instead of client-side consistent hashing? When is your ring still the better choice?",
          "a": "Redis Cluster shards with 16,384 hash slots, handles failover with replicas, and supports resharding with live migration, so clients are redirected via MOVED/ASK and see no remapping misses. It suits most cases. A client-side ring is still useful when the nodes are independent caches without replication (memcached-style, where losing a node's data is fine), when you need multi-key operations across nodes (Cluster restricts them to one slot unless you use hash tags), or when you use a managed service without cluster mode. The cost is that you own membership, health and resharding logic yourself."
        }
      ],
    },
    {
      id: 'net-load-balancing-cc-2',
      title: 'Health checks that cause outages',
      context:
        'Every time Postgres has a 20-second failover, all 60 API pods get restarted by Kubernetes, the ALB reports zero healthy targets, and recovery takes 6 minutes. Deploys also produce bursts of 502s.',
      task:
        'Redesign liveness/readiness so that a shared-dependency blip degrades gracefully instead of taking every pod out, and deploys drain cleanly.',
      starter: {
        language: 'typescript',
        code: `import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';

@Controller()
export class HealthController {
  constructor(private readonly db: DataSource, private readonly redis: Redis) {}

  // used for BOTH livenessProbe and readinessProbe (period 5s, failureThreshold 2)
  @Get('health')
  async health() {
    await this.db.query('SELECT count(*) FROM orders');   // "make sure DB really works"
    await this.redis.ping();
    const r = await fetch('http://payments/health');      // downstream too
    if (!r.ok) throw new Error('payments down');
    return { status: 'ok' };
  }
}

// main.ts: process.on('SIGTERM', () => process.exit(0));`,
      },
      hints: [
        'What does Kubernetes do when a liveness probe fails, and what happens when 60 pods restart together against a DB that just came back?',
        'SELECT count(*) on a big table every 5 s from 60 pods: what does that cost, and what bounds it when the DB is slow?',
        'Should this pod be removed from the load balancer because a different service (payments) is down?',
      ],
      solution: {
        language: 'typescript',
        code: `import { BeforeApplicationShutdown, Controller, Get, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthState implements BeforeApplicationShutdown {
  draining = false;
  dbOk = true;                        // updated in the background, not per probe
  private timer: NodeJS.Timeout;

  constructor(private readonly db: DataSource) {
    this.timer = setInterval(() => void this.checkDb(), 5_000);
    this.timer.unref();
  }

  private async checkDb() {
    try {
      // cheap check with a hard timeout; never a table scan
      await Promise.race([
        this.db.query('SELECT 1'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 500)),
      ]);
      this.dbOk = true;
    } catch {
      this.dbOk = false;              // exported as a metric + used for degraded mode
    }
  }

  async beforeApplicationShutdown() {
    this.draining = true;             // readiness -> 503, LB stops sending
    clearInterval(this.timer);
    await new Promise((r) => setTimeout(r, 10_000)); // wait for deregistration
  }                                   // then Nest closes the server gracefully
}

@Controller()
export class HealthController {
  constructor(private readonly state: HealthState) {}

  @Get('livez')                       // liveness: is the event loop alive? nothing else
  live() { return { ok: true }; }

  @Get('readyz')                      // readiness: should THIS pod get traffic?
  ready() {
    if (this.state.draining) throw new ServiceUnavailableException('draining');
    // Deliberately NOT failing on dbOk/redis/payments: a shared dependency outage would
    // eject every pod at once. Requests degrade (cached reads, 503 on writes) instead.
    return { ok: true, db: this.state.dbOk ? 'up' : 'degraded' };
  }
}

// main.ts: app.enableShutdownHooks();  (remove the process.exit SIGTERM handler)
// k8s: livenessProbe /livez (period 10s, failureThreshold 3, timeout 1s)
//      readinessProbe /readyz (period 5s), startupProbe for slow boots
//      terminationGracePeriodSeconds: 45`,
      },
      explanation: `**Fixes**

- **Liveness is separated from dependencies**: liveness now only proves the process is responsive. Before, a DB failover failed liveness on every pod, and Kubernetes restarted all 60 at once. They came back cold and all reconnected together (a thundering herd on the recovering DB).
- **Readiness does not depend on shared dependencies**: failing readiness on the DB, Redis or payments marks every pod unhealthy at the same moment, leaving the ALB with zero healthy targets (or falling back to fail-open). The pod now stays in rotation and degrades per request.
- **A payments outage no longer ejects the API**: another service's health is not this pod's readiness. Handle it with timeouts or circuit breakers on the calls that actually need payments.
- **The DB check is cheap and bounded**: \`SELECT count(*)\` on a large table ran every 5 s from 60 pods with no timeout, so it was load in itself and hung when the DB was slow. Now it runs \`SELECT 1\` with a 500 ms timeout in the background, and the result is exposed as a metric.
- **Graceful draining**: \`process.exit(0)\` on SIGTERM dropped in-flight requests, which caused the deploy 502s. Now readiness fails first, the pod waits about 10 s for deregistration, and then Nest closes the server gracefully.`,
      followUps: [
        {
          "q": "Now Postgres is down for 20 minutes, not 20 seconds. Pods stay in rotation. What does the user experience, and how do you keep it acceptable?",
          "a": "Every pod stays ready, so the ALB keeps sending traffic. Requests that need the DB fail fast through the circuit breaker: writes return 503 with `Retry-After`, reads serve stale data from Redis or the CDN where possible, and the frontend shows a banner ('checkout temporarily unavailable'). Without a breaker, every request would wait for the DB connect timeout and pods would pile up connections and memory. Also stop the DB check itself from hammering: back off its interval. If a replica region is healthy, a global failover decision (manual or automated) moves traffic there. Probes alone should never make that decision."
        },
        {
          "q": "How would you verify in staging that this design actually behaves as claimed before the next real failover?",
          "a": "Run a game-day test. Under steady synthetic load (k6 at expected RPS), trigger an RDS failover or block DB traffic with a network policy or Toxiproxy for 20 s and for 5 minutes. Assert: zero pod restarts (`kubectl get pods` restart counts), the ALB healthy target count stays at 60, the error rate is limited to DB-dependent routes, and recovery happens within seconds of the DB returning, with no reconnect storm in DB connection graphs. For deploys, roll out under load and assert zero 502s in ALB logs. Automate it in CI on a schedule so regressions are caught."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'net-load-balancing-iq-01',
      difficulty: 'expert',
      question:
        'Design the load-balancing architecture for a global API serving 1M RPS across 3 regions. No single box may be a bottleneck or SPOF.',
      whatInterviewerLooksFor: [
        'Multi-tier LB: DNS/GSLB, anycast/ECMP, L4 fleet, L7 fleet',
        'Consistent hashing at L4 for flow stickiness across LB instances',
        'Capacity math and failure headroom (region and AZ loss)',
        'Health checking and failover behaviour at each tier',
      ],
      modelAnswer: `### Tiers
1. **GeoDNS / GSLB** — latency-based answers per region, health-checked; TTL 30–60 s. Coarse, but lets us drain a region.
2. **Anycast VIPs** per region (or global anycast via CDN) — BGP routes users to the nearest site; routers spread flows across L4 LBs with **ECMP**.
3. **L4 LB fleet** (Maglev/Katran-style or cloud NLB) — each instance uses a **consistent-hash lookup table** on the 5-tuple so any instance maps a given connection to the same L7 backend. When ECMP reshuffles flows after an LB instance fails, connections survive.
4. **L7 proxy fleet** (Envoy) — TLS termination, HTTP routing, per-request **P2C least-request** balancing, retries with budgets, outlier detection.
5. **Services** — autoscaled, readiness-gated, drained on deploy.

### Capacity
- 1M RPS, 3 regions → design each region for **50%** of global (so two regions can absorb a region loss): 500K RPS per region.
- L7: ~10K RPS per core with TLS reuse → 50 cores at 100% → ~85 cores at 60% → ~11 × 8-core nodes per region; spread across 3 AZs and add AZ-loss headroom (×1.5) → ~16–17 nodes.
- L4: a few machines per region handle tens of Gbps; run ≥4 for redundancy.

### Failure behaviour
- **L7 node dies**: L4 health checks remove it in ~5–10 s; consistent hashing moves only that node's flows.
- **L4 node dies**: BGP/ECMP withdraws it; other L4 instances compute the same backend for existing flows.
- **AZ dies**: L4 stops sending to that AZ; capacity headroom covers it.
- **Region dies**: GSLB stops answering it; anycast withdraws routes; the other regions scale up (pre-provisioned 50%).

### Operational concerns
Slow start for new L7 nodes, connection draining on deploy, pre-warming managed LBs, conntrack/SNAT limits, and regular failover game days.`,
      followUps: [
        { q: 'Why not just use DNS round robin to all L7 nodes?', a: 'DNS caching ignores TTLs, balances resolvers not users, can’t react quickly to failures, and exposes every node publicly.' },
        { q: 'How do you handle TLS handshakes during a region failover when 300K RPS of clients reconnect?', a: 'Session resumption / TLS tickets shared across L7 nodes, ECDSA certs, headroom for handshake CPU, and client reconnect jitter.' },
      ],
      pitfalls: [
        'A single “load balancer” box in the diagram',
        'No headroom for region/AZ loss',
        'Ignoring that L4 instances need consistent mapping of flows',
      ],
    },
    {
      id: 'net-load-balancing-iq-02',
      difficulty: 'hard',
      question:
        'Our WebSocket chat cluster has 20 nodes. After a rolling deploy, 3 nodes hold 60% of connections and are at 90% CPU while the newest nodes are nearly idle. Why, and how do you fix it?',
      whatInterviewerLooksFor: [
        'Recognises long-lived connections are balanced only at connect time',
        'Explains the rolling-deploy dynamics',
        'Proposes least-conn, caps, graceful drain with jittered reconnects, active rebalancing',
        'Considers reconnect storm capacity',
      ],
      modelAnswer: `### Why
The LB balances **connection arrivals**. In a rolling deploy, when node 1 restarts its clients reconnect to whatever is up — mostly nodes that restarted *earlier*. The nodes restarted first collect connections from every later restart; the last nodes restarted receive almost nothing and nothing moves back, because connections live for hours. Round robin makes this worse because it ignores current connection counts.

### Fixes
1. **Least-connections balancing** for the WebSocket upgrade path, so reconnecting clients prefer emptier nodes.
2. **Per-node connection cap**: when a node hits e.g. 1.2× the fleet average (or a hard limit like 50K), it fails readiness for *new* connections only.
3. **Graceful drain on deploy**: stop accepting, then close existing sockets **in batches** (e.g. 5% every 2 s) with a "reconnect" control message; clients reconnect with **exponential backoff + jitter** (e.g. 0–5 s random).
4. **Active rebalancing**: a controller compares per-node counts; overloaded nodes ask a fraction of clients to reconnect.
5. **Surge deploys**: bring up new nodes before draining old ones (maxSurge) so there is somewhere to go.

### Capacity for reconnects
1M connections reconnecting over 30 s ≈ 33K handshakes/s. With TLS ~1–2 ms CPU per handshake → 33–66 cores just for handshakes — budget it, or use TLS session resumption.

### Also
State must survive a reconnect: presence and unread messages come from Redis/Kafka, not node memory, so moving a user between nodes is cheap.`,
      followUps: [
        { q: 'Would consistent hashing of user ID to node be better?', a: 'It gives deterministic placement (handy for routing messages to the user’s node), but hot users/rooms skew load; use bounded-load consistent hashing or a routing registry.' },
        { q: 'How does a message for user X reach the node holding X’s socket?', a: 'A connection registry (user → node) in Redis plus pub/sub or per-node queues; or consistent hashing so the sender computes the node.' },
      ],
      pitfalls: [
        'Suggesting more nodes without addressing placement',
        'Disconnecting all clients at once on deploy',
        'Keeping session state only in node memory',
      ],
    },
    {
      id: 'net-load-balancing-iq-03',
      difficulty: 'hard',
      question:
        'You’re building a 12-node distributed cache. Explain how you would map keys to nodes, why virtual nodes matter, and what happens when a node fails or you add one.',
      whatInterviewerLooksFor: [
        'Modulo vs consistent hashing with numbers',
        'Virtual nodes: balance and failure spread',
        'Replication along the ring / hot keys',
        'Alternatives: rendezvous, jump hash, Redis Cluster slots',
      ],
      modelAnswer: `### Mapping
- **Not** \`hash(key) % 12\`: adding a 13th node remaps 12/13 ≈ **92%** of keys → massive miss storm.
- **Consistent hash ring**: hash nodes and keys into a 32-bit space; a key belongs to the first node clockwise. Adding a node moves ~1/13 ≈ **7.7%** of keys; removing moves only that node's ~8.3%.

### Virtual nodes
One point per node gives very uneven arcs (some nodes 2–3× average). With **100–200 vnodes per node**, load std-dev drops to ~10–5%. Vnodes also:
- spread a failed node's keys across *all* survivors (each takes ~1/11 of the extra load) instead of one neighbour doubling,
- allow weighting (bigger machines get more vnodes).
Lookup is O(log(N·v)) with binary search: 12 × 160 = 1,920 points, ~11 comparisons.

### Failure and growth
- **Node fails**: its keys become misses and are re-fetched from DB onto survivors — protect the DB with single-flight and rate limits; optionally keep a **replica** on the next distinct node clockwise (Dynamo-style), so reads fail over warm.
- **Add node**: pre-warm by copying the arcs it will own before switching, or accept ~8% misses gradually.

### Hot keys
Consistent hashing doesn't fix a single hot key. Use **bounded-load** consistent hashing, key replication with suffixes (\`key#0..7\`, random read), or an L1 in-process cache.

### Alternatives
- **Redis Cluster** uses 16,384 fixed **hash slots** (CRC16 mod 16384) assigned to nodes — resharding moves slots, not a ring; clients follow MOVED redirects.
- **Rendezvous hashing** — no ring, O(N) scoring, minimal movement.
- **Jump hash** — O(1) memory, only for numbered shards that grow/shrink at the end.`,
      followUps: [
        { q: 'How many vnodes would you pick and what’s the trade-off?', a: '100–200: better balance vs more ring memory and slower rebuilds; beyond ~500 the balance gain is marginal.' },
        { q: 'Two clients have different views of the node list. What happens?', a: 'They map some keys to different nodes → duplicate entries and stale reads; distribute membership via a config service and tolerate short inconsistency with TTLs.' },
      ],
      pitfalls: [
        'Saying consistent hashing solves hot keys',
        'Forgetting the DB impact of the misses during changes',
        'Not quantifying key movement',
      ],
    },
    {
      id: 'net-load-balancing-iq-04',
      difficulty: 'expert',
      question:
        'We switched our 30 Envoy edge proxies from round robin to least-connections and p99 got worse, with periodic spikes on random backends. Explain.',
      whatInterviewerLooksFor: [
        'Understands local view per LB and herding/synchronisation',
        'Knows P2C and why it helps',
        'Mentions slow start and fast-failure black holes',
        'Suggests measurement to confirm',
      ],
      modelAnswer: `### What's happening
- Each of the 30 proxies only sees **its own** connection counts. If they use full "pick the global minimum" on their local view, they all tend to converge on the same backend that recently looked least loaded (e.g. one that just came up or just finished a burst) → it receives a synchronised flood → its latency spikes → everyone moves on to the next "least loaded" → rolling spikes on random backends. That's **herding**.
- **New or restarted backends** have zero connections, so least-conn sends them a burst while they're cold (JIT, caches, pools) → spikes right after deploys/autoscaling.
- **Fast-failing backends** (instant 5xx) have few in-flight requests and attract *more* traffic — a black hole.
- With HTTP/2 upstream connections, "connections" is a poor proxy for load; in-flight **requests** is better.

### Fix
1. Use **LEAST_REQUEST with P2C** (Envoy's default choice_count 2): sample two random hosts, pick the one with fewer active requests. Random sampling breaks the synchronisation among 30 proxies while still steering away from busy hosts.
2. Enable **slow start** (e.g. 60 s window) for new hosts.
3. **Outlier detection** to eject fast-failing hosts, capped at 30–50%.
4. Consider latency-aware balancing (peak EWMA) if request cost varies a lot.

### Confirm
Per-backend RPS/in-flight heatmaps: spikes should correlate across proxies at the same time; correlate with deploy/autoscale events. After the change, the per-backend in-flight distribution should tighten.`,
      followUps: [
        { q: 'Why does P2C do so well mathematically?', a: 'With n servers and random placement max load ~log n/log log n; choosing the less loaded of two random servers reduces it to ~log log n — an exponential improvement with almost no coordination.' },
        { q: 'When is plain round robin actually the best choice?', a: 'Homogeneous servers with uniform, short requests and many LBs — it is simplest, has no state and doesn’t herd.' },
      ],
      pitfalls: [
        'Assuming least-connections is always better than round robin',
        'Ignoring the per-proxy local view',
        'Not mentioning slow start',
      ],
    },
    {
      id: 'net-load-balancing-iq-05',
      difficulty: 'medium',
      question:
        'A legacy Java app stores sessions in memory, so the team enabled sticky sessions on the ALB. What risks does this create, and how would you migrate away?',
      whatInterviewerLooksFor: [
        'Lists skew, failover loss, autoscaling ineffectiveness, deploy pain',
        'Knows NAT/IP-hash problems vs cookie stickiness',
        'Incremental migration to external session store/JWT',
      ],
      modelAnswer: `### Risks
- **Session loss on failure/deploy**: a node crash or rolling deploy logs out every user pinned to it (and loses carts).
- **Uneven load**: heavy users stay pinned; new autoscaled instances get only *new* sessions, so autoscaling barely relieves hot nodes.
- **Slow deploys**: draining requires waiting for sessions to expire or accepting losses.
- **Cookie duration trade-off**: long stickiness = worse balance; short = more session loss.
- If IP-based: corporate/carrier NAT sends thousands of users to one node; mobile IP changes break affinity.

### Migration plan
1. **Externalise sessions**: Spring Session with Redis (or DynamoDB). Serialisation cost is small (~1–5 KB per session, sub-ms Redis GET).
2. **Dual-read**: read from Redis first, fall back to local memory; write to both. Deploy.
3. After max session TTL (e.g. 30 min–24 h), all active sessions are in Redis; **turn off stickiness**; switch to least-outstanding-requests balancing.
4. Longer-term: stateless signed tokens (JWT) for identity, Redis only for server-side state (cart).

### Guardrails
Redis HA (replica + failover), session TTLs, size limits, and monitoring of session-store latency — it's now on the critical path.`,
      followUps: [
        { q: 'Is there any case where you’d keep affinity?', a: 'As a performance hint for local caches (consistent hash on tenant), with correctness not depending on it.' },
        { q: 'What if Redis goes down?', a: 'Users lose sessions or you degrade to read-only; run Redis with replication and failover, and keep JWT identity so authentication still works.' },
      ],
      pitfalls: [
        'Treating stickiness as a permanent fix',
        'Ignoring autoscaling ineffectiveness',
        'Big-bang switch that logs everyone out',
      ],
    },
    {
      id: 'net-load-balancing-iq-06',
      difficulty: 'expert',
      question:
        'During a 30-second Redis failover, your ALB marked all 40 API targets unhealthy. What went wrong with health-check design, and what is the right model?',
      whatInterviewerLooksFor: [
        'Deep checks on shared dependencies cause correlated failure',
        'Liveness vs readiness vs dependency degradation',
        'Knows fail-open/panic behaviour of LBs',
        'Proposes passive checks and per-request degradation',
      ],
      modelAnswer: `### What went wrong
The health endpoint checked Redis. A **shared dependency** failing makes **every** instance fail its check simultaneously — a correlated failure. The LB then has zero healthy targets. (ALB actually fails open when all targets are unhealthy and routes to all of them; many other LBs or Kubernetes endpoints just drop everything.) Requests that didn't even need Redis — health checks, static data, reads with DB fallback — were also rejected. If the same check was the liveness probe, Kubernetes restarted pods too, making recovery slower.

### Right model
- **Liveness**: process is alive and the event loop responds. Nothing external.
- **Readiness**: *this instance* can serve: warmed up, not draining, not overloaded (e.g. event-loop lag < threshold, pool not exhausted). Local conditions only.
- **Dependencies**: handled **per request** with timeouts, circuit breakers and fallbacks (cache miss → DB, or 503 for the specific feature). Report dependency health as **metrics/alerts**, not as LB health.
- **Passive health / outlier detection**: eject instances actually returning errors on real traffic, capped at 30–50% so a global issue can't eject everyone.
- Know the LB's **panic/fail-open** mode (Envoy healthy_panic_threshold 50%, ALB fail-open) and test it.

### Tuning
Interval 5–10 s, unhealthy threshold 2–3, healthy 2–3, timeouts < interval; slow start for re-added targets.

### Result
A Redis failover degrades cache-dependent features for 30 s instead of taking down the API.`,
      followUps: [
        { q: 'When is a deep health check appropriate?', a: 'For a dependency owned exclusively by that instance (a local sidecar, a per-node disk), or for synthetic monitoring/alerting — not for LB membership.' },
        { q: 'How would you catch a pod that is “up” but returning 500 for every request?', a: 'Passive health / outlier detection on 5xx rate, and per-pod error-rate alerts.' },
      ],
      pitfalls: [
        'Adding more dependencies to the health check to be “thorough”',
        'Using the same endpoint for liveness and readiness',
        'Not knowing what the LB does when all targets fail',
      ],
    },
    {
      id: 'net-load-balancing-iq-07',
      difficulty: 'hard',
      question:
        'Our gRPC order service scaled from 6 to 18 pods during a sale, yet CPU on the original 6 stayed at 95% and the new 12 sat at 5%. What is happening and how do you fix it without code changes to all clients?',
      whatInterviewerLooksFor: [
        'HTTP/2 connection pinning with L4/kube-proxy balancing',
        'Options: mesh/L7 proxy, client-side LB, MAX_CONNECTION_AGE',
        'Trade-offs and rollout',
      ],
      modelAnswer: `### What's happening
gRPC runs on HTTP/2: each client opens **one long-lived connection** to the Service ClusterIP, and kube-proxy (iptables/IPVS) balances **connections**, not requests. The 6 original pods hold all existing connections; new pods only get connections from clients that reconnect — which rarely happens, because gRPC connections are healthy and long-lived. Autoscaling added capacity nobody uses.

### Fixes (in order of "no client code change")
1. **Server-side MAX_CONNECTION_AGE** (e.g. 2–5 min + jitter, with a grace period): servers send GOAWAY, clients transparently reconnect and land on new pods. Server-only change, works immediately. Downside: rebalancing is gradual (minutes), plus periodic reconnect cost.
2. **L7 proxy / service mesh** (Envoy sidecar or Linkerd): the client's sidecar balances **each RPC** across all endpoints from EDS, so new pods get traffic within seconds. No app code change, but a platform change.
3. **Client-side balancing**: headless Service (DNS returns all pod IPs) + gRPC \`round_robin\` load-balancing policy, or proxyless gRPC with xDS. Best latency, but it needs client config changes and DNS re-resolution (grpc re-resolves on connection events/GOAWAY).

### Recommendation
Immediately: MAX_CONNECTION_AGE on the servers (a deploy of one service). Strategically: mesh or xDS client-side balancing for all gRPC services, with P2C least-request.

### Verify
Per-pod RPS converges within a few connection-age periods; CPU spread < ±15%.`,
      followUps: [
        { q: 'Why not just set sessionAffinity: None on the Service?', a: 'It already is the default — the issue is connection-level balancing itself, not affinity.' },
        { q: 'Any risk with MAX_CONNECTION_AGE on streaming RPCs?', a: 'Long server-streams get cut after age + grace; clients must handle reconnect/resume, or exempt streaming services and use L7 balancing.' },
      ],
      pitfalls: [
        'Blaming the HPA or adding even more pods',
        'Thinking kube-proxy balances per request',
        'Ignoring streaming RPC behaviour under GOAWAY',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'net-load-balancing-boe-1',
      question: 'A 10-node cache cluster holds 500M keys. Compare the keys moved and DB load when adding one node with modulo hashing vs consistent hashing.',
      assumptions: [
        'Cache hit ratio 95% at 200K reads/s; DB normally sees 10K QPS',
        'Keys uniformly accessed; moved keys become misses until re-populated',
        'DB can sustain ~30K QPS',
      ],
      steps: [
        { label: 'Modulo: fraction moved', calc: '1 − 10/11 ≈ 91% of keys → ~455M keys remapped' },
        { label: 'Modulo: DB load right after', calc: 'misses ≈ 5% + 91% × 95% ≈ 91% of 200K ≈ 182K QPS → 6× DB capacity' },
        { label: 'Consistent: fraction moved', calc: '1/11 ≈ 9% → ~45M keys' },
        { label: 'Consistent: DB load right after', calc: 'misses ≈ 5% + 9% × 95% ≈ 13.6% of 200K ≈ 27K QPS → just under 30K capacity' },
        { label: 'With vnodes (160/node)', calc: 'moved keys come evenly from all 10 nodes (~0.9% each); load std-dev ~5–8%' },
      ],
      answer: 'Modulo remaps ~455M keys and drives ~182K DB QPS (outage); consistent hashing remaps ~45M and peaks at ~27K QPS (survivable).',
      insight:
        'Resizing a cache is a DB capacity event. Consistent hashing turns it from an outage into a manageable bump; add request coalescing or pre-warming of the new node’s arcs to flatten it further.',
      followUps: [
        {
          "q": "The DB can only take 15K QPS, not 30K. Consistent hashing's 27K peak would now overwhelm it. How do you add the node safely?",
          "a": "Spread the key movement over time. Add the node with few vnodes (say 16 of 160), so about 1% of keys move and add roughly 2K QPS of misses, then step up as caches refill, each step settling within minutes. Or pre-warm: copy the arcs the new node will own from the current owners before flipping the ring, so moved keys are hits. Also add single-flight (request coalescing) so 1,000 concurrent misses for a key make one DB call, and short negative caching. With staged vnodes plus coalescing, peak DB load stays near the 10K baseline plus 1–2K."
        }
      ],
    },
    {
      id: 'net-load-balancing-boe-2',
      question: 'Your L7 proxy fleet opens connections to a single backend VIP without keepalive at 3,000 new connections/s. Will you run out of ephemeral ports?',
      assumptions: [
        'Each proxy node has 1 source IP; backend is one VIP:port',
        'Linux default ephemeral range 32768–60999 (28,232 ports)',
        'Proxy closes connections first → sockets sit in TIME_WAIT for 60 s',
        '6 proxy nodes share the load evenly',
      ],
      steps: [
        { label: 'New connections per node', calc: '3,000 ÷ 6 = 500 conns/s per node' },
        { label: 'Ports held in TIME_WAIT', calc: '500/s × 60 s = 30,000 ports per node' },
        { label: 'Available', calc: '28,232 < 30,000 → exhaustion; connect() starts failing (EADDRNOTAVAIL)' },
        { label: 'Max sustainable rate per node', calc: '28,232 ÷ 60 ≈ 470 new conns/s to one dest IP:port' },
        { label: 'With keepalive (100 req per conn)', calc: '3,000 req/s ÷ 100 ÷ 6 ≈ 5 new conns/s per node → trivial' },
      ],
      answer: 'Yes — each node needs ~30K ports in TIME_WAIT but has ~28K; keepalive reduces new connections by ~100× and removes the problem.',
      insight:
        'Connection reuse is a capacity requirement, not an optimisation. Alternatives are widening the port range, multiple source IPs or backend IPs (each unique 4-tuple has its own port space), and tcp_tw_reuse for outbound connections.',
      followUps: [
        {
          "q": "You can't enable keepalive because the backend is a legacy server that closes after each response. What else gets you under the limit?",
          "a": "Increase the 4-tuple space or shorten TIME_WAIT impact. Options: widen the ephemeral range to 1024–65535 (about 64K ports, 1,070 conns/s per destination); add source IPs to each proxy (nginx `proxy_bind` with multiple IPs: 3 IPs triple the space); give the backend multiple IPs or ports behind the VIP; enable `net.ipv4.tcp_tw_reuse=1`, which lets outbound connects reuse TIME_WAIT sockets safely when timestamps are on. Or have the backend close first, so TIME_WAIT lands on its side. Widening the range plus tw_reuse alone comfortably covers 500 conns/s per node."
        }
      ],
    },
    {
      id: 'net-load-balancing-boe-3',
      question: 'How long does it take for traffic to stop reaching a crashed instance, and how many requests fail, with active health checks only vs with passive outlier detection?',
      assumptions: [
        '20 instances, 20K RPS total (1K RPS each), uniform balancing',
        'Active checks: interval 10 s, unhealthy threshold 3, timeout 2 s',
        'Passive: eject after 5 consecutive 5xx/connect failures',
        'No retries at the LB',
      ],
      steps: [
        { label: 'Active detection time (worst case)', calc: 'up to 10 s until first probe + 3 failed probes × 10 s ≈ 30–40 s' },
        { label: 'Failed requests (active only)', calc: '1K RPS × ~35 s ≈ 35K failed requests' },
        { label: 'Passive detection per LB instance', calc: '5 failures at ~1K RPS ÷ (number of LBs, say 5) = 200 RPS each → ~25 ms' },
        { label: 'Failed requests (passive)', calc: '5 failures × 5 LB instances ≈ 25 requests' },
        { label: 'With one retry of connect failures', calc: 'idempotent requests re-sent to another host → near zero user-visible errors' },
      ],
      answer: 'Active only: ~35 s and ~35K failed requests; with passive outlier detection: ~tens of ms and ~25 failed requests.',
      insight:
        'Active health checks are for bringing hosts back and catching idle failures; passive checks on real traffic do the fast ejection. Combine both, add one budgeted retry for connection failures, and cap ejection percentage.',
      followUps: [
        {
          "q": "The instance doesn't crash. It gets slow: p99 goes from 50 ms to 3 s, but no errors. How do active and passive checks fare now?",
          "a": "Both may miss it. The active check hits `/healthz`, which responds quickly, and consecutive-5xx outlier detection sees no errors. Requests just pile up, and with round robin 1/20 of traffic (1K RPS) suffers 3 s latency. Fixes: latency-aware balancing (least-request or P2C on in-flight requests naturally shifts load away, because slow hosts accumulate outstanding requests); success-rate or latency-based outlier detection; request timeouts with a budgeted retry or hedging for idempotent reads. Alert on per-host p99 deviation from the fleet median."
        }
      ],
    },
  ],
  test: [
    {
      id: 'net-load-balancing-mcq-01',
      difficulty: 'hard',
      question:
        'gRPC clients connect through an AWS NLB to 10 backend pods. After scaling to 20 pods, the new pods receive almost no traffic. Most likely reason?',
      options: [
        'NLB balances per connection; long-lived HTTP/2 conns stay on old pods',
        'NLB health checks take 10 minutes to register new targets',
        'gRPC always uses sticky sessions keyed on client IP',
        'The NLB uses least-connections, which avoids new targets',
      ],
      correct: [0],
      explanation:
        'An L4 load balancer makes one decision per connection, and gRPC multiplexes all its calls over long-lived HTTP/2 connections, so existing connections never move to new pods. Health checks register targets within tens of seconds, not minutes. gRPC has no built-in IP stickiness, and least-connections would actually favour the new, empty targets.',
      followUps: [
        {
          "q": "You can't change the gRPC clients, which are third-party mobile SDKs. How do you get load onto the new pods?",
          "a": "Move balancing to L7 on your side. Put an HTTP/2-aware proxy (Envoy, an ALB with gRPC support, or Linkerd) behind the NLB. Clients keep one long connection to the proxy, and the proxy load-balances individual gRPC requests across all 20 pods over its own pooled connections, so new pods get traffic immediately. Also set a server-side `max_connection_age` (for example 5 minutes with a grace period), which sends GOAWAY so clients periodically reconnect and naturally spread across the fleet. That helps even without an L7 proxy, at the cost of some reconnect overhead."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-02',
      difficulty: 'medium',
      question:
        'You have 3 cache nodes using hash(key) % N and add a 4th. Roughly what fraction of keys now map to a different node?',
      options: ['About 25%', 'About 33%', 'About 50%', 'About 75%'],
      correct: [3],
      explanation:
        'With modulo hashing, a key keeps its node only if hash % 3 equals hash % 4, which is true for about 1 in 4 keys, so about 75% move. About 25% is what consistent hashing would move when adding the 4th node. 33% and 50% match neither scheme.',
      followUps: [
        {
          "q": "With consistent hashing, how would you add the 4th node so even the ~25% of keys that move don't cause a miss storm?",
          "a": "Warm the new node before it takes ownership. Option 1, dual-read: during migration, a miss on the new owner falls back to the old owner (computed from the previous ring), copies the value over and returns it, so moved keys are fetched from cache rather than the DB. Option 2, background copy: iterate keys in the arcs the new node will own (SCAN on the old nodes), copy them, then flip the ring. Option 3, ramp vnodes: introduce the node with 20 vnodes, then 80, then 160, so keys move in small waves the DB can absorb. Add request coalescing to cap duplicate DB fetches."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-03',
      difficulty: 'expert',
      question: 'What does this smooth weighted round-robin produce for weights A=3, B=1 over 4 picks?',
      code: {
        language: 'typescript',
        code: `for (const b of pool) { b.current += b.weight; total += b.weight;
  if (!best || b.current > best.current) best = b; }
best.current -= total;  // start: A.current = 0, B.current = 0`,
      },
      options: ['A A A B', 'A B A A', 'A A B A', 'B A A A'],
      correct: [2],
      explanation:
        'Pick 1: A=3, B=1, choose A, A becomes -1. Pick 2: A=2, B=2, tie, the first element A wins because the comparison is strict, A becomes -2. Pick 3: A=1, B=3, choose B, B becomes -1. Pick 4: A=4, B=0, choose A. So the order is A A B A. The smooth algorithm spreads B among the A picks rather than grouping all the A picks first.',
      followUps: [
        {
          "q": "Backend B is a new instance in slow-start. How would you integrate a weight ramp into smooth weighted round robin without resetting the rotation?",
          "a": "Make the effective weight dynamic. Each pick, compute B's effective weight as `configured × min(1, elapsed / rampDuration)`, for example ramping from 10% to 100% over 60 s. Smooth WRR uses the current effective weights in its `current += effective; pick max; picked -= total` loop, so changing a weight just shifts future picks without resetting state. Nginx uses the same idea, lowering effective weight on failures and slowly raising it back. Clamp to a minimum (such as 1) so B still receives probe traffic, and recompute the total each round."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-04',
      difficulty: 'hard',
      question:
        'A pod has a bug that makes it return HTTP 500 in 1 ms for every request. Your LB uses least outstanding requests with no outlier detection. What happens?',
      options: [
        'The pod gets less traffic because the LB penalises 500 responses',
        'Traffic is unaffected; LB algorithms ignore response codes',
        'The pod attracts more traffic because it finishes requests fastest, amplifying errors',
        'The LB marks it unhealthy immediately via active health checks',
      ],
      correct: [2],
      explanation:
        'Least-request and latency-based algorithms favour the host with the fewest in-flight requests, and a host that fails fast always looks the least busy, so it becomes a black hole that attracts traffic. Without outlier detection nothing penalises 5xx responses. Active health checks may still pass, because /healthz can be fine while real routes fail.',
      followUps: [
        {
          "q": "Configure outlier detection for this fleet. What thresholds would you set, and what stops it ejecting half the fleet during a real downstream outage?",
          "a": "Example Envoy outlier detection: `consecutive_5xx: 5`, plus a success-rate rule (eject hosts more than 1.9 standard deviations below the fleet mean, with at least 100 requests per 10 s interval), `base_ejection_time: 30s` (growing with repeated ejections), and `max_ejection_percent: 10–20`. The cap is the safety valve: if every host fails because a shared database is down, the success-rate rule sees no outlier (everyone is equally bad), and the cap prevents ejecting most of the fleet anyway. Pair it with panic-threshold behaviour, so the balancer routes to all hosts when too few are healthy."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-05',
      difficulty: 'expert',
      question:
        'Thirty independent proxies each route to 100 backends. Which algorithms avoid herding onto the same backend while still reacting to load? Select ALL that apply.',
      options: [
        'Power of two choices on in-flight requests',
        'Global least-connections computed from each proxy’s local counters',
        'Random choice weighted by recently observed latency (e.g. EWMA)',
        'Pure round robin with each proxy starting at index 0',
        'Least-request with random tie-breaking among a small sampled subset',
      ],
      correct: [0, 2, 4],
      explanation:
        'Randomised sampling methods, such as P2C, latency-weighted random or a small sampled subset, break the synchronisation between proxies while still steering away from load. When every proxy picks the global minimum from its own stale counters, they tend to hit the same host together. Round robin with every proxy starting at index 0 synchronises them outright and doesn’t react to load at all.',
      followUps: [
        {
          "q": "Why exactly does power of two choices work so well, and when would you still prefer full least-request?",
          "a": "Picking the less-loaded of two random hosts drops the expected maximum load from about log n / log log n (pure random) to about log log n, which is an exponential improvement, while costing only two counter reads. Randomness means independent proxies rarely pick the same target together. Full least-request (scan all hosts) helps with few backends, say 3–5, where sampling two misses the best host often, or with one central balancer whose counters are accurate. With many proxies and stale local views, P2C is better because exact minimum picking herds."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-06',
      difficulty: 'hard',
      question:
        'A B2B SaaS uses nginx ip_hash for sticky sessions. One enterprise customer with 8,000 employees behind a single NAT IP complains of slowness. Why, and what is the best fix?',
      options: [
        'nginx ip_hash has a hard limit of 1,000 clients per IP; raise it',
        'NAT breaks TLS; terminate TLS at the backend instead of at nginx',
        'Increase keepalive_timeout so the NAT reuses fewer connections',
        'All 8,000 users hash to one backend; key affinity on user or go stateless',
      ],
      correct: [3],
      explanation:
        'Hashing on source IP puts everyone behind one NAT address on the same backend, which becomes a hotspot. Keying affinity on the user, or removing the need for it by storing sessions externally, fixes the imbalance. ip_hash has no per-IP client limit, NAT does not break TLS, and keepalive settings do not change where the hash sends traffic.',
      followUps: [
        {
          "q": "Sessions can't be moved to Redis this quarter. What's the best interim fix inside nginx?",
          "a": "Change the affinity key from source IP to something user-specific: `hash $cookie_sessionid consistent;` (or a user id header set at login) with the `consistent` flag (ketama), so adding or removing a backend only remaps about 1/N of sessions. The 8,000 NAT users then spread evenly. For requests without a cookie yet (first hit), fall back to round robin; the cookie set on response pins later requests. Alternatively, use nginx Plus `sticky cookie`. You still lose sessions when a backend dies, so move sessions out later."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-07',
      difficulty: 'expert',
      question: 'The readiness probe uses this endpoint for all 50 pods. What is the main risk?',
      code: {
        language: 'typescript',
        code: `@Get('readyz')
async ready() {
  await this.redis.ping();                  // shared cluster
  await this.db.query('SELECT 1');          // shared primary
  return 'ok';
}`,
      },
      options: [
        'SELECT 1 is too expensive to run every 5 seconds',
        'A Redis or DB blip fails readiness on every pod at once, emptying the endpoint list',
        'Readiness probes cannot perform async operations in NestJS',
        'Kubernetes will restart pods whose readiness probe fails',
      ],
      correct: [1],
      explanation:
        'Every pod’s readiness depends on the same shared dependencies, so a single blip removes all endpoints at the same moment, turning a partial problem into a full outage. SELECT 1 is cheap. Nest handlers can be async without any problem. A failing readiness probe removes a pod from Service endpoints, while restarts come from liveness failures.',
      followUps: [
        {
          "q": "You still want the load balancer to stop sending writes when the DB is down. How do you express 'degraded' without emptying the endpoint list?",
          "a": "Keep readiness local (process up, not draining) and handle the dependency at request level. Put a circuit breaker on the DB client: when it is open, write endpoints return 503 with `Retry-After` immediately (cheap and fast) and read endpoints serve from cache. Expose dependency status as metrics and in a non-probe `/status` endpoint for dashboards. If you need traffic shifted, do it at a higher level, such as failing over the whole region at the global balancer when its DB is down. That decision belongs to a controller, not to 50 individual probes reacting at once."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-08',
      difficulty: 'hard',
      question:
        'Deploys cause a burst of 502s at the ALB even though the new pods are healthy. Which changes fix it? Select ALL that apply.',
      options: [
        'Add a preStop sleep so pods keep serving while deregistration propagates',
        'Handle SIGTERM by exiting immediately so pods restart faster',
        'Set terminationGracePeriodSeconds above preStop delay plus the longest request',
        'Set deregistration delay at least as long as the longest normal request',
        'Increase the health-check interval to 60 s to reduce flapping',
      ],
      correct: [0, 2, 3],
      explanation:
        'Deregistration is asynchronous, so pods must keep serving during propagation and be given enough time to drain in-flight work. Exiting immediately on SIGTERM is the cause of the 502s. A longer health-check interval only slows failure detection and does nothing for termination.',
      followUps: [
        {
          "q": "Some requests are 5-minute file uploads. Do you set deregistration delay to 5 minutes for the whole service?",
          "a": "That would make every deploy take more than 5 minutes per batch. Better options: route uploads to a separate target group or service with its own long drain (or make them resumable with multipart/S3 presigned URLs so the API pod isn't in the path at all); keep the normal API at 30 s. For in-flight long requests on a draining pod, either finish them within a capped grace period or design clients to resume. Also make clients idempotent and retry on connection reset. The goal is that the drain time matches the 99th percentile of normal requests, not the worst outlier."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-09',
      difficulty: 'medium',
      question:
        'Why do L4 load-balancer fleets like Maglev use consistent hashing on the connection 5-tuple instead of per-instance connection tables alone?',
      options: [
        'So every LB instance maps a flow identically when ECMP moves packets',
        'Hashing is required to decrypt TLS traffic at L4',
        'Consistent hashing guarantees perfectly equal load on every backend',
        'It allows the L4 LB to route based on HTTP paths',
      ],
      correct: [0],
      explanation:
        'Routers spread packets across LB instances with ECMP, and when that set changes, packets of an existing flow can arrive at a different LB. Consistent hashing lets every instance pick the same backend, so connections survive the move. It has nothing to do with TLS. Balance is near-equal but not perfect, and L4 load balancers cannot see HTTP paths.',
      followUps: [
        {
          "q": "A backend is added to the Maglev pool. What happens to existing connections whose hash now maps to the new backend?",
          "a": "Maglev's lookup table changes only for a small slice of entries (minimal disruption), but those flows' new packets would hash to the new backend, which has no TCP state and would send RST. Maglev avoids this with a per-instance connection tracking table: existing flows keep their recorded backend, and only new flows use the updated table. Connection tracking alone fails when ECMP moves a flow to a different LB instance that has no entry; then the consistent table usually maps it to the same backend anyway, so only a tiny fraction of flows break."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-10',
      difficulty: 'expert',
      question: 'What is wrong with this ring lookup?',
      code: {
        language: 'typescript',
        code: `get(key: string): string {
  const h = hash32(key);
  const p = this.ring.find((x) => x.pos >= h);   // ring sorted by pos
  return p!.node;
}`,
      },
      options: [
        'find is O(n); binary search is needed or results are incorrect',
        'Keys hashing past the last point return undefined instead of wrapping to the first node',
        'Virtual nodes make find return a vnode label instead of the node name',
        'Consistent hashing requires searching counter-clockwise',
      ],
      correct: [1],
      explanation:
        'A key whose hash is above the largest position on the ring must wrap around to the first point. Here find returns undefined for those keys, and the non-null assertion turns that into a crash at runtime. The linear scan is slow but still correct. Each vnode entry stores the node name, and walking clockwise is the standard convention.',
      followUps: [
        {
          "q": "Fix the wrap-around and make lookup O(log n). Then: how do you test that the ring stays balanced and stable?",
          "a": "Binary search for the first point with `pos >= h`; if the index equals `points.length`, use index 0. Tests: (1) distribution: hash 1M random keys over 10 nodes with 160 vnodes and assert each node owns within ±10% of 100K; (2) stability: record owners, add an 11th node, and assert about 1/11 (±1%) of keys changed owner, all moving to the new node; (3) removal: mark a node down and assert only its keys moved, spread across many survivors; (4) edge cases: hash 0, the maximum hash and an empty ring. Property-based tests (fast-check) generate random node sets."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-11',
      difficulty: 'hard',
      question:
        'You enable least-connections on a fleet during autoscaling. New instances immediately show p99 spikes and some time out. Best mitigation?',
      options: [
        'Switch to IP-hash so new instances receive only new clients',
        'Disable health checks on new instances for their first 5 minutes',
        'Reduce max connections on old instances to zero during scaling',
        'Enable slow start (30–120 s ramp) and pre-warm pools before readiness',
      ],
      correct: [3],
      explanation:
        'A new instance has zero connections, so least-connections floods it while its JIT, caches and connection pools are still cold. Ramping its weight gradually and warming it before it reports ready solves this. IP-hash reshuffles clients without fixing warm-up. Disabling health checks risks routing to broken instances, and starving the old instances breaks capacity.',
      followUps: [
        {
          "q": "Slow start is enabled, but a scale-out during a traffic spike still overloads the new pods. What else would you check?",
          "a": "Readiness may be reported before the pod is warm. Make readiness pass only after warm-up work completes: DB pool connected, caches primed for hot keys, JIT warmed by replaying a few synthetic requests. Check that slow start isn't ending too early relative to warm-up (a 30 s window when warm-up takes 90 s). Check aggression: Envoy's slow-start `aggression` value shapes the curve. Also, if old pods are overloaded, every algorithm will push excess onto new ones, so scale earlier (scale on predicted or queued load, keep spare capacity) rather than when p99 has already breached."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-12',
      difficulty: 'expert',
      question:
        'DNS-based failover is configured with TTL 30 s. A region fails. Which statements about user impact are accurate? Select ALL that apply.',
      options: [
        'Some resolvers and clients cache records longer than the TTL, so a tail of users keeps failing for minutes',
        'All users fail over within 30 s because TTL is enforced by the DNS protocol',
        'Health-check detection time at the DNS provider adds to the failover time',
        'Anycast-based failover can react faster because BGP withdraws routes to the failed site',
      ],
      correct: [0, 2, 3],
      explanation:
        'TTL is only advisory: some resolvers, JVMs and applications cache DNS answers longer, and the DNS provider must first detect the failure through its own health checks before it changes answers. Anycast fails over at the routing layer as soon as the failed site’s routes are withdrawn, without waiting for caches. Nothing in the protocol enforces a 30-second switch for all users.',
      followUps: [
        {
          "q": "A client keeps failing for 10 minutes after the region fails because its JVM caches DNS. How do you fix it from the server side, without client changes?",
          "a": "Use an address that doesn't change. Put both regions behind anycast IPs (AWS Global Accelerator, Cloudflare or GCP global LB), so the IP clients cached stays valid and the provider reroutes traffic to the healthy region within seconds of health-check failure. Alternatively, keep the failed region's IPs alive through its edge proxies and have them forward to the healthy region, effectively proxying failover. The longer-term client fix is `networkaddress.cache.ttl=30` in the JVM, but anycast removes dependence on client behaviour entirely."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-13',
      difficulty: 'expert',
      question:
        'A consistent hash ring uses 1 point per node for 5 nodes. What problems do you expect, and what fixes them?',
      options: [
        'Perfect balance, but lookups are slow; vnodes speed up lookup',
        'Keys will move on every lookup; vnodes pin them in place',
        'Uneven arcs, and a dead node’s load lands on one neighbour; vnodes fix both',
        'Only hot keys are a problem; vnodes fix hot keys directly',
      ],
      correct: [2],
      explanation:
        'With few points the arcs are random in size, so some nodes can own two to three times the average share, and a failed node’s whole arc falls on its single successor. Many virtual nodes per server even out the arcs and spread a failed node’s keys across all survivors. Extra vnodes actually make lookups slightly slower, keys don’t move between lookups, and a single hot key still lands on one node whatever the vnode count.',
      followUps: [
        {
          "q": "Even with 160 vnodes, one product key gets 20% of all reads during a launch. What do you do?",
          "a": "Vnodes balance key counts, not per-key popularity, so one hot key stays on one node. Options: a local in-process cache (L1) with a short TTL (1–5 s) in each app pod, which absorbs most reads for a single key; replicate the hot key under multiple suffixes (`product:42#0..7`) and have readers pick one at random, with writes updating all copies; or read from replicas of the owning shard. Detect hot keys with Redis `--hotkeys` (LFU) or client-side sampling, and apply replication only to them."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-14',
      difficulty: 'hard',
      question:
        'With this config, nginx serves 800 req/s to one backend and starts logging "Cannot assign requested address" on upstream connect. Cause and fix?',
      code: {
        language: 'nginx',
        code: `upstream api { server 10.0.5.20:3000; }
server {
  location / {
    proxy_pass http://api;   # proxy_http_version defaults to 1.0
  }
}`,
      },
      options: [
        'TIME_WAIT has exhausted ephemeral ports; add keepalive + HTTP/1.1 upstream',
        'The backend hit its listen backlog; increase somaxconn on it',
        'DNS resolution failed for the upstream; add a resolver directive',
        'The file-descriptor limit is reached; raise worker_rlimit_nofile',
      ],
      correct: [0],
      explanation:
        'EADDRNOTAVAIL on connect means no local port is free for that 4-tuple. At 800 connections/s with a 60 s TIME_WAIT, about 48K ports are needed, which is more than the default range of about 28K. Keepalive, or more source or destination addresses, fixes it. A full backlog shows as timeouts or refusals, DNS failures produce a different error, and running out of file descriptors gives "Too many open files".',
      followUps: [
        {
          "q": "After adding upstream keepalive, the backend team reports occasional 502s with 'upstream prematurely closed connection'. Why?",
          "a": "It's a keepalive race. The backend (say Node with `keepAliveTimeout` of 5 s) closes an idle connection just as nginx reuses it for a new request, so nginx receives a reset or EOF and returns a 502. Fix: make the upstream's idle timeout longer than nginx's `keepalive_timeout` for the upstream pool. For example, set Node's `server.keepAliveTimeout = 65000` and `headersTimeout = 66000`, with nginx upstream `keepalive_timeout 60s`. That way the client side, nginx, always closes first. Also enable `proxy_next_upstream error` for idempotent requests so a stale connection is retried."
        }
      ],
    },
    {
      id: 'net-load-balancing-mcq-15',
      difficulty: 'medium',
      question:
        'Which scenarios genuinely benefit from key-based affinity (consistent hashing) at the load balancer? Select ALL that apply.',
      options: [
        'Routing each tenant to the node holding its warm in-process cache',
        'Routing a user’s WebSocket to the node that owns their chat room shard',
        'Stateless REST API with sessions stored in Redis',
        'Client-side sharding of memcached keys across nodes',
      ],
      correct: [0, 1, 3],
      explanation:
        'Affinity pays off when some state or cache lives on specific nodes: a warm per-tenant cache, a sharded room, or memcached keys. A stateless API with sessions in Redis gains nothing from affinity and only loses balance and failover flexibility.',
      followUps: [
        {
          "q": "For the WebSocket chat room case, a node owning 500 rooms dies. What happens to those users, and how fast can they recover?",
          "a": "Their sockets drop. Clients reconnect with jittered backoff (spread over, say, 0–5 s so the rest of the fleet isn't stampeded). The LB hashes each room id on the updated ring, and with vnodes the 500 rooms spread across all survivors. The new owner must rebuild room state: membership from the reconnecting clients, and recent messages from a durable store (Redis stream or DB) using each client's last-seen message id. Expect recovery in seconds if the state store is external. If room state lived only in memory, recent unpersisted messages are lost, which is why messages are persisted before fan-out."
        }
      ],
    },
  ],
};

export default topic;
