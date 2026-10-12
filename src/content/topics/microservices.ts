import type { Topic } from '../../types';

const topic: Topic = {
  id: 'microservices',
  phase: 'platform',
  order: 3,
  title: 'Microservices Architecture & Monolith Migration',
  subtitle:
    'Monolith vs modular monolith vs microservices, DDD boundaries, data ownership, sync vs async, CQRS, event sourcing, strangler fig migration and the distributed-monolith trap',
  estimatedMinutes: 95,
  sources: [
    'Mastering API Architecture — Ch 8 Redesigning Applications to API-Driven Architectures',
    'Sam Newman — Building Microservices (2nd ed.) / Monolith to Microservices',
    'Eric Evans — Domain-Driven Design (bounded contexts)',
    'Martin Fowler — StranglerFigApplication, CQRS, Event Sourcing',
  ],
  tags: [
    'microservices',
    'modular-monolith',
    'ddd',
    'bounded-context',
    'database-per-service',
    'cqrs',
    'event-sourcing',
    'strangler-fig',
    'conways-law',
    'contracts',
  ],
  cheatSheet: [
    'Microservices buy **independent deployability + team autonomy**, paid for with network calls, distributed data and ops overhead — they are an org-scaling tool first, a tech-scaling tool second.',
    'Default for a new product or <~30 engineers: **modular monolith** with enforced module boundaries; extract a service only when a boundary needs a different deploy cadence, scaling profile, or failure isolation.',
    'Draw boundaries around **bounded contexts** (language + data + invariants), not nouns or layers; "one aggregate needs a transaction" means it stays inside one service.',
    '**Database per service**: no other service reads or writes your tables. Cross-service reads = API composition or a replicated read model; cross-service writes = saga (see ds-transactions).',
    'Availability compounds: 10 serial dependencies at 99.9% each ≈ 99.0% (7.3h/month down). Tail compounds: fan-out to 30 calls means ~26% of requests hit at least one p99.',
    'Prefer **async events for propagation of facts** (OrderPlaced) and **sync calls only when the caller needs the answer now**; always set timeouts, retries with jitter and circuit breakers on sync edges.',
    '**CQRS** = separate write model from read models, fed by events; accept seconds of staleness. **Event sourcing** = the event log IS the source of truth; state = fold(events), snapshot every N events.',
    '**Strangler fig**: put a routing facade in front of the monolith, carve one seam at a time (read paths first), dual-run and compare, then cut over and delete the old code.',
    '**Distributed monolith smells**: lockstep deploys, shared DB, shared "common" domain library, sync call chains 5+ deep, one release train. Fix the coupling, not the number of services.',
    "**Conway's law**: architecture mirrors communication structure — one team per service (or a few), stream-aligned teams, and a platform team that provides paved roads.",
  ],
  sections: [
    {
      heading: 'The architecture spectrum: monolith → modular monolith → microservices → functions',
      body: `**Intuition:** a monolith is one house where every room shares plumbing; microservices are a street of houses with their own plumbing connected by roads. The street lets families renovate independently, but now you need roads, addresses and a postal service.

| Style | Deploy unit | Data | Strengths | Costs |
|---|---|---|---|---|
| Monolith (big ball of mud) | 1 | 1 shared schema | Simple ops, in-process calls (~ns–µs), ACID everywhere | Coupling grows unchecked, slow builds, one bad change takes everything down |
| **Modular monolith** | 1 | 1 DB, schema-per-module | Enforced boundaries, cheap refactors, still ACID | Scales as one unit; needs discipline (lint rules / package boundaries) |
| SOA (ESB era) | Many, coarse | Often shared | Reuse of enterprise capabilities | Smart pipes (ESB) held business logic; central bottleneck |
| **Microservices** | Many, fine | DB per service | Independent deploy/scale, fault isolation, team autonomy | Network latency (0.5–5 ms/hop), partial failure, eventual consistency, platform cost |
| Functions (FaaS) | Per function | Managed stores | Scale to zero, pay per invocation | Cold starts (100 ms–seconds), execution limits, vendor lock-in, hard local testing |

**Precise mechanics:** the thing that actually changes as you move right is the **cost of a boundary crossing**. In-process calls are nanoseconds and share a transaction; a network hop inside a datacenter is ~0.5 ms median but tens of ms at p99 under load, can fail independently, and cannot join your DB transaction.

**Trade-off in one line:** microservices convert *code coupling problems* into *distributed systems problems*. That is a good trade only when the coupling problem is organizational (50+ engineers tripping over one deploy) or operational (one component needs 40× the compute of the rest).

**In interviews say:** "I'd start with a modular monolith with strict module boundaries, and extract services where there is a concrete driver — independent scaling, a different release cadence, fault isolation, or a separate team. Microservices are a means, not a goal."`,
      diagram: `  Monolith            Modular monolith         Microservices
 +-----------+       +-----------------+      +-----+  +-----+  +-----+
 | UI        |       | [orders] [cart] |      |order|  |cart |  |pay  |
 | business  |       | [pay]  [users]  |      +--+--+  +--+--+  +--+--+
 | data acc. |       |  public APIs    |         |        |        |
 +-----+-----+       |  only between   |       (db)     (db)     (db)
       |             +--------+--------+
     (db)                   (db: schema per module)
  coupling: any-to-any    coupling: via module API   coupling: via network API`,
      keyPoints: [
        'The real variable is the cost of crossing a boundary: ns in-process vs ms + failure over the network.',
        'Modular monolith is the sensible default; it keeps extraction cheap later.',
        'SOA failed mostly because logic moved into smart pipes (ESB); microservices use smart endpoints, dumb pipes.',
        'FaaS fits spiky, event-driven, stateless glue — not chatty, latency-critical core paths.',
      ],
      source: 'Mastering API Architecture — Ch 8 (monolith, SOA, microservices, functions)',
    },
    {
      heading: 'Why evolve at all? Drivers, fitness functions and Conway\'s law',
      body: `**Intuition:** don't move house because the neighbours did. Move because the kids no longer fit.

**Legitimate drivers** (name them explicitly in an interview):
- **Team scaling** — 8 teams merging into one repo/deploy pipeline; merge queues of hours, a release train every 2 weeks.
- **Independent scaling** — the image-resize or search component needs 40 cores while the CRUD API needs 4.
- **Fault isolation** — a memory leak in PDF generation shouldn't take down checkout.
- **Different technology** — ML inference in Python beside a NestJS API.
- **Compliance boundary** — PCI scope limited to a small payments service.

**Non-drivers:** "Netflix does it", "the code is messy" (a distributed mess is worse), "we want Kubernetes".

**Fitness functions** (from *Building Evolutionary Architectures*, used in Mastering API Ch 8) turn architectural goals into automated checks: "no module imports another module's internals", "p99 of checkout < 300 ms", "a service deploys in < 15 minutes", "no service calls more than 3 downstream services synchronously". They stop the architecture from rotting while you evolve it.

**Conway's law:** "organizations design systems that mirror their own communication structure." The **inverse Conway manoeuvre** is to shape teams to the architecture you want. Team Topologies vocabulary: **stream-aligned teams** own a slice of the business end-to-end; a **platform team** provides paved roads (CI/CD templates, observability, service scaffolding); **enabling** and **complicated-subsystem** teams help where needed. A service owned by three teams is a monolith with extra latency.

**In production:** track DORA metrics (deploy frequency, lead time, change-failure rate, MTTR) before and after — they are the business case for (or against) the migration.`,
      code: [
        {
          language: 'typescript',
          title: 'Fitness function: fail CI when a module reaches into another module\'s internals (dependency-cruiser config)',
          code: `// .dependency-cruiser.js — runs in CI: npx depcruise src --config .dependency-cruiser.js
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment: 'Modules may only import each other through their public index.ts',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/(?!index\\\\.ts$)', // anything except the public API file
        pathNot: '^src/modules/$1/', // $1 = same module as "from": internal imports are fine
      },
    },
    {
      name: 'no-shared-repositories',
      severity: 'error',
      comment: 'A module must never use another module repository/entity directly',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/[^/]+/infra/.*\\\\.repository\\\\.ts$', pathNot: '^src/modules/$1/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true }, // cycles between modules = future distributed monolith
    },
  ],
};`,
        },
      ],
      keyPoints: [
        'State the driver (teams, scaling profile, fault isolation, compliance) before proposing a split.',
        'Fitness functions make boundaries enforceable in CI instead of relying on code review.',
        'Architecture follows team communication; design teams and services together.',
        'Measure DORA metrics to prove the migration is paying off.',
      ],
      source: 'Mastering API Architecture — Ch 8 (fitness functions, why use APIs to evolve)',
    },
    {
      heading: 'Finding service boundaries with DDD bounded contexts',
      body: `**Intuition:** the word "Product" means a catalog listing to marketing, a SKU with stock to the warehouse, and a line item with a tax code to billing. Each meaning is a **bounded context** — a boundary inside which a term has one precise meaning and one owner.

**Mechanics:**
1. **Event storming** with domain experts: sticky notes of domain events (OrderPlaced, PaymentCaptured, ShipmentDispatched) on a timeline, then commands and aggregates.
2. Cluster events by the **invariants** they protect. An **aggregate** (e.g. Order with its lines) is the consistency boundary — everything inside must change atomically, so an aggregate never spans services.
3. Draw a **context map**: who is upstream/downstream, and the relationship — *customer/supplier*, *conformist*, *anti-corruption layer (ACL)* to protect your model from a legacy one, *published language* (shared event schema).
4. Check **cohesion and coupling** (Mastering API Ch 8): things that change together belong together; a "utils service" that every change touches is a smell.

**Heuristics for a good boundary:**
- Owns its data and can answer its core queries without calling others.
- A typical feature touches **one** service (if most features touch 3 services, the boundary is wrong).
- Can be owned by one team; has a name business people recognise.
- Chatty sync traffic across a boundary (> a few calls per request) means you split an aggregate.

**Wrong boundaries** are the #1 reason microservice programs fail: entity services ("CustomerService", "ProductService") that every workflow must orchestrate, or layer services ("DataAccessService"). Prefer capability services ("Pricing", "Fulfilment", "Checkout").

**In interviews say:** "I'd find bounded contexts via event storming, keep each aggregate inside one service, and validate with the 'one feature, one service' test. If I'm unsure, I keep it in the modular monolith until the boundary proves stable — splitting is cheap later, merging is expensive."`,
      diagram: `                    Context map (e-commerce)
 +-------------+  OrderPlaced   +--------------+  StockReserved  +-----------+
 |  Checkout   | -------------> | Fulfilment   | --------------> | Shipping  |
 | (Order agg) |   (published   | (Stock agg)  |                 |           |
 +------+------+    language)   +------+-------+                 +-----------+
        | sync: quote()                ^
        v                              | ACL (translates legacy SKU model)
 +-------------+                +------+-------+
 |  Pricing    |                | Legacy ERP   |
 +-------------+                +--------------+
  "Product" = listing        "Product" = SKU + bin      "Product" = parcel`,
      keyPoints: [
        'Bounded context = one model, one language, one owner.',
        'Aggregates are transactional boundaries and must not straddle services.',
        'Capability services beat entity services; entity services create orchestration hubs.',
        'Use an anti-corruption layer when integrating with a legacy or foreign model.',
      ],
      source: 'Mastering API Architecture — Ch 8 (cohesion, coupling, domain boundaries); Evans — DDD',
    },
    {
      heading: 'Database per service and distributed data',
      body: `**Intuition:** if two services share a table, they are one service wearing two uniforms — neither can change the schema without the other.

**Rule:** a service's data is private; others access it **only through its API or its events**. It can be a separate schema on a shared cluster early on (cheaper), as long as credentials prevent cross-access — the rule is about *ownership*, not physical servers.

**What you lose and how to replace it:**

| Monolith feature | Microservices replacement |
|---|---|
| JOIN across domains | **API composition** (fan-out + merge) or a **replicated read model** built from events |
| ACID transaction across domains | **Saga** with compensations (details: ds-transactions) + idempotent steps |
| Foreign keys | Reference by ID; tolerate dangling refs; reconcile asynchronously |
| "Update DB then publish event" atomically | **Transactional outbox** (write event row in same local TX, relay to Kafka) |
| Ad-hoc reporting SQL | CDC to a warehouse / lake (Debezium → Kafka → Snowflake/BigQuery) |

**Data replication pattern:** Fulfilment keeps a local, read-only copy of the product fields it needs (\`sku, weight, hazmat\`), updated from Catalog's ProductUpdated events. It is eventually consistent (typically < 1–2 s lag), but Fulfilment no longer calls Catalog on the hot path, so Catalog being down doesn't block shipping.

**Trade-offs:** API composition is simple and fresh but multiplies latency and failure; replicated read models are fast and resilient but stale and need backfill/replay tooling.

**In production:** the outbox + CDC combo is the workhorse. Budget for **reconciliation jobs** — some events will be lost or processed twice; nightly diffs catch drift.`,
      code: [
        {
          language: 'typescript',
          title: 'API composition with a time budget, parallel fan-out and graceful degradation',
          code: `import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrderDetailsComposer {
  constructor(private readonly http: HttpService) {}

  async getOrderDetails(orderId: string) {
    // The order is the "must have" call — fail the request if it fails.
    const order = await this.get('http://orders.svc/orders/' + orderId, 300);

    // Enrichment calls run in PARALLEL, each with its own tight timeout.
    const [shipment, payment] = await Promise.allSettled([
      this.get('http://shipping.svc/shipments?orderId=' + orderId, 200),
      this.get('http://payments.svc/payments?orderId=' + orderId, 200),
    ]);

    return {
      ...order,
      // Degrade instead of failing the whole page when a non-critical service is down.
      shipment: shipment.status === 'fulfilled' ? shipment.value : { status: 'UNKNOWN' },
      payment: payment.status === 'fulfilled' ? payment.value : { status: 'UNKNOWN' },
      partial: shipment.status === 'rejected' || payment.status === 'rejected',
    };
  }

  private async get(url: string, timeoutMs: number) {
    const res = await firstValueFrom(this.http.get(url, { timeout: timeoutMs }));
    return res.data;
  }
}`,
        },
      ],
      keyPoints: [
        'Ownership, not hardware: a shared cluster is fine; shared tables are not.',
        'Replace joins with API composition (fresh, fragile) or replicated read models (fast, stale).',
        'Replace distributed transactions with sagas + outbox; details live in ds-transactions.',
        'Plan reconciliation jobs from day one; eventual consistency drifts.',
      ],
    },
    {
      heading: 'Communication: sync vs async, and service discovery',
      body: `**Intuition:** a sync call is a phone call — you wait, and if they don't pick up, you're stuck. An async event is a letter — you move on, and they read it when they can.

| Aspect | Sync (REST/gRPC) | Async (Kafka/SQS/RabbitMQ events) |
|---|---|---|
| Coupling in time | Both must be up | Producer independent of consumer uptime |
| Latency | Adds per-hop latency to the user request | Off the request path; end-to-end lag ms–s |
| Consistency | Read-your-writes easy | Eventual; need idempotency + ordering keys |
| Failure mode | Cascading failures, retry storms | Backlog/lag, poison messages, duplicates |
| Best for | Queries, commands needing an immediate answer (price quote, auth) | Propagating facts (OrderPlaced), workflows, fan-out to many consumers |

**Rules of thumb:**
- **Commands** ("reserve stock") can be sync or async; **events** ("stock reserved") are always async facts in past tense.
- Keep sync chains **≤ 2–3 hops** on the user path. Each hop needs a timeout smaller than the caller's (deadline propagation), bounded retries with jitter, and a circuit breaker (see rel-patterns).
- gRPC for internal high-QPS calls (HTTP/2 multiplexing, protobuf ~3–10× smaller than JSON); REST/JSON at the edge.
- **Choreography** (services react to events) scales teams but hides the workflow; **orchestration** (a workflow engine like Temporal or a saga orchestrator) makes it explicit. Use orchestration once a flow spans 4+ steps.

**Service discovery:** callers need a live address list.
- **Server-side / platform DNS** (Kubernetes): \`orders.prod.svc.cluster.local\` resolves to a ClusterIP; kube-proxy load-balances to ready pods. Zero client code.
- **Client-side registry** (Consul, Eureka): client fetches instances and load-balances itself — smarter balancing, but a library per language.
- **Service mesh** (Istio/Linkerd) moves discovery, mTLS, retries and telemetry into sidecars — covered in net-service-mesh.

**Readiness matters:** discovery is only as good as health checks — a pod that is "up" but hasn't warmed its connection pool should fail readiness, or it will receive traffic and time out.`,
      code: [
        {
          language: 'yaml',
          title: 'Kubernetes Service + readiness probe = platform service discovery',
          code: `apiVersion: v1
kind: Service
metadata:
  name: orders            # callers use http://orders.prod.svc.cluster.local
  namespace: prod
spec:
  selector:
    app: orders           # endpoints = ready pods with this label
  ports:
    - name: http
      port: 80
      targetPort: 3000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders
  namespace: prod
spec:
  replicas: 6
  selector:
    matchLabels: { app: orders }
  template:
    metadata:
      labels: { app: orders }
    spec:
      containers:
        - name: orders
          image: registry.example.com/orders:1.42.0
          ports: [{ containerPort: 3000 }]
          readinessProbe:           # only READY pods are added to the Service endpoints
            httpGet: { path: /health/ready, port: 3000 }
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:            # restart only if truly wedged; never check dependencies here
            httpGet: { path: /health/live, port: 3000 }
            periodSeconds: 10
            failureThreshold: 6`,
        },
      ],
      keyPoints: [
        'Sync when the caller needs the answer now; async to propagate facts.',
        'Keep user-facing sync chains shallow and deadline-propagated.',
        'Platform DNS discovery is the default on Kubernetes; meshes add mTLS and traffic policy.',
        'Readiness probes are part of discovery; liveness probes must not check dependencies.',
      ],
    },
    {
      heading: 'The API gateway and BFF in a microservice landscape',
      body: `**Intuition:** the gateway is the hotel reception — guests talk to one desk, not to housekeeping, the kitchen and accounting separately.

**Role in microservices** (mechanics of gateways themselves live in net-proxies-gateway):
- **Single entry point** that hides internal topology; you can split or merge services without breaking clients.
- **Cross-cutting edge concerns**: TLS termination, authN (validate JWT once), rate limiting, request IDs, WAF.
- **Routing and release control**: path/header based routing is exactly what the strangler fig and canary releases need.
- **Backend for Frontend (BFF)**: one aggregation layer per client type (web, mobile, partner) that composes internal APIs into screen-shaped responses. A GraphQL federation gateway (Apollo Router) is a popular BFF where each service owns a subgraph.

**Anti-patterns:**
- **Business logic in the gateway** — it becomes the new ESB and every team queues on the gateway team.
- **One giant shared BFF** — recreates the monolith at the edge; BFFs should be owned by the client teams.
- Gateway as the only security layer — internal calls still need service identity (mTLS / workload identity) and authorization (zero trust).

**API layer cake (Mastering API Ch 8):** think in layers — **experience APIs** (BFF/gateway, shaped for clients), **process APIs** (orchestrating a business process), **system APIs** (wrapping systems of record, including the legacy monolith). Layering lets you swap the system underneath while the experience contract stays stable.`,
      diagram: `  web app     mobile app     partners
     |            |              |
 +---v---+   +----v----+   +-----v------+   experience layer
 |web BFF|   |mob. BFF |   |public API GW|   (auth, rate limit, shape)
 +---+---+   +----+----+   +-----+------+
     \\____________|______________/
            |              |
      +-----v-----+  +-----v-----+          process layer
      | checkout  |  | returns   |          (workflows)
      +-----+-----+  +-----+-----+
            |              |
   +--------v--+  +--------v--+  +----------+  system layer
   | orders    |  | payments  |  | legacy   |  (systems of record)
   +-----------+  +-----------+  | monolith |
                                 +----------+`,
      keyPoints: [
        'Gateway hides topology so services can be split/merged without client changes.',
        'Keep business logic out of the gateway; aggregation belongs in client-owned BFFs.',
        'Experience / process / system layering isolates clients from legacy systems.',
        'Zero trust: internal hops still authenticate and authorize.',
      ],
      source: 'Mastering API Architecture — Ch 8 (API layer cake); Ch 2–3 (gateways)',
    },
    {
      heading: 'CQRS: separate the write model from read models',
      body: `**Intuition:** the kitchen (write side) is organised for cooking correctly; the menu board (read side) is organised for customers to glance at. You don't make customers read the kitchen's order tickets.

**Mechanics:**
- **Command side** validates invariants on aggregates and persists changes (normalized, transactional).
- It emits **events** (via outbox/CDC) that **projectors** consume to build one or more **read models** shaped for specific queries: a denormalized Postgres table, an Elasticsearch index for search, a Redis hash for a hot dashboard.
- Queries hit read models only — no joins, no cross-service calls at read time.

**Why in microservices:** it is the standard answer to "we lost cross-service joins". The Order History screen needs order + payment + shipment status; a projector in the Order-History service listens to all three event streams and maintains one row per order.

**Costs:**
- **Staleness**: typically 100 ms–2 s; UX must tolerate it (show "processing", or read-your-own-writes by returning the command result directly or routing that user's next read to the write side).
- **Idempotency and ordering**: projectors must handle duplicates and out-of-order events — track a per-aggregate version and ignore older events.
- **Rebuilds**: new read model or bug fix = replay the event stream from the start (Kafka retention/compaction or the event store) into a fresh table, then swap.

**Don't** apply CQRS to plain CRUD screens — it doubles moving parts for no gain. Use it where read and write shapes/scales differ dramatically (e.g. 100:1 read:write, search, dashboards).`,
      code: [
        {
          language: 'typescript',
          title: 'Idempotent, order-safe projector (kafkajs + pg) building an order-history read model',
          code: `import { Kafka } from 'kafkajs';
import { Pool } from 'pg';

const pool = new Pool({ max: 10 });
const kafka = new Kafka({ clientId: 'order-history', brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'order-history-projector' });

type OrderEvent = { orderId: string; version: number; type: string; status?: string; total?: number };

async function project(e: OrderEvent) {
  // Upsert guarded by version: duplicates and older (out-of-order) events are no-ops.
  await pool.query(
    'INSERT INTO order_history (order_id, status, total, version, updated_at) ' +
      'VALUES ($1, $2, $3, $4, now()) ' +
      'ON CONFLICT (order_id) DO UPDATE SET ' +
      '  status = COALESCE(EXCLUDED.status, order_history.status), ' +
      '  total = COALESCE(EXCLUDED.total, order_history.total), ' +
      '  version = EXCLUDED.version, updated_at = now() ' +
      'WHERE order_history.version < EXCLUDED.version',
    [e.orderId, e.status ?? null, e.total ?? null, e.version],
  );
}

export async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'orders.events', fromBeginning: true }); // allows full rebuilds
  await consumer.run({
    // Messages are keyed by orderId, so one order's events stay ordered within a partition.
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value!.toString()) as OrderEvent;
      await project(event); // offset commits after success => at-least-once + idempotent = effectively once
    },
  });
}`,
        },
      ],
      keyPoints: [
        'Write model protects invariants; read models are disposable, query-shaped projections.',
        'Staleness is the price — design UX and read-your-writes explicitly.',
        'Projectors must be idempotent and version-aware; key events by aggregate id.',
        'Skip CQRS for simple CRUD.',
      ],
    },
    {
      heading: 'Event sourcing: the log is the source of truth',
      body: `**Intuition:** a bank doesn't store "balance = 120"; it stores every deposit and withdrawal, and the balance is the sum. Event sourcing stores the **facts that happened** and derives state by replaying them.

**Mechanics:**
- An aggregate's state = **fold(initialState, events)**. Commands load the aggregate by replaying its stream, check invariants, and append new events.
- Appends use **optimistic concurrency**: "append at expected version 7"; a unique constraint on (stream_id, version) rejects a concurrent writer, which reloads and retries.
- **Snapshots** every N events (e.g. 100) cap load time: load latest snapshot + events after it.
- Events are **immutable**; you fix mistakes with compensating events. Schema changes use **upcasters** (transform v1 events to v2 shape on read).
- Event store options: EventStoreDB, Postgres table (below), or Kafka as a log (but Kafka lacks per-stream optimistic concurrency, so it is usually the *distribution* channel, not the store).

**Benefits:** complete audit trail (finance, compliance), temporal queries ("what did the cart look like at 14:03?"), natural fit for CQRS projections, debugging by replay.

**Costs:** harder queries (always need projections), event schema evolution forever, GDPR erasure (use crypto-shredding: encrypt PII per user, delete the key), and a steep learning curve. Use it for **a few core aggregates** where history is the business (ledgers, orders, bookings) — not the whole system.`,
      code: [
        {
          language: 'sql',
          title: 'Postgres event store with optimistic concurrency',
          code: `CREATE TABLE events (
  global_position BIGSERIAL PRIMARY KEY,         -- total order for projectors to tail
  stream_id       TEXT        NOT NULL,          -- e.g. 'order-8c1f'
  version         INT         NOT NULL,          -- 1,2,3... per stream
  type            TEXT        NOT NULL,          -- 'OrderPlaced', 'ItemAdded'
  schema_version  SMALLINT    NOT NULL DEFAULT 1,-- for upcasting
  data            JSONB       NOT NULL,
  metadata        JSONB       NOT NULL DEFAULT '{}', -- correlation/causation ids, actor
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stream_id, version)                    -- the optimistic-concurrency guard
);

CREATE TABLE snapshots (
  stream_id TEXT PRIMARY KEY,
  version   INT   NOT NULL,
  state     JSONB NOT NULL
);

-- Append at expected version 7: if another writer already wrote version 8,
-- this INSERT violates UNIQUE(stream_id, version) and the command must reload + retry.
INSERT INTO events (stream_id, version, type, data)
VALUES ('order-8c1f', 8, 'ItemAdded', '{"sku":"A-1","qty":2}');

-- Load: latest snapshot, then only the tail of events.
SELECT version, type, data FROM events
WHERE stream_id = 'order-8c1f' AND version > 100 -- 100 = snapshot version
ORDER BY version;`,
        },
        {
          language: 'typescript',
          title: 'Aggregate rehydration and command handling',
          code: `type OrderEvent =
  | { type: 'OrderPlaced'; data: { customerId: string } }
  | { type: 'ItemAdded'; data: { sku: string; qty: number; price: number } }
  | { type: 'OrderSubmitted'; data: Record<string, never> };

interface OrderState { status: 'NONE' | 'DRAFT' | 'SUBMITTED'; total: number; version: number }

const initial: OrderState = { status: 'NONE', total: 0, version: 0 };

// Pure reducer: state = fold(events). No I/O, no clocks, no randomness.
function apply(s: OrderState, e: OrderEvent): OrderState {
  switch (e.type) {
    case 'OrderPlaced': return { ...s, status: 'DRAFT', version: s.version + 1 };
    case 'ItemAdded': return { ...s, total: s.total + e.data.qty * e.data.price, version: s.version + 1 };
    case 'OrderSubmitted': return { ...s, status: 'SUBMITTED', version: s.version + 1 };
  }
}

export function rehydrate(snapshot: OrderState | null, tail: OrderEvent[]): OrderState {
  return tail.reduce(apply, snapshot ?? initial);
}

// Command: check invariants against current state, return NEW events (not new state).
export function addItem(s: OrderState, sku: string, qty: number, price: number): OrderEvent[] {
  if (s.status !== 'DRAFT') throw new Error('Cannot add items to a ' + s.status + ' order');
  if (qty <= 0 || qty > 100) throw new Error('Invalid quantity');
  return [{ type: 'ItemAdded', data: { sku, qty, price } }];
  // Caller appends these at expectedVersion = s.version (+1, +2, ...) in one transaction.
}`,
        },
      ],
      keyPoints: [
        'State is a fold over immutable events; commands emit events.',
        'UNIQUE(stream_id, version) gives optimistic concurrency per aggregate.',
        'Snapshots bound replay cost; upcasters handle event schema evolution.',
        'Use for a few history-centric aggregates, not the whole platform; plan GDPR via crypto-shredding.',
      ],
    },
    {
      heading: 'Contracts: versioning, consumer-driven contract tests and independent deploys',
      body: `**Intuition:** independent deployability is a promise: "I can ship on Tuesday without asking you". Contracts are how you keep it.

**Mechanics:**
- **Backward-compatible changes by default**: add optional fields, never rename/remove/retype; consumers must ignore unknown fields (tolerant reader). Protobuf helps: field numbers are the contract; \`reserved\` stops reuse of deleted numbers.
- **Expand → migrate → contract** for breaking changes: add the new field/endpoint, migrate consumers, then remove the old one after telemetry shows zero traffic.
- **Consumer-driven contract tests (Pact)**: each consumer publishes the interactions it relies on; the provider's CI verifies them before deploy (\`can-i-deploy\`). This replaces brittle, slow end-to-end environments where 40 services must be deployed together to test anything.
- **Event schemas** are APIs too: register them (Confluent Schema Registry / Apicurio) with BACKWARD or FULL compatibility enforced at produce time.
- Version at the **resource or message** level, not a shared "platform version" that forces lockstep releases. (URI vs header versioning is covered in api-evolution.)

**Shared libraries** — the quiet killer: a \`common-domain\` npm package containing entities means every change forces every service to upgrade together. Share only **infrastructure** libs (logging, tracing, auth middleware) with semver and slow-moving APIs; never share domain models — duplicate the few fields you need.`,
      code: [
        {
          language: 'protobuf',
          title: 'Evolving a gRPC contract safely',
          code: `syntax = "proto3";

package orders.v1;

message Order {
  string id = 1;
  string customer_id = 2;
  // Field 3 (float total) was removed: reserve number AND name so nobody reuses them
  // with a different type, which would silently corrupt old clients.
  reserved 3;
  reserved "total";
  Money total_amount = 4;          // replacement: money as integer minor units + currency
  OrderStatus status = 5;
  optional string promo_code = 6;  // additive, optional: old clients ignore it
}

message Money {
  int64 minor_units = 1;           // 1999 = 19.99
  string currency = 2;             // ISO-4217, e.g. "EUR"
}

enum OrderStatus {
  ORDER_STATUS_UNSPECIFIED = 0;    // proto3 default; consumers must handle unknown values
  ORDER_STATUS_PLACED = 1;
  ORDER_STATUS_PAID = 2;
  ORDER_STATUS_SHIPPED = 3;
}

service OrderService {
  rpc GetOrder(GetOrderRequest) returns (Order);
}

message GetOrderRequest { string id = 1; }`,
        },
      ],
      keyPoints: [
        'Only additive changes by default; tolerant readers ignore unknown fields.',
        'Breaking change = expand, migrate, contract — driven by traffic telemetry.',
        'Consumer-driven contract tests gate deploys instead of shared E2E environments.',
        'Never share domain-model libraries; share only slow-moving infrastructure libs.',
      ],
    },
    {
      heading: 'Strangler fig migration: monolith → services without a big-bang rewrite',
      body: `**Intuition:** the strangler fig vine grows around a tree, gradually taking over until the old tree can be removed. You grow the new system around the monolith, route by route.

**The plan (say this in order):**
1. **Baseline & goals** — which pain are we solving (deploy contention? scaling hot path?), DORA + latency metrics today, fitness functions.
2. **Modularize in place first** — find **seams** (Mastering API Ch 8: places where behaviour can be changed without editing in place — an interface, a module boundary, an HTTP route). Untangle one module's data into its own schema inside the monolith DB.
3. **Put a facade in front** — gateway/reverse proxy routes 100% to the monolith. Now routing is a config change.
4. **Pick the first slice** — high value, low coupling, clear ownership (e.g. notifications, search, pricing). Avoid the core transactional heart first.
5. **Build the new service** behind an **anti-corruption layer / adapter** that translates the monolith's model; for data, sync via **CDC from the monolith DB** (Debezium) until the service becomes the owner.
6. **Shadow / dark launch** — mirror traffic, compare responses (diff rate < 0.1%), then **canary** 1% → 10% → 50% → 100% with the facade.
7. **Flip data ownership** — the service becomes the writer; the monolith reads via the service API (or a CDC-fed copy flowing the other way).
8. **Delete the old code** — the step most teams skip; until then you run two systems.

**Timeline realism:** a first slice commonly takes 2–4 months including platform work (CI/CD, observability, service template); later slices get faster. Expect a multi-year program for a large monolith — and it is fine to stop when the remaining monolith is healthy.

**Other patterns:** **branch by abstraction** (for internal code without an HTTP seam), **parallel run** (both compute, compare, old one wins), **event interception** (publish events from the monolith so new services can react).`,
      code: [
        {
          language: 'nginx',
          title: 'Facade routing: strangle /pricing and canary the new /search service',
          code: `upstream monolith      { server monolith.internal:8080; keepalive 64; }
upstream pricing_svc   { server pricing.prod.svc.cluster.local:80; keepalive 64; }
upstream search_svc    { server search.prod.svc.cluster.local:80;  keepalive 64; }

# Canary 10% of users to the new search service, sticky per user id cookie.
split_clients "\${cookie_uid}search" \$search_backend {
  10%     search_svc;
  *       monolith;
}

server {
  listen 443 ssl;
  server_name api.example.com;

  location /api/pricing/ {           # fully strangled: 100% to the new service
    proxy_pass http://pricing_svc;
    proxy_set_header X-Request-Id \$request_id;
  }

  location /api/search/ {            # mid-migration: weighted, sticky canary
    proxy_pass http://\$search_backend;
    proxy_set_header X-Request-Id \$request_id;
    mirror /mirror-search;           # shadow a copy to compare responses offline
  }

  location = /mirror-search {
    internal;
    proxy_pass http://search_svc\$request_uri;
  }

  location / {                       # everything else still served by the monolith
    proxy_pass http://monolith;
    proxy_set_header X-Request-Id \$request_id;
  }
}`,
        },
      ],
      diagram: `  Phase 1              Phase 2                   Phase 3
 client               client                    client
   |                    |                         |
 [facade]            [facade]                  [facade]
   |              /pricing|  \\ rest             /  |  \\
   v                v       v                   v   v   v
 monolith        pricing  monolith          pricing search orders
 (all)            svc    (shrinking)         svc    svc   svc
                  ^ CDC     |                 (monolith deleted or tiny)
                  +---------+`,
      keyPoints: [
        'Modularize in place and find seams before extracting.',
        'A routing facade makes each cut-over a reversible config change.',
        'Shadow, compare, canary, then flip data ownership — and delete the old path.',
        'Start with a low-coupling, high-value slice; leave the transactional core for later.',
      ],
      source: 'Mastering API Architecture — Ch 8 (seams, strangler fig, facade and adapter)',
    },
    {
      heading: 'The distributed monolith and other anti-patterns',
      body: `**Intuition:** a distributed monolith has all the coupling of a monolith plus all the failure modes of a distributed system — the worst of both.

| Smell | Symptom | Fix |
|---|---|---|
| Lockstep deploys | "Release v42 must deploy services A, B, C together" | Backward-compatible contracts, expand/contract, contract tests |
| Shared database | Service B reads A's tables; schema change breaks B | Private schemas + API/events; CDC read models |
| Deep sync chains | Request path A→B→C→D→E; p99 = sum of tails | Async events, local read models, collapse over-split services |
| Shared domain library | Bump \`common-models\` → 30 PRs | Duplicate the fields you need; share infra libs only |
| Nano-services | 1 service per entity/function; 5 calls per feature | Merge into capability services around bounded contexts |
| Entity/CRUD services | Orchestration logic spread across callers | Capability services own behaviour + data |
| No platform | Every team hand-rolls CI, logging, auth | Paved road: service template, golden pipelines, observability defaults |
| Shared staging only | One broken service blocks every team's testing | Contract tests, ephemeral envs, test in production with flags |

**Operational must-haves before service #10:** centralized logs with correlation IDs, distributed tracing, per-service SLOs, automated CI/CD with canaries, service catalog (Backstage) listing owner/on-call/dependencies, and a standard service template. Without them, debugging becomes archaeology.

**A healthy benchmark:** most changes deploy one service; each team can deploy many times a day without coordination; an outage in a non-critical service degrades features rather than taking the product down.

**In interviews say:** "The number of services is not the metric — coupling is. If deploys are coordinated, I have a distributed monolith and I'd first fix contracts and data ownership, possibly by merging services."`,
      keyPoints: [
        'Coupling, not service count, is what matters.',
        'Lockstep deploys and shared DBs are the defining distributed-monolith smells.',
        'Merge nano-services; it is a legitimate, often correct move.',
        'Invest in the platform (tracing, templates, catalog) before scaling service count.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'microservices-cc-1',
      title: 'Untangle a checkout handler that behaves like a distributed monolith',
      context:
        'The Checkout service was extracted from the monolith last quarter. During a flash sale, a slow Loyalty service made checkout p99 jump from 400 ms to 30 s and pods ran out of sockets. The team also discovered Checkout writes directly into the Inventory database.',
      task:
        'Refactor placeOrder so that Checkout owns only its own data, the user-facing path does not depend on non-critical services, every remaining sync call is bounded, and downstream services learn about the order reliably even if Kafka or the process fails mid-request.',
      starter: {
        language: 'typescript',
        code: `import axios from 'axios';
import { Pool } from 'pg';
import { Kafka } from 'kafkajs';

const checkoutDb = new Pool({ connectionString: process.env.CHECKOUT_DB });
const inventoryDb = new Pool({ connectionString: process.env.INVENTORY_DB }); // another team's DB
const producer = new Kafka({ brokers: ['kafka:9092'] }).producer();

export async function placeOrder(userId: string, items: { sku: string; qty: number }[]) {
  // 1. Price the cart
  const quote = await axios.post('http://pricing/quote', { items });

  // 2. Reserve stock by writing straight into Inventory's table
  for (const i of items) {
    await inventoryDb.query('UPDATE stock SET available = available - $1 WHERE sku = $2', [i.qty, i.sku]);
  }

  // 3. Save the order
  const { rows } = await checkoutDb.query(
    'INSERT INTO orders (user_id, total, status) VALUES ($1, $2, $3) RETURNING id',
    [userId, quote.data.total, 'PLACED'],
  );
  const orderId = rows[0].id;

  // 4. Tell everyone, one after another
  await axios.post('http://loyalty/points', { userId, orderId });
  await axios.post('http://email/confirmation', { userId, orderId });
  await axios.post('http://analytics/track', { event: 'order', orderId });

  // 5. Publish event for fulfilment
  await producer.send({ topic: 'orders', messages: [{ value: JSON.stringify({ orderId }) }] });

  return { orderId };
}`,
      },
      hints: [
        'Which of the downstream calls does the user actually need to wait for? Which only need to learn that a fact happened?',
        'What happens if the process crashes after the INSERT but before producer.send? And if the stock UPDATE succeeds but the INSERT fails?',
        'Inventory should decide on reservations itself. How can Checkout request a reservation without touching its tables, and without a distributed transaction?',
      ],
      solution: {
        language: 'typescript',
        code: `import axios from 'axios';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const checkoutDb = new Pool({ connectionString: process.env.CHECKOUT_DB, max: 20 });
// Bounded client: timeouts are mandatory on every sync edge.
const pricing = axios.create({ baseURL: 'http://pricing.prod.svc.cluster.local', timeout: 250 });

export async function placeOrder(
  userId: string,
  items: { sku: string; qty: number }[],
  idempotencyKey: string, // from the client, so retries do not create duplicate orders
) {
  // Only sync dependency: the price is needed to create the order. Tight timeout,
  // one retry for idempotent quote calls would be acceptable here (omitted for brevity).
  const { data: quote } = await pricing.post('/quote', { items });

  const client = await checkoutDb.connect();
  try {
    await client.query('BEGIN');
    const orderId = randomUUID();
    const inserted = await client.query(
      'INSERT INTO orders (id, user_id, total_minor, currency, status, idempotency_key) ' +
        "VALUES ($1, $2, $3, $4, 'PENDING_STOCK', $5) " +
        'ON CONFLICT (idempotency_key) DO NOTHING RETURNING id',
      [orderId, userId, quote.totalMinor, quote.currency, idempotencyKey],
    );
    if (inserted.rowCount === 0) {
      // Duplicate request: return the original order instead of creating another.
      const existing = await client.query('SELECT id, status FROM orders WHERE idempotency_key = $1', [idempotencyKey]);
      await client.query('ROLLBACK');
      return { orderId: existing.rows[0].id, status: existing.rows[0].status };
    }
    // Transactional outbox: the event commits atomically with the order row.
    // A relay (or Debezium CDC) publishes it to Kafka topic 'orders.events', keyed by orderId.
    await client.query(
      'INSERT INTO outbox (id, aggregate_id, type, payload) VALUES ($1, $2, $3, $4)',
      [randomUUID(), orderId, 'OrderPlaced', JSON.stringify({ orderId, userId, items, total: quote })],
    );
    await client.query('COMMIT');
    // Inventory consumes OrderPlaced, reserves stock in ITS OWN DB and emits
    // StockReserved / StockRejected; Checkout moves the order to CONFIRMED or CANCELLED (saga).
    // Loyalty, email and analytics are independent consumers of the same event.
    return { orderId, status: 'PENDING_STOCK' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}`,
      },
      explanation: `**Fixes applied:**
- **Data ownership restored** — Checkout no longer writes Inventory's \`stock\` table. Inventory reserves stock itself in response to \`OrderPlaced\` and replies with an event; this is a choreographed saga (compensation details in ds-transactions). The old code could also drive \`available\` negative and had no rollback if the order INSERT failed.
- **Dual-write eliminated** — the event is written to an **outbox** in the same local transaction as the order, so a crash can no longer leave an order without its event (or an event without an order).
- **Non-critical work moved off the request path** — loyalty, email and analytics consume the event asynchronously. A slow Loyalty service can now only grow a consumer lag, not checkout p99, and it cannot exhaust Checkout's sockets.
- **Every remaining sync call is bounded** — Pricing has a 250 ms timeout (axios defaults to no timeout at all, which is how the 30 s p99 happened).
- **Idempotency** — a client-supplied key with a unique constraint makes retries safe.
- **Explicit state machine** — \`PENDING_STOCK\` tells the UI the truth; the order becomes CONFIRMED or CANCELLED when Inventory answers, usually within a second.
- **Money as integer minor units + currency** instead of a float total.`,
      followUps: [
        {
          "q": "Inventory rejects stock five seconds after the user saw 'order placed'. Walk through the compensation and what the user experiences.",
          "a": "Inventory emits `StockRejected{orderId}`. Checkout's saga handler moves the order from `PENDING_STOCK` to `CANCELLED` in one transaction, and, if payment had been authorised, writes a `ReleasePaymentAuth` command to the outbox in that same transaction. The UI has been polling or listening on a WebSocket and shows 'Sorry, item went out of stock' with no charge. Notifications consumes `OrderCancelled` to send an email. Handlers must be idempotent and must ignore a `StockReserved` that arrives late for a cancelled order. Monitor how many orders stay `PENDING_STOCK` longer than 30 s so stuck sagas get alerts."
        },
        {
          "q": "How do you test this end to end, including the case where the process dies right after COMMIT but before the relay publishes?",
          "a": "Use Testcontainers for Postgres and Kafka with the real outbox relay. Test cases: (1) happy path: the order row and outbox row exist, and the event lands on `orders.events` keyed by orderId; (2) crash after COMMIT: kill the relay, restart it, and assert the event is published exactly once downstream, with consumer dedup on event id; (3) same idempotencyKey sent twice concurrently gives one order and both responses carry the same orderId; (4) Pricing delayed 400 ms with Toxiproxy fails within ~250 ms and creates no order. Add a contract test for the `OrderPlaced` schema with the Inventory team."
        }
      ],
    },
    {
      id: 'microservices-cc-2',
      title: 'Make an event-sourced aggregate safe under concurrency and replay',
      context:
        'The Bookings service event-sources its Booking aggregate in Postgres. Support reports double-booked seats when two agents edit the same booking simultaneously, and loading old bookings has become slow (some streams have 20,000 events).',
      task:
        'Fix the repository so concurrent commands cannot both succeed against the same version, loading cost is bounded, and the stored events remain a faithful, replayable history.',
      starter: {
        language: 'typescript',
        code: `import { Pool } from 'pg';

const pool = new Pool();

type Ev = { type: string; data: any };

export async function load(bookingId: string) {
  const { rows } = await pool.query('SELECT type, data FROM events WHERE stream_id = $1', [bookingId]);
  let state: any = { seats: [] };
  for (const r of rows) state = apply(state, r);
  return state;
}

export async function changeSeat(bookingId: string, seat: string) {
  const state = await load(bookingId);
  if (state.seats.includes(seat)) throw new Error('already has seat');
  const ev: Ev = { type: 'SeatChanged', data: { seat, at: new Date().toISOString() } };
  // store the new version number = count of events + 1
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM events WHERE stream_id = $1', [bookingId]);
  await pool.query('INSERT INTO events (stream_id, version, type, data) VALUES ($1, $2, $3, $4)', [
    bookingId,
    rows[0].n + 1,
    ev.type,
    ev.data,
  ]);
  // keep the latest state handy for queries
  await pool.query('UPDATE events SET data = $2 WHERE stream_id = $1 AND version = 1', [bookingId, state]);
}

function apply(s: any, e: Ev) {
  if (e.type === 'SeatChanged') return { ...s, seats: [e.data.seat] };
  return s;
}`,
      },
      hints: [
        'Events come back from Postgres in no guaranteed order without ORDER BY. What does that do to the fold?',
        'Two requests both compute version = n + 1. What schema constraint would force one of them to fail, and what should the caller do then?',
        'Is it ever acceptable to UPDATE an event row? Where should "latest state" live instead?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Pool } from 'pg';

const pool = new Pool({ max: 20 });
const SNAPSHOT_EVERY = 100;

type Ev = { type: 'SeatChanged'; data: { seat: string; at: string } };
type State = { seats: string[]; version: number };

export class ConcurrencyError extends Error {}

export async function load(bookingId: string): Promise<State> {
  const snap = await pool.query('SELECT version, state FROM snapshots WHERE stream_id = $1', [bookingId]);
  let state: State = snap.rowCount ? { ...snap.rows[0].state, version: snap.rows[0].version } : { seats: [], version: 0 };
  const { rows } = await pool.query(
    'SELECT version, type, data FROM events WHERE stream_id = $1 AND version > $2 ORDER BY version',
    [bookingId, state.version], // only the tail after the snapshot, in order
  );
  for (const r of rows) state = { ...apply(state, r), version: r.version };
  return state;
}

export async function changeSeat(bookingId: string, seat: string, attempt = 0): Promise<void> {
  const state = await load(bookingId);
  if (state.seats.includes(seat)) return; // idempotent: already in desired state
  const ev: Ev = { type: 'SeatChanged', data: { seat, at: new Date().toISOString() } };
  const next = state.version + 1;
  try {
    // UNIQUE(stream_id, version) makes this an optimistic-concurrency check:
    // if another writer appended 'next' first, this insert fails with 23505.
    await pool.query('INSERT INTO events (stream_id, version, type, data) VALUES ($1, $2, $3, $4)', [
      bookingId, next, ev.type, ev.data,
    ]);
  } catch (err: any) {
    if (err.code === '23505') {
      if (attempt < 3) return changeSeat(bookingId, seat, attempt + 1); // reload, re-validate, retry
      throw new ConcurrencyError('booking ' + bookingId + ' modified concurrently');
    }
    throw err;
  }
  if (next % SNAPSHOT_EVERY === 0) {
    const snapState = apply(state, ev);
    // Snapshots are a disposable cache: events stay immutable and remain the source of truth.
    await pool.query(
      'INSERT INTO snapshots (stream_id, version, state) VALUES ($1, $2, $3) ' +
        'ON CONFLICT (stream_id) DO UPDATE SET version = EXCLUDED.version, state = EXCLUDED.state ' +
        'WHERE snapshots.version < EXCLUDED.version',
      [bookingId, next, { seats: snapState.seats }],
    );
  }
}

function apply(s: State, e: Pick<Ev, 'type' | 'data'>): State {
  if (e.type === 'SeatChanged') return { ...s, seats: [e.data.seat] };
  return s;
}`,
      },
      explanation: `**Fixes applied:**
- **Ordering** — \`ORDER BY version\`; without it Postgres may return rows in any order and the fold produces the wrong state.
- **Optimistic concurrency** — the version comes from the loaded state (not a separate \`count(*)\`, which is a check-then-act race), and \`UNIQUE(stream_id, version)\` rejects the second writer. On a unique violation (SQLSTATE 23505) the command reloads, re-validates the invariant and retries a bounded number of times, then surfaces a 409-style error.
- **Immutable history** — the starter overwrote event #1 with the current state, destroying the audit trail and breaking every future replay and projection. Latest state now lives in a **snapshots** table, which is only a cache.
- **Bounded load time** — snapshot every 100 events and read only the tail, so a 20,000-event stream loads ≤ 100 events plus one snapshot row.
- **Idempotency** — re-issuing the same command is a no-op.
- **Typed events** instead of \`any\`, which makes upcasting and schema evolution tractable.
- Remaining work for production: persist \`at\` from the command (not the server clock at retry time) and publish via the outbox/CDC for projectors.`,
      followUps: [
        {
          "q": "Ten agents edit the same hot booking simultaneously and most commands now fail with ConcurrencyError after 3 retries. What do you change?",
          "a": "Retries just re-collide under high contention, which is livelock. Options: serialise commands per stream, for example by routing all commands for a bookingId to one worker through a partitioned queue so they are applied in order without conflicts; take `SELECT ... FOR UPDATE` on a stream-head row so writers queue in the database instead of failing; or add jittered backoff between retries. Also check whether the commands really conflict: two edits to different fields can both be accepted if the domain allows merging. Report hot-stream conflict rates as a metric."
        },
        {
          "q": "You need to add a `passengerName` field to SeatChanged events, but 20,000 old events lack it. How do you evolve the schema without rewriting history?",
          "a": "Use upcasting: store a schema version with each event (`SeatChanged.v1`, `.v2`) and run a chain of pure functions when loading that turns v1 into v2 by filling a default or deriving the value. The stored events never change. New writes use v2. Snapshots store their own version, so either invalidate snapshots written with the old state shape or upcast them too. Projectors subscribe to both versions during the transition. For a big change, you can do a copy-transform migration into a new stream, but it is rarely worth it compared with upcasters plus tests that replay real production streams."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'microservices-iq-01',
      difficulty: 'hard',
      question:
        'Our NestJS monolith is "hard to scale" — the CTO wants to move to microservices this year. Walk me through how you would decide whether that is the right call.',
      context:
        '60 engineers, 8 teams, one repo, deploys twice a week behind a merge queue that takes 3 hours. Peak 4K RPS; CPU mostly idle except the report-export and image-processing endpoints.',
      whatInterviewerLooksFor: [
        'Separates organizational scaling from runtime scaling',
        'Diagnoses before prescribing (profiling, DORA metrics, hot endpoints)',
        'Considers cheaper options: horizontal scaling, modular monolith, extracting 1–2 components',
        'Names concrete costs of microservices and a phased plan',
      ],
      modelAnswer: `### 1. Clarify what "hard to scale" means
There are two different problems hiding in that sentence:
- **Runtime scaling** — 4K RPS with idle CPU is not a scale problem for a monolith; a stateless NestJS app scales horizontally behind a load balancer. The real hot spots are **report export** and **image processing** — CPU-heavy and bursty.
- **Organizational scaling** — 8 teams, a 3-hour merge queue and 2 deploys/week is the real pain. That's a coupling and delivery problem.

### 2. Measure
- DORA metrics: lead time, deploy frequency, change-failure rate, MTTR.
- Per-endpoint CPU/latency profile; which modules change together (git co-change analysis).
- Build/test time breakdown — often a 3-hour queue is a slow test suite, fixable in weeks.

### 3. Cheapest effective moves first
1. **Extract the two CPU-heavy workloads** into async workers behind a queue (image resize, report export). They have different scaling profiles and clear boundaries — the textbook case for a separate deployable. Autoscale on queue depth.
2. **Modularize the monolith**: module-per-bounded-context, schema-per-module, dependency rules in CI (fitness functions), CODEOWNERS per team.
3. **Fix the pipeline**: parallel/affected-only tests (Nx affected), trunk-based dev, feature flags to decouple deploy from release — target daily deploys.

### 4. Then extract services where a driver exists
If after that teams still block each other, strangle out the bounded contexts with the most independent change rate, one at a time, behind a facade — only once the platform exists (CI templates, tracing, service catalog).

### 5. Be explicit about costs
Each hop adds ~1–5 ms and a failure mode; cross-domain joins/transactions become sagas and read models; expect 1–2 platform engineers of overhead. A year-long big-bang rewrite is the riskiest option.

**Recommendation:** "Not microservices-everywhere this year. Extract the 2 heavy workers now, modularize, fix delivery, and let measured coupling decide the next extractions."`,
      followUps: [
        {
          q: 'The CTO insists on a hard deadline for "microservices". What do you commit to?',
          a: 'Commit to outcomes rather than service counts: e.g. daily deploys per team, image/report workers independently scaled, first bounded context strangled out behind the facade within two quarters. Those are measurable and reversible.',
        },
        {
          q: 'How do you find which modules to extract first?',
          a: 'Git co-change analysis (files that change together), runtime call graph, data access map (which tables each module touches), and team ownership. Pick a high-change, low-coupling context with a clear owner; avoid the core transactional heart first.',
        },
        {
          q: 'The image workers need results back synchronously for a preview. Now what?',
          a: 'Return 202 + job id and let the client poll or subscribe (WebSocket/SSE), or keep a small synchronous thumbnail path with a strict timeout while full processing stays async.',
        },
      ],
      pitfalls: [
        'Equating "hard to scale" with needing microservices without measuring anything',
        'Proposing a big-bang rewrite into 30 services',
        'Ignoring the org/delivery problem and only discussing CPU',
        'Forgetting platform prerequisites (tracing, CI/CD, service template)',
      ],
    },
    {
      id: 'microservices-iq-02',
      difficulty: 'hard',
      question:
        'One component — say search or pricing — needs 20× the capacity of the rest of the system during sales. How do you let it scale independently, and what do you watch out for?',
      whatInterviewerLooksFor: [
        'Checks whether it is really separable (data, invariants, call patterns)',
        'Discusses deployment topology options, not just "make it a service"',
        'Handles data ownership and caching for the hot component',
        'Autoscaling signals and protecting downstreams',
      ],
      modelAnswer: `### Is it a real boundary?
First confirm the component is a bounded context: it has its own data (or can own a read model), few synchronous dependencies, and a stable interface. Pricing and search usually qualify — they are read-heavy, largely stateless on the request path, and their data can be replicated.

### Options, cheapest first
| Option | How | When |
|---|---|---|
| Same codebase, separate deployment | Deploy the monolith image twice; route /search to a dedicated pool with its own HPA | Fastest; isolates capacity and failure without a new service |
| Extract a service | Own repo/pipeline, own datastore | When the team and change cadence also differ |
| Async worker | Queue + workers autoscaled on depth | Batchable, latency-tolerant work |

The "same code, separate deployment pool" trick is underrated: you get independent scaling and blast-radius isolation in days.

### Data
- The hot component must not hammer the shared primary DB — give it a **read model**: Elasticsearch for search, a Redis/in-memory price table fed by CDC or events for pricing.
- 20× read load on a read model is cheap; 20× on the OLTP primary is an outage.

### Scaling mechanics
- HPA on a leading signal (RPS per pod, in-flight requests, queue depth), not only CPU; pre-scale before known sales (scheduled scaling) because pod start + JVM/Node warmup + cache warm take 30–120 s.
- Pod disruption budgets, spread across zones.

### Watch-outs
- **Downstream amplification**: 20× pricing traffic can mean 20× calls to promotions/tax — cache or batch them.
- Connection pools: 200 pods × 20 connections = 4,000 DB connections — use PgBouncer or avoid DB on the hot path.
- Cost: autoscale down aggressively after the peak.`,
      followUps: [
        {
          q: 'The price must reflect a promotion change within 5 seconds. Does the read model still work?',
          a: 'Yes — CDC/event propagation is typically sub-second to a couple of seconds. Monitor replication lag as an SLI and alert when it exceeds, e.g., 3 s; checkout re-validates the final price on the write path anyway.',
        },
        {
          q: 'Why not just scale the whole monolith 20×?',
          a: 'You would pay for 20× of everything, multiply DB connections and memory, and one hot endpoint would still share failure domain with checkout. Targeted scaling is cheaper and isolates blast radius.',
        },
      ],
      pitfalls: [
        'Extracting the service but leaving it reading the monolith database',
        'CPU-only autoscaling with no pre-scaling for known events',
        'Ignoring connection-count explosion as pod count grows',
      ],
    },
    {
      id: 'microservices-iq-03',
      difficulty: 'expert',
      question:
        'We have 50 services talking to each other and nobody can draw the dependency graph anymore. Incidents take hours to diagnose. How do you bring this under control?',
      whatInterviewerLooksFor: [
        'Observability and service catalog first (you cannot fix what you cannot see)',
        'Reduces synchronous coupling structurally, not just with tooling',
        'Standardizes communication (mesh/paved road, contracts, timeouts)',
        'Considers merging services and ownership clarity',
      ],
      modelAnswer: `### 1. Make it visible (weeks 1–4)
- **Distributed tracing everywhere** (OpenTelemetry, W3C traceparent) — the dependency graph is then generated from real traffic, not whiteboards.
- **Service catalog** (Backstage): owner, on-call, tier, SLOs, dependencies, runbooks for every service. Unowned services get an owner or get decommissioned.
- Per-service RED dashboards and SLOs; tier services (tier 0 = checkout/login).

### 2. Standardize the edges
- A paved road: service template with timeouts, retries with jitter, circuit breakers, correlation IDs and health checks baked in. Or a **service mesh** to enforce mTLS, retries and timeouts uniformly (see net-service-mesh).
- Contract tests between consumer/provider pairs; schema registry for events.

### 3. Reduce synchronous coupling
Use the trace data to find:
- **Deep chains** (> 3 sync hops on a user path) — replace with local read models fed by events.
- **Fan-out hubs** — a service called by 30 others is either a real platform capability (make it highly available, cache it) or an entity service that should be dissolved into its callers' contexts.
- **Chatty pairs** — two services exchanging many calls per request are one bounded context split in half. **Merge them.**
- **Cycles** — A→B→A means the boundary is wrong.

### 4. Govern
- Fitness functions: max sync depth, no new cycles, every service has an SLO and owner.
- Architecture review for new services (lightweight ADRs): "why can't this be a module in an existing service?"

### Numbers that justify it
With 30 services on a path at 99.9% each, the path's availability is ≈ 0.999^30 ≈ 97% — ~22 hours of degraded behaviour a month. Cutting the synchronous path to 5 services lifts it to ≈ 99.5%.

**Outcome:** fewer sync edges, clear ownership, and MTTR measured in minutes because the trace shows the failing hop.`,
      followUps: [
        {
          q: 'Would a service mesh alone fix this?',
          a: 'No. A mesh standardizes transport concerns (mTLS, retries, telemetry) and helps visibility, but it cannot fix bad boundaries, cycles or deep chains — those need architectural changes.',
        },
        {
          q: 'How do you decide to merge two services?',
          a: 'They change together (co-deployed in most releases), exchange many sync calls per request, share invariants, and are owned by the same team. Merging is legitimate and reduces latency and failure modes.',
        },
        {
          q: 'What would you alert on across the fleet?',
          a: 'SLO burn rate per tier-0/tier-1 service at the edge (user-facing symptoms), not per-pod CPU. Dependency-level alerts go to the owning team via the catalog.',
        },
      ],
      pitfalls: [
        'Answering only with tools ("add Istio and Jaeger") and no structural changes',
        'Never considering merging services',
        'Alerting on every service metric, causing alert fatigue',
      ],
    },
    {
      id: 'microservices-iq-04',
      difficulty: 'expert',
      question:
        'Every time the Orders team changes the shared "common-models" npm package, 25 services need a coordinated upgrade and something breaks. How do you get out of this dependency hell?',
      whatInterviewerLooksFor: [
        'Identifies shared domain models as coupling, not reuse',
        'Distinguishes infrastructure libs from domain contracts',
        'Contract-first alternatives (schemas, codegen per consumer, tolerant readers)',
        'A migration path, not just the end state',
      ],
      modelAnswer: `### Diagnosis
A shared **domain-model** library is a distributed monolith in disguise: every service compiles against Orders' internal representation, so an Orders refactor becomes a fleet-wide release. Semver doesn't save you — 25 services pinned to different majors means drift and runtime incompatibilities on the wire.

### Principles
- **Share contracts, not code.** The contract is the API/event schema (OpenAPI, protobuf, Avro/JSON Schema), owned by the provider and versioned independently.
- Consumers **generate their own client types** from the published schema (or hand-write the 5 fields they use) and are **tolerant readers** (ignore unknown fields, don't fail on new enum values).
- Only **infrastructure libraries** are shared (logging, tracing, auth middleware, HTTP client with timeouts) — slow-moving, semver'd, backward compatible, owned by the platform team.

### Migration path
1. **Freeze** common-models: no new domain types added.
2. Publish Orders' schemas to a registry (Schema Registry with BACKWARD compatibility for events; OpenAPI/protobuf in a contracts repo with breaking-change linting like buf breaking or openapi-diff in CI).
3. Consumers switch module by module to generated types; add **Pact** consumer tests so Orders' CI knows what each consumer relies on.
4. Breaking changes follow **expand → migrate → contract**, gated by telemetry showing zero traffic on the old shape.
5. Delete the package.

### Also check
- Transitive dependency pinning (a monorepo with one version policy, e.g. Nx, is fine for infra libs — the problem is domain coupling, not repo layout).
- Renovate/Dependabot for infra libs so upgrades are continuous and small.

**Result:** Orders can refactor internally any day; only changes to the published contract need coordination, and CI tells you exactly who is affected.`,
      followUps: [
        {
          q: "Isn't duplicating types across services a DRY violation?",
          a: 'DRY applies within a bounded context. Across contexts, each consumer needs a different subset and meaning; duplication of a few fields is cheaper than coupling every release. The contract (schema) is the single source of truth.',
        },
        {
          q: 'We are in an Nx monorepo — does that change the answer?',
          a: 'A monorepo makes atomic changes possible, which can hide coupling. Keep project-boundary lint rules (Nx enforce-module-boundaries tags) so services cannot import each other domain libs, and still deploy independently.',
        },
      ],
      pitfalls: [
        'Suggesting stricter semver on the shared domain package as the fix',
        'Moving to a shared database schema instead',
        'Big-bang removal without a consumer migration path',
      ],
    },
    {
      id: 'microservices-iq-05',
      difficulty: 'hard',
      question:
        'Last Friday a deployment of the User service broke Checkout, Notifications and Search. What does that tell you, and what would you change?',
      whatInterviewerLooksFor: [
        'Recognizes a breaking contract change and missing safety nets',
        'Release engineering: canary, contract tests, feature flags, rollback',
        'Runtime resilience so failures degrade rather than cascade',
        'Blameless post-incident thinking',
      ],
      modelAnswer: `### What it tells me
One deploy breaking three consumers means either (a) a **breaking contract change** (removed/renamed field, changed semantics, stricter validation), or (b) a **runtime dependency** where consumers can't tolerate User being slow/down. Either way we have coupling without guardrails — a distributed-monolith symptom.

### Immediate
- Roll back (it should be one click; if it isn't, that's action item #1).
- Post-incident review: which change, why tests didn't catch it, why it wasn't caught at 1% traffic.

### Prevent at build time
- **Consumer-driven contract tests** (Pact): Checkout, Notifications and Search publish their expectations; User's pipeline runs can-i-deploy and blocks the release.
- **Schema diff linting** (openapi-diff / buf breaking) fails CI on removals or type changes.
- Backward-compatible-only policy; breaking changes via expand → migrate → contract.

### Prevent at release time
- **Canary** with automated analysis (Argo Rollouts/Flagger): 1–5% of traffic, compare error rate and latency of *consumers* too, auto-rollback.
- Decouple deploy from release with **feature flags** for behaviour changes.

### Contain at runtime
- Consumers call User with timeouts, circuit breakers and fallbacks (cached profile, default display name).
- Notifications and Search should not call User synchronously at all — keep a local projection from UserUpdated events, so a User outage becomes stale data, not an outage.

### Measure
Change-failure rate and MTTR per service; goal: a bad User deploy is caught at 5% for < 5 minutes and never reaches Search.`,
      followUps: [
        {
          q: 'The change was semantic: a field kept its type but "status" values changed meaning. Would contract tests catch that?',
          a: 'Only if consumers asserted on the values they depend on. Semantic changes need a new field or version, explicit deprecation, and canary metrics on consumer business KPIs (e.g. checkout conversion).',
        },
        {
          q: 'How do you run canary analysis for a backend service whose consumers are other services?',
          a: 'Route a slice of internal traffic via mesh/gateway weights and compare the canary cohort on server-side RED metrics plus downstream error rates tagged by the upstream version header.',
        },
      ],
      pitfalls: [
        'Proposing a shared staging environment where everything is tested together as the main fix',
        'Blaming the engineer instead of the missing guardrails',
        'Ignoring that the consumers had no resilience to the dependency',
      ],
    },
    {
      id: 'microservices-iq-06',
      difficulty: 'expert',
      question:
        'Design the migration of a 10-year-old e-commerce monolith (single Postgres, 400 tables) to microservices without stopping feature work. How do you handle the data?',
      whatInterviewerLooksFor: [
        'Strangler fig with a routing facade and incremental slices',
        'Concrete data migration: schema-per-module, CDC, dual-running, ownership flip',
        'Risk control: shadowing, canary, rollback, reconciliation',
        'Realistic sequencing and knowing when to stop',
      ],
      modelAnswer: `### Principles
No big-bang rewrite. Strangler fig: every step is shippable and reversible; feature work continues in whichever side currently owns the capability.

### Phase 0 — foundations (1–2 months)
Facade (gateway) in front of the monolith; tracing and correlation IDs; CI/CD service template; Debezium CDC on the monolith DB; event bus (Kafka).

### Phase 1 — modularize in place
Map 400 tables to bounded contexts (catalog, pricing, cart, orders, payments, fulfilment, customers). Move each context's tables into its own **schema**; replace cross-context joins with in-process module APIs. This is where most of the hard work is, and it pays off even if you never extract anything.

### Phase 2 — first slice (e.g. catalog/search, read-heavy)
1. New service with its own DB, populated by **CDC from the monolith tables** (monolith is still the writer).
2. **Shadow reads** through the facade; diff responses; fix until mismatch < 0.1%.
3. Canary reads 1% → 100%.
4. **Flip write ownership**: writes go to the new service; the monolith gets its data back via events/CDC from the service (reverse sync) until its remaining readers are migrated.
5. Delete the monolith code and tables.

### Phase 3 — write-heavy, transactional contexts
Orders/payments last: they need sagas + outbox, idempotency keys, and reconciliation jobs comparing both sides daily.

### Risk controls
Per-slice rollback = flip the facade route; data rollback requires the reverse-sync to be running. Feature flags per slice. SLOs guarded by automated canary analysis.

### Numbers
Budget 2–4 months for the first slice, 4–8 weeks for later ones; 6–10 contexts → 18–30 months. It is fine to stop with a healthy, smaller modular monolith at the core.`,
      followUps: [
        {
          q: 'During dual-running, both sides accept writes for a while. How do you avoid conflicts?',
          a: 'Avoid dual writers entirely: exactly one side owns writes for a given entity at any time, switched per slice (or per tenant/cohort). The other side is fed by CDC. If you must, route by entity id so a given record has a single writer.',
        },
        {
          q: 'A report joins orders, customers and products across three future services. What happens to it?',
          a: 'Move reporting to an analytics store fed by CDC/events from all services (warehouse/lake). OLTP services should not serve cross-domain analytical joins.',
        },
        {
          q: 'How do you prove the new service is correct before cutover?',
          a: 'Shadow traffic with response diffing, parallel run on writes (compute both, old wins), and reconciliation queries comparing record counts and checksums per day.',
        },
      ],
      pitfalls: [
        'Extracting services while they still read the monolith tables directly',
        'Starting with the most coupled, transactional core',
        'Dual writes from application code to both databases',
        'Never deleting the old code path',
      ],
    },
    {
      id: 'microservices-iq-07',
      difficulty: 'expert',
      question:
        'Your Order History page needs data owned by Orders, Payments and Shipping. Product wants it to load in under 150 ms and be "always up to date". Would you use API composition, CQRS, or event sourcing — and why?',
      whatInterviewerLooksFor: [
        'Correctly distinguishes CQRS from event sourcing',
        'Quantifies latency/availability of composition vs read model',
        'Negotiates "always up to date" into a staleness SLO',
        'Handles ordering, idempotency and rebuilds of projections',
      ],
      modelAnswer: `### Options
| | API composition | CQRS read model | Event sourcing |
|---|---|---|---|
| Latency | max(3 calls) + merge; p99 driven by slowest | 1 indexed query, ~5–20 ms | Not a read strategy by itself |
| Freshness | Live | ~100 ms–2 s lag | — |
| Availability | Product of 3 services | Depends on 1 store | — |
| Complexity | Low | Medium (projector, replay) | High |

**Event sourcing is orthogonal**: it's how a *write* side stores state (as events). You can do CQRS without event sourcing — Orders, Payments and Shipping just publish events via outbox/CDC.

### Recommendation
A **CQRS read model** in an Order-History service:
- Projector consumes orders.events, payments.events, shipments.events (keyed by orderId), and upserts one denormalized row per order, guarded by per-source version numbers.
- Page = one query on (customer_id, created_at DESC) with keyset pagination — comfortably under 150 ms p99.

### "Always up to date"
Translate it into an SLO: "95% of changes visible within 2 s". For the user's own just-placed order, provide read-your-writes: the checkout response includes the order, and the UI merges it; or read that single order from Orders directly for 30 s after creation.

### Operational details
- Monitor consumer lag as the freshness SLI.
- Out-of-order events across topics: store fields per source with their own version/timestamp rather than a single version.
- Rebuild: replay topics from the beginning into a new table, then swap via a view/alias.

When would composition win? Low traffic, few services, and strict freshness — e.g. an internal admin page.`,
      followUps: [
        {
          q: 'Kafka retention is 7 days — how do you rebuild the read model from scratch?',
          a: 'Either use compacted topics keyed by aggregate id (latest state per key retained indefinitely), or bootstrap from source-service snapshots/exports and then apply the stream from a recorded offset.',
        },
        {
          q: 'Payments are PCI data. Can you copy them into the read model?',
          a: 'Copy only non-sensitive fields (status, amount, last4 if allowed); never PANs. The read model inherits compliance scope for whatever it stores.',
        },
      ],
      pitfalls: [
        'Treating CQRS and event sourcing as the same thing',
        'Promising strong consistency across three services for a read page',
        'Ignoring out-of-order events from different topics',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'microservices-boe-1',
      question:
        'A product page calls 25 internal services synchronously (in parallel) and one after another in a 4-hop chain for pricing. Each service has 99.9% availability and its own p99 of 50 ms. Estimate the page availability and how often a request is slowed by at least one p99.',
      assumptions: [
        'Failures are independent (optimistic; correlated failures make it worse)',
        'All 25 parallel calls are required (no fallbacks)',
        'The 4-hop pricing chain is part of the 25',
        'Per-call p99 = 50 ms, median = 10 ms',
      ],
      steps: [
        { label: 'Availability of 25 required dependencies', calc: '0.999^25 = e^(25 × −0.001) ≈ e^−0.025 ≈ 0.975 → 97.5%' },
        { label: 'Downtime per month', calc: '2.5% × 730 h ≈ 18 h/month of failed or degraded page loads' },
        { label: 'Probability ≥1 of 25 calls hits its p99', calc: '1 − 0.99^25 ≈ 1 − 0.778 ≈ 22% of page loads' },
        { label: 'Serial 4-hop chain worst-case tail', calc: 'up to 4 × 50 ms = 200 ms if tails align; median chain ≈ 4 × 10 = 40 ms + 4 × ~1 ms network' },
        { label: 'With fallbacks for 20 non-critical calls', calc: 'only 5 required: 0.999^5 ≈ 99.5% → ~3.6 h/month' },
      ],
      answer:
        '≈97.5% availability (~18 h/month degraded) and ~22% of requests experience at least one p99-level call; making 20 of the 25 calls optional raises availability to ≈99.5%.',
      insight:
        'Required synchronous fan-out destroys availability and tail latency multiplicatively. Mark dependencies critical vs optional, give optional ones tight timeouts with fallbacks, and replace the serial chain with a local read model (e.g. prices replicated via events) so the page path touches as few services as possible.',
      followUps: [
        {
          "q": "Correlated failures: 10 of the 25 services share one Redis cluster at 99.9%. How does that change the estimate?",
          "a": "Shared infrastructure turns independent failures into common-mode ones. Redis alone takes down 10 required calls together, so it acts as one more 99.9% dependency in series. Its outage minutes also overlap with the services' own downtime, so the independence assumption understates risk during that window. Roughly, 0.999^26 ≈ 97.4%. The bigger issue is blast radius: one Redis incident fails 40% of the page at once and every retry hits the same broken cluster. Mitigate with per-service fallbacks that tolerate cache misses, and by splitting Redis by criticality."
        }
      ],
    },
    {
      id: 'microservices-boe-2',
      question:
        'The edge receives 5K RPS at peak. On average each edge request triggers 12 internal RPC calls. Estimate internal RPS, the pods needed, and the overhead of adding a sidecar service mesh.',
      assumptions: [
        '5,000 edge RPS at peak',
        '12 internal calls per edge request, average payload 2 KB request + 4 KB response',
        'A typical NestJS service pod handles ~500 RPS at 60% CPU target',
        'Sidecar proxy (Envoy) adds ~0.5–1 ms per hop (client + server side combined) and ~0.1–0.2 vCPU per 1K RPS',
      ],
      steps: [
        { label: 'Internal RPS', calc: '5,000 × 12 = 60,000 internal RPS (12× amplification)' },
        { label: 'Total RPS served by pods', calc: '5,000 edge + 60,000 internal = 65,000 RPS' },
        { label: 'Pods needed', calc: '65,000 ÷ 500 ≈ 130 pods (+ N+1/zone headroom ≈ 160)' },
        { label: 'East-west bandwidth', calc: '60,000 × 6 KB ≈ 360 MB/s ≈ 2.9 Gbit/s' },
        { label: 'Mesh CPU overhead', calc: '65K RPS through sidecars × ~0.15 vCPU/1K RPS ≈ 10 vCPU (both ends may double it → ~20 vCPU)' },
        { label: 'Mesh latency on a 3-hop critical path', calc: '3 × ~1 ms ≈ +3 ms p50; more at p99' },
      ],
      answer:
        '~60K internal RPS, ~130–160 service pods, ~3 Gbit/s east-west traffic, and a mesh cost of roughly 10–20 vCPU plus a few ms on the critical path.',
      insight:
        'Internal amplification (12×) dominates cost and latency, not edge traffic. Reducing chattiness (batch endpoints, BFF aggregation, local read models) saves more than tuning any single service; the mesh overhead is affordable but grows linearly with call count, so the fan-out factor is the number to drive down.',
      followUps: [
        {
          "q": "Peak becomes 10× (50K edge RPS) for a flash sale. What breaks first, and what do you change before the event?",
          "a": "Internal calls go to 600K RPS and pods to about 1,300. The first things to break are usually shared bottlenecks, not pods: DB connection pools (1,300 pods × 20 connections = 26K connections against Postgres's practical few thousand), east-west bandwidth (~29 Gbit/s) and mesh control-plane churn. Before the event, cut the fan-out (cache the 12 calls into fewer batch calls, serve catalog and price from a pre-warmed local read model), put PgBouncer in front of databases, pre-scale rather than relying on HPA reaction time, and add admission control or a queue at the edge so overload sheds load gracefully instead of causing a cascade."
        }
      ],
    },
    {
      id: 'microservices-boe-3',
      question:
        'You event-source orders: 2M orders/day, ~8 events per order lifecycle, ~1 KB per event including metadata. Size the event store for 3 years and decide on a snapshot policy.',
      assumptions: [
        '2M orders/day, 8 events/order, 1 KB/event',
        'Retain all events 3 years for audit',
        'Postgres with indexes ≈ +50% over raw data',
        'Most orders are read while active (first 30 days); a few long-lived aggregates (subscriptions) reach 5,000+ events',
      ],
      steps: [
        { label: 'Events per day', calc: '2M × 8 = 16M events/day ≈ 185 events/s avg, peak ×5 ≈ 1K/s' },
        { label: 'Raw bytes per day', calc: '16M × 1 KB = 16 GB/day' },
        { label: '3-year raw', calc: '16 GB × 365 × 3 ≈ 17.5 TB' },
        { label: 'With indexes', calc: '17.5 TB × 1.5 ≈ 26 TB' },
        { label: 'Load cost per order aggregate', calc: '8 events ≈ 8 KB → one indexed range scan, < 5 ms; no snapshot needed' },
        { label: 'Long-lived aggregate', calc: '5,000 events × 1 KB = 5 MB per load → snapshot every 100 events caps load at ≤ 100 KB' },
      ],
      answer:
        '~16 GB/day, ~26 TB over 3 years with indexes; snapshots are unnecessary for short order streams but required (every ~100 events) for long-lived aggregates.',
      insight:
        'Write throughput (~1K events/s peak) is trivial for Postgres; the challenge is volume. Partition the events table by month and move cold partitions to cheaper storage (or archive to object storage as Parquet for audit), keep projections in separate stores, and apply snapshots only where streams are long.',
      followUps: [
        {
          "q": "Compliance now requires 7-year retention, and the storage bill must not grow by more than 20%. Which assumption do you attack?",
          "a": "Attack the assumption that every event lives in hot Postgres. Seven years is about 61 TB with indexes if kept online. Instead, keep 90 days hot (~1.4 TB raw), then archive monthly partitions to object storage as compressed Parquet. Event JSON compresses 5–10×, so 7 years of 16 GB/day ≈ 41 TB raw shrinks to roughly 5–8 TB, at about 2–4% of SSD-backed database cost per GB. Detach and drop old partitions after verifying archive checksums. Long-lived aggregates keep their snapshots online, so loading them never needs archived events, and audit queries go through Athena or Trino on the archive."
        }
      ],
    },
  ],
  test: [
    {
      id: 'microservices-mcq-01',
      difficulty: 'medium',
      question:
        'A new startup has 7 engineers, an unvalidated product, and expects ~200 RPS in year one. The tech lead proposes 12 microservices "so we never have to migrate later". What is the strongest recommendation?',
      options: [
        'A modular monolith with enforced module boundaries and schema-per-module, extracting services later where a concrete driver appears',
        'Microservices from day one, but with a shared database to keep joins and transactions simple',
        'A traditional layered monolith without module boundaries, since boundaries only matter once the team grows',
        'Serverless functions for every endpoint so that each one scales independently from the first request',
      ],
      correct: [0],
      explanation:
        'With 7 engineers and changing requirements, boundaries are still being discovered; a modular monolith keeps refactoring cheap while making later extraction easy. Microservices on a shared DB give all the operational cost with none of the independence. An unstructured monolith makes later extraction painful, and function-per-endpoint adds cold starts and distributed complexity for a load a single instance can serve.',
      followUps: [
        {
          "q": "Eighteen months later the team is 40 engineers and the reporting module's heavy queries slow down checkout. How do you decide whether this is the moment to extract it?",
          "a": "Look for a concrete driver, not team size alone: different scaling profile (reporting is CPU/IO-heavy batch, checkout is latency-sensitive), different release cadence, or a fault-isolation need. Here the driver is resource contention, so the cheapest first step is a read replica or a separate reporting store fed by CDC — no service needed. If the reporting team also wants independent deploys and its module boundary has been stable (few cross-module calls, own schema), extract it. The schema-per-module rule means the extraction is mostly moving tables and swapping in-process calls for an API or events."
        },
        {
          "q": "How would you enforce module boundaries in the modular monolith so they don't erode before you ever extract anything?",
          "a": "Make violations fail the build. In a NestJS/Nx repo, tag modules and use lint rules (`@nx/enforce-module-boundaries` or dependency-cruiser) so a module may only import another module's public API, never its internals. Give each module its own Postgres schema and DB role so cross-schema queries fail at runtime. Communicate between modules through interfaces or in-process events, mirroring the future network contract. Track a metric such as cross-module imports per release; if it climbs, a boundary is wrong and should be redrawn while that is still cheap."
        }
      ],
    },
    {
      id: 'microservices-mcq-02',
      difficulty: 'hard',
      question:
        'The edge gateway calls Checkout with a 1 s timeout. Checkout calls Inventory as shown. Under an Inventory slowdown (every call takes 1.5 s), what happens?',
      code: {
        language: 'typescript',
        code: `// Inside Checkout, handling a request from the gateway (gateway timeout = 1000 ms)
const inventory = axios.create({ baseURL: 'http://inventory', timeout: 2000 });

async function reserveWithRetry(body: unknown) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (await inventory.post('/reserve', body)).data;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
}`,
      },
      options: [
        'The first Inventory call succeeds after 1.5 s, but the gateway has already returned a 504 at 1 s; Checkout keeps working on a request nobody is waiting for, and client retries multiply load',
        'Axios detects the gateway disconnect and cancels the in-flight Inventory call, so no work is wasted',
        'Each attempt times out at 2 s, so three attempts take 6 s and the gateway returns a 504 after 6 s',
        'The retry loop fires three concurrent requests immediately, tripling Inventory load within the first second',
      ],
      correct: [0],
      explanation:
        'The inner timeout (2 s) is larger than the caller budget (1 s), so the gateway gives up first while Checkout keeps consuming a connection and Inventory capacity — wasted work that compounds when clients retry. Axios does not cancel on upstream disconnect unless you wire an AbortSignal. The gateway times out at 1 s, not 6 s, and the loop is sequential, not concurrent. The fix is deadline propagation: pass the remaining budget downstream and set timeouts smaller than it.',
      followUps: [
        {
          "q": "You implement deadline propagation. Concretely, what does Checkout do with a request whose header says 120 ms of budget remain, given Inventory's p50 is 80 ms?",
          "a": "Checkout reads the deadline (e.g. `x-deadline` absolute timestamp or gRPC `grpc-timeout`), subtracts its own local work estimate and a safety margin (say 20 ms), and calls Inventory with an AbortSignal timeout of about 100 ms. Retrying is pointless because no budget would remain for a second attempt. If the remaining budget is below a floor (for example under 30 ms), fail fast with a 504 or a degraded response instead of starting work that cannot finish. Use absolute deadlines rather than durations so queueing time at each hop is counted automatically."
        },
        {
          "q": "Retries at the client, gateway and Checkout each do 3 attempts. Inventory is hard down. How many Inventory calls does one user click cause, and how do you fix it?",
          "a": "Retries multiply per layer: 3 × 3 × 3 = 27 Inventory attempts per click, so a 1K RPS outage becomes 27K RPS of hammering exactly when Inventory is trying to recover. Fix it by retrying at one layer only (usually the one closest to the failing dependency), with exponential backoff and jitter, a retry budget (for example retries at most 10% of requests) and a circuit breaker that stops calls entirely once the error rate crosses a threshold. Upper layers should treat a downstream 503 with `Retry-After` as final."
        }
      ],
    },
    {
      id: 'microservices-mcq-03',
      difficulty: 'expert',
      question:
        'Which observations indicate you have built a distributed monolith rather than independently deployable services? Select ALL that apply.',
      options: [
        'Releases routinely require deploying Orders, Payments and Users in a specific order in the same window',
        'Several services read and write the same "customers" table directly',
        'Services publish domain events to Kafka that other teams consume at their own pace',
        'A shared "domain-models" package must be bumped in every service when Orders adds a field',
        'Each service has its own CI pipeline and on-call rotation',
      ],
      correct: [0, 1, 3],
      explanation:
        'Lockstep deploys, a shared writable table and a shared domain-model library all mean a change in one service forces change in others — the defining property of a distributed monolith. Async events consumed independently are a sign of loose coupling. Separate pipelines and on-call are healthy but do not by themselves prove independence; they are not a smell.',
      followUps: [
        {
          "q": "You can't stop feature work. Which of the three smells would you fix first, and how do you remove the shared `customers` table without a big-bang migration?",
          "a": "Fix the shared writable table first: it is the most dangerous coupling because any schema change or bad write breaks other teams silently. Pick one owner (the Customer service), expose a read API or publish `CustomerChanged` events, and give each other service a local read copy built from those events. Move writers one at a time to call the owner's API, then revoke the other services' write grants on the table so violations fail loudly. Once only the owner reads or writes the table, it can evolve freely. The lockstep deploys usually disappear as a side effect."
        }
      ],
    },
    {
      id: 'microservices-mcq-04',
      difficulty: 'hard',
      question:
        'A projector builds an order read model with the query below. Events for order 42 arrive as v3 (SHIPPED), then a redelivered v2 (PAID). What does the read model show?',
      code: {
        language: 'sql',
        code: `INSERT INTO order_view (order_id, status, version)
VALUES ($1, $2, $3)
ON CONFLICT (order_id) DO UPDATE
SET status = EXCLUDED.status,
    version = EXCLUDED.version;`,
      },
      options: [
        'SHIPPED, because ON CONFLICT keeps the row with the higher version automatically',
        'An error, because the unique constraint rejects the second insert for the same order_id',
        'PAID with version 2 — the late event overwrites newer state because the update has no version guard',
        'Both rows, one per version, because the conflict target is the pair (order_id, version)',
      ],
      correct: [2],
      explanation:
        'ON CONFLICT DO UPDATE unconditionally applies the incoming values, so a stale or redelivered event regresses the row to PAID. Postgres does not compare versions for you, and DO UPDATE turns the conflict into an update rather than an error. The conflict target is order_id alone. Adding WHERE order_view.version < EXCLUDED.version makes the projector idempotent and order-safe.',
      followUps: [
        {
          "q": "With the version guard added, how do you rebuild the whole read model after a projector bug without taking the page offline?",
          "a": "Build a new table (`order_view_v2`) with a fresh projector that replays the topic or event store from offset 0 while the old projector keeps serving reads. Track the rebuild's lag. When it is within seconds of the head, switch reads atomically with a view rename or a feature flag, then drop the old table. The version guard keeps the replay safe even if live events and replayed events interleave. Size it upfront: replaying 50M events at about 20K events/s takes around 40 minutes, so make sure retention or the event store actually holds the full history."
        }
      ],
    },
    {
      id: 'microservices-mcq-05',
      difficulty: 'expert',
      question:
        'A team wants to use a Kafka topic (keyed by accountId) as the event store for an event-sourced Account aggregate, appending with the producer below after validating the command against state rebuilt from the topic. What is the core problem?',
      code: {
        language: 'typescript',
        code: `const state = await rebuildFromTopic('accounts', accountId); // replay events for this key
if (state.balance < amount) throw new Error('insufficient funds');
await producer.send({
  topic: 'accounts',
  messages: [{ key: accountId, value: JSON.stringify({ type: 'Withdrawn', amount }) }],
});`,
      },
      options: [
        'Kafka cannot guarantee ordering for a single key, so events for the account may be applied out of order',
        'Kafka has no conditional append on "expected version", so two concurrent withdrawals can both validate against the same state and both be written',
        'Kafka messages are deleted after consumption, so the history needed to rebuild state disappears',
        'Idempotent producers reject a second message with the same key, so the second withdrawal is silently lost',
      ],
      correct: [1],
      explanation:
        'Event sourcing needs optimistic concurrency: append only if the stream is still at the version you validated against. Kafka offers no per-key compare-and-append, so two writers can both pass the balance check and overdraw the account. Ordering per key within a partition is guaranteed; messages are not deleted on consumption (retention/compaction governs that); idempotent producers deduplicate retries of the same send, not distinct messages with the same key. Use an event store (or Postgres with UNIQUE(stream_id, version)) and Kafka for distribution.',
      followUps: [
        {
          "q": "You keep Postgres as the event store and Kafka for distribution. Two withdrawals race; walk through exactly what happens to the loser.",
          "a": "Both load the stream at version 7 and both validate the balance. Each tries `INSERT ... (stream_id, version) VALUES ('acc-1', 8, ...)`. The UNIQUE(stream_id, version) index lets the first commit win; the second gets SQLSTATE 23505. The loser reloads (now at version 8, with the reduced balance), re-runs the business rule, and either appends version 9 or rejects with insufficient funds. Retries are bounded, for example 3 attempts, after which the API returns 409. The events reach Kafka through an outbox or CDC, so the topic only ever sees committed, ordered events."
        },
        {
          "q": "Partition count grows from 12 to 48 to handle load. What happens to per-account ordering for consumers?",
          "a": "The key-to-partition mapping is `hash(key) % partitions`, so most accounts move to a different partition. Events written before the change sit in the old partition and new ones in the new partition, so a consumer can process them out of order around the cutover. Options: over-provision partitions from the start; drain producers, wait for consumers to reach zero lag, then expand; or have consumers use the per-stream version to buffer or reject out-of-order events. Because the event store holds the true version, projections can always detect gaps."
        }
      ],
    },
    {
      id: 'microservices-mcq-06',
      difficulty: 'expert',
      question:
        'A checkout request synchronously depends on 8 services, each 99.95% available with independent failures. Leadership asks for a 99.9% monthly checkout SLO. What is the most accurate assessment?',
      options: [
        'It meets the SLO: a chain is only as unavailable as its weakest member, so checkout is 99.95%',
        'It misses: 0.9995^8 ≈ 99.6%, about 175 min/month of failures against a ~44 min budget, so critical-path dependencies must be removed or made optional',
        'It meets the SLO if every service is deployed with 3 replicas, because replication multiplies availability back up',
        'It misses slightly: 0.9995^8 ≈ 99.85%, so adding retries at the gateway is enough to close the gap',
      ],
      correct: [1],
      explanation:
        'Serial required dependencies multiply: 0.9995^8 ≈ 0.996, i.e. 0.4% unavailability ≈ 175 minutes of a 43,800-minute month, while 99.9% allows ~44 minutes. The weakest-link view ignores that any of the 8 failing fails the request. The 99.95% figures are already per-service availability including their replicas. 99.85% is an arithmetic slip, and gateway retries help transient errors but not sustained outages; the structural fix is fewer critical sync dependencies, fallbacks and local read models.',
      followUps: [
        {
          "q": "You can make only two of the eight dependencies optional this quarter. How do you pick them, and what availability do you reach?",
          "a": "Rank them by contribution to failures (each costs about 22 min/month at 99.95%) and by how easily they degrade. Good candidates are recommendations, loyalty points and fraud scoring with a fallback to async review: things checkout can skip or defer. With 6 required dependencies, 0.9995^6 ≈ 99.70%, still about 131 min/month, so two is not enough for 99.9%. That shows the real fix must be structural: replicate read-only data such as prices and catalog locally via events, which removes dependencies from the path entirely. You need 2 or fewer required dependencies at 99.95% to fit the ~44-minute budget."
        }
      ],
    },
    {
      id: 'microservices-mcq-07',
      difficulty: 'hard',
      question:
        'An architecture has CustomerService, ProductService and OrderService, each a CRUD API over one entity. Every business workflow (checkout, returns, loyalty) is implemented in the web BFF by calling all three. Which description best fits the problem?',
      options: [
        'The services are too large; each entity should be split further into read and write services',
        'The BFF should be replaced with an ESB that orchestrates the entity services centrally',
        'Entity services put behaviour in the callers, so workflows fan out across services and every feature change touches the BFF plus several services; boundaries should follow business capabilities instead',
        'The problem is purely performance; adding a Redis cache in front of each entity service resolves it',
      ],
      correct: [2],
      explanation:
        'Entity (noun) services own data but not behaviour, so logic accumulates in orchestrating callers, producing chatty traffic and cross-team changes for every feature. Capability services (Checkout, Returns) own both the data and the invariants. Splitting further worsens chattiness; an ESB re-centralizes logic in smart pipes; caching hides latency but not the coupling.',
      followUps: [
        {
          "q": "You decide to introduce a Returns capability service. What data does it own, and how does it get customer and product information without calling those entity services on every request?",
          "a": "Returns owns return requests, the return policy rules, RMA state and refund instructions, which are the invariants that used to live in the BFF. For customer and product data it keeps a local projection of only the fields it needs (customer tier, product return window, price paid), built from `CustomerChanged` and `ProductChanged` events or captured from the order at purchase time. Price paid must come from the order snapshot anyway, because current product price is the wrong value for a refund. The BFF then makes one call, `POST /returns`, instead of orchestrating three services."
        }
      ],
    },
    {
      id: 'microservices-mcq-08',
      difficulty: 'expert',
      question:
        'During a strangler-fig migration, the new Catalog service is populated via CDC from the monolith and serves 100% of reads. Before flipping write ownership to the new service, which conditions should be in place? Select ALL that apply.',
      options: [
        'A reverse sync (events/CDC from the new service back to the monolith tables) so remaining monolith readers stay correct',
        'Application code that writes every change to both databases in the same request, to keep them in lockstep',
        'A tested rollback path: facade routes can revert writes to the monolith and the reverse sync keeps it up to date',
        'Reconciliation checks (counts/checksums) showing the two stores agree within tolerance',
        'Deletion of the monolith catalog tables, so nobody accidentally writes to them',
      ],
      correct: [0, 2, 3],
      explanation:
        'After the flip, the monolith still has readers, so it needs a reverse feed; you also need a proven rollback and evidence of data parity. Application-level dual writes are not atomic and create divergence on partial failure — exactly what CDC and a single writer avoid. Deleting the tables before the remaining readers migrate removes the rollback path; deletion is the final step.',
      followUps: [
        {
          "q": "After the write flip, reconciliation reports 0.3% of SKUs differ between the stores. How do you find the cause and decide whether to roll back?",
          "a": "First classify the diffs. If they are only rows updated in the last few seconds, it is replication lag, which is harmless. If they are concentrated on one field or code path, it is a mapping bug in the reverse sync. If they are old rows, a writer is still hitting the monolith tables, which you can confirm with DB audit logs or by revoking write grants. Roll back if the divergence affects money or orderability (price, stock flag) and is growing. Otherwise fix forward and re-sync the affected keys. Set rollback criteria before the flip, for example over 0.1% of priced fields wrong for more than 10 minutes."
        }
      ],
    },
    {
      id: 'microservices-mcq-09',
      difficulty: 'medium',
      question:
        'All Orders pods restart repeatedly during a 40-second Postgres failover, and the service stays down for several minutes after the DB is back. Given this probe config, what is the most likely cause?',
      code: {
        language: 'yaml',
        code: `livenessProbe:
  httpGet: { path: /health, port: 3000 }   # /health runs SELECT 1 against Postgres
  periodSeconds: 5
  failureThreshold: 2
readinessProbe:
  httpGet: { path: /health, port: 3000 }
  periodSeconds: 5
  failureThreshold: 2`,
      },
      options: [
        'The readiness probe removes pods from the Service, which Kubernetes treats as a crash and restarts them',
        'The liveness probe depends on the database, so a DB blip makes Kubernetes kill every healthy pod; restarts then storm the recovering DB with new connections and cold starts',
        'periodSeconds is too long; probing every 1 s would detect DB recovery sooner and avoid restarts',
        'Both probes share the same path, which Kubernetes rejects, so the pods fail admission and are recreated',
      ],
      correct: [1],
      explanation:
        'Liveness failure means "restart me", so tying it to a dependency turns a DB failover into a fleet-wide restart, followed by a thundering herd of reconnects and warmups. Readiness failure only removes a pod from endpoints — it never restarts it, and it is the right place for dependency checks (with care). Faster probing makes restarts happen sooner, not less. Sharing a path is allowed.',
      followUps: [
        {
          "q": "Rewrite the probes. What should liveness and readiness each check, and should readiness fail on a DB outage at all?",
          "a": "Liveness checks only that the process can serve, for example an in-process `/healthz` that returns 200 if the event loop responds, with `failureThreshold: 3` and a generous timeout. Readiness checks whether this pod can usefully take traffic. Failing readiness on a DB outage is debatable: if every pod fails readiness, the Service has zero endpoints and clients get connection errors instead of a fast 503 with a useful message. Many teams keep readiness local (warm-up done, not overloaded), handle DB errors in the request path with a circuit breaker, and add a `startupProbe` so slow boots are not killed."
        }
      ],
    },
    {
      id: 'microservices-mcq-10',
      difficulty: 'expert',
      question:
        'To save cost, five services share one Postgres cluster. Which setup still honours "database per service"?',
      options: [
        'One schema per service with a dedicated DB role per service that has privileges only on its own schema; cross-service data flows via APIs or events',
        'One shared schema, but each team promises in the wiki to only query its own tables',
        'One schema per service, but services may create read-only views over other schemas for reporting joins',
        'It cannot be honoured; database per service requires a separate physical cluster per service',
      ],
      correct: [0],
      explanation:
        'The principle is data ownership and encapsulation, enforced by access control — separate schemas plus least-privilege roles achieve that on shared hardware (you still share noisy-neighbour and failure risk, which is an explicit trade-off). A wiki promise is not enforcement. Cross-schema views recreate schema coupling: the owner can no longer change its tables freely. Separate clusters are an option for isolation, not a requirement of the pattern.',
      followUps: [
        {
          "q": "The Analytics team needs a nightly join across all five schemas. How do you serve them without breaking schema ownership?",
          "a": "Don't grant cross-schema reads. Each owning service publishes its data as a contract: CDC from Debezium or domain events land in a warehouse or lake (BigQuery, Snowflake, S3/Parquet), where the joins happen. The published shape is versioned and documented, so an owner can rename internal columns as long as the CDC transform keeps the outbound contract. Analytics gets full join power on hours-old data, which is fine for nightly reports. The OLTP cluster no longer runs heavy analytical queries that would hurt the noisy-neighbour situation on the shared hardware."
        }
      ],
    },
    {
      id: 'microservices-mcq-11',
      difficulty: 'hard',
      question:
        'After moving the "My Orders" page to a CQRS read model (lag p99 ≈ 1.5 s), users complain that the order they just placed is missing when they land on the page. Which fixes address this without abandoning CQRS? Select ALL that apply.',
      options: [
        'Return the created order in the checkout response and have the UI merge it into the list until the read model catches up',
        'Switch the projector to synchronous projection inside the Orders write transaction across service boundaries using 2PC',
        'For a short window after a write (e.g. carrying the last-written version in the session), read that user\'s newest order from the write side or wait until the read model reaches that version',
        'Increase Kafka retention so that events are available longer for the projector',
      ],
      correct: [0, 2],
      explanation:
        'Read-your-writes can be provided at the edges: the client already knows what it wrote, or reads can be routed/version-gated for that user briefly. 2PC across services reintroduces tight coupling and availability loss the design meant to avoid. Retention affects rebuild capability, not propagation lag.',
      followUps: [
        {
          "q": "How would you measure and alert on the read model's freshness so you know when the 1.5 s p99 lag degrades?",
          "a": "Measure end to end, not just consumer lag. Stamp each event with its commit time, and have the projector emit a histogram of `now - committed_at` when it applies the event. Also export Kafka consumer-group lag in messages and in time. Alert when p99 freshness exceeds a threshold, say 5 s for 5 minutes. A synthetic canary that places a test order every minute and polls the read model until it appears gives a user-visible freshness SLI. Include the projector's error and DLQ rate, since a stuck poison event shows up as growing lag on one partition."
        }
      ],
    },
    {
      id: 'microservices-mcq-12',
      difficulty: 'expert',
      question:
        'The Orders team removed "float total = 3" and, a month later, added "string total_display = 3" to the same message. Old consumers still run the previous generated code. What happens when an old consumer parses a new message?',
      code: {
        language: 'protobuf',
        code: `// old consumers were compiled against:
message Order { string id = 1; string customer_id = 2; float total = 3; }

// new producer now sends:
message Order { string id = 1; string customer_id = 2; string total_display = 3; }`,
      },
      options: [
        'Protobuf matches fields by name, so the old consumer simply ignores total_display and total defaults to 0',
        'Silently wrong data: official runtimes (Java, C++, Go) see a wire-type mismatch for field 3, keep it as an unknown field and leave total at 0; some lenient parsers misread the bytes instead — either way there is no clean, visible error',
        'Every protobuf runtime rejects the message with a parse exception, which at least makes the break visible immediately',
        'Protobuf converts compatible scalar types on the wire, so a numeric string such as 19.99 is parsed into the float field correctly',
      ],
      correct: [1],
      explanation:
        'Protobuf identifies fields by number and wire type, never by name. With a mismatched wire type, the official runtimes store the field as unknown and the typed field keeps its default, so consumers see total = 0 with no error — the worst kind of break (some lenient parsers such as older protobuf.js generated code may instead misread bytes). There is no string-to-float conversion, and mainstream runtimes do not throw here. If the wire types had matched (e.g. reusing the number for an int32 vs int64 change), bytes would be silently reinterpreted. This is why deleted fields must be marked reserved by number and name.',
      followUps: [
        {
          "q": "How do you stop this class of mistake from ever reaching production again?",
          "a": "Add a schema compatibility gate in CI. `buf breaking --against` the main branch (or a Schema Registry with BACKWARD/FULL compatibility for Kafka) rejects deleting a field without `reserved 3; reserved \"total\";`, changing a field's type, or reusing a number. Store `.proto` files in a central schema repo with code owners from consuming teams. For a type change, add a new field (`int64 total_minor = 4`), dual-write both fields for a deprecation window, migrate consumers, then remove the old field and reserve its number and name. Contract tests in consumers catch semantic breaks the schema checker cannot see."
        }
      ],
    },
    {
      id: 'microservices-mcq-13',
      difficulty: 'hard',
      question:
        'An event-sourced Customer aggregate stores names, emails and addresses in immutable events. A GDPR erasure request arrives. Which approaches are sound? Select ALL that apply.',
      options: [
        'Crypto-shredding: encrypt PII in events with a per-customer key held in a KMS and delete that key on erasure',
        'Store PII outside the events (a separate, deletable PII store) and reference it by id from events',
        'Append a CustomerErased event and leave the original PII-bearing events untouched, since the log is immutable',
        'Rely on Kafka compaction of the customer topic to eventually remove old events',
      ],
      correct: [0, 1],
      explanation:
        'Crypto-shredding makes the PII in retained events unreadable without mutating them; keeping PII out of events entirely in a deletable store achieves the same. An erasure event alone leaves personal data readable in history and projections. Compaction keeps the latest record per key (which may still contain PII) and does not touch the event store or downstream copies, so it is not an erasure mechanism.',
      followUps: [
        {
          "q": "With crypto-shredding, what about projections, Kafka topics and backups that already hold decrypted PII?",
          "a": "Crypto-shredding only covers data that stays encrypted. Projections that store plaintext names must handle the erasure event and delete or anonymise the row. Kafka payloads should carry encrypted PII or only a customer id, so topic retention never holds plaintext. For backups, either encrypt PII fields with the same per-customer key (the backup becomes unreadable once the key is deleted) or document a retention window after which backups expire, which GDPR accepts if restores re-apply erasures. Keep an erasure ledger so any restore replays the deletions. Audit by scanning stores for a known test customer's PII after an erasure drill."
        }
      ],
    },
    {
      id: 'microservices-mcq-14',
      difficulty: 'expert',
      question:
        'An order fulfilment flow is implemented as choreography across 7 services reacting to each other\'s events. Support cannot answer "where is order X stuck?", and adding a fraud-check step required changes in 4 services. What is the best next move?',
      options: [
        'Add more events so every service broadcasts its internal state changes, giving support full visibility',
        'Replace all events with synchronous REST calls in a fixed chain so the flow becomes explicit',
        'Merge all 7 services into a single service, since choreography has proven unworkable',
        'Introduce an orchestrator (e.g. Temporal or a saga orchestrator service) that owns the workflow state and issues commands, while services keep their own data and logic',
      ],
      correct: [3],
      explanation:
        'Long choreographed flows hide the process: no component knows the overall state, and inserting a step means changing the implicit chain. An orchestrator makes the workflow explicit, queryable and changeable in one place while preserving service autonomy. More events increase noise without a process owner; a sync REST chain brings temporal coupling and cascading failures; merging everything overcorrects when the boundaries themselves are fine.',
      followUps: [
        {
          "q": "The orchestrator itself is now critical. What happens if it crashes in the middle of an order, after reserving stock but before charging payment?",
          "a": "A durable orchestrator such as Temporal persists each step's result in its own event history before moving on. When a worker restarts, it replays the history, sees that stock was reserved, and continues with the payment command, so no step is lost or re-run. For that to be safe, every command must be idempotent (pass a step id or idempotency key) because the orchestrator guarantees at-least-once activity execution. If payment fails permanently, the workflow runs the compensation to release stock. Run the orchestrator as a replicated cluster and watch stuck-workflow counts per step."
        }
      ],
    },
    {
      id: 'microservices-mcq-15',
      difficulty: 'medium',
      question:
        'Three teams (Search, Recommendations, Catalog) all commit to one "product-service", and every release needs sign-off from all three. Applying Conway\'s law, what is the most effective change?',
      options: [
        'Keep one service but add a stricter code-review process across the three teams',
        'Split along team-owned bounded contexts so each team owns and deploys its own service (or module), with contracts between them',
        'Create a fourth team to own product-service and have the other three submit change requests',
        'Move product-service into a shared library so each team can deploy it independently in their own apps',
      ],
      correct: [1],
      explanation:
        'Conway\'s law says the system mirrors communication structure; a single component shared by three teams forces three-way coordination on every release. Aligning ownership with bounded contexts restores autonomy. More review adds process without removing coupling; a gatekeeper team creates a queue; a shared library spreads domain coupling into every consumer.',
      followUps: [
        {
          "q": "After splitting, Search and Recommendations both need product data that Catalog owns. How do you avoid them calling Catalog on every query?",
          "a": "Catalog publishes `ProductUpserted` and `ProductDeleted` events, or a compacted Kafka topic keyed by productId, as its public contract. Search indexes the events into Elasticsearch and Recommendations keeps its own feature store. Each consumer holds only the fields it needs and tolerates seconds of staleness. Catalog can change its internal model freely as long as the event schema stays compatible, enforced by registry checks. A new consumer bootstraps from the compacted topic with no backfill request to the Catalog team. Search and Recommendations keep serving even when Catalog is down."
        }
      ],
    },
  ],
};

export default topic;
