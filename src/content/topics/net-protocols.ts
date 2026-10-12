import type { Topic } from '../../types';

const topic: Topic = {
  id: 'net-protocols',
  phase: 'networking',
  order: 1,
  title: 'DNS, TCP/UDP, HTTP/1.1 → HTTP/2 → HTTP/3 & TLS',
  subtitle:
    'Where every millisecond of a request goes before your handler runs — and the connection-management bugs that page senior engineers at 3am.',
  estimatedMinutes: 75,
  sources: [
    'Mastering API Architecture — Ch 1 (Design, Build and Specify APIs)',
    'High Performance Browser Networking — Ilya Grigorik',
    'RFC 8446 (TLS 1.3), RFC 9000 (QUIC), RFC 9113 (HTTP/2), RFC 9114 (HTTP/3)',
  ],
  tags: ['dns', 'tcp', 'udp', 'http2', 'http3', 'quic', 'tls', 'keep-alive', 'time_wait', 'connection-pooling'],
  cheatSheet: [
    "Cold HTTPS cost in RTTs: DNS (0–1) + TCP 1 + TLS 1.2 2 / TLS 1.3 1 + request 1. QUIC folds TCP+TLS into 1 RTT; 0-RTT resumption sends data in the first flight.",
    "DNS is only consulted when a NEW connection is opened — keep-alive pools keep hitting the old IP after a cutover. Cap connection max-age (e.g. 5–10 min).",
    "Node does not cache DNS: `dns.lookup` → getaddrinfo on the 4-thread libuv pool. JVM caches 30s by default. k8s `ndots:5` turns one external lookup into up to 8 queries.",
    "TCP slow start: initcwnd = 10 segments ≈ 14.6KB, doubling per RTT. A 1MB response on a fresh connection needs ~7 RTTs of data — warm connections matter more than bandwidth.",
    "Throughput ≤ window / RTT. 64KB window at 100ms RTT ≈ 5 Mbps no matter how fat the pipe (applies to TCP rwnd and HTTP/2 stream flow-control windows).",
    "HTTP/1.1: one in-flight request per connection (pipelining is dead) → browsers open 6/origin. HTTP/2: many streams on one TCP conn + HPACK header compression, but TCP-level head-of-line blocking remains.",
    "HTTP/3 = HTTP over QUIC (UDP): per-stream loss recovery, connection IDs enable Wi-Fi→LTE migration, TLS 1.3 built in. Discovered via `Alt-Svc` or DNS HTTPS records; must fall back to TCP when UDP is blocked.",
    "0-RTT early data is replayable — accept it only for idempotent requests (nginx `$ssl_early_data` + `425 Too Early`).",
    "Ephemeral ports: Linux default 32768–60999 = 28,232 per (src IP, dst IP, dst port). Active closer holds TIME_WAIT for 60s → max ≈ 470 new conns/s to one destination without reuse.",
    "Idle timeout ordering: client pool idle < LB idle (ALB 60s) < server keepAliveTimeout (Node default 5s — set to ~65s). Wrong order = random 502s with nothing in app logs.",
  ],
  sections: [
    {
      heading: 'The RTT tax: accounting for one HTTPS request',
      body: `**Intuition:** before a single byte of your JSON moves, every protocol layer charges a toll paid in round trips. For small API payloads, latency is dominated by *how many RTTs* you pay, not by bandwidth.

**The ledger for a cold request** (no cached DNS, no open connection):

| Step | RTTs | Notes |
|---|---|---|
| DNS lookup | 0–1+ | 0 if cached; recursive misses can cost 50–200ms |
| TCP handshake | 1 | SYN → SYN-ACK → ACK (data rides with the ACK) |
| TLS 1.2 | 2 | Full handshake; 1 with session resumption |
| TLS 1.3 | 1 | Key share sent in ClientHello; 0 with 0-RTT resumption |
| HTTP request/response | 1 | Plus server think time, plus slow-start rounds for large bodies |
| QUIC (HTTP/3) | 1 | Transport + TLS 1.3 combined; 0-RTT on resumption |

So on a 100ms mobile RTT: HTTP/1.1 + TLS 1.2 cold ≈ 400ms + DNS + server time; HTTP/2 + TLS 1.3 ≈ 300ms; HTTP/3 ≈ 200ms; HTTP/3 0-RTT ≈ 100ms. A **warm keep-alive connection** costs just 1 RTT — which is why connection reuse beats every protocol upgrade.

**Trade-offs:** you can reduce RTT count (TLS 1.3, QUIC, reuse) or reduce RTT length (terminate TLS at an edge POP 10–20ms from the user and ride warm, pooled connections back to origin).

**In interviews say:** "For chatty small-payload APIs I optimise the number of round trips first — connection reuse, TLS 1.3, edge termination — and only then bandwidth."`,
      diagram: `Client                                   Server        (RTT = 100ms)
  |---- DNS query ----> resolver              |   0-1 RTT
  |---- SYN ----------------------------------->|
  |<--- SYN-ACK --------------------------------|   TCP: 1 RTT
  |---- ACK + ClientHello(key_share) ---------->|
  |<--- ServerHello..Cert..Finished ------------|   TLS1.3: 1 RTT
  |---- Finished + GET /orders ---------------->|
  |<--- 200 OK (first 14.6KB, slow start) ------|   HTTP: 1 RTT
  total cold ~ 3 RTT + DNS  |  warm keep-alive = 1 RTT`,
      keyPoints: [
        "Count RTTs before counting bytes for API latency.",
        "Warm connection reuse removes 2–3 RTTs per request — the biggest single win.",
        "Edge TLS termination shortens the RTT that the handshake pays.",
      ],
      source: 'High Performance Browser Networking — Ch 2–4',
    },
    {
      heading: 'DNS: resolution, TTLs and the caching pitfalls that break cutovers',
      body: `**Intuition:** DNS is a globally distributed, eventually consistent cache. You never "change" a record — you publish a new one and wait for every cache in the world to expire the old one, and some caches ignore you.

**Resolution path:** app → stub resolver (getaddrinfo, /etc/resolv.conf) → recursive resolver (VPC resolver, 8.8.8.8, ISP) → root → TLD (.com) → authoritative server. Each layer caches for the record's **TTL**. Failed lookups are cached too (**negative caching**, TTL from the SOA minimum) — query a hostname before you create it and you can get NXDOMAIN for minutes.

**Where caching actually happens (or doesn't):**

| Layer | Behaviour |
|---|---|
| Browser / mobile OS | Caches, sometimes clamping TTLs to a minimum |
| Node.js | **No cache.** \`dns.lookup\` calls getaddrinfo on the libuv threadpool (4 threads by default) — slow DNS starves fs/crypto/zlib work |
| JVM | \`networkaddress.cache.ttl\` defaults to 30s (historically *forever* with a security manager) |
| Linux containers | Usually no local cache (no nscd/systemd-resolved) → every lookup hits CoreDNS |
| Recursive resolvers | Honour TTL, some enforce a floor (e.g. 30–300s) |

**Pitfalls that bite in production:**
- **Connections outlive DNS.** A keep-alive pool resolved the old IP once and will keep using it for hours. DNS-based blue/green only moves *new* connections — enforce a max connection age.
- **DNS round-robin is not load balancing:** clients cache one answer, pick the first record, and don't health-check.
- **Kubernetes \`ndots:5\`:** a name with fewer than 5 dots is tried against every search domain first — \`api.stripe.com\` becomes 3 search-domain misses + the real query, each for A and AAAA ≈ 8 queries.
- **The 5-second DNS timeout:** glibc sends A and AAAA in parallel over one UDP socket; a conntrack insertion race drops one, and the resolver waits its 5s timeout. Fixes: NodeLocal DNSCache, \`single-request-reopen\`, or TCP for DNS.
- Classic DNS over UDP is limited to 512 bytes; with EDNS0 ~1232 bytes is the safe size; larger answers truncate and retry over TCP.

**TTL trade-off:** 30–60s TTL for records you may fail over (more resolver load, slightly more lookup latency); hours for stable records. Lower the TTL *days before* a migration, not during it.`,
      code: [
        {
          language: 'typescript',
          title: 'Add a TTL-respecting DNS cache to Node HTTP agents',
          code: `import http from 'node:http';
import https from 'node:https';
import CacheableLookup from 'cacheable-lookup';

// Node has no DNS cache: every new socket calls getaddrinfo on the libuv pool.
const cacheable = new CacheableLookup({
  maxTtl: 60,          // never trust a record longer than 60s, even if TTL says 1 day
  errorTtl: 0.15,      // cache failures briefly so an outage doesn't hammer the resolver
  fallbackDuration: 0, // don't fall back to OS lookup forever after an error
});

// Patch the agents so every pooled connection uses the cached resolver.
cacheable.install(http.globalAgent);
cacheable.install(https.globalAgent);

// Also worth doing at process start (before any async work):
// UV_THREADPOOL_SIZE=16 node dist/main.js  -> fewer DNS-induced fs/crypto stalls`,
        },
        {
          language: 'yaml',
          title: 'Kubernetes: stop ndots:5 query amplification',
          code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  template:
    spec:
      dnsConfig:
        options:
          - name: ndots
            value: "2"               # 'api.stripe.com' now resolves directly
          - name: single-request-reopen # avoid the A/AAAA conntrack race (glibc)
      containers:
        - name: app
          image: orders-api:1.42.0
          env:
            - name: PAYMENTS_HOST
              value: "api.stripe.com." # trailing dot = FQDN, skips search list`,
        },
      ],
      keyPoints: [
        "DNS changes only affect new connections; pools need a max age.",
        "Node never caches DNS and resolves on the libuv threadpool.",
        "ndots:5 + no local cache can multiply external lookups ~8x.",
        "Lower TTLs well before a migration; negative answers are cached too.",
      ],
    },
    {
      heading: 'TCP: handshake, slow start, congestion control and head-of-line blocking',
      body: `**Intuition:** TCP gives you a reliable, ordered byte pipe — and pays for it with a handshake, a cautious ramp-up, and the rule that one lost packet stalls everything behind it.

**Handshake:** SYN → SYN-ACK → ACK costs 1 RTT before data. The server holds half-open connections in the SYN backlog and completed ones in the accept queue (\`somaxconn\`) — an overflowing accept queue shows up as connect latency spikes and client retransmits (1s, 3s).

**Slow start & congestion control:** the sender starts with an initial congestion window of **10 segments ≈ 14.6KB** (RFC 6928) and roughly doubles it every RTT until loss or ssthresh, then grows linearly (CUBIC) or paces by measured bandwidth (BBR). Consequences:
- A fresh connection cannot use your 10 Gbps link — a 1MB response needs ~7 RTTs.
- Linux resets cwnd after idle by default (\`tcp_slow_start_after_idle=1\`) — long-lived but bursty connections re-enter slow start. Disable it on servers doing bursty responses.
- **BBR** handles lossy long-haul links far better than CUBIC (loss isn't treated as congestion); pair it with the \`fq\` qdisc.

**Flow control:** throughput ≤ receive window / RTT. Window scaling allows windows up to 1GB; the **bandwidth-delay product** (BDP) tells you how big it must be (1 Gbps × 100ms = 12.5MB).

**Nagle + delayed ACK:** Nagle holds small writes until the previous one is ACKed; the peer's delayed ACK waits up to ~40ms → classic 40ms stalls on request/response protocols. Set \`TCP_NODELAY\` (Node's http server/client do this by default in modern versions; raw \`net\` sockets need \`socket.setNoDelay(true)\`).

**Head-of-line (HOL) blocking:** TCP delivers bytes in order. If segment 5 is lost, segments 6–50 sit in the kernel buffer until the retransmit arrives (≥1 RTT). Multiplexing many logical streams over one TCP connection (HTTP/2) means one loss stalls *all* of them — the main motivation for QUIC.`,
      code: [
        {
          language: 'bash',
          title: 'Server-side TCP tuning worth knowing (Linux)',
          code: `# Congestion control: BBR + fair-queue pacing (kernel >= 4.9)
sysctl -w net.core.default_qdisc=fq
sysctl -w net.ipv4.tcp_congestion_control=bbr

# Don't collapse cwnd back to initcwnd after an idle keep-alive period
sysctl -w net.ipv4.tcp_slow_start_after_idle=0

# Bigger accept queue for bursty connection storms (also set listen backlog)
sysctl -w net.core.somaxconn=4096
sysctl -w net.ipv4.tcp_max_syn_backlog=8192

# Observe: retransmits and accept-queue overflows
nstat -az TcpRetransSegs TcpExtListenOverflows TcpExtListenDrops
ss -ltn   # Recv-Q on a LISTEN socket = current accept-queue depth

# Inspect per-connection cwnd / rtt / retrans for a hot upstream
ss -tin dst 10.0.3.17:5432`,
        },
      ],
      keyPoints: [
        "initcwnd ≈ 14.6KB; ~doubles per RTT — cold connections are slow for big payloads.",
        "Throughput ≤ window / RTT; size windows to the bandwidth-delay product.",
        "One lost segment blocks every byte behind it — including other HTTP/2 streams.",
        "TCP_NODELAY avoids Nagle/delayed-ACK 40ms stalls.",
      ],
      source: 'High Performance Browser Networking — Ch 2 (Building Blocks of TCP)',
    },
    {
      heading: 'UDP: when "unreliable" is the right answer',
      body: `**Intuition:** UDP is a postcard — no handshake, no ordering, no retransmission, no congestion control. You get the lowest possible latency and take on every reliability decision yourself.

**Where UDP wins:**

| Use case | Why UDP |
|---|---|
| DNS | One small request/response; a retry is cheaper than a handshake |
| VoIP / WebRTC media / live video (RTP) | A late packet is useless — skip it rather than stall |
| Multiplayer game state | Newest snapshot wins; app-level sequence numbers discard stale ones |
| StatsD / telemetry | Fire-and-forget; never let metrics back-pressure the app |
| QUIC / HTTP/3 | Builds its own reliability, per stream, in user space |

**Mechanics you must handle:**
- **Packet size:** keep datagrams under the path MTU (1500 Ethernet minus headers ≈ 1472 bytes; ~1200 is the internet-safe value QUIC mandates). IP fragmentation means one lost fragment loses the whole datagram and many middleboxes drop fragments.
- **No congestion control:** a UDP flood can starve your own TCP traffic; well-behaved protocols (QUIC, WebRTC) implement congestion control themselves.
- **Silent loss:** \`send\` succeeds even when nobody is listening. Great for metrics, fatal for anything needing delivery.
- **NAT & firewalls:** UDP NAT bindings expire quickly (often 30s), so long-lived UDP flows need keep-alives; some corporate networks block UDP entirely.

**In interviews say:** "UDP when stale data is worthless and the app can tolerate or repair loss; otherwise TCP or QUIC, which gives me UDP's deployability with reliability per stream."`,
      code: [
        {
          language: 'typescript',
          title: 'Batched StatsD client over UDP (fire-and-forget, MTU-aware)',
          code: `import dgram from 'node:dgram';

const MAX_PAYLOAD = 1400; // stay under a 1500-byte MTU after IP/UDP headers
const socket = dgram.createSocket('udp4');
socket.unref(); // never keep the process alive just for metrics
socket.on('error', () => { /* swallow: metrics must never crash the app */ });

let buffer: string[] = [];
let size = 0;

export function increment(metric: string, value = 1): void {
  const line = metric + ':' + value + '|c';
  if (size + line.length + 1 > MAX_PAYLOAD) flush(); // one datagram per ~1.4KB
  buffer.push(line);
  size += line.length + 1;
}

function flush(): void {
  if (buffer.length === 0) return;
  const payload = Buffer.from(buffer.join('\\n'));
  buffer = [];
  size = 0;
  // No ACK, no retry: if the agent is down the packet is simply dropped.
  socket.send(payload, 8125, '127.0.0.1');
}

setInterval(flush, 1000).unref();`,
        },
      ],
      keyPoints: [
        "UDP when late data is worthless; you own ordering, loss and congestion.",
        "Keep datagrams ≤ ~1200–1400 bytes to avoid fragmentation.",
        "UDP send never tells you the receiver is gone.",
      ],
    },
    {
      heading: 'HTTP/1.1: keep-alive, the 6-connection limit and idle-timeout ordering',
      body: `**Intuition:** HTTP/1.1 is a single-lane road per connection: one request in flight at a time. Keep-alive lets you reuse the road; it doesn't add lanes.

**Mechanics:**
- Connections are **persistent by default** in 1.1 (\`Connection: close\` opts out). Reuse saves the TCP + TLS handshakes and keeps a warmed-up congestion window.
- **Pipelining** (sending request 2 before response 1) is in the spec but effectively dead: responses must return in order (HOL blocking at the HTTP layer) and many proxies mangled it.
- So browsers open **~6 connections per origin**, which led to domain sharding, sprites and bundling — all anti-patterns under HTTP/2.
- Server-to-server clients use **connection pools**: size ≈ RPS × latency (Little's Law). 2,000 RPS × 50ms ≈ 100 concurrent connections.

**The idle-timeout ordering rule** (the source of countless mystery 502s): every hop closes idle connections after some timeout. The side that sends the next request must always time out *first*:

**client pool idle < load balancer idle < upstream server keep-alive**

AWS ALB's idle timeout defaults to **60s**; Node's \`server.keepAliveTimeout\` defaults to **5s**. The server closes the socket at 5s, the ALB reuses it a millisecond later, gets a RST/FIN, and returns **502** — with nothing in your app logs.

**Node specifics:** Node 19+ enables keep-alive on the global agent; older code (and \`new https.Agent()\` without options) opens a fresh connection per request. \`fetch\`/undici pools and keeps alive by default.`,
      code: [
        {
          language: 'typescript',
          title: 'Shared keep-alive agent for an upstream (Node https)',
          code: `import https from 'node:https';

// ONE agent per upstream, created at module load — never per request.
export const paymentsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,  // TCP keep-alive probe initial delay on idle sockets
  maxSockets: 200,       // cap concurrency ~ RPS x latency with headroom
  maxFreeSockets: 50,    // idle sockets kept warm
  timeout: 30_000,       // close sockets idle this long (must be < upstream idle timeout)
  scheduling: 'lifo',    // reuse the hottest sockets; lets extras idle out
});

export function charge(body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: 'api.payments.example',
        path: '/v1/charges',
        method: 'POST',
        agent: paymentsAgent,
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(2_000), // end-to-end request deadline
      },
      (res) => {
        res.resume(); // MUST drain the body, or the socket never returns to the pool
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}`,
        },
      ],
      keyPoints: [
        "HTTP/1.1 = one in-flight request per connection; pipelining is unusable.",
        "Pool size ≈ RPS × latency (Little's Law) plus headroom.",
        "Idle timeouts: client < LB < server, or you get sporadic 502s.",
        "Undrained response bodies leak pooled sockets.",
      ],
    },
    {
      heading: 'HTTP/2: binary framing, multiplexing, HPACK and flow control',
      body: `**Intuition:** HTTP/2 turns one TCP connection into a multi-lane highway: many requests (streams) interleave as small frames, so there's no need for 6 connections or domain sharding.

**Mechanics:**
- **Binary framing:** every message is split into frames (HEADERS, DATA, SETTINGS, WINDOW_UPDATE, RST_STREAM, PING, GOAWAY) tagged with a **stream ID** (client-initiated streams are odd). Frames from different streams interleave freely.
- **Multiplexing:** \`SETTINGS_MAX_CONCURRENT_STREAMS\` (commonly 100–128) bounds in-flight requests per connection. One connection per origin is the norm.
- **HPACK header compression:** a 61-entry static table of common headers, a per-connection **dynamic table** (default 4KB) and Huffman coding. Repeated headers — a 1.5KB JWT, cookies, user-agent — shrink to a few bytes after the first request. (HTTP/2 avoids generic DEFLATE on headers because of the CRIME attack.)
- **Flow control:** per-stream and per-connection windows, initial **65,535 bytes**, replenished via WINDOW_UPDATE. On high-RTT links a small window caps throughput at window/RTT — a common cause of slow cross-region gRPC streams.
- **GOAWAY** enables graceful draining: the server announces the last stream it will process, and clients open a new connection for the rest — essential for zero-downtime deploys of gRPC services.
- **Server push** is effectively dead (Chrome removed it in 2022); prioritisation from RFC 7540 was deprecated in RFC 9113 in favour of the simpler RFC 9218 priority header.

**What HTTP/2 does *not* fix:** TCP head-of-line blocking. With 2%+ packet loss, one HTTP/2 connection can perform *worse* than six HTTP/1.1 connections, because a single loss stalls every stream and halves one shared congestion window.

**Operational gotchas:**
- Long-lived multiplexed connections defeat L4 load balancing — all of a client's requests pin to one backend (use L7 balancing or connection max-age).
- **Rapid Reset (CVE-2023-44487):** attackers open and immediately RST streams to bypass concurrency limits; keep proxies patched and rate-limit stream resets.`,
      code: [
        {
          language: 'typescript',
          title: 'Reusing one HTTP/2 session for many concurrent requests (node:http2)',
          code: `import http2 from 'node:http2';

// One session = one TCP+TLS connection carrying many streams.
let session: http2.ClientHttp2Session | undefined;

function getSession(): http2.ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session;
  session = http2.connect('https://inventory.internal:8443', {
    settings: { initialWindowSize: 4 * 1024 * 1024 }, // raise 64KB default for large bodies
  });
  session.on('goaway', () => { session = undefined; }); // server draining: reconnect lazily
  session.on('error', () => { session = undefined; });
  session.setTimeout(60_000, () => session?.close()); // idle sessions are closed
  return session;
}

export function getStock(sku: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = getSession().request({ ':method': 'GET', ':path': '/v1/stock/' + encodeURIComponent(sku) });
    stream.setTimeout(1_500, () => stream.close(http2.constants.NGHTTP2_CANCEL)); // RST_STREAM only this request
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => { data += chunk; });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
    stream.end();
  });
}`,
        },
      ],
      keyPoints: [
        "Streams multiplex on one TCP connection; no more 6-connection limit.",
        "HPACK dynamic table makes repeated big headers (JWTs, cookies) nearly free.",
        "Default 64KB flow-control window throttles high-BDP transfers.",
        "TCP HOL blocking remains; lossy networks can make h2 slower than h1.",
      ],
      source: 'Mastering API Architecture — Ch 1 (gRPC over HTTP/2)',
    },
    {
      heading: 'HTTP/3 and QUIC: fixing HOL blocking and surviving network changes',
      body: `**Intuition:** QUIC rebuilds TCP's reliability *per stream* on top of UDP, bakes TLS 1.3 into the handshake, and identifies a connection by an ID instead of an IP/port pair — so a lost packet only stalls its own stream, and your phone can switch from Wi-Fi to LTE without reconnecting.

**Mechanics (RFC 9000 / 9114):**
- **Transport in user space over UDP** — deployable through existing middleboxes and upgradable without kernel changes.
- **1-RTT handshake** combining transport + TLS 1.3; **0-RTT** on resumption (with replay caveats).
- **Independent streams:** loss recovery per stream — no cross-stream HOL blocking. Headers use **QPACK** (HPACK redesigned for out-of-order delivery).
- **Connection migration:** packets carry a Connection ID; when the client's IP/port changes, the connection continues after a path validation.
- Always encrypted, including most transport headers — middleboxes can't ossify it, but it's also harder to debug.

**Discovery:** clients first connect over TCP and learn about h3 via the \`Alt-Svc: h3=":443"\` response header, or up front via **DNS HTTPS (SVCB) records**. They race/fall back to TCP when UDP is blocked (a few percent of networks).

**Costs and gotchas:**
- **CPU:** user-space crypto + per-packet syscalls cost more than kernel TCP with offloads; GSO/GRO and \`sendmmsg\` narrow the gap.
- **Load balancing:** an L4 LB hashing the 5-tuple sends a migrated connection to the wrong backend. You need QUIC-aware LBs that route on Connection ID (e.g. encoding a server ID into it).
- **Observability:** tcpdump shows encrypted noise; rely on qlog and endpoint metrics.

**Where it wins:** mobile, high-RTT, lossy last-mile — Google and Cloudflare report meaningful tail-latency gains there. **Where it barely matters:** low-loss, sub-millisecond RTT data-centre traffic between services; stick to HTTP/2 (gRPC) internally.`,
      code: [
        {
          language: 'nginx',
          title: 'Serving HTTP/3 alongside HTTP/2 with safe 0-RTT (nginx ≥ 1.25)',
          code: `server {
    listen 443 quic reuseport;   # UDP listener for HTTP/3
    listen 443 ssl;              # TCP fallback for h2 / http/1.1
    http2 on;
    server_name api.example.com;

    ssl_certificate     /etc/ssl/api.example.com.ecdsa.pem;  # ECDSA: smaller chain
    ssl_certificate_key /etc/ssl/api.example.com.ecdsa.key;
    ssl_protocols TLSv1.3 TLSv1.2;
    ssl_early_data on;           # allow 0-RTT data

    # Advertise h3 so clients switch on their next connection (cache 24h)
    add_header Alt-Svc 'h3=":443"; ma=86400' always;

    location / {
        # Tell the upstream the request arrived as replayable early data
        proxy_set_header Early-Data $ssl_early_data;
        proxy_pass http://orders_upstream;
    }
}
# Upstream rule: if Early-Data == 1 and the request is not idempotent,
# respond 425 Too Early — the client retries after the full handshake.`,
        },
      ],
      keyPoints: [
        "Per-stream loss recovery removes TCP head-of-line blocking.",
        "Connection IDs allow migration — but only with QUIC-aware load balancing.",
        "Always keep a TCP fallback; some networks block UDP.",
        "Biggest wins on mobile/lossy/high-RTT paths, little inside a data centre.",
      ],
    },
    {
      heading: 'TLS 1.3: the 1-RTT handshake, resumption, 0-RTT and where to terminate',
      body: `**Intuition:** TLS 1.3 guesses the key exchange up front — the client sends its key share in the very first message — so the handshake finishes in one round trip, and it deleted every legacy option that used to cause breaches.

**Handshake:** ClientHello (supported ciphers + ECDHE key share, e.g. X25519) → ServerHello + EncryptedExtensions + Certificate + CertificateVerify + Finished in one flight → client Finished + first request. **1 RTT** vs 2 for TLS 1.2.

**What 1.3 removed:** static RSA key exchange (so **forward secrecy is mandatory**), CBC modes, RC4, SHA-1 signatures, compression and renegotiation. Five AEAD-based cipher suites remain.

**Resumption:** the server issues session tickets (PSKs); a returning client resumes without a full certificate exchange. With **0-RTT early data** the client sends the request in its first flight — but early data **can be replayed** by an attacker and has weaker forward secrecy, so only accept it for idempotent requests. For multi-node fleets, ticket-encryption keys must be shared and rotated across servers or resumption rates collapse.

**Handshake size matters:** a large RSA certificate chain (4–6KB) can exceed the server's initial congestion window and cost an extra RTT. ECDSA certs, short chains and **OCSP stapling** (server attaches revocation proof so the client needn't call the CA) keep the first flight small.

**Where to terminate TLS:**

| Option | Pros | Cons |
|---|---|---|
| Edge/CDN POP | Handshake RTT to user is short (~10–20ms), WAF, DDoS absorption | Traffic decrypted at a third party |
| Load balancer | Central cert management, L7 routing | LB→service plaintext unless re-encrypted |
| Re-encrypt / mTLS to pods (mesh) | Zero-trust, service identity | Cert rotation, CPU, debugging |
| Passthrough (L4) | End-to-end, LB never sees keys | No L7 routing, each service manages certs |

The common production pattern: terminate at edge/LB for public traffic, **mTLS inside the cluster** (service mesh issues short-lived certs). Crypto cost is rarely the bottleneck on modern CPUs with AES-NI — handshake *rate* (new connections/s) is, so again: reuse connections.`,
      diagram: `TLS 1.2 (2 RTT)                      TLS 1.3 (1 RTT)
C: ClientHello          ->           C: ClientHello + key_share   ->
S: ServerHello, Cert,                S: ServerHello + key_share,
   ServerKeyExchange,   <-              {EncryptedExt, Cert,
   ServerHelloDone                       CertVerify, Finished}   <-
C: ClientKeyExchange,                C: {Finished} + GET /orders  ->
   ChangeCipherSpec,                 S: 200 OK                    <-
   Finished             ->
S: ChangeCipherSpec,                 0-RTT resumption:
   Finished             <-           C: ClientHello + PSK + early
C: GET /orders          ->              data (GET /orders)        ->
S: 200 OK               <-           S: ServerHello..Fin + 200 OK <-`,
      code: [
        {
          language: 'nginx',
          title: 'Modern TLS termination block',
          code: `ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;   # TLS 1.3 clients pick; all 1.3 suites are AEAD
ssl_ecdh_curve X25519:prime256v1;

# Resumption: shared cache + tickets. Rotate ticket keys (e.g. every 12h)
# across ALL nodes, or clients hitting another node do a full handshake.
ssl_session_cache shared:TLS:50m;   # ~200K sessions
ssl_session_timeout 1d;
ssl_session_tickets on;
ssl_session_ticket_key /etc/nginx/tickets/current.key;
ssl_session_ticket_key /etc/nginx/tickets/previous.key;  # still accepted for decryption

# OCSP stapling: no client round trip to the CA
ssl_stapling on;
ssl_stapling_verify on;
resolver 10.0.0.2 valid=60s;

add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;`,
        },
      ],
      keyPoints: [
        "TLS 1.3 = 1 RTT, mandatory forward secrecy, only AEAD ciphers.",
        "0-RTT early data is replayable: idempotent requests only.",
        "Share and rotate session-ticket keys across the fleet.",
        "Terminate at the edge for latency; mTLS internally for zero trust.",
      ],
      source: 'RFC 8446; Mastering API Architecture — Ch 7 (transport security)',
    },
    {
      heading: 'Connection management at scale: pools, ephemeral ports and TIME_WAIT',
      body: `**Intuition:** a TCP connection is identified by the 4-tuple (src IP, src port, dst IP, dst port). When you talk to one destination, the only thing that varies is your source port — and you have a limited number of them, each held hostage for a minute after you close it.

**Ephemeral ports:** Linux's default \`ip_local_port_range\` is 32768–60999 = **28,232 ports** per (src IP, dst IP, dst port). Exceed it and \`connect()\` fails with **EADDRNOTAVAIL**.

**TIME_WAIT:** the side that closes first (the *active closer*) keeps the socket in TIME_WAIT for 2×MSL — fixed at **60s** on Linux — so delayed packets from the old connection can't corrupt a new one with the same 4-tuple. So a client opening a fresh connection per request can sustain only about 28,232 / 60 ≈ **470 new connections/s** to a single destination.

**Where this bites:**
- Services calling a partner API or a single DB proxy IP **without keep-alive**.
- **NAT gateways:** every pod behind a NAT shares its public IP; AWS NAT Gateway allows ~55,000 simultaneous connections per unique destination (IP:port) and reports \`ErrorPortAllocation\` when it runs out.
- Servers that close connections themselves (e.g. \`Connection: close\` responses) accumulate TIME_WAIT on the *server* side instead — mostly harmless for listening sockets but a memory/visibility cost.

**Fixes, in order of preference:**
1. **Reuse connections** (keep-alive pools, HTTP/2). Pool size ≈ RPS × latency; this drops churn to near zero.
2. Widen \`ip_local_port_range\` (e.g. 10240–65535) and add source IPs or destination IPs.
3. \`net.ipv4.tcp_tw_reuse=1\` — safe for *outgoing* connections (relies on TCP timestamps). Never \`tcp_tw_recycle\` (broke clients behind NAT; removed in Linux 4.12).
4. Avoid \`SO_LINGER\` with 0 timeout (RST on close) except in very controlled cases.

**Connection lifecycle hygiene:** enforce a **max connection age** (e.g. 5–10 min) so pools pick up DNS changes and rebalance across new backends; drain gracefully on deploy (stop accepting, send \`Connection: close\` / HTTP/2 GOAWAY, finish in-flight requests); budget file descriptors (\`ulimit -n\`) for peak connections.`,
      code: [
        {
          language: 'bash',
          title: 'Diagnosing port exhaustion and connection churn',
          code: `# Summary of socket states — a huge 'timewait' count is the smoking gun
ss -s

# TIME_WAIT sockets towards one upstream (e.g. a partner API on 443)
ss -tan state time-wait dst 203.0.113.10 | wc -l

# Current ephemeral range (default 32768 60999 -> 28,232 ports)
sysctl net.ipv4.ip_local_port_range

# New connections per second being opened (watch SYN rate)
nstat -az TcpActiveOpens; sleep 1; nstat -az TcpActiveOpens

# Mitigations (after fixing keep-alive in the app!)
sysctl -w net.ipv4.ip_local_port_range="10240 65535"
sysctl -w net.ipv4.tcp_tw_reuse=1   # outgoing connections only; needs timestamps

# File descriptor budget for the process
cat /proc/$(pgrep -f 'node dist/main.js')/limits | grep 'open files'`,
        },
      ],
      keyPoints: [
        "28,232 default ephemeral ports per destination; TIME_WAIT is 60s on Linux.",
        "No keep-alive → ~470 new conns/s ceiling to one destination.",
        "NAT gateways share the port budget across every pod behind them.",
        "tcp_tw_reuse is fine for outbound; tcp_tw_recycle is gone for a reason.",
        "Max connection age makes pools honour DNS changes and rebalance.",
      ],
    },
    {
      heading: 'Choosing protocols and what to say in the interview',
      body: `**Intuition:** pick the protocol for the *path*, not the whole system — the last mile to a phone and the 0.3ms hop between two pods have opposite problems.

| Concern | HTTP/1.1 | HTTP/2 | HTTP/3 (QUIC) |
|---|---|---|---|
| Transport | TCP | TCP | UDP (QUIC) |
| Concurrency per connection | 1 in-flight request | ~100 streams | ~100 streams |
| HOL blocking | HTTP + TCP level | TCP level | None across streams |
| Header compression | None | HPACK | QPACK |
| Handshake (cold, with TLS 1.3) | 2 RTT | 2 RTT | 1 RTT (0 on resume) |
| Connection migration | No | No | Yes (Connection ID) |
| Best fit | Simple clients, legacy, debugging | Service-to-service, gRPC, browsers | Mobile/lossy/high-RTT public edge |
| Pain points | Connection count | L4 LB pinning, TCP loss sensitivity | UDP blocking, CPU, LB routing, tooling |

**A strong default architecture:**
- **Public edge:** HTTP/3 + HTTP/2 fallback, TLS 1.3, termination at CDN/edge POPs near users, session resumption enabled.
- **Edge → origin:** long-lived, pooled HTTP/2 or HTTP/1.1 keep-alive connections (already warm, no slow start).
- **Internal:** gRPC over HTTP/2 with mTLS via the mesh; L7 load balancing; connection max-age.
- **DNS:** low TTLs on failover records, local DNS caching per node, \`ndots\` tuned, pools with max age.

**Phrases that signal seniority:**
- "DNS only moves new connections; I'd bound connection age so cutovers converge."
- "HTTP/2 fixes HTTP-level HOL but not TCP-level; on lossy mobile links that's why we'd add HTTP/3."
- "Our 502s are an idle-timeout ordering problem, not an application bug."
- "Port exhaustion is a connection-reuse bug first and a sysctl problem second."`,
      keyPoints: [
        "Different hops need different protocols: h3 at the edge, h2/gRPC inside.",
        "Always explain what each upgrade does NOT fix.",
        "Tie protocol choices to measured RTT, loss rate and connection churn.",
      ],
      source: 'Mastering API Architecture — Ch 1',
    },
  ],
  codeChallenges: [
    {
      id: 'net-protocols-cc-1',
      title: 'The FX-rates client that exhausts ports and hangs forever',
      context: `A NestJS pricing service calls a partner FX-rates API on every checkout (~1,500 RPS at peak across 12 pods behind one NAT gateway). During sales, calls start failing with \`EADDRNOTAVAIL\` and \`ETIMEDOUT\`, the NAT gateway reports \`ErrorPortAllocation\`, p99 checkout latency goes to 30s, and one pod crashed with an uncaught \`SyntaxError\`. After the partner moved to a new IP last month, some pods kept calling the old one for hours.`,
      task: 'Rewrite the client so it reuses connections safely, bounds every wait, never leaks sockets or crashes the process, and picks up DNS changes within minutes.',
      starter: {
        language: 'typescript',
        title: 'fx-client.ts (starter)',
        code: `import https from 'node:https';

export interface Rates { base: string; rates: Record<string, number>; }

export function getRates(currency: string): Promise<Rates> {
  // Fresh agent per call "to avoid stale connections"
  const agent = new https.Agent();
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: 'fx.partner.example', path: '/v2/rates?base=' + currency, agent },
      (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error('fx status ' + res.statusCode));
        }
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve(JSON.parse(raw)));
      },
    );
    req.on('error', reject);
    req.end();
  });
}`,
      },
      hints: [
        'What happens to the TCP connection (and its source port) when a per-call agent is garbage collected? Who is the active closer, and for how long does the port stay unusable?',
        'List every place this code can wait indefinitely, and every path where the response body is never consumed.',
        'Pooled connections never re-resolve DNS. How can you make a pool retire sockets after a maximum age without giving up keep-alive?',
      ],
      solution: {
        language: 'typescript',
        title: 'fx-client.ts (solution)',
        code: `import https from 'node:https';
import type { Duplex } from 'node:stream';

export interface Rates { base: string; rates: Record<string, number>; }

const MAX_SOCKET_AGE_MS = 5 * 60_000; // retire sockets so DNS changes converge in ~5 min
const born = new WeakMap<Duplex, number>();

// Keep-alive agent that refuses to pool sockets older than MAX_SOCKET_AGE_MS.
class MaxAgeAgent extends https.Agent {
  keepSocketAlive(socket: Duplex): boolean {
    const createdAt = born.get(socket) ?? Date.now();
    born.set(socket, createdAt);
    if (Date.now() - createdAt > MAX_SOCKET_AGE_MS) return false; // close instead of pooling
    return (https.Agent.prototype as any).keepSocketAlive.call(this, socket) !== false;
  }
}

// ONE agent per upstream for the process lifetime.
const fxAgent = new MaxAgeAgent({
  keepAlive: true,
  maxSockets: 64,        // ~ (1500 RPS / 12 pods) x 150ms p99 ~ 19 -> 3x headroom
  maxFreeSockets: 16,
  timeout: 20_000,       // idle sockets closed before the partner's (typ. 60s) idle timeout
  scheduling: 'lifo',
});

export function getRates(currency: string): Promise<Rates> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: 'fx.partner.example',
        path: '/v2/rates?base=' + encodeURIComponent(currency),
        agent: fxAgent,
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(800), // total deadline: connect + TLS + response
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c)); // always consume the body
        res.on('error', reject);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error('fx status ' + res.statusCode)); // socket already returned to pool
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Rates);
          } catch (err) {
            reject(err); // never throw inside an event handler
          }
        });
      },
    );
    req.on('error', reject); // includes AbortError from the deadline
    req.end();
  });
}`,
      },
      explanation: `**What was wrong and how each fix addresses it:**

- **Agent per call → no reuse.** Every call paid DNS + TCP + TLS (≈3 RTTs) and the client, as active closer, left a socket in **TIME_WAIT for 60s**. At 1,500 RPS that's ~90,000 ports held — far beyond the 28,232-port range per destination and the NAT gateway's ~55,000 per-destination limit, hence \`EADDRNOTAVAIL\` / \`ErrorPortAllocation\`. A single module-level keep-alive agent drops connection churn to near zero.
- **No deadline.** A blackholed SYN or a stalled server hung requests for the OS connect timeout (often 2+ minutes). \`AbortSignal.timeout(800)\` bounds connect + TLS + response.
- **Undrained non-200 bodies.** Rejecting without consuming the body keeps the socket busy forever — a slow socket leak that eventually hits \`maxSockets\` and queues every request. The solution always reads to \`end\`.
- **\`JSON.parse\` inside an event handler** threw an uncaught exception and crashed the pod on an HTML error page. It is now wrapped and turned into a rejection.
- **Pools never re-resolve DNS.** The \`MaxAgeAgent\` refuses to re-pool sockets older than 5 minutes, so new connections resolve the partner's current IP and the fleet converges after a DNS change.
- **Bounded pool.** \`maxSockets\` is sized with Little's Law (RPS × latency) plus headroom, so a partner slowdown queues locally instead of opening thousands of connections. Idle \`timeout\` is shorter than the partner's idle timeout, respecting the client < server ordering rule.
- Bonus: \`encodeURIComponent\` prevents query injection via the currency parameter.`,
      followUps: [
        {
          "q": "The partner now responds slowly (2 s p99) for 10 minutes. With your 800 ms deadline and 64-socket pool, what does checkout experience, and should you add a fallback?",
          "a": "Calls slower than 800 ms abort, so checkout gets rate failures quickly instead of hanging. The pool caps outstanding requests at 64 per pod, and excess requests queue in the agent but still time out at 800 ms because the signal covers queue time. Add a fallback: cache the last good rates per currency (refresh every 30 s in the background) and serve the cached value, marked as stale, if it's within an allowed age, say 5 minutes, since FX rates change slowly. Add a circuit breaker so a sustained slowdown stops sending requests and doesn't burn the partner's quota."
        },
        {
          "q": "How would you test this client for socket leaks and DNS convergence before production?",
          "a": "Use a local mock HTTPS server (or Toxiproxy in front of it). Leak test: return 500 with an HTML body 10,000 times, then assert `fxAgent.sockets` and `freeSockets` counts stay at or below the configured limits and no requests queue indefinitely. Deadline test: blackhole the port and assert rejection at about 800 ms with an AbortError. Crash test: return invalid JSON and assert a rejection, not an uncaught exception. DNS test: point the hostname at server A, run load, switch the DNS (or /etc/hosts in the container) to server B, and assert all traffic moves to B within MAX_SOCKET_AGE_MS plus some slack. Run a soak at 2× peak and watch TIME_WAIT counts with `ss -s`."
        }
      ],
    },
    {
      id: 'net-protocols-cc-2',
      title: 'Mystery 502s behind the ALB and dropped requests on every deploy',
      context: `A NestJS API runs on ECS behind an AWS ALB (idle timeout 60s). Dashboards show a steady ~0.1% of 502s on the ALB with no matching errors in application logs, plus a spike of 502/503s during each rolling deploy. The bootstrap file is below.`,
      task: 'Fix the server so the ALB never reuses a connection the app has already closed, and so deploys drain in-flight requests instead of cutting them off.',
      starter: {
        language: 'typescript',
        title: 'main.ts (starter)',
        code: `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);

  process.on('SIGTERM', () => {
    console.log('shutting down');
    process.exit(0);
  });
}
bootstrap();`,
      },
      hints: [
        "Compare Node's default server keep-alive timeout with the ALB's idle timeout. Which side closes an idle connection first, and what does the ALB see if it sends a request at that moment?",
        'Node has more than one server-side timeout; changing one can make another fire first.',
        'On SIGTERM, what should happen to the listener, to idle keep-alive sockets, and to in-flight requests — and in what order relative to the load balancer deregistering the task?',
      ],
      solution: {
        language: 'typescript',
        title: 'main.ts (solution)',
        code: `import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { AppModule } from './app.module';

const LB_IDLE_TIMEOUT_MS = 60_000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const server = app.getHttpServer() as Server;

  // Upstream must outlive the LB's idle timeout: LB closes idle conns first.
  server.keepAliveTimeout = LB_IDLE_TIMEOUT_MS + 5_000;  // 65s (Node default is 5s)
  server.headersTimeout = LB_IDLE_TIMEOUT_MS + 6_000;    // must exceed keepAliveTimeout
  server.requestTimeout = 30_000;                        // bound slow/abusive requests

  let shuttingDown = false;
  app.use((req: any, res: any, next: () => void) => {
    if (shuttingDown) res.setHeader('Connection', 'close'); // stop reuse of this socket
    next();
  });

  await app.listen(3000);

  process.once('SIGTERM', async () => {
    shuttingDown = true;           // readiness probe/health check should now fail
    await sleep(15_000);           // let the ALB deregister the target (deregistration delay)
    server.close(() => process.exit(0)); // stop accepting; wait for in-flight requests
    server.closeIdleConnections(); // drop idle keep-alive sockets immediately (Node >= 18.2)
    setTimeout(() => {             // hard cap so a stuck request can't block the deploy
      server.closeAllConnections();
      process.exit(1);
    }, 25_000).unref();
  });
}
bootstrap();`,
      },
      explanation: `**Root cause of the steady 502s:** Node's \`keepAliveTimeout\` defaults to **5s**, the ALB's idle timeout is **60s**. After 5s of idleness Node closes the socket; the ALB still believes it's reusable, sends the next request into it, receives a FIN/RST and returns **502** — the request never reached Nest, so nothing is logged. Setting \`keepAliveTimeout\` above the LB idle timeout (65s) makes the **LB** the side that closes idle connections, which is always safe because the LB is also the side that initiates requests.

**\`headersTimeout\` must be greater than \`keepAliveTimeout\`,** otherwise a reused socket can be killed by the headers timer while waiting for the next request (a well-known Node footgun). \`requestTimeout\` bounds slowloris-style requests.

**Deploy 502/503s:** \`process.exit(0)\` on SIGTERM killed in-flight requests and closed keep-alive sockets the ALB was about to use. The graceful sequence is:
1. Mark unhealthy and keep serving while the ALB deregisters the target (wait ≥ the time it takes health checks/deregistration to take effect).
2. Send \`Connection: close\` on responses so clients stop reusing sockets.
3. \`server.close()\` to stop accepting and wait for in-flight requests; \`closeIdleConnections()\` to drop idle keep-alive sockets immediately.
4. A hard timeout with \`closeAllConnections()\` so one stuck request cannot block the rollout forever. (For HTTP/2/gRPC servers the equivalent is sending GOAWAY.)`,
      followUps: [
        {
          "q": "The service also handles WebSocket connections that live for hours. How does your SIGTERM sequence handle them?",
          "a": "`server.close()` waits forever for upgraded sockets, so the 25 s hard cap would kill them abruptly. Handle them explicitly: on SIGTERM, after deregistration, send each WebSocket a close frame with code 1012 (service restart) or a custom 'reconnect' message, so clients reconnect with jittered backoff to other targets. Spread the closes over a few seconds to avoid a reconnect stampede. Then close what remains at the hard cap. Set the ALB deregistration delay to cover the drain. Clients must resume from a last-seen message id so nothing is lost across the reconnect."
        },
        {
          "q": "The same app moves behind an nginx sidecar (keepalive_timeout 75 s upstream) in front of Node. Do your timeout values still hold?",
          "a": "The rule is that each server must keep idle connections longer than the client in front of it. Now there are two hops: ALB (60 s) to nginx, and nginx to Node. nginx's client-side `keepalive_timeout` must exceed 60 s (75 s works). Node's `keepAliveTimeout` must exceed nginx's upstream keepalive idle timeout (the `keepalive_timeout` inside the upstream block, default 60 s), so 65 s still works only if that stays at 60 s. If someone sets nginx's upstream idle to 75 s, Node needs over 75 s, or the 502s reappear on the inner hop. Document the chain and add a startup assertion or config test."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'net-protocols-iq-01',
      difficulty: 'hard',
      question:
        'A user in Mumbai opens our app and the first API call to https://api.example.com/orders takes 1.2s, while subsequent calls take 180ms. Walk me through where that first second goes and how you would cut it.',
      context: 'Origin is in us-east-1 (~220ms RTT from Mumbai). Mobile network, TLS 1.2, HTTP/1.1, no CDN.',
      whatInterviewerLooksFor: [
        'RTT-level accounting of DNS, TCP, TLS and request, not vague "network is slow"',
        'Knows TLS 1.2 vs 1.3 handshake RTTs and slow-start effects on response size',
        'Proposes shortening RTT (edge termination) as well as reducing RTT count',
        'Mentions connection reuse / warm pools edge→origin',
      ],
      modelAnswer: `### Account for the round trips
With a ~220ms RTT, the cold path is roughly:
- **DNS**: cache miss through the mobile carrier's resolver: 50–200ms.
- **TCP handshake**: 1 RTT ≈ 220ms.
- **TLS 1.2**: 2 RTTs ≈ 440ms.
- **Request/response**: 1 RTT ≈ 220ms + server time (~50ms). If the body is > ~14KB, slow start adds RTTs.

That's ~1.0–1.2s. The warm call is 1 RTT + server time ≈ 180–270ms, which matches: **the gap is almost entirely handshakes.**

### Cut the number of round trips
- **TLS 1.3** saves 1 RTT (≈220ms); session resumption and **0-RTT** for idempotent GETs save more on repeat visits.
- **HTTP/3 (QUIC)** merges transport + TLS into 1 RTT and handles mobile loss/network switches better.
- Keep the connection alive in the app (shared client, HTTP/2 so one connection carries everything) and **pre-connect** at app start.
- Lower DNS cost: long TTL on the edge hostname, DNS prefetch, HTTPS/SVCB records to discover h3 up front.

### Cut the length of each round trip
The biggest win: **terminate TLS at an edge POP in Mumbai** (RTT ~15–25ms). Handshakes now cost ~50ms total; the POP forwards over an already-warm, pooled, large-cwnd connection to us-east-1, paying just one 220ms RTT for the request. Cold latency drops from ~1.2s to roughly 350ms.

### Beyond that
- Keep the first response small (pagination, compression) so it fits in the initial congestion windows.
- Use ECDSA certificates and OCSP stapling to keep the TLS first flight small.
- Long term, serve read-heavy data from an Asia-region replica so even the request RTT is short.

**Trade-off:** edge termination means traffic is decrypted at the CDN; for regulated payloads you'd re-encrypt edge→origin with mTLS.`,
      followUps: [
        { q: 'Why not just enable 0-RTT for everything?', a: 'Early data is replayable by an on-path attacker. A replayed POST /orders could create a duplicate order. Accept 0-RTT only for safe/idempotent methods or requests carrying idempotency keys, and have the edge return 425 Too Early otherwise.' },
        { q: 'The response is 400KB. What else changes?', a: 'Slow start dominates: with initcwnd ≈ 14.6KB, 400KB needs ~5 RTTs on a fresh connection. Warm edge→origin connections have a large cwnd, and the client↔edge RTT is short, so slow-start rounds are cheap. Also compress (brotli/gzip) and paginate.' },
        { q: 'How would you verify where time is actually spent?', a: 'Client-side timing (Resource Timing / OkHttp EventListener: dns, connect, secureConnect, ttfb), server-side timing headers, and comparing cold vs warm percentiles from RUM data segmented by network type.' },
      ],
      pitfalls: [
        'Blaming bandwidth or payload size for a small-response latency problem',
        'Suggesting "add more servers" when the server time is 50ms',
        'Enabling 0-RTT without mentioning replay risk',
        'Forgetting that TLS 1.2 is 2 RTTs, not 1',
      ],
    },
    {
      id: 'net-protocols-iq-02',
      difficulty: 'hard',
      question:
        'We moved api.internal from an old load balancer to a new one by changing the DNS record (TTL 60s). Two hours later, 30% of traffic still hits the old LB. Why, and how do you run DNS-based cutovers safely?',
      whatInterviewerLooksFor: [
        'Understands DNS is only consulted on new connections',
        'Names client-side caching behaviours (JVM, Node none, OS, resolver TTL floors)',
        'Proposes max connection age, draining and monitoring rather than "lower the TTL"',
        'Plans rollback and lowering TTL in advance',
      ],
      modelAnswer: `### Why traffic is stuck
1. **Long-lived connections never re-resolve.** Keep-alive pools, HTTP/2 and gRPC channels resolved the name once and happily reuse those connections for hours. DNS only affects *new* connections. This is almost always the main cause.
2. **Client DNS caches that ignore TTL.** Older JVMs with a security manager cached forever; some libraries resolve once at startup (a DB driver given a hostname, a service that stores the IP in config); some resolvers enforce a minimum TTL.
3. **The old TTL was long.** If the record previously had a 1-day TTL, caches that fetched it just before the change keep it for up to a day — lowering the TTL at cutover time is too late.
4. **Negative caching / stale resolvers** in some sites.

### How to cut over safely
- **Days before:** lower the TTL to 30–60s and wait at least one old-TTL period.
- **Bound connection lifetime** on clients and servers: max connection age of 5–10 minutes (pool setting, gRPC \`MAX_CONNECTION_AGE\`, or the server sending \`Connection: close\`/GOAWAY periodically). This guarantees convergence within minutes.
- **Drain the old LB** actively: once the new one is healthy, have the old LB or its backends close idle connections and return \`Connection: close\`, so clients reconnect and re-resolve.
- **Keep both paths healthy** until old-LB traffic reaches ~0 — monitor per-LB request counts and top client IPs to find stragglers that pin IPs.
- **Rollback plan:** flip the record back; with low TTL and bounded connection age it converges just as fast.

### Better alternatives
For internal services, avoid DNS as the switching mechanism: use weighted routing in the LB/service mesh, or keep a stable VIP/hostname and swap the target groups behind it — changes then take effect per request, not per DNS cache.`,
      followUps: [
        { q: 'The stragglers are all Java services. What do you check?', a: 'networkaddress.cache.ttl / sun.net.inetaddr.ttl in java.security or system properties, whether a security manager is set (historical infinite caching), and connection pool settings like HikariCP maxLifetime or HTTP client connection TTL.' },
        { q: 'Why not set TTL to 1 second permanently?', a: 'Every new connection pays a lookup; resolver load and lookup latency go up, many resolvers clamp tiny TTLs anyway, and an authoritative DNS outage then hurts immediately instead of being masked by caches.' },
        { q: 'How does this interact with a service mesh?', a: 'Envoy resolves endpoints via EDS (or STRICT_DNS clusters with their own refresh rate) and load-balances per request, so shifting traffic is a control-plane config change; DNS TTL matters much less.' },
      ],
      pitfalls: [
        'Assuming TTL 60s means all clients move within 60s',
        'Only suggesting to lower the TTL further',
        'Ignoring connection pooling and HTTP/2 connection lifetime',
        'Shutting down the old LB before its traffic reaches zero',
      ],
    },
    {
      id: 'net-protocols-iq-03',
      difficulty: 'expert',
      question:
        'Our Node/NestJS service behind an AWS ALB shows a constant ~0.1% rate of 502 Bad Gateway, and none of those requests appear in our application logs. How do you debug this?',
      whatInterviewerLooksFor: [
        'Identifies keep-alive idle timeout mismatch as the prime suspect',
        'Uses LB access logs / metrics to distinguish target reset from target timeout',
        'Knows Node defaults (keepAliveTimeout 5s) and headersTimeout interplay',
        'Covers deploy-time draining as a second source',
      ],
      modelAnswer: `### Reason from the symptom
A 502 that never reaches the app means the LB failed **at the connection level** — the upstream closed or reset the TCP connection the LB was using. Low, constant rate + no app logs is the fingerprint of an **idle-timeout race**.

### The likely mechanism
- The ALB keeps pooled connections to targets and considers them idle-closable after its **idle timeout (60s default)**.
- Node's \`server.keepAliveTimeout\` defaults to **5s**. After 5s of idleness Node sends FIN.
- If the ALB picks that connection for a new request in the same instant, the request hits a closing socket → RST → **502**. The busier the service, the more idle-at-5s sockets race, so it's a steady fraction.

### Confirm with data
- ALB access logs: \`target_status_code\` is "-" and \`elb_status_code\` 502, with very small \`request_processing_time\` and target processing time -1.
- CloudWatch: \`HTTPCode_ELB_502_Count\` vs \`HTTPCode_Target_5XX_Count\` (target 5xx would be in app logs), and \`TargetConnectionErrorCount\`.
- A packet capture on a target shows the app sending FIN ~5s after the last response, followed by an incoming request and RST.

### Fix
- \`server.keepAliveTimeout = 65_000\` (greater than the LB idle timeout) so the **LB always closes first** — it's the side that initiates requests, so closing is race-free.
- \`server.headersTimeout\` must be larger than \`keepAliveTimeout\` (e.g. 66s), or a reused socket can be killed while waiting for the next request's headers.
- The same rule applies to every hop: client pool idle < proxy idle < upstream keep-alive (nginx \`keepalive_timeout\`, Envoy \`idle_timeout\`).

### Rule out the second source
If 502s spike during deploys, it's shutdown: the app exits while the ALB still routes to it. Fix with graceful draining — fail readiness, wait for deregistration delay, \`server.close()\`, close idle connections, hard timeout.`,
      followUps: [
        { q: 'Why is it safe for the LB to close first but not the server?', a: 'Only the side that sends requests knows whether a request is about to be written. If the client closes an idle socket, no request is in flight. If the server closes, a request may already be in the pipe, so it arrives on a dead socket.' },
        { q: 'Could retries hide this?', a: 'Some proxies (Envoy, nginx for idempotent methods) retry on connection reset, which masks it for GETs but not for POSTs. Fix the ordering instead of relying on retries of non-idempotent requests.' },
        { q: 'What if the 502s correlate with large uploads instead?', a: 'Then look at request body timeouts, requestTimeout/headersTimeout, payload limits closing the connection mid-upload, or the app crashing/OOMing — those usually show target resets with non-trivial processing times.' },
      ],
      pitfalls: [
        'Adding retries in the client and calling it fixed',
        'Increasing the ALB idle timeout above the server keep-alive (makes it worse)',
        'Only looking at application logs',
        'Setting keepAliveTimeout without adjusting headersTimeout',
      ],
    },
    {
      id: 'net-protocols-iq-04',
      difficulty: 'expert',
      question:
        'Product wants us to enable HTTP/3 across our public API and internal services because "it is faster". What is your recommendation?',
      whatInterviewerLooksFor: [
        'Explains precisely what QUIC fixes (TCP HOL, handshake RTT, migration) and for which networks',
        'Knows the costs: UDP blocking/fallback, CPU, LB routing on connection IDs, observability',
        'Distinguishes edge from data-centre traffic',
        'Proposes a measured rollout with success metrics',
      ],
      modelAnswer: `### What HTTP/3 actually improves
- **Handshake:** transport + TLS 1.3 in 1 RTT (0-RTT on resumption) vs 2 RTT for TCP + TLS 1.3.
- **No cross-stream head-of-line blocking:** a lost packet stalls only its stream, unlike HTTP/2 over TCP where one loss stalls all streams.
- **Connection migration:** the connection ID survives Wi-Fi → LTE switches, so mobile clients don't reconnect.

All three matter most on **high-RTT, lossy, mobile last-mile** networks — where Google/Cloudflare measure real p95/p99 gains. Inside a data centre (RTT ~0.2–0.5ms, near-zero loss, long-lived pooled connections) the benefit is close to nil.

### What it costs
- **Fallback required:** some networks block or throttle UDP/443, so clients race TCP and we must keep HTTP/2 working. Discovery via Alt-Svc means the *first* connection is still TCP unless we publish DNS HTTPS records.
- **CPU:** user-space QUIC with per-packet crypto is more expensive than kernel TCP with TSO; plan for more edge capacity (GSO/GRO help).
- **Load balancing:** 5-tuple L4 hashing breaks migration and can misroute packets; we need QUIC-aware LBs routing on connection IDs — or let the CDN handle it.
- **Tooling/security:** encrypted transport headers make tcpdump-based debugging and some DDoS tooling less useful; need qlog and new metrics.
- **0-RTT replay** must be restricted to idempotent requests.

### Recommendation
1. **Enable HTTP/3 at the CDN/edge** for public, mobile-heavy traffic — the CDN already solves LB routing, fallback and DDoS. Origin stays on HTTP/2 over warm pooled connections.
2. **Keep internal service-to-service on HTTP/2 (gRPC)** with mTLS — mature tooling, kernel TCP efficiency, negligible gain from QUIC.
3. **Roll out as an experiment:** a percentage of users, compare p50/p95/p99 time-to-first-byte and error rates split by network type and country, and watch h3 vs h2 connection ratios for fallback rates.
4. Revisit internal use only if a concrete problem (e.g. cross-region lossy links) shows up.`,
      followUps: [
        { q: 'Our clients are server-to-server integrations over the internet from partners. Does that change anything?', a: 'Partners usually have stable, low-loss connections and long-lived pools, so gains are small; many HTTP client libraries also have limited h3 support. Offer it at the edge but do not require it.' },
        { q: 'How does a QUIC-aware load balancer route packets after migration?', a: 'The server encodes a routing token (server ID) in the connection IDs it issues; the LB decodes the destination connection ID of each packet and forwards to that server regardless of the source IP/port.' },
        { q: 'Would HTTP/3 fix our slow gRPC streams between regions?', a: 'Probably not the root cause: cross-region slowness is usually flow-control windows smaller than the bandwidth-delay product or TCP congestion behaviour. Tune HTTP/2 windows/BBR first; QUIC only helps if loss is significant.' },
      ],
      pitfalls: [
        'Saying HTTP/3 is uniformly faster without naming conditions',
        'Forgetting the TCP fallback and UDP blocking',
        'Ignoring load balancer and CPU implications',
        'Recommending it internally for low-latency DC traffic',
      ],
    },
    {
      id: 'net-protocols-iq-05',
      difficulty: 'expert',
      question:
        'At peak, calls from our checkout service to a payment provider fail with EADDRNOTAVAIL and connect timeouts, even though the provider is healthy. Explain what is happening and how you fix it at every layer.',
      context: '40 pods behind one NAT gateway, 3,000 RPS to the provider at peak, provider p99 latency 300ms.',
      whatInterviewerLooksFor: [
        'Understands the 4-tuple, ephemeral port range and TIME_WAIT on the active closer',
        'Does the arithmetic: churn rate × 60s vs available ports',
        'Identifies the NAT gateway shared port budget',
        'Fixes connection reuse first, then kernel/network knobs',
      ],
      modelAnswer: `### What's happening
A connection to the provider is identified by (src IP, src port, dst IP, dst port). Behind a NAT gateway, **all 40 pods share one public source IP**, so for a given provider IP:443 the only free variable is the source port.

If the client opens a new connection per request and closes it (typical with a per-request agent or \`Connection: close\`), the client is the **active closer** and each port sits in **TIME_WAIT for 60s**:
- 3,000 new conns/s × 60s = **180,000** ports held.
- A single Linux host has 28,232 ephemeral ports per destination by default; the AWS NAT gateway allows ~**55,000** concurrent connections per unique destination.

So both the pods (EADDRNOTAVAIL) and the NAT gateway (\`ErrorPortAllocation\`, dropped SYNs → connect timeouts) run out.

### Fix, in order
1. **Reuse connections.** A shared keep-alive agent/HTTP/2 client per pod. Needed concurrency by Little's Law: 3,000 RPS × 0.3s = 900 in-flight across the fleet ≈ 23 per pod; a pool of ~50 per pod means ~2,000 long-lived connections total and near-zero churn.
2. **Bound and time out**: max sockets per pod, connect timeout ~1s, total deadline, so a provider slowdown doesn't open thousands of new connections (Little's Law again: latency × RPS explodes the pool).
3. **Idle-timeout ordering**: pool idle timeout shorter than the provider's, plus a max connection age for DNS changes.
4. **Network capacity**: add secondary IPs to the NAT gateway (each adds another ~55K per destination) or multiple NAT gateways/AZ; use PrivateLink if the provider offers it.
5. **Kernel knobs as backup**: widen \`ip_local_port_range\` to ~10240–65535, \`tcp_tw_reuse=1\` for outgoing connections. Never \`tcp_tw_recycle\`.

### Monitoring
TIME_WAIT counts (\`ss -s\`), \`TcpActiveOpens\` rate, NAT \`ErrorPortAllocation\` and \`ActiveConnectionCount\`, pool wait time and pool saturation metrics.`,
      followUps: [
        { q: 'Would making the server close connections instead help?', a: 'TIME_WAIT would then land on the provider side rather than ours, which just moves the problem and costs everyone a handshake per request. Reuse is the real fix.' },
        { q: 'The provider returns Connection: close on every response. Now what?', a: 'We cannot reuse, so we raise port capacity: more NAT IPs, widen the port range, tcp_tw_reuse, and possibly an egress proxy fleet with many source IPs; also ask the provider to support keep-alive or HTTP/2.' },
        { q: 'What happens to the pool during a provider latency spike from 300ms to 3s?', a: 'Required concurrency goes 10x (3,000 × 3s = 9,000). A bounded pool queues or fails fast instead of opening 9,000 connections; combine with a circuit breaker and timeouts so checkout degrades gracefully.' },
      ],
      pitfalls: [
        'Jumping straight to sysctl tuning without fixing reuse',
        'Recommending tcp_tw_recycle',
        'Not noticing that the NAT gateway port budget is shared by all pods',
        'Ignoring timeouts and pool bounds',
      ],
    },
    {
      id: 'net-protocols-iq-06',
      difficulty: 'hard',
      question:
        'We are moving service-to-service calls from REST over HTTP/1.1 to gRPC over HTTP/2. What networking behaviours change, and what can go wrong in production?',
      whatInterviewerLooksFor: [
        'Multiplexing and fewer connections, HPACK savings',
        'Long-lived connections breaking L4 load balancing and DNS-based scaling',
        'Flow-control windows, max concurrent streams, GOAWAY-based draining',
        'Keep-alive pings and proxy/idle timeouts',
      ],
      modelAnswer: `### What gets better
- **Multiplexing:** hundreds of concurrent RPCs on one connection instead of a pool of dozens. Fewer handshakes, fewer sockets, less TIME_WAIT churn.
- **HPACK:** repeated metadata (auth tokens, tracing headers) compresses to a few bytes per call after the first.
- **Streaming:** bidi/server streaming over the same connection, with per-stream flow control.

### What can go wrong
1. **Load imbalance.** A client holds a handful of long-lived connections; an L4 load balancer balances *connections*, not requests, so each client pins to 1–2 backends. New pods from autoscaling get no traffic. Fix: L7 balancing (Envoy/mesh, gRPC client-side balancing with headless service DNS) and server-side \`MAX_CONNECTION_AGE\` (e.g. 5 min + grace) so clients reconnect and rebalance.
2. **TCP head-of-line blocking.** All RPCs share one TCP stream; a lost packet stalls them all. Usually fine in a DC; noticeable cross-region.
3. **Flow control:** default 64KB windows cap large streaming transfers at window/RTT; cross-region streams can crawl. Many gRPC implementations use BDP-based dynamic windows; verify for your stack.
4. **\`MAX_CONCURRENT_STREAMS\`** (often 100): beyond that, RPCs queue client-side even though the backend is idle — need more connections per backend for very high concurrency.
5. **Idle and keep-alive:** proxies and NATs silently drop idle connections; configure HTTP/2 PING keep-alives within server-enforced limits, or the server responds with GOAWAY \`too_many_pings\`.
6. **Deploys:** servers must send **GOAWAY** and drain in-flight streams before exiting; otherwise clients see UNAVAILABLE bursts.
7. **Infrastructure support:** every hop must speak HTTP/2 end-to-end (ALB supports gRPC target groups; some older proxies downgrade to HTTP/1.1 and break gRPC).

### How I'd roll it out
Start with a mesh or client-side L7 balancing, set max connection age, deadlines on every RPC, and dashboards for per-pod RPS skew and stream queueing.`,
      followUps: [
        { q: 'After a scale-out from 10 to 30 pods, the new pods sit at 5% CPU. Why?', a: 'Existing clients keep their established HTTP/2 connections to the old 10 pods; nothing forces reconnection. Add MAX_CONNECTION_AGE on the server and/or L7 per-request balancing so traffic spreads to new endpoints.' },
        { q: 'Why is GOAWAY better than just closing the socket?', a: 'GOAWAY tells the client the last stream ID the server will process; the client retries later streams on a new connection knowing they were not executed, avoiding ambiguous failures and duplicated side effects.' },
      ],
      pitfalls: [
        'Assuming the existing L4 load balancer spreads gRPC evenly',
        'Forgetting deadlines on RPCs',
        'Ignoring flow control for large/streaming payloads',
      ],
    },
    {
      id: 'net-protocols-iq-07',
      difficulty: 'hard',
      question:
        'Design the TLS strategy for a multi-region API platform: where do you terminate, how do you keep handshakes cheap, and how do you secure traffic inside the cluster?',
      whatInterviewerLooksFor: [
        'Termination options with trade-offs (edge, LB, re-encrypt, passthrough)',
        'TLS 1.3, resumption with shared ticket keys, 0-RTT restrictions',
        'Cert chain size, ECDSA, OCSP stapling',
        'mTLS/zero trust internally with automated rotation',
      ],
      modelAnswer: `### Public edge
- **Terminate at CDN/edge POPs** close to users: a handshake over a 15ms RTT instead of 200ms. The edge also gives WAF, DDoS absorption and HTTP/3.
- **TLS 1.3 preferred**, TLS 1.2 with ECDHE + AEAD only for older clients; no TLS 1.0/1.1.
- **Small first flight:** ECDSA P-256 certificates (with an RSA fallback for ancient clients), short chains, OCSP stapling so clients don't call the CA.
- **Resumption:** session tickets with **ticket keys shared and rotated** across all edge nodes (e.g. every 12h, keep the previous key for decryption). Without sharing, a client landing on another node does a full handshake.
- **0-RTT** only for idempotent requests; the edge adds an Early-Data header and origin returns 425 for unsafe methods.
- HSTS to avoid plaintext first hits.

### Edge → origin
- **Re-encrypt** with TLS to the regional LB (don't send plaintext across the internet/backbone), over long-lived pooled connections so the handshake cost is amortised to ~0.
- Authenticate the edge to origin (mTLS or signed headers) so nobody bypasses the CDN.

### Inside the cluster
- **mTLS between services** via a service mesh (Istio/Linkerd) or SPIFFE-based identity: short-lived certs (hours), automatically rotated, identity-based authorization policies.
- Crypto cost with AES-NI is small; the operational cost is cert lifecycle and debugging — automate it or it won't be done.

### Operations
- Automated issuance/renewal (ACME / cert-manager) with alerts at 30/14/7 days before expiry — expired certs remain a top outage cause.
- Monitor handshake rate, resumption ratio, TLS errors by client version.
- Private keys in KMS/HSM for the edge where required by compliance.

**Trade-off summary:** edge termination buys latency and protection at the cost of decrypting at a third party; passthrough gives end-to-end secrecy but loses L7 routing and caching.`,
      followUps: [
        { q: 'Your resumption rate is 5% even though tickets are enabled. Why?', a: 'Most likely each node has its own random ticket key (or keys rotate too fast), so clients resuming on a different node fail and do a full handshake. Share keys across the fleet, or use a shared session cache.' },
        { q: 'When would you choose TLS passthrough at the LB?', a: 'When the LB must not see plaintext (strict compliance, customer-held keys) or the protocol is not HTTP. You lose L7 routing, header-based rules and centralized cert management.' },
        { q: 'How do you rotate an internal CA without downtime?', a: 'Distribute the new CA to trust bundles first (trust both), then start issuing leaf certs from the new CA, wait until all old leaves expire, then remove the old CA from bundles.' },
      ],
      pitfalls: [
        'Plaintext between edge and origin "because it is our network"',
        'Per-node ticket keys that silently disable resumption',
        'Manual certificate renewal',
        'Allowing 0-RTT for POST/PUT',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'net-protocols-boe-1',
      question:
        'A service opens a new TCP connection per request to one partner endpoint (single IP:443). At what request rate does a single host run out of ephemeral ports, and how many pooled connections would replace the churn at 2,000 RPS?',
      assumptions: [
        'Linux default ip_local_port_range 32768–60999 = 28,232 ports',
        'Client is the active closer; TIME_WAIT = 60s (fixed on Linux)',
        'tcp_tw_reuse disabled; one source IP; partner p99 latency 80ms',
        'Target peak = 2,000 RPS from this host',
      ],
      steps: [
        { label: 'Max sustainable new connections/s', calc: '28,232 ports ÷ 60s TIME_WAIT ≈ 470 new conns/s' },
        { label: 'Ports needed at 2,000 RPS without reuse', calc: '2,000 conns/s × 60s = 120,000 ports held in TIME_WAIT ≫ 28,232' },
        { label: 'Time to exhaustion at 2,000 RPS', calc: '28,232 ÷ 2,000 ≈ 14s after traffic starts' },
        { label: 'Concurrency with keep-alive (Little\'s Law)', calc: 'L = λ × W = 2,000 × 0.08s = 160 in-flight connections' },
        { label: 'Pool size with headroom', calc: '160 × ~1.5 ≈ 250 sockets, reused indefinitely → ~0 new conns/s' },
      ],
      answer:
        'Without reuse a host tops out around 470 new connections/s to one destination; at 2,000 RPS ports run out in ~14 seconds. A keep-alive pool of ~250 connections serves the same load with essentially zero churn.',
      insight:
        'Connection reuse is a capacity requirement, not an optimisation. Sysctl knobs (wider port range, tcp_tw_reuse) only buy ~2x; a pool buys orders of magnitude and also removes 2–3 RTTs of handshake per request.',
      followUps: [
        {
          "q": "The calls go out through a NAT gateway shared by 12 pods. Does the per-host math still apply?",
          "a": "No. The NAT becomes the bottleneck because it translates all pods to one public IP. An AWS NAT gateway supports about 55,000 simultaneous connections per unique destination (IP:port). With 12 pods at 2,000 RPS each and no reuse, that's 24,000 new connections/s, and connections linger (TIME_WAIT and NAT idle tracking), so the NAT hits `ErrorPortAllocation` within seconds even if each pod widens its own range. Fixes: keep-alive pools (12 × 250 = 3,000 connections total, well under the limit), adding public IPs to the NAT (each adds 55K), or spreading across several NAT gateways."
        }
      ],
    },
    {
      id: 'net-protocols-boe-2',
      question:
        'Estimate cold-start latency for a 10KB API response to a mobile user with 150ms RTT under (a) HTTP/1.1 + TLS 1.2, (b) HTTP/2 + TLS 1.3, (c) HTTP/3, (d) HTTP/3 with 0-RTT resumption, and (e) TLS terminated at an edge POP 20ms away.',
      assumptions: [
        'DNS lookup via carrier resolver: 50ms (cache miss)',
        'Server processing: 50ms; 10KB fits in the initial congestion window (~14.6KB)',
        'Edge POP ↔ origin connection is already warm (pooled) with 150ms RTT to origin',
        'Edge case: user ↔ POP RTT 20ms, DNS for edge hostname cached',
      ],
      steps: [
        { label: '(a) HTTP/1.1 + TLS 1.2', calc: '50 DNS + 150 TCP + 300 TLS (2 RTT) + 150 request + 50 server = 700ms' },
        { label: '(b) HTTP/2 + TLS 1.3', calc: '50 + 150 TCP + 150 TLS (1 RTT) + 150 + 50 = 550ms' },
        { label: '(c) HTTP/3 (QUIC 1-RTT)', calc: '50 + 150 (transport+TLS) + 150 + 50 = 400ms' },
        { label: '(d) HTTP/3 0-RTT, DNS cached', calc: '0 + 150 (request in first flight) + 50 = 200ms' },
        { label: '(e) Edge termination, TLS 1.3', calc: '20 TCP + 20 TLS + 20 request to POP + 150 POP→origin (warm) + 50 server ≈ 260ms' },
        { label: 'Warm keep-alive baseline', calc: '150 + 50 = 200ms' },
      ],
      answer:
        'Roughly 700ms → 550ms → 400ms → 200ms across protocol upgrades; terminating at a nearby edge gets a cold connection to ~260ms regardless of client protocol support.',
      insight:
        'For small payloads, latency is RTT count × RTT length. Protocol upgrades cut the count; edge POPs cut the length of the expensive handshake RTTs, and warm edge→origin pools make the origin RTT count exactly once.',
      followUps: [
        {
          "q": "Packet loss on the mobile path is 2%. Which of the five options degrades most, and why?",
          "a": "The TCP options degrade most: HTTP/1.1 and HTTP/2 over TLS. A lost handshake packet costs a retransmission timeout (initial RTO is often 1 s) rather than one RTT, so a cold request can jump from 550 ms to over 1.5 s. With HTTP/2 on one TCP connection, a lost data segment also stalls every stream. QUIC (c and d) recovers faster: it doesn't wait for TCP's RTO conventions, uses per-packet numbers for precise loss detection, and loss on one stream doesn't block the others. Option (e) helps a lot because the lossy segment is only the 20 ms user-to-POP hop, where retransmissions are cheap."
        }
      ],
    },
    {
      id: 'net-protocols-boe-3',
      question:
        'A mobile client downloads a 1MB JSON feed on a brand-new connection over an 80ms RTT, 50 Mbps link. How long does it take, and what dominates?',
      assumptions: [
        'initcwnd = 10 × 1,460-byte segments ≈ 14.6KB; cwnd doubles each RTT (no loss)',
        'TCP + TLS 1.3 handshake = 2 RTTs before the request; request itself = 1 RTT to first byte',
        'Receive window is not the limit; server time negligible',
      ],
      steps: [
        { label: 'Bytes deliverable after k RTTs of slow start', calc: '14.6KB × (2^k − 1): k=6 → 920KB, k=7 → 1.85MB' },
        { label: 'RTTs of data transfer for 1MB', calc: '≈ 7 RTTs (the 7th round only partly used)' },
        { label: 'Total RTTs', calc: '2 handshake + 7 data ≈ 9 RTTs × 80ms ≈ 720ms' },
        { label: 'Pure bandwidth time', calc: '1MB × 8 = 8 Mbit ÷ 50 Mbps = 160ms' },
        { label: 'On a warm connection (large cwnd)', calc: '1 RTT + 160ms ≈ 240ms' },
      ],
      answer:
        'About 700–750ms on a cold connection versus ~240ms on a warm one; slow start and handshakes, not bandwidth, account for ~75% of the time.',
      insight:
        'Reuse warm connections (and disable tcp_slow_start_after_idle on servers), keep first responses small (paginate, compress — brotli can shrink JSON 5–10x), and consider BBR/higher initcwnd at the edge. Upgrading user bandwidth barely helps.',
      followUps: [
        {
          "q": "Product says shrink the time to first meaningful content to under 300 ms on a cold connection. What do you change?",
          "a": "Bandwidth isn't the lever; RTT count is. (1) Send less first: paginate the feed so the first response is about 30–50 KB, which after brotli compression (JSON 5–10×) is about 5–10 KB and fits in initcwnd, taking 1 data RTT instead of 7. (2) Terminate at an edge POP about 20 ms away, so the handshake RTTs are short: 2 × 20 ms + 20 ms + warm origin fetch. (3) Use TLS 1.3 or QUIC to save a round trip and 0-RTT for repeat users. (4) Prefetch the rest of the feed in the background over the now-warm connection."
        }
      ],
    },
    {
      id: 'net-protocols-boe-4',
      question:
        'A Kubernetes cluster runs 300 Node pods; each opens ~200 new outbound connections/s to external hostnames like api.partner.com with no DNS caching and default ndots:5. Estimate CoreDNS query load and how many CoreDNS replicas you need — then with the fixes applied.',
      assumptions: [
        'Node resolves on every new connection (no in-process cache)',
        'Search list: <ns>.svc.cluster.local, svc.cluster.local, cluster.local (3 domains)',
        'Each name queried for both A and AAAA',
        'One CoreDNS replica sustains roughly 20–30K QPS (use 25K) with caching',
      ],
      steps: [
        { label: 'Lookups per second', calc: '300 pods × 200 = 60,000 lookups/s' },
        { label: 'Queries per lookup with ndots:5', calc: '(3 search-domain misses + 1 real name) × 2 (A+AAAA) = 8 queries' },
        { label: 'CoreDNS QPS', calc: '60,000 × 8 = 480,000 QPS' },
        { label: 'Replicas needed', calc: '480,000 ÷ 25,000 ≈ 20 replicas (+ headroom ≈ 25)' },
        { label: 'With ndots:2 or FQDN trailing dot', calc: '60,000 × 2 = 120,000 QPS (4x less)' },
        { label: 'Plus keep-alive pools (~2 new conns/s/pod) & NodeLocal DNSCache', calc: '300 × 2 × 2 = 1,200 QPS to CoreDNS — noise' },
      ],
      answer:
        'Roughly 480K QPS needing ~20–25 CoreDNS replicas as configured; ndots tuning cuts it 4x, and connection reuse plus node-local caching cuts it to around a thousand QPS.',
      insight:
        'DNS load is a symptom of connection churn multiplied by resolver config. Fix churn (pools), then query amplification (ndots/FQDN), then add caching (NodeLocal DNSCache), which also sidesteps the conntrack 5-second timeout race.',
      followUps: [
        {
          "q": "After the fixes, one partner hostname has a 5-second TTL because they do DNS-based failover. How does NodeLocal DNSCache interact with that?",
          "a": "NodeLocal DNSCache honours record TTLs (capped by its own max TTL setting), so it refreshes the partner's record every 5 s per node. With 300 pods spread over, say, 50 nodes, that's about 50 × 2 queries per 5 s, which is trivial. The risk is above the DNS layer: keep-alive pools hold connections to the old IP for minutes, so failover only takes effect when sockets are recycled. Pair it with a maximum socket age (for example 60 s for this partner) or fail-fast behaviour: on connection errors, discard the pool's connections so new ones resolve the fresh record."
        }
      ],
    },
  ],
  test: [
    {
      id: 'net-protocols-mcq-01',
      difficulty: 'expert',
      question:
        'This NestJS service sits behind an AWS ALB with the default 60s idle timeout. The ALB reports a steady ~0.1% of 502s that never show up in application logs. What is the most likely cause?',
      code: {
        language: 'typescript',
        code: `const app = await NestFactory.create(AppModule);
const server = app.getHttpServer();
// no timeout configuration: Node defaults apply
await app.listen(3000);`,
      },
      options: [
        'The ALB health check interval is shorter than the request timeout, so targets flap between healthy and unhealthy',
        "Node's default 5s keepAliveTimeout closes idle sockets that the ALB still considers reusable, so requests race into closing connections",
        'Node defaults to HTTP/1.0 responses, which the ALB rejects when it negotiated HTTP/1.1 with the client',
        'The ALB exhausts its ephemeral ports to the targets because Node sends Connection: close on every response',
      ],
      correct: [1],
      explanation:
        'Node closes idle keep-alive sockets after 5s while the ALB keeps them for up to 60s; when the ALB reuses a socket the server is closing, it gets a reset and returns 502 before the app sees the request. Health-check flapping would show 503s and target changes, not a steady no-log 502 rate. Node speaks HTTP/1.1 and does keep connections alive by default, so the HTTP/1.0 and Connection: close explanations are wrong.',
      followUps: [
        {
          "q": "Before changing any config, how would you prove this is the keep-alive race and not something else?",
          "a": "Correlate three things. (1) ALB access logs: race 502s show `target_processing_time = -1` and `elb_status_code=502` with `target_status_code` set to `-`, meaning the target never answered. (2) Timing: the 502s cluster on connections idle for just over 5 s; a tcpdump on the target shows FIN from Node at idle+5 s followed by the ALB sending a request on that socket, answered with RST. (3) An experiment: set `keepAliveTimeout` to 65 s on one target out of 10, and its share of 502s should drop to near zero while the others stay at 0.1%. That gives evidence without a fleet-wide change."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-02',
      difficulty: 'hard',
      question:
        'You cut over a service to a new load balancer by updating its DNS A record (TTL 60s). Three hours later, dashboards show a large share of requests still hitting the old LB, mostly from internal services using HTTP/2 clients. What best explains this?',
      options: [
        'Recursive resolvers ignore TTLs below 300s, so the change will take exactly five minutes more',
        'HTTP/2 clients resolve DNS for every stream, so they are hitting a stale resolver cache',
        'Existing long-lived connections are still open to the old IP; DNS is only consulted when a new connection is established',
        'The new LB is rejecting HTTP/2 prefaces and clients silently fall back to the old IP from the previous answer',
      ],
      correct: [2],
      explanation:
        'Pooled and multiplexed HTTP/2 connections can live for hours and never re-resolve the name, so traffic only moves when connections are recycled — hence the need for a max connection age and draining. Resolver TTL floors exist but would not explain hours of lag with a 60s TTL. HTTP/2 does not resolve per stream, and clients do not "fall back" to an older DNS answer.',
      followUps: [
        {
          "q": "You control the servers but not the internal clients' code. How do you force the traffic to move?",
          "a": "Make the old endpoint push clients away. On the old LB (or the backends behind it), set a maximum connection age: HTTP/2 servers send GOAWAY after, say, 5–10 minutes (Envoy `max_connection_duration`, gRPC `MAX_CONNECTION_AGE` with a grace period). Clients finish in-flight streams, open a new connection, re-resolve DNS and land on the new LB. For HTTP/1.1, return `Connection: close` on responses. Monitor old-LB connection counts falling to zero, then decommission. Keep the old LB alive until then, because cutting it off early turns a migration into an outage."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-03',
      difficulty: 'expert',
      question:
        'After switching a mobile app from six HTTP/1.1 connections to a single HTTP/2 connection, p95 latency improved on Wi-Fi but got worse on a congested cellular network with ~3% packet loss. Why?',
      options: [
        'All streams share one TCP connection, so each loss stalls every stream (TCP HOL blocking) and halves the only congestion window',
        'HPACK decompression is CPU-bound on low-end phones and stalls under load',
        'HTTP/2 disables TCP_NODELAY, so small frames wait on delayed ACKs',
        'Cellular carriers downgrade HTTP/2 to HTTP/1.1 with pipelining, which reintroduces HTTP-level HOL blocking',
      ],
      correct: [0],
      explanation:
        'With one TCP connection, a lost segment blocks delivery for every multiplexed stream until retransmitted, and congestion control backs off the single shared window, whereas six connections spread loss impact across independent windows. HPACK is cheap; HTTP/2 stacks do not disable TCP_NODELAY; carriers cannot transparently downgrade TLS-encrypted HTTP/2. This is exactly the problem QUIC solves.',
      followUps: [
        {
          "q": "You can't ship HTTP/3 to these clients yet. What can you do on the server side to soften the loss impact for the single HTTP/2 connection?",
          "a": "Tune congestion behaviour at the edge. Use BBR instead of CUBIC on the servers: BBR models bandwidth and RTT rather than treating every loss as congestion, so 3% random cellular loss doesn't collapse the window. Enable SACK and RACK-TLP (default on modern Linux) for faster loss recovery. Raise initcwnd at the edge. Make sure `tcp_slow_start_after_idle=0`, so idle mobile connections don't restart from a tiny window. Optionally let critical calls use a second connection. These recover much of the gap; QUIC remains the structural fix because it has per-stream loss recovery."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-04',
      difficulty: 'hard',
      question: 'You are enabling TLS 1.3 0-RTT (early data) at your edge. Select ALL statements that are correct.',
      options: [
        'Early data can be replayed by an attacker, so it should only be accepted for idempotent requests',
        '0-RTT is only possible when resuming with a pre-shared key from a previous session',
        'Early data is encrypted with the server certificate public key, so it has the same forward secrecy as 1-RTT data',
        'A server can reject early data and force the client to resend it after the full handshake (e.g. HTTP 425 Too Early)',
        '0-RTT removes the TCP handshake as well, so over TCP a request can be sent in the SYN',
      ],
      correct: [0, 1, 3],
      explanation:
        'Early data is replayable, requires a PSK from a prior session, and servers can reject it or respond 425 so the client retries after the handshake. It is encrypted under keys derived from the resumption PSK, not the certificate key, and has weaker forward secrecy than 1-RTT data. Over TCP, TLS 0-RTT still needs the TCP handshake (TCP Fast Open is a separate, rarely deployed mechanism); only QUIC achieves true 0-RTT end to end.',
      followUps: [
        {
          "q": "Your edge accepts 0-RTT for GET requests. A GET /checkout/confirm?token=... endpoint has side effects. What exactly can go wrong, and how do you protect it?",
          "a": "An attacker who captured the client's early-data packet can replay it, possibly to several edge POPs, and confirm the checkout twice; an HTTP method name doesn't make an endpoint idempotent. Protections: allow early data only on an explicit allowlist of truly safe routes; have the edge add `Early-Data: 1` (RFC 8470) when forwarding to origin so the origin can reply `425 Too Early` for anything non-idempotent, making the client retry after the full handshake; and make side-effecting endpoints idempotent with single-use tokens or idempotency keys so a replay is a no-op. Some CDNs also offer single-use ticket strategies to limit replay across POPs."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-05',
      difficulty: 'hard',
      question:
        'Under load, this code starts failing with connect EADDRNOTAVAIL, and ss shows ~28K sockets in TIME_WAIT towards the pricing service. What is the root cause?',
      code: {
        language: 'typescript',
        code: `import http from 'node:http';

export function getPrice(sku: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const agent = new http.Agent({ keepAlive: false });
    http.get({ host: 'pricing.internal', path: '/p/' + sku, agent }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}`,
      },
      options: [
        'The pricing service has too small a listen backlog, so SYNs are dropped and sockets remain half-open',
        'Each call opens and closes a new connection; as active closer the client holds each source port in TIME_WAIT for 60s, exhausting the ephemeral range',
        'The response body is not drained, so sockets stay checked out of the agent pool until the process runs out of file descriptors',
        'http.get without a timeout keeps sockets open forever, which is what TIME_WAIT indicates',
      ],
      correct: [1],
      explanation:
        'With no keep-alive, every request uses a fresh source port, and the closing side (the client here) keeps it in TIME_WAIT for 60s; ~28K ports ÷ 60s caps you near 470 new connections/s. A full backlog would show SYN retries and ETIMEDOUT, not TIME_WAIT. The body is drained via the data handler, and TIME_WAIT is a closed-connection state, not an open one, so the missing timeout is a separate issue.',
      followUps: [
        {
          "q": "Someone proposes setting `net.ipv4.tcp_tw_recycle=1` to fix it. What's your response?",
          "a": "No. `tcp_tw_recycle` was removed in Linux 4.12 because it broke clients behind NAT: it dropped SYNs whose TCP timestamps weren't monotonic per source IP, and many devices behind one NAT have unrelated clocks. The safe knob is `tcp_tw_reuse=1`, which lets outbound connects reuse a TIME_WAIT port when timestamps prove it's safe, plus widening `ip_local_port_range`. Those only buy about 2×. The real fix is the keep-alive pool that removes the churn. Shortening TIME_WAIT itself isn't configurable on Linux (60 s is compiled in) for good reason: it protects against stray old segments."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-06',
      difficulty: 'medium',
      question:
        'An API server responds to every request with Connection: close. A week later you notice tens of thousands of TIME_WAIT sockets. On which machine do they accumulate, and why?',
      options: [
        'On the server, because the side that closes the connection first (the active closer) enters TIME_WAIT',
        'On the clients, because the side that initiated the connection always enters TIME_WAIT',
        'On both sides equally, because TIME_WAIT is part of the four-way close for both peers',
        'On the load balancer only, because it translates the close into a RST towards the client',
      ],
      correct: [0],
      explanation:
        'TIME_WAIT is held by whichever side sends the first FIN; with Connection: close the server closes first, so it accumulates TIME_WAIT. Who initiated the connection does not matter. The passive closer goes through CLOSE_WAIT/LAST_ACK, not TIME_WAIT. For a listening server this rarely exhausts ports (they share the server port), but it does waste memory and every client pays a new handshake.',
      followUps: [
        {
          "q": "The server's TIME_WAIT sockets don't exhaust ports, but the clients are a fleet of mobile apps. What's the real cost of Connection: close here?",
          "a": "Every request pays a fresh TCP handshake plus a TLS handshake: 2–3 RTTs, which is 300–450 ms at 150 ms mobile RTT before any bytes flow. Each new connection also restarts slow start with about 14 KB of initcwnd, so larger responses take extra round trips, and server CPU goes to TLS handshakes (ECDHE plus signature per connection, often more than the request handling itself). TIME_WAIT memory on the server is minor (about 200 bytes each). Remove `Connection: close`, set keep-alive idle timeouts longer than typical think time (say 60–120 s), and enable TLS session resumption for connections that do drop."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-07',
      difficulty: 'expert',
      question:
        'A gRPC server-streaming call replicates a large dataset from us-east-1 to eu-west-1 (RTT ~80ms). Throughput plateaus at ~6.5 Mbps despite a 1 Gbps link and no packet loss. What is the most likely limit?',
      options: [
        'TCP slow start never finishes because gRPC messages are smaller than the MSS',
        'SETTINGS_MAX_CONCURRENT_STREAMS is 100, so the stream is throttled to 1/100 of connection bandwidth',
        'HPACK must re-encode headers for each message, making the stream CPU-bound on the server',
        'The HTTP/2 flow-control window is left at the 65,535-byte default, capping each stream at window/RTT ≈ 820KB/s',
      ],
      correct: [3],
      explanation:
        '65,535 bytes per 80ms RTT is ≈ 820KB/s ≈ 6.5 Mbps — exactly the observed plateau, and the fix is raising stream/connection windows toward the bandwidth-delay product (1 Gbps × 80ms ≈ 10MB) or using BDP-based dynamic windows. Slow start completes regardless of message size with no loss. Headers are sent once per stream, not per message. MAX_CONCURRENT_STREAMS limits the number of streams, not bandwidth per stream.',
      followUps: [
        {
          "q": "You raise the window to 16 MB. Throughput jumps to about 800 Mbps, but the receiver's memory spikes and other streams on the connection starve. What do you tune?",
          "a": "A huge static window per stream lets one bulk stream buffer up to 16 MB at the receiver and claim the shared connection window. Use BDP-based dynamic windows (gRPC's BDP probing, enabled by default in grpc-go and grpc-java) so windows grow only as far as measured bandwidth × RTT needs. Set the connection window larger than any single stream window so small RPCs still get credit. For bulk replication, put the stream on its own connection or channel, separating it from latency-sensitive RPCs. Cap total receiver buffer memory and apply application backpressure by reading from the stream only as fast as you can persist."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-08',
      difficulty: 'expert',
      question:
        'Pods in a Kubernetes cluster intermittently take exactly ~5 seconds to resolve external hostnames, and outbound HTTP latency p99 is dominated by DNS. Select ALL plausible contributing causes.',
      options: [
        "The conntrack race when glibc sends A and AAAA queries in parallel over the same UDP socket, dropping one and waiting for the resolver's 5s timeout",
        'ndots:5 causing each external name to be tried against every search domain first, multiplying queries to CoreDNS',
        'TCP slow start on DNS queries, since each lookup opens a new TCP connection to CoreDNS',
        'Under-provisioned CoreDNS replicas dropping queries under the amplified load',
      ],
      correct: [0, 1, 3],
      explanation:
        'The A/AAAA conntrack insertion race is a well-known source of exactly-5s delays; ndots:5 multiplies each external lookup into ~8 queries, and overloaded CoreDNS drops UDP queries that then wait on the retry timeout. DNS normally uses UDP and only falls back to TCP for truncated responses, and a tiny query would not be affected by slow start anyway. Fixes: NodeLocal DNSCache, ndots tuning/FQDNs, single-request-reopen, and scaling CoreDNS.',
      followUps: [
        {
          "q": "Which fix would you roll out first across 300 services, and why?",
          "a": "Deploy NodeLocal DNSCache first: a DaemonSet caching resolver on each node at a link-local IP. It needs no application changes, so it's one cluster-level rollout. It removes the conntrack race, because pods talk to the local cache and the cache talks to CoreDNS over TCP. It also absorbs the ndots amplification, since negative answers for search-domain misses are cached locally. CoreDNS load drops by orders of magnitude. Then fix ndots per workload (`dnsConfig.options ndots: 2`, or trailing-dot FQDNs) and add app-level keep-alive, which need code or manifest changes owned by each team."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-09',
      difficulty: 'medium',
      question:
        'Your StatsD agent sidecar crashes and stays down for 20 minutes. The application sends metrics with the code below. What is the impact on request handling?',
      code: {
        language: 'typescript',
        code: `import dgram from 'node:dgram';
const sock = dgram.createSocket('udp4');
sock.on('error', () => {});

export function timing(name: string, ms: number) {
  sock.send(name + ':' + ms + '|ms', 8125, '127.0.0.1');
}`,
      },
      options: [
        'Requests block until the send buffer drains, adding latency proportional to metric volume',
        'Each send throws ECONNREFUSED synchronously, turning requests into 500s',
        'Metrics are silently dropped; request handling is unaffected because UDP sends do not wait for a receiver',
        'The kernel retransmits datagrams until the agent returns, so memory grows until the pod is OOM-killed',
      ],
      correct: [2],
      explanation:
        'UDP has no connection, acknowledgement or retransmission: datagrams to a closed port are dropped (an ICMP port-unreachable may surface as an async error, which the handler swallows). That is precisely why StatsD uses UDP — metrics must never back-pressure the app. Nothing blocks, nothing throws synchronously, and the kernel never retransmits UDP.',
      followUps: [
        {
          "q": "UDP is fine for metrics, but the business now wants billing-relevant usage events sent the same way. Is that OK?",
          "a": "No. A 20-minute agent outage silently lost every metric, which is acceptable for dashboards but not for billing. Usage events must be durable and at-least-once: write them to a local outbox (DB table or append-only file) and ship them with acknowledgements (Kafka producer with acks=all, or HTTPS with retries and idempotency keys). Downstream dedupes by event id. If you want to keep the agent pattern, use a local agent that spools to disk and forwards with acks (Vector or Fluent Bit with persistent buffers), not fire-and-forget UDP. Monitor end-to-end counts: produced vs billed."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-10',
      difficulty: 'expert',
      question:
        'You enable HTTP/3 on your own fleet behind an L4 load balancer that hashes the UDP 5-tuple. Handshakes work, but connections break whenever a phone switches from Wi-Fi to LTE. Why?',
      options: [
        'QUIC connection migration requires the client to redo the TLS handshake, which the LB blocks',
        'After the client IP/port changes, the 5-tuple hash sends packets to a different backend that has no state for that Connection ID',
        'LTE carriers block UDP/443, so the connection cannot continue after migration',
        'The Alt-Svc max-age expires on network change, forcing clients to reconnect over TCP',
      ],
      correct: [1],
      explanation:
        'Migration keeps the Connection ID but changes the source IP/port, so a 5-tuple-hashing LB routes the packets to a different server, which drops them; you need QUIC-aware LBs that route on (server-ID-encoded) Connection IDs. Migration does not redo the handshake — it performs path validation. Some networks block UDP, but then h3 would never have worked there. Alt-Svc caching is unrelated to network changes.',
      followUps: [
        {
          "q": "Your cloud L4 LB can't route on Connection IDs. What's the pragmatic deployment of HTTP/3?",
          "a": "Option 1: let a CDN or edge that is QUIC-aware (Cloudflare, Fastly, CloudFront) terminate HTTP/3 near users and speak HTTP/1.1 or HTTP/2 to your origin. Migration is handled at their edge and your LB stays unchanged. Option 2: if you run your own edge, use a QUIC-LB-aware load balancer (Katran or a custom XDP program) where the server id is encoded in the Connection ID. Option 3: accept that migration breaks: clients fall back to a new handshake, or to TCP via Alt-Svc, on network change, which costs one RTT but still works. Measure the fallback rate before investing."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-11',
      difficulty: 'hard',
      question:
        'After moving a mobile API gateway from HTTP/1.1 to HTTP/2, request header bytes on the wire drop by ~85%. Each request carries a 1.2KB JWT and several tracing headers. Which mechanism explains most of the saving?',
      options: [
        'HPACK Huffman-coding each header value, which compresses base64 JWTs by about 85%',
        'HTTP/2 applies gzip to header blocks, the same way it compresses response bodies',
        "HPACK's per-connection dynamic table, which lets repeated headers be sent as small index references after the first request",
        'HTTP/2 server push pre-sending headers so clients can omit them from requests',
      ],
      correct: [2],
      explanation:
        'Headers that repeat across requests on the same connection are inserted into the HPACK dynamic table once and then referenced by index, reducing a 1.2KB token to a byte or two. Huffman coding alone saves roughly 20–30% on base64 text, not 85%. HTTP/2 deliberately does not DEFLATE headers (CRIME attack), and server push never affected request headers (and is effectively removed).',
      followUps: [
        {
          "q": "The gateway opens a new HTTP/2 connection per request to backends due to a bug. What happens to the header savings, and what else gets worse?",
          "a": "HPACK's dynamic table is per connection, so a fresh connection starts empty: every request sends the full 1.2 KB JWT again (with only Huffman's 20–30% saving), and the 85% reduction disappears. Worse, each request also pays TCP and TLS handshakes, HTTP/2 connection preface and SETTINGS exchange, and slow start. The fix is long-lived pooled HTTP/2 connections per backend. A related concern: very large or highly variable headers such as per-request trace ids don't index well, so keep them short. Watch `SETTINGS_HEADER_TABLE_SIZE` (4 KB default); a 1.2 KB JWT plus other headers can evict each other."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-12',
      difficulty: 'expert',
      question:
        'This Node service makes many outbound calls to hundreds of distinct tenant hostnames (no keep-alive). Under load, unrelated file reads and bcrypt hashing slow dramatically, though CPU is only at 40%. What is going on?',
      code: {
        language: 'typescript',
        code: `import { request } from 'node:https';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcrypt';

// called ~800 times/s, each to a different tenant host
export const callTenant = (host: string) =>
  new Promise((ok, fail) => request({ host, path: '/hook' }, ok).on('error', fail).end());

export const loadTemplate = () => readFile('/app/tpl.html', 'utf8');
export const hash = (pw: string) => bcrypt.hash(pw, 12);`,
      },
      options: [
        "dns.lookup's getaddrinfo calls run on the libuv threadpool (4 threads by default), and slow lookups occupy it, queuing fs and crypto work",
        'Outbound TLS handshakes run on the main thread and starve the event loop',
        'Each TLS connection spawns a worker thread, and thread creation overhead dominates',
        'readFile competes with sockets for file descriptors and is throttled by the kernel',
      ],
      correct: [0],
      explanation:
        'Node resolves hostnames with getaddrinfo on the libuv threadpool, which is shared with fs, crypto (pbkdf2/scrypt), zlib and native addons like bcrypt; a few slow DNS lookups can occupy all 4 threads and queue unrelated work while the CPU stays idle. TLS handshake crypto on the main thread would show high CPU. Node does not spawn a thread per connection, and fd contention would cause EMFILE errors, not slowness. Fixes: DNS caching, keep-alive, and a larger UV_THREADPOOL_SIZE.',
      followUps: [
        {
          "q": "You raise UV_THREADPOOL_SIZE to 64. Is that a complete fix? What would you do instead or in addition?",
          "a": "It's mitigation, not a fix: slow DNS still blocks 64 threads, and bcrypt and fs now share a bigger pool with more contention and memory (each thread has a stack). Better: cache DNS in-process (e.g. `cacheable-lookup` with a TTL that respects records), so most connects skip getaddrinfo; use keep-alive agents so lookups happen only on new connections; or use `dns.resolve*` via c-ares, which runs asynchronously off the threadpool, through a custom `lookup` function. Also move CPU-heavy bcrypt to a worker_threads pool sized to cores so it can't be starved, and alert on event-loop lag and threadpool queue time."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-13',
      difficulty: 'hard',
      question:
        'Your mobile users spend ~40% of first-request time in TLS handshakes to a single-region origin. Select ALL changes that meaningfully reduce handshake cost.',
      options: [
        'Enable TLS 1.3 and session resumption with ticket keys shared across all TLS terminators',
        'Terminate TLS at CDN/edge POPs close to users, with pooled connections back to origin',
        'Increase the RSA key size to 4096 bits to reduce the chance of renegotiation',
        'Switch to ECDSA certificates with a short chain and enable OCSP stapling',
        'Disable HTTP keep-alive so each request gets a fresh, less congested connection',
      ],
      correct: [0, 1, 3],
      explanation:
        'TLS 1.3 saves an RTT and shared-key resumption avoids full handshakes; edge termination shortens each handshake RTT; ECDSA plus short chains and stapling shrink the first flight and remove a CA lookup. Larger RSA keys make handshakes slower and chains bigger, and TLS 1.3 has no renegotiation at all. Disabling keep-alive multiplies handshakes rather than reducing them.',
      followUps: [
        {
          "q": "You share session ticket keys across all TLS terminators. What security requirement does that create?",
          "a": "Ticket keys encrypt resumption state; anyone holding a key can decrypt tickets and, with TLS 1.2 resumption, compromise forward secrecy for those sessions. So: rotate keys frequently (for example every 12–24 hours, keeping the previous key for decryption only for a short overlap), distribute them via a secret manager over authenticated channels, keep them only in memory and never on disk or in images, and scope them per region or tenant to limit blast radius. TLS 1.3 PSK with (EC)DHE resumption keeps forward secrecy for the new session, so prefer psk_dhe_ke mode. Monitor the resumption rate to confirm it works."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-14',
      difficulty: 'medium',
      question:
        'You are designing the transport for a real-time multiplayer game that sends player positions 30 times per second. Which approach fits best?',
      options: [
        'TCP with TCP_NODELAY, since reliable ordered delivery guarantees every client sees every position',
        'Long-lived HTTP/1.1 connections with pipelining so position updates queue efficiently',
        'HTTP/2 server-sent streams, since multiplexing avoids head-of-line blocking between players',
        'UDP with application-level sequence numbers so clients discard stale snapshots, plus a small reliable channel for critical events',
      ],
      correct: [3],
      explanation:
        'Position snapshots are superseded 33ms later, so retransmitting a lost one is wasted latency; UDP with sequence numbers lets clients drop stale packets while critical events (a kill, a purchase) use a reliable layer. TCP would stall newer positions behind a lost old one (HOL blocking) even with TCP_NODELAY. HTTP/2 still runs over TCP, and HTTP/1.1 pipelining is both HOL-blocked and unsupported in practice.',
      followUps: [
        {
          "q": "The game must also run in browsers, where raw UDP isn't available. What do you use?",
          "a": "Use WebRTC data channels configured as unordered and unreliable (`ordered: false, maxRetransmits: 0`) for position updates: they run over SCTP on DTLS on UDP, giving UDP-like behaviour in the browser. Use a separate reliable, ordered channel for critical events. WebTransport over HTTP/3 is a newer option with unreliable datagrams and reliable streams on one QUIC connection, and it is simpler to host server-side than WebRTC's ICE/STUN/TURN machinery. Keep a WebSocket fallback for networks that block UDP, accepting HOL blocking on those clients. Keep the application-level sequence numbers either way."
        }
      ],
    },
    {
      id: 'net-protocols-mcq-15',
      difficulty: 'expert',
      question:
        'Despite the upstream keepalive directive, packet captures show nginx opening a new TCP connection to the Node backends for nearly every request. Which fix is required?',
      code: {
        language: 'nginx',
        code: `upstream orders_backend {
    server 10.0.1.10:3000;
    server 10.0.1.11:3000;
    keepalive 64;
}

server {
    listen 443 ssl;
    location /orders/ {
        proxy_pass http://orders_backend;
    }
}`,
      },
      options: [
        'Raise keepalive to 1024, because 64 idle connections are exhausted under load and nginx falls back to new connections',
        'Set keepalive_timeout 0 in the server block so connections are never timed out on the client side',
        'Enable http2 on the upstream block, because the keepalive directive only applies to HTTP/2 upstreams',
        'Add proxy_http_version 1.1 and proxy_set_header Connection "", because nginx defaults to HTTP/1.0 with Connection: close to upstreams',
      ],
      correct: [3],
      explanation:
        'nginx proxies with HTTP/1.0 and sends Connection: close by default, so upstream keepalive never takes effect until you set proxy_http_version 1.1 and clear the Connection header. A small keepalive pool would still reuse most connections under steady load, and open-source nginx does not proxy HTTP/2 to upstreams for plain proxy_pass. keepalive_timeout governs client-side connections, and setting it to 0 would disable client keep-alive entirely.',
      followUps: [
        {
          "q": "Keepalive now works, but you see occasional 502s with 'upstream prematurely closed connection' on idle-then-busy patterns. What's the remaining setting?",
          "a": "Idle timeouts are mismatched. nginx keeps idle upstream connections for `keepalive_timeout` (default 60 s in the upstream block), while Node closes them after `keepAliveTimeout` (5 s default). nginx reuses a socket that Node is closing, so the request fails. Make the upstream server's idle timeout longer than nginx's: `server.keepAliveTimeout = 65000` and `headersTimeout = 66000` on Node, or lower nginx's upstream `keepalive_timeout` below Node's. Add `proxy_next_upstream error timeout` with `proxy_next_upstream_tries 2` for idempotent methods so a rare race is retried transparently."
        }
      ],
    },
  ],
};

export default topic;
