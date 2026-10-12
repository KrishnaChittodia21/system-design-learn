import type { Topic } from '../../types';

const topic: Topic = {
  id: 'net-realtime',
  phase: 'networking',
  order: 2,
  title: 'REST vs gRPC vs WebSockets vs SSE vs Long Polling',
  subtitle:
    'Pick the right transport, then make it survive scale: connection servers, pub/sub fan-out, heartbeats, backpressure, reconnect storms and C1M capacity.',
  estimatedMinutes: 75,
  sources: [
    'Alex Xu — System Design Interview Vol 2, Ch 2 Nearby Friends',
    'Mastering API Architecture — Ch 1 (REST, gRPC, GraphQL)',
    'RFC 6455 (WebSocket), WHATWG HTML Living Standard (Server-Sent Events), gRPC docs',
  ],
  tags: ['websocket', 'sse', 'long-polling', 'grpc', 'rest', 'pub-sub', 'redis', 'backpressure', 'realtime', 'c10k'],
  cheatSheet: [
    'Decision: request/response → REST (public) or gRPC (internal, typed, streaming); server→client push only → SSE; bidirectional low-latency → WebSocket; must work everywhere with minimal infra → long polling.',
    'SSE = one long HTTP response of "id:/event:/data:" lines; browser auto-reconnects and sends Last-Event-ID, so the server must be able to REPLAY from that id (Redis Streams/Kafka), not just pub/sub.',
    'WebSocket = HTTP/1.1 Upgrade → 101 Switching Protocols → framed full-duplex TCP. Stateful: needs sticky routing, draining on deploy, and a pub/sub backplane to reach users on other nodes.',
    'Alex Xu Nearby Friends: 10M concurrent × update/30s ≈ 334K updates/s; × 400 friends × 10% online ≈ 14M pushes/s → ~140 Redis pub/sub nodes (CPU-bound, not memory-bound at ~200GB).',
    'Heartbeat interval must be shorter than the smallest idle timeout on the path (ALB and nginx default 60s) — 20–30s pings; terminate if no pong within one interval.',
    'Backpressure: check ws.bufferedAmount before send; conflate (latest-wins) or drop for slow consumers; disconnect past a hard cap. Unbounded buffers = OOM on the connection server.',
    'Reconnect storms: exponential backoff with FULL jitter, staggered draining (close 1012 + retry hint), resumption tokens so reconnects skip the full auth path.',
    'gRPC: HTTP/2 + protobuf, 4 modes (unary, server-stream, client-stream, bidi). Long-lived HTTP/2 connections defeat L4 load balancing → use L7/mesh or client-side LB + MAX_CONNECTION_AGE.',
    'Capacity: 100K–1M idle connections per tuned box is realistic (WhatsApp ~2M/box in 2012); limits are FDs, memory per socket (~10–50KB incl. app state), and 4-tuple ephemeral ports on proxies.',
    'Delivery over sockets is at-most-once by default. For "no lost messages": per-stream sequence numbers + durable log + client acks/resume cursor.',
  ],
  sections: [
    {
      heading: '1. The decision space in one table',
      body: `**Intuition:** REST is sending letters, long polling is waiting at the post office until a letter arrives, SSE is a radio broadcast you tune into, WebSocket is a phone call, and gRPC is a phone call where both sides speak a strict, compact, pre-agreed language.

The real question in an interview is never "which is best?" but **who initiates, how often, in which direction, and what happens when the connection drops?**

| | REST/JSON | gRPC | Long polling | SSE | WebSocket |
|---|---|---|---|---|---|
| Direction | client→server req/resp | req/resp + 3 streaming modes | server→client (simulated push) | server→client only | full duplex |
| Transport | HTTP/1.1, 2, 3 | HTTP/2 (browsers need gRPC-Web proxy) | plain HTTP | plain HTTP (text/event-stream) | HTTP Upgrade → raw frames over TCP |
| Payload | text (JSON) | binary protobuf | any | UTF-8 text only | text or binary frames |
| Reconnect / resume | n/a | app-level | natural (each poll is new) | **built-in** (Last-Event-ID, retry) | **you build it** |
| Proxies / CDNs | excellent | needs HTTP/2 end-to-end | excellent | good (disable buffering) | mostly fine on 443, needs upgrade support |
| Server state | stateless | stateless per RPC; stateful per stream | held request, cheap-ish | open connection | open connection + session |
| Typical use | public APIs, CRUD | internal service calls, mobile with codegen | legacy push, fallbacks | feeds, notifications, LLM token streaming, dashboards | chat, collaboration, games, trading, live location |

**Rules of thumb a senior would state:**
- Default to **REST** for public request/response; to **gRPC** for internal east-west calls where typed contracts, deadlines and streaming matter.
- If data flows **only server→client**, prefer **SSE** — it is plain HTTP, auto-reconnects and works with HTTP/2 multiplexing. Pick WebSocket only when the client also sends frequent low-latency messages.
- Long polling is the "works through anything" fallback (Socket.IO and many chat SDKs start with it and upgrade).
- For mobile apps in the background, none of these survive — the OS kills sockets. Use **APNs/FCM push** to wake the app, then sync over HTTP.`,
      keyPoints: [
        'Ask: direction, frequency, latency budget, fan-out, and what happens on disconnect.',
        'SSE beats WebSocket for one-way push because reconnection and resume are built in.',
        'Stateful connections move complexity into routing, deploys and capacity planning.',
      ],
      source: 'Mastering API Architecture — Ch 1',
    },
    {
      heading: '2. Short polling vs long polling — mechanics and costs',
      body: `**Intuition:** short polling asks "anything new?" every N seconds and usually hears "no". Long polling asks once and the server **holds the request open** until there is data or a timeout, then the client immediately asks again.

**Short polling cost:** 10M clients polling every 5s = **2M requests/s**, nearly all empty, each carrying ~500–800 bytes of headers plus TLS and auth work. Latency is on average half the interval.

**Long polling mechanics:**
1. Client sends GET /events?cursor=123.
2. Server checks for data after the cursor; if present, respond immediately.
3. Otherwise, park the request (register a waiter keyed by user/channel) and set a timer **shorter than every idle timeout on the path** (ALB default 60s, nginx proxy_read_timeout default 60s) — 25–30s is typical.
4. On data or timeout, respond (200 with events, or 204). The client re-polls immediately with the new cursor.

**Gotchas:**
- The **cursor** is what makes it correct: events that arrive between two polls are not lost because the next poll asks "after 123".
- Every held request is an open socket — memory and FD cost is similar to a WebSocket, but you also pay a full HTTP request per message burst.
- The server that holds the request may not be the server that receives the event — you still need a pub/sub backplane (Redis, NATS) or a shared log.
- Waiters must be removed when the client disconnects (req.on('close')), or you leak timers and listeners.

**Say in interviews:** "Long polling gives near-real-time latency with zero special infrastructure, at the cost of one HTTP round trip per delivery and a thundering-herd re-poll after every broadcast. I would use it as a fallback, not the primary transport at high fan-out."`,
      code: [
        {
          language: 'typescript',
          title: 'Long-poll endpoint with cursor, timeout below LB idle, and cleanup',
          code: `import express from 'express';
import { EventEmitter } from 'node:events';

const app = express();
const bus = new EventEmitter();            // fed by a Redis/NATS subscriber in real life
bus.setMaxListeners(0);                    // many parked requests per channel

const HOLD_MS = 25_000;                    // must stay below ALB/nginx 60s idle timeouts

app.get('/v1/inbox/:userId/poll', async (req, res) => {
  const { userId } = req.params;
  const cursor = Number(req.query.cursor ?? 0);

  // 1. Fast path: anything already after the cursor? (durable store, not memory)
  const pending = await loadEventsAfter(userId, cursor, 100);
  if (pending.length) return res.json({ events: pending, cursor: pending[pending.length - 1].seq });

  // 2. Park the request until an event arrives or we time out.
  const channel = 'inbox:' + userId;
  const onEvent = async () => {
    cleanup();
    const events = await loadEventsAfter(userId, cursor, 100); // re-read: no gaps
    res.json({ events, cursor: events.length ? events[events.length - 1].seq : cursor });
  };
  const timer = setTimeout(() => { cleanup(); res.status(204).end(); }, HOLD_MS);
  const cleanup = () => { clearTimeout(timer); bus.off(channel, onEvent); };

  bus.once(channel, onEvent);
  req.on('close', cleanup);                // client went away: release timer + listener
});

async function loadEventsAfter(userId: string, cursor: number, limit: number) {
  // SELECT seq, payload FROM inbox WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3
  return [] as { seq: number; payload: unknown }[];
}

app.listen(3000);`,
        },
      ],
    },
    {
      heading: '3. Server-Sent Events — the underrated default for push',
      body: `**Intuition:** SSE is a normal HTTP response that simply never ends. The server keeps writing small text records; the browser's EventSource parses them and fires events.

**Wire format** (Content-Type: text/event-stream), records separated by a blank line:
- id: 1042 — the browser remembers the last id it saw.
- event: price — optional event type.
- data: {"sym":"AAPL","px":231.4} — payload (UTF-8 text; multiple data lines are joined with newlines).
- retry: 5000 — tells the client how long to wait before reconnecting.
- Lines starting with a colon are **comments** — perfect for heartbeats (": ping").

**Built-in resilience:** when the connection drops, EventSource reconnects automatically and sends the **Last-Event-ID** header. That is only useful if your server can **replay** from that id — which means the source must be a log (Redis Streams, Kafka, a DB table with a sequence), not fire-and-forget pub/sub.

**Production gotchas:**
- **Buffering proxies/middleware**: nginx buffers upstream responses by default; set proxy_buffering off (or send the X-Accel-Buffering: no header). Gzip/compression middleware that buffers will also delay events by minutes.
- **HTTP/1.1 limit of 6 connections per origin per browser**: the 7th tab's EventSource hangs. HTTP/2 multiplexes many streams over one connection (typically 100+ concurrent streams), which removes the problem.
- **No custom headers** in the native EventSource API — auth is via cookies (withCredentials for CORS) or a short-lived token in the URL; libraries like fetch-event-source add header support.
- **Text only** — binary must be base64-encoded (~33% overhead).

SSE is exactly what LLM APIs use to stream tokens: one-way, ordered, cheap, HTTP-native.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS SSE with Last-Event-ID replay from Redis Streams',
          code: `import { Controller, Headers, MessageEvent, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';

@Controller('v1/orders')
export class OrderEventsController {
  constructor(private readonly redis: Redis) {}

  @Sse(':orderId/events')
  stream(
    @Param('orderId') orderId: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((sub) => {
      const reader = this.redis.duplicate();   // XREAD BLOCK needs its own connection
      let cursor = lastEventId ?? '$';          // '$' = only new entries; else replay gap
      let closed = false;

      (async () => {
        while (!closed) {
          // Blocks up to 15s; returns entries strictly after cursor.
          const res = await reader.xread('COUNT', 100, 'BLOCK', 15_000,
            'STREAMS', 'order:' + orderId, cursor);
          if (!res) { sub.next({ type: 'ping', data: '' }); continue; } // keep-alive
          for (const [, entries] of res) {
            for (const [id, fields] of entries) {
              cursor = id;                       // Redis stream id doubles as SSE id
              sub.next({ id, type: 'order', data: fields[1] });
            }
          }
        }
      })().catch((err) => sub.error(err));

      return () => { closed = true; reader.disconnect(); }; // client disconnected
    });
  }
}`,
        },
        {
          language: 'nginx',
          title: 'Proxying SSE without buffering',
          code: `location /v1/orders/ {
    proxy_pass http://orders_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection '';     # keep upstream connection alive
    proxy_buffering off;                # flush each event immediately
    proxy_cache off;
    proxy_read_timeout 1h;              # stream may be idle between heartbeats
    gzip off;                           # compression buffers small writes
}`,
        },
      ],
      keyPoints: [
        'Auto-reconnect + Last-Event-ID is only half the story — the server must replay from a durable log.',
        'Disable proxy buffering and compression on the SSE path.',
        'Serve SSE over HTTP/2 to escape the 6-connections-per-origin limit.',
      ],
    },
    {
      heading: '4. WebSockets — handshake, frames, and why they are stateful',
      body: `**Intuition:** a WebSocket starts as an HTTP request that asks to "switch languages". After the server agrees, the TCP connection stops speaking HTTP and both sides can send framed messages at any time.

**Handshake (RFC 6455):** the client sends GET with Upgrade: websocket, Connection: Upgrade, Sec-WebSocket-Key and Sec-WebSocket-Version: 13. The server replies **101 Switching Protocols** with Sec-WebSocket-Accept (SHA-1 of the key + a fixed GUID, base64). From then on: frames with opcodes for text, binary, close, **ping** and **pong**. Client→server frames are masked (to defeat cache-poisoning on naive proxies). WebSocket over HTTP/2 exists (RFC 8441, extended CONNECT) but most deployments still use HTTP/1.1 upgrade.

**Close codes you should know:** 1000 normal, 1001 going away (server shutdown/tab closed), 1006 abnormal (no close frame — never sent on the wire, the client reports it), 1008 policy violation (e.g. auth failed), 1009 message too big, 1011 internal error, 1012 service restart, 1013 try again later.

**What "stateful" means operationally:**
- The connection is pinned to one server process for its lifetime. Load balancers must support upgrade and long idle timeouts; after that, no request-level balancing happens.
- A message for user B may originate on a server that does not hold B's socket → you need a **routing/backplane layer**.
- Deploys must **drain**: stop accepting new sockets, send close 1012 with jittered delay, let clients resume elsewhere.
- Security: the browser API **cannot set an Authorization header**; authenticate at upgrade via cookie or a short-lived ticket, and **validate the Origin header** to prevent cross-site WebSocket hijacking (cookies are sent automatically cross-origin).
- Set **maxPayload** — the default in many libraries is large (ws: 100 MiB), an easy memory DoS.`,
      diagram: `Client                                   Server
  | GET /ws HTTP/1.1                          |
  | Upgrade: websocket  Connection: Upgrade   |
  | Sec-WebSocket-Key: dGhlIHNhbXBsZQ==       |
  |------------------------------------------>|
  |        HTTP/1.1 101 Switching Protocols   |
  |        Sec-WebSocket-Accept: s3pPLM...    |
  |<------------------------------------------|
  |==== full-duplex frames on same TCP =======|
  | [text] {"type":"msg","to":"u42"}  ------> |
  | <------ [text] {"type":"ack","seq":17}    |
  | <------ [ping]            [pong] ------>  |
  | <------ [close 1012 "restart"]            |`,
      source: 'RFC 6455',
    },
    {
      heading: '5. gRPC — contracts, streaming and the load-balancing trap',
      body: `**Intuition:** gRPC is "call a function on another machine" with a strict schema (protobuf), code generation in every language, and HTTP/2 underneath so many calls share one connection.

**Why teams pick it for internal traffic:**
- **Protobuf** payloads are typically 3–10× smaller than JSON and much cheaper to parse; field numbers (not names) go on the wire, so renames are free but **reusing a field number is a breaking change** — mark removed numbers as reserved.
- **Four modes:** unary, server streaming (subscribe to updates), client streaming (upload telemetry), bidirectional streaming (chat-like, both sides independent).
- **Deadlines** are first-class: the caller sets an absolute deadline, and well-behaved servers propagate the remaining budget downstream so work is abandoned when the caller has given up (DEADLINE_EXCEEDED).
- Rich status codes (UNAVAILABLE is retryable, INVALID_ARGUMENT is not), interceptors ≈ NestJS interceptors.

**The trap — HTTP/2 connection pinning:** a gRPC client opens **one long-lived HTTP/2 connection** and multiplexes all RPCs on it. An **L4** load balancer (NLB, kube-proxy ClusterIP) balances *connections*, not requests, so when you scale 3 → 12 pods the new pods get almost nothing. Fixes: an **L7** proxy that balances per request (Envoy, a service mesh, ALB with gRPC support), **client-side load balancing** (headless Service DNS + round_robin policy / xDS), and server **MAX_CONNECTION_AGE** so clients periodically reconnect (the server sends GOAWAY and clients re-resolve).

**Browsers** cannot speak native gRPC (no control over HTTP/2 frames/trailers) — use gRPC-Web via Envoy, or Connect protocol, or keep REST/GraphQL at the edge.

**Where it fits vs REST/GraphQL:** REST at the public edge (cacheable, curl-able, universal), GraphQL for client-driven aggregation, gRPC between services and for mobile clients with codegen.`,
      code: [
        {
          language: 'protobuf',
          title: 'A service using all streaming shapes, with safe evolution',
          code: `syntax = "proto3";
package market.v1;

service Quotes {
  rpc GetQuote(GetQuoteRequest) returns (Quote);                 // unary
  rpc Subscribe(SubscribeRequest) returns (stream Quote);        // server streaming
  rpc UploadTicks(stream Tick) returns (UploadSummary);          // client streaming
  rpc Trade(stream OrderMsg) returns (stream ExecutionReport);   // bidirectional
}

message Quote {
  string symbol = 1;
  int64 price_micros = 2;      // fixed-point: never float for money
  int64 ts_unix_ms = 3;
  reserved 4;                  // removed 'exchange' field — number must never be reused
  reserved "exchange";
  uint64 seq = 5;              // per-symbol sequence: lets clients detect gaps on resume
}

message GetQuoteRequest { string symbol = 1; }
message SubscribeRequest { repeated string symbols = 1; uint64 resume_from_seq = 2; }
message Tick { string symbol = 1; int64 price_micros = 2; }
message UploadSummary { uint32 accepted = 1; }
message OrderMsg { string client_order_id = 1; string symbol = 2; int64 qty = 3; }
message ExecutionReport { string client_order_id = 1; string status = 2; }`,
        },
        {
          language: 'yaml',
          title: 'Kubernetes: headless Service so gRPC clients can balance per pod',
          code: `apiVersion: v1
kind: Service
metadata:
  name: quotes
spec:
  clusterIP: None            # headless: DNS returns every pod IP, not one virtual IP
  selector:
    app: quotes
  ports:
    - name: grpc
      port: 50051
      targetPort: 50051
# Client: target 'dns:///quotes.default.svc.cluster.local:50051'
# with loadBalancingConfig [{ round_robin: {} }], and set server
# grpc.max_connection_age_ms (e.g. 5 min) so clients re-resolve new pods.`,
        },
      ],
      source: 'Mastering API Architecture — Ch 1 (gRPC)',
    },
    {
      heading: '6. Scaling WebSockets: connection servers + pub/sub fan-out',
      body: `**Intuition:** separate the switchboard (who is connected where) from the brains (business logic). Connection servers only hold sockets; a pub/sub backplane gets each message to whichever server holds the recipient.

**Alex Xu's Nearby Friends design (Vol 2, Ch 2):**
- 100M DAU, 10% concurrent = **10M live WebSocket connections**; each client reports location every 30s → **~334K updates/s**.
- Each user has ~400 friends; assume ~10% online and nearby → each update fans out to ~40 friends → **~14M pushes/s**.
- WebSocket servers are stateful and hold the connections; stateless API servers handle friends/profile CRUD behind the same LB.
- **Redis pub/sub with one channel per user**: when user A connects, A's WebSocket handler subscribes to the channels of all of A's friends; each location update is published to A's own channel; every subscriber handler receives it, computes distance, and pushes to its client only if within the radius.
- Sizing: memory is small (~100M channels × 100 subscribers × 20 bytes ≈ **200GB**, two big boxes), but **CPU/network is the bottleneck**: at ~100K pushes/s per Redis node, 14M/s needs **~140 Redis servers**. Channels are distributed via a **consistent-hash ring** stored in service discovery (etcd/ZooKeeper); resizing moves channels, so do it during low traffic and have clients resubscribe.

**General pattern for chat/notifications:**
1. **Connection registry**: userId → connection-server id (Redis hash with TTL refreshed by heartbeat), or skip it and use per-user channels.
2. **Routing**: publish to user:{id} (per-user channel) or to a server:{id} channel (fewer channels, needs the registry).
3. **Durability**: pub/sub is at-most-once. For chat, write to a durable store/log first (Kafka, Cassandra, Redis Streams), then use pub/sub only as a "wake up and fetch" signal.
4. **Redis Cluster caveat**: classic PUBLISH is broadcast to **every node** in the cluster over the cluster bus, so adding nodes does not scale pub/sub throughput. Redis 7 **sharded pub/sub** (SPUBLISH/SSUBSCRIBE) routes by the channel's hash slot.`,
      diagram: `          +------------ L4/L7 LB (upgrade, 1h idle) ------------+
          |                          |                          |
   +------v------+            +------v------+            +------v------+
   |  WS node 1  |            |  WS node 2  |    ...     |  WS node N  |
   |  A, C socks |            |  B, D socks |            |  E ... socks|
   +--+-------^--+            +--+-------^--+            +--+-------^--+
      |pub    |sub               |pub    |sub               |pub    |sub
   +--v-------+------------------v-------+------------------v-------+--+
   |  Pub/sub backplane (Redis sharded pub/sub / NATS) ch = user:{id}  |
   +--------------------------------+----------------------------------+
                                    | durable write first (chat)
                              +-----v------+     +---------------+
                              | Kafka/Log  |---->| history store |
                              +------------+     +---------------+`,
      code: [
        {
          language: 'typescript',
          title: 'Connection server: per-user channels over Redis (ioredis + ws)',
          code: `import { WebSocketServer, WebSocket } from 'ws';
import Redis from 'ioredis';

const pub = new Redis(process.env.REDIS_URL!);
const sub = new Redis(process.env.REDIS_URL!);   // subscriber-mode connection is dedicated
const local = new Map<string, Set<WebSocket>>(); // userId -> sockets on THIS node

const wss = new WebSocketServer({ port: 8080, maxPayload: 64 * 1024 });

wss.on('connection', async (ws, req) => {
  const userId = await authenticateUpgrade(req);  // cookie/ticket + Origin check
  if (!userId) return ws.close(1008, 'unauthorized');

  let sockets = local.get(userId);
  if (!sockets) {
    sockets = new Set();
    local.set(userId, sockets);
    await sub.subscribe('user:' + userId);        // first socket for this user here
  }
  sockets.add(ws);

  ws.on('close', async () => {
    sockets!.delete(ws);
    if (sockets!.size === 0) {
      local.delete(userId);
      await sub.unsubscribe('user:' + userId);    // avoid leaking subscriptions
    }
  });
});

sub.on('message', (channel, payload) => {
  const userId = channel.slice('user:'.length);
  for (const ws of local.get(userId) ?? []) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
});

// Any service can reach a user without knowing which node holds the socket.
export const pushToUser = (userId: string, msg: object) =>
  pub.publish('user:' + userId, JSON.stringify(msg));

declare function authenticateUpgrade(req: import('http').IncomingMessage): Promise<string | null>;`,
        },
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 2 Nearby Friends',
    },
    {
      heading: '7. Heartbeats, dead peers and reconnection',
      body: `**Intuition:** a TCP connection can be "open" on your server long after the phone went into a tunnel. Without traffic, nobody notices — so both sides must periodically prove they are alive.

**Why TCP keepalive is not enough:** Linux defaults send the first keepalive probe after **2 hours** idle (tcp_keepalive_time = 7200s). Meanwhile, NAT gateways, mobile carriers and load balancers drop idle flows after 30s–5min (AWS ALB default idle timeout 60s, NAT gateways ~350s). You need **application heartbeats**.

**Heartbeat design:**
- Server sends a WebSocket **ping** every 20–30s (below the smallest idle timeout); browsers auto-reply with pong. If no pong arrives before the next tick, **terminate()** (not close() — a close handshake with a dead peer just waits).
- Browsers cannot send protocol pings from JavaScript, so if the client needs to detect a dead server, send an app-level {"type":"ping"} message and expect a reply.
- For SSE, send comment lines (": ping") every ~15s; for long polling, the poll timeout itself is the heartbeat.
- Heartbeats cost: 10M connections / 25s = **400K pings/s** fleet-wide — cheap per node, but budget it.

**Reconnection done right (client):**
- **Exponential backoff with full jitter**: delay = random(0, min(cap, base × 2^attempt)). Without jitter, a node crash makes 100K clients reconnect in lock-step waves.
- **Resume token + last seen sequence number** so reconnect skips expensive auth and requests only missed messages.
- Honour server hints: close code 1013/1012 plus a retry-after in the close reason or a prior control message.`,
      code: [
        {
          language: 'typescript',
          title: 'Server heartbeat (ws) — terminate peers that miss a pong',
          code: `import { WebSocketServer, WebSocket } from 'ws';

type LiveSocket = WebSocket & { isAlive?: boolean };
const wss = new WebSocketServer({ port: 8080 });
const HEARTBEAT_MS = 25_000;                    // < 60s ALB/nginx idle timeouts

wss.on('connection', (ws: LiveSocket) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });  // browsers answer pings automatically
});

const interval = setInterval(() => {
  for (const client of wss.clients as Set<LiveSocket>) {
    if (!client.isAlive) { client.terminate(); continue; } // missed last pong: dead
    client.isAlive = false;                     // must be re-armed by the next pong
    client.ping();
  }
}, HEARTBEAT_MS);

wss.on('close', () => clearInterval(interval));`,
        },
        {
          language: 'typescript',
          title: 'Client reconnect with full jitter and resume cursor',
          code: `export function connect(url: string, onMsg: (m: { seq: number }) => void) {
  let attempt = 0;
  let lastSeq = Number(localStorage.getItem('lastSeq') ?? 0);

  const open = () => {
    const ws = new WebSocket(url + '?resumeFrom=' + lastSeq);
    ws.onopen = () => { attempt = 0; };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.seq <= lastSeq) return;           // duplicate from replay: ignore
      lastSeq = msg.seq;
      localStorage.setItem('lastSeq', String(lastSeq));
      onMsg(msg);
    };
    ws.onclose = (e) => {
      if (e.code === 1008) return;              // auth/policy failure: do not hammer
      const cap = 30_000, base = 500;
      const delay = Math.random() * Math.min(cap, base * 2 ** attempt++); // full jitter
      setTimeout(open, delay);
    };
  };
  open();
}`,
        },
      ],
    },
    {
      heading: '8. Backpressure and slow consumers',
      body: `**Intuition:** if you pour water into a funnel faster than it drains, it overflows. A client on a 3G link draining 20KB/s cannot absorb a 500KB/s price feed — the bytes pile up in your server's memory.

**Where the bytes pile up:** ws.send() never blocks. Data goes to the kernel socket send buffer; when that is full (the client's TCP receive window is closed), the library queues in user space. The ws library exposes this as **ws.bufferedAmount**. With 50K sockets on a node and a few thousand slow ones each buffering megabytes, the process OOMs — and takes every healthy connection on the node with it.

**Strategies (combine them):**
- **Measure**: check bufferedAmount before each send; export a histogram metric.
- **Conflate / latest-wins**: for state-like data (prices, locations, cursors) keep only the newest value per key and send when the socket drains. Clients want the current price, not 400 stale ones.
- **Drop with a gap marker**: for non-critical events, drop and tell the client "you missed seq 100–180, refetch via REST".
- **Disconnect** past a hard cap (e.g. 1–4 MB) with 1013 "try again later" — protecting the node beats serving one bad client.
- **Rate-limit inbound** messages per connection too (a client flooding you is the mirror problem).
- For gRPC streams, HTTP/2 **flow control** gives real backpressure: the stream write callback signals when to pause; honour it instead of buffering in an array.`,
      code: [
        {
          language: 'typescript',
          title: 'Conflating sender: latest value per key, bounded buffer',
          code: `import { WebSocket } from 'ws';

const SOFT_LIMIT = 256 * 1024;       // start conflating above 256KB buffered
const HARD_LIMIT = 4 * 1024 * 1024;  // disconnect above 4MB

export class ConflatingSender {
  private pending = new Map<string, string>(); // key -> latest serialized update
  private timer?: NodeJS.Timeout;

  constructor(private ws: WebSocket) {}

  push(key: string, update: object) {
    if (this.ws.bufferedAmount > HARD_LIMIT) {
      this.ws.close(1013, 'slow consumer');     // protect the node
      return;
    }
    const data = JSON.stringify(update);
    if (this.ws.bufferedAmount < SOFT_LIMIT && this.pending.size === 0) {
      this.ws.send(data);                        // fast path: healthy client
      return;
    }
    this.pending.set(key, data);                 // overwrite older value for same key
    this.timer ??= setTimeout(() => this.flush(), 50);
  }

  private flush() {
    this.timer = undefined;
    if (this.ws.readyState !== WebSocket.OPEN) return this.pending.clear();
    for (const [key, data] of this.pending) {
      if (this.ws.bufferedAmount >= SOFT_LIMIT) break;  // still congested: wait
      this.ws.send(data);
      this.pending.delete(key);
    }
    if (this.pending.size) this.timer = setTimeout(() => this.flush(), 50);
  }
}`,
        },
      ],
      keyPoints: [
        'ws.send() never blocks — memory growth is the only symptom of a slow consumer.',
        'Conflate state, drop events with gap markers, disconnect past a hard cap.',
        'gRPC/HTTP2 has flow control; honour write() returning false.',
      ],
    },
    {
      heading: '9. Capacity per server: from C10K to C1M',
      body: `**Intuition:** an idle connection is mostly just memory and a file descriptor. Modern event-loop servers (Node, Go, Netty, Erlang) can hold hundreds of thousands per box; the hard part is everything *around* the connection.

**History:** Dan Kegel's **C10K** problem (1999) was about thread-per-connection servers; epoll/kqueue event loops solved it. **C1M** is achievable with tuning — WhatsApp reported ~2M concurrent connections per Erlang/FreeBSD server (2012), and Phoenix demonstrated 2M WebSockets on one large box (2015).

**The real limits:**
| Limit | Typical default | Fix |
|---|---|---|
| File descriptors per process | ulimit -n 1024 | raise to 1M+ (LimitNOFILE in systemd/containers) |
| System-wide FDs | fs.file-max | raise |
| Memory per connection | kernel buffers (grow on demand) + app state; ~10–50KB realistic in Node incl. per-socket objects | avoid per-socket timers/closures, disable permessage-deflate (zlib state per socket) |
| Ephemeral ports (proxy → backend) | ~28K (32768–60999) per source IP → dest IP:port | more backend IPs/ports, multiple source IPs on the proxy |
| Accept queue / SYN backlog | net.core.somaxconn 4096 on modern kernels | raise for reconnect storms |
| CPU | TLS handshakes dominate during reconnects | TLS session resumption, terminate TLS at edge |

**Practical sizing:** plan for **100K–250K connections per Node process/box** in production rather than the benchmark maximum — you need headroom to absorb a neighbouring node's clients when it dies (N+1), and for GC pauses. The number of connections a node can *accept per second* during a reconnect storm (TLS + auth + subscriptions) is often the binding constraint, not the steady state.

**Ephemeral ports explained:** a TCP connection is identified by the 4-tuple (src IP, src port, dst IP, dst port). Clients arriving at your LB have millions of distinct src IPs, so no problem there. But the **LB → backend** hop has a single src IP and a single dst IP:port per backend, so only ~28K–64K concurrent connections fit per pair.`,
      code: [
        {
          language: 'bash',
          title: 'Kernel and process tuning for a 500K-connection node',
          code: `# Per-process and system-wide file descriptor limits
ulimit -n 1048576                                  # or LimitNOFILE=1048576 in systemd
sysctl -w fs.file-max=2097152
sysctl -w fs.nr_open=2097152

# Bigger accept backlog to survive reconnect storms
sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.tcp_max_syn_backlog=65535

# Proxy nodes: widen the ephemeral range (LB -> backend hop)
sysctl -w net.ipv4.ip_local_port_range="1024 65535"

# Keep per-socket buffers small by default; they grow on demand
sysctl -w net.ipv4.tcp_rmem="4096 16384 4194304"
sysctl -w net.ipv4.tcp_wmem="4096 16384 4194304"

# Verify live usage
ss -s                                              # socket summary
cat /proc/sys/fs/file-nr                           # allocated / free / max FDs`,
        },
      ],
    },
    {
      heading: '10. Deploying stateful connection servers & interview playbook',
      body: `**Intuition:** a stateless deploy is "swap the chef"; a WebSocket deploy is "move every seated diner to another table without spilling their soup".

**Draining playbook:**
1. Mark the node unready (fail readiness probe) so the LB sends no new upgrades.
2. Send close **1012 (service restart)** to connections **spread over a window** (e.g. 5–10 minutes, randomised), not all at once.
3. Clients reconnect with jitter and a resume token to healthy nodes; they request missed messages after their last sequence number.
4. Set terminationGracePeriodSeconds long enough for the drain (Kubernetes default is 30s — far too short for 100K sockets).
5. Watch: connections per node, reconnect rate, auth-service QPS, handshake latency.

**Delivery guarantees (the question every interviewer asks):** sockets are at-most-once. For "no message loss": assign a **monotonic per-conversation/per-user sequence**, persist before push, let clients **ack** or send their last-seen seq on reconnect, and replay the gap from the durable store. Dedupe on the client by seq/message id → effectively-once display.

**Interview playbook — say it in this order:**
1. Direction and frequency → pick transport (and name the fallback).
2. Connection tier vs logic tier; how a message finds the right node (backplane or registry).
3. Durability: what is persisted, sequence numbers, resume.
4. Liveness: heartbeat interval vs idle timeouts; reconnect with jitter.
5. Capacity: connections per node, fan-out rate, backplane throughput (Alex Xu's 14M/s → ~140 Redis nodes).
6. Operations: draining, backpressure, per-connection limits, auth at upgrade.`,
      keyPoints: [
        'Readiness-fail → staggered 1012 closes → jittered resume elsewhere.',
        'Persist-then-push with sequence numbers turns at-most-once sockets into lossless delivery.',
        'Capacity plan both steady-state connections and reconnect rate.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'net-realtime-cc-1',
      title: 'Make a single-node WebSocket chat server production-ready',
      context:
        'This chat gateway worked in the demo. In production it runs as 8 replicas behind an ALB. Users report messages that "sometimes never arrive", nodes slowly leak memory until OOM-killed, and a security review flagged the upgrade path.',
      task: 'Rewrite the gateway so that messages reach users on any replica, dead and slow connections cannot exhaust memory, and the upgrade path is authenticated and origin-checked. Keep the public message format the same.',
      starter: {
        language: 'typescript',
        title: 'chat-gateway.ts (naive)',
        code: `import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ port: 8080 });
const users = new Map<string, WebSocket>();   // userId -> socket

wss.on('connection', (ws, req) => {
  // userId passed by the client, e.g. wss://chat.example.com/?user=42
  const userId = new URL(req.url!, 'http://x').searchParams.get('user')!;
  users.set(userId, ws);

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());    // { to, text }
    const target = users.get(msg.to);
    if (target) {
      target.send(JSON.stringify({ from: userId, text: msg.text }));
    }
    // else: recipient offline, nothing to do
  });
});`,
      },
      hints: [
        'The users map only knows sockets on THIS replica, and it is keyed by an unverified query parameter. What happens with two tabs, or a recipient on replica 5?',
        'What removes an entry from the map when a phone disappears into a tunnel without sending a close frame? What bounds memory when the recipient reads slowly?',
        'Persist first, then publish a wake-up via a backplane; assign a sequence number so a reconnecting client can fetch what it missed.',
      ],
      solution: {
        language: 'typescript',
        title: 'chat-gateway.ts (production)',
        code: `import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage } from 'node:http';
import Redis from 'ioredis';

type Sock = WebSocket & { isAlive: boolean; userId: string };
const ALLOWED_ORIGINS = new Set(['https://chat.example.com']);
const pub = new Redis(process.env.REDIS_URL!);
const sub = new Redis(process.env.REDIS_URL!);
const local = new Map<string, Set<Sock>>();          // multiple tabs per user

const server = createServer();
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on('upgrade', async (req: IncomingMessage, socket, head) => {
  if (!ALLOWED_ORIGINS.has(req.headers.origin ?? '')) return socket.destroy(); // CSWSH
  const userId = await verifyTicket(req);             // short-lived, single-use ticket
  if (!userId) { socket.write('HTTP/1.1 401 Unauthorized\\r\\n\\r\\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const s = Object.assign(ws, { isAlive: true, userId });
    wss.emit('connection', s, req);
  });
});

wss.on('connection', async (ws: Sock) => {
  let set = local.get(ws.userId);
  if (!set) { set = new Set(); local.set(ws.userId, set); await sub.subscribe('user:' + ws.userId); }
  set.add(ws);
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (raw) => {
    let msg: { to: string; text: string; clientMsgId: string };
    try { msg = JSON.parse(raw.toString()); } catch { return ws.close(1003, 'bad json'); }
    if (!msg.to || typeof msg.text !== 'string' || msg.text.length > 4000) return;
    // Persist FIRST (idempotent on clientMsgId), get a per-recipient sequence number.
    const seq = await saveMessage(ws.userId, msg.to, msg.text, msg.clientMsgId);
    const out = JSON.stringify({ from: ws.userId, text: msg.text, seq });
    await pub.publish('user:' + msg.to, out);          // reaches any replica
    ws.send(JSON.stringify({ type: 'ack', clientMsgId: msg.clientMsgId, seq }));
  });

  ws.on('close', async () => {
    set!.delete(ws);
    if (set!.size === 0) { local.delete(ws.userId); await sub.unsubscribe('user:' + ws.userId); }
  });
});

sub.on('message', (channel, payload) => {
  for (const ws of local.get(channel.slice(5)) ?? []) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (ws.bufferedAmount > 1_000_000) { ws.close(1013, 'slow consumer'); continue; } // bound memory
    ws.send(payload);            // offline/slow clients recover via seq-based replay on reconnect
  }
});

setInterval(() => {                                    // reap dead peers
  for (const ws of wss.clients as Set<Sock>) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 25_000);

server.listen(8080);

declare function verifyTicket(req: IncomingMessage): Promise<string | null>;
declare function saveMessage(from: string, to: string, text: string, id: string): Promise<number>;`,
      },
      explanation: `**Fixes, in order of blast radius:**
- **Cross-replica delivery**: the in-memory map only covers one of 8 replicas, so roughly 7 of 8 messages were dropped. Per-user Redis channels make any replica able to reach any user.
- **Durability**: messages are persisted (idempotently on clientMsgId) *before* publish, with a per-recipient seq. Pub/sub is only the fast path. Offline or reconnecting clients replay after their last seq, so "recipient offline, nothing to do" no longer loses data.
- **Identity**: the user id came from an unverified query parameter, so anyone could impersonate anyone. Now a short-lived ticket is verified during the upgrade, and the **Origin** allow-list blocks cross-site WebSocket hijacking.
- **Multiple tabs**: Map<userId, Set<socket>> replaces last-writer-wins, which used to orphan earlier tabs.
- **Leaks**: a close handler removes sockets and unsubscribes. Ping/pong heartbeats terminate peers that vanished without a close frame, which is what used to leak memory.
- **Memory safety**: maxPayload is 16KB (the ws default is 100MiB), JSON parse errors are handled, text length is validated, and a bufferedAmount cap disconnects slow consumers before they OOM the node.
- **Acks**: the sender gets an ack with the server seq, so the client can retry safely with the same clientMsgId.`,
      followUps: [
        {
          "q": "Each replica calls `sub.subscribe` per connected user, so with 3M users across 30 pods Redis holds 3M channel subscriptions and every reconnect storm creates SUBSCRIBE spikes. How would you restructure the backplane?",
          "a": "Route by node instead of by user. Keep a presence map `user -> gatewayId` in Redis (set on connect, with a TTL refreshed by heartbeat), and give each gateway a single inbound channel or stream such as `gw:17`. The sender looks up the recipient's gateways and publishes once per gateway. Redis then holds 30 subscriptions instead of 3M, and a reconnect is just a presence write. The trade-off is an extra lookup per message and stale presence after crashes, which the TTL and the seq-based replay cover. For very large fan-out, use Redis 7 sharded pub/sub or Kafka partitions keyed by gateway."
        },
        {
          "q": "How do you test that a message is never lost when the recipient's replica is killed mid-delivery?",
          "a": "Write an integration test with real Redis and two or three gateway processes. Connect Bob to gateway B, send a stream of messages from Alice on gateway A with known clientMsgIds, and `SIGKILL` gateway B partway through. Bob's test client reconnects to gateway C with its last seen seq and replays. Assert that the set of seqs received equals the set persisted, with no gaps and duplicates removed by seq. Repeat with randomised kill timing in a loop, Jepsen-style. Also check that resending with the same clientMsgId after a missed ack does not create a second stored message."
        }
      ],
    },
    {
      id: 'net-realtime-cc-2',
      title: 'Fix an SSE endpoint that loses events and leaks resources',
      context:
        'A live order-tracking page uses this Express SSE endpoint behind nginx. Customers say updates show up in bursts minutes late, some status changes are never shown after their phone switches from Wi-Fi to 4G, and the Node process\'s Redis connection count climbs all day.',
      task: 'Make the stream deliver events immediately, survive reconnects without gaps or duplicates, stay alive through idle proxies, and release every resource when the client leaves.',
      starter: {
        language: 'typescript',
        title: 'order-stream.ts (naive)',
        code: `import express from 'express';
import compression from 'compression';
import Redis from 'ioredis';

const app = express();
app.use(compression());                        // global gzip

app.get('/orders/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');

  const sub = new Redis(process.env.REDIS_URL!);
  sub.subscribe('order:' + req.params.id);
  sub.on('message', (_channel, msg) => {
    res.write('data: ' + msg + '\\n\\n');       // no id
  });
  // nothing else: stream stays open until the client goes away
});

app.listen(3000);`,
      },
      hints: [
        'Two different layers are holding bytes back before they reach the browser. One is in this file; the other is in front of it.',
        'EventSource already sends Last-Event-ID on reconnect. What does the server need so that header is useful, and can plain Redis pub/sub provide it?',
        'List everything created per request (connections, timers, listeners) and make sure each one is torn down on req close.',
      ],
      solution: {
        language: 'typescript',
        title: 'order-stream.ts (production)',
        code: `import express from 'express';
import compression from 'compression';
import Redis from 'ioredis';

const app = express();
const redis = new Redis(process.env.REDIS_URL!);
// Compress everything EXCEPT event streams (gzip buffers small writes).
app.use(compression({ filter: (req, res) =>
  !String(res.getHeader('Content-Type') ?? '').includes('text/event-stream') &&
  compression.filter(req, res) }));

app.get('/orders/:id/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',                 // tell nginx not to buffer this response
  });
  res.write('retry: 3000\\n\\n');               // client reconnect delay hint

  const key = 'order:' + req.params.id;         // a Redis STREAM, not a pub/sub channel
  let cursor = (req.header('Last-Event-ID') as string | undefined) ?? '0'; // replay everything or the gap
  const reader = redis.duplicate();             // blocking XREAD needs a dedicated conn
  let open = true;

  const heartbeat = setInterval(() => res.write(': ping\\n\\n'), 15_000); // < proxy idle

  req.on('close', () => {                       // release everything we created
    open = false;
    clearInterval(heartbeat);
    reader.disconnect();
  });

  try {
    while (open) {
      const result = await reader.xread('COUNT', 50, 'BLOCK', 10_000, 'STREAMS', key, cursor);
      if (!result) continue;
      for (const [, entries] of result) {
        for (const [id, fields] of entries) {
          cursor = id;                          // strictly-after semantics: no dupes
          res.write('id: ' + id + '\\nevent: status\\ndata: ' + fields[1] + '\\n\\n');
        }
      }
    }
  } catch (err) {
    if (open) res.end();                        // connection error: let EventSource retry
  }
});

app.listen(3000);
// Producer side: XADD order:{id} MAXLEN ~ 1000 * data '{"status":"SHIPPED"}'`,
      },
      explanation: `**Fixes:**
- **Bursty delivery**: global compression buffered the small writes, and nginx proxy buffering (on by default) held them back again. Event streams are now excluded from compression and send **X-Accel-Buffering: no**. Cache-Control no-transform also stops intermediaries from rewriting the stream.
- **Lost events on network switch**: pub/sub has no memory, so any event published while the phone was reconnecting was gone. Events now live in a **Redis Stream** (capped with MAXLEN ~ 1000). Each SSE record carries the stream id, and on reconnect **Last-Event-ID** resumes strictly after that id, so there are no gaps and no duplicates.
- **Idle-timeout kills**: a status can go minutes without changing. A 15s comment heartbeat keeps nginx, the ALB and mobile NATs from reaping the connection. A **retry** hint sets the client's reconnect delay.
- **Connection leak**: every request used to open a brand-new Redis connection and never closed it. Now there is one duplicated connection per stream, and it is disconnected along with the heartbeat timer on req close. (At high fan-out, multiplex many streams over one XREAD loop per node instead of one connection per client.)
- **Headers**: the correct SSE headers are set once with writeHead, so the response flushes right away.`,
      followUps: [
        {
          "q": "The solution uses one dedicated Redis connection per open stream. At 50K concurrent streams per node, what breaks, and how do you redesign it?",
          "a": "50K blocking XREAD connections means 50K Redis client connections per Node process, each with its own socket and buffers, and Redis has to service them all. That hits `maxclients` (10K default) and wastes memory on both sides. Instead run one reader loop per node that does `XREAD BLOCK` across many stream keys at once, or across a per-shard fan-in stream, and dispatches entries to an in-memory `Map<orderId, Set<res>>`. Replay for a reconnecting client is a one-off non-blocking `XRANGE key (lastId +` before joining the shared loop. That cuts Redis connections from 50K to a handful."
        },
        {
          "q": "How do you write an automated test that proves Last-Event-ID resume has no gaps or duplicates?",
          "a": "Start the server against a real Redis (testcontainers). Open a raw HTTP client to the stream, XADD events 1–5, read them and record the last `id`. Close the connection, XADD events 6–8 while disconnected, then reconnect with the `Last-Event-ID` header set to that id. Assert the client receives exactly 6, 7, 8 in order. Add edge cases: reconnect with an id older than the MAXLEN trim (decide and test the behaviour, such as sending a 'resync' event), reconnect with no header, and verify on `req.destroy()` that the heartbeat interval is cleared and the Redis connection count returns to its baseline."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'net-realtime-iq-1',
      difficulty: 'expert',
      question:
        'Design the transport for live scores during a cricket World Cup final: 25M concurrent viewers on web and mobile, score changes every few seconds, commentary text, and a "reactions" button. Which protocols do you use and why?',
      context: 'The interviewer wants a transport decision justified by traffic shape, not a default to WebSockets.',
      whatInterviewerLooksFor: [
        'Separates the one-to-many broadcast (scores) from the many-to-one input (reactions)',
        'Recognises that everyone gets the same data, so it is cacheable at the edge',
        'Quantifies connection count and fan-out, and designs for reconnect storms at wickets/boundaries',
        'Covers mobile background behaviour and fallbacks',
      ],
      modelAnswer: `### Shape the traffic first
- **Scores/commentary**: server→client, *identical for everyone*, ~1 update / 5s, each ~200 bytes. That is a broadcast, not a conversation.
- **Reactions**: client→server, bursty (millions of taps after a six), and loss-tolerant. Aggregate counts are enough.

### Transport choice
- **Scores via SSE (HTTP/2)**, not WebSocket. It is one-way, auto-reconnects with Last-Event-ID, and is plain HTTP, so it can terminate at a **CDN/edge tier** that supports streaming. Some teams instead use **short polling of a CDN-cached JSON** with a 1–2s TTL. At 25M viewers that is 12.5M req/s at the edge but only ~1 req/s per POP at the origin, which is extremely robust.
- **Reactions via plain HTTP POST**, batched client-side (e.g. send the tap count every 2s). They are aggregated in a stream processor and broadcast back as totals on the score stream. No per-user socket is needed for input.
- WebSocket would only be justified for interactive features like watch-party chat, and that is a much smaller population.

### Fan-out tier
- Origin publishes each event once to a durable log (Kafka) → regional **edge fan-out nodes** each hold 200K–500K SSE connections → about **50–125 nodes** for 25M, plus N+1 headroom per region.
- Each event has a monotonic id. Nodes keep the last ~5 minutes in memory to serve Last-Event-ID replays.

### Reconnect storms
- A node dying drops 250K clients. With **full-jitter backoff** over ~10s that is 25K conns/s spread across the remaining nodes, which is fine. Without jitter it is a synchronized spike.
- Use a server-sent **retry** hint to widen the window during incidents.

### Mobile
- Backgrounded apps lose sockets. Send **APNs/FCM push** for wickets only, and resync via REST when the app is foregrounded.

### Fallback
- If streaming is blocked, fall back to long polling or CDN polling behind the same event ids.`,
      followUps: [
        {
          q: 'Why not just use WebSockets everywhere?',
          a: 'Nothing flows client→server at high frequency, so full duplex buys nothing. You would lose HTTP caching, the built-in resume, and easy CDN/HTTP/2 integration, and you would have to build heartbeat/resume logic yourself.',
        },
        {
          q: 'How do you guarantee a viewer never misses a wicket?',
          a: 'Wickets are high-priority events with sequence ids stored in the replay buffer. On reconnect the client sends Last-Event-ID and gets the gap. If the gap is older than the buffer, the client does a full-state REST fetch. Critical events also go via push notification.',
        },
        {
          q: 'What happens at the moment a six is hit?',
          a: 'Reaction POSTs spike 10–50×. Client-side batching plus edge rate limiting and a stream aggregator (counts per 1s window) absorb it; the score stream is unaffected because it is a separate path.',
        },
      ],
      pitfalls: [
        'Defaulting to WebSockets and a Redis channel per user for a pure broadcast',
        'Ignoring that all viewers receive identical data (cacheable)',
        'No plan for reconnect storms or mobile backgrounding',
      ],
    },
    {
      id: 'net-realtime-iq-2',
      difficulty: 'hard',
      question:
        'Your NestJS chat gateway runs on one pod. Product wants to scale to 3M concurrent users across 30 pods. Walk me through how a message from Alice on pod 3 reaches Bob on pod 17 — and what breaks at scale.',
      whatInterviewerLooksFor: [
        'A backplane or registry design with justification (per-user channel vs per-server channel)',
        'Persist-then-deliver with sequence numbers, not pub/sub as the source of truth',
        'Awareness of Redis Cluster pub/sub broadcast limits and sharded pub/sub',
        'Handles multi-device, offline users and pod churn',
      ],
      modelAnswer: `### Routing options
1. **Per-user channels** (Alex Xu Nearby Friends style). Each pod SUBSCRIBEs to user:{id} for every user connected to it, and senders PUBLISH to user:bob. There is no registry and routing is automatic. The cost is 3M subscriptions and a subscribe/unsubscribe on every connect/disconnect.
2. **Registry + per-pod channel**. On connect, write presence: HSET conn:bob {device} pod-17 with a TTL refreshed by heartbeat. The sender looks Bob up and publishes to pod:17. That is only 30 channels, but the registry must be kept consistent (stale entries after crashes are fixed by TTL, and a missed delivery falls back to replay).

At 3M users either works. I would start with per-user channels on **Redis 7 sharded pub/sub** (SSUBSCRIBE/SPUBLISH) or NATS, because classic PUBLISH in Redis Cluster is broadcast to every node and does not scale horizontally.

### The message path
1. Alice's pod validates the message and **persists it** (Cassandra/Postgres partitioned by conversation) with a per-conversation seq and an idempotency key (clientMsgId).
2. Publish to user:bob (and to Alice's other devices).
3. Pod 17 pushes to all of Bob's sockets, subject to backpressure checks.
4. Bob's client acks the seq. If Bob is offline, nothing is lost: the message is already in storage, and a push notification is sent.
5. On reconnect Bob sends his last seq per conversation and replays the gap.

### What breaks at scale
- **Group chats**: fan-out to a 5K-member group is 5K publishes. Use per-group channels, or a fan-out worker via Kafka.
- **Pod deploys**: each pod holds 100K sockets. Drain in staggered waves with close 1012, jittered reconnects and resume tokens, otherwise the auth service gets 100K logins in 1s.
- **Hot users** (celebrity broadcast channels) need a different, broadcast-oriented path.
- **Backplane throughput**: say 3M users × 1 msg/min × 2 devices ≈ 100K publishes/s. That is fine for a sharded Redis/NATS cluster, but measure it.`,
      followUps: [
        {
          q: 'Redis pub/sub dropped messages during a failover. What was lost?',
          a: 'Only the real-time nudge. Pub/sub is at-most-once with no persistence, but because messages were persisted first, clients detect the seq gap on the next message or on reconnect and fetch the missing range.',
        },
        {
          q: 'Would you use sticky sessions?',
          a: 'Stickiness at the LB matters only for the long-polling fallback (Socket.IO needs it for its handshake). A WebSocket stays on its pod anyway. Correctness must not depend on stickiness, since pods die.',
        },
        {
          q: 'Why not let pods call each other directly via the registry?',
          a: 'You can (gRPC pod-to-pod), but it creates an N² mesh, and senders must handle retries and stale registry entries. A backplane decouples them. Direct calls are an optimization at very large scale.',
        },
      ],
      pitfalls: [
        'Using Redis pub/sub as the only copy of the message',
        'Assuming Redis Cluster scales classic pub/sub by adding shards',
        'Forgetting multiple devices per user and offline delivery',
      ],
    },
    {
      id: 'net-realtime-iq-3',
      difficulty: 'expert',
      question:
        'Yesterday a routine deploy of the WebSocket tier took down login for 12 minutes. The auth service hit 40× its normal QPS right after pods restarted. Diagnose it and tell me what you would change.',
      context: '1.2M concurrent sockets across 12 pods; rolling update with maxUnavailable 25%; clients reconnect after 1s fixed delay.',
      whatInterviewerLooksFor: [
        'Identifies synchronized reconnects (thundering herd) and the full re-auth path',
        'Quantifies the spike',
        'Fixes on client, server and deploy config; resumable sessions',
        'Adds admission control and monitoring',
      ],
      modelAnswer: `### What happened
- With maxUnavailable 25%, 3 pods (≈300K sockets) were killed at once. Kubernetes SIGTERM plus the default 30s grace period meant the sockets just dropped.
- Every client retried after exactly **1s**, so 300K reconnects landed in one second, each doing a TLS handshake plus a **full OAuth token introspection / user load**. Normal auth QPS is perhaps 5–10K/s, so 300K in a second is 30–60×.
- Auth then slowed down, handshakes timed out, clients retried at 1s again, and the retry storm kept load pinned. It only settled after 12 minutes as clients gave up or the load drained.

### Fixes
**Client**
- Exponential backoff with **full jitter** (base 500ms, cap 30s), plus randomized initial delay of 0–10s after a 1012/1001 close.
- Honour a server retry hint.

**Server / protocol**
- Issue a **resume token** (a signed, short-lived session ticket bound to user and device) on connect. Reconnect verifies the signature locally with no auth-service call. That removes the dependency entirely for reconnects.
- **Admission control** on upgrades: a token bucket per pod (e.g. 2K new conns/s), answering excess with 503 + Retry-After at the HTTP layer, before the upgrade.
- TLS session resumption to reduce handshake CPU.

**Deploy**
- Fail readiness first, then close sockets **gradually** over 5–10 minutes (1012 in random batches). Set terminationGracePeriodSeconds to about 600 and use maxUnavailable 1 or surge-only (maxSurge 25%, maxUnavailable 0) so capacity exists before draining.

**Auth service**
- Rate-limit and cache introspection results. Give reconnect traffic a lower priority class than fresh logins.

### Verify
Graph reconnect rate, upgrade latency, auth QPS by caller, and connections per pod during the next canary deploy. Target peak reconnects ≤ 5% of connections per minute.`,
      followUps: [
        {
          q: 'What does jitter change mathematically?',
          a: 'It turns an impulse (N arrivals in 1s) into roughly uniform arrivals over the window. 300K over a 30s window is 10K/s instead of 300K/s, a 30× lower peak for the same total work.',
        },
        {
          q: 'Is the resume token a security risk?',
          a: 'Keep it short-lived (minutes), bound to device and session, and revocable via a small denylist checked locally. Refresh it periodically over the socket. It is the same trade-off as a JWT access token.',
        },
      ],
      pitfalls: [
        'Blaming the auth service capacity and just scaling it up',
        'Fixed-interval retries or backoff without jitter',
        'Leaving the default 30s termination grace period for stateful pods',
      ],
    },
    {
      id: 'net-realtime-iq-4',
      difficulty: 'hard',
      question:
        'Drivers keep a gRPC bidirectional stream open to the dispatch service to receive job offers. Streams that are quiet for a few minutes silently stop delivering: the server-side Write succeeds, but the phone never gets the offer and never sees an error. The mobile team then set client keepalive pings every 10 s, and now the server closes connections with GOAWAY ENHANCE_YOUR_CALM ("too_many_pings"). Explain both failures and design the fix.',
      context:
        '~400K drivers online at peak on mobile networks, 40 dispatch pods behind an AWS NLB (TCP idle timeout 350 s). An offer must be accepted within 15 s or it goes to the next driver.',
      whatInterviewerLooksFor: [
        'Explains that NAT/LB middleboxes drop idle flow state and that a successful Write only means "buffered", not "delivered"',
        'Knows gRPC keepalive has two halves: client ping interval and the server enforcement policy, and that they must be tuned together',
        'Adds an application-level ack per offer, because transport keepalive cannot prove delivery',
        'Designs for the mobile reality: resume on reconnect, push-notification fallback, battery and ping-load cost',
      ],
      modelAnswer: `### Failure 1: silent half-dead streams
- Every NAT and load balancer on the path keeps per-flow state and drops it when the flow is idle: the NLB after **350 s**, carrier-grade NATs on mobile networks often after **30 s to a few minutes**, with no notification to either end.
- After that the TCP connection is **half-dead**. The server's stream.write() succeeds because it only copies bytes into the HTTP/2 and kernel buffers. The packet is then dropped or answered with a RST the application never ties back to the offer. The phone sends nothing, so it never finds out either.
- Result: the driver looks online, offers go into a black hole, and each one waits the full 15 s before being re-offered.

### Failure 2: too_many_pings
- gRPC keepalive has a **client side** (how often to ping) and a **server enforcement policy** (how often it will accept pings). The defaults are conservative: grpc-go's EnforcementPolicy MinTime is **5 minutes**, and gRPC core has an equivalent minimum ping interval.
- A client pinging every 10 s breaks that policy. After a couple of "strikes" the server sends **GOAWAY ENHANCE_YOUR_CALM** and closes the connection, so the "fix" made things worse.

### The fix
1. **Tune both sides together.** Client keepalive time ≈ **30–45 s** (below the shortest NAT timeout you have measured, well below 350 s), keepalive timeout ≈ 10 s. Set server MinTime ≤ the client interval (e.g. 20 s). At 400K drivers that is ~400,000 ÷ 30 ≈ 13K tiny pings/s across 40 pods, which is negligible.
2. **Server keepalive too**, so the server detects dead clients within ~1 minute, frees their stream and marks the driver unreachable instead of sending into a void.
3. **Application-level ack.** Every offer carries an offerId and the app replies "received". No ack within ~2 s means the stream is suspect: the server cancels it, tries the next driver, and does not wait out the whole 15 s.
4. **Resume on reconnect.** The client reconnects with backoff and jitter and sends its last seen offer sequence, and the server replays any offers still open.
5. **Fallback.** When the app is backgrounded (iOS suspends sockets), send a high-priority push (APNs/FCM). The stream is the fast path, not the only path.`,
      followUps: [
        {
          q: 'Why not ping every 1 s so you detect failures almost instantly?',
          a: 'It costs battery (the radio wakes on every ping), it needs a server policy that allows it, and at 400K drivers it means 400K pings/s. The per-offer ack already detects failure within ~2 s exactly when it matters, so keepalive only has to be faster than the NAT timeout.',
        },
        {
          q: 'Could you just raise the NLB idle timeout?',
          a: 'You can raise the NLB\'s, but not the timeouts of carrier NATs, hotel Wi-Fi or corporate proxies you do not control. You still need keepalive under the shortest timeout on the path, so raising the NLB timeout alone does not fix it.',
        },
        {
          q: 'Does the ack mean the driver saw the offer?',
          a: 'No, it means the app received it. Show-and-accept is a separate, idempotent AcceptOffer(offerId) call; the server treats a late or duplicate accept after the offer moved on as a no-op with a clear response.',
        },
      ],
      pitfalls: [
        'Treating a successful server Write as proof the phone received the message',
        'Cranking client keepalive down without changing the server enforcement policy',
        'Relying on TCP keepalive defaults (2 hours on Linux) to detect dead mobile connections',
        'Having no application-level ack or push fallback, so a dead stream costs the full 15 s offer window',
      ],
    },
    {
      id: 'net-realtime-iq-5',
      difficulty: 'medium',
      question:
        'Your team is building an AI assistant feature that streams model tokens to the browser, plus a "stop generating" button. A colleague proposes WebSockets. Would you agree?',
      whatInterviewerLooksFor: [
        'Picks SSE (or fetch streaming) and justifies it',
        'Handles the stop action as a normal HTTP call / abort',
        'Addresses proxy buffering, timeouts, auth headers',
        'Knows when WebSocket would be the better choice',
      ],
      modelAnswer: `### Recommendation: HTTP streaming via SSE, not WebSockets
- The traffic is **one request → one long streamed response**. That is exactly request/response with incremental delivery. SSE (text/event-stream) is what the major LLM APIs expose for this reason.
- It stays plain HTTP, so the existing auth middleware, rate limiting, API gateway, logging and tracing all keep working. WebSockets would need a separate connection tier, upgrade support, heartbeats and a custom protocol.
- Use **fetch() with a ReadableStream**, or a library such as fetch-event-source, rather than native EventSource. The native API only supports GET and cannot set an Authorization header, while we need a POST carrying the prompt.

### Stop button
- Client-side: abort the fetch with AbortController. The server sees req 'close' and cancels the upstream model call to save GPU/tokens. Propagate the cancellation instead of letting generation finish silently.
- If the stream is resumable, also POST /generations/{id}/cancel as an explicit, idempotent command.

### Production details
- Disable buffering on nginx or the gateway (X-Accel-Buffering: no) and turn off compression for the stream.
- Idle timeouts: a model can think for 30s+ before the first token, so send comment heartbeats every 10–15s.
- Serve over HTTP/2 so several concurrent streams are not capped at 6 connections per origin.
- Give events ids (a token index) so a dropped connection can resume via Last-Event-ID from a cached generation buffer.

### When WebSocket wins
Voice mode, or collaborative editing, where the client streams audio or edits continuously while receiving: truly bidirectional, high-frequency traffic.`,
      followUps: [
        {
          q: 'Latency difference between SSE and WebSocket here?',
          a: 'Negligible once the stream is open. Both push bytes on an established TCP/TLS connection; the few bytes of framing per event do not matter next to token generation time.',
        },
        {
          q: 'How do you rate-limit streaming requests?',
          a: 'Limit concurrent streams per user and tokens per minute, not just requests per second. One request can hold a connection and GPU time for a minute.',
        },
      ],
      pitfalls: [
        'Choosing WebSocket because it "is the real-time protocol"',
        'Not cancelling upstream work when the client disconnects',
        'Forgetting proxy buffering and first-byte timeouts',
      ],
    },
    {
      id: 'net-realtime-iq-6',
      difficulty: 'expert',
      question:
        'A trading dashboard pushes ~1,000 quote updates/s per client over WebSockets. Connection servers are being OOM-killed every few hours, always during market open. Heap dumps show huge ws send buffers. What is going on and how do you redesign the push path?',
      whatInterviewerLooksFor: [
        'Identifies slow consumers and unbounded buffering (bufferedAmount)',
        'Proposes conflation/latest-wins per symbol and subscription filtering',
        'Isolates failure: hard caps, disconnect, bulkheads',
        'Quantifies bandwidth per client and relates it to mobile links',
      ],
      modelAnswer: `### Diagnosis
- 1,000 updates/s × ~150 bytes ≈ **150 KB/s per client**, around 1.2 Mbit/s. A laptop on hotel Wi-Fi or a 3G phone drains maybe 20–50 KB/s.
- ws.send() never blocks. When the TCP window closes, data queues in user space and **bufferedAmount** grows by about 100 KB/s per slow client.
- 2,000 slow clients × 100 KB/s × 10 min ≈ **120 GB** is impossible to hold, so the process OOMs and takes 50K healthy clients down with it. Market open is when the update rate and the count of slow clients both peak.

### Redesign
1. **Send only what is on screen.** Clients subscribe to visible symbols (say 30), not the whole firehose. That alone cuts traffic by an order of magnitude.
2. **Conflation.** Quotes are *state*, so only the latest price per symbol matters. Keep a per-connection map of symbol → latest quote and flush on a tick (e.g. every 100ms) or when the socket drains. A slow client then gets fewer, fresher updates instead of an ever-growing backlog, and memory per client is bounded at roughly symbols × message size.
3. **Adaptive rate per client.** Downgrade from 10 to 2 to 1 Hz as bufferedAmount rises, and tell the client ("throttled") so the UI can show it.
4. **Hard cap.** If bufferedAmount goes over ~4 MB, close with 1013 and let the client reconnect and resync a snapshot.
5. **Snapshot + delta with seq.** Deltas carry per-symbol seq numbers. On a gap or a reconnect, fetch a snapshot.
6. **Bulkheads.** Cap connections per process, run several smaller processes per node, and alert on the p99 of bufferedAmount.

### Also consider
- Binary encoding (protobuf/MessagePack) cuts payloads by 2–4×.
- Order and execution reports are *events*, not state. Never conflate them: send them on a separate, reliable channel with acks.`,
      followUps: [
        {
          q: 'Why not just add more memory?',
          a: 'Backlog grows linearly with time for a client that is slower than the feed. No amount of memory is enough, and the data is stale anyway.',
        },
        {
          q: 'Could TCP itself handle this?',
          a: 'TCP flow control stops the kernel from sending, but the application keeps producing. You must read the backpressure signal (bufferedAmount, or write() returning false) and act on it.',
        },
      ],
      pitfalls: [
        'Increasing heap size or adding nodes',
        'Conflating order confirmations along with prices',
        'Not measuring per-connection buffered bytes',
      ],
    },
    {
      id: 'net-realtime-iq-7',
      difficulty: 'expert',
      question:
        'Customers of our delivery app complain that "the rider arrived" notification sometimes never shows in-app, even though logs show we sent it over the WebSocket. Design an end-to-end delivery guarantee.',
      whatInterviewerLooksFor: [
        'Explains why "sent" on the server does not mean received (buffers, dead TCP, reconnect gaps)',
        'Persist-then-push, sequence numbers, client acks, replay on reconnect',
        'Idempotent client handling, dedupe',
        'Fallback channels: push notification, polling on foreground',
      ],
      modelAnswer: `### Why "sent" is a lie
- ws.send() only puts bytes into a buffer. If the phone lost signal 20s ago, the TCP connection is half-open: the server writes successfully until retransmission timeouts fire minutes later, then the bytes are dropped.
- If the client reconnects to a different node, anything published in between via pub/sub was delivered to nobody.
- So the socket gives **at-most-once** delivery with no feedback.

### Design: an ordered, acknowledged log per user
1. **Persist first.** Every notification is appended to a per-user inbox (Postgres table or Redis Stream) with a **monotonic seq** assigned by the inbox owner, plus a notificationId.
2. **Push as an optimisation.** Publish a wake-up to the user's channel, and the connection node pushes {seq, payload}.
3. **Client ack.** The client acks the highest contiguous seq it has processed. The server keeps an ackedSeq per device.
4. **Gap detection.** If the client receives seq 42 while its last was 40, it requests the range 41–41 over REST.
5. **Resume.** On reconnect the client sends its lastSeq and the server replays everything after it before resuming live push.
6. **Redelivery timer.** If a critical notification is not acked within ~10s, send it through **APNs/FCM** (the app may be backgrounded) and keep it pending.
7. **Idempotent UI.** The client dedupes by notificationId/seq, which gives effectively-once display despite at-least-once delivery.

### Liveness
- Heartbeat every 25s. A missed pong terminates the socket, which makes the client reconnect and replay sooner.
- On app foreground, always do a sync call ("give me everything after lastSeq") regardless of socket state.

### Observability
- Measure **end-to-end ack latency** (publish → ack) and the rate of unacked notifications per app version. That is the SLO, not "messages sent".

### Trade-offs
- Storage for the inbox. Keep a TTL of about 7 days and compact acked entries.
- An extra upstream ack message per notification, which is cheap.`,
      followUps: [
        {
          q: 'Who assigns the sequence number when multiple services emit notifications?',
          a: 'The inbox service, which is the single writer per user partition (e.g. Kafka partitioned by userId, or a DB sequence per user). Producers only submit events; they never number them.',
        },
        {
          q: 'Does TCP not already guarantee delivery?',
          a: 'Only while the connection lives, and only up to the peer\'s kernel. It says nothing about the app processing the message, or about data in flight when the connection dies.',
        },
      ],
      pitfalls: [
        'Trusting server-side send logs as proof of delivery',
        'Relying on pub/sub for durability',
        'No dedupe, so replays cause duplicate UI notifications',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'net-realtime-boe-1',
      question:
        'Nearby Friends (Alex Xu Vol 2, Ch 2): size the Redis pub/sub cluster that fans out location updates.',
      assumptions: [
        '100M DAU, 10% concurrent → 10M active users',
        'Each active user sends a location update every 30s',
        '400 friends per user; ~10% of them online and nearby → 40 recipients per update',
        'One channel per user; ~20 bytes per subscriber pointer; up to 100 active subscribers per channel',
        'One modern Redis node sustains ~100K pushes/s for pub/sub (conservative)',
      ],
      steps: [
        { label: 'Update rate', calc: '10M ÷ 30s ≈ 334K location updates/s' },
        { label: 'Fan-out pushes', calc: '334K × 400 × 10% ≈ 13.4M ≈ 14M pushes/s' },
        { label: 'Memory', calc: '100M channels × 100 subscribers × 20 B = 200 GB → ~2 nodes of 100GB+ (memory is NOT the bottleneck)' },
        { label: 'CPU-bound node count', calc: '14M ÷ 100K per node ≈ 140 Redis nodes' },
        { label: 'WebSocket tier', calc: '10M connections ÷ ~100K per server ≈ 100 servers (+N+1 headroom)' },
      ],
      answer: '≈140 Redis pub/sub nodes (CPU/network bound), ~200GB total memory, ≈100+ WebSocket servers.',
      insight:
        'The cluster is sized by push throughput, not memory — so shard channels across nodes with a consistent-hash ring in service discovery, and treat resizing as an operational event (channels move, subscribers must resubscribe; do it off-peak).',
      followUps: [
        {
          "q": "Product adds a 'live share' mode where active users update every 5s instead of 30s. What does that do to the Redis tier?",
          "a": "Update rate goes from about 334K/s to 10M ÷ 5s = 2M/s. Fan-out at 40 recipients becomes 80M pushes/s, so at 100K pushes/s per node you need about 800 nodes, roughly 6× more. Memory is unchanged because the number of channels and subscribers is the same. The WebSocket tier also sees 6× more outbound messages. Cheaper options: apply live mode only to friends who are actually viewing the map (most of the 40 aren't looking), send updates only when position moves more than ~50m, and batch several friends' updates into one push per client per second."
        },
        {
          "q": "You grow the ring from 140 to 160 Redis nodes with consistent hashing. What fraction of channels move, and what do clients experience?",
          "a": "About 20 ÷ 160 = 12.5% of channels move to the new nodes. For those channels, publishers start writing to the new node immediately once service discovery updates, but subscribers are still listening on the old node until their WebSocket servers notice the ring change and resubscribe. Updates published in that window are lost, which for location data is acceptable because the next update arrives within 30s. Make WebSocket servers watch the ring in service discovery and resubscribe on change, and roll out off-peak so the resubscribe burst, millions of SUBSCRIBE commands, does not overload the new nodes."
        }
      ],
    },
    {
      id: 'net-realtime-boe-2',
      question:
        'A messaging app has 50M peak concurrent WebSocket connections. How many connection servers do you need, how much memory, and what does the heartbeat traffic cost?',
      assumptions: [
        '~40 KB per connection all-in (kernel buffers + TLS state + app objects) on Node',
        'Target 200K connections per server in steady state (headroom for N+1 and GC)',
        'Heartbeat ping every 25s; ping+pong ≈ 2 × ~60 bytes on the wire incl. TCP/IP/TLS overhead',
        'Servers deployed across 3 regions, each must absorb one-AZ loss (33%)',
      ],
      steps: [
        { label: 'Base server count', calc: '50M ÷ 200K = 250 servers' },
        { label: 'AZ-loss headroom', calc: '250 ÷ (2/3) ≈ 375 servers' },
        { label: 'Memory per server', calc: '200K × 40 KB = 8 GB for connections → 16 GB boxes' },
        { label: 'Heartbeat rate', calc: '50M ÷ 25s = 2M pings/s fleet-wide ≈ 8K/s per server' },
        { label: 'Heartbeat bandwidth', calc: '2M × 120 B ≈ 240 MB/s ≈ 1.9 Gbit/s fleet-wide (~5 Mbit/s per server)' },
      ],
      answer: '≈375 servers with 16GB RAM each; heartbeats ≈2M/s fleet-wide (~2 Gbit/s), trivial per server.',
      insight:
        'Steady state is cheap; the dangerous number is reconnect rate. If one AZ fails, ~17M clients reconnect — with 30s jittered backoff that is ~550K TLS handshakes + auth checks per second, so reconnect admission control and local resume-token validation matter more than raw connection capacity.',
      followUps: [
        {
          "q": "Mobile carrier NATs are dropping idle connections after 30s, so you must ping every 10s instead of 25s. What does that cost?",
          "a": "Pings go from 2M/s to 50M ÷ 10s = 5M/s fleet-wide. At 120 B per ping+pong that's about 600 MB/s or 4.8 Gbit/s, roughly 13.3K pings/s and 12.8 Mbit/s per server across 375 servers. Bandwidth is still modest. The real costs are CPU for TLS record encryption and timer handling, and battery on the phone, since each ping wakes the radio. Mitigate by pinging only when the connection has been idle for 10s (traffic resets the timer) and by sending heartbeats from the client side, where mobile OS radio scheduling can batch them."
        },
        {
          "q": "The insight says an AZ failure means ~550K TLS handshakes/s. If one server can do about 2K full RSA-2048 handshakes/s per core budget you give it, is the fleet enough?",
          "a": "550K ÷ 2K = 275 servers' worth of handshake capacity, and the surviving fleet is about 250 servers that are also absorbing the extra connections, so you're at or past the limit. Three levers: use ECDSA P-256 certificates, which are several times cheaper to sign than RSA-2048 so per-server capacity rises to roughly 8–10K/s; enable TLS session resumption (tickets), so reconnecting clients skip the full handshake; and widen client jitter from 30s to 60–90s. Do all three and the burst becomes comfortable. Load-test it by killing an AZ's worth of servers in staging."
        }
      ],
    },
    {
      id: 'net-realtime-boe-3',
      question:
        'An order-tracking page for 5M concurrently open sessions currently short-polls every 5s. Compare request rate and bandwidth with SSE when order status changes ~10 times per hour.',
      assumptions: [
        'Short poll request+response ≈ 1.5 KB (headers, cookies, small JSON body)',
        'SSE event ≈ 300 B; heartbeat comment every 20s ≈ 60 B with framing',
        'Each poll costs auth + one DB/cache read',
        'Status changes ~10/hour per order',
      ],
      steps: [
        { label: 'Polling RPS', calc: '5M ÷ 5s = 1M requests/s (≈99.7% return "no change")' },
        { label: 'Polling bandwidth', calc: '1M × 1.5 KB = 1.5 GB/s ≈ 12 Gbit/s' },
        { label: 'SSE events', calc: '5M × 10/3600 s ≈ 14K events/s × 300 B ≈ 4 MB/s' },
        { label: 'SSE heartbeats', calc: '5M ÷ 20s = 250K/s × 60 B = 15 MB/s' },
        { label: 'Total SSE', calc: '≈19 MB/s ≈ 150 Mbit/s → ~80× less bandwidth, ~70× fewer operations' },
      ],
      answer: 'Polling ≈1M req/s and ~12 Gbit/s vs SSE ≈14K events/s plus 250K cheap heartbeats/s (~150 Mbit/s).',
      insight:
        'Polling pays per client per interval; push pays per event. When the event rate is far lower than the poll rate, push wins by orders of magnitude — but you now hold 5M open connections (≈25 servers at 200K each), so the cost moves from RPS/DB load to connection capacity. For very low event rates, a hybrid (push notification + fetch) may be cheaper still.',
      followUps: [
        {
          "q": "Product adds a live rider map: once out for delivery, location updates every 5s. Recompute the SSE side for all 5M sessions.",
          "a": "Events go from about 14K/s to 5M × (1/5s) = 1M/s, the same rate as the old polling. At 300 B per event that is about 300 MB/s or 2.4 Gbit/s, plus the 15 MB/s of heartbeats, which now are redundant because data flows constantly. Push no longer wins on bandwidth; it still wins on DB load because the location comes from a pub/sub feed, not a per-request read. Reduce it: only sessions actually viewing the map need location, typically a small fraction; send compact deltas or a binary format of about 40 B; and skip updates when the rider hasn't moved."
        },
        {
          "q": "Ops refuse to run 5M long-lived connections this year. What's the cheapest improvement while staying on polling?",
          "a": "Make polls cheap rather than eliminate them. Raise the interval to 60s for non-critical states (preparing, in transit), and add ETag/If-None-Match so unchanged orders return `304` with no body, served from an edge or Redis cache without hitting the DB. At 60s that is 5M ÷ 60 ≈ 83K req/s, and at about 400 B per 304 roughly 33 MB/s, about 12× fewer requests than today. Pair it with a mobile push notification on status changes so users still see important updates immediately, with polling as the backstop."
        }
      ],
    },
    {
      id: 'net-realtime-boe-4',
      question:
        'An L7 proxy (single source IP) fronts 4 WebSocket backend pods, each on one IP:port. How many concurrent client connections can the proxy tier support before port exhaustion, and how do you fix it for 1M connections?',
      assumptions: [
        'Linux default ip_local_port_range 32768–60999 → 28,232 ports',
        'Each client connection maps to one proxy→backend connection (no multiplexing for WebSocket)',
        '4-tuple uniqueness: (proxyIP, port, backendIP, backendPort)',
      ],
      steps: [
        { label: 'Ports per backend', calc: '≈28K concurrent connections per (proxy IP → backend IP:port)' },
        { label: 'Max via one proxy IP', calc: '28K × 4 backends ≈ 113K connections' },
        { label: 'Widen port range', calc: '1024–65535 → ~64.5K × 4 ≈ 258K' },
        { label: 'For 1M', calc: '1M ÷ 64.5K ≈ 16 (source IP, backend IP:port) pairs → e.g. 4 source IPs per proxy × 4 backends, or 16 backend pods' },
      ],
      answer: '~113K with defaults; 1M needs ≥16 distinct 4-tuple "lanes" (more backend IPs/ports and/or multiple proxy source IPs).',
      insight:
        'Client-side ports are never the limit at the edge (millions of client IPs), but the proxy→backend hop is. More, smaller backend pods or multiple source IPs on the proxy (nginx proxy_bind rotation) fix it — and it is why HTTP/2/gRPC multiplexing is so valuable for east-west traffic.',
      followUps: [
        {
          "q": "During a deploy the proxy closes and reopens all 113K backend connections within one minute. Do ports in TIME_WAIT make things worse?",
          "a": "It depends on which side closes first. The side that actively closes holds the socket in TIME_WAIT for 60s on Linux. If the proxy initiates the close, each old 4-tuple is unusable for a minute, so reconnects need fresh ports and can exhaust the range at half the normal concurrency. If the backend pod closes first, as during a pod shutdown, TIME_WAIT lands on the backend and the proxy's ports are freed. Set `net.ipv4.tcp_tw_reuse=1` on the proxy, which lets outbound connections reuse TIME_WAIT ports safely using TCP timestamps, and let backends initiate closes during drains."
        },
        {
          "q": "Instead of more IPs, could you multiplex many client WebSockets over fewer proxy-to-backend connections?",
          "a": "Yes, by changing what crosses that hop. Options: RFC 8441 bootstraps WebSockets over HTTP/2 streams, so many client sockets share one upstream connection, but proxy and backend support is limited. More commonly, terminate WebSockets at the edge gateway itself and talk to backends over a multiplexed protocol such as gRPC streams or a message bus, so the gateway holds the 1M client sockets and a few hundred upstream connections. That removes the port limit entirely, but the gateway becomes a stateful tier that needs its own drain and reconnect strategy."
        }
      ],
    },
  ],
  test: [
    {
      id: 'net-realtime-mcq-01',
      difficulty: 'medium',
      question:
        'A B2B dashboard must show server-pushed alerts (~1/minute). Users sit behind strict corporate proxies, the client never sends data except initial auth, and the team wants automatic reconnection with no custom code. Which transport fits best?',
      options: [
        'WebSocket, because it is the lowest-latency push channel for browsers',
        'Server-Sent Events over HTTPS, using event ids for resume on reconnect',
        'gRPC server streaming called directly from the browser',
        'Short polling every second to guarantee freshness',
      ],
      correct: [1],
      explanation:
        'SSE is plain HTTP, so it passes through most proxies. It is one-way, which is exactly the need, and EventSource auto-reconnects and sends Last-Event-ID. WebSocket works, but it needs upgrade support through proxies and custom reconnect/heartbeat code for no benefit. Browsers cannot speak native gRPC without a gRPC-Web proxy. 1s polling wastes ~60 requests per alert.',
      followUps: [
        {
          "q": "Alerts now need a per-user 'acknowledge' action from the dashboard. Do you switch the whole channel to WebSocket?",
          "a": "No. Keep SSE for the push and send the acknowledgement as an ordinary `POST /alerts/{id}/ack`. The ack is rare, needs request/response semantics, and benefits from the same auth, rate limiting and audit logging as the rest of the API. Moving to WebSocket would bring back the proxy-upgrade risk and the custom reconnect code that SSE avoided, just to carry one small message a minute. Switch transports only when client-to-server traffic becomes high-frequency and latency-sensitive, such as collaborative cursors or gameplay."
        },
        {
          "q": "Some corporate proxies still buffer the SSE stream until it closes, even over HTTPS. How do you detect that and degrade gracefully?",
          "a": "Detect it on the client. The server sends an initial event, for example `event: hello` with a timestamp, right after the headers are written. If EventSource reports `open` but no hello arrives within about 5s, assume an intercepting proxy is buffering. Fall back to long polling with a 25s hold, which works because each response completes. Log the fallback with the client's network/ASN so you can see how common it is. A TLS-inspecting proxy is the usual cause, since it terminates HTTPS and can buffer like any HTTP proxy."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-02',
      difficulty: 'hard',
      question:
        'Behind this nginx config, the SSE stream works locally but in production clients receive events in large bursts many seconds late. What is the most likely cause?',
      code: {
        language: 'nginx',
        code: `location /stream/ {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_read_timeout 3600s;
    gzip on;
}`,
      },
      options: [
        'proxy_http_version 1.1 prevents chunked streaming; SSE requires HTTP/2 upstream',
        'proxy_read_timeout is too long, so nginx waits for the whole response before flushing',
        'Response buffering (on by default) plus gzip holds small writes until buffers fill',
        'Clearing the Connection header disables keep-alive so each event opens a new connection',
      ],
      correct: [2],
      explanation:
        'nginx buffers upstream responses by default (proxy_buffering on), and gzip also accumulates small writes, so tiny SSE events sit in buffers and arrive in bursts. The fix is proxy_buffering off (or X-Accel-Buffering: no) and no compression on the stream. HTTP/1.1 upstream is required and correct. proxy_read_timeout only controls idle time between reads. Clearing Connection is the standard way to keep upstream keep-alive.',
      followUps: [
        {
          "q": "You disabled buffering in nginx, but the stream still arrives in bursts. The traffic also passes through a CDN and an ALB. How do you find which hop is buffering?",
          "a": "Bisect the path with timestamps. Have the server emit `data: <server-ms>` every second, then `curl -N` the stream from each hop in turn: the pod directly, the nginx service, the ALB, and the CDN hostname. Compare arrival times. The first hop where events stop arriving one per second is the culprit. CDNs often buffer or cache by default, and many need streaming explicitly enabled or the path set to bypass cache. `Cache-Control: no-cache, no-transform` helps, but some CDNs need a config rule. Add a synthetic SSE probe in monitoring that alerts when inter-event latency exceeds 2s."
        },
        {
          "q": "Why is `X-Accel-Buffering: no` from the app often preferable to setting `proxy_buffering off` for the whole nginx location?",
          "a": "The header scopes the change to the responses that need it. If the location also serves normal JSON or file downloads, turning buffering off globally makes nginx hold an upstream connection open while it feeds slow clients synchronously, so slow mobile readers tie up Node workers. With buffering on, nginx absorbs the response quickly and frees the upstream. The per-response header lets the app say 'this is a stream' while everything else keeps the protective buffering. The trade-off is that the behaviour now depends on app code, so cover it with an integration test that asserts the header on stream routes."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-03',
      difficulty: 'expert',
      question:
        'This heartbeat code runs on a WebSocket server. After a week the node holds 3× more sockets than there are active users. Why?',
      code: {
        language: 'typescript',
        code: `wss.on('connection', (ws: any) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

setInterval(() => {
  wss.clients.forEach((ws: any) => {
    if (!ws.isAlive) return ws.terminate();
    ws.ping();
  });
}, 30_000);`,
      },
      options: [
        'ws.ping() throws on half-open sockets, which aborts the forEach loop',
        'Browsers do not answer protocol pings, so isAlive must be set by app messages',
        'terminate() only sends a close frame; the socket stays open until the peer replies',
        'isAlive is never reset to false before pinging, so dead peers are never detected',
      ],
      correct: [3],
      explanation:
        'The pattern only works if isAlive is set to false before each ping and set back to true by the pong. Here it stays true forever, so dead peers are never terminated. Browsers do reply to protocol pings automatically. ping() on a half-open socket does not throw synchronously, since the kernel happily buffers. terminate() destroys the socket immediately; it is close() that performs a handshake.',
      followUps: [
        {
          "q": "After the fix, a deploy shows sockets being terminated in bulk every 25s, including healthy ones under heavy load. What could cause false positives?",
          "a": "The pong is handled on the same event loop as everything else. If the loop is blocked by a long GC pause, a big JSON serialise or a synchronous fan-out, pongs that arrived on time are not processed before the next tick marks the socket dead. A slow consumer with a full send buffer can also delay the ping itself. Mitigations: tolerate two missed pongs instead of one, measure event-loop lag (`perf_hooks.monitorEventLoopDelay`) and skip reaping when lag exceeds the interval, and split heavy work off the gateway process. Track a metric of terminations per minute so a spike is visible."
        },
        {
          "q": "With 200K sockets on one node, iterating all of them every 25s in one `setInterval` callback causes a latency spike. How do you restructure it?",
          "a": "Spread the work. Split sockets into, say, 25 buckets by hash of the connection id and process one bucket every second, so each tick touches about 8K sockets instead of 200K. Each socket is still checked every 25s. Alternatively give each socket its own jittered timer, which costs more memory but smooths load naturally. Also make sure `ping()` calls do not all land in one tick, because the resulting 200K pongs would also arrive in a burst. Measure with event-loop delay p99 before and after."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-04',
      difficulty: 'hard',
      question:
        'Internal gRPC clients reach the "inventory" service via a Kubernetes ClusterIP Service. After scaling from 3 to 12 pods, only the original 3 receive traffic. Which change fixes the distribution most directly?',
      options: [
        'Enable sessionAffinity: ClientIP on the Service so clients are pinned evenly',
        'Use a headless Service with client-side round_robin, plus server max connection age',
        'Increase the client keepalive time so idle connections are rebalanced faster',
        'Switch kube-proxy from iptables to IPVS mode, which balances HTTP/2 streams per request',
      ],
      correct: [1],
      explanation:
        'gRPC multiplexes all RPCs over long-lived HTTP/2 connections, and kube-proxy balances only at connection time (L4). A headless Service exposes pod IPs so the client balances per RPC, and max connection age forces periodic re-resolution. Session affinity makes pinning worse. Keepalive tuning keeps connections alive; it does not rebalance them. IPVS is still L4 and cannot see HTTP/2 streams.',
      followUps: [
        {
          "q": "Some clients are third-party services whose gRPC config you cannot change, so they keep using the ClusterIP. How do you still balance their traffic?",
          "a": "Move balancing to the server side. Put an L7 proxy that understands HTTP/2, such as Envoy, or a service-mesh sidecar, in front of inventory. It terminates the client's long-lived connection and balances each RPC across all 12 pods. The cost is an extra hop, roughly 0.2 to 1 ms, and another component to operate. If you cannot add a proxy, set `MaxConnectionAge` (for example 5 minutes with jitter and a grace period) on the server. Clients receive GOAWAY, reconnect through kube-proxy and land on a random pod, so the load converges over a few minutes after scaling."
        },
        {
          "q": "With client-side round_robin over a headless Service, a pod gets OOM-killed and its IP is reused by a different service's pod 30s later. What can go wrong and how is it prevented?",
          "a": "If the client's DNS cache still lists the old IP, it may connect to an unrelated pod that happens to listen on the same port, and RPCs fail with UNIMPLEMENTED or, worse, hit the wrong service. Prevent it with mTLS where the client verifies the server's identity (a SPIFFE ID or the service name in the SAN), so a wrong pod fails the handshake. Also keep DNS TTLs short and rely on gRPC re-resolution after connection failures. Health checking via the gRPC health protocol removes endpoints that answer NOT_SERVING."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-05',
      difficulty: 'expert',
      question:
        'A chat backplane uses classic PUBLISH/SUBSCRIBE on Redis Cluster. Scaling from 3 to 30 primaries did not increase pub/sub throughput. Select ALL statements that are correct.',
      options: [
        'In Redis Cluster, classic PUBLISH is propagated to every node over the cluster bus',
        'Redis 7 sharded pub/sub (SPUBLISH/SSUBSCRIBE) confines a channel to its hash-slot shard',
        'Adding replicas per shard would multiply classic pub/sub throughput linearly',
        'Pub/sub messages published while a subscriber is disconnected are not retained',
        'Classic channels are hashed to slots like keys, so adding shards spreads the load',
      ],
      correct: [0, 1, 3],
      explanation:
        'Classic pub/sub in a cluster is broadcast to all nodes, so every node does the work for every message, and adding nodes adds overhead instead of capacity. Sharded pub/sub (Redis 7+) routes each channel to the shard that owns its slot. Pub/sub is fire-and-forget with no retention. Replicas also receive the broadcast, and classic channels are not slot-scoped, so both of those options are wrong.',
      followUps: [
        {
          "q": "You move to sharded pub/sub, but one celebrity group channel carries 40% of all messages. What happens now, and how do you fix it?",
          "a": "That channel lives on a single shard, so one Redis primary handles 40% of the traffic and becomes the bottleneck while the other 29 sit idle. Sharding fixes broadcast overhead, not skew. Split the hot channel: publish to `group:{id}:{n}` for n in 0..K-1, with connection servers subscribing to one bucket chosen by hashing their node id. Each message is then published to K channels on K shards, and each gateway reads only one. Alternatively, fan that group out through a dedicated tier such as Kafka partitions consumed by every gateway. Detect skew with per-shard ops/s metrics."
        },
        {
          "q": "During a Redis Cluster failover of one shard, what happens to SSUBSCRIBE subscribers on that shard, and what must the gateway do?",
          "a": "Sharded subscriptions are tied to the node that owns the slot. When the primary fails, subscribers get disconnected or receive an `sunsubscribe` for the moved slots, and messages published during the failover window, typically a few seconds, are lost because pub/sub has no retention. The gateway must re-resolve slot ownership, resubscribe to the new primary, and then trigger a catch-up read from the durable store for affected users using their last seen sequence numbers. Client libraries handle the resubscribe, but the gap recovery is your job."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-06',
      difficulty: 'expert',
      question:
        'An nginx proxy with one IP forwards WebSockets to a single backend at 10.0.1.5:8080. Connections start failing at about 28K concurrent, although the backend has plenty of CPU, memory and file descriptors. What is the limit?',
      options: [
        'The backend listen socket accept queue (somaxconn) is capped at about 28K',
        'nginx worker_connections defaults to 28,232 per worker',
        'Ephemeral source ports for the proxy-to-backend 4-tuple are exhausted',
        'TIME_WAIT sockets on the client side exhaust the proxy\'s file descriptors',
      ],
      correct: [2],
      explanation:
        'Every proxy→backend connection shares the same source IP, destination IP and destination port, so only the source port varies. The Linux default ephemeral range 32768–60999 gives 28,232 ports. Fix it by widening the range, adding backend IPs/ports, or binding multiple source IPs. somaxconn limits pending (not established) connections. nginx worker_connections defaults to 512. Client-side TIME_WAIT does not consume the proxy\'s outbound ports.',
      followUps: [
        {
          "q": "You widen `ip_local_port_range` to 1024–65535. What new problem can that introduce on the proxy host?",
          "a": "Ephemeral ports can now collide with ports that local services want to listen on, such as a metrics agent on 9100 or a sidecar on 15000. If an outbound connection grabs that port first, the service fails to bind on restart. Reserve them with `net.ipv4.ip_local_reserved_ports`. You also raise the number of sockets, so check `fs.file-max`, nginx `worker_rlimit_nofile` and conntrack table size (`nf_conntrack_max`), which may be the next limit. Widening only roughly doubles capacity to about 64K per backend, so it is a stopgap, not the real fix."
        },
        {
          "q": "How would you have caught this before users did? Which metric shows port exhaustion?",
          "a": "Watch the proxy rather than the backend. nginx logs `connect() failed (99: Cannot assign requested address)` while connecting to upstream, which is the EADDRNOTAVAIL signature, so alert on that string. At the host level, track established and TIME_WAIT socket counts per destination with `ss -tan state established dst 10.0.1.5:8080 | wc -l` exported by node-exporter or a small script, and alert at about 70% of the port range per backend tuple. Load tests should ramp concurrent WebSockets past 30K through the real proxy, not straight to the backend, so this limit shows up in staging."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-07',
      difficulty: 'hard',
      question:
        'This long-poll endpoint sits behind an AWS ALB with default settings. Clients report frequent 504s and the server logs "write after end" warnings. What is the primary bug?',
      code: {
        language: 'typescript',
        code: `app.get('/poll', (req, res) => {
  const timer = setTimeout(() => res.status(204).end(), 90_000);
  bus.once('event:' + req.query.user, (e) => {
    clearTimeout(timer);
    res.json(e);
  });
});`,
      },
      options: [
        'The 90s hold exceeds the ALB 60s idle timeout, and the listener is never removed on close',
        'bus.once should be bus.on so that multiple events are delivered on one response',
        'A 204 response is invalid for long polling; the server must return 200 with an empty array',
        'setTimeout with 90s blocks the event loop, delaying other requests past the ALB timeout',
      ],
      correct: [0],
      explanation:
        'The ALB closes idle connections after 60s by default, so every quiet poll becomes a 504. The listener is also never removed when the client disconnects, so a later event calls res.json on a dead response ("write after end") and listeners leak. The hold must be below every idle timeout (e.g. 25s), with cleanup on req close. bus.on would respond twice. 204 is fine. Timers do not block the event loop.',
      followUps: [
        {
          "q": "You set the hold to 25s and add cleanup. Now an event fires between one poll returning and the next arriving. How do you make sure the client doesn't miss it?",
          "a": "Make the poll cursor-based. Each response includes the id or sequence of the last event delivered, and the next request sends `?after=<id>`. The server first checks a buffer or durable log for anything after that id and returns immediately if found; only if nothing is newer does it subscribe and hold. To close the race between 'checked, nothing' and 'subscribed', subscribe first, then check the log, then wait. Keep events for at least a few hold intervals, for example in a Redis list or stream capped by time."
        },
        {
          "q": "At 200K concurrent long-polls per node, how does memory and listener count behave with an EventEmitter `bus`, and what changes?",
          "a": "Each poll adds a listener, so one emitter holds 200K listeners and Node warns past the default max of 10. Every emit walks the entire list even though most listeners care about other users. That is O(N) per event and becomes a CPU problem. Index waiters by key instead: `Map<userId, Set<res>>`, so an event touches only that user's waiters. Each waiter holds the req/res objects and a timer, roughly a few KB, so 200K waiters is several hundred MB. Use a single timer wheel or check deadlines in a periodic sweep rather than 200K individual `setTimeout`s if timer overhead shows up in profiles."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-08',
      difficulty: 'medium',
      question:
        'Users open a live-status page in several browser tabs. On the 7th tab the page never loads updates, and other requests to the same site hang too. The site is served over HTTP/1.1. Most effective fix?',
      options: [
        'Switch from SSE to long polling, which does not hold connections',
        'Increase the SSE retry interval so tabs take turns reconnecting',
        'Serve the site over HTTP/2 so streams share one multiplexed connection',
        'Raise nginx worker_connections so the server accepts more tabs',
      ],
      correct: [2],
      explanation:
        'Browsers allow about 6 concurrent HTTP/1.1 connections per origin. Six open EventSource streams exhaust them, which starves every other request. HTTP/2 multiplexes many streams over one connection, typically allowing 100 or more concurrent streams. Long polling also holds a connection. Retry intervals do not free connections that are held open. The limit is client-side, so server settings do not help.',
      followUps: [
        {
          "q": "You cannot move to HTTP/2 this quarter because of an old load balancer. How else do you avoid exhausting the 6-connection limit across tabs?",
          "a": "Share one stream across tabs. Open the EventSource in a SharedWorker, or elect a leader tab with the Web Locks API (`navigator.locks.request('sse-leader', ...)`), and broadcast events to other tabs via `BroadcastChannel`. Only one connection per browser is then used no matter how many tabs are open. When the leader tab closes, its lock is released and another tab takes over and reconnects with Last-Event-ID. Safari's SharedWorker support has been uneven, so the Web Locks plus BroadcastChannel approach is the more portable choice. Another option is to serve the stream from a separate subdomain, which gets its own 6-connection pool."
        },
        {
          "q": "After moving to HTTP/2, a user with 30 tabs open reports the site still stalls. What limit might they hit now?",
          "a": "The server's `SETTINGS_MAX_CONCURRENT_STREAMS`, often 100 or 128 by default in nginx and many servers. If each tab holds one SSE stream and also fires parallel XHRs, images and API calls, 30 tabs can approach that cap on the single shared connection, and new streams queue until one closes. Also, one HTTP/2 connection shares a single TCP congestion window, so a heavy download in one tab can slow events in all. Raising the stream limit helps, but the better fix is still a single shared stream per browser via leader election."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-09',
      difficulty: 'expert',
      question:
        'A market-data gateway runs this loop for each connected client. Memory climbs steadily during market open until the process is OOM-killed. What is the best fix?',
      code: {
        language: 'typescript',
        code: `feed.on('quote', (q) => {
  for (const client of subscribers.get(q.symbol) ?? []) {
    client.ws.send(JSON.stringify(q));   // ~1000 quotes/s per client
  }
});`,
      },
      options: [
        'Wrap send in await so the loop waits for each message to reach the client',
        'Enable permessage-deflate so each message uses less memory in the buffer',
        'Raise --max-old-space-size and add nodes so each holds fewer clients',
        'Watch bufferedAmount; conflate latest quote per symbol; close over a hard cap',
      ],
      correct: [3],
      explanation:
        'ws.send never blocks. For slow clients the data queues in user space (bufferedAmount) and grows without bound. Quotes are state, so conflating to the latest value per symbol bounds memory and keeps data fresh, and a hard cap protects the node. send is not a promise that waits for delivery. Compression adds per-socket zlib memory and CPU but does not fix unbounded growth. More heap only delays the OOM.',
      followUps: [
        {
          "q": "Conflation works for quotes, but the same socket also carries trade executions that must never be dropped. How do you design the per-client queue?",
          "a": "Use two lanes. Executions go into a bounded, ordered, lossless queue with sequence numbers; quotes go into a map keyed by symbol where a new value overwrites the old one. The writer drains executions first, then flushes the current quote map whenever `bufferedAmount` is below a threshold, such as 64 KB. If the lossless lane itself exceeds its cap, for example 10K messages, the client is too slow to be safe; disconnect it with a reason so it reconnects and resyncs executions from the last acknowledged seq over a request/response API. Never silently drop from the lossless lane."
        },
        {
          "q": "How would you load-test this fix to prove it holds during market open?",
          "a": "Simulate slow consumers, not just many fast ones. Drive 1,000 quotes/s per client into the gateway while a test harness opens, say, 10K sockets where 5% read at 10 KB/s or pause reading entirely (stop consuming the TCP stream so the kernel window fills). Assert that process RSS plateaus, that max `bufferedAmount` stays below the cap, that slow clients get disconnected with the right close code, and that fast clients' end-to-end latency p99 is unaffected. Run it for an hour, since leaks show up as slow growth rather than an immediate spike."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-10',
      difficulty: 'expert',
      question:
        'After every WebSocket tier deploy, the auth service is overwhelmed by reconnecting clients. Select ALL changes that meaningfully reduce the spike.',
      options: [
        'Exponential client backoff with full jitter, plus a random initial delay after close 1012',
        'Drain each pod gradually: fail readiness, then close sockets in random batches',
        'Issue signed short-lived resume tokens validated locally on reconnect',
        'Lower the server heartbeat interval from 25s to 5s so dead sockets are found faster',
        'Raise Linux tcp_keepalive_time so the OS keeps old sockets alive during the deploy',
      ],
      correct: [0, 1, 2],
      explanation:
        'Jitter spreads reconnects over time, staggered draining limits how many clients disconnect at once, and resume tokens remove the auth-service call from the reconnect path. Faster heartbeats find dead peers sooner but do nothing for planned closes, and they add load. Kernel keepalive cannot keep a socket alive after its process has exited.',
      followUps: [
        {
          "q": "Clients use full jitter, but they all start the backoff at the same instant. Rough numbers: 2M clients drop and backoff is uniform over 0–30s. What reconnect rate does auth see, and is that OK?",
          "a": "Uniform over 30s gives about 2M ÷ 30 ≈ 67K reconnects/s. That is far better than 2M in the first second, but still likely tens of times normal auth traffic. Whether it is OK depends on the auth service's capacity. With signed resume tokens validated locally by the gateway, those 67K/s never reach auth, only signature checks on the gateways, which cost microseconds each. Without resume tokens, either widen the window, for example 0–120s for non-critical clients, or add admission control at the gateway that returns a 'retry-after' close code when its reconnect budget is exhausted."
        },
        {
          "q": "Resume tokens are validated locally. A user is banned at the moment of the deploy. How do you stop their token from reconnecting them?",
          "a": "Keep tokens short-lived, for example 5–10 minutes, and include a `jti` or user id. Gateways subscribe to a small revocation feed (a Redis set or pub/sub topic of revoked user ids, kept for the token TTL) and check it during the local validation, which is an in-memory lookup. Bans also push a forced disconnect to whichever gateway holds the user's sockets. The trade-off is a tiny revocation window if the feed is delayed, which is acceptable for most products. For high-risk actions, the gateway still calls auth on the first sensitive operation after resume."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-11',
      difficulty: 'hard',
      question:
        'Chat messages are delivered by publishing to Redis pub/sub channel user:{id}. When a connection server restarts, users on it miss every message sent during the ~5s it takes them to reconnect elsewhere. What is the right fix?',
      options: [
        'Enable Redis AOF persistence so pub/sub messages survive restarts',
        'Persist messages with per-user seq first; clients replay after their last seq',
        'Use sticky sessions so users reconnect to the same server after restart',
        'Publish each message twice, 5 seconds apart, to cover the reconnect window',
      ],
      correct: [1],
      explanation:
        'Pub/sub is at-most-once and should only be a real-time nudge. Durability comes from storing the message first with a sequence number and letting the client request everything after its last seen seq when it reconnects. AOF persists the keyspace, not pub/sub traffic. Stickiness does not help, because the server was down. Double publishing causes duplicates and still fails for longer outages.',
      followUps: [
        {
          "q": "Now the persist-first path is in the critical write path. The message store has a 200ms p99. How do you keep chat feeling instant?",
          "a": "Separate the sender's optimistic UI from durability. The client renders the message immediately as 'sending' with its clientMsgId and switches to 'sent' when the ack with seq arrives. On the server, use a store with fast appends, such as Cassandra or a Kafka topic with acks=all, rather than a relational insert with secondary indexes. Assign seq with an atomic per-conversation counter (Redis INCR or a single-writer partition) and persist asynchronously only if you accept a small loss window, which most chat products do not. Also measure p99 by region, since a cross-region quorum write is often the real cause."
        },
        {
          "q": "Clients replay 'after their last seq' on reconnect. A user was offline for 3 weeks and has 50K missed messages across 400 conversations. What does reconnect look like?",
          "a": "Don't replay everything over the socket. On reconnect the client sends its per-conversation high-water marks or a single global sync token. The server returns only a summary first: unread counts and the latest message per conversation, which is roughly 400 rows. Full history is fetched lazily with paginated HTTP requests when the user opens a conversation. Cap the socket replay at a few hundred messages and tell the client to switch to the sync API beyond that. Otherwise one returning user can saturate a gateway's send buffer and the store with a giant scan."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-12',
      difficulty: 'expert',
      question:
        'The API gateway calls service A with a 300ms gRPC deadline. A calls B, and B calls C. Traces show C still doing heavy work 4 seconds after the gateway returned DEADLINE_EXCEEDED. Which statement best explains this and gives the fix?',
      options: [
        'gRPC deadlines apply only to the first hop by design; add a separate timeout to C',
        'HTTP/2 cannot cancel an in-flight stream, so C must poll a Redis flag to stop',
        'A and B made outbound calls without passing on the remaining deadline and cancellation',
        'C must be switched to server streaming so the client can close the stream early',
      ],
      correct: [2],
      explanation:
        'A deadline travels on the wire (the grpc-timeout header) only if each hop sets it on its outbound calls from the incoming context. Go does this through ctx; grpc-js needs the parent call and propagate flags. Otherwise downstream work is orphaned. HTTP/2 does support cancellation with RST_STREAM, which gRPC uses. First-hop-only is a bug, not a design limit, and separate static timeouts ignore the remaining budget. Streaming does not help.',
      followUps: [
        {
          "q": "After propagation is fixed, B always sees deadlines too short to call C, because A spends 250ms of the 300ms. How do you handle this in B?",
          "a": "B should fail fast instead of starting work it cannot finish. Before calling C, check the remaining budget against C's typical latency, for example a p50 of 80ms. If the remainder is 50ms, return DEADLINE_EXCEEDED or a degraded result immediately rather than wasting C's capacity. Then fix the budget split. Look at traces to see where A's 250ms goes, cache or parallelise there, or raise the gateway deadline if the product allows. Record a metric of 'calls skipped due to insufficient budget' per hop so the cause is visible instead of showing as timeouts."
        },
        {
          "q": "C writes to a database and B retries C on DEADLINE_EXCEEDED. What can go wrong?",
          "a": "A deadline expiry tells the caller nothing about whether C committed. C may have finished the write just after B gave up, so a retry can apply it twice, such as double-charging or double-decrementing stock. Make the operation idempotent with an idempotency key passed in metadata and stored with the write, or use a conditional update keyed by a version. Also check the context in C before committing: if the context is already cancelled, roll back instead of committing work nobody is waiting for. Retries should only happen if the remaining budget allows them, and with a retry budget to avoid amplification."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-13',
      difficulty: 'medium',
      question:
        'A mobile food-delivery app keeps a WebSocket open for order updates. iOS users report missing updates when the app has been in the background for a few minutes, although Android users in the foreground are fine. Best approach?',
      options: [
        'Shorten the heartbeat interval to 5s to keep the iOS socket alive in background',
        'Use APNs/FCM for critical background events; resync over HTTP on foreground',
        'Switch to SSE, which the OS keeps alive while the app is in the background',
        'Use long polling with a 5-minute hold so fewer connections are needed',
      ],
      correct: [1],
      explanation:
        'Mobile operating systems suspend backgrounded apps and their sockets. No transport running inside the app survives that, and faster heartbeats cannot run while the app is suspended. The platform push services are designed to wake or alert the app, and a foreground sync closes any gap. SSE and long polling are suspended the same way as the socket.',
      followUps: [
        {
          "q": "Push notifications are not guaranteed: APNs coalesces and may drop them, and users may disable notifications. How do you make sure 'order picked up' is never lost?",
          "a": "Treat push as a hint and server state as the truth. Every order event is stored with a sequence number. When the app comes to the foreground, or the user opens the order screen, it fetches the order's current status and events since its last seq over HTTP. Push only shortens the delay. If notifications are disabled, the in-app state is still correct on open, and for critical events like 'rider arrived' you can add an SMS fallback when no app acknowledgement arrives within, say, 60s. Measure push delivery with client-side receipts to know the real loss rate."
        },
        {
          "q": "Product wants the rider's moving map to update live while the app is backgrounded on iOS. Can you deliver that?",
          "a": "Not with a socket, since iOS suspends the app. The supported route is a Live Activity (Dynamic Island and lock screen) updated through APNs with the `liveactivity` push type. Updates are rate-limited by the system; frequent high-priority pushes may be throttled, so send meaningful updates such as ETA changes or new status, perhaps every 30–60s, not every GPS fix. Android can use a foreground service with an ongoing notification. Once the user opens the app, switch back to the WebSocket for smooth per-second updates."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-14',
      difficulty: 'hard',
      question:
        'You are securing a browser-facing WebSocket endpoint that authenticates with session cookies. Select ALL statements that are correct.',
      options: [
        'The browser WebSocket API cannot set an Authorization header on the handshake',
        'Validate the Origin header at upgrade to stop cross-site WebSocket hijacking',
        'Long-lived tokens in the URL may be logged by proxies; prefer short single-use tickets',
        'Same-origin policy blocks cross-origin WebSocket handshakes, so CSRF cannot happen here',
      ],
      correct: [0, 1, 2],
      explanation:
        'The browser API allows only a URL and subprotocols, so no custom headers can be added. WebSockets are not covered by same-origin policy and cookies are sent automatically, so a malicious page can open an authenticated socket unless the server checks Origin. Query strings end up in access logs, so use single-use tickets that expire in seconds. The last option is the dangerous misconception behind cross-site WebSocket hijacking.',
      followUps: [
        {
          "q": "You add Origin validation. A native mobile app and a server-side partner integration also connect, and they don't send a browser Origin. How do you handle them?",
          "a": "Origin checks protect browsers from cross-site hijacking, because a malicious page can make the browser send cookies. Non-browser clients aren't vulnerable in that way, but they shouldn't be able to bypass auth by omitting Origin either. Split by auth method. Cookie-authenticated connections must present an allow-listed Origin; connections without Origin must authenticate with a bearer token or ticket instead of cookies, so a missing Origin never grants cookie-based access. Partners can use a separate endpoint with mTLS or API keys. Never allow 'no Origin' as a bypass for cookie auth."
        },
        {
          "q": "A user's session is revoked (password change) while their WebSocket is open for 8 hours. What happens, and how do you fix it?",
          "a": "Nothing, by default. Auth is checked only at the upgrade, so the socket stays authenticated for its whole life. Fix it two ways. First, push revocations: the auth service publishes 'session revoked' events and the gateway closes matching sockets with a policy-violation close code (1008). Second, cap socket lifetime or require re-authentication, for example a token-refresh message every 15 minutes, failing which the server closes the socket. Also re-check authorisation per message for sensitive actions, such as joining a channel, rather than trusting the upgrade-time decision forever."
        }
      ],
    },
    {
      id: 'net-realtime-mcq-15',
      difficulty: 'expert',
      question:
        'In a quote-streaming service, a developer removed field 4 (string exchange) from the Quote protobuf and later added a new field "int64 volume = 4". Older clients still in the wild now show nonsense exchange values or fail to decode quotes. What is the correct lesson?',
      options: [
        'Protobuf identifies fields by name, so the new field should have used a unique name',
        'Removed field numbers must be reserved and never reused; volume needs a new number',
        'Proto3 cannot evolve schemas; a new package version (market.v2) is always required',
        'Old clients must be forced to upgrade, since unknown fields always cause decode errors',
      ],
      correct: [1],
      explanation:
        'Protobuf encodes the field number and wire type, not the name. Reusing number 4 with a different type makes old clients misread or reject the bytes. Reserve removed numbers and names, and add new fields under fresh numbers. Unknown fields are skipped safely, which is what makes additive evolution work without a new major version or a forced upgrade.',
      followUps: [
        {
          "q": "How do you stop this from happening again before code merges, not after old clients break?",
          "a": "Add a schema compatibility check in CI. Tools like `buf breaking` compare the changed `.proto` files against the main branch or the last released version and fail the build on wire-incompatible changes: field number reuse, type changes, removed fields without `reserved`, and renamed enum values. Keep protos in a shared repo or a schema registry so every service is checked against the same history. Code review alone misses these, because the diff looks harmless. Also run a contract test where an old client binary decodes messages produced by the new server."
        },
        {
          "q": "You need to change `price` from `double` to a fixed-point representation without breaking old clients. What's the migration?",
          "a": "Add a new field, for example `int64 price_micros = 9`, and leave `double price = 3` in place. The server populates both during the transition. New clients prefer `price_micros` when present and fall back to `price`. Once client telemetry shows that nearly all clients run versions that read the new field, stop populating `price`, then mark it deprecated and later `reserved 3; reserved \"price\";`. Changing the type of field 3 in place would be read by old clients as garbage, because the wire type changes from 64-bit fixed to varint."
        }
      ],
    },
  ],
};

export default topic;
